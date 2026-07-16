# Polygon Mask

## 节点信息

- 节点 ID：`PolygonMask`
- 显示名称：`Polygon Mask`
- 分类：`image/polygon`

## 功能

接收外部 `IMAGE` socket，在节点内提供多个多边形的编辑画布，并输出带多边形叠加的图像和原图尺寸黑白 mask。

如果输入直接连接 ComfyUI `Load Image`，点击 `Load Image` 会读取上游节点当前选择的文件并立即载入画布，不等待工作流执行。其他 `IMAGE` 来源会复用最近一次用户主动运行工作流后返回的图像；按钮本身永远不会自动排队。

该节点基于提交 `c389cc2` 之前的 SAM3 多边形编辑器版本演进而来。

## 输入

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `image` | `IMAGE` | 外部图像来源，例如 ComfyUI `Load Image`。 |
| `vertex_count` | `INT` | 重置或新增多边形时使用的顶点数，范围 3–12。 |
| `color` | `COLOR` | 多边形颜色，兼容 LayerUtility/LayerStyle Color Picker。 |
| `fill_opacity` | `INT` | 填充透明度，范围 0–100。 |
| `outline_width` | `INT` | 轮廓宽度，范围 0–20。 |
| `polygon_data` | `STRING` | 隐藏的高级状态输入，由前端编辑器维护。 |

## 输出

| 输出 | 类型 | 说明 |
| --- | --- | --- |
| `masked_image` | `IMAGE` | 在输入图像上绘制全部多边形后的结果。 |
| `raw_mask` | `MASK` | 与输入图像同尺寸的黑白 mask；多边形填充区域为白色，其余区域为黑色。 |

## 编辑操作

- 按住 `Shift` 并左键点击图像：新增一个三角形多边形。
- 按住 `Shift` 并右键点击多边形：删除该多边形。
- 点击填充区域：选择多边形。
- 拖动已选多边形的填充区域：整体移动，不改变形状。
- 拖动已选多边形的顶点：调整形状。
- 双击已选多边形的任意边（包括闭合边）：插入新顶点。
- `Clear`：删除当前选中的多边形。
- `Reset`：按当前 `vertex_count` 重建已选多边形，并保持其中心位置。
- `Load Image`：立即加载相连 `Load Image` 的当前文件；非文件 socket 需要先手动运行工作流一次。
- `Refresh`：只重绘预览，不改变已保存顶点。
- `Undo` / `Redo`：逐步撤销或重做多边形编辑。

保存并重新打开工作流时，会恢复最近图像标识、选中状态和全部多边形数据。

## 状态同步与兼容性

- 前端在 ComfyUI 构建 Prompt 前立即序列化当前多边形，因此拖动后直接排队也会使用最新顶点。
- 后端优先采用当前 Prompt 中的 `polygon_data`，避免旧 `extra_pnginfo` 覆盖刚编辑或刚清空的状态。
- 没有 `polygon_data` 的旧工作流仍可从 `properties.polygon_info` 恢复多边形。
- 图像连接解析优先使用节点自身所属 graph，并兼容对象和 `Map` 两种链接存储，避免多个工作流使用相同节点 ID 时串图。
- 输入图像或上游连接改变时，预览图身份会同步更新；`Load Image` 不会触发下游节点执行。

## 测试覆盖

- 后端：当前 Prompt 覆盖旧属性、清空状态、非法旧属性和旧工作流回退。
- 前端：节点所属 graph 优先级、同 ID 工作流隔离和 `Map` 链接解析。

## 相关文件

- 后端：`node.py`
- 前端：`../../web/polygon_mask.js`
- 连接解析模型：`../../web/polygon_mask_connection.mjs`
- 后端测试：`../../tests/test_polygon_mask.py`
- 前端测试：`../../tests/polygon_mask_connection.test.mjs`
