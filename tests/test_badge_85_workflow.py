import hashlib
import json
import pathlib
import unittest


WORKFLOW_PATH = pathlib.Path(__file__).parents[3] / "user" / "default" / "workflows" / "#8.5 - Badge Workflow.json"


class Badge85WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
        cls.nodes = {node["id"]: node for node in cls.workflow["nodes"]}

    def test_editor_mode_workflow_has_no_app_builder_linear_data(self):
        self.assertNotIn("linearData", self.workflow.get("extra", {}))
        self.assertEqual([node["type"] for node in self.nodes.values()].count("AppModeLoadImage"), 2)
        self.assertEqual(
            [node["type"] for node in self.nodes.values()].count("OpenAIGPTImageNodeV2"),
            1,
        )
        self.assertEqual(
            [node["type"] for node in self.nodes.values()].count("BadgeMaterialRegionGPTChannelV1"),
            4,
        )
        self.assertIn("BadgeMaterialRegionMergeV1", {node["type"] for node in self.nodes.values()})
        self.assertNotIn("BadgeMaterialRegionExecutorV1", {node["type"] for node in self.nodes.values()})

    def test_strict_pipeline_is_connected_in_order(self):
        by_type = {node["type"]: node for node in self.nodes.values()}
        expected = {
            "BadgeHeightReferenceAlignV1",
            "DAELAB.BadgeReliefGeometryV1",
            "BadgeHeightEstablishPromptBuilder",
            "OpenAIGPTImageNodeV2",
            "DAELAB.BadgeGPTStructureTransferV1",
            "BadgeMaterialRegionGPTChannelV1",
            "BadgeMaterialRegionMergeV1",
            "BadgeStudioCompositeV1",
            "DAELabBadgeMaterialRegionV1",
        }
        self.assertTrue(expected.issubset(by_type))
        channels = sorted(
            (node for node in self.nodes.values() if node["type"] == "BadgeMaterialRegionGPTChannelV1"),
            key=lambda node: node["widgets_values"][0],
        )
        self.assertEqual([node["widgets_values"][0] for node in channels], [1, 2, 3, 4])
        for slot, channel in enumerate(channels, start=1):
            self.assertEqual([entry["name"] for entry in channel["inputs"][:4]], [
                "base_image", "flat_image", "height_map", "material_region_set"
            ])
            self.assertEqual(channel["widgets_values"], [slot, "medium", 4, 16])
            base_link = next(link for link in self.workflow["links"] if link[0] == channel["inputs"][0]["link"])
            self.assertEqual(self.nodes[base_link[1]]["type"], "DAELAB.BadgeGPTStructureTransferV1")
        merge = by_type["BadgeMaterialRegionMergeV1"]
        self.assertEqual(len(merge["inputs"]), 13)
        self.assertTrue(all(entry["link"] is not None for entry in merge["inputs"]))
        merge_base_link = next(link for link in self.workflow["links"] if link[0] == merge["inputs"][0]["link"])
        self.assertEqual(self.nodes[merge_base_link[1]]["type"], "DAELAB.BadgeGPTStructureTransferV1")
        studio = by_type["BadgeStudioCompositeV1"]
        self.assertEqual(studio["widgets_values"], ["#FFFFFF", 0.1, 10, 0, 6, 0.04, True])

    def test_native_gpt_structure_stage_uses_flat_height_and_foreground_inputs(self):
        gpt = next(node for node in self.nodes.values() if node["type"] == "OpenAIGPTImageNodeV2")
        self.assertEqual(
            gpt["widgets_values"],
            ["", "gpt-image-2", "1024x1024", 1024, 1024, "auto", "medium", 1, 0, "fixed"],
        )
        self.assertEqual(gpt["widgets_values_named"]["model.size"], "1024x1024")
        self.assertNotIn("title", gpt)
        expected_sources = {
            "prompt": "BadgeHeightEstablishPromptBuilder",
            "model.images.image_1": "BadgeDesignCanvas",
            "model.images.image_2": "BadgeHeightReferenceAlignV1",
        }
        for input_name, source_type in expected_sources.items():
            input_entry = next(entry for entry in gpt["inputs"] if entry["name"] == input_name)
            self.assertIsNotNone(input_entry["link"], input_name)
            link = next(entry for entry in self.workflow["links"] if entry[0] == input_entry["link"])
            self.assertEqual(self.nodes[link[1]]["type"], source_type, input_name)
        mask_input = next(entry for entry in gpt["inputs"] if entry["name"] == "model.mask")
        self.assertIsNone(mask_input["link"])

        geometry = next(
            node for node in self.nodes.values()
            if node["type"] == "DAELAB.BadgeReliefGeometryV1"
        )
        self.assertEqual([entry["name"] for entry in geometry["inputs"][:3]], [
            "flat_image", "height_map", "foreground_mask",
        ])
        self.assertEqual(
            geometry["widgets_values"],
            [7, 1.0, 11.0, 0.72, 0.34, 0.07, 28.0, 0.10, 10, -135.0, 45.0, True],
        )
        self.assertEqual(
            geometry["widgets_values_named"],
            {
                "bevel_radius_px": 7,
                "relief_depth": 1.0,
                "normal_strength": 11.0,
                "ambient": 0.72,
                "key_strength": 0.34,
                "specular_strength": 0.07,
                "specular_power": 28.0,
                "ao_strength": 0.10,
                "ao_radius_px": 10,
                "light_azimuth_degrees": -135.0,
                "light_elevation_degrees": 45.0,
                "enforce_1024": True,
            },
        )
        transfer = next(
            node for node in self.nodes.values()
            if node["type"] == "DAELAB.BadgeGPTStructureTransferV1"
        )
        self.assertEqual([entry["name"] for entry in transfer["inputs"][:5]], [
            "candidate_image", "geometry_base", "flat_image", "height_map", "foreground_mask",
        ])
        self.assertEqual(transfer["widgets_values"], [0.40, 0.24, 1, 8, 0.08, 0.24, True])
        self.assertEqual(
            transfer["widgets_values_named"],
            {
                "form_strength": 0.40,
                "detail_strength": 0.24,
                "boundary_lock_px": 1,
                "maximum_translation_px": 8,
                "minimum_relief_contrast": 0.08,
                "minimum_edge_coverage": 0.24,
                "enforce_1024": True,
            },
        )
        geometry_link = next(
            link for link in self.workflow["links"]
            if link[0] == transfer["inputs"][1]["link"]
        )
        self.assertEqual(self.nodes[geometry_link[1]]["type"], "DAELAB.BadgeReliefGeometryV1")

    def test_nodes_use_registered_names_without_workflow_title_overrides(self):
        titled = {
            node["id"]: node["title"]
            for node in self.nodes.values()
            if "title" in node
        }
        self.assertEqual(titled, {})

    def test_material_config_property_and_hidden_widget_are_byte_identical(self):
        node = next(node for node in self.nodes.values() if node["type"] == "DAELabBadgeMaterialRegionV1")
        property_value = node["properties"]["badge_material_region_v1_config"]
        widget_value = node["widgets_values"][0]
        self.assertEqual(property_value, widget_value)
        config = json.loads(property_value)
        self.assertEqual(config["version"], 2)
        self.assertEqual(config["revision"], 0)
        self.assertTrue(all(group["color_policy"] == "preserve" for group in config["groups"]))
        self.assertTrue(all(group["material_strength"] == 1 for group in config["groups"]))
        self.assertEqual(
            node["properties"]["badge_material_region_v1_config_digest"],
            hashlib.sha256(property_value.encode("utf-8")).hexdigest(),
        )

    def test_height_config_property_hidden_widget_and_backend_report_are_connected(self):
        node = next(node for node in self.nodes.values() if node["type"] == "DAELabBadgeHeightLayerV1")
        property_value = node["properties"]["badge_height_layer_v1_config"]
        self.assertEqual(node["widgets_values"], [property_value])
        self.assertEqual(node["widgets_values_named"], {"height_layer_config": property_value})
        self.assertIn("height_layer_config", [entry["name"] for entry in node["inputs"]])
        self.assertEqual(
            node["properties"]["badge_height_layer_v1_config_digest"],
            hashlib.sha256(property_value.encode("utf-8")).hexdigest(),
        )
        self.assertEqual([entry["name"] for entry in node["outputs"][:4]], [
            "height_mask", "height_image", "unmatched_mask", "height_profile",
        ])
        self.assertEqual([entry["name"] for entry in node["outputs"][4:]], [
            "applied_config", "config_digest", "config_report",
        ])
        report_link = node["outputs"][6]["links"][0]
        link = next(entry for entry in self.workflow["links"] if entry[0] == report_link)
        self.assertEqual((link[1], link[2]), (node["id"], 6))
        self.assertEqual(self.nodes[link[3]]["type"], "PreviewAny")

    def test_link_ids_and_endpoints_are_complete(self):
        links = self.workflow["links"]
        ids = [link[0] for link in links]
        self.assertEqual(ids, list(range(1, self.workflow["last_link_id"] + 1)))
        for _, source, _, target, target_slot, _ in links:
            self.assertIn(source, self.nodes)
            self.assertIn(target, self.nodes)
            self.assertEqual(self.nodes[target]["inputs"][target_slot]["link"], next(
                link[0] for link in links if link[1] == source and link[3] == target and link[4] == target_slot
            ))

    def test_canvas_groups_match_editor_mode_contract(self):
        titles = [group["title"] for group in self.workflow["groups"]]
        for prefix in (
            "[Input]", "[Height Mapping]", "[Material Mapping]", "[Height Structure Geometry]",
            "[Height Structure Generate]",
            "[Material Generate]", "[Color / Height QA]", "[Final]",
        ):
            self.assertTrue(any(title.startswith(prefix) for title in titles), prefix)


if __name__ == "__main__":
    unittest.main()
