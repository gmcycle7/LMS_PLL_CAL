/**
 * 第 06 章：PLL error transfer 的相位與 GMAC 更新極性（規格 §6、§6.1、§6.2；模型層級 L1 / L2）。
 * 頁面以 `?raw` + `#region core:*` 直接顯示本檔程式碼（docs/teaching-style.md §4）。
 *
 * ── 模型（全站極性約定 δ = a − w；時間單位 fs；code x 無因次）──
 *   DTC 誤差   ε[n] = (a − w_k)·x[n]                      （block k 內 w 固定）
 *   PD 看到    e[n] = H_PD{ε}[n] + v[n]，H_PD = 1/(1 + L)   （濾波器狀態跨 block 持續）
 *              架構（docs/assumptions.md §2a）：DTC 在 reference 輸入端，ε 在 PD 的 reference 輸入端注入（e_PD = ε − θ_fb），
 *              所以 H_PD 前面是正號；q 取的是 PD 的輸出（送進 loop filter 的同一個節點）的正負號
 *   w 在 h 的記憶長度內近似常數時：e[n] ≈ (a − w)·u[n] + v[n]，u = h * x     [近似｜時間尺度分離]
 *   q = sign(e)（tie → +1）；GMAC 用原始（延遲 D）的 code：G_k = (1/N)Σ q[n]·x[n − D]
 *   小訊號：E[G_k] ≈ K_q·(a − w_k)·C_D，C_D = E[x[n − D]·u[n]]，K_q = √(2/π)/σ_v
 *   平均 pole p = 1 − μK_qC_D；C_D < 0 ⇒ 對任何 μ > 0 都有 p > 1（平均發散，減小 μ 也救不回來）
 *
 * ── 同一個 C 的五種算法（彼此交叉驗證）──
 *   toneCorrelation       ：單頻封閉式 (A²/2)|H|cos(φ + ΩD)（E46：Ω = 0、π 時為 2 倍）
 *   spectralCorrelation   ：(1/2π)∫ S_xx Re{H e^{jΩD}} dΩ（DTFT 形式 PSD；梯形法）
 *   lineCorrelation       ：譜線和 Σ_m P_m Re{H(e^{jΩ_m}) e^{jΩ_m D}}（單頻、鋸齒、三角波、週期圖都是它的特例）
 *   autocorrCorrelation   ：Σ_k h[k]·R_x[k − D]（搭配 sawtoothAutocorr = 一階 DSM residue 的精確封閉式）
 *   empiricalCorrelation  ：時域 mean_n x[n − D]·u[n]
 *
 * ── 近整數 FCW（一階 DSM residue = 鋸齒）──
 *   R_x[ℓ]/σ² = 1 − 6t(1 − t)，t = frac(|ℓ|·frac)（有限相位格點 P 時乘 P²/(P² − 1)）；動差 m_j = Σ k^j h[k]
 *   Type-II：m₀ = m₁ = 0、m₂ = 2/K_i ⇒ C/σ² ≈ 12·frac²/K_i（D = 0，不變號）；
 *            1 ≤ D ≤ d + 1 時 ≈ −12·frac·D + 12·frac²/K_i（D > frac/K_i 即變號）
 *
 * ── 任意 δ 的 mean-field 特性與大誤差極限 ──
 *   E[G](δ) = E[x_ref·erf(δu/(√2σ_v))]（meanFieldGmac）；|δu| ≪ σ_v ⇒ K_qδC_D；
 *   |δu| ≫ σ_v 時 G → sign(δ)·E[x_ref·sign u]（u = 0 的取樣點貢獻 0）；C < 0 時 |δ| 每 block 線性增加 μ|E[x_ref·sign u]|
 *
 * ── 主 PLL：CT 參考原型（ν = ω/ω_L）與 DT 模擬模型（E44：Ω 為 rad/sample，不可代入 H(jω)）──
 *   Type-I ：L(s) = ω_c/s；           DT：L(z) = K·z^{−(1+d)}/(1 − z⁻¹)，K = ω_cT_s
 *   Type-II：L(s) = (2ζω_n s + ω_n²)/s²；DT：L(z) = (K_p + K_i/(1 − z⁻¹))·z^{−(1+d)}/(1 − z⁻¹)
 *            K_p = 2ζω_nT_s、K_i = (ω_nT_s)²（與 pll.ts designDtLoop 的 'dpll' 方法係數相同，測試驗證）
 *
 * 純數值、無 React/DOM。標 (worker) 的函式：參數與回傳值皆可 structured clone，可由 useWorkerTask 呼叫。
 * 隨機性一律來自 createRng(seed)；同 seed 可重現。
 */

import { cAbs, createRng, deriveSeed, erf, polyRoots, type Complex } from '@/simulation/core'
import { fftReal, freqz, impulseResponse, lfilter, nextPow2, StreamFilter, welch, xcorr } from '@/simulation/signal'
import { ctBandwidth3dB } from '@/simulation/models/pll'
import { quantizeFcw } from '@/simulation/models/dsm'
import { createZigguratNormal, generateCodePattern, runBlockLms, type BlockLmsConfigInput } from '@/simulation/models/blockLms'

// ───────────────────────────────────────────────────────────────────────────
// 型別與常數
// ───────────────────────────────────────────────────────────────────────────

export type LoopType = 'typeI' | 'typeII'
/** PLL 模式可選的 code：單頻、一階 DSM residue、MASH 1-1-1 residue、iid ±1、三角波（只用於 FCW sweep 對照） */
export type PolarityCodeKind = 'tone' | 'dsm1' | 'mash' | 'iid' | 'triangle'
export type RegressorMode = 'x' | 'u'

/** 離散時間轉移函數，b、a 為 z⁻¹ 升冪 */
export interface TransferBA {
  b: number[]
  a: number[]
}

/** √(2/π) */
export const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
/** |sin Ω| 小於此值視為 Ω = 0 或 π（E46 邊界） */
export const TONE_EDGE_EPS = 1e-12
/** 單次閉迴路模擬每條 chain 的樣本上限（N × blocks） */
export const MAX_CLOSED_LOOP_SAMPLES = 2 ** 22

/** 1-bit comparator 的小訊號增益 K_q = √(2/π)/σ_v [fs⁻¹]（σ_v ≤ 0 時 NaN） */
export function kqFromSigma(sigmaV: number): number {
  return sigmaV > 0 ? SQRT_2_OVER_PI / sigmaV : Number.NaN
}

/** Ω 是否為 0 或 π（sinΩ = 0；實係數 h 只能給實數 H，E46） */
export function isToneEdge(omega: number): boolean {
  return Math.abs(Math.sin(omega)) < TONE_EDGE_EPS
}

/** Re{H·e^{jθ}} = Re H·cosθ − Im H·sinθ */
function reRotated(h: Complex, theta: number): number {
  return theta === 0 ? h.re : h.re * Math.cos(theta) - h.im * Math.sin(theta)
}

// ───────────────────────────────────────────────────────────────────────────
// 單頻（§6.1）
// ───────────────────────────────────────────────────────────────────────────

/** 單頻設定：x[n] = A cos(Ωn)，H(e^{jΩ}) = |H|e^{jφ}，GMAC 用 x[n − D] */
export interface ToneSpec {
  A: number
  mag: number
  /** φ [rad] */
  phiRad: number
  /** Ω [rad/sample] */
  omega: number
  /** D [samples] */
  delay?: number
}

// #region core:toneFir
/**
 * 2-tap 因果實係數 FIR h = [h0, h1]，使 H(e^{jΩ}) = h0 + h1·e^{−jΩ} = |H|·e^{jφ}。
 *   實部：h0 + h1·cosΩ = |H|·cosφ；虛部：−h1·sinΩ = |H|·sinφ ⇒ 先解 h1，再解 h0。
 * Ω = 0 或 π 時 sinΩ = 0：實係數 h 的 H 必為實數（φ 只能 0° 或 180°，E46），此時丟錯。
 */
export function toneFir(mag: number, phiRad: number, omega: number): [number, number] {
  const s = Math.sin(omega)
  if (Math.abs(s) < TONE_EDGE_EPS) {
    throw new Error('Ω = 0 或 π：實係數 FIR 的 H(e^{jΩ}) 必為實數，φ 只能是 0° 或 180°（E46）')
  }
  const h1 = (-mag * Math.sin(phiRad)) / s // 由虛部：−h1·sinΩ = |H|·sinφ
  const h0 = mag * Math.cos(phiRad) - h1 * Math.cos(omega) // 由實部：h0 + h1·cosΩ = |H|·cosφ
  return [h0, h1]
}
// #endregion

/**
 * 單頻模式實際使用的路徑：一般 Ω 用 toneFir；Ω = 0 或 π 時把 φ 吸附到 0° 或 180°（依 cosφ 的正負），
 * 並以單 tap h = [±|H|] 實現（E46）。
 */
export function tonePath(mag: number, phiRad: number, omega: number): TransferBA & { phiEffRad: number; edge: boolean } {
  if (isToneEdge(omega)) {
    const phiEffRad = Math.cos(phiRad) >= 0 ? 0 : Math.PI
    return { b: [phiEffRad === 0 ? mag : -mag], a: [1], phiEffRad, edge: true }
  }
  const h = toneFir(mag, phiRad, omega)
  return { b: [h[0], h[1]], a: [1], phiEffRad: phiRad, edge: false }
}

// #region core:toneCorrelation
/**
 * 單頻相關 C_D = E[x[n − D]·u[n]]（長時間平均或整數週期平均）：
 *   0 < Ω < π：C_D = (A²/2)·|H|·cos(φ + ΩD)                       [精確｜單頻、長時間平均]
 *   Ω = 0 或 π：cos(2Ωn + …) 恆為常數、不會平均掉 ⇒ C_D = A²·|H|·cosφ·cos(ΩD)（2 倍，E46）
 */
export function toneCorrelation(p: ToneSpec): number {
  const { A, mag, phiRad, omega } = p
  const D = p.delay ?? 0
  if (isToneEdge(omega)) {
    return A * A * mag * Math.cos(phiRad) * Math.cos(omega * D) // ← 差異：Ω = 0、π 的邊界（E46）
  }
  return 0.5 * A * A * mag * Math.cos(phiRad + omega * D) // (A²/2)|H|cos(φ + ΩD)
}
// #endregion

// #region core:toneBlockCorrelation
/**
 * 有限 N 的 block 平均（n = n0 … n0+N−1）確切值（E46）：
 *   G = (A²|H|/2)·[cos(φ + ΩD) + cos(2Ωn0 + Ω(N−1) + φ − ΩD)·sin(NΩ)/(N·sinΩ)]
 * 第二項是 cos(2Ωn + …) 沒平均乾淨的 ripple，上界 (A²|H|/2)·min(1, 1/(N|sinΩ|))。
 */
export function toneBlockCorrelation(p: ToneSpec & { N: number; n0?: number }): number {
  const { A, mag, phiRad, omega, N } = p
  const D = p.delay ?? 0
  const n0 = p.n0 ?? 0
  if (isToneEdge(omega)) return toneCorrelation(p) // 邊界：x[n−D]·u[n] 本身就是常數，沒有 ripple
  const psi = phiRad - omega * D
  const phase = 2 * omega * n0 + omega * (N - 1) + psi
  const ripple = (Math.cos(phase) * Math.sin(N * omega)) / (N * Math.sin(omega)) // ← 差異：有限 N 時 cos(2Ωn+ψ) 沒平均乾淨
  return 0.5 * A * A * mag * (Math.cos(phiRad + omega * D) + ripple)
}

/** 有限 N block 的 ripple 上界 (A²|H|/2)·min(1, 1/(N|sinΩ|))（邊界 Ω = 0、π 時為 0） */
export function toneRippleBound(p: { A: number; mag: number; omega: number; N: number }): number {
  if (isToneEdge(p.omega)) return 0
  return 0.5 * p.A * p.A * p.mag * Math.min(1, 1 / (p.N * Math.abs(Math.sin(p.omega))))
}
// #endregion

/**
 * 入門手算表：x[n] = A cos(Ωn)（訊號在 n = 0 之前就存在，所以 x[−1] 用同一公式），
 * u[n] = h0·x[n] + h1·x[n−1]，列出 x·u 與其平均。h 由 toneFir 產生。
 */
export function toneHandTable(p: { A: number; mag: number; phiRad: number; omega: number; rows: number }): {
  h: [number, number]
  n: number[]
  x: number[]
  xPrev: number[]
  u: number[]
  xu: number[]
  mean: number
} {
  const h = toneFir(p.mag, p.phiRad, p.omega)
  const n: number[] = []
  const x: number[] = []
  const xPrev: number[] = []
  const u: number[] = []
  const xu: number[] = []
  let s = 0
  for (let i = 0; i < p.rows; i++) {
    const xi = p.A * Math.cos(p.omega * i)
    const xp = p.A * Math.cos(p.omega * (i - 1))
    const ui = h[0] * xi + h[1] * xp
    n.push(i)
    x.push(xi)
    xPrev.push(xp)
    u.push(ui)
    xu.push(xi * ui)
    s += xi * ui
  }
  return { h, n, x, xPrev, u, xu, mean: s / p.rows }
}

/**
 * 單頻時域驗證：把 x[n] = A cos(Ωn) 實際通過 tonePath 的濾波器，取 n = 0 … length−1 的 x[n−D]·u[n] 平均。
 * 序列從 n = −(D+1) 開始產生，所以 n ≥ 0 時 u 已是穩態（2-tap FIR 只需一個過去值）。
 */
