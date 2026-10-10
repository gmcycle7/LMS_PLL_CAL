/**
 * 6-bit 校正係數的量化策略（規格 §13；模型層級 L5：定點暫存器、rounding、saturation、量化策略）。
 *
 * 問題：LMS 內部係數 w_H 有高解析度（例如 w* = 32.4 LSB），但實體 DTC gain register 只有 B = 6 bit，
 * 只能輸出整數 code y[n] ∈ {0, 1, …, 2^B − 1}。五種把 w_H 變成 y 的策略（頁面以 CodeCompare 並排顯示）：
 *
 *   (A) freeze           ：y = Q_B(w*) 凍結                       ⇒ 靜態誤差 Q_B(w*) − w*（32.4 → −0.4 LSB，勘誤 E49）
 *   (B) toggle           ：固定週期 L 的 pattern（Bresenham）       ⇒ 平均正確，但有週期 L 的譜線（勘誤 E47）
 *   (C) stochastic       ：y = ⌊w_H⌋ + Bernoulli(frac(w_H))        ⇒ 平均正確，白色 code noise p(1−p)
 *   (D) deltaSigma       ：一階 error-feedback（EFB）ΔΣ             ⇒ y = w_H + r[n−1] − r[n]，NTF = 1 − z⁻¹
 *   (E) deltaSigmaDither ：EFB + 量化器輸入加 dither               ⇒ 打散 limit cycle，代價是總誤差功率上升
 *
 * 關鍵勘誤（docs/validation.md）：
 *   E15：常數有理輸入 c = P/q（最簡分數）時，一階 EFB **必然**進入週期 q 的 limit cycle（任何初始 r 皆然）；
 *        32.4 = 162/5 ⇒ 週期 5，輸出與 (B) 相同（floor 完全相同、round-half-up 為循環移位）。
 *        定點 F 個小數 bit 時週期為 2^F / gcd(K mod 2^F, 2^F)，K = w_H·2^F 的整數值。
 *   E47：[32,32,33,32,33] 的誤差在 f_u/5 為 0.03056 LSB²、2f_u/5 為 0.20944 LSB²（主 Spur 在 2f_u/5）。
 *   E13：LSB 換算 Δ_LSB [fs/LSB]；E49：static error 的正負號依 δw = w − w*（δ = a − w 則相反）。
 *
 * 算術（E15 要求 tie 判斷不可被浮點誤差翻轉）：
 *   - 'rational'：以 1/D 為單位的整數運算，D = q·2^16（q 為目標的最簡分母），常數有理目標完全精確；
 *   - 'fixed'   ：D = 2^F，模擬 F 個小數 bit 的硬體 accumulator（bit-true 等級的整數運算）；
 *   - 'float'   ：IEEE double（D = 1），用來示範 tie 被浮點誤差翻轉的風險。
 *   所有週期偵測都比較「整數輸出 code 序列」，不比較浮點 r（E15 / quant 建議）。
 *
 * Overflow：saturate 時 ΔΣ 的 r 會 windup（可開 anti-windup）；wrap 時硬體丟掉進位，r 只留下「v 減去未 wrap 的整數」
 *   （residual()），所以 r 仍有界、code 直接繞回另一端。
 *
 * Mixing（§13.5 第 5、6 點）：δt[n] = Δ_LSB·(y − w*)·x[n]，x 為標準化的 DSM residue；σ_out = √∫_{f_L}|T|²S_δt df。
 *   Welch 每段去平均 ⇒ 積分下限 f_L = f_s/nperseg；比它慢的成分另外回報（slowRmsFs、meanFs），不混進 σ_out。
 *   code 為週期序列時，混頻產物的週期是 lcm(P_code·N_upd, P_DSM)：比紀錄長時最慢的差頻分辨不出來（會警告）。
 *   slowProductStaircase() 模擬一整個混頻週期，用來示範「FCW 陷阱」（frac = 0.1 時週期 5·2^19 個 cycle）。
 *
 * 純數值、無 React/DOM；runQuantLab 為 worker 可呼叫的純函式（參數與結果皆可 structured clone）。
 * 隨機一律來自 createRng(seed).fork(label)；PRBS 選項使用 Fibonacci LFSR。
 */

import { createRng, type Rng } from '@/simulation/core'
import { findTones, integratePsd, welch, type DetectedTone, type PsdResult } from '@/simulation/signal'
import { DsmStream, detectPeriod, firstOrderPeriod, quantizeFcw, runDsm, type DsmKind } from '@/simulation/models/dsm'
import { ctT, wnFromBandwidth3dB } from '@/simulation/models/pll'

// ───────────────────────────────────────────────────────────────────────────
// 型別與常數
// ───────────────────────────────────────────────────────────────────────────

export type QuantStrategy = 'freeze' | 'toggle' | 'stochastic' | 'deltaSigma' | 'deltaSigmaDither'
export type RoundingMode = 'nearest' | 'floor'
export type OverflowMode = 'saturate' | 'wrap'
export type Arithmetic = 'rational' | 'fixed' | 'float'
export type RandomSource = 'ideal' | 'prbs'
export type DitherPdf = 'uniform' | 'triangular'
export type ToggleOrder = 'spread' | 'clustered'

export const STRATEGIES: readonly QuantStrategy[] = ['freeze', 'toggle', 'stochastic', 'deltaSigma', 'deltaSigmaDither']

export const STRATEGY_LABEL: Record<QuantStrategy, string> = {
  freeze: '(A) Nearest Freeze',
  toggle: '(B) Deterministic Toggle',
  stochastic: '(C) Stochastic Rounding',
  deltaSigma: '(D) 1st-order ΔΣ（EFB）',
  deltaSigmaDither: '(E) ΔΣ + Dither',
}

export const STRATEGY_SHORT: Record<QuantStrategy, string> = {
  freeze: 'A',
  toggle: 'B',
  stochastic: 'C',
  deltaSigma: 'D',
  deltaSigmaDither: 'E',
}

/** rational 模式額外保留的小數 bit（給 dither 與時變 w_H 使用）：D = q·2^16。 */
export const RATIONAL_EXTRA_BITS = 16

/** 規格 §13.2 的週期 5 pattern（T16）。 */
export const TOGGLE_PATTERN_5: readonly number[] = [32, 32, 33, 32, 33]

/** 低頻（頻帶內）誤差的頻帶上緣：f_u / 64（相當於 OSR = 32）。 */
export const LF_OSR_DIV = 64

/** 最大長度 LFSR（Fibonacci，x^N + x^t + 1）的 tap：N → t。 */
export const PRBS_TAPS: Readonly<Record<number, number>> = { 7: 6, 9: 5, 11: 9, 15: 14, 17: 14, 23: 18, 31: 28 }

// ───────────────────────────────────────────────────────────────────────────
// 小工具（整數算術）
// ───────────────────────────────────────────────────────────────────────────

/** 最大公因數（非負整數，< 2^53）。gcd(0, b) = b。 */
export function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b !== 0) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

/** 最小公倍數（正整數；結果需 < 2^53）。 */
export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b
}

/** mixing 使用的 DSM accumulator 位元數（frac 被量化成 K/2^20）。 */
export const DSM_BITS = 20

/** 整數 a、b（b > 0）的數學 mod，結果 ∈ [0, b)。 */
export function mod(a: number, b: number): number {
  return ((a % b) + b) % b
}

/**
 * 連分數求最佳有理近似 p/q（q ≤ maxDen）。32.4 → 162/5。
 * 停止條件：|x − p/q| ≤ 4·ε·|x|（double 能分辨的程度）或下一個 convergent 的分母超過 maxDen。
 */
export function rationalApprox(x: number, maxDen = 1_000_000): { p: number; q: number; err: number } {
  if (!Number.isFinite(x)) throw new Error(`rationalApprox：輸入必須為有限數，收到 ${x}`)
  let h0 = 0
  let h1 = 1
  let k0 = 1
  let k1 = 0
  let r = x
  const tol = 4 * Number.EPSILON * Math.max(1, Math.abs(x))
  for (let iter = 0; iter < 64; iter++) {
    const a = Math.floor(r)
    const h2 = a * h1 + h0
    const k2 = a * k1 + k0
    if (k2 > maxDen) break
    h0 = h1
    h1 = h2
    k0 = k1
    k1 = k2
    if (Math.abs(x - h1 / k1) <= tol) break
    const frac = r - a
    if (frac === 0) break
    r = 1 / frac
  }
  return { p: h1, q: k1, err: x - h1 / k1 }
}

// ───────────────────────────────────────────────────────────────────────────
// 量化器核心（頁面顯示的程式碼）
// ───────────────────────────────────────────────────────────────────────────

/** 量化器與策略共用的設定（以 1/D LSB 為單位的整數運算）。 */
export interface QuantCtx {
  /** 單位分母：v = V/D [LSB]（rational：q·2^16；fixed：2^F；float：1） */
  D: number
  rounding: RoundingMode
  overflow: OverflowMode
  /** 最大 code 2^B − 1 */
  maxCode: number
  /** code 個數 2^B */
  nCodes: number
  antiWindup: boolean
  /** anti-windup 時 r 的允許範圍（以 1/D 為單位） */
  rLo: number
  rHi: number
  /** (B) pattern 週期 L 與排列方式 */
  togglePeriod: number
  toggleOrder: ToggleOrder
  /** U[0,1) 亂數來源（ideal 或 PRBS） */
  rand: () => number
  /** dither 樣本（以 1/D 為單位；rational / fixed 時為整數） */
  dither: () => number
}

/** 每個策略的狀態（所有策略共用同一個形狀，方便並排比較）。 */
export interface QState {
  /** 更新次數 n */
  n: number
  /** ΔΣ 的量化誤差 r[n−1]（以 1/D 為單位） */
  r: number
  /** (A) 凍結當下的 w*（以 1/D 為單位） */
  wFreeze: number
  /** overflow（code 超出 [0, 2^B−1]）次數 */
  overflow: number
  /** anti-windup 介入次數 */
  windup: number
}

// #region core:quantize
/**
 * Q_B：把 v = V/D [LSB] 量化成 B-bit code，並處理超出 [0, 2^B − 1] 的情況。
 * rational / fixed 模式下 V、D 都是整數，(2V + D)/(2D) 的 floor 完全精確（tie 不會被浮點誤差翻轉）。
 */
export function quantize(V: number, s: QState, c: QuantCtx): number {
  let y =
    c.rounding === 'nearest'
      ? Math.floor((2 * V + c.D) / (2 * c.D)) // round-half-up：⌊v + ½⌋（32.5 → 33）
      : Math.floor(V / c.D) // floor（truncation）：⌊v⌋
  if (y < 0 || y > c.maxCode) {
    s.overflow++
    y =
      c.overflow === 'saturate'
        ? Math.min(Math.max(y, 0), c.maxCode) // 飽和：卡在 0 或 63
        : mod(y, c.nCodes) // wrap：64 → 0（gain 瞬間崩到 0！）
  }
  return y
}
// #endregion

// #region core:residual
/**
 * r 暫存器實際存得下的值（ΔΣ 的 r[n] = v[n] − y[n] 算出來之後）：
 *   - wrap：硬體把超出 B bit 的進位直接丟掉 ⇒ r 只留下「v 減去未 wrap 的整數」，也就是去掉 2^B 的整數倍
 *     （否則模型裡的 r 會多出 64、128、…，那是無限精度數學才有的假象）；
 *   - anti-windup：把 r 夾回 quantizer 的正常範圍（saturate 且 overload 時避免 r 無界成長）。
 */
function residual(r: number, s: QState, c: QuantCtx): number {
  if (c.overflow === 'wrap') {
    const span = c.nCodes * c.D // 2^B LSB（以 1/D 為單位）
    r -= span * Math.round(r / span) // 被丟掉的進位不會留在 r 裡（整數運算，仍然精確）
  }
  if (!c.antiWindup) return r
  if (r < c.rLo) {
    s.windup++
    return c.rLo
  }
  if (r > c.rHi) {
    s.windup++
    return c.rHi
  }
  return r
}
// #endregion

