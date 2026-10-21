/**
 * Pure scoring for `dsh-model-rank`.
 *
 * Four independent 0..100 sub-scores are folded into one composite. Every
 * function here is deterministic and side-effect free so the formula can be
 * checked (and changed) without touching the probing code:
 *
 * - availability: did a real request finish normally?
 * - speed:        time to first token, plus streamed output tokens/second.
 * - capability:   deterministic task accuracy, blended with static metadata
 *                 (context window, reasoning support).
 * - quota:        provider-reported remaining balance; free lanes and unknown
 *                 providers get documented neutral values instead of a guess.
 *
 * @module src/scoring.js
 */

/** Default blend of the four dimensions. Config in cordis.patch.yml may override. */
export const DEFAULT_WEIGHTS = {
  availability: 0.4,
  speed: 0.25,
  capability: 0.25,
  quota: 0.1,
}

/** Coerce a weight map into non-negative numbers that sum to 1. */
export function normalizeWeights(input) {
  const merged = { ...DEFAULT_WEIGHTS }
  if (input !== null && typeof input === 'object') {
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      const value = Number(input[key])
      if (Number.isFinite(value) && value >= 0) merged[key] = value
    }
  }
  const total = Object.values(merged).reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) return { ...DEFAULT_WEIGHTS }
  const out = {}
  for (const [key, value] of Object.entries(merged)) out[key] = value / total
  return out
}

/** Clamp to an integer percentage. */
export function clampScore(value, low = 0, high = 100) {
  if (!Number.isFinite(value)) return low
  return Math.min(high, Math.max(low, Math.round(value)))
}

/**
 * Time-to-first-token score: 400 ms is perfect, and each extra 25 ms costs a
 * point, so a 2.9 s first token scores 0.
 */
export function ttftScore(ttftMs) {
  if (!Number.isFinite(ttftMs) || ttftMs <= 0) return 0
  return clampScore(100 - (ttftMs - 400) / 25)
}

/** Streamed throughput score: 3 tok/s is 0 and 50 tok/s is 100. */
export function throughputScore(tokensPerSecond) {
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return 0
  return clampScore(((tokensPerSecond - 3) / 47) * 100)
}

/** Speed folds first-token latency (55%) and streaming rate (45%). */
export function speedScore({ ttftMs, tokensPerSecond }) {
  return clampScore(0.55 * ttftScore(ttftMs) + 0.45 * throughputScore(tokensPerSecond))
}

/**
 * Context-window score on a log2 scale: 32k ≈ 30, 128k ≈ 70, 1M ≈ 100.
 * Unknown metadata stays a neutral 40 rather than pretending to be small.
 */
export function contextScore(contextWindow) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 40
  return clampScore(30 + 20 * Math.log2(contextWindow / 32768), 20, 100)
}

/**
 * Capability blends measured task accuracy with what the route declares about
 * itself. Task accuracy dominates (72%); metadata cannot rescue a model that
 * cannot follow an instruction.
 */
export function capabilityScore({ taskScore, contextWindow, reasoning }) {
  const tasks = clampScore(Number.isFinite(taskScore) ? taskScore : 0)
  const declared = reasoning === undefined ? 55 : reasoning ? 90 : 55
  return clampScore(0.72 * tasks + 0.18 * contextScore(contextWindow) + 0.1 * declared)
}

/** Balance thresholds for a provider-reported wallet, in its own currency. */
const QUOTA_BANDS = [
  { at: 100, score: 100 },
  { at: 50, score: 92 },
  { at: 20, score: 82 },
  { at: 10, score: 70 },
  { at: 5, score: 55 },
  { at: 1, score: 35 },
  { at: 0.01, score: 18 },
]

/**
 * Score the remaining quota of one provider.
 *
 * `balance` is a finite amount in the wallet's currency; `free` marks a lane
 * the provider itself describes as unmetered. Unknown quota is a neutral 55 —
 * high enough not to punish an unmeasurable route, low enough that a lane with
 * confirmed credit outranks it.
 */
export function quotaScoreOf({ kind, balance }) {
  if (kind === 'free') return 100
  if (kind === 'balance' && Number.isFinite(balance)) {
    for (const band of QUOTA_BANDS) if (balance >= band.at) return band.score
    return 0
  }
  return 55
}

/** Composite score for one measured row. An unavailable route scores 0. */
export function compositeScore(row, weights) {
  if (row.status !== 'ok') return 0
  const availability = 100
  const speed = speedScore(row)
  const capability = capabilityScore(row)
  const quota = row.quotaScore ?? row.quota?.score ?? 55
  return clampScore(
    availability * weights.availability
      + speed * weights.speed
      + capability * weights.capability
      + quota * weights.quota,
  )
}

/**
 * Sort best-first: composite desc, then first-token latency, then model id so
 * two runs of the same inventory list rows identically.
 */
export function byRank(a, b) {
  if (b.score !== a.score) return b.score - a.score
  const aTtft = Number.isFinite(a.ttftMs) ? a.ttftMs : Number.MAX_SAFE_INTEGER
  const bTtft = Number.isFinite(b.ttftMs) ? b.ttftMs : Number.MAX_SAFE_INTEGER
  if (aTtft !== bTtft) return aTtft - bTtft
  return String(a.key).localeCompare(String(b.key))
}

/** Attach `rank` to a freshly sorted array. */
export function withRanks(rows) {
  return [...rows].sort(byRank).map((row, index) => ({ ...row, rank: index + 1 }))
}
