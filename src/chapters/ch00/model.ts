/**
 * Ch00 入門課的純計算函式（規格 §1、§1.1、§1.2、§3 的入門版；模型層級 L0）。
 *
 * - 不 import React / DOM：可直接在測試或 Worker 中呼叫。
 * - 頁面上的每個表格、每條曲線都由這裡（以及共用的 `@/simulation/models/lms`）即時算出；
 *   頁面以 `?raw` + `#region core:*` 直接顯示這些原始碼（docs/teaching-style.md §4）。
 *
 * 全站約定：
 *   y = a·x + v，ŷ = w·x，e = y − ŷ
 *   δ = a − w（勘誤 E39：規格 §3 原寫 w − a；遞迴相同，但數值正負相反）
 *   單筆成本 j = ½e²，平均成本 J(w) = ½E[(y − wx)²]（勘誤 E41：加 ½ 才與更新量 μex 同 scaling）
 *   sign(0) 的慣例必須明定（勘誤 E40）
 */

import { createRng, normCdf } from '@/simulation/core'
import {
  classifyPole,
  conventionalStep,
  fixedXPole,
  lossValue,
  runScalarLms,
  type PoleBehaviour,
  type TieRule,
} from '@/simulation/models/lms'

// ───────────────────────── §0.1 黑盒子資料 ─────────────────────────

/** 一筆觀測 (x, y)。 */
export type Sample = readonly [x: number, y: number]

/** 乾淨資料：y = 3x（輸入資料，不是計算結果）。 */
export const CLEAN_DATA: readonly Sample[] = [
  [1, 3],
  [2, 6],
  [4, 12],
]

/** 含雜訊資料：y = 3x + v（輸入資料；ChatGPT 入門課第 1 課的例子）。 */
export const NOISY_DATA: readonly Sample[] = [
  [1, 3.2],
  [2, 5.7],
  [4, 12.5],
]

/** 每一筆單獨猜 a 的結果 y/x（x = 0 時沒有資訊，回傳 NaN）。 */
export function ratioTable(data: readonly Sample[]): { x: number; y: number; ratio: number }[] {
  return data.map(([x, y]) => ({ x, y, ratio: x === 0 ? Number.NaN : y / x }))
}

// #region core:leastSquares
/**
 * 批次最小平方（全部資料一次算）：min_w Σ(y_i − w·x_i)² ⇒ w* = Σx_i·y_i / Σx_i²。
 * Σx_i² = 0（所有 x 都是 0）時不可辨識，回傳 NaN。
 */
export function leastSquaresGain(data: readonly Sample[]): { sxy: number; sxx: number; w: number } {
  let sxy = 0
  let sxx = 0
  for (const [x, y] of data) {
    sxy += x * y // Σ x·y
    sxx += x * x // Σ x²
  }
  return { sxy, sxx, w: sxx === 0 ? Number.NaN : sxy / sxx }
}
// #endregion

/**
 * 把同一組資料一筆一筆、一輪一輪餵給 LMS（每一步都呼叫 lms.ts 的 conventionalStep）。
 * 回傳每一輪（epoch）結束時的 w。固定 μ 時 w 會在最小平方解附近小幅擺動（不是精確收斂）。
 */
export function lmsOnData(data: readonly Sample[], w0: number, mu: number, epochs: number): number[] {
  const out = [w0]
  let w = w0
  for (let k = 0; k < epochs; k++) {
    for (const [x, y] of data) w = conventionalStep({ w, x, y, mu }).w
    out.push(w)
  }
  return out
}

// ───────────────────────── §0.4 手算表（T01） ─────────────────────────

export interface HandCalcParams {
  /** 真實參數 a（黑盒子內部） */
  a: number
  w0: number
  x: number
  mu: number
  steps: number
}

export interface HandCalcRow {
  n: number
  /** 更新前的 w_n */
  w: number
  x: number
  /** y_n = a·x（無雜訊） */
  y: number
  /** 預測 ŷ_n = w_n·x */
  yhat: number
  /** 誤差 e_n = y_n − ŷ_n */
  e: number
  /** 更新量 Δw_n = μ·e_n·x */
  dw: number
  /** 更新後的 w_{n+1} */
  wNext: number
  /** 參數誤差 δ_n = a − w_n（勘誤 E39） */
  delta: number
  deltaNext: number
  /** δ_{n+1}/δ_n（δ_n = 0 時為 NaN） */
  ratio: number
}

