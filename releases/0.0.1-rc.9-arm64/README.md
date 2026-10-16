# Sudostack 0.0.1-rc.9-arm64

**GitHub Release 与 COS 固定包已发布。**

[部署与发布总览](https://github.com/sudoprivacy/sudostack/blob/main/DEPLOYMENT.md) · [全部版本](https://github.com/sudoprivacy/sudostack/blob/main/DEPLOYMENT.md#选择版本) · [快速发布](https://github.com/sudoprivacy/sudostack/blob/main/DEPLOYMENT.md#修改组件并发布新整包)

平台：**Linux arm64**。完整包：**3,121,514,868 字节**（约 2.91 GiB）。

## 整包与交付文件

| 文件 | 下载地址 |
| --- | --- |
| 完整离线包 | [sudostack-0.0.1-rc.9-arm64-linux-arm64.tar.gz](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/sudostack-0.0.1-rc.9-arm64-linux-arm64.tar.gz) |
| 整包 SHA256 | [sudostack-0.0.1-rc.9-arm64-linux-arm64.tar.gz.sha256](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/sudostack-0.0.1-rc.9-arm64-linux-arm64.tar.gz.sha256) |
| 一键安装入口 | [install-cos.sh](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/install-cos.sh) |
| 清理脚本 | [cleanup-atlas.sh](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/cleanup-atlas.sh) |
| 组件版本锁 | [components.lock.json](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/components.lock.json) |
| 完整发布清单 | [atlas-release.json](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/atlas-release.json) |
| COS 文件大小与摘要 | [bundle.json](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/bundle.json) |
| COS 交付文件校验表 | [SHA256SUMS](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/SHA256SUMS) |
| 离线下载与解包助手 | [cos_bundle.py](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/cos_bundle.py) |

整包 SHA256：

```text
3cd1652990bb84a869bc7f82f4fc44f949707b67b8e1e587f86e43e5e7808b51
```

完整包包含全部运行镜像、离线工具与安装文件；目标机仍须预装 Python、curl、openssl 等系统依赖。
GitHub Release 附件用于清单和分项下载，完整 `.tar.gz` 从上述 COS 地址下载。

## 下载与安装

```bash
ATLAS_COS_RELEASE="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64"
curl -fL "$ATLAS_COS_RELEASE/install-cos.sh" -o install-cos.sh
# 先下载、解包并校验全部文件
bash install-cos.sh --download-only
# 在满足要求的目标机安装，替换为实际 IP 或域名
sudo bash install-cos.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s
```

清理脚本会删除整个 k3s 集群及安装数据。仅在已确认清空范围的专用测试机执行；详见 [安装与清理边界](https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/releasing.md)。

ARM64 要求 Linux、root、systemd 和 4 KB 页大小；企微会话存档 SDK 暂不支持 ARM64。

## 组件版本与下载

| 组件 | 锁定版本 | 分项下载 / 包含关系 |
| --- | --- | --- |
| Moss Server / Runtime / 部署助手 | [`0.1.60-rc.arm64.20261015.2`](https://github.com/sudoprivacy/moss/releases/tag/server-v0.1.60-rc.arm64.20261015.2) | [Server 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-server-image-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [Runtime 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-runtime-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [部署助手](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-deploy-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) |
| SudoWork WebUI | [`0.2.32-rc.arm64.20261015`](https://github.com/sudoprivacy/sudowork/releases/tag/v0.2.32-rc.arm64.20261015) | [WebUI + PostgreSQL](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-arm64.tar.gz) |
| Nexus cluster | [`0.8.15`](https://github.com/nexi-lab/nexus-vfs/releases/tag/v0.8.15) | [Nexus 原始包](https://github.com/nexi-lab/nexus-vfs/releases/download/v0.8.15/nexusd-cluster-linux-aarch64.tar.gz)；整包使用 [套件 Nexus 镜像](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/atlas-nexus-0.0.1-rc.9-arm64-linux-arm64.tar.gz)；plugin ABI 7 |
| Nexus Vault | [`0.5.68`](https://github.com/nexi-lab/nexus/releases/tag/vault-v0.5.68) | [Vault 插件](https://github.com/nexi-lab/nexus/releases/download/vault-v0.5.68/nexus-vault-linux-aarch64.tar.gz)；集成于 Nexus 镜像 |
| Sudocode | [`0.2.32`](https://github.com/sudoprivacy/sudocode/releases/tag/v0.2.32) | [Sudocode 二进制](https://github.com/sudoprivacy/sudocode/releases/download/v0.2.32/scode-linux-arm64.tar.gz)；集成于 Moss Runtime |
| k3s | `v1.34.1+k3s1` | [k3s-arm64](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-arm64) / [k3s-airgap-images-arm64.tar.zst](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-arm64.tar.zst) / [sha256sum-arm64.txt](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-arm64.txt) |
| gVisor | `release-20261005.0` | [gvisor-aarch64.tar.bz2](https://github.com/google/gvisor/releases/download/release-20261005.0/gvisor-aarch64.tar.bz2) |
| Helm | `v3.19.0` | [helm-v3.19.0-linux-arm64.tar.gz](https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz) |
| Caddy | `2.10.2` | [caddy-2.10.2-linux-arm64.tar.gz](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/caddy-2.10.2-linux-arm64.tar.gz)；`docker.io/library/caddy:2.10.2-alpine` |
| PostgreSQL | `16` | `docker.io/library/postgres:16-alpine`；随 [WebUI + PostgreSQL](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-arm64.tar.gz) 交付 |
| Nexus 基础镜像（Node.js） | `22.22.1` | `docker.io/library/node:22.22.1-trixie-slim`；集成于 [套件 Nexus 镜像](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/atlas-nexus-0.0.1-rc.9-arm64-linux-arm64.tar.gz) |
| SudoRouter | [`0.0.1-rc.2`](https://github.com/sudoprivacy/new-api/releases/tag/sudorouter-v0.0.1-rc.2) | [Router 镜像](https://github.com/sudoprivacy/new-api/releases/download/sudorouter-v0.0.1-rc.2/sudorouter-0.0.1-rc.2-linux-arm64.tar.gz) |
| nexusd-cohost（随 Moss Runtime） | `0.2.32` | [上游二进制](https://github.com/sudoprivacy/sudocode/releases/download/nexusd-cohost-v0.2.32/nexusd-cohost-linux-arm64.tar.gz) |
| kubectl（随 Nexus 镜像） | `v1.34.1` | [上游二进制](https://dl.k8s.io/release/v1.34.1/bin/linux/arm64/kubectl) |
| Atlas Helm Chart | `0.0.1-rc.9-arm64` | [atlas-mvp-0.0.1-rc.9-arm64.tgz](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/atlas-mvp-0.0.1-rc.9-arm64.tgz) |
| 安装器与运维脚本 | `0.0.1-rc.9-arm64` | [install-atlas.sh](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/install-atlas.sh)；详见下方文件清单 |

Moss Runtime 内嵌依赖（含 nexusd-cohost）由 Moss 固定；详见 [该 Moss tag 的 runtime-versions.json](https://github.com/sudoprivacy/moss/blob/server-v0.1.60-rc.arm64.20261015.2/src/server/nexus/runtime-versions.json)。
PostgreSQL 的锁为 `16-alpine` 一类镜像标签，未单独记录补丁版；实际交付内容由 WebUI 归档 SHA256 固定。
Nexus 基础镜像和 Caddy 的 registry digest 见 `atlas-release.json.registryInputs`；其余上游附件摘要见 `buildInputs`。

## 清理环境

**仅用于已确认可清空的专用测试环境。** 清理会删除整个本机 k3s 集群、Atlas 数据、凭据、默认下载缓存、Helm 和 gVisor；先保存需要的备份及验收报告。

```bash
curl -fL "https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/cleanup-atlas.sh" -o cleanup-atlas.sh
bash cleanup-atlas.sh --dry-run
sudo bash cleanup-atlas.sh
```

旧 worker 退出集群应先备份并执行 `sudo sh /usr/local/bin/k3s-agent-uninstall.sh`；此步骤与 Atlas 整体清理不同，详见 [agent 与端口冲突处理](https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/arm64.md)。

## 更新到新的完整包

**当前支持同版本重试，不支持通用跨版本原地升级。** 保留业务数据的实例先制定备份、数据迁移和恢复方案；以下跨版本命令用于已完成备份和上述清理的测试机。必须先选择一个已发布的 arm64 版本，不使用规划版本或其他架构。

同版本重试：修复环境问题后重跑原来的安装命令，会复用校验通过的缓存并继续验证。

```bash
# 在保存该版安装入口的目录运行；离线安装使用解包后的 install-atlas.sh
sudo bash ./install-cos.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s
```

清理后安装新版（将变量替换为实际已发布版本和目标地址）：

```bash
ATLAS_NEXT_VERSION="替换为已发布的同架构版本"
ATLAS_HOST="你的服务器IP或域名"
ATLAS_NEXT_BASE="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v$ATLAS_NEXT_VERSION"
curl -fL "$ATLAS_NEXT_BASE/install-cos.sh" -o "install-$ATLAS_NEXT_VERSION.sh"
sudo bash "install-$ATLAS_NEXT_VERSION.sh" --host "$ATLAS_HOST" --root /data/atlas --manage-k3s
```

更新后执行 `sudo /data/atlas/verify.sh`，核对 `/data/atlas/release-manifest.json` 中的版本。新安装器还会输出入口、用户名和密码文件位置，保存到 `access-info.txt` / `access-info.json`。

组件变更、版本锁和 tag 发布命令见 [发版操作手册](https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/releasing.md)。

## 验收与后续发布

GitHub Release 在原生 CI 安装、同版本重复安装和会话重启恢复验收通过后创建；上述 COS 地址在该次 `publish-cos` 成功后可用。
[本次 CI 与验收记录](https://github.com/sudoprivacy/sudostack/actions/runs/38835398155)。
目标机首装、清空重装及 `latest` 推广须单独记录；tag 发布默认只写固定版本目录。
修改组件版本后：先发布上游组件 → 新增套件版本锁 → PR 原生验收 → 合并并推送新 tag → 发布固定 COS 整包 → 目标机首装 / 清空重装 → 复用同一包推广 `latest`。
[逐步发版操作手册](https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/releasing.md)。

<details>
<summary>完整包内文件：atlas-release.json + 38 项资源（下载与 SHA256）</summary>

`atlas-release.json` 自身 SHA256：`ef36125faf2c24ba73f9f4ed4b842a0ba481fe14593bd7ea942ca491d167a936`。

| 包内路径 | 原始下载地址 | SHA256 |
| --- | --- | --- |
| `SHA256SUMS` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/SHA256SUMS) | `4d46e935717e22a6ba9ef1314f96e4fed6d7b791ddec570127b5f0d09e499709` |
| `artifacts.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/artifacts.py) | `76914e455efc4712f26585e4a5c02204b2eb82d722ac6bcf8c849e91a153621d` |
| `atlas-mvp-0.0.1-rc.9-arm64.tgz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/atlas-mvp-0.0.1-rc.9-arm64.tgz) | `968d7b4e3896d84ac1e9780e19d15f6d12be8a86603358b59e93cf8c681f21da` |
| `atlas-nexus-0.0.1-rc.9-arm64-linux-arm64.tar.gz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/atlas-nexus-0.0.1-rc.9-arm64-linux-arm64.tar.gz) | `54d2ce1c51328535e92d17f0de370b61b6da50b495dfab3c0dcc35d78cbf57a9` |
| `atlas.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/atlas.py) | `9fc3a723ad48d426b0625f0bee46eecd4873586bdf9cea9fb1010fd51f7dfacd` |
| `bootstrap-nexus.mjs` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/bootstrap-nexus.mjs) | `d866cab44ab34e6c0b599f15ec29f1c09e571945aeb573c31bd5200f333c22fc` |
| `caddy-2.10.2-linux-arm64.tar.gz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/caddy-2.10.2-linux-arm64.tar.gz) | `4151422d574d96cdfc3f2a477414849659fe489f323a1f736411a42b5e560ee1` |
| `cleanup-atlas.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/cleanup-atlas.sh) | `f80c3525313124b3d457863d9605f2eb41c0b1e2584af568e6633311222cb5bb` |
| `components.lock.json` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/components.lock.json) | `f98eaddd7613693930259cfbc0e80f420c967baaf434f9a327fa4656c973cd36` |
| `diagnostics.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/diagnostics.py) | `c35bbcf3aea9cf99ae73f920a40fa6cd4634777081e592da777e3f7d8a84779c` |
| `helm-v3.19.0-linux-arm64.tar.gz` | [下载](https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz) | `440cf7add0aee27ebc93fada965523c1dc2e0ab340d4348da2215737fc0d76ad` |
| `install-atlas.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/install-atlas.sh) | `1637a16b5696c97cac78e6537aadc8ad588828562ceaac3e78112e0dde8c0e8b` |
| `install.sh` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/install.sh) | `83cbe8b3cda5e7d2f380560e6d865d1b56920cc8a119e3e053fe31b4e9ddf416` |
| `mock-openai-server.mjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/mock-openai-server.mjs) | `472f9b9840367264277e6cf2e30bd4b9c53e88eea464d6e9c1de30f3b8937c82` |
| `moss-deploy-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-deploy-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) | `7488b47ba5868c15c268aa2bb0c8f957438b38397eed42f3169892bb0abb0391` |
| `moss-diagnostics.cjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/moss-diagnostics.cjs) | `9f586e366b7b15757d36b29cb2fbc3cdadcbaafed14aa60459760486baff1ca6` |
| `moss-runtime-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-runtime-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) | `8691ee9e3a47e9881330472bf0ede3e91db63366db396f44e3a3ffe5398ea1f4` |
| `moss-server-image-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-server-image-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) | `ea0fa41d8065042d4fe4e30f74e469c31a7a6be1f0f9b2efea0c425d31305b5b` |
| `offline/containerd-shim-runsc-v1-arm64` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--containerd-shim-runsc-v1-arm64) | `a699226de45c7eb10ea2a27510e2336ebcc4f5a66853444329ec8a7f59ec1453` |
| `offline/containerd-shim-runsc-v1-arm64.sha512` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--containerd-shim-runsc-v1-arm64.sha512) | `eb25669464f9e787cfe7ebce3d389bcccc6a2e740e7aaca2d4a0d2588f8f432f` |
| `offline/gvisor-bin-arm64/SHA512SUMS` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--gvisor-bin-arm64--SHA512SUMS) | `56bef6f712eadfdbfe95d1cc41407eb766e39c249567ae5cac99d16e70391d51` |
| `offline/gvisor-bin-arm64/checkpointgofer` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--gvisor-bin-arm64--checkpointgofer) | `0c0c971952904485b5723ec07f4e9f76d993c7887bc06a652be765f0ba72b568` |
| `offline/gvisor-bin-arm64/gvisor-sentry-prewarmer` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--gvisor-bin-arm64--gvisor-sentry-prewarmer) | `502b8b28f6a98a345a3e4bee8e1542dadaead1839e78697ba1296791adcd7632` |
| `offline/gvisor-bin-arm64/gvisor_sentry` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--gvisor-bin-arm64--gvisor_sentry) | `bbfe071ec9f9165a11862d3f3a49d6e27c6da9d0581cea5eb97f68429a768dd5` |
| `offline/gvisor-bin-arm64/runsc-fd-parking` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--gvisor-bin-arm64--runsc-fd-parking) | `e41db2da554154f282f2829a664a2c4234c163b9da74fc9b4388126223c7090c` |
| `offline/gvisor-bin-arm64/runsc-metric-server` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--gvisor-bin-arm64--runsc-metric-server) | `c289e684ac5c10d12f1aa2280a4dd2d8bef7a22d2232fa20d5fe313301858277` |
| `offline/k3s-airgap-images-arm64.tar.zst` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-arm64.tar.zst) | `78380791cb61262b78d61c2b52fd77e0eedde6c0351e53d11e2cfb9034ec5937` |
| `offline/k3s-arm64` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-arm64) | `3888e0f28e16be4de619d652a5a3e4816ae85878a38f914b1830bff3ef7483ff` |
| `offline/k3s-install.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--k3s-install.sh) | `48fe6ec10517263cc69e1c924cf6b283c59a2b942b9b46186fc7c8d29e6f243a` |
| `offline/k3s-sha256sum-arm64.txt` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-arm64.txt) | `2e19233beb96c45c34ade1d40be11fc317019d11e2f69b0010b70f039243aab5` |
| `offline/runsc-arm64` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--runsc-arm64) | `3e7eabcfdddc7f8e619b4494915338c86db8a4d1190c54da46721ebb140a7ce6` |
| `offline/runsc-arm64.sha512` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/offline--runsc-arm64.sha512) | `bfc99db7b555a861f947e06f590e42b311bd87da66dffecc3eebd402598d4e0a` |
| `router.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/router.py) | `96f195f8b1bb01c491832ee5db9aa8b07f730c4b0e133a5e375113738d9ff8ef` |
| `smoke.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/smoke.py) | `c35850d848583ebdccda5c586886011f78b180bcce7a7ed545ac04b88ea808c5` |
| `snapshot.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/snapshot.py) | `6e3525d519ec0442e55d0ae21a2c58017fe4af303b273777d624ad76c288ab59` |
| `sudorouter-0.0.1-rc.2-linux-arm64.tar.gz` | [下载](https://github.com/sudoprivacy/new-api/releases/download/sudorouter-v0.0.1-rc.2/sudorouter-0.0.1-rc.2-linux-arm64.tar.gz) | `9e1d374ce0e7eb143a3af8c55cfcbf504fa4278689dac6f540d14576d41643cb` |
| `sudowork-webui-0.2.32-rc.arm64.20261015-linux-arm64.tar.gz` | [下载](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-arm64.tar.gz) | `446464c4d923d6b815a2b616d0eed2bdc741405ff610a85706b6f2576df54e64` |
| `webui-smoke.cjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-arm64/webui-smoke.cjs) | `50e949faabf004b1107cc47be0ffd24c83f4b6264dc23973b6c99a59ab3caef1` |

包内路径保留 `offline/`；GitHub 附件名可能以 `--` 代替 `/`，请使用清单中的实际 URL。

</details>

## 166 实机验收

该归档已完成从空缓存首装、清理后重新下载重装、两轮同版本重复安装和原会话重启恢复；最终环境已清理。模型、既有备份及无关 Docker 应用保留。[验收记录](https://github.com/sudoprivacy/sudostack/blob/main/releases/0.0.1-rc.9-arm64/acceptance-166.json)。会话测试使用临时模拟模型；真实模型调用仍需配置 Router 上游渠道。

安装器支持访问摘要时，安装 / 验证成功会输出各组件地址、实际用户及密码位置，保存为 `/data/atlas/access-info.txt` / `access-info.json`；摘要不包含密码。管理员凭据位于 `admin-credentials.txt` / `router-admin-credentials.txt`。
