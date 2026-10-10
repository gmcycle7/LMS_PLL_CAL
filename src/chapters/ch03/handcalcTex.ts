import { texNum } from '@/components'

/**
 * 「帶入手算」顯示用的小工具（純函式，不含任何模型公式；約定與 ch00/handcalcTex.ts 相同）。
 *
 * 共用的 texNum 固定顯示 5 位有效數字，對範例數字剛好；但手算題的重點是讓讀者打「自己的數字」，
 * 這時有四件事會讓畫面上的算式和紙筆算出來的對不起來（獨立驗算時實際遇到），集中在這裡處理：
 *
 *  1. 四捨五入：$g=1.05625$ 若顯示成 $1.0562$，下一步的 $\ln 1.0562$ 就和畫面上的答案差到第 3 位。
 *     → tx()：寫得完的小數（12 位以內：輸入值，以及它們的和、差、積）完整顯示；寫不完的（除不盡、√、ln）才取 5 位。
 *  2. 相近的數相減／很接近 1 的數取 ln：$\mu=10^{-6}$ 時 $p=0.999999$ 不可顯示成 1（否則畫面變成「$\ln 1=-10^{-6}$」）。
 *     → sigFor()／sigForN()：加減法的運算元自動多顯示幾位；sigLn()：ln 的引數要顯示幾位；sigPow()：底數要顯示幾位。
 *  3. 浮點殘渣：$0.3-0.30000000000000004$ 在 double 裡是 $-5.6\times10^{-17}$，手算是 0。
 *     → snap()：把相對於運算元只有 $10^{-12}$ 以下的「差」當成 0。
 *  4. 科學記號當底數或 ln 的引數：`10^{-5}^2` 是 KaTeX 的 double superscript 錯誤，`\ln 5\times10^{11}` 則有歧義。
 *     → txBase()／txSq()／txPow()／txLn()：負數與科學記號一律加括號。
 */

/** 相對於運算元的大小，小於這個比例的「差」視為 double 的捨入殘渣（剛好在 tx() 完整顯示的 12 位之外）。 */
export const ROUNDOFF = 1e-12

/**
 * 加減法的結果若只是捨入殘渣（|v| ≤ 1e-12·max|運算元|），回傳 0；否則原樣回傳。
 * operands 傳這次加減的各個運算元（它們的大小決定 double 能分辨的最小差）。
 */
