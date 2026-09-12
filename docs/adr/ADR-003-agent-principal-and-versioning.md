# ADR-003：Agent Principal、Version、Channel 与运行时证明

- 状态：Proposed
- 日期：2026-09-12
- 决策范围：Sudo Agent Registry、Moss 治理、Nexus identity、sudocode runtime
- 目标契约版本：`agent.sudo.dev/v1`
- 相关文档：
  - [`Sudo 跨仓语义与六契约设计`](../design/cross-repo-contracts-semantics-design-v1.0.md)
  - [`ADR-001：标识及生命周期`](./ADR-001-identifiers-and-lifecycle.md)
  - [`ADR-002：Zone 与多租户`](./ADR-002-zone-and-tenancy-model.md)

---

## 1. 背景

当前产品和源码中“Agent”可能指：

- 一个长期命名的办公专家；
- Moss `assistants/{system,hub,custom,tenant}` 目录；
- sudocode runtime profile；
- Nexus AgentRegistry 中的一个 PID descriptor；
- Agent certificate/DID；
- 某个容器镜像；
- 某个 Prompt/Skill 配置；
- Nexus 当前用于资源调度的 `AgentSpec`；
- 一次具体运行。

如果不分层，会产生：

- Agent 升级一次是否变成新身份；
- Memory 属于 Agent 还是某个镜像版本；
- 撤销漏洞版本是否等于删除整个 Agent；
- historical Session resume 是否自动使用最新版本；
- 审计能否证明当时实际运行的 Prompt、Skill、代码和镜像；
- 同名 Agent 在不同组织/CA/trust domain 下是否冲突；
- certificate rotate 是否改变 principal；
- 产品 AgentSpec 与 Nexus scheduling AgentSpec 同名异义。

当前代码基础：

