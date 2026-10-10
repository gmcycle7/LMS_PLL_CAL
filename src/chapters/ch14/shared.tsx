import { Fragment, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Shape } from 'plotly.js-dist-min'
import { StepDerivation, Tex } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import { fmt } from '@/simulation/core'

/**
 * Ch14 共用的小元件與工具（只在本章使用；可考慮上移到共用層，見回報）。
 */

/** 「勘誤 Exx」小標註：連到驗證頁（verification 頁依 id 列出勘誤）。 */
export function ErratumNote({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="ch14-erratum" role="note">
      <Link to="/verification" className="ch14-erratum-tag" title={`validation.md ${id}`}>
        勘誤 {id}
      </Link>
      <span className="ch14-erratum-body">{children}</span>
    </div>
  )
}

/**
 * 把含 $…$ 的說明文字轉成「文字 + 行內 KaTeX」：md('因為 $|x|=1$，所以…')。
 * 讓標題、圖說、控制項標籤、表格欄名也遵守「所有數學一律 LaTeX」（docs/teaching-style.md §3）。
 * 用法：md(String.raw`…$\mu^*$…`)；字串裡的 $ 必須成對（奇數段是 TeX）。
 */
export function md(s: string): ReactNode {
  return s.split('$').map((part, i) => (i % 2 === 1 ? <Tex key={i}>{part}</Tex> : <Fragment key={i}>{part}</Fragment>))
}

/** 「bias²」這個詞的 KaTeX 版本（內文不用 Unicode 上標拼湊）。 */
export const BIAS2: ReactNode = <Tex>{'\\text{bias}^2'}</Tex>

/** 目前學習模式；在 <SettingsProvider> 之外（獨立預覽）退回 'engineer'。useSettings 只呼叫一次 useContext，try/catch 不影響 hook 順序。 */
export function useMode(): LearningMode {
  try {
    return useSettings().mode
  } catch {
    return 'engineer'
  }
}

/**
 * 逐步推導（docs/teaching-style.md §6）：Engineer／Research 直接展開；Beginner 預設收合、一鍵展開。
 * 與 StepDerivation 相同的 props（同一份內容，只改變呈現）。
 */
export function Steps(props: ComponentProps<typeof StepDerivation>) {
  const mode = useMode()
  if (mode !== 'beginner') return <StepDerivation {...props} />
  return (
    <details className="ch14-details">
      <summary>
        {props.title ?? '推導'}（{props.steps.length} 步；Beginner 模式預設收合，點此展開）
      </summary>
      <StepDerivation {...props} title={undefined} />
    </details>
  )
}

/** 給 KaTeX 字串用的數字格式（有效位數；指數改成 \times 10^{}）。 */
export function tx(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : '\\text{NaN}'
  const s = fmt(x, digits)
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  if (m) return `${m[1]}\\times10^{${Number(m[2])}}`
  return s
}

/** 一般文字用的數字格式（fmt 的別名，方便閱讀）。 */
export function nf(x: number, digits = 4): string {
  return Number.isFinite(x) ? fmt(x, digits) : '—'
}

/** #rrggbb → rgba(r, g, b, a)；其他格式原樣回傳（Plotly 讀不到 CSS 變數，需轉成實際顏色）。 */
export function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim())
  if (!m) return color
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`
}

/** 在 log 或線性 x 軸上畫一段垂直色帶（yref = paper）。 */
export function vBand(x0: number, x1: number, color: string, opacity = 0.12): Partial<Shape> {
  return {
    type: 'rect',
    xref: 'x',
    yref: 'paper',
    x0,
    x1,
    y0: 0,
    y1: 1,
    fillcolor: color,
    opacity,
    line: { width: 0 },
    layer: 'below',
  }
}

/** 垂直虛線（yref = paper）。 */
export function vLine(x: number, color: string, dash: 'dash' | 'dot' | 'solid' = 'dash'): Partial<Shape> {
  return { type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color, width: 1.5, dash } }
}

/** 水平虛線（xref = paper）。 */
export function hLine(y: number, color: string, dash: 'dash' | 'dot' | 'solid' = 'dot'): Partial<Shape> {
  return { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: y, y1: y, line: { color, width: 1.5, dash } }
}

/** log 等距格點（含端點）。 */
export function logspace(lo: number, hi: number, n: number): number[] {
  const out: number[] = []
  const r = Math.log(hi / lo)
  for (let i = 0; i < n; i++) out.push(lo * Math.exp((r * i) / (n - 1)))
  return out
}

/** 線性等距格點（含端點）。 */
export function linspace(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
}
