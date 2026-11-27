# Canvas 与 Studio 共存交付

更新使用 CNL-updated.zip 和 Canvas-Studio-updated.zip。配套包包含两个已验收的节点目录。三包同时启用时，宿主可采用 coexistence.example.json 中的仲裁配置，将其合并至 user/daelab/coexistence.json。Studio 提供画布、四个画布节点及 material-output。已有宿主配置由操作方保留并合并。

整体回滚使用 CNL-rollback.zip 与 Canvas-Studio-rollback.zip。旧版 Canvas 和 Studio 同时启用存在路由冲突，回滚环境采用单一画布提供方。旧版 CNL、Canvas 和 Studio 快照可分别校验。

manifest.json 包含配套代码版本、SHA-256 与实际验证组合。画布配套快照用于本次共存交付，Studio M6 产品验收单独维护。