// #region core:handCalc
/** 手算表：每一列都直接呼叫 lms.ts 的 conventionalStep（無雜訊、固定 x，y = a·x）。 */
export function handCalcRows({ a, w0, x, mu, steps }: HandCalcParams): HandCalcRow[] {
  const rows: HandCalcRow[] = []
  let w = w0
  for (let n = 0; n < steps; n++) {
    const y = a * x // 黑盒子的真實輸出（無雜訊）
    const { e, dw, w: wNext } = conventionalStep({ w, x, y, mu }) // 預測 → 比較 → 修正
    const delta = a - w // 參數誤差，全站極性 δ = a − w（勘誤 E39）
    const deltaNext = a - wNext
    const ratio = delta === 0 ? Number.NaN : deltaNext / delta // δ_{n+1}/δ_n
    rows.push({ n, w, x, y, yhat: w * x, e, dw, wNext, delta, deltaNext, ratio })
    w = wNext
  }
  return rows
}
// #endregion

/** 封閉解 w_n = a − (a − w_0)·pⁿ，p = 1 − μx²（無雜訊、固定 x）。 */
export function closedFormW(a: number, w0: number, x: number, mu: number, n: number): number {
  return a - (a - w0) * Math.pow(fixedXPole(mu, x), n)
}

// ───────────────────────── 精確有理數（Research：T01 的 9/5、57/25） ─────────────────────────

/** 最簡分數 num/den（den > 0）。 */
export interface Fraction {
  num: bigint
  den: bigint
}

function bigAbs(v: bigint): bigint {
  return v < 0n ? -v : v
}

function gcd(a: bigint, b: bigint): bigint {
  let x = bigAbs(a)
  let y = bigAbs(b)
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x === 0n ? 1n : x
}

export function makeFraction(num: bigint, den: bigint): Fraction {
  if (den === 0n) throw new Error('分母為 0')
  const s = den < 0n ? -1n : 1n
  const g = gcd(num, den)
  return { num: (s * num) / g, den: (s * den) / g }
}

/**
 * 十進位字面值 → 精確分數（例如 0.1 → 1/10，而不是 IEEE double 0.1000000000000000055…）。
 * 支援 '1e-5' 這種指數寫法；非有限值丟出錯誤。
 */
export function decimalToFraction(v: number | string): Fraction {
  const s = typeof v === 'number' ? String(v) : v.trim()
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`無法轉成分數：${s}`)
  const sign = m[1] === '-' ? -1n : 1n
  const intPart = m[2] || '0'
  const fracPart = m[3] ?? ''
  const exp = Number(m[4] ?? 0) - fracPart.length
  let num = sign * BigInt(intPart + fracPart)
  let den = 1n
  if (exp >= 0) num *= 10n ** BigInt(exp)
  else den = 10n ** BigInt(-exp)
  return makeFraction(num, den)
}

const fAdd = (p: Fraction, q: Fraction) => makeFraction(p.num * q.den + q.num * p.den, p.den * q.den)
const fSub = (p: Fraction, q: Fraction) => makeFraction(p.num * q.den - q.num * p.den, p.den * q.den)
const fMul = (p: Fraction, q: Fraction) => makeFraction(p.num * q.num, p.den * q.den)

export function fractionToString(f: Fraction): string {
  return f.den === 1n ? String(f.num) : `${f.num}/${f.den}`
}

/** 分數轉 double（只用於比較；兩個 BigInt 先各自轉成 double 再除，相對誤差 ~1e-16）。 */
export function fractionToNumber(f: Fraction): number {
  return Number(f.num) / Number(f.den)
}

/**
 * IEEE double → 精確分數。每個有限 double 都是二進位有理數 m·2^e（m 為 53-bit 整數），
 * 所以可以零誤差地轉成分數，用來量「double 的結果和精確有理數到底差多少」。
 */
export function doubleToFraction(x: number): Fraction {
  if (!Number.isFinite(x)) throw new Error(`非有限值無法轉成分數：${x}`)
  if (x === 0) return { num: 0n, den: 1n }
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const bits = view.getBigUint64(0)
  const sign = bits >> 63n === 1n ? -1n : 1n
  const expBits = Number((bits >> 52n) & 0x7ffn)
  const frac = bits & ((1n << 52n) - 1n)
  const mant = expBits === 0 ? frac : frac | (1n << 52n) // 次正規數沒有隱藏位元
  const e = (expBits === 0 ? 1 : expBits) - 1075 // x = mant·2^e
  return e >= 0 ? makeFraction(sign * mant * (1n << BigInt(e)), 1n) : makeFraction(sign * mant, 1n << BigInt(-e))
}