// #region core:freezeStep
/** (A) Nearest Freeze：只在凍結當下量化一次，之後一直輸出同一個 code。 */
export function freezeStep(_W: number, s: QState, c: QuantCtx): number {
  const V = s.wFreeze // ← 差異：只看凍結當下的 w*，忽略之後的 w_H[n]
  const y = quantize(V, s, c) // y = Q_B(w*) = 32（32.4 時）
  s.n++
  return y
}
// #endregion

// #region core:toggleStep
/** (B) Deterministic Toggle：週期 L 的固定 pattern，k = round(frac·L) 個 sample 輸出 ⌊w_H⌋ + 1。 */
export function toggleStep(W: number, s: QState, c: QuantCtx): number {
  const lo = Math.floor(W / c.D) // 整數部分 ⌊w_H⌋
  const k = Math.round(((W - lo * c.D) * c.togglePeriod) / c.D) // ← 差異：frac 只能以 1/L 的解析度表示
  const m = s.n % c.togglePeriod // ← 差異：pattern 相位只由計數器決定（開迴路，沒有誤差回授）
  const bit =
    c.toggleOrder === 'spread'
      ? Math.floor(((m + 1) * k) / c.togglePeriod) - Math.floor((m * k) / c.togglePeriod) // Bresenham：1 盡量均勻分散
      : m >= c.togglePeriod - k ? 1 : 0 // clustered（PWM）：1 集中在週期尾端
  const y = quantize((lo + bit) * c.D, s, c)
  s.n++
  return y
}
// #endregion

// #region core:stochasticStep
/** (C) Stochastic Rounding：以機率 p = frac(w_H) 輸出 ⌊w_H⌋ + 1，否則 ⌊w_H⌋。 */
export function stochasticStep(W: number, s: QState, c: QuantCtx): number {
  const lo = Math.floor(W / c.D) // 整數部分 ⌊w_H⌋
  const p = (W - lo * c.D) / c.D // 小數部分 p ∈ [0, 1)
  const bit = c.rand() < p ? 1 : 0 // ← 差異：用亂數決定是否進位（每次獨立；或 PRBS）
  const y = quantize((lo + bit) * c.D, s, c)
  s.n++
  return y
}
// #endregion

// #region core:deltaSigmaStep
/** (D) 一階 Error-Feedback ΔΣ：v = w_H + r[n−1]，y = Q_B(v)，r[n] = v − y ⇒ y = w_H + r[n−1] − r[n]。 */
export function deltaSigmaStep(W: number, s: QState, c: QuantCtx): number {
  const V = W + s.r // ← 差異：v[n] = w_H[n] + r[n−1]（把上一次的量化誤差加回來）
  const y = quantize(V, s, c) // y[n] = Q_B(v[n])
  s.r = residual(V - y * c.D, s, c) // ← 差異：r[n] = v[n] − y[n]（記住這次的誤差，下次補償）
  s.n++
  return y
}
// #endregion

// #region core:deltaSigmaDitherStep
/** (E) ΔΣ + Dither：dither 只加在量化器輸入；r 以未加 dither 的 v 為基準 ⇒ dither 也被 1 − z⁻¹ 塑形。 */
export function deltaSigmaDitherStep(W: number, s: QState, c: QuantCtx): number {
  const V = W + s.r // v[n] = w_H[n] + r[n−1]
  const d = c.dither() // ← 差異：d[n]（零平均；RPDF 或 TPDF）
  const y = quantize(V + d, s, c) // ← 差異：量化 v[n] + d[n]，打散週期性
  s.r = residual(V - y * c.D, s, c) // r[n] = v[n] − y[n]（不含 d，所以 d 也被一階塑形）
  s.n++
  return y
}
// #endregion

export const STEP: Record<QuantStrategy, (W: number, s: QState, c: QuantCtx) => number> = {
  freeze: freezeStep,
  toggle: toggleStep,
  stochastic: stochasticStep,
  deltaSigma: deltaSigmaStep,
  deltaSigmaDither: deltaSigmaDitherStep,
}

// ───────────────────────────────────────────────────────────────────────────
// 亂數來源：理想亂數與 PRBS（§13.3 的 PRBS 警告、§13.6 的 PRBS seed）
// ───────────────────────────────────────────────────────────────────────────

// #region core:prbs
/**
 * N-bit 最大長度 LFSR（Fibonacci，x^N + x^t + 1）。每次取一個 N-bit 字：移位 N 次。
 * 因 gcd(N, 2^N − 1) = 1，字序列的週期恰為 2^N − 1，且每個非零 N-bit 值在一個週期內恰出現一次
 * ⇒ u ∈ {1, …, 2^N − 1}/2^N：**有限長度、週期性、0 不會出現（微小偏差）**。
 */
export function createPrbs(bits: number, seed: number): () => number {
  const tap = PRBS_TAPS[bits]
  if (!tap) throw new Error(`PRBS 長度 N 只支援 ${Object.keys(PRBS_TAPS).join(', ')}，收到 ${bits}`)
  const mask = Math.pow(2, bits) - 1
  let s = (Math.floor(Math.abs(seed)) % mask) + 1 // 初始狀態不可為 0（0 是 LFSR 的死狀態）
  return () => {
    for (let i = 0; i < bits; i++) {
      const fb = ((s >>> (bits - 1)) ^ (s >>> (tap - 1))) & 1 // 回授 = s[N−1] ⊕ s[t−1]
      s = ((s << 1) | fb) & mask
    }
    return (s >>> 0) / (mask + 1)
  }
}
// #endregion

// #region core:dither
/**
 * dither 樣本 d（以 1/D LSB 為單位）。A 為峰對峰寬度 [LSB]：
 *   RPDF（uniform）：d = A(u − ½)，Var = A²/12；TPDF（triangular）：d = (A/2)(u₁ − u₂)，Var = A²/24。
 * rational / fixed 模式取整到 1/D 的格點（硬體 dither 也只有有限 bit）。
 */
export function makeDither(A: number, pdf: DitherPdf, rand: () => number, D: number, integer: boolean): () => number {
  return () => {
    const d = pdf === 'uniform' ? A * (rand() - 0.5) : (A / 2) * (rand() - rand())
    return integer ? Math.round(d * D) : d * D
  }
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 內部高解析目標 w_H[n]（含 LMS 更新雜訊、PVT drift、LMS freeze）
// ───────────────────────────────────────────────────────────────────────────

export interface TargetParams {
  /** w*（n = 0 時）[LSB] */
  target: number
  length: number
  /** 是否加入 LMS 更新雜訊 δw[n] */
  lmsNoise: boolean
  /** δw 的穩態 RMS σ_w [LSB] */
  sigmaW: number
  /** AR(1) pole p（ch12：p = 1 − μK） */
  pole: number
  /** PVT drift：w* 每 1000 次更新漂移多少 LSB */
  driftPerK: number
  /** LMS 在第幾次更新後凍結（0 = 不凍結）：之後 w_H 保持不變 */
  lmsFreezeAt: number
}

// #region core:lmsTarget
/**
 * w_H[n] = w*[n] + δw[n]。δw 是 LMS 更新雜訊（規格 §12）：δw[n+1] = p·δw[n] + μη[n]，
 * 這裡直接以穩態 RMS σ_w 參數化：δw[n+1] = p·δw[n] + √(1−p²)·σ_w·ξ[n]，ξ ~ N(0,1)。
 * w*[n] = w* + drift·n/1000（PVT 漂移）；LMS 凍結後 w_H 保持最後的值（但 w* 仍可能繼續漂移）。
 */
export function lmsTarget(p: TargetParams, rng: Rng): { wH: Float64Array; wStar: Float64Array } {
  const wH = new Float64Array(p.length)
  const wStar = new Float64Array(p.length)
  const sigma = p.lmsNoise ? p.sigmaW : 0
  const g = Math.sqrt(Math.max(0, 1 - p.pole * p.pole)) * sigma // 讓 Var(δw) 恰為 σ_w²
  let dw = sigma > 0 ? sigma * rng.normal() : 0 // 從穩態分布起跑（沒有暫態）
  for (let n = 0; n < p.length; n++) {
    wStar[n] = p.target + (p.driftPerK * n) / 1000
    const frozen = p.lmsFreezeAt > 0 && n >= p.lmsFreezeAt
    wH[n] = frozen ? wH[p.lmsFreezeAt - 1] : wStar[n] + dw
    if (sigma > 0) dw = p.pole * dw + g * rng.normal()
  }
  return { wH, wStar }
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 週期序列的譜線（E47）與 ZOH（sinc²）權重
// ───────────────────────────────────────────────────────────────────────────

export interface LineComponent {
  /** 諧波編號 k（頻率 = k·f_u/P） */
  k: number
  /** |c_k| = |DFT[k]|/P（peak 振幅的一半；k = 0 時為平均值） */
  mag: number
  /** one-sided 線功率 [LSB²]：0 < k < P/2 為 2|c_k|²，k = 0 或 P/2 為 |c_k|² */
  power: number
}

// #region core:lineSpectrum
/**
 * 一個週期 e[0..P−1] 的 DFT 係數 c_k = (1/P)·Σ_n e[n]·e^{−j2πkn/P}，以及 one-sided 線功率。
 * Parseval：Σ_k power_k = (1/P)·Σ_n e[n]²（總功率 = 各譜線功率和）。
 */
export function lineSpectrum(e: ArrayLike<number>): LineComponent[] {
  const P = e.length
  const out: LineComponent[] = []
  for (let k = 0; k <= Math.floor(P / 2); k++) {
    let re = 0
    let im = 0
    for (let n = 0; n < P; n++) {
      const th = (2 * Math.PI * ((k * n) % P)) / P // 先取 mod P，避免大角度的 cos/sin 誤差
      re += e[n] * Math.cos(th)
      im -= e[n] * Math.sin(th)
    }
    const mag = Math.hypot(re, im) / P
    const power = k === 0 || 2 * k === P ? mag * mag : 2 * mag * mag
    out.push({ k, mag, power })
  }
  return out
}
// #endregion

// #region core:zohWeight
/**
 * code 以 ZOH 保持 N_h 個較快的取樣（f_s = N_h·f_u）時，頻率 f = k·f_u/P 的振幅權重：
 *   |G_k| = |sin(πk/P) / (N_h·sin(πk/(P·N_h)))|（離散 sinc；N_h → ∞ 時趨近 |sinc(k/P)|）。
 * 線功率 = 2|c_{k mod P}|²·|G_k|²；k 為 P 的非零倍數時 |G_k| = 0（ZOH 的零點）。
 */
export function zohGain2(k: number, P: number, Nh: number): number {
  if (k % (P * Nh) === 0) return 1
  const num = Math.sin((Math.PI * k) / P)
  const den = Nh * Math.sin((Math.PI * k) / (P * Nh))
  return (num / den) ** 2
}
// #endregion

/** ZOH 後（f_s = N_h·f_u）的譜線：k = 1 … ⌊P·N_h/2⌋，回傳功率最大的 maxLines 條。 */
export function zohLines(e: ArrayLike<number>, Nh: number, maxLines = 12): LineComponent[] {
  const P = e.length
  const base = lineSpectrum(e)
  const cMag = (k: number) => {
    const km = mod(k, P)
    return base[km <= P / 2 ? km : P - km].mag
  }
  const out: LineComponent[] = []
  // 同一條基頻線 k₀ 的映像 k ≡ ±k₀ (mod P) 分子 sin²(πk/P) 相同、分母隨 k 遞增 ⇒ 功率隨 k 單調下降，
  // 所以功率前 maxLines 名一定落在 k ≤ (maxLines + 1)·P 內：只掃這一段即可（結果仍然精確，N_h 很大時不會卡住）。
  const kMax = Math.min(Math.floor((P * Nh) / 2), (maxLines + 1) * P)
  for (let k = 1; k <= kMax; k++) {
    const m = cMag(k)
    const g2 = zohGain2(k, P, Nh)
    const power = (2 * k === P * Nh ? 1 : 2) * m * m * g2
    if (power > 1e-18) out.push({ k, mag: m * Math.sqrt(g2), power })
  }
  out.sort((a, b) => b.power - a.power)
  return out.slice(0, maxLines)
}

// ───────────────────────────────────────────────────────────────────────────
// 週期的解析值（E15）
// ───────────────────────────────────────────────────────────────────────────

// #region core:efbPeriod
/**
 * 一階 EFB 對常數輸入 c = W/D（W、D 為整數）的 limit-cycle 週期（E15）：
 *   r[n] ≡ r[0] + n·c (mod 1) ⇒ 週期 = D / gcd(W mod D, D)；W mod D = 0（整數 c）時週期 1。
 * 例：c = 162/5 ⇒ 5；F = 10 bit 定點的 32.4（K = 33178）⇒ 1024/gcd(410, 1024) = 512。
 */
export function efbPeriod(W: number, D: number): number {
  const f = mod(W, D)
  return f === 0 ? 1 : D / gcd(f, D)
}
// #endregion

/** (B) pattern 的週期：L/gcd(k, L)；k = 0 或 L 時為 1。 */
export function togglePeriodOf(k: number, L: number): number {
  if (k <= 0 || k >= L) return 1
  return L / gcd(k, L)
}

/** 一個 w 值在 Bresenham pattern 中的 k（frac 以 1/L 表示）。 */
export function toggleK(w: number, L: number): { lo: number; k: number } {
  const lo = Math.floor(w)
  const k = Math.round((w - lo) * L)
  return { lo, k }
}

/** 產生 (B) 的 pattern（長度 L）：例如 toggleCycle(32.4, 5, 'spread') = [32,32,33,32,33]。 */
export function toggleCycle(w: number, L: number, order: ToggleOrder = 'spread'): number[] {
  const { lo, k } = toggleK(w, L)
  const out: number[] = []
  for (let m = 0; m < L; m++) {
    const bit = order === 'spread' ? Math.floor(((m + 1) * k) / L) - Math.floor((m * k) / L) : m >= L - k ? 1 : 0
    out.push(lo + bit)
  }
  return out
}

/** 若 a 是 b 的循環移位，回傳移位量 s（a[i] = b[(i + s) mod n]），否則 −1（E15 acceptance：常數 32.4 時 D ≡ B 只差相位）。 */
export function isRotation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return -1
  const n = a.length
  for (let shift = 0; shift < n; shift++) {
    let ok = true
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[(i + shift) % n]) {
        ok = false
        break
      }
    }
    if (ok) return shift
  }
  return -1
}

