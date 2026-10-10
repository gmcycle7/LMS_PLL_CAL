/**
 * Persistent Excitation（PE）、eigen 分解與 GOS/PHOS gauge freedom（規格 §9、§9.1、§9.2；模型層級 L3）。
 * Ch09 專用；頁面以 `?raw` + `#region core:*` 直接顯示這些程式碼。
 *
 * 全站約定（規格 §0 + docs/validation.md）：
 * - 參數誤差極性 δ = a − w；更新 w ← w + μ·G ⇒ δ ← δ − μ·G。
 * - 平均遞迴 E[δ_{k+1}] = (I − μK_q R)·E[δ_k]；K_q 一律明寫（勘誤 E05 / E08）：
 *     linear detector（conventional LMS，多位元 e）：K_q ≡ 1，μ 無因次；
 *     sign detector（1-bit comparator）：K_q = √(2/π)/σ_v [fs⁻¹]，μ 的單位是 fs。
 *   g = μK_q 是無因次 loop gain；λ_i 只代表 R 的 eigenvalue（勘誤 E22：正則化參數另用 ε）。
 * - 598 blocks 這類數字是 **mean（ensemble）** 遞迴的結論，不是 mean-square（勘誤 E23）；
 *   本檔同時提供 mean-square 遞迴（四階動差）讓頁面並列顯示。
 * - §9.2：經 H_PD(1) = 0 的 PLL error path 觀測時，global offset b 完全不可觀察，
 *   a_i 的 common mode 也不可觀察 ⇒ null space 為 2 維（勘誤 E04）。
 *
 * Worker 可呼叫（參數與回傳值皆可 structured clone）：simulatePeLab、gaugeAnalysis、peAnalytic。
 */

import {
  binomPmf,
  createRng,
  eigSym,
  eigvals,
  erf,
  identity,
  matAdd,
  matMul,
  matScale,
  matSub,
  matVec,
  svd,
  cAbs,
  type Matrix,
  type Rng,
} from '@/simulation/core'
import { impulseResponse, lfilter, StreamFilter } from '@/simulation/signal'
import { designDtLoop } from '@/simulation/models/pll'

// ───────────────────────── 型別與常數 ─────────────────────────

/** regressor 分布：Gaussian（連續值）或 ±1 sparse-flip code（u₂ = s·u₁） */
export type RegressorDist = 'gaussian' | 'pm1'
/** GMAC 前的誤差偵測器：linear（多位元 e，conventional LMS）或 sign（1-bit comparator） */
export type Detector = 'linear' | 'sign'

/** §5 的例子：σ_v = 100 fs 時 K_q = √(2/π)/100 = 0.00797885 fs⁻¹ */
export const KQ_SIGMA100 = Math.sqrt(2 / Math.PI) / 100

/** 1-bit comparator 的統計小訊號增益 K_q = √(2/π)/σ_v（σ_v ≤ 0 時回傳 Infinity） */
export function comparatorKq(sigmaV: number): number {
  return sigmaV > 0 ? Math.sqrt(2 / Math.PI) / sigmaV : Infinity
}

/** R = [[1, ρ], [ρ, 1]]（兩個單位功率 regressor，相關係數 ρ） */
export function corr2(rho: number): Matrix {
  return [
    [1, rho],
    [rho, 1],
  ]
}

// ───────────────────────── 2×2 對稱矩陣的閉式 eigen 分解 ─────────────────────────

export interface Eig2 {
  /** [λ_max, λ_min] */
  values: [number, number]
  /** 第 i 欄為 values[i] 的單位 eigenvector（第一個非零分量為正，與 golden 的正規化一致） */
  vectors: Matrix
  /** 主軸角 θ（rad）：v_max = (cos θ, sin θ)，tan 2θ = 2b/(a − d) */
  angle: number
}

function signNormalize(v: [number, number]): [number, number] {
  const first = Math.abs(v[0]) > 1e-15 ? v[0] : v[1]
  return first < 0 ? [-v[0], -v[1]] : v
}

// #region core:eig2x2
/**
 * 對稱 2×2 矩陣 [[a, b], [b, d]] 的 eigen 分解（閉式解，不用迭代）。
 *   det(R − λI) = (a − λ)(d − λ) − b² = 0
 *   ⇒ λ = (a + d)/2 ± √(((a − d)/2)² + b²)
 * eigenvector 用旋轉角 θ = ½·atan2(2b, a − d)：v_max = (cos θ, sin θ)、v_min = (−sin θ, cos θ)。
 * 例：a = d = 1、b = ρ ⇒ λ = 1 ± ρ，v = (1, ±1)/√2。
 */
export function eig2x2(a: number, b: number, d: number): Eig2 {
  const mean = (a + d) / 2 // 兩個 eigenvalue 的平均 = trace/2
  const radius = Math.hypot((a - d) / 2, b) // ← 差異：直接解二次方程式，半徑 √(((a−d)/2)² + b²)，不迭代
  const lmax = mean + radius
  const lmin = mean - radius
  const theta = 0.5 * Math.atan2(2 * b, a - d) // 主軸角：tan 2θ = 2b/(a − d)
  const vmax = signNormalize([Math.cos(theta), Math.sin(theta)])
  const vmin = signNormalize([-Math.sin(theta), Math.cos(theta)]) // 與 v_max 正交
  return {
    values: [lmax, lmin],
    vectors: [
      [vmax[0], vmin[0]],
      [vmax[1], vmin[1]],
    ],
    angle: theta,
  }
}
// #endregion

// ───────────────────────── 平均遞迴：eigen-mode、pole、衰減步數 ─────────────────────────

// #region core:stepsToDecay
/**
 * 一個 pole p 的模式要衰減到初值的 fraction（例如 0.05 = 剩 5%）所需的最少步數：
 *   |p|^k ≤ f ⇔ k·ln|p| ≤ ln f ⇔ k ≥ ln f / ln|p|（ln|p| < 0，除過去要翻轉不等號）
 * p = 0 時一步就歸零（回傳 1）；|p| ≥ 1 時永遠不會衰減（回傳 Infinity）。
 */
export function stepsToDecay(p: number, fraction = 0.05): number {
  const ap = Math.abs(p)
  if (ap === 0) return 1
  if (!(ap < 1)) return Infinity
  return Math.ceil(Math.log(fraction) / Math.log(ap))
}
// #endregion

/** 未取整的 ln f / ln|p|（例如 0.995、5% ⇒ 597.647） */
export function stepsToDecayReal(p: number, fraction = 0.05): number {
  const ap = Math.abs(p)
  if (ap === 0) return 0
  if (!(ap < 1)) return Infinity
  return Math.log(fraction) / Math.log(ap)
}

export interface EigenModes {
  /** λ_i(R)，由大到小 */
  lambdas: number[]
  /** 第 i 欄為 λ_i 的單位 eigenvector */
  vectors: Matrix
  /** p_i = 1 − gλ_i，g = μK_q */
  poles: number[]
  /** 每個模式 95% 衰減所需 blocks（Infinity = 不衰減） */
  k95: number[]
  /** κ = λ_max/λ_min（λ_min ≤ 1e-12·λ_max 時為 Infinity） */
  kappa: number
  /** 數值上為零（不可辨識）的方向數 */
  nullCount: number
}

// #region core:eigenModes
/**
 * 一般 M×M 對稱 R 的平均 LMS 模式分析（Jacobi eigSym；2×2 時可與 eig2x2 交叉比對）。
 *   R = QΛQᵀ，c = Qᵀδ ⇒ c_{i,k+1} = (1 − gλ_i)·c_{i,k}，g = μK_q
 */
export function eigenModes(R: Matrix, g: number): EigenModes {
  const { values, vectors } = eigSym(R) // ← 差異：Jacobi 迭代（任意 M×M），R = QΛQᵀ（values 由大到小）
  const tol = 1e-12 * Math.max(Math.abs(values[0] ?? 0), 1e-300)
  const poles = values.map((l) => 1 - g * l) // p_i = 1 − μK_qλ_i
  const k95 = poles.map((p) => stepsToDecay(p, 0.05)) // 95% 衰減步數
  const lmin = values[values.length - 1]
  const nullCount = values.filter((l) => Math.abs(l) <= tol).length // λ = 0 ⇒ 不可辨識方向
  return { lambdas: values, vectors, poles, k95, kappa: lmin > tol ? values[0] / lmin : Infinity, nullCount }
}
// #endregion

/** 單一 scalar loop gain 下的最佳 g* = 2/(λ_max + λ_min)，此時 max|p_i| = (κ − 1)/(κ + 1) */
export function optimalScalarGain(lmax: number, lmin: number): { g: number; p: number } {
  const g = 2 / (lmax + lmin)
  return { g, p: (lmax - lmin) / (lmax + lmin) }
}

