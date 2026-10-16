# Sudostack 0.0.1-rc.9-amd64

**规划版本，尚未发布，也没有提交专用版本锁或进行 amd64 组装验收。** 下表是拟采用的组件组合，不能据此声称已有 amd64 整包。

[返回全部版本](../../.github/README.md#整包版本与组件清单) · [快速发布](../../.github/README.md#快速发布新整包) · [完整发版步骤](../../docs/deployment/releasing.md)

准备此架构时需新增 `manifests/deployment/0.0.1-rc.9-amd64.json`，设 `architecture=amd64` 并核对 amd64 Sudocode 附件摘要；单独提交版本锁 PR，通过原生 CI 后再发 tag。

## 组件版本与下载

| 组件 | 计划版本 | 已发布的上游来源 / 下载 |
| --- | --- | --- |
| Moss Server / Runtime / 部署助手 | `0.1.60-rc.arm64.20261015.2` | [Server 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-server-image-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) / [Runtime 镜像](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-runtime-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) / [部署助手](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-deploy-0.1.60-rc.arm64.20261015.2-linux-amd64.tar.gz) / [bootstrap-nexus.mjs](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/bootstrap-nexus.mjs) / [install.sh](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/install.sh) / [SHA256SUMS](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/SHA256SUMS) |
| SudoWork WebUI | `0.2.32-rc.arm64.20261015` | [WebUI + PostgreSQL](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-amd64.tar.gz) |
| Nexus cluster | `0.8.15` | [Nexus 原始包](https://github.com/nexi-lab/nexus-vfs/releases/download/v0.8.15/nexusd-cluster-linux-x86_64.tar.gz) |
| Nexus Vault | `0.5.68` | [Vault 插件](https://github.com/nexi-lab/nexus/releases/download/vault-v0.5.68/nexus-vault-linux-x86_64.tar.gz) |
| Sudocode | `0.2.32` | [Sudocode 二进制](https://github.com/sudoprivacy/sudocode/releases/download/v0.2.32/scode-linux-x64-bundle.tar.gz) |
| k3s | `v1.34.1+k3s1` | [k3s](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s) / [k3s-airgap-images-amd64.tar.zst](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-amd64.tar.zst) / [sha256sum-amd64.txt](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-amd64.txt) |
| gVisor | `release-20261005.0` | [gVisor amd64](https://github.com/google/gvisor/releases/download/release-20261005.0/gvisor-x86_64.tar.bz2) |
| Helm | `v3.19.0` | [helm-v3.19.0-linux-amd64.tar.gz](https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz) |
| Caddy | `2.10.2` | `docker.io/library/caddy:2.10.2-alpine`，由套件原生组装 |
| PostgreSQL | `16` | `docker.io/library/postgres:16-alpine`，随 WebUI 归档交付 |
| Nexus 基础镜像（Node.js） | `22.22.1` | `docker.io/library/node:22.22.1-trixie-slim`，由套件原生组装 |
| SudoRouter | `0.0.1-rc.2` | [Router 镜像](https://github.com/sudoprivacy/new-api/releases/download/sudorouter-v0.0.1-rc.2/sudorouter-0.0.1-rc.2-linux-amd64.tar.gz) |

Sudocode 随 Moss Runtime；Nexus Vault 随 Nexus 镜像和 Moss Runtime。Moss Runtime 的 nexusd-cohost 为 `0.2.32`，详见 [Moss 运行时锁](https://github.com/sudoprivacy/moss/blob/server-v0.1.60-rc.arm64.20261015.2/src/server/nexus/runtime-versions.json)。kubectl 为 `v1.34.1`，随 Nexus 镜像。Chart / 安装器版本将跟随本套件版本。

## 下载与安装

发布前仅使用对应成功 CI 的 `sudostack-installation-candidate` artifact。先校验 SHA256SUMS，再用 artifact 内的 cos_bundle.py 解包；这不是正式 Release 或已推广的 latest。

发布后的整包名：`sudostack-0.0.1-rc.9-amd64-linux-amd64.tar.gz`。对应 GitHub tag 为 `sudostack-v0.0.1-rc.9-amd64`，COS 目录为 `sudostack/releases/sudostack-v0.0.1-rc.9-amd64/`；正式发布后用实际生成的 README 替换本候选页，填入真实大小、SHA256 和验收证据。

安装成功后输出 WebUI、Moss、Router 的实际 URL、用户名和密码文件位置，及内部组件的凭据位置。摘要保存在 `/data/atlas/access-info.txt` 和 `access-info.json`；管理员密码保存在 `admin-credentials.txt` / `router-admin-credentials.txt`，不会输出到日志。

## 本次安装器改进

- 首次部署前检查旧 agent、端口冲突；支持 IPv4-only 主机。
- 本机验证直连入口并使用部署 CA；TLS 失败给出端点和恢复提示。
- 同版本重试继续验证，安装成功输出组件访问摘要。
- CI 自动从实际 manifest / bundle 生成该版 README、逐文件下载地址和 SHA256。

## 清理环境

**仅用于已确认可清空的专用测试环境。** 清理会删除整个本机 k3s 集群、Atlas 数据、凭据、默认下载缓存、Helm 和 gVisor；先保存需要的备份及验收报告。

```bash
# 候选包成功安装后，使用它自带的清理脚本
sudo bash /data/atlas/cleanup-atlas.sh --dry-run
sudo bash /data/atlas/cleanup-atlas.sh
```

旧 worker 退出集群应先备份并执行 `sudo sh /usr/local/bin/k3s-agent-uninstall.sh`；此步骤与 Atlas 整体清理不同，详见 [agent 与端口冲突处理](../../docs/deployment/arm64.md)。

## 更新到新的完整包

**当前支持同版本重试，不支持通用跨版本原地升级。** 保留业务数据的实例先制定备份、数据迁移和恢复方案；以下跨版本命令用于已完成备份和上述清理的测试机。必须先选择一个已发布的 amd64 版本，不使用规划版本或其他架构。

同版本重试：修复环境问题后重跑原来的安装命令，会复用校验通过的缓存并继续验证。

```bash
# 使用该版原安装入口；候选离线包替换为实际解包路径
sudo bash /path/to/unpacked/assets/install-atlas.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s
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
