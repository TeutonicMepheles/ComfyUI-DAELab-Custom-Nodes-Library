import json
import pathlib
import unittest


WORKFLOW_PATH = pathlib.Path(__file__).parents[3] / "user" / "default" / "workflows" / "#8.4 - Badge Workflow.json"


class Badge84WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
        cls.nodes = {node["id"]: node for node in cls.workflow["nodes"]}
        cls.links = {link[0]: link for link in cls.workflow["links"]}

    def source_for(self, node_id, input_name):
        node = self.nodes[node_id]
        input_entry = next(entry for entry in node["inputs"] if entry["name"] == input_name)
        link = self.links[input_entry["link"]]
        return self.nodes[link[1]], link[2]

    def test_saved_height_source_and_non_blocking_alignment(self):
        self.assertEqual(self.nodes[2]["widgets_values"][0], "Source-Refined-contours-v2.png")

        inverted, inverted_slot = self.source_for(59, "design_foreground_mask")
        height, height_slot = self.source_for(59, "height_map")
        unmatched, unmatched_slot = self.source_for(59, "unmatched_mask")
        self.assertEqual((inverted["type"], inverted_slot), ("InvertMask", 0))
        self.assertEqual((height["id"], height_slot), (3, 0))
        self.assertEqual((unmatched["id"], unmatched_slot), (3, 2))
        self.assertFalse(self.nodes[59]["widgets_values_named"]["enforce"])

        preview_source, preview_slot = self.source_for(6, "images")
        self.assertEqual((preview_source["id"], preview_slot), (59, 1))
        report_source, report_slot = self.source_for(60, "source")
        self.assertEqual((report_source["id"], report_slot), (59, 6))

    def test_single_prompt_builder_replaces_static_concatenation(self):
        self.assertNotIn(56, self.nodes)
        self.assertNotIn(57, self.nodes)

        material, material_slot = self.source_for(8, "material_semantics")
        self.assertEqual((material["type"], material_slot), ("GPTImage2MaterialPrompt", 1))

        gpt_source, gpt_source_slot = self.source_for(9, "prompt")
        self.assertEqual((gpt_source["id"], gpt_source_slot), (8, 3))
        self.assertEqual(gpt_source["outputs"][3]["name"], "base_render_prompt")

    def test_baked_enamel_is_default_in_both_material_stages(self):
        first_material = self.nodes[55]
        self.assertEqual(first_material["widgets_values"], ["烤漆", "", ""])
        self.assertEqual(first_material["properties"]["gpt_image2_material_id"], "baked_enamel")

        regional = json.loads(self.nodes[49]["properties"]["badge_material_region_v1_config"])
        self.assertEqual(regional["default_material_id"], "baked_enamel")

    def test_gpt_nodes_use_explicit_high_quality_opaque_square_output(self):
        for node_id in (9, 53):
            named = self.nodes[node_id]["widgets_values_named"]
            self.assertEqual(named["model.size"], "1024x1024")
            self.assertEqual(named["model.background"], "opaque")
            self.assertEqual(named["model.quality"], "high")

    def test_height_gpt_receives_flat_art_and_aligned_height_reference(self):
        image_1, image_1_slot = self.source_for(9, "model.images.image_1")
        image_2, image_2_slot = self.source_for(9, "model.images.image_2")
        self.assertEqual((image_1["id"], image_1_slot), (11, 0))
        self.assertEqual((image_2["id"], image_2_slot), (6, 0))

    def test_material_gpt_receives_colored_first_pass_and_flat_art(self):
        image_1, image_1_slot = self.source_for(53, "model.images.image_1")
        image_2, image_2_slot = self.source_for(53, "model.images.image_2")
        self.assertEqual((image_1["id"], image_1_slot), (10, 0))
        self.assertEqual((image_2["id"], image_2_slot), (11, 0))

    def test_all_links_reference_real_endpoints(self):
        self.assertEqual(self.workflow["last_link_id"], max(self.links))
        for link_id, source, source_slot, target, target_slot, _ in self.workflow["links"]:
            self.assertIn(source, self.nodes, link_id)
            self.assertIn(target, self.nodes, link_id)
            self.assertIn(link_id, self.nodes[source]["outputs"][source_slot].get("links") or [])
            self.assertEqual(self.nodes[target]["inputs"][target_slot]["link"], link_id)


if __name__ == "__main__":
    unittest.main()
