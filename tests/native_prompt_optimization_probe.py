"""Run manually against the locked core; all HTTP is a loopback fake proxy."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

CORE = Path(sys.argv[1]).resolve()
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CORE))
sys.argv = [sys.argv[0]]
from comfy.cli_args import args
args.cpu = True

spec = importlib.util.spec_from_file_location('promptopt', ROOT / 'nodes/prompt_optimization/__init__.py', submodule_search_locations=[str(ROOT / 'nodes/prompt_optimization')])
module = importlib.util.module_from_spec(spec)
sys.modules['promptopt'] = module
spec.loader.exec_module(module)
from promptopt.transport import NativeTransport, TransportError, native_request, native_context
from promptopt.instructions import INSTRUCTIONS
from comfy_api_nodes.util._helpers import get_comfy_api_headers
from comfy_api_nodes.util import request_logger
from aiohttp import web
import folder_paths


async def main():
    calls, received = [], []
    failure_status = None
    async def fake(request):
        calls.append(request.method)
        assert request.headers['Authorization'] == 'Bearer dummy-probe-secret'
        if request.method == 'POST':
            received.append(await request.json())
            if failure_status:
                return web.json_response({'error': 'fixture transient'}, status=failure_status)
        return web.json_response({'id':'resp_probe','status':'completed','output':[]}, headers={'X-Comfy-Credits-Used':'0.125'})
    app = web.Application()
    app.router.add_route('*','/proxy/openai/v1/responses{tail:.*}',fake)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner,'127.0.0.1',0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    args.comfy_api_base = f'http://127.0.0.1:{port}'
    auth = {'token':'dummy-probe-secret'}
    fixture=json.loads((ROOT/'tests/fixtures/prompt-optimization/requests.json').read_text(encoding='utf-8'))[0]
    snapshot={'model':'gpt-4.1-mini','inputText':fixture['inputText'],'maxOutputTokens':1024}
    with tempfile.TemporaryDirectory() as directory:
        folder_paths.set_temp_directory(directory)
        t = NativeTransport()
        data, receipt = await t.create(snapshot,INSTRUCTIONS,auth)
        assert data['id']=='resp_probe' and receipt['creditsHeader']=='0.125'
        assert 'instructions' not in received[0]
        assert received[0]['input']==[
            {'role':'developer','content':[{'text':INSTRUCTIONS,'type':'input_text'}]},
            {'role':'user','content':[{'text':fixture['inputText'],'type':'input_text'}]}]
        assert received[0]['max_output_tokens']==1024
        await t.query('resp_probe',auth)
        failure_status=503
        try:
            await t.create(snapshot,INSTRUCTIONS,auth)
        except Exception:
            pass
        else:
            raise AssertionError('Expected local 503')
        assert calls==['POST','GET','POST'],calls
        rejections = []
        for status, label in ((401, '登录已过期，请重新登录'), (402, 'ComfyUI 积分不足'),
                              (429, '请求过于频繁，请稍后显式重试')):
            failure_status = status
            before = len(calls)
            try:
                await t.create(snapshot, INSTRUCTIONS, auth)
            except TransportError as error:
                assert error.definitely_rejected, (status, str(error))
                assert str(error) == label, (status, str(error))
            else:
                raise AssertionError(f'Expected local {status}')
            assert calls[before:] == ['POST'], (status, calls[before:])
            rejections.append({'httpStatus': status, 'postCount': 1, 'definitelyRejected': True, 'label': label})
        logs=''.join(p.read_text(encoding='utf-8') for p in Path(directory).rglob('*.log'))
        assert 'dummy-probe-secret' not in logs
        assert '***' in logs
        print(json.dumps({'core':str(CORE),'nativeEndpoint':'/proxy/openai/v1/responses',
            'instructionsExact':True,'inputExact':True,'inputRoles':['developer','user'],
            'topLevelInstructionsAbsent':True,'postRetryCount':0,'getSeparated':True,
            'headerCaptured':True,'logsRedacted':True,'realPaidRequests':0,'loopbackCalls':calls,
            'localRejections':rejections}))
    await runner.cleanup()


asyncio.run(main())
