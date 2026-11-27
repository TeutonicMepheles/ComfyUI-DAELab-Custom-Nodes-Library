import json
from pathlib import Path
import tempfile
import unittest

from model_access.adapters import IMAGE_NODE
from model_access.catalog import AccessError, Environment, MODELS_PATH, load_catalog, load_environment
from model_access.consumers import MODEL_WIDGETS, register_consumers
from model_access.runtime import Submission, validate_submission
from model_access.service import ModelAccess, Stage, intersect


MODEL = "gpt-image-2"
SUNBURST = "gpt-image-2.5-sunburst"
BADGE = "DAELAB.BadgeApp87V1"
OLD_BADGE = "DAELAB.BadgeApp88V1"
MARKER = {"version": 1, "build": {"nodeId": 1040, "type": IMAGE_NODE, "widgets": MODEL_WIDGETS}}


def object_info(models=(MODEL, SUNBURST), maximum=8):
    def integer(minimum, maximum, step=1):
        return ["INT", {"min": minimum, "max": maximum, "step": step}]

    def combo(*values):
        return ["COMBO", {"options": list(values)}]

    opts = [{
        "key": key,
        "inputs": {
            "required": {
                "size": combo("auto", "1024x1024", "3840x2160", "Custom"),
                "quality": combo("low", "medium", "high", "max"),
                "background": combo("auto", "opaque"),
                "custom_width": integer(480, 3840, 16), "custom_height": integer(480, 3840, 16),
                "images": ["COMFY_AUTOGROW_V3", {"template": {
                    "input": {"required": {"image": ["IMAGE", {}]}},
                    "names": [f"image_{i}" for i in range(1, 17)],
                }}],
            },
            "optional": {"mask": ["MASK", {}]},
        },
    } for key in models]
    return {
        "output": ["IMAGE"],
        "input": {"required": {
            "model": ["DYNAMIC_COMBO", {"options": opts}], "prompt": ["STRING", {}],
            "n": integer(1, maximum), "seed": integer(0, 2147483647),
        }},
    }


def service(mode="external", info=None, catalog=None):
    info = object_info() if info is None else info
    access = ModelAccess(catalog or load_catalog(), Environment(mode), lambda _: info)
    register_consumers(access)
    return access


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


