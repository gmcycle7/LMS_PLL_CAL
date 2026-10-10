import { texNum } from '@/components'

/**
 * 「帶入手算」顯示用的小工具（純函式，不含任何模型公式）。
 *
 * 這個元件的重點是讓使用者打「自己的數字」。這時 double 與「固定顯示 5 位有效數字」會讓畫面上的算式
 * 和紙筆算出來的對不起來：
 *
 *  1. 浮點殘渣：0.1225 − 0.35×0.35 在 double 裡是 1.4e-17，手算是 0；sign(1.4e-17) = +1 更是完全錯誤。
 *  2. 四捨五入：使用者打的 15.509967 被顯示成 15.51；117.045 − 108.045 被顯示成 117.05 − 108.04（= 9.01，但答案是 9）。
 *  3. 科學記號當底數：5\times10^{-5}^2 是 KaTeX 的 double superscript 錯誤；-0.3^2 會被讀成 −(0.3²)。
 *
 * 做法：手算題裡「加、減、乘」的那一段，用精確的十進位數 Dec（BigInt）再算一次——人用紙筆算有限小數，
 * 得到的就是這個數，沒有任何捨入。畫面上每一步的數字來自 Dec；答案（results）仍然是模擬函式的回傳值，
 * 測試會逐一比對兩者一致。除法、√、ln 的結果寫不完，維持 double，四捨五入到 5 位顯示。
 *
 *  - tx()：Dec 在 10 位有效數字以內（或是使用者輸入的數）完整顯示；更長的才四捨五入到 sig 位。
 *  - sigFor()：兩個很接近的數相減時，運算元自動多顯示幾位，讓「a − b = 結果」在畫面上算得出來。
 *  - txP()／txBase()／txSq()／txPow()：負數與科學記號在需要的地方加括號。
 */

const DEC_RE = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i

const big10 = (k: number): bigint => 10n ** BigInt(k)
const bigAbs = (v: bigint): bigint => (v < 0n ? -v : v)

/** 精確的十進位數：值 = n × 10^(−dp)。加、減、乘、整數次方都沒有捨入誤差。 */
export class Dec {
  private constructor(
    /** 整數部分（BigInt）；dp > 0 時不以 0 結尾 */
    readonly n: bigint,
    /** 小數位數 */
    readonly dp: number,
    /** 使用者輸入的數（顯示時永遠照原樣寫出） */
    readonly given: boolean,
  ) {}

  private static norm(n: bigint, dp: number, given = false): Dec {
    while (dp > 0 && n % 10n === 0n) {
      n /= 10n
      dp--
    }
    return new Dec(n, dp, given)
  }

  /** 使用者輸入的數字：double 的最短十進位表示，就是他打的那串數字（0.1 → 1/10，不是 0.1000000000000000055…）。 */
  static of(x: number): Dec {
    const m = Number.isFinite(x) ? DEC_RE.exec(String(x)) : null
    if (!m) throw new Error(`不是有限的數字：${x}`)
    const frac = m[3] ?? ''
    const exp = Number(m[4] ?? 0) - frac.length
    const mag = BigInt((m[2] || '0') + frac)
    const n = m[1] === '-' ? -mag : mag
    return exp >= 0 ? Dec.norm(n * big10(exp), 0, true) : Dec.norm(n, -exp, true)
  }

  add(o: Dec): Dec {
    const dp = Math.max(this.dp, o.dp)
    return Dec.norm(this.n * big10(dp - this.dp) + o.n * big10(dp - o.dp), dp)
  }

  neg(): Dec {
    return new Dec(-this.n, this.dp, this.given)
  }

  sub(o: Dec): Dec {
    return this.add(o.neg())
  }

  mul(o: Dec): Dec {
    return Dec.norm(this.n * o.n, this.dp + o.dp)
  }

  /** 整數次方（k ≥ 0）。 */
  pow(k: number): Dec {
    return Dec.norm(this.n ** BigInt(k), this.dp * k)
  }

  get isZero(): boolean {
    return this.n === 0n
  }

  /** +1、−1 或 0（精確：不會被 1e-17 的殘渣騙到）。 */
  get sign(): number {
    return this.n > 0n ? 1 : this.n < 0n ? -1 : 0
  }

  /** 有效數字的個數：117.045 → 6、1200 → 2、0 → 1。 */
  get digits(): number {
    return bigAbs(this.n).toString().replace(/0+$/, '').length || 1
  }

  /** 最高位數字的十進位指數：123.4 → 2、0.00056 → −4。 */
  get exponent(): number {
    return bigAbs(this.n).toString().length - 1 - this.dp
  }

  /** 四捨五入到 sig 位有效數字（結果仍是精確的十進位數）。 */
  round(sig: number): Dec {
    const len = bigAbs(this.n).toString().length
    const drop = len - sig
    if (drop <= 0 || this.isZero) return this
    const q = (bigAbs(this.n) + 5n * big10(drop - 1)) / big10(drop)
    const m = this.n < 0n ? -q : q
    const dp = this.dp - drop
    return dp >= 0 ? Dec.norm(m, dp) : Dec.norm(m * big10(-dp), 0)
  }