// #region core:meanRecursion
/**
 * 平均遞迴 E[δ_{k+1}] = (I − μK_q R)·E[δ_k]（理想匹配、u 與 δ_k 獨立；勘誤 E05：K_q 明寫）。
 * 回傳每個分量的時間序列 out[i][k]，k = 0 … steps。
 */
export function meanTrajectory(R: Matrix, g: number, delta0: ArrayLike<number>, steps: number): Float64Array[] {
  const m = R.length
  const A = matSub(identity(m), matScale(R, g)) // A = I − gR，g = μK_q
  const out = Array.from({ length: m }, () => new Float64Array(steps + 1))
  let d = Array.from(delta0)
  for (let k = 0; ; k++) {
    for (let i = 0; i < m; i++) out[i][k] = d[i]
    if (k === steps) break
    d = matVec(A, d) // ← 差異：一次矩只需要 R：E[δ_{k+1}] = A·E[δ_k]
  }
  return out
}
// #endregion

/** 模態座標 c = Qᵀδ（Q 的欄為 eigenvector） */
export function modalCoords(vectors: Matrix, delta: ArrayLike<number>): number[] {
  const m = vectors.length
  const c: number[] = []
  for (let j = 0; j < (vectors[0]?.length ?? 0); j++) {
    let s = 0
    for (let i = 0; i < m; i++) s += vectors[i][j] * delta[i]
    c.push(s)
  }
  return c
}

// ───────────────────────── 1-bit comparator 的 mean-field（Bussgang） ─────────────────────────

// #region core:bussgangMeanG
/**
 * Sign detector 的條件平均 GMAC：E[q·u | δ]，q = sign(uᵀδ + v)，v ~ N(0, σ_v²)。
 *   Gaussian u ~ N(0, R)：e 為 Gaussian ⇒ E[q·u] = √(2/π)·Rδ / √(σ_v² + δᵀRδ)（Bussgang，精確）
 *   ±1 sparse-flip：u = (u₁, s·u₁) ⇒ E[q·u] = Σ_s π_s·erf((δ₁ + sδ₂)/(√2σ_v))·(1, s)（精確）
 * |uᵀδ| ≪ σ_v 時兩者都退化成 K_q·Rδ，K_q = √(2/π)/σ_v。
 */
export function bussgangMeanG(dist: RegressorDist, rho: number, sigmaV: number, d1: number, d2: number): [number, number] {
  if (dist === 'gaussian') {
    const rd1 = d1 + rho * d2 // (Rδ)₁
    const rd2 = rho * d1 + d2 // (Rδ)₂
    const s = Math.sqrt(sigmaV * sigmaV + d1 * rd1 + d2 * rd2) // σ_e = √(σ_v² + δᵀRδ)
    if (s === 0) return [0, 0]
    const k = Math.sqrt(2 / Math.PI) / s
    return [k * rd1, k * rd2]
  }
  const pPlus = (1 + rho) / 2 // P(s = +1)
  const ePlus = sigmaV > 0 ? erf((d1 + d2) / (Math.SQRT2 * sigmaV)) : Math.sign(d1 + d2)
  const eMinus = sigmaV > 0 ? erf((d1 - d2) / (Math.SQRT2 * sigmaV)) : Math.sign(d1 - d2)
  return [pPlus * ePlus + (1 - pPlus) * eMinus, pPlus * ePlus - (1 - pPlus) * eMinus]
}
// #endregion

/** sign detector 的 mean-field 軌跡：δ_{k+1} = δ_k − μ·E[q·u | δ_k]（[近似｜mean-field]） */
export function meanFieldTrajectory(p: {
  dist: RegressorDist
  rho: number
  sigmaV: number
  mu: number
  delta0: ArrayLike<number>
  steps: number
}): [Float64Array, Float64Array] {
  const d1 = new Float64Array(p.steps + 1)
  const d2 = new Float64Array(p.steps + 1)
  d1[0] = p.delta0[0]
  d2[0] = p.delta0[1]
  for (let k = 0; k < p.steps; k++) {
    const [g1, g2] = bussgangMeanG(p.dist, p.rho, p.sigmaV, d1[k], d2[k])
    d1[k + 1] = d1[k] - p.mu * g1
    d2[k + 1] = d2[k] - p.mu * g2
  }
  return [d1, d2]
}

// ───────────────────────── Mean-square 遞迴（勘誤 E23） ─────────────────────────

type Sym2 = [number, number, number] // (P11, P12, P22)

function symToMat(p: Sym2): Matrix {
  return [
    [p[0], p[1]],
    [p[1], p[2]],
  ]
}

function trace2(A: Matrix): number {
  return A[0][0] + A[1][1]
}

// #region core:meanSquareMap
/**
 * 均方遞迴（P = E[δδᵀ]，u 跨 sample 獨立，G_k = (1/N)Σ t·u）：
 *   linear（t = e）：G = R̂δ + 雜訊，R̂_k = (1/N)Σ uuᵀ
 *     P_{k+1} = P − g(RP + PR) + g²[(1 − 1/N)·RPR + K(P)/N] + μ²σ_v²R/N
 *     四階動差 K(P) = E[uuᵀ·P·uuᵀ]：
 *       Gaussian（Isserlis）：K(P) = 2RPR + R·tr(RP)
 *       ±1 sparse-flip     ：K(P) = Σ_s π_s S_s P S_s，S_s = [[1, s], [s, 1]]
 *   sign（t = sign(e)，q² ≡ 1）：E[GGᵀ|δ] = R/N + (1 − 1/N)·E[qu]E[qu]ᵀ，E[qu] ≈ K_qRδ
 *     P_{k+1} ≈ P − g(RP + PR) + g²(1 − 1/N)·RPR + μ²R/N（小訊號線性化）
 * Q 為雜訊注入項（linear：μ²σ_v²R/N；sign：μ²R/N）。
 */
export function meanSquareMap(
  dist: RegressorDist,
  rho: number,
  g: number,
  N: number,
  P: Matrix,
  Q?: Matrix,
  detector: Detector = 'linear',
): Matrix {
  const R = corr2(rho)
  const RP = matMul(R, P)
  const PR = matMul(P, R)
  const RPR = matMul(RP, R)
  let K: Matrix // 四階動差 E[uuᵀPuuᵀ]
  if (detector === 'sign') {
    K = [
      [0, 0],
      [0, 0],
    ] // ← 差異：sign 的 q² ≡ 1，同一 sample 的二次項是 R（併入 Q = μ²R/N），沒有 δ 的四階動差
  } else if (dist === 'gaussian') {
    K = matAdd(matScale(RPR, 2), matScale(R, trace2(RP))) // 2RPR + R·tr(RP)
  } else {
    const pPlus = (1 + rho) / 2
    const Sp = corr2(1) // s = +1
    const Sm = corr2(-1) // s = −1
    K = matAdd(matScale(matMul(matMul(Sp, P), Sp), pPlus), matScale(matMul(matMul(Sm, P), Sm), 1 - pPlus))
  }
  const out: Matrix = [
    [0, 0],
    [0, 0],
  ]
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const second = (1 - 1 / N) * RPR[i][j] + K[i][j] / N // ← 差異：二次矩 E[R̂PR̂] 需要四階動差（mean 只需要 R）
      out[i][j] = P[i][j] - g * (RP[i][j] + PR[i][j]) + g * g * second + (Q ? Q[i][j] : 0)
    }
  }
  return out
}
// #endregion

