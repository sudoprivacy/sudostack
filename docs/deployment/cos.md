# COS 完整离线包

目标机通过 COS 下载一份完整压缩包，校验后本地安装。部署阶段不再访问 GitHub、Docker Hub、npm 或 Helm 下载站。Python、curl、openssl 等系统基础依赖需预先安装；Ubuntu 软件源与部署制品下载是两个独立步骤。

本页文件名示例为 amd64 rc.7；已发布的 ARM64 rc.8 见 [完整发布清单与下载地址](releases/0.0.1-rc.8-arm64.md)。组件版本变更和新整包发布步骤见 [发版操作手册](releasing.md)。

发布桶沿用 Moss 的 `sudowork-release-1309794936`，sudostack 使用独立前缀：

```text
https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/
  releases/sudostack-v0.0.1-rc.7/
    install-cos.sh
    cos_bundle.py
    bundle.json
    sudostack-0.0.1-rc.7-linux-amd64.tar.gz
    sudostack-0.0.1-rc.7-linux-amd64.tar.gz.sha256
    atlas-release.json
    components.lock.json
    cleanup-atlas.sh
    SHA256SUMS
  latest/install-cos.sh
  latest/cleanup-atlas.sh
```

版本目录禁止用不同内容覆盖。`latest` 仅保存已固定版本的入口脚本，在完整版本上传和校验成功后更新。镜像和组件版本始终由该套件的 manifest 决定。

## 包内资源

rc.7 的完整包包含发布清单及其声明的全部 36 个文件，包含安装后的清理脚本。Moss Runtime、SudoWork 镜像包和基础设施资源都已收录。

| 用途 | 包内内容 |
| --- | --- |
| Moss 控制面 | `moss-server-image-0.1.53-atlas.1-linux-amd64.tar.gz` |
| Sudocode 会话运行环境 | `moss-runtime-0.1.53-atlas.1-linux-amd64.tar.gz`，内含固定 Sudocode |
| Nexus Broker / Vault | `atlas-nexus-0.0.1-rc.2-linux-amd64.tar.gz`，包含所需 daemon、插件、kubectl |
| SudoWork / PostgreSQL | `sudowork-webui-0.2.28-linux-amd64.tar.gz`，包括 PostgreSQL 镜像 |
| new-api / SudoRouter | `sudorouter-0.0.1-rc.1-linux-amd64.tar.gz` |
| HTTPS 网关 | `caddy-2.10.2-linux-amd64.tar.gz` |
| Kubernetes | `offline/k3s-amd64`、安装脚本、airgap 系统镜像及校验文件 |
| gVisor | `offline/runsc-amd64`、containerd shim、辅助二进制及 SHA512 |
| Helm | `helm-v3.19.0-linux-amd64.tar.gz` |
| 部署与验收 | Chart、Moss 引导包、Nexus bootstrap、安装/运维/模拟模型验收脚本、版本与 SHA256 清单 |

rc.5 镜像、Chart 和包内安装器保持原有 CI 制品字节不变。COS 入口、下载助手和清理脚本作为外层交付附件提供。manifest 内的原始 GitHub URL 用于记录来源；包内安装不会据此重新下载资源。

## 全新机器一键安装

