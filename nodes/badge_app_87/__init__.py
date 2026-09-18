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
