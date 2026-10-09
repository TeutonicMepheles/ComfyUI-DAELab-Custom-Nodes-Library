"""Old durable quotes must not authorize new fixed instructions. Local doubles only."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('quote_helpers', ROOT / 'tests/test_prompt_optimization.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


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
        self.service.ledger.db.close()
        self.temp.cleanup()

    async def persisted_old_quote(self, with_batch):
        snapshot = helpers.snapshot()
        quote = await self.service.estimate({'rows': [snapshot]})
        lease = await self.service.lease({'target': snapshot['target'], 'instanceId': 'first'})
        payload = {'quoteId': quote['quoteId'], 'batchId': 'old-batch',
                   'rows': [{'requestId': 'old-request', 'snapshot': snapshot}],
                   'leaseId': lease['leaseId'], 'budgetCredits': quote['budgetUpperCredits'],
                   'range': {'scope': 'cell', 'fieldId': 'prompt', 'recordId': 'row0'}}
        if with_batch:
            await self.service.submit(payload)
        # Seed a ledger from the previous instruction release. Its quote is still
        # live and every other digest/price/budget/lease check can pass.
        old = copy.deepcopy(snapshot)
        old['instructionVersion'] = 'daelab.prompt-opt.v3'
        old['instructionDigest'] = 'a8b481b7eb82fd5eb46ab9c2c5d34bd3f17e1299db8fe2b7f14f9fe63c90d52c'
        old['snapshotDigest'] = helpers.digest({k: v for k, v in old.items() if k != 'snapshotDigest'})
        frozen = self.service.ledger.get('quote', quote['quoteId'])
        frozen.update(rows=[old], snapshotDigest=helpers.digest([old]))
        self.service.ledger.put('quote', quote['quoteId'], frozen)
        if with_batch:
            batch = self.service.batch('old-batch')
            batch['rows'][0]['snapshot'] = old
            self.service.save(batch)
        self.service.ledger.db.close()
        self.service = self.open_service()
        self.lease = await self.service.lease({'target': old['target'], 'instanceId': 'restored'})
        payload['leaseId'] = self.lease['leaseId']
        payload['rows'][0]['snapshot'] = old
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


if __name__ == '__main__':
    unittest.main()