export function toneEmpirical(p: ToneSpec & { length: number }): { C: number; rippleBound: number } {
  const D = p.delay ?? 0
  const off = D + 1
  const path = tonePath(p.mag, p.phiRad, p.omega)
  const xs = new Float64Array(p.length + off)
  for (let i = 0; i < xs.length; i++) xs[i] = p.A * Math.cos(p.omega * (i - off))
  const us = lfilter(path.b, path.a, xs).y
  const C = empiricalCorrelation(xs, us, D, off)
  return { C, rippleBound: toneRippleBound({ A: p.A, mag: p.mag, omega: p.omega, N: p.length }) }
}

// #region core:largeErrorGain
/**
 * 大誤差極限（|δ|·|u| ≫ σ_v）：comparator 幾乎不受雜訊影響，q ≈ sign(δ)·sign(u)，
 * 所以 G → sign(δ)·E[x_D·sign(u)]。單頻時 E[A cos(θ − ψ)·sign(cos θ)] = (2A/π)·cosψ，ψ = φ + ΩD。
 * C_D < 0 時 |δ| 每個 block 線性增加 μ·(2A/π)·|cos(φ + ΩD)|（指數發散之後的線性漂移）。
 */
export function toneLargeErrorGain(A: number, phiRad: number, omega: number, delay = 0): number {
  if (isToneEdge(omega)) return A * Math.sign(Math.cos(phiRad)) * Math.cos(omega * delay) // x、u 都是 ±A 型
  return ((2 * A) / Math.PI) * Math.cos(phiRad + omega * delay)
}

/**
 * Mean-field GMAC 特性（任意大小的 δ；Gaussian comparator 雜訊、w 慢變）：
 *   E[G](δ) = (1/M)·Σ_n x_ref[n]·erf(δ·u[n]/(√2·σ_v))
 * 兩個極限：|δu| ≪ σ_v 時 erf(z) ≈ (2/√π)z ⇒ K_q·δ·C_D（F-06.2）；|δu| ≫ σ_v 時 erf → sign ⇒ sign(δ)·E[x_ref·sign u]（F-06.15）。
 * u 的動態範圍很大的 code（例如鋸齒經 Type-II：跳變後的尖峰 + 很長的小尾巴）要很大的 δ 才會全部飽和，
 * 中間區域必須用這個完整的 erf 平均，不能直接套大誤差極限。
 */
export function meanFieldGmac(xRef: ArrayLike<number>, u: ArrayLike<number>, delta: number, sigmaV: number, skip = 0, maxSamples = 65536): number {
  const hi = Math.min(xRef.length, u.length, skip + maxSamples)
  const k = delta / (Math.SQRT2 * sigmaV)
  let s = 0
  for (let n = skip; n < hi; n++) s += xRef[n] * erf(k * u[n]) // ← 差異：每個 sample 用完整的 erf，不是 K_q·e 也不是 sign(e)
  return hi > skip ? s / (hi - skip) : Number.NaN
}

/**
 * 一般 code 的大誤差增益 E[x_ref·sign(u)]（時域平均，從 skip 開始）。
 * u[n] = 0 的 sample（例如單頻的零交越剛好落在取樣點上）：δ·u = 0，comparator 只看到雜訊，
 * q 為 ±1 各半、平均貢獻 0。數值上 u 可能是 ±1e−16 的捨入殘渣，所以 |u| ≤ zeroTol·max|u| 一律當 0，
 * 否則結果會由浮點捨入的正負號決定（例如 Ω = π/6、φ = 120° 會得到錯誤的 −0.19，而不是 −(2+√3)/12）。
 */
export function empiricalLargeErrorGain(xRef: ArrayLike<number>, u: ArrayLike<number>, skip = 0, zeroTol = 1e-9): number {
  const hi = Math.min(xRef.length, u.length)
  let uMax = 0
  for (let n = skip; n < hi; n++) uMax = Math.max(uMax, Math.abs(u[n]))
  const thr = zeroTol * uMax
  let s = 0
  let m = 0
  for (let n = skip; n < hi; n++) {
    const sg = u[n] > thr ? 1 : u[n] < -thr ? -1 : 0 // ← 差異：u = 0 時由雜訊決定，平均貢獻 0
    s += xRef[n] * sg
    m++
  }
  return m > 0 ? s / m : Number.NaN
}
// #endregion

/** mean-field 特性曲線（meanFieldCurve 的結果） */
export interface MeanFieldCurve {
  /** δ 格點 [fs]（log 等距，0.02σ_v/u_max … 50σ_v/u_max） */
  delta: Float64Array
  /** E[G](δ) = E[x_ref·erf(δu/(√2σ_v))] */
  G: Float64Array
  /** 第一個變號點 δ_c [fs]（與小訊號斜率的符號相比；沒有變號為 null） */
  cross: number | null
}

// #region core:meanFieldCurve
/**
 * 掃描 mean-field 特性 E[G](δ)，並找出它第一次變號的 δ_c（log 二分法）。
 *   C > 0 且有 δ_c：δ = 0 只是「局部」穩定，|δ| > δ_c 之後平均更新方向反過來（basin 有限）；
 *   C < 0 且有 δ_c：遠離 a 之後會停在 |δ| ≈ δ_c（平均動態的非零穩定點），不是無限發散。
 * 單頻（相位等分布）時 E[G](δ) 與 cos(φ + ΩD) 永遠同號，不會有 δ_c；
 * 會變號的是「C 由正負貢獻相消而來」的 code，例如近整數鋸齒經 Type-II（尖峰先飽和，小尾巴仍線性）。
 */
export function meanFieldCurve(
  xRef: ArrayLike<number>,
  u: ArrayLike<number>,
  sigmaV: number,
  opts: { skip?: number; samples?: number; points?: number } = {},
): MeanFieldCurve {
  const skip = opts.skip ?? 0
  const samples = opts.samples ?? 16384
  const points = Math.max(2, opts.points ?? 28)
  const hi = Math.min(xRef.length, u.length, skip + samples)
  let uMax = 0
  for (let n = skip; n < hi; n++) uMax = Math.max(uMax, Math.abs(u[n]))
  const delta = new Float64Array(points)
  const G = new Float64Array(points)
  if (!(uMax > 0) || !(sigmaV > 0)) return { delta, G, cross: null }
  const lo = (0.02 * sigmaV) / uMax
  const span = 50 / 0.02
  const at = (d: number): number => meanFieldGmac(xRef, u, d, sigmaV, skip, samples)
  for (let i = 0; i < points; i++) {
    delta[i] = lo * Math.pow(span, i / (points - 1))
    G[i] = at(delta[i])
  }
  let cross: number | null = null
  const s0 = Math.sign(G[0]) // 小訊號（線性區）的符號 = sign(C)
  if (s0 !== 0) {
    for (let i = 1; i < points; i++) {
      if (Math.sign(G[i]) === s0) continue
      let a = delta[i - 1]
      let b = delta[i]
      for (let it = 0; it < 14; it++) {
        const mid = Math.sqrt(a * b) // log 二分
        if (Math.sign(at(mid)) === s0) a = mid
        else b = mid
      }
      cross = Math.sqrt(a * b)
      break
    }
  }
  return { delta, G, cross }
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// C 的估計方法（§6.2）
// ───────────────────────────────────────────────────────────────────────────

// #region core:empiricalCorrelation
/**
 * 時域經驗值 Ĉ_D = (1/M)·Σ x[n − D]·u[n]，n 從 max(skip, D) 到序列結尾（M 為有效樣本數）。
 * 這就是 GMAC 在「沒有 comparator、沒有雜訊」時的乘積累加平均。
 */
export function empiricalCorrelation(x: ArrayLike<number>, u: ArrayLike<number>, delay = 0, skip = 0): number {
  const lo = Math.max(skip, delay)
  const hi = Math.min(u.length, x.length + delay)
  let s = 0
  for (let n = lo; n < hi; n++) s += x[n - delay] * u[n] // x[n−D]·u[n] 逐點相乘再累加
  return hi > lo ? s / (hi - lo) : Number.NaN
}
// #endregion

// #region core:spectralCorrelation
/**
 * 頻域積分 C_D = (1/2π)∫_{−π}^{π} S_xx(e^{jΩ})·Re{H(e^{jΩ})·e^{jΩD}} dΩ。
 * 實數 x、h ⇒ 被積函數對 Ω 為偶函數，只需半邊格點 0 = Ω_0 < … < Ω_last = π：C_D = (1/π)∫_0^π（梯形法）。
 * @param sxx DTFT 形式雙邊 PSD（σ_x² = (1/2π)∫S_xx dΩ），不是 welch 的 one-sided x²/Hz（E28）
 */
export function spectralCorrelation(p: {
  omega: ArrayLike<number>
  sxx: ArrayLike<number>
  H: ArrayLike<Complex>
  delay?: number
}): number {
  const { omega, sxx, H } = p
  const D = p.delay ?? 0
  if (omega.length < 2 || sxx.length !== omega.length || H.length !== omega.length) {
    throw new Error('spectralCorrelation：omega、sxx、H 必須同長且至少 2 點')
  }
  let acc = 0
  let prev = sxx[0] * reRotated(H[0], omega[0] * D)
  for (let i = 1; i < omega.length; i++) {
    const cur = sxx[i] * reRotated(H[i], omega[i] * D) // S_xx·Re{H e^{jΩD}}
    acc += 0.5 * (prev + cur) * (omega[i] - omega[i - 1]) // 梯形
    prev = cur
  }
  return acc / Math.PI // (1/2π)·2∫_0^π
}
// #endregion

/** 譜線集合：頻率 Ω_m [rad/sample, 0…π] 與每條線的功率 P_m（Σ P_m = 平均功率 E[x²]） */
export interface LineSpectrum {
  omega: Float64Array
  power: Float64Array
}

// #region core:lineCorrelation
/**
 * 譜線和 C_D = Σ_m P_m·Re{H(e^{jΩ_m})·e^{jΩ_m D}}：
 * 一個振幅 A 的實弦波在 Ω_m 貢獻功率 P_m = A²/2，所以單頻公式、鋸齒波、三角波都是這個式子的特例。
 */
export function lineCorrelation(lines: LineSpectrum, H: ArrayLike<Complex>, delay = 0): number {
  let acc = 0
  for (let m = 0; m < lines.omega.length; m++) acc += lines.power[m] * reRotated(H[m], lines.omega[m] * delay)
  return acc
}

/**
 * 週期圖譜線：L 點 DFT X[m]，Ω_m = 2πm/L（m = 0 … ⌊L/2⌋），P_m = w_m·|X[m]|²/L²（w_m = 2 合併 m 與 L−m 的共軛對）。
 * 用 lineCorrelation 加權後，對「循環」濾波與循環延遲是精確恆等式（離散 Parseval）；
 * 與線性濾波的時域值只差 O(h 的有效長度 / L) 的邊緣效應。
 */
export function periodogramLines(x: ArrayLike<number>): LineSpectrum {
  const L = x.length
  const { re, im } = fftReal(x)
  const half = Math.floor(L / 2)
  const omega = new Float64Array(half + 1)
  const power = new Float64Array(half + 1)
  for (let m = 0; m <= half; m++) {
    const w = m === 0 || (L % 2 === 0 && m === half) ? 1 : 2 // 共軛對稱：m 與 L − m 合併
    omega[m] = (2 * Math.PI * m) / L
    power[m] = (w * (re[m] * re[m] + im[m] * im[m])) / (L * L)
  }
  return { omega, power }
}
// #endregion

/** 週期圖加權和（periodogramLines + lineCorrelation 的便利包裝） */
export function periodogramCorrelation(x: ArrayLike<number>, tf: TransferBA, delay = 0): number {
  const lines = periodogramLines(x)
  return lineCorrelation(lines, freqz(tf.b, tf.a, lines.omega), delay)
}

// #region core:autocorrCorrelation
/**
 * C_D = Σ_k h[k]·R_x[k − D]：把 u[n] = Σ_k h[k]x[n−k] 代入 E[x[n−D]·u[n]]，逐項取期望值。
 * @param h 脈衝響應（IIR 時截斷到衰減到可忽略）
 * @param rx 自相關 R_x[ℓ] = E[x[n]·x[n+ℓ]]（偶函數）
 */
export function autocorrCorrelation(h: ArrayLike<number>, rx: (lag: number) => number, delay = 0): number {
  let s = 0
  for (let k = 0; k < h.length; k++) s += h[k] * rx(k - delay)
  return s
}
// #endregion

/**
 * 理想鋸齒波（峰對峰 1，例如一階 DSM residue）的譜線：Ω_k = kΩ0，P_k = 1/(2π²k²)，Σ P_k = 1/12。
 * 注意：功率只以 1/k² 衰減，截斷在 kmax 會漏掉 ≈ 1/(2π²kmax) 的尾巴（Re{H} ≈ +1 的高頻）。
 * 近整數（Ω0 很小）時這個誤差比 C 本身還大、甚至讓符號算錯——精確值請用 sawtoothCorrelation。
 */
export function sawtoothLines(omega0: number, kmax = 4000): LineSpectrum {
  const omega = new Float64Array(kmax)
  const power = new Float64Array(kmax)
  for (let k = 1; k <= kmax; k++) {
    omega[k - 1] = k * omega0
    power[k - 1] = 1 / (2 * Math.PI * Math.PI * k * k)
  }
  return { omega, power }
}

/** 三角波（峰值 ±1）的譜線：只有奇數 k，P_k = 32/(π⁴k⁴)，Σ P_k = 1/3 */
export function triangleLines(omega0: number, kmax = 2001): LineSpectrum {
  const n = Math.floor((kmax + 1) / 2)
  const omega = new Float64Array(n)
  const power = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const k = 2 * i + 1
    omega[i] = k * omega0
    power[i] = 32 / (Math.PI ** 4 * k ** 4)
  }
  return { omega, power }
}

