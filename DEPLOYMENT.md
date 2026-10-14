# 按版本一键部署 Moss / Nexus / Sudocode / SudoWork / SudoRouter

**一个 sudostack 版本 = 一组固定的组件版本 + 对应的部署文件。**
例如 `sudostack 0.0.1` 的组合定义在 [版本清单](manifests/deployment/0.0.1.json)；
CI 从各组件仓库的固定 Release 获取资源，校验后发布 `sudostack-v0.0.1`。
该 Release 同时包含安装器、Helm Chart、运维脚本、组件清单和逐文件 SHA256。
COS 安装入口下载一份包含全部组件镜像与离线工具的压缩包，校验后调用包内安装器；目标机无需访问 GitHub 或镜像仓库。组件的原始 Release 来源和校验和保留在清单中。

**当前候选为 [`sudostack-v0.0.1-rc.6`](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.6)；正式 `0.0.1` 尚未发布。**
该候选锁定 Moss `server-v0.1.53-atlas.1`，由 Moss CI 发布拆分 Server 镜像、部署助手和 Nexus 引导脚本。
SudoRouter 固定为 `sudorouter-v0.0.1-rc.1`，由 `sudoprivacy/new-api` 的 `sudo/rc24` 代码及该仓库 CI 发布。其余组件复用 rc.2 的固定制品。
CI 在全新 Ubuntu 22.04 上完成安装、经 Router 的会话、重复安装和重启恢复后才发布候选。180 的 rc.2 干净安装及本次 Router 增补使用校验过的 GitHub CI 制品；全程没有内网资源服务器。详见 [本次验收记录](docs/deployment/10.0.1.180-rc.5-acceptance.md)。

测试当前候选，在 Linux amd64 服务器执行：

```bash
curl --http1.1 --retry 3 --retry-all-errors -fLO https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.6/install-cos.sh
sudo bash install-cos.sh --host atlas.customer.example --root /data/atlas --manage-k3s
```

将 `--host` 改为目标机的 IPv4 地址或已解析到目标机的域名。
目标机需要 root/sudo、Python 3.9+、curl、tar、gzip、flock、openssl、sha256sum；这些系统依赖可由 Ubuntu 软件源安装，无需 Docker 或 Node.js。完整包支持断点续传、SHA256 校验和只下载模式；手动解包后的本地安装命令见 [COS 与离线交付](docs/deployment/cos.md)。
`--manage-k3s` 允许安装或重启 k3s，并关闭 Traefik，让 Caddy 使用 80、443、8443、9443 端口。

Moss、Nexus、SudoWork WebUI、PostgreSQL、Caddy、SudoRouter 分别运行在独立 Deployment 中；
Sudocode 会话使用固定版本的 Runtime 镜像，在按需创建的 gVisor Pod 中运行。

| 用途 | 地址或位置 |
| --- | --- |
| SudoWork | `https://<host>`，选择“密码登录” |
| Moss 管理后台 | `https://<host>:8443/admin/` |
| SudoRouter 管理页面 | `https://<host>:9443` |
| 初始管理员凭据 | `/data/atlas/admin-credentials.txt`，仅 root 可读 |
| SudoRouter 管理员凭据 | `/data/atlas/router-admin-credentials.txt`，仅 root 可读 |
| 默认测试 CA | `/data/atlas/tls/ca.crt`，导入访问端受信任证书库 |
| 已安装版本与组件来源 | `/data/atlas/release-manifest.json` |

默认生成 90 天测试证书；首次安装可同时传入 `--tls-cert`、`--tls-key`、`--tls-ca`。
安装器自动配置 Moss → SudoRouter 的内部地址及独立模型调用令牌。真实模型任务需要管理员在 SudoRouter 中配置上游渠道和 API Key。

```bash
sudo /data/atlas/status.sh
sudo /data/atlas/verify.sh
sudo /data/atlas/restart.sh
sudo k3s kubectl -n atlas-system logs deployment/moss-server
```

相同版本重复安装会验证已有实例；仅对固定 rc.2 提供 `--add-router` 增补路径，见 [SudoRouter 说明](docs/deployment/sudorouter.md)。通用跨版本原地升级仍不支持。
版本发布、组件归属、离线包和备份恢复见 [安装与运维说明](docs/deployment/private-k3s.md)。

专用测试机完成测试后，可将仓库中的 [cleanup-atlas.sh](tools/deploy/cleanup-atlas.sh) 复制到目标机使用。该脚本针对默认 `/data/atlas` 安装目录，会永久删除整个 k3s 集群及本地数据卷、数据库、会话、Router 配置和凭据，同时清理下载缓存、gVisor、Helm 及相关本机防火墙规则。请在目标机执行：

```bash
curl -fLO https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.6/cleanup-atlas.sh
bash cleanup-atlas.sh --dry-run
sudo bash cleanup-atlas.sh
```

`--dry-run` 仅预览；执行清理时若 k3s 卸载失败，脚本会在删除 Atlas 配置前停止。系统基础依赖、另存的备份和独立下载的脚本保留；客户端导入的 CA 和云平台安全组规则需在对应位置另行处理。rc.6 同时将清理脚本收录进离线包，安装后也可直接执行 `/data/atlas/cleanup-atlas.sh`。
