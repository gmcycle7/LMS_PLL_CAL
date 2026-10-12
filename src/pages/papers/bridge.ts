/**
 * Papers / Reading 頁的「文獻寫法 ↔ 本站約定」換算與驗算核心（純數值，無 React / DOM）。
 *
 * 這個檔案只服務 /papers 頁：
 *   1. 把教科書與論文常見的步長寫法（½e² 型、Widrow 的 2μ 型、NLMS、本站 block sign-GMAC）
 *      換成同一個「每單位 eigenvalue 的 loop gain」s，於是第 i 個 mode 的 g_i = s·λ_i。
 *   2. 計算更新延遲 d 下的 spectral radius、臨界增益 g*(d)、phase margin。
 *   3. 重算每篇文獻「本站對應推導」面板上的數字（係數雜訊、單頻相關、量化 limit cycle、dither…）。
 * 頁面上的所有數字都由這裡的函式即時算出，測試再以 golden/vectors（Python 獨立實作）交叉比對；
 * 這些都是本站由基礎模型推導的結果，**不是**任何一篇文獻的數字。
 *
 * 約定（規格 §0 + docs/validation.md）：δ = a − w（E32/E39）；q = sign(e)，e ≥ 0 → +1（E07）；
 * 時間 fs；x、u 正規化為無因次；average-mode GMAC 的 μ 單位為 fs；K_q 為 fs⁻¹；g 無因次（E13）。
 * 時間索引：n = comparator sample、k = GMAC block。
 */
import { cAbs, createRng, polyRoots } from '@/simulation/core'
import { fft } from '@/simulation/signal'

export const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)

/** 1-bit comparator 的小訊號增益 K_q = √(2/π)/σ_v [fs⁻¹]（Ch05；|δ| ≪ σ_v、Gaussian v 的近似）。 */
export function comparatorKq(sigmaV: number): number {
  return SQRT_2_OVER_PI / sigmaV
}

// ───────────────────────── 1. 步長寫法（convention） ─────────────────────────

export type Convention = 'half' | 'widrow' | 'nlms' | 'signBlock'

export const CONVENTIONS: readonly Convention[] = ['half', 'widrow', 'nlms', 'signBlock']

/** 下拉選單用的純文字名稱（<option> 不能放 KaTeX，所以這裡不寫公式；公式見 CONVENTION_UPDATE_TEX）。 */
export const CONVENTION_LABEL: Record<Convention, string> = {
  half: '本站 Part A 寫法（成本帶二分之一；Haykin 型的更新式同形）',
  widrow: 'Widrow 寫法（成本不帶二分之一；更新式帶 2 倍）',
  nlms: 'NLMS（步長除以 regressor 能量）',
  signBlock: '本站 Block Sign-GMAC（1-bit 誤差、每個 block 更新一次）',
}

/** 短名稱：`$…$` 內為 TeX（頁面以 mathText / RichText 顯示）。 */
export const CONVENTION_SHORT: Record<Convention, string> = {
  half: String.raw`$\tfrac12e^2$ 型`,
  widrow: String.raw`Widrow $2\mu$ 型`,
  nlms: 'NLMS',
  signBlock: 'Block Sign-GMAC',
}

/** 每種寫法的更新式（TeX）。 */
export const CONVENTION_UPDATE_TEX: Record<Convention, string> = {
  half: String.raw`w\leftarrow w+\mu\,e\,x`,
  widrow: String.raw`\mathbf W\leftarrow\mathbf W+2\mu_W\,\varepsilon\,\mathbf X`,
  nlms: String.raw`w\leftarrow w+\tilde\mu\,e\,x/(\epsilon_{\mathrm{reg}}+\|x\|^2)`,
  signBlock: String.raw`w\leftarrow w+\mu\,G_k,\quad G_k=\tfrac1N\textstyle\sum q\,x`,
}

/** 每種寫法「書上的步長」符號（TeX）。 */
export const CONVENTION_MU_TEX: Record<Convention, string> = {
  half: String.raw`\mu`,
  widrow: String.raw`\mu_W`,
  nlms: String.raw`\tilde\mu`,
  signBlock: String.raw`\mu`,
}

export interface ScalarStepInput {
  w: number
  x: number
  y: number
  mu: number
  /** NLMS 的 regularizer ε_reg ≥ 0 */
  epsReg?: number
}

export interface ScalarStepOutput {
  /** 這一步的誤差 e = y − w·x（Widrow 記為 ε） */
  e: number
  dw: number
  w: number
}

// #region core:widrowStep
/** Widrow 型：成本取 ε²（沒有 ½），梯度 −2εx，所以更新式自帶 2 倍。 */
export function widrowStep({ w, x, y, mu }: ScalarStepInput): ScalarStepOutput {
  const e = y - w * x // 預測誤差（Widrow 記為 ε）
  const dw = 2 * mu * e * x // ← 差異：成本 ε² 而非 ½e²，梯度多一個 2
  return { e, dw, w: w + dw }
}
// #endregion

// #region core:nlmsStep
/** NLMS：步長除以 regressor 能量，更新量與 x 的大小無關。 */
export function nlmsStep({ w, x, y, mu, epsReg = 0 }: ScalarStepInput): ScalarStepOutput {
  const e = y - w * x // 預測誤差
  const dw = (mu * e * x) / (epsReg + x * x) // ← 差異：除以 ε_reg + ‖x‖²（正規化）
  return { e, dw, w: w + dw }
}
// #endregion

