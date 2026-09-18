# Sudo 跨仓语义与六契约设计

> 文档版本：v1.0-draft
> 日期：2026-09-12
> 状态：**架构评审稿，可作为开发计划拆分母版；尚未代表所有 ADR 已接受**
> 规范优先级：Accepted ADR 定义语义、生命周期与所有权；canonical editable definition 位于 semantic owner repo；`sudostack` exact-pin 并派生 wire schema/artifact；本文提供评审上下文，不覆盖已接受 ADR。
> 范围：`sudowork`、`moss`、`sudocode`、`nexus`、`nexus-vfs`、`sudowork-server`、SudoRouter/current `new-api`、未来 `sudoevolve`
> 上游依据：
> - `sudo-product-architecture` v2.2：产品与技术架构 SSOT
> - `sudo-cloud-plan`：当前 Cloud Gap Tracker 与实际部署状态
> - `Sudo_产品模块说明_v4.7`：产品功能清单补充，旧命名不覆盖 v2.2
> - [`sudo-cross-repo-semantics-freeze-guide-2026-09-12.md`](./cross-repo-semantics-freeze-guide-2026-09-12.md)

---

## 0. 文档使用方式

本文不是排期，也不是逐文件实施计划。它先完成三件事：

1. 冻结跨仓共享对象的语义、生命周期与唯一权威源；
2. 定义六类产品契约的职责、最小对象、使用方式和跨仓引用边界；
3. 给出可继续拆分为开发计划的 Epic 边界、依赖关系和验收标准。

本文使用以下标记：

- **冻结**：建议作为 v1 必须统一的语义，后续 ADR 应直接固化；
- **迁移**：目标已明确，但需要兼容期、双写或回填；
- **开放**：仍需架构评审决定，不能直接作为开发任务的隐含前提；
- **禁止**：为防止仓库再次分叉而明确排除的做法。

规范词：

- **MUST**：违反即不符合契约；
- **SHOULD**：默认必须遵守，只有记录原因后才可偏离；
- **MAY**：可选能力。

---

# 1. 结论摘要

## 1.1 本次建议冻结的核心结论

1. **六契约是六个语义契约族，不是六个新服务。**
2. ACP、MCP、HTTP、WebSocket、gRPC、IPC 继续作为传输或交互协议；六契约定义传输内容的产品含义。
3. `agent-name`、`session-id`、`pid` MUST 分离：
   - `agent-name`：长期 Agent principal；
   - `session-id`：持久、可恢复的连续工作；
   - `pid`：一次临时运行。
4. 在三 ID 之外，增加 `task-id` 和 `attempt-id`：
   - `task-id`：用户或系统希望完成的一项工作；
   - `attempt-id`：该任务的一次策略级执行尝试；
   - 同一 attempt 因 Pod/进程重建 MAY 产生多个 pid。
5. Agent principal 与 Agent version MUST 分离；运行时 MUST 锁定不可变 version、spec digest 和 image digest。
6. Zone 是持久安全/数据边界；Org 是可变业务组织。两者通过 grant 关联，不把组织名直接当 Zone ID。
7. TaskSpec、Context、Memory、Verify、Event 等产品对象的持久数据在 Cloud/Private 模式下最终落到 Nexus；权威 writer 按契约分工，不等于每个对象都由 Nexus 业务逻辑创建。
8. Moss 负责 IAM、组织、审批、路由政策与 Task resolution；Nexus 负责 Zone、权限执行、持久 Session/Task 引用、Runtime 和数据；sudocode 负责 Context 组装与真实执行。
9. SudoWork 的本地 messages 不能直接删除。目标是：

   ```text
   Canonical Transcript + UI Overlay + Local Index
                     ↓
             完整重建 Conversation UI
   ```

