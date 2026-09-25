# AGENTS.md — Installation, Verification and Hard Constraints

[English](./AGENTS.en.md) · [简体中文](../AGENTS.md) · [README](../README.md)

Notes for automated agents: how to install and verify this plugin, and the hard constraints on changing it.

## What this is

`dsh-side-branch` is a DSH Web plugin. It derives a **read-only side branch session** from the main session, inheriting the main session's completed-turn prefix and its agent preset, and its answers **never enter the main session's model context**.

## Installation and verification

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

Success criteria: step 3's output contains `id: dsh-side-branch`, and step 4's startup log contains `[side-branch] 已注册 /side-branch 路由`.

Failure criteria and what they mean:

| Symptom | Cause |
| --- | --- |
| `ERR_MODULE_NOT_FOUND`, mentioning dsh-side-branch | the `name` in `cordis.patch.yml` does not match the `name` in `package.json` |
| `missing bundle` in the startup log | `dsh-side-branch` is absent from the profile's `dsh.profile.bundles`, or its dependencies are not installed |
| `missing bundle ... one build instruction` in the startup log | the client bundle does not exist (this repository commits `lib/client.js` directly, so this should not normally happen) |
| blank page, plugin list shows pending | the client `inject` names a service that does not exist |

## File structure

| Path | Role |
| --- | --- |
| `lib/index.js` | Host half. Registers the HTTP routes, creates the side session, attaches the read-only guard, drives turns |
| `lib/client.js` | Client half. Right-hand panel, selection entry point, SSE reading, settings area. A browser bundle, loaded by DSH as a static module |
| `cordis.patch.yml` | Bundle patch, inserts a single line, `name` must be the real package name |
| `package.json` | `dsh.bundle.patch` declares the patch; `dsh.client` declares the browser half |
| `scripts/smoke.mjs` | Contract self-check: loads the host half, verifies the read-only allow-list and the shape of the guard, confirms the dependency packages exist. **Only exists in the source repository** and is not published with the npm package (what it asserts is source shape, so it cannot run outside the source tree) |

## Hard constraints before changing anything

**Do not implement read-only with `toolFilter` or `tools.restrict`.** Both act at the prompt layer, which forks the side session's prompt prefix away from the main session's and invalidates the entire prefix cache. Read-only must be blocked at the execution layer with `ctx.tools.guard()`. The guard must be registered on that side Agent's own ctx (inside `setup(agentCtx)`).

**Do not touch the prompt prefix.** The branch preamble is concatenated in front of each turn's question; it does not go into the system prompt. The tool list is a plugin-level constant, so the list the model sees and the execution-layer criterion come from the same source. Changing any character of the preamble invalidates that segment's prefix cache.

**Do not translate the model-facing text back into Chinese, and do not keep one copy per language table.** The branch preamble, the PTC variant and the guard's deny reason all come from the single `PROMPT_TEXT` constant in `lib/index.js` (**English**); the zh/en tables merely reference it. Only **user-visible** strings (panel errors and hints) follow the interface language. Why: DSH's own system prompts and tool descriptions are English, so matching the platform's instruction language is more reliable; and **switching the interface language must not switch the prompt** (reproducible behaviour, comparable reports). `scripts/smoke.mjs` checks that this text contains no CJK and that both tables reference the same copy.

**Do not add "choose your own available tools" back.** The allow-list exists only in the two constants `ALLOWED_TOOLS` and `TOOL_CHOICES`, and the plugin does not accept tool names submitted by the client: one more configurable layer is one more place where the read-only guarantee can be broken.

**Do not revert to the official `ctx.subagents.startContinuable`.** On settlement it posts the child session's final answer back as a user message of the parent session and wakes the parent model for a full turn, which directly violates this plugin's premise.

**Do not add service names to the client `inject`.** Getting one name wrong leaves the fiber permanently pending and blanks the page. There are currently five: `slots`, `locale`, `sidebarRightTabs`, `sidebarRight`, `modelDirectories`.

