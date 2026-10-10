/**
 * Ch02：Gradient Descent、SGD、Sign-Error / Sign-Sign LMS 的輔助模型（規格 §1.1、§2.2–§2.3；模型層級 L0）。
 *
 * 模型與 lms.ts 相同：y = a·x + v，預測 ŷ = w·x，誤差 e = y − w·x，參數誤差 δ = a − w（全站約定）。
 * 本檔只放「lms.ts 沒有」的純函式：
 *   - NLMS 單步（core:nlmsStep）與步長排程 μ_n（core:stepSchedule）
 *   - 確定性 Gradient Descent 與 batch / mini-batch / SGD 比較（core:gradientDescent、core:miniBatchStep、core:batchVsSgd）
 *   - Sign-Error 固定步長的 limit-cycle 解析解（core:limitCycle）
 *   - 雜訊／regressor 模型（Gaussian、Laplacian、impulsive、skewed；const、±1、Gaussian、正值均勻）
 *   - Mean-field：平均更新方向 ψ(w)、固定點 w*、線性化斜率 K、梯度雜訊 σ_η²、穩態變異預測（core:meanFieldDrift）
 *   - 共用資料的多演算法模擬與 Monte Carlo（core:sharedData、core:runShared、core:monteCarlo）
 *   - 比值觀點：四種演算法的批次固定點 = y/x 的加權平均／加權中位數（core:ratioView）
 *
 * 所有隨機性一律經 createRng(seed)；Worker 可呼叫的函式只接收／回傳 structured-cloneable 物件。
 * sign(0) 慣例沿用 lms.ts 的 TieRule（勘誤 E40）。
 */

import { createRng, deriveSeed, meanCI, normCdf, normPdf, quantile, type Rng } from '@/simulation/core'
import { STEP, sgn, type StepInput, type StepOutput, type TieRule } from './lms'

// ───────────────────────── 型別與標籤 ─────────────────────────

export type AlgoId = 'lms' | 'sign_error' | 'sign_sign' | 'huber' | 'nlms'
export const ALGO_IDS: readonly AlgoId[] = ['lms', 'sign_error', 'sign_sign', 'nlms', 'huber']

export const ALGO_LABEL: Record<AlgoId, string> = {
  lms: 'LMS',
  sign_error: 'Sign-Error',
  sign_sign: 'Sign-Sign',
  huber: 'Huber',
  nlms: 'NLMS',
}

/** regressor x 的分布：常數、±A 等機率（BPSK / DSM-like）、N(0, A²)、正值均勻 U[0.5A, 1.5A] */
export type XKind = 'const' | 'bpsk' | 'gauss' | 'uniformPos'
/** 量測雜訊 v 的形狀（標準差皆為 σ，方便「同功率、不同形狀」比較） */
export type NoiseKind = 'none' | 'gaussian' | 'laplacian' | 'impulsive' | 'skewed'
export type ScheduleKind = 'constant' | 'harmonic' | 'gear'
export type StepMatch = 'same-mu' | 'same-speed'

export const X_KIND_LABEL: Record<XKind, string> = {
  const: '常數 x = A',
  bpsk: '±A 等機率（BPSK／DSM-like）',
  gauss: 'Gaussian N(0, A²)',
  uniformPos: '正值均勻 U[0.5A, 1.5A]',
}

export const NOISE_KIND_LABEL: Record<NoiseKind, string> = {
  none: '無雜訊',
  gaussian: 'Gaussian',
  laplacian: 'Laplacian（雙指數）',
  impulsive: 'Impulsive（5% 樣本的標準差是其餘的 10 倍；總標準差 σ）',
  skewed: 'Skewed（中心化指數，偏斜）',
}

export const SCHEDULE_LABEL: Record<ScheduleKind, string> = {
  constant: '固定 μ',
  harmonic: 'μ₀/(1+n/n₀)',
  gear: 'Gear-shift：每 n₀ 步減半（下限 μ₀/64）',
}

/** Impulsive（contaminated Gaussian）：以機率 ε 抽到 k 倍標準差的樣本；總標準差正規化為 σ。 */
export const IMPULSIVE_EPS = 0.05
export const IMPULSIVE_K = 10
/** Gear-shift 的最小步長比例 μ_min/μ₀ */
export const GEAR_FLOOR_RATIO = 1 / 64

export interface XDist {
  kind: XKind
  /** 幅度 A（Gaussian 時為標準差） */
  amp: number
}

export interface NoiseDist {
  kind: NoiseKind
  /** 基本雜訊的標準差 σ（none 時忽略） */
  sigma: number
  /** 單邊 outlier：每筆以機率 p 加上 s */
  outlierProb: number
  outlierSize: number
}

// ───────────────────────── NLMS 與步長排程 ─────────────────────────

export interface NlmsStepInput extends StepInput {
  /** 正規化分母的 ε（避免 x ≈ 0 時除以零、並限制雜訊放大） */
  eps?: number
}

// #region core:nlmsStep
/** NLMS（純量）：w ← w + μ̃·e·x/(ε + x²)。μ̃ 無因次，0 < μ̃ < 2 時對任何幅度的 x 都穩定。 */
export function nlmsStep({ w, x, y, mu, eps = 0 }: NlmsStepInput): StepOutput {
  const e = y - w * x // 預測誤差
  const dw = (mu * e * x) / (eps + x * x) // ← 差異：步長除以 ε + x²（輸入功率正規化）
  return { e, dw, w: w + dw }
}
// #endregion

export interface Schedule {
  kind: ScheduleKind
  /** harmonic：時間常數 n₀；gear：每 n₀ 步減半 */
  n0: number
}

// #region core:stepSchedule
/** 第 n 步的步長 μ_n。固定 μ 永遠停不下來；遞減步長讓跳動帶寬 μ_n|x| → 0。 */
export function stepSize(mu0: number, n: number, s: Schedule): number {
  switch (s.kind) {
    case 'constant':
      return mu0 // 固定步長：穩態帶寬 ∝ μ
    case 'harmonic':
      return mu0 / (1 + n / s.n0) // ← 差異：Σμ_n = ∞（走得到）、Σμ_n² < ∞（雜訊累積有限）
    case 'gear':
      return Math.max(mu0 * 2 ** -Math.floor(n / s.n0), mu0 * GEAR_FLOOR_RATIO) // ← 差異：硬體友善的右移（shift）
  }
}
// #endregion

/** 前 N 步（n = 0…N−1）累積可移動的距離 Σ μ_n·|x|。 */
export function travelDistance(mu0: number, absX: number, s: Schedule, nSteps: number): number {
  let d = 0
  for (let n = 0; n < nSteps; n++) d += stepSize(mu0, n, s) * absX
  return d
}

/**
 * Sign-Error 每步移動 μ_n|x|：要走完距離 D 需要的最少步數（找不到時回傳 Infinity）。
 * harmonic 排程下 Σ_{n<N} μ₀/(1+n/n₀) ≈ μ₀n₀·ln(1+N/n₀)，所以 N ≈ n₀(e^{D/(μ₀n₀|x|)} − 1)：距離呈指數代價。
 */
export function stepsToTravel(dist: number, mu0: number, absX: number, s: Schedule, maxSteps = 20_000_000): number {
  if (dist <= 0) return 0
  if (!(mu0 > 0 && absX > 0)) return Infinity
  // harmonic：Σ_{n<M} 1/(1+n/n₀) ≤ 1 + n₀·ln(1 + (M−1)/n₀)（積分上界）。上界都到不了就不必逐步累加。
  if (s.kind === 'harmonic' && s.n0 > 0 && mu0 * absX * (1 + s.n0 * Math.log1p((maxSteps - 1) / s.n0)) < dist) return Infinity
  let d = 0
  for (let n = 0; n < maxSteps; n++) {
    d += stepSize(mu0, n, s) * absX
    if (d >= dist) return n + 1
  }
  return Infinity
}

