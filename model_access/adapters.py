"""The first registered execution adapter uses the existing ComfyUI API node."""
from .catalog import AccessError, valid_value

IMAGE_ADAPTER = "comfy-gpt-image-v2"
IMAGE_NODE = "OpenAIGPTImageNodeV2"
IMAGE_PORTS = {
    "prompt": "prompt", "references": "model.images", "mask": "model.mask",
    "size": "model.size", "width": "model.custom_width", "height": "model.custom_height",
    "background": "model.background", "quality": "model.quality", "count": "n", "seed": "seed",
}


def link(graph, value):
    return (isinstance(value, list) and len(value) == 2 and isinstance(value[0], str)
            and type(value[1]) is int and value[1] >= 0 and value[0] in graph)


def _fields(definition):
    return {**definition.get("required", {}), **definition.get("optional", {})}


class ComfyImage:
    node_type = IMAGE_NODE

    def probe(self, model, node_info, _state):
        execution = model["execution"]
        if (execution["route"] != "comfy-api" or execution["modelField"] != "model"
                or not IMAGE_PORTS.items() <= execution["inputs"].items() or execution["outputs"] != {"image": "0"}
                or model["environment"]["location"] != "external"):
            raise AccessError("图片适配器的路由或端口映射不受支持。")
        dimensions = model.get("constraints", {}).get("customDimensions")
        if (not isinstance(dimensions, dict)
                or any(type(dimensions.get(key)) is not int or dimensions[key] <= 0
                       for key in ("maxAspect", "minPixels", "maxPixels"))
                or dimensions["maxPixels"] < dimensions["minPixels"]):
            raise AccessError("图片适配器需要有效的自定义尺寸约束。")
        try:
            info = node_info(self.node_type)
            root = _fields(info["input"])
            if info["output"][0] != "IMAGE" or root["prompt"][0] != "STRING":
                raise ValueError("图片输出或提示词端口缺失")
            option = next(item for item in root["model"][1]["options"] if item["key"] == model["provider"])
            fields = _fields(option["inputs"])
            refs = fields["images"][1]["template"]
            if (_fields(refs["input"])["image"][0] != "IMAGE" or "image_1" not in refs["names"]
                    or fields["mask"][0] != "MASK"):
                raise ValueError("参考图或遮罩端口缺失")
            limits = {}
            for semantic, rule in model["parameters"].items():
                path = execution["inputs"][semantic]
                kind, desc = fields[path[6:]] if path.startswith("model.") else root[path]
                if rule["type"] == "enum" and kind == "COMBO" and isinstance(desc.get("options"), (list, tuple)):
                    limits[semantic] = {"values": desc["options"]}
                elif rule["type"] == "integer" and kind == "INT":
                    if (any(type(desc.get(key)) is not int for key in ("min", "max"))
                            or type(desc.get("step", 1)) is not int or desc.get("step", 1) < 1 or desc["min"] > desc["max"]):
                        raise ValueError(f"{path} 的整数范围无效")
                    limits[semantic] = {key: desc[key] for key in ("min", "max", "step") if key in desc}
                else:
                    raise ValueError(f"{path} 的字段类型不匹配")
            return limits
        except StopIteration:
            raise AccessError(f"宿主未提供型号 {model['provider']}。") from None
        except (IndexError, KeyError, TypeError, ValueError, RuntimeError) as exc:
            raise AccessError(f"无法读取 {self.node_type} 能力或端口：{exc}") from exc

    def compile(self, model, parameters, inputs):
        fields = model["execution"]["inputs"]
        values = {model["execution"]["modelField"]: model["provider"]}
        values.update({fields[key]: rule["default"] for key, rule in model["parameters"].items()
                       if key not in IMAGE_PORTS and key not in parameters})
        values.update({fields[key]: value for key, value in parameters.items()})
        for key, value in inputs.items():
            if key == "references":
                values.update({f"{fields[key]}.image_{index}": ref for index, ref in enumerate(value, 1)})
            else:
                values[fields[key]] = value
        return {"class_type": self.node_type, "inputs": values}

    def validate_dimensions(self, model, size, width, height):
        if size != "Custom" or width is None or height is None:
            return
        constraints = model["constraints"]["customDimensions"]
        if (max(width, height) > constraints["maxAspect"] * min(width, height)
                or not constraints["minPixels"] <= width * height <= constraints["maxPixels"]):
            raise AccessError("自定义尺寸的长宽比或总像素超出模型范围。")
