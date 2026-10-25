# Changelog

[中文](#中文版本记录) · English · [README](../README.md)

## 0.2.2

Two bugs fixed. Both were cases of a branch behaving differently from the main session for no good reason.

- **A turn no longer has a wall-clock timeout.** Every turn used to be killed 90 seconds after it started ("Request timed out (90s)"), even while the model was still streaming, still thinking, or inside a long tool run — while the same question in the main session simply kept waiting. The hard cap is gone. What remains is a **stall watchdog**: it only fires after 30 minutes with **no event at all**, and every stream frame and every session event (tool calls, usage, messages) resets it. So a long turn is never cut off, while a genuinely wedged job cannot stay "running" forever (which would leave that branch permanently busy and leak a concurrency slot). A dead model stream is still caught earlier by the platform's own `streamIdleTimeoutMs` (5 minutes per request, reset on every chunk).
- **The "quote and ask" entry now appears only in the main session's body.** The entry listens on `document` so it works anywhere in a conversation, and it used to be filtered by a blacklist of inputs — which meant that selecting text in the right-hand sidebar (an open markdown file, the settings dialog, another plugin's panel) also raised it. Clicking it then quoted **text that is not part of the main session** into the branch's prompt. The entry now requires the selection to sit inside the conversation surface (`[data-conversation-content]`, falling back to `[data-conversation-scroll]`) and excludes the right sidebar — including the embedded sub-agent conversation it can host, which carries the same surface marker — and the composer seat. No conversation surface on screen means no entry (fail-closed) rather than a fallback to the old guesswork.
- **A failed turn now says why.** `turn/end` with `reason: { kind: 'error', error }` used to be flattened into "The ask ended abnormally: error", dropping the real cause (provider error, platform stream timeout, model offline). The message/code is now shown to the user.
- **0.2.1's documentation work ships here.** 0.2.1 was never published on its own; the README rewrite, the metadata changes and the `engines.dsh` declaration are all in this release.
- **Verified on DSH `0.2.1-rc.3`** in an isolated playground instance: the plugin loads, the `/side-branch` routes register and answer (200, and 405 + `Allow` for a wrong method), and the client bundle the browser receives carries the scoped entry. The long-turn path was not re-run against a real model in this round — it is covered by the new source-level assertions instead.

## 0.2.1

Documentation and metadata only — no behaviour change, no code change.

- **README rebuilt around what a first-time reader needs.** The first screen leads with the three situations the plugin is for, the install command and the restart warning follow immediately, and the guarantees are stated as outcomes rather than as mechanisms.
- **The comparison table moved to the end**, and one row is left as a deliberate loss: `dsh-sidebar-qa` supports nested follow-ups, this plugin does not.
- **Dropped an unsupported claim.** The README and `TECHNICAL.md` used to say that comparable plugins usually implement read-only through the prompt layer (`toolFilter` / `tools.restrict`). That was never verified, and it is not true of the closest alternative — the text now explains the design decision without asserting what anyone else does.
- **Documented how the plugin was built.** The codebase was written by DSH itself; the human work was direction, plan review and hands-on verification. See *How this was built* in the README.
- **Bilingual `package.json` description, English first, plus an `engines.dsh: >=0.1.5-rc.2` declaration.** dsh-market reads the latter for host-aware discovery and evaluates it with `includePrerelease`, so it is a declaration and not a gate.
- **Verified on DSH `0.2.0-rc.2`** — the plugin loads, the `/side-branch` routes register, and the panel was exercised by hand. The `0.2.0` boot-time peer gate only inspects `@deepseek-ai/dsh*` peer ranges, which this plugin declares none of.

## 0.2.0

Behaviour change: the branch now **follows the main session** instead of being frozen at the moment it was opened.

