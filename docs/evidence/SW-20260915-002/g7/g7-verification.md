# G7 跨仓集成与部署证明 — SW-20260915-002（2026-09-29 重验轮）

结论：按已批准的计划口径，G7 的 exact-pin 记录、full-profile 本地真实进程
证明与 rollback rehearsal 已针对 2026-09-29 审核整改后的五仓状态重做，状态为
**Confirmed-Deployment（范围：本地 full-profile 目标 artifact）**。本结论表示
目标 artifact 已作为独立 OS 子进程启动并通过 loopback HTTP 验证，不表示已执行
release、外部生产部署、生产 migration 或流量切换。

本文件取代 2026-09-22 的同名记录：该轮记录的 revision 组合（nexus b19a9868 /
moss 27c6a431 / sudostack a479b8c / sudocode 7f1c90a / vfs 763f8c0）在 09-27
修复轮与 09-28/29 moss 提交之后过期，且其 mixed-version 拓扑（secrets 面
0.1.5/ABI 6）已在本轮收敛。

## Exact revisions

机器可读结果见 `pin-matrix.json`。最终组合为：

| Component | Revision |
|---|---|
| sudostack release | `f4b9020`（release 三件套重生成提交） |
| nexus | `a8194cf444c0b35cc056ea8950f659135776a11f`（含 §11.2 两项补测） |
| moss | `0bf6f4ff08fcf854f1b0f75d5e4f77d605736948`（含 membership_revision 加固与本地收敛 pin） |
| nexus-vfs | `bc89aa638b6ebfa05ce9491fb6a2e0c841febe2c`（未改动） |
| sudocode | `4740251c7f`（未改动） |

两条等价判定记录（未做 pin bump，理由为消费面零差异而非访问受限）：

- moss 的 `@sudo/contracts` pin 维持 `8323b0f`：moss 消费面（contracts/zone-v1
  派生产物）自 8323b0f 起字节不变——generate 输入未变，重生成报告 up to date。
- provenance 的 moss 条目维持 `406427e`：iam/v1 schema 本体自 406427e 起零变化
  （3bd0996 仅改 fixtures/invalid，非 generate 输入），406427e 即 schema 内容
  对应的准确 revision。

## Runtime binary topology

三线事实（本地收敛后）：

- 管理面：nexus `a8194cf`，其 nexus-vfs pin 为 `bc89aa638`；
- 当前源码构建的 full+cohost debug kernel 实测版本
  `nexusd-cluster 0.1.1 (nexus-cluster 0.1.1, plugin-abi 7)`，SHA-256
  `cc3be65b766c514554a52b2018f57519b37699e615983c33913f81eb55a73139`；
- moss embedded secrets 面为本轮本地构建产物：`nexusd-cluster 0.1.6
  (nexus-cluster 0.1.1, plugin-abi 7)`，SHA-256 `466fdd50…`，由 nexus-vfs
  `bc89aa638` 源码以 `NEXUSD_BUILD_VERSION=0.1.6` 构建注入版本；vault plugin
  由 nexus `a8194cf` 源码构建（ABI 7，SHA-256 `941892cc…`），以本地 Ed25519
  密钥经 `NEXUS_LOCAL_TRUSTED_KEYS_DIR`（kernel loader 的 DEV 信任通道）签名。

因此拓扑为 **同源收敛**：secrets 面与管理面来自相同源码 revision，daemon 与
vault plugin 均 ABI 7，6/7 漂移消除。执行 `python
compatibility/check-runtime-topology.py` 实测输出
`runtime topology verified: embedded daemon ABI=7, vault ABI=7, current
ABI=7, loader accepts=[6, 7], drift=no`。

一切产物均未经任何外部发布源分发（未上线约束）：binary 直接纳入 moss
`bin/nexus/`（git-ignored）并以 `.nexusd-version`/`.vault-version` marker 记
录版本，fetch 链路在 marker 与 pin 一致时跳过下载。external gRPC/mTLS 路径
本轮仍未验证，如实记录为 unverified。

## Real-process live proof

证据见 `live-deployment-proof.json`：