export interface BlockSignInput {
  /** 這個 block 使用的係數 w_k [fs per unit code] */
  w: number
  /** 真實 gain a [fs per unit code] */
  a: number
  /** 這個 block 的 code x[n]（無因次） */
  xs: ArrayLike<number>
  /** comparator 前雜訊 v[n] [fs] */
  vs: ArrayLike<number>
  /** gain step μ [fs]（average 模式） */
  mu: number
  /** true：GMAC 輸出總和 Σ（忘記 /N 的反面測試） */
  sumMode?: boolean
}

// #region core:blockSignGmacStep
/** 本站 block sign-error LMS：comparator 只給 1 bit，GMAC 累加 N 個 sample 才更新一次。 */
export function blockSignGmacStep({ w, a, xs, vs, mu, sumMode = false }: BlockSignInput): { G: number; w: number } {
  let acc = 0
  for (let n = 0; n < xs.length; n++) {
    const e = (a - w) * xs[n] + vs[n] // PD 看到的誤差 [fs]（δ = a − w）
    const q = e >= 0 ? 1 : -1 // ← 差異：只用 1-bit 的 sign(e)（e = 0 → +1，勘誤 E07）
    acc += q * xs[n]
  }
  const G = sumMode ? acc : acc / xs.length // ← 差異：average 模式要除以 N（忘記 /N 時 g 放大 N 倍）
  return { G, w: w + mu * G } // ← 差異：一個 block（N 個 sample）才更新一次
}
// #endregion

export interface ConventionInput {
  convention: Convention
  /** 書上（該寫法）的步長；signBlock 時為 gain step μ [fs] */
  mu: number
  /** NLMS：E‖x‖² = tr R */
  traceR: number
  /** NLMS：regularizer ε_reg ≥ 0 */
  epsReg: number
  /** signBlock：comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** signBlock：GMAC 長度 N */
  N: number
  /** signBlock：GMAC 用總和卻沿用 average 的 μ（反面測試） */
  sumMode: boolean
  /** 更新極性：+1 正確、−1 接反（comparator 或 GMAC 符號錯，等效 C < 0） */
  polarity: 1 | -1
}

function unsignedScale(c: ConventionInput): number {
  switch (c.convention) {
    case 'half':
      return c.mu
    case 'widrow':
      return 2 * c.mu
    case 'nlms':
      return c.mu / (c.epsReg + c.traceR)
    case 'signBlock':
      return c.mu * comparatorKq(c.sigmaV) * (c.sumMode ? c.N : 1)
  }
}

// #region core:gainScale
/**
 * 任一寫法 → 每單位 eigenvalue 的平均 loop gain s：第 i 個 mode 的 g_i = s·λ_i，無延遲時 pole p_i = 1 − g_i。
 *   ½e² 型 ：s = μ                       （精確｜mean 模型）
 *   Widrow ：s = 2μ_W                    （代數恆等）
 *   NLMS   ：s ≈ μ̃/(ε_reg + tr R)        （近似：把 ‖x‖² 換成平均值 tr R）
 *   GMAC   ：s = μ·K_q（sum 模式再 ×N）   （近似：comparator 小訊號線性化）
 */
export function gainScale(c: ConventionInput): number {
  return c.polarity * unsignedScale(c)
}
// #endregion

/** 反過來：要得到同一個 s，每一種寫法的步長應該是多少（「同一個演算法，不同寫法」換算表）。 */
export function muForScale(s: number, target: Convention, ctx: Omit<ConventionInput, 'convention' | 'mu' | 'polarity'>): number {
  const unit = unsignedScale({ ...ctx, convention: target, mu: 1, polarity: 1 })
  return s / unit
}

/** 2 參數相關矩陣 R = P_x[[1, ρ], [ρ, 1]] 的 eigenvalues：P_x(1 ± |ρ|)。 */
export function corr2Eigs(Px: number, rho: number): { lmax: number; lmin: number } {
  const r = Math.abs(rho)
  return { lmax: Px * (1 + r), lmin: Px * (1 - r) }
}

// ───────────────────────── 2. 更新延遲、臨界增益、PM ─────────────────────────

// #region core:delayRecursion
/**
 * 平均誤差的延遲遞迴 δ_{k+1} = δ_k − g·δ_{k−d}（d = 更新延遲，單位 block；k − d < 0 時用 δ_0）。
 * 特徵多項式 z^{d+1} − z^d + g（降冪係數）；最大根的模（spectral radius）< 1 ⇔ 平均誤差收斂。
 */
export function delayCharPoly(g: number, d: number): number[] {
  const p = new Array<number>(d + 2).fill(0)
  p[0] = 1
  p[1] = -1
  p[d + 1] += g // d = 0 時：z − (1 − g)
  return p
}

export function delaySpectralRadius(g: number, d: number): number {
  if (d === 0) return Math.abs(1 - g) // 一階：pole = 1 − g
  let r = 0
  for (const z of polyRoots(delayCharPoly(g, d))) r = Math.max(r, cAbs(z))
  return r
}

