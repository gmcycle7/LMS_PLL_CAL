import { texNum } from '@/components'

/**
 * Ch02「帶入手算」顯示用的小工具（純函式，不含任何模型公式；全部建立在共用的 texNum 上）。
 *
 * 手算題讓讀者打「自己的數字」，畫面上每一步是「符號式 = 代入數字 = 中間結果 = 結果」。
 * 只用 texNum(x, 5) 會有三個毛病，這裡各有一個對應的工具：
 *
 *  1. 寫得完的小數被四捨五入：3.5 + (−0.40625) 紙筆算是 3.09375，不該顯示成 3.0938。
 *     ⇒ tx()：10 位有效數字內寫得完的數（輸入值、它們的和／差／積）整個寫出；寫不完的（商、√、ln、eˣ）才四捨五入。
 *  2. 兩個接近的數相減會吃掉有效位數：11 − 2.6667×4 用畫面上的數字算是 0.3332，不是 0.33333。
 *     ⇒ sigFor()：運算元多顯示幾位，讓「a − b = 結果」照畫面上的數字按計算機就對得起來。
 *  3. 負數、科學記號直接接在 × 或 ^2 後面會讀錯（−0.3^2）甚至讓 KaTeX 報錯（5\times10^{-5}^2）。
 *     ⇒ txP()（加數／乘數）、txSq()（平方的底數）自動加括號。
 *
 * handcalcs.test.tsx 會把每一步的 TeX 重新求值，檢查每個等號兩邊的數字一致。
 */

/** 去掉 IEEE double 的尾巴：四捨五入到 14 位有效數字（0.30000000000000004 → 0.3、0.19999999999999973 → 0.2）。 */
const clean = (x: number): number => Number(x.toPrecision(14))

/** x（去掉 double 尾巴後）的最短十進位表示有幾位有效數字。寫不完的數（1/3、√2、ln 4）會得到 14。 */
export function sigDigits(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 1
  return clean(x).toExponential().split('e')[0].replace(/[-.]/g, '').length
}

/** 寫得完的小數：10 位有效數字以內就寫完（輸入值，以及它們的和、差、積多半如此）。 */
export const isShort = (x: number): boolean => sigDigits(x) <= 10

/**
 * 代入用的數字（TeX）：寫得完的小數整個寫出，寫不完的四捨五入到 sig 位（預設 5、最多 12）。
 */
export function tx(x: number, sig = 5): string {
  if (!Number.isFinite(x)) return texNum(x)
  return isShort(x) ? texNum(clean(x), 12) : texNum(x, Math.max(1, Math.min(sig, 12)))
}

/** 加數、乘數：負數與 a\times10^{b} 加括號，例如 2\times(-3)、6-(-1.5)、0.1\times(5\times10^{-5})。 */
export function txP(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.startsWith('-') || s.includes('\\times') ? `(${s})` : s
}

/** x²：底數是負數或科學記號時加括號，例如 (-0.3)^2、(5\times10^{-5})^2。 */
export function txSq(x: number, sig = 5): string {
  const s = tx(x, sig)
  return `${s.startsWith('-') || s.includes('^') ? `(${s})` : s}^2`
}

/** 要讓 x 保有 sig 位有效數字，得寫到小數點後第幾位（可以是負的：12345 的第 3 位有效數字在百位）。 */
export function decimalsFor(x: number, sig = 5): number {
  if (!Number.isFinite(x) || x === 0) return sig
  return sig - 1 - Math.floor(Math.log10(Math.abs(x)))
}

/** 把 x 寫到小數點後 decimals 位需要幾位有效數字（至少 1、最多 15）。 */
export function sigAt(x: number, decimals: number): number {
  if (!Number.isFinite(x) || x === 0) return 1
  return Math.max(1, Math.min(15, decimals + 1 + Math.floor(Math.log10(Math.abs(x)))))
}

/**
 * 加減法的運算元要顯示幾位有效數字，「a ± b = 結果」才會照畫面上的數字算得出來：
 * 結果要保有 5 位有效數字 ⇒ 每個運算元都要寫到和結果同一個小數位（沒有抵銷時就是 5 位；最多 15，那是 double 的極限）。
 * 例：11 − 10.666… = 0.33333 ⇒ 10.666… 要寫 7 位（10.66667）。結果剛好是 0 時回傳 5。
 * 只影響寫不完的數；寫得完的數 tx() 本來就完整顯示。
 */
export function sigFor(result: number, ...operands: number[]): number {
  if (!Number.isFinite(result) || result === 0) return 5
  const d = decimalsFor(result, 5)
  let k = 5
  for (const o of operands) if (Number.isFinite(o) && o !== 0) k = Math.max(k, sigAt(o, d))
  return k
}

/** 步數、筆數這類整數：每一位都寫出來（123457 不顯示成 123460）。 */
export function txInt(k: number): string {
  return Number.isInteger(k) && Math.abs(k) < 1e9 ? String(k) : texNum(k, 12)
}

/**
 * ⌊r⌋／⌈r⌉ 裡的 r 要顯示幾位有效數字：位數太少時 12.99996 會被寫成 13，畫面變成「⌊13⌋ = 12」。
 * 從 5 位起逐步增加，直到「畫面上的數字取整」等於真正的答案 n 為止（最多 12 位）。
 */
export function sigRoundArg(r: number, n: number, mode: 'floor' | 'ceil'): number {
  if (!Number.isFinite(r) || isShort(r)) return 5
  const round = mode === 'floor' ? Math.floor : Math.ceil
  for (let sig = 5; sig < 12; sig++) if (round(Number(r.toPrecision(sig))) === n) return sig
  return 12
}

/** ⌊r⌋／⌈r⌉ 裡的 r（TeX）。 */
export function txRoundArg(r: number, n: number, mode: 'floor' | 'ceil'): string {
  return tx(r, sigRoundArg(r, n, mode))
}

/** 答案框要顯示幾位：寫得完的小數整個寫出（至少 5 位），寫不完的 5 位。 */
export function resultDigits(x: number): number {
  return isShort(x) ? Math.max(5, sigDigits(x)) : 5
}
