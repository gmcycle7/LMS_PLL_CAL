/**
 * Ch01（規格 §1–§2）的計算核心：LMS Playground 軌跡、MSE 成本拋物線（mseParabola）、MSE / MAE / Huber 損失比較、
 * 批次最佳解（平均／加權中位數／Huber M-estimate）、母體最佳解，以及 Sign-Error LMS 穩態的
 * lattice Markov 鏈精確解與連續雜訊下的擴散近似（Var ≈ μ/(4f_ṽ)）。模型層級 L0（純量、無 PLL 動態）。
 *
 * 所有權重更新都呼叫 lms.ts 的步進器（conventionalStep / STEP[variant]），本檔不重寫 LMS 更新律；
 * 唯一例外是 `signErrorFixedPointRun`：它刻意示範「整數 code 累加」的定點版本，用來和 IEEE double 對照（勘誤 E40）。
 *
 * 全站約定：
 *   - 誤差 e = y − w·x；參數誤差 δ = a − w（勘誤 E39）。
 *   - 單筆成本 j = ½e²，平均成本 J(w) = ½E[(y − wx)²]（勘誤 E41：LMS = 對 ½J₂ 的 SGD）。
 *   - sign(0) 慣例必須明定：'zero' | 'plus' | 'minus'（勘誤 E40）。
 *
 * 所有函式皆為純函式，參數與結果可 structuredClone（可經 useWorkerTask 在 Web Worker 執行）。
 */

import { createRng, normCdf, normPdf, normSf } from '@/simulation/core'
import {
  STEP,
  classifyPole,
  conventionalStep,
  fixedXPole,
  huberPsi,
  lossValue,
  sgn,
  type LmsVariant,
  type PoleBehaviour,
  type TieRule,
} from './lms'

export type LossKind = 'mse' | 'mae' | 'huber'

/** 損失 ↔ 對應的 LMS 變體（lms.ts 的 STEP key） */
export const LOSS_VARIANT: Record<LossKind, LmsVariant> = {
  mse: 'conventional',
  mae: 'sign_error',
  huber: 'huber',
}

/** |w| 超過此值即判定發散並停止（避免 Infinity / NaN 汙染圖表） */
export const DIVERGENCE_LIMIT = 1e12

// ───────────────────────── §1 LMS Playground ─────────────────────────

export interface PlaygroundParams {
  /** 真實係數 a */
  a: number
  w0: number
  /** 固定輸入 x（regressor） */
  x: number
  mu: number
  steps: number
  /** 量測雜訊 v 的標準差（零均值 Gaussian，與 x 獨立）；0 = 無雜訊 */
  noiseSigma: number
  seed: number
  /** 從第 freezeAt 次更新起凍結（μ_eff = 0，模擬 REG_LMS_FREEZE）；null/undefined = 不凍結 */
  freezeAt?: number | null
}

export interface PlaygroundTrace {
  /** w_0 … w_N（長度 N+1） */
  w: Float64Array
  /** e_n = y_n − w_n·x（長度 N） */
  e: Float64Array
  /** y_n = a·x + v_n */
  y: Float64Array
  /** v_n */
  v: Float64Array
  /** Δw_n = μ·e_n·x */
  dw: Float64Array
  /** δ_n = a − w_n（長度 N+1；全站極性，勘誤 E39） */
  delta: Float64Array
  /** 第一次 |w| > 1e12 或非有限的索引；null = 未發散 */
  divergedAt: number | null
}

// #region core:playgroundTrace
/** LMS Playground：固定 x、可選零均值雜訊；每一步都呼叫 lms.ts 的 conventionalStep。 */
export function playgroundTrace(p: PlaygroundParams): PlaygroundTrace {
  const N = Math.max(0, Math.floor(p.steps))
  const noise = createRng(p.seed).fork('noise') // 雜訊流只由 seed 決定：改 μ 不會換一組雜訊（paired）
  const w = new Float64Array(N + 1)
  const e = new Float64Array(N)
  const y = new Float64Array(N)
  const v = new Float64Array(N)
  const dw = new Float64Array(N)
  w[0] = p.w0
  let divergedAt: number | null = null
  for (let n = 0; n < N; n++) {
    const vn = p.noiseSigma > 0 ? p.noiseSigma * noise.normal() : 0
    const yn = p.a * p.x + vn // 量測：y_n = a·x + v_n
    const frozen = p.freezeAt != null && n >= p.freezeAt // 凍結後 μ_eff = 0
    const s = conventionalStep({ w: w[n], x: p.x, y: yn, mu: frozen ? 0 : p.mu }) // w_{n+1} = w_n + μ·e_n·x
    v[n] = vn
    y[n] = yn
    e[n] = s.e
    dw[n] = s.dw
    w[n + 1] = s.w
    if (!Number.isFinite(s.w) || Math.abs(s.w) > DIVERGENCE_LIMIT) {
      divergedAt = n + 1
      w.fill(Number.NaN, n + 2)
      e.fill(Number.NaN, n + 1)
      dw.fill(Number.NaN, n + 1)
      break
    }
  }
  const delta = w.map((wn) => p.a - wn) // δ_n = a − w_n（勘誤 E39）
  return { w, e, y, v, dw, delta, divergedAt }
}
// #endregion

// #region core:playgroundClosedForm
/** 無雜訊封閉解（F-01.8）：δ_n = pⁿ·δ_0 ⇒ w_n = a − (a − w_0)·pⁿ，p = 1 − μx²。 */
export function playgroundClosedForm(a: number, w0: number, x: number, mu: number, n: number): number {
  const p = fixedXPole(mu, x)
  return a - (a - w0) * Math.pow(p, n)
}

/**
 * 有零均值雜訊時 w_n 的變異數（F-01.9，精確）：
 *   w̃_{n+1} = p·w̃_n + μx·v_n ⇒ Var(w_n) = μ²x²σ_v²·(1 − p^{2n})/(1 − p²)
 * |p| < 1 時 n → ∞ 的極限為 μσ_v²/(2 − μx²)。
 */
export function playgroundVarW(mu: number, x: number, sigma: number, n: number): number {
  if (sigma === 0 || x === 0 || mu === 0 || n <= 0) return 0
  const p = fixedXPole(mu, x)
  const q = p * p
  const g = mu * mu * x * x * sigma * sigma
  if (Math.abs(1 - q) < 1e-15) return g * n // |p| = 1：線性成長
  return (g * (1 - Math.pow(q, n))) / (1 - q)
}
// #endregion

/** |p| < 1 時的穩態變異數 μσ_v²/(2 − μx²)；不穩定時回傳 Infinity。 */
export function playgroundVarWStationary(mu: number, x: number, sigma: number): number {
  const p = fixedXPole(mu, x)
  if (Math.abs(p) >= 1) return Number.POSITIVE_INFINITY
  return (mu * sigma * sigma) / (2 - mu * x * x)
}

export interface PlaygroundEnsembleParams {
  a: number
  w0: number
  x: number
  mu: number
  steps: number
  noiseSigma: number
  seed: number
  /** 獨立路徑數 R */
  paths: number
}

export interface PlaygroundEnsembleResult {
  /** 比較的時間點（= steps） */
  n: number
  paths: number
  /** R 條路徑在第 n 步的 w 樣本平均 */
  meanW: number
  /** 樣本變異數（ddof = 1） */
  varW: number
  /** Gaussian 樣本變異數的標準誤 var·√(2/(R−1)) */
  seVar: number
  /** 有路徑發散時為 true（此時統計量無意義） */
  diverged: boolean
}

/**
 * Monte Carlo 交叉比對：R 條獨立路徑（每條 seed = root.fork(i).seed）在第 n 步的 w 平均與變異數，
 * 用來驗證 F-01.8 / F-01.9（w_n 是 Gaussian 雜訊的線性組合，所以樣本變異數的 SE = σ²√(2/(R−1))）。
 */
