# AGENTS.md

[English](./docs/AGENTS.en.md) · 简体中文 · [仓库首页](./README.md)

面向自动化 agent 的说明：如何安装、验证、以及改动这个插件时的硬约束。

## 这是什么

`dsh-side-branch` 是一个 DSH Web 插件。它从主会话派生一条**只读分支会话**，继承主会话已完成的回合前缀与 agent preset，回答**不进入主会话的模型上下文**。

## 安装与验证

```text
0. 确认本机 PATH 上有 pnpm：dsh plugin 是 pnpm 的转发器，缺了它直接以 127 退出。
1. 确认插件目录绝对路径不含空格。Windows 上 dsh plugin add 通过 shell 转发给 pnpm，
   路径含空格会把参数拆成两段并装出错误的链接。
   含空格时改走"不经过命令行"的路：在 profile 的 package.json 里写
   "dsh-side-branch": "link:<绝对路径，正斜杠>"，再跑 dsh plugin --profile <profile> install。
2. dsh plugin --profile <profile> add <插件目录绝对路径>
3. dsh --profile <profile> --dump-config | Select-String dsh-side-branch
   期望看到：# == dsh-side-branch / id: dsh-side-branch / name: dsh-side-branch
4. 重启 DSH。客户端插件只在启动时装载，刷新浏览器不够。
```

成功判据：第 3 步输出里出现 `id: dsh-side-branch`，且第 4 步启动日志里出现 `[side-branch] 已注册 /side-branch 路由`。

失败判据与含义：

| 现象 | 原因 |
| --- | --- |
| `ERR_MODULE_NOT_FOUND`，提到 dsh-side-branch | `cordis.patch.yml` 的 `name` 与 `package.json` 的 `name` 不一致 |
| 启动日志出现 `missing bundle` | profile 的 `dsh.profile.bundles` 里没有 `dsh-side-branch`，或依赖没装 |
| 启动日志出现 `missing bundle ... one build instruction` | 客户端 bundle 不存在（本仓库直接提交 `lib/client.js`，正常不会出现） |
| 页面白屏、插件列表显示 pending | 客户端 `inject` 里写了不存在的服务名 |

## 文件结构

| 路径 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主半。注册 HTTP 路由、建侧会话、挂只读 guard、驱动轮次 |
| `lib/client.js` | 客户端半。右栏面板、划选入口、SSE 读取、设置区。浏览器 bundle，由 DSH 以静态模块加载 |
| `cordis.patch.yml` | bundle patch，只 insert 一行，`name` 必须是真实包名 |
| `package.json` | `dsh.bundle.patch` 声明 patch；`dsh.client` 声明浏览器半 |
| `scripts/smoke.mjs` | 契约自检：加载宿主半、验证只读白名单与 guard 形状、核验依赖包存在。**只在源码仓库里存在**，不随 npm 包发布（它断言的是源码形状，脱离源码树跑不了） |

## 改动前的硬约束

**不要用 `toolFilter` 或 `tools.restrict` 实现只读。** 这两者作用在提示词层，会让侧会话的提示词前缀与主会话分叉，前缀缓存全部失效。只读必须用 `ctx.tools.guard()` 在执行层拦。guard 要注册在该侧 Agent 自己的 ctx 上（`setup(agentCtx)` 内）。

**不要动提示词前缀。** 分支引导词拼在每轮问题前面，不进系统提示词。工具名单是插件级常量，模型看到的名单与执行层判据同源。改动引导词的任何字都会让该段的前缀缓存失效。

**不要把"自选可用工具"加回来。** 放行名单只存在于 `ALLOWED_TOOLS` 与 `TOOL_CHOICES` 两个常量里，插件不接受客户端提交的工具名：多一层可配置就多一处能把只读保证改坏的地方。

**不要改回官方 `ctx.subagents.startContinuable`。** 它在结算时会把子会话的最终回答当成父会话的用户消息投回来，并唤醒父模型跑一整轮，直接违反本插件的前提。

**不要给客户端 `inject` 加服务名。** 写错一个名字会让 fiber 永久 pending 并白屏。当前五个：`slots`、`locale`、`sidebarRightTabs`、`sidebarRight`、`modelDirectories`。

**SSE 响应是整条手写的**（`Connection: close`）。换成框架自带的写法会坏，原因写在 `lib/index.js` 的 `handleStream` 注释里。

**客户端一切输入都不可信。** 问题长度、模型标识、`conversationId` 归属都要在宿主侧校验。

**只读的四条护栏都别动**：`ALLOWED_TOOLS` 常量、`setup(agentCtx)` 里的 `tools.guard`（拿不到就 `throw`，fail-loud）、`ROUTE_METHODS`（405 + `Allow` 的方法契约）、以及宿主侧对 `conversationId` 归属的校验。

