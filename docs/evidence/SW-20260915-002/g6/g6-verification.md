# G6 P1b Runtime/Data-placement 验收底稿 — SW-20260915-002

完成声明（2026-09-24 对抗审核修复轮修订）：**仅声明"G6 部分加固完成"**：
Nexus delegation 已绑定明确 grant 与逐条 capability-prefix rules，HTTP
runtime/P1b 按同一 rule 匹配 ResourceRef 并证明不存在笛卡尔积放大；Moss
runner 传递区分 HTTP 与本地 VFS 命名空间的 rules；sudocode 现有 backend
执行 capability/prefix/canonical path 早拒绝，全部现有远程 A2A 构造仍为
unverified 并 fail-closed。非 root cohost 及远程 VFS/A2A 缺少服务端可验证
credential，生产级认证链另立 work item。**不声明 cohost 数据面或整个
ADR-002 完成。**

以下 §11.4 六条映射、P1b DoD 与能力声明边界是 2026-09-22 的历史底稿：原
声明"ADR-002（Zone 与 tenancy 模型）全部完成"仅按当时已批准的 P1b 收敛
口径成立（Task 以 implicit 最小形态引入，Context policy 校验 runtime start
显式声明的可选 `resource_refs`）；对抗审核确认该口径存在未闭合的
delegation scope、membership 回查与 context 接线缺口（H-1/H-2/H-3/G6），
已由修复轮按最小范围闭合，加固记录见下文专节。

## §11.4 P1b 六条证据映射（历史底稿，2026-09-22）

| # | 条目 | 可核验证据 |
|---|---|---|
| 1 | 真正 Attempt 固化 execution Zone | Nexus `task_attempts` 权威行、RuntimeRun `attempt_id` 关联；`test_p1b_implicit_task_resolution_attempt_and_home_zone_io` |
| 2 | Task 默认写 Session home Zone | implicit TaskSpec/Resolution/Attempt 的 `zone_id`、`vfs_path`、`bytes_written` 与真实 VFS 读回 |
| 3 | Context execution policy 校验 ResourceRef | start body 的每个显式 `resource_refs` 使用 owner-local `ResourceRef` adapter 校验，并逐项执行 current delegation + ZoneGrant + ReBAC read 检查；拒绝场景落 `ZONE_ACCESS_DENIED` Resolution |
| 4 | cross-Zone reason/policy version 可审计 | accepted/rejected Resolution 读回；缺失决策保持 HTTP `422 CROSS_ZONE_DECISION_REQUIRED` |
| 5 | Attempt/PID cancellation 与历史保留 | cancel PID 不结束 Attempt，resume 追加同一 `pid_history`；grant revoke 将 active Attempt 标记 `cancelled`，保留所有 Task/Resolution/Attempt/PID 行 |
| 6 | 权威存储与真实 I/O | 三张 task 表为数据库权威记录；三类 JSON 创建快照通过 zone-scoped kernel 写入并由 REST 文件接口读回 |

## P1b Definition of Done（历史底稿）

- [x] 真正 TaskAttempt 模型落地并固化不可变 `execution_zone_id`。
- [x] implicit TaskSpec、Resolution、Attempt 默认写 Session home Zone。
- [x] Session metadata、Task、Transcript、Context、Artifact、Verify 的 home-Zone 落点均有真实 I/O 证据。
- [x] 显式声明的所有 `resource_refs` 在 execution policy 下逐项验证。
- [x] cross-Zone decision reason/policy version 可审计。
- [x] PID cancel/resume、grant revoke、`revocation_pending`、Attempt 终态和历史保留通过。
- [x] P0、P1a、P1b 声明边界分离。

## 能力声明边界（历史底稿）

- P0：`g4/g4-verification.md` 仅声明“Zone 管理与访问授权链完成”。
- P1a：`g5/g5-verification.md` 仅声明“Runtime Zone 归属子集完成”。
- P1b：本文件历史底稿声明 implicit Task 最小闭环与本节列明的 ADR-002 runtime/data-placement gate。
- 无公开 Task 写入 API；唯一新增入口是只读
  `GET /v2/sessions/{sid}/tasks/{task_id}`。
- ADR-004 的 interactive/Cron/IM/Team、显式 retry、Agent version resolver、
  data classification/egress、deadline/budget/approval 等产品化能力未声明完成。
- ADR-001 已记录的 OS PID 存量冲突保持 `enforced_by: none`。

## G6 最小范围加固记录（2026-09-24，对抗审核修复轮）

