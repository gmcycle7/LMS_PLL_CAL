/**
 * 第 3 章：純量 LMS 的三種穩定性 —— Mean、Mean-Square（MSD）與 Almost-Sure（樣本路徑）。
 * 模型層級 L0（純數學、浮點、無量化）；規格 §3、§3.1 與勘誤 E14 / E38 / E39 / E42。
 *
 * 模型：y_n = a·x_n + v_n，e_n = y_n − w_n·x_n，LMS 更新 w_{n+1} = w_n + μ·e_n·x_n。
 * 全站極性 δ_n = a − w_n（勘誤 E39），因此
 *   e_n = δ_n·x_n + v_n
 *   δ_{n+1} = (1 − μx_n²)·δ_n − μ·x_n·v_n
 *
 * x_n iid 且與 v 獨立時，x_n 與 δ_n 自動獨立（δ_n 只由 δ_0、x_0…x_{n−1}、v_0…v_{n−1} 決定），
 * 所以下面的 mean / mean-square 遞迴是精確式（勘誤 E38），不是 independence approximation。
 *
 * 本檔只放純函式（不 import React / DOM），參數與回傳值皆可 structured clone，
 * 可由 useWorkerTask('scalarStability', '<fn>') 在 Web Worker 中執行。
 */

import { createRng, normCdf, normInv, type Rng } from '@/simulation/core'
import { gaussianLyapunov, meanPole, meanSquareFactor } from './lms'

/* ───────────────────────── 輸入分布 ───────────────────────── */

/** x_n 的分布（每一筆都 iid 抽樣；fixed 是退化分布） */
export type XDist =
  | { kind: 'fixed'; value: number }
  | { kind: 'gaussian'; sigma: number }
  | { kind: 'uniform'; halfWidth: number }
  | { kind: 'pm_one'; amplitude: number }
  | { kind: 'list'; values: number[] }

export type XDistKind = XDist['kind']

export const DIST_LABEL: Record<XDistKind, string> = {
  fixed: '固定 x（退化分布）',
  gaussian: 'Gaussian N(0, σ²)',
  uniform: 'Uniform U(−c, c)',
  pm_one: '±A（等機率，bipolar）',
  list: '自訂清單（iid 等機率抽樣）',
}

/** x 的偶數階動差：P_x = E[x²]、M_4 = E[x⁴]、M_6、M_8，以及 kurtosis κ = M_4 / P_x² */
export interface XMoments {
  Px: number
  M4: number
  M6: number
  M8: number
  kurtosis: number
}

/**
 * 解析動差。Gaussian 用 E[t^{2k}] = (2k−1)!!（分部積分，見第 3 章先備知識），
 * Uniform U(−c, c) 用 E[x^{2k}] = c^{2k}/(2k+1)，±A 與固定 x 為 A^{2k}，清單取平均。
 */
export function xMoments(d: XDist): XMoments {
  let Px: number
  let M4: number
  let M6: number
  let M8: number
  switch (d.kind) {
    case 'fixed':
    case 'pm_one': {
      const a2 = d.kind === 'fixed' ? d.value * d.value : d.amplitude * d.amplitude
      Px = a2
      M4 = a2 * a2
      M6 = M4 * a2
      M8 = M4 * M4
      break
    }
    case 'gaussian': {
      const s2 = d.sigma * d.sigma
      Px = s2
      M4 = 3 * s2 * s2
      M6 = 15 * s2 * s2 * s2
      M8 = 105 * s2 * s2 * s2 * s2
      break
    }
    case 'uniform': {
      const c2 = d.halfWidth * d.halfWidth
      Px = c2 / 3
      M4 = (c2 * c2) / 5
      M6 = (c2 * c2 * c2) / 7
      M8 = (c2 * c2 * c2 * c2) / 9
      break
    }
    case 'list': {
      const k = d.values.length
      let s2 = 0
      let s4 = 0
      let s6 = 0
      let s8 = 0
      for (const v of d.values) {
        const v2 = v * v
        s2 += v2
        s4 += v2 * v2
        s6 += v2 * v2 * v2
        s8 += v2 * v2 * v2 * v2
      }
      Px = k ? s2 / k : 0
      M4 = k ? s4 / k : 0
      M6 = k ? s6 / k : 0
      M8 = k ? s8 / k : 0
      break
    }
  }
  return { Px, M4, M6, M8, kurtosis: Px > 0 ? M4 / (Px * Px) : NaN }
}

/** 檢查分布參數；回傳中文錯誤訊息（合法時回傳 null）。 */
export function validateDist(d: XDist): string | null {
  switch (d.kind) {
    case 'fixed':
      return Number.isFinite(d.value) ? null : 'x 必須是有限數值'
    case 'gaussian':
      return Number.isFinite(d.sigma) && d.sigma >= 0 ? null : 'σ 必須 ≥ 0'
    case 'uniform':
      return Number.isFinite(d.halfWidth) && d.halfWidth >= 0 ? null : '半寬 c 必須 ≥ 0'
    case 'pm_one':
      return Number.isFinite(d.amplitude) ? null : 'A 必須是有限數值'
    case 'list':
      if (d.values.length === 0) return '清單至少要有一個數值'
      if (d.values.length > 1000) return '清單最多 1000 個數值'
      return d.values.every((v) => Number.isFinite(v)) ? null : '清單含有非數值項目'
  }
}

// #region core:drawX
/** 由分布抽一筆 x（每一筆獨立；用同一個 rng 串流可完全重現）。 */
export function drawX(d: XDist, rng: Rng): number {
  switch (d.kind) {
    case 'fixed':
      return d.value // 退化分布：每一筆都一樣
    case 'gaussian':
      return d.sigma * rng.normal() // N(0, σ²)
    case 'uniform':
      return d.halfWidth * (2 * rng.uniform() - 1) // U(−c, c)
    case 'pm_one':
      return d.amplitude * rng.sign() // ±A 各 1/2
    case 'list':
      return d.values[rng.int(0, d.values.length - 1)] // 清單中等機率抽一個
  }
}
// #endregion

/* ───────────────────────── 三種判據的「每步因子」 ───────────────────────── */

// #region core:meanCriterion
/** Mean：E[δ_{n+1}] = E[f]·E[δ_n]，f = 1 − μx²。收斂 ⇔ |E[f]| < 1。 */
export function meanCriterion(f: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < f.length; i++) s += f[i] // ← 差異：平均 f 本身（正負號會互相抵消）
  return s / f.length
}
// #endregion

// #region core:meanSquareCriterion
/** Mean-square（MSD）：E[δ²_{n+1}] = E[f²]·E[δ²_n]。收斂 ⇔ E[f²] < 1。 */
export function meanSquareCriterion(f: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < f.length; i++) s += f[i] * f[i] // ← 差異：平均 f²（少數很大的 |f| 被平方放大）
  return s / f.length
}
// #endregion

// #region core:almostSureCriterion
/** Almost-sure：ln|δ_n| = ln|δ_0| + Σ ln|f_k|，平均斜率 → E[ln|f|]。收斂 ⇔ E[ln|f|] < 0。 */
export function almostSureCriterion(f: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < f.length; i++) s += Math.log(Math.abs(f[i])) // ← 差異：平均 ln|f|（乘積變總和）
  return s / f.length
}
// #endregion

/* ───────────────────────── Lyapunov 指數 λ(μ) = E ln|1 − μx²| ───────────────────────── */

const EULER_GAMMA = 0.5772156649015329

// #region core:uniformLyapunov
/**
 * x ~ U(−c, c) 的 λ(μ) 封閉式（只用到 ∫ ln(1 ± s·x) dx，微積分即可推導）：
 *   λ = [(1+u)·ln(1+u) − (1−u)·ln|1−u|]/u − 2，u = c·√μ。
 * u 很小時兩項幾乎相消，改用泰勒級數 λ = −u²/3 − u⁴/10 − u⁶/21 − u⁸/36 − …
 */
export function uniformLyapunov(mu: number, halfWidth: number): number {
  if (mu === 0 || halfWidth === 0) return 0
  if (mu < 0) return uniformLyapunovNeg(mu, halfWidth) // μ < 0 只用於「極性反轉」示範
  const u = Math.abs(halfWidth) * Math.sqrt(mu)
  if (u < 1e-2) {
    const u2 = u * u
    return -u2 / 3 - (u2 * u2) / 10 - (u2 * u2 * u2) / 21 - (u2 * u2 * u2 * u2) / 36
  }
  const right = u === 1 ? 0 : (1 - u) * Math.log(Math.abs(1 - u)) // (1−u)·ln|1−u| 在 u = 1 的極限為 0
  return ((1 + u) * Math.log(1 + u) - right) / u - 2
}
// #endregion

