/**
 * Offline render smoke test for the Client half.
 *
 * `node --check` only proves the file parses. The failure that broke the
 * settings page (`ReferenceError: SORTABLE is not defined`) happened at *render*
 * time inside `useMemo`, so it passed syntax checking and only showed up in the
 * browser console after a restart.
 *
 * This harness loads `client.js` against a minimal React shim, feeds a canned
 * `/api/model-rank/state` response, runs the mount effects and re-renders, so a
 * missing identifier, a bad hook order or a broken memo dependency fails here
 * instead of in the user's browser.
 *
 *   node scripts/render-smoke.mjs
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')

// ── minimal DOM / storage the module touches at import time ──────────────────
const store = new Map()
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: key => { store.delete(key) },
}
globalThis.document = {
  documentElement: { lang: 'zh' },
  visibilityState: 'visible',
  baseURI: 'http://127.0.0.1:1/',
}
// Node 24 exposes `navigator` as a getter, so redefine it instead of assigning.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'zh-CN' },
})
globalThis.window = globalThis
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
// The components poll while mounted; the smoke test renders and exits, so the
// timers only need to be inert references.
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

/** Canned snapshot: a healthy route, a flaky route and a dead route. */
const STATE = {
  running: false,
  error: '',
  finishedAt: Date.now(),
  providers: [{ id: 'alpha', name: 'Alpha' }],
  providerErrors: [],
  defaultSelection: { provider: 'alpha', model: 'good' },
  progress: { done: 3, total: 3, current: '' },
  rows: [
    {
      key: 'alpha\u0000good', provider: 'alpha', providerName: 'Alpha',
      model: 'good', name: 'Good', status: 'ok', score: 91, ttftMs: 210,
      tokensPerSecond: 88, capabilityScore: 86, stabilityScore: 100,
      attempts: 3, answeredCount: 3, chunkCount: 12, contextWindow: 131072,
      reasoning: true, modalities: ['text'], outputTokens: 12, totalMs: 900,
      sample: 'OK', tasks: [{ id: 'ok', ok: true, answered: true, ttftMs: 200, totalMs: 400, text: 'OK' }],
      quota: { kind: 'free', score: 95, text: '' },
    },
    {
      key: 'alpha\u0000flaky', provider: 'alpha', providerName: 'Alpha',
      model: 'flaky', name: 'Flaky', status: 'ok', score: 70, ttftMs: 320,
      tokensPerSecond: 40, capabilityScore: 55, stabilityScore: 67,
      attempts: 3, answeredCount: 2, chunkCount: 9, modalities: ['text'],
      tasks: [], quota: { kind: 'unknown', score: 55, text: '' },
    },
    {
      key: 'alpha\u0000dead', provider: 'alpha', providerName: 'Alpha',
      model: 'dead', name: 'Dead', status: 'error', score: 0,
      failure: { kind: 'rate-limit', code: 'RATE_LIMIT', message: 'quota exhausted' },
      capabilityScore: 0, stabilityScore: 0, attempts: 1, answeredCount: 0,
      modalities: ['text'], tasks: [], quota: { kind: 'free', score: 95, text: '' },
    },
  ],
}

/** The Host API, answered from the canned snapshot. */
globalThis.fetch = async url => {
  const body = String(url).includes('/state') ? JSON.stringify(STATE) : '{}'
  return { ok: true, status: 200, text: async () => body }
}

// ── React shim with per-instance hook state and a real effect queue ──────────
const ELEMENT = Symbol('element')
const instances = []
let renderIndex = 0
let hookIndex = 0
let current = null
let effects = []

const React = {
  createElement: (type, props, ...children) => ({ [ELEMENT]: true, type, props: props ?? {}, children: children.flat() }),
  useState: initial => {
    const inst = current
    const index = hookIndex++
    if (!(index in inst.hooks)) inst.hooks[index] = typeof initial === 'function' ? initial() : initial
    const set = next => {
      inst.hooks[index] = typeof next === 'function' ? next(inst.hooks[index]) : next
      inst.dirty = true
    }
    return [inst.hooks[index], set]
  },
  useMemo: factory => { hookIndex++; return factory() },
  useCallback: fn => { hookIndex++; return fn },
  useRef: value => {
    const inst = current
    const index = hookIndex++
    if (!(index in inst.hooks)) inst.hooks[index] = { current: value }
    return inst.hooks[index]
  },
  useEffect: (fn, deps) => {
    const inst = current
    const index = hookIndex++
    const previous = inst.hooks[index]
    const changed = previous === undefined
      || deps === undefined
      || deps.length !== previous.length
      || deps.some((value, i) => !Object.is(value, previous[i]))
    inst.hooks[index] = deps ?? []
    if (changed) effects.push({ inst, fn })
  },
}

/** Render one element tree, running every function component body. */
function render(node) {
  if (node === null || node === undefined || typeof node !== 'object') return ''
  if (node[ELEMENT] !== true) return ''
  const { type, props, children } = node
  if (typeof type === 'function') {
    const slot = renderIndex++
    if (instances[slot] === undefined) instances[slot] = { hooks: [], dirty: false }
    const outer = current
    const outerHook = hookIndex
    current = instances[slot]
    hookIndex = 0
    let produced
    try {
      produced = type(props)
    } finally {
      current = outer
      hookIndex = outerHook
    }
    return render(produced)
  }
  return [props?.children, ...children].map(child => render(child)).join('')
}

// ── load the module through the Cordis client loader contract ────────────────
let plugin
globalThis.__ModuleLoader__ = { load: definition => { plugin = definition } }

await import(pathToFileURL(path.join(ROOT, 'client.js')).href)
assert.ok(plugin, 'client.js registers itself with __ModuleLoader__')

const exported = plugin.factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})
assert.ok(exported?.apply, 'the factory returns an apply()')

const slots = []
exported.apply({
  slots: {
    inject: (_name, register) => register(),
    register: (meta, Component) => { slots.push({ meta, Component }) },
  },
})
assert.equal(slots.length, 2, 'settings section + composer dock are registered')

/**
 * Mount one component: render, flush effects (awaiting async ones), then
 * re-render while its state keeps changing. That is what makes `load()` land a
 * real snapshot and drives the component into the table-rendering path.
 */
async function mount(slot, label) {
  instances.length = 0
  renderIndex = 0
  effects = []
  try {
    for (let pass = 0; pass < 6; pass++) {
      render(React.createElement(slot.Component, { sessionId: undefined }))
      const pending = effects
      effects = []
      for (const { fn } of pending) {
        const result = fn()
        if (result !== null && typeof result?.then === 'function') await result
      }
      await new Promise(resolve => setTimeout(resolve, 0))
      const dirty = instances.some(instance => instance?.dirty === true)
      for (const instance of instances) if (instance) instance.dirty = false
      if (!dirty) break
    }
  } catch (error) {
    console.error(`render failed for ${label}:`, error)
    throw error
  }
  console.log(`rendered ${label}`)
}

for (const slot of slots) await mount(slot, `slot ${slot.meta.id}`)

// Degraded snapshots: a run in flight, then an empty table.
for (const variant of [
  { running: true, rows: [], progress: { done: 0, total: 4, current: 'alpha/good' } },
  { running: false, rows: [], progress: { done: 0, total: 0, current: '' } },
]) {
  const saved = { running: STATE.running, rows: STATE.rows, progress: STATE.progress }
  Object.assign(STATE, variant)
  for (const slot of slots) await mount(slot, `slot ${slot.meta.id} (degraded)`)
  Object.assign(STATE, saved)
}

console.log('render-smoke ok')
process.exit(0)
