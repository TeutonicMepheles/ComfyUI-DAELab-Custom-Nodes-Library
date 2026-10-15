import asyncio,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock,patch
import test_prompt_optimization_deepseek
from promptopt import local_qwen as q,canvas

class LocalQwenTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.path=Path(self.tmp.name)/'gate.lock'
  self.p=patch.object(q,'lock_path',return_value=self.path);self.p.start();self.addCleanup(self.p.stop)
  q._quarantined=False
  q._server=SimpleNamespace(port=8000,prompt_queue=SimpleNamespace(get_current_queue=lambda:([],[])))
 async def test_gate_rejects_native_submit_during_llm(self):
  handler=AsyncMock()
  async with q.admission():
   response=await q.gpu_middleware(SimpleNamespace(method='POST',path='/prompt'),handler)
  self.assertEqual(response.status,409);handler.assert_not_awaited()
  await q.gpu_middleware(SimpleNamespace(method='POST',path='/prompt'),handler)
  handler.assert_awaited_once()
 async def test_busy_queue_never_calls_model(self):
  q._server.prompt_queue.get_current_queue=lambda:([1],[])
  with patch.object(q,'request',AsyncMock()) as request:
   with self.assertRaisesRegex(ValueError,'生图'):await q.generate('prompt','system')
   request.assert_not_awaited()
 async def test_cancellation_keeps_lease_until_worker_done(self):
  started=asyncio.Event();finish=asyncio.Event()
  async def fake(*args):
   async with q.admission():started.set();await finish.wait()
  with patch.object(q,'_generate',fake):
   task=asyncio.create_task(q.generate('p','s'));await started.wait();task.cancel();await asyncio.sleep(0)
   with self.assertRaises(ValueError):
    async with q.admission():pass
   finish.set()
   with self.assertRaises(asyncio.CancelledError):await task
  async with q.admission():pass
 async def test_failed_unload_blocks_native_and_recovers(self):
  with patch.object(q,'request',AsyncMock(side_effect=RuntimeError('offline'))):
   with self.assertRaises(ValueError):await q.ensure_unloaded()
   response=await q.gpu_middleware(SimpleNamespace(method='POST',path='/prompt'),AsyncMock())
   self.assertEqual(response.status,409)
  self.assertTrue(self.path.with_suffix('.quarantine').exists())
  with patch.object(q,'request',AsyncMock(return_value={'models':[]})):
   await q.ensure_unloaded()
  self.assertFalse(self.path.with_suffix('.quarantine').exists())
 async def test_provider_bound_idempotency(self):
  canvas._results.clear();canvas._busy=asyncio.Lock()
  p=dict(requestId='qwen-request-0000001',mode='polish',model='qwen',source='cat',instruction='keep')
  with patch.object(q,'generate',AsyncMock(return_value={'result':'white cat','model':q.MODEL,'usage':{}})) as call:
   result=await canvas.polish(p);self.assertEqual(result,await canvas.polish(p));self.assertEqual(call.await_count,1)
   with self.assertRaises(ValueError):await canvas.polish(dict(p,model='deepseek'))
