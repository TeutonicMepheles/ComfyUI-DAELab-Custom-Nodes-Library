from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "user" / "default" / "workflows" / "#8.4 - Badge Workflow.json"
MANAGED_NODE_IDS = {55, 56, 57, 58, 59, 60}
MANAGED_LINK_IDS = {5, 84, 88, 89, 90, 91, 92, 93, 94, 95, 96}


def node_by_id(workflow: dict, node_id: int) -> dict:
    return next(node for node in workflow["nodes"] if node["id"] == node_id)


def set_input_link(node: dict, name: str, link_id: int | None) -> None:
    next(entry for entry in node["inputs"] if entry["name"] == name)["link"] = link_id


def set_model_options(node: dict) -> None:
    values = list(node.get("widgets_values") or [])
    while len(values) < 10:
        values.append(None)
    values[2] = "1024x1024"
    values[3] = 1024
    values[4] = 1024
    values[5] = "opaque"
    values[6] = "high"
    node["widgets_values"] = values
    named = dict(node.get("widgets_values_named") or {})
    named.update({
        "model.size": "1024x1024",
        "model.custom_width": 1024,
        "model.custom_height": 1024,
        "model.background": "opaque",
        "model.quality": "high",
    })
    node["widgets_values_named"] = named


def clear_managed_links(workflow: dict) -> None:
    workflow["links"] = [link for link in workflow["links"] if link[0] not in MANAGED_LINK_IDS]
    for node in workflow["nodes"]:
        for entry in node.get("inputs") or []:
            if entry.get("link") in MANAGED_LINK_IDS:
                entry["link"] = None
        for output in node.get("outputs") or []:
            output["links"] = [
                link_id for link_id in (output.get("links") or []) if link_id not in MANAGED_LINK_IDS
            ]


def make_invert_mask() -> dict:
    return {
        "id": 58,
        "type": "InvertMask",
        "pos": [2945, 3860],
        "size": [225, 48],
        "flags": {},
        "order": 40,
        "mode": 0,
        "inputs": [{"localized_name": "遮罩", "name": "mask", "type": "MASK", "link": 91}],
        "outputs": [{"localized_name": "遮罩", "name": "MASK", "type": "MASK", "links": [92]}],
        "properties": {"Node name for S&R": "InvertMask"},
        "widgets_values": [],
        "title": "[Align] 反转背景遮罩为徽章前景",
    }


def make_height_align() -> dict:
    return {
        "id": 59,
        "type": "BadgeHeightReferenceAlignV1",
        "pos": [3200, 3860],
        "size": [390, 330],
        "flags": {},
        "order": 41,
        "mode": 0,
        "inputs": [
            {"localized_name": "design_foreground_mask", "name": "design_foreground_mask", "type": "MASK", "link": 92},
            {"localized_name": "height_map", "name": "height_map", "type": "MASK", "link": 93},
            {"localized_name": "unmatched_mask", "name": "unmatched_mask", "type": "MASK", "link": 94},
            {"localized_name": "minimum_iou", "name": "minimum_iou", "type": "FLOAT", "widget": {"name": "minimum_iou"}, "link": None},
            {"localized_name": "maximum_boundary_error_px", "name": "maximum_boundary_error_px", "type": "FLOAT", "widget": {"name": "maximum_boundary_error_px"}, "link": None},
            {"localized_name": "maximum_unmatched_percent", "name": "maximum_unmatched_percent", "type": "FLOAT", "widget": {"name": "maximum_unmatched_percent"}, "link": None},
            {"localized_name": "enforce", "name": "enforce", "type": "BOOLEAN", "widget": {"name": "enforce"}, "link": None},
        ],
        "outputs": [
            {"localized_name": "aligned_height", "name": "aligned_height", "type": "MASK", "links": []},
            {"localized_name": "aligned_height_image", "name": "aligned_height_image", "type": "IMAGE", "links": [95]},
            {"localized_name": "aligned_unmatched", "name": "aligned_unmatched", "type": "MASK", "links": []},
            {"localized_name": "contour_iou", "name": "contour_iou", "type": "FLOAT", "links": []},
            {"localized_name": "boundary_error_px", "name": "boundary_error_px", "type": "FLOAT", "links": []},
            {"localized_name": "valid", "name": "valid", "type": "BOOLEAN", "links": []},
            {"localized_name": "report", "name": "report", "type": "STRING", "links": [96]},
        ],
        "properties": {"Node name for S&R": "BadgeHeightReferenceAlignV1"},
        "widgets_values": [0.985, 1.5, 0.5, False],
        "widgets_values_named": {
            "minimum_iou": 0.985,
            "maximum_boundary_error_px": 1.5,
            "maximum_unmatched_percent": 0.5,
            "enforce": False,
        },
        "title": "[Align] 高度参考配准｜报告但不阻断",
    }