export function playgroundEnsemble(p: PlaygroundEnsembleParams): PlaygroundEnsembleResult {
  const root = createRng(p.seed).fork('ensemble')
  const R = Math.max(2, Math.floor(p.paths))
  const n = Math.max(0, Math.floor(p.steps))
  let sum = 0
  let sum2 = 0
  let diverged = false
  const finals = new Float64Array(R)
  for (let i = 0; i < R; i++) {
    const tr = playgroundTrace({ ...p, seed: root.fork(i).seed, freezeAt: null })
    if (tr.divergedAt !== null) diverged = true
    finals[i] = tr.w[n]
    sum += tr.w[n]
  }
  const meanW = sum / R
  for (let i = 0; i < R; i++) sum2 += (finals[i] - meanW) ** 2
  const varW = sum2 / (R - 1)
  return { n, paths: R, meanW, varW, seVar: varW * Math.sqrt(2 / (R - 1)), diverged }
}

export interface FixedXStability {
  pole: number
  behaviour: PoleBehaviour
  /** |p| < 1（漸近收斂到 a） */
  converges: boolean
  /** 穩定上限 2/x²（x = 0 → ∞，且不可辨識） */
  muMax: number
  /** 一步到位 μ = 1/x²（p = 0） */
  muOneStep: number
}

/** 固定 x、無雜訊時的穩定性分類（T02；規格 §3）。 */
export function fixedXStability(mu: number, x: number): FixedXStability {
  const pole = fixedXPole(mu, x)
  return {
    pole,
    behaviour: classifyPole(pole),
    converges: Math.abs(pole) < 1,
    muMax: x === 0 ? Number.POSITIVE_INFINITY : 2 / (x * x),
    muOneStep: x === 0 ? Number.POSITIVE_INFINITY : 1 / (x * x),
  }
}

// ───────────────────────── §1.2 MSE 成本拋物線（由二階動差直接計算） ─────────────────────────

export interface MseParabola {
  /** J(w) = ½(E[y²] − 2w·E[xy] + w²·E[x²])（本站含 ½，勘誤 E41） */
  J: number
  /** dJ/dw = w·E[x²] − E[xy] = −E[e·x]（在 w* 為 0：normal equation，F-01.5） */
  slope: number
  /** 最低點 w* = E[xy]/E[x²]（F-01.4） */
  wStar: number
  /** 雜訊底 J(w*) = ½(E[y²] − E[xy]²/E[x²])（F-01.6） */
  jMin: number
  /** 二次碗 ½E[x²](w − w*)²；J(w) = jMin + bowl（配方，F-01.6） */
  bowl: number
}

// #region core:mseParabola
/**
 * MSE 成本只需要三個二階動差 E[x²]、E[xy]、E[y²]（F-01.3）：算出任一點 w 的成本、斜率，以及最低點與配方的兩項。
 * E[x²] ≤ 0（x 恆為 0）時拋物線退化成水平線，w* 不存在（不可辨識）：w*、J(w*)、bowl 回傳 NaN。
 */
export function mseParabola(Exx: number, Exy: number, Eyy: number, w: number): MseParabola {
  const J = 0.5 * (Eyy - 2 * w * Exy + w * w * Exx) // J = ½J₂（F-01.2、F-01.3）
  const slope = w * Exx - Exy // dJ/dw = −E[(y − w·x)·x] = −E[e·x]
  if (!(Exx > 0)) return { J, slope, wStar: Number.NaN, jMin: Number.NaN, bowl: Number.NaN }
  const wStar = Exy / Exx // 斜率 = 0 的點
  const jMin = 0.5 * (Eyy - (Exy * Exy) / Exx) // 調 w 消不掉的部分
  const bowl = 0.5 * Exx * (w - wStar) ** 2 // 偏離 w* 的代價
  return { J, slope, wStar, jMin, bowl }
}
// #endregion

// ───────────────────────── 精確有理數（T01 手算驗證） ─────────────────────────

/** 有理數 n/d（d > 0，已約分） */
export interface Frac {
  n: bigint
  d: bigint
}

function bigAbs(v: bigint): bigint {
  return v < 0n ? -v : v
}

function gcd(p: bigint, q: bigint): bigint {
  let a = bigAbs(p)
  let b = bigAbs(q)
  while (b) [a, b] = [b, a % b]
  return a
}

function frac(n: bigint, d: bigint): Frac {
  if (d === 0n) throw new Error('分母為 0')
  const s = d < 0n ? -1n : 1n
  const g = gcd(n, d) || 1n
  return { n: (s * n) / g, d: (s * d) / g }
}

/**
 * 把使用者輸入的十進位數轉成精確分數：以 JavaScript 最短 round-trip 十進位字串為準，
 * 例如 0.1 → 1/10（而不是二進位 double 的 3602879701896397/36028797018963968）。
 */
export function fracFromNumber(x: number): Frac {
  if (!Number.isFinite(x)) throw new Error(`無法轉成分數：${x}`)
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(x))
  if (!m) throw new Error(`無法解析數字：${x}`)
  const [, sign, int, dec = '', ex = '0'] = m
  let n = BigInt(int + dec)
  let d = 10n ** BigInt(dec.length)
  const e = Number(ex)
  if (e > 0) n *= 10n ** BigInt(e)
  else if (e < 0) d *= 10n ** BigInt(-e)
  return frac(sign === '-' ? -n : n, d)
}

export const fracAdd = (p: Frac, q: Frac): Frac => frac(p.n * q.d + q.n * p.d, p.d * q.d)
export const fracSub = (p: Frac, q: Frac): Frac => frac(p.n * q.d - q.n * p.d, p.d * q.d)
export const fracMul = (p: Frac, q: Frac): Frac => frac(p.n * q.n, p.d * q.d)
export const fracEq = (p: Frac, q: Frac): boolean => p.n === q.n && p.d === q.d
export const fracToNumber = (p: Frac): number => Number(p.n) / Number(p.d)
export const fracToString = (p: Frac): string => (p.d === 1n ? `${p.n}` : `${p.n}/${p.d}`)

// #region core:exactLmsTrace
/** 無雜訊 LMS 的精確有理數軌跡：w_{n+1} = w_n + μ(a·x − w_n·x)·x（T01：w₁ = 9/5、w₂ = 57/25）。 */
export function exactLmsTrace(a: number, w0: number, x: number, mu: number, steps: number): Frac[] {
  const A = fracFromNumber(a)
  const X = fracFromNumber(x)
  const M = fracFromNumber(mu)
  const out: Frac[] = [fracFromNumber(w0)]
  for (let n = 0; n < steps; n++) {
    const w = out[n]
    const e = fracSub(fracMul(A, X), fracMul(w, X)) // e_n = a·x − w_n·x（無雜訊）
    out.push(fracAdd(w, fracMul(M, fracMul(e, X)))) // w_{n+1} = w_n + μ·e_n·x
  }
  return out
}
// #endregion

// ───────────────────────── §2 損失函數 ─────────────────────────

// #region core:lossPsi
/** 三種損失 ρ(e)：½e²、|e|、Huber（定義在 lms.ts 的 lossValue）。 */
export function lossRho(kind: LossKind, e: number, huberDelta = 1): number {
  return lossValue(kind, e, huberDelta)
}

/** ψ(e) = dρ/de：更新量 Δw = μ·ψ(e)·x 的核心（MAE 在 e = 0 用 tie 慣例選一個次梯度，勘誤 E40）。 */
export function lossPsi(kind: LossKind, e: number, huberDelta = 1, tie: TieRule = 'zero'): number {
  if (kind === 'mse') return e // d(½e²)/de = e
  if (kind === 'mae') return sgn(e, tie) // d|e|/de = sign(e)；e = 0 時從 [−1, 1] 依 tie 取值
  return huberPsi(e, huberDelta) // clip(e, −δ_H, δ_H)
}
// #endregion

