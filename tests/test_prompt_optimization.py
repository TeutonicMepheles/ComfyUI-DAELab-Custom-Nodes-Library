"""Failure injection uses a local transport double, never billable endpoints."""
import asyncio
import copy
import importlib.util
import json
import ssl
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('promptopt', ROOT / 'nodes/prompt_optimization/__init__.py', submodule_search_locations=[str(ROOT / 'nodes/prompt_optimization')])
module = importlib.util.module_from_spec(spec)
sys.modules['promptopt'] = module
spec.loader.exec_module(module)
from promptopt.service import Service, digest, validate_snapshot, suggestion
from promptopt.instructions import INSTRUCTIONS, INSTRUCTION_VERSION, INSTRUCTION_DIGEST, INPUT_VERSION
from promptopt.transport import TransportError
from promptopt.pricing import tokens, OfficialPricing


class Price:
    version = 'test-rate'
    async def get(self, model='gpt-4.1-mini'):
        return dict(version=self.version, input=84.4, output=337.6, source='fixture', unit='credits/1M tokens')


class Transport:
    def __init__(self):
        self.posts, self.gets = [], []
        self.failure = None
        self.gate = None
        self.status = 'completed'
    async def create(self, snapshot, instructions, auth):
        self.posts.append((copy.deepcopy(snapshot), instructions))
        if self.gate:
            await self.gate.wait()
        if self.failure:
            raise self.failure
        return {'id': 'resp_test'}, {'creditsHeader': '0.25', 'method': 'POST'}
    async def query(self, rid, auth):
        self.gets.append(rid)
        return {'id': rid, 'status': self.status, 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '精简后的提示词。'}]}]}, {'creditsHeader': '0.25', 'method': 'GET'}


