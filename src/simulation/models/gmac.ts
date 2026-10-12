/**
 * GMAC（Gradient Multiply-ACcumulate）的浮點與位元級（bit-true）參考模型（規格 §4.2、§16.1 第 1–8 項；模型層級 L1 / L5）。
 * Ch04 專用；頁面以 `?raw` + `#region core:*` 直接顯示這些程式碼。
 *
 * ── 浮點參考（勘誤 E07 / E18：總和寫成 S、平均寫成 G）──
 *   S_k = Σ_{n∈block k} q[n]·x_ref[n]
 *   G_k = S_k / N                         （average；§0 的定義）
 *   w_{k+1} = w_k + μ·G_k（average）或 w_k + μ·S_k（sum ⇒ 同一個 μ 時有效 loop gain ×N）
 *
 * ── 位元級 GMAC datapath（§4.2 RTL 資料流）──
 *   x_int ∈ [−2^{B_x−1}, 2^{B_x−1}−1]（'full'）或 [−(2^{B_x−1}−1), 2^{B_x−1}−1]（'symmetric'）
 *   b = (e ≥ 0)（tie ⇒ +1，E07）；q = 2b − 1；q·x 以「條件取負」實作（~x + 1，XOR + carry-in），不用乘法器
 *   S 累加於 B_acc-bit 二補數暫存器（overflow：wrap 或 saturate）
 *   average：G_int = round_ℓ(S)，ℓ = log2 N − F_G（算術右移 ℓ bits，保留 F_G 個小數位元）
 *   W ← W + Q_W(μ·G)（G 換回正規化單位；Q_W：更新量取整到 W 的 LSB Δ_W，wLsb = 0 時 W 為浮點、不取整）
 *   W 有內部暫存器範圍與實體（DTC 可實現）範圍：saturation / anti-windup
 *
 * ── 單位（勘誤 E13）── 時間 fs；正規化 code x = x_int / 2^{B_x−1} ∈ [−1, 1)（無因次）；
 *   a、w：fs per full-scale code；μ：fs（average 模式的意義）；K_q = √(2/π)/σ_v [fs⁻¹]；g = μK 無因次。
 *
 * 隨機性：root = createRng(seed)；code 用 root.fork('code')，comparator noise 用 root.fork('comparator-noise')。
 * 定點與浮點迴路共用同一組 code 與 noise（common random numbers），差異只來自 datapath。
 * runFixedGmacLoopCases / accumulatorTrace / compareEncodings / roundingTransfer 可由 Web Worker 呼叫
 * （參數為 plain object，回傳可 structured clone）。純數值、無 React/DOM。
 */

import { createRng, deriveSeed, normCdf, normPdf } from '@/simulation/core'
import { createZigguratNormal, runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'
import { DsmStream } from '@/simulation/models/dsm'

export type Bit = 0 | 1
export type GmMode = 'average' | 'sum'
export type ComparatorEncoding = 'bipolar_pm_one' | 'unipolar_mapped' | 'unipolar_unmapped_bug'
export type CodeRange = 'full' | 'symmetric'
export type NegateMode = 'extend' | 'inplace'
export type OverflowMode = 'wrap' | 'saturate'
export type RoundingMode = 'floor' | 'half_up' | 'toward_zero' | 'half_even'
export type CodeKind = 'uniform' | 'pm_full_scale' | 'dsm_residue'

export const ROUNDING_MODES: RoundingMode[] = ['floor', 'half_up', 'toward_zero', 'half_even']

export const ROUNDING_LABEL: Record<RoundingMode, string> = {
  floor: 'floor（算術右移截斷，朝 −∞）',
  half_up: 'round half up（+½ 後右移）',
  toward_zero: 'truncate toward zero（sign-magnitude 截斷）',
  half_even: 'round half to even（convergent）',
}

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)

// ───────────────────────────────────────────────────────────────────────────
// Comparator 位元 → q
// ───────────────────────────────────────────────────────────────────────────

// #region core:comparatorBit
/** 1-bit comparator：b = 1 ⇔ e ≥ 0（tie 規則：e = 0 判為 +1，勘誤 E07；與 §15.2「q = +1 if e >= 0」一致）。 */
export function comparatorBit(e: number): Bit {
  return e >= 0 ? 1 : 0
}
// #endregion

// #region core:bitToBipolar
/** 硬體 0/1 → 雙極性 ±1：q = 2b − 1（§0、§16.1 第 1 項）。 */
export function bitToBipolar(b: Bit): 1 | -1 {
  return b === 1 ? 1 : -1 // 等同 2b − 1
}
// #endregion