export function delayedTrajectory(g: number, d: number, steps: number, delta0 = 1, limit = 1e12): Float64Array {
  const out = new Float64Array(steps + 1).fill(Number.NaN)
  out[0] = delta0
  for (let k = 0; k < steps; k++) {
    const seen = k - d >= 0 ? out[k - d] : delta0 // GMAC 看到的是 d 個 block 前的係數造成的誤差
    out[k + 1] = out[k] - g * seen
    if (!Number.isFinite(out[k + 1]) || Math.abs(out[k + 1]) > limit) break
  }
  return out
}
// #endregion

// #region core:criticalGain
/**
 * 臨界增益（封閉式）：在單位圓 z = e^{jω} 上解 g = z^d(1 − z) = 2 sin(ω/2)·e^{j[(d+½)ω − π/2]}，
 * 要 g 為正實數 ⇒ (d + ½)ω = π/2 ⇒ ω* = π/(2d+1)、g*(d) = 2 sin(π/(4d+2))。
 */
export function criticalGain(d: number): number {
  return 2 * Math.sin(Math.PI / (4 * d + 2))
}

export function criticalOmega(d: number): number {
  return Math.PI / (2 * d + 1)
}
// #endregion

/** 數值驗算（不用封閉式）：從 g = 0⁺ 掃描 spectral radius 第一次 ≥ 1 的位置，再用二分法收斂。 */
export function criticalGainNumeric(d: number, gMax = 2.5, grid = 2500, tol = 1e-13): number {
  let lo = 0
  let hi = Number.NaN
  for (let i = 1; i <= grid; i++) {
    const g = (gMax * i) / grid
    if (delaySpectralRadius(g, d) >= 1) {
      hi = g
      break
    }
    lo = g
  }
  if (!Number.isFinite(hi)) return Number.NaN
  for (let it = 0; it < 200 && hi - lo > tol; it++) {
    const mid = 0.5 * (lo + hi)
    if (delaySpectralRadius(mid, d) >= 1) hi = mid
    else lo = mid
  }
  return 0.5 * (lo + hi)
}

// #region core:pmWithDelay
/**
 * L(z) = g·z^{−d}/(z − 1)：|L(e^{jω})| = g/(2 sin(ω/2)) = 1 ⇒ ω_c = 2 asin(g/2)；
 * ∠L = −dω_c − (π/2 + ω_c/2) ⇒ PM = 180° + ∠L = 90° − (2d+1)·asin(g/2)。PM = 0 恰好在 g = g*(d)。
 */
export function pmWithDelayDeg(g: number, d: number): number {
  if (!(g > 0) || g > 2) return Number.NaN
  return 90 - ((2 * d + 1) * Math.asin(g / 2) * 180) / Math.PI
}
// #endregion

// #region core:stepsToDecay
/** 誤差衰減到 frac（預設 5%）所需的步數 ⌈ln frac / ln ρ⌉；ρ ≥ 1 不會衰減（∞）。 */
export function stepsToDecay(radius: number, frac = 0.05): number {
  if (!(radius < 1)) return Infinity
  if (radius <= 0) return 1
  return Math.ceil(Math.log(frac) / Math.log(radius))
}
// #endregion

// #region core:countedStepsToDecay
/**
 * 逐 step 數出來的衰減步數（技術審查 R02）：照平均遞迴 δ_{k+1} = δ_k − g·δ_{k−d} 一步一步算
 * （初始歷史 δ_j = 1，j ≤ 0，和 delayedTrajectory 相同），回傳 1 + max{k : |δ_k| > frac}，
 * 也就是暫態「最後一次」超過 frac 的下一個 step（不是第一次低於：複數根會回彈）。
 * d = 0 時 δ_k = (1 − g)^k，結果就是 stepsToDecay(|1 − g|)；d ≥ 1 時 |z|_max^k 不是 |δ_k| 的包絡，兩者會差幾步到幾十步。
 * 停止規則：連續 d + 1 個 |δ|（整個狀態）都 ≤ frac·10⁻³ 才停。之後不會再超過 frac 的依據是量到的上界，不是證明：
 * 狀態的 ∞-範數之後最多再放大 sup_j ‖F^j‖_∞ = 1 + d·g 倍（本實驗的 d ≤ 6、0 < g < g*(d) 逐點量測，最大 2.45），離 frac 還有約 400 倍的餘裕；
 * labModel.test.ts 以格點和長時間的暴力遞推比對。不穩定（|z|_max ≥ 1）回傳 ∞；maxSteps 內沒有停（極慢的 mode）回傳 NaN。
 */
export function countedStepsToDecay(g: number, d: number, frac = 0.05, maxSteps = 1_000_000): number {
  const radius = delaySpectralRadius(g, d)
  if (!(radius < 1)) return Infinity
  if (d === 0) return stepsToDecay(radius, frac)
  const L = d + 1
  // 環形緩衝：步驟 n 開始時 ring[n % L] = δ_n、ring[(n + 1) % L] = δ_{n−d}
  const ring = new Float64Array(L).fill(1)
  let lastAbove = 0
  let small = 0
  for (let n = 0; n < maxSteps; n++) {
    const next = ring[n % L] - g * ring[(n + 1) % L]
    ring[(n + 1) % L] = next
    const a = Math.abs(next)
    if (a > frac) lastAbove = n + 1
    if (a <= frac * 1e-3) {
      if (++small >= L) return lastAbove + 1
    } else small = 0
  }
  return Number.NaN
}
// #endregion

