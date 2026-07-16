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


io_stub = types.SimpleNamespace(ComfyNode=object, NodeOutput=NodeOutputStub)
latest_stub = types.ModuleType("comfy_api.latest")
latest_stub.io = io_stub
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_stub.latest = latest_stub
sys.modules.setdefault("comfy_api", comfy_api_stub)
sys.modules.setdefault("comfy_api.latest", latest_stub)

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

    def execute(self, prompt_value, stored_value):
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


if __name__ == "__main__":
    unittest.main()
