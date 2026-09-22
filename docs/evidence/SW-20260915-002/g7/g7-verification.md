# G7 跨仓集成与部署证明 — SW-20260915-002

结论：按已批准的计划口径，G7 的 exact-pin 记录、full-profile 本地真实进程
证明与 rollback rehearsal 已完成，状态为 **Confirmed-Deployment**。本结论表示
目标 artifact 已被真实启动和验证，不表示已执行 release、外部生产部署、生产
migration 或流量切换。

## Exact revisions

机器可读结果见 `pin-matrix.json`。最终组合为：

| Component | Revision |
|---|---|
| sudostack release | `a479b8cbfe0a144629764a060ef026fb6d043f7c` |
| nexus | `b19a9868c91fba89121d8f12dad6f74cc80d7b13` |
| moss | `27c6a43167ddcf50d61d11d50a7fad63a0cda83e` |
| nexus-vfs | `763f8c0fef392da8c1151fc3f17b3a6f3f707dbd` |
| sudocode | `7f1c90a2db9aed6dbe05d84e883915e105101b44` |

`release-manifest.gen.json` 的 Nexus/nexus-vfs owner revisions 与最终 owner
contract revisions 一致；Moss 的 `metadata_only` revision 保持为其
`contracts/iam/v1` 最后修改提交 `406427e...`，不能误写成 Moss HEAD。
Moss `@sudo/contracts` 已精确 pin 到 sudostack release commit `a479b8c...`。

## Runtime binary topology

按计划的三线事实口径记录：

- 管理面使用当前 Nexus `b19a986...`，其 nexus-vfs pin 为 `763f8c0...`；
- 当前源码构建的 full+cohost binary 实测版本为
  `nexusd-cluster 0.1.1 (nexus-cluster 0.1.1, plugin-abi 7)`，SHA-256 为
  `ee856c518a7df9239d3fa0586749723f923a76ec330fc8d1894d298e595d9f28`；
- Moss 默认 embedded secrets 面仍使用 git-ignored `0.1.5` binary，SHA-256
  `53b31d8f3e7d9280087ab1b9443b275706be629de0f47e24a0a31ddcf8f2a67c`，
  对应历史 Nexus `251333f...` / nexus-vfs `b878b015...`；
- 因此实际拓扑明确标记为 **mixed-version**；external gRPC/mTLS 路径未验证。

上述记录满足本计划批准的“三线事实 + digest”口径，但不等价于所有 runtime
binary 与 release manifest 已版本对齐。

## Real-process live proof

证据见 `live-deployment-proof.json`：

- 启动当前 Nexus Python full profile 与当前 full+cohost Rust kernel；
- `/v2/zone-capabilities` 返回 auth、Zone runtime、ReBAC、grant projection、
  composite 全部 armed；
- 通过真实 HTTP 创建 Zone、delegation、Session 并启动 runtime；
- API 读回 `home_zone_id=g7-live-zone`、真实 `task_id`、`attempt_id`、
  `execution_zone_id=g7-live-zone`、Attempt `running` 与 home-Zone VFS 落点；
- Moss 生产 bundle `bin/moss-server.mjs` 重建成功，完整 server suite 使用该
  artifact 验证通过。

本地 proof 使用 loopback bearer service identity。mTLS 只适用于 external
cluster topology，本次按计划记录为未验证，不把它写成已验证。

## Migration / rollback

- `tests/migrations/test_zone_inventory.py`、
  `tests/migrations/test_api_key_zones_backfill.py` 与
  `tests/e2e/server/test_zone_shadow_compare_e2e.py`：5 项通过。
- P0 matrix 与 fault-injection：13 项通过；包括 crash/restart、响应丢失、
  revoke/epoch fail-closed 与 contract mismatch。
- 数据库保持 expand-only；本次未执行生产 migration 或破坏性 downgrade。
- rollback 仍采用 consumer exact-pin 回退、旧 route 保留、关闭 mutation 后再
  停 worker 的 G4 方案。

## Required checks

| Repo | 结果 |
|---|---|
| nexus | Ruff lint/format、mypy、contracts/migrations、P0/P1a/P1b real-process E2E、fault injection、shadow compare、`nexusd --features full` 与 `full,cohost-sudocode` build、`nexusd` full tests均通过 |
| moss | build、typecheck ratchet（server baseline 116）、eslint、Bun 184/184、Node 184/184、real-process Zone E2E 12/12 通过 |
| sudostack | ADR strict gate、generate/check、compatibility、offline bundle、SBOM、18/18 tests 通过 |
| sudocode | `runtime::fs_backend_vfs` 12/12；HEAD 与 G5 revision 相同，其余 G5 证据复用 |
| nexus-vfs | HEAD 与 G5 revision 相同，G5 同 revision 证据复用 |

平台限制如实记录：Nexus 无过滤全量 Python 测试在 Windows 上会收集 Linux
FUSE 测试并因缺少 libfuse 失败；Rust workspace 的 FUSE plugin 需要本机
`libclang.dll`。本次使用与交付范围相符的测试集合，并额外执行了排除
`nexus-fuse-plugin` 后的 Rust workspace Clippy 与测试，均通过。PostgreSQL
专项因未配置 `NEXUS_E2E_DATABASE_URL` 跳过 1 项；SQLite migration 路径通过。

## Rollout 边界

G7 证据已落盘，可以进入 production rollout 决策。实际 release、deploy、
生产 migration、legacy `/api/zones` 下线和流量切换均未执行，仍需分别授权。
