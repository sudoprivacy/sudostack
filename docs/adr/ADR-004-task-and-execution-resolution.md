# ADR-004：Task、Execution Resolution 与 Attempt 生命周期

- 状态：Accepted
- 日期：2026-09-22
- 决策范围：SudoWork、Moss、Nexus、sudocode、SudoEvolve
- 目标契约版本：`task.sudo.dev/v1`
- 相关文档：
  - [`Sudo 跨仓语义与六契约设计`](../design/cross-repo-contracts-semantics-design-v1.0.md)
  - [`ADR-001：标识及生命周期`](./ADR-001-identifiers-and-lifecycle.md)
  - [`ADR-002：Zone 与多租户`](./ADR-002-zone-and-tenancy-model.md)
  - [`ADR-003：Agent Principal 与 Version`](./ADR-003-agent-principal-and-versioning.md)
  - [`ADR-005：契约版本与兼容`](./ADR-005-product-contract-versioning.md)

---

## 1. 背景

Sudo 当前可以从多种入口启动 Agent：

- SudoWork interactive chat；
- Team task；
- Cron；
- Event Trigger/Webhook；
- IM channel；
- Moss API；
- sudocode CLI/ACP；
- Agent-to-Agent mailbox；
- Nexus generic task queue。

这些入口当前分别使用 conversation、session、prompt、cron run、event trigger run、TeamTask、TaskPacket、TaskRecord 等对象，没有统一表达：

> 谁要求哪个 Agent，在什么数据和能力约束下，完成什么工作，并产生什么可验收结果。

当前源码中至少存在三种名称容易与产品 Task 混淆的对象：

