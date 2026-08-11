# Load Image (App Mode)

`Load Image (App Mode)` 是支持应用面板 Bypass 联动的图片上传节点。它继承 ComfyUI 原生 `LoadImage`，因此图片上传、输入目录选择、多帧图片读取、Alpha 通道 Mask、缓存校验与输入验证行为均与原生节点一致。

## 节点信息

- 节点 ID：`AppModeLoadImage`
- 显示名称：`Load Image (App Mode)`
- 分类：`DAELab/Image`
- 输入：`image`（原生图片选择与上传控件）
- 输出：`IMAGE`、`MASK`

## 应用模式行为

将 `image` 加入应用输入面板后：

- 节点处于正常模式时，图片上传项正常显示；
- 节点被设为 Bypass、Mute 或其他非正常执行模式时，对应应用面板项折叠隐藏；
- 节点恢复正常模式时，对应应用面板项自动恢复显示。

## 使用方法

1. 在节点搜索中添加 `Load Image (App Mode)`。
2. 像原生 `Load Image` 一样选择或上传图片，并连接 `IMAGE` / `MASK` 输出。
3. 在应用构建模式中把该节点的 `image` 设为应用输入。
4. 通过节点模式或 Bypass 控制器切换状态，应用面板会同步折叠或恢复该输入。

已有工作流中的原生 `LoadImage` 不会被自动替换；请手动换成此节点并重新连接输出，以免静默修改现有工作流。

## 依赖与兼容性

- 后端继承 ComfyUI Core 的 `LoadImage`，因此要求对应 Core 版本仍提供该原生节点接口。
- 不需要独立模型、API Key 或额外 pip 包；图片解析依赖均随 ComfyUI 安装。
- 必须连同仓库根 `__init__.py`、`web/app_mode_bypass.js`、`web/app_mode_bypass_model.mjs` 和 `web/polygon_mask_app_mode_load_image_compat.js` 一起交付，才能获得完整 App Mode 与 Polygon Mask 兼容行为。

## 测试与相关文件

- 后端：`node.py`
- App Mode 联动：`../../web/app_mode_bypass.js`
- Polygon Mask 兼容：`../../web/polygon_mask_app_mode_load_image_compat.js`
- 后端测试：`../../tests/test_app_mode_load_image.py`
- 前端测试：`../../tests/app_mode_bypass_model.test.mjs`
