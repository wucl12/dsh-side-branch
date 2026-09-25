# DSH Side Branch — Side Ask

Select text in the main session and a **read-only branch session** opens in the right sidebar. The branch inherits the main session's context and streams its answer token by token, and **its answers never enter the main session's model context**.

Typical use: ask a follow-up question, look up a term, or explore an idea *alongside* the current conversation without breaking its flow.

- **Package name:** `dsh-side-branch`
- **UI name:** **Side Ask** · 中文「临时会话」
- **Verified DSH version:** `0.1.5-rc.2`
- **Requires:** Node.js ≥ 20 and `pnpm` on your `PATH`
- **Zero third-party runtime dependencies**, no build step · MIT licensed

## 📖 Read the full documentation

| | |
| --- | --- |
| **[English documentation](./docs/README.en.md)** | Install · usage · how read-only is guaranteed · limitations |
| **[简体中文文档](./docs/README.zh-CN.md)** | 安装 · 使用 · 只读如何保证 · 已知限制 |

## 📦 Install

```powershell
dsh plugin --profile web add github:wucl12/dsh-side-branch
```

Restart DSH afterwards (the client half loads at startup). See the full docs for the npm install, local-directory install, and the path-with-spaces caveat.

<p align="center">
  <img src="assets/panel-answering.png" alt="The Side Ask panel answering: quote block, collapsible thinking row, usage row" width="720">
</p>

## 🗂 Repository layout

| Path | What it is |
| --- | --- |
| [`docs/README.en.md`](docs/README.en.md) · [`docs/README.zh-CN.md`](docs/README.zh-CN.md) | Full documentation, English and Chinese |
| [`AGENTS.md`](AGENTS.md) · [`docs/AGENTS.en.md`](docs/AGENTS.en.md) | Architecture contract and hard constraints for AI agents (中文 / English) |
| [`SECURITY.md`](SECURITY.md) · [`docs/SECURITY.zh-CN.md`](docs/SECURITY.zh-CN.md) | Read-only commitment scope and vulnerability reporting (English / 中文) |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Release history, bilingual |
| [`docs/assets.md`](docs/assets.md) | Screenshot index |
| [`lib/`](lib) | `index.js` host half, `client.js` client bundle |

## 📄 License

[MIT](LICENSE)