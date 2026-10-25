/**
 * 客户端半的**运行时**自检：在 Node 里把 `lib/client.js` **真的跑起来**。
 *
 * ══ 为什么需要它（这是踩过坑之后补的）══════════════════════════════════════════
 * `scripts/smoke.mjs` 全是**源码级正则断言**，`node --check` 只看语法，
 * 而端到端 harness 打的是 HTTP 路由、**根本不加载客户端**。
 * 于是下面这类 bug 三处都查不出来，只能等人肉眼看面板：
 *
 *   · **跨作用域引用**：`const MAX_SEGMENTS = 200` 写在 `createPanelStore()` 里，
 *     却在 `SideBranchBody` 组件里用 ⇒ 第一个 `delta` 一到就抛
 *     `ReferenceError: MAX_SEGMENTS is not defined`，被浏览器的事件派发吞掉
 *     ⇒ **每个增量都丢、答案永远不显示**。`node --check` 与正则都看不出来。
 *   · SSE 帧处理写错、段落/快捷引用漂移、`snapshot` 之后不渲染 ……
 *
 * 本脚本用**极简 React + 极简 DOM** 把那层缺口补上：加载真实 bundle、
 * 渲染真实组件、喂真实的 SSE 帧，然后断言**渲染出来的树里有没有那个答案**。
 *
 * ══ 怎么做到的（bundle 的结构对测试很友好）══════════════════════════════════════
 * `lib/client.js` 的形态是：
 * ```js
 * window.__ModuleLoader__.load({ id, factory: (require) => { const module = {exports:{}}; … } })
 * ```
 * 它只从 `require` 取三样东西：`react`、`react-dom`（拿不到就走降级分支）、
 * `@deepseek-ai/dsh-client-ui-primitives`（拿不到就退回纯文本）。
 * 用到的 React API 只有 8 个（见下），所以一个 150 行的假 React 就够。
 *
 * ⚠️ 这**不是**浏览器测试：真实 DOM 布局、CSS、滚动位置它都验不了
 *   （那些仍然只能人工看）。它验的是**数据 → 渲染树**这一段。
 *
 * 用法：`node scripts/client-check.mjs [别的 client.js 路径]`
 *   （可选参数用于**反向验证**本脚本本身：拿一份故意改坏的副本跑，它必须 FAIL。
 *     一个不会失败的测试等于没有测试。）
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const problems = []
let checks = 0
const check = (ok, label) => {
	checks += 1
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) problems.push(label)
}

// ══════════════════════════════════════════════ 极简 React
const Fragment = Symbol('Fragment')

/** 每个组件实例的 hooks 槽位；key 是渲染路径（同一位置 = 同一个实例）。 */
const slotsByPath = new Map()
const instancesByPath = new Map()
/** 宿主元素的假 DOM 节点：按渲染路径复用（见 `renderNode` 里那段说明）。 */
const domNodes = new Map()
let currentSlots = []
let hookIndex = 0
let effectQueue = []
let rootElement = null
let renderedRoot = null
let pendingRender = false

class Component {
	constructor(props) {
		this.props = props
		this.state = {}
		this.__isClass = true
	}
	setState(patch) {
		this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) }
		scheduleRender()
	}
}

const depsChanged = (previous, next) => {
	if (previous === undefined || next === undefined) return true
	if (previous.length !== next.length) return true
	return previous.some((value, index) => Object.is(value, next[index]) === false)
}

const react = {
	Fragment,
	Component,
	createElement(type, props, ...children) {
		const flat = []
		const push = (child) => {
			if (Array.isArray(child)) {
				for (const item of child) push(item)
				return
			}
			if (child === null || child === undefined || typeof child === 'boolean') return
			flat.push(child)
		}
		for (const child of children) push(child)
		return { __el: true, type, props: props === null || props === undefined ? {} : props, children: flat }
	},
	useState(initial) {
		const index = hookIndex
		hookIndex += 1
		if (currentSlots[index] === undefined) currentSlots[index] = { value: typeof initial === 'function' ? initial() : initial }
		const slot = currentSlots[index]
		return [
			slot.value,
			(next) => {
				slot.value = typeof next === 'function' ? next(slot.value) : next
				scheduleRender()
			},
		]
	},
	useReducer(reducer, initial) {
		const index = hookIndex
		hookIndex += 1
		if (currentSlots[index] === undefined) currentSlots[index] = { value: initial }
		const slot = currentSlots[index]
		return [
			slot.value,
			(action) => {
				slot.value = reducer(slot.value, action)
				scheduleRender()
			},
		]
	},
	useRef(initial) {
		const index = hookIndex
		hookIndex += 1
		if (currentSlots[index] === undefined) currentSlots[index] = { current: initial }
		return currentSlots[index]
	},
	useEffect(fn, deps) {
		registerEffect(fn, deps)
	},
	useLayoutEffect(fn, deps) {
		registerEffect(fn, deps)
	},
}

