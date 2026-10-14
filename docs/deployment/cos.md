# COS 完整离线包

目标机通过 COS 下载一份完整压缩包，校验后本地安装。部署阶段不再访问 GitHub、Docker Hub、npm 或 Helm 下载站。Python、curl、openssl 等系统基础依赖需预先安装；Ubuntu 软件源与部署制品下载是两个独立步骤。

发布桶沿用 Moss 的 `sudowork-release-1309794936`，sudostack 使用独立前缀：

```text
https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/
  releases/sudostack-v0.0.1-rc.6/
    install-cos.sh
    cos_bundle.py
    bundle.json
    sudostack-0.0.1-rc.6-linux-amd64.tar.gz
    sudostack-0.0.1-rc.6-linux-amd64.tar.gz.sha256
    atlas-release.json
    components.lock.json
    cleanup-atlas.sh
    SHA256SUMS
  latest/install-cos.sh
  latest/cleanup-atlas.sh
```

版本目录禁止用不同内容覆盖。`latest` 仅保存已固定版本的入口脚本，在完整版本上传和校验成功后更新。镜像和组件版本始终由该套件的 manifest 决定。

## 包内资源

rc.6 的完整包包含发布清单及其声明的全部 36 个文件，包含安装后的清理脚本。Moss Runtime、SudoWork 镜像包和基础设施资源都已收录。

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

在 Ubuntu 22.04 / x86_64 服务器以 root 执行，替换第一行 IP：

```bash
ATLAS_HOST="你的服务器IP"
apt-get update \
&& apt-get install -y ca-certificates curl python3 tar gzip util-linux openssl coreutils \
&& curl --http1.1 --retry 3 --retry-all-errors -fLO \
  https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.6/install-cos.sh \
&& bash install-cos.sh --host "$ATLAS_HOST" --root /data/atlas --manage-k3s
```

入口从同一个 COS 版本目录获取 `bundle.json`、经过 SHA256 校验的下载助手及完整包，然后执行缓存里的 `assets/install-atlas.sh`。下载中断后重复执行可续传；压缩包整体及包内每个文件都会校验。已有完整缓存时仅重新校验，不重新下载大文件。缓存文件损坏时会报出具体路径，不会拿损坏文件继续安装。

默认缓存为 `/var/cache/sudostack/sudostack-v0.0.1-rc.6/`，可以用 `ATLAS_CACHE_DIR` 指定父目录。下载包与解压文件同时占用空间，导入镜像和业务数据还需要额外磁盘空间。

安装后 SudoWork、Moss、Router 分别位于 `https://<host>`、`https://<host>:8443/admin/`、`https://<host>:9443`。账号文件见 [部署入口](../../DEPLOYMENT.md)。真实模型调用仍需在 Router 配置上游渠道。

## 先下载，再本地安装

```bash
sudo bash install-cos.sh --download-only

# 此步骤仅使用已经解压的本地资源。
sudo bash /var/cache/sudostack/sudostack-v0.0.1-rc.6/assets/install-atlas.sh \
  --host 你的服务器IP --root /data/atlas --manage-k3s
```

也可以手工下载压缩包后搬运到另一台机器：

```bash
ATLAS_COS_RELEASE="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.6"
curl --http1.1 -fLO "$ATLAS_COS_RELEASE/sudostack-0.0.1-rc.6-linux-amd64.tar.gz.sha256"
curl --http1.1 -fL -C - --retry 3 --retry-all-errors \
  "$ATLAS_COS_RELEASE/sudostack-0.0.1-rc.6-linux-amd64.tar.gz" \
  -o sudostack-0.0.1-rc.6-linux-amd64.tar.gz
sha256sum -c sudostack-0.0.1-rc.6-linux-amd64.tar.gz.sha256 \
&& mkdir -p atlas-offline \
&& tar -xzf sudostack-0.0.1-rc.6-linux-amd64.tar.gz -C atlas-offline \
&& sudo bash atlas-offline/install-atlas.sh --host 你的服务器IP --root /data/atlas --manage-k3s
```

## 构建与发布

正式交付由 `.github/workflows/deployment-release.yml` 完成：

1. 推送 `sudostack-vVERSION` tag，CI 读取对应的版本锁，从固定的组件 Release 获取并校验全部资源。
2. `assemble` 生成最终 `.tar.gz`、入口脚本、manifest、descriptor 和 SHA256，并上传同一份 candidate artifact。
3. `qualify` 校验并解压这份完整包，在全新 Ubuntu 22.04 runner 验收安装、经 Router 的会话、重复安装和重启恢复。验收证据保存包的 descriptor 与 SHA256。
4. GitHub Release 成功后，`publish-cos` 下载同一份 candidate artifact，校验后原样上传 COS，不重新打包。所有版本文件验证通过后才更新 `latest` 入口。

CI 使用与 Moss 一致的 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY` Actions secrets；目标机下载无需凭据。PR 和手动运行只构建和验收，不发布 COS。构建端仍需连接组件 Release 来源；目标机部署资源全部来自 COS。

以下命令仅用于开发机复现打包和排查发布过程，正常发版交给 CI：

```bash
python3 tools/deploy/cos_bundle.py create --assets /path/to/verified/assets --output dist/cos-release
python3 tools/deploy/publish_cos.py --directory dist/cos-release
```

发布命令使用已配置的 `coscmd` 凭据，显式指定发布桶，不改写开发机现有配置。可以用 `--bucket`、`--region`、`--prefix`、`--public-base`、`--config` 覆盖；客户端使用对应的 `ATLAS_COS_BASE`（包含 `sudostack` 前缀）。`--mode release-only` 仅发布固定版本，`--mode latest-only` 在校验固定版本后更新入口。

上传前校验本地完整清单，并检查所有远端同名对象。已存在且 SHA256 元数据或大小不同的对象会阻止发布；不会覆盖旧版本。上传后逐项验证 COS 大小及 SHA256 元数据。完整包不包含客户安装目录、账号、数据库或其他未列入发布 manifest 的文件。

## 清理

```bash
curl -fLO https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.6/cleanup-atlas.sh
bash cleanup-atlas.sh --dry-run
sudo bash cleanup-atlas.sh
```

清理脚本针对专用测试机，会删除整个 k3s 集群、默认 `/data/atlas` 安装和默认 `/var/cache/sudostack` 下载缓存。自定义缓存、另存的离线压缩包或备份需要在对应位置处理。
