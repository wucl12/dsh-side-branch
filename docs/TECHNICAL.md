# DSH Side Branch — Side Ask

**English** · [简体中文](./TECHNICAL.zh-CN.md) · [README](../README.md)

Select text in the main session and a **read-only branch session** opens in the right sidebar. The branch inherits the main session's context and streams its answer token by token — and **its answers never enter the main session's model context**.

Typical use: ask a follow-up question, look up a term, or explore an idea *alongside* the current conversation without breaking its flow.

| | |
| --- | --- |
| **Package name** (implementation) | `dsh-side-branch` |
| **UI name** (what you see) | **Side Ask** · 中文「临时会话」 |
| **Verified DSH version** | `0.1.5-rc.2` and `0.1.7-rc.2` (see "Archived sessions" below) |
| **Prerequisites** | Node.js ≥ 20 and `pnpm` on your `PATH` |
| **Runtime dependencies** | none — no build step, no third-party packages |
| **License** | MIT |

> **Two names, on purpose.** The package is `dsh-side-branch` ("branch session"); the feature is displayed in the UI as **Side Ask** (Chinese: 「临时会话」) — the sidebar tab title, panel hints and button tooltips all use that name. The package name describes the implementation, the UI name describes the job ("ask one temporary question"). Renaming one should not rename the other. The rest of this page says "branch" when it means the implementation.

<p align="center">
  <img src="../assets/sidebar-guide.png" alt="The Side Ask entry in the right sidebar guide" width="720"><br>
  <img src="../assets/selection-entry.png" alt="Selecting text in the main session, with the ask entry floating above the selection" width="720"><br>
  <img src="../assets/panel-answering.png" alt="The right-hand panel answering: quote block, collapsible thinking row, usage row" width="720">
</p>

## 💡 Why another side-chat plugin?

When this project was designed (Mar 2026) I surveyed 14 side-chat / bubble plugins in the DSH ecosystem and found **no single one that met all of these requirements at once**:

1. **True context inheritance** — not a truncated summary.
2. **Multi-turn follow-ups inside one branch** — not a one-shot bubble.
3. **Token-by-token streaming**, including the reasoning process.
4. **Lightweight and stable** — public APIs only, no bloat.
5. **Read-only at the execution layer, and never destroying the prefix cache.**

The closest alternatives each traded something away. For example:

