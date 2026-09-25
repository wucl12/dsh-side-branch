# DSH Side Branch — Side Ask

**English** · [简体中文](./TECHNICAL.zh-CN.md) · [README](../README.md)

Select text in the main session and a **read-only branch session** opens in the right sidebar. The branch inherits the main session's context and streams its answer token by token — and **its answers never enter the main session's model context**.

Typical use: ask a follow-up question, look up a term, or explore an idea *alongside* the current conversation without breaking its flow.

| | |
| --- | --- |
| **Package name** (implementation) | `dsh-side-branch` |
| **UI name** (what you see) | **Side Ask** · 中文「临时会话」 |
| **Verified DSH version** | `0.1.5-rc.2` |
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
- **Prefix-cache hits stay intact.** The branch seeds itself from the main session's *completed-turn* prefix. Reusing the main session's model keeps hitting the existing prefix cache instead of rebuilding the prompt.
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

**The branch is a real branch.** At birth it reads the main session's completed-turn prefix as a seed, and inherits the main session's agent preset, tools and persona. The system prompt this branch sees is byte-identical to the main session's.

**Answers never flow back.** The host half never writes anything to the parent session. Nothing you ask, and nothing it answers, appears in the main session's model context.

**Prefix-cache hits continue.** Because the prompt prefix matches the main session's word for word, reusing the main session's model keeps hitting the existing prefix cache instead of recomputing it every time. A branch on a different model is a fresh prefix billed at full price; the plugin marks that in the usage row.

**Streaming, body and reasoning.** Answers are pushed token by token; reasoning sits in a collapsible "Thinking" row. A disconnecting client does not abort the background answer.

**Panel state is remembered.** Kept per *session + panel pane*, and survives a page refresh. After a side session has been idle for a while the plugin releases its live instance but keeps the record, and wakes it automatically on your next question.

**Settings live in the browser.** This plugin's namespace does not appear in the official settings page, and that is a deliberate trade-off: going through the official settings service would require the platform-internal `schemastery` package, which is not resolvable from the plugin workspace. Settings are therefore persisted in client `localStorage`, with the host only validating them.

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

- **A branch inherits a snapshot from the moment it is opened.** Turns the main session completes afterwards do not enter that branch. To include newer content, use "Clear" and start a new branch.
- **At most two side branches at once.** This comes from DSH's sidebar pane limit (one instance per tab type per pane, at most two panes), not from this plugin — but you will run into it.
- **The six allowed tools' own behaviour is not constrained by read-only.** The guard blocks *tools outside the list*; it does not restrict these six tools' network access, process spawning or file reading. See "Read-only is not harmless" above.
- **"Clear" is irreversible for the panel history.** After clearing, that branch is no longer visible in the panel and cannot be brought back. The archived side-session record is still on disk, but the official API cannot delete it and it never appears in any session list.
- Settings live in browser `localStorage`: switching browsers or clearing site data resets them. Currently there is only one setting (the main-session quick-entry toggle).
- The tool allow-list is not configurable. Narrowing it means editing code; there is no per-tool switch.
- After a plugin reload, the table of "sleeping" sessions is gone with memory, and old session ids report that a new branch was started (the client creates one automatically, so nothing hangs). **Note the two paths**: going idle past the threshold only puts the side session to *sleep* — the record stays and the next question **wakes it silently**, without even a divider; only a **plugin reload** loses the record and starts a new branch. Your question is still answered normally and you do not have to retype it — that branch's history just no longer connects.
- Each branch has a context ceiling. On reaching it, the plugin refuses to send and shows the actual usage instead of silently dropping the oldest turns.
- With a `ptc` main session the branch **cannot use a single tool** (the only visible entry, `run_code`, is always denied). A custom preset saved from the PTC template also defeats the opening-time detection, wasting the first round.
- After being denied by the guard, the model often **retries the same tool**, wasting a round. This is independent of PTC mode and was observed in both.
- Only DSH `0.1.5-rc.2` has been verified. Parts of the ecosystem have already moved on to `0.1.7-rc.x`; this plugin has not been verified on `0.1.6` or `0.1.7`.
- The MCP tool conclusion comes from reading the code path, not from a live test (`run_code` was tested live).
- The effect of the branch preamble on model behaviour has not been quantified. It asks the model to say "this needs the main session" when it would have to read a file to answer; whether that makes the model overly conservative needs human judgement.

## 📚 More documentation

- [`README.md`](../README.md) / [`README.zh-CN.md`](./README.zh-CN.md): the short overview, English and Chinese.
- [`AGENTS.md`](../AGENTS.md) / [`AGENTS.en.md`](./AGENTS.en.md): the architecture contract and hard constraints, written for AI agents — read it before any secondary development (Chinese / English).
- [`SECURITY.md`](../SECURITY.md) / [`SECURITY.zh-CN.md`](./SECURITY.zh-CN.md): the scope of the read-only commitment and the vulnerability reporting channel (English / Chinese).
- [`CHANGELOG.md`](./CHANGELOG.md): release history, bilingual.

## 📄 License

[MIT](../LICENSE)
