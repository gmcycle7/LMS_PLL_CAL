/**
 * 「重算數值 vs preset 預期文字」的一致性檢查（純函式）。
 *
 * 規則（接受半寬的定義在 format.ts 的 acceptHalfWidth）：
 * - 文字數字「夠精確」（捨入半寬 ≤ 數值的 1%，約 3 位有效數字以上）時，重算值落在 k 倍捨入半寬內算相符。
 * - §19.2 的 12 個 preset 在 GALLERY_EXPECTED_KEYS 宣告「預期文字必須寫出」的量；這些量若找不到相符的數字就判 mismatch——
 *   也就是規格 §17 末段「模型公式有錯，UI 卻顯示成功」的反面情境會被抓出來。必備數值另外接受「與短數字相等」
 *   （例如 1.8、0.6、−0.25 這種教科書精確值，相對誤差 ≤ 10⁻⁹）。
 * - 其他數值只和夠精確的數字比（避免把「2」這種整數誤認為驗證）；找不到只代表文字沒寫，不代表錯，標為 absent。
 *
 * 另外提供三個「這個檢查到底多可靠」的量（頁面 §2 的數學）：
 * - detectionWindow：重算值乘上 (1 + ε) 後仍然相符的 ε 區間（區間外的模型誤差一定被抓到）
 * - matchCoverage：ε 在 [−r, r] 均勻分布時，錯誤值仍「對得到某個數字」的比例（對到原本的數字／巧合對到別的數字）
 * - perturbMetrics：把所有重算值乘上 (1 + ε)（Inspector 的反面測試用）
 */
import type { PresetEntry } from '@/data/types'
import { GALLERY_EXPECTED_KEYS } from './data'
import { acceptHalfWidth, extractNumbers, findExpectedMatch, type ExtractedNumber } from './format'

/** 與 previews.ts 的 PreviewMetric 相容的最小形狀（避免 import 整個 previews 模組） */
export interface CheckableMetric {
  key: string
  value: number | string
}

export type MetricCheckStatus = 'match' | 'absent' | 'mismatch' | 'skip'

export interface MetricCheck {
  key: string
  status: MetricCheckStatus
  required: boolean
  hit: ExtractedNumber | null
}

export interface ExpectedCheck {
  rows: MetricCheck[]
  /** 宣告為必備、但預覽沒有產生的 key（預覽程式回歸） */
  missingKeys: string[]
  status: 'ok' | 'mismatch' | 'n/a'
  note: string
}

// #region core:checkExpected
export function checkExpected(preset: Pick<PresetEntry, 'id' | 'expected'>, metrics: CheckableMetric[], k = 1.001): ExpectedCheck {
  const nums = extractNumbers(preset.expected) // 文字中的每個數字 t 與它的捨入半寬 h = ½·10^(−小數位數)
  const required = GALLERY_EXPECTED_KEYS[preset.id] ?? []
  const rows: MetricCheck[] = metrics.map((m) => {
    const isReq = required.includes(m.key)
    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) return { key: m.key, status: isReq ? 'mismatch' : 'skip', required: isReq, hit: null }
    if (isReq) {
      const hit = findExpectedMatch(m.value, nums, k, true) // ← 差異：必備數值也接受「與短數字相等」；找不到 ⇒ mismatch
      return { key: m.key, status: hit ? 'match' : 'mismatch', required: true, hit }
    }
    const hit = findExpectedMatch(m.value, nums, k, false) // ← 差異：非必備只和夠精確的數字比；找不到 ⇒ 只是「未列出」
    return { key: m.key, status: hit ? 'match' : 'absent', required: false, hit }
  })
  const missingKeys = required.filter((key) => !metrics.some((m) => m.key === key))
  // #endregion
  const reqRows = rows.filter((r) => r.required)
  const optMatches = rows.filter((r) => !r.required && r.status === 'match').length
  if (required.length === 0) {
    return {
      rows,
      missingKeys,
      status: 'n/a',
      note: `此 preset 沒有宣告必備數值；${optMatches} 個重算值在預期文字中找到夠精確（約 3 位有效數字以上）的相符數字（其餘只是文字沒寫，不代表錯）。`,
    }
  }
  const bad = reqRows.filter((r) => r.status !== 'match').map((r) => r.key)
  const ok = bad.length === 0 && missingKeys.length === 0
  return {
    rows,
    missingKeys,
    status: ok ? 'ok' : 'mismatch',
    note: ok
      ? `${reqRows.length} 個必備數值全部在預期文字中找到相符數字（容差 = 文字的捨入半寬；短數字要求相等）。`
      : `不一致：${[...bad, ...missingKeys.map((k2) => `${k2}（預覽未產生）`)].join('、')} 在預期文字中找不到相符數字。`,
  }
}

/* ───────────────────────── 這個檢查多可靠？ ───────────────────────── */

export interface EpsInterval {
  lo: number
  hi: number
}

