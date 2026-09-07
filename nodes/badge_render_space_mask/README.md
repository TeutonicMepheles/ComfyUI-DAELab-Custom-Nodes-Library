# 徽章效果图坐标系遮罩配准 V1

## 节点信息

- 节点 ID：`DAELAB.BadgeRenderSpaceMaskAlignV1`
- 显示名称：`Badge Render-Space Mask Align V1 (DAELab)`
- 分类：`DAELab/Badge/Mask`

## 功能

将平面设计阶段产生的前景和局部区域遮罩，配准到 GPT 生成后的徽章效果图坐标系。默认的 `target_appearance` 模式会在目标效果图上做全局 Lab 颜色聚类，因此图中外观相同的区域使用相同 ID；源图负责几何配准和结构约束。可选的 `source_palette` 模式则直接传播源图颜色类别。输出是可交给 `Color To Mask` 的高对比纯色 ID Map。V1 不调用生成模型，也不依赖 ComfyTV。

这个版本用于验证“全局相似变换是否足够”。如果叠加预览仍显示明显的局部形变，后续版本再增加光流或分割模型边界吸附。

## 输入

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `source_image` | `IMAGE` | 原平面图或标签图。 |
| `target_image` | `IMAGE` | GPT 生成后的徽章效果图，是输出遮罩的坐标权威。 |
| `source_foreground_mask` | `MASK` | 原平面图的徽章前景。 |
| `source_region_mask` | `MASK` | 用户在原平面图上选择的局部区域。 |
| `extraction_mode` | `COMBO` | `auto_border` 自动提取目标前景；`source_prior_only` 只验证遮罩传播。 |
| `background_threshold` | `FLOAT` | 目标图像素与边缘背景色的 RGB 距离阈值。 |
| `max_rotation` | `FLOAT` | 允许搜索的最大旋转角。 |
| `max_scale_delta` | `FLOAT` | 允许搜索的最大比例变化。 |
| `snap_radius` | `INT` | 目标前景可以偏离旧轮廓的最大像素半径。 |
| `region_inset_px` | `INT` | 对最终区域向内收缩，降低 GPT 局部编辑溢出风险。 |
| `minimum_iou` | `FLOAT` | QA 报告判定有效所需的最低初始 IoU。 |
| `color_region_count` | `INT` | 全局颜色类别数量，默认 12。 |
| `color_smoothing_px` | `INT` | 去除抗锯齿和细碎颜色噪点的半径，默认 2。 |
| `snap_region_boundaries` | `BOOLEAN` | 使用目标效果图边缘对传播后的色区边界做确定性 watershed 吸附。 |
| `split_disconnected_regions` | `BOOLEAN` | 仅在 `source_palette` 模式中可选地拆分断开的同色块；默认关闭。 |
| `minimum_color_region_pixels` | `INT` | 断开色块获得独立颜色所需的最小源像素数；更小碎片仍归入原颜色簇。 |
| `region_boundary_tolerance_px` | `INT` | 目标边缘最多只能在源色区边界周围多少像素内改变归属；设为 0 等同于不改变源色区边界。 |
| `maximum_color_regions` | `INT` | 最多输出多少个独立连通色区，默认 32。 |
| `id_map_basis` | `COMBO` | `target_appearance` 按效果图全局颜色归类；`source_palette` 传播原平面图颜色类别。 |

## 输出

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `target_foreground_mask` | `MASK` | 从效果图提取并受源拓扑约束的新前景遮罩。 |
| `aligned_region_mask` | `MASK` | 已转换到效果图坐标系的局部区域遮罩。 |
| `aligned_source_image` | `IMAGE` | 使用同一变换后的源图，便于目视比较。 |
| `alignment_overlay` | `IMAGE` | 红色为区域，青边为旧前景，绿边为目标前景。 |
| `confidence_preview` | `IMAGE` | 绿色代表新旧前景一致，红色代表边界变化。 |
| `report` | `STRING` | 变换矩阵、IoU、边界误差、像素数和有效性。 |
| `color_region_map` | `IMAGE` | 黑色背景加高对比纯色色区，可直接接 `Color To Mask`。 |
| `palette_report` | `STRING` | 每个色区的精确十六进制颜色、像素数及对应源颜色中心。 |
| `source_color_region_map` | `IMAGE` | 源图坐标系下的同一套 ID Map，用于和目标结果逐色核对。 |

## 使用步骤

1. 先在原平面图上生成前景遮罩和颜色区域遮罩。
2. 把 GPT 生成后的初版或最终材质图接到 `target_image`。
3. 查看 `alignment_overlay`：青绿边越重合越好，红色填充应落在期望区域内。
4. 对照 `source_color_region_map` 与 `color_region_map`；相同纯色代表同一个源颜色语义。
5. 从 `palette_report` 复制目标色，例如 `#FF1744`，交给 `Color To Mask` 精确取区。
6. 单一旧选区仍可直接使用 `aligned_region_mask`；多色区工作流优先使用 `color_region_map`。
7. 若 `valid=false`，不要发起付费局部编辑；先调整背景阈值、旋转或缩放范围。

## 限制

- V1 的整体配准只处理平移、缩放和旋转；色区边界会向目标图边缘吸附，但无法恢复 GPT 已经删除或重新设计的结构。
- `auto_border` 适合透明感较弱的纯色背景；复杂摄影背景建议提供独立分割遮罩，或升级到带分割模型的后续版本。
- 这个节点传播已有语义标签，不会从材质化效果图中重新猜测区域含义。

## 相关文件

- 后端：`node.py`
- 独立测试工作流：`user/default/workflows/#8.7 - Badge Render-Space Mask Test.json`
