# hosted bootstrap：通过对话部署 Mosswork（托管 SudoRouter）

MVP（部署 profile 名为 `hosted-linux`）。用户运行一个向导，登录 SudoCloud，然后和 SudoCode 部署助手对话，把 Mosswork Server 安装到一台 Linux amd64 主机（本机或 SSH 远程机）上。模型直连官方托管的 SudoRouter（地址只在 `bootstrap.lock.json` 的 `router.baseUrl` 中定义），最后完成验收。

设计依据见 `mosswork-opc-product-alignment.md`：4.2 节「SudoCode 的使用范围约束」、阶段 2「登录 SudoCloud」、第十节「MVP」。

## 使用

```sh
./start.sh                 # 半自动：改动系统的动作逐条确认
./start.sh --auto --answers answers.json   # 全自动：只确认一次部署方案
```

macOS 上可以直接双击 `Start.command`。控制端需要 macOS 或 Linux，加上 `python3`（3.8+）和 OpenSSH 客户端。

向导依次执行：

1. 下载 scode，并按 `bootstrap.lock.json` 中锁定的版本和 SHA256 校验（先试国内镜像，再试 GitHub）
2. 登录 SudoCloud（`agent.sudoprivacy.com`）：用手机号和验证码登录，或者用邀请码注册，然后从登录响应和 `local-runtime` 取得 SudoRouter Key；也可以手动粘贴 Key
3. 用 `GET /models` 和一次真实的 `chat/completions` 调用验证 Key，选择模型
4. 写入隔离的 scode 配置（`SCODE_GLOBAL_CONFIG_DIR`），不影响用户已有的 scode 配置
5. 以固定参数启动部署助手：
   - `--system-prompt` 和 `--append-system-prompt`，内容取自 `agent/`
   - `--allowedTools bash,read_file,TodoWrite`
   - PreToolUse guard

再次运行时会复用已保存的凭证，部署助手会根据 `actions/ops status` 和回执，从未完成的步骤继续。

| 参数 | 作用 |
|---|---|
| `--relogin` | 重新登录 |
| `--manual-key` | 跳过 SudoCloud，手动粘贴 Key |
| `SUDOROUTER_API_KEY=...` | 非交互地提供 Key |
| `--router-url` | 改用其他 SudoRouter（例如私有实例或测试桩） |
| `--cloud` | 改用其他 SudoCloud |
| `--scode PATH` | 使用本地的 scode 可执行文件（开发用） |
| `--skip-launch` | 只完成配置，不启动对话 |

## 范围约束（客户端两层）

- **提示词：** `agent/system-prompt.md` 替换掉 scode 默认的编程助手身份；`agent/scope-rules.md` 规定服务范围和统一的拒答话术；`agent/AGENTS.md` 是部署 runbook。
- **工具：** 模型只能看到 `bash`、`read_file` 和 `TodoWrite` 三个工具。`hooks/guard.py` 规定：
  - bash 只放行不含任何 shell 语法的 `actions/ops <动作>`；
  - read_file 只能读工作区内的文件，并排除凭证；
  - 其他工具一律拒绝。
- **只读动作免确认：** `status`、`inspect`、`job-status`、`healthcheck`、`receipts` 通过 `permissions.allow` 前缀规则免确认。这些规则之所以安全，是因为 guard 会先拒绝任何 shell 语法。
- **秘密不进对话：**
  - Router Key 和 Mosswork 管理员密码只由脚本读写，不会出现在对话中；
  - 指纹确认和 `ssh-copy-id` 由用户在另一个终端完成。

服务端约束（部署专用 Token、`bootstrap` 渠道强制注入提示词）不在本目录内，见设计文档 4.2 节。

## 动作

`actions/ops <动作>`（实现在 `lib/ops.py`）：

| 动作 | 作用 |
|---|---|
| `status` | 当前目标、模型、Mosswork 状态和最近的操作 |
| `authorize` | `--local`，或 `--host/--user/--port`（第一次调用返回指纹）加 `--fingerprint`（确认后写入 known_hosts、安装部署公钥） |
| `inspect` | 检查系统、架构、sudo、Docker 安装和服务状态、内存、磁盘、端口、SudoRouter 和 GitHub 的连通性 |
| `docker-install [--mirror aliyun]` | 用 get.docker.com 在后台安装 |
| `mosswork-install [--port] [--bind] [--upgrade]` | 下载锁定版本的 `install-moss-server.sh`，校验 SHA256 后在后台执行 |
| `job-status <任务> --wait 90` | 后台任务的状态和日志尾部 |
| `mosswork-configure [--model] [--all-models]` | 通过 SSH 隧道调用 Mosswork 管理 API：创建或更新 `sudorouter` 模型服务（`kind=openai`），设置默认模型 |
| `healthcheck` | 验证管理员登录，调用 `/api/admin/providers/{id}/test` 做一次真实模型调用，并给出访问地址 |
| `receipts` | 列出操作回执 |

运行时数据放在 `~/.local/share/sudoprivate/hosted-linux/`（可用 `SUDOPRIVATE_STATE` 覆盖）：

| 目录 | 内容 |
|---|---|
| `bin/` | scode |
| `scode-home/` | 隔离的 scode 配置 |
| `runtime/` | 本目录（向导、动作、guard、提示词、锁文件）的副本 |
| `workspace/` | 部署助手的工作区 |
| `operations/` | JSON 回执 |
| `secrets/` | 凭证，0700 |
| `ssh/` | 部署密钥和 known_hosts |

## 端到端测试

`e2e/e2e.sh` 用一次性的 Linux 容器作为部署目标：带 SSH 和免密 sudo，没有预装 Docker，内部运行独立的 Docker。宿主机上的所有数据都写在 sudostack 根目录的 `.e2e-work/`（已加入 gitignore）。

```sh
printf "%s" "<SudoRouter Key>" > ../../../.e2e-work/sudorouter.key   # 即 sudostack 根目录的 .e2e-work/
e2e/e2e.sh up                      # 目标机：ops@127.0.0.1:2222，Mosswork 映射到 127.0.0.1:8088
e2e/e2e.sh wizard --model gpt-5.4  # 真实向导（--auto --skip-launch）
e2e/e2e.sh say "开始部署"          # 以用户身份发一轮对话（之后自动接续会话）
e2e/e2e.sh fingerprint             # 核对助手展示的指纹
e2e/e2e.sh copy-id                 # 模拟用户在另一个终端执行 ssh-copy-id
e2e/e2e.sh say "确认执行"
e2e/e2e.sh chat "你好"              # 以用户身份登录部署好的 Mosswork 并对话（需要 uv）
e2e/e2e.sh reset; e2e/e2e.sh down  # 清理
```

## 已知限制（MVP）

- 只支持 Linux amd64 目标，因为 Mosswork Server 目前只有 amd64 镜像。
- 目标机需要 root 或免密 sudo。
- Mosswork 使用 Bootstrap 用户本人的 SudoRouter Key，所有员工的用量都计入这一个账户。
- 凭证以 0600 文件保存，后续改为 Keychain。
- 制品只校验 SHA256，没有签名。
- SudoCloud 手机号登录和注册需要真实的手机号和短信，尚未实际跑过；接口形状来自 moss `server.ts`。
