/**
 * DTC INL 校正：分段（piecewise）／LUT／多項式基底的多參數 LMS，以及 INL 造成的噪聲折返（Ch11b；延伸規格 §11）。
 * 模型層級 L1（靜態誤差路徑、iid 近似的 code）～ L3（多參數相關矩陣與 preconditioner）。
 *
 * ── 架構（docs/assumptions.md §2a）──
 *   DTC 在 reference 輸入端，回授路徑上只有 divider。feedback edge 早到 a·x（t_fb = −a·x）；reference 端的 DTC 只能延遲，
 *   所以從固定的基準延遲 T_0 往回扣：τ_DTC = T_0 − w·x − c(x) + d(x)。
 *     w·x   ：gain 校正的補償量（Ch11）
 *     c(x)  ：INL 校正的補償量 c(x) = Σ_i θ_i φ_i(x)（本章；φ_i 是校正結構的 regressor）
 *     d(x)  ：DTC 的 INL——這個 code 多出來的延遲（偏離直線的量，多延遲為正）
 *   PD 量 t_ref′ − t_fb = (a − w)·x + d(x) − c(x)（常數 T_0 被主 PLL 吸收）；comparator 取的是 PD 的輸出 e[n]
 *   （送進 loop filter 的同一個節點），加上 PD／comparator offset b 與雜訊 v：
 *     e[n] = (a − w)·x[n] + b + d(x[n]) − c(x[n]) + v[n]
 *
 * ── Code 的正規化 ──
 *   本模組的 x 一律是正規化 code x ∈ [−1, 1]（無因次）：DSM residue r（單位 T_vco）以已知的範圍做仿射映射，
 *   一階 r ∈ (−1, 0] → x = 2(r + ½)；MASH 1-1-1 |r| < 2 → x = r/2；uniform 直接 x ~ U(−1, 1)。
 *   INL 係數（d_2、d_3、鋸齒振幅）、a、w、θ、b、σ_v 都用同一個正規化時間單位 t.u.（例如 fs）；d_2 就是 x = ±1 處二次 INL 的峰值。
 *
 * ── INL 形狀 d(x) ──
 *   d(x) = d_2 x² + d_3 x³ + A_s·saw_K(x)，saw_K 是把 [−1, 1] 切成 K_s 段、每段從 −1 線性升到 +1 的鋸齒
 *   （segmented DTC 的 fine-DTC gain 與 coarse step 不匹配時，每個 coarse 段內的誤差就是這種斜坡）。
 *
 * ── 噪聲折返（Gaussian–Isserlis）──
 *   零均值 Gaussian x、自相關 R_x[m]：x 的 Hermite 分量 He_p 的自相關是 p!·R_x[m]^p，所以
 *     d_2 (x² − σ²)         的 PSD 在 DC 的值 S_2(0) = 2 d_2² Σ_m R_x[m]²
 *     d_3 (x³ − 3σ² x)      的 PSD 在 DC 的值 S_3(0) = 6 d_3² Σ_m R_x[m]³（3σ²x 那一項被 gain 校正吸收，Ch11 F-11.8）
 *   MASH 1-1-1 的 residue r = −(1 − z⁻¹)²·s_3/M，s_3/M 視為白色 uniform（變異數 1/12）時 R_r = (1/12)·[6, −4, 1]，
 *   正規化 x = r/2 後 R_x = (1/48)·[6, −4, 1]。帶內（|ν| ≤ ν_B = f_B/f_s）折返功率 P_in ≈ S(0)·2ν_B。
 *
 * ── 多參數 block LMS（Sign 或 MSE）──
 *   ϑ_{b+1} = ϑ_b + μ·M·G_b，G_b = (1/N) Σ_n q[n] ψ[n]（Sign：q = sign(e)；MSE：q = e），ψ = [x（gain 同時校正時）, φ_1, …]。
 *   小訊號 mean-field：E[G] ≈ K_q R (ϑ* − ϑ)，R = E[ψψᵀ]；pole 1 − μK_qλ_i；穩態 Var(ξ_i) = μ²λ_i/(N(1 − p_i²)) ≈ μ/(2K_qN)。
 *
 * 純數值、無 React/DOM；隨機性全部來自 createRng(seed)。Worker 可呼叫（單一 structured-cloneable 參數）：
 *   foldingAnalysis、simulateInlLms、basisComparison、analyzeInlStructure。
 */

import { cond, createRng, eigSym, eigvals, erf, identity, matVec, pinv, solve, type Matrix } from '@/simulation/core'
import { integratePsd, welch } from '@/simulation/signal'
import { dsmNoiseTheory, runDsm } from '@/simulation/models/dsm'

/** K_q = √(2/π)/σ_v 的常數部分 */
export const KQ_FACTOR = Math.sqrt(2 / Math.PI)
/** 一次模擬最多產生的 code 樣本數；超過就循環使用（每個 block 連續取樣） */
export const MAX_CODE_SAMPLES = 1 << 20
/** 估計相關矩陣 R 與 LS 最佳解時使用的樣本數上限 */
export const MOMENT_SAMPLES = 1 << 16
/** 95% 衰減的定義（k_95） */
const DECAY_95 = 0.05

// ───────────────────────── INL 形狀 ─────────────────────────

export interface InlShape {
  /** 二次 INL 係數（x = ±1 處的峰值，t.u.） */
  d2: number
  /** 三次 INL 係數（t.u.） */
  d3: number
  /** 鋸齒狀 segment error 的振幅（t.u.；每段從 −A_s 升到 +A_s） */
  sawAmp: number
  /** 鋸齒的段數 K_s（≥ 1） */
  sawSegments: number
}

export const ZERO_SHAPE: InlShape = { d2: 0, d3: 0, sawAmp: 0, sawSegments: 8 }

// #region core:inlShape
/** DTC INL d(x)：這個正規化 code 多出來的延遲（t.u.；多延遲為正） */
export function inlValue(x: number, s: InlShape): number {
  let d = s.d2 * x * x + s.d3 * x * x * x
  if (s.sawAmp !== 0 && s.sawSegments >= 1) {
    const u = ((x + 1) / 2) * s.sawSegments // 第幾段（含小數）
    const frac = u - Math.floor(u) // 段內位置 ∈ [0, 1)
    d += s.sawAmp * (2 * (x >= 1 ? 1 : frac) - 1) // 段內從 −A_s 線性升到 +A_s；x = 1 的右端點歸到最後一段的頂
  }
  return d
}
// #endregion

export function inlCurve(xs: ArrayLike<number>, s: InlShape): Float64Array {
  const out = new Float64Array(xs.length)
  for (let i = 0; i < xs.length; i++) out[i] = inlValue(xs[i], s)
  return out
}

/** [−1, 1] 上等距的 n 個點（評估殘餘 INL 曲線用） */
export function xGrid(n = 201): Float64Array {
  const g = new Float64Array(n)
  for (let i = 0; i < n; i++) g[i] = -1 + (2 * i) / (n - 1)
  return g
}

// ───────────────────────── Code 序列 ─────────────────────────

export type InlCodeKind = 'uniform' | 'first_order' | 'mash111'

export const CODE_KIND_LABEL: Record<InlCodeKind, string> = {
  uniform: 'Uniform iid（白色，x ~ U(−1, 1)）',
  first_order: 'first-order DSM residue（x = 2(r + 1/2)）',
  mash111: 'MASH 1-1-1 residue（x = r/2）',
}

export interface InlCodeSpec {
  kind: InlCodeKind
  /** DSM 的 FCW 小數部分（uniform 不用） */
  frac?: number
  /** DSM 累加器位元數（預設 20） */
  bits?: number
  seed?: number
  length: number
}

export interface InlCodeResult {
  x: Float64Array
  kind: InlCodeKind
  /** residue → x 的仿射映射：x = (r − center)/halfRange */
  center: number
  halfRange: number
  /** DSM 序列的週期（0 = 未偵測到） */
  period: number
  warnings: string[]
}

/** 正規化 code x ∈ [−1, 1] 的序列（uniform iid 或 DSM residue 的仿射映射） */
export function generateInlCode(spec: InlCodeSpec): InlCodeResult {
  const L = spec.length
  if (!Number.isInteger(L) || L < 2) throw new Error(`length 必須為 ≥ 2 的整數，收到 ${L}`)
  const x = new Float64Array(L)
  if (spec.kind === 'uniform') {
    const rng = createRng(spec.seed ?? 1).fork('inl-code')
    for (let n = 0; n < L; n++) x[n] = 2 * rng.uniform() - 1
    return { x, kind: spec.kind, center: 0, halfRange: 1, period: 0, warnings: [] }
  }
  const frac = spec.frac ?? 0.3
  const res = runDsm({ kind: spec.kind, frac, bits: spec.bits ?? 20, length: L })
  // 一階 residue ∈ (−1, 0]（零初值）→ 中心 −½、半寬 ½；MASH |r| < 2 → 中心 0、半寬 2
  const center = spec.kind === 'first_order' ? -0.5 : 0
  const halfRange = spec.kind === 'first_order' ? 0.5 : 2
  for (let n = 0; n < L; n++) x[n] = (res.residue[n] - center) / halfRange
  const warnings = [...res.warnings]
  if (res.period > 0 && res.period < L / 4) warnings.push(`DSM residue 的週期只有 ${res.period} 個 sample：code 是短週期的確定性序列，Gaussian 近似與「每段都有足夠樣本」都要另外檢查。`)
  return { x, kind: spec.kind, center, halfRange, period: res.period, warnings }
}

