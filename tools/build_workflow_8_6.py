from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / "user" / "default" / "workflows"
SOURCE_PATH = WORKFLOW_DIR / "#8.4 - Badge Workflow.json"
DONOR_PATH = WORKFLOW_DIR / "#8.5 - Badge Workflow.json"
OUTPUT_PATH = WORKFLOW_DIR / "#8.6 - Badge Workflow.json"

CHANNEL_IDS = (61, 62, 63, 64)
MERGE_ID = 65
REPORT_ID = 66
NORMALIZE_ID = 67
NORMALIZE_REPORT_ID = 68
LEGACY_MATERIAL_GPT_ID = 53
MATERIAL_PREVIEW_ID = 54


def node_by_id(workflow: dict, node_id: int) -> dict:
    return next(node for node in workflow["nodes"] if node["id"] == node_id)


def clone_node(workflow: dict, node_id: int, new_id: int, pos: tuple[float, float]) -> dict:
    node = copy.deepcopy(node_by_id(workflow, node_id))
    node["id"] = new_id
    node["pos"] = list(pos)
    node["order"] = new_id
    node["mode"] = 0
    for input_entry in node.get("inputs", []):
        input_entry["link"] = None
    for output_entry in node.get("outputs", []):
        output_entry["links"] = []
    return node


def rebuild_links(workflow: dict, endpoints: list[tuple[int, int, int, int, str]]) -> None:
    nodes = {node["id"]: node for node in workflow["nodes"]}
    for node in nodes.values():
        for input_entry in node.get("inputs", []):
            input_entry["link"] = None
        for output_entry in node.get("outputs", []):
            output_entry["links"] = []

    links = []
    for link_id, (source, source_slot, target, target_slot, link_type) in enumerate(endpoints, start=1):
        if source not in nodes or target not in nodes:
            raise ValueError(f"Missing link endpoint: {source}:{source_slot} -> {target}:{target_slot}")
        source_node = nodes[source]
        target_node = nodes[target]
        source_node["outputs"][source_slot].setdefault("links", []).append(link_id)
        target_node["inputs"][target_slot]["link"] = link_id
        links.append([link_id, source, source_slot, target, target_slot, link_type])

    workflow["links"] = links
    workflow["last_link_id"] = len(links)


