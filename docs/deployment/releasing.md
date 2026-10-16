# 修改组件版本并发布新的 Sudostack 整包

一个套件版本锁对应一种架构、一组组件版本、一份通过安装验收的完整归档。当前 ARM64 固定版的文件、组件版本、直接下载地址及 SHA256 见 [rc.8 ARM64 发布清单](../../releases/0.0.1-rc.8-arm64/README.md)。**166 实机首装和清空重装尚未完成，ARM64 latest 尚未推广。**

## 发布清单保存在哪里

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `manifests/deployment/<版本>.json` | 人工维护的输入：套件版本、架构、组件版本、tag、部分校验和 | Sudostack Git |
| `components.lock.json` | 发布时冻结的版本锁，与上面文件内容相同 | GitHub Release / COS |
| `atlas-release.json` | 实际镜像标签、registry digest、组件来源、包内文件 SHA256、Chart / 安装器版本 | GitHub Release / COS / 完整包 |
| `bundle.json` | 完整包文件名、大小、SHA256，以及 COS 交付文件摘要 | COS |
| `SHA256SUMS` | 同一下载目录中各文件的 SHA256 | GitHub 与 COS 分别生成，校验范围不同 |
| `README.md` | 由实际 manifest 和 bundle 自动生成的组件表、下载入口、逐文件清单 | 新版发布 CI 的 GitHub 附件与 Release 正文 |

rc.8 已发布制品保持原有字节；本次为其补充发布说明和仓库清单。后续包含本次流水线改动的 tag 会自动生成 `README.md`。它作为 GitHub 交付说明，不加入运行时完整包，也不改变 COS descriptor 格式。

## 1. 先在组件仓库发布新版本

修改哪个组件，先在它自己的仓库完成代码、PR、合并和固定 tag 的 Release。必须有目标架构附件及 GitHub SHA256；只推源码、修改分支或生成临时 Actions artifact 不足以供整包发布。

| 更新项 | 需要修改的套件锁字段 | 配套要求 |
| --- | --- | --- |
| Moss | `moss.version`、`moss.tag=server-v<版本>` | 同版 Server、Runtime、deploy 三个架构包，以及 `bootstrap-nexus.mjs`、`install.sh`、`SHA256SUMS` |
| SudoWork WebUI | `webui.version`、`webui.tag=v<版本>` | Linux WebUI 镜像归档，不是桌面安装包；归档还须含锁定的 PostgreSQL 镜像 |
| SudoRouter | `router.version`、`router.tag=sudorouter-v<版本>` | 发布 `sudorouter-<版本>-linux-<架构>.tar.gz`；同步实际 `sourceBranch`、`sourceCommit`、`baseCommit` 来源记录 |
| Sudocode | `sudocode.version`、`sudocode.tag=v<版本>`、`sudocode.sha256` | 还要更新 Moss 的 `src/server/nexus/runtime-versions.json` 并发布新 Moss Runtime；运行时的 `scode --version` 必须与套件锁完整一致 |
| Nexus | `nexus.version`、`nexus.tag=v<版本>`、`pluginABI` | 与 Vault / Moss 协议及插件 ABI 配套；由 Sudostack 组装进 Nexus 镜像 |
| Vault | `vault.version`、`vault.tag=vault-v<版本>` | 验证与 Nexus 的插件兼容性；Moss Runtime 自己也固定 Vault，需要同步检查并按需重发 Moss |
| k3s | `k3s.version`，保留 `v` 与 `+k3s1` 等完整后缀 | 同架构二进制、airgap 镜像和校验文件；kubectl 版本由 `+` 前的 Kubernetes 版本派生 |
| gVisor | `gvisor.version=release-<版本>` | 完整归档含 runsc、shim 和辅助工具；ARM64 固定制品要求 4 KB 页 |
| Helm | `helm.version=v<版本>` | `get.helm.sh` 的目标架构归档和 `.sha256sum` |
| Caddy | `caddy.version`、`caddy.image` | 显式版本标签，例如 `docker.io/library/caddy:2.10.2-alpine`，两字段版本一致 |
| PostgreSQL | `postgres.version`、`postgres.image` | 同时重新发布内含该镜像的 WebUI 包；单改数据库标签不会生成新 WebUI 归档；跨大版本须另做数据迁移设计 |
| Nexus 基础镜像 | `nexusBase.version`、`nexusBase.image` | 显式 Node.js 版本及发行版后缀；在目标架构上重新组装 Nexus 镜像 |

Sudocode 当前下载约定：amd64 为 `scode-linux-x64-bundle.tar.gz`；arm64 为 `scode-linux-arm64.tar.gz`。ARM64 bundle/deb 虽也存在，套件校验字段锁定的是上述独立包。Moss Runtime 还含 nexusd-cohost，其版本和摘要由 Moss 的 `runtime-versions.json` 固定，不能从套件 Nexus cluster 版本推算。

