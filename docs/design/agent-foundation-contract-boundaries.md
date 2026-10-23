# Agent Foundation 契约边界与下一阶段入口

日期：2026-10-16。N00 准备材料；不是新的稳定 Schema 或 activation 声明。

## 当前实际消费

| Family | 语义来源 | 装配/消费 | 实际范围 |
|---|---|---|---|
| external-provider v1alpha5 | Moss contracts/external-provider/v1/contract.ts | Stack source.lock 精确 Git blob → Work artifact lock + Zod | 目录、管理、usage 元数据、会话、事件、执行证据 |
| Task v1alpha1 | Moss contracts/task/v1alpha1 | Stack agent-federation source.lock → Work | 正式 ingress/spec/resolution；accepted 仅 external_hosted/external_provider |
| Agent federation / HTTP v1alpha2 | Moss contracts/agent-federation、agent-http | Stack 生成；Moss Adapter/独立 Provider 使用 | Principal 仍 moss.local，Durable HTTP revision fencing/query recovery，不等于产品 Registry |
| ResourceRef / ZoneId | 既有 @sudo/contracts owner sources | Moss 当前依赖固定 273fd4097cbc33c1c049c39bb1fb60cef2663e2b | Task parser 已调用 assertResourceRef；Pilot admission 拒绝资源输入。结构校验不等于资源内容可用 |

当前 @sudo/contracts 0.2.1 activation record 对 ResourceRef 的支持声明仍 deferred。
本次记录消费事实，既不修改冻结 activation 记录，也不借实验 family 宣称全包已激活。

## 本次兼容约束

- 不改变 v1alpha5 必填字段；usage 可缺省，不允许客户端伪造“已验证内容/身份”。
- 新服务 → 旧客户端：保持既有 response 字段和动作。
- 旧服务 → 新客户端：usage 缺失时明确未提供；不推定数据、恢复或版本保证。
- 新服务 → 新客户端：Moss 显式审核时间，经 Stack 精确来源生成，被 Work 实际 Zod 消费保留。
- source/Stack artifact 任意字节篡改、非完整 commit pin：既有 generator/consumer checker 必须失败。
- 旧 Dify 兼容路由只保留旧 profile，external_hosted 跨入取密钥前拒绝；SSE 路由输出 error 而不是 HTTP 409，不能只检查 HTTP status。

## Registry / 原生接口进入下一阶段的条件

Registry 产品 owner 候选仍为 Nexus 产品仓（nexi-lab/nexus），nexus-vfs 提供运行时原语；不能仅凭镜像来源替换产品 owner。需要在 owner 的实际源码中确认或新增写 API、只读 resolver、授权边界和持久化后，才能冻结并生成 downstream Schema。

建议最小闭环：复用 Durable HTTP Provider 的已有精确执行版本，完成 Principal → immutable Version → Channel CAS → exact resolver → Moss 准入 → Work 执行证据。先不迁移全部历史 transcript。

必须明确的规则：同一 principal/version 内容冲突不可覆盖；Channel 使用 revision CAS；读取不隐式发布；撤销权威在准入时复核；迁移采用显式维护窗口、备份、停止旧 writer、dry-run、核验与回滚；旧 moss.local ID 保留可追溯映射。

原生 Task 增量必须由 Moss owner 新增 discriminated accepted variant，再沿 Stack/Work 生成链传播；旧客户端遇到 unknown variant 拒绝，不能降级为 external provider。ManagedAgentClient、ManagedAgentService 和 sudocode 必须消费 exact Version/bundle/image 并产出证据后，才能声明 native 支持。当前 start_session 仅含 agent_id/repos/model/owner/zone/resume，不能只新增 DTO 字段就算完成。

## 候选制品准备 D01–D03

本次先验证主仓合并代码加 Foundation 增量可构建。冻结 rc.9 保持不变。新的候选装配需记录：Moss 服务/管理端源码及摘要、SudoWork renderer/WebUI/desktop 来源、独立 HTTP Provider 镜像与 revision、模型/DB/凭据注入位置、旧 revision 路由策略、显式维护迁移步骤。

候选安装应使用真实 Dify 和 Durable HTTP 合成任务，含管理员添加/检查/授权/审核发布，用户目录→对话→历史→执行证据，以及 unknown 不重发负控。mock-model 安装 smoke、本地构建和组件 DOM 测试不能替代该真实验收。本次未自动发布或部署新的候选环境。