/** μ < 0 時 1 − μx² = 1 + |μ|x² > 1，λ = E ln(1 + |μ|x²) > 0（數值積分；只用於負 μ 的示範）。 */
function uniformLyapunovNeg(mu: number, halfWidth: number): number {
  const s = Math.sqrt(-mu) * halfWidth
  // (1/c)∫_0^c ln(1 + s²x²/c²) dx = ∫_0^1 ln(1 + s²t²) dt = ln(1+s²) − 2 + 2·atan(s)/s
  return Math.log(1 + s * s) - 2 + (2 * Math.atan(s)) / s
}

// #region core:gaussianLyapunovDawson
/**
 * x ~ N(0, σ²) 的 λ(μ)，令 c = μσ²（研究層級的另一種算法，用來交叉驗證 lms.ts 的直接積分）：
 *   λ = ln(c/2) − γ + 2∫_0^∞ e^{−t²/4}·(1 − cos(z t))/t dt，z = 1/√(2c)，γ = Euler 常數。
 * 這個被積函數處處平滑（沒有 ln 0 奇點），Simpson 積分即可達 1e−9 等級。
 * c 很小時改用漸近級數 λ ≈ −Σ_k (2k−1)!!·c^k/k（截在最小項，誤差約 e^{−1/(2c)}）。
 */
export function gaussianLyapunovDawson(mu: number, sigma = 1): number {
  const c = mu * sigma * sigma
  if (c === 0) return 0
  if (c < 0) return gaussianLyapunovNeg(-c)
  if (c < 0.02) {
    let term = 1 // (2k−1)!!·c^k，從 k = 1 開始
    let sum = 0
    let prev = Infinity
    for (let k = 1; k < 200; k++) {
      term *= (2 * k - 1) * c
      const t = term / k
      if (t > prev) break // 漸近級數：越過最小項就停止
      sum += t
      prev = t
    }
    return -sum
  }
  const z = 1 / Math.sqrt(2 * c)
  const T = 2 * Math.sqrt(40) // e^{−T²/4} = e^{−40}
  const m = Math.max(2000, 2 * Math.ceil((T * z) / 0.1)) // 每個 cos 週期至少約 60 點
  const h = T / m
  const f = (t: number) => {
    if (t === 0) return 0
    const s = Math.sin(0.5 * z * t)
    return (Math.exp(-0.25 * t * t) * 2 * s * s) / t // (1 − cos zt) = 2 sin²(zt/2)，避免相消
  }
  let acc = f(0) + f(T)
  for (let i = 1; i < m; i++) acc += (i % 2 ? 4 : 2) * f(i * h)
  return Math.log(c / 2) - EULER_GAMMA + (2 * acc * h) / 3
}
// #endregion

/** μ < 0：E ln(1 + c t²)，t ~ N(0,1)（直接 Simpson 積分；被積函數平滑）。 */
function gaussianLyapunovNeg(c: number): number {
  const T = 12
  const m = 4000
  const h = T / m
  const f = (t: number) => (Math.log(1 + c * t * t) * Math.exp(-0.5 * t * t)) / Math.sqrt(2 * Math.PI)
  let acc = f(0) + f(T)
  for (let i = 1; i < m; i++) acc += (i % 2 ? 4 : 2) * f(i * h)
  return (2 * acc * h) / 3
}

/**
 * λ(μ) = E ln|1 − μx²|（almost-sure / Lyapunov 指數）。
 * 固定 x 與 ±A：ln|1 − μA²|（三種判據相同）；Uniform：封閉式；Gaussian：Dawson 形式；清單：直接平均。
 * 若某個可能的 x 使 1 − μx² = 0，λ = −∞（抽到它的那一步誤差直接歸零）。
 */
export function lyapunovExponent(mu: number, d: XDist): number {
  switch (d.kind) {
    case 'fixed':
      return Math.log(Math.abs(1 - mu * d.value * d.value))
    case 'pm_one':
      return Math.log(Math.abs(1 - mu * d.amplitude * d.amplitude))
    case 'uniform':
      return uniformLyapunov(mu, d.halfWidth)
    case 'gaussian':
      return gaussianLyapunovDawson(mu, d.sigma)
    case 'list': {
      let s = 0
      for (const v of d.values) s += Math.log(Math.abs(1 - mu * v * v))
      return d.values.length ? s / d.values.length : 0
    }
  }
}

/** h(μ) = E[(1 − μx²)⁴]：δ_n⁴ 的每步因子（用來算「天真 Monte Carlo」的真實標準誤，勘誤 E14）。 */
export function fourthPowerFactor(mu: number, m: XMoments): number {
  const mu2 = mu * mu
  return 1 - 4 * mu * m.Px + 6 * mu2 * m.M4 - 4 * mu2 * mu * m.M6 + mu2 * mu2 * m.M8
}

/* ───────────────────────── Kesten 尾指數（研究層級） ───────────────────────── */

/**
 * 在 [a, b] 上積分 g，b 端可有 |t − b|^s 或 ln|t − b| 型奇點：代換 t = b − (b − a)w^k（k = 2 或 4）讓被積函數平滑。
 * w = 0 時被積函數的極限是 0（w^{k−1}·ln w → 0），直接回傳 0，避免 0·(−∞) = NaN。
 */
function integrateToCusp(g: (t: number) => number, a: number, b: number, n: number, k = 2): number {
  if (b <= a) return 0
  const L = b - a
  const f = (w: number) => (w === 0 ? 0 : g(b - L * w ** k) * k * L * w ** (k - 1))
  return simpson(f, 0, 1, n)
}
/** 在 [a, b] 上積分 g，a 端有奇點：代換 t = a + (b − a)w^k。 */
function integrateFromCusp(g: (t: number) => number, a: number, b: number, n: number, k = 2): number {
  if (b <= a) return 0
  const L = b - a
  const f = (w: number) => (w === 0 ? 0 : g(a + L * w ** k) * k * L * w ** (k - 1))
  return simpson(f, 0, 1, n)
}
function simpson(f: (t: number) => number, a: number, b: number, n: number): number {
  const m = n % 2 === 0 ? n : n + 1
  const h = (b - a) / m
  let s = f(a) + f(b)
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(a + i * h)
  return (s * h) / 3
}

/**
 * m(s) = E|1 − μx²|^s（s > 0）。s = 2 時就是 g(μ)；m(0) = 1，m'(0) = λ(μ)，且 ln m(s) 對 s 是凸函數。
 * Gaussian 與 Uniform 以分段 Simpson（在 1 − μx² = 0 的尖點兩側做變數代換）計算。
 */
export function absPowerFactor(mu: number, d: XDist, s: number): number {
  switch (d.kind) {
    case 'fixed':
      return Math.pow(Math.abs(1 - mu * d.value * d.value), s)
    case 'pm_one':
      return Math.pow(Math.abs(1 - mu * d.amplitude * d.amplitude), s)
    case 'list': {
      let acc = 0
      for (const v of d.values) acc += Math.pow(Math.abs(1 - mu * v * v), s)
      return d.values.length ? acc / d.values.length : 1
    }
    case 'uniform': {
      const u2 = mu * d.halfWidth * d.halfWidth // ∫_0^1 |1 − u²t²|^s dt
      const g = (t: number) => Math.pow(Math.abs(1 - u2 * t * t), s)
      if (u2 <= 1) return simpson(g, 0, 1, 2000)
      const t0 = 1 / Math.sqrt(u2)
      return integrateToCusp(g, 0, t0, 2000) + integrateFromCusp(g, t0, 1, 2000)
    }
    case 'gaussian': {
      const c = mu * d.sigma * d.sigma
      const phi = (t: number) => Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI)
      const g = (t: number) => Math.pow(Math.abs(1 - c * t * t), s) * phi(t)
      if (c <= 0) return 2 * simpson(g, 0, 14, 4000)
      const t0 = 1 / Math.sqrt(c)
      const mid = Math.min(t0 + 1, t0 * 1.5)
      return 2 * (integrateToCusp(g, 0, t0, 3000) + integrateFromCusp(g, t0, mid, 3000) + simpson(g, mid, Math.max(mid + 14, 14), 6000))
    }
  }
}