def main() -> None:
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    if workflow.get("last_node_id", 0) < 54:
        raise RuntimeError("Unexpected #8.4 workflow revision: required base nodes are missing.")

    templates = {node["id"]: copy.deepcopy(node) for node in workflow["nodes"] if node["id"] in {7, 18}}
    workflow["nodes"] = [node for node in workflow["nodes"] if node["id"] not in MANAGED_NODE_IDS]
    clear_managed_links(workflow)

    source = node_by_id(workflow, 2)
    source["widgets_values"] = ["Source-Refined-contours-v2.png", "image"]
    source["widgets_values_named"] = {"image": "Source-Refined-contours-v2.png", "upload": "image"}

    height_layer = node_by_id(workflow, 3)
    height_layer["outputs"][0]["links"] = [93]
    height_layer["outputs"][1]["links"] = []
    height_layer["outputs"][2]["links"] = [94]

    mask = node_by_id(workflow, 47)
    mask["outputs"][0]["links"] = sorted(set((mask["outputs"][0].get("links") or []) + [91]))

    height_preview = node_by_id(workflow, 6)
    height_preview["pos"] = [3660, 3860]
    set_input_link(height_preview, "images", 95)
    height_preview["title"] = "[Align] 已配准离散高度参考"

    height_builder = node_by_id(workflow, 8)
    height_builder["pos"] = [3660, 4320]
    height_builder["title"] = "[Prompt] 高度 + 参考色 + 烤漆基础成片"
    height_builder["inputs"] = height_builder["inputs"][:1] + [
        {"localized_name": "material_semantics", "name": "material_semantics", "shape": 7, "type": "STRING", "link": 88}
    ]
    height_builder["outputs"] = height_builder["outputs"][:3] + [
        {"localized_name": "base_render_prompt", "name": "base_render_prompt", "type": "STRING", "links": [90]}
    ]
    height_builder["outputs"][2]["links"] = []

    material = templates[18]
    material.update({
        "id": 55,
        "pos": [4710, 3895],
        "size": [390, 430],
        "order": 39,
        "title": "[Material] 烤漆语义｜参考色锁定",
    })
    material["outputs"][0]["links"] = []
    material["outputs"][1]["links"] = [88]
    material["outputs"][2]["links"] = []
    material["properties"]["gpt_image2_material_id"] = "baked_enamel"
    material["widgets_values"] = ["烤漆", "", ""]
    material["widgets_values_named"] = {
        "material_id": "烤漆",
        "base_prompt": "",
        "additional_details": "",
    }

    report_preview = templates[7]
    report_preview.update({
        "id": 60,
        "pos": [3200, 4230],
        "size": [390, 220],
        "order": 42,
        "title": "[Align Report] 配准与未匹配像素",
    })
    report_preview["inputs"][0]["link"] = 96
    report_preview["outputs"][0]["links"] = []

    gpt = node_by_id(workflow, 9)
    set_input_link(gpt, "prompt", 90)
    set_model_options(gpt)

    material_region = node_by_id(workflow, 49)
    config = json.loads(material_region["properties"]["badge_material_region_v1_config"])
    config["default_material_id"] = "baked_enamel"
    material_region["properties"]["badge_material_region_v1_config"] = json.dumps(
        config, ensure_ascii=False, separators=(",", ":")
    )
    material_region["title"] = "[Material Regions] 局部覆盖｜未匹配区域保持烤漆"

    material_gpt = node_by_id(workflow, 53)
    set_model_options(material_gpt)

    workflow["nodes"].extend([material, make_invert_mask(), make_height_align(), report_preview])
    workflow["links"].extend([
        [88, 55, 1, 8, 1, "STRING"],
        [90, 8, 3, 9, 0, "STRING"],
        [91, 47, 0, 58, 0, "MASK"],
        [92, 58, 0, 59, 0, "MASK"],
        [93, 3, 0, 59, 1, "MASK"],
        [94, 3, 2, 59, 2, "MASK"],
        [95, 59, 1, 6, 0, "IMAGE"],
        [96, 59, 6, 60, 0, "STRING"],
    ])
    workflow["links"].sort(key=lambda link: link[0])

    height_input_group = next(group for group in workflow["groups"] if group["id"] == 4)
    height_input_group["title"] = "[Height Input] 离散高度、配准与诊断"
    height_input_group["bounding"] = [2460, 3780, 1620, 930]

    height_group = next(group for group in workflow["groups"] if group["id"] == 5)
    height_group["title"] = "[Height Generate] 单一 Builder：结构 + 参考色烤漆初版｜GPT-Image-2"
    height_group["bounding"] = [4680, 3826.362890486908, 2075, 800]

    workflow["revision"] = max(int(workflow.get("revision") or 0), 2)
    workflow["last_node_id"] = max(node["id"] for node in workflow["nodes"])
    workflow["last_link_id"] = max(link[0] for link in workflow["links"])
    WORKFLOW.write_text(
        json.dumps(workflow, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
