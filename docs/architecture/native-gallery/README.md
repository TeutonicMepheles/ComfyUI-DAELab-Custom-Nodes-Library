# 原生陈列与样式基准修订

用户指出独立环境未遵循现有创作画布样式，要求在 ComfyUI 内直接用 JSON 陈列。现改以[真实节点工作流](../../../examples/creative_canvas/Creative%20Canvas%20Controls.json)为主要视觉和交互验收入口。

- 新建工作流：7 个已有节点、2 条连接；没有增加或修改运行节点实现。
- 已安装为 `workflows/DAELab/Creative Canvas Controls.json`；userdata 读取核对通过，未覆盖已有文件。
- 浏览器验证见 verification.json；原生控件截图 native-controls.png，媒体截图 native-media.png。
- JSON audit：7 nodes / 2 links / 0 overlaps / 0 padding violations。无 Bypass 控制组。此文件是新建工作流，不是对原用户工作流做等价改排，因此不存在原图语义比较结论。
- JSON 内无凭据或实际 LibTV 项目 ID。没有提交生成任务。
- 用户浏览器已打开此新工作流，原有工作流标签保留。

第三阶段独立组件的行为测试证据继续保留，但其样式**不作为产品已经接受的视觉基线**。第二阶段提出的统一颜色/尺寸等属于待校准设计，不应直接覆盖现有画布。下一步先从原生陈列中确定并提取要保留的样式与行为，再决定共享组件如何接入；展厅/徽章 App Mode 仍不在调整范围。

隔离截图测试仅将资产库列表设为空，以免包含无关素材；用户页面的资产库无改动。自制图片、视频用真实 ComfyUI 上传和 /view 读取，不模拟媒体响应。
