# -*- coding: utf-8 -*-
import os, io
BASE = os.path.dirname(os.path.abspath(__file__))
def rd(p): return io.open(os.path.join(BASE, p), encoding='utf-8').read()

deploy_svg  = rd('arch_deploy.svg')
cons_svg    = rd('arch_consolidate.svg')

GH = 'https://github.com/'
def repo(name, org='sudoprivacy', label=None):
    return f'<a href="{GH}{org}/{name}"><code>{label or name}</code></a>'

BODY = '''
<span class="badge">Sudo 系统架构说明书 · v2.2</span>
<h1>Sudo 系统架构说明书</h1>
<p class="meta">在武鹏 v1.4 基础上订正命名口径、合并 Atlas、把 <b>AgentSpec 与 agent-context-storage-matrix consolidate 成同一套模型</b>，并按三种部署位置画顶层架构。本文是跨全家族技术架构 SSOT，落 ''' + repo('sudostack') + '''。开发（PRD + 伪代码）以本文与 matrix 为准。</p>

<div class="align">
<b>本版订正重点（相对武鹏 v1.4）</b>
<ul>
<li><b>命名口径</b>：<b>P2 SudoServer + P3 SudoMOSS 合并为 Sudo Atlas</b>（中控能力来自 base 产品 moss）。<b>Atlas 命名的是服务端平台本身，不是某个部署位置</b>——「谁托管」是另一个轴：<b>Sudo Cloud</b>(我们托管) / <b>Sudo Private</b>(客户自建) / <b>SudoEdge</b>(盒子) 都含 Atlas，而 <b>Sudo Local</b>(SudoWork＋内嵌 sudocode 单机) <b>根本没有 Atlas</b>——这就是两个轴不能压成一个的原因；P4 SudoRouter 的 repo 是 ''' + repo('nova-gateway') + '''（当前没有 sudorouter repo）；P6 → <b>Sudo Cloud</b>；nexus 在 <b>nexi-lab</b>（跨 org）。</li>
<li><b>先跑通 Cloud</b>：云端任务默认<b>先在我们自己的腾讯云跑通 Sudo Cloud</b>（已有部分服务在上面，方便 demo、立即可运行），作为企业交付前的完整搭建演练；企业交付时<b>同源</b>到 <b>Sudo Private</b>（客户自建，同一个 Atlas 平台、换个托管方）。</li>
<li><b>Agent 统一模型 consolidation（核心）</b>：<b>AgentSpec ≡ matrix 的 image 层 <code>/agents/{name}/</code></b>；且 <code>agent-name</code> 是一张 <b>CA 签发的不可伪造身份</b>（= governance.did）。实现者<b>必须</b>读懂 matrix。</li>
<li><b>三个 ID</b>：<code>agent-name</code>（image/制品/身份）· <code>session-id</code>（持久 <code>--resume</code> key）· <code>pid</code>（一次运行句柄）。"Agent 发布"不是发布一次任务。</li>
</ul>
</div>

<h2>一、顶层架构（三种部署位置 · 一份底座）</h2>
<p>按<b>三种部署位置、一份底座</b>组织，不是几个产品，是同一个东西的不同部署位置：<b>① 本地环境（个人端）</b>SudoWork UI + 内嵌 sudocode，断网可独立跑；<b>② Sudo Private（客户自建 · 企业内网）</b>Atlas 平台部署在客户网络，部署两次（办公域用户自管 / 核心域 IT 管控），差异靠配置不分叉代码；<b>③ Sudo Cloud（我们托管 · 公有云）</b>同一个 Atlas 平台的最强部署。三处跑的是<b>同一份底座</b>（sudocode + nexus）二进制、逐格一致。<b>Phase 1 先跑通 Sudo Local → Sudo Cloud</b>（腾讯云 dogfood，立即可 demo）。</p>
<div class="dia">__DEPLOY__</div>
<p class="meta">按你指的部署拓扑分三块画（local / private / cloud）。跨块：Local→Private 走 IM/定时触发 + 制品单向发布；Private↔Cloud 同源代码 + 跨域信任边界（只走脱敏产物）。模块粒度与跨块关系可继续迭代。</p>

<h2>二、产品组合与 repo</h2>
<p>Mega-product 由 Base product 装配复用（每个 mega 可含多个 base）。owner 与成功标准以下表为准，repo 链到 GitHub；权威「repo→责任人/编制」总表见组织文档 §0。</p>
<table>
<tr><th>Mega / 层</th><th>Base-product（repo）</th><th>owner</th><th>成功标准</th></tr>
<tr><td rowspan="5"><b>Sudo Private</b><br>客户自建（Atlas 平台）<br>（原 Server+MOSS）<br>owner 铁锋<br>repo ''' + repo('sudoprivate') + '''</td>
    <td>''' + repo('sudocode') + ''' · Agent 引擎</td><td>Ethan</td><td>独立 CLI 引擎稳定；对齐 AgentSpec/ACP/matrix；PTY 门禁</td></tr>
<tr><td>''' + repo('nexus','nexi-lab') + ''' + nexus-vfs · 基座</td><td>Ethan</td><td>VFS/身份/session 存储 SSOT；跨节点一致；不可伪造 from</td></tr>
<tr><td>''' + repo('nova-gateway') + ''' = SudoRouter</td><td>张帅</td><td>模型/工具/凭证统一出口；<b>核心域只接内部算力，办公/支撑域可接外部，且支撑域 router 可级联核心域 router 借内部算力</b>；每域独占 Key</td></tr>
<tr><td>''' + repo('moss') + ''' · 中控/控制平面</td><td><b>武鹏</b></td><td>企业 IAM/registry/triggers/cron/channels/wiki；agent 身份/session/registry 与 <b>nexus merge</b> 做 client（不复制 SSOT）；容器执行已上移 k8s+gvisor</td></tr>
<tr><td>''' + repo('shareone') + ''' · 协同/验收</td><td>孙文龙</td><td>standalone + 在 sudowork/sudocode 内嵌端到端丝滑；签名交付</td></tr>
<tr><td rowspan="3"><b>Sudo Cloud</b><br>我们托管·同一 Atlas 平台<br>owner 铁锋<br>repo ''' + repo('sudocloud') + '''</td>
    <td>= Atlas 全部 base（同源装配：sudocode/nexus/moss/shareone）</td><td>—</td><td><b>先在腾讯云跑通</b>完整搭建演练，立即可 demo</td></tr>
<tr><td>SudoRouter：公有云<b>直接用 <a href="https://sudorouter.ai/">sudorouter.ai</a></b></td><td>张帅</td><td>公有云模型出口；更强模型 / 三方数据</td></tr>
<tr><td>+ ''' + repo('sudochat') + ''' 多租户 · ''' + repo('sudoevolve') + ''' 验收</td><td>待定</td><td>多租户会话隔离；Rubric 打分与验收裁决</td></tr>
<tr><td rowspan="4"><b>SudoEdge</b><br>盒子/离线<br>owner Joe<br>repo ''' + repo('sudoedge') + '''</td>
    <td>Atlas（整体，盒内）</td><td>铁锋</td><td>air-gap 完整交付；SudoFDE 盒内不对外</td></tr>
<tr><td>''' + repo('sudowork') + '''（盒内 UI）</td><td>Joe</td><td>盒内 UI 可用</td></tr>
<tr><td>本域 SudoRouter（''' + repo('nova-gateway') + '''）</td><td>张帅</td><td>盒内模型出口，随盒子所在域策略</td></tr>
<tr><td><b>GPU stack · 本地 GPU 算力</b>（盒内自带 DGX/推理卡；SudoRouter 路由到它用内部算力）</td><td>待定</td><td>本地推理吞吐/利用率；断网可跑本地模型</td></tr>
<tr><td rowspan="2"><b>横向层</b></td>
    <td>''' + repo('sudowork') + ''' · SudoWork 纯 UI</td><td>Joe</td><td>纯 UI（任务/Team/Trace）；Harness=sudocode；内置 ai-dev-browser 工具</td></tr>
<tr><td>SudoGenius · Agent 集</td><td>各作者（FDE=雪涛）</td><td>领域包：本体/规则/资产/eval + 可跑的 eval</td></tr>
<tr><td rowspan="2"><b>内置工具 / 服务</b></td>
    <td>''' + repo('ai-dev-browser') + '''（<b>sudowork 内置工具，未来 sudocode 内置</b>）</td><td>待定</td><td>中等 agent 驱动中等难度网页探索；tools↔cores 1:1</td></tr>
<tr><td>''' + repo('password-agent') + '''（凭证/秘钥 vault）</td><td>梁燕芝</td><td>plaintext 不进 LLM</td></tr>
</table>
<p class="meta">「三方接入」不单列——它是 Agent（sudocode）的 tools/MCP 能力。「编排」在服务端<b>不是一个 base</b>，而是拆开：任务编排/触发=moss(event-triggers+cron)、算力/pod 调度=k8s、agent spawn+A2A=nexus-vfs（详见下方「服务端组成栈」）。</p>

<h2>二·五、Atlas 平台的服务端组成栈（cloud / private / edge 共用）</h2>
<p>基于对 moss / sudochat / hydra <b>真实代码</b>的核查，服务端各角色归属如下。核心原则：<b>jail 只有一套（k8s+gvisor），控制平面（moss）与 nexus 按 matrix 契约 merge，各自的自造容器层都不进服务端。</b></p>
<table>
<tr><th>角色</th><th>谁来做</th><th>说明</th></tr>
<tr><td><b>多租户控制平面</b></td><td>''' + repo('moss') + '''（身份/token 与 nexus merge）</td><td>moss 真正价值：企业 IAM/orgs/角色/api-key、agentStore 租户注册+审批、event-triggers+cron、channels、wiki/文档、secrets。≈ 早期 Atlas</td></tr>
<tr><td><b>引擎</b></td><td>''' + repo('sudocode') + '''</td><td>每租户 worker</td></tr>
<tr><td><b>jail + 调度</b></td><td><b>k8s + gvisor</b></td><td>统一取代 moss 的 docker-CLI、sudochat 的 dockerode、hydra 的 tmux —— 三个各自造的弱 jail</td></tr>
<tr><td><b>headless spawn / supervise</b></td><td>sudowork ACP + ''' + repo('nexus','nexi-lab') + ''' <code>start_session</code></td><td>hydra 自己文档 §8.2 也是这么分工的</td></tr>
<tr><td><b>A2A（若需要）</b></td><td>''' + repo('nexus','nexi-lab') + '''-vfs mailbox</td><td>不是 hydra；hydra 只是消费 nexus 的 mailbox</td></tr>
<tr><td><b>多租户 chatbot 模态</b></td><td>''' + repo('sudochat') + ''' 聊天经纪层（去掉 dockerode）</td><td>坐在上面的前端层（会话/SSE/每租户 prompt·wiki·skill）</td></tr>
<tr><td>hydra</td><td>❌ <b>不进服务端</b></td><td>周进鲸的 VS Code/Electron <b>开发者 IDE 工具</b>（copilot-worker 并行 agent · tmux+worktree · 单机）；至多 UX 参考</td></tr>
</table>
<div class="align">
<b>moss ↔ nexus merge 范围（按 matrix 契约，非只 identity）</b>：agent 身份（CA cert）· session（扁平 <code>/sessions/&lt;sid&gt;/</code>）· agent-registry 的 AgentSpec 制品（<code>/agents/{name}/</code>）· memory/workspace —— 这四类 matrix 定义 nexus 为 SSOT，moss 逐行改成 client；企业 IAM/审批流/triggers/cron/channels/wiki/secrets 留 moss。<b>matrix 就是这份 merge 的 checklist。</b>
</div>
<div class="align">
<b>最重要的产品边界</b>
<ul>
<li><b>SudoWork ≠ 服务端</b>：它是 UI，Agent 是 sudocode；Agent 身份/存储在引擎侧，SudoWork 只读 + 只写自己的 UI 字段。</li>
<li><b>Atlas 是平台，不是位置</b>：Cloud（我们托管）与 Private（客户自建）跑的是<b>同一个 Atlas</b>，共享全部 base + sudostack 装配，差别只在谁托管。<b>先跑通 Cloud，再同源交付 Private。</b>用户视角只看到「本地 / 云端」，Atlas 是 IT 采购看的名字。</li>
<li><b>SudoRouter 不单独对外</b>：各产品的模型/工具/凭证出口，不是独立售卖的产品。</li>
</ul>
</div>

<h2>三、Runtime 同源与任务路由</h2>
<p>用户侧只出现<b>两个任务入口</b>：本地任务、云端任务。用户不选 runtime；平台按 AgentSpec 的运行需求 + 组织策略 + 数据密级在后台解析，并把结果写入 Trace/Audit（可解释）。</p>
<ul>
<li><b>本地任务</b> → 默认 <b>SudoWork</b> 执行（本机文件/shell/browser/本地凭证/离线路径）。</li>
<li><b>云端任务</b> → <b>先跑通 Sudo Cloud</b>（腾讯云，立即可 demo/运行）；企业内网/强审计场景由组织策略同源到 <b>Sudo Private</b> 链路（含原 SudoMOSS 治理平面）。</li>
<li>不可执行时给<b>任务级解释</b>（"依赖本地浏览器，不能创建云端任务" / "企业审批未通过"），不做三选一置灰。</li>
</ul>
<pre class="code">type TaskMode = 'local' | 'cloud'

interface TaskExecutionResolution {
  taskMode: TaskMode
  // 先跑通 cloud（腾讯云 dogfood），企业交付同源到 private（客户自建）
  resolvedRuntime: 'sudolocal' | 'sudocloud' | 'sudoprivate'
  resolutionMode: 'default' | 'policy_routed' | 'fallback'
  reason: string   // 进 Trace/Audit，可审计
}</pre>

<h2>四、Agent 统一模型：AgentSpec ≡ matrix image 层<span class="tag">consolidation 核心</span></h2>
<p>武鹏 v1.4 定义了 <b>AgentSpec</b>（制品声明）。matrix 定义了 Agent 的<b>物理存储模型</b>。二者是<b>同一层的逻辑视角与物理落点</b>：AgentSpec 每个字段都落到 <code>/agents/{name}/</code> 下一个具体位置。实现 AgentSpec ⇔ 落地 matrix，不可分。</p>
<div class="dia">__CONS__</div>

<div class="align">
<b>agent-name = 不可伪造身份（评论补充）</b>：<code>agent-name</code> 不只是目录名——它是一张 <b>集群 CA 签发的证书</b>（SAN <code>nexus://agent/{name}</code>），即 AgentSpec 的 <code>governance.did</code>。A2A 写 mailbox 时内核 stamp hook 把 <code>from</code> 盖成不可伪造；任意消费方（本机/跨节点/跨组织）凭 CA 独立验签三步（① cert 在 CA 下有效 ② sig 在 cert 公钥下有效 ③ SAN 名 == from）。跨组织换跨-CA 信任锚（X.509）。详见 <a href="https://s.shareone.vip/s/nexus-auth-architecture">nexus-auth-architecture</a>。身份=agent-name，贯穿存储、A2A、委派全链。
</div>

<h3>三个 ID（OS 类比：磁盘上的可执行体 vs 运行中的进程）</h3>
<table>
<tr><th>ID</th><th>层</th><th>路径</th><th>语义</th></tr>
<tr><td><code>agent-name</code></td><td>IMAGE（持久）</td><td><code>/agents/{name}/</code></td><td>持久 principal · <b>不可伪造身份（CA cert）</b> · ≡ AgentSpec 制品</td></tr>
<tr><td><code>session-id</code></td><td>SESSION（持久）</td><td><code>/sessions/&lt;sid&gt;/</code></td><td>持久 UUID · <code>--resume</code> key · 跨 N 个 pid · 扁平 SSOT</td></tr>
<tr><td><code>pid</code></td><td>RUNTIME（临时）</td><td><code>/proc/{pid}/</code></td><td>一次运行句柄 · exit 即 reap · TaskSpec/Context 落此</td></tr>
</table>

<h3>AgentSpec 字段 → matrix 物理落点</h3>
<div class="align">
<b>这不是两份存储（回应 SSOT 顾虑）</b>：AgentSpec 是<b>逻辑视图</b>，matrix 路径是<b>唯一物理存储</b>。AgentSpec 的字段<b>就存在这些路径上</b>（<code>config.toml</code> / <code>prompts/</code> / <code>skills/</code> / <code>memory/</code>）——读/写 AgentSpec ＝ 直接读/写这些路径的投影，<b>不另存一份</b>。下表是「字段 ↔ 它存在哪」，不是「复制到第二处」。
</div>
<table>
<tr><th>AgentSpec 字段</th><th>matrix 物理落点</th><th>说明</th></tr>
<tr><td><code>id / version / displayName</code></td><td><code>/agents/{name}/</code> + <code>config.toml</code></td><td><code>agent-name</code> = 目录名 = 持久 principal</td></tr>
<tr><td><code>owner{...}</code></td><td><code>config.toml</code> + session <code>owner</code> 属性</td><td>身份 + 默认策略（隔离 = policy 非 path）</td></tr>
<tr><td><code>runtime.declarative.instructionRef</code></td><td><code>/agents/{name}/prompts/</code></td><td>声明式 harness 的 prompt</td></tr>
<tr><td><code>runtime.programmatic.packageRef</code></td><td>OCI image/package + <code>imageDigest</code></td><td>代码 Agent 制品（沙箱构建/扫描/签名）</td></tr>
<tr><td><code>requires.skills</code></td><td><code>/agents/{name}/skills/</code></td><td>—</td></tr>
<tr><td><code>requires.mcpServers / models / permissions</code></td><td><code>config.toml</code></td><td>运行期由 SudoRouter/MCP gateway 收口</td></tr>
<tr><td><code>contract.input / output</code></td><td>校验 <code>TaskSpec.input / output_schema</code></td><td>运行期契约（JsonSchema）</td></tr>
<tr><td><code>governance.status / riskLevel / dataClassification</code></td><td><code>config.toml</code> + 治理面</td><td>七道关卡输入</td></tr>
<tr><td><code>governance.did / imageDigest / signedBy</code></td><td><b>CA cert（agent-name）</b> + 签名</td><td>不可伪造身份 / 委派 / 供应链证明</td></tr>
</table>
<div class="align">
<b>强制基准</b>：任何 AgentSpec/Registry/Session 实现，<b>存储必须落 matrix 定义的路径与结构</b>（agent-name · 扁平 /sessions/ · owner · DT_LINK），不得另起一套。matrix（<code>sudocode/docs/design/agent-context-storage-matrix.html</code>）是 context/memory/session/storage 唯一物理 SSOT；本文只定义产品语义层如何落到它上面。
</div>

<h2>五、六个产品契约与物理落点</h2>
<p>六契约是 ACP/MCP/WebSocket/IPC <b>之上</b>的产品语义层，不替代传输层。短期把现有 bridge/API 返回值逐步对齐到由 semantic owner 维护的版本化定义，再按「semantic-owner canonical source → <code>sudostack</code> exact pin / 派生 <code>@sudo/contracts</code> 或离线 artifact → consumer exact pin」分发；family major 管 wire breaking，CI 加兼容性检查，不依赖在线契约注册中心。</p>
<table>
<tr><th>契约</th><th>作用</th><th>matrix 物理落点</th><th>层</th></tr>
<tr><td><b>TaskSpec</b></td><td>描述一个可执行任务</td><td><code>/proc/{pid}/</code>（+ session 关联）</td><td>runtime</td></tr>
<tr><td><b>Tool Protocol</b></td><td>统一工具调用</td><td><code>/tools/</code> + <code>/skills/</code> + MCP gateway</td><td>image/runtime</td></tr>
<tr><td><b>Context Protocol</b></td><td>上下文注入/压缩/剥离</td><td><code>/proc/{pid}/</code> 组装（memory_refs→memory/，workspace_manifest→workspace/）</td><td>runtime</td></tr>
<tr><td><b>Memory Protocol</b></td><td>Agent 记忆读写</td><td><code>/agents/{name}/memory/</code>（4 类 + team via zone raft）</td><td>image</td></tr>
<tr><td><b>Verify Protocol</b></td><td>结果验收与评分</td><td><code>/sessions/&lt;sid&gt;/transcript</code>（evidence_refs）</td><td>session</td></tr>
<tr><td><b>Event/Trace</b></td><td>事件流/轨迹/观测</td><td><code>/sessions/&lt;sid&gt;/transcript.jsonl</code></td><td>session</td></tr>
</table>
<div class="align">
<b>后训练线</b>：Verify + Event/Trace 共同定义<b>后训练友好的存储格式</b>（执行轨迹 + 可验证 reward，可直接喂后训练）。落在 session transcript（扁平 SSOT），天然可跨 agent/跨 session 检索（隔离 = policy 非 path）。
</div>

<h2>六、代码库归属（订正版）</h2>
<p>基于真实 repo 底账订正武鹏 Ch6。权威「repo→责任人」见组织文档 §0；本表只做「现有代码→目标产品」映射。</p>
<table>
<tr><th>现有代码位置</th><th>目标归属（订正）</th><th>动作</th></tr>
<tr><td><code>sudowork/src/renderer/</code></td><td>SudoWork UI</td><td>keep</td></tr>
<tr><td><code>sudowork/src/webserver/</code></td><td><b>Atlas</b>（原 SudoServer 平面）</td><td>模块化 server runtime/auth/registry client/task queue → 下沉</td></tr>
<tr><td><code>sudowork</code> 的 assistant presets</td><td><b>AgentSpec Registry</b></td><td><b>迁移到 AgentSpec</b>（与 moss/assistants 同）</td></tr>
<tr><td><code>sudowork/src/agent/acp/</code></td><td>共用 Harness client</td><td>抽 <code>@sudo/harness-client</code></td></tr>
<tr><td><code>sudowork/src/channels/</code></td><td>IM 接入层</td><td>抽 <code>@sudo/channels</code> 供 Cloud/Private 复用</td></tr>
<tr><td><code>moss/src/server/agentStore.ts</code></td><td>Atlas 中控（原 SudoMOSS）Agent Registry <b>client</b></td><td>重构为 AgentSpec-based；<b>不复制 nexus SSOT</b></td></tr>
<tr><td><code>moss/src/server/sessionManager.ts</code></td><td>Atlas Session/Task/Workspace/Artifact <b>client</b></td><td>委托 nexus（matrix）；不另存</td></tr>
<tr><td><code>moss/assistants/*</code></td><td>声明式内置 Agent</td><td>迁移到 AgentSpec</td></tr>
<tr><td>''' + repo('nova-gateway') + '''</td><td><b>SudoRouter</b></td><td>扩展内网态/DLP/上下文收口</td></tr>
<tr><td>''' + repo('nexus','nexi-lab') + '''</td><td>L0 基座</td><td>扩展 VFS/identity/rebac/delegation/vault/sandbox</td></tr>
<tr><td>''' + repo('sudocode') + '''</td><td>核心 code agent 引擎</td><td>独立仓，对齐 AgentSpec/ACP/matrix</td></tr>
</table>
<div class="align">
<b>⚠ SSOT/DRY 收口（评论补充）</b>：Agent Registry、Session/Task/Workspace/Artifact 的 <b>on-disk SSOT 原本就在 nexus</b>（<code>AgentRegistry</code> / <code>ManagedAgentService</code> pid FSM），这正是 nexus 有 <a href="https://s.shareone.vip/s/agent-context-storage-matrix">agent-context-storage-matrix</a> 的原因。moss 侧的 <code>agentStore</code> / <code>sessionManager</code> 与 nexus 这一套<b>必须二选一去重</b>：moss 做 <b>client / view</b>，SSOT 留在 nexus，不产生第二份存储。
</div>

<h2>七、文档与 SSOT 边界</h2>
<table>
<tr><th>文档</th><th>角色 / 边界</th><th>落位</th><th>是谁的 SSOT</th></tr>
<tr><td><b>本文</b>（产品架构说明书）</td><td>跨全家族技术架构</td><td>''' + repo('sudostack') + '''</td><td>产品分层 · 契约口径 · AgentSpec 语义</td></tr>
<tr><td>agent-context-storage-matrix</td><td>Agent 存储金标准（物理）</td><td>sudocode/docs/design</td><td>context/memory/session/storage 物理模型</td></tr>
<tr><td>nexus-auth-architecture</td><td>身份/签名/跨域信任</td><td>nexus</td><td>agent 身份 = CA cert · 不可伪造 from</td></tr>
<tr><td>sudocode 接入 PRD</td><td>如何落地 matrix（适配设计）</td><td>''' + repo('sudostack') + '''（待定，见下）</td><td>平台↔引擎接入实现</td></tr>
<tr><td>sudo-code-roadmap</td><td><b>路线图 / 优先级（≠设计）</b></td><td>shareone</td><td>时间 · 优先级</td></tr>
<tr><td>组织重组方案</td><td>组织 · 编制 · repo 责任 · 部署拓扑</td><td>leader-only</td><td>repo→责任人 · 编制 · 信任域</td></tr>
</table>

<h2>八、演进路线（订正命名，简述）</h2>
<ul>
<li><b>Phase A · MVP</b>：<b>先跑通 Cloud</b>（腾讯云）+ 托管 Runtime + AgentSpec Registry + 六契约 schema 化 + TaskExecutionResolution 可审计。</li>
<li><b>Phase B</b>：企业治理增强 —— 委派身份（agent CA cert / 短期凭证 / tool scope）、Trace/Audit 深化。</li>
<li><b>Phase C</b>：容器化 Runtime + 代码 Agent —— 沙箱升级（<b>gVisor</b>：用户态内核/syscall 拦截，跑不可信 agent 代码，涉密/企业值得）、OCI image + 签名/SBOM。</li>
<li><b>Phase D</b>：完整企业治理 + 数据飞轮 —— 委派 DID、撤销/轮换、后训练闭环（Verify+Event-Trace）。</li>
</ul>

<p class="foot-note">系统架构说明书 v2.2 · 基于武鹏 v1.4 + agent-context-storage-matrix + nexus-auth-architecture + v4.4 命名口径 · 落 sudoprivacy/sudostack · sudowork-win-pc-3</p>
'''

