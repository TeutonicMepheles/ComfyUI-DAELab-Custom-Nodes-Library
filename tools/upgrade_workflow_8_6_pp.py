from __future__ import annotations

import copy
import json
from pathlib import Path


WORKFLOW = Path(__file__).parents[1] / "user" / "default" / "workflows" / "#8.6 - Badge Workflow.json"
OLD_PP_NODE_IDS = {15, 16, 17, 27, 31, 32, 33, 34, 35, 40, 42, 43, 44}


def socket(name, value_type, link=None, widget=False):
    item = {"localized_name": name, "name": name, "type": value_type, "link": link}
    if widget:
        item["widget"] = {"name": name}
    return item


def output(name, value_type):
    return {"localized_name": name, "name": name, "type": value_type, "links": []}


def base_node(node_id, node_type, title, pos, size, order):
    return {
        "id": node_id,
        "type": node_type,
        "pos": list(pos),
        "size": list(size),
        "flags": {},
        "order": order,
        "mode": 0,
        "inputs": [],
        "outputs": [],
        "title": title,
        "properties": {"Node name for S&R": node_type},
    }


def mask_node(node_id, title, pos, color, order):
    node = base_node(node_id, "DAELabMultiColorMaskV1", title, pos, (360, 180), order)
    node["inputs"] = [socket("images", "IMAGE")]
    node["outputs"] = [{
        "label": "combined_mask",
        "localized_name": "combined_mask",
        "name": "mask",
        "type": "MASK",
        "links": [],
    }]
    config = {
        "version": 1,
        "groups": [{"id": f"semantic_{node_id}", "color": color, "threshold": 18, "invert": False}],
        "output": "combined_mask",
    }
    node["properties"].update({
        "multi_color_mask_v1_config": json.dumps(config, ensure_ascii=False, separators=(",", ":")),
        "multi_color_mask_v1_width": 360,
    })
    node["widgets_values"] = []
    node["widgets_values_named"] = {}
    return node


def semantic_node(node_id, title, pos, prompt, order):
    node = base_node(
        node_id,
        "DAELAB.BadgeSemanticRegionGPTChannelV1",
        title,
        pos,
        (430, 330),
        order,
    )
    node["inputs"] = [
        socket("base_image", "IMAGE"),
        socket("region_mask", "MASK"),
        socket("foreground_mask", "MASK"),
        socket("enabled", "BOOLEAN", widget=True),
        socket("edit_prompt", "STRING", widget=True),
        socket("quality", "COMBO", widget=True),
        socket("reroll_revision", "INT", widget=True),
        socket("minimum_region_pixels", "INT", widget=True),
    ]
    node["outputs"] = [
        output("region_image", "IMAGE"),
        output("validated_mask", "MASK"),
        output("call_status", "STRING"),
    ]
    node["widgets_values"] = [False, prompt, "high", 0, 16]
    node["widgets_values_named"] = {
        "enabled": False,
        "edit_prompt": prompt,
        "quality": "high",
        "reroll_revision": 0,
        "minimum_region_pixels": 16,
    }
    return node


def merge_node(order):
    node = base_node(
        77,
        "DAELAB.BadgeSemanticRegionMergeV1",
        "[PP Local Merge] 4 路确定性 Mask 合并｜后通道优先",
        (10020, 2550),
        (350, 430),
        order,
    )
    node["inputs"] = [socket("base_image", "IMAGE")]
    for slot in range(1, 5):
        node["inputs"].extend([
            socket(f"region_{slot}_image", "IMAGE"),
            socket(f"region_{slot}_mask", "MASK"),
            socket(f"region_{slot}_status", "STRING"),
        ])
    node["outputs"] = [output("image", "IMAGE"), output("report", "STRING")]
    return node


def studio_gpt_node(order):
    node = base_node(
        80,
        "DAELAB.BadgeStudioBackgroundGPTV1",
        "[PP Studio] GPT-Image-2 仅编辑背景",
        (13355, 3410),
        (440, 360),
        order,
    )
    node["inputs"] = [
        socket("badge_image", "IMAGE"),
        socket("foreground_mask", "MASK"),
        socket("enabled", "BOOLEAN", widget=True),
        socket("studio_prompt", "STRING", widget=True),
        socket("protection_px", "INT", widget=True),
        socket("quality", "COMBO", widget=True),
        socket("reroll_revision", "INT", widget=True),
    ]
    node["outputs"] = [
        output("studio_candidate", "IMAGE"),
        output("background_edit_mask", "MASK"),
        output("call_status", "STRING"),
    ]
    prompt = (
        "高级珠宝产品摄影，干净的中性无缝背景，柔和棚拍主光与轮廓光，"
        "自然接触阴影，主体居中，克制景深，不增加道具、文字或装饰。"
    )
    node["widgets_values"] = [True, prompt, 2, "high", 0]
    node["widgets_values_named"] = {
        "enabled": True,
        "studio_prompt": prompt,
        "protection_px": 2,
        "quality": "high",
        "reroll_revision": 0,
    }
    return node


