# Model Rank (dsh-model-rank)

Tests every LLM route this Harness has mounted, then ranks the models by
**availability, remaining quota, capability and speed** — measured, not guessed.

## Install

`dsh-model-rank` is a DSH profile bundle: a Host half (probes, HTTP API, tool)
plus a web Client half (settings page and the composer panel). No build step and
no runtime dependencies.

1. Add the dependency to the profile's `package.json`:

   ```json
   "dependencies": {
     "dsh-model-rank": "github:wuhuyoua/dsh-model-rank"
   }
   ```

2. Add the bundle to the composed profile:

   ```json
   "dsh": {
     "profile": {
       "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-model-rank"]
     }
   }
   ```

3. Install it in that profile (through the Plugin Manager, or
   `dsh plugin --profile <profile> install`), then refresh the page once.

To remove it, drop the bundle entry and the dependency, then install again.

## Development

```bash
npm test          # offline self-test: stub llm service, no network, no quota
```

The test drives the real engine against a stub that follows the `llm` contract,
including the "a prepared call can only be dispatched once" rule, so a dispatch
bug fails before it reaches a provider.

## Where it shows up

- **Home page, under the composer** — one ambient row: the current best model and
  its score, a **Test / 测试** button that starts a quick run, and an expandable
  **top five** panel (rank · model · provider · score). `Alt+Shift+M` toggles
  that panel from anywhere on the page, so a test never needs the settings page.
- **Settings → 模型优选 / Model Rank**: the full ranked table, with a run/stop
  control, mode/limit/concurrency/provider filters, sortable headers and
  per-model details.
- **`model_rank` tool**: the same engine for the agent —
  `action: "list" | "status" | "run" | "report"`.
  `run` accepts `mode: "quick" | "deep"`, `limit`, `providers`, `concurrency`.

Both UI surfaces read the same Host state, so the panel and the table never
disagree.

## What a run measures

1. **Inventory** — `ctx.llm.listProviders()` then `ctx.llm.listModels(provider)`.
   A provider that cannot enumerate is reported as a failed provider, never
   skipped silently.
2. **Probe** — one real completion request per model through
   `ctx.llm.prepareCall()` + `prepared.stream()`, recording:
   - time to first token and total time,
   - streamed output tokens/second,
   - the finish reason and any provider failure code/status.
3. **Capability** — deterministic tasks with machine-checkable answers:
   - `quick` mode: instruction following ("reply with exactly OK").
   - `deep` mode: + arithmetic (`17 × 23`), exact JSON output, and a Chinese
     instruction. Each answer is checked, never judged by a model.

Deep mode also calls `ctx.llm.resolveModelInfo()` for the context window and
reasoning support used by the capability blend.

## Scoring

| Dimension    | Weight | How it is computed |
| ------------ | ------ | ------------------ |
| Availability | 40%    | 100 when a request finished normally with assistant text, else 0 |
| Speed        | 25%    | 55% first-token score (400 ms great, 2.9 s zero) + 45% throughput (3 tok/s zero, 50 tok/s full) |
| Capability   | 25%    | 72% task accuracy + 18% context window + 10% reasoning support |
| Quota        | 10%    | 100 free lane · wallet balance bands (≥100 → 100 … 0 → 0) · unknown → neutral 55 |

An unavailable route scores 0 regardless of the other dimensions. Weights are
normalized and can be overridden in `cordis.patch.yml`:

```yaml
- id: model-rank
  name: dsh-model-rank
  config:
    weights: { availability: 0.5, speed: 0.2, capability: 0.2, quota: 0.1 }
    concurrency: 3
    limit: 0
```

## Quota honesty

Only two quota shapes are real:

- **DeepSeek account** (`deepseek*` providers) — `ctx.deepseekAccount.getBalance()`
  returns the recharge and bonus wallets; the table shows the amount.
- **Free lanes** — a route whose id says `free`/`aggregate` is scored as
  unmetered and labelled 免费通道 / free lane.

Anything else reports 未报告 / not reported and scores the neutral 55. A wallet
balance of zero shows up as a failed probe anyway, so the ranking does not
pretend an empty account is healthy.

## Cost

Quick mode is one tiny request per model (capped at 96 output tokens). Deep mode
is four requests. Nothing is sent until you press the button or call the tool,
and the plugin never runs on a timer.

## Files

- `index.js` — Host half: tool registration and `/api/model-rank/*`.
- `src/bench.js` — inventory, probing, progress, persistence (`~/.dsh/model-rank/report.json`).
- `src/scoring.js` — pure scoring, weights and ranking.
- `src/fence.js` — same-origin admission for the plugin's HTTP routes.
- `client.js` — the settings page and the composer panel (React, theme tokens only).

## Limits

- Streaming usage is reported by the adapter; when a provider omits it, output
  tokens are estimated from text length, so speed is approximate for those rows.
- Some aggregating providers deliver a whole answer in one burst; the measured
  rate then describes that burst, not a steady token cadence, and reads very high.
- Capability is a smoke test (four short tasks), not a benchmark suite: it
  separates working routes from broken ones and catches gross instruction
  failures, not fine-grained quality differences.
- A model that answers the availability prompt wrongly is still "available" —
  the status column reports reachability, the capability column reports quality.
- A prepared call is single-use, so deep mode prepares once per task (four
  preparations and four requests per model). Quick mode is one of each.
- Quota is only real where a wallet or a free lane exists; every other route
  reports 未报告 and scores the neutral 55.