// #region core:harmonicReach
/**
 * harmonic 排程 μ_n = μ₀/(1+n/n₀) 的兩個封閉式近似（F-02.11；手算題 HC-02.3 用的就是這兩式）。
 * 把和換成積分：Σ_{n<N} μ_n|x| ≈ ∫₀ᴺ μ₀|x|/(1+n/n₀) dn。被積函數遞減，所以「和 ≥ 積分」：
 * 近似的距離略低估；步數是整數，要拿無條件進位的近似值來比——實際步數 stepsToTravel() ≤ ⌈近似值⌉
 * （例：μ₀ = 0.4、n₀ = 20、D = 3 ⇒ 近似 9.1 步、實際 9 步）。
 */
/** 前 N 步可移動的距離 ≈ μ₀·n₀·|x|·ln(1 + N/n₀)：只隨 ln N 成長。 */
export function harmonicTravelApprox(mu0: number, absX: number, n0: number, nSteps: number): number {
  return mu0 * n0 * absX * Math.log1p(nSteps / n0) // c·ln(1 + N/n₀)，c = μ₀n₀|x|
}
/** 走完距離 D 約需的步數 N ≈ n₀·(e^{D/(μ₀n₀|x|)} − 1)：對距離是指數（太遠就 stall）。 */
export function harmonicReachSteps(dist: number, mu0: number, absX: number, n0: number): number {
  if (dist <= 0) return 0
  if (!(mu0 > 0 && absX > 0 && n0 > 0)) return Infinity
  return n0 * Math.expm1(dist / (mu0 * n0 * absX)) // ← 上式反解 N
}
// #endregion

// ───────────────────────── 確定性 Gradient Descent（§1.1） ─────────────────────────

export interface GdParams {
  a: number
  x: number
  w0: number
  mu: number
  steps: number
  /** 'half'：J = ½(y − wx)²（勘誤 E41 的修正版，與 LMS 同 scaling）；'full'：J₂ = (y − wx)²（梯度大 2 倍） */
  cost?: 'half' | 'full'
}

export interface GdTrace {
  w: Float64Array
  e: Float64Array
  J: Float64Array
  /** J'(w_n) */
  dJ: Float64Array
  /** Δw_n = −μ·J'(w_n) */
  dw: Float64Array
}

// #region core:gradientDescent
/** 固定 x、無雜訊的 Gradient Descent：w_{n+1} = w_n − μ·J'(w_n)。cost='half' 時與 LMS 逐位元相同。 */
export function gradientDescent({ a, x, w0, mu, steps, cost = 'half' }: GdParams): GdTrace {
  const c = cost === 'half' ? 0.5 : 1 // J = c·e²（E41：沒有 ½ 時斜率大 2 倍）
  const w = new Float64Array(steps + 1)
  const e = new Float64Array(steps + 1)
  const J = new Float64Array(steps + 1)
  const dJ = new Float64Array(steps + 1)
  const dw = new Float64Array(steps + 1)
  w[0] = w0
  for (let n = 0; n <= steps; n++) {
    e[n] = a * x - w[n] * x // e = y − w·x
    J[n] = c * e[n] * e[n] // 成本（切線圖的縱軸）
    const g = 2 * c * e[n] // dJ/de：c·e² 對 e 的導數（c = ½ 時就是 e）
    dJ[n] = -g * x // 連鎖律：dJ/dw = (dJ/de)·(de/dw) = g·(−x)
    dw[n] = mu * g * x // = −μ·J'(w)；c = ½ 時與 conventionalStep 的 μ·e·x 運算順序相同（逐位元相同）
    if (n < steps) w[n + 1] = w[n] + dw[n]
  }
  return { w, e, J, dJ, dw }
}
// #endregion

// ───────────────────────── Batch GD vs mini-batch vs SGD ─────────────────────────

export interface BatchSgdParams {
  a: number
  w0: number
  /** x ~ N(0, xSigma²) */
  xSigma: number
  /** v ~ N(0, σ²) */
  sigma: number
  /** 資料筆數 N */
  nData: number
  mu: number
  epochs: number
  /** mini-batch 大小 B（1 < B < N） */
  batch: number
  seed: number
}

export type BatchMethod = 'batch' | 'minibatch' | 'sgd'

export interface BatchSgdTrace {
  method: BatchMethod
  /** 已使用的樣本數（梯度計算次數），橫軸 */
  samples: Float64Array
  w: Float64Array
  /** 經驗成本 Ĵ(w) = (1/2N)Σ(y_i − w x_i)² */
  cost: Float64Array
  updates: number
}

export interface BatchSgdResult {
  traces: BatchSgdTrace[]
  /** 經驗最小平方解 Σxy/Σx² */
  wLs: number
  costMin: number
  /** 經驗 P̂_x = Σx²/N（batch GD 穩定需 μ < 2/P̂_x） */
  pxHat: number
}

// #region core:miniBatchStep
/** Mini-batch：用 B 筆的平均梯度更新一次。B = 1 就是 SGD（LMS），B = N 就是 batch GD。 */
export function miniBatchStep(w: number, xs: ArrayLike<number>, ys: ArrayLike<number>, idx: ArrayLike<number>, mu: number): number {
  let g = 0
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    g += (ys[i] - w * xs[i]) * xs[i] // 累加 e_i·x_i（= −單筆梯度）
  }
  return w + (mu * g) / idx.length // ← 差異：除以 B（平均梯度），雜訊變異數 ∝ 1/B
}
// #endregion

// #region core:batchVsSgd
/** 同一組資料、同樣「看過的樣本數」下，比較 batch GD、mini-batch 與 SGD 的軌跡。 */
export function batchVsSgd(p: BatchSgdParams): BatchSgdResult {
  const rng = createRng(p.seed)
  const xr = rng.fork('x')
  const vr = rng.fork('noise')
  const N = Math.max(1, Math.floor(p.nData))
  const xs = new Float64Array(N)
  const ys = new Float64Array(N)
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < N; i++) {
    xs[i] = p.xSigma * xr.normal()
    ys[i] = p.a * xs[i] + p.sigma * vr.normal()
    sxx += xs[i] * xs[i]
    sxy += xs[i] * ys[i]
    syy += ys[i] * ys[i]
  }
  const cost = (w: number) => (0.5 * (syy - 2 * w * sxy + w * w * sxx)) / N // O(1) 計算經驗成本
  const wLs = sxx > 0 ? sxy / sxx : NaN
  const sizes: Record<BatchMethod, number> = { batch: N, minibatch: Math.min(N, Math.max(1, Math.floor(p.batch))), sgd: 1 }
  const traces = (['batch', 'minibatch', 'sgd'] as BatchMethod[]).map((method) => {
    const B = sizes[method]
    const order = rng.fork(`shuffle-${method}`)
    const perm = Int32Array.from({ length: N }, (_, i) => i)
    const updatesPerEpoch = Math.ceil(N / B)
    const total = updatesPerEpoch * Math.max(1, Math.floor(p.epochs))
    const stride = Math.max(1, Math.ceil(total / 2000)) // 最多約 2000 點
    const samples: number[] = [0]
    const ws: number[] = [p.w0]
    const cs: number[] = [cost(p.w0)]
    let w = p.w0
    let seen = 0
    let u = 0
    for (let ep = 0; ep < Math.max(1, Math.floor(p.epochs)); ep++) {
      shuffle(perm, order) // 每個 epoch 重新洗牌（SGD 的「隨機」）
      for (let start = 0; start < N; start += B) {
        const idx = perm.subarray(start, Math.min(N, start + B))
        w = miniBatchStep(w, xs, ys, idx, p.mu)
        seen += idx.length
        u++
        if (u % stride === 0 || u === total) {
          samples.push(seen)
          ws.push(w)
          cs.push(cost(w))
        }
      }
    }
    return { method, samples: Float64Array.from(samples), w: Float64Array.from(ws), cost: Float64Array.from(cs), updates: u }
  })
  return { traces, wLs, costMin: Number.isFinite(wLs) ? cost(wLs) : NaN, pxHat: sxx / N }
}
// #endregion