/** 精確計算 double x 與分數 f 的差 x − f（先轉成分數再相減，最後才轉回 double 顯示）。 */
export function doubleMinusExact(x: number, f: Fraction): number {
  return fractionToNumber(fSub(doubleToFraction(x), f))
}

/** x 所在 binade 的 ulp（unit in the last place）：|x| ∈ [2^k, 2^{k+1}) 時為 2^{k−52}。 */
export function ulpOf(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return Number.NaN
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const expBits = (view.getUint16(0) >> 4) & 0x7ff // 直接讀指數位元，避免 log2 在 2 的冪附近的捨入
  return Math.pow(2, (expBits === 0 ? 1 : expBits) - 1075)
}

// #region core:exactTrace
/** 以精確有理數重算 w_{n+1} = w_n + μ(a·x − w_n·x)·x；回傳 w_0 … w_steps。 */
export function exactLmsTrace(p: { a: number; w0: number; x: number; mu: number; steps: number }): Fraction[] {
  const a = decimalToFraction(p.a)
  const x = decimalToFraction(p.x)
  const mu = decimalToFraction(p.mu)
  const out = [decimalToFraction(p.w0)]
  for (let n = 0; n < p.steps; n++) {
    const w = out[n]
    const e = fSub(fMul(a, x), fMul(w, x)) // e_n = a·x − w_n·x（精確）
    out.push(fAdd(w, fMul(fMul(mu, e), x))) // w_{n+1} = w_n + μ·e_n·x（精確）
  }
  return out
}
// #endregion

// ───────────────────────── §0.6 梯度（勘誤 E41 的 ½） ─────────────────────────

// #region core:gradient
/** 單筆成本 j(w) = ½e²，e = y − w·x（lms.ts 的 lossValue('mse') 就是 ½e²，勘誤 E41）。 */
export function sampleCost(w: number, x: number, y: number): number {
  return lossValue('mse', y - w * x)
}

/** 解析梯度 dj/dw = −e·x（chain rule）。 */
export function analyticGradient(w: number, x: number, y: number): number {
  const e = y - w * x
  return -e * x
}

/** 中央差分 [j(w+h) − j(w−h)]/(2h)：二次函數時與解析梯度只差浮點誤差。 */
export function centralDifference(w: number, x: number, y: number, h = 1e-3): number {
  return (sampleCost(w + h, x, y) - sampleCost(w - h, x, y)) / (2 * h)
}
// #endregion

/** 取樣 j(w) = ½(y − wx)² 的曲線（給 Cost Curve 圖用）。 */
export function costCurve(x: number, y: number, wMin: number, wMax: number, points = 161): { w: number[]; j: number[] } {
  const w: number[] = []
  const j: number[] = []
  for (let i = 0; i < points; i++) {
    const wi = wMin + ((wMax - wMin) * i) / (points - 1)
    w.push(wi)
    j.push(sampleCost(wi, x, y))
  }
  return { w, j }
}

/** 平均成本 J(w) = ½E[(y − wx)²] = ½[(a − w)²x² + σ_v²]（固定 x、零均值雜訊；勘誤 E41 的 ½）。 */
export function expectedCost(a: number, w: number, x: number, sigmaV: number): number {
  return 0.5 * ((a - w) * (a - w) * x * x + sigmaV * sigmaV)
}

// ───────────────────────── §0.6 Pole 與穩定性 ─────────────────────────

/**
 * |δ_n| 第一次 ≤ frac·|δ_0| 所需步數：n = ⌈ln(frac)/ln|p|⌉。
 * p = 0 → 1 步；|p| ≥ 1 → Infinity（不會縮小）。
 */
export function stepsToFraction(p: number, frac = 0.01): number {
  const ap = Math.abs(p)
  if (ap === 0) return 1
  if (ap >= 1) return Number.POSITIVE_INFINITY
  return Math.ceil(Math.log(frac) / Math.log(ap) - 1e-12)
}

export interface PoleRow {
  mu: number
  p: number
  behaviour: PoleBehaviour
  /** |δ| 降到 1% 所需步數 */
  n1pct: number
}

/** 給定 x，對一串 μ 計算 pole p = 1 − μx² 與分類（lms.ts 的 fixedXPole / classifyPole）。 */
export function poleTable(x: number, mus: readonly number[]): PoleRow[] {
  return mus.map((mu) => {
    const p = fixedXPole(mu, x)
    return { mu, p, behaviour: classifyPole(p), n1pct: stepsToFraction(p) }
  })
}