- **Nexus delegation scope（4a，提交 `08fcfb2d` + `d784485`）**：
  `ZoneDelegationModel` 增加 `purpose` 与 JSON `scope_rules`（expand-only
  migration `add_zone_delegation_scope`）；每条 rule 固定
  `{capability, resource_prefixes}`，capability 与 prefix 在同一 rule 内绑定，
  平铺集合的笛卡尔积放大不存在（E2E 断言 `read → /input.txt` 与
  `write → /sessions/{sid}` 可用，而 `write → /input.txt` 拒绝）。
  `issue_delegation` 按确定 grant 选择：未传 `grant_id` 时要求唯一覆盖候选，
  多候选返回 `AMBIGUOUS_GRANT` 409，禁止 `created_at DESC` 静默取最新；
  `purpose:"runtime"` 强制恰一条 `zone.runtime.execute` rule 且 prefixes
  恰有一个 `/sessions/{sid}` canonical session 根作为 session 绑定 SSOT
  （不引入 `runtime_session_id` wire/model/DB 字段）。
  `verify_delegation` 新增 `capability`/`resource_path` 参数并按调用点矩阵
  逐点传参（session 级路径 / ResourceRef path / 非资源型 None）；legacy
  NULL scope 行仅在 `resource_path=None` 且 capability 非 runtime execute 的
  非资源型检查中沿用，其余一律 `SCOPE_REQUIRED` 拒绝。四份 object schema
  （`zone-delegation-scope-rule` / `zone-delegation-issue-request` /
  `zone-delegation` / `runtime-resource-scope`）进入 owner 注册与
  valid/invalid/roundtrip/compatibility fixtures；错误码 `AMBIGUOUS_GRANT` /
  `SCOPE_REQUIRED`（连同阶段 2 的 `MEMBERSHIP_UNAVAILABLE`）登记
  `KNOWN_ERROR_CODES` 与 `contracts/auth/v1/error-codes.json`。
- **sudostack 合同分发（4e.1，提交 `8323b0f`）**：`contracts/zone-v1/
  pin.json` 登记四份 schema、nexus rev 与错误码/fixtures；rule 经已登记
  `$ref` 生成强类型（`scopeRules` 不是 `Array<Record<string, unknown>>`）；
  conformance/compatibility/offline bundle 检查通过。
- **Moss runner 传递（4b，提交 `b6d5467`）**：`@sudo/contracts` pin 到
  `8323b0f`（package.json 与 bun.lock 同 rev）；`issueForOrgUser` 从 active
  binding 的 `nexus_grant_id` 传 `grantId`，delegation rule 逐条对该 grant
  做 attenuation；runner delegation 的 HTTP rules 只含一条
  `zone.runtime.execute → /sessions/{session_id}`，另生成供本地 VFS 防御的
  `NEXUS_RESOURCE_SCOPE`（HTTP rules 与本地 VFS rules 为不同命名空间，
  分别验证、不比较相等）；`applyRunnerZoneContext` 只注入
  `NEXUS_ZONE_ID/NEXUS_V2_BASE_URL/NEXUS_DELEGATION_REF/NEXUS_RESOURCE_SCOPE`
  并继续删除 `MOSS_NEXUS_V2_SERVICE_TOKEN`/`NEXUS_API_KEY`/
  `NEXUS_ADMIN_BOOTSTRAP_TOKEN`/`MOSS_INTERNAL_API_TOKEN`。
- **sudocode 执行点加固（4c，提交 `4740251`，nexus pin `a3947be4`）**：
  `ContextSource` 显式区分 `TrustedLocal`（仅认证 system/NoAuth 进程内
  kernel context）与 `UnverifiedDelegationRef`（descriptor/env 元数据，
  可早拒绝但永不产生授权 allow）；`RuntimeResourceAuthorizer` 执行
  operation-specific capability 映射、顶层 zone 全等与同 capability rule
  内的斜杠边界 canonical prefix 匹配（尾斜杠拒绝）；`KernelFsBackend` 与
  `NexusVfsFsBackend` 的 read/stat/readdir/exists 映射 `zone.data.read`，
  write/append/create/rename/delete/link 映射 `zone.data.write`，rename 与
  DT_LINK 两端检查；`NexusVfsFsBackend::exists` 补 authorize（此前绕过）；
  全部现有远程构造（`new`/`from_arc`/mailbox 生产路径、空或任意 API key、
  host env 组合）即使 scope 命中也在 RPC 前返回 `PermissionDenied`
  （`every_remote_backend_constructor_fails_before_rpc` 断言 RPC 计数 0）。