function shuffle(a: Int32Array, rng: Rng): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
}

// ───────────────────────── Sign-Error 固定步長的 limit cycle ─────────────────────────

export interface LimitCycleInfo {
  /** 每步移動量 h = μ|x| */
  h: number
  /** 第一次進入週期集合的步數 */
  entryStep: number
  /** 週期集合（兩點；凍結時兩者相等） */
  lo: number
  hi: number
  /** 週期的時間平均 */
  mean: number
  /** 是否「剛好踩到」w = a（此時 sign(0) 慣例決定結果，勘誤 E40） */
  exactLanding: boolean
  /** sign(0)=0 且剛好踩到時凍結 */
  frozen: boolean
  /** x = 0：沒有任何資訊，w 不動 */
  identifiable: boolean
}

// #region core:limitCycle
/**
 * 無雜訊、固定 x 的 Sign-Error LMS（精確算術）：每步 w 往 a 走 h = μ|x|，
 * 進入 (a − h, a + h) 後在兩點之間來回跳（period-2 limit cycle）。
 * 令 δ₀ = a − w₀、n_c = ⌊|δ₀|/h⌋（走幾個整步）、ρ = |δ₀| − n_c·h ∈ [0, h)（剩下不到一步的距離）：
 *   ρ > 0 ⇒ 週期 {a − sgn(δ₀)·ρ, a + sgn(δ₀)·(h − ρ)}；
 *   ρ = 0（剛好踩到 a）⇒ 由 sign(0) 慣例決定：凍結在 a，或 {a, a + μ·s·x}（s = ±1）。
 */
export function signErrorLimitCycle(a: number, x: number, w0: number, mu: number, tie: TieRule = 'zero'): LimitCycleInfo {
  const h = mu * Math.abs(x)
  const d0 = a - w0 // δ₀（全站極性 δ = a − w）
  if (h === 0) return { h, entryStep: 0, lo: w0, hi: w0, mean: w0, exactLanding: false, frozen: true, identifiable: x !== 0 }
  const ratio = Math.abs(d0) / h
  const nearest = Math.round(ratio)
  const exactLanding = Math.abs(ratio - nearest) < 1e-9 * Math.max(1, ratio)
  if (exactLanding) {
    const s = sgn(0, tie) // ← sign(0) 的慣例（E40）
    const other = a + mu * s * x
    return { h, entryStep: nearest, lo: Math.min(a, other), hi: Math.max(a, other), mean: (a + other) / 2, exactLanding, frozen: s === 0, identifiable: true }
  }
  const dir = Math.sign(d0)
  const nc = Math.floor(ratio) // n_c：進入週期的步數
  const rho = Math.abs(d0) - nc * h // ρ：剩餘距離，0 < ρ < h
  const p1 = a - dir * rho // 最後一個還沒越過 a 的點
  const p2 = a + dir * (h - rho) // 越過 a 之後的點
  return { h, entryStep: nc, lo: Math.min(p1, p2), hi: Math.max(p1, p2), mean: (p1 + p2) / 2, exactLanding, frozen: false, identifiable: true }
}
// #endregion

export interface CycleTail {
  /** 週期兩點（模擬最後兩個樣本的較小／較大者） */
  lo: number
  hi: number
  /** 尾段時間平均：取「偶數個」樣本，period-2 的兩點才會等權重 */
  mean: number
  /** 用了幾個樣本（偶數；0 表示還沒進入週期） */
  count: number
}

/**
 * 從模擬軌跡 w_0…w_N 取 period-2 limit cycle 的兩點與時間平均（只看 n ≥ entryStep 的樣本）。
 * 平均取最後偶數個樣本：若取奇數個，兩點的權重差 1/count，平均會偏離 (lo + hi)/2。
 */
export function cycleTail(w: ArrayLike<number>, entryStep: number): CycleTail {
  const N = w.length - 1
  const first = Math.max(0, Math.ceil(entryStep))
  let count = N - first + 1
  if (count < 2) return { lo: NaN, hi: NaN, mean: NaN, count: 0 }
  count -= count % 2
  let s = 0
  for (let k = N - count + 1; k <= N; k++) s += w[k]
  return { lo: Math.min(w[N - 1], w[N]), hi: Math.max(w[N - 1], w[N]), mean: s / count, count }
}

/** 用 lms.ts 的 signErrorStep（IEEE double）實際跑一次固定 x、無雜訊的 Sign-Error。 */
export function runSignErrorFixedX(a: number, x: number, w0: number, steps: number, mu0: number, sched: Schedule, tie: TieRule): Float64Array {
  const w = new Float64Array(steps + 1)
  w[0] = w0
  for (let n = 0; n < steps; n++) w[n + 1] = STEP.sign_error({ w: w[n], x, y: a * x, mu: stepSize(mu0, n, sched), tie }).w
  return w
}

// ───────────────────────── 雜訊模型 ─────────────────────────

/** 基本雜訊（不含 outlier）的 CDF、PDF 與部分動差的反導函數。 */
interface BaseNoise {
  /** 是否為點質量（無雜訊） */
  atom: boolean
  cdf(t: number): number
  pdf(t: number): number
  /** G1(v) = ∫_{−∞}^{v} t·f(t) dt */
  g1(v: number): number
  /** G2(v) = ∫_{−∞}^{v} t²·f(t) dt */
  g2(v: number): number
  /** E[sign(c + v)]（sign(0) = 0） */
  signMean(c: number): number
}

function gaussBase(s: number): BaseNoise {
  return {
    atom: false,
    cdf: (t) => normCdf(t / s),
    pdf: (t) => normPdf(t / s) / s,
    g1: (v) => (Number.isFinite(v) ? -s * normPdf(v / s) : 0),
    g2: (v) => {
      if (v === Infinity) return s * s
      if (v === -Infinity) return 0
      const z = v / s
      return s * s * (normCdf(z) - z * normPdf(z))
    },
    signMean: (c) => 1 - 2 * normCdf(-c / s),
  }
}

function mixBase(parts: { w: number; b: BaseNoise }[]): BaseNoise {
  return {
    atom: parts.some((p) => p.b.atom),
    cdf: (t) => parts.reduce((acc, p) => acc + p.w * p.b.cdf(t), 0),
    pdf: (t) => parts.reduce((acc, p) => acc + p.w * p.b.pdf(t), 0),
    g1: (v) => parts.reduce((acc, p) => acc + p.w * p.b.g1(v), 0),
    g2: (v) => parts.reduce((acc, p) => acc + p.w * p.b.g2(v), 0),
    signMean: (c) => parts.reduce((acc, p) => acc + p.w * p.b.signMean(c), 0),
  }
}

const ATOM: BaseNoise = {
  atom: true,
  cdf: (t) => (t >= 0 ? 1 : 0),
  pdf: () => 0,
  g1: () => 0,
  g2: () => 0,
  signMean: (c) => Math.sign(c),
}

