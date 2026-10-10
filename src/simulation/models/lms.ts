/**
 * 純量 LMS 家族（規格 §1–§3；模型層級 L0）。Ch00–Ch03 共用；頁面以 `?raw` + `#region core:*` 直接顯示這些程式碼。
 *
 * 模型：y = a·x + v，預測 ŷ = w·x，誤差 e = y − ŷ。
 * 參數誤差極性一律採全站約定 δ = a − w（勘誤 E32 / E39：規格 §3 原寫 w − a）。
 *
 * 四種更新（同一個介面，方便並排比較）：
 *   conventional  ：w ← w + μ·e·x                （MSE 的隨機梯度；½e² 的導數為 −e·x）
 *   sign_error    ：w ← w + μ·sign(e)·x          （MAE 的隨機次梯度；只需 1-bit 誤差）
 *   sign_sign     ：w ← w + μ·sign(e)·sign(x)    （連 regressor 幅度也丟掉）
 *   huber         ：w ← w + μ·ψ_δ(e)·x           （|e|≤δ 時同 LMS，否則同 Sign-Error×δ）
 *
 * sign(0) 的慣例必須明定（勘誤 E40）：'zero'（數學次梯度 sign(0)=0）、'plus'（硬體 comparator，tie→+1）、
 * 'minus'（tie→−1）。不可依賴 Math.sign(0) = 0 的隱含行為。
 */

import { createRng } from '@/simulation/core'

export type LmsVariant = 'conventional' | 'sign_error' | 'sign_sign' | 'huber'
export type TieRule = 'zero' | 'plus' | 'minus'

export const VARIANT_LABEL: Record<LmsVariant, string> = {
  conventional: 'Conventional LMS（MSE）',
  sign_error: 'Sign-Error LMS（MAE）',
  sign_sign: 'Sign-Sign LMS',
  huber: 'Huber LMS',
}

// #region core:sign
/** 明確定義 tie 慣例的 sign 函數（勘誤 E40）。 */
export function sgn(v: number, tie: TieRule = 'zero'): number {
  if (v > 0) return 1
  if (v < 0) return -1
  return tie === 'plus' ? 1 : tie === 'minus' ? -1 : 0
}
// #endregion

// #region core:huberPsi
/** Huber 損失的導數 ψ_δ(e)：小誤差時等於 e（像 LMS），大誤差時被截成 ±δ（像 Sign-Error）。 */
export function huberPsi(e: number, delta: number): number {
  return Math.abs(e) <= delta ? e : delta * Math.sign(e)
}
// #endregion

export interface StepInput {
  w: number
  x: number
  y: number
  mu: number
  tie?: TieRule
  /** Huber 的 δ（只在 huber 使用） */
  huberDelta?: number
}

export interface StepOutput {
  /** 這一步的誤差 e = y − w·x */
  e: number
  /** 更新量 Δw */
  dw: number
  /** 更新後的 w */
  w: number
}

// #region core:conventionalStep
/** Conventional LMS：w ← w + μ·e·x。更新量和誤差大小成正比。 */
export function conventionalStep({ w, x, y, mu }: StepInput): StepOutput {
  const e = y - w * x // 預測誤差
  const dw = mu * e * x // ← 差異：用到 e 的大小（需要多位元 error）
  return { e, dw, w: w + dw }
}
// #endregion

// #region core:signErrorStep
/** Sign-Error LMS：w ← w + μ·sign(e)·x。只需要誤差的正負號（1-bit comparator）。 */
export function signErrorStep({ w, x, y, mu, tie = 'zero' }: StepInput): StepOutput {
  const e = y - w * x // 預測誤差
  const dw = mu * sgn(e, tie) * x // ← 差異：只用 sign(e)，丟掉誤差大小
  return { e, dw, w: w + dw }
}
// #endregion

// #region core:signSignStep
/** Sign-Sign LMS：w ← w + μ·sign(e)·sign(x)。連 regressor 的幅度也丟掉。 */
export function signSignStep({ w, x, y, mu, tie = 'zero' }: StepInput): StepOutput {
  const e = y - w * x // 預測誤差
  const dw = mu * sgn(e, tie) * sgn(x, tie) // ← 差異：x 也只剩正負號
  return { e, dw, w: w + dw }
}
// #endregion

// #region core:huberStep
/** Huber LMS：小誤差用 e（平滑），大誤差截成 ±δ（抗 outlier）。 */
export function huberStep({ w, x, y, mu, huberDelta = 1 }: StepInput): StepOutput {
  const e = y - w * x // 預測誤差
  const dw = mu * huberPsi(e, huberDelta) * x // ← 差異：e 被 Huber ψ 截斷
  return { e, dw, w: w + dw }
}
// #endregion

export const STEP: Record<LmsVariant, (s: StepInput) => StepOutput> = {
  conventional: conventionalStep,
  sign_error: signErrorStep,
  sign_sign: signSignStep,
  huber: huberStep,
}

