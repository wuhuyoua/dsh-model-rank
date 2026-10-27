# Model Rank（dsh-model-rank）

实测 DeepSeek Harness 里每一条已挂载的模型路由，按**可用性、稳定性、首字延迟、吞吐、能力、额度**加权排名——全部真跑，不是估算。

简体中文 | [English](README.en.md)

## 它在哪些地方出现

- **首页输入框下方**：一行常驻入口，显示当前第一名的模型与分数；「测试」一键开测，「**一键使用**」把第一名设成当前会话的模型并同时写成默认模型；点开是**前五名**面板（排名 · 模型 · 通道 · 得分），每行带一个「用这个」，面板顶部可切换**输入模态**（不限 / 纯文字 / 支持图片）。`Alt+Shift+M` 可在页面任意位置展开/收起，不需要进设置。
- **设置 → 模型优选**：完整表格，可点表头排序；支持快速/深度模式、模型上限、并发、提供方筛选、**输入模态筛选**、**排序维度选择**（综合分 / 能力 / 首字 / 吞吐 / 稳定）、开始/停止，以及逐模型明细（错误、回答样本、能力任务、设为默认）。排序维度只决定**可用模型之间**的顺序——不可用的永远沉底。
- **`model_rank` 工具**：给 agent 用，`action` 取 `list` / `status` / `run` / `report` / `apply`；`run` 支持 `mode: "quick" | "deep"`、`limit`、`providers`、`concurrency`；`apply` 可带 `provider` / `model`，不带就用排名第一。

两个界面读同一份 Host 状态，所以首页面板和设置页表格永远一致。

## 一键使用做了什么

点「一键使用」（或 `model_rank(action:"apply")`）后：

1. 先校验目标路由能解析（`ctx.llm.resolveModelInfo`），未知路由不会写进配置；
2. 有会话时走 `sessionController.selectModel`：当前会话立刻切换，默认模型在后台保存——和输入框里的模型选择器是同一套路径；
3. 设置页没有会话，直接写 `agentDefaultModel.saveSelection`，只影响新会话；
4. 目标模型支持原有推理强度时（`reasoning.efforts` 里有同一个 id），会把它一起保留；不支持则用模型默认值。

它不会改权重、不会改测试结果，只切换选择。

## 安装

`dsh-model-rank` 是一个 DSH profile bundle：Host 半身（探测、HTTP 接口、工具）+ Web Client 半身（设置页与首页面板）。无构建步骤、无运行时依赖。

1. 在 profile 的 `package.json` 里加依赖：

   ```json
   "dependencies": {
     "dsh-model-rank": "github:wuhuyoua/dsh-model-rank"
   }
   ```

2. 把 bundle 加进组合：

   ```json
   "dsh": {
     "profile": {
       "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-model-rank"]
     }
   }
   ```

3. 在该 profile 里安装（插件管理器，或 `dsh plugin --profile <profile> install`），然后刷新页面一次。

卸载就是反过来：去掉 bundle 条目和依赖，再装一次。

## 一次测试都测了什么

1. **枚举**——`ctx.llm.listProviders()`，再对每个 provider 调 `ctx.llm.listModels()`。枚举失败的 provider 会单独报告，不会被静默跳过。
2. **探测**——每个模型发真实请求（`ctx.llm.prepareCall()` + `prepared.stream()`），记录：
   - 首字时间、总耗时；
   - 流式输出速率（token/秒）；
   - 结束原因，以及提供方返回的失败码/状态码。
3. **可靠性**——这是识别"聊着聊着就没法返回"的关键：
   - 同一句极小请求**重复 3 次**（快速模式也做），统计实际有回复的次数；
   - `deep` 再加**多轮对话**（先记住一个数字，再追问）与**长输入**（约 1.6k token 的日志 + 一句指令）两项。
   - 结果是「有效探测 / 总探测」的比例，例如 `7/9`。只成功一次就再也不回的路由会明显掉分。
4. **能力**——用答案可机器判定的任务：
   - `quick`：指令遵循（"只回复 OK"）。
   - `deep`：再加算术（`17 × 23`）、精确 JSON 输出、中文指令、推理各一项；逐条判定，不交给模型自评。

深度模式还会调 `ctx.llm.resolveModelInfo()` 取上下文窗口与推理支持，用于能力分。

## 评分