// ───────────────────────── 3. D1：係數雜訊（Ch12） ─────────────────────────

export interface CalNoiseInput {
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** GMAC 長度 N */
  N: number
  /** gain step μ [fs]（average 模式） */
  mu: number
  /** 有效相關 C = E[x·u]（unit-RMS code、identity path 時 C = 1） */
  C: number
  /** comparator 取樣率 f_s [Hz] */
  fs: number
}

export interface CalBandwidths {
  /** exact discrete −3 dB corner [Hz]；p ≤ 3 − 2√2 或 p ≥ 1 時不存在（NaN，勘誤 E27） */
  f3dbExact: number
  /** −ln p 近似 [Hz] */
  f3dbNegLnP: number
  /** (1 − p) 近似 [Hz] */
  f3dbOneMinusP: number
  /** one-sided equivalent noise bandwidth [Hz]：σ_w² = S_w^(1)(0)·ENBW */
  enbw: number
}

export interface CalNoiseResult extends CalBandwidths {
  Kq: number
  g: number
  p: number
  sigmaEta2: number
  sigmaW2: number
  sigmaW: number
  fu: number
  /** 反面測試：GMAC 用總和卻沿用 average 的 μ */
  gSum: number
  pSum: number
}

// #region core:calBandwidths
/** H(z) = μ/(z − p)（block rate f_u）的四種「頻寬」：−3 dB corner 的 exact 值與兩個近似，以及 ENBW（勘誤 E06/E10/E27）。 */
export function calBandwidths(p: number, fu: number): CalBandwidths {
  const cosW = (1 + p * p - 2 * (1 - p) ** 2) / (2 * p) // |μ/(e^{jΩ} − p)|² 降到 DC 的一半：1 + p² − 2p·cosΩ = 2(1 − p)²
  const lowpass = p > 0 && p < 1
  return {
    f3dbExact: lowpass && Math.abs(cosW) <= 1 ? (Math.acos(cosW) / (2 * Math.PI)) * fu : Number.NaN,
    f3dbNegLnP: lowpass ? (-Math.log(p) / (2 * Math.PI)) * fu : Number.NaN,
    f3dbOneMinusP: ((1 - p) / (2 * Math.PI)) * fu,
    enbw: (fu * (1 - p)) / (2 * (1 + p)), // ← 差異：ENBW 不是 −3 dB 點；p → 1 時是它的 π/2 倍
  }
}
// #endregion

// #region core:poleFromBandwidth
/**
 * 反過來讀文獻：只給「校正迴路頻寬 f_BW」與更新率 f_u 時，換回 pole p。同一個數字有兩種讀法，答案不同：
 *
 * (a) f_BW 是 −3 dB corner：1 + p² − 2p·cosΩ = 2(1 − p)²，把左邊寫成 (1 − p)² + 4p·sin²(Ω/2)
 *     ⇒ (1 − p)² = 4p·β²，β = sin(Ω/2) = sin(π·f_BW/f_u) ⇒ 1 − p = 2β√p ⇒ √p = √(1 + β²) − β。
 *     0 < f_BW < f_u/2 才有解（f_BW → f_u/2 時 p → 3 − 2√2，勘誤 E27）。
 */
export function poleFromF3db(f3db: number, fu: number): number {
  if (!(f3db > 0) || !(f3db < fu / 2)) return Number.NaN
  const beta = Math.sin((Math.PI * f3db) / fu) // β = sin(Ω_3dB/2)
  const rootP = Math.sqrt(1 + beta * beta) - beta // √p：t² + 2β·t − 1 = 0 的正根
  return rootP * rootP
}

/** (b) f_BW 是 one-sided ENBW：f_BW = (f_u/2)(1 − p)/(1 + p) ⇒ p = (1 − ν)/(1 + ν)，ν = 2·f_BW/f_u（0 < f_BW < f_u/2）。 */
export function poleFromEnbw(enbw: number, fu: number): number {
  if (!(enbw > 0) || !(enbw < fu / 2)) return Number.NaN
  const nu = (2 * enbw) / fu
  return (1 - nu) / (1 + nu) // ← 差異：f_BW ≪ f_u 時，同一個數字當成 ENBW 換回的 g = 1 − p 只有 (a) 的 2/π（f_BW ≈ 0.32 f_u 以上才反過來）
}
// #endregion

// #region core:calNoise
/** 白色 GMAC 雜訊下的係數變動（規格 §12.1；勘誤 E06/E10/E30）。 */
export function calNoise({ sigmaV, N, mu, C, fs }: CalNoiseInput): CalNoiseResult {
  const Kq = comparatorKq(sigmaV) // fs⁻¹
  const g = mu * Kq * C // 無因次 loop gain
  const p = 1 - g // δw_{k+1} = p·δw_k + μ·η_k
  const sigmaEta2 = 1 / N // 近平衡、iid、E[x²] = 1：Var(G_k) ≈ 1/N
  const sigmaW2 = Math.abs(p) < 1 ? (mu * mu * sigmaEta2) / (1 - p * p) : Infinity
  const fu = fs / N // block update rate [Hz]
  return {
    Kq,
    g,
    p,
    sigmaEta2,
    sigmaW2,
    sigmaW: Math.sqrt(sigmaW2),
    fu,
    ...calBandwidths(p, fu), // −3 dB corner（exact 與兩個近似）與 one-sided ENBW
    gSum: g * N,
    pSum: 1 - g * N,
  }
}
// #endregion

