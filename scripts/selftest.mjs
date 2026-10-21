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
    return '蓝色 蓝色 蓝色'
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
        // A prepared call is single-use in the real service, so the stub refuses
        // a second dispatch: that is what caught the deep-mode bug.
        let dispatched = false
        return {
          config: { provider, model, maxTokens: 96 },
          stream: options => {
            if (dispatched) throw Object.assign(new Error('a prepared LLM call can only be dispatched once'), { code: 'INVALID_PREPARED_CALL' })
            dispatched = true
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
assert.equal(inventory.rows.length, 3, 'three enumerated models')
assert.equal(inventory.errors.length, 1, 'the provider that cannot enumerate is reported')

const startedAt = now()
const result = await bench.runToCompletion({ mode: 'deep', concurrency: 2 })
assert.equal(result.ok, true)
const state = result.state
assert.equal(state.running, false)
assert.equal(state.rows.length, 3)

const fastest = state.rows[0]
assert.equal(fastest.status, 'ok', 'the top row is a working model')
assert.equal(fastest.model, 'good-fast', 'the fast, fully capable model ranks first')
assert.ok(state.rows[0].score > state.rows[1].score, 'ranking is strictly ordered')
assert.ok(state.rows[0].capabilityScore >= 90, 'a model that answers every task scores high capability')

const failed = state.rows.find(row => row.model === 'good-slow')
assert.equal(failed.status, 'error', 'a 402 is a failed route')
assert.equal(failed.failure.kind, 'quota', 'provider failures are classified')

const terse = state.rows.find(row => row.model === 'terse')
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
