# ADR-005：跨仓产品契约的来源、版本、分发与兼容规则

- 状态：Proposed
- 日期：2026-09-12
- 本次修订：2026-09-17（G0 架构修订，仍待 owner / 架构 / 安全联合评审）
- 决策范围：Sudo 全产品族的跨仓 Contract 定义来源、装配、分发、兼容与迁移
- 当前实现范围：`sudostack` 中的 v0.x `@sudo/contracts` 私有 Git package 仅包含已接入的派生产物；不代表 Contract draft 已冻结、稳定发布或部署
- 相关文档：
  - [`Sudo 跨仓语义与六契约设计`](../design/cross-repo-contracts-semantics-design-v1.0.md)
  - [`ADR-001：标识及生命周期`](./ADR-001-identifiers-and-lifecycle.md)
  - [`ADR-002：Zone 与多租户`](./ADR-002-zone-and-tenancy-model.md)
  - [`ADR-003：Agent Principal 与 Version`](./ADR-003-agent-principal-and-versioning.md)
  - [`ADR-004：Task 与 Resolution`](./ADR-004-task-and-execution-resolution.md)
  - [`ADR-006：Transcript 与 UI Overlay`](./ADR-006-transcript-and-ui-overlay.md)

---

## 1. 背景

Sudo 的跨仓 payload 由 TypeScript、Rust、Python、Go 等多种技术栈生产和消费。现有同名 `contracts` 目录分别服务浏览器 DTO、Nexus 内部分层或 nexus-vfs kernel/ABI；目录名相同不代表语义相同，也不构成全产品 SSOT。

旧版 ADR-005 提议建立独立 `sudo-contracts` 仓库，把所有 canonical schema、语言 package、fixtures 与发布流程集中到该仓库。后续 ZoneId 实践证明，定义如果离开语义 owner，就会造成依赖倒置或可编辑的第二份真相。当前架构改为：定义留在语义 owner；`sudostack` 固定来源、派生、聚合、版本化、分发与发布。

本 ADR 只决定 Contract 工程边界。它不改变业务对象的 runtime writer、canonical runtime store，也不接受 ADR-001/002/003/004/006 中仍待评审的产品语义。

## 2. 四种独立状态

以下状态不得合并为一个“完成”结论：`[enforced_by: none]`

- **ADR maturity**：`Proposed`、`Accepted`、`Superseded`；本文件当前仍为 `Proposed`。`[enforced_by: none]`
- **Contract baseline**：`unfrozen`、`draft-frozen`；`draft-frozen` 只表示一组精确来源与规则可供 consumer pin。`[enforced_by: none]`
- **Artifact publication**：`unpublished`、`candidate`、`released`；package 可安装不等于稳定 release。`[enforced_by: none]`
- **Deployment evidence**：`not-deployed`、`deployed`、`rollback-verified`；只能由具体环境的版本清单、smoke 与 rollback 证据确认。`[enforced_by: none]`

`draft-frozen` baseline 可以在 ADR 仍为 `Proposed` 时供 owner/consumer 协作，但任何报告都必须分别写明上述四种状态。`[enforced_by: none]`

## 3. 定义来源与装配边界

### 3.1 核心决策

- **ADR005-SOURCE-01**：每个跨仓定义的 canonical editable source 必须位于该概念的 semantic owner repository；consumer 或 `sudostack` 不得另存一份可独立编辑的 owner definition。`[enforced_by: none]`
- **ADR005-SOURCE-02**：`sudostack` 必须按 owner repository、完整 Git commit、source path 与 source digest 固定来源；branch、工作树状态或“latest” 不能成为可复现输入。`[enforced_by: none]`
- **ADR005-SOURCE-03**：`sudostack` 可以保存由 owner source 可重现生成的 bundle、语言 artifact、fixture index、兼容矩阵和 release metadata；这些派生产物必须携带 provenance，不能反向覆盖 owner source。`[enforced_by: none]`
- **ADR005-SOURCE-04**：统一 consumer 安装入口与定义存放位置是两个维度；`@sudo/contracts` 可以聚合多 owner 的派生产物，但 package 名不取得这些概念的 semantic ownership。`[enforced_by: none]`
- **ADR005-SOURCE-05**：当前目标中不得新建、恢复或要求独立 `sudo-contracts` repository；这个名称只保留为历史方案或语言 artifact 名称。`[enforced_by: none]`
- **ADR005-SOURCE-06**：owner repository 不得为了定义自身概念而依赖 `sudostack` 的派生 package，避免形成 `owner → sudostack → owner` 环；owner 引用其他 owner 的原语时使用可复现的精确来源。`[enforced_by: none]`

### 3.2 Ownership-aware 物理布局

owner repository 自行选择适合其语言与构建系统的 source path；`sudostack` manifest 记录该实际 path，而不是要求所有 owner 复制同一目录模板。`[enforced_by: none]`

`sudostack` 的逻辑装配布局为：`[enforced_by: none]`

```text
contracts/
  <family-or-primitive>/
    pin.json                 # owner repo + exact commit + source path + digest
    *.gen.*                  # 可重现派生产物；不可作为 editable source
    fixture-index.gen.json   # owner fixtures 的来源与 digest（启用后）
compatibility/               # 已启用 producer/consumer 的支持窗口（启用后）
manifests/                   # baseline / artifact / release provenance（启用后）
package metadata             # 统一 consumer 分发入口
```

- **ADR005-LAYOUT-01**：目录出现本身不构成完成；只有真实 owner source、非空 fixtures、可重现派生、真实 consumer 和对应 gate 同时存在时，family 才能进入支持矩阵。`[enforced_by: none]`
- **ADR005-LAYOUT-02**：不得为了“目录齐全”提交未被真实边界使用的 family、语言 package 或 placeholder schema。`[enforced_by: none]`
- **ADR005-LAYOUT-03**：derived bundle 可以物化 owner schema 内容以供安装与离线使用，但必须从精确来源重建并标明 provenance；它不是第二个可编辑 canonical source。`[enforced_by: none]`

### 3.3 角色定义

| 角色 | 含义 | 与其他角色的区别 |
|---|---|---|
| Semantic owner | 决定概念含义、生命周期与安全边界的 repo/team | 不因谁分发 package 而改变 |
| Authoritative definition writer | 在 semantic owner repo 修改 canonical machine-readable definition 的维护者 | 不是 runtime data writer |
| Canonical definition store | owner repo 的 exact commit + path + digest | 不是运行时数据库 |
| Runtime writer | 创建或改变业务对象实例的服务 | 可以把对象写到另一个服务管理的 store |
| Canonical runtime store | 持久保存业务对象实例的系统 | 不自动拥有对象语义 |
| Producer | 在 wire boundary 发出对象的程序 | 可以不是 semantic owner |
| Consumer | 解析、验证或使用对象的程序 | 不得把本地 DTO 升格为 canonical source |
| Transport owner | 维护 HTTP、WebSocket、gRPC、ACP、SSE、IPC、MCP 等映射 | Transport 不等于 semantic Contract |
| Assembly/distribution owner | 固定来源、派生、聚合、打包和发布；本 ADR 指 `sudostack` | 不接管 owner 定义 |
| Compatibility owner | 协调 family major、artifact version 与 consumer window | 与单一 producer release 分开 |
| Migration/rollback owner | 维护 adapter、cutover、回退与清理证据 | 不因目标设计存在而自动获得迁移授权 |

- **ADR005-ROLE-01**：每个启用的 family/kind 必须记录上述适用角色；同一主体可承担多个角色，但记录中不能用“SSOT”一词掩盖 definition source 与 runtime store 的区别。`[enforced_by: none]`
- **ADR005-ROLE-02**：本 G0 文档修订不得改变任何现有 runtime writer 或 canonical runtime store；这类变化需要 owner implementation、迁移与 rollback 的独立授权。`[enforced_by: none]`

