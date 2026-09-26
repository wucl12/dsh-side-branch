/**
 * 契约自检：不需要 DSH 运行时，直接加载宿主半并用假 ctx 调 `apply()`。
 *
 * 它守的是**只读承诺与安装契约**这几处最容易改坏的地方：
 *   ① 模块能加载、导出名与 `package.json` 一致、路由前缀是 `/side-branch`、卸载 disposer 可调用；
 *   ② 只读白名单仍是那六个工具名，两个白名单常量没有分叉，名单不可配置
 *      （客户端没有工具开关的残留、宿主不接受客户端提交的工具名单）；
 *   ③ guard 的形状没被改坏 —— 这一项是**源码级正则断言**（见下），不是真的拦截验证；
 *   ④ 客户端 bundle 存在、inject 仍是那五个服务名、不含调试导出；
 *   ⑤ `package.json` 与 `cordis.patch.yml` 的包名一致，且 `dsh.client.inject` 里
 *      每个包名在本机 DSH 安装目录里真实存在（用 `DSH_INSTALL_DIR` 指定路径，找不到就跳过）；
 *   ⑥ **归档闸对策**的形状没被改坏（DSH ≥ 0.1.7-rc.1 会拒掉已归档会话的模型步，
 *      本插件靠归档来隐藏侧会话 ⇒ 必须"跑前解锁、跑完回藏"，且解锁必须**特性探测**）。
 *
 * ⚠️ 它**不验证**回答质量、真实 guard 拦截、SSE 逐词流式与界面 —— 那些必须在真宿主里跑。
 *
 * 用法：`node scripts/smoke.mjs`
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const problems = []
const check = (ok, label) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) problems.push(label)
}
const warn = (label) => console.log(`SKIP  ${label}`)

// ─────────────────────────────────────────── 宿主半
const mod = await import(pathToFileURL(join(root, 'lib/index.js')).href)
check(mod.name === 'dsh-side-branch', `导出 name === 'dsh-side-branch'（实际 ${mod.name}）`)
check(Array.isArray(mod.inject) && mod.inject.includes('webServer'), 'inject 含 webServer')
check(Array.isArray(mod.inject) && mod.inject.includes('connection'), 'inject 含 connection（信任栅栏）')
check(typeof mod.apply === 'function', '导出 apply 函数')

/** 只读承诺的白名单。改这里必须同时想清楚 README 与 AGENTS.md 里的说法。 */
const EXPECTED_ALLOWED = ['read', 'glob', 'grep', 'web_search', 'web_fetch', 'lsp']

const routes = []
const effects = []
const disposers = []
const ctx = {
	agents: { list: () => [] },
	webServer: {
		register(route) {
			routes.push(route)
			return () => {}
		},
	},
	connection: {},
	get: () => undefined,
	on: () => {},
	effect(fn, label) {
		effects.push(label)
		const off = fn()
		if (typeof off === 'function') disposers.push(off)
	},
}

mod.apply(ctx)

const prefixRoutes = routes.filter((r) => r.kind === 'prefix')
check(prefixRoutes.length === 1, `注册了 1 条 prefix 路由（实际 ${prefixRoutes.length}）`)
check(prefixRoutes[0]?.path === '/side-branch', `路由前缀为 /side-branch（实际 ${prefixRoutes[0]?.path}）`)
check(typeof prefixRoutes[0]?.handler === 'function', '路由带 handler')
check(effects.length >= 2, `注册了卸载 effect（实际 ${effects.length}）`)

for (const off of disposers) off()
check(true, '所有 disposer 可安全调用')

// ─────────────────────────────────────────── 只读白名单
const hostSource = readFileSync(join(root, 'lib/index.js'), 'utf8')
const clientSource = readFileSync(join(root, 'lib/client.js'), 'utf8')

const hostAllowed = /const ALLOWED_TOOLS = new Set\(\[([^\]]*)\]\)/.exec(hostSource)?.[1]
const hostChoices = /const TOOL_CHOICES = \[([^\]]*)\]/.exec(hostSource)?.[1]
const names = (raw) => (raw ?? '').match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? []

