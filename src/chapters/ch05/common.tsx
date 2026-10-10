import type { ReactNode } from 'react'
import { HandCalc, StepDerivation, mathText, type Step } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import { HANDCALCS } from './handcalcs'

/**
 * Ch05 私有的小工具（不放進共用層；若其他章節需要，建議上移到 @/components）。
 */

/** 與 useSettings().atLeast 相同，但在 SettingsProvider 之外不丟錯（預設 engineer）。 */
export function useAtLeast(min: LearningMode): boolean {
  try {
    return useSettings().atLeast(min)
  } catch {
    return min !== 'research'
  }
}

/**
 * 逐步推導（StepDerivation）外包一層可收合的框：
 * Beginner 預設收合（一鍵展開），Engineer / Research 預設展開（docs/teaching-style.md §6）。
 * title 與每一步的 why 是字串時支援 `$...$` 行內公式（與共用元件的標題一致）。
 */
export function Steps({ title, steps, result, open }: { title: ReactNode; steps: Step[]; result?: string; open?: boolean }) {
  const engineer = useAtLeast('engineer')
  return (
    <details className="ch05-steps" open={open ?? engineer}>
      <summary>
        <span className="ch05-steps-badge">逐步推導</span> {mathText(title)}
      </summary>
      <StepDerivation steps={steps.map((s) => ({ ...s, why: mathText(s.why) }))} result={result} />
    </details>
  )
}

/**
 * 帶入手算（docs/teaching-style.md §7）：依 id 從本章的 HANDCALCS 取題，放在對應推導／worked example 的正後方，
 * 並先用一句話邀請讀者把數字換成自己的、用紙筆算一次再對答案。
 */
export function HandCalcBlock({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) return null
  return (
    <div className="ch05-handcalc">
      <p className="ch05-handcalc-invite">
        <strong>換你算：</strong>
        {children ?? '把下面的數字換成你手邊電路的值，先用紙筆和計算機算一次，再展開帶入過程對答案。'}
      </p>
      <HandCalc def={def} />
    </div>
  )
}

/** 勘誤小註：連到驗證頁（勘誤以 id 列出）。 */
export function Erratum({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <span className="ch05-erratum">
      <a href="#/verification" title={`docs/validation.md 勘誤 ${id}`}>
        勘誤 {id}
      </a>
      {children && <span className="ch05-erratum-text">{children}</span>}
    </span>
  )
}

/** 百分比字串（預設 2 位小數）。 */
export function pct(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '—'
  return `${(100 * x).toFixed(digits)}%`
}

/** 百分比的 TeX 寫法（給 <Tex> 內插值用），例如 49.20 後面接 TeX 的百分號；非有限值顯示「—」。 */
export function texPct(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '\\text{—}'
  return `${(100 * x).toFixed(digits)}\\%`
}

/** 固定小數位（非有限值顯示「—」或 ∞）。 */
export function fx(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '—'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  return x.toFixed(digits)
}

/** 千分位整數。 */
export function int(x: number): string {
  if (!Number.isFinite(x)) return '—'
  return Math.round(x).toLocaleString('en-US')
}

/** 千分位整數的 TeX 寫法（42{,}499）：數學模式裡直接寫逗號會被排成「42, 499」（逗號後多一個空隙）。 */
export function texInt(x: number): string {
  if (!Number.isFinite(x)) return '\\text{—}'
  return int(x).replace(/,/g, '{,}')
}

/** 有效位數（toPrecision，去掉尾端 0）。 */
export function sig(x: number, digits = 6): string {
  if (Number.isNaN(x)) return '—'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e7 || a < 1e-5) return x.toExponential(digits - 1)
  return String(Number(x.toPrecision(digits)))
}

/**
 * 數字 → TeX 字串（給 <Tex> 內插值用）：很大或很小的數寫成 a\times10^{b}，不會出現「6.65e-8」這種被 KaTeX 排成斜體變數的寫法。
 */
export function texNum(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '\\text{—}'
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e7 || a < 1e-4) {
    const [mant, exp] = x.toExponential(Math.max(0, digits - 1)).split('e')
    const m = String(Number(mant))
    const head = m === '1' ? '' : m === '-1' ? '-' : `${m}\\times`
    return `${head}10^{${Number(exp)}}`
  }
  return String(Number(x.toPrecision(digits)))
}

/**
 * 理論上應為 0、但受雙精度捨入限制的量（例如穩態偏差）：|x| < floor 時顯示「≈ 0」，不把捨入雜訊當成有效數字。
 */
export function sigOrZero(x: number, digits = 4, floor = 1e-9): string {
  if (Number.isFinite(x) && Math.abs(x) < floor) return `≈ 0（< ${floor.toExponential(0)}）`
  return sig(x, digits)
}

/** 本章所用的 Plotly 參考線（垂直、y 方向以 paper 座標鋪滿）。 */
export function vline(x: number, color: string, dash: 'dash' | 'dot' | 'solid' = 'dash') {
  return { type: 'line' as const, x0: x, x1: x, y0: 0, y1: 1, yref: 'paper' as const, line: { color, width: 1.5, dash } }
}

/** 水平參考線（x 方向以 paper 座標鋪滿）。 */
export function hline(y: number, color: string, dash: 'dash' | 'dot' | 'solid' = 'dot') {
  return { type: 'line' as const, x0: 0, x1: 1, xref: 'paper' as const, y0: y, y1: y, line: { color, width: 1, dash } }
}

/** log 格點（含兩端）。 */
export function logspace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo)
  const b = Math.log10(hi)
  return Array.from({ length: n }, (_, i) => Math.pow(10, a + ((b - a) * i) / (n - 1)))
}

/** 線性格點（含兩端）。 */
export function linspace(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
}
