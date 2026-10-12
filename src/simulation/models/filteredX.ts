/**
 * Delay Alignment 與 Filtered-x LMS：regressor 計算、相關性分析與閉迴路比較（規格 §7；模型層級 L2）。Ch07 專用。
 *
 * ── 模型（δ = a − w 極性；n = comparator sample，k = GMAC block）──
 *   PD 誤差   e_PD[n] = (a − w)·u[n] + v[n]，u = h * x
 *             h：DTC 誤差 → PD residual 的**離散時間**誤差路徑，頻率響應 H(e^{jΩ})，Ω 為 rad/sample（勘誤 E44：
 *             不可把 Ω 代入 CT 的 H(jω)）。
 *   GMAC      G_k = (1/N)·Σ_{n∈block k} q[n]·x_ref[n]，w_{k+1} = w_k + μ·G_k（勘誤 E45 的可實作 block 形式）
 *   x_ref 的四種做法（下方 #region core:raw / delayed / filtered / secondDiff，頁面以 CodeCompare 並排）：
 *     raw        x_ref[n] = x[n]
 *     delayed    x_ref[n] = x[n − D]                    （D 級 shift register + MUX）
 *     filtered   x_ref[n] = u_f[n − D]，u_f = ĥ * x     （Ĥ 為 H 的模型；D 補 Ĥ 沒有包含的串聯純延遲；平均相關是 F-07.12 的 C_{f,D}）
 *     secondDiff x_ref[n] = K₂·(x[n] − 2x[n−1] + x[n−2])（Ĥ₂(z) = K₂(1 − z⁻¹)²，K₂ = 1/(ω̂_nT_s)²：Type-II 的低頻近似）
 *
 *   平均相關（決定更新極性與 pole）：
 *     C_ref(D) = E[x_ref[n]·u[n]] = (1/2π)∫_{−π}^{π} S_xx(e^{jΩ})·Re{H(e^{jΩ})·Ĝ*(e^{jΩ})·e^{jΩD}} dΩ
 *     Ĝ = 1（raw、delayed）或 Ĝ = Ĥ（filtered）；平均 pole p = 1 − μK_qC_ref。
 *     Ĝ = Ĥ = H、D = 0 時 C_ref = E[u²] ≥ 0；Ĥ ≠ H 時必須用 E[u·u_f]（E45），不可用 E[u²]。
 *
 * ── 延遲的極性約定（本章重點）──
 *   延遲 GMAC 的 code（本站的 D，blockLms 的 gm_code_delay_samples）：E[x[n−D]·u[n]] ⇒ 殘餘相位 θ = φ + ΩD
 *   延遲 comparator 誤差（另一種硬體做法）：           E[x[n]·u[n−D]] ⇒ 殘餘相位 θ = φ − ΩD（符號相反）
 *
 * ── Code 正規化 ── 為了讓解析值與模擬可直接比對，本檔固定 E[x²] = 1：
 *   sinusoid：x = √2·cos(Ωn)（A²/2 = 1）；ar1：Gaussian AR(1)，σ_x = 1；white_pm_one：±1；
 *   mash111：DSM residue 以 'standardize' 正規化（零均值、單位變異），無封閉式 PSD（解析值為 null）。
 *   dsm1：一階 DSM（phase accumulator）的 residue——基頻 frac·f_s 的 sawtooth，同樣 'standardize'、解析值為 null。
 *
 * 純數值、無 React/DOM。worker 可呼叫：analyzeFxLab、runFxComparison（參數與結果皆可 structured clone）。
 */