function baseNoise(kind: NoiseKind, sigma: number): BaseNoise {
  if (kind === 'none' || !(sigma > 0)) return ATOM
  switch (kind) {
    case 'gaussian':
      return gaussBase(sigma)
    case 'laplacian': {
      const b = sigma / Math.SQRT2 // Var = 2b²
      return {
        atom: false,
        cdf: (t) => (t < 0 ? 0.5 * Math.exp(t / b) : 1 - 0.5 * Math.exp(-t / b)),
        pdf: (t) => Math.exp(-Math.abs(t) / b) / (2 * b),
        g1: (v) => {
          if (!Number.isFinite(v)) return 0
          return v < 0 ? 0.5 * (v - b) * Math.exp(v / b) : -0.5 * (v + b) * Math.exp(-v / b)
        },
        g2: (v) => {
          if (v === Infinity) return 2 * b * b
          if (v === -Infinity) return 0
          return v < 0 ? 0.5 * (v * v - 2 * b * v + 2 * b * b) * Math.exp(v / b) : 2 * b * b - 0.5 * (v * v + 2 * b * v + 2 * b * b) * Math.exp(-v / b)
        },
        signMean: (c) => (c >= 0 ? 1 - Math.exp(-c / b) : -(1 - Math.exp(c / b))),
      }
    }
    case 'impulsive': {
      const sb = sigma / Math.sqrt(1 - IMPULSIVE_EPS + IMPULSIVE_EPS * IMPULSIVE_K * IMPULSIVE_K)
      return mixBase([
        { w: 1 - IMPULSIVE_EPS, b: gaussBase(sb) },
        { w: IMPULSIVE_EPS, b: gaussBase(IMPULSIVE_K * sb) },
      ])
    }
    case 'skewed': {
      // v = σ(E − 1)，E ~ Exp(1)：平均 0、標準差 σ、中位數 σ(ln2 − 1) ≈ −0.307σ
      const s = sigma
      const cdf = (t: number) => (t <= -s ? 0 : 1 - Math.exp(-(1 + t / s)))
      return {
        atom: false,
        cdf,
        pdf: (t) => (t < -s ? 0 : Math.exp(-(1 + t / s)) / s),
        g1: (v) => {
          if (v === Infinity || v <= -s) return 0
          const u = 1 + v / s
          return -s * u * Math.exp(-u)
        },
        g2: (v) => {
          if (v === Infinity) return s * s
          if (v <= -s) return 0
          const u = 1 + v / s
          return s * s - s * s * (u * u + 1) * Math.exp(-u)
        },
        signMean: (c) => 1 - 2 * cdf(-c),
      }
    }
  }
}

/** 完整雜訊 v = v_b + B·s（B ~ Bernoulli(p)）的期望值運算子（全部是封閉式，沒有數值積分）。 */
export interface NoiseOps {
  /** P(v ≤ t) */
  cdf(t: number): number
  pdf(t: number): number
  /** E[v]、E[v²] */
  mean: number
  meanSquare: number
  /** E[sign(c + v)] */
  signMean(c: number): number
  /** d/dc E[sign(c + v)] = 2 f(−c)（連續雜訊） */
  signSlope(c: number): number
  /** P(α ≤ v ≤ β)、E[v·1{α≤v≤β}]、E[v²·1{α≤v≤β}] */
  prob(alpha: number, beta: number): number
  pm1(alpha: number, beta: number): number
  pm2(alpha: number, beta: number): number
  /** 是否無連續成分（無雜訊）：sign 演算法變成確定性 limit cycle */
  deterministic: boolean
}

export function noiseOps(n: NoiseDist): NoiseOps {
  const b = baseNoise(n.kind, n.sigma)
  const p = clamp01(n.outlierProb)
  const s = n.outlierSize
  const bProb = (al: number, be: number) => (be < al ? 0 : b.cdf(be) - (b.atom ? leftCdf(b, al) : b.cdf(al)))
  const bPm1 = (al: number, be: number) => (be < al ? 0 : b.g1(be) - b.g1(al))
  const bPm2 = (al: number, be: number) => (be < al ? 0 : b.g2(be) - b.g2(al))
  const baseVar = b.atom ? 0 : n.sigma * n.sigma
  return {
    cdf: (t) => (1 - p) * b.cdf(t) + p * b.cdf(t - s),
    pdf: (t) => (1 - p) * b.pdf(t) + p * b.pdf(t - s),
    mean: p * s,
    meanSquare: baseVar + p * s * s,
    signMean: (c) => (1 - p) * b.signMean(c) + p * b.signMean(c + s),
    signSlope: (c) => (b.atom ? 0 : 2 * ((1 - p) * b.pdf(-c) + p * b.pdf(-c - s))),
    prob: (al, be) => (1 - p) * bProb(al, be) + p * bProb(al - s, be - s),
    pm1: (al, be) => (1 - p) * bPm1(al, be) + p * (bPm1(al - s, be - s) + s * bProb(al - s, be - s)),
    pm2: (al, be) =>
      (1 - p) * bPm2(al, be) + p * (bPm2(al - s, be - s) + 2 * s * bPm1(al - s, be - s) + s * s * bProb(al - s, be - s)),
    deterministic: b.atom,
  }
}

function leftCdf(b: BaseNoise, t: number): number {
  // 點質量在 0：P(v < t)
  return b.atom ? (t > 0 ? 1 : 0) : b.cdf(t)
}

function clamp01(p: number): number {
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0
}

