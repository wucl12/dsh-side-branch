# AGENTS.md

[English](./docs/AGENTS.en.md) · 简体中文 · [README](./README.md)

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
| `scripts/client-check.mjs` | 客户端半的**运行时**自检：在 Node 里用极简 React + 极简 DOM 加载**真实 bundle**、渲染**真实组件**、喂**真实形状的 SSE 帧**，然后断言渲染出来的树里有没有那个答案。**同样只在源码仓库里存在**，不随 npm 包发布（它断言的是真实运行行为，脱离源码树跑不了） |

## 改动前的硬约束

**不要用 `toolFilter` 或 `tools.restrict` 实现只读。** 这两者作用在提示词层，会让侧会话的提示词前缀与主会话分叉，前缀缓存全部失效。只读必须用 `ctx.tools.guard()` 在执行层拦。guard 要注册在该侧 Agent 自己的 ctx 上（`setup(agentCtx)` 内）。

**不要动提示词前缀。** 分支引导词拼在每轮问题前面，不进系统提示词。工具名单是插件级常量，模型看到的名单与执行层判据同源。改动引导词的任何字都会让该段的前缀缓存失效。

**不要把推给模型的文本改回中文，也不要在 zh/en 两张表里各写一份。** 分支引导词、PTC 变体引导词与 guard 的拒绝理由都来自唯一的 `PROMPT_TEXT`（`lib/index.js`，**英文**），两张语言表只是引用它；只有**用户可见**的文案（面板里的错误与提示）才随界面语言。理由：DSH 自身的系统提示词与工具描述都是英文，指令语言与平台一致更稳；而且**换界面语言不该换提示词**（行为可复现、问题可对照）。`scripts/smoke.mjs` 会检查这段文本里没有中文、且两张表引用同一份。

**不要把"自选可用工具"加回来。** 放行名单只存在于 `ALLOWED_TOOLS` 与 `TOOL_CHOICES` 两个常量里，插件不接受客户端提交的工具名：多一层可配置就多一处能把只读保证改坏的地方。

**不要改回官方 `ctx.subagents.startContinuable`。** 它在结算时会把子会话的最终回答当成父会话的用户消息投回来，并唤醒父模型跑一整轮，直接违反本插件的前提。

**不要给客户端 `inject` 加服务名。** 写错一个名字会让 fiber 永久 pending 并白屏。当前五个：`slots`、`locale`、`sidebarRightTabs`、`sidebarRight`、`modelDirectories`。

**不要删掉「跑前解锁、跑完回藏」这套循环，也不要把 `unarchiveSession` 改成硬调。** DSH `0.1.7-rc.1` 起，`dsh-api-session-controller` 的 `ArchivedSessionGate` 会拒掉**已归档会话**的任何模型步（`agent/pre-step` ⇒ reject ⇒ `dsh-agent-loop` 把轮次收成 `turn/end { reason: 'blocked' }`，**连模型请求都不会发出**）。本插件正是用归档来隐藏侧会话 ⇒ 少了 `handleStart` 里 `followup` 之前那次 `releaseArchiveGate()`，或少了 `finishJob` 里那次 `rehideAfterTurn()`，侧枝在 0.1.7 上就**每一轮全废**（面板会显示 `T.blocked`；那句「内容被安全策略拦截」与内容策略毫无关系，别被它带偏）。而 `unarchiveSession` 是 **`0.1.6-alpha.2`** 才有的方法：**必须走 `typeof` 特性探测**，硬调会让 `0.1.5-rc.2` 抛错，直接毁掉向后兼容。`scripts/smoke.mjs` 的第 ⑥ 节守着这套形状。