## 4. G0 ownership baseline

下表是本次联合评审的 ownership baseline；`Proposed` 项在 owner/security review 前不是已接受事实。

| 对象 | Semantic owner / canonical definition source | 状态 | Runtime writer / store 说明 |
|---|---|---|---|
| `ZoneId` | `nexus-vfs` | Confirmed-Code；owner source 已存在，仍需纳入完整 baseline provenance | nexus-vfs admission / persisted Zone identity；本 ADR 不改变 |
| `ZonePath` | `nexus-vfs` | Proposed，使用前需从 owner 现有 path 语义冻结 | nexus-vfs path/routing boundary；本 ADR 不改变 |
| Product `Zone` / `ZoneGrant` / `ResourceRef` | `nexus` | Proposed，待 Nexus owner 与安全评审 | Nexus service / RecordStore；物理 Zone primitive 仍属 nexus-vfs |
| `Org` / `Membership` / `OrgZoneBinding` | `moss` | Proposed；只有真实跨仓 consumer 出现时才分发 | Moss IAM/control-plane store；本 ADR 不改变 |
| `ContractEnvelope` / `SchemaManifest` / `ReleaseManifest` / `CompatibilityMatrix` | `sudostack` meta-contracts | Proposed | 装配与发布 metadata，不是 runtime 业务记录 |
| `ErrorInfo` envelope shape | `sudostack` meta-contracts | Proposed，待架构/安全评审 | 各 producer 写 domain code/message；domain code 仍由 producer owner 定义 |
| Task / Attempt / Runtime / Transcript / Overlay families | 由对应 ADR 与 owner review 决定 | Deferred in first MVP | 本 ADR 不提前改 writer/store |

- **ADR005-OWN-01**：`ZoneId` 的派生消费者不得复制其字符集、长度或边界规则作为新的可编辑 source；`sudostack` 只固定 nexus-vfs owner revision 并生成需要的投影。`[enforced_by: none]`
- **ADR005-OWN-02**：`ZonePath`、Product Zone/ZoneGrant/ResourceRef、Moss IAM 对象和 ErrorInfo ownership 在标为 `Proposed` 期间不得被 completion report 写成 Accepted 或稳定发布。`[enforced_by: none]`
- **ADR005-OWN-03**：domain error code 的 owner 必须仍是产生该 domain 行为的 producer owner；统一 ErrorInfo envelope 不得把 code 含义集中到 `sudostack`。`[enforced_by: none]`

## 5. Wire schema、引用与安全边界

### 5.1 Canonical representation

- **ADR005-WIRE-01**：跨仓 product object 的 canonical wire definition 应使用 JSON Schema 2020-12；owner 已有更底层的机器可读 primitive spec 时，owner spec 保持 canonical，JSON Schema 投影由精确 pin 派生。`[enforced_by: none]`
- **ADR005-WIRE-02**：每个版本化 product object 根必须包含 `api_version` 与 `kind`；嵌入式 primitive（例如一个 `zone_id` string）不因此被包装成独立 envelope。`[enforced_by: none]`

```json
{
  "api_version": "common.sudo.dev/v1",
  "kind": "ResourceRef"
}
```

family major 格式为：`[enforced_by: none]`

```text
{family}.sudo.dev/v{major}
```

- **ADR005-WIRE-03**：跨 owner `$ref` 必须解析到 draft-frozen baseline 中记录的 exact source closure；运行时不得依赖联网获取 mutable schema。`[enforced_by: none]`
- **ADR005-WIRE-04**：wire JSON property 使用 `snake_case`；时间使用 RFC 3339 UTC string；opaque ID 使用 string；digest 带算法前缀；null 与 absent、map key 与 path normalization 必须由 owner definition 明确。`[enforced_by: none]`
- **ADR005-WIRE-05**：语言 artifact 可以暴露 idiomatic API，但 serializer、validator 与 adapter 不得改变 canonical wire 语义。`[enforced_by: none]`

### 5.2 Validation 不等于 authorization

- **ADR005-SEC-01**：schema validation 只回答 payload 是否符合已声明的形状和局部约束；它不得被当作 identity、authorization、Zone policy、delegation、retention 或 side-effect approval。`[enforced_by: none]`
- **ADR005-SEC-02**：`ResourceRef` 只标识资源；每次 dereference 必须按 authenticated principal、目标 `zone_id + path` 与当前 policy 重新授权。`[enforced_by: none]`
- **ADR005-SEC-03**：Secret bytes 不得进入普通 Task、Context、Event、Transcript、Agent Version 或 ErrorInfo details；使用 credential/resource reference 或短期最小 scope token。`[enforced_by: none]`
- **ADR005-SEC-04**：validation failure 不得自动降级为 `any`、未校验 passthrough 或合法空值；失败结果必须与合法业务值可区分。`[enforced_by: none]`

## 6. First MVP：只覆盖真实边界

### 6.1 B0 客户演示保底基线

- **ADR005-B0-01**：开始 consumer rollout 前必须记录当前可工作的 sudostack、Moss、SudoWork、sudowork-server、Nexus、sudocode、nexus-vfs 版本/制品/配置、关键 smoke 与可恢复 rollback target。`[enforced_by: none]`
- **ADR005-B0-02**：Contract MVP 不得强制现有客户环境立即迁移数据库、重命名历史 Zone、删除 legacy route 或全仓替换 DTO。`[enforced_by: none]`
- **ADR005-B0-03**：新路径启用后必须保留显式选择的 legacy/demo profile，直到 mixed-version smoke 与回退演练通过；不得用静默 fallback 隐藏新路径失败。`[enforced_by: none]`

### 6.2 B1 Contract MVP included scope

B1 的最小闭包是：

- `ZoneId`；`ZonePath` 仅在真实 `ResourceRef` boundary 需要且 owner 语义已冻结时纳入；`[enforced_by: none]`
- `ResourceRef`，前提是 Nexus ownership/security review 通过并引用 exact-pinned Zone primitives；`[enforced_by: none]`
- 通用 `api_version` / `kind` 规则；`[enforced_by: none]`
- 选定真实 API error boundary 所需的 `ErrorInfo` envelope，前提是 proposed ownership/security review 通过；`[enforced_by: none]`
- `ContractEnvelope`、`SchemaManifest`、`ReleaseManifest`、`CompatibilityMatrix` 中完成上述闭包所需的 meta-contract 子集；`[enforced_by: none]`
- 只为实际存在的 producer/consumer boundary 生成的 artifact、fixture 与 adapter。`[enforced_by: none]`

### 6.3 Deferred scope

- **ADR005-MVP-01**：完整 Product Zone/ZoneGrant、Org/IAM、Task、Attempt、Runtime、Tool、Context、Memory、Verify、Event、Transcript、Overlay families 默认 deferred；只有 owner 语义与真实跨仓边界 ready 后才单独纳入。`[enforced_by: none]`
- **ADR005-MVP-02**：TypeScript 之外的 Rust、Python、Go、C# artifact 只在该语言有真实 production consumer 时启用；不得生成无人消费的空 package。`[enforced_by: none]`
- **ADR005-MVP-03**：没有生产调用的 test-local parser、fixture runner 或 adapter prototype 只能记为 conformance preparation，不能进入 consumer support matrix。`[enforced_by: none]`

## 7. Draft-frozen baseline

一个 family/kind 只有同时记录以下内容才可标为 `draft-frozen`：`[enforced_by: none]`

