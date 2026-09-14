# ADR-001：Agent、Session、Task、Attempt 与 Runtime PID 标识及生命周期

- 状态：Proposed
- 日期：2026-09-12
- 决策范围：Sudo 全产品族
- 目标契约版本：`common.sudo.dev/v1`、`runtime.sudo.dev/v2`
- 相关文档：
  - [`Sudo 跨仓语义与六契约设计`](../design/cross-repo-contracts-semantics-design-v1.0.md)

---

## 1. 背景

Sudo 当前由多个独立仓库共同实现 UI、控制面、Agent Runtime、分布式存储和进程管理。各仓库已经存在多个名称相似但生命周期不同的 ID：

- SudoWork `conversation.id`；
- SudoWork `acpSessionId`；
- SudoWork `mossSessionId`；
- Moss `session_id`；
- Moss `transcript_session_id`；
- Moss `session_attempts.attempt_id`；
- sudocode ACP session ID；
- Nexus AgentRegistry PID；
- Nexus ManagedAgent `start_session_v1.session_id`；
- OS PID、Pod UID、container ID。

当前关键冲突：

1. [`nexus-vfs/rust/managed_agent/src/session.rs`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/managed_agent/src/session.rs) 明确没有独立持久 Session ID，并将 AgentRegistry PID 作为 `session_id` 返回；
2. [`nexus-vfs/rust/contracts/src/agent_pid.rs`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/contracts/src/agent_pid.rs) 将 PID 定义为 OS PID；
3. ManagedAgent raw subprocess response 又单独返回 `os_pid`；
4. sudocode 的 SessionStore 已有真正持久 Session，但 `session/new` 自己生成 ID；
5. Moss 已有 Session 和 Attempt，但其 Attempt 实际承载 process/container generation；
6. SudoWork 同时保存 UI conversation、Moss session 与 ACP session binding。

如果不冻结语义，可能出现：

- PID 退出等同于 Session 消失；
- Pod 重建无法恢复同一工作；
- UI conversation、Task、Session 相互冒充；
- 业务 retry 与基础设施 restart 无法区分；
- 审计不能还原具体 Agent version 和 runtime instance；
- `session_id` 在 v1/v2 中静默改变含义；
- co-host、subprocess、Kubernetes 无法使用同一种 PID 语义。

---

## 2. 决策

### 2.1 冻结六类标识

Sudo v1/v2 统一使用以下标识：

| 标识 | 语义 | 生命周期 | 创建者 | 权威源 |
|---|---|---|---|---|
| `agent-name` | 长期 Agent principal 的名称部分 | 持久 | Agent Registry | Nexus Agent Registry |
| `session-id` | 一段可恢复的连续工作上下文 | 持久 | Session Service | Nexus SessionStore；Local 为 sudocode SessionStore |
| `task-id` | 用户或系统要求完成的一项工作 | 持久 | Task ingress | Nexus Session TaskStore；业务 writer 为 Moss/Local host |
| `attempt-id` | Task 的一次策略级/业务级执行尝试 | 持久 | Task Orchestrator | Nexus Task attempt record |
| `pid` | Attempt 下的一次临时 Runtime 实例 | 临时 | Managed Runtime | Nexus AgentRegistry 与 `/proc` |
| `conversation-id` | SudoWork UI conversation | 持久但仅属 UI | SudoWork | SudoWork UI store/local index |

### 2.2 冻结对象关系

```text
Agent Principal 1 ── N Agent Version
Agent Principal 1 ── N Session（v1 中 Session 固定一个 Agent Principal）
Session         1 ── N Task
Task            1 ── 0..N Attempt
Attempt         1 ── 0..N PID
Conversation    N ── 1 Session（新写入建议 1:1；迁移期允许多条 UI projection）
```

解释：

- Task 被 policy 拒绝时没有 Attempt/PID；
- Task 被接受后创建 Attempt；
- 用户 retry、policy 重新裁决或显式 Agent version upgrade 创建新 Attempt；
- 用户回答 Agent 问题或补齐缺失参数作为同一 Task 的追加输入事件；
- 工作目标、核心输入、数据范围或 expected output 发生实质变化时创建新 Task，并通过 `supersedes_task_id` 关联；
- 同一 Attempt 因 Pod 重建、节点接管或进程恢复可以创建新 PID；
- PID 退出只结束本次 runtime，不删除 Session、Task 或 Attempt；
- Session archive/delete 是独立持久管理操作；
- Conversation 是 UI 投影，不是 Runtime 权威对象。