/**
 * Kesten–Goldie 尾指數 κ_t：E|1 − μx²|^{κ_t} = 1 的正根。
 * 有量測雜訊且 λ(μ) < 0 時，δ_n 收斂到穩態分布，其尾巴 P(|δ_∞| > t) ~ C·t^{−κ_t}（研究層級，Kesten 1973 / Goldie 1991）。
 * 因為 m(2) = g(μ)：g < 1 ⇔ κ_t > 2（穩態變異數有限）；g ≥ 1 ⇔ κ_t ≤ 2（穩態變異數無限大）。
 * 回傳 0 表示 λ ≥ 0（沒有穩態，路徑發散）。
 * 回傳 Infinity 表示在搜尋上限 s ≤ KESTEN_S_MAX 內沒有根：不是 |1 − μx²| ≤ 1 幾乎必然（有界分布、小 μ：真的沒有冪次尾），
 * 就是 κ_t > KESTEN_S_MAX（例如 Gaussian 的小 μ：x 無上界，κ_t 有限但極大，穩態的前 64 階動差都有限，實務上看不到 heavy tail）。
 */
export const KESTEN_S_MAX = 64

export function kestenTailExponent(mu: number, d: XDist): number {
  if (!(lyapunovExponent(mu, d) < 0)) return 0
  const sMax = KESTEN_S_MAX
  if (absPowerFactor(mu, d, sMax) < 1) return Infinity
  let lo = 1e-6
  let hi = sMax
  for (let i = 0; i < 70; i++) {
    const mid = Math.sqrt(lo * hi) // 在 log 尺度二分
    if (absPowerFactor(mu, d, mid) < 1) lo = mid
    else hi = mid
  }
  return Math.sqrt(lo * hi)
}

/**
 * Hill 尾指數估計（approx；用來和 Kesten 理論值比較）：取最大的 k 個 |δ|，
 * κ̂ = 1 / mean_{i<k}[ln|δ|_(i) − ln|δ|_(k)]。輸入為已排序（遞增）的 log10|δ|。
 */
export function hillEstimator(sortedLog10: ArrayLike<number>, k: number): number {
  const n = sortedLog10.length
  const kk = Math.min(Math.max(2, Math.floor(k)), n - 1)
  const ref = sortedLog10[n - 1 - kk]
  if (!Number.isFinite(ref)) return NaN
  let s = 0
  for (let i = n - kk; i < n; i++) {
    if (!Number.isFinite(sortedLog10[i])) return NaN
    s += (sortedLog10[i] - ref) * Math.LN10
  }
  return s > 0 ? kk / s : NaN
}

/* ───────────────────────── 分位帶與收斂比例的 CLT 預測 ───────────────────────── */

/**
 * ∫ F(ln|1 − (t/t_0)²|, t) dt，積分區間的一端是對數奇點 t_0、另一端是 other（可在 t_0 的任一側）。
 * 代換 t = t_0 ± L·w⁴（L = |other − t_0|）後，1 − t/t_0 = ∓(L/t_0)·w⁴ 與 1 + t/t_0 = 2 ± (L/t_0)·w⁴ 都可以「直接」用 w 寫出，
 * 不經過 1 − (t/t_0)² 的浮點相減（否則 w 很小時會算出 ln 0 = −∞）。w = 0 的極限是 0（w³·(ln w)^k → 0）。
 */
function integrateLogCusp(F: (y: number, t: number) => number, t0: number, other: number, n: number): number {
  const L = Math.abs(other - t0)
  if (!(L > 0)) return 0
  const r = L / t0
  const sgn = other > t0 ? 1 : -1
  const lnR = Math.log(r)
  const f = (w: number) => {
    if (w === 0) return 0
    const w4 = w ** 4
    const y = lnR + 4 * Math.log(w) + Math.log(2 + sgn * r * w4) // = ln|1 − (t/t_0)²|
    return F(y, t0 + sgn * L * w4) * 4 * L * w ** 3
  }
  return simpson(f, 0, 1, n)
}

// #region core:logFactorVariance
/**
 * s²(μ) = Var(ln|1 − μx²|) = E[(ln|f|)²] − λ²：log 域每一步增量 Y = ln|f| 的變異數。
 * 無雜訊時 ln|δ_n/δ_0| = Σ Y_k 是 n 個 iid 項的總和：平均 nλ、變異數 n·s²（這兩個是精確的），
 * 分布則由中央極限定理近似為常態（n 大時）。固定 x 與 ±A：Y 是常數，s² = 0。
 * 若某個可能的 x 使 f = 0（Y = −∞），變異數沒有定義，回傳 NaN。
 */
export function logFactorVariance(mu: number, d: XDist): number {
  const lam = lyapunovExponent(mu, d) // E[Y]
  if (!Number.isFinite(lam)) return NaN
  let m2: number // E[Y²]
  switch (d.kind) {
    case 'fixed':
    case 'pm_one':
      return 0 // Y 是常數
    case 'list': {
      let acc = 0
      for (const v of d.values) acc += Math.log(Math.abs(1 - mu * v * v)) ** 2
      m2 = acc / d.values.length
      break
    }
    case 'uniform': {
      const u2 = mu * d.halfWidth * d.halfWidth // t = |x|/c ~ U(0, 1)：Y = ln|1 − u²t²|
      if (u2 === 0) return 0
      if (u2 < 0) m2 = simpson((t) => Math.log(1 - u2 * t * t) ** 2, 0, 1, 2000)
      else {
        const u = Math.sqrt(u2)
        if (u <= 1) {
          // 奇點 t_0 = 1/u ≥ 1 在區間右端或之外：t = 1 − w⁴，1 − ut = (1 − u) + u·w⁴（不相消）
          m2 = simpson((w) => (w === 0 ? 0 : (Math.log(1 - u + u * w ** 4) + Math.log(1 + u * (1 - w ** 4))) ** 2 * 4 * w ** 3), 0, 1, 4000)
        } else {
          const sq = (y: number) => y * y
          m2 = integrateLogCusp(sq, 1 / u, 0, 4000) + integrateLogCusp(sq, 1 / u, 1, 4000)
        }
      }
      break
    }
    case 'gaussian': {
      const c = mu * d.sigma * d.sigma // t = x/σ ~ N(0, 1)：Y = ln|1 − c·t²|
      if (c === 0) return 0
      const phi = (t: number) => Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI)
      if (c < 0) m2 = 2 * simpson((t) => Math.log(1 - c * t * t) ** 2 * phi(t), 0, 14, 4000)
      else {
        const t0 = 1 / Math.sqrt(c) // (ln)² 奇點：可積
        const mid = Math.min(t0 + 1, t0 * 1.5)
        const F = (y: number, t: number) => y * y * phi(t)
        const tail = simpson((t) => Math.log(c * t * t - 1) ** 2 * phi(t), mid, Math.max(mid + 14, 14), 6000)
        m2 = 2 * (integrateLogCusp(F, t0, 0, 6000) + integrateLogCusp(F, t0, mid, 4000) + tail)
      }
      break
    }
  }
  return Math.max(0, m2 - lam * lam) // Var(Y) = E[Y²] − E[Y]²
}
// #endregion

// #region core:cltPrediction
/**
 * CLT 近似（[近似｜需驗證]）：ln|δ_n/δ_0| ≈ N(nλ, n·s²)。
 *   收斂比例  P(|δ_n| < ε|δ_0|) ≈ Φ((ln ε − nλ)/(s√n))
 *   p 分位數  log10|δ_n/δ_0| ≈ (nλ + z_p·s·√n)/ln 10，z_p = Φ⁻¹(p)
 * s = 0（固定 x、±A）時所有路徑相同：比例是 0 或 1 的階梯、分位數都等於 nλ/ln 10（此時是精確的）。
 */
export function cltConvergedFraction(lambda: number, s: number, n: number, eps = 1e-3): number {
  if (!Number.isFinite(lambda) || !(s >= 0)) return NaN
  const target = Math.log(eps)
  if (n <= 0) return 0 < target ? 1 : 0 // n = 0：ln|δ_0/δ_0| = 0
  if (s === 0) return n * lambda < target ? 1 : 0
  return normCdf(cltZScore(lambda, s, n, eps))
}

