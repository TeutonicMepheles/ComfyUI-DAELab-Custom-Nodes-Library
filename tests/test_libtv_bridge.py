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
        with patch.object(r.subprocess, "run", side_effect=[response("finished"), response('{"data":{"url":["video"]}}')]) as run:
            self.assertEqual(r.CLI("libtv")("node", "n", "-p", "p", "--run")["data"]["url"], ["video"])
            self.assertNotIn("--run", run.call_args_list[1].args[0])
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
