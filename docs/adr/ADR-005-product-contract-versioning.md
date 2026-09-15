# ADR-005：跨仓产品契约的版本、分发与兼容规则

- 状态：Proposed
- 日期：2026-09-12
- 决策范围：Sudo 全产品族与跨仓产品契约包
- 首个发布阶段：`sudostack` v0.x Git 分发；语义接受并完成 codegen/release tooling 后进入正式 `sudo-contracts` v1.x
- 相关文档：
  - [`Sudo 跨仓语义与六契约设计`](../design/cross-repo-contracts-semantics-design-v1.0.md)
  - [`ADR-001：标识及生命周期`](./ADR-001-identifiers-and-lifecycle.md)
  - [`ADR-002：Zone 与多租户`](./ADR-002-zone-and-tenancy-model.md)
  - [`ADR-003：Agent Principal 与 Version`](./ADR-003-agent-principal-and-versioning.md)
  - [`ADR-004：Task 与 Resolution`](./ADR-004-task-and-execution-resolution.md)
  - [`ADR-006：Transcript 与 UI Overlay`](./ADR-006-transcript-and-ui-overlay.md)

---

## 1. 背景

Sudo 的跨仓 payload 当前由不同技术栈分别定义：

- SudoWork TypeScript/Zod；
- Moss TypeScript types 和手写 HTTP/WS DTO；
- sudocode Rust serde/ACP types；
- Nexus Python dataclass/Pydantic/SQLAlchemy types；
- Nexus/nexus-vfs Rust structs 与 protobuf；
- SudoRouter Go/OpenAI-compatible payload；
- 未来 SudoEvolve 和潜在 C# consumer。

现有 `contracts` 名称也已被不同层占用：

- `sudowork/packages/contracts`：浏览器/WebUI DTO；
- `nexus/src/nexus/contracts`：Nexus Python 内部 layer contract；
- `nexus-vfs/rust/contracts`：kernel/ABI types。

这些目录都不是全产品语言无关 SSOT。

六类产品契约需要解决的是：

- Task；
- Tool；
- Context；
- Memory；
- Verify；
- Event/Trace/Audit。

此外还需要公共 Agent、Zone、Session、Runtime、Resource、Error 类型，以及 ADR-006 定义的 Transcript/Overlay 支撑契约。支撑契约同样需要 schema、版本和 conformance，但不改变“六类核心 Agent 执行契约”的产品划分。

如果继续由每个 repo 手写等价 DTO，会出现：

- 字段名和 optional/required 漂移；
- 同一 `session_id` 含义不同；
- TypeScript 接受但 Rust 拒绝；
- enum 新值让旧 consumer 崩溃；
- protobuf、OpenAPI、Zod 成为互相冲突的多份 SSOT；
- breaking change 未升 major；
- 正式事件继续使用 `version: unknown`；
- 只写 interface，没有 runtime validation、fixtures 和 consumer compatibility。

---

## 2. 决策

### 2.1 v0.x 物理承载与正式仓库目标

当前 v0.x 物理承载为 `sudostack` public Git repository 中的私有 npm package `@sudo/contracts`。消费方通过 GitHub 40 位 commit SHA 精确固定，例如：

```text
github:sudoprivacy/sudostack#<40-char-rev>
```

该阶段不依赖 npm registry；`package.json` 中的 `private: true` 用来避免误发布 registry，不阻止 Git dependency 安装。当前 Moss 已按该方式消费；v0.x package 形状、CI gate、consumer matrix、release manifest 和 Moss exact pin 由本仓工具检查。`[enforced_by: test:tools/contracts-tooling.test.mjs#v0 distribution is exact-pinned and CI-gated]`

正式阶段的目标物理 SSOT 为独立 Git repository：

```text
sudo-contracts
```

约束：

- 独立 Git repository；`[enforced_by: none]` —— 当前 v0.x 仍承载在 `sudostack`
- 零业务 repo 依赖；`[enforced_by: none]`
- 独立 release/tag；`[enforced_by: none]`
- 可离线镜像；`[enforced_by: none]`
- 不运行产品服务；`[enforced_by: none]`
- 不连接业务数据库；`[enforced_by: none]`
- 不持有 Secret；`[enforced_by: none]`
- 不从 consumer repo 反向 import 类型。`[enforced_by: none]`

现有 `sudowork/packages/contracts` 保留为迁移期 TypeScript consumer/adapter，不直接改名为全局 SSOT。

