import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge/recovery.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class RecoveryTests(unittest.TestCase):
    def run_case(self, phase, errors, task=None):
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / 'job.json'
            record.write_text(json.dumps({'phase':phase, 'remote':{'data':{'taskInfo':task or {}}}}))
            calls, waits, messages = [], [], []
            def generate():
                calls.append(1)
                if errors:
                    raise RuntimeError(errors.pop(0))
                return 'video'
            result = r.recover_generation(generate, record, messages.append, sleep=waits.append, delays=(5,10))
            return result, calls, waits, messages

    def test_network_then_pending_then_video(self):
        result, calls, waits, messages = self.run_case('submitted_or_uncertain', ['fetch failed ECONNRESET','Original task has no video yet'])
        self.assertEqual(result, 'video')
        self.assertEqual(len(calls), 3)
        self.assertEqual(waits, [5,10])
        self.assertEqual(len(messages), 2)

    def test_download_network_recovers(self):
        self.assertEqual(self.run_case('generated',['ETIMEDOUT'])[0], 'video')

    def test_preparation_and_platform_failure_never_retry(self):
        for phase, error, task in [('prepared','fetch failed',None), ('prepare_uncertain','ECONNRESET',None), ('submitted_or_uncertain','bad model',None), ('submitted_or_uncertain','fetch failed',{'failedReason':'rejected'})]:
            errors=[error, 'sentinel']
            with self.assertRaises(RuntimeError):
                self.run_case(phase, errors, task)
            self.assertEqual(errors, ['sentinel'])

    def test_recovery_is_bounded(self):
        errors=['fetch failed']*4
        with self.assertRaises(RuntimeError):
            self.run_case('submitted_or_uncertain', errors)
        self.assertEqual(len(errors), 1)
