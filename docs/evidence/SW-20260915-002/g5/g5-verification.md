# G5 P1a Runtime Zone 验收底稿 — SW-20260915-002

完成声明：**“Runtime Zone 归属子集完成”**。声明边界不包含 ADR-002、
P1b Attempt 或完整 data-placement 完成。验证完成日期：2026-09-22。

## §11.4 P1a 十条证据映射

主要可执行证据位于 Nexus
`tests/e2e/server/test_session_runtime_p1a_e2e.py`（4 例）、Moss
`src/server/zones/__tests__/e2e/p1aE2e.test.ts`（5 例）及 sudocode
`rust/crates/runtime/tests/fs_backend_vfs.rs`。

| # | 条目 | 可核验证据 |
|---|---|---|
| 1 | Session 固化 home Zone | Nexus `test_p1a_session_home_zone_and_record_routing`；Moss `R5.8/R5.1` |
| 2 | runtime/PID 固化 execution Zone | Nexus `test_p1a_runtime_run_zones_and_cancellation`；Moss `R5.2` |
| 3 | client payload Zone 不可覆盖 | Nexus `ZONE_OVERRIDE_DENIED` 断言；Moss `R5.3` |
| 4 | ResourceRef target 每次重新授权 | sudocode `p1a_resource_targets_require_the_same_delegated_zone_for_cohost_and_subprocess`，真实 Kernel + permission provider |
| 5 | runtime 使用短期 delegation，无全局 admin token | Nexus `test_p1a_runtime_delegation_revalidation_and_revoke_isolation`；Moss `R5.4` 与 runner-env secret-negative 断言 |
| 6 | revoke 后 active runtime 取消/隔离 | Nexus grant revoke → dependency worker → `revocation_pending`；Moss detach → `parkRunsForZone` |
| 7 | revocation_pending 不获得新资源 | Nexus record write 返回 `REVOCATION_PENDING`；旧 delegation revoke 后返回 `GRANT_REVOKED` |
| 8 | subprocess/cohost Zone 语义一致 | sudocode 同一 `HostZoneContext`/ResourceRef 判定及真实 Kernel I/O 测试 |
| 9 | restart/resume 后 Zone identity 不漂移 | Nexus hard-restart read-back；cross-Zone resume 继承 execution Zone，漂移请求返回 `ZONE_IDENTITY_DRIFT` |
| 10 | 五类真实字节默认落 home Zone | Nexus Session/Transcript/Context/Artifact/Verify 真实 VFS write + routing ledger |

## §15 P1a Definition of Done

| 条目 | 证据 |
|---|---|
| Session home_zone_id 不可变且权威在 Nexus | Nexus immutable create/read/restart E2E |
| 五类记录真实写入 home Zone | Nexus VFS bytes + ledger E2E |
| runtime/PID execution_zone_id 固化可审计 | RuntimeRun + Moss generation read-back |
| 最小 scope、短期 Nexus delegation | delegation TTL/grant/epoch refs；runner env 不含 service/admin token |
| ResourceRef 每次 target access 重新授权 | sudocode Kernel/NexusVfs backend target guard |
| grant revoke 取消/隔离依赖 runtime | grant/epoch dependency index + worker revalidation |
| revocation_pending 无新资源 | Nexus fail-closed E2E |
| subprocess/cohost 一致 | sudocode integration evidence |
| 声明不越界 | 本文声明边界 |

## Pin matrix

| Component | Commit |
|---|---|
| nexus-vfs | `763f8c0fef392da8c1151fc3f17b3a6f3f707dbd` |
| sudostack contracts | `f0c586477694f054c8a31fe682e7481593c16948` |
| sudocode | `7f1c90a2db9aed6dbe05d84e883915e105101b44` |
| nexus | `5bbd66fefabca2a89bca7d8dc3a4cc4fb33a0f0f` |
| moss | `b4f3ac2de2093873b0fd735e21395e304d63b055` |

## 验证命令

### Nexus

```text
uv run ruff check <changed files>
uv run mypy <changed runtime-zone files>
uv run pytest -n 0 tests/e2e/server/test_session_runtime_p1a_e2e.py -q
cargo build --manifest-path Cargo.toml -p nexusd --features full,cohost-sudocode
```

结果：ruff/format 通过；变更 runtime-zone 文件 mypy 通过；Zone service 单测
22/22；真实进程 P1a E2E 4/4；最终 sudocode pin 下 cohost build 通过。

### Moss

```text
npm run build
node scripts/typecheck-ratchet.js
npx eslint <changed files>
node scripts/test-server.js
```

结果：build 通过；Bun 184/184；Node 184/184；真实进程 Zone E2E 12/12，
其中 P1a 5/5。

### sudocode

```text
cargo fmt --manifest-path rust/Cargo.toml --all --check
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path rust/Cargo.toml -p runtime --test fs_backend_vfs
$env:Path='C:\work\software\Git\usr\bin;C:\work\software\Git\bin;'+$env:Path
$env:RUST_TEST_THREADS='1'
cargo test --manifest-path rust/Cargo.toml --workspace --quiet
```

结果：fmt 通过；真实 Kernel/ResourceRef 集成 12/12；完整 workspace 退出码 0。
Windows 全量测试需把 Git Bash 的 `usr/bin` 与 `bin` 同时加入 PATH；单线程用于
规避仓库既有 ACP 固定超时断言在高并发下的偶发超时，不过滤测试。

严格 Clippy 命令在当前 main 基线上仍因存量 warning 失败；本工作项修改文件的
`-D warnings` 净新增为 0。该基线质量门偏差在此如实保留，不在本工作项范围内
清理无关技术债，也不将严格 Clippy 记为通过。
