import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import shutil

SPEC = importlib.util.spec_from_file_location("libtv_runtime", Path(__file__).resolve().parents[1] / "nodes/libtv_bridge/runtime.py")
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)

SCHEMA = {"properties": {"duration": {"min": 4, "max": 15}, "resolution": {"enum": ["480p"]},
    "ratio": {"enum": ["16:9"]}, "enableSound": {"enum": ["off", "on"]},
    "modeType": {"items": {"frames2video": [1, 2], "mixed2video": [1, 15]},
                 "mixed2videoConfig": {"imageMax": 9, "videoMax": 3, "audioMax": 3}}},
    "config": {"settings": ["duration", "resolution", "ratio", "enableSound"]}}


class BridgeTests(unittest.TestCase):
    def test_cli_structured_failure_is_preserved(self):
        from unittest.mock import patch
        node = {'data': {'taskInfo': {'failedReason': 'model rejected input'}}}
        finished = r.subprocess.CompletedProcess([], 1, json.dumps(node), '')
        with patch.object(r.CLI, '_stream', return_value=finished):
            with self.assertRaises(r.CLIError) as caught:
                r.CLI('libtv')('node', 'n', '--run')
        self.assertEqual(caught.exception.failure_reason, 'model rejected input')

    def test_terminal_failure_receipt_is_persisted(self):
        reason = '视频生成失败，积分将会在2小时内返还，请稍后重试'
        def run():
            raise r.CLIError(reason, failure_reason=reason)
        bridge, calls, _ = self.run_bridge(run, lambda: {})
        with self.assertRaises(r.CLIError):
            bridge.generate('p', 'r', 'Seedance 2.0', 'text2video', 'hello', {})
        state = json.loads(next(bridge.cache.glob('*.json')).read_text('utf-8'))
        self.assertEqual(state['phase'], 'failed')
        self.assertEqual(state['platform_failure'], reason)
        self.assertEqual(sum('--run' in call for call in calls), 1)
        count = len(calls)
        with self.assertRaises(r.CLIError):
            bridge.generate('p', 'r', 'Seedance 2.0', 'text2video', 'hello', {})
        self.assertEqual(len(calls), count)

    def test_only_non_paid_commands_have_a_timeout(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        response = SimpleNamespace(returncode=0, stdout='{"data":{"url":["result"]}}', stderr='')
        done = r.subprocess.CompletedProcess([], 0, response.stdout, '')
        with patch.object(r.subprocess, 'run', return_value=response) as run, \
                patch.object(r.CLI, '_stream', return_value=done) as stream:
            cli = r.CLI('libtv', timeout=5)
            cli('node', 'n', '-p', 'p')
            self.assertEqual(run.call_args.kwargs['timeout'], 5)
            cli('download', '-n', 'n')
            self.assertEqual(run.call_args.kwargs['timeout'], 900)
            calls = run.call_count
            cli('node', 'n', '-p', 'p', '--run')
            self.assertEqual(run.call_count, calls)
            self.assertEqual(stream.call_count, 1)
        with patch.object(r.subprocess, 'run', side_effect=r.subprocess.TimeoutExpired('libtv', 30)), patch.object(r.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'ETIMEDOUT'):
                r.CLI('libtv')('node', 'n', '-p', 'p')

    def test_run_forwards_progress_lines_before_exit(self):
        import io
        from unittest.mock import patch
        seen = []
        class Process:
            returncode = 0
            stdout = io.StringIO('{"data":{"url":["result"]}}')
            stderr = io.StringIO('[run] task=t1 status=1 progress=35%\n[run] task=t1 status=2 progress=100%\n')
            def wait(self):
                return 0
        with patch.object(r.subprocess, 'Popen', return_value=Process()) as popen:
            result = r.CLI('libtv')('node', 'n', '-p', 'p', '--run', on_stderr=seen.append)
        self.assertEqual(result['data']['url'], ['result'])
        self.assertNotIn('timeout', popen.call_args.kwargs)
        self.assertEqual([r.RUN_PROGRESS.search(line).groups() for line in seen],
                         [('t1', '1', '35'), ('t1', '2', '100')])

    def run_bridge(self, run, query):
        """Drive generate with a fake CLI; returns (bridge, calls, stages)."""
        calls, stages = [], []
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        def cli(*args):
            calls.append(args)
            if args[:2] == ("model", "search"):
                return {"matches": [{"modelKey": "star-video2", "modelName": "Seedance 2.0 VIP"}]}
            if args[0] == "model":
                return {"schema": SCHEMA}
            if args[:2] == ("node", "list"):
                return {"nodes": []}
            if args[:2] == ("node", "create"):
                return {"nodeKey": "remote-node"}
            if args[0] == "download":
                (Path(args[-1]) / "result.mp4").write_bytes(b"video")
                return {"ok": True}
            return run() if "--run" in args else query()
        bridge = r.Bridge(Path(tmp) / "cache", Path(tmp) / "out", cli)
        bridge.inspect_output = lambda directory: (next(directory.glob("*.mp4")), 32, 32)
        bridge.report = lambda stage, **info: stages.append((stage, info.get("progress")))
        return bridge, calls, stages

    def test_stages_follow_platform_progress_until_local_download(self):
        import time
        queried = []
        def run():
            time.sleep(0.2)
            return {"taskId": "t", "data": {"url": ["https://example.invalid/v.mp4"], "taskInfo": {"status": 2}}}
        def query():
            queried.append(1)
            return {"data": {"taskInfo": {"taskId": "t", "status": 1, "progressPercent": 40}}}
        bridge, calls, stages = self.run_bridge(run, query)
        result = bridge.generate("p", "r", "Seedance 2.0", "text2video", "hello", {})
        self.assertEqual(result["phase"], "complete")
        self.assertFalse(queried)
        names = [s for s, _ in stages]
        self.assertEqual(names[:2], ["preparing", "submitting"])
        self.assertEqual(names[-1], "downloading")
        # Watcher reports stop once --run has returned.
        self.assertNotIn("generating", names[names.index("downloading"):])
        self.assertEqual(sum("--run" in c for c in calls), 1)

    def test_only_read_commands_retry_network_failure(self):
        from unittest.mock import patch
        for args, expected in [(('node', 'n', '-p', 'p'), 3),
                               (('node', 'n', '-p', 'p', '--run'), 1),
                               (('node', 'create', 'n'), 1),
                               (('upload', 'n'), 1),
                               (('node', 'n', '-u', 'url=[]'), 1)]:
            with self.subTest(args=args), patch.object(r.CLI, '_call_once', side_effect=RuntimeError('ECONNRESET')) as call, patch.object(r.time, 'sleep'):
                with self.assertRaises(RuntimeError):
                    r.CLI('libtv')(*args)
                self.assertEqual(call.call_count, expected)

    def test_failed_cli_preserves_result_for_recovery(self):
        from unittest.mock import patch
        node = {'nodeKey': 'n', 'data': {'url': ['https://example.invalid/result.png']}}
        finished = r.subprocess.CompletedProcess([], 1, json.dumps(node), 'nodesBatch ECONNRESET')
        with patch.object(r.CLI, '_stream', return_value=finished):
            with self.assertRaises(r.CLIError) as caught:
                r.CLI('libtv')('node', 'n', '--run')
        self.assertEqual(caught.exception.result, node)

    def test_failed_write_back_is_recorded_and_never_rerun(self):
        def run():
            raise RuntimeError("[run] task=t status=2 progress=100%\nnodesBatch 写回失败 [-1]: read ECONNRESET")
        query = lambda: {"data": {"taskInfo": {"taskId": "t", "status": 2, "progressPercent": 100}}}
        bridge, calls, stages = self.run_bridge(run, query)
        with self.assertRaisesRegex(RuntimeError, "nodesBatch"):
            bridge.generate("p", "r", "Seedance 2.0", "text2video", "hello", {})
        record = json.loads(next(bridge.cache.glob("*.json")).read_text("utf-8"))
        self.assertTrue(record["sync_failed"])
        self.assertEqual(record["phase"], "submitted_or_uncertain")
        with self.assertRaisesRegex(RuntimeError, "no video yet"):
            bridge.generate("p", "r", "Seedance 2.0", "text2video", "hello", {})
        self.assertEqual(stages[-1], ("writing_back", 100))
        self.assertEqual(sum("--run" in c for c in calls), 1)

    def test_result_snapshot_recovers_writeback_without_paid_run(self):
        result = {'nodeKey': 'remote-node', 'data': {'url': ['https://example.invalid/v.mp4']}}
        def run():
            raise r.CLIError('nodesBatch ECONNRESET', result)
        bridge, calls, _ = self.run_bridge(run, lambda: result)
        args = ('p', 'r', 'Seedance 2.0', 'text2video', 'hello', {})
        with self.assertRaises(r.CLIError):
            bridge.generate(*args)
        state = json.loads(next(bridge.cache.glob('*.json')).read_text())
        self.assertEqual(state['phase'], 'generated')
        self.assertEqual(state['remote'], result)
        self.assertEqual(bridge.generate(*args)['phase'], 'complete')
        self.assertEqual(sum('--run' in c for c in calls), 1)
        self.assertEqual(sum('-u' in c for c in calls), 1)

    def test_atomic_json_retries_local_permission_error(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'job.json'
            path.write_text('{"phase":"running"}', encoding='utf-8')
            replace = r.os.replace
            calls = []
            def transient(source, target):
                calls.append(source)
                if len(calls) < 3:
                    raise PermissionError(5, 'Access denied')
                replace(source, target)
            with patch.object(r.os, 'replace', side_effect=transient), patch.object(r.time, 'sleep'):
                r.atomic_json(path, {'phase': 'complete'})
            self.assertEqual(json.loads(path.read_text()), {'phase': 'complete'})
            self.assertEqual(len(calls), 3)
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])

    def test_atomic_json_permanent_failure_preserves_receipt(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'job.json'
            path.write_text('{"phase":"running"}', encoding='utf-8')
            with patch.object(r.os, 'replace', side_effect=PermissionError(5, 'Access denied')), patch.object(r.time, 'sleep'):
                with self.assertRaises(PermissionError):
                    r.atomic_json(path, {'phase': 'complete'})
            self.assertEqual(json.loads(path.read_text()), {'phase': 'running'})
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])

    def test_atomic_json_concurrent_writers_use_distinct_temps(self):
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'job.json'
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(lambda i: r.atomic_json(path, {'value': i}), range(40)))
            self.assertIn(json.loads(path.read_text())['value'], range(40))
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])

    def test_create_keeps_node_key_before_link_response(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        output = '{"nodeKey":"created"}\n{"linked":true}'
        with patch.object(r.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=output, stderr="")):
            self.assertEqual(r.CLI("libtv")("node", "create", "demo")["nodeKey"], "created")

    def test_plain_text_cli_success_recovers_without_resubmission(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        response = lambda text: SimpleNamespace(returncode=0, stdout=text, stderr="")
        finished = r.subprocess.CompletedProcess([], 0, "finished", "")
        with patch.object(r.CLI, "_stream", return_value=finished) as stream, \
                patch.object(r.subprocess, "run", return_value=response('{"data":{"url":["video"]}}')) as run:
            self.assertEqual(r.CLI("libtv")("node", "n", "-p", "p", "--run")["data"]["url"], ["video"])
            self.assertEqual(stream.call_count, 1)
            self.assertNotIn("--run", run.call_args.args[0])
        with patch.object(r.subprocess, "run", return_value=response("C:/output/video.mp4")):
            self.assertIn("download_output", r.CLI("libtv")("download", "-n", "n"))

    def test_success_cache_and_download_recovery_do_not_regenerate(self):
        import av
        import numpy as np
        calls = []
        existing_nodes = []
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "fixture.mp4"
            with av.open(str(source), "w") as container:
                stream = container.add_stream("libx264", rate=24)
                stream.width = stream.height = 32
                stream.pix_fmt = "yuv420p"
                frame = av.VideoFrame.from_ndarray(np.zeros((32, 32, 3), dtype=np.uint8), format="rgb24")
                for packet in stream.encode(frame):
                    container.mux(packet)
                for packet in stream.encode():
                    container.mux(packet)
            def cli(*args):
                calls.append(args)
                if args[:2] == ("model", "search"):
                    return {"matches": [{"modelKey": "star-video2", "modelName": "Seedance 2.0 VIP"}]}
                if args[0] == "model":
                    return {"schema": SCHEMA}
                if args[:2] == ("node", "list"):
                    return {"nodes": existing_nodes}
                if args[:2] == ("node", "create"):
                    return {"nodeKey": "node"}
                if args[0] == "download":
                    shutil.copyfile(source, Path(args[-1]) / "result.mp4")
                    return {"ok": True}
                return {"taskId": "task", "data": {"url": ["https://example.invalid/result.mp4"], "taskInfo": {"status": 2}}}
            bridge = r.Bridge(Path(tmp) / "cache", Path(tmp) / "out", cli)
            args = ("p", "r", "Seedance 2.0", "text2video", "hello", {})
            first = bridge.generate(*args)
            self.assertEqual(first["width"], 32)
            self.assertEqual(first["phase"], "complete")
            count = len(calls)
            self.assertEqual(bridge.generate(*args)["sha256"], first["sha256"])
            self.assertEqual(len(calls), count)
            Path(first["file"]).unlink()
            bridge.generate(*args)
            self.assertEqual(sum("--run" in call for call in calls), 1)
            self.assertEqual(sum(call[0] == "download" for call in calls), 2)
            # Preparation recovery also detects a job already submitted on the canvas.
            record = next((Path(tmp) / "cache").glob("*.json"))
            state = json.loads(record.read_text("utf-8"))
            existing_nodes.append({"name": state["node_name"], "id": state.pop("node_key")})
            Path(state.pop("file")).unlink()
            state["phase"] = "prepare_uncertain"
            r.atomic_json(record, state)
            bridge.generate(*args)
            self.assertEqual(sum("--run" in call for call in calls), 1)

    def test_concurrent_request_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lock"
            with r.job_lock(path):
                with self.assertRaises(RuntimeError):
                    with r.job_lock(path):
                        pass
            with r.job_lock(path):
                pass

    def test_five_model_keys_are_distinct(self):
        self.assertEqual(len(r.MODELS), 5)
        self.assertEqual(len(set(r.MODELS.values())), 5)

    def test_reference_markers_preserve_modality_and_order(self):
        media = [{"kind": "image"}, {"kind": "video"}, {"kind": "image"}]
        self.assertEqual(r.reference_prompt("@image_2 follows @video_1", media, ["a", "b", "c"]),
                         "{{Node c}} follows {{Node b}}")
        with self.assertRaisesRegex(ValueError, "no connected asset"):
            r.validate(SCHEMA, "mixed2video", "@image_3", {}, media)

    def test_stream_pretty_and_ndjson(self):
        self.assertEqual(r.json_stream('{\n"a": 1\n}\n{"b":2}\n'), [{"a": 1}, {"b": 2}])

    def test_frames_count_and_media_type(self):
        for media in ([], [{"kind": "video"}], [{"kind": "image"}] * 3):
            with self.assertRaises(ValueError):
                r.validate(SCHEMA, "frames2video", "test", {}, media)
        r.validate(SCHEMA, "frames2video", "test", {}, [{"kind": "image"}] * 2)

    def test_bad_settings_fail_before_upload(self):
        for settings in ({"duration": 3}, {"resolution": "2K"}, {"unknown": 1}):
            with self.assertRaises(ValueError):
                r.validate(SCHEMA, "text2video", "test", settings, [])

    def test_audio_only_and_text_with_media_rejected(self):
        for mode in ("mixed2video", "text2video"):
            with self.assertRaises(ValueError):
                r.validate(SCHEMA, mode, "test", {}, [{"kind": "audio"}])

    def test_uncertain_paid_submission_is_not_repeated(self):
        calls = []
        def cli(*args):
            calls.append(args)
            if args[:2] == ("model", "search"):
                return {"matches": [{"modelKey": "star-video2", "modelName": "Seedance 2.0 VIP"}]}
            if args[0] == "model":
                return {"schema": SCHEMA}
            if args[:2] == ("node", "create"):
                return {"nodeKey": "remote-node"}
            if "--run" in args:
                raise RuntimeError("Connection lost after submit")
            return {"data": {"taskInfo": {"status": 1}}}
        with tempfile.TemporaryDirectory() as tmp:
            bridge = r.Bridge(Path(tmp) / "cache", Path(tmp) / "out", cli)
            args = ("project", "job-1", "Seedance 2.0", "text2video", "hello", {"duration": 4})
            for _ in range(2):
                with self.assertRaises(RuntimeError):
                    bridge.generate(*args)
            self.assertEqual(sum("--run" in call for call in calls), 1)
            with self.assertRaises(ValueError):
                bridge.generate(*args[:-2], "changed", args[-1])
            self.assertEqual(sum("--run" in call for call in calls), 1)

    def test_missing_model_never_substitutes(self):
        with tempfile.TemporaryDirectory() as tmp:
            bridge = r.Bridge(tmp, tmp, lambda *a: {"matches": []})
            with self.assertRaisesRegex(RuntimeError, "no substitute"):
                bridge.generate("p", "r", "Seedance 2.5", "text2video", "test", {})


if __name__ == "__main__":
    unittest.main()