/** 譜線總功率 Σ P_m */
export function linePower(lines: LineSpectrum): number {
  let s = 0
  for (let i = 0; i < lines.power.length; i++) s += lines.power[i]
  return s
}

// #region core:sawtoothAutocorr
/**
 * 理想鋸齒 code（峰對峰 1、相位等分布；一階 DSM residue）的正規化自相關：
 *   R_x[ℓ]/σ_x² = 1 − 6·t·(1 − t)，t = frac(|ℓ|·frac) ∈ [0, 1)，σ_x² = 1/12
 * （由 ∫_0^1 (θ − ½)(frac(θ + t) − ½) dθ = 1/12 − t(1 − t)/2 直接積分而來；即 Bernoulli 多項式 B₂(t)/2）。
 * 搭配 autocorrCorrelation：C_D/σ_x² = Σ_k h[k]·R_x[k − D]/σ_x²——不需要截斷譜線，近整數時仍精確。
 *
 * 有限相位格點（period = P）：B-bit 累加器的相位只取 P = 2^B/gcd(K, 2^B) 個等距值 j/P。
 * 對 j 直接求和可得 R_x[ℓ] = (P² − 1)/(12P²) − t(1 − t)/2，所以
 *   R_x[ℓ]/σ_x² = 1 − 6·t·(1 − t)·P²/(P² − 1)，σ_x² = (P² − 1)/(12P²)（P → ∞ 回到上式）。
 * 例：frac = 0.25 ⇒ P = 4，R[1]/σ² = 1 − 6·(3/16)·(16/15) = −0.2（連續相位公式會給 −0.125）。
 */
export function sawtoothAutocorr(frac: number, period = Number.POSITIVE_INFINITY): (lag: number) => number {
  const c = Number.isFinite(period) && period > 1 ? (period * period) / (period * period - 1) : 1 // ← 差異：有限格點的修正 P²/(P² − 1)
  return (lag: number): number => {
    const t = (Math.abs(lag) * frac) % 1 // 相隔 |ℓ| 個 sample 的鋸齒相位差（以週期為單位）
    return 1 - 6 * c * t * (1 - t)
  }
}

/**
 * 脈衝響應的前三個動差 m_j = Σ_k k^j·h[k]（j = 0, 1, 2）。
 * 與頻率響應的泰勒係數對應：H(e^{jΩ}) = m₀ − jΩ·m₁ − (Ω²/2)·m₂ + …
 *   Type-II DPLL：m₀ = m₁ = 0（DC 雙重零點），m₂ = 2/K_i；Type-I：m₀ = 0，m₁ = −1/K。
 */
export function impulseMoments(h: ArrayLike<number>): [number, number, number] {
  let m0 = 0
  let m1 = 0
  let m2 = 0
  for (let k = 0; k < h.length; k++) {
    m0 += h[k]
    m1 += k * h[k]
    m2 += k * k * h[k]
  }
  return [m0, m1, m2]
}

/**
 * 近整數鋸齒的動差展開（含 GMAC code delay D）。|k − D|·frac < 1（h 衰減前鋸齒不折返）時精確到 frac²：
 *   C_D/σ_x² ≈ Σh[k] − 6·frac·Σh[k]·|k − D| + 6·frac²·Σh[k]·(k − D)²
 * Type-II（m₀ = m₁ = 0、m₂ = 2/K_i）：≈ −12·frac·Σ_{k<D} h[k](D − k) + 12·frac²/K_i
 * ⇒ D = 0 時只剩正的二階項；D ≥ 1 時一階項為負，frac < K_i·D 就變號。
 */
export function sawtoothMomentApprox(h: ArrayLike<number>, frac: number, delay = 0): number {
  let a0 = 0
  let a1 = 0
  let a2 = 0
  for (let k = 0; k < h.length; k++) {
    const l = k - delay
    a0 += h[k]
    a1 += h[k] * Math.abs(l) // ← 差異：|k − D| 的折角來自鋸齒的折返跳變
    a2 += h[k] * l * l
  }
  return a0 - 6 * frac * a1 + 6 * frac * frac * a2
}
// #endregion

// #region core:dsmPhaseGrid
export interface DsmPhaseGrid {
  /** FCW 整數碼 K = round(frac·2^bits) 與量化後的 frac = K/2^bits */
  K: number
  fracEff: number
  /** 真實週期 P = 2^bits/gcd(K, 2^bits)（K = 0 時為 1） */
  period: number
  /** 給 sawtoothAutocorr 的等效格點數（∞ = 相位等分布） */
  effective: number
  /** 'exact'：紀錄涵蓋完整週期；'clustered'：紀錄內相位只在 q 個群集附近；'uniform'：近似等分布 */
  regime: 'exact' | 'clustered' | 'uniform'
  /** clustered 時的小分母 q 與群集寬度 w = L·|frac − p/q|（單位：週期）；其他情況為 0 */
  q: number
  spread: number
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/**
 * 一階 DSM residue 在「長度 L 的紀錄」內實際走過的相位格點（決定時間平均該用哪個鋸齒自相關）：
 *   1. P ≤ L：紀錄涵蓋整數個完整週期（P 與 L 都是 2 的冪）⇒ 精確用 P。
 *   2. P > L，但 frac 很接近小分母分數 p/q：L 個 sample 內相位只在 q 個格點附近各漂移 w = L·|frac − p/q| < 1/q，
 *      相位變異數 = (1 − 1/q² + w²)/12，而 R = σ² − t(1 − t)/2 的形式不變 ⇒ 等效 P_eff = 1/√(1/q² − w²)。  [近似]
 *   3. 其他：相位近似等分布 ⇒ P_eff = ∞。                                                              [近似]
 */
export function dsmPhaseGrid(frac: number, bits: number, length: number, qMax = 32): DsmPhaseGrid {
  const { K, M, fracEff } = quantizeFcw(frac, bits, false)
  const period = K === 0 ? 1 : M / gcdInt(K, M)
  if (period <= length) return { K, fracEff, period, effective: period, regime: 'exact', q: 0, spread: 0 }
  for (let q = 2; q <= qMax; q++) {
    const w = length * Math.abs(fracEff - Math.round(fracEff * q) / q) // 紀錄內每個群集的相位漂移量
    if (w * q < 1) {
      return { K, fracEff, period, effective: 1 / Math.sqrt(1 / (q * q) - w * w), regime: 'clustered', q, spread: w }
    }
  }
  return { K, fracEff, period, effective: Number.POSITIVE_INFINITY, regime: 'uniform', q: 0, spread: 0 }
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 主 PLL 的 H_PD（§6.1：Type-I / Type-II；E44：CT 原型與 DT 模型）
// ───────────────────────────────────────────────────────────────────────────

// #region core:ctHpd
/**
 * CT 參考原型 H_PD(jω) = 1/(1 + L(jω)) 的封閉式；ν = ω/ω_L（Type-I：ω_L = ω_c；Type-II：ω_L = ω_n）。
 *   Type-I ：H = jν/(1 + jν)          ⇒ Re = ν²/(1 + ν²) > 0，Im = ν/(1 + ν²)
 *   Type-II：H = −ν²/(1 − ν² + j2ζν)  ⇒ Re = −ν²(1 − ν²)/Δ，Im = 2ζν³/Δ，Δ = (1 − ν²)² + (2ζν)² > 0
 */
export function ctHpd(type: LoopType, nu: number, zeta = 0.7): Complex {
  if (type === 'typeI') {
    const den = 1 + nu * nu
    return { re: (nu * nu) / den, im: nu / den } // Re > 0：只會變慢，不會變號
  }
  const a = 1 - nu * nu
  const b = 2 * zeta * nu
  const den = a * a + b * b
  return { re: (-nu * nu * a) / den, im: (nu * nu * b) / den } // ← 差異：Re < 0 ⇔ ν < 1（ω < ω_n）
}
// #endregion

/**
 * 由 CT 原型 T(s) 的 −3 dB 頻寬比 BW/f_ref 換算迴路特徵頻率 ω_L·T_s [rad/sample]（T_s = 1/f_ref = 1/f_s）：
 *   Type-I ：T = ω_c/(s + ω_c)，−3 dB 恰在 ω_c ⇒ ω_cT_s = 2π·BW/f_ref
 *   Type-II：ω_3dB = ω_n·√(1 + 2ζ² + √((1 + 2ζ²)² + 1))（pll.ts ctBandwidth3dB）
 */
export function loopFreqFromBw(type: LoopType, bwRatio: number, zeta: number): number {
  const w3 = 2 * Math.PI * bwRatio
  return type === 'typeI' ? w3 : w3 / ctBandwidth3dB({ zeta, wn: 1 })
}

// #region core:dtTypeI
/**
 * Type-I DPLL：L(z) = K·z^{−(1+d)}/(1 − z⁻¹)，K = ω_cT_s，d = 額外 loop latency [samples]。
 * H_PD = 1/(1 + L) = (1 − z⁻¹) / [(1 − z⁻¹) + K·z^{−(1+d)}]（z⁻¹ 升冪係數）。
 */
export function dtTypeICoeffs(wcTs: number, d = 0): TransferBA {
  const n = Math.max(2, d + 2)
  const b = new Array<number>(n).fill(0)
  b[0] = 1
  b[1] = -1 // (1 − z⁻¹)：只有 DCO 一個積分器
  const a = b.slice() // 分母 = (1 − z⁻¹) + K·z^{−(1+d)}
  a[d + 1] += wcTs // ← 差異：迴路濾波器只是比例增益 K
  return { b, a }
}
// #endregion

// #region core:dtTypeII
/**
 * Type-II DPLL（E44）：L(z) = (K_p + K_i/(1 − z⁻¹))·z^{−(1+d)}/(1 − z⁻¹)，K_p = 2ζω_nT_s、K_i = (ω_nT_s)²。
 * H_PD = (1 − z⁻¹)² / [(1 − z⁻¹)² + ((K_p + K_i) − K_p·z⁻¹)·z^{−(1+d)}]。
 */
export function dtTypeIICoeffs(wnTs: number, zeta: number, d = 0): TransferBA {
  const Kp = 2 * zeta * wnTs
  const Ki = wnTs * wnTs
  const n = Math.max(3, d + 3)
  const b = new Array<number>(n).fill(0)
  b[0] = 1
  b[1] = -2
  b[2] = 1 // (1 − z⁻¹)²：PI 的積分器 + DCO 的積分器
  const a = b.slice()
  a[d + 1] += Kp + Ki // ← 差異：PI 濾波器 (K_p + K_i) − K_p·z⁻¹（多一個積分器）
  a[d + 2] -= Kp
  return { b, a }
}
// #endregion

// #region core:lowFreqRe
/**
 * 低頻展開 Re{H_PD(e^{jΩ})} ≈ κ·(Ω/ω_L T_s)²（Ω → 0）：
 *   Type-II：κ = −1（兩個積分器 ⇒ u ≈ x''/ω_n²，與 latency d 無關）
 *   Type-I ：κ = 1 − K·(d + ½)，K = ω_cT_s（latency 夠大、K(d + ½) > 1 時 Type-I 也會在低頻變號）
 */
export function lowFreqReCoef(type: LoopType, wLTs: number, d = 0): number {
  return type === 'typeII' ? -1 : 1 - wLTs * (d + 0.5)
}
// #endregion

export interface PolarityLoopSpec {
  type: LoopType
  zeta: number
  /** CT 原型 T(s) 的 −3 dB 頻寬比 BW/f_ref；與 wLTs 擇一 */
  bwRatio?: number
  /** ω_L T_s [rad/sample]（Type-I 為 ω_cT_s、Type-II 為 ω_nT_s）；與 bwRatio 擇一 */
  wLTs?: number
  loopDelay?: number
}

export interface PolarityLoopDesign extends TransferBA {
  type: LoopType
  zeta: number
  loopDelay: number
  /** ω_L T_s [rad/sample] */
  wLTs: number
  bwRatio: number
  /** Type-II 的 K_p、K_i（Type-I 為 NaN） */
  Kp: number
  Ki: number
  /** Type-I 的 K = ω_cT_s（Type-II 為 NaN） */
  gainK: number
  /** 1 + L(z) = 0 的根（z 平面） */
  poles: Complex[]
  spectralRadius: number
  stable: boolean
  /** 低頻係數 κ：Re{H} ≈ κ(Ω/ω_LT_s)² */
  lowFreqCoef: number
  /** Type-I 的臨界增益 2 sin(π/(4d+2))（與 §8.3 同一特徵方程）；Type-II 為 NaN */
  criticalGain: number
  warnings: string[]
}

/** 設計 Type-I / Type-II DPLL 的 H_PD（可 structured clone）。 */
export function designPolarityLoop(spec: PolarityLoopSpec): PolarityLoopDesign {
  const d = spec.loopDelay ?? 0
  if (!Number.isInteger(d) || d < 0) throw new Error(`loop latency d 必須為非負整數，收到 ${d}`)
  if (!(spec.zeta > 0) || !Number.isFinite(spec.zeta)) throw new Error(`ζ 必須為正有限數，收到 ${spec.zeta}`)
  const wLTs = spec.wLTs ?? loopFreqFromBw(spec.type, spec.bwRatio ?? Number.NaN, spec.zeta)
  if (!(wLTs > 0) || !Number.isFinite(wLTs)) throw new Error(`ω_L T_s 必須為正有限數，收到 ${wLTs}`)
  const bwRatio = spec.bwRatio ?? (spec.type === 'typeI' ? wLTs : wLTs * ctBandwidth3dB({ zeta: spec.zeta, wn: 1 })) / (2 * Math.PI)
  const tf = spec.type === 'typeI' ? dtTypeICoeffs(wLTs, d) : dtTypeIICoeffs(wLTs, spec.zeta, d)
  let m = tf.a.length
  while (m > 1 && tf.a[m - 1] === 0) m--
  const poles = polyRoots(tf.a.slice(0, m))
  const spectralRadius = poles.reduce((acc, z) => Math.max(acc, cAbs(z)), 0)
  const stable = spectralRadius < 1
  const warnings: string[] = []
  const criticalGain = spec.type === 'typeI' ? 2 * Math.sin(Math.PI / (4 * d + 2)) : Number.NaN
  if (!stable) {
    warnings.push(
      `主 PLL 線性化模型不穩定：closed-loop pole 半徑 ${spectralRadius.toPrecision(5)} ≥ 1（ω_LT_s = ${wLTs.toPrecision(4)}、d = ${d}）。` +
        (spec.type === 'typeI' ? `Type-I 需 K = ω_cT_s < 2sin(π/(4d+2)) = ${criticalGain.toPrecision(4)}。` : '請降低頻寬或 loop latency。') +
        '不穩定時 H_PD 沒有意義，C 與極性結論都不成立。',
    )
  }
  if (wLTs > 0.3) {
    warnings.push(`ω_LT_s = ${wLTs.toPrecision(3)} 不夠小：DT 迴路與 CT 原型（K_p = 2ζω_nT_s、K_i = (ω_nT_s)²）的對應明顯失準（E44）。`)
  }
  return {
    ...tf,
    type: spec.type,
    zeta: spec.zeta,
    loopDelay: d,
    wLTs,
    bwRatio,
    Kp: spec.type === 'typeII' ? 2 * spec.zeta * wLTs : Number.NaN,
    Ki: spec.type === 'typeII' ? wLTs * wLTs : Number.NaN,
    gainK: spec.type === 'typeI' ? wLTs : Number.NaN,
    poles,
    spectralRadius,
    stable,
    lowFreqCoef: lowFreqReCoef(spec.type, wLTs, d),
    criticalGain,
    warnings,
  }
}

export interface SignBands {
  /** Re{H} = 0 的頻率 [rad/sample]（由小到大） */
  crossings: number[]
  /** Re{H} < 0 的區間 [Ω_lo, Ω_hi]（極性會反轉的頻帶） */
  negative: [number, number][]
}

// #region core:reSignBands
/**
 * 掃描 Re{H(e^{jΩ})} 的正負號：先在格點上找變號，再用二分法把每個交點精修（60 次 ⇒ 區間縮小 2⁶⁰ 倍）。
 * 回傳所有交點與 Re < 0 的頻帶。lo 必須 > 0（Type-II 在 Ω = 0 時 H = 0）。
 */
export function reSignBands(tf: TransferBA, opts: { lo: number; hi: number; points?: number; log?: boolean }): SignBands {
  const n = opts.points ?? 2048
  const { lo, hi } = opts
  const reAt = (w: number): number => freqz(tf.b, tf.a, [w])[0].re
  const grid = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    grid[i] = opts.log ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t
  }
  const neg = (v: number): boolean => v < 0
  const crossings: number[] = []
  let prevW = grid[0]
  let prevV = reAt(prevW)
  const startNeg = neg(prevV)
  for (let i = 1; i < n; i++) {
    const w = grid[i]
    const v = reAt(w)
    if (neg(v) !== neg(prevV)) {
      let a = prevW
      let b = w
      const sa = neg(prevV)
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (a + b)
        if (neg(reAt(mid)) === sa) a = mid
        else b = mid
      }
      crossings.push(0.5 * (a + b)) // 變號點
    }
    prevW = w
    prevV = v
  }
  const negative: [number, number][] = []
  let inNeg = startNeg
  let start = lo
  for (const c of crossings) {
    if (inNeg) negative.push([start, c])
    inNeg = !inNeg
    start = c
  }
  if (inNeg) negative.push([start, hi])
  return { crossings, negative }
}
// #endregion