// ───────────────────────── §2 資料產生（同一組資料給三種演算法） ─────────────────────────

/** four_point：y 從固定集合（預設 [0,0,0,10]）等機率抽樣、x ≡ 1；contaminated：y = a·x + v + outlier */
export type DataModel = 'four_point' | 'contaminated'
/** const：x ≡ A；pm1：x = ±A（等機率）；gaussian：x ~ N(0, A²) */
export type XDist = 'const' | 'pm1' | 'gaussian'
/** positive：outlier 一律 +s；symmetric：±s 各半 */
export type OutlierSign = 'positive' | 'symmetric'

export const FOUR_POINT_VALUES: readonly number[] = [0, 0, 0, 10]

export interface LossDataParams {
  model: DataModel
  /** four_point 的 y 集合（預設 [0,0,0,10]） */
  values?: number[]
  /** 真實係數 a（four_point 不使用，視為 0） */
  a: number
  xDist: XDist
  /** A：const 時 x ≡ A，pm1 時 x = ±A，gaussian 時 σ_x = A（four_point 強制 x ≡ 1） */
  xScale: number
  /** Gaussian 量測雜訊 σ_v */
  sigma: number
  /** outlier 機率 ε（0–1） */
  outlierProb: number
  /** outlier 大小 s */
  outlierSize: number
  outlierSign: OutlierSign
  /** 樣本數（= 迭代步數） */
  n: number
  seed: number
}

export interface LossData {
  x: Float64Array
  y: Float64Array
  /** 1 = 這筆含 outlier（four_point：大於中位數的那些值） */
  outlier: Uint8Array
}

// #region core:generateLossData
/** 產生一組 (x_n, y_n)；三種演算法都吃「同一組」資料，差異只來自更新律（paired comparison）。 */
export function generateLossData(p: LossDataParams): LossData {
  const root = createRng(p.seed)
  const pick = root.fork('pick')
  const xr = root.fork('x')
  const vr = root.fork('noise')
  const or = root.fork('outlier')
  const sr = root.fork('outlier-sign')
  const N = Math.max(0, Math.floor(p.n))
  const x = new Float64Array(N)
  const y = new Float64Array(N)
  const outlier = new Uint8Array(N)
  const vals = p.values && p.values.length ? p.values : FOUR_POINT_VALUES
  const med = sortedMedian(vals)
  for (let i = 0; i < N; i++) {
    if (p.model === 'four_point') {
      x[i] = 1 // 只估一個常數：x ≡ 1
      y[i] = vals[pick.int(0, vals.length - 1)] // 從 {0,0,0,10} 等機率抽一筆
      outlier[i] = y[i] > med ? 1 : 0
      continue
    }
    const xi = p.xDist === 'const' ? p.xScale : p.xDist === 'pm1' ? p.xScale * xr.sign() : p.xScale * xr.normal()
    let yi = p.a * xi + p.sigma * vr.normal() // y = a·x + v
    if (or.uniform() < p.outlierProb) {
      yi += (p.outlierSign === 'symmetric' ? sr.sign() : 1) * p.outlierSize // 突發干擾，與 x 獨立
      outlier[i] = 1
    }
    x[i] = xi
    y[i] = yi
  }
  return { x, y, outlier }
}
// #endregion

function sortedMedian(v: readonly number[]): number {
  const s = [...v].sort((p, q) => p - q)
  const k = s.length
  return k % 2 ? s[(k - 1) / 2] : 0.5 * (s[k / 2 - 1] + s[k / 2])
}

export interface RunOptions {
  w0: number
  mu: number
  tie: TieRule
  huberDelta: number
}

export interface VariantRun {
  /** w_0 … w_N */
  w: Float64Array
  divergedAt: number | null
}

// #region core:runOnSameData
/** 在同一組資料上跑某個 LMS 變體：迴圈完全相同，唯一差別是 STEP[variant]（lms.ts）。 */
export function runVariantOnData(variant: LmsVariant, data: LossData, o: RunOptions): VariantRun {
  const step = STEP[variant] // conventional / sign_error / huber / sign_sign
  const N = data.x.length
  const w = new Float64Array(N + 1)
  w[0] = o.w0
  for (let n = 0; n < N; n++) {
    w[n + 1] = step({ w: w[n], x: data.x[n], y: data.y[n], mu: o.mu, tie: o.tie, huberDelta: o.huberDelta }).w
    if (!Number.isFinite(w[n + 1]) || Math.abs(w[n + 1]) > DIVERGENCE_LIMIT) {
      w.fill(Number.NaN, n + 2)
      return { w, divergedAt: n + 1 }
    }
  }
  return { w, divergedAt: null }
}
// #endregion

// ───────────────────────── 批次（有限資料）最佳解 ─────────────────────────

/** 閉區間 [lo, hi]；lo = hi 表示唯一解 */
export interface Interval {
  lo: number
  hi: number
}

/**
 * 加權中位數：最小化 Σ w_i·|r_i − t|。
 * 導數（在 r_i 之間）= Σ_{r_i<t} w_i − Σ_{r_i>t} w_i；累積權重第一次超過一半處即最小值。
 * 若累積權重「剛好」等於一半，最小值是一整段 [r_k, r_{k+1}]（偶數筆資料的中位數區間）。
 */
export function weightedMedian(values: ArrayLike<number>, weights: ArrayLike<number>): Interval {
  const items: { r: number; wt: number }[] = []
  for (let i = 0; i < values.length; i++) if (weights[i] > 0) items.push({ r: values[i], wt: weights[i] })
  if (!items.length) return { lo: Number.NaN, hi: Number.NaN }
  items.sort((p, q) => p.r - q.r)
  let W = 0
  for (const it of items) W += it.wt
  const half = W / 2
  const tol = 1e-12 * W
  let c = 0
  let k = 0
  while (k < items.length) {
    const r = items[k].r
    while (k < items.length && items[k].r === r) c += items[k++].wt // 相同值的權重一起累加
    if (c > half + tol) return { lo: r, hi: r }
    if (Math.abs(c - half) <= tol) return { lo: r, hi: k < items.length ? items[k].r : r } // 剛好一半：平坦區間
  }
  const last = items[items.length - 1].r
  return { lo: last, hi: last }
}

// #region core:batchOptima
/** L2：min Σ½(y_i − w·x_i)² ⇒ Σx_i(y_i − w·x_i) = 0 ⇒ w = Σx_i·y_i / Σx_i²（x ≡ 1 時就是平均）。 */
export function batchL2(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < x.length; i++) {
    sxy += x[i] * y[i]
    sxx += x[i] * x[i]
  }
  return sxx > 0 ? sxy / sxx : Number.NaN // Σx² = 0：不可辨識
}

/** L1：Σ|y_i − w·x_i| = Σ|x_i|·|r_i − w|（r_i = y_i/x_i）⇒ 以 |x_i| 為權重的加權中位數。 */
export function batchL1(x: ArrayLike<number>, y: ArrayLike<number>): Interval {
  const r: number[] = []
  const wt: number[] = []
  for (let i = 0; i < x.length; i++) {
    if (x[i] === 0) continue // x = 0 的樣本不含 w 的資訊
    r.push(y[i] / x[i])
    wt.push(Math.abs(x[i]))
  }
  return weightedMedian(r, wt)
}

