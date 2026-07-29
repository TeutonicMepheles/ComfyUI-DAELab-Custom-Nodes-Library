import importlib.util
import json
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

NODE_PATH = (
    pathlib.Path(__file__).parents[1]
    / "nodes"
    / "boolean_list_hierarchy_get"
    / "node.py"
)
SPEC = importlib.util.spec_from_file_location(
    "boolean_list_hierarchy_get_node",
    NODE_PATH,
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def snapshot(items, output_item_ids, valid=True):
    return json.dumps(
        {
            "version": 1,
            "valid": valid,
            "source_node_id": "7",
            "root_item_id": "root",
            "include_root": True,
            "items": items,
            "output_item_ids": output_item_ids,
        }
    )


class BooleanListHierarchyGetBackendTests(unittest.TestCase):
    def test_returns_selected_branch_values_in_output_order(self):
        config = snapshot(
            [
                {
                    "id": "root",
                    "label": "Root",
                    "value": True,
                    "parent_id": None,
                },
                {
                    "id": "child",
                    "label": "Child",
                    "value": True,
                    "parent_id": "root",
                },
                {
                    "id": "grandchild",
                    "label": "Grandchild",
                    "value": False,
                    "parent_id": "child",
                },
            ],
            ["root", "child", "grandchild"],
        )
        self.assertEqual(
            MODULE._resolve_output_values(config),
            [True, True, False],
        )

    def test_descendants_only_snapshot_can_omit_root_output(self):
        config = snapshot(
            [
                {
                    "id": "root",
                    "label": "Root",
                    "value": True,
                    "parent_id": None,
                },
                {
                    "id": "child",
                    "label": "Child",
                    "value": True,
                    "parent_id": "root",
                },
            ],
            ["child"],
        )
        self.assertEqual(MODULE._resolve_output_values(config), [True])

    def test_backend_reapplies_exclusivity_and_recursive_cascade(self):
        exclusive = snapshot(
            [
                {
                    "id": "root",
                    "label": "Root",
                    "value": True,
                    "parent_id": None,
                },
                {
                    "id": "child",
                    "label": "Child",
                    "value": True,
                    "parent_id": "root",
                },
                {
                    "id": "g1",
                    "label": "G1",
                    "value": True,
                    "parent_id": "child",
                    "exclusive_group_id": "grandchildren",
                },
                {
                    "id": "g2",
                    "label": "G2",
                    "value": True,
                    "parent_id": "child",
                    "exclusive_group_id": "grandchildren",
                },
            ],
            ["root", "child", "g1", "g2"],
        )
        self.assertEqual(
            MODULE._resolve_output_values(exclusive),
            [True, True, True, False],
        )

        disabled = json.loads(exclusive)
        disabled["items"][0]["value"] = False
        self.assertEqual(
            MODULE._resolve_output_values(json.dumps(disabled)),
            [False, False, False, False],
        )

    def test_backend_uses_cross_branch_dependency_context(self):
        config = json.loads(
            snapshot(
                [
                    {
                        "id": "external",
                        "label": "External prerequisite",
                        "value": False,
                        "parent_id": None,
                    },
                    {
                        "id": "selected",
                        "label": "Selected root",
                        "value": True,
                        "parent_id": None,
                        "requires_ids": ["external"],
                    },
                ],
                ["selected"],
            )
        )
        config["version"] = 2
        self.assertEqual(
            MODULE._resolve_output_values(json.dumps(config)),
            [False],
        )

    def test_invalid_binding_preserves_schema_but_forces_false(self):
        config = snapshot([], ["root", "child"], valid=False)
        self.assertEqual(MODULE._resolve_output_values(config), [False, False])

    def test_execute_always_returns_sixty_four_booleans(self):
        result = MODULE.BooleanListHierarchyGet.execute(
            snapshot(
                [
                    {
                        "id": "root",
                        "label": "Root",
                        "value": True,
                        "parent_id": None,
                    }
                ],
                ["root"],
            )
        )
        self.assertEqual(result.args[0], True)
        self.assertEqual(len(result.args), MODULE.MAX_BOOLEAN_OUTPUTS)
        self.assertTrue(all(value is False for value in result.args[1:]))

    def test_registration_ids_are_stable(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["BooleanListHierarchyGet"],
            MODULE.BooleanListHierarchyGet,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["BooleanListHierarchyGet"],
            "Boolean List Hierarchy Get",
        )


if __name__ == "__main__":
    unittest.main()
