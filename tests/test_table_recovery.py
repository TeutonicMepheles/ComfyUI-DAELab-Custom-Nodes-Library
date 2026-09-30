import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).resolve().parents[1] / 'nodes/libtv_bridge/recovery.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class RecoveryTests(unittest.TestCase):
    def run_case(self, phase, errors, task=None, delays=(5,10), **extra):
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / 'job.json'
            record.write_text(json.dumps({'phase':phase, 'remote':{'data':{'taskInfo':task or {}}}, **extra}))
            calls, waits, messages = [], [], []
            def generate():
                calls.append(1)
                if errors:
                    raise RuntimeError(errors.pop(0))
                return 'video'
            result = r.recover_generation(generate, record, messages.append, sleep=waits.append, delays=delays)
            return result, calls, waits, messages

    def test_unrecoverable_write_back_stops_after_few_queries(self):
        pending = 'Original task has no video yet'
        for task, extra in [({'taskId':'t','status':2,'progressPercent':100}, {}),
                            ({'taskId':'t','status':1}, {'sync_failed':True}),
                            ({}, {})]:
            errors = [pending] * 10
            with self.assertRaises(RuntimeError):
                self.run_case('submitted_or_uncertain', errors, task, delays=(1,)*8, **extra)
            self.assertEqual(len(errors), 10 - r.HOPELESS_ATTEMPTS)

    def test_live_platform_task_keeps_full_schedule_with_progress_message(self):
        errors = ['Original task has no video yet'] * 3
        _, calls, waits, messages = self.run_case('submitted_or_uncertain', errors,
                                                  {'taskId':'t','status':1,'progressPercent':35}, delays=(1,)*8)
        self.assertEqual(len(calls), 4)
        self.assertIn('35%', messages[0])
        self.assertIn('第 1 次', messages[0])

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
