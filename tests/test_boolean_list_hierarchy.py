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

NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "boolean_list_hierarchy" / "node.py"
SPEC = importlib.util.spec_from_file_location("boolean_list_hierarchy_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BooleanListHierarchyBackendTests(unittest.TestCase):
    def test_legacy_migration_and_parent_cascade(self):
        items = MODULE._normalize_items(
            '[{"label":"A","value":true,"level":0},'
            '{"label":"A child","value":true,"level":1},'
            '{"label":"B","value":false,"level":0}]'
        )
        self.assertEqual(items[1]["parent_id"], items[0]["id"])
        self.assertTrue(items[1]["value"])
        self.assertFalse(items[2]["value"])

    def test_false_parent_forces_child_false_without_changing_other_root(self):
        items = MODULE._normalize_items(
            '[{"id":"a","label":"A","value":true,"parent_id":null},'
            '{"id":"a1","label":"A child","value":true,"parent_id":"a"},'
            '{"id":"b","label":"B","value":false,"parent_id":null},'
            '{"id":"b1","label":"B child","value":true,"parent_id":"b"}]'
        )
        self.assertTrue(items[0]["value"])
        self.assertTrue(items[1]["value"])
        self.assertFalse(items[2]["value"])
        self.assertFalse(items[3]["value"])

    def test_two_child_levels_are_preserved_and_fourth_level_is_promoted(self):
        items = MODULE._normalize_items(
            '[{"id":"root","label":"Root","value":true,"parent_id":null},'
            '{"id":"child","label":"Child","value":true,"parent_id":"root"},'
            '{"id":"grandchild","label":"Grandchild","value":true,"parent_id":"child"},'
            '{"id":"too-deep","label":"Too deep","value":true,'
            '"parent_id":"grandchild"}]'
        )
        self.assertIsNone(items[0]["parent_id"])
        self.assertEqual(items[1]["parent_id"], "root")
        self.assertEqual(items[2]["parent_id"], "child")
        self.assertIsNone(items[3]["parent_id"])
        self.assertEqual(MODULE.MAX_HIERARCHY_DEPTH, 2)

    def test_false_ancestor_cascades_through_all_descendants(self):
        items = MODULE._normalize_items(
            '[{"id":"root","label":"Root","value":false,"parent_id":null},'
            '{"id":"child","label":"Child","value":true,"parent_id":"root"},'
            '{"id":"grandchild","label":"Grandchild","value":true,'
            '"parent_id":"child"}]'
        )
        self.assertEqual(
            [item["value"] for item in items],
            [False, False, False],
        )

    def test_exclusive_group_keeps_first_true_and_allows_all_false(self):
        items = MODULE._normalize_items(
            '[{"id":"a","label":"A","value":true,"parent_id":null,'
            '"exclusive_group_id":"roots"},'
            '{"id":"b","label":"B","value":true,"parent_id":null,'
            '"exclusive_group_id":"roots"},'
            '{"id":"c","label":"C","value":false,"parent_id":null,'
            '"exclusive_group_id":"roots"}]'
        )
        self.assertEqual([item["value"] for item in items], [True, False, False])

        for item in items:
            item["value"] = False
        MODULE._apply_hierarchy_constraints(items)
        self.assertEqual([item["value"] for item in items], [False, False, False])

    def test_invalid_exclusive_groups_are_removed(self):
        items = MODULE._normalize_items(
            '[{"id":"a","label":"A","value":true,"parent_id":null},'
            '{"id":"a1","label":"A1","value":true,"parent_id":"a",'
            '"exclusive_group_id":"cross"},'
            '{"id":"b","label":"B","value":true,"parent_id":null},'
            '{"id":"b1","label":"B1","value":true,"parent_id":"b",'
            '"exclusive_group_id":"cross"},'
            '{"id":"single","label":"Single","value":true,"parent_id":null,'
            '"exclusive_group_id":"one"}]'
        )
        self.assertTrue(
            all(item.get("exclusive_group_id") is None for item in items)
        )

    def test_grandchildren_can_share_an_exclusive_group(self):
        items = MODULE._normalize_items(
            '[{"id":"root","label":"Root","value":true,"parent_id":null},'
            '{"id":"child","label":"Child","value":true,"parent_id":"root"},'
            '{"id":"g1","label":"G1","value":true,"parent_id":"child",'
            '"exclusive_group_id":"grandchildren"},'
            '{"id":"g2","label":"G2","value":true,"parent_id":"child",'
            '"exclusive_group_id":"grandchildren"}]'
        )
        self.assertEqual(
            [item["value"] for item in items],
            [True, True, True, False],
        )

    def test_exclusive_parent_shutdown_cascades_to_its_child(self):
        items = MODULE._normalize_items(
            '[{"id":"a","label":"A","value":true,"parent_id":null,'
            '"exclusive_group_id":"roots"},'
            '{"id":"a1","label":"A1","value":true,"parent_id":"a"},'
            '{"id":"b","label":"B","value":true,"parent_id":null,'
            '"exclusive_group_id":"roots"},'
            '{"id":"b1","label":"B1","value":true,"parent_id":"b"}]'
        )
        self.assertEqual(
            [item["value"] for item in items],
            [True, True, False, False],
        )

    def test_prompt_config_is_authoritative_over_workflow_property(self):
        prompt_config = '[{"id":"prompt","label":"Prompt","value":true,"parent_id":null}]'
        extra_pnginfo = {
            "workflow": {
                "nodes": [
                    {
                        "id": 7,
                        "properties": {
                            "boolean_list_items": '[{"id":"old","label":"Old","value":false,"parent_id":null}]'
                        },
                    }
                ]
            }
        }
        resolved = MODULE._resolve_config_json(prompt_config, extra_pnginfo, 7)
        self.assertEqual(resolved, prompt_config)
        self.assertTrue(MODULE._normalize_items(resolved)[0]["value"])

    def test_legacy_workflow_property_is_used_when_prompt_has_schema_default(self):
        legacy_config = '[{"id":"legacy","label":"Legacy","value":true,"parent_id":null}]'
        extra_pnginfo = {
            "workflow": {
                "nodes": [
                    {
                        "id": "12",
                        "properties": {"boolean_list_items": legacy_config},
                    }
                ]
            }
        }
        resolved = MODULE._resolve_config_json(MODULE.DEFAULT_CONFIG, extra_pnginfo, 12)
        self.assertEqual(resolved, legacy_config)

    def test_execute_outputs_the_prompt_values_in_visible_order(self):
        MODULE.BooleanListHierarchy.hidden = types.SimpleNamespace(
            extra_pnginfo={},
            unique_id="node-1",
        )
        config = (
            '[{"id":"a","label":"A","value":true,"parent_id":null},'
            '{"id":"a1","label":"A child","value":true,"parent_id":"a"},'
            '{"id":"b","label":"B","value":false,"parent_id":null},'
            '{"id":"b1","label":"B child","value":true,"parent_id":"b"}]'
        )
        result = MODULE.BooleanListHierarchy.execute(config)
        self.assertEqual(result.args[:4], (True, True, False, False))
        self.assertEqual(len(result.args), MODULE.MAX_BOOLEAN_OUTPUTS)
        self.assertTrue(all(value is False for value in result.args[4:]))

    def test_execute_enforces_exclusive_group(self):
        MODULE.BooleanListHierarchy.hidden = types.SimpleNamespace(
            extra_pnginfo={},
            unique_id="node-exclusive",
        )
        config = (
            '[{"id":"a","label":"A","value":true,"parent_id":null,'
            '"exclusive_group_id":"roots"},'
            '{"id":"b","label":"B","value":true,"parent_id":null,'
            '"exclusive_group_id":"roots"}]'
        )
        result = MODULE.BooleanListHierarchy.execute(config)
        self.assertEqual(result.args[:2], (True, False))
        self.assertEqual(len(result.args), MODULE.MAX_BOOLEAN_OUTPUTS)


if __name__ == "__main__":
    unittest.main()