/** 常數或時變目標下的 Bernoulli 動差（T17）：E = lo + p、Var = p(1 − p)。 */
export function bernoulliMoments(lo: number, p: number): { mean: number; variance: number; rms: number } {
  const variance = p * (1 - p)
  return { mean: lo + p, variance, rms: Math.sqrt(variance) }
}

/**
 * w_H ~ N(m, σ²)（時變 LMS 雜訊）時 stochastic rounding 的量化誤差變異 E[p(1 − p)]，p = frac(w_H)。
 * 以 Simpson 法在 m ± 8σ 上數值積分（p(1 − p) 連續、只在整數處有折角，n 取大即可）；σ = 0 時為 frac(m)(1 − frac(m))。
 * 若 w_H 幾乎不越過整數（σ ≪ min(p₀, 1 − p₀)），E[p(1 − p)] ≈ p₀(1 − p₀) − σ²。
 */
export function stochasticQuantVar(m: number, sigma: number, n = 8000): number {
  const f0 = m - Math.floor(m)
  if (!(sigma > 0)) return f0 * (1 - f0)
  const a = m - 8 * sigma
  const h = (16 * sigma) / n
  let s = 0
  for (let i = 0; i <= n; i++) {
    const x = a + i * h
    const p = x - Math.floor(x)
    const pdf = Math.exp(-((x - m) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI))
    const wgt = i === 0 || i === n ? 1 : i % 2 ? 4 : 2
    s += wgt * pdf * p * (1 - p)
  }
  return (s * h) / 3
}

/** PRBS-N 字序列下 P(u < p) 的精確值：#{j ∈ 1…2^N−1 : j/2^N < p}/(2^N − 1)。 */
export function prbsProbability(p: number, bits: number): number {
  const M = Math.pow(2, bits)
  const count = Math.max(0, Math.min(M - 1, Math.ceil(p * M) - 1))
  return count / (M - 1)
}

// ───────────────────────────────────────────────────────────────────────────
// 白色近似的閉式（F-13.9 / F-13.10 / F-13.13）：章節內文與「帶入手算」題共用同一份
// ───────────────────────────────────────────────────────────────────────────

// #region core:whiteApprox
/** 一階 NTF 的功率響應 |1 − e^{−jΩ}|² = 4·sin²(πf/f_u)；fRel = f/f_u（0 … ½）。 */
export function ntfGain2(fRel: number): number {
  return 4 * Math.sin(Math.PI * fRel) ** 2
}

/** dither 的變異數 σ_d² [LSB²]（A 為峰對峰寬度 [LSB]）：RPDF A²/12、TPDF A²/24。 */
export function ditherVariance(A: number, pdf: DitherPdf = 'uniform'): number {
  return pdf === 'uniform' ? (A * A) / 12 : (A * A) / 24
}

/** 白色近似下 ΔΣ 內部誤差 r 的變異數：σ_r² ≈ 1/12 + σ_d²（均勻的量化誤差 + 與它不相關的 dither）。 */
export function efbResidualVar(sigmaD2 = 0): number {
  return 1 / 12 + sigmaD2
}

/** 白色近似下一階 EFB 的總誤差功率 E[e²] ≈ 2σ_r²（e = r[n−1] − r[n]、r 前後不相關；A ≳ 1 LSB 才準，勘誤 E15）。 */
export function efbWhitePower(sigmaR2: number): number {
  return 2 * sigmaR2
}

/**
 * 白色近似下一階 EFB 在 0 … f_B 的頻帶內誤差功率 [LSB²]，x = f_B/f_u：
 *   exact  ：∫₀^{f_B} 4·sin²(πf/f_u)·(2σ_r²/f_u) df = σ_r²·(4x − 2·sin(2πx)/π)
 *   lowFreq：sin θ ≈ θ ⇒ (8π²/3)·σ_r²·x³（F-13.13）；相對誤差約 (πx)²/5，x ≤ 1/16 時小於 1%。
 */
export function efbInbandWhite(sigmaR2: number, fBRel: number): { exact: number; lowFreq: number } {
  return {
    exact: sigmaR2 * (4 * fBRel - (2 * Math.sin(2 * Math.PI * fBRel)) / Math.PI),
    lowFreq: ((8 * Math.PI ** 2) / 3) * sigmaR2 * fBRel ** 3,
  }
}

/**
 * w_H ~ N(w*, σ_w²) 且幾乎不越過整數時，stochastic rounding 量化誤差變異的閉式近似（F-13.13）：
 *   E[p(1 − p)] ≈ p₀(1 − p₀) − σ_w²，p₀ = frac(w*)。含「越過整數的尾巴」的精確值用 stochasticQuantVar()。
 */
export function stochasticQuantVarApprox(p0: number, sigma: number): number {
  return p0 * (1 - p0) - sigma * sigma
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// 量化格點（rational / fixed / float）
// ───────────────────────────────────────────────────────────────────────────

export interface Grid {
  arithmetic: Arithmetic
  /** 單位分母 D */
  D: number
  /** rational 模式：目標的最簡分數 p/q */
  p?: number
  q?: number
  /** 實際表示的常數目標 W0/D [LSB]（fixed 會與輸入略有差異） */
  represented: number
  /** W0 = 目標在 1/D 單位下的值 */
  W0: number
  /** 整數運算？ */
  integer: boolean
  notes: string[]
}

export function makeGrid(target: number, arithmetic: Arithmetic, fracBits: number): Grid {
  if (arithmetic === 'float') return { arithmetic, D: 1, represented: target, W0: target, integer: false, notes: [] }
  if (arithmetic === 'fixed') {
    if (!Number.isInteger(fracBits) || fracBits < 0 || fracBits > 30) throw new Error(`F（小數 bit）必須是 0…30 的整數，收到 ${fracBits}`)
    const D = Math.pow(2, fracBits)
    const W0 = Math.round(target * D)
    return { arithmetic, D, W0, represented: W0 / D, integer: true, notes: [] }
  }
  const { p, q, err } = rationalApprox(target)
  const D = q * Math.pow(2, RATIONAL_EXTRA_BITS)
  const W0 = p * Math.pow(2, RATIONAL_EXTRA_BITS)
  const notes: string[] = []
  if (Math.abs(err) > 1e-12 * Math.max(1, Math.abs(target)))
    notes.push(`目標無法以分母 ≤ 10⁶ 的分數精確表示，改用 ${p}/${q}（差 ${err.toExponential(2)} LSB）`)
  return { arithmetic, D, p, q, W0, represented: p / q, integer: true, notes }
}

// ───────────────────────────────────────────────────────────────────────────
// 單一策略模擬
// ───────────────────────────────────────────────────────────────────────────

export interface QuantizerSetup {
  bits: number
  rounding: RoundingMode
  overflow: OverflowMode
  antiWindup: boolean
  togglePeriod: number
  toggleOrder: ToggleOrder
  randomSource: RandomSource
  prbsBits: number
  ditherLsb: number
  ditherPdf: DitherPdf
}

export interface StrategySim {
  /** 6-bit code y[n] */
  y: Int32Array
  /** 量化器輸入 v[n] = w_H + r[n−1]（ΔΣ；其他策略為 w_H）[LSB] */
  v: Float64Array
  /** ΔΣ 內部誤差 r[n]（其他策略為 0）[LSB] */
  r: Float64Array
  overflow: number
  windup: number
}

/** 依設定建立 QuantCtx（亂數流以 seed + 策略名稱 fork，與其他雜訊源互不影響）。 */
export function makeCtx(setup: QuantizerSetup, grid: Grid, strategy: QuantStrategy, seed: number): QuantCtx {
  const nCodes = Math.pow(2, setup.bits)
  const D = grid.D
  const rootSeed = createRng(seed).fork(`quant-${strategy}`).seed
  const rand =
    setup.randomSource === 'prbs' ? createPrbs(setup.prbsBits, rootSeed) : (() => {
      const r = createRng(rootSeed)
      return () => r.uniform()
    })()
  const A = strategy === 'deltaSigmaDither' ? setup.ditherLsb : 0
  const halfA = A / 2 // RPDF 與 TPDF 的峰對峰寬度都是 A
  const [lo, hi] = setup.rounding === 'nearest' ? [-0.5 - halfA, 0.5 + halfA] : [-halfA, 1 + halfA]
  return {
    D,
    rounding: setup.rounding,
    overflow: setup.overflow,
    maxCode: nCodes - 1,
    nCodes,
    antiWindup: setup.antiWindup,
    rLo: lo * D,
    rHi: hi * D,
    togglePeriod: setup.togglePeriod,
    toggleOrder: setup.toggleOrder,
    rand,
    dither: makeDither(A, setup.ditherPdf, rand, D, grid.integer),
  }
}

/**
 * 以整數單位 W[n]（= w_H[n]·D）跑一個策略。freezeW 為 (A) 凍結的 w*（以 1/D 為單位）。
 * rInit 為 ΔΣ 的初始 r[−1]（以 LSB 為單位）。
 */
export function simulateStrategy(
  strategy: QuantStrategy,
  W: ArrayLike<number>,
  ctx: QuantCtx,
  opts: { freezeW: number; rInit?: number; integer?: boolean } = { freezeW: 0 },
): StrategySim {
  const L = W.length
  const y = new Int32Array(L)
  const v = new Float64Array(L)
  const r = new Float64Array(L)
  const rInit = opts.rInit ?? 0
  const s: QState = {
    n: 0,
    r: opts.integer === false ? rInit * ctx.D : Math.round(rInit * ctx.D),
    wFreeze: opts.freezeW,
    overflow: 0,
    windup: 0,
  }
  const step = STEP[strategy]
  const isDs = strategy === 'deltaSigma' || strategy === 'deltaSigmaDither'
  for (let n = 0; n < L; n++) {
    const before = s.r
    y[n] = step(W[n], s, ctx)
    v[n] = isDs ? (W[n] + before) / ctx.D : strategy === 'freeze' ? opts.freezeW / ctx.D : W[n] / ctx.D
    r[n] = isDs ? s.r / ctx.D : 0
  }
  return { y, v, r, overflow: s.overflow, windup: s.windup }
}

/**
 * 常數目標的一階 EFB（T16 / quantizer_first_order.json 用）：回傳 y 與 r（rational 精確）。
 * target 以 p/q 給定可避免任何浮點誤差。
 */
export function efbConstant(opts: {
  target: number
  steps: number
  bits?: number
  rounding?: RoundingMode
  rInit?: number
  arithmetic?: Arithmetic
  fracBits?: number
}): { y: number[]; r: number[]; v: number[]; D: number; W: number } {
  const grid = makeGrid(opts.target, opts.arithmetic ?? 'rational', opts.fracBits ?? 16)
  const setup: QuantizerSetup = {
    bits: opts.bits ?? 6,
    rounding: opts.rounding ?? 'nearest',
    overflow: 'saturate',
    antiWindup: false,
    togglePeriod: 5,
    toggleOrder: 'spread',
    randomSource: 'ideal',
    prbsBits: 7,
    ditherLsb: 0,
    ditherPdf: 'uniform',
  }
  const ctx = makeCtx(setup, grid, 'deltaSigma', 1)
  const W = new Float64Array(opts.steps).fill(grid.W0)
  const sim = simulateStrategy('deltaSigma', W, ctx, { freezeW: grid.W0, rInit: opts.rInit ?? 0, integer: grid.integer })
  return { y: Array.from(sim.y), r: Array.from(sim.r), v: Array.from(sim.v), D: grid.D, W: grid.W0 }
}

// ───────────────────────────────────────────────────────────────────────────
// Code error × DSM residue → DTC timing error（§13.5 第 6 點、§12.2）
// ───────────────────────────────────────────────────────────────────────────

// #region core:mixing
/**
 * δt[n] = Δ_LSB · (y[m] − w*[m]) · x[n]  [fs]，m = ⌊n/N_upd⌋（code 以 ZOH 保持 N_upd 個 reference cycle）。
 * x[n] 是 DSM residue（正規化 regressor）。注意是「乘號」：code 誤差把 DSM residue 的頻譜搬移／展寬（§12.2）。
 */
export function mixWithResidue(eCode: ArrayLike<number>, nUpd: number, x: ArrayLike<number>, lsbFs: number): Float64Array {
  const out = new Float64Array(x.length)
  for (let n = 0; n < x.length; n++) out[n] = lsbFs * eCode[Math.floor(n / nUpd)] * x[n]
  return out
}
// #endregion

/** 二階 type-II PLL 的 |T(f)|²（CT 原型，ζ、−3 dB 頻寬 f_bw）。[近似｜f ≪ f_s] */
export function pllT2(f: ArrayLike<number>, bwHz: number, zeta: number): Float64Array {
  const wn = wnFromBandwidth3dB(2 * Math.PI * bwHz, zeta)
  const out = new Float64Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const t = ctT(2 * Math.PI * f[i], { zeta, wn })
    out[i] = t.re * t.re + t.im * t.im
  }
  return out
}