/** Huber：f(w) = Σx_i·ψ(y_i − w·x_i) 對 w 單調不增 ⇒ 二分法求 f(w) = 0。 */
export function batchHuber(x: ArrayLike<number>, y: ArrayLike<number>, delta: number): number {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < x.length; i++) {
    if (x[i] === 0) continue
    const r = y[i] / x[i]
    if (r < lo) lo = r
    if (r > hi) hi = r
  }
  if (!Number.isFinite(lo)) return Number.NaN
  const f = (w: number) => {
    let s = 0
    for (let i = 0; i < x.length; i++) s += x[i] * huberPsi(y[i] - w * x[i], delta)
    return s
  }
  return bisectDecreasing(f, lo - 1, hi + 1)
}
// #endregion

/** 對單調不增函數 f 在 [lo, hi]（f(lo) ≥ 0 ≥ f(hi)）求根。 */
function bisectDecreasing(f: (t: number) => number, lo: number, hi: number): number {
  let a = lo
  let b = hi
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + b)
    if (m === a || m === b) break
    const v = f(m)
    if (v > 0) a = m
    else if (v < 0) b = m
    else return m
  }
  return 0.5 * (a + b)
}

// ───────────────────────── 母體（無限資料）最佳解 ─────────────────────────

/** 總雜訊 ṽ = v + o（Gaussian 雜訊 + outlier；程式中的變數名用 n）的分布：ṽ ~ Σ p_k·N(m_k, σ²)（σ = 0 時為離散點質量） */
export interface NoiseMixture {
  comps: { p: number; m: number }[]
  sigma: number
}

/** 由資料模型取得總雜訊 ṽ = y − a·x 的分布（four_point：a = 0、σ = 0，點質量在各個值上）。 */
export function noiseMixture(p: LossDataParams): NoiseMixture {
  if (p.model === 'four_point') {
    const vals = p.values && p.values.length ? p.values : FOUR_POINT_VALUES
    return { comps: vals.map((m) => ({ p: 1 / vals.length, m })), sigma: 0 }
  }
  const eps = Math.min(1, Math.max(0, p.outlierProb))
  const s = p.outlierSize
  const comps =
    p.outlierSign === 'symmetric'
      ? [
          { p: 1 - eps, m: 0 },
          { p: eps / 2, m: s },
          { p: eps / 2, m: -s },
        ]
      : [
          { p: 1 - eps, m: 0 },
          { p: eps, m: s },
        ]
  return { comps: comps.filter((c) => c.p > 0), sigma: Math.max(0, p.sigma) }
}

/** P(ṽ < t)、P(ṽ = t)、P(ṽ > t)；離散點質量以相對容差判斷相等（模擬「同一格點上精確相等」）。 */
export function mixtureProbs(mix: NoiseMixture, t: number, eqTol = 0): { below: number; equal: number; above: number } {
  let below = 0
  let equal = 0
  let above = 0
  for (const c of mix.comps) {
    if (mix.sigma > 0) {
      const z = (t - c.m) / mix.sigma
      below += c.p * normCdf(z)
      above += c.p * normSf(z)
    } else if (Math.abs(t - c.m) <= eqTol) equal += c.p
    else if (c.m < t) below += c.p
    else above += c.p
  }
  return { below, equal, above }
}

/** E[clip(m + σZ, −d, d)]，Z ~ N(0,1)（Huber ψ 的期望值，封閉式）。 */
export function expectedClipGaussian(m: number, sigma: number, d: number): number {
  if (sigma <= 0) return Math.max(-d, Math.min(d, m))
  const a = (-d - m) / sigma
  const b = (d - m) / sigma
  // E[X; |X| ≤ d] = m(Φ(b) − Φ(a)) + σ(φ(a) − φ(b))
  return -d * normCdf(a) + d * normSf(b) + m * (normCdf(b) - normCdf(a)) + sigma * (normPdf(a) - normPdf(b))
}

export interface PopulationOptima {
  /** MSE 最佳解 E[xy]/E[x²] */
  l2: number
  /** MAE 最佳解（可能是區間） */
  l1: Interval
  /** Huber 最佳解 */
  huber: number
  /** x 零均值且與雜訊獨立（三者皆等於 a） */
  zeroMeanX: boolean
}

// #region core:populationOptima
/**
 * 母體最佳解 = 期望梯度為 0 的點：E[x·ψ(y − w·x)] = 0。
 * (1) x 零均值、與雜訊獨立（pm1 / gaussian）：w = a 時 E[x·ψ(ṽ)] = E[x]·E[ψ(ṽ)] = 0 ⇒ 三種損失都給 a。
 * (2) x ≡ A：令 t = (w − a)·A，條件變成 E[ψ(ṽ − t)] = 0 ⇒ t 是總雜訊 ṽ = y − a·x 的「位置參數」：
 *     MSE → 平均 E[ṽ]、MAE → 中位數、Huber → Huber 位置；w* = a + t/A。
 */
export function populationOptima(p: LossDataParams, huberDelta: number): PopulationOptima {
  if (p.model === 'contaminated' && p.xScale === 0) {
    const nan = Number.NaN // x ≡ 0：E[x²] = 0，a 不可辨識
    return { l2: nan, l1: { lo: nan, hi: nan }, huber: nan, zeroMeanX: false }
  }
  if (p.model === 'contaminated' && p.xDist !== 'const') {
    return { l2: p.a, l1: { lo: p.a, hi: p.a }, huber: p.a, zeroMeanX: true }
  }
  const a = p.model === 'four_point' ? 0 : p.a
  const A = p.model === 'four_point' ? 1 : p.xScale
  const mix = noiseMixture(p)
  const tMean = mix.comps.reduce((s, c) => s + c.p * c.m, 0) // E[ṽ]
  const tMed = mixtureMedian(mix) // P(ṽ < t) ≤ ½ ≤ P(ṽ ≤ t)
  const tHub = mixtureHuberLocation(mix, huberDelta) // E[ψ(ṽ − t)] = 0
  const toW = (t: number) => a + t / A
  const l1a = toW(tMed.lo)
  const l1b = toW(tMed.hi)
  return { l2: toW(tMean), l1: { lo: Math.min(l1a, l1b), hi: Math.max(l1a, l1b) }, huber: toW(tHub), zeroMeanX: false }
}
// #endregion

/** 混合分布的中位數（σ > 0：二分法解 F(t) = ½；σ = 0：點質量的加權中位數，可能是區間）。 */
export function mixtureMedian(mix: NoiseMixture): Interval {
  if (mix.sigma <= 0) {
    return weightedMedian(
      mix.comps.map((c) => c.m),
      mix.comps.map((c) => c.p),
    )
  }
  const ms = mix.comps.map((c) => c.m)
  const lo = Math.min(...ms) - 12 * mix.sigma - 1
  const hi = Math.max(...ms) + 12 * mix.sigma + 1
  const t = bisectDecreasing((u) => 0.5 - mixtureProbs(mix, u).below, lo, hi)
  return { lo: t, hi: t }
}

/** Huber 位置參數：解 E[ψ_δ(ṽ − t)] = Σ p_k·E[clip(m_k − t + σZ, −δ, δ)] = 0。 */
export function mixtureHuberLocation(mix: NoiseMixture, delta: number): number {
  const ms = mix.comps.map((c) => c.m)
  const lo = Math.min(...ms) - delta - 12 * mix.sigma - 1
  const hi = Math.max(...ms) + delta + 12 * mix.sigma + 1
  const g = (t: number) => mix.comps.reduce((s, c) => s + c.p * expectedClipGaussian(c.m - t, mix.sigma, delta), 0)
  return bisectDecreasing(g, lo, hi)
}

/** 偏離 Gaussian 的近似：大 outlier（s ≫ σ）、單邊、比例 ε 時中位數 ≈ σ·Φ⁻¹(1/(2(1−ε)))。 */
export function contaminatedMedianApprox(sigma: number, eps: number): number {
  const q = 1 / (2 * (1 - eps))
  if (!(q < 1)) return Number.NaN
  // 以二分法求 Φ⁻¹(q)，避免依賴 normInv 的定義域邊界
  return sigma * bisectDecreasing((z) => q - normCdf(z), -40, 40)
}

