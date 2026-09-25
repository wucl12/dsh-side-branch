# Changelog

[中文](#中文版本记录) · English · [README](../README.md)

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
