"""Verify actual model prompts and isolation without invoking image generation."""
import importlib
import json
import unittest
from unittest.mock import patch
from test_badge_prompt_calls import ROOT, node, run

target = importlib.import_module('badge_calls_test_package.nodes.badge_app_88.target_only')


class LightingExecutor(node.BadgeApp87V1):
    photography_prompt = target.BadgeApp88TargetOnlyV1.photography_prompt


class SideLighting88Tests(unittest.TestCase):
    def test_model_calls_use_side_light_only_for_88_photography(self):
        cases = json.loads((ROOT / 'tests/fixtures/badge87_calls_baseline.json').read_text(encoding='utf-8'))['cases']
        for case in cases:
            request = case['request']
            if request['stage'] not in ('build', 'studio', 'local'):
                continue
            with self.subTest(stage=request['stage']):
                before, _ = run(node, request)
                with patch.object(node, 'BadgeApp87V1', LightingExecutor):
                    after, _ = run(node, request)
                prompts = [c['inputs']['prompt'] for c in after if c['kind'] == 'OpenAIGPTImageNodeV2']
                self.assertTrue(prompts)
                if request['stage'] == 'local':
                    repair = str(target.render('constraints/local_repair_88')).strip()
                    for call in after:
                        if call['kind'] == 'OpenAIGPTImageNodeV2':
                            self.assertIn(repair, call['inputs']['prompt'])
                            call['inputs']['prompt'] = call['inputs']['prompt'].replace('\n\n' + repair, '')
                    self.assertEqual(before, after)
                else:
                    for prompt in prompts:
                        if '仅替换编辑遮罩指定区域的材质' in prompt:
                            self.assertNotIn('8.8 侧光棚拍规则', prompt)
                            continue
                        self.assertIn('8.8 侧光棚拍规则', prompt)
                        self.assertNotIn('统一棚拍规则（本次摄影的最终要求）', prompt)
                    for call in before:
                        if call['kind'] == 'OpenAIGPTImageNodeV2':
                            self.assertNotIn('8.8 侧光棚拍规则', call['inputs']['prompt'])
