# ADR-005 落地总结

> 日期：2026-09-16  
> 范围：总结 ADR-005 本轮 contract 平台落地、消费者仓库改动、已验证证据、剩余 `none` 的原因和后续工作。  
> 结论：本轮已经完成 `common/v1` 的第一条跨仓 contract 闭环，并在 Moss、SudoWork、sudocode、Nexus 四个消费者本地验证通过；其中 Moss/SudoWork/sudocode 分支已 push，Nexus 已本地提交但因仓库权限未 push。ADR-005 仍有 33 个 `none`，这些不是 push 或提交遗漏，而是对应 enforcement 尚未实现。

---

## 1. 当前仓库状态

### 1.1 sudostack

`sudostack` 已完成并 push：

```text
repo:    sudoprivacy/sudostack
branch:  codex/adr005-contract-platform
commit:  65904eb0a0991366767095b707f5a86835089a1e
status:  pushed
```

该提交内容包括：

- `common/v1` canonical JSON Schema；
- valid / invalid / roundtrip fixtures；
- TypeScript generated artifact；
- Rust crate；
- schema manifest；
- release manifest；
- compatibility baseline；
- consumer matrix；
- schema / compatibility / release / consumer 检查工具；
- CI workflow 扩展；
- ADR-005 enforcement 标注整理。

### 1.2 消费者仓库

| Repo | Base branch | Work branch | Commit | Push 状态 | 说明 |
|---|---|---|---|---|---|
| Moss | `origin/dev` | `codex/adr005-consumer-boundary` | `fdd4cf1` | 已 push | pin `@sudo/contracts` 到 `sudostack#65904eb...`，新增 boundary test |
| SudoWork | `origin/dev` | `codex/adr005-consumer-boundary` | `504c7ede` | 已 push | 新增 boundary test |
| sudocode | `origin/main` | `codex/adr005-consumer-boundary` | `701ae8d1` | 已 push | 新增 Rust boundary test |
| Nexus | `origin/develop` | `codex/adr005-consumer-boundary` | `7a2195bd9` | 未 push | 本地已提交，push 被 `nexi-lab/nexus` 权限拒绝 |

Nexus push 失败原因：

```text
ERROR: Permission to nexi-lab/nexus.git denied to yinbinchen.
```

这不是代码或测试问题，是当前 GitHub 用户对 `nexi-lab/nexus` 没有写权限。

---

## 2. 本轮实际修改了什么

### 2.1 sudostack 的 contract 平台能力

本轮在 `sudostack` 建立了第一条 ADR-005 风格闭环：

```text
schemas/common/v1
  -> fixtures
  -> TypeScript artifact
  -> Rust crate
  -> manifests
  -> release manifest
  -> compatibility check
  -> consumer matrix
  -> CI/check:all
```

核心对象：

- `ContractEnvelope`
- `ResourceRef`
- `ErrorInfo`

当前已经覆盖：

- `api_version` / `kind`；
- unknown major 拒绝；
- supported major 下 unknown optional 字段接受；
- inline secret-like 字段拒绝；
- valid fixtures 被接受；
- invalid fixtures 被拒绝；
- roundtrip fixtures 保持语义不漂移；
- schema manifest 和 release manifest digest 固化；
- consumer matrix 记录消费者和 boundary test。

### 2.2 Moss 改动

Moss 做了两类改动：

1. 依赖 pin：

```text
@sudo/contracts = github:sudoprivacy/sudostack#65904eb0a0991366767095b707f5a86835089a1e
```

`bun.lock` 已同步更新，`bun install` 已证明该远端 SHA 可解析并能安装。

2. 新增 boundary test：

```text
src/contracts/__tests__/commonV1Boundary.test.ts
```

该测试从真实安装包导入：

```ts
import { safeParseCommon } from '@sudo/contracts/common/v1'
```

并使用 `sudostack` 的 fixtures 验证 valid / invalid / roundtrip。

### 2.3 SudoWork 改动

新增：

```text
tests/contract/common-v1-boundary.test.ts
```

该测试读取 `sudostack` 的 `common/v1` artifact 和 fixtures，验证消费者边界行为。

### 2.4 sudocode 改动

新增：