// ───────────────────────── 4. D2：單頻 / 多頻相關與 filtered-x ─────────────────────────

export interface Tone {
  /** code 振幅 A */
  A: number
  /** |H(e^{jΩ})| */
  mag: number
  /** φ = ∠H(e^{jΩ}) [rad] */
  phiRad: number
  /** Ω [rad/sample]，需 0 < Ω < π（勘誤 E46） */
  omega: number
}

// #region core:toneCorrelation
/** 單頻 C = E[x·u] = (A²/2)|H|cos φ（0 < Ω < π、整數週期或長時間平均；勘誤 E46）。 */
export function toneCorrelation(A: number, mag: number, phiRad: number): number {
  return ((A * A) / 2) * mag * Math.cos(phiRad) // GMAC 乘的是原始 x：只看路徑相位 φ
}

/** 多個不同頻率的 tone：交叉項平均為 0，C 是各 tone 的 (A_i²/2)|H_i|cos φ_i 之和（PSD 加權，§6.2）。 */
export function multiToneCorrelation(tones: readonly Tone[]): number {
  return tones.reduce((s, t) => s + toneCorrelation(t.A, t.mag, t.phiRad), 0)
}
// #endregion

/** 時域驗算：直接產生 x[n]、u[n]，相乘後取 n 個 sample 的平均（n 取各 tone 週期的公倍數）。 */
export function multiToneEmpirical(tones: readonly Tone[], n: number): number {
  let acc = 0
  for (let k = 0; k < n; k++) {
    let x = 0
    let u = 0
    for (const t of tones) {
      x += t.A * Math.cos(t.omega * k)
      u += t.A * t.mag * Math.cos(t.omega * k + t.phiRad)
    }
    acc += x * u
  }
  return acc / n
}

// #region core:fxToneCorrelation
/** Filtered-x 在單頻的相關：E[u·u_f] = (A²/2)|H||Ĥ|cos(φ − φ̂)（勘誤 E45：模型誤差超過 90° 就反號）。 */
export function fxToneCorrelation(A: number, magH: number, phiH: number, magHat: number, phiHat: number): number {
  return ((A * A) / 2) * magH * magHat * Math.cos(phiH - phiHat) // ← 差異：GMAC 乘的是 u_f，相位變成 φ − φ̂
}
// #endregion

// ───────────────────────── 5. D4：激勵變弱（C → 0） ─────────────────────────

export interface WeakExcitationRow {
  C: number
  /** 固定點偏移 w* − a = B/C [fs per unit code] */
  bias: number
  g: number
  p: number
  /** 時間常數 −1/ln p [blocks] */
  tau: number
  steps5: number
  sigmaW: number
}

// #region core:weakExcitation
/**
 * E[G] ≈ K_q[C·(a − w) + B]：固定點 w* = a + B/C；pole p = 1 − μK_qC；σ_w² = μ²σ_η²/(1 − p²)。
 * C → 0 時三件事一起變差：bias ∝ 1/C、時間常數 ∝ 1/C、σ_w² ≈ μσ_η²/(2K_qC) ∝ 1/C（g ≪ 1）。
 */
export function weakExcitation(p: { C: number; B: number; mu: number; sigmaV: number; N: number }): WeakExcitationRow {
  const n = calNoise({ sigmaV: p.sigmaV, N: p.N, mu: p.mu, C: p.C, fs: 1 })
  return {
    C: p.C,
    bias: p.B / p.C,
    g: n.g,
    p: n.p,
    tau: n.p > 0 && n.p < 1 ? -1 / Math.log(n.p) : Number.NaN,
    steps5: stepsToDecay(Math.abs(n.p)),
    sigmaW: n.sigmaW,
  }
}
// #endregion

// ───────────────────────── 6. D7：eigenvalue 例子（Ch09 / Ch10） ─────────────────────────

export interface EigenExample {
  lmax: number
  lmin: number
  pFast: number
  pSlow: number
  stepsSlow: number
  /** preconditioner M = γ·R⁻¹（K_q 正規化為 1，勘誤 E05/E08）後所有 mode 的 pole */
  pPrecond: number
  stepsPrecond: number
  /** M = γR⁻¹ 的元素 [對角, 非對角] */
  mDiag: number
  mOff: number
}

// #region core:eigenExample
/** R = P_x[[1, ρ], [ρ, 1]]、mean LMS δ_{k+1} = (I − gR)δ_k：沿 eigenvector 的 pole 為 1 − gλ_i。 */
export function eigenExample(rho: number, g: number, gamma: number, Px = 1): EigenExample {
  const { lmax, lmin } = corr2Eigs(Px, rho)
  const pFast = 1 - g * lmax
  const pSlow = 1 - g * lmin
  const det = Px * Px * (1 - rho * rho) // det R
  return {
    lmax,
    lmin,
    pFast,
    pSlow,
    stepsSlow: stepsToDecay(Math.abs(pSlow)),
    pPrecond: 1 - gamma,
    stepsPrecond: stepsToDecay(Math.abs(1 - gamma)),
    mDiag: (gamma * Px) / det,
    mOff: (-gamma * Px * rho) / det,
  }
}
// #endregion

