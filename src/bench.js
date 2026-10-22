/**
 * The measurement engine behind `dsh-model-rank`.
 *
 * One run does three things, in this order:
 *
 * 1. inventory — ask `ctx.llm` which provider routes are mounted and which
 *    models each one advertises. Nothing is invented: if a provider cannot
 *    enumerate, it is reported as a failed provider rather than skipped.
 * 2. probe — send real (tiny) requests through `ctx.llm.prepareCall`/`stream`,
 *    timing the first token and the streamed rate, and checking deterministic
 *    answers so "capability" is measured rather than guessed.
 * 3. score — fold availability, speed, capability and provider-reported quota
 *    into one composite (`src/scoring.js`) and sort best-first.
 *
 * Results live in memory, are mirrored to `~/.dsh/model-rank/report.json`, and
 * are readable by the settings page and the `model_rank` tool alike.
 *
 * @module src/bench.js
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  compositeScore,
  capabilityScore,
  normalizeWeights,
  quotaScoreOf,
  stabilityScore,
  ttftScore,
  throughputScore,
  availabilityScore,
  withRanks,
} from './scoring.js'

/** How long a single capability task may take before it counts as a timeout. */
const TASK_TIMEOUT_MS = { quick: 45_000, deep: 75_000 }
/** Cap on route preparation (adapter lookup + capability resolution). */
const PREPARE_TIMEOUT_MS = 20_000
/** Cap on metadata resolution; a failure only costs the row its static scores. */
const INFO_TIMEOUT_MS = 8_000
/** Output cap for every probe: enough for a short answer, cheap enough to repeat. */
const MAX_OUTPUT_TOKENS = 96
/** Model catalogues are cached this long, so opening the page does not re-enumerate. */
const TARGETS_TTL_MS = 5 * 60_000

/**
 * The deterministic probes.
 *
 * `quick` probes run in both modes; the others only in deep mode.
 * Each capability probe has a weight for the capability score.
 *
 * `stab` is a reliability probe: it repeats the trivial prompt and only counts
 * whether replies came back. Real conversations break on the second call, so a
 * single success must not read as a perfect availability score.
 * `multi` replays a short exchange (history + follow-up question) because every
 * real DSH conversation carries history.
 * `long` sends a large payload with a short question: routes that only survive
 * tiny prompts are exactly the ones that "cannot reply" mid-conversation.
 */
const OK_PROMPT = 'Reply with exactly OK and nothing else.'

/** Filler for the long-payload probe (~1.2k words ≈ 1.6k tokens). */
const LONG_FILLER = Array.from({ length: 60 }, (_, index) =>
  `Paragraph ${index + 1}. The maintenance log records routine checks of the relay station, `
  + 'including voltage readings, coolant levels and antenna alignment, together with the '
  + 'operator notes for that shift. Nothing unusual was reported during this interval. ').join('')

