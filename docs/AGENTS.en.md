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
| `scripts/client-check.mjs` | **Runtime** self-check for the client half: inside Node it loads the **real bundle** with a minimal React + minimal DOM, renders the **real component**, feeds it **SSE frames of the real shape**, and then asserts whether the answer is present in the rendered tree. **Likewise only exists in the source repository** and is not published with the npm package (what it asserts is real runtime behaviour, so it cannot run outside the source tree) |

## Hard constraints before changing anything

**Do not implement read-only with `toolFilter` or `tools.restrict`.** Both act at the prompt layer, which forks the side session's prompt prefix away from the main session's and invalidates the entire prefix cache. Read-only must be blocked at the execution layer with `ctx.tools.guard()`. The guard must be registered on that side Agent's own ctx (inside `setup(agentCtx)`).

**Do not touch the prompt prefix.** The branch preamble is concatenated in front of each turn's question; it does not go into the system prompt. The tool list is a plugin-level constant, so the list the model sees and the execution-layer criterion come from the same source. Changing any character of the preamble invalidates that segment's prefix cache.

**Do not translate the model-facing text back into Chinese, and do not keep one copy per language table.** The branch preamble, the PTC variant and the guard's deny reason all come from the single `PROMPT_TEXT` constant in `lib/index.js` (**English**); the zh/en tables merely reference it. Only **user-visible** strings (panel errors and hints) follow the interface language. Why: DSH's own system prompts and tool descriptions are English, so matching the platform's instruction language is more reliable; and **switching the interface language must not switch the prompt** (reproducible behaviour, comparable reports). `scripts/smoke.mjs` checks that this text contains no CJK and that both tables reference the same copy.

**Do not add "choose your own available tools" back.** The allow-list exists only in the two constants `ALLOWED_TOOLS` and `TOOL_CHOICES`, and the plugin does not accept tool names submitted by the client: one more configurable layer is one more place where the read-only guarantee can be broken.

**Do not revert to the official `ctx.subagents.startContinuable`.** On settlement it posts the child session's final answer back as a user message of the parent session and wakes the parent model for a full turn, which directly violates this plugin's premise.

**Do not add service names to the client `inject`.** Getting one name wrong leaves the fiber permanently pending and blanks the page. There are currently five: `slots`, `locale`, `sidebarRightTabs`, `sidebarRight`, `modelDirectories`.

**Do not remove the "un-archive before a turn, re-archive after it" cycle, and do not turn `unarchiveSession` into a hard call.** From DSH `0.1.7-rc.1`, `dsh-api-session-controller`'s `ArchivedSessionGate` rejects any model step proposed for an **archived session** (`agent/pre-step` ⇒ reject ⇒ `dsh-agent-loop` ends the turn as `turn/end { reason: 'blocked' }`, **without a model request ever being sent**). This plugin hides side sessions precisely by archiving them ⇒ drop the `releaseArchiveGate()` call before `followup` in `handleStart`, or the `rehideAfterTurn()` call in `finishJob`, and the branch is **dead on every single turn** on 0.1.7 (the panel shows `T.blocked`; that "content blocked by security policy" wording has nothing to do with any content policy — do not be misled by it). And `unarchiveSession` only exists from **`0.1.6-alpha.2`**: it **must be feature-detected with `typeof`**, because a hard call throws on `0.1.5-rc.2` and destroys backward compatibility outright. Section ⑥ of `scripts/smoke.mjs` guards this shape.

