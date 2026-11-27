"""Badge execution paths and exhibition graph bindings owned by CNL."""
from .adapters import ComfyImage, IMAGE_ADAPTER, IMAGE_NODE, IMAGE_PORTS, link
from .catalog import AccessError
from .service import Stage

BADGE_NODES = {
    "DAELAB.BadgeApp87V1", "DAELAB.BadgeApp88V1", "DAELAB.BadgeApp88TargetOnlyV1",
}
COLOR_MAP = "DAELAB.BadgeColorIdMapV1"
EXHIBITION = "daelabExhibitionUiV1"
IMAGE_EDITING = "daelabImageEditingV1"
EXHIBITION_STAGES = {"1040": "build", "1035": "description", "1058": "replacement"}
BADGE_SIZES = ("1024x1024", "1024x1536", "1536x1024", "2048x2048", "2048x1152", "1152x2048")
MODEL_WIDGETS = {"model": "model", **{key: IMAGE_PORTS[key] for key in ("size", "width", "height", "quality", "count")}}
IMAGE_PARAMETERS = {key: "enum" for key in ("size", "quality", "background")}
IMAGE_PARAMETERS.update({key: "integer" for key in ("width", "height", "count", "seed")})


def image_stage(*, maximum=8, qualities=None, sizes=None, background=None, mask=False):
    limits = {"count": {"min": 1, "max": maximum}}
    if qualities:
        limits["quality"] = {"values": qualities}
    if sizes:
        limits["size"] = {"values": sizes}
    if background:
        limits["background"] = {"values": background}
    inputs = {"prompt": "STRING", "references": "IMAGE"}
    if mask:
        inputs["mask"] = "MASK"
    return Stage("image", inputs, {"image": "IMAGE"}, IMAGE_PARAMETERS, (IMAGE_ADAPTER,), limits)


def register_consumers(access):
    access.register_adapter(IMAGE_ADAPTER, ComfyImage())
    common = {"qualities": ("low", "medium", "high"), "sizes": (*BADGE_SIZES, "Custom"), "background": ("opaque",)}
    edit = image_stage(maximum=1, sizes=("auto",), qualities=("medium",), background=("auto",), mask=True)
    access.register_consumer("badge", {
        "build": image_stage(maximum=4, **common),
        "local": image_stage(mask=True, **common),
        "region_materials": image_stage(mask=True, **common),
        "studio": image_stage(**common),
        "color_map": image_stage(maximum=1, qualities=common["qualities"], sizes=("1024x1024",), background=("opaque",)),
        "edit": edit,
    })
    access.register_consumer("exhibition", {
        "build": image_stage(maximum=4),
        "description": image_stage(),
        "replacement": image_stage(),
        "edit": edit,
    })


def badge_compute_stage(request):
    stage = request.get("stage")
    if stage not in ("build", "local", "studio", "color_map", "effect"):
        raise AccessError("徽章生成阶段无效。")
    if stage == "effect" or (stage == "local" and not request.get("apply")):
        return None
    return stage


def badge_parameters(request, capability=None):
    stage = request.get("stage")
    w, h = request.get("width", 1024), request.get("height", 1024)
    size = f"{w}x{h}"
    sizes = capability["parameters"]["size"]["values"] if capability else BADGE_SIZES
    if stage == "color_map":
        size, w, h = "1024x1024", 1024, 1024
    elif size not in sizes or size not in BADGE_SIZES:
        size = "Custom"
    return {"size": size, "width": w, "height": h, "quality": request.get("quality", "low"),
            "background": "opaque", "count": 1 if stage == "color_map" else request.get("count", 1)}


def authorize_badge(access, class_type, request):
    stage = badge_compute_stage(request)
    if stage is None:
        return
    if class_type == "DAELAB.BadgeApp88TargetOnlyV1" and stage == "color_map":
        raise AccessError("该徽章工作流仅使用编辑目标图取色。")
    legacy_region = class_type == "DAELAB.BadgeApp88V1" and stage == "local" and request.get("edit_mode") == "region_materials"
    if legacy_region:
        stage = "region_materials"
    capability = access.select("badge", stage, None if legacy_region else request.get("model"))
    params = badge_parameters(request, capability)
    checked = {key: value for key, value in params.items()
               if key not in ("width", "height") or params["size"] == "Custom"}
    access.authorize("badge", stage, capability["id"], checked)
    adapter = access.adapters[capability["execution"]["adapter"]]
    adapter.validate_dimensions(capability, params["size"], params["width"], params["height"])
    return capability, params


