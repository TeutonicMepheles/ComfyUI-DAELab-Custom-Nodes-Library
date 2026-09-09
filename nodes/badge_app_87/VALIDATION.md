# #8.7 验证记录

## 2026-09-09：张数并入分辨率行

按用户反馈移除独立“生成个数”区域及八个快捷按钮，将张数数值框放入 1K、2K 所在行，保留拖动和直接输入。浏览器实测三个控件顶部坐标相同，高度均约 36.67px，无横向溢出，张数快捷按钮数量为 0。共享 Bypass 与拖动相关 18 项测试通过。本次仅布局调整，无模型调用。

## 2026-09-09：数量拖动

两个页签的“生成个数”加入可直接输入或按住左键横向拖动的数值框，保留 1–8 张快捷按钮。复用现有颜色阈值的指针拖动机制，数量以每 12px 一档调节，限制在 1–8；取消拖动恢复原值，禁用时不提交。

浏览器真实鼠标验证：效果图 2→5、局部修改 3→5，快捷按钮同步；原生运行次数自身已有拖动层，实测 1→4 后恢复为 1，无需改写原生控件。前端 249 项测试通过，包括范围、取消与禁用保护。本次没有提交生成任务。

## 2026-09-09：生成数量 1–8 张

核对本机 ComfyUI `comfy_api_nodes/nodes_openai.py` 中 `OpenAIGPTImageNodeV2` 的 `n`：默认 1、最小 1、最大 8、步长 1。两个页签共用数量按钮并分别保存配置。原生初始生成传递 `n`，区域材质和局部确定性合成逐张执行后合并，防止批次截断；生成来源默认采用第一张。

Python 245 项、Node 248 项通过。浏览器验证全部 8 个选项，效果图设为 2 张、局部修改初始仍为 1 张；局部改为 3 张后返回效果图，仍保持 2 张。真实任务 `9c7376e7-90d5-4bc8-af8c-5dba38be0e4d`（效果图）和 `94bed984-819a-42a9-95f3-569a5d911721`（局部）各返回 2 张，共 4 张 Low、1024×1024 图片；局部两张的选区外最大像素误差均为 0，选区内均有修改。3–8 张通过范围和请求编译验证，未逐一调用模型。见 `validation_count_results.json`。

## 2026-09-09：局部目标来源

新增顶部“使用生成结果 / 已有效果图”胶囊，复用分段样式与 LoadImage 目标更新。默认生成结果，两种来源独立保存于工作流元数据；手动来源不被新生成覆盖。切换同步真实 LoadImage 值与预览，清除选区应用状态；生成来源暂无图片时明确提示先生成，上传入口只在已有来源显示。

浏览器验证默认生成来源 `Badge87/build_00005_.png`、切换到已有来源的空状态、图库选定 `flat.png`、键盘往返切换后分别恢复正确图片及上传入口显隐。前端 247 项测试通过，新增覆盖来源默认值、序列化往返、新生成不覆盖手动目标、上传期间切换拒绝旧结果。本次没有重新调用模型。

## 2026-09-09：互斥双项胶囊

按用户新参考图调整 #8.7 的选区方式、修改方式、取色来源三组控件。复用 `choiceRow` 和现有取色来源按钮，包装共同底座并添加装饰性 SVG；保留按钮回调及选中属性，折叠时隐藏整个底座。浏览器验证 1280px 视口下控件宽 480px，390px 视口下选项组宽 316px、取色来源约 291px，均无横向溢出；验证选中状态、分组折叠和响应式重建。现有前端 244 项测试通过，含共享 Bypass 的 13 项测试。本次仅视觉包装，未重新提交模型任务。

## 2026-09-09：效果图自动衔接局部编辑

效果图成功后复用 LoadImage 的带类型图片引用与回调，自动更新局部目标；清除旧预览令牌、应用状态与局部会话结果。失败、工作流切换或生成配置已改变的任务不会进入这一成功处理路径。原型 #8.6 不启用此行为，无新增控件或 CSS。

前端测试 244 项通过（新增 2 项验证图片引用、选区失效和原型隔离）。浏览器真实任务 `d7028384-59b7-4702-846c-6cd98fa0e715` 使用 Low、1024×1024、1 张，输出 `output/Badge87/build_00005_.png`；切换到“局部修改”后，目标区直接显示同一文件与图片，要求重新选择区域。未进行下载或重新上传。

日期：2026-09-08。分支：`codex/add-app-mode-workflow-controls`，开发起点 `1adebcde508fc8c10bd318dfe6912a771cb6c796`。

