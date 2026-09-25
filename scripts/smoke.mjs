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

// ─────────────────────────────────────────── 客户端 bundle
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