- **Re-fork.** Every follow-up whose main session has settled a new turn — or whose model/reasoning effort changed — rebuilds the branch: a fresh side session is seeded from the main session's **latest settled prefix**, the branch's own questions and answers are replayed into it, and only then is the new question delivered. The branch therefore always sees the main session as it is now, while keeping everything it was asked before.
  - **Only when something changed.** If the main session has not advanced and the model is unchanged, the existing segment simply continues — the seed would be byte-identical, so rebuilding would only add a session record (which the platform cannot delete) and a deep copy for no gain.
  - `conversationId` changes **whenever** a re-fork happens, and `/start` answers `handoff: true` so the panel does not draw a "new segment" divider: the history really is continuous.
  - **Failure is explicit.** If rebuilding fails, the previous segment is left untouched and the turn is refused with `side-branch/refork-failed`. The plugin never silently falls back to "a new session with no history" — the model would think the branch had never been asked anything while the panel still shows the old answers.
- **Fixed: a turn with several steps only showed the last step.** A turn can contain several steps, and every step opens a new streaming attempt and emits its own `start` frame; the plugin treated *every* `start` as a retry and cleared the accumulated text, so step 2 wiped step 1, and with only one `text` slot and one `reasoning` slot the intermediate output could not be kept at all. A job now keeps an **ordered `segments` list** (`{kind: 'reasoning'|'text'|'tool', text, turn, step}`), `start` frames are split by `turn`/`step` (same step with a new `attemptId` = retry, so only that step's segments are dropped), `chunk`/`tool/call` append to the current segment, and the terminal `replace` rewrites **only** the current segment. New SSE event `segment`; `snapshot`, `done`, `stopped` and `error` now carry `segments` so a refresh keeps every segment.
  - This also fixes a related wobble: when the last step had no text (a pure tool finish), the old "replace the whole answer with the final text" branch never fired and the panel kept *some* intermediate segment as the final answer.
- **Context limit is now estimated instead of read.** After a re-fork the new session has no usage yet, so the old `lastContextTokens` check cannot work. The host estimates: the parent prefix's prompt tokens (measured — the `input + cacheRead + cacheWrite` of the parent's last `assistant/message`) plus the branch history and question in characters. At the limit the turn is **refused** with the actual numbers (`contextFull: { used, limit, window }`); history is never truncated.
- **New: the panel shows what was inherited and what was injected.** A `▸ Inherited N main-session turns · ~X chars` row per segment, expandable into a lazy read-only `GET /side-branch/inherited` view (the last inherited turn in full, earlier turns as one-line summaries — truncated server-side, no model call, never persisted into panel state because a main-session prefix can be hundreds of kilobytes and panel state lives in `sessionStorage`). The branch notice that is injected into the prompt is also shown once, verbatim. System prompts and tool declarations are assembled by DSH, not by this plugin, and are deliberately not shown.
  - **The inherited reasoning is shown too, and counted.** The main session's thinking is part of the seed and *is* sent to the model — `dsh-llm-deepseek` serializes an assistant history `reasoning` block as `{ type: 'thinking' }` (only user and tool-result content drops reasoning). Each inherited turn therefore has its own collapsible `Thinking · N chars`, and `~X chars` counts question + reasoning + answer. Counting only the visible text under-reported what the model actually receives.
  - **The per-turn question is the first `user/message` of that turn only.** DSH appends its own runtime snapshot (file policy, approval policy, skills, time context — over a thousand characters) as a *second* `user/message` after every user turn, and concatenating them displayed that boilerplate as "what the user asked" and inflated the character count several-fold.
- **The quoted text is now part of the record.** Selecting text in the main session and clicking "Quote and ask" used to put the passage only into the prompt envelope: the panel showed just the question, so a round never recorded what had been quoted, and the one-line quote chip stayed in the composer until it was cleared by hand. A round now keeps the clipped reference (the exact text the model received) and renders it as a collapsible quote block above the question, and sending clears the composer's quote slot automatically so the next question starts clean. The quote survives a refresh with the rest of the panel state.
- **New: orphan side-session records are swept at startup.** Re-fork creates one session record per rebuild and the platform has **no** API to delete a session, so records accumulate. At `apply()` the plugin deletes `side-<uuid>` records that no instance can still be using. The sweep is guarded by an **instance lease** (`<DSH_HOME>/side-branch-instances/<pid>-<uuid>.json` with a heartbeat): if any other live instance shares the same `DSH_HOME`, the sweep is skipped entirely, so a second DSH never has its live branches deleted. Everything deleted is logged as a manifest.
- **Removed:** the "switch model ⇒ carry history into a new segment" path (`seedSource`, the `sameAgentOptions` handoff, `skipPrependNotice` handover). Re-fork subsumes it: changing the model is just another reason to rebuild. A `reasoningEffort` change counts as a model change too, so the chosen effort is never silently ignored.
- The prompt text now tells the model that its inherited history is rebuilt from the main session on every turn, instead of describing it as a snapshot taken when the branch was opened.