check(
	JSON.stringify(names(hostAllowed)) === JSON.stringify(EXPECTED_ALLOWED),
	`ALLOWED_TOOLS 仍是六个预期工具名（实际 ${names(hostAllowed).join(',') || '未匹配到'}）`,
)
check(
	JSON.stringify(names(hostChoices)) === JSON.stringify(EXPECTED_ALLOWED),
	`TOOL_CHOICES 与 ALLOWED_TOOLS 一致（实际 ${names(hostChoices).join(',') || '未匹配到'}）`,
)
for (const forbidden of ['run_code', 'subagent', 'workflow', 'ralph', 'bash', 'pwsh', 'write', 'edit', 'session_query']) {
	check(!names(hostAllowed).includes(forbidden), `白名单不含 ${forbidden}`)
}

// 插件**不提供**"用户自选可用工具"的设置。若有人把这份开关加回来，下面三条会响。
check(
	!/TOOL_CHOICES_FALLBACK|settingsTools|panel\.setTools/.test(clientSource),
	'客户端没有工具开关的残留（名单不可配置）',
)
check(
	!/settings\.tools|SETTINGS_FIELD_TOOLS/.test(hostSource),
	'宿主不接受客户端提交的工具名单（名单不可配置）',
)
check(
	/return fill\(PROMPT_TEXT\.notice, \{ tools: TOOL_CHOICES\.join\(' \/ '\) \}\)/.test(hostSource),
	'分支引导词的工具名单直接来自常量',
)
// ★ 推给模型的文本一律英文，且**只写一份**（`PROMPT_TEXT`），zh/en 两张表都只是引用它。
// 这一节同时守住两件事：别把引导词 / 拒绝理由翻译回中文；别在两张表里各写一份导致漂移。
const promptBlock = /const PROMPT_TEXT = \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
const promptCode = (promptBlock ?? '').replace(/\/\/[^\n]*/g, '')
check(promptBlock !== undefined, 'PROMPT_TEXT 存在（模型可见文本的唯一来源）')
check(
	promptCode !== '' && !/[\u4e00-\u9fff]/.test(promptCode),
	'PROMPT_TEXT 全是英文（引导词 / PTC 变体 / 拒绝理由不随界面语言）',
)
check(
	(hostSource.match(/PROMPT_TEXT\.(notice|ptcNotice|denyReason)/g) ?? []).length >= 6,
	'zh/en 两张表都引用 PROMPT_TEXT（不各写一份）',
)
// 放行名单从**两个方向**守住：常量本身那六个名字（上面），以及 guard 只有一个判据。
check(!/allowedTools|conv\.tools|SETTINGS_FIELD_TOOLS/.test(hostSource), '宿主没有"按段/按设置"的工具名单残留（判据只有插件级常量）')