## 范围

新增 `#8.7 - Badge Workflow.json` 以及 DAELab 自有执行适配器。原型的控件、交互顺序、布局和 CSS 保持不变，仅带 #8.7 执行标记的工作流进入真实任务流程。逐节点对比确认已有节点类型、位置、尺寸一致；替换工作流 UUID 后 `linearData` 完全一致。原有 #8.6 工作流及 APP Mode Prototype JSON 保持原始字节；ComfyTV 未改动。

| 受保护文件 | SHA-256 |
| --- | --- |
| #8.6 - Badge Workflow.json | 718E7D29F99E37FF7E57493A07EC0092436384149B398CE0F92DC06B33214062 |
| #8.6-UI - Badge App Mode Prototype.json | B605E0590550E50564211692EB8F8A092BA32DE49DBD2871AF6A56490061D933 |

## 环境与方法

独立本地测试服务 `127.0.0.1:8001`，ComfyUI 0.21.1、前端 1.49.6、Python 3.12.11、PyTorch 2.8.0+cu129。主窗口 8000 未重启或替换工作流。通过用户授权的 Comfy OAuth 账户调用 GPT Image 2；凭据只在内存中使用，不进入交付文件。

所有模型调用均为 **Low、1024×1024、1:1、n=1**。区域材质流程包含基础生成和区域生成，每次仍为单张，最终输出单张。预览遮罩只运行确定性节点，不消耗模型生成。

## 自动化与真实任务

- Python 单元/回归测试：244 项通过。
- Node 前端模型/队列回归测试：242 项通过。
- Python 编译及 Git 空白检查通过。
- 真实任务矩阵：22 个案例，包含 18 个成功生成案例及 4 个预期拒绝案例。具体最终任务 ID 和图片路径见 `validation_results.json`；该文件是最终实测依据。
- 浏览器实际操作：3 条流程，分别为提示词生成、按颜色局部语义修改、画笔局部语义修改；均经原有 APP 控件提交、原生任务队列执行，并在原生输出区显示可下载图片。
- 对实际保存 PNG 验证尺寸、数量和质量报告；7 个矩阵局部案例与 2 个浏览器局部案例逐像素比较选区外最大误差，均为 0，且选区内均存在实际修改。

| 案例组 | 覆盖 |
| --- | --- |
| 效果图生成 | 背景剔除 × 高度建立 × 材质分区的全部 8 种开关组合 |
| 输入 | 纯提示词、平面图、非方形透明输入 |
| 颜色局部编辑 | 原图 / Color ID Map × 语义 / 材质 |
| 手绘局部编辑 | Polygon 语义、画笔材质；浏览器另测画笔语义 |
| 材质参数 | 闪粉保色、亚金固有色、强度及重抽参数 |
| 保留接口 | studio 棚拍调用；未增加可见页签 |
| 拒绝路径 | 缺少图片、空遮罩、未经预览直接应用、预览后改变输入 |

## 测试中发现并修复

1. 直接调用底层队列未携带原生登录刷新上下文：改为通过原生运行入口提交，临时编译钩子在结束时恢复。
2. 原生任务记录缺少节点标题元信息：补齐 `_meta.title`，验证图片显示与下载入口。
3. 直接调用 V3 选区节点缺少执行上下文：使用 `PREPARE_CLASS_CLONE`，重测 Polygon 和画笔。
4. 局部材质和分区材质缺少确定性保色约束：复用已有材质约束与合成节点，重测实际图片。
5. 材质选区直接套用源图会错位：增加 #8.7 专用渲染空间对齐。圆形轮廓不能可靠推断旋转，因此保留朝向；边界吸附种子内缩 32 像素，避免错误边缘成为固定种子。
6. 画笔画布可能仍显示旧参考图：保持现有 Load Image 操作，提交时检查画布图片是否与当前目标一致。

## 验收边界

任务通过不等同于任意输入都具有完美视觉结果。低质量模型生成仍可能改变几何、文字、光照和细节；高度图作为参考输入，不是精确三维约束。区域配准针对保持朝向的相近构图，轮廓 IoU 门槛不能证明所有内部边界正确；大幅形变、旋转、细窄区域须检查成片。亚金复测中原先的大幅错位已消除，但三角形边缘仍可见细窄原色线；本次没有将材质边缘的完全无残色列为通过结论。严格的遮罩外零误差仅针对确定性合成的相应选区外。

