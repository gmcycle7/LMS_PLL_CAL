import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import type { ThemeTokens } from './theme'
import type { CsvColumns } from './types'

/**
 * Plot 元件的純函式部分（可在 node 環境測試）：log 軸過濾、主題 layout、線型循環、CSV 欄位。
 */

type Obj = Record<string, unknown>

function isPlainObject(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && Object.getPrototypeOf(v) === Object.prototype
}

/** 一維數列（Array 或 typed array，元素不是陣列） */
function isArray1D(v: unknown): v is ArrayLike<unknown> {
  if (ArrayBuffer.isView(v)) return !(v instanceof DataView)
  return Array.isArray(v) && !v.some((e) => Array.isArray(e) || ArrayBuffer.isView(e))
}

function filterArray<T>(arr: ArrayLike<T>, keep: boolean[]): ArrayLike<T> {
  if (ArrayBuffer.isView(arr)) return (arr as unknown as Float64Array).filter((_, i) => keep[i]) as unknown as ArrayLike<T>
  return Array.prototype.filter.call(arr, (_: T, i: number) => keep[i]) as T[]
}

/** 會被 log 軸丟棄的點：數值 ≤ 0（含 -0）；null / NaN 視為斷點保留給 Plotly 處理 */
function isNonPositive(v: unknown): boolean {
  if (typeof v === 'number') return v <= 0
  if (typeof v === 'string' && v.trim() !== '') return Number(v) <= 0
  return false
}

const FILTERABLE_TYPES = new Set<unknown>([undefined, 'scatter', 'scattergl', 'bar'])
/**
 * 算 log 軸資料範圍（logSpanDecades）時也要看的 trace：heatmap / histogram 有自己的座標陣列（x、y），
 * 但不經過 filterLogData（Plotly 自己處理 ≤0 的格子／樣本）。只看明確給的陣列，不補隱含的 x0 + i·dx。
 * 少了它們時，「熱圖 + 一條直線」的圖在 xLog 下只剩直線算進範圍（0 個十進位）→ dtick 交給 Plotly，
 * 主刻度就隨像素寬度在「1、10、100」與「1、2、5、10、20…」之間跳。
 * （case-sspll 的 sign map 熱圖目前只在 layout 設 type:'log'、沒給 xLog，所以 Plot 本來就不管它的刻度；
 * 要讓它和上面的折線圖一樣固定標 10 的整數次方，呼叫端改成 xLog 即可，這裡已經算得對。）
 */
const LOG_SPAN_OWN_COORD_TYPES = new Set<unknown>(['heatmap', 'histogram'])
/** 與 x/y 同長、需要同步過濾的逐點欄位 */
const PER_POINT_KEYS = ['text', 'hovertext', 'customdata', 'ids', 'width']
const PER_POINT_NESTED: [string, string][] = [
  ['marker', 'color'],
  ['marker', 'size'],
  ['marker', 'symbol'],
  ['error_x', 'array'],
  ['error_x', 'arrayminus'],
  ['error_y', 'array'],
  ['error_y', 'arrayminus'],
]

/**
 * log 軸無法顯示 ≤0 的值；Plotly 會默默丟掉它們。這裡改為「明確丟棄並計數」，
 * 讓 UI 顯示「已略去 N 個 ≤0 的點（log 軸）」。只處理 scatter / scattergl / bar 類 trace。
 * 只有 y 沒有 x 的 trace 在 xLog 時會補上隱含的 x = x0 + i·dx（預設 0, 1, 2…）。
 */
