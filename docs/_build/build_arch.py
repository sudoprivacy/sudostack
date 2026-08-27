# -*- coding: utf-8 -*-
import os, io
BASE = r'C:\Users\songym\cursor-projects\_docssot'
def rd(p): return io.open(os.path.join(BASE, p), encoding='utf-8').read()

modules_svg = rd('arch_modules.svg')
cons_svg    = rd('arch_consolidate.svg')

GH = 'https://github.com/'
def repo(name, org='sudoprivacy', label=None):
    return f'<a href="{GH}{org}/{name}"><code>{label or name}</code></a>'

BODY = '''
<span class="badge">Sudo 产品架构说明书 · 订正版 v2.1</span>
<h1>Sudo 新一代产品架构说明书（订正版）</h1>
<p class="meta">在武鹏 v1.4 基础上订正命名口径、合并 Atlas、把 <b>AgentSpec 与 agent-context-storage-matrix consolidate 成同一套模型</b>，并补齐顶层架构图。本文是跨全家族技术架构 SSOT，落 ''' + repo('sudostack') + '''。开发（PRD + 伪代码）以本文与 matrix 为准。</p>

<div class="align">
<b>本版订正重点（相对武鹏 v1.4）</b>
<ul>
<li><b>命名口径</b>：<b>P2 SudoServer + P3 SudoMOSS 合并为 Sudo Atlas</b>（中控能力来自 base 产品 moss）；P4 SudoRouter 的 repo 是 ''' + repo('nova-gateway') + '''（当前没有 sudorouter repo）；P6 → <b>Sudo SaaS</b>；nexus 在 <b>nexi-lab</b>（跨 org）。</li>
<li><b>先跑通 SaaS</b>：云端任务默认<b>先在我们自己的腾讯云跑通 Sudo SaaS</b>（已有部分服务在上面，方便 demo、立即可运行），作为企业交付前的完整搭建演练；企业交付时<b>同源</b>到 Atlas（私有化）。</li>
<li><b>Agent 统一模型 consolidation（核心）</b>：<b>AgentSpec ≡ matrix 的 image 层 <code>/agents/{name}/</code></b>；且 <code>agent-name</code> 是一张 <b>CA 签发的不可伪造身份</b>（= governance.did）。实现者<b>必须</b>读懂 matrix。</li>
<li><b>三个 ID</b>：<code>agent-name</code>（image/制品/身份）· <code>session-id</code>（持久 <code>--resume</code> key）· <code>pid</code>（一次运行句柄）。"Agent 发布"不是发布一次任务。</li>
</ul>
</div>

<h2>一、顶层架构（模块关系）</h2>
<p>五层：<b>入口</b>（SudoWork UI / IM 渠道 / WebUI）→ <b>中控·编排</b>（moss 中控给人用 · hydra 编排调度 · shareone 协同验收）→ <b>引擎</b>（sudocode，一次运行 = pid + session）→ <b>出口</b>（SudoRouter 模型/工具/凭证收口）→ <b>基座</b>（nexus：VFS 命名空间 + 不可伪造身份 + A2A + AgentRegistry + vault + sandbox）。Mega-product（Atlas/SaaS/SudoEdge）是这些模块的<b>同源装配</b>，部署形态不同。</p>
<div class="dia">__MODULES__</div>
<p class="meta">这是第一版，模块间关系可迭代。存储/协作/身份的 SSOT 统一在 nexus（绿实线）；任务/控制流走蓝实线；凭证/身份面走虚线。</p>

<h2>二、产品组合与 repo</h2>
<p>Mega-product 由 Base product 装配复用（每个 mega 可含多个 base）。owner 与成功标准以下表为准，repo 链到 GitHub；权威「repo→责任人/编制」总表见组织文档 §0。</p>
<table>
<tr><th>Mega / 层</th><th>Base-product（repo）</th><th>owner</th><th>成功标准</th></tr>
<tr><td rowspan="6"><b>Sudo Atlas</b><br>企业私有化<br>（原 Server+MOSS）<br>owner 铁锋<br>repo ''' + repo('sudoatlas') + '''</td>
    <td>''' + repo('sudocode') + ''' · Agent 引擎</td><td>Ethan</td><td>独立 CLI 引擎稳定；对齐 AgentSpec/ACP/matrix；PTY 门禁</td></tr>
<tr><td>''' + repo('nexus','nexi-lab') + ''' + nexus-vfs · 基座</td><td>Ethan</td><td>VFS/身份/session 存储 SSOT；跨节点一致；不可伪造 from</td></tr>
<tr><td>''' + repo('nova-gateway') + ''' = SudoRouter</td><td>张帅</td><td>模型/工具/凭证统一出口；内网 DLP；多模型可路由</td></tr>
<tr><td>''' + repo('moss') + ''' · 中控（给人用）</td><td>待定</td><td>中控体验丝滑；registry/session <b>client</b>（不复制 nexus SSOT）</td></tr>
<tr><td>''' + repo('hydra') + ''' · 编排/调度</td><td>待定</td><td>spawn agent + setup sessions；A2A；与 moss 职责不重合</td></tr>
<tr><td>''' + repo('shareone') + ''' · 协同/验收</td><td>孙文龙</td><td>standalone + 在 sudowork/sudocode 内嵌端到端丝滑；签名交付</td></tr>
<tr><td rowspan="2"><b>Sudo SaaS</b><br>公有云·Atlas 同源<br>owner 铁锋<br>repo ''' + repo('sudosaas') + '''</td>
    <td>= Atlas 全部 base（同源装配）</td><td>—</td><td><b>先在腾讯云跑通</b>完整搭建演练，立即可 demo</td></tr>
<tr><td>+ 编排脑 / 三方接入 connectors</td><td>待定</td><td>锐锢/中资等投标可接入；三方连接器可插拔</td></tr>
<tr><td rowspan="2"><b>SudoEdge</b><br>盒子/离线<br>owner Joe<br>repo ''' + repo('sudoedge') + '''</td>
    <td>Atlas（整体，盒内）</td><td>铁锋</td><td>air-gap 完整交付；SudoFDE 盒内不对外</td></tr>
<tr><td>''' + repo('sudowork') + '''（盒内 UI）</td><td>Joe</td><td>盒内 UI 可用</td></tr>
<tr><td rowspan="2"><b>横向层</b></td>
    <td>''' + repo('sudowork') + ''' · SudoWork 纯 UI</td><td>Joe</td><td>纯 UI（任务/Team/Trace）；Harness=sudocode</td></tr>
<tr><td>SudoGenius · Agent 集</td><td>各作者（FDE=雪涛）</td><td>领域包：本体/规则/资产/eval + 可跑的 eval</td></tr>
<tr><td rowspan="2"><b>可选 base</b><br>（按 Agent 需要挂载）</td>
    <td>''' + repo('ai-dev-browser') + '''</td><td>待定</td><td>中等 agent 驱动中等难度网页探索；探索后写 script 丝滑（tools↔cores 1:1）</td></tr>
<tr><td>''' + repo('password-agent') + '''</td><td>梁燕芝</td><td>凭证/秘钥 vault；plaintext 不进 LLM</td></tr>
</table>
<div class="align">
<b>最重要的产品边界</b>
<ul>
<li><b>SudoWork ≠ 服务端</b>：它是 UI，Agent 是 sudocode；Agent 身份/存储在引擎侧，SudoWork 只读 + 只写自己的 UI 字段。</li>
<li><b>Atlas ≠ 云端</b>：Atlas 是企业私有化，公有云是 SaaS（Atlas 同源）；两者共享全部 base + sudostack 装配。<b>先跑通 SaaS，再同源交付 Atlas。</b></li>
<li><b>SudoRouter 不单独对外</b>：各产品的模型/工具/凭证出口，不是独立售卖的产品。</li>
</ul>
</div>

<h2>三、Runtime 同源与任务路由</h2>
<p>用户侧只出现<b>两个任务入口</b>：本地任务、云端任务。用户不选 runtime；平台按 AgentSpec 的运行需求 + 组织策略 + 数据密级在后台解析，并把结果写入 Trace/Audit（可解释）。</p>
<ul>
<li><b>本地任务</b> → 默认 <b>SudoWork</b> 执行（本机文件/shell/browser/本地凭证/离线路径）。</li>
<li><b>云端任务</b> → <b>先跑通 Sudo SaaS</b>（腾讯云，立即可 demo/运行）；企业内网/强审计场景由组织策略同源到 <b>Atlas</b> 私有化链路（含原 SudoMOSS 治理平面）。</li>
<li>不可执行时给<b>任务级解释</b>（"依赖本地浏览器，不能创建云端任务" / "企业审批未通过"），不做三选一置灰。</li>
</ul>
<pre class="code">type TaskMode = 'local' | 'cloud'

interface TaskExecutionResolution {
  taskMode: TaskMode
  // 先跑通 saas（腾讯云 dogfood），企业交付同源到 atlas（私有化）
  resolvedRuntime: 'sudowork' | 'saas' | 'atlas'
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
<p>六契约是 ACP/MCP/WebSocket/IPC <b>之上</b>的产品语义层，不替代传输层。短期把现有 bridge/API 返回值逐步包进版本化 schema（Zod → <code>@sudo/contracts</code> → 契约注册中心）；semver，breaking = major bump，CI 加兼容性检查。</p>
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
<tr><td><code>sudowork/src/channels/</code></td><td>IM 接入层</td><td>抽 <code>@sudo/channels</code> 供 Atlas/SaaS 复用</td></tr>
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
<li><b>Phase A · MVP</b>：<b>先跑通 SaaS</b>（腾讯云）+ 托管 Runtime + AgentSpec Registry + 六契约 schema 化 + TaskExecutionResolution 可审计。</li>
<li><b>Phase B</b>：企业治理增强 —— 委派身份（agent CA cert / 短期凭证 / tool scope）、Trace/Audit 深化。</li>
<li><b>Phase C</b>：容器化 Runtime + 代码 Agent —— 沙箱升级（<b>gVisor</b>：用户态内核/syscall 拦截，跑不可信 agent 代码，涉密/企业值得）、OCI image + 签名/SBOM。</li>
<li><b>Phase D</b>：完整企业治理 + 数据飞轮 —— 委派 DID、撤销/轮换、后训练闭环（Verify+Event-Trace）。</li>
</ul>

<p class="foot-note">订正版 v2.1 · 基于武鹏 v1.4 + agent-context-storage-matrix + nexus-auth-architecture + v4.4 命名口径 · 落 sudoprivacy/sudostack · sudowork-win-pc-3</p>
'''

BODY = BODY.replace('__MODULES__', modules_svg).replace('__CONS__', cons_svg)

TPL = '''<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sudo 产品架构说明书（订正版 v2.1）</title><base target="_blank">
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
io.open(os.path.join(BASE, 'arch_native.html'), 'w', encoding='utf-8').write(html)
print('modules svg:', len(modules_svg), '| cons svg:', len(cons_svg), '| total html:', len(html))