export function snap(v: number, ...operands: number[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  return Math.abs(v) <= ROUNDOFF * scale ? 0 : v
}

/**
 * 模擬值 v 與「手算應得的值」exact 若只差 double 的捨入誤差（≤ 1e-12·max|運算元|），回傳 exact；否則原樣回傳 v。
 * snap() 是 exact = 0 的特例。用在「LMS 程式實際迭代出來的 δ_n = a − w_n」與「一次乘法 p·δ_{n−1}」應該相等的地方：
 * a − w_n 是兩個相近的數相減（δ 很小時只剩幾位有效數字），畫面上顯示乾淨的那個值；兩者真的不相等時（程式有錯）
 * 顯示模擬值，讓「每一步的 TeX 重新求值」的測試抓到。
 */
export function agree(v: number, exact: number, ...operands: number[]): number {
  let scale = Math.abs(exact)
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  return Math.abs(v - exact) <= ROUNDOFF * scale ? exact : v
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
 *  - 去掉 double 的最後一兩位（取 15 位有效數字）後不超過 12 位 → 完整顯示：使用者輸入的小數，以及它們的和、差、積；
 *  - 其餘（除不盡、√、ln、次方）→ sig 位。
 * 極大極小值沿用 texNum 的 a\times10^{b}。只想「四捨五入到幾位」的地方（次方的結果、說明文字裡的比值）請直接用 texNum。
 */
export function tx(x: number, sig = 5): string {
  if (!Number.isFinite(x) || x === 0) return texNum(x, sig)
  const c15 = Number(x.toPrecision(15))
  return sigDigits(c15) <= 12 ? texNum(c15, 15) : texNum(x, sig)
}

/** 乘數、加數用：負數加括號，例如 2\times(-3)、6 - (-1.5)。 */
export function txP(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.startsWith('-') ? `(${s})` : s
}

/** 底數用：負數與科學記號都加括號，例如 (-0.3)^{3}、(5\times10^{-5})^2。 */
export function txBase(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.startsWith('-') || s.includes('^') ? `(${s})` : s
}

/** x²：底數自動加括號。 */
export function txSq(x: number, sig = 5): string {
  return `${txBase(x, sig)}^2`
}

/** xⁿ：底數自動加括號。 */
export function txPow(x: number, n: number, sig = 5): string {
  return `${txBase(x, sig)}^{${n}}`
}

/** \ln 的引數（x > 0）：科學記號加括號，例如 \ln 0.6、\ln(5\times10^{11})。回傳含 \ln 的整段 TeX。 */
export function txLn(x: number, sig = 5): string {
  const s = tx(x, sig)
  return s.includes('^') ? String.raw`\ln(${s})` : String.raw`\ln ${s}`
}

/**
 * 加減法的運算元要顯示幾位有效數字，畫面上的「a − b = 結果」才對得起來：
 * 讓「結果」本身仍保有 resSig 位有效數字所需的位數（最多 15，double 的極限）；沒有抵銷時就是 resSig。
 * 結果剛好是 0（完全抵銷，或被 snap() 歸零）時回傳 12：兩個運算元要顯示到看得出「它們相等」。
 * 只影響「寫不完」的數；寫得完的數 tx() 本來就完整顯示。
 */
export function sigForN(resSig: number, result: number, ...operands: number[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(o))
  const r = Math.abs(result)
  if (!Number.isFinite(scale) || !Number.isFinite(r)) return resSig
  if (r === 0) return scale > 0 ? 12 : resSig
  if (!(scale > r)) return resSig
  return Math.min(15, resSig + Math.ceil(Math.log10(scale / r)))
}

/** sigForN 的常用情況：結果顯示 5 位有效數字。 */
export function sigFor(result: number, ...operands: number[]): number {
  return sigForN(5, result, ...operands)
}

/**
 * ln 的引數 x（> 0）要顯示幾位，按畫面上的數字算出來的 ln x 才有 5 位有效數字：
 * d(ln x) = dx/x，所以 |ln x| 越小（x 越接近 1）要越多位：x = 0.999999 需要 11 位。|ln x| ≥ 1 時 5 位就夠。
 */
export function sigLn(x: number): number {
  const l = Math.abs(Math.log(Math.abs(x)))
  if (!(l > 0) || !Number.isFinite(l) || l >= 1) return 5
  return Math.min(15, 5 + Math.ceil(-Math.log10(l)))
}

/** 底數要顯示幾位，按畫面上的數字算出來的 xⁿ 才有 5 位有效數字（相對誤差放大 n 倍）。 */
export function sigPow(n: number): number {
  return Math.min(15, 5 + Math.ceil(Math.log10(Math.max(1, Math.abs(n)))))
}

/** 筆數、步數這類整數：每一位都寫出來（123457 不可顯示成 123460，也不用科學記號）。 */
export function txInt(k: number): string {
  return Number.isInteger(k) && Math.abs(k) < 1e15 ? String(k) : texNum(k, 12)
}

/** 固定小數位（查表用：z 與 Φ(z) 都寫到小數 4 位）；−0 顯示成 0。 */
export function txFixed(x: number, decimals: number): string {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e6) return texNum(x, 10)
  const v = Number(x.toFixed(decimals))
  if (v === 0) return '0'
  const s = v.toFixed(decimals)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * ⌈r⌉ 裡的 r（r ≥ 0）要顯示幾位：位數太少時 100.0002 會被顯示成 100，畫面變成「⌈100⌉ = 101」。
 * 從 5 位起逐步增加，直到「顯示出來的數字取上整（至少 1）」等於真正的答案 n 為止。
 */
export function txCeilArg(r: number, n: number): string {
  if (!Number.isFinite(r)) return texNum(r)
  for (let sig = 5; sig <= 15; sig++) {
    const shown = Number(r.toPrecision(sig))
    if (Math.max(1, Math.ceil(shown)) === n || sig === 15) return shown >= 1e-4 && shown < 1e15 ? String(shown) : texNum(shown, sig)
  }
  return texNum(r)
}