```text
rust/crates/runtime/tests/sudo_common_contract_boundary.rs
```

该测试以 Rust 方式读取 `sudostack` fixtures，并验证 common/v1 payload：

- valid fixtures accepted；
- invalid fixtures rejected；
- roundtrip fixtures preserved；
- zone_id 格式；
- secret-like key denylist。

### 2.5 Nexus 改动

新增：

```text
tests/unit/contracts/test_sudo_common_boundary.py
```

该测试使用 `jsonschema` 读取 `sudostack` canonical schema，并验证 common/v1 fixtures。

---

## 3. 已验证通过的内容

本轮验证分为三层。

### 3.1 sudostack 本仓验证

已通过：

```text
SUDOSTACK_REPOS_ROOT=/Users/yobach/VSCodeProject npm run check:all
SUDOSTACK_REPOS_ROOT=/Users/yobach/VSCodeProject node docs/adr/enforced-by.mjs --strict
```

`check:all` 覆盖：

- zone-id generated artifact check；
- common/v1 generated artifact check；
- v0 distribution check；
- schema lint；
- compatibility check；
- consumer matrix check；
- release manifest check；
- Rust crate tests；
- Node tests。

ADR strict 输出中 ADR-005 当前为：

```text
ADR-005-product-contract-versioning.md verified 16 none 33 unverifiable 0 untagged 0
```

### 3.2 消费者验证

已通过：

```text
Moss:
SUDOSTACK_REPO=/Users/yobach/VSCodeProject/sudostack bun test src/contracts/__tests__/commonV1Boundary.test.ts

SudoWork:
SUDOSTACK_REPO=/Users/yobach/VSCodeProject/sudostack bunx vitest run tests/contract/common-v1-boundary.test.ts

sudocode:
SUDOSTACK_REPO=/Users/yobach/VSCodeProject/sudostack cargo test --manifest-path rust/crates/runtime/Cargo.toml --test sudo_common_contract_boundary

Nexus:
PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 SUDOSTACK_REPO=/Users/yobach/VSCodeProject/sudostack uv run pytest tests/unit/contracts/test_sudo_common_boundary.py -q
```

### 3.3 SHA 约束

四个消费者测试都把本次审计目标固定为：

```text
65904eb0a0991366767095b707f5a86835089a1e
```

这避免了测试误读任意本地 `sudostack` 工作区。

Moss 额外验证了真实 GitHub dependency pin：

```text
@sudo/contracts@github:sudoprivacy/sudostack#65904eb
```

---

## 4. 已验证的 ADR-005 能力

当前可以诚实认为已经形成机器证据的能力包括：

- `@sudo/contracts` v0.x 作为 Git dependency 被 exact SHA pin；
- Moss lockfile 与 package.json pin 一致；
- `common/v1` schema 存在并可离线解析；
- schema `$id`、`api_version`、`kind`、manifest、fixtures 被 lint；
- valid fixtures 被 TS / Rust / consumer boundary 接受；
- invalid fixtures 被拒绝；
- unknown major 被拒绝；
- supported major 下 unknown optional 字段被接受并 roundtrip；
- secret-like inline 字段被拒绝；
- release manifest 记录 schema 和 artifact digest；
- compatibility baseline 存在并被检查；
- Moss / SudoWork / sudocode / Nexus 都有至少一个 common/v1 boundary test；
- ADR `enforced_by` strict 检查通过，且 ADR-005 没有 untagged 规范条款。

---

## 5. 为什么还有 33 个 none

33 个 `none` 不是遗漏提交，也不是因为 `sudostack` 没 push。`sudostack` 已 push，Moss 也已经基于真实 GitHub SHA 安装验证。

`none` 的含义是：对应规范条款目前还没有可执行 enforcement，也就是没有 test、checker、CI gate、release gate、PR gate 或消费者/生产者真实边界证据。

### 5.1 33 个 none 分类