class ModelDirectoryTests(unittest.TestCase):
    def test_environment_is_snapshotted_and_only_missing_file_defaults_to_external(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "daelab" / "model-access.json"
            path.parent.mkdir()
            default = load_environment(directory)
            self.assertEqual(default.mode, "external")
            for content in ("{", '{"version": 5, "mode": "internal"}', '{"version": 1, "mode": "mixed"}',
                            '{"version": 1, "mode": "external", "mode": "internal"}'):
                path.write_text(content, encoding="utf-8")
                self.assertTrue(load_environment(directory).error)
            path.write_text('{"version": 1, "mode": "internal"}', encoding="utf-8")
            self.assertEqual(load_environment(directory).mode, "internal")
            self.assertEqual(default.mode, "external")

    def test_catalog_configuration_conflicts_and_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "entries").mkdir()
            (root / "catalog.json").write_text('{"version": 1}', encoding="utf-8")
            record = json.loads((MODELS_PATH / "entries" / f"{MODEL}.json").read_text(encoding="utf-8"))
            sample = root / "entries" / "model.json"
            sample.write_text(json.dumps(record), encoding="utf-8")
            self.assertEqual(load_catalog(root).resolve("GPT Image 2")["id"], MODEL)
            second = root / "entries" / "second.json"
            second.write_text(json.dumps(record), encoding="utf-8")
            self.assertIn("重复", load_catalog(root).error)
            record["id"] = record["provider"] = record["label"] = "text-fixture"
            record["aliases"] = []
            record["execution"]["inputs"].pop("mask")
            second.write_text(json.dumps(record), encoding="utf-8")
            self.assertIn("映射不完整", load_catalog(root).errors["second"])

    def test_host_ranges_and_missing_capabilities(self):
        access = service(info=object_info(maximum=2))
        result = access.query("exhibition", "build")
        self.assertEqual(result["models"][0]["parameters"]["count"]["max"], 2)
        self.assertIn("宿主未提供型号", result["unavailable"]["gpt-image-2.5-flare"])
        incomplete = object_info()
        incomplete["input"]["required"]["model"][1]["options"][0]["inputs"]["required"].pop("quality")
        self.assertIn("能力或端口", service(info=incomplete).query("exhibition", "build")["unavailable"][MODEL])
        internal = service("internal").query("exhibition", "build")
        self.assertFalse(internal["models"])
        self.assertIn("内网", internal["unavailable"][MODEL])
        self.assertIn("未登记", self._access_error(access, "unlisted"))

    def _access_error(self, access, value):
        with self.assertRaises(AccessError) as raised:
            access.capability("exhibition", "build", value)
        return str(raised.exception)

    def test_registers_an_independent_text_consumer_and_routes_its_execution(self):
        class TextAdapter:
            def probe(self, model, info, state):
                self.assert_invoked = model["execution"]["route"] == "local-fixture"
                return {"max_tokens": {"max": 6}}

            def compile(self, model, parameters, inputs):
                self.dispatch = (model["provider"], inputs, parameters)
                return {"class_type": "TextFixture", "inputs": {"text": inputs["prompt"], "limit": parameters["max_tokens"]}}

        with tempfile.TemporaryDirectory() as directory:
            entry = {
                "version": 1, "id": "text-v1", "provider": "test-text", "label": "Fixture Text",
                "task": "text", "inputs": {"prompt": "STRING"}, "outputs": {"text": "STRING"},
                "parameters": {"max_tokens": {"type": "integer", "min": 1, "max": 12, "default": 8}},
                "execution": {"adapter": "text-fixture", "route": "local-fixture", "modelField": "engine",
                              "inputs": {"prompt": "text", "max_tokens": "limit"}, "outputs": {"text": "0"}},
                "environment": {"openness": "open", "location": "local", "evidence": "Test-only local adapter"},
            }
            root = Path(directory)
            (root / "entries").mkdir()
            (root / "catalog.json").write_text('{"version": 1}', encoding="utf-8")
            (root / "entries" / "text.json").write_text(json.dumps(entry), encoding="utf-8")
            access = service("internal", catalog=load_catalog(root))
        access.register_consumer("fixture", {"compose": Stage(
            "text", {"prompt": "STRING"}, {"text": "STRING"}, {"max_tokens": "integer"}, ("text-fixture",),
        )})
        self.assertIn("未注册", access.query("fixture", "compose")["unavailable"]["text-v1"])
        adapter = TextAdapter()
        access.register_adapter("text-fixture", adapter)
        self.assertEqual(access.query("fixture", "compose")["models"][0]["id"], "text-v1")
        self.assertFalse(access.query("exhibition", "build")["models"])
        self.assertEqual(access.compile("fixture", "compose", "text-v1", {"max_tokens": 3}, {"prompt": "test"}),
                         {"class_type": "TextFixture", "inputs": {"text": "test", "limit": 3}})
        self.assertTrue(adapter.assert_invoked)
        self.assertEqual(adapter.dispatch, ("test-text", {"prompt": "test"}, {"max_tokens": 3}))
        with self.assertRaises(AccessError):
            access.compile("fixture", "compose", "text-v1", {"max_tokens": 7}, {"prompt": "test"})

    def test_integer_intersection_preserves_both_steps_and_a_valid_default(self):
        rule = {"type": "integer", "min": 3, "max": 100, "step": 6, "default": 9}
        self.assertEqual(intersect(rule, {"min": 1, "max": 90, "step": 8}),
                         {"type": "integer", "min": 9, "max": 90, "step": 24, "default": 9})

    def test_new_entry_matches_compatible_stages_without_workflow_model_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "entries").mkdir()
            (root / "catalog.json").write_text(
                '{"version":1,"preferences":{"badge":{"*":"missing-preferred"}}}', encoding="utf-8"
            )
            record = json.loads((MODELS_PATH / "entries" / f"{MODEL}.json").read_text(encoding="utf-8"))
            record.update(id="future-image", provider="new-provider-key", label="Future Image", aliases=[])
            (root / "entries" / "future-image.json").write_text(json.dumps(record), encoding="utf-8")
            access = service(info=object_info(models=("new-provider-key",)), catalog=load_catalog(root))
            for consumer in ("badge", "exhibition"):
                result = access.query(consumer, "build")
                self.assertEqual(result["defaultModel"], "future-image")
                native = access.compile(consumer, "build", None, {"size": "1024x1024", "count": 4},
                                        {"prompt": "fixture", "references": [["image", 0]]})
                self.assertEqual(result["models"][0]["execution"]["nodeType"], native["class_type"])
                self.assertEqual(native["inputs"]["model"], "new-provider-key")
                self.assertEqual(native["inputs"]["n"], 4)
                with self.assertRaises(AccessError):
                    access.select(consumer, "build", "explicit-unavailable")
            node_graph = {"out": node(BADGE, request_json='{"stage":"build"}')}
            self.assertIsNone(validate_submission(access, node_graph, ("out",), Submission()))


