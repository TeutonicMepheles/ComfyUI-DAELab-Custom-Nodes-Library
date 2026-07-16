import importlib.util
import pathlib
import unittest


NODE_PATH = (
    pathlib.Path(__file__).parents[1]
    / "nodes"
    / "boolean_group_bypass_controller"
    / "node.py"
)
SPEC = importlib.util.spec_from_file_location("boolean_group_bypass_controller_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BooleanGroupBypassControllerBackendTests(unittest.TestCase):
    def test_exposes_forced_boolean_input_and_no_outputs(self):
        inputs = MODULE.BooleanGroupBypassController.INPUT_TYPES()
        boolean_input = inputs["required"]["boolean"]
        self.assertEqual(boolean_input[0], "BOOLEAN")
        self.assertTrue(boolean_input[1]["forceInput"])
        self.assertEqual(MODULE.BooleanGroupBypassController.RETURN_TYPES, ())
        self.assertTrue(MODULE.BooleanGroupBypassController.OUTPUT_NODE)

    def test_backend_fallback_is_a_no_op(self):
        node = MODULE.BooleanGroupBypassController()
        self.assertEqual(node.execute(True), ())
        self.assertEqual(node.execute(False), ())

    def test_registration_ids_are_stable(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["BooleanGroupBypassController"],
            MODULE.BooleanGroupBypassController,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["BooleanGroupBypassController"],
            "Boolean Group Bypass Controller",
        )


if __name__ == "__main__":
    unittest.main()