/** 均方遞迴（不含雜訊）在 (P11, P12, P22) 座標上的 3×3 線性算子 */
export function meanSquareOperator(dist: RegressorDist, rho: number, g: number, N: number, detector: Detector = 'linear'): Matrix {
  const basis: Sym2[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const cols = basis.map((e) => {
    const out = meanSquareMap(dist, rho, g, N, symToMat(e), undefined, detector)
    return [out[0][0], out[0][1], out[1][1]]
  })
  return [0, 1, 2].map((i) => cols.map((c) => c[i]))
}

/**
 * 均方 spectral radius ρ_MS：< 1 ⇔ E‖δ_k‖² 的齊次部分 → 0。
 * 例：linear、Gaussian、ρ=.99、g=.5、N=1 ⇒ 1.9801（發散）；同條件的 sign detector（小訊號線性化）⇒ 0.99。
 */
export function meanSquareRadius(dist: RegressorDist, rho: number, g: number, N: number, detector: Detector = 'linear'): number {
  let r = 0
  for (const z of eigvals(meanSquareOperator(dist, rho, g, N, detector))) r = Math.max(r, cAbs(z))
  return r
}

/**
 * linear detector、Gaussian regressor 的閉式對角子系統（eigen 座標）：d_{k+1} = A·d_k，d_i = E[c_i²]
 *   A_ii = 1 − 2gλ_i + g²λ_i²(1 + 2/N)、A_ij = g²λ_iλ_j/N（i ≠ j）
 */
export function meanSquareDiagGaussian(lambdas: number[], g: number, N: number): Matrix {
  return lambdas.map((li, i) =>
    lambdas.map((lj, j) => (i === j ? 1 - 2 * g * li + g * g * li * li * (1 + 2 / N) : (g * g * li * lj) / N)),
  )
}

/** E‖δ_k‖² = tr P_k 的解析軌跡（P_0 = δ₀δ₀ᵀ，含雜訊注入 Q = noiseVar·R/N） */
export function meanSquareTrajectory(p: {
  dist: RegressorDist
  rho: number
  g: number
  N: number
  delta0: ArrayLike<number>
  steps: number
  /** 每 block 注入的雜訊功率係數（linear：μ²σ_v²；sign：μ²）；0 = 無雜訊 */
  noiseVar?: number
  /** 偵測器（預設 linear）；sign 時用小訊號線性化（見 meanSquareMap） */
  detector?: Detector
}): Float64Array {
  const out = new Float64Array(p.steps + 1)
  const R = corr2(p.rho)
  const Q = p.noiseVar ? matScale(R, p.noiseVar / p.N) : undefined
  let P: Matrix = [
    [p.delta0[0] * p.delta0[0], p.delta0[0] * p.delta0[1]],
    [p.delta0[0] * p.delta0[1], p.delta0[1] * p.delta0[1]],
  ]
  out[0] = trace2(P)
  for (let k = 1; k <= p.steps; k++) {
    P = meanSquareMap(p.dist, p.rho, p.g, p.N, P, Q, p.detector ?? 'linear')
    out[k] = trace2(P)
    if (!Number.isFinite(out[k]) || out[k] > 1e300) {
      out.fill(Infinity, k)
      break
    }
  }
  return out
}

// ───────────────────────── Regressor 產生與 GMAC（MC 用） ─────────────────────────

// #region core:regressorGaussian
/** 相關係數 ρ 的 Gaussian regressor：u₁ = z₁、u₂ = ρz₁ + √(1−ρ²)·z₂ ⇒ E[u₁²] = E[u₂²] = 1、E[u₁u₂] = ρ */
export function drawGaussianPair(rho: number, rng: Rng, out: Float64Array): void {
  const z1 = rng.normal()
  const z2 = rng.normal()
  out[0] = z1
  out[1] = rho * z1 + Math.sqrt(1 - rho * rho) * z2 // ← 差異：連續值，|ρ| < 1 時每一 sample 都帶一點差模能量
}
// #endregion

// #region core:regressorPm1
/** ±1 sparse-flip code：u₂ = s·u₁，P(s = +1) = (1 + ρ)/2 ⇒ E[u₁u₂] = ρ */
export function drawPm1Pair(rho: number, rng: Rng, out: Float64Array): void {
  const u1 = rng.sign()
  const s = rng.uniform() < (1 + rho) / 2 ? 1 : -1 // ← 差異：只有 s = −1（機率 (1−ρ)/2）的 sample 激發差模方向
  out[0] = u1
  out[1] = s * u1
}
// #endregion

// #region core:gmacLinear
/** Conventional LMS 的 GMAC 乘數：直接用 e（多位元誤差） */
export function gmacLinear(e: number): number {
  return e // ← 差異：保留 e 的大小 ⇒ E[G | δ] = Rδ（K ≡ 1）
}
// #endregion

// #region core:gmacSign
/** 1-bit comparator 的 GMAC 乘數：q = sign(e)，tie 判 +1（硬體 comparator 慣例） */
export function gmacSign(e: number): number {
  return e >= 0 ? 1 : -1 // ← 差異：只剩正負號 ⇒ E[G | δ] ≈ K_q·Rδ，K_q = √(2/π)/σ_v
}
// #endregion

export interface PeChainParams {
  dist: RegressorDist
  detector: Detector
  rho: number
  /** linear：加性雜訊 std（與 δ 同單位）；sign：comparator 前雜訊 std [fs] */
  sigmaV: number
  /** 實際 μ（linear 無因次；sign 為 fs） */
  mu: number
  /** GMAC block 長度 */
  N: number
  delta0: [number, number]
  blocks: number
}

// #region core:peBlockLms
/**
 * 一條 MC chain：每個 block 累加 N 個 sample 的 GMAC，block 結束才更新一次。
 *   G_k = (1/N)·Σ t[n]·u[n]，t = e（linear）或 sign(e)（1-bit）
 *   w_{k+1} = w_k + μG_k ⇔ δ_{k+1} = δ_k − μG_k（δ = a − w）
 * 回傳 false 表示發散（|δ| > 1e12）。
 */
export function runPeChain(
  p: PeChainParams,
  ur: Rng,
  vr: Rng,
  record: (k: number, d1: number, d2: number) => void,
): boolean {
  const draw = p.dist === 'gaussian' ? drawGaussianPair : drawPm1Pair
  const detect = p.detector === 'linear' ? gmacLinear : gmacSign
  const u = new Float64Array(2)
  let d1 = p.delta0[0]
  let d2 = p.delta0[1]
  record(0, d1, d2)
  for (let k = 0; k < p.blocks; k++) {
    let g1 = 0
    let g2 = 0
    for (let n = 0; n < p.N; n++) {
      draw(p.rho, ur, u) // regressor u[n]
      const v = p.sigmaV > 0 ? p.sigmaV * vr.normal() : 0 // 量測／comparator 雜訊
      const t = detect(u[0] * d1 + u[1] * d2 + v) // e = uᵀδ + v → e 或 sign(e)
      g1 += t * u[0] // GMAC 累加 Σ t·u
      g2 += t * u[1]
    }
    d1 -= (p.mu * g1) / p.N // δ ← δ − μ·G_k
    d2 -= (p.mu * g2) / p.N
    if (!(Math.abs(d1) + Math.abs(d2) < 1e12)) {
      record(k + 1, Number.NaN, Number.NaN)
      return false
    }
    record(k + 1, d1, d2)
  }
  return true
}
// #endregion

// ───────────────────────── §9.1 有限窗口 PE 統計 ─────────────────────────

export interface SlidingPe {
  /** 窗口起點 k（sample index） */
  k: Float64Array
  lmax: Float64Array
  /** λ_min(R_k)（捨入造成的極小負值夾到 0） */
  lmin: Float64Array
  /** κ(R_k) = λ_max/λ_min（退化窗口為 Infinity） */
  kappa: Float64Array
  /** 窗口內的樣本相關係數 R_k[0][1]/√(R_k[0][0]R_k[1][1]) */
  r12: Float64Array
  /** 資料矩陣 U_k（N₀×2）的 singular values：σ_i(U_k) = √(N₀·λ_i(R_k)) */
  svMax: Float64Array
  svMin: Float64Array
  /** λ_min ≤ 1e-12·λ_max 的窗口比例（該窗口沒有任何差模資訊） */
  degenerateFraction: number
}

// #region core:slidingWindowPe
/**
 * 滑動窗口 R_k = (1/N₀)·Σ_{n=k}^{k+N₀−1} u[n]u[n]ᵀ 及其 λ_min、κ、singular values（規格 §9.1）。
 * 用 prefix sum：每個窗口 O(1)；±1 code 的和是整數，退化窗口的 λ_min 精確為 0。
 */
export function slidingWindowPe(u1: ArrayLike<number>, u2: ArrayLike<number>, N0: number, stride = 1): SlidingPe {
  const n = Math.min(u1.length, u2.length)
  const S11 = new Float64Array(n + 1)
  const S12 = new Float64Array(n + 1)
  const S22 = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    S11[i + 1] = S11[i] + u1[i] * u1[i]
    S12[i + 1] = S12[i] + u1[i] * u2[i]
    S22[i + 1] = S22[i] + u2[i] * u2[i]
  }
  const count = n >= N0 ? Math.floor((n - N0) / stride) + 1 : 0
  const out = {
    k: new Float64Array(count),
    lmax: new Float64Array(count),
    lmin: new Float64Array(count),
    kappa: new Float64Array(count),
    r12: new Float64Array(count),
    svMax: new Float64Array(count),
    svMin: new Float64Array(count),
  }
  let degenerate = 0
  for (let w = 0; w < count; w++) {
    const k = w * stride
    const a = (S11[k + N0] - S11[k]) / N0 // R_k[0][0]
    const b = (S12[k + N0] - S12[k]) / N0 // R_k[0][1]
    const d = (S22[k + N0] - S22[k]) / N0 // R_k[1][1]
    const [lmax, lminRaw] = eig2x2(a, b, d).values
    const lmin = Math.max(lminRaw, 0)
    const isDegenerate = lmin <= 1e-12 * lmax // 該窗口某方向完全沒有能量
    if (isDegenerate) degenerate++
    out.k[w] = k
    out.lmax[w] = lmax
    out.lmin[w] = isDegenerate ? 0 : lmin
    out.kappa[w] = isDegenerate ? Infinity : lmax / lmin
    out.r12[w] = a > 0 && d > 0 ? b / Math.sqrt(a * d) : Number.NaN
    out.svMax[w] = Math.sqrt(N0 * lmax) // σ_i(U_k)² = N₀·λ_i(R_k)
    out.svMin[w] = Math.sqrt(N0 * (isDegenerate ? 0 : lmin))
  }
  return { ...out, degenerateFraction: count > 0 ? degenerate / count : Number.NaN }
}
// #endregion

