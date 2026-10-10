/**
 * Sign-off review 的狀態模型（每位讀者各自的進度；以 usePersistentState 存在 localStorage，key 'lmspll.signoff.*'）
 * 以及 Markdown／JSON 匯出、JSON 匯入。純函式、不 import React。
 */
import type { SignoffCase } from './data'

export type ReviewStatus = 'not-started' | 'in-progress' | 'pass' | 'fail' | 'waived'

export const REVIEW_STATUSES: readonly ReviewStatus[] = ['not-started', 'in-progress', 'pass', 'fail', 'waived']

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  'not-started': '未開始',
  'in-progress': '進行中',
  pass: '通過',
  fail: '未通過',
  waived: '豁免（需附理由）',
}

/** Markdown 用的狀態符號（純文字，不依賴 emoji 字型）。 */
export const STATUS_MARK: Record<ReviewStatus, string> = {
  'not-started': '[ ]',
  'in-progress': '[~]',
  pass: '[x]',
  fail: '[!]',
  waived: '[w]',
}

export interface CheckReview {
  status: ReviewStatus
  note: string
  /** ISO 時間；最後一次修改 */
  updatedAt?: string
}

export interface ReviewMeta {
  project: string
  reviewer: string
  revision: string
  scope: string
}

export interface ReviewState {
  version: 1
  meta: ReviewMeta
  items: Record<string, CheckReview>
}

export const STORAGE_KEY = 'lmspll.signoff.review.v1'
export const FILTER_KEY = 'lmspll.signoff.filter'
export const JSON_SCHEMA_ID = 'lmspll.signoff/v1'

export function emptyReview(): ReviewState {
  return { version: 1, meta: { project: '', reviewer: '', revision: '', scope: '' }, items: {} }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === 'string' && (REVIEW_STATUSES as readonly string[]).includes(v)
}

function isCheckReview(v: unknown): v is CheckReview {
  return isRecord(v) && isReviewStatus(v.status) && typeof v.note === 'string' && (v.updatedAt === undefined || typeof v.updatedAt === 'string')
}

/** usePersistentState 的型別守衛：拒絕舊版或被竄改的資料（回退成空白 review）。 */
export function isReviewState(v: unknown): v is ReviewState {
  if (!isRecord(v) || v.version !== 1 || !isRecord(v.meta) || !isRecord(v.items)) return false
  const m = v.meta
  if (![m.project, m.reviewer, m.revision, m.scope].every((s) => typeof s === 'string')) return false
  return Object.values(v.items).every(isCheckReview)
}

/** 未記錄項目的預設值（凍結的共用物件：讓 React.memo 的列在未改動時不重繪）。 */
export const NOT_STARTED: Readonly<CheckReview> = Object.freeze({ status: 'not-started', note: '' })

export function getItem(state: ReviewState, id: string): CheckReview {
  return state.items[id] ?? NOT_STARTED
}

export function setItem(state: ReviewState, id: string, patch: Partial<CheckReview>, now: Date = new Date()): ReviewState {
  const prev = getItem(state, id)
  const next: CheckReview = { ...prev, ...patch, updatedAt: now.toISOString() }
  return { ...state, items: { ...state.items, [id]: next } }
}

export function setMeta(state: ReviewState, patch: Partial<ReviewMeta>): ReviewState {
  return { ...state, meta: { ...state.meta, ...patch } }
}

/** fail 與 waived 必須寫理由（追蹤編號、豁免依據）。 */
export function needsNote(item: CheckReview): boolean {
  return (item.status === 'waived' || item.status === 'fail') && item.note.trim() === ''
}

export function isClosed(s: ReviewStatus): boolean {
  return s === 'pass' || s === 'waived'
}

export interface CaseSummary {
  caseId: string
  title: string
  total: number
  counts: Record<ReviewStatus, number>
  closed: number
  missingNotes: string[]
}

export type ReviewVerdict = 'blocked' | 'incomplete' | 'open' | 'ready'

export interface ReviewSummary {
  perCase: CaseSummary[]
  total: number
  counts: Record<ReviewStatus, number>
  closed: number
  missingNotes: string[]
  verdict: ReviewVerdict
  verdictText: string
}

const zeroCounts = (): Record<ReviewStatus, number> => ({ 'not-started': 0, 'in-progress': 0, pass: 0, fail: 0, waived: 0 })