本次没有测试其他质量、尺寸或多张输出，没有增加原型中不存在的可见交互。新增节点需重启主 ComfyUI 后使用；本次真实验证在独立测试服务完成。


## 2026-09-09 GPT Color ID Map replacement

#8.7 now reuses #8.6's DAELAB.BadgeColorIdMapV1, DEFAULT_MAP_PROMPT and cache. The old RGB quantization is no longer used by #8.7. Both browser selection and backend matching read the same saved GPT map. Missing or mismatched target references fail before editing. Manual regeneration increments map_revision; normal re-entry reuses the map/cache.

- Python: 247 tests passed. Node: 253 tests passed.
- Real GPT map task: 2ca7d059-f2f3-4a6b-b660-3505c0834103 (Low, 1024x1024, n=1).
- Cache repeat: a2c6c08a-d3df-493a-8ec7-4e77cd5e4fbd succeeded.
- Map-based local preview: e314a3d3-1837-4330-b34f-b27e8c2b0ce1; apply: a17bed11-21e0-47a2-a6f3-5df06a5ec853. Outside max error 0; 276661 selected pixels changed.
- Non-square transparent input: 22f2e7a4-cae5-4a5e-a484-795f5ee3e0d0. Model canvas 1024x1024; map restored to source dimensions (1024, 512) after removing contain padding.
- Browser 8001: source gallery -> flat.png -> Generate Color Map -> ready map -> #0475F9 selection -> mask preview confirmed. Native authentication/queue reused. No main 8000 restart.
- #8.6 and #8.6-UI workflow hashes remain unchanged.

Evidence: validation_gpt_map_results.json, validation_gpt_map_cache_results.json, validation_gpt_map_local_results.json, validation_gpt_map_pixels.json, validation_gpt_map_wide_results.json.


## 2026-09-09 explicit Color ID Map generation timing

Removed GPT submission from tab/source activation. Automatic restoration calls the map runner with allowGenerate=false; only the visible generation button enables submission. The source tab is now 使用色彩分区图. Original target pixels remain visible while the map is absent or generating. The action becomes 重新生成色彩分区图 after success.

Browser 8001: entering Local, switching sources, and leaving/re-entering Local kept history at 6 tasks, with no running/pending tasks. Explicit button then submitted exactly one task, 8c65eab6-19de-4f91-8b0f-3e15489e1bc6, which succeeded; ready map and regenerate button were visible. Generation remains Low, 1024x1024, n=1. Frontend tests: 256 passed, including read-only no-map restoration, cached restoration, and explicit submission. #8.6 workflow hashes unchanged.


## 2026-09-09 direct local generation and media stage scope

Local generation no longer depends on clicking mask preview. Both the panel button and native Run route through automatic server validation followed by apply. Empty masks and changed requests still stop before model execution. The old prototype snapshot does not invalidate #8.7 completion state.

Future-stage image nodes are temporarily bypassed for native media validation, restoring original modes on stage activation and serialization. Shared group Bypass mode changes compose with this scope. Active-stage lookup is restricted to the Badge step tablist, avoiding hidden inspector tabs. #8.6 files remain unchanged.

261 Node tests passed; added tests exercise automatic validate/apply, empty-region rejection, input-change rejection, native media scope, mode serialization, and shared Bypass interaction. Browser 8001: no early local-source media warning on fresh build-page load. Direct local generation without preview succeeded with Low, 1024x1024, one image: validation a2eed717-f529-441a-bc2d-20c6aa40fbe4; apply e664c69f-56fd-43ca-b421-71b5aaf76069. Evidence: validation_direct_local.json.

Final native Run browser check (no manual preview): d23f04c0-27e9-46c3-819f-a6a8988c2e1a, 5c7e2e22-5570-47b0-b2cb-ca989a87eb25; both succeeded; UI showed 生成完成 with one output.

### APP Mode media-warning stability (2026-09-09)

- Keep the active #8.7 stage on the graph across panel teardown/rebuild; polling no longer infers `build` from temporarily absent tab DOM.
- Release the suspension record before publishing activation events, so synchronous controller listeners cannot immediately bypass the just-activated image node.
- Bump the controller model import version to load its media-scope integration.
- `node --test tests/*.test.mjs`: 263 passed, including 100 repeated refresh/controller cycles with zero mode events and a synchronous-listener regression.
- Main service port 8000: fresh browser page, local tab and graph/App Mode round trip kept the local tab selected; DOM sampling found no missing-media warning. This page had no selected target image; the user's existing warning-bearing browser session was not inspected directly. No paid generation was needed for this UI-state fix.
