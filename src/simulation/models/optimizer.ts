/**
 * Learning Rate、Accumulation Length 與 Tracking Schedule 的設計／最佳化（規格 §14、§14.1、§14.2；Ch14；模型層級 L1）。
 *
 * ── 線性化設計模型（全站極性 δ = a − w）──
 *   單參數、近鎖定、block GMAC 雜訊 iid：
 *     G_k ≈ K·δ_k + η_k，K = K_q·C = √(2/π)·|H|cos θ / σ_v [fs⁻¹]，E[η_k] = 0，Var(η_k) = σ_η² ≈ 1/N
 *     w_{k+1} = w_k + μG_k  ⇒  δ_{k+1} = p·δ_k − μη_k，p = 1 − g，g = μK（無因次）
 *   （規格 §12 用 δw = w − w* 所以寫成 +μη_k；二階矩完全相同。）
 *   ⇒ E[δ_B²] = δ0²p^{2B} + μ²σ_η²·(1 − p^{2B})/(1 − p²)
 *   [精確｜線性化 iid 模型]（η 任意分布、p 為負也成立）；對 1-bit Sign-LMS 只在 |δ0| ≪ σ_v 時是好近似
 *   ——δ0 ≳ 0.5σ_v 時 comparator 飽和、每 block 步長被 μ·max|x| 限制（slew-limited），公式低估（勘誤 E48）。
 *   p² = 1（g = 0 或 g = 2）時 (1 − p^{2B})/(1 − p²) → B，E[δ_B²] = δ0² + Bμ²σ_η²（勘誤 E48 的極限）。
 *
 * ── Corner-based 區間（勘誤 E16）──
 *   要求 |E[δ_B]| ≤ ε|δ0|（ε 為無因次相對縮減比，0 < ε < 1）且 PM ≥ PM_t（d = 0：g ≤ 2cos PM_t；PM_t = 60° ⇒ g ≤ 1）：
 *     (1 − ε^{1/B})/K_min ≤ μ ≤ g_max/K_max；非空 ⇔ B ≥ ln ε / ln(1 − g_max·K_min/K_max)。
 *
 * ── 1-bit GMAC 的「exact binomial」引擎（L1）──
 *   x[n] = ±1 iid、u[n] = c·x[n] + s·x[n−1]（c = |H|cos θ、s = |H|sin θ）、e = δ·u + v、v ~ N(0, σ_v²)。
 *   q·x = sign(δ(c + s·y) + v·x)，其中 y = x[n]x[n−1] 為 iid ±1、v·x ~ N(0, σ_v²) 與 y 獨立，
 *   所以一個 block 的 Σq·x = 2(K₁ + K₂) − N，K₁ ~ Bin(N₊, Φ(δ(c+s)/σ_v))、K₂ ~ Bin(N − N₊, Φ(δ(c−s)/σ_v))、
 *   N₊ ~ Bin(N, ½)。這是**精確**的分布（不是 CLT 近似），可以用 O(√N) 的成本跑上千條 chain。
 *   sample-level 的對照引擎是 `blockLms.runBlockLms`（唯讀共用模型）。
 *
 * 所有 worker 函式（run*MonteCarlo、runCalStateMachine*）只吃一個 plain object、回傳可 structured clone 的結果。
 * 純數值、無 React／DOM。
 */

