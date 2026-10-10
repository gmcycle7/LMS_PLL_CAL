/**
 * 主 PLL 的線性化誤差傳遞模型（規格 §6、§6.2、§7、§12.3；模型層級 L2）。
 *
 * ── 連續時間（CT）參考原型 ──────────────────────────────────────────────
 *   Type-II、二階：L(s) = (2ζω_n s + ω_n²)/s²
 *   H_PD(s) = 1/(1+L) = s²/(s² + 2ζω_n s + ω_n²)       （DTC 誤差 → PD residual，high-pass）
 *   T(s)    = L/(1+L) = (2ζω_n s + ω_n²)/(s² + 2ζω_n s + ω_n²)  （→ PLL output，low-pass）
 *   這只是教學參考：§6.1 的數值例子（ζ=0.7、ω=0.3ω_n ⇒ H ≈ −0.0815 + j0.0376）就是用它。
 *
 * ── 離散時間（DT）時域模擬模型：採用「直接 DPLL 差分方程」參數化（validation.md E44）──
 *   假設 PLL 迴路與 comparator 同一取樣率 f_s（T_s = 1/f_s），Ω 一律為 rad/sample：
 *     L(z) = (K_p + K_i/(1 − z⁻¹)) · z^{−(1+d)}/(1 − z⁻¹)
 *     K_p = 2ζ·(ω_n T_s)，K_i = (ω_n T_s)²
 *   - PI loop filter：K_p + K_i/(1 − z⁻¹)
 *   - DCO/VCO 相位累加：z⁻¹/(1 − z⁻¹)（**明確的一個 sample loop delay**，L 嚴格因果）
 *   - d：額外的 loop latency（整數 sample）
 *   H_PD(z) = 1/(1 + L(z))、T(z) = L(z)/(1 + L(z))。L 嚴格因果 ⇒ h_PD[0] = 1，白色 x 時 C = σ_x² > 0（精確）。
 *   只在 ω_n T_s ≪ 1 且 d = 0 時與 CT 原型對應；ω_n T_s 或 d 變大時 polarity 邊界會偏離 ω_n（E44）。
 *   另提供 method = 'bilinear'（Tustin 轉換 CT 的 L(s)，再乘 z^{−d}）作為對照；它不是嚴格因果（h_PD[0] ≠ 1）。
 *
 * ── 計算 C、C_D 或畫 polarity 邊界時，必須用 H(e^{jΩ}) 或 FIR h[n]，不可把 Ω 代入 H(jω)（E44）。──
 *
 * 係數約定：離散 b、a 為 z⁻¹ 升冪（同 `@/simulation/signal` 的 lfilter / freqz）；CT 係數為 s 降冪。
 * 本檔所有函式純數值、無 React/DOM。回傳含方法的物件（errorPathFilter、createHpdFilter）
 * 不可經 Web Worker 傳遞（不可 structured clone），只在 worker 內部或主執行緒直接使用。
 */

import { cAbs, cConj, cExpj, cMul, polyRoots, type Complex } from '@/simulation/core'
import { bilinear, freqs, freqz, StreamFilter, xcorrAtLag, lfilter } from '@/simulation/signal'

// ───────────────────────────────────────────────────────────────────────────
// 型別
// ───────────────────────────────────────────────────────────────────────────

/** 離散時間轉移函數：b、a 為 z⁻¹ 升冪（a[0] 不必為 1，StreamFilter 會正規化）。 */
export interface DtTransfer {
  b: number[]
  a: number[]
}

/** 連續時間轉移函數：b、a 為 s 降冪。 */
export interface CtTransfer {
  b: number[]
  a: number[]
}

/** CT 二階 type-II 原型參數：ω_n 與 ω 必須同單位（rad/s；或都以 ω_n 正規化，此時 wn = 1）。 */
export interface CtLoopParams {
  zeta: number
  wn: number
}

// ───────────────────────────────────────────────────────────────────────────
// 連續時間參考原型（§6.1、§12.3）
// ───────────────────────────────────────────────────────────────────────────

function ctCheck(p: CtLoopParams): void {
  if (!(p.wn > 0) || !Number.isFinite(p.wn)) throw new Error(`ω_n 必須為正有限數，收到 ${p.wn}`)
  if (!(p.zeta > 0) || !Number.isFinite(p.zeta)) throw new Error(`ζ 必須為正有限數，收到 ${p.zeta}`)
}

