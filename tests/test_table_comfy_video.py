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


if __name__ == '__main__':
    unittest.main()
