# ARM64 部署

发布、离线包和安装流程支持 `amd64` 与 `arm64`，架构由版本锁中的 `architecture` 固定。[rc.8 ARM64](https://github.com/sudoprivacy/sudostack/releases/tag/sudostack-v0.0.1-rc.8-arm64) 已发布 GitHub Release 和 COS 固定包；[rc.9 ARM64](../../releases/0.0.1-rc.9-arm64/README.md) 是修复安装器后的 COS 测试候选，实机记录见下文。ARM64 latest 尚未推广。已有 `sudostack-v0.0.1-rc.7` 仍为 amd64 包。

## 组件与来源

全部组件（含 Helm、Caddy、PostgreSQL、Node.js、kubectl）的版本、直接下载地址及逐文件 SHA256 见 [rc.8 ARM64 发布清单](../../releases/0.0.1-rc.8-arm64/README.md)。后续更换组件并发布新整包，按 [发版操作手册](releasing.md) 执行。

各仓库按 commit → PR → 合并 → tag Release 发布，套件只使用正式发布的附件及其 SHA256。开发分支的临时 CI 附件不进入最终版本锁。

| 组件 | 本次固定版本 | 源码 PR |
| --- | --- | --- |
| Moss | [`server-v0.1.60-rc.arm64.20261015.2`](https://github.com/sudoprivacy/moss/releases/tag/server-v0.1.60-rc.arm64.20261015.2) | [ARM64 #384](https://github.com/sudoprivacy/moss/pull/384)、[重启恢复 #385](https://github.com/sudoprivacy/moss/pull/385) |
| SudoWork WebUI | [`v0.2.32-rc.arm64.20261015`](https://github.com/sudoprivacy/sudowork/releases/tag/v0.2.32-rc.arm64.20261015) | [#1253](https://github.com/sudoprivacy/sudowork/pull/1253) |
| SudoRouter | [`sudorouter-v0.0.1-rc.2`](https://github.com/sudoprivacy/new-api/releases/tag/sudorouter-v0.0.1-rc.2) | [协议修复 #30](https://github.com/sudoprivacy/new-api/pull/30)、[ARM 打包 #29](https://github.com/sudoprivacy/new-api/pull/29) |
| Sudocode | [`v0.2.32`](https://github.com/sudoprivacy/sudocode/releases/tag/v0.2.32)、配套 [`nexusd-cohost-v0.2.32`](https://github.com/sudoprivacy/sudocode/releases/tag/nexusd-cohost-v0.2.32) | [#959](https://github.com/sudoprivacy/sudocode/pull/959) |
| Nexus / Vault | `v0.8.15` / `vault-v0.5.68`，plugin ABI 7 | 使用已有 ARM64 Release |
| k3s / gVisor | `v1.34.1+k3s1` / `release-20261005.0` | 使用已有 ARM64 Release |

Moss Server、Runtime、Nexus/Vault、Sudocode、WebUI/PostgreSQL、Router、Caddy、Helm、kubectl、k3s 和 gVisor 均须匹配同一架构。组装时检查每个镜像归档中的实际 OS、架构和镜像标签，并执行 Runtime 中的 `scode --version` 核对完整版本；带预发布或构建后缀的版本不能满足稳定版锁。

Sudocode 从 0.2.32 起补齐 Linux ARM64 bundle/deb，ARM64 二进制要求 glibc 2.35 或更新版本。Moss 的企微会话存档 SDK 依赖上游仅提供的 amd64 原生库，因此 ARM64 镜像不包含该能力。

## 主机要求

目标机需要 Linux ARM64、root、systemd 和 4 KB 页大小。安装器将 `aarch64` / `arm64` 统一识别为 `arm64`，将 `x86_64` / `amd64` 识别为 `amd64`，在修改系统前拒绝错误架构的包。

固定的 gVisor ARM64 制品要求 `getconf PAGE_SIZE` 为 `4096`。上游的 64 KB 页需要[独立的 `pagesize_64k` 构建标记](https://github.com/google/gvisor/blob/release-20261005.0/pkg/hostarch/hostarch_arm64.go)，本流程未发布或验收该变体。

该配置仅用于单节点 k3s。安装器会在创建安装目录、修改 k3s 配置或重启服务前拒绝正在运行的 k3s-agent、已有多节点集群，以及 API 无法读取的运行中 k3s server。已有集群须先完成备份和明确的切换安排。

## 从 COS 安装

固定版本安装入口：

```bash
curl -fsSL https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v0.0.1-rc.8-arm64/install-cos.sh -o install-cos.sh
sudo bash install-cos.sh --host "你的服务器IP或域名" --root /data/atlas --manage-k3s
```

安装器从 COS 下载包含全部依赖的 `sudostack-0.0.1-rc.8-arm64-linux-arm64.tar.gz`，校验整包和内部文件后执行本地安装。入口脚本、`bundle.json`、包内 `atlas-release.json` 的架构必须一致。

使用 `bash install-cos.sh --download-only` 可先下载并校验，不修改运行中的服务，也允许从另一种架构的机器上准备离线包。准备后可直接运行缓存中的 `assets/install-atlas.sh` 离线安装。

### 已有 k3s-agent 的机器

如果出现 `An existing k3s-agent is running`，说明整包已通过下载校验，但主机仍是旧集群的 worker，安装尚未进入新集群部署。rc.8 的 `cleanup-atlas.sh` 面向 Atlas 单节点 server，寻找的是 `k3s-uninstall.sh`；agent 的标准卸载脚本是 **`k3s-agent-uninstall.sh`**，不能通过改名卸载脚本或删除安装器检查来绕过。

在确认旧节点上的工作负载已经迁移、数据已备份且允许退出旧集群后，在该 agent 机器执行：

```bash
sudo sh /usr/local/bin/k3s-agent-uninstall.sh
systemctl is-active k3s-agent  # 预期 inactive 或 unknown，退出码非零属正常
test ! -e /usr/local/bin/k3s && echo "本机 k3s 已卸载"
```

该脚本删除本机 k3s 容器、镜像和本地数据，保留 `/var/cache/sudostack` 下载缓存；它不会卸载远端控制节点。旧集群的 Node 对象需由控制节点管理员按退群安排处理。本机若仍有旧 Moss / WebUI 占用新套件端口，还须完成对应服务切换，再重跑固定版本 `install-cos.sh`。缓存校验成功后会复用原包，不必重新下载。

166 的旧集群数据保留方案已另行准备；如需保留 `/var/lib/rancher/k3s` 原始数据，应按既定切换流程先停止工作负载并备份，不能直接依赖通用卸载脚本保留它。只有要清空新 Atlas 安装和下载缓存时，才运行 Atlas 的完整清理脚本。

重复安装同一版本只验证已有部署。安装目录中的 `verify.sh` 检查服务，`restart.sh` 重启组件，`admin-credentials.txt` 保存管理员入口和凭据。备份、恢复及单节点清理边界见 [COS 部署说明](cos.md)。

### 端口冲突、TLS 检查与重试

若 Pod 已 Ready，但安装末尾出现 `CERTIFICATE_VERIFY_FAILED`，先核对入口实际由谁提供。166 曾由旧 Docker 容器 `sudowork-webui-nginx` 占用 80/443，导致本机请求拿到旧自签名证书。使用 `sudo ss -ltnp`、`docker ps` 检查；按切换安排停止对应旧入口后，重跑相同安装命令即可继续验证，无需删除已安装数据或关闭 TLS 校验。

新版候选安装器在首次部署前检查 80、443、8443，以及启用 Router 时的 9443，兼容 IPv4-only 主机。已停止但尚未卸载的 k3s-agent 也会被识别。验证请求直接连接部署入口，不使用 shell 的 HTTP(S) 代理；仍要求入口证书由本次 CA 签发且主机名匹配。DNS 指向错误或自带证书不匹配时，错误中给出失败 URL 和 CA 路径。

安装及同版本验证成功后，新版安装器输出组件入口、实际管理员用户名、密码文件位置、内部组件凭据位置及 CA 路径，保存为安装目录下的 `access-info.txt` / `access-info.json`（600）。密码值只保存在原凭据文件，不进入终端摘要。当前 rc.8 的已发布文件保持不变；这些改进在新候选 `0.0.1-rc.9-arm64` 验收，不能视为 rc.8 已包含。

## CI、验收与入口发布

一个套件 tag 对应一种架构。首次 ARM64 版本锁必须设置 `architecture: "arm64"`、固定组件版本和 ARM64 Sudocode SHA256，并省略 amd64 的 `baseRelease`。

```bash
ATLAS_VERSION="你的套件版本-arm64"
python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_VERSION.json" --validate
python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_VERSION.json" --check
```

`deployment-release.yml` 根据 PR 新增或修改的版本锁选择原生 runner；ARM64 使用 `ubuntu-24.04-arm`。CI 组装完整包后，在干净 runner 上执行安装、保持 Pod UID 的重复安装、重启和经 SudoRouter 的 gVisor 会话恢复。tag 流水线通过后发布 GitHub Release 和不可变 COS 版本目录，默认 `release-only`。

目标机再验证该固定版本的 COS 首装，保存证据，清理本次新集群、安装数据、缓存、Helm 和 gVisor，然后重新从 COS 下载并安装。旧服务备份、模型文件和无关应用应按确认的范围保留。清理脚本会删除整个新 k3s 集群，不能直接用于仍承载其他业务的旧集群。

实机通过后，从同一次成功 CI 复用完整包，发布对应架构的 latest：

```bash
ATLAS_VERSION="实际已验收版本"
ATLAS_RELEASE_RUN="实际成功的tag-run-id"
gh workflow run deployment-release.yml -R sudoprivacy/sudostack \
  --ref "sudostack-v$ATLAS_VERSION" -f version="$ATLAS_VERSION" \
  -f publish_run="$ATLAS_RELEASE_RUN" -f cos_mode=latest-only
```

复用检查验证来源仓库、workflow、tag、成功的 `qualify` 作业、完整组件锁和 SHA256SUMS。ARM64 入口为 `latest/arm64/install-cos.sh`，amd64 入口为 `latest/amd64/install-cos.sh`；旧 `latest/install-cos.sh` 继续跟随 amd64。ARM64 发布不覆盖 amd64 入口。

## 166 验证记录

目标机 `172.16.20.166`（spark-01）为 Ubuntu 24.04.4、aarch64、4 KB 页，内核 `6.17.0-1029-nvidia`。已完成以下组件预检：

- gVisor ARM64 原生 systrap 沙箱运行 `/bin/sh` 和 `uname`。
- SudoRouter 正式 rc.2 包校验、ARM64 启动及 HTTP 版本 `0.0.1-rc.2` 验证。
- Sudocode 正式 `v0.2.32` ARM64 bundle/deb 从 COS 下载，校验摘要、隔离安装、执行、卸载及真实 deb 解包执行全部通过。
- SudoWork 正式 RC 的 COS 双架构归档与 GitHub Release 摘要一致；166 上 ARM64 原生 PTY、PostgreSQL 初始化/迁移、HTTP 健康检查和页面资源通过。隔离测试资源已清理，旧服务保持运行。
- Sudostack 的 76 项部署回归测试在 166 的 root 环境全部通过，覆盖 Runtime 版本匹配、root 入口、端口和 TLS 检查、发布清单生成。

[最终 tag CI 38718729124](https://github.com/sudoprivacy/sudostack/actions/runs/38718729124) 已通过原生 ARM64 整包组装、干净安装、保持 Pod UID 的重复安装、同会话重启恢复及诊断采集，并将同一归档发布到 COS。完整归档 SHA256 为 `52599a8cfce055fbc4e0e9dfca026c2019d6a95f2df38d372dfe730ec10d07fc`。

2026-10-16，166 下载 rc.8 并通过包内文件校验；先遇到旧 `k3s-agent`，随后旧 Docker WebUI 入口占用 80/443 导致证书不匹配。用户完成 agent 卸载和旧入口停止；后续新安装器在 rc.9 ARM64 中验收。

rc.9 使用 [原生 CI 38835398155](https://github.com/sudoprivacy/sudostack/actions/runs/38835398155) 的同一归档，经 [COS 上传运行](https://github.com/sudoprivacy/sudostack/actions/runs/38836691293) 原样发布。166 已完成两轮从空缓存下载、完整校验、离线安装、重复安装、重启与同会话恢复；每轮结束均完成清理。端口冲突和停止状态的 agent 残留均在部署前被正确拒绝，不可用的 shell 代理也未影响本机 TLS 验收。

最终新集群、`/data/atlas`、`/var/cache/sudostack`、Helm 和 gVisor 已移除，80/443/8443/9443 端口可用。`/data/models` 的文件元数据、既有备份、`openai-web`、`sudowork-webui`、`sudowork-webui-postgres` 保留，`openai-web` 的 3000 端口仍返回 HTTP 200。新组件的凭据和访问摘要随测试环境删除，脱敏证据保存在 `/var/tmp/sudostack-rc9-acceptance-20261016`。

详见 [rc.9 组件清单、下载与实测结果](../../releases/0.0.1-rc.9-arm64/README.md) 和 [验收记录 JSON](../../releases/0.0.1-rc.9-arm64/acceptance-166.json)。rc.9 为固定 COS 测试候选，GitHub tag Release 尚未创建；ARM64 latest 尚未推广。