## 0.1.1

Fixes the branch being blocked on DSH `0.1.7-rc.1` and later.

- **A branch session is archived to keep it out of the session list; from DSH `0.1.7-rc.1` an archived session also becomes unrunnable.** `dsh-api-session-controller`'s `ArchivedSessionGate` rejects any model step proposed for an archived session, so every turn ended as `turn/end { reason: 'blocked' }` with no model request — the panel reported "content blocked by security policy", which was this plugin's own wording for that reason, not a content policy.
- The side session is now **un-archived immediately before each turn is delivered and archived again once it settles**, so an idle branch stays hidden and a running one is not gated. The re-archive waits and retries on a bounded backoff because the registry refuses to archive a session that still has activity; if it never succeeds the branch merely stays visible in the sidebar.
- **`unarchiveSession()` only exists from DSH `0.1.6-alpha.2`**, so the call is feature-detected: on `0.1.5-rc.2` (no method, no gate) both extra steps are no-ops and behaviour is unchanged. One published version therefore serves both DSH lines.
- **The model-facing text is now English in every interface language.** The branch preamble, its PTC variant and the guard's deny reason used to be translated per interface language; they now come from a single English `PROMPT_TEXT` constant, matching DSH's own English prompts and keeping the instruction set identical no matter which language the panel is in. User-visible strings still follow the interface language.
- Verified on DSH `0.1.5-rc.2` and `0.1.7-rc.2`; `scripts/smoke.mjs` gained nine assertions guarding this cycle, the feature detection, and the single English prompt text.

## 0.1.0

First public release.

- Read-only branch session derived from the main session: it inherits the completed-turn prefix and the agent preset, and keeps hitting the prefix cache when the main session's model is reused.
- Answers never enter the main session's model context.
- Read-only enforced at the execution layer by `tools.guard`: the allow-list passes `read`, `glob`, `grep`, `web_search`, `web_fetch`, `lsp`; everything else is denied. The allow-list is not configurable.
- Multi-turn follow-ups inside one branch; each branch can pick its own model and reasoning effort, and a new branch seeds from the previous history.
- Token-by-token streaming of the answer and the reasoning; a disconnecting client does not abort the background answer.
- Selection entry, plus a quick-entry button on the right of the main session's composer.
- Panel state kept per *session + panel pane*, surviving a page refresh.
- Idle side sessions release their live instance but keep their record, and wake on the next question.
- In-panel settings: the main-session quick-entry toggle.
- When the main session uses a PTC tool surface, the branch preamble switches to the one explaining that this branch offers no tools.
- Zero third-party runtime dependencies, no build step.

## 中文版本记录

## 0.2.2

修两个 BUG。两个都是"侧枝在没有理由的地方表现得和主会话不一样"。