/** 完整雜訊（基本雜訊 + 單邊 outlier 混合）的中位數 m：以二分法求 F_v(m) = ½。 */
export function noiseMedian(n: NoiseDist): number {
  const ops = noiseOps(n)
  if (ops.deterministic && !(n.outlierProb > 0)) return 0
  const scale = Math.max(1e-12, n.sigma + Math.abs(n.outlierSize))
  let lo = -50 * scale
  let hi = 50 * scale
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (ops.cdf(mid) < 0.5) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

// #region core:noiseSampler
/** 抽一個雜訊樣本（標準差皆為 σ）；outlier 由呼叫端另外疊加。 */
export function drawNoise(kind: NoiseKind, sigma: number, rng: Rng): number {
  switch (kind) {
    case 'none':
      return 0
    case 'gaussian':
      return sigma * rng.normal()
    case 'laplacian': {
      const u = rng.uniform() - 0.5 // 反 CDF 法：v = −b·sgn(u)·ln(1 − 2|u|)
      return (-(sigma / Math.SQRT2) * Math.sign(u) * Math.log(Math.max(1 - 2 * Math.abs(u), Number.MIN_VALUE))) || 0
    }
    case 'impulsive': {
      const sb = sigma / Math.sqrt(1 - IMPULSIVE_EPS + IMPULSIVE_EPS * IMPULSIVE_K * IMPULSIVE_K)
      const big = rng.uniform() < IMPULSIVE_EPS // 5% 機率是「突波」
      return (big ? IMPULSIVE_K : 1) * sb * rng.normal()
    }
    case 'skewed':
      return sigma * (-Math.log(1 - rng.uniform()) - 1) // 指數分布減去平均：長尾在正側
  }
}
// #endregion

// ───────────────────────── Regressor 模型 ─────────────────────────

export interface Quadrature {
  nodes: Float64Array
  weights: Float64Array
}

/** x 的期望值節點（離散分布精確；連續分布用 Simpson 積分：均勻分布等距節點，Gaussian 用在 0 附近加密的節點）。 */
export function xQuadrature(d: XDist): Quadrature {
  const A = d.amp
  switch (d.kind) {
    case 'const':
      return { nodes: Float64Array.of(A), weights: Float64Array.of(1) }
    case 'bpsk':
      return { nodes: Float64Array.of(A, -A), weights: Float64Array.of(0.5, 0.5) }
    case 'gauss':
      return gaussQuadrature(A)
    case 'uniformPos':
      return simpson(() => 1, 0.5, 1.5, 200, A)
  }
}

function simpson(f: (t: number) => number, lo: number, hi: number, m: number, scale: number): Quadrature {
  const h = (hi - lo) / m
  const nodes = new Float64Array(m + 1)
  const weights = new Float64Array(m + 1)
  for (let i = 0; i <= m; i++) {
    const t = lo + i * h
    const c = i === 0 || i === m ? 1 : i % 2 ? 4 : 2
    nodes[i] = scale * t
    weights[i] = (c * h * f(t)) / 3
  }
  const tot = weights.reduce((acc, v) => acc + v, 0)
  for (let i = 0; i <= m; i++) weights[i] /= tot // 正規化（Σw = 1）
  return { nodes, weights }
}

/**
 * x ~ N(0, A²) 的積分節點：變數代換 t = L·u³（u ∈ [−1, 1] 等距、Simpson 權重），dt = 3L·u² du。
 * 節點在 0 附近特別密（最小間距約 L·(2/m)³），所以 NLMS 的 x²/(ε + x²)² 這種「寬度 √ε 的尖峰」也積得準：
 * 等距節點在 ε = 10⁻³A² 時 E[x²/(ε + x²)²] 就差 3%、10⁻⁴A² 時差 21%；本節點到 10⁻⁶A² 仍有 10⁻¹¹ 的相對誤差
 *（與 erfcx 封閉式比對，見 sgd.test.ts）。u = 0 是 Simpson 的區段邊界，|x|、sign(x) 的轉折不影響精度。
 */
function gaussQuadrature(A: number, m = 720, L = 9): Quadrature {
  const h = 2 / m
  const nodes = new Float64Array(m + 1)
  const weights = new Float64Array(m + 1)
  let tot = 0
  for (let i = 0; i <= m; i++) {
    const u = -1 + i * h
    const t = L * u * u * u
    const c = i === 0 || i === m ? 1 : i % 2 ? 4 : 2
    nodes[i] = A * t
    weights[i] = ((c * h) / 3) * normPdf(t) * 3 * L * u * u
    tot += weights[i]
  }
  for (let i = 0; i <= m; i++) weights[i] /= tot // 正規化（Σw = 1）
  return { nodes, weights }
}

export interface XMoments {
  m1: number
  m2: number
  m3: number
  m4: number
  mAbs: number
  /** P(x ≠ 0) */
  pNonzero: number
}

export function xMoments(d: XDist): XMoments {
  const A = d.amp
  switch (d.kind) {
    case 'const':
      return { m1: A, m2: A ** 2, m3: A ** 3, m4: A ** 4, mAbs: Math.abs(A), pNonzero: A !== 0 ? 1 : 0 }
    case 'bpsk':
      return { m1: 0, m2: A ** 2, m3: 0, m4: A ** 4, mAbs: Math.abs(A), pNonzero: A !== 0 ? 1 : 0 }
    case 'gauss':
      return { m1: 0, m2: A ** 2, m3: 0, m4: 3 * A ** 4, mAbs: Math.abs(A) * Math.sqrt(2 / Math.PI), pNonzero: A !== 0 ? 1 : 0 }
    case 'uniformPos': {
      const mk = (k: number) => (A ** k * (1.5 ** (k + 1) - 0.5 ** (k + 1))) / (k + 1)
      return { m1: mk(1), m2: mk(2), m3: mk(3), m4: mk(4), mAbs: Math.abs(mk(1)), pNonzero: A !== 0 ? 1 : 0 }
    }
  }
}

export function drawX(d: XDist, rng: Rng): number {
  switch (d.kind) {
    case 'const':
      return d.amp
    case 'bpsk':
      return d.amp * rng.sign()
    case 'gauss':
      return d.amp * rng.normal()
    case 'uniformPos':
      return d.amp * (0.5 + rng.uniform())
  }
}

// ───────────────────────── Mean-field：平均更新方向與固定點 ─────────────────────────

export interface MeanFieldInput {
  a: number
  x: XDist
  noise: NoiseDist
  huberDelta: number
  nlmsEps: number
}

/** 預先建好的期望值運算（同一組輸入重複求很多個 w 時共用）。 */
interface Prepared {
  inp: MeanFieldInput
  q: Quadrature
  m: XMoments
  ops: NoiseOps
}

function prepare(inp: MeanFieldInput): Prepared {
  return { inp, q: xQuadrature(inp.x), m: xMoments(inp.x), ops: noiseOps(inp.noise) }
}

// #region core:meanFieldDrift
/**
 * 平均更新方向 ψ(w)：E[Δw] = μ·ψ(w)。固定點 w* 滿足 ψ(w*) = 0。
 * 令 d = a − w，e = d·x + v（v 與 x 獨立）。各演算法只差在「對 e、x 取了什麼」：
 *   LMS        ψ = E[e·x]           = d·E[x²] + E[v]·E[x]
 *   Sign-Error ψ = E[sign(e)·x]     = E_x[ x·E_v sign(d·x + v) ]
 *   Sign-Sign  ψ = E[sign(e)·sign(x)] = E_x[ sign(x)·E_v sign(d·x + v) ]
 *   Huber      ψ = E[ψ_H(e)·x]（ψ_H = lms.ts 的 huberPsi，門檻 δ_H）
 *   NLMS       ψ = E[e·x/(ε + x²)]
 */
function driftPrepared(algo: AlgoId, w: number, P: Prepared): number {
  const { inp, q, m, ops } = P
  const d = inp.a - w
  switch (algo) {
    case 'lms':
      return d * m.m2 + ops.mean * m.m1 // 線性：只看到 E[v]，看不到雜訊形狀
    case 'nlms':
      return sumX(q, (x) => (x === 0 ? 0 : ((d * x + ops.mean) * x) / (inp.nlmsEps + x * x))) // x = 0 的樣本更新量為 0（ε = 0 時也不除以零）
    case 'sign_error':
      return sumX(q, (x) => x * ops.signMean(d * x)) // ← 差異：只看 e 的正負（看到中位數，不是平均）
    case 'sign_sign':
      return sumX(q, (x) => Math.sign(x) * ops.signMean(d * x)) // ← 差異：連 x 的幅度也丟掉
    case 'huber':
      return sumX(q, (x) => x * huberMean(d * x, inp.huberDelta, ops))
  }
}
// #endregion

function sumX(q: Quadrature, f: (x: number) => number): number {
  let s = 0
  for (let i = 0; i < q.nodes.length; i++) if (q.weights[i] !== 0) s += q.weights[i] * f(q.nodes[i]) // 權重 0 的節點不求值（避免 0·∞）
  return s
}

/** E_v[ψ_H(c + v)]（封閉式：CDF + 部分一階動差）。 */
function huberMean(c: number, delta: number, ops: NoiseOps): number {
  const al = -delta - c
  const be = delta - c
  const inside = c * ops.prob(al, be) + ops.pm1(al, be)
  const above = 1 - ops.cdf(be) // P(c + v > δ)
  const below = ops.prob(-Infinity, al) - ops.prob(al, al) // P(c + v < −δ)
  return inside + delta * above - delta * below
}

/** E_v[ψ_H(c + v)²] */
function huberSecond(c: number, delta: number, ops: NoiseOps): number {
  const al = -delta - c
  const be = delta - c
  const inside = c * c * ops.prob(al, be) + 2 * c * ops.pm1(al, be) + ops.pm2(al, be)
  const outside = 1 - ops.prob(al, be)
  return inside + delta * delta * outside
}

/** ψ(w)（對外 API）。 */
export function meanFieldDrift(algo: AlgoId, w: number, inp: MeanFieldInput): number {
  return driftPrepared(algo, w, prepare(inp))
}

/** −dψ/dw 在 w 的值（線性化 loop gain，每單位步長）。 */
function slopePrepared(algo: AlgoId, w: number, P: Prepared): number {
  const { inp, q, m, ops } = P
  const d = inp.a - w
  switch (algo) {
    case 'lms':
      return m.m2
    case 'nlms':
      return sumX(q, (x) => (x === 0 ? 0 : (x * x) / (inp.nlmsEps + x * x)))
    case 'sign_error':
      return ops.deterministic ? Infinity : sumX(q, (x) => x * x * ops.signSlope(d * x)) // 2E[x² f_v(−d x)]
    case 'sign_sign':
      return ops.deterministic ? Infinity : sumX(q, (x) => Math.abs(x) * ops.signSlope(d * x)) // 2E[|x| f_v(−d x)]
    case 'huber':
      return sumX(q, (x) => x * x * ops.prob(-inp.huberDelta - d * x, inp.huberDelta - d * x))
  }
}

/** E[g²]：單步更新方向的二階動差（σ_η² = E[g²] − ψ²）。 */
function secondMomentPrepared(algo: AlgoId, w: number, P: Prepared): number {
  const { inp, q, m, ops } = P
  const d = inp.a - w
  switch (algo) {
    case 'lms':
      return d * d * m.m4 + 2 * d * ops.mean * m.m3 + ops.meanSquare * m.m2
    case 'nlms':
      // ε = 0 且 x 的機率密度在 0 不為零（Gaussian）：E[v²/x²] = ∞——更新量 μ̃·v/x 是重尾分布，變異數無限大
      if (inp.nlmsEps === 0 && inp.x.kind === 'gauss' && ops.meanSquare > 0) return Infinity
      return sumX(q, (x) => (x === 0 ? 0 : ((d * d * x * x + 2 * d * x * ops.mean + ops.meanSquare) * x * x) / (inp.nlmsEps + x * x) ** 2))
    case 'sign_error':
      return sumX(q, (x) => x * x * (1 - zeroProb(d * x, ops)))
    case 'sign_sign':
      // 連續分布的 x = 0 節點只是積分節點（機率為 0），不可當成「x = 0 的樣本」剔除
      return sumX(q, (x) => (x !== 0 || continuousX(inp.x) ? 1 : 0) * (1 - zeroProb(d * x, ops)))
    case 'huber':
      return sumX(q, (x) => x * x * huberSecond(d * x, inp.huberDelta, ops))
  }
}

function continuousX(d: XDist): boolean {
  return d.kind === 'gauss' || d.kind === 'uniformPos'
}

/** P(c + v = 0)（只有點質量時非零） */
function zeroProb(c: number, ops: NoiseOps): number {
  return ops.deterministic ? ops.prob(-c, -c) : 0
}

export interface AlgoMeanField {
  algo: AlgoId
  /** 固定點 ψ(w*) = 0；NaN 表示不可辨識（例如 x ≡ 0） */
  wStar: number
  /** 線性化斜率 K = −ψ'(w*)（每單位步長）；Infinity 表示無雜訊的 sign 演算法（確定性 limit cycle） */
  K: number
  /** 梯度雜訊變異 σ_η² = E[g²] − ψ(w*)² */
  gradVar: number
  /** ψ''(w*)：給 O(μ) 的穩態平均偏移修正 */
  curvature: number
  identifiable: boolean
  /** 雜訊為點質量（無雜訊） */
  deterministic: boolean
}

/** 以二分法求 ψ(w*) = 0（ψ 對 w 非遞增），並計算 K、σ_η²、ψ''。 */
export function meanFieldAnalysis(algo: AlgoId, inp: MeanFieldInput): AlgoMeanField {
  const P = prepare(inp)
  const psi = (w: number) => driftPrepared(algo, w, P)
  const m = P.m
  const det = P.ops.deterministic
  const empty: AlgoMeanField = { algo, wStar: NaN, K: 0, gradVar: NaN, curvature: NaN, identifiable: false, deterministic: det }
  if (!(m.m2 > 0)) return empty
  const scale = (inp.noise.sigma + Math.abs(inp.noise.outlierSize) + 1) / Math.max(1e-9, Math.min(m.mAbs, Math.sqrt(m.m2)))
  const center = inp.a + (m.m2 > 0 ? (P.ops.mean * m.m1) / m.m2 : 0)
  let R = scale
  let lo = center - R
  let hi = center + R
  let k = 0
  while (!(psi(lo) > 0 && psi(hi) < 0) && k < 80) {
    R *= 2
    lo = center - R
    hi = center + R
    k++
  }
  if (!(psi(lo) > 0 && psi(hi) < 0)) return empty
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    const v = psi(mid)
    if (v > 0) lo = mid
    else if (v < 0) hi = mid
    else {
      lo = hi = mid
      break
    }
    if (hi - lo <= 1e-14 * Math.max(1, Math.abs(mid))) break
  }
  const wStar = 0.5 * (lo + hi)
  const K = slopePrepared(algo, wStar, P)
  const g2 = secondMomentPrepared(algo, wStar, P)
  const ps = psi(wStar)
  const hc = 1e-3 * Math.max(1e-6, inp.noise.sigma > 0 ? inp.noise.sigma : 1) / Math.max(1e-9, m.mAbs)
  const curvature = det ? 0 : (psi(wStar + hc) - 2 * ps + psi(wStar - hc)) / (hc * hc)
  return { algo, wStar, K, gradVar: Math.max(0, g2 - ps * ps), curvature, identifiable: true, deterministic: det }
}

