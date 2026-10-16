# 0.0.1-rc.2（Linux amd64）

[GitHub Release](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.2) · [返回全部版本](../../README.md#整包版本与组件清单)

历史分项发布。未发现该版本的 COS 完整包 descriptor；请使用该版 GitHub 发布清单中的来源下载，不能套用新版 COS 整包地址。

[组件锁](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/components.lock.json) · [完整发布清单](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/atlas-release.json) · [安装入口](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/install-atlas.sh) · [校验表](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/SHA256SUMS)

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| Moss Server / Runtime / 部署助手 | `0.1.53-atlas.1` | https://github.com/sudoprivacy/moss/releases/tag/server-v0.1.53-atlas.1 |
| SudoWork WebUI | `0.2.28` | https://github.com/sudoprivacy/sudowork/releases/tag/v0.2.28 |
| Nexus cluster | `0.8.4` | https://github.com/nexi-lab/nexus-vfs/releases/tag/v0.8.4 |
| Nexus Vault | `0.5.68` | https://github.com/nexi-lab/nexus/releases/tag/vault-v0.5.68 |
| Sudocode | `0.2.23` | https://github.com/sudoprivacy/sudocode/releases/tag/v0.2.23 |
| k3s | `v1.34.1+k3s1` | 见下方实际制品来源 |
| gVisor | `release-20261005.0` | 见下方实际制品来源 |
| Helm | `v3.19.0` | 见下方实际制品来源 |
| Caddy | `2.10.2` | docker.io/library/caddy:2.10.2-alpine |
| PostgreSQL | `16` | docker.io/library/postgres:16-alpine |
| Nexus 基础镜像（Node.js） | `22.22.1` | docker.io/library/node:22.22.1-trixie-slim |

各版本独立锁定。Helm Chart 与安装器版本均为 `0.0.1-rc.2`；依赖的镜像和原始文件摘要以下面 manifest 为准。

| 包内文件 | 直接下载 | SHA256 |
| --- | --- | --- |
| `SHA256SUMS` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.53-atlas.1/SHA256SUMS) | `29d4c13b5cb232c2b7777a4cc576098f189419d9dbe2ccf770ffe1821a77f34d` |
| `artifacts.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/artifacts.py) | `76914e455efc4712f26585e4a5c02204b2eb82d722ac6bcf8c849e91a153621d` |
| `atlas-mvp-0.0.1-rc.2.tgz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/atlas-mvp-0.0.1-rc.2.tgz) | `40e501dfdfb339e3646c0e320a8884038281fbc50df478e809f33759af372ae0` |
| `atlas-nexus-0.0.1-rc.2-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/atlas-nexus-0.0.1-rc.2-linux-amd64.tar.gz) | `e4e5e7d295c5420470624d78bfe5bff340010eff6eaad584f3168a5a43276416` |
| `atlas.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/atlas.py) | `f3f10db9f5d0a10680b942b65a998003fe31605bf3485f8574cc8266c7677c34` |
| `bootstrap-nexus.mjs` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.53-atlas.1/bootstrap-nexus.mjs) | `d866cab44ab34e6c0b599f15ec29f1c09e571945aeb573c31bd5200f333c22fc` |
| `caddy-2.10.2-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/caddy-2.10.2-linux-amd64.tar.gz) | `ee6f3240da9777ae688eeed5c1d3ecbb08256f8d8bbf8ac80d6e1a7519f3d4ee` |
| `components.lock.json` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/components.lock.json) | `2554125315c7b9dbb3d90c593a75b58ff52ef1039fc3f6081ae2fd2c837dcbef` |
| `helm-v3.19.0-linux-amd64.tar.gz` | [下载](https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz) | `a7f81ce08007091b86d8bd696eb4d86b8d0f2e1b9f6c714be62f82f96a594496` |
| `install-atlas.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/install-atlas.sh) | `1b3b06a8c75290ad38778c1df0fd72f38f6723e3619b11b98ca1976d97c6118d` |
| `install.sh` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.53-atlas.1/install.sh) | `f9d12e55c1294be83bff424aaa079aecb930e81f8599fd0772672c8cde652d57` |
| `mock-openai-server.mjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/mock-openai-server.mjs) | `472f9b9840367264277e6cf2e30bd4b9c53e88eea464d6e9c1de30f3b8937c82` |
| `moss-deploy-0.1.53-atlas.1-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.53-atlas.1/moss-deploy-0.1.53-atlas.1-linux-amd64.tar.gz) | `83cb780615a6787ad9416d30c06ddf801fee5c38d539a67fff389fb218c09273` |
| `moss-runtime-0.1.53-atlas.1-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.53-atlas.1/moss-runtime-0.1.53-atlas.1-linux-amd64.tar.gz) | `664aeb2e98a1a1e5c11178242d86d9a711c01d707fa3e52af4ef078f7bd1a7b2` |
| `moss-server-image-0.1.53-atlas.1-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/moss/releases/download/server-v0.1.53-atlas.1/moss-server-image-0.1.53-atlas.1-linux-amd64.tar.gz) | `ec5050d165a95817cc68242539f91865287314fe4a97ddd3e66f2aa1793cbe1d` |
| `offline/containerd-shim-runsc-v1-amd64` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--containerd-shim-runsc-v1-amd64) | `2bff94d15386d36e62e2f105ba835f650e55327cb731d96820cbbfe5592c2a6b` |
| `offline/containerd-shim-runsc-v1-amd64.sha512` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--containerd-shim-runsc-v1-amd64.sha512) | `48e9b3d53a6919d454e9396db956afbf85aff48fd872b227f5b9de1247b8cb24` |
| `offline/gvisor-bin-amd64/SHA512SUMS` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--gvisor-bin-amd64--SHA512SUMS) | `90cd4526014b00c4877fd46901ae45122dd686ba3fa88d93031b991cc088097d` |
| `offline/gvisor-bin-amd64/checkpointgofer` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--gvisor-bin-amd64--checkpointgofer) | `c454d0b5fab4627d8915194f901a70c66bb4792f680e3f75d2a47516382b449a` |
| `offline/gvisor-bin-amd64/gvisor-sentry-prewarmer` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--gvisor-bin-amd64--gvisor-sentry-prewarmer) | `3315d7ad7c2d3751d349e4976fa02da1da6fd7e41746c35622304e5fabe4fce0` |
| `offline/gvisor-bin-amd64/gvisor_sentry` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--gvisor-bin-amd64--gvisor_sentry) | `0050e7c6063e17de1729500cd73b18322d85c758eb0ffcab18e539df7110bd12` |
| `offline/gvisor-bin-amd64/runsc-fd-parking` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--gvisor-bin-amd64--runsc-fd-parking) | `03af90d07ea466c10ecc3e3ba839b2a59540959dd3286aea3886917cba850c11` |
| `offline/gvisor-bin-amd64/runsc-metric-server` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--gvisor-bin-amd64--runsc-metric-server) | `7bcbe5846a0f6d34c7d2bd312033bb92ab6305b9ac93e09b753b3474f91f27b2` |
| `offline/k3s-airgap-images-amd64.tar.zst` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s-airgap-images-amd64.tar.zst) | `27355d2838c727180f0a8ded8aec0ac14e2186bd50487a3c3f29500884121aa7` |
| `offline/k3s-amd64` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/k3s) | `ec8958fe1363a32d50e028b5e3411c04b0dbd0316fab33524e8094352b78f6a3` |
| `offline/k3s-install.sh` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--k3s-install.sh) | `48fe6ec10517263cc69e1c924cf6b283c59a2b942b9b46186fc7c8d29e6f243a` |
| `offline/k3s-sha256sum-amd64.txt` | [下载](https://github.com/k3s-io/k3s/releases/download/v1.34.1%2Bk3s1/sha256sum-amd64.txt) | `e3101d0c8459a14e5c1ef7c0538a4e8202af145c769bb8b2a1193b88e5bcb25c` |
| `offline/runsc-amd64` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--runsc-amd64) | `210b437a9cfae51e8f8c9074ed19b8b5e59477178e2e391a18117d8d6b924f7a` |
| `offline/runsc-amd64.sha512` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/offline--runsc-amd64.sha512) | `e770bbb7f89e4240e6c928a733772882d14de9cd0ffb0d2a396c66ad2ddea984` |
| `smoke.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/smoke.py) | `4d0b94125168b00a6c9e252cd2a6cbb31d8776403bfde1f9af01bdb65476f32a` |
| `snapshot.py` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/snapshot.py) | `6e3525d519ec0442e55d0ae21a2c58017fe4af303b273777d624ad76c288ab59` |
| `sudowork-webui-0.2.28-linux-amd64.tar.gz` | [下载](https://github.com/sudoprivacy/sudowork/releases/download/v0.2.28/sudowork-webui-0.2.28-linux-amd64.tar.gz) | `57519f1a15d7a58c562aa7fb5a28e140c5b6a33c245df56f52f4e333109fe379` |
| `webui-smoke.cjs` | [下载](https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.2/webui-smoke.cjs) | `fb8aadbe4665e90808514e7afc7b01a6698ef3c545d607040e5fe4ed9e6ed2af` |

安装与主机要求见 [部署文档](../../DEPLOYMENT.md)；该历史包的架构固定为 amd64。

后续发版见 [首页快速发布](../../README.md#快速发布新整包)。
