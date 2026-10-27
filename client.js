/**
 * `dsh-model-rank` — Client half.
 *
 * One Settings section (`settings.section`, id `model-rank`) that shows the
 * ranked inventory and runs it. All data comes from the Host half's
 * same-origin `/api/model-rank/*` routes; the page itself holds only view state.
 *
 * @module client.js
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-rank',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    // ── locale ──────────────────────────────────────────────────────────────
    const DICT = {
      en: {
        nav: 'Model Rank',
        title: 'Model Rank',
        subtitle: 'Every mounted model, measured and ranked by availability, time-to-first-token, throughput, capability and quota.',
        run: 'Run test',
        stop: 'Stop',
        mode: 'Mode',
        modeQuick: 'Quick · 3 requests/model',
        modeDeep: 'Deep · 8 probes/model',
        concurrency: 'Parallel',
        limit: 'Models',
        limitAll: 'All',
        provider: 'Provider',
        providerAll: 'All providers',
        colRank: '#',
        colModel: 'Model',
        colProvider: 'Provider',
        colScore: 'Score',
        colAvailability: 'Status',
        colStability: 'Stable',
        stabilityTitle: 'How many probes actually came back (repeats + multi-turn + long payload)',
        colTtft: 'TTFT',
        colThroughput: 'Throughput',
        colCapability: 'Capability',
        colQuota: 'Quota',
        statusOk: 'OK',
        statusError: 'Failed',
        statusRunning: 'Running',
        statusPending: 'Pending',
        statusCancelled: 'Cancelled',
        quotaFree: 'Free lane',
        quotaUnknown: 'not reported',
        empty: 'No results yet. Press “Run test” to measure every mounted model.',
        running: 'Testing {done}/{total} · {model}',
        starting: 'Preparing the inventory…',
        finished: 'Last run {time} · {count} models · {mode}',
        cancelled: 'Run cancelled.',
        failed: 'Run failed: {message}',
        detail: 'Details',
        detailError: 'Error',
        detailSample: 'Sample',
        detailTasks: 'Capability tasks',
        detailContext: 'Context',
        detailReasoning: 'Reasoning',
        detailTokens: 'Output tokens',
        detailTotal: 'Total time',
        detailModalities: 'Inputs',
        detailProvider: 'Provider route',
        detailStability: 'Answered probes',
        detailDropped: 'dropped some calls',
        weights: 'Availability {a}% · Stability {s}% · TTFT {t}% · Throughput {p}% · Capability {c}% · Quota {q}%',
        hint: 'Quick mode repeats a tiny request three times, so an intermittent route is caught early; deep mode adds arithmetic, JSON, Chinese, reasoning, multi-turn and long-payload probes.',
        refresh: 'Refresh',
        expand: 'Details',
        collapse: 'Hide',
        recommend: 'Best',
        noProviders: 'No mounted model route was found. Mount a provider first.',
        tableNote: 'Click a column header to re-sort.',
        dockTitle: 'Model Rank',
        dockTest: 'Test',
        dockTesting: 'Testing {done}/{total}',
        dockTop: 'Top 5',
        dockEmpty: 'No run yet — press Test.',
        dockHint: 'Alt+Shift+M toggles this panel.',
        dockClose: 'Hide',
        dockCollapse: 'Collapse',
        dockScore: 'Score',
        dockShowAll: 'Full table in Settings → Model Rank.',
        dockUnavailable: 'unavailable',
        dockUse: 'Use best',
        dockUsing: 'Switching…',
        dockUseTitle: 'Make {model} the current session and default model',
        dockApplied: 'Now using {model}',
        dockCurrent: 'Default: {model}',
        dockApplyFailed: 'Switch failed: {message}',
        useThis: 'Use',
        favorite: 'Favorite',
        unfavorite: 'Unfavorite',
        favorites: 'Favorites',
        noFavorites: 'No favorites yet. Click the star on a row to pin it.',
        recentLabel: 'Recent',
        recentEmpty: 'No recent models.',
        rankBy: 'Rank by',
        rankByScore: 'Composite score',
        rankByCapability: 'Capability',
        rankByTtft: 'First token (TTFT)',
        rankByThroughput: 'Throughput',
        rankByStability: 'Stability',
        rankByQuota: 'Quota',
        modality: 'Input',
        modalityAll: 'Any input',
        modalityText: 'Text only',
        modalityImage: 'Accepts images',
        modalityEmpty: 'No model with that input modality.',
        taskOk: 'Instruction',
        taskStab: 'Stability',
        taskMulti: 'Multi-turn',
        taskLong: 'Long payload',
        taskMath: 'Arithmetic',
        taskJson: 'JSON output',
        taskZh: 'Chinese instruction',
        taskReason: 'Reasoning',
        yes: 'yes',
        no: 'no',
        providerError: 'Provider failed to enumerate',
      },
      zh: {
        nav: '模型优选',
        title: '模型优选',
        subtitle: '对当前挂载的每个模型实测一次，按可用性、剩余额度、能力与速度加权排名。',
        run: '开始测试',
        stop: '停止',
        mode: '模式',
        modeQuick: '快速 · 每模型 3 次请求',
        modeDeep: '深度 · 每模型 8 项探测',
        concurrency: '并发',
        limit: '模型数',
        limitAll: '全部',
        provider: '提供方',
        providerAll: '全部提供方',
        colRank: '#',
        colModel: '模型',
        colProvider: '提供方',
        colScore: '综合',
        colAvailability: '状态',
        colStability: '稳定',
        stabilityTitle: '实际有回复的探测次数（重复调用 + 多轮对话 + 长输入）',
        colTtft: '首字',
        colThroughput: '吞吐',
        colCapability: '能力',
        colQuota: '额度',
        statusOk: '可用',
        statusError: '失败',
        statusRunning: '测试中',
        statusPending: '待测',
        statusCancelled: '已取消',
        quotaFree: '免费通道',
        quotaUnknown: '未报告',
        empty: '还没有测试结果。点击「开始测试」实测当前所有模型。',
        running: '正在测试 {done}/{total} · {model}',
        starting: '正在枚举模型…',
        finished: '上次测试 {time} · {count} 个模型 · {mode}',
        cancelled: '测试已取消。',
        failed: '测试出错：{message}',
        detail: '明细',
        detailError: '错误',
        detailSample: '样本',
        detailTasks: '能力任务',
        detailContext: '上下文',
        detailReasoning: '推理',
        detailTokens: '输出 token',
        detailTotal: '总耗时',
        detailModalities: '输入模态',
        detailProvider: '提供方路由',
        detailStability: '有效探测',
        detailDropped: '有调用掉线',
        weights: '可用性 {a}% · 稳定 {s}% · 首字 {t}% · 吞吐 {p}% · 能力 {c}% · 额度 {q}%',
        hint: '快速模式把同一个极小请求重复 3 次，能提前发现间歇性掉线；深度模式再加算术、JSON、中文、推理、多轮对话与长输入探测。',
        refresh: '刷新',
        expand: '明细',
        collapse: '收起',
        recommend: '首选',
        noProviders: '没有发现任何已挂载的模型路由，请先挂载提供方。',
        tableNote: '点击表头可切换排序。',
        dockTitle: '模型优选',
        dockTest: '测试',
        dockTesting: '测试中 {done}/{total}',
        dockTop: '前五名',
        dockEmpty: '还没测过 · 点「测试」开始',
        dockHint: 'Alt+Shift+M 展开或收起这个面板。',
        dockClose: '收起',
        dockCollapse: '收起',
        dockScore: '得分',
        dockShowAll: '完整表格在「设置 → 模型优选」。',
        dockUnavailable: '不可用',
        dockUse: '一键使用',
        dockUsing: '切换中…',
        dockUseTitle: '把 {model} 设为当前会话与默认模型',
        dockApplied: '已切换到 {model}',
        dockCurrent: '默认：{model}',
        dockApplyFailed: '切换失败：{message}',
        useThis: '用这个',
        favorite: '收藏',
        unfavorite: '取消收藏',
        favorites: '收藏夹',
        noFavorites: '还没有收藏。点击行上的星标固定常用模型。',
        recentLabel: '常用',
        recentEmpty: '暂无常用模型。',
        rankBy: '按...排序',
        rankByScore: '综合分',
        rankByCapability: '能力',
        rankByTtft: '首字 (TTFT)',
        rankByThroughput: '吞吐',
        rankByStability: '稳定性',
        rankByQuota: '额度',
        modality: '输入',
        modalityAll: '不限输入',
        modalityText: '纯文字',
        modalityImage: '支持图片',
        modalityEmpty: '没有符合该输入模态的模型。',
        taskOk: '指令遵循',
        taskStab: '稳定性',
        taskMulti: '多轮对话',
        taskLong: '长输入',
        taskMath: '算术',
        taskJson: 'JSON 输出',
        taskZh: '中文指令',
        taskReason: '推理',
        yes: '是',
        no: '否',
        providerError: '提供方枚举失败',
      },
    }

    function pickLocale() {
      try {
        const tag = String(document?.documentElement?.lang || navigator?.language || 'en').toLowerCase()
        return tag.startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    function translate(locale, key, values) {
      const table = DICT[locale] ?? DICT.en
      let text = table[key] ?? DICT.en[key] ?? key
      if (values !== undefined) {
        for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value))
      }
      return text
    }

    // ── host API ────────────────────────────────────────────────────────────
    function apiBase() {
      try {
        return new URL('api/model-rank', document.baseURI).pathname
      } catch {
        return '/api/model-rank'
      }
    }

    async function call(path, options) {
      const response = await fetch(`${apiBase()}${path}`, {
        ...options,
        redirect: 'error',
        headers: { accept: 'application/json', 'content-type': 'application/json', ...(options?.headers ?? {}) },
      })
      const text = await response.text()
      let payload
      try {
        payload = text === '' ? {} : JSON.parse(text)
      } catch {
        payload = { error: `non-JSON response (${response.status})` }
      }
      if (!response.ok) {
        const error = new Error(payload?.error ?? `request failed (${response.status})`)
        error.payload = payload
        error.status = response.status
        throw error
      }
      return payload
    }

    // ── formatting ──────────────────────────────────────────────────────────
    function formatMs(value) {
      if (!Number.isFinite(value) || value <= 0) return '—'
      if (value < 1000) return `${Math.round(value)} ms`
      return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`
    }

    function formatRate(value) {
      if (!Number.isFinite(value) || value <= 0) return '—'
      return `${value.toFixed(1)} tok/s`
    }

    function formatTokens(value) {
      if (!Number.isFinite(value) || value <= 0) return '—'
      if (value < 1000) return String(Math.round(value))
      return `${(value / 1000).toFixed(1)}k`
    }

    function formatContext(value) {
      if (!Number.isFinite(value) || value <= 0) return '—'
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
      return `${Math.round(value / 1000)}k`
    }

    function modeLabel(locale, mode) {
      return translate(locale, mode === 'deep' ? 'modeDeep' : 'modeQuick')
    }

    function scoreTone(score, row) {
      if (row.status !== 'ok') return 'error'
      if (score >= 70) return 'good'
      if (score >= 45) return 'warn'
      return 'idle'
    }

    function quotaText(locale, row) {
      const quota = row.quota ?? {}
      if (quota.kind === 'free') return translate(locale, 'quotaFree')
      if (quota.kind === 'balance' && typeof quota.text === 'string' && quota.text !== '') return quota.text
      return translate(locale, 'quotaUnknown')
    }

    function taskLabel(locale, id) {
      const key = { ok: 'taskOk', stab: 'taskStab', math: 'taskMath', json: 'taskJson', zh: 'taskZh', reason: 'taskReason', multi: 'taskMulti', long: 'taskLong' }[id]
      return key === undefined ? id : translate(locale, key)
    }

    /**
     * Input-modality filter: `all` | `text` | `image`.
     *
     * The LLM catalogue only reports `inputModalities` — what a route accepts —
     * so this separates "text in" from "text and images in". It says nothing
     * about what the route produces: a route that accepts images still answers
     * with text, and image generation is not something the catalogue exposes.
     */
    function matchesModality(row, filter) {
      if (filter === undefined || filter === 'all') return true
      const modalities = Array.isArray(row?.modalities) ? row.modalities : []
      const acceptsImages = modalities.includes('image')
      return filter === 'image' ? acceptsImages : !acceptsImages
    }

    const SORTABLE = {
      model: 'text',
      providerName: 'text',
      score: 'number',
      ttftMs: 'number',
      tokensPerSecond: 'number',
      capabilityScore: 'number',
      stabilityScore: 'number',
      availability: 'text',
    }

    function sortRows(rows, key, direction) {
      const kind = SORTABLE[key] ?? 'text'
      const sign = direction === 'asc' ? 1 : -1
      const copy = [...rows]
      copy.sort((a, b) => {
        if (key === 'availability') {
          const left = a.status === 'ok' ? 1 : 0
          const right = b.status === 'ok' ? 1 : 0
          if (left !== right) return (right - left) * sign
          return (a.score ?? 0) - (b.score ?? 0) >= 0 ? -1 : 1
        }
        const left = a[key]
        const right = b[key]
        if (kind === 'number') {
          const l = Number.isFinite(left) ? left : -1
          const r = Number.isFinite(right) ? right : -1
          return (l - r) * sign
        }
        const l = String(left ?? '')
        const r = String(right ?? '')
        return l.localeCompare(r) * sign
      })
      return copy
    }

    // ── styles ──────────────────────────────────────────────────────────────
    const CSS = `
.mr-root { display: flex; flex-direction: column; gap: 18px; padding: 4px 0 32px; color: var(--dsw-alias-label-primary); }
.mr-head { display: flex; flex-direction: column; gap: 6px; }
.mr-title { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.mr-sub { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); max-width: 72ch; }
.mr-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.mr-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mr-field-label { font-size: 11px; font-weight: 500; letter-spacing: 0.02em; color: var(--dsw-alias-label-secondary); }
.mr-select { appearance: none; height: 30px; padding: 0 28px 0 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1) no-repeat right 9px center / 10px 6px; color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 14px) 13px, calc(100% - 9px) 13px; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.mr-select:hover { border-color: var(--dsw-alias-border-l2); }
.mr-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mr-btn { height: 30px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.mr-btn:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.mr-btn:disabled { opacity: 0.5; cursor: default; }
.mr-btn-primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.mr-btn-primary:hover { background: var(--dsw-alias-brand-primary); filter: brightness(1.06); }
.mr-btn-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); background: transparent; }
.mr-spacer { flex: 1 1 auto; }
.mr-meter { display: flex; flex-direction: column; gap: 6px; }
.mr-meter-line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); min-height: 18px; }
.mr-meter-line b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.mr-bar { height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.mr-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-brand-primary); transition: width 240ms ease; }
.mr-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: none; }
.mr-dot-good { background: var(--dsw-alias-state-success-primary); }
.mr-dot-error { background: var(--dsw-alias-state-error-primary); }
.mr-dot-warn { background: var(--dsw-alias-state-warn-primary); }
.mr-note { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.mr-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.mr-table-wrap { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.mr-scroll { overflow-x: auto; }
.mr-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 720px; }
.mr-table th { text-align: left; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; color: var(--dsw-alias-label-secondary); padding: 9px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); white-space: nowrap; position: sticky; top: 0; z-index: 1; }
.mr-th-btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.mr-th-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.mr-sort { font-size: 9px; opacity: 0.9; }
.mr-table td { padding: 9px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); vertical-align: middle; }
.mr-table tr:last-child td { border-bottom: none; }
.mr-row { cursor: pointer; }
.mr-row:hover td { background: var(--dsw-alias-bg-layer-2); }
.mr-row-open td { background: var(--dsw-alias-bg-layer-2); }
.mr-rank { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.mr-rank-top { color: var(--dsw-alias-brand-primary); font-weight: 700; }
.mr-model { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mr-model-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.mr-model-id { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.mr-pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.mr-pill-good { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.mr-pill-error { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.mr-score { display: flex; align-items: center; gap: 8px; min-width: 92px; }
.mr-score-num { font-weight: 600; font-variant-numeric: tabular-nums; width: 24px; text-align: right; }
.mr-score-track { flex: 1 1 auto; height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.mr-score-track > span { display: block; height: 100%; border-radius: inherit; }
.mr-tone-good { background: var(--dsw-alias-state-success-primary); }
.mr-tone-warn { background: var(--dsw-alias-state-warn-primary); }
.mr-tone-error { background: var(--dsw-alias-state-error-primary); }
.mr-tone-idle { background: var(--dsw-alias-state-idle-primary); }
.mr-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.mr-drop { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
.mr-muted { color: var(--dsw-alias-label-secondary); }
.mr-detail td { background: var(--dsw-alias-bg-base); padding: 12px 14px; }
.mr-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 18px; }
.mr-detail-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mr-detail-key { font-size: 10.5px; letter-spacing: 0.02em; color: var(--dsw-alias-label-secondary); }
.mr-detail-value { font-size: 12px; overflow-wrap: anywhere; }
.mr-tasks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.mr-task { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); font-size: 11px; }
.mr-task-ok { border-color: var(--dsw-alias-state-success-primary); }
.mr-task-bad { border-color: var(--dsw-alias-state-error-primary); }
.mr-empty { display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; padding: 44px 18px; text-align: center; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.mr-foot { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.mr-reco { font-size: 10px; font-weight: 600; color: var(--dsw-alias-brand-primary); }
.mr-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.mr-dock { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.mr-dock-bar { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mr-dock-toggle { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 6px; border-radius: 6px; }
.mr-dock-toggle:hover { background: var(--dsw-alias-bg-layer-2); }
.mr-dock-toggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mr-dock-mark { color: var(--dsw-alias-brand-primary); font-weight: 700; }
.mr-dock-title { font-weight: 500; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.mr-dock-top { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40ch; }
.mr-dock-progress { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mr-dock-run, .mr-dock-close { height: 24px; padding: 0 10px; font-size: 11.5px; border-radius: 6px; }
.mr-dock-use { height: 24px; padding: 0 12px; font-size: 11.5px; border-radius: 6px; }
.mr-dock-pick { height: 20px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.mr-dock-pick:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.mr-dock-pick:disabled { opacity: 0.4; cursor: default; }
.mr-dock-default { max-width: 24ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-dock-applied { font-size: 11.5px; color: var(--dsw-alias-state-success-primary); }
.mr-dock-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.mr-dock-head { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); letter-spacing: 0.02em; }
.mr-dock-row { display: grid; grid-template-columns: 30px minmax(0, 1fr) 92px 38px 54px; align-items: center; gap: 8px; }
.mr-dock-rank { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.mr-dock-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-dock-prov { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.mr-dock-score { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.mr-scoretext-good { color: var(--dsw-alias-state-success-primary); }
.mr-scoretext-warn { color: var(--dsw-alias-state-warn-primary); }
.mr-scoretext-idle { color: var(--dsw-alias-label-secondary); }
.mr-scoretext-error { color: var(--dsw-alias-state-error-primary); }
.mr-dock-hint { font-size: 10.5px; }
.mr-dock-recent { display: inline-flex; }
.mr-dock-modality { min-width: 0; width: auto; max-width: none; height: 22px; padding: 0 6px; font-size: 11px; }
.mr-dock-recent-select { height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; cursor: pointer; min-width: 160px; max-width: 220px; }
.mr-dock-recent-select:hover { border-color: var(--dsw-alias-brand-primary); }
.mr-dock-recent-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mr-star { cursor: pointer; font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; color: var(--dsw-alias-label-secondary); }
.mr-star:hover { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.mr-star.filled { color: #ffb300; }
.mr-fav-col { width: 28px; text-align: center; }
.mr-fav-btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; font-size: 14px; line-height: 1; }
.mr-fav-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.mr-fav-btn.filled { color: #ffb300; }
.mr-fav-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

    // ── page ────────────────────────────────────────────────────────────────
    function ModelRankPage() {
      const locale = pickLocale()
      const t = useCallback((key, values) => translate(locale, key, values), [locale])

      const [state, setState] = useState(undefined)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [mode, setMode] = useState('quick')
      const [limit, setLimit] = useState(0)
      const [concurrency, setConcurrency] = useState(3)
      const [provider, setProvider] = useState('')
      const [sort, setSort] = useState({ key: 'score', direction: 'desc' })
      const [open, setOpen] = useState(() => new Set())
      const [appliedKey, setAppliedKey] = useState('')
      const [favorites, setFavorites] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem('model-rank-favorites') || '[]')) } catch { return new Set() }
      })
      const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
      const [modalityFilter, setModalityFilter] = useState('all')
      const inFlight = useRef(false)

      // One source of truth for ordering: the toolbar dropdown and the table
      // headers both drive `sort`, so clicking a header cannot disagree with it.
      const RANK_OPTIONS = [
        { key: 'score', label: t('rankByScore') },
        { key: 'capabilityScore', label: t('rankByCapability') },
        { key: 'ttftMs', label: t('rankByTtft') },
        { key: 'tokensPerSecond', label: t('rankByThroughput') },
        { key: 'stabilityScore', label: t('rankByStability') },
      ]

      const persistFavorites = useCallback(() => {
        try { localStorage.setItem('model-rank-favorites', JSON.stringify([...favorites])) } catch {}
      }, [favorites])

      const toggleFavorite = useCallback(key => {
        setFavorites(prev => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          persistFavorites()
          return next
        })
      }, [persistFavorites])

      const load = useCallback(async () => {
        if (inFlight.current) return
        inFlight.current = true
        try {
          const next = await call('/state')
          setState(next)
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          inFlight.current = false
        }
      }, [])

      useEffect(() => {
        let alive = true
        void load()
        return () => {
          alive = false
        }
      }, [load])

      // Poll while a run is going; a slow idle poll keeps two tabs consistent.
      useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'hidden') return
          void load()
        }, state?.running === true ? 1400 : 6000)
        return () => clearInterval(timer)
      }, [load, state?.running])

      const start = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const next = await call('/run', {
            method: 'POST',
            body: JSON.stringify({
              mode,
              limit,
              concurrency,
              ...(provider === '' ? {} : { providers: [provider] }),
            }),
          })
          setState(next)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }, [concurrency, limit, mode, provider])

      const stop = useCallback(async () => {
        setBusy(true)
        try {
          const next = await call('/cancel', { method: 'POST', body: '{}' })
          setState(next?.state ?? state)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }, [state])

      const rows = useMemo(() => {
        const all = Array.isArray(state?.rows) ? state.rows : []
        let filtered = provider === '' ? all : all.filter(row => row.provider === provider)
        if (showFavoritesOnly) {
          filtered = filtered.filter(row => favorites.has(row.key))
        }
        if (modalityFilter !== 'all') {
          filtered = filtered.filter(row => matchesModality(row, modalityFilter))
        }
        // Availability is the hard gate: an unavailable route never outranks a
        // working one, whatever dimension the user picked. Inside each group the
        // selected dimension decides the order.
        const available = filtered.filter(row => row.status === 'ok')
        const unavailable = filtered.filter(row => row.status !== 'ok')
        return [
          ...sortRows(available, sort.key, sort.direction),
          ...sortRows(unavailable, sort.key, sort.direction),
        ]
      }, [provider, sort, showFavoritesOnly, modalityFilter, state?.rows, favorites])

      const providers = useMemo(() => {
        const list = Array.isArray(state?.providers) ? state.providers : []
        const seen = new Map()
        for (const row of Array.isArray(state?.rows) ? state.rows : []) {
          if (!seen.has(row.provider)) seen.set(row.provider, row.providerName ?? row.provider)
        }
        for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item.name ?? item.id)
        return [...seen.entries()].map(([id, name]) => ({ id, name }))
      }, [state?.providers, state?.rows])

      const running = state?.running === true
      const progress = state?.progress ?? { done: 0, total: 0, current: '' }
      const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
      const weights = state?.weights ?? { availability: 0.45, ttft: 0.20, throughput: 0.10, capability: 0.15, quota: 0.10 }

      const toggleRow = useCallback(key => {
        setOpen(current => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }, [])

      const onSort = useCallback(key => {
        setSort(current => {
          if (current.key !== key) return { key, direction: key === 'ttftMs' ? 'asc' : 'desc' }
          return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        })
      }, [])

      // The settings page has no Session, so this writes the default selection:
      // new conversations open on the chosen route.
      const applyRow = useCallback(async row => {
        if (row === undefined) return
        try {
          const result = await call('/apply', {
            method: 'POST',
            body: JSON.stringify({ provider: row.provider, model: row.model }),
          })
          if (result?.state !== undefined) setState(result.state)
          setAppliedKey(row.key)
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [])

      const modeName = modeLabel(locale, state?.mode ?? mode)
      const statusLine = (() => {
        if (running) {
          return progress.total === 0
            ? t('starting')
            : t('running', { done: progress.done, total: progress.total, model: progress.current || '—' })
        }
        if (error !== '') return ''
        if (state === undefined) return ''
        if (state.error === 'cancelled') return t('cancelled')
        if (state.error !== '' && state.error !== undefined) return t('failed', { message: state.error })
        if ((state.finishedAt ?? 0) > 0) {
          return t('finished', {
            time: new Date(state.finishedAt).toLocaleString(),
            count: (state.rows ?? []).length,
            mode: modeName,
          })
        }
        return ''
      })()

      const header = (key, label, extra) => h('th', { key, style: extra },
        SORTABLE[key] === undefined
          ? label
          : h('button', {
            type: 'button',
            className: 'mr-th-btn',
            onClick: () => onSort(key),
            'aria-label': label,
          }, label, h('span', { className: 'mr-sort' }, sort.key === key ? (sort.direction === 'asc' ? '▲' : '▼') : '')))

      return h('section', { className: 'mr-root', 'aria-label': t('title') },
        h('style', { key: 'styles' }, CSS),
        h('header', { className: 'mr-head' },
          h('h2', { className: 'mr-title' }, t('title')),
          h('p', { className: 'mr-sub' }, t('subtitle'))),

        h('div', { className: 'mr-toolbar' },
          h('label', { className: 'mr-field' },
            h('span', { className: 'mr-field-label' }, t('mode')),
            h('select', {
              className: 'mr-select',
              value: mode,
              disabled: running,
              onChange: event => setMode(event.target.value),
            },
            h('option', { value: 'quick' }, t('modeQuick')),
            h('option', { value: 'deep' }, t('modeDeep')))),
          h('label', { className: 'mr-field' },
            h('span', { className: 'mr-field-label' }, t('limit')),
            h('select', {
              className: 'mr-select',
              value: String(limit),
              disabled: running,
              onChange: event => setLimit(Number(event.target.value)),
            },
            [0, 5, 10, 20, 40].map(value => h('option', { key: value, value: String(value) },
              value === 0 ? t('limitAll') : String(value))))),
          h('label', { className: 'mr-field' },
            h('span', { className: 'mr-field-label' }, t('concurrency')),
            h('select', {
              className: 'mr-select',
              value: String(concurrency),
              disabled: running,
              onChange: event => setConcurrency(Number(event.target.value)),
            },
            [1, 2, 3, 4, 6].map(value => h('option', { key: value, value: String(value) }, String(value))))),
          h('label', { className: 'mr-field' },
            h('span', { className: 'mr-field-label' }, t('provider')),
            h('select', {
              className: 'mr-select',
              value: provider,
              disabled: running,
              onChange: event => setProvider(event.target.value),
            },
            h('option', { value: '' }, t('providerAll')),
            providers.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
          h('label', { className: 'mr-field' },
            h('span', { className: 'mr-field-label' }, t('favorites')),
            h('input', {
              type: 'checkbox',
              checked: showFavoritesOnly,
              disabled: running,
              onChange: event => setShowFavoritesOnly(event.target.checked),
            })),
          h('label', { className: 'mr-field' },
            h('span', { className: 'mr-field-label' }, t('rankBy')),
            h('select', {
              className: 'mr-select',
              value: sort.key,
              disabled: running,
              // Latency is the one dimension where smaller is better.
              onChange: event => {
                const key = event.target.value
                setSort({ key, direction: key === 'ttftMs' ? 'asc' : 'desc' })
              },
            },
              RANK_OPTIONS.map(opt => h('option', { key: opt.key, value: opt.key }, opt.label)))),
          h('label', { className: 'mr-field' },
            h('span', { className: 'mr-field-label' }, t('modality')),
            h('select', {
              className: 'mr-select',
              value: modalityFilter,
              disabled: running,
              onChange: event => setModalityFilter(event.target.value),
            },
              h('option', { value: 'all' }, t('modalityAll')),
              h('option', { value: 'text' }, t('modalityText')),
              h('option', { value: 'image' }, t('modalityImage')))),
          h('div', { className: 'mr-spacer' }),
          h('button', {
            type: 'button',
            className: 'mr-btn mr-btn-primary',
            disabled: running || busy,
            onClick: () => void start(),
          }, running ? '…' : t('run')),
          running
            ? h('button', { type: 'button', className: 'mr-btn mr-btn-danger', disabled: busy, onClick: () => void stop() }, t('stop'))
            : h('button', { type: 'button', className: 'mr-btn', disabled: busy, onClick: () => void load() }, t('refresh'))),

        (running || statusLine !== '' || error !== '')
          ? h('div', { className: 'mr-meter' },
            running
              ? h('div', { className: 'mr-bar' }, h('span', { style: { width: `${percent}%` } }))
              : null,
            h('div', { className: 'mr-meter-line' },
              h('span', { className: `mr-dot ${running ? 'mr-dot-warn' : error !== '' || state?.error === 'cancelled' ? 'mr-dot-error' : 'mr-dot-good'}` }),
              h('span', {}, statusLine),
              running ? h('b', {}, `${percent}%`) : null),
            error !== ''
              ? h('div', { className: 'mr-error' }, error)
              : null)
          : null,

        h('div', { className: 'mr-table-wrap' },
          rows.length === 0
            ? h('div', { className: 'mr-empty' },
              h('div', {}, state === undefined
                ? '…'
                : providers.length === 0
                  ? t('noProviders')
                  : (Array.isArray(state?.rows) && state.rows.length > 0 && modalityFilter !== 'all')
                    ? t('modalityEmpty')
                    : t('empty')),
              h('div', { className: 'mr-note' }, t('hint')))
            : h('div', { className: 'mr-scroll' },
              h('table', { className: 'mr-table' },
                h('thead', {},
                  h('tr', {},
                    header('rank', t('colRank'), { width: 44 }),
                    header('model', t('colModel')),
                    header('providerName', t('colProvider')),
                    header('score', t('colScore')),
                    header('availability', t('colAvailability')),
                    header('stabilityScore', t('colStability')),
                    header('ttftMs', t('colTtft')),
                    header('tokensPerSecond', t('colThroughput')),
                    header('capabilityScore', t('colCapability')),
                    h('th', { key: 'favorite', className: 'mr-fav-col' }, t('favorite')),
                    h('th', { key: 'quota' }, t('colQuota')))),
                h('tbody', {},
                  rows.map(row => {
                    const isOpen = open.has(row.key)
                    const tone = scoreTone(row.score ?? 0, row)
                    const cells = [
                      h('td', { key: 'rank', className: 'mr-rank' },
                        row.rank === 1
                          ? h('span', { className: 'mr-rank-top' }, h('span', {}, '#1'), ' ',
                            h('span', { className: 'mr-reco' }, t('recommend')))
                          : `#${row.rank}`),
                      h('td', { key: 'model' },
                        h('div', { className: 'mr-model' },
                          h('span', { className: 'mr-model-name', title: row.name }, row.name ?? row.model),
                          row.name !== row.model
                            ? h('span', { className: 'mr-model-id mr-mono', title: row.model }, row.model)
                            : null)),
                      h('td', { key: 'provider' },
                        h('span', { className: 'mr-pill', title: row.provider }, row.providerName ?? row.provider)),
                      h('td', { key: 'score' },
                        h('div', { className: 'mr-score' },
                          h('span', { className: 'mr-score-num' }, row.score ?? 0),
                          h('span', { className: 'mr-score-track' },
                            h('span', { className: `mr-tone-${tone}`, style: { width: `${Math.max(0, Math.min(100, row.score ?? 0))}%` } })))),
                      h('td', { key: 'status' },
                        h('span', {
                          className: `mr-pill ${row.status === 'ok' ? 'mr-pill-good' : row.status === 'error' ? 'mr-pill-error' : ''}`,
                          title: row.failure?.message ?? '',
                        },
                        h('span', { className: `mr-dot ${row.status === 'ok' ? 'mr-dot-good' : row.status === 'error' ? 'mr-dot-error' : 'mr-dot-warn'}` }),
                        row.status === 'ok'
                          ? t('statusOk')
                          : row.status === 'error'
                            ? `${t('statusError')}${row.failure?.kind ? ` · ${row.failure.kind}` : ''}`
                            : running ? t('statusRunning') : t('statusPending'))),
                      h('td', { key: 'stability', className: 'mr-num', title: t('stabilityTitle') },
                        Number.isFinite(row.attempts) && row.attempts > 0
                          ? h('span', { className: row.answeredCount < row.attempts ? 'mr-drop' : '' },
                            `${row.answeredCount ?? 0}/${row.attempts}`)
                          : '—'),
                      h('td', { key: 'ttft', className: 'mr-num' }, formatMs(row.ttftMs)),
                      h('td', { key: 'tps', className: 'mr-num' }, formatRate(row.tokensPerSecond)),
                      h('td', { key: 'cap', className: 'mr-num' }, row.capabilityScore ?? '—'),
                      h('td', { key: 'favorite', className: 'mr-fav-col' },
                        h('button', {
                          type: 'button',
                          className: 'mr-fav-btn' + (favorites.has(row.key) ? ' filled' : ''),
                          title: favorites.has(row.key) ? t('unfavorite') : t('favorite'),
                          onClick: event => {
                            event.stopPropagation()
                            toggleFavorite(row.key)
                          },
                        }, h('span', {}, favorites.has(row.key) ? '★' : '☆'))),
                      h('td', { key: 'quota', className: 'mr-muted' }, quotaText(locale, row)),
                    ]
                    const main = h('tr', {
                      key: row.key,
                      className: `mr-row${isOpen ? ' mr-row-open' : ''}`,
                      onClick: () => toggleRow(row.key),
                      title: isOpen ? t('collapse') : t('expand'),
                    }, cells)
                    if (!isOpen) return main
                    const detail = h('tr', { key: `${row.key}:detail`, className: 'mr-detail' },
                      h('td', { colSpan: 10 },
                        h('div', { className: 'mr-detail-grid' },
                          row.failure !== undefined
                            ? detailItem(t('detailError'), `${row.failure.kind} · ${row.failure.code ?? ''} ${row.failure.message ?? ''}`)
                            : null,
                          detailItem(t('detailProvider'), row.provider),
                          detailItem(t('detailStability'), Number.isFinite(row.attempts) && row.attempts > 0
                            ? `${row.answeredCount ?? 0}/${row.attempts}${row.answeredCount < row.attempts ? ` · ${t('detailDropped')}` : ''}`
                            : '—'),
                          detailItem(t('detailContext'), formatContext(row.contextWindow)),
                          detailItem(t('detailReasoning'), row.reasoning === undefined ? '—' : (row.reasoning ? t('yes') : t('no'))),
                          detailItem(t('detailModalities'), (row.modalities ?? []).join(', ') || '—'),
                          detailItem(t('detailTokens'), formatTokens(row.outputTokens)),
                          detailItem(t('detailTotal'), formatMs(row.totalMs)),
                          detailItem(t('detailSample'), h('span', { className: 'mr-mono' }, row.sample === '' ? '—' : row.sample)),
                          detailItem(t('useThis'), h('button', {
                            type: 'button',
                            className: 'mr-btn',
                            disabled: row.status !== 'ok',
                            title: t('dockUseTitle', { model: row.name ?? row.model }),
                            onClick: event => {
                              event.stopPropagation()
                              void applyRow(row)
                            },
                          }, appliedKey === row.key ? t('dockApplied', { model: row.model }) : t('useThis'))),
                          detailItem(t('favorite'), h('button', {
                            type: 'button',
                            className: 'mr-btn',
                            title: favorites.has(row.key) ? t('unfavorite') : t('favorite'),
                            onClick: event => {
                              event.stopPropagation()
                              toggleFavorite(row.key)
                            },
                          }, favorites.has(row.key) ? t('unfavorite') : t('favorite')))),
                        (row.tasks ?? []).length > 0
                          ? h('div', { className: 'mr-tasks' },
                            row.tasks.map(task => h('span', {
                              key: task.id,
                              className: `mr-task ${task.ok ? 'mr-task-ok' : 'mr-task-bad'}`,
                              title: task.text === '' ? (task.failure?.message ?? '') : task.text,
                            },
                            h('span', { className: `mr-dot ${task.ok ? 'mr-dot-good' : 'mr-dot-error'}` }),
                            taskLabel(locale, task.id),
                            h('span', { className: 'mr-muted' }, formatMs(task.ttftMs)))))
                          : null))
                    return [main, detail]
                  }))))),

        h('div', { className: 'mr-foot' },
          h('span', {}, t('weights', {
            a: Math.round((weights.availability ?? 0) * 100),
            s: Math.round((weights.stability ?? 0) * 100),
            t: Math.round((weights.ttft ?? 0) * 100),
            p: Math.round((weights.throughput ?? 0) * 100),
            c: Math.round((weights.capability ?? 0) * 100),
            q: Math.round((weights.quota ?? 0) * 100),
          })),
          h('span', {}, '·'),
          h('span', {}, t('tableNote')),
          h('span', {}, '·'),
          h('span', {}, state?.defaultSelection === undefined
            ? t('dockShowAll')
            : t('dockCurrent', { model: `${state.defaultSelection.provider}/${state.defaultSelection.model}` })),
          h('span', {}, '·'),
          h('span', {}, t('hint'))),

        (state?.providerErrors ?? []).length > 0
          ? h('div', { className: 'mr-foot' },
            h('span', {}, t('providerError') + '：'),
            (state.providerErrors ?? []).map(item => h('span', { key: item.provider }, `${item.providerName} (${item.kind})`)))
          : null)
    }

    function detailItem(label, value) {
      return h('div', { className: 'mr-detail-item', key: label },
        h('span', { className: 'mr-detail-key' }, label),
        h('span', { className: 'mr-detail-value' }, value))
    }

    // ── home-page shortcut ──────────────────────────────────────────────────
    /**
     * Ambient entry under the composer: one row that names the current best
     * model, runs a quick test on demand, and expands into the top five.
     * `Alt+Shift+M` toggles it, so the page needs no trip to Settings.
     */
    function ModelRankDock(props) {
      const locale = pickLocale()
      const t = useCallback((key, values) => translate(locale, key, values), [locale])
      const [open, setOpen] = useState(false)
      const [state, setState] = useState(undefined)
      const [busy, setBusy] = useState(false)
      const [applying, setApplying] = useState(false)
      const [applied, setApplied] = useState('')
      const [error, setError] = useState('')
      const [recentModels, setRecentModels] = useState(() => {
        try {
          const recent = JSON.parse(localStorage.getItem('model-rank-recent') || '[]')
          const favs = JSON.parse(localStorage.getItem('model-rank-favorites') || '[]')
          // 合并收藏 + 最近使用，去重，收藏优先（统一用 \u0000 分隔符）
          const merged = [...favs, ...recent].filter((v, i, a) => a.indexOf(v) === i)
          return merged.slice(0, 10)
        } catch { return [] }
      })
      const [modalityFilter, setModalityFilter] = useState('all')
      const inFlight = useRef(false)

      const load = useCallback(async () => {
        if (inFlight.current) return
        inFlight.current = true
        try {
          const next = await call('/state')
          setState(next)
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          inFlight.current = false
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      // Poll only while the panel is open or a run is in flight.
      useEffect(() => {
        if (!open && state?.running !== true) return
        const timer = setInterval(() => { void load() }, state?.running === true ? 1500 : 5000)
        return () => clearInterval(timer)
      }, [load, open, state?.running])

      // The shortcut itself: Alt+Shift+M toggles the panel from anywhere on the page.
      useEffect(() => {
        const onKey = event => {
          if (!event.altKey || !event.shiftKey) return
          if (String(event.key ?? '').toLowerCase() !== 'm') return
          event.preventDefault()
          setOpen(current => !current)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const run = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const next = await call('/run', { method: 'POST', body: JSON.stringify({ mode: 'quick' }) })
          setState(next)
          setOpen(true)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }, [])

      // One click installs a ranked model exactly like the composer's picker:
      // the Session switches, and the default for new Sessions follows.
      const use = useCallback(async row => {
        if (row === undefined) return
        setApplying(true)
        setError('')
        setApplied('')
        try {
          const result = await call('/apply', {
            method: 'POST',
            body: JSON.stringify({
              provider: row.provider,
              model: row.model,
              ...(typeof props?.sessionId === 'string' && props.sessionId !== '' ? { sessionId: props.sessionId } : {}),
            }),
          })
          if (result?.state !== undefined) setState(result.state)
          const selected = result?.selected ?? { provider: row.provider, model: row.model }
          const key = `${selected.provider}\u0000${selected.model}`
          setApplied(`${selected.provider}/${selected.model}`)
          // Save to recent models, but keep favorites in the merged list
          setRecentModels(prev => {
            const recent = [key, ...prev.filter(r => r !== key)].slice(0, 5)
            try { localStorage.setItem('model-rank-recent', JSON.stringify(recent)) } catch {}
            // Merge with favorites (favorites first, then recent, dedup)
            const favs = JSON.parse(localStorage.getItem('model-rank-favorites') || '[]')
            const merged = [...favs, ...recent].filter((v, i, a) => a.indexOf(v) === i)
            return merged.slice(0, 10)
          })
        } catch (cause) {
          setError(t('dockApplyFailed', { message: String(cause?.message ?? cause) }))
        } finally {
          setApplying(false)
        }
      }, [props?.sessionId, t])

      const running = state?.running === true
      const progress = state?.progress ?? { done: 0, total: 0 }
      // The filter applies before the top-five cut, so picking "text only"
      // shows the five best text routes instead of hiding image ones.
      const allRows = Array.isArray(state?.rows) ? state.rows : []
      const rows = (modalityFilter === 'all'
        ? allRows
        : allRows.filter(row => matchesModality(row, modalityFilter))).slice(0, 5)
      const best = rows[0]
      const tone = best === undefined ? 'idle' : scoreTone(best.score ?? 0, best)
      const currentDefault = state?.defaultSelection
      const canUse = best !== undefined && best.status === 'ok' && !running

      return h('div', { className: 'mr-dock' },
        h('style', { key: 'styles' }, CSS),
        h('div', { className: 'mr-dock-bar' },
          h('button', {
            type: 'button',
            className: 'mr-dock-toggle',
            'aria-expanded': open ? 'true' : 'false',
            title: t('dockHint'),
            onClick: () => setOpen(current => !current),
          },
          h('span', { className: 'mr-dock-mark' }, '◎'),
          h('span', { className: 'mr-dock-title' }, t('dockTitle')),
          best === undefined
            ? h('span', { className: 'mr-dock-top' }, t('dockEmpty'))
            : h('span', { className: `mr-dock-top mr-scoretext-${tone}` },
              `#${best.rank} ${best.name ?? best.model} · ${best.score ?? 0}`)),
          running
            ? h('span', { className: 'mr-dock-progress' }, t('dockTesting', { done: progress.done, total: progress.total }))
            : null,
          h('button', {
            type: 'button',
            className: 'mr-btn mr-dock-run',
            disabled: running || busy || applying,
            onClick: () => void run(),
          }, running ? '…' : t('dockTest')),
          h('button', {
            type: 'button',
            className: 'mr-btn mr-btn-primary mr-dock-use',
            disabled: !canUse || applying,
            title: best === undefined ? t('dockEmpty') : t('dockUseTitle', { model: best.name ?? best.model }),
            onClick: () => void use(best),
          }, applying ? t('dockUsing') : t('dockUse')),
          recentModels.length > 0
            ? h('div', { className: 'mr-dock-recent' },
                h('select', {
                  className: 'mr-dock-recent-select',
                  defaultValue: '',
                  onChange: event => {
                    const idx = Number(event.target.value)
                    if (!isNaN(idx) && idx >= 0 && idx < recentModels.length) {
                      const key = recentModels[idx]
                      const [provider, model] = key.split('\u0000')
                      const row = state?.rows?.find(r => r.provider === provider && r.model === model)
                      if (row) void use(row)
                      else {
                        // Not in current results, try to apply directly
                        setApplying(true)
                        setError('')
                        void call('/apply', {
                          method: 'POST',
                          body: JSON.stringify({ provider, model }),
                        }).then(result => {
                          if (result?.state !== undefined) setState(result.state)
                          const selected = result?.selected ?? { provider, model }
                          setApplied(`${selected.provider}/${selected.model}`)
                        }).catch(cause => {
                          setError(t('dockApplyFailed', { message: String(cause?.message ?? cause) }))
                        }).finally(() => setApplying(false))
                      }
                    }
                    event.target.value = ''
                  },
                  title: t('recentLabel'),
                  onFocus: () => {
                    // Re-read from localStorage to pick up favorites changes
                    try {
                      const recent = JSON.parse(localStorage.getItem('model-rank-recent') || '[]')
                      const favs = JSON.parse(localStorage.getItem('model-rank-favorites') || '[]')
                      const merged = [...favs, ...recent].filter((v, i, a) => a.indexOf(v) === i).slice(0, 10)
                      setRecentModels(merged)
                    } catch {}
                  },
                },
                  h('option', { value: '', disabled: true, selected: true }, t('recentLabel')),
                  recentModels.map((key, idx) => {
                    const [provider, model] = key.split('\u0000')
                    const row = state?.rows?.find(r => r.provider === provider && r.model === model)
                    const favs = JSON.parse(localStorage.getItem('model-rank-favorites') || '[]')
                    const isFav = favs.includes(key)
                    return h('option', { key, value: String(idx) }, `${isFav ? '★ ' : ''}${row?.name ?? model} (${provider})`)
                  }))
              )
            : null,
          open
            ? h('button', { type: 'button', className: 'mr-btn mr-dock-close', onClick: () => setOpen(false) }, t('dockCollapse'))
            : null),

        open
          ? h('div', { className: 'mr-dock-panel' },
            h('div', { className: 'mr-dock-head' },
              h('span', {}, t('dockTop')),
              h('select', {
                className: 'mr-dock-recent-select mr-dock-modality',
                value: modalityFilter,
                title: t('modality'),
                'aria-label': t('modality'),
                onChange: event => setModalityFilter(event.target.value),
              },
                h('option', { value: 'all' }, t('modalityAll')),
                h('option', { value: 'text' }, t('modalityText')),
                h('option', { value: 'image' }, t('modalityImage'))),
              h('span', { className: 'mr-dock-default' },
                currentDefault === undefined
                  ? t('dockShowAll')
                  : t('dockCurrent', { model: `${currentDefault.provider}/${currentDefault.model}` }))),
            rows.length === 0
              ? h('div', { className: 'mr-note' },
                error === ''
                  ? (modalityFilter !== 'all' && allRows.length > 0 ? t('modalityEmpty') : t('dockEmpty'))
                  : error)
              : rows.map(row => h('div', { key: row.key, className: 'mr-dock-row' },
                h('span', { className: 'mr-dock-rank' }, `#${row.rank}`),
                h('span', { className: 'mr-dock-name', title: row.model }, row.name ?? row.model),
                h('span', { className: 'mr-dock-prov', title: row.provider }, row.providerName ?? row.provider),
                h('span', { className: `mr-dock-score mr-scoretext-${scoreTone(row.score ?? 0, row)}` }, String(row.score ?? 0)),
                h('button', {
                  type: 'button',
                  className: 'mr-dock-pick',
                  disabled: applying || row.status !== 'ok',
                  title: t('useThis'),
                  onClick: event => {
                    event.stopPropagation()
                    void use(row)
                  },
                }, t('useThis')))),
            applied !== ''
              ? h('div', { className: 'mr-dock-applied' }, t('dockApplied', { model: applied }))
              : null,
            rows.length > 0 && error !== '' ? h('div', { className: 'mr-error' }, error) : null,
            h('div', { className: 'mr-dock-hint mr-muted' }, t('dockHint')))
          : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'model-rank',
          order: 36,
          label: () => translate(pickLocale(), 'nav'),
          locale: 'model-rank',
        }, ModelRankPage))

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'model-rank-dock',
          order: 2,
          label: () => translate(pickLocale(), 'nav'),
        }, ModelRankDock))
      },
    }
  },
})
