/**
 * `dsh-model-rank` — Host half.
 *
 * Owns a benchmark engine (`src/bench.js`) and exposes it twice:
 *
 * - `model_rank`, a model-facing Tool, so an agent can measure the inventory
 *   and get a ranked table in the conversation;
 * - `/api/model-rank/*`, the same engine over same-origin JSON, so the settings
 *   page (Client half) can start a run, watch progress and render the table.
 *
 * The plugin hard-depends on `llm` and `tools` only. `webServer` is reached
 * through a nested `ctx.inject` so a headless composition loses the page and
 * keeps the tool instead of failing to activate.
 *
 * @module index.js
 */

import { createBench } from './src/bench.js'
import { createFence } from './src/fence.js'

export const name = 'model-rank'

/** Only what the plugin cannot exist without; everything else is optional. */
export const inject = ['llm', 'tools']

/** Readable bodies only: these routes carry filters and nothing bulky. */
const MAX_BODY_BYTES = 64 * 1024

export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const bench = createBench({ ctx, logger, config })
  const applySelection = createApplier(ctx, logger)

  ctx.effect(() => () => bench.dispose(), 'model-rank: engine')

  ctx.effect(() => ctx.tools.register(toolDefinition(bench, applySelection)), 'model-rank: model_rank tool')

  ctx.inject(['webServer'], scoped => {
    const fence = createFence(() => (typeof ctx.get === 'function' ? ctx.get('connection') : undefined))
    scoped.effect(
      () => scoped.webServer.register({
        kind: 'prefix',
        path: '/api/model-rank',
        handler: createRoutes(bench, fence, logger, applySelection),
      }),
      'model-rank: http api',
    )
    logger.info?.('model-rank: settings API mounted at /api/model-rank')
  })
}

// ── applying a ranked model ───────────────────────────────────────────────────

/**
 * Install one selection, the same way the composer's model picker does.
 *
 * With a `sessionId` the session controller resumes that session, switches its
 * model, and saves the default in the background. Without one (the settings
 * page has no session), the default selection is written directly so new
 * sessions open on the chosen route.
 */
function createApplier(ctx, logger) {
  const optional = name => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)

  return async function applySelection({ provider, model, sessionId }) {
    const providerId = String(provider ?? '').trim()
    const modelId = String(model ?? '').trim()
    if (providerId === '' || modelId === '') throw Object.assign(new Error('a provider and a model are required'), { code: 'BAD_SELECTION' })

    // Validate before touching any persisted selection: an unknown route must
    // not end up as the saved default.
    const info = await ctx.llm.resolveModelInfo(providerId, modelId)

    // Keep the reasoning effort only when the target model lists that effort:
    // a complete selection is saved, so dropping it would silently downgrade.
    const current = optional('agentDefaultModel')?.currentSelection?.()
    const effort = current?.reasoningEffort
    const supported = effort !== undefined && (info?.reasoning?.efforts ?? []).some(item => item.id === effort)
    const selection = { provider: providerId, model: modelId, ...(supported ? { reasoningEffort: effort } : {}) }

    const sessions = optional('sessionController')
    if (typeof sessionId === 'string' && sessionId !== '' && typeof sessions?.selectModel === 'function') {
      const value = await sessions.selectModel({ sessionId, ...selection })
      logger.info?.(`model-rank: session ${sessionId} switched to ${providerId}/${modelId}`)
      return { mode: 'session', sessionId, selected: value?.selected ?? selection }
    }

    const defaults = optional('agentDefaultModel')
    if (typeof defaults?.saveSelection !== 'function') {
      throw Object.assign(new Error('no model selection service is mounted'), { code: 'NO_SELECTOR' })
    }
    await defaults.saveSelection(selection)
    logger.info?.(`model-rank: default model set to ${providerId}/${modelId}`)
    return { mode: 'default', selected: defaults.currentSelection?.() ?? selection }
  }
}

// ── HTTP surface ──────────────────────────────────────────────────────────────

