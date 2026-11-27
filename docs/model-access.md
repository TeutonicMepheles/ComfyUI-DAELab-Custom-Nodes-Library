# CNL 模型接入

CNL 在 ComfyUI 启动时读取 [模型目录](../model_access/models/catalog.json)和 `entries/` 中的独立 JSON 文件。当前登记 GPT-Image-2、GPT-Image-2.5 Flare 和 GPT-Image-2.5 Sunburst。三款均由本机的 `OpenAIGPTImageNodeV2` 通过 ComfyUI 原有 API 节点通道执行，凭据仍由宿主管理。新增条目、调整策略或更换宿主节点后重启 ComfyUI，再重新打开浏览器工作流。

## 安装环境

在 `folder_paths.get_user_directory()` 返回的目录内，将环境文件放在 `daelab/model-access.json`。

| 设置 | 行为 |
| --- | --- |
| 文件确实缺失 | 使用 `external` |
| [外网配置](../model_access/examples/environment-external.json) | 使用符合安装条件的模型 |
| [内网配置](../model_access/examples/environment-internal.json) | 使用有开放依据且可在本地或内网执行的模型。首批三款外部 API 模型均不可用 |
| 读取失败、非法 JSON、未知版本或未知模式 | 停用受管生成入口并显示原因 |

编辑、保存、选择预览、命中的 Color ID Map 和原有本地抠图仍按各工作流的路径处理。原生无标记的图像 API 请求由 ComfyUI 校验。徽章执行器节点按类型识别。

## 登记模型

可复制 [GPT-Image-2 条目](../model_access/models/entries/gpt-image-2.json) 作为可用的图片配置结构。若执行协议、端口类型或运行方式改变，先注册对应适配器并在适用的阶段声明中加入它。

| 字段 | 要求 |
| --- | --- |
| `version` | 整数 `1` |
| `id`、`label`、`provider` | 分别为稳定 ID、显示名和宿主接受的模型名。同一字段值只可指向一个模型 |
| `aliases` | 可选字符串数组，缺省为空。改名后在原条目登记旧名称，复用原 ID |
| `task` | 稳定任务名，如 `image` 或 `text`，需与消费方阶段一致 |
| `inputs`、`outputs` | 语义端口名称到端口类型的映射，至少声明一个输出 |
| `parameters` | 每个参数声明 `type` 和合法 `default`。枚举用唯一的 `values`，数值用 `min`、`max`，整数可指定 `step`，缺省为 1 |
| `constraints` | 缺省为空对象。图片适配器读取 `customDimensions` 的 `maxAspect`、`minPixels`、`maxPixels` |
| `execution` | `adapter` 引用已注册的适配器，`route` 由适配器审核，`modelField` 为实际型号字段。所有输入、参数和输出都要在 `inputs`、`outputs` 有唯一映射 |
| `environment` | 记录 `openness`（`open`、`closed` 或 `unknown`）、`evidence`（出处、授权或内部依据）和 `location`（`local`、`internal` 或 `external`） |

无法解析的条目按文件名报告错误，重复标识和别名会使目录无法解析。已登记但缺少适配器、宿主型号或端口的模型会返回逐项原因。模型能力会收窄到宿主和对应阶段允许的范围，参数交集为空时该模型从该阶段移除。保存值无法解析时保留原值，由操作入口提示原因。用户主动切换模型时，共享配置面板只调整冲突字段并列出调整项。

## 查询和提交

`GET /daelab/cnl/model-access?consumer=exhibition&stage=build` 返回合同版本、环境、阶段要求、有效模型、默认模型 `defaultModel` 及逐项原因。ComfyUI 同时映射 `/api/daelab/cnl/model-access`。徽章阶段为 `build`、`local`、`studio`、`color_map`、`edit`，旧版徽章的多区域材质使用 `region_materials`。展厅阶段为 `build`、`description`、`replacement`、`edit`。

没有已保存的模型时，接入模块根据该阶段的候选选择默认模型。`catalog.json` 的 `preferences` 可按消费方和阶段设置首选型号，`*` 适用于该消费方的其余阶段。首选型号不可用时，模块从其他符合阶段要求的模型中选择。已保存的型号不可用时保留该值并提示原因。

`model_access.service.ModelAccess` 通过 `register_adapter`、`register_consumer` 注册执行适配器和阶段需求。适配器实现 `probe(model, node_info, state)` 及 `compile(model, parameters, inputs)`。阶段声明任务、语义端口、必需参数类型、允许的适配器及可选限制。可通过 `query` 查询，通过 `authorize` 校验参数，再由 `compile` 补充有效默认值并调用适配器。工作流的节点编号、参考图源和历史标记由消费方维护。

查询结果的 `execution.nodeType` 来自执行适配器。支持 ComfyUI 原生节点的适配器用它定位宿主节点定义及 `price_badge`，无需在消费者维护模型到节点的映射。

`POST /prompt` 和 `POST /api/prompt` 在 ComfyUI 原生校验及节点替换之后检查实际入队图。徽章依据最终执行器类型和请求阶段选规则。展厅依据 `extra_data.extra_pnginfo.workflow.extra.daelabExhibitionUiV1` 及最终执行路径选规则，直接调用提交接口时也需保留工作流标记。入队前可判定的错误返回 400 和宿主格式的 `error`、`node_errors`。展厅的 `auto` 保留宽高连线，`Custom` 校验字面量、`PrimitiveInt` 及现有已知 `GetImageSize+` 来源。动态尺寸由原生图像节点在发出 API 请求前复核。Color ID Map 的运行时依赖可用后才判定命中，缓存未命中时在展开外部调用前校验权限。

回滚到 CNL `20261119.2` 会移除此模块的环境策略和受管入队校验。旧版会保留现有环境文件，但运行时忽略它。
