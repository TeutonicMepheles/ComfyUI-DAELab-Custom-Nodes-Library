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
        self.assertFalse(any(node["type"] == "OpenAIGPTImageNodeV2" for node in self.nodes.values()))
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
            "BadgeHeightLockedBaseV1",
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
        merge = by_type["BadgeMaterialRegionMergeV1"]
        self.assertEqual(len(merge["inputs"]), 13)
        self.assertTrue(all(entry["link"] is not None for entry in merge["inputs"]))
        studio = by_type["BadgeStudioCompositeV1"]
        self.assertEqual(studio["widgets_values"], ["#FFFFFF", 0.1, 10, 0, 6, 0.04, True])

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
            "[Input]", "[Height Mapping]", "[Material Mapping]", "[Strict Base]",
            "[Material Generate]", "[Color / Height QA]", "[Final]",
        ):
            self.assertTrue(any(title.startswith(prefix) for title in titles), prefix)


if __name__ == "__main__":
    unittest.main()
