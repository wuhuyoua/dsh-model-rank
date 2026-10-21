/**
 * Request fence for the plugin's own HTTP surface.
 *
 * `webServer` dispatch is longest-prefix-wins, so a plugin prefix under `/api`
 * runs *before* the kernel's own admission check and would otherwise answer any
 * loopback caller. Two layers close that gap:
 *
 * 1. the composition's `connection` service, when mounted — the exact decision
 *    the kernel applies to its `/api` routes;
 * 2. a structural replica for compositions without it: loopback `Host` only, no
 *    cross-site fetch, and an `Origin`/`Referer` whose authority matches `Host`.
 *
 * @module src/fence.js
 */

const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/** Split a Host/Origin/Referer value into `{scheme, hostname, port}`. */
function authorityOf(value, defaultScheme) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `${defaultScheme ?? 'http'}://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port }
}

/** The structural decision: `undefined` when the request may proceed. */
function structuralStatus(req) {
  const host = authorityOf(req.headers?.host, 'http')
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return 403
  if (String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 403
  for (const header of ['origin', 'referer']) {
    const raw = req.headers?.[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const authority = authorityOf(raw.trim())
    if (authority === null) return 403
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) return 403
  }
  return undefined
}

/**
 * Build a per-request admission check.
 *
 * @param {() => object | undefined} getConnection - read the connection service
 *   per request, because the browser half may publish it after plugins loaded.
 * @returns {(req: import('node:http').IncomingMessage) => number | undefined}
 *   an HTTP status to reject with, or `undefined` to let the handler run.
 */
export function createFence(getConnection) {
  return function reject(req) {
    let connection
    try {
      connection = getConnection()
    } catch {
      connection = undefined
    }
    try {
      if (connection !== undefined && connection !== null) {
        if (typeof connection.admit === 'function') {
          const verdict = connection.admit(req)
          const status = verdict !== null && typeof verdict === 'object' ? verdict.rejection : undefined
          return Number.isFinite(status) ? status : undefined
        }
        if (typeof connection.requestRejection === 'function') {
          const status = connection.requestRejection(req)
          return Number.isFinite(status) ? status : undefined
        }
      }
    } catch {
      // A mounted Host service that fails must never widen access.
      return 503
    }
    return structuralStatus(req)
  }
}