  /** 一般的小數寫法，例如 '-0.001225'。 */
  toString(): string {
    const s = bigAbs(this.n).toString().padStart(this.dp + 1, '0')
    const body = this.dp === 0 ? s : `${s.slice(0, s.length - this.dp)}.${s.slice(s.length - this.dp)}`
    return this.n < 0n ? `-${body}` : body
  }

  /** 最接近的 double（交給模擬函式、或和模擬的結果比較時用）。 */
  toNumber(): number {
    return Number(this.toString())
  }
}

/** 可以放進算式的數：精確的十進位數，或寫不完的 double（商、√、ln）。 */
export type Num = Dec | number

/** 取出 double 值。 */
export const val = (a: Num): number => (typeof a === 'number' ? a : a.toNumber())

/** 精確十進位數的 TeX：每一位都寫出來；|x| ≥ 1e6 或 < 1e-4 時用 a\times10^{b}（與 texNum 相同的慣例）。 */
function decTex(d: Dec): string {
  if (d.isZero) return '0'
  const e = d.exponent
  if (e >= -4 && e < 6) return d.toString()
  const s = bigAbs(d.n).toString().replace(/0+$/, '')
  const mant = s.length > 1 ? `${s[0]}.${s.slice(1)}` : s
  const sign = d.n < 0n ? '-' : ''
  return mant === '1' ? `${sign}10^{${e}}` : `${sign}${mant}\\times10^{${e}}`
}

/**
 * 代入用的數字（TeX）。
 *  - Dec：使用者輸入的數、以及 10 位有效數字以內的數完整顯示（不四捨五入）；更長的四捨五入到 sig 位（預設 5）。
 *  - double（除不盡、√、ln）：四捨五入到 sig 位。
 */
export function tx(a: Num, sig = 5): string {
  if (typeof a === 'number') return texNum(a, Math.min(sig, 15))
  return decTex(a.given || a.digits <= 10 ? a : a.round(sig))
}

/** 乘數、加數用：負數加括號，例如 2\times(-3)、6 - (-1.5)。 */
export function txP(a: Num, sig = 5): string {
  const s = tx(a, sig)
  return s.startsWith('-') ? `(${s})` : s
}

/** 底數用：負數與科學記號都加括號，例如 (-0.3)^{3}、(5\times10^{-5})^2。 */
export function txBase(a: Num, sig = 5): string {
  const s = tx(a, sig)
  return s.startsWith('-') || s.includes('^') ? `(${s})` : s
}

/** x²：底數自動加括號。 */
export function txSq(a: Num, sig = 5): string {
  return `${txBase(a, sig)}^2`
}

/** xⁿ：底數自動加括號。 */
export function txPow(a: Num, n: number, sig = 5): string {
  return `${txBase(a, sig)}^{${n}}`
}

/**
 * 加減法的運算元要顯示幾位有效數字，畫面上的「a − b = 結果」才對得起來：
 * 讓「結果」本身仍保有 5 位有效數字所需的位數（沒有抵銷時就是 5）。
 * 結果剛好是 0（完全抵銷）時，運算元要完整寫出，才看得出它們相等（回傳 FULL）。
 * 只影響「寫不完」或超過 10 位的數；10 位以內的 Dec 本來就完整顯示。
 */
export function sigFor(result: Num, ...operands: Num[]): number {
  let scale = 0
  for (const o of operands) scale = Math.max(scale, Math.abs(val(o)))
  const r = Math.abs(val(result))
  if (!Number.isFinite(scale) || !Number.isFinite(r)) return 5
  if (r === 0) return scale > 0 ? FULL : 5
  if (!(scale > r)) return 5
  return 5 + Math.ceil(Math.log10(scale / r))
}

/** tx() 的 sig 傳這個值 = 每一位都寫出來（Dec 不四捨五入；double 最多 15 位）。 */
export const FULL = 99

/**
 * 連乘、相除之後還要保有 keep 位有效數字時，每個運算元要顯示幾位：
 * 例如 p 連乘 20 次，p 顯示 5 位會讓結果只剩 3–4 位可信；商要取上整時，整數部分的每一位都要對。
 */
export function sigKeep(keep: number): number {
  return Math.max(5, Math.min(15, Math.ceil(keep)))
}

/** 筆數、步數這類整數：每一位都寫出來（123457 不可顯示成 123460，也不用科學記號）。 */
export function txInt(k: number): string {
  return Number.isInteger(k) && Math.abs(k) < 1e15 ? String(k) : texNum(k, 12)
}

/**
 * ⌈r⌉ 裡的 r（r ≥ 0）要顯示幾位：位數太少時 1200.00004 會被顯示成 1200，畫面變成「⌈1200⌉ = 1201」。
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

/** 相對於 1 的大小，小於這個比例的「距離邊界的差」double 已無法可靠分辨（用在 |p| 是否小於 1 的判斷）。 */
export const ROUNDOFF = 1e-12