| 维度 | 权重 | 计算方式 |
| --- | --- | --- |
| 可用性 | 30% | 首个探测正常结束且有回答文本 = 100，否则 0 |
| 稳定性 | 20% | 有效探测 / 总探测 × 100；9 次里掉 4 次就是 56，而不是满分 |
| 首字延迟 | 15% | 400 ms 满分，2.9 s 归零 |
| 吞吐 | 8% | 对数分（10 tok/s ≈ 30，200 tok/s ≈ 100），单 chunk 突发交付减半 |
| 能力 | 20% | 72% 任务正确率 + 18% 上下文窗口 + 10% 推理支持 |
| 额度 | 7% | 免费通道 95；钱包余额分档（≥100 → 100 … 5 → 60，0 → 0）；未知取中性 55 |

不可用的路由无论其他维度多高，综合分都是 0。权重会归一化，可在 `cordis.patch.yml` 覆盖：

```yaml
- id: model-rank
  name: dsh-model-rank
  config:
    weights: { availability: 0.30, stability: 0.20, ttft: 0.15, throughput: 0.08, capability: 0.20, quota: 0.07 }
    concurrency: 3
    limit: 0
```

## 额度的口径

只有两种额度是真数据：

- **DeepSeek 账户**（`deepseek*` 路由）——`ctx.deepseekAccount.getBalance()` 返回充值钱包与赠送钱包，表格直接显示金额。
- **免费通道**——路由 id 里带 `free` / `aggregate` 的，按"不计费"记满分，标注「免费通道」。

其余一律显示「未报告」，取中性 55 分。余额为 0 的账户本身探测就会失败，所以排名不会把空账户当成健康。

## 成本

快速模式每个模型一次极小请求（输出上限 96 token）；深度模式四次。不点按钮、不调工具就不会发任何请求，插件也不跑定时任务。

## 开发

```bash
npm test           # 引擎自测 + 渲染冒烟测试，都不联网、不耗额度
npm run test:engine  # 桩实现的 llm 服务：枚举、探测、打分、排序
npm run test:render  # 假 React 环境真实渲染设置页与首页面板
```

引擎自测用符合 `llm` 契约的桩驱动真实引擎，其中包括"一次 prepared call 只能派发一次"的约束——派发逻辑有 bug 会在碰到真实 provider 之前就失败。

渲染冒烟测试值得单独说明：`node --check` 只证明文件能解析，而真正让设置页白屏的错（例如 `SORTABLE is not defined`）发生在 **render 阶段的 `useMemo` 里**，语法检查抓不到，只能重启浏览器后才在控制台看到。这个测试用最小 React 垫片加载 `client.js`、喂一份假的 `/state`、跑 mount effect 并重新渲染，所以丢失的标识符、钩子顺序错误、memo 依赖不全都本地就会失败。

## 文件结构

- `index.js` —— Host 半身：工具注册与 `/api/model-rank/*`。
- `src/bench.js` —— 枚举、探测、进度、持久化（`~/.dsh/model-rank/report.json`）。
- `src/scoring.js` —— 纯打分函数、权重与排序。
- `src/fence.js` —— 插件 HTTP 路由的同源准入校验。
- `client.js` —— 设置页与首页面板（React，只用主题 token）。
- `scripts/selftest.mjs` —— 引擎自测（桩 `llm`）。
- `scripts/render-smoke.mjs` —— 渲染冒烟测试（垫片 React）。

## 限制

- 流式用量由适配器上报；提供方不报时按文本长度估算，这类行的速度只是近似值。
- 部分聚合通道会把整段回答一次性推回，测到的是"爆发速率"而非稳定码率，数值会偏高。
- 能力只是冒烟测试（几道小题），不是评测套件：能区分"能用/不能用"和明显的指令失败，区分不了细粒度的质量差异。
- 回答错了但请求正常的模型仍算"可用"——状态列看可达性，稳定列看掉线率，能力列看质量。
- 稳定性是**采样**，不是统计保证：3 次重复能抓出高频掉线，抓不到千分之几的偶发失败。想更严就把 `stab` 的 `repeats` 调大。
- 长输入探测约 1.6k token，用来暴露"只能扛小请求"的路由；它不是长上下文压力测试，128k 级别的能力仍要看上下文窗口元数据。
- prepared call 是一次性的，所以每一项探测各准备一次（快速模式每模型 3 次准备 + 3 次请求；深度模式 8 次）。
- 额度只在有钱包或免费通道时才是真数据，其余一律「未报告」。
- **输入模态筛选看的是「模型能接收什么」，不是「模型能产出什么」**：DH 的模型目录只暴露 `inputModalities`（`text` / `image` …），没有产出模态字段。所以「支持图片」= **能读图**，不代表能画图；图片生成模型在当前目录结构下无法从元数据识别，只能按模型名/描述人工判断。
