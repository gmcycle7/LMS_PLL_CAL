import { fmt } from '@/simulation/core'
import type { PoleBehaviour } from '@/simulation/models/lms'

/** 顯示用數字（預設 6 位有效數字，去掉尾端 0；2.2800000000000002 → '2.28'）。 */
export function num(x: number, digits = 6): string {
  return fmt(x, digits)
}

/** 放進 TeX 的數字：負數加括號（方便寫成乘法 0.1\times(-3)），並把 'e' 指數轉成 \times10^{…}。 */
export function texNum(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return x > 0 ? String.raw`\infty` : x < 0 ? String.raw`-\infty` : String.raw`\text{NaN}`
  const s = fmt(x, digits)
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  const body = m ? String.raw`${m[1]}\times10^{${Number(m[2])}}` : s
  return x < 0 ? `(${body})` : body
}

/** 放進 TeX 的「結果」數字：與 texNum 相同但負數不加括號（用在等號最右邊，例如 =-8）。 */
export function texRes(x: number, digits = 6): string {
  const s = texNum(x, digits)
  return s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s
}

/** 百分比字串，例如 0.503989 → '50.3989%'。 */
export function pct(x: number, digits = 6): string {
  return `${fmt(x * 100, digits)}%`
}

/** 有正負號的字串（+2、−1.2；用 Unicode minus 讓表格對齊好讀）。 */
export function signed(x: number, digits = 6): string {
  if (x === 0) return '0'
  const s = fmt(Math.abs(x), digits)
  return x > 0 ? `+${s}` : `−${s}`
}

/**
 * pole 行為的說明文字（`$…$` 為行內 TeX，由共用元件的 mathText / <MathText> 排版）。
 * 內容與 lms.ts 的 POLE_BEHAVIOUR_LABEL 相同，只是把數學改成 LaTeX（docs/teaching-style.md §3）；
 * 'frozen'（p = 1）在本章可能來自 μ = 0，也可能來自 x = 0，所以兩者都寫出來。
 */
export const POLE_BEHAVIOUR_TEX: Record<PoleBehaviour, string> = {
  monotone: String.raw`$0<p<1$：不變號、單調收斂`,
  oscillating: String.raw`$-1<p<0$：正負交替、震盪收斂`,
  deadbeat: String.raw`$p=0$：理想模型一步到答案`,
  boundary: String.raw`$|p|=1$：邊界，不保證收斂到 0`,
  divergent: String.raw`$|p|>1$：發散`,
  frozen: String.raw`$p=1$：完全不更新（$\mu=0$ 或 $x=0$）`,
}
