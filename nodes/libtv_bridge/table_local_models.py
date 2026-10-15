"""Exact local preset routing, shared by preflight and worker creation."""
from .table_local_image import LOCAL_IMAGE_MODEL, LocalImage
from .table_local_video import LOCAL_MODEL, LocalVideo

LOCAL_MODELS = {LOCAL_IMAGE_MODEL: ('image', LocalImage), LOCAL_MODEL: ('video', LocalVideo)}


def is_local_model(model):
    return model in LOCAL_MODELS


def local_bridge(kind, model):
    expected, factory = LOCAL_MODELS[model]
    if kind != expected:
        raise ValueError('本地模型与生成类型不匹配')
    return factory()
