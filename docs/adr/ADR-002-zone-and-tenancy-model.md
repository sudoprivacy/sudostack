# ADR-002：Zone 与多租户安全模型

- 状态：Proposed
- 日期：2026-09-12
- 决策范围：Sudo Cloud、Sudo Private、SudoEdge、Nexus federation
- 目标契约版本：`common.sudo.dev/v1`、`auth.sudo.dev/v1`
- 相关文档：
  - [`Sudo 跨仓语义与六契约设计`](../design/cross-repo-contracts-semantics-design-v1.0.md)
  - [`ADR-001：标识及生命周期`](./ADR-001-identifiers-and-lifecycle.md)

---

## 1. 背景

现有文档和代码中同时存在几种 Zone 口径：

- 一用户/一租户一个 Zone；
- Org 与 Zone 等价；
- Org 与 Zone 解耦；
- tenant-first Zone；
- `sessions`、`repos`、`agents` 等 content-type-first Zone；
- Zone 既作为 VFS routing 标识，又作为业务组织路径前缀。

这些口径会直接影响：

- 路径结构；
- API key 的 `zone_perms`；
- ReBAC tuple；
- 组织改名、合并和拆分；
- Cloud/Private/Core 数据出域；
- Agent 在哪个权限域执行；
- Session 是否能引用其他 Zone 的 Repo；
- 备份、迁移、删除和审计单位；
- grant 撤销是否影响运行中 PID。

当前代码已有可复用基础：