**不要删掉 Re-Fork，也不要在它上面"省事"。** 每一轮追问都要先看 `shouldReFork`：**主会话结算了新回合**，或者**模型/推理等级变了**，就新建一段（种子 = 主会话最新已结算前缀）并把上一段侧枝自己的对话重放进去。四条不能动：
1. **`shouldReFork` 必须同时判这两条。** 只判"主会话长了"的话，用户**换了模型但主会话没动**时那一轮会继续用旧模型 —— 静默忽略用户的选择。
2. **顺序：先重放成功，再释放老会话。** 反了就没有退路（老会话没了、新的没历史）。重放失败要**丢弃刚建的新会话**、老会话原样保留、本轮回 `side-branch/refork-failed`。⛔ 绝不静默降级成"没有历史的新会话"。
3. **重放只传 `event.data` 原样，且只重放 5 种 surface 事件。** 手搓 `assistant/message` 必被 `dsh-session` 拒（它要求真实 `source.provider/model` 与 `stream` 数组）；`turn/start`/`tool/call` 之类是纯日志事件，`append` 它们会抛。⛔ **也绝不要"顺手补全" `event.sourceEventSeqs`** —— `tool/result` 在事件层带着 `[旧会话的 callSeq]`，抄过来会撞 `sourceEventSeqs must reference earlier events`。
4. **不截断侧枝历史。** 到上下文上限就**拒绝**（`estimateRequestTokens` + `side-branch/context-full`）。"拒绝是显式失败，截断是隐式失真"。

**不要把"换模型 ⇒ 带历史换段"加回来**（`seedSource`、`sameAgentOptions` 交接、`skipPrependNotice` 手动传递）。re-fork 把这条路径整个吸收了：换模型只是"该重建"的又一个理由。`createConversation` 只能以**父会话**为种子。

**别把 `parentCut` 漏在建段路径上。** `createConversation` 建段时就要记 `parentCut`（= 那一刻父会话已结算前缀的长度），`sleepConversation`/`resumeConversation` 也要带着它走。漏了的话 `completedTurnPrefixLength(...) > undefined` 恒为真 ⇒ **每一轮都白 re-fork 一次**。

**多段回答（`job.segments`）别改回"两个字符串槽位"。** 一个 turn 的**每个 step** 都会发一个 `start` 帧：`turn`/`step` 变了才是"新的一段"，同 step 换 `attemptId` 才是**重试**（只有这时才丢该 step 的段落）。把每个 `start` 都当重试清空，就是"中间那段思考和正文消失"那个 BUG。另外 `replace` **只替换当前段**（整段替换会把前面几段一起覆盖），`snapshot`/终态必须带 `segments`（否则刷新后多段又没了）。

**别把 `lib/client.js` 里那些"两边共用"的常量/纯函数塞进任何一个函数内部。** `clampString` / `SEGMENT_KINDS` / `MAX_SEGMENTS` / `MAX_SEGMENT_CHARS` / `MAX_SEGMENTS_TOTAL_CHARS` / `normalizeSegment` / `normalizeSegments` / `trimSegments` 这几个**必须留在模块作用域** —— `createPanelStore()` 与 `SideBranchBody` **两边都用**（store 里做持久化形状校验、组件里做流式写入）。放进其中一边，另一边就会 `ReferenceError`，而那个错**只会出现在浏览器 console 里、被事件派发吞掉**（现象：面板静默不动、答案不显示）。`scripts/client-check.mjs` 就是为了抓这类错误。

**不要删掉实例租约（`side-branch-instances/`），也不要绕过它做孤儿清理。** 清理判据是"磁盘上的 `side-*` 不在本进程账本里"，而账本**在启动时必然是空的** ⇒ **两个共用同一个 `DSH_HOME` 的实例同时跑**时，后启动的那个会把先启动的那个**正在用的**侧枝目录当孤儿删掉。所以清理前必须先立自己的租约、再看有没有别的**活着的**外来租约 —— 有就**整个跳过**。

**`GET /side-branch/inherited` 的返回绝不能进面板持久化状态。** 一份主会话前缀可能几十万字符，而面板状态走 `sessionStorage`（5–10 MB 配额）⇒ 塞进 `rounds`/`normalizeRound` 会立刻爆配额、坏掉"刷新不丢"。它只放组件内存态、按需拉取。

**SSE 响应是整条手写的**（`Connection: close`）。换成框架自带的写法会坏，原因写在 `lib/index.js` 的 `handleStream` 注释里。

