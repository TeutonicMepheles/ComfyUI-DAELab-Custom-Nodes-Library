"""CNL model access at ComfyUI's final HTTP prompt queue boundary."""
from contextvars import ContextVar
from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
from urllib.parse import quote

from .adapters import IMAGE_ADAPTER, IMAGE_NODE, IMAGE_PORTS, link
from .catalog import AccessError, load_catalog, load_environment
from .consumers import (
    BADGE_NODES, COLOR_MAP, EXHIBITION, EXHIBITION_STAGES, IMAGE_EDITING,
    authorize_badge, authorize_image, edit_marker_kind,
    exhibition_marker_valid, register_consumers,
)
from .service import ModelAccess

CATALOG = load_catalog()
_access = None
_submission = ContextVar("cnl_model_access_request", default=None)
PATHS = ("/prompt", "/api/prompt")
MODEL_UI_REVISIONS = {
    "badge_app_prototype.js": "20261119-build-menu",
    "badge_build_prototype.js": "20261119-build-menu",
    "badge_build_prototype_cache_fix.js": "20261119-build-menu",
    "boolean_group_bypass_controller.js": "20261119-local-edit",
    "boolean_list_hierarchy_get.js": "20261119-local-edit",
    "exhibition_generation_adapter.js": "20261119-local-edit",
    "image_editing_app.js": "20261119-local-edit",
}


def provider_for(value, *, stage, preview=False):
    if _access is not None and (not preview or value is None):
        try:
            return _access.select("badge", stage, value)["provider"]
        except AccessError:
            if not preview:
                raise
    model = CATALOG.preferred("badge", stage) if value is None else CATALOG.resolve(value)
    if model is not None:
        return model["provider"]
    if preview:
        return value
    raise AccessError(f"模型未登记：{value}")


def image_node(graph, name, inputs, *, stage, consumer="badge"):
    if _access is None:
        return graph.node(IMAGE_NODE, id=name, **inputs)
    # The existing business compilers own prompts, image order, and branch shape.
    # The adapter owns model authorization, native parameter mapping and dispatch.
    model = inputs["model"]
    capability = _access.capability(consumer, stage, model)
    params = {key: inputs[port] for key, port in IMAGE_PORTS.items()
              if key not in ("prompt", "references", "mask") and port in inputs}
    if consumer == "badge" and stage in ("build", "local", "region_materials", "studio") and params["size"] not in capability["parameters"]["size"]["values"]:
        params["size"] = "Custom"
    size = params["size"]
    axes = ("width", "height")
    dimensions = {key: params.get(key) for key in axes}
    checked = {key: value for key, value in params.items()
               if key not in axes or size == "Custom" and type(value) is int}
    _access.authorize(consumer, stage, model, checked)
    adapter = _access.adapters[capability["execution"]["adapter"]]
    if all(type(value) is int for value in dimensions.values()):
        adapter.validate_dimensions(capability, size, dimensions["width"], dimensions["height"])
    media = {"prompt": inputs["prompt"]}
    if "model.mask" in inputs:
        media["mask"] = inputs["model.mask"]
    prefix = IMAGE_PORTS["references"] + "."
    media["references"] = [value for key, value in sorted(
        ((key, value) for key, value in inputs.items() if key.startswith(prefix)),
        key=lambda entry: int(entry[0].rsplit("_", 1)[1]),
    )]
    compiled = adapter.compile(capability, params, media)
    return graph.node(compiled["class_type"], id=name, **compiled["inputs"])


def _workflow_extra(data):
    if not isinstance(data, dict):
        return {}
    extra = data.get("extra_data")
    extra = extra if isinstance(extra, dict) else {}
    metadata = extra.get("extra_pnginfo")
    metadata = metadata if isinstance(metadata, dict) else {}
    workflow = metadata.get("workflow", data.get("workflow"))
    return workflow.get("extra") if isinstance(workflow, dict) and isinstance(workflow.get("extra"), dict) else {}


def _markers(data):
    extra = _workflow_extra(data)
    return {key: extra[key] for key in (EXHIBITION, IMAGE_EDITING, "daelabBadgeExecutionV1") if key in extra}


@dataclass
class Submission:
    before: dict | None = None
    after: dict | None = None
    graph: dict | None = None
    targets: list | None = None
    literals: dict = field(default_factory=dict)