/** 標準化：門檻 ln ε 離中位數 nλ 幾個標準差 s√n（查 Φ 表用的 z；「帶入手算」HC-03.7 的第一個答案）。需要 s > 0、n ≥ 1。 */
export function cltZScore(lambda: number, s: number, n: number, eps = 1e-3): number {
  return (Math.log(eps) - n * lambda) / (s * Math.sqrt(n))
}

export function cltLog10Quantile(lambda: number, s: number, n: number, p: number): number {
  if (!Number.isFinite(lambda) || !(s >= 0)) return NaN
  if (n <= 0) return 0
  return (n * lambda + (s === 0 ? 0 : normInv(p) * s * Math.sqrt(n))) / Math.LN10
}
// #endregion

/** 三種判據在某個 μ 的每步因子。 */
export interface StabilityFactors {
  /** 1 − μP_x（mean pole） */
  meanPole: number
  /** g(μ) = 1 − 2μP_x + μ²M_4（MSD 每步因子） */
  g: number
  /** λ(μ) = E ln|1 − μx²| */
  lambda: number
  /** e^λ：每步的「幾何平均」縮放倍率（< 1 ⇔ λ < 0） */
  geoMean: number
  /** h(μ) = E[(1 − μx²)⁴] */
  h: number
}

export function stabilityFactors(mu: number, d: XDist): StabilityFactors {
  const m = xMoments(d)
  const lambda = lyapunovExponent(mu, d)
  return {
    meanPole: meanPole(mu, m.Px),
    g: meanSquareFactor(mu, m.Px, m.M4),
    lambda,
    geoMean: Math.exp(lambda),
    h: fourthPowerFactor(mu, m),
  }
}

/* ───────────────────────── 解析交叉比對（封閉式 vs 獨立的數值積分） ───────────────────────── */

/**
 * Uniform U(−c, c) 的 λ(μ) 直接數值積分（不用 F-03.12 的封閉式，作為獨立的第二種算法）：
 *   λ = ∫_0^1 ln|1 − u²t²| dt = ∫_0^1 [ln|1 − ut| + ln(1 + ut)] dt，u = c√μ。
 * 在 t_0 = 1/u 有對數奇點：以 t = t_0 ∓ L·w⁴ 代換（|1 − ut| 直接寫成 w⁴ 的倍數，避免浮點相消）後用 Simpson 積分。
 */
export function uniformLyapunovQuad(mu: number, halfWidth: number): number {
  const u2 = mu * halfWidth * halfWidth
  if (u2 === 0) return 0
  const n = 4000
  if (u2 < 0) return simpson((t) => Math.log(1 - u2 * t * t), 0, 1, 2000) // ln(1 + |u²|t²)：處處平滑
  const u = Math.sqrt(u2)
  if (u <= 1) {
    // 奇點在 t = 1/u ≥ 1（區間右端或之外）：t = 1 − w⁴，1 − ut = (1 − u) + u·w⁴
    const f = (w: number) => {
      if (w === 0) return 0
      const w4 = w ** 4
      return (Math.log(1 - u + u * w4) + Math.log(1 + u * (1 - w4))) * 4 * w ** 3
    }
    return simpson(f, 0, 1, n)
  }
  const t0 = 1 / u
  const L = 1 - t0
  // 左段 t = t_0(1 − w⁴)：1 − ut = w⁴、1 + ut = 2 − w⁴
  const left = (w: number) => (w === 0 ? 0 : (4 * Math.log(w) + Math.log(2 - w ** 4)) * 4 * t0 * w ** 3)
  // 右段 t = t_0 + L·w⁴：|1 − ut| = uL·w⁴、1 + ut = 2 + uL·w⁴
  const right = (w: number) => (w === 0 ? 0 : (Math.log(u * L) + 4 * Math.log(w) + Math.log(2 + u * L * w ** 4)) * 4 * L * w ** 3)
  return simpson(left, 0, 1, n) + simpson(right, 0, 1, n)
}

export interface AnalyticCrossCheck {
  /** g(μ)：封閉式 1 − 2μP_x + μ²M_4 vs 數值積分 E|1 − μx²|² */
  gClosed: number
  gQuad: number
  /** h(μ)：封閉式（動差展開）vs 數值積分 E|1 − μx²|⁴ */
  hClosed: number
  hQuad: number
  /** λ(μ)：本檔的主算法 vs 第二種算法（null = 沒有獨立的第二種算法，例如有限清單的直接平均本身就是精確式） */
  lambda: number
  lambdaAlt: number | null
  /** 第二種算法的說明（給 UI） */
  lambdaAltMethod: string
  /** |g 差|、|h 差| 的相對誤差與 |λ 差| */
  gRelDev: number
  hRelDev: number
  lambdaDev: number
  ok: boolean
}

/**
 * 解析結果的獨立交叉比對（實驗的「Analytic」欄）：
 *   g、h 的動差封閉式 ↔ 直接數值積分 E|1 − μx²|^s（s = 2、4；與動差公式無共用程式碼）；
 *   λ：Gaussian 用 Dawson 形式 ↔ lms.ts 的直接積分；Uniform 用封閉式 ↔ 直接數值積分。
 * `claimed` 可以傳入「待驗證」的封閉式數值（反面測試：公式寫錯時必須回報 mismatch，而不是顯示成功）。
 */
export function analyticCrossCheck(
  mu: number,
  d: XDist,
  claimed?: { g?: number; h?: number; lambda?: number },
  tol = { rel: 1e-6, lambdaAbs: 2e-5 },
): AnalyticCrossCheck {
  const m = xMoments(d)
  const gClosed = claimed?.g ?? meanSquareFactor(mu, m.Px, m.M4)
  const hClosed = claimed?.h ?? fourthPowerFactor(mu, m)
  const gQuad = absPowerFactor(mu, d, 2)
  const hQuad = absPowerFactor(mu, d, 4)
  const lambda = claimed?.lambda ?? lyapunovExponent(mu, d)
  let lambdaAlt: number | null = null
  let lambdaAltMethod = '有限個取值：直接平均即精確式（無第二種算法）'
  if (d.kind === 'gaussian' && mu > 0) {
    lambdaAlt = gaussianLyapunov(mu, d.sigma)
    lambdaAltMethod = 'Dawson 形式 vs lms.ts 直接積分'
  } else if (d.kind === 'gaussian') {
    lambdaAltMethod = 'μ ≤ 0：單一數值積分（無第二種算法）'
  } else if (d.kind === 'uniform') {
    lambdaAlt = uniformLyapunovQuad(mu, d.halfWidth)
    lambdaAltMethod = '封閉式（F-03.12）vs 直接數值積分'
  }
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b))
  const gRelDev = rel(gClosed, gQuad)
  const hRelDev = rel(hClosed, hQuad)
  const lambdaDev =
    lambdaAlt === null ? 0 : Number.isFinite(lambda) && Number.isFinite(lambdaAlt) ? Math.abs(lambda - lambdaAlt) : lambda === lambdaAlt ? 0 : Infinity
  const ok = gRelDev <= tol.rel && hRelDev <= tol.rel && lambdaDev <= tol.lambdaAbs
  return { gClosed, gQuad, hClosed, hQuad, lambda, lambdaAlt, lambdaAltMethod, gRelDev, hRelDev, lambdaDev, ok }
}

/* ───────────────────────── 穩定界限 ───────────────────────── */

export interface StabilityBounds {
  /** P_x = 0：x 恆為 0，沒有激勵，任何 μ 都學不到 a */
  degenerate: boolean
  /** mean：0 < μ < 2/P_x */
  meanMax: number
  /** mean-square：0 < μ < 2P_x/M_4 */
  msMax: number
  /** almost-sure：λ(μ) 第一次 ≥ 0 的 μ（清單分布在更大 μ 處可能再次變負，見 asCrossings） */
  asMax: number
  /** asMax 是否為封閉式（固定 x、±A）；否則為數值求根 */
  asClosedForm: boolean
  /** λ(μ) 在搜尋範圍內所有變號點（研究用；Gaussian / Uniform 只有一個） */
  asCrossings: number[]
  /** 均方收斂最快的步長 μ* = P_x/M_4 與對應 g* = 1 − 1/κ */
  msOpt: number
  msOptFactor: number
}

