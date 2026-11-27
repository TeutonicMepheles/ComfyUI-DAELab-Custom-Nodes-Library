"""Intersect directory entries, host capabilities and registered workflow stages."""
from dataclasses import dataclass, field
from math import gcd, lcm

from .catalog import AccessError, VERSION, valid_value


@dataclass(frozen=True)
class Stage:
    task: str
    inputs: dict
    outputs: dict
    parameters: dict
    adapters: tuple
    limits: dict = field(default_factory=dict)


def intersect(rule, limit):
    if rule["type"] != limit.get("type", rule["type"]):
        raise AccessError("宿主或工作流参数类型不匹配。")
    out = dict(rule)
    if rule["type"] == "enum":
        out["values"] = [value for value in rule["values"] if value in limit.get("values", rule["values"])]
        if not out["values"]:
            raise AccessError("参数没有可用选项。")
        out["default"] = rule["default"] if rule["default"] in out["values"] else out["values"][0]
    if rule["type"] in ("integer", "number"):
        low = max(rule["min"], limit.get("min", rule["min"]))
        high = min(rule["max"], limit.get("max", rule["max"]))
        if rule["type"] == "integer":
            step, other_step = rule.get("step", 1), limit.get("step", 1)
            other_min = limit.get("min", rule["min"])
            divisor = gcd(step, other_step)
            difference = other_min - rule["min"]
            if difference % divisor:
                raise AccessError("参数的整数步长无法匹配。")
            out["step"] = lcm(step, other_step)
            period = other_step // divisor
            factor = (difference // divisor * pow(step // divisor, -1, period)) % period
            start = rule["min"] + factor * step
            low += (start - low) % out["step"]
        if low > high:
            raise AccessError("参数没有可用范围。")
        out.update(min=low, max=high)
        if not valid_value(out, out["default"]):
            out["default"] = low
    return out


class ModelAccess:
    def __init__(self, catalog, environment, node_info, adapter_state=None):
        self.catalog = catalog
        self.environment = environment
        self.node_info = node_info
        self.adapter_state = adapter_state or {}
        self.adapters = {}
        self.consumers = {}

    def register_adapter(self, identity, adapter):
        if identity in self.adapters:
            raise ValueError(f"执行适配器已存在：{identity}")
        self.adapters[identity] = adapter

    def register_consumer(self, identity, stages):
        if identity in self.consumers:
            raise ValueError(f"消费方已存在：{identity}")
        self.consumers[identity] = dict(stages)

    def stage(self, consumer, stage):
        try:
            return self.consumers[consumer][stage]
        except KeyError:
            raise AccessError("未知模型消费方或阶段。") from None

    def capability(self, consumer, stage, value):
        definition = self.stage(consumer, stage)
        if self.catalog.error:
            raise AccessError(self.catalog.error)
        if self.environment.error:
            raise AccessError(self.environment.error)
        model = self.catalog.resolve(value)
        if model is None:
            raise AccessError(self.catalog.errors.get(str(value), f"模型未登记：{value}"))
        adapter_id = model["execution"]["adapter"]
        adapter = self.adapters.get(adapter_id)
        if adapter is None:
            raise AccessError(f"执行适配器未注册：{adapter_id}")
        if (model["task"] != definition.task or adapter_id not in definition.adapters
                or not definition.inputs.items() <= model["inputs"].items()
                or not definition.outputs.items() <= model["outputs"].items()
                or any(model["parameters"].get(key, {}).get("type") != kind for key, kind in definition.parameters.items())):
            raise AccessError("模型能力与工作流阶段不兼容。")
        if reason := self.environment.reason(model):
            raise AccessError(reason)
        host = adapter.probe(model, self.node_info, self.adapter_state)
        effective = {}
        for key, desc in model["parameters"].items():
            try:
                merged = intersect(desc, host.get(key, {}))
                effective[key] = intersect(merged, definition.limits[key]) if key in definition.limits else merged
            except AccessError as exc:
                raise AccessError(f"参数 {key} 不可用。{exc}") from exc
        return {
            "id": model["id"], "label": model["label"], "provider": model["provider"],
            "aliases": [key for key, identity in self.catalog.aliases.items() if identity == model["id"]],
            "inputs": model["inputs"], "outputs": model["outputs"], "parameters": effective,
            "execution": {**model["execution"], "nodeType": getattr(adapter, "node_type", None)},
            "constraints": model.get("constraints", {}),
        }

    def query(self, consumer, stage):
        definition = self.stage(consumer, stage)
        available, unavailable = [], dict(self.catalog.errors)
        for identity in self.catalog.models:
            try:
                available.append(self.capability(consumer, stage, identity))
            except AccessError as exc:
                unavailable[identity] = str(exc)
        preferred = self.catalog.preferred(consumer, stage)
        default = next((model for model in available if preferred and model["id"] == preferred["id"]),
                       available[0] if available else None)
        return {
            "version": VERSION, "catalogVersion": VERSION,
            "environment": {"mode": self.environment.mode, "error": self.environment.error},
            "consumer": consumer, "stage": stage,
            "requirements": {
                "task": definition.task, "inputs": definition.inputs, "outputs": definition.outputs,
                "parameters": definition.parameters, "limits": definition.limits, "adapters": definition.adapters,
            },
            "models": available, "defaultModel": default["id"] if default else None,
            "unavailable": unavailable, "aliases": self.catalog.aliases,
            "error": self.catalog.error or self.environment.error or ("此阶段没有可用模型。" if not available else ""),
        }

    def select(self, consumer, stage, value=None):
        """Use a saved selection verbatim or select a compatible default."""
        if value is not None:
            return self.capability(consumer, stage, value)
        matched = self.query(consumer, stage)
        if matched["defaultModel"] is None:
            raise AccessError(matched["error"])
        return next(model for model in matched["models"] if model["id"] == matched["defaultModel"])

    def authorize(self, consumer, stage, value, parameters, linked=()):
        model = self.select(consumer, stage, value)
        for key, actual in parameters.items():
            rule = model["parameters"].get(key)
            if rule is None or (key not in linked and not valid_value(rule, actual)):
                raise AccessError(f"模型参数 {key} 无效：{actual}")
        return model

    def compile(self, consumer, stage, value, parameters, inputs):
        model = self.authorize(consumer, stage, value, parameters)
        if not inputs.keys() <= model["inputs"].keys():
            raise AccessError("请求输入超出模型声明。")
        effective = {key: rule["default"] for key, rule in model["parameters"].items()}
        effective.update(parameters)
        adapter = self.adapters[model["execution"]["adapter"]]
        return adapter.compile(model, effective, inputs)
