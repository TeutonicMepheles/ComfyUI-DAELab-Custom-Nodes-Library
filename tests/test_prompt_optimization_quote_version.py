"""Old durable quotes must not authorize new fixed instructions. Local doubles only."""
import asyncio
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('quote_helpers', ROOT / 'tests/test_prompt_optimization.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)

# Exact canonical instruction bytes from main 63819e6, before the v5 upgrade.
OLD_INSTRUCTIONS = (ROOT / 'tests/fixtures/prompt-optimization/instructions-v4.txt').read_text(encoding='utf-8')
OLD_DIGEST = '8e44e9256b7eb759fc1d78d7731c668fa8bceaf78ae441025e256c2fa190eb11'


class OldQuoteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.transport, self.price = helpers.Transport(), helpers.Price()
        self.service = self.open_service()

    def open_service(self):
        return helpers.Service(self.temp.name, transport=self.transport, pricing=self.price,
                               models=lambda: ['gpt-4.1-mini'])

    async def asyncTearDown(self):
        for worker in self.service.workers.values():
            if not worker.done():
                worker.cancel()
        await asyncio.gather(*self.service.workers.values(), return_exceptions=True)
        self.service.ledger.db.close()
        self.temp.cleanup()

    def v4_runtime(self):
        # Patch the globals actually used by Service, not a second implementation
        # of its guards. The transport and pricing remain local doubles.
        return patch.dict(helpers.Service.check_quote.__globals__, {
            'INSTRUCTION_VERSION': 'daelab.prompt-opt.v4',
            'INSTRUCTION_DIGEST': OLD_DIGEST, 'INSTRUCTIONS': OLD_INSTRUCTIONS})

    async def persisted_old_quote(self, with_batch, remote=False):
        self.assertEqual(hashlib.sha256(OLD_INSTRUCTIONS.encode('utf-8')).hexdigest(), OLD_DIGEST)
        old = helpers.snapshot()
        old.update(instructionVersion='daelab.prompt-opt.v4', instructionDigest=OLD_DIGEST)
        old['snapshotDigest'] = helpers.digest({k: v for k, v in old.items() if k != 'snapshotDigest'})
        with self.v4_runtime():
            quote = await self.service.estimate({'rows': [old]})
            lease = await self.service.lease({'target': old['target'], 'instanceId': 'first'})
            payload = {'quoteId': quote['quoteId'], 'batchId': 'old-batch',
                       'rows': [{'requestId': 'old-request', 'snapshot': old}],
                       'leaseId': lease['leaseId'], 'budgetCredits': quote['budgetUpperCredits'],
                       'range': {'scope': 'cell', 'fieldId': 'prompt', 'recordId': 'row0'}}
            frozen = await self.service.check_quote(quote['quoteId'], [old], payload['budgetCredits'])
            self.assertEqual(frozen['rows'], [old])
            self.assertEqual(frozen['snapshotDigest'], helpers.digest([old]))
            if with_batch:
                await self.service.submit(payload)
            if remote:
                permit = await self.service.permit({'batchId': 'old-batch', 'requestId': 'old-request',
                    'leaseId': lease['leaseId'], **{k: old[k] for k in ('snapshotDigest', 'revision', 'requestSeq')}})
                async def disconnected(*args):
                    raise ConnectionError('local GET interruption after durable remote ID')
                with patch.object(self.transport, 'query', disconnected):
                    await self.service.advance(permit, {'token': 'local-double-only'})
                    await asyncio.gather(*self.service.workers.values())
                row = self.service.batch('old-batch')['rows'][0]
                self.assertEqual((row['status'], row['remoteResponseId']), ('submitted', 'resp_test'))
                self.assertEqual(self.transport.posts, [(old, OLD_INSTRUCTIONS)])
        self.service.ledger.db.close()
        self.service = self.open_service()
        self.lease = await self.service.lease({'target': old['target'], 'instanceId': 'restored'})
        payload['leaseId'] = self.lease['leaseId']
        # Positive control after reopening: expiry, digest, price, budget and
        # renewed lease all pass. Restoring v5 must be the sole rejection cause.
        with self.v4_runtime():
            await self.service.check_quote(quote['quoteId'], [old], payload['budgetCredits'])
            self.service.check_lease({'tableKey': helpers.Service.check_quote.__globals__['table_key'](old['target'])},
                                     self.lease['leaseId'])
        self.assertEqual(helpers.Service.check_quote.__globals__['INSTRUCTION_VERSION'], 'daelab.prompt-opt.v5')
        return payload, old

    def assert_no_transport(self):
        self.assertEqual(self.transport.posts, [])
        self.assertEqual(self.transport.gets, [])
        self.assertEqual(self.service.workers, {})

    async def test_old_persisted_quote_cannot_create_batch(self):
        payload, _ = await self.persisted_old_quote(False)
        with self.assertRaisesRegex(ValueError, '固定指令已改变'):
            await self.service.submit(payload)
        self.assertIsNone(self.service.ledger.get('batch', 'old-batch'))
        self.assertIsNotNone(self.service.ledger.get('quote', payload['quoteId']))
        self.assert_no_transport()

    async def test_old_queued_batch_cannot_continue_but_can_query_and_stop(self):
        payload, old = await self.persisted_old_quote(True)
        with self.assertRaisesRegex(ValueError, '固定指令已改变'):
            await self.service.continue_batch(payload)
        retained = await self.service.query({'batchId': 'old-batch'})
        self.assertTrue(retained['paused'])
        self.assertEqual(retained['rows'][0]['snapshot'], old)
        self.assertEqual(retained['rows'][0]['status'], 'queued')
        stopped = await self.service.stop({'batchId': 'old-batch', 'leaseId': self.lease['leaseId']})
        self.assertEqual(stopped['rows'][0]['status'], 'stopped')
        self.assertEqual(stopped['rows'][0]['snapshot'], old)
        self.assert_no_transport()

    async def test_advance_rechecks_old_quote_before_creating_worker(self):
        _, old = await self.persisted_old_quote(True)
        # Isolate advance's own version gate from restart's additional pause.
        batch = self.service.batch('old-batch')
        batch['paused'] = False
        self.service.save(batch)
        permit = await self.service.permit({'batchId': 'old-batch', 'requestId': 'old-request',
            'leaseId': self.lease['leaseId'], **{k: old[k] for k in ('snapshotDigest', 'revision', 'requestSeq')}})
        with self.assertRaisesRegex(ValueError, '固定指令已改变'):
            await self.service.advance(permit, {'token': 'local-double-only'})
        retained = await self.service.query({'batchId': 'old-batch'})
        self.assertTrue(retained['paused'])
        self.assertEqual(retained['rows'][0]['snapshot'], old)
        self.assertIsNone(retained['rows'][0]['remoteResponseId'])
        self.assert_no_transport()

    async def test_old_remote_id_recovers_by_get_without_new_post(self):
        _, old = await self.persisted_old_quote(True, remote=True)
        retained = await self.service.query({'batchId': 'old-batch'})
        self.assertTrue(retained['paused'])
        self.assertEqual(retained['rows'][0]['snapshot'], old)
        self.assertEqual(self.service.workers, {})
        await self.service.query({'batchId': 'old-batch'}, {'token': 'local-double-only'})
        await asyncio.gather(*self.service.workers.values())
        recovered = self.service.batch('old-batch')
        row = recovered['rows'][0]
        self.assertEqual((row['status'], row['remoteResponseId']), ('succeeded', 'resp_test'))
        self.assertEqual(row['snapshot'], old)
        self.assertTrue(recovered['paused'])
        self.assertEqual(self.transport.posts, [(old, OLD_INSTRUCTIONS)])
        self.assertEqual(self.transport.gets, ['resp_test'])
        self.assertEqual(set(row['costEvidence']), {'create', 'query'})
        self.assertEqual(row['suggestion']['status'], 'valid')


if __name__ == '__main__':
    unittest.main()
