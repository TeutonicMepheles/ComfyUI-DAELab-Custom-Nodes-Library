"""Comfy-account queue adapter tests. No paid requests or model execution."""
import asyncio
import importlib
import json
import sys
import unittest
from unittest.mock import patch
import test_table_local_qwen as fixtures


class ComfyVideoTests(unittest.TestCase):
    def setUp(self):
        fixtures.QwenTests.setUp(self)
        self.nodes.NODE_CLASS_MAPPINGS.update(dict.fromkeys(
            ('ByteDance2TextToVideoNode', 'ByteDance2FirstLastFrameNode', 'LoadImage', 'SaveVideo')))
        sys.modules.pop(fixtures.PACKAGE + '.table_comfy_video', None)
        self.comfy = importlib.import_module(fixtures.PACKAGE + '.table_comfy_video')
        self.adapter = self.comfy.ComfyVideo({'token': 'ephemeral-test-token'})

    def test_exact_native_model_and_minimum_options(self):
        caps = self.adapter.capabilities('Seedance 2.5')
        self.assertEqual(caps['provider'], 'comfy')
        self.assertEqual(caps['schema']['properties']['duration']['min'], 4)
        graph = self.adapter.build_prompt('orbit', {}, [], 'sample')
        inputs = graph['seedance']['inputs']
        self.assertEqual(graph['seedance']['class_type'], 'ByteDance2TextToVideoNode')
        self.assertEqual((inputs['model'], inputs['model.resolution'], inputs['model.duration']), ('Seedance 2.5', '480p', 4))
        self.assertFalse(inputs['model.generate_audio'])
        self.assertNotIn('LibTV', json.dumps(graph))

    def test_first_last_frame_order_and_prompt_are_preserved(self):
        prompt = importlib.import_module(fixtures.PACKAGE + '.table_generation').StructuredPrompt(
            'orbit @image_1', [{'start': 6, 'end': 14}])
        media = [dict(kind='image', path=str(self.root / name)) for name in ('first.png', 'last.png')]
        graph = self.adapter.build_prompt(prompt, {'seed': 123, 'duration': 4}, media, 'sample')
        inputs = graph['seedance']['inputs']
        self.assertEqual(graph['seedance']['class_type'], 'ByteDance2FirstLastFrameNode')
        self.assertEqual(inputs['first_frame'], ['first_frame', 0])
        self.assertEqual(inputs['last_frame'], ['last_frame', 0])
        self.assertEqual(graph['last_frame']['inputs']['image'], 'last.png')
        self.assertEqual(inputs['model.prompt'], 'orbit')
        self.assertNotIn('model.ratio', inputs)

    def test_invalid_options_and_missing_nodes_fail_before_queue(self):
        for mode, settings, media in [('mixed2video', {}, []), ('frames2video', {}, []),
            ('text2video', {'duration': 3}, []), ('text2video', {'duration': 4.5}, []),
            ('text2video', {'resolution': '4k'}, []), ('text2video', {'autoCompliance': 1}, [])]:
            with self.subTest(mode=mode, settings=settings), self.assertRaises(ValueError):
                self.adapter.validate_request(None, mode, 'orbit', settings, media)
        del self.nodes.NODE_CLASS_MAPPINGS['ByteDance2FirstLastFrameNode']
        with self.assertRaisesRegex(ValueError, '未加载'):
            self.adapter.capabilities('Seedance 2.5')
        self.queue.put.assert_not_called()

    def test_credentials_are_only_in_native_sensitive_queue_slot(self):
        q = importlib.import_module(fixtures.ROOT_PACKAGE + '.prompt_optimization.local_qwen')
        record = dict(promptId='paid-prompt', phase='preparing')
        path = self.root / 'receipt.json'
        with patch.object(q, 'lock_path', return_value=self.root / 'gate.lock'), patch.object(q, '_quarantined', False):
            asyncio.run(self.adapter.enqueue({}, record, path))
        item = self.queue.put.call_args.args[0]
        self.assertEqual(item[5], {'auth_token_comfy_org': 'ephemeral-test-token'})
        self.assertNotIn('ephemeral-test-token', json.dumps(item[:5]))
        self.assertNotIn('ephemeral-test-token', path.read_text())

    def test_missing_auth_never_enqueues(self):
        self.adapter.auth = {}
        with self.assertRaisesRegex(ValueError, '登录 ComfyUI'):
            asyncio.run(self.adapter.enqueue({}, dict(promptId='p'), self.root / 'receipt.json'))
        self.queue.put.assert_not_called()

    def test_recovery_uses_same_prompt_without_paid_resubmission(self):
        fixtures.QwenTests.saved_job(self)
        output = self.root / 'result.mp4'
        output.write_bytes(b'fixture')
        self.queue.get_history.return_value = {'own-prompt': {'outputs': {'save': {'images': [
            dict(filename='result.mp4', subfolder='', type='output')]}}}}
        result = self.adapter.generate('', 'request-id', 'Seedance 2.5', 'text2video', 'orbit', {}, [])
        self.assertEqual(result['file'], str(output))
        self.queue.put.assert_not_called()

    def test_lost_native_task_never_restarts(self):
        fixtures.QwenTests.saved_job(self)
        with self.assertRaisesRegex(RuntimeError, '未重复提交'):
            self.adapter.generate('', 'request-id', 'Seedance 2.5', 'text2video', 'orbit', {}, [])
        self.queue.put.assert_not_called()

    def test_fast_mini_and_h3_keep_exact_model_and_payment_route(self):
        self.nodes.NODE_CLASS_MAPPINGS.update(dict.fromkeys(('MinimaxHailuo03TextToVideoNode',
            'MinimaxHailuo03FirstLastFrameNode', 'MinimaxHailuo03ReferenceNode', 'ByteDance2ReferenceNodeV2')))
        for model in self.comfy.MODELS:
            with self.subTest(model=model):
                adapter = self.comfy.ComfyVideo(model=model)
                caps = adapter.capabilities(model)
                self.assertEqual(caps['provider'], 'comfy')
                adapter.validate_request(None, 'text2video', 'orbit', {}, [])
                graph = adapter.build_prompt('orbit', {}, [], 'exact-model')
                self.assertEqual(graph['seedance']['inputs']['model'], 'MiniMax H3' if model == 'Minimax H3' else model)
                self.assertFalse(graph['seedance']['inputs']['watermark'])
                if model.endswith(('Fast', 'Mini')):
                    for settings in ({'duration': 16}, {'resolution': '1080p'}):
                        with self.assertRaises(ValueError):
                            adapter.validate_request(None, 'text2video', 'orbit', settings, [])
                if model.startswith('Seedance 2.0'):
                    frames = [dict(kind='image', path=str(self.root / 'first.png'))]
                    adapter.validate_request(None, 'singleImage2video', 'orbit', {}, frames)
                    inputs = adapter.build_prompt('orbit', {}, frames, 'frames')['seedance']['inputs']
                    self.assertEqual(inputs['model.ratio'], 'adaptive')
                    self.assertNotIn('model.output_format', inputs)
        self.queue.put.assert_not_called()

    def test_multimodal_reference_order_survives_transport_change(self):
        self.nodes.NODE_CLASS_MAPPINGS['ByteDance2ReferenceNodeV2'] = None
        adapter = self.comfy.ComfyVideo(model='Seedance 2.0 Fast')
        media = [dict(kind=kind, path=str(self.root / name)) for kind, name in
                 [('image', 'a.png'), ('video', 'b.mp4'), ('image', 'c.png'), ('audio', 'd.wav')]]
        adapter.validate_request(None, 'mixed2video', 'orbit', {}, media)
        graph = adapter.build_prompt('orbit', {}, media, 'mixed')
        inputs = graph['seedance']['inputs']
        self.assertEqual(inputs['model.reference_images.image_2'], ['image_2', 0])
        self.assertEqual(inputs['model.reference_videos.video_1'], ['video_1', 0])
        self.assertEqual(inputs['model.reference_audios.audio_1'], ['audio_1', 0])
        self.assertEqual(graph['video_1']['inputs']['file'], 'b.mp4')
        self.assertEqual(graph['image_2']['inputs']['image'], 'c.png')

    def test_legacy_cli_cannot_start_even_read_only_or_internal_commands(self):
        runtime = importlib.import_module(fixtures.PACKAGE + '.runtime')
        with patch.object(runtime.subprocess, 'run') as run, patch.object(runtime.subprocess, 'Popen') as popen:
            cli = runtime.CLI()
            for method in (cli, cli._stream, cli._call_once, cli.refresh_model_catalog):
                with self.assertRaisesRegex(RuntimeError, '已停用'):
                    method('node', '--run')
            run.assert_not_called()
            popen.assert_not_called()


if __name__ == '__main__':
    unittest.main()
