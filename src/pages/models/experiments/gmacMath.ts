/**
 * GMAC datapath 尺寸與截斷偏差（規格 §16.1 第 3、4、5 項；模型層級 L5）。本頁私有的純函式。
 *
 * ── 位元數 ──
 *   有號 B_x-bit code：x_int ∈ [−2^{B_x−1}, 2^{B_x−1} − 1]（full）或 [−(2^{B_x−1} − 1), 2^{B_x−1} − 1]（symmetric）。
 *   q = ±1 以「條件取負」實作，q·x_int 的範圍：
 *     full      ：[−2^{B_x−1}, +2^{B_x−1}]（−(−2^{B_x−1}) = +2^{B_x−1} 需要多一個 bit）
 *     symmetric ：[−(2^{B_x−1} − 1), 2^{B_x−1} − 1]
 *   N 筆總和 S 的最壞情況 |S| ≤ N·max|q·x|；有號 A-bit 暫存器範圍 [−2^{A−1}, 2^{A−1} − 1]。
 *
 * ── 平均（右移）與截斷 ──
 *   N = 2^L；保留 F_G 個小數 bit：ℓ = L − F_G，G_int = Q(S / 2^ℓ)，Ĝ = G_int·Δ_G，Δ_G = 2^{−F_G}/2^{B_x−1}（正規化 G 的 LSB）。
 *   ±A iid code、Gaussian comparator 雜訊時 S = A(2k − N)，k ~ Binomial(N, Φ(δ·x_n/σ_v))，x_n = A/2^{B_x−1}（精確）。
 *   E[Ĝ](δ) 對 δ 單調不減；E[Ĝ](δ*) = 0 給出含截斷的平衡點 δ* = a − w*。
 *
 * 不 import React；可在主執行緒即時計算（每次求值約 O(80·√N) 次乘加）。
 */
import { binomPmf, normCdf } from '@/simulation/core'

export type CodeRange = 'full' | 'symmetric'
export type ShiftRounding = 'floor' | 'half_up'

export const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)

function checkBx(bx: number): void {
  if (!Number.isInteger(bx) || bx < 2 || bx > 24) throw new Error(`$B_x$ 必須為 $2\\ldots24$ 的整數，收到 ${bx}`)
}

function checkN(N: number): void {
  if (!Number.isInteger(N) || N < 1 || N > 2 ** 24) throw new Error(`$N$ 必須為 $1\\ldots2^{24}$ 的整數，收到 ${N}`)
}

/** 有號 B_x-bit code 的整數範圍 [lo, hi] */
export function codeRange(bx: number, range: CodeRange): [number, number] {
  checkBx(bx)
  const half = 2 ** (bx - 1)
  return [range === 'full' ? -half : -(half - 1), half - 1]
}

/** q·x_int 的最大正值與最大負值的絕對值（條件取負之後） */
export function productExtremes(bx: number, range: CodeRange): { maxPos: number; maxNeg: number } {
  const half = 2 ** (bx - 1)
  // full：q = −1、x = −2^{B_x−1} ⇒ +2^{B_x−1}；q = +1、x = −2^{B_x−1} ⇒ −2^{B_x−1}
  return range === 'full' ? { maxPos: half, maxNeg: half } : { maxPos: half - 1, maxNeg: half - 1 }
}

/**
 * 最壞情況不溢位所需的最少有號位元數（精確）：最小的 A 使 2^{A−1} − 1 ≥ N·maxPos 且 2^{A−1} ≥ N·maxNeg。
 */
export function accBitsExact(bx: number, N: number, range: CodeRange): number {
  checkBx(bx)
  checkN(N)
  const { maxPos, maxNeg } = productExtremes(bx, range)
  const P = N * maxPos
  const M = N * maxNeg
  let A = 1
  while (2 ** (A - 1) - 1 < P || 2 ** (A - 1) < M) A++
  return A
}

/** 常見的經驗法則 B_x + ⌈log₂N⌉（對 symmetric code 足夠；full range 的條件取負會差 1 bit） */
export function accBitsRule(bx: number, N: number): number {
  checkBx(bx)
  checkN(N)
  return bx + Math.ceil(Math.log2(N) - 1e-12)
}

/** 二補數 wrap 到 bits-bit：((v + 2^{bits−1}) mod 2^bits) − 2^{bits−1} */
export function wrapTwos(v: number, bits: number): number {
  const half = 2 ** (bits - 1)
  const m = 2 * half
  return ((((v + half) % m) + m) % m) - half
}

/** 飽和到 bits-bit 二補數範圍 */
export function saturateTwos(v: number, bits: number): number {
  const half = 2 ** (bits - 1)
  return v > half - 1 ? half - 1 : v < -half ? -half : v
}