/**
 * Welch PSD 上「統計顯著」的譜線：先用 findTones（prominence ≥ 15 dB）找候選，再要求峰值高於局部雜訊平均的
 * x 倍。x 取 χ²_ν/ν 的 Wilson–Hilferty 6σ 上界（ν ≈ 1.8 × 段數：Hann、50% overlap 的等效自由度），
 * 局部平均由 ±40 bins（排除峰旁 ±4 bins）的中位數換算。段數少時雜訊 PSD 起伏很大，單靠 prominence
 * 會把雜訊的起伏誤判為 tone（例如 stochastic rounding 的白色誤差）。
 */
export function significantTones(ps: PsdResult, opts: { maxTones?: number; fMin?: number } = {}): DetectedTone[] {
  const maxTones = opts.maxTones ?? 12
  const cands = findTones(ps.f, ps.psd, { minProminenceDb: 15, maxTones: maxTones * 4, lobeHalfWidthBins: 2, fMin: opts.fMin })
  const nu = Math.max(2, 1.8 * ps.nSegments)
  const a = 2 / (9 * nu)
  const xThr = (1 - a + 6 * Math.sqrt(a)) ** 3 // P(χ²_ν/ν > xThr) ≈ 1e-9
  const medToMean = (1 - a) ** 3 // χ²_ν/ν 的中位數 ≈ (1 − 2/(9ν))³
  const out: DetectedTone[] = []
  for (const t of cands) {
    const lo = Math.max(1, t.index - 40)
    const hi = Math.min(ps.psd.length - 1, t.index + 40)
    const vals: number[] = []
    for (let i = lo; i <= hi; i++) if (Math.abs(i - t.index) > 4) vals.push(ps.psd[i])
    if (vals.length < 8) continue
    vals.sort((x, y) => x - y)
    const localMean = vals[Math.floor(vals.length / 2)] / medToMean
    if (t.peakPsd > xThr * localMean) out.push(t)
    if (out.length >= maxTones) break
  }
  return out
}

/** 顯示用：log 頻率軸的 max-hold 抽點（保留譜線峰值）。f[0] = 0 的 DC 點會略去。 */
export function decimateLogMax(f: ArrayLike<number>, psd: ArrayLike<number>, nBins = 1200): { f: Float64Array; psd: Float64Array } {
  const n = f.length
  if (n <= nBins) {
    const ff: number[] = []
    const pp: number[] = []
    for (let i = 0; i < n; i++) {
      if (f[i] > 0) {
        ff.push(f[i])
        pp.push(psd[i])
      }
    }
    return { f: Float64Array.from(ff), psd: Float64Array.from(pp) }
  }
  const f1 = f[1]
  const fN = f[n - 1]
  const lr = Math.log(fN / f1)
  const outF: number[] = []
  const outP: number[] = []
  let bin = -1
  let bestP = -Infinity
  let bestF = 0
  for (let i = 1; i < n; i++) {
    const b = Math.min(nBins - 1, Math.floor((Math.log(f[i] / f1) / lr) * nBins))
    if (b !== bin && bin >= 0) {
      outF.push(bestF)
      outP.push(bestP)
      bestP = -Infinity
    }
    bin = b
    if (psd[i] > bestP) {
      bestP = psd[i]
      bestF = f[i]
    }
  }
  if (bestP > -Infinity) {
    outF.push(bestF)
    outP.push(bestP)
  }
  return { f: Float64Array.from(outF), psd: Float64Array.from(outP) }
}

// ───────────────────────────────────────────────────────────────────────────
// Worker 入口：Quantized Gain Lab（experiment 'quantized-gain-lab'）
// ───────────────────────────────────────────────────────────────────────────

export interface QuantLabParams extends QuantizerSetup {
  /** w*（n = 0）[LSB] */
  target: number
  arithmetic: Arithmetic
  /** fixed 模式的小數 bit F */
  fracBits: number
  /** 模擬的 code 更新次數 L */
  length: number
  /** reference / DTC 取樣率 f_s [Hz] */
  fs: number
  /** 每 N_upd 個 reference cycle 更新一次 code ⇒ f_u = f_s/N_upd */
  nUpd: number
  lmsNoise: boolean
  sigmaW: number
  pole: number
  driftPerK: number
  lmsFreezeAt: number
  /** Δ_LSB [fs/LSB]（勘誤 E13） */
  lsbFs: number
  /** 是否計算 DSM residue mixing 與 PLL output jitter */
  mixing: boolean
  dsmKind: DsmKind
  dsmFrac: number
  pllBwHz: number
  pllZeta: number
  /** mixing 模擬的 reference-cycle 樣本數上限 */
  mixSamples: number
  /** Welch segment 長度（code 誤差 PSD） */
  nperseg: number
  seed: number
  /** ΔΣ 初始 r[−1] [LSB] */
  rInit: number
  /** 回傳的 timeline 長度 */
  traceLen?: number
}

export interface CaseSpec {
  id: string
  strategy: QuantStrategy
  lmsNoise: boolean
  nUpd: number
}

export interface SpurLine {
  /** 頻率 [Hz]（code 更新率 f_u 為取樣率） */
  f: number
  /** 線功率 [LSB²] */
  power: number
  /** 10·log10(power / 1 LSB²) */
  powerDb: number
  /** 諧波 k（週期 P 時頻率 = k f_u/P）；Welch 偵測時為 null */
  k: number | null
}

export interface StrategyMetrics {
  meanCode: number
  meanTarget: number
  /** DC 誤差 mean(y − w*)，δw = w − w* 約定 [LSB]（E49） */
  dcError: number
  /** 總誤差功率 mean((y − w*)²) [LSB²] */
  errPower: number
  /** 誤差變異數（去 DC） */
  errVar: number
  /** 只看量化：mean((y − w_H)²) [LSB²] */
  quantErrPower: number
  /** δw = w_H − w* 的功率（LMS 本身）[LSB²] */
  lmsErrPower: number
  /**
   * 低頻誤差功率：DC² + ∫_0^{f_u/64} S_e df（OSR = 32 的「頻帶內」）[LSB²]。
   * 常數情境且偵測到解析週期時，改用一個週期的精確線譜加總（lfExact = true），否則為 Welch 估計。
   */
  lfErrPower: number
  /** 只看量化誤差 ε = y − w_H 的頻帶內功率（DC² + ∫_0^{f_u/64} S_ε df）[LSB²]；不含 LMS 雜訊與 ε–δw 的交叉項 */
  lfQuantPower: number
  /** lfErrPower / lfQuantPower 是否為精確線譜加總（否則為 Welch 估計） */
  lfExact: boolean
  /** 低頻頻帶上緣 f_u/64 [Hz] */
  lfBandHz: number
  /** 同一頻帶內 LMS 雜訊 δw = w_H − w* 本身的功率（量化前的地板）[LSB²] */
  lfLmsPower: number
  /** 量化誤差 ε = y − w_H 的變異數 [LSB²]（stochastic 時 ≈ E[p(1 − p)]） */
  quantErrVar: number
  /** 最後 1/4 紀錄的 DC 誤差（PVT 追蹤）[LSB] */
  trackDcError: number
  /** 使用的 code 數 */
  levels: number
  codeMin: number
  codeMax: number
  /** code 改變的比例（每次更新）：glitch / switching 活動量 */
  toggleRate: number
  /** 偵測到的週期（0 = 未偵測到） */
  period: number
  /** 解析週期（無則 null） */
  periodAnalytic: number | null
  /** 偵測窗口能看到的最大週期 */
  periodLimit: number
  overflow: number
  windup: number
  /** 最大譜線 */
  maxSpur: SpurLine | null
}

export interface StrategyTheory {
  claim: 'exact' | 'approx'
  mean: number
  dcError: number
  errPower: number
  variance: number
  period: number | null
  note: string
}