- owner repository identity、完整 commit、canonical source path 与 source digest；`[enforced_by: none]`
- 所有直接和传递 `$ref` / primitive reference 的 owner、commit、path 与 digest；`[enforced_by: none]`
- family major、kind、字段语义、required/optional/null/absent 规则与 wire examples；`[enforced_by: none]`
- semantic owner、authoritative definition writer、producer、consumer、transport mapping、security reviewer、migration/rollback owner；`[enforced_by: none]`
- data classification、Secret policy、large-payload policy、Zone/authorization rule、retention 与 redaction rule；`[enforced_by: none]`
- non-empty valid、invalid、boundary、unknown-major、unknown-optional、previous-minor fixtures 的 index 与 digest；`[enforced_by: none]`
- owner validator/conformance command、默认 CI job 与结果；`[enforced_by: none]`
- sudostack generator/validator version、package source revision、artifact digest 与可重现命令；`[enforced_by: none]`
- compatibility result、支持窗口、legacy adapter、cutover 和 rollback target；`[enforced_by: none]`
- 明确的 deferred family、language、consumer、security rule 与 release capability。`[enforced_by: none]`

- **ADR005-FREEZE-01**：缺失来源、空 fixtures、未闭合 reference、无法判定兼容或没有真实 consumer 时必须 fail closed，保持 `unfrozen`。`[enforced_by: none]`
- **ADR005-FREEZE-02**：`draft-frozen` 不表示 ADR Accepted、artifact released、consumer adopted 或 environment deployed；这些状态必须单独举证。`[enforced_by: none]`

## 8. 版本与兼容

### 8.1 四种版本

- **Family major**：`api_version` 中的 wire/semantic compatibility 边界。`[enforced_by: none]`
- **Owner revision**：canonical definition 的 immutable Git commit + path + digest。`[enforced_by: none]`
- **Artifact/package version**：聚合 package API 与所含 family support matrix 的版本。`[enforced_by: none]`
- **Deployment version**：某环境实际运行的 producer、consumer、adapter、binary/image 与 Contract artifact 组合。`[enforced_by: none]`

- **ADR005-VERSION-01**：这四种版本必须分别记录；package major 不要求等于每个 family major，package release notes/manifest 必须列出所含 family/kind/major 与 owner revision。`[enforced_by: none]`

### 8.2 Family major 规则

- **ADR005-COMPAT-01**：同一 major 可以新增 optional 字段、unknown-safe 的开放 code 或新 kind；删除字段、增加 required 字段、改变类型/含义/identity/lifecycle/default security，或收紧到拒绝既有合法 payload 时必须使用新 major。`[enforced_by: none]`
- **ADR005-COMPAT-02**：consumer 必须验证 `api_version` 与 `kind`、拒绝未知 major，并按冻结策略处理已支持 major 下的未知 optional 字段。`[enforced_by: none]`
- **ADR005-COMPAT-03**：producer 只能发送已声明支持的 major、填充 required 字段并记录真实 producer version；正式事件不得使用 `version: unknown`。`[enforced_by: none]`
- **ADR005-COMPAT-04**：reason、event、capability、tool、domain error 等扩展点使用开放 code + unknown fallback；真正封闭 enum 增值默认按 breaking risk 评审。`[enforced_by: none]`
- **ADR005-COMPAT-05**：compatibility checker 必须与前一个 immutable baseline/release 比较，并用删除 kind、required/type/const/enum、约束收紧、nullability、array item、`additionalProperties`、`$ref` target 等 mutation 证明能失败。`[enforced_by: none]`
- **ADR005-COMPAT-06**：checker 无法确定兼容时不得默认通过；结果必须进入人工 compatibility review。`[enforced_by: test:tools/contracts/successor-compatibility.test.mjs]`

## 9. v0 分发与未来发布

### 9.1 当前 v0.x 入口

- **ADR005-DIST-01**：第一阶段统一 TypeScript consumer 入口为 `@sudo/contracts`，由 `sudostack` 装配；consumer 必须 pin `sudostack` 的 exact Git commit，不得依赖浮动 branch。`[enforced_by: test:moss@src/server/__tests__/contractsActivation.test.ts]`
- **ADR005-DIST-02**：v0.x package 的 `private: true` 表示禁止误发布到 npm registry；它不表示访问控制、安全审查、稳定性或已发布状态。`[enforced_by: none]`
- **ADR005-DIST-03**：package registry 不是 v0 prerequisite；exact Git revision 必须在 clean checkout 中可安装，并保留 owner source closure 与 artifact digest。`[enforced_by: test:moss@src/server/__tests__/contractsActivation.test.ts]`
- **ADR005-DIST-04**：package 只导出已完成 owner baseline、派生、fixture 与真实 consumer gate 的 family；当前 ZoneId 产物不代表其他 family 已支持。`[enforced_by: none]`

### 9.2 未来 artifact channel

- **ADR005-DIST-05**：npm、crate registry、PyPI、Go module、NuGet 或离线 bundle 只在真实 consumer/部署需要时启用；channel 选择不得改变 canonical definition ownership。`[enforced_by: none]`
- **ADR005-DIST-06**：发布 artifact 必须 immutable、可校验 digest、可追溯 owner revisions，并列出 schema/fixture/generated artifact/support matrix；Private/Edge 所需内容必须可离线解析和安装。`[enforced_by: none]`
- **ADR005-DIST-07**：Contract artifact release 不得自动触发产品 release、deployment 或 migration。`[enforced_by: none]`

## 10. Fixtures、生成与 CI

- **ADR005-CI-01**：owner repository 必须独立验证自己的 canonical definition、引用、positive/negative/boundary fixtures 与 owner-local runtime behavior；不能依赖相邻 checkout 恰好存在。`[enforced_by: none]`
- **ADR005-CI-02**：`sudostack` 必须从 exact-pinned owner sources 重建 derived artifacts，并在默认 CI 中以 clean-diff、fixture completeness、cross-language conformance、compatibility mutation 与 package-install smoke 失败阻止漂移。`[enforced_by: none]`
- **ADR005-CI-03**：cross-repo integration job 必须显式 checkout manifest 中的 exact revisions；读取开发机父目录的 sibling checkout 不能成为 required CI 的隐藏前提。`[enforced_by: none]`
- **ADR005-CI-04**：consumer adoption 必须发生在 production boundary，使用安装后的 artifact，并由默认 required CI 覆盖 unsupported major、unknown optional、legacy mapping、redaction 与失败无副作用；删除 production 调用必须使测试失败。`[enforced_by: none]`
- **ADR005-CI-05**：一个 `enforced_by` target 只有在覆盖整条 clause、artifact 存在、默认 CI 执行且具体违规 mutation 会失败时才能使用非 `none`；部分实现或仅文件存在必须标为 `none`。`[enforced_by: none]`

### 10.1 当前局部事实

当前 `sudostack` 同时保留两层可复现的 F1 局部实现证据。历史 `@sudo/contracts@0.2.0` 链中，Nexus 与 nexus-vfs 的 exact-pinned owner closure 已闭合，并可通过本地 checkout、物化的 offline bundle 和已发布的远端 revisions 验证；generated candidate/source-closure manifests、activation metadata 与 source-availability operation 记录候选内容、激活关系和 availability-only override；Moss PR 276 又由独立、versioned consumer-support operation 验证 exact `0.2.0` pin、真实 `NexusManager.start()` embedded boundary 与默认 CI 结果。该历史 operation 位于 package 外，且 verifier 在不可变 `5a2a53130e37d1c63993ebf8ba1253b15eb9eebf` checkout 中重放，要求 `0.2.0` candidate、compatibility、activation、availability、support 与全部 package bytes 保持不变。