const TASKS = [
  {
    id: 'ok',
    quick: true,
    gate: true,
    weight: 0.12,
    prompt: OK_PROMPT,
    check: text => /^\W*ok\W*$/i.test(text.trim()),
  },
  {
    id: 'stab',
    quick: true,
    stability: true,
    repeats: 2,
    weight: 0,
    prompt: OK_PROMPT,
    check: text => /^\W*ok\W*$/i.test(text.trim()),
  },
  {
    id: 'math',
    weight: 0.16,
    prompt: 'What is 17 multiplied by 23? Answer with only the number.',
    check: text => /(^|\D)391(\D|$)/.test(text.replace(/,/g, '')),
  },
  {
    id: 'json',
    weight: 0.20,
    prompt: 'Return exactly this JSON object and nothing else: {"city":"Paris","ok":true}',
    check: text => {
      const match = text.match(/\{[\s\S]*\}/)
      if (match === null) return false
      try {
        const value = JSON.parse(match[0])
        return value?.city === 'Paris' && value?.ok === true
      } catch {
        return false
      }
    },
  },
  {
    id: 'zh',
    weight: 0.16,
    prompt: '把「蓝色」这个词重复三次，用单个空格分隔，只输出结果，不要任何解释。',
    check: text => (text.match(/蓝色/g) ?? []).length === 3,
  },
  {
    id: 'reason',
    weight: 0.16,
    prompt: '分步推理：从北京坐高铁到上海要多久？只输出最终结论（数字+单位）。',
    check: text => /(\d+(\.\d+)?\s*(小时|分钟|h|min))/i.test(text),
  },
  {
    id: 'multi',
    weight: 0.10,
    // Reasoning routes spend tokens on the trace before any text, so these two
    // probes get a larger cap than the one-line checks.
    maxTokens: 256,
    messages: [
      { role: 'user', content: [{ type: 'text', text: '记住这个数字：42。只回复 OK。' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      { role: 'user', content: [{ type: 'text', text: '我刚才让你记住的数字是多少？只输出数字。' }] },
    ],
    check: text => /(^|\D)42(\D|$)/.test(text),
  },
  {
    id: 'long',
    weight: 0.10,
    maxTokens: 256,
    prompt: `${LONG_FILLER}\n\n以上是设备巡检日志。请只输出这一行：LONG_OK`,
    check: text => /LONG_OK/.test(text),
  },
]

/** Which quota mechanism a provider route uses. */
function providerKind(providerId) {
  if (/^deepseek/i.test(providerId)) return 'balance'
  if (/free|aggregate/i.test(providerId)) return 'free'
  return 'unknown'
}

/** Directory the plugin persists its last report in. */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

/**
 * Race a promise against a timer and an abort signal. The timer is always
 * cleared and the abort listener always removed, so a slow provider cannot
 * leak one listener per probe.
 */
function withTimeout(promise, ms, signal) {
  let timer
  let onAbort
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'TIMEOUT' })), ms)
    timer.unref?.()
  })
  const aborted = new Promise((_, reject) => {
    if (signal === undefined || signal === null) return
    onAbort = () => reject(signal.reason ?? Object.assign(new Error('aborted'), { code: 'ABORTED' }))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, timeout, aborted]).finally(() => {
    clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener?.('abort', onAbort)
  })
}