// ───────────────────────── 自相關與噪聲折返 ─────────────────────────

/** MASH 1-1-1 residue（單位 T_vco）的理論自相關 R_r[0..2] = (1/12)·[6, −4, 1]（s_3/M 白色 uniform） */
export const MASH_RESIDUE_AUTOCORR: readonly number[] = [6 / 12, -4 / 12, 1 / 12]
/** 正規化 x = r/2 後的自相關 R_x = R_r/4 = (1/48)·[6, −4, 1] */
export const MASH_CODE_AUTOCORR: readonly number[] = MASH_RESIDUE_AUTOCORR.map((r) => r / 4)
/** uniform iid x ~ U(−1, 1) 的自相關：只有 R[0] = 1/3 */
export const UNIFORM_CODE_AUTOCORR: readonly number[] = [1 / 3]

/** 去平均的樣本自相關（biased：除以 n）R̂[0..maxLag] */
export function autocovariance(x: ArrayLike<number>, maxLag: number): Float64Array {
  const n = x.length
  let m = 0
  for (let i = 0; i < n; i++) m += x[i]
  m /= n
  const R = new Float64Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0
    for (let i = lag; i < n; i++) s += (x[i] - m) * (x[i - lag] - m)
    R[lag] = s / n
  }
  return R
}

// #region core:foldedPsdDc
/**
 * 零均值 Gaussian 過程 x（自相關 R[0..L]，對稱）的 Hermite 分量 He_p 在 DC 的 PSD（DTFT 形式、雙邊、每 cycle/sample）：
 *   S_p(0) = Σ_m R_{He_p}[m] = p!·Σ_m R[m]^p   （Isserlis / Mehler：R_{He_p}[m] = p!·R[m]^p）
 * p = 2：x² − σ²（二次 INL 去掉 DC 之後）；p = 3：x³ − 3σ²x（三次 INL 去掉 gain 校正吸收的 3σ²x 之後）。
 * 帶內功率 P_in = S_p(0)·2ν_B（ν_B = f_B/f_s，|ν| ≤ ν_B 內 PSD 近似平坦）。
 */
export function foldedPsdDc(R: ArrayLike<number>, p: 2 | 3): number {
  const fact = p === 2 ? 2 : 6
  let s = Math.pow(R[0], p)
  for (let m = 1; m < R.length; m++) s += 2 * Math.pow(R[m], p) // ±m 各一次
  return fact * s
}
// #endregion

/** 帶內功率：平坦 PSD S(0)（雙邊 DTFT）在 |ν| ≤ ν_B 內的積分 */
export function inbandPower(S0: number, nuB: number): number {
  return S0 * 2 * nuB
}

/** MASH 1-1-1 正規化 code x = r/2 = Σ_k h_k u[n−k] 的 FIR 係數 h = [−½, 1, −½]（u = s_3/M 視為 iid uniform(0, 1)） */
export const MASH_CODE_FIR: readonly number[] = [-0.5, 1, -0.5]
/** uniform(0, 1) 的四階累積量 κ_4 = E[(u−½)⁴] − 3σ_u⁴ = 1/80 − 3/144 = −1/120 */
export const UNIFORM_KAPPA4 = 1 / 80 - 3 / 144

// #region core:foldedPsdDcExact
/**
 * 線性過程 x = Σ_k h_k u[n−k]（u iid、零均值、四階累積量 κ_4）的 x² − σ² 在 DC 的 PSD（精確，不需要 Gaussian）：
 *   Cov(x_n², x_{n+m}²) = 2R[m]² + κ_4 Σ_k h_k² h_{k+m}²  ⇒  S_2(0) = 2 Σ_m R[m]² + κ_4 (Σ_k h_k²)²
 * 第一項就是 Gaussian–Isserlis，第二項是 u 不是 Gaussian 的修正（uniform 的 κ_4 < 0：折返比 Gaussian 少）。
 */
export function foldedPsdDcLinearProcess(R: ArrayLike<number>, h: ArrayLike<number>, kappa4: number): number {
  let h2 = 0
  for (let k = 0; k < h.length; k++) h2 += h[k] * h[k]
  return foldedPsdDc(R, 2) + kappa4 * h2 * h2
}
// #endregion

/** 線性過程 x = Σ h_k u[n−k] 的 Var(x²) = 2σ⁴ + κ_4 Σ_k h_k⁴（上式 m = 0 的項：殘餘 INL 的總功率） */
export function linearProcessSquaredVariance(sigma2: number, h: ArrayLike<number>, kappa4: number): number {
  let h4 = 0
  for (let k = 0; k < h.length; k++) h4 += h[k] ** 4
  return 2 * sigma2 * sigma2 + kappa4 * h4
}

/** uniform x ~ U(−1, 1) 下 d = d_2x² + d_3x³ 做完 gain 校正後的殘餘：w* − a = (3/5)d_3，E[r²] = 4d_2²/45 + 4d_3²/175（精確） */
export function uniformResidualAfterGain(shape: Pick<InlShape, 'd2' | 'd3'>): { gainAbsorbed: number; rms2: number; rms: number } {
  const rms2 = (4 * shape.d2 ** 2) / 45 + (4 * shape.d3 ** 2) / 175
  return { gainAbsorbed: (3 / 5) * shape.d3, rms2, rms: Math.sqrt(rms2) }
}

/** iid（白色）x 的 x² − σ² 在 DC 的 PSD = Var(x²) = E[x⁴] − σ⁴（頻譜平坦，沒有「折返」可言） */
export function iidSquaredPsdDc(Ex4: number, sigma2: number): number {
  return Ex4 - sigma2 * sigma2
}

export interface FoldingPrediction {
  /** σ_x² = R[0] */
  sigma2: number
  /** gain 校正吸收的量 3 d_3 σ²（w* − a） */
  gainAbsorbed: number
  /** gain 校正後殘餘 INL 的總功率 2d_2²σ⁴ + 6d_3²σ⁶（Gaussian） */
  residualPower: number
  /** 二次、三次分量在 DC 的 PSD（含係數） */
  S2: number
  S3: number
  /** 帶內折返功率與 rms */
  Pin: number
  rmsIn: number
  /** 帶內功率占殘餘 INL 總功率的比例 */
  inbandFraction: number
}

// #region core:hermiteResidual
/**
 * Gaussian 近似下 d(x) = d_2x² + d_3x³ 的折返預測：gain 校正吸收 3d_3σ²x，剩下 d_2(x²−σ²) + d_3(x³−3σ²x)，
 * 總功率 2d_2²σ⁴ + 6d_3²σ⁶（Hermite 分量正交），帶內 PSD 位準 2d_2²ΣR² + 6d_3²ΣR³，帶內功率 ×2ν_B。
 */
export function foldingPrediction(R: ArrayLike<number>, shape: Pick<InlShape, 'd2' | 'd3'>, nuB: number): FoldingPrediction {
  const sigma2 = R[0]
  const S2 = shape.d2 * shape.d2 * foldedPsdDc(R, 2)
  const S3 = shape.d3 * shape.d3 * foldedPsdDc(R, 3)
  const residualPower = 2 * shape.d2 ** 2 * sigma2 ** 2 + 6 * shape.d3 ** 2 * sigma2 ** 3
  const Pin = inbandPower(S2 + S3, nuB)
  return { sigma2, gainAbsorbed: 3 * shape.d3 * sigma2, residualPower, S2, S3, Pin, rmsIn: Math.sqrt(Pin), inbandFraction: residualPower > 0 ? Pin / residualPower : 0 }
}
// #endregion

export interface FoldingParams {
  code: InlCodeSpec
  shape: InlShape
  /** comparator 前雜訊 σ_v（t.u.；只加在「含雜訊」的 PSD 上） */
  sigmaV: number
  /** 取樣率（= f_ref）與帶寬，Hz */
  fs: number
  fB: number
  /** Welch segment 長度（預設 4096） */
  nperseg?: number
  /** 自相關的最大 lag（預設 16） */
  maxLag?: number
  /** PSD 曲線輸出的最多點數（預設 1024） */
  plotPoints?: number
  seed?: number
}