// #region core:calPole
/**
 * 平均更新 pole（block rate、average-mode GMAC、無更新延遲）：
 *   E[δ_{k+1}] = (1 − μK_qC)·E[δ_k] ⇒ p = 1 − μK_qC。
 * C > 0：0 < μ < 2/(K_qC) 時 |p| < 1；C = 0：p = 1（沒有恢復力）；C < 0：任何 μ > 0 都 p > 1。
 */
export function calPole(mu: number, Kq: number, C: number): number {
  return 1 - mu * Kq * C
}

/** 平均收斂的 μ 範圍 (0, 2/(K_qC))；C ≤ 0 時不存在（回傳 null） */
export function stableMuRange(Kq: number, C: number): [number, number] | null {
  return C > 0 && Kq > 0 ? [0, 2 / (Kq * C)] : null
}
// #endregion

export type PolarityClass = 'positive' | 'zero' | 'negative'

/** 以相對容忍度判斷 C 的正負（scale 為參考大小，例如 σ_x²·max|H|） */
export function classifyPolarity(C: number, scale: number, relTol = 1e-3): PolarityClass {
  const tol = relTol * Math.abs(scale)
  if (C > tol) return 'positive'
  if (C < -tol) return 'negative'
  return 'zero'
}

/** §8.1 單頻 polarity margin M = 90° − |wrap180(θ)| [deg]（θ = φ + ΩD） */
export function polarityMarginDeg(thetaDeg: number): number {
  let w = (thetaDeg + 180) % 360
  if (w <= 0) w += 360
  return 90 - Math.abs(w - 180)
}

// ───────────────────────────────────────────────────────────────────────────
// Code 產生（與 blockLms 完全相同的序列）
// ───────────────────────────────────────────────────────────────────────────

export interface PolarityCodeSpec {
  kind: PolarityCodeKind
  /** tone：Ω [rad/sample] */
  omega?: number
  /** tone 振幅（normalization = 'none' 時有意義） */
  amplitude?: number
  /** DSM / 三角波：FCW 小數 frac（三角波週期 1/frac） */
  frac?: number
  /** DSM 累加器位元數（預設 20） */
  bits?: number
  normalization: 'none' | 'standardize'
}

/** blockLms 的 seeded_pattern（三角波不支援，回傳 null） */
export function blockLmsPattern(spec: PolarityCodeSpec): BlockLmsConfigInput['seeded_pattern'] | null {
  switch (spec.kind) {
    case 'tone':
      return { kind: 'sinusoid', parameters: { amplitude: spec.amplitude ?? 1, omega: spec.omega ?? Math.PI / 6, phase_deg: 0 } }
    case 'dsm1':
      return { kind: 'dsm_first_order', parameters: { frac: spec.frac ?? 0.3, bits: spec.bits ?? 20, dither: false, signal: 'residue' } }
    case 'mash':
      return { kind: 'mash111', parameters: { frac: spec.frac ?? 0.3, bits: spec.bits ?? 20, dither: false, signal: 'residue' } }
    case 'iid':
      return { kind: 'iid_pm_one', parameters: { amplitude: 1 } }
    case 'triangle':
      return null
  }
}

/**
 * 產生 code（同 seed、同 spec 與 blockLms 的 generateCodePattern 完全相同；三角波為確定性序列）。
 * normalization = 'standardize'：減平均、除以標準差（E[x] = 0、E[x²] = 1），統計量取自整段 length。
 */
export function generatePolarityCode(spec: PolarityCodeSpec, length: number, seed: number): Float64Array {
  if (!Number.isInteger(length) || length < 2) throw new Error(`code 長度必須為 ≥ 2 的整數，收到 ${length}`)
  const pattern = blockLmsPattern(spec)
  if (pattern) {
    return generateCodePattern({ pattern, length, seed, normalization: spec.normalization }).code
  }
  // 三角波：x[n] = 1 − 4·|((frac·n + ¼) mod 1) − ½|，峰值 ±1、週期 1/frac
  const f = spec.frac ?? 0.01
  const x = new Float64Array(length)
  for (let n = 0; n < length; n++) {
    const ph = (f * n + 0.25) % 1
    x[n] = 1 - 4 * Math.abs(ph - 0.5)
  }
  if (spec.normalization === 'standardize') standardizeInPlace(x)
  return x
}

function standardizeInPlace(x: Float64Array): void {
  let m = 0
  for (let i = 0; i < x.length; i++) m += x[i]
  m /= x.length
  let v = 0
  for (let i = 0; i < x.length; i++) v += (x[i] - m) ** 2
  const sd = Math.sqrt(v / x.length)
  const sc = sd > 0 ? 1 / sd : 1
  for (let i = 0; i < x.length; i++) x[i] = (x[i] - m) * sc
}

function meanSquare(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return s / x.length
}

// ───────────────────────────────────────────────────────────────────────────
// 實驗參數（Polarity Explorer；可 structured clone）
// ───────────────────────────────────────────────────────────────────────────

export type ExplorerMode = 'tone' | 'pll'

/** Polarity Explorer 的一組參數（A/B/C case 各一份） */
export interface PolarityParams {
  mode: ExplorerMode
  // ── 單頻模式 ──
  /** |H| */
  mag: number
  /** φ [deg] */
  phiDeg: number
  /** Ω [rad/sample] */
  omega: number
  /** 單頻 code 振幅 A */
  A: number
  // ── 共用 ──
  /** GMAC code delay D [samples] */
  D: number
  // ── PLL 模式 ──
  loopType: LoopType
  zeta: number
  /** BW/f_ref（CT 原型 T 的 −3 dB） */
  bwRatio: number
  /** 額外 loop latency d [samples] */
  loopDelay: number
  code: Exclude<PolarityCodeKind, 'triangle'>
  /** tone code 的 Ω/ω_LT_s */
  toneRatio: number
  /** DSM FCW 小數 */
  frac: number
  // ── GMAC / 閉迴路 ──
  /** gain_step μ [fs] */
  mu: number
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** GMAC block 長度 N [samples] */
  N: number
  blocks: number
  /** 真實 gain a [fs] */
  a: number
  /** 初值 w_0 [fs] */
  w0: number
  regressor: RegressorMode
}

export const DEFAULT_POLARITY_PARAMS: PolarityParams = {
  mode: 'tone',
  mag: 1,
  phiDeg: 120,
  omega: Math.PI / 6,
  A: 1,
  D: 0,
  loopType: 'typeII',
  zeta: 0.7,
  bwRatio: 0.01,
  loopDelay: 0,
  code: 'tone',
  toneRatio: 0.3,
  frac: 0.01,
  mu: 10,
  sigmaV: 100,
  N: 1024,
  blocks: 400,
  a: 3,
  w0: 0,
  regressor: 'x',
}