**客户端一切输入都不可信。** 问题长度、模型标识、`conversationId` 归属都要在宿主侧校验。

**只读的四条护栏都别动**：`ALLOWED_TOOLS` 常量、`setup(agentCtx)` 里的 `tools.guard`（拿不到就 `throw`，fail-loud）、`ROUTE_METHODS`（405 + `Allow` 的方法契约）、以及宿主侧对 `conversationId` 归属的校验。

**`peerDependencies` 里的 `@deepseek-ai/cordis` 是声明性的**：插件代码**不 import 它**（宿主半的运行期服务全部经 `ctx` 软获取，客户端半只 `require` 平台内置模块）。它是按生态惯例声明的，用来表明本插件挂在哪套契约上——**别当成漏删的依赖删掉**，也别为了"用上它"去加 import。

## 为什么这样做（改动前先读，别照着直觉改回去）

下面这些是"看起来更省事、但会破坏本插件前提"的做法，以及我们为什么不走。**它们不是历史记录，是取舍本身**——不写下来，下一个维护者很可能会去试。

**只读为什么必须在执行层。** 直觉做法是 `toolFilter:{allow:[]}` 或 `tools.restrict`——它们作用在**提示词层**（工具从提示词里消失），功能上确实达到只读。代价是侧会话的提示词前缀不再与主会话逐字一致，父会话已有的**前缀缓存全部失效**，每轮都要重算整个上下文。所以只读改用 `ctx.tools.guard()`（`dsh-tools` 的公开契约），作用在**执行层**：工具仍在提示词里，模型可以尝试调用，但执行被拒 ⇒ 提示词一个字不动，缓存照旧命中。guard 必须注册在**该侧 Agent 自己的 ctx** 上（`setup(agentCtx)` 内取），官方语义是经 `agent.ctx` 注册的 guard 只作用于该 agent——这对并行存在的多段侧枝会话是必需的。

**为什么不用官方的可续子会话。** `ctx.subagents.startContinuable` 表面上正好合适（官方提供的、可继续对话的子会话），但它结算时会把子会话的最终回答当成一条**父会话用户消息**投回父会话，并唤醒父模型跑一整轮（`dsh-subagent` 的 `watchSettlement` / `notifySettlement`，官方 README 说明这是设计行为且没有开关）。对多数场景合理，但对本插件是致命的：直接违反"答案不进主会话"这个前提，还要为此多跑一轮模型。

**为什么自建侧会话、以及为什么种子取"已完成回合前缀"。** 现在的做法是 `ctx.agents.create()` 建一个**普通侧会话**（`meta.parentSession` 只当血缘，**不设** `origin:'subagent'` —— 不需要子代理的生命周期，也不想让主会话里出现子代理卡片），出生时用公开的 `session.snapshotEvents()` 读出父会话事件、自己切到最后一个 `turn/end` 当种子，再在 `setup` 里 `agentPresets.composeFrom(agentCtx, parent.ctx)` 继承父会话的 preset/工具/persona。这样提示词前缀与父会话逐字一致，**继续命中原有的前缀缓存**。

**为什么每轮都"重建"（re-fork），而不是让一段会话一直活下去。** 一段会话活着，它的种子就冻在建段那一刻 —— 主会话之后聊了什么，这条分支**永远看不到**，用户只能「清空」另起一段（0.1.x 就是这样）。反过来，每次追问都新建一段、重新取主会话**最新**的已结算前缀当种子、再把侧枝自己历来的问答重放进去，就同时拿到两件事：**主会话的更新**和**侧枝自己的连续**。缓存上也不亏：主会话最新的那段内容**刚被主会话自己请求过**，很可能还在供应商的热缓存里，re-fork 的请求前缀正好和它对得上（走缓存读）；而"前缀冻结 + 往后追加"的做法里，同样的内容是被侧枝**第一次**以那种形态发出去（走缓存写）。**只在有变化时才重建**（主会话没长、模型也没换 ⇒ 沿用当前段）：种子会逐字节相同，重建只会多一条平台删不掉的会话记录与一次深拷贝。