// ───────────────────────── 穩態：LMS 與 Sign-Error ─────────────────────────

export interface LmsSteadyState {
  /** 穩態平均 E[w] */
  mean: number
  /** 穩態變異數 Var(w)（不穩定時 Infinity） */
  variance: number
  stable: boolean
  /** 使用的公式說明 */
  formula: 'const-x' | 'zero-mean-x'
  /** 平均動態的 pole p = 1 − μP_x（w_n 的 lag-k 自相關 = p^{|k|}） */
  pole: number
  /** 時間平均的積分相關時間 τ = (1 + p)/(1 − p)：Var(n 筆的時間平均) ≈ Var(w)·τ/n */
  tauMean: number
  /** 樣本變異數的相對變異因子 c（Bartlett 公式）：SE(樣本變異數)/Var(w) ≈ √(c/n)，c = (η − 3) + 2(1 + p²)/(1 − p²) */
  varFactor: number
  /** 上面兩個標準誤公式是否精確：x ≡ A、x = ±A 時 w_n 是真正的 AR(1)（精確）；Gaussian x 只是小 μ 近似 */
  seExact: boolean
}

/** 混合 Gaussian 的原點動差 E[ṽᵏ]，k = 1…4（各成分 N(m, σ²)：m、m²+σ²、m³+3mσ²、m⁴+6m²σ²+3σ⁴）。 */
export function mixtureRawMoments(mix: NoiseMixture): { m1: number; m2: number; m3: number; m4: number } {
  const v = mix.sigma * mix.sigma
  let m1 = 0
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const c of mix.comps) {
    const m = c.m
    m1 += c.p * m
    m2 += c.p * (m * m + v)
    m3 += c.p * (m ** 3 + 3 * m * v)
    m4 += c.p * (m ** 4 + 6 * m * m * v + 3 * v * v)
  }
  return { m1, m2, m3, m4 }
}

// #region core:lmsSteadyState
/**
 * 固定步長 Conventional LMS 的穩態（x iid、與總雜訊 ṽ = y − a·x 獨立）：
 *   x ≡ A：w_{n+1} = (1 − μA²)·w_n + μA·y_n ⇒ E[w] = E[y]/A，Var(w) = μ·Var(ṽ)/(2 − μA²)
 *   x 零均值對稱（±A、Gaussian）：E[w] = a，Var(w) = μ·P_x·E[ṽ²]/(2P_x − μ·E[x⁴])（勘誤 E42）
 * 另外回傳「單一路徑的時間平均／樣本變異數會偏離多少」的理論標準誤（交叉比對的容忍度用它，不用猜的百分比）：
 *   w_n 是 AR(1)（pole p）⇒ Var(時間平均) ≈ Var(w)·(1 + p)/(1 − p)/n；
 *   樣本變異數：Bartlett 公式 n·Var(ŝ²) → Var(w)²·[(η − 3) + 2(1 + p²)/(1 − p²)]，η = 驅動雜訊的峰度 E[ε⁴]/E[ε²]²。
 */
export function lmsSteadyState(p: LossDataParams, mu: number): LmsSteadyState {
  const mix = noiseMixture(p)
  const { m1, m2, m3, m4 } = mixtureRawMoments(mix)
  const nan = Number.NaN
  if (p.model === 'contaminated' && p.xScale === 0) {
    return { mean: nan, variance: nan, stable: false, formula: p.xDist === 'const' ? 'const-x' : 'zero-mean-x', pole: 1, tauMean: nan, varFactor: nan, seExact: false }
  }
  const se = (pole: number, eta: number, stable: boolean) =>
    stable
      ? { pole, tauMean: (1 + pole) / (1 - pole), varFactor: Math.max(0, eta - 3 + (2 * (1 + pole * pole)) / (1 - pole * pole)) }
      : { pole, tauMean: nan, varFactor: nan }
  if (p.model === 'four_point' || p.xDist === 'const') {
    const a = p.model === 'four_point' ? 0 : p.a
    const A = p.model === 'four_point' ? 1 : p.xScale
    const stable = mu > 0 && mu * A * A < 2
    const varN = m2 - m1 * m1
    const c4 = m4 - 4 * m1 * m3 + 6 * m1 * m1 * m2 - 3 * m1 ** 4 // 四階中心動差 E[(ṽ − E ṽ)⁴]
    const eta = varN > 0 ? c4 / (varN * varN) : 3 // 驅動雜訊 ε = ṽ − E[ṽ] 的峰度
    return { mean: a + m1 / A, variance: stable ? (mu * varN) / (2 - mu * A * A) : Infinity, stable, formula: 'const-x', ...se(1 - mu * A * A, eta, stable), seExact: true }
  }
  const A = p.xScale
  const Px = A * A
  const gauss = p.xDist === 'gaussian'
  const M4 = gauss ? 3 * A ** 4 : A ** 4
  const stable = mu > 0 && mu < (2 * Px) / M4
  const eta = (m2 > 0 ? m4 / (m2 * m2) : 3) * (gauss ? 3 : 1) // ε = x·ṽ 的峰度 = (E[x⁴]/P_x²)·(E[ṽ⁴]/E[ṽ²]²)
  return {
    mean: p.a,
    variance: stable ? (mu * Px * m2) / (2 * Px - mu * M4) : Infinity,
    stable,
    formula: 'zero-mean-x',
    ...se(1 - mu * Px, eta, stable),
    seExact: !gauss,
  }
}
// #endregion

export interface LatticeStationary {
  /** 穩態（時間平均）E[w] */
  mean: number
  /** 穩態標準差 */
  std: number
  /** 格點間距（w 單位）= μ·A */
  h: number
  /** 有正機率的格點數 */
  states: number
  /** 機率最大的格點 */
  mode: number
  /** 格點 w 值與機率（只保留 π > 1e-12 者，方便畫圖） */
  grid: number[]
  pi: number[]
  /** max π（以迴圈計算；格點可達數十萬個，不能用 Math.max(...pi) 展開） */
  piMax: number
  /** 時間平均的漸近變異數（每筆）：n 筆的時間平均 w̄ 的標準誤 = √(meanAvar/n)（精確，來自鏈本身的相關結構） */
  meanAvar: number
  /** 樣本變異數的漸近變異數（每筆）：SE(ŝ²) = √(varAvar/n) */
  varAvar: number
  /** 是否因狀態數上限而截斷 */
  truncated: boolean
}

// #region core:signErrorLattice
/**
 * Sign-Error LMS 在 x ≡ A 或 x = ±A 時每步只走 ±μA，所以 w 被關在格點 w_0 + μA·ℤ 上：
 * 這是一條 birth–death Markov 鏈。令 t = (w − a)·A（雜訊單位），格點間距 μA²：
 *   x ≡ A：上移機率 u(t) = P(ṽ > t) + [tie=plus]·P(ṽ = t)，下移機率 d(t) = P(ṽ < t) + [tie=minus]·P(ṽ = t)
 *   x = ±A：兩個分支各佔 ½；x = −A 時 e = ṽ + t 且更新方向相反（見下方 up / dn）
 * 長期「上下流量平衡」π_j·u_j = π_{j+1}·d_{j+1} 給出精確的穩態分布與時間平均。
 */