export interface WorstCaseRun {
  /** 數學上的正確總和 */
  exact: number
  /** accBits-bit 暫存器（逐筆 wrap）的結果 */
  wrapped: number
  /** 第一次發生 wrap 的筆數（1-based；沒有則 null） */
  firstOverflow: number | null
}

/**
 * Bit-true 最壞情況累加：N 筆都加上同一個最壞乘積（sign = +1 用 maxPos、−1 用 −maxNeg），每筆之後 wrap 到 accBits。
 * 例：B_x = 6 symmetric、N = 4096、17 bits ⇒ 31×4096 = 126976 wrap 成 −4096（符號翻轉）。
 */
export function worstCaseAccumulate(bx: number, N: number, range: CodeRange, accBits: number, sign: 1 | -1): WorstCaseRun {
  const { maxPos, maxNeg } = productExtremes(bx, range)
  const p = sign > 0 ? maxPos : -maxNeg
  let acc = 0
  let first: number | null = null
  for (let n = 1; n <= N; n++) {
    const raw = acc + p
    acc = wrapTwos(raw, accBits)
    if (first === null && acc !== raw) first = n
  }
  return { exact: N * p, wrapped: acc, firstOverflow: first }
}

/** 整數 v 右移 ℓ bits 後取整（ℓ ≤ 0 時不取整） */
export function shiftQuantize(v: number, ell: number, rounding: ShiftRounding): number {
  if (ell <= 0) return v * 2 ** -ell
  const d = 2 ** ell
  return rounding === 'floor' ? Math.floor(v / d) : Math.floor((v + d / 2) / d)
}

export interface TruncationSetup {
  /** code 位元數 B_x */
  bx: number
  /** N = 2^log2N */
  log2N: number
  /** 右移後保留的小數 bit F_G（≥ log2N 時不截斷） */
  gFracBits: number
  rounding: ShiftRounding
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
}

export interface TruncationDerived {
  N: number
  /** code 幅度 A = 2^{B_x−1} − 1（±A iid code） */
  A: number
  /** 正規化 code 幅度 x_n = A/2^{B_x−1} */
  xNorm: number
  Kq: number
  /** K = K_q·x_n² [fs⁻¹] */
  K: number
  /** 右移量 ℓ = log2N − F_G */
  ell: number
  /** 正規化 G 的 LSB Δ_G（ℓ ≤ 0 時為 S 的自然解析度 2A/(N·2^{B_x−1})） */
  deltaG: number
  /** 平衡附近 G 的標準差 x_n/√N */
  sigmaG: number
  /** σ_G / Δ_G：截斷前的「自然 dither」有多少 LSB */
  ditherLsb: number
}

export function truncationDerived(s: TruncationSetup): TruncationDerived {
  checkBx(s.bx)
  if (!Number.isInteger(s.log2N) || s.log2N < 0 || s.log2N > 20) throw new Error(`$\\log_2N$ 必須為 $0\\ldots20$ 的整數，收到 ${s.log2N}`)
  if (!Number.isInteger(s.gFracBits) || s.gFracBits < 0) throw new Error(`$F_G$ 必須為非負整數，收到 ${s.gFracBits}`)
  if (!(s.sigmaV > 0)) throw new Error('$\\sigma_v$ 必須大於 0（$\\sigma_v=0$ 時 $K_q$ 無定義）')
  const N = 2 ** s.log2N
  const half = 2 ** (s.bx - 1)
  const A = half - 1
  const xNorm = A / half
  const Kq = SQRT_2_OVER_PI / s.sigmaV
  const ell = s.log2N - s.gFracBits
  const deltaG = ell > 0 ? 2 ** -s.gFracBits / half : (2 * A) / (N * half)
  const sigmaG = xNorm / Math.sqrt(N)
  return { N, A, xNorm, Kq, K: Kq * xNorm * xNorm, ell, deltaG, sigmaG, ditherLsb: sigmaG / deltaG }
}

/**
 * E[Ĝ](δ)：截斷後的平均 GMAC 輸出（正規化 G 單位），對 k ~ Binomial(N, p) 求和；p = Φ(δ·x_n/σ_v)。
 * 只對平均 ±40σ 的範圍求和（以 mode 的 binomPmf 為起點，遞迴求鄰項），截掉的質量 < 1e−300。
 */