**为什么侧会话要归档、又为什么要"跑前解锁、跑完回藏"。** 侧会话是一条**真实会话**，不处理它就会在左侧边栏多出一行、和用户自己的对话混在一起。官方把会话从分组界面藏起来的唯一手段就是**归档**（官方 README 自己把归档集描述成 "sessions hidden from every grouping surface"），所以本插件建段即归档。问题是 `0.1.7-rc.1` 给"已归档"加了第二层语义：**已归档 ⇒ 不许运行**（`ArchivedSessionGate` 在 `agent/pre-step` 上拒绝）。于是"建段即归档"这个写法在新版本上会**自己把自己锁死**（每一轮都在 `followup` 之前被拦，连模型请求都不发）。而**不能**改成"干脆不归档"就完事——那会让侧会话重新出现在会话列表里，那是产品体验、不是实现细节。现在的取舍是三步：**空闲时归档（列表干净）→ 每轮投递前取消归档（不被闸）→ 该轮结算后再归档（列表重新干净）**。代价如实登记：回答进行中它可能短暂出现在侧栏，以及每轮多两三次持久写盘。另一条路是官方 `origin: 'subagent'`（侧栏原生隐藏子代理来源的行），但它会连带子代理的生命周期语义，与"不设 `origin:'subagent'`"那条前提冲突，所以没走。

**为什么分支引导词拼在问题前面。** 引导词若进系统提示词，前缀就与主会话分叉、缓存全废。所以它拼在**每段第一轮的问题前面**，且同段内必须逐字一致。

**为什么设置不走官方设置服务。** `settings.register(ns, schema)` 要的是 **schemastery 的 `z<T>` 本身**（`dsh-settings` 的 `resolve()` 会直接调用它，schema 必须可调用），而 `@deepseek-ai/schemastery` 是平台内置包，从插件工作区里**静态 import / 动态 import / `createRequire` 三种方式都解析不到**（一律 `ERR_MODULE_NOT_FOUND`）；手工造一个"兼容 schema"也不行（节点对象靠属性工作、不可调用）。⇒ 设置改为客户端 `localStorage` 持久化、每次请求把值带给宿主，宿主只做校验与夹紧。代价是官方设置页里看不到这个命名空间，插件自带齿轮面板。

**为什么到达上下文上限是"拒绝"而不是"丢最早的轮次"。** 后者实现更简单、用户也不会被打断，但会让模型**静默失忆**：它不记得被丢掉的内容，却仍然表现得像记得，用户很难察觉。所以做法是**到上限就拒绝发送**，把 `used` / `limit` / `window` 一起回给面板（`contextFull`），**绝不截断历史**。

⚠️ **判据在 0.2.0 从"读 usage"改成了"估算"。** re-fork 之后新会话**还没有跑过任何一轮** ⇒ 老判据 `conv.lastContextTokens`（子会话 `assistant/message` 的 `input + cacheRead`）必然是 `undefined`，用不了。现在的口径（`estimateRequestTokens`）是：

```text
used ≈ 父会话前缀的提示词 tokens（实测：父会话日志里最后一条 assistant/message 的 input + cacheRead + cacheWrite）
     + (侧枝历史字符数 + 本轮问题字符数) × CONTEXT_ESTIMATE_SAFETY
```

超过 `contextWindow × CONTEXT_LIMIT_RATIO`（0.8）就拒绝。拿不到 `contextWindow` 时上限取 `CONTEXT_LIMIT_FALLBACK_TOKENS`，拿不到父会话 usage 时父前缀那半取 `CONTEXT_ESTIMATE_PARENT_FALLBACK`。⚠️ **不从父 Agent 上读 `lastContextTokens`**：**父 Agent 上没有这个字段**（那是本插件自己按会话事件维护的）。

⚠️ **如实登记：`used` 是估算值。** 父前缀那一半是实测，侧枝历史与问题那一半是"字符数 × 安全系数" ⇒ 面板上显示的这个数字**不是**实测用量，它和该轮结束后用量行里的真实数字对不上是正常的。宁可早拒也不误发。

