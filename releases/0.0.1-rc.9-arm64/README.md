# 0.0.1-rc.9-arm64

**候选版本，尚未发布。** [PR #55](https://github.com/sudoprivacy/sudostack/pull/55) 在原生 ARM64 CI 及 166 实机验证，不能作为已发布下载入口。

[返回全部版本](../../README.md#整包版本与组件清单) · [快速发布](../../README.md#快速发布新整包) · [完整发版步骤](../../docs/deployment/releasing.md)

[本版组件锁](../../manifests/deployment/0.0.1-rc.9-arm64.json)。业务组件与 rc.8 ARM64 一致，更新安装器、环境检查、TLS 诊断与访问摘要。

| 组件 | 固定版本 | 已发布的上游来源 / 下载 |
| --- | --- | --- |
| Moss Server / Runtime / 部署助手 | `0.1.60-rc.arm64.20261015.2` | [moss-server-image-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-server-image-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [moss-runtime-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-runtime-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [moss-deploy-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/moss-deploy-0.1.60-rc.arm64.20261015.2-linux-arm64.tar.gz) / [bootstrap-nexus.mjs](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/bootstrap-nexus.mjs) / [install.sh](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/install.sh) / [SHA256SUMS](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.60-rc.arm64.20261015.2/SHA256SUMS) |
| SudoWork WebUI | `0.2.32-rc.arm64.20261015` | [sudowork-webui-0.2.32-rc.arm64.20261015-linux-arm64.tar.gz](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.32-rc.arm64.20261015/sudowork-webui-0.2.32-rc.arm64.20261015-linux-arm64.tar.gz) |
| Nexus cluster | `0.8.15` | [nexusd-cluster-linux-aarch64.tar.gz](https://github.com/nexi-lab/nexus-vfs/releases/download/v0.8.15/nexusd-cluster-linux-aarch64.tar.gz) |
| Nexus Vault | `0.5.68` | [nexus-vault-linux-aarch64.tar.gz](https://github.com/nexi-lab/nexus/releases/download/vault-v0.5.68/nexus-vault-linux-aarch64.tar.gz) |
| Sudocode | `0.2.32` | [scode-linux-arm64.tar.gz](https://github.com/sudoprivacy/sudocode/releases/download/v0.2.32/scode-linux-arm64.tar.gz) |
| k3s | `v1.34.1+k3s1` | [k3s-arm64](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-arm64) / [k3s-airgap-images-arm64.tar.zst](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-arm64.tar.zst) / [sha256sum-arm64.txt](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-arm64.txt) |
| gVisor | `release-20261005.0` | [gvisor-aarch64.tar.bz2](https://github.com/google/gvisor/releases/download/release-20261005.0/gvisor-aarch64.tar.bz2) |
| Helm | `v3.19.0` | [helm-v3.19.0-linux-arm64.tar.gz](https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz) |
| Caddy | `2.10.2` | `docker.io/library/caddy:2.10.2-alpine`，由套件原生组装 |
| PostgreSQL | `16` | `docker.io/library/postgres:16-alpine`，随 WebUI 归档交付 |
| Nexus 基础镜像（Node.js） | `22.22.1` | `docker.io/library/node:22.22.1-trixie-slim`，由套件原生组装 |
| SudoRouter | `0.0.1-rc.2` | [sudorouter-0.0.1-rc.2-linux-arm64.tar.gz](https://github.com/sudoprivacy/new-api/releases/download/sudorouter-v0.0.1-rc.2/sudorouter-0.0.1-rc.2-linux-arm64.tar.gz) |

Sudocode 随 Moss Runtime；Nexus Vault 随 Nexus 镜像和 Moss Runtime。Moss Runtime 的 nexusd-cohost 为 `0.2.32`，详见 [Moss 运行时锁](https://github.com/sudoprivacy/moss/blob/server-v0.1.60-rc.arm64.20261015.2/src/server/nexus/runtime-versions.json)。kubectl 为 `v1.34.1`，随 Nexus 镜像。Chart / 安装器版本将跟随本套件版本。

## 整包与使用

发布前仅使用对应成功 CI 的 `sudostack-installation-candidate` artifact。先校验 SHA256SUMS，再用 artifact 内的 cos_bundle.py 解包；这不是正式 Release 或已推广的 latest。

发布后的整包名：`sudostack-0.0.1-rc.9-arm64-linux-arm64.tar.gz`。对应 GitHub tag 为 `sudostack-v0.0.1-rc.9-arm64`，COS 目录为 `sudostack/releases/sudostack-v0.0.1-rc.9-arm64/`；正式发布后用实际生成的 README 替换本候选页，填入真实大小、SHA256 和验收证据。

安装成功后输出 WebUI、Moss、Router 的实际 URL、用户名和密码文件位置，及内部组件的凭据位置。摘要保存在 `/data/atlas/access-info.txt` 和 `access-info.json`；管理员密码保存在 `admin-credentials.txt` / `router-admin-credentials.txt`，不会输出到日志。

## 本次安装器改进

- 首次部署前检查旧 agent、端口冲突；支持 IPv4-only 主机。
- 本机验证直连入口并使用部署 CA；TLS 失败给出端点和恢复提示。
- 同版本重试继续验证，安装成功输出组件访问摘要。
- CI 自动从实际 manifest / bundle 生成该版 README、逐文件下载地址和 SHA256。