/** CT 係數（s 降冪）：L(s)、H_PD(s)、T(s)。 */
export function ctLoopCoeffs(p: CtLoopParams): { L: CtTransfer; Hpd: CtTransfer; T: CtTransfer } {
  ctCheck(p)
  const { zeta, wn } = p
  const den = [1, 2 * zeta * wn, wn * wn]
  return {
    L: { b: [2 * zeta * wn, wn * wn], a: [1, 0, 0] },
    Hpd: { b: [1, 0, 0], a: den },
    T: { b: [2 * zeta * wn, wn * wn], a: den },
  }
}

/** L(jω) = (2ζω_n s + ω_n²)/s²，s = jω。ω = 0 時為無限大（type-II 雙積分）。 */
export function ctLoopGain(omega: number, p: CtLoopParams): Complex {
  const { L } = ctLoopCoeffs(p)
  return freqs(L.b, L.a, [omega])[0]
}

/**
 * H_PD(jω) = s²/(s² + 2ζω_n s + ω_n²)（DTC 誤差 → PD residual）。
 * 例：ζ = 0.7、ω = 0.3ω_n ⇒ −0.08153 + j0.03763，相位 155.22°（規格 §6.1）。
 * @param omega 角頻率 ω [rad/s]（與 p.wn 同單位）
 */
export function ctHpd(omega: number, p: CtLoopParams): Complex {
  const { Hpd } = ctLoopCoeffs(p)
  return freqs(Hpd.b, Hpd.a, [omega])[0]
}

/** T(jω) = (2ζω_n s + ω_n²)/(s² + 2ζω_n s + ω_n²)（DTC 誤差 → PLL output 相關的 closed-loop，low-pass）。 */
export function ctT(omega: number, p: CtLoopParams): Complex {
  const { T } = ctLoopCoeffs(p)
  return freqs(T.b, T.a, [omega])[0]
}

/**
 * CT 原型 T(s) 的 −3 dB 角頻率：ω_3dB = ω_n·√(1 + 2ζ² + √((1 + 2ζ²)² + 1))（精確）。
 * ζ = 0.7 時 ω_3dB ≈ 2.04895 ω_n。
 */
export function ctBandwidth3dB(p: CtLoopParams): number {
  ctCheck(p)
  const s = 1 + 2 * p.zeta * p.zeta
  return p.wn * Math.sqrt(s + Math.sqrt(s * s + 1))
}

/** 由 T(s) 的 −3 dB 角頻率反推 ω_n（ctBandwidth3dB 的反函數）。 */
export function wnFromBandwidth3dB(omega3dB: number, zeta: number): number {
  return omega3dB / ctBandwidth3dB({ zeta, wn: 1 })
}

// ───────────────────────────────────────────────────────────────────────────
// 離散時間迴路設計
// ───────────────────────────────────────────────────────────────────────────

export type DtLoopMethod = 'dpll' | 'bilinear'

/**
 * 迴路規格。ω_n 以下列**恰好一種**方式給定：
 * - wnTs：ω_n T_s [rad/sample]（最直接；E44 的 ω_nT）
 * - wn：ω_n [rad/s]，需 fs
 * - fbw：CT 原型 T(s) 的 −3 dB 頻寬 [Hz]，需 fs（以 ctBandwidth3dB 換算 ω_n）
 */
export interface DtLoopSpec {
  /** 迴路／comparator 取樣率 f_s [Hz]；以 wnTs 指定時可省略 */
  fs?: number
  wnTs?: number
  wn?: number
  fbw?: number
  zeta: number
  /** 額外 loop latency d [samples]，非負整數；預設 0 */
  loopDelay?: number
  /** 預設 'dpll'（E44 直接差分方程）；'bilinear' 為 Tustin 對照 */
  method?: DtLoopMethod
}

export interface DtLoopDesign {
  method: DtLoopMethod
  /** f_s [Hz]；以 wnTs 指定且未給 fs 時為 null */
  fs: number | null
  /** ω_n T_s [rad/sample] */
  wnTs: number
  zeta: number
  loopDelay: number
  /** DPLL 比例增益 K_p = 2ζω_nT_s（bilinear 方法時仍回報同一定義，僅供對照） */
  Kp: number
  /** DPLL 積分增益 K_i = (ω_nT_s)² */
  Ki: number
  /** 開迴路 L(z)（z⁻¹ 升冪） */
  L: DtTransfer
  /** H_PD(z) = 1/(1+L) */
  Hpd: DtTransfer
  /** T(z) = L/(1+L) */
  T: DtTransfer
  /** closed-loop poles（1 + L(z) = 0 的根；包含 loop delay 造成的極點） */
  poles: Complex[]
  /** max |pole| */
  spectralRadius: number
  /** 所有 poles 在單位圓內 */
  stable: boolean
  warnings: string[]
}

