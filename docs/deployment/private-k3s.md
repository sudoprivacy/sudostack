# sudostack 版本化交付与单节点 k3s 部署

每个 sudostack 版本固定一套子组件及其部署文件。`manifests/deployment/0.0.1.json` 是 `0.0.1` 的版本组合；Git tag `sudostack-v0.0.1` 冻结该清单及本仓库的 Chart、安装器和运维脚本。升级任一组件或部署文件均应发布新的 sudostack 版本。

CI 生成的 `atlas-release.json` 进一步记录各资源的来源 URL、组件版本、Release asset ID、SHA256，以及构建 Nexus/Caddy 时取得的 registry digest。客户安装时只读取该 Release 的清单，不解析任何子组件的 `latest`。构建输入清单随同发布为 `components.lock.json`。

当前 `0.0.1` 是尚未发布、尚未完成集成验收的组合，锁定 Moss 集成候选 `server-v0.1.53-atlas.1`。该候选由 Moss CI 生成拆分 Server 镜像、部署助手和 Nexus 引导脚本。CI 在下载大文件前检查上游 Release 附件，并检查 Runtime 内实际 Sudocode 版本；不能用开发机手工打包文件填补发布缺口。

| 组件 | `0.0.1` 的版本组合 | 资源归属 |
| --- | --- | --- |
| Moss Server / Session Runtime | `server-v0.1.53-atlas.1` | `sudoprivacy/moss` 的 CI Release 镜像包 |
| Sudocode | `v0.2.23` | `sudoprivacy/sudocode`；CI 检查 Runtime 内实际版本 |
| SudoWork WebUI | `v0.2.28` | `sudoprivacy/sudowork` 的 CI Release 镜像包 |
| PostgreSQL | `16-alpine` | 固定 WebUI Release 包内的镜像，字节由该包 SHA256 固定 |
| Nexus daemon | `v0.8.4` | `nexi-lab/nexus-vfs` 的二进制 Release |
| Nexus Vault 插件 | `vault-v0.5.68` | `nexi-lab/nexus` 的已签名插件 Release |
| k3s / gVisor / Helm | `v1.34.1+k3s1` / `release-20261005.0` / `v3.19.0` | 官方固定版本制品 |
| Caddy | `2.10.2-alpine` | CI 从官方镜像获取并在 sudostack Release 发布镜像包 |

