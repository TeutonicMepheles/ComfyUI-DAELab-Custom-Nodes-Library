from .node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

from .boundary import NODE_CLASS_MAPPINGS as BOUNDARY_NODES, NODE_DISPLAY_NAME_MAPPINGS as BOUNDARY_NAMES
NODE_CLASS_MAPPINGS.update(BOUNDARY_NODES)
NODE_DISPLAY_NAME_MAPPINGS.update(BOUNDARY_NAMES)

# Test harnesses can import nodes without a running PromptServer.
try:
    from server import PromptServer
    if getattr(PromptServer, 'instance', None) is not None:
        from .geometry_api import register
        register()
except ImportError:
    pass

from .intrinsic_guide import NODE_CLASS_MAPPINGS as GUIDE_NODES, NODE_DISPLAY_NAME_MAPPINGS as GUIDE_NAMES
NODE_CLASS_MAPPINGS.update(GUIDE_NODES)
NODE_DISPLAY_NAME_MAPPINGS.update(GUIDE_NAMES)

from .material_diagnostics import NODE_CLASS_MAPPINGS as DIAGNOSTIC_NODES, NODE_DISPLAY_NAME_MAPPINGS as DIAGNOSTIC_NAMES
from .auxiliary_output import NODE_CLASS_MAPPINGS as AUXILIARY_NODES, NODE_DISPLAY_NAME_MAPPINGS as AUXILIARY_NAMES
NODE_CLASS_MAPPINGS.update({**DIAGNOSTIC_NODES, **AUXILIARY_NODES})
NODE_DISPLAY_NAME_MAPPINGS.update({**DIAGNOSTIC_NAMES, **AUXILIARY_NAMES})