### 2.2 JSON Schema 2020-12 是语言无关语义 SSOT

Canonical schema 使用 JSON Schema Draft 2020-12。

原因：

- 跨 TypeScript/Rust/Python/Go/C#；
- 适合 HTTP/WS/ACP metadata/Event JSON；
- 可生成或验证多语言 DTO；
- 支持 `$id`、`$ref`、组合和 validation；
- 不把某一种语言或 framework 设为上游真相。

JSON Schema 定义 wire 数据。语言包可以提供 idiomatic API，但不得改变 wire 语义。`[enforced_by: test:tools/contracts-tooling.test.mjs#schema lint checks schema ids, api_version, kind, manifests, and fixtures]`

### 2.3 目录结构

```text
sudo-contracts/
  schemas/
    common/v1/
    agent/v1/
    auth/v1/
    runtime/v2/
    task/v1/
    tool/v1/
    context/v1/
    memory/v1/
    verify/v1/
    event/v1/
    transcript/v1/
    overlay/v1/
  packages/
    typescript/
  crates/
    rust/
  python/
    sudo_contracts/
  go/
    contracts/
  csharp/
    Sudo.Contracts/           # 有 consumer 需求时启用
  fixtures/
    valid/
    invalid/
    roundtrip/
    compatibility/
  compatibility/
    consumers.yaml
  docs/
    adr/
    event-types.md
    error-codes.md
    versioning.md
  tools/
    generate/
    compatibility-check/
```

首批 E0 只要求：

```text
common/v1
agent/v1
auth/v1
runtime/v2
TypeScript/Rust artifacts
fixtures/CI
```

六个核心 Agent 执行契约由对应后续 Epic 增量加入；`common`、`agent`、`auth`、`runtime`、`transcript`、`overlay` 是这些核心契约共享的基础/支撑契约族。Transcript/Overlay 虽分别在 Epic 6 实现，也必须在同一 contract repository 中版本化。不得为了“目录齐全”提交空洞占位 schema。`[enforced_by: none]` —— schema 目录和空洞占位检查尚未实现

### 2.4 Contract family 与 `api_version`

每个 wire object 必须包含：`[enforced_by: test:tools/contracts-tooling.test.mjs#schema lint checks schema ids, api_version, kind, manifests, and fixtures]`

```json
{
  "api_version": "task.sudo.dev/v1",
  "kind": "TaskSpec"
}
```

格式：

```text
{family}.sudo.dev/v{major}
```

示例：

```text
common.sudo.dev/v1
agent.sudo.dev/v1
auth.sudo.dev/v1
runtime.sudo.dev/v2
task.sudo.dev/v1
tool.sudo.dev/v1
context.sudo.dev/v1
memory.sudo.dev/v1
verify.sudo.dev/v1
event.sudo.dev/v1
transcript.sudo.dev/v1
overlay.sudo.dev/v1
```

`runtime` 从 v2 开始，因为当前 ManagedAgent v1 已有不可兼容且含义错误的 `session_id=pid`；不能以新的 v1 静默覆盖已存在 wire behavior。

### 2.5 Schema `$id`

每个 canonical schema 使用稳定 `$id`：`[enforced_by: test:tools/contracts-tooling.test.mjs#schema lint checks schema ids, api_version, kind, manifests, and fixtures]`

```text
https://contracts.sudo.dev/schemas/task/v1/task-spec.schema.json
```

仓库内 `$ref` 使用稳定相对结构；release artifact 中保持可离线解析，不要求运行时联网下载 schema。

### 2.6 Wire naming

- JSON property 使用 `snake_case`；
- 时间使用 RFC 3339 UTC string；
- opaque IDs 使用 string；
- digest 明确算法前缀，如 `sha256:...`；
- binary data 使用 ResourceRef，不嵌入无界 base64；
- Secret value 禁止进入普通 contract；`[enforced_by: test:contracts/common/v1/conformance.test.mjs#generated common validators reject invalid fixtures]`
- null 与 absent 语义必须在 schema/doc 明确；`[enforced_by: none]`
- 数值可能超过 JavaScript safe integer 时使用 decimal string；
- map key 和 path 的 normalization 必须明确。`[enforced_by: none]`

语言层：

