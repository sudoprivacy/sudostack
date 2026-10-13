# 按版本一键部署 Moss / Nexus / Sudocode / SudoWork / SudoRouter

**一个 sudostack 版本 = 一组固定的组件版本 + 对应的部署文件。**
例如 `sudostack 0.0.1` 的组合定义在 [版本清单](manifests/deployment/0.0.1.json)；
CI 从各组件仓库的固定 Release 获取资源，校验后发布 `sudostack-v0.0.1`。
该 Release 同时包含安装器、Helm Chart、运维脚本、组件清单和逐文件 SHA256。
安装器按清单直接下载组件镜像包，不依赖内网验收服务器，也不追随子组件的 `latest`。

**当前候选为 [`sudostack-v0.0.1-rc.5`](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.5)；正式 `0.0.1` 尚未发布。**
该候选锁定 Moss `server-v0.1.53-atlas.1`，由 Moss CI 发布拆分 Server 镜像、部署助手和 Nexus 引导脚本。
SudoRouter 固定为 `sudorouter-v0.0.1-rc.1`，由 `sudoprivacy/new-api` 的 `sudo/rc24` 代码及该仓库 CI 发布。其余组件复用 rc.2 的固定制品。
CI 在全新 Ubuntu 22.04 上完成安装、经 Router 的会话、重复安装和重启恢复后才发布候选。180 的 rc.2 干净安装及本次 Router 增补使用校验过的 GitHub CI 制品；全程没有内网资源服务器。详见 [本次验收记录](docs/deployment/10.0.1.180-rc.5-acceptance.md)。

测试当前候选，在 Linux amd64 服务器执行：

```bash
curl --http1.1 --retry 3 --retry-all-errors -fLO https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1-rc.5/install-atlas.sh
sudo bash install-atlas.sh --host atlas.customer.example --root /data/atlas --manage-k3s
```

将 `--host` 改为目标机的 IPv4 地址或已解析到目标机的域名。
目标机需要 root/sudo、Python 3.9+、curl、tar、gzip、flock、openssl、sha256sum；无需 Docker 或 Node.js。
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
