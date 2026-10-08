"""Provider isolation and durable stateless results. Local doubles only."""
import asyncio
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deepseek_helpers', ROOT / 'tests/test_prompt_optimization.py')
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
from promptopt.deepseek import DeepSeekTransport, ENDPOINT, normalize_response, request_body, safe_usage
from promptopt.pricing import deepseek_price, cost
from promptopt.transport import TransportError
from promptopt import api


def snapshot(index=0):
    s = h.snapshot(index); s['model'] = 'deepseek-flash'; s['snapshotDigest'] = h.digest(s)
    return s


def body(finish='stop'):
    return {'id': 'chat_fixture', 'choices': [{'finish_reason': finish, 'message': {'role': 'assistant', 'content': '精简后的提示词。'}}],
        'usage': {'prompt_tokens': 1500, 'completion_tokens': 25, 'total_tokens': 1525,
            'prompt_cache_hit_tokens': 1400, 'prompt_cache_miss_tokens': 100, 'secret': 'untrusted-value'}}


class DeepDouble:
    def __init__(self): self.auth = []; self.failure = None; self.finish = 'stop'
    async def create(self, snapshot, instructions, auth):
        self.auth.append(copy.deepcopy(auth))
        if self.failure: raise self.failure
        return normalize_response(body(self.finish)), {'provider': 'deepseek', 'currency': 'USD', 'method': 'POST', 'remoteResponseId': 'chat_fixture'}
    async def query(self, *args): raise AssertionError('Stateless provider must never GET')


class DeepSeekServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {'DEEPSEEK_API_KEY': ''}); self.env.start()
        self.temp = tempfile.TemporaryDirectory(); self.native = h.Transport(); self.deep = DeepDouble()
        self.s = self.open()
        self.lease = await self.s.lease({'target': snapshot()['target'], 'instanceId': 'view'})
    def open(self):
        return h.Service(self.temp.name, transport=self.native, pricing=h.Price(), models=lambda: ['gpt-4.1-mini'], deepseek_transport=self.deep)
    async def asyncTearDown(self):
        for task in self.s.workers.values():
            if not task.done(): task.cancel()
        await asyncio.gather(*self.s.workers.values(), return_exceptions=True)
        self.s.ledger.db.close(); self.temp.cleanup(); self.env.stop()
    async def prepare(self, s=None):
        s = s or snapshot()
        quote = await self.s.estimate({'rows': [s], 'model': s['model']})
        batch = await self.s.submit({'batchId': 'batch', 'quoteId': quote['quoteId'], 'budgetCredits': quote['budgetUpperCredits'],
            'leaseId': self.lease['leaseId'], 'range': {'scope': 'cell', 'fieldId': 'prompt', 'recordId': s['target']['recordId']},
            'rows': [{'requestId': 'request', 'snapshot': s}]})
        permit = await self.s.permit({'batchId': 'batch', 'requestId': 'request', 'leaseId': self.lease['leaseId'],
            **{k: s[k] for k in ('snapshotDigest', 'revision', 'requestSeq')}})
        return batch, permit, quote
    async def finish(self):
        await asyncio.gather(*self.s.workers.values())
        return (await self.s.query({'batchId': 'batch'}))['rows'][0]

    async def test_quote_and_capabilities_do_not_call_native_pricing(self):
        class NoPrice:
            calls = 0
            async def get(self, *args):
                self.calls += 1
                raise AssertionError('Native pricing must not be visited')
        self.s.pricing = NoPrice(); self.s.models = lambda: []
        cap = await self.s.capabilities({'model': 'deepseek-flash'})
        self.assertTrue(cap['available']); self.assertFalse(cap['deepseekKeyConfigured'])
        q = await self.s.estimate({'rows': [snapshot()]})
        self.assertEqual((q['provider'], q['currency']), ('deepseek', 'USD'))
        self.assertEqual(q['price']['checkedAt'], '2026-10-08'); self.assertNotIn('fetchedAt', q['price'])
        self.assertEqual(q['price']['input'], .3); self.assertEqual(deepseek_price('deepseek-v4-pro')['output'], 3.96)
        self.assertLess(q['budgetUpperCredits'], .01)
        self.assertEqual(self.s.pricing.calls, 0)
        with patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'dummy-server-key'}):
            self.assertTrue((await self.s.capabilities({'model': 'deepseek-flash'}))['deepseekKeyConfigured'])

    async def test_missing_key_and_wrong_provider_preserve_permit_no_post(self):
        _, p, _ = await self.prepare()
        with self.assertRaisesRegex(ValueError, 'API Key'): await self.s.advance(p, {'token': 'native-secret', 'key': 'native-key'})
        self.assertIn(p['permitId'], self.s.permits)
        with self.assertRaisesRegex(ValueError, '服务商'): await self.s.advance(dict(p, provider='comfy'), {'deepseekKey': 'dummy'})
        self.assertIn(p['permitId'], self.s.permits)
        self.assertEqual(self.s.batch('batch')['rows'][0]['status'], 'preparing')
        self.assertFalse(self.deep.auth); self.assertFalse(self.native.posts)

    async def test_deepseek_result_is_atomic_local_usage_estimate_and_key_free(self):
        batch, p, q = await self.prepare()
        await self.s.advance(dict(p, provider='deepseek'), {'deepseekKey': 'dummy-deep-secret', 'token': 'native-secret', 'key': 'native-key'})
        row = await self.finish()
        self.assertEqual(self.deep.auth, [{'deepseekKey': 'dummy-deep-secret'}]); self.assertFalse(self.native.posts); self.assertFalse(self.native.gets)
        self.assertEqual(row['status'], 'succeeded'); self.assertEqual(row['suggestion']['status'], 'valid')
        self.assertIsNone(row['actualCredits']); self.assertEqual(row['usageCostUSD'], .00048)
        self.assertNotIn('secret', row['usage']); self.assertNotIn('estimatedCostUSD', row)
        saved = '\n'.join(b for b, in self.s.ledger.db.execute('select body from objects'))
        for secret in ('dummy-deep-secret', 'native-secret', 'native-key', 'untrusted-value'): self.assertNotIn(secret, saved)
        self.s.ledger.db.close(); self.s = self.open()
        restored = await self.s.query({'batchId': 'batch'}, {'token': 'native-secret', 'deepseekKey': 'dummy-deep-secret'})
        self.assertEqual(restored['rows'][0], row); self.assertEqual(restored['price'], q['price'])
        self.assertEqual(restored['currency'], 'USD'); self.assertFalse(self.s.workers)

    async def test_server_key_used_only_for_deepseek(self):
        _, p, _ = await self.prepare()
        with patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'dummy-env-key'}): await self.s.advance(p)
        await self.finish(); self.assertEqual(self.deep.auth, [{'deepseekKey': 'dummy-env-key'}])

    async def test_native_worker_never_receives_deepseek_key(self):
        received = []
        original = self.native.create
        async def create(s, instructions, auth): received.append(auth); return await original(s, instructions, auth)
        self.native.create = create
        _, p, q = await self.prepare(h.snapshot())
        await self.s.advance(dict(p, provider='comfy'), {'token': 'native-token', 'deepseekKey': 'dummy-ds'})
        row = await self.finish()
        self.assertEqual(received, [{'token': 'native-token'}]); self.assertEqual(row['actualCredits'], .25)
        self.assertNotIn('usageCostUSD', row); self.assertEqual(q['currency'], 'credits')

    async def test_truncated_completion_retains_usage_but_cannot_apply(self):
        self.deep.finish = 'length'; _, p, _ = await self.prepare()
        await self.s.advance(p, {'deepseekKey': 'dummy'}); row = await self.finish()
        self.assertEqual(row['status'], 'failed'); self.assertEqual(row['suggestion']['status'], 'invalid')
        self.assertIn('usageCostUSD', row); self.assertIsNone(row['actualCredits'])

    async def test_unknown_and_restart_with_remote_id_never_poll_or_resubmit(self):
        self.deep.failure = TransportError('连接中断'); _, p, _ = await self.prepare()
        await self.s.advance(p, {'deepseekKey': 'dummy'}); row = await self.finish()
        self.assertEqual(row['status'], 'unknown'); self.assertIsNone(row['actualCredits'])
        batch = self.s.batch('batch'); batch['rows'][0].update(status='submitted', remoteResponseId='chat_recovered')
        self.s.save(batch); self.s.ledger.db.close(); self.s = self.open()
        result = await self.s.query({'batchId': 'batch'}, {'token': 'native', 'deepseekKey': 'dummy'})
        self.assertEqual(result['rows'][0]['status'], 'unknown'); self.assertFalse(self.s.workers)
        self.assertEqual(len(self.deep.auth), 1); self.assertFalse(self.native.gets)

    async def local_advance(self, permit, headers):
        async def payload(): return dict(permit, contractVersion=1)
        request = SimpleNamespace(remote='127.0.0.1', host='127.0.0.1:8193', headers=headers,
            match_info={'action': 'advance'}, json=payload)
        with patch.object(api, '_service', self.s): return await api.handle(request)

    async def test_local_api_dedicated_key_header_and_missing_key_recovery(self):
        _, p, _ = await self.prepare()
        response = await self.local_advance(p, {})
        self.assertEqual(response.status, 409); self.assertIn('API Key', json.loads(response.text)['error'])
        self.assertIn(p['permitId'], self.s.permits); self.assertFalse(self.s.workers)
        response = await self.local_advance(p, {'X-DAELab-DeepSeek-Key': 'dummy-page-key'})
        self.assertEqual(response.status, 200); self.assertNotIn('dummy-page-key', response.text)
        await self.finish(); self.assertEqual(self.deep.auth, [{'deepseekKey': 'dummy-page-key'}])

    async def test_local_api_never_accepts_deepseek_key_as_native_login(self):
        _, p, _ = await self.prepare(h.snapshot())
        response = await self.local_advance(p, {'X-DAELab-DeepSeek-Key': 'dummy-page-key'})
        self.assertEqual(response.status, 409); self.assertIn('登录 ComfyUI', json.loads(response.text)['error'])
        self.assertIn(p['permitId'], self.s.permits); self.assertFalse(self.s.workers)
        self.assertFalse(self.native.posts); self.assertFalse(self.deep.auth)


