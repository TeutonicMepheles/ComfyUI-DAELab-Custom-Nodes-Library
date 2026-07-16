import json

from comfy_api.latest import io


MAX_BOOLEAN_OUTPUTS = 64
DEFAULT_CONFIG = json.dumps(
    [
        {
            "id": "boolean-default-1",
            "label": "Boolean 1",
            "value": False,
            "parent_id": None,
        }
    ],
    ensure_ascii=False,
)


def _to_bool(value):
    return value is True or value == 1 or value == "1" or value == "true"


def _normalize_items(config_json):
    try:
        raw_items = json.loads(config_json or "[]")
    except (TypeError, json.JSONDecodeError):
        raw_items = []

    if not isinstance(raw_items, list):
        raw_items = []

    prepared = []
    used_ids = set()
    for index, item in enumerate(raw_items[:MAX_BOOLEAN_OUTPUTS], start=1):
        if isinstance(item, dict):
            label = item.get("label") or item.get("name") or f"Boolean {index}"
            value = item.get("value", False)
            item_id = str(item.get("id") or "").strip()
            parent_id = item.get("parent_id", item.get("parentId"))
            level = item.get("level", 0)
        else:
            label = f"Boolean {index}"
            value = item
            item_id = ""
            parent_id = None
            level = 0

        if not item_id or item_id in used_ids:
            item_id = f"boolean-legacy-{index}"
            suffix = 1
            while item_id in used_ids:
                suffix += 1
                item_id = f"boolean-legacy-{index}-{suffix}"
        used_ids.add(item_id)

        try:
            level = 0 if int(level) <= 0 else 1
        except (TypeError, ValueError):
            level = 0

        prepared.append(
            {
                "id": item_id,
                "label": str(label).strip() or f"Boolean {index}",
                "value": _to_bool(value),
                "explicit_parent_id": str(parent_id).strip() if parent_id else None,
                "legacy_level": level,
            }
        )

    if not prepared:
        prepared.append(
            {
                "id": "boolean-default-1",
                "label": "Boolean 1",
                "value": False,
                "explicit_parent_id": None,
                "legacy_level": 0,
            }
        )

    current_legacy_root_id = None
    items = []
    for item in prepared:
        parent_id = item["explicit_parent_id"]
        if not parent_id and item["legacy_level"] == 1:
            parent_id = current_legacy_root_id
        if not parent_id:
            current_legacy_root_id = item["id"]
        items.append(
            {
                "id": item["id"],
                "label": item["label"],
                "value": item["value"],
                "parent_id": parent_id,
            }
        )

    by_id = {item["id"]: item for item in items}
    for item in items:
        parent = by_id.get(item["parent_id"])
        if parent is None or parent is item or parent.get("parent_id"):
            item["parent_id"] = None

    roots = [item for item in items if not item["parent_id"]]
    if not roots:
        items[0]["parent_id"] = None

    ordered = []
    for root in (item for item in items if not item["parent_id"]):
        ordered.append(root)
        ordered.extend(item for item in items if item["parent_id"] == root["id"])

    return _apply_parent_cascade(ordered[:MAX_BOOLEAN_OUTPUTS])


def _apply_parent_cascade(items):
    """Force children to false while their direct parent is false."""
    parents = {item["id"]: item for item in items if not item["parent_id"]}
    for item in items:
        if not item["parent_id"]:
            continue
        parent = parents.get(item["parent_id"])
        if parent is None or not parent["value"]:
            item["value"] = False

    return items


def _get_config_json(extra_pnginfo=None, unique_id=None):
    config_json = DEFAULT_CONFIG
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    nodes = workflow.get("nodes", []) if isinstance(workflow, dict) else []

    for node in nodes:
        if not isinstance(node, dict) or str(node.get("id")) != str(unique_id):
            continue

        properties = node.get("properties", {})
        if isinstance(properties, dict):
            config_json = properties.get("boolean_list_items", config_json)
        break

    return config_json


def _resolve_config_json(config_json=None, extra_pnginfo=None, unique_id=None):
    """Prefer the prompt input while retaining legacy workflow-property support."""
    workflow_config = _get_config_json(extra_pnginfo, unique_id)
    if config_json is None or config_json == "":
        return workflow_config

    try:
        parsed = json.loads(config_json)
    except (TypeError, json.JSONDecodeError):
        return workflow_config

    if not isinstance(parsed, list):
        return workflow_config

    # Older workflows do not contain the hidden config widget. When ComfyUI
    # supplies its schema default, keep using their persisted property value.
    if config_json == DEFAULT_CONFIG and workflow_config != DEFAULT_CONFIG:
        return workflow_config

    return config_json


class BooleanListHierarchy(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="BooleanListHierarchy",
            display_name="Boolean List Hierarchy",
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
                io.Boolean.Output(display_name=f"Boolean {i}")
                for i in range(1, MAX_BOOLEAN_OUTPUTS + 1)
            ],
            hidden=[io.Hidden.extra_pnginfo, io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(cls, config_json=DEFAULT_CONFIG):
        return _resolve_config_json(
            config_json,
            cls.hidden.extra_pnginfo,
            cls.hidden.unique_id,
        )

    @classmethod
    def execute(cls, config_json=DEFAULT_CONFIG):
        items = _normalize_items(
            _resolve_config_json(
                config_json,
                cls.hidden.extra_pnginfo,
                cls.hidden.unique_id,
            )
        )
        items = _apply_parent_cascade(items)
        values = [item["value"] for item in items]
        values.extend(False for _ in range(MAX_BOOLEAN_OUTPUTS - len(values)))
        return io.NodeOutput(*values[:MAX_BOOLEAN_OUTPUTS])


NODE_CLASS_MAPPINGS = {
    "BooleanListHierarchy": BooleanListHierarchy,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BooleanListHierarchy": "Boolean List Hierarchy",
}
