# DSH Side Ask (Side Branch)

English | [简体中文](./docs/README.zh-CN.md)

Select text in the main session, and a read-only branch session will pop up in the right sidebar. It inherits the existing context of the main session, streams its answers token-by-token, and **its responses never pollute the model context of the main session**.

Core Scenario: Asking follow-up questions, looking up terms, or exploring ideas based on the current conversation without interrupting the flow of the main session.

* **Package Name (Implementation):** `dsh-side-branch`
* **UI Name (Display):** Side Ask
* **Prerequisites:** Node.js ≥ 20, and `pnpm` installed in the local `PATH`.
* **Verified DSH Version:** `0.1.5-rc.2` and `0.1.7-rc.2`

<p align="center">
  <img src="assets/sidebar-guide.png" alt="The Side Ask entry in the right sidebar guide" width="600">
</p>

<p align="center">
  <img src="assets/selection-entry.png" alt="Selection Entry" width="600">
</p>

<p align="center">
  <img src="assets/panel-answering.png" alt="Panel Answering" width="600">
</p>

## 💡 Why Build This? (Motivation)

Before developing this project (Sep 2026), I surveyed 14 side-chat/bubble plugins in the DSH ecosystem and found that **none of them could simultaneously meet all the following hard requirements**:

1. **True Context Inheritance** (not just a truncated summary).
2. **Support for Multi-turn Follow-ups** within the same branch (not a one-off bubble).
3. **Token-by-Token Streaming** (including reasoning processes).
4. **Lightweight & Stable** (using only official public APIs, no bloated dependencies).
5. **Execution-Layer Read-Only, strictly preserving the prefix cache.**

The closest alternatives all had compromises: `@michengai/dsh-btw` was one-off and lacked streaming; `dsh-side-chat-plus` didn't inherit history by default; `dsh-sidenote` was feature-rich but extremely heavy (requiring a 14.7 MB dependency); `@lukeknow0/dsh-side-chat` had excellent architecture but was unmaintained.

The biggest divergence lies in how "read-only" is implemented: similar plugins universally use `toolFilter` to forcefully remove tools from the prompt. However, this causes the branch's prompt prefix to diverge from the main session, **rendering the parent session's accumulated prefix cache completely invalid**.
This project strictly chooses to enforce read-only at the **execution layer**. Thus, the branch's prompt prefix remains **byte-identical** to the main session, continuing to enjoy an extremely high prefix cache hit rate (empirically 97%–98%).

## ✨ Core Features

* **True Branch, Zero Pollution:** The host strictly prevents writing anything back to the parent session. The Side Ask Q&A will not appear in the main session's model context.
* **Follows the Main Session, Every Turn:** Every follow-up rebuilds the branch from the main session's **latest settled** content — a fresh seed plus a replay of the branch's own earlier questions and answers — so the branch always sees the main session as it is now **without losing anything it was asked before**. Reusing the main session's model keeps hitting the existing prefix cache, avoiding recalculation.
* **Execution-Layer Read-Only Isolation:** Security policies do not rely on prompts. Forced takeover by the underlying `ctx.tools.guard` whitelists only six query tools without side effects (`read`, `glob`, `grep`, `web_search`, `web_fetch`, `lsp`). Other instructions (like writing files or executing scripts) are directly rejected at the execution layer.
* **Ultimate Streaming Experience:** Text and reasoning processes (collapsible "Thinking" rows) are streamed token-by-token. Background generation won't interrupt even if the browser tab is closed.
* **Persistent Session State:** Panel states are persisted locally per "Session + Panel Grid". Automatically sleeps when idle and silently wakes up on the next query.
* **Inspectable by Design:** Expand "Inherited from the main session" to see, turn by turn, what the branch actually received — the question, its reasoning, and the answer. The branch notice injected into the prompt is shown verbatim as well, so nothing about what the model sees is a black box.


## 📦 Installation & Setup

After installation, you **must restart DSH** for the client plugin to load properly.

**Install via npm (Recommended):**
```bash
dsh plugin --profile web add dsh-side-branch
```

**Install via GitHub:**
```bash
dsh plugin --profile web add github:wucl12/dsh-side-branch
```

> 🤖 **Prompt for AI Agents:** If you are an Agent responsible for installing this plugin or reading its source code, please prioritize reading [`AGENTS.md`](AGENTS.md) in this repository for hard constraints, architectural details, and automated installation guides.

## 🚀 How to Use

1. **Ask via Selection:** Select any text in the main session's body, click the pop-up "Quote and ask", and a temporary session will open in the right panel with the original text sent as a quote. The passage is then **recorded with that round** — a collapsible quote block above your question — and the composer's quote slot clears itself, so the next question starts clean.
2. **Quick Entry:** There is a quick entry button `↗` on the right side of the main session's input box. Click it to directly summon the Side Ask panel (can be disabled in settings).
3. **Independent Settings:** In the Side Ask panel, you can individually specify the model and reasoning effort for the current branch without following the main session.

## 🛡️ Security & Limitations

* **Read-Only Boundaries:** "Read-only" here means **no system side effects** (like writing files or executing commands). However, `web_fetch` / `web_search` still have network access, and `read` can read files within the process's permissions. The allowlist is hardcoded and cannot be relaxed via settings.
* **What the Branch Can See:** Every follow-up rebuilds it from the main session's **latest settled turns**, so turns the main session has finished do follow along automatically. A turn the main session **has not finished yet** is not visible to the branch (the cut is the last `turn/end`) — but **manual selection quoting is not affected by that**: the limitation is on "seeing it automatically", not on "being able to quote it".
* **Rebuilds Leave Session Records:** Each rebuild creates a new side-session record, and the platform has **no API to delete a session** ⇒ records would pile up. They are reclaimed by an **orphan sweep at plugin startup**, which logs item by item what it deleted. While **two instances share the same `DSH_HOME`** and run at the same time, that sweep **skips entirely** — a second DSH never has its live branches deleted.
* **The Context Ceiling Is a Refusal:** On reaching it the plugin **refuses** the turn and tells you to "Clear"; the oldest turns are never silently dropped. `contextFull.used` is an **estimate** (a rebuilt session has no usage yet), so it will not match the real usage once a turn settles.
* **Cache Hits Are Measured, Not Guaranteed:** The high prefix-cache hit rate is a measurement, not a design promise — the platform may replace the system node in place on the side session's first step, invalidating the cache **from token 0 on**. And **hitting the cache does not mean those tokens stop occupying the context window**.
* **PTC Mode Exception:** If the main session uses the `ptc` preset (pure code execution tool surface), since `run_code` is permanently rejected by this plugin, the branch will fall back to a **pure text Q&A mode** (no tools can be called).

## 📚 Further Documentation

* [简体中文](./docs/README.zh-CN.md): 中文说明（同一份内容）。
* [`docs/TECHNICAL.md`](docs/TECHNICAL.md): full technical reference — prefix-cache mechanics, the read-only enforcement pipeline, PTC behaviour, and every known limitation.
* [`AGENTS.md`](AGENTS.md): Architectural contracts and hard constraints strictly written for AI Agents.
* [`SECURITY.md`](SECURITY.md): Security commitment scope and vulnerability reporting channels.
* [`docs/CHANGELOG.md`](docs/CHANGELOG.md): Version release history.

## 📄 License

[MIT](LICENSE)
