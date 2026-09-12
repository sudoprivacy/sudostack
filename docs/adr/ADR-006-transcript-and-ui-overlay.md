# ADR-006：Canonical Transcript、UI Overlay 与 Conversation 重建

- 状态：Proposed
- 日期：2026-09-12
- 决策范围：SudoWork Desktop/WebUI、Moss、sudocode、Nexus SessionStore
- 目标契约版本：`transcript.sudo.dev/v1`、`overlay.sudo.dev/v1`
- 相关文档：
  - [`Sudo 跨仓语义与六契约设计`](../design/cross-repo-contracts-semantics-design-v1.0.md)
  - [`ADR-001：标识及生命周期`](./ADR-001-identifiers-and-lifecycle.md)
  - [`ADR-002：Zone 与多租户`](./ADR-002-zone-and-tenancy-model.md)
  - [`ADR-003：Agent Principal 与 Version`](./ADR-003-agent-principal-and-versioning.md)
  - [`ADR-004：Task 与 Resolution`](./ADR-004-task-and-execution-resolution.md)
  - [`ADR-005：契约版本与兼容`](./ADR-005-product-contract-versioning.md)

---

## 1. 背景

目标架构要求 Session/Transcript 成为跨客户端、跨进程、跨 PID 可恢复的事实源，但 SudoWork 当前本地 messages 并不是简单的 transcript 副本。

当前数据来源包括：

### SudoWork SQLite

