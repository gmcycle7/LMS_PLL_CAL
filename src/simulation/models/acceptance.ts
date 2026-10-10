/**
 * 規格 §17 Acceptance Reference Values（T01–T18）的「即時驗收」核心（模型層級 L0–L4；驗證頁 /verification 與 acceptance.test.ts 共用）。
 *
 * 五件事：
 *   1. computeT01 … computeT18：把每個 T-id 的輸入條件交給**各章真正執行的模型**（lms、lossCompare、scalarStability、
 *      comparator、polarity、filteredX、stability、pe、mimo、bias、calNoise、quantizer、optimizer、gmac、dsm、pll），
 *      算出與 golden vector 同名的 key。本檔不重寫任何 LMS / PLL 公式——只負責「呼叫」與「整理」；
 *      每個 T-id 另附第二條獨立計算路徑（IndependentCheck），並標註它同時是哪些勘誤的即時證據。
 *   2. compareToGolden：golden/README §5 的規則 |actual − expected| ≤ abs + rel·|expected|（逐元素），
 *      tolerance_overrides 覆寫個別 key；整數門檻（abs = 0）必須完全相等。
 *   3. runAcceptanceMonteCarlo（worker 可呼叫）：隨機項目用自己的 seed 做 Monte Carlo，以 z = (估計 − 期望)/SE 判定
 *      （golden vectors 不放 MC 結果，因為 TS 與 NumPy 的亂數不同）。SE 由少數 chain 估計時把 Student-t 換成等效 z；
 *      估計量有已知的有限樣本偏差時（相關樣本的 s²、lag-1 自相關）先修正期望值。
 *   4. runAcceptanceMcSweep（worker 可呼叫）：同一組 MC 檢查換 K 個 seed 重跑，檢查 z 本身是否近似 N(0, 1)
 *      （「z 檢定準不準」的校準實驗；規格 §17：隨機統計使用多 seeds 與信賴界限）。
 *   5. computeErrataEvidence：把 docs/validation.md（errata.json 的 evidence 欄）引用的數字，用章節模型即時重算；
 *      容許誤差由「引用時寫到小數第幾位」自動決定。
 *
 * 另外 MUTANTS 是**故意寫錯**的公式（反面測試「模型公式有錯，UI 卻顯示成功」）：驗收機制必須把它們判為不一致。
 *
 * 文字欄位（label / method / note / quantity）可含 `$…$` 行內 TeX：頁面以 mathText() 顯示成 KaTeX（docs/teaching-style.md §3）。
 * 極性與單位：δ = a − w（勘誤 E32 / E39）；時間誤差 fs；K_q = √(2/π)/σ_v [fs⁻¹]；Ω [rad/sample]。
 * 所有函式皆為純函式；worker 函式的參數與回傳值可 structured clone。
 */

import { betaIncReg, db10, deriveSeed, eigSym, inv, normInv, normSf, studentTCdf, svd, type Matrix } from '@/simulation/core'
import { classifyPole, fixedXMuMax, fixedXPole, gaussianLyapunov, meanPole, meanSquareFactor, runScalarLms } from './lms'
import { playgroundVarWStationary } from './lossCompare'
import { lyapunovExponent, oneStepMc, stabilityBounds, xMoments } from './scalarStability'
import {
  directionCltPlain,
  directionExact,
  directionOutcomeExact,
  kq,
  meanGmacEncoding,
  meanQ,
  minNForTarget,
  pPlus,
  runComparatorMC,
  samplesForConfidence,
  signLmsFixedPointEncoding,
  sumMoments,
} from './comparator'
import {
  calPole,
  ctHpd as ctHpdLoop,
  DEFAULT_POLARITY_PARAMS,
  kqFromSigma,
  polarityMarginDeg,
  runPolarityClosedLoop,
  toneCorrelation,
  toneEmpirical,
  toneFir,
} from './polarity'
import { bestToneDelay, residualPhaseDeg, toneCorrCodeDelay } from './filteredX'
import {
  analyzeDualLoop,
  calLoopGain,
  dualLoopCharPoly,
  dualLoopFullMuRange,
  loopMargins,
  pmFirstOrder,
  polarityMarginArcsin,
  polarityMarginMod180Bug,
  simulateDelayRecursion,
  simulateFullModel,
} from './stability'
import { corr2, eig2x2, eigenModes, meanSquareRadius, meanTrajectory, stepsToDecay, stepsToDecayReal } from './pe'
import { analyzeRule, buildPlant, DEFAULT_RULE, inspectMatrix, modeVarianceClosed, preconditionedModeVar, runMimoTrajectories, type Mat, type RuleConfig } from './mimo'
import { buildCodeDistribution, codeMoments, mseFixedPoint, mseWeightedMean, signFixedPoint, simulateBiasLms, type ErrorModel } from './bias'
import { bw3dbNumeric, calLoop, loopCore, P_MIN_3DB, runNoiseLab, simulateMixing, spurBeta, spurDbcBessel, spurDbcSmallAngle, type MixingSimParams } from './calNoise'
import {
  bernoulliMoments,
  efbConstant,
  efbPeriod,
  lineSpectrum,
  makeCtx,
  makeGrid,
  simulateStrategy,
  toggleCycle,
  toggleK,
  togglePeriodOf,
  TOGGLE_PATTERN_5,
  type QuantizerSetup,
} from './quantizer'
import { detectPeriod } from './dsm'
import { accumulatorBitsRequired, wrapTwos } from './gmac'
import { convergenceMuMin, msdAfterBlocks } from './optimizer'
import { corrSingleTone, ctHpd, ctT, designDtLoop, loopFreqResponse } from './pll'

// ═══════════════════════════════════════════════════════════════════════════
// 型別
// ═══════════════════════════════════════════════════════════════════════════

export const ACCEPTANCE_IDS = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17', 'T18'] as const
export type AcceptanceId = (typeof ACCEPTANCE_IDS)[number]

/** golden 的數值：number 或（巢狀）number 陣列 */
export type Numeric = number | Numeric[]

/** golden/README §5 的容忍度：|a − e| ≤ abs + rel·|e|（缺的一項視為 0） */
export interface Tol {
  abs?: number
  rel?: number
}

/** golden/vectors/Txx.json 的形狀（只讀需要的欄位） */
export interface GoldenVectorLike {
  id: string
  description_zh?: string
  spec_section?: string
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: Tol
  tolerance_overrides?: Record<string, Tol>
  notes?: string
}

export type AcceptanceValues = Record<string, Numeric>

/** 同一個量的第二條獨立計算路徑（例如 2×2 閉式 vs Jacobi、封閉式 vs 數值求根、遞迴 vs 時域模擬） */
export interface IndependentCheck {
  /** 這項比對在說什麼（可含 `$…$` 行內 TeX） */
  label: string
  /** 第一條路徑（通常就是送去和 golden 比對的值） */
  primary: number
  /** 第二條路徑 */
  secondary: number
  /** |primary − secondary| ≤ tol 視為一致 */
  tol: number
  pass: boolean
  /** 兩條路徑各自用了什麼方法（可含 `$…$` 行內 TeX） */
  method: string
  /** 這項比對同時是哪些勘誤的即時證據（勘誤卡片會反向連結到它） */
  errata: string[]
}

export interface AcceptanceComputation {
  id: AcceptanceId
  /** 與 golden expected 同名的 key */
  values: AcceptanceValues
  checks: IndependentCheck[]
  /** 呼叫到的章節模型函式（顯示用，格式 'module.fn'） */
  calls: string[]
  /** 計算耗時 [ms]（只在 runAllAcceptance 填入） */
  ms?: number
}

/** 建立一條獨立比對（|a − b| ≤ tol） */
function check(label: string, primary: number, secondary: number, tol: number, method: string, errata: string[] = []): IndependentCheck {
  const d = Math.abs(primary - secondary)
  return { label, primary, secondary, tol, method, errata, pass: Number.isFinite(d) ? d <= tol : primary === secondary }
}

const TX = String.raw

// ═══════════════════════════════════════════════════════════════════════════
// 1. golden 比對規則
// ═══════════════════════════════════════════════════════════════════════════