**为什么放行名单不可配置。** 只读承诺的支点越少越好。如果放行面由"宿主常量 × 设置里的名字集合 × 客户端提交上来的子集"三者求交而成，三处必须始终一致，任何一处写错都可能让放行面变宽。现在只有一处：`ALLOWED_TOOLS` 与 `TOOL_CHOICES` 两个同源常量——模型看到的分支引导词也从同一个常量取，所以"告诉模型能用什么"与"执行层实际放行什么"不可能分叉。代价是用户无法自行收窄权限，想收窄只能改代码。

**几个不改会出事的实现细节**（都在代码注释里有详细说明，这里只列点）：闲置到点是让侧会话**睡觉**（`resume` 唤醒**必须显式传 `agentOptions`**，否则那一轮 ~25ms 静默空转）；`tab.signal` abort 只断流、**不删面板状态桶**；SSE 响应整条手写、显式 `Connection: close`（框架自带写法会声明 chunked 而实际发裸数据）；宿主文案由客户端随请求发下 `locale`（宿主进程里没有浏览器的 locale）。

## 宿主 HTTP API

所有路由先过 `ctx.connection.requestRejection` 的信任栅栏。

| 方法与路径 | 请求体 | 响应 |
| --- | --- | --- |
| `POST /side-branch/start` | `{ sessionId, question, selection?, conversationId?, locale?, settings? }` | `{ jobId, conversationId, handoff?, synced?, notice? }`；失败时 `{ error, code }`，可能另带 `conversationGone: true`、`contextFull: { used, limit, window }` |
| `GET /side-branch/stream?job=<jobId>` | — | SSE：`snapshot` / **`segment`** / `delta` / `reasoning` / `reset` / `replace` / `tool` / `done` / `error` / `stopped` |
| `POST /side-branch/stop` | `{ job }` | `{ status }`，只停这一轮，侧会话保留 |
| `POST /side-branch/close` | `{ conversationId }` | `{ status }`，释放这一段侧会话 |
| `GET /side-branch/inherited?conversationId=&locale=` | — | **只读**：这一段**实际继承到**的主会话回合（`{ turns, chars, truncated, parentHasNewer, synced }`；最后一轮全文、更早每轮一行摘要） |
| `GET /side-branch/settings` | — | `{ settings: { quickEntry } }` |
| `POST /side-branch/settings` | `{ settings: { quickEntry } }` | `{ settings: { quickEntry } }` |

`/start` 响应里三个可选字段的含义（客户端按它们决定行为）：

- `handoff: true` = 这一次**重建了**这一段（re-fork）。历史是**接得上**的 ⇒ 客户端**不要**画"以下是新的一段"分隔线。
- `synced: { turns, chars }` = 这一次继承了多少主会话内容（面板那一行「已继承主会话 N 轮 · 约 X 字」）。
- `notice` = **注入给模型的分支引导词全文**（只有真的拼了的那一轮才回，即每段第一轮）。这是本插件注入的**唯一**文本；系统提示词与工具声明是 DSH 自己组装的，不属于本插件、不在这里给。

SSE 的载荷变化（0.2.0）：新增 `segment`（进入下一个 step ⇒ 开新段）；`snapshot`/`done`/`stopped`/`error` 都带 `segments`（有序段落 `{kind, text, turn, step}`）；`reset`/`delta`/`reasoning`/`replace`/`tool` 都带 `turn`/`step`（客户端靠它精确地把 `reset` 限定在**同一个 step** 上）。

设置只有一项：`quickEntry`（主会话快速入口按钮的开关）。**不接受**客户端提交工具名单——放行名单是宿主侧的常量，插件不提供"自选可用工具"的功能。若哪天要给这个功能开口子，先读 `lib/index.js` 头部「只读必须在执行层保证」那一段。

失败的响应带机器可读的 `code`，一律 `side-branch/` 前缀加 kebab-case，例如 `side-branch/question-too-long`、`side-branch/context-full`。客户端按 `code` 分支，不按文案分支。路径存在但方法不对时回 **405 + `Allow`**（支持的方法表在 `lib/index.js` 的 `ROUTE_METHODS`），不是 404。