/** 二分法：f(lo) < 0 ≤ f(hi) */
function bisect(f: (x: number) => number, lo: number, hi: number, iters = 80): number {
  let a = lo
  let b = hi
  for (let i = 0; i < iters; i++) {
    const mid = 0.5 * (a + b)
    if (f(mid) < 0) a = mid
    else b = mid
  }
  return 0.5 * (a + b)
}

/**
 * 三種界限。Gaussian 與 Uniform 的 almost-sure 界限由封閉／平滑公式二分求根（單一變號點）；
 * 清單分布則在 μP_x ∈ [1e−6, 1e3] 的 log 網格掃描所有變號點後二分細化。
 */
export function stabilityBounds(d: XDist): StabilityBounds {
  const m = xMoments(d)
  if (!(m.Px > 0)) {
    return { degenerate: true, meanMax: NaN, msMax: NaN, asMax: NaN, asClosedForm: false, asCrossings: [], msOpt: NaN, msOptFactor: NaN }
  }
  const meanMax = 2 / m.Px
  const msMax = (2 * m.Px) / m.M4
  const msOpt = m.Px / m.M4
  const msOptFactor = 1 - (m.Px * m.Px) / m.M4
  let asMax: number
  let asClosedForm = false
  let asCrossings: number[]
  if (d.kind === 'fixed' || d.kind === 'pm_one') {
    asMax = meanMax // |x| 為常數：ln|1 − μA²| < 0 ⇔ 0 < μ < 2/A²
    asClosedForm = true
    asCrossings = [asMax]
  } else if (d.kind === 'gaussian') {
    const c = bisect((c) => gaussianLyapunovDawson(c, 1), 1, 4, 60)
    asMax = c / (d.sigma * d.sigma)
    asCrossings = [asMax]
  } else if (d.kind === 'uniform') {
    const u = bisect((u) => uniformLyapunov(u * u, 1), 1, 4, 80) // u = c√μ
    asMax = (u * u) / (d.halfWidth * d.halfWidth)
    asCrossings = [asMax]
  } else {
    asCrossings = scanCrossings((mu) => lyapunovExponent(mu, d), 1e-6 / m.Px, 1e3 / m.Px, 4000)
    asMax = asCrossings.length ? asCrossings[0] : Infinity
  }
  return { degenerate: false, meanMax, msMax, asMax, asClosedForm, asCrossings, msOpt, msOptFactor }
}

/** 在 [lo, hi] 的 log 網格上找 f 的所有變號點（以二分細化）。 */
function scanCrossings(f: (x: number) => number, lo: number, hi: number, n: number): number[] {
  const out: number[] = []
  const r = Math.log(hi / lo)
  let xPrev = lo
  let fPrev = f(lo)
  for (let i = 1; i <= n; i++) {
    const x = lo * Math.exp((r * i) / n)
    const fx = f(x)
    if (fPrev < 0 && fx >= 0) out.push(bisect(f, xPrev, x, 70))
    else if (fPrev >= 0 && fx < 0) out.push(bisect((t) => -f(t), xPrev, x, 70))
    xPrev = x
    fPrev = fx
  }
  return out
}

/**
 * almost-sure 收斂最快的步長（λ 的最小值）。Gaussian / Uniform 用黃金分割在 (0, μ_as) 內搜尋；
 * 固定 x 或含可使 1 − μx² = 0 的清單時最小值是 −∞（一步歸零），回傳該 μ 與 −Infinity。
 */
export function fastestAlmostSure(d: XDist): { mu: number; lambda: number } {
  const b = stabilityBounds(d)
  if (b.degenerate) return { mu: NaN, lambda: NaN }
  if (d.kind === 'fixed' || d.kind === 'pm_one') {
    const a2 = d.kind === 'fixed' ? d.value * d.value : d.amplitude * d.amplitude
    return { mu: 1 / a2, lambda: -Infinity }
  }
  if (d.kind === 'list') {
    let best = { mu: NaN, lambda: Infinity }
    for (const v of d.values) {
      if (v === 0) continue
      const mu = 1 / (v * v)
      const lam = lyapunovExponent(mu, d)
      if (lam < best.lambda) best = { mu, lambda: lam }
    }
    return best
  }
  let a = 1e-6 * b.asMax
  let c = b.asMax
  const g = (Math.sqrt(5) - 1) / 2
  let x1 = c - g * (c - a)
  let x2 = a + g * (c - a)
  let f1 = lyapunovExponent(x1, d)
  let f2 = lyapunovExponent(x2, d)
  for (let i = 0; i < 100; i++) {
    if (f1 < f2) {
      c = x2
      x2 = x1
      f2 = f1
      x1 = c - g * (c - a)
      f1 = lyapunovExponent(x1, d)
    } else {
      a = x1
      x1 = x2
      f1 = f2
      x2 = a + g * (c - a)
      f2 = lyapunovExponent(x2, d)
    }
  }
  const mu = 0.5 * (a + c)
  return { mu, lambda: lyapunovExponent(mu, d) }
}

/** μ 軸上的三條每步因子曲線（第 3 章「三種界限」圖）：|1 − μP_x|、g(μ)、e^{λ(μ)}，門檻都是 1。 */
export function boundCurves(d: XDist, mus: ArrayLike<number>): { mu: Float64Array; meanAbs: Float64Array; g: Float64Array; geo: Float64Array } {
  const m = xMoments(d)
  const n = mus.length
  const mu = Float64Array.from(mus)
  const meanAbs = new Float64Array(n)
  const g = new Float64Array(n)
  const geo = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    meanAbs[i] = Math.abs(meanPole(mu[i], m.Px))
    g[i] = meanSquareFactor(mu[i], m.Px, m.M4)
    geo[i] = Math.exp(lyapunovExponent(mu[i], d))
  }
  return { mu, meanAbs, g, geo }
}

/* ───────────────────────── 解析軌跡（含量測雜訊） ───────────────────────── */

export interface AnalyticTrajectoryParams {
  mu: number
  dist: XDist
  delta0: number
  noiseSigma: number
}

export interface AnalyticTrajectory {
  /** log10|E[δ_n]| = log10|δ_0| + n·log10|1 − μP_x|（−∞ 表示恰為 0） */
  log10AbsMean: Float64Array
  /** log10 √E[δ_n²]（MSD 的平方根；+∞ 表示 overflow） */
  log10Rms: Float64Array
  /** 典型路徑 log10|δ_0| + n·λ/ln10（只在無雜訊時有意義；有雜訊為 NaN） */
  log10Typical: Float64Array
  /** 有雜訊時的穩態 MSD = μP_xσ_v²/(2P_x − μM_4)；g ≥ 1 時為 +∞；無雜訊為 0 */
  msdInf: number
  /** 對應的穩態 MSE = P_x·MSD + σ_v²（勘誤 E42） */
  mseInf: number
}

/**
 * 解析曲線（全部在 log 域計算，避免 g^n overflow）：
 *   E[δ_n] = (1 − μP_x)^n δ_0
 *   E[δ_n²] = g^n δ_0² + μ²P_xσ_v²·(1 − g^n)/(1 − g)（g = 1 時第二項為 n·μ²P_xσ_v²）
 */
