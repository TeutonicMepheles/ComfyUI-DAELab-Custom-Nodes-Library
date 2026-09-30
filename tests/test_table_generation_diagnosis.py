"""Final and interrupted messages must name the stage without inviting a paid rerun."""
import ast
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge'
spec = importlib.util.spec_from_file_location('recovery', ROOT / 'recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
tree = ast.parse((ROOT / 'table_generation_api.py').read_text('utf-8'))
tree.body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'diagnose', 'interrupted', 'public'}
             or isinstance(n, ast.Assign) and any(getattr(t, 'id', '') == 'STAGE_NAMES' for t in n.targets)]
api = dict(json=json, is_network_error=recovery.is_network_error)
runtime_tree = ast.parse((ROOT / 'runtime.py').read_text('utf-8'))
runtime_tree.body = [n for n in runtime_tree.body if isinstance(n, ast.FunctionDef) and n.name == 'generation_failure_reason']
exec(compile(runtime_tree, 'runtime.py', 'exec'), api)
exec(compile(tree, 'table_generation_api.py', 'exec'), api)


class DiagnosisTests(unittest.TestCase):
    def test_cli_refund_failure_without_remote_json_is_terminal(self):
        reason = '视频生成失败，积分将会在2小时内返还，请稍后重试'
        message, failed = self.diagnose(reason, {'phase': 'submitted_or_uncertain'})
        self.assertTrue(failed)
        self.assertIn(reason, message)
        state = {'requestId': 'r', 'phase': 'needs_recovery', 'error': reason}
        self.assertEqual(api['public'](state)['phase'], 'failed')
        self.assertEqual(state['phase'], 'needs_recovery')

    def test_network_and_generic_errors_are_not_terminal(self):
        for message in ('ECONNRESET', '视频生成失败', 'nodesBatch 写回失败 ECONNRESET'):
            self.assertIsNone(api['generation_failure_reason'](message))

    def diagnose(self, error, record):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'record.json'
            if record is not None:
                path.write_text(json.dumps(record), encoding='utf-8')
            return api['diagnose'](RuntimeError(error), path)

    def test_failed_write_back_names_platform_completion_and_network_code(self):
        message, failed = self.diagnose('Original task has no video yet', {
            'phase': 'submitted_or_uncertain', 'sync_failed': True,
            'error': 'nodesBatch 写回失败 [-1]: read ECONNRESET',
            'remote': {'data': {'taskInfo': {'taskId': 't', 'status': 2}}}})
        self.assertFalse(failed)
        self.assertIn('平台已生成', message)
        self.assertIn('ECONNRESET', message)
        self.assertIn('禁止自动重跑', message)

    def test_frozen_progress_and_unregistered_task(self):
        message, _ = self.diagnose('Original task has no video yet', {
            'phase': 'submitted_or_uncertain', 'remote': {'data': {'taskInfo': {'taskId': 't', 'status': 1, 'progressPercent': 35}}}})
        self.assertIn('35%', message)
        message, _ = self.diagnose('Original task has no video yet', {'phase': 'submitted_or_uncertain', 'remote': {'data': {}}})
        self.assertIn('未登记', message)

    def test_saved_result_is_not_reported_as_lost(self):
        message, failed = self.diagnose('ECONNRESET', {
            'phase': 'generated', 'sync_failed': True,
            'remote': {'data': {'url': ['https://example.invalid/result.png']}}})
        self.assertFalse(failed)
        self.assertIn('结果地址已保存', message)
        self.assertNotIn('重新生成本行', message)

    def test_platform_failure_is_terminal(self):
        message, failed = self.diagnose('rejected', {'phase': 'submitted_or_uncertain',
                                                     'remote': {'data': {'taskInfo': {'failedReason': 'rejected'}}}})
        self.assertTrue(failed)
        self.assertIn('rejected', message)

    def test_preparation_network_error(self):
        message, _ = self.diagnose('fetch failed', {'phase': 'prepare_uncertain'})
        self.assertIn('尚未启用生成', message)

    def test_interrupted_names_stage_and_progress(self):
        self.assertIn('平台生成 35%', api['interrupted']({'stage': 'generating', 'progress': 35}))
        self.assertIn('等待写回', api['interrupted']({'stage': 'writing_back'}))
        self.assertIn('不重复提交', api['interrupted']({}))

    def test_public_exposes_live_fields_only(self):
        state = {'requestId': 'r', 'phase': 'running', 'stage': 'generating', 'progress': 35, 'taskId': 't',
                 'updatedAt': 1, 'input': {'secret': 1}, 'timeline': [], 'errorDetail': 'x'}
        self.assertEqual(set(api['public'](state)), {'requestId', 'phase', 'stage', 'progress', 'taskId', 'updatedAt'})


if __name__ == '__main__':
    unittest.main()