/**
 * ±1 sparse-flip code：長度 N₀ 的窗口退化（λ_min = 0）⇔ 窗口內 s 全為 +1 或全為 −1：
 *   P = ((1+ρ)/2)^{N₀} + ((1−ρ)/2)^{N₀}。例：ρ = .99、N₀ = 100 ⇒ 0.6058
 */
export function pm1DegenerateProb(rho: number, N0: number): number {
  const pp = (1 + rho) / 2
  return Math.pow(pp, N0) + Math.pow(1 - pp, N0)
}

/**
 * ±1 sparse-flip code 的窗口 λ_min(R_k) 在「非退化窗口」上的條件平均與相對標準差（精確，二項分布求和）：
 *   u₁² = u₂² = 1 ⇒ R_k = [[1, r], [r, 1]]，r = 1 − 2f/N₀（f = 窗口內 s = −1 的個數 ~ Binomial(N₀, (1−ρ)/2)）
 *   ⇒ λ_min(R_k) = 1 − |r|；非退化 ⇔ 0 < f < N₀。
 * 例：ρ = .99、N₀ = 100 ⇒ 平均 ≈ 0.0254（不是 λ_min(R) = 0.01：條件在「至少一次 flip」上會偏高）。
 */
export function pm1WindowLminStats(rho: number, N0: number): { mean: number; relSd: number; probNonDegenerate: number } {
  const q = (1 - rho) / 2 // P(s = −1)
  let w = 0
  let s1 = 0
  let s2 = 0
  if (q > 0 && q < 1) {
    // 只對有質量的範圍求和（±12σ 之外的二項機率 < 1e-30，可忽略）
    const mf = N0 * q
    const sf = Math.sqrt(N0 * q * (1 - q))
    const lo = Math.max(1, Math.floor(mf - 12 * sf - 10))
    const hi = Math.min(N0 - 1, Math.ceil(mf + 12 * sf + 10))
    for (let f = lo; f <= hi; f++) {
      const pf = binomPmf(f, N0, q)
      const l = 1 - Math.abs(1 - (2 * f) / N0)
      w += pf
      s1 += pf * l
      s2 += pf * l * l
    }
  }
  if (!(w > 0)) return { mean: Number.NaN, relSd: Number.NaN, probNonDegenerate: 0 }
  const mean = s1 / w
  const variance = Math.max(0, s2 / w - mean * mean)
  return { mean, relSd: Math.sqrt(variance) / mean, probNonDegenerate: w }
}

/** Gaussian regressor 的樣本 eigenvalue 漸近相對標準差 √(2/N₀)（λ_i 互異、N₀ ≫ 1；[近似]） */
export function sampleEigRelStd(N0: number): number {
  return Math.sqrt(2 / N0)
}

// ───────────────────────── 入門手算：固定 regressor 的 2 參數 LMS ─────────────────────────

export interface HandStepRow {
  k: number
  u: [number, number]
  w: [number, number]
  e: number
  dw: [number, number]
  wNext: [number, number]
}

// #region core:handSteps
/**
 * 手算表：無雜訊 conventional LMS，y = aᵀu，e = y − wᵀu，w ← w + μ·e·u。
 * 每一列都由這個函式算出（頁面上的表格不是手打的）。
 */
export function lmsHandSteps(p: { a: [number, number]; w0: [number, number]; mu: number; us: [number, number][] }): HandStepRow[] {
  const rows: HandStepRow[] = []
  let w: [number, number] = [p.w0[0], p.w0[1]]
  p.us.forEach((u, k) => {
    const e = (p.a[0] - w[0]) * u[0] + (p.a[1] - w[1]) * u[1] // e = uᵀ(a − w)
    const dw: [number, number] = [p.mu * e * u[0], p.mu * e * u[1]] // Δw = μ·e·u
    const wNext: [number, number] = [w[0] + dw[0], w[1] + dw[1]]
    rows.push({ k, u, w, e, dw, wNext })
    w = wNext
  })
  return rows
}
// #endregion

// ───────────────────────── PE / Eigen Lab：解析摘要 ─────────────────────────

export interface PeAnalyticParams {
  rho: number
  dist: RegressorDist
  /** g = μK_q（無因次 loop gain） */
  g: number
  N: number
  N0: number
  /** 偵測器（預設 linear）：只影響 mean-square 半徑（sign 為小訊號線性化） */
  detector?: Detector
}

export interface PeAnalytic {
  closed: Eig2
  modes: EigenModes
  /** 閉式 vs Jacobi 的最大差（eigenvalue） */
  eigAgreement: number
  pFast: number
  pSlow: number
  k95Slow: number
  k95SlowReal: number
  /** ln(20)/(gλ_min) ≈ 3/(gλ_min) 的近似（|1 − gλ_min| 接近 1 時） */
  k95SlowApprox: number
  meanRadius: number
  msRadius: number
  gOpt: number
  pOpt: number
  degenerateProb: number
  sampleEigRelStd: number
  /**
   * 非退化窗口 λ_min(R_k) 的預測平均與相對散佈：
   * Gaussian → λ_min(R) 與 √(2/N₀)（漸近、近似）；±1 → pm1WindowLminStats（精確）
   */
  windowLminMean: number
  windowLminRelSd: number
}

/** PE / Eigen Lab 的所有解析量（快速；不跑 MC） */
export function peAnalytic(p: PeAnalyticParams): PeAnalytic {
  const R = corr2(p.rho)
  const closed = eig2x2(1, p.rho, 1)
  const modes = eigenModes(R, p.g)
  const eigAgreement = Math.max(Math.abs(closed.values[0] - modes.lambdas[0]), Math.abs(closed.values[1] - modes.lambdas[1]))
  const pFast = modes.poles[0]
  const pSlow = modes.poles[1]
  const lmin = modes.lambdas[1]
  const opt = optimalScalarGain(modes.lambdas[0], lmin)
  const win = p.dist === 'pm1' ? pm1WindowLminStats(p.rho, p.N0) : { mean: Math.max(lmin, 0), relSd: sampleEigRelStd(p.N0) }
  return {
    closed,
    modes,
    eigAgreement,
    pFast,
    pSlow,
    k95Slow: stepsToDecay(pSlow, 0.05),
    k95SlowReal: stepsToDecayReal(pSlow, 0.05),
    k95SlowApprox: p.g * lmin > 0 ? Math.log(20) / (p.g * lmin) : Infinity,
    meanRadius: Math.max(...modes.poles.map(Math.abs)),
    msRadius: meanSquareRadius(p.dist, p.rho, p.g, p.N, p.detector ?? 'linear'),
    gOpt: opt.g,
    pOpt: opt.p,
    degenerateProb: p.dist === 'pm1' ? pm1DegenerateProb(p.rho, p.N0) : p.N0 >= 2 && Math.abs(p.rho) < 1 ? 0 : 1,
    sampleEigRelStd: sampleEigRelStd(p.N0),
    windowLminMean: win.mean,
    windowLminRelSd: win.relSd,
  }
}

// ───────────────────────── PE / Eigen Lab：Monte Carlo（worker） ─────────────────────────

export interface PeLabParams extends PeChainParams {
  /** PE 窗口長度 N₀ */
  N0: number
  /** MC chain 數 */
  chains: number
  /** 畫出的個別軌跡數 */
  nPaths: number
  /** 散佈圖的 sample 數 */
  scatterCount: number
  /** 滑動窗口分析用的序列長度 */
  peLength: number
  seed: number
  /** MC 總 sample 預算（chains·blocks·N）；超過時自動減少 chains */
  budget?: number
}