// #region core:steadyStateVar
/**
 * 固定 x、iid 零均值雜訊 v（變異數 σ_v²）時，w 的穩態變異數：
 *   δ_{n+1} = p·δ_n − μ·x·v_n  ⇒  Var(w_∞) = μ²x²σ_v²/(1 − p²) = μσ_v²/(2 − μx²)
 * 只在 |p| < 1 時存在；否則回傳 Infinity（x = 0 時 p = 1，w 永遠不動，回傳 0）。
 */
export function steadyStateVarW(mu: number, x: number, sigmaV: number): number {
  const p = fixedXPole(mu, x)
  if (x === 0 || mu === 0) return 0
  if (Math.abs(p) >= 1) return Number.POSITIVE_INFINITY
  return (mu * mu * x * x * sigmaV * sigmaV) / (1 - p * p)
}
// #endregion

/**
 * §0.7 穩態抖動的數值例：與 preset `intro-noisy` 同一組參數（x、σ_v、三個 μ），
 * 讓讀者在 Playground 載入 preset 後看到的數字和內文完全一樣（model.test.ts 檢查兩者一致）。
 */
export const STEADY_STATE_EXAMPLE = { presetId: 'intro-noisy', x: 2, sigmaV: 0.5, mus: [0.01, 0.05, 0.2] }

// #region core:equivalentAveraging
/**
 * LMS 的「等效平均長度」：穩態時 w 的抖動，等於把幾筆獨立量測直接平均？
 *   直接平均 N 筆 y_i/x = a + v_i/x  ⇒  Var = σ_v²/(N·x²)
 *   LMS 穩態                         ⇒  Var = μσ_v²/(2 − μx²)
 * 令兩者相等：N_eq = (2 − μx²)/(μx²) = 2/(μx²) − 1 = (1 + p)/(1 − p)。
 * p = 0（μ = 1/x²，一步到位）時 N_eq = 1：w_{n+1} = y_n/x，剛好只用最新的一筆。
 * 只在 0 < μ < 2/x² 有意義，否則回傳 NaN。
 */
export function equivalentAveragingLength(mu: number, x: number): number {
  const g = mu * x * x // μx² = 1 − p
  if (!(g > 0 && g < 2)) return Number.NaN
  return (2 - g) / g
}
// #endregion

// ───────────────────────── §0.7 雜訊平均（1/√N） ─────────────────────────

export type RegressorKind = 'gaussian' | 'pm_one'

export const REGRESSOR_LABEL: Record<RegressorKind, string> = {
  gaussian: 'Gaussian x ~ N(0, 1)',
  pm_one: '±1 碼（BPSK / 1-bit code）',
}

/** 兩種 regressor 的 E[x²]、E[x⁴]（單位變異數）。 */
export function regressorMoments(kind: RegressorKind): { ex2: number; ex4: number } {
  return kind === 'gaussian' ? { ex2: 1, ex4: 3 } : { ex2: 1, ex4: 1 }
}

// #region core:productMoments
/**
 * 固定 w 時單筆乘積 z = e·x 的平均與變異數（v 與 x 獨立、E[v] = 0、Var(v) = σ_v²）：
 *   e = (a − w)x + v = δ·x + v
 *   E[z]   = δ·E[x²]                                 ← 雜訊項 E[v·x] = E[v]E[x] = 0
 *   Var(z) = δ²·(E[x⁴] − E[x²]²) + σ_v²·E[x²]       ← 交叉項 E[x³v] = 0
 * 這一版直接吃 E[x²]、E[x⁴]（任何分布都適用；「帶入手算」HC-00.5 用它）。
 */
export function productMomentsFromMoments(delta: number, sigmaV: number, ex2: number, ex4: number): { mean: number; variance: number } {
  return { mean: delta * ex2, variance: delta * delta * (ex4 - ex2 * ex2) + sigmaV * sigmaV * ex2 }
}

/** 同上，但由 regressor 的種類（Gaussian／±1 碼）查出 E[x²]、E[x⁴]。 */
export function productMoments(a: number, w: number, sigmaV: number, kind: RegressorKind): { mean: number; variance: number } {
  const { ex2, ex4 } = regressorMoments(kind)
  return productMomentsFromMoments(a - w, sigmaV, ex2, ex4) // δ = a − w（勘誤 E39）
}
// #endregion