1. [`nexus/rust/services/src/tasks/task.rs`](https://github.com/nexi-lab/nexus/blob/dd707c0cc453514b88b53afc2b6e0edb64ab2345/rust/services/src/tasks/task.rs) 的 `TaskRecord`：通用持久工作队列，字段为 `task_type/params/priority/lease/retry`；
2. [`sudocode/rust/crates/runtime/src/task_packet.rs`](https://github.com/sudoprivacy/sudocode/blob/c004e8bb0158e442e3f5316baa3086f5ab39115a/rust/crates/runtime/src/task_packet.rs) 的 `TaskPacket`：coding-agent 内部的 objective/repo/branch/acceptance packet；
3. Moss `sessions` 与 `session_attempts`：当前将用户会话、Runtime generation、process/container state 混合在一起。

它们都可复用部分机制，但都不是跨产品 TaskSpec。

如果不冻结 Task/Resolution：

- UI 会继续以 Session/Conversation 代替 Task；
- Moss 无法稳定解释 Local/Cloud/Private 的选择；
- rejected 请求可能完全丢失，无法审计；
- runtime connection failure 可能被错误当成 policy rejection；
- fallback 可能绕过数据域政策；
- retry、resume、PID restart 混为一件事；
- Verify 不知道应该验收哪个工作单元；
- Cron、IM、Team 会各自再造一套执行对象。

---

## 2. 决策

### 2.1 Task 的定义

> Task 是用户或系统要求完成的一项、具有明确输入、约束和预期输出的工作单元。

Task：

- 不等于 Conversation；
- 不等于 Session；
- 不等于一条普通消息；
- 不等于 PID；
- 不等于队列内部 Job；
- 不等于 VerifyResult。

一个 Session 可以包含多个 Task。没有传统聊天 UI 的 Cron/API/IM 请求仍创建 Task；v1 中每个 Task 必须属于一个 Session，一次性任务创建一个最小 Session。 `[enforced_by: none]`

### 2.2 Task 边界

以下情况创建新 Task：

- 用户提交一个新的工作目标；
- Cron 每次触发；
- Event Trigger/Webhook 每次触发；
- Team 创建新的工作项；
- 用户在已有 Session 中提出与前一任务独立的新目标；
- 用户对完成结果提出实质性新修改，导致输入/输出契约变化；
- 系统拆出的可独立验收子任务。

以下情况不创建新 Task：

- Agent 在当前 Task 中提出问题，用户回答；
- 用户批准/拒绝一个 Tool confirmation；
- 用户在当前 Attempt 中提供缺失参数；
- transport reconnect；
- PID/Pod 重建；
- 同一 Task 的 policy retry；
- Verify 触发同一 Task 的新 Attempt。

当前 Task 中的回答、批准和补充输入作为 Task input event/record，不能静默覆盖初始 TaskSpec。

如果补充改变了工作目标、数据范围或输出契约，应创建新 Task，并使用：

```text
supersedes_task_id
parent_task_id
```

建立关系。

### 2.3 TaskSpec 是不可变工作声明

TaskSpec 在创建后不可原地修改。它描述：

- requester/actor；
- Agent request；
- instruction/input；
- resource/workspace refs；
- requested execution mode；
- data classification；
- required capabilities；
- deadline/budget/idempotency；
- expected output schema/rubric。

Task 状态不写回 TaskSpec；状态来自 Resolution、Attempt、Runtime、Verify 和 Event。

### 2.4 TaskSpec v1

```ts
interface TaskSpec {
  api_version: 'task.sudo.dev/v1'
  kind: 'TaskSpec'

  task_id: string
  session_id: string
  created_at: string

  requested_by: PrincipalRef
  request_source:
    | 'interactive'
    | 'cron'
    | 'event_trigger'
    | 'channel'
    | 'team'
    | 'api'
    | 'agent'

  agent: {
    principal: AgentPrincipalRef
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
    max_attempts?: number
    idempotency_key?: string
  }

  output_contract?: {
    schema_ref?: ResourceRef
    artifact_types?: string[]
    rubric_ref?: ResourceRef
  }

  parent_task_id?: string
  supersedes_task_id?: string
}
```

规则：

- Secret value 禁止进入 TaskSpec； `[enforced_by: none]`
- 大输入使用 ResourceRef；
- resource/workspace 必须带 Zone； `[enforced_by: none]`
- v1 中 Task 的 Agent Principal 必须与所属 Session 的 `agent_principal` 一致；切换 Principal 创建新 Session或显式 handoff； `[enforced_by: none]`
- Task 可以请求该 Principal 的 version/channel，Resolution 将其解析为 Attempt 使用的 exact AgentVersion；
- `requested_mode` 是请求，不是最终 Runtime 决策；
- Agent channel 必须在 Resolution 阶段解析为 exact version； `[enforced_by: none]`
- expected output 可以为空，但正式自动化任务 SHOULD 提供 schema/rubric； `[enforced_by: none]`
- idempotency key 由 ingress scope 解释，不作为 task_id。

### 2.5 TaskExecutionResolution

Resolution 是 Moss/Local Policy Resolver 对 TaskSpec 的不可变决策记录。

```ts
type TaskExecutionResolution =
  | {
      api_version: 'task.sudo.dev/v1'
      kind: 'TaskExecutionResolution'

      resolution_id: string
      task_id: string
      status: 'accepted'

      attempt_id: string
      resolved_runtime: 'sudolocal' | 'sudocloud' | 'sudoprivate'
      resolution_mode: 'default' | 'policy_routed' | 'fallback'

      execution_zone_id: string
      agent: AgentVersionRef

      reason_code: string
      reason: string
      policy_version: string
      policy_snapshot_ref?: ResourceRef
      decided_at: string
    }
  | {
      api_version: 'task.sudo.dev/v1'
      kind: 'TaskExecutionResolution'

      resolution_id: string
      task_id: string
      status: 'rejected'

      reason_code: string
      reason: string
      policy_version: string
      policy_snapshot_ref?: ResourceRef
      decided_at: string
    }
```

accepted Resolution 与 Attempt 原子关联；rejected Resolution 不创建 Attempt/PID。

### 2.6 Resolution 检查顺序

Moss/Local resolver 至少按以下逻辑评估：

```text
1. requester identity 与 Session ownership
2. Agent principal/version/channel 可解析
3. Agent version approval/revocation
4. required capabilities
5. resource/Zone grants
6. data classification/egress policy
7. local-only resource requirements
8. requested mode 与组织 policy
9. runtime capability/availability
10. deadline/budget/approval
```

顺序可以优化，但输出必须记录参与决策的 policy version/snapshot。 `[enforced_by: none]`

### 2.7 accepted/rejected 原则

Policy rejection 与 execution failure 必须分开： `[enforced_by: none]`

- 无权限、数据域不允许、需要审批、Agent version revoked、capability 不可用：rejected；
- accepted 后网络失败、Pod 创建失败、模型失败、Tool 失败：Attempt failed；
- Resolver 自身不可用或 policy 无法读取：fail-closed，返回明确 system decision error，不启动 PID；
- rejected Task 仍可查询和审计；
- interactive rejected Task 仍向 Canonical Transcript 追加用户原文和 rejection fact，保证 Conversation 可重建；
- rejected Task 不创建 Attempt、PID 或 assistant execution output；TaskSpec/Resolution 必须持久化； `[enforced_by: none]`
- non-interactive rejected Task 至少持久化 TaskSpec/Resolution，是否生成用户可见 Transcript record 由入口 profile 决定。

### 2.8 reason code

reason code 使用 ADR-005 定义的开放 registry。首批 known codes：

```text
LOCAL_RESOURCE_REQUIRED
DATA_DOMAIN_FORBIDDEN
APPROVAL_REQUIRED
CAPABILITY_UNAVAILABLE
AGENT_NOT_FOUND
AGENT_VERSION_NOT_FOUND
AGENT_VERSION_REVOKED
AGENT_VERSION_NOT_APPROVED
ZONE_ACCESS_DENIED
CROSS_ZONE_ACCESS_DENIED
RUNTIME_UNAVAILABLE
DEADLINE_EXPIRED
BUDGET_EXCEEDED
POLICY_UNAVAILABLE
INVALID_TASK_SPEC
```

consumer 必须处理 unknown code，并使用 `status + code`，不能只解析 human-readable reason。 `[enforced_by: none]`

### 2.9 Runtime resolution 与 fallback

规则：

- fallback 是重新执行 policy evaluation，不是 catch connection error 后换目标；
- Private/Core data 不因 Cloud 可用自动 fallback；
- local-only file/browser/credential 任务不得静默上传； `[enforced_by: none]`
- fallback Resolution 创建新的 resolution record；
- 如果 fallback 改变 Agent version、execution Zone、data egress 或 requested constraints，创建新 Attempt；
- infrastructure 在同一已接受 target 内换节点/PID不算 policy fallback；
- UI 必须能展示 resolved runtime 和 reason。 `[enforced_by: none]`

### 2.10 Attempt

Attempt 是一次完整业务/策略执行尝试：

```ts
interface TaskAttempt {
  api_version: 'task.sudo.dev/v1'
  kind: 'TaskAttempt'

  attempt_id: string
  task_id: string
  session_id: string
  resolution_id: string

  agent: AgentVersionRef
  execution_zone_id: string
  state:
    | 'queued'
    | 'starting'
    | 'running'
    | 'awaiting_input'
    | 'output_ready'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'cancelled'

  pid_history: string[]
  output_refs: ResourceRef[]
  evidence_refs: ResourceRef[]
  verify_result_ref?: ResourceRef

  created_at: string
  started_at?: string
  ended_at?: string
  failure?: ErrorInfo
}
```

Attempt：

- 可跨多个 PID 恢复；
- 使用一个固定 AgentVersion/Resolution；
- output ready 不等于 completed；
- 需要 Verify 的 Task 在 accepted VerifyResult 后才 completed；
- infrastructure restart 追加 PID history；
- policy/user retry 创建新 Attempt；
- PID FSM 不写进 Attempt `state` 字段冒充业务状态。

### 2.11 Task 状态是投影

TaskStatus 不作为 TaskSpec 的可变字段。它由记录投影：

```text
submitted
resolution_rejected
accepted
running
awaiting_input
output_ready
verifying
completed
failed
cancelled
```

相同 Task 可能：

- Attempt 1 failed；
- Attempt 2 verifying；
- 因此 Task projection 为 `verifying`。

Task status projection 可重建；TaskSpec/Resolution/Attempt history 不覆盖。

### 2.12 Cancel

取消层级：

```text
cancel turn       当前模型/工具回合
cancel pid        当前 Runtime 实例
cancel attempt    当前业务尝试，禁止自动创建替代 PID
cancel task       当前及后续 Attempt，Task 进入 cancelled
archive session   禁止新 Task，保留查询
```

API 必须明确层级，不能继续用一个 `cancel` bool 混合。 `[enforced_by: none]`

### 2.13 Retry

Retry request 必须包含： `[enforced_by: none]`

```ts
interface TaskRetryRequest {
  task_id: string
  source_attempt_id?: string
  requested_by: PrincipalRef
  reason: string
  agent_override?: {
    version?: string
    channel?: string
  }
  requested_mode_override?: string
}
```

规则：

- retry 创建新 Resolution/Attempt；
- 原 TaskSpec 不修改；
- 输入变化应创建 superseding Task，不用 retry 偷改输入；
- Tool side effect 通过 idempotency/evidence 判断是否可重放；
- max attempts 来自 Task constraints/policy；
- retry 必须使用当前有效 delegation/policy，不复用过期 token。 `[enforced_by: none]`

### 2.14 Idempotency

Task creation：

- ingress 可传 idempotency key；
- scope 至少包含 requester + source + Session；
- 重复请求返回同一 Task，不创建第二个；
- key/value mapping 有 TTL/retention；
- body 语义不同但 key 相同返回 conflict。

Runtime start：

- attempt_id + start operation idempotent；
- 重复 start 不创建第二 PID，除非明确 resume/replace；
- external side-effect Tool retry 由 Tool Contract 管理。

---

## 3. 权威 Writer、SSOT 与 Reader

| 对象 | 权威 writer | 持久 SSOT | Reader/Projection |
|---|---|---|---|
| TaskSpec（Cloud/Private） | Moss Task ingress | Nexus Session TaskStore | SudoWork、sudocode、SudoEvolve、Moss projection |
| TaskSpec（Local） | SudoWork local host/sudocode ingress | sudocode local SessionStore | SudoWork |
| Resolution（Cloud/Private） | Moss Policy Resolver | Nexus Task record + Moss audit projection | Runtime、UI、Verify |
| Resolution（Local） | Local resolver | local SessionStore | SudoWork/sudocode |
| Attempt | Moss Orchestrator/Local orchestrator | Nexus/local TaskStore | Runtime、UI、Verify |
| PID/FSM | Nexus Managed Runtime | Nexus AgentRegistry + `/proc` | Moss/UI |
| Task status projection | Projection builder | 可重建 read model | UI/API |
| VerifyResult | Verifier/SudoEvolve | Nexus TaskStore | Moss projection/UI |

Nexus 是持久存储/安全 SSOT，不代表 Nexus 决定业务 policy；Moss 是 Resolution writer，不代表 Moss 独占 Session/Task 数据副本。

**P1b implicit-path amendment（SW-20260915-002）**：在尚未开放显式 Task ingress 的 P1b 阶段，Nexus Session Runtime Service 作为 Session Service 的一部分，是 implicit TaskSpec、TaskExecutionResolution 与 TaskAttempt 的授权 writer；显式 Task ingress 与 Moss Policy Resolver 的通用 writer 职责保留给后续 Task 产品化。 `[enforced_by: none]`

---

## 4. 持久路径

Zone-scoped：

```text
/sessions/{sid}/tasks/{task-id}/
  spec.json
  resolutions/
    {resolution-id}.json
  attempts/
    {attempt-id}/
      attempt.json
      inputs/
      context/
      runtime-runs/
      artifacts/
      evidence/
      verify/
```

Runtime links 由 ADR-001 定义：

```text
/proc/{pid}/task
/proc/{pid}/attempt
```

规则：

- TaskSpec write-once；
- Resolution append-only；
- Attempt state 可由 event/projection更新，但历史转换不可丢；
- Artifact/Evidence 使用 ResourceRef；
- rejected Task 仍有 spec/resolution 目录；
- PID cleanup 不删除 Task/Attempt。

---

## 5. API 决策

### 5.1 Moss Task API

```text
POST /api/v1/tasks
GET  /api/v1/tasks/{task_id}
GET  /api/v1/tasks/{task_id}/attempts
POST /api/v1/tasks/{task_id}/cancel
POST /api/v1/tasks/{task_id}/retry
GET  /api/v1/tasks/{task_id}/events
```

`POST /tasks` 返回：

- TaskSpec accepted + Resolution；
- TaskSpec rejected + Resolution；
- validation/system error。

accepted 不保证 PID 已启动；启动状态通过 Attempt/Event 查询。

### 5.2 Internal persistence/runtime API

```text
POST /v2/sessions/{sid}/tasks
POST /v2/sessions/{sid}/tasks/{task_id}/resolutions
POST /v2/sessions/{sid}/tasks/{task_id}/attempts
POST /v2/runtime/start
```

只有 Moss/Local orchestrator 等授权 writer 可创建对应 record。Nexus API 不重新执行 Moss business policy，但验证 schema、identity、Zone、writer authority 和引用一致性。

**P1b implicit-path amendment（SW-20260915-002）**：Nexus Session Runtime Service 可以在已认证、已授权的 runtime start/resume 内部创建 implicit TaskSpec、TaskExecutionResolution 与 TaskAttempt；该授权不新增公开 Task 写入 API，也不把 Nexus 扩展为显式 Task 的业务 policy owner。 `[enforced_by: none]`

### 5.3 sudocode execution boundary

sudocode 接收：

```ts
interface ExecutionStart {
  task_ref: ResourceRef
  attempt_ref: ResourceRef
  session_id: string
  task_id: string
  attempt_id: string
  pid: string
  agent: AgentVersionRef
  context_request_ref?: ResourceRef
}
```

sudocode：

- 不决定 Cloud/Private；
- 不重新解析 stable/latest；
- 不改变 TaskSpec；
- 校验输入 refs；
- 执行并产生 output/evidence；
- 上报状态/Event；
- 不自行宣布 Verify accepted。

---

## 6. 安全边界

- TaskSpec `requested_by` 必须与 authenticated context/委派一致； `[enforced_by: none]`
- Task 中的 `zone_id`/ResourceRef 不授予权限；
- Resolution 必须经过 policy writer 签名/身份验证； `[enforced_by: none]`
- rejected Task 不创建 PID；
- Agent version、Zone、delegation 在 runtime start 再次验证；
- Task/Attempt/PID access 按 owner/Org/Zone/ReBAC；
- Task input 不包含 Secret value；
- policy snapshot 和 reason 不回显敏感内部规则；
- Local resource 不静默发往 Cloud；
- fallback 不绕过 data classification；
- cancellation/retry 操作者必须有 Task relation； `[enforced_by: none]`
- Task ID 不是授权凭据。

---

## 7. 兼容与迁移

### 7.1 Moss Session API

当前交互入口以 Session 为中心。迁移：

1. 保留 Session create/resume API；
2. 建立统一 TaskIngress；
3. 每个会触发 Agent 工作的请求创建 TaskSpec；
4. Session API 可在兼容期内部创建 implicit Task；
5. response 增加 task/attempt refs；
6. 新 UI 切到 Task API；
7. Session 只负责连续上下文，不再承担工作单元全部语义。

### 7.2 Moss `session_attempts`

当前更接近 RuntimeRun。迁移：

- 标记为 legacy runtime generation；
- 增加/新建 policy `task_attempts`；
- legacy session 可生成一个 implicit Task/Attempt；
- current generation rows 映射 PID history；
- HA orphan adoption 在同一 Task Attempt 下创建新 RuntimeRun/PID；
- 旧表先保留 projection，禁止直接重命名后宣称完成。 `[enforced_by: none]`

### 7.3 Nexus generic Task queue

- 更名/文档化为 `QueueTaskRecord` 或内部 queue task；
- 可作为异步运行基础，但不成为 Product TaskSpec SSOT；
- queue `attempt` counter 不等于 product `attempt_id`；
- queue params 可携带 Task/Attempt refs；
- lease/retry 只解决 worker queue delivery，不决定业务 retry。

### 7.4 sudocode TaskPacket

- 更名/文档化为 `CodingTaskPacket`；
- 可成为 TaskSpec input extension 或子任务 payload；
- 不扩展成全产品 TaskSpec；
- acceptance_tests 可映射 output/rubric refs，但原结构保留内部用途。

### 7.5 SudoWork

入口迁移：

- interactive chat -> Task ingress；
- TeamTask -> TaskSpec adapter；
- Cron fire -> 每次一个 Task；
- IM/channel -> Task ingress；
- permission/question answer -> 当前 Task input event；
- Conversation 保存 current task/attempt binding；
- UI 展示 rejected reason/resolved runtime/attempt history。

### 7.6 历史数据

- 现有 Moss Session 导入为 Session；
- 至少生成一个 `legacy_import` Task；
- 已知 runtime generation 映射 RuntimeRun/PID history；
- 无法重建 policy Resolution 时标记 `legacy_unresolved`，不伪造；
- historical transcript 保留；
- migration output 提供数量、失败、冲突、回滚记录。

---

## 8. 被拒绝的方案

### 8.1 Task 等于 Session

拒绝。Session 是连续上下文，可包含多个 Task；Cron/API Task 也可能只使用最小 Session。

### 8.2 Task 等于用户消息

拒绝。回答 Agent 问题、批准 Tool、补充参数属于同一 Task；不是每条消息都创建新 Task。

### 8.3 TaskSpec 原地修改

拒绝。无法审计原始要求和 retry 差异；实质变化创建 superseding Task。

### 8.4 rejected Task 不保存

拒绝。会丢失 policy、审批、产品分析和审计事实。

### 8.5 连接失败自动 fallback Cloud

拒绝。技术故障不能替代 data/policy evaluation。

### 8.6 复用 Nexus Queue TaskRecord 作为 Product TaskSpec

拒绝。它是执行队列内部记录，生命周期、字段和 authority 不同。

### 8.7 复用 sudocode TaskPacket 作为 Product TaskSpec

拒绝。它是 coding workflow packet，缺少 identity、Zone、runtime resolution、classification 等产品语义。

### 8.8 Attempt 等于每次 PID generation

拒绝。基础设施恢复与业务 retry 必须可区分。 `[enforced_by: none]`

### 8.9 Runtime 完成即 Task completed

拒绝。需要 Verify 的任务必须在 Verify accepted 后完成。 `[enforced_by: none]`

---

## 9. 后果

### 正面

- 所有任务入口统一；
- Local/Cloud/Private 路由可解释、可审计；
- rejected、retry、resume、restart 分离；
- Verify 有稳定工作单元；
- UI 与 Runtime 解耦；
- Task 数据可用于质量分析和后训练；
- 更换 queue/runtime 不改变产品 API。

### 成本

- 增加 Task/Resolution/Attempt 数据模型；
- Moss Session API 需要兼容 adapter；
- SudoWork UI 增加 Task binding；
- 现有 `session_attempts` 需重新解释/迁移；
- Cron/Team/IM 需逐个接入统一 ingress；
- policy resolver 与 reason registry 需要维护。

---

## 10. 验收标准

1. interactive、Cron、IM 至少各一个入口生成同一 TaskSpec；
2. TaskSpec 创建后不可原地修改；
3. accepted/rejected 使用 discriminated union；
4. rejected Task 可查询且不创建 Attempt/PID；
5. Resolution 记录 policy version/reason；
6. Agent channel 被解析为 exact version/digest；
7. Private/Core Task 不自动 fallback Cloud；
8. 同一 Task retry 创建新 Attempt；
9. PID restart 保持同一 Attempt；
10. Runtime completed 与 Verify accepted 可区分；
11. cancel turn/PID/Attempt/Task/Session 层级明确；
12. Nexus Queue TaskRecord 与 Product TaskSpec 不混用；
13. sudocode TaskPacket 与 Product TaskSpec 不混用；
14. Task 创建 idempotency 可验证；
15. 从 Task 可追踪 Session/Resolution/Attempt/PID/Output/Verify refs。

---

## 11. 开放实现选择

以下不改变本 ADR 语义：

- Task status projection 使用 SQL、Event stream 或组合；
- Task ID 具体生成算法；
- TaskSpec 的 extension mechanism；
- policy engine 的实现语言/规则系统；
- Nexus generic queue 是否承载第一版 asynchronous Attempt；
- 一个复杂用户请求是否由 orchestrator 拆成父子 Task，由上层产品 policy 决定。

---

## 12. 生效与替代

本 ADR 被接受后：

- 新 Agent 工作入口 MUST 产生 Product TaskSpec 或明确 legacy adapter； `[enforced_by: none]`
- Nexus `TaskRecord` 与 sudocode `TaskPacket` 不得再被文档称为全局 Task Contract； `[enforced_by: none]`
- rejected 请求必须持久化； `[enforced_by: none]`
- fallback 必须重新 policy evaluation； `[enforced_by: none]`
- 业务 retry 与 PID restart 必须使用不同生命周期； `[enforced_by: none]`
- TaskSpec 的 breaking semantic change 遵循 ADR-005。