class ModelSubmissionTests(unittest.TestCase):
    def exhibition(self, count=1, **changes):
        inputs = dict(model=MODEL, n=count, seed=3, prompt="test")
        inputs.update({"model.size": "auto", "model.quality": "low", "model.background": "auto",
                       "model.images.image_1": ["1061", 0], "model.images.image_2": ["1056", 0]})
        inputs.update(changes)
        return {
            "1040": node(IMAGE_NODE, **inputs), "out": node("SaveImage", images=["1040", 0]),
            "1061": node("PreviewImage"), "1056": node("PreviewImage"), "other": node("PreviewImage"),
        }

    def check(self, graph, marker=MARKER, mode="external", outputs=("out",)):
        meta = {} if marker is None else {"daelabExhibitionUiV1": marker}
        return validate_submission(service(mode), graph, outputs, Submission(before=meta))

    def test_only_selected_stage_is_checked_and_malformed_marker_cannot_run_it(self):
        self.assertIsNone(self.check(self.exhibition(count=4)))
        self.assertIsNone(self.check(self.exhibition(count=5), outputs=("other",)))
        invalid = self.check(self.exhibition(count=5))
        self.assertEqual(invalid["node_errors"]["1040"]["dependent_outputs"], ["out"])
        self.assertIsNone(self.check(self.exhibition(count=5), marker=None, mode="internal"))
        self.assertIsNotNone(self.check(self.exhibition(), marker={}, mode="external"))
        self.assertIsNotNone(self.check(self.exhibition(), marker={**MARKER, "version": 2}))
        self.assertIsNotNone(self.check(self.exhibition(model="gpt-image-1.5")))
        self.assertIsNotNone(self.check(self.exhibition(), mode="internal"))

    def test_exhibition_reference_order_and_custom_dimensions(self):
        graph = self.exhibition(**{"model.images.image_2": ["1061", 0]})
        self.assertIn("顺序", self.check(graph)["error"]["message"])
        graph = self.exhibition(**{"model.size": "Custom", "model.custom_width": ["size", 0], "model.custom_height": 1024})
        graph["size"] = node("PrimitiveInt", value=1024)
        self.assertIsNone(self.check(graph))
        graph["size"]["inputs"]["value"] = 1025
        self.assertIsNotNone(self.check(graph))
        graph["size"]["class_type"] = "UnknownInt"
        self.assertIn("来源", self.check(graph)["error"]["message"])
        graph["1040"]["inputs"]["model.size"] = "auto"
        self.assertIsNone(self.check(graph))

    def test_separated_exhibition_build_accepts_optional_refs_and_rejects_edit_ancestry(self):
        marker = {**MARKER, "build": {**MARKER["build"], "independentLocalEdit": True}}
        space, element = "model.images.image_1", "model.images.image_2"
        for omitted in ((), (space,), (element,), (space, element)):
            graph = self.exhibition()
            graph["674"] = node("LoadImage", image="room.png")
            graph["1061"]["inputs"]["images"] = ["674", 0]
            for port in omitted:
                del graph["1040"]["inputs"][port]
            self.assertIsNone(self.check(graph, marker=marker))
        self.assertIsNotNone(self.check(graph))
        graph["1040"]["inputs"][space] = ["1061", 0]
        graph["1061"]["inputs"]["images"] = ["1058", 0]
        graph["1058"] = node(IMAGE_NODE, model=MODEL, prompt="old")
        self.assertEqual(set(self.check(graph, marker=marker)["node_errors"]), {"1040", "1058"})
        graph["1061"]["inputs"]["images"] = ["674", 0]
        graph["1040"]["inputs"]["model.images.image_3"] = ["674", 0]
        self.assertIn("参考图", self.check(graph, marker=marker)["error"]["message"])

    def test_badge_enforces_actual_model_and_preserves_local_preview(self):
        params = dict(stage="build", width=1536, height=864, count=4, model=SUNBURST)
        graph = {"out": node(BADGE, request_json=json.dumps(params))}
        self.assertIsNone(self.check(graph, marker=None))
        self.assertIsNotNone(self.check(graph, marker=None, mode="internal"))
        params.update(stage="local", apply=False, model="unknown")
        graph["out"]["inputs"]["request_json"] = json.dumps(params)
        self.assertIsNone(self.check(graph, marker=None, mode="internal"))
        params.update(workflow_version="8.8", edit_mode="region_materials", apply=True)
        graph["out"] = node(OLD_BADGE, request_json=json.dumps(params))
        self.assertIsNone(self.check(graph, marker=None))
        self.assertIsNotNone(self.check(graph, marker=None, mode="internal"))


if __name__ == "__main__":
    unittest.main()