export interface MixResult {
  /** 抽點後的 δt PSD（顯示用）[fs²/Hz] */
  f: Float64Array
  psd: Float64Array
  /** δt 的 RMS（未經 PLL，含靜態偏移）[fs] */
  sigmaRawFs: number
  /** ∫_{f_L}^{f_s/2}|T|²S_δt df 的平方根 [fs]；只含 f ≥ f_L 的成分 */
  sigmaOutFs: number
  /** 積分下限 f_L = Welch 的頻率解析度 f_s/nperseg [Hz]：比它慢的成分在每段去平均時被移除 */
  fLowHz: number
  /** 整段紀錄的平均 mean(δt) [fs]：靜態 timing 偏移（PLL 會吸收，不算 jitter）或紀錄長度內分辨不出的慢變成分 */
  meanFs: number
  /**
   * f < f_L 的慢變成分 RMS [fs]：不重疊區塊（長度 nperseg）的平均值相對於整段平均的 RMS。
   * 區塊少於 4 個時無法估計（null）。這些成分通常在 PLL 頻寬內（|T| ≈ 1），但**沒有**計入 sigmaOutFs。
   */
  slowRmsFs: number | null
  /** Welch 段數（只有 1 段時 PSD 每個 bin 的估計誤差約 100%，積分值仍可用） */
  nSegments: number
  /**
   * 混頻產物的週期 lcm(P_code·N_upd, P_DSM) [reference cycles]：code 為週期序列且 DSM 為一階時才有（否則 null）。
   * 大於紀錄長度 samples 時，比 f_s/samples 更慢的差頻分辨不出來——只會以「靜態偏移」的樣子出現。
   */
  productPeriod: number | null
  /** δt PSD 最大譜線（Welch + findTones，近似）[fs²] */
  maxTone: { f: number; power: number } | null
  samples: number
  codesUsed: number
  fs: number
  nperseg: number
  enbwHz: number
  warnings: string[]
}

export interface StrategyRun {
  key: string
  strategy: QuantStrategy
  label: string
  lmsNoise: boolean
  nUpd: number
  fu: number
  grid: Omit<Grid, 'notes'>
  trace: { n: Float64Array; y: Float64Array; wH: Float64Array; wStar: Float64Array; v: Float64Array; r: Float64Array }
  hist: { codes: number[]; counts: number[] }
  metrics: StrategyMetrics
  theory: StrategyTheory | null
  /** code 誤差 e = y − w* 的 Welch PSD（one-sided，LSB²/Hz，Hann，去平均） */
  psd: { f: Float64Array; psd: Float64Array; theory: Float64Array | null; lmsRef: Float64Array | null; nperseg: number; nSegments: number; enbwHz: number; df: number; window: string; warnings: string[] }
  /** 譜線表（週期時為精確 DFT，否則為 Welch + findTones 的近似） */
  lines: SpurLine[]
  linesExact: boolean
  /** ZOH 到 f_s 後的譜線（週期且 N_upd > 1 時） */
  zohLines: SpurLine[] | null
  /** 一個週期的 code（週期 ≤ 64 時） */
  cycle: number[] | null
  /** 與 rational 精確模型逐 sample 比較（常數情境） */
  bitTrue: { reference: 'rational'; mismatches: number; firstIndex: number } | null
  mixing: MixResult | null
  warnings: string[]
}

export interface QuantLabInput {
  params: QuantLabParams
  cases: CaseSpec[]
  /** 是否在同一情境下跑完五種策略 */
  compareAll: boolean
  /** 五策略比較的情境（預設取 params.lmsNoise / params.nUpd） */
  compareScenario?: { lmsNoise: boolean; nUpd: number }
}

export interface QuantLabResult {
  /** 與 input.cases 一一對應 */
  caseIds: string[]
  runs: StrategyRun[]
  /** 五策略比較（同一情境、同 seed） */
  compare: StrategyRun[]
  compareScenario: { lmsNoise: boolean; nUpd: number }
  warnings: string[]
  durationHint: string
}

function isConstantScenario(p: QuantLabParams, lmsNoise: boolean): boolean {
  return !lmsNoise && p.driftPerK === 0
}

function strategyTheory(strategy: QuantStrategy, p: QuantLabParams, grid: Grid, ctx: QuantCtx): StrategyTheory {
  const c = grid.represented
  const lo = Math.floor(c)
  const frac = c - lo
  const target = p.target
  const fz = quantize(grid.W0, { n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 }, ctx)
  switch (strategy) {
    case 'freeze': {
      const dc = fz - target
      return { claim: 'exact', mean: fz, dcError: dc, errPower: dc * dc, variance: 0, period: 1, note: 'y ≡ Q_B(w*)：誤差全在 DC' }
    }
    case 'toggle': {
      const { k } = toggleK(c, p.togglePeriod)
      const q = k / p.togglePeriod
      const mean = lo + q
      const dc = mean - target
      const variance = q * (1 - q)
      return {
        claim: 'exact',
        mean,
        dcError: dc,
        errPower: variance + dc * dc,
        variance,
        period: togglePeriodOf(k, p.togglePeriod),
        note: `k = ${k}/${p.togglePeriod}：平均 ⌊w⌋ + k/L，變異 (k/L)(1 − k/L)`,
      }
    }
    case 'stochastic': {
      const pr = p.randomSource === 'prbs' ? prbsProbability(frac, p.prbsBits) : frac
      const m = bernoulliMoments(lo, pr)
      const dc = m.mean - target
      return {
        claim: 'exact',
        mean: m.mean,
        dcError: dc,
        errPower: m.variance + dc * dc,
        variance: m.variance,
        period: p.randomSource === 'prbs' ? Math.pow(2, p.prbsBits) - 1 : null,
        note: p.randomSource === 'prbs' ? `PRBS-${p.prbsBits}：P(33) = ${pr.toFixed(6)}（一整個週期的精確值）` : 'E = ⌊w⌋ + p、Var = p(1 − p)（期望值；模擬為有限樣本）',
      }
    }
    case 'deltaSigma': {
      const variance = frac * (1 - frac)
      const dc = c - target
      return {
        claim: 'exact',
        mean: c,
        dcError: dc,
        errPower: variance + dc * dc,
        variance,
        period: grid.integer ? efbPeriod(grid.W0, grid.D) : null,
        note: '常數輸入：只用 ⌊c⌋ 與 ⌊c⌋+1 兩階 ⇒ 誤差功率 p(1 − p)，週期 D/gcd（E15）',
      }
    }
    case 'deltaSigmaDither': {
      const sd2 = p.ditherPdf === 'uniform' ? p.ditherLsb ** 2 / 12 : p.ditherLsb ** 2 / 24
      const variance = 2 * (1 / 12 + sd2)
      const dc = c - target
      return {
        claim: 'approx',
        mean: c,
        dcError: dc,
        errPower: variance + dc * dc,
        variance,
        period: null,
        note: '白色近似：e = −(1 − z⁻¹)r，Var(r) ≈ 1/12 + σ_d² ⇒ 2(1/12 + σ_d²)（A ≳ 1 LSB 才準）',
      }
    }
  }
}

function errorPsdTheory(strategy: QuantStrategy, p: QuantLabParams, f: Float64Array, fu: number, variance: number): Float64Array | null {
  const out = new Float64Array(f.length)
  if (strategy === 'stochastic' && p.randomSource === 'ideal') {
    out.fill((2 * variance) / fu)
    return out
  }
  if (strategy === 'deltaSigmaDither') {
    const sd2 = p.ditherPdf === 'uniform' ? p.ditherLsb ** 2 / 12 : p.ditherLsb ** 2 / 24
    const sr2 = 1 / 12 + sd2
    for (let i = 0; i < f.length; i++) out[i] = 4 * Math.sin((Math.PI * f[i]) / fu) ** 2 * ((2 * sr2) / fu)
    return out
  }
  return null
}

function ar1Psd(f: Float64Array, fu: number, sigma: number, pole: number): Float64Array {
  const out = new Float64Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const om = (2 * Math.PI * f[i]) / fu
    const den = 1 - 2 * pole * Math.cos(om) + pole * pole
    out[i] = ((2 / fu) * sigma * sigma * (1 - pole * pole)) / den
  }
  return out
}

function histogramCodes(y: Int32Array): { codes: number[]; counts: number[] } {
  const map = new Map<number, number>()
  for (let i = 0; i < y.length; i++) map.set(y[i], (map.get(y[i]) ?? 0) + 1)
  const codes = [...map.keys()].sort((a, b) => a - b)
  return { codes, counts: codes.map((c) => map.get(c) ?? 0) }
}

const toDb = (x: number) => 10 * Math.log10(Math.max(x, 1e-300))

/** 純資料的深複製（typed array 取得新的 buffer）；不依賴 structuredClone 的存在與否。 */
function deepCopy<T>(x: T): T {
  if (x === null || typeof x !== 'object') return x
  if (ArrayBuffer.isView(x)) return (x as unknown as Float64Array).slice() as unknown as T
  if (Array.isArray(x)) return x.map((v) => deepCopy(v)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) out[k] = deepCopy(v)
  return out as T
}

interface Shared {
  target: { wH: Float64Array; wStar: Float64Array }
  W: Float64Array
  grid: Grid
  constantW: boolean
}

function buildShared(p: QuantLabParams, lmsNoise: boolean): Shared {
  const rng = createRng(p.seed).fork('lms-noise')
  const target = lmsTarget(
    { target: p.target, length: p.length, lmsNoise, sigmaW: p.sigmaW, pole: p.pole, driftPerK: p.driftPerK, lmsFreezeAt: p.lmsFreezeAt },
    rng,
  )
  const grid = makeGrid(p.target, p.arithmetic, p.fracBits)
  const W = new Float64Array(p.length)
  const constantW = isConstantScenario(p, lmsNoise)
  for (let n = 0; n < p.length; n++) {
    if (!grid.integer) W[n] = target.wH[n]
    else W[n] = constantW ? grid.W0 : Math.round(target.wH[n] * grid.D)
  }
  return { target, W, grid, constantW }
}