function padTo(p: number[], n: number): number[] {
  const out = p.slice()
  while (out.length < n) out.push(0)
  return out
}

function resolveWnTs(spec: DtLoopSpec): { wnTs: number; fs: number | null } {
  const given = [spec.wnTs, spec.wn, spec.fbw].filter((v) => v !== undefined).length
  if (given !== 1) throw new Error('迴路頻寬必須恰好以 wnTs、wn 或 fbw 其中一種指定')
  const fs = spec.fs ?? null
  if (fs !== null && (!(fs > 0) || !Number.isFinite(fs))) throw new Error(`f_s 必須為正有限數，收到 ${fs}`)
  let wnTs: number
  if (spec.wnTs !== undefined) {
    wnTs = spec.wnTs
  } else {
    if (fs === null) throw new Error('以 wn 或 fbw 指定迴路頻寬時必須提供 fs')
    const wn = spec.wn !== undefined ? spec.wn : wnFromBandwidth3dB(2 * Math.PI * (spec.fbw as number), spec.zeta)
    wnTs = wn / fs
  }
  if (!(wnTs > 0) || !Number.isFinite(wnTs)) throw new Error(`ω_nT_s 必須為正有限數，收到 ${wnTs}`)
  return { wnTs, fs }
}

/**
 * 設計離散時間主 PLL 迴路（見檔頭）。回傳值可 structured clone（可經 Worker 傳遞）。
 *
 * 例：designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 1 }) ⇒
 *   1 + L 的分母 [1, −2, 1.15, −0.14]，poles 0.91732 ± j0.07173、0.16536。
 */
export function designDtLoop(spec: DtLoopSpec): DtLoopDesign {
  const { wnTs, fs } = resolveWnTs(spec)
  const zeta = spec.zeta
  if (!(zeta > 0) || !Number.isFinite(zeta)) throw new Error(`ζ 必須為正有限數，收到 ${zeta}`)
  const d = spec.loopDelay ?? 0
  if (!Number.isInteger(d) || d < 0) throw new Error(`loopDelay 必須為非負整數，收到 ${d}`)
  const method: DtLoopMethod = spec.method ?? 'dpll'
  // #region core:designDtLoop
  const Kp = 2 * zeta * wnTs
  const Ki = wnTs * wnTs
  const warnings: string[] = []

  let numL: number[]
  let denL: number[]
  if (method === 'dpll') {
    // L(z) = ((Kp + Ki) − Kp z⁻¹) z^{−(1+d)} / (1 − z⁻¹)²
    numL = new Array<number>(d + 3).fill(0)
    numL[d + 1] = Kp + Ki
    numL[d + 2] = -Kp
    denL = [1, -2, 1]
  } else {
    // Tustin（T_s = 1，ω_n 以 rad/sample 表示），再乘 z^{−d}
    const bl = bilinear([2 * zeta * wnTs, wnTs * wnTs], [1, 0, 0], 1)
    numL = new Array<number>(d).fill(0).concat(bl.b)
    denL = bl.a
  }
  const n = Math.max(numL.length, denL.length)
  const nL = padTo(numL, n)
  const dL = padTo(denL, n)
  const char = dL.map((v, i) => v + nL[i])
  // 去掉尾端零（z⁻¹ 升冪的尾端零 = 多餘的 z^{-k} 因子，不影響轉移函數）
  const trimTail = (p: number[]): number[] => {
    let m = p.length
    while (m > 1 && p[m - 1] === 0) m--
    return p.slice(0, m)
  }
  const charT = trimTail(char)
  // z⁻¹ 升冪的分母 [a0..aM] 乘 z^M 即 z 的降冪多項式
  const poles = polyRoots(charT)
  let rho = 0
  for (const p of poles) rho = Math.max(rho, cAbs(p))
  const stable = rho < 1
  // #endregion
  if (!stable) {
    warnings.push(
      `主 PLL 線性化模型不穩定：closed-loop pole 半徑 ${rho.toPrecision(6)} ≥ 1（ω_nT_s = ${wnTs.toPrecision(4)}、d = ${d}）。請降低頻寬或 loop latency。`,
    )
  }
  if (wnTs > 0.3) {
    warnings.push(`ω_nT_s = ${wnTs.toPrecision(3)} 不夠小：DT 迴路與 CT 原型的對應（K_p = 2ζω_nT_s、K_i = (ω_nT_s)²）明顯失準（E44）。`)
  }
  return {
    method,
    fs,
    wnTs,
    zeta,
    loopDelay: d,
    Kp,
    Ki,
    L: { b: trimTail(nL), a: denL.slice() },
    Hpd: { b: dL, a: char },
    T: { b: nL, a: char },
    poles,
    spectralRadius: rho,
    stable,
    warnings,
  }
}