### 2.3 PID 是平台级 opaque Runtime ID，不是 OS PID

平台 `pid` MUST 是全局唯一、不可解析、临时的 Runtime instance ID，例如： `[enforced_by: none]` —— 无平台 PID 概念；最接近的 `session_attempts.runner_pid`（moss `db.ts:184`）就是 OS pid

```text
pid_01JXYZ...
```

OS/容器定位信息单独表达：

```ts
interface RuntimeLocator {
  node_id?: string
  os_pid?: number
  pod_uid?: string
  pod_name?: string
  container_id?: string
  host_process_id?: number
  local_runtime_id?: string
}
```

原因：

- co-host 多个 Agent 可共享一个 OS process；
- Kubernetes 的稳定定位不是容器内 OS PID；
- OS PID 会复用，只在单机进程表中有意义；
- 分布式系统需要跨节点唯一的 Runtime ID；
- Runtime locator 会变化，但 PID identity 在该次运行生命周期内不变；
- 当前 ManagedAgent 已经单独返回 `os_pid`，证明两者概念事实上已分离。

因此：

- `encode_agent_pid(host_pid, local_id)` 不再定义产品 PID；
- 该 API 应弃用、删除或更名为 runtime locator helper；
- `ps/kill/debug` 工具通过 PID 查 RuntimeLocator，再执行 OS 级操作；
- legacy numeric/synthetic PID 只保留兼容读。

### 2.4 ID 是 opaque value

除类型前缀外，consumer MUST NOT 解析 ID 内部结构。 `[enforced_by: none]`

建议前缀：

```text
sess_
task_
attempt_
pid_
conversation_
```

本 ADR 不冻结 UUIDv7、ULID 或其他生成算法，只要求：

- 全局唯一；
- 不可变；
- 不包含用户、组织、Zone 等可变或敏感业务信息；
- 不以数据库自增整数作为跨仓 wire ID；
- consumer 不从 ID 推断时间、节点或权限。

### 2.5 Agent principal 的完整身份不等于 `agent-name`

`agent-name` 是 principal 名称部分。完整身份为：

```text
(trust_domain, agent_name)
```

规范 URI：

```text
nexus://{trust_domain}/agent/{agent_name}
```

Agent Version 由 ADR-003 定义。

### 2.6 Session 的定义

Session 表示一段可恢复的连续工作，必须能够保存或引用： `[enforced_by: none]` —— transcript / agent principal / workspace 在 `sessions` 上有；Task 列表、Context manifests、Verify refs 无此概念

- transcript；
- Task 列表；
- Context manifests；
- Tool result refs；
- Artifact refs；
- Verify refs；
- Agent principal；
- 各 Attempt/PID 使用的 Agent version history；
- Workspace/resource refs；
- Runtime PID history。

Session MUST： `[enforced_by: none]` —— 「PID 退出后仍存在」「跨节点恢复」靠构造与 attempt 级 CAS 成立（moss `db.ts:1493`，`test:claimAttempt.test.ts`），但 home Zone 不存在，整条并未被强制

- 在 PID 退出后继续存在；
- 可以跨进程、Pod、节点与版本恢复；
- 具有 owner、home Zone 和创建时间；
- v1 中固定一个 Agent Principal；切换 Principal 创建新 Session或显式 handoff；
- 不在 Session 上固定 Agent Version，实际 Version 由每个 Attempt 记录；
- 归档与删除独立于 runtime cancel；
- 不以当前工作目录 hash 作为跨平台唯一身份。

### 2.7 Task 与 Attempt 的定义

Task 表示“一项需要完成的工作”，不等于一条消息或一个进程。

Attempt 表示该 Task 的一次完整业务/策略执行尝试。以下情况创建新 Attempt：

- 用户在不修改 TaskSpec 的前提下明确 retry；
- policy version 或 runtime resolution 重新裁决；
- Agent version 被显式升级；
- 前一 Attempt Verify 失败后按原 TaskSpec 重新执行。

以下情况继续同一 Task/Attempt，并记录追加输入事件：

- 用户回答 Agent 在当前 Attempt 中提出的问题；
- 用户完成当前 Attempt 的 permission/approval；
- 用户补齐不改变工作目标、数据范围和输出契约的缺失参数。

工作目标、核心输入、数据范围或 expected output 发生实质变化时，不得通过 Attempt 偷改不可变 TaskSpec；必须创建新 Task，并使用 `supersedes_task_id` 或 `parent_task_id` 建立关系。 `[enforced_by: none]` —— 无 Task；session 的 spec 字段可原地改写