export function signErrorLatticeStationary(
  p: LossDataParams,
  o: { w0: number; mu: number; tie: TieRule },
): LatticeStationary | null {
  const isFour = p.model === 'four_point'
  if (!isFour && p.xDist === 'gaussian') return null // 步長 μ|x| 連續變化 → 沒有格點結構
  const a = isFour ? 0 : p.a
  const A = isFour ? 1 : p.xScale
  const h = o.mu * A * A
  if (!(h > 0) || !Number.isFinite(h)) return null
  const mix = noiseMixture(p)
  const pm1 = !isFour && p.xDist === 'pm1'
  const plus = o.tie === 'plus' ? 1 : 0
  const minus = o.tie === 'minus' ? 1 : 0
  const t0 = (o.w0 - a) * A
  const tol = 1e-9 * h
  const tAt = (j: number) => t0 + j * h
  // x = +A 分支：e = ṽ − t；x = −A 分支：e = ṽ + t，且更新方向相反（Δw = μ·sign(e)·x）
  const up = (t: number) => {
    const q = mixtureProbs(mix, t, tol)
    if (!pm1) return q.above + plus * q.equal
    const r = mixtureProbs(mix, -t, tol)
    return 0.5 * (q.above + plus * q.equal) + 0.5 * (r.below + minus * r.equal)
  }
  const dn = (t: number) => {
    const q = mixtureProbs(mix, t, tol)
    if (!pm1) return q.below + minus * q.equal
    const r = mixtureProbs(mix, -t, tol)
    return 0.5 * (q.below + minus * q.equal) + 0.5 * (r.above + plus * r.equal)
  }
  // 起點：雜訊（pm1 時為對稱化雜訊 ṽ·sign(x)）中位數附近的格點
  const med = pm1
    ? mixtureMedian({ sigma: mix.sigma, comps: mix.comps.flatMap((c) => [{ p: c.p / 2, m: c.m }, { p: c.p / 2, m: -c.m }]) })
    : mixtureMedian(mix)
  const j0 = Math.round((0.5 * (med.lo + med.hi) - t0) / h)
  const MAX = 50000 // 每側最多 5 萬格（超過時回報 truncated；UI 顯示 n/a）
  const upW: number[] = [1]
  let truncated = false
  for (let j = j0, cur = 1; ; j++) {
    const u = up(tAt(j))
    if (u <= 0) break
    const d = dn(tAt(j + 1))
    if (d <= 0) break // 往上走後回不來：j0 以上已無正機率的循環狀態（理論上不會發生於中位數附近）
    cur *= u / d
    upW.push(cur)
    if (cur < 1e-18) break
    if (upW.length > MAX) {
      truncated = true
      break
    }
  }
  const dnW: number[] = []
  for (let j = j0, cur = 1; ; j--) {
    const d = dn(tAt(j))
    if (d <= 0) break
    const u = up(tAt(j - 1))
    if (u <= 0) break
    cur *= d / u
    dnW.push(cur)
    if (cur < 1e-18) break
    if (dnW.length > MAX) {
      truncated = true
      break
    }
  }
  // 組合：j = j0 − dnW.length … j0 + upW.length − 1
  const weights = [...dnW.reverse(), ...upW]
  const jStart = j0 - dnW.length
  let Z = 0
  for (const v of weights) Z += v
  let mT = 0
  let m2 = 0
  let best = 0
  for (let k = 0; k < weights.length; k++) {
    const t = tAt(jStart + k)
    const pk = weights[k] / Z
    mT += pk * t
    m2 += pk * t * t
    if (weights[k] > weights[best]) best = k
  }
  const varT = Math.max(0, m2 - mT * mT)
  // 時間平均的漸近變異數（birth–death 鏈的 Poisson 方程式有封閉解）：
  //   σ_a²(f) = 2·Σ_j S_j²/(π_j·u_j) − Var_π(f)，S_j = Σ_{i≤j} π_i·(f_i − f̄)
  // 用 f = t 得到「時間平均」的標準誤，用 f = (t − t̄)² 得到「樣本變異數」的標準誤。
  let S1 = 0
  let S2 = 0
  let acc1 = 0
  let acc2 = 0
  let m4c = 0
  for (let k = 0; k < weights.length; k++) {
    const t = tAt(jStart + k)
    const pk = weights[k] / Z
    const d = t - mT
    m4c += pk * d ** 4
    S1 += pk * d
    S2 += pk * (d * d - varT)
    if (k === weights.length - 1) break // 最後一格往上的機率為 0（S 也回到 0）
    const u = up(t)
    if (pk > 0 && u > 0) {
      acc1 += (S1 * S1) / (pk * u)
      acc2 += (S2 * S2) / (pk * u)
    }
  }
  const meanAvarT = Math.max(0, 2 * acc1 - varT)
  const varAvarT = Math.max(0, 2 * acc2 - Math.max(0, m4c - varT * varT))
  const grid: number[] = []
  const pi: number[] = []
  let piMax = 0
  for (let k = 0; k < weights.length; k++) {
    const pk = weights[k] / Z
    if (pk > piMax) piMax = pk
    if (pk > 1e-12) {
      grid.push(a + tAt(jStart + k) / A)
      pi.push(pk)
    }
  }
  return {
    mean: a + mT / A,
    std: Math.sqrt(varT) / Math.abs(A),
    h: o.mu * Math.abs(A),
    states: grid.length,
    mode: a + tAt(jStart + best) / A,
    grid,
    pi,
    piMax,
    meanAvar: meanAvarT / (A * A),
    varAvar: varAvarT / A ** 4,
    truncated,
  }
}
// #endregion

/** 混合 Gaussian 總雜訊 ṽ 的機率密度 f_ṽ(t) = Σ p_k·φ((t − m_k)/σ)/σ（σ = 0：點質量，沒有密度，回傳 NaN）。 */
export function mixtureDensity(mix: NoiseMixture, t: number): number {
  if (!(mix.sigma > 0)) return Number.NaN
  let fd = 0
  for (const c of mix.comps) fd += (c.p * normPdf((t - c.m) / mix.sigma)) / mix.sigma
  return fd
}

export interface SignErrorJitter {
  /** 小 μ 擴散近似的穩態變異數 Var(w) ≈ μ/(4·f_ṽ(t*))；不適用時為 NaN */
  variance: number
  /** f_ṽ(t*)：雜訊密度在固定點的值（等效 1-bit 增益 K_q = 2·f_ṽ(t*)） */
  density: number
  /** 固定點（雜訊座標 t = (w − a)·A）：x ≡ A 時為 n 的中位數，x 零均值時為 0 */
  tStar: number
  /** 有效性指標 μA²·f_ṽ(t*)（每步在雜訊座標走的距離 × 密度）：≪ 1 時近似才準 */
  smallness: number
  applicable: boolean
  /** 不適用的原因（適用時為空字串） */
  reason: string
}

// #region core:signErrorJitter
/**
 * Sign-Error LMS 在「連續」雜訊下的穩態抖動（小 μ 擴散近似，F-01.18）。令 d = w − w*：
 *   在固定點附近把雜訊的 CDF 泰勒展開到一階：P(e > 0) − P(e < 0) ≈ −2·f_ṽ(t*)·x·d
 *   平均漂移 E[Δd | d] ≈ −2μ·f_ṽ(t*)·E[x²]·d   （像一個等效增益 K_q = 2·f_ṽ(t*) 的線性迴路）
 *   每步能量 E[(Δd)²] = μ²·E[x²]                （因為 sign² = 1）
 * 穩態時兩者平衡：2·(2μ·f_ṽ·E[x²])·E[d²] = μ²·E[x²] ⇒ Var(w) ≈ μ/(4·f_ṽ(t*)) = μ/(2K_q)，與 |x| 無關。
 * Gaussian 雜訊 f_ṽ(0) = 1/(√(2π)σ_v) ⇒ Var(w) ≈ (μ/2)·√(π/2)·σ_v：std 是 O(√μ)，不是 O(μ)。
 * 點質量資料（σ_v = 0，例如 {0,0,0,10}）沒有密度：抖動由格點鏈決定，才是 O(μ|x|)。
 */
