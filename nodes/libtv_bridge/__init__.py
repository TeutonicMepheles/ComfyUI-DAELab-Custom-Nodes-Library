from .node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .batch_node import LibTVStoryboardBatch, NODE_ID
NODE_CLASS_MAPPINGS[NODE_ID] = LibTVStoryboardBatch
NODE_DISPLAY_NAME_MAPPINGS[NODE_ID] = 'DAELAB · 旧分镜批量（已停用）'
from . import connection_api
from . import table_generation_api