- [`nexus/src/nexus/bricks/auth/zone_helpers.py`](https://github.com/nexi-lab/nexus/blob/dd707c0cc453514b88b53afc2b6e0edb64ab2345/src/nexus/bricks/auth/zone_helpers.py) 的 Zone ID 校验和 ZoneModel；
- Nexus `api_key_zones` junction；
- [`nexus-vfs/rust/permission/src/zone_perms.rs`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/permission/src/zone_perms.rs) 的 path-aware `ZonePermsProvider`；
- Nexus Python/Rust ReBAC；
- foreign CA/trust domain；
- VFS mount/DT_LINK/federation。

但当前生产装配可能没有 permission provider；permission slot 为空时 kernel 直接允许访问，因此仅“已有 Zone/ReBAC 代码”不等于已形成安全边界。

---

## 2. 决策

### 2.1 Zone 定义

> Zone 是 Nexus 中不可隐式跨越、不可因业务组织改名而迁移的持久安全、数据归属与复制边界。

Zone 具有：

- 稳定 `zone_id`；
- 可变 display name；
- 数据存储和 Raft/federation 归属；
- 独立权限关系；
- 审计、备份、迁移和删除边界；
- deployment/trust metadata。

Zone 不是：

- 组织显示名称；
- 单纯目录前缀；
- 内容类型；
- 用户 role；
- 自动获得的跨域访问通行证。

### 2.2 Org 定义

Org 是 Moss 管理的业务对象，负责：

- 成员；
- 部门；
- 角色；
- 计费；
- 审批；
- 组织策略；
- 企业身份源映射。

Org 可以：

- 改名；
- 合并；
- 拆分；
- 更换成员；
- 同时访问多个 Zone。

Org 不拥有数据路径本身，而是通过 ZoneGrant 获得访问关系。

### 2.3 Org 与 Zone 是多对多

```text
User --member--> Org
Org  --grant--> Zone
User/Agent/Service --direct grant--> Zone（受政策限制）
```

v1 必须支持：

- 一个 Org 访问多个 Zone；
- 一个 Zone 在合并/迁移期被多个 Org 访问；
- grant 独立撤销；
- Org 改名不改变 Zone ID；
- Org 删除不自动删除 Zone 数据。

默认 onboarding MAY 为一个新 Org 创建一个 default Office Zone，但这只是 provisioning policy，不是“Org 恒等于 Zone”的数据模型。

### 2.4 Zone ID

复用现有 Nexus 格式：

- 长度 3–63；
- lowercase alphanumeric + hyphen；
- 不以 hyphen 开头或结尾；
- reserved IDs 禁止租户创建；
- 创建后不可修改；
- display name 单独存储。

示例：

```text
cloud-user-1001
private-acme-office
private-acme-core
edge-device-01
```

Zone ID SHOULD 不直接使用公司显示名称。可在创建时由名称生成候选 slug，但一经创建永久稳定。

### 2.5 Reserved Zones

至少区分：

- root/system Zone：kernel 与本地系统路径；
- control Zone：auth keys、ReBAC tuples、foreign CA、registry metadata；
- tenant/data Zones：用户与企业数据。

规则：

- 普通用户/Agent 不因 token 缺少 Zone 而默认落 root；
- root/control Zone 只有明确 system/admin capability 可访问；
- tenant Zone grant 不隐含 control Zone 权限；
- production authentication 无法解析 Zone 时拒绝。

### 2.6 Resource identity

跨仓 ResourceRef MUST 使用：

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

其中 path 是 Zone 内绝对路径，例如：

```text
zone_id = private-acme-office
path    = /sessions/sess_123
```

普通 Runtime 不通过手工拼接：

```text
/{zone}/sessions/...
```

切换 Zone。Zone 是 authenticated context/routing metadata，不是可通过路径字符串绕过的目录。

管理平面 MAY 提供只读的全局投影视图：

```text
/zones/{zone_id}/...
```

但该视图不改变普通 syscall 的 Zone 授权语义。

### 2.7 Session home Zone

每个 Session MUST 有不可变 `home_zone_id`。

规则：

- Session metadata、Task、Transcript、Context、Artifact 和 Verify record 默认写 home Zone；
- 一个 Session MAY 引用其他 Zone 的 Repo、dataset 或 Memory；
- cross-Zone resource 必须使用 ResourceRef；
- 每次访问重新验证当前 grant/ReBAC；
- Session home Zone 不因引用外部资源而改变；
- 将数据复制进 home Zone 是显式数据移动操作，不是 mount/link 的隐含效果。

### 2.8 Attempt execution Zone

每个 Attempt MUST 固化 `execution_zone_id`。

- 默认等于 Session home Zone；
- 如果在其他 Zone 执行，Moss policy 必须明确接受并记录原因；
- Runtime PID 绑定 execution Zone；
- Context 组装需验证所有 ResourceRef 可在 execution Zone 的 policy 下使用；
- Agent 不因运行于某 Zone 自动得到该 Zone 全部权限。

### 2.9 跨 Zone 访问

跨 Zone 默认拒绝，只能通过以下显式机制：

1. ZoneGrant + ReBAC relation；
2. federation mount；
3. DT_LINK 指向带 Zone identity 的 ResourceRef；
4. 显式 copy/export/import 数据移动。

规则：

- mount/link 不复制数据；
- link follow MUST 对目标 Zone 和 resource 重新授权；
- link 权限不是 capability transfer；
- source Zone 的权限不自动传播到 target Zone；
- copy 必须检查 source read + target write + data egress policy，并产生 Audit；
- path knowledge 不等于 permission。

### 2.10 Cloud、Private、Core 与 Zone

Cloud/Private/Edge 是部署位置和托管模型，Zone 是数据/安全边界。两者不是同一枚举。

默认：

- Sudo Cloud tenant data 与客户 Private data 在不同 Zone/trust boundary；
- Private Office 与 Private Core SHOULD 是不同 Zone；
- Core 数据不得因 Cloud runtime 可用而自动 fallback；
- cross-location federation 必须显式登记 CA/trust domain、ZoneGrant 和 data policy；
- 同一 Zone 是否跨多节点复制由 Zone federation policy 决定，但不得无意跨越 Cloud/Private trust boundary。

### 2.11 权限是 ZoneGrant 与 ReBAC 的交集

对非 system caller：

```text
Allowed = valid identity
       ∩ valid delegation
       ∩ ZoneGrant permits operation
       ∩ ReBAC permits resource relation
       ∩ Task/data policy permits use/egress
       ∩ runtime restrictions
```

其中第一层必须完成到：

```text
valid identity ∩ ZoneGrant ∩ ReBAC
```

Task/data/tool policy 在后续 Epic 加入。

仅有 ZoneGrant 不代表可以访问 Zone 内所有 resource；仅有 ReBAC tuple 但没有 ZoneGrant 同样拒绝。

### 2.12 默认 fail-closed

生产 profile 中：

- auth provider 缺失：拒绝启动或拒绝 external request；
- permission provider 缺失：拒绝启动；
- Zone 不可解析：拒绝；
- grant store/ReBAC store 出错：拒绝；
- delegation 过期/撤销：拒绝；
- policy version 不可用：拒绝；
- cross-Zone target 不明：拒绝。

可信 loopback local mode MAY 使用显式 NoAuth/no-permission development posture，但必须：

- 只绑定 loopback；
- 日志明确警告；
- 不作为 Cloud/Private production artifact；
- 不能通过一次改 bind address 静默变成可远程访问。

---

## 3. Zone 数据模型

```ts
interface Zone {
  api_version: 'auth.sudo.dev/v1'
  kind: 'Zone'

  zone_id: string
  display_name: string
  description?: string
  status: 'active' | 'suspended' | 'deleting' | 'deleted'

  deployment: {
    location: 'cloud' | 'private' | 'edge'
    domain?: 'office' | 'core' | 'general'
    trust_domain: string
  }

  created_by: PrincipalRef
  created_at: string
  updated_at: string
}
```

`display_name`、description 和部分 deployment metadata 可修改；`zone_id`、原始 trust domain/ownership history 不原地修改。

## 3.1 ZoneGrant

```ts
interface ZoneGrant {
  api_version: 'auth.sudo.dev/v1'
  kind: 'ZoneGrant'

  grant_id: string
  zone_id: string

  grantee: {
    subject_type: 'organization' | 'user' | 'agent' | 'service'
    subject_id: string
    trust_domain?: string
  }

  permissions: Array<'read' | 'write' | 'manage'>
  resource_prefixes?: string[]

  issued_by: PrincipalRef
  reason: string
  policy_version: string
  created_at: string
  expires_at?: string

  status: 'active' | 'revoked' | 'expired'
  revoked_at?: string
  revoked_by?: PrincipalRef
  revoke_reason?: string
}
```

ZoneGrant 是可审计业务记录。它 MAY 投影成：

- API key `zone_perms`；
- ReBAC tuple；
- permission cache entry。

但这些投影不替代 ZoneGrant history。

## 3.2 Membership

Org membership 的 SSOT 在 Moss：

```ts
interface Membership {
  organization_id: string
  user_id: string
  role: string
  status: 'active' | 'suspended' | 'removed'
}
```

Moss 将“用户通过 Org 获得 Zone 权限”的结果映射为 Nexus 可以验证的 subject/grant/delegation，不把整个 Org 数据库复制进 Nexus。

---

## 4. ReBAC 关系

建议最小 tuple：

```text
organization:acme#member@user:u1
zone:private-acme-office#reader@organization:acme
zone:private-acme-office#writer@organization:acme-admins
session:sess_1#owner@user:u1
session:sess_1#runner@agent:finance-auditor
repo:finance#reader@agent:finance-auditor
```

实现可将 Org membership 留在 Moss，并在 issuance/delegation 时解析成有效主体权限；是否将 membership tuple 镜像到 Nexus 是 projection 决策，不改变 Moss IAM SSOT。

Resource relation 最低要求：

- owner；
- reader/viewer；
- writer；
- runner/executor；
- manager/admin（受 capability 限制）。

Nexus Rust ReBAC v1 当前使用固定 candidate relation map；后续应加载 namespace config，但第一层至少必须保证 `/agents`、`/sessions`、`/repos` 的关系一致。

---

## 5. API 决策

Nexus product API 提供：

```text
POST   /v2/zones
GET    /v2/zones
GET    /v2/zones/{zone_id}
PATCH  /v2/zones/{zone_id}                 # 仅 display metadata
POST   /v2/zones/{zone_id}/grants
GET    /v2/zones/{zone_id}/grants
GET    /v2/zones/{zone_id}/grants/{grant_id}
DELETE /v2/zones/{zone_id}/grants/{grant_id}
```

规则：

- API 由 authenticated OperationContext 驱动；
- create/manage Zone 需要显式 admin capability；
- 普通 Org admin 不自动获得全局 Zone create 权限；
- Moss provisioning service 可代表 policy 创建默认 Zone；
- DELETE grant 表示 revoke/soft delete，不擦除历史；
- Zone delete 是异步生命周期，不能直接删数据库行；
- API 返回稳定 reason/error code。

---

## 6. 权威 Writer 与 Reader

| 数据 | 权威 writer | SSOT | Projection/Reader |
|---|---|---|---|
| Org/User/Department/Membership | Moss IAM | Moss | Nexus issuance 时读取/映射 |
| Zone | Nexus Zone Service | Nexus control/data plane | Moss admin View |
| ZoneGrant | Nexus Authorization Service | Nexus | Moss projection/audit View |
| API-key zone_perms | Nexus auth issuance | Nexus auth key store | Permission provider |
| ReBAC tuple | Nexus ReBAC API/service | Nexus ReBAC store | Permission provider |
| Session home Zone | Session Service | Nexus SessionStore | Moss/SudoWork |
| Attempt execution Zone | Moss resolution writer | Nexus Attempt record | Runtime/UI |
| PID Zone | Managed Runtime | Nexus AgentRegistry | Moss supervise View |

---

## 7. Grant 生命周期与撤销

### 7.1 创建

```text
Moss validates Org/business policy
-> calls Nexus with service identity
-> Nexus validates issuer capability
-> writes ZoneGrant
-> materializes auth/ReBAC projections
-> invalidates caches
-> emits audit/domain event
```

### 7.2 过期

- `expires_at` 到期后新操作立即拒绝；
- background cleanup 更新 status，但 on-access check 不依赖 cleanup 已运行；
- cache TTL 只是 backstop，不能作为唯一撤销机制。

### 7.3 撤销

本 ADR 决定：

1. grant status 先变 `revoked`，形成持久事实；
2. auth context、Zone lease、ReBAC graph cache 跨节点立即失效；
3. 后续 syscall/tool/resource read/write 立即拒绝；
4. 依赖该 grant 的 active PID/Attempt 默认进入 cancellation；
5. supervisor 必须以可审计原因终止或隔离 PID；
6. 若暂时无法终止，状态必须为 `revocation_pending`，不得继续获得新资源；
7. revoke 不删除历史 Audit/Task/Session。

选择默认终止 active PID 的原因：Agent 可能已经将敏感数据保存在内存中，仅阻止下一次 read 不能撤回已有数据。对低风险本地模式可由单独 policy 放宽，但 production default 必须保守。

---

## 8. 安全边界

- ZoneGrant ID、path、Org ID 都不是凭据；
- payload `zone_id` 只用于表达目标，不是授权事实；
- owner/Zone 来自 authenticated context + grant；
- system context 仅限 kernel/boot/reconciliation；
- co-host Agent 不能使用 system context；
- global admin 使用显式 capability，而不是任意 `is_admin=true`；
- service identity 与 per-user/per-attempt delegation 分开；
- cross-Zone link/mount/copy 都产生 Audit；
- foreign Agent 使用 trust-domain-qualified identity；
- Agent certificate identity不自动授予 tenant Zone access。

---

## 9. 兼容与迁移

### 9.1 Nexus Python 与 Rust

现有 Python：

- ZoneModel；
- `api_key_zones`；
- ReBAC；
- DelegationService。

现有 Rust：

- `ZonePermsProvider`；
- `RebacPermissionProvider`；
- Raft ReBAC store；
- auth provider。

迁移原则：

- 先确定一个 Zone/Grant 持久 SSOT；
- Python/Rust API 同时使用该 store 或明确 projection；
- 不再新增第三份 grant store；
- contract fixtures 对两种语言验证；
- Python legacy route 在 Rust product API 完整后进入 deprecation。

### 9.2 Moss Org backfill

- 建 `org_zone_bindings` projection；
- 对现有 Org 生成稳定 default Zone 候选；
- dry-run 输出冲突；
- 创建/绑定 idempotent；
- Org rename 不影响 Zone；
- backfill 可重入；
- Nexus unavailable 时 outbox 保留 pending，不谎报已生效。

### 9.3 Production profile

- 新 Atlas/production build 必须安装 auth + Zone + ReBAC composite；
- `--insecure-no-auth` 只允许 CI/dev；
- Moss HA 示例与安装器切换到 mTLS/API-key auth；
- startup/status 暴露 auth/permission capability；
- 旧无 permission profile 不承载真实 tenant 数据。

---

## 10. 被拒绝的方案

### 10.1 Org 永久等于 Zone

拒绝。Org 改名、合并、拆分会迫使数据迁移，也无法表示一个 Org 的 Office/Core 多域。

### 10.2 使用 `sessions`、`repos`、`agents` 作为不同 Zone

拒绝。它们是同一 Zone 中的内容类型，不是安全边界。

### 10.3 只靠目录前缀隔离

拒绝。知道或构造路径即可绕过，无法表达 grant、跨域、撤销与 ReBAC。

### 10.4 link/mount 自动继承源权限

拒绝。会形成 capability leak；目标必须重新授权。

### 10.5 permission provider 缺失时放行

拒绝用于 production。开发 loopback posture 可显式开放，生产必须 fail-closed。

### 10.6 Agent certificate 自动获得整个 Zone

拒绝。证书证明 Agent identity，不证明用户委派或 tenant data permission。

### 10.7 grant revoke 只等待缓存 TTL

拒绝。撤销必须主动失效缓存并阻止后续访问。

---

## 11. 后果

### 正面

- Org 业务变化与数据边界解耦；
- Cloud/Private/Core 不会因 fallback 自动穿透；
- 统一 VFS、ReBAC、CA 与审计语义；
- 企业合并可以先 grant 后逐步迁移；
- Session/Memory/Repo 有稳定归属；
- 权限撤销可追踪并立即生效。

### 成本

- 需要 Org->Zone mapping/outbox；
- 需要 composite permission provider；
- 需要跨节点 cache invalidation；
- 运行中 PID 可能因 grant revoke 被终止；
- 管理 UI 要分别显示 Org 和 Zone；
- 旧路径/tenant 假设需要兼容迁移。

---

## 12. 验收标准

1. Zone ID 创建后不可改，display name 可改；
2. 一个 Org 可访问两个 Zone；一个 Zone 可临时授权两个 Org；
3. User A 不能读取 User B Zone；
4. Office Zone 不能默认读取 Core Zone；
5. 有 ReBAC tuple 但无 ZoneGrant时拒绝；
6. 有 ZoneGrant但无 resource relation 时拒绝；
7. Agent 知道 path 也不能越权；
8. DT_LINK follow 重新授权目标；
9. grant revoke 立即失效 cache，并取消依赖的 active PID；
10. permission provider 缺失时 production profile 拒绝启动；
11. Org rename 不改变 Zone ID/路径；
12. Cloud fallback 不绕过 data-domain policy；
13. foreign same-name Agent 不冲突；
14.所有 grant/create/revoke/cross-zone access 有 Audit。

---

## 13. 生效与替代

本 ADR 被接受后：

- 新代码不得把 `org_id`/Org name 直接当 `zone_id`；
- 新数据路径不得以 content type 作为 Zone；
- 所有 ResourceRef 必须携带 Zone；
- production Nexus 必须安装 permission provider；
- 跨 Zone 默认拒绝；
- 任何放宽 default-deny 或 revoke 行为的需求必须另写 ADR。