// #region core:goldenRule
/** 單一元素的容許誤差 bound = abs + rel·|expected|（golden/README §5；numpy.isclose 同一規則） */
export function toleranceBound(expected: number, tol: Tol): number {
  return (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
}

export interface ElementDiff {
  /** 逐元素最大 |actual − expected| */
  maxAbsDiff: number
  /** 逐元素最大 |Δ|/bound（≤ 1 為通過；bound = 0 時 Δ = 0 記為 0、否則 Infinity） */
  worstRatio: number
  /** 比較的元素個數 */
  elements: number
  /** 形狀不同（陣列長度不符或型別不符） */
  shapeMismatch: boolean
}

/** 逐元素比較 actual 與 expected（兩者形狀必須相同）；NaN 一律視為不通過 */
export function diffNumeric(actual: Numeric, expected: Numeric, tol: Tol): ElementDiff {
  const out: ElementDiff = { maxAbsDiff: 0, worstRatio: 0, elements: 0, shapeMismatch: false }
  const walk = (a: Numeric, e: Numeric) => {
    if (Array.isArray(e)) {
      if (!Array.isArray(a) || a.length !== e.length) {
        out.shapeMismatch = true
        return
      }
      e.forEach((ei, i) => walk(a[i], ei))
      return
    }
    if (Array.isArray(a)) {
      out.shapeMismatch = true
      return
    }
    const d = Math.abs(a - e) // ← 核心：絕對差
    const bound = toleranceBound(e, tol) // ← 核心：abs + rel·|e|
    const ratio = Number.isNaN(d) ? Infinity : bound > 0 ? d / bound : d === 0 ? 0 : Infinity
    out.maxAbsDiff = Number.isNaN(d) ? Infinity : Math.max(out.maxAbsDiff, d)
    out.worstRatio = Math.max(out.worstRatio, ratio)
    out.elements++
  }
  walk(actual, expected)
  return out
}
// #endregion

/** expected 是否為可比對的數值（number 或巢狀 number 陣列） */
export function isNumeric(v: unknown): v is Numeric {
  if (typeof v === 'number') return Number.isFinite(v)
  return Array.isArray(v) && v.length > 0 && v.every(isNumeric)
}

export interface KeyComparison {
  key: string
  expected: Numeric | null
  actual: Numeric | null
  tol: Tol
  /** 該 key 是否用 tolerance_overrides */
  overridden: boolean
  diff: ElementDiff | null
  /** null：網站沒有計算這個 key（誠實標示，不算通過） */
  pass: boolean | null
}

export type GoldenStatus = 'pass' | 'fail' | 'incomplete'

export interface GoldenComparison {
  id: string
  keys: KeyComparison[]
  passed: number
  failed: number
  missing: number
  /** 全部 key 都算且都通過 = pass；有任何失敗 = fail；沒失敗但有 key 沒算 = incomplete */
  status: GoldenStatus
}

// #region core:compareToGolden
/** 依 golden vector 的每個 expected key 比對網站即時算出的值。沒有算的 key 回報 missing，不會被當成通過。 */
export function compareToGolden(vector: GoldenVectorLike, values: AcceptanceValues): GoldenComparison {
  const keys: KeyComparison[] = []
  for (const [key, expected] of Object.entries(vector.expected)) {
    const tol = vector.tolerance_overrides?.[key] ?? vector.tolerance // ← 個別 key 可覆寫（整數門檻 abs = 0）
    const overridden = vector.tolerance_overrides?.[key] !== undefined
    const actual = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined
    if (!isNumeric(expected)) {
      keys.push({ key, expected: null, actual: actual ?? null, tol, overridden, diff: null, pass: null })
      continue
    }
    if (actual === undefined) {
      keys.push({ key, expected, actual: null, tol, overridden, diff: null, pass: null }) // ← 沒算：missing，不是 pass
      continue
    }
    const diff = diffNumeric(actual, expected, tol)
    const pass = !diff.shapeMismatch && diff.worstRatio <= 1
    keys.push({ key, expected, actual, tol, overridden, diff, pass })
  }
  const passed = keys.filter((k) => k.pass === true).length
  const failed = keys.filter((k) => k.pass === false).length
  const missing = keys.filter((k) => k.pass === null).length
  const status: GoldenStatus = failed > 0 ? 'fail' : missing > 0 ? 'incomplete' : 'pass'
  return { id: vector.id, keys, passed, failed, missing, status }
}
// #endregion

// ═══════════════════════════════════════════════════════════════════════════
// 2. 輸入條件（規格 §17 表格 + 勘誤後補上的前提）
// ═══════════════════════════════════════════════════════════════════════════

const DEG = Math.PI / 180

/**
 * 每個 T-id 的輸入條件（規格 §17 的數值；勘誤 E11 / E30 補上的分布、path、gm_mode 也寫明）。
 * acceptance.test.ts 會檢查它們與 golden/vectors/Txx.json 的 inputs 一致。
 */
export const ACCEPTANCE_INPUTS = {
  T01: { a: 3, w0: 1, x: 2, mu: 0.1, steps: 5 },
  T02: { x: 2, mu_list: [0.1, 0.25, 0.4, 0.49, 0.5, 0.51, -0.01] },
  T03: { sigma_x: 1, mu_list: [0.3, 0.6, 2 / 3, 0.7, 1.0, 1.9] },
  T04: { s_fs: 1, sigma_fs: 100, wrong_code: [-1, -0.5, 0, 0.5, 1, 1.5], a_fs: 300 },
  T05: { s_fs: 1, sigma_fs: 100, N_list: [100, 1000, 10000, 42500, 85000], targets: [0.95, 0.99] },
  T06: { A: 1, H_mag: 1, phi_deg: 120, Omega_rad: Math.PI / 6, mu: 10, sigma_v_fs: 100, hpd_w_over_wn: 0.3, hpd_zeta: 0.7 },
  T07: { A: 1, H_mag: 1, phi_deg: -120, Omega_rad: Math.PI / 6, D: 4, D_list: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  T08: { g: 1, g_list: [0.2, 0.5, 1.0, 1.5, 1.8, 2.0] },
  T09: { r: 0.8, b: 0.2, c: 1, mu: 1.2 },
  T10: { rho: 0.99, rho_missing_pe: 1 },
  T11: { rho: 0.99, mu: 0.5, decay_fraction: 0.05, gamma: 0.5 },
  T12: { x_values: [-2, -1, 0, 1, 2], a: 1, c3: 0.1, sigma_list: [10, 100] },
  T13: { sigma_v_fs: 100, N: 4096, mu_fs: 10, C: 1, fs_hz: 4e9 },
  T14: { fs_hz: 4e9, N: 4096 },
  T15: { f_out_hz: 13e9, At_peak_fs: 0.5, fx_hz: 1e5, fw_hz: 1e4, x_amp: 1, dw_amp_fs: 1 },
  T16: { target_lsb: 32.4, toggle_period: 5, bits: 6 },
  T17: { low_code: 32, high_code: 33, p_high: 0.4 },
  T18: {
    J: [
      [-1, 2],
      [2, -1],
    ] as number[][],
    M_scalar: 0.2,
    reg_gamma: 0.5,
    reg_lambda: 0.1,
  },
} as const

/** 6-bit quantizer 的共用設定（round-half-up、saturate；與 Ch13 相同） */
const QUANT_SETUP: QuantizerSetup = {
  bits: 6,
  rounding: 'nearest',
  overflow: 'saturate',
  antiWindup: false,
  togglePeriod: 5,
  toggleOrder: 'spread',
  randomSource: 'ideal',
  prbsBits: 7,
  ditherLsb: 0,
  ditherPdf: 'uniform',
}

/** K_q 正規化為 1 的 σ_v（勘誤 E05 / E08：§10.1 的 0.995、598 只在 K_q ≡ 1 時成立） */
const SIGMA_KQ1 = Math.sqrt(2 / Math.PI)

const rule = (r: Partial<RuleConfig>): RuleConfig => ({ ...DEFAULT_RULE, ...r })

/** §12.4 的混頻模擬設定（coherent：f_x = 100 個 bin） */
export function t15MixingParams(): MixingSimParams {
  const i = ACCEPTANCE_INPUTS.T15
  return {
    fsim: 4.096e6,
    L: 4096,
    fx: i.fx_hz,
    A: i.x_amp,
    m: 0,
    codeWhite: 0,
    fw: i.fw_hz,
    B: i.dw_amp_fs,
    holdN: 1,
    dwNoiseSigma: 0,
    dwNoiseP: 0.92,
    fOut: i.f_out_hz,
    Tmag: 1,
    window: 'rectangular',
    seed: 1,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. T01–T18：呼叫各章模型
// ═══════════════════════════════════════════════════════════════════════════

// #region core:T01
/** T01：a = 3、w₀ = 1、x = 2、μ = 0.1 ⇒ w₁ = 1.8、w₂ = 2.28（lms.runScalarLms，Conventional LMS、無雜訊）。 */
export function computeT01(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T01
  const r = runScalarLms({ variant: 'conventional', a: i.a, w0: i.w0, mu: i.mu, steps: i.steps, x: { kind: 'fixed', value: i.x } })
  const pole = fixedXPole(i.mu, i.x) // p = 1 − μx²
  const closed2 = i.a - (i.a - i.w0) * pole * pole // 封閉式 w_n = a − (a − w₀)pⁿ
  return {
    id: 'T01',
    values: { w1: r.w[1], w2: r.w[2], e0: r.e[0], e1: r.e[1], pole, w_trace: Array.from(r.w), e_trace: Array.from(r.e) },
    checks: [
      check(TX`$w_2$：遞迴 vs 封閉式 $a-(a-w_0)p^2$`, r.w[2], closed2, 1e-14, 'runScalarLms 逐步更新 vs 等比數列封閉式'),
      check(TX`$w_2$：浮點 vs 有理數 $57/25$`, r.w[2], 57 / 25, 1e-14, 'IEEE double vs 精確分數'),
      check(TX`$\delta_2=a-w_2=+0.72$（極性 $\delta=a-w$）`, r.delta[2], 0.72, 1e-14, TX`runScalarLms 的 $\delta_n$ vs 手算`, ['E32', 'E39']),
    ],
    calls: ['lms.runScalarLms', 'lms.fixedXPole'],
  }
}
// #endregion

// #region core:T02
/** T02：固定 x = 2 ⇒ 0 < μ < 2/x² = 0.5（lms.fixedXPole / classifyPole；邊界以二分法另外求根）。 */
export function computeT02(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T02
  const poles = i.mu_list.map((mu) => fixedXPole(mu, i.x))
  const behaviour = poles.map((p) => classifyPole(p))
  const converges = behaviour.map((b) => (b === 'monotone' || b === 'oscillating' || b === 'deadbeat' ? 1 : 0))
  // 不用封閉式：二分法解 |p(μ)| = 1 的兩個根（|p| 在 μ = 1/x² 最小）
  const f = (mu: number) => Math.abs(fixedXPole(mu, i.x)) - 1
  const center = 1 / (i.x * i.x)
  const muMin = bisect(f, center - 10, center, 'decreasing')
  const muMax = bisect(f, center, center + 10, 'increasing')
  const sim = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 0.49, steps: 200, x: { kind: 'fixed', value: i.x } })
  return {
    id: 'T02',
    values: { mu_min: muMin, mu_max: muMax, mu_one_step: center, pole_list: poles, converges_list: converges },
    checks: [
      check(TX`$\mu_{\max}$：二分法 vs 封閉式 $2/x^2$`, muMax, fixedXMuMax(i.x), 1e-13, TX`$|1-\mu x^2|=1$ 的數值根 vs lms.fixedXMuMax`),
      check(TX`$\mu=0.49$：200 步後 $|\delta_{200}|=2\cdot0.96^{200}$（時域 vs pole）`, Math.abs(sim.delta[200]), 2 * Math.pow(0.96, 200), 1e-12, TX`runScalarLms vs $|p|^n|\delta_0|$`),
    ],
    calls: ['lms.fixedXPole', 'lms.classifyPole', 'lms.fixedXMuMax', 'lms.runScalarLms'],
  }
}
// #endregion

/** 二分法求單調函數 f 的零點（decreasing：f(lo) > 0 > f(hi)；increasing 反之）。 */
function bisect(f: (x: number) => number, lo: number, hi: number, dir: 'increasing' | 'decreasing'): number {
  let a = lo
  let b = hi
  for (let it = 0; it < 300 && b - a > 0; it++) {
    const m = 0.5 * (a + b)
    if (m === a || m === b) break
    const below = dir === 'increasing' ? f(m) < 0 : f(m) > 0
    if (below) a = m
    else b = m
  }
  return 0.5 * (a + b)
}

// #region core:T03
/** T03：Gaussian E[x²] = 1、E[x⁴] = 3 ⇒ mean 上限 2、mean-square 上限 2/3（scalarStability.xMoments / stabilityBounds、lms 的 g(μ)）。 */
export function computeT03(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T03
  const gauss = xMoments({ kind: 'gaussian', sigma: i.sigma_x })
  const bG = stabilityBounds({ kind: 'gaussian', sigma: i.sigma_x })
  const bB = stabilityBounds({ kind: 'pm_one', amplitude: 1 }) // ±1：E[x⁴] = 1
  const bU = stabilityBounds({ kind: 'uniform', halfWidth: Math.sqrt(3) }) // U(−√3, √3)：E[x²] = 1、E[x⁴] = 9/5
  const lamG = (mu: number) => lyapunovExponent(mu, { kind: 'gaussian', sigma: i.sigma_x }) // λ(μ) = E[ln|1 − μx²|]
  return {
    id: 'T03',
    values: {
      Ex2: gauss.Px,
      Ex4: gauss.M4,
      mu_mean_max: bG.meanMax,
      mu_ms_max: bG.msMax,
      ms_factor_list: i.mu_list.map((mu) => meanSquareFactor(mu, gauss.Px, gauss.M4)),
      mean_factor_list: i.mu_list.map((mu) => meanPole(mu, gauss.Px)),
      mu_ms_max_bpsk: bB.msMax,
      mu_ms_max_uniform: bU.msMax,
    },
    checks: [
      check(TX`$g(2/3)=E[(1-\mu x^2)^2]=1$（均方邊界）`, meanSquareFactor(2 / 3, gauss.Px, gauss.M4), 1, 1e-14, TX`$1-2\mu P_x+\mu^2M_4$`),
      check(TX`almost-sure 界 $\mu_{\rm as}$：Dawson 積分求 $\lambda(\mu)=0$ vs validation.md 的 2.421249521`, bG.asMax, 2.421249521, 2e-6, 'scalarStability.stabilityBounds（二分法）vs scipy quad', ['E14']),
      check(TX`$\lambda(0.8)<0$：均方發散（$g=1.32$）但樣本路徑收斂`, lamG(0.8) < 0 && meanSquareFactor(0.8, 1, 3) > 1 ? 1 : 0, 1, 0, TX`scalarStability.lyapunovExponent 的符號與 $g(0.8)$`, ['E14']),
      check(TX`$\lambda(0.8)$：兩個獨立實作（Dawson 封閉式 vs lms.ts 的數值積分）`, lamG(0.8), gaussianLyapunov(0.8), 5e-6, TX`lms.gaussianLyapunov 在對數奇點附近約有 $2\times10^{-6}$ 的積分誤差`, ['E14']),
    ],
    calls: ['scalarStability.xMoments', 'scalarStability.stabilityBounds', 'scalarStability.lyapunovExponent', 'lms.meanSquareFactor', 'lms.meanPole', 'lms.gaussianLyapunov'],
  }
}
// #endregion

// #region core:T04
/** T04：s = 1 fs、σ_v = 100 fs ⇒ P(q = +1) = Φ(0.01)、K_q = √(2/π)/σ_v（comparator.pPlus / meanQ / kq）；含 0/1 編碼反面測試。 */
export function computeT04(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T04
  const code = [...i.wrong_code]
  const probs = code.map(() => 1 / code.length)
  const Kq = kq(i.sigma_fs)
  const wStarBug = signLmsFixedPointEncoding(i.a_fs, code, probs, i.sigma_fs, 'unipolar', [-700, 1300])
  return {
    id: 'T04',
    values: {
      p_plus: pPlus(i.s_fs, i.sigma_fs),
      p_minus: pPlus(-i.s_fs, i.sigma_fs), // 對稱：P(q = −1) = Φ(−s/σ_v)
      mean_q: meanQ(i.s_fs, i.sigma_fs),
      kq_per_fs: Kq,
      kq_times_s: Kq * i.s_fs,
      wrong_encoding_mean_update_at_w_eq_a: meanGmacEncoding(i.a_fs, i.a_fs, code, probs, i.sigma_fs, 'unipolar'),
      wrong_encoding_fixed_point_shift_fs: wStarBug - i.a_fs,
    },
    checks: [
      check(TX`$P(+1)+P(-1)=1$`, pPlus(i.s_fs, i.sigma_fs) + pPlus(-i.s_fs, i.sigma_fs), 1, 1e-15, TX`兩次獨立的 $\Phi$ 計算`),
      check(TX`$E[q]=2P(+1)-1=\operatorname{erf}\!\big(s/(\sqrt2\sigma_v)\big)$`, 2 * pPlus(i.s_fs, i.sigma_fs) - 1, meanQ(i.s_fs, i.sigma_fs), 1e-15, TX`$\Phi$ vs $\operatorname{erf}$`),
      check(TX`$K_q$ 是 $E[q]$ 在 $s=0$ 的斜率（中央差分）`, (meanQ(1e-3, i.sigma_fs) - meanQ(-1e-3, i.sigma_fs)) / 2e-3, Kq, 1e-12, TX`數值微分 vs $\sqrt{2/\pi}/\sigma_v$`),
      check(TX`正確編碼 $q=2b-1$ 的固定點就是 $a$`, signLmsFixedPointEncoding(i.a_fs, code, probs, i.sigma_fs, 'bipolar', [-700, 1300]), i.a_fs, 1e-8, TX`二分法 vs $a$`),
    ],
    calls: ['comparator.pPlus', 'comparator.meanQ', 'comparator.kq', 'comparator.meanGmacEncoding', 'comparator.signLmsFixedPointEncoding'],
  }
}
// #endregion

// #region core:T05
/** T05：N ≈ 42500 時方向判斷 ≈ 95%（comparator.directionCltPlain / directionOutcomeExact / minNForTarget；tie rule 見 E02 / E07）。 */
export function computeT05(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T05
  const p = pPlus(i.s_fs, i.sigma_fs)
  const m = meanQ(i.s_fs, i.sigma_fs)
  const req = (v: number | null) => (v === null ? Number.NaN : v) // 到不了目標時回傳 NaN（會被判為不通過）
  const tie100 = directionExact(p, 100)
  return {
    id: 'T05',
    values: {
      m,
      p_clt_list: i.N_list.map((N) => directionCltPlain(m, N)), // 規格原式（無連續性修正）
      p_exact_split_list: i.N_list.map((N) => directionOutcomeExact(p, N, 'half').correct), // tie 擲硬幣
      p_exact_strict_list: i.N_list.map((N) => directionOutcomeExact(p, N, 'strict').correct), // tie 算錯
      p_exact_odd_Nplus1_list: i.N_list.map((N) => directionOutcomeExact(p, N + 1, 'strict').correct), // 奇數 N 沒有 tie
      N_clt_95: samplesForConfidence(m, i.targets[0]),
      N_clt_99: samplesForConfidence(m, i.targets[1]),
      N_exact_odd_95: req(minNForTarget(p, i.targets[0], 'odd')),
      N_exact_odd_99: req(minNForTarget(p, i.targets[1], 'odd')),
      N_exact_even_split_95: req(minNForTarget(p, i.targets[0], 'even', 'half')),
      N_exact_even_strict_95: req(minNForTarget(p, i.targets[0], 'even', 'strict')),
    },
    checks: [
      check(TX`偶數 $N$ 平分 tie $=$ 奇數 $N-1$（精確恆等式）`, directionOutcomeExact(p, 100, 'half').correct, directionOutcomeExact(p, 99, 'strict').correct, 1e-12, TX`$\mathrm{Binomial}(100)$ vs $\mathrm{Binomial}(99)$`, ['E02']),
      check(TX`$N=100$：$P(S_N>0)+P(S_N=0)+P(S_N<0)=1$`, tie100.pos + tie100.tie + tie100.neg, 1, 1e-12, '三項 Binomial 機率各自計算'),
      check(TX`$N=100$ strict $=49.2\%<50\%$（規格表的 $53.2\%$ 只對 tie 平分成立）：Binomial 上尾 vs 不完全 Beta 函數`, directionOutcomeExact(p, 100, 'strict').correct, betaIncReg(51, 50, p), 1e-12, TX`逐項加總 $\sum_{k\ge51}\binom{100}{k}p^k(1-p)^{100-k}$ vs $I_p(51,50)$（core.betaIncReg 的連分式）`, ['E02', 'E07']),
      check(TX`$N=100$：strict $<\tfrac12<$ tie 平分（兩種解讀落在 $50\%$ 的兩側）`, tie100.pos < 0.5 && tie100.pos + 0.5 * tie100.tie > 0.5 ? 1 : 0, 1, 0, TX`comparator.directionExact 的 $P(S_N>0)$ 與 $P(S_N>0)+\tfrac12P(S_N=0)$`, ['E02']),
    ],
    calls: ['comparator.directionCltPlain', 'comparator.directionOutcomeExact', 'comparator.directionExact', 'comparator.samplesForConfidence', 'comparator.minNForTarget', 'core.betaIncReg'],
  }
}
// #endregion

// #region core:T06
/** T06：x = A cos Ωn、φ = 120° ⇒ C = (A²/2)|H|cos φ < 0、p = 1 − μK_qC > 1（polarity.toneCorrelation / calPole / toneFir / ctHpd）。 */
export function computeT06(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T06
  const spec = { A: i.A, mag: i.H_mag, phiRad: i.phi_deg * DEG, omega: i.Omega_rad }
  const C = toneCorrelation(spec)
  const Kq = kqFromSigma(i.sigma_v_fs)
  const H = ctHpdLoop('typeII', i.hpd_w_over_wn, i.hpd_zeta)
  const emp = toneEmpirical({ ...spec, length: 12 * 200 })
  const Href = ctHpd(i.hpd_w_over_wn, { zeta: i.hpd_zeta, wn: 1 })
  return {
    id: 'T06',
    values: {
      C,
      C_sign: Math.sign(C),
      pole: calPole(i.mu, Kq, C),
      C_at_phi_list_deg: [0, 60, 90, 120, 180].map((d) => toneCorrelation({ ...spec, phiRad: d * DEG })),
      fir_h: toneFir(i.H_mag, i.phi_deg * DEG, i.Omega_rad),
      hpd_re: H.re,
      hpd_im: H.im,
      hpd_phase_deg: (Math.atan2(H.im, H.re) * 180) / Math.PI,
      reversed_polarity_pole: calPole(i.mu, Kq, -1), // 反面：comparator 極性接反 ⇒ 等效 C → −1
    },
    checks: [
      check(TX`$C$：公式 $\tfrac{A^2}{2}|H|\cos\phi$ vs 2-tap FIR 時域整數週期平均`, C, emp.C, 1e-12, 'toneCorrelation vs toneEmpirical（lfilter + 平均）', ['E46']),
      check(TX`$H_{\rm PD}(j0.3\omega_n)$ 的實部：polarity.ctHpd vs pll.ctHpd`, H.re, Href.re, 1e-14, '兩個獨立實作的 CT 原型', ['E44']),
      check(TX`$\Omega=\pi$ 時 $C=A^2|H|\cos\phi$（一般式的 2 倍）`, corrSingleTone({ amplitude: i.A, magnitude: i.H_mag, phaseRad: 0, omega: Math.PI }), 2 * toneCorrelation({ ...spec, phiRad: 0 }), 1e-14, TX`pll.corrSingleTone（邊界式）vs $2\times$ 一般式`, ['E46']),
    ],
    calls: ['polarity.toneCorrelation', 'polarity.calPole', 'polarity.kqFromSigma', 'polarity.toneFir', 'polarity.ctHpd', 'polarity.toneEmpirical', 'pll.ctHpd', 'pll.corrSingleTone'],
  }
}
// #endregion

// #region core:T07
/** T07：φ = −120°、Ω = π/6、D = 4 ⇒ 殘餘相位 θ = φ + ΩD = 0°、C_D 正最大（filteredX.toneCorrCodeDelay / bestToneDelay）。 */
export function computeT07(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T07
  const tone = { A: i.A, mag: i.H_mag, phiRad: i.phi_deg * DEG, omega: i.Omega_rad }
  const theta = residualPhaseDeg(tone.phiRad, tone.omega, i.D, 'code')
  const best = bestToneDelay(tone.phiRad, tone.omega, 11, 'code')
  const emp = toneEmpirical({ A: i.A, mag: i.H_mag, phiRad: tone.phiRad, omega: tone.omega, delay: i.D, length: 12 * 200 })
  return {
    id: 'T07',
    values: {
      theta_deg: theta,
      C_D: toneCorrCodeDelay(tone, i.D),
      C_D_list: i.D_list.map((D) => toneCorrCodeDelay(tone, D)),
      best_D: best.D,
      polarity_margin_deg: polarityMarginDeg(theta),
      misaligned_C_D_list_phi0: i.D_list.map((D) => toneCorrCodeDelay({ ...tone, phiRad: 0 }, D)), // 反面：H = 1 卻錯位
    },
    checks: [
      check(TX`$C_4$：filteredX 公式 vs polarity 時域 FIR 平均`, toneCorrCodeDelay(tone, i.D), emp.C, 1e-12, TX`toneCorrCodeDelay vs toneEmpirical（$D=4$）`, ['E46']),
      check(TX`連續解 $D^*=(-\phi \bmod 2\pi)/\Omega=4$`, best.continuous, 4, 1e-12, 'bestToneDelay.continuous'),
      check(TX`$M_{\rm pol}(\theta=-150^\circ)=-60^\circ$（$\operatorname{wrap}_{180}$ 的週期是 $360^\circ$）`, polarityMarginArcsin(-150), -60, 1e-9, TX`stability.polarityMarginArcsin $=\arcsin(\cos\theta)$`, ['E20']),
    ],
    calls: ['filteredX.residualPhaseDeg', 'filteredX.toneCorrCodeDelay', 'filteredX.bestToneDelay', 'polarity.polarityMarginDeg', 'polarity.toneEmpirical', 'stability.polarityMarginArcsin'],
  }
}
// #endregion

// #region core:T08
/** T08：L(z) = g/(z − 1)、g = 1 ⇒ pole 0、PM 60°（stability.pmFirstOrder；數值 PM 由 loopMargins 二分求根交叉驗證）。 */
export function computeT08(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T08
  const r = pmFirstOrder(i.g)
  const numeric = loopMargins((w) => calLoopGain(i.g, 0, w))
  const step = simulateDelayRecursion(i.g, 0, 3, 1)
  return {
    id: 'T08',
    values: {
      pole: r.pole,
      pm_deg: r.pmDeg,
      crossover_omega_rad: r.omegaC,
      pole_list: i.g_list.map((g) => pmFirstOrder(g).pole),
      pm_deg_list: i.g_list.map((g) => pmFirstOrder(g).pmDeg),
    },
    checks: [
      check(TX`PM：封閉式 $90^\circ-\arcsin(g/2)$ vs 數值 crossover`, r.pmDeg, numeric.pmDeg, 1e-8, 'pmFirstOrder vs loopMargins（網格 + 二分）'),
      check(TX`$\omega_c$：封閉式 $2\arcsin(g/2)$ vs $|L|=1$ 的數值根`, r.omegaC, numeric.omegaC, 1e-10, 'pmFirstOrder vs loopMargins'),
      check(TX`pole $0\Rightarrow$ 一步歸零：時域 $\delta_1$`, step.delta[1], 0, 1e-15, TX`simulateDelayRecursion（$g=1,\ d=0$）`),
    ],
    calls: ['stability.pmFirstOrder', 'stability.loopMargins', 'stability.calLoopGain', 'stability.simulateDelayRecursion'],
  }
}
// #endregion

// #region core:T09
/** T09：r = .8、b = .2、c = 1、μ = 1.2 ⇒ |z| ≈ 1.0198（stability.analyzeDualLoop；簡化模型卻預測穩定）。 */
export function computeT09(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T09
  const an = analyzeDualLoop(i)
  const top = an.poles[0] // +j 那一個（polyRoots 依 |z| 再依虛部排序）
  const eigTop = an.polesEig[0]
  const sim = simulateFullModel(i, 300, 1)
  let peak = 0
  for (let k = 280; k <= 300; k++) peak = Math.max(peak, Math.abs(sim.delta[k]))
  return {
    id: 'T09',
    values: {
      pole_re: top.re,
      pole_im: Math.abs(top.im),
      pole_abs: an.rho,
      char_poly: dualLoopCharPoly(i),
      mu_max_full: an.fullRange.hi,
      mu_min_full: an.fullRange.lo,
      mu_max_simplified: an.simplifiedRange.hi,
      simplified_pole_at_mu: an.simplifiedPole,
    },
    checks: [
      check(TX`$|z|$：特徵式求根 vs $\operatorname{eig}(\mathbf A)$`, Math.hypot(top.re, top.im), Math.hypot(eigTop.re, eigTop.im), 1e-12, 'polyRoots vs Hessenberg QR'),
      check(TX`時域 300 blocks：$\ln|\delta_k|/k\approx\ln\rho$`, Math.log(peak) / 300, Math.log(an.rho), 0.01, TX`simulateFullModel 的包絡（$k=280\ldots300$ 的峰值）`),
      check(TX`完整上界 $(1-r)/(bc)$ 恰為簡化上界 $2(1-r)/(bc)$ 的一半`, an.fullRange.hi, 0.5 * an.simplifiedRange.hi, 1e-12, 'analyzeDualLoop.fullRange vs simplifiedRange', ['E19']),
    ],
    calls: ['stability.analyzeDualLoop', 'stability.dualLoopCharPoly', 'stability.simulateFullModel'],
  }
}
// #endregion

// #region core:T10
/** T10：R = [[1, .99], [.99, 1]] ⇒ λ = 1.99、0.01，κ = 199（pe.eig2x2 閉式；Jacobi eigSym 與 SVD 交叉驗證）。 */
export function computeT10(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T10
  const R = corr2(i.rho)
  const e = eig2x2(1, i.rho, 1)
  const ins = inspectMatrix(R) // Jacobi eigSym + SVD
  const jac = eigSym(R)
  const vmin = [e.vectors[0][1], e.vectors[1][1]]
  return {
    id: 'T10',
    values: {
      eig_max: e.values[0],
      eig_min: e.values[1],
      cond: e.values[0] / e.values[1],
      eigvec_max: [e.vectors[0][0], e.vectors[1][0]],
      eigvec_min: vmin,
      missing_pe_eig_list: [...eig2x2(1, i.rho_missing_pe, 1).values], // 反面：ρ = 1 ⇒ [2, 0]
    },
    checks: [
      check(TX`$\lambda_{\min}$：$2\times2$ 閉式 vs Jacobi eigSym`, e.values[1], jac.values[1], 1e-14, '解二次方程 vs 迭代旋轉'),
      check(TX`$\kappa$：$\lambda_{\max}/\lambda_{\min}$ vs $\sigma_{\max}/\sigma_{\min}$（SVD）`, e.values[0] / e.values[1], ins.cond, 1e-9, 'eigenvalues vs singular values'),
    ],
    calls: ['pe.corr2', 'pe.eig2x2', 'mimo.inspectMatrix', 'core.eigSym'],
  }
}
// #endregion

// #region core:T11
/** T11：μK_q = 0.5、λ_min = 0.01 ⇒ 慢 pole 0.995、598 blocks；M = 0.5R⁻¹ ⇒ pole 0.5、5 blocks（pe.eigenModes；mimo.analyzeRule；K_q 正規化為 1，E05）。 */
export function computeT11(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T11
  const R = corr2(i.rho)
  const modes = eigenModes(R, i.mu)
  const plant = buildPlant({ mode: 'R', R, sigmaV: SIGMA_KQ1, N: 4096 }) // K_q = 1 fs⁻¹（正規化）
  const full = analyzeRule(plant, rule({ rule: 'full', gamma: i.gamma }), plant.Jn)
  // 時域：沿慢 eigenvector 出發，看平均遞迴第一次 ≤ 5% 的步數
  const v = [modes.vectors[0][1], modes.vectors[1][1]]
  const traj = meanTrajectory(R, i.mu, v, 700)
  let kFirst = -1
  for (let k = 0; k <= 700; k++) {
    if (Math.hypot(traj[0][k], traj[1][k]) <= i.decay_fraction + 1e-15) {
      kFirst = k
      break
    }
  }
  const physKq = kq(100) // §5 的物理 K_q（E05：忘了正規化的結果）
  return {
    id: 'T11',
    values: {
      slow_pole: modes.poles[1],
      fast_pole: modes.poles[0],
      blocks_95: stepsToDecay(modes.poles[1], i.decay_fraction),
      blocks_95_real: stepsToDecayReal(modes.poles[1], i.decay_fraction),
      preconditioned_pole: full.spectralRadius,
      preconditioned_blocks_95: full.blocks95 ?? Number.NaN,
      preconditioner_M: (full.Mn ?? [[Number.NaN]]) as Mat,
    },
    checks: [
      check(TX`$598=\lceil\ln0.05/\ln0.995\rceil$ vs 平均遞迴時域第一次 $\le5\%$`, stepsToDecay(modes.poles[1], i.decay_fraction), kFirst, 0, 'pe.stepsToDecay vs pe.meanTrajectory'),
      check(TX`物理 $K_q$（$\sigma_v=100\,\mathrm{fs}$）時慢 pole $=0.99996011$`, 1 - i.mu * physKq * modes.lambdas[1], 0.99996011, 5e-9, TX`$\mu=0.5\,\mathrm{fs}$、$K_q=0.00798\,\mathrm{fs^{-1}}$`, ['E05', 'E08']),
      check(TX`$N=1$ 的 Gaussian regressor：均方 spectral radius $=1.9801>1$（mean 收斂、均方發散）`, meanSquareRadius('gaussian', i.rho, i.mu, 1), 1.9801, 5e-5, 'pe.meanSquareRadius vs validation.md', ['E23']),
    ],
    calls: ['pe.corr2', 'pe.eigenModes', 'pe.stepsToDecay', 'pe.meanTrajectory', 'pe.meanSquareRadius', 'mimo.buildPlant', 'mimo.analyzeRule'],
  }
}
// #endregion

// #region core:T12
/** T12：x ∈ {−2..2}、a = 1、c₃ = 0.1 ⇒ MSE-LMS 的 w* = 1.34（bias.mseFixedPoint）；Sign-LMS 的 mean-field 根依 σ_v 而定（E01）。 */
export function computeT12(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T12
  const dist = buildCodeDistribution({ kind: 'five_level' })
  const mo = codeMoments(dist)
  const model = (sigmaV: number): ErrorModel => ({ a: i.a, b: 0, c2: 0, c3: i.c3, kappa: 0, sigmaV })
  const wMse = mseFixedPoint(model(1), dist)
  return {
    id: 'T12',
    values: {
      Ex2: mo.Ex2,
      Ex4: mo.Ex4,
      w_star: wMse,
      sign_lms_w_star_list: i.sigma_list.map((s) => signFixedPoint(model(s), dist).w),
    },
    checks: [
      check(TX`T12a：$1.34$ 是直線 $G(w)$ 的零點，也是 $x^2$ 加權平均的 per-code gain`, wMse, mseWeightedMean(model(1), dist.values, dist.probs), 1e-14, 'mseFixedPoint vs mseWeightedMean', ['E01']),
      check(TX`T12b：Sign-LMS、$\sigma_v=1\to1.340346$（mean-field）`, signFixedPoint(model(1), dist).w, 1.340346, 1e-6, 'Brent 求根 vs validation.md（mpmath 40 位）', ['E01']),
      check(TX`T12c：無雜訊 Sign-LMS $\to1.4$（$|x|$ 加權中位數，不是 $1.34$）`, signFixedPoint(model(0), dist).w, 1.4, 1e-9, TX`$\sigma_v=0$ 的二分法`, ['E01']),
      check(TX`code 分布必須寫明：$\pm1$ code 的 MSE 解是 $1.10$`, mseFixedPoint(model(1), buildCodeDistribution({ kind: 'pm_one' })), 1.1, 1e-12, TX`$a+c_3E[x^4]/E[x^2]=1+0.1$`, ['E11']),
    ],
    calls: ['bias.buildCodeDistribution', 'bias.codeMoments', 'bias.mseFixedPoint', 'bias.signFixedPoint', 'bias.mseWeightedMean'],
  }
}
// #endregion

// #region core:T13
/** T13：σ_v = 100 fs、N = 4096、μ = 10 fs、C = 1（unit-RMS、identity、average，E30）⇒ p ≈ 0.92021、σ_w ≈ 0.399 fs（calNoise.calLoop）。 */
export function computeT13(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T13
  const lp = calLoop({ N: i.N, fs: i.fs_hz, mu: i.mu_fs, sigmaV: i.sigma_v_fs, C: i.C })
  const sum = loopCore(i.N, i.fs_hz, i.mu_fs, i.sigma_v_fs, i.C, 'sum') // 反面：sum 模式沿用 average 的 μ
  // 時域：變異遞迴 V_{k+1} = p²V_k + μ²σ_η² 跑到穩態
  let V = 0
  for (let k = 0; k < 2000; k++) V = lp.p * lp.p * V + i.mu_fs * i.mu_fs * lp.sigmaEta2
  return {
    id: 'T13',
    values: {
      K_per_fs: lp.K,
      g: lp.g,
      p: lp.p,
      sigma_w_fs: lp.sigmaW,
      sigma_w2_fs2: lp.sigmaW2,
      g_sum_mode: sum.g,
      pole_sum_mode: sum.p,
    },
    checks: [
      check(TX`$\sigma_w^2$：封閉式 vs 變異遞迴 2000 blocks`, lp.sigmaW2, V, 1e-12, TX`$\mu^2\sigma_\eta^2/(1-p^2)$ vs $V_{k+1}=p^2V_k+\mu^2\sigma_\eta^2$`),
      check(TX`$\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$（Parseval）`, lp.sigmaW2, lp.sw1Dc * lp.enbw, 1e-12, TX`時域變異 vs 頻域 DC 位準 $\times$ 等效雜訊頻寬`, ['E06', 'E28']),
      check(TX`$g=\mu K$ 無因次：$10\,\mathrm{fs}\times K_q=0.0797885$`, lp.g, i.mu_fs * kq(i.sigma_v_fs) * i.C, 1e-15, TX`calNoise.calLoop vs comparator.kq`, ['E13', 'E30']),
    ],
    calls: ['calNoise.calLoop', 'calNoise.loopCore'],
  }
}
// #endregion

// #region core:T14
/** T14：f_s = 4 GHz、N = 4096 ⇒ f_u = 976.5625 kHz；−3 dB 有四種定義（E06 / E10 / E26）（calNoise.calLoop）。 */
export function computeT14(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T14
  const t13 = ACCEPTANCE_INPUTS.T13
  const lp = calLoop({ N: i.N, fs: i.fs_hz, mu: t13.mu_fs, sigmaV: t13.sigma_v_fs, C: t13.C })
  return {
    id: 'T14',
    values: {
      f_u_hz: lp.fu,
      bw_one_minus_p_hz: lp.f3dbOneMinusP,
      bw_neg_ln_p_hz: lp.f3dbNegLnP,
      bw_exact_3db_hz: lp.f3dbExact,
      enbw_one_sided_hz: lp.enbw,
    },
    checks: [
      check(TX`exact $-3\,\mathrm{dB}$：封閉式 vs 二分法 $|H|^2=\tfrac12|H(1)|^2$`, lp.f3dbExact, bw3dbNumeric(lp.p, lp.fu), 1e-6, 'bw3dbExact vs bw3dbNumeric', ['E27']),
      check(TX`ENBW：封閉式 $\tfrac{f_u}{2}\tfrac{1-p}{1+p}$ vs $\sigma_w^2/S_w^{(1)}(0)$`, lp.enbw, lp.enbwEff, 1e-6, '封閉式 vs 時域/頻域比值', ['E06', 'E10']),
      check(TX`$(1-p)$ 近似相對 exact 偏 $-4.10\%$（不可冒充 exact）`, (lp.f3dbOneMinusP / lp.f3dbExact - 1) * 100, -4.1, 5e-3, TX`calLoop 的 f3dbOneMinusP / f3dbExact`, ['E26', 'E10']),
    ],
    calls: ['calNoise.calLoop', 'calNoise.bw3dbNumeric'],
  }
}
// #endregion

// #region core:T15
/** T15：f_out = 13 GHz、0.5 fs peak ⇒ 單邊 spur ≈ −93.8 dBc（calNoise.spurBeta / spurDbcSmallAngle / Bessel；混頻以 simulateMixing 時域量測）。 */
export function computeT15(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T15
  const beta = spurBeta(i.f_out_hz, i.At_peak_fs)
  const mix = simulateMixing(t15MixingParams())
  return {
    id: 'T15',
    values: {
      beta_rad: beta,
      spur_dbc: spurDbcSmallAngle(beta),
      spur_dbc_bessel: spurDbcBessel(beta),
      mixing_tone_freqs_hz: mix.tones.map((t) => t.f),
      mixing_tone_peak_s: mix.tones.map((t) => t.measFs * 1e-15), // toneFit 量到的 peak（fs → s）
    },
    checks: [
      check(TX`$e^{j\phi}$ 的 FFT 直接量測 vs Bessel 精確值`, mix.pmFftDbc, spurDbcBessel(beta), 1e-6, TX`simulateMixing.pmFftDbc vs $20\log_{10}(J_1/J_0)$`),
      check(TX`小角近似 $20\log_{10}(\beta/2)$ vs Bessel $20\log_{10}\big(J_1(\beta)/J_0(\beta)\big)$`, spurDbcSmallAngle(beta), spurDbcBessel(beta), 1e-8, 'spurDbcSmallAngle vs spurDbcBessel'),
    ],
    calls: ['calNoise.spurBeta', 'calNoise.spurDbcSmallAngle', 'calNoise.spurDbcBessel', 'calNoise.simulateMixing'],
  }
}
// #endregion

// #region core:T16
/** T16：目標 32.4、toggle [32,32,33,32,33] ⇒ 平均 32.4、週期 5；freeze 與一階 EFB（quantizer，精確有理數運算）。 */
export function computeT16(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T16
  const pattern = toggleCycle(i.target_lsb, i.toggle_period, 'spread')
  const grid = makeGrid(i.target_lsb, 'rational', 0)
  const run = (strategy: 'freeze' | 'toggle', steps: number) =>
    simulateStrategy(strategy, new Float64Array(steps).fill(grid.W0), makeCtx(QUANT_SETUP, grid, strategy, 1), { freezeW: grid.W0, integer: true })
  const toggle = run('toggle', 50)
  const freeze = run('freeze', 5)
  const comps = lineSpectrum(pattern)
  const ef = efbConstant({ target: i.target_lsb, steps: 5 })
  const sum = pattern.reduce((s, y) => s + y, 0)
  const errLines = lineSpectrum(pattern.map((y) => y - i.target_lsb)) // 誤差 e = y − 32.4 的譜線（k = 0, 1, 2）
  const isShift = (a: number[], b: number[]) => b.some((_, sh) => a.every((v, n) => v === b[(n + sh) % b.length])) // a 是 b 的循環移位？
  const fx10 = makeGrid(i.target_lsb, 'fixed', 10) // F = 10 個小數 bit：K = round(32.4·1024) = 33178
  return {
    id: 'T16',
    values: {
      mean: sum / pattern.length,
      period: detectPeriod(toggle.y),
      freeze_code: freeze.y[0],
      freeze_error_lsb: freeze.y[0] - i.target_lsb,
      dft_mag_list: [comps[0].mag, comps[1].mag, comps[2].mag, comps[2].mag, comps[1].mag], // 實數序列：|X_k| = |X_{5−k}|
      ef_period: efbPeriod(grid.W0, grid.D),
      ef_cycle: ef.y,
    },
    checks: [
      check(TX`週期：模擬偵測 vs $L/\gcd(k,L)$`, detectPeriod(toggle.y), togglePeriodOf(toggleK(grid.represented, i.toggle_period).k, i.toggle_period), 0, 'KMP 週期偵測 vs 數論公式'),
      check(TX`Parseval：譜線功率和 $=0.24\,\mathrm{LSB^2}$`, errLines.reduce((s, c) => s + c.power, 0), 0.24, 1e-12, TX`DFT 線功率 vs $p(1-p)$`, ['E47']),
      check(TX`主 tone 在 $2f_u/5$：功率 $0.20944\,\mathrm{LSB^2}$（$f_u/5$ 只有 $0.03056$）`, errLines[2].power, (3 + Math.sqrt(5)) / 25, 1e-12, TX`quantizer.lineSpectrum（$k=2$）vs $(3+\sqrt5)/25$`, ['E47', 'E15']),
      check(TX`一階 EFB（常數 32.4）$\equiv$ toggle 的循環移位`, isShift(ef.y, pattern) ? 1 : 0, 1, 0, 'efbConstant.y vs toggleCycle', ['E15']),
      check(TX`$F=10$ bit 定點：$32.4\to32.400390625$，EFB 週期 $512$（不是 5）`, efbPeriod(fx10.W0, fx10.D), 512, 0, TX`quantizer.efbPeriod $=2^F/\gcd(K,2^F)$`, ['E15']),
    ],
    calls: ['quantizer.toggleCycle', 'quantizer.simulateStrategy', 'quantizer.lineSpectrum', 'quantizer.efbConstant', 'quantizer.efbPeriod', 'quantizer.makeGrid', 'dsm.detectPeriod'],
  }
}
// #endregion

// #region core:T17
/** T17：32/33 隨機切換、P(33) = 0.4 ⇒ 平均 32.4、變異 0.24 LSB²（quantizer.bernoulliMoments；MC 在 worker）。 */
export function computeT17(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T17
  const m = bernoulliMoments(i.low_code, i.p_high)
  // 第二條路徑：直接對兩點分布求 E[y]、E[(y − E y)²]
  const mean2 = (1 - i.p_high) * i.low_code + i.p_high * i.high_code
  const var2 = (1 - i.p_high) * (i.low_code - mean2) ** 2 + i.p_high * (i.high_code - mean2) ** 2
  return {
    id: 'T17',
    values: { mean: m.mean, variance: m.variance, rms: m.rms },
    checks: [
      check(TX`平均：$y_{\rm lo}+p$ vs 兩點分布期望值 $\sum_kp_ky_k$`, m.mean, mean2, 1e-12, 'bernoulliMoments vs 定義'),
      check(TX`變異：$p(1-p)$ vs $\sum_kp_k(y_k-\bar y)^2$`, m.variance, var2, 1e-12, '封閉式 vs 定義'),
    ],
    calls: ['quantizer.bernoulliMoments'],
  }
}
// #endregion

// #region core:T18
/** T18：J = [[−1, 2], [2, −1]]、M = 0.2I ⇒ eig(I + MJ) = 1.2、0.4（mimo.analyzeRule；每個 loop 單獨穩定，一起更新卻發散）。 */
export function computeT18(): AcceptanceComputation {
  const i = ACCEPTANCE_INPUTS.T18
  const J = i.J.map((r) => [...r])
  const plant = buildPlant({ mode: 'J', Jn: J, sigmaV: SIGMA_KQ1, N: 4096 }) // K_q = 1：M_n = M
  const sc = analyzeRule(plant, rule({ rule: 'scalar', muKq: i.M_scalar }), J)
  const reg = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'J', gamma: i.reg_gamma, lambdaReg: i.reg_lambda }), J)
  const desc = (z: { re: number }[]) => z.map((p) => p.re).sort((a, b) => b - a)
  const s = svd(J).S // σ(J) = {3, 1}
  const regClosed = s.map((si) => 1 - (i.reg_gamma * si * si) / (si * si + i.reg_lambda)).sort((a, b) => b - a)
  // E24：M 由量測的 Ĵ 建構、plant 是真正的 J（近奇異：ρ = 0.99）⇒ poles 必須用 eig(I + M(Ĵ)J) 計算
  const Jrho = (rho: number) => [
    [-1, -rho],
    [-rho, -1],
  ]
  const nearSingular = buildPlant({ mode: 'J', Jn: Jrho(0.99), sigmaV: SIGMA_KQ1, N: 4096 })
  const mismatch = analyzeRule(nearSingular, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 0 }), Jrho(0.996))
  const mismatchPole = Math.min(...mismatch.poles.map((z) => z.re))
  return {
    id: 'T18',
    values: {
      A: (sc.A ?? [[Number.NaN]]) as Matrix,
      eig_A_desc: desc(sc.poles),
      eig_J_desc: inspectMatrix(J).eigSym?.values ?? [Number.NaN],
      single_loop_poles: J.map((row, k) => 1 + i.M_scalar * row[k]),
      spectral_radius: sc.spectralRadius,
      reg_poles_desc: desc(reg.poles),
    },
    checks: [
      check(TX`regularized poles：$\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)$ vs $1-\gamma\sigma_i^2/(\sigma_i^2+\lambda_{\rm reg})$`, desc(reg.poles)[0], regClosed[0], 1e-12, '數值 eigvals vs SVD 封閉式', ['E22', 'E24']),
      check(TX`$\rho(\mathbf A)=1.2>1$（發散）`, sc.spectralRadius, 1.2, 1e-12, 'analyzeRule.spectralRadius'),
      check(TX`$\hat{\mathbf J}\ne\mathbf J$（$\hat\rho=0.996$ vs $0.99$、$\gamma=1$、$\lambda_{\rm reg}=0$）：pole $=-1.5$，封閉式失效`, mismatchPole, -1.5, 1e-6, TX`mimo.analyzeRule：$\operatorname{eig}\big(\mathbf I+\mathbf M(\hat{\mathbf J})\mathbf J\big)$`, ['E24']),
    ],
    calls: ['mimo.buildPlant', 'mimo.analyzeRule', 'mimo.inspectMatrix', 'core.svd'],
  }
}
// #endregion