- TypeScript MAY 暴露 camelCase view，但 wire serializer 必须 snake_case；`[enforced_by: none]` —— 当前没有通用 TS serializer/schema roundtrip
- Rust/Go/Python/C# MAY 使用 idiomatic field/property 名并通过 serde/tag/attribute 映射；
- generated types 不应要求业务代码手写 casing conversion。

### 2.7 Schema major 与 package SemVer 分离但协调

#### Schema major

`api_version` 表示某个 contract family 的语义 major。

同一 major 内允许：

- 新增 optional 字段；
- 放宽合理上限且不改变安全边界；
- 新增新 `kind`；
- 修正文档但不改变含义；
- 新增开放 registry code。

必须新 major：`[enforced_by: none]` —— 还没有 compatibility diff 工具判定 schema breaking change

- 新增 required 字段；
- 删除字段；
- 改字段类型；
- 改字段语义；
- 收紧会拒绝既有合法 payload 的 validation；
- 改 identity/lifecycle/authority；
- 改默认安全行为；
- 将一个 `kind` 换成另一对象生命周期。

#### Package SemVer

语言 package 版本表示发布 artifact/API 的版本：

- patch：bug/doc/generator fix，不改变接受 payload 集；
- minor：新增 schema/kind/optional field/helper；
- major：删除已支持 schema major、破坏生成 API、改变 validator behavior。

一个 package MAY 同时包含多个 schema major：

```text
Task.V1
Task.V2
```

因此 package major 不要求与每个 family major 数字完全相同，但 release notes 必须列出 schema support matrix。`[enforced_by: none]` —— 当前没有 release notes/schema support matrix gate

`sudo-contracts` 在 ADR 未接受和 codegen 尚不稳定时使用 `0.x`；第一组 schema 正式冻结后发布 `1.0.0`。

### 2.8 兼容规则

#### Consumer

- MUST 验证 `api_version` 和 `kind`；`[enforced_by: test:contracts/common/v1/conformance.test.mjs#generated common validators accept valid fixtures]`
- MUST 拒绝未知 major；`[enforced_by: test:contracts/common/v1/conformance.test.mjs#generated common validators reject invalid fixtures]`
- MUST 忽略支持 major 下未知 optional 字段；`[enforced_by: test:contracts/common/v1/conformance.test.mjs#generated common validators accept valid fixtures]`
- SHOULD 保留未知字段用于 proxy/roundtrip，除非安全边界要求剥离；`[enforced_by: none]`
- MUST 对开放 status/reason code 有 Unknown/fallback；`[enforced_by: none]`
- MUST 不因字段顺序不同而改变含义；`[enforced_by: none]`
- MUST 不依赖 JSON serialization 的原始字符串形式。`[enforced_by: none]`

#### Producer

- MUST 只发送已声明支持的 major；`[enforced_by: none]` —— producer support matrix 与 producer contract tests 尚未实现
- MUST 填所有 required 字段；`[enforced_by: none]`
- MUST 使用真实 producer/service version；`[enforced_by: none]`
- MUST 不发送 `version: unknown` 的正式事件；`[enforced_by: none]`
- MUST 不把 Secret 或无界 payload 放进 Event/Task/Context；`[enforced_by: test:contracts/common/v1/conformance.test.mjs#generated common validators reject invalid fixtures]`
- SHOULD 支持 negotiated/downgrade major，或明确返回 unsupported-version error。`[enforced_by: none]`

### 2.9 Open code 与 closed enum

预计会扩展的 code 使用开放 string registry，例如：

```text
reason_code
event_type
capability
tool_id
error_code
```

规则：

- JSON Schema 可使用 pattern/registry reference，而不是封闭 enum；
- SDK 提供 known constants + unknown string fallback；
- consumer 不得 exhaustive-switch 后无 default；`[enforced_by: none]` —— 没有跨语言 exhaustive-switch lint/conformance
- 新 code 可在同 major 增加。

真正封闭 enum 才使用 JSON Schema `enum`。向封闭 enum 增加值被视为潜在 breaking change，默认需要新 major，除非所有 consumer 已证明 unknown-safe。

### 2.10 Error contract

统一错误：

```ts
interface ErrorInfo {
  code: string
  message: string
  retryable: boolean
  details?: Record<string, unknown>
  cause_ref?: ResourceRef
}
```

规则：

- `code` 稳定、机器可读、全大写 snake case；
- message 面向人，可本地化，不作为程序判断依据；
- retryable 是契约语义，不由 client 猜测 HTTP status；
- details 不包含 Secret/未脱敏 payload；
- error code registry 记录 owner、含义、retry、HTTP/gRPC mapping；
- transport status 不替代 domain error。