| 分类 | 数量 | 为什么还是 none | 后续怎么做 |
|---|---:|---|---|
| 独立仓库/发布边界 | 8 | 当前 contract 平台仍在 `sudostack`，不是独立 `sudo-contracts` repo | 建独立 repo，建立独立 tag/release，离线镜像和 repo 边界 CI |
| contract family 完整性 | 1 | 当前只实现 `common/v1` | 继续实现 `agent`、`auth`、`runtime`、`transcript`、`overlay` 等 family |
| wire 语义细节 | 3 | `null`/absent、path normalization、TS camelCase 到 snake_case serializer 尚无 checker | 增加 schema/doc lint、serializer roundtrip、path normalization fixtures |
| compatibility/release | 2 | breaking diff 和 release notes support matrix 不完整 | 扩展 compatibility checker，增加 release notes/schema matrix gate |
| consumer 行为 | 5 | Unknown fallback、字段顺序、JSON 原始字符串依赖、exhaustive switch 还未跨语言强制 | 增加跨语言 conformance、unknown code fallback fixtures、lint |
| producer 行为 | 5 | producer support matrix、真实 version、禁止 `version: unknown` 等未接入真实 producer | 在真实 producer 代码路径加 contract tests 和 runtime guard |
| transport/runtime boundary | 2 | OpenAPI/proto/MCP/WS/IPC adapter 未接 canonical schema | 给 transport adapter 加 schema conformance 和 ingress/read/migration validation |
| ADR/schema 权威与防漂移 | 4 | 还没有 PR gate 阻止 consumer-local DTO 漂移或私改字段语义 | 加 CODEOWNERS、schema diff gate、consumer DTO drift checker |
| Rust crate 命名边界 | 1 | 当前不冲突，但没有 gate 防止未来冒充 | 加 crate/package name checker |
| Contract repo CI 完整清单 | 1 | SBOM、license、checksum、reproducibility 未完整实现 | 补 release artifact gate |
| semantic breaking change | 1 | compatibility checker 还不能判断完整语义级 breaking | 扩展 checker，并要求 ADR amendment / compatibility report |

### 5.2 不能直接改成 verified 的原因

如果把这些 `none` 直接改成 `verified`，会产生虚假安全感。例如：

- 没有 producer test，就不能证明正式事件不会发 `version: unknown`；
- 没有 transport conformance，就不能证明 OpenAPI/proto/MCP adapter 没有偷改语义；
- 没有 PR gate，就不能阻止 consumer-local DTO 变成新的事实标准；
- 没有完整 compatibility checker，就不能证明所有 breaking semantic change 都会被拦住。

因此当前保持 `none 33` 是正确状态。

---

## 6. 当前阻塞项

### 6.1 Nexus push 权限

Nexus 本地提交已完成：

```text
branch: codex/adr005-consumer-boundary
commit: 7a2195bd9
```

但未 push，原因是当前账号没有 `nexi-lab/nexus` 写权限。

解决方式：

1. 给 `yinbinchen` 对 `nexi-lab/nexus` 的 push 权限；
2. 重新执行：

```text
git push -u origin codex/adr005-consumer-boundary
```

### 6.2 ADR-005 剩余 none

剩余 `none` 需要继续分阶段实现，不是一次 PR 可以合理完成。建议顺序：

1. 补 Nexus push；
2. 给四个消费者开 PR；
3. 合并 `sudostack` contract platform PR；
4. 合并消费者 boundary PR；
5. 继续做下一批 enforcement：
   - release artifact checksum/SBOM/offline bundle；
   - compatibility checker 增强；
   - producer support matrix 和 producer tests；
   - transport adapter conformance；
   - DTO drift checker / PR gate。

---

## 7. 当前完成度判断

当前完成度可以这样描述：

```text
已完成：
  ADR-005 common/v1 contract 平台第一闭环
  TypeScript/Rust artifact 验证
  Moss 真实 GitHub SHA pin
  四个消费者本地 boundary test 验证
  sudostack check:all / ADR strict 通过

未完成：
  Nexus branch push
  独立 sudo-contracts repo
  完整 family 覆盖
  producer enforcement
  transport enforcement
  完整 release artifact/SBOM/offline bundle
  semantic breaking change 全覆盖
  consumer-local DTO drift PR gate
```

一句话结论：

> ADR-005 不是“全部完成”，但已经从文档规则推进到可运行、可 pin、可跨仓验证的第一条 contract 闭环。剩余 33 个 `none` 是后续 enforcement 工作清单，而不是当前实现失败。
