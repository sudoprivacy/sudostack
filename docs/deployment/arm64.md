# ARM64 部署

发布、离线包和安装流程支持 `amd64` 与 `arm64`，架构由版本锁中的 `architecture` 固定。本次 ARM64 交付目标为 `sudostack-v0.0.1-rc.8-arm64`。**整包尚未发布：须等下列组件正式 Release 齐备、整包 CI 和 166 的 COS 清空重装验收完成。** 已有 `sudostack-v0.0.1-rc.7` 仍为 amd64 包。

## 组件与来源

各仓库按 commit → PR → 合并 → tag Release 发布，套件只使用正式发布的附件及其 SHA256。开发分支的临时 CI 附件不进入最终版本锁。

| 组件 | 本次固定版本计划 | 源码 PR |
| --- | --- | --- |
| Moss | `server-v0.1.60-rc.arm64.20261015` | [#384](https://github.com/sudoprivacy/moss/pull/384) |
| SudoWork WebUI | `v0.2.32-rc.arm64.20261015` | [#1253](https://github.com/sudoprivacy/sudowork/pull/1253) |
| SudoRouter | [`sudorouter-v0.0.1-rc.2`](https://github.com/sudoprivacy/new-api/releases/tag/sudorouter-v0.0.1-rc.2) | [协议修复 #30](https://github.com/sudoprivacy/new-api/pull/30)、[ARM 打包 #29](https://github.com/sudoprivacy/new-api/pull/29) |
| Sudocode | `v0.2.32`、配套 `nexusd-cohost-v0.2.32` | [#959](https://github.com/sudoprivacy/sudocode/pull/959) |
| Nexus / Vault | `v0.8.15` / `vault-v0.5.68`，plugin ABI 7 | 使用已有 ARM64 Release |
| k3s / gVisor | `v1.34.1+k3s1` / `release-20261005.0` | 使用已有 ARM64 Release |

Moss Server、Runtime、Nexus/Vault、Sudocode、WebUI/PostgreSQL、Router、Caddy、Helm、kubectl、k3s 和 gVisor 均须匹配同一架构。组装时检查每个镜像归档中的实际 OS、架构和镜像标签，并执行 Runtime 中的 `scode --version` 核对完整版本；带预发布或构建后缀的版本不能满足稳定版锁。

Sudocode 从 0.2.32 起补齐 Linux ARM64 bundle/deb，ARM64 二进制要求 glibc 2.35 或更新版本。Moss 的企微会话存档 SDK 依赖上游仅提供的 amd64 原生库，因此 ARM64 镜像不包含该能力。

## 主机要求

目标机需要 Linux ARM64、root、systemd 和 4 KB 页大小。安装器将 `aarch64` / `arm64` 统一识别为 `arm64`，将 `x86_64` / `amd64` 识别为 `amd64`，在修改系统前拒绝错误架构的包。

固定的 gVisor ARM64 制品要求 `getconf PAGE_SIZE` 为 `4096`。上游的 64 KB 页需要[独立的 `pagesize_64k` 构建标记](https://github.com/google/gvisor/blob/release-20261005.0/pkg/hostarch/hostarch_arm64.go)，本流程未发布或验收该变体。

该配置仅用于单节点 k3s。安装器会在创建安装目录、修改 k3s 配置或重启服务前拒绝正在运行的 k3s-agent、已有多节点集群，以及 API 无法读取的运行中 k3s server。已有集群须先完成备份和明确的切换安排。

## 从 COS 安装

以下固定版本入口须在整包发布后使用：

```bash
curl -fsSL https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.8-arm64/install-cos.sh -o install-cos.sh
sudo bash install-cos.sh --host <目标IP或域名> --root /data/atlas --manage-k3s
```

安装器从 COS 下载包含全部依赖的 `sudostack-0.0.1-rc.8-arm64-linux-arm64.tar.gz`，校验整包和内部文件后执行本地安装。入口脚本、`bundle.json`、包内 `atlas-release.json` 的架构必须一致。

使用 `bash install-cos.sh --download-only` 可先下载并校验，不修改运行中的服务，也允许从另一种架构的机器上准备离线包。准备后可直接运行缓存中的 `assets/install-atlas.sh` 离线安装。

重复安装同一版本只验证已有部署。安装目录中的 `verify.sh` 检查服务，`restart.sh` 重启组件，`admin-credentials.txt` 保存管理员入口和凭据。备份、恢复及单节点清理边界见 [COS 部署说明](cos.md)。

## CI、验收与入口发布

一个套件 tag 对应一种架构。首次 ARM64 版本锁必须设置 `architecture: "arm64"`、固定组件版本和 ARM64 Sudocode SHA256，并省略 amd64 的 `baseRelease`。

```bash
python3 tools/deploy/release.py --lock manifests/deployment/<版本>.json --validate
python3 tools/deploy/release.py --lock manifests/deployment/<版本>.json --check
```

`deployment-release.yml` 根据 PR 新增或修改的版本锁选择原生 runner；ARM64 使用 `ubuntu-24.04-arm`。CI 组装完整包后，在干净 runner 上执行安装、保持 Pod UID 的重复安装、重启和经 SudoRouter 的 gVisor 会话恢复。tag 流水线通过后发布 GitHub Release 和不可变 COS 版本目录，默认 `release-only`。

目标机再验证该固定版本的 COS 首装，保存证据，清理本次新集群、安装数据、缓存、Helm 和 gVisor，然后重新从 COS 下载并安装。旧服务备份、模型文件和无关应用应按确认的范围保留。清理脚本会删除整个新 k3s 集群，不能直接用于仍承载其他业务的旧集群。

实机通过后，从同一次成功 CI 复用完整包，发布对应架构的 latest：

```bash
gh workflow run deployment-release.yml -R sudoprivacy/sudostack \
  --ref <原构建tag> -f version=<版本> \
  -f publish_run=<验收成功的run-id> -f cos_mode=latest-only
```

复用检查验证来源仓库、workflow、tag、成功的 `qualify` 作业、完整组件锁和 SHA256SUMS。ARM64 入口为 `latest/arm64/install-cos.sh`，amd64 入口为 `latest/amd64/install-cos.sh`；旧 `latest/install-cos.sh` 继续跟随 amd64。ARM64 发布不覆盖 amd64 入口。

## 166 验证记录

目标机 `172.16.20.166`（spark-01）为 Ubuntu 24.04.4、aarch64、4 KB 页，内核 `6.17.0-1029-nvidia`。截至整包发布前，已完成：

- gVisor ARM64 原生 systrap 沙箱运行 `/bin/sh` 和 `uname`。
- SudoRouter 正式 rc.2 包校验、ARM64 启动及 HTTP 版本 `0.0.1-rc.2` 验证。
- Sudocode ARM64 bundle 安装、执行、卸载及真实 deb 解包执行；RC 0.2.32-rc.1 的包版本与 Cargo 二进制版本 0.2.32 分别核对。
- Sudostack 当时的 61 项部署测试在 root 下全部通过；随后增加完整 Runtime 版本匹配回归，本地 62 项中 58 通过、4 项 root 入口测试由 Linux CI 执行。

旧 Moss、WebUI、k3s-agent 的备份已完成且切换已获授权。整包 COS 首装及清空重装尚未执行，须以最终版本的实机验收结果为准。