以下情况不自动创建新 Attempt：

- 同一 Attempt 的 Pod 被驱逐；
- server failover；
- runtime process 崩溃后从 checkpoint 恢复；
- transport reconnect。

这些情况在同一 Attempt 下创建新 PID，并记录 `runtime.pid.replaced` 等事件。

如果 Tool side effect 不能安全重放，Runtime MUST 在恢复前检查 idempotency/evidence；本 ADR 只冻结身份关系，具体重放协议由 Task/Tool Contract 定义。 `[enforced_by: none]`

### 2.8 Conversation 的定义

Conversation 仅表示 SudoWork 的 UI 组织对象，包括：

- 列表排序；
- 标题和置顶；
- 当前视图；
- UI overlay；
- local/remote binding。

Conversation MUST 通过显式 binding 指向 Session： `[enforced_by: none]` —— 无 `SessionBinding`；moss 用 `sessions.channel_chat_id` 直连

```ts
interface SessionBinding {
  conversation_id: string
  session_id: string
  current_task_id?: string
  current_attempt_id?: string
  current_pid?: string
}
```

删除/折叠 Conversation 不自动删除远端 Session，除非用户执行明确的“同时删除远端数据”操作并通过权限检查。

---

## 3. 数据模型

### 3.1 Session metadata

```ts
interface SessionMetadata {
  api_version: 'runtime.sudo.dev/v2'
  kind: 'SessionMetadata'

  session_id: string
  owner: PrincipalRef
  home_zone_id: string
  created_at: string
  updated_at: string
  state: 'active' | 'archived' | 'deleted'

  agent_principal: AgentPrincipalRef
  task_ids: string[]
  current_attempt_id?: string
  current_pid?: string
}
```

### 3.2 Attempt identity reference

`TaskAttempt` 的完整 canonical schema 由 ADR-004 的 `task.sudo.dev/v1` 定义。本 ADR 只冻结 Runtime boundary 必须携带的不可混用引用： `[enforced_by: none]` —— `AttemptRef` 三个 id 都是裸 `string`，无 branded type

```ts
interface AttemptRef {
  session_id: string
  task_id: string
  attempt_id: string
}
```

Runtime、`/proc` link 和 Event 使用 `AttemptRef` 关联持久 TaskAttempt，不在 `runtime.sudo.dev/v2` 重新定义第二套 Attempt 状态。

### 3.3 Runtime Run

```ts
interface RuntimeRun {
  api_version: 'runtime.sudo.dev/v2'
  kind: 'RuntimeRun'

  pid: string
  session_id: string
  task_id: string
  attempt_id: string
  agent: AgentVersionRef
  state:
    | 'registered'
    | 'warming_up'
    | 'ready'
    | 'busy'
    | 'awaiting_input'
    | 'terminated'
  locator?: RuntimeLocator
  started_at: string
  ended_at?: string
  exit?: {
    code?: number
    signal?: string
    reason?: string
  }
}
```

---

## 4. API 决策

### 4.1 Runtime v2

```ts
interface StartRuntimeRequestV2 {
  session_id: string
  task_id: string
  attempt_id: string
  agent: AgentVersionRef
  workspace_refs: ResourceRef[]
  spawn_spec_ref?: ResourceRef
}

interface StartRuntimeResponseV2 {
  session_id: string
  task_id: string
  attempt_id: string
  pid: string
  runtime_locator?: RuntimeLocator
  workspace_path: string
}
```

### 4.2 新建与恢复

- Session Service 负责 create/import Session；
- Runtime start 必须接收已存在的 Session/Task/Attempt； `[enforced_by: none]` —— 靠构造成立（attempt 行先写、runner 后起），无测试钉住
- Runtime resume 创建新 PID，保留同一 Session/Attempt；
- Runtime API 不负责 Task policy resolution；
- Runtime API 使用 authenticated OperationContext，不信任 payload owner/Zone。

建议 surface：

```text
POST /v2/sessions
GET  /v2/sessions/{session_id}
POST /v2/runtime/start
POST /v2/runtime/resume
GET  /v2/runtime/runs/{pid}
POST /v2/runtime/runs/{pid}/cancel
```

### 4.3 ManagedAgent v1 兼容

当前：

```text
managed_agent.start_session_v1
```

返回的 `session_id` 实际是 legacy Runtime PID。

决策：