export interface PeLabResult {
  blocksUsed: number
  chainsUsed: number
  budgetTruncated: boolean
  divergedChains: number
  /** ensemble 平均 E[δ_k]（MC） */
  meanD1: Float64Array
  meanD2: Float64Array
  /** 模態座標的 ensemble 平均與標準誤（c = Qᵀδ；index 0 = 快模式 λ_max，1 = 慢模式 λ_min） */
  cMean: [Float64Array, Float64Array]
  cSe: [Float64Array, Float64Array]
  /** E‖δ_k‖²（MC 樣本平均） */
  msNorm: Float64Array
  /** ‖δ_k‖ 的中位數與 10/90% 分位數（在 checkpoints 上） */
  qIndex: Float64Array
  q10: Float64Array
  q50: Float64Array
  q90: Float64Array
  /** 個別軌跡 */
  paths: { d1: Float64Array; d2: Float64Array }[]
  /** 散佈圖 u 樣本（同一 regressor 分布） */
  scatterU1: Float64Array
  scatterU2: Float64Array
  /** 所有 MC regressor 的樣本 R（檢查 E[uuᵀ] = R） */
  sampleR: Matrix
  pe: SlidingPe
  /** mean-field（sign detector）或線性平均遞迴（linear detector）的參考軌跡 */
  refD1: Float64Array
  refD2: Float64Array
  totalSamples: number
}

const DEFAULT_BUDGET = 1.2e7

/**
 * PE / Eigen Lab 的 Monte Carlo（worker 可呼叫）。每條 chain 使用 rng.fork(`u-${c}`)、fork(`v-${c}`)，
 * 因此改變 chains 數不會改變既有 chain 的亂數（paired、可重現）。
 */
export function simulatePeLab(p: PeLabParams): PeLabResult {
  const budget = p.budget ?? DEFAULT_BUDGET
  const N = Math.max(1, Math.floor(p.N))
  let blocks = Math.max(1, Math.floor(p.blocks))
  let chains = Math.max(1, Math.floor(p.chains))
  let budgetTruncated = false
  if (2 * blocks * N > budget) {
    // 連 2 條 chain 都放不下：先縮短 blocks
    blocks = Math.max(1, Math.floor(budget / (2 * N)))
    budgetTruncated = true
  }
  if (chains * blocks * N > budget) {
    chains = Math.max(2, Math.floor(budget / (blocks * N)))
    budgetTruncated = true
  }
  const root = createRng(p.seed)
  const R = corr2(p.rho)
  const Q = eig2x2(1, p.rho, 1).vectors // 模態座標基底
  const L = blocks + 1
  const s1 = new Float64Array(L)
  const s2 = new Float64Array(L)
  const sc = [new Float64Array(L), new Float64Array(L)]
  const sc2 = [new Float64Array(L), new Float64Array(L)]
  const sn2 = new Float64Array(L)
  const nCheck = Math.min(L, 240)
  const qIndex = new Float64Array(nCheck)
  for (let i = 0; i < nCheck; i++) qIndex[i] = Math.round((i * (L - 1)) / Math.max(1, nCheck - 1))
  const checkPos = new Int32Array(L).fill(-1)
  qIndex.forEach((k, i) => (checkPos[k] = i))
  const norms = Array.from({ length: nCheck }, () => new Float64Array(chains))
  const nPaths = Math.min(Math.max(0, Math.floor(p.nPaths)), chains)
  const paths = Array.from({ length: nPaths }, () => ({ d1: new Float64Array(L), d2: new Float64Array(L) }))
  let diverged = 0
  for (let c = 0; c < chains; c++) {
    const path = c < nPaths ? paths[c] : null
    const ok = runPeChain({ ...p, N, blocks }, root.fork(`u-${c}`), root.fork(`v-${c}`), (k, d1, d2) => {
      s1[k] += d1
      s2[k] += d2
      const c0 = Q[0][0] * d1 + Q[1][0] * d2 // 快模式座標
      const c1 = Q[0][1] * d1 + Q[1][1] * d2 // 慢模式座標
      sc[0][k] += c0
      sc[1][k] += c1
      sc2[0][k] += c0 * c0
      sc2[1][k] += c1 * c1
      sn2[k] += d1 * d1 + d2 * d2
      const pos = checkPos[k]
      if (pos >= 0) norms[pos][c] = Math.hypot(d1, d2)
      if (path) {
        path.d1[k] = d1
        path.d2[k] = d2
      }
    })
    if (!ok) diverged++
  }
  const meanD1 = s1.map((v) => v / chains)
  const meanD2 = s2.map((v) => v / chains)
  const cMean: [Float64Array, Float64Array] = [sc[0].map((v) => v / chains), sc[1].map((v) => v / chains)]
  const cSe: [Float64Array, Float64Array] = [0, 1].map((i) =>
    sc2[i].map((v, k) => {
      const m = cMean[i][k]
      const varS = chains > 1 ? Math.max(0, (v - chains * m * m) / (chains - 1)) : Number.NaN
      return Math.sqrt(varS / chains)
    }),
  ) as [Float64Array, Float64Array]
  const msNorm = sn2.map((v) => v / chains)
  const q10 = new Float64Array(nCheck)
  const q50 = new Float64Array(nCheck)
  const q90 = new Float64Array(nCheck)
  norms.forEach((arr, i) => {
    const sorted = Array.from(arr).sort((a, b) => (Number.isNaN(a) ? 1 : Number.isNaN(b) ? -1 : a - b))
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
    q10[i] = at(0.1)
    q50[i] = at(0.5)
    q90[i] = at(0.9)
  })

  // 散佈圖與 PE 窗口序列（獨立串流）
  const draw = p.dist === 'gaussian' ? drawGaussianPair : drawPm1Pair
  const u = new Float64Array(2)
  const scRng = root.fork('scatter')
  const scatterCount = Math.max(0, Math.floor(p.scatterCount))
  const scatterU1 = new Float64Array(scatterCount)
  const scatterU2 = new Float64Array(scatterCount)
  for (let i = 0; i < scatterCount; i++) {
    draw(p.rho, scRng, u)
    scatterU1[i] = u[0]
    scatterU2[i] = u[1]
  }
  const peRng = root.fork('pe-window')
  const peLength = Math.max(p.N0, Math.floor(p.peLength))
  const pu1 = new Float64Array(peLength)
  const pu2 = new Float64Array(peLength)
  let r11 = 0
  let r12 = 0
  let r22 = 0
  for (let i = 0; i < peLength; i++) {
    draw(p.rho, peRng, u)
    pu1[i] = u[0]
    pu2[i] = u[1]
    r11 += u[0] * u[0]
    r12 += u[0] * u[1]
    r22 += u[1] * u[1]
  }
  const nWin = peLength - p.N0 + 1
  const stride = Math.max(1, Math.floor(nWin / 1500))
  const pe = slidingWindowPe(pu1, pu2, p.N0, stride)

  // 參考軌跡：linear → 精確平均遞迴；sign → Bussgang mean-field
  let refD1: Float64Array
  let refD2: Float64Array
  if (p.detector === 'linear') {
    ;[refD1, refD2] = meanTrajectory(R, p.mu, p.delta0, blocks)
  } else {
    ;[refD1, refD2] = meanFieldTrajectory({ dist: p.dist, rho: p.rho, sigmaV: p.sigmaV, mu: p.mu, delta0: p.delta0, steps: blocks })
  }

  return {
    blocksUsed: blocks,
    chainsUsed: chains,
    budgetTruncated,
    divergedChains: diverged,
    meanD1,
    meanD2,
    cMean,
    cSe,
    msNorm,
    qIndex,
    q10,
    q50,
    q90,
    paths,
    scatterU1,
    scatterU2,
    sampleR: [
      [r11 / peLength, r12 / peLength],
      [r12 / peLength, r22 / peLength],
    ],
    pe,
    refD1,
    refD2,
    totalSamples: chains * blocks * N,
  }
}

// ───────────────────────── §9.2 GOS / PHOS gauge freedom ─────────────────────────

/** 主 PLL error path：none = 無 DC null（u = x）；type2 = type-II DPLL H_PD；type1 = first-order high-pass */
export type GaugePath = 'none' | 'type2' | 'type1'
/** GMAC regressor：raw = 原始 x̃（硬體常見）；filtered = ũ = h * x̃（filtered-x） */
export type GaugeGmacReg = 'raw' | 'filtered'

/** P 相 one-hot + global offset 的 null vector n = (1, −1, …, −1)：x̃ᵀn = 1 − Σx_i = 0 */
export function gaugeNullVector(P = 4): number[] {
  return [1, ...new Array<number>(P).fill(-1)]
}

// #region core:gaugeRegressorsRaw
/**
 * one-hot phase 序列 → 原始 regressor x̃[n] = [1, x₀[n], …, x_{P−1}[n]]（第 0 欄是 global offset b 的 regressor）。
 * 每個 n 恰有一個 x_i = 1 ⇒ Σ_i x_i[n] = 1 ⇒ x̃[n]ᵀ(1, −1, …, −1) = 0（gauge freedom 的來源）。
 */