export function meanGhat(s: TruncationSetup, delta: number, d: TruncationDerived = truncationDerived(s)): number {
  const { N, A, ell } = d
  const half = 2 ** (s.bx - 1)
  const p = normCdf((delta * d.xNorm) / s.sigmaV)
  const q = (k: number): number => {
    const S = A * (2 * k - N)
    if (ell <= 0) return S / (N * half)
    return shiftQuantize(S, ell, s.rounding) * d.deltaG
  }
  if (p <= 0) return q(0)
  if (p >= 1) return q(N)
  const mode = Math.min(N, Math.max(0, Math.floor((N + 1) * p)))
  const sd = Math.sqrt(N * p * (1 - p))
  const lo = Math.max(0, Math.floor(mode - 40 * sd - 5))
  const hi = Math.min(N, Math.ceil(mode + 40 * sd + 5))
  const r = p / (1 - p)
  const pm = binomPmf(mode, N, p)
  let sum = pm * q(mode)
  let pk = pm
  for (let k = mode; k < hi; k++) {
    pk *= ((N - k) / (k + 1)) * r
    if (pk === 0) break
    sum += pk * q(k + 1)
  }
  pk = pm
  for (let k = mode; k > lo; k--) {
    pk *= (k / (N - k + 1)) / r
    if (pk === 0) break
    sum += pk * q(k - 1)
  }
  return sum
}

export interface TruncationEquilibrium {
  derived: TruncationDerived
  /** E[Ĝ] < −tol 的上界 δ_lo 與 E[Ĝ] > tol 的下界 δ_hi（fs）；兩者之間為平衡區（死區） */
  deltaLo: number
  deltaHi: number
  /** 平衡點（區間中點）δ* = a − w* [fs]；無平衡點時 NaN */
  deltaStar: number
  /** 死區寬度 δ_hi − δ_lo [fs] */
  deadZone: number
  /** δ = 0（w = a）時的平均 Ĝ（正規化） */
  meanAtTruth: number
  /** 近似公式：floor 時 Δ_G/(2K)、half_up 時 0（需 σ_G ≳ ½Δ_G） [fs] */
  approxDeltaStar: number
  hasEquilibrium: boolean
}

/**
 * 求含截斷的平衡點（bisection；E[Ĝ] 對 δ 單調不減）。tol = 1e−12·Δ_G：比這更小的平均更新在任何實際模擬長度內都看不到。
 */
export function truncationEquilibrium(s: TruncationSetup): TruncationEquilibrium {
  const d = truncationDerived(s)
  const tol = 1e-12 * d.deltaG
  const span = (12 * s.sigmaV) / d.xNorm
  const f = (x: number): number => meanGhat(s, x, d)
  const approx = d.ell <= 0 || s.rounding === 'half_up' ? 0 : d.deltaG / (2 * d.K)
  const fLo = f(-span)
  const fHi = f(span)
  const meanAtTruth = f(0)
  if (!(fLo < -tol) || !(fHi > tol)) {
    return { derived: d, deltaLo: NaN, deltaHi: NaN, deltaStar: NaN, deadZone: NaN, meanAtTruth, approxDeltaStar: approx, hasEquilibrium: false }
  }
  // δ_lo = sup{δ : f(δ) < −tol}
  let a = -span
  let b = span
  for (let i = 0; i < 80; i++) {
    const m = 0.5 * (a + b)
    if (f(m) < -tol) a = m
    else b = m
  }
  const deltaLo = a
  // δ_hi = inf{δ : f(δ) > tol}
  a = -span
  b = span
  for (let i = 0; i < 80; i++) {
    const m = 0.5 * (a + b)
    if (f(m) > tol) b = m
    else a = m
  }
  const deltaHi = b
  return {
    derived: d,
    deltaLo,
    deltaHi,
    deltaStar: 0.5 * (deltaLo + deltaHi),
    deadZone: Math.max(0, deltaHi - deltaLo),
    meanAtTruth,
    approxDeltaStar: approx,
    hasEquilibrium: true,
  }
}

/** 畫圖用：δ 格點上的 E[Ĝ]（floor、half_up）、無截斷的 E[G] = x_n(2p − 1) 與線性化 Kδ */
export function meanGhatCurves(
  s: Omit<TruncationSetup, 'rounding'>,
  deltas: number[],
): { floor: number[]; halfUp: number[]; ideal: number[]; linear: number[] } {
  const sf: TruncationSetup = { ...s, rounding: 'floor' }
  const sh: TruncationSetup = { ...s, rounding: 'half_up' }
  const d = truncationDerived(sf)
  return {
    floor: deltas.map((x) => meanGhat(sf, x, d)),
    halfUp: deltas.map((x) => meanGhat(sh, x, d)),
    ideal: deltas.map((x) => d.xNorm * (2 * normCdf((x * d.xNorm) / s.sigmaV) - 1)),
    linear: deltas.map((x) => d.K * x),
  }
}