例如读取新 ARM64 Sudocode 附件的摘要（先把变量改成真实已发布版本）：

```bash
SCODE_TAG="v实际版本"
gh release view "$SCODE_TAG" -R sudoprivacy/sudocode --json assets \
  --jq '.assets[] | select(.name == "scode-linux-arm64.tar.gz") | .digest'
```

输出必须为 `sha256:<64位十六进制>`，填入锁文件时去掉 `sha256:` 前缀。`release.py --check` 会再次与 GitHub 摘要核对；镜像和 Runtime 的实际检查发生在组装阶段。

## 2. 新增套件版本锁

在干净的 Sudostack 工作分支执行。`0.0.1-rc.9-arm64` 已用于本次安装器修复候选，尚未发布；下面用 `0.0.1-rc.10-arm64` 演示下一次发版，**本说明不表示该版本已经发布**。先确认版本/tag 尚未占用。一个 PR 只新增或修改一个套件锁；amd64 与 arm64 分别使用不同版本/tag。

```bash
git switch -c release/sudostack-0.0.1-rc.10-arm64
ATLAS_NEXT_VERSION="0.0.1-rc.10-arm64"
python3 - "$ATLAS_NEXT_VERSION" <<'PY'
import json, sys
from pathlib import Path
version = sys.argv[1]
source = Path('manifests/deployment/0.0.1-rc.8-arm64.json')
target = source.with_name(version + '.json')
lock = json.loads(source.read_text())
lock['version'] = version
lock['architecture'] = 'arm64'
lock.pop('baseRelease', None)
with target.open('x') as output:
    output.write(json.dumps(lock, indent=2) + '\n')
print(target)
PY
```

编辑新文件，按上一节同步目标组件的 `version`、`tag` 和相关字段，保留其余组件锁。比如换 Moss 时，`version` 填无 `server-v` 前缀的版本，`tag` 填 `server-v` 加同一版本。安装器或 Chart 有变更，即使组件版本不变，也应发布新的套件版本；Chart 与安装器版本由流水线自动设为套件版本。

`baseRelease` 目前仅用于保持旧组件完全一致时增补 Router，不是通用的增量升级机制。升级任意组件应省略它；不要改写 rc.8 锁、移动旧 tag 或覆盖旧附件。

## 3. 预检、PR 与原生安装验收

开发机需 Python 3.9+、`gh` 登录和上游 Release 访问权限。以下预检不需要 Docker；真实构建由 CI 的原生 runner 完成。

```bash
python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_NEXT_VERSION.json" --validate
python3 tools/deploy/release.py --lock "manifests/deployment/$ATLAS_NEXT_VERSION.json" --check
python3 -m unittest discover -s tools/deploy -p 'test_*.py'
git diff --check
git add "manifests/deployment/$ATLAS_NEXT_VERSION.json"
git commit -m "chore(deploy): prepare $ATLAS_NEXT_VERSION"
git push -u origin HEAD
gh pr create --fill
```

部署 PR CI 自动选择唯一变更的锁；没有变更锁时回退 `0.0.1`。ARM64 使用 `ubuntu-24.04-arm`，amd64 使用相应原生 runner。`--check` 仅检查主要上游 Release 附件和摘要，不能替代 Helm 下载、Docker 拉取、镜像架构、内嵌 Sudocode 版本及全栈安装验证。

`assemble` 从固定来源构建完整包；`qualify` 对同一包执行干净安装、经 Router 的 gVisor 会话、重复安装且 Pod UID 不变、同会话重启恢复。报告在 `sudostack-installation-evidence` artifact。修复失败项并等 PR 验收通过后合并。

## 4. 推送新 tag，发布 GitHub 与 COS 固定版

PR 合并后，从包含新锁和部署改动的主分支提交创建 tag：

```bash
git switch main
git pull --ff-only
ATLAS_NEXT_VERSION="0.0.1-rc.10-arm64"
test -f "manifests/deployment/$ATLAS_NEXT_VERSION.json"
git tag -a "sudostack-v$ATLAS_NEXT_VERSION" -m "Sudostack $ATLAS_NEXT_VERSION"
git push origin "sudostack-v$ATLAS_NEXT_VERSION"
gh run list -R sudoprivacy/sudostack --workflow deployment-release.yml \
  --branch "sudostack-v$ATLAS_NEXT_VERSION" --event push
```

记录这次 **tag run ID**。tag 会重新组装和验收，其产物才是本次最终交付；不要把 PR run 的包误认为最终包。可用 `gh run watch <tag-run-id> -R sudoprivacy/sudostack --exit-status` 等待结果。