export function gaugeRegressorsRaw(phase: ArrayLike<number>, P: number): Float64Array[] {
  const T = phase.length
  const X = Array.from({ length: P + 1 }, () => new Float64Array(T))
  for (let n = 0; n < T; n++) {
    X[0][n] = 1 // b 的 regressor：常數 1
    X[1 + phase[n]][n] = 1 // one-hot
  }
  return X // ← 差異：u = x̃（H = 1，DC 原封不動到 comparator）
}
// #endregion

// #region core:gaugeRegressorsPd
/**
 * 經主 PLL error path 的有效 regressor ũ = h * x̃（每一欄各自濾波；濾波器從 rest 開始、狀態連續不重置）。
 * H_PD(1) = 0 ⇒ 常數 1 經過後 → 0（u_b → 0），且 Σ_i ũ_i = h * 1 = u_b → 0。
 */
export function gaugeRegressorsPd(X: Float64Array[], tf: { b: number[]; a: number[] }): Float64Array[] {
  return X.map((col) => lfilter(tf.b, tf.a, col).y) // ← 差異：u = h * x̃，H_PD(1) = 0 抹掉所有 DC
}
// #endregion

/** 樣本相關矩陣 (1/T)·Σ_{n∈[start,end)} A_i[n]·B_j[n] */
export function sampleCorrelation(A: Float64Array[], B: Float64Array[], start: number, end: number): Matrix {
  const T = Math.max(1, end - start)
  return A.map((ai) =>
    B.map((bj) => {
      let s = 0
      for (let n = start; n < end; n++) s += ai[n] * bj[n]
      return s / T
    }),
  )
}

/** 對稱矩陣的 null space（|λ| ≤ rtol·λ_max 的 eigenvector，欄向量） */
export function nullSpaceSym(R: Matrix, rtol = 1e-9): { basis: Matrix; values: number[] } {
  const { values, vectors } = eigSym(R)
  const tol = rtol * Math.max(Math.abs(values[0] ?? 0), 1e-300)
  const idx = values.map((v, i) => (Math.abs(v) <= tol ? i : -1)).filter((i) => i >= 0)
  return { basis: vectors.map((row) => idx.map((i) => row[i])), values: idx.map((i) => values[i]) }
}

function matNormVec(R: Matrix, v: number[]): number {
  const r = matVec(R, v)
  return Math.hypot(...r) / Math.max(Math.hypot(...v), 1e-300)
}

/** 取子矩陣 R[idx][idx] */
function subMatrix(R: Matrix, idx: number[]): Matrix {
  return idx.map((i) => idx.map((j) => R[i][j]))
}

/** TᵀRT（重新參數化） */
function congruence(R: Matrix, T: Matrix): Matrix {
  const Tt = T[0].map((_, j) => T.map((row) => row[j]))
  return matMul(matMul(Tt, R), T)
}

export interface GaugeConstraintRow {
  id: 'none' | 'ref' | 'sumzero' | 'dropb' | 'dropb_ref'
  name: string
  params: number
  rawMinEig: number
  rawNull: number
  pdMinEig: number | null
  pdNull: number | null
}

export interface GaugeParams {
  /** global offset b 與四個 one-hot phase offsets a₀…a₃ */
  b: number
  a: number[]
  /** gauge 平移 c：θ' = θ + c·(1, −1, −1, −1, −1) */
  c: number
  /** 只動 b 的平移 d_b：θ'' = θ + d_b·(1, 0, 0, 0, 0) */
  dB: number
  path: GaugePath
  /** type2 的離散化方法：'dpll'（E44 直接差分方程，預設）或 'bilinear'（Tustin，E04 的數值證據所用） */
  pllMethod?: 'dpll' | 'bilinear'
  /** type2：ω_nT_s [rad/sample]、ζ；type1：pole */
  wnTs: number
  zeta: number
  hpPole: number
  sequence: 'random' | 'cyclic'
  /** 分析用序列長度與暖機 sample 數 */
  T: number
  skip: number
  /** LMS demo：M = μI、block 長度 N、blocks、雜訊 σ_v、GMAC regressor */
  mu: number
  N: number
  blocks: number
  sigmaV: number
  gmacReg: GaugeGmacReg
  w0A: number[]
  w0B: number[]
  seed: number
}

export interface GaugeLmsRun {
  label: string
  domain: 'raw' | 'pd'
  wb: Float64Array
  a: Float64Array[]
  /** n̂ᵀw（n̂ = n/‖n‖）：raw domain 時應恆為初值 */
  nullProj: Float64Array
  /** a 的 common mode (1/P)Σa_i */
  cm: Float64Array
  /** block 內 e 的 RMS */
  errRms: Float64Array
  final: number[]
}

export interface GaugeResult {
  P: number
  tf: { b: number[]; a: number[]; description: string }
  dcGain: number
  hNorm2: number
  /**
   * H_PD step response 的總和 S = Σ_n s[n]（s[n] = Σ_{m≤n} h[m]）= lim_{z→1} H_PD(z)/(1 − z⁻¹)：
   * type-II（z = 1 有雙重零點）為 0；type-I（pole r）為 1/(1 − r)；path = none 時定義為 0。
   */
  hStepSum: number
  previewN: Float64Array
  /** raw domain：y_θ、y_θ'、y_θ''（各取 48 個 sample） */
  yRaw: Float64Array
  yRawGauge: Float64Array
  yRawB: Float64Array
  /** u-domain（暖機之後）：e_θ、e_θ'、e_θ'' */
  yPd: Float64Array
  yPdGauge: Float64Array
  yPdB: Float64Array
  maxDiffRawGauge: number
  maxDiffRawB: number
  maxDiffPdGauge: number
  maxDiffPdB: number
  Rx: Matrix
  Ru: Matrix
  C: Matrix
  eigRx: number[]
  eigRu: number[]
  /** C = E[x̃ũᵀ] 的 singular values（one-sided Jacobi SVD） */
  svC: number[]
  /** 各相等頻率時 R_x 的解析 eigenvalues（iid 與 cyclic 皆適用） */
  eigRxAnalytic: number[]
  /** R_u 的解析 eigenvalues：只對 iid 序列（或 path = none）成立，否則為 null（時間相關性改變 R_u） */
  eigRuAnalytic: number[] | null
  nullRx: Matrix
  nullRu: Matrix
  /** ‖Rv‖/‖v‖：n 對 R_x；e_b、common mode 對 R_u */
  residual: { nOnRx: number; ebOnRu: number; cmOnRu: number; nOnRu: number }
  constraints: GaugeConstraintRow[]
  /**
   * driftStdPred：u-domain、raw x̃ GMAC 時 w_b 的 random-walk 標準差預測（見 gaugeDriftStd）；
   * driftDamping：其中的阻尼因子 1/(1 + (1 + 1/P)·μS/N)（type-II 為 1）。
   */
  lms: { k: Float64Array; runs: GaugeLmsRun[]; driftStdPred: number; driftDamping: number }
  warnings: string[]
}

function pathTransfer(p: GaugeParams): { b: number[]; a: number[]; description: string; warnings: string[] } {
  if (p.path === 'none') return { b: [1], a: [1], description: 'H = 1（無 DC null：例如校正期間主迴路 frozen 或獨立觀測路徑）', warnings: [] }
  if (p.path === 'type1') {
    const r = p.hpPole
    return { b: [1, -1], a: [1, -r], description: `H(z) = (1 − z⁻¹)/(1 − ${r}z⁻¹)（type-I DPLL 的 1/(1+L)）`, warnings: [] }
  }
  const method = p.pllMethod ?? 'dpll'
  const des = designDtLoop({ wnTs: p.wnTs, zeta: p.zeta, loopDelay: 0, method })
  return {
    b: des.Hpd.b,
    a: des.Hpd.a,
    description: `type-II DPLL H_PD（ω_nT_s = ${p.wnTs}、ζ = ${p.zeta}、${method}）`,
    warnings: des.warnings,
  }
}

function sumArr(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]
  return s
}

function minAbsEig(R: Matrix): { min: number; nulls: number } {
  const { values } = eigSym(R)
  const tol = 1e-9 * Math.max(Math.abs(values[0] ?? 0), 1e-300)
  return { min: values[values.length - 1], nulls: values.filter((v) => Math.abs(v) <= tol).length }
}