**Do not remove the "un-archive before a turn, re-archive after it" cycle, and do not turn `unarchiveSession` into a hard call.** From DSH `0.1.7-rc.1`, `dsh-api-session-controller`'s `ArchivedSessionGate` rejects any model step proposed for an **archived session** (`agent/pre-step` ⇒ reject ⇒ `dsh-agent-loop` ends the turn as `turn/end { reason: 'blocked' }`, **without a model request ever being sent**). This plugin hides side sessions precisely by archiving them ⇒ drop the `releaseArchiveGate()` call before `followup` in `handleStart`, or the `rehideAfterTurn()` call in `finishJob`, and the branch is **dead on every single turn** on 0.1.7 (the panel shows `T.blocked`; that "content blocked by security policy" wording has nothing to do with any content policy — do not be misled by it). And `unarchiveSession` only exists from **`0.1.6-alpha.2`**: it **must be feature-detected with `typeof`**, because a hard call throws on `0.1.5-rc.2` and destroys backward compatibility outright. Section ⑥ of `scripts/smoke.mjs` guards this shape.

**The SSE response is hand-written from end to end** (`Connection: close`). Replacing it with the framework's built-in way of writing it will break it; the reason is in the `handleStream` comment in `lib/index.js`.

**All client input is untrusted.** Question length, model identifier and `conversationId` ownership must all be validated host-side.

**Do not touch any of the four read-only guardrails**: the `ALLOWED_TOOLS` constant, the `tools.guard` in `setup(agentCtx)` (`throw` if it cannot be obtained — fail-loud), `ROUTE_METHODS` (the 405 + `Allow` method contract), and the host-side validation of `conversationId` ownership.

**The `@deepseek-ai/cordis` in `peerDependencies` is declarative**: the plugin code **does not import it** (the host half obtains all of its runtime services softly via `ctx`, and the client half only `require`s platform built-in modules). It is declared by ecosystem convention, to state which contract this plugin hangs off — **do not delete it as a dependency someone forgot to remove**, and do not add an import just "to use it".

## Why it is done this way (read before changing anything; do not revert to intuition)

The following are approaches that "look like less work but break this plugin's premise", and why we do not take them. **They are not a historical record, they are the trade-offs themselves** — if they are not written down, the next maintainer will very likely try them.

**Why read-only must be at the execution layer.** The intuitive approach is `toolFilter:{allow:[]}` or `tools.restrict` — they act at the **prompt layer** (the tools disappear from the prompt) and do functionally achieve read-only. The cost is that the side session's prompt prefix is no longer word-for-word identical to the main session's, the parent session's existing **prefix cache is entirely invalidated**, and the whole context has to be recomputed every turn. So read-only instead uses `ctx.tools.guard()` (a public contract of `dsh-tools`), acting at the **execution layer**: the tools remain in the prompt, the model may attempt to call them, but execution is denied ⇒ not one word of the prompt changes and the cache keeps hitting as before. The guard must be registered on **that side Agent's own ctx** (obtained inside `setup(agentCtx)`); the official semantics are that a guard registered via `agent.ctx` only affects that agent — which is necessary for multiple side branch sessions existing in parallel.

**Why not use the official continuable child session.** `ctx.subagents.startContinuable` looks exactly right on the surface (officially provided, a child session you can keep talking to), but on settlement it posts the child session's final answer back into the parent session as a **parent-session user message** and wakes the parent model for a full turn (`watchSettlement` / `notifySettlement` in `dsh-subagent`; the official README states this is designed behaviour with no switch). That is reasonable for most scenarios, but fatal for this plugin: it directly violates the "the answer does not enter the main session" premise, and costs an extra model turn on top.

**Why we build the side session ourselves, and why the seed is the "completed-turn prefix".** The current approach is `ctx.agents.create()` to create a **plain side session** (`meta.parentSession` is used only as lineage, `origin:'subagent'` is **not** set — we do not need a subagent lifecycle, and we do not want a subagent card appearing in the main session), then at birth we use the public `session.snapshotEvents()` to read out the parent session's events and cut to the last `turn/end` ourselves as the seed, and in `setup` we use `agentPresets.composeFrom(agentCtx, parent.ctx)` to inherit the parent session's preset/tools/persona. This makes the prompt prefix word-for-word identical to the parent session's, so it **keeps hitting the existing prefix cache**; follow-up questions are just a continued `followup` on the same session. The cost is that what is inherited is the **snapshot at the moment the segment was opened**: new turns in the parent session after the segment is opened do not enter this branch (otherwise every follow-up would have to recompute the seed, the prefix would change with it, and the cache would be wasted), and a user who wants to carry new content in has to "Clear" and start a new segment.