10. `nexus-vfs` MUST 保持底层，只依赖公共 identity/runtime primitives；不得把产品 Rubric、充值、Cloud 模式等业务对象压进 kernel。
11. 跨仓定义的 canonical editable source 建议留在 semantic owner repo；`sudostack` exact-pin owner revision，派生并统一分发 `@sudo/contracts` 等 consumer artifacts。现有 [`sudowork/packages/contracts`](https://github.com/sudoprivacy/sudowork/tree/9f7a5fca1e6cc114d02b26af76f791d449f40779/packages/contracts) 作为迁移期 TypeScript consumer/adapter，不直接升格为全局 SSOT。
12. 第一条参考实现应选择单 Agent、单 Zone，但 MUST 同时贯通 Task、Session、PID、Context、Tool、Event、Verify 和 UI Overlay，而不是只做 schema。

## 1.2 与上一版分析结论的对比

### 保持不变的结论

- 六契约不替代 ACP/MCP；
- owner machine-readable definition（product wire object 优先 JSON Schema）应成为语言无关语义源；
- Moss 是改造量最大的控制面仓库；
- `nexus-vfs` 只引用六契约中的最小公共子集；
- TaskSpec 与 Event/Trace 应优先落地；
- Tool Protocol 应是治理与审计层，而不是重新发明 MCP；
- Context 是一次执行快照，Memory 是跨执行持久资料；
- Verify 应与执行主体分离；
- `sudowork-server` 应进入 legacy/migration adapter 定位，而不是继续形成第二套目标契约。

### 本文补充或修正的结论

1. 把 Zone、Agent Principal/Version 和三 ID 明确作为六契约之前的基础语义；
2. 在 Task 与 PID 之间增加 `attempt-id`，区分业务重试和基础设施重建；
3. 明确 TaskSpec 即使被拒绝也需要持久化，但拒绝结果不创建 pid；
4. 明确 TaskSpec 建议持久于 Session 下，Moss 是权威 writer，Nexus 是持久 SSOT；
5. 明确 UI messages 当前比 scode transcript 更丰富，因此迁移必须先设计 Overlay 和 shadow rebuild；
6. 明确 Event、Trace、Audit 共用 envelope，但存储、采样和 retention 不同；
7. 明确跨 Zone ResourceRef 使用 `zone_id + path`，不强迫所有普通调用写全局 `/{zone}/...` 路径；
8. 明确第一阶段以 owner exact Git revision + `sudostack` 派生 artifact 分发，不在 v1 建在线“契约注册中心服务”。

---

# 2. 当前源码基线与关键差距

本节用于约束后续开发计划。它描述的是 2026-09-12 工作区代码事实，不是目标设计。

## 2.1 已有基础

### SudoWork

- 已是 Electron + WebUI + shared packages monorepo；
- 已有 TypeScript/Zod auth 与 conversation DTO；
- 已有本地 SQLite messages、conversation overlay、远端 Moss binding；
- 已有 ACP、本地 subprocess 与 Nexus gRPC raw tunnel transport；
- 已有 Team/Cron/Remote 等多种任务入口；
- WebUI 和 Desktop 共享 renderer。

### Moss

- 已有用户、组织、部门、API key、Session、Attempt、Cron、Trigger、Channel 等实际控制面能力；
- 已有 Docker/Kubernetes/gVisor runtime；
- 已接 Nexus Vault 和 external nexus 模式；
- 已有多种登录、自助注册、SudoRouter 每用户 key/credit 等后续实现；
- 已有 HA 与会话接管代码。

### sudocode

- Rust-native Agent runtime；
- 支持 ACP、模型调用、工具、MCP、Session JSONL、oversized tool-result offload；
- `SessionStore` 已通过 `FsBackend::managed_sessions_root()` 抽象本地与 `/sessions` 根；
- 已有 `/agents/{name}/sessions/{sid}` link seam；
- 已有 `KernelFsBackend` 与 managed-agent co-host adapter。

### nexus-vfs / Nexus

- 已有 VFS、Zone context、ReBAC、Auth、Vault、AgentRegistry、A2A mailbox、DT_LINK/DT_STREAM；
- 已有 Rust `ManagedAgentService`、raw ACP subprocess tunnel 和 co-host DI seam；
- 已有 HTTP/gRPC/Rust service dispatch；
- 已有 memory/search、audit 和多后端能力基础。

## 2.2 当前必须优先处理的结构性冲突

### 冲突 A：`session_id` 当前仍等于 `pid`

[`nexus-vfs/rust/managed_agent/src/lib.rs`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/managed_agent/src/lib.rs) 当前明确：

- `StartSessionResponse.session_id` 返回 AgentRegistry pid；
- `start_session()` 只分配 `pid-*`；
- `cancel/get_session` 都把 session_id 当 pid；
- pid reaped 后 `get_session` 返回 UnknownSession。

关键位置：

- [`lib.rs:163`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/managed_agent/src/lib.rs#L163)
- [`lib.rs:386`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/managed_agent/src/lib.rs#L386)
- [`lib.rs:391`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/managed_agent/src/lib.rs#L391)
- [`lib.rs:637`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/managed_agent/src/lib.rs#L637)

这与持久 Session 语义直接冲突，必须在正式 Task/Runtime contract 前修正。

### 冲突 B：已认证 `OperationContext` 未进入 Rust service dispatch

[`nexus-vfs/rust/transport/src/call_dispatch.rs:23`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/transport/src/call_dispatch.rs#L23) 接收 `OperationContext`，但参数名为 `_ctx`，随后只把 `method + payload` 交给 `RustService::dispatch`。

[`nexus-vfs/rust/contracts/src/rust_service.rs:80`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/contracts/src/rust_service.rs#L80) 的 dispatch 接口没有 context 参数。

与此同时 `ManagedAgentService.StartSessionRequest` 允许调用方直接传 `owner_id` 与 `zone_id`。如果没有额外覆盖，这会使服务信任 payload 声称的身份/Zone，而不是已认证主体。

### 冲突 C：Moss 仍是大规模 state owner

Moss 当前本地数据库仍保存：

- organizations/users/departments/api_keys；
- sessions/session_attempts/session_events；
- tenant assistants/skills；
- config/secret metadata；
- cron jobs/event triggers；
- channel sessions。

可见：

- [`moss/src/server/authCenter/db.ts:260`](https://github.com/sudoprivacy/moss/blob/3812c841c9cf58f09fb7998681d6ceb1afda6be6/src/server/authCenter/db.ts#L260)
- [`moss/src/server/db.ts:148`](https://github.com/sudoprivacy/moss/blob/3812c841c9cf58f09fb7998681d6ceb1afda6be6/src/server/db.ts#L148)
- [`moss/src/server/db.ts:177`](https://github.com/sudoprivacy/moss/blob/3812c841c9cf58f09fb7998681d6ceb1afda6be6/src/server/db.ts#L177)

当前 Nexus client 主要用于 secrets/config，并未成为 Session/Agent/Task SSOT，见 [`moss/src/server/startStandaloneServer.ts:37`](https://github.com/sudoprivacy/moss/blob/3812c841c9cf58f09fb7998681d6ceb1afda6be6/src/server/startStandaloneServer.ts#L37) 与 [`moss/src/server/nexus/nexusClient.ts`](https://github.com/sudoprivacy/moss/blob/3812c841c9cf58f09fb7998681d6ceb1afda6be6/src/server/nexus/nexusClient.ts)。

### 冲突 D：生产/HA 示例仍存在 insecure Nexus path

[`moss/deploy/docker-compose.ha.yml:53`](https://github.com/sudoprivacy/moss/blob/3812c841c9cf58f09fb7998681d6ceb1afda6be6/deploy/docker-compose.ha.yml#L53) 明确使用 `--no-tls + --insecure-no-auth` 让两个 Moss 实例访问 Nexus。

这不是最终 Cloud/Private 安全姿态，只能作为受控开发拓扑。正式装配 MUST 使用 mTLS、User/Agent subject、zone permissions 和 fail-closed permission provider。

### 冲突 E：产品 AgentSpec 与 Nexus `AgentSpec` 同名异义

[`nexus/src/nexus/contracts/agent_types.py:203`](https://github.com/nexi-lab/nexus/blob/dd707c0cc453514b88b53afc2b6e0edb64ab2345/src/nexus/contracts/agent_types.py#L203) 的 `AgentSpec` 更接近调度/运行资源要求；产品架构的 AgentSpec 是包含 identity、runtime、permissions、contract、governance、scheduling 的完整产品对象。

后续 MUST 将现有类型更名或嵌入为 `AgentSchedulingSpec`，避免同名异义。

### 冲突 F：SudoWork Transcript 与 UI 数据尚未分层

- 本地 messages 在 [`sudowork/apps/desktop/src/process/database/schema.ts:65`](https://github.com/sudoprivacy/sudowork/blob/9f7a5fca1e6cc114d02b26af76f791d449f40779/apps/desktop/src/process/database/schema.ts#L65)；
- remote session binding 分散为 `mossSessionId`、`acpSessionId` 等；
- 本地表仍包含用户原文、工具展示、deliverable/tips/status 等比 scode transcript 更丰富的内容。

因此不得直接将 messages 表替换为 scode transcript。

### 冲突 G：现行 SudoRouter 源码不在当前工作区

当前 `nova-gateway` 已被标记为废弃，真实 SudoRouter 迁往 external `new-api`。后续 Router 计划必须在将 `new-api` 加入工作区或读取其准确 revision 后拆分；不得以废弃 repo 代表当前生产实现。

---

# 3. 设计原则与非目标

## 3.1 原则

### P1. 语义与传输分离

同一个 TaskSpec MAY 通过 HTTP、WebSocket、ACP metadata 或 gRPC 传递，但语义和 schema 不变。

### P2. 单一权威 writer

每类持久对象只能有一个权威 writer。其他仓库可以维护 projection、cache、index 或 overlay，但必须声明非 SSOT。

### P3. 不把业务语义压进 kernel

Nexus VFS kernel 只理解身份、权限、Zone、路径、进程、通用 typed document 和 event stream。

### P4. 持久对象与运行对象分离

Task、Session、Agent Principal、Agent Version、Memory 和 Verify Result 持久；PID、Pod、连接、锁是运行态。

### P5. 引用优于复制

大内容、Secret、Artifact、Memory、Tool result 使用 `ResourceRef`；事件与任务对象不复制大字节或 Secret 明文。

### P6. 默认 fail-closed

Auth/permission provider 缺失、Zone 不明、delegation 无效、policy 版本不可用时拒绝，不以 `system/root` 默认继续生产请求。

### P7. 兼容优先于大爆炸切换

契约采用 adapter、双写、shadow read/rebuild、backfill、cutover 和 rollback；不能因“目标更正确”而直接删除现有数据源。

## 3.2 非目标

v1 不做：

- 不把 ACP 与 mailbox 合并成一个协议；
- 不重新设计 MCP wire protocol；
- 不要求所有内部函数都使用跨仓 DTO；
- 不建立在线 Contract Registry 服务；
- 不一次性迁移全部历史数据；
- 不在 v1 建完整自动后训练管线；
- 不因契约统一而要求所有仓库使用同一种语言；
- 不让 SudoWork 直接承担组织政策或执行状态 SSOT。

---

# 4. 基础语义冻结

六契约依赖以下基础对象。它们必须先于六契约 v1 接受。

## 4.1 Zone

### 冻结定义

> Zone 是不可隐式跨越、不可因业务组织改名而迁移的持久安全和数据边界。

### 决策

1. `zone_id` 是稳定不可变 ID；显示名称单独存储；
2. Org 与 Zone 通过 `ZoneGrant` 关联，v1 支持多对多；
3. 用户通过 Org membership 或显式 grant 获得 Zone 权限；
4. Agent/PID 运行时必须绑定一个 execution Zone；
5. 跨 Zone 默认拒绝，必须有显式、可审计、可撤销授权；
6. Cloud fallback 不得自动让 Private/Core 数据出域；
7. permission provider 缺失时生产 profile 必须拒绝启动或拒绝访问。

### 路径与 Zone 的统一口径

现有文档同时出现：

```text
/{zone}/sessions/{sid}
```

和 Zone-scoped VFS 中的：

```text
/sessions/{sid}
```

本文冻结为：

```ts
interface ResourceRef {
  zone_id: string
  path: string       // zone 内绝对路径，例如 /sessions/sess_123
  version?: string
  digest?: string
}
```

规则：

- 普通调用使用 `zone_id + zone-relative absolute path`；
- normal subject 不通过字符串拼接访问其他 Zone；
- 管理平面 MAY 提供 `/zones/{zone_id}/...` 全局投影视图，但不是普通 Runtime 的路径语义；
- DT_LINK follow 必须重新授权目标 `zone_id + path`，link 不继承源权限。

## 4.2 Agent Principal、Version、Channel

### Agent Principal

长期身份键：

```text
(trust_domain, agent_name)
```

规范 URI：

```text
nexus://{trust_domain}/agent/{agent_name}
```

用途：

- ReBAC principal；
- 长期 memory owner；
- Session 索引；
- CA 证书 identity；
- 审批和治理。

### Agent Version

已发布 version 不可原地修改：

```json
{
  "agent_name": "finance-auditor",
  "version": "1.4.2",
  "spec_digest": "sha256:...",
  "image_digest": "sha256:...",
  "signed_by": "release-ca",
  "status": "approved"
}
```

### Agent Channel

```text
finance-auditor@stable -> 1.4.2
finance-auditor@canary -> 1.5.0-rc.1
```

Channel 是可变 alias；Runtime 启动前必须解析到具体 version/digest，并将解析结果固化到 Attempt/PID metadata。

### 撤销状态分离

MUST 区分：

- principal revoked；
- version revoked；
- certificate revoked；
- approval withdrawn。

不得用一个 `disabled` 表达四种语义。

## 4.3 五个核心 ID

| ID | 是否持久 | 创建者 | SSOT | 语义 |
|---|---:|---|---|---|
| `agent-name` | 是 | Agent Registry | Nexus Agent image | 谁在运行 |
| `session-id` | 是 | Session Service | Nexus SessionStore | 可恢复的连续工作 |
| `task-id` | 是 | Task ingress/Moss | Nexus Session TaskStore | 要完成的一项工作 |
| `attempt-id` | 是 | Task Orchestrator/Moss | Nexus Task execution record | 一次策略级执行尝试 |
| `pid` | 否 | Managed Agent Runtime | Nexus `/proc` | 一次临时运行实例 |

### 关系

```text
Agent Principal 1 ── N Agent Version
Agent Principal 1 ── N Session（v1 中 Session 固定一个 Agent Principal）
Session         1 ── N Task
Task            1 ── N Attempt
Attempt         1 ── N PID
```

`Attempt 1 ── N PID` 是对原说明“Task 1 ── N Attempt/PID”的细化：

- 用户在不修改 TaskSpec 的前提下 retry、policy 重新裁决或显式 Agent version upgrade：新 attempt；
- 用户回答问题或补齐非实质参数：作为同一 Task/Attempt 的追加输入事件；
- 工作目标、核心输入、数据范围或 expected output 实质变化：创建 superseding Task；
- Pod 重建、节点接管、同一 attempt 恢复执行：同 attempt 下新 pid；
- 每个 pid 只能属于一个 attempt；
- pid 退出不删除 Session、Task 或 Attempt。

### ID 格式

建议前缀：

```text
sess_
task_
attempt_
pid_
evt_
call_
ctx_
mem_
verify_
artifact_
```

v1 只冻结“带类型前缀、全局不透明、不可变”，不冻结 UUID/ULID/UUIDv7 算法，避免将实现算法变成 wire breaking change。

## 4.4 Conversation ID

`conversation-id` 是 SudoWork UI 对象，不是系统 Session SSOT。

```text
conversation-id -> session-id
```

绑定保存在 SudoWork local index/overlay。一个 Conversation v1 SHOULD 绑定一个连续 Session；迁移期允许 legacy conversation 对应多个历史 scode session，但新写入不得继续扩散该模式。

## 4.5 Principal 与 Delegation

```ts
interface PrincipalRef {
  subject_type: 'user' | 'agent' | 'service'
  subject_id: string
  trust_domain?: string
}

interface DelegationRef {
  delegation_id: string
  issuer: PrincipalRef
  subject: PrincipalRef
  zone_id: string
  scopes: string[]
  task_id?: string
  attempt_id?: string
  expires_at: string
}
```

权限决策必须是：

```text
human delegation scopes
∩ Agent principal/version approval
∩ resource/zone policy
∩ task data policy
∩ runtime restrictions
```

知识路径不是权限。知道 `/sessions/sess_x`、`/agents/name` 或 `/repos/x` 不代表能访问。

---

# 5. 六契约总体模型

## 5.1 契约不是单个文件

每个契约族包含：

- command/request；
- immutable spec；
- mutable status/result；
- stable error codes；
- event payload；
- schema examples；
- compatibility fixtures。

## 5.2 共同 wire 约定

1. wire JSON 使用 `snake_case`；各语言 SDK 可暴露 idiomatic naming；
2. 时间使用 RFC 3339 UTC；
3. 大 payload 使用 `ResourceRef`；
4. Secret 明文 MUST NOT 出现在契约对象或 Event；
5. 对象根包含：

   ```json
   {
     "api_version": "task.sudo.dev/v1",
     "kind": "TaskSpec"
   }
   ```

6. major version 位于 `api_version`；package 使用 SemVer；
7. 事件必须包含准确 producer version，正式环境禁止 `unknown`；
8. consumer MUST 忽略同 major 下未知 optional 字段；
9. consumer 不得忽略未知 major；
10. enum 新增值视为兼容风险，SDK 必须提供 Unknown/fallback 处理。

---

# 6. Contract 1：Task Contract

## 6.1 目的

Task Contract 表达：

> 谁要求哪个 Agent 完成什么工作，允许访问哪些资源，需要什么能力，输出应满足什么要求，以及政策决定是否/在哪里执行。

## 6.2 v1 对象

- `TaskSpec`
- `TaskExecutionResolution`
- `TaskAttempt`
- `TaskCancelRequest`
- `TaskRetryRequest`
- `TaskStatus`

## 6.3 TaskSpec 最小字段

```ts
interface TaskSpec {
  api_version: 'task.sudo.dev/v1'
  kind: 'TaskSpec'

  task_id: string
  session_id: string
  created_at: string

  requested_by: PrincipalRef
  agent: {
    trust_domain: string
    name: string
    requested_version?: string
    requested_channel?: string
  }

  input: {
    instruction: string
    parameters?: Record<string, unknown>
    resource_refs: ResourceRef[]
  }

  workspace_refs: ResourceRef[]

  requested_mode: 'auto' | 'local' | 'cloud' | 'private'
  data_classification: string
  required_capabilities: string[]

  constraints?: {
    deadline?: string
    timeout_ms?: number
    max_cost_units?: number
    idempotency_key?: string
  }

  output_contract?: {
    schema_ref?: ResourceRef
    artifact_types?: string[]
    rubric_ref?: ResourceRef
  }
}
```

## 6.4 Resolution

```ts
type TaskExecutionResolution =
  | {
      api_version: 'task.sudo.dev/v1'
      kind: 'TaskExecutionResolution'
      status: 'accepted'
      task_id: string
      attempt_id: string
      resolved_runtime: 'sudolocal' | 'sudocloud' | 'sudoprivate'
      resolution_mode: 'default' | 'policy_routed' | 'fallback'
      agent_version: string
      spec_digest: string
      image_digest: string
      zone_id: string
      reason_code: string
      reason: string
      policy_version: string
      policy_snapshot_ref?: ResourceRef
    }
  | {
      api_version: 'task.sudo.dev/v1'
      kind: 'TaskExecutionResolution'
      status: 'rejected'
      task_id: string
      reason_code:
        | 'LOCAL_RESOURCE_REQUIRED'
        | 'DATA_DOMAIN_FORBIDDEN'
        | 'APPROVAL_REQUIRED'
        | 'CAPABILITY_UNAVAILABLE'
        | 'AGENT_VERSION_REVOKED'
        | 'ZONE_ACCESS_DENIED'
        | string
      reason: string
      policy_version: string
    }
```

## 6.5 生命周期

```text
TaskSpec created
  ├─ resolution rejected
  │      └─ Task remains queryable; no Attempt/PID
  └─ resolution accepted
         └─ Attempt queued
              └─ pid1 starting/running
                   ├─ completed
                   ├─ failed -> retry creates Attempt 2
                   └─ infrastructure recovery -> pid2 in same Attempt
```

## 6.6 SSOT 与职责

| 对象 | 权威 writer | 持久 SSOT | consumer |
|---|---|---|---|
| TaskSpec | Moss Task ingress；Local 模式为 SudoWork host | Nexus SessionStore；Local 为 sudocode local store | Moss、sudocode、SudoWork、SudoEvolve |
| Resolution | Moss Policy Resolver | Nexus task record + Moss audit projection | Nexus runtime、sudocode、UI |
| Attempt | Moss Orchestrator | Nexus task execution record | Nexus runtime、UI、Verify |
| PID state | Nexus Managed Runtime | Nexus `/proc` | Moss、SudoWork、sudocode host |

## 6.7 存储布局

Zone-scoped path：

```text
/sessions/{sid}/tasks/{task-id}/
  spec.json
  resolutions/{resolution-id}.json
  attempts/{attempt-id}/
    attempt.json
    context/
    artifacts/
    verify/
```

Runtime links：

```text
/proc/{pid}/session   -> /sessions/{sid}
/proc/{pid}/task      -> /sessions/{sid}/tasks/{task-id}
/proc/{pid}/attempt   -> /sessions/{sid}/tasks/{task-id}/attempts/{attempt-id}
/proc/{pid}/agent     -> /agents/{agent-name}/versions/{version}
```

## 6.8 传输映射

- SudoWork WebUI -> Moss：HTTP/WS payload；
- Desktop Local -> local host：IPC/ACP metadata；
- Moss -> Nexus：`/v2/runtime` HTTP 或 typed gRPC；
- Nexus -> co-host sudocode：Rust DTO；
- Nexus raw subprocess -> sudocode：启动 manifest ref + ACP；
- 跨 transport 共享同一 schema 和 fixture。

## 6.9 v1 验收

- rejected task 不创建 pid；
- Task 在所有 pid 退出后仍可查询；
- 同一 Task 可有多个 Attempt；
- 同一 Attempt 可跨 pid 恢复；
- resolution 记录 policy version 与 reason；
- UI 能展示实际 resolved runtime；
- Cloud fallback 不能绕过数据策略。

---

# 7. Contract 2：Tool Contract

## 7.1 目的

Tool Contract 不替代 MCP。它统一本地工具、MCP、HTTP API、CLI、browser、VFS 和企业服务的产品级身份、权限、凭据、风险、调用结果与审计。

## 7.2 v1 对象

- `ToolDefinition`
- `ToolInvocation`
- `ToolResult`
- `ToolError`
- `ToolPolicyDecision`

## 7.3 最小模型

```ts
interface ToolDefinition {
  api_version: 'tool.sudo.dev/v1'
  kind: 'ToolDefinition'

  tool_id: string
  version: string
  display_name: string

  transport:
    | { type: 'native'; name: string }
    | { type: 'mcp'; server_id: string; name: string }
    | { type: 'http'; operation_id: string }
    | { type: 'cli'; command_ref: ResourceRef }

  input_schema: Record<string, unknown>
  output_schema?: Record<string, unknown>

  required_permissions: string[]
  credential_ref?: string

  effects: {
    level: 'read' | 'write' | 'external_side_effect'
    requires_confirmation: boolean
    requires_network: boolean
  }

  data_policy?: {
    max_classification?: string
    may_leave_zone: boolean
  }
}

interface ToolInvocation {
  api_version: 'tool.sudo.dev/v1'
  kind: 'ToolInvocation'

  call_id: string
  task_id: string
  attempt_id: string
  session_id: string
  pid: string

  actor: PrincipalRef
  agent: {
    principal: string
    version: string
  }

  tool: { tool_id: string; version: string }
  arguments: unknown
  delegation_ref?: DelegationRef
  timeout_ms?: number
  idempotency_key?: string
}

interface ToolResult {
  api_version: 'tool.sudo.dev/v1'
  kind: 'ToolResult'

  call_id: string
  status: 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'timed_out'
  result?: unknown
  result_ref?: ResourceRef
  evidence_refs?: ResourceRef[]
  error?: ErrorInfo
  usage?: {
    duration_ms: number
    bytes_read?: number
    bytes_written?: number
  }
}
```

## 7.4 使用流程

```text
sudocode ToolExecutor
  -> ToolInvocation
  -> policy gate
  -> confirmation if required
  -> Credential Broker resolves short-lived credential
  -> MCP/native/HTTP/CLI adapter
  -> ToolResult
  -> Event/Audit
```

## 7.5 安全规则

- Tool Definition 中只保存 `credential_ref`，不保存 Secret value；
- Agent 容器 SHOULD NOT 获得长期 Secret；
- Tool side effect MUST 明确分类；
- 写操作和 external side effect 可由策略要求人工确认；
- invocation actor 必须来自 authenticated context/delegation，不信任模型生成字段；
- large output 使用 `result_ref`；
- retry 仅在 ToolDefinition 声明幂等或有 idempotency key 时自动进行。

## 7.6 与 MCP 的边界

```text
Tool Contract            MCP
-------------            ---
工具产品身份              工具发现/调用 wire
权限/风险/密级            name/inputSchema/result
credential ref            transport/session
审计关联                  protocol framing
retry/idempotency
```

MCP adapter 把 ToolInvocation 映射为 MCP call，再把 MCP result 映射回 ToolResult。

## 7.7 v1 验收

- 内置 Read/Bash 与一个 MCP tool 产生同格式 Tool event；
- denied call 不到达真实 provider；
- Secret 不出现在 Task、Context、Event、transcript；
- oversized result 可通过 ResourceRef 分页读取；
- Audit 能追到 actor、agent version、task、attempt、pid、tool version。

---

# 8. Contract 3：Context Contract

## 8.1 目的

Context Contract 定义一次模型/Agent 执行实际看到了什么、为什么包含或排除、如何压缩，以及如何复现。

Context 不等于 prompt 字符串。v1 核心是 `ContextManifest`。

## 8.2 v1 对象

- `ContextRequest`
- `ContextManifest`
- `ContextItemRef`
- `ContextExclusion`
- `ContextCompactionRecord`

## 8.3 最小模型

```ts
interface ContextManifest {
  api_version: 'context.sudo.dev/v1'
  kind: 'ContextManifest'

  context_id: string
  task_id: string
  attempt_id: string
  session_id: string
  pid: string

  agent: {
    principal: string
    version: string
    spec_digest: string
    image_digest: string
  }

  system_instruction_refs: ResourceRef[]
  transcript_ref: ResourceRef
  memory_refs: ResourceRef[]
  workspace_manifest_ref: ResourceRef
  skill_refs: ResourceRef[]
  tool_definition_refs: ResourceRef[]

  model: {
    model_id: string
    route?: string
  }

  budget: {
    max_input_tokens?: number
    max_output_tokens?: number
  }

  data_classification: string
  exclusions: Array<{
    resource_ref: ResourceRef
    reason_code: string
    reason: string
  }>

  compression?: {
    strategy: string
    source_refs: ResourceRef[]
    summary_ref: ResourceRef
  }

  digest: string
  created_at: string
}
```

## 8.4 Writer/Reader

- Moss 提供 Task、policy、Agent/Skill/Workspace refs；
- Nexus 提供有权限的资源和版本；
- **sudocode 是 ContextManifest 权威 writer**；
- 模型 provider 只接收最终允许发送的内容；
- SudoWork/Moss/SudoEvolve 通过 ref 读取审计视图，不重新拼 prompt。

## 8.5 Context 与 Memory

```text
Memory = 可长期保存与检索的资料
Context = 本次从 transcript/memory/workspace/skill/tool 中选择的快照
```

同一个 MemoryRecord 可被多个 ContextManifest 引用。ContextManifest 必须记录使用时的 version/digest。

## 8.6 v1 验收

- 同一 manifest + 同一资源版本可重建等价模型输入；
- 能说明某资源为何被排除；
- Cloud/Private 模型调用前已完成 classification/redaction；
- compaction 后仍保留 source refs 和摘要 provenance；
- Secret scope 可引用，但 Secret 明文不进入 manifest。

---

# 9. Contract 4：Memory Contract

## 9.1 目的

Memory Contract 定义 Agent 记忆的 owner、scope、类型、可见性、TTL、provenance、版本、读写和删除语义。

## 9.2 v1 对象

- `MemoryRecord`
- `MemoryWriteRequest`
- `MemoryQuery`
- `MemorySearchResult`
- `MemoryUpdateRequest`
- `MemoryDeleteRequest`
- `MemoryTombstone`
- `MemoryConsolidationRequest`（MAY 延后执行，但 schema 先冻结）

## 9.3 最小模型

```ts
interface MemoryRecord {
  api_version: 'memory.sudo.dev/v1'
  kind: 'MemoryRecord'

  memory_id: string
  owner: PrincipalRef
  scope: 'session' | 'agent' | 'user' | 'team' | 'organization'
  type: 'user' | 'feedback' | 'project' | 'reference' | 'episode' | 'procedure'

  content: string
  summary: string

  provenance: {
    created_by: PrincipalRef
    task_id?: string
    attempt_id?: string
    session_id?: string
    source_event_ids?: string[]
    source_refs?: ResourceRef[]
  }

  visibility: {
    reader_relations: string[]
    writer_relations: string[]
  }

  classification: string
  version: number
  created_at: string
  updated_at: string
  expires_at?: string
}
```

## 9.4 目标路径

```text
/agents/{name}/memory/
  topics/
  logs/
  team/
  tombstones/
```

Session memory 可放：

```text
/sessions/{sid}/memory/
```

Memory path 仍受 Zone context 约束，同名 Agent 在不同 trust domain/Zone 不共享错误 memory。

## 9.5 职责

- Nexus：持久存储、版本、搜索、ReBAC、删除/tombstone；
- sudocode：提取、召回、写入建议、consolidation；
- Moss：组织级政策、审批和管理视图；
- SudoWork：查看、编辑、删除和授权 UI；
- SudoEvolve：只将经过验证的经验提升为新资产，不篡改原始 provenance。

## 9.6 v1 范围

v1 MUST：

- agent/session memory CRUD；
- provenance；
- scope/visibility；
- keyword/hybrid search adapter；
- delete/tombstone；
- ContextManifest 引用。

v1 MAY 延后：

- nightly dream；
- 自动 consolidation；
- 跨组织 federated memory；
- 自动 reward 驱动的经验提升。

## 9.7 v1 验收

- Agent version 升级不丢 principal memory；
- revoked principal 无法继续读写；
- Session/Agent/Team scope 不串；
- 删除后搜索和 Context assembly 不再返回记录；
- 每条 memory 可追溯到来源或人工创建者。

---

# 10. Contract 5：Verify Contract

## 10.1 目的

Verify Contract 定义任务是否完成、依据是什么、由谁裁决、是否需要人工介入，以及如何把结果用于重试和质量改进。

## 10.2 v1 对象

- `Rubric`
- `VerifyRequest`
- `CriterionResult`
- `VerifyResult`
- `HumanDecision`

## 10.3 最小模型

```ts
interface Rubric {
  api_version: 'verify.sudo.dev/v1'
  kind: 'Rubric'

  rubric_id: string
  version: string
  criteria: Array<{
    criterion_id: string
    description: string
    weight: number
    required: boolean
    evaluator: 'schema' | 'rule' | 'test' | 'model' | 'human'
  }>
  pass_threshold: number
}

interface VerifyRequest {
  api_version: 'verify.sudo.dev/v1'
  kind: 'VerifyRequest'

  verify_id: string
  task_id: string
  attempt_id: string
  rubric_ref: ResourceRef
  output_refs: ResourceRef[]
  evidence_refs: ResourceRef[]
}

interface VerifyResult {
  api_version: 'verify.sudo.dev/v1'
  kind: 'VerifyResult'

  verify_id: string
  verifier: PrincipalRef
  verifier_version?: string

  criteria: Array<{
    criterion_id: string
    status: 'passed' | 'failed' | 'inconclusive'
    score: number
    explanation: string
    evidence_refs: ResourceRef[]
  }>

  score: number
  final_status: 'accepted' | 'rejected' | 'needs_human'
  created_at: string
}
```

## 10.4 规则

- Runtime 成功退出不等于 Task accepted；
- output schema validation 不等于质量验收；
- verifier identity/version 必须记录；
- model-based verifier 不得获得超出 Rubric 所需的数据；
- Verify 失败是否 retry 由 Task policy 决定；
- human decision 必须作为独立签名/审计事件，不覆盖原 VerifyResult。

## 10.5 SSOT

- future SudoEvolve 是主要 writer；
- Nexus SessionStore 保存 Rubric ref、request、result、evidence refs；
- Moss 根据 VerifyResult 更新业务状态和审批；
- SudoWork 展示 criterion、evidence 与人工操作。

## 10.6 v1 验收

- 支持 schema/rule/human 三种 evaluator；
- 至少一个 Agent 的正式输出经过 Verify 后才完成；
- Verify 可引用 tool result、artifact、test report；
- retry 后保留旧 attempt 的 VerifyResult；
- 历史结果可还原 verifier version。

---

# 11. Contract 6：Event / Trace / Audit Contract

## 11.1 目的

提供跨仓统一关联、状态投影、调试、计费、审计、Evidence 和重放基础。

## 11.2 一个契约族、三个 profile

| Profile | 目的 | 可采样 | 可丢失 | Retention |
|---|---|---:|---:|---|
| Domain Event | 业务状态和异步编排 | 否 | 否 | 随 Task/Session |
| Trace Span | 性能与调用链诊断 | 可 | 部分可 | 运营策略 |
| Audit Record | 安全与合规事实 | 否 | 否 | 合规策略，append-only |

## 11.3 公共 envelope

```ts
interface EventEnvelope<T> {
  api_version: 'event.sudo.dev/v1'
  kind: 'DomainEvent' | 'TraceEvent' | 'AuditEvent'

  event_id: string
  event_type: string
  occurred_at: string

  producer: {
    service: string
    version: string
  }

  actor?: PrincipalRef
  agent?: {
    principal: string
    version: string
  }

  zone_id?: string
  session_id?: string
  task_id?: string
  attempt_id?: string
  pid?: string
  call_id?: string

  trace_id?: string
  span_id?: string
  parent_span_id?: string
  sequence?: number

  payload: T
  payload_ref?: ResourceRef
}
```

## 11.4 事件注册表

v1 最小事件：

```text
task.created
task.resolution.accepted
task.resolution.rejected
attempt.queued
attempt.started
attempt.completed
attempt.failed
attempt.cancelled
runtime.pid.started
runtime.pid.exited
runtime.pid.replaced
context.manifest.created
context.compacted
tool.call.requested
tool.call.started
tool.call.denied
tool.call.completed
artifact.created
memory.read
memory.written
memory.deleted
verify.requested
verify.completed
human.approval.requested
human.approval.decided
```

## 11.5 顺序与重放

- 全局总顺序不保证；
- 每个 Session/Task stream 使用单调 `sequence`；
- delivery 至少一次；
- consumer 按 `event_id` 去重；
- producer retry 必须复用 event_id 或 idempotency key；
- projection 可从 append-only stream 重建；
- 大 payload 写 `payload_ref`；
- 敏感字段按事件 schema 明确 redaction。

## 11.6 与 OpenTelemetry

- Trace 使用 W3C `traceparent`/OTel trace ID；
- Domain Event 和 Audit 共享 trace_id，但不等于 OTel span；
- OTel backend 可采样 trace；
- Task/Session/Audit 的核心事实仍须进入不可丢失的持久事件流。

## 11.7 v1 验收

- 从 Task 查询到所有 Attempt/PID/Tool/Artifact/Verify；
- 同一事件重复投递不会重复改变 projection；
- 正式事件无 `version: unknown`；
- Audit 缺失时敏感操作 fail-closed 或产生强告警；
- Trace 可关联 SudoRouter model usage。

---

# 12. 六契约的端到端使用方式

以下作为第一条 reference flow 的目标时序。

```text
1. 用户在 SudoWork 提交“分析财务报表”

2. SudoWork 创建/选择 conversation
   conversation-id -> session-id

3. SudoWork/Moss Task ingress 生成 TaskSpec
   - task-id
   - requested agent/channel
   - workspace refs
   - data classification
   - expected output/rubric

4. Moss 校验 IAM、审批与策略
   - 解析 Agent channel -> immutable version/digests
   - 计算 TaskExecutionResolution
   - rejected: 持久化并返回，不创建 pid

5. accepted: Moss 创建 attempt-id，调用 Nexus /v2/runtime

6. Nexus 验证 delegation + zone + agent version
   - 建立/恢复 session-id
   - 分配 pid
   - 建立 /proc/{pid} links
   - 启动 subprocess 或 co-host runtime

7. sudocode 读取 Task/Agent/Workspace/Memory refs
   - 生成 ContextManifest
   - 记录 digest

8. sudocode 调用模型和 Tool
   - ToolInvocation -> policy/credential/gateway -> ToolResult
   - 全过程产生 Event/Trace/Audit

9. sudocode 生成 Artifact + Evidence refs

10. SudoEvolve/临时 verifier 执行 VerifyRequest
    - VerifyResult accepted/rejected/needs_human

11. Moss 更新业务 projection

12. SudoWork 从 Canonical Transcript + Event + UI Overlay 重建界面
```

Local 模式保持同一 Task/Context/Tool/Event schema，但：

- Moss MAY 不存在；
- local resolver 只能选择 `sudolocal`；
- local SessionStore 使用 StdFsBackend；
- Cloud-only Org policy projection 不强迫单机安装 Atlas；
- 未来迁入 Cloud 时通过明确 export/import，而非静默上传。

---

# 13. Semantic-owner definitions 与统一分发

## 13.1 物理位置与依赖方向

### 修订建议

canonical editable definition 住在 semantic owner repo；`sudostack` 作为 assembly/distribution owner：

```text
semantic owner repo
  canonical definition + owner fixtures + owner-local validation
          ↓ exact repo / commit / path / digest
sudostack
  pins + reference closure + derived artifacts + fixture index
  + compatibility/release metadata + @sudo/contracts distribution
          ↓ exact package/artifact revision
producer / consumer boundary
```

理由：

- 定义与真实语义、编译或 admission boundary 同仓，避免依赖倒置；
- `sudostack` 可以统一聚合、版本化、兼容、release 与离线分发，而不取得 owner 语义；
- consumer 使用一个 package 不代表所有 editable definitions 住在 package repo；
- owner repo 不反向依赖 `sudostack` 来定义自身概念，避免环依赖。

独立 `sudo-contracts` repository 是旧提议，已由上述模型替代；它不再是当前目标或开放命名选择。逻辑 package / crate 名仍可保留 `@sudo/contracts` / `sudo-contracts`。

## 13.2 Ownership-aware 布局

owner repo 不被强制复制统一目录模板；`sudostack` manifest 记录 owner 的实际 source path。`sudostack` 的逻辑布局为：

```text
contracts/<family-or-primitive>/
  pin.json                 # owner repo + exact commit + path + digest
  *.gen.*                  # 可重现派生产物
  fixture-index.gen.json   # owner fixtures provenance（启用后）
compatibility/             # 真实 producer/consumer 支持矩阵（启用后）
manifests/                 # baseline/artifact/release provenance（启用后）
package metadata           # consumer 统一分发入口
```

不得为了目录齐全创建没有 owner baseline 或真实 consumer 的 placeholder family/language artifact。derived bundle 可以物化 owner schema 供安装/离线使用，但只能由 exact source 重建，不能成为第二份可编辑定义。

## 13.3 SSOT 与生成物

- Accepted ADR：语义、生命周期、ownership 与安全边界的已接受理由；
- semantic owner repo 的 canonical machine-readable definition：authoritative editable source；
- owner-native primitive spec：底层原语的 canonical source；product object 优先使用 owner JSON Schema 2020-12；
- `sudostack` pin/manifest：source revision、path、digest、reference closure 与 compatibility provenance；
- TypeScript `@sudo/contracts`、Rust `sudo-contracts` 及其他语言 artifact：按真实 consumer 派生的 distribution，不是独立 SSOT；
- OpenAPI / Protobuf / gRPC：transport adapter，不能反向改变 owner 语义。

生成/验证方式由 owner 与 `sudostack` 的实施计划决定，但默认 CI 必须证明 owner definition、derived artifact、fixtures 和真实 adapter 没有漂移。

## 13.4 版本与依赖

- owner source 使用完整 Git commit + path + digest；
- 每个 consumer 精确 pin package/crate/module artifact revision；
- family major、owner revision、package version 与 deployment version 分开记录；
- Contract major 升级附 provider/consumer matrix、legacy window 与 rollback；
- production build 不使用浮动 branch；
- release artifact 可离线验证和镜像，满足 Private/Edge 部署。

## 13.5 各 repo 引用子集

下表只描述目标消费面，不代表各 family 已 draft-frozen、released 或 adopted；first MVP 只启用有真实边界的最小闭包。

| Repo | 可能引用的目标子集 |
|---|---|
| `sudowork` | common、agent ref、runtime ref、task、context view、verify、event、transcript、overlay |
| `moss` | common、agent、runtime、task、tool policy、context request、memory policy、verify、event、transcript projection |
| `sudocode` | common、agent ref、runtime、task、tool、context、memory、event/evidence、transcript |
| `nexus-vfs` | 自有 common identity/Zone/path/runtime primitives；不导入高层产品契约来定义这些原语 |
| `nexus` | common、agent、auth、runtime、memory、event/audit、transcript；承载持久服务但不把业务 policy 下沉 kernel |
| SudoRouter/new-api | common trace、AgentRef、Tool/Model invocation、classification、usage event |
| `sudowork-server` | 迁移 adapter 所需 task/event/agent ref，禁止继续扩自有目标契约 |
| `sudoevolve` | task output、artifact/evidence、verify、event |

---

# 14. SSOT 与 Writer/Reader 矩阵

| 数据 | 权威业务 writer | 持久 SSOT | 其他仓角色 |
|---|---|---|---|
| Agent Principal | Agent Registry/治理服务 | Nexus Agent image | Moss 审批 View，UI 管理 |
| Agent Version/Image | Release service | Nexus `/agents/{name}/versions` | Moss approval，runtime pin |
| Agent Channel | Registry admin | Nexus channel link | Moss resolution reader |
| Org/IAM/Membership | Moss | Moss IAM store | 映射为 Nexus grants |
| Zone/ZoneGrant/ReBAC | Nexus authorization | Nexus | Moss 发送授权意图和读取 View |
| Session metadata | Session Service | Nexus SessionStore | Moss audit index，UI binding |
| Transcript | sudocode/runtime | Nexus SessionStore | SudoWork read/rebuild，Moss audit |
| TaskSpec | Moss Task ingress；Local host | Nexus SessionStore；Local store | UI/Runtime/Verify reader |
| Resolution | Moss Policy Resolver | Nexus task record + Moss audit projection | Runtime/UI reader |
| Attempt | Moss Orchestrator | Nexus task record | Runtime/UI/Verify |
| PID/FSM | Nexus Managed Runtime | Nexus `/proc` | Moss supervise View |
| ContextManifest | sudocode | Nexus SessionStore | Moss/UI/SudoEvolve reader |
| ToolDefinition | Agent/Tool Registry | Nexus Registry | sudocode/Gateway consume |
| ToolResult | Tool executor/gateway | Nexus Task/Session store | Verify/Event consumer |
| Memory | authorized runtime/user | Nexus Memory store | sudocode recall，UI management |
| VerifyResult | SudoEvolve/verifier | Nexus Task store | Moss state projection，UI |
| Domain Event | 各 producer | Nexus append-only stream | projections/subscribers |
| Trace | 各 producer | OTel backend | event carries correlation |
| Audit | Security enforcement point | Nexus append-only audit | compliance UI |
| UI Overlay | SudoWork | SudoWork local/WebUI overlay store | 不影响执行事实 |
| Conversation binding | SudoWork | SudoWork local index | session ref only |
| Secrets bytes | Credential service | Nexus Vault | Moss metadata/policy，runtime short token |
| Model usage/billing ledger | SudoRouter | Router ledger | Moss billing View，Trace correlation |

“SSOT 在 Nexus”不代表“由 Nexus 决定业务内容”。例如 Resolution 由 Moss 决策并写入 Nexus，Nexus 负责持久性和访问控制。

---

# 15. API 与运行时边界

## 15.1 Moss Task API

建议最小 surface：

```text
POST /api/v1/tasks
GET  /api/v1/tasks/{task_id}
POST /api/v1/tasks/{task_id}/cancel
POST /api/v1/tasks/{task_id}/retry
GET  /api/v1/tasks/{task_id}/events
```

`POST /tasks` 支持幂等键。响应可以是 accepted/rejected，不保证立即产生 pid。

## 15.2 Nexus `/v2/runtime`

建议最小 surface：

```text
POST /v2/runtime/attempts:start
POST /v2/runtime/attempts/{attempt_id}:resume
POST /v2/runtime/pids/{pid}:cancel
GET  /v2/runtime/pids/{pid}
GET  /v2/sessions/{session_id}
GET  /v2/tasks/{task_id}
```

请求必须使用已认证 context；payload 的 actor/owner/zone 只作交叉校验，不作身份来源。

## 15.3 ManagedAgentService v2

```ts
interface StartRuntimeRequestV2 {
  task_id: string
  attempt_id: string
  session_id: string

  agent: {
    trust_domain: string
    name: string
    version: string
    spec_digest: string
    image_digest: string
  }

  workspace_refs: ResourceRef[]
  context_request_ref?: ResourceRef
  spawn_spec_ref?: ResourceRef
}

interface StartRuntimeResponseV2 {
  task_id: string
  attempt_id: string
  session_id: string
  pid: string
  workspace_path: string
}
```

v1 legacy `managed_agent.start_session_v1` 保留兼容期，但新 consumer 应切到 v2；不能在 v1 response 中悄悄改变 `session_id` 含义。

## 15.4 Event ingestion

可先通过 Nexus append stream 或 HTTP：

```text
POST /v2/events
GET  /v2/sessions/{sid}/events
GET  /v2/tasks/{task_id}/events
```

后续可使用 NATS/Kafka，但 EventEnvelope 不依赖具体 bus。

---

# 16. 各仓库主要修改点

## 16.1 Semantic owners 与 `sudostack` Contract assembly

### Semantic owner 必做

- 在 owner repo 维护 canonical machine-readable definition、owner fixtures 与 owner-local validation；
- 为跨 owner 引用提供 immutable commit、source path 与 digest；
- 记录 semantic/security owner、runtime writer/store 和真实 producer/consumer；
- 不反向依赖 `sudostack` package 来定义自身原语。

### `sudostack` 必做

- exact pins、reference closure、派生 artifact 与 fixture index；
- 只为真实 consumer 启用的语言 package；
- compatibility/support matrix；
- release provenance 与离线分发；
- 不复制 owner 的 editable definition，不实现 Task scheduler/业务 Registry，也不持有 Secret。

## 16.2 `sudowork`

### Contract adoption

1. [`packages/contracts`](https://github.com/sudoprivacy/sudowork/tree/9f7a5fca1e6cc114d02b26af76f791d449f40779/packages/contracts) 改为依赖/re-export `@sudo/contracts`，保留 WebUI transport DTO；
2. 普通 chat、Team、Cron、Channel、Remote provider 统一映射到 TaskSpec；
3. local/cloud 使用同一个 TaskSpec，transport adapter 不改变语义；
4. conversation metadata 明确记录 `session_id/task_id/attempt_id/current_pid`，迁移旧 `mossSessionId/acpSessionId`；
5. renderer 用 Event reducer 更新执行进度，不直接推断 Pod/process 状态；
6. 增加 Task resolution、Verify、Evidence、Audit timeline UI。

### Transcript/Overlay

1. 建立消息字段分类表；
2. 定义 UI Overlay schema；
3. transcript + overlay shadow rebuild；
4. 比对用户原文、工具展示、artifact、compaction、顺序；
5. transcript-primary 仅在重建无损后切换；
6. legacy/non-scode backend 继续保留适配策略。

### 身份/入口

1. 去掉“个人版/企业版”作为 execution topology 的主语义；
2. 登录方式由 server `system-config` 自报；
3. UI 选择本地/云端；Private 由 Org policy resolution；
4. 显示 policy reason，而非硬编码 runtime 规则。

### 验收

- 同一 conversation 可在 pid 重建后继续；
- Desktop/WebUI 读取同一 canonical session；
- Overlay 不进入 Agent Context；
- 旧数据库可回滚。

## 16.3 `moss`

### Task/Policy

1. 增加统一 `TaskIngressService`：chat、cron、trigger、channel、team、API 均输出 TaskSpec；
2. 增加 `TaskPolicyResolver`，输出 discriminated `TaskExecutionResolution`；
3. 增加 `TaskOrchestrator` 与 Attempt lifecycle；
4. 拒绝路径不得调用 runtime；
5. fallback 必须二次 policy evaluation。

### Nexus client 与 SSOT 迁移

1. Nexus client 从 secrets 扩展到 Session/Task/Agent/Event/Memory refs；
2. 现有 `sessions/session_attempts/session_events` 先双写，再变 projection；
3. `agentStore.ts` 改为 Registry client + materialization cache；
4. Org/IAM 留 Moss，Zone grants 写 Nexus；
5. 配置、Secret bytes、runtime state 的 writer 边界按矩阵收敛。

### Tool/Context

1. MCP policy 字段真正进入 policy gate；
2. credential 从“写入 runtime env/header”迁到短期 broker/token；
3. Moss 只提交 ContextRequest/resources，不生成最终 prompt；
4. Tool call/event/audit 使用统一 envelope。

### Production

1. external Nexus 使用 mTLS 与 auth token；
2. 移除 production HA 中 `--insecure-no-auth`；
3. 多实例只共享 projection，不以共享 SQLite 作为长期 HA 方案；
4. outbox/inbox 保证跨存储双写可恢复。

## 16.4 `sudocode`

### Runtime boundary

1. 只有识别出真实 Rust product-object boundary 后，才 exact-pin `sudostack` 分发的 `sudo-contracts` artifact；owner primitives 继续直接来自 owner；
2. 支持 `ExecutionStart`/Task/Attempt/AgentVersion；
3. runtime 不理解 Cloud/Private/充值等产品政策；
4. ACP、CLI、co-host 都适配到同一内部 execution model。

### Session

1. SessionStore 使用持久 `session_id`；
2. pid 由 host/Nexus 提供，不再冒充 session；
3. resume 能跨 pid 读取 transcript/tool results/context refs；
4. co-host 使用 `KernelFsBackend.with_agent_name(name)` 正式落 `/sessions`。

### Context/Tool/Memory/Event

1. Context assembler 成为唯一 manifest writer；
2. ToolExecutor 前后包装 ToolInvocation/ToolResult；
3. memory backend 对齐 CRUD/search/provenance；
4. 所有关键状态产生 EventEnvelope；
5. 输出 Artifact/Evidence refs 供 Verify；
6. oversized tool output 保持现有 offload，不重复复制进 event。

### Co-host

1. 从 AgentVersion manifest 解析 model/tools/skills/permissions/memory；
2. 不再固定最小工具集合为最终 profile；
3. 保留 subprocess 与 in-process 为显式 backend；
4. failure domain 作为配置语义，不隐藏在实现中。

## 16.5 `nexus-vfs`

### Identity/Security

1. `RustService::dispatch` 接入 `OperationContext`；
2. 所有 Rust service 使用认证主体，禁止信任 payload owner/zone；
3. production permission provider 缺失时 fail-closed；
4. DT_LINK follow 重新授权目标；
5. cross-zone grant 可审计、可撤销。

### ManagedAgentService v2

1. 分离 `session_id` 与 `pid`；
2. Start/Resume 使用持久 session；
3. `/proc/{pid}` 建立 session/task/attempt/agent links；
4. pid teardown 只回收 `/proc` 和 runtime handle；
5. session archive/delete 是独立管理操作；
6. runtime events 带五个 ID 和 Agent version/digest。

### 边界

1. 只引用 contract common/runtime 子集；
2. Task/Context/Verify 作为 typed document/ref 存储；
3. kernel 不实现产品 policy resolver。

## 16.6 `nexus`

### Agent/Session/Task

1. 产品 AgentSpec 与现有 scheduling `AgentSpec` 分离；
2. 实现 principal/version/channel registry；
3. 提供 SessionStore/TaskStore 的 API 与 path contract；
4. 实现 `/v2/runtime` facade；
5. 将 nexus-vfs managed runtime 装配到 production HTTP/gRPC surface。

### Zone/ReBAC

1. 冻结 Zone ID 与 ZoneGrant model；
2. Org grant API 与 Moss client 对齐；
3. user/agent/delegation context 进入所有 VFS/RPC paths；
4. 建立跨 Zone 负向测试。

### Memory/Event/Audit

1. MemoryRecord storage/search；
2. Session/Task event streams；
3. Audit retention/query；
4. Trace exporter 与 event correlation；
5. Schema metadata/version validation。

## 16.7 SudoRouter/current `new-api`

当前源码需先加入工作区或固定 revision，再拆实施计划。

### 目标修改点

1. 接收标准 task/attempt/session/pid/agent/trace metadata；
2. 输出 model invocation usage event；
3. quota 支持 user/org/agent/task 维度；
4. classification 与 DLP 在出域前执行；
5. core/private policy 默认禁止 Cloud fallback；
6. provider retry/fallback 写 reason/policy/version；
7. credential 与 usage ledger 继续由 Router authority 管理。

`nova-gateway` 只保留历史迁移记录，不应新增目标能力。

## 16.8 `sudowork-server`

### 定位

Legacy control plane + migration adapter；不再成为新六契约 owner。

### 修改点

1. auth/payment/credit/system-config 向 Moss 收敛；
2. 旧 API 映射到 contract DTO；
3. Dify enhancement 重定位为 Tool provider、Context provider 或 SudoGenius Agent；
4. QMS 改为 Event/Trace consumer；
5. Sudohub assistant metadata 迁 Agent Registry；
6. 去除客户端可解密的长期共享 AES credential envelope；
7. 制定数据 backfill、read cutover 与下线标准。

## 16.9 `sudoevolve`（未来）

1. Rubric Registry；
2. Verify queue/worker；
3. schema/rule/test/model/human evaluator；
4. Evidence store/ref validation；
5. signed delivery；
6. failure pattern；
7. 脱敏后的跨项目经验提升；
8. 只消费授权 Evidence，不获得任务完整数据的默认权限。

---

# 17. 迁移策略

## 17.1 通用迁移状态机

```text
legacy-only
  -> dual-write
  -> shadow-read/rebuild
  -> compare and backfill
  -> contract-primary
  -> legacy read fallback
  -> legacy write disabled
  -> legacy fields removed after one stable release window
```

每个对象的开发计划必须包含：

- 当前位置；
- 新 SSOT；
- 权威 writer；
- backfill；
- dual-write；
- compare；
- cutover flag；
- rollback；
- old-write removal 条件。

## 17.2 Session/PID 兼容

- `start_session_v1` 继续保留原“session_id 实为 pid”语义；
- 新增 v2，不在 v1 原地改字段语义；
- adapter 将 legacy id 标注为 `legacy_runtime_id`；
- 新 Session Service 分配 `sess_*`；
- v2 consumer 禁止以字符串前缀之外的猜测判断类型；
- legacy session 回填为 session + one legacy attempt + one historical pid record。

## 17.3 Moss DB

第一阶段：

- Moss DB 保持业务查询主读；
- Task/Session/Event 同时写 Nexus；
- 使用 outbox 防止写一半。

第二阶段：

- shadow projection 从 Nexus rebuild；
- 比对 count、state、timestamps、ownership、events。

第三阶段：

- Task/Session 主读 Nexus；
- Moss DB 只保留 IAM、业务审批与查询 projection。

## 17.4 Transcript/UI Overlay

字段分为：

1. Canonical Transcript：用户原文、assistant、tool call/result、artifact refs、error/cancel、Agent version、Task/Verify events；
2. UI Overlay：draft、collapsed、selected tab、scroll/read position、local labels、display cache；
3. Local Index：conversation -> session binding、local-only backend binding。

切换前必须证明：

```text
Transcript + Overlay -> same rendered conversation
```

## 17.5 Agent Registry

- 扫描 Moss `assistants/{system,hub,custom,tenant}`；
- 生成 principal/version manifest；
- digest 资源；
- approval/status 映射；
- 发布 Nexus Registry；
- Moss materialize cache 对比；
- 切读 Registry；
- 保留 rollback manifest；
- 最后关闭目录直接写入。

## 17.6 Secrets/MCP

- 先把现有 secret 转 `credential_ref`；
- Gateway 支持 legacy resolution；
- 引入短期 token/credential broker；
- runtime env/header 只接短期、最小 scope 值；
- Audit 对比；
- 禁止长期明文注入；
- 删除 legacy credential envelope。

---

# 18. 安全与负向验收

## 18.1 身份

- 调用者伪造 `owner_id` 无效；
- 调用者伪造 `zone_id` 无效；
- Agent 不能伪造 mailbox `from`；
- 同名 Agent 在不同 trust domain 不冲突；
- revoked version 不能创建新 pid；
- certificate revoke 与 principal revoke 语义独立。

## 18.2 Zone

- User A 不能读 User B Zone；
- Office Zone 不默认读 Core Zone；
- 知道路径不能跨 Zone；
- permission provider 缺失时拒绝；
- grant 撤销后新请求立即失败；
- 是否中止已运行 pid 必须由明确 policy 决定并审计。

## 18.3 Task routing

- Private/Core Task 不因 Cloud 可用而 fallback；
- rejected Task 不启动 runtime；
- policy version 不可解析时拒绝；
- retry 不复用过期 delegation；
- local-only resource 不静默上传。

## 18.4 Tool/Secret

- denied tool 不到达 provider；
- Secret 不进入 Task/Context/Event/Transcript；
- Tool result 大 payload 不塞入 event；
- external side effect 未批准时拒绝；
- idempotency 不明时不自动 retry。

## 18.5 Verify

- executor 不能覆盖 verifier result；
- human decision 是新记录，不改历史；
- Evidence ref 权限不足时 verifier 返回 inconclusive/denied，不绕过；
- 模型 verifier 不能把 Private Evidence 发往不允许的模型域。

---

# 19. Contract 与跨仓 CI

## 19.1 Owner 与 sudostack assembly CI

Owner repository 对 canonical definition、references、valid/invalid/boundary fixtures 和 owner-local behavior 负责；`sudostack` 对 exact source closure、派生产物、跨语言/跨 family 组合、兼容与可安装分发负责。启用的最小 checks 包括：

1. owner definition/schema lint 与 reference 解析；
2. valid fixture 全通过；
3. invalid fixture 必须失败；
4. 已启用语言的真实 adapter round trip；
5. generated artifact clean diff；
6. 与前一个 immutable baseline 的 backward compatibility mutation check；
7. 已启用 event/error registry uniqueness；
8. package version、family major 与 support matrix 规则检查。

没有真实 owner baseline、语言 consumer 或 registry 时不创建 placeholder check。

## 19.2 Consumer CI

每个 consumer repo 至少：

- pin contract version；
- 跑 shared fixtures；
- provider/consumer contract tests；
- unknown optional field test；
- unsupported major test；
- redaction/secret test；
- event producer version 非 unknown。

## 19.3 Reference E2E

```text
SudoWork WebUI
 -> Moss TaskSpec
 -> accepted Resolution
 -> Nexus session + attempt + pid
 -> sudocode ContextManifest
 -> one native tool + one MCP tool
 -> Artifact/Evidence
 -> VerifyResult
 -> Event stream
 -> SudoWork Transcript + Overlay rebuild
```

同一 E2E 再执行：

- stop pid1；
- resume same session/attempt as pid2；
- transcript/tool result/context 可继续；
- UI 不产生重复消息；
- event projection 去重；
- Verify 可追溯两个 pid。

---

# 20. 可拆分开发计划的 Epic 边界

以下是依赖图，不是排期。

## Epic 0：ADR 与 Contract Foundation

### 产物

- ADR-001 Identifiers/Lifecycle；
- ADR-002 Zone/Tenancy；
- ADR-003 Agent Principal/Version；
- ADR-004 Task/Resolution；
- ADR-005 Product Contract Versioning；
- ADR-006 Transcript/UI Overlay；
- first-MVP semantic-owner map 与 owner Work Items；
- owner exact-source baseline（先从真实 ZoneId/ResourceRef/meta-contract 边界开始）；
- `sudostack` pins/derived distribution skeleton；
- 只含真实 producer/consumer 的 compatibility matrix。

### 依赖

无。

### 出口

G0 ownership/security review完成；included owner definitions 可识别并由 `sudostack` exact-pin。ADR 是否 Accepted、Contract 是否 draft-frozen 与 artifact 是否 released 分开记录。

## Epic 1：Identity、Zone 与 Authenticated Service Context

### Repo

`nexus-vfs`、`nexus`、`moss`。

### 产物

- RustService dispatch context；
- ZoneGrant/ReBAC model；
- delegation token；
- fail-closed production profile；
- Moss IAM -> Nexus grant adapter；
- negative tests。

### 依赖

Epic 0。

### 出口

payload owner/zone 无法越权；production 不用 insecure auth。

## Epic 2：Session/Task/Attempt/PID Runtime v2

### Repo

`nexus-vfs`、`nexus`、`moss`、`sudocode`、`sudowork`。

### 产物

- durable Session Service；
- ManagedAgentService v2；
- `/proc` links；
- `/v2/runtime`；
- legacy v1 adapter；
- resume across pid E2E。

### 依赖

Epic 0、Epic 1。

### 出口

同一 session/attempt 跨 pid 恢复成功。

## Epic 3：Task Contract Vertical Slice

### Repo

对应 semantic owner repo、`sudostack`、`sudowork`、`moss`、`nexus`、`sudocode`。

### 产物

- TaskSpec/Resolution/Attempt schema；
- Task ingress；
- Policy resolver；
- Task persistence；
- Local/Cloud adapters；
- accepted/rejected E2E。

### 依赖

Epic 2。

### 出口

一个真实用户任务按统一 Task 契约执行或拒绝。

## Epic 4：Event/Trace/Audit Backbone

### Repo

所有现役 repo；Router 需加入当前源码。

### 产物

- EventEnvelope；
- event registry；
- append/query；
- projection；
- OTel correlation；
- Audit retention。

### 依赖

Epic 0；与 Epic 2/3 并行，但完整 E2E 依赖它们。

### 出口

Task -> Attempt -> PID -> Tool -> Artifact 可完整查询。

## Epic 5：Context + Tool Governance

### Repo

`moss`、`sudocode`、`nexus`、SudoRouter。

### 产物

- ContextManifest；
- context assembler；
- ToolDefinition/Invocation/Result；
- MCP adapter；
- policy gate；
- credential broker；
- Secret redaction tests。

### 依赖

Epic 1、2、3、4。

### 出口

一个 native tool 与一个 MCP tool 通过统一治理链完成。

## Epic 6：Transcript + UI Overlay

### Repo

`sudowork`、`moss`、`sudocode`、`nexus`。

### 产物

- field ownership matrix；
- overlay schema；
- canonical transcript；
- dual write；
- shadow rebuild/compare；
- backfill；
- read cutover/rollback。

### 依赖

Epic 2、3、4。

### 出口

Desktop/WebUI 可从 Transcript + Overlay 无损恢复。

## Epic 7：Memory Protocol

### Repo

`sudocode`、`nexus`、`moss`、`sudowork`。

### 产物

- MemoryRecord/Query/CRUD；
- principal/session/team scope；
- search/recall；
- provenance；
- deletion/tombstone；
- Context integration。

### 依赖

Epic 1、2、5。

### 出口

升级 Agent version、重启 pid 后 memory 连续且不越权。

## Epic 8：Verify Reference Implementation

### Repo

对应 semantic owner repo、`sudostack`、future `sudoevolve`、`moss`、`nexus`、`sudowork`、`sudocode`。

### 产物

- Rubric/Verify schema；
- schema/rule/human evaluator；
- Artifact/Evidence；
- Task state integration；
- UI criterion view。

### 依赖

Epic 3、4、5。

### 出口

参考 Agent 的 Task 必须 Verify accepted 后才完成。

## Epic 9：Legacy Convergence

### Repo

`sudowork-server`、`moss`、`sudowork`、Agent Registry、SudoRouter。

### 产物

- auth/payment/config migration；
- Sudohub/Agent Registry migration；
- Dify adapter；
- QMS Event consumer；
- data backfill；
- legacy API shutdown gates。

### 依赖

Epic 3、4，部分依赖 5/6。

### 出口

目标链不依赖 `sudowork-server` 才能完成 Cloud reference task。

---

# 21. 开放问题

这些问题必须进入 ADR 评审，不能由单仓实现者私自决定。

1. First MVP 中 Product Zone/ZoneGrant/ResourceRef 与 ErrorInfo envelope 的 proposed semantic/security ownership 是否通过 review？独立 `sudo-contracts` repository 已不再是开放选择；consumer package 由 `sudostack` 分发。
2. Session Service 物理实现落 `nexus` 还是 `nexus-vfs` 的哪个 service tier？kernel 只提供 primitives，产品 Session API 不应进入 core。
3. Attempt 因 infrastructure restart 产生多个 pid 的恢复边界：模型调用进行中是否重放，Tool side effect 如何去重？
4. Grant 撤销是否立即终止已运行 pid，还是只阻止下一次 syscall/tool call？建议按资源密级 policy 化。
5. Agent resume 默认锁旧 version，还是自动解析 channel？建议默认锁旧 version，升级需显式请求。
6. Tool Gateway 第一版放 Moss 还是独立服务？建议 Moss 管 policy，执行 gateway 可独立扩展。
7. Domain Event 的第一版 bus 使用 Nexus DT_STREAM、NATS 还是数据库 outbox？建议 envelope 与 bus 解耦，reference slice 可先 DT_STREAM + outbox。
8. Canonical Transcript v1 是否包含完整 UI tool rendering，还是 raw tool fact + deterministic renderer version？建议 canonical 保存 raw fact，Overlay/renderer 负责展示，但必须证明可重建。
9. SudoRouter current `new-api` 的仓库、branch、版本和 owner 需要正式纳入兼容矩阵。
10. SudoEvolve 是独立 repo/service，还是 Moss 内部模块起步？建议契约独立，reference verifier 可先 Moss worker，正式产品再独立。

---

# 22. 本阶段完成标准

语义冻结阶段只有满足以下条件才算完成：

1. 六份 ADR 已接受；
2. Zone、Principal、Version、Session、Task、Attempt、PID 定义无歧义；
3. 每类对象有唯一业务 writer 和持久 SSOT；
4. 六契约 v1 有语言无关 schema；
5. TypeScript/Rust 至少先完成双向 fixture；
6. Go/Python consumer 接入计划明确；
7. compatibility、dual-write、backfill、cutover、rollback 有文档；
8. reference flow 跨 Moss/Nexus/sudocode/SudoWork；
9. 同一 Session/Attempt 跨多个 pid 恢复；
10. Transcript + UI Overlay 可完整重建；
11. 跨用户、Org、Zone 权限负向测试 fail-closed；
12. Tool Secret 不进入 Agent/Transcript/Event；
13. 正式事件无 `version: unknown`；
14. VerifyResult 成为至少一个参考 Task 的完成门槛；
15. `sudowork-server` 和废弃 `nova-gateway` 不再被误认为目标架构 SSOT。

---

# 附录 A：术语表

| 术语 | 含义 |
|---|---|
| Agent Principal | Agent 长期身份，跨版本存在 |
| Agent Version | 不可变发布制品与配置快照 |
| Agent Channel | 指向具体 version 的可变 alias |
| Session | 可恢复的连续工作上下文 |
| Task | 用户或系统要求完成的一项工作 |
| Attempt | Task 的一次策略级执行尝试 |
| PID | Attempt 下的一次临时 runtime 实例 |
| Conversation | SudoWork UI 展示与交互对象 |
| Zone | 持久安全和数据边界 |
| Org | 可变业务组织、计费和管理分组 |
| Context | 一次执行实际使用的输入快照 |
| Memory | 跨执行持久保存、可检索的信息 |
| Artifact | 任务产出的正式对象 |
| Evidence | 支撑 Verify 判定的可引用事实 |
| Overlay | 仅影响 UI 展示、不影响执行事实的状态 |
| Projection | 从 SSOT/Event 派生的查询视图 |

# 附录 B：禁止的语义复用

以下字段名不得再一字段多义：

- `session_id` 不得表示 pid；
- `agent_id` 不得同时表示 principal、profile、version 和 pid；
- `task_id` 不得表示 conversation；
- `owner_id` 不得来自不可信 payload；
- `zone_id` 不得直接使用可改名 Org name；
- `version` 不得在正式事件中为 `unknown`；
- `status` 不得同时混用 Task、Attempt、PID、Verify 状态；
- `disabled` 不得同时表示 principal/version/certificate/approval 撤销；
- `path` 不得在缺少 Zone context 时作为全局资源身份；
- `success` 不得同时表示 Runtime 退出成功和 Verify accepted。
