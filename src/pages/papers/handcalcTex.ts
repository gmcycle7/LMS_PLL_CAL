import { texNum } from '@/components'

/**
 * Papers / Reading 頁「帶入手算」題顯示用的小工具（純函式，不含任何模型公式）。
 *
 * 手算題的重點是讓讀者打「自己的數字」。共用的 texNum 固定顯示 5 位有效數字，這時有三件事會讓畫面上的算式
 * 和紙筆算出來的對不起來，集中在這裡處理（做法與 Ch00 的手算題相同，這裡是本頁自己的一份）：
 *  1. 四捨五入：讀者打的 0.123456 若被顯示成 0.12346，下一步的乘法就和畫面上的數字不一致。
 *     → tx()：寫得完的小數（12 位以內：輸入值，以及它們的和、差、積）完整顯示；寫不完的（除不盡、√、sin、ln）才取 sig 位。
 *     → sigFor()：兩個很接近的數相減時，自動多顯示幾位（90 − 102.437 不可寫成 90 − 102.44 = −12.437）。
 *  2. 浮點殘渣：6 − 1.8×2 之類在 double 裡可能留下 1e-16，但手算是整齊的數字。
 *     → snap()：把相對於運算元只有 1e-12 以下的「差」當成 0；clean()：把加減的結果四捨五入到運算元大小的 1e-13。
 *  3. 負數與科學記號當底數：-0.4^2 會被讀成 −(0.4²)，5\times10^{-5}^2 是 KaTeX 的 double superscript 錯誤。
 *     → txSq()：負數與科學記號一律加括號。
 */

/** 相對於運算元的大小，小於這個比例的「差」視為 double 的捨入殘渣。 */
export const ROUNDOFF = 1e-12

/** 加減法的結果若只是捨入殘渣（|v| ≤ 1e-12·max|運算元|），回傳 0；否則原樣回傳。 */
export function snap(v: number, ...operands: number[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  return Math.abs(v) <= ROUNDOFF * scale ? 0 : v
}

/**
 * 加減法的結果去掉 double 的捨入殘渣：四捨五入到「運算元大小的 1e-13」那一位。
 * 例：63 − 62.999 在 double 裡是 0.000999999999997669，手算是 0.001；32.4 − 32 是 0.3999999999999986，手算是 0.4。
 * （不能只看結果自己的有效位數：殘渣的大小取決於運算元 63，不是結果 0.001。）
 * operands 傳這次加減的各個運算元；乘除的結果不需要經過這裡（tx() 會處理它自己的最後一兩位）。
 */
export function clean(v: number, ...operands: number[]): number {
  let scale = Math.abs(v)
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  if (!Number.isFinite(v) || !Number.isFinite(scale) || scale === 0) return v
  const decimals = Math.min(100, Math.max(0, 13 - Math.ceil(Math.log10(scale))))
  return Number(v.toFixed(decimals))
}

/** 寫成十進位小數時用了幾位有效數字：117.045 → 6、0.1 → 1、1/3 → 16 或 17。 */
export function sigDigits(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 1
  return x
    .toExponential()
    .replace(/e.*$/, '')
    .replace(/[-.]/g, '').length
}

/**
 * 代入用的數字（TeX）。「寫得完」的值完整顯示（不四捨五入），寫不完的顯示 sig 位有效數字（預設 5）：
 *  - 去掉 double 的最後一兩位（15 位有效數字）後不超過 12 位 → 完整顯示；
 *  - 其餘（除不盡、√、sin、ln）→ sig 位。
 * 極大極小值沿用 texNum 的 a\times10^{b}。
 */
export function tx(x: number, sig = 5): string {
  if (!Number.isFinite(x) || x === 0) return texNum(x, sig)
  const c15 = Number(x.toPrecision(15))
  if (sigDigits(c15) <= 12) return texNum(c15, 15)
  return texNum(x, sig)
}

/** 乘數、加數用：負數加括號，例如 2\times(-3)、6 - (-1.5)。 */
export function txP(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.startsWith('-') ? `(${s})` : s
}

/** x²：負數與科學記號的底數自動加括號，例如 (-0.4)^2。 */
export function txSq(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.startsWith('-') || s.includes('^') ? `(${s})^2` : `${s}^2`
}

/** 整數（步數、code、sample 數）：每一位都寫出來，不取 5 位有效數字，也不用科學記號。 */
export function txInt(k: number): string {
  return Number.isInteger(k) && Math.abs(k) < 1e15 ? String(k) : texNum(k, 12)
}

/**
 * 加減法的運算元要顯示幾位有效數字，畫面上的「a − b = 結果」才對得起來：
 * 讓「結果」仍保有 5 位有效數字所需的位數（最多 15）；沒有抵銷時就是 5。只影響「寫不完」的數。
 */
export function sigFor(result: number, ...operands: number[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  const r = Math.abs(result)
  if (!Number.isFinite(scale) || !Number.isFinite(r)) return 5
  if (r === 0) return scale > 0 ? 12 : 5
  if (!(scale > r)) return 5
  return Math.min(15, 5 + Math.ceil(Math.log10(scale / r)))
}

/**
 * ⌈r⌉ 裡的 r（r ≥ 0）要顯示幾位：位數太少時 597.99996 會被顯示成 598，畫面變成「⌈598⌉ = 598」還好，
 * 但 598.00004 顯示成 598 就會變成「⌈598⌉ = 599」。從 5 位起逐步增加，直到顯示出來的數字取上整等於真正的答案 n。
 */
export function txCeilArg(r: number, n: number): string {
  if (!Number.isFinite(r)) return texNum(r)
  for (let sig = 5; sig <= 15; sig++) {
    const shown = Number(r.toPrecision(sig))
    if (Math.max(1, Math.ceil(shown)) === n || sig === 15) return shown >= 1e-4 && shown < 1e15 ? String(shown) : texNum(shown, sig)
  }
  return texNum(r)
}