不可变 `@sudo/contracts@0.2.1` 内容 C `273fd4097cbc33c1c049c39bb1fb60cef2663e2b` 的运行时 Contract、Schema、fixture、validator 和 owner-source bytes 与 `0.2.0` 基线相同；变化只限 package/lock version、compatibility/provenance staging metadata 和新增 candidate manifest。C 内嵌的 `candidate_revision: null`、pending activation、空 package actual producers/consumers、`unfrozen`、`candidate_unpublished` 与 `not_deployed` 均保持不变。Moss M `e9660ed1483cf01f96fe06c45ba7e070e0223ec3`（合入 `18a0a069b808c295287675afc6346f411be971a5`）exact-pin C，并在默认 CI 验证安装后的 `0.2.1`、真实 embedded boundary 与失败无副作用。详细内容阶段与包外结果见 [`contracts-0.2.1-content-stage.md`](../design/contracts-0.2.1-content-stage.md)。

C → M → A 已按单向关系完成到 package-external evidence：A 的 [`0.2.1-activation-support.json`](../../manifests/operations/0.2.1-activation-support.json) 只引用已存在的 C、M 和 integration，不记录自身 SHA，不修改 C 的 package bytes，也不要求 Moss repin A。A 验证 43 个 package paths/tarball、M 的三文件 repin、未变化的 production source/caller tests、default runner/workflows 与精确 hosted checks；C-03 因而只在 Moss/`ZoneId` embedded included scope 内解决。该结果不构成 package-wide freeze、artifact publication、deployment、assembly 或 G3；`ResourceRef`、runtime `ZonePath`、external mode、13 个 live Unknown、mixed-version 与 rollback 门禁均保持不变。本 ADR 仍为 `Proposed`；COMPAT-06、DIST-01、DIST-03 的当前机制认领见 §18.5，其余条款按实际缺口保留 none/partial，不表示全 Contract 平台或环境已完成。

## 11. Legacy、迁移与 rollback

- **ADR005-MIGRATE-01**：legacy wire 不得在原 major 静默改变字段语义；使用新 major/method/path 或显式 adapter，并在 support matrix 标出 legacy 与 canonical 方向。`[enforced_by: none]`
- **ADR005-MIGRATE-02**：迁移顺序必须包含 B0 snapshot、provider 兼容面、draft-frozen artifact、dual-compatible consumer、shadow/compare（适用时）、小范围 cutover、mixed-version verification 与 rollback rehearsal。`[enforced_by: none]`
- **ADR005-MIGRATE-03**：旧 major/route/write path 至少保留一个已验证稳定产品 release window；移除前必须证明目标流量为零、consumer 已迁移且 rollback window 已结束。`[enforced_by: none]`
- **ADR005-MIGRATE-04**：若需要 database migration、历史 Zone rename、destructive cleanup 或不可逆 backfill，必须建立独立 Work Item、授权、备份/恢复与 rollback proof；本 G0 不授权这些操作。`[enforced_by: none]`
- **ADR005-MIGRATE-05**：rollback target 必须固定 code、artifact、configuration、database migration level 与 smoke；“切回旧版本”但没有 exact assembly 不能算 rollback proof。`[enforced_by: none]`

## 12. Governance 与发布顺序

- **ADR005-GOV-01**：每个启用的 family 必须有 semantic owner、definition maintainer、security reviewer、producer/consumer owners、compatibility owner 与 migration/rollback owner。`[enforced_by: none]`
- **ADR005-GOV-02**：定义变化先在 semantic owner repository 评审并形成 immutable source revision，再由 `sudostack` 升级 pin、派生 artifact、执行 compatibility/release gates，最后由 consumer 独立升级 exact pin。`[enforced_by: none]`
- **ADR005-GOV-03**：breaking semantic change 必须通过对应 owner ADR/amendment、family major、迁移计划、双版本窗口、rollback 与 removal gate；普通 consumer PR 不得私自改变跨仓含义。`[enforced_by: none]`
- **ADR005-GOV-04**：Proposed ADR 与 draft design 是评审输入，不得覆盖 Confirmed-Code/Confirmed-Deployment；实现与设计冲突时必须分别记录 `Expected`、`Confirmed-Code`、`Confirmed-Deployment`、`Inferred`、`Conflicting`、`Unknown` 或 `Legacy-Declared`。`[enforced_by: none]`

建议发布顺序：

```text
owner semantic/security review
→ owner canonical definition + fixtures + default CI
→ immutable owner revision
→ sudostack pin/reference-closure verification
→ derived artifacts + compatibility + install smoke
→ unfrozen content-stage candidate C（不记录自身 SHA）
→ consumer evaluation exact-pin C + production boundary tests at M
→ package-external activation/support A binds C + M
→ draft-frozen baseline / supported-matrix admission（仅在证据满足后）
→ candidate/release artifact（如获授权）
→ mixed-version assembly / B0 rollback
→ deployment（如获授权）
→ legacy cleanup（另行授权）
```

## 13. 被拒绝或已替代的方案

### 13.1 独立 `sudo-contracts` repository（已替代）

2026-09-12 版本曾提议独立仓库，以获得中立依赖方向、独立 tag 和多语言发布。该提议把“consumer 统一分发”误等同于“所有 canonical definitions 集中存放”，并会让 kernel/domain owner 的规则离开真实执行与编译边界。

本修订以“owner source + sudostack assembly/distribution”替代该提议。独立 repository 不再是当前目标、未来工作项、开放命名选择或 release prerequisite；历史提议保留在本节仅用于解释决策演进。`[not-normative]`

### 13.2 TypeScript/Zod 作为唯一 source

拒绝。它会让 Rust/Python/Go 成为手工同步 consumer，并把 WebUI DTO 误当产品语义 owner。

### 13.3 Protobuf 作为所有产品对象唯一 source

拒绝作为总模型。Protobuf 可以是 gRPC transport mapping，但不能替代 owner 的产品语义或强迫 JSON/HTTP/WS/ACP 对象服从单一 transport。

### 13.4 每个 consumer 各写等价 DTO

拒绝。consumer-local DTO 可以作为 adapter/view，但不能成为跨仓 authoritative definition。

### 13.5 v0 在线 Contract Registry service

拒绝。exact Git source、immutable artifact 与离线 bundle 足以支撑第一阶段；在线 registry 会增加 runtime dependency 和故障面。

### 13.6 先生成所有 family 与语言

拒绝。没有 owner baseline 或真实 consumer 的 schema/package 会制造虚假支持面和维护负担。

## 14. 后果

### 正面

- 定义与真实语义/执行 owner 同仓，降低依赖倒置和规则漂移；
- consumer 仍获得统一安装入口和跨语言派生 artifact；
- owner revision、family major、package version 与 deployment version 可分别追踪；
- `sudostack` 可以统一做 reference closure、兼容、离线分发和 release provenance；
- MVP 只覆盖真实边界，不用 placeholder 假装平台完成。

### 成本

- 跨 owner reference closure、pin 升级和 release coordination 更复杂；
- owner repository 必须具备自己的 definition/fixture/conformance gate；`[enforced_by: none]`
- `sudostack` 需要维护可重现派生与跨仓 compatibility；
- consumer 升级通过独立 exact-pin PR，不能依赖浮动主分支；
- 在迁移期会同时存在 owner-native types、derived artifact 与 legacy adapter。

## 15. G0 与后续验收

### 15.1 本次 G0 文档修订

- ADR 状态保持 `Proposed`，并与索引和 draft design 一致；`[enforced_by: none]`
- active text 不再把独立 `sudo-contracts` repository 作为目标、目录、release source、future work 或 open question；`[enforced_by: none]`
- owner/source、assembly/distribution、runtime writer/store、producer/consumer、transport、version/compatibility 与 migration/rollback 角色可区分；`[enforced_by: none]`
- first MVP 与 deferred scope 足以拆出 owner Work Item，且不声称 schema/package/consumer/release/deployment 已完成；`[enforced_by: none]`
- 所有规范性 clause 有且只有一个诚实 enforcement tag，ADR-005 的 untagged baseline 为零。`[enforced_by: none]`