/** 輸入 x 的產生方式 */
export type XSource =
  | { kind: 'fixed'; value: number }
  | { kind: 'gaussian'; sigma: number }
  | { kind: 'uniform'; lo: number; hi: number }
  | { kind: 'pm_one'; amplitude: number }
  | { kind: 'sequence'; values: number[] }

export interface ScalarLmsParams {
  variant: LmsVariant
  /** 真實參數 a */
  a: number
  w0: number
  mu: number
  /** 迭代次數 */
  steps: number
  x: XSource
  /** 量測雜訊 v 的標準差（y = a·x + v） */
  noiseSigma?: number
  /** 外加 outlier：每筆以機率 outlierProb 加上 outlierSize（模擬突發干擾） */
  outlierProb?: number
  outlierSize?: number
  tie?: TieRule
  huberDelta?: number
  seed?: number
}

export interface ScalarLmsResult {
  /** w_0 … w_steps（長度 steps+1） */
  w: Float64Array
  /** e_0 … e_{steps−1} */
  e: Float64Array
  /** x_0 … x_{steps−1} */
  x: Float64Array
  /** δ_n = a − w_n（全站極性約定） */
  delta: Float64Array
  /** 是否在模擬中出現非有限值或 |w| > 1e12（判定發散並提前停止） */
  diverged: boolean
}

// #region core:runScalarLms
/** 逐筆執行純量 LMS；所有變體共用同一個迴圈，只換 STEP[variant]。 */
export function runScalarLms(p: ScalarLmsParams): ScalarLmsResult {
  const rng = createRng(p.seed ?? 20261010)
  const xr = rng.fork('x')
  const vr = rng.fork('noise')
  const or = rng.fork('outlier')
  const step = STEP[p.variant]
  const w = new Float64Array(p.steps + 1)
  const e = new Float64Array(p.steps)
  const xs = new Float64Array(p.steps)
  w[0] = p.w0
  let diverged = false
  for (let n = 0; n < p.steps; n++) {
    const x = drawX(p.x, n, xr) // 第 n 筆輸入
    let y = p.a * x + (p.noiseSigma ? p.noiseSigma * vr.normal() : 0) // 量測：y = a·x + v
    if (p.outlierProb && or.uniform() < p.outlierProb) y += p.outlierSize ?? 0 // 突發干擾
    const out = step({ w: w[n], x, y, mu: p.mu, tie: p.tie, huberDelta: p.huberDelta })
    xs[n] = x
    e[n] = out.e
    w[n + 1] = out.w
    if (!Number.isFinite(out.w) || Math.abs(out.w) > 1e12) {
      diverged = true
      w.fill(Number.NaN, n + 2)
      break
    }
  }
  const delta = w.map((v) => p.a - v)
  return { w, e, x: xs, delta, diverged }
}
// #endregion

function drawX(src: XSource, n: number, rng: ReturnType<typeof createRng>): number {
  switch (src.kind) {
    case 'fixed':
      return src.value
    case 'gaussian':
      return src.sigma * rng.normal()
    case 'uniform':
      return src.lo + (src.hi - src.lo) * rng.uniform()
    case 'pm_one':
      return src.amplitude * rng.sign()
    case 'sequence':
      return src.values.length ? src.values[n % src.values.length] : 0
  }
}

// ───────────────────────── 解析結果（§3） ─────────────────────────

// #region core:fixedXPole
/**
 * 固定非零 x、無雜訊的 Conventional LMS：δ_{n+1} = (1 − μx²)·δ_n，所以 δ_n = pⁿ·δ_0。
 * 收斂 ⇔ |p| < 1 ⇔ 0 < μ < 2/x²（規格 §3，T02）。
 */
export function fixedXPole(mu: number, x: number): number {
  return 1 - mu * x * x
}
// #endregion

export type PoleBehaviour = 'monotone' | 'oscillating' | 'deadbeat' | 'boundary' | 'divergent' | 'frozen'

/** 依 pole 分類收斂行為（規格 §3 的四種情況 + p=0 一步到位 + p=1 不動）。 */
export function classifyPole(p: number, eps = 1e-12): PoleBehaviour {
  if (Math.abs(p) < eps) return 'deadbeat'
  if (Math.abs(p - 1) < eps) return 'frozen'
  if (Math.abs(Math.abs(p) - 1) < eps) return 'boundary'
  if (Math.abs(p) > 1) return 'divergent'
  return p > 0 ? 'monotone' : 'oscillating'
}

export const POLE_BEHAVIOUR_LABEL: Record<PoleBehaviour, string> = {
  monotone: '0 < p < 1：不變號、單調收斂',
  oscillating: '−1 < p < 0：正負交替、震盪收斂',
  deadbeat: 'p = 0：理想模型一步到答案',
  boundary: '|p| = 1：邊界，不保證收斂到 0',
  divergent: '|p| > 1：發散',
  frozen: 'p = 1：μ = 0，參數不動',
}

/** 固定 x 的穩定上限 μ_max = 2/x²（x = 0 時沒有資訊，回傳 Infinity 並應在 UI 標示「不可辨識」）。 */
export function fixedXMuMax(x: number): number {
  return x === 0 ? Infinity : 2 / (x * x)
}

