# Sudo 跨仓架构决策记录

> 日期：2026-09-12
> 当前状态：完整六份 Proposed ADR，等待联合架构评审接受

## ADR 清单

| 全局 ADR | 来源任务/Epic | 标题 | 状态 |
|---|---|---|---|
| [ADR-001](./ADR-001-identifiers-and-lifecycle.md) | E0-01 | Agent、Session、Task、Attempt 与 Runtime PID 标识及生命周期 | Proposed |
| [ADR-002](./ADR-002-zone-and-tenancy-model.md) | E0-02 | Zone 与多租户安全模型 | Proposed |
| [ADR-003](./ADR-003-agent-principal-and-versioning.md) | E0-03 | Agent Principal、Version、Channel 与运行时证明 | Proposed |
| [ADR-004](./ADR-004-task-and-execution-resolution.md) | Epic 3 语义前置 | Task、Execution Resolution 与 Attempt 生命周期 | Proposed |
| [ADR-005](./ADR-005-product-contract-versioning.md) | E0-04 | 跨仓产品契约的版本、分发与兼容规则 | Proposed |
| [ADR-006](./ADR-006-transcript-and-ui-overlay.md) | Epic 6 语义前置 | Canonical Transcript、UI Overlay 与 Conversation 重建 | Proposed |

## 编号说明

`E0-01` 至 `E0-04` 是第一层开发任务编号，不等于全局 ADR 编号。

总设计的 ADR 顺序为：

1. Identifiers and Lifecycle；
2. Zone and Tenancy；
3. Agent Principal and Versioning；
4. Task and Execution Resolution；
5. Product Contract Versioning；
6. Transcript and UI Overlay。

因此 E0-04 对应全局 ADR-005。ADR-004/006 虽分别在后续 Epic 实现，但其语义会反向影响 ID、Session、Task、SSOT 和迁移边界，所以一并纳入本轮联合评审。

## 推荐评审顺序

```text
ADR-001 ID/生命周期
  -> ADR-002 Zone/安全边界
  -> ADR-003 Agent身份/版本
  -> ADR-004 Task/Resolution
  -> ADR-006 Transcript/Overlay
  -> ADR-005 契约版本/分发（最后确认如何工程化前五项）
```

ADR-005 可以先浏览，但建议最后表决，因为它负责把前五份语义变成 schema/package/compatibility 规则。

## 联合评审需要重点拍板的事项

### R1. 产品 Runtime 标识与 kernel PID

ADR-001 当前建议：

```text
pid = 全局 opaque Runtime instance ID
os_pid/pod_uid/container_id = RuntimeLocator
```

当前 `nexus-vfs` 同时存在“PID=OS PID”和 synthetic `pid-*` 两种实现。评审时需要在以下两种方案中明确选择：

1. 保持 ADR 当前方案，统一 opaque `pid`；
2. 增加 `runtime_id` 作为跨仓 ID，保留 `nexus-vfs` node-local PID/`/proc` 语义。

第二种对现有 kernel 改动更小，但多一个 ID。未拍板前不得开始大规模 PID 重构。

### R2. Grant revoke 对运行中 PID

ADR-002 当前建议：grant revoke 默认取消依赖该 grant 的 active PID，因为仅阻止后续 read 无法撤回 Agent 内存中已有数据。

需要确认：

- 所有 production Zone 是否默认 terminate；
- 是否允许低风险 policy 只 deny subsequent operations；
- `revocation_pending` 的最大处理时间。

### R3. Session/Task/Conversation 边界

当前建议：

```text
Conversation 1 -> 1 Session（新写入）
Agent Principal 1 -> N Session（v1 中 Session 固定 Principal）
Session 1 -> N Task
Task 1 -> N Attempt
Attempt 1 -> N Runtime instance/PID
```

需要用 interactive chat、AskUserQuestion、Cron、Team、IM 五种场景逐一验证 Task 边界，并确认 v1 是否规定一个 Session 同时最多一个 active Attempt。当前 Session metadata 使用单数 `current_attempt_id/current_pid`；建议 v1 采用 single-active，平行工作使用 child Session。

### R4. Agent resume 版本策略

ADR-003 当前建议：

- 恢复既有 Attempt 时继续该 Attempt 的 exact version；
- 同一 Session 的新 Task 按 version/channel request 重新 Resolution；
- explicit upgrade 创建新 Attempt；
- revoked version 禁止新 PID；
- deprecated version 可继续但提示。

需要确认产品 UX 和安全期望。

### R5. Org/Zone 多对多

ADR-002 当前建议 Org 与 Zone 多对多、Zone ID 不随 Org 改名。需要确认：

- 新 Org 默认创建哪些 Zone；
- Office/Core 默认是否分 Zone；
- 企业合并/拆分流程；
- Cloud/Private federation policy。

### R6. Task rejected 与 fallback

ADR-004 当前建议：

- rejected Task 仍持久化；interactive rejection 还要写用户原文和 rejection transcript fact；
- rejected 不创建 Attempt/PID/assistant execution output；
- fallback 必须重新 policy evaluation；
- infrastructure failure 是 Attempt failure，不是 policy rejection。

需要确认 reason code、审批流程和计费/统计口径。

### R7. Canonical Transcript 内容边界

ADR-006 当前建议：

- 保存用户原文，不把注入 prompt 冒充用户输入；
- finalized/partial semantic message 持久化；
- token delta 只用于 live event/trace；
- Tool raw fact canonical，UI rendering 是 Overlay/derived cache；
- compaction 不删除原始 transcript；
- local history 不自动上传 Cloud。

需要确认 retention、合规删除、Artifact delivery 和 non-scode backend 支持范围。

### R8. `sudo-contracts` 发布方式

ADR-005 当前建议：

- JSON Schema 2020-12 为 wire schema SSOT；
- Accepted ADR 为语义/生命周期权威；
- TypeScript/Rust 首批；
- Python/Go/C# 按 consumer 增加；
- v0.x 迭代，语义接受后进入 v1.x；
- exact pin + compatibility matrix + offline bundle。

需要确认 package registry、CODEOWNERS、安全 reviewer 和 release owner。

### R9. 跨 trust domain 的 Agent Registry 路径

ADR-003 以 `(trust_domain, agent_name)` 作为完整 Principal，但当前可读路径示例仍是 `/agents/{agent-name}`。需要确认物理路径使用：

1. `/agents/{trust-domain}/{agent-name}`，并为本地旧路径提供 alias；或
2. `/agents/{agent-principal-id}`，另建名称索引。

建议优先方案 1，除非路径长度、编码或 rename/migration 证明需要 opaque principal ID。未拍板前，Registry 实现不能只以裸 `agent_name` 作为跨 trust domain 存储 key。

## 接受流程

在将单份状态从 `Proposed` 改为 `Accepted` 前，应至少记录：

- 评审日期；
- 决策参与者/owner；
- 是否有 amendment；
- 被拒绝方案是否认可；
- 迁移兼容策略是否可执行；
- 生效 contract/API version；
- 受影响仓库 owner 是否完成确认；
- 安全负责人是否确认 fail-closed/revocation/Secret 边界。

建议允许单份 ADR 分别 Accepted，不要求六份在同一分钟通过；但 ADR-001/002/003 是 ADR-004/006 的基础，存在冲突时必须先修基础 ADR，再接受依赖文档。

Accepted 后，任何改变核心语义的需求应通过新 ADR 或 amendment，而不是由单仓 PR 隐式修改。