- Nexus auth provider 支持 user/agent subject；
- mTLS peer identity 支持 trust-domain-qualified foreign Agent；
- AgentRegistry 已分 name 与 PID；
- Moss 有 assistant catalog、审批和目录；
- sudocode 可按 model/tools/system prompt 构造 runtime；
- Nexus 当前 [`AgentSpec`](https://github.com/nexi-lab/nexus/blob/dd707c0cc453514b88b53afc2b6e0edb64ab2345/src/nexus/contracts/agent_types.py) 已保存资源请求、能力和 Zone affinity。

需要将这些能力组合成一个稳定产品模型，而不是再新增一个含糊的 `agent_id`。

---

## 2. 决策

### 2.1 Agent 分为四层

```text
Agent Principal       长期身份：是谁
Agent Version         不可变发布：具体是什么版本
Agent Channel/Alias   可变指针：当前推荐哪个版本
Runtime Instance      一次运行：哪个 pid 正在执行
```

这四层必须使用不同字段和生命周期。

### 2.2 Agent Principal

完整 principal key：

```text
(trust_domain, agent_name)
```

规范 URI：

```text
nexus://{trust_domain}/agent/{agent_name}
```

示例：

```text
nexus://sudo.cloud/agent/finance-auditor
nexus://acme.internal/agent/finance-auditor
```

两者名称相同，但 principal 不同。

Agent Principal 表示：

- 长期 identity；
- ReBAC subject；
- Session index owner；
- 长期 Memory owner；
- Agent version 集合；
- governance/approval root；
- certificate identity target。

规则：

- `agent_name` 在一个 trust domain 内唯一；
- principal 创建后不可通过 rename 原地改变 identity；
- display name 可变；
- rename 需求通过新 principal + alias/migration 实现；
- principal 不因进程退出、版本发布或证书 rotate 消失；
- principal revoke 与 version/certificate revoke 分开。

### 2.3 Agent Version

Agent Version 是不可变发布快照，由：

```text
(principal, version)
```

标识，并由 digest 证明具体内容。

Agent Version 的 canonical 数据模型见 §3.2 `AgentVersionManifest`。在决策层面，它只包含 immutable refs/digests、发布者和签名；完整 `ProductAgentSpec` 由 `spec_ref + spec_digest` 固定，approved/deprecated/revoked 等可变治理状态不属于 manifest。

规则：

- 已发布 version manifest 不可原地修改；
- approved/deprecated/revoked 等治理状态不写回 immutable manifest，而由 append-only Approval/Deprecation/Revocation records 投影；
- Prompt、Skill、Tool definition、代码包、image、默认配置必须由 version manifest 或 refs/digests 固定；
- 修改任一受版本管理的内容必须发布新 version；
- mutable runtime setting 必须有独立 version/config snapshot ref；
- `latest` 不能写入 PID/Session audit；
- version label 建议使用 SemVer，release candidate 可使用标准 prerelease；
- digest 是供应链事实，version label 是人类可读标识；两者都必须记录。

### 2.4 Agent Channel/Alias

Channel 是指向具体 Agent Version 的可变 alias：

```text
finance-auditor@stable -> 1.4.2
finance-auditor@canary -> 1.5.0-rc.1
```

规则：

- channel 更新是独立审计事件；
- Runtime start 前必须解析 channel；
- Resolution 结果必须固化 exact version/digests；
- PID 不能运行过程中随 channel 漂移；
- 恢复既有 Attempt 时继续该 Attempt 的 exact version；新 Task 重新 Resolution；
- 显式 upgrade 才重新解析 channel 或选择新 version；
- channel 不能指向 revoked version。

### 2.5 Runtime Instance

Runtime PID 必须记录：

```ts
interface RuntimeAgentBinding {
  principal: AgentPrincipalRef
  version: string
  spec_digest: string
  image_digest?: string
  resolved_from_channel?: string
  resolution_time: string
  approval_snapshot_ref?: ResourceRef
}
```

运行时不只记录 Agent name。审计必须能够回答：

- 哪个 principal；
- 哪个 version；
- 哪个 spec/image/package digest；
- 由哪个 channel 解析；
- 使用哪个 approval/policy snapshot；
- 哪个 PID/Attempt/Session。

### 2.6 产品 AgentSpec

产品 AgentSpec 是 Agent Version manifest 的 `spec_ref` 指向并由 `spec_digest` 固定的完整 desired configuration，不等于 PID descriptor，也不等于单独 scheduling spec。

建议结构：

```ts
interface ProductAgentSpec {
  identity: {
    principal: AgentPrincipalRef
    display_name: string
    description?: string
  }

  runtime: {
    engine: 'sudocode' | string
    entrypoint?: string
    image_ref?: ResourceRef
    package_ref?: ResourceRef
    model_policy_ref?: ResourceRef
  }

  capabilities: {
    declared: string[]
    tool_refs: ResourceRef[]
    skill_refs: ResourceRef[]
  }

  permissions: {
    requested: string[]
    data_classifications: string[]
  }

  contract: {
    input_schema_ref?: ResourceRef
    output_schema_ref?: ResourceRef
    default_rubric_ref?: ResourceRef
  }

  governance: {
    owner: PrincipalRef
    approvers: PrincipalRef[]
    approval_policy_ref?: ResourceRef
  }

  scheduling: AgentSchedulingSpec
}
```

### 2.7 Nexus 当前 AgentSpec 更名

Nexus 当前 [`AgentSpec`](https://github.com/nexi-lab/nexus/blob/dd707c0cc453514b88b53afc2b6e0edb64ab2345/src/nexus/contracts/agent_types.py) 包含：

- `agent_type`；
- capabilities；
- resource requests/limits；
- QoS；
- Zone affinity；
- spec generation。

它表达的是调度 desired state，因此本 ADR 决定将其语义名称改为：

```text
AgentSchedulingSpec
```

迁移方式：

- 先增加新名称和 deprecated alias；
- 更新文档/serialization mapping；
- 不在一次 PR 中全仓机械改名；
- product AgentSpec 的 `scheduling` 字段复用它；
- serialized legacy `agent_spec` column 可暂保，增加 schema kind/version 区分。

### 2.8 Certificate 与 Principal/Version 分离

Certificate 证明持有者是某个 principal 或 runtime subject；它不是 Agent Version。

规则：

- principal certificate SAN/subject 表达 principal identity；
- certificate rotate 不改变 principal；
- certificate revoke 只撤销该 credential；
- Agent Version 由 signed manifest/digest 证明；
- runtime token/metadata 将 principal 与 exact version/digest 绑定；
- 不把 image digest 直接编码成 principal DID；
- foreign Agent identity 必须 trust-domain-qualified；
- version approval 与 CA trust 是两个独立 gate。

### 2.9 Memory 归属

- 长期 Agent Memory 绑定 principal；
- version-specific cache 绑定 version；
- Session transcript 记录每个 Attempt/PID 使用的 exact version；
- Prompt/Skill/package 属于 immutable version；
- version upgrade 不自动删除 principal Memory；
- principal revoke 后停止新增读写，历史数据按 retention/ownership policy 处理；
- version revoke 不删除 principal Memory。

### 2.10 Session resume 版本策略

本 ADR 决定：

- 恢复既有 Attempt 时继续该 Attempt 固化的 exact version；
- 在同一 Session 创建新 Task 时，仍使用 Session 固定的 Agent Principal，但按新 Task 的 version/channel request 重新 Resolution；
- 既有 Attempt 不能自动跟随 stable/latest channel；
- 用户或 policy 可显式请求 upgrade；
- upgrade 创建新 Attempt，并记录 from/to version；
- 如果原 version deprecated，允许 resume但提示；
- 如果原 version revoked，禁止启动新 PID，返回 `AGENT_VERSION_REVOKED`；
- revoked version 的 historical transcript 仍按数据权限可读；
- 用户可显式升级到 approved version 后继续。

---

## 3. 数据模型

### 3.1 AgentPrincipal

```ts
interface AgentPrincipal {
  api_version: 'agent.sudo.dev/v1'
  kind: 'AgentPrincipal'

  trust_domain: string
  agent_name: string
  principal_uri: string

  display_name: string
  description?: string
  owner: PrincipalRef

  status: 'active' | 'suspended' | 'revoked'
  created_at: string
  updated_at: string
}
```

### 3.2 AgentVersionManifest

```ts
interface AgentVersionManifest {
  api_version: 'agent.sudo.dev/v1'
  kind: 'AgentVersionManifest'

  principal: AgentPrincipalRef
  version: string

  spec_ref: ResourceRef
  spec_digest: string
  image_ref?: ResourceRef
  image_digest?: string
  package_ref?: ResourceRef
  package_digest?: string

  prompt_refs: ResourceRef[]
  skill_refs: ResourceRef[]
  tool_refs: ResourceRef[]

  published_at: string
  published_by: PrincipalRef
  signed_by: string
  signature_ref: ResourceRef
}
```

### 3.3 AgentChannel

```ts
interface AgentChannel {
  api_version: 'agent.sudo.dev/v1'
  kind: 'AgentChannel'

  principal: AgentPrincipalRef
  channel: string
  target_version: string
  target_spec_digest: string

  updated_at: string
  updated_by: PrincipalRef
  reason: string
}
```

### 3.4 Approval

```ts
interface AgentApprovalRecord {
  approval_id: string
  principal: AgentPrincipalRef
  version: string
  scope: {
    organization_id?: string
    zone_id?: string
    max_data_classification?: string
  }
  decision: 'approved' | 'withdrawn'
  decided_by: PrincipalRef
  policy_version: string
  decided_at: string
  expires_at?: string
  reason: string
}
```

`AgentApprovalRecord` 是 append-only decision；过期由 `expires_at + 当前时间` 投影，withdraw 使用新 record，不覆盖原 approval。

### 3.5 Deprecation、Revocation 与治理状态投影

```ts
interface AgentVersionGovernanceRecord {
  governance_record_id: string
  principal: AgentPrincipalRef
  version: string
  action: 'deprecated' | 'undeprecated' | 'revoked'
  scope?: {
    organization_id?: string
    zone_id?: string
  }
  decided_by: PrincipalRef
  policy_version: string
  decided_at: string
  reason: string
}

interface AgentVersionGovernanceState {
  principal: AgentPrincipalRef
  version: string
  status: 'pending' | 'approved' | 'deprecated' | 'revoked'
  source_record_ids: string[]
  evaluated_at: string
}
```

`AgentVersionGovernanceState` 是可重建 projection，不写回 `AgentVersionManifest`。`revoked` 是单向终态；若需要恢复同一内容，发布新 version，而不是 un-revoke 原 version。

---

## 4. Registry 路径

Zone-scoped logical layout：

```text
/agents/{agent-name}/
  principal.json
  memory/
  versions/
    1.4.2/
      manifest.json
      spec.json
      prompts/
      skills/
      tools/
      governance/
        approvals/
        decisions/
  channels/
    stable -> ../versions/1.4.2
    canary -> ../versions/1.5.0-rc.1
  sessions/
    {sid} -> /sessions/{sid}
```

同名 foreign principal 通过 trust domain/Zone registry context 区分。物理路径编码必须防止 name/path injection；principal identity 不只由裸路径字符串决定。

规则：

- `/agents/{name}` 是 principal root；
- version manifest/spec/prompt/skill/tool 内容不可修改；
- approval/deprecation/revocation 作为 `governance/` 下 append-only records，状态按记录投影；
- channel 使用 link/ref，不复制 version；
- sessions 为枚举 index，不是 Session SSOT；
- Memory 绑定 principal；
- Registry API 负责 path materialization，consumer 不直接拼路径写 manifest。

---

## 5. API 决策

建议 product Registry API：

```text
POST   /v2/agents
GET    /v2/agents/{principal}
PATCH  /v2/agents/{principal}                   # display metadata/status only
POST   /v2/agents/{principal}/versions
GET    /v2/agents/{principal}/versions
GET    /v2/agents/{principal}/versions/{version}
POST   /v2/agents/{principal}/versions/{version}/approve
POST   /v2/agents/{principal}/versions/{version}/revoke
PUT    /v2/agents/{principal}/channels/{channel}
GET    /v2/agents/{principal}/channels/{channel}
POST   /v2/agents/{principal}/certificates
POST   /v2/agents/{principal}/certificates/{cert_id}/revoke
```

规则：

- create principal 与 publish version 分开；
- publish version 验签、digest 和 schema；
- version conflict 不允许覆盖；
- channel update 需 optimistic concurrency/idempotency；
- approval 按 Org/Zone/data-classification scope；
- revoke 是持久状态转换，不删除历史 manifest；
- runtime resolution 只返回 approved、非 revoked exact version。

---

## 6. 权威 Writer 与 Reader

| 数据 | 权威 writer | SSOT | Reader/Projection |
|---|---|---|---|
| Principal | Agent Registry | Nexus Agent image | Moss governance、SudoWork UI |
| Version manifest | Release/Registry service | Nexus Agent version tree | Moss resolver、sudocode runtime |
| Channel | Registry admin/service | Nexus channel ref | Moss resolution |
| Approval | Moss governance decision，通过 Registry API 写入 | Nexus approval record + Moss audit projection | Runtime resolver |
| Certificate | CA/Credential service | CA records/CRL + Registry ref | Nexus auth |
| PID binding | Managed Runtime | Nexus RuntimeRun/AgentRegistry | Audit/UI |
| Principal Memory | authorized Agent/Memory service | Nexus memory tree | sudocode Context assembly |

---

## 7. 生命周期

### 7.1 创建与发布

```text
create principal
-> publish immutable version manifest
-> supply-chain validation/signature
-> governance approval
-> point stable/canary channel
-> eligible for runtime resolution
```

### 7.2 Runtime resolution

```text
Task requests principal + channel/version
-> Registry resolves exact version
-> Moss checks approval/policy
-> Resolution stores version/digests
-> Nexus starts PID with immutable binding
```

### 7.3 Upgrade

```text
publish 1.5.0
-> approve
-> stable channel moves 1.4.2 -> 1.5.0
-> new Tasks resolve 1.5.0
-> an existing in-flight Attempt resumes 1.4.2
-> an explicit upgrade of that Task creates a new Attempt on 1.5.0
```

### 7.4 Revoke

- Principal revoked：禁止所有 version 创建新 PID，撤销/终止 active execution 按安全 policy；
- Version revoked：只禁止该 version 创建新 PID，active PID 默认终止；
- Certificate revoked：该 credential 立即无效，可重新签发而不改 principal/version；
- Approval withdrawn：该 scope 内不能创建新 PID，其他 scope 不受影响；
- Channel 指向 revoked target：Registry 标记 invalid 并禁止 resolution。

历史 record 不删除。

---

## 8. 安全边界

- principal identity 来自 authenticated credential/Registry，不信任 payload 裸 `agent_id`；
- version manifest 必须签名并校验 digest；
- Runtime 必须把 resolved Agent binding 写入 Session/Attempt/PID；
- Agent version 请求权限不等于实际授权，仍需 delegation + Zone/ReBAC；
- principal certificate 不自动获得 tenant Zone；
- foreign principal 使用 trust-domain-qualified ID；
- same-name Agent 不能因 path 或 mailbox 名称碰撞冒充；
- mutable channel 不进入执行中的 PID 决策；
- Secret value 不进入 AgentSpec/version manifest。

---

## 9. 兼容与迁移

### 9.1 Moss assistant directories

当前：

```text
~/.moss/assistants/{system,hub,custom,tenant}
```

迁移：

1. 扫描并生成 principal candidate；
2. 计算 Prompt/Skill/resource digest；
3. 生成 version manifest；
4. 映射现有审批/status；
5. dry-run 冲突；
6. publish Registry；
7. Moss 改为 Registry client + materialization cache；
8. 双读比较；
9. 切读 Registry；
10. 最后禁用目录直接写。

目录名不自动等于 trust-domain-qualified principal；migration 必须携带所属组织/trust domain。

### 9.2 Nexus AgentSpec

- 增加 `AgentSchedulingSpec` 新名称；
- 保留 deprecated `AgentSpec` alias；
- JSON storage 增加 schema kind/version；
- product AgentVersion manifest 引用 scheduling；
- consumer 分阶段升级；
- alias 移除需要 major/breaking release。

### 9.3 sudocode co-host

当前 co-host 主要从 descriptor labels 读取 model，tools/profile 仍简化。

迁移：

- Runtime 接收 AgentVersionRef；
- 从 immutable manifest 解析 model/tool/skill/prompt/permission request；
- PID binding 写 version/digest；
- 不在代码中依赖 `DEFAULT_MODEL` 作为正式 production policy；
- standalone CLI 继续支持本地 implicit profile，但 export/import 时生成显式 AgentVersion。

### 9.4 Session history

- historical record 只有 Agent name 时标记 legacy unresolved version；
- 能从 release/deploy metadata 推断时做 backfill，并记录推断来源；
- 无法推断时不伪造 digest；
- 正式新事件禁止 `version: unknown`；
- legacy 查询可展示 `legacy_unresolved`，但不能用于重新启动受治理 Agent。

---

## 10. 被拒绝的方案

### 10.1 Agent Version 就是新 Principal

拒绝。会导致 Memory、权限、Session 和治理历史在每次升级时断裂。

### 10.2 Principal DID 绑定 image digest

拒绝作为长期 identity。image digest 属于 Version/attestation；principal 应跨版本稳定。

### 10.3 Version 可原地修改

拒绝。无法审计、回滚或证明历史执行内容。

### 10.4 Runtime 保存 `latest`

拒绝。Channel 可变化，历史不可复现；Runtime 必须锁 exact version/digest。

### 10.5 Certificate 等于 Agent Version

拒绝。credential rotate/revoke 与软件 version 生命周期不同。

### 10.6 一个 `disabled` 表示所有撤销

拒绝。principal、version、certificate、approval 的影响范围和恢复方式不同。

### 10.7 Moss assistant 目录继续作为全局 Registry SSOT

拒绝。无法统一 Cloud/Private/Edge、多节点、版本与供应链证明；可作为迁移 materialization/cache。

---

## 11. 后果

### 正面

- Agent 可持续升级而保持 identity/Memory；
- 可精确回滚和撤销单个版本；
- 证书轮换不改变 principal；
- Session resume 具备稳定版本语义；
- Trace/Audit 能证明谁以哪个版本执行；
- Cloud/Private 可执行不同 approval policy；
- 同名跨 trust domain Agent 不冲突。

### 成本

- Registry 数据模型增加 principal/version/channel/approval/certificate；
- Moss assistant 目录需迁移；
- Runtime start 必须多携带 version/digest；
- Session upgrade 需要显式 UX；
- 历史版本不完整时需标记 unresolved；
- Nexus 当前 AgentSpec 需要渐进式更名。

---

## 12. 验收标准

1. 发布新 Agent Version 不改变 principal；
2. version manifest 原地覆盖被拒绝；
3. stable channel 更新不影响已运行 PID；
4. 恢复既有 Attempt 默认继续该 Attempt 的 exact version；同一 Session 的新 Task 重新 Resolution；
5. 显式 upgrade 创建新 Attempt；
6. revoked version 不能启动新 PID；
7. principal revoke、version revoke、certificate revoke、approval withdrawal 可独立测试；
8. Agent principal Memory 在升级/回滚后保持；
9. runtime metadata 包含 principal/version/spec/image digest；
10. 不同 trust domain 同名 Agent 不碰撞；
11. `AgentSchedulingSpec` 与产品 AgentSpec 无歧义；
12. 正式新事件无 Agent version `unknown`。

---

## 13. 开放实现选择

不改变本 ADR 语义的实现选择：

- Registry metadata 具体使用 JSON document、SQL projection 或二者；
- Agent package 是否必须有 container image；
- signing implementation/CA 产品；
- channel optimistic concurrency 的 ETag/revision 形式；
- version artifact 的离线镜像分发方式。

---

## 14. 生效与替代

本 ADR 被接受后：

- `agent_id` 不得继续同时表示 principal、version、profile、PID；
- 新 Runtime start 必须锁 exact version/digest；
- Nexus scheduling `AgentSpec` 进入 deprecated alias 迁移；
- image digest 不再作为长期 principal identity；
- 任意改变 resume version 默认行为的需求必须另写 ADR。