export interface FoldingResult {
  /** 頻率軸（Hz，one-sided，已去掉 DC） */
  f: Float64Array
  /** 正規化 code 的 PSD（x²/Hz） */
  psdX: Float64Array
  /** gain 校正後殘餘 INL 的 PSD（t.u.²/Hz） */
  psdResidual: Float64Array
  /** 殘餘 INL + 雜訊 v 的 PSD */
  psdTotal: Float64Array
  /** DSM 理論 PSD（code 單位；uniform 時為平坦） */
  psdXTheory: Float64Array
  /** 折返的帶內平坦位準（one-sided，t.u.²/Hz）：Gaussian–Isserlis，用理論 R（有的話）或樣本 R̂ */
  inbandLevelTheory: number
  /** 帶內折返功率：Welch 積分（量測）、樣本自相關的 Gaussian 預測、理論自相關的 Gaussian 預測、殘餘序列自相關的精確和 */
  PinMeasured: number
  PinGaussianEmpirical: number
  PinGaussianTheory: number
  /** 線性過程的精確式（MASH：Gaussian 項 + uniform 的 κ_4 修正；uniform iid：Var(x²)）；只含 d_2 項，其餘 NaN */
  PinExactTheory: number
  PinExactAutocov: number
  /** 殘餘 INL 的總功率（量測）與 Gaussian 預測 */
  residualPowerMeasured: number
  residualPowerGaussian: number
  /** gain 校正吸收的斜率（LS）與 Gaussian 預測 3d_3σ² */
  gainAbsorbedMeasured: number
  gainAbsorbedGaussian: number
  sigma2: number
  kurtosis: number
  /** 樣本自相關 R̂_x[0..maxLag] */
  Rx: Float64Array
  period: number
  nuB: number
  welch: { window: string; nperseg: number; nSegments: number; enbwHz: number; df: number }
  warnings: string[]
}

/** 把長陣列等距抽樣到最多 n 點（畫圖用） */
export function decimate(a: ArrayLike<number>, n: number): Float64Array {
  if (a.length <= n) return Float64Array.from(a)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = a[Math.floor((i * (a.length - 1)) / (n - 1))]
  return out
}

/**
 * 噪聲折返實驗（worker）：產生 code、算出 gain 校正後的殘餘 INL y = d(x) − (E[xd]/E[x²])x − E[·]，
 * 以 Welch PSD 量帶內功率，並和 Gaussian–Isserlis 預測、殘餘序列自相關的精確和比較。
 */
export function foldingAnalysis(p: FoldingParams): FoldingResult {
  const warnings: string[] = []
  const code = generateInlCode({ ...p.code, seed: p.seed ?? p.code.seed })
  warnings.push(...code.warnings)
  const x = code.x
  const L = x.length
  const nperseg = Math.min(p.nperseg ?? 4096, L)
  const maxLag = p.maxLag ?? 64
  const nuB = p.fB / p.fs
  if (!(p.fB > 0) || !(p.fs > 0) || nuB >= 0.5) throw new Error(`f_B 與 f_s 必須為正且 f_B < f_s/2（收到 f_B = ${p.fB}, f_s = ${p.fs}）`)
  // 殘餘 INL：d(x) 去掉 LS 直線（gain 校正吸收的部分）與平均（主迴路吸收的 DC）
  const d = inlCurve(x, p.shape)
  let mx = 0
  let md = 0
  for (let n = 0; n < L; n++) {
    mx += x[n]
    md += d[n]
  }
  mx /= L
  md /= L
  let sxx = 0
  let sxd = 0
  let m4 = 0
  for (let n = 0; n < L; n++) {
    const xc = x[n] - mx
    sxx += xc * xc
    sxd += xc * (d[n] - md)
    m4 += xc ** 4
  }
  const sigma2 = sxx / L
  const gainAbsorbedMeasured = sxx > 0 ? sxd / sxx : 0
  const kurtosis = sigma2 > 0 ? m4 / L / (sigma2 * sigma2) : NaN
  const y = new Float64Array(L)
  let py = 0
  for (let n = 0; n < L; n++) {
    y[n] = d[n] - md - gainAbsorbedMeasured * (x[n] - mx)
    py += y[n] * y[n]
  }
  const residualPowerMeasured = py / L
  const rng = createRng(p.seed ?? 1).fork('inl-fold-noise')
  const yv = new Float64Array(L)
  for (let n = 0; n < L; n++) yv[n] = y[n] + (p.sigmaV > 0 ? p.sigmaV * rng.normal() : 0)

  const wx = welch(x, p.fs, { nperseg, window: 'hann' })
  const wy = welch(y, p.fs, { nperseg, window: 'hann' })
  const wv = welch(yv, p.fs, { nperseg, window: 'hann' })
  warnings.push(...wy.warnings)
  if (p.fB < 4 * wy.df) warnings.push(`帶寬 $f_B$ 只有 ${(p.fB / wy.df).toFixed(1)} 個 PSD bin（$\\Delta f=${wy.df.toExponential(2)}$ Hz）：帶內積分的解析度不夠，請加大 nperseg 或 $f_B$。`)
  const PinMeasured = integratePsd(wy.f, wy.psd, 0, p.fB)

  const Rx = autocovariance(x, maxLag)
  const Ry = autocovariance(y, maxLag)
  // 殘餘序列自己的自相關直接加總（DTFT 在 DC 的值），one-sided per-Hz = 2S/f_s
  let Sy0 = Ry[0]
  for (let m = 1; m <= maxLag; m++) Sy0 += 2 * Ry[m]
  const PinExactAutocov = inbandPower(Sy0, nuB)
  const predEmp = foldingPrediction(Rx, p.shape, nuB)
  const Rth = p.code.kind === 'mash111' ? MASH_CODE_AUTOCORR : p.code.kind === 'uniform' ? UNIFORM_CODE_AUTOCORR : null
  const predTh = Rth ? foldingPrediction(Rth, p.shape, nuB) : null
  const hasSaw = p.shape.sawAmp !== 0
  if (hasSaw) warnings.push('鋸齒狀 segment error 沒有封閉式的折返公式：「Gaussian 預測」只含 $d_2$、$d_3$ 兩項，鋸齒的折返以 Welch 量測為準（它的自相關拖得很長，lag 有限的自相關加總不可靠）。')
  // 線性過程的精確式（只有二次項有封閉式）：MASH = FIR h 作用在 iid uniform 上；uniform iid = Var(x²)
  let PinExactTheory = NaN
  if (p.shape.d3 === 0 && !hasSaw) {
    if (p.code.kind === 'mash111') PinExactTheory = inbandPower(p.shape.d2 ** 2 * foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), nuB)
    else if (p.code.kind === 'uniform') PinExactTheory = inbandPower(p.shape.d2 ** 2 * iidSquaredPsdDc(1 / 5, 1 / 3), nuB)
  }
  if (p.code.kind === 'first_order') warnings.push('first-order DSM 的 residue 是週期性鋸齒（不是雜訊）：它的「折返」是譜線（spur），Gaussian–Isserlis 公式不適用，請看 Welch PSD 的譜線。')
  // 沒有精確式可比（三次項）而 code 又明顯不是 Gaussian 時，提醒 Gaussian–Isserlis 只是近似
  if (!Number.isFinite(PinExactTheory) && !hasSaw && p.code.kind !== 'first_order' && Number.isFinite(kurtosis) && Math.abs(kurtosis - 3) > 0.6)
    warnings.push(`code 的峰度 $E[x^4]/\\sigma_x^4=${kurtosis.toFixed(2)}$ 離 Gaussian 的 3 較遠：Isserlis 的折返預測只是近似（三次項沒有累積量修正的封閉式），以量測為準。`)

  const S0th = (predTh ?? predEmp).S2 + (predTh ?? predEmp).S3
  const inbandLevelTheory = (2 * S0th) / p.fs
  const n = p.plotPoints ?? 1024
  const idx = (k: number) => k + 1 // 去掉 DC bin
  const pick = (a: Float64Array) => {
    const b = new Float64Array(a.length - 1)
    for (let k = 0; k < b.length; k++) b[k] = a[idx(k)]
    return decimate(b, n)
  }
  const f = pick(wx.f)
  const theory = dsmNoiseTheory(p.code.kind === 'mash111' ? 'mash111' : 'first_order', f, p.fs, 'residue')
  const psdXTheory = new Float64Array(f.length)
  for (let k = 0; k < f.length; k++) {
    // residue 理論（T_vco²/Hz）→ 正規化 x：除以 halfRange²；uniform：平坦 2σ²/f_s
    psdXTheory[k] = p.code.kind === 'uniform' ? (2 * sigma2) / p.fs : theory[k] / (code.halfRange * code.halfRange)
  }
  return {
    f,
    psdX: pick(wx.psd),
    psdResidual: pick(wy.psd),
    psdTotal: pick(wv.psd),
    psdXTheory,
    inbandLevelTheory,
    PinMeasured,
    PinGaussianEmpirical: predEmp.Pin,
    PinGaussianTheory: predTh ? predTh.Pin : NaN,
    PinExactTheory,
    PinExactAutocov: hasSaw ? NaN : PinExactAutocov,
    residualPowerMeasured,
    residualPowerGaussian: predEmp.residualPower,
    gainAbsorbedMeasured,
    gainAbsorbedGaussian: predEmp.gainAbsorbed,
    sigma2,
    kurtosis,
    Rx,
    period: code.period,
    nuB,
    welch: { window: wy.window, nperseg: wy.nperseg, nSegments: wy.nSegments, enbwHz: wy.enbwHz, df: wy.df },
    warnings,
  }
}

// ───────────────────────── 校正結構與 regressor ─────────────────────────

export type InlStructure = 'piecewise' | 'lut' | 'poly'
export type PolyBasis = 'monomial' | 'legendre' | 'legendre_norm' | 'chebyshev'