function registerEffect(fn, deps) {
	const index = hookIndex
	hookIndex += 1
	if (currentSlots[index] === undefined) currentSlots[index] = {}
	const slot = currentSlots[index]
	if (depsChanged(slot.deps, deps)) {
		slot.deps = deps
		effectQueue.push({ slot, fn })
	}
}

/** 渲染一个节点；返回 `{ type, props, children }` / `{ text }` / `null`。 */
function renderNode(node, path) {
	if (node === null || node === undefined || typeof node === 'boolean') return null
	if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
	if (Array.isArray(node)) {
		return { type: '#array', props: {}, children: node.map((child, index) => renderNode(child, `${path}.${index}`)).filter(Boolean) }
	}
	if (node.__el !== true) return null
	const { type, props, children } = node

	if (type === Fragment) {
		return { type: '#fragment', props, children: children.map((child, index) => renderNode(child, `${path}.${index}`)).filter(Boolean) }
	}

	if (typeof type === 'function') {
		const isClass = typeof type.prototype?.render === 'function'
		if (isClass === true) {
			let instance = instancesByPath.get(path)
			if (instance === undefined || instance.constructor !== type) {
				instance = new type(props)
				instancesByPath.set(path, instance)
			}
			instance.props = props
			try {
				return renderNode(instance.render(), path)
			} catch (error) {
				// 错误边界（`MarkdownBoundary`）：有 `getDerivedStateFromError` 就吞掉并退回 props.text
				if (typeof type.getDerivedStateFromError !== 'function') throw error
				instance.state = { ...instance.state, ...type.getDerivedStateFromError(error) }
				return renderNode(instance.render(), path)
			}
		}
		const savedSlots = currentSlots
		const savedIndex = hookIndex
		if (slotsByPath.has(path) !== true) slotsByPath.set(path, [])
		currentSlots = slotsByPath.get(path)
		hookIndex = 0
		let out
		try {
			out = renderNode(type(props), path)
		} finally {
			currentSlots = savedSlots
			hookIndex = savedIndex
		}
		return out
	}

/** 宿主元素（'div' / 'button' / 'pre' / …）—— DOM 节点**按路径复用**（真实 React 也复用）。
 * ⚠️ 每次渲染都新建节点的话，副作用里写的 `scrollTop` 会被下一次渲染的新节点抹掉，
 *   "自动滚底"那一条就永远验不出来（这是个测试自身的坑，不是被测量的代码的坑）。 */
	if (props.ref !== undefined && props.ref !== null && typeof props.ref === 'object') {
		let node = domNodes.get(path)
		if (node === undefined) {
			node = { scrollTop: 0, scrollHeight: 1234, clientHeight: 400 }
			domNodes.set(path, node)
		}
		node.className = props.className
		props.ref.current = node
	}
	return {
		type,
		props,
		children: children.map((child, index) => renderNode(child, `${path}.${index}`)).filter(Boolean),
	}
}

function doRender() {
	effectQueue = []
	instancesByPath.clear()
	renderedRoot = renderNode(rootElement, 'root')
	for (const { slot, fn } of effectQueue) {
		if (typeof slot.cleanup === 'function') {
			try {
				slot.cleanup()
			} catch {
				/* 清理失败不影响判定 */
			}
		}
		const returned = fn()
		slot.cleanup = typeof returned === 'function' ? returned : undefined
	}
}

function scheduleRender() {
	if (pendingRender === true) return
	pendingRender = true
	queueMicrotask(() => {
		pendingRender = false
		doRender()
	})
}