/** 單一策略 + 情境的完整分析。dsmCache 讓同一批次共用 DSM residue。 */
function analyzeRun(
  p: QuantLabParams,
  strategy: QuantStrategy,
  lmsNoise: boolean,
  nUpd: number,
  sharedCache: Map<string, Shared>,
  dsmCache: Map<string, { code: Float64Array; K: number }>,
): StrategyRun {
  const warnings: string[] = []
  const sKey = lmsNoise ? 'noise' : 'const'
  let shared = sharedCache.get(sKey)
  if (!shared) {
    shared = buildShared(p, lmsNoise)
    sharedCache.set(sKey, shared)
  }
  const { grid, W, target, constantW } = shared
  warnings.push(...grid.notes)
  if (p.arithmetic === 'rational' && !constantW)
    warnings.push(`rational 模式在 w_H 時變時，以分母 D = q·2^${RATIONAL_EXTRA_BITS} 的格點表示 w_H[n]（仍為整數精確運算，但 w_H 本身已被取整）`)
  const ctx = makeCtx(p, grid, strategy, p.seed)
  const sim = simulateStrategy(strategy, W, ctx, { freezeW: grid.W0, rInit: p.rInit, integer: grid.integer })
  const L = p.length
  const fu = p.fs / nUpd

  // ── 誤差序列與統計 ──
  const e = new Float64Array(L)
  const qe = new Float64Array(L)
  let sumY = 0
  let sumT = 0
  let sumE = 0
  let sumE2 = 0
  let sumQ = 0
  let sumQ2 = 0
  let sumL2 = 0
  let wHdiffers = false
  let toggles = 0
  let codeMin = Infinity
  let codeMax = -Infinity
  const q4 = Math.floor((3 * L) / 4)
  let sumTrack = 0
  for (let n = 0; n < L; n++) {
    const yn = sim.y[n]
    e[n] = yn - target.wStar[n]
    sumY += yn
    sumT += target.wStar[n]
    sumE += e[n]
    sumE2 += e[n] * e[n]
    qe[n] = yn - target.wH[n]
    sumQ += qe[n]
    sumQ2 += qe[n] * qe[n]
    const le = target.wH[n] - target.wStar[n]
    sumL2 += le * le
    if (le !== 0) wHdiffers = true
    if (n > 0 && yn !== sim.y[n - 1]) toggles++
    if (yn < codeMin) codeMin = yn
    if (yn > codeMax) codeMax = yn
    if (n >= q4) sumTrack += e[n]
  }
  const dcError = sumE / L
  const errPower = sumE2 / L
  const errVar = Math.max(0, errPower - dcError * dcError)
  const qMean = sumQ / L
  const hist = histogramCodes(sim.y)

  // ── 週期偵測（比較整數 code 序列；E15）──
  const start = Math.floor(L / 4)
  const periodLimit = Math.floor((L - start) / 2)
  const period = detectPeriod(sim.y, { start })
  let periodAnalytic: number | null = null
  const theory = constantW ? strategyTheory(strategy, p, grid, ctx) : null
  if (constantW) {
    if (strategy === 'freeze') periodAnalytic = 1
    else if (strategy === 'toggle') periodAnalytic = togglePeriodOf(toggleK(grid.represented, p.togglePeriod).k, p.togglePeriod)
    else if (strategy === 'deltaSigma' && grid.integer && sim.overflow === 0) periodAnalytic = efbPeriod(grid.W0, grid.D)
    else if (strategy === 'stochastic' && p.randomSource === 'prbs') periodAnalytic = Math.pow(2, p.prbsBits) - 1
  } else if (p.lmsFreezeAt > 0 && p.lmsFreezeAt <= start && strategy === 'deltaSigma' && grid.integer && sim.overflow === 0) {
    // Freeze/Track：LMS 凍結後 w_H 停在定點常數 W[n_f − 1]/D，一階 EFB 重新落入週期 D/gcd 的 limit cycle（E15）。
    // 只有偵測窗口（從 L/4 起）完全落在凍結之後時才有意義。
    periodAnalytic = efbPeriod(W[p.lmsFreezeAt - 1], grid.D)
  }
  if (periodAnalytic !== null && periodAnalytic > periodLimit)
    warnings.push(`解析週期 ${periodAnalytic} 大於可偵測上限 ${periodLimit}（需至少重複 2 次）：請加長紀錄 L`)

  // ── PSD（Welch，Hann，one-sided，去平均）──
  const nperseg = Math.min(p.nperseg, L)
  const ps: PsdResult = welch(e, fu, { nperseg, window: 'hann', detrend: 'constant' })
  const theoryPsd = theory ? errorPsdTheory(strategy, p, ps.f, fu, theory.variance) : null
  const lfBandHz = fu / LF_OSR_DIV
  let lfErrPower = dcError * dcError + integratePsd(ps.f, ps.psd, 0, lfBandHz)
  let lfQuantPower = lfErrPower
  let lfExact = false
  if (wHdiffers) {
    // w_H ≠ w*（LMS 雜訊或 LMS 凍結後 w* 仍漂移）：ε = y − w_H 與 e = y − w* 不同，另外估計
    const pq = welch(qe, fu, { nperseg, window: 'hann', detrend: 'constant' })
    lfQuantPower = qMean * qMean + integratePsd(pq.f, pq.psd, 0, lfBandHz)
  }
  let lfLmsPower = 0
  if (lmsNoise && p.sigmaW > 0) {
    const dw = new Float64Array(L)
    let mdw = 0
    for (let n = 0; n < L; n++) {
      dw[n] = target.wH[n] - target.wStar[n]
      mdw += dw[n] / L
    }
    const pdw = welch(dw, fu, { nperseg, window: 'hann', detrend: 'constant' })
    lfLmsPower = mdw * mdw + integratePsd(pdw.f, pdw.psd, 0, lfBandHz)
  }
  const lmsRef = lmsNoise && p.sigmaW > 0 ? ar1Psd(ps.f, fu, p.sigmaW, p.pole) : null

  // ── 譜線表 ──
  let lines: SpurLine[] = []
  let linesExact = false
  let cycle: number[] | null = null
  let zl: SpurLine[] | null = null
  // 只有在「偵測到的週期 = 解析週期」（或沒有解析值）時才把一個週期的 DFT 當成精確譜線
  const steadyOk = constantW && period > 0 && period <= 4096 && p.lmsFreezeAt === 0 && (periodAnalytic === null || periodAnalytic === period)
  if (steadyOk) {
    const seg = Array.from(sim.y.subarray(start, start + period), (yn) => yn - p.target)
    const comps = lineSpectrum(seg)
    // 頻帶內功率（精確）：穩態一個週期的 DC² + 所有 k·f_u/P ≤ f_u/64 的線功率（Parseval；不受 Welch 洩漏影響）
    let lfSum = 0
    for (const cmp of comps) if ((cmp.k * fu) / period <= lfBandHz * (1 + 1e-12)) lfSum += cmp.power
    lfErrPower = lfSum
    lfQuantPower = lfSum // 常數情境 w_H = w*，ε = e
    lfExact = true
    lines = comps
      .filter((cmp) => cmp.k > 0 && cmp.power > 1e-15)
      .map((cmp) => ({ f: (cmp.k * fu) / period, power: cmp.power, powerDb: toDb(cmp.power), k: cmp.k }))
      .sort((a, b) => b.power - a.power)
      .slice(0, 12)
    linesExact = true
    if (period <= 64) cycle = Array.from(sim.y.subarray(start, start + period))
    if (nUpd > 1) {
      zl = zohLines(seg, nUpd, 12).map((cmp) => ({ f: (cmp.k * fu) / period, power: cmp.power, powerDb: toDb(cmp.power), k: cmp.k }))
    }
  } else if (errVar > 1e-12 * Math.max(1, errPower)) {
    // 誤差為常數（例如 Freeze）時 errVar 只剩捨入誤差，不可去找 tone（否則會「偵測」到 1e-60 的假譜線）。
    // fMin = 3Δf：去平均後殘留的漂移 / 低頻洩漏不算 tone
    const tones = significantTones(ps, { maxTones: 12, fMin: 3 * ps.df })
    lines = tones.filter((t) => t.power > 1e-9 * errVar).map((t) => ({ f: t.fCentroid, power: t.power, powerDb: toDb(t.power), k: null }))
  }

  // ── 與精確模型逐 sample 比較（常數情境）──
  let bitTrue: StrategyRun['bitTrue'] = null
  if (constantW && p.arithmetic !== 'rational') {
    const gR = makeGrid(p.target, 'rational', 0)
    const ctxR = makeCtx(p, gR, strategy, p.seed)
    const WR = new Float64Array(L).fill(gR.W0)
    const simR = simulateStrategy(strategy, WR, ctxR, { freezeW: gR.W0, rInit: p.rInit, integer: true })
    let mism = 0
    let first = -1
    for (let n = 0; n < L; n++) {
      if (simR.y[n] !== sim.y[n]) {
        mism++
        if (first < 0) first = n
      }
    }
    bitTrue = { reference: 'rational', mismatches: mism, firstIndex: first }
  }

  // ── 警告（必須解釋原因）──
  const maxCode = ctx.maxCode
  if (sim.overflow > 0) {
    warnings.push(
      p.overflow === 'wrap'
        ? `Overflow ${sim.overflow} 次且使用 wrap：code 由 ${maxCode} 跳到 0（或 0 跳到 ${maxCode}），DTC gain 瞬間崩跌 → 巨大的 timing 誤差；硬體應使用 saturate。`
        : `Overload ${sim.overflow} 次：w_H（加上 r 或 dither）超出可表示的 [0, ${maxCode}]，code 被飽和${
            strategy === 'deltaSigma' || strategy === 'deltaSigmaDither'
              ? p.antiWindup
                ? '；anti-windup 已把 r 夾回範圍內'
                : '；ΔΣ 的 r 會無界累積（windup），恢復時產生長時間偏差，建議開 anti-windup'
              : ''
          }。`,
    )
  }
  if (lmsNoise && p.sigmaW >= 1)
    warnings.push(`σ_w = ${p.sigmaW} LSB ≥ 1 LSB：LMS 更新雜訊本身已像 dither，量化策略間的差異會變小（量化誤差被 LMS 雜訊淹沒）。`)
  if (strategy === 'toggle' && constantW) {
    // (B) 是開迴路：小數部分只能表示成 h/L_t；表示不了時平均就偏掉（static error），D ≡ B 也不再成立
    const c = grid.represented
    const frac = c - Math.floor(c)
    const { k } = toggleK(c, p.togglePeriod)
    const dc = k / p.togglePeriod - frac
    if (Math.abs(dc) > 1e-9)
      warnings.push(
        `Toggle 週期 L_t = ${p.togglePeriod} 只能表示 h/L_t：小數部分 ${Number(frac.toPrecision(8))} 被近似成 ${k}/${p.togglePeriod}，平均 code 偏 ${dc.toExponential(2)} LSB（static error，上限 1/(2L_t) = ${(0.5 / p.togglePeriod).toPrecision(3)} LSB）。加長 L_t，或改用有誤差回授的 ΔΣ。`,
      )
  }
  if (strategy === 'freeze' && p.rounding === 'floor') {
    const c = grid.represented
    const frac = c - Math.floor(c)
    if (frac >= 0.5)
      warnings.push(
        `Q_B 設為 floor（truncation）：Freeze 輸出 ⌊w*⌋ = ${Math.floor(c)}，不是最近的 code ${Math.floor(c) + 1}；static error 為 −${Number(frac.toPrecision(6))} LSB（truncation 的誤差落在 (−1, 0]，平均偏 −½ LSB）。Freeze 應使用 round-half-up。`,
      )
  }
  if (p.randomSource === 'prbs' && (strategy === 'stochastic' || (strategy === 'deltaSigmaDither' && p.ditherLsb > 0))) {
    const per = Math.pow(2, p.prbsBits) - 1
    warnings.push(
      `PRBS-${p.prbsBits} 不是真亂數：字序列每 ${per} 次更新重複一次 ⇒ code 誤差含間距 f_u/${per} 的離散譜線，且 LFSR 不會產生 0（P(u < p) 與 p 有微小偏差）。換 seed 只會時間平移，要降低譜線只能加長 N。`,
    )
  }
  if (p.lmsFreezeAt > start && !constantW && (strategy === 'deltaSigma' || strategy === 'toggle'))
    warnings.push(
      `LMS 凍結點 n = ${p.lmsFreezeAt} 在週期偵測窗口的起點 L/4 = ${start} 之後：窗口內還包含未凍結的區段，偵測不到凍結後的 limit cycle。請把凍結點設在 L/4 之前（或加長 L）。`,
    )

  // ── Mixing：code 誤差 × DSM residue → δt → |T|² → output jitter ──
  let mixing: MixResult | null = null
  if (p.mixing) {
    const mixWarn: string[] = []
    const Ns = Math.min(p.mixSamples, L * nUpd)
    const codesUsed = Math.ceil(Ns / nUpd)
    if (codesUsed < 64) mixWarn.push(`mixing 只涵蓋 ${codesUsed} 次 code 更新（N_upd 很大時樣本數受上限 ${p.mixSamples} 限制）；低頻譜線解析度不足。`)
    const dKey = `${p.dsmKind}|${p.dsmFrac}|${Ns}`
    let dsm = dsmCache.get(dKey)
    if (!dsm) {
      const d = runDsm({ kind: p.dsmKind, frac: p.dsmFrac, bits: DSM_BITS, length: Ns, normalization: 'standardize' })
      dsm = { code: d.code, K: d.K }
      dsmCache.set(dKey, dsm)
    }
    const x = dsm.code
    const dt = mixWithResidue(e, nUpd, x, p.lsbFs)
    let s2 = 0
    let s1 = 0
    for (let i = 0; i < Ns; i++) {
      s1 += dt[i]
      s2 += dt[i] * dt[i]
    }
    const meanDt = s1 / Ns
    const segMix = Math.min(32768, Ns)
    // 比 Welch 解析度 Δf = f_s/nperseg 更慢的成分：每段去平均時被移除，σ_out 的積分（f ≥ Δf）看不到。
    // 以不重疊區塊的平均值估計：整段平均 = 靜態偏移；區塊平均相對於整段平均的起伏 = 慢變成分。
    const nBlocks = Math.floor(Ns / segMix)
    let slowRms: number | null = null
    if (nBlocks >= 4) {
      let acc = 0
      for (let b = 0; b < nBlocks; b++) {
        let sb = 0
        for (let i = 0; i < segMix; i++) sb += dt[b * segMix + i]
        const mb = sb / segMix - meanDt
        acc += mb * mb
      }
      slowRms = Math.sqrt(acc / nBlocks)
    }
    const pm = welch(dt, p.fs, { nperseg: segMix, window: 'hann', detrend: 'constant' })
    const t2 = pllT2(pm.f, p.pllBwHz, p.pllZeta)
    const weighted = new Float64Array(pm.f.length)
    for (let i = 0; i < pm.f.length; i++) weighted[i] = pm.psd[i] * t2[i]
    const out2 = integratePsd(pm.f, weighted, pm.f[1], p.fs / 2)
    const tones = significantTones(pm, { maxTones: 1 })
    const dec = decimateLogMax(pm.f, pm.psd, 900)
    const sigmaOut = Math.sqrt(Math.max(0, out2))
    // 混頻產物的週期：code（週期 P·N_upd 個 cycle）× 一階 DSM residue（週期 2^20/gcd(K, 2^20)）⇒ lcm
    const productPeriod =
      p.dsmKind === 'first_order' && constantW && period > 0 && (periodAnalytic === null || periodAnalytic === period)
        ? lcm(period === 1 ? 1 : period * nUpd, firstOrderPeriod(dsm.K, DSM_BITS)) // 常數 code（Freeze）與 N_upd 無關
        : null
    if (productPeriod !== null && productPeriod > Ns)
      mixWarn.push(
        `混頻產物 δt = Δ_LSB·e·x 的週期是 lcm(code 週期 ${period}×N_upd ${nUpd}, DSM 週期 ${firstOrderPeriod(dsm.K, DSM_BITS)}) = ${productPeriod} 個 reference cycle，比 mixing 紀錄（${Ns} 個）長：比 f_s/${Ns} 更慢的差頻分辨不出來，只會出現在「靜態偏移」欄（目前 ${meanDt.toExponential(2)} fs），σ_out 會低估。FCW frac 接近簡單分數（例如 0.1）時特別容易發生；請加長紀錄，或換一個 DSM 週期短的 frac（例如 13/128）。`,
      )
    else if (Math.abs(meanDt) > 0.3 * sigmaOut && Math.abs(meanDt) > 1e-9)
      mixWarn.push(
        `δt 的整段平均不為 0（${meanDt.toExponential(2)} fs，為 σ_out 的 ${(100 * Math.abs(meanDt) / Math.max(sigmaOut, 1e-300)).toFixed(0)}%）：可能是靜態 timing 偏移（PLL 會吸收），也可能是比紀錄長度更慢、分辨不出的差頻；它沒有計入 σ_out。`,
      )
    if (slowRms !== null && slowRms > 0.3 * sigmaOut && slowRms > 1e-9)
      mixWarn.push(
        `δt 含低於積分下限 f_L = ${Number(pm.df.toPrecision(4))} Hz 的慢變成分（RMS ${slowRms.toExponential(2)} fs，為 σ_out 的 ${(100 * slowRms / Math.max(sigmaOut, 1e-300)).toFixed(0)}%），沒有計入 σ_out。來源通常是 DSM residue 本身的慢圖樣（FCW frac 接近簡單分數時 residue 有很低頻的 tone），被 code 誤差的 DC 或低頻成分原封不動帶到 δt——這就是 §13.5 第 6 點「落在 PLL 通帶內」的成分，判讀時要把「慢變成分」欄一併算入。`,
      )
    mixing = {
      f: dec.f,
      psd: dec.psd,
      sigmaRawFs: Math.sqrt(s2 / Ns),
      sigmaOutFs: sigmaOut,
      fLowHz: pm.df,
      meanFs: meanDt,
      slowRmsFs: slowRms,
      nSegments: pm.nSegments,
      productPeriod,
      maxTone: tones.length ? { f: tones[0].fCentroid, power: tones[0].power } : null,
      samples: Ns,
      codesUsed,
      fs: p.fs,
      nperseg: pm.nperseg,
      enbwHz: pm.enbwHz,
      warnings: [...mixWarn, ...pm.warnings],
    }
  }

  const traceLen = Math.min(p.traceLen ?? 200, L)
  const trace = {
    n: Float64Array.from({ length: traceLen }, (_, i) => i),
    y: Float64Array.from(sim.y.subarray(0, traceLen)),
    wH: target.wH.slice(0, traceLen),
    wStar: target.wStar.slice(0, traceLen),
    v: sim.v.slice(0, traceLen),
    r: sim.r.slice(0, traceLen),
  }
  const maxSpur = lines.length ? lines[0] : null
  const { notes: _notes, ...gridOut } = grid
  return {
    key: `${strategy}|${sKey}|${nUpd}`,
    strategy,
    label: STRATEGY_LABEL[strategy],
    lmsNoise,
    nUpd,
    fu,
    grid: gridOut,
    trace,
    hist,
    metrics: {
      meanCode: sumY / L,
      meanTarget: sumT / L,
      dcError,
      errPower,
      errVar,
      quantErrPower: sumQ2 / L,
      quantErrVar: Math.max(0, sumQ2 / L - qMean * qMean),
      lmsErrPower: sumL2 / L,
      lfErrPower,
      lfQuantPower,
      lfExact,
      lfBandHz,
      lfLmsPower,
      trackDcError: sumTrack / (L - q4),
      levels: hist.codes.length,
      codeMin,
      codeMax,
      toggleRate: L > 1 ? toggles / (L - 1) : 0,
      period,
      periodAnalytic,
      periodLimit,
      overflow: sim.overflow,
      windup: sim.windup,
      maxSpur,
    },
    theory,
    psd: {
      f: ps.f,
      psd: ps.psd,
      theory: theoryPsd,
      lmsRef,
      nperseg: ps.nperseg,
      nSegments: ps.nSegments,
      enbwHz: ps.enbwHz,
      df: ps.df,
      window: String(ps.window),
      warnings: ps.warnings,
    },
    lines,
    linesExact,
    zohLines: zl,
    cycle,
    bitTrue,
    mixing,
    warnings,
  }
}