/** A signal that aborts when any input does. */
function anySignal(signals) {
  const list = signals.filter(signal => signal !== undefined && signal !== null)
  if (list.length === 0) return undefined
  if (list.length === 1) return list[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list)
  const controller = new AbortController()
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/** Turn anything thrown by an adapter into a stable, displayable failure. */
export function describeFailure(error) {
  const message = String(error?.message ?? error ?? 'unknown error').slice(0, 400)
  const status = Number.isFinite(error?.status) ? error.status : undefined
  const code = typeof error?.code === 'string' && error.code !== '' ? error.code : `HTTP_${status ?? 0}`
  let kind = 'error'
  const probe = `${code} ${message}`.toLowerCase()
  if (status === 401 || status === 403 || /unauthor|forbidden|invalid.*key|api key/.test(probe)) kind = 'auth'
  else if (status === 402 || /quota|balance|insufficient|credit|余额/.test(probe)) kind = 'quota'
  else if (status === 429 || /rate.?limit|too many|busy|overload/.test(probe)) kind = 'rate-limit'
  else if (status === 404 || /not found|no such model|unknown model/.test(probe)) kind = 'not-found'
  else if (/timeout|timed out|aborted|etimedout/.test(probe)) kind = 'timeout'
  else if (/network|fetch failed|econn|enotfound|socket|tls/.test(probe)) kind = 'network'
  return { kind, code: code.slice(0, 80), message, status }
}

/** One JSON-safe model row before it is measured. */
function targetOf(provider, model, index) {
  const modelId = String(model?.id ?? '')
  return {
    index,
    key: `${provider.id}\u0000${modelId}`,
    provider: provider.id,
    providerName: provider.name || provider.id,
    model: modelId,
    name: typeof model?.name === 'string' && model.name !== '' ? model.name : modelId,
    description: typeof model?.description === 'string' ? model.description : '',
    modalities: Array.isArray(model?.inputModalities) ? [...model.inputModalities] : [],
    contextWindow: Number.isFinite(model?.contextWindow) ? model.contextWindow : undefined,
  }
}

/** Client-facing shape of one capability task. */
function toTaskView(task) {
  return {
    id: task.id,
    ok: task.ok,
    answered: task.answered,
    ttftMs: task.ttftMs,
    totalMs: task.totalMs,
    outputTokens: task.outputTokens,
    tokensPerSecond: task.tokensPerSecond,
    chunkCount: task.chunkCount,
    text: typeof task.text === 'string' ? task.text.slice(0, 200) : '',
    failure: task.failure,
  }
}

/**
 * Build the engine. The returned object is the single owner of the run state;
 * the HTTP routes and the tool both call into it so there is one implementation
 * of "test the models" rather than two.
 */
export function createBench({ ctx, logger = console, config = {} }) {
  const weights = normalizeWeights(config?.weights)
  const defaults = {
    mode: config?.mode === 'deep' ? 'deep' : 'quick',
    concurrency: Number.isFinite(Number(config?.concurrency))
      ? Math.min(6, Math.max(1, Number(config.concurrency)))
      : 3,
    limit: Number.isFinite(Number(config?.limit)) && Number(config.limit) >= 0 ? Number(config.limit) : 0,
  }
  const reportFile = path.join(dshHome(), 'model-rank', 'report.json')

  /** Abort controller of the run in flight, if any. */
  let current = null
  /** Cached inventory. */
  let targets = { at: 0, rows: [], providers: [], errors: [] }
  /** Quota reading, refreshed with each run. */
  let quota = { kind: 'unknown', wallets: [], text: '', at: 0 }
  /** Last finished (or in-flight) run. */
  let run = {
    running: false,
    startedAt: 0,
    finishedAt: 0,
    mode: defaults.mode,
    error: '',
    rows: [],
    progress: { total: 0, done: 0, current: '', phase: 'idle' },
  }

  // ── persistence ─────────────────────────────────────────────────────────────
  function loadReport() {
    try {
      const raw = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
      if (raw === null || typeof raw !== 'object') return
      if (Array.isArray(raw.rows) && raw.rows.length > 0) {
        run = {
          ...run,
          rows: raw.rows,
          mode: raw.mode === 'deep' ? 'deep' : 'quick',
          startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : 0,
          finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : 0,
        }
      }
    } catch {
      // No previous report, or an unreadable one: an empty table is honest.
    }
  }

  function saveReport() {
    try {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true })
      fs.writeFileSync(reportFile, JSON.stringify({
        version: 1,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        mode: run.mode,
        rows: run.rows,
      }), 'utf8')
    } catch (error) {
      logger.warn?.(`model-rank: could not persist the report (${error?.message ?? error})`)
    }
  }

  loadReport()

  // ── inventory ───────────────────────────────────────────────────────────────
  async function enumerate({ force = false } = {}) {
    if (!force && targets.rows.length > 0 && Date.now() - targets.at < TARGETS_TTL_MS) return targets
    const providers = []
    const errors = []
    const rows = []
    let list
    try {
      list = ctx.llm.listProviders()
    } catch (error) {
      throw new Error(`the llm service listed no providers: ${error?.message ?? error}`)
    }
    for (const provider of list ?? []) {
      const id = String(provider?.id ?? '')
      if (id === '') continue
      const entry = { id, name: String(provider?.name ?? id) }
      providers.push(entry)
      let models = []
      try {
        models = await withTimeout(Promise.resolve(ctx.llm.listModels(id)), 30_000)
      } catch (error) {
        const failure = describeFailure(error)
        errors.push({ provider: id, providerName: entry.name, ...failure })
        logger.warn?.(`model-rank: provider ${id} did not enumerate (${failure.kind}: ${failure.message})`)
        continue
      }
      for (const model of Array.isArray(models) ? models : []) {
        if (String(model?.id ?? '') === '') continue
        rows.push(targetOf(entry, model, rows.length))
      }
    }
    targets = { at: Date.now(), rows, providers, errors }
    return targets
  }

  // ── quota ───────────────────────────────────────────────────────────────────
  async function readQuota() {
    const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined
    if (account === undefined || account === null) {
      quota = { kind: 'unknown', wallets: [], text: '', at: Date.now() }
      return quota
    }
    const client = {
      version: '1.0.0',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }
    try {
      const balance = await withTimeout(Promise.resolve(account.getBalance(client)), 10_000)
      if (balance === null || balance?.status !== 'ready') {
        quota = { kind: 'unknown', wallets: [], text: '', at: Date.now() }
        return quota
      }
      const wallets = [...(balance.value ?? []), ...(balance.bonusWallets ?? [])]
        .map(wallet => ({
          currency: String(wallet?.currency ?? ''),
          balance: String(wallet?.balance ?? ''),
        }))
        .filter(wallet => Number.isFinite(Number(wallet.balance)))
      // Wallets are published in CNY and/or USD; only one currency is summed.
      const mainCurrency = wallets[0]?.currency ?? ''
      const total = wallets
        .filter(wallet => wallet.currency === mainCurrency || mainCurrency === '')
        .reduce((sum, wallet) => sum + Number(wallet.balance), 0)
      quota = {
        kind: 'balance',
        wallets,
        total,
        currency: mainCurrency,
        text: wallets.map(wallet => `${wallet.balance} ${wallet.currency}`).join(' + '),
        at: Date.now(),
      }
    } catch (error) {
      logger.debug?.(`model-rank: balance unavailable (${error?.message ?? error})`)
      quota = { kind: 'unknown', wallets: [], text: '', at: Date.now() }
    }
    return quota
  }

  /** Quota score for one row's provider, using the current snapshot. */
  function quotaFor(providerId) {    const kind = providerKind(providerId)
    if (kind === 'free') return { kind, score: quotaScoreOf({ kind: 'free' }), text: '' }
    if (kind === 'balance' && quota.kind === 'balance' && Number.isFinite(quota.total)) {
      return { kind: 'balance', score: quotaScoreOf({ kind: 'balance', balance: quota.total }), text: quota.text }
    }
    return { kind: 'unknown', score: quotaScoreOf({ kind: 'unknown' }), text: '' }
  }

  // ── one model ───────────────────────────────────────────────────────────────
  /**
   * Run one capability task. A prepared call is single-use, so every task gets
   * its own preparation with the exact output cap the stream is dispatched with.
   */
  async function runTask(target, task, mode, signal) {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(Object.assign(new Error('task timed out'), { code: 'TIMEOUT' })),
      TASK_TIMEOUT_MS[mode],
    )
    timer.unref?.()
    const callSignal = anySignal([signal, controller.signal])
    const started = Date.now()
    let ttftMs = 0
    let text = ''
    let usage = null
    let finish = null
    let answered = false
    let chunkCount = 0
    try {
      let prepared
      try {
        prepared = await withTimeout(
          Promise.resolve(ctx.llm.prepareCall({
            provider: target.provider,
            model: target.model,
            maxTokens: task.maxTokens ?? MAX_OUTPUT_TOKENS,
          }, callSignal)),
          PREPARE_TIMEOUT_MS,
          callSignal,
        )
      } catch (error) {
        return {
          id: task.id,
          ok: false,
          answered: false,
          ttftMs: 0,
          totalMs: Date.now() - started,
          text: '',
          usage,
          chunkCount: 0,
          failure: describeFailure(error),
        }
      }
      const stream = prepared.stream({
        ...prepared.config,
        messages: task.messages ?? [{ role: 'user', content: [{ type: 'text', text: task.prompt }] }],
        signal: callSignal,
      })
      for await (const chunk of stream) {
        chunkCount++
        if (chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta') {
          if (ttftMs === 0 && typeof chunk.text === 'string' && chunk.text.length > 0) {
            ttftMs = Date.now() - started
          }
        }
        if (chunk?.type === 'text-delta') {
          text += chunk.text ?? ''
          if ((chunk.text ?? '').length > 0) answered = true
        }
        if (chunk?.type === 'usage') usage = chunk.usage
        if (chunk?.type === 'finish') finish = chunk.reason
      }
      const finished = Date.now()
      if (finish?.kind === 'error' || finish?.kind === 'aborted') {
        const failure = finish.failure ?? {}
        return {
          id: task.id,
          ok: false,
          answered: false,
          ttftMs: ttftMs || finished - started,
          totalMs: finished - started,
          text: text.slice(0, 500),
          usage,
          chunkCount,
          failure: describeFailure({ message: failure.message, code: failure.code, status: failure.status }),
        }
      }
      const outputTokens = Number(usage?.outputTokens ?? 0) || Math.ceil(text.length / 4)
      // Streaming window = wall time after the first token, so the rate is not
      // diluted by the wait before the model started answering.
      const windowMs = Math.max(1, (finished - started) - ttftMs)
      const normalFinish = finish === null || finish.kind === 'stop' || finish.kind === 'max-tokens' || finish.kind === 'tool-calls'
      const available = normalFinish && (answered || outputTokens > 0)
      return {
        id: task.id,
        ok: task.check(text),
        answered: available,
        ttftMs: ttftMs || finished - started,
        totalMs: finished - started,
        text: text.slice(0, 500),
        outputTokens,
        tokensPerSecond: outputTokens / (windowMs / 1000),
        chunkCount,
        usage,
        finish: finish?.kind ?? 'unknown',
        failure: available
          ? undefined
          : { kind: 'empty', code: 'EMPTY_RESPONSE', message: 'the route finished without any assistant text' },
      }
    } catch (error) {
      const failure = signal?.aborted
        ? describeFailure({ message: 'cancelled', code: 'ABORTED' })
        : describeFailure(error)
      return { id: task.id, ok: false, answered: false, ttftMs: 0, totalMs: Date.now() - started, text, usage, failure }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Measure one target; never throws. */
  async function probe(target, mode, signal) {
    const started = Date.now()
    const base = {
      ...target,
      status: 'running',
      quota: quotaFor(target.provider),
      tasks: [],
      text: '',
    }
    if (signal.aborted) return { ...base, status: 'cancelled', totalMs: 0 }

    let info
    try {
      info = await withTimeout(
        Promise.resolve(ctx.llm.resolveModelInfo(target.provider, target.model)),
        INFO_TIMEOUT_MS,
        signal,
      )
    } catch {
      info = undefined
    }
    const contextWindow = Number.isFinite(info?.context?.contextWindow)
      ? info.context.contextWindow
      : target.contextWindow
    const reasoning = info?.reasoning === undefined ? undefined : info.reasoning.efforts.length > 0

    const plan = mode === 'deep' ? TASKS : TASKS.filter(task => task.quick)
    const tasks = []
    for (const task of plan) {
      const repeats = task.stability ? Math.max(1, Number(task.repeats) || 2) : 1
      const runs = []
      for (let attempt = 0; attempt < repeats; attempt++) {
        const result = await runTask(target, task, mode, signal)
        runs.push(result)
        // The first probe is the availability gate: a route that cannot answer
        // one trivial prompt has nothing left to measure, so the rest is
        // skipped to avoid burning quota on it.
        if (attempt === 0 && plan[0] === task && !result.answered) {
          return {
            ...base,
            status: signal.aborted ? 'cancelled' : 'error',
            failure: result.failure,
            tasks: tasks.map(toTaskView).concat([toTaskView(result)]),
            contextWindow,
            reasoning,
            totalMs: Date.now() - started,
            quotaScore: base.quota.score,
            ttftScore: 0,
            throughputScore: 0,
            stabilityScore: 0,
            capabilityScore: 0,
            score: 0,
          }
        }
        if (signal.aborted) break
      }
      const answeredCount = runs.filter(item => item.answered).length
      const first = runs[0] ?? {}
      const rateSamples = runs.filter(item => Number.isFinite(item.tokensPerSecond) && item.tokensPerSecond > 0)
      tasks.push({
        ...first,
        // A repeated probe only counts as correct when every attempt was.
        ok: runs.length > 0 && runs.every(item => item.ok),
        answered: answeredCount === runs.length,
        attempts: runs.length,
        answeredCount,
        failure: first.failure,
        tokensPerSecond: rateSamples.length > 0
          ? rateSamples.reduce((sum, item) => sum + item.tokensPerSecond, 0) / rateSamples.length
          : first.tokensPerSecond,
      })
      if (signal.aborted) break
    }

    const first = tasks[0]
    const answered = tasks.some(task => task.answered)
    // Reliability counts every individual attempt, not just distinct tasks: the
    // repeated probe is what exposes a route that answers once and then dies.
    const attempts = tasks.reduce((sum, task) => sum + (Number(task.attempts) || 1), 0)
    const answeredCount = tasks.reduce(
      (sum, task) => sum + (Number.isFinite(task.answeredCount) ? task.answeredCount : (task.answered ? 1 : 0)),
      0,
    )
    const totalMs = Date.now() - started
    const okCount = tasks.filter(task => task.ok).length
    // Weighted task score: sum of (weight * pass) for deep mode, simple ratio for quick
    const totalWeight = plan.reduce((sum, task) => sum + task.weight, 0)
    const earnedWeight = tasks
      .filter((_, i) => plan[i] && tasks[i]?.ok)
      .reduce((sum, task, i) => sum + (plan[i]?.weight ?? 0), 0)
    const taskScore = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : (okCount / Math.max(1, tasks.length)) * 100
    const outputTokens = tasks.reduce((sum, task) => sum + (task.outputTokens ?? 0), 0)
    const inputTokens = tasks.reduce((sum, task) => sum + (task.usage?.inputTokens ?? 0), 0)
    const rateSamples = tasks.filter(task => Number.isFinite(task.tokensPerSecond) && task.tokensPerSecond > 0)
    const tokensPerSecond = rateSamples.length > 0
      ? rateSamples.reduce((sum, task) => sum + task.tokensPerSecond, 0) / rateSamples.length
      : 0
    const text = first?.text ?? ''
    // Average chunk count per task (for burst penalty)
    const chunkCount = tasks.length > 0
      ? tasks.reduce((sum, task) => sum + (task.chunkCount ?? 0), 0) / tasks.length
      : 0
    const row = {
      ...base,
      status: answered ? 'ok' : 'error',
      failure: first?.failure,
      ttftMs: first?.ttftMs,
      totalMs,
      outputTokens,
      inputTokens,
      tokensPerSecond,
      chunkCount,
      text,
      sample: text.slice(0, 120),
      tasks: tasks.map(toTaskView),
      contextWindow,
      reasoning,
      taskScore,
      attempts,
      answeredCount,
    }
    row.capabilityScore = capabilityScore({ taskScore, contextWindow, reasoning })
    row.ttftScore = row.status === 'ok' ? ttftScore(row.ttftMs) : 0
    row.throughputScore = row.status === 'ok' ? throughputScore(row.tokensPerSecond, row.chunkCount) : 0
    row.stabilityScore = stabilityScore(row)
    row.quotaScore = row.quota.score
    row.score = compositeScore(row, weights)
    return row
  }

  // ── the run ─────────────────────────────────────────────────────────────────
  async function execute({ mode, limit, providers, concurrency }) {
    const controller = new AbortController()
    current = controller
    const signal = controller.signal
    run = {
      running: true,
      startedAt: Date.now(),
      finishedAt: 0,
      mode,
      error: '',
      rows: [],
      progress: { total: 0, done: 0, current: '', phase: 'inventory' },
    }
    try {
      await readQuota()
      const inventory = await enumerate()
      let rows = inventory.rows
      if (Array.isArray(providers) && providers.length > 0) {
        const wanted = new Set(providers.map(String))
        rows = rows.filter(row => wanted.has(row.provider))
      }
      if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit)
      run.progress = { total: rows.length, done: 0, current: '', phase: 'probing' }
      if (rows.length === 0) {
        run.error = 'no mounted model route was found'
        return
      }

      let cursor = 0
      const measured = []
      const worker = async () => {
        for (;;) {
          const index = cursor++
          if (index >= rows.length || signal.aborted) return
          const target = rows[index]
          run.progress.current = `${target.provider}/${target.model}`
          const row = await probe(target, mode, signal)
          measured.push(row)
          run.rows = withRanks(measured)
          run.progress.done = measured.length
        }
      }
      const size = Math.min(Math.max(1, concurrency), rows.length)
      await Promise.all(Array.from({ length: size }, worker))
      run.rows = withRanks(measured)
      if (signal.aborted) run.error = 'cancelled'
    } catch (error) {
      run.error = String(error?.message ?? error)
      logger.warn?.(`model-rank: run failed (${run.error})`)
    } finally {
      run.running = false
      run.finishedAt = Date.now()
      run.progress.current = ''
      run.progress.phase = 'idle'
      if (current === controller) current = null
      if (run.rows.length > 0) saveReport()
    }
  }

  function resolveOptions(options) {
    return {
      mode: options.mode === 'deep' ? 'deep' : 'quick',
      limit: Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : defaults.limit,
      concurrency: Number.isFinite(Number(options.concurrency))
        ? Math.min(6, Math.max(1, Number(options.concurrency)))
        : defaults.concurrency,
      providers: Array.isArray(options.providers) ? options.providers : undefined,
    }
  }

  /** Start a run and return immediately; progress is read from `snapshot()`. */
  function start(options = {}) {
    if (run.running) return { ok: false, error: 'a test run is already in progress', state: snapshot() }
    // `execute` sets `run.running` synchronously before its first await.
    void execute(resolveOptions(options))
    return { ok: true }
  }

  /** Run to completion, for the tool path. */
  async function runToCompletion(options = {}) {
    if (run.running) return { ok: false, error: 'a test run is already in progress', state: snapshot() }
    await execute(resolveOptions(options))
    return { ok: true, state: snapshot() }
  }

  function cancel() {
    const controller = current
    if (run.running && controller !== null) {
      controller.abort(Object.assign(new Error('cancelled by user'), { code: 'ABORTED' }))
      return true
    }
    return false
  }

  /** The deployment's saved default model, when the service is mounted. */
  function readDefaultSelection() {
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
      const selection = service?.currentSelection?.()
      if (selection === null || selection === undefined) return undefined
      return {
        provider: String(selection.provider ?? ''),
        model: String(selection.model ?? ''),
        reasoningEffort: selection.reasoningEffort,
      }
    } catch {
      return undefined
    }
  }

  /** JSON-safe view for the settings page. */
  function snapshot() {
    return {
      running: run.running,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      mode: run.mode,
      error: run.error,
      progress: { ...run.progress },
      rows: run.rows,
      providers: targets.providers,
      providerErrors: targets.errors,
      quota: { kind: quota.kind, wallets: quota.wallets, text: quota.text, at: quota.at },
      defaultSelection: readDefaultSelection(),
      weights,
      defaults,
    }
  }

  /** Markdown table for the tool and the report route. */
  function reportText({ top = 0 } = {}) {
    const rows = top > 0 ? run.rows.slice(0, top) : run.rows
    if (rows.length === 0) return '尚未测试任何模型。先运行 model_rank(action: "run")。'
    const when = new Date(run.finishedAt || run.startedAt).toLocaleString()
    const lines = [
      `模型优选结果（${run.mode === 'deep' ? '深度模式' : '快速模式'}，${when}，共 ${rows.length} 个）`,
      '',
      '| # | 模型 | 提供方 | 综合 | 可用性 | 稳定 | 首字 | 吞吐 | 能力 | 额度 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ]
    for (const row of rows) {
      const ok = row.status === 'ok'
      lines.push([
        row.rank,
        `\`${row.model}\``,
        row.providerName,
        row.score,
        ok ? '可用' : `失败·${row.failure?.kind ?? 'error'}`,
        Number.isFinite(row.attempts) && row.attempts > 0
          ? `${row.answeredCount ?? 0}/${row.attempts}`
          : '—',
        Number.isFinite(row.ttftMs) ? `${Math.round(row.ttftMs)} ms` : '—',
        Number.isFinite(row.tokensPerSecond) && row.tokensPerSecond > 0 ? `${row.tokensPerSecond.toFixed(1)} tok/s` : '—',
        row.capabilityScore ?? 0,
        row.quota?.kind === 'free' ? '免费通道' : (row.quota?.text || '未报告'),
      ].join(' | '))
    }
    return lines.join('\n')
  }

  function dispose() {
    cancel()
    targets = { at: 0, rows: [], providers: [], errors: [] }
  }

  return {
    enumerate,
    start,
    runToCompletion,
    cancel,
    snapshot,
    reportText,
    dispose,
  }
}