class Response:
    def __init__(self, status, value=None): self.status=status; self.value=value or body()
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def json(self): return self.value


class Session:
    def __init__(self, response=None, failure=None): self.response=response; self.failure=failure; self.calls=[]
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    def post(self, url, **kwargs):
        self.calls.append((url,kwargs))
        if self.failure: raise self.failure
        return self.response


class DeepSeekTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_wire_payload_fixed_tls_endpoint_no_redirect_no_native_auth(self):
        s = snapshot(); session=Session(Response(200))
        with patch('promptopt.deepseek.aiohttp.ClientSession', return_value=session) as factory:
            result,evidence=await DeepSeekTransport().create(s,h.INSTRUCTIONS,{'deepseekKey':'dummy-secret','token':'native-token','key':'native-key'})
        self.assertEqual(len(session.calls),1)
        url,kw=session.calls[0];self.assertEqual(url,ENDPOINT);self.assertTrue(url.startswith('https://'))
        self.assertIs(kw['allow_redirects'],False);self.assertNotIn('ssl',kw);self.assertNotIn('connector',factory.call_args.kwargs)
        self.assertEqual(kw['headers'],{'Authorization':'Bearer dummy-secret'})
        self.assertEqual(kw['json'],{'model':'deepseek-flash','messages':[{'role':'system','content':h.INSTRUCTIONS},{'role':'user','content':s['inputText']}], 'thinking':{'type':'disabled'},'max_tokens':1024,'stream':False})
        self.assertNotIn('creditsHeader',evidence);self.assertEqual(result['usage']['prompt_tokens'],1500)

    async def test_http_rejections_and_uncertain_failures_are_sanitized_no_retry(self):
        for status,label,rejected in [(401,'API Key',True),(402,'余额',True),(404,'模型',True),(429,'频繁',True),(307,'结果未知',False),(500,'结果未知',False)]:
            with self.subTest(status=status):
                session=Session(Response(status,{'error':'dummy-secret'}))
                with patch('promptopt.deepseek.aiohttp.ClientSession',return_value=session):
                    with self.assertRaises(TransportError) as caught: await DeepSeekTransport().create(snapshot(),h.INSTRUCTIONS,{'deepseekKey':'dummy-secret'})
                self.assertEqual(len(session.calls),1);self.assertEqual(caught.exception.definitely_rejected,rejected)
                self.assertIn(label,str(caught.exception));self.assertNotIn('dummy-secret',str(caught.exception))
        session=Session(failure=ConnectionError('dummy-secret'))
        with patch('promptopt.deepseek.aiohttp.ClientSession',return_value=session):
            with self.assertRaises(TransportError) as caught: await DeepSeekTransport().create(snapshot(),h.INSTRUCTIONS,{'deepseekKey':'dummy-secret'})
        self.assertEqual(len(session.calls),1);self.assertFalse(caught.exception.definitely_rejected);self.assertNotIn('dummy-secret',str(caught.exception))

    def test_usage_allowlist_and_nonstop_finish_rejected(self):
        self.assertEqual(safe_usage({'prompt_tokens':True,'completion_tokens':-1,'total_tokens':'5','other':'secret'}),{})
        for finish in ('length','content_filter','tool_calls','insufficient_system_resource','aborted',None):
            self.assertEqual(normalize_response(body(finish))['status'],'incomplete')
        self.assertEqual(normalize_response({'id':'chat_x','choices':[]})['status'],'incomplete')