- **一轮不再有总时长超时。** 以前每一轮从建 job 起算 90 秒就被无条件掐断（面板显示「请求超时（90 秒）」），哪怕模型还在流式输出、还在思考、或正卡在一次长工具里；而同样的提问在主会话里只是继续等。硬上限已删除，只留一个**停滞看门狗**：**整整 30 分钟一个事件都没有**才触发，而任何一个流式帧、任何一个会话事件（工具调用、用量、消息）都会重新计时。所以长回合永远不会被它掐断，而真卡死的 job 也不会永驻（永驻会让这一段会话永久 busy，还占着并发名额）。模型流真断掉的情况仍然由平台自己的 `streamIdleTimeoutMs`（每请求 5 分钟、收到 chunk 就重置）先收口。
- **「引用并提问」只在主会话正文区出现。** 入口的监听挂在 `document` 上（这样在会话里划字都能用），过滤原本只有一层输入框黑名单——于是右栏（打开的 md、设置弹层、其它插件的面板）里划字也会弹，点下去就把**不属于主会话的原文**引进了侧枝的 prompt。现在要求选区落在会话正文里（`[data-conversation-content]`，旧版退回 `[data-conversation-scroll]`），并排除右栏（含右栏里的子代理嵌入会话——它自己也带同样的正文标记）与 composer 座位。屏幕上没有会话正文时**不弹**（fail-closed），不再退回旧的黑名单猜测。
- **失败的一轮现在会说原因。** `turn/end` 的 `reason: { kind: 'error', error }` 以前被压成「提问意外终止：error」，真正的原因（供应商报错、平台流空闲超时、模型下线）全丢了；现在把 message/code 显示给用户。
- **0.2.1 的文档改动随这一版发布。** 0.2.1 没有单独发布；README 重写、元数据改动与 `engines.dsh` 声明都在这一版里。
- **已在 DSH `0.2.1-rc.3` 上验证**（隔离试验场）：插件加载成功、`/side-branch` 路由注册并能应答（200；方法不对回 405 + `Allow`），浏览器收到的 client bundle 带上了限定作用域的引用入口。这一轮**没有**再用真实模型跑长回合，那部分由新增的源码级断言守着。

## 0.2.1

仅文档与元数据，无行为改动、无代码改动。

- **README 按「第一次来的人需要什么」重写。** 首屏先讲这个插件适用于哪三种情况，紧接着就是安装命令与重启提示；各项保证改成讲结果，而不是讲机制。
- **对比表挪到文末**，并保留一行主动认输：`dsh-sidebar-qa` 支持嵌套追问，本插件不支持。
- **删掉一条没有依据的说法。** README 与 `TECHNICAL.md` 原先写「同类插件普遍在提示词层实现只读（`toolFilter` / `tools.restrict`）」。这从未核实过，而且对最接近的替代品并不成立——现在只讲我们自己的设计取舍，不再断言别人怎么做。
- **补上「这个插件是怎么写出来的」**：整个代码库由 DSH 自己完成，人负责的是定方向、审计划、亲手验证。见 README 的《它是怎么被写出来的》。
- **`package.json` 的 description 改为中英双语、英文在前**，并声明 `engines.dsh: >=0.1.5-rc.2`。dsh-market 会读取后者做宿主兼容性发现，并用 `includePrerelease` 求值，所以这是声明而不是闸门。
- **已在 DSH `0.2.0-rc.2` 上验证**——插件加载、`/side-branch` 路由注册、面板人工实跑通过。`0.2.0` 启动期的 peer 闸门只检查 `@deepseek-ai/dsh*` 的 peer 区间，本插件一个都没声明。

## 0.2.0

行为变更：侧枝不再冻结在开段那一刻，而是**跟着主会话走**。

- **Re-Fork（每轮重建）。** 只要主会话**结算了新的回合**，或者**模型/推理等级变了**，这一次追问就会重建侧枝：新建一条侧会话、种子取主会话**最新的已结算前缀**、把侧枝自己历来的问答**重放**进去，然后才投递新问题。于是侧枝看到的永远是"主会话此刻的样子"，同时一条都不丢自己之前问过什么。
  - **只在"真的有变化"时重建。** 主会话没长、模型也没换时，就沿用当前这一段 —— 种子会逐字节相同，重建只会白白多一条**平台删不掉**的会话记录和一次深拷贝。
  - `conversationId` **在重建时**会变，而 `/start` 一律回 `handoff: true`，所以面板**不会**画"以下是新的一段"分隔线 —— 历史确实是连续的。
  - **失败是显式的。** 重建失败时**上一段原样保留**，这一轮以 `side-branch/refork-failed` 拒绝。插件绝不静默降级成"没有历史的新会话" —— 那会让模型以为侧枝没聊过，而面板上还显示着旧答案。
