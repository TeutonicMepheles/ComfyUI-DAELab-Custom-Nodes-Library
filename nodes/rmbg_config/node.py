from comfy_api.latest import io


BACKGROUND_OPTIONS = ("Alpha", "original", "Color")
DEFAULT_BACKGROUND = "Alpha"
DEFAULT_BACKGROUND_COLOR = "#FFFFFF"

ColorCode = io.Custom("COLORCODE")


class RMBGConfig(io.ComfyNode):
    """Provide reusable background settings for RMBG Mask Extractor nodes."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="RMBGConfig",
            display_name="RMBG Config",
            category="DAELab/RMBG",
            description="Reusable background settings for RMBG Mask Extractor nodes.",
            inputs=[
                io.Combo.Input(
                    "background",
                    options=list(BACKGROUND_OPTIONS),
                    default=DEFAULT_BACKGROUND,
                ),
                ColorCode.Input(
                    "background_color",
                    extra_dict={"default": DEFAULT_BACKGROUND_COLOR},
                ),
            ],
            outputs=[
                # RMBG is a legacy node pack whose dropdown socket type is the
                # option list itself (for example ["Alpha", "Color"]), not the
                # V3 "COMBO" type. AnyType keeps this reusable output compatible
                # with both two-option RMBG nodes and Mask Extractor's three-option
                # background input while the widget still constrains emitted values.
                io.AnyType.Output("background"),
                ColorCode.Output("background_color"),
            ],
        )

    @classmethod
    def execute(cls, background, background_color):
        return io.NodeOutput(background, background_color)


NODE_CLASS_MAPPINGS = {
    "RMBGConfig": RMBGConfig,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RMBGConfig": "RMBG Config",
}