export interface SteadyStatePrediction {
  /** 線性化 loop pole 1 − μK */
  pole: number
  /** 穩態變異 μσ_η²/(K(2 − μK))（LMS 且 E[v]=0 時用精確式 μσ²P_x/(2P_x − μE[x⁴])） */
  variance: number
  std: number
  /** O(μ) 平均偏移 ψ''·Var/(2K) */
  meanShift: number
  /** 時間常數（步）−1/ln|1 − μK| */
  tau: number
  /** 0 < μK < 2 */
  stable: boolean
  /** 公式是否為精確式（LMS iid x、E[v] = 0） */
  exact: boolean
}

// #region core:steadyState
/** 線性化穩態：δ_{n+1} ≈ (1 − μK)δ_n + μη_n ⇒ Var = μ²σ_η²/(1 − (1 − μK)²) = μσ_η²/(K(2 − μK))。 */
export function predictSteadyState(mf: AlgoMeanField, mu: number, inp: MeanFieldInput): SteadyStatePrediction {
  const pole = 1 - mu * mf.K
  const stable = mf.identifiable && mu > 0 && mf.K > 0 && Number.isFinite(mf.K) && Math.abs(pole) < 1
  const tau = stable ? -1 / Math.log(Math.abs(pole)) : Infinity
  if (mf.algo === 'lms' && inp.noise.outlierProb === 0) {
    // 精確式（E42）：iid x、零均值雜訊 ⇒ MSD = μσ²P_x/(2P_x − μE[x⁴])，在 μ ≥ 2P_x/E[x⁴] 時無界
    const m = xMoments(inp.x)
    const s2 = noiseOps(inp.noise).meanSquare
    const den = 2 * m.m2 - mu * m.m4
    const variance = den > 0 && m.m2 > 0 ? (mu * s2 * m.m2) / den : Infinity
    return { pole, variance, std: Math.sqrt(variance), meanShift: 0, tau, stable: stable && den > 0, exact: true }
  }
  if (!stable) return { pole, variance: Infinity, std: Infinity, meanShift: NaN, tau, stable, exact: false }
  const variance = (mu * mf.gradVar) / (mf.K * (2 - mu * mf.K)) // ← 線性化近似（小 μ；sign 類需 μx² ≪ σ_v，即 μK ≪ 1）
  const meanShift = Number.isFinite(variance) ? (mf.curvature * variance) / (2 * mf.K) : 0 // 變異無限大（NLMS、ε = 0、Gaussian x）時不修正
  return { pole, variance, std: Math.sqrt(variance), meanShift, tau, stable, exact: false }
}
// #endregion

/**
 * 同收斂速度（同 K·μ）下，演算法相對 LMS 的穩態變異比 (σ_η²/K²)_algo / (σ_η²/K²)_LMS。
 * 對稱雜訊時 Sign-Error 的比值 = 1/(4 f_v(0)² σ²)：Gaussian π/2、Laplacian 1/2。
 */
export function equalSpeedVarianceRatio(algo: AlgoId, inp: MeanFieldInput): number {
  const a = meanFieldAnalysis(algo, inp)
  const l = meanFieldAnalysis('lms', inp)
  const r = (m: AlgoMeanField) => m.gradVar / (m.K * m.K)
  return r(a) / r(l)
}