export const ACCEPTANCE_COMPUTE: Record<AcceptanceId, () => AcceptanceComputation> = {
  T01: computeT01,
  T02: computeT02,
  T03: computeT03,
  T04: computeT04,
  T05: computeT05,
  T06: computeT06,
  T07: computeT07,
  T08: computeT08,
  T09: computeT09,
  T10: computeT10,
  T11: computeT11,
  T12: computeT12,
  T13: computeT13,
  T14: computeT14,
  T15: computeT15,
  T16: computeT16,
  T17: computeT17,
  T18: computeT18,
}

/** 依序計算全部 T-id（每項附耗時；單項丟錯時以 error 回報，不中斷其他項） */
export function runAllAcceptance(now: () => number = () => Date.now()): { results: AcceptanceComputation[]; errors: Record<string, string> } {
  const results: AcceptanceComputation[] = []
  const errors: Record<string, string> = {}
  for (const id of ACCEPTANCE_IDS) {
    const t0 = now()
    try {
      const r = ACCEPTANCE_COMPUTE[id]()
      r.ms = now() - t0
      results.push(r)
    } catch (e) {
      errors[id] = e instanceof Error ? e.message : String(e)
    }
  }
  return { results, errors }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 反面測試（規格 §17 末段；golden/vectors/negative_tests.json）
// ═══════════════════════════════════════════════════════════════════════════

/** negative_tests.json 的每個 key，以章節模型即時計算 */
export function computeNegativeValues(): AcceptanceValues {
  const Kq = kq(100)
  const zm = [-1, -0.5, 0, 0.5, 1]
  const dc = [-1, -0.5, 0, 0.5, 1, 1.5]
  const avg = loopCore(4096, 4e9, 10, 100, 1, 'average')
  const sum = loopCore(4096, 4e9, 10, 100, 1, 'sum')
  return {
    reversed_polarity_pole: calPole(10, Kq, -1), // 極性反轉：p = 1 + μK_q
    missing_pe_eig_min: eig2x2(1, 1, 1).values[1], // 缺乏 PE：ρ = 1
    sum_mode_gain_multiplier: sum.g / avg.g, // N 改變卻忘記 scaling
    wrong_encoding_update_at_truth_zero_mean_code: meanGmacEncoding(300, 300, zm, zm.map(() => 1 / zm.length), 100, 'unipolar'),
    wrong_encoding_update_at_truth_dc_code: meanGmacEncoding(300, 300, dc, dc.map(() => 1 / dc.length), 100, 'unipolar'),
    misaligned_C_D4_phi0: toneCorrCodeDelay({ A: 1, mag: 1, phiRad: 0, omega: Math.PI / 6 }, 4), // code 錯位
    gmac_bits_required: accumulatorBitsRequired(6, 4096), // 定點 overflow
    gmac_17bit_wrapped_sum: wrapTwos(31 * 4096, 17),
  }
}

export interface PathConfusionCheck {
  /** ω/ω_n */
  nu: number
  hpdMag: number
  tMag: number
  /** |H_PD + T − 1|（應為 0：兩者互補） */
  sumErr: number
}

/** 反面「PLL 誤差與輸出路徑混淆」：H_PD = 1/(1 + L) 與 T = L/(1 + L) 互補；低頻 PD residual 小 ≠ 輸出雜訊小。 */
export function pathConfusionCheck(nus: number[] = [0.01, 0.1, 0.3, 1, 3], zeta = 0.7): PathConfusionCheck[] {
  return nus.map((nu) => {
    const h = ctHpd(nu, { zeta, wn: 1 })
    const t = ctT(nu, { zeta, wn: 1 })
    return { nu, hpdMag: Math.hypot(h.re, h.im), tMag: Math.hypot(t.re, t.im), sumErr: Math.hypot(h.re + t.re - 1, h.im + t.im) }
  })
}

/** 反面「低取樣率 aliasing」：f_x + f_w ≥ f_sim/2 時 simulateMixing 必須發出警告（回傳警告字串） */
export function aliasingWarnings(): { ok: string[]; aliased: string[] } {
  const base = t15MixingParams()
  return {
    ok: simulateMixing(base).warnings,
    aliased: simulateMixing({ ...base, fsim: 2 * (base.fx + base.fw) * 0.9 }).warnings,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Mutation：故意寫錯的公式（驗收機制必須抓到）
// ═══════════════════════════════════════════════════════════════════════════

// #region core:mutantPm
/** ✗ 故意寫錯：§8.2 PM 漏掉 /2。正確是 PM = 90° − asin(g/2)。 */
export function mutantPmMissingHalf(g: number): number {
  return 90 - (Math.asin(Math.min(g, 1)) * 180) / Math.PI // ← 差異：asin(g) 而不是 asin(g/2)
}
// #endregion

// #region core:mutantSigmaW
/** ✗ 故意寫錯：σ_w 的分母用 (1 − p) 而不是 (1 − p²)。正確是 σ_w = μ√(σ_η²/(1 − p²))。 */
export function mutantSigmaWOneMinusP(mu: number, sigmaEta2: number, p: number): number {
  return mu * Math.sqrt(sigmaEta2 / (1 - p)) // ← 差異：1 − p，少了 (1 + p) 因子
}
// #endregion

// #region core:mutantBw
/** ✗ 故意寫錯：把 (1 − p)/(2π)·f_u 近似當成 exact −3 dB（E26）。 */
export function mutantBwOneMinusP(p: number, fu: number): number {
  return ((1 - p) / (2 * Math.PI)) * fu // ← 差異：只取 −ln p 的一階泰勒，相對誤差 ≈ −(1 − p)/2
}
// #endregion

// #region core:mutantEnbw
/** ✗ 故意寫錯：把 −3 dB 頻寬當成「Noise BW」（ENBW）（E06）。 */
export function mutantEnbwAsF3db(p: number, fu: number): number {
  return (2 * Math.asin((1 - p) / (2 * Math.sqrt(p))) * fu) / (2 * Math.PI) // ← 差異：這是 f_3dB，不是 ENBW = (f_u/2)(1−p)/(1+p)
}
// #endregion

// #region core:mutantTie
/** ✗ 故意寫錯：偶數 N 照字面算嚴格 P(S_N > 0)，卻宣稱它等於 CLT 表格（E02）。 */
export function mutantStrictTieAsTable(N: number): number {
  return directionOutcomeExact(pPlus(1, 100), N, 'strict').correct // ← 差異：tie 算錯；CLT 無修正式近似的是 tie 平分
}
// #endregion

// #region core:mutantKq
/** ✗ 故意寫錯：§10.1 的 μ = 0.5 直接配上物理 K_q（忘了正規化，E05）。 */
export function mutantForgotKqNormalization(mu: number, lambdaMin: number): number {
  return 1 - mu * kq(100) * lambdaMin // ← 差異：K_q = 0.00798 fs⁻¹；規格的 0.995 隱含 K_q ≡ 1
}
// #endregion

// #region core:mutantSignVsMse
/** ✗ 故意寫錯：把無雜訊 Sign-LMS 的固定點當成 T12 的 1.34（E01）。 */
export function mutantSignLmsNoNoise(): number {
  const m: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0 }
  return signFixedPoint(m, buildCodeDistribution({ kind: 'five_level' })).w // ← 差異：σ_v = 0 的 Sign-LMS 收斂到 1.4（MAE 解）
}
// #endregion

// #region core:mutantSumMode
/** ✗ 故意寫錯：GMAC 改用總和卻沿用 average 的 μ（N 改變卻忘記 scaling）。 */
export function mutantSumModeG(): number {
  return loopCore(4096, 4e9, 10, 100, 1, 'sum').g // ← 差異：g 乘上 N = 4096
}
// #endregion

// #region core:mutantSignA
/** ✗ 故意寫錯：A = I − MJ（更新極性寫反）。正確是 A = I + MJ。 */
export function mutantAMinusMJ(J: number[][], m: number): number[] {
  const A = J.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - m * v)) // ← 差異：減號
  return eigSym(A).values
}
// #endregion