export const STRUCTURE_LABEL: Record<InlStructure, string> = {
  piecewise: '分段線性（K 段，每段一個 gain）',
  lut: 'LUT（J 格，每格一個修正值）',
  poly: '多項式基底（M 階）',
}
export const BASIS_LABEL: Record<PolyBasis, string> = {
  monomial: 'monomial 1, x, x², x³ …',
  legendre: 'Legendre P_m(x)',
  legendre_norm: 'normalized Legendre √(2m+1)·P_m(x)',
  chebyshev: 'Chebyshev T_m(x)',
}

export interface StructureConfig {
  structure: InlStructure
  /** 分段數 K */
  K: number
  /** LUT 格數 J */
  J: number
  /** 多項式階數 M（係數 θ_0 … θ_M，共 M+1 個） */
  M: number
  basis: PolyBasis
  /** gain w 是否同時用 regressor x 校正（'adapt'）或固定（'fixed'） */
  gainMode: 'fixed' | 'adapt'
}

export const DEFAULT_STRUCTURE: StructureConfig = { structure: 'piecewise', K: 8, J: 64, M: 3, basis: 'monomial', gainMode: 'fixed' }

/** INL 參數個數（不含 gain） */
export function paramCount(c: StructureConfig): number {
  return c.structure === 'piecewise' ? c.K : c.structure === 'lut' ? c.J : c.M + 1
}

/** 全部參數個數（含同時校正的 gain） */
export function totalParams(c: StructureConfig): number {
  return paramCount(c) + (c.gainMode === 'adapt' ? 1 : 0)
}

/** 第 m 階基底函數在 x 的值（x ∈ [−1, 1]） */
export function basisValue(kind: PolyBasis, m: number, x: number): number {
  if (kind === 'monomial') return Math.pow(x, m)
  if (kind === 'chebyshev') {
    // T_0 = 1、T_1 = x、T_{m+1} = 2x T_m − T_{m−1}
    let t0 = 1
    let t1 = x
    if (m === 0) return 1
    for (let k = 1; k < m; k++) {
      const t2 = 2 * x * t1 - t0
      t0 = t1
      t1 = t2
    }
    return t1
  }
  // Legendre：P_0 = 1、P_1 = x、(k+1)P_{k+1} = (2k+1)x P_k − k P_{k−1}
  let p0 = 1
  let p1 = x
  let val: number
  if (m === 0) val = 1
  else {
    for (let k = 1; k < m; k++) {
      const p2 = ((2 * k + 1) * x * p1 - k * p0) / (k + 1)
      p0 = p1
      p1 = p2
    }
    val = p1
  }
  return kind === 'legendre_norm' ? Math.sqrt(2 * m + 1) * val : val
}

/** 分段：x 落在第幾段（0 … K−1；x = 1 歸到最後一段） */
export function segmentIndex(x: number, K: number): number {
  const k = Math.floor(((x + 1) / 2) * K)
  return k < 0 ? 0 : k >= K ? K - 1 : k
}

/** 分段的邊界 [x_k, x_{k+1}] */
export function segmentBounds(k: number, K: number): [number, number] {
  return [-1 + (2 * k) / K, -1 + (2 * (k + 1)) / K]
}

// #region core:regressor
/** 校正結構的 regressor ψ(x)（寫進 out；含 gain 時第一個元素是 x） */
export function regressorInto(out: Float64Array, x: number, c: StructureConfig): void {
  out.fill(0)
  let o = 0
  if (c.gainMode === 'adapt') out[o++] = x // gain 的 regressor（Ch11 的 w）
  if (c.structure === 'piecewise') {
    out[o + segmentIndex(x, c.K)] = x // one-hot 選段 × x：每段自己的 gain
  } else if (c.structure === 'lut') {
    out[o + segmentIndex(x, c.J)] = 1 // one-hot：每格一個修正值
  } else {
    for (let m = 0; m <= c.M; m++) out[o + m] = basisValue(c.basis, m, x) // 冪次／正交多項式
  }
}
// #endregion

export function regressor(x: number, c: StructureConfig): Float64Array {
  const out = new Float64Array(totalParams(c))
  regressorInto(out, x, c)
  return out
}

/** 補償量 c(x) = θᵀφ(x)（θ 含 gain 時第一個元素是 w） */
export function correction(x: number, theta: ArrayLike<number>, c: StructureConfig): number {
  const psi = regressor(x, c)
  let s = 0
  for (let i = 0; i < psi.length; i++) s += theta[i] * psi[i]
  return s
}

/** 由 code 序列估計相關矩陣 R = mean(ψψᵀ)（取前 MOMENT_SAMPLES 個） */
export function momentMatrix(x: ArrayLike<number>, c: StructureConfig, limit = MOMENT_SAMPLES): Matrix {
  const P = totalParams(c)
  const n = Math.min(x.length, limit)
  const R: number[][] = Array.from({ length: P }, () => new Array<number>(P).fill(0))
  const psi = new Float64Array(P)
  for (let i = 0; i < n; i++) {
    regressorInto(psi, x[i], c)
    for (let a = 0; a < P; a++) {
      const pa = psi[a]
      if (pa === 0) continue
      const row = R[a]
      for (let b = 0; b < P; b++) row[b] += pa * psi[b]
    }
  }
  for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) R[a][b] /= n
  return R
}

/** 每段／每格被 code 造訪的機率 p_k（分段或 LUT；多項式回傳空陣列） */
export function visitProbabilities(x: ArrayLike<number>, c: StructureConfig, limit = MOMENT_SAMPLES): number[] {
  if (c.structure === 'poly') return []
  const bins = c.structure === 'piecewise' ? c.K : c.J
  const n = Math.min(x.length, limit)
  const cnt = new Array<number>(bins).fill(0)
  for (let i = 0; i < n; i++) cnt[segmentIndex(x[i], bins)]++
  return cnt.map((v) => v / n)
}

/** uniform x ~ U(−1, 1) 的封閉式相關矩陣（分段：diag((x_{k+1}³ − x_k³)/6)；LUT：diag(1/J)；monomial：Hankel 1/(m+n+1)；Legendre：diag 1/(2m+1)；Chebyshev：數值積分） */
export function uniformMomentMatrix(c: StructureConfig): Matrix {
  const P = totalParams(c)
  const R: number[][] = Array.from({ length: P }, () => new Array<number>(P).fill(0))
  const g = c.gainMode === 'adapt' ? 1 : 0
  if (g) R[0][0] = 1 / 3
  if (c.structure === 'piecewise') {
    for (let k = 0; k < c.K; k++) {
      const [lo, hi] = segmentBounds(k, c.K)
      const lam = (hi ** 3 - lo ** 3) / 6 // ∫_lo^hi x² dx / 2
      R[g + k][g + k] = lam
      if (g) {
        R[0][g + k] = lam // E[x · 1_k x] = λ_k
        R[g + k][0] = lam
      }
    }
    return R
  }
  if (c.structure === 'lut') {
    for (let j = 0; j < c.J; j++) {
      const [lo, hi] = segmentBounds(j, c.J)
      R[g + j][g + j] = 1 / c.J
      if (g) {
        const ex = (hi * hi - lo * lo) / 4 // E[x · 1_j] = ∫ x dx / 2
        R[0][g + j] = ex
        R[g + j][0] = ex
      }
    }
    return R
  }
  if (c.basis === 'chebyshev' || g) {
    // 數值積分（Simpson，2001 點）：Chebyshev 在 uniform 權重下不正交；含 gain 時與基底的交叉項也用積分
    const n = 2000
    const psi = new Float64Array(P)
    for (let i = 0; i <= n; i++) {
      const xi = -1 + (2 * i) / n
      const wgt = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) / (3 * n) // Simpson 權重 × (2/n)/2
      regressorInto(psi, xi, c)
      for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) R[a][b] += wgt * psi[a] * psi[b]
    }
    return R
  }
  for (let m = 0; m <= c.M; m++)
    for (let k = 0; k <= c.M; k++) {
      if (c.basis === 'monomial') R[m][k] = (m + k) % 2 === 0 ? 1 / (m + k + 1) : 0
      else if (c.basis === 'legendre') R[m][k] = m === k ? 1 / (2 * m + 1) : 0
      else R[m][k] = m === k ? 1 : 0
    }
  return R
}

/** 由對稱分布的動差 m_2、m_4、m_6 組成 {1, x, x², x³} 的 Hankel 相關矩陣（HC-11B.4 用） */
export function hankelFromMoments(m2: number, m4: number, m6: number): Matrix {
  return [
    [1, 0, m2, 0],
    [0, m2, 0, m4],
    [m2, 0, m4, 0],
    [0, m4, 0, m6],
  ]
}

/** 2×2 對稱矩陣的特徵值（大、小）——手算用的封閉式 */
export function eig2(a: number, b: number, d: number): [number, number] {
  const tr = a + d
  const det = a * d - b * b
  const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det))
  return [(tr + disc) / 2, (tr - disc) / 2]
}

// ───────────────────────── 模式分析（pole、k95、穩態變異） ─────────────────────────

export type Preconditioner = 'none' | 'diag' | 'full'

