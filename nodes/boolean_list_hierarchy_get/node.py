import json

from comfy_api.latest import io

try:
    from ..boolean_list_hierarchy.node import (
        MAX_BOOLEAN_OUTPUTS,
        _normalize_items,
    )
except (ImportError, ValueError):
    from nodes.boolean_list_hierarchy.node import (  # type: ignore
        MAX_BOOLEAN_OUTPUTS,
        _normalize_items,
    )


DEFAULT_CONFIG = json.dumps(
    {
        "version": 2,
        "valid": False,
        "source_node_id": "",
        "root_item_id": "",
        "include_root": True,
        "items": [],
        "output_item_ids": [],
    },
    ensure_ascii=False,
)


def _parse_snapshot(config_json):
    try:
        snapshot = json.loads(config_json or "{}")
    except (TypeError, json.JSONDecodeError):
        snapshot = {}
    if not isinstance(snapshot, dict):
        snapshot = {}

    raw_items = snapshot.get("items", [])
    if not isinstance(raw_items, list):
        raw_items = []
    raw_output_ids = snapshot.get("output_item_ids", [])
    if not isinstance(raw_output_ids, list):
        raw_output_ids = []

    return {
        "valid": snapshot.get("valid") is True,
        "items": raw_items[:MAX_BOOLEAN_OUTPUTS],
        "output_item_ids": [
            str(item_id).strip()
            for item_id in raw_output_ids[:MAX_BOOLEAN_OUTPUTS]
            if str(item_id).strip()
        ],
    }


def _resolve_output_values(config_json):
    snapshot = _parse_snapshot(config_json)
    if not snapshot["valid"]:
        return [False] * len(snapshot["output_item_ids"])

    normalized = _normalize_items(
        json.dumps(snapshot["items"], ensure_ascii=False)
    )
    item_by_id = {item["id"]: item for item in normalized}
    return [
        bool(item_by_id.get(item_id, {}).get("value", False))
        for item_id in snapshot["output_item_ids"]
    ]


class BooleanListHierarchyGet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="BooleanListHierarchyGet",
            display_name="Boolean List Hierarchy Get",
            category="utils/logic",
            inputs=[
                io.String.Input(
                    "config_json",
                    default=DEFAULT_CONFIG,
                    optional=True,
                    socketless=True,
                )
            ],
            outputs=[
                io.Boolean.Output(display_name=f"Boolean {index}")
                for index in range(1, MAX_BOOLEAN_OUTPUTS + 1)
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, config_json=DEFAULT_CONFIG):
        return config_json

    @classmethod
    def execute(cls, config_json=DEFAULT_CONFIG):
        values = _resolve_output_values(config_json)
        values.extend(False for _ in range(MAX_BOOLEAN_OUTPUTS - len(values)))
        return io.NodeOutput(*values[:MAX_BOOLEAN_OUTPUTS])


NODE_CLASS_MAPPINGS = {
    "BooleanListHierarchyGet": BooleanListHierarchyGet,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BooleanListHierarchyGet": "Boolean List Hierarchy Get",
}