import { cAbs, cArg, cConj, cExpj, cMul, wrap180, type Complex } from '@/simulation/core'
import { fft, freqz, ifft, impulseResponse, lfilter, nextPow2, StreamFilter, xcorr } from '@/simulation/signal'
import { designDtLoop, errorPathTransfer, polarityMarginDeg, singleToneFir, type DtTransfer } from '@/simulation/models/pll'
import { generateCodePattern, runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'

// ───────────────────────────────────────────────────────────────────────────
// 型別
// ───────────────────────────────────────────────────────────────────────────

export type RegressorMode = 'raw' | 'delayed' | 'filtered'
export type HatBase = 'same' | 'second_diff'
export type DelayConvention = 'code' | 'error'

/** DTC → PD 的誤差路徑（場景）。Ω、ω_nT_s 皆為 rad/sample。 */
export type FxPathSpec =
  | { kind: 'identity' }
  /** 2-tap FIR，在 omega 處精確給出 |H|e^{jφ}（pll.singleToneFir） */
  | { kind: 'single_tone'; magnitude: number; phaseDeg: number; omega: number }
  /** E44 的 DT Type-II DPLL：H_PD = 1/(1 + L(z))，loopDelay = 額外 loop latency d [samples] */
  | { kind: 'type2_dt'; wnTs: number; zeta: number; loopDelay: number }

/** GMAC 使用的 code（皆正規化成 E[x²] = 1，見檔頭）。 */
export type FxCodeSpec =
  | { kind: 'sinusoid'; omega: number }
  | { kind: 'ar1'; rho: number }
  | { kind: 'white_pm_one' }
  | { kind: 'mash111'; frac: number }
  /** 一階 DSM（phase accumulator）的 DTC phase residue：基頻 Ω = 2π·frac 的 sawtooth（near-integer FCW ⇒ 很慢的 code） */
  | { kind: 'dsm1'; frac: number }

/** Filtered-x 的模型 Ĥ：Ĥ = (1 + gainErrPct/100)·M(z)·R_Δφ(z)·z^{−extraDelay}。 */
export interface FxHatSpec {
  /** 'same'：與真實路徑同結構（可含參數誤差）；'second_diff'：K₂(1 − z⁻¹)²，K₂ = 1/(ω̂_nT_s)²（type2）或 1 */
  base: HatBase
  /** type2：ω̂_nT_s = ω_nT_s·(1 + bwErrPct/100)（頻寬誤差） */
  bwErrPct: number
  /** type2：模型的 loop latency d̂ = d + loopDelayErr（必須 ≥ 0） */
  loopDelayErr: number
  /** Ĥ 額外延遲 Δ ≥ 0 samples（多算的 latency） */
  extraDelay: number
  /** 只在 sinusoid code 時有效：在 code 頻率處額外旋轉 Δφ [deg]（2-tap FIR 旋轉器 R(z)） */
  phaseErrDeg: number
  /** 增益誤差 [%]（只改變 |Ĥ|，不改變極性） */
  gainErrPct: number
}

export const HAT_EXACT: FxHatSpec = { base: 'same', bwErrPct: 0, loopDelayErr: 0, extraDelay: 0, phaseErrDeg: 0, gainErrPct: 0 }

/** 一個 regressor 設定（Case A/B/C 各一組）。 */
export interface FxCaseSpec {
  mode: RegressorMode
  /** GMAC code 延遲 D [samples]（raw 模式忽略） */
  D: number
  /** gain_step μ [fs]（average 模式） */
  mu: number
  hat: FxHatSpec
}

/** 閉迴路場景（Case 之間共用 → paired simulation）。 */
export interface FxScenario {
  path: FxPathSpec
  code: FxCodeSpec
  /** 真實 gain a [fs per unit code] */
  a: number
  /** 初值 w_0 [fs per unit code] */
  w0: number
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** GMAC 累加長度 N */
  N: number
  /** block 數 */
  blocks: number
  seed: number
}

// ───────────────────────────────────────────────────────────────────────────
// 1. 四種 regressor（頁面以 CodeCompare 並排顯示；差異行以「← 差異」標記）
// ───────────────────────────────────────────────────────────────────────────

// #region core:raw
/** raw-x：GMAC 直接使用原始 code。硬體成本為零，但隱含假設 H = 1（沒有相位）。 */
export function regressorRaw(x: ArrayLike<number>): Float64Array {
  const xr = new Float64Array(x.length)
  for (let n = 0; n < x.length; n++) {
    xr[n] = x[n] // ← 差異：直接用 x[n]，誤差路徑的相位 φ 完全沒有補償
  }
  return xr
}
// #endregion

// #region core:delayed
/** delayed-x：GMAC 使用 D 個 sample 以前的 code（硬體：D 級 shift register + D 選 1 MUX）。 */
export function regressorDelayed(x: ArrayLike<number>, D: number): Float64Array {
  const xr = new Float64Array(x.length)
  for (let n = 0; n < x.length; n++) {
    xr[n] = n >= D ? x[n - D] : 0 // ← 差異：讀 shift register 第 D 級；只能補一個線性相位 ΩD
  }
  return xr
}
// #endregion

// #region core:filtered
/** filtered-x：code 先經過誤差路徑模型 Ĥ（狀態跨 block 保留），再延遲 D。 */
export function regressorFiltered(x: ArrayLike<number>, hHat: DtTransfer, D = 0): Float64Array {
  const model = new StreamFilter(hHat.b, hHat.a) // Ĥ(z) = B̂(z⁻¹)/Â(z⁻¹)，不在 block 邊界重置
  const uf = new Float64Array(x.length)
  const xr = new Float64Array(x.length)
  for (let n = 0; n < x.length; n++) {
    uf[n] = model.step(x[n]) // ← 差異：u_f = ĥ * x，複製誤差路徑在每個頻率的振幅與相位
    xr[n] = n >= D ? uf[n - D] : 0
  }
  return xr
}
// #endregion

// #region core:secondDiff
/** Type-II 的便宜 Ĥ：二次差分 K₂·(1 − z⁻¹)²（K₂ = scale），只要兩個暫存器與兩個加法器（×2 是左移一位）。 */
export function regressorSecondDiff(x: ArrayLike<number>, scale: number): Float64Array {
  const xr = new Float64Array(x.length)
  let x1 = 0 // x[n − 1]
  let x2 = 0 // x[n − 2]
  for (let n = 0; n < x.length; n++) {
    xr[n] = scale * (x[n] - 2 * x1 + x2) // ← 差異：Ĥ₂ = K₂(1 − z⁻¹)²，只複製 H_PD 的低頻漸近線 −(Ω/ω_nT_s)²（K₂ = scale）
    x2 = x1
    x1 = x[n]
  }
  return xr
}
// #endregion

// #region core:gmac
/** 一個 GMAC block（E45 的可實作形式）：G_k = (1/N)Σ q[n]·x_ref[n]，w_{k+1} = w_k + μ·G_k。 */
export function gmacUpdate(w: number, q: ArrayLike<number>, xRef: ArrayLike<number>, mu: number): { G: number; w: number } {
  let acc = 0
  for (let n = 0; n < q.length; n++) acc += q[n] * xRef[n] // q = ±1：硬體為「條件取負 + 累加」
  const G = acc / q.length // average 模式（sum 模式時有效增益 ×N）
  return { G, w: w + mu * G }
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 2. 單頻解析式（§7 boxed；E46 邊界）
// ───────────────────────────────────────────────────────────────────────────

export interface ToneInput {
  /** code 振幅 A */
  A: number
  /** |H(e^{jΩ})| */
  mag: number
  /** φ = ∠H(e^{jΩ}) [rad] */
  phiRad: number
  /** Ω [rad/sample] */
  omega: number
}

// #region core:toneCorrAtTheta
/**
 * 單頻相關在殘餘相位 θ 的值：
 *   0 < Ω < π：(A²/2)|H|cos θ                          [精確｜單頻、長時間或整數週期平均]
 *   Ω = 0 或 π：A²|H|cos φ·cos(θ − φ)（2 倍；實係數 h 只允許 φ ∈ {0, π}；E46）
 */
export function toneCorrAtTheta(p: ToneInput, theta: number): number {
  const { A, mag, phiRad, omega } = p
  if (Math.abs(Math.sin(omega)) < 1e-12) return A * A * mag * Math.cos(phiRad) * Math.cos(theta - phiRad)
  return 0.5 * A * A * mag * Math.cos(theta)
}
// #endregion

// #region core:toneCorrCode
/** 延遲 GMAC code：C_D = E[x[n − D]·u[n]] = (A²/2)|H|cos(φ + ΩD)。 */
export function toneCorrCodeDelay(p: ToneInput, D: number): number {
  const theta = p.phiRad + p.omega * D // ← 差異：延遲 code ⇒ 殘餘相位 θ = φ + ΩD
  return toneCorrAtTheta(p, theta)
}
// #endregion

// #region core:toneCorrError
/** 延遲 comparator 誤差：C'_D = E[x[n]·u[n − D]] = (A²/2)|H|cos(φ − ΩD)。 */
export function toneCorrErrorDelay(p: ToneInput, D: number): number {
  const theta = p.phiRad - p.omega * D // ← 差異：延遲 error ⇒ 殘餘相位 θ = φ − ΩD（符號相反）
  return toneCorrAtTheta(p, theta)
}
// #endregion

/** 殘餘相位 θ [deg]（wrap 到 (−180°, 180°]）。 */
export function residualPhaseDeg(phiRad: number, omega: number, D: number, convention: DelayConvention = 'code'): number {
  const theta = convention === 'code' ? phiRad + omega * D : phiRad - omega * D
  return wrap180((theta * 180) / Math.PI)
}

/**
 * 選出使單頻相關最大的整數 D，並回傳連續解 D* = ((∓φ) mod 2π)/Ω。
 * 只在**第一個週期** D = 0 … min(Dmax, ⌈2π/Ω⌉) 內搜尋：相位以 2π 為週期，之後的 D + k·2π/Ω 只是更深的
 * shift register（硬體更貴），而非整數週期時「下一圈」的 cos 可能碰巧略大，會誤選成很大的 D。
 */
export function bestToneDelay(
  phiRad: number,
  omega: number,
  Dmax: number,
  convention: DelayConvention = 'code',
): { D: number; thetaDeg: number; cosTheta: number; continuous: number } {
  if (!(omega > 0 && omega < Math.PI)) throw new Error(`bestToneDelay 需要 0 < Ω < π，收到 ${omega}`)
  const Dlim = Math.min(Math.floor(Dmax), Math.ceil((2 * Math.PI) / omega))
  let best = 0
  let bestCos = -Infinity
  for (let D = 0; D <= Dlim; D++) {
    const th = convention === 'code' ? phiRad + omega * D : phiRad - omega * D
    const c = Math.cos(th)
    if (c > bestCos + 1e-15) {
      bestCos = c
      best = D
    }
  }
  const target = convention === 'code' ? -phiRad : phiRad
  const twoPi = 2 * Math.PI
  const continuous = (((target % twoPi) + twoPi) % twoPi) / omega
  return { D: best, thetaDeg: residualPhaseDeg(phiRad, omega, best, convention), cosTheta: bestCos, continuous }
}

/**
 * 有限 N 的單一 block 確切值（E46）：n = n0 … n0+N−1 的平均
 *   (A²|H|/2)[cos(φ+ΩD) + cos(2Ωn0 + Ω(N−1) + φ − ΩD)·sin(NΩ)/(N sinΩ)]
 * ripple 上界 (A²|H|/2)·min(1, 1/(N|sinΩ|))。只適用 0 < Ω < π。
 */
export function toneBlockCorr(p: ToneInput & { D: number; N: number; n0: number }): {
  exact: number
  longRun: number
  rippleBound: number
} {
  const { A, mag, phiRad, omega, D, N, n0 } = p
  const s = Math.sin(omega)
  if (Math.abs(s) < 1e-12) throw new Error('toneBlockCorr 只適用 0 < Ω < π（Ω = 0、π 見 E46 的 2 倍公式）')
  const amp = 0.5 * A * A * mag
  const longRun = amp * Math.cos(phiRad + omega * D)
  const dirichlet = Math.sin(N * omega) / (N * s)
  const exact = longRun + amp * Math.cos(2 * omega * n0 + omega * (N - 1) + phiRad - omega * D) * dirichlet
  return { exact, longRun, rippleBound: amp * Math.min(1, 1 / (N * Math.abs(s))) }
}

/**
 * 多頻 code x = Σ A_i cos(Ω_i n + θ_i)（頻率互異、皆在 (0, π)）：交叉項平均為零，
 *   C_D = Σ_i (A_i²/2)·Re{H(e^{jΩ_i}) e^{±jΩ_i D}}（+：延遲 code；−：延遲 error）。
 */
export function multiToneCorr(p: {
  tones: { A: number; omega: number }[]
  h: DtTransfer
  D: number
  convention?: DelayConvention
}): { total: number; parts: number[]; phasesDeg: number[]; mags: number[] } {
  const sign = (p.convention ?? 'code') === 'code' ? 1 : -1
  const H = freqz(p.h.b, p.h.a, p.tones.map((t) => t.omega))
  const parts = p.tones.map((t, i) => toneCorrAtTheta({ A: t.A, mag: cAbs(H[i]), phiRad: cArg(H[i]), omega: t.omega }, cArg(H[i]) + sign * t.omega * p.D))
  return {
    total: parts.reduce((s, v) => s + v, 0),
    parts,
    phasesDeg: H.map((z) => (cArg(z) * 180) / Math.PI),
    mags: H.map((z) => cAbs(z)),
  }
}

/** 多頻 code 經 filtered-x（Ĥ）後的相關：Σ_i (A_i²/2)·Re{H_i·Ĥ_i*·e^{jΩ_i D}}。 */
export function multiToneCorrFiltered(p: { tones: { A: number; omega: number }[]; h: DtTransfer; hHat: DtTransfer; D?: number }): number {
  const om = p.tones.map((t) => t.omega)
  const H = freqz(p.h.b, p.h.a, om)
  const Hh = freqz(p.hHat.b, p.hHat.a, om)
  const D = p.D ?? 0
  let s = 0
  p.tones.forEach((t, i) => {
    const z = cMul(cMul(H[i], cConj(Hh[i])), cExpj(t.omega * D))
    s += Math.abs(Math.sin(t.omega)) < 1e-12 ? t.A * t.A * z.re : 0.5 * t.A * t.A * z.re
  })
  return s
}

// ───────────────────────────────────────────────────────────────────────────
// 2b. 平均 pole、正規化相關與延遲的頻率容忍度（純公式；Ch07「帶入手算」題與頁面共用）
// ───────────────────────────────────────────────────────────────────────────

// #region core:calPole
/** 1-bit comparator 的小訊號增益 K_q = √(2/π)/σ_v [fs⁻¹]（Ch05；與 runBlockLms 的 analytic.Kq 相同）。 */
export function kqFromSigma(sigmaV: number): number {
  return Math.sqrt(2 / Math.PI) / sigmaV
}

/**
 * 平均更新的 loop gain 與 pole：g = μK_qC、p = 1 − g（F-07.2／F-07.11）。       [近似｜|δu| ≪ σ_v、長時間平均]
 * C 是 GMAC regressor 與 u 的相關：C_D（raw／delayed）或 E[u·u_f]（filtered；Ĥ ≠ H 時不可改用 E[u²]，E45）。
 */
export function calPole(mu: number, sigmaV: number, C: number): { Kq: number; g: number; p: number } {
  const Kq = kqFromSigma(sigmaV)
  const g = mu * Kq * C // 每個 block 修正掉的誤差比例
  return { Kq, g, p: 1 - g }
}

/** 平均誤差的時間常數 τ = −1/ln|p| [blocks]：|p| ≥ 1（不收斂）回傳 Infinity；p = 0（一步到位）回傳 0。 */
export function calTimeConstant(p: number): number {
  const a = Math.abs(p)
  if (a === 0) return 0
  if (!(a < 1)) return Infinity
  return -1 / Math.log(a)
}
// #endregion

// #region core:normalizedCorr
/** 正規化相關 ρ_ref = C/√(E[x_ref²]·E[u²]) ∈ [−1, 1]（F-07.13；Cauchy–Schwarz）。符號就是更新極性。 */
export function normalizedCorr(C: number, ExRef2: number, Eu2: number): number {
  return C / Math.sqrt(ExRef2 * Eu2)
}

/** 同樣的 g、同樣的 σ_w 下 GMAC 的 N 要放大的倍數：σ_w ∝ 1/(√N·|ρ|) ⇒ N ∝ 1/ρ²（7.4 節）。 [近似] */
export function averagingPenalty(rho: number): number {
  return 1 / (rho * rho)
}
// #endregion

// #region core:delayTolerance
/**
 * 在 Ω₀ 對齊（φ + Ω₀D = 0）之後、把 φ 在附近視為常數時，還能保持 C_D > 0 的頻偏上限 [rad/sample]：
 *   θ(Ω) = (Ω − Ω₀)·D，|θ| < π/2 ⇔ |Ω − Ω₀| < π/(2D)（7.3 節；D 越大容許的頻寬越窄）。
 */
export function delayToleranceRad(D: number): number {
  return Math.PI / (2 * D)
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 3. Ĥ 的建立（含模型誤差）與 Type-II 低頻近似
// ───────────────────────────────────────────────────────────────────────────

/** 二次差分 Ĥ₂(z) = K₂(1 − z⁻¹)²（K₂ = scale；z⁻¹ 升冪）。 */
export function secondDiffTransfer(scale: number): DtTransfer {
  return { b: [scale, -2 * scale, scale], a: [1] }
}

/** Ĥ₂(e^{jΩ}) 的封閉式：(1 − e^{−jΩ})² = −4 sin²(Ω/2)·e^{−jΩ}，0 < Ω < π 時相位 = π − Ω。 */
export function secondDiffResponse(omega: number, scale = 1): Complex {
  const m = -4 * Math.sin(omega / 2) ** 2 * scale
  return { re: m * Math.cos(omega), im: -m * Math.sin(omega) }
}

/** 真實誤差路徑 → DT 轉移函數（pll.errorPathTransfer 的薄包裝）。 */
export function pathTransfer(path: FxPathSpec): DtTransfer {
  switch (path.kind) {
    case 'identity':
      return { b: [1], a: [1] }
    case 'single_tone': {
      const tf = errorPathTransfer({ kind: 'single_tone', parameters: { magnitude: path.magnitude, phase_deg: path.phaseDeg, omega: path.omega } })
      return { b: tf.b, a: tf.a }
    }
    case 'type2_dt': {
      const des = designDtLoop({ wnTs: path.wnTs, zeta: path.zeta, loopDelay: path.loopDelay })
      return { b: des.Hpd.b, a: des.Hpd.a }
    }
  }
}

/** 與 blockLms 相容的 pll_error_path JSON。 */
export function pathConfig(path: FxPathSpec): NonNullable<BlockLmsConfigInput['pll_error_path']> {
  switch (path.kind) {
    case 'identity':
      return { kind: 'identity', parameters: {} }
    case 'single_tone':
      return { kind: 'single_tone', parameters: { magnitude: path.magnitude, phase_deg: path.phaseDeg, omega: path.omega } }
    case 'type2_dt':
      return { kind: 'type2_dt', parameters: { wn_ts: path.wnTs, zeta: path.zeta, loop_delay: path.loopDelay, method: 'dpll' } }
  }
}

/**
 * 真實誤差路徑是否穩定：type2_dt 看主 PLL 的 closed-loop pole 半徑（designDtLoop）；FIR 與 identity 恆穩定。
 * 主迴路不穩定時 u = h * x 會發散，任何相關 C 都沒有定義。
 */
export function pathStability(path: FxPathSpec): { stable: boolean; radius: number } {
  if (path.kind !== 'type2_dt') return { stable: true, radius: 0 }
  const des = designDtLoop({ wnTs: path.wnTs, zeta: path.zeta, loopDelay: path.loopDelay })
  return { stable: des.stable, radius: des.spectralRadius }
}

/** 主迴路不穩定時丟出「解釋原因」的錯誤（Lab 會把訊息原文顯示成警告）。 */
function assertStablePath(path: FxPathSpec): void {
  const st = pathStability(path)
  if (!st.stable && path.kind === 'type2_dt') {
    throw new Error(
      `主 PLL 迴路不穩定（ω_nT_s = ${path.wnTs.toPrecision(4)}、ζ = ${path.zeta}、loop latency d = ${path.loopDelay}：closed-loop pole 半徑 ${st.radius.toFixed(4)} ≥ 1）——` +
        'H_PD 的輸出 u = h * x 會發散，相關 C 沒有定義。請降低 ω_nT_s 或 loop latency',
    )
  }
}

function conv(p: number[], q: number[]): number[] {
  const out = new Array<number>(p.length + q.length - 1).fill(0)
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) out[i + j] += p[i] * q[j]
  return out
}

function isExactHat(h: FxHatSpec): boolean {
  return h.base === 'same' && h.bwErrPct === 0 && h.loopDelayErr === 0 && h.extraDelay === 0 && h.phaseErrDeg === 0 && h.gainErrPct === 0
}

export interface BuiltHat {
  /** 不含增益與額外延遲的核心 M(z)·R(z)（傳給 blockLms 的 iir path） */
  core: DtTransfer
  /** (1 + gainErr) */
  gain: number
  /** Δ（傳給 blockLms 的 extra_delay_samples） */
  extraDelay: number
  /** 完整 Ĥ = gain·core·z^{−Δ} */
  full: DtTransfer
  /** 二次差分的增益 K₂（base = second_diff 時） */
  secondDiffScale: number | null
  /** Ĥ 與真實 H 完全相同 */
  exact: boolean
  /** Ĥ 本身是否穩定（type2 模型的 closed-loop pole 都在單位圓內；FIR 恆為 true） */
  stable: boolean
  description: string
  warnings: string[]
}

/**
 * 建立 filtered-x 的模型 Ĥ = (1 + ε_g)·M(z)·R_Δφ(z)·z^{−Δ}（見 FxHatSpec）。
 * M：'same' 時為同結構（type2 可帶頻寬誤差與 latency 誤差）；'second_diff' 時為 K₂(1 − z⁻¹)²。
 * R_Δφ：只在 sinusoid code 時加入，於 code 頻率精確旋轉 Δφ、|R| = 1（其他頻率不保證）。
 */
export function buildHat(path: FxPathSpec, hat: FxHatSpec, code: FxCodeSpec): BuiltHat {
  const warnings: string[] = []
  const parts: string[] = []
  let base: DtTransfer
  let secondDiffScale: number | null = null
  let stable = true
  if (!Number.isInteger(hat.extraDelay) || hat.extraDelay < 0) throw new Error(`extraDelay 必須為非負整數，收到 ${hat.extraDelay}`)
  if (hat.base === 'second_diff') {
    const wnHat = path.kind === 'type2_dt' ? path.wnTs * (1 + hat.bwErrPct / 100) : 1
    if (!(wnHat > 0)) throw new Error(`ω̂_nT_s = ${wnHat} 必須 > 0（頻寬誤差不可 ≤ −100%）`)
    secondDiffScale = path.kind === 'type2_dt' ? 1 / (wnHat * wnHat) : 1
    base = secondDiffTransfer(secondDiffScale)
    parts.push(path.kind === 'type2_dt' ? `(1 − z⁻¹)²/(ω̂_nT_s)²，ω̂_nT_s = ${wnHat.toPrecision(4)}` : '(1 − z⁻¹)²')
    if (path.kind !== 'type2_dt') warnings.push('二次差分 Ĥ₂ 是 Type-II 主 PLL 的低頻近似；目前的誤差路徑不是 type2_dt，Ĥ₂ 與 H 沒有對應關係')
  } else {
    switch (path.kind) {
      case 'identity':
        base = { b: [1], a: [1] }
        parts.push('Ĥ = 1')
        break
      case 'single_tone':
        base = pathTransfer(path)
        parts.push('與真實 2-tap FIR 相同')
        break
      case 'type2_dt': {
        const wnHat = path.wnTs * (1 + hat.bwErrPct / 100)
        if (!(wnHat > 0)) throw new Error(`ω̂_nT_s = ${wnHat} 必須 > 0（頻寬誤差不可 ≤ −100%）`)
        const dHat = path.loopDelay + hat.loopDelayErr
        if (!Number.isInteger(dHat) || dHat < 0) throw new Error(`模型 loop latency d̂ = d + Δd = ${dHat} 必須為非負整數`)
        const des = designDtLoop({ wnTs: wnHat, zeta: path.zeta, loopDelay: dHat })
        if (!des.stable) {
          stable = false
          warnings.push(`Ĥ 的模型迴路不穩定（ω̂_nT_s = ${wnHat.toPrecision(4)}、d̂ = ${dHat}，pole 半徑 ${des.spectralRadius.toFixed(4)} ≥ 1）：u_f 會發散`)
        }
        base = { b: des.Hpd.b, a: des.Hpd.a }
        parts.push(`type-II DPLL 模型（ω̂_nT_s = ${wnHat.toPrecision(4)}、d̂ = ${dHat}）`)
        break
      }
    }
  }
  let core = base
  if (hat.phaseErrDeg !== 0) {
    if (code.kind === 'sinusoid') {
      const r = singleToneFir(1, (hat.phaseErrDeg * Math.PI) / 180, code.omega)
      core = { b: conv(base.b, r), a: base.a.slice() }
      parts.push(`× R(z)：在 Ω = ${code.omega.toPrecision(4)} 旋轉 ${hat.phaseErrDeg}°`)
    } else {
      warnings.push('相位誤差 Δφ 只對單頻（sinusoid）code 定義；寬頻 code 請改用 latency 誤差（Δ 或 Δd）')
    }
  }
  const gain = 1 + hat.gainErrPct / 100
  if (gain <= 0) warnings.push(`|Ĥ| 的增益 ${gain} ≤ 0：等同把 Ĥ 反相（極性必錯）`)
  if (gain !== 1) parts.push(`增益 ×${gain.toPrecision(4)}`)
  if (hat.extraDelay > 0) parts.push(`× z^−${hat.extraDelay}`)
  const full: DtTransfer = {
    b: new Array<number>(hat.extraDelay).fill(0).concat(core.b.map((v) => v * gain)),
    a: core.a.slice(),
  }
  return {
    core,
    gain,
    extraDelay: hat.extraDelay,
    full,
    secondDiffScale,
    exact: isExactHat(hat),
    stable,
    description: parts.join('、'),
    warnings,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 4. 一般 code 的解析相關（封閉式；與 pll.corrFromPsd 交叉驗證）
// ───────────────────────────────────────────────────────────────────────────

/** 截斷的脈衝響應（IIR 時延長到尾端能量 < tol²·總能量；上限 maxLen）。 */
export function truncatedImpulse(tf: DtTransfer, tol = 1e-13, maxLen = 1 << 15): Float64Array {
  if (tf.a.length === 1) return Float64Array.from(tf.b, (v) => v / tf.a[0])
  let len = 1024
  for (;;) {
    const h = impulseResponse(tf.b, tf.a, len)
    let tot = 0
    let tail = 0
    const cut = Math.floor(len * 0.75)
    for (let i = 0; i < len; i++) {
      const e = h[i] * h[i]
      tot += e
      if (i >= cut) tail += e
    }
    if (tail <= tol * tol * Math.max(tot, 1e-300) || len >= maxLen) return h
    len *= 2
  }
}

/**
 * 脈衝響應互相關 r[m] = Σ_l h[l + m]·g[l]，m = −(Lg−1) … (Lh−1)（FFT 計算）。
 * 回傳 { r, offset }：r[m + offset]。
 */
export function impulseCrossCorr(h: ArrayLike<number>, g: ArrayLike<number>): { r: Float64Array; offset: number } {
  const Lh = h.length
  const Lg = g.length
  const nfft = nextPow2(Lh + Lg - 1)
  const hr = new Float64Array(nfft)
  const hi = new Float64Array(nfft)
  const gr = new Float64Array(nfft)
  const gi = new Float64Array(nfft)
  for (let i = 0; i < Lh; i++) hr[i] = h[i]
  for (let i = 0; i < Lg; i++) gr[i] = g[i]
  fft(hr, hi)
  fft(gr, gi)
  // H·conj(G)
  for (let k = 0; k < nfft; k++) {
    const re = hr[k] * gr[k] + hi[k] * gi[k]
    const im = hi[k] * gr[k] - hr[k] * gi[k]
    hr[k] = re
    hi[k] = im
  }
  ifft(hr, hi)
  const offset = Lg - 1
  const r = new Float64Array(Lh + Lg - 1)
  for (let m = -(Lg - 1); m <= Lh - 1; m++) r[m + offset] = hr[(m + nfft) % nfft]
  return { r, offset }
}

/** code 的自相關 R_x[m]（E[x²] = 1）；DSM code（mash111、dsm1）不提供封閉式 → null。 */
export function codeAutocorr(code: FxCodeSpec): ((m: number) => number) | null {
  switch (code.kind) {
    case 'sinusoid':
      return (m) => Math.cos(code.omega * m) // x = √2 cos(Ωn) ⇒ R[m] = cos(Ωm)
    case 'ar1':
      return (m) => Math.pow(code.rho, Math.abs(m))
    case 'white_pm_one':
      return (m) => (m === 0 ? 1 : 0)
    case 'mash111':
    case 'dsm1':
      return null
  }
}

/** code 的 DTFT PSD S_xx(e^{jΩ})（σ_x² = (1/2π)∫S dΩ = 1）；sinusoid 為譜線、DSM code 無封閉式 → null。 */
export function codePsd(code: FxCodeSpec, omega: number): number | null {
  switch (code.kind) {
    case 'ar1':
      return (1 - code.rho * code.rho) / (1 - 2 * code.rho * Math.cos(omega) + code.rho * code.rho)
    case 'white_pm_one':
      return 1
    default:
      return null
  }
}

/**
 * 解析 C_ref(D) = E[(g * x)[n − D]·(h * x)[n]] = Σ_m r_hg[m]·R_x[m − D]（g = null 表示 Ĝ = 1）。
 * sinusoid 用頻率響應的確切式 Re{H·G*·e^{jΩD}}（A²/2 = 1）；DSM code（mash111、dsm1）回傳 null。
 * 一次計算多個 D（sweep 用）。
 */
export function analyticCorrSweep(p: { code: FxCodeSpec; h: DtTransfer; g: DtTransfer | null; Ds: ArrayLike<number> }): Float64Array | null {
  const { code, h, g, Ds } = p
  const out = new Float64Array(Ds.length)
  if (code.kind === 'sinusoid') {
    const Hz = freqz(h.b, h.a, [code.omega])[0]
    const Gz = g ? freqz(g.b, g.a, [code.omega])[0] : { re: 1, im: 0 }
    const hg = cMul(Hz, cConj(Gz))
    for (let i = 0; i < Ds.length; i++) {
      const z = cMul(hg, cExpj(code.omega * Ds[i]))
      out[i] = Math.abs(Math.sin(code.omega)) < 1e-12 ? 2 * z.re : z.re
    }
    return out
  }
  if (code.kind === 'mash111' || code.kind === 'dsm1') return null
  const hi = truncatedImpulse(h)
  const gi = g ? truncatedImpulse(g) : Float64Array.of(1)
  const { r, offset } = impulseCrossCorr(hi, gi)
  if (code.kind === 'white_pm_one') {
    // R_x[m] = δ[m] ⇒ C(D) = r_hg[D]
    for (let i = 0; i < Ds.length; i++) {
      const idx = Ds[i] + offset
      out[i] = idx >= 0 && idx < r.length ? r[idx] : 0
    }
    return out
  }
  // AR(1)：R_x[m] = ρ^{|m|}。C(D) = F(D) + B(D)，
  //   F(D) = Σ_{m≤D} r[m]ρ^{D−m} = ρF(D−1) + r[D]，  B(D) = Σ_{m>D} r[m]ρ^{m−D} = ρ(B(D+1) + r[D+1])
  // 兩個遞迴都只乘 ρ（|ρ| < 1，數值穩定），整條 sweep 的成本 O(len(r) + D 範圍)，與 Σ_m r[m]R_x[m−D] 的直接和相同。
  const rho = code.rho
  let dMin = Infinity
  let dMax = -Infinity
  for (let i = 0; i < Ds.length; i++) {
    dMin = Math.min(dMin, Ds[i])
    dMax = Math.max(dMax, Ds[i])
  }
  const lo = Math.min(-offset, dMin)
  const hiIdx = Math.max(r.length - 1 - offset, dMax)
  const span = hiIdx - lo + 1
  const rAt = (m: number): number => {
    const k = m + offset
    return k >= 0 && k < r.length ? r[k] : 0
  }
  const F = new Float64Array(span)
  const B = new Float64Array(span)
  let f = 0
  for (let m = lo; m <= hiIdx; m++) {
    f = rho * f + rAt(m)
    F[m - lo] = f
  }
  let b = 0
  for (let m = hiIdx; m >= lo; m--) {
    B[m - lo] = b
    b = rho * (b + rAt(m))
  }
  for (let i = 0; i < Ds.length; i++) out[i] = F[Ds[i] - lo] + B[Ds[i] - lo]
  return out
}

/** 直接和 Σ_m r_hg[m]·R_x[m − D]（O(len·|D|)；只給測試交叉驗證遞迴版 analyticCorrSweep 用） */
export function analyticCorrDirect(p: { code: FxCodeSpec; h: DtTransfer; g: DtTransfer | null; D: number }): number | null {
  const R = codeAutocorr(p.code)
  if (!R || p.code.kind === 'sinusoid') return analyticCorr(p)
  const { r, offset } = impulseCrossCorr(truncatedImpulse(p.h), p.g ? truncatedImpulse(p.g) : Float64Array.of(1))
  let s = 0
  for (let m = -offset; m < r.length - offset; m++) s += r[m + offset] * R(m - p.D)
  return s
}

/** 單一 D 的解析 C_ref（見 analyticCorrSweep）。 */
export function analyticCorr(p: { code: FxCodeSpec; h: DtTransfer; g: DtTransfer | null; D: number }): number | null {
  const r = analyticCorrSweep({ ...p, Ds: [p.D] })
  return r ? r[0] : null
}

// ───────────────────────────────────────────────────────────────────────────
// 5. 逐頻率的相位誤差（E45 判據）
// ───────────────────────────────────────────────────────────────────────────

export interface PhaseProfile {
  omega: Float64Array
  magH: Float64Array
  phaseHDeg: Float64Array
  magRef: Float64Array
  phaseRefDeg: Float64Array
  /** 殘餘相位 θ(Ω) = ∠H − ∠Ĝ + ΩD（wrap 到 (−180°, 180°]） */
  thetaDeg: Float64Array
  /** Re{H·Ĝ*·e^{jΩD}}（被積函數不含 S_xx 的部分） */
  reCross: Float64Array
}

/**
 * 在 Ω 格點上計算 θ(Ω) = ∠H(e^{jΩ}) − ∠Ĝ(e^{jΩ}) + ΩD 與 Re{H·Ĝ*·e^{jΩD}}（Ĝ = 1 表示 raw / delayed）。
 * |θ(Ω)| < 90° 的頻率對 C_ref 貢獻為正（E45 的逐頻率條件）。
 */
export function phaseProfile(p: { h: DtTransfer; g: DtTransfer | null; D: number; omega: ArrayLike<number> }): PhaseProfile {
  const n = p.omega.length
  const H = freqz(p.h.b, p.h.a, p.omega)
  const G = p.g ? freqz(p.g.b, p.g.a, p.omega) : null
  const out: PhaseProfile = {
    omega: Float64Array.from(p.omega),
    magH: new Float64Array(n),
    phaseHDeg: new Float64Array(n),
    magRef: new Float64Array(n),
    phaseRefDeg: new Float64Array(n),
    thetaDeg: new Float64Array(n),
    reCross: new Float64Array(n),
  }
  for (let i = 0; i < n; i++) {
    const g = G ? G[i] : { re: 1, im: 0 }
    const z = cMul(cMul(H[i], cConj(g)), cExpj(p.omega[i] * p.D))
    out.magH[i] = cAbs(H[i])
    out.phaseHDeg[i] = (cArg(H[i]) * 180) / Math.PI
    out.magRef[i] = cAbs(g)
    out.phaseRefDeg[i] = (cArg(g) * 180) / Math.PI
    out.thetaDeg[i] = wrap180((cArg(z) * 180) / Math.PI)
    out.reCross[i] = z.re
  }
  return out
}

/**
 * 二次差分 Ĥ₂ 相對 E44 的 DT Type-II H_PD 的低頻相位差（rad）：
 *   ∠H_PD − ∠Ĥ₂ ≈ (1 + d)Ω − 2ζΩ/(ω_nT_s)        [近似｜Ω ≪ ω_nT_s ≪ 1]
 * 推導：H_PD = ∇²/(∇² + (K_i + K_p∇)z^{−(1+d)})，∇ = 1 − z⁻¹；低頻略去 ∇² ⇒ H_PD ≈ (∇²/K_i)·z^{1+d}/(1 + (K_p/K_i)∇)，
 * ∠∇² = π − Ω、∠z^{1+d} = (1 + d)Ω、∠(1 + (K_p/K_i)∇)⁻¹ ≈ −(K_p/K_i)Ω = −2ζΩ/(ω_nT_s)。
 */
export function secondDiffPhaseErrApprox(omega: number, wnTs: number, zeta: number, d: number): number {
  return (1 + d) * omega - (2 * zeta * omega) / wnTs
}

/** 由 secondDiffPhaseErrApprox 解 |相位差| < π/2 的低頻上限 Ω ≲ (π/2)/(2ζ/(ω_nT_s) − 1 − d)；分母 ≤ 0 時近似不適用（NaN）。 */
export function secondDiffApproxEdge(wnTs: number, zeta: number, d: number): number {
  const den = (2 * zeta) / wnTs - 1 - d
  return den > 0 ? Math.PI / 2 / den : NaN
}

/**
 * 二次差分 Ĥ₂ 在 DT Type-II 迴路上的極性反轉頻帶：|∠H_PD − ∠Ĥ₂| > 90° 的頻率範圍（精確 freqz，對數格點掃描）。
 * 回傳第一個與最後一個超過 90° 的格點；完全沒有則 null。Ĥ₂ 的增益 K₂ 不影響相位，所以與 ω̂_n 無關。
 */
export function secondDiffFailBand(
  path: Extract<FxPathSpec, { kind: 'type2_dt' }>,
  opts: { lo?: number; n?: number } = {},
): { lo: number; hi: number } | null {
  const grid = logOmegaGrid(opts.lo ?? 1e-4, opts.n ?? 4000)
  const prof = phaseProfile({ h: pathTransfer(path), g: secondDiffTransfer(1), D: 0, omega: grid })
  let lo = NaN
  let hi = NaN
  for (let i = 0; i < grid.length; i++) {
    if (Math.abs(prof.thetaDeg[i]) > 90) {
      if (Number.isNaN(lo)) lo = grid[i]
      hi = grid[i]
    }
  }
  return Number.isNaN(lo) ? null : { lo, hi }
}

/**
 * raw-x 的單頻極性邊界：DT Type-II 的 Re{H_PD(e^{jΩ})} 由負變正的最低頻率 Ω_b [rad/sample]。
 * 比 Ω_b 低的 code tone 用 raw-x 會得到 C < 0（反向更新）。CT 原型的邊界恰為 ω_n；DT 迴路的邊界隨 ω_nT_s 與
 * loop latency d 上移（E44：ω_nT_s = 0.1 時 1.037ω_n（d = 0）／1.122ω_n（d = 1）；0.3 時 1.131ω_n／1.493ω_n）。
 * 對數格點找變號後以二分法收斂；Re{H} 沒有由負變正則回傳 null。
 */
export function rawPolarityBoundary(path: Extract<FxPathSpec, { kind: 'type2_dt' }>, opts: { lo?: number; n?: number } = {}): number | null {
  const tf = pathTransfer(path)
  const re = (om: number): number => freqz(tf.b, tf.a, [om])[0].re
  const grid = logOmegaGrid(opts.lo ?? 1e-4, opts.n ?? 2000)
  let prev = re(grid[0])
  for (let i = 1; i < grid.length; i++) {
    const cur = re(grid[i])
    if (prev < 0 && cur >= 0) {
      let lo = grid[i - 1]
      let hi = grid[i]
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (lo + hi)
        if (re(mid) < 0) lo = mid
        else hi = mid
      }
      return 0.5 * (lo + hi)
    }
    prev = cur
  }
  return null
}

/**
 * AR(1) code（R_x[m] = ρ^{|m|}）下，二次差分 regressor（K₂ = 1）的確切相關，拆成三項：
 *   E[u[n]·(x[n] − 2x[n−1] + x[n−2])] = Σ_k h[k](R_x[k] − 2R_x[k−1] + R_x[k−2])
 *     = (1−ρ)²·h[0]  −  2(1−ρ)·h[1]  +  (1−ρ)²·Σ_{k≥2} h[k]ρ^{k−2}
 * 因為 R 的二次差分在 k = 0、1、≥2 分別是 (1−ρ)²、−2(1−ρ)、ρ^{k−2}(1−ρ)²。h 為 H_PD 的（截斷）脈衝響應。
 */
export function secondDiffAr1Corr(h: ArrayLike<number>, rho: number): { t0: number; t1: number; tail: number; total: number } {
  const e = 1 - rho
  const t0 = e * e * (h.length > 0 ? h[0] : 0)
  const t1 = -2 * e * (h.length > 1 ? h[1] : 0)
  let s = 0
  let pw = 1
  for (let k = 2; k < h.length; k++) {
    s += h[k] * pw
    pw *= rho
  }
  const tail = e * e * s
  return { t0, t1, tail, total: t0 + t1 + tail }
}

/**
 * C_ref 的頻域「投票」分解：(1/π)∫₀^π S_xx·Re{H·Ĝ*·e^{jΩD}} dΩ（被積函數偶對稱，等於 (1/2π)∫_{−π}^{π}），
 * 分成被積函數 > 0（正票）與 < 0（負票）兩部分；梯形法、n 個等距格點。只適用有連續 PSD 的 code（ar1、white_pm_one）。
 */
export function crossIntegralSplit(p: { code: FxCodeSpec; h: DtTransfer; g: DtTransfer | null; D?: number; n?: number }): {
  pos: number
  neg: number
  total: number
} | null {
  if (p.code.kind !== 'ar1' && p.code.kind !== 'white_pm_one') return null
  const n = p.n ?? 32769
  const om = Float64Array.from({ length: n }, (_, i) => (Math.PI * i) / (n - 1))
  const prof = phaseProfile({ h: p.h, g: p.g, D: p.D ?? 0, omega: om })
  const dw = Math.PI / (n - 1)
  let pos = 0
  let neg = 0
  for (let i = 0; i < n; i++) {
    const v = (codePsd(p.code, om[i]) as number) * prof.reCross[i] * (i === 0 || i === n - 1 ? 0.5 : 1) * dw
    if (v > 0) pos += v
    else neg += v
  }
  return { pos: pos / Math.PI, neg: neg / Math.PI, total: (pos + neg) / Math.PI }
}

/** 對數間隔的 Ω 格點（lo … π）。 */
export function logOmegaGrid(lo: number, n: number): Float64Array {
  const out = new Float64Array(n)
  const l0 = Math.log10(lo)
  const l1 = Math.log10(Math.PI)
  for (let i = 0; i < n; i++) out[i] = Math.pow(10, l0 + ((l1 - l0) * i) / (n - 1))
  out[n - 1] = Math.PI
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Lab 分析（主執行緒即可：約 3·10⁴ samples；也可經 worker 呼叫）
// ───────────────────────────────────────────────────────────────────────────

export interface FxLabParams {
  path: FxPathSpec
  code: FxCodeSpec
  mode: RegressorMode
  D: number
  hat: FxHatSpec
  seed: number
  /** D sweep 上限（含） */
  Dmax: number
  /** 經驗相關的樣本數（預設 16384；code 或路徑的相關時間很長時自動改為 65536） */
  samples?: number
}

export interface CorrPair {
  /** 封閉式；DSM code（mash111、dsm1）時為 null */
  analytic: number | null
  /** 同一段 code 的時間平均 */
  empirical: number
  /** 經驗值的標準誤（batch means；單頻 code 為確定性 ripple 上界） */
  se: number
}

export interface FxLabAnalysis {
  /** 真實 H（z⁻¹ 升冪） */
  path: DtTransfer
  /** 模型 Ĥ（含 core、增益、額外延遲與完整 full） */
  hat: BuiltHat
  /** 目前模式的 regressor Ĝ（raw / delayed 為 null） */
  ref: DtTransfer | null
  /** 三種模式在目前 D、Ĥ 下的 C_ref */
  corr: { raw: CorrPair; delayed: CorrPair; filtered: CorrPair; active: CorrPair }
  /** E[u²]（解析／經驗） */
  Eu2: CorrPair
  /** 目前模式 regressor 的功率 E[x_ref²]（經驗） */
  ExRef2: number
  /** 正規化相關 ρ = C/√(E[x_ref²]E[u²]) ∈ [−1, 1]（Cauchy–Schwarz） */
  rhoActive: number
  sweep: {
    D: Int32Array
    codeDelay: { analytic: Float64Array | null; empirical: Float64Array }
    errorDelay: { analytic: Float64Array | null; empirical: Float64Array }
    filtered: { analytic: Float64Array | null; empirical: Float64Array }
  }
  /** 疊圖用波形（transient 之後的一段） */
  wave: { n: Float64Array; x: Float64Array; u: Float64Array; xD: Float64Array; uf: Float64Array; ref: Float64Array }
  /** 逐頻率相位（目前模式） */
  freq: PhaseProfile & { sxx: Float64Array | null }
  /** 單頻 code 時的 H(e^{jΩ}) 與 Ĥ(e^{jΩ}) */
  tone: { omega: number; H: Complex; Hhat: Complex; thetaDeg: number; marginDeg: number; best: ReturnType<typeof bestToneDelay> } | null
  /** 解釋性警告（C ≤ 0 的極性、C ≈ 0、Ĥ ≠ H 或 filtered-x 的 D ≠ 0 時「有效相關不是 E[u²]」的提醒、Ĥ 建構問題） */
  warnings: string[]
  /** 經驗相關使用的樣本數 L（不含 transient） */
  samples: number
  /** 略過的濾波器暫態 sample 數 */
  transient: number
  /** batch means 的 batch 長度（≥ 4 倍相關時間） */
  seBatch: number
}

/** blockLms 的 seeded pattern 與正規化（E[x²] = 1）。 */
export function codeConfig(code: FxCodeSpec): {
  pattern: NonNullable<BlockLmsConfigInput['seeded_pattern']>
  normalization: 'none' | 'standardize'
} {
  switch (code.kind) {
    case 'sinusoid':
      return {
        pattern: { kind: 'sinusoid', parameters: { amplitude: Math.SQRT2, omega: code.omega, phase_deg: 0, random_phase: false } },
        normalization: 'none',
      }
    case 'ar1':
      return { pattern: { kind: 'gaussian', parameters: { mean: 0, sigma: 1, ar1: code.rho } }, normalization: 'none' }
    case 'white_pm_one':
      return { pattern: { kind: 'iid_pm_one', parameters: { amplitude: 1 } }, normalization: 'none' }
    case 'mash111':
      return {
        pattern: { kind: 'mash111', parameters: { frac: code.frac, bits: 20, dither: false, signal: 'residue' } },
        normalization: 'standardize',
      }
    case 'dsm1':
      return {
        pattern: { kind: 'dsm_first_order', parameters: { frac: code.frac, bits: 20, dither: false, signal: 'residue' } },
        normalization: 'standardize',
      }
  }
}

function meanProd(a: ArrayLike<number>, b: ArrayLike<number>, lo: number, hi: number): number {
  let s = 0
  for (let i = lo; i < hi; i++) s += a[i] * b[i]
  return s / (hi - lo)
}

function batchSe(a: ArrayLike<number>, b: ArrayLike<number>, lo: number, hi: number, batch = 512): number {
  const nb = Math.floor((hi - lo) / batch)
  if (nb < 4) return NaN
  const m = new Float64Array(nb)
  for (let k = 0; k < nb; k++) m[k] = meanProd(a, b, lo + k * batch, lo + (k + 1) * batch)
  let mu = 0
  for (const v of m) mu += v
  mu /= nb
  let v2 = 0
  for (const v of m) v2 += (v - mu) * (v - mu)
  return Math.sqrt(v2 / (nb - 1) / nb)
}

/** 依模式產生 regressor（實際執行上方 #region 的函式）。 */
export function computeRegressor(x: ArrayLike<number>, mode: RegressorMode, D: number, hat: BuiltHat): Float64Array {
  if (mode === 'raw') return regressorRaw(x)
  if (mode === 'delayed') return regressorDelayed(x, D)
  if (hat.secondDiffScale !== null && hat.core.b.length === 3 && hat.core.a.length === 1) {
    // 純二次差分（沒有相位旋轉器）：用 secondDiff 的硬體寫法，再乘增益、延遲 Δ + D
    const sd = regressorSecondDiff(x, hat.secondDiffScale * hat.gain)
    return regressorDelayed(sd, D + hat.extraDelay)
  }
  return regressorFiltered(x, hat.full, D)
}

/**
 * 輕量版的經驗相關（彙整表用；不做 sweep、波形與逐頻率分析）：在同一段 code 上計算
 *   C = mean(x_ref·u)、E[u²]、E[x_ref²] 與正規化相關 ρ = C/√(E[x_ref²]·E[u²])。
 * code 與 analyzeFxLab／runBlockLms 相同（generateCodePattern，同 seed、同 pattern）；略過濾波器暫態。
 * 用途：沒有封閉式 PSD 的 DSM code（mash111、dsm1）在不同 FCW 下的 raw-x／filtered-x 比較。
 */
export function empiricalCorr(p: {
  path: FxPathSpec
  code: FxCodeSpec
  mode: RegressorMode
  D?: number
  hat?: FxHatSpec
  seed: number
  /** 平均的樣本數（不含暫態），預設 32768 */
  samples?: number
}): { C: number; Eu2: number; ExRef2: number; rho: number; samples: number; transient: number } {
  const D = p.D ?? 0
  if (!Number.isInteger(D) || D < 0) throw new Error(`D 必須為非負整數，收到 ${D}`)
  assertStablePath(p.path)
  const path = pathTransfer(p.path)
  const hat = buildHat(p.path, p.hat ?? HAT_EXACT, p.code)
  if (p.mode === 'filtered' && !hat.stable) throw new Error(`filtered-x 的模型 Ĥ 不穩定（${hat.description}）：u_f 會發散，E[u·u_f] 沒有定義`)
  const L = p.samples ?? 32768
  const transient = Math.min(1 << 14, Math.max(truncatedImpulse(path, 1e-9, 1 << 14).length, truncatedImpulse(hat.full, 1e-9, 1 << 14).length) + D + 16)
  const { pattern, normalization } = codeConfig(p.code)
  const x = generateCodePattern({ pattern, length: transient + L, seed: p.seed, normalization }).code
  const u = lfilter(path.b, path.a, x).y
  const xr = computeRegressor(x, p.mode, D, hat)
  const C = meanProd(xr, u, transient, transient + L)
  const Eu2 = meanProd(u, u, transient, transient + L)
  const ExRef2 = meanProd(xr, xr, transient, transient + L)
  return { C, Eu2, ExRef2, rho: C / Math.sqrt(Math.max(ExRef2 * Eu2, 1e-300)), samples: L, transient }
}

/**
 * Lab 的即時分析：三種模式的 C_ref（解析＋經驗）、C vs D、波形與逐頻率相位。
 * 經驗值使用與 runBlockLms 完全相同的 code 序列（generateCodePattern，同 seed、同 pattern）。
 */
export function analyzeFxLab(p: FxLabParams): FxLabAnalysis {
  const warnings: string[] = []
  const D = p.D
  if (!Number.isInteger(D) || D < 0) throw new Error(`D 必須為非負整數，收到 ${D}`)
  const Dmax = Math.max(1, Math.floor(p.Dmax))
  assertStablePath(p.path)
  const path = pathTransfer(p.path)
  let hat = buildHat(p.path, p.hat, p.code)
  if (!hat.stable) {
    if (p.mode === 'filtered') {
      throw new Error(`filtered-x 的模型 Ĥ 不穩定（${hat.description}）——u_f = ĥ * x 會發散，E[u·u_f] 沒有定義。請減小頻寬誤差或模型的 loop latency`)
    }
    // raw / delayed 模式用不到 Ĥ：對照用的 E[u·u_f] 一欄改以 Ĥ = H 計算，並說明原因
    warnings.push(`目前 Case 的 Ĥ 設定不穩定（${hat.description}）；此模式不使用 Ĥ，對照用的 E[u·u_f] 改以 Ĥ = H 計算`)
    hat = buildHat(p.path, HAT_EXACT, p.code)
  }
  warnings.push(...hat.warnings)
  const ref = p.mode === 'filtered' ? hat.full : null

  // ── code 與 transient ──
  const hImp = truncatedImpulse(path, 1e-9, 1 << 14)
  const hatImp = truncatedImpulse(hat.full, 1e-9, 1 << 14)
  const transient = Math.min(1 << 14, Math.max(hImp.length, hatImp.length) + Dmax + D + 16)
  // 相關時間：濾波器記憶長度與 AR(1) 的 ~10/(1 − |ρ|)；決定樣本數與 batch 長度（SE 才不會低估）
  // 一階 DSM 的 sawtooth 週期約 1/min(frac, 1 − frac) samples：平均至少要涵蓋數十個週期
  const codeLen =
    p.code.kind === 'ar1'
      ? Math.ceil(10 / Math.max(1e-3, 1 - Math.abs(p.code.rho)))
      : p.code.kind === 'dsm1'
        ? Math.ceil(2 / Math.max(1e-4, Math.min(p.code.frac, 1 - p.code.frac)))
        : 1
  const corrLen = Math.max(hImp.length, hatImp.length, codeLen)
  const L = p.samples ?? (corrLen > 1000 ? 65536 : 16384)
  const seBatch = Math.max(64, Math.min(Math.floor(L / 8), Math.max(512, 4 * corrLen)))
  const total = transient + L
  const { pattern, normalization } = codeConfig(p.code)
  const x = generateCodePattern({ pattern, length: total, seed: p.seed, normalization }).code
  const u = lfilter(path.b, path.a, x).y
  const xrRaw = regressorRaw(x)
  const xrDel = regressorDelayed(x, D)
  const xrFil = computeRegressor(x, 'filtered', D, hat)
  const xrAct = p.mode === 'raw' ? xrRaw : p.mode === 'delayed' ? xrDel : xrFil
  const lo = transient
  const hi = total

  const tone = p.code.kind === 'sinusoid'
  const omegaTone = p.code.kind === 'sinusoid' ? p.code.omega : NaN
  const Htone = tone ? freqz(path.b, path.a, [omegaTone])[0] : null
  const toneSe = (gMag: number): number => {
    // 單頻：時間平均與長時間值的差異為確定性 ripple，上界 (A²|H||G|/2)/(L|sinΩ|)，A²/2 = 1
    if (!Htone) return NaN
    return (cAbs(Htone) * gMag) / (L * Math.abs(Math.sin(omegaTone)))
  }
  const pair = (g: DtTransfer | null, Dd: number, xr: Float64Array, gMag: number): CorrPair => ({
    analytic: analyticCorr({ code: p.code, h: path, g, D: Dd }),
    empirical: meanProd(xr, u, lo, hi),
    se: tone ? toneSe(gMag) : batchSe(xr, u, lo, hi, seBatch),
  })
  const HhatTone = tone ? freqz(hat.full.b, hat.full.a, [omegaTone])[0] : null
  const corrRaw = pair(null, 0, xrRaw, 1)
  const corrDel = pair(null, D, xrDel, 1)
  const corrFil = pair(hat.full, D, xrFil, HhatTone ? cAbs(HhatTone) : 1)
  const active = p.mode === 'raw' ? corrRaw : p.mode === 'delayed' ? corrDel : corrFil
  const Eu2: CorrPair = {
    analytic: analyticCorr({ code: p.code, h: path, g: path, D: 0 }),
    empirical: meanProd(u, u, lo, hi),
    se: tone && Htone ? toneSe(cAbs(Htone)) : batchSe(u, u, lo, hi, seBatch),
  }
  const ExRef2 = meanProd(xrAct, xrAct, lo, hi)
  const rhoActive = active.empirical / Math.sqrt(Math.max(ExRef2 * Eu2.empirical, 1e-300))

  // ── C vs D sweep（經驗值用 xcorr：R[ℓ] = mean x[n−ℓ]·y[n]）──
  const Ds = Int32Array.from({ length: Dmax + 1 }, (_, i) => i)
  const xs = x.subarray(lo)
  const us = u.subarray(lo)
  const ufBase = computeRegressor(x, 'filtered', 0, hat).subarray(lo) // u_f[n]（D = 0）
  const xcXu = xcorr(xs, us, Dmax)
  const xcUfU = xcorr(ufBase, us, Dmax)
  const codeEmp = new Float64Array(Dmax + 1)
  const errEmp = new Float64Array(Dmax + 1)
  const filEmp = new Float64Array(Dmax + 1)
  for (let d = 0; d <= Dmax; d++) {
    codeEmp[d] = xcXu.values[Dmax + d] // E[x[n−d]·u[n]]
    errEmp[d] = xcXu.values[Dmax - d] // E[x[n]·u[n−d]]
    filEmp[d] = xcUfU.values[Dmax + d] // E[u_f[n−d]·u[n]]
  }
  const negDs = Int32Array.from(Ds, (d) => -d)
  const sweep = {
    D: Ds,
    codeDelay: { analytic: analyticCorrSweep({ code: p.code, h: path, g: null, Ds }), empirical: codeEmp },
    errorDelay: { analytic: analyticCorrSweep({ code: p.code, h: path, g: null, Ds: negDs }), empirical: errEmp },
    filtered: { analytic: analyticCorrSweep({ code: p.code, h: path, g: hat.full, Ds }), empirical: filEmp },
  }

  // ── 波形（transient 後一段）──
  const win = tone ? Math.min(720, Math.max(48, Math.ceil((2.5 * 2 * Math.PI) / omegaTone))) : 96
  const w0 = lo
  const wn = Math.min(win, hi - w0)
  const ufRaw = computeRegressor(x, 'filtered', 0, hat)
  const wave = {
    n: Float64Array.from({ length: wn }, (_, i) => w0 + i),
    x: x.slice(w0, w0 + wn),
    u: u.slice(w0, w0 + wn),
    xD: xrDel.slice(w0, w0 + wn),
    uf: ufRaw.slice(w0, w0 + wn),
    ref: xrAct.slice(w0, w0 + wn),
  }

  // ── 逐頻率相位 ──
  const omLo = tone ? Math.min(1e-3, omegaTone / 10) : 1e-3
  const omega = logOmegaGrid(omLo, 400)
  const effD = p.mode === 'raw' ? 0 : D
  const prof = phaseProfile({ h: path, g: ref, D: effD, omega })
  const sxx = p.code.kind === 'ar1' || p.code.kind === 'white_pm_one' ? Float64Array.from(omega, (o) => codePsd(p.code, o) as number) : null

  let toneInfo: FxLabAnalysis['tone'] = null
  if (tone && Htone) {
    const Gt = ref ? freqz(ref.b, ref.a, [omegaTone])[0] : { re: 1, im: 0 }
    const z = cMul(cMul(Htone, cConj(Gt)), cExpj(omegaTone * effD))
    const thetaDeg = wrap180((cArg(z) * 180) / Math.PI)
    toneInfo = {
      omega: omegaTone,
      H: Htone,
      Hhat: HhatTone as Complex,
      thetaDeg,
      marginDeg: polarityMarginDeg(thetaDeg),
      best: bestToneDelay(cArg(Htone), omegaTone, Math.max(Dmax, Math.ceil((2 * Math.PI) / omegaTone))),
    }
  }

  // ── 解釋性警告 ──
  const tolC = 1e-3 * Math.sqrt(Math.max(ExRef2 * Eu2.empirical, 0))
  const cAct = active.analytic ?? active.empirical
  if (!Number.isFinite(cAct)) {
    warnings.push(`C 不是有限數（${cAct}）：誤差路徑或 Ĥ 的輸出發散，無法判斷極性；請檢查迴路是否穩定`)
  } else if (cAct < -tolC) {
    // filtered-x 的 regressor 是 u_f[n − D]：D ≠ 0 時相關是 C_{f,D} = E[u[n]·u_f[n − D]]（F-07.12），多出來的相位 ΩD 也會讓它變號——
    // 即使 Ĥ = H。D = 0 的字串維持原樣（Ĥ ≠ H 才可能走到這裡，原因是模型誤差，E45）。
    warnings.push(
      p.mode === 'filtered'
        ? D === 0
          ? `C ≤ 0：E[u·u_f] = ${cAct.toPrecision(4)} < 0，Ĥ 與 H 在激勵頻帶的相位差超過 90°（E45）：filtered-x 一樣會反向更新`
          : `C ≤ 0：E[u[n]·u_f[n−D]] = ${cAct.toPrecision(4)} < 0（D = ${D}）：regressor 多延遲 D 個 sample，每個頻率多出相位 ΩD，殘餘相位（Ĥ 與 H 的相位差再加 ΩD）在激勵頻帶超過 90°：filtered-x 一樣會反向更新（F-07.12）`
        : `C ≤ 0：更新極性錯誤（C = ${cAct.toPrecision(4)}），正 learning rate 會使平均誤差發散；只減小 μ 不會改變符號`,
    )
  } else if (!(cAct > tolC)) {
    warnings.push(
      `C ≈ 0（${cAct.toPrecision(3)}）：${tone ? '殘餘相位約 ±90°' : '各頻率的正負票幾乎抵消'}，GMAC 沒有平均恢復力，w 會隨雜訊漂移`,
    )
  }
  if (p.mode === 'raw' && D !== 0) warnings.push(`raw-x 模式忽略 D = ${D}（請改用 delayed-x 或 filtered-x）`)
  if (p.mode === 'filtered' && (!hat.exact || D !== 0)) {
    // 有效相關不是 E[u²] 的兩個原因：模型誤差（Ĥ ≠ H，E45）與 regressor 的額外延遲（D ≠ 0，F-07.12）
    const eu2 = Eu2.analytic ?? Eu2.empirical
    warnings.push(
      D === 0
        ? `Ĥ ≠ H：有效相關是 E[u·u_f] = ${cAct.toPrecision(4)}，不是 E[u²] = ${eu2.toPrecision(4)}（E45）`
        : hat.exact
          ? `D = ${D} ≠ 0：有效相關是 E[u[n]·u_f[n−D]] = ${cAct.toPrecision(4)}，不是 E[u²] = ${eu2.toPrecision(4)}（F-07.12）`
          : `Ĥ ≠ H、D = ${D} ≠ 0：有效相關是 E[u[n]·u_f[n−D]] = ${cAct.toPrecision(4)}，不是 E[u²] = ${eu2.toPrecision(4)}（E45）`,
    )
  }

  return {
    path,
    hat,
    ref,
    corr: { raw: corrRaw, delayed: corrDel, filtered: corrFil, active },
    Eu2,
    ExRef2,
    rhoActive,
    sweep,
    wave,
    freq: { ...prof, sxx },
    tone: toneInfo,
    warnings,
    samples: L,
    transient,
    seBatch,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 7. 閉迴路 A/B/C 比較（runBlockLms，同一 seed）——worker 呼叫
// ───────────────────────────────────────────────────────────────────────────

/** 由場景 + Case 產生 blockLms 設定（raw 模式強制 D = 0）。 */
export function fxBlockLmsConfig(s: FxScenario, c: FxCaseSpec, traceBlocks = 0): BlockLmsConfigInput {
  const { pattern, normalization } = codeConfig(s.code)
  const cfg: BlockLmsConfigInput = {
    seed: s.seed,
    gm_accum_samples: s.N,
    num_blocks: s.blocks,
    gain_true: s.a,
    gain_initial: s.w0,
    gain_step: c.mu,
    pd_noise_rms_fs: s.sigmaV,
    code_normalization: normalization,
    gm_mode: 'average',
    comparator_encoding: 'bipolar_pm_one',
    pll_error_path: pathConfig(s.path),
    seeded_pattern: pattern,
    regressor_mode: c.mode,
    gm_code_delay_samples: c.mode === 'raw' ? 0 : c.D,
    record: { sample_trace_blocks: traceBlocks, decimate: 1 },
  }
  if (c.mode === 'filtered') {
    const hat = buildHat(s.path, c.hat, s.code)
    cfg.filtered_x_model = hat.exact
      ? { path: 'same_as_path', gain_mismatch: 1, extra_delay_samples: 0 }
      : { path: { kind: 'iir', parameters: { b: hat.core.b, a: hat.core.a } }, gain_mismatch: hat.gain, extra_delay_samples: hat.extraDelay }
  }
  return cfg
}

export interface FxCaseResult {
  id: string
  /** 這個 Case 的 gain_step μ [fs]（average 模式） */
  mu: number
  /** w_k，長度 blocks + 1 [fs] */
  w: Float64Array
  /** 第 k 個 block 的 GMAC 輸出 G_k */
  G: Float64Array
  metrics: { meanW: number; stdW: number; bias: number; diverged: boolean; settlingBlock: number | null; wEnd: number }
  analytic: {
    Cest: number
    Kq: number
    g: number
    p: number
    stableMean: boolean
    wStarMeanField: number
    sigmaWPred: number
    tauBlocks: number
    /** 單一 block 的 GMAC 雜訊變異 σ_η² ≈ E[x_ref²]/N（average 模式） */
    sigmaEta2: number
  }
  warnings: string[]
  modelLevel: string
}

export interface FxComparisonResult {
  cases: FxCaseResult[]
  seed: number
  totalSamples: number
}

/**
 * 同一 seed、同一 code、同一 comparator 雜訊下，比較數個 regressor 設定的閉迴路 w_k（paired simulation）。
 * 純函式；可經 useWorkerTask('filteredX', 'runFxComparison') 在 Web Worker 執行。
 */
export function runFxComparison(p: { scenario: FxScenario; cases: { id: string; spec: FxCaseSpec }[] }): FxComparisonResult {
  const out: FxCaseResult[] = []
  for (const c of p.cases) {
    const res = runBlockLms(fxBlockLmsConfig(p.scenario, c.spec, 0))
    const K = res.blocks.w.length - 1
    out.push({
      id: c.id,
      mu: c.spec.mu,
      w: res.blocks.w,
      G: res.blocks.G,
      metrics: {
        meanW: res.metrics.meanW,
        stdW: res.metrics.stdW,
        bias: res.metrics.bias,
        diverged: res.metrics.diverged,
        settlingBlock: res.metrics.settlingBlock,
        wEnd: res.blocks.w[K],
      },
      analytic: {
        Cest: res.analytic.Cest,
        Kq: res.analytic.Kq,
        g: res.analytic.g,
        p: res.analytic.p,
        stableMean: res.analytic.stableMean,
        wStarMeanField: res.analytic.wStarMeanField,
        sigmaWPred: res.analytic.sigmaWPred,
        tauBlocks: res.analytic.tauBlocks,
        sigmaEta2: res.analytic.sigmaEta2,
      },
      warnings: res.warnings,
      modelLevel: res.modelLevel,
    })
  }
  return { cases: out, seed: p.scenario.seed, totalSamples: p.cases.length * p.scenario.N * p.scenario.blocks }
}

export type ConsistencyStatus = 'ok' | 'mismatch' | 'n/a'

/** 交叉比對的門檻：偏差超過 CL_Z_MISMATCH 個標準誤判為不一致；位移超過 CL_Z_DETECT 個標準誤才算「看得出來」。 */
export const CL_Z_MISMATCH = 5
export const CL_Z_DETECT = 3

/**
 * 後半段平均 w 的標準誤：穩態的 w_k 近似 AR(1)（pole p、標準差 σ_w），M 個**相關**樣本的平均
 *   Var(mean) ≈ σ_w²·(1 + p)/((1 − p)·M)        [近似｜M ≫ τ]
 * （不是 σ_w/√M：相鄰 block 高度相關，有效獨立樣本數只有 M(1 − p)/(1 + p)。）
 */
export function meanWStdErr(sigmaW: number, p: number, M: number): number {
  return sigmaW * Math.sqrt((1 + p) / ((1 - p) * M))
}

/**
 * 閉迴路結果是否符合線性化平均模型的預測（Analytic vs Monte Carlo 交叉比對用；單一 seed 的假設檢定）：
 *   預測收斂（0 < g < 2，且 block 數 ≥ 10τ）：令 SE = meanWStdErr(σ_w, p, M)（M = 後半段 block 數）。
 *     |mean w − 固定點| > 5·SE（+1% 殘餘暫態）→ 'mismatch'；
 *     否則還要 |mean w − w_0| > 3·SE（確實看得出 w 離開初值）才給 'ok'；雜訊太大分不出來 → 'n/a'。
 *     （舊版用 5·std(w) 當容許值：std 比 SE 大好幾倍，容許值常常超過 |a − w_0|，連「完全沒動」都會通過。）
 *   預測發散（C < 0 ⇒ p > 1）：沒有恢復力時 w 只是隨機漫步，K 個 block 後標準差 σ_rw = μ√(Kσ_η²)。
 *     |w_end − a| − |w_0 − a| > 3σ_rw → 'ok'（被推離真值，而且不是隨機漫步能解釋的）；
 *     < −3σ_rw → 'mismatch'（反而靠近真值）；介於兩者之間 → 'n/a'。
 *   |g| < 10⁻³（C ≈ 0）或收斂太慢 → 'n/a'（誠實標示未做定量比對）。
 */
export function closedLoopConsistent(r: FxCaseResult, a: number, w0: number): { status: ConsistencyStatus; note: string } {
  const { analytic: an, metrics: m } = r
  const K = r.w.length - 1
  // runBlockLms 對不穩定的誤差路徑／Ĥ 會給「…不穩定（pole 半徑 …）：模擬結果無物理意義」的警告
  const unstable = r.warnings.find((w) => w.includes('不穩定（pole 半徑'))
  if (unstable) return { status: 'n/a', note: `${unstable}——C 沒有定義，無法比對` }
  if (!Number.isFinite(an.g)) {
    return { status: 'n/a', note: 'g 不是有限數（誤差路徑或 Ĥ 的輸出發散，C 沒有定義）：無法比對' }
  }
  if (Math.abs(an.g) < 1e-3) {
    return { status: 'n/a', note: `g = ${an.g.toPrecision(3)} ≈ 0：沒有平均恢復力（隨機漂移），不做定量比對` }
  }
  if (an.stableMean && an.g > 0) {
    if (!(Number.isFinite(an.tauBlocks) && K >= 10 * an.tauBlocks)) {
      return { status: 'n/a', note: `τ = ${an.tauBlocks.toPrecision(3)} blocks：block 數 ${K} 不足 10τ，後半段尚未收斂，不做定量比對` }
    }
    if (m.diverged || !Number.isFinite(m.meanW)) {
      return { status: 'mismatch', note: `預測收斂（p = ${an.p.toPrecision(5)}），但模擬發散` }
    }
    const M = K + 1 - Math.ceil((K + 1) / 2) // 與 runBlockLms 的後半段定義相同
    const sigW = Number.isFinite(an.sigmaWPred) && an.sigmaWPred > 0 ? an.sigmaWPred : m.stdW
    const se = meanWStdErr(sigW, an.p, M)
    const target = Number.isFinite(an.wStarMeanField) ? an.wStarMeanField : a
    const dev = Math.abs(m.meanW - target)
    const tol = CL_Z_MISMATCH * se + 0.01 * Math.abs(target - w0) + 1e-9
    const head = `預測收斂：後半段 mean w = ${m.meanW.toPrecision(5)}，固定點 ${target.toPrecision(5)}，SE = ${se.toPrecision(3)}（${M} 個相關 block）`
    if (!(dev <= tol)) return { status: 'mismatch', note: `${head}；偏差 ${dev.toPrecision(3)} 超過 ${CL_Z_MISMATCH} SE` }
    if (!(Math.abs(m.meanW - w0) > CL_Z_DETECT * se)) {
      return { status: 'n/a', note: `${head}；|mean w − w_0| 不到 ${CL_Z_DETECT} SE：雜訊太大，分不出「收斂」與「沒有移動」（請加大 N 或 block 數）` }
    }
    const ratios = se > 0 ? `；偏差 ${(dev / se).toPrecision(2)} SE，離開初值 ${(Math.abs(m.meanW - w0) / se).toPrecision(3)} SE` : ''
    return { status: 'ok', note: `${head}${ratios}` }
  }
  if (an.p > 1) {
    const head = `預測發散（p = ${an.p.toPrecision(5)} > 1）`
    if (m.diverged) return { status: 'ok', note: `${head}：模擬也發散` }
    const d = Math.abs(m.wEnd - a) - Math.abs(w0 - a)
    const sigRw = Math.abs(r.mu) * Math.sqrt(K * an.sigmaEta2)
    const tail = `|w_end − a| − |w_0 − a| = ${d.toPrecision(4)} fs，隨機漫步 σ_rw = μ√(Kσ_η²) = ${sigRw.toPrecision(3)} fs`
    if (!Number.isFinite(sigRw) || !Number.isFinite(d)) return { status: 'n/a', note: `${head}：${tail}（無法評估）` }
    if (d > CL_Z_DETECT * sigRw) return { status: 'ok', note: `${head}：${tail}，被推離真值` }
    if (d < -CL_Z_DETECT * sigRw) return { status: 'mismatch', note: `${head}：${tail}，卻靠近真值` }
    return { status: 'n/a', note: `${head}：${tail}，位移不到 ${CL_Z_DETECT}σ_rw，分不出發散與隨機漫步` }
  }
  return { status: 'n/a', note: `g = ${an.g.toPrecision(4)}：超出一階線性化模型的穩定區（g ≥ 2 或含更新延遲），未做定量比對` }
}