export interface ModeAnalysis {
  /** R 的特徵值（由大到小） */
  lambdas: number[]
  lambdaMax: number
  lambdaMin: number
  cond: number
  /** 各模式的 pole（scalar：1 − μK_qλ_i；diag／full：eig(I − M K_q R) 的模） */
  poles: number[]
  /** 各模式的 g_i = 1 − p_i 與 k95 */
  gains: number[]
  k95: number[]
  /** 最慢模式的 k95、時間常數（blocks） */
  k95Slowest: number
  tauSlowest: number
  /** 各模式穩態變異 Var(ξ_i) = μ²λ_i/(N(1 − p_i²))（scalar；其他 preconditioner 為 NaN） */
  modeVar: number[]
  /** 每個參數的穩態 std（scalar 且 R 對角時 = √(μ²λ_i/(N(1−p_i²)))；一般情況用 Cov = Σ_i Var(ξ_i) v_i v_iᵀ 的對角線） */
  paramStd: number[]
  stable: boolean
  singular: boolean
  warnings: string[]
}

export function kqFromSigma(sigmaV: number): number {
  return sigmaV > 0 ? KQ_FACTOR / sigmaV : Infinity
}

// #region core:modeAnalysis
/** 小訊號 mean-field：δ_{b+1} = (I − μ M K_q R) δ_b。scalar：pole_i = 1 − μK_qλ_i；k95_i = ⌈ln 0.05 / ln|p_i|⌉（MSE-LMS 傳 K_q = 1） */
export function modeAnalysis(R: Matrix, Kq: number, mu: number, N: number, precond: Preconditioner = 'none', gamma = 0.5, etaScale = 1): ModeAnalysis {
  const warnings: string[] = []
  const es = eigSym(R)
  const lambdas = es.values
  const lambdaMax = lambdas[0]
  const lambdaMin = lambdas[lambdas.length - 1]
  const singular = !(lambdaMin > 1e-12 * Math.max(lambdaMax, 1e-300))
  const kappa = singular ? Infinity : lambdaMax / lambdaMin
  if (singular) warnings.push('相關矩陣 $\\mathbf R$ 奇異（$\\lambda_{\\min}=0$）：有參數方向完全沒有被 code 激發（gauge／缺乏 persistent excitation），那個方向的參數不會收斂到唯一的值。')
  let poles: number[]
  let gains: number[]
  let modeVar: number[]
  if (precond === 'none') {
    poles = lambdas.map((l) => 1 - mu * Kq * l)
    gains = poles.map((p) => 1 - p)
    // Sign：Var(η_i) = λ_i/N（q² = 1）；MSE：Var(η_i) ≈ (σ_v² + floor²)λ_i/N（etaScale = σ_v² + floor²）
    modeVar = lambdas.map((l, i) => (Math.abs(poles[i]) < 1 ? (mu * mu * l * etaScale) / (N * (1 - poles[i] * poles[i])) : NaN))
  } else {
    const P = R.length
    const M: number[][] = Array.from({ length: P }, () => new Array<number>(P).fill(0))
    if (precond === 'diag') for (let i = 0; i < P; i++) M[i][i] = R[i][i] > 0 ? gamma / (Kq * R[i][i]) : 0
    else if (!singular) {
      const Rinv = pinv(R)
      for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) M[i][j] = (gamma / Kq) * Rinv[i][j]
    }
    const A = identity(P)
    for (let i = 0; i < P; i++)
      for (let j = 0; j < P; j++) {
        let s = 0
        for (let k = 0; k < P; k++) s += M[i][k] * R[k][j]
        A[i][j] -= Kq * s
      }
    poles = eigvals(A).map((z) => Math.hypot(z.re, z.im))
    gains = poles.map((p) => 1 - p)
    modeVar = poles.map(() => NaN)
  }
  const k95 = poles.map((p) => (Math.abs(p) < 1 && p !== 0 ? Math.ceil(Math.log(DECAY_95) / Math.log(Math.abs(p))) : Infinity))
  // 沒有被激發的模式（λ = 0）pole 恰為 1：那不是發散，是不可辨識（上面已警告）；其餘模式 |p| ≥ 1 才是 μ 太大
  const tol = 1e-12 * Math.max(lambdaMax, 1e-300)
  const excited = precond === 'none' ? lambdas.map((l) => l > tol) : poles.map((p) => Math.abs(p - 1) > 1e-9)
  const stable = poles.every((p, i) => Math.abs(p) < 1 || !excited[i])
  if (!stable) warnings.push(`有模式的 pole $|p|\\ge1$（最大 ${Math.max(...poles.map(Math.abs)).toFixed(3)}）：$\\mu K_q\\lambda_{\\max}\\ge2$，平均動態發散，請降低 $\\mu$。`)
  // 最慢的「有被激發」的模式
  let slowIdx = -1
  for (let i = 0; i < k95.length; i++) if (excited[i] && (slowIdx < 0 || k95[i] > k95[slowIdx])) slowIdx = i
  if (slowIdx < 0) slowIdx = 0
  // 參數座標的穩態 std：Cov(δ) = Σ_i Var(ξ_i) v_i v_iᵀ
  const P = R.length
  const paramStd = new Array<number>(P).fill(NaN)
  if (precond === 'none') {
    for (let a = 0; a < P; a++) {
      let s = 0
      for (let i = 0; i < P; i++) {
        const v = es.vectors[a][i]
        s += (Number.isFinite(modeVar[i]) ? modeVar[i] : 0) * v * v
      }
      paramStd[a] = Math.sqrt(s)
    }
  }
  return {
    lambdas,
    lambdaMax,
    lambdaMin,
    cond: kappa,
    poles,
    gains,
    k95,
    k95Slowest: k95[slowIdx],
    tauSlowest: gains[slowIdx] > 0 ? 1 / gains[slowIdx] : Infinity,
    modeVar,
    paramStd,
    stable,
    singular,
    warnings,
  }
}
// #endregion

/** 分段 LMS 的封閉式（uniform x、第 k 段）：λ_k、pole、τ、k95、穩態 std（HC-11B.2） */
export function segmentClosedForm(k: number, K: number, mu: number, sigmaV: number, N: number) {
  const [lo, hi] = segmentBounds(k, K)
  const lambda = (hi ** 3 - lo ** 3) / 6
  const Kq = kqFromSigma(sigmaV)
  const g = mu * Kq * lambda
  const pole = 1 - g
  const k95 = Math.abs(pole) < 1 ? Math.ceil(Math.log(DECAY_95) / Math.log(Math.abs(pole))) : Infinity
  const varW = Math.abs(pole) < 1 ? (mu * mu * lambda) / (N * (1 - pole * pole)) : NaN
  return { lo, hi, lambda, Kq, g, pole, tau: g > 0 ? 1 / g : Infinity, k95, varW, stdW: Math.sqrt(varW) }
}

/** LUT LMS 的封閉式（uniform x、J 格）：p_j = 1/J、τ_j、k95、每格在一個時間常數內的樣本數 N/(μK_q)、有效平均長度 2N/(μK_q)、穩態 std（HC-11B.3） */
export function lutClosedForm(J: number, mu: number, sigmaV: number, N: number) {
  const pj = 1 / J
  const Kq = kqFromSigma(sigmaV)
  const g = mu * Kq * pj
  const pole = 1 - g
  const k95 = Math.abs(pole) < 1 ? Math.ceil(Math.log(DECAY_95) / Math.log(Math.abs(pole))) : Infinity
  const tau = g > 0 ? 1 / g : Infinity
  const varTheta = Math.abs(pole) < 1 ? (mu * mu * pj) / (N * (1 - pole * pole)) : NaN
  return { pj, Kq, g, pole, tau, k95, samplesPerBinPerTau: N / (mu * Kq), effectiveSamples: (2 * N) / (mu * Kq), varTheta, stdTheta: Math.sqrt(varTheta) }
}

// #region core:lutApproxRms
/**
 * LUT 每格存一個常數時的近似誤差（uniform x、格寬 Δ = 2/J）：格內殘差 ≈ d′(x)·(x − x̄_j)，
 * rms² = E[d′(x)²]·Δ²/12，d′ = 2d_2x + 3d_3x² ⇒ E[d′²] = 4d_2²/3 + 9d_3²/5（鋸齒不含在內）。
 */
export function lutApproxRms(shape: Pick<InlShape, 'd2' | 'd3'>, J: number): number {
  const delta = 2 / J
  const Ed2 = (4 * shape.d2 ** 2) / 3 + (9 * shape.d3 ** 2) / 5
  return delta * Math.sqrt(Ed2 / 12)
}
// #endregion

/** 硬體成本的粗估（illustrative；每個 sample 的乘法器數、加法器數、記憶體字數） */
export function hardwareCost(c: StructureConfig): { multipliers: number; adders: number; memoryWords: number; note: string } {
  if (c.structure === 'piecewise') return { multipliers: 1, adders: 1, memoryWords: c.K, note: `選段比較器 + 1 個乘法器（$w_k\\,x$）；$K=${c.K}$ 個 gain 暫存器` }
  if (c.structure === 'lut') return { multipliers: 0, adders: 1, memoryWords: c.J, note: `查表即修正值，不需要乘法器；$J=${c.J}$ 個字的 RAM；每格只在被造訪時更新` }
  const mults = c.basis === 'monomial' ? c.M : 2 * c.M
  return { multipliers: mults, adders: c.M, memoryWords: c.M + 1, note: c.basis === 'monomial' ? `Horner：$M=${c.M}$ 個乘法器、$M$ 個加法器；$M+1$ 個係數` : `遞迴產生基底：每階約 2 個乘法器；$M+1$ 個係數` }
}

