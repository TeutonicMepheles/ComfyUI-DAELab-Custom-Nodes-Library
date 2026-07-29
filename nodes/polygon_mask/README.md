# Polygon Mask

## 节点信息

- 节点 ID：`PolygonMask`
- 显示名称：`Polygon Mask`
- 分类：`image/polygon`

## 功能

接收外部 `IMAGE` socket，在节点内提供多个多边形的编辑画布，并输出带多边形叠加的图像和原图尺寸黑白 mask。

如果输入直接连接 ComfyUI `Load Image`，点击 `Load Image` 会读取当前节点所属 graph 中上游节点选择的文件并立即载入画布，不等待工作流执行。执行完成事件中的图片载荷不会覆盖该直接连接，避免复制工作流具有相同节点 ID 时串用其他工作流的结果。

其他 `IMAGE` 来源会把最近一次用户主动运行返回的图像暂存为执行预览。预览不会修改 `polygon_data`、properties、撤销历史或持久图片标识；点击 `Apply Preview` 后才会明确应用到编辑器。`Load Image` 和 `Apply Preview` 本身都不会自动排队。

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
- `Load Image`：立即加载当前 graph 中相连 `Load Image` 的当前文件；非文件 socket 需要先手动运行工作流一次。
- `Apply Preview`：间接 `IMAGE` 输入执行完成后出现；应用暂存预览，并根据图片尺寸迁移现有顶点。
- `Refresh`：重新加载已应用的图片，不清空有效 Polygon。
- `Undo` / `Redo`：逐步撤销或重做多边形编辑。

保存并重新打开工作流时，会恢复最近图像标识、选中状态和全部多边形数据。

## 换图行为

- 图片标识变化但尺寸不变：保持现有 Polygon 坐标和顶点数。
- 新旧图片尺寸均已知且尺寸变化：分别按宽度和高度比例缩放所有顶点。
- 旧图片尺寸未知：保持绝对像素坐标，并把越界坐标限制到新图片边界。
- 已执行 `Clear`、即 `cleared=true`：换图后继续保持空 Mask。
- 只有不存在有效 Polygon 且未清空时，才在图片中心创建默认三角形。
- `Reset` 仍是用户主动按当前 `vertex_count` 重建 Polygon 的入口。

## 状态同步与兼容性

- `polygon_data` widget 的 `beforeQueued` 和 `serializeValue` 共用同一同步逻辑，在 ComfyUI 构建 Prompt 前提交实时画布状态，因此拖动后直接排队也会使用最新顶点。
- 状态恢复顺序固定为 `polygon_data` widget、`properties.polygon_data_value`、旧版 `properties.polygon_info`；没有有效状态时才创建默认 Polygon。
- 后端优先采用当前 Prompt 中的 `polygon_data`，避免旧 `extra_pnginfo` 覆盖刚编辑或刚清空的状态。
- 没有 `polygon_data` 的旧工作流仍可从 `properties.polygon_info` 恢复多边形。
- Polygon 状态不再读取 `localStorage` 或 `DAELab.PolygonMask.*` 缓存键；浏览器中的遗留键不会主动删除。
- 图像连接解析优先使用节点自身所属 graph，并兼容对象和 `Map` 两种链接存储，避免多个工作流使用相同节点 ID 时串图。
- 直接 `Load Image` 的执行回传始终重新解析当前 graph 的文件；间接输入回传只写入临时预览字段，排队和工作流序列化仍使用已应用的 Polygon 状态。
- `masked_image` 同时受 Polygon、`color`、`fill_opacity` 和 `outline_width` 影响；`raw_mask` 只由 Polygon 几何形状决定。

## 测试覆盖

- 后端：当前 Prompt 覆盖旧属性、清空状态、非法旧属性和旧工作流回退。
- 前端：状态恢复优先级、排队前同步、同 ID 工作流隔离、当前 graph 优先级、执行回传分类、对象/`Map` 链接解析、同尺寸保留、异尺寸缩放、未知尺寸边界限制、清空状态和默认 Polygon 条件。

## 相关文件

- 后端：`node.py`
- 前端：`../../web/polygon_mask.js`
- 连接解析模型：`../../web/polygon_mask_connection.mjs`
- 图片状态迁移模型：`../../web/polygon_mask_image_state.mjs`
- 工作流状态同步模型：`../../web/polygon_mask_state.mjs`
- 后端测试：`../../tests/test_polygon_mask.py`
- 前端测试：`../../tests/polygon_mask_connection.test.mjs`、`../../tests/polygon_mask_image_state.test.mjs`、`../../tests/polygon_mask_state.test.mjs`
