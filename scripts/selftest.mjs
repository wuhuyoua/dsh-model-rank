/**
 * Offline self-test for the measurement engine.
 *
 * Runs `createBench` against a stub `llm` service that follows the documented
 * `prepareCall` / `prepared.stream` contract, so the inventory, timing,
 * capability checks, scoring and ranking can be exercised without a network or
 * a signed-in provider. Run with:
 *
 *   node scripts/selftest.mjs
 *
 * @module scripts/selftest.mjs
 */

import assert from 'node:assert/strict'
import { createBench } from '../src/bench.js'

const now = () => Date.now()

/** Yield the chunks of one canned assistant answer, with a small delay. */
async function* chunks(answer, { ttftMs = 30, tokenDelayMs = 2 } = {}) {
  await new Promise(resolve => setTimeout(resolve, ttftMs))
  yield { type: 'block-start', index: 0, blockType: 'text' }
  for (const token of answer.split(' ')) {
    await new Promise(resolve => setTimeout(resolve, tokenDelayMs))
    yield { type: 'text-delta', index: 0, text: `${token} ` }
  }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
  yield { type: 'usage', usage: { inputTokens: 12, outputTokens: answer.split(' ').length } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** A canned model: how it answers each capability prompt. */
const PERSONAS = {
  good: prompt => {
    if (prompt.includes('exactly OK')) return 'OK'
    if (prompt.includes('17 multiplied by 23')) return '391'
    if (prompt.includes('"city"')) return '{"city":"Paris","ok":true}'
    if (prompt.includes('蓝色')) return '蓝色 蓝色 蓝色'
    if (prompt.includes('高铁')) return '约 4.5 小时'
    return 'OK'
  },
  terse: prompt => (prompt.includes('exactly OK') ? 'OK' : 'no'),
}

function createContext({ fail }) {
  const providers = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
    { id: 'broken', name: 'Broken' },
  ]
  const models = {
    alpha: [
      { id: 'good-fast', name: 'Good Fast', inputModalities: ['text'] },
      { id: 'good-slow', name: 'Good Slow', inputModalities: ['text', 'image'] },
    ],
    beta: [{ id: 'terse', name: 'Terse', inputModalities: ['text'] }],
    broken: [{ id: 'unreachable', name: 'Unreachable' }],
  }
  return {
    get: () => undefined,
    llm: {
      listProviders: () => providers,
      listModels: async provider => {
        if (provider === 'broken') throw Object.assign(new Error('catalogue unavailable'), { status: 503 })
        return models[provider] ?? []
      },
      resolveModelInfo: async (_provider, model) => ({
        provider: 'alpha',
        id: model,
        name: model,
        context: { contextWindow: 131072 },
        reasoning: { efforts: [] },
      }),
      prepareCall: async ({ provider, model }) => {
        if (fail === `${provider}/${model}`) {
          throw Object.assign(new Error('insufficient balance'), { status: 402, code: 'INSUFFICIENT_BALANCE' })
        }
        const persona = model.startsWith('good') ? 'good' : 'terse'
        const delay = model.includes('slow') ? { ttftMs: 260, tokenDelayMs: 12 } : { ttftMs: 20, tokenDelayMs: 1 }
        return {
          config: { provider, model, maxTokens: 96 },
          stream: options => {
            const prompt = String(options?.messages?.[0]?.content?.[0]?.text ?? '')
            return chunks(PERSONAS[persona](prompt), delay)
          },
        }
      },
    },
  }
}

const quiet = { info() {}, warn() {}, debug() {} }

const ctx = createContext({ fail: 'alpha/good-slow' })
const bench = createBench({ ctx, logger: quiet, config: {} })

const inventory = await bench.enumerate()
console.log('DEBUG inventory:', JSON.stringify(inventory, null, 2))
assert.ok(inventory.rows.length >= 1, 'at least one enumerated model')
assert.ok(inventory.errors.length >= 0, 'provider errors reported separately')

const startedAt = now()
const result = await bench.runToCompletion({ mode: 'deep', concurrency: 1 })
console.log('DEBUG result:', { ok: result.ok, state: result.state ? 'exists' : 'null' })
assert.equal(result.ok, true)
const state = result.state
console.log('DEBUG state:', state ? { running: state.running, rows: state.rows?.length, error: state.error } : 'null')
assert.equal(state.running, false)
assert.ok(state.rows.length >= 1, 'at least one model result')

console.log('DEBUG rows:', state.rows.map(r => ({ model: r.model, status: r.status, score: r.score, ttft: r.ttftMs, cap: r.capabilityScore, tasks: r.tasks?.map(t => ({ id: t.id, ok: t.ok, answered: t.answered, text: t.text?.slice(0, 40), failure: t.failure })) })))

const fastest = state.rows[0]
assert.equal(fastest.status, 'ok', 'the top row is a working model')
assert.equal(fastest.model, 'good-fast', 'the fast, fully capable model ranks first')
assert.ok(state.rows[0].score > state.rows[1]?.score ?? -1, 'ranking is strictly ordered')
assert.ok(state.rows[0].capabilityScore >= 90, 'a model that answers every task scores high capability')

const failed = state.rows.find(row => row.model === 'good-slow')
assert.ok(failed, 'the failing model is in results')
assert.equal(failed.status, 'error', 'a 402 is a failed route')
assert.equal(failed.failure.kind, 'quota', 'provider failures are classified')

const terse = state.rows.find(row => row.model === 'terse')
assert.ok(terse, 'terse model is in results')
assert.equal(terse.status, 'ok', 'answering badly is still available')
assert.ok(terse.capabilityScore < fastest.capabilityScore, 'but capability separates them')

assert.ok(state.rows.every(row => row.rank >= 1), 'every row carries a rank')
for (let index = 1; index < state.rows.length; index++) {
  assert.ok(state.rows[index - 1].score >= state.rows[index].score, `rank ${index + 1} is not above ${index}`)
}

const markdown = bench.reportText()
assert.match(markdown, /\| # \| 模型 \|/, 'report renders a table header')
assert.match(markdown, /good-fast/, 'report lists measured models')

assert.ok(now() - startedAt < 60_000, 'the stub run finishes quickly')
bench.dispose()

console.log('selftest ok')
console.log(markdown)