**`peerDependencies` 里的 `@deepseek-ai/cordis` 是声明性的**：插件代码**不 import 它**（宿主半的运行期服务全部经 `ctx` 软获取，客户端半只 `require` 平台内置模块）。它是按生态惯例声明的，用来表明本插件挂在哪套契约上——**别当成漏删的依赖删掉**，也别为了"用上它"去加 import。

## 为什么这样做（改动前先读，别照着直觉改回去）

下面这些是"看起来更省事、但会破坏本插件前提"的做法，以及我们为什么不走。**它们不是历史记录，是取舍本身**——不写下来，下一个维护者很可能会去试。

**只读为什么必须在执行层。** 直觉做法是 `toolFilter:{allow:[]}` 或 `tools.restrict`——它们作用在**提示词层**（工具从提示词里消失），功能上确实达到只读。代价是侧会话的提示词前缀不再与主会话逐字一致，父会话已有的**前缀缓存全部失效**，每轮都要重算整个上下文。所以只读改用 `ctx.tools.guard()`（`dsh-tools` 的公开契约），作用在**执行层**：工具仍在提示词里，模型可以尝试调用，但执行被拒 ⇒ 提示词一个字不动，缓存照旧命中。guard 必须注册在**该侧 Agent 自己的 ctx** 上（`setup(agentCtx)` 内取），官方语义是经 `agent.ctx` 注册的 guard 只作用于该 agent——这对并行存在的多段侧枝会话是必需的。

**为什么不用官方的可续子会话。** `ctx.subagents.startContinuable` 表面上正好合适（官方提供的、可继续对话的子会话），但它结算时会把子会话的最终回答当成一条**父会话用户消息**投回父会话，并唤醒父模型跑一整轮（`dsh-subagent` 的 `watchSettlement` / `notifySettlement`，官方 README 说明这是设计行为且没有开关）。对多数场景合理，但对本插件是致命的：直接违反"答案不进主会话"这个前提，还要为此多跑一轮模型。

**为什么自建侧会话、以及为什么种子取"已完成回合前缀"。** 现在的做法是 `ctx.agents.create()` 建一个**普通侧会话**（`meta.parentSession` 只当血缘，**不设** `origin:'subagent'` —— 不需要子代理的生命周期，也不想让主会话里出现子代理卡片），出生时用公开的 `session.snapshotEvents()` 读出父会话事件、自己切到最后一个 `turn/end` 当种子，再在 `setup` 里 `agentPresets.composeFrom(agentCtx, parent.ctx)` 继承父会话的 preset/工具/persona。这样提示词前缀与父会话逐字一致，**继续命中原有的前缀缓存**；多轮追问就是同一个会话上继续 `followup`。代价是继承的是**开段那一刻的快照**：开段之后父会话的新回合不进这条分支（否则每次追问都要重算种子，前缀跟着变，缓存白拿），用户要带上新内容得「清空」另起一段。

**为什么分支引导词拼在问题前面。** 引导词若进系统提示词，前缀就与主会话分叉、缓存全废。所以它拼在**每段第一轮的问题前面**，且同段内必须逐字一致。

**为什么设置不走官方设置服务。** `settings.register(ns, schema)` 要的是 **schemastery 的 `z<T>` 本身**（`dsh-settings` 的 `resolve()` 会直接调用它，schema 必须可调用），而 `@deepseek-ai/schemastery` 是平台内置包，从插件工作区里**静态 import / 动态 import / `createRequire` 三种方式都解析不到**（一律 `ERR_MODULE_NOT_FOUND`）；手工造一个"兼容 schema"也不行（节点对象靠属性工作、不可调用）。⇒ 设置改为客户端 `localStorage` 持久化、每次请求把值带给宿主，宿主只做校验与夹紧。代价是官方设置页里看不到这个命名空间，插件自带齿轮面板。

**为什么到达上下文上限是"拒绝"而不是"丢最早的轮次"。** 后者实现更简单、用户也不会被打断，但会让模型**静默失忆**：它不记得被丢掉的内容，却仍然表现得像记得，用户很难察觉。所以做法是每轮读子会话 `assistant/message` 的 usage（`input + cacheRead`）与 `request/context` 的 `contextWindow`，超过窗口的 80% 就拒绝发送，并把实际用量与上限显示在面板上。

