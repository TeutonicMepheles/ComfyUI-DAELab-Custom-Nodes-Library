class BooleanGroupBypassController:
    """Frontend-controlled bridge from Boolean List Hierarchy to visual groups."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "boolean": ("BOOLEAN", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = "utils/logic"
    OUTPUT_NODE = True

    def execute(self, boolean):
        # The frontend marks this node as virtual, so this is only a safe fallback.
        return ()


NODE_CLASS_MAPPINGS = {
    "BooleanGroupBypassController": BooleanGroupBypassController,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BooleanGroupBypassController": "Boolean Group Bypass Controller",
}