## 验证改动

> ⚠️ 下面这两条命令**只在源码仓库里有效**：`scripts/smoke.mjs` 与 `scripts/client-check.mjs`
> 都不随 npm 包发布（前者读 `lib/` 与 `package.json` 做源码级断言、后者真的把客户端 bundle 跑起来，
> 两者脱离源码树都没有意义）。
> 如果你是照 npm 装好的插件在做二次检查，请到仓库里跑。

```powershell
node scripts/smoke.mjs        # ① 源码级契约自检
node scripts/client-check.mjs  # ② 客户端运行时自检
# 两条一起跑：npm run check ｜ 只跑客户端那条：npm run client-check
```

**① `scripts/smoke.mjs`（源码级）** 不需要 DSH 运行时，直接加载宿主半并用假 ctx 调 `apply()`。当前共 **136 条断言**，分九节：

1. 模块能加载、导出名与 `package.json` 一致、路由前缀是 `/side-branch`、卸载 disposer 可调用；
2. **只读承诺**：`ALLOWED_TOOLS` 与 `TOOL_CHOICES` 仍是那六个名字且互相一致，九个危险工具名都不在其中；客户端没有工具开关的残留、宿主不接受客户端提交的工具名单；分支引导词的名单直接来自常量；guard 的判据仍是按名单放行、注册点仍在 `setup(agentCtx)` 里、拿不到 guard 仍 fail-loud。
   ⚠️ 这一项里"guard 的判据"是**源码级正则断言**，不是真的驱动一次拦截 —— 真拦截要靠端到端（见下）；
3. 客户端 bundle 存在、inject 仍是那五个服务名、不含调试导出；
4. `package.json` 与 `cordis.patch.yml` 的包名一致；
5. `dsh.client.inject` 里每个包在本机 DSH 安装目录里真实存在（用 `DSH_INSTALL_DIR` 指定路径，找不到就跳过这一项）；
6. **归档闸对策**：解锁必须排在 `followup` 之前、必须经 `typeof` 特性探测、失败不得抛；回藏必须挂在 `finishJob`、要有界退避、同样不得抛；建段仍然先归档。这一节守的就是"同一份源码同时兼容 0.1.5 与 0.1.7"这条线；
7. **Re-Fork 架构（0.2.0）**：`shouldReFork` 必须**同时**判"主会话多了已结算回合"与"模型/推理等级变了"两条；`parentCut` 必须在**建段时**就记（睡觉/唤醒也要带着它走，漏了就是每轮白 re-fork）；重放白名单**正好**是 5 种 surface 事件（`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`）且不含纯日志事件；重放**绝不复制 `sourceEventSeqs`**；重放**不截断**；**先重放成功、再释放老会话**（失败时丢弃刚建的新会话）；每轮 re-fork 都回 `handoff: true`；旧的 `seedSource` 换段路径已彻底删除。这一节还守着上限改成估算的三处：`estimateRequestTokens` / `lastPromptTokensOf` 存在，且**不再**用 `conv.lastContextTokens` 那条 re-fork 之后必然为 `undefined` 的旧判据；
8. **多段回答（0.2.0）**：`job.segments` 有序段落；`start` 帧按 `turn`/`step` 分流（同 step 换 `attemptId` 才算重试 ⇒ 只丢该 step，step 变了 ⇒ 发 `segment` 开新段）；`replace` **只**替换当前段；`snapshot` 与终态都带 `segments`；`syncSegmentShortcuts` 让 `text`/`reasoning` 成为段落数组的**纯函数**；旧的 `attempts` 字段已拆成 `steps`/`retries`；客户端 `normalizeSegments` 对**老数据**（只有 `answer`/`reasoning`）向后兼容；另守「引用随轮入档」：发送时把收窄后的引用原文记进该轮（`reference`），渲染成问题上方的可折叠引用块，并**自动清空**引用槽；`normalizeRound` 保留它 ⇒ 刷新后引用块还在。
9. **启动清理与只读路由（0.2.0）**：`/inherited` 登记进 `ROUTE_METHODS`（不登记的话错方法会掉进 404，破坏 405 + `Allow` 契约）；`handleInherited` 按"最后一轮全文 + 更早每轮一行摘要"截断；继承内容**不进** `normalizeRound`（只放组件内存态）；孤儿判据要求目录名**正好**是 `side-<uuid>`；**实例租约**（`side-branch-instances/*.json`，心跳 + PID 判活）；发现别的活着的实例就**整个跳过**；删除留**清单日志**；清理严格限定在 `sessions` 根目录下、只认 `side-` 前缀（不碰 `session-*` 主会话）。

