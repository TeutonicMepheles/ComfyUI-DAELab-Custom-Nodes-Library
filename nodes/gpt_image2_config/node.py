from comfy_api.latest import io


SIZE_OPTIONS = (
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "2048x2048",
    "2048x1152",
    "1152x2048",
    "3840x2160",
    "2160x3840",
)
BACKGROUND_OPTIONS = ("auto", "opaque")
QUALITY_OPTIONS = ("low", "medium", "high")

DEFAULT_SIZE = "auto"
DEFAULT_BACKGROUND = "auto"
DEFAULT_QUALITY = "low"


class GPTImage2Config(io.ComfyNode):
    """Provide reusable size, background, and quality settings for GPT Image 2."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="GPTImage2Config",
            display_name="GPT Image2 Config",
            category="DAELab/OpenAI",
            description="Reusable output settings for OpenAI GPT Image 2 nodes.",
            inputs=[
                io.Combo.Input("size", options=list(SIZE_OPTIONS), default=DEFAULT_SIZE),
                io.Combo.Input(
                    "background",
                    options=list(BACKGROUND_OPTIONS),
                    default=DEFAULT_BACKGROUND,
                ),
                io.Combo.Input("quality", options=list(QUALITY_OPTIONS), default=DEFAULT_QUALITY),
            ],
            outputs=[
                io.Combo.Output("size", options=list(SIZE_OPTIONS)),
                io.Combo.Output("background", options=list(BACKGROUND_OPTIONS)),
                io.Combo.Output("quality", options=list(QUALITY_OPTIONS)),
            ],
        )

    @classmethod
    def execute(cls, size, background, quality):
        return io.NodeOutput(size, background, quality)


NODE_CLASS_MAPPINGS = {
    "GPTImage2Config": GPTImage2Config,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GPTImage2Config": "GPT Image2 Config",
}