**为什么放行名单不可配置。** 只读承诺的支点越少越好。如果放行面由"宿主常量 × 设置里的名字集合 × 客户端提交上来的子集"三者求交而成，三处必须始终一致，任何一处写错都可能让放行面变宽。现在只有一处：`ALLOWED_TOOLS` 与 `TOOL_CHOICES` 两个同源常量——模型看到的分支引导词也从同一个常量取，所以"告诉模型能用什么"与"执行层实际放行什么"不可能分叉。代价是用户无法自行收窄权限，想收窄只能改代码。

**几个不改会出事的实现细节**（都在代码注释里有详细说明，这里只列点）：闲置到点是让侧会话**睡觉**（`resume` 唤醒**必须显式传 `agentOptions`**，否则那一轮 ~25ms 静默空转）；`tab.signal` abort 只断流、**不删面板状态桶**；SSE 响应整条手写、显式 `Connection: close`（框架自带写法会声明 chunked 而实际发裸数据）；宿主文案由客户端随请求发下 `locale`（宿主进程里没有浏览器的 locale）。

## 宿主 HTTP API

所有路由先过 `ctx.connection.requestRejection` 的信任栅栏。

| 方法与路径 | 请求体 | 响应 |
| --- | --- | --- |
| `POST /side-branch/start` | `{ sessionId, question, selection?, conversationId?, locale?, settings? }` | `{ jobId, conversationId, handoff? }`；失败时 `{ error, code }`，可能另带 `conversationGone: true` 或 `contextFull: { used, limit, window }` |
| `GET /side-branch/stream?job=<jobId>` | — | SSE：`snapshot` / `delta` / `reasoning` / `reset` / `replace` / `tool` / `done` / `error` / `stopped` |
| `POST /side-branch/stop` | `{ job }` | `{ status }`，只停这一轮，侧会话保留 |
| `POST /side-branch/close` | `{ conversationId }` | `{ status }`，释放这一段侧会话 |
| `GET /side-branch/settings` | — | `{ settings: { quickEntry } }` |
| `POST /side-branch/settings` | `{ settings: { quickEntry } }` | `{ settings: { quickEntry } }` |

设置只有一项：`quickEntry`（主会话快速入口按钮的开关）。**不接受**客户端提交工具名单——放行名单是宿主侧的常量，插件不提供"自选可用工具"的功能。若哪天要给这个功能开口子，先读 `lib/index.js` 头部「只读必须在执行层保证」那一段。

失败的响应带机器可读的 `code`，一律 `side-branch/` 前缀加 kebab-case，例如 `side-branch/question-too-long`、`side-branch/context-full`。客户端按 `code` 分支，不按文案分支。路径存在但方法不对时回 **405 + `Allow`**（支持的方法表在 `lib/index.js` 的 `ROUTE_METHODS`），不是 404。

## 验证改动

> ⚠️ 下面这条命令**只在源码仓库里有效**：`scripts/smoke.mjs` 不随 npm 包发布
> （它读 `lib/` 与 `package.json` 做源码级断言，从 `node_modules` 里跑没有意义）。
> 如果你是照 npm 装好的插件在做二次检查，请到仓库里跑。

```powershell
node scripts/smoke.mjs
```

不需要 DSH 运行时，直接加载宿主半并用假 ctx 调 `apply()`。它守的五处：

1. 模块能加载、导出名与 `package.json` 一致、路由前缀是 `/side-branch`、卸载 disposer 可调用；
2. **只读承诺**：`ALLOWED_TOOLS` 与 `TOOL_CHOICES` 仍是那六个名字且互相一致，九个危险工具名都不在其中；客户端没有工具开关的残留、宿主不接受客户端提交的工具名单；分支引导词的名单直接来自常量；guard 的判据仍是按名单放行、注册点仍在 `setup(agentCtx)` 里、拿不到 guard 仍 fail-loud。
   ⚠️ 这一项里"guard 的判据"是**源码级正则断言**，不是真的驱动一次拦截 —— 真拦截要靠端到端（见下）；
3. 客户端 bundle 存在、inject 仍是那五个服务名、不含调试导出；
4. `package.json` 与 `cordis.patch.yml` 的包名一致；
5. `dsh.client.inject` 里每个包在本机 DSH 安装目录里真实存在（用 `DSH_INSTALL_DIR` 指定路径，找不到就跳过这一项）。

它**不验证**回答质量、真实 guard 拦截、SSE 行为与界面。端到端验证需要：

1. 一个已装好本插件的 profile；
2. 一个主会话，至少完成一个回合；
3. 在页面里划选文字、打开面板、提问；
4. 检查启动日志出现 `[side-branch]` 前缀的行。

仓库内没有端到端测试套件。改动 guard、提示词前缀或 SSE 那几处时，第 2 步到第 4 步必须人工跑一遍。
