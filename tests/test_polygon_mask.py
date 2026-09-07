import importlib.util
import json
import pathlib
import sys
import types
import unittest

import torch


class NodeOutputStub:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


class PortStub:
    @classmethod
    def Input(cls, name, **options):
        return {"direction": "input", "type": cls.__name__, "name": name, "options": options}

    @classmethod
    def Output(cls, **options):
        return {"direction": "output", "type": cls.__name__, "options": options}


class ImageStub(PortStub):
    pass


class IntStub(PortStub):
    pass


class ColorStub(PortStub):
    pass


class StringStub(PortStub):
    pass


class MaskStub(PortStub):
    pass


hidden_stub = types.SimpleNamespace(unique_id=object(), extra_pnginfo=object())
io_stub = types.SimpleNamespace(
    ComfyNode=object,
    NodeOutput=NodeOutputStub,
    Schema=lambda **values: types.SimpleNamespace(**values),
    Image=ImageStub,
    Int=IntStub,
    Color=ColorStub,
    String=StringStub,
    Mask=MaskStub,
    Hidden=hidden_stub,
)
latest_stub = types.ModuleType("comfy_api.latest")
latest_stub.io = io_stub
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_stub.latest = latest_stub
sys.modules["comfy_api"] = comfy_api_stub
sys.modules["comfy_api.latest"] = latest_stub

NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "polygon_mask" / "node.py"
SPEC = importlib.util.spec_from_file_location("polygon_mask_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def polygon_info(points=None, *, cleared=False):
    return json.dumps(
        {
            "polygons": [] if points is None else [{"points": points}],
            "selectedIndex": 0 if points else -1,
            "cleared": cleared,
        }
    )


def workflow_metadata(value):
    return {
        "workflow": {
            "nodes": [
                {
                    "id": 673,
                    "properties": {"polygon_info": value},
                }
            ]
        }
    }


class PolygonMaskBackendTests(unittest.TestCase):
    def setUp(self):
        self.image = torch.zeros((1, 10, 10, 3), dtype=torch.float32)

    def execute(self, prompt_value, stored_value, text=""):
        MODULE.PolygonMask.hidden = types.SimpleNamespace(
            unique_id=673,
            extra_pnginfo=workflow_metadata(stored_value),
        )
        return MODULE.PolygonMask.execute(
            self.image,
            color="#ff0000",
            fill_opacity=100,
            outline_width=0,
            polygon_data=prompt_value,
            text=text,
        )

    def test_current_prompt_polygon_overrides_stale_workflow_property(self):
        current = polygon_info(
            [
                {"x": 2, "y": 2},
                {"x": 8, "y": 2},
                {"x": 8, "y": 8},
                {"x": 2, "y": 8},
            ]
        )
        stale = polygon_info(
            [
                {"x": 0, "y": 0},
                {"x": 1, "y": 0},
                {"x": 0, "y": 1},
            ]
        )

        result = self.execute(current, stale)
        mask = result.args[1]

        self.assertEqual(mask.shape, (1, 10, 10))
        self.assertEqual(mask.sum().item(), 49.0)
        self.assertEqual(mask[0, 5, 5].item(), 1.0)
        self.assertEqual(mask[0, 0, 0].item(), 0.0)

    def test_schema_appends_multiline_text_without_reordering_existing_outputs(self):
        schema = MODULE.PolygonMask.define_schema()
        text_input = next(item for item in schema.inputs if item.get("name") == "text")

        self.assertTrue(text_input["options"]["multiline"])
        self.assertEqual(
            [item["options"]["display_name"] for item in schema.outputs],
            ["masked_image", "raw_mask", "text"],
        )

    def test_valid_prompt_ignores_invalid_stale_property(self):
        current = polygon_info(
            [
                {"x": 2, "y": 2},
                {"x": 8, "y": 2},
                {"x": 8, "y": 8},
            ]
        )

        resolved = MODULE._resolve_polygon_info(
            current,
            673,
            workflow_metadata("not-json"),
        )

        self.assertEqual(resolved, json.loads(current))

    def test_current_cleared_state_overrides_stale_polygon(self):
        current = polygon_info(cleared=True)
        stale = polygon_info(
            [
                {"x": 2, "y": 2},
                {"x": 8, "y": 2},
                {"x": 8, "y": 8},
                {"x": 2, "y": 8},
            ]
        )

        result = self.execute(current, stale)

        self.assertEqual(result.args[1].sum().item(), 0.0)

    def test_legacy_workflow_property_is_used_without_prompt_data(self):
        stored = json.loads(
            polygon_info(
                [
                    {"x": 2, "y": 2},
                    {"x": 8, "y": 2},
                    {"x": 8, "y": 8},
                ]
            )
        )

        resolved = MODULE._resolve_polygon_info("", 673, workflow_metadata(json.dumps(stored)))

        self.assertEqual(resolved, stored)

    def test_default_polygon_supports_up_to_fifty_vertices(self):
        points = MODULE._default_polygon_points(100, 100, 50)
        clamped_points = MODULE._default_polygon_points(100, 100, 500)

        self.assertEqual(MODULE.MAX_VERTEX_COUNT, 50)
        self.assertEqual(len(points), 50)
        self.assertEqual(len(clamped_points), 50)

    def test_multiline_text_is_passed_through_to_the_string_output(self):
        value = "first line\nsecond line"
        result = self.execute(polygon_info(cleared=True), "", text=value)

        self.assertEqual(result.args[2], value)

    def test_text_changes_the_execution_fingerprint(self):
        MODULE.PolygonMask.hidden = types.SimpleNamespace(
            unique_id=673,
            extra_pnginfo=workflow_metadata(""),
        )
        first = MODULE.PolygonMask.fingerprint_inputs(self.image, text="first")
        second = MODULE.PolygonMask.fingerprint_inputs(self.image, text="second")

        self.assertNotEqual(first, second)

    def test_daelab_alias_reuses_the_polygon_contract(self):
        schema = MODULE.DAELabPolygonMaskV1.define_schema()
        self.assertEqual(schema.node_id, "DAELAB.PolygonMaskV1")
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELAB.PolygonMaskV1"],
            MODULE.DAELabPolygonMaskV1,
        )
        self.assertTrue(issubclass(MODULE.DAELabPolygonMaskV1, MODULE.PolygonMask))


if __name__ == "__main__":
    unittest.main()
