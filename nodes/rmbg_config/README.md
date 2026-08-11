# RMBG Config

为 `遮罩提取 (RMBG) 🎭`（节点 ID：`AILab_MaskExtractor`）集中提供背景类型和背景颜色参数。

## 节点信息

- 节点 ID：`RMBGConfig`
- 显示名称：`RMBG Config`
- 分类：`DAELab/RMBG`
- 输出：`background`、`background_color`

## 输入与输出

节点将以下两个参数原样输出：

- `background`：`Alpha`、`original` 或 `Color`，默认 `Alpha`。
- `background_color`：RMBG 的 `COLORCODE` 颜色值，默认 `#FFFFFF`。

背景选择 `Color` 时，RMBG 节点使用 `background_color` 填充遮罩外区域；选择 `Alpha` 时输出透明背景。

## 连接方法

1. 在 `遮罩提取 (RMBG) 🎭` 节点上将 `background` 和 `background_color` 转换为输入端口。
2. 将本节点的两个同名输出连接到对应端口。

同一个输出可以连接多个 RMBG 节点，从而统一控制它们的背景设置。

## 应用构建模式

应用构建器会把 `background` 和 `background_color` 显示为一个 `RMBG Config` 组合输入。勾选或取消该组合输入时，两个参数会同时开启或关闭；组合输入内部仍可分别设置背景类型和颜色。

旧工作流若分别暴露了两个成员，前端会折叠成稳定的 `rmbg_config_panel` 输入并保留已有面板配置。节点进入 Bypass、Mute 或其他非正常执行模式时，最终应用中的组合输入会隐藏；恢复正常模式后重新显示。

## 依赖与边界

- Config 节点本身只传递背景枚举和标准化颜色字符串，不加载 RMBG 模型，也不需要额外 pip 包。
- 实际抠图仍依赖 `AILab_MaskExtractor` 所属节点包及其模型环境；该依赖不由 Config 节点安装。
- 完整交付需包含根 `__init__.py`、`web/rmbg_config.js`、`web/rmbg_config_panel.mjs` 和共享的 `web/app_mode_bypass.js`。

## 测试与相关文件

- 后端：`node.py`
- 前端面板：`../../web/rmbg_config.js`
- 面板纯逻辑：`../../web/rmbg_config_panel.mjs`
- 后端测试：`../../tests/test_rmbg_config.py`
- 前端测试：`../../tests/rmbg_config_panel.test.mjs`