// ───────────────────────── LS 最佳解與殘餘 INL ─────────────────────────

export interface LsOptimum {
  theta: number[]
  /** 收斂後殘餘 INL 的 rms（code 分布加權；結構的近似誤差） */
  residualRms: number
  singular: boolean
}

/**
 * 最小平方最佳解：R θ* = p，p = mean(ψ · target)，target = (a − w_fixed)x + b + d(x)（gain 同時校正時 w 的目標 = a 含在 θ 裡）。
 * R 奇異時用最小範數解（pinv）。
 */
export function lsOptimum(x: ArrayLike<number>, target: ArrayLike<number>, c: StructureConfig, limit = MOMENT_SAMPLES): LsOptimum {
  const P = totalParams(c)
  const n = Math.min(x.length, limit)
  const R = momentMatrix(x, c, limit)
  const p = new Array<number>(P).fill(0)
  const psi = new Float64Array(P)
  for (let i = 0; i < n; i++) {
    regressorInto(psi, x[i], c)
    for (let a = 0; a < P; a++) p[a] += psi[a] * target[i]
  }
  for (let a = 0; a < P; a++) p[a] /= n
  let theta: number[]
  let singular = false
  try {
    theta = solve(R, p)
    if (theta.some((v) => !Number.isFinite(v))) throw new Error('non-finite')
    const es = eigSym(R)
    if (!(es.values[es.values.length - 1] > 1e-10 * es.values[0])) throw new Error('ill-conditioned')
  } catch {
    singular = true
    theta = matVec(pinv(R), p)
  }
  let s = 0
  for (let i = 0; i < n; i++) {
    regressorInto(psi, x[i], c)
    let cx = 0
    for (let a = 0; a < P; a++) cx += theta[a] * psi[a]
    const r = target[i] - cx
    s += r * r
  }
  return { theta, residualRms: Math.sqrt(s / n), singular }
}

/** uniform x 下目標函數 g(x) 在結構 regressor 上的投影 p = E[ψ g]（Simpson，2000 格） */
export function uniformProjection(g: (x: number) => number, c: StructureConfig): number[] {
  const P = totalParams(c)
  const p = new Array<number>(P).fill(0)
  const psi = new Float64Array(P)
  const n = 2000
  for (let i = 0; i <= n; i++) {
    const xi = -1 + (2 * i) / n
    const wgt = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) / (3 * n)
    regressorInto(psi, xi, c)
    const gi = g(xi)
    for (let a = 0; a < P; a++) p[a] += wgt * psi[a] * gi
  }
  return p
}

export interface MeanFieldResidual {
  k: Int32Array
  residualRms: Float64Array
  /** 殘餘 rms 的超出量（相對下限）降到初值 5% 的 block（未達到為 Infinity） */
  k95: number
}

// #region core:meanFieldResidual
/**
 * 小訊號 mean-field 的殘餘 INL：δ_{b+1} = (I − μ K_q R) δ_b（預條件時 I − M K_q R），
 * 殘餘 rms_b = √(δ_bᵀ R δ_b + floor²)（E[(ψᵀδ)²] = δᵀRδ；floor 是結構的近似誤差）。δ_0 = ϑ_0 − ϑ*。
 */
export function meanFieldResidual(R: Matrix, delta0: ArrayLike<number>, Kq: number, mu: number, blocks: number, floor: number, precondM: Matrix | null = null, every = 1): MeanFieldResidual {
  const P = R.length
  const A = identity(P)
  for (let i = 0; i < P; i++)
    for (let j = 0; j < P; j++) {
      let s = 0
      if (precondM) for (let k = 0; k < P; k++) s += precondM[i][k] * R[k][j]
      else s = mu * R[i][j]
      A[i][j] -= Kq * s
    }
  const quad = (d: number[]) => {
    let s = 0
    for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) s += d[i] * R[i][j] * d[j]
    return s
  }
  let delta = Array.from(delta0)
  const q0 = quad(delta)
  const nT = Math.floor(blocks / every) + 1
  const k = new Int32Array(nT)
  const rms = new Float64Array(nT)
  let k95 = Infinity
  let t = 0
  for (let b = 0; b <= blocks; b++) {
    const q = Math.max(0, quad(delta))
    if (b % every === 0 && t < nT) {
      k[t] = b
      rms[t] = Math.sqrt(q + floor * floor)
      t++
    }
    if (!Number.isFinite(k95) && q0 > 0 && q <= DECAY_95 ** 2 * q0) k95 = b
    delta = matVec(A, delta)
  }
  return { k: k.subarray(0, t).slice(), residualRms: rms.subarray(0, t).slice(), k95 }
}
// #endregion

// ───────────────────────── Block LMS 模擬 ─────────────────────────

export type InlAlgorithm = 'sign' | 'mse'

export interface InlLmsParams {
  config: StructureConfig
  shape: InlShape
  code: Omit<InlCodeSpec, 'length'>
  /** 真實 gain 與固定／初始的校正 gain */
  a: number
  w0: number
  /** PD／comparator offset */
  b: number
  sigmaV: number
  mu: number
  N: number
  blocks: number
  algorithm: InlAlgorithm
  precond?: Preconditioner
  gamma?: number
  seed: number
  /** 軌跡每隔幾個 block 記一點（預設自動，≤ 400 點） */
  traceEvery?: number
  /** 初始 INL 參數（預設全 0） */
  theta0?: number[]
}

export interface InlLmsResult {
  /** 軌跡：block 索引與每個參數的值（params[i][t]） */
  trace: { k: Int32Array; params: Float64Array[]; residualRms: Float64Array }
  /** 參數名稱（$…$ TeX） */
  paramNames: string[]
  /** 最後的參數、後半段平均與 std */
  thetaFinal: number[]
  thetaMean: number[]
  thetaStd: number[]
  /** 殘餘 INL：初值、最後 10% 的平均、LS 下限 */
  residualRms0: number
  residualRmsFinal: number
  residualRmsFloor: number
  /** 殘餘 INL 曲線（x 格點、真實 d(x) + gain 誤差、c(x)、殘差）——gain 固定時 d 包含 (a − w_0)x */
  curve: { x: Float64Array; target: Float64Array; correction: Float64Array; residual: Float64Array }
  /** 分析 */
  analytic: ModeAnalysis & { Kq: number; thetaStar: number[]; visit: number[]; lsSingular: boolean; initialRatio: number; Rdiag: number[] }
  /** 95% 收斂的 block（殘餘 rms 的超出量降到 5%；未達到時 null） */
  k95Measured: number | null
  /** 小訊號 mean-field 的殘餘 rms 軌跡與它的 k95 */
  meanField: MeanFieldResidual
  k95Analytic: number
  /** 穩態殘餘 rms 的預測：√(floor² + Σ_i λ_i Var(ξ_i))（misadjustment） */
  residualRmsPredicted: number
  cost: ReturnType<typeof hardwareCost>
  samplesUsed: number
  period: number
  warnings: string[]
}

/** 參數名稱（TeX） */
export function paramNames(c: StructureConfig): string[] {
  const names: string[] = []
  if (c.gainMode === 'adapt') names.push('w')
  if (c.structure === 'piecewise') for (let k = 0; k < c.K; k++) names.push(`w_{${k + 1}}`)
  else if (c.structure === 'lut') for (let j = 0; j < c.J; j++) names.push(`\\theta_{${j + 1}}`)
  else for (let m = 0; m <= c.M; m++) names.push(`\\theta_{${m}}`)
  return names
}

/** 校正前的目標：gain 固定時 (a − w_0)x + b + d(x)；gain 同時校正時 a·x + b + d(x)（θ 的 w 從 w_0 開始） */
function targetValue(x: number, p: InlLmsParams): number {
  const g = p.config.gainMode === 'adapt' ? p.a : p.a - p.w0
  return g * x + p.b + inlValue(x, p.shape)
}

// #region core:inlBlockLms
/**
 * 一個 block：GMAC 向量 G = (1/N) Σ q ψ（Sign：q = sign(e + v)；MSE：q = e + v），再 ϑ ← ϑ + μ M G。
 * e = target(x) − ϑᵀψ(x)：補償量越接近目標，誤差越小；G 的方向就是把 ϑ 推向目標的方向。
 */