/** DT 頻率響應（Ω 為 rad/sample）。L 在 Ω = 0 為無限大（type-II）。 */
export function loopFreqResponse(
  design: Pick<DtLoopDesign, 'L' | 'Hpd' | 'T'>,
  omegas: ArrayLike<number>,
): { L: Complex[]; Hpd: Complex[]; T: Complex[] } {
  return {
    L: freqz(design.L.b, design.L.a, omegas),
    Hpd: freqz(design.Hpd.b, design.Hpd.a, omegas),
    T: freqz(design.T.b, design.T.a, omegas),
  }
}

/**
 * H_PD 的有狀態濾波器（StreamFilter，DF-II-T）。狀態跨 GMAC block 持續保留：
 * 規格 §15.2 —— **不可**每個 block 重置主 PLL 狀態。
 */
export function createHpdFilter(design: Pick<DtLoopDesign, 'Hpd'>): StreamFilter {
  return new StreamFilter(design.Hpd.b, design.Hpd.a)
}

/** T 的有狀態濾波器（DTC 誤差 → output 相關的 closed-loop）。 */
export function createTFilter(design: Pick<DtLoopDesign, 'T'>): StreamFilter {
  return new StreamFilter(design.T.b, design.T.a)
}

// ───────────────────────────────────────────────────────────────────────────
// 教學用 error-path 種類
// ───────────────────────────────────────────────────────────────────────────

/**
 * 各 error-path 的參數（key 與規格 §15.3 JSON 的 `pll_error_path.parameters` 相同，採 snake_case）。
 * - identity：u = x（H = 1）
 * - single_tone：在指定頻率 Ω 精確給出 H(e^{jΩ}) = magnitude·e^{j·phase_deg}。
 *   實作為 2-tap 實係數因果 FIR h = [h0, h1]：h1 = −|H| sinφ / sinΩ，h0 = |H| cosφ − h1 cosΩ。
 *   對該頻率的正弦輸入（第一個 sample 之後）輸出恰為 A|H|cos(Ωn + θ + φ)；其他頻率的響應由 freq() 給出。
 *   Ω = 0 或 π 時實係數 h 只能給 φ ∈ {0°, 180°}（E46）。
 * - fir：任意 taps h[0..]
 * - first_order_hp：H(z) = (1 − z⁻¹)/(1 − ρz⁻¹)，等同 type-I DPLL（L = (1−ρ)z⁻¹/(1−z⁻¹)）的 1/(1+L)；h[0] = 1
 * - type2_dt：designDtLoop 的 H_PD（wn_ts = ω_nT_s [rad/sample]）
 * - iir：任意 b、a（z⁻¹ 升冪）
 */
export interface ErrorPathParamsMap {
  identity: Record<string, never>
  single_tone: { magnitude: number; phase_deg: number; omega: number }
  fir: { taps: number[] }
  first_order_hp: { pole: number }
  type2_dt: { wn_ts: number; zeta: number; loop_delay?: number; method?: DtLoopMethod }
  iir: { b: number[]; a: number[] }
}

export type ErrorPathKind = keyof ErrorPathParamsMap

export const ERROR_PATH_KINDS: readonly ErrorPathKind[] = ['identity', 'single_tone', 'fir', 'first_order_hp', 'type2_dt', 'iir']

/** 可 structured clone 的 error-path 描述 */
export type ErrorPathSpec = {
  [K in ErrorPathKind]: { kind: K; parameters: ErrorPathParamsMap[K] }
}[ErrorPathKind]