// #region core:decodeComparator
/** comparator 位元 b → GMAC 實際拿去相乘的 q。三種編碼對應 blockLms 的 comparator_encoding。 */
export function decodeComparator(b: Bit, encoding: ComparatorEncoding): number {
  if (encoding === 'unipolar_unmapped_bug') return b // ← 差異：忘了映射，q ∈ {0, 1}（反面教材）
  return 2 * b - 1 // bipolar_pm_one / unipolar_mapped：q = 2b − 1 ∈ {−1, +1}
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 浮點 GMAC：sum vs average
// ───────────────────────────────────────────────────────────────────────────

// #region core:gmacAverage
/** Average-mode GMAC：G_k = (1/N)·Σ q[n]·x_ref[n]（§0 的定義）。 */
export function gmacAverage(q: ArrayLike<number>, xRef: ArrayLike<number>): number {
  const N = q.length
  let acc = 0
  for (let n = 0; n < N; n++) acc += q[n] * xRef[n] // q = ±1：只是條件取負
  return acc / N // ← 差異：除以 N（RTL：右移 log2 N）⇒ G 與 N 無關，g = μK
}
// #endregion

// #region core:gmacSum
/** Sum-mode GMAC：S_k = Σ q[n]·x_ref[n]（RTL 省掉除法時的實際輸出）。 */
export function gmacSum(q: ArrayLike<number>, xRef: ArrayLike<number>): number {
  const N = q.length
  let acc = 0
  for (let n = 0; n < N; n++) acc += q[n] * xRef[n] // q = ±1：只是條件取負
  return acc // ← 差異：沒有除以 N ⇒ 大小隨 N 成長，同一個 μ 時 g = NμK
}
// #endregion

// #region core:blockUpdate
/** 一個 block 的係數更新：w_{k+1} = w_k + μ·(G_k 或 S_k)。 */
export function blockUpdate(w: number, q: ArrayLike<number>, xRef: ArrayLike<number>, mu: number, mode: GmMode): number {
  const G = mode === 'average' ? gmacAverage(q, xRef) : gmacSum(q, xRef)
  return w + mu * G // sum 模式等效於 average 模式用 μ_eff = N·μ
}
// #endregion

// #region core:gmacRunningSum
/** block 內逐 sample 的累加過程 S_n = Σ_{m ≤ n} q[m]·x_ref[m]（block 開始時清為 0）。 */
export function gmacRunningSum(q: ArrayLike<number>, xRef: ArrayLike<number>): Float64Array {
  const S = new Float64Array(q.length)
  let acc = 0
  for (let n = 0; n < q.length; n++) {
    acc += q[n] * xRef[n]
    S[n] = acc
  }
  return S
}
// #endregion

/**
 * 給定每個 sample 的確定性誤差 e_det[n]（不含雜訊）時，G（或 S）的條件平均與標準差。
 * v ~ N(0, σ²) iid：P(b = 1) = Φ(e_det/σ)；bipolar 時 E[q] = 2Φ − 1、Var(q) = 1 − E[q]²；bug 時 E[b] = Φ、Var(b) = Φ(1 − Φ)。
 * σ = 0 時 q 為確定值（sd = 0）。
 */
export function gmacConditionalMoments(
  eDet: ArrayLike<number>,
  xRef: ArrayLike<number>,
  sigma: number,
  encoding: ComparatorEncoding,
  mode: GmMode,
): { mean: number; sd: number } {
  const N = eDet.length
  let m = 0
  let v = 0
  for (let n = 0; n < N; n++) {
    const P = sigma > 0 ? normCdf(eDet[n] / sigma) : eDet[n] >= 0 ? 1 : 0
    const x = xRef[n]
    if (encoding === 'unipolar_unmapped_bug') {
      m += x * P
      v += x * x * P * (1 - P)
    } else {
      const mq = 2 * P - 1
      m += x * mq
      v += x * x * (1 - mq * mq)
    }
  }
  const scale = mode === 'average' ? 1 / N : 1
  return { mean: m * scale, sd: Math.sqrt(v) * scale }
}

/** Sum vs average 的 loop gain 對照（lesson 4 表）：K = K_q·C，g_avg = μK，g_sum = NμK。 */
export interface SumAverageRow {
  N: number
  gAvg: number
  gSum: number
  poleAvg: number
  poleSum: number
  stableAvg: boolean
  stableSum: boolean
  /** 收斂附近每個 block 的 GMAC 輸出標準差（average 單位）：√(E[x²]/N) */
  sdAvg: number
  /** 同上（sum 單位）：√(N·E[x²]) */
  sdSum: number
}

export function sumAverageTable(p: { mu: number; sigmaV: number; C: number; Ex2: number; Ns: number[] }): SumAverageRow[] {
  const Kq = p.sigmaV > 0 ? SQRT_2_OVER_PI / p.sigmaV : NaN
  const K = Kq * p.C
  return p.Ns.map((N) => {
    const gAvg = p.mu * K
    const gSum = N * gAvg
    return {
      N,
      gAvg,
      gSum,
      poleAvg: 1 - gAvg,
      poleSum: 1 - gSum,
      stableAvg: gAvg > 0 && gAvg < 2,
      stableSum: gSum > 0 && gSum < 2,
      sdAvg: Math.sqrt(p.Ex2 / N),
      sdSum: Math.sqrt(N * p.Ex2),
    }
  })
}

// ───────────────────────────────────────────────────────────────────────────
// 位元級基本運算
// ───────────────────────────────────────────────────────────────────────────

// #region core:wrapTwos
/** 把整數包回 bits-bit 二補數範圍 [−2^{bits−1}, 2^{bits−1} − 1]（未保護暫存器的 overflow 行為）。 */
export function wrapTwos(v: number, bits: number): number {
  const half = 2 ** (bits - 1)
  if (v >= -half && v < half) return v
  const m = 2 * half
  return ((((v + half) % m) + m) % m) - half // ← 差異：超出範圍時對 2^bits 取模，跳到另一端（可能變號）
}
// #endregion

// #region core:saturateTwos
/** 飽和：超出 bits-bit 二補數範圍時停在端點（rail）。 */
export function saturateTwos(v: number, bits: number): number {
  const half = 2 ** (bits - 1)
  return v > half - 1 ? half - 1 : v < -half ? -half : v // ← 差異：超出範圍時停在端點（rail），正負號保住
}
// #endregion

/** 有號 B_x-bit code 的範圍 [lo, hi]。 */
export function codeRangeOf(bx: number, range: CodeRange): [number, number] {
  const half = 2 ** (bx - 1)
  return [range === 'full' ? -half : -(half - 1), half - 1]
}

// #region core:negateExtended
/** 條件取負（正確版）：x 先符號延伸到 B_x + 1 bits，q = −1 時輸出 −x。 */
export function negateExtended(x: number, b: Bit): number {
  return b === 1 ? x : -x // ← 差異：在 B_x+1 bits 取負，−(−2^{B_x−1}) = +2^{B_x−1} 放得下
}
// #endregion

// #region core:negateInplace
/** 條件取負（常見 bug）：仍在 B_x bits 內做 ~x + 1。 */
export function negateInplace(x: number, b: Bit, bx: number): number {
  return b === 1 ? x : wrapTwos(-x, bx) // ← 差異：x = −2^{B_x−1} 時 −x 溢位，結果仍是 −2^{B_x−1}
}
// #endregion

// #region core:xorCarryAccumulate
/**
 * RTL 常見寫法：一個加法器完成 acc + q·x。q = −1（b = 0）時把（已符號延伸到 accBits 的）x 逐位元反相（XOR），
 * 並令 carry-in = 1：acc + (~x) + 1 = acc − x。不需要乘法器，也不需要額外的取負電路。
 */
export function xorCarryAccumulate(acc: number, x: number, b: Bit, accBits: number, overflow: OverflowMode): number {
  const neg = b === 0 ? 1 : 0 // q = −1 ⇔ b = 0
  const inv = neg === 1 ? -x - 1 : x // 二補數逐位元反相：~x = −x − 1
  const raw = acc + inv + neg // carry-in = neg ⇒ acc + (~x + 1) = acc − x
  return overflow === 'wrap' ? wrapTwos(raw, accBits) : saturateTwos(raw, accBits)
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// Accumulator 位元數（§16.1 第 3 項）
// ───────────────────────────────────────────────────────────────────────────

export interface AccumulatorSizing {
  bx: number
  N: number
  range: CodeRange
  /** max |q·x|（code LSB） */
  maxAbsProduct: number
  /** 最大正總和與最大負總和的絕對值 */
  maxPosSum: number
  maxNegSum: number
  /** 最壞情況不溢位的最少有號位元數（精確） */
  bitsExact: number
  /** 經驗法則 B_x + ⌈log2 N⌉（symmetric 的充分條件；N 為 2 的冪時等於 bitsExact；full range 時少 1 bit） */
  bitsRule: number
  /** guard bits = bitsExact − B_x */
  guardBits: number
}

// #region core:accumulatorBits
/**
 * 有號 B_x-bit code 經條件取負後累加 N 筆，最壞情況不溢位所需的最少有號位元數（精確）。
 *   symmetric：|q·x| ≤ 2^{B_x−1} − 1 ⇒ 需要 2^{A−1} − 1 ≥ N(2^{B_x−1} − 1)
 *   full     ：q·x ∈ [−2^{B_x−1}, +2^{B_x−1}]（−(−2^{B_x−1}) 會到 +2^{B_x−1}）⇒ 需要 2^{A−1} − 1 ≥ N·2^{B_x−1}
 */
export function accumulatorBitsRequired(bx: number, N: number, range: CodeRange = 'symmetric'): number {
  const half = 2 ** (bx - 1)
  const maxPos = N * (range === 'full' ? half : half - 1) // q = −1、x = 最負 code（full）或 q = +1、x = 最大 code
  const maxNeg = N * (range === 'full' ? half : half - 1) // q = +1、x = 最負 code
  let A = 1
  while (2 ** (A - 1) - 1 < maxPos || 2 ** (A - 1) < maxNeg) A++ // ← 差異：直接逐一試 A，直到最壞的正、負總和都放得下
  return A
}
// #endregion

// #region core:accumulatorBitsClosedForm
/**
 * F-04.9 的封閉式：令 M_x = max|q·x_int|（symmetric：2^{B_x−1} − 1；full：2^{B_x−1}），
 * 需要 2^{A−1} − 1 ≥ N·M_x ⇔ A = 1 + ⌈log2(N·M_x + 1)⌉。
 *   full：= B_x + ⌊log2 N⌋ + 1（對所有 N）；symmetric：≤ B_x + ⌈log2 N⌉，N 為 2 的冪時取等號。
 */
export function accumulatorBitsClosedForm(bx: number, N: number, range: CodeRange = 'symmetric'): number {
  const maxAbs = range === 'full' ? 2 ** (bx - 1) : 2 ** (bx - 1) - 1
  const v = N * maxAbs + 1 // 需要 2^{A−1} ≥ v
  let A = 1 + Math.ceil(Math.log2(v)) // ← 差異：封閉式 1 + ⌈log2(N·M_x + 1)⌉
  while (2 ** (A - 1) < v) A++ // 浮點 log2 的保險（整數精確）
  while (A > 1 && 2 ** (A - 2) >= v) A--
  return A
}
// #endregion

export function accumulatorSizing(bx: number, N: number, range: CodeRange): AccumulatorSizing {
  if (!Number.isInteger(bx) || bx < 2 || bx > 24) throw new Error(`B_x 必須為 2…24 的整數，收到 ${bx}`)
  if (!Number.isInteger(N) || N < 1) throw new Error(`N 必須為正整數，收到 ${N}`)
  const half = 2 ** (bx - 1)
  const maxAbsProduct = range === 'full' ? half : half - 1
  const bitsExact = accumulatorBitsRequired(bx, N, range)
  return {
    bx,
    N,
    range,
    maxAbsProduct,
    maxPosSum: N * maxAbsProduct,
    maxNegSum: N * maxAbsProduct,
    bitsExact,
    bitsRule: bx + Math.ceil(Math.log2(N)),
    guardBits: bitsExact - bx,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Normalize：算術右移 + rounding（§16.1 第 4、5 項）
// ───────────────────────────────────────────────────────────────────────────

// #region core:shiftRound
/**
 * 整數 v 右移 ℓ bits（÷2^ℓ）並依 rounding 取整；ℓ ≤ 0 時為左移（精確，不需取整）。
 *   floor      ：二補數算術右移 v >>> ℓ，朝 −∞
 *   half_up    ：先加 2^{ℓ−1} 再 floor
 *   toward_zero：sign(v)·⌊|v|/2^ℓ⌋（sign-magnitude 截斷）
 *   half_even  ：最近整數，恰好一半時取偶數（convergent rounding）
 */
export function shiftRound(v: number, ell: number, mode: RoundingMode): number {
  if (ell <= 0) return v * 2 ** -ell
  const d = 2 ** ell
  switch (mode) {
    case 'floor':
      return Math.floor(v / d)
    case 'half_up':
      return Math.floor((v + d / 2) / d)
    case 'toward_zero':
      return Math.trunc(v / d)
    case 'half_even': {
      const f = Math.floor(v / d)
      const rem = v - f * d
      if (2 * rem < d) return f
      if (2 * rem > d) return f + 1
      return f % 2 === 0 ? f : f + 1
    }
  }
}
// #endregion

// #region core:roundingMeanError
/**
 * 餘數 v mod 2^ℓ 均勻分布（GMAC 雜訊足以當 dither）時，shiftRound 的平均誤差 E[Q(v) − v/2^ℓ]（單位：輸出 LSB）。
 * toward_zero 依 v 的符號而不同（sign = +1 或 −1）。
 * half_even 的 0 還需要「恰好一半（tie：餘數 = 2^{ℓ−1}）時商 ⌊v/2^ℓ⌋ 的奇偶各半」
 *   充分條件：v mod 2^{ℓ+1} 均勻；v 的分布對 0 對稱時自動成立。
 *   只有餘數均勻時是 ½·[P(tie 且商為奇) − P(tie 且商為偶)]，|ε̄| ≤ 2^{−ℓ−1}；
 *   例：ℓ = 2、v ∈ {0, 1, 2, 3}（商都是 0）⇒ −1/8。
 */
export function roundingMeanError(ell: number, mode: RoundingMode, sign: 1 | -1 = 1): number {
  if (ell <= 0) return 0
  const tiny = 2 ** -ell
  switch (mode) {
    case 'floor':
      return -(1 - tiny) / 2 // 平均截掉半個 LSB（偏負）
    case 'half_up':
      return tiny / 2 // 只有「恰好一半」那一格往上進位：+2^{−ℓ−1}
    case 'toward_zero':
      return sign > 0 ? -(1 - tiny) / 2 : (1 - tiny) / 2 // 對稱，但朝 0 縮
    case 'half_even':
      return 0 // 需要 tie 時商的奇偶各半（見上方說明）
  }
}
// #endregion

/**
 * Rounding 的平均轉移特性（精確｜指定模型）：S 為以整數 j 為中心的離散 Gaussian（σ_S = ratio·2^ℓ），
 * 回傳 E[Q(S)] − E[S]/2^ℓ（輸出 LSB），j/2^ℓ ∈ [−mRange, mRange]。ratio = 0 時 S = j（無雜訊）。
 */
export function roundingTransfer(p: { ell: number; ditherRatio: number; mRange: number; maxPoints?: number }): {
  m: Float64Array
  bias: Record<RoundingMode, Float64Array>
  meanTransfer: Record<RoundingMode, Float64Array>
} {
  const ell = Math.max(0, Math.min(12, Math.round(p.ell)))
  const d = 2 ** ell
  const jMax = Math.max(1, Math.round(p.mRange * d))
  const total = 2 * jMax + 1
  const stride = Math.max(1, Math.ceil(total / (p.maxPoints ?? 401)))
  const js: number[] = []
  for (let j = -jMax; j <= jMax; j += stride) js.push(j)
  const sigma = Math.max(0, p.ditherRatio) * d
  const m = new Float64Array(js.length)
  const bias = {} as Record<RoundingMode, Float64Array>
  const meanTransfer = {} as Record<RoundingMode, Float64Array>
  for (const mode of ROUNDING_MODES) {
    bias[mode] = new Float64Array(js.length)
    meanTransfer[mode] = new Float64Array(js.length)
  }
  // 權重只和 s − j 有關，先算一次；累積和 C[i] = Σ_{t < −span+i} w_t
  const span = sigma > 0 ? Math.ceil(8 * sigma) + 1 : 0
  const nW = 2 * span + 1
  const C = new Float64Array(nW + 1)
  for (let i = 0; i < nW; i++) {
    const t = i - span
    C[i + 1] = C[i] + (sigma > 0 ? Math.exp(-(t * t) / (2 * sigma * sigma)) : 1)
  }
  const wSum = C[nW]
  // Q(v) 是分段常數：先把 v ∈ [vLo, vHi] 切成「Q 相同」的區段，E[Q(j + T)] = Σ_區段 Q·(該區段落在 j 的權重窗內的權重和)。
  // 與逐點卷積 Σ_t w_t Q(j + t) 數學上相同，但成本由 O(span) 降到 O(span/2^ℓ)。
  const vLo = js[0] - span
  const vHi = js[js.length - 1] + span
  for (const mode of ROUNDING_MODES) {
    const rs: number[] = []
    const re: number[] = []
    const rq: number[] = []
    let start = vLo
    let cur = shiftRound(vLo, ell, mode)
    for (let v = vLo + 1; v <= vHi + 1; v++) {
      const q = v <= vHi ? shiftRound(v, ell, mode) : NaN
      if (q !== cur) {
        rs.push(start)
        re.push(v - 1)
        rq.push(cur)
        start = v
        cur = q
      }
    }
    let r0 = 0
    js.forEach((j, idx) => {
      const lo = j - span
      const hi = j + span
      while (r0 < re.length && re[r0] < lo) r0++
      let eq = 0
      for (let r = r0; r < rs.length && rs[r] <= hi; r++) {
        const a = Math.max(rs[r], lo) - lo
        const b = Math.min(re[r], hi) - lo + 1
        eq += rq[r] * (C[b] - C[a])
      }
      eq /= wSum
      meanTransfer[mode][idx] = eq
      bias[mode][idx] = eq - j / d // 離散 Gaussian 對 j 對稱 ⇒ E[S] = j
    })
  }
  js.forEach((j, idx) => {
    m[idx] = j / d
  })
  return { m, bias, meanTransfer }
}

// #region core:biasFixedPoint
/**
 * 定點 datapath 的平均誤差 → 係數固定點（F-04.11、F-04.15；平均模型、小訊號斜率 K = K_q·E[x²]）。
 *   E[G | δ] ≈ Kδ + ε̄_r − 2·p_min·Φ(δ/σ_v)
 *   ε̄_r   ：右移 rounding 的平均誤差（正規化 G 單位，= ε̄·Δ_G）
 *   p_min ：最負 code −2^{B_x−1}（正規化 x = −1）出現的機率；只有 inplace 取負 bug 才不為 0。
 *           此 code 在 b = 0 時應加 +1、bug 卻加 −1（差 −2）；P(b = 0 | x = −1) = P(−δ + v < 0) = Φ(δ/σ_v)。
 * 解 E[G | δ*] = 0（K > 2p_min·φ(0)/σ_v 時左邊對 δ 單調遞增 ⇒ 二分法）。回傳 δ* = a − w*。
 */
export function biasFixedPoint(p: { K: number; sigmaV: number; roundErr: number; pMin: number }): number {
  const { K, sigmaV, roundErr, pMin } = p
  if (!(K > 0)) return NaN
  if (pMin === 0) return -roundErr / K // 只有 rounding：δ* = −ε̄Δ_G/K
  if (!(sigmaV > 0)) return NaN // σ_v = 0 時 Φ 是步階，平均模型不連續
  const f = (d: number): number => K * d + roundErr - 2 * pMin * normCdf(d / sigmaV)
  let lo = -sigmaV
  let hi = sigmaV
  for (let i = 0; i < 200 && f(lo) > 0; i++) lo *= 2
  for (let i = 0; i < 200 && f(hi) < 0; i++) hi *= 2
  if (!(f(lo) <= 0 && f(hi) >= 0)) return NaN
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (f(mid) > 0) hi = mid
    else lo = mid
  }
  return 0.5 * (lo + hi)
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 忘了映射（q = b）＋ Gaussian code：mean-field 固定點的封閉式（F-04.16）；符號 ξ = δ/σ_v、m_x = E[x]、σ_x = sd(x)
// ───────────────────────────────────────────────────────────────────────────

// #region core:bugMeanGmac
/**
 * x ~ N(m_x, σ_x²) 與 v ~ N(0, σ_v²) 獨立、q = b（忘了映射）、identity path：每個 sample 的平均 GMAC
 *   h(ξ) = E[x·Φ(ξ·x)]，ξ = δ/σ_v（正規化誤差）
 *        = m_x·Φ(ξ·m_x/γ) + σ_x²·ξ·φ(ξ·m_x/γ)/γ，γ = √(1 + ξ²σ_x²)
 * 推導：E[Φ(ξx)] = P(Z − ξx ≤ 0) = Φ(ξ·m_x/γ)（Z ~ N(0,1) 獨立）；E[(x − m_x)f(x)] = σ_x²·E[f′(x)]（分部積分）。
 */
export function bugMeanGmac(xi: number, mx: number, sx: number): number {
  const gamma = Math.sqrt(1 + xi * xi * sx * sx)
  const z = (xi * mx) / gamma
  return mx * normCdf(z) + (sx * sx * xi * normPdf(z)) / gamma
}
// #endregion

/**
 * 忘了映射時的精確 mean-field 固定點（Gaussian code）：解 h(ξ*) = 0，w* = a − ξ*·σ_v。
 * 因為 h 只和 ξ = δ/σ_v 有關，偏差 w* − a = −ξ*·σ_v 與 σ_v 精確成正比；
 * 線性化（h ≈ m_x/2 + ξ·E[x²]/√(2π)）給 ξ_lin = −m_x/(√(2/π)·E[x²])，即 F-04.7 的 E[x]/(K_q·E[x²])。
 */
export function bugFixedPointGaussian(p: { codeMean: number; codeSigma: number; sigmaV: number; aTrue: number }): {
  /** ξ⋆ = δ⋆ ÷ σ_v（h(ξ⋆) = 0 的根） */
  xi: number
  /** 線性化的 ξ_lin */
  xiLin: number
  wStar: number
  wStarLinear: number
} {
  const mx = p.codeMean
  const sx = Math.abs(p.codeSigma)
  const Ex2 = mx * mx + sx * sx
  const xiLin = Ex2 > 0 ? -mx / (SQRT_2_OVER_PI * Ex2) : NaN
  let xi = 0
  if (mx !== 0) {
    // h(0) = m_x/2；ξ → −sign(m_x)·∞ 時 h → sign(m_x)·[|m_x|·Φ(−|m_x|/σ_x) − σ_x·φ(m_x/σ_x)]，與 h(0) 異號（Mills 比不等式）
    const dir = mx > 0 ? -1 : 1
    let lo = 0
    let hi = dir
    for (let i = 0; i < 200 && Math.sign(bugMeanGmac(hi, mx, sx)) === Math.sign(mx); i++) hi *= 2
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi)
      if (Math.sign(bugMeanGmac(mid, mx, sx)) === Math.sign(mx)) lo = mid
      else hi = mid
    }
    xi = 0.5 * (lo + hi)
  }
  return { xi, xiLin, wStar: p.aTrue - xi * p.sigmaV, wStarLinear: p.aTrue - xiLin * p.sigmaV }
}

// ───────────────────────────────────────────────────────────────────────────
// 位元級 GMAC：一個 block
// ───────────────────────────────────────────────────────────────────────────

export interface FixedGmacConfig {
  bx: number
  log2N: number
  accBits: number
  accOverflow: OverflowMode
  negate: NegateMode
  gmMode: GmMode
  /** F_G：右移後保留的小數位元數 */
  gFracBits: number
  rounding: RoundingMode
}

export interface FixedGmacBlockOut {
  /** 累加器最後的內容（可能已 wrap / 飽和） */
  S: number
  /** 理想（無限位元、正確取負）的總和 */
  Sexact: number
  /** 正規化後的 G（無因次；average 模式約為 E[q·x]，sum 模式約為 N 倍） */
  G: number
  /** 累加器 overflow 事件數 */
  overflow: number
  /** 取負結果與 −x 不同的次數（inplace bug） */
  negateErrors: number
}

// #region core:fixedGmacBlock
/** 位元級 GMAC 一個 block：條件取負 → B_acc-bit 累加 → 右移 ℓ = log2 N − F_G 並 rounding → 換回正規化 G。 */
export function fixedGmacBlock(xInt: ArrayLike<number>, b: ArrayLike<number>, c: FixedGmacConfig): FixedGmacBlockOut {
  let S = 0
  let Sexact = 0
  let overflow = 0
  let negateErrors = 0
  for (let n = 0; n < xInt.length; n++) {
    const bit = b[n] as Bit
    const p = c.negate === 'extend' ? negateExtended(xInt[n], bit) : negateInplace(xInt[n], bit, c.bx)
    if (p !== negateExtended(xInt[n], bit)) negateErrors++
    Sexact += negateExtended(xInt[n], bit)
    const raw = S + p
    S = c.accOverflow === 'wrap' ? wrapTwos(raw, c.accBits) : saturateTwos(raw, c.accBits)
    if (S !== raw) overflow++
  }
  const fullScale = 2 ** (c.bx - 1) // x = x_int / 2^{B_x−1}
  let G: number
  if (c.gmMode === 'average') {
    const Gint = shiftRound(S, c.log2N - c.gFracBits, c.rounding) // 單位：2^{−F_G} code LSB
    G = (Gint * 2 ** -c.gFracBits) / fullScale
  } else {
    G = S / fullScale // sum：不右移 ⇒ 是 average 的 N 倍
  }
  return { S, Sexact, G, overflow, negateErrors }
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// Gain accumulator：saturation / anti-windup（§16.1 第 6、8 項）
// ───────────────────────────────────────────────────────────────────────────

export interface GainRegParams {
  /** 實體（DTC 可實現）範圍 [fs per FS code] */
  physMin: number
  physMax: number
  /** 內部高解析暫存器範圍（≥ 實體範圍） */
  regMin: number
  regMax: number
  regOverflow: OverflowMode
  /** true：積分器本身被夾在實體範圍內（anti-windup） */
  antiWindup: boolean
}

// #region core:gainUpdate
/** 高解析 gain accumulator 的一次更新（§4.2：ADD → SAT / anti-windup → W → APPLY）。 */
export function gainUpdate(W: number, dW: number, p: GainRegParams): { W: number; applied: number; sat: boolean; wrapped: boolean } {
  let next = W + dW
  let sat = false
  let wrapped = false
  if (p.antiWindup) {
    // ← 差異：積分器停在實體 rail，不會「越積越深」；誤差一反向就立刻離開 rail
    if (next > p.physMax) [next, sat] = [p.physMax, true]
    else if (next < p.physMin) [next, sat] = [p.physMin, true]
  } else if (p.regOverflow === 'saturate') {
    // 只保護內部暫存器：在實體範圍外仍持續積分（windup）
    if (next > p.regMax) [next, sat] = [p.regMax, true]
    else if (next < p.regMin) [next, sat] = [p.regMin, true]
  } else if (next >= p.regMax || next < p.regMin) {
    // 二補數 wrap：跳到另一端（最危險）
    const span = p.regMax - p.regMin
    next = p.regMin + ((((next - p.regMin) % span) + span) % span)
    wrapped = true
  }
  const applied = Math.min(p.physMax, Math.max(p.physMin, next)) // DTC 只能實現實體範圍內的 gain
  return { W: next, applied, sat, wrapped }
}
// #endregion

/**
 * floor 取整在閉迴路中的「回復斜率」χ(s)（連續格點極限；s = 取整前雜訊的標準差 ÷ 取整後的 LSB）。
 * X ~ N(m, s²) 時（sawtooth 的 Fourier 級數逐項取期望值）
 *   E[⌊X⌋] = m − ½ + Σ_{k≥1} e^{−2π²k²s²}·sin(2πkm)/(πk)
 * ⇒ m = ½ 時每一項都是 0：E[⌊X⌋] = 0 對任何 s 都精確成立（對稱性）——閉迴路的平衡點永遠是「真值 = ½ LSB」，
 *   也就是 F-04.11 / F-04.18 的偏差；雜訊（dither）決定的是平衡點附近的斜率
 *   χ(s) = dE[⌊X⌋]/dm |_{m=½} = 1 + 2Σ_{k≥1} (−1)^k e^{−2π²k²s²} = Σ_k (1/s)·φ((k − ½)/s)   （X 的密度在整數點的總和）
 * χ → 1（s ≳ 0.6）：和沒有取整一樣；χ → 0（s ≲ 0.15）：平衡點附近幾乎沒有回復力 = dead zone，迴路停在進入 dead zone 的地方。
 */
export function floorRestoringSlope(s: number): number {
  if (!(s > 0)) return 0
  if (!Number.isFinite(s)) return 1
  const span = Math.ceil(8 * s) + 1
  let acc = 0
  for (let k = -span; k <= span + 1; k++) acc += normPdf((k - 0.5) / s) / s
  return acc
}

/**
 * 偏差預測（F-04.11、F-04.18）可用的 dither 比下限（σ_S/2^ℓ 或 μσ_G/Δ_W）；floor / half-up / half-even 用這個值，toward_zero 加倍（ditherMinFor）。
 * 平衡點本身不靠 dither（見 floorRestoringSlope），但 χ(0.25) ≈ 0.43、χ(0.14) ≈ 0.01：低於約 0.2 時迴路在有限時間內到不了平衡點。
 * 多 seed 模擬（gmac.test.ts）：÷N 的右移在 0.57 時與預測相符（−6.13 ± 0.04 vs −6.06 fs），0.14 時偏離（−4.35 ± 0.09 vs −6.06 fs）；
 * μ·G → W 的取整在 0.57 時相符（−5.66 ± 0.05 vs −5.69 fs）。
 */
export const DITHER_MIN = 0.25

/**
 * toward_zero 取整在平衡點 m = 0 的回復斜率（連續格點極限；s 的定義同 floorRestoringSlope）。
 * trunc(x) = sign(x)·⌊|x|⌋ ⇒ E[trunc(X)] = Σ_{k≥1} [P(X ≥ k) − P(X ≤ −k)]，對 m 微分後在 m = 0：
 *   χ_tz(s) = Σ_{k≠0} (1/s)·φ(k/s)   （X 的密度在「0 以外的整數點」的總和；floor 在 m = ½ 是半整數點的總和）
 * |X| < 1 全部輸出 0，0 兩側的平台合起來寬 2 個 LSB，平衡點離最近的台階有 1 個 LSB（floor / half-even 只有 ½ 個），
 * 所以同樣的 s 下回復斜率小得多：s = 0.284 時 0.006、0.40 時 0.09、0.5 時 0.22、0.57 時 0.30；
 * s 很大時 → 1 − φ(0)/s（少掉 k = 0 那一項），比 floor 慢很多才接近 1（s = 2.27 時 0.82）。
 */
export function towardZeroRestoringSlope(s: number): number {
  if (!(s > 0)) return 0
  if (!Number.isFinite(s)) return 1
  const span = Math.ceil(8 * s) + 1
  let acc = 0
  for (let k = 1; k <= span; k++) acc += (2 * normPdf(k / s)) / s
  return acc
}

/** 取整點在平衡點附近的回復斜率（1 = 和沒有取整一樣，0 = dead zone）：toward_zero 用 χ_tz，其餘三種都是 floor 的 χ（平台寬 1 個 LSB、平衡點在平台中央）。 */
export function roundingRestoringSlope(s: number, mode: RoundingMode): number {
  return mode === 'toward_zero' ? towardZeroRestoringSlope(s) : floorRestoringSlope(s)
}

/**
 * 偏差預測可用的 dither 比下限（σ_S/2^ℓ 或 μσ_G/Δ_W），依 rounding 模式而定。
 * floor / half-up / half-even：平衡點落在 1 個 LSB 寬的平台中央，離最近的台階約 ½ 個 LSB ⇒ DITHER_MIN
 *   （連續格點極限下，half-even 在 m = 0 的回復斜率和 floor 在 m = ½ 的 χ(s) 是同一個式子：0.25 時 0.43、0.142 時 0.01）。
 * toward-0：|S| < 2^ℓ 全部輸出 0，0 兩側的平台合起來寬 2 個 LSB，平衡點 δ = 0 離最近的台階 1 個 LSB ⇒ 下限加倍
 *   （回復斜率見 towardZeroRestoringSlope：s ≲ 0.6 時 ≈ ½·χ(s/2)）。
 *   模擬（seed 1–6、w₀ 在 a 的下方與上方各一次）：σ_S/2^ℓ = 0.284 時 12 次都停在出發的那一側（−3.2 ～ −2.1 與 +3.2 ～ +3.7 fs，預測是 0）、
 *   0.40 時 12 次裡 5 次偏離超過 4 SE；μ·G → W 的取整在 μσ_G/Δ_W = 0.284 時同樣 12 次都偏離。
 * 閉迴路的警告（fixedLoopWarnings）與 Ch04 定點實驗的比對條件（roundingPredictionOk）用同一個下限。
 */
export function ditherMinFor(mode: RoundingMode): number {
  return mode === 'toward_zero' ? 2 * DITHER_MIN : DITHER_MIN
}

/**
 * half-even 在「恰好一半」（tie）那一格留下的平均誤差的振幅，以 2^{−ℓ} 個輸出 LSB 為單位（近似｜Gaussian S、Poisson summation 的第一項）。
 * tie 的貢獻是 ½·[P(tie 且商為奇) − P(tie 且商為偶)]；S 為平均 2^ℓ·m、標準差 s·2^ℓ 的離散 Gaussian 時
 *   ε̄_tie(m) ≈ −2^{−ℓ}·e^{−π²s²/2}·sin(πm)
 * 看的是 S mod 2^{ℓ+1}（週期是餘數的兩倍），所以指數是餘數那一項 e^{−2π²s²} 把 s 換成 s/2。s = 1 時約 0.0072（half-up 的 2^{−ℓ−1} 的 1.4%）；
 * m = 0（S 對 0 對稱）時恆為 0。這只是 tie 這一格：餘數不均勻的那一項約 e^{−2π²s²}/π 個 LSB（不隨 ℓ 縮小），
 * s ≥ 1、ℓ ≤ 16 時比 tie 這一項小兩個數量級以上；s 更小時兩項都要算（直接用 roundingTransfer）。
 * gmac.test.ts 與 roundingTransfer 的逐點精確值比對。
 */
export function halfEvenTieAmplitude(s: number): number {
  return Math.exp(-((Math.PI * s) ** 2) / 2)
}

// #region core:quantizeIncrement
/**
 * 把更新量 μ·G 取整到 W 的格點（LSB = Δ_W）。RTL 把「×μ」做成右移、或 W 的小數位元不夠時，
 * 被丟掉的低位元就是這裡的餘數——這是「÷N」之後的第二個截斷點（§16.1 第 6 項；F-04.18）。
 */
export function quantizeIncrement(dW: number, wLsb: number, mode: RoundingMode): number {
  if (!(wLsb > 0)) return dW // 浮點 W：不取整
  const v = dW / wLsb
  switch (mode) {
    case 'floor':
      return Math.floor(v) * wLsb // ← 差異：直接截斷，平均少約半個 Δ_W ⇒ w* − a ≈ −Δ_W/(2g)
    case 'half_up':
      return Math.floor(v + 0.5) * wLsb
    case 'toward_zero':
      return Math.trunc(v) * wLsb
    case 'half_even': {
      const f = Math.floor(v)
      const r = v - f
      return (r < 0.5 ? f : r > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1) * wLsb
    }
  }
}
// #endregion

/**
 * Q_W 的平均誤差 E[Q_W(μG) − μG]（單位 Δ_W）。μG 落在間距 μΔ_G 的格點上；令 R = Δ_W/(μΔ_G) = p/q（最簡分數），
 * 則餘數只會是 Δ_W·{0, 1/p, …, (p − 1)/p}，更新量夠「散」（μσ_G ≳ Δ_W）時這 p 個值均勻出現：
 *   floor：−(1 − 1/p)/2；half_up：p 為偶數時 +1/(2p)（恰好一半那一格永遠進位），否則 0；half_even / toward_zero：0
 *   half_even 的 0：p 為奇數時沒有「恰好一半」的餘數，只需餘數均勻；p 為偶數時還需要 tie 時商的奇偶各半（同 roundingMeanError），否則 |ε̄_W| ≤ 1/(2p)
 * RTL 的右移對應 R = 2^{ℓ_W}（p = R、q = 1）；p = 1（每個更新量都剛好在 W 的格點上）時沒有誤差；
 * 找不到 q ≤ 1024 的分數時以連續均勻餘數近似（floor ≈ −½）。
 */
export function incrementMeanError(R: number, mode: RoundingMode): number {
  if (!(R > 0) || !Number.isFinite(R)) return 0
  if (mode === 'half_even' || mode === 'toward_zero') return 0
  let pInt = Infinity
  for (let q = 1; q <= 1024; q++) {
    const pq = R * q
    if (Math.abs(pq - Math.round(pq)) < 1e-9 * Math.max(1, pq)) {
      pInt = Math.round(pq)
      break
    }
  }
  if (pInt === 1) return 0
  if (mode === 'floor') return Number.isFinite(pInt) ? -(1 - 1 / pInt) / 2 : -0.5
  return Number.isFinite(pInt) && pInt % 2 === 0 ? 1 / (2 * pInt) : 0
}

// ───────────────────────────────────────────────────────────────────────────
// Code 產生
// ───────────────────────────────────────────────────────────────────────────

interface IntCodeSource {
  fill(buf: Float64Array, count: number): void
}

function createIntCodeSource(kind: CodeKind, bx: number, range: CodeRange, dsmFrac: number, rng: ReturnType<typeof createRng>): IntCodeSource {
  const [lo, hi] = codeRangeOf(bx, range)
  if (kind === 'uniform') {
    return {
      fill(buf, cnt) {
        for (let i = 0; i < cnt; i++) buf[i] = rng.int(lo, hi)
      },
    }
  }
  if (kind === 'pm_full_scale') {
    return {
      fill(buf, cnt) {
        for (let i = 0; i < cnt; i++) buf[i] = rng.uint32() >>> 31 === 1 ? hi : -hi
      },
    }
  }
  // dsm_residue：一階 DSM 累加器內容 s[n]（20 bits）取最高 B_x bits，MSB 反相成二補數（offset binary → signed）
  const B = 20
  const s = new DsmStream({ kind: 'first_order', frac: dsmFrac, bits: B })
  const M = 2 ** B
  const shift = 2 ** (B - bx)
  return {
    fill(buf, cnt) {
      for (let i = 0; i < cnt; i++) {
        s.step()
        const acc = Math.round(-s.residue * M) // 零初值時 residue = −s[n]/M（dsm.ts）
        const v = Math.floor(acc / shift) - 2 ** (bx - 1)
        buf[i] = v < lo ? lo : v
      }
    },
  }
}

/** 正規化 code 的 E[x²]（x = x_int/2^{B_x−1}；uniform / pm 為精確值，dsm 由序列估計）。 */
function codeMoments(kind: CodeKind, bx: number, range: CodeRange): { Ex2: number; ExInt2: number } | null {
  const [lo, hi] = codeRangeOf(bx, range)
  const fs2 = 4 ** (bx - 1)
  if (kind === 'pm_full_scale') return { Ex2: (hi * hi) / fs2, ExInt2: hi * hi }
  if (kind === 'uniform') {
    let s = 0
    for (let i = lo; i <= hi; i++) s += i * i
    const ExInt2 = s / (hi - lo + 1)
    return { Ex2: ExInt2 / fs2, ExInt2 }
  }
  return null
}

// ───────────────────────────────────────────────────────────────────────────
// Accumulator 在一個 block 內的軌跡（overflow / 取負 bug 示範）
// ───────────────────────────────────────────────────────────────────────────

export type AccScenario = 'worst_case' | 'random' | 'min_code'

export interface AccumulatorTraceParams {
  bx: number
  log2N: number
  codeRange: CodeRange
  accBits: number
  negate: NegateMode
  scenario: AccScenario
  /** random / min_code：δ·(full scale)/σ_v，0 = 已收斂，大 = 剛開機（q 幾乎等於 sign(x)） */
  deltaOverSigma: number
  seed: number
  maxPoints?: number
}

export interface AccumulatorTraceResult {
  n: Float64Array
  exact: Float64Array
  wrap: Float64Array
  saturate: Float64Array
  finalExact: number
  finalWrap: number
  finalSaturate: number
  wrapEvents: number
  saturateEvents: number
  /** exact 總和第一次超出 B_acc-bit 範圍的 sample（不超出為 null） */
  firstOverflow: number | null
  negateErrors: number
  /** wrap 後的最終總和與 exact 異號 */
  signFlip: boolean
  sizing: AccumulatorSizing
  rangeLo: number
  rangeHi: number
}

/** 一個 block 內 GMAC 累加器的 exact / wrap / saturate 軌跡（worker 可呼叫）。 */
export function accumulatorTrace(p: AccumulatorTraceParams): AccumulatorTraceResult {
  const N = 2 ** p.log2N
  const sizing = accumulatorSizing(p.bx, N, p.codeRange)
  const [lo, hi] = codeRangeOf(p.bx, p.codeRange)
  const fullScale = 2 ** (p.bx - 1)
  const rng = createRng(p.seed)
  const codeRng = rng.fork('code')
  const gauss = createZigguratNormal(rng.fork('comparator-noise'))
  const maxPts = p.maxPoints ?? 2048
  const dec = Math.max(1, Math.ceil(N / maxPts))
  const nOut = Math.ceil(N / dec)
  const n = new Float64Array(nOut)
  const exact = new Float64Array(nOut)
  const wrap = new Float64Array(nOut)
  const sat = new Float64Array(nOut)
  const half = 2 ** (p.accBits - 1)
  let sE = 0
  let sW = 0
  let sS = 0
  let wrapEvents = 0
  let satEvents = 0
  let negateErrors = 0
  let firstOverflow: number | null = null
  let oi = 0
  for (let i = 0; i < N; i++) {
    let x: number
    let b: Bit
    if (p.scenario === 'worst_case') {
      x = lo
      b = 0 // q = −1 且 x 為最負 code ⇒ 每筆都加上最大的正值 |lo|
    } else {
      x = p.scenario === 'min_code' ? lo : codeRng.int(lo, hi)
      b = comparatorBit(p.deltaOverSigma * (x / fullScale) + gauss())
    }
    const good = negateExtended(x, b)
    const used = p.negate === 'extend' ? good : negateInplace(x, b, p.bx)
    if (used !== good) negateErrors++
    sE += good
    if (firstOverflow === null && (sE > half - 1 || sE < -half)) firstOverflow = i
    const rw = sW + used
    sW = wrapTwos(rw, p.accBits)
    if (sW !== rw) wrapEvents++
    const rs = sS + used
    sS = saturateTwos(rs, p.accBits)
    if (sS !== rs) satEvents++
    if (i % dec === 0 || i === N - 1) {
      if (oi < nOut) {
        n[oi] = i
        exact[oi] = sE
        wrap[oi] = sW
        sat[oi] = sS
        oi++
      } else {
        n[nOut - 1] = i
        exact[nOut - 1] = sE
        wrap[nOut - 1] = sW
        sat[nOut - 1] = sS
      }
    }
  }
  return {
    n,
    exact,
    wrap,
    saturate: sat,
    finalExact: sE,
    finalWrap: sW,
    finalSaturate: sS,
    wrapEvents,
    saturateEvents: satEvents,
    firstOverflow,
    negateErrors,
    signFlip: sE !== 0 && Math.sign(sW) !== Math.sign(sE),
    sizing,
    rangeLo: -half,
    rangeHi: half - 1,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 閉迴路：定點 GMAC vs 浮點 GMAC（common random numbers）
// ───────────────────────────────────────────────────────────────────────────

export interface FixedLoopParams extends FixedGmacConfig, GainRegParams {
  codeRange: CodeRange
  codeKind: CodeKind
  /** dsm_residue 時的 FCW 小數 */
  dsmFrac: number
  /** 真實 gain a [fs per FS code] */
  aTrue: number
  /** a 在此 block 起跳到 aStepValue（< 0 表示不跳） */
  aStepBlock: number
  aStepValue: number
  w0: number
  /** μ [fs]（average 意義） */
  mu: number
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  numBlocks: number
  seed: number
  /** gain accumulator W 的 LSB Δ_W [fs per FS code]；0 或省略 = 浮點（不取整）。更新量 μ·G 先取整到這個格點再加進 W */
  wLsb?: number
  /** μ·G → W 格點的 rounding（省略 = 'half_even'） */
  wRounding?: RoundingMode
}

export interface FixedLoopAnalytic {
  Kq: number
  Ex2: number
  /** K = K_q·E[x²] [fs⁻¹]（identity path、x_ref = x） */
  K: number
  g: number
  pole: number
  sigmaWPred: number
  /** 右移量 ℓ = log2 N − F_G */
  ell: number
  /** G 的 LSB（正規化單位） */
  deltaG: number
  /** 均勻餘數假設下 rounding 的平均誤差（正規化 G 單位） */
  meanRoundErr: number
  /** 只計 rounding 的預測偏差 w* − a = ε̄Δ_G/K [fs]（toward_zero 為 0，但會降低增益） */
  biasPredRound: number
  /** R = Δ_W/(μΔ_G)：W 的格點比更新量的格點粗幾倍（wLsb = 0 時為 0） */
  wRatio: number
  /** μ·G 取整到 Δ_W 的平均誤差 [fs]（= ε̄_W·Δ_W） */
  meanIncErr: number
  /** 只計 W 取整的預測偏差 w* − a = ε̄_WΔ_W/g [fs]（F-04.18） */
  biasPredW: number
  /** dither 比 μσ_G/Δ_W：≥ ditherMinFor(wRounding) 時偏差預測（F-04.18）可用（DITHER_MIN；toward_zero 加倍）；wLsb = 0 時為 Infinity */
  ditherRatioW: number
  /** 最負 code 出現的機率（negate = 'inplace' 時才會造成偏差；其他情況為 0） */
  pMin: number
  /** 兩個取整點（÷N 的右移、μ·G → W）+ inplace 取負 bug 的自洽固定點 w* − a [fs]（biasFixedPoint；F-04.11、F-04.15、F-04.18） */
  biasPred: number
  /** 收斂附近 S 的標準差（code LSB）≈ √(N·E[x_int²]) */
  sigmaS: number
  /** dither 比 σ_S/2^ℓ：≥ ditherMinFor(rounding) 時偏差預測（F-04.11）可用（DITHER_MIN；toward_zero 加倍）。≥ 1 時餘數幾乎均勻，floor / half-up / half-even 的回復斜率 χ ≈ 1 */
  ditherRatio: number
  /** 線性化（K_q 小訊號）是否有效：|ε̄/K|·max|x| ≪ σ_v */
  linearValid: boolean
  sizing: AccumulatorSizing
}

export interface FixedLoopStats {
  /** 統計窗口 [from, to]（block） */
  window: [number, number]
  meanFixed: number
  meanFloat: number
  stdFixed: number
  stdFloat: number
  /** mean(w_fixed − a)、mean(w_float − a)（實際作用的 gain） */
  biasFixed: number
  biasFloat: number
  /** mean(w_fixed − w_float)（paired，抵消大部分雜訊） */
  biasDiff: number
  /** biasDiff 的標準誤（batch means） */
  biasDiffSe: number
  /** a 跳變後回到目標 ±tol 所需 block 數（無跳變或未回復為 null） */
  recoveryFixed: number | null
  recoveryFloat: number | null
  /** F-04.12 的預測回復 block 數（windup 放掉 + 指數收斂到 ±tol；W wrap 或 g ∉ (0,1) 時為 NaN） */
  recoveryPredFixed: number
  recoveryPredFloat: number
  recoveryTol: number
  accOverflow: number
  negateErrors: number
  wSat: number
  wWrap: number
  wSatFloat: number
  wWrapFloat: number
}

export interface FixedLoopResult {
  params: FixedLoopParams
  k: Float64Array
  /** 內部暫存器 W（定點 GMAC） */
  wFixed: Float64Array
  /** 實際作用到 DTC 的 gain（定點 GMAC） */
  wFixedApplied: Float64Array
  wFloat: Float64Array
  wFloatApplied: Float64Array
  /** 每個 block 的 a */
  a: Float64Array
  gFixed: Float64Array
  gFloat: Float64Array
  analytic: FixedLoopAnalytic
  stats: FixedLoopStats
  warnings: string[]
}

function checkFixedParams(p: FixedLoopParams): void {
  const errs: string[] = []
  if (!Number.isInteger(p.bx) || p.bx < 2 || p.bx > 16) errs.push(`B_x 必須為 2…16 的整數（收到 ${p.bx}）`)
  if (!Number.isInteger(p.log2N) || p.log2N < 0 || p.log2N > 16) errs.push(`log2 N 必須為 0…16 的整數（收到 ${p.log2N}）`)
  if (!Number.isInteger(p.accBits) || p.accBits < 2 || p.accBits > 48) errs.push(`B_acc 必須為 2…48 的整數（收到 ${p.accBits}）`)
  if (!Number.isInteger(p.gFracBits) || p.gFracBits < 0 || p.gFracBits > 24) errs.push(`F_G 必須為 0…24 的整數（收到 ${p.gFracBits}）`)
  if (!Number.isInteger(p.numBlocks) || p.numBlocks < 2 || p.numBlocks > 20000) errs.push(`block 數必須為 2…20000（收到 ${p.numBlocks}）`)
  if (2 ** p.log2N * p.numBlocks > 2 ** 24) errs.push(`N × blocks = ${2 ** p.log2N * p.numBlocks} 超過上限 2^24（請減少 N 或 block 數）`)
  if (!(p.sigmaV >= 0)) errs.push('σ_v 必須 ≥ 0')
  if (!(p.physMax > p.physMin)) errs.push('實體範圍需 physMax > physMin')
  if (!(p.regMin <= p.physMin && p.regMax >= p.physMax)) errs.push('內部暫存器範圍必須包住實體範圍（regMin ≤ physMin、regMax ≥ physMax）')
  if (!(p.dsmFrac >= 0 && p.dsmFrac < 1)) errs.push('dsmFrac 必須在 [0, 1)')
  if (p.wLsb !== undefined && !(p.wLsb >= 0 && Number.isFinite(p.wLsb))) errs.push(`W 的 LSB Δ_W 必須 ≥ 0（0 = 浮點；收到 ${p.wLsb}）`)
  if (errs.length) throw new Error(`gmac 定點迴路參數錯誤：\n${errs.join('\n')}`)
}

function analyticFor(p: FixedLoopParams, Ex2: number, ExInt2: number, pMinMeasured: number): FixedLoopAnalytic {
  const N = 2 ** p.log2N
  const Kq = p.sigmaV > 0 ? SQRT_2_OVER_PI / p.sigmaV : NaN
  const K = Kq * Ex2
  const g = p.mu * K * (p.gmMode === 'sum' ? N : 1)
  const pole = 1 - g
  const sigmaEta2 = p.gmMode === 'sum' ? N * Ex2 : Ex2 / N
  const sigmaWPred = g > 0 && g < 2 ? Math.abs(p.mu) * Math.sqrt(sigmaEta2 / (1 - pole * pole)) : NaN
  const ell = p.gmMode === 'average' ? p.log2N - p.gFracBits : 0
  const fullScale = 2 ** (p.bx - 1)
  const deltaG = p.gmMode === 'average' ? 2 ** -p.gFracBits / fullScale : 1 / fullScale
  // toward_zero：平均偏差對稱抵消（只造成 dead zone / 增益下降），以 0 計
  const meanRoundErr = p.gmMode === 'average' && p.rounding !== 'toward_zero' ? roundingMeanError(ell, p.rounding) * deltaG : 0
  const biasPredRound = K > 0 ? meanRoundErr / K : 0
  // 第二個取整點：μ·G（格點 μΔ_G）→ W（格點 Δ_W）。E[ΔW] = μ·E[G] + ε̄_WΔ_W ⇒ 等效於 G 多了 ε̄_WΔ_W/μ 的平均誤差
  const wLsb = p.wLsb !== undefined && p.wLsb > 0 ? p.wLsb : 0
  const muAbs = Math.abs(p.mu)
  const wRatio = wLsb > 0 && muAbs > 0 ? wLsb / (muAbs * deltaG) : 0
  const meanIncErr = wLsb > 0 ? incrementMeanError(wRatio, p.wRounding ?? 'half_even') * wLsb : 0
  const biasPredW = g > 0 ? meanIncErr / g : 0
  const incErrAsG = p.mu > 0 ? meanIncErr / p.mu / (p.gmMode === 'sum' ? N : 1) : 0
  // 最負 code 的機率：uniform 有理論值，±FS 永遠用不到最負 code，DSM 用實際序列的頻率
  const pMinTheory = p.codeRange !== 'full' || p.codeKind === 'pm_full_scale' ? 0 : p.codeKind === 'uniform' ? 2 ** -p.bx : pMinMeasured
  const pMin = p.negate === 'inplace' ? pMinTheory : 0
  // sum 模式：E[G_sum] = N·E[G_avg]，固定點相同（rounding 不存在）
  const deltaStar = biasFixedPoint({ K, sigmaV: p.sigmaV, roundErr: meanRoundErr + incErrAsG, pMin })
  const biasPred = Number.isFinite(deltaStar) ? -deltaStar : pMin === 0 ? biasPredRound + biasPredW : NaN
  const sigmaS = Math.sqrt(N * ExInt2)
  const ditherRatio = ell > 0 ? sigmaS / 2 ** ell : Infinity
  const ditherRatioW = wLsb > 0 ? (muAbs * Math.sqrt(sigmaEta2)) / wLsb : Infinity
  return {
    Kq,
    Ex2,
    K,
    g,
    pole,
    sigmaWPred,
    ell,
    deltaG,
    meanRoundErr,
    biasPredRound,
    wRatio,
    meanIncErr,
    biasPredW,
    ditherRatioW,
    pMin,
    biasPred,
    sigmaS,
    ditherRatio,
    linearValid: p.sigmaV > 0 && Math.abs(biasPred) < 0.2 * p.sigmaV,
    sizing: accumulatorSizing(p.bx, N, p.codeRange),
  }
}

// #region core:fixedLoopBlock
/** 閉迴路的一個 block：DTC 用目前 gain → comparator → GMAC → 更新 W。定點與浮點各跑一次（共用 code 與 noise）。 */
function loopBlock(
  xInt: Float64Array,
  z: Float64Array,
  aK: number,
  wApplied: number,
  p: FixedLoopParams,
  bits: Uint8Array,
  fixed: boolean,
): { G: number; overflow: number; negateErrors: number } {
  const N = xInt.length
  const fullScale = 2 ** (p.bx - 1)
  const coef = aK - wApplied // δ = a − w
  if (!fixed) {
    let acc = 0
    for (let n = 0; n < N; n++) {
      const x = xInt[n] / fullScale
      acc += (coef * x + p.sigmaV * z[n] >= 0 ? 1 : -1) * x // 浮點：q·x 精確、無 overflow
    }
    return { G: p.gmMode === 'average' ? acc / N : acc, overflow: 0, negateErrors: 0 }
  }
  for (let n = 0; n < N; n++) bits[n] = comparatorBit(coef * (xInt[n] / fullScale) + p.sigmaV * z[n])
  const out = fixedGmacBlock(xInt, bits, p) // ← 差異：位元級 datapath（取負、B_acc 累加、右移 rounding）
  return { G: out.G, overflow: out.overflow, negateErrors: out.negateErrors }
}
// #endregion

/** 定點 GMAC 與浮點 GMAC 的閉迴路比較（同 seed、同 code、同 noise）。worker 可呼叫。 */
export function runFixedGmacLoop(p: FixedLoopParams): FixedLoopResult {
  checkFixedParams(p)
  const N = 2 ** p.log2N
  const K = p.numBlocks
  const root = createRng(p.seed)
  const src = createIntCodeSource(p.codeKind, p.bx, p.codeRange, p.dsmFrac, root.fork('code'))
  const gauss = createZigguratNormal(root.fork('comparator-noise'))
  const xInt = new Float64Array(N)
  const z = new Float64Array(N)
  const bits = new Uint8Array(N)

  const wFixed = new Float64Array(K + 1)
  const wFixedApplied = new Float64Array(K + 1)
  const wFloat = new Float64Array(K + 1)
  const wFloatApplied = new Float64Array(K + 1)
  const aArr = new Float64Array(K + 1)
  const gFixed = new Float64Array(K)
  const gFloat = new Float64Array(K)
  const reg: GainRegParams = p
  const init = gainUpdate(p.w0, 0, reg)
  let Wf = init.W
  let Wr = init.W
  wFixed[0] = Wf
  wFloat[0] = Wr
  wFixedApplied[0] = init.applied
  wFloatApplied[0] = init.applied
  let accOverflow = 0
  let negateErrors = 0
  let wSat = 0
  let wWrap = 0
  let wSatF = 0
  let wWrapF = 0
  let sxi2 = 0
  let nMin = 0
  const codeLo = codeRangeOf(p.bx, p.codeRange)[0]
  const fullScale = 2 ** (p.bx - 1)
  const aAt = (k: number): number => (p.aStepBlock >= 0 && k >= p.aStepBlock ? p.aStepValue : p.aTrue)
  for (let k = 0; k < K; k++) {
    src.fill(xInt, N)
    for (let n = 0; n < N; n++) {
      z[n] = gauss()
      sxi2 += xInt[n] * xInt[n]
      if (xInt[n] === codeLo) nMin++
    }
    const aK = aAt(k)
    aArr[k] = aK
    const fx = loopBlock(xInt, z, aK, wFixedApplied[k], p, bits, true)
    const fl = loopBlock(xInt, z, aK, wFloatApplied[k], p, bits, false)
    accOverflow += fx.overflow
    negateErrors += fx.negateErrors
    gFixed[k] = fx.G
    gFloat[k] = fl.G
    const uf = gainUpdate(Wf, quantizeIncrement(p.mu * fx.G, p.wLsb ?? 0, p.wRounding ?? 'half_even'), reg) // 定點：更新量先取整到 Δ_W
    const ur = gainUpdate(Wr, p.mu * fl.G, reg)
    Wf = uf.W
    Wr = ur.W
    if (uf.sat) wSat++
    if (uf.wrapped) wWrap++
    if (ur.sat) wSatF++
    if (ur.wrapped) wWrapF++
    wFixed[k + 1] = Wf
    wFloat[k + 1] = Wr
    wFixedApplied[k + 1] = uf.applied
    wFloatApplied[k + 1] = ur.applied
  }
  aArr[K] = aAt(K)
  const total = N * K
  const theo = codeMoments(p.codeKind, p.bx, p.codeRange)
  const Ex2 = theo ? theo.Ex2 : sxi2 / (fullScale * fullScale) / total
  const ExInt2 = theo ? theo.ExInt2 : sxi2 / total
  const analytic = analyticFor(p, Ex2, ExInt2, nMin / total)

  // ── 統計 ──
  const from = p.aStepBlock >= 0 ? Math.min(K, Math.max(p.aStepBlock + Math.ceil((K - p.aStepBlock) / 2), 0)) : Math.ceil(K / 2)
  const to = K
  const meanOf = (arr: Float64Array): number => {
    let s = 0
    for (let i = from; i <= to; i++) s += arr[i]
    return s / (to - from + 1)
  }
  const stdOf = (arr: Float64Array, m: number): number => {
    let s = 0
    for (let i = from; i <= to; i++) s += (arr[i] - m) ** 2
    return to > from ? Math.sqrt(s / (to - from)) : NaN
  }
  const meanFixed = meanOf(wFixedApplied)
  const meanFloat = meanOf(wFloatApplied)
  let aMean = 0
  for (let i = from; i <= to; i++) aMean += Math.min(p.physMax, Math.max(p.physMin, aArr[i]))
  aMean /= to - from + 1
  const diff = new Float64Array(to - from + 1)
  for (let i = from; i <= to; i++) diff[i - from] = wFixedApplied[i] - wFloatApplied[i]
  let dm = 0
  for (const v of diff) dm += v
  dm /= diff.length
  // paired 差值平均的標準誤：w 序列高度相關（pole ≈ 1 − g），以 lag-1 自相關 ρ 的 AR(1) 有效樣本數
  // n_eff = n(1 − ρ)/(1 + ρ) 修正（多 seed 驗證：單一 seed 的 batch means 會低估）
  const biasDiffSe = ar1MeanSe(diff, dm)
  const recoveryTol = Math.max(4 * (Number.isFinite(analytic.sigmaWPred) ? analytic.sigmaWPred : 0), 0.02 * (p.physMax - p.physMin))
  const recovery = (arr: Float64Array): number | null => {
    if (p.aStepBlock < 0 || p.aStepBlock >= K) return null
    const target = Math.min(p.physMax, Math.max(p.physMin, p.aStepValue))
    for (let i = p.aStepBlock; i <= K; i++) if (Math.abs(arr[i] - target) <= recoveryTol) return i - p.aStepBlock
    return null
  }
  // F-04.12 的預測：先「放掉」windup（W_peak − rail）/(g|a′ − rail|)，再以 pole 1 − g 從 rail 指數收斂到 ±tol
  const recoveryPredFor = (W: Float64Array, wrapped: number): number => {
    if (p.aStepBlock < 0 || p.aStepBlock >= K || wrapped > 0) return NaN
    const g = analytic.g
    if (!(g > 0 && g < 1)) return NaN
    const target = Math.min(p.physMax, Math.max(p.physMin, p.aStepValue))
    const Wpk = W[p.aStepBlock]
    const rail = Wpk > p.physMax ? p.physMax : Wpk < p.physMin ? p.physMin : Wpk
    const dist = Math.abs(target - rail)
    const unwind = rail !== Wpk && dist > 0 ? Math.abs(Wpk - rail) / (g * dist) : 0
    const conv = dist > recoveryTol ? Math.log(dist / recoveryTol) / -Math.log(1 - g) : 0
    return unwind + conv
  }
  const stats: FixedLoopStats = {
    window: [from, to],
    meanFixed,
    meanFloat,
    stdFixed: stdOf(wFixedApplied, meanFixed),
    stdFloat: stdOf(wFloatApplied, meanFloat),
    biasFixed: meanFixed - aMean,
    biasFloat: meanFloat - aMean,
    biasDiff: dm,
    biasDiffSe,
    recoveryFixed: recovery(wFixedApplied),
    recoveryFloat: recovery(wFloatApplied),
    recoveryPredFixed: recoveryPredFor(wFixed, wWrap),
    recoveryPredFloat: recoveryPredFor(wFloat, wWrapF),
    recoveryTol,
    accOverflow,
    negateErrors,
    wSat,
    wWrap,
    wSatFloat: wSatF,
    wWrapFloat: wWrapF,
  }

  const warnings = fixedLoopWarnings(p, analytic, stats)
  return {
    params: { ...p },
    k: Float64Array.from({ length: K + 1 }, (_, i) => i),
    wFixed,
    wFixedApplied,
    wFloat,
    wFloatApplied,
    a: aArr,
    gFixed,
    gFloat,
    analytic,
    stats,
    warnings,
  }
}

/** 相關序列平均值的標準誤（AR(1) 近似）：SE = s·√((1 + ρ)/((1 − ρ)n))，ρ 為 lag-1 自相關（夾在 [0, 0.999]）。 */
export function ar1MeanSe(x: ArrayLike<number>, mean: number): number {
  const n = x.length
  if (n < 3) return NaN
  let c0 = 0
  let c1 = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean
    c0 += d * d
    if (i + 1 < n) c1 += d * (x[i + 1] - mean)
  }
  if (!(c0 > 0)) return 0
  const rho = Math.min(0.999, Math.max(0, c1 / c0))
  const s2 = c0 / (n - 1)
  return Math.sqrt((s2 * (1 + rho)) / ((1 - rho) * n))
}

function fmtN(v: number, d = 4): string {
  return Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : String(v)
}

function fixedLoopWarnings(p: FixedLoopParams, an: FixedLoopAnalytic, st: FixedLoopStats): string[] {
  const w: string[] = []
  const N = 2 ** p.log2N
  if (st.accOverflow > 0) {
    w.push(
      `GMAC accumulator 溢位 ${st.accOverflow} 次：B_acc = ${p.accBits} bits < 最壞情況需要的 ${an.sizing.bitsExact} bits（B_x + guard bits）。${p.accOverflow === 'wrap' ? 'wrap 會讓 S 跳到另一端甚至變號，更新方向錯誤' : 'saturate 會讓大誤差時的 G 被截小，迴路變慢但方向正確'}`,
    )
  }
  if (st.negateErrors > 0) {
    w.push(
      `條件取負在 B_x = ${p.bx} bits 內做（inplace）：x = −2^{B_x−1} = ${-(2 ** (p.bx - 1))} 時 −x 溢位回到自己，發生 ${st.negateErrors} 次（q·x 的符號錯誤，每次讓 S 少 2^{B_x} LSB）。平均模型預測 w* − a ≈ ${fmtN(an.biasPred)} fs（最負 code 機率 ${fmtN(an.pMin, 3)}，F-04.15）。請先符號延伸到 B_x+1 bits，或把 code 限制在對稱範圍`,
    )
  }
  if (p.gmMode === 'sum') {
    w.push(`gm_mode=sum 時有效增益放大 N 倍（N = ${N}：g = NμK = ${fmtN(an.g)}；若要與 average 模式相同，μ 需改為 μ/N）`)
  }
  if (Number.isFinite(an.g) && an.g >= 2) w.push(`g ≥ 2：一階模型不穩定（g = ${fmtN(an.g)}，pole = ${fmtN(an.pole)}）`)
  if (p.sigmaV === 0) w.push('σ_v = 0：comparator 為純 sign，沒有雜訊當 dither，K_q 無定義；rounding 偏差與 dead zone 由確定性的 limit cycle 決定')
  if (p.gmMode === 'average' && an.ell > 0 && p.rounding === 'floor' && Math.abs(an.biasPredRound) > 0) {
    w.push(
      `floor（算術右移直接截斷）在 G ≈ 0 附近平均少 ${fmtN((1 - 2 ** -an.ell) / 2)} 個 G-LSB：迴路會停在 E[G] = +(1 − 2^−ℓ)Δ_G/2 ≈ ½Δ_G 的位置 ⇒ w* − a ≈ ${fmtN(an.biasPredRound)} fs（ε̄Δ_G/K）。改用 round-half-even 或保留更多小數位元 F_G`,
    )
  }
  // dead zone：下限依 rounding 模式而定（ditherMinFor：toward_zero 在 0 附近的平台寬 2 個 LSB，下限加倍），回復斜率也用該模式自己的（roundingRestoringSlope）
  if (p.gmMode === 'average' && an.ell > 0 && an.ditherRatio < ditherMinFor(p.rounding)) {
    w.push(
      p.rounding === 'toward_zero'
        ? `σ_S/2^ℓ = ${fmtN(an.ditherRatio, 3)} < ${ditherMinFor(p.rounding)}（toward-zero 的下限是 floor 的兩倍）：|S| < 2^ℓ 時 toward-zero 一律輸出 0，0 兩側的平台合起來寬 2 個 LSB——平衡點 δ = 0 附近的回復斜率只剩 χ ≈ ${fmtN(roundingRestoringSlope(an.ditherRatio, p.rounding), 2)}（1 = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 F_G`
        : `σ_S/2^ℓ = ${fmtN(an.ditherRatio, 3)} < ${DITHER_MIN}：GMAC 雜訊遠小於右移後的 1 個 LSB，取整後的 G 幾乎都是同一個值——平衡點附近的回復斜率只剩 χ ≈ ${fmtN(floorRestoringSlope(an.ditherRatio), 2)}（1 = 沒有取整），迴路實際上停在 dead zone 裡，偏差預測（F-04.11）不再適用。請保留更多小數位元 F_G`,
    )
  }
  const wLsb = p.wLsb !== undefined && p.wLsb > 0 ? p.wLsb : 0
  if (wLsb > 0 && Math.abs(an.biasPredW) > 0) {
    w.push(
      `更新量 μ·G 以 ${ROUNDING_LABEL[p.wRounding ?? 'half_even']} 取整到 W 的 LSB Δ_W = ${fmtN(wLsb)} fs（R = Δ_W/(μΔ_G) = ${fmtN(an.wRatio)}）：平均誤差 ${fmtN(an.meanIncErr)} fs／block ⇒ w* − a ≈ ε̄_WΔ_W/g = ${fmtN(an.biasPredW)} fs（F-04.18）。這個偏差 ∝ 1/g：μ 調小反而更大。請增加 W 的小數位元（Δ_W ≤ 2g × 可容忍偏差）或改用 round-half-even`,
    )
  }
  const wMode = p.wRounding ?? 'half_even'
  if (wLsb > 0 && an.ditherRatioW < ditherMinFor(wMode)) {
    w.push(
      wMode === 'toward_zero'
        ? `μσ_G/Δ_W = ${fmtN(an.ditherRatioW, 3)} < ${ditherMinFor(wMode)}（toward-zero 的下限是 floor 的兩倍）：更新量的絕對值小於一個 W-LSB 時 toward-zero 一律取成 0，0 兩側的平台合起來寬 2 個 LSB——平衡點 δ = 0 附近的回復斜率只剩 χ ≈ ${fmtN(roundingRestoringSlope(an.ditherRatioW, wMode), 2)}，迴路停在 dead zone 裡，偏差預測（F-04.18）不再適用（實體 gain 量化的完整討論見 Ch13）`
        : `μσ_G/Δ_W = ${fmtN(an.ditherRatioW, 3)} < ${DITHER_MIN}：每個 block 的更新量雜訊遠小於一個 W-LSB，取整後絕大多數更新是 0 或 ±1 LSB——平衡點附近的回復斜率只剩 χ ≈ ${fmtN(floorRestoringSlope(an.ditherRatioW), 2)}，迴路停在 dead zone 裡，偏差預測（F-04.18）不再適用（實體 gain 量化的完整討論見 Ch13）`,
    )
  }
  const aMax = Math.max(p.aTrue, p.aStepBlock >= 0 ? p.aStepValue : p.aTrue)
  const aMin = Math.min(p.aTrue, p.aStepBlock >= 0 ? p.aStepValue : p.aTrue)
  if (aMax > p.physMax || aMin < p.physMin) {
    w.push(
      `真實 gain a 超出 DTC 可實現範圍 [${p.physMin}, ${p.physMax}] fs：gain 只能停在 rail，${p.antiWindup ? 'anti-windup 讓積分器同時停在 rail' : '沒有 anti-windup 時內部積分器會持續積分（windup），a 回到範圍內後要先「放掉」多積的量才會恢復'}`,
    )
  }
  if (st.wWrap > 0) w.push(`gain 暫存器 wrap ${st.wWrap} 次：數值跳到另一端，實際作用的 gain 由一個 rail 直接跳到另一個 rail（RTL overflow bug，§16.1 第 8 項）`)
  return w
}

/** 多 seed Monte Carlo：同一組 datapath 參數、不同 seed 的「定點 − 浮點」平均差 */
export interface FixedLoopMc {
  caseIndex: number
  seeds: number[]
  biasDiff: number[]
  mean: number
  /** 跨 seed 的標準誤 sd/√R（各 seed 獨立，不需要 AR(1) 修正） */
  se: number
  /** 該 case 的解析預測 w* − a（F-04.11 + F-04.15） */
  pred: number
}

/** 多組 case（A/B/C）一次計算；mcRuns ≥ 2 時另對第 mcCase 組跑多 seed Monte Carlo（deriveSeed(seed, 'mc-i')）。worker 可呼叫。 */
export function runFixedGmacLoopCases(p: { cases: FixedLoopParams[]; mcRuns?: number; mcCase?: number }): { results: FixedLoopResult[]; mc: FixedLoopMc | null } {
  if (!Array.isArray(p.cases) || p.cases.length < 1 || p.cases.length > 3) throw new Error('cases 必須為 1–3 組參數')
  const results = p.cases.map((c) => runFixedGmacLoop(c))
  const R = Math.floor(p.mcRuns ?? 0)
  let mc: FixedLoopMc | null = null
  if (R >= 2) {
    if (R > 32) throw new Error('mcRuns 必須 ≤ 32')
    const ci = Math.min(p.cases.length - 1, Math.max(0, Math.floor(p.mcCase ?? 0)))
    const c = p.cases[ci]
    const seeds = Array.from({ length: R }, (_, i) => deriveSeed(c.seed, `mc-${i}`))
    const biasDiff = seeds.map((sd) => runFixedGmacLoop({ ...c, seed: sd }).stats.biasDiff)
    const mean = biasDiff.reduce((a, v) => a + v, 0) / R
    const sdev = Math.sqrt(biasDiff.reduce((a, v) => a + (v - mean) ** 2, 0) / (R - 1))
    mc = { caseIndex: ci, seeds, biasDiff, mean, se: sdev / Math.sqrt(R), pred: results[ci].analytic.biasPred }
  }
  return { results, mc }
}

// ───────────────────────────────────────────────────────────────────────────
// 0/1 編碼反面教材：用 blockLms 實際跑三種 comparator_encoding
// ───────────────────────────────────────────────────────────────────────────

export interface EncodingCompareParams {
  N: number
  numBlocks: number
  mu: number
  sigmaV: number
  aTrue: number
  w0: number
  /** Gaussian code 的平均（E[x] ≠ 0 時 bug 才會造成偏差） */
  codeMean: number
  codeSigma: number
  seed: number
  /** Monte Carlo：bug 編碼額外跑幾個 seed（deriveSeed(seed, 'mc-i')）；0 或省略 = 不跑 */
  mcRuns?: number
}

export interface EncodingRun {
  encoding: ComparatorEncoding
  w: Float64Array
  meanW: number
  stdW: number
  wStarMeanField: number
  wStarLinear: number
  K: number
  g: number
  warnings: string[]
}

export interface EncodingCompareResult {
  k: Float64Array
  runs: EncodingRun[]
  /** 解析：bug 的線性化固定點 a + E[x]/(K_q E[x²])（x 與 x_ref 相同、identity path） */
  bugLinearPred: number
  /** 解析：bug 的精確 mean-field 固定點（Gaussian code 封閉式 h(ξ) = 0，F-04.16；與取樣無關） */
  bugExactPred: number
  /** ξ⋆ = δ⋆ ÷ σ_v（偏差 w⋆ − a = −ξ⋆·σ_v 與 σ_v 精確成正比） */
  bugXi: number
  /** bug 編碼的多 seed Monte Carlo（每個 seed 的後半段平均 w；SE = sd/√R） */
  bugMc: { seeds: number[]; meanW: number[]; mean: number; se: number } | null
  Ex: number
  Ex2: number
  Kq: number
}

export const ENCODINGS: ComparatorEncoding[] = ['bipolar_pm_one', 'unipolar_mapped', 'unipolar_unmapped_bug']

/** 三種 comparator 編碼在同一 seed 下的 w_k（worker 可呼叫）。 */
export function compareEncodings(p: EncodingCompareParams): EncodingCompareResult {
  const base: BlockLmsConfigInput = {
    seed: p.seed,
    gm_accum_samples: p.N,
    num_blocks: p.numBlocks,
    gain_step: p.mu,
    pd_noise_rms_fs: p.sigmaV,
    gain_true: p.aTrue,
    gain_initial: p.w0,
    code_normalization: 'none',
    seeded_pattern: { kind: 'gaussian', parameters: { mean: p.codeMean, sigma: p.codeSigma } },
    record: { sample_trace_blocks: 0, decimate: 1 },
  }
  const runs: EncodingRun[] = ENCODINGS.map((encoding) => {
    const r = runBlockLms({ ...base, comparator_encoding: encoding })
    return {
      encoding,
      w: r.blocks.w,
      meanW: r.metrics.meanW,
      stdW: r.metrics.stdW,
      wStarMeanField: r.analytic.wStarMeanField,
      wStarLinear: r.analytic.wStarLinear,
      K: r.analytic.K,
      g: r.analytic.g,
      warnings: r.warnings,
    }
  })
  const Ex = p.codeMean
  const Ex2 = p.codeMean * p.codeMean + p.codeSigma * p.codeSigma
  const Kq = p.sigmaV > 0 ? SQRT_2_OVER_PI / p.sigmaV : NaN
  const exact = bugFixedPointGaussian({ codeMean: p.codeMean, codeSigma: p.codeSigma, sigmaV: p.sigmaV, aTrue: p.aTrue })
  let bugMc: EncodingCompareResult['bugMc'] = null
  const R = Math.floor(p.mcRuns ?? 0)
  if (R >= 2) {
    const seeds = Array.from({ length: R }, (_, i) => deriveSeed(p.seed, `mc-${i}`))
    const meanW = seeds.map((sd) => runBlockLms({ ...base, seed: sd, comparator_encoding: 'unipolar_unmapped_bug' }).metrics.meanW)
    const mean = meanW.reduce((a, v) => a + v, 0) / R
    const sdev = Math.sqrt(meanW.reduce((a, v) => a + (v - mean) ** 2, 0) / (R - 1))
    bugMc = { seeds, meanW, mean, se: sdev / Math.sqrt(R) }
  }
  return {
    k: Float64Array.from({ length: p.numBlocks + 1 }, (_, i) => i),
    runs,
    bugLinearPred: p.aTrue + Ex / (Kq * Ex2),
    bugExactPred: exact.wStar,
    bugXi: exact.xi,
    bugMc,
    Ex,
    Ex2,
    Kq,
  }
}

/** 在 w = a（δ = 0）時一個 sample 的平均更新 E[b·x]：雜訊對稱 ⇒ P(b = 1) = ½ ⇒ = E[x]/2（勘誤反面測試）。 */
export function unmappedUpdateAtTruth(codes: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < codes.length; i++) s += 0.5 * codes[i]
  return s / codes.length
}