Nexus Broker 的部署镜像由 sudostack CI 组装上述固定 daemon、Vault 插件、Node 和 kubectl，发布为 `atlas-nexus-0.0.1-linux-amd64.tar.gz`。`nexi-lab/nexus` 已有 [Docker Publish](https://github.com/nexi-lab/nexus/blob/develop/.github/workflows/docker-publish.yml) 流程，发布 `ghcr.io/nexi-lab/nexus` 和 `ghcr.io/nexi-lab/nexusd-cluster`；当前 cluster 镜像提供搜索插件、不含本部署所需的 Vault/Node/kubectl，因此不能直接替换。

本入口装配 Moss Server、Nexus Broker、SudoWork WebUI、PostgreSQL、Caddy；Sudocode 随 Runtime 镜像运行在按需创建的 gVisor Pod 中。业务服务使用 Helm/k3s 管理。宿主机 systemd 只管理 k3s 基础设施。

适用范围：单节点 Linux amd64、本地 local-path 存储、独立命名空间 `atlas-system` 和 `moss-sessions`。历史环境使用 Ubuntu 22.04.4；新版干净安装验收、Ubuntu 24.04 验收及正式供应链签名尚未完成。

## 一键安装

在对应 Release 发布后，直接下载该版本的安装入口：

```bash
curl --http1.1 --retry 3 --retry-all-errors -fLO https://github.com/sudoprivacy/sudostack/releases/download/sudostack-v0.0.1/install-atlas.sh
sudo bash install-atlas.sh --host atlas.customer.example --root /data/atlas --manage-k3s
```

`--manage-k3s` 允许安装器引导/重启 k3s，并关闭其内置 Traefik，让 Caddy 使用 80/443/8443。客户机不需要 Docker daemon。已有业务占用这些端口时，应先解决端口冲突；不能同时运行另一个控制 `moss-sessions` 的 Moss 实例。

入口如下：

- `https://atlas.customer.example`：SudoWork，登录页选择“密码登录”。
- `https://atlas.customer.example:8443/admin/`：Moss 管理后台。
- `/data/atlas/admin-credentials.txt`：初始管理员账号与随机密码，仅 root 可读。

两套应用都使用 `/api/v1`，因此 IP profile 使用一个 Caddy 的两个 HTTPS 端口。Nexus、PostgreSQL、Moss 内部 Service 不直接暴露宿主机端口。

默认生成安装专用 CA 和 90 天测试证书。客户端应信任 `/data/atlas/tls/ca.crt`；该证书用途为验收，正式交付请在首次安装时提供客户证书：

```bash
sudo bash install-atlas.sh --host atlas.customer.example --manage-k3s \
  --tls-cert /secure/fullchain.pem --tls-key /secure/key.pem --tls-ca /secure/ca-chain.pem
```

首次安装自动执行 HTTPS、WebUI 登录、WebSocket、gVisor 会话和历史记录验收，使用临时模拟模型，不消耗真实模型额度。测试后删除临时模型和凭据。管理员还需在 Moss 系统设置中配置客户自己的 Router 地址和 API Key，才能执行真实模型任务。

## 状态与重启

```bash
sudo /data/atlas/status.sh
sudo /data/atlas/verify.sh
sudo /data/atlas/restart.sh
sudo /data/atlas/stop.sh
sudo /data/atlas/start.sh
sudo k3s kubectl -n atlas-system logs deployment/moss-server
```

`verify.sh` 检查五个 Deployment 和 HTTPS；`acceptance/` 保存端到端证据。重启测试可在尚未设置客户模型密钥时运行 `python3 /data/atlas/smoke.py --resume`，它在同一会话发送第二轮并检查此前历史。

重复安装相同制品只验证已部署实例。这个候选入口拒绝不同制品的直接覆盖升级；升级兼容矩阵、数据库迁移回退与自动失败回滚还需单独验收。不要把 `helm rollback` 当作数据回滚。

## 数据与备份

`atlas-data` 保存 Moss SQLite、历史、Nexus data/identity/vault、专用 Agent 证书。`atlas-postgres-data` 保存 WebUI 数据库。工作区使用 `moss-sessions` 下的独立 PVC。

Moss 的 kubeconfig 使用 Pod ServiceAccount tokenFile，RBAC 仅授予会话命名空间的必要资源操作。Nexus 通过自己的 CA 签发 `atlas-moss` Agent，授予会话身份签发权限；Moss 的客户端 Secret 不包含节点私钥。所有镜像导入后按 digest 部署，配置和 Secret 不进入镜像。

备份为停机冷备份，包含安装目录、两个命名空间中的 PVC 和业务 Secret，使用 AES-256-CBC/PBKDF2 加密并验证 HMAC-SHA256。先结束活动会话。密钥必须保存在安装目录和备份目录之外、权限 600，并单独保存到另一安全位置：

```bash
sudo sh -c 'umask 077; openssl rand -hex 32 > /secure/atlas-backup.key'
sudo /data/atlas/backup.sh --key-file /secure/atlas-backup.key
sudo /data/atlas/restore.sh --backup /var/backups/atlas/20261012-160000 \
  --key-file /secure/atlas-backup.key
```

恢复会替换当前 PVC 数据。当前恢复命令要求原节点、安装根目录和 PVC UID，支持本机恢复演练；跨集群迁移尚未实现。备份密钥丢失将无法解密。

本次代码分析还复现了两项恢复限制：备份后新增会话 PVC 会导致旧备份被拒绝恢复；工作区含绝对符号链接（例如 Python 虚拟环境的解释器链接）时，备份会成功，但恢复检查会失败。这些问题尚未修复，需要在新版恢复验收前处理。

## CI 发布与离线交付

1. 在 `manifests/deployment/VERSION.json` 提交新的版本组合。组件的仓库、tag、版本必须对应，禁止 `latest`、分支名或漏填组件。
2. 可先运行 `python3 tools/deploy/release.py --lock manifests/deployment/0.0.1.json --check`，检查上游固定版本的附件是否齐全。此命令只读取公开发布信息，不修改集群。
3. `.github/workflows/deployment-release.yml` 的 PR 和手动运行只生成 CI artifact；PR 默认验收 `0.0.1`，手动运行可选择版本。推送 `sudostack-vVERSION` tag 才创建该版本的 GitHub prerelease。CI 从对应 tag 的版本清单拉取制品，不执行本地手工组件构建。现有 Release 不会被覆盖。
4. 发布资产包括安装入口、Chart、运维脚本、`components.lock.json`、`atlas-release.json`、SHA256，以及 sudostack 组装的 Nexus/Caddy 镜像包和基础设施离线文件。Moss/WebUI 镜像保留其原仓库的 Release URL。
5. 客户入口自动下载和校验清单中的资源，缓存于 `/var/cache/sudostack/sudostack-vVERSION`。各文件下载使用临时文件，校验通过后才替换缓存。

在联网的 Linux 构建机上复现 CI，需要 Python、GitHub CLI（`gh`）、curl 和 Docker Buildx：

```bash
python3 tools/deploy/release.py --lock manifests/deployment/0.0.1.json --assets dist/assets
python3 tools/deploy/package.py --assets dist/assets --publish dist/publish
python3 tools/deploy/bundle.py --assets dist/assets --output sudostack-0.0.1-amd64.tar
```

最后一条命令生成离线包及 `.sha256`，只收录 manifest 指定的文件并保留 `offline/` 子目录。CI 同时上传完整包到 `sudostack-installation-candidate` artifact，用于干净安装测试。完整包可能超过 GitHub Release 单文件大小限制，因此客户在线安装使用分文件下载。离线机核对 SHA256、解包后运行包内 `install-atlas.sh`，无需联网。不要打包客户安装目录。

PR CI 对资源下载、版本锁定、打包分发做回归检查，并对 Chart 执行 lint/template 和 Kubernetes schema 校验。SHA256 校验不等同于供应链签名；新版本还需完整安装、重启和恢复验收。运行环境报告位于 `/data/atlas/deployment-report.json`，记录套件及组件版本，不含密码、私钥和 API Key。
