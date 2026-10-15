"""Local preset and native job recovery tests, no GPU/cloud execution."""
import asyncio
import hashlib
import importlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock

ROOT_PACKAGE = 'local_qwen_test_nodes'
root_package = types.ModuleType(ROOT_PACKAGE)
root_package.__path__ = [str(Path(__file__).resolve().parents[1] / 'nodes')]
sys.modules[ROOT_PACKAGE] = root_package
PACKAGE = ROOT_PACKAGE + '.libtv_bridge'
package = types.ModuleType(PACKAGE)
package.__path__ = [str(Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge')]
sys.modules[PACKAGE] = package


class QwenTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        folders = types.ModuleType('folder_paths')
        folders.get_input_directory = folders.get_output_directory = lambda: str(self.root)
        folders.get_full_path = Mock(return_value='installed-model')
        node_module = types.ModuleType('nodes')
        node_module.MAX_RESOLUTION = 16384
        node_module.NODE_CLASS_MAPPINGS = dict.fromkeys(('UNETLoader', 'CLIPLoaderGGUF', 'TextEncodeQwenImage21',
            'QwenImage21Cache', 'VAELoader', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'))
        server = types.ModuleType('server')
        self.queue = Mock()
        self.queue.get_current_queue_volatile.return_value = ([], [])
        self.queue.get_history.return_value = {}
        server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(prompt_queue=self.queue, number=0))
        execution = types.ModuleType('execution')
        execution.validate_prompt = AsyncMock(return_value=(True, None, ['save'], {}))
        self.modules = patch.dict(sys.modules, {'folder_paths': folders, 'nodes': node_module,
                                               'server': server, 'execution': execution})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        for name in ('table_local_execution', 'table_local_image'):
            sys.modules.pop(PACKAGE + '.' + name, None)
        self.image = importlib.import_module(PACKAGE + '.table_local_image')
        self.base = importlib.import_module(PACKAGE + '.table_local_execution')
        self.adapter = self.image.LocalImage()
        self.folders, self.nodes, self.execution = folders, node_module, execution

    def test_native_enqueue_shares_llm_gate_and_resumes_after_release(self):
        q = importlib.import_module(ROOT_PACKAGE + '.prompt_optimization.local_qwen')
        record = dict(promptId='own-prompt', phase='preparing')
        path = self.root / 'gate-job.json'
        async def scenario():
            async with q.admission():
                with self.assertRaisesRegex(self.base.LocalExecutionPaused, '显卡'):
                    await self.adapter.enqueue({}, record, path)
                self.queue.put.assert_not_called()
                self.assertEqual(json.loads(path.read_text())['phase'], 'paused')
                self.assertEqual(self.base.PromptServer.instance.number, 0)
            await self.adapter.enqueue({}, record, path)
            self.queue.put.assert_called_once()
            self.assertEqual(record['phase'], 'queued')
            # Once native work is visible, LLM inference must refuse to start.
            item = self.queue.put.call_args.args[0]
            for queue_state in (([], [item]), ([item], [])):
                self.queue.get_current_queue.return_value = queue_state
                with patch.object(q, 'request', AsyncMock()) as request:
                    with self.assertRaisesRegex(ValueError, '生图'):
                        await q.generate('prompt', 'instruction')
                    request.assert_not_awaited()
        with patch.object(q, 'lock_path', return_value=self.root / 'gate.lock'), \
             patch.object(q, '_quarantined', False), \
             patch.object(q, '_server', self.base.PromptServer.instance):
            asyncio.run(scenario())

    def test_quarantined_native_enqueue_requires_confirmed_unload(self):
        q = importlib.import_module(ROOT_PACKAGE + '.prompt_optimization.local_qwen')
        gate = self.root / 'gate.lock'
        gate.with_suffix('.quarantine').touch()
        record = dict(promptId='own-prompt', phase='preparing')
        path = self.root / 'quarantined-job.json'
        async def scenario():
            with patch.object(q, 'request', AsyncMock(side_effect=RuntimeError('offline'))):
                with self.assertRaisesRegex(self.base.LocalExecutionPaused, '卸载'):
                    await self.adapter.enqueue({}, record, path)
            self.queue.put.assert_not_called()
            self.assertEqual(record['phase'], 'paused')
            with patch.object(q, 'request', AsyncMock(return_value={'models': []})):
                await self.adapter.enqueue({}, record, path)
            self.queue.put.assert_called_once()
            self.assertFalse(gate.with_suffix('.quarantine').exists())
        with patch.object(q, 'lock_path', return_value=gate), patch.object(q, '_quarantined', False):
            asyncio.run(scenario())

    def test_pause_during_unload_never_enqueues_and_releases_gate(self):
        q = importlib.import_module(ROOT_PACKAGE + '.prompt_optimization.local_qwen')
        async def unload():
            self.adapter.pause_requested.set()
        async def scenario():
            with self.assertRaises(self.base.LocalExecutionPaused):
                await self.adapter.enqueue({}, dict(promptId='own-prompt'), self.root / 'paused.json')
            self.queue.put.assert_not_called()
            async with q.admission():
                pass
        with patch.object(q, 'lock_path', return_value=self.root / 'gate.lock'), \
             patch.object(q, '_quarantined', True), patch.object(q, 'ensure_unloaded', unload):
            asyncio.run(scenario())

    def test_exact_installed_graph_and_safe_budget(self):
        graph = self.adapter.build_prompt('a blue ceramic cup', {'seed': 42}, [], 'sample')
        self.assertEqual(graph['model']['inputs']['unet_name'], self.image.MODEL_FILES['diffusion_models'])
        self.assertEqual(graph['clip']['inputs'], dict(clip_name=self.image.MODEL_FILES['text_encoders'], type='qwen_image'))
        self.assertEqual(graph['condition']['inputs']['images'], {})
        self.assertEqual(graph['latent']['inputs'], dict(width=1024, height=1024, batch_size=1))
        sampler = graph['sample']['inputs']
        self.assertEqual((sampler['seed'], sampler['steps'], sampler['cfg'], sampler['sampler_name'], sampler['scheduler']),
                         (42, 8, 1, 'euler', 'simple'))
        self.assertEqual(graph['save']['class_type'], 'SaveImage')
        caps = self.adapter.capabilities(self.image.LOCAL_IMAGE_MODEL)
        self.assertEqual(caps['schema']['properties']['modeType']['items'], {'text2image': [0, 0]})
        self.assertTrue(caps['local'])

    def test_rejects_references_unsupported_settings_and_oversized_images(self):
        for mode, prompt, settings, media in [
            ('image2image', 'p', {}, []), ('text2image', 'p', {}, [{'kind': 'image'}]),
            ('text2image', ' ', {}, []), ('text2image', 'p', {'steps': 30}, []),
            ('text2image', 'p', {'width': 1000}, []), ('text2image', 'p', {'height': True}, []),
            ('text2image', 'p', {'seed': float('nan')}, []),
            ('text2image', 'p', {'width': 2048, 'height': 2048}, []),
        ]:
            with self.subTest(settings=settings, mode=mode, media=media), self.assertRaises(ValueError):
                self.adapter.validate_request(None, mode, prompt, settings, media)

    def test_dependencies_are_checked_before_queueing(self):
        self.folders.get_full_path.side_effect = lambda category, name: None if name.startswith('mmproj') else 'ok'
        with self.assertRaisesRegex(ValueError, 'mmproj'):
            self.adapter.capabilities(self.image.LOCAL_IMAGE_MODEL)
        self.folders.get_full_path.side_effect = None
        del self.nodes.NODE_CLASS_MAPPINGS['CLIPLoaderGGUF']
        with self.assertRaisesRegex(ValueError, 'CLIPLoaderGGUF'):
            self.adapter.capabilities(self.image.LOCAL_IMAGE_MODEL)
        self.queue.put.assert_not_called()

    def saved_job(self, **record):
        key = hashlib.sha256(b'\nrequest-id').hexdigest()[:24]
        path = self.adapter.cache / (key + '.json')
        path.write_text(json.dumps(dict(promptId='own-prompt', phase='queued', **record)), encoding='utf-8')
        return path

    def generate(self):
        return self.adapter.generate('', 'request-id', self.image.LOCAL_IMAGE_MODEL, 'text2image', 'p', {}, [])

    def test_recovery_uses_original_history_and_does_not_enqueue_again(self):
        self.saved_job()
        output = self.root / 'result.png'
        output.write_bytes(b'fake png')
        self.queue.get_history.return_value = {'own-prompt': {'outputs': {'save': {'images': [
            dict(filename='result.png', subfolder='', type='output')]}}}}
        self.assertEqual(self.generate()['file'], str(output))
        self.assertEqual(self.generate()['file'], str(output))
        self.queue.put.assert_not_called()

    def test_missing_history_and_deleted_result_never_regenerate(self):
        self.saved_job()
        with self.assertRaisesRegex(RuntimeError, '未重复提交'):
            self.generate()
        self.saved_job(result={'file': str(self.root / 'missing.png')})
        with self.assertRaises(self.base.LocalExecutionFailure):
            self.generate()
        self.queue.put.assert_not_called()

    def test_pause_targets_only_own_prompt_and_skips_enqueue(self):
        self.adapter.prompt_id = 'own-prompt'
        self.queue.delete_queue_item.return_value = False
        self.adapter.pause()
        predicate = self.queue.delete_queue_item.call_args.args[0]
        self.assertTrue(predicate((0, 'own-prompt')))
        self.assertFalse(predicate((0, 'other-session')))
        self.queue.interrupt_if_running.assert_called_once_with('own-prompt')
        with self.assertRaises(self.base.LocalExecutionPaused):
            asyncio.run(self.adapter.enqueue({}, {'promptId': 'own-prompt'}, self.root / 'pause.json'))
        self.queue.put.assert_not_called()

    def test_invalid_native_graph_is_terminal_before_submission(self):
        self.execution.validate_prompt.return_value = (False, {'error': 'missing input'}, [], {})
        with self.assertRaises(self.base.LocalExecutionFailure):
            asyncio.run(self.adapter.enqueue({}, {'promptId': 'own-prompt'}, self.root / 'invalid.json'))
        self.queue.put.assert_not_called()
