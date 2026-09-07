from __future__ import annotations

import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "user" / "default" / "workflows" / "#8.6 - Badge Workflow.json"
EXPECTED_COUNTS = {"nodes": 66, "links": 129, "groups": 20}
EXPECTED_OUTPUTS = ["100", "114", "102", "115", "116", "108", "117", "111", "113"]
EXPECTED_GETS = {
    138: ("badge.path", [
        "badge.path.flat_height",
        "badge.path.flat_height.special_material",
        "badge.path.effect",
    ]),
    139: ("badge.path", [
        "badge.path.flat_height",
        "badge.path.flat_height.special_material",
        "badge.path.effect",
    ]),
    140: ("badge.post", [
        "badge.post.local",
        "badge.post.local.color_id_map",
        "badge.post.local.semantic",
        "badge.post.local.material",
        "badge.post.local.apply",
        "badge.post.studio",
        "badge.post.local.selection.color",
        "badge.post.local.selection.polygon",
    ]),
    141: ("badge.post", [
        "badge.post.local",
        "badge.post.local.color_id_map",
        "badge.post.local.semantic",
        "badge.post.local.material",
        "badge.post.local.apply",
        "badge.post.studio",
        "badge.post.local.selection.color",
        "badge.post.local.selection.polygon",
    ]),
}
EXPECTED_CONTROLLERS = {
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


def scoped(workflow_id: str, node_id: int, widget_name: str) -> str:
    return f"{workflow_id}:{node_id}:{widget_name}"


def expected_input_keys(workflow_id: str) -> list[str]:
    return [
        scoped(workflow_id, 95, "boolean_hierarchy_editor"),
        scoped(workflow_id, 1, "image"),
        scoped(workflow_id, 47, "multi_color_mask_v1_panel"),
        scoped(workflow_id, 2, "image"),
        scoped(workflow_id, 3, "badge_height_layer_v1_panel"),
        scoped(workflow_id, 55, "material_thumbnail_dom_selector"),
        scoped(workflow_id, 49, "badge_material_region_v1_panel"),
        scoped(workflow_id, 96, "image"),
        scoped(workflow_id, 104, "multi_color_mask_v1_panel"),
        scoped(workflow_id, 142, "polygon_canvas"),
        scoped(workflow_id, 105, "semantic_prompt"),
        scoped(workflow_id, 106, "material_thumbnail_dom_selector"),
        scoped(workflow_id, 87, "prompt"),
    ]


def build_layout(workflow_id: str) -> dict:
    keys = expected_input_keys(workflow_id)
    (
        control,
        flat_image,
        flat_colors,
        height_image,
        height_settings,
        base_material,
        special_material,
        effect_image,
        local_selection,
        local_polygon,
        local_prompt,
        local_material,
        studio_prompt,
    ) = keys
    return {
        "version": 1,
        "defaultTab": "control",
        "stateSource": {"nodeId": 95, "interface": "daelabBooleanHierarchyV1"},
        "inputKeys": keys,
        "tabs": [
            {"id": "control", "title": "控制面板", "inputKeys": [control]},
            {
                "id": "build",
                "title": "效果图建立",
                "inputKeys": [
                    flat_image,
                    flat_colors,
                    height_image,
                    height_settings,
                    base_material,
                    special_material,
                    effect_image,
                ],
            },
            {
                "id": "local",
                "title": "局部修改",
                "enabledItemId": "badge.post.local",
                "inputKeys": [local_selection, local_polygon, local_prompt, local_material],
            },
            {
                "id": "studio",
                "title": "棚拍效果优化",
                "enabledItemId": "badge.post.studio",
                "inputKeys": [studio_prompt],
            },
        ],
        "quickControls": {
            "control": [],
            "build": [
                {
                    "id": "build-route",
                    "kind": "choice",
                    "label": "制作路线",
                    "items": [
                        {"itemId": "badge.path.flat_height", "label": "平面图 + 层次图"},
                        {"itemId": "badge.path.effect", "label": "现有效果图"},
                    ],
                },
                {
                    "id": "build-special-material",
                    "kind": "toggle",
                    "label": "特殊材质",
                    "itemId": "badge.path.flat_height.special_material",
                },
            ],
            "local": [
                {
                    "id": "local-enabled",
                    "kind": "toggle",
                    "label": "局部修改",
                    "itemId": "badge.post.local",
                },
                {
                    "id": "local-selection-mode",
                    "kind": "choice",
                    "label": "选区方式",
                    "items": [
                        {"itemId": "badge.post.local.selection.color", "label": "按颜色"},
                        {"itemId": "badge.post.local.selection.polygon", "label": "自绘遮罩"},
                    ],
                },
                {
                    "id": "local-color-map",
                    "kind": "toggle",
                    "label": "Color ID Map",
                    "itemId": "badge.post.local.color_id_map",
                },
                {
                    "id": "local-edit-mode",
                    "kind": "choice",
                    "label": "编辑模式",
                    "items": [
                        {"itemId": "badge.post.local.semantic", "label": "纯语义"},
                        {"itemId": "badge.post.local.material", "label": "目标材质"},
                    ],
                },
                {
                    "id": "local-apply",
                    "kind": "toggle",
                    "label": "应用局部修改",
                    "itemId": "badge.post.local.apply",
                },
            ],
            "studio": [
                {
                    "id": "studio-enabled",
                    "kind": "toggle",
                    "label": "棚拍效果",
                    "itemId": "badge.post.studio",
                },
            ],
        },
        "referenceSources": [
            {
                "id": "build-flat",
                "tabId": "build",
                "kind": "inputWidget",
                "nodeId": 1,
                "widgetName": "image",
                "inputKey": flat_image,
                "title": "徽章平面图",
                "visibleWhen": {"itemId": "badge.path.flat_height", "value": True},
                "focusInputKeys": [flat_colors, base_material, special_material],
            },
            {
                "id": "build-height",
                "tabId": "build",
                "kind": "inputWidget",
                "nodeId": 2,
                "widgetName": "image",
                "inputKey": height_image,
                "title": "高度层次图",
                "visibleWhen": {"itemId": "badge.path.flat_height", "value": True},
                "focusInputKeys": [height_settings],
            },
            {
                "id": "build-effect",
                "tabId": "build",
                "kind": "inputWidget",
                "nodeId": 96,
                "widgetName": "image",
                "inputKey": effect_image,
                "title": "现有效果图",
                "visibleWhen": {"itemId": "badge.path.effect", "value": True},
                "focusInputKeys": [],
            },
            {
                "id": "local-current-reference",
                "tabId": "local",
                "kind": "executionOutput",
                "nodeId": 116,
                "outputField": "images",
                "title": "局部修改当前选区基准",
                "focusInputKeys": [local_selection, local_polygon, local_prompt, local_material],
            },
            {
                "id": "studio-current-master",
                "tabId": "studio",
                "kind": "executionOutput",
                "nodeId": 111,
                "outputField": "images",
                "title": "棚拍前当前主图",
                "focusInputKeys": [studio_prompt],
            },
        ],
        "polygonChange": {
            "nodeId": 142,
            "selectionItemId": "badge.post.local.selection.polygon",
            "applyItemId": "badge.post.local.apply",
        },
    }


def parse_json(value, context: str):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError(f"{context} is not valid JSON: {error}") from error


def validate_baseline(workflow: dict) -> None:
    errors: list[str] = []
    workflow_id = str(workflow.get("id") or "").strip()
    if not workflow_id:
        errors.append("workflow id is missing")

    for collection, expected_count in EXPECTED_COUNTS.items():
        actual = len(workflow.get(collection, []))
        if actual != expected_count:
            errors.append(f"expected {expected_count} {collection}, found {actual}")

    nodes = {node.get("id"): node for node in workflow.get("nodes", [])}
    links = {link[0]: link for link in workflow.get("links", [])}
    if set(links) != set(range(1, EXPECTED_COUNTS["links"] + 1)):
        errors.append(
            f"link IDs are not the expected contiguous 1..{EXPECTED_COUNTS['links']} baseline"
        )

    expected_inputs = expected_input_keys(workflow_id)
    linear = workflow.get("extra", {}).get("linearData", {})
    actual_inputs = [entry[0] for entry in linear.get("inputs", [])]
    if actual_inputs != expected_inputs:
        errors.append("linearData.inputs does not match the current #8.6 contract")
    if linear.get("outputs") != EXPECTED_OUTPUTS:
        errors.append("linearData.outputs does not match the current #8.6 contract")

    state_node = nodes.get(95)
    if state_node is None or state_node.get("type") != "BooleanListHierarchy":
        errors.append("state source node 95 is missing or has the wrong type")
    else:
        if any(output.get("links") for output in state_node.get("outputs", [])):
            errors.append("node 95 must not have direct business output links")
        try:
            items = parse_json(
                state_node.get("widgets_values_named", {}).get("config_json"),
                "node 95 hierarchy",
            )
            values = {item.get("id"): item.get("value") for item in items}
            if values.get("badge.path.flat_height.special_material") is not True:
                errors.append("saved Special Material state is not the expected enabled baseline")
        except ValueError as error:
            errors.append(str(error))

    for node_id, (root_item_id, output_item_ids) in EXPECTED_GETS.items():
        node = nodes.get(node_id)
        if node is None or node.get("type") != "BooleanListHierarchyGet":
            errors.append(f"Get node {node_id} is missing or has the wrong type")
            continue
        if node.get("mode", 0) != 0 or node.get("properties", {}).get("daelab_preserve_mode") is not True:
            errors.append(f"Get node {node_id} must remain Active with daelab_preserve_mode")
        try:
            snapshot = parse_json(
                node.get("widgets_values_named", {}).get("config_json"),
                f"Get node {node_id} snapshot",
            )
            if snapshot.get("source_node_id") != "95":
                errors.append(f"Get node {node_id} does not source node 95")
            if snapshot.get("root_item_id") != root_item_id or snapshot.get("include_root") is not False:
                errors.append(f"Get node {node_id} has the wrong branch selection")
            if snapshot.get("output_item_ids") != output_item_ids:
                errors.append(f"Get node {node_id} output_item_ids changed")
            labels = {item.get("id"): item.get("label") for item in snapshot.get("items", [])}
            expected_labels = [labels.get(item_id) for item_id in output_item_ids]
            if [output.get("name") for output in node.get("outputs", [])] != expected_labels:
                errors.append(f"Get node {node_id} output order/labels changed")
        except ValueError as error:
            errors.append(str(error))

    for controller_id, (source_id, source_slot, group_id) in EXPECTED_CONTROLLERS.items():
        controller = nodes.get(controller_id)
        if controller is None or controller.get("type") != "BooleanGroupBypassController":
            errors.append(f"controller {controller_id} is missing or has the wrong type")
            continue
        if controller.get("properties", {}).get("target_group_id") != group_id:
            errors.append(f"controller {controller_id} target group changed")
        input_socket = next(
            (entry for entry in controller.get("inputs", []) if entry.get("name") == "boolean"),
            None,
        )
        link = links.get(input_socket.get("link") if input_socket else None)
        if not link or (link[1], link[2], link[3]) != (source_id, source_slot, controller_id):
            errors.append(f"controller {controller_id} source wiring changed")

    get_ids = {str(node_id) for node_id in EXPECTED_GETS}
    if any(key.rsplit(":", 2)[-2] in get_ids for key in actual_inputs):
        errors.append("Get nodes 138-141 must not be App Mode inputs")
    if any(link[1] == 95 for link in workflow.get("links", [])):
        errors.append("node 95 has a direct link despite the Get distribution layer")

    if errors:
        joined = "\n - ".join(errors)
        raise ValueError(f"#8.6 baseline validation failed; no changes were written:\n - {joined}")


def update_workflow(path: Path = WORKFLOW) -> bool:
    workflow = json.loads(path.read_text(encoding="utf-8"))
    validate_baseline(workflow)
    layout = build_layout(str(workflow["id"]))
    extra = workflow.setdefault("extra", {})
    if extra.get("daelabAppLayoutV1") == layout:
        return False
    extra["daelabAppLayoutV1"] = layout

    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(workflow, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    os.replace(temporary, path)
    return True


def main() -> None:
    changed = update_workflow()
    action = "Added daelabAppLayoutV1 to" if changed else "Already up to date:"
    print(f"{action} {WORKFLOW}")


if __name__ == "__main__":
    main()