export function analyticTrajectory(p: AnalyticTrajectoryParams, ns: ArrayLike<number>): AnalyticTrajectory {
  const m = xMoments(p.dist)
  const r = meanPole(p.mu, m.Px)
  const g = meanSquareFactor(p.mu, m.Px, m.M4)
  const lam = p.noiseSigma > 0 ? NaN : lyapunovExponent(p.mu, p.dist)
  const c = p.mu * p.mu * m.Px * p.noiseSigma * p.noiseSigma // 每步注入的 MSD
  const d2 = p.delta0 * p.delta0
  const l0 = Math.log10(Math.abs(p.delta0))
  const lr = Math.log10(Math.abs(r))
  const lg = Math.log10(g)
  const k = ns.length
  const log10AbsMean = new Float64Array(k)
  const log10Rms = new Float64Array(k)
  const log10Typical = new Float64Array(k)
  for (let i = 0; i < k; i++) {
    const n = ns[i]
    log10AbsMean[i] = n === 0 ? l0 : l0 + n * lr
    log10Typical[i] = n === 0 ? l0 : l0 + (n * lam) / Math.LN10
    if (n === 0) {
      log10Rms[i] = l0
    } else if (c === 0) {
      log10Rms[i] = l0 + 0.5 * n * lg // 無雜訊：√(g^n δ0²)，全程在 log 域
    } else if (g === 1) {
      log10Rms[i] = 0.5 * Math.log10(d2 + n * c)
    } else if (g > 1 && n * lg > 250) {
      // g^n(δ0² + c/(g−1)) − c/(g−1) ≈ g^n(δ0² + c/(g−1))（相對誤差 < 1e−250）
      log10Rms[i] = 0.5 * (n * lg + Math.log10(d2 + c / (g - 1)))
    } else {
      const gn = Math.pow(g, n)
      log10Rms[i] = 0.5 * Math.log10(gn * d2 + (c * (1 - gn)) / (1 - g))
    }
  }
  const msdInf = c === 0 ? 0 : g < 1 ? c / (1 - g) : Infinity
  return {
    log10AbsMean,
    log10Rms,
    log10Typical,
    msdInf,
    mseInf: m.Px * msdInf + p.noiseSigma * p.noiseSigma,
  }
}

/* ───────────────────────── Monte Carlo ───────────────────────── */

export interface StabilityMcParams {
  mu: number
  dist: XDist
  /** δ_0 = a − w_0 */
  delta0: number
  /** 迭代步數 N */
  steps: number
  /** 獨立樣本路徑數 */
  paths: number
  seed: number
  /** 量測雜訊 σ_v（0 = 無雜訊；> 0 時以線性域模擬） */
  noiseSigma: number
  /** 回傳幾條個別路徑（預設 5） */
  keepPaths?: number
  /** 單步 Monte Carlo 的樣本數（預設 200000；勘誤 E14 建議的 T03 驗證方式） */
  oneStepSamples?: number
  /** 最多記錄幾個時間點（預設 401；路徑很多時自動減少，使記錄矩陣 ≤ 4e6 格） */
  maxRecords?: number
}

export interface OneStepResult {
  samples: number
  /** Ê[f]、Ê[f²]、Ê[ln|f|]（f = 1 − μx²）與各自的標準誤 */
  meanFactor: number
  meanFactorSe: number
  g: number
  gSe: number
  lambda: number
  lambdaSe: number
  /** 樣本 P̂_x、M̂_4 */
  Px: number
  M4: number
}

export interface StabilityMcResult {
  /** 有記錄的時間索引 n */
  n: Float64Array
  /** log10|δ_n| 跨路徑的 10% / 50% / 90% 分位數 */
  q10: Float64Array
  q50: Float64Array
  q90: Float64Array
  /** 天真估計：½·log10( (1/P)Σ δ_n² )（heavy tail 下嚴重低估，勘誤 E14；僅供對照） */
  naiveLog10Rms: Float64Array
  /** P(|δ_n| < 10⁻³·|δ_0|)（δ_0 = 0 時門檻改為 10⁻³） */
  fracConverged: Float64Array
  /** 前 keepPaths 條路徑的 log10|δ_n|（row-major：sample[k·R + r]） */
  sample: Float64Array
  keepPaths: number
  /** 最後一步 n = N 所有路徑的 log10|δ_N|（已排序） */
  finalLog10: Float64Array
  /** 樣本路徑估計的 Lyapunov 指數 λ̂ = mean_i[ln|δ_N/δ_0|]/N 與標準誤（只在無雜訊時） */
  lyapunovHat: number
  lyapunovSe: number
  oneStep: OneStepResult
  /** 線性域模擬中 overflow 成 ±∞ 的路徑數 */
  overflowPaths: number
  /** 'log'：無雜訊，在 log 域累加；'linear'：有雜訊 */
  mode: 'log' | 'linear'
}

/** 路徑數、步數與記錄矩陣的上限（瀏覽器計算量；約 1–3 秒） */
export const MC_LIMITS = { maxPaths: 50000, maxSteps: 20000, maxWork: 2e7, maxRecordCells: 4e6 } as const

function assertMcParams(p: StabilityMcParams): void {
  const err = validateDist(p.dist)
  if (err) throw new Error(`x 分布參數錯誤：${err}`)
  if (!Number.isFinite(p.mu)) throw new Error('μ 必須是有限數值')
  if (!Number.isInteger(p.steps) || p.steps < 1 || p.steps > MC_LIMITS.maxSteps) throw new Error(`步數 N 必須是 1–${MC_LIMITS.maxSteps} 的整數`)
  if (!Number.isInteger(p.paths) || p.paths < 1 || p.paths > MC_LIMITS.maxPaths) throw new Error(`路徑數必須是 1–${MC_LIMITS.maxPaths} 的整數`)
  if (p.steps * p.paths > MC_LIMITS.maxWork) throw new Error(`步數 × 路徑數 = ${p.steps * p.paths} 超過 ${MC_LIMITS.maxWork}（瀏覽器計算量上限）`)
  if (!(p.noiseSigma >= 0)) throw new Error('σ_v 必須 ≥ 0')
  if (!Number.isFinite(p.delta0)) throw new Error('δ_0 必須是有限數值')
}

/** 等距挑選最多 maxRecords 個時間點（含 0 與 N）。 */
export function recordIndices(steps: number, maxRecords = 401): Float64Array {
  if (steps + 1 <= maxRecords) return Float64Array.from({ length: steps + 1 }, (_, i) => i)
  const out = new Set<number>()
  for (let k = 0; k < maxRecords; k++) out.add(Math.round((k * steps) / (maxRecords - 1)))
  return Float64Array.from([...out].sort((a, b) => a - b))
}

// #region core:pathStep
/**
 * 一條樣本路徑前進一步（n → n+1）。
 *   無雜訊（log 域）：s = ln|δ_n|，ln|δ_{n+1}| = ln|δ_n| + ln|1 − μx_n²|（乘積 → 對數總和；不會 overflow / underflow）
 *   有雜訊（線性域）：s = δ_n，δ_{n+1} = (1 − μx_n²)·δ_n − μ·x_n·v_n（δ = a − w，勘誤 E39）
 */
export function pathStep(s: number, mu: number, dist: XDist, xr: Rng, vr: Rng | null, noiseSigma: number): number {
  const x = drawX(dist, xr) // x_n：與過去的 δ_n 獨立（iid，勘誤 E38）
  const f = 1 - mu * x * x // 這一步的乘法因子
  if (vr === null) return s + Math.log(Math.abs(f)) // 無雜訊：在 log 域累加
  if (!Number.isFinite(s)) return s // 已 overflow 的路徑停在 ∞
  const v = noiseSigma * vr.normal() // 量測雜訊 v_n ~ N(0, σ_v²)
  const next = f * s - mu * x * v // δ_{n+1} = (1 − μx²)δ_n − μ x v
  return Number.isFinite(next) ? next : Infinity
}
// #endregion

// #region core:runPaths
/**
 * 跑 P 條獨立路徑。每條路徑 i 用自己的亂數串流 fork('x:i')（與 fork('v:i')），
 * 所以改變路徑數或開關雜訊都不會改變其他路徑的 x 序列（paired comparison）。
 * 回傳 log10|δ_n| 的記錄矩陣 rec[r·P + i]（r = 記錄點、i = 路徑）與最後狀態。
 */
export function runPaths(p: StabilityMcParams, rec: Float64Array): { log10: Float32Array; last: Float64Array } {
  const P = p.paths
  const R = rec.length
  const noisy = p.noiseSigma > 0
  const root = createRng(p.seed)
  const log10 = new Float32Array(P * R)
  const last = new Float64Array(P)
  const s0 = noisy ? p.delta0 : Math.log(Math.abs(p.delta0))
  for (let i = 0; i < P; i++) {
    const xr = root.fork(`x:${i}`)
    const vr = noisy ? root.fork(`v:${i}`) : null
    let s = s0
    let r = 0
    for (let n = 0; n <= p.steps; n++) {
      if (r < R && n === rec[r]) {
        log10[r * P + i] = noisy ? Math.log10(Math.abs(s)) : s / Math.LN10 // 記錄 log10|δ_n|
        r++
      }
      if (n === p.steps) break
      s = pathStep(s, p.mu, p.dist, xr, vr, p.noiseSigma)
    }
    last[i] = s
  }
  return { log10, last }
}
// #endregion

