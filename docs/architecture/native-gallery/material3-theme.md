# 创作画布 Material 3 主题

## 范围与契约
- 用户批准的第一阶段：真实创作画布外壳、共享按钮/字段、节点选择列表、类型胶囊、缩放与状态反馈。
- 唯一主题变量与字体入口：`web/creative_theme.css`。`web/creative_canvas.css` 和 `frontend/src/design/tokens.css` 共用它，避免展示页与原生画布分叉。
- 复用 `creative_button.mjs`、`creative_field.mjs`、`leasePanel`，保留禁用、异步忙碌、校验、序列化与模式释放契约。业务面板仍归原业务模块所有。
- `.dae-creative` 与 `.dae-ui` 内生效；旧 App Mode 和 ComfyTV 上游源文件不改动。Studio 的已租用通用控件仅在创作画布作用域覆盖原来的高优先级颜色/字体。
- Material 3 色彩角色：surface / surface-container / primary / secondary-container / outline / error；14px 正文、16px 标题、12px 辅助文字。桌面密度按钮 36px，紧凑按钮 32px；减少动态效果设置下禁用过渡。
- 类型胶囊为只读标签，不伪装成可点击 chip。Slot 与连线属于画布自定义交互，保持左右边框位置和现有快捷键。

## 字体与分发
- Alibaba PuHuiTi 3.0 的原始 WOFF2：Regular 400、Medium 500、SemiBold 600。仅复制本地完整字体文件，不转换、不裁剪。
- 字体、原始法律声明与 SHA-256 清单随 `web/vendor/alibaba-puhuiti-3/` 一起分发；`@font-face` 使用相对 URL，不使用 `local()` 或 CDN。
- Vue 辅助陈列构建需输出相同字体和许可文件。扩展安装时保留完整 `web/` 目录即可。
- 浏览器必须验证实际使用 web font，不能仅断言 font-family 字符串。另检查冷缓存加载、中文与英文、400/500/600 字重及刷新恢复。

## 验收
真实原生控件陈列与两个 LibTV 节点，检查常规/悬停/焦点/禁用/忙碌/错误状态、双实例独立性、画布交互及旧模式隔离。生成请求拦截，不进行付费调用。结果在完成后记录。

参考：https://m3.material.io/styles/color/roles 、https://m3.material.io/foundations/design-tokens/overview

## 本轮验证结果
- 真实 ComfyUI 原生画布：两个 LibTV 节点的展开面板、紧凑卡片、节点列表截图已检查。
- Chromium 平台字体接口确认实际中文 glyph 使用 Alibaba PuHuiTi 3.0 Regular / Medium / SemiBold，均为 `isCustomFont: true`，三个文件从扩展自身返回 HTTP 200；刷新后仍有效。未使用 local()、CDN 或字体裁剪。
- 字体共 16,207,176 bytes（约 15.46 MiB）；Vite 构建输出三份原始字体及完整许可，SHA-256 与本地原包完全一致。
- 通用按钮 15 项、字段及模式 14 项、主题/字体 8 项浏览器检查通过；画布新增/改名/双向连线/删除/保存/刷新通过；21 项相关 Node 测试通过。
- 常规文字、辅助文字、主按钮文字对比度达到 4.5:1，字段边界达到 3:1；尊重 reduced-motion。
- 生成入口仅以本地 Promise 验证忙碌恢复，未发出生成请求。旧徽章/展厅仅验证 App Mode 加载与作用域隔离，未做业务生成回归。
- 多机器一致性由包内字体和构建资源校验保障；没有宣称已在第二台物理机器验收，操作系统抗锯齿仍可能略有差异。

## 四项新增菜单与拖线新增
2026-09-28：新增入口固定为图片（ComfyTV.ImageStage）、视频（ComfyTV.VideoStage）、剪辑（ComfyTV.VideoClipStage）、故事板（ComfyTV.StoryboardEditorStage）。目录和接口匹配在 creative_canvas_catalog.mjs；宿主复用同一菜单，基于公开 nodeData 判断兼容性，创建时再检查实际接口。双击或拖线到空白处释放，在该位置显示菜单；取消、模式退出、源节点删除均清理临时连线。旧工作流的其他节点继续显示，不修改只读上游源文件。

四项菜单浏览器验收通过：四项展示、动态输入自动连接、反向新增来源、边缘防溢出、Esc/外部点击取消、源删除清理、保存刷新恢复。没有发出生成请求。