/** 等微任务/定时器队列排空（`ask()` 是 async 的）。 */
const settle = async () => {
	for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const walk = (node, visit) => {
	if (node === null || node === undefined) return
	visit(node)
	for (const child of node.children ?? []) walk(child, visit)
}
const findAll = (predicate) => {
	const out = []
	walk(renderedRoot, (node) => {
		if (node.__el !== true && node.text === undefined && predicate(node)) out.push(node)
	})
	return out
}
const treeText = () => {
	let text = ''
	walk(renderedRoot, (node) => {
		if (node.text !== undefined) text += node.text
	})
	return text
}

// ══════════════════════════════════════════════ 极简 DOM / 平台
//
// ★ 这套 DOM 必须能表达**父子关系与选择器**，原因见下面「划选入口的作用域」那一段：
//   那个 BUG（在右栏文件预览里划字也弹「引用并提问」）只有"祖先链 + 选择器"这一层能抓到，
//   纯 stub（closest 恒 null）会把缺陷和修复**都**判成"不弹"，等于没有测试。
//
// 支持的 selector 子集（本插件真正用到的那些）：
//   tag / .class / [attr] / [attr="value"] / [attr]:not([attr="value"]) / 逗号并列。
const attrOf = (element, name) => {
	const key = String(name)
		.replace(/^data-/, '')
		.replace(/-([a-z])/g, (_whole, letter) => letter.toUpperCase())
	if (element.dataset !== undefined && element.dataset[key] !== undefined) return String(element.dataset[key])
	if (element.attributes !== undefined && element.attributes[name] !== undefined) return String(element.attributes[name])
	return undefined
}

const matchesSimple = (element, part) => {
	let rest = part.trim()
	if (rest === '') return false
	const tag = /^[a-z][a-z0-9-]*/i.exec(rest)
	if (tag !== null) {
		if (String(element.tagName).toLowerCase() !== tag[0].toLowerCase()) return false
		rest = rest.slice(tag[0].length)
	}
	while (rest.length > 0) {
		let match
		if ((match = /^\.([\w-]+)/.exec(rest)) !== null) {
			const classes = String(element.className ?? '').split(/\s+/)
			if (classes.includes(match[1]) === false) return false
		} else if ((match = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest)) !== null) {
			const value = attrOf(element, match[1])
			if (value === undefined) return false
			if (match[2] !== undefined && value !== match[2]) return false
		} else if ((match = /^:not\(\[([\w-]+)(?:="([^"]*)")?\]\)/.exec(rest)) !== null) {
			const value = attrOf(element, match[1])
			const hit = match[2] === undefined ? value !== undefined : value === match[2]
			if (hit) return false
		} else {
			return false
		}
		rest = rest.slice(match[0].length)
	}
	return true
}

/** 逗号并列 = 任一命中（与浏览器一致）。 */
const matchesSelector = (element, selector) => String(selector).split(',').some((part) => matchesSimple(element, part))

const collectDescendants = (node, out) => {
	for (const child of node.children ?? []) {
		out.push(child)
		collectDescendants(child, out)
	}
	return out
}

const makeElement = (tag) => ({
	tagName: String(tag).toUpperCase(),
	className: '',
	textContent: '',
	style: {},
	dataset: {},
	attributes: {},
	children: [],
	parentNode: null,
	appendChild(child) {
		child.parentNode = this
		this.children.push(child)
		return child
	},
	removeChild(child) {
		const at = this.children.indexOf(child)
		if (at > -1) this.children.splice(at, 1)
		child.parentNode = null
		return child
	},
	remove() {
		if (this.parentNode !== null) this.parentNode.removeChild(this)
	},
	setAttribute(name, value) {
		this.attributes[name] = String(value)
	},
	getAttribute(name) {
		const value = attrOf(this, name)
		return value === undefined ? null : value
	},
	hasAttribute(name) {
		return attrOf(this, name) !== undefined
	},
	addEventListener() {},
	removeEventListener() {},
	closest(selector) {
		let node = this
		while (node !== null && node !== undefined) {
			if (matchesSelector(node, selector)) return node
			node = node.parentNode
		}
		return null
	},
	querySelector(selector) {
		return collectDescendants(this, []).find((node) => matchesSelector(node, selector)) ?? null
	},
	querySelectorAll(selector) {
		return collectDescendants(this, []).filter((node) => matchesSelector(node, selector))
	},
	getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
})

/** document 级监听要能**真的被触发**（划选入口的作用域测试靠它）。 */
const documentListeners = new Map()

const documentStub = {
	head: makeElement('head'),
	body: makeElement('body'),
	documentElement: makeElement('html'),
	createElement: makeElement,
	getElementById: () => null,
	addEventListener(name, handler) {
		if (documentListeners.has(name) === false) documentListeners.set(name, new Set())
		documentListeners.get(name).add(handler)
	},
	removeEventListener(name, handler) {
		documentListeners.get(name)?.delete(handler)
	},
	/** 手动派发（只给测试用；生产代码里是浏览器派发）。 */
	dispatch(name, event) {
		for (const handler of documentListeners.get(name) ?? []) handler(event ?? {})
	},
	querySelector(selector) {
		return collectDescendants(this.documentElement, []).concat(collectDescendants(this.body, [])).find((node) => matchesSelector(node, selector)) ?? null
	},
	querySelectorAll(selector) {
		return collectDescendants(this.documentElement, []).concat(collectDescendants(this.body, [])).filter((node) => matchesSelector(node, selector))
	},
}

const storageStub = () => {
	const map = new Map()
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => map.set(key, String(value)),
		removeItem: (key) => map.delete(key),
		clear: () => map.clear(),
	}
}

const windowStub = {
	innerWidth: 1280,
	innerHeight: 800,
	devicePixelRatio: 1,
	document: documentStub,
	sessionStorage: storageStub(),
	localStorage: storageStub(),
	addEventListener() {},
	removeEventListener() {},
	getSelection: () => null,
	matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
	requestAnimationFrame: (fn) => setTimeout(fn, 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
	setTimeout,
	clearTimeout,
}

globalThis.window = windowStub
globalThis.document = documentStub
globalThis.sessionStorage = windowStub.sessionStorage
globalThis.localStorage = windowStub.localStorage

// ══════════════════════════════════════════════ 加载真实 bundle
let loadedExports = null
windowStub.__ModuleLoader__ = {
	load({ id, factory }) {
		const fakeRequire = (name) => {
			if (name === 'react') return react
			// `react-dom` 与 primitives 都**故意抛**：bundle 自带降级分支
			//（菜单退回内联渲染、Markdown 退回纯文本），正好也把降级路径一起测了。
			throw new Error(`client-check: 未提供的平台模块 ${name}`)
		}
		loadedExports = factory(fakeRequire)
		void id
	},
}

// ★ 「引用随轮入档」的读回断言要一份**已落盘**的面板桶（store 在 bundle 求值时读一次）。
//   在装载之前塞进去，才能验到 "刷新后引用块还在" 这条路径。
const SEED_QUOTE = 'SEEDED-QUOTED-TEXT-9174'
windowStub.sessionStorage.setItem(
	'dsh-side-branch:panels',
	JSON.stringify({
		v: 1,
		buckets: [
			{
				sessionId: 'client-check-seed',
				paneId: 'pane-seed',
				state: {
					rounds: [
						{
							id: 'seed-1',
							question: '种子问题',
							reference: SEED_QUOTE,
							answer: '种子回答',
							reasoning: '',
							phase: 'done',
						},
					],
				},
			},
		],
	}),
)

const source = readFileSync(process.argv[2] ?? join(root, 'lib/client.js'), 'utf8')
// 装载期 bundle 会往 console.error 打两条**预期内**的降级日志（react-dom / primitives 没提供）。
// 它们本身是有用的证据（说明降级分支走到了），但混在断言输出里会让人以为出了问题 ⇒ 先滤掉。
const nativeError = console.error
console.error = (...args) => {
	// ⚠️ 那两条日志把 `Error` 放在**第二个参数**里，所以要把整行拼起来再判。
	const line = args.map((value) => (value instanceof Error ? value.message : String(value))).join(' ')
	if (line.includes('未提供的平台模块')) return
	nativeError(...args)
}
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'sessionStorage', 'localStorage', source)(windowStub, documentStub, windowStub.sessionStorage, windowStub.localStorage)
console.error = nativeError
check(loadedExports !== null, 'bundle 通过 window.__ModuleLoader__.load 装载成功')
check(loadedExports !== null && typeof loadedExports.apply === 'function', 'bundle 导出了 apply()')

// ══════════════════════════════════════════════ 捕获面板组件
let Panel = null
let panelSpec = null
/**
 * 真的 locale 服务桩：客户端会自己 `ctx.locale.register(NS, { zh, en })` 把词典交上来，
 * 所以这里能按**真实文案**查表（断言因此可以盯真字符串，而不是"返回 key"那种弱断言）。
 * 契约形状与官方一致：`register(ns, tables)` / `bind(ns) -> t(key, vars?)`。
 */
const dictionaries = {}
const localeService = {
	register(ns, tables) {
		dictionaries[ns] = tables
		return () => {}
	},
	bind(ns) {
		return (key, vars) => {
			const table = dictionaries[ns]?.zh ?? {}
			const raw = typeof table[key] === 'string' ? table[key] : `«${key}»`
			if (vars === undefined) return raw
			return raw.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
		}
	},
	getLocale: () => ({ active: 'zh' }),
}
const t = localeService.bind('sideBranch')

const ctx = {
	locale: localeService,
	slots: {
		inject: (_name, fn) => fn(),
		register: (spec, component) => {
			if (spec?.name === 'sidebar.right.pane.tab') {
				Panel = component
				panelSpec = spec
			}
			return () => {}
		},
	},
	// 客户端 `inject` 里声明的另外三个服务：只用来注册侧栏 tab 与快速入口。
	// 这里给出最小可用形状（`register` 返回 disposer、`openTab` 是空操作）。
	sidebarRightTabs: {
		register: (spec) => {
			void spec
			return () => {}
		},
	},
	sidebarRight: {
		openTab: () => {},
	},
	modelDirectories: undefined,
	effect: (fn) => {
		const off = fn()
		return typeof off === 'function' ? off : () => {}
	},
	get: () => undefined,
	on: () => {},
}
loadedExports.apply(ctx)
check(typeof Panel === 'function', '侧栏 tab 的正文组件被注册（SideBranchBody）')
check(dictionaries.sideBranch !== undefined && Object.keys(dictionaries.sideBranch.zh ?? {}).length > 0, '客户端把词典注册进了 locale 服务（能查真实文案）')

// ══════════════════════════════════════════════ 事件桩：/start 与 SSE
const START_RESPONSE = {
	jobId: 'job-1',
	conversationId: 'side-00000000-0000-4000-8000-000000000001',
	synced: { turns: 1, chars: 754 },
	notice: 'SIDE-BRANCH NOTICE TEXT',
}
let lastStartBody = null
let startCalls = 0
let settingsPosts = 0
const startBodies = []
globalThis.fetch = async (url, init) => {
	const target = String(url)
	// ⚠️ 只数 `/start`：面板挂载时还会 POST 一次 `/settings`（把本地设置同步给宿主），
	//    那不是"点发送"的产物（一开始就是这么误报成 2 次的）。
	if (init?.method === 'POST' && target.includes('/side-branch/start')) {
		startCalls += 1
		lastStartBody = JSON.parse(init.body)
		startBodies.push(lastStartBody)
		return { ok: true, status: 200, json: async () => START_RESPONSE, text: async () => JSON.stringify(START_RESPONSE) }
	}
	if (init?.method === 'POST' && target.includes('/side-branch/settings')) {
		settingsPosts += 1
		return { ok: true, status: 200, json: async () => ({ settings: { quickEntry: true } }), text: async () => '{"settings":{"quickEntry":true}}' }
	}
	return { ok: true, status: 200, json: async () => ({ settings: { quickEntry: true }, turns: [], chars: 0 }), text: async () => '{}' }
}

let stream = null
class EventSourceStub {
	constructor(url) {
		this.url = url
		this.listeners = new Map()
		this.closed = false
		stream = this
	}
	addEventListener(name, handler) {
		this.listeners.set(name, handler)
	}
	close() {
		this.closed = true
	}
	/** 投一帧（形状与宿主 `handleStream` 发出的完全一致）。 */
	emit(name, payload) {
		const handler = this.listeners.get(name)
		if (handler === undefined) return false
		handler({ data: JSON.stringify(payload) })
		return true
	}
}
globalThis.EventSource = EventSourceStub

// ══════════════════════════════════════════════ 驱动
/** 真实那一轮的 SSE 帧（照 `handleStream`/`emitJob` 的形状）。 */
const ANSWER_1 = '我看到的是三部分内容：'
const ANSWER_2 = '1. 侧分支提示。'
const REASONING = '让我先看看上下文里有什么。'
const FRAMES = [
	['snapshot', { status: 'running', text: '', reasoning: '', segments: [], conversationId: START_RESPONSE.conversationId }],
	['segment', { turn: 2, step: 1 }],
	['reasoning', { text: REASONING, turn: 2, step: 1 }],
	['delta', { text: ANSWER_1, turn: 2, step: 1 }],
	// 中途调一次工具 ⇒ 进入 step 2（新的一段）
	['tool', { name: 'read', count: 1, turn: 2, step: 1 }],
	['segment', { turn: 2, step: 2 }],
	['delta', { text: ANSWER_2, turn: 2, step: 2 }],
	['done', { status: 'done', text: ANSWER_1 + ANSWER_2, reasoning: REASONING, conversationId: START_RESPONSE.conversationId, segments: [], stats: { output: 12 } }],
]

const findSendButton = () => findAll((node) => typeof node.props?.className === 'string' && node.props.className.includes('dsh-side-branch-send'))[0]
const findTextarea = () => findAll((node) => node.type === 'textarea')[0]

async function run() {
	// ① 首次渲染
	//
	// ⚠️ 面板的能力**全部来自席位的 `inject` face**（`inject: () => ({ startSideBranch, … })`）。
	//   这里照官方那样把它展开进 props —— 顺便也就验了"face 里该有的键都在"。
	const injected = typeof panelSpec?.inject === 'function' ? panelSpec.inject() : {}
	check(typeof injected.startSideBranch === 'function', 'inject face 里有 startSideBranch')
	check(typeof injected.stopSideBranch === 'function', 'inject face 里有 stopSideBranch')
	check(typeof injected.closeSideBranch === 'function', 'inject face 里有 closeSideBranch')
	check(typeof injected.streamUrl === 'function', 'inject face 里有 streamUrl')
	check(typeof injected.fetchInherited === 'function', 'inject face 里有 fetchInherited')
	check(typeof injected.fetchSettings === 'function', 'inject face 里有 fetchSettings')

	rootElement = react.createElement(Panel, { t, sessionId: 'client-check-session', ...injected })
	doRender()
	check(renderedRoot !== null, '组件首次渲染成功')

	// ② 往输入框打字（走真实 onChange）
	const textarea = findTextarea()
	check(textarea !== undefined, '找到了输入框（textarea）')
	if (textarea === undefined) return
	const question = '你看到了什么'
	textarea.props.onChange({ target: { value: question } })
	await settle()

	// ③ 点发送（onClick === ask）
	const send = findSendButton()
	check(send !== undefined, '找到了发送键')
	if (send === undefined) return
	check(send.props.disabled !== true, '有内容时发送键可用')
	send.props.onClick()
	await settle()

	// ④ 确实发出了 `/start`，且带上问题
	check(startCalls === 1, `点发送后发了 1 次 POST /start（实际 ${startCalls}，另有 ${settingsPosts} 次 /settings 同步）`)
	check(settingsPosts >= 1, '面板挂载时把本地设置同步给了宿主（POST /side-branch/settings）')
	check(lastStartBody !== null && String(lastStartBody.question).includes(question), 'POST /start 带上了问题原文')
	check(stream !== null && String(stream.url).includes('job=job-1'), '打开了指向该 job 的 SSE 流')

	// ⑤ 问题气泡应该已经渲染出来
	check(treeText().includes(question), '面板上出现了问题气泡')

	// ⑥ 喂真实形状的 SSE 帧（这一步会暴露处理函数里的运行时错误）
	const emitted = []
	for (const [name, payload] of FRAMES) {
		if (stream === null) break
		let ok
		try {
			ok = stream.emit(name, payload)
		} catch (error) {
			check(false, `SSE 帧 ${name} 的处理函数抛错：${error instanceof Error ? error.message : String(error)}`)
			return
		}
		if (ok === false) check(false, `客户端没有监听 SSE 事件 ${name}`)
		emitted.push(name)
		await settle()
	}
	check(emitted.length === FRAMES.length, `全部 ${FRAMES.length} 帧都有对应的监听函数（实际 ${emitted.length}）`)

	// ⑦ 核心断言：**答案真的渲染出来了**（这就是"没有回答"那个 bug 的判据）
	const text = treeText()
	check(text.includes(ANSWER_1), `渲染树里有第一段正文（"${ANSWER_1}"）`)
	check(text.includes(ANSWER_2), `渲染树里有第二段正文（"${ANSWER_2}"）`)
	check(text.includes(REASONING), '渲染树里有推理内容（可折叠的「思考」行）')
	check(text.includes('read'), '渲染树里有工具行（工具名）')
	check(text.includes('SIDE-BRANCH NOTICE TEXT'), '渲染树里有注入给模型的分支引导词全文')
	// 多段要**都在**，而且顺序正确（这是 §12 那个 bug 的回归判据）
	const atFirst = text.indexOf(ANSWER_1)
	const atSecond = text.indexOf(ANSWER_2)
	const atTool = text.indexOf('read')
	check(atFirst > -1 && atSecond > -1 && atFirst < atSecond, '两段正文都在，且第一段在第二段之前（多段没有互相覆盖）')
	check(atTool > atFirst && atTool < atSecond, '工具行夹在两段正文之间（"思考 → 正文 → 工具 → 正文"的顺序没乱）')

	// ⑧ 自动滚底必须落在**可滚动的那一层**上
	const scrollers = findAll((node) => String(node.props?.className ?? '').includes('dsh-side-branch-scroll'))
	check(scrollers.length === 1, '找到唯一的滚动容器（.dsh-side-branch-scroll）')
	if (scrollers.length === 1) {
		const ref = scrollers[0].props.ref
		check(ref !== undefined && ref.current !== null && ref.current.scrollTop === ref.current.scrollHeight, '自动滚底作用在滚动容器上（scrollTop 被设成 scrollHeight）')
	}
	const inner = findAll((node) => String(node.props?.className ?? '').includes('dsh-side-branch-rounds'))
	check(inner.length === 0 || inner[0].props.ref === undefined, '轮次列表（不可滚动）上没有挂 ref（挂上去就是空操作）')

	// ⑨ 引用随轮入档（刷新后仍在）：面板桶里预置了一轮带 `reference` 的记录。
	//    这条同时守着两件事 —— `normalizeRound` 没把 reference 丢掉、以及轮次里真的渲染了它。
	rootElement = react.createElement(Panel, {
		t,
		sessionId: 'client-check-seed',
		useTabInfo: () => ({ panel: { id: 'pane-seed' }, tab: { id: 'tab-seed' } }),
		...injected,
	})
	doRender()
	await settle()
	const seededText = treeText()
	check(seededText.includes(SEED_QUOTE), `刷新读回的那一轮渲染出了引用原文（"${SEED_QUOTE}"）`)
	check(seededText.includes('引用原文'), '引用块带着「引用原文 · N 字」摘要（走词典真文案）')
	const refBlocks = findAll((node) => String(node.props?.className ?? '').includes('dsh-side-branch-refblock'))
	check(refBlocks.length === 1, '引用块是折叠形态（.dsh-side-branch-refblock）')
	const refBodies = findAll((node) => String(node.props?.className ?? '').includes('dsh-side-branch-refbody'))
	check(refBodies.length === 1 && refBodies[0].type === 'blockquote', '引用正文在 <blockquote> 里（.dsh-side-branch-refbody）')

	// ⑩ 划选入口的**作用域**（0.2.2 修的 BUG：右栏文件预览 / 设置 / 其它插件面板里划字也弹「引用并提问」）
	//
	// 入口的监听挂在 document 上（"在会话里划字就能用"），所以只有"选区落在哪棵子树里"能判定归属。
	// 这里用假 DOM 真造出祖先链，再走**真实**的 selectionchange 处理路径（含 120ms 防抖），
	// 断言浮动按钮到底显不显示 —— 纯正则断言抓不到这类缺陷。
	const selectionButton = documentStub.body.children.find((node) => node.dataset?.dshSideBranchSelection === '1')
	check(selectionButton !== undefined, '划选入口装了浮动按钮（挂在 document.body 上）')

	/** 造一个元素并挂进父链（attribute 走 setAttribute，和官方渲染出来的 DOM 一致）。 */
	const element = (tag, attrs) => {
		const node = makeElement(tag)
		for (const [name, value] of Object.entries(attrs ?? {})) {
			// className 必须是**属性**（选择器 `.cls` 读的就是它），其余走 attribute
			if (name === 'className') node.className = value
			else node.setAttribute(name, value)
		}
		return node
	}
	/** 选区桩：起点是"文本节点"（真实选区就是文本节点 ⇒ 走 parentElement 那条路）。 */
	const selectionIn = (host, text) => ({
		isCollapsed: false,
		rangeCount: 1,
		anchorNode: { nodeType: 3, parentElement: host },
		toString: () => text,
		getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 100, left: 20, right: 180, bottom: 120, width: 160, height: 20 }) }),
	})
	const probe = async (host, text) => {
		windowStub.getSelection = () => selectionIn(host, text)
		documentStub.dispatch('selectionchange')
		await new Promise((resolve) => setTimeout(resolve, 200))
		return selectionButton?.style.display === 'block'
	}

	if (selectionButton !== undefined) {
		// ① 主会话正文 ⇒ 弹
		const content = element('div', { 'data-conversation-content': '' })
		const scroll = content.appendChild(element('div', { 'data-conversation-scroll': '' }))
		const message = scroll.appendChild(element('div', { 'data-chat-flow-kind': 'assistant' }))
		check(await probe(message, '主会话里选中的一段原文'), '主会话正文里划选 ⇒ 弹出「引用并提问」')

		// ② 右栏文件预览（md）⇒ 不弹
		const sidePanel = element('div', { 'data-sidebar-right-panel': 'push', 'data-sidebar-right-session': 'session-1' })
		const fileBody = sidePanel.appendChild(element('div', { 'data-sidebar-right-tab': 'file' }))
		const md = fileBody.appendChild(element('div', { className: 'markdown' }))
		check((await probe(md, '右栏 md 里选中的一段')) === false, '右栏文件预览里划选 ⇒ 不弹（不属于主会话）')

		// ③ 设置弹层（body 下的 portal）⇒ 不弹
		const modal = element('div', { 'data-dsh-settings': '' })
		const modalText = modal.appendChild(element('div'))
		check((await probe(modalText, '设置里的说明文字')) === false, '设置弹层里划选 ⇒ 不弹')

		// ④ 右栏里的**子代理会话**（嵌入会话自己也带 data-conversation-content）⇒ 不弹
		const embeddedContent = sidePanel.appendChild(element('div', { 'data-conversation-content': '' }))
		const embeddedScroll = embeddedContent.appendChild(element('div', { 'data-conversation-scroll': '' }))
		const embeddedMessage = embeddedScroll.appendChild(element('div', { 'data-chat-flow-kind': 'assistant' }))
		check((await probe(embeddedMessage, '子代理会话里的正文')) === false, '右栏嵌入的子代理会话里划选 ⇒ 不弹（只认主会话）')

		// ⑤ 主会话的 composer 座位 ⇒ 不弹（选区在座位里的普通文本上，不是 contenteditable 的情形）
		const composerSeat = scroll.appendChild(element('div', { 'data-conversation-region': 'composer' }))
		const composerText = composerSeat.appendChild(element('div'))
		check((await probe(composerText, '输入区的文字')) === false, '主会话 composer 座位里划选 ⇒ 不弹')

		// ⑥ 本插件自己的面板 ⇒ 不弹（面板根类仍在黑名单里，不靠作用域判据兜底）
		const ownPanel = element('section', { className: 'dsh-side-branch-panel' })
		const ownText = ownPanel.appendChild(element('div'))
		check((await probe(ownText, '面板里的答案')) === false, '临时会话面板里划选 ⇒ 不弹')

		// ⑦ 回归：主会话正文**仍然**能用（避免"修过头"把入口彻底弄没）
		check(await probe(message, '主会话正文再选一次'), '修好之后主会话正文依然弹出（没有修过头）')
	}
}


await run()

console.log(`\n${problems.length === 0 ? `全部通过（${checks} 项）` : `${problems.length} 项未通过（共 ${checks} 项）`}`)
process.exit(problems.length === 0 ? 0 : 1)
