import hashlib
import importlib
import json
from pathlib import Path
import sys
import types
import unittest
from badge_prompt_baseline_support import baseline_content

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = types.ModuleType('badge_content_test_package')
PACKAGE.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE.__name__, PACKAGE)
P = importlib.import_module(PACKAGE.__name__ + '.nodes.badge_app_87.prompts')
A = importlib.import_module(PACKAGE.__name__ + '.nodes.badge_app_87.prompt_assembler')


class ContentTests(unittest.TestCase):
    def test_frozen_pre_refactor_prompt_matrix(self):
        fixture = json.loads((ROOT / 'tests/fixtures/badge87_prompt_baseline.json').read_text(encoding='utf-8'))
        for case in fixture['cases']:
            with self.subTest(function=case['function'], arguments=case['arguments']):
                with baseline_content(A):
                    self.assertEqual(getattr(P, case['function'])(**case['arguments']), case['expected'])

    def test_missing_inputs_and_unknown_templates_fail_closed(self):
        with self.assertRaises(ValueError): A.render('references/height')
        with self.assertRaises(ValueError): A.render('../../outside')
        with self.assertRaises(FileNotFoundError): A.render('not-present')
        with self.assertRaises(ValueError): A.assemble('build')

    def test_user_text_is_single_pass_and_optional_fields_match_baseline(self):
        text = '{{product_image_index}} \\n $1 <script>你好</script>'
        self.assertIn(text, P.build_prompt(text, text_only=True))
        self.assertNotIn('用户要求', P.build_prompt('', text_only=True))
        self.assertIn('用户要求：', P.studio_prompt(''))

    def test_final_prompt_has_nested_content_provenance_and_exact_hash(self):
        prompt = P.masked_prompt(P.material_details('rhinestone', {}, {}))
        report = A.describe(prompt)
        self.assertEqual(report['sha256'], hashlib.sha256(prompt.encode()).hexdigest())
        self.assertTrue(any(r.get('template') == 'materials/rhinestone/surface' for r in report['components']))
        self.assertEqual(report['text'], prompt)

    def test_legacy_custom_reference_preserves_historical_rewriting(self):
        text = '原平面稿 原稿底色 原稿背景 偏离原稿 {{literal}}'
        self.assertEqual(A.legacy_uploaded_reference(text), '配色参考图 配色参考图底色 配色参考图背景 偏离配色参考图 {{literal}}')
        base = P.color_finish_prompt('保持原稿底色')
        routed = A.legacy_uploaded_reference(P.color_finish_prompt('保持原稿底色', custom=True))
        self.assertEqual(routed, A.legacy_uploaded_reference(base))

    def test_map_text_matches_existing_shared_node(self):
        old = importlib.import_module(PACKAGE.__name__ + '.nodes.badge_app_workflow.node')
        self.assertEqual(A.render('tasks/color_map'), old.DEFAULT_MAP_PROMPT)


if __name__ == '__main__': unittest.main()