// ───────────────────────── 7. D5 / D6：量化、limit cycle、dither ─────────────────────────

export type Rounding = 'nearest' | 'floor'

// #region core:efStep
/**
 * 一階 error-feedback quantizer 的一步（規格 §13.4；勘誤 E15），全部以「分子 / den」的整數表示：
 *   y[n] = Q(u[n])、殘值 = u[n] − y[n]；沒有 dither 時 u[n] = v[n] = c + r[n−1]，殘值就是 r[n]。
 * 輸入 U = u[n]·den（整數），回傳 [y[n], (u[n] − y[n])·den]；整數運算不會因浮點誤差誤判 tie。
 */
export function efStep(U: number, den: number, rounding: Rounding): [number, number] {
  const y = rounding === 'floor' ? Math.floor(U / den) : Math.floor((2 * U + den) / (2 * den)) // round-half-up：⌊u + ½⌋
  return [y, U - y * den]
}
// #endregion

export interface EfOptions {
  rounding?: Rounding
  /** r[−1]·den（預設 0） */
  r0Num?: number
  /** dither 的分子 ξ[n]·den；長度 L 的週期序列（以 n mod L 取用） */
  ditherNum?: ArrayLike<number>
  /**
   * dither 加在哪裡（兩種常見做法，結果差很多）：
   *   false（預設）：ξ 併入殘值，r[n] = (v[n] + ξ[n]) − y[n] ⇒ y = c + ξ[n] + r[n−1] − r[n]，
   *                  等效於把 ξ 加在調變器輸入：ξ **不被塑形**，它的平均值直接變成輸出的 DC 誤差。
   *   true          ：ξ 只加在量化器輸入，r[n] = v[n] − y[n] 不含 ξ ⇒ y = c + r[n−1] − r[n]，
   *                  ξ 與量化誤差一起被 1 − z⁻¹ 塑形（Ch13 的策略 E：deltaSigmaDitherStep）。
   */
  shaped?: boolean
}

// #region core:efDitherStep
/**
 * 加了 dither 的一步：v[n] = c + r[n−1]、u[n] = v[n] + ξ[n]、y[n] = Q(u[n])。
 * 輸入 V = v[n]·den、xi = ξ[n]·den，回傳 [y[n], r[n]·den]。兩種做法只差「r 裡有沒有 ξ」這一行。
 */
export function efDitherStep(V: number, xi: number, den: number, rounding: Rounding, shaped: boolean): [number, number] {
  const [y, rq] = efStep(V + xi, den, rounding) // rq = (v + ξ − y)·den：量化器自己的捨入誤差
  const r = shaped ? rq - xi : rq // ← 差異：shaped 時 r = v − y（不含 ξ）⇒ ξ 也被 1 − z⁻¹ 塑形；否則 ξ 原封不動出現在輸出
  return [y, r]
}
// #endregion

export function efQuantize(cNum: number, den: number, steps: number, opts: EfOptions = {}): { y: Int32Array; rNum: Int32Array } {
  const { rounding = 'nearest', r0Num = 0, ditherNum, shaped = false } = opts
  const y = new Int32Array(steps)
  const rNum = new Int32Array(steps)
  let R = r0Num
  for (let n = 0; n < steps; n++) {
    const xi = ditherNum ? ditherNum[n % ditherNum.length] : 0
    const [Y, Rn] = efDitherStep(cNum + R, xi, den, rounding, shaped)
    y[n] = Y
    rNum[n] = Rn
    R = Rn
  }
  return { y, rNum }
}

export interface EfCycle {
  /** 進入循環前的 sample 數 */
  transient: number
  period: number
  /** 一個週期的輸出 y */
  cycle: number[]
}

// #region core:finiteStatePeriod
/**
 * 有限狀態 ⇒ 必然最終週期（鴿籠原理）：狀態 = (R, n mod L)，R 只能取有限個整數、相位只有 L 個，
 * 所以一定會重複；第一次重複的位置給出 transient 與週期。輸出 y 由狀態決定，因此 y 也週期性 ⇒ 線譜（spurs）。
 * dither 加在哪裡（opts.shaped）只改變 R 的範圍，不改變「狀態有限」這件事。
 */
export function efCycle(cNum: number, den: number, opts: EfOptions & { maxSteps?: number } = {}): EfCycle {
  const { rounding = 'nearest', r0Num = 0, ditherNum, shaped = false, maxSteps = 1_000_000 } = opts
  const L = ditherNum ? ditherNum.length : 1
  const seen = new Map<string, number>()
  const ys: number[] = []
  let R = r0Num
  for (let n = 0; n < maxSteps; n++) {
    const key = `${R}|${n % L}`
    const first = seen.get(key)
    if (first !== undefined) return { transient: first, period: n - first, cycle: ys.slice(first) }
    seen.set(key, n)
    const xi = ditherNum ? ditherNum[n % L] : 0 // 這一拍的 dither 分子 ξ[n]·den
    const [Y, Rn] = efDitherStep(cNum + R, xi, den, rounding, shaped)
    ys.push(Y)
    R = Rn
  }
  return { transient: Number.NaN, period: Number.NaN, cycle: [] }
}
// #endregion