### 15.2 后续 F1 / consumer / demo

- F1 在 supported/adoption pin 与 support-matrix admission 前必须满足第 7 节完整 draft-frozen baseline；为取得真实 consumer evidence，可先以明确标记的 `unfrozen` evaluation pin 固定 content commit C，但该 pin 不得宣称 adoption、support、release 或 deployment，且必须由后续 package-external activation A 绑定 C 与 consumer commit M 后才可决定冻结与支持状态。`[enforced_by: none]`
- consumer 必须满足第 10 节 production boundary/default CI 条件后才能写入 supported matrix；`[enforced_by: none]`
- customer-demo MVP 必须完成 exact assembly、mixed-version smoke、existing-data restart 与 B0 rollback rehearsal；`[enforced_by: none]`
- 通过某个子集时只能声明该子集和对应状态，不能宣称 ADR-005、全 Contract 平台或所有环境已完成。`[enforced_by: none]`

## 16. 开放实现选择

以下选择不改变本 ADR 的 owner/source 边界：

- owner JSON Schema 与各语言 generator/validator 的具体工具；
- 未来 npm/crate/PyPI/Go/NuGet/离线 artifact channel 的托管位置；
- canonical JSON serialization/signature 算法；
- package mono-version 或独立 version；
- compatibility checker 的具体实现；
- 真实 consumer 出现后启用哪种语言 artifact。

独立 Contract repository 不在开放选择中。`[enforced_by: none]`

## 17. 生效与替代

本 ADR 只有在联合评审显式改为 `Accepted` 后才成为已接受决策。接受时必须记录评审日期、semantic/security/consumer owners、适用的 draft-frozen baseline、兼容/迁移/rollback 计划，以及仍 deferred 的 scope。`[enforced_by: none]`

接受后，若要把 canonical definitions 从 semantic owners 移走、改变分发 ownership、改变 compatibility 语义或取消 rollback window，必须通过新 ADR 或 amendment；不得由单仓实现 PR 隐式改变。`[enforced_by: none]`

## 18. 历史审计与义务处置附录（2026-09-22）

本附录复用 `SW-20260915-001` 独立审计中 Main 已核对的映射、人工补漏和证据结论，记录旧文本的去向与当前机制的实际范围；它不是第二套 Contract SSOT、产品决策批准或新的规范基线。第1–17节的现行规范语义、G0 ownership、primitive 例外及 `Proposed` 状态保持不变。

### 18.1 审计版本和阅读边界

原始文本 O 为 SudoStack `822be533f82f9ee16e208e92730aebd709799b94` 的本文件；审计时现行文本 S 为 `48128024ea9d94b101e9eacea973d0748044e0d9` 的本文件。以下“原行”全部指 O，去向中的章节和行范围指 S，条款标识省略 `ADR005-` 前缀；package 内容 C 仍指独立的 `273fd4097cbc33c1c049c39bb1fb60cef2663e2b`，不与 S 混用。

“保留/重述”“替代/收窄”“条件延期”“部分/未明确承接”描述语义追踪，不等于整条机器强制。表中的 MUST、SHOULD、禁止项和字段清单是历史义务的引用；未明确承接者记录为未决/未强制，不解释为已批准删除或延期，也不自动恢复成新 operative 要求。附录的说明性豁免不改变现行正文要求或裁定历史义务失效。`[not-normative]`

原关键词扫描为39个未认领块，S 的 operative 台账为102条；两者不是同一总体。表外人工补漏及裸引导句后的子项同样计入本次审计，39与102的差值不表示新增完成量。以下 E1–E6 是 §18.5 的范围限定证据索引；没有列出整组证据的条目，不认领原复合义务已获完整 enforcement。

### 18.2 原39块逐项映射

