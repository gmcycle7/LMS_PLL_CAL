import type { Data, Layout } from 'plotly.js-dist-min'
import type { ThemeTokens } from './theme'
import type { CsvColumns } from './types'

/**
 * Plot 元件的純函式部分（可在 node 環境測試）：log 軸過濾、主題 layout、CSV 欄位。
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
}

function axisStyle(t: ThemeTokens): Obj {
  return {
    gridcolor: t.border,
    linecolor: t.borderStrong,
    zerolinecolor: t.borderStrong,
    tickcolor: t.borderStrong,
    tickfont: { color: t.textMuted },
    title: { font: { color: t.text } },
    automargin: true,
  }
}

/**
 * 依主題 token 產生 Plotly layout：透明背景、主題文字色、--series-1..6 colorway、
 * 水平圖例置於繪圖區上方（手機上不壓縮繪圖寬度）。使用者 layout 會深層覆寫這些預設值；
 * xLog / yLog 會強制對應主軸為 log。
 */
export function buildThemedLayout(t: ThemeTokens, opts: ThemedLayoutOptions): Partial<Layout> {
  const user = normalizeTitles((opts.layout ?? {}) as Obj)
  const base: Obj = {
    autosize: true,
    height: opts.height,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: t.fontSans, color: t.text, size: 12 },
    colorway: t.series,
    // 工具列（modebar）由 CSS 移到圖的上方自己一列，上邊界只需要放得下一列圖例
    margin: { l: 56, r: 16, t: 30, b: 44, pad: 0 },
    hovermode: 'closest',
    hoverlabel: { bgcolor: t.surface, bordercolor: t.border, font: { color: t.text, family: t.fontSans } },
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)', font: { color: t.text } },
    modebar: { bgcolor: 'rgba(0,0,0,0)', color: t.textMuted, activecolor: t.accent },
    xaxis: axisStyle(t),
    yaxis: axisStyle(t),
  }
  // 次座標軸（xaxis2、yaxis2…）也套用主題樣式
  for (const k of Object.keys(user)) {
    if (/^[xy]axis\d+$/.test(k)) base[k] = axisStyle(t)
  }
  const merged = mergeDeep(base, user)
  if (opts.xLog) merged.xaxis = { ...(merged.xaxis as Obj), type: 'log', exponentformat: (merged.xaxis as Obj).exponentformat ?? 'power' }
  if (opts.yLog) merged.yaxis = { ...(merged.yaxis as Obj), type: 'log', exponentformat: (merged.yaxis as Obj).exponentformat ?? 'power' }
  merged.height = opts.height
  return merged as Partial<Layout>
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
