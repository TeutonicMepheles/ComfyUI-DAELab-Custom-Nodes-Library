from .node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .import_node import StoryboardImport, NODE_ID as IMPORT_NODE_ID
from .table_node import DataTable
NODE_CLASS_MAPPINGS['DAELAB.Table'] = DataTable
NODE_DISPLAY_NAME_MAPPINGS['DAELAB.Table'] = 'DAELAB - 多维表格'
NODE_CLASS_MAPPINGS[IMPORT_NODE_ID] = StoryboardImport
NODE_DISPLAY_NAME_MAPPINGS[IMPORT_NODE_ID] = "DAELAB - 剧本分镜导入"

# Importing the document module registers the DAELab-owned HTTP endpoint.
from . import document_import as _document_import  # noqa: F401

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