def _ancestors(graph, output):
    todo = [output]
    seen = set()
    while todo:
        node_id = todo.pop()
        if node_id in seen or node_id not in graph:
            continue
        seen.add(node_id)
        inputs = graph[node_id].get("inputs", {})
        # Preserve the existing lazy disabled Color ID Map path.
        if graph[node_id]["class_type"] == COLOR_MAP and inputs.get("enabled", False) is False:
            continue
        todo.extend(value[0] for value in inputs.values() if link(graph, value))
    return seen


def _badge_cache_hit(request):
    # A request-json color map resolves to a known file-backed input. Other
    # legacy cache nodes can only determine their hit once the image is computed.
    from ..nodes.badge_app_87.node import prepare
    from ..nodes.badge_app_87.prompt_assembler import render
    from ..nodes.badge_app_workflow.node import color_id_map_cache_key, load_cached_map
    try:
        base = prepare(dict(request))["base"]
        model = provider_for(request.get("model"), stage="color_map", preview=True)
        key = color_id_map_cache_key(base, render("tasks/color_map"), request.get("quality", "low"),
                                     6, int(request.get("map_revision", 0)), model)
        return load_cached_map(key) is not None
    except (OSError, TypeError, KeyError, ValueError):
        return False


def _badge(access, class_type, inputs):
    raw = inputs.get("request_json")
    if not isinstance(raw, str):
        raise AccessError("徽章请求参数必须为 JSON 文本。")
    try:
        request = json.loads(raw)
    except ValueError as exc:
        raise AccessError("徽章请求 JSON 无效。") from exc
    if not isinstance(request, dict):
        raise AccessError("徽章请求 JSON 必须为对象。")
    if class_type == "DAELAB.BadgeApp88V1" and request.get("workflow_version") != "8.8":
        raise AccessError("旧徽章 8.8 请求缺少版本标记。")
    try:
        authorize_badge(access, class_type, request)
    except AccessError:
        if (request.get("stage") != "color_map" or class_type == "DAELAB.BadgeApp88TargetOnlyV1"
                or not _badge_cache_hit(request)):
            raise


def validate_submission(access, graph, outputs, submission):
    markers = (submission.before or {}, submission.after or {})
    exhibition = [values[EXHIBITION] for values in markers if EXHIBITION in values]
    editing = [values[IMAGE_EDITING] for values in markers if IMAGE_EDITING in values]
    badge = any("daelabBadgeExecutionV1" in values for values in markers)
    edit_kinds = [edit_marker_kind(value) for value in editing]
    independent = any(exhibition_marker_valid(marker) and marker["build"].get("independentLocalEdit")
                      for marker in exhibition)
    ancestors = {output: _ancestors(graph, output) for output in outputs}
    executing = set().union(*ancestors.values())
    errors = {}
    for node_id in sorted(executing):
        node = graph[node_id]
        kind = node["class_type"]
        try:
            if kind in BADGE_NODES:
                _badge(access, kind, node["inputs"])
            elif exhibition and node_id in EXHIBITION_STAGES and kind != IMAGE_NODE:
                raise AccessError("展厅生成节点的执行类型已变更。")
            elif kind == IMAGE_NODE and (exhibition or editing or badge):
                if exhibition and not all(map(exhibition_marker_valid, exhibition)):
                    raise AccessError("展厅生成标记损坏或版本不受支持。")
                consumer = "exhibition" if exhibition or "exhibition" in edit_kinds else "badge"
                if editing and any(value != consumer for value in edit_kinds):
                    raise AccessError("图像编辑工作流标记损坏或版本不受支持。")
                stage = EXHIBITION_STAGES.get(node_id, "edit") if exhibition else "edit"
                if independent and (node_id in ("1035", "1058") or
                                    ("1040" in executing and node_id != "1040")):
                    raise AccessError("展厅首轮生成与局部修改须分别提交。")
                authorize_image(access, graph, node_id, consumer, stage, submission.literals, independent)
        except AccessError as exc:
            message = str(exc)
            errors[node_id] = {
                "errors": [error_detail(message, node_id)],
                "dependent_outputs": sorted(output for output, path in ancestors.items() if node_id in path),
                "class_type": kind,
            }
    if errors:
        return {"error": next(iter(errors.values()))["errors"][0], "node_errors": errors}
    return None