// #region core:averagingLaw
/** 1/√N 法則（F-00.8）：N 筆 iid 的量取平均，標準差由單筆的 s₁ 降為 s₁/√N。 */
export function averagedStd(s1: number, n: number): number {
  return s1 / Math.sqrt(n)
}

/**
 * 反過來問：要讓 N 筆平均的標準差 ≤ target，至少要幾筆？ s₁/√N ≤ target ⇒ N ≥ (s₁/target)²，取上整。
 * 取上整前先縮小 16 ε（ε = 2⁻⁵²，相對 3.6e-15），避免浮點捨入（例如 double 的 (√2/0.1)² = 200.00000000000003）多算一筆。
 * 這個保護量必須是「相對於 double 解析度」的：若寫成固定的相對 1e-9，(s₁/target)² 上億時會少算好幾筆。
 * s₁ = 0（沒有隨機性）時一筆就夠；target ≤ 0 不可能達成，回傳 Infinity。
 */
export function samplesForTargetStd(s1: number, target: number): number {
  if (!(target > 0)) return Number.POSITIVE_INFINITY
  const r = (s1 / target) ** 2 // (s₁/target)²
  return Math.max(1, Math.ceil(r * (1 - 16 * Number.EPSILON)))
}
// #endregion

export interface NoiseAverageParams {
  /** 真實參數 a */
  a: number
  /** 目前（固定）的猜測 w */
  w: number
  sigmaV: number
  xKind: RegressorKind
  /** 獨立試驗次數 M */
  trials: number
  /** 最長平均長度 N_max（檢查點為 1, 2, 4, …, N_max） */
  nMax: number
  seed: number
  /** 要回傳幾條 running average 軌跡（畫圖用） */
  traces?: number
}

export interface NoiseAverageResult {
  /** 檢查點 N = 1, 2, 4, …, N_max */
  checkpoints: number[]
  /** 每個 N：M 個試驗的 N 筆平均 Ḡ_N 的樣本平均、樣本標準差、樣本 kurtosis */
  mcMean: number[]
  mcStd: number[]
  mcKurtosis: number[]
  /** 每個 N：sign(Ḡ_N) 與 sign(E[z]) 一致的比例（E[z] = 0 時為 NaN） */
  mcCorrect: number[]
  /** 理論平均 E[z] = (a − w)E[x²] */
  theoryMean: number
  /** 單筆標準差 s₁ = √Var(z) */
  s1: number
  /** 理論標準差 s₁/√N */
  theoryStd: number[]
  /** CLT 近似 P(sign 正確) = Φ(√N·|E[z]|/s₁) */
  cltCorrect: number[]
  /** 前幾個試驗的 running average（在每個 n = 1…N_max 取樣，長度 N_max） */
  traces: Float64Array[]
  /** 實際抽樣的總樣本數 M·N_max */
  totalSamples: number
}

/** 2 的冪次檢查點 1, 2, 4, …（含 nMax 本身）。 */
export function powerOfTwoCheckpoints(nMax: number): number[] {
  const out: number[] = []
  for (let n = 1; n < nMax; n *= 2) out.push(n)
  out.push(nMax)
  return [...new Set(out)]
}

// #region core:noiseAverage
/**
 * 小型 Monte Carlo：固定 w，量測 M 次「N 筆 e·x 的平均」，看它的分散程度是否 ∝ 1/√N。
 * 每次試驗用同一條亂數序列的前 N 筆（running average），所以不同 N 之間是巢狀的。
 */