/** 由 Ω 與目標響應建立 2-tap FIR（single_tone）。 */
export function singleToneFir(magnitude: number, phaseRad: number, omega: number): number[] {
  if (!(omega >= 0 && omega <= Math.PI)) throw new Error(`single_tone 的 Ω 必須在 [0, π] rad/sample，收到 ${omega}`)
  if (!(magnitude >= 0) || !Number.isFinite(magnitude)) throw new Error(`|H| 必須為非負有限數，收到 ${magnitude}`)
  const s = Math.sin(omega)
  if (Math.abs(s) < 1e-12) {
    // Ω = 0 或 π：實係數 h 的 H(e^{jΩ}) 必為實數
    const cphi = Math.cos(phaseRad)
    if (Math.abs(Math.abs(cphi) - 1) > 1e-9) {
      throw new Error(
        'Ω = 0 或 π 時，實係數濾波器的 H(e^{jΩ}) 只能是實數（φ = 0° 或 180°）；此時單頻相關性為 A²·H·cos(ΩD)，是一般公式的 2 倍（E46）',
      )
    }
    return [magnitude * Math.sign(cphi)]
  }
  const h1 = (-magnitude * Math.sin(phaseRad)) / s
  const h0 = magnitude * Math.cos(phaseRad) - h1 * Math.cos(omega)
  return [h0, h1]
}

/** 把 error-path 規格轉成 DT 轉移函數 {b, a}（可 structured clone；worker 可呼叫）。 */
export function errorPathTransfer(spec: ErrorPathSpec): DtTransfer & { kind: ErrorPathKind; description: string } {
  switch (spec.kind) {
    case 'identity':
      return { kind: 'identity', b: [1], a: [1], description: 'H = 1（u = x）' }
    case 'single_tone': {
      const p = spec.parameters
      const phi = (p.phase_deg * Math.PI) / 180
      const h = singleToneFir(p.magnitude, phi, p.omega)
      return {
        kind: 'single_tone',
        b: h,
        a: [1],
        description: `2-tap FIR，在 Ω = ${p.omega.toPrecision(4)} rad/sample 給出 |H| = ${p.magnitude}、φ = ${p.phase_deg}°`,
      }
    }
    case 'fir': {
      const taps = spec.parameters.taps
      if (taps.length === 0) throw new Error('fir 的 taps 不可為空')
      if (taps.some((v) => !Number.isFinite(v))) throw new Error('fir 的 taps 必須為有限數')
      return { kind: 'fir', b: taps.slice(), a: [1], description: `FIR，${taps.length} taps` }
    }
    case 'first_order_hp': {
      const rho = spec.parameters.pole
      if (!(rho > -1 && rho < 1)) throw new Error(`first_order_hp 的 pole ρ 必須在 (−1, 1)，收到 ${rho}`)
      return {
        kind: 'first_order_hp',
        b: [1, -1],
        a: [1, -rho],
        description: `H(z) = (1 − z⁻¹)/(1 − ${rho}z⁻¹)（type-I DPLL 的 1/(1+L)）`,
      }
    }
    case 'type2_dt': {
      const p = spec.parameters
      const des = designDtLoop({ wnTs: p.wn_ts, zeta: p.zeta, loopDelay: p.loop_delay ?? 0, method: p.method ?? 'dpll' })
      return {
        kind: 'type2_dt',
        b: des.Hpd.b,
        a: des.Hpd.a,
        description: `type-II DPLL H_PD（ω_nT_s = ${p.wn_ts}、ζ = ${p.zeta}、d = ${p.loop_delay ?? 0}、${des.method}）`,
      }
    }
    case 'iir': {
      const { b, a } = spec.parameters
      if (b.length === 0 || a.length === 0) throw new Error('iir 的 b、a 不可為空')
      if (a[0] === 0) throw new Error('iir 的 a[0] 不可為 0')
      return { kind: 'iir', b: b.slice(), a: a.slice(), description: `IIR，${b.length} 個 b、${a.length} 個 a` }
    }
  }
}