- v1 字段含义不原地改变；
- 新增 v2 method/endpoint；
- v1 adapter 将该值内部标记为 `legacy_runtime_id`；
- 新 consumer 不得把 v1 `session_id` 持久化为 canonical Session； `[enforced_by: none]`
- v1 仅在兼容窗口继续支持。

---

## 5. 权威 Writer 与 Reader

| 对象 | 权威 writer | SSOT | Reader/Projection |
|---|---|---|---|
| Agent principal/name | Agent Registry | Nexus | Moss/SudoWork |
| Session | Session Service | Nexus SessionStore；Local 为 sudocode | Moss projection、SudoWork binding |
| Task | Task ingress | Nexus Session TaskStore | Moss/SudoWork/sudocode |
| Attempt | Task Orchestrator | Nexus TaskStore | Runtime/UI/Verify |
| PID/FSM | Managed Runtime | Nexus AgentRegistry + `/proc` | Moss/SudoWork |
| Runtime locator | Runtime backend/supervisor | RuntimeRun metadata | Operations/debugging |
| Conversation | SudoWork | SudoWork Overlay/Index | Renderer |

---

## 6. 持久路径

Zone-scoped VFS：

```text
/sessions/{sid}/
  session.json
  transcript.jsonl
  tasks/{task-id}/
    spec.json
    attempts/{attempt-id}/
      attempt.json
      runtime-runs/{pid}.json
```

Runtime view：

```text
/proc/{pid}/session  -> /sessions/{sid}
/proc/{pid}/task     -> /sessions/{sid}/tasks/{task-id}
/proc/{pid}/attempt  -> /sessions/{sid}/tasks/{task-id}/attempts/{attempt-id}
/proc/{pid}/agent    -> /agents/{name}/versions/{version}
/proc/{pid}/workspace/
```

规则：

- `/proc` 只保存运行态和 link；
- PID teardown 删除 `/proc/{pid}`；
- link target 不随 PID teardown 删除；
- Session delete 必须检查 retention/ownership 并独立执行； `[enforced_by: none]` —— **根本没有 `DELETE /api/v1/sessions/:id` 这条路由**；channels 侧带 org/user（`server.ts:2856`），retention 无
- DT_LINK follow 重新进行目标授权。

---

## 7. 生命周期

### 7.1 正常执行

```text
Session created
  -> Task created
  -> Resolution accepted
  -> Attempt created
  -> PID registered
  -> PID warming_up/ready/busy
  -> Attempt completed
  -> PID terminated/reaped
  -> Session remains active
```

### 7.2 基础设施恢复

```text
Attempt running on pid_1
  -> pid_1 lost/terminated
  -> Attempt remains running/recovering
  -> pid_2 created
  -> session/load(session-id)
  -> Attempt continues
```

### 7.3 业务 retry

```text
Attempt 1 failed/Verify rejected
  -> policy/user requests retry
  -> Attempt 2 created
  -> pid_3 created
```

### 7.4 Session archive/delete

- Archive：禁止新 Task/Attempt，保留查询和导出； `[enforced_by: none]` —— moss 没有 session archive 概念
- Delete：权限检查、retention、tombstone、artifact/memory policy 后执行；
- cancel PID/Attempt 不等于 archive/delete Session。

---

## 8. 安全边界

- ID 不是权限凭据；
- 知道 Session/PID/Task ID 不授予读取能力；
- 所有 get/resume/cancel 通过 authenticated principal + Zone/ReBAC；
- payload 中的 owner/Zone/Agent 只作交叉校验；
- PID 不包含主机或用户敏感信息；
- RuntimeLocator 只向有运维权限的 caller 返回；
- Session owner、home Zone 不从 workspace path 推断；
- cross-Zone Session resource 引用由 ADR-002 约束。

---

## 9. 兼容与迁移

### 9.1 SudoWork

当前：

- conversation ID；
- `acpSessionId`；
- `mossSessionId`。

迁移：

- 增加版本化 SessionBinding；
- legacy 字段懒迁移；
- runtime disconnect 只清 PID，不清 Session；
- v1 tunnel ID 不再被当作 Session。

### 9.2 Moss

当前 `sessions.session_id` 已是稳定 UUID，可作为 legacy import candidate。

迁移：

- 新 Session 由 Nexus Session Service 创建或确认导入；
- legacy Session ID 可原值导入，避免破坏 API；
- `transcript_session_id` 收敛到 canonical Session；
- 当前 `session_attempts` 标记为 legacy runtime runs；
- 新增 policy Attempt 与 RuntimeRun 的分层；
- Moss 表先双写，再成为 projection。