| O | 原行 / 历史义务 | S 中去向 | 处置、实际强制范围与未决项 |
|---|---|---|---|
| O01 | 96 / idiomatic API 不改变 wire 语义 | WIRE-01、WIRE-05 | 重述并新增 owner primitive 例外；ResourceRef tests 仅覆盖该实现子集，未覆盖所有 serializer/adapter。 |
| O02 | 153 / 六类后续 Contract、Transcript/Overlay 同仓、禁止空 schema | SOURCE-01/03/05、LAYOUT-01/02/03、MVP-01/02/03、§13.1 | 拆分、替代及条件延期；独立 repo 方案已被新 ownership 替代，不是原集中仓方案已实现。 |
| O03 | 157 / 根 api_version、kind 及后续格式/例子 | WIRE-01/02、S L120–124 | 收窄至版本化 product object，primitive 不包 envelope；runtime/v2 历史身份禁令未明确承接、未决/未强制，详见 §18.4。 |
| O04 | 208 / 普通 Contract 禁止 Secret | SEC-01/03/04、§7 | 保留并拆分；ResourceRef denylist 是局部强制，不代表全部对象的安全门禁。 |
| O05 | 209 / null 与 absent 明确 | WIRE-04、§7 | 重述；ResourceRef null/unknown 测试提供局部证据，不外推所有 family。 |
| O06 | 211 / map key、path normalization 明确 | WIRE-04 | 保留；ZonePath 证据不等于所有 map/path 字段已有完整定义或强制。 |
| O07 | 215 / camelCase API 与 snake_case wire | WIRE-04/05 | 重述；全部语言/adapter 的统一行为守卫尚未认领。 |
| O08 | 233 / 八类 breaking change 使用新 major | COMPAT-01、GOV-03 | 重述；八类变化完整展开于 §18.4，required mutation 不足以证明语义、权限等全部变化均被捕捉。 |
| O09 | 259 / package major 独立、release 标明支持矩阵 | VERSION-01、DIST-06 | 重述；当前候选 metadata 不等于完整发布和每次 release 的持续矩阵维护。 |
| O10 | 267 / consumer 验证 api_version、kind | COMPAT-02 | 保留；ResourceRef parser 提供局部验证，不证明所有真实 consumer boundary。 |
| O11 | 268 / 拒绝未知 major | COMPAT-02 | 保留；局部 fixture 拒绝有证据，全局消费边界未完成。 |
| O12 | 269 / MUST 忽略已支持 major 的未知 optional | COMPAT-02、§7 | 被“按冻结策略处理”替代；这不是旧无条件忽略规则的等价措辞，也不认领原规则普遍强制。 |
| O13 | 270 / SHOULD 保留未知字段供 proxy/roundtrip，含安全例外 | WIRE-05、COMPAT-02 最近 | 仅部分关联；独立 SHOULD 未明确承接，记录为未决/未强制，不认定完整保留或已批准废除。 |
| O14 | 271 / 开放 code 的 Unknown/fallback | COMPAT-04 | 重述；全局开放扩展点运行时处理尚无完整证据。 |
| O15 | 272 / 字段顺序不改变含义 | WIRE-05 最近 | 独立规则未明确重述，未决/未强制；一般 serializer 意图不等于具体顺序独立保证。 |
| O16 | 273 / 不依赖原始 JSON serialization 字符串 | WIRE-05、§16 最近 | 独立禁止项未明确承接，未决/未强制；与允许选定 canonicalization/signature 算法的区别保留。 |
| O17 | 277 / producer 只发送支持 major | COMPAT-03 | 保留；全部 producer 的完整运行时强制尚未认领。 |
| O18 | 278 / 填充 required | COMPAT-03 | 保留；schema/fixture 合法不证明全部 producer 发出的对象都正确。 |
| O19 | 279 / 真实 producer/service version | COMPAT-03 | 保留；候选源版本记录不代替真实事件 producer version。 |
| O20 | 280 / 正式事件不使用 version: unknown | COMPAT-03 | 保留；全局正式事件守卫尚未认领。 |
| O21 | 281 / Event/Task/Context 无 Secret 或无界 payload | SEC-03、§7、MVP-01 | 部分保留，相关 family 条件延期；unbounded/offload 的具体行为未完整承接，未决/未强制部分仍在。 |
| O22 | 282 / negotiated/downgrade major 或明确 unsupported-version | 支持窗口与 MIGRATE 最近 | 无明确等价条文；原 SHOULD 的去向未决/未强制，不按普通说明删除。 |
| O23 | 300 / 扩展 code 不使用无 default 的 exhaustive switch | COMPAT-04 | fallback 意图保留、实现形式抽象化；全部 code dispatch 的完整守卫尚未认领。 |
| O24 | 339 / transport 不重定义语义、不建立多个 SSOT、不改 ID/lifecycle | SOURCE-01/03、WIRE-05、§13.2–4 | 拆分重述；三项禁令各自追踪，一份 transport 文件不能证明全部强制。 |
| O25 | 347 / 六类边界验证 | CI-04、SEC | 当前泛称 production boundary；持久化读取、事件、迁移/backfill、provider response 等未逐项明确承接，详见 §18.4。 |
| O26 | 383 / 每 kind manifest 及完整字段 | ROLE-01、§7、DIST-06 | 接口重构；schema_id、semantic_adr_refs、secrets_allowed:false、兼容状态、removal 等具体接口未全部等价承接，未决项不以任意 policy 字符串替代。 |
| O27 | 412 / 每 release manifest 及完整字段 | VERSION-01、DIST-06、§7/12 | 格式/阶段改变；created_at、聚合 bundle digest 的精确接口未完整保留，未决/未强制；候选可安装不是正式 release。 |
| O28 | 449 / schema 与 Accepted ADR 冲突时阻止发布 | GOV-02/03/04、§17 | 评审/修订原则有关联，但明确的冲突阻断发布门禁未明确承接或证实。 |
| O29 | 450 / consumer-local types 不成为新权威 | SOURCE-01/04、角色表、§13.4 | 重述；owner-source 结构与全局禁止本地语义分叉属于不同证据。 |
| O30 | 489 / product crate 与 kernel contracts 分层，不以改名冒充迁移 | 背景、SOURCE-01/06、MVP-02 | 分层保留；精确 rename 禁令未明确重述，Rust artifact 条件延期，不据此批准旧义务消失。 |
| O31 | 598 / 每 release 更新六项支持矩阵字段 | §7、VERSION-01、DIST-06、MIGRATE-03 | 分拆、部分承接；固定 C→M→A 记录不证明每次 release 自动刷新六字段。 |
| O32 | 615 / 十二项必要 CI | CI-01–05、COMPAT-05、DIST-06 | 部分覆盖；registry、license/SBOM 等未完整承接/强制；现有 E5/E6 子 gate 不代表十二项全部存在。 |
| O33 | 620 / invalid fixtures 必须失败 | CI-01/02 | E5 确认当前声明的 ZoneId/ZonePath/ResourceRef fixture 子集有真实默认 CI 强制；父复合条款为 partial 不抹去该子机制。 |
| O34 | 686 / 每 family 七类治理角色/策略 | ROLE-01、GOV-01、§7 | 对启用 family 重述；相邻 breaking-change 六项清单一并展开于 §18.4，整组治理强制尚未认领。 |
| O35 | 705 / 不私改语义，先改 sudo-contracts 再发布 | SOURCE-01、GOV-02/03 | 明确替代为 owner→SudoStack→consumer；不是旧独立仓流程已执行。 |
| O36 | 711 / 八类 schema 安全注解 | §7、SEC | 部分承接；usercontent、audit、offload、具体 redaction 字段等未逐项等价保留，未决/未强制部分保留可见。 |
| O37 | 798 / 未知 major 不可忽略 | COMPAT-02、MIGRATE-01 | 重述；局部 parser 拒绝不代表全部真实边界。 |
| O38 | 866 / consumer 不私改跨仓语义 | GOV-03、SOURCE-01 | 重述；语义治理不由路径/类型存在证明。 |
| O39 | 868 / breaking semantic change 使用新 major | COMPAT-01、GOV-03 | 保留；结构兼容测试不证明全部语义变化均能自动识别。 |

### 18.3 关键词之外的 A–L 人工规则

A–L 是历史审计分组索引，不是十二个原子条款；每组列出的子项均纳入追踪。未明确承接或无完整机制者保留未决/未强制的边界，不作为本次新增实现授权。

| 组 / O 原行 | 历史规则子项 | S 中去向、处置及实际强制范围 |
|---|---|---|
| A / 73–80 | 独立 repo、零业务运行时依赖、离线镜像；不做 service/DB/Secret 持有者，不反向 import 业务 repo | repo 承载由 SOURCE-01/05、§13.1 替代；SOURCE-06 只覆盖部分依赖方向，存储/安全/离线义务不随旧 repo 名消失，其余未明确承接或完整强制。 |
| B / 142–150、189 | 初始 common/agent/auth/runtime、TS/Rust；runtime/v2 与旧 session_id=PID 的身份区别 | family/语言按 MVP-01/02 条件延期；特定 runtime/v2 历史兼容规则仍未明确承接、未决/未强制。 |
| C / 193–217 | 稳定 $id、离线 $ref、wire 命名、大整数 decimal string、禁止手写 casing | WIRE-03/04/05 部分关联；ResourceRef 的 decimal string/安全整数测试是局部证据，不证明所有 unsafe integer 和语言 casing 规则。 |
| D / 248–261 | package patch/minor/major 决策表、0.x→1.0 条件 | VERSION-01 的四种版本区分不自动替代原决策表和成熟度条件；未明确承接部分仍未决/未强制。 |
| E / 321–326 | ErrorInfo code/message/retryable/details、registry、映射 | §4、§6 是条件性范围；指定 owner 不表示 envelope/domain registry/真实错误边界已实现。 |
| F / 373–377 | ResourceRef offload/preview/ref、再次授权、content digest、retention | 再授权对应 SEC-02，digest/retention 在 WIRE-04、§7 有关联；具体 offload/preview 等未完整承接或强制，schema/导出不是运行时保证。 |
| G / 549–571 | 每 kind fixture 完整性、跨语言 roundtrip、顺序/空白独立、canonicalization 例外 | §7/CI 是概括；E5/E6 确认当前 fixture 和 generated clean-diff 子机制，多语言及全部 wire 行为未获完整强制认领。 |
| H / 632–653 | consumer exact pin/shared fixtures/default CI/version/lock drift；Nexus/sudocode 共用 nexus-vfs revision、cohost ABI、Moss binary 与 SudoWork/server 矩阵 | E2 确认 M 的 actual exact-pin/default-CI guard；单份 owner lock 不证明全部集成、ABI 或产品版本矩阵。 |
| I / 676–680 | 禁止 main/dev 引用、Private/Edge 离线、产品 release 独立、producer rollout 方向 | DIST-01/06/07、MIGRATE 承接其明确部分；E2/E4 的 Git pin/安装证据不等于完整离线发布或全部 rollout 方向已强制。 |
| J / 738–766 | TS/Rust/Python 迁移边界、legacy window | SOURCE、MVP-02、MIGRATE 可替代路径/责任或条件延期语言；兼容窗口义务仍在，未明确承接部分不视为批准破坏旧语义。 |
| K / 831–844 | 无强关键词的14项验收清单，逐项展开于 §18.3.1 | §15.2 是实际 consumer 子集；局部 MVP 证据不认领原14项全部通过，其余为未决/未强制或明确条件延期。 |
| L / 原任务新增现状要求 | private:true、40位 Git pin、v0 不依赖专用 package registry | package/private 具有当前事实和 npm 防误发含义；E2 有真实 pin guard，E4 有 Git 安装证据；不扩张为安全审查、registry 发布、全面离线或全部未来消费者合规。 |