// ───────────────────────── 共用資料的多演算法模擬 ─────────────────────────

export interface CaseConfig {
  a: number
  w0: number
  mu: number
  steps: number
  xKind: XKind
  xAmp: number
  noiseKind: NoiseKind
  sigma: number
  outlierProb: number
  outlierSize: number
  tie: TieRule
  schedule: ScheduleKind
  n0: number
  /** 'same-mu'：同一個 μ（NLMS 用 μ̃ = μ·E[x²]）；'same-speed'：調整各演算法步長讓線性化 μK 相同 */
  stepMatch: StepMatch
  huberDelta: number
  nlmsEps: number
}

export function meanFieldInputOf(c: CaseConfig): MeanFieldInput {
  return {
    a: c.a,
    x: { kind: c.xKind, amp: c.xAmp },
    noise: { kind: c.noiseKind, sigma: c.sigma, outlierProb: c.outlierProb, outlierSize: c.outlierSize },
    huberDelta: c.huberDelta,
    nlmsEps: c.nlmsEps,
  }
}

/**
 * 各演算法實際使用的 μ。same-speed 時 μ_algo = μ·K_LMS/K_algo（線性化 pole 相同），
 * 無法線性化（無雜訊 sign 演算法：K = ∞）時退回同一個 μ。
 */
export function algoStepSizes(c: CaseConfig, algos: readonly AlgoId[]): Record<AlgoId, number> {
  const inp = meanFieldInputOf(c)
  const m = xMoments(inp.x)
  const out = {} as Record<AlgoId, number>
  const kL = m.m2
  for (const algo of algos) {
    const base = algo === 'nlms' ? c.mu * m.m2 : c.mu
    if (c.stepMatch === 'same-speed' && algo !== 'lms') {
      const mf = meanFieldAnalysis(algo, inp)
      out[algo] = mf.identifiable && Number.isFinite(mf.K) && mf.K > 0 ? (c.mu * kL) / mf.K : base
    } else out[algo] = base
  }
  return out
}

export interface SharedData {
  x: Float64Array
  y: Float64Array
}

// #region core:sharedData
/** 同一個 seed 產生同一組 (x_n, y_n)，所有演算法都用這組資料（paired comparison）。 */
export function generateData(c: CaseConfig, seed: number): SharedData {
  const rng = createRng(seed)
  const xr = rng.fork('x') // regressor 串流
  const vr = rng.fork('noise') // 量測雜訊串流
  const or = rng.fork('outlier') // 突發干擾串流
  const N = Math.max(0, Math.floor(c.steps))
  const x = new Float64Array(N)
  const y = new Float64Array(N)
  const xd: XDist = { kind: c.xKind, amp: c.xAmp }
  for (let n = 0; n < N; n++) {
    x[n] = drawX(xd, xr)
    let v = drawNoise(c.noiseKind, c.sigma, vr)
    if (or.uniform() < c.outlierProb) v += c.outlierSize // 每步都抽，串流不因 p 改變而錯位
    y[n] = c.a * x[n] + v // y = a·x + v
  }
  return { x, y }
}
// #endregion

type Stepper = (s: NlmsStepInput) => StepOutput

/** 演算法 → 單步更新函式：前四個直接用 lms.ts（頁面顯示的就是這幾段程式碼）。 */
export const STEPPER: Record<AlgoId, Stepper> = {
  lms: STEP.conventional,
  sign_error: STEP.sign_error,
  sign_sign: STEP.sign_sign,
  huber: STEP.huber,
  nlms: nlmsStep,
}

export const DIVERGENCE_LIMIT = 1e12

export interface CompareRunParams extends CaseConfig {
  algos: AlgoId[]
  seed: number
}

export interface CompareRunResult {
  /** 各演算法 w_0…w_N（長度 N+1；發散後為 NaN） */
  w: Partial<Record<AlgoId, Float64Array>>
  mu: Partial<Record<AlgoId, number>>
  diverged: Partial<Record<AlgoId, boolean>>
  x: Float64Array
  y: Float64Array
}

// #region core:runShared
/** 在同一組資料上逐步執行每個演算法；μ_n 由排程決定，sign(0) 由 tie 慣例決定。 */
export function runShared(p: CompareRunParams, data: SharedData = generateData(p, p.seed), mus = algoStepSizes(p, p.algos)): CompareRunResult {
  const N = data.x.length
  const sched: Schedule = { kind: p.schedule, n0: p.n0 }
  const out: CompareRunResult = { w: {}, mu: {}, diverged: {}, x: data.x, y: data.y }
  for (const algo of p.algos) {
    const step = STEPPER[algo]
    const w = new Float64Array(N + 1)
    w[0] = p.w0
    let diverged = false
    for (let n = 0; n < N; n++) {
      const mu = stepSize(mus[algo], n, sched) // 第 n 步的步長
      w[n + 1] = step({ w: w[n], x: data.x[n], y: data.y[n], mu, tie: p.tie, huberDelta: p.huberDelta, eps: p.nlmsEps }).w
      if (!Number.isFinite(w[n + 1]) || Math.abs(w[n + 1]) > DIVERGENCE_LIMIT) {
        diverged = true
        w.fill(NaN, n + 1)
        break
      }
    }
    out.w[algo] = w
    out.mu[algo] = mus[algo]
    out.diverged[algo] = diverged
  }
  return out
}
// #endregion

export interface CompareMcParams extends CompareRunParams {
  /** Monte Carlo 次數（seed r = 0 為 p.seed 本身，其餘為 deriveSeed(seed, r)） */
  runs: number
  /** |δ_n| 分位數的取樣點數（對數間隔） */
  checkpoints?: number
}

export interface AlgoMcStats {
  algo: AlgoId
  mu: number
  /** 未發散的 run 數 */
  n: number
  diverged: number
  /** 最終 w_N 的 ensemble 平均、標準差、95% CI 半寬 */
  finalMean: number
  finalStd: number
  finalHalf: number
  /** 每條路徑後半段時間平均的 ensemble 平均與 95% CI 半寬、SE */
  tavgMean: number
  tavgHalf: number
  tavgSe: number
  /** 穩態標準差：後半段所有 (run, n) 相對 ensemble 平均的標準差（不先扣各 run 自己的平均，避免低估） */
  tavgStd: number
  /** 後半段 E[(a − w)²]（MSD） */
  msd: number
  /**
   * 穩態診斷：每條路徑「第 4 個四分之一段的平均 − 第 3 個四分之一段的平均」的 ensemble 平均與 SE。
   * 若顯著不為 0，表示後半段仍在漂移（尚未收斂或步長衰減太快），時間平均不能拿來和 w* 比較。
   */
  driftMean: number
  driftSe: number
  /** 檢查點上的 |δ_n| = |a − w_n| 中位數與 10% / 90% 分位數 */
  absDeltaMedian: Float64Array
  absDeltaQ10: Float64Array
  absDeltaQ90: Float64Array
}

export interface CompareMcResult {
  checkpoints: Float64Array
  stats: AlgoMcStats[]
  runs: number
  steps: number
}

/** 0…N 之間大約 count 個對數間隔的整數索引（含 0 與 N）。 */
export function logCheckpoints(N: number, count = 120): Float64Array {
  const set = new Set<number>([0, N])
  for (let i = 0; i < count; i++) set.add(Math.min(N, Math.round(Math.expm1((i / (count - 1)) * Math.log1p(N)))))
  return Float64Array.from([...set].sort((p, q) => p - q))
}

export function runSeed(seed: number, r: number): number {
  return r === 0 ? seed >>> 0 : deriveSeed(seed, r)
}