def color_lock_node(order):
    node = base_node(
        82,
        "DAELAB.BadgeStudioColorLockV1",
        "[PP Final] 原平面图 OKLab 控色 + 主体确定性回贴",
        (14515, 3410),
        (440, 300),
        order,
    )
    node["inputs"] = [
        socket("editable_master", "IMAGE"),
        socket("studio_candidate", "IMAGE"),
        socket("flat_image", "IMAGE"),
        socket("foreground_mask", "MASK"),
        socket("color_lock_strength", "FLOAT", widget=True),
        socket("neutral_material_protection", "FLOAT", widget=True),
    ]
    node["outputs"] = [
        output("presentation_image", "IMAGE"),
        output("color_locked_badge", "IMAGE"),
        output("subject_geometry_max_diff", "FLOAT"),
        output("report", "STRING"),
    ]
    node["widgets_values"] = [0.65, 0.75]
    node["widgets_values_named"] = {
        "color_lock_strength": 0.65,
        "neutral_material_protection": 0.75,
    }
    return node


def preview_node(template, node_id, title, pos, size, order):
    node = copy.deepcopy(template)
    node.update({"id": node_id, "pos": list(pos), "size": list(size), "order": order, "title": title})
    node["inputs"][0]["link"] = None
    node["outputs"][0]["links"] = []
    return node


def report_node(template, node_id, title, pos, order):
    node = copy.deepcopy(template)
    node.update({"id": node_id, "pos": list(pos), "size": [430, 220], "order": order, "title": title})
    node["inputs"][0]["link"] = None
    node["outputs"][0]["links"] = []
    return node


def renumber_links(data):
    mapping = {int(link[0]): index for index, link in enumerate(data["links"], start=1)}
    for link in data["links"]:
        link[0] = mapping[int(link[0])]
    for node in data["nodes"]:
        for item in node.get("inputs", []):
            if item.get("link") is not None:
                item["link"] = mapping[int(item["link"])]
        for item in node.get("outputs", []):
            if isinstance(item.get("links"), list):
                item["links"] = [mapping[int(value)] for value in item["links"]]
    data["last_link_id"] = len(data["links"])


def reduce_to_single_semantic_channel(data):
    remove_ids = {70, 71, 72, 74, 75, 76, 77}
    data["nodes"] = [node for node in data["nodes"] if int(node["id"]) not in remove_ids]
    data["links"] = [
        link for link in data["links"]
        if int(link[1]) not in remove_ids and int(link[3]) not in remove_ids
    ]
    valid_ids = {int(link[0]) for link in data["links"]}
    node_map = {int(node["id"]): node for node in data["nodes"]}
    for node in data["nodes"]:
        for item in node.get("inputs", []):
            if item.get("link") is not None and int(item["link"]) not in valid_ids:
                item["link"] = None
        for item in node.get("outputs", []):
            if isinstance(item.get("links"), list):
                item["links"] = [value for value in item["links"] if int(value) in valid_ids]

    node_map[69]["title"] = "[PP Mask] 原平面图颜色选区"
    node_map[73]["title"] = "[PP Local Edit] GPT-Image-2 局部语义重绘｜提示词公开"
    node_map[78]["pos"] = [9210, 2550]
    node_map[79]["pos"] = [8710, 2920]
    node_map[79]["title"] = "[PP Local QA] GPT 调用与有效选区报告"
    node_map[80]["widgets_values"][1] = (
        "高级珠宝产品摄影，纯白色无缝摄影棚背景，柔和棚拍主光与轮廓光，"
        "自然接触阴影，主体居中，克制景深，不增加道具、文字或装饰。"
    )
    node_map[80]["widgets_values_named"]["studio_prompt"] = node_map[80]["widgets_values"][1]
    node_map[80]["title"] = "[PP Studio] GPT-Image-2 仅编辑纯白棚拍背景"

    next_link = max([int(link[0]) for link in data["links"]] + [0]) + 1

    def connect(origin_id, origin_slot, target_id, target_slot, link_type):
        nonlocal next_link
        if node_map[target_id]["inputs"][target_slot].get("link") is not None:
            return
        link_id = next_link
        next_link += 1
        data["links"].append([link_id, origin_id, origin_slot, target_id, target_slot, link_type])
        node_map[target_id]["inputs"][target_slot]["link"] = link_id
        links = node_map[origin_id]["outputs"][origin_slot].get("links")
        if not isinstance(links, list):
            links = []
            node_map[origin_id]["outputs"][origin_slot]["links"] = links
        links.append(link_id)

    connect(73, 0, 78, 0, "IMAGE")
    connect(73, 2, 79, 0, "STRING")
    connect(73, 0, 80, 0, "IMAGE")
    connect(73, 0, 82, 0, "IMAGE")

    for group in data.get("groups", []):
        if int(group.get("id", -1)) == 11:
            group.update({
                "title": "[PP] 单路局部语义重绘｜原平面图 Mask｜提示词输入",
                "bounding": [8262.695059617567, 2432.111710856819, 1600, 850],
            })

    data.setdefault("extra", {})["linearData"] = {
        "inputs": [
            ["1", "image"],
            ["2", "image"],
            ["69", "multi_color_mask_v1_panel"],
            ["73", "enabled"],
            ["73", "edit_prompt"],
            ["73", "quality"],
            ["73", "reroll_revision"],
            ["80", "enabled"],
            ["80", "studio_prompt"],
            ["80", "protection_px"],
            ["80", "quality"],
            ["80", "reroll_revision"],
            ["82", "color_lock_strength"],
            ["82", "neutral_material_protection"],
        ],
        "outputs": ["54", "78", "83"],
    }


