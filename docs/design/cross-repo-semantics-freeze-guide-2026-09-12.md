# Sudo 跨仓语义冻结与文档修订实施说明

> 日期：2026-09-12
> 范围：三 ID、Zone、Agent Principal/Version、TaskSpec、六类产品契约、UI Overlay

## 1. 什么叫“冻结跨仓语义”

“冻结跨仓语义”不是马上重构所有代码，也不是以后永远不能修改，而是：

> 在 `moss`、`sudowork`、`sudocode`、`nexus/nexus-vfs` 同时继续开发之前，先把几个核心概念的定义、唯一权威源、API、生命周期和兼容规则确定下来，并形成版本化 ADR 与契约测试。

否则每个仓库都会基于自己的理解继续实现。例如 Moss 把 session 当业务会话，Nexus 把 session 当进程，SudoWork 又把 conversation 当 session。最终各自代码都能运行，但难以安全合并，也无法明确数据和权限的权威边界。

---

# 2. 三 ID：分清 Agent、持久会话和一次运行

## 2.1 三个 ID 分别是什么意思

### `agent-name`：谁在运行

这是一个持久的 Agent 身份，例如：

```text
code-reviewer
finance-auditor
general-copilot
```

它对应：

- Agent 的长期身份；
- CA 证书中的 principal；
- AgentSpec；
- prompts、skills、memory；
- 审批状态和权限要求。

它不是一次运行产生的 ID，也不应该因为进程退出而消失。

### `session-id`：一段可以恢复的连续工作

例如：

```text
sess_01JXYZ...
```

它表示一个持久会话：

- 是 `--resume` 的 key；
- 保存 transcript、tool results、artifact refs；
- 可以经历多次启动、崩溃、升级和 Pod 重建；
- 同一个 session 可能先后由多个进程运行。

### `pid`：当前这一次运行

例如：

```text
pid_01JABC...
```

它只表示一次临时运行实例：

- 一个本地进程、容器或 Pod 中的 runtime；
- 保存 running/stopping/exited 等 FSM；
- 退出后可以回收；
- 指向一个持久 `session-id`。

三者关系应该是：

```text
agent-name
    └── start/resume session-id
            ├── pid-001（退出）
            ├── pid-002（Pod 重建）
            └── pid-003（升级后继续）
```

## 2.2 当前问题