// #region core:meanSquareFactors
/**
 * 隨機 iid 輸入（無外加雜訊）的三種穩定性（規格 §3.1 + 勘誤 E14）：
 *   mean         ：E[δ_{n+1}]  = (1 − μP_x)·E[δ_n]                 ⇒ 0 < μ < 2/P_x
 *   mean-square  ：E[δ_{n+1}²] = g(μ)·E[δ_n²]，g = 1 − 2μP_x + μ²M_4 ⇒ 0 < μ < 2P_x/M_4
 *   almost-sure  ：λ(μ) = E[log|1 − μx²|] < 0（樣本路徑幾乎必然收斂）
 * 其中 P_x = E[x²]、M_4 = E[x⁴]。iid 純量 x 下這兩條遞迴是精確的（勘誤 E38）。
 */
export function meanPole(mu: number, Px: number): number {
  return 1 - mu * Px
}
export function meanSquareFactor(mu: number, Px: number, M4: number): number {
  return 1 - 2 * mu * Px + mu * mu * M4
}
export function meanSquareMuMax(Px: number, M4: number): number {
  return (2 * Px) / M4
}
// #endregion

/**
 * Gaussian x ~ N(0, σ²) 的 almost-sure 指數 λ(μ) = E[log|1 − μx²|]（數值積分）。
 * 以 t = x/σ 標準化後對標準常態 PDF 積分；在 1 − μσ²t² = 0 的對數奇點兩側分段處理（可積奇點）。
 */
export function gaussianLyapunov(mu: number, sigma = 1): number {
  const c = mu * sigma * sigma
  if (c <= 0) return 0
  const t0 = 1 / Math.sqrt(c) // 奇點位置
  const f = (t: number) => Math.log(Math.abs(1 - c * t * t)) * Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI)
  // 對 t ≥ 0 積分後乘 2（偶函數）。奇點附近用變數代換 t = t0 ± s² 消除 log 奇異性。
  // s → 0 時 2s·log|…| → 0（可去奇點），直接回傳 0 以避免 0·(−∞) = NaN
  const near = (sign: 1 | -1) => (s: number) => (s === 0 ? 0 : 2 * s * f(t0 + sign * s * s))
  const left = integrate(near(-1), 0, Math.sqrt(t0), 400)
  const rightNear = integrate(near(1), 0, 1, 400)
  const tail = integrate(f, t0 + 1, t0 + 1 + 40, 2000)
  return 2 * (left + rightNear + tail)
}

/** 以二分法求 Gaussian（σ=1）的 almost-sure 上限：λ(μ_as) = 0（約 2.4212，勘誤 E14）。 */
export function gaussianAlmostSureMuMax(sigma = 1): number {
  let lo = 1
  let hi = 4
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    if (gaussianLyapunov(mid, sigma) < 0) lo = mid
    else hi = mid
  }
  return (0.5 * (lo + hi)) / (sigma * sigma)
}

/** 複合 Simpson 積分（n 取偶數）。 */
function integrate(f: (t: number) => number, a: number, b: number, n: number): number {
  const m = n % 2 === 0 ? n : n + 1
  const h = (b - a) / m
  let s = f(a) + f(b)
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(a + i * h)
  return (s * h) / 3
}

// ───────────────────────── 批次最佳解（§1、§2） ─────────────────────────

// #region core:batchOptima
/**
 * 估計單一常數 w 時（x ≡ 1），兩種成本的批次最佳解：
 *   MSE：min Σ(y_i − w)² ⇒ 平均值；MAE：min Σ|y_i − w| ⇒ 中位數（偶數筆時區間內任一點皆最佳）。
 * 例：y = [0,0,0,10] ⇒ MSE 2.5、MAE 0（規格 §2.3）。
 */
export function batchOptima(y: number[]): { mse: number; maeLow: number; maeHigh: number } {
  const s = [...y].sort((p, q) => p - q)
  const n = s.length
  const mse = s.reduce((acc, v) => acc + v, 0) / n
  const maeLow = s[Math.floor((n - 1) / 2)]
  const maeHigh = s[Math.ceil((n - 1) / 2)]
  return { mse, maeLow, maeHigh }
}
// #endregion

/** 單筆成本函數（給 Cost Curve 圖用）。 */
export function lossValue(kind: 'mse' | 'mae' | 'huber', e: number, huberDelta = 1): number {
  if (kind === 'mse') return 0.5 * e * e
  if (kind === 'mae') return Math.abs(e)
  const a = Math.abs(e)
  return a <= huberDelta ? 0.5 * e * e : huberDelta * (a - 0.5 * huberDelta)
}

/** 平均成本 J(w) = (1/N)Σ loss(y_i − w·x_i)（給 J(w) 曲線用）。 */
export function averageCost(kind: 'mse' | 'mae' | 'huber', w: number, xs: ArrayLike<number>, ys: ArrayLike<number>, huberDelta = 1): number {
  let s = 0
  for (let i = 0; i < xs.length; i++) s += lossValue(kind, ys[i] - w * xs[i], huberDelta)
  return xs.length ? s / xs.length : 0
}