function createRoutes(bench, fence, logger, applySelection) {
  return async function handler(req, res) {
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    }

    const rejection = fence(req)
    if (rejection !== undefined) {
      return send(rejection, {
        error: rejection === 401 ? 'unauthorized' : rejection === 503 ? 'admission unavailable' : 'forbidden',
      })
    }

    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      return send(400, { error: 'bad request target' })
    }
    const route = pathname.replace(/^\/api\/model-rank/, '').replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()

    try {
      if (method === 'GET' && (route === '/' || route === '/state')) return send(200, bench.snapshot())

      if (method === 'GET' && route === '/targets') {
        const inventory = await bench.enumerate()
        return send(200, {
          providers: inventory.providers,
          providerErrors: inventory.errors,
          models: inventory.rows.map(row => ({
            key: row.key,
            provider: row.provider,
            providerName: row.providerName,
            model: row.model,
            name: row.name,
          })),
          at: inventory.at,
        })
      }

      if (method === 'POST' && route === '/run') {
        const body = await readJson(req)
        const started = bench.start(body ?? {})
        return send(started.ok ? 202 : 409, started.ok ? bench.snapshot() : started)
      }

      if (method === 'POST' && route === '/cancel') {
        const cancelled = bench.cancel()
        return send(200, { ok: cancelled, state: bench.snapshot() })
      }

      if (method === 'POST' && route === '/apply') {
        const body = await readJson(req)
        try {
          const applied = await applySelection({
            provider: body?.provider,
            model: body?.model,
            sessionId: body?.sessionId,
          })
          return send(200, { ok: true, ...applied, state: bench.snapshot() })
        } catch (error) {
          const code = error?.code === 'BAD_SELECTION' ? 400 : 409
          logger.warn?.(`model-rank: apply rejected (${error?.message ?? error})`)
          return send(code, { error: String(error?.message ?? error) })
        }
      }

      if (method === 'GET' && route === '/report') {
        if (new URL(req.url ?? '/', 'http://localhost').searchParams.get('format') === 'md') {
          const body = bench.reportText()
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' })
          return res.end(body)
        }
        return send(200, bench.snapshot())
      }

      return send(404, { error: `unknown route ${route}` })
    } catch (error) {
      logger.warn?.(`model-rank: ${method} ${route} failed (${error?.message ?? error})`)
      return send(500, { error: String(error?.message ?? error) })
    }
  }
}

