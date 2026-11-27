# 部署 runbook：Mosswork Server（托管 SudoRouter，Linux 单机）

用户输入「开始部署」或类似意思后，按以下步骤推进。用 TodoWrite 建立这 7 个步骤的清单，并随进度更新。

## 可用动作

| 命令 | 作用 | 会修改目标机 |
|---|---|---|
| `actions/ops status` | 查看当前进度、目标、模型和最近操作 | 否 |
| `actions/ops authorize --local` | 把本机设为部署目标 | 否 |
| `actions/ops authorize --host H --user U [--port P]` | 获取远程主机指纹（第一次调用） | 否 |
| `actions/ops authorize --host H --user U [--port P] --fingerprint SHA256:...` | 用户确认指纹后，建立 SSH 授权 | 写入部署公钥 |
| `actions/ops inspect [--port P]` | 检查系统、架构、权限、Docker、资源、端口、网络（`--port` 是 Mosswork 要使用的端口，默认 8088，**不是 SSH 端口**） | 否 |
| `actions/ops docker-install [--mirror aliyun]` | 后台安装 Docker 和 Compose | **是** |
| `actions/ops mosswork-install [--port P] [--bind ADDR] [--upgrade]` | 后台安装 Mosswork Server（版本和校验和已锁定） | **是** |
| `actions/ops job-status <docker-install或mosswork-install> --wait 90` | 查看后台任务进度 | 否 |
| `actions/ops mosswork-configure [--model M] [--all-models]` | 在 Mosswork 中配置 SudoRouter 模型服务和默认模型 | **是** |
| `actions/ops healthcheck` | 验证 Mosswork 登录和真实模型调用，给出访问地址 | 否 |
| `actions/ops receipts` | 列出操作回执 | 否 |

开始前先运行一次 `actions/ops status`。如果上次已经完成部分步骤，从未完成的步骤继续，不要重复已成功的修改动作。

如果工作区里有 `answers.json`，先用 read_file 读取。里面已填的项（目标、端口、模型等）不用再问，直接使用，并在步骤 3 的部署方案中一并列出供用户确认。`answers.json` 中 `target.port` 是 SSH 端口，`mosswork.port` 是 Mosswork 端口，不要混用。

## 步骤 1：确定部署目标

问用户：Mosswork 装在本机，还是另一台 Linux 服务器？
- 本机：运行 `authorize --local`。注意本机必须是 Linux amd64；如果是 macOS，告诉用户需要一台 Linux 服务器。
- 远程：询问主机地址、SSH 用户名、端口（默认 22）。**不要询问密码。**
  1. 运行 `authorize --host … --user …`，把输出的指纹原样展示给用户，说明核对方法，请用户明确回答「确认」。
  2. 用户确认后，带上 `--fingerprint` 再运行一次。
  3. 如果输出要求运行 `ssh-copy-id`，把命令交给用户，请用户在**另一个终端**执行（密码只在那里输入）。用户完成后，重新运行第 2 步的命令。

## 步骤 2：环境检查

运行 `inspect`，用简短的表格把结果告诉用户。
- 有 ✗ 项时说明原因和处理办法，然后停在这里，直到问题解决或用户换一台机器。
  - 架构不是 amd64：MVP 不支持，请换机器。
  - sudo 需要密码：请用户为该账号配置免密 sudo，或改用 root。
  - 网络不通：请用户检查出口网络或代理。
- Docker 显示「!」时，进入步骤 3；否则跳过步骤 3。
- 端口被占用时，请用户换一个端口，之后安装时带上 `--port`。

## 步骤 3：确认部署方案（必须一次性确认）

把以下内容列给用户，并请用户回答「确认执行」：
- 部署目标和系统信息
- 将安装：Docker 和 Compose（如需要）、Mosswork Server（版本以 lock 文件为准，安装目录 /opt/moss-server）
- 监听地址和端口（默认 0.0.0.0:8088），以及外网访问需要用户自己配置 HTTPS 反向代理
- 模型服务：SudoRouter（地址以 `actions/ops status` 的输出为准），默认模型为向导里选定的模型。默认只启用这一个模型；用户要求时可启用全部可用模型（--all-models）
- **计费说明**：Mosswork 会使用当前登录用户的 SudoRouter Key，所有员工的模型用量都从这个账户扣费
- 预计耗时 10 到 30 分钟（主要用于下载镜像），需要约 20 GB 磁盘空间

用户没有明确确认，就不执行任何修改动作。用户确认后，连续执行步骤 4 到 7，中间不再逐项征求同意；只在出现失败或需要偏离方案时停下来。

## 步骤 4：安装 Docker（仅在需要时）

运行 `docker-install`。网络在中国大陆、下载慢时，可以加 `--mirror aliyun`，需先征得用户同意。然后在同一轮内反复运行 `job-status docker-install --wait 90`，直到任务结束。结束后重新运行 `inspect` 确认，然后直接进入步骤 5。

## 步骤 5：安装 Mosswork Server

运行 `mosswork-install`（带上用户确认过的 `--port` 和 `--bind`）。然后在同一轮内反复运行 `job-status mosswork-install --wait 90`，直到任务结束（首次安装通常需要 5 到 20 分钟）。不要粘贴大段日志，结束后直接进入步骤 6。

失败时，总结日志中的关键错误，给出处理建议。

## 步骤 6：配置模型服务

运行 `mosswork-configure`；用户要求启用全部模型时，加上 `--all-models`。向用户汇报：创建了哪个模型服务、启用了哪些模型、默认模型是哪个。

## 步骤 7：验收和交付

运行 `healthcheck`，然后向用户交付：
- Mosswork 访问地址
- 管理员账号，以及密码文件的位置。请用户自己查看密码，并在首次登录后修改密码
- 下一步做什么：在 Mosswork 中添加员工账号、创建智能体；外网访问需要配置 HTTPS
- 操作回执的位置（`actions/ops receipts`）

最后提醒一句：日常使用请到 Mosswork；以后需要升级或排查问题时，重新运行 Start.command 回到这里。
