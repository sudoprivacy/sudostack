# Sudostack 部署与发布总览

**整体文档从本页开始。** 先按架构选择套件版本，再进入该版本 README 查看全部组件版本、下载地址、校验和和对应命令。

[全部版本](#选择版本) · [安装](#安装完整包) · [访问与凭据](#组件访问与凭据) · [清理](#清理测试环境) · [更新](#更新已有安装) · [发布新整包](#修改组件并发布新整包)

## 选择版本

一个套件版本固定一种架构、一组组件及一份安装包。以下发布状态由发布流水线同步，实机验收另列证据。

<!-- release-index:start -->

| 版本 README / 组件清单 | 架构 | 下载与发布状态 | 验收状态 |
| --- | --- | --- | --- |
| [0.0.1-rc.9-arm64](releases/0.0.1-rc.9-arm64/README.md) | ARM64 | COS 固定测试候选可下载；GitHub tag / Release 尚未创建 | 原生 CI、166 首装、清空重装及重启恢复通过；测试环境已清理 |
| [0.0.1-rc.8-arm64](releases/0.0.1-rc.8-arm64/README.md) | ARM64 | GitHub Release 和 COS 固定包已发布 | 原生 CI 通过；166 发现的环境问题由 rc.9 安装器修复 |
| [0.0.1-rc.7](releases/0.0.1-rc.7/README.md) | amd64 | GitHub Release 和 COS 固定包已发布 | 原生 Ubuntu 22.04 CI 安装、重复安装、重启恢复通过 |
| [0.0.1-rc.9-amd64](releases/0.0.1-rc.9-amd64/README.md) | amd64 | 规划版本，无可安装整包 | 尚未构建或验收 |
| [0.0.1-rc.6](releases/0.0.1-rc.6/README.md) | amd64 | GitHub Release / COS 历史候选 | 详见该版 README |
| [0.0.1-rc.5](releases/0.0.1-rc.5/README.md) | amd64 | GitHub Release / COS 历史候选 | 详见该版 README |
| [0.0.1-rc.2](releases/0.0.1-rc.2/README.md) | amd64 | GitHub 历史分项发布 | 详见该版 README |
| [0.0.1-rc.1](releases/0.0.1-rc.1/README.md) | amd64 | GitHub 历史分项发布 | 详见该版 README |

<!-- release-index:end -->

早期 rc.1～rc.7 无架构后缀的已发布版本均为 amd64，保留历史名称。`user-runtime-v*` 是独立 SDK，不是部署整包。ARM64 latest 尚未推广，测试应使用明确版本的下载入口。

166 的 rc.9 [实机验收记录](releases/0.0.1-rc.9-arm64/acceptance-166.json) 已归档：两轮从空缓存下载安装、同版本重复安装、原会话重启恢复均通过，部署回归 76 项全部通过。最终已清理新 k3s、`/data/atlas`、下载缓存、Helm 和 gVisor；模型、既有备份及无关 Docker 应用保留。166 当前没有本次测试安装的服务或凭据。

## 文档导航

| 要做的事 | 阅读位置 |
| --- | --- |
| 查看某版组件版本、下载、安装、清理、更新命令 | 上方对应的版本 README |
| ARM64 主机要求、agent 退群、端口 / TLS 排错、166 验收 | [ARM64 部署](docs/deployment/arm64.md) |
| 断点续传、缓存、只下载、搬运离线包、COS 制品结构 | [COS 与离线交付](docs/deployment/cos.md) |
| k3s 部署结构、数据卷、备份恢复及其限制 | [单节点部署与运维详解](docs/deployment/private-k3s.md) |
| Router 渠道、模型调用和固定版本的增补路径 | [SudoRouter 说明](docs/deployment/sudorouter.md) |
| 更换组件版本、版本锁、PR / tag、GitHub Release、COS、latest | [完整发版操作手册](docs/deployment/releasing.md) |

## 安装前检查

目标机需要 Linux、root/sudo、systemd 和匹配架构的完整包。ARM64 固定 gVisor 制品要求 **4 KB 页**；目前已验收 Ubuntu 24.04 ARM64 和 Ubuntu 22.04 amd64。

安装前准备 Python 3.9+、curl、tar、gzip、flock、openssl、sha256sum 和系统 CA。目标机不需要预装 Docker 或 Node.js；下载整包后，部署制品均来自包内，系统基础依赖需事先准备。磁盘须同时容纳压缩包、解包文件、导入镜像及业务数据。

该配置用于单节点 k3s。`--manage-k3s` 允许安装器引导 / 重启 k3s，并关闭 Traefik，让 Caddy 使用 TCP **80、443、8443、9443**。已有 worker、其他集群或旧 Web 服务时，应先完成数据备份和迁移安排。

```bash
uname -m
getconf PAGE_SIZE
sudo ss -ltnp
```

rc.9 安装器会提前报告运行中或停止但未卸载的 k3s-agent、网关端口冲突；支持 IPv4-only 主机。本机 HTTPS 验证使用部署 CA 并绕过 shell 代理。遇到 agent 或 TLS 问题，按 [环境排错说明](docs/deployment/arm64.md#已有-k3s-agent-的机器) 处理后重试相同版本。

## 安装完整包

以下示例用于已完成 166 验收的 **ARM64 rc.9 完整包**。在目标机执行，替换服务器地址；amd64 安装应将版本改为已发布的 `0.0.1-rc.7`。其他版本先核对上表的架构和发布状态。

```bash
ATLAS_VERSION="0.0.1-rc.9-arm64"
ATLAS_HOST="你的服务器IPv4地址或域名"
ATLAS_RELEASE_BASE="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v$ATLAS_VERSION"
curl --http1.1 --retry 3 --retry-all-errors -fL \
  "$ATLAS_RELEASE_BASE/install-cos.sh" -o "install-$ATLAS_VERSION.sh"
sudo bash "install-$ATLAS_VERSION.sh" --host "$ATLAS_HOST" --root /data/atlas --manage-k3s
```

入口下载整包，支持断点续传；整包和包内文件校验通过后才执行本地安装。只准备离线资源时，将最后一条命令替换为：

```bash
sudo bash "install-$ATLAS_VERSION.sh" --download-only
```

下载中断或修复环境后，重跑原命令即可复用已校验缓存。离线机的解包及本地执行步骤见 [COS 与离线交付](docs/deployment/cos.md#先下载再本地安装)。

## 组件访问与凭据

安装成功后，rc.9 安装器输出各组件地址、实际用户名、密码或证书保存位置，并保存为 `/data/atlas/access-info.txt` 和 `access-info.json`（权限 600，摘要不包含密码值）。重新查看：

```bash
sudo cat /data/atlas/access-info.txt
```

以下 `<host>` 为安装时的 `--host`，路径以默认安装根目录为例。历史版本没有访问摘要文件时，可直接查看对应管理员凭据文件。

| 组件 | 访问地址 / 方式 | 用户 / 身份 | 密码或凭据位置 |
| --- | --- | --- | --- |
| SudoWork WebUI | `https://<host>`，选择“密码登录” | 初始 `admin`，以实际摘要为准 | `/data/atlas/admin-credentials.txt` |
| Moss 管理后台 | `https://<host>:8443/admin/` | 初始 `admin`，以实际摘要为准 | `/data/atlas/admin-credentials.txt` |
| SudoRouter | `https://<host>:9443` | 初始 `admin`，以实际摘要为准 | `/data/atlas/router-admin-credentials.txt` |
| Sudocode / Moss Runtime | 在 SudoWork 创建会话 | WebUI 登录身份 | 无独立登录密码 |
| Nexus broker | 集群内 `nexus-broker.atlas-system.svc.cluster.local:2126` | Moss agent mTLS 证书 | Secret `atlas-system/atlas-nexus-client` |
| Vault | Nexus / Runtime 内嵌插件 | 随 Nexus 身份授权 | 无独立登录密码 |
| PostgreSQL | 集群内 `webui-postgres.atlas-system.svc.cluster.local:5432`，库 `sudowork_webui` | `atlas` | `/data/atlas/credentials.json` 的 `postgresPassword`；Secret `atlas-system/atlas-postgres` |
| Caddy | 提供上述 HTTPS 入口 | 无独立登录用户 | `/data/atlas/tls/` |
| k3s / kubectl / Helm | 本机运维命令 | kubeconfig 证书身份 | `/etc/rancher/k3s/k3s.yaml` |
| gVisor | 集群 RuntimeClass `gvisor` | 无独立登录用户 | 无独立登录密码 |
| Node.js | Nexus 镜像内运行环境 | 无独立登录用户 | 无独立登录密码 |

凭据文件仅 root 可读。默认生成安装专用 CA 和 90 天测试证书，CA 位于 `/data/atlas/tls/ca.crt`；首次安装可用 `--tls-cert`、`--tls-key`、`--tls-ca` 提供证书。

安装器自动配置 Moss → SudoRouter 的内部地址及独立调用令牌，并使用临时模拟模型做会话验收。**真实模型调用需要在 SudoRouter 配置上游渠道和 API Key。**

## 状态、验证与重启

```bash
sudo /data/atlas/status.sh
sudo /data/atlas/verify.sh
sudo /data/atlas/restart.sh
sudo k3s kubectl -n atlas-system logs deployment/moss-server
```

安装目录中的 `release-manifest.json` 记录实际套件及组件版本，`deployment-report.json` 和 `acceptance/` 保存健康检查与会话验收结果。`stop.sh` / `start.sh` 可停止 / 启动套件服务；数据与备份恢复要求见 [运维详解](docs/deployment/private-k3s.md#数据与备份)。

## 清理测试环境

**以下命令用于已确认可清空的专用测试机、默认 `/data/atlas` 安装。** 会删除整个本机 k3s 集群、本地数据卷、数据库、会话、Router 配置、凭据、默认下载缓存、Helm、gVisor 和相关本机端口规则。先另存需要的备份和验收记录。

从已安装实例取得该版本的清理脚本：

```bash
sudo bash /data/atlas/cleanup-atlas.sh --dry-run
sudo bash /data/atlas/cleanup-atlas.sh
```

若安装未完成，使用对应版本 README 提供的清理下载入口。例如 rc.9 ARM64：

```bash
curl -fL https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.9-arm64/cleanup-atlas.sh -o cleanup-atlas.sh
bash cleanup-atlas.sh --dry-run
sudo bash cleanup-atlas.sh
```

`--dry-run` 只预览。k3s 卸载失败时，清理会在删除 Atlas 配置和凭据前停止。旧 k3s-agent 使用自己的官方卸载脚本，详见 [agent 退群说明](docs/deployment/arm64.md#已有-k3s-agent-的机器)。另存的备份、模型文件和无关 Docker 应用不属于 Atlas 清理范围；自定义缓存、客户端导入的 CA 和云安全组规则需在各自位置处理。

## 更新已有安装

**同版本重试**：修复环境问题后，重新执行该版本原安装命令，继续校验已有实例。

**跨版本更新**：当前不支持通用原地升级。有业务数据的实例应先完成备份、迁移和恢复方案；内置恢复命令有节点 / PVC 限制，不能作为任意新集群的直接恢复方法，详见 [备份恢复限制](docs/deployment/private-k3s.md#数据与备份)。

专用测试机完成备份和上述清理后，选择已发布的同架构版本重新安装：

```bash
ATLAS_NEXT_VERSION="实际已发布的同架构版本"
ATLAS_HOST="你的服务器IPv4地址或域名"
ATLAS_NEXT_BASE="https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v$ATLAS_NEXT_VERSION"
curl -fL "$ATLAS_NEXT_BASE/install-cos.sh" -o "install-$ATLAS_NEXT_VERSION.sh"
sudo bash "install-$ATLAS_NEXT_VERSION.sh" --host "$ATLAS_HOST" --root /data/atlas --manage-k3s
sudo /data/atlas/verify.sh
```

核对新的 `release-manifest.json`、访问摘要和验收报告。固定 rc.2 的 `--add-router` 仅是特定增补路径，见 [SudoRouter 说明](docs/deployment/sudorouter.md)。

## 修改组件并发布新整包

完整步骤与字段对应见 [发版操作手册](docs/deployment/releasing.md)，简要流程如下：

1. 在组件仓库发布目标架构的新 tag / Release 附件；复制同架构的套件锁到 `manifests/deployment/<新版本>.json`，修改套件版本、组件版本、tag 和相关 SHA256。升级 Sudocode 需同步发布 Moss Runtime；升级 PostgreSQL 需同步发布 WebUI 包。
2. 执行预检，提交 PR，等待原生 CI 组装和安装验收通过：

   ```bash
   ATLAS_VERSION="你的新套件版本-arm64"
   python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_VERSION.json" --validate
   python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_VERSION.json" --check
   ```

3. PR 合并后，在包含新锁的提交上创建 tag：

   ```bash
   git tag -a "sudostack-v$ATLAS_VERSION" -m "Sudostack $ATLAS_VERSION"
   git push origin "sudostack-v$ATLAS_VERSION"
   ```

4. tag CI 生成组件清单和该版 `README.md`，发布 GitHub Release 与 COS 固定包；随后自动提交该版 `releases/<版本>/README.md` 与本页版本索引到默认分支；发布任务包含这一步，不再手工维护另一份首页索引。
5. 对同一归档完成目标机首装、清空重装和最终清理，保存证据，再按手册复用原包推广对应架构的 latest。

每个 PR 验收一个版本锁。已占用的版本目录和制品不可覆盖；rc.9 ARM64 COS 目录已经使用，后续正常发版应选择新版本号。`components.lock.json` 保存版本锁，`atlas-release.json` 保存实际来源和包内校验和，`bundle.json` 保存完整包大小及 SHA256。