rc.7 安装地址由 [tag CI](https://github.com/sudoprivacy/sudostack/actions/workflows/deployment-release.yml) 的 `publish-cos` 成功后提供。

在 Ubuntu 22.04 / x86_64 服务器以 root 执行，替换第一行 IP：

下面的 rc.7 地址只提供 amd64 制品。aarch64 主机请使用 [ARM64 rc.8 安装入口](arm64.md#从-cos-安装)。

```bash
ATLAS_HOST="你的服务器IP"
apt-get update \
&& apt-get install -y ca-certificates curl python3 tar gzip util-linux openssl coreutils \
&& curl --http1.1 --retry 3 --retry-all-errors -fLO \
  https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.7/install-cos.sh \
&& bash install-cos.sh --host "$ATLAS_HOST" --root /data/atlas --manage-k3s
```

入口从同一个 COS 版本目录获取 `bundle.json`、经过 SHA256 校验的下载助手及完整包，然后执行缓存里的 `assets/install-atlas.sh`。下载中断后重复执行可续传；压缩包整体及包内每个文件都会校验。已有完整缓存时仅重新校验，不重新下载大文件。缓存文件损坏时会报出具体路径，不会拿损坏文件继续安装。

默认缓存为 `/var/cache/sudostack/sudostack-v0.0.1-rc.7/`，可以用 `ATLAS_CACHE_DIR` 指定父目录。下载包与解压文件同时占用空间，导入镜像和业务数据还需要额外磁盘空间。

安装后 SudoWork、Moss、Router 分别位于 `https://<host>`、`https://<host>:8443/admin/`、`https://<host>:9443`。账号文件见 [部署入口](../../DEPLOYMENT.md)。真实模型调用仍需在 Router 配置上游渠道。

### 环境检查失败

旧版入口的 `Installation requires root on Linux x86_64.` 同时检查权限、操作系统和 CPU 架构；即使已经是 root，架构不匹配也会触发这条提示。在实际安装的目标机上执行：

```bash
id -u
uname -s
uname -m
```

使用 rc.7 时，预期依次输出 `0`、`Linux`、`x86_64`。如果架构输出 `aarch64` 或 `arm64`，该发布包无法安装：k3s、gVisor、Helm、Nexus 等二进制及容器镜像均固定为 amd64，需要选择完整的 ARM64 发布包。新版入口会报告主机和发布包各自的架构；删除架构检查不能让 amd64 制品支持 ARM64。

## 先下载，再本地安装

```bash
sudo bash install-cos.sh --download-only

# 此步骤仅使用已经解压的本地资源。
sudo bash /var/cache/sudostack/sudostack-v0.0.1-rc.7/assets/install-atlas.sh \
  --host 你的服务器IP --root /data/atlas --manage-k3s
```

也可以手工下载压缩包后搬运到另一台机器：

```bash
ATLAS_COS_RELEASE="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.7"
curl --http1.1 -fLO "$ATLAS_COS_RELEASE/sudostack-0.0.1-rc.7-linux-amd64.tar.gz.sha256"
curl --http1.1 -fL -C - --retry 3 --retry-all-errors \
  "$ATLAS_COS_RELEASE/sudostack-0.0.1-rc.7-linux-amd64.tar.gz" \
  -o sudostack-0.0.1-rc.7-linux-amd64.tar.gz
sha256sum -c sudostack-0.0.1-rc.7-linux-amd64.tar.gz.sha256 \
&& mkdir -p atlas-offline \
&& tar -xzf sudostack-0.0.1-rc.7-linux-amd64.tar.gz -C atlas-offline \
&& sudo bash atlas-offline/install-atlas.sh --host 你的服务器IP --root /data/atlas --manage-k3s
```

## 构建与发布

正式交付由 `.github/workflows/deployment-release.yml` 完成：

1. 推送 `sudostack-vVERSION` tag，CI 读取对应的版本锁，从固定的组件 Release 获取并校验全部资源。
2. `assemble` 生成最终 `.tar.gz`、入口脚本、manifest、descriptor 和 SHA256，并上传同一份 candidate artifact。
3. `qualify` 校验并解压这份完整包，在全新原生 runner（amd64 为 Ubuntu 22.04，arm64 为 Ubuntu 24.04）验收安装、经 Router 的会话、重复安装和重启恢复。验收证据保存包的 descriptor 与 SHA256。
4. `qualify` 成功后，GitHub Release 和 `publish-cos` 发布同一次构建的产物。COS 原样上传完整 candidate artifact，不重新打包；tag 默认仅发布固定版本目录。
5. 目标机完成从 COS 安装、清空安装数据和缓存、重新下载安装的验收后，用 `publish_run` 指向原成功 run，选择 `cos_mode=latest-only`，将同一版本推广到对应架构的 `latest` 入口。详见 [ARM64 发布说明](arm64.md#ci验收与入口发布)。

CI 使用与 Moss 一致的 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY` Actions secrets；目标机下载无需凭据。PR 只构建和验收。手动运行默认不发布 COS，显式设置 `cos_mode` 才发布固定版本或推广入口；复用原包时需要成功的来源 run 和安装验收记录。构建端仍需连接组件 Release 来源；目标机部署资源全部来自 COS。

以下命令仅用于开发机复现打包和排查发布过程，正常发版交给 CI：

```bash
python3 tools/deploy/cos_bundle.py create --assets /path/to/verified/assets --output dist/cos-release
python3 tools/deploy/publish_cos.py --directory dist/cos-release --mode release-only
```

发布命令使用已配置的 `coscmd` 凭据，显式指定发布桶，不改写开发机现有配置。可以用 `--bucket`、`--region`、`--prefix`、`--public-base`、`--config` 覆盖；客户端使用对应的 `ATLAS_COS_BASE`（包含 `sudostack` 前缀）。`--mode release-only` 仅发布固定版本，`--mode latest-only` 在校验固定版本后更新入口。

上传前校验本地完整清单，并检查所有远端同名对象。已存在且 SHA256 元数据或大小不同的对象会阻止发布；不会覆盖旧版本。上传后逐项验证 COS 大小及 SHA256 元数据。完整包不包含客户安装目录、账号、数据库或其他未列入发布 manifest 的文件。

## 清理

```bash
curl -fLO https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.7/cleanup-atlas.sh
bash cleanup-atlas.sh --dry-run
sudo bash cleanup-atlas.sh
```

清理脚本针对专用测试机，会删除整个 k3s 集群、默认 `/data/atlas` 安装和默认 `/var/cache/sudostack` 下载缓存。自定义缓存、另存的离线压缩包或备份需要在对应位置处理。

## 验收与发布状态

构建、安装验收及 COS 发布状态以对应版本的 [tag CI](https://github.com/sudoprivacy/sudostack/actions/workflows/deployment-release.yml) 为准。验收日志和报告保存在该次运行的 `sudostack-installation-evidence` artifact 中；`publish-cos` 的运行摘要给出安装入口、完整包 URL 和 SHA256。

rc.6 加入包内清理脚本，共 36 项资源。正常发版由 CI 构建并上传同一份通过验收的完整包。
