from __future__ import annotations

import asyncio
import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).parents[1]
PACKAGE_DIR = ROOT / "nodes" / "daelab_comfytv_storyboard"


class CustomTypeStub:
    def __init__(self, name):
        self.name = name

    def Output(self, name):
        return (self.name, name)


class NodeOutputStub:
    def __init__(self, *values, ui=None):
        self.values = values
        self.ui = ui


io_stub = types.SimpleNamespace(
    ComfyNode=object,
    Custom=CustomTypeStub,
    NodeOutput=NodeOutputStub,
)
latest_stub = types.ModuleType("comfy_api.latest")
latest_stub.io = io_stub
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_stub.latest = latest_stub
folder_paths_stub = types.ModuleType("folder_paths")
folder_paths_stub.get_temp_directory = lambda: str(ROOT / ".test-temp")

package = types.ModuleType("daelab_storyboard_testpkg")
package.__path__ = [str(PACKAGE_DIR)]
sys.modules.setdefault("daelab_storyboard_testpkg", package)

with mock.patch.dict(sys.modules, {
    "comfy_api": comfy_api_stub,
    "comfy_api.latest": latest_stub,
    "folder_paths": folder_paths_stub,
}):
    spec = importlib.util.spec_from_file_location(
        "daelab_storyboard_testpkg.node", PACKAGE_DIR / "node.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)


class DAELabStoryboardTests(unittest.TestCase):
    def test_registration_uses_isolated_daelab_id(self):
        self.assertEqual(module.NODE_ID, "DAELAB.ComfyTV.GPTImageStoryboardStage")
        self.assertIn(module.NODE_ID, module.NODE_CLASS_MAPPINGS)
        self.assertNotIn("ComfyTV.GPTImageStoryboardStage", module.NODE_CLASS_MAPPINGS)

    def test_rows_drop_voiceover_but_keep_optional_visual_metadata(self):
        rows = module.storyboard_image_rows(json.dumps({"shots": [{
            "shot_no": "01",
            "image_prompt": "浩瀚星空铺开",
            "camera_notes": "",
            "dialogue": "旁白不应被使用",
            "image_url": "/view?filename=ref.png&type=input",
        }]}))
        self.assertEqual(rows, [{
            "shot_no": "01",
            "prompt": "浩瀚星空铺开",
            "camera_notes": "",
            "image_url": "/view?filename=ref.png&type=input",
        }])

    def test_rejects_missing_prompts_and_external_reference_paths(self):
        with self.assertRaisesRegex(ValueError, "missing shot"):
            module.storyboard_image_rows(json.dumps({"shots": [{"prompt": ""}]}))
        with self.assertRaisesRegex(ValueError, "uploaded to ComfyUI"):
            module.storyboard_image_rows(json.dumps({"shots": [{
                "prompt": "画面", "image_url": "C:/outside.png",
            }]}))

    def test_execute_generates_one_image_per_shot_and_forwards_reference(self):
        calls = []

        async def fake_generate(**kwargs):
            calls.append(kwargs)
            return f"/view?filename=shot-{len(calls)}.png&type=output"

        module.DAELabComfyTVGPTImageStoryboardStage.hidden = types.SimpleNamespace(
            unique_id="", auth_token_comfy_org="account-token", api_key_comfy_org=None
        )
        data = json.dumps({"shots": [
            {"image_prompt": "镜头一", "camera_notes": "全景", "image_url": "/view?filename=ref.png&type=input"},
            {"image_prompt": "镜头二", "camera_notes": ""},
        ]})
        with mock.patch.object(module, "generate_gpt_image_2", fake_generate), mock.patch.object(module, "_emit_progress"):
            output = asyncio.run(module.DAELabComfyTVGPTImageStoryboardStage.execute(
                storyboard_data=data, main_prompt="统一水彩风格", selected_index=2
            ))

        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["prompt"], "统一水彩风格\n镜头一\nCamera notes: 全景")
        self.assertEqual(calls[0]["image_url"], "/view?filename=ref.png&type=input")
        self.assertEqual(calls[1]["image_url"], "")
        self.assertEqual(output.values[1], "/view?filename=shot-2.png&type=output")


if __name__ == "__main__":
    unittest.main()
