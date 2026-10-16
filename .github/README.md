# sudostack

顶层装配 repo：以 submodule 引用各 **Base product** 与 **Mega-product**，并作为**跨全家族技术架构 SSOT** 的落位。

## 整包版本与组件清单

**从这里选版本 → 打开该版本 README → 查看组件版本、下载地址、校验和与安装说明。**

| 版本 README | 平台 | 状态 | GitHub Release |
| --- | --- | --- | --- |
| [0.0.1-rc.9-arm64](../releases/0.0.1-rc.9-arm64/README.md) | Linux ARM64 | COS 候选；原生 CI、166 首装及清空重装通过，测试环境已清理 | 尚未创建 |
| [0.0.1-rc.9-amd64](../releases/0.0.1-rc.9-amd64/README.md) | Linux amd64 | 规划版本，组件组合待独立构建验收 | 尚未发布 |
| [0.0.1-rc.8-arm64](../releases/0.0.1-rc.8-arm64/README.md) | Linux ARM64 | 固定整包已发布；latest 未推广 | [Release](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.8-arm64) |
| [0.0.1-rc.7](../releases/0.0.1-rc.7/README.md) | Linux amd64 | 已发布候选 | [Release](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.7) |
| [0.0.1-rc.6](../releases/0.0.1-rc.6/README.md) | Linux amd64 | 历史候选 | [Release](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.6) |
| [0.0.1-rc.5](../releases/0.0.1-rc.5/README.md) | Linux amd64 | 历史候选 | [Release](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.5) |
| [0.0.1-rc.2](../releases/0.0.1-rc.2/README.md) | Linux amd64 | 历史分项发布 | [Release](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.2) |
| [0.0.1-rc.1](../releases/0.0.1-rc.1/README.md) | Linux amd64 | 历史分项发布 | [Release](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.1) |

新版本采用 `<版本>-arm64` / `<版本>-amd64` 的命名，一个 tag 固定一种架构。早期 rc.1～rc.7 无架构后缀的已发布版本为 amd64，保留历史名称。`user-runtime-v*` 是独立 SDK 发布，不是部署整包。

## 快速发布新整包

1. 在组件仓库先发布新 tag 和目标架构附件；复制一个相同架构的 [套件版本锁](../manifests/deployment)，改套件版本及相关组件的 `version` / `tag` / SHA256，保留未变组件。升级 Sudocode 需同时重发包含它的 Moss Runtime；升级 PostgreSQL 需重发 WebUI 包。
2. 本地预检后提交 PR；每个 PR 只更新一个版本锁，由原生 CI 构建完整包并完成安装、重复安装和会话恢复验收。

   ```bash
   ATLAS_VERSION="你的新套件版本-arm64"
   python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_VERSION.json" --validate
   python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_VERSION.json" --check
   ```

3. PR 合并后，在包含该锁的提交上发 tag：

   ```bash
   git tag -a "sudostack-v$ATLAS_VERSION" -m "Sudostack $ATLAS_VERSION"
   git push origin "sudostack-v$ATLAS_VERSION"
   ```

4. tag CI 自动生成该版 `README.md`、组件清单、GitHub Release 和 COS 固定完整包。将该次生成的 README 收录到 `releases/$ATLAS_VERSION/README.md`，更新上方索引；目标机完成首装、清空重装后，再复用相同归档推广对应架构的 latest。

完整命令、字段对应、失败续传和 artifact 过期处理见 [发版操作手册](../docs/deployment/releasing.md)。安装方式见 [DEPLOYMENT.md](../DEPLOYMENT.md)。已发布版本的锁、tag、制品不可覆盖；候选页不能当成正式下载入口。

## 架构与契约

[架构、产品装配与契约说明](../README.md) · [部署与运维](../DEPLOYMENT.md)

仓库首页导航位于 `.github/README.md`；根目录 `README.md` 同时属于固定 contracts 包，保持已验证的包内容。
