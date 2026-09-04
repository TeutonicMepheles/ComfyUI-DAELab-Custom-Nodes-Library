from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "user" / "default" / "workflows" / "#8.6 - Badge Workflow.json"
REMOVE_IDS = {69, 73, 78, 79, 81, 86, 90, 91, 94} | set(range(95, 138))
PERMANENT_BYPASS_IDS = {6, 7, 10, 11, 50, 54, 60, 66, 68}


def inp(name, value_type, *, widget=False, label=None):
    result = {
        "localized_name": label or name,
        "name": name,
        "type": value_type,
        "link": None,
    }
    if label:
        result["label"] = label
    if widget:
        result["widget"] = {"name": name}
    return result


def out(name, value_type, *, label=None, boolean_item_id=None):
    result = {
        "localized_name": label or name,
        "name": name,
        "type": value_type,
        "links": [],
    }
    if boolean_item_id:
        result["boolean_item_id"] = boolean_item_id
    return result


def node(node_id, node_type, title, pos, size, inputs, outputs, widgets=None, named=None, properties=None, mode=0):
    return {
        "id": node_id,
        "type": node_type,
        "pos": list(pos),
        "size": list(size),
        "flags": {},
        "order": node_id,
        "mode": mode,
        "inputs": inputs,
        "outputs": outputs,
        "title": title,
        "properties": {"Node name for S&R": node_type, **(properties or {})},
        "widgets_values": list(widgets or []),
        "widgets_values_named": dict(named or {}),
    }


def preview_from(source, node_id, title, pos, mode=0, preserve_mode=False):
    value = copy.deepcopy(source)
    value.update({"id": node_id, "pos": list(pos), "order": node_id, "mode": mode, "title": title})
    # The donor is one of the permanently-bypassed graph-only debug previews.
    # App Mode previews are functional execution roots and must remain eligible
    # for their BooleanGroupBypassController to activate them.
    properties = value.setdefault("properties", {})
    properties.pop("daelab_preserve_mode", None)
    if preserve_mode:
        properties["daelab_preserve_mode"] = True
    value["inputs"] = [inp("images", "IMAGE", label="图像")]
    value["outputs"] = [out("images", "IMAGE")]
    return value


def preview_any_from(source, node_id, title, pos, mode=0, preserve_mode=False):
    value = copy.deepcopy(source)
    value.update({"id": node_id, "pos": list(pos), "order": node_id, "mode": mode, "title": title})
    # As above, do not inherit the debug donor's permanent bypass lock.
    properties = value.setdefault("properties", {})
    properties.pop("daelab_preserve_mode", None)
    if preserve_mode:
        properties["daelab_preserve_mode"] = True
    value["inputs"] = [inp("source", "*")]
    value["outputs"] = []
    value["widgets_values"] = []
    value.pop("widgets_values_named", None)
    return value


def controller(node_id, title, pos, target_group_id, mode=0):
    return node(
        node_id,
        "BooleanGroupBypassController",
        title,
        pos,
        (360, 122),
        [inp("boolean", "BOOLEAN")],
        [],
        properties={"target_group_id": target_group_id, "invert": False},
        mode=mode,
    )


def group(group_id, title, bounding, color="#3f789e"):
    return {
        "id": group_id,
        "title": title,
        "bounding": list(bounding),
        "color": color,
        "font_size": 24,
        "flags": {},
    }