/** 參數檢查：回傳中文錯誤訊息（空陣列 = 合法）。 */
export function validateQuantParams(p: QuantLabParams): string[] {
  const errs: string[] = []
  if (!Number.isFinite(p.target)) errs.push(`w* 必須是有限數，收到 ${p.target}`)
  if (!Number.isInteger(p.bits) || p.bits < 1 || p.bits > 12) errs.push(`bits 必須是 1…12 的整數，收到 ${p.bits}`)
  if (p.arithmetic === 'fixed' && (!Number.isInteger(p.fracBits) || p.fracBits < 0 || p.fracBits > 30))
    errs.push(`F（小數 bit）必須是 0…30 的整數，收到 ${p.fracBits}`)
  if (!(p.sigmaW >= 0)) errs.push(`σ_w 必須 ≥ 0，收到 ${p.sigmaW}`)
  if (!(p.ditherLsb >= 0)) errs.push(`dither 寬度 A 必須 ≥ 0，收到 ${p.ditherLsb}`)
  if (!(p.lsbFs > 0)) errs.push(`Δ_LSB 必須 > 0（fs/LSB），收到 ${p.lsbFs}`)
  if (!Number.isFinite(p.rInit)) errs.push('ΔΣ 初始 r 必須是有限數')
  if (!Number.isFinite(p.driftPerK)) errs.push('PVT drift 必須是有限數')
  if (!Number.isInteger(p.lmsFreezeAt) || p.lmsFreezeAt < 0 || p.lmsFreezeAt >= p.length)
    errs.push(`LMS 凍結時刻必須是 0…L−1 的整數（0 = 不凍結），收到 ${p.lmsFreezeAt}`)
  if (!Number.isInteger(p.nperseg) || p.nperseg < 16) errs.push(`Welch nperseg 必須是 ≥ 16 的整數，收到 ${p.nperseg}`)
  if (p.mixing && (!Number.isInteger(p.mixSamples) || p.mixSamples < 1024 || p.mixSamples > 1 << 22))
    errs.push(`mixing 樣本數必須是 1024…2^22 的整數，收到 ${p.mixSamples}`)
  if (p.mixing && !(p.pllZeta > 0)) errs.push('PLL ζ 必須 > 0')
  if (!Number.isInteger(p.length) || p.length < 64 || p.length > 1 << 20) errs.push(`L 必須是 64…2^20 的整數，收到 ${p.length}`)
  if (!Number.isInteger(p.nUpd) || p.nUpd < 1 || p.nUpd > 65536) errs.push(`N_upd 必須是 1…65536 的整數，收到 ${p.nUpd}`)
  if (!Number.isInteger(p.togglePeriod) || p.togglePeriod < 2 || p.togglePeriod > 4096) errs.push(`toggle 週期 L_t 必須是 2…4096 的整數`)
  if (!(p.fs > 0)) errs.push('f_s 必須為正')
  if (!(p.pole >= 0 && p.pole < 1)) errs.push('AR(1) pole p 必須在 [0, 1)')
  if (p.randomSource === 'prbs' && !PRBS_TAPS[p.prbsBits]) errs.push(`PRBS 長度只支援 ${Object.keys(PRBS_TAPS).join(', ')}`)
  if (p.mixing && !(p.dsmFrac > 0 && p.dsmFrac < 1)) errs.push('DSM frac 必須在 (0, 1)：frac = 0 時 residue 恆為 0，無法正規化')
  if (p.mixing && !(p.pllBwHz > 0 && p.pllBwHz < p.fs / 2)) errs.push('PLL 頻寬必須在 (0, f_s/2)')
  return errs
}

// #region core:runQuantLab
/**
 * Worker 入口：依 cases 執行指定策略 + 情境，並（compareAll 時）在同一情境、同一 seed 下跑完五種策略。
 * 同一批次內共用 w_H 與 DSM residue（paired comparison）。
 */
export function runQuantLab(input: QuantLabInput): QuantLabResult {
  const p = input.params
  const errs = validateQuantParams(p)
  if (errs.length) throw new Error(errs.join('\n'))
  const sharedCache = new Map<string, Shared>()
  const dsmCache = new Map<string, { code: Float64Array; K: number }>()
  const runCache = new Map<string, StrategyRun>()
  const get = (strategy: QuantStrategy, lmsNoise: boolean, nUpd: number) => {
    const key = `${strategy}|${lmsNoise ? 'noise' : 'const'}|${nUpd}`
    let run = runCache.get(key)
    if (!run) {
      run = analyzeRun(p, strategy, lmsNoise, nUpd, sharedCache, dsmCache)
      runCache.set(key, run)
    }
    return run
  }
  const runs = input.cases.map((c) => get(c.strategy, c.lmsNoise, c.nUpd))
  const scen = input.compareScenario ?? { lmsNoise: p.lmsNoise, nUpd: p.nUpd }
  const compare = input.compareAll ? STRATEGIES.map((s) => get(s, scen.lmsNoise, scen.nUpd)) : []
  const warnings: string[] = []
  const maxCode = Math.pow(2, p.bits) - 1
  if (p.target < 0 || p.target > maxCode)
    warnings.push(
      `w* = ${p.target} 超出 ${p.bits}-bit code 範圍 [0, ${maxCode}]：任何策略都無法表示，ΔΣ 會 overload（saturate 時 code 卡在邊界、r 無界成長；wrap 時進位被丟掉、code 繞回另一端）。`,
    )
  else if (p.ditherLsb > 0 && (p.target >= maxCode - p.ditherLsb || p.target < p.ditherLsb))
    // (E) 的量化器輸入 u = w_H + r + d，|r| ≤ ½ + A/2、|d| ≤ A/2 ⇒ |u − w_H| ≤ ½ + A：需 A ≤ w_H < 2^B − 1 − A
    warnings.push(
      `w* 距離 code 邊界小於 dither 寬度 A = ${p.ditherLsb} LSB：(E) 的量化器輸入 u = w_H + r + d 最多偏離 ½ + A LSB，會偶發飽和，dither 被截斷 → 平均值偏移（需 A ≤ w* < ${maxCode} − A）。`,
    )
  // 回傳前複製共用陣列，避免同一個 buffer 在 transfer 時被重複 detach
  const clone = (r: StrategyRun): StrategyRun => deepCopy(r)
  return {
    caseIds: input.cases.map((c) => c.id),
    runs: runs.map(clone),
    compare: compare.map(clone),
    compareScenario: scen,
    warnings,
    durationHint: `L = ${p.length} 次更新 × ${new Set([...runs, ...compare]).size} 組模擬`,
  }
}
// #endregion

