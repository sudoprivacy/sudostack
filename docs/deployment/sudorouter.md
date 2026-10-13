# SudoRouter 随 sudostack 交付

SudoRouter 来自 `sudoprivacy/new-api`，本次按 `sudo/rc24` 的业务提交 `5dc757ffb0d67ecbb06491a513afc524fdbea2ed` 构建。独立发布版本为 [`sudorouter-v0.0.1-rc.1`](https://github.com/sudoprivacy/new-api/releases/tag/sudorouter-v0.0.1-rc.1)，发布提交 `7d7964b939f3c91917ab046453a1ed9718f7a7c6` 仅增加镜像包 CI。sudostack 的 `0.0.1-rc.4` 清单固定引用此版本。

模型请求路径为 SudoWork → Moss / Sudocode 会话 → SudoRouter → 客户配置的上游渠道。SudoRouter 不提供模型本身，上游渠道及其 API Key 需要管理员配置。

## 交付和运行

- SudoRouter 仓库 CI 使用该仓库的 Dockerfile 构建镜像，校验运行版本和 Web 页面，发布镜像 tar.gz、`source.json`、`SHA256SUMS`。
- sudostack 按固定 Release 下载镜像包，验证 SHA256、镜像标签和 amd64 架构；原仓库 URL 保留在发布清单中。
- 新增 `sudorouter` Deployment，使用独立 PVC `atlas-router-data` 保存 SQLite、身份和日志数据。这个单节点部署不需要外部 Redis 或数据库，关闭内存渠道缓存以确保新建渠道立即可用。
- 宿主机不需要 Docker。SudoRouter 与其余业务服务一同由 Helm/k3s 管理，`stop/start/restart` 和冷备份会包含它。

| 用途 | 地址或位置 |
| --- | --- |
| SudoRouter 管理页面 | `https://<host>:9443` |
| 管理员凭据 | `/data/atlas/router-admin-credentials.txt`，权限 600 |
| Moss 内部模型地址 | `http://sudorouter.atlas-system.svc.cluster.local:3000/v1` |
| 安装器保管的 Router 凭据 | `/data/atlas/router-credentials.json`，权限 600 |

初始化先在集群内创建随机管理员密码和独立的 `sudostack-moss` 模型调用令牌，再开放 HTTPS 管理入口。Moss 保存的是模型令牌，不是 SudoRouter 管理 API 的登录令牌；它经 Moss 配置 API 存入 Nexus。入口使用同一套安装证书，首次访问应信任安装 CA。

## 新安装和 rc.2 增补

新机器使用新版本的 `install-atlas.sh --host <host> --manage-k3s`，自动部署六个业务 Deployment 并接好 Moss 的模型地址和令牌。

已有 `sudostack-v0.0.1-rc.2` 的机器，使用新版本安装器执行：

```bash
sudo bash install-atlas.sh --host <host> --root /data/atlas --add-router
```

增补路径只接受清单 `baseRelease` 固定的原版本，验证原 manifest 校验和、每个既有组件版本及镜像包字节都没有改变。rc.4 复用 rc.2 已发布的镜像和基础设施制品，只增加 Router 及相应部署文件。不会删除原数据、重新生成 Moss 管理员凭据或 Vault 主密钥。此功能不代表支持一般的跨版本升级。

已有自定义模型 Key 时，安装器在增补前拒绝覆盖。需要由管理员确定如何迁移现有模型配置。相同版本重复安装只验证现有实例。

## 模型连通性验收

安装自动创建临时 Anthropic 模拟渠道，并通过真实 SudoRouter 完成 WebUI 登录、WebSocket、gVisor 会话和历史保存。模拟上游只允许 Router Pod 访问，不能由会话 Pod 直接调用。测试结束删除临时渠道、上游 Pod 和 Key，保留正式的 Moss → SudoRouter 调用令牌。

尚未配置真实渠道时，可以重跑并验证同一会话的历史恢复：

```bash
sudo /data/atlas/restart.sh
sudo python3 /data/atlas/smoke.py --root /data/atlas --resume
```

已有真实渠道时，自动模拟测试会拒绝运行，避免修改客户渠道或产生真实模型费用。实际业务使用前，应在 SudoRouter 配置上游渠道、模型和额度，再进行真实模型测试。

CI 在全新 Ubuntu 22.04 runner 上执行安装、重复安装和重启后的完整会话测试，全部通过后才发布 sudostack 候选。测试状态及 180 的实际验收结果以对应版本的验收记录为准。
