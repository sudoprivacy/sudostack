# Sudostack 0.0.1-rc.9-amd64

**GitHub Release 与 COS 固定包已发布。**

[部署与发布总览](https://github.com/sudoprivacy/sudostack/blob/main/DEPLOYMENT.md) · [全部版本](https://github.com/sudoprivacy/sudostack/blob/main/DEPLOYMENT.md#选择版本) · [快速发布](https://github.com/sudoprivacy/sudostack/blob/main/DEPLOYMENT.md#修改组件并发布新整包)

平台：**Linux amd64**。完整包：**3,241,238,128 字节**（约 3.02 GiB）。

## 整包与交付文件

| 文件 | 下载地址 |
| --- | --- |
| 完整离线包 | [sudostack-0.0.1-rc.9-amd64-linux-amd64.tar.gz](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/sudostack-0.0.1-rc.9-amd64-linux-amd64.tar.gz) |
| 整包 SHA256 | [sudostack-0.0.1-rc.9-amd64-linux-amd64.tar.gz.sha256](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/sudostack-0.0.1-rc.9-amd64-linux-amd64.tar.gz.sha256) |
| 一键安装入口 | [install-cos.sh](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/install-cos.sh) |
| 清理脚本 | [cleanup-atlas.sh](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/cleanup-atlas.sh) |
| 组件版本锁 | [components.lock.json](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/components.lock.json) |
| 完整发布清单 | [atlas-release.json](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/atlas-release.json) |
| COS 文件大小与摘要 | [bundle.json](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/bundle.json) |
| COS 交付文件校验表 | [SHA256SUMS](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/SHA256SUMS) |
| 离线下载与解包助手 | [cos_bundle.py](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/cos_bundle.py) |

整包 SHA256：

```text
9e288dc6ba44b8e9e1122f70f84c927fca15a158d5f6f703db7cdc7b9689abdb
```

完整包包含全部运行镜像、离线工具与安装文件；目标机仍须预装 Python、curl、openssl 等系统依赖。
GitHub Release 附件用于清单和分项下载，完整 `.tar.gz` 从上述 COS 地址下载。

## 下载与安装

```bash
ATLAS_COS_RELEASE="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64"
curl -fL "$ATLAS_COS_RELEASE/install-cos.sh" -o install-cos.sh
# 先下载、解包并校验全部文件
bash install-cos.sh --download-only
# 在满足要求的目标机安装，替换为实际 IP 或域名
sudo bash install-cos.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s
```

清理脚本会删除整个 k3s 集群及安装数据。仅在已确认清空范围的专用测试机执行；详见 [安装与清理边界](https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/releasing.md)。

## 组件版本与下载

| 组件 | 锁定版本 | 分项下载 / 包含关系 |
| --- | --- | --- |
| Moss Server / Runtime / 部署助手 | [`0.1.60-rc.arm64.20261015.2`](https://github.com/sudoprivacy/moss/releases/tag/server-v0.1.60-rc.arm64.20261015.2) | [Server 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-server-image-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) / [Runtime 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-runtime-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) / [部署助手](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-deploy-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) |
| SudoWork WebUI | [`0.2.32-rc.arm64.20261015`](https://github.com/sudoprivacy/sudowork/releases/tag/v0.2.32-rc.arm64.20261015) | [WebUI + PostgreSQL](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-amd64.tar.gz) |
| Nexus cluster | [`0.8.15`](https://github.com/nexi-lab/nexus-vfs/releases/tag/v0.8.15) | [Nexus 原始包](https://github.com/nexi-lab/nexus-vfs/releases/download/v0.8.15/nexusd-cluster-linux-x86_64.tar.gz)；整包使用 [套件 Nexus 镜像](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/atlas-nexus-0.0.1-rc.9-amd64-linux-amd64.tar.gz)；plugin ABI 7 |
| Nexus Vault | [`0.5.68`](https://github.com/nexi-lab/nexus/releases/tag/vault-v0.5.68) | [Vault 插件](https://github.com/nexi-lab/nexus/releases/download/vault-v0.5.68/nexus-vault-linux-x86_64.tar.gz)；集成于 Nexus 镜像 |
| Sudocode | [`0.2.32`](https://github.com/sudoprivacy/sudocode/releases/tag/v0.2.32) | [Sudocode 二进制](https://github.com/sudoprivacy/sudocode/releases/download/v0.2.32/scode-linux-x64-bundle.tar.gz)；集成于 Moss Runtime |
| k3s | `v1.34.1+k3s1` | [k3s](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s) / [k3s-airgap-images-amd64.tar.zst](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-amd64.tar.zst) / [sha256sum-amd64.txt](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-amd64.txt) |
| gVisor | `release-20261005.0` | [gvisor-x86_64.tar.bz2](https://github.com/google/gvisor/releases/download/release-20261005.0/gvisor-x86_64.tar.bz2) |
| Helm | `v3.19.0` | [helm-v3.19.0-linux-amd64.tar.gz](https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz) |
| Caddy | `2.10.2` | [caddy-2.10.2-linux-amd64.tar.gz](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/caddy-2.10.2-linux-amd64.tar.gz)；`docker.io/library/caddy:2.10.2-alpine` |
| PostgreSQL | `16` | `docker.io/library/postgres:16-alpine`；随 [WebUI + PostgreSQL](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-amd64.tar.gz) 交付 |
| Nexus 基础镜像（Node.js） | `22.22.1` | `docker.io/library/node:22.22.1-trixie-slim`；集成于 [套件 Nexus 镜像](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/atlas-nexus-0.0.1-rc.9-amd64-linux-amd64.tar.gz) |
| SudoRouter | [`0.0.1-rc.2`](https://github.com/sudoprivacy/new-api/releases/tag/sudorouter-v0.0.1-rc.2) | [Router 镜像](https://github.com/sudoprivacy/new-api/releases/download/sudorouter-v0.0.1-rc.2/sudorouter-0.0.1-rc.2-linux-amd64.tar.gz) |
| nexusd-cohost（随 Moss Runtime） | `0.2.32` | [上游二进制](https://github.com/sudoprivacy/sudocode/releases/download/nexusd-cohost-v0.2.32/nexusd-cohost-linux-x64.tar.gz) |
| kubectl（随 Nexus 镜像） | `v1.34.1` | [上游二进制](https://dl.k8s.io/release/v1.34.1/bin/linux/amd64/kubectl) |
| Atlas Helm Chart | `0.0.1-rc.9-amd64` | [atlas-mvp-0.0.1-rc.9-amd64.tgz](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/atlas-mvp-0.0.1-rc.9-amd64.tgz) |
| 安装器与运维脚本 | `0.0.1-rc.9-amd64` | [install-atlas.sh](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/install-atlas.sh)；详见下方文件清单 |

Moss Runtime 内嵌依赖（含 nexusd-cohost）由 Moss 固定；详见 [该 Moss tag 的 runtime-versions.json](https://github.com/sudoprivacy/moss/blob/server-v0.1.60-rc.arm64.20261015.2/src/server/nexus/runtime-versions.json)。
PostgreSQL 的锁为 `16-alpine` 一类镜像标签，未单独记录补丁版；实际交付内容由 WebUI 归档 SHA256 固定。
Nexus 基础镜像和 Caddy 的 registry digest 见 `atlas-release.json.registryInputs`；其余上游附件摘要见 `buildInputs`。

## 清理环境

**仅用于已确认可清空的专用测试环境。** 清理会删除整个本机 k3s 集群、Atlas 数据、凭据、默认下载缓存、Helm 和 gVisor；先保存需要的备份及验收报告。

```bash
curl -fL "https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-amd64/cleanup-atlas.sh" -o cleanup-atlas.sh
bash cleanup-atlas.sh --dry-run
sudo bash cleanup-atlas.sh
```

旧 worker 退出集群应先备份并执行 `sudo sh /usr/local/bin/k3s-agent-uninstall.sh`；此步骤与 Atlas 整体清理不同，详见 [agent 与端口冲突处理](https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/arm64.md)。

## 更新到新的完整包

**当前支持同版本重试，不支持通用跨版本原地升级。** 保留业务数据的实例先制定备份、数据迁移和恢复方案；以下跨版本命令用于已完成备份和上述清理的测试机。必须先选择一个已发布的 amd64 版本，不使用规划版本或其他架构。

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
[本次 CI 与验收记录](https://github.com/sudoprivacy/sudostack/actions/runs/38846866432)。
目标机首装、清空重装及 `latest` 推广须单独记录；tag 发布默认只写固定版本目录。
修改组件版本后：先发布上游组件 → 新增套件版本锁 → PR 原生验收 → 合并并推送新 tag → 发布固定 COS 整包 → 目标机首装 / 清空重装 → 复用同一包推广 `latest`。
[逐步发版操作手册](https://github.com/sudoprivacy/sudostack/blob/main/docs/deployment/releasing.md)。

<details>
<summary>完整包内文件：atlas-release.json + 38 项资源（下载与 SHA256）</summary>

`atlas-release.json` 自身 SHA256：`8980d80fd37c048bd687218a2fbcc952798f9f1028fce52452d1294227d243cb`。

| 包内路径 | 原始下载地址 | SHA256 |
| --- | --- | --- |
| `SHA256SUMS` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/SHA256SUMS) | `4d46e935717e22a6ba9ef1314f96e4fed6d7b791ddec570127b5f0d09e499709` |
| `artifacts.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/artifacts.py) | `76914e455efc4712f26585e4a5c02204b2eb82d722ac6bcf8c849e91a153621d` |
| `atlas-mvp-0.0.1-rc.9-amd64.tgz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/atlas-mvp-0.0.1-rc.9-amd64.tgz) | `e089d110cb9a60ff6b58e41f1724074ebf6118926a9140c89b491d10924b904d` |
| `atlas-nexus-0.0.1-rc.9-amd64-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/atlas-nexus-0.0.1-rc.9-amd64-linux-amd64.tar.gz) | `27693f6954ef1147e68aa0352773ac95c565168a05b4fd6a3ba180b28215f4ab` |
| `atlas.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/atlas.py) | `9fc3a723ad48d426b0625f0bee46eecd4873586bdf9cea9fb1010fd51f7dfacd` |
| `bootstrap-nexus.mjs` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/bootstrap-nexus.mjs) | `d866cab44ab34e6c0b599f15ec29f1c09e571945aeb573c31bd5200f333c22fc` |
| `caddy-2.10.2-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/caddy-2.10.2-linux-amd64.tar.gz) | `6068c6072f048b0894006c2fa78eb4b97568d2a24bbd9ea294514530e058f732` |
| `cleanup-atlas.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/cleanup-atlas.sh) | `f80c3525313124b3d457863d9605f2eb41c0b1e2584af568e6633311222cb5bb` |
| `components.lock.json` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/components.lock.json) | `28f0d9bc602a2c047e01fe46fc87a4cb07c8e6c748d652582d6a0ebc6916654e` |
| `diagnostics.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/diagnostics.py) | `c35bbcf3aea9cf99ae73f920a40fa6cd4634777081e592da777e3f7d8a84779c` |
| `helm-v3.19.0-linux-amd64.tar.gz` | [下载](https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz) | `a7f81ce08007091b86d8bd696eb4d86b8d0f2e1b9f6c714be62f82f96a594496` |
| `install-atlas.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/install-atlas.sh) | `f8834c0fc296177cf2350f3b675563e3932473ecdbf0879680fe151b5c1ef29d` |
| `install.sh` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/install.sh) | `83cbe8b3cda5e7d2f380560e6d865d1b56920cc8a119e3e053fe31b4e9ddf416` |
| `mock-openai-server.mjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/mock-openai-server.mjs) | `472f9b9840367264277e6cf2e30bd4b9c53e88eea464d6e9c1de30f3b8937c82` |
| `moss-deploy-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-deploy-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) | `4e696ec39904a7d203fd3f0a61f4d5fb752e48f66d7dd6ab7dc4620278108bf4` |
| `moss-diagnostics.cjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/moss-diagnostics.cjs) | `9f586e366b7b15757d36b29cb2fbc3cdadcbaafed14aa60459760486baff1ca6` |
| `moss-runtime-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-runtime-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) | `98babec0a9d91f3f369382d7d9488c644417106848113f6efea0b24a842d8ae4` |
| `moss-server-image-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-server-image-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) | `0efb354691a73916595984f76cf22857b5b6dcf9708b6ecdfcbaa8efd9cc538a` |
| `offline/containerd-shim-runsc-v1-amd64` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--containerd-shim-runsc-v1-amd64) | `2bff94d15386d36e62e2f105ba835f650e55327cb731d96820cbbfe5592c2a6b` |
| `offline/containerd-shim-runsc-v1-amd64.sha512` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--containerd-shim-runsc-v1-amd64.sha512) | `48e9b3d53a6919d454e9396db956afbf85aff48fd872b227f5b9de1247b8cb24` |
| `offline/gvisor-bin-amd64/SHA512SUMS` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--gvisor-bin-amd64--SHA512SUMS) | `90cd4526014b00c4877fd46901ae45122dd686ba3fa88d93031b991cc088097d` |
| `offline/gvisor-bin-amd64/checkpointgofer` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--gvisor-bin-amd64--checkpointgofer) | `c454d0b5fab4627d8915194f901a70c66bb4792f680e3f75d2a47516382b449a` |
| `offline/gvisor-bin-amd64/gvisor-sentry-prewarmer` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--gvisor-bin-amd64--gvisor-sentry-prewarmer) | `3315d7ad7c2d3751d349e4976fa02da1da6fd7e41746c35622304e5fabe4fce0` |
| `offline/gvisor-bin-amd64/gvisor_sentry` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--gvisor-bin-amd64--gvisor_sentry) | `0050e7c6063e17de1729500cd73b18322d85c758eb0ffcab18e539df7110bd12` |
| `offline/gvisor-bin-amd64/runsc-fd-parking` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--gvisor-bin-amd64--runsc-fd-parking) | `03af90d07ea466c10ecc3e3ba839b2a59540959dd3286aea3886917cba850c11` |
| `offline/gvisor-bin-amd64/runsc-metric-server` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--gvisor-bin-amd64--runsc-metric-server) | `7bcbe5846a0f6d34c7d2bd312033bb92ab6305b9ac93e09b753b3474f91f27b2` |
| `offline/k3s-airgap-images-amd64.tar.zst` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-amd64.tar.zst) | `27355d2838c727180f0a8ded8aec0ac14e2186bd50487a3c3f29500884121aa7` |
| `offline/k3s-amd64` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s) | `ec8958fe1363a32d50e028b5e3411c04b0dbd0316fab33524e8094352b78f6a3` |
| `offline/k3s-install.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--k3s-install.sh) | `48fe6ec10517263cc69e1c924cf6b283c59a2b942b9b46186fc7c8d29e6f243a` |
| `offline/k3s-sha256sum-amd64.txt` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-amd64.txt) | `e3101d0c8459a14e5c1ef7c0538a4e8202af145c769bb8b2a1193b88e5bcb25c` |
| `offline/runsc-amd64` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--runsc-amd64) | `210b437a9cfae51e8f8c9074ed19b8b5e59477178e2e391a18117d8d6b924f7a` |
| `offline/runsc-amd64.sha512` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/offline--runsc-amd64.sha512) | `e770bbb7f89e4240e6c928a733772882d14de9cd0ffb0d2a396c66ad2ddea984` |
| `router.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/router.py) | `96f195f8b1bb01c491832ee5db9aa8b07f730c4b0e133a5e375113738d9ff8ef` |
| `smoke.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/smoke.py) | `c35850d848583ebdccda5c586886011f78b180bcce7a7ed545ac04b88ea808c5` |
| `snapshot.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/snapshot.py) | `6e3525d519ec0442e55d0ae21a2c58017fe4af303b273777d624ad76c288ab59` |
| `sudorouter-0.0.1-rc.2-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/new-api/releases/download/sudorouter-v0.0.1-rc.2/sudorouter-0.0.1-rc.2-linux-amd64.tar.gz) | `7023c99086574149b2330aa7e2113ecc23b480a9db9a41b2246ae9b591d17b24` |
| `sudowork-webui-0.2.32-rc.arm64.20261015-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-amd64.tar.gz) | `616de51b0366d5c0fda0400663bdff3ee37464330fdae4480a4b5e559aae86db` |
| `webui-smoke.cjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.9-amd64/webui-smoke.cjs) | `50e949faabf004b1107cc47be0ffd24c83f4b6264dc23973b6c99a59ab3caef1` |

包内路径保留 `offline/`；GitHub 附件名可能以 `--` 代替 `/`，请使用清单中的实际 URL。

</details>

安装器支持访问摘要时，安装 / 验证成功会输出各组件地址、实际用户及密码位置，保存为 `/data/atlas/access-info.txt` / `access-info.json`；摘要不包含密码。管理员凭据位于 `admin-credentials.txt` / `router-admin-credentials.txt`。