export function signErrorJitterApprox(p: LossDataParams, mu: number): SignErrorJitter {
  const na = (reason: string): SignErrorJitter => ({
    variance: Number.NaN,
    density: Number.NaN,
    tStar: Number.NaN,
    smallness: Number.NaN,
    applicable: false,
    reason,
  })
  if (p.model === 'four_point' || !(p.sigma > 0)) return na('資料是點質量（沒有機率密度）：抖動由格點鏈決定，為 O(μ|x|)')
  if (p.xScale === 0) return na('x ≡ 0：不可辨識')
  if (!(mu > 0)) return na('μ ≤ 0：沒有穩態')
  const mix = noiseMixture(p)
  const tStar = p.xDist === 'const' ? mixtureMedian(mix).lo : 0 // x 零均值時固定點是 w = a（t = 0）
  const density = mixtureDensity(mix, tStar)
  if (!(density > 0)) return na('固定點處的雜訊密度為 0（中位數落在兩群資料之間）')
  return { variance: mu / (4 * density), density, tStar, smallness: mu * p.xScale * p.xScale * density, applicable: true, reason: '' }
}
// #endregion

/** signErrorDiffusionKappa 的適用條件：outlier 群離固定點至少這麼多個 σ（Φ(−8) ≈ 6×10⁻¹⁶，outlier 對固定點附近的密度沒有貢獻） */
export const KAPPA_MAIN_LOBE_SIGMAS = 8

/**
 * 擴散近似（F-01.18）有多準：二階修正指標 κ（[近似｜需驗證]；handcalcs.test.tsx 以格點鏈精確解驗證）。
 *
 * F-01.18 把雜訊的 CDF 在固定點 t* 當成直線。保留下兩階 F(t* + d) ≈ ½ + f·d + f′·d²/2 + f″·d³/6，
 * 擴散極限的穩態密度 ∝ exp(−d²/(2V₀))·exp(−(f′/f)·d³/(6V₀) − (f″/f)·d⁴/(24V₀))，V₀ = μA²/(4f)（雜訊座標 t = (w − a)·A）。
 * 固定點落在 Gaussian 主體 N(0, σ²) 上時 f′/f = −z/σ、f″/f = (z² − 1)/σ²（z = t* /σ），逐項取期望值得到
 *   Var_t ≈ V₀·[1 + (1 + z²)·V₀/(2σ²)]  ⇒  std 的相對誤差（近似／精確 − 1）≈ −κ/4，κ = (1 + z²)·V₀/σ²。
 * 意義：穩態抖動的寬度 √V₀ 必須遠小於 σ；固定點離主體中心越遠（單邊 outlier 把中位數推到 z > 0），密度變化越快，要求越嚴。
 * 無 outlier 的 Gaussian（z = 0）時 κ = (π/2)·μA²·f，就是原本的「μA²f ≪ 1」；但 ε → 0.5 時 f 變小、μA²f 看起來「更小」，
 * κ 卻變大（近似變差）——所以污染資料要看 κ，不能只看 μA²f。
 * 適用範圍：x ≡ A 的 contaminated 模型，且每一群 outlier 都離固定點至少 KAPPA_MAIN_LOBE_SIGMAS·σ
 * （固定點附近的密度才由主體決定）；其餘情況回傳 NaN。
 */
export function signErrorDiffusionKappa(p: LossDataParams, mu: number): number {
  if (p.model !== 'contaminated' || p.xDist !== 'const') return Number.NaN
  const j = signErrorJitterApprox(p, mu)
  if (!j.applicable) return Number.NaN
  const far = noiseMixture(p).comps.every((c) => c.m === 0 || Math.abs(c.m - j.tStar) >= KAPPA_MAIN_LOBE_SIGMAS * p.sigma * (1 - 1e-9))
  if (!far) return Number.NaN // outlier 與主體重疊：f′/f、f″/f 不是主體 Gaussian 的值
  const z = j.tStar / p.sigma // 固定點在主體上的標準化位置
  const varT = p.xScale * p.xScale * j.variance // w 的變異數換到雜訊座標：Var_t = A²·Var(w) = μA²/(4f)
  return ((1 + z * z) * varT) / (p.sigma * p.sigma)
}

// #region core:signErrorFixedPoint
/**
 * 定點版 Sign-Error LMS（x = ±A 或 x ≡ A）：w 以整數 code k 儲存（LSB = μ·A），
 * 每步 k ← k ± 1，不會累積浮點捨入；|e| ≤ 1e−9·LSB·A 視為「精確相等」交給 tie 慣例。
 * 與 lms.ts 的 signErrorStep（IEEE double 連加）對照，示範勘誤 E40。
 */
export function signErrorFixedPointRun(
  data: LossData,
  o: { w0: number; mu: number; tie: TieRule },
): { w: Float64Array; tieHits: number } | null {
  const N = data.x.length
  if (!N) return { w: Float64Array.of(o.w0), tieHits: 0 }
  const A = Math.abs(data.x[0])
  for (let n = 0; n < N; n++) if (Math.abs(data.x[n]) !== A) return null // |x| 不固定 → 沒有格點
  const lsb = o.mu * A
  const w = new Float64Array(N + 1)
  w[0] = o.w0
  let k = 0 // 整數 code
  let tieHits = 0
  for (let n = 0; n < N; n++) {
    const wn = o.w0 + k * lsb // 由整數 code 重建 w（只有一次捨入）
    const e = data.y[n] - wn * data.x[n]
    const tie = Math.abs(e) <= 1e-9 * lsb * A
    if (tie) tieHits++
    const s = tie ? sgn(0, o.tie) : e > 0 ? 1 : -1
    k += s * Math.sign(data.x[n]) // ← 差異：整數累加 k ± 1，不累積浮點誤差
    w[n + 1] = o.w0 + k * lsb
  }
  return { w, tieHits }
}
// #endregion

export interface TimeStats {
  /** 後半段的時間平均 */
  mean: number
  /** 平均的標準誤（batch means；批次不足時為 NaN = 無法檢定） */
  se: number
  /** 後半段的樣本標準差（ddof = 1） */
  std: number
  /** 樣本變異數 std² 的標準誤（對 (w − mean)² 做 batch means；批次不足時為 NaN） */
  varSe: number
  /** 由 lag-1 自相關估計的積分相關時間 τ = (1 + ρ₁)/(1 − ρ₁)（單位：samples） */
  tau: number
  /** 實際使用的批次數與每批長度 */
  nBatches: number
  batchLen: number
  from: number
  /** 後半段的樣本數（= 長度 − from） */
  n: number
}

/** 少於這麼多個（近似獨立的）批次時，不回報標準誤（NaN）：避免用不可靠的 SE 做「假的」交叉比對 */
export const MIN_BATCHES = 8

// #region core:timeAverage
/**
 * 時間平均、標準差與它們的標準誤（只用後半段，避開初始暫態）。
 * w_n 是有記憶的序列（LMS 的相關時間約 1/(μP_x)），直接用 std/√n 會嚴重低估誤差，所以用 batch means：
 * 把後半段切成長度 L 的批次，L 至少取 5 倍的積分相關時間 τ（由 lag-1 自相關 ρ₁ 以 AR(1) 模型估計），
 * 批次平均近似獨立 ⇒ SE = std(批次平均)/√B。批次數 B < 8 時回傳 NaN（樣本太短，無法檢定）。
 */
