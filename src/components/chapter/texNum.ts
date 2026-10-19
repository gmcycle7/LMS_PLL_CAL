/**
 * 章節內「把數字放進 TeX」的共用函式（原本 ch00／ch01／ch09／ch11／ch11b 各有一份 texNum，位數、負號、NaN 的規則各不相同）。
 *
 * 和 `@/components` 的 `texNum`（handcalcMath.ts）的差別：那個給 HandCalc 的帶入過程用（5 位有效數字、0.001 以下改指數、NaN 寫 `\text{NaN}`）；
 * 這個給章節正文與表格用，沿用全站 `fmt`（simulation/core/units.ts）的規則：|x| ≥ 1e6 或 < 1e-4 時用指數。
 * 注意：這裡只做顯示格式，不得用來改變參與計算的數值。
 */
import { fmt } from '@/simulation/core'

export interface TexNumOptions {
  /** 負數加括號（方便寫成乘法 `0.1\times(-3)`）。預設 false */
  paren?: boolean
  /** NaN 的 TeX 寫法。預設 `\text{—}`（和 ±∞ 一樣不讓 "NaN" 這種斜體字母混進公式） */
  nan?: string
}

/**
 * 數字 → TeX 片段。
 *   - `fmt` 的有效位數規則（去尾零）；指數 `1.2e-7` 改寫成 `1.2\times10^{-7}`（不然 TeX 會把 e 當成變數）。
 *   - ±∞ → `\infty`／`-\infty`；NaN → `opts.nan`（預設 `\text{—}`）。
 *   - 負號用 ASCII `-`（KaTeX 會排成數學負號）。
 */
export function texNumber(x: number, digits = 4, opts: TexNumOptions = {}): string {
  if (Number.isNaN(x)) return opts.nan ?? String.raw`\text{—}`
  if (x === Infinity) return String.raw`\infty`
  if (x === -Infinity) return String.raw`-\infty`
  const s = fmt(x, digits)
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  const body = m ? String.raw`${m[1]}\times10^{${Number(m[2])}}` : s
  return opts.paren && x < 0 ? `(${body})` : body
}

/**
 * 做出一個「預設位數已綁好」的 texNum：每章只需要一行 `export const texNum = makeTexNum(6)`，
 * 而不是各自重寫轉換規則。呼叫時 `texNum(x, 3)` 仍可覆寫位數。
 */
export function makeTexNum(defaultDigits = 4, opts: TexNumOptions = {}): (x: number, digits?: number) => string {
  return (x, digits = defaultDigits) => texNumber(x, digits, opts)
}