- [`@michengai/dsh-btw`](https://github.com/MichengAI/dsh-btw) is a one-shot side ask: each question is answered independently, with no follow-up within the same thread, and answers are not restored after a page refresh.
- [`dsh-side-chat-plus`](https://github.com/heartmove/dsh-side-chat) inherits the main conversation's toolset and permission preset by default, so its side chat is **read-write** — an agentic second chat rather than a read-only aside.
- [`dsh-sidenote`](https://github.com/g-yixuan/dsh-sidenote) is a full-featured side chat with one-click "reflow into the main session"; by design its conclusions are meant to be written back into the main conversation.
- [`@lukeknow0/dsh-side-chat`](https://github.com/Lukeknow0/dsh-side-chat) has an excellent architecture and a comparable read-only model, but its README states it is an MVP.

The sharpest split is **how "read-only" is implemented**. Comparable plugins usually enforce it in the *prompt layer* — removing the tools from the prompt via `toolFilter`, or restricting them with `tools.restrict`. Functionally that does produce read-only. But it also makes the branch's prompt prefix diverge from the main session's, **which invalidates every prefix-cache entry the parent session has accumulated**; the whole context is then recomputed on every turn.

This plugin enforces read-only in the **execution layer** instead (`ctx.tools.guard`, the public `dsh-tools` contract). The tools stay in the prompt; the model may attempt to call them, but execution is denied — so the prompt is byte-identical to the main session and the cache keeps hitting (measured at 97%–98%).

## ✨ Core features

- **True branch, zero pollution.** The host half never writes anything back to the parent session. Whatever you ask — and whatever the branch answers — never appears in the main session's model context.
- **Prefix-cache hits stay intact.** The branch seeds itself from the main session's *completed-turn* prefix (re-taken on every follow-up — see "Re-fork" below). Reusing the main session's model keeps hitting the existing prefix cache instead of rebuilding the prompt.
- **Read-only at the execution layer.** The security boundary does not depend on the prompt. `ctx.tools.guard` allows exactly six side-effect-free query tools (`read`, `glob`, `grep`, `web_search`, `web_fetch`, `lsp`); everything else — writing files, running commands, spawning child sessions — is denied at execution time.
- **Streaming that survives the tab.** Body text and reasoning stream token by token (reasoning lives in a collapsible "Thinking" row). Closing the browser tab does not interrupt the answer in the background; reopen and the result is there.
- **Persistent panel state.** Panel state is kept locally per *session + panel pane*. Idle side sessions go to sleep, release their live instance, keep their record, and wake silently on the next question.

## 📦 Install

Either path works. **Restart DSH afterwards** — the client half is loaded at startup, so refreshing the browser is not enough.

From GitHub:

```powershell
dsh plugin --profile web add github:wucl12/dsh-side-branch
```

From npm:

```powershell
dsh plugin --profile web add dsh-side-branch
```

From a local directory (`link:` dependency — this installs a *link to that directory*, not a snapshot):

```powershell
dsh plugin --profile web add C:\path\to\dsh-side-branch
```

> After a local-directory install, **re-run `add` and restart DSH whenever you change the code** (`lib/client.js` and friends are only loaded at startup; a browser refresh is not enough). If you don't want to restart, install from GitHub or npm instead.

**If the path contains a space** (e.g. the repo lives under `Documents\`), `dsh plugin add` splits the path into two arguments and creates a broken link. Two ways out:

- move the repo to a path without spaces (e.g. `C:\dev\dsh-side-branch`) and run `add`; or
- **skip the command line**: write the dependency into the profile's `package.json` by hand, then run `install` (a path inside a file is not split):

  ```jsonc
  // <DSH_HOME>\profiles\web\package.json
  "dependencies": { "dsh-side-branch": "link:C:/dev/dsh-side-branch" }
  ```

  ```powershell
  dsh plugin --profile web install     # this also adds it to dsh.profile.bundles
  ```

Replace `web` with the profile you actually use. If the profile is not in the default location, set `DSH_HOME` first.

### Let an agent install it for you

Paste the following into any agent that can run commands on your machine:

```text
Install the DSH plugin dsh-side-branch into my web profile:
1. Make sure pnpm is on PATH (dsh plugin is a forwarder to pnpm); install it first if missing.
2. Make sure the repo's absolute path contains no spaces. If it does, use the "not through the command
   line" route instead: add "dsh-side-branch": "link:<absolute repo path with forward slashes>" to the
   dependencies in <DSH_HOME>\profiles\web\package.json, then run dsh plugin --profile web install.
3. Otherwise: dsh plugin --profile web add <absolute repo path>
4. Run dsh --profile web --dump-config and confirm dsh-side-branch appears in the output.
5. Tell me the command to restart DSH, then stop and wait for me to restart it.
```

## 🚀 Usage

Select text in the main session's body: an ask entry appears above the selection. Click it, the right-hand panel opens, type your question and send. The selected text travels with the question as a quote.

There is a second entry point: a button on the right of the main session's composer opens the panel directly (it can be turned off in settings).

Inside the panel:

| Where | What it does |
| --- | --- |
| Composer | Ask; keep asking follow-ups in the same branch — that branch owns its own history |
| "Clear" (bottom left) | End the current branch; the next question starts a new one |
| Gear (bottom left) | Settings: the main-session quick-entry toggle |
| Model row | Pick a model and reasoning effort for this branch alone; defaults to following the main session |

Closing the browser tab does not interrupt an in-flight answer; come back to the panel and the result is still there.

## 🧭 Behaviour notes

**The branch is a real branch.** At birth it reads the main session's completed-turn prefix as a seed, and inherits the main session's agent preset, tools and persona. The system prompt this branch sees is byte-identical to the main session's. ★ **Every follow-up rebuilds it from the main session's *latest* settled prefix** while keeping the branch's own questions and answers (see "Re-fork" below).

**Answers never flow back.** The host half never writes anything to the parent session. Nothing you ask, and nothing it answers, appears in the main session's model context.

**Prefix-cache hits continue.** Because the prompt prefix matches the main session's word for word, reusing the main session's model keeps hitting the existing prefix cache instead of recomputing it every time. A branch on a **different** model is a different cache sequence on the provider side (however similar the prefix looks), so that segment is essentially billed at full price; the plugin marks that in the usage row.

**Streaming, body and reasoning.** Answers are pushed token by token; reasoning sits in a collapsible "Thinking" row. A disconnecting client does not abort the background answer.

**Panel state is remembered.** Kept per *session + panel pane*, and survives a page refresh. After a side session has been idle for a while the plugin releases its live instance but keeps the record, and wakes it automatically on your next question.

**Settings live in the browser.** This plugin's namespace does not appear in the official settings page, and that is a deliberate trade-off: going through the official settings service would require the platform-internal `schemastery` package, which is not resolvable from the plugin workspace. Settings are therefore persisted in client `localStorage`, with the host only validating them.

**Archived sessions, and why the branch is un-archived before every turn.** A side session is a real DSH session, so without help it would show up as an extra row in the sidebar. To keep the list clean the plugin *archives* it the moment it is created — archiving hides a session from the grouping surfaces without deleting it.

Starting with DSH **`0.1.7-rc.1`** an archived session also becomes *unrunnable*: `dsh-api-session-controller` composes an `ArchivedSessionGate` whose `agent/pre-step` listener rejects any model step proposed for an archived session, and `dsh-agent-loop` ends that turn as `turn/end { reason: 'blocked' }` **without sending a model request**. A plugin that archives its own session would therefore block itself on every single turn.

The plugin's answer is a three-step cycle, all of it tolerant of failure:

1. **On creation** — archive, so an idle branch is hidden.
2. **Immediately before each turn is delivered** (`followup`) — call `workspaceRegistry.unarchiveSession()`, lifting the gate for that turn.
3. **When the turn settles** — archive again, so an idle branch is hidden again. The registry refuses to archive a session that still has activity, so this step waits and retries on a bounded backoff; if it never succeeds the only consequence is that the branch stays visible in the sidebar.

`unarchiveSession()` only exists from DSH **`0.1.6-alpha.2`**; the call site is feature-detected, so on `0.1.5-rc.2` (no gate, no method) both extra steps are no-ops and behaviour is unchanged. This is what lets one published version serve both DSH lines.

## 🔁 Re-fork and multi-segment answers

### The rule in one line

Every follow-up sends the model:

```text
[ the main session's latest "settled prefix" ]   ← re-taken on every rebuild
+ [ this branch's own questions and answers ]    ← replayed in, verbatim
+ [ this turn's new question ]
```

The "settled prefix" is everything in the main session's event log **before the last `turn/end`** — the turns the main session has **finished and closed out**. A turn the main session is **still generating** does not enter the seed.

### When a rebuild happens (the triggers)

`shouldReFork` tests two conditions, and **either one** triggers a rebuild:

1. **the main session has settled a new turn** — the main session's current settled-prefix length is greater than the `parentCut` recorded when this segment was created;
2. **the model or the reasoning effort changed** — a `reasoningEffort`-only change counts too.

If neither holds (the main session has not grown and the model is unchanged) the **current segment is reused**: the seed would be byte-identical, so rebuilding would only add one more session record the platform cannot delete plus one deep copy, for exactly the same cache hits.

The rebuild is `reForkConversation`: create a fresh side session (seeded from the main session's **latest** prefix) → replay the previous segment's **own** events into it → release the previous segment only **after the replay succeeded**. If it fails, the turn is **refused explicitly** with `side-branch/refork-failed` and the **previous segment is left exactly as it was** (never a silent downgrade to "a new session with no history" — the model would think the branch had never been asked anything while the panel still shows the old answers).

Because a rebuild creates a new side session, **`conversationId` changes whenever a rebuild happens**; `POST /side-branch/start` always answers `handoff: true`, so the panel does **not** draw a "a new segment starts here" divider — the history really is continuous.

The cache trade-off: the newly added content is the part the main session **just requested itself**, so it is probably still in the provider's hot cache, and the rebuilt request prefix lines up with it exactly (a cache read); under "frozen prefix + append", that same content is sent by this branch in that shape for the **first** time (a cache write).

### The replay discipline (read this before touching the code)

Only the **5 event types that can enter the model-visible history** are `append`ed into the new session, verbatim:

```text
system/message   developer/message   user/message   assistant/message   tool/result
```

- **Only `event.data` is passed, verbatim.** An `assistant/message` embeds the **real provider stream** and `message.source.provider/model`; hand-building one is rejected by `dsh-session`'s shape checks.
- **Pure log events are never replayed** (`turn/start`, `step/start`, `tool/call`, `request/header`, …): `append`ing them throws.
- ⛔ **Never "helpfully" fill in `event.sourceEventSeqs`**: a `tool/result` carries `[the old session's callSeq]` at the **event level**, and copying it over trips `sourceEventSeqs must reference earlier events` (a foreign sequence number is very likely ≥ the new session's seq). Passing only `data` drops it naturally — and `append` does not need it anyway.
- **No truncation**: at the context limit the turn is refused; the earliest turns are never silently dropped.

### Multi-segment answers: every step of a turn is kept

A turn can contain several steps ("talk while working"), and **every step opens a new streaming attempt and emits its own `start` frame**. The branch keeps an **ordered segment array**:

```text
job.segments = [ { kind: 'reasoning'|'text'|'tool', text, turn, step }, … ]
```

- `start` frames are split by `turn`/`step`: **the same step with a new `attemptId`** is a **retry inside that step** (only that step's segments are dropped, and a `reset` is emitted); **a changed `turn`/`step`** means **a new segment** (a `segment` frame is emitted, and nothing old is ever deleted).
- `chunk` (`text-delta` / `reasoning-delta`) and `tool/call` append to the **current segment**; the terminal text from `assistant/message` **replaces only the current segment** (and only when it is non-empty, so a tool-only final step cannot leave a middle segment displayed as the final answer).
- The `job.text` / `job.reasoning` shortcuts are **pure functions** of the segment array (`syncSegmentShortcuts`) ⇒ they cannot drift from it, and there is no "second source of truth".

The complete SSE event and payload list:

| Event | When | Payload |
| --- | --- | --- |
| `snapshot` | once, when a client (re)connects | `{ status, text, reasoning, segments, conversationId, stats? }` |
| `segment` | entering the next step (a new segment) | `{ turn, step }` |
| `delta` | answer-text increment | `{ text, turn, step }` |
| `reasoning` | reasoning increment | `{ text, turn, step }` |
| `reset` | retry inside the same step (drops only that step) | `{ turn, step }` |
| `replace` | terminal text replacing **the current segment** | `{ text, turn, step }` |
| `tool` | an allow-listed tool was **executed** (tool name only, never the arguments) | `{ name, count, turn, step }` |
| `done` / `stopped` / `error` | terminal states | `{ status, text, reasoning, segments, conversationId, stats?, error? }` |

The client persists `segments` along with the round (`turn`/`step` included — they are tiny) and renders them in array order after a refresh; when **old data has no `segments`** they are synthesised from `answer`/`reasoning` (`normalizeSegments`) ⇒ an old panel does not come back empty after a refresh.

### What was inherited, and what was injected (layer 1 / layer 2)

- **Layer 1 (one row per segment)**: `/start` answers `synced: { turns, chars }` ⇒ the panel shows `Inherited N main-session turns · ~X chars`. If a branch preamble really was prepended on that turn, the response also carries `notice` (**the preamble text as injected into the model**, shown verbatim; only the first turn of a segment has it). That is the **only** text this plugin injects; the system prompt and the tool declarations are assembled by DSH and are **deliberately not shown**.
- **Layer 2 (expand on demand)**: `GET /side-branch/inherited?conversationId=&locale=` returns the turns before **this segment's cut point** (`conv.parentCut`) — **the last turn in full, one line per earlier turn**, all **truncated server-side with no model call** (so a "summary" is not "summarise it again"). The response carries `truncated` (whether anything was cut) and `parentHasNewer` (the main session has grown since ⇒ the next follow-up will include it).
- ⛔ **Layer 2's content never enters persisted panel state** (`rounds` / `normalizeRound` / `sessionStorage`): a main-session prefix can be hundreds of kilobytes, and panel state has a 5–10 MB `sessionStorage` quota ⇒ putting it in blows the quota instantly and breaks "survives a refresh". It lives only in component memory and is fetched once, on demand.

### The context limit: an estimate

After a re-fork the **new session has no usage yet** (the old `lastContextTokens` criterion is necessarily `undefined`), so the limit is now estimated:

```text
used ≈ the parent's last assistant/message input + cacheRead + cacheWrite (measured)
     + (branch-history characters + this turn's question characters) × safety factor
```

Above `contextWindow × 0.8` the turn is **refused** with `contextFull: { used, limit, window }`; when the window cannot be read a fallback limit is used. ⚠️ **`used` is an estimate** (the parent-prefix half is measured, the other half is estimated from character counts), so it is normal for the number in the panel to disagree with the real usage once that turn settles. The history is **never truncated**.

### The startup orphan sweep and the instance lease

Every re-fork **adds one session record**, and the platform's session-persistence layer **has no API to delete a session** ⇒ records would pile up forever. So the plugin sweeps once in `apply()`: a `sessions/<project>/side-<uuid>/` directory on disk that is **not in this process's ledger** is an orphan left by an earlier instance.

That criterion is only safe together with the **instance lease**: the ledger **is necessarily empty at startup**, so if a **second DSH instance sharing the same `DSH_HOME`** is running at the same time, it would delete the first instance's **live** side-session directories as orphans (the first instance still has them in memory while their on-disk log is gone ⇒ that branch is simply broken). The mechanism: on startup each instance posts a lease in `<DSH_HOME>/side-branch-instances/` (`<pid>-<uuid>.json`) and refreshes its heartbeat, deleting it on unload; before sweeping, the plugin skips **the entire sweep** if it finds **any other live lease** (stale ones — expired heartbeat or dead process — are cleaned up in passing).

Three safety checks: ① the directory name must be **exactly** `side-<uuid>` (right prefix but wrong shape ⇒ **untouched**, only logged); ② it must not be in this process's ledger; ③ it must be strictly under the `sessions` root, with no path escape. Everything deleted is **logged item by item** (the platform cannot delete sessions, so the log is the only trace); a single failure is only logged and never affects startup. ⛔ The main sessions' (`session-*`) files are **never touched**.

## 🛡️ How read-only is guaranteed

Read-only is enforced by the **execution layer**, not by asking the model nicely in a prompt.

Six tools are allow-listed:

```text
read  glob  grep  web_search  web_fetch  lsp
```

The test is an **exact tool-name match, and it fails closed**. `dsh-tools`' `prepareExecution` runs the guard on every single execution, so anything not in that list of six is denied at execution time, including:

- `subagent`, `workflow`, `ralph` — they can open grandchild sessions, and a grandchild's context does not carry our guard;
- `bash`, `pwsh` — arbitrary commands;
- `write`, `edit`, `report` — writing files;
- `goal`, `jobs`, `cordis` — changing long-term goals, starting/stopping background jobs, mutating the running host;
- `run_code` — the channel PTC mode uses to wrap actions in program execution. Every SDK dispatch inside a PTC program goes through the same `prepareExecution`, so it is blocked twice;
- `mcp__*` — MCP tools register into the same tool table and are rejected by name like anything else.

One case has been tested live: the model **actually called** `subagent`, the guard denied it at the execution layer, no grandchild session started, and a decoy file's content and mtime were unchanged. `run_code` and MCP go through the same already-covered pipeline, but they have not each been exercised end to end.

If DSH renames a tool in the future, that tool falls into the *denied* side automatically rather than being silently allowed.

`session_query` is **not** on the list: it can read other sessions, which would turn "one branch of this session" into cross-session reading.

The allow-list is **fixed**. The plugin deliberately offers no "pick your own tools" setting: one less configurable layer is one less place where the read-only guarantee can be broken, and the list the model sees can never diverge from what the execution layer enforces. Narrowing the surface means editing that constant.

Note what was deliberately **not** done: removing tools from the prompt. That would fork the prompt prefix away from the main session and invalidate the whole prefix cache — which is exactly why read-only has to be enforced at the execution layer here.

### "Read-only" is not "harmless"

"Read-only" means **no side effects**, not "no outside access". Of the six allow-listed tools:

- `web_fetch` and `web_search` are **network egress**. If the branch holds sensitive content, the model can send it out. Both the quoted source text and fetched tool output carry an anti-injection declaration (explicitly telling the model not to follow instructions found in them), but that is a prompt-layer constraint.
- `lsp` **starts language-server processes**.
- `read`, `glob` and `grep` can read **any path the process can reach**. There is no per-branch sandbox, so their reach is not limited to the current workspace.

These surfaces are **fixed**; the plugin has no switches to turn them off one by one. A narrower tool surface means editing the constant in code — which is precisely why it is deliberately non-configurable.

### When the main session uses PTC mode

If the main session's agent preset uses `tool-presentation: mode: ptc` (the built-in `ptc` preset does), the tool surface is replaced by a generated SDK and the only entry point the model **can see** is `run_code`. `run_code` is never allow-listed, so such a branch cannot call a single tool and answers from inherited history plus whatever you quote.

The plugin detects this tool surface when opening a branch and switches to a guidance preamble stating that the branch offers no tools, so the model does not keep trying. Detection reads the parent's preset name (`ptc`). If the parent uses a **custom preset saved from the PTC template**, the preset name will not match and the guard is the fallback: the first `run_code` attempt is denied, after which the PTC preamble is used — the first round is wasted once.

Measured: in a PTC parent session the PTC preamble applied from the first round, the model reported that "the only visible entry in the tool surface is run_code", and `run_code` was actually called and denied at the execution layer, leaving the decoy file untouched.

## ⚠️ Known limitations

- **A turn the main session has not *settled* yet is invisible.** Every rebuild cuts at the main session's **last `turn/end`**, so a turn that is still generating (or was just sent and has not finished) is in neither the seed nor the replay. Turns the main session **has** finished do follow along automatically — that is what the re-fork does. To cite something not yet settled, use **manual selection quoting**: what is limited is "seeing it automatically", not "being able to quote it".
- **At most two side branches at once.** This comes from DSH's sidebar pane limit (one instance per tab type per pane, at most two panes), not from this plugin — but you will run into it.
- **The six allowed tools' own behaviour is not constrained by read-only.** The guard blocks *tools outside the list*; it does not restrict these six tools' network access, process spawning or file reading. See "Read-only is not harmless" above.
- **"Clear" is irreversible for the panel history.** After clearing, that branch is no longer visible in the panel and cannot be brought back. The archived side-session record is still on disk, but the official API cannot delete it and it never appears in any session list. Note also that a re-fork **adds one session record per rebuild**, and the platform **has no API to delete a session** ⇒ those records are reclaimed by the plugin's **startup orphan sweep** (see above); while **two instances share one `DSH_HOME`** and run at the same time, that sweep **skips entirely**.
- Settings live in browser `localStorage`: switching browsers or clearing site data resets them. Currently there is only one setting (the main-session quick-entry toggle).
- The tool allow-list is not configurable. Narrowing it means editing code; there is no per-tool switch.
- After a plugin reload, the table of "sleeping" sessions is gone with memory, and old session ids report that a new branch was started (the client creates one automatically, so nothing hangs). **Note the two paths**: going idle past the threshold only puts the side session to *sleep* — the record stays and the next question **wakes it silently**, without even a divider; only a **plugin reload** loses the record and starts a new branch. Your question is still answered normally and you do not have to retype it — that branch's history just no longer connects.
- Each branch has a context ceiling. On reaching it the plugin **refuses to send** and returns `contextFull: { used, limit, window }`, instead of silently dropping the oldest turns. ⚠️ That `used` is an **estimate** (after a re-fork the new session has no usage yet), not a measured usage.
- **The cache hit rate is measured, not guaranteed.** The platform may **replace the system node in place** on the side session's first step (node 0) — the official wording is *"A prompt change that replaces a system node in place makes the request differ from that node's first token — in full when the node is node 0"* ⇒ if that happens, **everything from token 0 on is billed at full price**. A mismatched tool set also forces a new sequence. So there is no "always hits": 97%–98% is a measurement, not a promise. And **hitting the cache does not mean the tokens stop occupying the context window**: the `inputTokens + cacheRead + cacheWrite` total counts the cached tokens just the same.
- With a `ptc` main session the branch **cannot use a single tool** (the only visible entry, `run_code`, is always denied). A custom preset saved from the PTC template also defeats the opening-time detection, wasting the first round.
- After being denied by the guard, the model often **retries the same tool**, wasting a round. This is independent of PTC mode and was observed in both.
- Verified on DSH `0.1.5-rc.2` (before the archive gate) and `0.1.7-rc.2` (with it). `0.1.6-alpha.2` was checked by reading its published packages only — it already has `unarchiveSession` and does **not** yet have `ArchivedSessionGate`, so the feature-detected path keeps it working — but no end-to-end run was done there.
- The MCP tool conclusion comes from reading the code path, not from a live test (`run_code` was tested live).
- The effect of the branch preamble on model behaviour has not been quantified. It asks the model to say "this needs the main session" when it would have to read a file to answer; whether that makes the model overly conservative needs human judgement.

## 📚 More documentation

- [`README.md`](../README.md) / [`README.zh-CN.md`](./README.zh-CN.md): the short overview, English and Chinese.
- [`AGENTS.md`](../AGENTS.md) / [`AGENTS.en.md`](./AGENTS.en.md): the architecture contract and hard constraints, written for AI agents — read it before any secondary development (Chinese / English).
- [`SECURITY.md`](../SECURITY.md) / [`SECURITY.zh-CN.md`](./SECURITY.zh-CN.md): the scope of the read-only commitment and the vulnerability reporting channel (English / Chinese).
- [`CHANGELOG.md`](./CHANGELOG.md): release history, bilingual.

## 📄 License

[MIT](../LICENSE)
