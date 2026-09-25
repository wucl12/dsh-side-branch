# Security Policy

[中文](./docs/SECURITY.zh-CN.md) · English · [Repository home](./README.md)

The core promise of this plugin is **execution-layer read-only**: a side branch may call six read-only tools, and every other tool is denied **at the execution layer** (`ctx.tools.guard()`, keyed on the plugin-level `ALLOWED_TOOLS` name allow-list, failing closed).

## Reporting a security issue

Use a GitHub private security advisory: <https://github.com/wucl12/dsh-side-branch/security/advisories/new>

Please do **not** open a public issue for read-only bypasses. You will get a response within 7 days.

## In scope

- **Guard bypass**: any path that lets a side branch execute a tool outside the allow-list (writing files, running commands, spawning grandchild sessions, mutating the host), including `run_code` (PTC) and `mcp__*` tools.
- **Answer leakage**: any path that gets a side branch's answer into the main session's model context.
- **Host route bypass**: reaching `/side-branch/*` without passing `ctx.connection.requestRejection`, or making the host act on unvalidated input from the client (question length, model identifier, `conversationId` ownership).
- **Client XSS / injection**: script execution while rendering an answer or quoted source text.

## Out of scope (by design)

These are documented in the README's "Read-only is not harmless" section and in [`AGENTS.md`](./AGENTS.md):

- The capabilities of the six allow-listed tools themselves: `web_fetch` / `web_search` are **network egress** (sensitive content in a branch can be sent out), `lsp` **starts language-server processes**, and `read` / `glob` / `grep` can read **any path the process can reach** — there is no per-branch sandbox.
- Prompt injection inside quoted source text or fetched external content. The plugin emits anti-injection declarations, but that is a **prompt-layer** constraint, not an execution-layer one.
- The allow-list not being configurable (narrowing it means editing code). This is a deliberate trade-off, for the reasons above.

## Supported versions

Fixes are provided for the latest released version only. The plugin is verified on the DSH version declared in the README.