export function simulateNoiseAverage(p: NoiseAverageParams): NoiseAverageResult {
  const rng = createRng(p.seed)
  const xr = rng.fork('x') // regressor 亂數
  const vr = rng.fork('noise') // 量測雜訊 v 的亂數
  const checkpoints = powerOfTwoCheckpoints(p.nMax)
  const K = checkpoints.length
  const avg = Array.from({ length: K }, () => new Float64Array(p.trials)) // avg[k][t] = Ḡ_N（第 t 次試驗）
  const nTraces = Math.min(p.traces ?? 6, p.trials)
  const traces: Float64Array[] = []
  for (let t = 0; t < p.trials; t++) {
    const tr = t < nTraces ? new Float64Array(p.nMax) : null
    let s = 0 // Σ e·x
    let k = 0
    for (let n = 1; n <= p.nMax; n++) {
      const x = p.xKind === 'gaussian' ? xr.normal() : xr.sign() // 第 n 筆輸入
      const y = p.a * x + p.sigmaV * vr.normal() // 黑盒子輸出 y = a·x + v
      const e = y - p.w * x // 誤差（w 固定不更新）
      s += e * x // GMAC 式的相關累加
      if (tr) tr[n - 1] = s / n
      if (n === checkpoints[k]) avg[k++][t] = s / n // 記錄 N 筆平均
    }
    if (tr) traces.push(tr)
  }
  const { mean: theoryMean, variance } = productMoments(p.a, p.w, p.sigmaV, p.xKind)
  const s1 = Math.sqrt(variance)
  const mcMean: number[] = []
  const mcStd: number[] = []
  const mcKurtosis: number[] = []
  const mcCorrect: number[] = []
  for (let k = 0; k < K; k++) {
    const m = sampleMoments(avg[k])
    mcMean.push(m.mean)
    mcStd.push(m.std)
    mcKurtosis.push(m.kurtosis)
    if (theoryMean === 0) mcCorrect.push(Number.NaN)
    else {
      let ok = 0
      for (let t = 0; t < p.trials; t++) if (Math.sign(avg[k][t]) === Math.sign(theoryMean)) ok++
      mcCorrect.push(ok / p.trials)
    }
  }
  const theoryStd = checkpoints.map((n) => averagedStd(s1, n)) // 1/√N 法則
  const cltCorrect = checkpoints.map((n) =>
    theoryMean === 0 ? Number.NaN : s1 === 0 ? 1 : normCdf((Math.sqrt(n) * Math.abs(theoryMean)) / s1),
  )
  return { checkpoints, mcMean, mcStd, mcKurtosis, mcCorrect, theoryMean, s1, theoryStd, cltCorrect, traces, totalSamples: p.trials * p.nMax }
}
// #endregion

/** 樣本平均、樣本標準差（ddof = 1）與樣本 kurtosis（E[(X−m)⁴]/s⁴，非 excess）。 */
export function sampleMoments(x: ArrayLike<number>): { mean: number; std: number; kurtosis: number } {
  const n = x.length
  if (n < 2) return { mean: n ? x[0] : Number.NaN, std: Number.NaN, kurtosis: Number.NaN }
  let m = 0
  for (let i = 0; i < n; i++) m += x[i]
  m /= n
  let m2 = 0
  let m4 = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - m
    const d2 = d * d
    m2 += d2
    m4 += d2 * d2
  }
  const varPop = m2 / n
  return { mean: m, std: Math.sqrt(m2 / (n - 1)), kurtosis: varPop > 0 ? m4 / n / (varPop * varPop) : Number.NaN }
}

/**
 * 樣本變異數與理論變異數的 z 分數：SE(s²) ≈ σ²·√((κ − 1)/M)（κ 為 kurtosis；Gaussian 時 κ = 3 ⇒ √(2/M)）。
 * 用來誠實判定 Monte Carlo 是否與理論一致（|z| < 4 視為一致）。
 */
export function varianceZScore(sampleStd: number, theoryStd: number, kurtosis: number, m: number): number {
  const s2 = sampleStd * sampleStd
  const t2 = theoryStd * theoryStd
  if (!(t2 > 0)) return s2 === 0 ? 0 : Number.POSITIVE_INFINITY
  const k = Number.isFinite(kurtosis) && kurtosis > 1 ? kurtosis : 3
  return (s2 - t2) / (t2 * Math.sqrt((k - 1) / m))
}

/**
 * 「κ − 1」的保守取值：樣本 kurtosis 不是有限數（s = 0 的退化情況）或小於 Gaussian 的 3 時，一律用 Gaussian 的 κ − 1 = 2。
 * 避免把 NaN 傳進容忍度（NaN 容忍度會讓「0 對 0」被誤判成不一致）。
 */
export function kurtosisExcessFloor(kurtosis: number): number {
  return Number.isFinite(kurtosis) ? Math.max(kurtosis - 1, 2) : 2
}

/**
 * 樣本標準差 s（M 個獨立試驗）與理論 σ 比較時的容忍度：nSigma 個標準誤，
 *   SE(s) ≈ ½·σ·√((κ − 1)/M)（由 SE(s²) ≈ σ²√((κ − 1)/M) 與 ds = ds²/(2σ) 得到）。
 * 另加一個極小的絕對量，讓 σ = 0 的退化情況（每一筆都相同）只容許浮點捨入。
 */
export function stdTolerance(theoryStd: number, kurtosis: number, m: number, nSigma = 4): number {
  return Math.abs(theoryStd) * nSigma * 0.5 * Math.sqrt(kurtosisExcessFloor(kurtosis) / m) + 1e-12
}

