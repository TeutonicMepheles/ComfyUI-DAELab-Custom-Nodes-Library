# LibTV 多参考演示

将 MultiReference Demo.json 拖入同时加载 DAELab 节点和 ComfyTV 的 ComfyUI。
演示只包含一个 `DAELAB.LibTV.VideoGenerate` 视频指令节点，三张图片经 ImageBatch 接入 reference_images。
先在三个 LoadImage 中选择自己的同尺寸参考图，再在视频节点登录 LibTV、选择画布。

| 模型 | 全能参考演示参数 | 当前能力范围 |
|---|---|---|
| Seedance 2.0 | 4 秒 / 480p / 16:9 | 4–15 秒；480p、720p、1080p、4k |
| Seedance 2.5 | 5 秒 / 720p / 16:9 | 4–30 秒；480p、720p、1080p |
| Minimax H3 | 5 秒 / 768P / 16:9 | 5–15 秒；768P、2K |

能力来自 2026-09-26 官方 CLI schema；实际以账号实时读取结果为准。

1. 选择全能参考，按输入顺序在提示词中使用 @image_1、@image_2、@image_3。
2. 选择模型，设置时长、分辨率、画幅；不支持的选项会禁用。H3 首帧/首尾帧使用 adaptive 画幅。
3. 每次有意生成新内容前更换任务 ID；同一 ID 用于恢复原任务，不能拿它更换参数。
4. 点击 ComfyUI 运行。生成会消耗当前 LibTV 账号积分。
5. 返回视频可在节点预览，并导入 ComfyTV 素材节点继续连接后续处理。

首尾帧演示：断开 reference_images，分别连接两张 LoadImage 到 first_frame、last_frame，切换首尾帧模式。
视频参考：将 COMFYTV_VIDEO 接入 reference_video。音频或额外素材可在参考素材路径 JSON 中填写本机文件路径。
本演示的实跑范围为三图全能参考；音频、视频混合参考和所有参数组合不代表已经逐一实测。

模板不携带账号、画布 ID、登录凭据、输出视频或测试任务记录。换机器需要安装依赖并在该机器登录 LibTV。

实测结果：三模型各一次三图全能参考均成功返回；2.0 为 864×496 / 4.04 秒，2.5 为 1280×720 / 5.04 秒，H3 为 1344×768 / 5.17 秒。档位名称不等于精确像素。返回视频接入 ComfyTV Extract Frame 成功。
