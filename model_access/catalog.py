"""Load the versioned, declarative model directory and installation policy."""
from dataclasses import dataclass, field
import json
from math import isfinite
from pathlib import Path


VERSION = 1
MODELS_PATH = Path(__file__).with_name("models")
TYPES = {"enum", "integer", "number", "boolean", "string"}


class AccessError(ValueError):
    pass


def read_json(path):
    def unique(pairs):
        data = {}
        for key, value in pairs:
            if key in data:
                raise AccessError(f"重复字段 {key}。")
            data[key] = value
        return data

    def bad_number(value):
        raise AccessError(f"无效数字 {value}。")

    return json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique, parse_constant=bad_number)


def versioned(data):
    return isinstance(data, dict) and type(data.get("version")) is int and data["version"] == VERSION


def nonempty(value):
    return isinstance(value, str) and bool(value.strip()) and value == value.strip()


def valid_value(rule, value):
    kind = rule["type"]
    if kind == "enum":
        return type(value) is str and value in rule["values"]
    if kind == "boolean":
        return type(value) is bool
    if kind == "string":
        return isinstance(value, str)
    if type(value) not in ((int,) if kind == "integer" else (int, float)):
        return False
    if not rule["min"] <= value <= rule["max"]:
        return False
    return kind != "integer" or (value - rule["min"]) % rule.get("step", 1) == 0


def parameter(rule):
    if (not isinstance(rule, dict) or not isinstance(rule.get("type"), str)
            or rule["type"] not in TYPES or "default" not in rule):
        raise AccessError("参数必须声明 type 和 default。")
    kind = rule["type"]
    if kind == "enum":
        values = rule.get("values")
        if not isinstance(values, list) or not values or not all(map(nonempty, values)) or len(set(values)) != len(values):
            raise AccessError("枚举必须包含唯一的非空字符串。")
    if kind in ("integer", "number"):
        types = (int,) if kind == "integer" else (int, float)
        if (any(type(rule.get(key)) not in types or isinstance(rule[key], float) and not isfinite(rule[key])
                for key in ("min", "max")) or rule["min"] > rule["max"]):
            raise AccessError("数值参数必须声明有效的 min 和 max。")
        if kind == "integer" and (type(rule.get("step", 1)) is not int or rule.get("step", 1) < 1):
            raise AccessError("整数 step 必须为正整数。")
    if not valid_value(rule, rule["default"]):
        raise AccessError("参数默认值无效。")


def mapping(value):
    return isinstance(value, dict) and all(nonempty(key) and nonempty(item) for key, item in value.items())


def validate_model(model):
    if not versioned(model):
        raise AccessError("不支持的模型条目版本。")
    for key in ("id", "label", "provider", "task"):
        if not nonempty(model.get(key)):
            raise AccessError(f"缺少有效的 {key}。")
    aliases = model.get("aliases", [])
    if not isinstance(aliases, list) or not all(map(nonempty, aliases)) or len(set(aliases)) != len(aliases):
        raise AccessError("aliases 必须为唯一的非空字符串。")
    for key in ("inputs", "outputs"):
        if not mapping(model.get(key)):
            raise AccessError(f"{key} 必须声明语义名称及类型。")
    if not model["outputs"]:
        raise AccessError("模型必须声明输出。")
    params = model.get("parameters")
    if not isinstance(params, dict) or not all(map(nonempty, params)):
        raise AccessError("parameters 必须按语义名称定义。")
    if params.keys() & model["inputs"].keys():
        raise AccessError("参数与输入使用了相同的语义名称。")
    for rule in params.values():
        parameter(rule)
    run = model.get("execution")
    if not isinstance(run, dict) or not all(nonempty(run.get(key)) for key in ("adapter", "route", "modelField")):
        raise AccessError("执行方式、路由及型号映射必须明确。")
    for name, expected in (("inputs", params.keys() | model["inputs"].keys()), ("outputs", model["outputs"].keys())):
        fields = run.get(name)
        if not mapping(fields) or fields.keys() != expected or len(set(fields.values())) != len(fields):
            raise AccessError(f"execution.{name} 映射不完整或重复。")
    if run["modelField"] in run["inputs"].values():
        raise AccessError("型号映射与输入映射冲突。")
    location = model.get("environment")
    if (not isinstance(location, dict) or location.get("openness") not in ("open", "closed", "unknown")
            or not nonempty(location.get("evidence")) or location.get("location") not in ("local", "internal", "external")):
        raise AccessError("必须声明开放属性、依据和运行位置。")
    constraints = model.get("constraints", {})
    if not isinstance(constraints, dict):
        raise AccessError("constraints 必须为对象。")


@dataclass(frozen=True)
class Catalog:
    models: dict
    aliases: dict
    errors: dict
    error: str = ""
    preferences: dict = field(default_factory=dict)

    def resolve(self, value):
        return self.models.get(self.aliases.get(value)) if isinstance(value, str) else None

    def preferred(self, consumer, stage):
        stages = self.preferences.get(consumer, {})
        return self.resolve(stages.get(stage, stages.get("*")))


def load_catalog(directory=MODELS_PATH):
    try:
        manifest = read_json(directory / "catalog.json")
        if not versioned(manifest):
            raise AccessError("不支持的模型目录版本。")
        preferences = manifest.get("preferences", {})
        if not isinstance(preferences, dict) or not all(
            nonempty(name) and mapping(stages) for name, stages in preferences.items()
        ):
            raise AccessError("preferences 必须按消费方和阶段登记首选模型。")
        paths = sorted((directory / "entries").glob("*.json"))
    except (ValueError, OSError) as exc:
        return Catalog({}, {}, {}, f"无法读取模型目录。{exc}")
    models, aliases, errors = {}, {}, {}
    for path in paths:
        try:
            model = read_json(path)
            validate_model(model)
        except (ValueError, OSError) as exc:
            errors[path.stem] = str(exc)
            continue
        identity = model["id"]
        names = {identity, model["provider"], model["label"], *model.get("aliases", [])}
        duplicates = names & aliases.keys()
        if duplicates:
            error = "模型 ID、提供方名称、显示名或旧值别名重复：" + ", ".join(sorted(duplicates))
            return Catalog({}, {}, {path.stem: error}, error)
        models[identity] = model
        aliases.update(dict.fromkeys(sorted(names), identity))
    return Catalog(models, aliases, errors, preferences=preferences)


@dataclass(frozen=True)
class Environment:
    mode: str | None
    error: str = ""

    def reason(self, model):
        if self.error:
            return self.error
        location = model["environment"]
        if self.mode == "internal" and (location["openness"] != "open" or location["location"] == "external"):
            return "内网环境仅允许有开放依据的本地或内网模型。"
        return ""


def load_environment(user_directory):
    path = Path(user_directory) / "daelab" / "model-access.json"
    try:
        data = read_json(path)
        if not versioned(data) or data.get("mode") not in ("internal", "external"):
            raise AccessError("配置须为版本 1，mode 须为 internal 或 external。")
    except FileNotFoundError:
        # A broken symlink represents an unreadable configured file.
        if not path.is_symlink():
            return Environment("external")
        return Environment(None, "模型环境配置指向不存在的文件。")
    except (ValueError, OSError) as exc:
        return Environment(None, f"无法读取模型环境配置。{exc}")
    return Environment(data["mode"])