def error_detail(message, node_id=None):
    return {"type": "daelab_model_access", "message": message, "details": message,
            "extra_info": {"node_id": node_id} if node_id is not None else {}}


class PromptDenied(Exception):
    def __init__(self, response):
        self.response = response


def _gate(server, access, web, node_classes):
    from copy import deepcopy
    # ComfyUI serves assets under the installed directory name, including
    # when that directory is a junction to a differently named checkout.
    package = Path(__file__).parents[1].name
    asset_prefix = f"/extensions/{quote(package)}/"

    @web.middleware
    async def boundary(request, handler):
        if request.method == "GET" and request.path in ("/extensions", "/api/extensions"):
            response = await handler(request)
            if response.status == 200 and response.content_type == "application/json":
                urls = json.loads(response.body)
                return web.json_response([
                    f"{url}?v={MODEL_UI_REVISIONS[url.removeprefix(asset_prefix)]}" if url.startswith(asset_prefix)
                    and url.removeprefix(asset_prefix) in MODEL_UI_REVISIONS else url for url in urls
                ], headers={"Cache-Control": "no-cache"})
            return response
        if request.method != "POST" or request.path not in PATHS:
            return await handler(request)
        token = _submission.set(Submission())
        try:
            return await handler(request)
        except PromptDenied as exc:
            return web.json_response(exc.response, status=400)
        finally:
            _submission.reset(token)

    trigger = server.trigger_on_prompt
    put = server.prompt_queue.put
    replace_nodes = server.node_replace_manager.apply_replacements

    def classify(data):
        current = _submission.get()
        if current is not None:
            current.before = deepcopy(_markers(data))
        result = trigger(data)
        if current is not None and isinstance(result, dict):
            current.after = deepcopy(_markers(result))
            current.graph = result.get("prompt")
            current.targets = result.get("partial_execution_targets")
        return result

    def enqueue(entry):
        current = _submission.get()
        if current is not None and current.graph is not None:
            if len(entry) not in (5, 6) or entry[2] is not current.graph:
                raise PromptDenied({"error": error_detail("宿主最终队列格式不受支持。"), "node_errors": {}})
            intended = (node_id for node_id, node in entry[2].items()
                        if (current.targets is None or node_id in current.targets)
                        and getattr(node_classes.get(node["class_type"]), "OUTPUT_NODE", False) is True)
            response = validate_submission(access, entry[2], set(entry[4]).union(intended), current)
            if response is not None:
                raise PromptDenied(response)
        return put(entry)

    def remember_literals(graph):
        result = replace_nodes(graph)
        current = _submission.get()
        if current is not None and graph is current.graph:
            # Native validation coerces INTs before enqueueing. Keep the literals
            # after host replacements so malformed counts or dimensions stay invalid.
            for node_id, node in graph.items():
                if node.get("class_type") in (IMAGE_NODE, "PrimitiveInt"):
                    current.literals[node_id] = dict(node.get("inputs", {}))
        return result

    server.app.middlewares.append(boundary)
    server.trigger_on_prompt = classify
    server.node_replace_manager.apply_replacements = remember_literals
    server.prompt_queue.put = enqueue


def install(server, user_directory, node_classes):
    global _access
    if getattr(server, "_cnl_model_access", None) is not None:
        return server._cnl_model_access
    from aiohttp import web

    def node_info(node_type):
        # Read the fully registered, enabled host class when resolving capabilities.
        return node_classes[node_type].GET_NODE_INFO_V1()

    access = ModelAccess(CATALOG, load_environment(user_directory), node_info)
    register_consumers(access)
    _gate(server, access, web, node_classes)

    @server.routes.get("/daelab/cnl/model-access")
    async def capability(request):
        try:
            return web.json_response(access.query(request.query.get("consumer"), request.query.get("stage")),
                                     headers={"Cache-Control": "no-store"})
        except AccessError as exc:
            return web.json_response({"error": error_detail(str(exc))}, status=400)

    server._cnl_model_access = _access = access
    if access.environment.error or access.catalog.error:
        logging.warning("CNL model access: %s", access.environment.error or access.catalog.error)
    return access
