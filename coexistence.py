"""Three-package coexistence yield gate (Custom Nodes Library side).

Reads the same arbitration file ``user/daelab/coexistence.json`` as Creative
Studio. When the file authorizes this package, CNL yields every contested
registration whose owner is not ``cnl``; anything outside the contested surface
is always registered. Without the file — or without authorisation — CNL
registers everything exactly as it did before coexistence.

The validation rules below mirror Creative Studio's
``backend/integrations/comfyui/coexistence.py`` so that a malformed arbitration
file is rejected identically by both packages (fail closed, symmetric).
"""
from __future__ import annotations

import json
from pathlib import Path

# Package identity. The arbitration file stores owners as package IDs.
PACKAGE_ID = "cnl"
PACKAGE_NAME = "ComfyUI-DAELab-Custom-Nodes-Library"

LEGACY_PACKAGE_NAMES = frozenset({
    "ComfyUI-DAELab-Creative-Canvas",
    "ComfyUI-DAELab-Custom-Nodes-Library",
})

# Contested registration surface. Mirrors Creative Studio's coexistence.py so
# both packages validate the same file against the same fully-enumerated table.
CONTESTED_NODES = frozenset({
    "DAELAB.Table",
    "DAELAB.ScriptParser",
    "DAELAB.LLMStylePreviewB",
    "DAELAB.ComfyTV.GPTImageStoryboardStage",
})

CONTESTED_ROUTES = frozenset({
    "POST /daelab/storyboard/import_document",
    "POST /daelab/storyboard/parse-prompts",
    "POST /daelab/script-parser/document",
    "POST /daelab/script-parser/normalize",
    "POST /daelab/script-parser/classify",
    "GET /daelab/script-parser/ai-status",
})

PROMPT_OPTIMIZATION_PREFIX = "POST /daelab/prompt-optimization/"
PROMPT_OPTIMIZATION_ACTIONS = (
    "polish", "capabilities", "estimate", "lease", "submit", "query", "recover",
    "permit", "advance", "stop", "interrupt", "continue", "skip", "fence",
)

CONTESTED_EXTENSIONS = frozenset({
    "DAELab.DataTable",
    "DAELab.ScriptParser",
    "DAELab.LLMStylePreview",
    "DAELab.PromptOptimization.Identity.v1",
})

PACKAGE_IDS = frozenset({"studio", "cnl"})


def arbitration_path(user_directory: Path) -> Path:
    return Path(user_directory) / "daelab" / "coexistence.json"


def load_arbitration(user_directory: Path) -> dict | None:
    """Read and parse the arbitration file; ``None`` means "not opted in".

    A malformed file raises ``ValueError`` rather than silently disabling
    coexistence: the user explicitly opted in, so a broken file must fail
    closed with a clear reason.
    """
    path = arbitration_path(user_directory)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"coexistence.json is unreadable: {error}") from error
    if not isinstance(data, dict):
        raise ValueError("coexistence.json must be a JSON object")
    return data


def _key_str(key) -> str:
    if isinstance(key, tuple):
        return " ".join(key)
    return str(key)


def _normalize_route_owners(table) -> dict:
    """Collapse ``GET  /path`` (alignment padding) to the canonical ``GET /path``."""
    if not isinstance(table, dict):
        return table
    normalized = {}
    for key, owner in table.items():
        if isinstance(key, tuple):
            normalized[" ".join(key)] = owner
        else:
            normalized[" ".join(str(key).split())] = owner
    return normalized


def _owner_errors(table, expected_keys, label: str) -> list[str]:
    errors = []
    if not isinstance(table, dict):
        return [f"{label} must be an object mapping identifiers to a package ID"]
    missing = [key for key in expected_keys if key not in table]
    if missing:
        errors.append(f"{label} is missing {sorted(_key_str(k) for k in missing)}")
    for key, owner in table.items():
        if owner not in PACKAGE_IDS:
            errors.append(f"{label} owner for {_key_str(key)!r} must be one of {sorted(PACKAGE_IDS)}, got {owner!r}")
    return errors