/** 有狀態的 error-path 濾波器（不可 structured clone）。 */
export interface ErrorPathFilter {
  readonly kind: ErrorPathKind
  /** z⁻¹ 升冪係數 */
  readonly b: number[]
  readonly a: number[]
  /** 輸入一個 sample，回傳一個 sample；狀態保留 */
  step(x: number): number
  /** 狀態歸零（initial rest） */
  reset(): void
  /** 頻率響應 H(e^{jΩ})，Ω 為 rad/sample */
  freq(omega: number): Complex
  getState(): Float64Array
  setState(z: ArrayLike<number>): void
}

/**
 * 建立有狀態的 error-path 濾波器（見 ErrorPathParamsMap 的各種類說明）。
 * 例：errorPathFilter('single_tone', { magnitude: 1, phase_deg: 120, omega: Math.PI / 6 })
 */
export function errorPathFilter<K extends ErrorPathKind>(kind: K, params: ErrorPathParamsMap[K]): ErrorPathFilter {
  const tf = errorPathTransfer({ kind, parameters: params } as ErrorPathSpec)
  const sf = new StreamFilter(tf.b, tf.a)
  const b = tf.b
  const a = tf.a
  return {
    kind,
    b,
    a,
    step: (x: number) => sf.step(x),
    reset: () => sf.reset(),
    freq: (omega: number) => freqz(b, a, [omega])[0],
    getState: () => sf.getState(),
    setState: (z: ArrayLike<number>) => sf.setState(z),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 相關性 C 的三種算法（§6.1、§6.2、§7）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 單頻解析值 C_D = E[x[n−D]·u[n]]，x[n] = A cos(Ωn)、H(e^{jΩ}) = |H|e^{jφ}：
 *   0 < Ω < π：C_D = (A²/2)|H|cos(φ + ΩD)                      [精確｜單頻、長時間或整數週期平均]
 *   Ω = 0 或 π：C_D = A²|H|cosφ·cos(ΩD)（cos(2Ωn+…) 項不會平均掉，是上式的 2 倍；E46）
 * @param phaseRad φ [rad]；omega Ω [rad/sample]；delay D [samples]
 */
export function corrSingleTone(p: { amplitude: number; magnitude: number; phaseRad: number; omega: number; delay?: number }): number {
  const D = p.delay ?? 0
  const { amplitude: A, magnitude: m, phaseRad: phi, omega } = p
  const edge = Math.abs(Math.sin(omega)) < 1e-12
  if (edge) return A * A * m * Math.cos(phi) * Math.cos(omega * D)
  return 0.5 * A * A * m * Math.cos(phi + omega * D)
}

function isDtTransfer(h: ArrayLike<Complex> | DtTransfer): h is DtTransfer {
  return !Array.isArray(h) && typeof h === 'object' && h !== null && 'b' in h && 'a' in h
}

/**
 * 頻域數值積分：C_D = (1/2π)∫_{−π}^{π} S_xx(e^{jΩ})·Re{H(e^{jΩ}) e^{jΩD}} dΩ（梯形法）。
 *
 * @param omega 遞增的 Ω 格點 [rad/sample]。若 omega[0] ≥ 0，視為只給 [0, π] 半邊，
 *   並假設 x 與 h 為實數（S_xx 偶對稱、Re{H e^{jΩD}} 偶對稱），結果 = (1/π)∫_0^π。
 *   均勻且涵蓋整個週期（[0, π] 或 [−π, π]）的格點對平滑週期函數有極高精度。
 * @param sxx DTFT 形式的雙邊 PSD（σ_x² = (1/2π)∫S_xx dΩ），單位 [x²/(rad/sample)]；
 *   注意這不是 welch 的 one-sided x²/Hz（換算見 dtftPsdToOnesided、E28）。
 * @param h H(e^{jΩ}) 的值（與 omega 同長），或 {b, a}（z⁻¹ 升冪）
 * @param delay D [samples]（GMAC 用 x[n − D]）
 */
export function corrFromPsd(p: {
  omega: ArrayLike<number>
  sxx: ArrayLike<number>
  h: ArrayLike<Complex> | DtTransfer
  delay?: number
}): number {
  const { omega, sxx } = p
  const n = omega.length
  if (n < 2 || sxx.length !== n) throw new Error('corrFromPsd：omega 與 sxx 必須同長且至少 2 點')
  const D = p.delay ?? 0
  const H: ArrayLike<Complex> = isDtTransfer(p.h) ? freqz(p.h.b, p.h.a, omega) : p.h
  if (H.length !== n) throw new Error('corrFromPsd：H 與 omega 必須同長')
  const f = (i: number): number => {
    const z = cMul(H[i], cExpj(omega[i] * D))
    return sxx[i] * z.re
  }
  let integral = 0
  let prev = f(0)
  for (let i = 1; i < n; i++) {
    const cur = f(i)
    integral += 0.5 * (prev + cur) * (omega[i] - omega[i - 1])
    prev = cur
  }
  const half = omega[0] >= 0
  return half ? integral / Math.PI : integral / (2 * Math.PI)
}

/**
 * 時域經驗值 C_D = mean_n x[n − D]·u[n]（只用重疊樣本；同 xcorrAtLag(x, u, D)）。
 * x 與 u 為同一時間軸上的序列（u = h * x）。
 */
export function corrEmpirical(x: ArrayLike<number>, u: ArrayLike<number>, delay = 0): number {
  return xcorrAtLag(x, u, delay, 'mean')
}

/** 把 code 序列通過 H（initial rest）後取經驗 C_D；skip 個起始 sample 不計（避開暫態）。 */
export function corrFromSequence(p: { x: ArrayLike<number>; h: DtTransfer; delay?: number; skip?: number }): number {
  const u = lfilter(p.h.b, p.h.a, p.x).y
  const skip = p.skip ?? 0
  const D = p.delay ?? 0
  const xs = Float64Array.from(p.x).subarray(skip)
  return corrEmpirical(xs, u.subarray(skip), D)
}

/**
 * 有限脈衝響應 h 與已知自相關 R_x 的封閉式：C_D = Σ_k h[k]·R_x[k − D]。
 * @param rx 自相關函數 R_x[ℓ]（偶函數，只需處理 ℓ 的整數值）
 */
export function corrFromAutocorr(h: ArrayLike<number>, rx: (lag: number) => number, delay = 0): number {
  let s = 0
  for (let k = 0; k < h.length; k++) s += h[k] * rx(k - delay)
  return s
}

/** AR(1) x[n] = a1·x[n−1] + w[n]（Var w = σ_w²）的 DTFT PSD：S_xx(e^{jΩ}) = σ_w²/|1 − a1 e^{−jΩ}|²。 */
export function ar1Psd(a1: number, sigmaW2: number, omega: number): number {
  return sigmaW2 / (1 - 2 * a1 * Math.cos(omega) + a1 * a1)
}

/** AR(1) 自相關 R_x[ℓ] = σ_w² a1^{|ℓ|}/(1 − a1²)。 */
export function ar1Autocorr(a1: number, sigmaW2: number, lag: number): number {
  return (sigmaW2 * Math.pow(a1, Math.abs(lag))) / (1 - a1 * a1)
}

/**
 * Filtered-x 模型誤差下的有效相關（E45）：E[u·u_f] = (1/2π)∫S_xx Re{H·Ĥ*} dΩ。
 * 回傳 freq 格點上的被積函數所需的 H·conj(Ĥ)，可直接作為 corrFromPsd 的 h。
 */
export function crossResponse(h: DtTransfer, hHat: DtTransfer, omega: ArrayLike<number>): Complex[] {
  const H = freqz(h.b, h.a, omega)
  const Hh = freqz(hHat.b, hHat.a, omega)
  return H.map((v, i) => cMul(v, cConj(Hh[i])))
}

/** 相關性 C 的各種算法集合（同上各函式；方便以 correlationC.xxx 查找） */
export const correlationC = {
  singleTone: corrSingleTone,
  fromPsd: corrFromPsd,
  empirical: corrEmpirical,
  fromSequence: corrFromSequence,
  fromAutocorr: corrFromAutocorr,
} as const

/**
 * §8.1 單頻 Polarity Margin（自訂工程指標）：M = 90° − |wrap180(θ)|，θ = φ + ΩD [deg]。
 * M < 0 表示原極性不合（cos θ < 0）。
 */
export function polarityMarginDeg(thetaDeg: number): number {
  let w = (thetaDeg + 180) % 360
  if (w <= 0) w += 360
  return 90 - Math.abs(w - 180)
}

/** 小工具：把 CT 響應在 ω 處的複數以 |H|、φ[deg] 表示 */
export function magPhaseDeg(z: Complex): { magnitude: number; phaseDeg: number } {
  return { magnitude: cAbs(z), phaseDeg: (Math.atan2(z.im, z.re) * 180) / Math.PI }
}