流水线发布 GitHub prerelease（包括自动生成的发布清单），随后将相同完整包上传到：

```text
https://sudowork-release-1309794936.cos.accelerate.myqcloud.com/sudostack/releases/sudostack-v<版本>/
  sudostack-<版本>-linux-<架构>.tar.gz
  sudostack-<版本>-linux-<架构>.tar.gz.sha256
  install-cos.sh / cleanup-atlas.sh / cos_bundle.py
  components.lock.json / atlas-release.json / bundle.json / SHA256SUMS
```

tag 默认 `cos_mode=release-only`，成功发布固定目录也不会自动更新 latest。公开下载无需凭据；COS 写入由仓库 Actions secrets `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` 提供。

如果 GitHub 已成功而 COS 上传失败，修复发布环境后从**原 tag、原成功的 assemble/qualify 作业**重跑失败作业，复用现有 artifact；不要重新压缩或重建已发布版本。脚本允许相同对象继续上传，遇到同名但摘要/大小不同的不可变对象会拒绝覆盖。`publish_run` 快捷复用要求来源整次 run 为 success，不能拿失败的 run 绕过此检查。

## 5. 实机首装、清空重装，再推广 latest

使用固定版本的 COS 入口，在确认范围的目标机验证首装、实际登录与会话、重启恢复、清理以及重新从 COS 下载后的安装。保存套件版本、`bundle.json`、整包摘要、安装/清理日志、`deployment-report.json` 和验收结果；报告不得包含密码、私钥、API Key。

清理会删除整个 k3s 集群、安装数据、默认缓存和配套工具，须符合目标机已授权范围。`--dry-run` 只能预览。166 的既有备份和旧服务切换安排见 [ARM64 部署记录](arm64.md#166-验证记录)。本次文档与发布说明更新不执行目标机清理或切换。

当前不支持通用跨版本原地升级。发布新整包不等于可以覆盖旧安装；有业务数据的实例需另外制定备份、迁移和恢复步骤，清空重装验收针对专用测试环境。

全部实机验收通过后，复用**相同 tag 的成功 run**推广入口：

```bash
ATLAS_RELEASE_VERSION="实际已验收版本"
ATLAS_RELEASE_RUN="实际成功的tag-run-id"
gh workflow run deployment-release.yml -R sudoprivacy/sudostack \
  --ref "sudostack-v$ATLAS_RELEASE_VERSION" -f version="$ATLAS_RELEASE_VERSION" \
  -f publish_run="$ATLAS_RELEASE_RUN" -f cos_mode=latest-only
```

该路径跳过重新构建，检查来源仓库、workflow、tag、成功的 qualify、版本锁和归档摘要，再更新 `latest/<架构>/install-cos.sh` 与 `cleanup-atlas.sh`。旧的 `latest/install-cos.sh` 只跟随 amd64。完成后核对入口内的 `ATLAS_RELEASE_TAG`、`ATLAS_RELEASE_ARCH`，并补写 Release 的实机结果和推广时间。

### 原 CI artifact 过期时

完整 candidate 当前保留 7 天；rc.8 的 `sudostack-installation-candidate` 到期时间为 **2026-10-22 10:20:47 UTC（北京时间 18:20:47）**。COS 固定目录长期保留，但过期后 `publish_run` 不能再下载原 Actions artifact。

应及时保存原 candidate 及验收证据。若 artifact 已过期，使用原 tag 对应的发布工具，从该版本 COS 下载 `bundle.json`、其中列出的全部 7 个文件和 `SHA256SUMS`，恢复原交付目录；核对之前保存的整包 SHA256 和 manifest SHA256，运行 `sha256sum -c SHA256SUMS` 及 `cos_bundle.py unpack` 做完整内容校验。**不得重新构建或压缩来代替原包。**

实机通过且已有 COS 发布凭据的维护者，可对恢复并校验的目录运行：

```bash
python3 tools/deploy/publish_cos.py --directory /path/to/original-cos-release --mode latest-only
```

这个本地命令检查本地文件和远端不可变对象，但不替你检查 CI / 实机验收记录，因此必须先完成上述证据核对。凭据用既有 `coscmd` 配置，不写入仓库。

## 本地复现发布清单

无需下载 3 GB 整包即可用已核实的 manifest 和 descriptor 重建人类可读清单；生成器核对 manifest 摘要、版本、架构及组件一致性，不替代整包验收。

```bash
python3 tools/deploy/release_notes.py \
  --manifest /path/to/atlas-release.json --bundle /path/to/bundle.json \
  --output /tmp/README.md
```

构建流程会将此文件加入 GitHub 交付目录的 `SHA256SUMS`，并用 `gh release create --notes-file README.md` 发布。完整包、分项来源及 SHA256 均取自本次构建记录，避免手写版本表与实际交付不一致。