**Why the side session is archived, and why it is un-archived and re-archived around every turn.** A side session is a **real session**, and left alone it would add an extra row to the left sidebar, mixed in with the user's own conversations. The only official way to hide a session from the grouping surfaces is to **archive** it (the official README itself describes the archive set as "sessions hidden from every grouping surface"), so the plugin archives a side session the moment it is created. The problem is that `0.1.7-rc.1` gave "archived" a second meaning: **archived ⇒ must not run** (`ArchivedSessionGate` rejects it at `agent/pre-step`). So "archive at birth" **locks the plugin out of itself** on the new version (every turn is stopped before `followup`, no model request is sent). And it **cannot** simply be changed to "do not archive at all" — that would put side sessions back into the session list, which is product behaviour, not an implementation detail. The current trade-off is three steps: **archive while idle (clean list) → un-archive before each turn is delivered (not gated) → archive again once that turn settles (clean list again)**. The costs are recorded honestly: the row may briefly appear in the sidebar while an answer is running, and each turn costs two or three extra durable writes. The other route is the official `origin: 'subagent'` (the sidebar natively hides rows whose summary has that origin), but it drags in subagent lifecycle semantics and conflicts with the "do not set `origin:'subagent'`" premise, so it was not taken.

**Why the branch preamble is concatenated in front of the question.** If the preamble went into the system prompt, the prefix would fork away from the main session's and the cache would be entirely wasted. So it is concatenated **in front of the question of the first turn of each segment**, and must be word-for-word identical within a segment.

**Why settings do not go through the official settings service.** `settings.register(ns, schema)` wants **schemastery's `z<T>` itself** (`resolve()` in `dsh-settings` calls it directly, so the schema must be callable), and `@deepseek-ai/schemastery` is a platform built-in package that **cannot be resolved from the plugin workspace by static import, dynamic import or `createRequire`** (all three give `ERR_MODULE_NOT_FOUND`); hand-building a "compatible schema" does not work either (node objects work through properties and are not callable). ⇒ Settings are instead persisted client-side in `localStorage`, with the value sent to the host on every request, and the host only validates and clamps. The cost is that this namespace is not visible in the official settings page, and the plugin carries its own gear panel.

**Why reaching the context limit is a "rejection" rather than "drop the earliest turns".** The latter is simpler to implement and does not interrupt the user, but it makes the model **silently amnesiac**: it does not remember the dropped content yet still behaves as if it does, which the user can hardly notice. So instead, every turn reads the side session's `assistant/message` usage (`input + cacheRead`) and the `contextWindow` of `request/context`, refuses to send once the window is more than 80% used, and displays the actual usage and the limit in the panel.

**Why the allow-list is not configurable.** The fewer pivot points a read-only promise has, the better. If the allowed surface were the intersection of "host constants × the set of names in settings × the subset submitted by the client", all three would have to stay consistent at all times, and a mistake in any one of them could widen the allowed surface. Now there is only one place: the two same-source constants `ALLOWED_TOOLS` and `TOOL_CHOICES` — the branch preamble the model sees is also taken from the same constant, so "what the model is told it may use" and "what the execution layer actually allows" cannot diverge. The cost is that users cannot narrow the permissions themselves; narrowing them means changing the code.

