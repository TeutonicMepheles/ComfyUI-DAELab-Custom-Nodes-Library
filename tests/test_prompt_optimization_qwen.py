"""Local batch jobs share the durable protocol without acquiring cloud auth."""
import asyncio
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('qwen_helpers', Path(__file__).with_name('test_prompt_optimization.py'))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
from promptopt.pricing import QWEN_MODEL


class LocalDouble:
    def __init__(self): self.calls = []; self.ready = True; self.output = '清晰而简洁的画面。'
    async def available(self): return self.ready, '' if self.ready else '本地服务未启动'
    async def create(self, snapshot, instructions, auth):
        self.calls.append((snapshot, instructions, auth))
        return {'id': 'qwen_fixture', 'status': 'completed', 'usage': {'prompt_tokens': 20, 'completion_tokens': 8},
                'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': self.output}]}]}, {'provider': 'qwen'}


class QwenBatchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.local = LocalDouble(); self.native = h.Transport()
        self.service = h.Service(self.temp.name, qwen_transport=self.local, transport=self.native, pricing=h.Price(), models=lambda: [])
    async def asyncTearDown(self):
        await asyncio.gather(*self.service.workers.values(), return_exceptions=True)
        self.service.ledger.db.close(); self.temp.cleanup()
    async def prepare(self):
        s = h.snapshot(); s['model'] = QWEN_MODEL
        lease = await self.service.lease({'target': s['target'], 'instanceId': 'local-view'})
        quote = await self.service.estimate({'rows': [s], 'model': QWEN_MODEL})
        self.assertEqual((quote['provider'], quote['currency'], quote['budgetUpperCredits']), ('qwen', 'local', 0))
        await self.service.submit({'batchId': 'batch', 'quoteId': quote['quoteId'], 'budgetCredits': 0, 'leaseId': lease['leaseId'],
            'range': {'scope': 'column', 'fieldId': s['target']['fieldId']}, 'rows': [{'requestId': 'row', 'snapshot': s}]})
        return await self.service.permit({'batchId': 'batch', 'requestId': 'row', 'leaseId': lease['leaseId'],
            **{key: s[key] for key in ('snapshotDigest', 'revision', 'requestSeq')}})
    async def test_local_result_uses_no_credentials_and_recovers_without_resubmit(self):
        permit = await self.prepare()
        await self.service.advance(dict(permit, provider='qwen'), {'deepseekKey': 'secret', 'token': 'secret'})
        await asyncio.gather(*self.service.workers.values())
        row = (await self.service.query({'batchId': 'batch'}))['rows'][0]
        self.assertEqual(row['status'], 'succeeded'); self.assertEqual(row['suggestion']['status'], 'valid')
        self.assertEqual(self.local.calls[0][2], {}); self.assertFalse(self.native.posts); self.assertFalse(self.native.gets)
        self.assertNotIn('usageCostUSD', row); self.assertIsNone(row['actualCredits'])
        self.service.ledger.db.close()
        self.service = h.Service(self.temp.name, qwen_transport=self.local)
        recovered = await self.service.query({'batchId': 'batch'})
        self.assertEqual(recovered['rows'][0], row); self.assertEqual(len(self.local.calls), 1)
    async def test_missing_local_service_fails_before_quote_or_job(self):
        self.local.ready = False
        self.assertEqual((await self.service.estimate({'model': QWEN_MODEL, 'rows': []}))['status'], 'unavailable')
        self.assertFalse(self.local.calls); self.assertEqual(self.service.ledger.all('batch'), [])
    async def test_reserved_reference_forgery_is_never_applicable(self):
        self.local.output = '未知引用 ⟦DAE_REF_fake_0001⟧'
        permit = await self.prepare(); await self.service.advance(permit)
        await asyncio.gather(*self.service.workers.values())
        row = (await self.service.query({'batchId': 'batch'}))['rows'][0]
        self.assertEqual(row['suggestion']['status'], 'invalid')
