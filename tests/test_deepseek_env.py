"""Local credential loading; uses dummy keys only, no network."""
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import test_prompt_optimization_deepseek
from promptopt import deepseek


class EnvTests(unittest.TestCase):
    def test_file_and_precedence(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / '.env'
            with patch.object(deepseek, 'ENV_FILE', path), patch.dict(os.environ, {}, clear=True):
                self.assertFalse(deepseek.key_configured())
                path.write_text('\ufeff# local\nDEEPSEEK_API_KEY="dummy-key"\n', encoding='utf-8')
                self.assertEqual(deepseek.resolve_key({}), 'dummy-key')
                self.assertNotIn('DEEPSEEK_API_KEY', os.environ)
                self.assertEqual(deepseek.resolve_key({'deepseekKey': 'page-key'}), 'page-key')
                path.write_text('DEEPSEEK_API_KEY=updated-key # comment\n', encoding='utf-8')
                self.assertEqual(deepseek.resolve_key({}), 'updated-key')
                os.environ['DEEPSEEK_API_KEY'] = 'process-key'
                self.assertEqual(deepseek.resolve_key({}), 'process-key')
                os.environ['DEEPSEEK_API_KEY'] = ''
                self.assertFalse(deepseek.key_configured())


if __name__ == '__main__':
    unittest.main()