// #region core:mutantDeltaSign
/** ⚠ 不是 bug：δ = w − a（規格 §3 的極性，E39）的遞迴 pole 與 δ = a − w 相同，pole 測試本來就看不出差別。 */
export function mutantDeltaConventionPole(mu: number, x: number): number {
  return 1 - mu * x * x // ← 差異：δ_{n+1} = (1 − μx²)δ_n 對兩種極性都成立（線性齊次）
}
// #endregion

export interface MutantSpec {
  id: string
  /** 被比對的 golden vector 與 key */
  vector: AcceptanceId
  key: string
  /** key 為陣列時比對第幾個元素（省略 = 整個 key） */
  index?: number
  /** 驗收機制是否應判為不一致（false = 刻意展示「這個測試看不出來」） */
  expectDetected: boolean
  /** acceptance.ts 中的 region 名稱（頁面以 CodeBlock 顯示） */
  region: string
  /** 正確版本所在的檔案與 region（頁面以 CodeCompare 並排） */
  correct: { module: string; region: string }
  errata: string[]
  compute: () => Numeric
}

export const MUTANTS: MutantSpec[] = [
  { id: 'pm-missing-half', vector: 'T08', key: 'pm_deg', expectDetected: true, region: 'mutantPm', correct: { module: 'stability', region: 'pmFirstOrder' }, errata: [], compute: () => mutantPmMissingHalf(1) },
  {
    id: 'sigma-w-one-minus-p',
    vector: 'T13',
    key: 'sigma_w_fs',
    expectDetected: true,
    region: 'mutantSigmaW',
    correct: { module: 'calNoise', region: 'calLoop' },
    errata: ['E30'],
    compute: () => mutantSigmaWOneMinusP(10, 1 / 4096, 1 - 10 * kq(100)),
  },
  {
    id: 'bw-one-minus-p',
    vector: 'T14',
    key: 'bw_exact_3db_hz',
    expectDetected: true,
    region: 'mutantBw',
    correct: { module: 'calNoise', region: 'bwExact' },
    errata: ['E26', 'E10'],
    compute: () => mutantBwOneMinusP(1 - 10 * kq(100), 4e9 / 4096),
  },
  {
    id: 'enbw-as-f3db',
    vector: 'T14',
    key: 'enbw_one_sided_hz',
    expectDetected: true,
    region: 'mutantEnbw',
    correct: { module: 'calNoise', region: 'enbw' },
    errata: ['E06', 'E10'],
    compute: () => mutantEnbwAsF3db(1 - 10 * kq(100), 4e9 / 4096),
  },
  { id: 'strict-tie-as-table', vector: 'T05', key: 'p_clt_list', index: 0, expectDetected: true, region: 'mutantTie', correct: { module: 'comparator', region: 'applyTieRule' }, errata: ['E02', 'E07'], compute: () => mutantStrictTieAsTable(100) },
  { id: 'kq-forgotten', vector: 'T11', key: 'slow_pole', expectDetected: true, region: 'mutantKq', correct: { module: 'pe', region: 'eigenModes' }, errata: ['E05', 'E08'], compute: () => mutantForgotKqNormalization(0.5, 0.01) },
  { id: 'sign-vs-mse', vector: 'T12', key: 'w_star', expectDetected: true, region: 'mutantSignVsMse', correct: { module: 'bias', region: 'mseFixedPoint' }, errata: ['E01'], compute: mutantSignLmsNoNoise },
  { id: 'sum-mode-mu', vector: 'T13', key: 'g', expectDetected: true, region: 'mutantSumMode', correct: { module: 'calNoise', region: 'calLoop' }, errata: ['E18'], compute: mutantSumModeG },
  { id: 'a-minus-mj', vector: 'T18', key: 'eig_A_desc', expectDetected: true, region: 'mutantSignA', correct: { module: 'mimo', region: 'blockUpdate' }, errata: [], compute: () => mutantAMinusMJ([[-1, 2], [2, -1]], 0.2) },
  { id: 'delta-convention', vector: 'T01', key: 'pole', expectDetected: false, region: 'mutantDeltaSign', correct: { module: 'lms', region: 'fixedXPole' }, errata: ['E32', 'E39'], compute: () => mutantDeltaConventionPole(0.1, 2) },
]