export interface CycleLines {
  period: number
  /** |E_k|/P，k = 0…P−1（雙邊振幅；k = 0 為 DC 誤差的絕對值） */
  amp: Float64Array
  /** 單邊功率 k = 0…⌊P/2⌋：k = 0（與偶數 P 的 P/2）為 |E_k/P|²，其餘 2|E_k/P|² */
  power: Float64Array
  /** 總誤差功率 mean(e²)（Parseval：= Σ power） */
  totalPower: number
  /** DC 誤差 mean(e) */
  dcError: number
  /** 最大的非 DC 譜線（單邊功率）與其 bin k（頻率 = k/P × 更新率） */
  maxLinePower: number
  maxLineK: number
}

// #region core:cycleLines
/** 週期序列的誤差 e[n] = y[n] − c 只有離散譜線：用一個週期的 DFT 算出每條線的功率。 */
export function cycleLines(cycle: ArrayLike<number>, c: number): CycleLines {
  const P = cycle.length
  const re = new Float64Array(P)
  const im = new Float64Array(P)
  let dc = 0
  let tot = 0
  for (let n = 0; n < P; n++) {
    re[n] = cycle[n] - c
    dc += re[n]
    tot += re[n] * re[n]
  }
  fft(re, im)
  const amp = new Float64Array(P)
  for (let k = 0; k < P; k++) amp[k] = Math.hypot(re[k], im[k]) / P
  const half = Math.floor(P / 2)
  const power = new Float64Array(half + 1)
  let maxLinePower = 0
  let maxLineK = 0
  for (let k = 0; k <= half; k++) {
    const twoSided = k === 0 || (P % 2 === 0 && k === half)
    power[k] = (twoSided ? 1 : 2) * amp[k] * amp[k]
    if (k > 0 && power[k] > maxLinePower) {
      maxLinePower = power[k]
      maxLineK = k
    }
  }
  return { period: P, amp, power, totalPower: tot / P, dcError: dc / P, maxLinePower, maxLineK }
}
// #endregion

// #region core:prbs7
/** PRBS-7（x⁷ + x⁶ + 1，Fibonacci LFSR，週期 127）的 0/1 序列。最大長度序列有 64 個 1、63 個 0。 */
export function prbs7(seed = 0x7f): Uint8Array {
  let s = seed & 0x7f || 1
  const out = new Uint8Array(127)
  for (let n = 0; n < 127; n++) {
    out[n] = (s >> 6) & 1
    const fb = ((s >> 6) ^ (s >> 5)) & 1
    s = ((s << 1) | fb) & 0x7f
  }
  return out
}
// #endregion

/** 把 PRBS 的 0/1 映成 ±(den/2)：也就是 ±½ LSB 的 1-bit dither 分子（den 需為偶數）。兩個準位相差整整 1 LSB。 */
export function prbsHalfLsbDither(bits: ArrayLike<number>, den: number): Int32Array {
  if (den % 2 !== 0) throw new Error('prbsHalfLsbDither：den 必須是偶數（±½ LSB 才能以整數分子表示）')
  const out = new Int32Array(bits.length)
  for (let n = 0; n < bits.length; n++) out[n] = (2 * bits[n] - 1) * (den / 2)
  return out
}

// #region core:prbsWordDither
/**
 * 多位元 PRBS dither：把 LFSR 連續 7 個輸出 bit 當成一個 7-bit 字 s[n] ∈ {1, …, 127}（最大長度序列一個週期內每個值恰好出現一次），
 * 取 ξ[n] = (s[n] − 64)/128 LSB：127 個等距準位、落在 (−½, ½) LSB 內、平均恰為 0（Σs/127 = 64）——寬 1 LSB 的近似 RPDF。
 */
export function prbs7Words(bits: ArrayLike<number> = prbs7()): Uint8Array {
  const L = bits.length
  const out = new Uint8Array(L)
  for (let n = 0; n < L; n++) {
    let s = 0
    for (let j = 0; j < 7; j++) s = (s << 1) | bits[(n + j) % L] // 滑動視窗：下一個字只多出 1 個新 bit
    out[n] = s
  }
  return out
}

/** 7-bit 字 → dither 分子 ξ[n]·den = (s − 64)·den/128（den 需為 128 的倍數）。 */
export function prbsWordDither(words: ArrayLike<number>, den: number): Int32Array {
  if (den % 128 !== 0) throw new Error('prbsWordDither：den 必須是 128 的倍數（1/128 LSB 的準位才能以整數分子表示）')
  const out = new Int32Array(words.length)
  for (let n = 0; n < words.length; n++) out[n] = (words[n] - 64) * (den / 128)
  return out
}
// #endregion

export interface DitherStats {
  mean: number
  power: number
  /** Monte Carlo 標準誤（none 為決定性，SE = 0） */
  seMean: number
  sePower: number
}

export interface DitherCompareResult {
  c: number
  n: number
  seed: number
  none: DitherStats
  nonSubtractive: DitherStats
  subtractive: DitherStats
  analytic: { nonePower: number; nonSubtractivePower: number; subtractivePower: number }
}