import { binomPmf, createRng, deriveSeed, erf, meanCI, normCdf, type Rng } from '@/simulation/core'
import { runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
const DEG = Math.PI / 180

// ───────────────────────────────────────────────────────────────────────────
// 基本量
// ───────────────────────────────────────────────────────────────────────────

/** 1-bit comparator 小訊號增益 K_q = √(2/π)/σ_v [fs⁻¹]（§5.1）。 */
export function comparatorKq(sigmaV: number): number {
  return SQRT_2_OVER_PI / sigmaV
}

/** 有效 GMAC 斜率 K = K_q·C，C = |H|·cos θ（θ：誤差路徑在 code 頻帶的相位）[fs⁻¹]。 */
export function loopGainK(sigmaV: number, thetaDeg: number, mag = 1): number {
  return comparatorKq(sigmaV) * mag * Math.cos(thetaDeg * DEG)
}

/** 一階、無延遲 calibration loop L(z) = g/(z − 1) 的 phase margin [deg] = 90° − asin(g/2)；g ∉ (0, 2] 時 NaN。 */
export function calPhaseMarginDeg(g: number): number {
  if (!(g > 0 && g <= 2)) return NaN
  return 90 - Math.asin(g / 2) / DEG
}

/**
 * PM ≥ PM_t 所允許的最大 g（d = 0）：90° − asin(g/2) ≥ PM_t ⇔ g ≤ 2 sin(90° − PM_t) = 2cos PM_t。
 * PM_t = 60° 時精確回傳 1（避免 2cos(π/3) = 1.0000000000000002 的捨入）。
 */
export function gMaxForPm(pmTargetDeg: number): number {
  if (pmTargetDeg === 60) return 1
  return Math.max(0, 2 * Math.sin((90 - pmTargetDeg) * DEG))
}

/** 平均誤差時間常數 τ = −1/ln|p| [blocks]（p = 0 時 0；|p| ≥ 1 時 Infinity）。 */
export function timeConstantBlocks(p: number): number {
  const a = Math.abs(p)
  if (a === 0) return 0
  if (a >= 1) return Infinity
  return -1 / Math.log(a)
}

export type CalBwRegime = 'lowpass' | 'no3db' | 'flat' | 'highpass' | 'unstable'

/**
 * 校正迴路係數雜訊轉移 μ/(z − p) 的**精確** −3 dB 頻率（勘誤 E26／E27）：
 *   |H(e^{jΩ})|² = ½|H(1)|² ⇔ 1 − 2p cos Ω + p² = 2(1 − p)² ⇔ sin(Ω/2) = (1 − p)/(2√p)
 * 只在 3 − 2√2 ≤ p < 1（0 < μK ≤ 2√2 − 2 ≈ 0.828）存在；其他區間回傳 NaN 並標示型態。
 * （與 Ch12 calNoise.bw3dbExact 相同的公式；這裡私有實作以免跨章依賴。）
 */
export function calBandwidth3dB(p: number, fu: number): { hz: number; regime: CalBwRegime } {
  if (!(Math.abs(p) < 1)) return { hz: NaN, regime: 'unstable' }
  if (p < 0) return { hz: NaN, regime: 'highpass' }
  if (p === 0) return { hz: NaN, regime: 'flat' }
  const s = (1 - p) / (2 * Math.sqrt(p))
  if (s > 1 + 1e-12) return { hz: NaN, regime: 'no3db' }
  return { hz: ((2 * Math.asin(Math.min(1, s))) / (2 * Math.PI)) * fu, regime: 'lowpass' }
}

// ───────────────────────────────────────────────────────────────────────────
// §14：E[δ_B²] = bias² + variance
// ───────────────────────────────────────────────────────────────────────────

// #region core:geomSum
/**
 * S_B(p) = Σ_{k=0}^{B−1} p^{2k} = (1 − p^{2B})/(1 − p²)。
 * p² = 1 時每一項都是 1 ⇒ S_B = B（勘誤 E48 的 |p| = 1 極限）；p² 接近 1 時改用 expm1 避免相消。
 */
export function geomSum2(p: number, B: number): number {
  if (B <= 0) return 0
  const q = p * p
  if (q === 0) return 1 // 只剩 k = 0 那一項（0⁰ = 1）
  if (q === 1) return B // |p| = 1：B 個 1 相加
  const L = Math.log(q)
  return Math.expm1(B * L) / Math.expm1(L) // = (q^B − 1)/(q − 1) = (1 − q^B)/(1 − q)
}
// #endregion

// #region core:msdAfterBlocks
/**
 * E[δ_B²] = δ0²·p^{2B}（bias²：初始誤差還沒收完）+ μ²σ_η²·Σ_{k<B} p^{2k}（variance：累積的更新雜訊）。
 * [精確｜線性化 iid 模型]；1-bit Sign-LMS 只在 |δ0| ≪ σ_v 時近似（勘誤 E48）。
 */
export function msdAfterBlocks(delta0: number, p: number, mu: number, sigmaEta2: number, B: number): number {
  const bias2 = delta0 * delta0 * Math.pow(p * p, B) // (p^B δ0)²
  const variance = mu * mu * sigmaEta2 * geomSum2(p, B) // μ²σ_η²(1 − p^{2B})/(1 − p²)
  return bias2 + variance
}
// #endregion

export interface MsdSplit {
  /** (E[δ_B])² = δ0²p^{2B} [fs²] */
  bias2: number
  /** Var(δ_B) [fs²] */
  variance: number
  /** E[δ_B²] [fs²] */
  total: number
}

/** 把 E[δ_B²] 拆成 bias² 與 variance（兩項同單位 fs²）。 */
export function msdSplit(delta0: number, p: number, mu: number, sigmaEta2: number, B: number): MsdSplit {
  const bias2 = delta0 * delta0 * Math.pow(p * p, B)
  const variance = mu * mu * sigmaEta2 * geomSum2(p, B)
  return { bias2, variance, total: bias2 + variance }
}

/**
 * 逐 block 遞迴 m_{k+1} = p²·m_k + μ²σ_η²（m_0 = δ0²），回傳 m_0 … m_B（長度 B+1）。
 * 用於「先手算」表格，以及和封閉式 msdAfterBlocks 交叉比對。
 */
export function msdRecursion(delta0: number, p: number, mu: number, sigmaEta2: number, B: number): Float64Array {
  const out = new Float64Array(B + 1)
  out[0] = delta0 * delta0
  for (let k = 0; k < B; k++) out[k + 1] = p * p * out[k] + mu * mu * sigmaEta2
  return out
}

/**
 * Σ_{k=1}^{B} E[δ_k²] = δ0²·q·S_B + μ²σ_η²·(B − q·S_B)/(1 − q)，q = p²。
 * |1 − q|·B 很小時改用三項泰勒展開 Σ_{j<B}(B − j)q^j ≈ B(B+1)/2 − εB(B²−1)/6 + ε²(B+1)B(B−1)(B−2)/24（ε = 1 − q）。
 */
export function integratedMsd(delta0: number, p: number, mu: number, sigmaEta2: number, B: number): number {
  if (B <= 0) return 0
  const q = p * p
  const S = geomSum2(p, B)
  const eps = 1 - q
  let inner: number // Σ_{k=1}^{B} S_k = Σ_{j=0}^{B−1}(B − j)q^j
  if (Math.abs(eps) * B < 1e-4) {
    inner = (B * (B + 1)) / 2 - (eps * (B + 1) * B * (B - 1)) / 6 + (eps * eps * (B + 1) * B * (B - 1) * (B - 2)) / 24
  } else {
    inner = (B - q * S) / eps
  }
  return delta0 * delta0 * q * S + mu * mu * sigmaEta2 * inner
}

// #region core:slewLimited
/**
 * Coarse 階段的 slew-limited 估計（F-14.5；勘誤 E48）：Sign-GMAC 的 |G| ≤ max|x|，每個 block 最多移動 μ·max|x|，
 * 所以把 |δ0| 拉到 δ_target 以內至少要 B ≳ (|δ0| − δ_target)/(μ·max|x|) 個 block（實數下界；已在目標內時為 0）。
 * 這只是下界：erf 未完全飽和時 |E[G]| < max|x|，實際還要多幾個 block。
 */
export function slewLimitedBlocks(delta0: number, target: number, mu: number, xMax = 1): number {
  return Math.max(0, (Math.abs(delta0) - target) / (mu * xMax))
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 不同目標 ⇒ 不同最佳 μ
// ───────────────────────────────────────────────────────────────────────────

export interface DesignModel {
  /** 有效斜率 K = K_q·C [fs⁻¹] */
  K: number
  /** 初始誤差 δ0 = a − w_0 [fs] */
  delta0: number
  /** 每個 block 的 GMAC 雜訊變異數 σ_η²（無因次；average 模式 ≈ 1/N） */
  sigmaEta2: number
  /** 更新次數 B = 總比較次數 / N */
  B: number
  /** trackRamp：PVT 漂移斜率 r [fs/block] */
  driftRate?: number
  /** trackRw：random-walk 漂移每 block 標準差 σ_ζ [fs] */
  driftSigma?: number
  /** spur：觀察的偏移頻率 Ω_s [rad/block]（Ω_s = 2π f_off / f_u） */
  spurOmega?: number
  /** spur：收斂要求 |E[δ_B]| ≤ ε|δ0|（相對，0 < ε < 1；勘誤 E16） */
  eps?: number
}

export type Objective = 'final' | 'fastest' | 'integrated' | 'spur' | 'trackRamp' | 'trackRw'

export const OBJECTIVES: Objective[] = ['final', 'fastest', 'integrated', 'spur', 'trackRamp', 'trackRw']

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  final: '最小終點 RMS（B 次更新後）',
  fastest: '最快初期收斂（平均誤差）',
  integrated: '最小全程積分誤差（1..B 平均）',
  spur: '最小係數擾動／Spur（滿足收斂要求下）',
  trackRamp: '最佳 PVT 追蹤（ramp 漂移）',
  trackRw: '最佳 PVT 追蹤（random-walk 漂移）',
}

/** 每個目標成本的單位（顯示用，KaTeX） */
export const OBJECTIVE_UNIT: Record<Objective, string> = {
  final: '\\mathrm{fs}^2',
  fastest: '\\text{blocks}',
  integrated: '\\mathrm{fs}^2',
  spur: '\\mathrm{fs}^2/(\\mathrm{cycle/block})', // σ_w² = (1/2π)∫S_w dΩ = ∫S_w df（f = Ω/2π，cycle/block）
  trackRamp: '\\mathrm{fs}^2',
  trackRw: '\\mathrm{fs}^2',
}

// #region core:objectiveCost
/** 各種設計目標的成本 J(μ)（越小越好）。g = μK、p = 1 − g。 */
export function objectiveCost(obj: Objective, mu: number, m: DesignModel): number {
  const { K, delta0, sigmaEta2: s2, B } = m
  const g = mu * K
  const p = 1 - g
  switch (obj) {
    case 'final': // E[δ_B²] = bias² + variance（F-14.3）
      return msdAfterBlocks(delta0, p, mu, s2, B)
    case 'fastest': // 平均誤差的時間常數 τ = −1/ln|p|（F-14.10）
      return timeConstantBlocks(p)
    case 'integrated': // (1/B)Σ_{k=1}^{B} E[δ_k²]（F-14.9）
      return integratedMsd(delta0, p, mu, s2, B) / B
    case 'spur': // 穩態係數雜訊 PSD 在 Ω_s：μ²σ_η²/|1 − p e^{−jΩ_s}|²（F-14.11；two-sided，σ_w² = (1/2π)∫S_w dΩ）
      return (mu * mu * s2) / (1 - 2 * p * Math.cos(m.spurOmega ?? 0) + p * p)
    case 'trackRamp': {
      const r = m.driftRate ?? 0 // ramp 漂移：lag² + 穩態雜訊（F-14.12）
      return (r / g) ** 2 + (mu * s2) / (K * (2 - g))
    }
    case 'trackRw': {
      const z = m.driftSigma ?? 0 // random-walk 漂移：(σ_ζ² + μ²σ_η²)/(1 − p²)（F-14.13）
      return (z * z + mu * mu * s2) / (g * (2 - g))
    }
  }
}
// #endregion

// #region core:dJdmu
/**
 * 終點成本的解析導數 dE[δ_B²]/dμ（K ≠ 0、μK ≠ 2）。
 * 用 variance = σ_η²·μ(1 − p^{2B})/(K(2 − μK))（因為 μ²/(1 − p²) = μ/(K(2 − μK))）：
 *   d/dμ[δ0²p^{2B}] = −2BKδ0²p^{2B−1}
 *   d/dμ[variance]  = σ_η²·[2(1 − p^{2B})/(K(2 − μK)²) + 2Bμp^{2B−1}/(2 − μK)]
 */
export function finalCostDerivative(mu: number, m: DesignModel): number {
  const { K, delta0, sigmaEta2: s2, B } = m
  const p = 1 - mu * K
  const h = 2 - mu * K
  const p2Bm1 = Math.pow(p, 2 * B - 1)
  const p2B = p2Bm1 * p
  const dBias = -2 * B * K * delta0 * delta0 * p2Bm1
  const dVar = s2 * ((2 * (1 - p2B)) / (K * h * h) + (2 * B * mu * p2Bm1) / h)
  return dBias + dVar
}
// #endregion

export interface MuSearchOptions {
  /** PM 下限 [deg]（60–90；預設 60 ⇒ g ≤ 1）。 */
  pmTargetDeg?: number
  /** true：移除 PM 限制，只要求 |p| < 1（g < 2，允許振盪收斂）。 */
  allowOscillatory?: boolean
}

export interface MuOptimum {
  objective: Objective
  feasible: boolean
  /** 不可行的原因（必須解釋，例如極性或預算）；給 UI 的文字，數學以 `$…$` 標記（由 @/components 的 mathText 轉成 KaTeX） */
  reason?: string
  /** 最佳 μ [fs] */
  mu: number
  cost: number
  g: number
  p: number
  pmDeg: number
  tauBlocks: number
  /** 可行下限 μ [fs]（spur 目標＝收斂要求；其他為 0） */
  muLo: number
  /** 可行上限 μ [fs]（PM 或穩定性） */
  muHi: number
  /** 最佳點落在邊界上（代表限制條件「綁住」了答案） */
  atBoundary: 'lo' | 'hi' | null
  method: 'closed-form' | 'grid+golden' | 'constraint'
}

/** 黃金分割法在 [a, b] 上找單峰函數的最小值。 */
function goldenMin(f: (x: number) => number, a: number, b: number, iters = 90): { x: number; fx: number } {
  const r = (Math.sqrt(5) - 1) / 2
  let lo = a
  let hi = b
  let x1 = hi - r * (hi - lo)
  let x2 = lo + r * (hi - lo)
  let f1 = f(x1)
  let f2 = f(x2)
  for (let i = 0; i < iters && hi - lo > 1e-14 * Math.max(1, Math.abs(hi)); i++) {
    if (f1 <= f2) {
      hi = x2
      x2 = x1
      f2 = f1
      x1 = hi - r * (hi - lo)
      f1 = f(x1)
    } else {
      lo = x1
      x1 = x2
      f1 = f2
      x2 = lo + r * (hi - lo)
      f2 = f(x2)
    }
  }
  return f1 <= f2 ? { x: x1, fx: f1 } : { x: x2, fx: f2 }
}

/** log 等距格點 + 黃金分割細化（對多數一維成本足夠穩健；回傳最小點與是否落在端點）。 */
function minimizeOnLogGrid(
  f: (x: number) => number,
  lo: number,
  hi: number,
  points = 241,
): { x: number; fx: number; atBoundary: 'lo' | 'hi' | null } {
  const xs: number[] = []
  const ratio = Math.log(hi / lo)
  for (let i = 0; i < points; i++) xs.push(lo * Math.exp((ratio * i) / (points - 1)))
  xs[points - 1] = hi
  let best = 0
  let bestF = Infinity
  for (let i = 0; i < points; i++) {
    const v = f(xs[i])
    if (v < bestF) {
      bestF = v
      best = i
    }
  }
  if (best === points - 1) {
    // 格點最小在右端：真正的最小值可能落在最後兩個格點之間，仍要細化，確認後才標成邊界解
    const r = goldenMin(f, xs[points - 2], hi)
    if (r.x >= hi * (1 - 1e-6) || bestF <= r.fx) return { x: hi, fx: bestF, atBoundary: 'hi' }
    return { x: r.x, fx: r.fx, atBoundary: null }
  }
  const a = xs[Math.max(0, best - 1)]
  const b = xs[Math.min(points - 1, best + 1)]
  const r = goldenMin(f, a, b)
  if (best === 0 && r.x <= xs[0] * (1 + 1e-6)) return { x: r.x, fx: r.fx, atBoundary: 'lo' }
  return { x: r.x, fx: r.fx, atBoundary: null }
}

function infeasible(obj: Objective, reason: string, muLo = NaN, muHi = NaN): MuOptimum {
  return {
    objective: obj,
    feasible: false,
    reason,
    mu: NaN,
    cost: NaN,
    g: NaN,
    p: NaN,
    pmDeg: NaN,
    tauBlocks: NaN,
    muLo,
    muHi,
    atBoundary: null,
    method: 'constraint',
  }
}

/** spur 目標的收斂下限 μ_min = (1 − ε^{1/B})/K（勘誤 E16：ε 為相對比例）。 */
export function convergenceMuMin(K: number, eps: number, B: number): number {
  return (1 - Math.pow(eps, 1 / B)) / K
}

// #region core:optimizeMu
/**
 * 在可行區間內找最佳 μ。可行區間：0 < μ ≤ g_max/K，g_max = 2cos PM_t（或 allowOscillatory 時 g < 2）。
 *   fastest：τ 在 g = 1（p = 0，deadbeat）最小 ⇒ μ = min(1, g_max)/K（封閉式）
 *   spur   ：成本隨 μ 單調遞增 ⇒ 取收斂要求的下限 μ_min = (1 − ε^{1/B})/K（被限制條件決定）
 *   其他   ：數值（log 格點 + 黃金分割）
 */
export function optimizeMu(obj: Objective, m: DesignModel, opts: MuSearchOptions = {}): MuOptimum {
  const { K, B } = m
  if (!(K > 0)) {
    return infeasible(obj, String.raw`C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（$K=${K.toPrecision(4)}\,\mathrm{fs^{-1}}$，$p=1-\mu K>1$）`)
  }
  if (!(B >= 1)) return infeasible(obj, '總預算小於一個 block（$B=0$）：一次更新都做不到，請增加總比較次數或縮小 $N$')
  const gCap = opts.allowOscillatory ? 2 * (1 - 1e-9) : gMaxForPm(opts.pmTargetDeg ?? 60)
  const muHi = gCap / K
  const pack = (mu: number, muLo: number, atBoundary: MuOptimum['atBoundary'], method: MuOptimum['method']): MuOptimum => {
    const g = mu * K
    const p = 1 - g
    return {
      objective: obj,
      feasible: true,
      mu,
      cost: objectiveCost(obj, mu, m),
      g,
      p,
      pmDeg: calPhaseMarginDeg(g),
      tauBlocks: timeConstantBlocks(p),
      muLo,
      muHi,
      atBoundary,
      method,
    }
  }
  if (obj === 'fastest') {
    const g = Math.min(1, gCap)
    return pack(g / K, 0, g === gCap ? 'hi' : null, 'closed-form')
  }
  if (obj === 'spur') {
    const eps = m.eps ?? NaN
    if (!(eps > 0 && eps < 1)) return infeasible(obj, String.raw`$\epsilon$ 必須是相對縮減比 $0<\epsilon<1$（勘誤 E16），收到 ${eps}`)
    const muLo = convergenceMuMin(K, eps, B)
    if (muLo > muHi) {
      return infeasible(obj, String.raw`收斂要求需要 $\mu\ge${muLo.toPrecision(4)}\,\mathrm{fs}$，超過 PM 限制 $\mu\le${muHi.toPrecision(4)}\,\mathrm{fs}$：$B$ 太少或 $\epsilon$ 太嚴`, muLo, muHi)
    }
    return pack(muLo, muLo, 'lo', 'constraint')
  }
  const f = (mu: number) => objectiveCost(obj, mu, m)
  const r = minimizeOnLogGrid(f, muHi * 1e-7, muHi)
  return pack(r.x, 0, r.atBoundary, 'grid+golden')
}
// #endregion

// #region core:asymptoticFinal
/**
 * 大 B、小 g 的封閉近似（把 p^{2B} 換成 e^{−2Bg}、雜訊項換成穩態 μσ_η²/(2K)）：
 *   J(μ) ≈ δ0²e^{−2BμK} + μσ_η²/(2K) ⇒ μ* ≈ ln A/(2BK)，J* ≈ σ_η²(1 + ln A)/(4BK²)，A = 4BK²δ0²/σ_η²。
 * 適用：A ≫ 1（初始誤差遠大於雜訊底）且 g* = ln A/(2B) ≪ 1。
 */
export function asymptoticFinalOptimum(m: DesignModel): { A: number; mu: number; cost: number; valid: boolean } {
  const A = (4 * m.B * m.K * m.K * m.delta0 * m.delta0) / m.sigmaEta2
  const mu = Math.log(A) / (2 * m.B * m.K)
  const cost = (m.sigmaEta2 * (1 + Math.log(A))) / (4 * m.B * m.K * m.K)
  return { A, mu, cost, valid: A >= 20 && Math.log(A) / (2 * m.B) <= 0.25 }
}
// #endregion

/** ramp 追蹤的小 g 近似最佳點：μ* ≈ (4r²/(Kσ_η²))^{1/3}。 */
export function asymptoticRampOptimum(m: DesignModel): number {
  const r = m.driftRate ?? 0
  return Math.cbrt((4 * r * r) / (m.K * m.sigmaEta2))
}

/** random-walk 追蹤的小 g 近似最佳點：μ* ≈ σ_ζ/σ_η，J* ≈ σ_ζσ_η/K。 */
export function asymptoticRwOptimum(m: DesignModel): { mu: number; cost: number } {
  const z = m.driftSigma ?? 0
  const se = Math.sqrt(m.sigmaEta2)
  return { mu: z / se, cost: (z * se) / m.K }
}

// ───────────────────────────────────────────────────────────────────────────
// §14.1：Corner-based 可行區間（勘誤 E16）
// ───────────────────────────────────────────────────────────────────────────

export interface CornerIntervalResult {
  /** 輸入合法（所有 K_i > 0、0 < ε < 1、B ≥ 1） */
  ok: boolean
  reason?: string
  kMin: number
  kMax: number
  /** r = K_min/K_max */
  ratio: number
  /** PM 限制的最大 g（PM_t = 60° 時 1） */
  gMax: number
  /** μ 下限 (1 − ε^{1/B})/K_min [fs] */
  muLo: number
  /** μ 上限 g_max/K_max [fs] */
  muHi: number
  nonEmpty: boolean
  /** 非空所需的最小 B（實數）：ln ε / ln(1 − g_max·r)；g_max·r ≥ 1 時為 0 */
  bMinExact: number
  /** ⌈bMinExact⌉（至少 1） */
  bMin: number
}

// #region core:cornerInterval
/**
 * §14.1（勘誤 E16）：每個 corner i 的平均誤差 E[δ_B] = (1 − μK_i)^B δ0。
 *   收斂：|1 − μK_i|^B ≤ ε 對所有 i ⇔ μ ≥ (1 − ε^{1/B})/K_min（K 最小的 corner 最慢）
 *   PM  ：μK_i ≤ g_max 對所有 i ⇔ μ ≤ g_max/K_max（K 最大的 corner 最先失去 PM）
 *   非空 ⇔ 1 − ε^{1/B} ≤ g_max·r ⇔ B ≥ ln ε / ln(1 − g_max·r)，r = K_min/K_max
 * 以上是 PM_t ≥ 60°（g_max ≤ 1 ⇒ 1 − μK_i ≥ 0）的情形，也就是頁面上推導的版本。
 * PM_t < 60°（g_max > 1）時最快的 corner 會過衝（p < 0），|1 − μK_i| ≤ ε^{1/B} 還多一個上限
 * μK_i ≤ 1 + ε^{1/B}，所以有效上限是 g_eff = min(g_max, 1 + ε^{1/B})；UI 不開放這個範圍，但函式仍回傳正確結果。
 */
export function cornerInterval(Ks: number[], eps: number, B: number, pmTargetDeg = 60): CornerIntervalResult {
  const kMin = Math.min(...Ks)
  const kMax = Math.max(...Ks)
  const gMax = gMaxForPm(pmTargetDeg)
  const base = { kMin, kMax, ratio: kMin / kMax, gMax }
  const bad = (reason: string): CornerIntervalResult => ({
    ...base,
    ok: false,
    reason,
    muLo: NaN,
    muHi: NaN,
    nonEmpty: false,
    bMinExact: NaN,
    bMin: NaN,
  })
  if (Ks.length === 0) return bad('沒有任何 corner')
  if (!(kMin > 0)) return bad(String.raw`C ≤ 0：至少一個 corner 的 $K_i\le0$，更新極性錯誤，任何正 $\mu$ 都會讓該 corner 發散（不是找更好 $\mu$ 的問題）`)
  if (!(eps > 0 && eps < 1)) return bad(String.raw`$\epsilon$ 必須是相對縮減比 $0<\epsilon<1$（$|E[\delta_B]|\le\epsilon|\delta_0|$；勘誤 E16），收到 ${eps}`)
  if (!(B >= 1 && Number.isInteger(B))) return bad(`$B$ 必須是正整數，收到 ${B}`)
  const root = Math.pow(eps, 1 / B) // ε^{1/B}：每個 block 平均誤差至少要縮到的倍數
  const muLo = (1 - root) / kMin // 最慢的 corner 決定下限
  const muHi = Math.min(gMax, 1 + root) / kMax // 最快的 corner 決定上限（PM_t ≥ 60° 時就是 g_max/K_max）
  const r = base.ratio
  // 非空 ⇔ ε^{1/B} ≥ 1 − g_max·r（且 g_max > 1 時還要 ε^{1/B} ≥ (1 − r)/(1 + r)，來自過衝的上限）
  const need = Math.max(1 - gMax * r, gMax > 1 ? (1 - r) / (1 + r) : 0)
  const bMinExact = need <= 0 ? 0 : Math.log(eps) / Math.log(need)
  return {
    ...base,
    ok: true,
    muLo,
    muHi,
    nonEmpty: muLo <= muHi * (1 + 1e-12),
    bMinExact,
    bMin: Math.max(1, Math.ceil(bMinExact - 1e-9)),
  }
}
// #endregion

/** 每個 corner 的平均誤差縮減比 |E[δ_B]/δ0| = |1 − μK_i|^B。 */
export function cornerContraction(mu: number, K: number, B: number): number {
  return Math.pow(Math.abs(1 - mu * K), B)
}

// ───────────────────────────────────────────────────────────────────────────
// 固定總預算 T = N·B：N 與更新次數的取捨
// ───────────────────────────────────────────────────────────────────────────

export interface BudgetRow {
  N: number
  B: number
  /** K 已知時的最佳 μ [fs] 與 RMS [fs] */
  muNominal: number
  rmsNominal: number
  /** K ∈ [K/√ρ, K√ρ] 不確定時，最小化最差情況的 μ 與最差 RMS */
  muRobust: number
  rmsRobust: number
  /** 一階預測（只依賴 T）：√((1 + ln(4TK²δ0²))/(4TK²)) */
  rmsFirstOrder: number
}

// #region core:budgetSplit
/**
 * 固定總比較次數 T：每個 N 有 B = ⌊T/N⌋ 次更新、σ_η² = 1/N。
 * 一階近似 J* ≈ σ_η²(1 + ln A)/(4BK²) = (1 + ln(4TK²δ0²))/(4TK²) 只跟 T = NB 有關（N 本身不重要）；
 * 二階效應：K 精確已知時，更新越少反而略好（極限 B = 1 就是「平均全部再一步到位」），
 * 但 K 有 corner 不確定性時，太少的更新次數無法自我修正，最差情況急劇惡化。
 */
export function budgetSplit(p: {
  T: number
  Ns: number[]
  K: number
  delta0: number
  /** K_max/K_min（≥ 1；1 = K 已知） */
  kSpread?: number
  pmTargetDeg?: number
}): BudgetRow[] {
  const rho = Math.max(1, p.kSpread ?? 1)
  const kGrid = Array.from({ length: 9 }, (_, i) => p.K * Math.pow(rho, i / 8 - 0.5))
  const gMax = gMaxForPm(p.pmTargetDeg ?? 60)
  const firstOrder = Math.sqrt((1 + Math.log(4 * p.T * p.K * p.K * p.delta0 * p.delta0)) / (4 * p.T * p.K * p.K))
  return p.Ns.map((N) => {
    const B = Math.floor(p.T / N)
    const s2 = 1 / N
    if (B < 1) return { N, B, muNominal: NaN, rmsNominal: NaN, muRobust: NaN, rmsRobust: NaN, rmsFirstOrder: firstOrder }
    const nom = optimizeMu('final', { K: p.K, delta0: p.delta0, sigmaEta2: s2, B }, { pmTargetDeg: p.pmTargetDeg })
    const worst = (mu: number) => Math.max(...kGrid.map((k) => msdAfterBlocks(p.delta0, 1 - mu * k, mu, s2, B)))
    const rob = minimizeOnLogGrid(worst, (gMax / kGrid[8]) * 1e-7, gMax / kGrid[8], 161)
    return {
      N,
      B,
      muNominal: nom.mu,
      rmsNominal: Math.sqrt(nom.cost),
      muRobust: rob.x,
      rmsRobust: Math.sqrt(rob.fx),
      rmsFirstOrder: firstOrder,
    }
  })
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 步長排程：fixed μ vs two-phase vs 1/k（Kalman 型）
// ───────────────────────────────────────────────────────────────────────────

// #region core:optimalSchedule
/**
 * 線性模型下「每一步都最小化 E[δ_{k+1}²]」的步長（scalar Kalman／RLS）：
 *   μ_k = K·P_k/(K²P_k + σ_η²)，P_{k+1} = P_k·σ_η²/(K²P_k + σ_η²) ⇔ 1/P_{k+1} = 1/P_k + K²/σ_η²
 *   ⇒ P_B = δ0²/(1 + Bδ0²K²/σ_η²)，μ_k = 1/(K(k + 1 + k₀))，k₀ = σ_η²/(K²δ0²)。
 * 這是同樣 B 次更新所能達到的下界（任何步長序列都不會更好）。
 */
export function optimalSchedule(delta0: number, K: number, sigmaEta2: number, B: number): { mu: Float64Array; P: Float64Array; PB: number; k0: number } {
  const mu = new Float64Array(B)
  const P = new Float64Array(B + 1)
  P[0] = delta0 * delta0
  for (let k = 0; k < B; k++) {
    mu[k] = (K * P[k]) / (K * K * P[k] + sigmaEta2)
    P[k + 1] = (P[k] * sigmaEta2) / (K * K * P[k] + sigmaEta2)
  }
  return { mu, P, PB: (delta0 * delta0) / (1 + (B * delta0 * delta0 * K * K) / sigmaEta2), k0: sigmaEta2 / (K * K * delta0 * delta0) }
}
// #endregion

// #region core:twoPhaseMsd
/**
 * 兩段式（coarse μ₁ 跑 B₁ 次 → fine μ₂ 跑 B₂ 次）的 E[δ²]：
 * 二階矩遞迴 m_{k+1} = p²m_k + μ²σ_η² 對 m 是線性的，所以第二段只要把 δ0² 換成第一段結束時的 m₁。
 */
export function twoPhaseMsd(delta0: number, K: number, sigmaEta2: number, mu1: number, B1: number, mu2: number, B2: number): number {
  const m1 = msdAfterBlocks(delta0, 1 - mu1 * K, mu1, sigmaEta2, B1) // coarse 段結束
  return msdAfterBlocks(Math.sqrt(m1), 1 - mu2 * K, mu2, sigmaEta2, B2) // ← 以 m₁ 當作 fine 段的「δ0²」
}
// #endregion

/** 兩段式全搜尋：B₁ 掃描（log 等距的整數）、μ₁、μ₂ 各自一維最佳化（都在 g ≤ g_max 內）。 */
export function optimizeTwoPhase(
  delta0: number,
  K: number,
  sigmaEta2: number,
  B: number,
  pmTargetDeg = 60,
): { mu1: number; B1: number; mu2: number; B2: number; msd: number } {
  const muHi = gMaxForPm(pmTargetDeg) / K
  const cand = new Set<number>()
  for (let i = 0; i < 28; i++) cand.add(Math.max(1, Math.min(B - 1, Math.round(Math.pow(Math.max(B - 1, 1), i / 27)))))
  let best = { mu1: NaN, B1: 0, mu2: NaN, B2: B, msd: Infinity }
  if (B < 2) {
    const o = optimizeMu('final', { K, delta0, sigmaEta2, B }, { pmTargetDeg })
    return { mu1: o.mu, B1: B, mu2: o.mu, B2: 0, msd: o.cost }
  }
  for (const B1 of cand) {
    const B2 = B - B1
    const bestMu2 = (mu1: number) => {
      const m1 = msdAfterBlocks(delta0, 1 - mu1 * K, mu1, sigmaEta2, B1)
      return minimizeOnLogGrid((mu2) => msdAfterBlocks(Math.sqrt(m1), 1 - mu2 * K, mu2, sigmaEta2, B2), muHi * 1e-6, muHi, 41)
    }
    const r1 = minimizeOnLogGrid((mu1) => bestMu2(mu1).fx, muHi * 1e-4, muHi, 33)
    if (r1.fx < best.msd) {
      const r2 = bestMu2(r1.x)
      best = { mu1: r1.x, B1, mu2: r2.x, B2, msd: r2.fx }
    }
  }
  return best
}

// ───────────────────────────────────────────────────────────────────────────
// 1-bit GMAC：exact binomial 引擎（L1）
// ───────────────────────────────────────────────────────────────────────────

/** GMAC block 模型：x = ±1 iid，u[n] = c·x[n] + s·x[n−1]，comparator 雜訊 σ_v [fs]。 */
export interface GmacModel {
  /** 每個 block 的 comparator 樣本數 */
  N: number
  /** comparator 前雜訊 RMS [fs]（必須 > 0） */
  sigmaV: number
  /** 與 x 同相的路徑增益 c = |H|cos θ（= C） */
  c: number
  /** 正交（延遲一拍）分量 s = |H|sin θ（不提供平均梯度、只增加雜訊與非線性） */
  s: number
}

export function gmacModel(N: number, sigmaV: number, thetaDeg: number, mag = 1): GmacModel {
  const c = mag * Math.cos(thetaDeg * DEG)
  const s = mag * Math.sin(thetaDeg * DEG)
  return { N, sigmaV, c: Math.abs(c) < 1e-15 ? 0 : c, s: Math.abs(s) < 1e-15 ? 0 : s }
}

// #region core:binomialSample
/**
 * 精確的 Binomial(n, p) 抽樣：從眾數開始、往機率較大的一側逐步累加 pmf（inversion），
 * 期望步數 O(√(np(1−p)))。pmf 比值遞推：f(k+1) = f(k)·(n−k)/(k+1)·p/(1−p)。
 */
export function binomialSample(rng: Rng, n: number, p: number): number {
  if (n <= 0 || p <= 0) return 0
  if (p >= 1) return n
  if (p > 0.5) return n - binomialSample(rng, n, 1 - p) // 對稱：讓 p ≤ ½
  const r = p / (1 - p)
  let mode = Math.floor((n + 1) * p)
  if (mode > n) mode = n
  let u = rng.uniform() - binomPmf(mode, n, p)
  if (u <= 0) return mode
  let lo = mode
  let hi = mode
  let fLo = binomPmf(mode, n, p)
  let fHi = fLo
  for (;;) {
    const nextHi = hi < n ? (fHi * (n - hi) * r) / (hi + 1) : 0
    const nextLo = lo > 0 ? (fLo * lo) / ((n - lo + 1) * r) : 0
    if (nextHi === 0 && nextLo === 0) return mode // 數值上已用盡（u 只剩捨入誤差）
    if (nextHi >= nextLo) {
      hi++
      fHi = nextHi
      u -= fHi
      if (u <= 0) return hi
    } else {
      lo--
      fLo = nextLo
      u -= fLo
      if (u <= 0) return lo
    }
  }
}
// #endregion

// #region core:signGmacBlock
/**
 * 一個 block 的 Sign-GMAC 平均輸出 G = (1/N)Σ q[n]x[n]（x = ±1、q = sign(e)、e = δ·u + v）。
 * 因為 q·x = sign(δ(c + s·y) + v·x)，y = x[n]x[n−1] 是 iid ±1、v·x ~ N(0, σ_v²)，
 * 所以 Σq·x 是兩個 binomial 的和 ⇒ 精確抽樣，不需要逐 sample 模擬。
 * bias：外加的 E[q·x] 偏移（用來模擬失鎖或 bad-FCW 時與 δ 無關的假相關）。
 */
export function signGmacBlock(rng: Rng, delta: number, m: GmacModel, bias = 0): number {
  const { N, sigmaV, c, s } = m
  const prob = (z: number) => Math.min(1, Math.max(0, normCdf(z / sigmaV) + bias / 2)) // P(q·x = +1)
  if (s === 0) {
    const k = binomialSample(rng, N, prob(delta * c))
    return (2 * k - N) / N
  }
  const nPlus = binomialSample(rng, N, 0.5) // y = +1 的樣本數
  const k1 = binomialSample(rng, nPlus, prob(delta * (c + s)))
  const k2 = binomialSample(rng, N - nPlus, prob(delta * (c - s)))
  return (2 * (k1 + k2) - N) / N
}
// #endregion

/** Mean-field E[G | δ] = ½[erf(δ(c+s)/(√2σ_v)) + erf(δ(c−s)/(√2σ_v))]（s = 0 時為 erf(δc/(√2σ_v))）。 */
export function gmacMeanField(delta: number, m: GmacModel): number {
  const k = 1 / (Math.SQRT2 * m.sigmaV)
  if (m.s === 0) return erf(delta * m.c * k)
  return 0.5 * (erf(delta * (m.c + m.s) * k) + erf(delta * (m.c - m.s) * k))
}

/** 一個 block 的 G 變異數 (1 − E[G]²)/N（q·x ∈ ±1 且 iid）。 */
export function gmacVariance(delta: number, m: GmacModel): number {
  const mean = gmacMeanField(delta, m)
  return (1 - mean * mean) / m.N
}

// ───────────────────────────────────────────────────────────────────────────
// 三種步長排程的單條 chain（頁面上以 CodeCompare 並排顯示）
// ───────────────────────────────────────────────────────────────────────────

export interface ChainSpec {
  /** 更新次數 B */
  blocks: number
  /** 真實係數 a [fs] */
  a: number
  /** 初始暫存器值 w_0 [fs] */
  w0: number
  gmac: GmacModel
}

// #region core:runFixedMu
/** 固定步長：每個 block w ← w + μG_k。回傳 δ_0 … δ_B（δ = a − w）。 */
export function runFixedMu(rng: Rng, spec: ChainSpec, mu: number): Float64Array {
  const delta = new Float64Array(spec.blocks + 1)
  let w = spec.w0
  delta[0] = spec.a - w
  for (let k = 0; k < spec.blocks; k++) {
    const G = signGmacBlock(rng, spec.a - w, spec.gmac) // 這個 block 的 GMAC 平均輸出 G_k
    const step = mu // ← 差異：整段校正都用同一個 μ
    w += step * G
    delta[k + 1] = spec.a - w
  }
  return delta
}
// #endregion

// #region core:runTwoPhase
/** 兩段式：前 B₁ 個 block 用 coarse μ（大），之後換 fine μ（小）。 */
export function runTwoPhase(rng: Rng, spec: ChainSpec, muCoarse: number, muFine: number, switchBlock: number): Float64Array {
  const delta = new Float64Array(spec.blocks + 1)
  let w = spec.w0
  delta[0] = spec.a - w
  for (let k = 0; k < spec.blocks; k++) {
    const G = signGmacBlock(rng, spec.a - w, spec.gmac) // 這個 block 的 GMAC 平均輸出 G_k
    const step = k < switchBlock ? muCoarse : muFine // ← 差異：先大步長快速收斂，再換小步長壓低雜訊
    w += step * G
    delta[k + 1] = spec.a - w
  }
  return delta
}
// #endregion

// #region core:runInverseK
/** 遞減步長 μ_k = 1/(K(k + 1 + k₀))（Robbins–Monro／scalar Kalman 型；需要知道 K 與 δ0 的量級）。 */
export function runInverseK(rng: Rng, spec: ChainSpec, K: number, k0: number): Float64Array {
  const delta = new Float64Array(spec.blocks + 1)
  let w = spec.w0
  delta[0] = spec.a - w
  for (let k = 0; k < spec.blocks; k++) {
    const G = signGmacBlock(rng, spec.a - w, spec.gmac) // 這個 block 的 GMAC 平均輸出 G_k
    const step = 1 / (K * (k + 1 + k0)) // ← 差異：每個 block 步長遞減，等效於「把所有 G 平均起來」
    w += step * G
    delta[k + 1] = spec.a - w
  }
  return delta
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// Worker：E[δ_B²] vs μ 的 Monte Carlo（exact binomial + blockLms sample-level 對照）
// ───────────────────────────────────────────────────────────────────────────

export interface MsdMonteCarloParams {
  seed: number
  sigmaV: number
  N: number
  thetaDeg: number
  mag?: number
  delta0: number
  B: number
  /** 要檢查的 μ 值 [fs] */
  mus: number[]
  /** 每個 μ 的 exact-binomial chain 數 */
  chains: number
  /** 哪一個 μ 要回傳逐 block 的 E[δ_k²] 曲線 */
  traceIndex: number
  /** blockLms sample-level 對照的 run 數（0 = 略過） */
  blockLmsRuns: number
  /** blockLms 對照使用的 μ（預設 mus[traceIndex]） */
  blockLmsMu?: number
  /** blockLms 的總樣本上限（超過就自動減少 run 數） */
  blockLmsMaxSamples?: number
  /** exact-binomial 的總工作量上限（μ 點數 × chains × B 個 block；超過就自動減少 chains，至少 2） */
  maxChainBlocks?: number
}

export interface MsdMonteCarloResult {
  mus: Float64Array
  /** exact-binomial Sign-GMAC：E[δ_B²] 的樣本平均與 95% CI [fs²] */
  msd: Float64Array
  lo: Float64Array
  hi: Float64Array
  /** 線性模型解析值 [fs²] */
  linear: Float64Array
  /** traceIndex 的 E[δ_k²] 與 95% CI；k 為記錄的 block 索引（B ≤ 511 時為 0…B 全部，否則抽約 400 點） */
  trace: { mu: number; k: Int32Array; msd: Float64Array; lo: Float64Array; hi: Float64Array; linear: Float64Array }
  /** blockLms（sample-level）對照；未執行為 null（原因見 blockLmsNote） */
  blockLms: null | { mu: number; runs: number; samples: number; msdB: number; lo: number; hi: number; curve: Float64Array }
  /** blockLms 略過的原因（runs = 0，或 B 超過 sample-level 模型的上限） */
  blockLmsNote?: string
  /** 實際使用的 chain 數（可能因工作量上限而小於 chainsRequested） */
  chains: number
  chainsRequested: number
}

/** 記錄 E[δ_k²] 的 block 索引：B 小時全部；B 大時取 0…B 的 log／線性混合約 400 個整數（含 0 與 B）。 */
export function traceBlockIndices(B: number, maxPoints = 400): Int32Array {
  if (B + 1 <= 511) return Int32Array.from({ length: B + 1 }, (_, k) => k)
  const set = new Set<number>([0, B])
  const half = Math.floor(maxPoints / 2)
  for (let i = 0; i < half; i++) set.add(Math.round(Math.exp((Math.log(B) * i) / (half - 1))))
  for (let i = 0; i < half; i++) set.add(Math.round((B * i) / (half - 1)))
  return Int32Array.from(Array.from(set).sort((a, b) => a - b))
}

/** worker 可呼叫：每個 μ 跑 chains 條 exact-binomial Sign-GMAC chain，並可選 blockLms sample-level 對照。 */
export function runMsdMonteCarlo(p: MsdMonteCarloParams): MsdMonteCarloResult {
  if (!(p.sigmaV > 0)) throw new Error('σ_v 必須 > 0（σ_v = 0 時 1-bit GMAC 沒有線性化增益）')
  if (!(p.B >= 1)) throw new Error('B = 0：一次更新都沒有，無法做 Monte Carlo')
  const gm = gmacModel(p.N, p.sigmaV, p.thetaDeg, p.mag ?? 1)
  const K = comparatorKq(p.sigmaV) * gm.c
  const s2 = 1 / p.N
  const root = createRng(p.seed)
  const M = p.mus.length
  const msd = new Float64Array(M)
  const lo = new Float64Array(M)
  const hi = new Float64Array(M)
  const linear = new Float64Array(M)
  const budget = p.maxChainBlocks ?? 5e6
  const R = Math.max(2, Math.min(Math.floor(p.chains), Math.floor(budget / Math.max(1, M * p.B))))
  const ti = Math.min(Math.max(0, p.traceIndex), M - 1)
  const tk = traceBlockIndices(p.B)
  const traceSamples: Float64Array[] = Array.from({ length: tk.length }, () => new Float64Array(R))
  for (let i = 0; i < M; i++) {
    const mu = p.mus[i]
    const spec: ChainSpec = { blocks: p.B, a: p.delta0, w0: 0, gmac: gm }
    const final = new Float64Array(R)
    const rng = root.fork(`mu-${i}`)
    for (let r = 0; r < R; r++) {
      const d = runFixedMu(rng, spec, mu)
      final[r] = d[p.B] * d[p.B]
      if (i === ti) for (let j = 0; j < tk.length; j++) traceSamples[j][r] = d[tk[j]] * d[tk[j]]
    }
    const ci = meanCI(final)
    msd[i] = ci.mean
    lo[i] = ci.lo
    hi[i] = ci.hi
    linear[i] = msdAfterBlocks(p.delta0, 1 - mu * K, mu, s2, p.B)
  }
  const n = tk.length
  const tMsd = new Float64Array(n)
  const tLo = new Float64Array(n)
  const tHi = new Float64Array(n)
  const tLin = new Float64Array(n)
  const muT = p.mus[ti]
  for (let j = 0; j < n; j++) {
    const ci = meanCI(traceSamples[j])
    tMsd[j] = ci.mean
    tLo[j] = Number.isFinite(ci.lo) ? ci.lo : ci.mean
    tHi[j] = Number.isFinite(ci.hi) ? ci.hi : ci.mean
    tLin[j] = msdAfterBlocks(p.delta0, 1 - muT * K, muT, s2, tk[j])
  }
  // sample-level 對照：runBlockLms 一次最多 1e6 個 block；B 太大時誠實略過（exact-binomial 仍然有效）
  const blMax = 100000
  const blockLmsNote =
    p.blockLmsRuns <= 0 ? 'blockLms runs = 0：略過' : p.B > blMax ? `B = ${p.B} > ${blMax}：sample-level 對照太慢（且超過 runBlockLms 上限），已略過` : undefined
  return {
    mus: Float64Array.from(p.mus),
    msd,
    lo,
    hi,
    linear,
    trace: { mu: muT, k: tk, msd: tMsd, lo: tLo, hi: tHi, linear: tLin },
    blockLms: blockLmsNote ? null : blockLmsMsdCheck(p, p.blockLmsMu ?? muT, tk),
    blockLmsNote,
    chains: R,
    chainsRequested: Math.floor(p.chains),
  }
}

export interface LinearityCheckParams {
  seed: number
  sigmaV: number
  N: number
  mu: number
  B: number
  /** δ0/σ_v 的列表 */
  ratios: number[]
  chains: number
}

export interface LinearityCheckResult {
  ratios: Float64Array
  delta0: Float64Array
  /** exact-binomial Sign-GMAC 的 E[δ_B²] 與 95% CI */
  msd: Float64Array
  lo: Float64Array
  hi: Float64Array
  /** 線性公式 F-14.3 */
  linear: Float64Array
  /** 線性公式的相對誤差 (linear − MC)/MC（負值 = 低估） */
  relErr: Float64Array
  /** MC 的平均誤差 E[δ_B] 與線性預測 p^Bδ0 */
  meanMc: Float64Array
  meanLinear: Float64Array
}

/** worker 可呼叫：勘誤 E48 的適用範圍——δ0/σ_v 變大時線性公式低估多少（θ = 0、x = ±1）。 */
export function runLinearityCheck(p: LinearityCheckParams): LinearityCheckResult {
  const gm = gmacModel(p.N, p.sigmaV, 0)
  const K = comparatorKq(p.sigmaV)
  const root = createRng(p.seed)
  const n = p.ratios.length
  const out: LinearityCheckResult = {
    ratios: Float64Array.from(p.ratios),
    delta0: new Float64Array(n),
    msd: new Float64Array(n),
    lo: new Float64Array(n),
    hi: new Float64Array(n),
    linear: new Float64Array(n),
    relErr: new Float64Array(n),
    meanMc: new Float64Array(n),
    meanLinear: new Float64Array(n),
  }
  const R = Math.max(2, Math.floor(p.chains))
  p.ratios.forEach((ratio, i) => {
    const d0 = ratio * p.sigmaV
    const spec: ChainSpec = { blocks: p.B, a: d0, w0: 0, gmac: gm }
    const rng = root.fork(`ratio-${i}`)
    const sq = new Float64Array(R)
    let sum = 0
    for (let r = 0; r < R; r++) {
      const d = runFixedMu(rng, spec, p.mu)[p.B]
      sq[r] = d * d
      sum += d
    }
    const ci = meanCI(sq)
    const lin = msdAfterBlocks(d0, 1 - p.mu * K, p.mu, 1 / p.N, p.B)
    out.delta0[i] = d0
    out.msd[i] = ci.mean
    out.lo[i] = ci.lo
    out.hi[i] = ci.hi
    out.linear[i] = lin
    out.relErr[i] = (lin - ci.mean) / ci.mean
    out.meanMc[i] = sum / R
    out.meanLinear[i] = Math.pow(1 - p.mu * K, p.B) * d0
  })
  return out
}

/** 以共用 sample-level 模型 runBlockLms 跑多個 seeds，估計 E[δ_k²]（唯讀使用 blockLms.ts）；curve 對應 tk 的 block 索引。 */
function blockLmsMsdCheck(p: MsdMonteCarloParams, mu: number, tk: Int32Array): NonNullable<MsdMonteCarloResult['blockLms']> {
  const perRun = p.N * p.B
  const cap = p.blockLmsMaxSamples ?? 2 ** 23
  const runs = Math.max(2, Math.min(p.blockLmsRuns, Math.floor(cap / perRun)))
  const gm = gmacModel(p.N, p.sigmaV, p.thetaDeg, p.mag ?? 1)
  const path: BlockLmsConfigInput['pll_error_path'] =
    gm.s === 0 && gm.c === 1 ? { kind: 'identity', parameters: {} } : { kind: 'fir', parameters: { taps: [gm.c, gm.s] } }
  const sq: Float64Array[] = Array.from({ length: tk.length }, () => new Float64Array(runs)) // 只存 tk 對應的 block（tk 的最後一個是 B）
  for (let r = 0; r < runs; r++) {
    const res = runBlockLms({
      seed: deriveSeed(p.seed, `blocklms-${r}`),
      gm_accum_samples: p.N,
      gain_initial: 0,
      gain_true: p.delta0,
      gain_step: mu,
      pd_noise_rms_fs: p.sigmaV,
      code_normalization: 'none',
      num_blocks: p.B,
      pll_error_path: path,
      seeded_pattern: { kind: 'iid_pm_one', parameters: {} },
      record: { sample_trace_blocks: 0, decimate: 1 },
    })
    for (let j = 0; j < tk.length; j++) {
      const d = p.delta0 - res.blocks.w[tk[j]]
      sq[j][r] = d * d
    }
  }
  const curve = new Float64Array(tk.length)
  for (let j = 0; j < tk.length; j++) curve[j] = meanCI(sq[j]).mean
  const ci = meanCI(sq[tk.length - 1])
  return { mu, runs, samples: runs * perRun, msdB: ci.mean, lo: ci.lo, hi: ci.hi, curve }
}

// ───────────────────────────────────────────────────────────────────────────
// Worker：三種排程的 Monte Carlo
// ───────────────────────────────────────────────────────────────────────────

export interface ScheduleMcParams {
  seed: number
  sigmaV: number
  N: number
  thetaDeg: number
  delta0: number
  B: number
  muFixed: number
  muCoarse: number
  muFine: number
  switchBlock: number
  chains: number
  /** 總工作量上限（3 種排程 × chains × B 個 block；超過就自動減少 chains，至少 2） */
  maxChainBlocks?: number
}

export interface ScheduleMcResult {
  /** 各排程的逐 block E[δ_k²]（k = 0…B）[fs²] */
  fixed: Float64Array
  twoPhase: Float64Array
  inverseK: Float64Array
  /** 終點 E[δ_B²] 的 95% CI */
  finalCI: { fixed: [number, number]; twoPhase: [number, number]; inverseK: [number, number] }
  /** 線性模型的解析曲線 */
  linFixed: Float64Array
  linTwoPhase: Float64Array
  linInverseK: Float64Array
  /** 每種排程的前 3 條樣本 chain（δ_k） */
  samples: { fixed: Float64Array[]; twoPhase: Float64Array[]; inverseK: Float64Array[] }
  /** 實際使用的 chain 數（工作量上限可能使它小於 chainsRequested） */
  chains: number
  chainsRequested: number
  k0: number
}

/** worker 可呼叫：fixed μ／two-phase／1/k 三種排程在相同條件下的 E[δ_k²]。 */
export function runScheduleMonteCarlo(p: ScheduleMcParams): ScheduleMcResult {
  if (!(p.sigmaV > 0)) throw new Error('σ_v 必須 > 0')
  const gm = gmacModel(p.N, p.sigmaV, p.thetaDeg)
  const K = comparatorKq(p.sigmaV) * gm.c
  if (!(K > 0)) throw new Error('C ≤ 0：更新極性錯誤，三種排程都會發散（先修正 polarity）')
  const s2 = 1 / p.N
  const k0 = s2 / (K * K * p.delta0 * p.delta0)
  const spec: ChainSpec = { blocks: p.B, a: p.delta0, w0: 0, gmac: gm }
  const R = Math.max(2, Math.min(Math.floor(p.chains), Math.floor((p.maxChainBlocks ?? 5e6) / Math.max(1, 3 * p.B))))
  const root = createRng(p.seed)
  const acc = { fixed: new Float64Array(p.B + 1), twoPhase: new Float64Array(p.B + 1), inverseK: new Float64Array(p.B + 1) }
  const fin = { fixed: new Float64Array(R), twoPhase: new Float64Array(R), inverseK: new Float64Array(R) }
  const samples: ScheduleMcResult['samples'] = { fixed: [], twoPhase: [], inverseK: [] }
  for (let r = 0; r < R; r++) {
    const runs = {
      fixed: runFixedMu(root.fork(`fixed-${r}`), spec, p.muFixed),
      twoPhase: runTwoPhase(root.fork(`two-${r}`), spec, p.muCoarse, p.muFine, p.switchBlock),
      inverseK: runInverseK(root.fork(`invk-${r}`), spec, K, k0),
    }
    for (const key of ['fixed', 'twoPhase', 'inverseK'] as const) {
      const d = runs[key]
      for (let k = 0; k <= p.B; k++) acc[key][k] += d[k] * d[k]
      fin[key][r] = d[p.B] * d[p.B]
      if (r < 3) samples[key].push(d)
    }
  }
  for (const key of ['fixed', 'twoPhase', 'inverseK'] as const) for (let k = 0; k <= p.B; k++) acc[key][k] /= R
  const ci = (x: Float64Array): [number, number] => {
    const c = meanCI(x)
    return [c.lo, c.hi]
  }
  const linFixed = new Float64Array(p.B + 1)
  const linTwoPhase = new Float64Array(p.B + 1)
  const opt = optimalSchedule(p.delta0, K, s2, p.B)
  for (let k = 0; k <= p.B; k++) {
    linFixed[k] = msdAfterBlocks(p.delta0, 1 - p.muFixed * K, p.muFixed, s2, k)
    const b1 = Math.min(k, p.switchBlock)
    linTwoPhase[k] = twoPhaseMsd(p.delta0, K, s2, p.muCoarse, b1, p.muFine, k - b1)
  }
  return {
    ...acc,
    finalCI: { fixed: ci(fin.fixed), twoPhase: ci(fin.twoPhase), inverseK: ci(fin.inverseK) },
    linFixed,
    linTwoPhase,
    linInverseK: opt.P,
    samples,
    chains: R,
    chainsRequested: Math.floor(p.chains),
    k0,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Jacobian／斜率量測（§10.2、第 10 課的 6 步流程）
// ───────────────────────────────────────────────────────────────────────────

// #region core:measureSlope
/**
 * 凍結 w，分別在 w + Δ 與 w − Δ 各跑 M 個 block，K̂ = (Ḡ₋ − Ḡ₊)/(2Δ)（= −∂E[G]/∂w 的中央差分）。
 * 標準誤 se ≈ √(σ_η²/(2M))/Δ（Ḡ± 各有 σ_η²/M 的變異）。
 * 截斷偏差（erf 的三階項）：E[K̂]/(K_q·c) ≈ 1 − Δ²·E[x·u³]/(6σ_v²·c)；本模型 E[x·u³] = c³ + 3cs²
 * ⇒ 相對偏差 ≈ −Δ²(c² + 3s²)/(6σ_v²)（θ = 0 時才化簡成 −(Δc)²/(6σ_v²)）。見 slopeTruncationBias。
 */
export function measureSlope(rng: Rng, delta: number, m: GmacModel, Delta: number, M: number): { kHat: number; se: number; gPlus: number; gMinus: number } {
  let gPlus = 0
  let gMinus = 0
  for (let i = 0; i < M; i++) gPlus += signGmacBlock(rng, delta - Delta, m) // w + Δ ⇒ δ − Δ
  for (let i = 0; i < M; i++) gMinus += signGmacBlock(rng, delta + Delta, m) // w − Δ ⇒ δ + Δ
  gPlus /= M
  gMinus /= M
  const se = Math.sqrt(1 / (2 * m.N * M)) / Delta // Var(K̂) = [Var(Ḡ₋) + Var(Ḡ₊)]/(4Δ²) = σ_η²/(2MΔ²)
  return { kHat: (gMinus - gPlus) / (2 * Delta), se, gPlus, gMinus }
}
// #endregion

/**
 * 中央差分斜率量測的截斷偏差（三階泰勒）：E[K̂]/(K_q c) − 1 ≈ −Δ²(c² + 3s²)/(6σ_v²)。
 * 推導：erf(z) ≈ (2/√π)(z − z³/3) ⇒ E[G](δ) ≈ K_q[δ·E[xu] − δ³E[xu³]/(6σ_v²)]，
 * u = c·x[n] + s·x[n−1]、x = ±1 iid ⇒ E[xu] = c、E[xu³] = c³ + 3cs²（交叉項期望為 0）。
 * c = 0 時相對偏差無定義（回傳 NaN）。
 */
export function slopeTruncationBias(m: GmacModel, Delta: number): number {
  if (m.c === 0) return NaN
  return -(Delta * Delta * (m.c * m.c + 3 * m.s * m.s)) / (6 * m.sigmaV * m.sigmaV)
}

export interface CornerSpec {
  /** corner 名稱，例如 'SS / −40°C' */
  name?: string
  sigmaV: number
  thetaDeg: number
  mag?: number
}

export interface CornerSlopeResult {
  /** 線性化 K_i = K_q·C_i */
  kLinear: number[]
  /** mean-field 中央差分的期望值（含截斷偏差） */
  kMeanField: number[]
  /** 量測 K̂_i 與標準誤 */
  kHat: number[]
  se: number[]
}

/** 量測每個 corner 的 K̂（exact binomial GMAC；成本很低，可在主執行緒執行）。 */
export function measureCornerSlopes(p: { seed: number; N: number; Delta: number; M: number; corners: CornerSpec[] }): CornerSlopeResult {
  const root = createRng(p.seed)
  const out: CornerSlopeResult = { kLinear: [], kMeanField: [], kHat: [], se: [] }
  p.corners.forEach((c, i) => {
    const gm = gmacModel(p.N, c.sigmaV, c.thetaDeg, c.mag ?? 1)
    out.kLinear.push(comparatorKq(c.sigmaV) * gm.c)
    out.kMeanField.push((gmacMeanField(p.Delta, gm) - gmacMeanField(-p.Delta, gm)) / (2 * p.Delta))
    const r = measureSlope(root.fork(`corner-${i}`), 0, gm, p.Delta, p.M)
    out.kHat.push(r.kHat)
    out.se.push(r.se)
  })
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// §14.2：Calibration State Machine（L1 GMAC + RTL 風格控制器；registerLsb > 0 時為 L5）
// ───────────────────────────────────────────────────────────────────────────

export const CAL_STATES = ['RESET', 'LOCK', 'COARSE', 'VERIFY', 'FINE', 'TRACK', 'FREEZE', 'RESTART', 'FAULT'] as const
export type CalState = (typeof CAL_STATES)[number]

export const CAL_STATE_LABEL: Record<CalState, string> = {
  RESET: 'Reset / Initialize',
  LOCK: 'PLL Lock Check（暫停更新）',
  COARSE: 'Coarse（大步長）',
  VERIFY: 'Verify（收斂 + 極性／偏差測試）',
  FINE: 'Fine（小步長）',
  TRACK: 'Track（低頻寬背景追蹤）',
  FREEZE: 'Freeze（低雜訊模式／bad-FCW 暫停）',
  RESTART: 'Restart（大變化後重新校正）',
  FAULT: 'Fault（保持 last-known-good）',
}

export interface CalSmParams {
  seed: number
  /** 模擬的 block 總數 */
  blocks: number
  N: number
  /** comparator 雜訊 RMS [fs] */
  sigmaV: number
  /** 誤差路徑相位 θ [deg]（C = cos θ） */
  thetaDeg: number
  /** 初始真實係數 a_0 [fs] */
  a0: number
  /** 初始暫存器值 w_0 [fs] */
  w0: number
  /** PVT ramp 漂移 r [fs/block] */
  driftPerBlock: number
  /** 大變化（mode／PVT step）發生的 block（< 0 = 無） */
  stepBlock: number
  /** step 大小 Δa [fs] */
  stepSize: number
  /** 開機鎖定所需 block 數 */
  lockBlocks: number
  /** 失鎖事件：開始 block 與長度（長度 0 = 無） */
  lockLossStart: number
  lockLossLen: number
  /** 失鎖期間 GMAC 的假相關 β（G ≈ ±β + 雜訊） */
  unlockBias: number
  /** bad-FCW 視窗：C 乘上 badFcwGain，並加上假相關 badFcwBias */
  badFcwStart: number
  badFcwLen: number
  badFcwGain: number
  badFcwBias: number
  /** 低雜訊模式（要求 freeze）視窗 */
  lowNoiseStart: number
  lowNoiseLen: number
  /** 步長 [fs] */
  muCoarse: number
  muFine: number
  muTrack: number
  coarseBlocks: number
  fineBlocks: number
  /** VERIFY：block 數（偶數；前半 w+Δ、後半 w−Δ）、擾動 Δ [fs]、殘差容許 [fs]、極性 z 門檻 */
  verifyBlocks: number
  verifyDelta: number
  verifyTol: number
  verifyZ: number
  /** TRACK 的 G 移動平均視窗、警報門檻（以 σ_G/√W 為單位）與持續 block 數 */
  trackWindow: number
  alarmHiZ: number
  alarmLoZ: number
  alarmHold: number
  /** 暫存器範圍 [fs] 與 clip 偵測 */
  wMin: number
  wMax: number
  clipBlocks: number
  /** 每 block 最大更新量 |Δw| [fs]（0 = 不限） */
  maxStep: number
  maxRetries: number
  badFcwPolicy: 'freeze' | 'ignore'
  lockDetect: boolean
  clipDetect: boolean
  hysteresis: boolean
  fallback: boolean
  /** 暫存器 LSB [fs]（0 = 理想浮點；> 0 為 L5 定點，更新量小於 ½ LSB 會被吃掉） */
  registerLsb: number
  /** 對照組 A：固定「快」μ（通常 = μ_fine），沒有狀態機與 guards [fs] */
  baselineMu: number
  /** 對照組 B：固定「安靜」μ（通常 = μ_track），沒有狀態機與 guards [fs] */
  baselineMu2: number
  /** 評估穩態 RMS 的起始 block */
  evalStart: number
  /** 收斂判定門檻 [fs]：MC 的 RMS(k) 首次落到此值以下的 block */
  convTarget: number
}

export interface CalEvent {
  k: number
  kind: 'state' | 'lock' | 'verify' | 'alarm' | 'clip' | 'fault' | 'freeze' | 'fcw'
  /** 給 UI 的事件說明；數學以 `$…$` 標記（mathText 轉成 KaTeX） */
  msg: string
}

export interface CalSmResult {
  a: Float64Array
  w: Float64Array
  /** 暫存器誤差 δ_k = a_k − w_k [fs]（不含 VERIFY 的 ±Δ 擾動） */
  delta: Float64Array
  /** DTC 實際看到的誤差 a_k − w_applied,k [fs]：VERIFY 期間 w_applied = w ± Δ，其他狀態與 delta 相同 */
  deltaApplied: Float64Array
  mu: Float64Array
  G: Float64Array
  state: Uint8Array
  /** 對照組 A（固定快 μ）與 B（固定安靜 μ）的暫存器與誤差 */
  wBase: Float64Array
  deltaBase: Float64Array
  wBase2: Float64Array
  deltaBase2: Float64Array
  events: CalEvent[]
  summary: {
    firstTrackBlock: number
    restarts: number
    verifyFails: number
    clipEvents: number
    fault: boolean
    /** 評估視窗（k ≥ evalStart）內的 RMS [fs]：狀態機用 DTC 實際誤差 deltaApplied（VERIFY 的 ±Δ 也算進去，才是公平的比較） */
    rmsEval: number
    /** 同一視窗、只看暫存器誤差 delta 的 RMS [fs]（不含 VERIFY 擾動；用來看「係數本身」多準） */
    rmsEvalRegister: number
    rmsEvalBase: number
    rmsEvalBase2: number
    /** VERIFY 狀態佔用的 block 數（每個 block 都讓 DTC 多 ±Δ 的誤差） */
    verifyBlocksUsed: number
    /** 低雜訊視窗內係數被改動的 block 數 */
    updatesInLowNoise: number
    updatesInLowNoiseBase: number
    updatesInLowNoiseBase2: number
  }
}

/** 狀態機的內部暫存器（RTL 中對應 state register、計數器、LKG 暫存器等）。 */
export interface CalCtx {
  state: CalState
  saved: CalState | null
  count: number
  w: number
  lkg: number | null
  retries: number
  gPlus: number
  gMinus: number
  win: Float64Array
  winN: number
  winI: number
  winSum: number
  alarmCount: number
  clipCount: number
  restarts: number
  verifyFails: number
  clipEvents: number
}

/** 這個 block 的外部條件（由情境產生，狀態機只能「觀察」lock detect 等旗標）。 */
export interface CalInputs {
  k: number
  locked: boolean
  badFcw: boolean
  lowNoise: boolean
}

const UPDATING: ReadonlySet<CalState> = new Set<CalState>(['COARSE', 'VERIFY', 'FINE', 'TRACK'])

function enter(ctx: CalCtx, s: CalState): void {
  ctx.state = s
  ctx.count = 0
  if (s === 'VERIFY') {
    ctx.gPlus = 0
    ctx.gMinus = 0
  }
  if (s === 'TRACK') {
    ctx.winN = 0
    ctx.winI = 0
    ctx.winSum = 0
    ctx.alarmCount = 0
  }
}

/** 開機時的狀態機暫存器（state = RESET）。 */
export function createCalCtx(cfg: CalSmParams): CalCtx {
  return {
    state: 'RESET',
    saved: null,
    count: 0,
    w: cfg.w0,
    lkg: null,
    retries: 0,
    gPlus: 0,
    gMinus: 0,
    win: new Float64Array(Math.max(1, Math.floor(cfg.trackWindow))),
    winN: 0,
    winI: 0,
    winSum: 0,
    alarmCount: 0,
    clipCount: 0,
    restarts: 0,
    verifyFails: 0,
    clipEvents: 0,
  }
}

// #region core:calStep
/**
 * 狀態機的一個 block：①全域 guards（lock、freeze／bad-FCW）→ ②依狀態決定 μ 與實際作用的 w →
 * ③量測 GMAC → ④更新（max-step、定點、clip）→ ⑤狀態轉移（verify、track 警報、clip fallback）。
 * 回傳本 block 的 μ（0 = 沒有更新）、G，以及 DTC 實際使用的 w_applied（VERIFY 時 = w ± Δ）。
 */
export function calStep(
  ctx: CalCtx,
  inp: CalInputs,
  cfg: CalSmParams,
  measure: (wApplied: number) => number,
  log: (kind: CalEvent['kind'], msg: string) => void,
): { mu: number; G: number; acted: CalState; wApplied: number } {
  // #region core:calGuards
  // ① 全域 guards（優先於一般狀態邏輯）
  if (cfg.lockDetect && !inp.locked && (UPDATING.has(ctx.state) || ctx.state === 'FREEZE' || ctx.state === 'RESTART')) {
    ctx.saved = ctx.state === 'COARSE' || ctx.state === 'RESTART' ? 'COARSE' : 'VERIFY' // 重新鎖定後先驗證
    enter(ctx, 'LOCK')
    log('lock', 'lock detect：失鎖，停止更新、保持 $w$')
  }
  const holdReq = inp.lowNoise || (inp.badFcw && cfg.badFcwPolicy === 'freeze')
  if (holdReq && UPDATING.has(ctx.state)) {
    ctx.saved = ctx.state
    enter(ctx, 'FREEZE')
    log('freeze', inp.lowNoise ? '低雜訊模式：Freeze（不動係數）' : 'bad-FCW policy：暫停更新')
  }
  // #endregion

  // ② 依狀態決定 μ 與 DTC 實際使用的 w
  const acted = ctx.state
  let mu = 0
  let wApplied = ctx.w
  let next: CalState | null = null
  const half = Math.max(1, Math.floor(cfg.verifyBlocks / 2))
  switch (ctx.state) {
    case 'RESET':
      ctx.w = cfg.w0
      ctx.saved = 'COARSE'
      next = 'LOCK'
      break
    case 'LOCK':
      if (cfg.lockDetect ? inp.locked : inp.k >= cfg.lockBlocks) next = ctx.saved ?? 'COARSE'
      break
    case 'FREEZE':
      if (!holdReq) next = ctx.saved ?? 'TRACK'
      break
    case 'COARSE':
      mu = cfg.muCoarse
      if (ctx.count + 1 >= cfg.coarseBlocks) next = 'VERIFY'
      break
    case 'VERIFY':
      wApplied = ctx.w + (ctx.count < half ? cfg.verifyDelta : -cfg.verifyDelta) // ±Δ 擾動量測斜率
      break
    case 'FINE':
      mu = cfg.muFine
      if (ctx.count + 1 >= cfg.fineBlocks) next = 'TRACK'
      break
    case 'TRACK':
      mu = cfg.muTrack
      break
    case 'RESTART':
      next = 'COARSE'
      break
    case 'FAULT':
      break
  }

  // ③ 量測（這一個 block 的 GMAC 平均輸出）
  const G = measure(wApplied)

  // ④ 更新：max-step → 定點 → 暫存器飽和
  if (mu !== 0) {
    let dw = mu * G
    if (cfg.maxStep > 0) dw = Math.max(-cfg.maxStep, Math.min(cfg.maxStep, dw))
    let w = ctx.w + dw
    if (cfg.registerLsb > 0) w = Math.round(w / cfg.registerLsb) * cfg.registerLsb // 小於 ½ LSB 的更新被吃掉
    ctx.w = Math.max(cfg.wMin, Math.min(cfg.wMax, w))
  }
  ctx.clipCount = mu !== 0 && (ctx.w <= cfg.wMin || ctx.w >= cfg.wMax) ? ctx.clipCount + 1 : 0

  // ⑤ 狀態轉移
  if (ctx.state === 'VERIFY') {
    if (ctx.count < half) ctx.gPlus += G
    else ctx.gMinus += G
    if (ctx.count + 1 >= 2 * half) {
      const gp = ctx.gPlus / half
      const gm = ctx.gMinus / half
      const kHat = (gm - gp) / (2 * cfg.verifyDelta) // −∂E[G]/∂w 的中央差分
      const se = Math.sqrt(1 / (2 * cfg.N * half)) / cfg.verifyDelta
      const dHat = (0.5 * (gp + gm)) / kHat // 殘差 δ̂ = Ḡ₀/K̂
      if (!(kHat > cfg.verifyZ * se)) {
        ctx.verifyFails++
        log('fault', String.raw`VERIFY：$\hat K=${kHat.toExponential(3)}\,\mathrm{fs^{-1}}$ 不顯著大於 0（極性錯誤或不可觀測），進入 FAULT`)
        if (cfg.fallback && ctx.lkg !== null) ctx.w = ctx.lkg
        next = 'FAULT'
      } else if (Math.abs(dHat) <= cfg.verifyTol) {
        ctx.lkg = ctx.w
        ctx.retries = 0
        log('verify', String.raw`VERIFY 通過：$\hat K=${kHat.toExponential(3)}\,\mathrm{fs^{-1}}$、$\hat\delta=${dHat.toFixed(2)}\,\mathrm{fs}$`)
        next = 'FINE'
      } else {
        ctx.verifyFails++
        ctx.retries++
        log('verify', String.raw`VERIFY 未通過：$|\hat\delta|=${Math.abs(dHat).toFixed(2)}\,\mathrm{fs}$ 超過容許 ${cfg.verifyTol} fs，回 COARSE（第 ${ctx.retries} 次）`)
        next = ctx.retries > cfg.maxRetries ? 'FAULT' : 'COARSE'
      }
    }
  } else if (ctx.state === 'TRACK') {
    const W = ctx.win.length
    if (ctx.winN === W) ctx.winSum -= ctx.win[ctx.winI]
    else ctx.winN++
    ctx.win[ctx.winI] = G
    ctx.winSum += G
    ctx.winI = (ctx.winI + 1) % W
    if (ctx.winN === W) {
      const mW = Math.abs(ctx.winSum / W)
      const unit = 1 / Math.sqrt(cfg.N * W) // σ_G/√W
      if (cfg.hysteresis) {
        if (mW > cfg.alarmHiZ * unit) ctx.alarmCount++ // Schmitt trigger：高門檻才累計
        else if (mW < cfg.alarmLoZ * unit) ctx.alarmCount = 0 // 低門檻以下才解除
        if (mW < cfg.alarmLoZ * unit) ctx.lkg = ctx.w // 安靜時更新 last-known-good
        if (ctx.alarmCount >= cfg.alarmHold) next = 'RESTART'
      } else if (mW > cfg.alarmHiZ * unit) {
        next = 'RESTART' // 單一門檻、沒有持續時間：雜訊一碰到就重來
      } else {
        ctx.lkg = ctx.w
      }
      if (next === 'RESTART') {
        ctx.restarts++
        log('alarm', String.raw`TRACK 警報：$|\bar G_W|=${mW.toExponential(2)}$ 超過高門檻 $${cfg.alarmHiZ}\,\sigma_G/\sqrt W$，進入 RESTART`)
      }
    }
  }
  if (cfg.clipDetect && ctx.clipCount >= cfg.clipBlocks) {
    ctx.clipEvents++
    ctx.clipCount = 0
    ctx.retries++
    if (cfg.fallback) ctx.w = ctx.lkg ?? cfg.w0 // 退回上次已知良好係數
    log('clip', `clip detect：$w$ 連續 ${cfg.clipBlocks} 個 block 卡在暫存器邊界，${cfg.fallback ? '退回 last-known-good' : '保持'}`)
    next = cfg.fallback && ctx.retries <= cfg.maxRetries ? 'RESTART' : 'FAULT'
  }
  if (next) {
    if (next !== ctx.state) log('state', `${ctx.state} → ${next}`)
    enter(ctx, next)
  } else {
    ctx.count++
  }
  return { mu, G, acted, wApplied }
}
// #endregion

function inWindow(k: number, start: number, len: number): boolean {
  return len > 0 && k >= start && k < start + len
}

function trueA(cfg: CalSmParams, k: number): number {
  return cfg.a0 + cfg.driftPerBlock * k + (cfg.stepBlock >= 0 && k >= cfg.stepBlock ? cfg.stepSize : 0)
}

/** worker 可呼叫：單一 seed 的狀態機模擬，並以同一情境跑「固定 μ、無 guards」對照組。 */
export function runCalStateMachine(cfg: CalSmParams): CalSmResult {
  if (!(cfg.sigmaV > 0)) throw new Error('σ_v 必須 > 0')
  const Bk = Math.max(1, Math.floor(cfg.blocks))
  const gm = gmacModel(cfg.N, cfg.sigmaV, cfg.thetaDeg)
  const gmBad: GmacModel = { ...gm, c: gm.c * cfg.badFcwGain, s: gm.s * cfg.badFcwGain }
  const root = createRng(cfg.seed)
  const rngSm = root.fork('state-machine')
  const rngBase = root.fork('baseline')
  const rngBase2 = root.fork('baseline-2')
  const evtSign = root.fork('unlock-sign').sign() // 每次失鎖事件的假相關方向
  const out: CalSmResult = {
    a: new Float64Array(Bk + 1),
    w: new Float64Array(Bk + 1),
    delta: new Float64Array(Bk + 1),
    deltaApplied: new Float64Array(Bk + 1),
    mu: new Float64Array(Bk),
    G: new Float64Array(Bk),
    state: new Uint8Array(Bk),
    wBase: new Float64Array(Bk + 1),
    deltaBase: new Float64Array(Bk + 1),
    wBase2: new Float64Array(Bk + 1),
    deltaBase2: new Float64Array(Bk + 1),
    events: [],
    summary: {
      firstTrackBlock: -1,
      restarts: 0,
      verifyFails: 0,
      clipEvents: 0,
      fault: false,
      rmsEval: NaN,
      rmsEvalRegister: NaN,
      rmsEvalBase: NaN,
      rmsEvalBase2: NaN,
      verifyBlocksUsed: 0,
      updatesInLowNoise: 0,
      updatesInLowNoiseBase: 0,
      updatesInLowNoiseBase2: 0,
    },
  }
  const ctx = createCalCtx(cfg)
  let wBase = cfg.w0
  let wBase2 = cfg.w0
  const gmacAt = (rng: Rng, k: number, a: number, wApplied: number): number => {
    const locked = k >= cfg.lockBlocks && !inWindow(k, cfg.lockLossStart, cfg.lockLossLen)
    if (!locked) return signGmacBlock(rng, 0, gm, cfg.unlockBias * evtSign) // 失鎖：q 與 δ 無關、只有假相關
    if (inWindow(k, cfg.badFcwStart, cfg.badFcwLen)) return signGmacBlock(rng, a - wApplied, gmBad, cfg.badFcwBias)
    return signGmacBlock(rng, a - wApplied, gm)
  }
  let sq = 0
  let sqReg = 0
  let sqBase = 0
  let sqBase2 = 0
  let nEval = 0
  for (let k = 0; k < Bk; k++) {
    const a = trueA(cfg, k)
    out.a[k] = a
    out.w[k] = ctx.w
    out.delta[k] = a - ctx.w
    out.wBase[k] = wBase
    out.deltaBase[k] = a - wBase
    out.wBase2[k] = wBase2
    out.deltaBase2[k] = a - wBase2
    const inp: CalInputs = {
      k,
      locked: k >= cfg.lockBlocks && !inWindow(k, cfg.lockLossStart, cfg.lockLossLen),
      badFcw: inWindow(k, cfg.badFcwStart, cfg.badFcwLen),
      lowNoise: inWindow(k, cfg.lowNoiseStart, cfg.lowNoiseLen),
    }
    const wBefore = ctx.w
    const r = calStep(ctx, inp, cfg, (wApplied) => gmacAt(rngSm, k, a, wApplied), (kind, msg) => out.events.push({ k, kind, msg }))
    out.state[k] = CAL_STATES.indexOf(r.acted)
    out.deltaApplied[k] = a - r.wApplied // VERIFY：DTC 實際用的是 w ± Δ
    if (r.acted === 'VERIFY') out.summary.verifyBlocksUsed++
    out.mu[k] = r.mu
    out.G[k] = r.G
    if (r.acted === 'TRACK' && out.summary.firstTrackBlock < 0) out.summary.firstTrackBlock = k
    if (inp.lowNoise && ctx.w !== wBefore) out.summary.updatesInLowNoise++
    // 對照組：固定 μ、每個 block 都更新、沒有任何 guard（A = 快、B = 安靜）
    const gB = gmacAt(rngBase, k, a, wBase)
    const nextBase = Math.max(cfg.wMin, Math.min(cfg.wMax, wBase + cfg.baselineMu * gB))
    if (inp.lowNoise && nextBase !== wBase) out.summary.updatesInLowNoiseBase++
    wBase = nextBase
    const gB2 = gmacAt(rngBase2, k, a, wBase2)
    const nextBase2 = Math.max(cfg.wMin, Math.min(cfg.wMax, wBase2 + cfg.baselineMu2 * gB2))
    if (inp.lowNoise && nextBase2 !== wBase2) out.summary.updatesInLowNoiseBase2++
    wBase2 = nextBase2
    if (k >= cfg.evalStart) {
      sq += out.deltaApplied[k] ** 2
      sqReg += out.delta[k] ** 2
      sqBase += out.deltaBase[k] ** 2
      sqBase2 += out.deltaBase2[k] ** 2
      nEval++
    }
  }
  const aEnd = trueA(cfg, Bk)
  out.a[Bk] = aEnd
  out.w[Bk] = ctx.w
  out.delta[Bk] = aEnd - ctx.w
  out.deltaApplied[Bk] = aEnd - ctx.w
  out.wBase[Bk] = wBase
  out.deltaBase[Bk] = aEnd - wBase
  out.wBase2[Bk] = wBase2
  out.deltaBase2[Bk] = aEnd - wBase2
  out.summary.restarts = ctx.restarts
  out.summary.verifyFails = ctx.verifyFails
  out.summary.clipEvents = ctx.clipEvents
  out.summary.fault = ctx.state === 'FAULT' || out.state.includes(CAL_STATES.indexOf('FAULT'))
  out.summary.rmsEval = nEval > 0 ? Math.sqrt(sq / nEval) : NaN
  out.summary.rmsEvalRegister = nEval > 0 ? Math.sqrt(sqReg / nEval) : NaN
  out.summary.rmsEvalBase = nEval > 0 ? Math.sqrt(sqBase / nEval) : NaN
  out.summary.rmsEvalBase2 = nEval > 0 ? Math.sqrt(sqBase2 / nEval) : NaN
  return out
}

export interface CalSmMonteCarloResult {
  /** 逐 block RMS（跨 runs）[fs]：狀態機（DTC 實際誤差，含 VERIFY 的 ±Δ）、對照 A（固定快 μ）、對照 B（固定安靜 μ） */
  rms: Float64Array
  rmsBase: Float64Array
  rmsBase2: Float64Array
  /** 狀態機的暫存器誤差 RMS(k)（不含 VERIFY 擾動） */
  rmsRegister: Float64Array
  /** 評估視窗內的 RMS：平均與 95% CI（以每個 run 的均方值做 t 區間，再開根號）；狀態機用 DTC 實際誤差 */
  evalRms: { mean: number; lo: number; hi: number }
  /** 狀態機只看暫存器誤差的評估 RMS（不含 VERIFY 擾動） */
  evalRmsRegister: { mean: number; lo: number; hi: number }
  evalRmsBase: { mean: number; lo: number; hi: number }
  evalRmsBase2: { mean: number; lo: number; hi: number }
  /** RMS(k) 第一次 ≤ convTarget 並保持 10 個 block 的 block（-1 = 沒有） */
  settle: { sm: number; base: number; base2: number }
  meanRestarts: number
  faultRuns: number
  runs: number
}

/** RMS(k) 第一次 ≤ target 並連續保持 hold 個 block 的 k（沒有則 −1）。 */
export function settleBlock(rms: ArrayLike<number>, target: number, hold = 10): number {
  let run = 0
  for (let k = 0; k < rms.length; k++) {
    run = rms[k] <= target ? run + 1 : 0
    if (run >= hold) return k - hold + 1
  }
  return -1
}

/** worker 可呼叫：狀態機 vs 兩個固定 μ 對照組的多 seed Monte Carlo（seed_r = deriveSeed(seed, r)）。 */
export function runCalStateMachineMonteCarlo(p: { config: CalSmParams; runs: number }): CalSmMonteCarloResult {
  const R = Math.max(2, Math.floor(p.runs))
  const Bk = Math.max(1, Math.floor(p.config.blocks))
  const acc = [new Float64Array(Bk + 1), new Float64Array(Bk + 1), new Float64Array(Bk + 1), new Float64Array(Bk + 1)]
  const ms = [new Float64Array(R), new Float64Array(R), new Float64Array(R), new Float64Array(R)]
  let restarts = 0
  let faults = 0
  for (let r = 0; r < R; r++) {
    const res = runCalStateMachine({ ...p.config, seed: deriveSeed(p.config.seed, r) })
    const series = [res.deltaApplied, res.deltaBase, res.deltaBase2, res.delta]
    for (let j = 0; j < 4; j++) for (let k = 0; k <= Bk; k++) acc[j][k] += series[j][k] ** 2
    ms[0][r] = res.summary.rmsEval ** 2
    ms[1][r] = res.summary.rmsEvalBase ** 2
    ms[2][r] = res.summary.rmsEvalBase2 ** 2
    ms[3][r] = res.summary.rmsEvalRegister ** 2
    restarts += res.summary.restarts
    if (res.summary.fault) faults++
  }
  const toRms = (x: Float64Array) => {
    const c = meanCI(x)
    return { mean: Math.sqrt(c.mean), lo: Math.sqrt(Math.max(0, c.lo)), hi: Math.sqrt(Math.max(0, c.hi)) }
  }
  const rms = acc.map((a) => a.map((v) => Math.sqrt(v / R)))
  const tgt = p.config.convTarget
  return {
    rms: rms[0],
    rmsBase: rms[1],
    rmsBase2: rms[2],
    rmsRegister: rms[3],
    evalRms: toRms(ms[0]),
    evalRmsRegister: toRms(ms[3]),
    evalRmsBase: toRms(ms[1]),
    evalRmsBase2: toRms(ms[2]),
    settle: { sm: settleBlock(rms[0], tgt), base: settleBlock(rms[1], tgt), base2: settleBlock(rms[2], tgt) },
    meanRestarts: restarts / R,
    faultRuns: faults,
    runs: R,
  }
}

/**
 * 預設情境（§14.2 示範）：σ_v = 100 fs、N = 1024、δ0 = 100 fs，coarse → verify → fine → track，含 PVT ramp 與低雜訊 freeze。
 * 警報門檻與 VERIFY 擾動是用「DTC 實際誤差」的 Monte Carlo 選的：4σ／持續 4 block／Δ = 20 fs 時約每 300 次模擬有 1 次誤警報，
 * 而每次誤警報的 VERIFY 會多出 Δ²·16 = 6400 fs²·block（約 4 萬個 TRACK block 的均方誤差），把平均 RMS 的好處吃掉。
 */
export const DEFAULT_CAL_SM: CalSmParams = {
  // 單一 seed 的評估 RMS 抽樣變動很大（TRACK 的 τ ≈ 63 blocks，650 個 block 的視窗只有約 5 個獨立樣本）：
  // 20261010…20261039 這 30 個 seed 的狀態機 RMS 從 0.26 到 0.61 fs。預設選一個接近 Monte Carlo 平均的 seed，結論一律以 MC 為準。
  seed: 20261034,
  blocks: 900,
  N: 1024,
  sigmaV: 100,
  thetaDeg: 0,
  a0: 100,
  w0: 0,
  driftPerBlock: 0.002,
  stepBlock: -1,
  stepSize: 20,
  lockBlocks: 10,
  lockLossStart: -1,
  lockLossLen: 0,
  unlockBias: 0.2,
  badFcwStart: -1,
  badFcwLen: 0,
  badFcwGain: 0,
  badFcwBias: 0.05,
  lowNoiseStart: 600,
  lowNoiseLen: 80,
  muCoarse: 60,
  muFine: 10,
  muTrack: 2,
  coarseBlocks: 20,
  fineBlocks: 60,
  verifyBlocks: 16,
  verifyDelta: 10, // K̂/se ≈ 10（z = 4 的門檻綽綽有餘）；再大只是讓 VERIFY 期間 DTC 多吃 Δ² 的誤差
  verifyTol: 8, // COARSE 結束時 δ 的 RMS ≈ 2.2 fs（μ_coarse 的 σ_w）加上量測雜訊 ≈ 1 fs：容許 8 fs ≈ 3.3σ，避免無謂的重試
  verifyZ: 4,
  trackWindow: 16,
  alarmHiZ: 6, // 門檻放在 6σ：誤警報一次就要付出 COARSE + VERIFY 的代價，而真正的大 step 一兩個 block 就遠超過 6σ
  alarmLoZ: 3,
  alarmHold: 2,
  wMin: -200,
  wMax: 300,
  clipBlocks: 3,
  maxStep: 50,
  maxRetries: 3,
  badFcwPolicy: 'freeze',
  lockDetect: true,
  clipDetect: true,
  hysteresis: true,
  fallback: true,
  registerLsb: 0,
  baselineMu: 10,
  baselineMu2: 2,
  evalStart: 250,
  convTarget: 2,
}