- **修复：一个回合里多段回答只剩最后一段。** 一个 turn 可以含多个 step，每个 step 都会开一次新的流式 attempt、各发一个 `start` 帧；插件把**每一个** `start` 都当成重试并清空已累积正文，于是 step 2 一来 step 1 就没了，而 job 只有 `text`/`reasoning` 两个槽位、根本装不下多段。现在 job 保有**有序的 `segments`**（`{kind: 'reasoning'|'text'|'tool', text, turn, step}`），`start` 帧按 `turn`/`step` 分流（同 step 换 `attemptId` 才算重试 ⇒ 只丢那一个 step 的段落），`chunk`/`tool/call` 追加到当前段，终局的 `replace` **只**重写当前段。新增 SSE 事件 `segment`；`snapshot`/`done`/`stopped`/`error` 都带 `segments`，刷新后每一段都在。
  - 顺带修掉一处"显示哪一段是飘忽的"：最后一步**没有正文**（纯工具收尾）时，老代码"用终局文本整段替换"那条分支根本不触发，面板会留着**某一段中间输出**当最终答案。
- **上下文上限改成估算。** re-fork 之后新会话还没有 usage，老判据 `lastContextTokens` 用不了。现在按"父前缀的提示词 tokens（**实测**：父会话最后一条 `assistant/message` 的 `input + cacheRead + cacheWrite`）+ 侧枝历史与问题的字符数"估算。到上限就**拒绝**并把实际数字给面板（`contextFull: { used, limit, window }`），**绝不截断**历史。
- **新增：面板能看见"继承了什么、注入了什么"。** 每段一行 `▸ 已继承主会话 N 轮 · 约 X 字`，点开按需拉一次只读的 `GET /side-branch/inherited`（**最后一轮全文 + 更早每轮一行摘要**，服务端截断、不调模型；**绝不进面板持久化状态** —— 一份主会话前缀可能几十万字符，而面板状态走 `sessionStorage`）。注入给模型的分支引导词也**逐字**展示一次。系统提示词与工具声明是 DSH 自己组装的，不属于本插件，**刻意不显示**。
  - **继承来的"思考"也展示、也计数。** 主会话的推理**在种子里**，而且**确实会发给模型** —— `dsh-llm-deepseek` 把 assistant 历史里的 `reasoning` 块序列化成 `{ type: 'thinking' }`（只有 user / tool-result 内容才丢掉推理）。所以每轮里多一层可折叠的 `思考 · N 字`，而 `约 X 字` = **问 + 思考 + 答**。只算正文是**低报**：模型实际收到的比面板显示的多得多。
  - **每轮的「问」只取该轮第一条 `user/message`。** DSH 会在每个用户回合之后**追加一条自己那上千字的运行期快照**（文件策略 / 审批策略 / 技能清单 / 时间上下文）作为**第二条** `user/message`；拼起来看就会把那一大坨平台样板文字当成"用户问的话"，字数也被撑大好几倍。
  - **面板现在真的会自动滚到底了。** 原先"自动滚底"的 ref 挂在**不滚动**的轮次列表（`.dsh-side-branch-rounds`，`display:flex`）上，`scrollTop = scrollHeight` 是空操作 —— 只是以前内容短、看不出来。在轮次上方加了可展开的「继承 / 注入」区之后，新答案会被顶到可视区之外，现象就是"问了之后回答不出现"（其实回答已经在 DOM 里）。现在 ref 指向真正可滚动的 `.dsh-side-branch-scroll`，并在段落数变化与继承区展开/收起时也重新滚底。
  - **划选入口不再在侧枝自己的面板里弹出。** 那个按钮的语义是"把**主会话**原文引用进来"；在面板里点它会把这**一段自己**的内容引用回**同一段**（`quoteBus` 按最后聚焦的面板投递 ⇒ 确实会投给自己），形成自指循环。黑名单里加上了 `.dsh-side-branch-panel` 与模型选择悬浮窗。
