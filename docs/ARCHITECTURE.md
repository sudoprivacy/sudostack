# 产品架构说明书（订正版）

**跨全家族技术架构 SSOT。** 在武鹏 v1.4 基础上订正命名口径、合并 Atlas、并把 AgentSpec 与 agent-context-storage-matrix consolidate 成同一套模型。

- **在线（ShareOne，可评论）**：https://s.shareone.vip/s/sudo-product-architecture
- **源（source of record）**：`docs/architecture.html`（本 repo 私有，故内容托管在 ShareOne，非 remote-url）
- **构建**：`docs/_build/build_arch.py`（读 `arch_layers.svg` / `arch_consolidate.svg` → `architecture.html`）
- **更新**：改源后重建，`publish.js <architecture.html> --share-id TXVzG3RUMCYk2gJO --filename sudo-product-architecture.html` 原地回推同一 URL。

## 核心

- **两层产品模型**：Mega（Atlas/SaaS/SudoEdge）由 Base（sudocode/nexus/nova-gateway/moss/hydra/shareone/ai-dev-browser/password-agent）装配复用。
- **AgentSpec ≡ matrix image 层 `/agents/{name}/`**：逻辑 schema ⇔ 物理存储一一对应；实现者必须读懂 matrix。
- **三个 ID**：agent-name（image/制品）· session-id（持久 `--resume` key）· pid（一次运行句柄）。
- **六契约**（TaskSpec/Tool/Context/Memory/Verify/Event-Trace）各有 matrix 物理落点，是 ACP/MCP/WS/IPC 之上的产品语义层。