export function filterLogData(data: readonly Data[], xLog: boolean, yLog: boolean): { data: Data[]; dropped: number } {
  if (!xLog && !yLog) return { data: [...data], dropped: 0 }
  let dropped = 0
  const out = data.map((trace) => {
    const t = trace as Obj
    if (!FILTERABLE_TYPES.has(t.type)) return trace
    let x = t.x
    const y = t.y
    const hasX = isArray1D(x)
    const hasY = isArray1D(y)
    if (!hasX && !hasY) return trace
    // x、y 長度不同時 Plotly 只畫到較短者；這裡同樣截到較短長度
    const n =
      hasX && hasY
        ? Math.min((x as ArrayLike<unknown>).length, (y as ArrayLike<unknown>).length)
        : hasY
          ? (y as ArrayLike<unknown>).length
          : (x as ArrayLike<unknown>).length
    let materializedX = false
    if (xLog && !hasX && hasY) {
      const x0 = typeof t.x0 === 'number' ? t.x0 : 0
      const dx = typeof t.dx === 'number' ? t.dx : 1
      x = Array.from({ length: n }, (_, i) => x0 + i * dx)
      materializedX = true
    }
    const xs = isArray1D(x) ? x : null
    const ys = hasY ? (y as ArrayLike<unknown>) : null
    const keep = new Array<boolean>(n)
    let drop = 0
    for (let i = 0; i < n; i++) {
      const bad = (xLog && xs !== null && isNonPositive(xs[i])) || (yLog && ys !== null && isNonPositive(ys[i]))
      keep[i] = !bad
      if (bad) drop++
    }
    if (drop === 0) return materializedX ? ({ ...t, x } as Data) : trace
    dropped += drop
    const nt: Obj = { ...t }
    if (xs) nt.x = filterArray(xs, keep)
    if (ys) nt.y = filterArray(ys, keep)
    for (const k of PER_POINT_KEYS) {
      const v = t[k]
      if (isArray1D(v) && v.length === n) nt[k] = filterArray(v, keep)
    }
    for (const [outer, inner] of PER_POINT_NESTED) {
      const o = t[outer]
      if (isPlainObject(o) && isArray1D(o[inner]) && (o[inner] as ArrayLike<unknown>).length === n) {
        nt[outer] = { ...o, [inner]: filterArray(o[inner] as ArrayLike<unknown>, keep) }
      }
    }
    return nt as Data
  })
  return { data: out, dropped }
}

/** 深層合併：plain object 遞迴合併；陣列、typed array 與原始值直接取代；override 的 undefined 會被略過 */
export function mergeDeep<T extends Obj>(base: T, override: Obj | undefined): T {
  if (!override) return { ...base }
  const out: Obj = { ...base }
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue
    const b = out[k]
    out[k] = isPlainObject(b) && isPlainObject(v) ? mergeDeep(b, v) : v
  }
  return out as T
}

/** Plotly 允許 title 為字串；統一轉成 { text } 以便合併字型顏色 */
function normalizeTitles(layout: Obj): Obj {
  const out: Obj = { ...layout }
  if (typeof out.title === 'string') out.title = { text: out.title }
  for (const k of Object.keys(out)) {
    if (/^[xy]axis\d*$/.test(k) && isPlainObject(out[k])) {
      const ax = { ...(out[k] as Obj) }
      if (typeof ax.title === 'string') ax.title = { text: ax.title }
      out[k] = ax
    }
  }
  return out
}

export interface ThemedLayoutOptions {
  height: number
  xLog?: boolean
  yLog?: boolean
  /** 使用者 layout（優先於主題預設） */
  layout?: Partial<Layout>
  /**
   * 會出現在圖例裡的 trace 數（showlegend ≠ false）。≤ LEGEND_INSIDE_MAX 時圖例放進繪圖區上方角落內側，
   * 否則放在繪圖區上方一列（圖例太多時不壓縮資料區）。未提供時視為「很多」（放上方）。
   */
  legendEntries?: number
  /**
   * 圖例放內側時用哪個角落（pickLegendCorner 依資料決定）：未提供時放右上角；
   * null 表示兩個上方角落都有資料 → 即使 trace 很少也放到繪圖區上方，不蓋住曲線。
   */
  legendCorner?: LegendCorner | null
  /** log 軸資料跨越的十進位數（logSpanDecades）；決定只標 10 的整數次方還是也標 2、5。未提供時視為很寬 */
  xLogDecades?: number
  yLogDecades?: number
}

