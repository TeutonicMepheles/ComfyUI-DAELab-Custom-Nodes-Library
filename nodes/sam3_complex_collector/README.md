# SAM3 Complex Collector

## 节点信息

- Node ID: `SAM3ComplexCollector`
- Display name: `SAM3 Complex Collector`
- Category: `SAM3`

## 功能

集 BBox 与交互式 Prompt 收集于一体，接收 `SAM3_MODEL_CONFIG` 和 `IMAGE` 输入，在两个可切换的标签页中收集 SAM3 prompt 数据，输出 mask 和可视化结果。

- **BBox 模式**：通过画布框选收集正向/负向矩形区域，自动生成 SAM3 prompt。
- **交互式模式**：从 SAM3 Interactive Segment 节点读取 multi-prompts 数据，与 SAM3 交互式分割流程对接。

## 输入

| 输入 | 类型 | 说明 |
|------|------|------|
| `sam3_model_config` | `SAM3_MODEL_CONFIG` | SAM3 模型配置，来自 LoadSAM3Model 节点 |
| `image` | `IMAGE` | 待标注图像 |
| `collector_mode` | 下拉选项 | 内部 UI 状态：`bbox` / `interactive` |
| `bboxes` | `STRING` | 内部：BBox Collector 正向框数据 |
| `neg_bboxes` | `STRING` | 内部：BBox Collector 负向框数据 |
| `multi_prompts_store` | `STRING` | 内部：Interactive Collector prompt 数据 |

## 输出

| 输出 | 类型 | 说明 |
|------|------|------|
| `masks` | `MASK` | SAM3 推理生成的 mask |
| `visualization` | `IMAGE` | 标注可视化图像 |

如无有效 prompt 数据，输出与输入图像同尺寸的空白 mask 和原图可视化。

## UI

- 节点顶部工具栏提供 **BBox** 和 **Interactive** 两个模式切换按钮。
- **BBox 模式**：在画布上用鼠标拖拽框选 BBox，左键拖拽添加正向框，右键拖拽添加负向框。最多支持 8 组 prompt。
- **交互式模式**：读取下游 SAM3 Interactive Segment 节点的 prompt 数据，在画布上预览 prompt 点/框分布。
- 画布实时显示正向/负向标注区域，不同 prompt 用不同颜色区分。
- 工具栏显示当前 prompt 数量和模式状态。

## 依赖

- **软依赖**：`comfyui-sam3` 自定义节点包。需单独安装至 ComfyUI `custom_nodes` 目录。
- SAM3 模型需通过 LoadSAM3Model 节点加载配置。

## 文件

- Backend: `node.py`
- Shared: `../_shared_sam3.py`
- Frontend: `../../web/sam3_complex_collector.js`
