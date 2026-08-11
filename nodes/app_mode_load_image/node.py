from nodes import LoadImage as CoreLoadImage


class AppModeLoadImage(CoreLoadImage):
    """Load images with the native UI and DAELab app-mode Bypass handling."""

    CATEGORY = "DAELab/Image"
    DESCRIPTION = (
        "Loads an image and its alpha mask with ComfyUI's native uploader. "
        "When selected as an app input, the control follows the node's Bypass state."
    )


NODE_CLASS_MAPPINGS = {
    "AppModeLoadImage": AppModeLoadImage,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AppModeLoadImage": "Load Image (App Mode)",
}