/** 由參數決定 error path 與 code（兩種模式共用，main thread 與 worker 都用這個函式） */
export function pathAndCode(p: PolarityParams): {
  path: TransferBA
  code: PolarityCodeSpec
  design: PolarityLoopDesign | null
  phiEffRad: number
  edge: boolean
  omegaCode: number | null
} {
  if (p.mode === 'tone') {
    const tp = tonePath(p.mag, (p.phiDeg * Math.PI) / 180, p.omega)
    return {
      path: { b: tp.b, a: tp.a },
      code: { kind: 'tone', omega: p.omega, amplitude: p.A, normalization: 'none' },
      design: null,
      phiEffRad: tp.phiEffRad,
      edge: tp.edge,
      omegaCode: p.omega,
    }
  }
  const design = designPolarityLoop({ type: p.loopType, zeta: p.zeta, bwRatio: p.bwRatio, loopDelay: Math.max(0, Math.round(p.loopDelay)) })
  const omegaCode = p.code === 'tone' ? Math.min(Math.PI, p.toneRatio * design.wLTs) : null
  return {
    path: { b: design.b, a: design.a },
    code: { kind: p.code, omega: omegaCode ?? undefined, amplitude: 1, frac: p.frac, normalization: 'standardize' },
    design,
    phiEffRad: Number.NaN,
    edge: false,
    omegaCode,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PLL 模式分析 (worker)
// ───────────────────────────────────────────────────────────────────────────

export interface PllPolarityParams {
  loopType: LoopType
  zeta: number
  bwRatio: number
  loopDelay: number
  code: Exclude<PolarityCodeKind, 'triangle'>
  toneRatio: number
  frac: number
  /** GMAC code delay D [samples] */
  D: number
  /** C_D vs D 的最大 D（預設 48） */
  delayMax?: number
  seed: number
  /** 分析長度下限（預設 2^16；低頻 code 會自動加長，上限 2^19） */
  minLength?: number
}

export interface PllPolarityResult {
  design: PolarityLoopDesign
  omegaTone: number | null
  /** 頻率格點（log）上的 DT 與 CT 響應 */
  grid: {
    omega: Float64Array
    re: Float64Array
    im: Float64Array
    magDb: Float64Array
    phaseDeg: Float64Array
    ctRe: Float64Array
    ctPhaseDeg: Float64Array
  }
  bands: SignBands
  /** Welch PSD 轉成 DTFT 雙邊形式 S_xx(e^{jΩ})（σ² = (1/π)∫_0^π S dΩ） */
  psd: { omega: Float64Array; sxx: Float64Array; nperseg: number; nSegments: number; enbwBins: number }
  C: {
    sigma2: number
    empirical: number
    periodogram: number
    welch: number
    autocorr: number
    /** filtered-x（Ĥ = H）時 GMAC 的有效相關 E[u[n−D]·u[n]]（時域） */
    filtered: number
    /** 封閉式（tone：σ²Re{H e^{jΩD}}；iid：h[D]σ²）；其他 code 為 null */
    theory: number | null
    theoryLabel: string
  }
  CD: { D: Float64Array; empirical: Float64Array; periodogram: Float64Array; theory: Float64Array | null; filtered: Float64Array }
  wave: { n: Float64Array; x: Float64Array; u: Float64Array }
  largeErrorGain: number
  length: number
  skip: number
  impulseLength: number
  warnings: string[]
}

/** 分析長度：低頻 code 至少涵蓋 ~16 個週期（上限 2^19） */
function analysisLength(minLen: number, periodSamples: number | null): number {
  const want = periodSamples !== null && Number.isFinite(periodSamples) ? nextPow2(Math.ceil(16 * periodSamples)) : 0
  return Math.min(2 ** 19, Math.max(minLen, want))
}

/** 暫態長度：|pole|^n 衰減到 e^{−12} ≈ 6e−6 */
function transientSamples(rho: number): number {
  if (!(rho < 1)) return 4096
  const ln = -Math.log(Math.max(rho, 1e-12))
  return Math.min(2 ** 17, Math.max(256, Math.ceil(12 / ln)))
}

/**
 * (worker) PLL 模式的完整極性分析：設計 DT 迴路、產生 code、計算 u = H_PD{x}，
 * 以四種方法估計 C_D 並交叉比對，另附 H_PD 頻率響應、Re{H} 負頻帶、code PSD 與波形。
 */
export function analyzePllPolarity(p: PllPolarityParams): PllPolarityResult {
  const design = designPolarityLoop({ type: p.loopType, zeta: p.zeta, bwRatio: p.bwRatio, loopDelay: p.loopDelay })
  if (!design.stable) throw new Error(design.warnings[0] ?? '主 PLL 線性化模型不穩定：H_PD 沒有意義')
  const warnings = design.warnings.slice()
  const wL = design.wLTs
  const omegaTone = p.code === 'tone' ? Math.min(Math.PI, p.toneRatio * wL) : null
  const D = Math.max(0, Math.round(p.D))
  const period = omegaTone !== null ? (2 * Math.PI) / omegaTone : p.code === 'dsm1' || p.code === 'mash' ? 1 / Math.max(p.frac, 1e-9) : null
  const L = analysisLength(p.minLength ?? 2 ** 16, period)
  const skip = transientSamples(design.spectralRadius)
  const code: PolarityCodeSpec = { kind: p.code, omega: omegaTone ?? undefined, amplitude: 1, frac: p.frac, normalization: 'standardize' }
  if (p.code === 'tone' && omegaTone !== null && isToneEdge(omegaTone)) {
    warnings.push('tone 的 Ω 落在 π（Nyquist）：此時 x 為 ±1 交替序列，E46 的 2 倍公式以 σ_x² 表示仍為 C = σ_x²·H(e^{jπ})。')
  }
  const xAll = generatePolarityCode(code, skip + L, p.seed)
  const uAll = lfilter(design.b, design.a, xAll).y
  const xs = xAll.subarray(skip)
  const us = uAll.subarray(skip)
  const sigma2 = meanSquare(xs)

  // ── 四種估計 ──
  const empirical = empiricalCorrelation(xAll, uAll, D, skip)
  const lines = periodogramLines(xs)
  const Hlines = freqz(design.b, design.a, lines.omega)
  const periodogram = lineCorrelation(lines, Hlines, D)
  const nperseg = Math.min(L, Math.max(4096, period !== null ? nextPow2(Math.ceil(4 * period)) : 4096), 2 ** 16)
  const wr = welch(xs, 1, { nperseg, window: 'hann', detrend: 'constant' })
  const wOmega = new Float64Array(wr.f.length)
  const sxx = new Float64Array(wr.f.length)
  const last = wr.f.length - 1
  for (let i = 0; i < wr.f.length; i++) {
    wOmega[i] = 2 * Math.PI * wr.f[i]
    // one-sided（DC、Nyquist 不加倍）→ DTFT 雙邊密度（fs = 1）：內部 bin 除以 2
    sxx[i] = i === 0 || (i === last && nperseg % 2 === 0) ? wr.psd[i] : wr.psd[i] / 2
  }
  const welchC = spectralCorrelation({ omega: wOmega, sxx, H: freqz(design.b, design.a, wOmega), delay: D })
  const impulseLength = Math.min(Math.floor(L / 2), Math.max(64, skip))
  const h = impulseResponse(design.b, design.a, impulseLength)
  const maxLag = Math.max(impulseLength, D) + 1
  const xc = xcorr(xs, xs, maxLag, { method: 'fft' })
  const rx = (lag: number): number => xc.values[lag + maxLag]
  const autocorr = autocorrCorrelation(h, rx, D)

  let theory: number | null = null
  let sawFrac = Number.NaN
  let sawPeriod = Number.POSITIVE_INFINITY
  let hSaw: Float64Array = h
  let theoryLabel = '—（此 code 沒有封閉式；以四種數值方法互相驗證）'
  if (p.code === 'tone' && omegaTone !== null) {
    const H0 = freqz(design.b, design.a, [omegaTone])[0]
    theory = sigma2 * reRotated(H0, omegaTone * D)
    theoryLabel = 'σ_x²·Re{H(e^{jΩ₀})e^{jΩ₀D}}（單頻封閉式）'
  } else if (p.code === 'iid') {
    const hD = impulseResponse(design.b, design.a, D + 1)[D]
    theory = hD * sigma2
    theoryLabel = 'h[D]·σ_x²（白色 code；D = 0 時 h[0] = 1 ⇒ C = σ_x²，E44）'
  } else if (p.code === 'dsm1') {
    const grid = dsmPhaseGrid(p.frac, 20, L)
    sawFrac = grid.fracEff
    sawPeriod = grid.effective
    hSaw = impulseResponse(design.b, design.a, Math.min(2 ** 19, 3 * skip)) // 尾巴衰減到 e^{−36}
    theory = sigma2 * autocorrCorrelation(hSaw, sawtoothAutocorr(sawFrac, sawPeriod), D)
    theoryLabel =
      grid.regime === 'exact'
        ? `σ_x²·Σh[k](1 − 6c·t(1 − t))，c = P²/(P² − 1)、P = ${grid.period}（DSM 的真實週期；紀錄涵蓋完整週期，精確）`
        : grid.regime === 'clustered'
          ? `σ_x²·Σh[k](1 − 6c·t(1 − t))，c = ${(sawPeriod ** 2 / (sawPeriod ** 2 - 1)).toPrecision(4)}（frac ≈ p/${grid.q}：分析長度內相位只在 ${grid.q} 個群集附近，近似）`
          : 'σ_x²·Σh[k](1 − 6t(1 − t))（理想鋸齒、相位近似等分布；t = frac(|k − D|·frac)）'
    if (grid.regime === 'clustered' && grid.q <= 7) {
      // q ≥ 8 時修正量 1/q² < 1.6%，只默默套用、不另外警告
      warnings.push(
        `frac = ${sawFrac.toPrecision(7)} 很接近 p/${grid.q}：DSM 的真實週期 ${grid.period} > 分析長度 ${L}，這段紀錄內相位只在 ${grid.q} 個格點附近（各漂移 ${grid.spread.toPrecision(2)} 個週期），時間平均不是「相位等分布」的值；封閉式已改用等效格點數（近似）。`,
      )
    }
  }

  // ── C_D vs D ──
  const dMax = Math.max(1, Math.round(p.delayMax ?? 48))
  const CDd = new Float64Array(dMax + 1)
  const CDe = new Float64Array(dMax + 1)
  const CDp = new Float64Array(dMax + 1)
  const CDf = new Float64Array(dMax + 1)
  let CDt: Float64Array | null = null
  if (p.code === 'tone' && omegaTone !== null) CDt = new Float64Array(dMax + 1)
  const hTheory = p.code === 'iid' ? impulseResponse(design.b, design.a, dMax + 1) : null
  if (hTheory || p.code === 'dsm1') CDt = new Float64Array(dMax + 1)
  const sawR = p.code === 'dsm1' ? sawtoothAutocorr(sawFrac, sawPeriod) : null
  const H0t = omegaTone !== null ? freqz(design.b, design.a, [omegaTone])[0] : null
  for (let d = 0; d <= dMax; d++) {
    CDd[d] = d
    CDe[d] = empiricalCorrelation(xAll, uAll, d, skip)
    CDp[d] = lineCorrelation(lines, Hlines, d)
    CDf[d] = empiricalCorrelation(uAll, uAll, d, skip) // filtered-x：E[u[n−d]·u[n]] = R_u[d]
    if (CDt && H0t && omegaTone !== null) CDt[d] = sigma2 * reRotated(H0t, omegaTone * d)
    else if (CDt && hTheory) CDt[d] = hTheory[d] * sigma2
    else if (CDt && sawR) CDt[d] = sigma2 * autocorrCorrelation(hSaw, sawR, d)
  }

  // ── 頻率響應（log 格點）──
  const nG = 400
  const gLo = Math.min(wL * 1e-2, Math.PI / 100)
  const gOmega = new Float64Array(nG)
  for (let i = 0; i < nG; i++) gOmega[i] = gLo * Math.pow(Math.PI / gLo, i / (nG - 1))
  const Hg = freqz(design.b, design.a, gOmega)
  const re = new Float64Array(nG)
  const im = new Float64Array(nG)
  const magDb = new Float64Array(nG)
  const phaseDeg = new Float64Array(nG)
  const ctRe = new Float64Array(nG)
  const ctPhaseDeg = new Float64Array(nG)
  for (let i = 0; i < nG; i++) {
    re[i] = Hg[i].re
    im[i] = Hg[i].im
    magDb[i] = 20 * Math.log10(Math.max(cAbs(Hg[i]), 1e-300))
    phaseDeg[i] = (Math.atan2(Hg[i].im, Hg[i].re) * 180) / Math.PI
    const hc = ctHpd(p.loopType, gOmega[i] / wL, p.zeta)
    ctRe[i] = hc.re
    ctPhaseDeg[i] = (Math.atan2(hc.im, hc.re) * 180) / Math.PI
  }
  const bands = reSignBands(design, { lo: gLo, hi: Math.PI, points: 1500, log: true })

  // ── 波形（約 3 個週期或 256 點）──
  const nShow = Math.min(L, period !== null ? Math.max(64, Math.min(2048, Math.ceil(3 * period))) : 256)
  const wn = new Float64Array(nShow)
  const wx = new Float64Array(nShow)
  const wu = new Float64Array(nShow)
  for (let i = 0; i < nShow; i++) {
    wn[i] = i
    wx[i] = xs[i]
    wu[i] = us[i]
  }
  const xRef = new Float64Array(L)
  for (let n = 0; n < L; n++) xRef[n] = xAll[skip + n - D]
  const largeErrorGain = empiricalLargeErrorGain(xRef, us)

  // ── 警告 ──
  const scale = sigma2
  const cls = classifyPolarity(empirical, scale)
  if (cls === 'negative') {
    warnings.push(
      `C ≤ 0：更新極性錯誤（C_D = ${empirical.toPrecision(4)}，以 σ_x² = ${sigma2.toPrecision(4)} 正規化），正 learning rate 會使平均誤差發散；只減小 μ 不會改變符號，需 delay alignment 或 filtered-x（第 07 章）。`,
    )
  } else if (cls === 'zero') {
    // 技術審查 R01：a + B/C 是 comparator 線性化（Ch11 F-11.3）的式子。C → 0 時 B/C 變大，大到超出線性範圍就不再是固定點，
    // 所以寫成「線性化的固定點 w* ≈ a + B/C」，並把條件放在同一句的括號裡（用語同 Ch06 §6.4、Ch11 §11.4）。
    // 這一句的形狀由 ch06 explorerModel.ts 的 MODEL_TEXT_RULES 以 regex 比對（…都極度敏感（§11.4 …）。；括號內不可再有「）」），要改必須兩邊一起改。
    warnings.push(
      `C ≈ 0：GMAC 沒有平均恢復力（C_D = ${empirical.toPrecision(3)}），w 會隨雜訊漂移；線性化的固定點 w* ≈ a + B/C 對任何 bias B 都極度敏感（§11.4 的代回檢查：B/C 大到超出線性範圍時只是線性外推，不再是固定點）。`,
    )
  }
  if (period !== null && period > L / 4) {
    warnings.push(`code 週期約 ${Math.round(period)} samples，分析長度 ${L} 只涵蓋 ${(L / period).toFixed(1)} 個週期：C 的時間平均尚未收斂（E46 的有限長度 ripple）。`)
  }
  return {
    design,
    omegaTone,
    grid: { omega: gOmega, re, im, magDb, phaseDeg, ctRe, ctPhaseDeg },
    bands,
    psd: { omega: wOmega, sxx, nperseg, nSegments: wr.nSegments, enbwBins: wr.enbwBins },
    C: { sigma2, empirical, periodogram, welch: welchC, autocorr, filtered: empiricalCorrelation(uAll, uAll, D, skip), theory, theoryLabel },
    CD: { D: CDd, empirical: CDe, periodogram: CDp, theory: CDt, filtered: CDf },
    wave: { n: wn, x: wx, u: wu },
    largeErrorGain,
    length: L,
    skip,
    impulseLength,
    warnings,
  }
}

/** (worker) 多個 case 一次分析（A/B/C 比較用） */
export function analyzePllPolarityBatch(p: { items: (PllPolarityParams & { id: string })[] }): {
  results: (PllPolarityResult & { id: string })[]
} {
  return { results: p.items.map((it) => ({ ...analyzePllPolarity(it), id: it.id })) }
}

// ───────────────────────────────────────────────────────────────────────────
// 閉迴路 block sign-LMS（§15.2；與 blockLms 同一模型、同一 RNG 分流）
// ───────────────────────────────────────────────────────────────────────────

// #region core:buildRegressor
/** GMAC 使用的 regressor：raw / delayed 用原始 code x[n − D]；filtered-x（Ĥ = H 的理想情況）用 u[n − D]。 */
export function buildRegressor(x: Float64Array, path: TransferBA, mode: RegressorMode, D: number): Float64Array {
  const ref = new Float64Array(x.length)
  if (mode === 'x') {
    for (let n = D; n < x.length; n++) ref[n] = x[n - D] // ← 差異：raw / delayed：直接用原始 code（硬體最簡單）
  } else {
    const u = lfilter(path.b, path.a, x).y
    for (let n = D; n < x.length; n++) ref[n] = u[n - D] // ← 差異：filtered-x：用 PD 實際看到的 u = h * x
  }
  return ref
}
// #endregion

export interface SignLmsChainSpec {
  x: Float64Array
  ref: Float64Array
  path: TransferBA
  a: number
  w0: number
  mu: number
  sigmaV: number
  N: number
  blocks: number
  /** N(0, 1) 產生器（同 seed 可重現） */
  noise: () => number
  /** comparator 極性：+1 正常；−1 為「極性接反」的反面測試 */
  comparatorPolarity?: 1 | -1
}

// #region core:signLmsBlock
/**
 * 逐 sample 的 block sign-error LMS（average-mode GMAC）。回傳每個 block 之後的 δ_k = a − w_k 與 G_k。
 * 注意：PD 濾的是整個 DTC 誤差 δ_k·x[n]，濾波器狀態跨 block 持續；所以 w 變動時 e ≠ δ·u（只在 w 慢變時近似）。
 */
export function simulateSignLmsChain(p: SignLmsChainSpec): { delta: Float64Array; G: Float64Array } {
  const { x, ref, a, mu, sigmaV, N, blocks, noise } = p
  const pol = p.comparatorPolarity ?? 1
  const pd = new StreamFilter(p.path.b, p.path.a) // 主 PLL 的 H_PD（不可每個 block 重置）
  const delta = new Float64Array(blocks + 1)
  const G = new Float64Array(blocks)
  let w = p.w0
  let n = 0
  delta[0] = a - w
  for (let k = 0; k < blocks; k++) {
    const d = a - w // 本 block 的參數誤差 δ_k = a − w_k
    let acc = 0
    for (let i = 0; i < N; i++, n++) {
      const e = pd.step(d * x[n]) + sigmaV * noise() // PD 看到 H_PD{δ·x} + v，不是 δ·x 本身
      const q = pol * (e >= 0 ? 1 : -1) // 1-bit comparator（tie → +1）
      acc += q * ref[n] // ← 差異：GMAC 乘的是 regressor（raw：x[n−D]），不是誤差裡的 u
    }
    G[k] = acc / N // average-mode GMAC
    w += mu * G[k] // w_{k+1} = w_k + μ·G_k
    delta[k + 1] = a - w
  }
  return { delta, G }
}
// #endregion

export interface ClosedLoopParams {
  cases: (PolarityParams & { id: string })[]
  seed: number
  /** Monte Carlo chains（每條 chain 不同 comparator 雜訊；iid code 也不同） */
  chains: number
  /** 是否同時跑一次 blockLms 參考模型（同 seed） */
  reference?: boolean
}

export interface ClosedLoopCheck {
  status: 'ok' | 'mismatch' | 'n/a'
  /** 比對的 block 索引 k*（線性區內最後一個 block） */
  k: number
  /** MC ensemble 平均 δ_{k*} 與其樣本標準誤 */
  mean: number
  se: number
  /** 線性平均模型 δ₀p^{k*} 與模型預測的標準誤 √(v_{k*}/R) */
  pred: number
  sePred: number
  /** 二階動差：Σ_W ⟨δ_k²⟩_MC / Σ_W (m_k² + v_k)，W = [⌈k⋆/2⌉, k⋆]（k⋆ = 上面的 k）；容許區間 [msLo, msHi] */
  msRatio: number
  msLo: number
  msHi: number
  note: string
}

export interface LinearMomentCheckInput {
  /** δ₀ = a − w₀ [fs] */
  d0: number
  /** 平均 pole p = 1 − μK_qC */
  pole: number
  /** μ [fs] */
  mu: number
  /** 每個 block 的 GMAC 雜訊變異 σ_η² = E[x_ref²]/N（q = ±1、comparator 雜訊 iid） */
  noiseVar: number
  /** 線性區上限 [fs]：|δ|·u_max ≤ 0.3σ_v ⇒ 0.3σ_v/u_max（用峰值：尖峰型的 u 先飽和） */
  linearLimit: number
  /** MC chain 數 R */
  chains: number
  /** 每個 block 的 Σ_r δ_k 與 Σ_r δ_k²（長度 K + 1） */
  sum: ArrayLike<number>
  sumSq: ArrayLike<number>
  /**
   * 選用：逐 block 的 pole p_k = 1 − μK_q·Ĉ_k（長度 K；Ĉ_k = 第 k 個 block 內 x_ref·u 的平均，E46 的有限 N 值）。
   * 確定性 code 的 Ĉ_k 可事先算出；給了就用線性「時變」模型 m_{k+1} = p_k·m_k、v_{k+1} = p_k²·v_k + μ²σ_η²。
   */
  blockPoles?: ArrayLike<number>
}

// #region core:linearMomentCheck
/**
 * Monte Carlo 對「線性隨機模型」的兩個動差檢查（不是只看平均值——雜訊主導時平均值沒有檢定力）：
 *   δ_{k+1} = p_k·δ_k − μ·η_k，η_k 零平均、變異 σ_η² = E[x_ref²]/N
 *   平均   m_{k+1} = p_k·m_k（p_k ≡ p 時 m_k = δ₀·p^k）
 *   變異   v_{k+1} = p_k²·v_k + μ²σ_η²（v₀ = 0；p_k ≡ p 時 v_k = μ²σ_η²(1 − p^{2k})/(1 − p²)）
 * p_k 預設為長時間平均的 p；有給 blockPoles 時用逐 block 的 p_k = 1 − μK_qĈ_k（block 不是整數個 code 週期時 Ĉ_k 會起伏）。
 * 只在線性區（√(m_k² + v_k) ≤ 0.3σ_v/u_max）內比較，k* 是線性區的最後一個 block。
 *   (1) 平均：|δ̄_{k*} − m_{k*}| ≤ 4√(v_{k*}/R) + 10%·|m_{k*}| + 2%·|δ₀|
 *   (2) 均方：ρ = Σ_W⟨δ²⟩/Σ_W(m² + v) 落在 χ² 區間（Wilson–Hilferty，z = ±3.5）再放寬 ±25%（線性化誤差）
 */
export function linearMomentCheck(p: LinearMomentCheckInput): ClosedLoopCheck {
  const K = p.sum.length - 1
  const R = Math.max(1, Math.round(p.chains))
  const p2 = p.pole * p.pole
  const stepVar = p.mu * p.mu * p.noiseVar // μ²σ_η²：每個 block 注入的雜訊變異
  const m = new Float64Array(K + 1)
  const v = new Float64Array(K + 1)
  m[0] = p.d0
  let kStar = 0
  for (let k = 0; k <= K; k++) {
    if (k > 0) {
      const pk = p.blockPoles ? p.blockPoles[k - 1] : p.pole // ← 差異：逐 block 的 pole（有限 N 的 Ĉ_k）或長時間平均
      m[k] = m[k - 1] * pk // m_k = p_{k−1}·m_{k−1}
      v[k] = pk * pk * v[k - 1] + stepVar // v_k = p_{k−1}²·v_{k−1} + μ²σ_η²
    }
    if (!(Math.sqrt(m[k] * m[k] + v[k]) <= p.linearLimit)) break // 離開線性區（或數值溢位）就停
    kStar = k
  }
  const mean = p.sum[kStar] / R
  const sampleVar = R > 1 ? Math.max(0, (p.sumSq[kStar] - R * mean * mean) / (R - 1)) : Number.NaN
  const se = Math.sqrt(sampleVar / R)
  const pred = m[kStar]
  const sePred = Math.sqrt(v[kStar] / R)
  const base = { k: kStar, mean, se, pred, sePred }
  if (!Number.isFinite(stepVar) || kStar < 2) {
    return {
      ...base,
      status: 'n/a',
      msRatio: Number.NaN,
      msLo: Number.NaN,
      msHi: Number.NaN,
      note: `線性區不足 2 個 block（|δ₀| = ${Math.abs(p.d0).toPrecision(3)} fs，線性區上限 0.3σ_v/u_max = ${p.linearLimit.toPrecision(3)} fs）：K_q 小訊號模型不適用，無法與線性 pole 比對`,
    }
  }
  const okMean = Math.abs(mean - pred) <= 4 * sePred + 0.1 * Math.abs(pred) + 0.02 * Math.abs(p.d0)
  // 均方：視窗內時間平均 + ensemble 平均；有效自由度 ≈ R × 視窗內的獨立樣本數（|p| < 1 時相關時間 ≈ 1/(1 − p²)）
  const k0 = Math.ceil(kStar / 2)
  let num = 0
  let den = 0
  for (let k = k0; k <= kStar; k++) {
    num += p.sumSq[k] / R
    den += m[k] * m[k] + v[k]
  }
  const msRatio = num / den
  const dof = R * Math.max(1, Math.abs(p.pole) < 1 ? (kStar - k0 + 1) * (1 - p2) : 1)
  const wh = (z: number): number => Math.max(0, 1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof))) ** 3 // χ²_dof/dof 的分位數
  const msLo = 0.75 * wh(-3.5)
  const msHi = 1.25 * wh(3.5)
  const okMs = msRatio >= msLo && msRatio <= msHi
  return {
    ...base,
    status: okMean && okMs ? 'ok' : 'mismatch',
    msRatio,
    msLo,
    msHi,
    note:
      `k* = ${kStar}：MC 平均 δ = ${mean.toPrecision(4)} fs vs 線性 ${p.blockPoles ? 'δ₀∏p_k' : 'δ₀p^k'} = ${pred.toPrecision(4)} ± ${(4 * sePred).toPrecision(2)}（4σ/√R，${R} chains）${okMean ? '' : ' ✗'}；` +
      `⟨δ²⟩/(m² + v) = ${msRatio.toPrecision(3)}（容許 ${msLo.toPrecision(2)}–${msHi.toPrecision(2)}）${okMs ? '' : ' ✗'}`,
  }
}
// #endregion

