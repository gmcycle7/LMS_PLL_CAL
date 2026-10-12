import { texNum } from '@/components'

/**
 * Ch09「帶入手算」顯示用的小工具（純函式，不含任何模型公式；作法比照 src/chapters/ch00/handcalcTex.ts）。
 *
 * 使用者會打自己的數字，而且要「照畫面上的數字用計算機按」就得到下一個等號。三個會讓畫面與紙筆對不起來的來源：
 *  1. 浮點殘渣：(1 + (−1))/√2 在 double 裡可以是 1.1×10⁻¹⁶，手算是 0 —— snap() 把相對於運算元 1e-12 以下的差歸零。
 *  2. 固定 5 位有效數字：0.990025 被寫成 0.99003、使用者打的 62.6657 被寫成 62.666 —— tx() 對「寫得完」的十進位數
 *     （12 位以內去掉尾零後不超過 10 位：輸入值，以及它們的和、差、積、整數次方、除以 2 或 N）每一位都寫出來，
 *     更長的才四捨五入到 sig 位。√、ln、y^x、一般的商本來就寫不完：handcalcs.ts 對它們直接用 texNum(x, sig)。
 *  3. 相近的數相減：50.5 − 50.498 = 0.002，但答案是 0.0019792 —— sigSub() 讓運算元多顯示抵銷掉的那幾位；
 *     很接近 1 的 pole 要取 ln 時用 sigNear1()。
 * handcalcs.test.tsx 會把每一步的 TeX 重新求值，檢查每個等號前後的數字一致。
 */

/** 相對於運算元的大小，小於這個比例的差是 double 的捨入殘渣（紙筆算出來是 0） */
export const ROUNDOFF = 1e-12

/** 加減法的結果：若只是運算元的浮點殘渣（|value| ≤ 1e-12·max|運算元|）就回傳 0，否則原值。 */
export function snap(value: number, ...operands: number[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  return Math.abs(value) <= ROUNDOFF * scale ? 0 : value
}

/** 四捨五入到 12 位之後，還剩幾位有效數字（去掉尾零）：0.990025 → 6、1/3 → 12、0.30000000000000004 → 1。 */
export function decimalDigits(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return 1
  return Number(x.toPrecision(12)).toExponential().split('e')[0].replace(/[-.]/g, '').length
}

/**
 * 代入用的數字（TeX）：「寫得完」的十進位數完整顯示（不四捨五入），寫不完的數四捨五入到 sig 位（預設 5）。
 * |x| ≥ 1e6 或 < 1e-4 時用 a\times10^{b}（與 texNum 相同的慣例）。
 */
export function tx(x: number, sig = 5): string {
  return decimalDigits(x) <= 10 ? texNum(x, 12) : texNum(x, Math.min(sig, 15))
}

/** 加數、被減數用：負數加括號，例如 6-(-1.5)、3+(-1)。 */
export function txP(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.startsWith('-') ? `(${s})` : s
}

/** 乘數、次方的底數用：負數與科學記號都加括號，例如 2\times(-3)、(-0.3)^{3}、(5\times10^{-5})^2。 */
export function txF(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.startsWith('-') || s.includes('^') ? `(${s})` : s
}

/** 寫不完的數（商、√、ln、y^x）當加數、被減數：四捨五入到 sig 位，負數加括號。 */
export function rdP(x: number, sig = 5): string {
  const s = texNum(x, sig)
  return s.startsWith('-') ? `(${s})` : s
}

/** 寫不完的數當乘數、底數：四捨五入到 sig 位，負數與科學記號都加括號。 */
export function rdF(x: number, sig = 5): string {
  const s = texNum(x, sig)
  return s.startsWith('-') || s.includes('^') ? `(${s})` : s
}

/** (x, y) 的 TeX（每個分量用 tx） */
export function txVec(v: ArrayLike<number>, sig = 5): string {
  return `(${Array.from(v, (x) => tx(x, sig)).join(String.raw`,\ `)})`
}

/**
 * 加減法的運算元要顯示幾位，畫面上的「a − b = 結果」才對得起來：結果要保有 base 位有效數字，
 * 運算元就得寫到同一個小數位——也就是多顯示「最高位掉了幾位」那麼多位（50.5 − 50.498… = 0.0019792：掉 4 位 ⇒ 9 位）。
 * 沒有抵銷時就是 base；最多 14 位。只影響寫不完的數（寫得完的小數 tx() 本來就完整顯示）。
 */
export function sigSub(result: number, operands: number[], base = 5): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  const r = Math.abs(result)
  if (!Number.isFinite(scale) || !Number.isFinite(r) || r === 0 || scale === 0) return base
  const lost = Math.floor(Math.log10(scale)) - Math.floor(Math.log10(r))
  return Math.min(14, base + Math.max(0, lost))
}

/**
 * 很接近 ±1 的 pole 要取 ln：ln|p| ≈ −(1 − |p|)，所以 |p| 要顯示到「1 − |p| 還有 keep 位」為止。
 * 例：0.995 → 9 位（寫得完，顯示 0.995）；0.99996010577… → 11 位。
 */
export function sigNear1(p: number, keep = 7): number {
  const gap = Math.abs(1 - Math.abs(p))
  if (!(gap > 0) || gap >= 1) return keep
  return Math.min(15, keep + Math.floor(-Math.log10(gap)))
}

/**
 * 要寫成「a > b」的兩個很接近的數：從 sig 位起逐步增加位數，直到畫面上的兩個數字看得出不同為止
 * （1.0000007 與 1 用 5 位都顯示成 1，畫面會變成「1 > 1」）。最多 15 位。
 */
export function txDistinct(a: number, b: number, sig = 5): [string, string] {
  for (let k = sig; k < 15; k++) {
    const sa = texNum(a, k)
    const sb = texNum(b, k)
    if (sa !== sb) return [sa, sb]
  }
  return [texNum(a, 15), texNum(b, 15)]
}

/** 筆數、步數這類整數：每一位都寫出來（75091 不可顯示成 75091.0，也不用科學記號）。 */
export function txInt(k: number): string {
  return Number.isInteger(k) && Math.abs(k) < 1e15 ? String(k) : texNum(k, 12)
}

/**
 * ⌈r⌉ 裡的 r（r > 0）要顯示幾位：從 sig 位起逐步增加，直到「顯示出來的數字取上整」等於真正的答案 n 為止
 * （位數太少時 1200.00004 會被顯示成 1200，畫面變成 ⌈1200⌉ = 1201）。
 */
export function txCeilArg(r: number, n: number, sig = 7): string {
  if (!Number.isFinite(r)) return texNum(r)
  for (let k = sig; k <= 15; k++) {
    const shown = Number(r.toPrecision(k))
    if (Math.ceil(shown) === n || k === 15) return shown >= 1e-4 && shown < 1e15 ? String(shown) : texNum(shown, k)
  }
  return texNum(r, sig)
}
