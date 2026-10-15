# ARM64 部署

仓库的发布、离线包和安装流程接受 `amd64` 或 `arm64`，架构由版本锁中的 `architecture` 固定。**截至 2026-10-15，完整 ARM64 安装包尚未发布**；现有 `sudostack-v0.0.1-rc.7` 仍只包含 amd64 制品。

## 上游制品状态

按 rc.7 锁定版本查询各仓库的 GitHub Release，结果如下。此表描述附件是否存在，不代表整套应用已通过 ARM64 安装验收。

| 组件及固定 Release | ARM64 制品状态 |
| --- | --- |
| [Moss server-v0.1.53-atlas.1](https://github.com/sudoprivacy/moss/releases/tag/server-v0.1.53-atlas.1) | 缺少 `moss-server-image`、`moss-runtime`、`moss-deploy` 的 `linux-arm64.tar.gz` |
| [SudoWork v0.2.28](https://github.com/sudoprivacy/sudowork/releases/tag/v0.2.28) | 缺少 `sudowork-webui-0.2.28-linux-arm64.tar.gz`；macOS arm64 客户端不是 Linux WebUI 镜像 |
| [SudoRouter v0.0.1-rc.1](https://github.com/sudoprivacy/new-api/releases/tag/sudorouter-v0.0.1-rc.1) | 缺少 `sudorouter-0.0.1-rc.1-linux-arm64.tar.gz` |
| [Sudocode v0.2.23](https://github.com/sudoprivacy/sudocode/releases/tag/v0.2.23) | 已有 `scode-linux-arm64.tar.gz`，Moss 和套件均使用此已发布附件 |
| [Nexus v0.8.4](https://github.com/nexi-lab/nexus-vfs/releases/tag/v0.8.4) | 已有 `nexusd-cluster-linux-aarch64.tar.gz` |
| [Vault v0.5.68](https://github.com/nexi-lab/nexus/releases/tag/vault-v0.5.68) | 已有 `nexus-vault-linux-aarch64.tar.gz` |
| [k3s v1.34.1+k3s1](https://github.com/k3s-io/k3s/releases/tag/v1.34.1%2Bk3s1) | 已有 `k3s-arm64`、ARM64 airgap 镜像及校验文件 |
| [gVisor release-20261005.0](https://github.com/google/gvisor/releases/tag/release-20261005.0) | 已有 `gvisor-aarch64.tar.bz2` |

`release.py --check` 会在下载镜像前报告所有缺失附件，仍要求每项制品有 GitHub SHA256。Sudocode 的 `sha256` 必须锁定 ARM64 附件自身的校验值（v0.2.23 为 `beef0bc0421ceb88590a4bad61587e771181d759236084d5bbb5cd3b5166874f`）。Moss Runtime 需要包含这个版本的 ARM64 Sudocode 及原生依赖；组装时同时检查镜像架构和容器内的 `scode --version`。

## 源码适配

Moss、SudoWork WebUI 和 SudoRouter 的发布流程已增加原生 amd64/arm64 构建、镜像架构检查和运行检查；安装器与离线下载器按主机架构选择产物。Moss 的 Server、Nexus、Runtime 使用一致架构，Nexus/Vault 以及 Sudocode 都固定真实 ARM64 附件和校验值。Sudocode 发布流程另增 ARM64 bundle/deb，现有 v0.2.23 的独立二进制包已足够用于套件构建。

组件按 commit → PR → 合并 → tag Release 流程发布。完整 ARM64 套件只锁定已发布的组件版本和校验和；开发分支的临时 CI 附件不作为最终安装来源。现有 tag 及下载入口不会自动增加 ARM64 产物。

Moss 的企微会话存档 SDK 依赖上游仅提供的 amd64 原生库，ARM64 镜像不包含该库；此能力暂不属于 ARM64 支持范围。

## 发布方式

当前格式为一个版本 tag 对应一种架构。新增 ARM64 版本应使用新的版本锁和 tag，不能覆盖已发布的 amd64 版本，也不能直接把 amd64 `baseRelease` 改标为 arm64。首次 ARM64 组装应省略 `baseRelease`，从对应架构的组件 Release 构建完整包。

上游仓库发布上述 ARM64 附件后，提交固定版本锁，设置 `architecture: "arm64"`，更新组件版本及 Sudocode 校验和。然后执行：

```bash
python3 tools/deploy/release.py --lock manifests/deployment/<ARM64版本>.json --validate
python3 tools/deploy/release.py --lock manifests/deployment/<ARM64版本>.json --check
```

`<ARM64版本>` 需替换为实际提交的版本。原生构建、完整安装验收及 COS 发布由 `deployment-release.yml` 完成：ARM64 使用 `ubuntu-24.04-arm`，amd64 保持原有 runner。Helm、kubectl、k3s、gVisor、Nexus/Vault 和 Docker 构建平台均按版本锁选择架构；WebUI 离线包中的 PostgreSQL 也必须是 ARM64。

COS 包名为 `sudostack-<版本>-linux-arm64.tar.gz`。入口脚本、`bundle.json` 和包内 `atlas-release.json` 必须声明相同架构，安装时还会核对目标机架构。`--download-only` 允许在其他架构的机器上准备离线包；执行安装时仍须匹配架构。

版本目录沿用 `releases/sudostack-v<版本>/`。发布验证成功后更新 `latest/arm64/install-cos.sh` 和同目录清理入口；amd64 使用 `latest/amd64/`，并继续维护旧的 `latest/install-cos.sh` 地址。ARM64 发布不会覆盖旧的 amd64 入口。ARM64 首次正式发布前，相应 `latest/arm64/` 地址不可用。

## 目标机要求

目标机需要 Linux ARM64、root 和完整的 ARM64 发布包。安装器把 `aarch64` / `arm64` 统一识别为 `arm64`，把 `x86_64` / `amd64` 识别为 `amd64`；选错包会在安装前退出。

当前固定 gVisor 使用默认 4 KB 页大小构建，因此 ARM64 主机的 `getconf PAGE_SIZE` 必须为 `4096`。上游对 64 KB 页使用[独立的 `pagesize_64k` 构建标记](https://github.com/google/gvisor/blob/release-20261005.0/pkg/hostarch/hostarch_arm64.go)，本流程尚未发布或验收该变体。Ubuntu 24.04、4 KB 页的 ARM64 主机可作为原生验收目标。

安装配置仍限于单节点 k3s。若目标机已加入双节点或更大的集群，安装器会在创建安装目录、修改 k3s 配置或重启服务之前退出。正在运行的 k3s-agent 会被直接拒绝；已有 k3s server 的 API 不可访问时也会停止安装，不将其当成空环境。已有模型服务与 Traefik 的集群需要单独设计集群部署方案；不能直接套用会关闭 Traefik 的 `--manage-k3s` 单节点流程。

## 本地验证记录（2026-10-15）

| 仓库 | 验证结果 |
| --- | --- |
| Sudostack | `python3 -m unittest discover -s tools/deploy -p 'test_*.py'`：57 通过，4 项 root 入口测试跳过；CI 使用 sudo 执行完整测试 |
| Moss | `deploy/k3s/test_control.py` 与 `deploy/test_fetch_scode.py`：7 通过；scode 路径及发布回归测试：19 通过 |
| SudoWork | `apps/webui/tests/unit/deployScript.test.ts`：15 通过（含 ARM64 安装、双架构校验清单及错误架构拒绝）；单文件 ESLint/Prettier 与 WebUI `bun run typecheck` 通过 |
| Sudocode | bundle 安装/卸载与 deb 打包脚本测试对 amd64、arm64 均通过；本地 deb 测试使用打包工具替身，原生 CI 额外检查真实 deb 架构 |
| SudoRouter | 打包及错误架构拒绝测试：2 通过（Docker 替身）；真实容器 HTTP 检查由原生 CI 执行 |

全部修改过的 shell 脚本通过 `bash -n`，发布 workflow 通过 actionlint（补充识别已有的新 runner 名称）。

另行执行 Moss `contractsActivation.test.ts` 时，其既有 Candidate2 包指纹检查失败（期望 SHA1 `5774dcb…`，本地 npm pack 为 `f7f1f239…`），未修改该依赖或期望值。SudoWork 根目录没有 tsconfig，裸 `bunx tsc --noEmit` 向上使用工作区父目录配置，发生内存耗尽；实际 WebUI 两份 tsconfig 的检查通过。

目标验收机现为 `172.16.20.166`（spark-01）：Ubuntu 24.04.4、aarch64、4 KB 页，内核 `6.17.0-1029-nvidia`。组件分支的原生 CI 已开始验证，但最终仍需各仓库 PR 合并后的 Release 和整套安装验收。166 当前有旧 Moss、Docker WebUI 和运行 DeepSeek worker 的 k3s-agent；备份已准备，切换旧服务需明确授权。不得直接对已有集群执行本项目的测试清理脚本。

## COS 验收与发布入口

新 tag 的流水线在干净 runner 上安装、重复安装、重启和会话验收成功后，发布版本目录，默认使用 `release-only`，保留现有 latest 入口。目标主机完成该固定版本的 COS 安装与清空后重装验证，再从同一次成功 CI 复用完整包发布对应架构的 latest：

```bash
gh workflow run deployment-release.yml -R sudoprivacy/sudostack \
  --ref <原构建的分支或tag> -f version=<版本> \
  -f publish_run=<完整安装验收通过的run-id> -f cos_mode=latest-only
```

复用检查要求来源 run 成功且确有成功的 `qualify` 作业，仓库、workflow、分支/tag、套件版本和架构均匹配；不会重新生成或替换已发布的离线包。