// ───────────────────────────────────────────────────────────────────────────
// §13.5 六個比較準則（worker 入口；只回傳純數字）
// ───────────────────────────────────────────────────────────────────────────

export interface CriteriaCell {
  dcError: number
  errPower: number
  lfErrPower: number
  lfQuantPower: number
  lfLmsPower: number
  maxSpurPower: number | null
  maxSpurFreqRel: number | null
  period: number
  toggleRate: number
  trackDcError: number
  sigmaRawFs: number | null
  sigmaOutFs: number | null
  /** f < f_L 的慢變成分 RMS [fs]（未計入 sigmaOutFs；無法估計時為 null） */
  sigmaSlowFs: number | null
  /** 整段平均 mean(δt) [fs]：靜態偏移 */
  meanDtFs: number | null
  /** σ_out 的積分下限 f_L [Hz] */
  fLowHz: number | null
  mixToneFs2: number | null
}

export interface CriteriaRow {
  strategy: QuantStrategy
  /** 常數 w_H、N_upd = 1 */
  constant: CriteriaCell
  /** w_H 含 LMS 雜訊、N_upd = 1 */
  noise: CriteriaCell
  /** 常數 + PVT drift */
  drift: CriteriaCell
  /** 常數、code 每 nUpdSlow 個 reference cycle 更新 */
  slow: CriteriaCell
}

export interface CriteriaInput {
  params: QuantLabParams
  /** drift 情境的漂移量 [LSB / 1000 次更新] */
  driftPerK: number
  /** 慢更新情境的 N_upd */
  nUpdSlow: number
  /** 「FCW 陷阱」示範用的 frac（DSM 週期很長、與 code 的 limit cycle 幾乎同頻）；省略則不計算 */
  trapFrac?: number
}

/** 「FCW 陷阱」：同一個 toggle，只換 DSM 的 frac，混頻產物變成比紀錄更慢的階梯。 */
export interface FcwTrap {
  frac: number
  /** frac 量化後的 K（frac_eff = K/2^20） */
  K: number
  /** 一階 DSM residue 的週期 2^20/gcd(K, 2^20) [cycles] */
  dsmPeriod: number
  /** 混頻產物的週期 lcm(P_code, P_DSM) [cycles] */
  productPeriod: number
  /** 實際模擬的 cycle 數（= productPeriod，上限 2^22） */
  samples: number
  /** 是否涵蓋完整的混頻週期 */
  complete: boolean
  /** 區塊長度（= mixing 的 Welch nperseg）[cycles] */
  blockLen: number
  /** 各區塊的平均 δt [fs]（最多 256 個，供畫圖 / 匯出） */
  blockMeans: Float64Array
  /** 區塊平均相對於整體平均的 RMS [fs]：f < f_L 的慢成分（完整週期） */
  slowRmsFs: number
  /** 區塊平均的最大 / 最小值 [fs] */
  levelMaxFs: number
  levelMinFs: number
  /** 只用「短紀錄」（與表格相同的 mixSamples）時，B 與 D 得到的 σ_out、靜態偏移 [fs] */
  short: { samples: number; sigmaOutToggle: number; sigmaOutDs: number; meanToggle: number; meanDs: number }
}

// #region core:slowProduct
/**
 * 常數目標的 toggle pattern × 一階 DSM residue，模擬一整個混頻週期 lcm(P_code, P_DSM)，回傳每個區塊（長度 blockLen）
 * 的平均 δt。區塊平均 = 比 f_s/blockLen 更慢的成分；它的 RMS 就是 Welch（每段去平均）看不到、但確實落在 PLL 通帶內的 jitter。
 */
export function slowProductStaircase(p: QuantLabParams, frac: number, blockLen: number): Omit<FcwTrap, 'short'> {
  const { K } = quantizeFcw(frac, DSM_BITS)
  const dsmPeriod = firstOrderPeriod(K, DSM_BITS)
  const pattern = toggleCycle(p.target, p.togglePeriod, p.toggleOrder).map((y) => y - p.target) // e[n]，週期 L_t
  const productPeriod = lcm(pattern.length, dsmPeriod)
  const cap = 1 << 22
  const samples = Math.max(blockLen, Math.floor(Math.min(productPeriod, cap) / blockLen) * blockLen)
  // 以串流方式產生 DSM residue（數百萬點時不配置大陣列）。第一趟：整段的平均與標準差，用來把 x 標準化
  // （與 runDsm(..., normalization: 'standardize') 相同的定義）；第二趟：累加每個區塊的 δt。
  const dsm = new DsmStream({ kind: 'first_order', frac, bits: DSM_BITS })
  let s1 = 0
  let s2 = 0
  for (let n = 0; n < samples; n++) {
    dsm.step()
    s1 += dsm.residue
    s2 += dsm.residue * dsm.residue
  }
  const xMean = s1 / samples
  const xStd = Math.sqrt(Math.max(0, s2 / samples - xMean * xMean))
  const xScale = xStd > 0 ? 1 / xStd : 0
  dsm.reset()
  const nBlocks = samples / blockLen
  const means = new Float64Array(nBlocks)
  let total = 0
  for (let b = 0; b < nBlocks; b++) {
    let s = 0
    for (let i = 0; i < blockLen; i++) {
      const n = b * blockLen + i
      dsm.step()
      s += p.lsbFs * pattern[n % pattern.length] * (dsm.residue - xMean) * xScale // δt[n] = Δ_LSB·e[n]·x[n]
    }
    means[b] = s / blockLen
    total += means[b]
  }
  const mean = total / nBlocks
  let acc = 0
  let lo = Infinity
  let hi = -Infinity
  for (let b = 0; b < nBlocks; b++) {
    acc += (means[b] - mean) ** 2
    if (means[b] < lo) lo = means[b]
    if (means[b] > hi) hi = means[b]
  }
  // 顯示用：最多 256 個區塊平均（等距抽點）
  const keep = Math.min(nBlocks, 256)
  const shown = new Float64Array(keep)
  for (let i = 0; i < keep; i++) shown[i] = means[Math.floor((i * nBlocks) / keep)]
  return {
    frac,
    K,
    dsmPeriod,
    productPeriod,
    samples,
    complete: productPeriod <= cap && samples % productPeriod === 0,
    blockLen,
    blockMeans: shown,
    slowRmsFs: Math.sqrt(acc / nBlocks),
    levelMaxFs: hi,
    levelMinFs: lo,
  }
}
// #endregion

function cellOf(r: StrategyRun): CriteriaCell {
  const m = r.metrics
  return {
    dcError: m.dcError,
    errPower: m.errPower,
    lfErrPower: m.lfErrPower,
    lfQuantPower: m.lfQuantPower,
    lfLmsPower: m.lfLmsPower,
    maxSpurPower: m.maxSpur ? m.maxSpur.power : null,
    maxSpurFreqRel: m.maxSpur ? m.maxSpur.f / r.fu : null,
    period: m.period,
    toggleRate: m.toggleRate,
    trackDcError: m.trackDcError,
    sigmaRawFs: r.mixing ? r.mixing.sigmaRawFs : null,
    sigmaOutFs: r.mixing ? r.mixing.sigmaOutFs : null,
    sigmaSlowFs: r.mixing ? r.mixing.slowRmsFs : null,
    meanDtFs: r.mixing ? r.mixing.meanFs : null,
    fLowHz: r.mixing ? r.mixing.fLowHz : null,
    mixToneFs2: r.mixing?.maxTone ? r.mixing.maxTone.power : null,
  }
}

export interface CriteriaResult {
  rows: CriteriaRow[]
  /**
   * 相位檢查（常數情境、N_upd = 1）：B 與 D 的 code 序列只差循環移位（round-half-up）或完全相同（floor），
   * 但 δt = e·x 的 x 是確定性的 DSM residue，所以「相對於 x 的相位」會改變 σ_out。
   */
  phase: { toggle: number | null; dsNearest: number | null; dsFloor: number | null }
  /** 同一檢查的靜態偏移 mean(δt) [fs]：code 與 DSM residue 的 tone 同頻時，差頻落在 DC，大小與正負號由相對相位決定 */
  phaseMean: { toggle: number | null; dsNearest: number | null; dsFloor: number | null }
  /** 「FCW 陷阱」示範（input.trapFrac 有給、且 mixing 開啟時） */
  trap: FcwTrap | null
}

/**
 * 同一 seed 下四個情境 × 五策略（§13.5：常數、LMS 雜訊、PVT 漂移、慢更新率）。
 * 有 mixing 的三個情境使用**相同數目**的 reference cycle（mixSamples）：N_upd = 1 的情境把 code 更新次數加長到 mixSamples，
 * 這樣快 / 慢更新率的 σ_out 才有相同的紀錄長度與積分下限 f_L（否則不是同一個量）。
 */
export function runQuantCriteria(input: CriteriaInput): CriteriaResult {
  const base0 = { ...input.params, driftPerK: 0, lmsFreezeAt: 0 }
  const base = base0.mixing ? { ...base0, length: Math.max(base0.length, Math.min(base0.mixSamples, 1 << 20)) } : base0
  const constant = runQuantLab({ params: { ...base, lmsNoise: false, nUpd: 1 }, cases: [], compareAll: true })
  const noise = runQuantLab({ params: { ...base, lmsNoise: true, nUpd: 1 }, cases: [], compareAll: true })
  const drift = runQuantLab({ params: { ...base0, lmsNoise: false, nUpd: 1, driftPerK: input.driftPerK, mixing: false }, cases: [], compareAll: true })
  const slow = runQuantLab({ params: { ...base0, lmsNoise: false, nUpd: input.nUpdSlow }, cases: [], compareAll: true })
  const rows = STRATEGIES.map((s, i) => ({
    strategy: s,
    constant: cellOf(constant.compare[i]),
    noise: cellOf(noise.compare[i]),
    drift: cellOf(drift.compare[i]),
    slow: cellOf(slow.compare[i]),
  }))
  const floorRun = runQuantLab({
    params: { ...base, lmsNoise: false, nUpd: 1, rounding: 'floor' },
    cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
    compareAll: false,
  }).runs[0]
  const sOut = (r: StrategyRun | undefined) => (r?.mixing ? r.mixing.sigmaOutFs : null)
  const phase = {
    toggle: sOut(constant.compare.find((r) => r.strategy === 'toggle')),
    dsNearest: sOut(constant.compare.find((r) => r.strategy === 'deltaSigma')),
    dsFloor: sOut(floorRun),
  }
  const mOut = (r: StrategyRun | undefined) => (r?.mixing ? r.mixing.meanFs : null)
  const phaseMean = {
    toggle: mOut(constant.compare.find((r) => r.strategy === 'toggle')),
    dsNearest: mOut(constant.compare.find((r) => r.strategy === 'deltaSigma')),
    dsFloor: mOut(floorRun),
  }
  let trap: FcwTrap | null = null
  if (input.trapFrac !== undefined && base0.mixing) {
    const stair = slowProductStaircase(base, input.trapFrac, 32768)
    const short = runQuantLab({
      params: { ...base, dsmFrac: input.trapFrac, lmsNoise: false, nUpd: 1 },
      cases: [
        { id: 'B', strategy: 'toggle', lmsNoise: false, nUpd: 1 },
        { id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 },
      ],
      compareAll: false,
    }).runs
    const mb = short[0].mixing
    const md = short[1].mixing
    if (mb && md)
      trap = { ...stair, short: { samples: mb.samples, sigmaOutToggle: mb.sigmaOutFs, sigmaOutDs: md.sigmaOutFs, meanToggle: mb.meanFs, meanDs: md.meanFs } }
  }
  return { rows, phase, phaseMean, trap }
}