def snapshot(index=0, fixture=0):
    f = json.loads((ROOT / 'tests/fixtures/prompt-optimization/requests.json').read_text(encoding='utf-8'))[fixture]
    s = dict(contractVersion=1, target=dict(documentId='doc', tableId='table', recordId=f'row{index}', fieldId='prompt'),
        revision=0, requestSeq=1, model='gpt-4.1-mini', requirements=f['input']['optimization_requirements'],
        purpose=f['input']['purpose'], instructionVersion=INSTRUCTION_VERSION, instructionDigest=INSTRUCTION_DIGEST,
        inputVersion=INPUT_VERSION, maxOutputTokens=1024, input=f['input'], inputText=f['inputText'])
    s['snapshotDigest'] = digest(s)
    return s


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.t, self.p = Transport(), Price()
        self.s = Service(self.temp.name, transport=self.t, pricing=self.p, models=lambda: ['gpt-4.1-mini'])
        self.lease = await self.s.lease(dict(target=snapshot()['target'], instanceId='view1'))
    async def asyncTearDown(self):
        for task in self.s.workers.values():
            if not task.done():
                task.cancel()
        await asyncio.gather(*self.s.workers.values(), return_exceptions=True)
        self.s.ledger.db.close()
        self.temp.cleanup()
    async def batch(self, count=1, bid='batch1', scope=None):
        rows = [snapshot(i) for i in range(count)]
        q = await self.s.estimate(dict(rows=rows, model='gpt-4.1-mini'))
        p = dict(quoteId=q['quoteId'], batchId=bid, rows=[dict(requestId=f'{bid}-r{i}', snapshot=s) for i,s in enumerate(rows)], leaseId=self.lease['leaseId'], budgetCredits=q['budgetUpperCredits'])
        p['range'] = dict(scope=scope or ('cell' if count == 1 else 'column'), fieldId='prompt')
        if p['range']['scope'] == 'cell':
            p['range']['recordId'] = rows[0]['target']['recordId']
        return await self.s.submit(p), p, q
    async def permit(self, batch, index=0):
        row = batch['rows'][index]
        return await self.s.permit(dict(batchId=batch['batchId'], requestId=row['requestId'], leaseId=self.lease['leaseId'], **{k: row['snapshot'][k] for k in ('snapshotDigest','revision','requestSeq')}))
    async def advance(self, batch, index=0):
        permit = await self.permit(batch, index)
        return await self.s.advance(permit, {'token': 'not-real'})
    async def done(self):
        await asyncio.gather(*self.s.workers.values())

    async def test_single_durable_id_and_cost_evidence_not_summed(self):
        batch, _, _ = await self.batch()
        await self.advance(batch)
        await self.done()
        row = self.s.batch('batch1')['rows'][0]
        self.assertEqual(row['status'], 'succeeded')
        self.assertEqual(self.t.gets, ['resp_test'])
        self.assertEqual(row['actualCredits'], 0.25)
        self.assertEqual(set(row['costEvidence']), {'create', 'query'})
        self.assertNotIn('not-real', self.s.ledger.db.execute('SELECT group_concat(body) FROM objects').fetchone()[0])

    async def test_stop_linearizes_before_post(self):
        batch, _, _ = await self.batch(2)
        p = await self.permit(batch)
        await self.s.stop(dict(batchId='batch1', leaseId=self.lease['leaseId']))
        with self.assertRaises(ValueError):
            await self.s.advance(p)
        self.assertEqual(self.t.posts, [])

    async def test_stop_preserves_inflight_and_stops_next(self):
        self.t.gate = asyncio.Event()
        batch, _, _ = await self.batch(2)
        await self.advance(batch)
        await asyncio.sleep(0)
        stopped = await self.s.stop(dict(batchId='batch1', leaseId=self.lease['leaseId']))
        self.assertEqual([r['status'] for r in stopped['rows']], ['submitting','stopped'])
        self.t.gate.set()
        await self.done()
        self.assertEqual(len(self.t.posts), 1)
        self.assertEqual(self.s.batch('batch1')['rows'][0]['status'], 'succeeded')

    async def test_one_inflight_and_single_use_permit(self):
        self.t.gate = asyncio.Event()
        batch, _, _ = await self.batch(2)
        p = await self.permit(batch)
        await self.s.advance(p)
        with self.assertRaises(ValueError):
            await self.s.advance(p)
        p2 = await self.permit(batch, 1)
        with self.assertRaises(ValueError):
            await self.s.advance(p2)
        self.t.gate.set()
        await self.done()
        self.assertEqual(len(self.t.posts), 1)

    async def test_unknown_no_retry_and_requires_ack_for_new_attempt(self):
        self.t.failure = TimeoutError()
        batch, p, _ = await self.batch()
        await self.advance(batch)
        await self.done()
        self.assertEqual(self.s.batch('batch1')['rows'][0]['status'], 'unknown')
        await self.s.query(dict(batchId='batch1'), {'token':'fake'})
        self.assertEqual(len(self.t.posts), 1)
        p.update(batchId='newbatch', rows=[dict(requestId='newrequest', snapshot=snapshot())])
        with self.assertRaisesRegex(ValueError, '未知'):
            await self.s.submit(p)
        p['acknowledgeUnknownRequestIds']=['batch1-r0']
        self.assertEqual((await self.s.submit(p))['rows'][0]['status'], 'queued')

    async def test_idempotent_submit_and_conflict(self):
        batch, p, _ = await self.batch()
        self.assertEqual((await self.s.submit(p))['batchId'], batch['batchId'])
        p['budgetCredits'] += 1
        with self.assertRaisesRegex(ValueError, '冲突'):
            await self.s.submit(p)

    async def test_overlapping_target_returns_original(self):
        batch, _, _ = await self.batch()
        other, _, _ = await self.batch(bid='other')
        self.assertEqual(batch['batchId'], other['batchId'])

    async def test_lease_other_view_and_expiration(self):
        with self.assertRaisesRegex(ValueError, '另一个'):
            await self.s.lease(dict(target=snapshot()['target'], instanceId='view2'))
        batch, _, _ = await self.batch()
        for lease in self.s.leases.values():
            lease['expiresAt']=0
        with self.assertRaisesRegex(ValueError, '租约'):
            await self.permit(batch)

    async def test_quote_expiry_and_price_change_pause_without_post(self):
        batch, _, q = await self.batch()
        p = await self.permit(batch)
        self.p.version='changed'
        with self.assertRaisesRegex(ValueError, '价格'):
            await self.s.advance(p)
        self.assertTrue(self.s.batch('batch1')['paused'])
        self.assertEqual(self.t.posts, [])

    async def test_budget_rejection(self):
        _, p, _ = await self.batch()
        p.update(batchId='other', budgetCredits=0)
        with self.assertRaisesRegex(ValueError, '预算'):
            await self.s.submit(p)

    async def test_expired_quote_stops_next_post_and_preserves_completed_row(self):
        batch, _, quote = await self.batch(2)
        await self.advance(batch)
        await self.done()
        completed = copy.deepcopy(self.s.batch('batch1')['rows'][0])
        frozen = self.s.ledger.get('quote', quote['quoteId'])
        frozen['expiresAt'] = 0
        self.s.ledger.put('quote', quote['quoteId'], frozen)
        permit = await self.permit(self.s.batch('batch1'), 1)
        with self.assertRaisesRegex(ValueError, '估算已失效'):
            await self.s.advance(permit, {'token': 'fake'})
        self.assertEqual(len(self.t.posts), 1)
        after = self.s.batch('batch1')
        self.assertTrue(after['paused'])
        self.assertEqual(after['rows'][0], completed)
        self.assertIsNone(after['rows'][1]['remoteResponseId'])

    async def test_get_disconnect_recovers_existing_id_without_second_post(self):
        original_query = self.t.query
        failed_ids = []
        async def disconnected(remote_id, auth):
            failed_ids.append(remote_id)
            raise ConnectionError('local GET disconnect fixture')
        self.t.query = disconnected
        batch, _, _ = await self.batch()
        await self.advance(batch)
        await self.done()
        row = self.s.batch('batch1')['rows'][0]
        self.assertEqual((row['status'], row['remoteResponseId']), ('submitted', 'resp_test'))
        self.assertIn('不会重发', row['error'])
        self.assertEqual(failed_ids, ['resp_test'])
        self.t.query = original_query
        await self.s.query(dict(batchId='batch1'), {'token': 'fake'})
        await self.done()
        recovered = self.s.batch('batch1')['rows'][0]
        self.assertEqual((recovered['status'], recovered['remoteResponseId']), ('succeeded', 'resp_test'))
        self.assertEqual(len(self.t.posts), 1)
        self.assertEqual(self.t.gets, ['resp_test'])
        self.assertNotIn('error', recovered)

    async def test_sqlite_restart_reestimates_frozen_input_and_preserves_preflight_skips(self):
        original = snapshot(fixture=3)  # Text reference with token/kind/label/text order.
        skipped = [{'recordId': 'empty-row', 'reason': '提示词为空'}]
        quote = await self.s.estimate(dict(rows=[original], skipped=skipped))
        batch = await self.s.submit(dict(quoteId=quote['quoteId'], batchId='restored',
            range=dict(scope='column', fieldId='prompt'), rows=[dict(requestId='restore-r0', snapshot=original)],
            leaseId=self.lease['leaseId'], budgetCredits=quote['budgetUpperCredits']))
        self.s.ledger.db.close()
        restored = Service(self.temp.name, transport=self.t, pricing=self.p, models=lambda: ['gpt-4.1-mini'])
        try:
            stored = restored.batch('restored')
            frozen = stored['rows'][0]['snapshot']
            self.assertTrue(stored['paused'])
            self.assertNotEqual(list(frozen['input']), list(original['input']))
            self.assertNotEqual(list(frozen['input']['reference_context'][0]), list(original['input']['reference_context'][0]))
            self.assertEqual(frozen['inputText'], original['inputText'])
            new_quote = await restored.estimate(dict(rows=[frozen], skipped=stored.get('preflightSkipped', [])))
            self.assertEqual(stored['preflightSkipped'], skipped)
            self.assertEqual(new_quote['skipped'], skipped)
            lease = await restored.lease(dict(target=original['target'], instanceId='restored-view'))
            continued = await restored.continue_batch(dict(batchId='restored', quoteId=new_quote['quoteId'],
                leaseId=lease['leaseId'], budgetCredits=new_quote['budgetUpperCredits']))
            self.assertFalse(continued['paused'])
            permit = await restored.permit(dict(batchId='restored', requestId='restore-r0', leaseId=lease['leaseId'],
                **{k: frozen[k] for k in ('snapshotDigest', 'revision', 'requestSeq')}))
            await restored.advance(permit, {'token': 'fake'})
            await asyncio.gather(*restored.workers.values())
            self.assertEqual(len(self.t.posts), 1)
            self.assertEqual(self.t.posts[0][0]['inputText'], original['inputText'])
            self.assertEqual(restored.batch('restored')['preflightSkipped'], skipped)
        finally:
            restored.ledger.db.close()

    async def test_restart_unknown_and_submitted_get_only_no_queued(self):
        batch, _, _ = await self.batch(3)
        batch['rows'][0]['status']='submitting'
        batch['rows'][1].update(status='polling', remoteResponseId='resp_existing')
        self.s.save(batch)
        second = Service(self.temp.name, transport=self.t, pricing=self.p, models=lambda:['gpt-4.1-mini'])
        try:
            state = second.batch('batch1')
            self.assertTrue(state['paused'])
            self.assertEqual([r['status'] for r in state['rows']], ['unknown','submitted','queued'])
            await second.query(dict(batchId='batch1'), {'token':'fake'})
            await asyncio.gather(*second.workers.values())
            self.assertEqual(self.t.gets, ['resp_existing'])
            self.assertEqual(self.t.posts, [])
        finally:
            second.ledger.db.close()

    async def test_clear_rejection_failed_and_incomplete_invalid(self):
        self.t.failure=TransportError('登录过期', definitely_rejected=True)
        batch, _, _ = await self.batch()
        await self.advance(batch)
        await self.done()
        self.assertEqual(self.s.batch('batch1')['rows'][0]['status'], 'failed')
        self.t.failure=None
        self.t.status='incomplete'
        batch, _, _ = await self.batch(bid='b2')
        await self.advance(batch)
        await self.done()
        self.assertEqual(self.s.batch('b2')['rows'][0]['suggestion']['status'], 'invalid')

    async def test_skipped_row_and_partial_success_preserved(self):
        batch, _, _ = await self.batch(2)
        await self.advance(batch)
        await self.done()
        await self.s.skip(dict(batchId='batch1',requestId='batch1-r1',leaseId=self.lease['leaseId'],reason='编辑已变化'))
        self.assertEqual([r['status'] for r in self.s.batch('batch1')['rows']],['succeeded','skipped'])

    async def test_different_batches_same_table_share_serial_boundary(self):
        self.t.gate = asyncio.Event()
        batch, _, _ = await self.batch()
        second_snapshot = snapshot(8)
        q = await self.s.estimate(dict(rows=[second_snapshot]))
        second = await self.s.submit(dict(quoteId=q['quoteId'],batchId='second',rows=[dict(requestId='second-r0',snapshot=second_snapshot)],leaseId=self.lease['leaseId'],budgetCredits=q['budgetUpperCredits'],range=dict(scope='cell',fieldId='prompt',recordId=second_snapshot['target']['recordId'])))
        await self.advance(batch)
        p = await self.permit(second)
        with self.assertRaisesRegex(ValueError,'其他批次'):
            await self.s.advance(p)
        self.t.gate.set()
        await self.done()
        # Preparing from an expired/consumed permission remains safe to preflight.
        await self.advance(self.s.batch('second'))
        await self.done()
        self.assertEqual(len(self.t.posts),2)

    async def test_expired_permission_can_be_rechecked_or_skipped(self):
        batch, _, _ = await self.batch()
        p = await self.permit(batch)
        self.s.permits[p['permitId']]['expiresAt']=0
        with self.assertRaisesRegex(ValueError,'过期'):
            await self.s.advance(p)
        self.assertEqual(self.t.posts,[])
        p = await self.permit(self.s.batch('batch1'))
        await self.s.skip(dict(batchId='batch1',requestId='batch1-r0',leaseId=self.lease['leaseId'],reason='view changed'))
        with self.assertRaises(ValueError):
            await self.s.advance(p)

    async def test_expired_lease_renewal_requires_explicit_continue(self):
        batch, _, q = await self.batch()
        for lease in self.s.leases.values(): lease['expiresAt']=0
        self.lease = await self.s.lease(dict(target=snapshot()['target'],instanceId='view1'))
        self.assertTrue((await self.s.query(dict(batchId='batch1')))['paused'])
        with self.assertRaisesRegex(ValueError,'当前不能'):
            await self.permit(batch)
        await self.s.continue_batch(dict(batchId='batch1',quoteId=q['quoteId'],leaseId=self.lease['leaseId'],budgetCredits=q['budgetUpperCredits']))
        await self.advance(self.s.batch('batch1'))
        await self.done()
        self.assertEqual(len(self.t.posts),1)

    async def test_models_intersection_and_no_fallback(self):
        self.s.models=lambda:['gpt-4.1','gpt-4.1-nano','gpt-5']
        cap=await self.s.capabilities()
        self.assertFalse(cap['available'])
        self.assertEqual([m['id'] for m in cap['models'] if m['available'] and m['provider']=='comfy'],['gpt-4.1','gpt-4.1-nano'])
        s=snapshot()
        self.assertEqual((await self.s.estimate(dict(rows=[s])))['status'],'unavailable')
        s['model']='gpt-4.1'
        s['snapshotDigest']=digest(s)
        self.assertEqual((await self.s.estimate(dict(rows=[s],model='gpt-4.1')))['status'],'ready')
        s['maxOutputTokens']=32769
        with self.assertRaisesRegex(ValueError,'输出预算'):
            await self.s.estimate(dict(rows=[s],model='gpt-4.1'))

    async def test_target_discovery_survives_lost_workflow_refs_without_network(self):
        batch, _, _ = await self.batch(2)
        batch['rows'][0].update(status='submitted',remoteResponseId='resp_pending')
        self.s.save(batch)
        before = self.s.ledger.db.execute('SELECT kind,id,body FROM objects ORDER BY kind,id').fetchall()
        # Native undo no longer retains batchId; only serialized stable identity
        # is available. Even auth supplied to discovery must not poll the remote.
        found = await self.s.query(dict(target={'documentId':'doc','tableId':'table'}), {'token':'fake-discovery-token'})
        self.assertEqual(len(found['batches']),1)
        summary = found['batches'][0]
        self.assertEqual((summary['batchId'],summary['fieldId'],summary['scope'],summary['rowCount']),('batch1','prompt','column',2))
        self.assertNotIn('recordId',summary)
        self.assertEqual(summary['statusCounts'],{'submitted':1,'queued':1})
        self.assertEqual(self.t.posts,[])
        self.assertEqual(self.t.gets,[])
        self.assertEqual(self.s.workers,{})
        after = self.s.ledger.db.execute('SELECT kind,id,body FROM objects ORDER BY kind,id').fetchall()
        self.assertEqual(before,after)
        for secret in ('inputText','snapshot','resp_pending','fake-discovery-token'):
            self.assertNotIn(secret,json.dumps(found))
        self.assertNotIn('fake-discovery-token',str(after))
        self.assertEqual((await self.s.query(dict(target={'documentId':'other','tableId':'table'})))['batches'],[])
        self.assertEqual((await self.s.query(dict(target={'documentId':'doc','tableId':'other'})))['batches'],[])

    async def test_target_discovery_single_cell_and_exact_identity_shape(self):
        await self.batch()
        summary=(await self.s.query(dict(target={'documentId':'doc','tableId':'table'})))['batches'][0]
        self.assertEqual((summary['scope'],summary['recordId']),('cell','row0'))
        with self.assertRaisesRegex(ValueError,'完整'):
            await self.s.query(dict(target={'tableId':'table'}))
        with self.assertRaisesRegex(ValueError,'完整'):
            await self.s.query(dict(target={'documentId':'doc','tableId':'table','recordId':'row0'}))

    async def test_column_with_one_valid_row_preserves_explicit_range(self):
        batch, p, _ = await self.batch(scope='column')
        self.assertEqual(batch['range'],{'scope':'column','fieldId':'prompt'})
        found=await self.s.query(dict(target={'documentId':'doc','tableId':'table'}))
        self.assertEqual(found['batches'][0]['scope'],'column')
        self.assertNotIn('recordId',found['batches'][0])
        second=Service(self.temp.name,transport=self.t,pricing=self.p,models=lambda:['gpt-4.1-mini'])
        try:
            self.assertEqual((await second.query(dict(target={'documentId':'doc','tableId':'table'})))['batches'][0]['scope'],'column')
        finally:
            second.ledger.db.close()
        # An idempotent ID must not silently change its original range.
        p['range']={'scope':'cell','fieldId':'prompt','recordId':'row0'}
        with self.assertRaisesRegex(ValueError,'冲突'):
            await self.s.submit(p)

    async def test_range_rejects_mismatched_field_record_or_missing_scope(self):
        _, p, _ = await self.batch()
        for invalid in ({'scope':'column','fieldId':'wrong'}, {'scope':'cell','fieldId':'prompt','recordId':'wrong'}, {'scope':'column','fieldId':'prompt','recordId':'row0'}, None):
            p['range']=invalid
            with self.assertRaises(ValueError):
                await self.s.submit(p)

    async def test_legacy_batch_without_range_keeps_discovery_fallback(self):
        batch, _, _ = await self.batch()
        batch.pop('range')
        self.s.save(batch)
        found=await self.s.query(dict(target={'documentId':'doc','tableId':'table'}))
        self.assertEqual((found['batches'][0]['scope'],found['batches'][0]['recordId']),('cell','row0'))