/** 圖例放進繪圖區內側的 trace 數上限 */
export const LEGEND_INSIDE_MAX = 3

/** `#rrggbb` / `#rgb` → `rgba(r,g,b,alpha)`；不是 hex（例如已是 rgba 字串）時原樣回傳 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** log 軸跨越至少這麼多個十進位時只標 10 的整數次方（Bode／PSD 圖慣例）；更窄的軸需要 2、5 才讀得出數值 */
export const LOG_POWER_TICKS_MIN_DECADES = 1.7
/** 跨這麼多個十進位的 log 軸（例如 PSD 從 1e-21 到 1e-5）每兩個十進位才標一次 */
export const LOG_SPARSE_TICKS_MIN_DECADES = 12

/**
 * log 軸的主刻度間距：≥ 12 個十進位 → 每兩個十進位標一次（dtick 2；PSD 圖常跨 15 個十進位，每個都標會疊在一起）；
 * ≥ 1.7 個十進位 → 只標 10 的整數次方（dtick 1）；1–1.7 個十進位 → 1、2、5（'D2'）；
 * 不到一個十進位 → 交給 Plotly（線性刻度，標完整數字）。範圍不明時當作很寬（dtick 1）。
 * 縮放後 Plot 元件會用目前的軸範圍重新呼叫（plotly_relayout），放大到一個十進位內仍有刻度數字。
 */
export function logAxisDtick(spanDecades: number | undefined): number | string | undefined {
  if (spanDecades === undefined || !Number.isFinite(spanDecades)) return 1
  if (spanDecades >= LOG_SPARSE_TICKS_MIN_DECADES) return 2
  if (spanDecades >= LOG_POWER_TICKS_MIN_DECADES) return 1
  if (spanDecades >= 1) return 'D2'
  return undefined
}

