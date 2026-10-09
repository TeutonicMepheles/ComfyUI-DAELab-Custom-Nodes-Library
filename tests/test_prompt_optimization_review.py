"""PR26 regressions use actual SQLite/quotes/leases and never model endpoints."""
import copy
import tempfile
import unittest
from test_prompt_optimization import Service, Transport, Price, snapshot


class ReviewTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.transport = Transport()
        self.service = self.new_service()

    def new_service(self):
        return Service(self.temp.name, transport=self.transport, deepseek_transport=self.transport,
                       pricing=Price(), models=lambda: ['gpt-4.1-mini'])

    async def asyncTearDown(self):
        self.assertFalse(self.transport.posts)
        self.assertFalse(self.transport.gets)
        self.service.ledger.db.close()
        self.temp.cleanup()

    async def request(self, bid, ids=(0,), scope='cell', model='deepseek-flash'):
        rows = [snapshot(i) for i in ids]
        for row in rows:
            row['model'] = model
        lease = await self.service.lease(dict(target=rows[0]['target'], instanceId='review'))
        quote = await self.service.estimate(dict(rows=rows, model=model))
        target = dict(scope=scope, fieldId='prompt')
        if scope == 'cell':
            target['recordId'] = rows[0]['target']['recordId']
        return dict(batchId=bid, quoteId=quote['quoteId'], range=target,
                    rows=[dict(requestId=f'{bid}-{i}', snapshot=s) for i, s in zip(ids, rows)],
                    leaseId=lease['leaseId'], budgetCredits=quote['budgetUpperCredits']), quote

    def unknown(self, bid):
        batch = self.service.batch(bid)
        batch['rows'][0]['status'] = 'unknown'
        self.service.save(batch)

    async def test_all_unknowns_survive_restart_and_require_full_confirmation(self):
        for bid in ('A', 'B'):
            p, q = await self.request(bid)
            p['acknowledgeUnknownRequestIds'] = [r['requestId'] for r in q['unknownRequests']]
            await self.service.submit(p)
            self.unknown(bid)
        self.service.ledger.db.close()
        self.service = self.new_service()
        recovered = await self.service.query(dict(batchId='B'))
        self.assertEqual({r['requestId'] for r in recovered['unknownRequests']}, {'A-0', 'B-0'})
        p, q = await self.request('C')
        self.assertEqual({r['requestId'] for r in q['unknownRequests']}, {'A-0', 'B-0'})
        for ack in ([], ['A-0'], ['B-0']):
            p['acknowledgeUnknownRequestIds'] = ack
            with self.assertRaisesRegex(ValueError, '全部历史未知'):
                await self.service.submit(p)
        p['acknowledgeUnknownRequestIds'] = ['A-0', 'B-0']
        self.assertEqual((await self.service.submit(p))['batchId'], 'C')

    async def test_new_unknown_after_quote_cannot_be_silently_acknowledged(self):
        p, _ = await self.request('A')
        await self.service.submit(p)
        p, _ = await self.request('B')
        self.unknown('A')
        p['acknowledgeUnknownRequestIds'] = ['A-0']
        with self.assertRaisesRegex(ValueError, '更新估算'):
            await self.service.submit(p)

    async def test_overlap_is_rejected_in_both_directions_and_providers(self):
        for model in ('deepseek-flash', 'gpt-4.1-mini'):
            for first, second in (((0,), (0, 1, 2)), ((0, 1, 2), (0,))):
                with self.subTest(model=model, first=first):
                    prefix = f'{model}-{len(first)}'
                    a, _ = await self.request(prefix, first, 'cell' if len(first) == 1 else 'column', model)
                    await self.service.submit(a)
                    b, _ = await self.request(prefix+'-new', second, 'cell' if len(second) == 1 else 'column', model)
                    with self.assertRaisesRegex(ValueError, '重叠'):
                        await self.service.submit(b)
                    self.assertIsNone(self.service.ledger.get('batch', b['batchId']))
                    await self.service.stop(dict(batchId=a['batchId'], leaseId=a['leaseId']))

    async def test_same_range_reuses_authoritative_batch_but_changed_semantics_conflict(self):
        a, _ = await self.request('A')
        await self.service.submit(a)
        b, _ = await self.request('B')
        result = await self.service.submit(b)
        self.assertTrue(result['reusedExisting'])
        self.assertEqual(result['range'], a['range'])
        self.assertEqual(result['batchId'], 'A')
        c, _ = await self.request('C', model='gpt-4.1-mini')
        with self.assertRaisesRegex(ValueError, '重叠'):
            await self.service.submit(c)
        c, _ = await self.request('D')
        s = c['rows'][0]['snapshot']
        s['revision'] += 1
        q = await self.service.estimate(dict(rows=[s], model=s['model']))
        c.update(quoteId=q['quoteId'], budgetCredits=q['budgetUpperCredits'])
        with self.assertRaisesRegex(ValueError, '重叠'):
            await self.service.submit(c)

    async def test_unknown_scope_does_not_include_other_records(self):
        a, _ = await self.request('A')
        await self.service.submit(a)
        self.unknown('A')
        _, q = await self.request('B', (1,))
        self.assertEqual(q['unknownRequests'], [])