当前 [`nexus-vfs/rust/managed_agent/src/session.rs`](https://github.com/nexi-lab/nexus-vfs/blob/5f7e0a925ce1e8e796bcd004a61d7fbd23a5a712/rust/managed_agent/src/session.rs) 没有独立的持久 session ID，Managed Agent 返回的 `session_id` 实际上是 `pid-*`。

这会导致：

- 进程退出和会话结束混成一件事；
- Pod 重建后无法自然恢复同一 session；
- transcript、workspace 和 runtime 生命周期纠缠；
- Moss、SudoWork、Nexus 各自保存一套 session 对应关系；
- 审计记录无法稳定关联“一段工作”与“其中某次运行”。

## 2.3 建议冻结的语义

| ID | 是否持久 | 是否可变 | 由谁生成 | 权威源 |
|---|---:|---:|---|---|
| `agent-name` | 是 | 名称原则上不可变 | Agent Registry | Nexus Agent image |
| `session-id` | 是 | 不可变 | Session Service | Nexus SessionStore |
| `pid` | 否 | 每次运行重新生成 | Managed Agent Runtime | Nexus `/proc` Registry |

API 应调整为类似：

```ts
interface StartSessionRequest {
  agentName: string
  sessionId?: string
  taskId?: string
}

interface StartSessionResponse {
  agentName: string
  sessionId: string
  pid: string
}
```

语义是：

- 不传 `sessionId`：创建新 session，再启动一个 pid；
- 传入已有 `sessionId`：恢复该 session，启动新 pid；
- pid 退出：只结束本次运行，不删除 session；
- session 归档或删除：是独立的管理操作。

## 2.4 如何实施

1. 编写 `ADR-identifiers-and-lifecycle.md`。
2. 修改 Managed Agent API，使响应同时返回 `session_id` 和 `pid`。
3. 在 `/proc/{pid}` 中保存指向 session 的引用：

   ```text
   /proc/{pid}/session → /sessions/{sid}
   ```

4. 所有事件统一携带：

   ```json
   {
     "agent_name": "code-reviewer",
     "session_id": "sess_...",
     "pid": "pid_..."
   }
   ```

5. Moss 数据库暂时保留兼容映射，但不再把自己的 runtime ID 当最终权威源。
6. 增加生命周期测试：
   - 创建 sid + pid1；
   - 停掉 pid1；
   - 用同一 sid 启动 pid2；
   - pid2 能继续读取原 transcript、workspace 和 tool result。

## 2.5 意义

这是后面所有工作的基础。没有三 ID 分离，就无法可靠实现：

- session resume；
- Pod 重建；
- Agent 升级；
- 跨节点调度；
- 持久审计；
- 一个会话多次执行；
- 稳定的后训练数据；
- HA 接管。

---

# 3. Zone：冻结真正的租户与安全边界

## 3.1 Zone 是什么

Zone 不应该只是目录前缀，也不应等同于组织名称。

推荐定义：

> **Zone 是 Nexus 中不可随意改名、不可隐式跨越的持久安全与数据边界。**

例如：

```text
zone: cloud-user-1001
zone: private-acme-office
zone: private-acme-core
```

一个 Zone 内可以有：

```text
/{zone}/agents/
/{zone}/sessions/
/{zone}/repos/
/{zone}/skills/
/{zone}/tools/
/{zone}/secrets/
```

这里的 `agents`、`sessions`、`repos` 是 Zone 内的内容类型，不应该反过来各自成为 Zone。

## 3.2 Zone 与 Org 的区别

### Org

Org 是业务组织：

- 可以改名；
- 可以合并或拆分；
- 成员会变化；
- 用于审批、计费、角色和组织策略。

### Zone

Zone 是稳定的数据/安全边界：

- 原则上不可改名；
- 数据不因 Org 改名而搬迁；
- 跨 Zone 必须显式 grant/share；
- 用于 VFS、ReBAC、CA trust 和数据隔离。

因此不建议永久规定“一 Org 必定等于一 Zone”。

更合理的是：

```text
Org --grant--> Zone
User --member--> Org
User/Agent --permission--> Zone Resource
```

例如企业合并时，可以先让新 Org 同时拥有两个旧 Zone 的访问权，而不是立即搬迁全部数据。

## 3.3 当前为什么需要冻结

现有文档同时存在几种口径：

- 一用户/一租户一个 Zone；
- Org 与 Zone 解耦；
- tenant-first Zone；
- `sessions`、`repos` 等 content-type-first Zone。

这些口径如果不统一，会直接影响：

- 路径结构；
- 权限检查；
- 数据迁移；
- 企业合并/拆分；
- Cloud 与 Private 的隔离；
- 跨域授权；
- 备份和恢复单位。

## 3.4 建议冻结的内容

需要明确回答：

1. Zone ID 是什么格式；
2. Zone 是否可以重命名；
3. 谁可以创建 Zone；
4. Org 与 Zone 是一对一、一对多还是多对多；
5. 用户如何获得 Zone 权限；
6. Agent 在哪个 Zone 内运行；
7. Session 能否引用另一个 Zone 的 Repo；
8. 跨 Zone 是 mount、DT_LINK 还是复制；
9. 权限撤销是否影响已运行 pid；
10. Cloud、Private office、Private core 是否必定是不同 Zone。

推荐原则：

- Zone ID 使用稳定不可变 ID，显示名称另存；
- 组织通过 grant 访问 Zone；
- 同一 Zone 内的隔离可以依靠 ReBAC；
- 跨 Zone 必须显式授权，默认拒绝；
- Core Domain 不允许因为 Cloud fallback 自动跨 Zone；
- 跨 Zone 链接必须能审计和撤销。

## 3.5 如何实施

1. 编写 `ADR-zone-and-tenancy-model.md`。
2. 建立最小关系模型：

   ```text
   Organization
   User
   Zone
   ZoneGrant
   Membership
   ```

3. 定义 ReBAC tuple，例如：

   ```text
   org:acme#member@user:u1
   zone:acme-core#reader@org:acme
   session:s1#owner@user:u1
   ```

4. Moss 登录/组织管理只管理业务关系，通过 Nexus client 下发授权，不复制 VFS 权限 SSOT。
5. 实际发布的 Nexus assembly 必须安装 fail-closed permission provider。
6. 建立负向验收：
   - 用户 A 不能读取用户 B 的 Zone；
   - Office Zone 不能默认读取 Core Zone；
   - Agent 不能因为知道路径就跨 Zone；
   - permission provider 缺失时拒绝，而不是 `None → Ok`；
   - grant 撤销后新请求立即失败。

## 3.6 意义

Zone 决定整个系统的安全地基。冻结后才能可靠回答：

- 一个人的数据在哪里；
- 企业合并是否需要搬数据；
- Agent 到底以谁的权限访问；
- Cloud 和 Private 是否可能互相穿透；
- 核心域数据会不会因 fallback 出域；
- 备份、迁移、删除和审计以什么为单位。

---

# 4. Agent Principal/Version：分清“是谁”和“运行哪个版本”

## 4.1 问题是什么

当前文档里有两个容易冲突的概念：

1. `agent-name` 是持久 principal；
2. 代码 Agent 的 DID 又绑定 image digest，换镜像后 DID 失效。

如果不拆开，就会遇到：

- Agent 升级一次是否必须变成新身份；
- 历史 memory 属于旧版本还是新版本；
- 撤销一个有漏洞的版本是否等于删除整个 Agent；
- 审计时如何知道当时实际运行了哪个镜像；
- 同名 Agent 在不同组织或 CA 下是否冲突。

## 4.2 推荐模型

建议分成四层。

### Agent Principal：长期身份

```text
principal:
  trust_domain: acme.internal
  agent_name: finance-auditor
```

可表示为：

```text
nexus://acme.internal/agent/finance-auditor
```

它表示“这是哪个 Agent”，用于：

- 长期身份；
- memory 所有权；
- session 索引；
- ReBAC principal；
- CA 证书身份。

### Agent Version：不可变发布版本

```json
{
  "agent_name": "finance-auditor",
  "version": "1.4.2",
  "image_digest": "sha256:...",
  "spec_digest": "sha256:...",
  "signed_by": "release-ca",
  "status": "approved"
}
```

一个已发布版本应不可原地修改。

### Agent Channel/Alias：当前采用哪个版本

例如：

```text
finance-auditor@stable → 1.4.2
finance-auditor@canary → 1.5.0-rc.1
```

### Runtime Instance

某个 pid 实际固定使用一个具体版本和 digest，不能只记录 `latest`。

## 4.3 Memory 应绑定哪一层

推荐：

- 长期个人/团队 memory 绑定 Agent principal；
- 版本专用缓存绑定 Agent version；
- session transcript 记录当时的 Agent version/digest；
- Prompt、Skill、代码包属于不可变 version；
- 可变配置必须有版本或配置快照引用；
- 升级 Agent 不自动删除长期 memory；
- 回滚版本不改变 principal。

## 4.4 撤销也要分层

应区分：

- **Principal revoked**：整个 Agent 身份禁用；
- **Version revoked**：只禁止某个有漏洞的版本；
- **Certificate revoked**：某张凭据失效，可重新签发；
- **Approval withdrawn**：某版本不再允许进入特定组织或数据域。

不要把这四种状态压成一个 `disabled`。

## 4.5 如何实施

1. 编写 `ADR-agent-principal-and-version.md`。
2. 将 `/agents/{name}` 作为 principal 根：

   ```text
   /agents/{name}/
     principal.json
     memory/
     versions/
       1.4.2/
         manifest.json
         prompts/
         skills/
     channels/
       stable → versions/1.4.2
   ```

3. AgentSpec 读取时可以提供逻辑投影视图，但不能再单独保存第二份完整副本。
4. StartSession 必须锁定：

   ```json
   {
     "agent_name": "finance-auditor",
     "agent_version": "1.4.2",
     "spec_digest": "sha256:...",
     "image_digest": "sha256:..."
   }
   ```

5. 将这些字段写入 session metadata、每个 pid 和 Trace。
6. 验收：
   - 发布新版本不改变 principal；
   - 旧 session resume 时可明确选择继续旧版本或升级；
   - 被撤销版本不能启动新 pid；
   - 历史审计可还原当时的 spec/image；
   - 不同 trust domain 下同名 Agent 不会身份冲突。

## 4.6 意义

这保证：

- Agent 可以持续升级；
- 身份和供应链证明不会混乱；
- memory 不会因版本发布丢失；
- 可以精确回滚和撤销；
- Trace 能证明“谁、以哪个版本、运行了什么”；
- Private/Cloud 可以执行不同审批策略。

---

# 5. TaskSpec：把“用户任务”从临时进程参数提升为持久契约

## 5.1 TaskSpec 是什么

TaskSpec 描述的是“一次需要完成的任务”，不是 Session，也不是 pid。

例如：

```json
{
  "task_id": "task_123",
  "session_id": "sess_123",
  "agent": {
    "name": "finance-auditor",
    "version": "1.4.2"
  },
  "requested_by": "user:u1001",
  "input": {
    "report_month": "2026-08"
  },
  "workspace_refs": [
    "zone:acme-office/repo:finance"
  ],
  "task_mode": "cloud",
  "data_classification": "internal",
  "required_capabilities": [
    "filesystem.read",
    "spreadsheet.write"
  ],
  "deadline": "2026-09-12T12:00:00Z",
  "output_schema": {
    "$ref": "contracts/audit-report-v1.json"
  }
}
```

它回答：

- 谁发起的；
- 要哪个 Agent/版本执行；
- 输入是什么；
- 可以访问哪些 workspace；
- 需要哪些工具和权限；
- 数据密级是什么；
- 本地还是云端；
- 输出应满足什么结构；
- deadline/cancel/retry 规则是什么。

## 5.2 为什么不能只放在 `/proc/{pid}`

当前设计倾向将 TaskSpec 放在 `/proc/{pid}`，但 `/proc` 是临时的。

一旦 pid 被回收，就可能丢失：

- 原始任务；
- 为什么选择这个 Runtime；
- 为什么被拒绝；
- 哪个权限和策略版本参与了决定；
- 哪些 pid 执行过同一个 Task；
- 最终 Verify 结果。

推荐做法：

- **持久 TaskSpec** 放在 Session 下，例如：

  ```text
  /sessions/{sid}/tasks/{task-id}/spec.json
  ```

- `/proc/{pid}/task` 只保存指向持久 Task 的引用或执行快照。

## 5.3 TaskResolution 应成为明确契约

当前类型只允许三个成功 Runtime，但文档同时要求“不可执行时给出解释”。因此应改成 discriminated union：

```ts
type TaskExecutionResolution =
  | {
      status: 'accepted'
      resolvedRuntime: 'sudolocal' | 'sudocloud' | 'sudoprivate'
      resolutionMode: 'default' | 'policy_routed' | 'fallback'
      reasonCode: string
      reason: string
      policyVersion: string
    }
  | {
      status: 'rejected'
      reasonCode:
        | 'LOCAL_RESOURCE_REQUIRED'
        | 'DATA_DOMAIN_FORBIDDEN'
        | 'APPROVAL_REQUIRED'
        | 'CAPABILITY_UNAVAILABLE'
      reason: string
      policyVersion: string
    }
```

特别要规定：

- 技术连接失败不能自动绕过数据策略；
- Private/Core 任务不能因为 Cloud 可用就 fallback 到 Cloud；
- fallback 也必须重新经过 policy evaluation；
- resolution 必须进入 Trace/Audit。

## 5.4 如何实施

1. 编写 `ADR-task-and-execution-model.md`。
2. 定义 TaskSpec JSON Schema。
3. 明确 Task、Session、PID 的关系：

   ```text
   Session 1 ── N Task
   Task    1 ── N Attempt/PID
   ```

4. Moss 负责：
   - 接收任务；
   - IAM、审批和策略裁决；
   - 生成 resolution；
   - 保存业务审计视图。
5. Nexus 负责：
   - TaskSpec 的持久引用；
   - Session/PID 生命周期；
   - workspace/memory 引用。
6. sudocode 负责：
   - 校验输入；
   - 执行；
   - 生成结构化输出；
   - 发事件和 Verify evidence。
7. 验收：
   - pid 全部退出后仍能查询原始 TaskSpec；
   - 同一 Task 可对应多个 retry pid；
   - 每次 resolution 都有策略版本和原因；
   - 拒绝任务不创建运行 pid；
   - 审计可从 Task 追到 input、Agent version、pid、tool calls、output 和 Verify。

## 5.5 意义

TaskSpec 是产品层与执行层之间的核心分界。它让系统从“开一个聊天进程”升级为：

- 可审计任务平台；
- 可重试、可取消的工作流；
- 可做策略路由；
- 可验证输入输出；
- 可做自动验收；
- 可生成后训练样本；
- 可将 UI、控制平面和执行引擎解耦。

---

# 6. 六类产品契约：把已有协议统一成产品语义

ACP、MCP、WebSocket、IPC 解决的是“消息怎样传输”。六契约解决的是“消息代表什么”。

例如 WebSocket 能传一段 JSON，但它不会自动告诉我们：

- 这是 Task 还是 Tool 调用；
- 谁授权了；
- 能否重放；
- 输出如何验证；
- 兼容哪个版本；
- 应该写入哪个权威存储。

## 6.1 TaskSpec

TaskSpec 定义可执行任务。

需要冻结：

- Task 生命周期；
- 输入输出 schema；
- deadline/cancel/retry；
- Runtime resolution；
- Agent version；
- workspace、memory 和权限引用；
- accepted/rejected 结果。

## 6.2 Tool Protocol

Tool Protocol 定义所有工具调用的产品语义。

建议最小结构：

```json
{
  "protocol": "sudo.tool/v1",
  "call_id": "call_123",
  "task_id": "task_123",
  "actor": {
    "human": "user:u1",
    "agent": "agent:finance-auditor"
  },
  "tool": "filesystem.read",
  "arguments": {},
  "auth_context_ref": "delegation:d1",
  "timeout_ms": 30000,
  "idempotency_key": "..."
}
```

响应应包含：

```json
{
  "status": "succeeded",
  "result_ref": "tool-results/call_123",
  "evidence_ref": "...",
  "error": null
}
```

需要冻结：

- 工具命名；
- 参数/结果 schema；
- timeout、cancel、retry；
- 幂等规则；
- 大输出 offload；
- 哪个身份和 delegation 授权；
- 审计字段；
- 错误分类。

意义：MCP、本地工具、浏览器、文件系统和企业服务可以遵循同一权限及审计模型。

## 6.3 Context Protocol

Context Protocol 定义每次调用模型或 Agent 时，上下文如何组装。

建议包含：

- system/instruction refs；
- transcript window；
- memory refs；
- workspace manifest；
- tool definitions；
- secrets scope，但绝不包含 secret 明文；
- data classification；
- compression/summarization metadata；
- 被排除内容及原因。

需要明确：

- 谁负责组装；
- token 超限如何压缩；
- resume 如何恢复；
- 哪些数据可以发往哪个模型；
- Cloud/Private 如何剥离敏感内容；
- prompt injection 防护和 provenance。

意义：避免 SudoWork、Moss 和 sudocode 各自拼一套 prompt，造成行为、权限和数据泄露边界不一致。

## 6.4 Memory Protocol

Memory Protocol 定义 Agent 记忆如何读写，而不仅是“有一个 memory 文件夹”。

要明确：

- memory 类型：长期、session、team、提取记忆等；
- owner；
- namespace；
- visibility；
- TTL；
- provenance；
- 读写权限；
- 冲突和合并；
- 删除和合规；
- 版本升级时如何继承。

推荐 Agent 长期 memory 权威落到：

```text
/agents/{name}/memory/
```

但必须结合 Zone 和 Principal 定义，避免不同租户同名 Agent 共用错误 memory。

意义：让 memory 可迁移、可治理、可审计，而不是散落在 Moss、本地文件和 UI 数据库中。

## 6.5 Verify Protocol

Verify Protocol 定义“任务是否完成、完成得怎么样”。

建议包含：

```json
{
  "protocol": "sudo.verify/v1",
  "task_id": "task_123",
  "rubric_ref": "rubrics/financial-audit-v2",
  "checks": [
    {
      "id": "totals-match",
      "status": "passed",
      "score": 1,
      "evidence_refs": ["artifact:report", "tool-result:call_9"]
    }
  ],
  "final_status": "accepted",
  "score": 0.94
}
```

要冻结：

- rubric；
- required/optional checks；
- evidence 格式；
- score/reward；
- 谁可以裁决；
- 自动与人工验收；
- 失败后重试；
- 签名交付。

意义：没有 Verify，系统只能证明“Agent 输出了一段文字”，不能证明任务完成，也无法构建可靠后训练数据。

## 6.6 Event/Trace Protocol

Event/Trace Protocol 定义整个系统统一的事件轨迹。

推荐统一 envelope：

```json
{
  "protocol": "sudo.event/v1",
  "event_id": "evt_123",
  "event_type": "tool.call.started",
  "timestamp": "...",
  "agent_name": "finance-auditor",
  "agent_version": "1.4.2",
  "session_id": "sess_123",
  "task_id": "task_123",
  "pid": "pid_456",
  "actor": "user:u1",
  "resource": "tool:filesystem.read",
  "payload": {}
}
```

需要冻结：

- event type registry；
- actor/resource；
- correlation IDs；
- 顺序和重放；
- at-least-once 去重；
- 敏感字段；
- 大 payload offload；
- transcript 与 trace 的关系；
- retention；
- schema version。

当前 Moss transcript 中仍有不少 `version: "unknown"`，说明事件版本还没有完全治理。

意义：

- 跨仓调试；
- 安全审计；
- 计费归因；
- HA 重放；
- Verify evidence；
- 后训练轨迹；
- 问题追责。

## 6.7 六契约如何工程化

canonical editable definition 住在 semantic owner repo；owner 按自己的语言和构建系统选择 source path，并在本仓维护 fixtures 与 owner-local validation。`sudostack` 不复制这些定义，而是按 owner repository、完整 commit、source path 与 digest 固定来源，再派生和分发真实 consumer 所需的 artifact：

```text
semantic owner repo
  <actual-source-path>       # canonical definition
  owner fixtures
  owner-local validation
           ↓ exact repo / commit / path / digest
sudostack
  contracts/<family-or-primitive>/
    pin.json
    *.gen.*                  # 可重现派生产物
    fixture-index.gen.json   # owner fixture provenance（启用后）
  compatibility/             # 真实 producer/consumer 支持矩阵（启用后）
  manifests/                 # baseline/artifact/release provenance（启用后）
  @sudo/contracts / offline artifact
           ↓ exact revision / digest
consumer production boundary
```

owner repo 不需要复制统一目录模板。derived bundle 可以物化 owner schema 供安装或离线使用，但只能从精确来源重建，不能成为第二份可编辑定义。没有 owner baseline 或真实 consumer 时，不创建 placeholder family 或语言 artifact。

按真实 consumer 启用：

- owner machine-readable definition 与 fixtures；
- TypeScript 类型和 runtime validators；
- Rust serde 类型或其他语言 artifact；
- API 文档和可安装/离线 bundle；
- fixture index、compatibility matrix 与 release provenance。

不要直接把现有 [`sudowork/packages/contracts`](https://github.com/sudoprivacy/sudowork/tree/9f7a5fca1e6cc114d02b26af76f791d449f40779/packages/contracts) 重命名后就宣布完成。它已有 auth/conversation DTO，可以作为迁移期 consumer/adapter，但 package 分发位置不取得 semantic ownership。

启用的 CI 至少需要：

1. owner definition/schema lint 与引用解析；
2. non-empty fixture validation；
3. 已启用语言的真实 adapter round trip；
4. 老版本 fixture 能被新 minor 版本读取；
5. breaking change 必须升 family major；
6. exact source/pin 与 provider/consumer compatibility matrix；
7. 禁止正式事件使用 `version: unknown`。

---

# 7. UI Overlay：分清权威对话数据和界面私有状态

## 7.1 UI Overlay 是什么

目标架构要求 transcript 成为持久会话事实，但 SudoWork 的本地 messages 数据并不只是 transcript 副本。

当前 UI 数据可能包含：

- 用户原始输入；
- assistant 内容；
- 完整工具展示信息；
- tips/status；
- artifact/delivery 信息；
- 草稿；
- 消息折叠状态；
- 已读位置；
- 本地标签；
- conversation 到 ACP/Moss session 的绑定；
- 非 sudocode backend 的消息。

所以不能直接认为“Nexus 已有 transcript，把 SudoWork messages 表删除即可”。

正确做法是把数据分成三类。

## 7.2 三类数据

### A. 权威会话事实：进入 Transcript

包括：

- 用户原始输入；
- assistant 输出；
- tool call/result；
- cancel/error；
- artifact refs；
- Agent version；
- Task/Verify 事件；
- 服务端时间和身份。

这些数据必须可以跨客户端恢复。

### B. UI Overlay：界面私有状态

包括：

- 消息是否折叠；
- 草稿；
- 当前选中的 tab；
- 滚动/已读位置；
- 本地展示偏好；
- 临时编辑状态；
- 仅供渲染的缓存。

这些不应成为 Agent 或服务端业务逻辑的权威输入。

### C. 本地索引与绑定

例如：

```text
local conversation ID → remote session ID
```

这类数据可以保留，但必须声明只是索引/引用，不是第二份 Session SSOT。

## 7.3 当前为什么必须先设计

SudoWork 当前 messages 位于 [`sudowork/apps/desktop/src/process/database/schema.ts`](https://github.com/sudoprivacy/sudowork/blob/9f7a5fca1e6cc114d02b26af76f791d449f40779/apps/desktop/src/process/database/schema.ts)，并且包含比简单 transcript 更丰富的产品语义。

如果没有 Overlay 设计就迁移，会造成：

- 用户原始输入丢失；
- 历史工具调用无法完整展示；
- artifact 和交付信息丢失；
- 本地模式/非 scode backend 历史不可读；
- resume 后 UI 与运行态错位；
- Desktop 和 WebUI 呈现不一致。

## 7.4 如何实施

### 第一步：建立字段分类表

逐字段列出：

| 当前字段 | 目标归属 | 权威 writer | 是否迁移 |
|---|---|---|---|
| 用户原文 | transcript | engine/session service | 是 |
| tool result | transcript/tool-results | engine | 是 |
| artifact ref | transcript/session | engine/control plane | 是 |
| collapsed | UI overlay | SudoWork | 否或本地迁移 |
| draft | UI overlay | SudoWork | 否 |
| remote session binding | local index | SudoWork | 保留引用 |
| task approval state | Moss task/audit | Moss | 不能放 UI overlay |

### 第二步：定义重建目标

必须证明：

```text
Canonical Transcript + UI Overlay
              ↓
      完整重建 Conversation UI
```

如果无法重建，说明仍有业务事实藏在 UI 表中。

### 第三步：采用迁移期双写

建议：

1. 旧 messages 继续作为主读取源；
2. 同时写新 transcript；
3. 后台 shadow rebuild；
4. 比较消息、工具结果、artifact 和顺序；
5. 修复差异并回填历史；
6. 切换为 transcript-primary；
7. 旧 messages 改为 Overlay/Index；
8. 稳定一个版本周期后再清理重复字段。

### 第四步：覆盖异常场景

至少测试：

- Desktop 重启；
- WebUI 换浏览器；
- 同用户多窗口；
- 本地离线 Session；
- Remote Session；
- 非 scode backend；
- tool result 很大而被 offload；
- transcript 中断或部分损坏；
- 从旧版本数据库升级；
- session resume 到新 pid；
- 用户主动导出和删除。

## 7.5 意义

UI Overlay 的价值是同时实现：

- SudoWork 真正成为可替换的 UI；
- transcript 成为跨客户端、跨进程的事实源；
- 不牺牲桌面端已有用户体验；
- 避免 UI 数据库变成隐藏的第二控制平面；
- 支持 Desktop、WebUI 和未来移动端一致恢复；
- 为 Session SSOT 迁移提供安全路径。

---

# 8. “修正文档”具体要交付什么

这一步不能只修改架构图。建议形成以下产物。

## 8.1 ADR

至少六份：

```text
ADR-001 Agent Session Process Identifiers
ADR-002 Zone and Tenancy Model
ADR-003 Agent Principal and Versioning
ADR-004 Task and Execution Resolution
ADR-005 Product Contract Versioning
ADR-006 Transcript and UI Overlay
```

每份 ADR 都要包含：

- 背景；
- 决策；
- 被拒绝的方案；
- 数据模型；
- API；
- 权威 writer/reader；
- 生命周期；
- 安全边界；
- 兼容与迁移；
- 未解决问题；
- 生效版本。

## 8.2 SSOT 所有权矩阵

推荐明确：

| 数据 | SSOT | 主要 Writer | 其他仓角色 |
|---|---|---|---|
| AgentSpec/Image | Nexus | Registry/发布服务 | Moss 治理 View |
| Session/Transcript | Nexus SessionStore | sudocode/runtime | Moss Audit Index、UI Read |
| PID/FSM | Nexus `/proc` | Managed Agent | Moss Supervise View |
| Task Policy/Approval | Moss | Moss | Nexus 保存关联引用 |
| Workspace Links | Nexus | Runtime/VFS | Moss 提供策略 |
| UI Overlay | SudoWork | SudoWork | 不影响执行事实 |
| 企业 IAM/Org | Moss | Moss | 映射到 Nexus Grants |
| Secrets Bytes | Nexus Vault | Credential Service | Moss 管理 Metadata/Policy |

## 8.3 Contract 分发与兼容矩阵

`sudostack` 聚合并记录 derived distribution 的支持矩阵，不接管 semantic owner 的 editable definition。矩阵只列真实 producer/consumer 已验证的 family major，并分别标明 owner revision、artifact revision 与 deployment evidence。

记录格式示意（以下不是当前支持声明）：

```text
moss       task/v1, event/v1
sudocode   task/v1, tool/v1, event/v1
sudowork   event/v1, transcript/v1
nexus      session/v1, managed-agent/v2
```

## 8.4 迁移方案

每个对象必须明确：

- 当前存在哪里；
- 新权威源在哪里；
- 如何 backfill；
- 是否双写；
- 什么时候切读；
- 如何校验；
- 如何回滚；
- 什么时候删除旧写入。

---

# 9. 推荐实际执行顺序

这些任务之间有依赖，建议按以下顺序冻结。

## 第一组：先决定身份与边界

1. Zone；
2. Agent Principal/Version；
3. 三 ID。

因为后面的 TaskSpec、Memory、权限和路径都依赖这三项。

## 第二组：决定执行语义

4. TaskSpec；
5. TaskExecutionResolution；
6. Task、Session、PID、Attempt 的关系。

## 第三组：定义跨仓契约

7. 六契约的 v1 最小字段；
8. Schema 版本与兼容规则；
9. Rust/TypeScript conformance fixtures。

## 第四组：决定数据迁移

10. Transcript 与 UI Overlay；
11. Moss 与 Nexus 的 Writer/Reader 边界；
12. 双写、回填、切读和回滚方案。

## 第五组：做一条参考实现

不要立即全量迁移。选一个简单 Agent，完成：

```text
AgentSpec
  → Moss 审批
  → Nexus start_session
  → 独立 sid + pid
  → sudocode Nexus SessionStore
  → TaskSpec/Tool/Event
  → Verify
  → SudoWork Transcript + Overlay 重建
```

这条链跑通后，才能证明冻结的语义可实现，而不只是新写了一套文档。

---

# 10. 整体意义

如果不先做这一步，后续很容易出现：

- Moss 和 Nexus 各自认为自己是 Session SSOT；
- `session-id` 在某仓是持久会话，在另一仓是进程；
- Agent 一升级就失去身份或 Memory；
- Org 改名导致数据路径和证书迁移；
- Cloud fallback 绕过 Private 数据策略；
- SudoWork 删除 messages 后丢失历史；
- 每个仓都有自己的 Task/Event schema；
- 有 ReBAC 代码，但实际 Runtime 使用 system context 绕过；
- Trace 无法证明具体由哪个版本、哪个进程完成了任务。

冻结这些语义以后，最大的收益不是“文档更漂亮”，而是：

> **所有仓库开始围绕同一个对象模型、同一套生命周期、同一个权威数据源和同一组安全边界开发。**

这样后续的 SSOT 迁移、Kubernetes Runtime、HA、Private/Edge 部署和后训练数据线才不会反复推倒重来。

---

# 11. 建议的完成标准

这一阶段完成时，至少应具备：

1. 六份已接受的 ADR；
2. 无歧义的 Zone、Principal、Version、Session、PID、Task 定义；
3. 每类对象明确唯一权威 Writer 和 SSOT；
4. 六契约 v1 的语言无关 Schema；
5. TypeScript/Rust 类型及双向验证 Fixture；
6. 明确的兼容、双写、Backfill、切读和回滚策略；
7. 一条贯通 Moss、Nexus、sudocode、SudoWork 的参考 Agent 链路；
8. 同一 Session 跨多个 PID/Pod 恢复成功；
9. Transcript + UI Overlay 可以完整重建界面；
10. 跨用户、跨 Org、跨 Zone 的负向权限测试全部 Fail Closed。