function numericValues(v: unknown): number[] {
  if (!isArray1D(v)) return []
  const out: number[] = []
  for (let i = 0; i < v.length; i++) {
    const n = typeof v[i] === 'number' ? (v[i] as number) : typeof v[i] === 'string' ? Number(v[i]) : NaN
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/** 主軸（x／y；沒指定 xaxis／yaxis 或指向 'x'／'y'）的 trace 才算進資料範圍 */
function onPrimaryAxis(t: Obj, axis: 'x' | 'y'): boolean {
  const ref = t[`${axis}axis`]
  return ref === undefined || ref === axis
}

/** trace 在某軸上的數值：只有 y 的 trace 在 x 軸補上隱含的 x0 + i·dx */
function axisValues(t: Obj, axis: 'x' | 'y'): number[] {
  if (axis === 'y' || isArray1D(t.x)) return numericValues(t[axis])
  const n = isArray1D(t.y) ? t.y.length : 0
  const x0 = typeof t.x0 === 'number' ? t.x0 : 0
  const dx = typeof t.dx === 'number' ? t.dx : 1
  return Array.from({ length: n }, (_, i) => x0 + i * dx)
}

/**
 * log 軸上資料跨越的十進位數：log10(max) − log10(min)（只看 > 0 的有限值）。
 * 呼叫端在 layout 給了 range（log 軸的 range 本身就是 log10 單位）時以它為準。沒有資料時回傳 undefined。
 */
export function logSpanDecades(data: readonly Data[], axis: 'x' | 'y', range?: unknown): number | undefined {
  if (Array.isArray(range) && range.length === 2 && typeof range[0] === 'number' && typeof range[1] === 'number') {
    return Math.abs(range[1] - range[0])
  }
  let lo = Infinity
  let hi = -Infinity
  for (const trace of data) {
    const t = trace as Obj
    if (!onPrimaryAxis(t, axis)) continue
    let values: number[]
    if (FILTERABLE_TYPES.has(t.type)) values = axisValues(t, axis)
    else if (LOG_SPAN_OWN_COORD_TYPES.has(t.type)) values = numericValues(t[axis])
    else continue
    for (const v of values) {
      if (v <= 0) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined
  return Math.log10(hi) - Math.log10(lo)
}

function axisStyle(t: ThemeTokens, log = false, decades?: number): Obj {
  const ax: Obj = {
    gridcolor: t.border,
    linecolor: t.borderStrong,
    zerolinecolor: t.borderStrong,
    tickcolor: t.borderStrong,
    tickfont: { color: t.textMuted },
    title: { font: { color: t.text } },
    automargin: true,
  }
  if (log) {
    // 寬的 log 軸只標 10 的整數次方（Bode／PSD 圖的慣例），2、5 等次刻度只留淡格線不印數字；
    // 手機寬度下「10⁻² 2 5 10⁻¹ 2 5」會擠成一團。只跨一兩個十進位的軸仍標 2、5（logAxisDtick）
    const dtick = logAxisDtick(decades)
    if (dtick !== undefined) ax.dtick = dtick
    ax.minor = { showgrid: true, gridcolor: withAlpha(t.border, 0.5), ticks: '', dtick: 'D1' }
  }
  return ax
}

/** 圖例放在繪圖區上方一列（水平）；trace 很多或呼叫端自己定位時用這個 */
function legendAbove(t: ThemeTokens): Obj {
  return { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)', font: { color: t.text } }
}

/** 圖例放進繪圖區內側時可用的角落（上方兩角；下方常有 x 軸附近的曲線起點與 0 線） */
export type LegendCorner = 'top-right' | 'top-left'

/** 圖例放在繪圖區上方角落內側，半透明底色讓文字壓在格線上仍可讀 */
function legendInside(t: ThemeTokens, corner: LegendCorner): Obj {
  const right = corner === 'top-right'
  return { orientation: 'v', x: right ? 1 : 0, xanchor: right ? 'right' : 'left', y: 1, yanchor: 'top', bgcolor: withAlpha(t.surface, 0.8), font: { color: t.text } }
}

const LEGEND_POSITION_KEYS = ['orientation', 'x', 'y', 'xanchor', 'yanchor']

/**
 * 圖例最後放哪裡：呼叫端自己定位（orientation / x / y / anchor 任一）→ 以上方為底；
 * trace ≤ LEGEND_INSIDE_MAX 且 legendCorner 不是 null → 該角落內側；否則上方。
 * Plot 元件也用它決定工具列的位置（圖例在上方時工具列移到繪圖區頂端，才不會蓋住圖例）。
 */
export function legendPlacement(opts: Pick<ThemedLayoutOptions, 'layout' | 'legendEntries' | 'legendCorner'>): 'above' | LegendCorner {
  const userLegend = isPlainObject(opts.layout?.legend) ? (opts.layout!.legend as Obj) : null
  if (userLegend && LEGEND_POSITION_KEYS.some((k) => userLegend[k] !== undefined)) return 'above'
  if (opts.legendEntries === undefined || opts.legendEntries > LEGEND_INSIDE_MAX) return 'above'
  const corner = opts.legendCorner === undefined ? 'top-right' : opts.legendCorner
  return corner ?? 'above'
}

/** 內側圖例大約佔資料範圍的比例（寬、高各 30%）：角落的這塊區域裡有資料點就不放 */
export const LEGEND_CORNER_FRACTION = 0.3
/** 內側圖例（估計寬度）超過繪圖區寬度的這個比例時放上方（手機上圖例會蓋掉半張圖） */
export const LEGEND_INSIDE_MAX_WIDTH_FRACTION = 0.4

/**
 * 圖例寬度的粗估（px，字級 12）：CJK 字 12px、其他 6.5px，加樣本線與邊距。
 * 名稱裡的 `$...$` TeX 先粗略去掉標記（`\Omega` 之類的指令算一個字、`{}^_$` 不算），HTML 標籤也不算。
 */
export function estimateLegendWidth(names: readonly string[]): number {
  let widest = 0
  for (const name of names) {
    const plain = name
      .replace(/<[^>]+>/g, '')
      .replace(/\\[a-zA-Z]+/g, 'x')
      .replace(/[\\{}^_$]/g, '')
    let w = 0
    for (const ch of plain) w += ch.codePointAt(0)! > 0x2e80 ? 12 : 6.5
    widest = Math.max(widest, w)
  }
  return widest + 46
}

export interface LegendCornerOptions {
  xLog?: boolean
  yLog?: boolean
  /** 使用者 layout（讀 xaxis／yaxis 的 range） */
  layout?: Partial<Layout>
  /** 繪圖區（容器）寬度 px；0 或未提供表示不知道 */
  plotWidth?: number
}

/**
 * 類別軸（x 或 y 是字串標籤，例如 bar 的 'm=1'…'GOS'）：沒有數值可用時以出現順序的索引當座標，
 * 角落判斷才看得到最右邊那根最高的長條；數值軸與只有 y 的 trace（隱含 x = x0 + i·dx）照 axisValues。
 */
function axisValuesOrCategoryIndex(t: Obj, axis: 'x' | 'y'): number[] {
  const vals = axisValues(t, axis)
  const raw = t[axis]
  if (vals.length === 0 && isArray1D(raw) && raw.length > 0) return Array.from({ length: raw.length }, (_, i) => i)
  return vals
}

/**
 * 圖例可以放在哪個上方角落而不蓋到資料：先看右上，再看左上；兩邊都有資料（例如滿寬的水平參考線、
 * 收斂到上緣的曲線）或圖例太寬就回傳 null（放繪圖區上方）。只看主軸上的 scatter／bar 資料；
 * 有 heatmap 等整面填滿的 trace 時也回傳 null。範圍以資料 min／max（或呼叫端的 range）正規化，log 軸取 log10，
 * 類別軸（字串標籤）以出現順序的索引當座標。
 */
export function pickLegendCorner(data: readonly Data[], opts: LegendCornerOptions = {}): LegendCorner | null {
  const traces = data.filter((tr) => {
    const t = tr as Obj
    return t.visible !== false
  })
  if (traces.some((tr) => !FILTERABLE_TYPES.has((tr as Obj).type))) return null
  if (opts.plotWidth && opts.plotWidth > 0) {
    const names = traces.filter((tr) => (tr as Obj).showlegend !== false).map((tr) => (typeof (tr as Obj).name === 'string' ? ((tr as Obj).name as string) : ''))
    if (estimateLegendWidth(names) > LEGEND_INSIDE_MAX_WIDTH_FRACTION * opts.plotWidth) return null
  }
  const l = (opts.layout ?? {}) as Obj
  const axisRange = (axis: 'x' | 'y'): [number, number] | null => {
    const ax = isPlainObject(l[`${axis}axis`]) ? (l[`${axis}axis`] as Obj) : {}
    const r = ax.range
    return Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number' ? [r[0], r[1]] : null
  }
  const scale = (axis: 'x' | 'y') => (opts[`${axis}Log`] ? (v: number) => (v > 0 ? Math.log10(v) : NaN) : (v: number) => v)
  const sx = scale('x')
  const sy = scale('y')
  const pts: [number, number][] = []
  for (const tr of traces) {
    const t = tr as Obj
    if (!onPrimaryAxis(t, 'x') || !onPrimaryAxis(t, 'y')) return null
    const xs = axisValuesOrCategoryIndex(t, 'x').map(sx)
    const ys = axisValuesOrCategoryIndex(t, 'y').map(sy)
    const n = Math.min(xs.length, ys.length)
    for (let i = 0; i < n; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push([xs[i], ys[i]])
  }
  if (pts.length === 0) return 'top-right'
  const ext = (idx: 0 | 1, axis: 'x' | 'y'): [number, number] => {
    const r = axisRange(axis)
    if (r) return [Math.min(r[0], r[1]), Math.max(r[0], r[1])]
    let lo = Infinity
    let hi = -Infinity
    for (const p of pts) {
      if (p[idx] < lo) lo = p[idx]
      if (p[idx] > hi) hi = p[idx]
    }
    return [lo, hi]
  }
  const [x0, x1] = ext(0, 'x')
  const [y0, y1] = ext(1, 'y')
  // 範圍退化（所有點同一個 x 或同一個 y）：Plotly 會把範圍往兩邊撐開，資料落在正中間，角落是空的
  if (x1 - x0 === 0 || y1 - y0 === 0) return 'top-right'
  const xw = x1 - x0
  const yw = y1 - y0
  const yTop = y1 - LEGEND_CORNER_FRACTION * yw
  const xRight = x1 - LEGEND_CORNER_FRACTION * xw
  const xLeft = x0 + LEGEND_CORNER_FRACTION * xw
  let rightBusy = false
  let leftBusy = false
  for (const [x, y] of pts) {
    if (y < yTop) continue
    if (x > xRight) rightBusy = true
    if (x < xLeft) leftBusy = true
    if (rightBusy && leftBusy) return null
  }
  return rightBusy ? 'top-left' : 'top-right'
}

/**
 * 依主題 token 產生 Plotly layout：透明背景、主題文字色、--series-1..6 colorway、
 * 圖例（≤ 3 條且上方角落沒有資料時放繪圖區角落內側，否則水平置於繪圖區上方）。使用者 layout 會深層覆寫這些預設值；
 * 呼叫端自己定位圖例（orientation / x / y / anchor 任一）時，一律以「上方水平」為底再覆寫，
 * 既有的位置設定不會因 trace 數改變而跑掉。xLog / yLog 會強制對應主軸為 log。
 */
export function buildThemedLayout(t: ThemeTokens, opts: ThemedLayoutOptions): Partial<Layout> {
  const user = normalizeTitles((opts.layout ?? {}) as Obj)
  const userLegend = isPlainObject(user.legend) ? user.legend : null
  const placement = legendPlacement(opts)
  const base: Obj = {
    autosize: true,
    height: opts.height,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: t.fontSans, color: t.text, size: 12 },
    colorway: t.series,
    // 工具列（modebar）浮在圖內右上角、只在 hover 時出現；上邊界放得下它，圖例在內側時不會被蓋到
    margin: { l: 56, r: 16, t: 30, b: 44, pad: 0 },
    hovermode: 'closest',
    hoverlabel: { bgcolor: t.surface, bordercolor: t.border, font: { color: t.text, family: t.fontSans } },
    legend: placement === 'above' ? legendAbove(t) : legendInside(t, placement),
    modebar: { bgcolor: withAlpha(t.surface, 0.85), color: t.textMuted, activecolor: t.accent },
    xaxis: axisStyle(t, opts.xLog, opts.xLogDecades),
    yaxis: axisStyle(t, opts.yLog, opts.yLogDecades),
  }
  // 次座標軸（xaxis2、yaxis2…）也套用主題樣式
  for (const k of Object.keys(user)) {
    if (/^[xy]axis\d+$/.test(k)) base[k] = axisStyle(t)
  }
  const merged = mergeDeep(base, user)
  // 預設圖例貼在繪圖區上方（yanchor: 'bottom'）。呼叫端只改 y 想把圖例放到 x 軸下方時，
  // 錨點要跟著換成 'top'，否則圖例會往上長、蓋住座標軸與資料。
  if (userLegend && typeof userLegend.y === 'number' && userLegend.yanchor === undefined && userLegend.y <= 0) {
    merged.legend = { ...(merged.legend as Obj), yanchor: 'top' }
  }
  if (opts.xLog) merged.xaxis = { ...(merged.xaxis as Obj), type: 'log', exponentformat: (merged.xaxis as Obj).exponentformat ?? 'power' }
  if (opts.yLog) merged.yaxis = { ...(merged.yaxis as Obj), type: 'log', exponentformat: (merged.yaxis as Obj).exponentformat ?? 'power' }
  merged.height = opts.height
  return merged as Partial<Layout>
}

/** 第 4 條 trace 起輪流套用的線型（前三條維持實線，整體看起來就是 solid → dash → dot → dashdot） */
export const DASH_CYCLE = ['dash', 'dot', 'dashdot'] as const
const DASH_FROM = 3

/**
 * 色覺冗餘：同一張圖只靠顏色分辨曲線時，紅綠色覺差異者（與黑白列印）分不開。
 * 從第 4 條 trace 起，呼叫端沒指定 line.dash 的折線依序補上 dash / dot / dashdot。
 * 不用 'solid' 開頭的 4 循環：colorway 6 色，若第 7 條又回到實線就會和第 1 條（同色實線）完全相同；
 * 這樣排列可保證前 9 條的（顏色, 線型）都不重複。
 * 只處理 scatter / scattergl 且有畫線的 trace；已指定 dash、line.width = 0（填色帶的邊）或只有 markers 的一律不動。
 */
export function applyDashCycle(data: readonly Data[]): Data[] {
  if (data.length <= DASH_FROM) return [...data]
  return data.map((trace, i) => {
    if (i < DASH_FROM) return trace
    const t = trace as Obj
    if (!FILTERABLE_TYPES.has(t.type) || t.type === 'bar') return trace
    const mode = typeof t.mode === 'string' ? t.mode : 'lines'
    if (!mode.includes('lines')) return trace
    const line = isPlainObject(t.line) ? t.line : {}
    if (line.dash !== undefined || line.width === 0) return trace
    return { ...t, line: { ...line, dash: DASH_CYCLE[(i - DASH_FROM) % DASH_CYCLE.length] } } as Data
  })
}

/**
 * 匯出（PNG / SVG / 報告）用 layout：不透明背景（深色主題匯出時文字仍可讀），
 * 並把標題放進圖內。
 */
export function buildExportLayout(layout: Partial<Layout>, t: ThemeTokens, title?: string): Partial<Layout> {
  const l = layout as Obj
  const margin = isPlainObject(l.margin) ? l.margin : {}
  const top = typeof margin.t === 'number' ? margin.t : 32
  const out: Obj = { ...l, paper_bgcolor: t.surface, plot_bgcolor: t.surface }
  if (title) {
    out.title = { text: title, x: 0, xref: 'paper', xanchor: 'left', y: 1, yref: 'container', yanchor: 'top', pad: { t: 8 }, font: { size: 14, color: t.text } }
    out.margin = { ...margin, t: top + 34 }
  }
  return out as Partial<Layout>
}

function traceName(t: Obj, i: number): string {
  return typeof t.name === 'string' && t.name.trim() !== '' ? t.name.trim() : `trace${i + 1}`
}

/**
 * 將所有 trace 的 x / y 轉成 CSV 欄位：「<名稱> x」「<名稱> y」。
 * 只有 y 的 trace 會補上 x = x0 + i·dx；重複名稱加上 (2)、(3)… 區分。
 * 匯出的是原始（未經 log 過濾）資料，保留完整精度。
 */
export function tracesToColumns(data: readonly Data[]): CsvColumns {
  const cols: CsvColumns = {}
  const used = new Map<string, number>()
  data.forEach((trace, i) => {
    const t = trace as Obj
    const hasX = isArray1D(t.x)
    const hasY = isArray1D(t.y)
    if (!hasX && !hasY) return
    let name = traceName(t, i)
    const count = (used.get(name) ?? 0) + 1
    used.set(name, count)
    if (count > 1) name = `${name} (${count})`
    let x = t.x as ArrayLike<number | string | null> | undefined
    if (!hasX && hasY) {
      const n = (t.y as ArrayLike<unknown>).length
      const x0 = typeof t.x0 === 'number' ? t.x0 : 0
      const dx = typeof t.dx === 'number' ? t.dx : 1
      x = Array.from({ length: n }, (_, k) => x0 + k * dx)
    }
    if (x) cols[`${name} x`] = x
    if (hasY) cols[`${name} y`] = t.y as ArrayLike<number | string | null>
  })
  return cols
}
