# G4 P0 验收底稿 — SW-20260915-002（2026-09-21）

完成声明：**"Zone 管理与访问授权链完成"**（不宣称 Runtime Zone / ADR-002 完成——P1a/P1b 范畴）。

## C7 24 条 → 证据映射

| # | 条目 | 证据 |
|---|---|---|
| 1 | Canonical 定义全在 owner repos | nexus-vfs `contracts/zone-id`（含三种投影 schema）、nexus `contracts/{common,auth}/v1`（c98baa34 freeze）、moss `contracts/iam/v1` |
| 2 | sudostack 无手工复制 | `contracts/zone-v1/pin.json` + generator（.gen 文件带 provenance）；无手写 owner schema |
| 3 | zone_id 单一可编辑 source + 三投影 | vfs `tenant-zone-id-create/system/existing-zone-id-ref.schema.gen.json`；C1 fixtures 全绿 |
| 4 | ZonePath 单 owner；ResourceRef 引用不复制 | nexus `ResourceRef` schema `$ref` vfs 投影；`source-lock.gen.json` 从 Nexus pin 派生 |
| 5 | contracts 状态准确 | draft-frozen（c98baa34）+ `tests/contracts` 66/66 |
| 6 | Moss OrgZoneBinding 本地生成无循环 | `zones/generated/org-zone-binding.gen.ts` + contract test；sudostack 未导出 iam/v1 |
| 7 | 已启用语言同源 fixtures；无空包 | TS conformance 18/18（sudostack）+ Python owner-local 66/66（nexus）；Go/C# 未生成（无 consumer 记录于 compatibility matrix） |
| 8 | 机器可读 pin matrix | `pin-matrix.json`：nexus workspace 单一 vfs rev ✓ = sudostack pin ✓ = vfs HEAD ✓；moss contracts pin = sudostack HEAD ✓；cohost mismatch 如实记录（见偏差） |
| 9 | Nexus 唯一 authoritative writer/store | 唯一 `ZoneApplicationService`；legacy 路由委托同一 service（`_zone_service`） |
| 10 | receipt/read-back 对账 | create saga runtime read-back（场景 2/17 重启后收敛）；`test_active_maps_only_with_runtime_readback` |
| 11 | Moss 只走 public API | `NexusZoneClient` 仅 `/v2`；E2E 全链 Moss HTTP → /v2 → worker → runtime |
| 12 | 多对多；rename/delete 不变/不删 | 场景 5（一 Org 两 Zone）、6（一 Zone 两 Org）、11（rename 不改 ID）、12（detach 不删数据） |
| 13 | membership delegation + 失效 | 场景 4（自身 delegation 访问/跨 Org 拒）、8（suspend→旧 delegation 拒+登录拒+恢复对称） |
| 14 | pending 不授权；revoke access-time；原子提交无 fail-open | 场景 9（revoke 即拒）、注入测试 6/7（kill 后仍 fail-closed）、17（重启仍拒）；moss BINDING_PENDING 拒发 |
| 15 | ReBAC provenance；overlapping 不误删 | 场景 10（revoke 一个，重换发后另一个仍授权；全撤后发行即拒）；`test_overlapping_grant_edges_survive_one_revoke` |
| 16 | 真值表四行+补充 | 场景 7（grant∩ReBAC 四态）+ `test_p0_c2_truth_table_supplements`（read-only/path/zone header spoof/zone-less/root 禁删） |
| 17 | cross-Zone 三重校验+Audit+fail closed | 场景 14（source 无授权 403 → 半授权 403 → policy 未 armed 501 UNSUPPORTED_CAPABILITY） |
| 18 | payload owner/zone 欺骗拒绝 | C2 supplements (3)（X-Nexus-Zone-ID spoof 403）+ (4)（zone-less 拒） |
| 19 | production full 启动证明+缺 provider 拒启+cohost matrix | live-deployment-proof.json（composite/auth/ReBAC armed）+ `test_zone_v2_api` ZoneControlNotArmed + cohost 构建+比对取证（见偏差） |
| 20 | detach/unmount/deprovision 分离 | moss admin UI 三入口分离（zones-page）+ 场景 12（detach≠删除）+ 15（deprovision blocker） |
| 21 | legacy route 委托+window | shadow compare（语义等价 + Deprecation/Sunset headers，list 端点补挂） |
| 22 | migration dry-run/backfill/shadow/rollback | `test_zone_inventory.py` 3/3（9 类 report-only）+ `test_api_key_zones_backfill` + moss `backfill.ts` plan/apply 可重入 + shadow compare + deprecation window |
| 23 | real E2E+故障注入+live proof | 18 场景（moss 7 + nexus 11）全绿 + `test_zone_v2_fault_injection_e2e.py` 3/3 + vfs `deleted_zone_no_resurrection` 1/1 + live-proof.json |
| 24 | release/offline bundle/checksum/SBOM | `verify-offline-bundle.mjs` 通过 + `releases/zone-v1/{bundle,checksums,manifest,sbom}` |

## 测试汇总（全绿）

- moss：test-server 184/0；zones E2E 7/7；typecheck=baseline 116；eslint 0
- nexus：contracts 66/66；migrations（含 inventory 3/3）全绿；P0 矩阵 9/9；注入 3/3；shadow 1/1；zone 回归套件 exit 0；unit zone v2 6/6
- nexus-vfs：`deleted_zone_no_resurrection` 1/1
- sudostack：conformance 18/18；offline bundle verified

## 已知偏差（如实记录）

1. **cohost pin mismatch**：nexus workspace @vfs 763f8c0f，而 cohost `sudocode-tools@59df7a9d` 携带 b878b015；`--features full,cohost-sudocode` 构建 E0277（双 Kernel 类型分叉，与 Cargo.toml 注释预言一致）。上游无任何携带 763f8c0f 的 sudocode commit。处置：步骤 08（R6.5）三联动（sudocode vfs bump+push、nexus pin 同步、构建回绿）。
2. **mTLS**：本地 proof 为 loopback + bearer（NEXUS_NO_TLS）；mTLS 属外部集群拓扑（MOSS_NEXUS_TLS_*），未在本地演练。
3. **nexus 侧 membership 复查 seam**：`moss_membership_verifier` 装配位存在但无跨进程回调实现——membership 失效当前由 moss 侧（发行前校验+进程内 revoke 钩子，watch3/E2E 场景 8 实证）承担；nexus 侧复查为后续集成项。