### 18.3.1 人工 K 的14项验收对照

| K 项 / O 原行 | 历史验收内容 | 当前去向、处置与证据范围 |
|---|---|---|
| K01 / 831 | sudo-contracts 仓库零业务依赖 | 独立仓由 SOURCE-01/05、§13.1 替代；SOURCE-06 保留部分依赖方向，不能由旧 repo 不再存在推定所有依赖约束已强制。 |
| K02 / 832 | common/agent/auth/runtime schema 有稳定 $id | WIRE-03、MVP-01 部分关联；当前 owner primitives/ResourceRef 有已登记 schema，延期 family 的原完整清单未实现。 |
| K03 / 833 | TypeScript/Rust artifacts 发布 | DIST、MVP-02 重设计分发和语言启用条件；当前 TS Git candidate 可安装不等于原双语言 artifacts 已发布。 |
| K04 / 834 | valid/invalid/roundtrip fixtures 通过 | §7、CI-01/02；E5 认领当前声明 fixture 子集，不认领全部 family/语言 roundtrip。 |
| K05 / 835 | 同 major unknown optional 被接受 | COMPAT-02 改为按冻结策略处理；ResourceRef 的有界 unknown-optional 测试是局部机制，不是旧无条件规则的全局强制。 |
| K06 / 836 | unknown major 被拒绝 | COMPAT-02；当前 ResourceRef fixture/parser 拒绝有证据，不外推全部真实 consumer。 |
| K07 / 837 | 新增 required 被 compatibility CI 判 breaking | COMPAT-05 现有 required mutation 在默认测试中认领这一结构子机制，不外推全部 breaking semantics。 |
| K08 / 838 | open code 可处理 unknown value | COMPAT-04；所有扩展点的实际 fallback 尚未认领，schema/枚举比较不能代替运行时 dispatch。 |
| K09 / 839 | 正式 Event producer version 不为 unknown | COMPAT-03；全局正式事件守卫未认领，候选版本或 Moss launch argument 不是正式 Event producer 证明。 |
| K10 / 840 | SudoWork/Moss/sudocode/Nexus 各至少一个 boundary adapter test | CI-04、§15.2 收窄至实际消费子集；Moss/ZoneId 选定边界有证据，不认领原四仓全部具备该边界测试。 |
| K11 / 841 | consumer matrix 能回答各 repo 支持的 family major | §7、VERSION-01、DIST-06；A 只记录 scoped Moss/ZoneId，未认领原各 repo/family 的完整矩阵。 |
| K12 / 842 | release 有 checksum/SBOM/offline artifact | DIST-06；当前 C 有 digest/pack 校验，完整 SBOM、离线 release 组合未认领，Git 安装不替代离线发布。 |
| K13 / 843 | 旧 v1 payload fixture 被兼容 adapter 读取 | MIGRATE、§15.2 部分关联；具体 legacy-v1 adapter 读取义务未明确承接/强制，当前 previous-minor fixture 不等于旧原型升级兼容证明。 |
| K14 / 844 | Secret negative fixtures 被拒绝或强制 ref/offload | SEC、CI；ResourceRef denylist/负例是局部机制，未认领所有对象的 Secret 拒绝或运行时强制 offload。 |

### 18.4 十处裸引导块的子义务展开

以下均是 O 的完整上下文追踪；“未明确承接”只登记处置缺口，不撤销旧义务，也不把历史引文自动变成 S 的新规范。

| O / 原行 | 原引导块后需要逐项核对的内容 | 当前关联与强制边界 |
|---|---|---|
| O03 / 157–189 | api_version；kind；family URI 格式；TaskSpec 示例；runtime 从 v2 起、旧 session_id=PID 不被覆盖为新 v1 | WIRE-01/02、S L120–124 承接 product envelope/格式并有 primitive 例外；TaskSpec 仍为示例，不授权实现；runtime/v2 特定历史禁令未决/未强制，family 延期不等于删除。 |
| O08 / 233–242 | ①增加 required；②删除字段；③类型变化；④语义变化；⑤缩小合法 payload；⑥identity/lifecycle/authority；⑦默认安全行为；⑧kind/lifecycle 替换 | COMPAT-01/GOV-03 重述，兼容 mutation 覆盖若干结构项；含义/权限/identity/security 的完整识别与 major 决策不由 required mutation 证明。 |
| O24 / 339–343 | ①Protobuf 不重定义语义；②OpenAPI/Zod/serde 不各建 SSOT；③transport adapter 不改 ID/lifecycle | SOURCE-01/03、WIRE-05、§13.2–4 拆分重述；三个禁令没有因单份 transport 文件存在而获得整组强制认领。 |
| O25 / 347–356 | ①external API ingress；②跨 repo/process message ingress；③持久化读取；④event consumption；⑤migration/backfill；⑥external-provider response adapter；另有不逐内部函数验证、尽早转换 typed domain object | CI-04/SEC 与这些边界有关联，但后四类和附属策略未逐项明确承接；Moss pre-spawn 负例只证明选中调用边界，非六类全覆盖。 |
| O26 / 386–409 | family/api_version/kind；schema_id/schema_digest；semantic_adr_refs；owner/security_owner/producers/consumers；classification、secrets_allowed:false、large_payload/retention；compatibility.status 的 experimental/stable/deprecated、supersedes、removal_not_before | ROLE-01、§7、DIST-06 重构接口；稳定 schema_id 不等于 source path，schema/source/bundle digest 不互换，四层 lifecycle 不等于旧三态 compatibility，任意 policy string 不等于 secrets_allowed:false；未等价承接字段仍未决/未强制。 |
| O27 / 415–430 | package_version；git_commit；schema_bundle_digest；schemas；generated_artifacts 的 language/package/version/digest；created_at；与 bundle/fixtures/artifacts 一起发布供离线验证 | VERSION-01、DIST-06、§7/12 分层关联；created_at、聚合 bundle digest 精确接口未完整承接；候选可安装不代表已发布且离线完备，E4 只认领实际 Git 安装证据。 |
| O31 / 600–607 | 每 release 更新 producer versions、consumer versions、deprecated major、removal date/version、migration adapter、last conformance result；矩阵是 docs/CI input 而非 runtime discovery | §7、VERSION-01、DIST-06、MIGRATE-03 部分承接；固定历史 A 不能代替每次刷新六字段或 runtime-discovery 边界的完整强制。 |
| O32 / 617–628 | ①JSON Schema lint；②离线 $id/$ref；③valid fixtures；④invalid fixtures 拒绝；⑤TS/Rust roundtrip；⑥generated clean diff；⑦backward compatibility diff；⑧重复 kind/error/event code；⑨Secret denylist/annotation；⑩package/schema matrix；⑪release reproducibility；⑫license/SBOM/checksum | CI-01–05、COMPAT-05、DIST-06 只有部分 gate；E5/E6 的现有强制正面认领，未覆盖的多语言、registry、license/SBOM 等不由父 workflow 存在补齐。 |
| O34 / 688–703 | semantic owner；schema/code owner；producer list；consumer list；security reviewer；migration owner；supported-major policy；相邻 breaking-change 清单含 ADR/amendment、compatibility report、provider/consumer migration plan、dual-version window、rollback、removal gate | ROLE-01、GOV-01/03、§7、MIGRATE 对启用 family 部分重述；角色/策略/迁移证明分开看，整组治理及每次 breaking-change 执行未认领为自动强制。 |
| O36 / 713–730 | usercontent；classification；Secret policy；audit；retention；payload offload；redaction fields；cross-Zone；另有禁止 Secret bytes、credential ref/短 token、拒绝 unknown major、不降级 any、不无条件敏感 passthrough、不回显凭据、validation≠authorization | §7、SEC、COMPAT-02 关联；usercontent/audit/offload/redaction 具体字段未逐项明确承接，仍未决/未强制；当前局部 denylist/parser/诊断测试不认领所有安全注解与运行时行为。 |

