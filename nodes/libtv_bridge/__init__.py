from .node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .batch_node import LibTVStoryboardBatch, NODE_ID
NODE_CLASS_MAPPINGS[NODE_ID] = LibTVStoryboardBatch
NODE_DISPLAY_NAME_MAPPINGS[NODE_ID] = 'DAELAB · LibTV 分镜批量生成'
from . import connection_api
from . import table_generation_api