function runBlock(
  p: InlLmsParams,
  x: Float64Array,
  start: number,
  theta: Float64Array,
  psi: Float64Array,
  G: Float64Array,
  noise: () => number,
  precondM: Matrix | null,
): void {
  const P = theta.length
  G.fill(0)
  const L = x.length
  for (let i = 0; i < p.N; i++) {
    const xn = x[(start + i) % L]
    regressorInto(psi, xn, p.config)
    let cx = 0
    for (let a = 0; a < P; a++) cx += theta[a] * psi[a]
    const e = targetValue(xn, p) - cx + (p.sigmaV > 0 ? p.sigmaV * noise() : 0)
    const q = p.algorithm === 'sign' ? (e >= 0 ? 1 : -1) : e // ← 差異：Sign 只用正負號；MSE 用多位元 e
    for (let a = 0; a < P; a++) G[a] += q * psi[a]
  }
  for (let a = 0; a < P; a++) G[a] /= p.N
  if (precondM) {
    // 預條件矩陣 M = (γ/K_q)·R⁻¹（或對角）已含步長 γ：ϑ ← ϑ + M G，μ 不再出現
    for (let a = 0; a < P; a++) {
      let s = 0
      for (let b = 0; b < P; b++) s += precondM[a][b] * G[b]
      theta[a] += s
    }
  } else for (let a = 0; a < P; a++) theta[a] += p.mu * G[a]
}
// #endregion

/** 在 grid 上評估殘餘 INL rms（code 分布加權：用序列的子樣本） */
function residualRmsOn(sample: Float64Array, theta: Float64Array, p: InlLmsParams, psi: Float64Array): number {
  let s = 0
  for (let i = 0; i < sample.length; i++) {
    regressorInto(psi, sample[i], p.config)
    let cx = 0
    for (let a = 0; a < theta.length; a++) cx += theta[a] * psi[a]
    const r = targetValue(sample[i], p) - cx
    s += r * r
  }
  return Math.sqrt(s / sample.length)
}

/**
 * 分段／LUT／多項式 INL 校正的 block LMS 模擬（worker）：軌跡、殘餘 INL rms、LS 下限、模式分析與量測的比較。
 */
export function simulateInlLms(p: InlLmsParams): InlLmsResult {
  const warnings: string[] = []
  if (!(p.N >= 1) || !(p.blocks >= 1)) throw new Error('N 與 blocks 必須 ≥ 1')
  if (!(p.mu > 0)) throw new Error('μ 必須 > 0')
  const c = p.config
  const P = totalParams(c)
  const total = p.N * p.blocks
  const L = Math.min(total, MAX_CODE_SAMPLES)
  const code = generateInlCode({ ...p.code, length: L, seed: p.seed })
  warnings.push(...code.warnings)
  if (total > L) warnings.push(`code 序列長度上限 $2^{20}$：${p.blocks} 個 block × $N=${p.N}$ 超過，後面的 block 循環使用同一段序列。`)
  const x = code.x
  // Sign-LMS 的小訊號增益 K_q = √(2/π)/σ_v；MSE-LMS 的 GMAC 直接用 e，增益 1
  const Kq = p.algorithm === 'sign' ? kqFromSigma(p.sigmaV) : 1
  const target = new Float64Array(Math.min(L, MOMENT_SAMPLES))
  for (let i = 0; i < target.length; i++) target[i] = targetValue(x[i], p)
  const R = momentMatrix(x, c)
  const ls = lsOptimum(x, target, c)
  const visit = visitProbabilities(x, c)
  const etaScale = p.algorithm === 'sign' ? 1 : p.sigmaV * p.sigmaV + ls.residualRms * ls.residualRms
  const mode = modeAnalysis(R, Kq, p.mu, p.N, p.precond ?? 'none', p.gamma ?? 0.5, etaScale)
  warnings.push(...mode.warnings)
  if (ls.singular) warnings.push('LS 最佳解不唯一（$\\mathbf R$ 奇異）：顯示的 $\\boldsymbol\\vartheta^*$ 是最小範數解；gain 與 INL 參數共線（gauge），個別參數會在不改變總補償量的方向上漂移。')
  const emptyBins = visit.map((v, i) => (v === 0 ? i + 1 : 0)).filter(Boolean)
  if (emptyBins.length) warnings.push(`有 ${emptyBins.length} 個段／格完全沒有被 code 造訪（第 ${emptyBins.slice(0, 8).join('、')}${emptyBins.length > 8 ? '…' : ''}）：它們的參數不會更新（缺乏 persistent excitation，Ch09）。`)
  const rare = visit.map((v, i) => (v > 0 && v < 0.01 ? i + 1 : 0)).filter(Boolean)
  if (rare.length) warnings.push(`有 ${rare.length} 個段／格的造訪機率低於 1%（第 ${rare.slice(0, 8).join('、')}${rare.length > 8 ? '…' : ''}）：它們的時間常數比平均長數十倍。`)
  const precondM = p.precond && p.precond !== 'none' ? buildPrecond(R, Kq, p.precond, p.gamma ?? 0.5) : null

  const theta = new Float64Array(P)
  if (c.gainMode === 'adapt') theta[0] = p.w0
  if (p.theta0) for (let i = 0; i < Math.min(P, p.theta0.length); i++) theta[(c.gainMode === 'adapt' ? 1 : 0) + i] = p.theta0[i]
  const psi = new Float64Array(P)
  const G = new Float64Array(P)
  const rng = createRng(p.seed).fork('inl-lms-noise')
  const noise = () => rng.normal()
  const sample = x.subarray(0, Math.min(L, 2048))
  const residualRms0 = residualRmsOn(sample, theta, p, psi)
  const initialRatio = p.sigmaV > 0 ? residualRms0 / p.sigmaV : Infinity
  if (p.algorithm === 'sign' && initialRatio > 1) warnings.push(`校正前的殘餘 INL rms 是 $\\sigma_v$ 的 ${initialRatio.toFixed(1)} 倍：comparator 一開始飽和（$|e|\\gg\\sigma_v$），前段以固定速度 $\\mu E|\\psi|$ 前進，小訊號的 pole／$k_{95}$ 只描述接近終點之後的行為（Ch11 勘誤 E01）。`)
  const every = p.traceEvery ?? Math.max(1, Math.ceil(p.blocks / 400))
  const nTrace = Math.floor(p.blocks / every) + 1
  const k = new Int32Array(nTrace)
  const params = Array.from({ length: P }, () => new Float64Array(nTrace))
  const resTrace = new Float64Array(nTrace)
  const half = Math.floor(p.blocks / 2)
  const sum = new Float64Array(P)
  const sum2 = new Float64Array(P)
  let nAvg = 0
  let t = 0
  const record = (b: number) => {
    k[t] = b
    for (let a = 0; a < P; a++) params[a][t] = theta[a]
    resTrace[t] = residualRmsOn(sample, theta, p, psi)
    t++
  }
  record(0)
  const tail = Math.max(1, Math.floor(p.blocks / 10))
  let tailSum = 0
  let tailN = 0
  for (let b = 0; b < p.blocks; b++) {
    runBlock(p, x, (b * p.N) % L, theta, psi, G, noise, precondM)
    if (b + 1 >= half) {
      for (let a = 0; a < P; a++) {
        sum[a] += theta[a]
        sum2[a] += theta[a] * theta[a]
      }
      nAvg++
    }
    if ((b + 1) % every === 0 && t < nTrace) record(b + 1)
    if (b + 1 > p.blocks - tail) {
      tailSum += residualRmsOn(sample, theta, p, psi)
      tailN++
    }
  }
  const thetaMean = Array.from(sum, (s) => s / Math.max(1, nAvg))
  const thetaStd = Array.from(sum2, (s, a) => Math.sqrt(Math.max(0, s / Math.max(1, nAvg) - thetaMean[a] ** 2)))
  const residualRmsFinal = tailSum / Math.max(1, tailN)
  const floor = ls.residualRms
  // k95（量測）：殘餘 rms 的「超出量」（相對最後 10% 的平均，平方差）第一次降到初值的 5%（振幅比 0.05 ⇔ 功率比 0.0025）
  const excess0 = Math.max(0, residualRms0 ** 2 - residualRmsFinal ** 2)
  let k95Measured: number | null = null
  for (let i = 0; i < t; i++) {
    const ex = resTrace[i] ** 2 - residualRmsFinal ** 2
    if (excess0 > 0 && ex <= DECAY_95 ** 2 * excess0) {
      k95Measured = k[i]
      break
    }
  }
  // mean-field：δ_0 = ϑ_0 − ϑ*
  const theta0 = new Float64Array(P)
  if (c.gainMode === 'adapt') theta0[0] = p.w0
  if (p.theta0) for (let i = 0; i < Math.min(P, p.theta0.length); i++) theta0[(c.gainMode === 'adapt' ? 1 : 0) + i] = p.theta0[i]
  const delta0 = Array.from(theta0, (v, i) => v - ls.theta[i])
  const meanField = meanFieldResidual(R, delta0, Kq, p.mu, p.blocks, floor, precondM, every)
  let misadj = 0
  for (let i = 0; i < mode.lambdas.length; i++) if (Number.isFinite(mode.modeVar[i])) misadj += mode.lambdas[i] * mode.modeVar[i]
  const residualRmsPredicted = Math.sqrt(floor * floor + misadj)
  const gx = xGrid(201)
  const tgt = new Float64Array(gx.length)
  const corr = new Float64Array(gx.length)
  const resid = new Float64Array(gx.length)
  for (let i = 0; i < gx.length; i++) {
    tgt[i] = targetValue(gx[i], p)
    corr[i] = correction(gx[i], theta, c)
    resid[i] = tgt[i] - corr[i]
  }
  if (!Number.isFinite(meanField.k95) && residualRms0 > floor) warnings.push(`mean-field 的殘餘 INL 在 ${p.blocks} 個 block 內還沒降到初值的 5%（最慢的有效模式 $k_{95}=${Number.isFinite(mode.k95Slowest) ? mode.k95Slowest : '\\infty'}$）：請加長 blocks 或加大 $\\mu$。`)
  else if (residualRmsFinal > 2 * floor + 0.1 * residualRms0 && Number.isFinite(mode.k95Slowest) && mode.k95Slowest > p.blocks) warnings.push(`最慢模式的 $k_{95}=${mode.k95Slowest}$ blocks 超過模擬長度 ${p.blocks}：殘餘 INL 還沒收斂到下限，請加長 blocks 或加大 $\\mu$。`)
  return {
    trace: { k: k.subarray(0, t).slice(), params: params.map((a) => a.subarray(0, t).slice()), residualRms: resTrace.subarray(0, t).slice() },
    paramNames: paramNames(c),
    thetaFinal: Array.from(theta),
    thetaMean,
    thetaStd,
    residualRms0,
    residualRmsFinal,
    residualRmsFloor: floor,
    curve: { x: gx, target: tgt, correction: corr, residual: resid },
    analytic: { ...mode, Kq, thetaStar: ls.theta, visit, lsSingular: ls.singular, initialRatio, Rdiag: R.map((row, i) => row[i]) },
    k95Measured,
    meanField,
    k95Analytic: meanField.k95,
    residualRmsPredicted,
    cost: hardwareCost(c),
    samplesUsed: L,
    period: code.period,
    warnings,
  }
}

