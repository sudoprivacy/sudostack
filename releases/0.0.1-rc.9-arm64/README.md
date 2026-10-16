# Sudostack 0.0.1-rc.9-arm64

**测试候选：原生 ARM64 CI、166 从 COS 首装及清空重装均已通过，测试环境已清理。GitHub Release 尚未创建，ARM64 latest 尚未推广。** [PR #55](https://github.com/sudoprivacy/sudostack/pull/55)。

[返回全部版本](../../.github/README.md#整包版本与组件清单) · [快速发布](../../.github/README.md#快速发布新整包) · [完整发版步骤](../../docs/deployment/releasing.md)

[本版组件锁](../../manifests/deployment/0.0.1-rc.9-arm64.json)。业务组件与 rc.8 ARM64 一致，更新安装器、环境检查、TLS 诊断与访问摘要。

## 组件版本与下载

| 组件 | 固定版本 | 已发布的上游来源 / 下载 |
| --- | --- | --- |
| Moss Server / Runtime / 部署助手 | `0.1.60-rc.arm64.20261015.2` | [Server 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-server-image-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [Runtime 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-runtime-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [部署助手](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-deploy-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [bootstrap-nexus.mjs](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/bootstrap-nexus.mjs) / [install.sh](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/install.sh) / [SHA256SUMS](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/SHA256SUMS) |
| SudoWork WebUI | `0.2.32-rc.arm64.20261015` | [WebUI + PostgreSQL](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-arm64.tar.gz) |
| Nexus cluster | `0.8.15` | [Nexus 原始包](https://github.com/nexi-lab/nexus-vfs/releases/download/v0.8.15/nexusd-cluster-linux-aarch64.tar.gz) |
| Nexus Vault | `0.5.68` | [Vault 插件](https://github.com/nexi-lab/nexus/releases/download/vault-v0.5.68/nexus-vault-linux-aarch64.tar.gz) |
| Sudocode | `0.2.32` | [Sudocode 二进制](https://github.com/sudoprivacy/sudocode/releases/download/v0.2.32/scode-linux-arm64.tar.gz) |
| k3s | `v1.34.1+k3s1` | [k3s-arm64](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-arm64) / [k3s-airgap-images-arm64.tar.zst](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-arm64.tar.zst) / [sha256sum-arm64.txt](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-arm64.txt) |
| gVisor | `release-20261005.0` | [gVisor ARM64](https://github.com/google/gvisor/releases/download/release-20261005.0/gvisor-aarch64.tar.bz2) |
| Helm | `v3.19.0` | [helm-v3.19.0-linux-arm64.tar.gz](https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz) |
| Caddy | `2.10.2` | `docker.io/library/caddy:2.10.2-alpine`，由套件原生组装 |
| PostgreSQL | `16` | `docker.io/library/postgres:16-alpine`，随 WebUI 归档交付 |
| Nexus 基础镜像（Node.js） | `22.22.1` | `docker.io/library/node:22.22.1-trixie-slim`，由套件原生组装 |
| SudoRouter | `0.0.1-rc.2` | [Router 镜像](https://github.com/sudoprivacy/new-api/releases/download/sudorouter-v0.0.1-rc.2/sudorouter-0.0.1-rc.2-linux-arm64.tar.gz) |
| nexusd-cohost（随 Moss Runtime） | `0.2.32` | [Cohost 二进制](https://github.com/sudoprivacy/sudocode/releases/download/nexusd-cohost-v0.2.32/nexusd-cohost-linux-arm64.tar.gz) |
| kubectl（随 Nexus 镜像） | `v1.34.1` | [上游二进制](https://dl.k8s.io/release/v1.34.1/bin/linux/arm64/kubectl) |
| Atlas Helm Chart / 安装器 | `0.0.1-rc.9-arm64` | 随下方 COS 完整包交付 |

Sudocode 随 Moss Runtime；Nexus Vault 随 Nexus 镜像和 Moss Runtime，Nexus plugin ABI 为 `7`。Moss Runtime 内嵌版本详见 [Moss 运行时锁](https://github.com/sudoprivacy/moss/blob/server-v0.1.60-rc.arm64.20261015.2/src/server/nexus/runtime-versions.json)。PostgreSQL 固定为 `16-alpine` 标签，补丁版未单独锁定；实际内容由 WebUI 归档的 SHA256 固定。

## 下载与安装

本次使用 [原生 CI 38835398155](https://github.com/sudoprivacy/sudostack/actions/runs/38835398155) 验收通过的同一份归档，由 [COS 发布运行](https://github.com/sudoprivacy/sudostack/actions/runs/38836691293) 原样上传。

| 文件 | 下载 |
| --- | --- |
| 完整包（3,121,514,868 字节） | [下载](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/sudostack-0.0.1-rc.9-arm64-linux-arm64.tar.gz) |
| 整包 SHA256 | [下载](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/sudostack-0.0.1-rc.9-arm64-linux-arm64.tar.gz.sha256) |
| 安装入口 | [下载](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/install-cos.sh) |
| 清理入口 | [下载](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/cleanup-atlas.sh) |
| 组件锁 | [下载](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/components.lock.json) |
| 实际发布清单 | [下载](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/atlas-release.json) |
| COS 描述文件 | [下载](https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/bundle.json) |

整包 SHA256：`3cd1652990bb84a869bc7f82f4fc44f949707b67b8e1e587f86e43e5e7808b51`。

```bash
curl -fL https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/install-cos.sh -o install-cos.sh
sudo bash ./install-cos.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s
```

本版已经占用不可变 COS 版本目录；不要再用相同版本号重新构建覆盖它。若要创建正式 tag Release，需另选新版本号走首页完整流程，或明确复用这份原始已验收归档；不能把另一次构建冒充同一包。ARM64 latest 尚未推广。

安装成功后输出 WebUI、Moss、Router 的实际 URL、用户名和密码文件位置，及内部组件的凭据位置。摘要保存在 `/data/atlas/access-info.txt` 和 `access-info.json`；管理员密码保存在 `admin-credentials.txt` / `router-admin-credentials.txt`，不会输出到日志。

以 `--host 172.16.20.166 --root /data/atlas` 为例，安装完成时的入口如下；清理测试环境后这些入口和凭据文件也会被移除。

| 组件 | 地址 | 初始用户 | 密码位置（目标机 root 可读） |
| --- | --- | --- | --- |
| SudoWork WebUI | `https://172.16.20.166` | `admin` | `/data/atlas/admin-credentials.txt` |
| Moss 管理后台 | `https://172.16.20.166:8443/admin/` | `admin` | `/data/atlas/admin-credentials.txt` |
| SudoRouter | `https://172.16.20.166:9443` | `admin` | `/data/atlas/router-admin-credentials.txt` |

Nexus、PostgreSQL、Runtime 等内部组件的入口、证书身份和凭据位置也包含在摘要中。重新查看摘要：`sudo cat /data/atlas/access-info.txt`；浏览器测试 CA：`/data/atlas/tls/ca.crt`。

## 本次安装器改进

- 首次部署前检查旧 agent、端口冲突；支持 IPv4-only 主机。
- 本机验证直连入口并使用部署 CA；TLS 失败给出端点和恢复提示。
- 同版本重试继续验证，安装成功输出组件访问摘要。
- CI 自动从实际 manifest / bundle 生成该版 README、逐文件下载地址和 SHA256。

## 166 实机验收（2026-10-16）

目标机为 Ubuntu 24.04.4、ARM64、4 KB 页。使用上述同一 COS 完整包，完成首装 → 清空集群、数据及缓存 → 重新下载 → 重装 → 最终清理。[验收记录 JSON](acceptance-166.json) 保存了制品摘要、源码摘要和两轮结果；[最新原生 CI](https://github.com/sudoprivacy/sudostack/actions/runs/38836745477) 也已通过。

| 检查 | 结果 |
| --- | --- |
| 443 被占用、已停止但未卸载的 agent | 创建安装目录和修改 k3s 前拒绝，并提示处理方式 |
| 从空缓存下载、整包及包内文件校验 | 两轮通过 |
| 离线安装，shell HTTP(S) 代理故意设为不可用 | 两轮均完成，6 个 Deployment Ready |
| 同版本重复安装 | 两轮 Pod UID 均保持不变 |
| HTTPS 登录、WebSocket、gVisor、Router、历史记录及重启恢复 | 两轮通过，恢复原会话 |
| 地址、用户名和密码位置摘要 | 两轮通过，文件权限 600，日志及摘要无密码值 |
| 最终清理 | k3s、`/data/atlas`、缓存、Helm、gVisor 已移除，80/443/8443/9443 可用 |
| 保留范围 | `/data/models`、既有备份及 3 个无关 Docker 应用保留，3000 端口 HTTP 200 |

部署回归测试在 166 的 root 环境中 **76 项全部通过**。会话验收使用测试模型上游；接入真实模型仍需配置 Router 渠道及 API Key。目标机保留脱敏验收记录于 `/var/tmp/sudostack-rc9-acceptance-20261016`，测试脚本源码副本和临时 agent fixture 已移除。

## 清理环境

**仅用于已确认可清空的专用测试环境。** 清理会删除整个本机 k3s 集群、Atlas 数据、凭据、默认下载缓存、Helm 和 gVisor；先保存需要的备份及验收报告。

```bash
curl -fL https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/cleanup-atlas.sh -o cleanup-atlas.sh
bash cleanup-atlas.sh --dry-run
sudo bash cleanup-atlas.sh
```

旧 worker 退出集群应先备份并执行 `sudo sh /usr/local/bin/k3s-agent-uninstall.sh`；此步骤与 Atlas 整体清理不同，详见 [agent 与端口冲突处理](../../docs/deployment/arm64.md)。

## 更新到新的完整包

**当前支持同版本重试，不支持通用跨版本原地升级。** 保留业务数据的实例先制定备份、数据迁移和恢复方案；以下跨版本命令用于已完成备份和上述清理的测试机。必须先选择一个已发布的 arm64 版本，不使用规划版本或其他架构。

同版本重试：修复环境问题后重跑原来的安装命令，会复用校验通过的缓存并继续验证。

```bash
# 在保存该版安装入口的目录运行
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

组件变更、版本锁和 tag 发布命令见 [发版操作手册](../../docs/deployment/releasing.md)。