### 18.5 已有机制、来源缺口与认领边界

本节记录 Main 于2026-09-22的核对，区分 Worker 的文档修订、Main 的单项已安装包测试重放和既有 hosted 结果复核。Main 在 Phase2 将 COMPAT-06、DIST-01、DIST-03 认领为当前完整机制：前者绑定现有 successor suite，后两者绑定 exact M 的 `contractsActivation.test.ts` suite；SOURCE-02 因具体来源绑定缺口保持 none。条款正文未收窄，三个认领限定当前规范指纹、准确 target、实现范围和必要证据，不是未来版本永久保证。

这三个认领同时绑定 Main 已审阅 workflow 的整文件字节，涵盖 root/job/step；任何字节变更或文件缺失都会产生 `broken-ci` 并要求重新复核三个 claim。这是固定快照的保守边界，不是通用 YAML 解析器或 CI 策略平台。

| 证据 / 条款 | 实际机制、反例或失败点 | 范围限定 |
|---|---|---|
| E1 / SOURCE-02 | [source.mjs](../../tools/contracts/source.mjs) L29–40、63–98、139–145 的完整 SHA、本地 Git object/repository、digest 检查已存在；默认 source tests 有实际执行。本地对照返回已提交 bytes 而非脏工作树，错误 digest 失败。 | 保留这些真实子机制；远端 path→commit 绑定缺口见下文，SOURCE-02 保持 none 的理由是此具体缺口，不是 future owner 或 missing-real-consumer。 |
| E2 / DIST-01、人工 H/L | Moss exact M `e9660ed1483cf01f96fe06c45ba7e070e0223ec3` 的 `src/server/__tests__/contractsActivation.test.ts` L97–204 检查 dependencySpec、lock、installed C 身份和43个 package paths；L115 精确等值断言拒绝 `#main`。M 的 `scripts/test-server.js` 纳入该 suite，`build-release.yml` 执行默认测试。 | 这是 actual default-CI exact-pin guard，不是 package.json 恰好有 SHA；引用固定 M，非可能漂移的本机 canonical Moss。#main/lock 漂移的失败条件由 Main 读实际断言核实；另有 A 测试中的 #main/caller/runner 负例，本次未改 Moss 做 mutation。Main 已按当前唯一真实 C→M 消费闭包裁定 DIST-01 完整认领，不将 A 当成所有未来提交的 watcher。 |
| E3 / COMPAT-06 | [successor-compatibility.mjs](../../tools/contracts/successor-compatibility.mjs) 把未知词汇、annotation/policy 变化等记为 manual_review；只有 no_contract_byte_change 可令 preflight_passed 为真，CLI 非通过 exit1。默认 npm test 包含 successor tests，CI 另运行固定历史→C pair。 | “不确定时拒绝自动通过并明确标记人工 review”的机制已确认；人工评审未完成或其它 consumer 未加入不否定它。Main 已按明确返回 manual_review 并阻断自动通过裁定 COMPAT-06 完整认领；这不认领人工评审结果已完成，也不新增审批队列或产品要求。 |
| E4 / DIST-03 | 真正 exact-Git 安装证据由 Moss M 的 clean CI install、E2 的 installed-package 身份/43 paths 检查及 C 的 owner closure/digest 组合提供；[package-smoke.mjs](../../tools/contracts/package-smoke.mjs) 自身执行的是 tarball 安装。 | Git 安装与 tarball smoke 分开认领；固定 C/M 证据不外推任意新候选。network-denied cache smoke 属于 DIST-06 等离线要求，不是 DIST-03 明示前置；Main 已按当前 M 的 clean CI Git 安装、43路径/manifest/digest 检查与 A 证据组合裁定 DIST-03 完整认领。 |
| E5 / O33、CI-01/02 子要求 | [ResourceRef conformance](../../contracts/common/v1/resource-ref/conformance.test.mjs) L34、65、78 遍历25 Nexus fixtures、12 ZoneId vectors、23 ZonePath cases并核对实际 validator/parser；另有 [ZoneId conformance](../../contracts/zone-id/conformance.test.mjs)，均属于默认 npm test。 | 当前声明 fixture 子集的 expected-reject 被错误接受会使测试失败；不声称每个 fixture 都另跑过 mutation，不外推未来 family/语言、生产消费或原十二项 CI 全部完成。 |
| E6 / 人工 G 的 generated clean-diff | [generated-drift.test.mjs](../../tools/contracts/generated-drift.test.mjs) 的 `offline gates catch contradictory provenance and generated hand edits` 在临时 fixture 改动 generated TS，运行真实 generate --check --offline 并要求失败；默认 npm test 执行。 | 当前登记 generated closure 的 clean-diff 子规则已被实际测试，不只是脚本存在；父级 CI-02 为 partial 不抹去这一子机制。 |

Main 于2026-09-22T04:51:21Z 在已逐字核对 M 的 package.json、bun.lock、该 test 和 nexusManager.ts 的隔离环境中，仅重放 `pins Candidate2 and verifies the installed unfrozen` 包身份测试：Bun 1.3.13，1 pass / 4 filtered out / 0 fail / 30 expect。既有 installed C 未重装，结束四文件不变，仅清理临时 pack；没有服务器、配置、数据库操作。Main 又于04:55:11Z重查 [M 的 server-tests job](https://github.com/sudoprivacy/moss/actions/runs/35502080415/job/106055515466)：head SHA 为完整 M，completed/success，Checkout moss、Install dependencies、Run server tests 均 success；这是复核既有 hosted 结果，不是新触发 CI，也不是全 Moss suite 重跑。

SOURCE-02 的反例针对未改动 [source.mjs](../../tools/contracts/source.mjs) L108–130（URL 拼接在L113）及完整 `loadOwnerClosure({mode:'remote'})`：Main 仅在一次性副本把临时 lock 的 schema path 改成 `../audit-mutable-branch/src/nexus/contracts/schemas/common/v1/resource-ref.schema.json`，保留原40位 provenance/definition revisions 和 digest；mock fetch 按 WHATWG URL 归一化，模拟分支返回原 pin 的真实 schema bytes，其它请求由真实 pinned Git blobs 回答。完整 closure 返回成功，provenance/definition 两次 schema 请求的实际 ref 均被归一化为 `audit-mutable-branch`，而不是声明的 immutable commit。

该实测没有访问真实网络或创建/推送远端分支；证明的是 source-input loader 的 path→commit 来源绑定缺口，不是内容完整性绕过。接受的仍是原 pin 同一 schema bytes，digest 未被绕过；不据此声称任意 schema/Secret/payload 可通过，亦未证明安全路径下的当前 C bytes、完整候选/发布门禁或本机实例受影响。本次仅登记文档事实，不修 source loader。

Main 的补充检查实际运行 source、generated-drift、successor 和 ResourceRef conformance 相关套件，合计61 tests/61 pass/0 fail/0 skipped；上述临时探针是另行实测，不冒称已有永久回归或默认 CI 覆盖。已有测试通过、E1 来源缺口、E2–E6 的局部强制可同时成立，既不由某个父条款的 none 抹去已有机制，也不以局部通过认领原39块全部等价承接、整条完整强制、ADR Accepted 或环境发布。