class ValidationTests(unittest.TestCase):
    def test_all_fixture_inputs_and_full_token_budget(self):
        import hashlib
        self.assertEqual(hashlib.sha256(INSTRUCTIONS.encode()).hexdigest(), INSTRUCTION_DIGEST)
        for i in range(9):
            s = snapshot(fixture=i)
            validate_snapshot(s)
            count, output = tokens(s, INSTRUCTIONS)
            self.assertGreater(count, len(s['inputText']))
            self.assertLessEqual(output, s['maxOutputTokens'])
    def test_unchanged_invalid_markers_and_refusal(self):
        s = snapshot(fixture=6)
        def response(text):
            return dict(status='completed',output=[dict(type='message',content=[dict(type='output_text',text=text)])])
        self.assertEqual(suggestion(response(s['input']['prompt_text']),s)['status'],'unchanged')
        self.assertEqual(suggestion(response('missing'),s)['status'],'invalid')
        self.assertEqual(suggestion(response('```text\nhi'),snapshot())['status'],'invalid')
        self.assertEqual(suggestion(response('@image_1'),snapshot())['status'],'invalid')
        self.assertEqual(suggestion(response('{{Node :1}}'),snapshot())['status'],'invalid')
        self.assertEqual(suggestion(dict(status='incomplete'),s)['status'],'invalid')
    def test_frozen_json_and_no_extra_snapshot_fields(self):
        s=snapshot()
        s['inputText']+=' '
        with self.assertRaises(ValueError): validate_snapshot(s)
        s=snapshot()
        s['authorization']='secret'
        with self.assertRaises(ValueError): validate_snapshot(s)

    def test_input_text_contract_stays_strict_after_ledger_dictionary_reordering(self):
        original = snapshot(fixture=3)
        reordered = json.loads(json.dumps(original, sort_keys=True, ensure_ascii=False))
        validate_snapshot(reordered)
        # The redundancy may be reordered in storage, but actual wire JSON may not.
        changed = copy.deepcopy(reordered)
        changed['inputText'] = json.dumps(changed['input'], ensure_ascii=False, separators=(',', ':'))
        with self.assertRaisesRegex(ValueError, '次序'):
            validate_snapshot(changed)
        changed = copy.deepcopy(reordered)
        changed['input']['reference_context'][0]['text'] = 'different reference'
        with self.assertRaises(ValueError): validate_snapshot(changed)
        for text in ('not JSON', '[]', original['inputText'] + ' ', original['inputText'].replace('{', '{"purpose":"image",', 1)):
            changed = copy.deepcopy(reordered)
            changed['inputText'] = text
            with self.assertRaises(ValueError): validate_snapshot(changed)
class PriceRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def response(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'Input credits / 1M\n| gpt-4.1-mini | 84.4 | 337.6 |'
        return response

    async def test_public_get_retries_transient_tls_once_without_changing_tls(self):
        failure=ssl.SSLEOFError('TLS EOF fixture')
        with patch('promptopt.pricing.urllib.request.urlopen',side_effect=[failure,self.response()]) as fetch, patch('promptopt.pricing.time.sleep') as sleep:
            loaded=OfficialPricing()._load()
        self.assertEqual(fetch.call_count,2)
        self.assertEqual(loaded['prices']['gpt-4.1-mini']['input'],84.4)
        self.assertEqual(sleep.call_args.args,(0.25,))
        for call in fetch.call_args_list:
            self.assertEqual(call.args,('https://docs.comfy.org/tutorials/partner-nodes/pricing.md',))
            self.assertEqual(call.kwargs,{'timeout':10}) # No unverified SSL context.

    async def test_public_get_has_three_attempt_limit_and_nonretryable_http(self):
        with patch('promptopt.pricing.urllib.request.urlopen',side_effect=urllib.error.URLError('EOF')) as fetch, patch('promptopt.pricing.time.sleep'):
            with self.assertRaises(urllib.error.URLError): OfficialPricing()._load()
            self.assertEqual(fetch.call_count,3)
        with patch('promptopt.pricing.urllib.request.urlopen',side_effect=urllib.error.HTTPError('https://docs.comfy.org',403,'Forbidden',{},None)) as fetch:
            with self.assertRaises(urllib.error.HTTPError): OfficialPricing()._load()
            self.assertEqual(fetch.call_count,1)

    async def test_failed_price_cache_recovers_after_fifteen_seconds(self):
        pricing=OfficialPricing()
        loaded={'checkedAt':115001,'prices':{'gpt-4.1-mini':{'input':84.4,'output':337.6}}}
        with patch.object(pricing,'_load',side_effect=[urllib.error.URLError('EOF'),loaded]) as load, patch('promptopt.pricing.time.time',return_value=100) as clock:
            with self.assertRaises(ValueError): await pricing.get()
            with self.assertRaises(ValueError): await pricing.get()
            self.assertEqual(load.call_count,1)
            clock.return_value=115.001
            self.assertEqual((await pricing.get())['input'],84.4)
            self.assertEqual(load.call_count,2)


if __name__ == '__main__':
    unittest.main()
