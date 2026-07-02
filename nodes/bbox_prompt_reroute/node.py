def _empty_boxes_prompt():
    return {"boxes": [], "labels": []}


class BBoxPromptReroute:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "bboxes": (
                    "SAM3_BOXES_PROMPT",
                    {
                        "tooltip": "Positive bbox prompt to pass through.",
                    },
                ),
                "neg_bboxes": (
                    "SAM3_BOXES_PROMPT",
                    {
                        "tooltip": "Negative bbox prompt to pass through.",
                    },
                ),
            },
        }

    DESCRIPTION = "Reroute paired positive and negative SAM3 bbox prompts."
    RETURN_TYPES = ("SAM3_BOXES_PROMPT", "SAM3_BOXES_PROMPT")
    RETURN_NAMES = ("bboxes", "neg_bboxes")
    FUNCTION = "execute"
    CATEGORY = "image/bbox"
    SEARCH_ALIASES = ["bbox reroute", "bboxes reroute", "neg bboxes reroute", "sam3 bbox reroute"]

    def execute(self, bboxes=None, neg_bboxes=None):
        return (
            bboxes if bboxes is not None else _empty_boxes_prompt(),
            neg_bboxes if neg_bboxes is not None else _empty_boxes_prompt(),
        )


NODE_CLASS_MAPPINGS = {
    "BBoxPromptReroute": BBoxPromptReroute,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BBoxPromptReroute": "BBox Prompt Reroute",
}