**① 不验证**的东西：回答质量、真实 guard 拦截（第 2 节那几条是**源码级正则断言**，不是真驱动一次拦截）、SSE 行为与界面 —— 客户端那半由下面的 ② 补到"渲染树"为止；真实 DOM 布局 / CSS / 真实滚动位置 / 真实网络 / 真实模型它同样够不到，那几处只能靠仓库**外**的一次性 headless 端到端 harness（见下）与人工。

### ② 客户端运行时自检（`scripts/client-check.mjs`）

```powershell
node scripts/client-check.mjs            # 只跑这一条
node scripts/client-check.mjs <别的 client.js 路径>   # 反向验证脚本本身（见下）
```

**为什么会有它。** 人工看面板时连撞了几个 bug，而当时**三处自动化全都查不出来**：`node --check` 只看语法；`scripts/smoke.mjs` 是**源码级正则断言**；端到端 harness 打的是 **HTTP 路由、根本不加载客户端**。最严重的一个是：`const MAX_SEGMENTS = 200` 等常量写在 `createPanelStore()` **内部**，却在 `SideBranchBody` **组件**里用 ⇒ 第一个 SSE `delta` 帧一到就抛 `ReferenceError: MAX_SEGMENTS is not defined`，被浏览器的事件派发**吞掉**（只在 console 里）⇒ 每个增量都丢、**答案永远不显示**，用户看到的是"问了之后面板像卡住"。这个脚本就是为补这个窟窿写的，并且**反向验证过**：拿一份故意改坏的副本跑，它确实 FAIL 并打印 `FAIL  SSE 帧 snapshot 的处理函数抛错：MAX_SEGMENTS is not defined`。

**它怎么做到的。** 不装浏览器，而是在 Node 里把 `lib/client.js` **真的跑起来**：bundle 的形态是 `window.__ModuleLoader__.load({ factory })`，它只从 `require` 取三样东西 —— `react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives`（后两样**故意不提供**，bundle 自带降级分支，正好连降级路径一起测了）；用到的 React API 只有 **8 个**（`createElement` / `useState` / `useEffect` / `useLayoutEffect` / `useReducer` / `useRef` / `Fragment` / `Component`），所以一个极简 React + 极简 DOM 就够。面板的能力**全部来自席位的 `inject` face**（`inject: () => ({ startSideBranch, … })`），脚本照官方那样把它展开进 props —— 顺便也就验了 face 里该有的键。再用真实形状的 `fetch` / `EventSource` 桩驱动：往输入框打字（走真实 `onChange`）、点发送（走真实 `onClick`）、喂真实形状的 SSE 帧。

**它验了什么。** bundle 能装载、导出 `apply()`、正文组件被注册并渲染成功；客户端把词典注册进了 locale 服务（断言因此盯的是**真实文案**，不是"返回 key"那种弱断言）；点发送确实发**一次** `POST /side-branch/start` 且带上问题原文，并打开指向该 job 的 SSE 流；喂进去的每一帧都有监听函数；**多段正文都渲染出来且顺序正确、工具行夹在两段正文之间**（"只剩最后一段"那个 bug 的回归判据）；注入的分支引导词全文可见；**自动滚底落在真正可滚动的那一层**上（`.dsh-side-branch-scroll`），而不可滚动的轮次列表上没有挂 ref。

当前共 **34 项**，PASS/FAIL 直接看 stdout（全过时末行是 `全部通过（34 项）`，有失败则以非零退出码结束）。