export function summarize(cases: SignoffCase[], state: ReviewState): ReviewSummary {
  const counts = zeroCounts()
  const missingNotes: string[] = []
  const perCase = cases.map((c) => {
    const cc = zeroCounts()
    const miss: string[] = []
    for (const chk of c.checks) {
      const it = getItem(state, chk.id)
      cc[it.status]++
      counts[it.status]++
      if (needsNote(it)) miss.push(chk.id)
    }
    missingNotes.push(...miss)
    return { caseId: c.id, title: c.title, total: c.checks.length, counts: cc, closed: cc.pass + cc.waived, missingNotes: miss }
  })
  const total = perCase.reduce((s, c) => s + c.total, 0)
  const closed = counts.pass + counts.waived
  let verdict: ReviewVerdict
  let verdictText: string
  if (counts.fail > 0) {
    verdict = 'blocked'
    verdictText = `不可 sign-off：${counts.fail} 項未通過（fail）。修正並重新驗證，或以書面理由改為豁免。`
  } else if (missingNotes.length > 0) {
    verdict = 'incomplete'
    verdictText = `${missingNotes.length} 項標為未通過或豁免，但沒有寫理由；豁免必須附依據與追蹤編號。`
  } else if (closed < total) {
    verdict = 'open'
    verdictText = `進行中：${closed}／${total} 項已關閉（通過或豁免），${total - closed} 項尚未完成。`
  } else {
    verdict = 'ready'
    verdictText = `所有 ${total} 項已關閉（通過 ${counts.pass}、豁免 ${counts.waived}）。注意：sign-off 只涵蓋清單列出的條件與模型層級，結論措辭請依「何時可以宣稱穩定」。`
  }
  return { perCase, total, counts, closed, missingNotes, verdict, verdictText }
}

/* ───────────────────────── 匯出 ───────────────────────── */

export interface ExportInfo {
  now: Date
  appVersion: string
  gitCommit: string
}

/**
 * Markdown 表格儲存格：跳脫 `|`，換行改成 `<br>`。
 * 反斜線不跳脫——行內數學 `$\pm\Delta$` 必須原樣保留，Markdown 的 math 擴充才能渲染。
 */
export function mdCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim()
}

function fieldOr(s: string, fallback = '（未填）'): string {
  return s.trim() === '' ? fallback : s.trim()
}

export function buildMarkdown(cases: SignoffCase[], state: ReviewState, info: ExportInfo): string {
  const sum = summarize(cases, state)
  const L: string[] = []
  L.push('# LMS × Fractional-N PLL Calibration — Sign-off Review')
  L.push('')
  L.push(`- 設計／專案：${fieldOr(state.meta.project)}`)
  L.push(`- Reviewer：${fieldOr(state.meta.reviewer)}`)
  L.push(`- Revision：${fieldOr(state.meta.revision)}`)
  L.push(`- 範圍／備註：${fieldOr(state.meta.scope)}`)
  L.push(`- 匯出時間：${info.now.toISOString()}`)
  L.push(`- 工具版本：LMS × PLL Lab ${info.appVersion}（${info.gitCommit}）`)
  L.push('- 規格依據：§16.2 Sign-off Matrix、§16.3、§17 反面測試；勘誤見 docs/validation.md（網站 #/verification）')
  L.push('')
  L.push('## 總覽')
  L.push('')
  L.push(`**判定：${sum.verdictText}**`)
  L.push('')
  L.push('| Case | 項目數 | 未開始 | 進行中 | 通過 | 未通過 | 豁免 | 已關閉 |')
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const c of sum.perCase) {
    const k = c.counts
    L.push(`| ${mdCell(c.title)} | ${c.total} | ${k['not-started']} | ${k['in-progress']} | ${k.pass} | ${k.fail} | ${k.waived} | ${c.closed}/${c.total} |`)
  }
  const k = sum.counts
  L.push(`| **合計** | ${sum.total} | ${k['not-started']} | ${k['in-progress']} | ${k.pass} | ${k.fail} | ${k.waived} | ${sum.closed}/${sum.total} |`)
  L.push('')
  L.push('狀態符號：`[x]` 通過、`[!]` 未通過、`[w]` 豁免、`[~]` 進行中、`[ ]` 未開始。行內數學以 `$…$` 表示（TeX）。')
  for (const c of cases) {
    L.push('')
    L.push(`## ${c.no}. ${c.title}`)
    L.push('')
    L.push(`- 必須驗證：${c.verify}`)
    L.push(`- 判斷方式：${c.judge}`)
    L.push('')
    L.push('| | 檢查項目 | 判斷方式 | 狀態 | 備註 | 更新時間 |')
    L.push('|---|---|---|---|---|---|')
    for (const chk of c.checks) {
      const it = getItem(state, chk.id)
      const warn = needsNote(it) ? '（缺理由）' : ''
      L.push(
        `| ${STATUS_MARK[it.status]} | ${mdCell(chk.title)} | ${mdCell(chk.judge)} | ${STATUS_LABEL[it.status]}${warn} | ${mdCell(it.note) || '—'} | ${it.updatedAt ?? '—'} |`,
      )
    }
  }
  const open = cases.flatMap((c) => c.checks.filter((chk) => !isClosed(getItem(state, chk.id).status)).map((chk) => ({ c, chk })))
  L.push('')
  L.push('## 尚未關閉的項目')
  L.push('')
  if (open.length === 0) L.push('（無）')
  for (const { c, chk } of open) {
    const it = getItem(state, chk.id)
    L.push(`- [${c.title}] ${chk.title} — ${STATUS_LABEL[it.status]}${it.note.trim() ? `：${it.note.trim().replace(/\r?\n/g, ' ')}` : ''}`)
  }
  L.push('')
  L.push('## 宣稱措辭提醒（§16.3）')
  L.push('')
  L.push('- 寫明是哪一種穩定：平均收斂、均方穩定、幾乎必然收斂、局部線性穩定、機率性有界，或「指定 sweep／seeds 未觀察到失效」。')
  L.push('- 不寫「LMS 一定穩定」；不以 PM 或 GMAC 輸出歸零（$E[G]=0$）推論校正正確、無 bias 或無 spur。')
  L.push('')
  return L.join('\n')
}