function buildPrecond(R: Matrix, Kq: number, kind: Preconditioner, gamma: number): Matrix {
  const P = R.length
  const M: number[][] = Array.from({ length: P }, () => new Array<number>(P).fill(0))
  if (kind === 'diag') for (let i = 0; i < P; i++) M[i][i] = R[i][i] > 0 ? gamma / (Kq * R[i][i]) : 0
  else {
    const Rinv = pinv(R)
    for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) M[i][j] = (gamma / Kq) * Rinv[i][j]
  }
  // 預條件矩陣已含 γ/K_q：模擬以 ϑ ← ϑ + M·G 更新（runBlock），μ 不再出現
  return M
}

// ───────────────────────── 結構分析（不模擬） ─────────────────────────

export interface StructureAnalysisParams {
  config: StructureConfig
  shape: InlShape
  code: Omit<InlCodeSpec, 'length'>
  a: number
  w0: number
  b: number
  sigmaV: number
  mu: number
  N: number
  precond?: Preconditioner
  gamma?: number
  seed?: number
  length?: number
  /** 預設 'sign'（K_q = √(2/π)/σ_v）；'mse' 時 K_q = 1 */
  algorithm?: InlAlgorithm
}

export interface StructureAnalysis {
  R: Matrix
  mode: ModeAnalysis
  Kq: number
  ls: LsOptimum
  visit: number[]
  cost: ReturnType<typeof hardwareCost>
  residualRms0: number
  warnings: string[]
}

/** 只做分析（R、模式、LS 下限、造訪機率）：給 UI 即時顯示用 */
export function analyzeInlStructure(p: StructureAnalysisParams): StructureAnalysis {
  const L = p.length ?? MOMENT_SAMPLES
  const code = generateInlCode({ ...p.code, length: L, seed: p.seed ?? 1 })
  const x = code.x
  const full: InlLmsParams = { config: p.config, shape: p.shape, code: p.code, a: p.a, w0: p.w0, b: p.b, sigmaV: p.sigmaV, mu: p.mu, N: p.N, blocks: 1, algorithm: 'sign', seed: p.seed ?? 1 }
  const target = new Float64Array(L)
  let s0 = 0
  for (let i = 0; i < L; i++) {
    target[i] = targetValue(x[i], full)
    s0 += target[i] * target[i]
  }
  const algorithm = p.algorithm ?? 'sign'
  const Kq = algorithm === 'sign' ? kqFromSigma(p.sigmaV) : 1
  const R = momentMatrix(x, p.config)
  const ls = lsOptimum(x, target, p.config)
  const etaScale = algorithm === 'sign' ? 1 : p.sigmaV * p.sigmaV + ls.residualRms * ls.residualRms
  const mode = modeAnalysis(R, Kq, p.mu, p.N, p.precond ?? 'none', p.gamma ?? 0.5, etaScale)
  return { R, mode, Kq, ls, visit: visitProbabilities(x, p.config), cost: hardwareCost(p.config), residualRms0: Math.sqrt(s0 / L), warnings: [...code.warnings, ...mode.warnings] }
}

// ───────────────────────── 基底比較（條件數與收斂） ─────────────────────────

export interface BasisComparisonParams {
  code: Omit<InlCodeSpec, 'length'>
  shape: InlShape
  M: number
  bases: PolyBasis[]
  /** 以最大特徵值正規化的 loop gain：μK_qλ_max = gMax（每種基底各自設 μ） */
  gMax: number
  sigmaV: number
  N: number
  blocks: number
  a: number
  b: number
  precond?: Preconditioner
  gamma?: number
  seed: number
  /** 是否同時跑 Monte Carlo（否則只有 mean-field） */
  monteCarlo?: boolean
}

export interface BasisComparisonRow {
  basis: PolyBasis
  cond: number
  lambdas: number[]
  mu: number
  k95Analytic: number
  k95Measured: number | null
  /** mean-field 的殘餘 rms 軌跡 √(δᵀRδ + floor²) */
  meanField: { k: Int32Array; residualRms: Float64Array }
  mc: { k: Int32Array; residualRms: Float64Array } | null
  residualRmsFloor: number
  residualRmsFinal: number | null
  warnings: string[]
}

/**
 * 同一組 code、同一個 INL，用不同多項式基底做 LMS：條件數、mean-field 收斂曲線（δ_{b+1} = (I − μK_qR)δ_b）與 Monte Carlo。
 * 每種基底的 μ 都設成 μK_qλ_max = gMax，比較的是最慢模式（λ_min）的速度。
 */
export function basisComparison(p: BasisComparisonParams): { rows: BasisComparisonRow[]; Kq: number; warnings: string[] } {
  const Kq = kqFromSigma(p.sigmaV)
  const L = MOMENT_SAMPLES
  const code = generateInlCode({ ...p.code, length: L, seed: p.seed })
  const x = code.x
  const rows: BasisComparisonRow[] = []
  for (const basis of p.bases) {
    const cfg: StructureConfig = { ...DEFAULT_STRUCTURE, structure: 'poly', M: p.M, basis, gainMode: 'fixed' }
    const params: InlLmsParams = { config: cfg, shape: p.shape, code: p.code, a: p.a, w0: p.a, b: p.b, sigmaV: p.sigmaV, mu: 1, N: p.N, blocks: p.blocks, algorithm: 'sign', seed: p.seed, precond: p.precond, gamma: p.gamma }
    const target = new Float64Array(L)
    for (let i = 0; i < L; i++) target[i] = targetValue(x[i], params)
    const R = momentMatrix(x, cfg)
    const es = eigSym(R)
    const lamMax = es.values[0]
    const precond = p.precond ?? 'none'
    const mu = precond === 'none' ? p.gMax / (Kq * lamMax) : 1
    params.mu = mu
    const mode = modeAnalysis(R, Kq, mu, p.N, precond, p.gamma ?? p.gMax)
    const ls = lsOptimum(x, target, cfg)
    const floor = ls.residualRms
    // mean-field：δ_0 = −θ*（θ_0 = 0），δ_{b+1} = (I − μ M K_q R) δ_b，殘餘 rms = √(δᵀRδ + floor²)
    const Mmat = precond === 'none' ? null : buildPrecond(R, Kq, precond, p.gamma ?? p.gMax)
    const every = Math.max(1, Math.ceil(p.blocks / 400))
    const mfr = meanFieldResidual(R, ls.theta.map((v) => -v), Kq, mu, p.blocks, floor, Mmat, every)
    const k95Analytic = mfr.k95
    let mc: BasisComparisonRow['mc'] = null
    let k95Measured: number | null = null
    let residualRmsFinal: number | null = null
    const warnings = [...mode.warnings]
    if (p.monteCarlo !== false) {
      const sim = simulateInlLms(params)
      mc = { k: sim.trace.k, residualRms: sim.trace.residualRms }
      k95Measured = sim.k95Measured
      residualRmsFinal = sim.residualRmsFinal
      warnings.push(...sim.warnings.filter((w) => !mode.warnings.includes(w)))
    }
    rows.push({ basis, cond: mode.cond, lambdas: mode.lambdas, mu, k95Analytic, k95Measured, meanField: { k: mfr.k, residualRms: mfr.residualRms }, mc, residualRmsFloor: floor, residualRmsFinal, warnings })
  }
  return { rows, Kq, warnings: [...code.warnings] }
}

/** comparator 的平均輸出 E[q | e] = erf(e/(√2σ_v))（與 Ch11 同一個模型） */
export function comparatorMean(e: number, sigmaV: number): number {
  if (sigmaV <= 0) return e > 0 ? 1 : e < 0 ? -1 : 0
  return erf(e / (Math.SQRT2 * sigmaV))
}

export { cond as matrixCond }