⚠️ **它不覆盖什么（如实登记）**：真实 DOM 布局、CSS、真实滚动位置、真实浏览器事件、真实网络与真实模型。它是**"数据 → 渲染树"这一段的测试，不是浏览器测试** —— 那几处仍然只能人工在浏览器里看。

**可选参数用于反向验证脚本本身**：`node scripts/client-check.mjs <别的 client.js 路径>` 让它去跑另一份 bundle（例如一份故意改坏的副本），那份**必须 FAIL**。**一个不会失败的测试等于没有测试。**

**手工**端到端验证需要：

1. 一个已装好本插件的 profile；
2. 一个主会话，至少完成一个回合；
3. 在页面里划选文字、打开面板、提问；
4. 检查启动日志出现 `[side-branch]` 前缀的行。

仓库内**有两个自检（源码级 + 客户端运行时），但没有端到端套件**。改动 guard、提示词前缀、模型可见文本（`PROMPT_TEXT`）、归档闸那几处、Re-Fork、多段回答或 SSE 时，第 2 步到第 4 步必须人工跑一遍；改动**客户端半**（`lib/client.js`）时同样必须人工跑一遍 —— `scripts/client-check.mjs` 只把"数据 → 渲染树"那一段自动化了，界面本身还是得自己看。

### 仓库外的一次性 headless 端到端 harness

仓库里**没有**端到端套件（它是测试资产：不随 npm 包发布，也不该留在工作区里）。当改动落在单测够不到的地方 —— guard 的真实拦截、提示词前缀、归档闸、Re-Fork、多段回答、SSE —— 就自己搭一个**一次性** harness。做法：在**同一个 DSH 进程**里同时扮演两个角色 ——

- **客户端**：先按官方信任栅栏换成浏览器会话 cookie，再打插件**真实的** `POST /side-branch/start`，并读 `GET /side-branch/stream` 的 SSE；
- **主会话**：用 `ctx.agents.create` 建一条**真的**父会话（`agentPresets.resolve` + `mount` 挂上 `standard` preset，所以**有工具**）并跑真回合。

它能覆盖 `scripts/smoke.mjs` 够不到的那几处：侧枝这一轮**真的走了工具**（`tool/call` + `tool/result` 都在）；主会话推进后追问 ⇒ re-fork（`conversationId` 变了、`handoff: true`、继承轮数递增）；re-fork 后模型同时答得出**三个来源**的暗号（只在侧枝历史里的 / 只在最新主会话前缀里的 / 只在**被重放的工具结果**里的）；主会话没变化 ⇒ **不**重建；只换推理等级 ⇒ **也**重建；`GET /side-branch/inherited` 返回 200 且最后一轮有全文、错方法回 **405 + `Allow: GET`**；侧枝自己的暗号**没有回流**主会话；跑完的侧枝**回到归档集合**；伪造 `conversationId` 回 `conversation-gone`；以及"被重放的 `tool/result` 与新段里那条 `tool/call` 的 `toolCallId` 对得上"（孤儿工具结果是这条链路最阴的坑）。

⚠️ 只在**发布前**做一次性验证：跑完别把 harness 提交进仓库，也别把它的日志或结论写进 `docs/`。

## 提交与推送

- **提交信息（commit message）一律用英文。** 这是公开仓库、历史面向英文读者：标题用 `type: 祈使句`（如 `fix: un-archive the side session before each turn`），正文讲"为什么"，**不要混中文**。
- 建议拆成两个提交：`lib/` + `scripts/` 的行为改动一个，纯文档 / 版本号一个。
- **推之前**先跑 `node scripts/smoke.mjs` 与 `node scripts/client-check.mjs`（上一节；或 `npm run check` 两条一起跑），并在真宿主里人工跑一遍受影响的链路。
- 版本号与 `docs/CHANGELOG.md` 同步更新；发布时打 `v<version>` 标签（已有 `v0.1.0`、`v0.1.1`；当前版本是 **0.2.0**）。
- 远端：`origin` = `github.com/wucl12/dsh-side-branch`，主分支 `main`。
