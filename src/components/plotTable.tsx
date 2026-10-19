import type { ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { FigureDetails } from './DiagramFrame'
import { texNum } from './handcalcMath'
import { ScrollRegion } from './ScrollRegion'
import { Tex, mathText } from './Tex'

/**
 * Plot 的「看數據」：每條 trace 一列（名稱、點數、x 範圍、y 的最小／最大／首值／末值），給螢幕閱讀器與想看數字的讀者。
 * 純資料部分（summarizeTraces）可以在 node 環境測試；表格只在 details 打開時才算與渲染（FigureDetails 的惰性）。
 * 數字用 texNum（有效位數 4、|x| ≥ 1e6 或 < 1e-4 用 a×10^b）；log 軸看的是真正畫出來的資料（≤0 的點已略去，略去數另列）。
 */

type Obj = Record<string, unknown>

export const SUMMARY_SIG = 4

export interface NumRange {
  min: number
  max: number
  first: number
  last: number
}

export interface TraceSummary {
  index: number
  /** trace 名稱（可含 `$…$`）；沒名稱時是「曲線 N」 */
  name: string
  type: string
  /** 資料點數（heatmap 是 z 的格數；histogram 是樣本數） */
  points: number
  /** log 軸略去的 ≤0 點數（比較 Plot 收到的原始 data 與實際畫出的 data） */
  dropped: number
  /** x 範圍：數值，或類別軸的第一個與最後一個類別 */
  x?: { min: number; max: number } | { categories: [string, string] }
  /** y 的統計（heatmap 是 z） */
  y?: NumRange
  /** 補充說明（heatmap 的欄位是 z、histogram 沒有 y…） */
  notes: string[]
}

function isSeries(v: unknown): v is ArrayLike<unknown> {
  return (Array.isArray(v) && !v.some((e) => Array.isArray(e) || ArrayBuffer.isView(e))) || (ArrayBuffer.isView(v) && !(v instanceof DataView))
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 一維數列的統計（略過 null／NaN／非數字） */
export function seriesStats(values: ArrayLike<unknown>): (NumRange & { count: number }) | null {
  let min = Infinity
  let max = -Infinity
  let first: number | null = null
  let last = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    const n = toNum(values[i])
    if (n === null) continue
    count++
    if (n < min) min = n
    if (n > max) max = n
    if (first === null) first = n
    last = n
  }
  return first === null ? null : { min, max, first, last, count }
}

/** 字串（類別）數列：非空且至少一個元素不是數字 */
function categories(values: ArrayLike<unknown>): [string, string] | null {
  if (ArrayBuffer.isView(values) || values.length === 0) return null
  let numeric = true
  for (let i = 0; i < values.length; i++) if (typeof values[i] === 'string' && toNum(values[i]) === null) numeric = false
  if (numeric) return null
  return [String(values[0]), String(values[values.length - 1])]
}

function lengthOf(t: Obj): number {
  if (isSeries(t.y)) return t.y.length
  if (isSeries(t.x)) return t.x.length
  return 0
}

/** heatmap 的 z（二維陣列）統計 */
function matrixStats(z: unknown): (NumRange & { count: number }) | null {
  if (!Array.isArray(z)) return null
  let min = Infinity
  let max = -Infinity
  let first: number | null = null
  let last = 0
  let count = 0
  for (const row of z) {
    if (!isSeries(row)) continue
    for (let j = 0; j < row.length; j++) {
      const n = toNum(row[j])
      if (n === null) continue
      count++
      if (n < min) min = n
      if (n > max) max = n
      if (first === null) first = n
      last = n
    }
  }
  return first === null ? null : { min, max, first, last, count }
}

/**
 * 每條 trace 的摘要。`data` 是實際畫出的資料（log 軸已略去 ≤0 的點）；`original` 是 Plot 收到的資料，
 * 兩者逐項對應，差值就是略去的點數。
 */
export function summarizeTraces(data: readonly Data[], original: readonly Data[] = data): TraceSummary[] {
  return data.map((trace, index) => {
    const t = trace as Obj
    const type = typeof t.type === 'string' ? t.type : 'scatter'
    const name = typeof t.name === 'string' && t.name.trim() !== '' ? t.name.trim() : `曲線 ${index + 1}`
    const notes: string[] = []
    const out: TraceSummary = { index, name, type, points: 0, dropped: 0, notes }

    if (type === 'heatmap') {
      const z = matrixStats(t.z)
      const rows = Array.isArray(t.z) ? t.z.length : 0
      const cols = rows > 0 && isSeries((t.z as unknown[])[0]) ? ((t.z as unknown[][])[0] as ArrayLike<unknown>).length : 0
      out.points = rows * cols
      if (z) out.y = z
      notes.push(`熱圖，${rows} 列 × ${cols} 欄；最小、最大、首值、末值欄是 z`)
      const xs = isSeries(t.x) ? seriesStats(t.x) : null
      if (xs) out.x = { min: xs.min, max: xs.max }
      else if (isSeries(t.x)) {
        const c = categories(t.x)
        if (c) out.x = { categories: c }
      }
      return out
    }

    const xIsArray = isSeries(t.x)
    const yIsArray = isSeries(t.y)
    out.points = lengthOf(t)
    const orig = original[index] as Obj | undefined
    out.dropped = orig ? Math.max(0, lengthOf(orig) - out.points) : 0

    if (xIsArray) {
      const c = categories(t.x as ArrayLike<unknown>)
      if (c) out.x = { categories: c }
      else {
        const s = seriesStats(t.x as ArrayLike<unknown>)
        if (s) out.x = { min: s.min, max: s.max }
      }
    } else if (yIsArray) {
      // 沒有 x：Plotly 用 x0 + i·dx
      const x0 = typeof t.x0 === 'number' ? t.x0 : 0
      const dx = typeof t.dx === 'number' ? t.dx : 1
      const last = x0 + (out.points - 1) * dx
      if (out.points > 0) out.x = { min: Math.min(x0, last), max: Math.max(x0, last) }
    }

    if (type === 'histogram') {
      notes.push('直方圖：點數是樣本數，y 是各組的計數（Plotly 計算），這裡不列')
      if (!xIsArray && yIsArray) {
        const s = seriesStats(t.y as ArrayLike<unknown>)
        if (s) out.x = { min: s.min, max: s.max }
      }
      return out
    }
    if (yIsArray) {
      const s = seriesStats(t.y as ArrayLike<unknown>)
      if (s) out.y = s
      else notes.push('y 沒有數值（類別或空陣列）')
    } else notes.push('沒有 y 陣列')
    if (type === 'bar' && !yIsArray && xIsArray) notes.push('水平長條圖')
    return out
  })
}

/* ---------- 顯示 ---------- */

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

/** 數字：普通的小數直接用文字（省 DOM），科學記號用 KaTeX */
export function Num({ value }: { value: number }) {
  const tex = texNum(value, SUMMARY_SIG)
  if (PLAIN_NUMBER.test(tex)) return <span className="mono">{tex.startsWith('-') ? `−${tex.slice(1)}` : tex}</span>
  return <Tex>{tex}</Tex>
}

function RangeCell({ x }: { x: TraceSummary['x'] }) {
  if (!x) return <>—</>
  if ('categories' in x) return <>{x.categories[0]} … {x.categories[1]}</>
  return (
    <>
      <Num value={x.min} /> 到 <Num value={x.max} />
    </>
  )
}

function ValueCell({ v }: { v: number | undefined }) {
  return v === undefined ? <>—</> : <Num value={v} />
}

/** 軸標題（layout.xaxis.title 可能是字串或 { text }） */
function axisTitle(axis: unknown): string | undefined {
  if (!axis || typeof axis !== 'object') return undefined
  const t = (axis as Obj).title
  if (typeof t === 'string') return t
  if (t && typeof t === 'object' && typeof (t as Obj).text === 'string') return (t as Obj).text as string
  return undefined
}

export interface PlotDataDetailsProps {
  /** details 的 id（figure 的 aria-describedby 指到它） */
  id: string
  /** 實際畫出的資料（log 軸已略去 ≤0 的點） */
  data: readonly Data[]
  /** Plot 收到的原始資料（算略去的點數） */
  original: readonly Data[]
  layout?: Partial<Layout>
  xLog?: boolean
  yLog?: boolean
}

/** Plot 下方的「看數據」details：預設收合，打開時才計算與渲染。 */
export function PlotDataDetails({ id, data, original, layout, xLog, yLog }: PlotDataDetailsProps) {
  return (
    <FigureDetails id={id} className="c-plot-alt" summary={<>看數據（{data.length} 條曲線）</>}>
      {() => <PlotDataBody data={data} original={original} layout={layout} xLog={xLog} yLog={yLog} />}
    </FigureDetails>
  )
}

function AxisLine({ axis, title, log }: { axis: 'x' | 'y'; title: string | undefined; log: boolean | undefined }): ReactNode {
  if (!title && !log) return null
  return (
    <li>
      {mathText(`$${axis}$ 軸`)}
      {title ? <>：{mathText(title)}</> : null}
      {log ? '（對數軸）' : ''}
    </li>
  )
}

function PlotDataBody({ data, original, layout, xLog, yLog }: Omit<PlotDataDetailsProps, 'id'>) {
  const rows = summarizeTraces(data, original)
  const xt = axisTitle(layout?.xaxis)
  const yt = axisTitle(layout?.yaxis)
  const droppedTotal = rows.reduce((s, r) => s + r.dropped, 0)
  return (
    <>
      {(xt || yt || xLog || yLog) && (
        <ul className="c-figalt-list">
          <AxisLine axis="x" title={xt} log={xLog} />
          <AxisLine axis="y" title={yt} log={yLog} />
        </ul>
      )}
      {rows.length === 0 ? (
        <p className="c-figalt-note">這張圖沒有資料。</p>
      ) : (
        <ScrollRegion className="table-wrap c-figalt-table" label="數據表（可左右捲動）">
          <table>
            <caption className="c-sr-only">圖中各條曲線的數據摘要</caption>
            <thead>
              <tr>
                <th scope="col">曲線</th>
                <th scope="col" className="num">
                  點數
                </th>
                <th scope="col">{mathText('$x$ 範圍')}</th>
                <th scope="col" className="num">
                  {mathText('$y$ 最小')}
                </th>
                <th scope="col" className="num">
                  {mathText('$y$ 最大')}
                </th>
                <th scope="col" className="num">
                  {mathText('$y$ 首值')}
                </th>
                <th scope="col" className="num">
                  {mathText('$y$ 末值')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.index}>
                  <th scope="row">
                    <span>{mathText(r.name)}</span>
                    {r.notes.map((n) => (
                      <span className="c-figalt-rownote" key={n}>
                        {n}
                      </span>
                    ))}
                  </th>
                  <td className="num">
                    {r.points}
                    {r.dropped > 0 ? `（另略去 ${r.dropped} 個 ≤0 的點）` : ''}
                  </td>
                  <td>
                    <RangeCell x={r.x} />
                  </td>
                  <td className="num">
                    <ValueCell v={r.y?.min} />
                  </td>
                  <td className="num">
                    <ValueCell v={r.y?.max} />
                  </td>
                  <td className="num">
                    <ValueCell v={r.y?.first} />
                  </td>
                  <td className="num">
                    <ValueCell v={r.y?.last} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {droppedTotal > 0 && <p className="c-figalt-note">對數軸畫不出 ≤0 的值，上表的範圍與最小／最大只看畫出來的點；下載 CSV 仍是完整的原始資料。</p>}
    </>
  )
}