**A few implementation details that break things if left alone** (all explained in detail in code comments; only listed as points here): idling to the deadline puts the side session **to sleep** (`resume` to wake it **must be passed `agentOptions` explicitly**, otherwise that turn silently spins for ~25ms); a `tab.signal` abort only cuts the stream and **does not delete the panel state bucket**; the SSE response is hand-written from end to end, with an explicit `Connection: close` (the framework's built-in way would declare chunked while actually sending raw data); host-facing copy is sent down by the client with the request as `locale` (there is no browser locale in the host process).

## Host HTTP API

All routes first pass through the trust fence of `ctx.connection.requestRejection`.

| Method and path | Request body | Response |
| --- | --- | --- |
| `POST /side-branch/start` | `{ sessionId, question, selection?, conversationId?, locale?, settings? }` | `{ jobId, conversationId, handoff? }`; on failure `{ error, code }`, possibly with `conversationGone: true` or `contextFull: { used, limit, window }` |
| `GET /side-branch/stream?job=<jobId>` | — | SSE: `snapshot` / `delta` / `reasoning` / `reset` / `replace` / `tool` / `done` / `error` / `stopped` |
| `POST /side-branch/stop` | `{ job }` | `{ status }`, stops only this turn, the side session is kept |
| `POST /side-branch/close` | `{ conversationId }` | `{ status }`, releases this segment's side session |
| `GET /side-branch/settings` | — | `{ settings: { quickEntry } }` |
| `POST /side-branch/settings` | `{ settings: { quickEntry } }` | `{ settings: { quickEntry } }` |

There is only one setting: `quickEntry` (the switch for the main session's quick entry button). Tool lists submitted by the client are **not accepted** — the allow-list is a host-side constant, and the plugin does not offer a "choose your own available tools" feature. If a door is ever to be opened for that feature, read the "read-only must be guaranteed at the execution layer" section at the head of `lib/index.js` first.

Failure responses carry a machine-readable `code`, always with a `side-branch/` prefix in kebab-case, for example `side-branch/question-too-long`, `side-branch/context-full`. The client branches on `code`, not on the message text. When the path exists but the method is wrong, the reply is **405 + `Allow`** (the table of supported methods is `ROUTE_METHODS` in `lib/index.js`), not 404.

## Verifying changes

> ⚠️ The command below **is only valid in the source repository**: `scripts/smoke.mjs` is not published with the npm package
> (it reads `lib/` and `package.json` and makes source-level assertions, so running it from `node_modules` is meaningless).
> If you are double-checking an npm-installed plugin, run it in the repository.

```powershell
node scripts/smoke.mjs
```

It needs no DSH runtime; it loads the host half directly and calls `apply()` with a fake ctx. The six things it guards:

1. the module loads, the export name matches `package.json`, the route prefix is `/side-branch`, and the unload disposer is callable;
2. **the read-only promise**: `ALLOWED_TOOLS` and `TOOL_CHOICES` are still those six names and consistent with each other, and none of the nine dangerous tool names is among them; the client has no leftover tool switches and the host does not accept a tool list submitted by the client; the branch preamble's list comes directly from the constants; the guard's criterion is still to allow by list, its registration point is still inside `setup(agentCtx)`, and failing to obtain the guard is still fail-loud.
   ⚠️ The "guard's criterion" in this item is a **source-level regex assertion**, not an actual driven interception — real interception needs end-to-end (see below);
3. the client bundle exists, the inject is still those five service names, and there are no debug exports;
4. the package names in `package.json` and `cordis.patch.yml` match;
5. every package in `dsh.client.inject` really exists in the local DSH installation directory (give the path with `DSH_INSTALL_DIR`; if it cannot be found, skip this item);
6. **the archive-gate countermeasure**: the unlock must come before `followup`, must be feature-detected with `typeof`, and must not throw; the re-hide must hang off `finishJob`, use a bounded backoff, and equally must not throw; creation must still archive first. This section guards the "one published version serves both 0.1.5 and 0.1.7" line.

It does **not** verify answer quality, real guard interception, SSE behaviour or the interface. End-to-end verification needs:

1. a profile with this plugin installed;
2. a main session with at least one completed turn;
3. select text on the page, open the panel, ask a question;
4. check the startup log for lines with the `[side-branch]` prefix.

There is no end-to-end test suite in the repository. When changing the guard, the prompt prefix, the model-facing text (`PROMPT_TEXT`), the archive gate or the SSE spots, steps 2 to 4 must be run manually.

## Committing and pushing

- **Commit messages are always in English.** This is a public repository and its history is read in English: use `type: imperative subject` (e.g. `fix: un-archive the side session before each turn`) and explain "why" in the body. Do not mix Chinese into it.
- Prefer two commits: one for the `lib/` + `scripts/` behaviour change, one for documentation / version bumps.
- **Before pushing**, run `node scripts/smoke.mjs` (previous section) and run the affected path manually in a real host.
- Keep the version in `package.json` and `docs/CHANGELOG.md` in sync; tag releases as `v<version>` (`v0.1.0` exists).
- Remote: `origin` = `github.com/wucl12/dsh-side-branch`, main branch `main`.
