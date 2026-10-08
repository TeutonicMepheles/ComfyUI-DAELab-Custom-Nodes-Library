"""Shared deterministic fixtures and service result classification; no network."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('promptopt_copy', ROOT / 'nodes/prompt_optimization/__init__.py',
    submodule_search_locations=[str(ROOT / 'nodes/prompt_optimization')])
module = importlib.util.module_from_spec(spec)
sys.modules['promptopt_copy'] = module
spec.loader.exec_module(module)
from promptopt_copy.context_copy import context_copy_reason, REASON, VERSION
from promptopt_copy.service import suggestion

FIXTURE = json.loads((ROOT / 'tests/fixtures/prompt-optimization/context-copy-cases.json').read_text(encoding='utf-8'))


class ContextCopyTests(unittest.TestCase):
    def test_shared_cases(self):
        self.assertEqual(FIXTURE['contractVersion'], VERSION)
        for case in FIXTURE['cases']:
            with self.subTest(case=case['id']):
                self.assertEqual(context_copy_reason(case['input'], case['output']),
                                 REASON if case['expectedBlocked'] else None)

    def test_service_rejects_copy_preserves_evidence_and_accepts_safe_cases(self):
        for case in FIXTURE['cases']:
            with self.subTest(case=case['id']):
                response = {'status': 'completed', 'output': [{'type': 'message',
                    'content': [{'type': 'output_text', 'text': case['output']}]}]}
                actual = suggestion(response, {'input': case['input']})
                expected = 'invalid' if case['expectedBlocked'] else (
                    'unchanged' if case['output'] == case['input']['prompt_text'] else 'valid')
                self.assertEqual(actual['status'], expected)
                self.assertEqual(actual['text'], case['output'])
                self.assertEqual(actual['reason'], REASON if case['expectedBlocked'] else '')


if __name__ == '__main__':
    unittest.main()