// #region core:detectionWindow
/**
 * 重算值 ŷ 對到文字數字 y_t（接受半寬 W = acceptHalfWidth）。若模型有相對誤差 ε（算出 ŷ(1 + ε)），仍然相符的條件是
 *   |ŷ(1 + ε) − y_t| ≤ W  ⇔  (y_t − W − ŷ)/ŷ ≤ ε ≤ (y_t + W − ŷ)/ŷ   （ŷ > 0；ŷ < 0 時兩端對調）
 * 回傳這個 ε 區間；區間外的誤差一定被判為 mismatch。ŷ = 0 時相對誤差沒有意義，回傳整條實數線。
 */
export function detectionWindow(value: number, hit: Pick<ExtractedNumber, 'value' | 'tol'>, k = 1): EpsInterval {
  if (value === 0 || !Number.isFinite(value)) return { lo: -Infinity, hi: Infinity }
  const W = acceptHalfWidth(hit, k, true)
  const a = (hit.value - W - value) / value
  const b = (hit.value + W - value) / value
  return { lo: Math.min(a, b), hi: Math.max(a, b) }
}
// #endregion

/** 區間聯集的總長度（先依左端排序再合併重疊） */
export function unionLength(intervals: EpsInterval[]): number {
  const iv = intervals.filter((i) => i.hi > i.lo).sort((p, q) => p.lo - q.lo)
  let total = 0
  let curLo = NaN
  let curHi = NaN
  for (const i of iv) {
    if (Number.isNaN(curLo)) {
      curLo = i.lo
      curHi = i.hi
    } else if (i.lo <= curHi) {
      curHi = Math.max(curHi, i.hi)
    } else {
      total += curHi - curLo
      curLo = i.lo
      curHi = i.hi
    }
  }
  if (!Number.isNaN(curLo)) total += curHi - curLo
  return total
}

export interface MatchCoverage {
  /** ε ∈ [−r, r] 中仍對到「原本那個數字」的比例（低於文字精度、抓不到的誤差） */
  self: number
  /** 對到「別的數字」的比例（巧合相符：模型錯了但檢查仍顯示相符） */
  other: number
  /** 兩者合計 = 檢查沒有抓到的比例 */
  total: number
}

// #region core:matchCoverage
/**
 * 假設模型誤差 ε 在 [−r, r] 均勻分布：錯誤值 v(1 + ε) 仍然「對得到文字中某個數字」的機率
 *   P = |⋃_i I_i ∩ [−r, r]| / (2r)，  I_i = 第 i 個文字數字換到 ε 軸的接受區間（detectionWindow）。
 * self 是對到原本那個數字的部分，other = P − self 是巧合對到別的數字的部分。
 */
export function matchCoverage(value: number, numbers: Pick<ExtractedNumber, 'value' | 'tol'>[], hit: Pick<ExtractedNumber, 'value' | 'tol'>, r: number, k = 1): MatchCoverage {
  if (!(r > 0) || value === 0 || !Number.isFinite(value)) return { self: NaN, other: NaN, total: NaN }
  const clip = (i: EpsInterval): EpsInterval => ({ lo: Math.max(i.lo, -r), hi: Math.min(i.hi, r) })
  const selfIv = clip(detectionWindow(value, hit, k))
  const all = numbers.map((n) => clip(detectionWindow(value, n, k)))
  const self = Math.max(0, selfIv.hi - selfIv.lo) / (2 * r)
  const total = unionLength([selfIv, ...all]) / (2 * r)
  return { self, other: Math.max(0, total - self), total }
}
// #endregion

/** 把所有有限的數值指標乘上 (1 + ε)；字串與 NaN/∞ 不動。ε = 0 時原樣回傳（同一個陣列）。 */
export function perturbMetrics<M extends CheckableMetric>(metrics: M[], eps: number): M[] {
  if (eps === 0) return metrics
  return metrics.map((m) => (typeof m.value === 'number' && Number.isFinite(m.value) ? { ...m, value: m.value * (1 + eps) } : m))
}

export interface ReliabilityRow {
  key: string
  value: number
  hit: ExtractedNumber
  window: EpsInterval
  coverage: MatchCoverage
}

/**
 * 每個「相符的必備數值」的偵測視窗與巧合相符機率（Inspector 的可靠度表）。
 * numbers 用必備數值比對時的同一組（文字中的所有數字）。
 */
export function reliabilityRows(preset: Pick<PresetEntry, 'id' | 'expected'>, metrics: CheckableMetric[], r: number, k = 1): ReliabilityRow[] {
  const nums = extractNumbers(preset.expected)
  const required = GALLERY_EXPECTED_KEYS[preset.id] ?? []
  const out: ReliabilityRow[] = []
  for (const m of metrics) {
    if (!required.includes(m.key) || typeof m.value !== 'number' || !Number.isFinite(m.value)) continue
    const hit = findExpectedMatch(m.value, nums, k * 1.001)
    if (!hit) continue
    out.push({ key: m.key, value: m.value, hit, window: detectionWindow(m.value, hit, k), coverage: matchCoverage(m.value, nums, hit, r, k) })
  }
  return out
}