def exhibition_marker_valid(value):
    return (isinstance(value, dict) and type(value.get("version")) is int and value["version"] == 1
            and isinstance(value.get("build"), dict) and type(value["build"].get("nodeId")) is int
            and value["build"]["nodeId"] == 1040 and value["build"].get("type") == IMAGE_NODE
            and value["build"].get("widgets") == MODEL_WIDGETS
            and type(value["build"].get("independentLocalEdit", False)) is bool)


def edit_marker_kind(value):
    if isinstance(value, dict) and type(value.get("version")) is int and value["version"] == 1:
        return value.get("kind")
    return None


def _dimension(graph, node_id, stage, axis, value, literals):
    if not isinstance(value, list):
        return value
    if not link(graph, value):
        raise AccessError(f"自定义{axis}连线无效。")
    source, slot = value
    origin = graph[source]
    if origin["class_type"] == "PrimitiveInt" and slot == 0:
        literal = literals.get(source, origin["inputs"]).get("value")
        if type(literal) is not int:
            raise AccessError(f"自定义{axis}的整数来源无效。")
        return literal
    expected_slot = 0 if axis == "width" else 1
    if (stage in ("description", "replacement") and source == "935" and slot == expected_slot
            and origin["class_type"] == "GetImageSize+" and origin["inputs"].get("image") == ["674", 0]
            and graph.get("674", {}).get("class_type") in ("LoadImage", "DAELAB.AppModeLoadImage")):
        return None  # The native executor validates the evaluated GetImageSize+ before sending.
    raise AccessError(f"展厅节点 {node_id} 的自定义{axis}来源无法校验。")


def _exhibition_references(graph, stage, refs, independent):
    if stage == "build":
        expected = {"model.images.image_1": ("1061", "PreviewImage"), "model.images.image_2": ("1056", "PreviewImage")}
    elif stage == "description":
        expected = {"model.images.image_1": ("673", "PolygonMask")}
    elif stage == "replacement":
        expected = {
            "model.images.image_1": ("1035", IMAGE_NODE) if "1035" in graph else ("673", "PolygonMask"),
            "model.images.image_2": ("851", "RMBG") if "851" in graph else ("735", "LoadImage"),
        }
    else:
        return
    if stage == "build" and independent:
        if refs.keys() - expected.keys():
            raise AccessError("展厅首轮生成包含附加参考图。")
        expected = {key: expected[key] for key in refs}
        if "model.images.image_1" in refs:
            preview = graph.get("1061", {})
            if (preview.get("inputs", {}).get("images") != ["674", 0]
                    or graph.get("674", {}).get("class_type") not in ("LoadImage", "DAELAB.AppModeLoadImage")):
                raise AccessError("展厅首轮生成的空间参考必须直接来自空间原图。")
    for key, (source, kind) in expected.items():
        if refs.get(key) != [source, 0] or graph.get(source, {}).get("class_type") != kind:
            raise AccessError(f"展厅参考图来源或顺序无效：{key}。")


def authorize_image(access, graph, node_id, consumer, stage, literals, independent=False):
    inputs = graph[node_id]["inputs"]
    raw = literals.get(node_id, inputs)
    model = inputs.get("model")
    capability = access.capability(consumer, stage, model)
    fields = capability["execution"]["inputs"]
    if model != capability["provider"]:
        raise AccessError(f"执行图必须使用编译后的提供方型号 {capability['provider']}。")
    size = inputs.get(fields["size"])
    parameters = {key: raw.get(fields[key], rule["default"] if key not in IMAGE_PORTS else None)
                  for key, rule in capability["parameters"].items() if key not in ("width", "height")}
    if stage == "edit" and parameters["count"] != 1:
        raise AccessError("独立图像编辑每次调用生成一张。")
    dimensions = {}
    if size == "Custom":
        for axis in ("width", "height"):
            source = raw.get(fields[axis])
            if source is None:
                raise AccessError(f"展厅节点 {node_id} 缺少自定义{axis}。")
            dimensions[axis] = _dimension(graph, node_id, stage, axis, source, literals)
        parameters.update({key: value for key, value in dimensions.items() if value is not None})
    access.authorize(consumer, stage, model, parameters)
    access.adapters[IMAGE_ADAPTER].validate_dimensions(capability, size, dimensions.get("width"), dimensions.get("height"))
    refs = {key: value for key, value in inputs.items() if key.startswith(fields["references"] + ".")}
    if any(not link(graph, value) for value in refs.values()):
        raise AccessError("参考图端口必须连接到执行图中的图片来源。")
    if consumer == "exhibition":
        if stage == "build" and independent and fields["mask"] in inputs:
            raise AccessError("展厅首轮生成不接收局部修改遮罩。")
        _exhibition_references(graph, stage, refs, independent)