- **本轮收尾重验（2026-09-27 本机实测）**：sudocode
  `cargo test --manifest-path rust/Cargo.toml --workspace`
  （`RUST_TEST_THREADS=1`，单次）exit 0，其中 `fs_backend_vfs` 14/14；
  `cargo fmt --all --check` 通过；clippy 改动文件净新增 warning 为 0
  （main 基线存量 warning 偏差沿用 g5 底稿记录）。nexus
  `cargo build -p nexusd --features full,cohost-sudocode` Finished exit 0
  （链接 `sudocode-tools@4740251`；nexus-vfs pin 在 Cargo.toml/Cargo.lock/
  三个 Dockerfile 三组唯一且一致 = `bc89aa63`，preflight 等价检查通过）。
  其余各阶段提交（nexus `88e883e`/`08fcfb2d`/`d784485`、moss
  `764183b`/`b6d5467`、sudostack `8323b0f`）均按计划纪律在各自 required
  checks 通过后落盘推送。
- **不在本轮声明内**：非 root cohost 与缺少服务端可验证 credential 的远程
  VFS/A2A 继续 fail-closed；完整的生产级 credential 签发/续期/撤销、远程
  transport 认证与长期 runtime lease 作为独立 work item；`sudowork` 未改动。

## Pin matrix（2026-09-24 修订）

| Component | Revision |
|---|---|
| nexus-vfs | `bc89aa638b6ebfa05ce9491fb6a2e0c841febe2c` |
| nexus | `a3947be4133d4a8c7581f898d3f3ad9ad3eb6ccc` |
| sudostack release | `8323b0f6ac50270594dd76120919c20cc57318dd` |
| moss implementation baseline | `b6d5467f012d358682605be5aea318d95860feed` |
| sudocode | `4740251c7f0f2aedef1ed07f5886dcfe29f54bb9` |

`release-manifest.gen.json` 的 owner revisions 是契约来源 revision，不等同于
所有 consumer 仓库 HEAD；Moss `metadata_only` 保持其 `contracts/iam/v1` 最后
修改 revision `406427e280b55d04b5dbf097bd84da1194ace6e9`。

## Moss nexusd-cluster 三线事实（历史底稿，2026-09-22）

- 管理面：Moss `MOSS_NEXUS_V2_BASE_URL` → Nexus
  `b19a9868c91fba89121d8f12dad6f74cc80d7b13` → nexus-vfs
  `763f8c0fef392da8c1151fc3f17b3a6f3f707dbd`。
- secrets 面（embedded 缺省路径）：pin `0.1.5`，实测
  `nexusd-cluster v0.1.5 (nexus-cluster 0.1.1, plugin-abi 6)`；本地 git-ignored
  binary SHA-256 为
  `53b31d8f3e7d9280087ab1b9443b275706be629de0f47e24a0a31ddcf8f2a67c`；
  历史 Nexus `251333f87c136b0e3e530ab1a237f81320145240` / nexus-vfs
  `b878b015bf2b4663063425af19902b18c09890b9`。
- 结论：`mixed-version topology`；secrets 面仍在 legacy 0.1.5，管理面在当前
  matrix HEAD。external gRPC 路径尚未验证。该部署演进状态非本轮修复范围，
  如实保留。

## 验证记录

### Nexus

- `uv run ruff check .`：通过。
- `uv run ruff format --check .`：通过。
- `uv run mypy src/nexus`：通过（1435 个 source files）。
- contracts + migrations + P1a/P1b real-process E2E：通过；其中 PostgreSQL
  专项因未配置 `NEXUS_E2E_DATABASE_URL` 跳过 1 项。
- P0 matrix + fault-injection：13 项通过。
- `cargo build --manifest-path Cargo.toml -p nexusd --features full,cohost-sudocode`：通过。

### sudostack

- `generate --check`、compatibility checker、offline bundle verification、SBOM、
  18 项 contract tests：通过。
- ADR enforcement 自测 11 项通过；strict gate 为 0 violation。

### Moss / sudocode

- Moss `node scripts/test-server.js`：Bun 184/184、Node 184/184、real-process
  Zone E2E 12/12。
- Moss production bundle build：通过；当前环境没有 Go，两个可选 Go binary
  按构建脚本规则跳过。
- sudocode 与 nexus-vfs HEAD 未变化；P1a G5 同 revision 证据继续有效，G7
  将复核 exact revision 与 cohost build。