/**
 * 主要 Monte Carlo（Worker 可呼叫）：P 條獨立路徑跑 N 步，記錄 log10|δ_n| 的分位數、天真均方估計、
 * 收斂比例、幾條個別路徑、最後一步的分布與樣本 Lyapunov 指數；另附單步 Monte Carlo。
 */
export function runStabilityMc(p: StabilityMcParams): StabilityMcResult {
  assertMcParams(p)
  const P = p.paths
  const N = p.steps
  const noisy = p.noiseSigma > 0
  const keep = Math.min(P, Math.max(0, p.keepPaths ?? 5))
  const maxRec = Math.max(21, Math.min(p.maxRecords ?? 401, Math.floor(MC_LIMITS.maxRecordCells / P)))
  const rec = recordIndices(N, maxRec)
  const R = rec.length
  const { log10, last } = runPaths(p, rec)
  const q10 = new Float64Array(R)
  const q50 = new Float64Array(R)
  const q90 = new Float64Array(R)
  const naive = new Float64Array(R)
  const frac = new Float64Array(R)
  const sample = new Float64Array(keep * R)
  const col = new Float64Array(P)
  const thrLog10 = p.delta0 !== 0 ? Math.log10(Math.abs(p.delta0)) - 3 : -3
  for (let r = 0; r < R; r++) {
    let conv = 0
    for (let i = 0; i < P; i++) {
      const v = log10[r * P + i]
      col[i] = Number.isNaN(v) ? Infinity : v
      if (col[i] < thrLog10) conv++
    }
    for (let k = 0; k < keep; k++) sample[k * R + r] = col[k]
    naive[r] = naiveLog10Rms(col)
    col.sort()
    q10[r] = sortedQuantile(col, 0.1)
    q50[r] = sortedQuantile(col, 0.5)
    q90[r] = sortedQuantile(col, 0.9)
    frac[r] = conv / P
  }
  // 最後一步（n = N）的完整分布：col 在迴圈結束時已是最後一個記錄點（rec 一定包含 N）並已排序
  const finalLog10 = Float64Array.from(col)
  let lyapunovHat = NaN
  let lyapunovSe = NaN
  if (!noisy && p.delta0 !== 0) {
    const lnDelta0 = Math.log(Math.abs(p.delta0))
    let s = 0
    let s2 = 0
    let finite = true
    for (let i = 0; i < P; i++) {
      const v = (last[i] - lnDelta0) / N // 這條路徑的平均對數斜率
      if (!Number.isFinite(v)) finite = false
      s += v
      s2 += v * v
    }
    if (finite) {
      lyapunovHat = s / P
      lyapunovSe = P > 1 ? Math.sqrt(Math.max(0, (s2 - P * lyapunovHat * lyapunovHat) / (P - 1)) / P) : NaN
    } else {
      lyapunovHat = -Infinity // 某條路徑在有限步內恰好歸零（離散分布 1 − μx² = 0）
    }
  }
  let overflowPaths = 0
  if (noisy) for (let i = 0; i < P; i++) if (!Number.isFinite(last[i])) overflowPaths++
  const oneStep = oneStepMc({ mu: p.mu, dist: p.dist, samples: p.oneStepSamples ?? 200000, seed: p.seed })
  return {
    n: rec,
    q10,
    q50,
    q90,
    naiveLog10Rms: naive,
    fracConverged: frac,
    sample,
    keepPaths: keep,
    finalLog10,
    lyapunovHat,
    lyapunovSe,
    oneStep,
    overflowPaths,
    mode: noisy ? 'linear' : 'log',
  }
}

/** ½·log10(mean δ²)，輸入為 log10|δ|；以 log-sum-exp 計算避免 overflow。 */
function naiveLog10Rms(log10Abs: Float64Array): number {
  let mx = -Infinity
  for (let i = 0; i < log10Abs.length; i++) if (log10Abs[i] > mx) mx = log10Abs[i]
  if (!Number.isFinite(mx)) return mx
  let s = 0
  for (let i = 0; i < log10Abs.length; i++) s += Math.pow(10, 2 * (log10Abs[i] - mx))
  return mx + 0.5 * Math.log10(s / log10Abs.length)
}

/** 已排序陣列的線性內插分位數（NumPy 'linear'；可含 ±∞）。 */
function sortedQuantile(s: Float64Array, q: number): number {
  const h = (s.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, s.length - 1)
  if (s[lo] === s[hi] || h === lo) return s[lo]
  if (!Number.isFinite(s[lo]) || !Number.isFinite(s[hi])) return h - lo < 0.5 ? s[lo] : s[hi] // 避免 ∞ − ∞
  return s[lo] + (h - lo) * (s[hi] - s[lo])
}

/** 多組參數（Case A/B/C）一次送進 Worker。 */
export function runStabilityMcCases(p: { cases: StabilityMcParams[] }): { results: StabilityMcResult[] } {
  return { results: p.cases.map((c) => runStabilityMc(c)) }
}

/**
 * 單步 Monte Carlo（勘誤 E14 建議的 T03 驗證法）：直接抽 x 估計 E[f]、E[f²]、E[ln|f|]，f = 1 − μx²。
 * 每個估計量的變異數有限（Gaussian x 的所有動差都有限），因此 ±SE 是可信的。
 */
export function oneStepMc(p: { mu: number; dist: XDist; samples: number; seed: number }): OneStepResult {
  const err = validateDist(p.dist)
  if (err) throw new Error(`x 分布參數錯誤：${err}`)
  const M = Math.max(2, Math.floor(p.samples))
  // #region core:oneStepMc
  const rng = createRng(p.seed).fork('one-step')
  const f = new Float64Array(M) // 只看「一步」：M 個獨立的 f = 1 − μx²
  let sx2 = 0
  let sx4 = 0
  for (let i = 0; i < M; i++) {
    const x = drawX(p.dist, rng)
    const x2 = x * x
    sx2 += x2
    sx4 += x2 * x2
    f[i] = 1 - p.mu * x2
  }
  const meanFactor = meanCriterion(f) // Ê[f]      → mean 判據
  const g = meanSquareCriterion(f) // Ê[f²]     → mean-square 判據（T03：g(2/3) = 1）
  const lambda = almostSureCriterion(f) // Ê[ln|f|] → almost-sure 判據
  // #endregion
  let v1 = 0
  let v2 = 0
  let vl = 0
  for (let i = 0; i < M; i++) {
    const a = f[i] - meanFactor
    const b = f[i] * f[i] - g
    const c = Math.log(Math.abs(f[i])) - lambda
    v1 += a * a
    v2 += b * b
    vl += c * c
  }
  const se = (v: number) => Math.sqrt(v / (M - 1) / M)
  return {
    samples: M,
    meanFactor,
    meanFactorSe: se(v1),
    g,
    gSe: se(v2),
    lambda,
    lambdaSe: Number.isFinite(lambda) ? se(vl) : NaN,
    Px: sx2 / M,
    M4: sx4 / M,
  }
}

/* ───────────────────────── Heavy tail：天真 CI 的覆蓋率（勘誤 E14） ───────────────────────── */

export interface NaiveCiParams {
  mu: number
  dist: XDist
  delta0: number
  /** 看第 n 步的 E[δ_n²] */
  n: number
  /** 每批路徑數 M */
  pathsPerBatch: number
  /** 批數 B（每批各自算一個 95% CI） */
  batches: number
  seed: number
  /** 信賴水準（預設 0.95） */
  level?: number
}

export interface NaiveCiResult {
  /** 精確 E[δ_n²] = g^n δ_0² */
  exact: number
  /** 天真估計量（樣本平均）的真實標準誤 √((h^n − g^{2n})δ_0⁴/M) */
  trueSe: number
  /** 每批的樣本平均、樣本標準誤、是否覆蓋真值（1/0） */
  batchMean: Float64Array
  batchSe: Float64Array
  covered: Uint8Array
  coverage: number
  /** z = Φ⁻¹((1+level)/2) */
  z: number
  /** 真實 SE / 樣本 SE 的中位數（> 1 表示樣本 SE 低估） */
  medianSeRatio: number
  /** 所有批合併的樣本平均與樣本 SE */
  pooledMean: number
  pooledSe: number
  /** 單步 MC：ĝ 與 ĝ^n δ_0²（delta method SE） */
  oneStepG: number
  oneStepGSe: number
  oneStepEstimate: number
  oneStepEstimateSe: number
}

