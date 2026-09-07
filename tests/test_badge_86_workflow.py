import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).parents[3]
WORKFLOW_PATH = ROOT / "user" / "default" / "workflows" / "#8.6 - Badge Workflow.json"
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
        cls.workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
        cls.nodes = {node["id"]: node for node in cls.workflow["nodes"]}
        cls.links = {link[0]: link for link in cls.workflow["links"]}
        cls.groups = {group["id"]: group for group in cls.workflow["groups"] if "id" in group}

    def source_for(self, node_id, input_name):
        node = self.nodes[node_id]
        target_slot = next(
            index for index, entry in enumerate(node["inputs"]) if entry["name"] == input_name
        )
        link_id = node["inputs"][target_slot]["link"]
        self.assertIsNotNone(link_id, (node_id, input_name))
        link = self.links[link_id]
        self.assertEqual((link[3], link[4]), (node_id, target_slot))
        return self.nodes[link[1]], link[2]

    def assert_source(self, node_id, input_name, expected):
        source, source_slot = self.source_for(node_id, input_name)
        self.assertEqual((source["id"], source_slot), expected, (node_id, input_name))

    def hierarchy_items(self):
        return json.loads(self.nodes[95]["widgets_values_named"]["config_json"])

    def test_hierarchy_has_stable_ids_defaults_exclusivity_and_confirmation_policy(self):
        items = self.hierarchy_items()
        by_id = {item["id"]: item for item in items}
        self.assertEqual(
            list(by_id),
            [
                "badge.path",
                "badge.path.flat_height",
                "badge.path.flat_height.special_material",
                "badge.path.effect",
                "badge.post",
                "badge.post.local",
                "badge.post.local.selection.color",
                "badge.post.local.selection.polygon",
                "badge.post.local.color_id_map",
                "badge.post.local.semantic",
                "badge.post.local.material",
                "badge.post.local.apply",
                "badge.post.studio",
            ],
        )
        self.assertTrue(by_id["badge.path.flat_height"]["value"])
        self.assertTrue(by_id["badge.path.flat_height.special_material"]["value"])
        self.assertFalse(by_id["badge.path.effect"]["value"])
        self.assertEqual(
            by_id["badge.path.flat_height"]["exclusive_group_id"], "badge.path.choice"
        )
        self.assertEqual(by_id["badge.path.effect"]["exclusive_group_id"], "badge.path.choice")
        self.assertEqual(by_id["badge.post.local.semantic"]["exclusive_group_id"], "badge.edit.mode")
        self.assertEqual(by_id["badge.post.local.material"]["exclusive_group_id"], "badge.edit.mode")
        self.assertFalse(by_id["badge.post.local.selection.color"]["value"])
        self.assertFalse(by_id["badge.post.local.selection.polygon"]["value"])
        self.assertEqual(
            by_id["badge.post.local.selection.color"]["exclusive_group_id"],
            "badge.local.selection.mode",
        )
        self.assertEqual(
            by_id["badge.post.local.selection.polygon"]["exclusive_group_id"],
            "badge.local.selection.mode",
        )
        self.assertEqual(
            by_id["badge.post.local.color_id_map"]["parent_id"],
            "badge.post.local",
        )
        self.assertEqual(
            by_id["badge.post.local.color_id_map"]["requires_ids"],
            ["badge.post.local.selection.color"],
        )

        policy = self.nodes[95]["properties"]["badge_confirmation_policy"]
        self.assertEqual(policy["target_node_id"], 107)
        self.assertEqual(policy["apply_item_id"], "badge.post.local.apply")
        self.assertTrue(policy["reset_apply_on_load"])
        self.assertEqual(
            set(policy["invalidating_item_ids"]),
            {
                "badge.path.flat_height",
                "badge.path.effect",
                "badge.post.local.color_id_map",
                "badge.post.local.semantic",
                "badge.post.local.material",
                "badge.post.local.selection.color",
                "badge.post.local.selection.polygon",
            },
        )

    def test_hierarchy_gets_distribute_root_branches_without_direct_control_bus(self):
        expected = {
            138: (
                "badge.path",
                [
                    "badge.path.flat_height",
                    "badge.path.flat_height.special_material",
                    "badge.path.effect",
                ],
            ),
            139: (
                "badge.path",
                [
                    "badge.path.flat_height",
                    "badge.path.flat_height.special_material",
                    "badge.path.effect",
                ],
            ),
            140: (
                "badge.post",
                [
                    "badge.post.local",
                    "badge.post.local.color_id_map",
                    "badge.post.local.semantic",
                    "badge.post.local.material",
                    "badge.post.local.apply",
                    "badge.post.studio",
                    "badge.post.local.selection.color",
                    "badge.post.local.selection.polygon",
                ],
            ),
            141: (
                "badge.post",
                [
                    "badge.post.local",
                    "badge.post.local.color_id_map",
                    "badge.post.local.semantic",
                    "badge.post.local.material",
                    "badge.post.local.apply",
                    "badge.post.studio",
                    "badge.post.local.selection.color",
                    "badge.post.local.selection.polygon",
                ],
            ),
        }
        self.assertFalse(any(output.get("links") for output in self.nodes[95]["outputs"]))
        for node_id, (root_item_id, output_item_ids) in expected.items():
            node = self.nodes[node_id]
            self.assertEqual(node["type"], "BooleanListHierarchyGet")
            self.assertTrue(node["properties"]["daelab_preserve_mode"])
            snapshot = json.loads(node["widgets_values_named"]["config_json"])
            self.assertTrue(snapshot["valid"])
            self.assertEqual(snapshot["source_node_id"], "95")
            self.assertEqual(snapshot["root_item_id"], root_item_id)
            self.assertFalse(snapshot["include_root"])
            self.assertEqual(snapshot["output_item_ids"], output_item_ids)
            labels = {item["id"]: item["label"] for item in snapshot["items"]}
            self.assertEqual(
                [output["name"] for output in node["outputs"]],
                [labels[item_id] for item_id in output_item_ids],
            )
            persisted_item_ids = [output.get("boolean_item_id") for output in node["outputs"]]
            if any(item_id is not None for item_id in persisted_item_ids):
                self.assertEqual(persisted_item_ids, output_item_ids)

    def test_route_inputs_are_lazy_and_route_two_is_canonicalized(self):
        self.assertEqual(self.nodes[97]["type"], "DAELAB.BadgeRoute2CanvasV1")
        self.assertEqual(self.nodes[98]["type"], "DAELAB.BadgeLazyImageSwitchV1")
        self.assertEqual(self.nodes[99]["type"], "DAELAB.BadgeEntryRouteV1")
        self.assert_source(97, "effect_image", (96, 0))
        self.assert_source(98, "condition", (138, 1))
        self.assert_source(98, "false_image", (9, 0))
        self.assert_source(98, "true_image", (65, 0))
        for input_name, endpoint in {
            "route_flat_height": (138, 0),
            "route_effect": (139, 2),
            "route_1_master": (98, 0),
            "route_1_reference": (67, 0),
            "route_1_support": (67, 2),
            "route_2_master": (97, 0),
            "route_2_reference": (97, 1),
            "route_2_support": (97, 2),
        }.items():
            self.assert_source(99, input_name, endpoint)

    def test_route_one_retains_four_region_material_channels_and_fixed_base(self):
        channels = [node for node in self.nodes.values() if node["type"] == "BadgeMaterialRegionGPTChannelV1"]
        self.assertEqual([node["id"] for node in channels], [61, 62, 63, 64])
        self.assertEqual(self.nodes[65]["type"], "BadgeMaterialRegionMergeV1")
        self.assertEqual(self.nodes[9]["widgets_values_named"]["control_after_generate"], "fixed")
        self.assert_source(9, "model.images.image_1", (5, 0))
        self.assert_source(9, "model.images.image_2", (59, 1))
        self.assert_source(67, "base_image", (9, 0))
        self.assert_source(67, "flat_image", (5, 0))
        self.assert_source(65, "base_image", (9, 0))
        for index, channel_id in enumerate((61, 62, 63, 64), start=1):
            self.assert_source(channel_id, "base_image", (9, 0))
            self.assert_source(channel_id, "flat_image", (67, 0))
            self.assert_source(channel_id, "height_map", (67, 1))
            self.assert_source(channel_id, "material_region_set", (49, 8))
            self.assert_source(65, f"region_{index}_image", (channel_id, 0))
            self.assert_source(65, f"region_{index}_mask", (channel_id, 1))
            self.assert_source(65, f"region_{index}_status", (channel_id, 2))

    def test_debug_previews_are_never_functional_passthroughs_or_reactivated(self):
        permanent_preview_ids = {6, 7, 10, 11, 50, 54, 60, 66, 68}
        for node_id in permanent_preview_ids:
            node = self.nodes[node_id]
            self.assertEqual(node["mode"], 4, node_id)
            self.assertTrue(node["properties"]["daelab_preserve_mode"], node_id)
        self.assertFalse(
            any(link[1] in permanent_preview_ids for link in self.workflow["links"]),
            "A permanently bypassed preview must never be a functional source.",
        )

    def test_app_mode_outputs_can_be_activated_by_their_branch_controllers(self):
        always_on_output_ids = {100, 111, 113, 114}
        for node_id in always_on_output_ids:
            self.assertEqual(self.nodes[node_id]["mode"], 0, node_id)
            self.assertTrue(self.nodes[node_id]["properties"]["daelab_preserve_mode"], node_id)

        branch_output_ids = {102, 108, 115, 116, 117}
        for node_id in branch_output_ids:
            self.assertFalse(
                self.nodes[node_id].get("properties", {}).get("daelab_preserve_mode", False),
                f"App Mode output {node_id} must not inherit the debug preview bypass lock",
            )

    def test_color_map_picker_and_unified_preview_use_the_current_real_reference(self):
        self.assert_source(101, "enabled", (140, 1))
        self.assert_source(101, "master_image", (99, 0))
        self.assert_source(103, "condition", (140, 1))
        self.assert_source(103, "false_image", (99, 1))
        self.assert_source(103, "true_image", (101, 0))
        self.assert_source(104, "images", (103, 0))
        self.assert_source(116, "images", (143, 0))
        self.assertNotIn(90, self.nodes)
        self.assertNotIn(91, self.nodes)
        self.assertNotIn(94, self.nodes)

    def test_local_prompt_guard_and_editor_wiring(self):
        self.assertEqual(self.nodes[55]["type"], "GPTImage2MaterialPrompt")
        self.assertEqual(self.nodes[106]["type"], "GPTImage2MaterialPrompt")
        self.assertNotEqual(
            self.nodes[55]["properties"].get("gpt_image2_material_id"),
            self.nodes[106]["properties"].get("gpt_image2_material_id"),
        )
        for input_name, endpoint in {
            "semantic_mode": (140, 2),
            "material_mode": (140, 3),
            "requested_apply": (140, 4),
            "material_prompt": (106, 0),
            "material_id": (106, 1),
        }.items():
            self.assert_source(105, input_name, endpoint)
        for input_name, endpoint in {
            "pre_edit_master": (99, 0),
            "selection_reference": (143, 0),
            "candidate_mask": (143, 1),
            "edit_support_mask": (99, 2),
            "requested_apply": (140, 4),
            "route_id": (99, 3),
            "map_mode": (140, 1),
            "map_cache_key": (101, 1),
            "edit_mode": (105, 1),
            "action_digest": (105, 3),
            "selection_mode": (143, 2),
        }.items():
            self.assert_source(107, input_name, endpoint)
        for input_name, endpoint in {
            "base_image": (99, 0),
            "region_mask": (107, 0),
            "foreground_mask": (99, 2),
            "enabled": (107, 2),
            "edit_prompt": (105, 0),
        }.items():
            self.assert_source(109, input_name, endpoint)

    def test_local_selection_routes_color_or_polygon_mask_lazily(self):
        self.assertEqual(self.nodes[142]["type"], "DAELAB.PolygonMaskV1")
        self.assertEqual(self.nodes[143]["type"], "DAELAB.BadgeLocalMaskRouteV1")
        self.assert_source(142, "image", (99, 0))
        for input_name, endpoint in {
            "selection_color": (140, 6),
            "selection_polygon": (140, 7),
            "color_reference": (103, 0),
            "color_mask": (104, 0),
            "polygon_reference": (99, 0),
            "polygon_mask": (142, 1),
        }.items():
            self.assert_source(143, input_name, endpoint)
        self.assertEqual(json.loads(self.nodes[142]["widgets_values"][4])["cleared"], True)

    def test_current_master_and_studio_are_both_lazy(self):
        self.assert_source(110, "condition", (140, 0))
        self.assert_source(110, "false_image", (99, 0))
        self.assert_source(110, "true_image", (109, 0))
        self.assert_source(87, "model.images.image_1", (110, 0))
        self.assertEqual(self.nodes[87]["widgets_values_named"]["control_after_generate"], "randomize")
        self.assert_source(112, "condition", (141, 5))
        self.assert_source(112, "false_image", (110, 0))
        self.assert_source(112, "true_image", (87, 0))
        self.assert_source(113, "images", (112, 0))

    def test_app_mode_linear_contract_and_registered_node_ids(self):
        linear = self.workflow["extra"]["linearData"]
        actual_inputs = [(int(entry[0].split(":")[-2]), entry[1]) for entry in linear["inputs"]]
        self.assertEqual(
            actual_inputs,
            [
                (95, "boolean_hierarchy_editor"),
                (1, "image"),
                (47, "multi_color_mask_v1_panel"),
                (2, "image"),
                (3, "badge_height_layer_v1_panel"),
                (55, "material_thumbnail_dom_selector"),
                (49, "badge_material_region_v1_panel"),
                (96, "image"),
                (104, "multi_color_mask_v1_panel"),
                (142, "polygon_canvas"),
                (105, "semantic_prompt"),
                (106, "material_thumbnail_dom_selector"),
                (87, "prompt"),
            ],
        )
        self.assertEqual(linear["outputs"], ["100", "114", "102", "115", "116", "108", "117", "111", "113"])
        registered = APP_MODE_MODEL_PATH.read_text(encoding="utf-8")
        for node_type in (
            "DAELAB.BadgeLazyImageSwitchV1",
            "DAELAB.BadgeEntryRouteV1",
            "DAELAB.BadgeLocalMaskRouteV1",
            "DAELAB.BadgeEditPromptRouteV1",
            "DAELAB.BadgeRoute2CanvasV1",
            "DAELAB.BadgeColorIdMapV1",
            "DAELAB.BadgeColorIdMapCacheStoreV1",
            "DAELAB.BadgeLocalSelectionGuardV1",
            "DAELAB.PolygonMaskV1",
        ):
            self.assertIn(f'"{node_type}"', registered)

    def test_paginated_app_layout_has_exact_inputs_controls_and_references(self):
        self.assertEqual(len(self.workflow["nodes"]), 66)
        self.assertEqual(len(self.workflow["links"]), 129)
        self.assertEqual(len(self.workflow["groups"]), 20)

        linear = self.workflow["extra"]["linearData"]
        layout = self.workflow["extra"]["daelabAppLayoutV1"]
        linear_keys = [entry[0] for entry in linear["inputs"]]
        self.assertEqual(layout["version"], 1)
        self.assertEqual(layout["defaultTab"], "control")
        self.assertEqual(
            layout["stateSource"],
            {"nodeId": 95, "interface": "daelabBooleanHierarchyV1"},
        )
        self.assertEqual(layout["inputKeys"], linear_keys)
        self.assertEqual(
            [tab["id"] for tab in layout["tabs"]],
            ["control", "build", "local", "studio"],
        )
        assigned_keys = [key for tab in layout["tabs"] for key in tab["inputKeys"]]
        self.assertEqual(len(assigned_keys), 13)
        self.assertEqual(set(assigned_keys), set(linear_keys))
        self.assertEqual(len(set(assigned_keys)), len(assigned_keys))
        tabs = {tab["id"]: tab for tab in layout["tabs"]}
        self.assertEqual(tabs["local"]["enabledItemId"], "badge.post.local")
        self.assertEqual(tabs["studio"]["enabledItemId"], "badge.post.studio")
        self.assertEqual(
            [len(tabs[tab_id]["inputKeys"]) for tab_id in ("control", "build", "local", "studio")],
            [1, 7, 4, 1],
        )

        self.assertEqual([control["id"] for control in layout["quickControls"]["build"]], [
            "build-route",
            "build-special-material",
        ])
        self.assertEqual([control["id"] for control in layout["quickControls"]["local"]], [
            "local-enabled",
            "local-selection-mode",
            "local-color-map",
            "local-edit-mode",
            "local-apply",
        ])
        references = {source["id"]: source for source in layout["referenceSources"]}
        self.assertEqual(
            {source["kind"] for source in references.values()},
            {"inputWidget", "executionOutput"},
        )
        self.assertEqual(references["local-current-reference"]["nodeId"], 116)
        self.assertEqual(references["studio-current-master"]["nodeId"], 111)
        self.assertEqual(references["build-flat"]["widgetName"], "image")
        self.assertEqual(references["build-height"]["widgetName"], "image")
        self.assertEqual(references["build-effect"]["widgetName"], "image")
        self.assertEqual(
            layout["polygonChange"],
            {
                "nodeId": 142,
                "selectionItemId": "badge.post.local.selection.polygon",
                "applyItemId": "badge.post.local.apply",
            },
        )

    def test_all_v1_color_pickers_submit_their_config_as_prompt_input(self):
        for node in self.nodes.values():
            if node["type"] != "DAELabMultiColorMaskV1":
                continue
            config_input = next(
                value for value in node["inputs"] if value["name"] == "config_json"
            )
            self.assertEqual(config_input["type"], "STRING")
            self.assertEqual(config_input["widget"]["name"], "config_json")
            self.assertEqual(
                node["widgets_values"][-1],
                node["properties"]["multi_color_mask_v1_config"],
            )

    def test_app_mode_reference_previews_are_explicit_opt_ins_with_chinese_headings(self):
        expected_uploads = {
            1: (
                "上传徽章平面图",
                "取色参考图｜徽章平面图（用于背景、镂空和特殊材质区域）",
            ),
            2: (
                "上传徽章高度层次图",
                "取色参考图｜高度层次图（请从这里吸色）",
            ),
            96: (
                "上传现有徽章效果图",
                "取色参考图｜现有徽章效果图（用于局部修改选区）",
            ),
        }
        for node_id, (input_label, preview_heading) in expected_uploads.items():
            node = self.nodes[node_id]
            image_input = next(value for value in node["inputs"] if value["name"] == "image")
            self.assertEqual(image_input["label"], input_label)
            self.assertTrue(node["properties"]["daelab_show_app_preview"])
            self.assertEqual(
                node["properties"]["daelab_app_preview_heading"], preview_heading
            )

        expected_panel_headings = {
            95: "制作流程与后处理选项",
            47: "背景与镂空颜色（按上方平面图取色）",
            3: "高度层级设置（按上方层次图取色）",
            55: "基础材质｜选择默认烤漆效果",
            49: "特殊材质区域（按平面图取色，最多四个）",
            104: "局部修改选区（按上方参考图取色）",
            142: "局部修改｜自绘遮罩（Shift+左键新建 Polygon）",
            106: "局部修改｜选择目标材质",
        }
        for node_id, heading in expected_panel_headings.items():
            self.assertEqual(self.nodes[node_id]["properties"]["daelab_app_heading"], heading)
        self.assertEqual(
            self.nodes[49]["properties"]["badge_material_region_v1_max_groups"], 4
        )

        semantic_input = next(
            value for value in self.nodes[105]["inputs"] if value["name"] == "semantic_prompt"
        )
        studio_input = next(
            value for value in self.nodes[87]["inputs"] if value["name"] == "prompt"
        )
        self.assertEqual(semantic_input["label"], "局部修改提示词（纯语义模式）")
        self.assertEqual(studio_input["label"], "棚拍效果图提示词")

    def test_bypass_control_plane_is_isolated_while_target_groups_stay_intact(self):
        expected = {
            130: (138, 0, "daelab-badge-route-1"),
            131: (138, 1, "daelab-badge-route-1-material"),
            132: (139, 2, "daelab-badge-route-2"),
            133: (140, 0, "daelab-badge-local"),
            134: (140, 1, "daelab-badge-local-map"),
            135: (140, 4, "daelab-badge-local-apply"),
            136: (141, 5, "daelab-badge-studio"),
            137: (140, 3, "daelab-badge-local-material"),
            144: (140, 6, "daelab-badge-local-color"),
            145: (140, 7, "daelab-badge-local-polygon"),
        }
        control_plane = self.groups["daelab-badge-bypass-control"]["bounding"]
        cx, cy, cwidth, cheight = control_plane

        for node_id, (source_id, slot, group_id) in expected.items():
            self.assertEqual(self.nodes[node_id]["type"], "BooleanGroupBypassController")
            self.assert_source(node_id, "boolean", (source_id, slot))
            self.assertEqual(self.nodes[node_id]["properties"]["target_group_id"], group_id)
            x, y = self.nodes[node_id]["pos"]
            width, height = self.nodes[node_id]["size"]
            self.assertGreaterEqual(x, cx, node_id)
            self.assertGreaterEqual(y, cy, node_id)
            self.assertLessEqual(x + width, cx + cwidth, node_id)
            self.assertLessEqual(y + height, cy + cheight, node_id)

            gx, gy, width, height = self.groups[group_id]["bounding"]
            node_center = (
                x + self.nodes[node_id]["size"][0] / 2,
                y + self.nodes[node_id]["size"][1] / 2,
            )
            self.assertFalse(
                gx <= node_center[0] <= gx + width
                and gy <= node_center[1] <= gy + height,
                node_id,
            )

        rack_member_ids = {
            node["id"]
            for node in self.nodes.values()
            if cx <= node["pos"][0] + node["size"][0] / 2 <= cx + cwidth
            and cy <= node["pos"][1] + node["size"][1] / 2 <= cy + cheight
        }
        self.assertEqual(rack_member_ids, set(range(130, 142)) | {144, 145})

        expected_controlled_nodes = {
            "daelab-badge-route-1": {1, 2, 3, 5, 8, 9, 47, 49, 55, 58, 59, 61, 62, 63, 64, 65, 67},
            "daelab-badge-route-1-material": {49, 61, 62, 63, 64, 65},
            "daelab-badge-route-2": {96, 97},
            "daelab-badge-local": {101, 102, 103, 104, 105, 106, 107, 108, 109, 115, 116, 117, 142, 143},
            "daelab-badge-local-map": {101, 102, 115},
            "daelab-badge-local-color": {103, 104},
            "daelab-badge-local-polygon": {142},
            "daelab-badge-local-material": {106},
            "daelab-badge-local-apply": {109},
            "daelab-badge-studio": {87},
        }
        for group_id, expected_node_ids in expected_controlled_nodes.items():
            gx, gy, width, height = self.groups[group_id]["bounding"]
            actual_node_ids = {
                node["id"]
                for node in self.nodes.values()
                if gx <= node["pos"][0] + node["size"][0] / 2 <= gx + width
                and gy <= node["pos"][1] + node["size"][1] / 2 <= gy + height
                and node["type"] != "BooleanGroupBypassController"
                and not node.get("properties", {}).get("daelab_preserve_mode", False)
            }
            self.assertEqual(actual_node_ids, expected_node_ids, group_id)

        for child_id, parent_id in {
            "daelab-badge-route-1-material": "daelab-badge-route-1",
            "daelab-badge-local-color": "daelab-badge-local",
            "daelab-badge-local-map": "daelab-badge-local",
            "daelab-badge-local-polygon": "daelab-badge-local",
            "daelab-badge-local-material": "daelab-badge-local",
            "daelab-badge-local-apply": "daelab-badge-local",
        }.items():
            child = self.groups[child_id]["bounding"]
            parent = self.groups[parent_id]["bounding"]
            self.assertGreaterEqual(child[0], parent[0])
            self.assertGreaterEqual(child[1], parent[1])
            self.assertLessEqual(child[0] + child[2], parent[0] + parent[2])
            self.assertLessEqual(child[1] + child[3], parent[1] + parent[3])

        local_siblings = [
            self.groups[group_id]["bounding"]
            for group_id in (
                "daelab-badge-local-color",
                "daelab-badge-local-map",
                "daelab-badge-local-polygon",
                "daelab-badge-local-material",
                "daelab-badge-local-apply",
            )
        ]
        for left_index, left in enumerate(local_siblings):
            for right in local_siblings[left_index + 1:]:
                disjoint = (
                    left[0] + left[2] <= right[0]
                    or right[0] + right[2] <= left[0]
                    or left[1] + left[3] <= right[1]
                    or right[1] + right[3] <= left[1]
                )
                self.assertTrue(disjoint, (left, right))

        local = self.groups["daelab-badge-local"]["bounding"]
        lx, ly, lwidth, lheight = local
        for node_id in (108, 117, 142, 143):
            node = self.nodes[node_id]
            x, y = node["pos"]
            width, height = node["size"]
            self.assertGreaterEqual(x, lx, node_id)
            self.assertGreaterEqual(y, ly, node_id)
            self.assertLessEqual(x + width, lx + lwidth, node_id)
            self.assertLessEqual(y + height, ly + lheight, node_id)

        current_master = self.nodes[110]
        current_master_center_x = current_master["pos"][0] + current_master["size"][0] / 2
        self.assertGreater(current_master_center_x, lx + lwidth)

    def test_links_are_contiguous_and_bidirectional(self):
        self.assertEqual(list(self.links), list(range(1, self.workflow["last_link_id"] + 1)))
        for link_id, source, source_slot, target, target_slot, _ in self.workflow["links"]:
            self.assertIn(link_id, self.nodes[source]["outputs"][source_slot].get("links") or [])
            self.assertEqual(self.nodes[target]["inputs"][target_slot]["link"], link_id)


if __name__ == "__main__":
    unittest.main()
