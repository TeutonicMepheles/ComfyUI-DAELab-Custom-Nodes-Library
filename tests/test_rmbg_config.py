import importlib.util
import pathlib
import sys
import types
import unittest


class NodeOutputStub:
    def __init__(self, *args, **_kwargs):
        self.args = args


class IODescriptorStub:
    def __init__(self, identifier=None, *args, **kwargs):
        self.id = identifier
        self.args = args
        self.kwargs = kwargs


class CustomTypeStub:
    Input = IODescriptorStub
    Output = IODescriptorStub


class ComboTypeStub:
    Input = IODescriptorStub
    Output = IODescriptorStub


class AnyTypeStub:
    Output = IODescriptorStub


class SchemaStub:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


io_stub = types.SimpleNamespace(
    ComfyNode=object,
    NodeOutput=NodeOutputStub,
    AnyType=AnyTypeStub,
    Combo=ComboTypeStub,
    Custom=lambda _io_type: CustomTypeStub,
    Schema=SchemaStub,
)
latest_stub = types.ModuleType("comfy_api.latest")
latest_stub.io = io_stub
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_stub.latest = latest_stub
sys.modules.setdefault("comfy_api", comfy_api_stub)
sys.modules.setdefault("comfy_api.latest", latest_stub)
active_io = sys.modules["comfy_api.latest"].io
active_io.AnyType = AnyTypeStub
active_io.Combo = ComboTypeStub
active_io.Custom = lambda _io_type: CustomTypeStub
active_io.Schema = SchemaStub

NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "rmbg_config" / "node.py"
SPEC = importlib.util.spec_from_file_location("rmbg_config_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RMBGConfigTests(unittest.TestCase):
    def test_background_options_match_mask_extractor(self):
        self.assertEqual(MODULE.BACKGROUND_OPTIONS, ("Alpha", "original", "Color"))

    def test_defaults_match_mask_extractor(self):
        self.assertEqual(MODULE.DEFAULT_BACKGROUND, "Alpha")
        self.assertEqual(MODULE.DEFAULT_BACKGROUND_COLOR, "#FFFFFF")

    def test_execute_passes_values_through_in_output_order(self):
        output = MODULE.RMBGConfig.execute("Color", "#22AACC")

        self.assertEqual(output.args, ("Color", "#22AACC"))

    def test_background_uses_any_output_for_legacy_rmbg_combos(self):
        schema = MODULE.RMBGConfig.define_schema()

        self.assertEqual(schema.outputs[0].id, "background")
        self.assertIsInstance(schema.outputs[0], AnyTypeStub.Output)
        self.assertEqual(schema.outputs[1].id, "background_color")

    def test_node_registration_is_stable(self):
        self.assertIs(MODULE.NODE_CLASS_MAPPINGS["RMBGConfig"], MODULE.RMBGConfig)
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["RMBGConfig"],
            "RMBG Config",
        )


if __name__ == "__main__":
    unittest.main()
