import importlib.util
import pathlib
import sys
import types
import unittest
from unittest import mock


class CoreLoadImageStub:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": (["example.png"], {"image_upload": True})}}

    RETURN_TYPES = ("IMAGE", "MASK")
    FUNCTION = "load_image"
    CATEGORY = "image"

    def load_image(self, image):
        return (f"image:{image}", f"mask:{image}")

    @classmethod
    def IS_CHANGED(cls, image):
        return f"changed:{image}"

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        return image == "example.png"


core_nodes_stub = types.ModuleType("nodes")
core_nodes_stub.LoadImage = CoreLoadImageStub

NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "app_mode_load_image" / "node.py"
SPEC = importlib.util.spec_from_file_location("app_mode_load_image_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
with mock.patch.dict(sys.modules, {"nodes": core_nodes_stub}):
    SPEC.loader.exec_module(MODULE)


class AppModeLoadImageTests(unittest.TestCase):
    def test_inherits_native_upload_and_output_contract(self):
        node_class = MODULE.AppModeLoadImage

        self.assertTrue(issubclass(node_class, CoreLoadImageStub))
        self.assertEqual(node_class.INPUT_TYPES(), CoreLoadImageStub.INPUT_TYPES())
        self.assertEqual(node_class.RETURN_TYPES, ("IMAGE", "MASK"))
        self.assertEqual(node_class.FUNCTION, "load_image")

    def test_delegates_loading_caching_and_validation_to_core(self):
        node = MODULE.AppModeLoadImage()

        self.assertEqual(
            node.load_image("example.png"),
            ("image:example.png", "mask:example.png"),
        )
        self.assertEqual(
            MODULE.AppModeLoadImage.IS_CHANGED("example.png"),
            "changed:example.png",
        )
        self.assertTrue(MODULE.AppModeLoadImage.VALIDATE_INPUTS("example.png"))

    def test_registration_and_daelab_category_are_stable(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["AppModeLoadImage"],
            MODULE.AppModeLoadImage,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["AppModeLoadImage"],
            "Load Image (App Mode)",
        )
        self.assertEqual(MODULE.AppModeLoadImage.CATEGORY, "DAELab/Image")


if __name__ == "__main__":
    unittest.main()