export interface ClosedLoopCaseResult {
  id: string
  /** 閉迴路實際使用的 regressor 與 u 的 C_D（無雜訊、時域） */
  C: number
  Kq: number
  pole: number
  /** ensemble 平均 δ_k = a − w_k */
  deltaMean: Float64Array
  /** 前幾條 chain 的 δ_k（最多 4 條） */
  deltaChains: Float64Array[]
  /** 線性平均模型 δ_0·p^k */
  predLinear: Float64Array
  /** 大誤差極限的增益 E[x_ref·sign(u)]；< 0 時 |δ| 每 block 線性增加 μ|·| */
  largeErrorGain: number
  /** blockLms 參考模型（chain 0 同 seed）的 δ_k；三角波等不支援時為 null */
  reference: { delta: Float64Array; Cest: number; warnings: string[] } | null
  check: ClosedLoopCheck
  /**
   * 遠離 a（發散或漂移）：最後一個 block 的 RMS δ > 3·max(|δ₀|, 1 fs, 4σ_w)，
   * σ_w ≈ μ·√(E[x_ref²]/N/(1 − p²)) 是 |p| < 1 時的穩態雜訊預測（|p| ≥ 1 時取 0），避免把穩定但吵的迴路誤判為發散。
   */
  diverging: boolean
  /** 線性模型的穩態 RMS 預測 σ_w [fs]（|p| ≥ 1 時 NaN） */
  sigmaWPred: number
  /** mean-field 特性 E[G](δ)（δ > 0；奇函數）與它的第一個變號點 δ_c（meanFieldCurve） */
  sCurve: MeanFieldCurve
  /** PD 看到的 u 的峰值與 RMS（線性區判定用峰值：|δ|·u_max ≤ 0.3σ_v） */
  uMax: number
  uRms: number
  /** chain 0 在最後 1/4 個 block 的 |δ| 斜率 [fs/block] */
  driftSlope: number
  /** mean-field 預測 μ·⟨|E[G](δ_k)|⟩（同一視窗、chain 0 的 δ_k；meanFieldGmac） [fs/block] */
  driftPred: number
  /** 斜率比對的容許誤差：15%·預測 + 4σ（block 雜訊 μ√(E[x_ref²]/N) 在視窗內累積的斜率誤差） */
  driftTol: number
  /** chain 0 在最後 1/4 個 block 是否都在非線性區（|δ|·u_rms > 2σ_v，comparator 對大部分 sample 已飽和） */
  saturated: boolean
  warnings: string[]
}