export interface DitherPowers {
  /** c 的小數部分 f = c − ⌊c⌋ */
  f: number
  /** 不加 dither 的輸出 Q(c) = ⌊c + ½⌋ */
  q: number
  nonePower: number
  nonSubtractivePower: number
  subtractivePower: number
}

// #region core:ditherCompare
/** 三種做法的誤差功率（解析式，單位 LSB²）。 */
export function ditherErrorPowers(c: number): DitherPowers {
  const q = Math.floor(c + 0.5) // round-half-up
  const f = c - Math.floor(c)
  const e0 = q - c // 不加 dither：誤差恆為 Q(c) − c
  return { f, q, nonePower: e0 * e0, nonSubtractivePower: f * (1 - f), subtractivePower: 1 / 12 }
}

/**
 * 常數目標 c（LSB）經 round-half-up 量化：
 *   none            ：y = Q(c)                ⇒ 誤差恆為 Q(c) − c（全部在 DC）
 *   non-subtractive ：y = Q(c + ξ)            ⇒ 無偏，但誤差功率 f(1 − f)（f = c 的小數部分）
 *   subtractive     ：ŷ = Q(c + ξ) − ξ        ⇒ 誤差 ~ U(−½, ½)、與 c 無關，功率 1/12
 * ξ ~ U(−½, ½)（RPDF，寬 1 LSB）。subtractive 要在下游以比 1 LSB 更細的解析度減回 ξ。
 */
export function ditherCompare({ c, n, seed }: { c: number; n: number; seed: number }): DitherCompareResult {
  const rng = createRng(seed)
  const Q = (v: number) => Math.floor(v + 0.5)
  let sN = 0
  let sN2 = 0
  let sN4 = 0
  let sS = 0
  let sS2 = 0
  let sS4 = 0
  for (let i = 0; i < n; i++) {
    const xi = rng.uniform() - 0.5 // RPDF dither ξ ~ U(−½, ½)
    const y = Q(c + xi) // non-subtractive：直接送出
    const eN = y - c
    const eS = y - xi - c // ← 差異：subtractive 在輸出端減回 ξ
    sN += eN
    sN2 += eN * eN
    sN4 += eN ** 4
    sS += eS
    sS2 += eS * eS
    sS4 += eS ** 4
  }
  const stats = (s1: number, s2: number, s4: number): DitherStats => {
    const mean = s1 / n
    const power = s2 / n
    return {
      mean,
      power,
      seMean: Math.sqrt(Math.max(power - mean * mean, 0) / n),
      sePower: Math.sqrt(Math.max(s4 / n - power * power, 0) / n),
    }
  }
  const e0 = Q(c) - c
  const { nonePower, nonSubtractivePower, subtractivePower } = ditherErrorPowers(c)
  return {
    c,
    n,
    seed,
    none: { mean: e0, power: e0 * e0, seMean: 0, sePower: 0 },
    nonSubtractive: stats(sN, sN2, sN4),
    subtractive: stats(sS, sS2, sS4),
    analytic: { nonePower, nonSubtractivePower, subtractivePower },
  }
}
// #endregion

// ───────────────────────── 8. 手算表：同一個演算法、三種寫法 ─────────────────────────

export interface HandRow {
  n: number
  e: number
  /** ½e² 型（μ） */
  wHalf: number
  /** Widrow 型（μ_W = μ/2） */
  wWidrow: number
  /** NLMS（μ̃ = μx²，ε_reg = 0；固定 x 時與 ½e² 型完全等價） */
  wNlms: number
}

/**
 * 固定 x、無雜訊（規格 §1.2 的手算例）：三種寫法在換算後的步長下走出同一條 w_n。
 * halfStep 由呼叫端傳入 src/simulation/models/lms.ts 的 conventionalStep（Part A 實際使用的程式）。
 */
export function conventionHandTable(
  p: { a: number; w0: number; x: number; mu: number; steps: number },
  halfStep: (s: { w: number; x: number; y: number; mu: number }) => { e: number; w: number },
): HandRow[] {
  const rows: HandRow[] = []
  let wh = p.w0
  let ww = p.w0
  let wn = p.w0
  const y = p.a * p.x
  for (let n = 0; n <= p.steps; n++) {
    const e = y - wh * p.x
    rows.push({ n, e, wHalf: wh, wWidrow: ww, wNlms: wn })
    wh = halfStep({ w: wh, x: p.x, y, mu: p.mu }).w
    ww = widrowStep({ w: ww, x: p.x, y, mu: p.mu / 2 }).w
    wn = nlmsStep({ w: wn, x: p.x, y, mu: p.mu * p.x * p.x, epsReg: 0 }).w
  }
  return rows
}

/**
 * NLMS 的 a posteriori 誤差收縮因子 1 − μ̃‖x‖²/(ε_reg + ‖x‖²)：用更新後的係數重算「同一筆」資料的誤差，
 * e_post = 因子 × e_prior 是代數恆等式（y 裡有沒有雜訊都成立）。|因子| < 1 ⇔ 0 < μ̃ < 2(ε_reg + ‖x‖²)/‖x‖²。
 */
export function nlmsPosteriorFactor(muTilde: number, epsReg: number, xNorm2: number): number {
  return 1 - (muTilde * xNorm2) / (epsReg + xNorm2)
}