/** 重複 B 批「直接平均 δ_n²」的實驗，統計 95% CI 實際覆蓋真值的比例（Worker 可呼叫）。 */
export function naiveCiCoverage(p: NaiveCiParams): NaiveCiResult {
  const err = validateDist(p.dist)
  if (err) throw new Error(`x 分布參數錯誤：${err}`)
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > 200) throw new Error('n 必須是 1–200 的整數')
  if (!Number.isInteger(p.pathsPerBatch) || p.pathsPerBatch < 2) throw new Error('每批路徑數至少 2')
  if (!Number.isInteger(p.batches) || p.batches < 1) throw new Error('批數至少 1')
  if (p.n * p.pathsPerBatch * p.batches > 4e7) throw new Error('n × 路徑數 × 批數超過 4e7（瀏覽器計算量上限）')
  const m = xMoments(p.dist)
  const g = meanSquareFactor(p.mu, m.Px, m.M4)
  const h = fourthPowerFactor(p.mu, m)
  const d2 = p.delta0 * p.delta0
  const M = p.pathsPerBatch
  const exact = Math.pow(g, p.n) * d2
  const trueSe = Math.sqrt(Math.max(0, Math.pow(h, p.n) - Math.pow(g, 2 * p.n)) * d2 * d2 / M)
  const level = p.level ?? 0.95
  const z = normInv(0.5 + level / 2)
  const root = createRng(p.seed)
  const batchMean = new Float64Array(p.batches)
  const batchSe = new Float64Array(p.batches)
  const covered = new Uint8Array(p.batches)
  let total = 0
  let total2 = 0
  for (let b = 0; b < p.batches; b++) {
    const rng = root.fork(`batch:${b}`)
    let s = 0
    let s2 = 0
    for (let i = 0; i < M; i++) {
      let d = p.delta0
      for (let k = 0; k < p.n; k++) {
        const x = drawX(p.dist, rng)
        d *= 1 - p.mu * x * x // 無雜訊：δ_{k+1} = (1 − μx_k²)δ_k
      }
      const y = d * d
      s += y
      s2 += y * y
    }
    const mean = s / M
    const se = Math.sqrt(Math.max(0, (s2 - M * mean * mean) / (M - 1)) / M)
    batchMean[b] = mean
    batchSe[b] = se
    covered[b] = Math.abs(mean - exact) <= z * se + 1e-9 * Math.abs(exact) ? 1 : 0 // 1e−9：SE = 0 時容忍浮點誤差
    total += s
    total2 += s2
  }
  const K = M * p.batches
  const pooledMean = total / K
  const pooledSe = Math.sqrt(Math.max(0, (total2 - K * pooledMean * pooledMean) / (K - 1)) / K)
  let cov = 0
  for (let b = 0; b < p.batches; b++) cov += covered[b]
  const ratios = Array.from(batchSe, (s) => (s > 0 ? trueSe / s : NaN))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
  const medianSeRatio = ratios.length ? ratios[Math.floor((ratios.length - 1) / 2)] : NaN
  const one = oneStepMc({ mu: p.mu, dist: p.dist, samples: Math.min(2_000_000, K), seed: p.seed })
  const est = Math.pow(one.g, p.n) * d2
  const estSe = p.n * Math.pow(Math.abs(one.g), p.n - 1) * one.gSe * d2
  return {
    exact,
    trueSe,
    batchMean,
    batchSe,
    covered,
    coverage: cov / p.batches,
    z,
    medianSeRatio,
    pooledMean,
    pooledSe,
    oneStepG: one.g,
    oneStepGSe: one.gSe,
    oneStepEstimate: est,
    oneStepEstimateSe: estSe,
  }
}

/* ───────────────────────── 連到 PLL：GMAC 的 N 次累加 ───────────────────────── */

/**
 * Block LMS（conventional、block 平均梯度）：δ_{k+1} = (1 − μS_k)δ_k，S_k = (1/N)Σ x_i²。
 * E[S] = P_x、E[S²] = P_x² + (M_4 − P_x²)/N（iid x），因此
 *   mean-square 界 = 2P_x / (P_x² + (M_4 − P_x²)/N)，N → ∞ 時趨近 mean 界 2/P_x。
 */
export function blockMeanSquareBound(m: XMoments, N: number): number {
  return (2 * m.Px) / (m.Px * m.Px + (m.M4 - m.Px * m.Px) / N)
}

/* ───────────────────────── 「帶入手算」用的封閉式小工具（純函式；第 3 章 handcalcs.ts 與頁面共用） ───────────────────────── */

// #region core:timeConstant
/**
 * 等比數列 |δ_n| = |p|ⁿ·|δ_0| 的兩個工程量（F-03.4）：
 *   時間常數 τ = −1/ln|p|（samples；|p|ⁿ = e^{−n/τ}）
 *   降到 ε·|δ_0| 所需步數 n_ε = ⌈ln ε / ln|p|⌉（至少 1 步）
 * p = 0（deadbeat）：τ = 0、1 步到位；|p| ≥ 1：不收斂，兩者都回傳 NaN。
 */
export function timeConstant(p: number): number {
  const a = Math.abs(p)
  if (a === 0) return 0
  if (!(a < 1)) return NaN
  return -1 / Math.log(a) // ln|p| < 0，所以 τ > 0
}
export function stepsToReach(p: number, eps = 1e-3): number {
  const a = Math.abs(p)
  if (a === 0) return 1
  if (!(a < 1)) return NaN
  const r = Math.log(eps) / Math.log(a) // 解 |p|ⁿ ≤ ε：n ≥ r
  // r 在數學上恰為整數時（例：|p| = 0.4、ε = 0.064 = 0.4³），double 的除法可能給 3.0000000000000004；
  // 手算是 ⌈3⌉ = 3，所以相對 1e−9 以內視為整數，不多算一步
  const k = Math.round(r)
  const n = Math.abs(r - k) <= 1e-9 * Math.max(1, k) ? k : Math.ceil(r) // 步數是整數：無條件進位
  return Math.max(1, n)
}
// #endregion

// #region core:msdClosedForm
/**
 * MSD 的封閉式（F-03.6 / F-03.11；與 analyticTrajectory 同式，但直接吃動差 P_x、M_4）：
 *   E[δ_n²] = gⁿ·δ_0² + c·(1 − gⁿ)/(1 − g)，g = 1 − 2μP_x + μ²M_4，c = μ²·P_x·σ_v²（每步注入的雜訊）
 *   MSD∞ = c/(1 − g) = μ·P_x·σ_v² / (2P_x − μ·M_4)（g < 1 才有限），MSE∞ = P_x·MSD∞ + σ_v²（勘誤 E42）
 */
export function msdAfterSteps(mu: number, Px: number, M4: number, n: number, delta0: number, noiseSigma = 0): number {
  const g = meanSquareFactor(mu, Px, M4)
  const c = mu * mu * Px * noiseSigma * noiseSigma
  const gn = Math.pow(g, n)
  return gn * delta0 * delta0 + (g === 1 ? n * c : (c * (1 - gn)) / (1 - g)) // 等比數列 + 等比級數
}
export function steadyStateMsd(mu: number, Px: number, M4: number, noiseSigma: number): { msd: number; mse: number } {
  const g = meanSquareFactor(mu, Px, M4)
  const c = mu * mu * Px * noiseSigma * noiseSigma
  const msd = c === 0 ? 0 : g < 1 ? c / (1 - g) : Infinity // g ≥ 1：沒有有限的穩態 MSD
  return { msd, mse: Px * msd + noiseSigma * noiseSigma }
}
// #endregion

// #region core:cltStepsBelowStart
/**
 * CLT 預測的推論（F-03.18，近似）：p 分位數 nλ + z_p·s·√n 開始低於起點（< 0）所需的步數
 *   n > (z_p·s/λ)²，z_p = Φ⁻¹(p)。只在 λ < 0（almost-sure 收斂）時有意義，否則回傳 NaN；s = 0 時為 0。
 */
export function cltStepsBelowStart(lambda: number, s: number, p = 0.9): number {
  if (!(lambda < 0) || !(s >= 0) || !Number.isFinite(lambda)) return NaN
  return ((normInv(p) * s) / lambda) ** 2
}
// #endregion
