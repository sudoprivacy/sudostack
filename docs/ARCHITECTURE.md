# 产品架构说明书（订正版）

**跨全家族技术架构 SSOT。** 在武鹏 v1.4 基础上订正命名口径、合并 Atlas、并把 AgentSpec 与 agent-context-storage-matrix consolidate 成同一套模型。

内容（产品分层 / 三个 ID / 六契约 / AgentSpec ≡ matrix）以下述 SSOT 为准，本文件只负责**指向**与**构建/更新**，不复述——产品分层概览见 [`../README.md`](../README.md)，Agent 存储金标准见 `sudocode/docs/design/agent-context-storage-matrix.html`。

- **在线（ShareOne，可评论）**：https://s.shareone.vip/s/sudo-product-architecture
- **源（source of record）**：`docs/architecture.html`（本 repo 私有，故内容托管在 ShareOne，非 remote-url）
- **构建**：`docs/_build/build_arch.py`（读 `arch_deploy.svg` / `arch_consolidate.svg` → `architecture.html`）
- **更新**：改源后重建，`publish.js <architecture.html> --share-id TXVzG3RUMCYk2gJO --filename sudo-product-architecture.html` 原地回推同一 URL。