def main():
    data = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    nodes = {int(node["id"]): node for node in data["nodes"]}
    if not (OLD_PP_NODE_IDS & set(nodes)) and {69, 73, 78, 80, 82}.issubset(nodes):
        reduce_to_single_semantic_channel(data)
        renumber_links(data)
        WORKFLOW.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        return
    expected = {
        15: "OpenAIGPTImageNodeV2",
        16: "BadgeReliefPrompt",
        27: "OpenAIGPTImageNodeV2",
        32: "OpenAIGPTImageNodeV2",
        35: "OpenAIGPTImageNodeV2",
        40: "DAELabMultiColorMask",
    }
    for node_id, node_type in expected.items():
        if nodes.get(node_id, {}).get("type") != node_type:
            raise RuntimeError(f"Current 8.6 PP baseline changed at node {node_id}; refusing to overwrite it.")

    retained_links = [
        link for link in data["links"]
        if int(link[1]) not in OLD_PP_NODE_IDS and int(link[3]) not in OLD_PP_NODE_IDS
    ]
    retained_nodes = [node for node in data["nodes"] if int(node["id"]) not in OLD_PP_NODE_IDS]
    for node in retained_nodes:
        for item in node.get("inputs", []):
            if item.get("link") is not None and not any(int(link[0]) == int(item["link"]) for link in retained_links):
                item["link"] = None
        valid_link_ids = {int(link[0]) for link in retained_links}
        for item in node.get("outputs", []):
            links = item.get("links")
            if isinstance(links, list):
                item["links"] = [value for value in links if int(value) in valid_link_ids]

    preview_template = nodes[54]
    report_template = nodes[66]
    order = max(int(node.get("order", 0)) for node in retained_nodes) + 1
    colors = ["#349384", "#17342b", "#d40175", "#4e2799"]
    prompts = [
        "在选区内进行局部语义优化；保持原有颜色、文字、边界和相邻材质，仅增强指定细节。",
        "仅重绘选区内部；保持原有轮廓与颜色关系，不得修改选区外任何内容。",
        "在选区内应用描述的造型或表面变化，同时锁定文字、构图、位置和边界。",
        "修复或细化选区内容；保留原设计语义、色块范围和周围全部像素。",
    ]
    positions = [((8330, 2550), (8710, 2550)), ((9180, 2550), (9560, 2550)),
                 ((8330, 2940), (8710, 2940)), ((9180, 2940), (9560, 2940))]
    added = []
    for slot, ((mask_pos, channel_pos), color, prompt) in enumerate(zip(positions, colors, prompts), start=1):
        added.append(mask_node(68 + slot, f"[PP Mask {slot}] 原平面图颜色选区", mask_pos, color, order))
        order += 1
        added.append(semantic_node(72 + slot, f"[PP Semantic {slot}] GPT-Image-2 局部语义重绘", channel_pos, prompt, order))
        order += 1
    added.extend([
        merge_node(order),
        preview_node(preview_template, 78, "[PP Output] 局部编辑主图", (10420, 2550), (600, 610), order + 1),
        report_node(report_template, 79, "[PP Local QA] 调用、选区与合并报告", (10020, 3020), order + 2),
        studio_gpt_node(order + 3),
        preview_node(preview_template, 81, "[PP Studio Preview] 背景候选", (13840, 3370), (530, 560), order + 4),
        color_lock_node(order + 5),
        preview_node(preview_template, 83, "[PP Final Output] 棚拍成片｜平面图控色", (15010, 3370), (620, 620), order + 6),
        report_node(report_template, 84, "[PP Final QA] 控色与主体回贴报告", (14515, 3750), order + 7),
        report_node(report_template, 85, "[PP Studio QA] GPT 背景调用报告", (13355, 3810), order + 8),
    ])
    retained_nodes.extend(added)
    node_map = {int(node["id"]): node for node in retained_nodes}

    next_link = max([int(link[0]) for link in retained_links] + [0]) + 1

    def connect(origin_id, origin_slot, target_id, target_slot, link_type):
        nonlocal next_link
        link_id = next_link
        next_link += 1
        retained_links.append([link_id, origin_id, origin_slot, target_id, target_slot, link_type])
        node_map[target_id]["inputs"][target_slot]["link"] = link_id
        links = node_map[origin_id]["outputs"][origin_slot].get("links")
        if not isinstance(links, list):
            links = []
            node_map[origin_id]["outputs"][origin_slot]["links"] = links
        links.append(link_id)

    for slot in range(1, 5):
        mask_id = 68 + slot
        channel_id = 72 + slot
        connect(67, 0, mask_id, 0, "IMAGE")
        connect(54, 0, channel_id, 0, "IMAGE")
        connect(mask_id, 0, channel_id, 1, "MASK")
        connect(67, 2, channel_id, 2, "MASK")

    connect(54, 0, 77, 0, "IMAGE")
    for slot in range(1, 5):
        channel_id = 72 + slot
        target = 1 + (slot - 1) * 3
        connect(channel_id, 0, 77, target, "IMAGE")
        connect(channel_id, 1, 77, target + 1, "MASK")
        connect(channel_id, 2, 77, target + 2, "STRING")
    connect(77, 0, 78, 0, "IMAGE")
    connect(77, 1, 79, 0, "STRING")
    connect(77, 0, 80, 0, "IMAGE")
    connect(67, 2, 80, 1, "MASK")
    connect(80, 0, 81, 0, "IMAGE")
    connect(77, 0, 82, 0, "IMAGE")
    connect(80, 0, 82, 1, "IMAGE")
    connect(67, 0, 82, 2, "IMAGE")
    connect(67, 2, 82, 3, "MASK")
    connect(82, 0, 83, 0, "IMAGE")
    connect(82, 3, 84, 0, "STRING")
    connect(80, 2, 85, 0, "STRING")

    for group in data.get("groups", []):
        if int(group.get("id", -1)) == 11:
            group.update({
                "title": "[PP] 4 路局部语义重绘｜原平面图 Mask｜确定性合并",
                "bounding": [8262.695059617567, 2432.111710856819, 3032.4882094014847, 1050],
            })
        elif int(group.get("id", -1)) == 8:
            group.update({
                "title": "[PP] 棚拍背景生成｜主体保护",
                "bounding": [13296.102763647796, 3214.057440106584, 1110, 860],
            })
        elif int(group.get("id", -1)) == 10:
            group.update({
                "title": "[PP] 最终控色与成片输出",
                "bounding": [14459.202909144324, 3272.1592676598234, 1210, 800],
            })

    data["nodes"] = retained_nodes
    data["links"] = retained_links
    data["last_node_id"] = max(node_map)
    data["last_link_id"] = max(int(link[0]) for link in retained_links)
    data.setdefault("extra", {})["linearData"] = {
        "inputs": [
            ["1", "image"],
            ["2", "image"],
            *[[str(node_id), "multi_color_mask_v1_panel"] for node_id in range(69, 73)],
            *[
                [str(node_id), widget]
                for node_id in range(73, 77)
                for widget in ("enabled", "edit_prompt", "quality", "reroll_revision")
            ],
            ["80", "enabled"],
            ["80", "studio_prompt"],
            ["80", "protection_px"],
            ["80", "quality"],
            ["80", "reroll_revision"],
            ["82", "color_lock_strength"],
            ["82", "neutral_material_protection"],
        ],
        "outputs": ["54", "78", "83"],
    }
    reduce_to_single_semantic_channel(data)
    renumber_links(data)
    WORKFLOW.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