def build() -> dict:
    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    donor = json.loads(DONOR_PATH.read_text(encoding="utf-8"))
    workflow = copy.deepcopy(source)

    # The old 8.4 material stage asks one unmasked GPT call to reinterpret the
    # whole image. 8.6 replaces only that node; every other 8.4 node keeps its
    # persisted position and size.
    workflow["nodes"] = [
        node for node in workflow["nodes"] if node["id"] != LEGACY_MATERIAL_GPT_ID
    ]

    # Freeze the established 8.4 baked-enamel base so changing one region's
    # reroll revision does not regenerate the whole badge.
    base_gpt = node_by_id(workflow, 9)
    base_gpt["widgets_values"][-1] = "fixed"
    base_gpt.setdefault("widgets_values_named", {})["control_after_generate"] = "fixed"

    channel_positions = (
        (5090.0, 4740.0),
        (5540.0, 4740.0),
        (5090.0, 5090.0),
        (5540.0, 5090.0),
    )
    for slot, (new_id, pos) in enumerate(zip(CHANNEL_IDS, channel_positions), start=1):
        channel = clone_node(donor, 23 + slot, new_id, pos)
        channel["title"] = f"[Material Region {slot}] GPT-Image-2 + Strict Mask"
        channel["widgets_values"] = [slot, "high", 4, 16]
        channel["widgets_values_named"] = {
            "region_slot": slot,
            "quality": "high",
            "max_regions": 4,
            "minimum_region_pixels": 16,
        }
        workflow["nodes"].append(channel)

    merge = clone_node(donor, 9, MERGE_ID, (6000.0, 4740.0))
    merge["title"] = "[Material Merge] 4 条严格区域通道"
    workflow["nodes"].append(merge)

    report = clone_node(donor, 18, REPORT_ID, (6480.0, 4740.0))
    report["title"] = "[Material QA] GPT 调用与 Mask 合并报告"
    workflow["nodes"].append(report)

    normalize = {
        "id": NORMALIZE_ID,
        "type": "DAELAB.BadgeMaterialCanvasNormalizeV1",
        "pos": [4590.0, 4740.0],
        "size": [430.0, 320.0],
        "flags": {},
        "order": NORMALIZE_ID,
        "mode": 0,
        "inputs": [
            {"name": "base_image", "type": "IMAGE", "link": None},
            {"name": "flat_image", "type": "IMAGE", "link": None},
            {"name": "height_map", "type": "MASK", "link": None},
            {"name": "foreground_mask", "type": "MASK", "link": None},
        ],
        "outputs": [
            {"name": "normalized_flat_image", "type": "IMAGE", "links": []},
            {"name": "normalized_height_map", "type": "MASK", "links": []},
            {"name": "normalized_foreground_mask", "type": "MASK", "links": []},
            {"name": "report", "type": "STRING", "links": []},
        ],
        "title": "[Material Align] 匹配烤漆基础图实际尺寸",
        "properties": {"Node name for S&R": "DAELAB.BadgeMaterialCanvasNormalizeV1"},
        "widgets_values": [],
    }
    workflow["nodes"].append(normalize)

    normalize_report = clone_node(donor, 18, NORMALIZE_REPORT_ID, (4590.0, 5110.0))
    normalize_report["title"] = "[Material Align QA] 输入与输出尺寸"
    workflow["nodes"].append(normalize_report)

    workflow["nodes"].sort(key=lambda node: node["id"])
    workflow["last_node_id"] = NORMALIZE_REPORT_ID

    # Preserve every original 8.4 connection except links touching the removed
    # unmasked material GPT and the old input of the material-result preview.
    endpoints = []
    for _, source_id, source_slot, target_id, target_slot, link_type in source["links"]:
        if LEGACY_MATERIAL_GPT_ID in (source_id, target_id):
            continue
        if target_id == MATERIAL_PREVIEW_ID and target_slot == 0:
            continue
        if target_id == 49 and target_slot == 0:
            continue
        endpoints.append((source_id, source_slot, target_id, target_slot, link_type))

    # The first GPT render is configured for 1024 output while the established
    # 8.4 source artwork is 1254. Normalize every label-bearing material input
    # to the actual base image canvas before color matching or masked editing.
    endpoints.extend((
        (10, 0, NORMALIZE_ID, 0, "IMAGE"),
        (11, 0, NORMALIZE_ID, 1, "IMAGE"),
        (59, 0, NORMALIZE_ID, 2, "MASK"),
        (58, 0, NORMALIZE_ID, 3, "MASK"),
        (NORMALIZE_ID, 0, 49, 0, "IMAGE"),
        (NORMALIZE_ID, 2, 49, 1, "MASK"),
        (NORMALIZE_ID, 3, NORMALIZE_REPORT_ID, 0, "STRING"),
    ))

    # Four canvas-visible channels share one immutable 8.4 base. Region masks
    # are resolved from the material-region set generated from the flat artwork.
    for channel_id in CHANNEL_IDS:
        endpoints.extend((
            (10, 0, channel_id, 0, "IMAGE"),
            (NORMALIZE_ID, 0, channel_id, 1, "IMAGE"),
            (NORMALIZE_ID, 1, channel_id, 2, "MASK"),
            (49, 8, channel_id, 3, "BADGE_MATERIAL_REGION_SET"),
        ))

    endpoints.append((10, 0, MERGE_ID, 0, "IMAGE"))
    for index, channel_id in enumerate(CHANNEL_IDS):
        merge_input = 1 + index * 3
        endpoints.extend((
            (channel_id, 0, MERGE_ID, merge_input, "IMAGE"),
            (channel_id, 1, MERGE_ID, merge_input + 1, "MASK"),
            (channel_id, 2, MERGE_ID, merge_input + 2, "STRING"),
        ))
    endpoints.extend((
        (MERGE_ID, 0, MATERIAL_PREVIEW_ID, 0, "IMAGE"),
        (MERGE_ID, 1, REPORT_ID, 0, "STRING"),
    ))
    rebuild_links(workflow, endpoints)

    workflow["groups"].append({
        "id": 13,
        "title": "[Material Generate 8.6] 4 条画布可见 GPT-Image-2 严格区域通道",
        "bounding": [4540.0, 4680.0, 2410.0, 790.0],
        "color": "#3f789e",
        "font_size": 24,
        "flags": {},
    })

    # App Mode builds its inspector state at runtime. Persisting stale
    # linearData causes duplicated or orphaned controls after workflow reload.
    workflow.setdefault("extra", {}).pop("linearData", None)
    return workflow


if __name__ == "__main__":
    OUTPUT_PATH.write_text(
        json.dumps(build(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(OUTPUT_PATH)
