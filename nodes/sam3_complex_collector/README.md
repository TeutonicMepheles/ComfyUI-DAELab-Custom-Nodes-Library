# SAM3 Complex Collector

## 节点信息

- 节点 ID：`SAM3ComplexCollector`
- 显示名称：`SAM3 Complex Collector`
- 分类：`SAM3`
- 输出节点：是，可作为 ComfyUI 局部执行目标

## 功能

在一个节点内整合 BBox 与交互式 Prompt 编辑器，接收 `SAM3_MODEL_CONFIG` 和 `IMAGE`，生成 SAM3 masks 与标注可视化图像。

节点内 `Run` 支持局部分割预览：首次运行或模型、图像等上游依赖改变时，只执行必要的上游依赖和当前 collector 来建立 SAM3 会话；缓存有效时，后续操作通过独立接口复用图像特征，不执行下游工作流节点。

## 输入

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `sam3_model_config` | `SAM3_MODEL_CONFIG` | 来自 `LoadSAM3Model` 的模型配置。 |
| `image` | `IMAGE` | 待标注图像。 |
| `collector_mode` | `bbox` / `interactive` | 隐藏的当前标签页状态。 |
| `bboxes` | `STRING` | 隐藏的 BBox 正向框数据。 |
| `neg_bboxes` | `STRING` | 隐藏的 BBox 负向框数据。 |
| `multi_prompts_store` | `STRING` | 隐藏的交互式多 Prompt 数据。 |

## 输出

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `masks` | `MASK` | 所有有效 Prompt 生成的 SAM3 masks。 |
| `visualization` | `IMAGE` | 在输入图像上叠加 masks 的可视化结果。 |

正常排队执行工作流时，节点会计算当前模式下的全部有效 Prompt。没有有效 Prompt 时，返回与输入图像同尺寸的空 mask 和原图。

## 通用工具栏

- `Load Image`：从相连图像节点的文件、上传值、图像属性或已渲染预览读取画布图像，并使旧 SAM3 会话失效；该操作不会自动排队。
- `BBox Collector` / `Interactive Collector`：切换编辑模式，两个模式分别保存自己的状态。
- `Run`：只更新节点内的分割预览。第一次运行可能执行 collector 及必要上游依赖以初始化会话，但不会执行下游节点。

要把最新 Prompt 结果传递给下游节点，仍需正常运行工作流。

## BBox Collector

- 左键拖拽：添加正向框。
- `Shift` + 左键拖拽，或右键拖拽：添加负向框。
- 在已有框上右键：删除该框。
- `Run`：一次运行全部正向框；每个正向框作为独立 Prompt，当前全部负向框会应用到每个正向 Prompt。
- `Clear All`：清空全部正向和负向框。

正向框使用稳定 ID。新增、删除或调整单个正向框时，缓存会按几何指纹只重算变化的 Prompt；负向框属于所有 BBox Prompt 的共享约束，修改它会使相关结果全部重算。

## Interactive Collector

- 左键点击：添加正向点。
- 右键点击：添加负向点。
- `Shift` + 左键拖拽：添加正向框。
- `Shift` + 右键拖拽：添加负向框。
- Prompt 标签栏：切换当前 Prompt；`+` 新增 Prompt，`x` 删除 Prompt，最多 8 组。
- `Run`：只运行当前活动 Prompt，并保留其他未变化 Prompt 的缓存结果。
- `Clear Prompt`：清空当前 Prompt；`Clear All`：重建为空的第一组 Prompt。

## 会话缓存与运行限制

- 服务端最多保留 2 个最近使用的 SAM3 会话，每个会话空闲 10 分钟后过期。
- 会话失效、过期或上游依赖改变时，下一次 `Run` 会自动重新执行局部初始化。
- 独立分割接口在 ComfyUI 已有工作流运行或排队时拒绝执行，避免与模型推理争用；待队列空闲后再次点击 `Run`。
- Prompt 改名不会触发重算；点和框几何变化、删除 Prompt 或修改共享负向框会使对应缓存失效。
- 会话缓存只用于交互预览，不会持久化到工作流文件或 ComfyUI 重启之后。

## 依赖

- 软依赖：`comfyui-sam3` 自定义节点包，需单独安装到 ComfyUI `custom_nodes`。
- SAM3 模型需通过 `LoadSAM3Model` 节点提供配置。

## 测试覆盖

- Prompt 几何指纹与稳定 ID。
- LRU 容量、过期清理和 cache miss。
- 活动 Prompt / 全部 BBox 的运行范围与增量复用。
- 删除、修改 Prompt，以及共享负向框导致的失效行为。
- 局部执行目标、缓存令牌和输出 UI 数据。

## 相关文件

- 后端：`node.py`
- SAM3 共享实现：`../_shared_sam3.py`
- 前端：`../../web/sam3_complex_collector.js`
- 测试：`../../tests/test_sam3_complex_collector.py`
