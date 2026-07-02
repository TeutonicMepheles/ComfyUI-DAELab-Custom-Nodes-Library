import json


MAX_BOOLEAN_OUTPUTS = 64
DEFAULT_CONFIG = json.dumps(
    [{"label": "Boolean 1", "value": False}],
    ensure_ascii=False,
)


def _normalize_items(config_json):
    try:
        raw_items = json.loads(config_json or "[]")
    except (TypeError, json.JSONDecodeError):
        raw_items = []

    if not isinstance(raw_items, list):
        raw_items = []

    items = []
    for index, item in enumerate(raw_items[:MAX_BOOLEAN_OUTPUTS], start=1):
        if isinstance(item, dict):
            label = item.get("label") or item.get("name") or f"Boolean {index}"
            value = item.get("value", False)
        else:
            label = f"Boolean {index}"
            value = item

        items.append(
            {
                "label": str(label).strip() or f"Boolean {index}",
                "value": bool(value),
            }
        )

    if not items:
        items.append({"label": "Boolean 1", "value": False})

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


class BooleanList:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = tuple("BOOLEAN" for _ in range(MAX_BOOLEAN_OUTPUTS))
    RETURN_NAMES = tuple(f"Boolean {i}" for i in range(1, MAX_BOOLEAN_OUTPUTS + 1))
    FUNCTION = "evaluate"
    CATEGORY = "utils/logic"

    @classmethod
    def IS_CHANGED(cls, extra_pnginfo=None, unique_id=None):
        return _get_config_json(extra_pnginfo, unique_id)

    def evaluate(self, extra_pnginfo=None, unique_id=None):
        items = _normalize_items(_get_config_json(extra_pnginfo, unique_id))
        values = [item["value"] for item in items]
        values.extend(False for _ in range(MAX_BOOLEAN_OUTPUTS - len(values)))
        return tuple(values[:MAX_BOOLEAN_OUTPUTS])


NODE_CLASS_MAPPINGS = {
    "BooleanList": BooleanList,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BooleanList": "Boolean List",
}