def validate_arbitration(arbitration: dict) -> list[str]:
    """Return every reason the arbitration file is incomplete or inconsistent."""
    errors = []
    allowed = arbitration.get("allowLegacyPackages")
    if not isinstance(allowed, list) or not all(isinstance(name, str) for name in allowed):
        errors.append("allowLegacyPackages must be a list of legacy package directory names")
    else:
        unknown = [name for name in allowed if name not in LEGACY_PACKAGE_NAMES]
        if unknown:
            errors.append(f"allowLegacyPackages contains unknown package names: {unknown}")

    errors.extend(_owner_errors(arbitration.get("nodeOwners"), CONTESTED_NODES, "nodeOwners"))
    errors.extend(_owner_errors(_normalize_route_owners(arbitration.get("routeOwners")), CONTESTED_ROUTES, "routeOwners"))
    errors.extend(_owner_errors(arbitration.get("extensionOwners"), CONTESTED_EXTENSIONS, "extensionOwners"))

    prefixes = arbitration.get("routePrefixes")
    if not isinstance(prefixes, dict) or PROMPT_OPTIMIZATION_PREFIX not in prefixes:
        errors.append(f"routePrefixes must declare {PROMPT_OPTIMIZATION_PREFIX!r}")
    else:
        entry = prefixes[PROMPT_OPTIMIZATION_PREFIX]
        if not isinstance(entry, dict) or entry.get("owner") not in PACKAGE_IDS:
            errors.append(f"routePrefixes[{PROMPT_OPTIMIZATION_PREFIX!r}] must declare an owner in {sorted(PACKAGE_IDS)}")
        actions = entry.get("allowedActions") if isinstance(entry, dict) else None
        if not isinstance(actions, list) or set(actions) != set(PROMPT_OPTIMIZATION_ACTIONS):
            errors.append(f"routePrefixes[{PROMPT_OPTIMIZATION_PREFIX!r}].allowedActions must enumerate exactly the {len(PROMPT_OPTIMIZATION_ACTIONS)} named actions")

    return errors


def cnl_authorized(arbitration: dict) -> bool:
    """True when the arbitration file authorizes this package to coexist."""
    allowed = arbitration.get("allowLegacyPackages")
    return isinstance(allowed, list) and PACKAGE_NAME in allowed


def yielded_items(arbitration: dict) -> dict:
    """Return the contested items CNL must skip (owner != ``cnl``).

    Only contested items can be yielded; everything absent from the contested
    tables is unconditionally registered by the caller.
    """
    node_owners = arbitration.get("nodeOwners", {})
    route_owners = _normalize_route_owners(arbitration.get("routeOwners", {}))
    extension_owners = arbitration.get("extensionOwners", {})
    prefix_entry = arbitration.get("routePrefixes", {}).get(PROMPT_OPTIMIZATION_PREFIX, {})

    return {
        "nodes": frozenset(node_id for node_id in CONTESTED_NODES if node_owners.get(node_id) != PACKAGE_ID),
        "routes": frozenset(key for key in CONTESTED_ROUTES if route_owners.get(key) != PACKAGE_ID),
        "prompt_optimization": prefix_entry.get("owner") != PACKAGE_ID,
        "extensions": frozenset(name for name in CONTESTED_EXTENSIONS if extension_owners.get(name) != PACKAGE_ID),
    }


def resolve_yield(user_directory=None) -> dict | None:
    """Compute what CNL must yield, or ``None`` to register everything.

    ``None`` means either the arbitration file is absent or it does not
    authorise CNL. A present-but-invalid file raises ``ValueError`` (fail
    closed). Pure and deterministic: the package ``__init__`` calls it once and
    shares the result with the storyboard sub-package and the frontend route.
    """
    if user_directory is None:
        import folder_paths
        user_directory = folder_paths.get_user_directory()
    arbitration = load_arbitration(user_directory)
    if arbitration is None:
        return None
    errors = validate_arbitration(arbitration)
    if errors:
        raise ValueError("coexistence.json is invalid: " + "; ".join(errors))
    return yielded_items(arbitration) if cnl_authorized(arbitration) else None


def register_frontend_yield_route(yield_state=None):
    """Serve the yielded-extension names to the frontend as an ES module.

    ``yield_state`` is the precomputed result of ``resolve_yield`` captured at
    import time; when omitted the route resolves it lazily per request. Best
    effort: returns silently when ComfyUI's server is not importable or not yet
    started (e.g. during a bare import or a unit test). The four contested
    extension files import ``/daelab/coexistence.js`` and skip their
    ``app.registerExtension`` call when their name is listed here.
    """
    try:
        from server import PromptServer
        from aiohttp import web
    except ImportError:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        return

    def _handler(request):
        state = yield_state if yield_state is not None else resolve_yield()
        names = sorted(state["extensions"]) if state else []
        body = "export const YIELDED_EXTENSIONS = " + json.dumps(names) + ";\n"
        return web.Response(text=body, content_type="text/javascript")

    instance.routes.get("/daelab/coexistence.js")(_handler)