export interface MutantResult {
  id: string
  value: Numeric
  expected: Numeric | null
  diff: ElementDiff | null
  /** 驗收機制判為不一致（= 抓到錯誤公式） */
  detected: boolean
  /** detected === expectDetected */
  asExpected: boolean
  /** mutant 本身丟出例外時的訊息（此時不算「抓到」，asExpected = false） */
  error?: string
}

/** 以與 compareToGolden 相同的規則評估每個 mutant（單一 mutant 丟錯不影響其他項） */
export function evaluateMutants(vectors: Partial<Record<AcceptanceId, GoldenVectorLike>>, mutants: readonly MutantSpec[] = MUTANTS): MutantResult[] {
  return mutants.map((m) => {
    const v = vectors[m.vector]
    let value: Numeric
    try {
      value = m.compute()
    } catch (e) {
      // 計算失敗 ≠ 驗收機制抓到錯誤公式：誠實回報，不讓整頁壞掉
      return { id: m.id, value: Number.NaN, expected: null, diff: null, detected: false, asExpected: false, error: e instanceof Error ? e.message : String(e) }
    }
    const raw = v?.expected[m.key]
    const exp = raw === undefined ? null : m.index !== undefined && Array.isArray(raw) ? (raw[m.index] as unknown) : raw
    if (!v || !isNumeric(exp)) return { id: m.id, value, expected: null, diff: null, detected: false, asExpected: false }
    const tol = v.tolerance_overrides?.[m.key] ?? v.tolerance
    const diff = diffNumeric(value, exp, tol)
    const detected = diff.shapeMismatch || diff.worstRatio > 1
    return { id: m.id, value, expected: exp, diff, detected, asExpected: detected === m.expectDetected }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Monte Carlo（worker）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * z：校準過的統計檢定（模型正確時 z ≈ N(0, 1)）；
 * model：與「線性化模型」比對，容忍度另含模型誤差項（不是純統計檢定；z 只供參考）；
 * behaviour：行為檢查（發散／收斂），沒有 z。
 */
export type McKind = 'z' | 'model' | 'behaviour'

export interface McPlanItem {
  key: string
  id: AcceptanceId
  kind: McKind
  /** agree：估計應與 target 一致（|z| ≤ z_crit）；reject：反面測試，應顯著不同（|z| > z_crit） */
  expect: 'agree' | 'reject'
  /** 是否提供獨立資訊（false：與同一批樣本的另一項完全相依，不計入「獨立檢查數」） */
  independent: boolean
  /** 這一項在檢查什麼（可含 `$…$` 行內 TeX） */
  label: string
  /** 估計的量（可含 `$…$`） */
  quantity: string
  method: string
}

/** Monte Carlo 檢查的固定清單（runAcceptanceMonteCarlo 依此順序輸出；頁面不必先執行就能列出項目數） */
export const MC_PLAN: readonly McPlanItem[] = [
  { key: 'T03-g', id: 'T03', kind: 'z', expect: 'agree', independent: true, label: TX`單步 MC：$g(2/3)=E[(1-\mu x^2)^2]=1$（T03 的正確驗法）`, quantity: TX`$g(2/3)$`, method: 'scalarStability.oneStepMc' },
  { key: 'T03-lambda', id: 'T03', kind: 'z', expect: 'agree', independent: true, label: TX`單步 MC：$\lambda(0.8)=E[\ln|1-0.8x^2|]<0$（樣本路徑收斂）`, quantity: TX`$\lambda(0.8)$`, method: 'scalarStability.oneStepMc vs lyapunovExponent' },
  { key: 'T04-p', id: 'T04', kind: 'z', expect: 'agree', independent: true, label: TX`sample-level comparator：$\hat p(q=+1)$ vs $\Phi(0.01)$`, quantity: TX`$P(q=+1)$`, method: 'comparator.runComparatorMC（逐個 Gaussian）' },
  { key: 'T05-odd', id: 'T05', kind: 'z', expect: 'agree', independent: true, label: TX`$N=42499$（奇數）判對率 vs exact Binomial`, quantity: TX`$P(S_N>0)$`, method: 'comparator.runComparatorMC（Binomial 引擎）' },
  { key: 'T05-strict', id: 'T05', kind: 'z', expect: 'reject', independent: true, label: TX`反面：$N=100$ 照字面算 strict，MC 不應等於表格的 $53.2\%$`, quantity: TX`$P(S_{100}>0)$`, method: 'comparator.runComparatorMC（strict，逐 sample）' },
  { key: 'T06-loop', id: 'T06', kind: 'model', expect: 'agree', independent: true, label: TX`閉迴路 block sign-LMS（$\phi=120^\circ$）：$\bar\delta_{k^*}$ 符合 $p=1.0199$ 的線性模型，且 $w$ 遠離 $a$`, quantity: TX`$E[\delta_{k^*}]\ [\mathrm{fs}]$`, method: 'polarity.runPolarityClosedLoop（逐 sample comparator + 有狀態 FIR）' },
  { key: 'T07-D4', id: 'T07', kind: 'model', expect: 'agree', independent: true, label: TX`$D=4$（$\theta=0^\circ$）：delayed-x 閉迴路收斂，符合 $p=1-\mu K_q\cdot0.5=0.96$`, quantity: TX`$E[\delta_{k^*}]\ [\mathrm{fs}]$`, method: TX`polarity.runPolarityClosedLoop（regressor $=x[n-D]$）` },
  { key: 'T07-D0', id: 'T07', kind: 'model', expect: 'agree', independent: true, label: TX`反面：同一路徑但 $D=0$（$\theta=-120^\circ$）$\Rightarrow C=-0.25<0$：符合 $p=1.0199$ 的發散`, quantity: TX`$E[\delta_{k^*}]\ [\mathrm{fs}]$`, method: TX`polarity.runPolarityClosedLoop（regressor $=x[n-D]$）` },
  { key: 'T12-sign', id: 'T12', kind: 'z', expect: 'agree', independent: true, label: TX`T12b：Sign-LMS（$\sigma_v=1$）block MC 的時間平均 $\bar w$ vs mean-field $1.340346$`, quantity: TX`$E[w]$`, method: 'bias.simulateBiasLms（16 條獨立 chain）' },
  { key: 'T13-var', id: 'T13', kind: 'z', expect: 'agree', independent: true, label: TX`精確 block sign-LMS（$x=\pm1\Rightarrow$ Binomial 化簡）：$\hat\sigma_w^2$ 的 chain 平均 vs $\sigma_w^2$（含有限樣本偏差修正）`, quantity: TX`$\sigma_w^2\ [\mathrm{fs^2}]$`, method: 'calNoise.runNoiseLab（binomial 引擎，24 條獨立 chain）' },
  { key: 'T14-enbw', id: 'T14', kind: 'z', expect: 'agree', independent: true, label: TX`由 MC 的 lag-1 自相關 $\hat p$ 推得 ENBW vs $20.289\,\mathrm{kHz}$（含 $\hat p$ 的偏差修正）`, quantity: TX`$\mathrm{ENBW}\ [\mathrm{Hz}]$`, method: TX`calNoise.runNoiseLab $\to\hat p\to\tfrac{f_u}{2}\tfrac{1-\hat p}{1+\hat p}$` },
  { key: 'T17-mean', id: 'T17', kind: 'z', expect: 'agree', independent: true, label: TX`Stochastic rounding：樣本平均 vs $32.4\,\mathrm{LSB}$`, quantity: TX`$E[y]\ [\mathrm{LSB}]$`, method: 'quantizer.simulateStrategy("stochastic")' },
  { key: 'T17-var', id: 'T17', kind: 'z', expect: 'agree', independent: false, label: TX`Stochastic rounding：樣本變異 vs $0.24\,\mathrm{LSB^2}$（兩點分布：與平均完全相依）`, quantity: TX`$\mathrm{Var}(y)\ [\mathrm{LSB^2}]$`, method: 'quantizer.simulateStrategy("stochastic")' },
  { key: 'T17-acf', id: 'T17', kind: 'z', expect: 'agree', independent: true, label: TX`Stochastic rounding：lag-1 自相關 vs $-1/n$（每次抽樣互相獨立 $=$ 白色，沒有 tone）`, quantity: TX`$r_1$`, method: 'quantizer.simulateStrategy("stochastic")' },
  { key: 'T18-div', id: 'T18', kind: 'behaviour', expect: 'agree', independent: true, label: TX`真正 1-bit sample 引擎：$\|\boldsymbol\delta_{300}\|\gg\|\boldsymbol\delta_0\|$（MIMO 一起更新發散）`, quantity: TX`$\|\boldsymbol\delta_{300}\|\ [\mathrm{fs}]$`, method: 'mimo.runMimoTrajectories（engine = sample）' },
]

export interface McCheck extends McPlanItem {
  estimate: number
  /** 標準誤（behaviour 類為 NaN） */
  se: number
  /** 期望值（解析、golden 或線性模型；已含估計量本身的有限樣本偏差修正） */
  target: number
  /** 原始統計量 t = (estimate − target)/se（behaviour 類為 NaN） */
  t: number
  /** SE 由幾個獨立樣本估計（自由度；Infinity：SE 由期望值的參數直接算出，或樣本數極大） */
  dof: number
  /** 等效常態分數：dof 有限時把 Student-t 的尾機率換算成 N(0, 1) 的 z（equivalentZ）；否則 z = t */
  z: number
  zCrit: number
  pass: boolean
  /** 抽樣量（comparator 決策數、chain × block 等） */
  samples: number
  seed: number
  /** 補充說明（可含 `$…$`） */
  note: string
  ms: number
}

export interface AcceptanceMcParams {
  seed: number
  /** 樣本數倍率（預設 1） */
  scale?: number
  /** z 判定門檻（預設 4） */
  zCrit?: number
  /** 只跑這些 T-id（省略 = 全部有 MC 的項目） */
  ids?: AcceptanceId[]
}

export interface AcceptanceMcResult {
  seed: number
  scale: number
  zCrit: number
  checks: McCheck[]
  totalMs: number
}

/** 有 Monte Carlo 驗證的 T-id（其餘為確定性封閉式 / 精確數值，MC 為 n/a） */
export const MC_IDS: AcceptanceId[] = ['T03', 'T04', 'T05', 'T06', 'T07', 'T12', 'T13', 'T14', 'T17', 'T18']

export const MC_SCALE_MIN = 0.05
export const MC_SCALE_MAX = 16

/** 把樣本數倍率夾在合法範圍 [0.05, 16] */
export function clampMcScale(scale: number | undefined): number {
  return Math.min(MC_SCALE_MAX, Math.max(MC_SCALE_MIN, scale ?? 1))
}

/** 兩點分布樣本變異數的標準誤：√((μ₄ − σ⁴)/n)，μ₄ = p(1−p)(1 − 3p(1−p)) */
export function bernoulliVarianceSe(p: number, n: number): number {
  const s2 = p * (1 - p)
  const mu4 = s2 * (1 - 3 * s2)
  return Math.sqrt(Math.max(0, mu4 - s2 * s2) / n)
}

// #region core:equivalentZ
/**
 * SE 由 ν + 1 個獨立樣本「估計」時，t = (θ̂ − θ)/SE 服從 Student-t（ν 個自由度），尾巴比 N(0, 1) 厚。
 * 為了讓每一項都用同一個門檻 z_crit（同一個誤報率），把 t 換成尾機率相同的常態分數：
 *   P(T_ν ≤ −|t|) = Φ(−|z|)  ⇒  z = sign(t)·|Φ⁻¹(F_ν(−|t|))|。
 */
export function equivalentZ(t: number, dof: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(dof)) return t // ν = ∞：t 本身就是 z
  const tail = studentTCdf(-Math.abs(t), dof) // 單尾機率（下尾直接算，保有相對精度）
  if (!(tail > 0)) return Math.sign(t) * 38 // 尾機率低於 double 可表示的範圍
  return Math.sign(t) * Math.abs(normInv(tail)) // ← 核心：尾機率相同的常態分位數
}
// #endregion

/**
 * equivalentZ 的反函數：|z_eq| ≤ z_crit ⇔ |t| ≤ t_crit(z_crit, ν)。ν = ∞ 時就是 z_crit；
 * ν 有限時 t_crit > z_crit（例：z_crit = 4、ν = 23 ⇒ t_crit ≈ 4.877）。用於把判定門檻換回「幾個估計的 SE」。
 */
export function tCritical(zCrit: number, dof: number): number {
  if (!Number.isFinite(dof) || !(zCrit > 0)) return zCrit
  let lo = zCrit // equivalentZ(t, ν) ≤ t ⇒ t_crit ≥ z_crit
  let hi = 2 * zCrit + 2
  for (let i = 0; i < 60 && equivalentZ(hi, dof) < zCrit; i++) hi *= 2
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi)
    if (equivalentZ(mid, dof) < zCrit) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

// #region core:ar1SampleBias
/** S₁ = Σ_{k=1}^{n−1}(n − k)pᵏ = p[n(1 − p) − (1 − pⁿ)]/(1 − p)²（AR(1) 自相關 pᵏ 的三角加權和） */
export function ar1LagSum(p: number, n: number): number {
  if (p === 1) return (n * (n - 1)) / 2
  return (p * (n * (1 - p) - (1 - Math.pow(p, n)))) / ((1 - p) * (1 - p))
}

/**
 * AR(1)（lag-k 自相關 pᵏ）取 n 個連續樣本、扣掉「樣本平均」後的樣本變異數 s²（除以 n − 1）：
 *   E[s²]/σ² = 1 − 2S₁/(n(n − 1)) ≈ 1 − 2p/((1 − p)n)（n ≫ 1/(1 − p)；正相關時 s² 低估 σ²）。
 */
export function ar1SampleVarianceFactor(p: number, n: number): number {
  return 1 - (2 * ar1LagSum(p, n)) / (n * (n - 1)) // ← 核心：x̄ 吃掉了一部分低頻變異
}

/**
 * 同一組樣本的 lag-1 自相關估計 r₁ = Σc_ic_{i+1}/Σc_i²（c = x − x̄）的期望值：
 *   E[num]/σ² = (n − 1)p − (n + 1)(n + 2S₁)/n² + 2(1 − pⁿ)/(n(1 − p))，E[den]/σ² = n − 1 − 2S₁/n；
 *   E[r₁] ≈ E[num]/E[den] − p/(nR)（R 條 chain 的 num、den 各自相加後再相除；R = 1 時 ≈ p − (1 + 3p)/n）。
 */
export function ar1Lag1Expectation(p: number, n: number, chains = 1): number {
  const S1 = ar1LagSum(p, n)
  const num = (n - 1) * p - ((n + 1) * (n + 2 * S1)) / (n * n) + (2 * (1 - Math.pow(p, n))) / (n * (1 - p))
  const den = n - 1 - (2 * S1) / n
  return num / den - p / (n * chains) // ← 核心：期望值的比 + 比值估計量的一階修正
}
// #endregion

/** 數字 → TeX（|x| < 1e−4 或 ≥ 1e7 時用科學記號 a\times10^{b}） */
export function texNumber(x: number, digits = 4): string {
  if (Number.isNaN(x)) return TX`\mathrm{NaN}`
  if (!Number.isFinite(x)) return x > 0 ? TX`\infty` : TX`-\infty`
  if (x === 0) return '0'
  const ax = Math.abs(x)
  const s = ax < 1e-4 || ax >= 1e7 ? x.toExponential(Math.max(0, digits - 1)) : Number(x.toPrecision(digits)).toString()
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  if (!m) return s
  const mant = m[1].includes('.') ? m[1].replace(/0+$/, '').replace(/\.$/, '') : m[1]
  return `${mant}\\times10^{${Number(m[2])}}`
}
const tn = texNumber

const PLAN_BY_KEY: Record<string, McPlanItem> = Object.fromEntries(MC_PLAN.map((p) => [p.key, p]))

interface McCore {
  estimate: number
  se: number
  target: number
  samples: number
  seed: number
  note: string
  ms: number
  /** SE 的自由度（省略 = Infinity） */
  dof?: number
}

// #region core:zCheck
/** 統計檢定（kind = 'z'）：t → 等效 z → 與 z_crit 比較 */
function zCheck(key: string, zCrit: number, c: McCore): McCheck {
  const plan = PLAN_BY_KEY[key]
  const dof = c.dof ?? Infinity // SE 的自由度；∞ = SE 已知
  const t = (c.estimate - c.target) / c.se // 原始統計量：偏離期望值幾個 SE
  const z = equivalentZ(t, dof) // ← 核心：SE 是估計出來的話，先換成尾機率相同的常態分數
  const inside = Number.isFinite(z) && Math.abs(z) <= zCrit // NaN（SE = 0 等）一律不算通過
  return { ...plan, ...c, dof, t, z, zCrit, pass: plan.expect === 'agree' ? inside : Number.isFinite(z) && !inside }
}
// #endregion

// #region core:runAcceptanceMonteCarlo
/**
 * (worker) 各 T-id 的 Monte Carlo：每項用 deriveSeed(seed, key) 的獨立亂數流，判定 |z| ≤ z_crit（預設 4 ⇒ 單項誤報率 ≈ 6.3e−5）。
 * 反面項目（expect = 'reject'）要求 |z| > z_crit：例如 N = 100 照字面算 strict 卻和表格 53.2% 比。
 * 估計量本身有已知的有限樣本偏差時（相關樣本的 s²、lag-1 自相關），target 先做偏差修正，z 才會是 N(0, 1)。
 */
export function runAcceptanceMonteCarlo(p: AcceptanceMcParams): AcceptanceMcResult {
  const scale = clampMcScale(p.scale)
  const zCrit = p.zCrit ?? 4
  const ids = new Set(p.ids ?? MC_IDS)
  const checks: McCheck[] = []
  const t00 = Date.now()
  const sd = (label: string) => deriveSeed(p.seed, label)
  const n = (base: number, min = 2) => Math.max(min, Math.round(base * scale))

  if (ids.has('T03')) {
    const t0 = Date.now()
    const samples = n(4e5, 1000)
    const gauss = { kind: 'gaussian', sigma: 1 } as const
    const r = oneStepMc({ mu: 2 / 3, dist: gauss, samples, seed: sd('T03') })
    checks.push(zCheck('T03-g', zCrit, { estimate: r.g, se: r.gSe, target: meanSquareFactor(2 / 3, 1, 3), samples, seed: sd('T03'), note: TX`只看一步 $f=1-\mu x^2$：$f^2$ 的變異數有限，$\pm\mathrm{SE}$ 可信；不可用長時間 $\delta_n^2$ 平均（heavy tail）。`, ms: Date.now() - t0 }))
    const t1 = Date.now()
    const r2 = oneStepMc({ mu: 0.8, dist: gauss, samples, seed: sd('T03-as') })
    checks.push(zCheck('T03-lambda', zCrit, { estimate: r2.lambda, se: r2.lambdaSe, target: lyapunovExponent(0.8, gauss), samples, seed: sd('T03-as'), note: TX`$\mu=0.8>2/3$：$E[\delta^2]$ 發散，但幾乎每條路徑仍收斂（三種界限 $2/3,\ 2,\ 2.4212$）。`, ms: Date.now() - t1 }))
  }

  if (ids.has('T04')) {
    const t0 = Date.now()
    const trials = n(1000, 10)
    const r = runComparatorMC({ s: 1, sigma: 100, N: 1000, trials, seed: sd('T04'), tieRule: 'half', method: 'sample' })
    const pp = pPlus(1, 100)
    const nDec = 1000 * r.trialsUsed
    const seExact = Math.sqrt((pp * (1 - pp)) / nDec) // H₀ 下的 SE：用期望值 p，不用 p̂
    checks.push(zCheck('T04-p', zCrit, { estimate: r.pHatPlus, se: seExact, target: pp, samples: nDec, seed: sd('T04'), note: TX`$(\hat p-\tfrac12)/\mathrm{SE}=${tn((r.pHatPlus - 0.5) / seExact, 3)}$；要讓 $1\,\mathrm{fs}$ 的偏移（$p-\tfrac12=${tn(pp - 0.5, 3)}$）達到 $z_{\rm crit}$ 個 SE，至少要 $n\ge\big(z_{\rm crit}\sqrt{p(1-p)}/(p-\tfrac12)\big)^2\approx${tn(((zCrit * Math.sqrt(pp * (1 - pp))) / (pp - 0.5)) ** 2, 3)}$ 個決策。`, ms: Date.now() - t0 }))
  }

  if (ids.has('T05')) {
    const t0 = Date.now()
    const trials = n(20000, 100)
    const pp = pPlus(1, 100)
    const exact = directionOutcomeExact(pp, 42499, 'strict').correct
    const r = runComparatorMC({ s: 1, sigma: 100, N: 42499, trials, seed: sd('T05'), tieRule: 'strict', method: 'binomial' })
    checks.push(zCheck('T05-odd', zCrit, { estimate: r.wilson.p, se: Math.sqrt((exact * (1 - exact)) / r.trialsUsed), target: exact, samples: r.trialsUsed, seed: sd('T05'), note: TX`奇數 $N$ 沒有 tie（本次 tie 次數 $=${r.counts.tie}$）。`, ms: Date.now() - t0 }))
    const t1 = Date.now()
    const trials2 = n(40000, 400)
    const r2 = runComparatorMC({ s: 1, sigma: 100, N: 100, trials: trials2, seed: sd('T05-E02'), tieRule: 'strict', method: 'sample' })
    const table = directionCltPlain(meanQ(1, 100), 100)
    checks.push(zCheck('T05-strict', zCrit, { estimate: r2.wilson.p, se: Math.sqrt((table * (1 - table)) / r2.trialsUsed), target: table, samples: 100 * r2.trialsUsed, seed: sd('T05-E02'), note: TX`精確 strict 值 $${tn(directionOutcomeExact(pp, 100, 'strict').correct, 5)}$；MC 的 tie 比例 $${tn(r2.counts.tie / r2.trialsUsed, 4)}$（精確 $${tn(directionExact(pp, 100).tie, 4)}$）。`, ms: Date.now() - t1 }))
  }

  const closedLoop = (key: string, phiDeg: number, D: number, expectDiverge: boolean, chainsBase: number) => {
    const t0 = Date.now()
    const chains = n(chainsBase, 2)
    const { results } = runPolarityClosedLoop({ cases: [{ ...DEFAULT_POLARITY_PARAMS, id: key, phiDeg, D, blocks: 300 }], seed: sd(key), chains, reference: false })
    const A = results[0]
    const c = A.check
    const t = (c.mean - c.pred) / c.sePred
    const status = c.status === 'n/a' ? TX`線性區不足 2 個 block，無法比對` : TX`$k^*=${c.k}$：$\bar\delta_{k^*}=${tn(c.mean)}$、線性模型 $${tn(c.pred)}\pm${tn(4 * c.sePred, 2)}\,\mathrm{fs}$（$4\sigma/\sqrt R$，$R=${chains}$）；$\langle\delta^2\rangle/(m^2+v)=${tn(c.msRatio, 3)}$（容許 $${tn(c.msLo, 2)}$–$${tn(c.msHi, 2)}$）`
    checks.push({
      ...PLAN_BY_KEY[key],
      estimate: c.mean,
      se: c.sePred,
      target: c.pred,
      t,
      dof: Infinity,
      z: t,
      zCrit,
      pass: c.status === 'ok' && A.diverging === expectDiverge,
      samples: chains * 300 * DEFAULT_POLARITY_PARAMS.N,
      seed: sd(key),
      note: TX`$C=${tn(A.C)}$、$p=${tn(A.pole, 6)}$；${status}；最後一個 block 的 $w$ ${A.diverging ? '已遠離 $a$' : '留在 $a$ 附近'}（預期${expectDiverge ? '遠離' : '收斂'}）。判定沿用 polarity 模型的兩個動差檢查：平均值容許 $4\,\mathrm{SE}+10\%|m_{k^*}|+2\%|\delta_0|$，均方比用 $\chi^2$ 區間再放寬 $\pm25\%$（線性化誤差）。`,
      ms: Date.now() - t0,
    })
  }
  if (ids.has('T06')) closedLoop('T06-loop', 120, 0, true, 8)
  if (ids.has('T07')) {
    closedLoop('T07-D4', -120, 4, false, 6)
    closedLoop('T07-D0', -120, 0, true, 6)
  }

  if (ids.has('T12')) {
    const t0 = Date.now()
    const blocks = n(6000, 400)
    const chains = 16
    const model: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 1 }
    const mf = signFixedPoint(model, buildCodeDistribution({ kind: 'five_level' })).w
    const r = simulateBiasLms({ model, code: { kind: 'five_level' }, algorithm: 'sign', dcMode: 'none', mu: 0.0125, N: 32, blocks, chains, w0: 1.34, seed: sd('T12'), traceChains: 0 })
    checks.push(zCheck('T12-sign', zCrit, { estimate: r.mean, se: r.se, target: mf, dof: chains - 1, samples: r.totalSamples, seed: sd('T12'), note: TX`$\mu=0.0125$、$N=32$；SE 由 ${chains} 條 chain 的離散程度估計（$\nu=${chains - 1}$）；前後半窗漂移檢查 ${r.driftCheck.settled ? '通過' : '未通過'}。`, ms: Date.now() - t0 }))
  }

  if (ids.has('T13') || ids.has('T14')) {
    const t0 = Date.now()
    const blocks = n(4000, 200)
    const chains = 24
    const r = runNoiseLab({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1, engine: 'binomial', blocks, chains, seed: sd('T13') })
    const pTrue = r.loop.p
    if (ids.has('T13')) {
      const s2 = Array.from(r.sigmaWChains, (s) => s * s)
      const mean = s2.reduce((a, b) => a + b, 0) / s2.length
      const se = Math.sqrt(s2.reduce((a, b) => a + (b - mean) ** 2, 0) / (s2.length - 1) / s2.length)
      const factor = ar1SampleVarianceFactor(pTrue, blocks) // E[s²]/σ_w²：相關樣本扣掉自己的平均後 s² 偏低
      checks.push(zCheck('T13-var', zCrit, { estimate: mean, se, target: r.loop.sigmaW2 * factor, dof: chains - 1, samples: chains * blocks, seed: sd('T13'), note: TX`$\hat\sigma_w=${tn(Math.sqrt(mean))}\,\mathrm{fs}$（線性模型 $${tn(r.loop.sigmaW)}$）；每條 chain $n=${blocks}$ 個相關樣本 $\Rightarrow E[s^2]=${tn(factor, 5)}\,\sigma_w^2$；chain 間獨立，SE 用 ${chains} 條的離散程度（$\nu=${chains - 1}$）。`, ms: Date.now() - t0 }))
    }
    if (ids.has('T14')) {
      const nTot = chains * blocks
      const pHat = r.pHat
      const pExp = ar1Lag1Expectation(pTrue, blocks, chains) // E[p̂]：lag-1 自相關估計量的有限樣本偏差
      const seP = Math.sqrt(Math.max(0, 1 - pTrue * pTrue) / nTot) // Bartlett：Var(r₁) ≈ (1 − p²)/n
      const enbw = (q: number) => (r.loop.fu / 2) * ((1 - q) / (1 + q))
      const dEnbw = r.loop.fu / (1 + pTrue) ** 2 // |d ENBW/dp|（delta method）
      checks.push(zCheck('T14-enbw', zCrit, { estimate: enbw(pHat), se: dEnbw * seP, target: enbw(pExp), samples: nTot, seed: sd('T13'), note: TX`$\hat p=${tn(pHat, 6)}$（解析 $p=${tn(pTrue, 6)}$；估計量的期望值 $E[\hat p]=${tn(pExp, 6)}$）；解析 ENBW $=${tn(r.loop.enbw, 6)}\,\mathrm{Hz}$；SE 以 delta method：$\tfrac{f_u}{(1+p)^2}\sqrt{(1-p^2)/n}$。與 T13 用同一批樣本。`, ms: Date.now() - t0 }))
    }
  }

  if (ids.has('T17')) {
    const t0 = Date.now()
    const nS = n(1e6, 1000)
    const grid = makeGrid(32.4, 'rational', 0)
    const sim = simulateStrategy('stochastic', new Float64Array(nS).fill(grid.W0), makeCtx(QUANT_SETUP, grid, 'stochastic', sd('T17')), { freezeW: grid.W0, integer: true })
    let s = 0
    for (let k = 0; k < nS; k++) s += sim.y[k]
    const mean = s / nS
    let v = 0
    let c1 = 0
    for (let k = 0; k < nS; k++) {
      const d = sim.y[k] - mean
      v += d * d
      if (k + 1 < nS) c1 += d * (sim.y[k + 1] - mean)
    }
    const variance = v / (nS - 1)
    const ms = Date.now() - t0
    checks.push(zCheck('T17-mean', zCrit, { estimate: mean, se: Math.sqrt(0.24 / nS), target: 32.4, samples: nS, seed: sd('T17'), note: TX`$\mathrm{SE}=\sqrt{p(1-p)/n}$`, ms }))
    checks.push(zCheck('T17-var', zCrit, { estimate: variance, se: bernoulliVarianceSe(0.4, nS), target: 0.24, samples: nS, seed: sd('T17'), note: TX`$\mathrm{SE}=\sqrt{(\mu_4-\sigma^4)/n}$；兩點分布的 $s^2=\tfrac{n}{n-1}\hat p(1-\hat p)$ 完全由 $\hat p$ 決定，所以這一項的 $z$ 幾乎等於上一項（不是獨立證據）。`, ms }))
    checks.push(zCheck('T17-acf', zCrit, { estimate: c1 / v, se: 1 / Math.sqrt(nS), target: -1 / nS, samples: nS, seed: sd('T17'), note: TX`iid 序列的 $E[r_1]\approx-1/n$、$\mathrm{SE}\approx1/\sqrt n$；週期 toggle 的 $r_1=${tn(toggleLag1(), 4)}$ 會立刻被抓到。`, ms }))
  }

  if (ids.has('T18')) {
    const t0 = Date.now()
    const J = ACCEPTANCE_INPUTS.T18.J.map((r) => [...r])
    const res = runMimoTrajectories({ plant: { mode: 'J', Jn: J, sigmaV: 100, N: 256 }, cases: [rule({ rule: 'scalar', muKq: 0.2 })], delta0: [5, 5], blocks: 300, engine: 'sample', jhat: { source: 'exact' }, seed: sd('T18') })
    const c0 = res.cases[0]
    const last = c0?.norm[300] ?? Number.NaN
    const start = Math.hypot(5, 5)
    checks.push({
      ...PLAN_BY_KEY['T18-div'],
      estimate: last,
      se: Number.NaN,
      target: 10 * start,
      t: Number.NaN,
      dof: Infinity,
      z: Number.NaN,
      zCrit,
      pass: res.ok && Number.isFinite(last) && last > 10 * start,
      samples: 300 * 256,
      seed: sd('T18'),
      note: TX`判定：$\|\boldsymbol\delta_{300}\|>10\|\boldsymbol\delta_0\|$。1-bit 時 $|G|\le1$，所以是線性漂移而不是 $1.2^k$ 的指數成長（行為檢查，沒有 $z$）。`,
      ms: Date.now() - t0,
    })
  }

  return { seed: p.seed, scale, zCrit, checks, totalMs: Date.now() - t00 }
}
// #endregion

/** 週期 5 toggle [32,32,33,32,33] 的 lag-1 自相關（循環）：Σe_ne_{n+1}/Σe_n² = −2/3（對照 stochastic rounding 的 ≈ 0） */
export function toggleLag1(): number {
  const e = TOGGLE_PATTERN_5.map((y) => y - 32.4)
  let num = 0
  let den = 0
  for (let k = 0; k < e.length; k++) {
    num += e[k] * e[(k + 1) % e.length]
    den += e[k] * e[k]
  }
  return num / den
}

/** z_crit 下單項雙尾誤報率 2(1 − Φ(z))（normSf 在尾端保有相對精度） */
export function falseAlarmRate(z: number): number {
  return 2 * normSf(z)
}

/** 若把 Student-t（ν 個自由度）的統計量直接和 z_crit 比，實際的雙尾誤報率 2·F_ν(−z_crit)（> 常態的 2Φ(−z_crit)） */
export function falseAlarmRateT(zCrit: number, dof: number): number {
  return Number.isFinite(dof) ? 2 * studentTCdf(-Math.abs(zCrit), dof) : falseAlarmRate(zCrit)
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. 多 seed 校準：z 本身是不是 N(0, 1)？（worker）
// ═══════════════════════════════════════════════════════════════════════════

export interface McSweepParams {
  seed: number
  /** seed 個數 K（2…200） */
  runs: number
  scale?: number
  zCrit?: number
  ids?: AcceptanceId[]
}

export interface McSweepRow extends McPlanItem {
  /** 每個 seed 的等效 z（behaviour 類為 NaN） */
  z: number[]
  /** 通過的 seed 數 */
  passCount: number
  meanZ: number
  sdZ: number
  /** z̄·√K：模型正確且 SE 正確時 ≈ N(0, 1)（偵測「估計量有偏差」） */
  meanScore: number
  /** (K − 1)s_z² ~ χ²_{K−1} 的等效常態分數（Wilson–Hilferty；偵測「SE 算錯」） */
  sdScore: number
  /** 兩個分數都在 ±SWEEP_SCORE_CRIT 內；非校準項目（model / behaviour / reject）為 null */
  calibrated: boolean | null
}

export interface McSweepResult {
  seed: number
  runs: number
  scale: number
  zCrit: number
  seeds: number[]
  rows: McSweepRow[]
  /** 所有校準項目（kind = 'z'、expect = 'agree'、independent）的 z 合併後對 N(0, 1) 的檢定 */
  pooled: {
    n: number
    mean: number
    sd: number
    /** Kolmogorov–Smirnov 統計量 D = sup|F_n(z) − Φ(z)| 與 √n·D */
    ksD: number
    ksScaled: number
    /** |z| > 2 的比例（N(0, 1) 的理論值 4.55%） */
    fracBeyond2: number
    /** 排序後的 z（畫 Q–Q 圖用） */
    sorted: number[]
  }
  totalMs: number
}

/** 校準分數的門檻（±3.5 ⇒ 單項誤報 4.7e−4） */
export const SWEEP_SCORE_CRIT = 3.5
/** KS 檢定 √n·D 的門檻：Kolmogorov 分布 α = 0.001 的臨界值 */
export const KS_CRIT_001 = 1.949

// #region core:sweepScores
/** K 個 z 的兩個校準分數：平均值分數 z̄√K，與變異數的 χ² 等效常態分數（Wilson–Hilferty 立方根近似） */
export function sweepScores(z: ArrayLike<number>): { mean: number; sd: number; meanScore: number; sdScore: number } {
  const K = z.length
  let m = 0
  for (let i = 0; i < K; i++) m += z[i]
  m /= K
  let ss = 0
  for (let i = 0; i < K; i++) ss += (z[i] - m) ** 2
  const nu = K - 1
  const s2 = ss / nu
  const meanScore = m * Math.sqrt(K) // Var(z̄) = 1/K
  const sdScore = (Math.cbrt(s2) - (1 - 2 / (9 * nu))) / Math.sqrt(2 / (9 * nu)) // ← 核心：(χ²_ν/ν)^{1/3} ≈ N(1 − 2/(9ν), 2/(9ν))
  return { mean: m, sd: Math.sqrt(s2), meanScore, sdScore }
}

/** Kolmogorov–Smirnov：D = sup|F_n − Φ|（輸入需已排序） */
export function ksStatistic(sorted: ArrayLike<number>): number {
  const n = sorted.length
  let d = 0
  for (let i = 0; i < n; i++) {
    const F = 1 - normSf(sorted[i]) // Φ(z)
    d = Math.max(d, Math.abs((i + 1) / n - F), Math.abs(i / n - F)) // 階梯函數在每個跳點的上下兩側
  }
  return d
}
// #endregion

/** (worker) 同一組 MC 檢查換 K 個 seed 重跑，回傳每項 z 的分布與校準分數。 */
export function runAcceptanceMcSweep(p: McSweepParams): McSweepResult {
  const t0 = Date.now()
  const runs = Math.min(200, Math.max(2, Math.round(p.runs)))
  const scale = clampMcScale(p.scale)
  const zCrit = p.zCrit ?? 4
  const seeds = Array.from({ length: runs }, (_, i) => deriveSeed(p.seed, `sweep-${i}`))
  const acc = new Map<string, { z: number[]; pass: number }>()
  const order: string[] = []
  for (const seed of seeds) {
    for (const c of runAcceptanceMonteCarlo({ seed, scale, zCrit, ids: p.ids }).checks) {
      let a = acc.get(c.key)
      if (!a) {
        a = { z: [], pass: 0 }
        acc.set(c.key, a)
        order.push(c.key)
      }
      a.z.push(c.z)
      if (c.pass) a.pass++
    }
  }
  const pooledZ: number[] = []
  const rows: McSweepRow[] = order.map((key) => {
    const plan = PLAN_BY_KEY[key]
    const a = acc.get(key)!
    const usable = plan.kind === 'z' && a.z.every((v) => Number.isFinite(v))
    const sc = usable ? sweepScores(a.z) : { mean: Number.NaN, sd: Number.NaN, meanScore: Number.NaN, sdScore: Number.NaN }
    const isCal = usable && plan.expect === 'agree'
    if (isCal && plan.independent) pooledZ.push(...a.z)
    return {
      ...plan,
      z: a.z,
      passCount: a.pass,
      meanZ: sc.mean,
      sdZ: sc.sd,
      meanScore: sc.meanScore,
      sdScore: sc.sdScore,
      calibrated: isCal ? Math.abs(sc.meanScore) <= SWEEP_SCORE_CRIT && Math.abs(sc.sdScore) <= SWEEP_SCORE_CRIT : null,
    }
  })
  const sorted = pooledZ.slice().sort((x, y) => x - y)
  const nP = sorted.length
  const pm = nP ? sorted.reduce((s, v) => s + v, 0) / nP : Number.NaN
  const psd = nP > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - pm) ** 2, 0) / (nP - 1)) : Number.NaN
  const ksD = nP ? ksStatistic(sorted) : Number.NaN
  return {
    seed: p.seed,
    runs,
    scale,
    zCrit,
    seeds,
    rows,
    pooled: { n: nP, mean: pm, sd: psd, ksD, ksScaled: ksD * Math.sqrt(nP), fracBeyond2: nP ? sorted.filter((v) => Math.abs(v) > 2).length / nP : Number.NaN, sorted },
    totalMs: Date.now() - t0,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. 勘誤的數值證據：用章節模型即時重算 docs/validation.md 引用的數字
// ═══════════════════════════════════════════════════════════════════════════

export interface ErratumEvidence {
  eid: string
  /** 這個數字是什麼（可含 `$…$` 行內 TeX） */
  label: string
  /** 網站即時算出的值 */
  value: number
  /** errata.json（evidence / correction / problem 欄）中逐字出現的數字字串 */
  refText: string
  reference: number
  /** 容許誤差：引用寫到小數第 d 位 ⇒ 0.51 × 10^{−d}（四捨五入的半格，加 2% 餘裕） */
  tol: number
  pass: boolean
  /** 呼叫的模型函式 */
  call: string
}

// #region core:parseQuotedNumber
/** 把文件中引用的數字字串轉成數值與小數位數：接受 U+2212「−」、前置「+」、千分位逗號。 */
export function parseQuotedNumber(text: string): { value: number; decimals: number } {
  const clean = text.trim().replace(/−/g, '-').replace(/,/g, '').replace(/^\+/, '')
  if (!/^-?\d+(\.\d+)?$/.test(clean)) throw new Error(`parseQuotedNumber：無法解析「${text}」`)
  const dot = clean.indexOf('.')
  return { value: Number(clean), decimals: dot < 0 ? 0 : clean.length - dot - 1 }
}

/** 「引用精度」規則：|value − reference| ≤ 0.51·10^{−decimals}（+ 1 ulp 等級的浮點餘裕） */
export function quotedTolerance(reference: number, decimals: number): number {
  return 0.51 * Math.pow(10, -decimals) + 4 * Number.EPSILON * Math.abs(reference)
}
// #endregion

function ev(eid: string, label: string, value: number, refText: string, call: string): ErratumEvidence {
  const { value: reference, decimals } = parseQuotedNumber(refText)
  const tol = quotedTolerance(reference, decimals)
  return { eid, label, value, refText, reference, tol, pass: Math.abs(value - reference) <= tol, call }
}

const phaseDeg = (z: { re: number; im: number }) => (Math.atan2(z.im, z.re) * 180) / Math.PI

/**
 * 勘誤的即時證據：每一項都呼叫章節模型重算，並與 errata.json 逐字引用的數字比到「引用的小數位數」。
 * acceptance.test.ts 會檢查 refText 真的出現在該勘誤的文字裡（不是另外手寫的數字）。
 */
export function computeErrataEvidence(): ErratumEvidence[] {
  const out: ErratumEvidence[] = []
  const add = (eid: string, label: string, value: number, refText: string, call: string) => out.push(ev(eid, label, value, refText, call))

  // ── E01 / E11 / E17 / E03：Bias & INL 的固定點 ──
  const five = buildCodeDistribution({ kind: 'five_level' })
  const cubic = (sigmaV: number, extra: Partial<ErrorModel> = {}): ErrorModel => ({ a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV, ...extra })
  for (const [sig, ref] of [
    [0.01, '1.396628'],
    [0.05, '1.383138'],
    [0.1, '1.366577'],
    [0.3, '1.343850'],
    [1, '1.340346'],
    [10, '1.3400035'],
  ] as const) {
    add('E01', TX`Sign-LMS mean-field 固定點 $w^*(\sigma_v=${sig})$`, signFixedPoint(cubic(sig), five).w, ref, 'bias.signFixedPoint')
  }
  add('E11', TX`Gaussian $\mathcal N(0,1)$ code 的 MSE 解 $a+c_3E[x^4]/E[x^2]$`, mseFixedPoint(cubic(1), buildCodeDistribution({ kind: 'gaussian' })), '1.30', 'bias.mseFixedPoint')
  add('E11', TX`$\pm1$ code 的 MSE 解`, mseFixedPoint(cubic(1), buildCodeDistribution({ kind: 'pm_one' })), '1.10', 'bias.mseFixedPoint')
  const jit = { jitterSlope: 0.25, jitterRef: -2 } // σ_v(x) = √(1 + 0.25(x + 2)²)
  add('E17', TX`code-dependent $\sigma_v(x)$、$b=0.2$、$d=0$：Sign-LMS mean-field $w^*$（centering 失效）`, signFixedPoint({ a: 1, b: 0.2, c2: 0, c3: 0, kappa: 0, sigmaV: 1, ...jit }, five).w, '0.9601', 'bias.signFixedPoint')
  add('E17', TX`同上再加 $c_3=0.1$`, signFixedPoint(cubic(1, { b: 0.2, ...jit }), five).w, '1.3008', 'bias.signFixedPoint')
  add('E17', TX`$\sigma_v$ 為常數時（$b=0.2,\ c_3=0.1$）`, signFixedPoint(cubic(1, { b: 0.2 }), five).w, '1.3403', 'bias.signFixedPoint')
  const uni = buildCodeDistribution({ kind: 'unipolar4' })
  const offs: ErrorModel = { a: 1, b: 0.5, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
  const inl2: ErrorModel = { a: 1, b: 0, c2: 0.1, c3: 0, kappa: 0, sigmaV: 1 }
  add('E03', TX`$x\in\{0,1,2,3\}$、$b=0.5$：靜態式 $a+bE[x]/E[x^2]$`, mseFixedPoint(offs, uni), '1.2143', 'bias.mseFixedPoint')
  add('E03', TX`同上：Sign-LMS mean-field（$\sigma_v=1$）`, signFixedPoint(offs, uni).w, '1.2141', 'bias.signFixedPoint')
  add('E03', TX`$d=0.1x^2$：靜態式 $a+0.1E[x^3]/E[x^2]$`, mseFixedPoint(inl2, uni), '1.2571', 'bias.mseFixedPoint')
  add('E03', TX`$d=0.1x^2$、shared BBPD（$E[q]=0$）：$a+\operatorname{Cov}(x,d)/\operatorname{Var}(x)$`, mseFixedPoint(inl2, uni, 'shared_bbpd'), '1.3000', "bias.mseFixedPoint(dc = 'shared_bbpd')")

  // ── E02 / E07 / E18：comparator 的方向機率與 tie ──
  const pp = pPlus(1, 100)
  const mq = meanQ(1, 100)
  const d100 = directionExact(pp, 100)
  add('E02', TX`$p=\Phi(0.01)$`, pp, '0.503989356', 'comparator.pPlus')
  add('E02', TX`$m=E[q]$`, mq, '0.0079787126', 'comparator.meanQ')
  add('E02', TX`$N=100$：嚴格 $P(S_N>0)$`, d100.pos, '0.492050', 'comparator.directionExact')
  add('E02', TX`$N=100$：$P(S_N=0)$`, d100.tie, '0.079336', 'comparator.directionExact')
  add('E02', TX`$N=100$：CLT 無修正式`, directionCltPlain(mq, 100), '0.531798', 'comparator.directionCltPlain')
  add('E02', TX`$N=100$：tie 平分`, directionOutcomeExact(pp, 100, 'half').correct, '0.531718', "comparator.directionOutcomeExact('half')")
  add('E02', TX`$N=101$（奇數，無 tie）`, directionOutcomeExact(pp, 101, 'strict').correct, '0.532034', 'comparator.directionOutcomeExact')
  add('E02', TX`$N=10000$：嚴格 $P(S_N>0)$`, directionOutcomeExact(pp, 10000, 'strict').correct, '0.784624', 'comparator.directionOutcomeExact')
  add('E07', TX`$N=100$：$P(S_N\ge0)$（$\operatorname{sign}(0)=+1$）`, directionOutcomeExact(pp, 100, 'plus').correct, '0.5714', "comparator.directionOutcomeExact('plus')")
  add('E07', TX`$N=1000$：$P(S_N\ge0)$`, directionOutcomeExact(pp, 1000, 'plus').correct, '0.6118', "comparator.directionOutcomeExact('plus')")
  const sm = sumMoments(10000, mq)
  add('E18', TX`$N=10^4$：$E[S_N]=Nm$`, sm.meanSum, '79.787', 'comparator.sumMoments')
  add('E18', TX`$N=10^4$：$\mathrm{SD}(S_N)=\sqrt{N(1-m^2)}$`, sm.sdSum, '99.997', 'comparator.sumMoments')
  add('E18', TX`$N=10^4$：$\mathrm{SD}(G)=\mathrm{SD}(S_N)/N$`, sm.sdAvg, '0.0099997', 'comparator.sumMoments')

  // ── E05 / E08 / E21 / E23 / E24 / E37：PE 與 MIMO ──
  const Kq = kq(100)
  const slowPhys = 1 - 0.5 * Kq * 0.01
  add('E05', TX`$K_q=\sqrt{2/\pi}/100\ [\mathrm{fs^{-1}}]$`, Kq, '0.0079788456', 'comparator.kq')
  add('E05', TX`物理 $K_q$ 下的慢 pole $1-\mu K_q\lambda_{\min}$`, slowPhys, '0.99996011', 'comparator.kq')
  add('E05', TX`95% 衰減所需 blocks $\lceil\ln0.05/\ln p\rceil$`, stepsToDecay(slowPhys, 0.05), '75,091', 'pe.stepsToDecay')
  add('E05', TX`$\mathbf M=0.5\mathbf R^{-1}$（未除 $K_q$）的 pole $1-0.5K_q$`, 1 - 0.5 * Kq, '0.99601', 'comparator.kq')
  const Rinv = inv(corr2(0.99))
  add('E08', TX`$[\mathbf R^{-1}]_{11}$`, Rinv[0][0], '50.2513', 'core.inv(pe.corr2)')
  add('E08', TX`$[\mathbf R^{-1}]_{12}$`, Rinv[0][1], '−49.7487', 'core.inv(pe.corr2)')
  add('E21', TX`$1/(1-\rho^2)$`, Rinv[0][0], '50.2512563', 'core.inv(pe.corr2)')
  add('E21', TX`$-\rho/(1-\rho^2)$`, Rinv[0][1], '−49.7487437', 'core.inv(pe.corr2)')
  add('E21', TX`$\operatorname{eig}(0.5\mathbf R^{-1})$ 的較小者`, eigSym(Rinv.map((row) => row.map((v) => 0.5 * v))).values[1], '0.2512563', 'core.eigSym')
  add('E21', TX`preconditioned 慢模式變異 $\times N$（$K_q=1,\ \gamma=0.5$）`, preconditionedModeVar(0.5, 1, 1, 0.01), '33.333', 'mimo.preconditionedModeVar')
  add('E21', TX`一般 LMS（$\mu=0.5$）慢模式變異 $\times N$`, modeVarianceClosed(0.5, 0.01, 1, 1), '0.25063', 'mimo.modeVarianceClosed')
  add('E21', TX`兩者的比（雜訊放大倍數）`, preconditionedModeVar(0.5, 1, 1, 0.01) / modeVarianceClosed(0.5, 0.01, 1, 1), '133.0', 'mimo.preconditionedModeVar / modeVarianceClosed')
  add('E23', TX`均方 spectral radius（Gaussian、$N=1$）`, meanSquareRadius('gaussian', 0.99, 0.5, 1), '1.9801', 'pe.meanSquareRadius')
  add('E23', TX`均方 spectral radius（$N=2$）`, meanSquareRadius('gaussian', 0.99, 0.5, 2), '0.99254', 'pe.meanSquareRadius')
  add('E23', TX`均方 spectral radius（$N=16$）`, meanSquareRadius('gaussian', 0.99, 0.5, 16), '0.99003', 'pe.meanSquareRadius')
  const Jrho = (rho: number) => [
    [-1, -rho],
    [-rho, -1],
  ]
  const plant = buildPlant({ mode: 'J', Jn: Jrho(0.99), sigmaV: SIGMA_KQ1, N: 4096 })
  const regPoles = (rhoHat: number, gamma: number, lam: number) =>
    analyzeRule(plant, rule({ rule: 'regularized', regForm: 'J', gamma, lambdaReg: lam }), Jrho(rhoHat))
      .poles.map((z) => z.re)
      .sort((x, y) => x - y)
  const pa = regPoles(0.94, 0.5, 0)
  add('E24', TX`$\hat\rho=0.94,\ \gamma=0.5,\ \lambda_{\rm reg}=0$：較小的 pole（公式預期 $0.5$）`, pa[0], '0.487', 'mimo.analyzeRule')
  add('E24', TX`同上：較大的 pole`, pa[1], '0.917', 'mimo.analyzeRule')
  add('E24', TX`$\hat\rho=0.996,\ \gamma=1,\ \lambda_{\rm reg}=0$：發散的 pole`, regPoles(0.996, 1, 0)[0], '−1.5', 'mimo.analyzeRule')
  add('E24', TX`同上加 $\lambda_{\rm reg}=10^{-4}$：較大的 pole（恢復穩定）`, regPoles(0.996, 1, 1e-4)[1], '0.655', 'mimo.analyzeRule')
  add('E37', TX`eigen-mode 變異（$\lambda=0.01$）$\ [\mathrm{fs^2}]$`, preconditionedModeVar(0.5, Kq, 4096, 0.01), '127.83', 'mimo.preconditionedModeVar')
  add('E37', TX`eigen-mode 變異（$\lambda=1.99$）`, preconditionedModeVar(0.5, Kq, 4096, 1.99), '0.642', 'mimo.preconditionedModeVar')
  add('E37', TX`每個參數的變異 $=\tfrac12(\text{兩個 mode 之和})$`, 0.5 * (preconditionedModeVar(0.5, Kq, 4096, 0.01) + preconditionedModeVar(0.5, Kq, 4096, 1.99)), '64.24', 'mimo.preconditionedModeVar')

  // ── E06 / E10 / E13 / E26 / E27 / E28 / E29 / E30：校正迴路的頻寬與雜訊 ──
  const lp = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 })
  add('E06', TX`$p=1-\mu K$`, lp.p, '0.920211544', 'calNoise.calLoop')
  add('E06', TX`exact $f_{3\rm dB}\ [\mathrm{Hz}]$`, lp.f3dbExact, '12931.28', 'calNoise.calLoop')
  add('E06', TX`one-sided ENBW $[\mathrm{Hz}]$`, lp.enbw, '20289.02', 'calNoise.calLoop')
  add('E06', TX`$\sqrt{S_w^{(1)}(0)\cdot f_{3\rm dB}}\ [\mathrm{fs}]$（誤把 $f_{3\rm dB}$ 當 Noise BW）`, Math.sqrt(lp.sw1Dc * lp.f3dbExact), '0.31869', 'calNoise.calLoop')
  add('E06', TX`$\sqrt{S_w^{(1)}(0)\cdot\mathrm{ENBW}}=\sigma_w\ [\mathrm{fs}]$`, Math.sqrt(lp.sw1Dc * lp.enbw), '0.39919', 'calNoise.calLoop')
  add('E10', TX`$-\ln p$ 近似 $[\mathrm{Hz}]$`, lp.f3dbNegLnP, '12923.8', 'calNoise.calLoop')
  add('E10', TX`$(1-p)$ 近似 $[\mathrm{Hz}]$`, lp.f3dbOneMinusP, '12401.1', 'calNoise.calLoop')
  add('E10', TX`$\mathrm{ENBW}/f_{3\rm dB}\ (\approx\pi/2)$`, lp.enbw / lp.f3dbExact, '1.569', 'calNoise.calLoop')
  add('E13', TX`$g=\mu K$（無因次）`, lp.g, '0.0797885', 'calNoise.calLoop')
  add('E13', TX`$p=1-g$`, lp.p, '0.9202115', 'calNoise.calLoop')
  add('E26', TX`$(1-p)/(2\pi)\cdot f_u\ [\mathrm{Hz}]$`, lp.f3dbOneMinusP, '12401.10', 'calNoise.calLoop')
  add('E26', TX`$-\ln p/(2\pi)\cdot f_u\ [\mathrm{Hz}]$`, lp.f3dbNegLnP, '12923.83', 'calNoise.calLoop')
  add('E26', TX`$(1-p)$ 版相對 exact 的誤差 $[\%]$`, (lp.f3dbOneMinusP / lp.f3dbExact - 1) * 100, '−4.100', 'calNoise.calLoop')
  add('E26', TX`$-\ln p$ 版相對 exact 的誤差 $[\%]$`, (lp.f3dbNegLnP / lp.f3dbExact - 1) * 100, '−0.058', 'calNoise.calLoop')
  add('E26', TX`$(1-p)/\sqrt p$ 近似 $[\mathrm{Hz}]$`, lp.f3dbSqrtP, '12927.56', 'calNoise.calLoop')
  add('E27', TX`$-3\,\mathrm{dB}$ 點存在的下限 $p_{\min}=3-2\sqrt2$`, P_MIN_3DB, '0.171573', 'calNoise.P_MIN_3DB')
  add('E27', TX`$\Omega_{3\rm dB}=2\pi f_{3\rm dB}/f_u\ [\mathrm{rad/block}]$`, (2 * Math.PI * lp.f3dbExact) / lp.fu, '0.08319965', 'calNoise.calLoop')
  add('E28', TX`$10\log_{10}(f_s/2)\ [\mathrm{dB}]$（漏掉 PSD 換算的偏移量）`, db10(4e9 / 2), '93.01', 'core.db10')
  add('E29', TX`$12.93\,\mathrm{kHz}$ corner 在 block 軸的位置 $\Omega_{3\rm dB}\ [\mathrm{rad/block}]$（sample 軸要再除以 $N=4096$）`, (2 * Math.PI * lp.f3dbExact) / lp.fu, '0.08320', 'calNoise.calLoop')
  const sumMode = loopCore(4096, 4e9, 10, 100, 1, 'sum')
  add('E30', TX`analytic $\sigma_w\ [\mathrm{fs}]$`, lp.sigmaW, '0.399186', 'calNoise.calLoop')
  add('E30', TX`sum mode 的 $g$`, sumMode.g, '326.81', "calNoise.loopCore('sum')")
  add('E30', TX`sum mode 的 pole`, sumMode.p, '−325.81', "calNoise.loopCore('sum')")

  // ── E14 / E38 / E32 / E39 / E40 / E42：Part A ──
  const gauss = { kind: 'gaussian', sigma: 1 } as const
  add('E14', TX`$\lambda(2/3)=E[\ln|1-\mu x^2|]$`, lyapunovExponent(2 / 3, gauss), '−0.486440', 'scalarStability.lyapunovExponent')
  add('E14', TX`$\lambda(1)$`, lyapunovExponent(1, gauss), '−0.416992', 'scalarStability.lyapunovExponent')
  add('E14', TX`$\lambda(2)$（mean pole $=-1$，路徑仍收斂）`, lyapunovExponent(2, gauss), '−0.116247', 'scalarStability.lyapunovExponent')
  add('E14', TX`$\lambda(2.5)>0$（路徑發散）`, lyapunovExponent(2.5, gauss), '+0.020625', 'scalarStability.lyapunovExponent')
  add('E14', TX`almost-sure 界 $\mu_{\rm as}$`, stabilityBounds(gauss).asMax, '2.421249521', 'scalarStability.stabilityBounds')
  add('E38', TX`$E[\delta_5]/\delta_0=(1-\mu P_x)^5$（$\mu=0.5$）`, meanPole(0.5, 1) ** 5, '0.03125', 'lms.meanPole')
  add('E38', TX`$E[\delta_5^2]/\delta_0^2=g(0.5)^5$`, meanSquareFactor(0.5, 1, 3) ** 5, '0.2373', 'lms.meanSquareFactor')
  const t01 = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 0.1, steps: 3, x: { kind: 'fixed', value: 2 } })
  add('E32', TX`$\delta_0=a-w_0$（本站極性）`, t01.delta[0], '+2', 'lms.runScalarLms')
  add('E32', TX`pole $p=1-\mu x^2$（與極性無關）`, fixedXPole(0.1, 2), '0.6', 'lms.fixedXPole')
  add('E39', TX`$\delta_1=a-w_1$`, t01.delta[1], '+1.2', 'lms.runScalarLms')
  add('E39', TX`$\delta_2=a-w_2$`, t01.delta[2], '+0.72', 'lms.runScalarLms')
  const se = runScalarLms({ variant: 'sign_error', tie: 'plus', a: 3, w0: 1, mu: 0.1, steps: 10, x: { kind: 'fixed', value: 2 } })
  add('E40', TX`Sign-Error、IEEE double：$w_{10}=1+10\times0.2$`, se.w[10], '3.0000000000000004', "lms.runScalarLms('sign_error')")
  add('E42', TX`固定 $x=2$、$\mu=0.1$、$\sigma_v=1$：穩態 $\operatorname{Var}(w)=\mu\sigma_v^2/(2-\mu x^2)$`, playgroundVarWStationary(0.1, 2, 1), '0.0625', 'lossCompare.playgroundVarWStationary')

  // ── E44 / E46 / E19 / E20：Polarity、Delay、Margin ──
  add('E44', TX`CT：$\angle H_{\rm PD}(j0.3\omega_n)\ [^\circ]$`, phaseDeg(ctHpd(0.3, { zeta: 0.7, wn: 1 })), '155.2249', 'pll.ctHpd')
  const dt = (wnTs: number, d: number) => phaseDeg(loopFreqResponse(designDtLoop({ wnTs, zeta: 0.7, loopDelay: d }), [0.3 * wnTs]).Hpd[0])
  add('E44', TX`DT、$\omega_nT_s=0.01,\ d=0$`, dt(0.01, 0), '155.240', 'pll.designDtLoop + loopFreqResponse')
  add('E44', TX`DT、$\omega_nT_s=0.1,\ d=0$`, dt(0.1, 0), '155.378', 'pll.designDtLoop + loopFreqResponse')
  add('E44', TX`DT、$\omega_nT_s=0.3,\ d=0$`, dt(0.3, 0), '155.700', 'pll.designDtLoop + loopFreqResponse')
  add('E44', TX`DT、$\omega_nT_s=0.1,\ d=1$`, dt(0.1, 1), '157.238', 'pll.designDtLoop + loopFreqResponse')
  add('E44', TX`DT、$\omega_nT_s=0.3,\ d=1$`, dt(0.3, 1), '161.281', 'pll.designDtLoop + loopFreqResponse')
  add('E46', TX`$\Omega=\pi,\ \phi=0^\circ$：時間平均 $E[xu]$`, corrSingleTone({ amplitude: 1, magnitude: 1, phaseRad: 0, omega: Math.PI }), '+1.0000', 'pll.corrSingleTone')
  add('E46', TX`同上：一般公式 $\tfrac{A^2}{2}|H|\cos\phi$（差 2 倍）`, toneCorrelation({ A: 1, mag: 1, phiRad: 0, omega: Math.PI / 6 }), '+0.5000', 'polarity.toneCorrelation')
  add('E19', TX`完整上界 $(1-r)/(bc)$：$(r,b,c)=(0.5,0.3,2)$`, dualLoopFullMuRange(0.5, 0.3, 2).hi, '0.83333', 'stability.dualLoopFullMuRange')
  add('E19', TX`$(r,b,c)=(-0.5,0.4,1)$`, dualLoopFullMuRange(-0.5, 0.4, 1).hi, '3.7500', 'stability.dualLoopFullMuRange')
  add('E19', TX`$\mu=0.5$：完整模型 $\rho$（簡化 pole 是 $0.5$）`, analyzeDualLoop({ r: 0.8, b: 0.2, c: 1, mu: 0.5 }).rho, '0.9487', 'stability.analyzeDualLoop')
  add('E19', TX`$\mu=0.8$：完整模型 $\rho$`, analyzeDualLoop({ r: 0.8, b: 0.2, c: 1, mu: 0.8 }).rho, '0.9798', 'stability.analyzeDualLoop')
  add('E20', TX`$\theta=-150^\circ$：正確的 $M_{\rm pol}\ [^\circ]$`, polarityMarginArcsin(-150), '−60', 'stability.polarityMarginArcsin')
  add('E20', TX`$\theta=-150^\circ$：$\theta \bmod 180^\circ$ 的錯誤實作`, polarityMarginMod180Bug(-150), '+60', 'stability.polarityMarginMod180Bug')
  add('E20', TX`$\theta=200^\circ$：正確的 $M_{\rm pol}$`, polarityMarginArcsin(200), '−70', 'stability.polarityMarginArcsin')
  add('E20', TX`$\theta=200^\circ$：錯誤實作`, polarityMarginMod180Bug(200), '+70', 'stability.polarityMarginMod180Bug')

  // ── E15 / E16 / E47 / E48 / E49：Quantization 與 Learning Rate ──
  const errLines = lineSpectrum(TOGGLE_PATTERN_5.map((y) => y - 32.4))
  add('E15', TX`toggle／EFB 譜線功率：$f_u/5\ [\mathrm{LSB^2}]$`, errLines[1].power, '0.0305573', 'quantizer.lineSpectrum')
  add('E15', TX`$2f_u/5\ [\mathrm{LSB^2}]$`, errLines[2].power, '0.209443', 'quantizer.lineSpectrum')
  const fx10 = makeGrid(32.4, 'fixed', 10)
  add('E15', TX`$F=10$ bit 定點實際表示的值`, fx10.represented, '32.400390625', "quantizer.makeGrid('fixed', 10)")
  add('E15', TX`$F=10$：EFB limit-cycle 週期 $2^F/\gcd(K,2^F)$`, efbPeriod(fx10.W0, fx10.D), '512', 'quantizer.efbPeriod')
  add('E16', TX`$\mu_{\min}=(1-\varepsilon^{1/B})/K_{\min}$（$K_{\min}=0.004,\ B=12,\ \varepsilon=0.01$）$[\mathrm{fs}]$`, convergenceMuMin(0.004, 0.01, 12), '79.677', 'optimizer.convergenceMuMin')
  add('E16', TX`$\mu_{\max}=1/K_{\max}$（$K_{\max}=0.012$）`, 1 / 0.012, '83.333', '1/K_max')
  add('E16', TX`$K_{\min}=K_q$、$B=30$、$\varepsilon=0.02$：$\mu_{\min}\ [\mathrm{fs}]$`, convergenceMuMin(0.00797885, 0.02, 30), '15.3226', 'optimizer.convergenceMuMin')
  add('E16', TX`非空條件 $B\ge\ln\varepsilon/\ln(1-K_{\min}/K_{\max})$（$\tfrac13,\ 0.01$）`, Math.log(0.01) / Math.log(1 - 1 / 3), '11.358', 'Math.log')
  add('E47', TX`$5|X_1|$（$f_u/5$ 的 DFT 幅度）`, 5 * errLines[1].mag, '0.618034', 'quantizer.lineSpectrum')
  add('E47', TX`$5|X_2|$（$2f_u/5$）`, 5 * errLines[2].mag, '1.618034', 'quantizer.lineSpectrum')
  add('E47', TX`兩條譜線的功率比 $[\mathrm{dB}]$`, db10(errLines[2].power / errLines[1].power), '8.3595', 'quantizer.lineSpectrum')
  add('E47', TX`功率和 $[\mathrm{LSB^2}]$`, errLines[1].power + errLines[2].power, '0.24000', 'quantizer.lineSpectrum')
  for (const [d0, ref] of [
    [10, '0.83944'],
    [50, '17.188'],
    [100, '68.28'],
    [200, '272.6'],
  ] as const) {
    add('E48', TX`線性模型 $E[\delta_{30}^2]$（$\delta_0=${d0}\,\mathrm{fs}$）$[\mathrm{fs^2}]$`, msdAfterBlocks(d0, lp.p, 10, 1 / 4096, 30), ref, 'optimizer.msdAfterBlocks')
  }
  const frz = computeT16().values
  add('E49', TX`freeze：$w-w^*\ [\mathrm{LSB}]$（$\delta=a-w$ 則為 $+0.4$）`, frz.freeze_error_lsb as number, '−0.4', "quantizer.simulateStrategy('freeze')")
  add('E49', TX`freeze 的誤差功率 $[\mathrm{LSB^2}]$（全在 DC）`, (frz.freeze_error_lsb as number) ** 2, '0.16', "quantizer.simulateStrategy('freeze')")
  return out
}