- 启动当前 nexus Python full profile 与当前 Rust kernel（真实 OS 子进程）；
- `/v2/zone-capabilities`：auth/ReBAC/zone runtime/grant
  projection/delegation membership/composite/worker 全部 armed（transfer 按
  设计 fail-closed）；
- 通过真实 HTTP 创建 Zone、org grant、runtime delegation（trusted service
  issuer 签发）、Session 并 `/v2/runtime/start` 启动 runtime；
- 读回 `home_zone_id=g7r-live-zone`、真实 `task_id`、`attempt_id`、
  `execution_zone_id=g7r-live-zone`、Attempt `running` 与 home-Zone VFS 落点
  （spec.json，499 bytes）；
- moss 生产 bundle `bin/moss-server.mjs` 启动成功：embedded daemon 版本匹配
  （0.1.6）、vault plugin 签名在启动时通过校验（loader fail-loud，成功启动即
  证明）。

本地 proof 使用 loopback bearer service identity。mTLS 只适用于 external
cluster topology，本次按计划记录为未验证，不把它写成已验证。

## Migration / rollback rehearsal

- nexus：`tests/migrations/test_zone_inventory.py`、
  `tests/migrations/test_api_key_zones_backfill.py`（4 项通过）；
  `test_zone_shadow_compare_e2e.py`、P0 matrix（含本轮新增的 §11.2 两项场
  景）、fault injection 全部通过（串行执行——crash-injection 用例在 xdist 并
  行下存在已知的资源竞争，串行运行为确定口径）；
- 数据库保持 expand-only；本次未执行生产 migration 或破坏性 downgrade；
- rollback 仍采用 consumer exact-pin 回退、旧 route 保留、关闭 mutation 后再
  停 worker 的 G4 方案。

## Required checks

| Repo | 结果 |
|---|---|
| nexus | P0 matrix + shadow compare + fault injection 串行全绿（16 项）；migrations 4 项；Rust kernel `full` 与 `full,cohost-sudocode` 两变体构建通过（debug，target 未变则增量无操作） |
| moss | build:node（fetch skip）；typecheck ratchet baseline 116 维持；eslint 通过；server suite 两 runner 全绿（含 real-process Zone E2E 16 项与新增 authCenter 单测 4 项） |
| sudostack | generate --check（up to date）；TS conformance；compatibility checker（no breaking changes）；release 复现（重生成后 `git diff --exit-code` 无差异）；verify:offline；cargo conformance 6/6；ADR enforced-by --strict（OK）；`check-runtime-topology.py` drift=no |
| sudocode | `cargo test -p runtime --test fs_backend_vfs` 14/14 通过 |
| nexus-vfs | HEAD 未变（bc89aa638，本计划零改动），复用既有同 revision 证据 |

平台限制如实记录：本轮全部验证在 Windows（MSVC）本机完成；网络依赖仅
generate 阶段的 raw.githubusercontent 拉取（经代理），cargo 构建全部命中本地
git 缓存。

## moss 提交核验记录（§14 口径）

本轮纳入核验的 moss 提交（此前无 evidence 覆盖的部分）：

- `3bd0996`（09-28）：admin roles 强制 + binding wire 契约化 + backfill CLI +
  iam/v1 fixtures invalid cases 扩充——已由本轮 moss server suite（含
  zones/zoneBinding 相关测试）复核通过；
- `3a3bf16`（09-29）：admin binding UX、重复守卫与生命周期错误恢复——同上复
  核通过；
- `13e8724`（09-29，本轮）：`updateUser` orgId 变化递增 membership_revision
  （§5.4）+ 4 项单测——单测与全量 server suite 通过；
- `0bf6f4f`（09-29，本轮）：embedded runtime pin 本地收敛（0.1.6/0.1.4）+
  版本耦合断言同步——real-process E2E 16/16、server 启动、fetch skip 验证通
  过。

以上 revision 均为远端 `feat/contract-zone` 当前可见提交（已 push）。

## Rollout 边界

G7 证据已落盘，可以进入 production rollout 决策。实际 release、deploy、生产
migration、legacy `/api/zones` 下线和流量切换均未执行，仍需分别授权。
