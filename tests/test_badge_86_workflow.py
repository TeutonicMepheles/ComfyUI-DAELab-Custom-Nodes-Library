import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).parents[3]
WORKFLOW_DIR = ROOT / "user" / "default" / "workflows"
SOURCE_PATH = WORKFLOW_DIR / "#8.4 - Badge Workflow.json"
WORKFLOW_PATH = WORKFLOW_DIR / "#8.6 - Badge Workflow.json"
APP_MODE_MODEL_PATH = (
    ROOT
    / "custom_nodes"
    / "ComfyUI-DAELab-Custom-Nodes-Library"
    / "web"
    / "app_mode_bypass_model.mjs"
)


class Badge86WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
        cls.workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
        cls.source_nodes = {node["id"]: node for node in cls.source["nodes"]}
        cls.nodes = {node["id"]: node for node in cls.workflow["nodes"]}
        cls.links = {link[0]: link for link in cls.workflow["links"]}

    def source_for(self, node_id, input_name):
        node = self.nodes[node_id]
        input_entry = next(entry for entry in node["inputs"] if entry["name"] == input_name)
        link = self.links[input_entry["link"]]
        return self.nodes[link[1]], link[2]

    def test_preserves_saved_upstream_layout_anchors(self):
        expected = {
            10: ([4741.14656360131, 3929.718066556481], [610.03125, 648.15625]),
            49: ([3607.8675425336305, 3223.901640847453], [401.78125, 452]),
            54: ([7018.84444437851, 4792.6890602696485], [587.09375, 638.25]),
            61: ([5091.596141813543, 4775.110736498602], [410, 300]),
            62: ([5541.596141813543, 4775.110736498602], [410, 300]),
            63: ([5091.596141813543, 5125.110736498602], [410, 300]),
            64: ([5541.596141813543, 5125.110736498602], [410, 300]),
            65: ([6001.596141813543, 4775.110736498602], [324.609375, 424.890625]),
            67: ([4587.23599525641, 4818.71280085411], [384.203125, 322.171875]),
        }
        for node_id, (position, size) in expected.items():
            for actual, saved in zip(self.nodes[node_id]["pos"], position):
                self.assertAlmostEqual(actual, saved, places=9, msg=node_id)
            for actual, saved in zip(self.nodes[node_id]["size"], size):
                self.assertAlmostEqual(actual, saved, places=9, msg=node_id)

    def test_replaces_only_the_unmasked_material_gpt(self):
        self.assertNotIn(53, self.nodes)
        channels = [
            node for node in self.nodes.values()
            if node["type"] == "BadgeMaterialRegionGPTChannelV1"
        ]
        self.assertEqual(len(channels), 4)
        self.assertEqual(
            sorted(node["widgets_values"] for node in channels),
            [[1, "high", 4, 16], [2, "high", 4, 16], [3, "high", 4, 16], [4, "high", 4, 16]],
        )
        self.assertEqual(self.nodes[65]["type"], "BadgeMaterialRegionMergeV1")

    def test_material_masks_come_from_flat_art_and_foreground(self):
        flat, flat_slot = self.source_for(49, "images")
        foreground, foreground_slot = self.source_for(49, "foreground_mask")
        self.assertEqual((flat["id"], flat_slot), (67, 0))
        self.assertEqual((foreground["id"], foreground_slot), (67, 2))

        expected_normalize_sources = {
            "base_image": (10, 0),
            "flat_image": (11, 0),
            "height_map": (59, 0),
            "foreground_mask": (58, 0),
        }
        self.assertEqual(self.nodes[67]["type"], "DAELAB.BadgeMaterialCanvasNormalizeV1")
        for input_name, endpoint in expected_normalize_sources.items():
            source, source_slot = self.source_for(67, input_name)
            self.assertEqual((source["id"], source_slot), endpoint, input_name)

        for channel_id in (61, 62, 63, 64):
            expected = {
                "base_image": (10, 0),
                "flat_image": (67, 0),
                "height_map": (67, 1),
                "material_region_set": (49, 8),
            }
            for input_name, endpoint in expected.items():
                source, source_slot = self.source_for(channel_id, input_name)
                self.assertEqual((source["id"], source_slot), endpoint, (channel_id, input_name))

    def test_merge_preserves_the_same_immutable_base(self):
        merge_base, merge_base_slot = self.source_for(65, "base_image")
        self.assertEqual((merge_base["id"], merge_base_slot), (10, 0))
        preview_source, preview_slot = self.source_for(54, "images")
        self.assertEqual((preview_source["id"], preview_slot), (65, 0))
        for slot, channel_id in enumerate((61, 62, 63, 64), start=1):
            for suffix, output_slot in (("image", 0), ("mask", 1), ("status", 2)):
                source, source_slot = self.source_for(65, f"region_{slot}_{suffix}")
                self.assertEqual((source["id"], source_slot), (channel_id, output_slot))

    def test_base_gpt_is_fixed_for_region_only_rerolls(self):
        node = self.nodes[9]
        self.assertEqual(node["widgets_values"][-1], "fixed")
        self.assertEqual(node["widgets_values_named"]["control_after_generate"], "fixed")

    def test_app_mode_contract(self):
        linear_data = self.workflow.get("extra", {}).get("linearData", {})
        self.assertEqual(linear_data.get("outputs"), ["54", "78", "83"])
        self.assertIn(["69", "multi_color_mask_v1_panel"], linear_data.get("inputs", []))
        self.assertIn(["73", "edit_prompt"], linear_data.get("inputs", []))
        self.assertFalse(any(entry[0] in {"70", "71", "72", "74", "75", "76"} for entry in linear_data.get("inputs", [])))
        self.assertIn(["80", "studio_prompt"], linear_data.get("inputs", []))
        self.assertIn(["82", "color_lock_strength"], linear_data.get("inputs", []))
        app_mode_model = APP_MODE_MODEL_PATH.read_text(encoding="utf-8")
        for node_type in (
            "DAELAB.BadgeMaterialCanvasNormalizeV1",
            "DAELabBadgeMaterialRegionV1",
            "BadgeMaterialRegionGPTChannelV1",
            "BadgeMaterialRegionMergeV1",
            "DAELAB.BadgeSemanticRegionGPTChannelV1",
            "DAELAB.BadgeSemanticRegionMergeV1",
            "DAELAB.BadgeStudioBackgroundGPTV1",
            "DAELAB.BadgeStudioColorLockV1",
        ):
            self.assertIn(f'"{node_type}"', app_mode_model)
        self.assertTrue(all(self.nodes[node_id]["mode"] == 0 for node_id in (49, 61, 62, 63, 64, 65, 67)))

    def test_pp_uses_one_flat_mask_one_semantic_channel_and_one_studio_gpt(self):
        self.assertFalse({15, 16, 17, 27, 31, 32, 33, 34, 35, 40, 42, 43, 44} & set(self.nodes))
        self.assertFalse({70, 71, 72, 74, 75, 76, 77} & set(self.nodes))
        mask_source, mask_source_slot = self.source_for(69, "images")
        self.assertEqual((mask_source["id"], mask_source_slot), (67, 0))
        base_source, base_source_slot = self.source_for(73, "base_image")
        foreground_source, foreground_source_slot = self.source_for(73, "foreground_mask")
        region_source, region_source_slot = self.source_for(73, "region_mask")
        self.assertEqual((base_source["id"], base_source_slot), (54, 0))
        self.assertEqual((foreground_source["id"], foreground_source_slot), (67, 2))
        self.assertEqual((region_source["id"], region_source_slot), (69, 0))
        self.assertFalse(self.nodes[73]["widgets_values_named"]["enabled"])
        self.assertIn("edit_prompt", self.nodes[73]["widgets_values_named"])
        studio_source, studio_source_slot = self.source_for(80, "badge_image")
        self.assertEqual((studio_source["id"], studio_source_slot), (73, 0))
        self.assertIn("纯白色", self.nodes[80]["widgets_values_named"]["studio_prompt"])

    def test_final_color_lock_uses_flat_art_and_never_uses_gpt_subject_pixels(self):
        expected = {
            "editable_master": (73, 0),
            "studio_candidate": (80, 0),
            "flat_image": (67, 0),
            "foreground_mask": (67, 2),
        }
        for input_name, endpoint in expected.items():
            source, source_slot = self.source_for(82, input_name)
            self.assertEqual((source["id"], source_slot), endpoint)
        final_source, final_source_slot = self.source_for(83, "images")
        self.assertEqual((final_source["id"], final_source_slot), (82, 0))

    def test_links_are_complete_and_bidirectional(self):
        self.assertEqual(list(self.links), list(range(1, self.workflow["last_link_id"] + 1)))
        for link_id, source, source_slot, target, target_slot, _ in self.workflow["links"]:
            self.assertIn(link_id, self.nodes[source]["outputs"][source_slot].get("links") or [])
            self.assertEqual(self.nodes[target]["inputs"][target_slot]["link"], link_id)


if __name__ == "__main__":
    unittest.main()
