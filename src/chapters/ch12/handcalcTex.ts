import { texNum } from '@/components'

/**
 * 第 12 章「帶入手算」顯示用的小工具（純函式，不含任何模型公式；作法比照 src/chapters/ch00/handcalcTex.ts）。
 *
 * 目的：畫面上每一個等號，都要能用「畫面上看得到的數字」按計算機重現。固定顯示 5 位有效數字做不到這件事：
 *  1. 中間值只留 5 位再往下乘除，答案的第 5 位就會差 1–4；
 *     → tx()：步驟裡的中間值顯示 6 位（比答案的 5 位多一位 guard digit），寫得完的數（輸入值、2 的冪次分之一…）完整顯示。
 *  2. 兩個很接近的數相減（p·δw − μσ_η、1 − p²、cosΩ − p）會吃掉有效位數；
 *     → sigFor()：運算元多顯示「被抵銷掉的位數」；txD()：三角函數與 dB 值改用固定的小數位數。
 *  3. 科學記號當乘數或底數（2×5×10⁶、10⁻⁵ 的平方）看不出分組，後者還是 KaTeX 的 double superscript 錯誤；
 *     → txM()：負數與含 ^ 的寫法一律加括號。
 */

/** 步驟中「寫不完」的中間值顯示幾位有效數字（答案框是 5 位） */
export const STEP_SIG = 6
/** 不超過這麼多位有效數字的數視為「寫得完」，完整顯示（976562.5、0.1953125、488.28125…） */
const EXACT_MAX = 10

/** 寫成十進位小數時用了幾位有效數字：117.045 → 6、0.1 → 1、1/3 → 16 或 17。 */
export function sigDigits(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 1
  return x
    .toExponential()
    .replace(/e.*$/, '')
    .replace(/[-.]/g, '').length
}

/**
 * 步驟裡的數字（TeX）：寫得完的值完整顯示（不四捨五入），寫不完的顯示 sig 位有效數字（預設 6）。
 * 先取 15 位去掉 double 的尾巴（0.1 + 0.2 → 0.3）；極大極小值沿用 texNum 的 a\times10^{b}。
 */
export function tx(x: number, sig = STEP_SIG): string {
  if (!Number.isFinite(x) || x === 0) return texNum(x, sig)
  const c = Number(x.toPrecision(15))
  return sigDigits(c) <= Math.max(sig, EXACT_MAX) ? texNum(c, 15) : texNum(x, sig)
}

/** 使用者輸入的值：打了幾位就顯示幾位（不四捨五入）。 */
export function txIn(x: number): string {
  return tx(x, 15)
}

/** 加數／被減數用：負數加括號，例如 0.99 - (-0.3)。 */
export function txP(x: number, sig = STEP_SIG): string {
  const s = tx(x, sig)
  return s.startsWith('-') ? `(${s})` : s
}

/** 乘數、底數用：負數與科學記號（含 ^）都加括號，例如 2\times(5\times10^{6})、(10^{-5})^2、(-0.3)^2。 */
export function txM(x: number, sig = STEP_SIG): string {
  const s = tx(x, sig)
  return s.startsWith('-') || s.includes('^') ? `(${s})` : s
}

/** 顯示到小數點後 dec 位時，x 有幾位有效數字（至少 1、至多 15）。 */
export function sigAtDecimals(x: number, dec: number): number {
  if (!Number.isFinite(x) || x === 0) return 1
  return Math.min(15, Math.max(1, Math.floor(Math.log10(Math.abs(x))) + 1 + dec))
}

/** 以 sig 位有效數字顯示 x 時，小數點後有幾位（至少 0）。 */
export function decimalsAt(x: number, sig = STEP_SIG): number {
  if (!Number.isFinite(x) || x === 0) return sig
  return Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(x))))
}

/** 固定小數位數（三角函數值、弧度、dB、log）：四捨五入到小數點後 dec 位。 */
export function txD(x: number, dec: number): string {
  if (!Number.isFinite(x)) return texNum(x)
  const r = Number(x.toFixed(dec))
  return r === 0 ? '0' : texNum(r, sigAtDecimals(r, dec))
}

/** txD 的乘數／底數版：負數與科學記號（含 ^）都加括號。 */
export function txDM(x: number, dec: number): string {
  const s = txD(x, dec)
  return s.startsWith('-') || s.includes('^') ? `(${s})` : s
}

/**
 * 加減法的運算元要顯示幾位有效數字，畫面上的「a − b = 結果」才對得起來：
 * STEP_SIG + 被抵銷掉的位數（運算元比結果大 2 倍以上才開始加；至多 13）。沒有抵銷時就是 STEP_SIG。
 * 例：0.9202115 × 0.15625 − 0.15625 = −0.0124669 —— 運算元是結果的 12.5 倍 ⇒ 乘積要寫 7 位（0.1437831）。
 */
export function sigFor(result: number, ...operands: number[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  const r = Math.abs(result)
  if (!Number.isFinite(scale) || !Number.isFinite(r) || r === 0 || !(scale > r)) return STEP_SIG
  return Math.min(13, STEP_SIG + Math.max(0, Math.ceil(Math.log10(scale / r) - 0.3)))
}
