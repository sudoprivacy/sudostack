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
- **ADR005-COMPAT-06**：checker 无法确定兼容时不得默认通过；结果必须进入人工 compatibility review。`[enforced_by: none]`

## 9. v0 分发与未来发布

### 9.1 当前 v0.x 入口

- **ADR005-DIST-01**：第一阶段统一 TypeScript consumer 入口为 `@sudo/contracts`，由 `sudostack` 装配；consumer 必须 pin `sudostack` 的 exact Git commit，不得依赖浮动 branch。`[enforced_by: none]`
- **ADR005-DIST-02**：v0.x package 的 `private: true` 表示禁止误发布到 npm registry；它不表示访问控制、安全审查、稳定性或已发布状态。`[enforced_by: none]`
- **ADR005-DIST-03**：package registry 不是 v0 prerequisite；exact Git revision 必须在 clean checkout 中可安装，并保留 owner source closure 与 artifact digest。`[enforced_by: none]`
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

当前 `sudostack` 已形成可复现的 F1 局部实现证据：Nexus 与 nexus-vfs 的 exact-pinned owner closure 已闭合，并可通过本地 checkout、物化的 offline bundle 和已发布的远端 revisions 验证；generated candidate/source-closure manifests、activation metadata 与 source-availability operation 记录候选内容、激活关系和 availability-only override；默认 gates 已提供 conformance、compatibility mutation、manifest/digest 以及 clean pack/install/import evidence。

这些证据证明 owner → exact closure → derive → candidate activation/availability → package verification 链路，但不改变治理、发布或部署状态：本 ADR 仍为 `Proposed`，所有规范性条款仍标记为 `enforced_by: none`，artifact 仍为 `candidate_unpublished`，deployment evidence 仍为 `not_deployed`，actual producers/consumers 仍为空，production-boundary adoption 仍未得到证明。因此这些局部证据不构成 ADR `Accepted`、registry release、真实 consumer adoption 或 deployment 完成。

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
→ draft-frozen baseline
→ candidate/release artifact（如获授权）
→ consumer exact-pin PR + production boundary tests
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

- F1 必须满足第 7 节完整 draft-frozen baseline 后才能供 consumer pin；`[enforced_by: none]`
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