/** Σa_i = 0 子空間的正交基底（P×(P−1)），以 Gram–Schmidt 從 e_i − e_{i+1} 建立 */
function sumZeroBasis(P: number): Matrix {
  const cols: number[][] = []
  for (let i = 0; i < P - 1; i++) {
    const v = new Array<number>(P).fill(0)
    v[i] = 1
    v[i + 1] = -1
    for (const c of cols) {
      const proj = c.reduce((s, ci, j) => s + ci * v[j], 0)
      for (let j = 0; j < P; j++) v[j] -= proj * c[j]
    }
    const nv = Math.hypot(...v)
    cols.push(v.map((x) => x / nv))
  }
  return Array.from({ length: P }, (_, i) => cols.map((c) => c[i]))
}

function constraintRows(Rx: Matrix, Ru: Matrix | null, P: number): GaugeConstraintRow[] {
  const all = Array.from({ length: P + 1 }, (_, i) => i)
  const B = sumZeroBasis(P)
  // T：(b, z) → (b, a = Bz)
  const T: Matrix = Array.from({ length: P + 1 }, (_, i) =>
    Array.from({ length: P }, (_, j) => (i === 0 ? (j === 0 ? 1 : 0) : j === 0 ? 0 : B[i - 1][j - 1])),
  )
  const defs: { id: GaugeConstraintRow['id']; name: string; reduce: (R: Matrix) => Matrix }[] = [
    { id: 'none', name: '不加約束（b, a₀…a₃ 共 5 個參數）', reduce: (R) => subMatrix(R, all) },
    { id: 'ref', name: '固定 reference phase：a₀ := 0', reduce: (R) => subMatrix(R, all.filter((i) => i !== 1)) },
    { id: 'sumzero', name: '強制 Σaᵢ = 0（重新參數化）', reduce: (R) => congruence(R, T) },
    { id: 'dropb', name: '此路徑不更新 b（b 併入 aᵢ）', reduce: (R) => subMatrix(R, all.filter((i) => i !== 0)) },
    { id: 'dropb_ref', name: '不更新 b ＋ 固定 a₀ := 0', reduce: (R) => subMatrix(R, all.filter((i) => i !== 0 && i !== 1)) },
  ]
  return defs.map((d) => {
    const rx = minAbsEig(d.reduce(Rx))
    const ru = Ru ? minAbsEig(d.reduce(Ru)) : null
    return {
      id: d.id,
      name: d.name,
      params: d.reduce(Rx).length,
      rawMinEig: rx.min,
      rawNull: rx.nulls,
      pdMinEig: ru ? ru.min : null,
      pdNull: ru ? ru.nulls : null,
    }
  })
}

// #region core:gaugeLms
/**
 * Gauge demo 的 block LMS（M = μI）：
 *   raw domain：e[n] = x̃[n]ᵀ(θ − w_k) + v[n]，G_k = (1/N)Σ e·x̃
 *   u-domain  ：d[n] = x̃[n]ᵀ(θ − w_k) 先經有狀態的 H_PD 濾波器 ⇒ e_PD[n] = (h * d)[n] + v[n]
 *               G_k = (1/N)Σ e_PD·r，r = x̃（raw GMAC）或 ũ（filtered-x）
 * raw domain 的每次更新都 ∝ x̃，而 x̃ᵀn = 0 ⇒ n̂ᵀw 永遠等於初值（null 分量凍結）。
 */
export function runGaugeLms(p: {
  theta: number[]
  w0: number[]
  X: Float64Array[]
  U: Float64Array[] | null
  hpd: { b: number[]; a: number[] } | null
  regressor: GaugeGmacReg
  mu: number
  N: number
  blocks: number
  start: number
  sigmaV: number
  rng: Rng
}): { w: Float64Array[]; errRms: Float64Array } {
  const M = p.theta.length
  const w = p.w0.slice()
  const hist = Array.from({ length: M }, () => new Float64Array(p.blocks + 1))
  const errRms = new Float64Array(p.blocks + 1)
  w.forEach((v, i) => (hist[i][0] = v))
  const pd = p.hpd ? new StreamFilter(p.hpd.b, p.hpd.a) : null
  const dot = (n: number) => {
    let s = 0
    for (let i = 0; i < M; i++) s += p.X[i][n] * (p.theta[i] - w[i]) // x̃ᵀ(θ − w)
    return s
  }
  if (pd) for (let n = 0; n < p.start; n++) pd.step(dot(n)) // 暖機：主 PLL 先鎖定（w 不動）
  const reg = p.regressor === 'filtered' && p.U ? p.U : p.X
  const G = new Float64Array(M)
  let n = p.start
  for (let k = 0; k < p.blocks; k++) {
    G.fill(0)
    let e2 = 0
    for (let j = 0; j < p.N; j++, n++) {
      const d = dot(n) // DTC 端的誤差（PD path 之前）
      const e = (pd ? pd.step(d) : d) + (p.sigmaV > 0 ? p.sigmaV * p.rng.normal() : 0) // ← 差異：u-domain 先經 H_PD
      e2 += e * e
      for (let i = 0; i < M; i++) G[i] += e * reg[i][n] // GMAC：Σ e·r
    }
    for (let i = 0; i < M; i++) {
      w[i] += (p.mu * G[i]) / p.N // w ← w + μG（M = μI）
      hist[i][k + 1] = w[i]
    }
    errRms[k] = Math.sqrt(e2 / p.N)
  }
  errRms[p.blocks] = errRms[p.blocks - 1] ?? 0
  return { w: hist, errRms }
}
// #endregion

// #region core:gaugeDriftStd
/**
 * u-domain、raw x̃ GMAC 時 w_b 的長期漂移（[近似｜K·N ≫ PLL settling]）。
 *   G_b,k = ε̄_k（block 內 e_PD 的平均）、G_i,k ≈ ε̄_k/P ⇒ 每個 block 把 d 的 DC 推動 −μ(1 + 1/P)·ε̄_k；
 *   這個 step 經 H_PD 之後在往後各 block 的 e_PD 總和是 S = Σ_n s[n]（step response 的總和）。
 *   ⇒ Σ_k ε̄_k = Σ_k η_k / (1 + (1 + 1/P)·μS/N)，η_k ~ N(0, σ_v²/N) 是 block 平均雜訊
 *   ⇒ std(w_b,K − w_b,0) ≈ μσ_v√(K/N) / (1 + (1 + 1/P)·μS/N)
 * type-II PLL：S = 0 ⇒ 純 random walk；type-I（pole r）：S = 1/(1 − r) ⇒ 步進被阻尼，但仍然沒有恢復力。
 */
export function gaugeDriftStd(p: { mu: number; sigmaV: number; N: number; blocks: number; P: number; stepSum: number }): { std: number; damping: number } {
  const c = ((1 + 1 / p.P) * p.mu * p.stepSum) / p.N // ← 差異：type-II 時 S = 0 ⇒ c = 0（沒有阻尼）
  const damping = 1 / Math.max(1 + c, 1e-12)
  return { std: p.mu * p.sigmaV * Math.sqrt(p.blocks / p.N) * damping, damping }
}
// #endregion

/** Gauge demo 的 LMS 樣本上限（記憶體：每個樣本 5 欄 × 2 個 domain 的 Float64） */
export const GAUGE_MAX_LMS_SAMPLES = 400000

/**
 * §9.2 Gauge Lab 的全部計算（worker 可呼叫）：
 * 兩組參數同輸出、raw-x 與 u-domain 的 R / eigenvalues / null space、約束比較、LMS demo。
 */