// ─────────────────────────────────────────── guard 真的按名字拒
// `createConversation` 是内部函数、只经 `/start` 触发，装一个真宿主才能端到端驱动它。
// 这里退一步做源码级断言：守的是"改坏 guard 的形状"这类事故（例如把判据从
// `allowedSet.has(名字)` 改成放行、或把 guard 挂到全局 ctx 上）。
const guardBody = /tools\.guard\(\(exec\) => \{[\s\S]{0,600}?\n\t+?\}\)/.exec(hostSource)?.[0]
check(guardBody !== undefined, 'guard 回调存在')
check(
	guardBody !== undefined && /allowedSet\.has\(toolName\)/.test(guardBody),
	'guard 判据是 allowedSet.has(名字)（按名单放行）',
)
check(guardBody !== undefined && /return T\.denyReason/.test(guardBody), 'guard 对名单外返回拒绝理由')
check(
	/const setup =|setup: \(agentCtx\) => \{/.test(hostSource) && /softGet\(agentCtx, 'tools'\)/.test(hostSource),
	'guard 注册在 setup(agentCtx) 里（只作用于该 Agent）',
)
check(
	/throw new Error\(T\.guardUnavailable\)/.test(hostSource),
	'拿不到 guard 时 fail-loud（不静默降级成可写）',
)
const guardSites = (hostSource.match(/const tools = softGet\(agentCtx, 'tools'\)/g) ?? []).length
check(guardSites >= 2, `开段与唤醒两条路径都重新挂 guard（找到 ${guardSites} 处）`)

// ─────────────────────────────────────────── 归档闸对策（DSH ≥ 0.1.7-rc.1）
// 0.1.7-rc.1 起 `dsh-api-session-controller` 的 `ArchivedSessionGate` 会拒掉**已归档会话**的任何
// 模型步（pre-step ⇒ reject ⇒ 轮次以 `reason: 'blocked'` 收口，连模型请求都不发出）。
// 本插件用"归档"把侧会话从会话列表里藏起来 ⇒ 必须"跑前解锁、跑完回藏"。
// ⚠️ `unarchiveSession` 是 **0.1.6-alpha.2** 才出现的方法：**硬调会让 0.1.5-rc.2 抛错**，
//    所以这一节同时守住"必须特性探测"这条兼容性红线。
const releaseBody = /async function releaseArchiveGate\(conv\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
const rehideBody = /async function rehideAfterTurn\(conv\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
const finishBody = /function finishJob\(job\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
check(
	/typeof registry\.unarchiveSession === 'function'/.test(hostSource),
	'unarchiveSession 经特性探测后才调用（0.1.5-rc.2 没有这个方法）',
)
check(releaseBody !== undefined, 'releaseArchiveGate 存在')
check(rehideBody !== undefined, 'rehideAfterTurn 存在')
check(
	releaseBody !== undefined && /unarchiveSession\(conv\.childId\)/.test(releaseBody),
	'开跑前解锁：releaseArchiveGate 调 unarchiveSession(childId)',
)
check(
	releaseBody !== undefined && !/\bthrow\b/.test(releaseBody),
	'解锁失败只记日志不抛（这一轮照常尝试，真实原因回到面板）',
)
check(
	rehideBody !== undefined && !/\bthrow\b/.test(rehideBody) && /ARCHIVE_RETRY_DELAYS_MS/.test(rehideBody),
	'跑完回藏：rehideAfterTurn 有界退避重试且不抛（归档要求会话空闲）',
)
check(
	finishBody !== undefined && /rehideAfterTurn\(conv\)/.test(finishBody),
	'回藏挂在 finishJob（单轮所有终态的唯一收尾路径，不会漏）',
)
const unlockAt = hostSource.indexOf('await releaseArchiveGate(conv)')
const followupAt = hostSource.indexOf('conv.child.followup(')
check(
	unlockAt > 0 && followupAt > 0 && unlockAt < followupAt,
	'解锁排在 followup 之前（顺序反了＝没解锁，0.1.7 上照样被闸）',
)
check(
	/await registry\.archiveSession\(childId\)/.test(hostSource),
	'建段仍然先归档（空闲时侧会话不出现在会话列表/工作区里）',
)

// ─────────────────────────────────────────── 路由与事件契约
// 路径在、方法不对 ⇒ 405 + `Allow`（不是 404）。六条路由一个都不能从表里掉。
for (const [suffix, method] of [
	['/start', 'POST'],
	['/stream', 'GET'],
	['/stop', 'POST'],
	['/close', 'POST'],
	['/settings', 'GET, POST'],
]) {
	check(
		new RegExp(`\\[ROUTE_PREFIX \\+ '${suffix}'\\]: '${method}'`).test(hostSource),
		`ROUTE_METHODS 里有 ${suffix}（${method}）`,
	)
}
// SSE 事件名是客户端与宿主之间的字面契约：两边的事件名集合必须**完全一致**
// （少一个客户端就永远等不到那一帧；多一个说明客户端在等一个宿主不发的名字）。
const hostEvents = new Set([
	...[...hostSource.matchAll(/emitJob\(job,\s*'([a-z]+)'/g)].map((m) => m[1]),
	// `snapshot` 不走 `emitJob`（它是连上时直接回放的那一帧）
	...[...hostSource.matchAll(/send\('([a-z]+)'/g)].map((m) => m[1]),
])
const clientEvents = new Set([...clientSource.matchAll(/\bon\('([a-z]+)'/g)].map((m) => m[1]))
check(hostEvents.size > 0, `宿主推的 SSE 事件名可提取（${[...hostEvents].join(',')}）`)
check(
	JSON.stringify([...hostEvents].sort()) === JSON.stringify([...clientEvents].sort()),
	`宿主推的事件与客户端监听的事件完全一致（宿主 ${[...hostEvents].sort().join(',')} / 客户端 ${[...clientEvents].sort().join(',')}）`,
)
// `/start` 的响应字段：客户端靠它们决定"重开一段"与"不画分隔线"。
for (const field of ['handoff', 'conversationGone', 'contextFull']) {
	check(hostSource.includes(field), `宿主 /start 契约里有 ${field}`)
}

// ─────────────────────────────────────────── 0.2.0 · Re-Fork 架构
//
// 一句话规则：**每一轮追问都用主会话最新的已结算前缀当种子，再把侧枝自己的对话重放进去**。
// 这一节守的是这套架构最容易被"优化"坏的三处：判据、重放白名单、交接顺序。
const reforkBody = /async function reForkConversation\(ctx, parent, oldConv, effective, locale\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
const shouldBody = /function shouldReFork\(conv, parent, effective\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
const replayBody = /function replaySideHistory\(conv, events\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]

check(shouldBody !== undefined, 'shouldReFork 存在')
check(reforkBody !== undefined, 'reForkConversation 存在')
check(replayBody !== undefined, 'replaySideHistory 存在')

// 判据必须**同时**含"主会话多了已结算回合"与"模型变了"两条：
// 少了后者 ⇒ 用户换完模型那一轮会继续用旧模型（静默忽略用户的选择）。
check(
	shouldBody !== undefined && /sameAgentOptions\(conv\.model, effective\)/.test(shouldBody),
	'shouldReFork 把"换模型"也算作要 re-fork（缺了它 = 用户选的模型被静默忽略）',
)
check(
	shouldBody !== undefined && /completedTurnPrefixLength\(/.test(shouldBody) && /conv\.parentCut/.test(shouldBody),
	'shouldReFork 比对主会话"已结算前缀"与建段时记下的 parentCut',
)

// `parentCut` 必须在**建段时**就写好：只在 re-fork 里赋值的话，新开的那一段第一轮追问
// `completedTurnPrefixLength(...) > undefined` 恒为真 ⇒ 每轮都白 re-fork 一次。
check(
	/conversation = \{[^]*?parentCut,/.test(hostSource),
	'createConversation 建段时就记下 parentCut（否则每轮都会白 re-fork）',
)
check(/parentCut: conv\.parentCut/.test(hostSource) && /parentCut: record\.parentCut/.test(hostSource), '睡觉/唤醒都带着 parentCut')

// 重放白名单：只能是那 5 种 surface 事件（`turn/start`、`step/start`、`tool/call` 之类是纯日志事件，
// `append` 它们会抛）。
check(
	replayBody !== undefined && /REPLAYABLE = new Set\(\[[^\]]*'system\/message'[^\]]*'developer\/message'[^\]]*'user\/message'[^\]]*'assistant\/message'[^\]]*'tool\/result'[^\]]*\]\)/.test(replayBody),
	'replaySideHistory 有 surface 事件白名单（且正好是那五种）',
)
check(
	replayBody !== undefined && !/turn\/start|step\/start|tool\/call|request\/header/.test(replayBody),
	'replaySideHistory 不重放纯日志事件（append 它们会抛）',
)
// 数据必须传 `event.data` 原样（`assistant/message` 内嵌真实 provider 流，手搓必被拒）。
check(
	replayBody !== undefined && /append\(event\.type, event\.data, \{ surfaceOp: 'append' \}\)/.test(replayBody),
	'replaySideHistory 传 event.data 原样（不手搓消息）',
)
// ⛔ 绝不能"顺手补全" `sourceEventSeqs`：那是**旧会话**的 callSeq，抄过来会抛
// "sourceEventSeqs must reference earlier events"。这一条是 0.2.0 实现时踩过的坑。
check(
	replayBody !== undefined && !/sourceEventSeqs/.test(replayBody.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
	'replaySideHistory 不复制 sourceEventSeqs（外来的 callSeq 会让 append 抛错）',
)
// 不做截断：到上限就拒绝（"拒绝是显式失败，截断是隐式失真"）。
check(
	replayBody !== undefined && !/\.slice\(0,|MAX_|limit/i.test(replayBody.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
	'replaySideHistory 不截断侧枝历史（到上限由 /start 的估算闸拒绝，不静默丢）',
)

// ★ 顺序纪律：**先重放成功，再释放老会话**。反了就没有退路（老会话没了、新的没历史）。
const replayAt = hostSource.indexOf('const replayed = replaySideHistory(next, sideOwn)')
const closeOldAt = hostSource.indexOf("closeConversation(oldConv,")
check(
	replayAt > 0 && closeOldAt > 0 && replayAt < closeOldAt,
	'先重放成功、再释放老会话（顺序反了就没有退路）',
)
check(
	reforkBody !== undefined && /void closeConversation\(next,/.test(reforkBody),
	'重放失败时丢弃**刚建的新会话**（老会话原样保留、本轮拒绝）',
)
// 老那套"换模型 ⇒ 带历史换段"必须彻底消失（re-fork 是唯一的换段路径）。
check(
	!/createConversation\(ctx, parent, effective, conv\.child\.session/.test(hostSource) && !/seedSource \?\?/.test(hostSource),
	'旧的"换模型带历史换段"（seedSource）已删除',
)
// re-fork 每轮都换 id ⇒ 必须每轮回 `handoff: true`，否则客户端每轮都会画一条分隔线。
check(
	/handedOff = true/.test(hostSource) && /handedOff \? \{ handoff: true \}/.test(hostSource),
	'每轮 re-fork 都回 handoff: true（客户端因此不画"新的一段"分隔线）',
)

// 上限改成**估算**：re-fork 之后新会话还没有 usage，老那套 `conv.lastContextTokens` 不存在。
check(/function estimateRequestTokens\(/.test(hostSource), 'estimateRequestTokens 存在（re-fork 后没有 usage 可读）')
check(
	/function lastPromptTokensOf\(/.test(hostSource) && /inputTokens/.test(hostSource),
	'上限估算的"父前缀"那一半取父会话日志里最后一条 assistant/message 的 usage（父 Agent 上没有 lastContextTokens）',
)
check(
	!/typeof conv\.lastContextTokens === 'number' && conv\.lastContextTokens >= limit/.test(hostSource),
	'不再用 re-fork 后必然为 undefined 的旧判据（conv.lastContextTokens）',
)

// ─────────────────────────────────────────── 0.2.0 · 多段回答（修"只剩最后一段"）
const jobBody = /function createJob\(fields\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
check(jobBody !== undefined && /segments: \[\]/.test(jobBody), 'job 有有序段落 segments（不再只有 text/reasoning 两个字符串槽位）')
check(
	/const isRetry = sameStep && job\.lastAttemptId !== undefined && frame\.attemptId !== job\.lastAttemptId/.test(hostSource),
	"'start' 帧按 turn/step 分流：同 step 不同 attemptId 才算重试",
)
check(
	/else if \(!sameStep\) \{/.test(hostSource) && /emitJob\(job, 'segment'/.test(hostSource),
	'step 变了 ⇒ 开新段（emit segment），绝不删旧的',
)
check(
	!/job\.attempts/.test(hostSource),
	"'attempts'（把新 step 也当成重试）已拆成 steps/retries，语义不再错",
)
check(
	!/job\.text = final/.test(hostSource) && /replaceCurrentSegment\(job, 'text', final\)/.test(hostSource),
	'终局文本只替换**当前段**（老代码整段替换会把前面几段一起覆盖）',
)
check(
	/segments: segmentsOf\(job\)/.test(hostSource) && /function segmentsOf\(job\) \{/.test(hostSource),
	'snapshot / 终态载荷都带 segments（否则刷新后多段又没了）',
)
check(/function syncSegmentShortcuts\(job\) \{/.test(hostSource), 'text/reasoning 是段落数组的**纯函数**（不可能与 segments 漂移）')
check(
	/const REPLAYABLE = new Set/.test(hostSource) && /const SEGMENT_KINDS = new Set\(\['reasoning', 'text', 'tool'\]\)/.test(clientSource),
	'客户端也认识三种段落 kind（与宿主同源）',
)
check(
	/normalizeSegments\(round\.segments, answer, reasoning\)/.test(clientSource),
	'客户端 normalizeRound 由老数据的 answer/reasoning 合成段落（刷新后老面板不变空）',
)
check(
	/Array\.isArray\(round\.segments\) \? round\.segments : \[\]/.test(clientSource) && /segments\.forEach\(/.test(clientSource),
	'客户端按段落数组顺序渲染（思考 → 正文 → 工具 → 思考 → 正文）',
)
check(
	!/'panel\.toolPrefix' \+ round\.tool/.test(clientSource),
	'客户端不再用单槽位 round.tool 渲染（工具已是段落序列的一员）',
)

// ─────────────────────────────────────────── 引用随轮入档
// ★ 引用原文以前**只进 prompt 信封**：面板上只显示问题原文，所以"这一轮引用了什么"
//   在记录里查不到；而且引用槽会一直挂着（下一轮还在，得手动点 × 或「清空」）。
//   现在：发送时把引用**随这一轮入档**（渲染成可折叠引用块）后**自动清空引用槽**。
check(
	/const reference = quoted === '' \? '' : clipReference\(quoted\)\.text/.test(clientSource),
	'引用原文只收窄一次：同一份既进 prompt 信封、又进这一轮记录（两者逐字一致）',
)
check(
	/question: text,[\s\S]{0,500}?\n\t{5}reference,/.test(clientSource),
	'新的一轮把引用原文记进 rounds[]（reference 字段）',
)
check(
	/rounds: \[\.\.\.rounds, round\], jobId: null \}\)[\s\S]{0,500}?quoteBus\.clear\(sessionId, paneId\)[\s\S]{0,80}?setQuote\(''\)/.test(clientSource),
	'点发送后引用槽自动清空（且连 quoteBus 一起清，重挂载不会把同一份引用捞回来）',
)
check(
	/reference: clampString\(round\.reference, MAX_REFERENCE_LENGTH \+ 64\)/.test(clientSource),
	'normalizeRound 保留 reference（刷新后引用块还在）',
)
check(
	/round\.reference !== ''[\s\S]{0,400}?dsh-side-branch-refblock[\s\S]{0,400}?dsh-side-branch-refbody/.test(clientSource),
	'轮次里渲染可折叠引用块（refblock 折叠 + refbody 正文）',
)
check(
	/'panel\.referenceChip': '引用原文/.test(clientSource) && /'panel\.referenceChip': 'Quoted text/.test(clientSource),
	'引用块文案在 zh / en 两张表里各有一份（都是真文案，不是占位）',
)

// ─────────────────────────────────────────── 0.2.0 · 层 1 / 层 2（继承与注入可见）
check(
	new RegExp(`\\[ROUTE_PREFIX \\+ '/inherited'\\]: 'GET'`).test(hostSource),
	'ROUTE_METHODS 里有 /inherited（GET）—— 不登记的话错方法会掉进 404，破坏 405 + Allow 契约',
)
check(/function handleInherited\(ctx, url, res\) \{/.test(hostSource), 'handleInherited 存在（只读路由的实现）')
check(
	/const INHERITED_LAST_TURN_CHARS/.test(hostSource) && /const INHERITED_EARLIER_TURN_CHARS/.test(hostSource),
	'继承内容：最后一轮全文 + 更早每轮一行摘要（服务端截断，不调模型）',
)
// ⛔ 继承历史**绝不能进面板持久化状态**：一份主会话前缀可能几十万字符，
//    而面板状态走 sessionStorage（5–10 MB 配额），塞进去会立刻爆配额、坏掉"刷新不丢"。
check(
	/normalizeRound = \(raw\) => \{[\s\S]*?\n\t{3}\}/.test(clientSource) && !/inherited/i.test(/const normalizeRound = \(raw\) => \{[\s\S]*?\n\t{3}\}/.exec(clientSource)?.[0] ?? ''),
	'继承内容不进 normalizeRound（只放内存，否则会爆 sessionStorage 配额）',
)
check(
	/react\.useState\(null\)[\s\S]{0,200}inherited/.test(clientSource),
	'继承内容只放在组件内存态（useState），按需拉取',
)
check(
	/panel\.inheritedLine/.test(clientSource) && /panel\.noticeLine/.test(clientSource),
	'面板有「已继承 N 轮」那一行与「注入的分支引导词」折叠区',
)
check(
	/synced: started\.synced|started\?\.synced/.test(clientSource) && /notice: started\.notice|started\?\.notice/.test(clientSource),
	'客户端接收并保存 synced / notice',
)
// ★ 「问」只能取这一轮的**第一条** `user/message`：DSH 自己会在用户那条之后追加一条上千字的
//   运行期快照（`Current runtime context…`），逐条拼起来会把平台样板文字当成"用户问的话"显示，
//   字数也被撑大好几倍（实测把一句 8 字的问题显示成 1888 字）。
const turnsBody = /function inheritedTurnsOf\(events, cut\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
check(turnsBody !== undefined && /current\.question === ''/.test(turnsBody), '继承摘要的「问」只取该轮第一条 user/message')
check(turnsBody !== undefined && !/current\.question \+=/.test(turnsBody), '继承摘要不把该轮后续的 user/message 拼进「问」（运行期快照会被当成用户提问）')
const summaryBody = /function synchronizedSummary\(events, cut\) \{[\s\S]*?\n\}/.exec(hostSource)?.[0]
check(
	summaryBody !== undefined && /inheritedTurnsOf\(events, cut\)/.test(summaryBody),
	'「已继承 N 轮 / 约 X 字」与展开出来的内容同源（两处各算一遍必然对不上）',
)
// ★ 划选入口必须排除**本插件自己的面板**：否则在侧枝里划字也会弹「引用并提问」，
//   而那个按钮的语义是"把主会话的原文引用进来" ⇒ 会把这一段自己的内容引用回同一段（自指循环）。
check(
	/const refused = '[^']*\.dsh-side-branch-panel/.test(clientSource),
	'划选入口排除本插件面板（侧枝里划字不再弹「引用并提问」）',
)
check(/const refused = '[^']*\[data-side-branch-menu\]/.test(clientSource), '划选入口排除模型选择悬浮窗')
// ★ 自动滚底必须挂在**可滚动的那一层**（`.dsh-side-branch-scroll`）。
//   挂在轮次列表 `.dsh-side-branch-rounds`（`display:flex`、不滚动）上时 `scrollTop = scrollHeight`
//   是**空操作** —— 现象是"问了之后回答不出现"（其实已在 DOM 里，只是落在可视区外）。
check(
	/const scrollRef = react\.useRef\(null\)/.test(clientSource) && /dsh-side-branch-scroll', ref: scrollRef/.test(clientSource),
	'自动滚底挂在可滚动的那一层（挂在轮次列表上是空操作，答案会落在可视区外）',
)
check(!/answerRef/.test(clientSource), '旧的 answerRef（挂错元素）已删除，别改回去')
check(
	/inheritedOpen,/.test(clientSource),
	'继承区展开/收起也触发重新滚底（它也在滚动容器里，会把下方内容顶出去）',
)
// ★ 主会话的**思考**在种子里，而且 `dsh-llm-deepseek` 会把 assistant 历史的 reasoning 序列化成
//   `{ type: 'thinking' }` 发出去（只有 user / tool-result 内容才丢掉它）⇒ 继承摘要必须算它、
//   面板必须能看见它，否则"约 X 字"是**低报**、用户会以为思考没被继承。
check(/function reasoningOf\(blocks\)/.test(hostSource), 'reasoningOf 存在（主会话的思考也要算进继承）')
check(turnsBody !== undefined && /current\.reasoning \+= reasoningOf\(/.test(turnsBody), '继承摘要收集 reasoning')
check(
	summaryBody !== undefined && /entry\.question\.length \+ entry\.reasoning\.length \+ entry\.answer\.length/.test(summaryBody),
	'「已继承 N 轮 / 约 X 字」把思考算进去（不算就是低报，对不上观感）',
)
check(/reasoningChars: entry\.reasoning\.length/.test(hostSource), '/inherited 每轮带 reasoningChars（面板要显示「思考 N 字」）')
check(/'panel\.inheritedThink'/.test(clientSource), '面板有「思考」那一层折叠（否则看起来像没继承）')

// ─────────────────────────────────────────── 0.2.0 · 启动清理孤儿（§11）
check(/function cleanupOrphanSessions\(/.test(hostSource), 'cleanupOrphanSessions 存在')
check(
	/const SIDE_SESSION_DIR_PATTERN = \/\^side-/.test(hostSource) && /SIDE_SESSION_DIR_PATTERN\.test\(entry\.name\)/.test(hostSource),
	'孤儿判据要求目录名正好是 side-<uuid>（前缀对但形状不对的一律不动、只留痕）',
)
// ★ 实例租约：两个共用同一个 DSH_HOME 的实例同时跑时，B 启动时账本也是空的
//   ⇒ 没有租约就会把 A **正在用的**侧枝目录当孤儿删掉。发现有活着的外来租约必须**整个跳过**。
check(/INSTANCE_DIR_NAME/.test(hostSource) && /instanceLeasePath/.test(hostSource), '有实例租约（side-branch-instances/*.json）')
check(
	/const foreign = live\.filter/.test(hostSource) && /foreign\.length > 0[\s\S]{0,200}return/.test(hostSource),
	'发现别的活着的实例 ⇒ 整个跳过清理（绝不删别的实例正在用的侧枝）',
)
check(
	/function pidAlive\(pid\)/.test(hostSource) && /heartbeatAt/.test(hostSource),
	'租约靠"心跳新鲜 + PID 还活着"判活，过期/进程已死的租约顺手清掉',
)
check(
	/conversations\.size > 0 \|\| sleeping\.size > 0/.test(hostSource) && /本进程已有侧枝记录/.test(hostSource),
	'清理前还有一道保险：本进程已有侧枝记录就跳过（effect 重跑也不会误删）',
)
check(
	/已删除', removed\.length/.test(hostSource) && /for \(const id of removed\) log/.test(hostSource),
	'删除留有清单日志（平台没有会话删除 API，删了什么必须可追溯）',
)
check(
	/await rm\(dir, \{ recursive: true, force: true \}\)/.test(hostSource) && /catch \(error\) \{\s*\n\s*failed\.push/.test(hostSource),
	'单条删除失败只记日志、不影响启动',
)
check(
	/const sessionsRoot = join\(home, 'sessions'\)/.test(hostSource) && /resolve\(dir\)\.startsWith\(rootResolved \+ sep\)/.test(hostSource),
	'清理严格限定在 sessions 根目录下（不许路径逃逸）',
)
check(
	/entry\.name\.startsWith\(SIDE_SESSION_PREFIX\)/.test(hostSource) && !/startsWith\('session-'\)/.test(hostSource),
	'清理只认 side- 前缀，不碰主会话（session-*）',
)

// 客户端 bundle
const clientPath = join(root, 'lib/client.js')
check(existsSync(clientPath), 'lib/client.js 存在（DSH 直接取这个文件，不构建）')
const clientInject = /const inject = \[([^\]]*)\]/.exec(clientSource)?.[1]
const clientInjectNames = clientInject?.match(/'[A-Za-z.]+'/g)?.map((s) => s.slice(1, -1)) ?? []
check(
	JSON.stringify(clientInjectNames) === JSON.stringify(['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'modelDirectories']),
	`客户端 inject 仍是五个服务名（实际 ${clientInjectNames.join(',') || '未匹配到'}）`,
)
check(/id: 'dsh-side-branch'/.test(clientSource), "客户端模块 id 是 'dsh-side-branch'")
check(!/__DSH_SIDE_BRANCH__|dump\s*\(\s*\)/.test(clientSource), '客户端不含调试导出（window 调试口已删）')

// 两条名字各管一处，别混：
//   · **插件名**（包名 / 路由 / CSS / 存储键 / tab kind）= `dsh-side-branch` + `side-branch`
//   · **功能在 UI 里的显示名** = 中文「临时会话」、英文 `Side Ask`
// 曾经把两者一起改成 branch 语义，那是错的：改包名不等于改 UI 名字。下面这几条守住这个分工。
check(/'tab\.title': '临时会话'/.test(clientSource), '界面中文显示名是「临时会话」')
check(/'tab\.title': 'Side Ask'/.test(clientSource), '界面英文显示名是 `Side Ask`')
check(/id: 'dsh-side-branch'/.test(clientSource), '内部标识符仍是插件名 `dsh-side-branch`')
check(/const KIND = 'side-branch'/.test(clientSource), '侧栏 tab kind 仍跟插件名走')
// 显示名不该漂成「侧枝会话」：它只在内部描述里出现，不能出现在 UI 词典的取值里。
check(
	!/': '[^']*侧枝/.test(clientSource),
	'UI 词典的取值里不含「侧枝」（内部描述性措辞不算）',
)

// ─────────────────────────────────────────── package.json 与依赖核验
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
check(pkg.name === 'dsh-side-branch', `package.json name 与导出名一致（${pkg.name}）`)
check(pkg.private !== true, 'package.json 不是 private（可发布）')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json 声明了 bundle patch')
check(pkg.dsh?.client?.platform === 'web', 'package.json 声明了 web 客户端半')
check(existsSync(join(root, 'cordis.patch.yml')), 'cordis.patch.yml 存在')
const patchText = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
check(new RegExp(`name:\\s*'${pkg.name}'`).test(patchText), 'cordis.patch.yml 的 name 与包名一致')

// `dsh.client.inject` 里的每个包名必须在 DSH 安装目录里真实存在。
// 路径取自本机已安装的 dsh；找不到就跳过（脚本要能在纯仓库里跑）。
const dshBase = process.env.DSH_INSTALL_DIR ?? (() => {
	const candidates = [
		join(process.env.APPDATA ?? '', 'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'),
	]
	return candidates.find((p) => existsSync(p))
})()
if (dshBase === undefined) {
	warn('找不到 DSH 安装目录 ⇒ 跳过 dsh.client.inject 的存在性核验（可用 DSH_INSTALL_DIR 指定）')
} else {
	const available = new Set(readdirSync(dshBase))
	for (const dep of pkg.dsh?.client?.inject ?? []) {
		const bare = dep.replace(/^@deepseek-ai\//, '')
		check(available.has(bare), `dsh.client.inject 里的 ${dep} 在 DSH 安装目录里存在`)
	}
}

console.log(`\n${problems.length === 0 ? '全部通过' : problems.length + ' 项未通过'}`)
process.exit(problems.length === 0 ? 0 : 1)