// #region core:monteCarlo
/** 對 runs 個 seed 重複 runShared，統計最終 bias / std、時間平均與 |δ_n| 分位數（給 Worker 執行）。 */
export function monteCarloCompare(p: CompareMcParams): CompareMcResult {
  const runs = Math.max(1, Math.floor(p.runs))
  const N = Math.max(1, Math.floor(p.steps))
  const cps = logCheckpoints(N, p.checkpoints ?? 120)
  const mus = algoStepSizes(p, p.algos) // 只算一次 mean-field
  const half = Math.floor(N / 2)
  const q3 = Math.floor((3 * N) / 4)
  const acc = p.algos.map(() => ({
    fin: [] as number[],
    drift: [] as number[],
    tavg: [] as number[],
    var: [] as number[],
    msd: [] as number[],
    div: 0,
    abs: Array.from(cps, () => [] as number[]),
  }))
  for (let r = 0; r < runs; r++) {
    const res = runShared({ ...p, steps: N }, generateData({ ...p, steps: N }, runSeed(p.seed, r)), mus)
    p.algos.forEach((algo, k) => {
      const w = res.w[algo]!
      const A = acc[k]
      if (res.diverged[algo]) {
        A.div++
        return
      }
      A.fin.push(w[N])
      let s = 0
      let s2 = 0
      let m2 = 0
      let s3 = 0
      for (let n = half; n <= N; n++) {
        s += w[n]
        s2 += w[n] * w[n]
        m2 += (p.a - w[n]) ** 2
        if (n < q3) s3 += w[n]
      }
      const n3 = q3 - half
      const n4 = N - q3 + 1
      if (n3 > 0) A.drift.push((s - s3) / n4 - s3 / n3) // 第 4 段平均 − 第 3 段平均
      const cnt = N - half + 1
      const mean = s / cnt
      A.tavg.push(mean)
      A.var.push(s2 / cnt) // 後半段 E[w²]（之後扣掉 ensemble 平均的平方）
      A.msd.push(m2 / cnt)
      cps.forEach((c, j) => A.abs[j].push(Math.abs(p.a - w[c])))
    })
  }
  const stats = p.algos.map((algo, k): AlgoMcStats => {
    const A = acc[k]
    const fin = A.fin.length >= 2 ? meanCI(A.fin) : null
    const tav = A.tavg.length >= 2 ? meanCI(A.tavg) : null
    const dr = A.drift.length >= 2 ? meanCI(A.drift) : null
    const q = (j: number, qq: number) => (A.abs[j].length ? quantile(A.abs[j], qq) : NaN)
    return {
      algo,
      mu: mus[algo],
      n: A.fin.length,
      diverged: A.div,
      finalMean: fin ? fin.mean : A.fin[0] ?? NaN,
      finalStd: fin ? fin.se * Math.sqrt(fin.n) : 0,
      finalHalf: fin ? fin.halfWidth : NaN,
      tavgMean: tav ? tav.mean : A.tavg[0] ?? NaN,
      tavgHalf: tav ? tav.halfWidth : NaN,
      tavgSe: tav ? tav.se : NaN,
      tavgStd: A.var.length ? Math.sqrt(Math.max(0, avg(A.var) - avg(A.tavg) ** 2)) : NaN,
      msd: A.msd.length ? A.msd.reduce((x, y) => x + y, 0) / A.msd.length : NaN,
      driftMean: dr ? dr.mean : A.drift[0] ?? NaN,
      driftSe: dr ? dr.se : NaN,
      absDeltaMedian: Float64Array.from(cps, (_, j) => q(j, 0.5)),
      absDeltaQ10: Float64Array.from(cps, (_, j) => q(j, 0.1)),
      absDeltaQ90: Float64Array.from(cps, (_, j) => q(j, 0.9)),
    }
  })
  return { checkpoints: cps, stats, runs, steps: N }
}
// #endregion

function avg(v: number[]): number {
  return v.reduce((x, y) => x + y, 0) / v.length
}

/** 多個 case 一次送進 Worker（每個 case 自己的參數、同一個 seed）。 */
export function monteCarloCompareCases(p: { cases: CompareMcParams[] }): CompareMcResult[] {
  return p.cases.map((c) => monteCarloCompare(c))
}

// ───────────────────────── 比值觀點：批次固定點 ─────────────────────────

export interface RatioFixedPoints {
  /** LMS：Σxy/Σx²（x² 加權的 y/x 平均） */
  lms: number
  /** Sign-Error：|x| 加權的 y/x 中位數（可能是區間） */
  signError: [number, number]
  /** Sign-Sign：不加權的 y/x 中位數（x = 0 的樣本不提供資訊） */
  signSign: [number, number]
  /** NLMS（ε = 0）：不加權的 y/x 平均 */
  nlms: number
}

/** 加權中位數：使 Σ w_i|r_i − m| 最小的 m（若剛好平分，回傳整段區間）。 */
export function weightedMedian(values: ArrayLike<number>, weights: ArrayLike<number>): [number, number] {
  const idx = Array.from({ length: values.length }, (_, i) => i).filter((i) => weights[i] > 0)
  if (!idx.length) return [NaN, NaN]
  idx.sort((i, j) => values[i] - values[j])
  const W = idx.reduce((s, i) => s + weights[i], 0)
  let cum = 0
  for (let k = 0; k < idx.length; k++) {
    cum += weights[idx[k]]
    const rel = cum - W / 2
    if (Math.abs(rel) <= 1e-12 * W && k + 1 < idx.length) return [values[idx[k]], values[idx[k + 1]]]
    if (rel > 0) return [values[idx[k]], values[idx[k]]]
  }
  const last = values[idx[idx.length - 1]]
  return [last, last]
}

// #region core:ratioView
/**
 * 純量時，四種演算法的（批次）固定點都是比值 r_i = y_i/x_i 的「加權位置估計」：
 *   LMS：Σ x²·r / Σ x²（加權平均）   Sign-Error：|x| 加權中位數
 *   NLMS(ε=0)：r 的平均               Sign-Sign：r 的中位數
 */
export function ratioFixedPoints(xs: ArrayLike<number>, ys: ArrayLike<number>): RatioFixedPoints {
  const r: number[] = []
  const wAbs: number[] = []
  const wOne: number[] = []
  let sxy = 0
  let sxx = 0
  let rSum = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += xs[i] * ys[i]
    sxx += xs[i] * xs[i]
    if (xs[i] === 0) continue // x = 0 的樣本沒有 a 的資訊
    r.push(ys[i] / xs[i])
    wAbs.push(Math.abs(xs[i])) // ← 差異：Sign-Error 以 |x| 加權
    wOne.push(1) // ← 差異：Sign-Sign 每筆同權
    rSum += ys[i] / xs[i]
  }
  return {
    lms: sxx > 0 ? sxy / sxx : NaN,
    signError: weightedMedian(r, wAbs),
    signSign: weightedMedian(r, wOne),
    nlms: r.length ? rSum / r.length : NaN,
  }
}
// #endregion

/** Mean-field ψ(w) 曲線（給「固定點 = 零交越」圖）。 */
export function driftCurve(algo: AlgoId, inp: MeanFieldInput, wLo: number, wHi: number, n = 241): { w: Float64Array; psi: Float64Array } {
  const P = prepare(inp)
  const w = new Float64Array(n)
  const psi = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = wLo + ((wHi - wLo) * i) / (n - 1)
    psi[i] = driftPrepared(algo, w[i], P)
  }
  return { w, psi }
}

/** 雜訊在中位數 m 的 PDF f_v(m)（Sign-Error 的線性化增益 K = 2f_v(m)E[x²] 用得到）。 */
export function noisePdfAt(n: NoiseDist, t: number): number {
  return noiseOps(n).pdf(t)
}

/** 便利：所有演算法的 mean-field 結果。 */
export function meanFieldAll(inp: MeanFieldInput, algos: readonly AlgoId[] = ALGO_IDS): Record<AlgoId, AlgoMeanField> {
  const out = {} as Record<AlgoId, AlgoMeanField>
  for (const a of algos) out[a] = meanFieldAnalysis(a, inp)
  return out
}