/** mean-field 取樣視窗：約 8 個 code 週期、取成整數個週期，限制在 16384…32768 點（erf 約 0.1 µs/次） */
function meanFieldSamples(code: PolarityCodeSpec, avail: number): number {
  const period =
    code.kind === 'tone' ? (code.omega && code.omega > 0 ? (2 * Math.PI) / code.omega : 1) : code.kind === 'iid' ? 1 : 1 / Math.max(code.frac ?? 0.3, 1e-9)
  const want = Math.min(avail, Math.max(16384, Math.min(32768, Math.ceil(8 * period))))
  if (!(period > 1) || period > want) return want
  return Math.max(1, Math.round(Math.floor(want / period) * period)) // 整數個週期，避免非整數週期的 ripple
}

function chainSeed(seed: number, r: number): number {
  return r === 0 ? seed : deriveSeed(seed, `polarity-chain-${r}`)
}

/** (worker) 對每個 case 跑 R 條 closed-loop chain（+ 一次 blockLms 參考模型）。 */
export function runPolarityClosedLoop(p: ClosedLoopParams): { results: ClosedLoopCaseResult[] } {
  const R = Math.max(1, Math.min(32, Math.round(p.chains)))
  const results: ClosedLoopCaseResult[] = []
  for (const cs of p.cases) {
    const warnings: string[] = []
    const N = Math.max(1, Math.round(cs.N))
    const K = Math.max(1, Math.round(cs.blocks))
    const D = Math.max(0, Math.round(cs.D))
    if (N * K > MAX_CLOSED_LOOP_SAMPLES) {
      throw new Error(`N × blocks = ${N * K} 超過單條 chain 上限 ${MAX_CLOSED_LOOP_SAMPLES}（請減少 blocks 或 N）`)
    }
    const { path, code, design } = pathAndCode(cs)
    if (design && !design.stable) throw new Error(`Case ${cs.id}：${design.warnings[0] ?? '主 PLL 不穩定'}`)
    if (design) {
      // 時間尺度分離的兩個前提：block 比主 PLL 的記憶長、也至少涵蓋一個 code 週期
      const tau = 1 / Math.max(1 - design.spectralRadius, 1e-12)
      if (N < 3 * tau) {
        warnings.push(
          `GMAC block 長度 N = ${N} 不到主 PLL 記憶長度（≈ 1/(1 − |pole|) = ${Math.round(tau)} samples）的 3 倍：w 在 H_PD 的記憶內不是常數，e ≈ δ·u（F-06.1 的時間尺度分離）不成立；線性 pole 與 mean-field 曲線只是參考，交叉比對可能顯示 mismatch。請加大 N 或主 PLL 頻寬。`,
        )
      }
      const period = code.kind === 'tone' && code.omega ? (2 * Math.PI) / code.omega : code.kind === 'dsm1' || code.kind === 'mash' ? 1 / Math.max(code.frac ?? 0.3, 1e-9) : 0
      if (period > N) {
        warnings.push(
          `一個 GMAC block（N = ${N}）不到一個 code 週期（≈ ${Math.round(period)} samples）：逐 block 的 Ĉ_k 會大幅起伏甚至變號（E46 的有限 N ripple），多個 block 平均後才回到長時間平均的 C。`,
        )
      }
    }
    const Kq = kqFromSigma(cs.sigmaV)
    const total = N * K
    const deterministic = code.kind !== 'iid'
    let xShared: Float64Array | null = null
    let refShared: Float64Array | null = null
    const sum = new Float64Array(K + 1)
    const sumSq = new Float64Array(K + 1)
    const deltaChains: Float64Array[] = []
    let C = Number.NaN
    let largeErrorGain = Number.NaN
    let uRms = Number.NaN
    let refMs = Number.NaN
    let mfRef: Float64Array | null = null
    let mfU: Float64Array | null = null
    let mfSkip = 0
    let uMax = 0
    let blockPoles: Float64Array | null = null
    for (let r = 0; r < R; r++) {
      const s = chainSeed(p.seed, r)
      let x: Float64Array
      let ref: Float64Array
      if (deterministic && xShared && refShared) {
        x = xShared
        ref = refShared
      } else {
        x = generatePolarityCode(code, total, s)
        ref = buildRegressor(x, path, cs.regressor, D)
        if (deterministic) {
          xShared = x
          refShared = ref
        }
      }
      if (r === 0) {
        const u = lfilter(path.b, path.a, x).y
        const skip = Math.min(Math.floor(total / 4), 4096)
        C = empiricalCorrelation(ref, u, 0, skip)
        largeErrorGain = empiricalLargeErrorGain(ref, u, skip)
        uRms = Math.sqrt(meanSquare(u.subarray(skip)))
        for (let n = skip; n < u.length; n++) uMax = Math.max(uMax, Math.abs(u[n]))
        refMs = meanSquare(ref.subarray(skip))
        mfRef = ref
        mfU = u
        mfSkip = skip
        if (deterministic) {
          // 逐 block 的 Ĉ_k（E46：block 不是整數個 code 週期時會起伏）⇒ p_k = 1 − μK_qĈ_k，供線性時變模型的 MC 檢查
          blockPoles = new Float64Array(K)
          for (let k = 0; k < K; k++) {
            let acc = 0
            for (let n = k * N; n < (k + 1) * N; n++) acc += ref[n] * u[n]
            blockPoles[k] = calPole(cs.mu, Kq, acc / N)
          }
        }
      }
      const noise = createZigguratNormal(createRng(s).fork('comparator-noise'))
      const { delta } = simulateSignLmsChain({ x, ref, path, a: cs.a, w0: cs.w0, mu: cs.mu, sigmaV: cs.sigmaV, N, blocks: K, noise })
      for (let k = 0; k <= K; k++) {
        sum[k] += delta[k]
        sumSq[k] += delta[k] * delta[k]
      }
      if (deltaChains.length < 4) deltaChains.push(delta)
    }
    const deltaMean = sum.map((v) => v / R)
    const pole = calPole(cs.mu, Kq, C)
    const d0 = cs.a - cs.w0
    const predLinear = new Float64Array(K + 1)
    for (let k = 0; k <= K; k++) predLinear[k] = d0 * Math.pow(pole, k)

    // ── Monte Carlo 對線性隨機模型的檢查（平均 + 均方；只在線性區 |δ|·u_max ≤ 0.3σ_v 內比較）──
    const check = linearMomentCheck({
      d0,
      pole,
      mu: cs.mu,
      noiseVar: refMs / N,
      linearLimit: uMax > 0 ? (0.3 * cs.sigmaV) / uMax : Number.POSITIVE_INFINITY, // 用峰值：鋸齒經 Type-II 的 u 峰值 ≫ RMS
      chains: R,
      sum,
      sumSq,
      blockPoles: blockPoles ?? undefined,
    })
    // 「遠離 a」：最後一個 block 的 RMS δ 超過 3·max(|δ₀|, 1 fs, 4σ_w)；σ_w² ≈ μ²(E[x_ref²]/N)/(1 − p²)（Var(G) ≈ E[x_ref²]/N，q = ±1）
    const sigmaWPred = Math.abs(pole) < 1 ? cs.mu * Math.sqrt(refMs / N / (1 - pole * pole)) : Number.NaN
    const diverging = Math.sqrt(sumSq[K] / R) > 3 * Math.max(Math.abs(d0), 1, Number.isFinite(sigmaWPred) ? 4 * sigmaWPred : 0)
    // 非線性區的漂移：chain 0 最後 1/4 個 block 的 |δ| 斜率 vs mean-field 預測 μ·|E[G](δ)|（單頻大誤差時退化成 F-06.15）
    const kq0 = Math.max(0, K - Math.max(1, Math.floor(K / 4)))
    const ch0 = deltaChains[0]
    const driftSlope = (Math.abs(ch0[K]) - Math.abs(ch0[kq0])) / (K - kq0)
    let minAbs = Infinity
    for (let k = kq0; k <= K; k++) minAbs = Math.min(minAbs, Math.abs(ch0[k]))
    const saturated = Number.isFinite(uRms) && minAbs * uRms > 2 * cs.sigmaV
    let driftPred = Number.NaN
    let sCurve: MeanFieldCurve = { delta: new Float64Array(0), G: new Float64Array(0), cross: null }
    if (mfRef && mfU) {
      const mfSamples = meanFieldSamples(code, total - mfSkip)
      let acc = 0
      const pts = 5
      for (let i = 0; i < pts; i++) {
        const k = Math.round(kq0 + ((K - kq0) * i) / (pts - 1))
        acc += Math.abs(meanFieldGmac(mfRef, mfU, ch0[k], cs.sigmaV, mfSkip, mfSamples))
      }
      driftPred = (cs.mu * acc) / pts
      sCurve = meanFieldCurve(mfRef, mfU, cs.sigmaV, { skip: mfSkip, samples: mfSamples })
      // C ≈ 0 時小訊號符號只是捨入雜訊，「變號點」沒有意義
      if (!(Math.abs(C) > 1e-6 * Math.sqrt(refMs) * uRms)) sCurve.cross = null
    }
    // 局部穩定但 basin 有限：C > 0（線性 pole 在單位圓內），mean-field 特性卻在 δ_c 變號
    if (sCurve.cross !== null && C > 0) {
      const reach = Math.max(Math.abs(d0), Number.isFinite(sigmaWPred) ? 3 * sigmaWPred : 0)
      if (reach > 0.5 * sCurve.cross) {
        warnings.push(
          `C > 0 只保證小訊號（|δ|·u_max ≪ σ_v）的極性正確：mean-field 特性 E[G](δ) 在 |δ| > δ_c = ${sCurve.cross.toPrecision(3)} fs 變號（comparator 對 u 的尖峰飽和、對小尾巴仍線性；F-06.19），` +
            `δ = 0 只是局部穩定。目前 max(|δ₀|, 3σ_w) = ${reach.toPrecision(3)} fs ${reach > sCurve.cross ? '已超過' : '已接近'} δ_c：閉迴路可能離開 basin 而遠離 a（降低 μ 可縮小 σ_w，但救不了 |δ₀| > δ_c 的起始誤差）。`,
        )
      }
    }
    const driftTol = 0.15 * driftPred + (4 * cs.mu * Math.sqrt(refMs / N)) / Math.sqrt(Math.max(1, K - kq0))
    if (Number.isFinite(Kq) && Math.abs(d0) * uRms > 0.5 * cs.sigmaV) {
      warnings.push(`初始誤差 |δ₀|·u_rms = ${(Math.abs(d0) * uRms).toPrecision(3)} fs 已接近 σ_v：K_q 小訊號線性化不準（comparator 進入飽和），線性 pole 只是參考。`)
    }

    // ── blockLms 參考模型（chain 0 同 seed）──
    let reference: ClosedLoopCaseResult['reference'] = null
    const pattern = blockLmsPattern(code)
    if (p.reference !== false && pattern) {
      const cfg: BlockLmsConfigInput = {
        seed: p.seed,
        gm_accum_samples: N,
        num_blocks: K,
        gain_initial: cs.w0,
        gain_true: cs.a,
        gain_step: cs.mu,
        pd_noise_rms_fs: cs.sigmaV,
        code_normalization: code.normalization,
        gm_mode: 'average',
        seeded_pattern: pattern,
        pll_error_path: { kind: 'iir', parameters: { b: path.b, a: path.a } },
        regressor_mode: cs.regressor === 'u' ? 'filtered' : D > 0 ? 'delayed' : 'raw',
        gm_code_delay_samples: D,
        record: { sample_trace_blocks: 0, decimate: 1 },
      }
      try {
        const rb = runBlockLms(cfg)
        const dl = new Float64Array(K + 1)
        for (let k = 0; k <= K; k++) dl[k] = cs.a - rb.blocks.w[k]
        reference = { delta: dl, Cest: rb.analytic.Cest, warnings: rb.warnings }
      } catch (err) {
        warnings.push(`blockLms 參考模型無法執行：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    results.push({
      id: cs.id,
      C,
      Kq,
      pole,
      deltaMean,
      deltaChains,
      predLinear,
      largeErrorGain,
      reference,
      check,
      diverging,
      sigmaWPred,
      sCurve,
      uMax,
      uRms,
      driftSlope,
      driftPred,
      driftTol,
      saturated,
      warnings,
    })
  }
  return { results }
}

// ───────────────────────────────────────────────────────────────────────────
// CT ↔ DT 對照（E44）
// ───────────────────────────────────────────────────────────────────────────

/** DT 響應在 [lo, hi] 內最低的 Re{H} < 0 頻帶的上緣（polarity 邊界；沒有負頻帶時回傳 null） */
export function firstPositiveCrossing(tf: TransferBA, lo: number, hi: number): number | null {
  const sb = reSignBands(tf, { lo, hi, points: 1200, log: true })
  const first = sb.negative[0]
  return first && first[1] < hi ? first[1] : null
}

/**
 * 白色 code 的「錯誤做法」：把 Ω 代入 CT 原型 H(jΩ/T_s) 再積分（E44 指出不可這樣做）：
 *   C_naive/σ² = (1/π)∫_0^π Re{H_CT(jΩ/ω_LT_s)} dΩ；正確的 DT 值是 h[0] = 1。
 */
export function naiveCtWhiteCorrelation(type: LoopType, wLTs: number, zeta: number, points = 20001): number {
  let acc = 0
  let prev = ctHpd(type, 0, zeta).re
  for (let i = 1; i < points; i++) {
    const w = (Math.PI * i) / (points - 1)
    const cur = ctHpd(type, w / wLTs, zeta).re
    acc += 0.5 * (prev + cur) * (Math.PI / (points - 1))
    prev = cur
  }
  return acc / Math.PI
}

/**
 * ∫_0^∞ Re{H_CT(jν)}/ν² dν（近整數鋸齒波的一階係數）。Type-II 以 ν → 1/ν 代換可證恰為 0；Type-I 為 π/2。
 * 數值上用 ν = tan(θ)（θ ∈ (0, π/2)）把無窮區間映到有限區間，再用梯形法。
 */
export function sawtoothFirstOrderIntegral(type: LoopType, zeta: number, points = 200001): number {
  let acc = 0
  const f = (theta: number): number => {
    const nu = Math.tan(theta)
    if (nu === 0) return type === 'typeII' ? -1 : 1 // 極限 Re/ν² → κ（CT：Type-II −1、Type-I +1）
    const g = ctHpd(type, nu, zeta).re / (nu * nu)
    return g / Math.cos(theta) ** 2 // dν = sec²θ dθ
  }
  const hi = Math.PI / 2 - 1e-7
  let prev = f(0)
  for (let i = 1; i < points; i++) {
    const t = (hi * i) / (points - 1)
    const cur = f(t)
    acc += 0.5 * (prev + cur) * (hi / (points - 1))
    prev = cur
  }
  return acc
}

export interface CtDtCompareParams {
  type: LoopType
  zeta: number
  wLTs: number
  loopDelay: number
  /** 頻率格點 ν = Ω/ω_LT_s 的範圍 */
  nuMin?: number
  nuMax?: number
  points?: number
}

export interface CtDtCompareResult {
  nu: Float64Array
  ctRe: Float64Array
  ctPhaseDeg: Float64Array
  dtRe: Float64Array
  dtPhaseDeg: Float64Array
  /** Re{H} = 0 的第一個由負轉正交點 ν（Type-II CT 為 1；Type-I 通常為 null） */
  ctBoundaryNu: number | null
  dtBoundaryNu: number | null
  /** ν = 0.3 處的相位 [deg] */
  ctPhaseAt03: number
  dtPhaseAt03: number
  /** 白色 code 的 C/σ²：DT 正確值 h[0] 與錯誤的 CT 代入值 */
  whiteDt: number
  whiteNaiveCt: number
  design: PolarityLoopDesign
}

/** CT 原型與 DT 模型的 H_PD 對照（E44）；計算量小，可在主執行緒呼叫。 */
export function compareCtDt(p: CtDtCompareParams): CtDtCompareResult {
  const design = designPolarityLoop({ type: p.type, zeta: p.zeta, wLTs: p.wLTs, loopDelay: p.loopDelay })
  const n = p.points ?? 400
  const nuMin = p.nuMin ?? 0.01
  const nuMax = Math.min(p.nuMax ?? 100, Math.PI / p.wLTs)
  const nu = new Float64Array(n)
  const om = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    nu[i] = nuMin * Math.pow(nuMax / nuMin, i / (n - 1))
    om[i] = nu[i] * p.wLTs
  }
  const H = freqz(design.b, design.a, om)
  const ctRe = new Float64Array(n)
  const ctPhaseDeg = new Float64Array(n)
  const dtRe = new Float64Array(n)
  const dtPhaseDeg = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const hc = ctHpd(p.type, nu[i], p.zeta)
    ctRe[i] = hc.re
    ctPhaseDeg[i] = (Math.atan2(hc.im, hc.re) * 180) / Math.PI
    dtRe[i] = H[i].re
    dtPhaseDeg[i] = (Math.atan2(H[i].im, H[i].re) * 180) / Math.PI
  }
  const dtCross = firstPositiveCrossing(design, nuMin * p.wLTs, Math.PI)
  const ct03 = ctHpd(p.type, 0.3, p.zeta)
  const dt03 = freqz(design.b, design.a, [0.3 * p.wLTs])[0]
  return {
    nu,
    ctRe,
    ctPhaseDeg,
    dtRe,
    dtPhaseDeg,
    ctBoundaryNu: p.type === 'typeII' ? 1 : null,
    dtBoundaryNu: dtCross === null ? null : dtCross / p.wLTs,
    ctPhaseAt03: (Math.atan2(ct03.im, ct03.re) * 180) / Math.PI,
    dtPhaseAt03: (Math.atan2(dt03.im, dt03.re) * 180) / Math.PI,
    whiteDt: design.b[0] / design.a[0],
    whiteNaiveCt: naiveCtWhiteCorrelation(p.type, p.wLTs, p.zeta),
    design,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 近整數 FCW 掃描（§6.2 + §11.4） (worker)
// ───────────────────────────────────────────────────────────────────────────

export interface FcwSweepParams {
  loopType: LoopType
  zeta: number
  bwRatio: number
  loopDelay: number
  /** GMAC code delay D [samples]（預設 0；D ≥ 1 時近整數鋸齒會變號，F-06.18） */
  delay?: number
  fracMin: number
  fracMax: number
  points: number
  /** 每點分析長度下限（預設 2^14；會依週期加長到約 64 個 code 週期，上限 2^18） */
  minLength?: number
  seed?: number
}

export interface FcwSweepResult {
  frac: Float64Array
  /** Ω0/ω_LT_s，Ω0 = 2π·frac */
  ratio: Float64Array
  dsm1: Float64Array
  mash: Float64Array
  triangle: Float64Array
  /** 單頻（正弦）在 Ω0：C_D/σ² = Re{H(e^{jΩ0})e^{jΩ0D}}（封閉式） */
  sine: Float64Array
  /** 鋸齒的精確 C_D/σ²：Σ_k h[k]·R_x[k − D]/σ²（sawtoothAutocorr + dsmPhaseGrid；不截斷譜線） */
  sawTheory: Float64Array
  /** 三角波譜線和，以 σ² = 1/3 正規化 */
  triTheory: Float64Array
  /**
   * 漸近式（Δ = Ω0/ω_LT_s ≤ 0.6 才計算，否則 NaN）。
   * 鋸齒：動差展開 Σh − 6f·Σh|k − D| + 6f²·Σh(k − D)²（D = 0、Type-II 時 = (3/π²)Δ²；Type-I ≈ (3/π)Δ）；
   * 三角波：m₀ − 24f²·(m₂ − 2D·m₁ + D²·m₀)（D = 0 時 = κ(12/π²)Δ²）
   */
  sawAsymptote: Float64Array
  triAsymptote: Float64Array
  /**
   * 一階 DSM residue 的 mean-field 變號點 δ_c/σ_v（E[G](δ) 只跟 δ/σ_v 有關；meanFieldCurve）。
   * NaN = 在 0.02…50 σ_v/u_max 內不變號。C_D > 0 時它是 basin 的半徑；C_D < 0 時是發散後停住的振幅。
   */
  basin: Float64Array
  /** frac_L = ω_LT_s/(2π)：基頻等於迴路頻率的 FCW 小數 */
  fracL: number
  /** F-06.18 的變號門檻 frac* = K_i·Σ_{k<D}h[k](D − k)（Type-II、D ≥ 1；1 ≤ D ≤ d + 1 時 = K_i·D；其他情況 NaN） */
  fracFlip: number
  /** ∫_0^∞ Re{H_CT}/ν² dν */
  firstOrderIntegral: number
  /** DT 脈衝響應的動差 [Σh, Σk·h, Σk²·h]（Type-II：0、0、2/K_i ⇒ C/σ² ≈ 12 frac²/K_i，精確 DT 推導） */
  moments: [number, number, number]
  /** 分析長度不足 16 個週期的掃描點數（這些點的 DSM / 三角波模擬值有有限長度誤差） */
  shortRecords: number
  /** 實際使用的 GMAC code delay D */
  delay: number
  design: PolarityLoopDesign
  warnings: string[]
}

/** (worker) 掃描 FCW 小數 frac，計算四種 code 的 C_D/σ_x² 與鋸齒、三角波的理論值。 */
export function sweepFcwPolarity(p: FcwSweepParams): FcwSweepResult {
  const design = designPolarityLoop({ type: p.loopType, zeta: p.zeta, bwRatio: p.bwRatio, loopDelay: Math.max(0, Math.round(p.loopDelay)) })
  if (!design.stable) throw new Error(design.warnings[0] ?? '主 PLL 線性化模型不穩定：H_PD 沒有意義')
  const warnings = design.warnings.slice()
  const n = Math.max(2, Math.min(80, Math.round(p.points)))
  const D = Math.max(0, Math.min(64, Math.round(p.delay ?? 0)))
  const lo = Math.max(1e-5, Math.min(p.fracMin, p.fracMax))
  const hi = Math.min(0.5, Math.max(p.fracMin, p.fracMax))
  const wL = design.wLTs
  const skip = transientSamples(design.spectralRadius)
  const out = {
    frac: new Float64Array(n),
    ratio: new Float64Array(n),
    dsm1: new Float64Array(n),
    mash: new Float64Array(n),
    triangle: new Float64Array(n),
    sine: new Float64Array(n),
    sawTheory: new Float64Array(n),
    triTheory: new Float64Array(n),
    sawAsymptote: new Float64Array(n),
    triAsymptote: new Float64Array(n),
    basin: new Float64Array(n),
  }
  // 長脈衝響應（尾巴衰減到 e^{−36}）：鋸齒理論與動差都用它
  const hLong = impulseResponse(design.b, design.a, Math.min(2 ** 19, 3 * skip))
  const moments = impulseMoments(hLong)
  const lCap = 2 ** 18
  let sD = 0 // Σ_{k<D} h[k]·(D − k)：F-06.18 一階項的係數（1 ≤ D ≤ d + 1 時恰為 D）
  for (let k = 0; k < D && k < hLong.length; k++) sD += hLong[k] * (D - k)
  let shortRecords = 0
  for (let i = 0; i < n; i++) {
    const f = lo * Math.pow(hi / lo, i / (n - 1))
    const fq = quantizeFcw(f, 20, false).fracEff // DSM 實際使用的 20-bit frac
    const om0 = 2 * Math.PI * f
    // 分析長度：約 64 個 code 週期，並取成「整數個週期」（round(m/frac)）以消除非整數週期的 ripple（E46）
    const want = Math.min(lCap, Math.max(p.minLength ?? 2 ** 14, nextPow2(Math.ceil(64 / f))))
    const cycles = Math.floor(want * fq)
    const L = cycles >= 1 ? Math.max(2, Math.round(cycles / fq)) : want
    if (L * f < 16) shortRecords++
    out.frac[i] = f
    const delta = om0 / wL
    out.ratio[i] = delta
    for (const kind of ['dsm1', 'mash', 'triangle'] as const) {
      const x = generatePolarityCode({ kind, frac: kind === 'triangle' ? fq : f, bits: 20, normalization: 'standardize' }, skip + L, p.seed ?? 1)
      const u = lfilter(design.b, design.a, x).y
      const xs = x.subarray(skip)
      out[kind][i] = empiricalCorrelation(x, u, D, skip) / meanSquare(xs)
      if (kind === 'dsm1') {
        // mean-field 變號點：取約 32 個（整數個）code 週期、4096…16384 點；σ_v = 1 ⇒ 結果就是 δ_c/σ_v
        const target = Math.min(L, 16384, Math.max(4096, Math.ceil(32 / fq)))
        const wc = Math.floor(target * fq)
        const W = wc >= 1 ? Math.round(wc / fq) : target
        const ref = D === 0 ? x : x.map((_, m) => (m >= D ? x[m - D] : 0))
        out.basin[i] = meanFieldCurve(ref, u, 1, { skip, samples: W, points: 10 }).cross ?? Number.NaN
      }
    }
    const omS = Math.min(om0, Math.PI)
    out.sine[i] = reRotated(freqz(design.b, design.a, [omS])[0], omS * D)
    // 精確（DT）：Σ h[k]·R_saw[k − D]/σ²；相位格點依紀錄長度決定（dsmPhaseGrid）
    const grid = dsmPhaseGrid(f, 20, L)
    out.sawTheory[i] = autocorrCorrelation(hLong, sawtoothAutocorr(fq, grid.effective), D)
    const tri = triangleLines(2 * Math.PI * fq, 2001)
    out.triTheory[i] = lineCorrelation(tri, freqz(design.b, design.a, tri.omega), D) / linePower(tri)
    // 漸近式只在 Δ = Ω0/ω_L ≪ 1 時有意義；Δ > 0.6 之後以 NaN 表示「不適用」
    const valid = delta <= 0.6
    out.sawAsymptote[i] = valid ? sawtoothMomentApprox(hLong, fq, D) : Number.NaN
    // 三角波（峰值 ±1、σ² = 1/3）：R[ℓ]/σ² ≈ 1 − 24f²ℓ²（沒有一次項）⇒ m₀ − 24f²·Σh(k − D)²
    out.triAsymptote[i] = valid ? moments[0] - 24 * fq * fq * (moments[2] - 2 * D * moments[1] + D * D * moments[0]) : Number.NaN
  }
  if (shortRecords > 0) {
    warnings.push(
      `有 ${shortRecords} 個掃描點的分析長度不足 16 個 code 週期（frac < ${(16 / lCap).toExponential(2)}）：這些點的 DSM／三角波時域平均有有限長度誤差（E46 的 ripple），請以精確的鋸齒理論曲線為準。`,
    )
  }
  return {
    ...out,
    fracL: wL / (2 * Math.PI),
    fracFlip: p.loopType === 'typeII' && D >= 1 ? design.Ki * sD : Number.NaN,
    firstOrderIntegral: sawtoothFirstOrderIntegral(p.loopType, p.zeta),
    moments,
    shortRecords,
    delay: D,
    design,
    warnings,
  }
}
