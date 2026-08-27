# -*- coding: utf-8 -*-
import os, io
BASE = r'C:\Users\songym\cursor-projects\_docssot'
def rd(p): return io.open(os.path.join(BASE, p), encoding='utf-8').read()

layers_svg = rd('arch_layers.svg')
cons_svg   = rd('arch_consolidate.svg')

BODY = '''
<span class="badge">Sudo 产品架构说明书 · 订正版 v2.0</span>
<h1>Sudo 新一代产品架构说明书（订正版）</h1>
<p class="meta">在武鹏 v1.4 基础上订正命名口径、合并 Atlas、并把 <b>AgentSpec 与 agent-context-storage-matrix consolidate 成同一套模型</b>。本文是跨全家族技术架构 SSOT，落 <code>sudoprivacy/sudo-stack</code>。开发（PRD + 伪代码）以本文与 matrix 为准。</p>

<div class="align">
<b>本版订正重点（相对武鹏 v1.4）</b>
<ul>
<li><b>命名口径</b>：以 v4.4 口径为准 —— <b>P2 SudoServer + P3 SudoMOSS 合并为 Sudo Atlas</b>（中控能力来自 base 产品 <code>moss</code>）；P4 SudoRouter 的 repo 是 <b><code>nova-gateway</code></b>（当前没有 <code>sudorouter</code> repo）；P6 Sudo Platform → <b>Sudo SaaS</b>；<code>nexus</code> 在 <b><code>nexi-lab</code></b>（跨 org）。</li>
<li><b>两层产品模型</b>：Mega-product（面向客户的组合：Atlas / SaaS / SudoEdge）由 Base product（底层 repo）装配复用；SudoWork 是纯 UI，SudoGenius 是 Agent 集。</li>
<li><b>Agent 统一模型 consolidation（核心）</b>：<b>AgentSpec ≡ matrix 的 image 层 <code>/agents/{name}/</code></b> —— AgentSpec 是逻辑 schema，<code>/agents/{name}/</code> 是物理存储，两者一一对应。脱离 matrix 存储模型，AgentSpec 字段无处落地。实现者<b>必须</b>读懂 matrix。</li>
<li><b>三个 ID（订正武鹏最大一处）</b>：<code>agent-name</code>（image/制品）· <code>session-id</code>（持久 <code>--resume</code> key）· <code>pid</code>（一次运行句柄）。"Agent 发布"不是发布一次任务；TaskSpec/Context 属 runtime 层。</li>
</ul>
</div>

<h2>一、两层产品模型</h2>
<p>产品分两层：<b>Mega-product</b> 是面向客户交付的组合（同源、部署形态不同），<b>Base product</b> 是被复用的底层 repo（一次做好、处处复用、各自独立演进）。SudoWork 是纯 UI 客户端；SudoGenius 是随产品分发的领域 Agent 集。</p>
<div class="dia">__LAYERS__</div>
<p class="meta">权威 repo / 责任人 / 部署拓扑见「组织重组方案」§0（leader-only），本文不复制，只做架构映射。</p>

<h3>命名口径（武鹏旧 → 订正）</h3>
<table>
<tr><th>武鹏 v1.4（旧）</th><th>订正口径（v4.4）</th><th>repo</th><th>说明</th></tr>
<tr><td>P1 SudoWork</td><td>SudoWork（纯 UI）</td><td><code>sudowork</code></td><td>桌面/WebUI 客户端，Harness = sudocode</td></tr>
<tr><td><b>P2 SudoServer + P3 SudoMOSS（分列）</b></td><td><b>Sudo Atlas（合并）</b></td><td><code>sudo-atlas</code>（装配于 <code>sudo-stack</code>）</td><td>企业私有化；中控/registry/session 能力来自 base <code>moss</code></td></tr>
<tr><td>P4 SudoRouter</td><td>SudoRouter</td><td><b><code>nova-gateway</code></b></td><td>模型/工具/凭证出口路由，非单独对外</td></tr>
<tr><td>P5 SudoEdge</td><td>SudoEdge · 盒子</td><td><code>sudoedge</code></td><td>离线/涉密交付，SudoFDE 盒内不对外</td></tr>
<tr><td>P6 Sudo Platform</td><td><b>Sudo SaaS</b></td><td><code>sudo-saas</code></td><td>公有云 · Atlas 同源 + 编排脑 + 三方接入</td></tr>
<tr><td>P7 SudoGenius</td><td>SudoGenius · Agent 集</td><td>各作者</td><td>领域包（本体/规则/资产/eval）</td></tr>
</table>

<h2>二、七个产品定义</h2>
<table>
<tr><th>产品</th><th>定位</th><th>部署形态</th><th>repo</th></tr>
<tr><td><b>SudoWork</b></td><td>纯 UI 客户端（任务/Agent/Team/Trace UI）</td><td>本地 / 自托管 WebUI</td><td><code>sudowork</code></td></tr>
<tr><td><b>Sudo Atlas</b></td><td>企业私有化平台：托管 Runtime + Agent 治理 + 中控/编排/验收</td><td>企业内网（部署两次：管理面 + 执行面）</td><td><code>sudo-atlas</code> / <code>sudo-stack</code></td></tr>
<tr><td><b>SudoRouter</b></td><td>模型/工具/凭证统一出口，内网态 DLP + 上下文收口</td><td>内嵌各产品</td><td><code>nova-gateway</code></td></tr>
<tr><td><b>SudoEdge</b></td><td>交付盒子：盒内含 Atlas + SudoWork，air-gap</td><td>客户现场，离线</td><td><code>sudoedge</code></td></tr>
<tr><td><b>Sudo SaaS</b></td><td>公有云 Atlas 同源 + 编排脑 + 三方接入（锐锢/中资等投标）</td><td>数牍腾讯云</td><td><code>sudo-saas</code></td></tr>
<tr><td><b>SudoGenius</b></td><td>领域 Agent 集：本体/规则/资产/eval</td><td>随产品分发</td><td>各作者</td></tr>
</table>
<div class="align">
<b>最重要的产品边界</b>
<ul>
<li><b>SudoWork ≠ 服务端</b>：它是 UI，Agent 是 sudocode。Agent 身份/存储在引擎侧，SudoWork 只读 + 只写自己的 UI 字段。</li>
<li><b>Atlas ≠ 云端</b>：Atlas 是企业私有化。公有云是 SaaS（Atlas 同源）。两者共享 base 产品与 <code>sudo-stack</code> 装配。</li>
<li><b>SudoRouter 不单独对外</b>：它是各产品的模型出口，不是独立售卖的产品。</li>
</ul>
</div>

<h2>三、三 Runtime 同源与任务路由</h2>
<p>用户侧只出现<b>两个任务入口</b>：本地任务、云端任务。用户不选 runtime；平台按 AgentSpec 的运行需求 + 组织策略 + 数据密级在后台解析到具体执行链路，并把解析结果写入 Trace/Audit（可解释）。</p>
<ul>
<li><b>本地任务</b> → 默认 <b>SudoWork</b> 执行（本机文件/shell/browser/本地凭证/离线路径）。</li>
<li><b>云端任务</b> → 默认 <b>Atlas</b> 执行（已同步、已授权、服务端可访问的 workspace/memory/artifact/connector/凭证）。</li>
<li>企业内网数据/强审计场景由组织策略路由到 <b>Atlas</b> 的企业治理链路（原 SudoMOSS 角色，现为 Atlas 内的一个平面）。</li>
<li>不可执行时给<b>任务级解释</b>（"依赖本地浏览器，不能创建云端任务" / "企业审批未通过"），不做三选一置灰。</li>
</ul>
<pre class="code">type TaskMode = 'local' | 'cloud'

interface TaskExecutionResolution {
  taskMode: TaskMode
  resolvedRuntime: 'sudowork' | 'atlas'   // 订正：原 sudoserver/sudomoss 合并入 atlas
  resolutionMode: 'default' | 'policy_routed' | 'fallback'
  reason: string                          // 进 Trace/Audit，可审计
}</pre>

<h2>四、Agent 统一模型：AgentSpec ≡ matrix image 层<span class="tag">consolidation 核心</span></h2>
<p>武鹏 v1.4 定义了 <b>AgentSpec</b>（Agent 制品声明）。matrix 定义了 Agent 的<b>物理存储模型</b>（Nexus 两命名空间）。二者不是两套设计，而是<b>同一层的逻辑视角与物理落点</b>：AgentSpec 的每个字段都落到 <code>/agents/{name}/</code> 下的一个具体位置。因此实现 AgentSpec ⇔ 落地 matrix，二者不可分。</p>
<div class="dia">__CONS__</div>

<h3>三个 ID（OS 类比：磁盘上的可执行体 vs 运行中的进程）</h3>
<table>
<tr><th>ID</th><th>层</th><th>路径</th><th>语义</th></tr>
<tr><td><code>agent-name</code></td><td>IMAGE（持久）</td><td><code>/agents/{name}/</code></td><td>持久 principal · 可寻址身份 · <b>≡ AgentSpec 制品</b></td></tr>
<tr><td><code>session-id</code></td><td>SESSION（持久）</td><td><code>/sessions/&lt;sid&gt;/</code></td><td>持久 UUID · <code>--resume</code> key · 跨 N 个 pid · 扁平 SSOT</td></tr>
<tr><td><code>pid</code></td><td>RUNTIME（临时）</td><td><code>/proc/{pid}/</code></td><td>一次运行句柄 · exit 即 reap · TaskSpec/Context 落此</td></tr>
</table>

<h3>AgentSpec 字段 → matrix 物理落点</h3>
<pre class="code">interface AgentSpec {
  id: string; version: string; displayName: string
  owner: { orgId: string; departmentId?: string; userId?: string; teamId?: string }
  runtime: {
    type: 'declarative' | 'programmatic'
    declarative?: { instructionRef: string; harness: string }
    programmatic?: { language: string; packageRef: string; entry: string; sandboxProfile: string }
  }
  requires: { skills: string[]; mcpServers: string[]; permissions: string[]; models: string[] }
  contract: { input: JsonSchema; output: JsonSchema }
  governance: {
    status: 'draft'|'pending'|'approved'|'disabled'|'revoked'
    riskLevel: 'low'|'mid'|'high'; dataClassification: string
    signedBy?: string[]; did?: string; imageDigest?: string
  }
}</pre>
<table>
<tr><th>AgentSpec 字段</th><th>matrix 物理落点</th><th>说明</th></tr>
<tr><td><code>id / version / displayName</code></td><td><code>/agents/{name}/</code> + <code>config.toml</code></td><td><code>agent-name</code> = 目录名 = 持久 principal</td></tr>
<tr><td><code>owner{...}</code></td><td><code>config.toml</code> + session <code>owner</code> 属性</td><td>身份 + 默认策略（隔离 = policy 非 path）</td></tr>
<tr><td><code>runtime.declarative.instructionRef</code></td><td><code>/agents/{name}/prompts/</code></td><td>声明式 harness 的 prompt</td></tr>
<tr><td><code>runtime.programmatic.packageRef / entry</code></td><td>OCI image/package + <code>imageDigest</code></td><td>代码 Agent 制品（沙箱构建/扫描/签名）</td></tr>
<tr><td><code>requires.skills</code></td><td><code>/agents/{name}/skills/</code></td><td>—</td></tr>
<tr><td><code>requires.mcpServers / models / permissions</code></td><td><code>config.toml</code></td><td>能力声明 → 运行期由 SudoRouter/MCP gateway 收口</td></tr>
<tr><td><code>contract.input / output</code></td><td>校验 <code>TaskSpec.input</code> / <code>output_schema</code></td><td>运行期契约（JsonSchema）</td></tr>
<tr><td><code>governance.status / riskLevel / dataClassification</code></td><td><code>config.toml</code> + 治理面</td><td>七道关卡的输入</td></tr>
<tr><td><code>governance.did / imageDigest / signedBy</code></td><td>可寻址身份 + 签名</td><td>委派身份 / 供应链证明</td></tr>
</table>
<div class="align">
<b>强制基准</b>：任何 AgentSpec/Registry/Session 的实现，<b>存储必须落到 matrix 定义的路径与结构</b>（<code>agent-name</code> · 扁平 <code>/sessions/</code> · <code>owner</code> · DT_LINK），不得另起一套存储。matrix（<code>sudocode/docs/design/agent-context-storage-matrix.html</code>）是 context/memory/session/storage 的唯一物理 SSOT；本文只定义产品语义层如何落到它上面。
</div>

<h2>五、六个产品契约与物理落点</h2>
<p>六契约是 ACP/MCP/WebSocket/IPC <b>之上</b>的产品语义层（跨产品对象模型 + 可治理语义），不替代传输层。短期把现有 bridge/API 返回值逐步包进版本化 schema（Zod → <code>@sudo/contracts</code> → Platform 契约注册中心）；semver，breaking = major bump，CI 加 schema 兼容性检查。</p>
<table>
<tr><th>契约</th><th>作用</th><th>matrix 物理落点</th><th>层</th></tr>
<tr><td><b>TaskSpec</b></td><td>描述一个可执行任务</td><td><code>/proc/{pid}/</code>（+ session 关联）</td><td>runtime</td></tr>
<tr><td><b>Tool Protocol</b></td><td>统一工具调用格式</td><td><code>/tools/</code> + <code>/skills/</code> + MCP gateway</td><td>image/runtime</td></tr>
<tr><td><b>Context Protocol</b></td><td>上下文注入/压缩/剥离</td><td><code>/proc/{pid}/</code> 组装（<code>memory_refs</code>→memory/，<code>workspace_manifest</code>→workspace/）</td><td>runtime</td></tr>
<tr><td><b>Memory Protocol</b></td><td>Agent 记忆读写</td><td><code>/agents/{name}/memory/</code>（4 类 + team via zone raft）</td><td>image</td></tr>
<tr><td><b>Verify Protocol</b></td><td>结果验收与评分</td><td><code>/sessions/&lt;sid&gt;/transcript</code>（<code>evidence_refs</code>）</td><td>session</td></tr>
<tr><td><b>Event/Trace</b></td><td>事件流/执行轨迹/观测</td><td><code>/sessions/&lt;sid&gt;/transcript.jsonl</code></td><td>session</td></tr>
</table>
<div class="align">
<b>后训练线（回应"这张表用来做什么"）</b>：Verify + Event/Trace 两个契约共同定义<b>后训练友好的存储格式</b> —— 把执行轨迹 + 可验证 reward 存成能直接喂后训练的形态。它落在 session transcript（扁平 SSOT），因此后训练数据天然可跨 agent/跨 session 检索（隔离 = policy 非 path）。这与 AgentSpec/Registry 是正交的两条线，通过 session 层交汇。
</div>

<h2>六、代码库归属（订正版）</h2>
<p>基于真实 repo 底账订正武鹏 Ch6 的目标归属命名。权威「repo → 责任人」表见组织文档 §0；本表只做「现有代码 → 目标产品」映射。</p>
<table>
<tr><th>现有代码位置</th><th>目标归属（订正）</th><th>动作</th></tr>
<tr><td><code>sudowork/src/renderer/</code></td><td>SudoWork UI</td><td>keep</td></tr>
<tr><td><code>sudowork/src/webserver/</code></td><td><b>Atlas</b>（原 SudoServer 平面）</td><td>模块化 server runtime/auth/registry client/task queue → 下沉</td></tr>
<tr><td><code>sudowork/src/agent/acp/</code></td><td>共用 Harness client</td><td>抽 <code>@sudo/harness-client</code></td></tr>
<tr><td><code>sudowork/src/channels/</code></td><td>IM 接入层</td><td>抽 <code>@sudo/channels</code> 供 Atlas/SaaS 复用</td></tr>
<tr><td><code>moss/src/server/agentStore.ts</code></td><td><b>Atlas</b> 中控（原 SudoMOSS 平面）Agent Registry</td><td>重构为 AgentSpec-based registry</td></tr>
<tr><td><code>moss/src/server/sessionManager.ts</code></td><td><b>Atlas</b> Session/Task/Workspace/Artifact</td><td>拆分 + 对齐 matrix</td></tr>
<tr><td><code>moss/assistants/*</code></td><td>声明式内置 Agent</td><td>迁移到 AgentSpec</td></tr>
<tr><td><code>nova-gateway/</code></td><td><b>SudoRouter</b></td><td>扩展内网态/DLP/上下文收口</td></tr>
<tr><td><code>nexus/</code>（nexi-lab）</td><td>L0 基座</td><td>扩展 VFS/identity/rebac/delegation/vault/sandbox</td></tr>
<tr><td><code>sudocode/</code></td><td>核心 code agent 引擎</td><td>独立仓，对齐 AgentSpec/ACP/matrix</td></tr>
</table>

<h2>七、文档与 SSOT 边界</h2>
<p>多文档明确唯一职责，互相 reference 不复制：</p>
<table>
<tr><th>文档</th><th>角色 / 边界</th><th>落位</th><th>是谁的 SSOT</th></tr>
<tr><td><b>本文</b>（产品架构说明书）</td><td>跨全家族技术架构</td><td><code>sudo-stack</code></td><td>产品分层 · 契约口径 · AgentSpec 语义</td></tr>
<tr><td>agent-context-storage-matrix</td><td>Agent 存储金标准（物理）</td><td><code>sudocode/docs/design</code></td><td>context/memory/session/storage 物理模型</td></tr>
<tr><td>sudocode 接入 PRD</td><td>sudocode 如何落地 matrix（适配设计）</td><td><code>sudocode/docs/design</code></td><td>sudocode 适配层实现</td></tr>
<tr><td>sudo-code-roadmap</td><td><b>路线图 / 优先级（≠设计）</b></td><td>shareone</td><td>时间 · 优先级排序</td></tr>
<tr><td>组织重组方案</td><td>组织 · 编制 · repo 责任 · 部署拓扑</td><td>leader-only</td><td>repo→责任人 · 编制 · 信任域</td></tr>
</table>

<h2>八、演进路线（订正命名，简述）</h2>
<ul>
<li><b>Phase A · MVP</b>：托管 Runtime + 企业治理 MVP —— 本地/云端任务入口、AgentSpec Registry、六契约 schema 化、TaskExecutionResolution 可审计。</li>
<li><b>Phase B</b>：企业治理深度增强 —— 委派身份（Agent token/短期凭证/tool scope）、Trace/Audit 深化。</li>
<li><b>Phase C</b>：容器化 Runtime + 代码 Agent —— 沙箱升级（<b>gVisor</b>：用户态内核/syscall 拦截，跑不可信 agent 代码，涉密/企业值得，代价是启动/性能）、OCI image + 签名/SBOM。</li>
<li><b>Phase D</b>：完整企业治理 + 数据飞轮 —— 委派 DID、撤销/轮换、后训练数据闭环（Verify+Event-Trace）。</li>
</ul>

<p class="foot-note">订正版 v2.0 · 基于武鹏 v1.4 + agent-context-storage-matrix + v4.4 命名口径 · 落 sudoprivacy/sudo-stack · sudowork-win-pc-3</p>
'''

BODY = BODY.replace('__LAYERS__', layers_svg).replace('__CONS__', cons_svg)

TPL = '''<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sudo 产品架构说明书（订正版 v2.0）</title><base target="_blank">
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
pre.code{background:#0b1017;color:#cfe0f6;border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto;font-family:Consolas,monospace;font-size:12.5px;line-height:1.6;}
pre.code .c{color:#9fe0c0;}
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
io.open(os.path.join(BASE, 'arch_native.html'), 'w', encoding='utf-8').write(html)
print('layers svg:', len(layers_svg), '| cons svg:', len(cons_svg), '| total html:', len(html))
