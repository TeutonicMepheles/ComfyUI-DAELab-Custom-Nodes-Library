import importlib.util
import pathlib
import sys
import types
import unittest


class NodeOutputStub:
    def __init__(self, *args, **_kwargs):
        self.args = args


io_stub = types.SimpleNamespace(ComfyNode=object, NodeOutput=NodeOutputStub)
latest_stub = types.ModuleType("comfy_api.latest")
latest_stub.io = io_stub
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_stub.latest = latest_stub
sys.modules.setdefault("comfy_api", comfy_api_stub)
sys.modules.setdefault("comfy_api.latest", latest_stub)

NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "gpt_image2_config" / "node.py"
SPEC = importlib.util.spec_from_file_location("gpt_image2_config_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GPTImage2ConfigTests(unittest.TestCase):
    def test_options_match_gpt_image_2_presets(self):
        self.assertEqual(
            MODULE.SIZE_OPTIONS,
            (
                "auto",
                "1024x1024",
                "1024x1536",
                "1536x1024",
                "2048x2048",
                "2048x1152",
                "1152x2048",
                "3840x2160",
                "2160x3840",
            ),
        )
        self.assertEqual(MODULE.BACKGROUND_OPTIONS, ("auto", "opaque"))
        self.assertEqual(MODULE.QUALITY_OPTIONS, ("low", "medium", "high"))

    def test_defaults_match_gpt_image_2(self):
        self.assertEqual(MODULE.DEFAULT_SIZE, "auto")
        self.assertEqual(MODULE.DEFAULT_BACKGROUND, "auto")
        self.assertEqual(MODULE.DEFAULT_QUALITY, "low")

    def test_unsupported_custom_and_transparent_options_are_excluded(self):
        self.assertNotIn("Custom", MODULE.SIZE_OPTIONS)
        self.assertNotIn("transparent", MODULE.BACKGROUND_OPTIONS)

    def test_execute_passes_values_through_in_output_order(self):
        output = MODULE.GPTImage2Config.execute("2048x1152", "opaque", "high")

        self.assertEqual(output.args, ("2048x1152", "opaque", "high"))

    def test_node_registration_is_stable(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["GPTImage2Config"],
            MODULE.GPTImage2Config,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["GPTImage2Config"],
            "GPT Image2 Config",
        )


if __name__ == "__main__":
    unittest.main()