export function gaugeAnalysis(p: GaugeParams): GaugeResult {
  const P = p.a.length
  const warnings: string[] = []
  const rng = createRng(p.seed)
  const N = Math.max(1, Math.floor(p.N))
  let blocks = Math.max(1, Math.floor(p.blocks))
  if (blocks * N > GAUGE_MAX_LMS_SAMPLES) {
    blocks = Math.max(1, Math.floor(GAUGE_MAX_LMS_SAMPLES / N))
    warnings.push(`LMS demo 長度上限：blocks·N 不超過 ${GAUGE_MAX_LMS_SAMPLES} samples，blocks 自動降為 ${blocks}。`)
  }
  const skip = Math.max(0, Math.floor(p.skip))
  const T = Math.max(Math.floor(p.T), skip + blocks * N + 1, skip + 64)
  const seqRng = rng.fork('phase-sequence')
  const phase = new Int32Array(T)
  for (let n = 0; n < T; n++) phase[n] = p.sequence === 'random' ? seqRng.int(0, P - 1) : n % P

  const tfRaw = pathTransfer(p)
  warnings.push(...tfRaw.warnings)
  const tf = { b: tfRaw.b, a: tfRaw.a, description: tfRaw.description }
  const dcGain = sumArr(tf.b) / sumArr(tf.a)
  const hLen = p.path === 'none' ? 1 : Math.min(200000, Math.max(2000, Math.ceil(60 / Math.max(1e-4, p.path === 'type2' ? p.zeta * p.wnTs : 1 - p.hpPole))))
  const h = impulseResponse(tf.b, tf.a, hLen)
  let hNorm2 = 0
  let hStepSum = 0 // Σ_n s[n]，s = step response（cumsum of h）
  let stepAcc = 0
  for (let i = 0; i < h.length; i++) {
    hNorm2 += h[i] * h[i]
    stepAcc += h[i]
    hStepSum += stepAcc
  }
  if (p.path === 'none') hStepSum = 0 // H = 1：step response 不衰減，這個量沒有意義（raw domain 不用它）

  const X = gaugeRegressorsRaw(phase, P)
  const U = p.path === 'none' ? X : gaugeRegressorsPd(X, tf)

  const theta = [p.b, ...p.a]
  const nVec = gaugeNullVector(P)
  const thetaG = theta.map((t, i) => t + p.c * nVec[i])
  const thetaB = theta.map((t, i) => (i === 0 ? t + p.dB : t))
  const outAt = (src: Float64Array[], th: number[], n: number) => {
    let s = 0
    for (let i = 0; i <= P; i++) s += src[i][n] * th[i]
    return s
  }
  const nPrev = 48
  const previewN = new Float64Array(nPrev)
  const yRaw = new Float64Array(nPrev)
  const yRawGauge = new Float64Array(nPrev)
  const yRawB = new Float64Array(nPrev)
  const yPd = new Float64Array(nPrev)
  const yPdGauge = new Float64Array(nPrev)
  const yPdB = new Float64Array(nPrev)
  let maxDiffRawGauge = 0
  let maxDiffRawB = 0
  let maxDiffPdGauge = 0
  let maxDiffPdB = 0
  for (let n = 0; n < T; n++) {
    const y0 = outAt(X, theta, n)
    const yg = outAt(X, thetaG, n)
    const yb = outAt(X, thetaB, n)
    maxDiffRawGauge = Math.max(maxDiffRawGauge, Math.abs(y0 - yg))
    maxDiffRawB = Math.max(maxDiffRawB, Math.abs(y0 - yb))
    if (n < nPrev) {
      previewN[n] = n
      yRaw[n] = y0
      yRawGauge[n] = yg
      yRawB[n] = yb
    }
    if (n >= skip) {
      const e0 = outAt(U, theta, n)
      const eg = outAt(U, thetaG, n)
      const eb = outAt(U, thetaB, n)
      maxDiffPdGauge = Math.max(maxDiffPdGauge, Math.abs(e0 - eg))
      maxDiffPdB = Math.max(maxDiffPdB, Math.abs(e0 - eb))
      const j = n - skip
      if (j < nPrev) {
        yPd[j] = e0
        yPdGauge[j] = eg
        yPdB[j] = eb
      }
    }
  }

  const Rx = sampleCorrelation(X, X, skip, T)
  const Ru = sampleCorrelation(U, U, skip, T)
  const C = sampleCorrelation(X, U, skip, T)
  const eigRx = eigSym(Rx).values
  const eigRu = eigSym(Ru).values
  const svC = svd(C).S // C 不對稱 ⇒ 用 SVD（null space 看 σ_i ≈ 0）

  // 各相出現頻率相等（iid 均勻或 cyclic）：R_x = [[1, 1ᵀ/P], [1/P, I/P]] ⇒ eig = {1 + 1/P, 1/P (×(P−1)), 0}
  // （R_x 只看同一時刻，與時間相關性無關；cyclic 的頻率在整數週期上精確相等）
  const eigRxAnalytic: number[] = [1 + 1 / P, ...new Array<number>(P - 1).fill(1 / P), 0]
  let eigRuAnalytic: number[] | null = null
  if (p.path === 'none') {
    eigRuAnalytic = eigRxAnalytic
  } else if (p.sequence === 'random') {
    // R_u = ‖h‖²·Cov(x̃) + H(1)²·m mᵀ；H(1) = 0 ⇒ eig = {‖h‖²/P (×(P−1)), 0, 0}
    const m = [1, ...new Array<number>(P).fill(1 / P)]
    const RuA: Matrix = theta.map((_, i) =>
      theta.map((__, j) => {
        const rx = i === 0 && j === 0 ? 1 : i === 0 || j === 0 ? 1 / P : i === j ? 1 / P : 0
        return hNorm2 * (rx - m[i] * m[j]) + dcGain * dcGain * m[i] * m[j]
      }),
    )
    eigRuAnalytic = eigSym(RuA).values
  }

  const nullRx = nullSpaceSym(Rx, 1e-9).basis
  const nullRu = nullSpaceSym(Ru, 1e-9).basis
  const eb = [1, ...new Array<number>(P).fill(0)]
  const cmv = [0, ...new Array<number>(P).fill(1)]
  const residual = {
    nOnRx: matNormVec(Rx, nVec),
    ebOnRu: matNormVec(Ru, eb),
    cmOnRu: matNormVec(Ru, cmv),
    nOnRu: matNormVec(Ru, nVec),
  }
  const constraints = constraintRows(Rx, p.path === 'none' ? null : Ru, P)

  // LMS demo
  const start = skip
  const lmsRng = rng.fork('lms-noise')
  const nHat = nVec.map((v) => v / Math.hypot(...nVec))
  const mkRun = (label: string, domain: 'raw' | 'pd', w0: number[], forkLabel: string): GaugeLmsRun => {
    const r = runGaugeLms({
      theta,
      w0,
      X,
      U: domain === 'pd' ? U : null,
      hpd: domain === 'pd' ? tf : null,
      regressor: domain === 'pd' ? p.gmacReg : 'raw',
      mu: p.mu,
      N,
      blocks,
      start,
      sigmaV: p.sigmaV,
      rng: lmsRng.fork(forkLabel),
    })
    const L = blocks + 1
    const nullProj = new Float64Array(L)
    const cm = new Float64Array(L)
    for (let k = 0; k < L; k++) {
      let s = 0
      let c = 0
      for (let i = 0; i <= P; i++) s += nHat[i] * r.w[i][k]
      for (let i = 1; i <= P; i++) c += r.w[i][k]
      nullProj[k] = s
      cm[k] = c / P
    }
    return {
      label,
      domain,
      wb: r.w[0],
      a: r.w.slice(1),
      nullProj,
      cm,
      errRms: r.errRms,
      final: r.w.map((col) => col[blocks]),
    }
  }
  const runs: GaugeLmsRun[] = [mkRun('A：raw-x，初值 w₀ᴬ', 'raw', p.w0A, 'A'), mkRun('B：raw-x，初值 w₀ᴮ', 'raw', p.w0B, 'B')]
  if (p.path !== 'none') runs.push(mkRun(`C：u-domain（${p.gmacReg === 'raw' ? 'raw x̃' : 'filtered ũ'} GMAC），初值 w₀ᴬ`, 'pd', p.w0A, 'C'))
  const k = new Float64Array(blocks + 1).map((_, i) => i)
  const drift = gaugeDriftStd({ mu: p.mu, sigmaV: p.sigmaV, N, blocks, P, stepSum: hStepSum })

  if (p.path !== 'none' && Math.abs(dcGain) > 1e-9) {
    warnings.push(`H(1) = ${dcGain.toPrecision(4)} ≠ 0：此 error path 沒有完全抑制 DC，b 仍部分可觀察。`)
  }
  if (p.path !== 'none' && skip < T) {
    // ũ_b[n] = H_PD 的 step response；暖機結束時若尚未衰減，u-domain 的統計仍看得到一點 b（暫態，不是穩態可觀察）
    const tail = Math.abs(U[0][skip])
    if (tail > 1e-6) {
      warnings.push(
        `暖機不足：skip = ${skip} 時 H_PD 的 step response ũ_b 仍有 ${tail.toExponential(2)}（尚未 → 0），u-domain 的 R_u、null space 與「只動 b」的比較仍含暫態；請加大 skip（穩態下 b 完全不可觀察）。`,
      )
    }
  }

  return {
    P,
    tf,
    dcGain,
    hNorm2,
    hStepSum,
    previewN,
    yRaw,
    yRawGauge,
    yRawB,
    yPd,
    yPdGauge,
    yPdB,
    maxDiffRawGauge,
    maxDiffRawB,
    maxDiffPdGauge,
    maxDiffPdB,
    Rx,
    Ru,
    C,
    eigRx,
    eigRu,
    svC,
    eigRxAnalytic,
    eigRuAnalytic,
    nullRx,
    nullRu,
    residual,
    constraints,
    lms: { k, runs, driftStdPred: drift.std, driftDamping: drift.damping },
    warnings,
  }
}