### 2.11 Transport adapter

六契约不替代 transport：

- OpenAPI 引用 canonical JSON schema；
- gRPC/Protobuf 为传输映射；
- ACP `_meta` 可承载 canonical object/ref；
- MCP adapter 映射 ToolInvocation/ToolResult；
- WebSocket event 使用 EventEnvelope；
- IPC 使用 TS DTO，但跨进程产品对象仍验证 schema。

禁止：`[enforced_by: none]` —— transport adapter 规则尚未进入 schema/proto/OpenAPI conformance

- 在 protobuf 中重新定义不同语义；
- OpenAPI、Zod、serde 各自成为独立 SSOT；
- transport adapter 偷改 ID 或 lifecycle。

### 2.12 Validation boundary

runtime validation MUST 位于：`[enforced_by: none]` —— 没有跨 repo ingress/read/migration validation gate

- 外部 API ingress；
- 跨 repo/process message ingress；
- 持久对象读取；
- 事件消费；
- migration/backfill；
- external provider response adapter。

不要求每个内部函数重复验证；内部代码应尽快转换为 typed domain object。

### 2.13 Large payload 与 ResourceRef

Task、Tool、Context、Verify、Event 对大内容使用：

```ts
interface ResourceRef {
  zone_id: string
  path: string
  version?: string
  digest?: string
  media_type?: string
  size_bytes?: number
}
```

- Tool result、Artifact、Evidence、Context item 大内容 offload；
- contract 只携带 preview/summary/ref；
- ResourceRef 访问再次授权；
- digest 验证内容；
- retention 由目标对象 policy 决定。

---

### 2.14 Contract manifest 数据模型

每个 schema kind 必须有一条 manifest，避免只有 JSON Schema 结构而没有 owner、数据分类和兼容信息：`[enforced_by: test:tools/contracts-tooling.test.mjs#schema lint checks schema ids, api_version, kind, manifests, and fixtures]`

```ts
interface ContractSchemaManifest {
  family: string
  api_version: string
  kind: string
  schema_id: string
  schema_digest: string

  semantic_adr_refs: string[]
  owner: string
  security_owner?: string
  producers: string[]
  consumers: string[]

  data_classification: string
  secrets_allowed: false
  large_payload_policy?: string
  retention_policy?: string

  compatibility: {
    status: 'experimental' | 'stable' | 'deprecated'
    supersedes?: string[]
    removal_not_before?: string
  }
}
```

每个 repository release 还必须生成 release manifest：`[enforced_by: test:tools/contracts-tooling.test.mjs#release manifest pins schema and artifact digests]`

```ts
interface ContractReleaseManifest {
  package_version: string
  git_commit: string
  schema_bundle_digest: string
  schemas: ContractSchemaManifest[]
  generated_artifacts: Array<{
    language: string
    package: string
    version: string
    digest: string
  }>
  created_at: string
}
```

Release manifest 与 schema bundle、fixtures 和语言 artifacts 一起发布，供离线部署验证版本和 digest。

### 2.15 权威 Writer、Reader 与冲突优先级

| 对象 | 权威 writer | SSOT | Reader |
|---|---|---|---|
| 语义、生命周期、所有权决策 | 对应 contract family owner，经架构/安全评审 | Accepted ADR + contract docs | 所有 producer/consumer |
| Wire 结构与 validation | `sudo-contracts` schema maintainer，经 family owner review | Canonical JSON Schema | codegen、validators、API adapters |
| Event/error/code registry | 对应 registry owner | `sudo-contracts` registry docs/data | SDK 和 consumers |
| Language DTO/validator | codegen 或语言 package maintainer | Generated/conformance-verified artifact，非独立 SSOT | 业务 repos |
| Consumer support matrix | contract release owner + consumer owner | `compatibility/consumers.yaml` | release/CI/deployment |
| Transport mapping | transport owner | 对应 adapter/proto/OpenAPI，必须引用 canonical schema | services/clients |

冲突处理：