// ───────────────────────── §0.10 注意假設：E[v·x] ≠ 0 會怎樣 ─────────────────────────

export interface BiasDemoParams {
  /** 真實參數 a */
  a: number
  /** 與 code 相關的干擾 ε_cc = κ·x 的係數 κ（全站符號，勘誤 E12 / E34）：v = κ·x + v′ */
  kappa: number
  w0: number
  mu: number
  /** 獨立雜訊 v′ 的標準差 */
  sigmaV: number
  steps: number
  seed: number
  /** 每隔幾步記錄一點（畫圖用） */
  stride?: number
}

export interface BiasDemoResult {
  /** 平均更新量為 0 的位置 w* = a + E[v·x]/E[x²] = a + κ */
  wStar: number
  /** 後半段（已進入穩態）w 的時間平均 */
  wMean: number
  /** 時間平均的理論標準誤 σ_v/√n（見下方說明） */
  se: number
  /** 取平均的樣本數 n */
  used: number
  /** 抽樣後的軌跡（n, w_n） */
  traceN: number[]
  traceW: number[]
}

// #region core:biasedFixedPoint
/**
 * Conventional LMS 平均收斂到的位置（F-00.11）：平均更新量 E[e·x] = (a − w)E[x²] + E[v·x] 歸零的 w。
 *   w* = a + E[v·x]/E[x²]      （E[v·x] = 0 時退回 w* = a；E[x²] = 0 時不可辨識，回傳 NaN）
 */
export function biasedFixedPoint(a: number, evx: number, ex2: number): number {
  return ex2 > 0 ? a + evx / ex2 : Number.NaN
}
// #endregion

// #region core:timeAverageValidity
/**
 * 把係數 p 的 AR(1)（穩態變異數 V、相隔 k 步的相關係數 p^|k|）連續 n 筆取時間平均：
 *   精確  Var(w̄) = (V/n²)·Σ_iΣ_j p^|i−j| = (V/n)·[(1 + p)/(1 − p) − 2p(1 − pⁿ)/(n(1 − p)²)]
 *   近似  Var(w̄) ≈ (V/n)·(1 + p)/(1 − p)                       ← n 遠大於相關長度時
 * 回傳近似的相對誤差 (近似 − 精確)/近似 = 2p(1 − pⁿ)/(n(1 − p²))；|p| ≥ 1 時沒有穩態，回傳 NaN。
 * 經驗法則：n ≥ 40|p|/(1 − p²)（p → 1 時約 20/(1 − p)）⇒ 誤差約 5% 以內。
 */
export function timeAverageVarianceError(p: number, n: number): number {
  if (!(Math.abs(p) < 1) || !(n >= 1)) return Number.NaN
  return (2 * p * (1 - Math.pow(p, n))) / (n * (1 - p * p))
}
// #endregion

// #region core:correlatedNoiseBias
/**
 * 反例：雜訊和輸入「相關」時（E[v·x] ≠ 0），LMS 會收斂到錯的地方。
 *   y = a·x + v，v = κ·x + v′（ε_cc = κ·x 是與 code 相關的干擾；v′ 與 x 獨立、零均值），x 為 ±1 碼（x² ≡ 1）
 *   E[v·x] = κ·E[x²]  ⇒  E[e·x] = (a − w)E[x²] + κ·E[x²] = (a + κ − w)·E[x²]
 * 平均更新量為 0 的位置是 w* = a + E[v·x]/E[x²] = a + κ，不是 a（calibration bias；與 Ch11 的 w* = a + κ 相同）。
 * 每一步都呼叫 lms.ts 的 conventionalStep；回傳後半段 w 的時間平均與它的標準誤：
 *   δ′ = w* − w 是係數 p = 1 − μ 的 AR(1)，Var(w∞) = μσ_v²/(2 − μ)，
 *   n 筆相關樣本的平均：Var(w̄) ≈ Var(w∞)·(1 + p)/((1 − p)·n) = σ_v²/n。
 */
