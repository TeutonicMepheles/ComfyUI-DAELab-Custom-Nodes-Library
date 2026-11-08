from ...coexistence import resolve_yield

_yield = resolve_yield()
_yield_nodes = _yield["nodes"] if _yield else frozenset()
_yield_routes = _yield["routes"] if _yield else frozenset()

from .node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .import_node import StoryboardImport, NODE_ID as IMPORT_NODE_ID
from .table_node import DataTable
from .script_node import ScriptParser

# The contested nodes ScriptParser and Table are yielded when the arbitration
# file assigns them to Creative Studio. GPTImageStoryboardStage (from .node) is
# owned by CNL and is therefore never yielded here.
if "DAELAB.ScriptParser" not in _yield_nodes:
    NODE_CLASS_MAPPINGS['DAELAB.ScriptParser'] = ScriptParser
    NODE_DISPLAY_NAME_MAPPINGS['DAELAB.ScriptParser'] = 'DAELAB - 分镜剧本解析器'
if "DAELAB.Table" not in _yield_nodes:
    NODE_CLASS_MAPPINGS['DAELAB.Table'] = DataTable
    NODE_DISPLAY_NAME_MAPPINGS['DAELAB.Table'] = 'DAELAB - 多维表格'
NODE_CLASS_MAPPINGS[IMPORT_NODE_ID] = StoryboardImport
NODE_DISPLAY_NAME_MAPPINGS[IMPORT_NODE_ID] = "DAELAB - 剧本分镜导入"

# Importing the document module registers the DAELab-owned HTTP endpoint. Each
# literal contested route is imported only when CNL still owns it.
if "POST /daelab/storyboard/import_document" not in _yield_routes:
    from . import document_import as _document_import  # noqa: F401
if "POST /daelab/storyboard/parse-prompts" not in _yield_routes:
    from . import prompt_api as _prompt_api  # noqa: F401
if any(route not in _yield_routes for route in (
    "POST /daelab/script-parser/document",
    "POST /daelab/script-parser/normalize",
    "GET /daelab/script-parser/ai-status",
    "POST /daelab/script-parser/classify",
)):
    from . import script_api as _script_api  # noqa: F401

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