export function timeAverage(w: ArrayLike<number>, batches = 40): TimeStats {
  const from = Math.floor(w.length / 2)
  const n = w.length - from
  const nan = Number.NaN
  if (n < 2) return { mean: nan, se: nan, std: nan, varSe: nan, tau: nan, nBatches: 0, batchLen: 0, from, n }
  let s = 0
  for (let i = from; i < w.length; i++) s += w[i]
  const mean = s / n
  let v = 0
  let c1 = 0
  for (let i = from; i < w.length; i++) {
    const d = w[i] - mean
    v += d * d
    if (i + 1 < w.length) c1 += d * (w[i + 1] - mean)
  }
  const std = Math.sqrt(v / (n - 1))
  const rho1 = v > 0 ? Math.min(0.999999, Math.max(0, c1 / v)) : 0 // lag-1 自相關（負相關不會讓 SE 變大，取 0）
  const tau = (1 + rho1) / (1 - rho1) // AR(1)：Σ_k ρ₁^{|k|}
  const L = Math.max(1, Math.floor(n / Math.max(2, batches)), Math.ceil(5 * tau)) // ← 批次長度至少 5τ
  const B = Math.floor(n / L)
  if (B < MIN_BATCHES) return { mean, se: nan, std, varSe: nan, tau, nBatches: B, batchLen: L, from, n }
  const bm = new Float64Array(B) // 各批次的平均（以整體平均為基準，避免大數相減）
  const bv = new Float64Array(B) // 各批次的 (w − mean)² 平均
  for (let b = 0; b < B; b++) {
    let t = 0
    let q = 0
    for (let i = 0; i < L; i++) {
      const d = w[from + b * L + i] - mean
      t += d
      q += d * d
    }
    bm[b] = t / L
    bv[b] = q / L
  }
  const seOf = (a: Float64Array) => {
    let m = 0
    for (const q of a) m += q
    m /= B
    let s2 = 0
    for (const q of a) s2 += (q - m) ** 2
    return Math.sqrt(s2 / (B - 1) / B) // 批次平均的樣本標準差 / √B
  }
  return { mean, se: seOf(bm), std, varSe: seOf(bv), tau, nBatches: B, batchLen: L, from, n }
}
// #endregion

// ───────────────────────── 長時間 tie 慣例研究（Worker） ─────────────────────────

export interface TieStudyParams {
  data: LossDataParams
  w0: number
  mu: number
}

export interface TieStudyRow {
  tie: TieRule
  arithmetic: 'ieee' | 'fixed'
  timeAvg: number
  se: number
  /** 後半段的樣本標準差（軌跡的抖動） */
  std: number
  /** 被判定為 e = 0 的次數 */
  tieHits: number
  /** lattice Markov 鏈的精確時間平均（Gaussian x 時為 null） */
  latticeMean: number | null
  /** lattice Markov 鏈的精確穩態標準差（Gaussian x 時為 null） */
  latticeStd: number | null
}

export interface TieStudyResult {
  steps: number
  rows: TieStudyRow[]
}

/**
 * 長時間（例如 4×10⁵ 步）比較三種 tie 慣例 × 兩種算術（IEEE double / 定點整數 code）的 Sign-Error 時間平均，
 * 並和 lattice 鏈的精確值比對。這是 Worker 任務（結果只含數字，可 structuredClone）。
 */
export function runTieStudy(p: TieStudyParams): TieStudyResult {
  const data = generateLossData(p.data)
  const rows: TieStudyRow[] = []
  for (const tie of ['zero', 'plus', 'minus'] as TieRule[]) {
    const lattice = signErrorLatticeStationary(p.data, { w0: p.w0, mu: p.mu, tie })
    const ieee = runVariantOnData('sign_error', data, { w0: p.w0, mu: p.mu, tie, huberDelta: 1 })
    let hits = 0
    for (let n = 0; n < data.x.length; n++) if (data.y[n] - ieee.w[n] * data.x[n] === 0) hits++
    const ta = timeAverage(ieee.w)
    const exact = { latticeMean: lattice?.mean ?? null, latticeStd: lattice?.std ?? null }
    rows.push({ tie, arithmetic: 'ieee', timeAvg: ta.mean, se: ta.se, std: ta.std, tieHits: hits, ...exact })
    const fx = signErrorFixedPointRun(data, { w0: p.w0, mu: p.mu, tie })
    if (fx) {
      const tf = timeAverage(fx.w)
      rows.push({ tie, arithmetic: 'fixed', timeAvg: tf.mean, se: tf.se, std: tf.std, tieHits: fx.tieHits, ...exact })
    }
  }
  return { steps: data.x.length, rows }
}

// ───────────────────────── 成本曲線與估計量效率 ─────────────────────────

/**
 * 三種平均成本 J(w) = (1/N)Σρ(y_i − w·x_i) 在 w 網格上的值。
 * MSE 用充分統計量（½(S_yy − 2wS_xy + w²S_xx)/N，與逐筆加總數學上相同）；MAE / Huber 逐筆加總。
 */
export function costCurves(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  wGrid: ArrayLike<number>,
  huberDelta: number,
): { mse: Float64Array; mae: Float64Array; huber: Float64Array } {
  const N = x.length
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < N; i++) {
    sxx += x[i] * x[i]
    sxy += x[i] * y[i]
    syy += y[i] * y[i]
  }
  const G = wGrid.length
  const mse = new Float64Array(G)
  const mae = new Float64Array(G)
  const huber = new Float64Array(G)
  for (let g = 0; g < G; g++) {
    const w = wGrid[g]
    mse[g] = N ? (0.5 * (syy - 2 * w * sxy + w * w * sxx)) / N : 0
    let s1 = 0
    let sh = 0
    for (let i = 0; i < N; i++) {
      const e = y[i] - w * x[i]
      s1 += lossValue('mae', e)
      sh += lossValue('huber', e, huberDelta)
    }
    mae[g] = N ? s1 / N : 0
    huber[g] = N ? sh / N : 0
  }
  return { mse, mae, huber }
}

export interface EfficiencyParams {
  /** 每次估計用的樣本數 */
  n: number
  trials: number
  sigma: number
  outlierProb: number
  outlierSize: number
  huberDelta: number
  seed: number
}

export interface EfficiencyResult {
  /** 各估計量（平均 / 中位數 / Huber）在 trials 次重複中的平均與變異數 */
  mean: { avg: number; variance: number }
  median: { avg: number; variance: number }
  huber: { avg: number; variance: number }
}

/**
 * 估計量效率的 Monte Carlo：重複抽 n 筆 y = v + o（真值 0），比較平均、中位數、Huber 的抖動與偏差。
 * 乾淨 Gaussian 時 Var(中位數)/Var(平均) → π/2（大 n 漸近）；有 outlier 時中位數 / Huber 勝出。
 */
export function estimatorEfficiency(p: EfficiencyParams): EfficiencyResult {
  const root = createRng(p.seed)
  const vr = root.fork('noise')
  const or = root.fork('outlier')
  const n = Math.max(1, Math.floor(p.n))
  const T = Math.max(2, Math.floor(p.trials))
  const ones = new Float64Array(n).fill(1)
  const y = new Float64Array(n)
  const est = { mean: new Float64Array(T), median: new Float64Array(T), huber: new Float64Array(T) }
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) y[i] = p.sigma * vr.normal() + (or.uniform() < p.outlierProb ? p.outlierSize : 0)
    est.mean[t] = batchL2(ones, y)
    const m = batchL1(ones, y)
    est.median[t] = 0.5 * (m.lo + m.hi)
    est.huber[t] = batchHuber(ones, y, p.huberDelta)
  }
  const summarize = (v: Float64Array) => {
    let s = 0
    for (const q of v) s += q
    const avg = s / v.length
    let s2 = 0
    for (const q of v) s2 += (q - avg) ** 2
    return { avg, variance: s2 / (v.length - 1) }
  }
  return { mean: summarize(est.mean), median: summarize(est.median), huber: summarize(est.huber) }
}
