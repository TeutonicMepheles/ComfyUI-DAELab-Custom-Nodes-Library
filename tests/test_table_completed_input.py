"""An old failed workflow can reuse only a verified identical completed result."""
import ast
import json
from pathlib import Path
import tempfile
import unittest


class CompletedInputTests(unittest.TestCase):
    def test_recovery_identity_and_guards(self):
        source = Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge/table_generation_api.py'
        tree = ast.parse(source.read_text('utf-8'))
        tree.body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'reuse_completed_input']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved = []
            api = dict(json=json, paths=lambda: (root, root),
                       receipt_path=lambda key: root / (key + '.json'),
                       check_result=lambda s: dict(s, phase='needs_recovery') if s.get('missing') else s,
                       atomic_json=lambda p, s: saved.append((p, s)))
            exec(compile(tree, str(source), 'exec'), api)
            reuse = api['reuse_completed_input']
            old = dict(requestId='old', fingerprint='same', phase='needs_recovery')
            (root / 'input-same.json').write_text(json.dumps({'requestId': 'latest'}))
            latest = dict(requestId='latest', fingerprint='same', phase='complete', result={'url': 'file'})
            path = root / 'latest.json'
            path.write_text(json.dumps(latest))
            recovered = reuse(old)
            self.assertEqual(recovered['requestId'], 'old')
            self.assertEqual(recovered['executionId'], 'latest')
            self.assertEqual(recovered['result'], latest['result'])
            for phase in ('running', 'waiting', 'complete'):
                current = dict(old, phase=phase)
                self.assertEqual(reuse(current), current)
            for invalid in (dict(latest, missing=True), dict(latest, fingerprint='different'),
                            dict(latest, phase='running')):
                path.write_text(json.dumps(invalid))
                self.assertEqual(reuse(old), old)
            self.assertEqual(len(saved), 1)


if __name__ == '__main__':
    unittest.main()