### 9.3 sudocode

迁移：

- `Session::new_with_id()`；
- ACP `session/new` 可接收 canonical Session ID；
- 未传时保持 standalone 自生成；
- co-host 使用 KernelFsBackend 持久 SessionStore；
- resume 按 canonical ID load。

### 9.4 Nexus/nexus-vfs

迁移：

- 新增 Session Service 与 ManagedAgent v2；
- v1 保持；
- AgentDescriptor 增加 durable refs；
- PID 编码迁移保留 legacy decode；
- Runtime locator 单独存储；
- `/proc` link 增量创建。

---

## 10. 被拒绝的方案

### 10.1 `session-id = pid`

拒绝。进程退出、Pod 重建、版本升级会摧毁持久 Session 语义。

### 10.2 `pid = OS PID`

拒绝作为产品级跨仓语义。无法统一 co-host、Kubernetes、跨节点和 PID reuse；OS PID 保留在 RuntimeLocator。

### 10.3 `Attempt = PID`

拒绝。无法区分业务 retry 和基础设施 restart。

### 10.4 `Task = Conversation`

拒绝。一个 Session/Conversation 可包含多个 Task，Task 也可由 Cron/API/IM 创建而没有传统聊天 UI。

### 10.5 让每个客户端自己生成全部 ID

拒绝。authority 不清晰且容易冲突。Session/Task/Attempt/PID 分别由其权威服务创建；迁移 import 可以接受既有 ID，但必须经过权威服务校验登记。 `[enforced_by: none]` —— 迁移 import 的「经权威服务校验登记」无实现

### 10.6 在 v1 原地改变 `session_id` 含义

拒绝。字段名相同但含义改变会造成静默数据损坏；必须发布 v2。 `[enforced_by: none]` —— 属 ADR-005 范围

---

## 11. 后果

### 正面

- Session resume、Pod 重建和 HA 有稳定语义；
- Task retry 与进程恢复可审计；
- UI、控制面、Runtime 和 kernel 生命周期解耦；
- Agent version、Tool、Verify 和 Event 可稳定关联；
- 不同 runtime backend 可共享 API；
- 为后训练轨迹和计费归因提供稳定 key。

### 成本

- 引入更多 ID 和显式映射；
- 需要 v1/v2 兼容期；
- Moss 当前 attempt 数据需迁移；
- SudoWork conversation binding 需版本化；
- sudocode 需接受外部 Session ID；
- 运维调试必须从 PID 查 RuntimeLocator，不能直接假设 PID 是 OS number。 `[enforced_by: none]` —— **与现状冲突**：moss 的 `reconcileOnStartup` 直接 `process.kill(runnerPid, 0)`（`runtimeService.ts:936`、`:995`）——拿它当 OS number 用

---

## 12. 验收标准

1. TS/Rust common fixtures 对所有 ID 正反例一致；
2. `start_runtime_v2` 同时返回 `session_id` 与 `pid`；
3. pid1 退出后 Session/Task/Attempt 仍可查询；
4. 用同一 Session/Attempt 创建 pid2，可读取原 transcript/tool results；
5. 业务 retry 创建新 Attempt；
6. rejected Task 不创建 Attempt/PID；
7. `/proc/{pid}` 只在 PID 存活期存在；
8. v1 consumer 仍工作，但不会被新代码误认作 canonical Session；
9. raw subprocess、co-host、K8s 三种 locator 均可表达；
10. 未授权主体无法因知道 ID 而 get/resume/cancel。

---

## 13. 开放实现选择

以下不影响本 ADR 的语义，可在实现计划中决定：

- ID 具体使用 UUIDv7、ULID 或其他算法；
- Session metadata 使用 typed document、SQL projection 或二者组合；
- RuntimeRun 历史是单独文件还是 append-only Event projection；
- K8s backend 何时从 Moss 移到 Nexus；迁移期必须保持 Nexus PID/FSM SSOT。 `[enforced_by: none]` —— FSM 今天在 moss

---

## 14. 生效与替代

本 ADR 被接受后：

- 新跨仓代码 MUST 使用本 ADR 的 ID 语义； `[enforced_by: none]`
- `managed_agent.start_session_v1.session_id` 被标记为 legacy misnomer；
- `agent_pid.rs` 的“产品 PID 等于 OS PID”决策被本 ADR 替代；
- 任何例外必须另写 ADR，不能在单仓 PR 中重新定义 Session/PID。 `[enforced_by: none]` —— 流程条款，机器无从校验
