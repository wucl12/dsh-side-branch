# 临时会话 Side Ask · DSH 侧枝分支

[![npm version](https://img.shields.io/npm/v/dsh-side-branch?label=npm&color=4D6BFE)](https://www.npmjs.com/package/dsh-side-branch)
[![npm downloads](https://img.shields.io/npm/dm/dsh-side-branch?label=downloads)](https://www.npmjs.com/package/dsh-side-branch)
[![License](https://img.shields.io/github/license/wucl12/dsh-side-branch?label=license)](../LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.5%20%E2%86%92%200.2.1-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

[English](../README.md) | 简体中文

**在主会话里划选一段文字，在右栏开一条只读分支追问。答案流式显示在侧栏，不进入主会话的模型上下文。**

有些问题你只想顺口一问：agent 正在重构，你想知道「这个函数别处是怎么用的」，但不想让主会话记住这次提问；主会话上下文已经很长，你不想为一句追问让它再膨胀一轮；或者主会话跑的是贵模型，你想换个便宜模型在边上试错。

- 基于当前对话追问，主会话上下文一个 token 都不增加。
- 分支可以单独指定模型和推理等级，不用跟随主会话。
- 长任务在主线跑着，你在侧栏问别的，互不打断。

```bash
dsh plugin --profile web add dsh-side-branch
# 装完必须重启 DSH——客户端插件只在启动时装载，刷新浏览器没用
```

`--profile` 用你实际在跑的那个（`web`、`desktop`……）。需要 Node.js ≥ 20，且 `PATH` 上有 `pnpm`。

> **这个插件的代码是 agent 自己写的。** 本仓库的每一行代码都由 DSH 在真实会话里完成；作者负责的是工作流：定方向、审计划、亲手验证行为。详见 [它是怎么被写出来的](#它是怎么被写出来的)。

<p align="center">
  <img src="../assets/panel-answering.png" alt="分支在右侧栏流式作答" width="700">
</p>

## 它有什么不一样

**答案不回流。** 宿主端从不把分支的输出写进父会话。你在分支里问过什么，就留在分支里——主会话的 agent 不会莫名其妙地「知道」你在旁边聊了什么。

**它碰不到你的文件。** 只读是在**调用工具的那一刻**拦下的，不是靠把工具从提示词里藏起来：`ctx.tools.guard()` 只放行六个无副作用的工具（`read`、`glob`、`grep`、`web_search`、`web_fetch`、`lsp`），其余一律拒绝。因为工具仍留在提示词里，分支的提示词前缀与主会话逐字一致，能继续命中父会话攒下的前缀缓存——实测 97%–98%，这也是「顺口问一句几乎不额外花钱」的原因。为什么这么做、代价是什么，见 [`TECHNICAL.zh-CN.md`](./TECHNICAL.zh-CN.md)。

**它跟着主会话走。** 每次追问都用主会话最新落定的内容重建分支，再把这条分支自己之前的问答放回去：主会话刚聊完的那一轮它已经看得到，你三轮前问过什么它也还记得。

**注入内容可以逐字核对。** 面板里展开「已继承主会话」，就能逐轮看到分支实际收到了什么，连注入给模型的引导词全文都在。

## 安装

```bash
# npm
dsh plugin --profile web add dsh-side-branch

# 或直接从 GitHub 装
dsh plugin --profile web add github:wucl12/dsh-side-branch
```

`--profile` 用你实际在跑的那个（`web`、`desktop`……）。装完**必须重启 DSH**——客户端插件只在启动时装载，刷新浏览器不够。

前置：Node.js ≥ 20，且 `PATH` 上有 `pnpm`（`dsh plugin` 会转发给 pnpm）。

也可以在市场里装——[dsh-market](https://github.com/dsh-market/dsh-market) 与 [awesome-dsh-plugin 目录](https://awesome-dsh-plugin.com) 都已收录。

> 🤖 **给 AI Agent 的提示：** 如果你是负责安装此插件或阅读源码的 Agent，请先读本仓库的 [`AGENTS.md`](../AGENTS.md)——硬性约束、架构细节与安装指引都在那里。

## 如何使用

1. **划选提问：** 在主会话里选中文字，点击弹出的「引用并提问」，分支就在右侧面板打开，原文作为引用一并发送；这段引用会**随该轮入档**（问题上方一个可折叠的引用块），输入框上方的引用槽**自动清空**，下一轮从干净的输入框开始。
2. **快速入口：** 主会话输入框右侧有一个 `↗` 按钮，点击直接呼出面板（可在设置中关闭）。
3. **独立设置：** 面板里可以给当前分支单独指定模型与推理等级，不用跟随主会话。

<p align="center">
  <img src="../assets/selection-entry.png" alt="在主会话里划选文本，打开分支" width="700">
</p>

<p align="center">
  <img src="../assets/sidebar-guide.png" alt="右侧栏引导页里的「临时会话」入口" width="700">
</p>

## 兼容性

| DSH | 状态 |
| --- | --- |
| `0.1.5-rc.2` | ✅ 已验证 |
| `0.1.7-rc.2` | ✅ 已验证（归档闸） |
| `0.2.0-rc.2` | ✅ 已验证——加载、`/side-branch` 路由注册、面板人工实跑 |
| `0.2.1-rc.3` | ✅ 已验证——加载、`/side-branch` 路由注册且能应答（200 / 405 + `Allow`），浏览器收到的 client bundle 带上了限定作用域的引用入口 |

版本相关的接缝（归档闸、`unarchiveSession`）走的是运行期特性探测而非版本号比较，所以一个已发布版本同时服务这四条线。细节见 [`TECHNICAL.zh-CN.md`](./TECHNICAL.zh-CN.md)。

`0.2.2` 的引用入口依赖 DSH 给会话正文加的那组标记（`[data-conversation-content]`，旧宿主退回 `[data-conversation-scroll]`）。宿主若两者都没有渲染，入口就不出现（而不是退回猜测）；插件其余部分不受影响。

## 安全与限制说明

* **关于「只读」边界：** 这里的只读是指**不产生系统副作用**（不写文件、不执行命令）。但 `web_fetch` / `web_search` 仍有网络访问，`read` 可以读取进程权限内的任何文件。放行名单硬编码在代码里，不能通过设置放宽。
* **分支能看到什么：** 它用主会话**最新的已结算回合**重建，所以主会话**答完结算**的新回合会自动跟上；主会话**还没答完**的那一轮看不到（切点是最后一个 `turn/end`）——但**手动划选引用不受影响**：受限的是「自动看到」，不是「能不能引用」。
* **重建会留下会话记录：** 每次重建都新增一条侧会话记录，而平台**没有删除会话的 API**，记录会堆积。它们由插件启动时的孤儿清理回收，删了什么会逐条记日志。同一时刻有两个共用同一个 `DSH_HOME` 的实例在跑时，清理会整个跳过——第二个 DSH 绝不会删掉它正在用的分支。
* **到上下文上限是「拒绝」：** 到达上限时插件拒绝发送并提示清空，绝不静默丢掉最早的轮次。它报出的 `used` 是**估算值**，与该轮结束后的真实用量对不上是正常的。
* **缓存命中率是实测值，不是设计保证：** 97%–98% 是量出来的，不是承诺——平台可能在分支第一步**原地替换 system 节点**，那样从第 0 个 token 起全废。并且命中缓存 ≠ 不占上下文窗口，命中的 token 一样占窗口。
* **PTC 模式：** 主会话若用 `ptc` preset（纯代码执行工具面），分支会退化为纯文本问答，因为 `run_code` 永远被拒。

## 选型对比

这个生态里的侧边问答插件，差别主要在**答案最后落在哪**，以及**侧会话被允许做什么**。

| | **临时会话**（`dsh-side-branch`） | [`dsh-sidebar-qa`](https://github.com/ChenRuoT/dsh-sidebar-qa) | [`dsh-selection-toolbar`](https://github.com/suiyideali/dsh-selection-toolbar) |
| --- | --- | --- | --- |
| 答案最后落在哪 | 独立的一条分支；宿主端不回写 | 一条独立 DSH 会话 | **当前会话**——划选文本作为用户消息发进去 |
| 侧会话的工具权限 | 六个无副作用工具；调用写操作时被拒 | 其 README 未说明 | 同一条会话，因此是完整工具集 |
| 是否跟到主会话最新已结算回合 | 每轮追问都强制重建 | 可选——全量继承 / 摘要压缩 / 机械裁切 | 是——本来就是同一条会话 |
| 嵌套追问 / 追问记录树 | 无 | 有 | 无 |
| 运行时依赖 | 无 | 无（1.0.0 起） | — |

> 另外两列取自它们当时公开的 README，之后可能已变化。表里有一行是我们主动认输的：`dsh-sidebar-qa` 支持嵌套追问，本插件不支持。这张表是帮你选型，不是给人排名。

## 它是怎么被写出来的

这个插件是一次「吃自己的狗粮」的结果：整个代码库——宿主半、客户端半、`scripts/` 下的两套自检——都由 DSH 自己写，照着 [`AGENTS.md`](../AGENTS.md) 里的契约干活。没有一行代码是手写的。

人的部分在流程上：决定做什么、定方向、在每个方案执行前审一遍、然后在真实会话里亲手验证结果。验证发现的问题会作为新需求回给它——归档闸的修法、多段回答只显示最后一段的 bug、以及整条 re-fork 设计，都是这样找出来的。

## 更多文档

* [English](../README.md)：English documentation (the same content)。
* [`TECHNICAL.zh-CN.md`](./TECHNICAL.zh-CN.md)：完整技术文档——前缀缓存机制、只读拦截链路、PTC 行为与全部已知限制。
* [`AGENTS.md`](../AGENTS.md)：agent 干活时依据的架构契约与硬约束。
* [`SECURITY.zh-CN.md`](./SECURITY.zh-CN.md)：安全承诺范围与漏洞报告渠道。
* [`CHANGELOG.md`](./CHANGELOG.md)：版本更新历史。

## 许可证

[MIT](../LICENSE)