/** Read one small JSON body; rejects oversized ones instead of buffering them. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(Object.assign(new Error('invalid JSON body'), { cause: error }))
      }
    })
    req.on('error', reject)
  })
}

// ── model-facing tool ────────────────────────────────────────────────────────

function toolDefinition(bench, applySelection) {
  return {
    name: 'model_rank',
    description: [
      'Test every LLM route currently mounted in this Harness and rank them, or switch this conversation to the best one.',
      '`action: list` reports the provider routes and the models they advertise (no requests are sent).',
      '`action: status` returns the last run, including progress while a run is going.',
      '`action: run` sends real, tiny requests: quick mode = 3 requests per model (one instruction check plus two repeats, so an intermittent route is caught); deep mode = 8 probes per model (instruction, repeats, arithmetic, JSON, Chinese, reasoning, a multi-turn follow-up and a long payload) for a finer capability and reliability score.',
      '`action: report` returns the last ranked table without measuring again.',
      '`action: apply` switches the current Session to the top-ranked model (or the `provider`/`model` given), which also saves it as the default for new Sessions. It needs an existing result: run first.',
      'Ranking blends availability 30%, stability 20%, first-token latency 15%, throughput 8%, capability 20% and provider-reported quota 7%. Stability is the share of probes that actually came back, so a route that answers once and then drops calls is demoted instead of topping the list. Quota is only known for routes that publish a wallet (DeepSeek account) or an unmetered free lane; other routes score neutral and show "未报告".',
      'Use `limit` to bound cost, and `mode: "quick"` unless the user asks for a thorough comparison.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'status', 'run', 'report', 'apply'],
          description: 'list = inventory only; status = current/last run; run = measure now; report = last ranked table; apply = switch to the best measured model.',
        },
        mode: {
          type: 'string',
          enum: ['quick', 'deep'],
          description: 'quick (default) = 3 requests per model (instruction + repeats); deep = 8 probes per model, including multi-turn and long payload. Deep costs roughly 3x the quota.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Measure at most this many models, in provider order. Omit to use the plugin default (all).',
        },
        providers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict the run to these exact provider route ids.',
        },
        concurrency: {
          type: 'integer',
          minimum: 1,
          maximum: 6,
          description: 'Parallel probes (default 3). Higher finishes sooner but is more likely to trip provider rate limits.',
        },
        provider: {
          type: 'string',
          description: 'For action: apply — the provider route to switch to. Omit to use rank #1.',
        },
        model: {
          type: 'string',
          description: 'For action: apply — the model id to switch to. Omit to use rank #1.',
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return [{ type: 'text', text: String(value?.text ?? '') }]
      },
    },
    async execute(args, exec) {
      const action = String(args?.action ?? 'status')
      if (action === 'list') {
        const inventory = await bench.enumerate()
        if (inventory.rows.length === 0 && inventory.errors.length === 0) {
          return { action, text: '没有发现任何已挂载的模型路由。' }
        }
        const lines = [`已挂载提供方 ${inventory.providers.length} 个，模型 ${inventory.rows.length} 个：`]
        for (const provider of inventory.providers) {
          const models = inventory.rows.filter(row => row.provider === provider.id)
          lines.push(`- ${provider.name} (\`${provider.id}\`)：${models.length > 0 ? models.map(row => `\`${row.model}\``).join('、') : '无可用模型'}`)
        }
        for (const failure of inventory.errors) {
          lines.push(`- ${failure.providerName} (\`${failure.provider}\`)：枚举失败（${failure.kind}：${failure.message}）`)
        }
        return { action, text: lines.join('\n'), providers: inventory.providers, models: inventory.rows.length }
      }

      if (action === 'status') {
        const state = bench.snapshot()
        if (state.rows.length === 0) {
          return { action, text: state.running ? '测试正在进行中，还没有结果。' : '还没有测试结果。用 model_rank(action: "run") 开始。' }
        }
        const lead = state.running
          ? `测试进行中：${state.progress.done}/${state.progress.total}，当前 ${state.progress.current || '—'}。`
          : `上次测试：${new Date(state.finishedAt || state.startedAt).toLocaleString()}（${state.mode === 'deep' ? '深度' : '快速'}模式），${state.rows.length} 个模型。`
        return { action, text: `${lead}\n\n${bench.reportText()}`, running: state.running }
      }

      if (action === 'report') {
        return { action, text: bench.reportText() }
      }

      if (action === 'run') {
        const result = await bench.runToCompletion({
          mode: args?.mode,
          limit: args?.limit,
          providers: args?.providers,
          concurrency: args?.concurrency,
        })
        if (!result.ok) return { action, text: `无法开始测试：${result.error}` }
        const state = result.state
        if (state.rows.length === 0) {
          return { action, text: `测试结束，但没有得到结果${state.error !== '' ? `（${state.error}）` : ''}。` }
        }
        const ok = state.rows.filter(row => row.status === 'ok').length
        const failed = state.rows.length - ok
        const lead = `测试完成：${state.rows.length} 个模型，可用 ${ok} 个，失败 ${failed} 个。`
        const notes = []
        if (state.providerErrors.length > 0) {
          notes.push(`未能枚举的提供方：${state.providerErrors.map(item => `${item.providerName}（${item.kind}）`).join('、')}`)
        }
        if (state.quota.kind === 'balance' && state.quota.text !== '') notes.push(`账户余额：${state.quota.text}`)
        return {
          action,
          text: [lead, ...notes, '', bench.reportText()].join('\n'),
          rows: state.rows.length,
          available: ok,
        }
      }

      if (action === 'apply') {
        const state = bench.snapshot()
        const best = state.rows[0]
        if (best === undefined) {
          return { action, text: '还没有测试结果，先运行 model_rank(action: "run") 再切换。' }
        }
        const provider = String(args?.provider ?? best.provider ?? '')
        const model = String(args?.model ?? best.model ?? '')
        if (provider === '' || model === '') {
          return { action, text: '没有可用的模型选择：请在 args 里给出 provider 和 model。' }
        }
        if (args?.provider === undefined && best.status !== 'ok') {
          return { action, text: '排名第一的模型不可用（全部测试失败），没有可切换的目标。' }
        }
        try {
          const applied = await applySelection({ provider, model, sessionId: exec?.agent?.id })
          const selected = applied.selected ?? { provider, model }
          const scope = applied.mode === 'session' ? '当前会话' : '默认模型'
          const explicit = args?.provider !== undefined || args?.model !== undefined
          return {
            action,
            text: explicit
              ? `已切换到 ${selected.provider}/${selected.model}（${scope}）。`
              : `已切换到 ${selected.provider}/${selected.model}（${scope}），它就是当前排名第一的模型。`,
            selected,
            scope: applied.mode,
          }
        } catch (error) {
          return { action, text: `切换失败：${error?.message ?? error}` }
        }
      }

      return { action, text: `未知 action：${action}` }
    },
  }
}