export interface ReviewJson {
  schema: typeof JSON_SCHEMA_ID
  exported_at: string
  app_version: string
  git_commit: string
  meta: ReviewMeta
  summary: { total: number; closed: number; counts: Record<ReviewStatus, number>; verdict: ReviewVerdict; verdict_text: string }
  cases: {
    id: string
    title: string
    verify: string
    judge: string
    checks: { id: string; title: string; status: ReviewStatus; note: string; updated_at: string | null; judge: string; criterion: string | null; spec: string | null; errata: string[] }[]
  }[]
}

export function buildJson(cases: SignoffCase[], state: ReviewState, info: ExportInfo): ReviewJson {
  const sum = summarize(cases, state)
  return {
    schema: JSON_SCHEMA_ID,
    exported_at: info.now.toISOString(),
    app_version: info.appVersion,
    git_commit: info.gitCommit,
    meta: { ...state.meta },
    summary: { total: sum.total, closed: sum.closed, counts: sum.counts, verdict: sum.verdict, verdict_text: sum.verdictText },
    cases: cases.map((c) => ({
      id: c.id,
      title: c.title,
      verify: c.verify,
      judge: c.judge,
      checks: c.checks.map((chk) => {
        const it = getItem(state, chk.id)
        return {
          id: chk.id,
          title: chk.title,
          status: it.status,
          note: it.note,
          updated_at: it.updatedAt ?? null,
          judge: chk.judge,
          criterion: chk.criterion ?? null,
          spec: chk.spec ?? null,
          errata: chk.errata ?? [],
        }
      }),
    })),
  }
}

export type ImportResult = { ok: true; state: ReviewState; imported: number; ignored: string[] } | { ok: false; error: string }

/**
 * 匯入先前匯出的 JSON（schema lmspll.signoff/v1）。未知的 check id 會被略過並回報；
 * 狀態值不合法時整份拒絕（不做部分套用，避免混合狀態）。
 */
export function parseReviewJson(text: string, cases: SignoffCase[]): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `不是合法的 JSON：${(e as Error).message}` }
  }
  if (!isRecord(raw) || raw.schema !== JSON_SCHEMA_ID) return { ok: false, error: `schema 必須是 "${JSON_SCHEMA_ID}"（請匯入本頁匯出的 JSON）。` }
  if (!Array.isArray(raw.cases)) return { ok: false, error: '缺少 cases 陣列。' }
  const known = new Set(cases.flatMap((c) => c.checks.map((k) => k.id)))
  const state = emptyReview()
  if (isRecord(raw.meta)) {
    for (const key of ['project', 'reviewer', 'revision', 'scope'] as const) {
      const v = raw.meta[key]
      if (typeof v === 'string') state.meta[key] = v
    }
  }
  const ignored: string[] = []
  let imported = 0
  for (const c of raw.cases) {
    if (!isRecord(c) || !Array.isArray(c.checks)) return { ok: false, error: 'cases[] 的格式不正確。' }
    for (const chk of c.checks) {
      if (!isRecord(chk) || typeof chk.id !== 'string') return { ok: false, error: 'checks[] 的格式不正確。' }
      if (!isReviewStatus(chk.status)) return { ok: false, error: `check「${chk.id}」的 status 不合法：${String(chk.status)}` }
      if (!known.has(chk.id)) {
        ignored.push(chk.id)
        continue
      }
      state.items[chk.id] = {
        status: chk.status,
        note: typeof chk.note === 'string' ? chk.note : '',
        ...(typeof chk.updated_at === 'string' ? { updatedAt: chk.updated_at } : {}),
      }
      imported++
    }
  }
  return { ok: true, state, imported, ignored }
}