[`sudowork/apps/desktop/src/process/database/schema.ts`](https://github.com/sudoprivacy/sudowork/blob/9f7a5fca1e6cc114d02b26af76f791d449f40779/apps/desktop/src/process/database/schema.ts) 保存：

- conversations；
- messages；
- position/status；
- conversation extra；
- `acpSessionId`、`mossSessionId` 等 binding；
- 本地 backend 历史。

消息可能包含：

- 用户原始输入；
- assistant 内容；
- 工具调用的完整 UI 展示；
- tips/status；
- Artifact/delivery marker；
- 非 sudocode backend 消息；
- UI 特有状态。

### sudocode Session transcript

sudocode 已有：

```text
<session-root>/<session-id>/transcript.jsonl
<session-root>/<session-id>/tool-results/
```

并支持 compaction、resume 和 oversized tool-result offload。但 transcript 主要服务模型恢复，不一定包含 UI 所需的全部原始/展示信息。

### Moss transcript/session state

Moss 当前另写 transcript，并保存：

- `session_id`；
- `transcript_session_id`；
- runtime events；
- 用户原文/displayText；
- ACP session mapping。

部分历史事件仍使用 `version: "unknown"`，且 Moss、sudocode、SudoWork 都可能保存同一 turn 的不同表示。

### WebUI local metadata

SudoWork WebUI 还维护：

- conversation title/pinned；
- writer lock；
- browser session；
- transport-specific metadata。

如果简单删除 SudoWork messages 或直接将 scode transcript 设为唯一读取源，可能导致：

- 用户原始输入丢失；
- compaction 前历史不可展示；
- Tool diff/position 等 UI 信息丢失；
- Artifact/delivery/tips/status 丢失；
- non-scode backend 历史不可读；
- Conversation 与 Session binding 错位；
- Desktop/WebUI 渲染不一致；
- 本地离线数据被误上传；
- UI 私有状态进入 Agent Context。

---

## 2. 决策

### 2.1 数据分为三层

```text
A. Canonical Transcript  跨客户端恢复的事实
B. UI Overlay            仅影响界面展示的状态
C. Local Index           本地对象到远端对象的引用/同步状态
```

三者必须有独立 schema、writer 和 lifecycle。

### 2.2 Canonical Transcript

Canonical Transcript 保存“实际发生过什么”，包括：

- 用户原始输入；
- assistant 最终输出和 partial 状态；
- ToolInvocation/ToolResult；
- permission/question request 与 answer；
- cancel/error；
- Artifact/Evidence refs；
- Agent principal/version/digest；
- Session/Task/Attempt/PID；
- ContextManifest ref；
- Verify ref；
- authoritative actor/server timestamp；
- source/provenance。

Canonical Transcript MUST：

- 可跨 Desktop/WebUI/未来客户端读取；
- 在 PID 退出后保留；
- append-only；
- 有 Session 内单调 sequence；
- 支持 at-least-once 去重；
- 支持大 payload offload；
- 不包含 UI collapse/tab/scroll 等状态；
- 不把 Secret 明文写入；
- 不因 context compaction 删除原始历史事实。

### 2.3 UI Overlay

UI Overlay 保存“用户如何查看这些事实”，包括：

- conversation title/pinned/order；
- draft；
- collapsed/expanded；
- selected tab/panel；
- scroll anchor；
- read position；
- local labels；
- display density/preference；
- temporary edit state；
- derived render cache；
- browser/window-local state。

Overlay：

- 不得作为 Agent/Model业务输入；
- 不得决定 Task/Attempt/PID事实；
- 可本地保存；
- MAY 按用户同步，但同步后仍是 SudoWork UI 数据；
- 可删除重建的 cache 不得混入不可重建用户状态；
- 需区分 user/device/window scope。

### 2.4 Local Index

Local Index 保存引用和同步信息，例如：

```text
conversation-id -> session-id
backend/transport
last-synced sequence
migration version
local-only flag
legacy acp/moss IDs
```

Local Index：

- 不是 Session SSOT；
- 不复制 transcript；
- 可以删除后通过账号/远端 Session 重新发现，但 local-only mapping 除外；
- 不保存长期 Secret；
- transport reconnect 不应改变 canonical Session ID。

### 2.5 一条 Conversation 对应一个连续 Session

新写入 SHOULD：

```text
Conversation 1 -> 1 Session
Session 1 -> N Task
```

说明：

- 用户在同一个 conversation 中连续工作时使用同一 Session；
- 新 Task 不要求新 Session；
- PID restart 不改变 Conversation/Session；
- 用户明确“新对话/清空上下文”时创建新 Session；
- 迁移期 legacy conversation 可能对应多个 scode session，Local Index 记录 mapping history，并在 backfill 时合并或保留 segment refs；
- non-scode backend 可以通过 adapter 写同一 transcript contract，无法支持时标记 legacy/local-only。

### 2.6 用户原始输入与模型输入分离

Canonical Transcript 中用户消息 MUST 保存用户实际提交的原文。

Moss/SudoWork/sudocode 注入的：

- Agent rules；
- Skill instructions；
- system prompt；
- memory；
- workspace context；
- cron preamble；
- `[User Request]` wrapper；

不应伪装成用户原文。

模型实际看到的内容通过 `ContextManifest` 和引用记录：

```text
Transcript user_message.original_content
ContextManifest resolved model input/resources/digests
```

必要时可保存：

```ts
model_input_ref?: ResourceRef
context_manifest_ref?: ResourceRef
```

但 UI 默认显示 original content。

### 2.7 Canonical record 而非一个不断覆盖的大 JSON

Transcript 使用 append-only record stream：

```ts
interface TranscriptRecord<T> {
  api_version: 'transcript.sudo.dev/v1'
  kind: 'TranscriptRecord'

  record_id: string
  record_type: string
  session_id: string
  task_id?: string
  attempt_id?: string
  pid?: string

  sequence: string
  occurred_at: string
  recorded_at: string

  actor?: PrincipalRef
  agent?: AgentVersionRef
  source: {
    service: string
    version: string
    transport?: string
  }

  payload?: T
  payload_ref?: ResourceRef
  context_manifest_ref?: ResourceRef
}
```

`sequence` 使用可表达 64-bit/更大整数的 decimal string，避免 JavaScript precision 问题。

record type 使用开放 registry，首批：

```text
user.message
task.resolution
assistant.message
assistant.partial
assistant.thinking_summary
tool.call
tool.result
permission.request
permission.decision
question.request
question.answer
turn.cancelled
runtime.error
artifact.created
evidence.created
context.manifest
verify.result
session.summary
```

### 2.8 Streaming delta 与最终消息

实时流和持久事实分开：

- live delta 通过 Event/WS 流向 UI；
- turn 正常完成后写一条 finalized assistant message；
- finalized record 引用相关 live event IDs 或 trace；
- process 中断时写/补一条 `assistant.partial`，标记 incomplete；
- UI reducer 可以先显示 delta，再被 finalized record确认；
- 重连后以 canonical finalized/partial record 为准；
- 不要求永久保存每个 token delta，除非 debug/trace policy 开启。

### 2.9 Tool 事实与 Tool 展示分离

Canonical Transcript 保存：

- Tool ID/version；
- input（或 ref）；
- status；
- output/result ref；
- error；
- evidence；
- timing/correlation。

UI 的：

- diff layout；
- position；
- 展开状态；
- syntax highlight cache；
- summary card；

属于 Overlay/derived rendering。

若历史展示需要 renderer version，应记录：

```text
render_schema_version
```

但不得将整个 HTML/UI tree 作为 canonical事实。无法重新生成的用户交付信息应成为 Artifact metadata，而不是 render cache。

### 2.10 Artifact 与 delivery

Artifact 是业务事实，不属于纯 UI Overlay。

Canonical record 至少保存：

```ts
interface ArtifactCreatedPayload {
  artifact_ref: ResourceRef
  artifact_type: string
  name: string
  digest?: string
  size_bytes?: number
  created_by: PrincipalRef
  delivery_status?: string
}
```

SudoWork 卡片的折叠/选中状态属于 Overlay；Artifact 本身和交付状态属于 canonical Task/Session事实。

### 2.11 Compaction 不删除事实

Context compaction 是模型输入管理，不是 Transcript 删除。

规则：

- compaction 创建 `ContextCompactionRecord`/`session.summary`；
- 记录 source sequence range、summary ref、method/model/version；
- 原始 canonical records 按 retention 保留；
- resume Context 可以使用 summary + recent records；
- UI 历史仍可读取原始记录；
- 合规删除例外必须产生 tombstone/audit，并同步处理 summary/vector indexes；
- 不允许用 summary 原地覆盖用户/assistant历史。

### 2.12 Writer 按事实类型分工，统一经 Transcript Service append

物理 append authority 为 Nexus Session Transcript Service（Local 为 sudocode SessionStore）。不同事实的业务 writer：

| Record | 业务 writer |
|---|---|
| user.message | Task ingress/Moss；Local 为 SudoWork host/sudocode ingress |
| task.resolution | Moss Policy Resolver；Local 为 Local resolver；interactive rejection 必须形成用户可见 fact |
| assistant.message/partial | sudocode/runtime |
| tool.call/result | sudocode ToolExecutor/Gateway |
| permission/question | runtime + human input ingress |
| runtime.error/cancel | runtime/control plane |
| artifact/evidence | runtime/control plane |
| context.manifest | sudocode |
| verify.result | SudoEvolve/verifier |

所有 writer 通过同一 append API：

- schema validation；
- actor authorization；
- sequence allocation；
- idempotency；
- Zone enforcement；
- size/offload；
- audit。

SudoWork 不直接改写远端 canonical record；编辑消息需要创建 correction/superseding record，不能覆盖历史。

### 2.13 Transcript 与 Event/Trace 的关系

- Transcript：用户/Agent 工作中可恢复的语义事实；
- Domain Event：驱动状态、通知和 projection；
- Trace：技术诊断；
- Audit：安全事实。

同一操作可产生相互引用的记录，但不要求四份完整 payload：

```text
TranscriptRecord record_id
EventEnvelope event_id -> transcript_record_ref
Trace span -> event_id/record_id
Audit -> actor/resource/record_id
```

Transcript 不替代 Event/Trace/Audit；Event 也不自动等于用户可见消息。

### 2.14 顺序、幂等与并发

- Session 内 sequence 由 Transcript Service 单调分配；
- 不保证跨 Session 全局顺序；
- producer 提供 `record_id` 或 idempotency key；
- delivery 至少一次，consumer 按 record_id 去重；
- `occurred_at` 是事实发生时间，`recorded_at` 是写入时间；
- sequence 是显示/重建主顺序，不能只按客户端时间排序；
- concurrent writers 使用 append API/consensus，不各自写本地 JSONL 后猜顺序；
- offline local records 在显式 import 时重新映射 remote sequence，但保留 original local ordering/provenance。

---

## 3. UI Overlay 数据模型

```ts
interface ConversationOverlay {
  api_version: 'overlay.sudo.dev/v1'
  kind: 'ConversationOverlay'

  overlay_id: string
  conversation_id: string
  session_id: string
  owner_user_id: string

  scope: 'user' | 'device' | 'window'
  device_id?: string
  window_id?: string

  title?: string
  pinned?: boolean
  pin_order?: string
  draft?: string
  selected_tab?: string
  read_sequence?: string
  scroll_anchor_record_id?: string

  message_state?: Record<
    string,
    {
      collapsed?: boolean
      local_label?: string
      display_mode?: string
    }
  >

  updated_at: string
  version: number
}
```

规则：

- draft 可能敏感，必须由用户可控并按 local/security policy 存储；
- overlay optimistic concurrency，避免多窗口互相覆盖；
- device/window fields 不强制跨设备同步；
- render cache 与不可重建 state 分开；
-删除 Overlay 不删除 Transcript；
- Overlay export 默认可选，不自动作为 Agent data export。

---

## 4. Local Index 数据模型

```ts
interface ConversationSessionBinding {
  api_version: 'overlay.sudo.dev/v1'
  kind: 'ConversationSessionBinding'

  conversation_id: string
  session_id: string
  backend: string
  transport: 'local_stdio' | 'nexus_grpc' | 'moss'

  last_synced_sequence?: string
  migration_state:
    | 'legacy'
    | 'dual_write'
    | 'shadow_verified'
    | 'canonical_primary'

  local_only: boolean
  legacy?: {
    acp_session_id?: string
    moss_session_id?: string
    runtime_id?: string
    transcript_paths?: string[]
  }

  created_at: string
  updated_at: string
}
```

Local Index 不保存 auth token。远端 credential 使用系统 credential store/reference，并与 Session binding 分离。

---

## 5. Conversation 重建

目标不变式：

```text
Canonical Transcript
+ UI Overlay
+ Local Index
+ Artifact/Tool definitions referenced by records
                ↓
       完整重建 Conversation UI
```

### 5.1 Rebuild pipeline

```text
1. Resolve conversation -> session binding
2. Page Transcript by sequence
3. Validate/deduplicate records
4. Reduce records into canonical message/tool/artifact view
5. Resolve authorized Artifact/Tool result refs
6. Apply Overlay by record_id
7. Rebuild local render cache
8. Continue from last_synced_sequence
```

### 5.2 Deterministic reducer

Reducer MUST：

- 相同输入产生相同 canonical view；
- 不依赖 wall-clock now 决定消息顺序；
- unknown record type 保留占位，不导致整段历史不可读；
- missing/offloaded resource 显示可解释状态；
- duplicate record 不重复显示；
- partial/final message 合并规则明确；
- correction/superseding record 规则明确；
- Overlay 缺失时有稳定默认展示。

### 5.3 完整性比较

shadow rebuild 至少比较：

- 用户原文；
- assistant 内容；
- 消息数量/顺序；
- Tool name/input/output/status；
- permission/question interactions；
- Artifact/delivery；
- error/cancel；
- compaction 前历史；
- title/pin/draft/collapse；
- model/Agent version；
- non-scode backend；
- large offloaded result；
- deleted/corrected message。

“页面看起来差不多”不是验收。比较结果需结构化输出 mismatch type/count/sample，并可追踪到 record/legacy row。

---

## 6. API 决策

### 6.1 Canonical Transcript API

```text
POST /v2/sessions/{session_id}/transcript:append
POST /v2/sessions/{session_id}/transcript:append-batch
GET  /v2/sessions/{session_id}/transcript?after_sequence=&limit=
GET  /v2/sessions/{session_id}/transcript/{record_id}
```

规则：

- append 为内部授权 producer API；
- sequence 由 server 分配；
- record_id/idempotency 防重；
- pagination cursor 基于 sequence；
- response 按权限过滤/redact；
- payload 超限要求 payload_ref；
- unknown major 拒绝；
- append partial failure 返回逐项结果或原子 batch contract，不能静默丢记录。

### 6.2 Overlay API/Store

Desktop local：SQLite/local store。WebUI 可由 SudoWork Web service 提供：

```text
GET  /api/ui/conversations/{conversation_id}/overlay
PUT  /api/ui/conversations/{conversation_id}/overlay
```

Overlay service 不是 Nexus业务执行 API；即使物理部署在同一服务器，也必须保持数据 ownership 分离。

### 6.3 Export/Import

```text
POST /v2/sessions/{sid}/export
POST /v2/sessions/import
```

export bundle 包括：

- canonical transcript；
- Session/Task refs；
-可导出的 Artifact/Evidence；
- schema versions/digests；
-可选 UI Overlay；
- manifest/checksum。

Desktop -> Cloud import 默认关闭，由用户显式触发；不因登录、sync 或使用 Cloud 自动上传本地历史。

---

## 7. 权威 Writer、SSOT 与 Reader

| 数据 | 权威 writer | SSOT | Reader/Projection |
|---|---|---|---|
| Canonical Transcript bytes/sequence | Transcript Service；Local 为 sudocode SessionStore | Nexus SessionStore/local SessionStore | SudoWork、Moss、sudocode resume、SudoEvolve |
| user.message fact | Task ingress | Canonical Transcript | UI/Context |
| assistant/tool/runtime fact | sudocode/runtime/gateway | Canonical Transcript | UI/Verify |
| ContextManifest ref | sudocode | SessionStore | Runtime/Audit/Verify |
| Artifact/Evidence fact | runtime/control plane | Task/Session store | UI/Verify |
| Verify fact | verifier | Task/Session store + transcript ref | UI/Moss |
| UI Overlay | SudoWork | SudoWork local/Web overlay store | Renderer |
| Conversation binding | SudoWork | Local Index | Renderer/transport adapter |
| Moss session/message view | Projection builder | 可重建 projection | Moss admin/API |
| render cache | SudoWork | 可丢弃 cache | Renderer |

---

## 8. 安全与隐私

- Transcript 属于 Session home Zone；
- 所有读取按 Session relation + Zone/ReBAC；
- Tool result/Artifact ref 每次 resolve 再授权；
- Secret value 禁止写 Transcript/Event/Overlay；
- Prompt/Skill/Memory provenance 通过 ContextManifest ref，不伪装成用户消息；
- original user content 与 injected model input 分离，降低 prompt injection/审计混淆；
- Overlay 不进入 Agent Context；
- draft/local-only content 不自动上传；
- export/import 需要显式用户操作与 data policy；
- deletion 同时处理 transcript、offloaded result、search/vector index、backup retention；
- audit record 不因 UI 删除而消失，按合规 policy 处理；
- renderer 处理 unknown/untrusted content 时不得执行 HTML/script；
- payload_ref 不允许 path traversal，必须 ResourceRef + Zone validation。

---

## 9. Retention、删除与修正

### 9.1 Retention

- canonical records 默认跟随 Session retention；
- Tool result/Artifact 可有独立 retention，但 Transcript 保留引用和 unavailable reason；
- Trace 可短期/采样，不影响 Transcript；
- Audit 按安全合规保留；
- Overlay 按用户设备策略。

### 9.2 修正

append-only Transcript 不原地 edit。修正使用：

```text
message.corrected
message.redacted
message.deleted/tombstone
```

并引用原 record_id、actor、reason、timestamp。

UI 默认展示最新有效投影，但允许有权限的审计查看变更历史。

### 9.3 删除

用户删除 Session：

1. 权限和 retention 检查；
2. 写 delete request/audit；
3. Session 进入 deleting；
4. 停止新 Task/PID；
5. 删除/tombstone canonical data；
6. 删除 offloaded content/index；
7. 清 local binding/overlay；
8. projection 重建；
9. 完成或报告部分失败。

删除 Conversation 默认只删除 UI 对象；“同时删除 Session”必须显式选择。

---

## 10. 兼容与迁移

### 10.1 第一步：字段分类

对 SudoWork `conversations/messages/extra`、Moss transcript、sudocode transcript逐字段分类：

| 当前字段/内容 | 目标归属 |
|---|---|
| 用户原文 | Canonical Transcript |
| 注入后的 model input | ContextManifest/ref |
| assistant final/partial | Canonical Transcript |
| Tool call/result raw fact | Canonical Transcript/ToolResult ref |
| Tool diff UI layout | Overlay/derived renderer |
| Artifact/delivery | Canonical Task/Transcript fact |
| tips/status | 依据是否业务事实分类为 Event 或 Overlay |
| collapsed/tab/scroll | Overlay |
| draft | Overlay |
| `acpSessionId/mossSessionId` | Local Index legacy binding |
| authToken | Credential store，不属于三层中的普通数据 |

任何无法分类或无法从 Transcript+Overlay 重建的字段必须先解决，不能直接丢弃。

### 10.2 第二步：Canonical append adapter

- Moss/SudoWork ingress 写 user.message；
- sudocode 写 assistant/tool；
- legacy transcript writer 双写 canonical record；
- record_id/idempotency 防止重复；
- producer version 真实填写；
- offload refs 对齐。

### 10.3 第三步：双写，旧表主读

```text
write legacy messages/transcript
write canonical transcript
read legacy
```

使用 outbox/retry 处理跨存储写入失败；不可简单 `Promise.all` 后忽略一边失败。

### 10.4 第四步：Shadow rebuild

后台执行：

```text
canonical transcript + overlay -> rebuilt view
legacy rows -> current view
compare
```

保存 mismatch report，不影响用户当前读取。

### 10.5 第五步：Backfill

- 按 Session/Conversation 分批；
- idempotent；
-记录 source row/file/digest；
- 不可推断字段标记 legacy_unknown；
- 不伪造 Agent version；
-支持暂停/重跑/回滚；
- local-only 不自动传 Cloud。

### 10.6 第六步：切读

切换条件：

- reference cohorts 无关键 mismatch；
- Desktop restart、WebUI browser change、多窗口通过；
- local/remote/non-scode 兼容；
- PID resume 无重复；
- export/delete 通过；
- rollback flag 可用。

切换：

```text
canonical-primary
legacy-read fallback
```

至少稳定一个产品 release 后，才禁 legacy write；删除旧字段另做 migration。

### 10.7 Non-scode backend

- ACP/Codex/Claude/Sudoclaw/remote 等通过 adapter 生成 canonical records；
- 无法表达的历史保留 legacy segment/ref；
- 不能为了统一 scode transcript 而让其他 backend 历史不可读；
- 新 backend 接入必须实现 Transcript adapter/conformance test。

### 10.8 Moss projection

Moss 可保留 Session/message查询 projection，但：

- canonical bytes/sequence 在 Nexus；
- Moss projection 可从 Transcript/Event重建；
- projection failure 不覆盖 canonical；
- API migration期可保持旧 response shape；
- 新 response 增加 transcript cursor/version。

---

## 11. 被拒绝的方案

### 11.1 立即删除 SudoWork messages 表

拒绝。当前表包含 transcript 尚未完整表达的用户原文、Tool展示、Artifact和 non-scode历史。

### 11.2 永久以 SudoWork messages 为 Session SSOT

拒绝。无法跨客户端、跨 PID、跨设备恢复，会让 UI 数据库成为隐藏控制面。

### 11.3 直接读取 sudocode 当前 transcript 代替 messages

拒绝作为未迁移情况下的切读方案。当前 transcript 服务模型恢复，不保证覆盖所有 UI/产品事实。

### 11.4 把 Overlay 写入 Canonical Transcript

拒绝。界面折叠、滚动、draft 不属于 Agent业务事实，会污染 Context和跨客户端语义。

### 11.5 Transcript 只保存模型实际 prompt

拒绝。注入内容会伪装成用户原文，UI、审计和 prompt injection分析均失真。

### 11.6 Compaction 覆盖/删除原始 Transcript

拒绝。Context优化不能改变历史事实；合规删除除外且必须有 tombstone/audit。

### 11.7 保存每个 token delta 作为唯一历史

拒绝。成本高且重建脆弱；保存 finalized/partial semantic record，delta用于 live event/trace。

### 11.8 一个大 JSON 文件不断覆盖

拒绝。并发、崩溃恢复、增量同步、去重和审计困难；使用 append-only records。

### 11.9 登录后自动上传全部 Local 历史

拒绝。需要明确用户触发、classification和export/import policy。

---

## 12. 后果

### 正面

- Session 真正可跨客户端/PID恢复；
- SudoWork 可替换但不牺牲 UX；
- 用户原文、模型输入和 UI 展示边界清晰；
- Tool/Artifact/Verify 可完整重建；
- UI 数据库不再是第二控制面；
- compaction 不破坏历史；
- offline/local privacy 边界明确；
- 为 Event、Verify、后训练和审计提供稳定事实。

### 成本

- 需要 Transcript Service/append API；
- 多 producer writer authorization；
- SudoWork 需要 Overlay和deterministic reducer；
- 需要双写、shadow rebuild、backfill；
- non-scode backend 要写 adapter；
- 一段时间内存在多份 projection；
- 删除/合规流程更复杂。

---

## 13. 验收标准

1. Canonical Transcript、Overlay、Local Index schema 均发布；
2. user original 与 model input 明确分离；
3. Session 内 sequence 稳定且可分页；
4. duplicate record 不重复显示；
5. finalized/partial assistant message 可恢复；
6. Tool call/result/Artifact/Verify 可重建；
7. compaction 后 UI 仍能查看原始历史；
8. Overlay 删除不删除 Transcript；
9. Conversation 删除不默认删除 Session；
10. Desktop restart 恢复一致；
11. WebUI 换浏览器恢复 canonical事实；
12. 多窗口 Overlay 不互相静默覆盖；
13. pid1 -> pid2 resume 不重复消息；
14. large Tool result offload 可展示/分页；
15. local offline Session 不自动上传；
16. non-scode backend 历史可读；
17. shadow rebuild 对 reference cohort 无关键 mismatch；
18.旧读路径可 feature flag rollback；
19.正式 record producer version 不为 unknown；
20.用户 export/delete 覆盖 transcript、refs、indexes和overlay。

---

## 14. 开放实现选择

不改变本 ADR 语义：

- Transcript底层使用 DT_STREAM、typed files或Event store组合；
- Overlay local/server sync 的具体数据库；
- sequence具体编码；
- render cache实现；
- shadow compare工具；
-历史 delta 是否按debug policy短期保留；
- canonical transcript与domain event是否共用部分物理stream，但逻辑profile必须分开。

---

## 15. 生效与替代

本 ADR 被接受后：

- 不得以“已有 scode transcript”为由直接删除 SudoWork messages；
- 新 canonical user message 必须保存原始输入；
- UI private state 不进入 Agent Context；
- compaction 不覆盖原始历史；
- Conversation/Session binding必须显式；
- transcript迁移必须经过双写、shadow rebuild、backfill、cutover和rollback；
-任何无法由 Transcript+Overlay重建的产品事实都必须在切读前重新分类和建模。
