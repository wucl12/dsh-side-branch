# Changelog

[中文](#中文版本记录) · English

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
