/**
 * Offline render smoke test for the Client half.
 *
 * `node --check` only proves the file parses. The failure that broke the
 * settings page (`ReferenceError: SORTABLE is not defined`) happened at *render*
 * time inside `useMemo`, so it passed syntax checking and only appeared in the
 * browser console after a restart.
 *
 * This harness loads `client.js` against a minimal React shim, feeds a canned
 * `/api/model-rank/state`, runs the mount effects, re-renders, and then asserts
 * that the table actually came out — and drives the modality filter through all
 * three values, because a filter branch that never runs is a branch that can
 * still crash the real page.
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
// Node exposes `navigator` as a getter, so redefine instead of assigning.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'zh-CN' },
})
globalThis.window = globalThis
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
// The components poll while mounted; this test renders and exits.
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

/** Canned snapshot: a healthy text route, a flaky image-capable route, a dead one. */
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
      sample: 'OK', rank: 1,
      tasks: [{ id: 'ok', ok: true, answered: true, ttftMs: 200, totalMs: 400, text: 'OK' }],
      quota: { kind: 'free', score: 95, text: '' },
    },
    {
      key: 'alpha\u0000vision', provider: 'alpha', providerName: 'Alpha',
      model: 'vision', name: 'Vision', status: 'ok', score: 70, ttftMs: 320,
      tokensPerSecond: 40, capabilityScore: 55, stabilityScore: 67,
      attempts: 3, answeredCount: 2, chunkCount: 9, rank: 2,
      modalities: ['text', 'image'],
      tasks: [], quota: { kind: 'unknown', score: 55, text: '' },
    },
    {
      key: 'alpha\u0000dead', provider: 'alpha', providerName: 'Alpha',
      model: 'dead', name: 'Dead', status: 'error', score: 0, rank: 3,
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

// ── React shim: per-instance hook state, effect queue, element capture ──────
const ELEMENT = Symbol('element')
const instances = []
let renderIndex = 0
let hookIndex = 0
let current = null
let effects = []
let created = []

const React = {
  createElement: (type, props, ...children) => {
    const element = { [ELEMENT]: true, type, props: props ?? {}, children: children.flat() }
    created.push(element)
    return element
  },
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
 * One render pass for a component: resets the traversal cursor (so the instance
 * keeps its hooks), renders, and returns what the pass produced.
 */
function pass(slot) {
  renderIndex = 0
  effects = []
  created = []
  const markup = render(React.createElement(slot.Component, { sessionId: undefined }))
  return { markup, created, effects }
}

/** Render, flush async effects, and re-render until the component settles. */
async function settle(slot) {
  let last = { markup: '', created: [] }
  for (let round = 0; round < 8; round++) {
    last = pass(slot)
    const pending = last.effects
    for (const { fn } of pending) {
      const result = fn()
      if (result !== null && typeof result?.then === 'function') await result
    }
    await new Promise(resolve => setTimeout(resolve, 0))
    const dirty = instances.some(instance => instance?.dirty === true)
    for (const instance of instances) if (instance) instance.dirty = false
    if (!dirty) break
  }
  return last
}

/** Mount one component from scratch. */
async function mount(slot, label) {
  instances.length = 0
  let last
  try {
    last = await settle(slot)
  } catch (error) {
    console.error(`render failed for ${label}:`, error)
    throw error
  }
  console.log(`rendered ${label}`)
  return last
}

/** The modality selects: the ones offering an `image` option. */
function modalitySelects(createdElements) {
  return createdElements.filter(node => node.type === 'select'
    && typeof node.props?.onChange === 'function'
    && node.children.some(child => child?.props?.value === 'image'))
}

for (const slot of slots) {
  let mounted = await mount(slot, `slot ${slot.meta.id}`)
  // The dock starts collapsed; open it like a user would before reading rows.
  if (slot.meta.id === 'model-rank-dock') {
    const toggle = mounted.created.find(node => node.type === 'button' && node.props?.className === 'mr-dock-toggle')
    assert.ok(toggle, 'the dock exposes its toggle')
    toggle.props.onClick()
    mounted = await settle(slot)
  }
  const elements = mounted.created
  assert.ok(elements.length > 0, `slot ${slot.meta.id} produced a tree`)
  const renderedRows = elements.filter(node => node.type === 'tr' && typeof node.props?.className === 'string' && node.props.className.startsWith('mr-row')).length
  const dockRows = elements.filter(node => node.type === 'div' && node.props?.className === 'mr-dock-row').length
  if (slot.meta.id === 'model-rank') {
    assert.equal(elements.filter(node => node.type === 'table').length, 1, 'the settings page renders its table')
    assert.equal(renderedRows, 3, 'every row in the snapshot is rendered')
  }
  if (slot.meta.id === 'model-rank-dock') {
    assert.ok(dockRows > 0, 'the dock renders its rows once opened')
  }
}

// ── drive the modality filter through every value ────────────────────────────
for (const slot of slots) {
  instances.length = 0
  await settle(slot)
  // The dock's filter lives inside the panel, so it has to be opened first.
  if (slot.meta.id === 'model-rank-dock') {
    const toggle = created.find(node => node.type === 'button' && node.props?.className === 'mr-dock-toggle')
    assert.ok(toggle, 'the dock exposes its toggle')
    toggle.props.onClick()
    await settle(slot)
  }
  const filters = modalitySelects(created)
  assert.ok(filters.length > 0, `slot ${slot.meta.id} exposes a modality filter`)

  for (const select of filters) {
    for (const value of ['image', 'text', 'all']) {
      select.props.onChange({ target: { value } })
      await settle(slot)
      if (slot.meta.id === 'model-rank') {
        const rows = created.filter(node => node.type === 'tr' && typeof node.props?.className === 'string' && node.props.className.startsWith('mr-row'))
        if (value === 'all') assert.equal(rows.length, 3, 'all inputs keeps every row')
        if (value === 'text') assert.equal(rows.length, 2, 'text only keeps the two text routes')
        if (value === 'image') assert.equal(rows.length, 1, 'accepts images keeps only the vision route')
      }
      if (slot.meta.id === 'model-rank-dock') {
        const dockRows = created.filter(node => node.type === 'div' && node.props?.className === 'mr-dock-row')
        if (value === 'image') assert.equal(dockRows.length, 1, 'the dock honours the modality filter')
      }
    }
    console.log(`modality filter ok for slot ${slot.meta.id}`)
  }
}

// ── degraded snapshots ───────────────────────────────────────────────────────
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
