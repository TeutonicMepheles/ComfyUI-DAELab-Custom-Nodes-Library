"""Installed H3 stack selection; no GPU or external requests."""
import importlib
import sys
import unittest
from test_table_local_qwen import QwenTests, PACKAGE


class H3InstalledStackTests(unittest.TestCase):
    def setUp(self):
        QwenTests.setUp(self)
        self.nodes.NODE_CLASS_MAPPINGS['MiniMaxH3ImageToVideo'] = object()
        sys.modules.pop(PACKAGE + '.table_local_video', None)
        self.video = importlib.import_module(PACKAGE + '.table_local_video')
        self.available = set(self.video.MODEL_FILES.values())
        self.folders.get_full_path.side_effect = lambda category, name: name if name in self.available else None
        self.adapter = self.video.LocalVideo()

    def test_original_stack_is_preferred_when_both_exist(self):
        self.available.update(name for names in self.video.MODEL_ALTERNATIVES.values() for name in names)
        self.assertEqual(self.video.installed_model_files(), self.video.MODEL_FILES)

    def test_installed_nvfp4_and_fp16_vae_are_used_by_graph(self):
        self.available.difference_update((self.video.MODEL_FILES['diffusion_models'], self.video.MODEL_FILES['video_vae'], self.video.MODEL_FILES['loras']))
        self.available.update(('MiniMax-H3_FL2VA-NVFP4.safetensors', 'minimax_h3_video_vae_fp16.safetensors'))
        caps = self.adapter.capabilities(self.video.LOCAL_MODEL)
        self.assertFalse(caps['schema']['properties']['turbo']['default'])
        text = importlib.import_module(PACKAGE + '.table_generation').StructuredPrompt('orbit', [])
        graph = self.adapter.build_prompt(text, {'turbo': False}, [], 'test')
        self.assertEqual(graph['model']['inputs']['unet_name'], 'MiniMax-H3_FL2VA-NVFP4.safetensors')
        self.assertEqual(graph['video_vae']['inputs']['vae_name'], 'minimax_h3_video_vae_fp16.safetensors')
        self.assertEqual(graph['schedule']['inputs']['steps'], 20)
        self.assertNotIn('turbo', graph)
        with self.assertRaisesRegex(ValueError, '本地模型文件缺失'):
            self.adapter.check_models(True)

    def test_ref2va_is_never_substituted_for_fl2va(self):
        self.available.discard(self.video.MODEL_FILES['diffusion_models'])
        self.available.add('MiniMax-H3_Ref2VA-NVFP4.safetensors')
        with self.assertRaisesRegex(ValueError, '本地模型文件缺失'):
            self.adapter.check_models(False)


if __name__ == '__main__':
    unittest.main()