BODY = BODY.replace('__DEPLOY__', deploy_svg).replace('__CONS__', cons_svg)

TPL = '''<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sudo 系统架构说明书 v2.2</title><base target="_blank">
<style>
:root{--bg:#0f141b;--panel:#161d27;--panel2:#1b2430;--text:#e6edf5;--muted:#9fb0c3;--line:#2a3644;--accent:#6ea8fe;--green:#4ade80;--gold:#e0a94b;}
*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.75;font-size:16px;}
.page{max-width:1180px;margin:0 auto;padding:40px 30px 80px;}
h1{font-size:30px;margin:6px 0 6px;background:linear-gradient(90deg,#6ea8fe,#4ade80);-webkit-background-clip:text;background-clip:text;color:transparent;}
h2{font-size:22px;margin:44px 0 14px;padding:10px 0 10px 14px;border-left:4px solid var(--accent);background:linear-gradient(90deg,rgba(110,168,254,.10),transparent);border-radius:0 8px 8px 0;}
h3{font-size:17px;margin:24px 0 10px;color:var(--gold);}
p{margin:12px 0;}b{color:#fff;}
a{color:var(--accent);text-decoration:none;}a:hover{text-decoration:underline;}
code{background:#0b1017;color:#9fe0c0;padding:2px 6px;border-radius:5px;font-family:Consolas,monospace;font-size:.88em;border:1px solid var(--line);}
a code{color:#8fd0ff;}
pre.code{background:#0b1017;color:#cfe0f6;border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto;font-family:Consolas,monospace;font-size:12.5px;line-height:1.6;}
.meta{color:var(--muted);font-size:13px;margin:0 0 8px;}
table{width:100%;border-collapse:collapse;margin:16px 0;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13.5px;}
th,td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top;}th{background:var(--panel2);color:#fff;}
tr:nth-child(even) td{background:rgba(255,255,255,.015);}
ul,ol{padding-left:22px;}li{margin:6px 0;}
.badge{display:inline-block;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:20px;padding:2px 12px;margin-bottom:6px;}
.align{background:#131d15;border:1px solid #3b7a52;border-left:4px solid var(--green);border-radius:0 10px 10px 0;padding:14px 18px;margin:18px 0 8px;font-size:14px;}
.align b{color:#d7f5e1;}.align ul{margin:8px 0;}
.dia{background:#0b1017;border:1px solid var(--line);border-radius:16px;padding:18px 12px;margin:20px 0;overflow-x:auto;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,.35);}
.dia svg{max-width:100%;height:auto;}
.tag{display:inline-block;font-size:11px;color:#0c447c;background:#d3e6f8;border-radius:999px;padding:1px 7px;margin-left:6px;}
.foot-note{color:var(--muted);font-size:12.5px;border-top:1px solid var(--line);padding-top:14px;margin-top:30px;}
</style></head>
<body><main class="page">
__BODY__
</main></body></html>'''

html = TPL.replace('__BODY__', BODY)
io.open(os.path.join(BASE, os.pardir, 'architecture.html'), 'w', encoding='utf-8', newline='\n').write(html)
print('deploy svg:', len(deploy_svg), '| cons svg:', len(cons_svg), '| total html:', len(html))