export function correlatedNoiseBias(p: BiasDemoParams): BiasDemoResult {
  const rng = createRng(p.seed)
  const xr = rng.fork('x') // ±1 碼
  const vr = rng.fork('noise') // 獨立雜訊 v′
  const stride = Math.max(1, Math.round(p.stride ?? 1))
  const start = Math.floor(p.steps / 2) // 前一半視為暫態
  const traceN: number[] = [0]
  const traceW: number[] = [p.w0]
  let w = p.w0
  let sum = 0
  let used = 0
  for (let n = 0; n < p.steps; n++) {
    const x = xr.sign()
    const v = p.kappa * x + p.sigmaV * vr.normal() // ← 差異：雜訊多了 κ·x 這一項（與 x 相關，E[v·x] = κ）
    const y = p.a * x + v
    w = conventionalStep({ w, x, y, mu: p.mu }).w
    if (n + 1 >= start) {
      sum += w
      used++
    }
    if ((n + 1) % stride === 0) {
      traceN.push(n + 1)
      traceW.push(w)
    }
  }
  // ±1 碼：E[x²] = 1、E[v·x] = κ·E[x²] = κ ⇒ w* = a + κ；時間平均的標準誤 σ_v/√n（1/√N 法則）
  return { wStar: biasedFixedPoint(p.a, p.kappa, 1), wMean: used ? sum / used : Number.NaN, se: used ? averagedStd(p.sigmaV, used) : Number.NaN, used, traceN, traceW }
}
// #endregion

/** 先備知識：擲骰子 n 次的平均（期望值 3.5、單次標準差 √(35/12)）。 */
export function diceAverages(seed: number, ns: readonly number[]): { n: number; avg: number; err: number; theoryStd: number }[] {
  const rng = createRng(seed).fork('dice')
  const sigma = Math.sqrt(35 / 12)
  const maxN = Math.max(...ns)
  const want = new Set(ns)
  const out: { n: number; avg: number; err: number; theoryStd: number }[] = []
  let s = 0
  for (let n = 1; n <= maxN; n++) {
    s += rng.int(1, 6)
    if (want.has(n)) out.push({ n, avg: s / n, err: s / n - 3.5, theoryStd: sigma / Math.sqrt(n) })
  }
  return out
}

// ───────────────────────── §0.9 Sign-Error 預告（勘誤 E40） ─────────────────────────

/**
 * 用 lms.ts 的 runScalarLms 跑 Sign-Error LMS（無雜訊、固定 x），分別採三種 sign(0) 慣例，
 * 回傳最後 `tail` 個 w 值與「是否剛好停在 a」。
 */
export function signTieDemo(
  p: { a: number; w0: number; x: number; mu: number; steps: number },
  tail = 4,
): Record<TieRule, { tail: number[]; hitsExactly: boolean }> {
  const run = (tie: TieRule) => {
    const r = runScalarLms({ variant: 'sign_error', a: p.a, w0: p.w0, mu: p.mu, steps: p.steps, x: { kind: 'fixed', value: p.x }, tie })
    const w = Array.from(r.w)
    return { tail: w.slice(-tail), hitsExactly: w.some((v) => v === p.a) }
  }
  return { zero: run('zero'), plus: run('plus'), minus: run('minus') }
}

/**
 * 雜訊平均實驗的「退化情況」說明（s₁ = 0 或 E[e·x] = 0）：回傳要顯示的說明種類。
 *   'no-randomness'：s₁ = 0，每一筆 e·x 都相同（±1 碼且 σ_v = 0，或 w = a 且 σ_v = 0）
 *   'at-answer'    ：w = a，平均更新量為 0，只剩雜訊（σ_v > 0）
 */
export function noiseAverageDegeneracy(a: number, w: number, sigmaV: number, kind: RegressorKind): {
  kind: 'none' | 'no-randomness' | 'at-answer'
  /** s₁ = 0 時每一筆 e·x 的值 */
  constant?: number
} {
  const { mean, variance } = productMoments(a, w, sigmaV, kind)
  if (variance === 0) return { kind: 'no-randomness', constant: mean }
  if (mean === 0) return { kind: 'at-answer' }
  return { kind: 'none' }
}

/** 1-bit comparator 預告：s = 誤差、σ_v = 雜訊 RMS 時 P(q = +1) = Φ(s/σ_v)、E[q] = 2Φ − 1。 */
export function comparatorTeaser(sFs: number, sigmaFs: number): { pPlus: number; meanQ: number } {
  const pPlus = normCdf(sFs / sigmaFs)
  return { pPlus, meanQ: 2 * pPlus - 1 }
}

/**
 * 奇數 N 的 CLT 近似：P(S_N > 0) ≈ Φ(m_q√N/√(1 − m_q²))，S_N = Σq_i（總和，勘誤 E18）、m_q = E[q]（勘誤 E02：偶數 N 有 tie）。
 */
export function directionProbabilityClt(meanQ: number, n: number): number {
  return normCdf((meanQ * Math.sqrt(n)) / Math.sqrt(1 - meanQ * meanQ))
}