**Do not remove Re-Fork, and do not "cut corners" on it.** Every follow-up must first consult `shouldReFork`: if **the main session has settled a new turn** or **the model / reasoning effort changed**, a new segment is created (seed = the main session's latest settled prefix) and the previous segment's own side-branch conversation is replayed into it. Four things are not negotiable:

1. **`shouldReFork` must test both conditions.** Testing only "the main session grew" means that when the user **changes the model while the main session has not moved**, that turn keeps using the old model — silently ignoring the user's choice.
2. **Order: replay successfully first, release the old session second.** Reversed there is no way back (the old session is gone and the new one has no history). If the replay fails, **discard the segment just created**, leave the old session exactly as it was, and refuse the turn with `side-branch/refork-failed`. ⛔ Never silently degrade to "a new session with no history".
3. **The replay passes only `event.data`, verbatim, and replays only the 5 surface event types.** Hand-building an `assistant/message` is always rejected by `dsh-session` (it requires a real `source.provider/model` and a `stream` array); `turn/start`/`tool/call` and the like are pure log events and `append`ing them throws. ⛔ **And never "helpfully" fill in `event.sourceEventSeqs`** — a `tool/result` carries `[the old session's callSeq]` at the event level, and copying it over trips `sourceEventSeqs must reference earlier events`.
4. **Do not truncate the side branch's history.** At the context limit the turn is **refused** (`estimateRequestTokens` + `side-branch/context-full`). "A refusal is an explicit failure; truncation is silent distortion."

**Do not bring back "changed model ⇒ carry the history into a new segment"** (`seedSource`, the `sameAgentOptions` handoff, the manual `skipPrependNotice` handover). Re-fork absorbs that whole path: changing the model is just one more reason to rebuild. `createConversation` can only be seeded from the **parent session**.

**Do not drop `parentCut` from the segment-creation path.** `createConversation` must record `parentCut` when a segment is created (= the length of the parent session's settled prefix at that moment), and `sleepConversation`/`resumeConversation` must carry it along. Without it, `completedTurnPrefixLength(...) > undefined` is always true ⇒ **every turn re-forks for nothing**.

**Do not turn multi-segment answers (`job.segments`) back into "two string slots".** **Every step** of a turn emits its own `start` frame: only a changed `turn`/`step` means "a new segment", and only a changed `attemptId` within the same step means a **retry** (that, and only that, drops that step's segments). Treating every `start` as a retry is exactly the "the middle reasoning and the middle answer disappeared" bug. Also, `replace` rewrites **only the current segment** (replacing the whole answer would overwrite the earlier segments), and `snapshot`/terminal events must carry `segments` (otherwise a refresh loses every segment again).

**Do not stuff the constants and pure functions that "both sides share" in `lib/client.js` into any function.** `clampString` / `SEGMENT_KINDS` / `MAX_SEGMENTS` / `MAX_SEGMENT_CHARS` / `MAX_SEGMENTS_TOTAL_CHARS` / `normalizeSegment` / `normalizeSegments` / `trimSegments` **must stay at module scope** — `createPanelStore()` and `SideBranchBody` **both use them** (the store for persisted-shape validation, the component for live streaming writes). Put them inside one of the two and the other gets a `ReferenceError`, and that error **only ever shows up in the browser console, swallowed by event dispatch** (the symptom: the panel sits still and the answer never appears). `scripts/client-check.mjs` exists precisely to catch this class of error.

**Do not remove the instance lease (`side-branch-instances/`), and do not sweep orphans around it.** The sweep's criterion is "a `side-*` directory on disk that is not in this process's ledger", and that ledger **is necessarily empty at startup** ⇒ when **two instances share one `DSH_HOME` and run at the same time**, the one that starts later deletes the segments the earlier one **is using** as orphans. So before sweeping, an instance must post its own lease and then check whether any other **live** lease is present — if one is, **skip the entire sweep**.

**The payload of `GET /side-branch/inherited` must never enter persisted panel state.** A main-session prefix can be hundreds of kilobytes, and panel state goes through `sessionStorage` (a 5–10 MB quota) ⇒ putting it into `rounds`/`normalizeRound` blows the quota instantly and breaks "survives a refresh". It lives only in component memory and is fetched on demand.

**The SSE response is hand-written from end to end** (`Connection: close`). Replacing it with the framework's built-in way of writing it will break it; the reason is in the `handleStream` comment in `lib/index.js`.

**All client input is untrusted.** Question length, model identifier and `conversationId` ownership must all be validated host-side.

**Do not touch any of the four read-only guardrails**: the `ALLOWED_TOOLS` constant, the `tools.guard` in `setup(agentCtx)` (`throw` if it cannot be obtained — fail-loud), `ROUTE_METHODS` (the 405 + `Allow` method contract), and the host-side validation of `conversationId` ownership.

**The `@deepseek-ai/cordis` in `peerDependencies` is declarative**: the plugin code **does not import it** (the host half obtains all of its runtime services softly via `ctx`, and the client half only `require`s platform built-in modules). It is declared by ecosystem convention, to state which contract this plugin hangs off — **do not delete it as a dependency someone forgot to remove**, and do not add an import just "to use it".

## Why it is done this way (read before changing anything; do not revert to intuition)

The following are approaches that "look like less work but break this plugin's premise", and why we do not take them. **They are not a historical record, they are the trade-offs themselves** — if they are not written down, the next maintainer will very likely try them.

**Why read-only must be at the execution layer.** The intuitive approach is `toolFilter:{allow:[]}` or `tools.restrict` — they act at the **prompt layer** (the tools disappear from the prompt) and do functionally achieve read-only. The cost is that the side session's prompt prefix is no longer word-for-word identical to the main session's, the parent session's existing **prefix cache is entirely invalidated**, and the whole context has to be recomputed every turn. So read-only instead uses `ctx.tools.guard()` (a public contract of `dsh-tools`), acting at the **execution layer**: the tools remain in the prompt, the model may attempt to call them, but execution is denied ⇒ not one word of the prompt changes and the cache keeps hitting as before. The guard must be registered on **that side Agent's own ctx** (obtained inside `setup(agentCtx)`); the official semantics are that a guard registered via `agent.ctx` only affects that agent — which is necessary for multiple side branch sessions existing in parallel.

**Why not use the official continuable child session.** `ctx.subagents.startContinuable` looks exactly right on the surface (officially provided, a child session you can keep talking to), but on settlement it posts the child session's final answer back into the parent session as a **parent-session user message** and wakes the parent model for a full turn (`watchSettlement` / `notifySettlement` in `dsh-subagent`; the official README states this is designed behaviour with no switch). That is reasonable for most scenarios, but fatal for this plugin: it directly violates the "the answer does not enter the main session" premise, and costs an extra model turn on top.

**Why we build the side session ourselves, and why the seed is the "completed-turn prefix".** The current approach is `ctx.agents.create()` to create a **plain side session** (`meta.parentSession` is used only as lineage, `origin:'subagent'` is **not** set — we do not need a subagent lifecycle, and we do not want a subagent card appearing in the main session), then at birth we use the public `session.snapshotEvents()` to read out the parent session's events and cut to the last `turn/end` ourselves as the seed, and in `setup` we use `agentPresets.composeFrom(agentCtx, parent.ctx)` to inherit the parent session's preset/tools/persona. This makes the prompt prefix word-for-word identical to the parent session's, so it **keeps hitting the existing prefix cache**. That seed is re-taken from the main session on every follow-up — see the next paragraph.

**Why every turn "rebuilds" (re-fork) instead of letting one session live on.** While a session lives, its seed is frozen at the moment the segment was created — whatever the main session says afterwards is **never** visible to that branch, and the only way to see it is "Clear" and start a new segment (that is what 0.1.x did). Conversely, creating a new segment on every follow-up, re-taking the main session's **latest** settled prefix as the seed, and then replaying the branch's own questions and answers into it gets you two things at once: **the main session's updates** and **the branch's own continuity**. It is no worse for the cache either: the main session's newest content **was just requested by the main session itself**, so it is probably still in the provider's hot cache, and the re-fork request prefix lines up with it exactly (a cache read); under "frozen prefix + append", the same content is sent by the branch in that shape for the **first** time (a cache write). **Rebuild only when something actually changed** (the main session has not grown and the model is unchanged ⇒ keep the current segment): the seed would be byte-identical, and rebuilding would only add one more session record the platform cannot delete plus one deep copy. This is also why the model-facing text now says the inherited history is rebuilt from the main session every turn rather than describing it as a snapshot taken when the branch was opened.

**Why the side session is archived, and why it is un-archived and re-archived around every turn.** A side session is a **real session**, and left alone it would add an extra row to the left sidebar, mixed in with the user's own conversations. The only official way to hide a session from the grouping surfaces is to **archive** it (the official README itself describes the archive set as "sessions hidden from every grouping surface"), so the plugin archives a side session the moment it is created. The problem is that `0.1.7-rc.1` gave "archived" a second meaning: **archived ⇒ must not run** (`ArchivedSessionGate` rejects it at `agent/pre-step`). So "archive at birth" **locks the plugin out of itself** on the new version (every turn is stopped before `followup`, no model request is sent). And it **cannot** simply be changed to "do not archive at all" — that would put side sessions back into the session list, which is product behaviour, not an implementation detail. The current trade-off is three steps: **archive while idle (clean list) → un-archive before each turn is delivered (not gated) → archive again once that turn settles (clean list again)**. The costs are recorded honestly: the row may briefly appear in the sidebar while an answer is running, and each turn costs two or three extra durable writes. The other route is the official `origin: 'subagent'` (the sidebar natively hides rows whose summary has that origin), but it drags in subagent lifecycle semantics and conflicts with the "do not set `origin:'subagent'`" premise, so it was not taken.

**Why the branch preamble is concatenated in front of the question.** If the preamble went into the system prompt, the prefix would fork away from the main session's and the cache would be entirely wasted. So it is concatenated **in front of the question of the first turn of each segment**, and must be word-for-word identical within a segment.

**Why settings do not go through the official settings service.** `settings.register(ns, schema)` wants **schemastery's `z<T>` itself** (`resolve()` in `dsh-settings` calls it directly, so the schema must be callable), and `@deepseek-ai/schemastery` is a platform built-in package that **cannot be resolved from the plugin workspace by static import, dynamic import or `createRequire`** (all three give `ERR_MODULE_NOT_FOUND`); hand-building a "compatible schema" does not work either (node objects work through properties and are not callable). ⇒ Settings are instead persisted client-side in `localStorage`, with the value sent to the host on every request, and the host only validates and clamps. The cost is that this namespace is not visible in the official settings page, and the plugin carries its own gear panel.

**Why reaching the context limit is a "rejection" rather than "drop the earliest turns".** The latter is simpler to implement and does not interrupt the user, but it makes the model **silently amnesiac**: it does not remember the dropped content yet still behaves as if it does, which the user can hardly notice. So instead the turn is **refused** at the limit, with `used` / `limit` / `window` handed back to the panel (`contextFull`), and the history is **never truncated**.

⚠️ **In 0.2.0 the criterion changed from "read the usage" to "estimate".** After a re-fork the new session **has not run a single turn yet** ⇒ the old criterion, `conv.lastContextTokens` (the side session's `assistant/message` `input + cacheRead`), is necessarily `undefined` and cannot be used. The criterion now (`estimateRequestTokens`) is:

```text
used ≈ prompt tokens of the parent prefix (measured: the `input + cacheRead + cacheWrite` of the last `assistant/message` in the parent's log)
     + (characters of the branch history + characters of this turn's question) × CONTEXT_ESTIMATE_SAFETY
```

The turn is refused once that exceeds `contextWindow × CONTEXT_LIMIT_RATIO` (0.8). When `contextWindow` cannot be read the limit falls back to `CONTEXT_LIMIT_FALLBACK_TOKENS`, and when the parent's usage cannot be read the parent-prefix half falls back to `CONTEXT_ESTIMATE_PARENT_FALLBACK`. ⚠️ **Do not read `lastContextTokens` off the parent Agent instead**: the parent Agent **has no such field** (it is maintained by this plugin from session events).

⚠️ **Recorded honestly: `used` is an estimate.** The parent-prefix half is measured; the branch-history-and-question half is "character count × safety factor" ⇒ the number shown in the panel is **not** a measured usage, and it is normal for it to disagree with the real number in the usage row once that turn settles. Better to refuse early than to send something too large.

**Why the allow-list is not configurable.** The fewer pivot points a read-only promise has, the better. If the allowed surface were the intersection of "host constants × the set of names in settings × the subset submitted by the client", all three would have to stay consistent at all times, and a mistake in any one of them could widen the allowed surface. Now there is only one place: the two same-source constants `ALLOWED_TOOLS` and `TOOL_CHOICES` — the branch preamble the model sees is also taken from the same constant, so "what the model is told it may use" and "what the execution layer actually allows" cannot diverge. The cost is that users cannot narrow the permissions themselves; narrowing them means changing the code.

**A few implementation details that break things if left alone** (all explained in detail in code comments; only listed as points here): idling to the deadline puts the side session **to sleep** (`resume` to wake it **must be passed `agentOptions` explicitly**, otherwise that turn silently spins for ~25ms); a `tab.signal` abort only cuts the stream and **does not delete the panel state bucket**; the SSE response is hand-written from end to end, with an explicit `Connection: close` (the framework's built-in way would declare chunked while actually sending raw data); host-facing copy is sent down by the client with the request as `locale` (there is no browser locale in the host process).

## Host HTTP API

All routes first pass through the trust fence of `ctx.connection.requestRejection`.

| Method and path | Request body | Response |
| --- | --- | --- |
| `POST /side-branch/start` | `{ sessionId, question, selection?, conversationId?, locale?, settings? }` | `{ jobId, conversationId, handoff?, synced?, notice? }`; on failure `{ error, code }`, possibly with `conversationGone: true` or `contextFull: { used, limit, window }` |
| `GET /side-branch/stream?job=<jobId>` | — | SSE: `snapshot` / **`segment`** / `delta` / `reasoning` / `reset` / `replace` / `tool` / `done` / `error` / `stopped` |
| `POST /side-branch/stop` | `{ job }` | `{ status }`, stops only this turn, the side session is kept |
| `POST /side-branch/close` | `{ conversationId }` | `{ status }`, releases this segment's side session |
| `GET /side-branch/inherited?conversationId=&locale=` | — | **read-only**: the main-session turns this segment **actually inherited** (`{ turns, chars, truncated, parentHasNewer, synced }`; the last turn in full, earlier turns as one-line summaries) |
| `GET /side-branch/settings` | — | `{ settings: { quickEntry } }` |
| `POST /side-branch/settings` | `{ settings: { quickEntry } }` | `{ settings: { quickEntry } }` |

The meaning of the three optional fields in the `/start` response (the client uses them to decide what to do):

- `handoff: true` = this call **rebuilt** the segment (re-fork). The history **does** connect ⇒ the client must **not** draw a "a new segment starts here" divider.
- `synced: { turns, chars }` = how much main-session content this turn inherited (the panel's `Inherited N main-session turns · ~X chars` row).
- `notice` = **the branch preamble verbatim, as injected into the model** (returned only on a turn where it was actually prepended, i.e. the first turn of a segment). This is the **only** text this plugin injects; the system prompt and the tool declarations are assembled by DSH, do not belong to this plugin, and are not handed out here.

SSE payload changes (0.2.0): `segment` is new (entering the next step ⇒ a new segment); `snapshot`/`done`/`stopped`/`error` all carry `segments` (the ordered segments `{kind, text, turn, step}`); `reset`/`delta`/`reasoning`/`replace`/`tool` all carry `turn`/`step` (the client uses them to scope a `reset` precisely to **the same step**).

There is only one setting: `quickEntry` (the switch for the main session's quick entry button). Tool lists submitted by the client are **not accepted** — the allow-list is a host-side constant, and the plugin does not offer a "choose your own available tools" feature. If a door is ever to be opened for that feature, read the "read-only must be guaranteed at the execution layer" section at the head of `lib/index.js` first.

Failure responses carry a machine-readable `code`, always with a `side-branch/` prefix in kebab-case, for example `side-branch/question-too-long`, `side-branch/context-full`. The client branches on `code`, not on the message text. When the path exists but the method is wrong, the reply is **405 + `Allow`** (the table of supported methods is `ROUTE_METHODS` in `lib/index.js`), not 404.

## Verifying changes

> ⚠️ Both commands below **are only valid in the source repository**: neither `scripts/smoke.mjs` nor
> `scripts/client-check.mjs` is published with the npm package (the first reads `lib/` and `package.json`
> and makes source-level assertions, the second really runs the client bundle; neither is meaningful outside
> the source tree).
> If you are double-checking an npm-installed plugin, run them in the repository.

```powershell
node scripts/smoke.mjs         # ① source-level contract self-check
node scripts/client-check.mjs  # ② client runtime self-check
# both at once: npm run check | only the client one: npm run client-check
```

**① `scripts/smoke.mjs` (source-level)** needs no DSH runtime; it loads the host half directly and calls `apply()` with a fake ctx. There are currently **136 assertions**, in nine sections:

1. the module loads, the export name matches `package.json`, the route prefix is `/side-branch`, and the unload disposer is callable;
2. **the read-only promise**: `ALLOWED_TOOLS` and `TOOL_CHOICES` are still those six names and consistent with each other, and none of the nine dangerous tool names is among them; the client has no leftover tool switches and the host does not accept a tool list submitted by the client; the branch preamble's list comes directly from the constants; the guard's criterion is still to allow by list, its registration point is still inside `setup(agentCtx)`, and failing to obtain the guard is still fail-loud.
   ⚠️ The "guard's criterion" in this item is a **source-level regex assertion**, not an actual driven interception — real interception needs end-to-end (see below);
3. the client bundle exists, the inject is still those five service names, and there are no debug exports;
4. the package names in `package.json` and `cordis.patch.yml` match;
5. every package in `dsh.client.inject` really exists in the local DSH installation directory (give the path with `DSH_INSTALL_DIR`; if it cannot be found, skip this item);
6. **the archive-gate countermeasure**: the unlock must come before `followup`, must be feature-detected with `typeof`, and must not throw; the re-hide must hang off `finishJob`, use a bounded backoff, and equally must not throw; creation must still archive first. This section guards the "one published version serves both 0.1.5 and 0.1.7" line;
7. **the Re-Fork architecture (0.2.0)**: `shouldReFork` must test **both** "the main session settled a new turn" and "the model/reasoning effort changed"; `parentCut` must be recorded **when the segment is created** (and carried through sleep/wake, or every turn re-forks for nothing); the replay allow-list is **exactly** the 5 surface event types (`system/message`, `developer/message`, `user/message`, `assistant/message`, `tool/result`) and contains no pure log events; the replay **never copies `sourceEventSeqs`**; the replay **never truncates**; **replay succeeds first, then the old session is released** (on failure the just-created segment is discarded); every re-fork answers `handoff: true`; the old `seedSource` handover path is gone for good. This section also guards the three spots of the estimate switch: `estimateRequestTokens` / `lastPromptTokensOf` exist, and the old `conv.lastContextTokens` criterion (necessarily `undefined` after a re-fork) is **no longer** used;
8. **multi-segment answers (0.2.0)**: the ordered `job.segments`; the `start` frame being split by `turn`/`step` (a changed `attemptId` within the same step means a retry ⇒ only that step is dropped; a changed step ⇒ `segment` opens a new one); `replace` rewriting **only** the current segment; `snapshot` and the terminal events carrying `segments`; `syncSegmentShortcuts` making `text`/`reasoning` a **pure function** of the segment array; the old `attempts` field split into `steps`/`retries`; the client's `normalizeSegments` staying backward-compatible with **old data** (which only had `answer`/`reasoning`); They also guard "the quote is recorded with the round": sending stores the clipped reference on that round (`reference`), renders it as a collapsible quote block above the question, and **clears the composer's quote slot**; `normalizeRound` keeps it, so the block survives a refresh.
9. **startup sweep and the read-only route (0.2.0)**: `/inherited` registered in `ROUTE_METHODS` (without it a wrong method falls into 404 and breaks the 405 + `Allow` contract); `handleInherited` truncating to "the last turn in full + one line per earlier turn"; the inherited content **not** entering `normalizeRound` (component memory only); the orphan criterion requiring the directory name to be **exactly** `side-<uuid>`; the **instance lease** (`side-branch-instances/*.json`, heartbeat + PID liveness); a live foreign instance making it **skip the entire sweep**; deletions leaving a **manifest log**; the sweep strictly confined under the `sessions` root and recognising only the `side-` prefix (never the `session-*` main sessions).

**① does not verify**: answer quality, real guard interception (those items in section 2 are **source-level regex assertions**, not a driven interception), SSE behaviour or the interface — the client half is covered by ② below, up to the rendered tree; real DOM layout, CSS, real scroll positions, the real network and a real model are equally out of its reach, and those spots depend on the one-off headless end-to-end harness **outside the repository** (see below) plus manual checking.

### ② Client runtime self-check (`scripts/client-check.mjs`)

```powershell
node scripts/client-check.mjs                        # run just this one
node scripts/client-check.mjs <another client.js>    # reverse-verify the script itself (see below)
```

**Why it exists.** Looking at the panel by hand during development turned up several bugs in a row, and **all three existing automations missed them**: `node --check` only looks at syntax; `scripts/smoke.mjs` is **source-level regex assertions**; the end-to-end harness hits the **HTTP routes and never loads the client at all**. The worst one: constants such as `const MAX_SEGMENTS = 200` were declared **inside `createPanelStore()`** yet used in the **`SideBranchBody` component** ⇒ the first SSE `delta` frame threw `ReferenceError: MAX_SEGMENTS is not defined`, which the browser's event dispatch **swallowed** (it only shows up in the console) ⇒ every increment was lost and **the answer never appeared**, so the user saw "the panel looks stuck after asking". This script was written to close that hole, and it was **verified in reverse**: run against a deliberately broken copy it does FAIL and prints its own diagnostic `FAIL  SSE 帧 snapshot 的处理函数抛错：MAX_SEGMENTS is not defined`.

**How it does it.** No browser is installed; instead it **really runs** `lib/client.js` inside Node: the bundle's shape is `window.__ModuleLoader__.load({ factory })`, and it takes only three things from `require` — `react`, `react-dom` and `@deepseek-ai/dsh-client-ui-primitives` (the last two are **deliberately not provided**, and the bundle carries its own degraded branches, which conveniently exercises those branches too); only **8** React APIs are used (`createElement` / `useState` / `useEffect` / `useLayoutEffect` / `useReducer` / `useRef` / `Fragment` / `Component`), so a minimal React + minimal DOM is enough. The panel's capabilities **all come from the slot's `inject` face** (`inject: () => ({ startSideBranch, … })`), which the script spreads into props exactly as the official host does — which also verifies that the keys the face should have are there. Then real-shaped `fetch` / `EventSource` stubs drive it: type into the input through the real `onChange`, press send through the real `onClick`, and feed in SSE frames of the real shape.

**What it verifies.** The bundle loads, exports `apply()`, and the body component is registered and renders successfully; the client registers its dictionaries with the locale service (so the assertions can watch **real copy** rather than the weak "returns the key" kind); pressing send really issues **one** `POST /side-branch/start` carrying the question verbatim and opens an SSE stream for that job; every frame fed in has a listener; **all multi-segment answer text is rendered, in the right order, with the tool line between the two answer segments** (the regression criterion for the "only the last segment is left" bug); the injected branch preamble is visible in full; and **auto-scroll lands on the layer that actually scrolls** (`.dsh-side-branch-scroll`), while the non-scrolling rounds list has no ref attached.

There are currently **34 items**; PASS/FAIL is read straight from stdout (when everything passes the last line is the script's own `全部通过（34 项）`, and any failure exits with a non-zero code).

⚠️ **What it does not cover (recorded honestly)**: real DOM layout, CSS, real scroll positions, real browser events, the real network and a real model. It is a test of the **"data → rendered tree"** stretch, **not a browser test** — those spots still have to be eyeballed in a browser.

**The optional argument reverse-verifies the script itself**: `node scripts/client-check.mjs <another client.js>` makes it run a different bundle (for instance a deliberately broken copy), and that one **must FAIL**. **A test that cannot fail is no test at all.**

**Manual** end-to-end verification needs:

1. a profile with this plugin installed;
2. a main session with at least one completed turn;
3. select text on the page, open the panel, ask a question;
4. check the startup log for lines with the `[side-branch]` prefix.

The repository has **two self-checks (source-level + client runtime), but no end-to-end suite**. When changing the guard, the prompt prefix, the model-facing text (`PROMPT_TEXT`), the archive gate, Re-Fork, multi-segment answers or the SSE spots, steps 2 to 4 must be run manually; the same applies when changing the **client half** (`lib/client.js`) — `scripts/client-check.mjs` only automates the "data → rendered tree" stretch, and the interface itself still has to be looked at.

### The one-off headless end-to-end harness

The repository has **no** end-to-end suite (it is a test asset: not published with the npm package, and it does not belong in the working tree). When a change lands where the self-checks cannot reach — the guard's real denials, the prompt prefix, the archive gate, Re-Fork, multi-segment answers, the SSE spots — build a **one-off** harness. Its approach: inside **one DSH process** it plays two roles at once —

- **the client**: it first passes the official trust fence to obtain a browser session cookie, then hits the plugin's **real** `POST /side-branch/start` and reads the SSE stream from `GET /side-branch/stream`;
- **the main session**: it uses `ctx.agents.create` to build a **real** parent session (`agentPresets.resolve` + `mount` with the `standard` preset, so it **has tools**) and runs real turns.

It covers exactly what the unit check (`scripts/smoke.mjs`) cannot reach: the branch **really used a tool** on that turn (`tool/call` + `tool/result` both present); a follow-up after the main session advanced ⇒ re-fork (`conversationId` changed, `handoff: true`, the inherited turn count rising); after the re-fork the model could answer with **three different origins** at once (a token that exists only in the branch history / one that exists only in the latest main-session prefix / one that exists only in the **replayed tool result**); the main session unchanged ⇒ **no** rebuild; only the reasoning effort changed ⇒ a rebuild **too**; `GET /side-branch/inherited` returning 200 with the last turn in full and a wrong method returning **405 + `Allow: GET`**; the branch's own token **not** flowing back into the main session; the finished branch **back in the archive set**; a forged `conversationId` answering `conversation-gone`; and "the replayed `tool/result` matching the `toolCallId` of the `tool/call` in the new segment's log" (orphan tool results are the nastiest trap on this path).

⚠️ Use it only for a **pre-release** pass: do not commit the harness, and do not write its logs or verdicts into `docs/`.

## Committing and pushing

- **Commit messages are always in English.** This is a public repository and its history is read in English: use `type: imperative subject` (e.g. `fix: un-archive the side session before each turn`) and explain "why" in the body. Do not mix Chinese into it.
- Prefer two commits: one for the `lib/` + `scripts/` behaviour change, one for documentation / version bumps.
- **Before pushing**, run `node scripts/smoke.mjs` and `node scripts/client-check.mjs` (previous section; or `npm run check` to run both at once) and run the affected path manually in a real host.
- Keep the version in `package.json` and `docs/CHANGELOG.md` in sync; tag releases as `v<version>` (`v0.1.0` and `v0.1.1` exist; the current version is **0.2.0**).
- Remote: `origin` = `github.com/wucl12/dsh-side-branch`, main branch `main`.
