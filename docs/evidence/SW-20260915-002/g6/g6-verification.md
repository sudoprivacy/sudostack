# G6 P1b Runtime/Data-placement 验收底稿 — SW-20260915-002

完成声明：**“ADR-002（Zone 与 tenancy 模型）全部完成”**。该声明仅按本
Initiative 已批准的 P1b 收敛口径成立：Task 以 implicit 最小形态引入，且
Context policy 校验 caller 在 runtime start 中显式声明的可选
`resource_refs`。未声明的 ResourceRef、完整 Task 产品入口和 ADR-004 resolver
其余步骤不在本次声明中，详见 Nexus
`contracts/manifests/task-v1-p1b-amendment.json`。

## §11.4 P1b 六条证据映射

| # | 条目 | 可核验证据 |
|---|---|---|
| 1 | 真正 Attempt 固化 execution Zone | Nexus `task_attempts` 权威行、RuntimeRun `attempt_id` 关联；`test_p1b_implicit_task_resolution_attempt_and_home_zone_io` |
| 2 | Task 默认写 Session home Zone | implicit TaskSpec/Resolution/Attempt 的 `zone_id`、`vfs_path`、`bytes_written` 与真实 VFS 读回 |
| 3 | Context execution policy 校验 ResourceRef | start body 的每个显式 `resource_refs` 使用 owner-local `ResourceRef` adapter 校验，并逐项执行 current delegation + ZoneGrant + ReBAC read 检查；拒绝场景落 `ZONE_ACCESS_DENIED` Resolution |
| 4 | cross-Zone reason/policy version 可审计 | accepted/rejected Resolution 读回；缺失决策保持 HTTP `422 CROSS_ZONE_DECISION_REQUIRED` |
| 5 | Attempt/PID cancellation 与历史保留 | cancel PID 不结束 Attempt，resume 追加同一 `pid_history`；grant revoke 将 active Attempt 标记 `cancelled`，保留所有 Task/Resolution/Attempt/PID 行 |
| 6 | 权威存储与真实 I/O | 三张 task 表为数据库权威记录；三类 JSON 创建快照通过 zone-scoped kernel 写入并由 REST 文件接口读回 |

## P1b Definition of Done

- [x] 真正 TaskAttempt 模型落地并固化不可变 `execution_zone_id`。
- [x] implicit TaskSpec、Resolution、Attempt 默认写 Session home Zone。
- [x] Session metadata、Task、Transcript、Context、Artifact、Verify 的 home-Zone 落点均有真实 I/O 证据。
- [x] 显式声明的所有 `resource_refs` 在 execution policy 下逐项验证。
- [x] cross-Zone decision reason/policy version 可审计。
- [x] PID cancel/resume、grant revoke、`revocation_pending`、Attempt 终态和历史保留通过。
- [x] P0、P1a、P1b 声明边界分离。

## 能力声明边界

- P0：`g4/g4-verification.md` 仅声明“Zone 管理与访问授权链完成”。
- P1a：`g5/g5-verification.md` 仅声明“Runtime Zone 归属子集完成”。
- P1b：本文件声明 implicit Task 最小闭环与本节列明的 ADR-002 runtime/data-placement gate。
- 无公开 Task 写入 API；唯一新增入口是只读
  `GET /v2/sessions/{sid}/tasks/{task_id}`。
- ADR-004 的 interactive/Cron/IM/Team、显式 retry、Agent version resolver、
  data classification/egress、deadline/budget/approval 等产品化能力未声明完成。
- ADR-001 已记录的 OS PID 存量冲突保持 `enforced_by: none`。

## Pin matrix

| Component | Revision |
|---|---|
| nexus-vfs | `763f8c0fef392da8c1151fc3f17b3a6f3f707dbd` |
| nexus | `b19a9868c91fba89121d8f12dad6f74cc80d7b13` |
| sudostack release | `a479b8cbfe0a144629764a060ef026fb6d043f7c` |
| moss implementation baseline | `ce8f5db9c9ea9c1be63c93819a1f0a0625492a44` |
| sudocode | `7f1c90a2db9aed6dbe05d84e883915e105101b44` |

`release-manifest.gen.json` 的 owner revisions 是契约来源 revision，不等同于
所有 consumer 仓库 HEAD；Moss `metadata_only` 保持其 `contracts/iam/v1` 最后
修改 revision `406427e280b55d04b5dbf097bd84da1194ace6e9`。

## Moss nexusd-cluster 三线事实

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
  matrix HEAD。external gRPC 路径尚未验证。

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