1. Accepted ADR 定义语义、生命周期和安全边界；
2. Canonical JSON Schema 定义 wire 结构与 validation；
3. manifest 将 schema 绑定到 ADR、owner、classification 和 compatibility；
4. 语言 artifact 与 schema 不一致时 artifact 构建失败，不能反向覆盖 schema；
5. schema 与 Accepted ADR 不一致时该 release 不得发布，必须修复 schema或通过新 ADR/amendment 修改语义；`[enforced_by: none]`
6. consumer-local interface/type 不得成为新的跨仓权威源。`[enforced_by: none]`

## 3. 语言 Artifact

### 3.1 TypeScript

Package：

```text
@sudo/contracts
```

提供：

- wire types；
- runtime validators；
- schema bundle；
- known code constants；
- parse/safeParse；
- 可选 idiomatic adapters。

当前 [`@sudowork/contracts`](https://github.com/sudoprivacy/sudowork/blob/9f7a5fca1e6cc114d02b26af76f791d449f40779/packages/contracts/package.json) 保持私有 adapter，逐步依赖 `@sudo/contracts`。

### 3.2 Rust

Crate：

```text
sudo-contracts
```

提供：

- serde DTO；
- ID newtypes；
- validation helpers；
- schema/version constants；
- unknown code fallback。

必须与 `nexus-vfs` 内部名为 `contracts` 的 kernel crate 区分；不得重命名 kernel crate 后冒充产品 contracts。`[enforced_by: none]` —— 当前命名确实不同，但没有 gate 阻止未来重命名/冒充

### 3.3 Python

Package：

```text
sudo-contracts
```

Import：

```python
from sudo_contracts import ...
```

提供 Pydantic models/validation，并与 Nexus internal `nexus.contracts` 分开。

### 3.4 Go

Module path 由 `sudo-contracts` repo 的正式 GitHub org 确定，例如：

```text
github.com/sudoprivacy/sudo-contracts/go
```

提供 structs、validation 和 known codes，供 SudoRouter/current `new-api` 使用。

### 3.5 C#

当出现正式 C# consumer 时发布：

```text
Sudo.Contracts
```

提供：

- records/newtype-like value objects；
- `System.Text.Json` snake_case mapping；
- JSON Schema validation；
- open code fallback；
- NuGet SemVer 与 schema matrix。

第一层没有 C# 生产 consumer 时不要求立即生成，避免维护无人使用的 artifact。

---

## 4. Fixtures 与 Conformance

目录：

```text
fixtures/
  valid/{family}/{major}/{kind}/
  invalid/{family}/{major}/{kind}/
  roundtrip/{family}/{major}/{kind}/
  compatibility/{family}/
```

每个 kind 至少有：

- 最小合法 payload；
- 完整合法 payload；
- 每个 required 字段缺失；
- 类型错误；
- 非法 ID/version/digest/time；
- unknown optional；
- unknown major；
- sensitive/large payload negative fixture；
- previous minor fixture。

Roundtrip 要求：

```text
JSON fixture
-> TS parse/serialize
-> Rust parse/serialize
-> Python/Go/C#（接入后）
-> 语义等价
```

不要求 JSON property 顺序或空白字节完全相同；要求解析后的规范语义等价。需要签名/哈希的对象另定义 canonical JSON serialization。

---

## 5. Compatibility Matrix

`compatibility/consumers.yaml` 记录：

```yaml
consumers:
  sudowork:
    task: [v1]
    event: [v1]
  moss:
    runtime: [v2]
    task: [v1]
    event: [v1]
  sudocode:
    runtime: [v2]
    tool: [v1]
    context: [v1]
  nexus:
    agent: [v1]
    auth: [v1]
    runtime: [v2]
```

每次 release 必须更新：`[enforced_by: test:tools/contracts-tooling.test.mjs#consumer matrix records supported families and exact pins]`

- producer versions；
- consumer versions；
- deprecated major；
- removal date/version；
- migration adapter；
- last conformance result。

矩阵是文档/CI input，不是运行时 service discovery。

---

## 6. CI 决策

### 6.1 Contract repo CI

必须执行：`[enforced_by: none]` —— 当前 CI 只覆盖 zone-id 生成物、zone-id TS conformance 和 ADR enforcement checker，未覆盖完整 contract repo CI 清单

1. JSON Schema lint；
2. `$id/$ref` 离线解析；
3. valid fixtures 全通过；
4. invalid fixtures 必须失败；`[enforced_by: test:tools/contracts-tooling.test.mjs#schema lint checks schema ids, api_version, kind, manifests, and fixtures]`
5. TS/Rust roundtrip；
6. generated artifact clean diff；
7. backward compatibility diff；
8. duplicate kind/error/event code 检查；
9. Secret-field denylist/annotation 检查；
10. package/schema matrix 检查；
11. release artifact reproducibility；
12. license/SBOM/checksum。

### 6.2 Consumer repo CI

每个 consumer：

- pin exact contract package/crate/module version；
- 跑 shared fixtures；
- provider/consumer contract tests；
- unknown optional test；
- unsupported major test；
- adapter mapping test；
- redaction/Secret test；
- 正式 producer version 非 unknown；
- lockfile/revision drift check。

### 6.3 Cross-repo pin

`nexus` 与 `sudocode` 当前同时 pin 同一 `nexus-vfs` revision，co-host 类型要求 revision 一致。Contract release 不消除该约束。

CI 仍需检查：

- nexus/sudocode 的 nexus-vfs rev 一致；
- sudocode release 与 nexus cohost pin 一致；
- Moss runtime-versions 指向已验证二进制；
- SudoWork contract version 与 server supported matrix 兼容。

---

## 7. 发布流程

```text
1. Schema/ADR change PR
2. 标注 compatibility impact
3. 更新 fixtures
4. 生成语言 artifacts
5. 跑 conformance/compatibility CI
6. Review schema owner + affected consumer owner
7. Merge
8. Tag sudo-contracts release
9. 发布 npm/crate/PyPI/Go/NuGet artifacts（按已启用语言）
10. 发布 checksums/SBOM/offline bundle
11. consumer 通过独立 PR 升级 pin
12. compatibility matrix 记录 rollout
```

规则：

- consumer 不依赖 `main`/`dev` 浮动分支；
- Rust production 不长期依赖未 tag 的跨仓 branch；
- Private/Edge 可从离线 bundle 安装；
- contract release 不自动发布所有产品；
- 一个 consumer 未升级不阻塞其他支持旧 major 的 consumer，但 provider 不能提前只发新 major。

---

## 8. Governance

每个 family 必须有：`[enforced_by: test:tools/contracts-tooling.test.mjs#schema lint checks schema ids, api_version, kind, manifests, and fixtures]`

- semantic owner；
- schema/code owner；
- producer list；
- consumer list；
- security reviewer；
- migration owner；
- supported major policy。

Breaking change 需要：

- ADR 或 ADR amendment；
- compatibility report；
- provider/consumer migration plan；
- 双版本窗口；
- rollback；
- removal gate。

普通业务 repo PR 不得私自修改跨仓字段含义；应先修改 `sudo-contracts` 并发布。`[enforced_by: none]` —— 没有跨 repo PR gate 阻止本地 DTO 漂移

---

## 9. 安全与数据分类

每个 schema 必须标注：`[enforced_by: test:tools/contracts-tooling.test.mjs#schema lint checks schema ids, api_version, kind, manifests, and fixtures]`

- 是否可包含 user content；
- data classification；
- Secret allowed/forbidden；
- audit requirements；
- retention；
- large payload offload；
- redaction fields；
- cross-Zone restrictions。

全局规则：

- Secret bytes 不进入 Task、Context、Event、Transcript、Agent Version；
- credential 只用 ref/short-lived token；
- unknown major 默认拒绝；
- validator failure 不自动降级为 `any`；
- proxy 不应无条件透传未验证敏感字段；
- error/details 不回显 token、credential 或未经脱敏 payload；
- schema validation 不能替代 authorization。

---

## 10. 兼容与迁移策略

### 10.1 Existing TypeScript DTO

- `sudowork/packages/contracts` 依赖 `@sudo/contracts`；
- 现有 auth/conversation browser whitelist DTO 保留；
- 新产品对象从全局 package 引入；
- 内部 camelCase 类型用 adapter；
- 不全仓机械替换。

### 10.2 Existing Rust types

- `nexus-vfs/contracts` 保持 kernel identity/ABI；
- `sudo-contracts` 只在跨仓/product boundary 使用；
- 通过 `From/TryFrom` adapter 转 internal type；
- 不让 product contracts 反向依赖 kernel；
- Nexus/sudocode pin 同一 published contract version。

### 10.3 Existing Python types

- `nexus.contracts` 继续服务内部 architecture；
- external/product API 使用 `sudo_contracts`；
- boundary 明确转换；
- Python/Rust mirror 类型逐步被 conformance fixture 替代手工注释“keep in sync”。

### 10.4 Legacy wire

- v1 字段语义不原地改；
- 新语义新 major/method/path；
- adapter 明确 legacy field；
- 双读/双写/回填/切换/回滚；
- 至少保留一个稳定产品 release 的兼容窗口，具体更长时间由 consumer matrix 决定；
- 删除旧 major 前证明生产流量为零且 rollback window 结束。

---

## 11. 被拒绝的方案

### 11.1 Zod/TypeScript 作为唯一 SSOT

拒绝。会把 Rust/Python/Go/C# 变成二等 consumer，并产生手工复制。

### 11.2 Protobuf 作为所有产品对象唯一 SSOT

拒绝作为当前六契约总模型。产品大量使用 JSON/HTTP/WS/ACP metadata，protobuf 可以是 gRPC transport adapter，但不应强迫所有 Event/Manifest 使用一套 transport-specific 模型。

### 11.3 每个 repo 各自维护 DTO，只写文档对齐

拒绝。无法通过 CI 阻止漂移。

### 11.4 直接重命名 `sudowork/packages/contracts`

拒绝。它当前是浏览器 DTO，作用域和依赖方向错误。

### 11.5 直接复用 `nexus-vfs/rust/contracts`

拒绝。它是 kernel/ABI 层，不能依赖或承载高层 Task/Rubric/Cloud 语义。

### 11.6 v1 立即建立在线 Contract Registry 服务

拒绝。Git + immutable release artifact + package registry 已满足第一阶段；在线 service 增加运行依赖和故障面。

### 11.7 Consumer 忽略未知 major

拒绝。字段/lifecycle/安全语义可能已改变，必须显式升级。`[enforced_by: test:contracts/common/v1/conformance.test.mjs#generated common validators reject invalid fixtures]`

### 11.8 所有 enum 永久封闭

拒绝。reason/event/capability 等扩展点会迫使频繁 major；使用开放 code registry。

---

## 12. 后果

### 正面

- 跨仓语义有唯一源；
- 多语言可自动/可验证同步；
- breaking change 可见；
- provider/consumer 独立发布仍可兼容；
- Private/Edge 支持离线分发；
- 运行时可严格验证；
- 文档、fixtures、类型、API 不再各自漂移。

### 成本

- 新增独立 repo 和发布流程；
- 需要维护 codegen/conformance；
- consumer 升级需要 pin PR；
- 一段时间内存在 internal type + contract adapter；
- schema design 需要跨语言评审；
- 新字段发布速度需遵守兼容规则。

---

## 13. 验收标准

1. `sudo-contracts` 仓库零业务依赖；
2. common/agent/auth/runtime schema 有稳定 `$id`；
3. TypeScript/Rust artifacts 发布；
4. valid/invalid/roundtrip fixtures 通过；
5. 同 major unknown optional 被接受；
6. unknown major 被拒绝；
7. 新增 required 字段被 compatibility CI 判为 breaking；
8. open code 可处理 unknown value；
9. 正式 Event producer version 不能是 unknown；
10. SudoWork/Moss/sudocode/Nexus 至少各有一个 boundary adapter test；
11. consumer matrix 可回答每个 repo 支持哪些 family major；
12. release 具有 checksum/SBOM/offline artifact；
13. 旧 v1 payload fixture 能被兼容 adapter 读取；
14. Secret negative fixtures 被拒绝或强制 ref/offload。

---

## 14. 开放实现选择

不改变本 ADR 的实现选择：

- JSON Schema 到各语言的具体 generator；
- npm/crates/PyPI/NuGet registry 的托管位置；
- canonical JSON 签名算法；
- package 是否 mono-version；
- compatibility checker 的具体工具；
- C# artifact 在第一个真实 consumer 出现时再启用。

---

## 15. 生效与替代

本 ADR 被接受后：

- `sudo-contracts` 是跨仓产品语义 SSOT；
- consumer repo 不得私自改变跨仓字段含义；`[enforced_by: none]`
- Zod/protobuf/dataclass/serde 变为生成物或 conformance-verified adapter；
- breaking semantic change 必须发布新 schema major；`[enforced_by: none]` —— compatibility checker 尚未实现
- 正式生产不允许未版本化 payload 或 `version: unknown` 事件；
- 第一层完成前，首批 common/agent/auth/runtime contracts 以 v0.x package 迭代，接受后进入稳定 v1.x package release。