- **引用原文现在会进入这一轮的记录。** 在主会话里划选文字、点「引用并提问」，以前这段话**只进 prompt 信封**：面板上只显示问题原文，所以一轮记录里查不到"我引用了什么"，而输入框上方那行引用条会一直挂着，得手动点 × 或「清空」。现在这一轮会保留**收窄后的引用原文**（与模型收到的**逐字一致**），渲染成问题上方的可折叠引用块；发送后引用槽**自动清空**，下一轮从干净的输入框开始。引用块随面板状态一起落盘 ⇒ 刷新后还在。
- **新增：启动时清理孤儿的侧枝会话记录。** re-fork 每次重建都会新增一条会话记录，而平台**没有**删除会话的 API ⇒ 记录会堆积。`apply()` 时删掉 `side-<uuid>` 形状、不可能还有实例在用的记录。清理由**实例租约**（`<DSH_HOME>/side-branch-instances/<pid>-<uuid>.json` + 心跳）把守：只要还有**别的活着的实例**共用同一个 `DSH_HOME`，就**整个跳过**，所以同时跑第二个 DSH 时绝不会删掉它正在用的侧枝。删掉哪些会**逐条记进日志**。
- **删除：** "换模型 ⇒ 带历史换段"那条路（`seedSource`、`sameAgentOptions` 交接、`skipPrependNotice` 手动传递）。re-fork 把它整个吸收了：换模型只是"该重建"的又一个理由。`reasoningEffort` 的变化同样算换模型，所以用户选的推理等级不会再被静默忽略。
- 推给模型的文本现在告诉它"继承的历史**每轮都会用主会话当时的最新内容重建**"，不再说"开段那一刻的快照"。

## 0.1.1

修复在 DSH `0.1.7-rc.1` 及之后版本上侧枝被拦的问题。

- **侧会话靠"归档"从会话列表里藏起来；而 DSH `0.1.7-rc.1` 起，已归档的会话同时变成不可运行。** `dsh-api-session-controller` 的 `ArchivedSessionGate` 会拒掉已归档会话的任何模型步，于是每一轮都以 `turn/end { reason: 'blocked' }` 收口、连模型请求都不发出——面板显示的是本插件自己给这个 reason 配的文案「内容被安全策略拦截」，与内容策略无关。
- 现在改为**每轮投递前先取消归档、该轮结算后再归档**：空闲的分支照样藏起来，正在跑的一轮不再被闸。回藏会按有界退避重试，因为注册表拒绝归档"仍有活动"的会话；即使始终失败，也只是这段分支留在侧栏可见。
- **`unarchiveSession()` 是 DSH `0.1.6-alpha.2` 才有的方法**，所以调用点做了特性探测：在 `0.1.5-rc.2` 上（既没有该方法、也没有那道闸）两步都是空操作，行为与旧版一致。因此同一份发布版本同时兼容两条 DSH 版本线。
- **推给模型的文本改成一律英文（不再随界面语言）。** 分支引导词、它的 PTC 变体与 guard 的拒绝理由原先按界面语言翻译，现在统一取自唯一的英文常量 `PROMPT_TEXT`：与 DSH 自身的英文提示词一致，也让面板用哪种语言时模型收到的指令完全相同。用户可见的文案仍然随界面语言。
- 已在 DSH `0.1.5-rc.2` 与 `0.1.7-rc.2` 上验证；`scripts/smoke.mjs` 新增 9 条断言守住这套循环、特性探测与"模型可见文本只有一份英文"。

## 0.1.0

首个公开版本。

- 从主会话派生只读分支会话：继承已完成的回合前缀与 agent preset，沿用主会话模型时继续命中前缀缓存。
- 答案不进入主会话的模型上下文。
- 只读由执行层 `tools.guard` 保证，白名单放行 `read`、`glob`、`grep`、`web_search`、`web_fetch`、`lsp`，名单外一律拒绝。放行名单不可配置。
- 同一段内多轮追问；每条可单独指定模型与推理等级，换段时把上一段历史作为种子。
- 正文与推理过程逐词流式；客户端断开不中止后台回答。
- 划选引用入口与主会话输入框右侧的快速入口。
- 面板状态按「会话 + 面板格」保留，刷新页面不丢。
- 侧会话闲置后释放活动实例并保留记录，下次提问自动唤醒。
- 面板内就地设置：主会话快速入口按钮的开关。
- 主会话使用 PTC 工具面时，分支引导词换成说明「本分支不提供任何工具」的那一份。
- 零第三方运行时依赖，无构建步骤。