def build():
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    by_id = {entry["id"]: entry for entry in workflow["nodes"]}
    upload_donor = by_id.get(91) or by_id.get(96)
    if upload_donor is None:
        raise ValueError("Workflow has no AppModeLoadImage donor for Route 2.")
    retained = [entry for entry in workflow["nodes"] if entry["id"] not in REMOVE_IDS]
    retained_by_id = {entry["id"]: entry for entry in retained}

    def set_app_heading(node_id, title, heading):
        entry = retained_by_id[node_id]
        entry["title"] = title
        entry.setdefault("properties", {})["daelab_app_heading"] = heading

    def configure_upload(node_id, title, input_label, preview_heading):
        entry = retained_by_id[node_id]
        entry["title"] = title
        entry.setdefault("properties", {}).update({
            "daelab_show_app_preview": True,
            "daelab_app_preview_heading": preview_heading,
        })
        image_input = next(value for value in entry.get("inputs", []) if value.get("name") == "image")
        image_input["label"] = input_label
        image_input["localized_name"] = input_label

    configure_upload(
        1,
        "步骤一｜上传徽章平面图",
        "上传徽章平面图",
        "取色参考图｜徽章平面图（用于背景、镂空和特殊材质区域）",
    )
    configure_upload(
        2,
        "步骤二｜上传徽章高度层次图",
        "上传徽章高度层次图",
        "取色参考图｜高度层次图（请从这里吸色）",
    )
    set_app_heading(47, "步骤一补充｜选择平面图背景与镂空颜色", "背景与镂空颜色（按上方平面图取色）")
    set_app_heading(3, "步骤三｜设置徽章高度层级", "高度层级设置（按上方层次图取色）")
    set_app_heading(49, "可选｜设置特殊材质区域", "特殊材质区域（按平面图取色，最多四个）")
    retained_by_id[49].setdefault("properties", {})["badge_material_region_v1_max_groups"] = 4
    set_app_heading(55, "步骤四｜选择默认基础材质", "基础材质｜选择默认烤漆效果")

    # Preview/debug output nodes must not become independent execution roots.
    for node_id in PERMANENT_BYPASS_IDS:
        if node_id in retained_by_id:
            retained_by_id[node_id]["mode"] = 4
            retained_by_id[node_id].setdefault("properties", {})["daelab_preserve_mode"] = True

    hierarchy_items = [
        {"id": "badge.path", "label": "制作路径", "value": True, "parent_id": None},
        {"id": "badge.path.flat_height", "label": "从平面图 + 层次图生成", "value": True, "parent_id": "badge.path", "exclusive_group_id": "badge.path.choice"},
        {"id": "badge.path.flat_height.special_material", "label": "特殊材质", "value": False, "parent_id": "badge.path.flat_height"},
        {"id": "badge.path.effect", "label": "从现有效果图开始", "value": False, "parent_id": "badge.path", "exclusive_group_id": "badge.path.choice"},
        {"id": "badge.post", "label": "后处理", "value": True, "parent_id": None},
        {"id": "badge.post.local", "label": "局部修改", "value": False, "parent_id": "badge.post"},
        {"id": "badge.post.local.color_id_map", "label": "使用颜色编号图（Color ID Map）", "value": False, "parent_id": "badge.post.local"},
        {"id": "badge.post.local.semantic", "label": "纯语义修改", "value": False, "parent_id": "badge.post.local", "exclusive_group_id": "badge.edit.mode"},
        {"id": "badge.post.local.material", "label": "转换为特定材质", "value": False, "parent_id": "badge.post.local", "exclusive_group_id": "badge.edit.mode"},
        {"id": "badge.post.local.apply", "label": "应用局部修改", "value": False, "parent_id": "badge.post.local"},
        {"id": "badge.post.studio", "label": "棚拍效果图", "value": False, "parent_id": "badge.post"},
    ]
    hierarchy_json = json.dumps(hierarchy_items, ensure_ascii=False, separators=(",", ":"))
    hierarchy_outputs = [out(item["label"], "BOOLEAN", boolean_item_id=item["id"]) for item in hierarchy_items]

    picker_config = json.dumps({
        "version": 1,
        "groups": [{"id": "local_region_1", "color": "#FF1744", "threshold": 12, "invert": False}],
        "output": "combined_mask",
    }, ensure_ascii=False, separators=(",", ":"))

    new_nodes = [
        node(
            95, "BooleanListHierarchy", "制作流程与后处理选项", (1500, 6250), (570, 430),
            [inp("config_json", "STRING", widget=True)], hierarchy_outputs,
            [hierarchy_json], {"config_json": hierarchy_json},
            {
                "boolean_list_items": hierarchy_json,
                "boolean_list_count": len(hierarchy_items),
                "boolean_list_width": 570,
                "daelab_app_heading": "制作流程与后处理选项",
                "badge_confirmation_policy": {
                    "apply_item_id": "badge.post.local.apply",
                    "invalidating_item_ids": [
                        "badge.path.flat_height", "badge.path.effect",
                        "badge.post.local.color_id_map",
                        "badge.post.local.semantic", "badge.post.local.material",
                    ],
                    "target_node_id": 107,
                    "reset_apply_on_load": True,
                },
            },
        ),
        copy.deepcopy(upload_donor),
        node(
            97, "DAELAB.BadgeRoute2CanvasV1", "路线二｜统一现有效果图画布", (2600, 6400), (380, 170),
            [inp("effect_image", "IMAGE")],
            [out("canonical_master", "IMAGE"), out("direct_selection_reference", "IMAGE"), out("edit_support_mask", "MASK"), out("status", "STRING")],
            mode=4,
        ),
        node(
            98, "DAELAB.BadgeLazyImageSwitchV1", "路线一｜选择基础或特殊材质结果", (4650, 6180), (360, 150),
            [inp("condition", "BOOLEAN", widget=True), inp("false_image", "IMAGE"), inp("true_image", "IMAGE")],
            [out("image", "IMAGE"), out("status", "STRING")],
            [False], {"condition": False},
        ),
        node(
            99, "DAELAB.BadgeEntryRouteV1", "制作路线｜惰性入口与画布约束", (5150, 6180), (430, 310),
            [
                inp("route_flat_height", "BOOLEAN", widget=True), inp("route_effect", "BOOLEAN", widget=True),
                inp("route_1_master", "IMAGE"), inp("route_1_reference", "IMAGE"), inp("route_1_support", "MASK"),
                inp("route_2_master", "IMAGE"), inp("route_2_reference", "IMAGE"), inp("route_2_support", "MASK"),
            ],
            [out("pre_edit_master", "IMAGE"), out("direct_selection_reference", "IMAGE"), out("edit_support_mask", "MASK"), out("route_id", "STRING"), out("status", "STRING")],
            [True, False], {"route_flat_height": True, "route_effect": False},
        ),
        preview_from(by_id[54], 100, "当前主图｜局部修改前", (5650, 6160), preserve_mode=True),
        node(
            101, "DAELAB.BadgeColorIdMapV1", "局部修改｜生成并缓存颜色编号图", (6080, 6500), (470, 360),
            [
                inp("enabled", "BOOLEAN", widget=True), inp("master_image", "IMAGE"),
                inp("map_prompt", "STRING", widget=True), inp("quality", "COMBO", widget=True),
                inp("seed", "INT", widget=True), inp("map_revision", "INT", widget=True),
            ],
            [out("color_id_map", "IMAGE"), out("cache_key", "STRING"), out("status", "STRING")],
            [False, "", "high", 6, 0],
            {"enabled": False, "map_prompt": "", "quality": "high", "seed": 6, "map_revision": 0},
            mode=4,
        ),
        preview_from(by_id[54], 102, "取色参考图｜颜色编号图", (6600, 6420), mode=4),
        node(
            103, "DAELAB.BadgeLazyImageSwitchV1", "局部修改｜选择真实取色基准", (6100, 7130), (360, 150),
            [inp("condition", "BOOLEAN", widget=True), inp("false_image", "IMAGE"), inp("true_image", "IMAGE")],
            [out("image", "IMAGE"), out("status", "STRING")],
            [False], {"condition": False}, mode=4,
        ),
        node(
            104, "DAELabMultiColorMaskV1", "局部修改｜按参考图颜色选择区域", (6550, 7080), (440, 260),
            [inp("images", "IMAGE"), inp("config_json", "STRING", widget=True)],
            [out("mask", "MASK")],
            [picker_config], {"config_json": picker_config},
            {
                "multi_color_mask_v1_config": picker_config,
                "multi_color_mask_v1_width": 440,
                "daelab_app_heading": "局部修改选区（按上方参考图取色）",
            }, mode=4,
        ),
        node(
            105, "DAELAB.BadgeEditPromptRouteV1", "局部修改｜选择语义或材质提示词", (7350, 6790), (470, 340),
            [
                inp("semantic_mode", "BOOLEAN", widget=True), inp("material_mode", "BOOLEAN", widget=True),
                inp("requested_apply", "BOOLEAN", widget=True),
                inp("semantic_prompt", "STRING", widget=True, label="局部修改提示词（纯语义模式）"),
                inp("material_prompt", "STRING"), inp("material_id", "STRING"),
            ],
            [out("selected_prompt", "STRING"), out("edit_mode", "STRING"), out("effective_request", "BOOLEAN"), out("action_digest", "STRING"), out("status", "STRING")],
            [False, False, False, "仅修改选中区域，保持轮廓、文字、颜色和未选区域不变。"],
            {"semantic_mode": False, "material_mode": False, "requested_apply": False, "semantic_prompt": "仅修改选中区域，保持轮廓、文字、颜色和未选区域不变。"},
            mode=4,
        ),
        copy.deepcopy(by_id[55]),
        node(
            107, "DAELAB.BadgeLocalSelectionGuardV1", "[Local Guard] 选区快照与确认", (7860, 6850), (500, 530),
            [
                inp("pre_edit_master", "IMAGE"), inp("selection_reference", "IMAGE"), inp("candidate_mask", "MASK"), inp("edit_support_mask", "MASK"),
                inp("requested_apply", "BOOLEAN", widget=True), inp("confirmation_revision", "INT", widget=True),
                inp("route_id", "STRING"), inp("map_mode", "BOOLEAN", widget=True), inp("map_cache_key", "STRING"),
                inp("picker_node_id", "STRING", widget=True), inp("picker_config", "STRING", widget=True),
                inp("edit_mode", "STRING"), inp("action_digest", "STRING"), inp("minimum_region_pixels", "INT", widget=True),
            ],
            [out("validated_mask", "MASK"), out("selection_overlay", "IMAGE"), out("effective_apply", "BOOLEAN"), out("snapshot_token", "STRING"), out("status", "STRING")],
            [False, 0, False, "104", picker_config, 16],
            {"requested_apply": False, "confirmation_revision": 0, "map_mode": False, "picker_node_id": "104", "picker_config": picker_config, "minimum_region_pixels": 16},
            mode=4,
        ),
        preview_from(by_id[54], 108, "局部选区预览｜实际生效区域", (8200, 7000), mode=4),
        node(
            109, "DAELAB.BadgeSemanticRegionGPTChannelV1", "局部修改｜严格区域生成", (7860, 6120), (500, 440),
            [
                inp("base_image", "IMAGE"), inp("region_mask", "MASK"), inp("foreground_mask", "MASK"),
                inp("enabled", "BOOLEAN", widget=True), inp("edit_prompt", "STRING", widget=True),
                inp("quality", "COMBO", widget=True), inp("reroll_revision", "INT", widget=True), inp("minimum_region_pixels", "INT", widget=True),
            ],
            [out("region_image", "IMAGE"), out("validated_mask", "MASK"), out("call_status", "STRING")],
            [False, "", "high", 0, 16],
            {"enabled": False, "edit_prompt": "", "quality": "high", "reroll_revision": 0, "minimum_region_pixels": 16},
            mode=4,
        ),
        node(
            110, "DAELAB.BadgeLazyImageSwitchV1", "当前主图｜选择原图或局部修改结果", (8850, 6180), (360, 150),
            [inp("condition", "BOOLEAN", widget=True), inp("false_image", "IMAGE"), inp("true_image", "IMAGE")],
            [out("image", "IMAGE"), out("status", "STRING")],
            [False], {"condition": False},
        ),
        preview_from(by_id[54], 111, "当前主图｜局部修改后", (9250, 6100), preserve_mode=True),
        node(
            112, "DAELAB.BadgeLazyImageSwitchV1", "最终结果｜选择主图或棚拍图", (10200, 6180), (360, 150),
            [inp("condition", "BOOLEAN", widget=True), inp("false_image", "IMAGE"), inp("true_image", "IMAGE")],
            [out("image", "IMAGE"), out("status", "STRING")],
            [False], {"condition": False},
        ),
        preview_from(by_id[54], 113, "最终结果", (10600, 6100), preserve_mode=True),
        preview_any_from(by_id[66], 114, "运行状态｜当前制作路线", (5200, 6550), preserve_mode=True),
        preview_any_from(by_id[66], 115, "运行状态｜颜色编号图", (6600, 6840), mode=4),
        preview_from(by_id[54], 116, "取色参考图｜局部修改当前基准", (7050, 7250), mode=4),
        preview_any_from(by_id[66], 117, "运行状态｜局部修改确认", (8200, 6750), mode=4),
        controller(130, "[Bypass] 路线 1", (1750, 3060), "daelab-badge-route-1"),
        controller(131, "[Bypass] 路线 1 特殊材质", (5050, 4050), "daelab-badge-route-1-material"),
        controller(132, "[Bypass] 路线 2", (2150, 6320), "daelab-badge-route-2"),
        controller(133, "[Bypass] 局部修改", (5960, 6040), "daelab-badge-local"),
        controller(134, "[Bypass] Color ID Map", (6020, 6420), "daelab-badge-local-map"),
        controller(135, "[Bypass] 局部应用", (7780, 6040), "daelab-badge-local-apply"),
        controller(136, "[Bypass] 棚拍", (9620, 6040), "daelab-badge-studio"),
        controller(137, "[Bypass] 局部材质选择", (7320, 7080), "daelab-badge-local-material"),
    ]

    route_2_upload = new_nodes[1]
    route_2_upload.update({"id": 96, "pos": [2150, 6460], "order": 96, "mode": 4, "title": "路线二｜上传现有徽章效果图"})
    route_2_upload["outputs"] = [out("IMAGE", "IMAGE"), out("MASK", "MASK")]
    route_2_upload["widgets_values"] = ["ComfyUI_temp_xdxpu_00001_.png", "image"]
    route_2_upload["widgets_values_named"] = {"image": "ComfyUI_temp_xdxpu_00001_.png", "upload": "image"}
    route_2_upload.setdefault("properties", {}).update({
        "daelab_show_app_preview": True,
        "daelab_app_preview_heading": "取色参考图｜现有徽章效果图（用于局部修改选区）",
    })
    route_2_image_input = next(value for value in route_2_upload["inputs"] if value.get("name") == "image")
    route_2_image_input["label"] = "上传现有徽章效果图"
    route_2_image_input["localized_name"] = "上传现有徽章效果图"

    local_material = new_nodes[11]
    local_material.update({"id": 106, "pos": [7350, 7140], "order": 106, "mode": 4, "title": "局部修改｜选择目标材质"})
    local_material["widgets_values"] = ["亚金", "仅把选中区域转换为指定材质。", "保持形状、文字与未选区域完全不变。"]
    local_material["widgets_values_named"] = {
        "material_id": "亚金",
        "base_prompt": "仅把选中区域转换为指定材质。",
        "additional_details": "保持形状、文字与未选区域完全不变。",
    }
    local_material["properties"] = {
        "Node name for S&R": "GPTImage2MaterialPrompt",
        "gpt_image2_material_id": "satin_gold",
        "daelab_app_heading": "局部修改｜选择目标材质",
    }

    # Make picker configuration part of the submitted prompt. Workflow
    # properties remain for backwards-compatible serialization, while the
    # input value gives ComfyUI a cache key that changes with every UI edit.
    for candidate in [*retained, *new_nodes]:
        if candidate.get("type") != "DAELabMultiColorMaskV1":
            continue
        properties = candidate.setdefault("properties", {})
        encoded = properties.get("multi_color_mask_v1_config", picker_config)
        inputs = candidate.get("inputs")
        if not isinstance(inputs, list):
            inputs = [inputs] if isinstance(inputs, dict) else []
        if not any(
            isinstance(item, dict) and item.get("name") == "config_json"
            for item in inputs
        ):
            inputs.append(inp("config_json", "STRING", widget=True))
        candidate["inputs"] = inputs
        widget_inputs = [
            item for item in inputs
            if isinstance(item, dict) and item.get("widget")
        ]
        values = list(candidate.get("widgets_values") or [])
        while len(values) < len(widget_inputs):
            values.append(encoded)
        if widget_inputs:
            values[len(widget_inputs) - 1] = encoded
        candidate["widgets_values"] = values

    studio = retained_by_id[87]
    studio.update({"pos": [9650, 6150], "order": 87, "mode": 4, "title": "棚拍效果图｜现有 #8.6 流程"})
    for entry in studio.get("inputs", []):
        entry["link"] = None
        if entry.get("name") == "prompt":
            entry["label"] = "棚拍效果图提示词"
            entry["localized_name"] = "棚拍效果图提示词"
    for entry in studio.get("outputs", []):
        entry["links"] = []

    workflow["nodes"] = retained + new_nodes
    nodes = {entry["id"]: entry for entry in workflow["nodes"]}
    original_links = list(workflow.get("links", []))
    preview_sources = {
        link[3]: (link[1], link[2], link[5])
        for link in original_links
        if link[3] in PERMANENT_BYPASS_IDS and link[4] == 0
    }

    for entry in workflow["nodes"]:
        for socket in entry.get("inputs", []):
            socket["link"] = None
        for socket in entry.get("outputs", []):
            socket["links"] = []

    endpoints = []
    retained_ids = set(retained_by_id)
    for link in original_links:
        if link[1] in retained_ids and link[3] in retained_ids and link[1] != 87 and link[3] != 87:
            source, source_slot, value_type = link[1], link[2], link[5]
            visited = set()
            while source in preview_sources and source not in visited:
                visited.add(source)
                source, source_slot, value_type = preview_sources[source]
            endpoints.append((source, source_slot, link[3], link[4], value_type))

    def slot(node_id, input_name):
        return next(index for index, value in enumerate(nodes[node_id]["inputs"]) if value["name"] == input_name)

    def connect(source, source_slot, target, input_name, value_type):
        endpoints.append((source, source_slot, target, slot(target, input_name), value_type))

    # Hierarchy output indexes follow hierarchy_items above.
    connect(95, 2, 98, "condition", "BOOLEAN")
    connect(9, 0, 98, "false_image", "IMAGE")
    connect(65, 0, 98, "true_image", "IMAGE")
    connect(96, 0, 97, "effect_image", "IMAGE")
    connect(95, 1, 99, "route_flat_height", "BOOLEAN")
    connect(95, 3, 99, "route_effect", "BOOLEAN")
    connect(98, 0, 99, "route_1_master", "IMAGE")
    connect(67, 0, 99, "route_1_reference", "IMAGE")
    connect(67, 2, 99, "route_1_support", "MASK")
    connect(97, 0, 99, "route_2_master", "IMAGE")
    connect(97, 1, 99, "route_2_reference", "IMAGE")
    connect(97, 2, 99, "route_2_support", "MASK")
    connect(99, 0, 100, "images", "IMAGE")
    connect(95, 6, 101, "enabled", "BOOLEAN")
    connect(99, 0, 101, "master_image", "IMAGE")
    connect(101, 0, 102, "images", "IMAGE")
    connect(95, 6, 103, "condition", "BOOLEAN")
    connect(99, 1, 103, "false_image", "IMAGE")
    connect(101, 0, 103, "true_image", "IMAGE")
    connect(103, 0, 104, "images", "IMAGE")
    connect(95, 7, 105, "semantic_mode", "BOOLEAN")
    connect(95, 8, 105, "material_mode", "BOOLEAN")
    connect(95, 9, 105, "requested_apply", "BOOLEAN")
    connect(106, 0, 105, "material_prompt", "STRING")
    connect(106, 1, 105, "material_id", "STRING")
    connect(99, 0, 107, "pre_edit_master", "IMAGE")
    connect(103, 0, 107, "selection_reference", "IMAGE")
    connect(104, 0, 107, "candidate_mask", "MASK")
    connect(99, 2, 107, "edit_support_mask", "MASK")
    connect(95, 9, 107, "requested_apply", "BOOLEAN")
    connect(99, 3, 107, "route_id", "STRING")
    connect(95, 6, 107, "map_mode", "BOOLEAN")
    connect(101, 1, 107, "map_cache_key", "STRING")
    connect(105, 1, 107, "edit_mode", "STRING")
    connect(105, 3, 107, "action_digest", "STRING")
    connect(107, 1, 108, "images", "IMAGE")
    connect(99, 0, 109, "base_image", "IMAGE")
    connect(107, 0, 109, "region_mask", "MASK")
    connect(99, 2, 109, "foreground_mask", "MASK")
    connect(107, 2, 109, "enabled", "BOOLEAN")
    connect(105, 0, 109, "edit_prompt", "STRING")
    connect(95, 5, 110, "condition", "BOOLEAN")
    connect(99, 0, 110, "false_image", "IMAGE")
    connect(109, 0, 110, "true_image", "IMAGE")
    connect(110, 0, 111, "images", "IMAGE")
    connect(110, 0, 87, "model.images.image_1", "IMAGE")
    connect(95, 10, 112, "condition", "BOOLEAN")
    connect(110, 0, 112, "false_image", "IMAGE")
    connect(87, 0, 112, "true_image", "IMAGE")
    connect(112, 0, 113, "images", "IMAGE")
    connect(99, 4, 114, "source", "STRING")
    connect(101, 2, 115, "source", "STRING")
    connect(103, 0, 116, "images", "IMAGE")
    connect(107, 4, 117, "source", "STRING")
    for controller_id, hierarchy_slot in ((130, 1), (131, 2), (132, 3), (133, 5), (134, 6), (135, 9), (136, 10), (137, 8)):
        connect(95, hierarchy_slot, controller_id, "boolean", "BOOLEAN")

    links = []
    for link_id, (source, source_slot, target, target_slot, value_type) in enumerate(endpoints, start=1):
        nodes[source]["outputs"][source_slot].setdefault("links", []).append(link_id)
        nodes[target]["inputs"][target_slot]["link"] = link_id
        links.append([link_id, source, source_slot, target, target_slot, value_type])
    workflow["links"] = links
    workflow["last_link_id"] = len(links)
    workflow["last_node_id"] = max(nodes)
    workflow["revision"] = int(workflow.get("revision") or 0) + 1

    existing_groups = [
        entry for entry in workflow.get("groups", [])
        if not str(entry.get("title", "")).startswith("[PP]")
        and not str(entry.get("title", "")).startswith("[Temp]")
        and not str(entry.get("title", "")).startswith("[App ")
    ]
    workflow["groups"] = existing_groups + [
        group("daelab-badge-route-1", "[App Route 1] 平面图 + 层次图", (1700, 3000, 6100, 2950), "#2f6d8f"),
        group("daelab-badge-route-1-material", "[App Route 1 / Material] 特殊材质", (5000, 4000, 2780, 1800), "#7b5b9d"),
        group("daelab-badge-route-2", "[App Route 2] 现有效果图", (2080, 6280, 980, 760), "#2f8f72"),
        group("daelab-badge-local", "[App Local] 局部修改", (5900, 5980, 2900, 1700), "#8f6c2f"),
        group("daelab-badge-local-map", "[App Local / Map] Color ID Map", (5980, 6380, 1250, 650), "#9b3f68"),
        group("daelab-badge-local-material", "[App Local / Material] 目标材质", (7280, 7040, 600, 630), "#7b5b9d"),
        group("daelab-badge-local-apply", "[App Local / Apply] 严格局部 GPT", (7720, 6000, 700, 650), "#9b5f3f"),
        group("daelab-badge-studio", "[App Studio] 棚拍", (9600, 6000, 600, 650), "#4b6599"),
    ]

    workflow_id = str(workflow.get("id") or "")
    scoped = lambda node_id, widget: [f"{workflow_id}:{node_id}:{widget}", widget]
    workflow.setdefault("extra", {})["linearData"] = {
        "inputs": [
            scoped(95, "boolean_hierarchy_editor"),
            scoped(1, "image"),
            scoped(47, "multi_color_mask_v1_panel"),
            scoped(2, "image"),
            scoped(3, "badge_height_layer_v1_panel"),
            scoped(55, "material_thumbnail_dom_selector"),
            scoped(49, "badge_material_region_v1_panel"),
            scoped(96, "image"),
            scoped(104, "multi_color_mask_v1_panel"),
            scoped(105, "semantic_prompt"),
            scoped(106, "material_thumbnail_dom_selector"),
            scoped(87, "prompt"),
        ],
        "outputs": ["100", "114", "102", "115", "116", "108", "117", "111", "113"],
    }
    return workflow


def main():
    workflow = build()
    WORKFLOW.write_text(json.dumps(workflow, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Updated {WORKFLOW} with {len(workflow['nodes'])} nodes and {len(workflow['links'])} links")


if __name__ == "__main__":
    main()
