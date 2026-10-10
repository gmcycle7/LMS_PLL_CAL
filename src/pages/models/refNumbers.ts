/**
 * 規格 §15.3 範例設定（iid ±1 code、identity path、unit-RMS ⇒ C = E[x²] = 1、average GMAC、d = 0）的封閉式數字。
 * 這些是 [精確｜指定模型] 的線性化結果；頁面文字中的手算數字都從這裡取，測試以 golden T13 / T14 交叉比對。
 */
import { SPEC_15_3_EXAMPLE, runBlockLms } from '@/simulation/models/blockLms'
import { corrSingleTone } from '@/simulation/models/pll'

export interface LoopNumbers {
  sigmaV: number
  N: number
  mu: number
  fs: number
  Kq: number
  C: number
  K: number
  g: number
  p: number
  /** σ_η² = (E[x_ref²] − m²)/N ≈ 1/N（m = E[q·x_ref] = E[G]；近平衡取 m = 0） */
  sigmaEta2: number
  sigmaW: number
  fu: number
  f3db: number
  f3dbNegLn: number
  f3dbOneMinusP: number
  enbw: number
  tau: number
  pmDeg: number
  gSum: number
  poleSum: number
}

export interface LoopBandwidths {
  /** 半功率條件的 cos Ω_3dB = 1 − (1 − p)²/(2p)（|值| > 1 時沒有 −3 dB 點） */
  cosOmega3db: number
  /** Ω_3dB [rad/block]；p < 3 − 2√2 時 NaN（E27） */
  omega3db: number
  f3db: number
  f3dbNegLn: number
  f3dbOneMinusP: number
  /** one-sided ENBW = f_u(1 − p)/(2(1 + p)) [Hz]（E06） */
  enbw: number
}

/** 一階校正迴路 H_w(z) = −μ/(z − p) 的頻寬（block rate f_u）：exact −3 dB、兩種近似與 ENBW（F-15.6）。 */
export function loopBandwidths(pole: number, fu: number): LoopBandwidths {
  const cosOmega3db = 1 - ((1 - pole) * (1 - pole)) / (2 * pole)
  const omega3db = Math.acos(cosOmega3db)
  return {
    cosOmega3db,
    omega3db,
    f3db: (fu / (2 * Math.PI)) * omega3db,
    f3dbNegLn: (-Math.log(pole) / (2 * Math.PI)) * fu,
    f3dbOneMinusP: ((1 - pole) / (2 * Math.PI)) * fu,
    enbw: (fu * (1 - pole)) / (2 * (1 + pole)),
  }
}

export function loopNumbers(p: { sigmaV: number; N: number; mu: number; fs: number; C?: number }): LoopNumbers {
  const C = p.C ?? 1
  const Kq = Math.sqrt(2 / Math.PI) / p.sigmaV
  const K = Kq * C
  const g = p.mu * K
  const pole = 1 - g
  const sigmaEta2 = 1 / p.N
  const sigmaW = Math.abs(p.mu) * Math.sqrt(sigmaEta2 / (1 - pole * pole))
  const fu = p.fs / p.N
  const bw = loopBandwidths(pole, fu)
  return {
    sigmaV: p.sigmaV,
    N: p.N,
    mu: p.mu,
    fs: p.fs,
    Kq,
    C,
    K,
    g,
    p: pole,
    sigmaEta2,
    sigmaW,
    fu,
    f3db: bw.f3db,
    f3dbNegLn: bw.f3dbNegLn,
    f3dbOneMinusP: bw.f3dbOneMinusP,
    enbw: bw.enbw,
    tau: -1 / Math.log(pole),
    pmDeg: 90 - (Math.asin(g / 2) * 180) / Math.PI,
    gSum: g * p.N,
    poleSum: 1 - g * p.N,
  }
}

/** §15.3 範例的數字（T13、T14） */
export const SPEC_NUMBERS: LoopNumbers = loopNumbers({
  sigmaV: SPEC_15_3_EXAMPLE.pd_noise_rms_fs,
  N: SPEC_15_3_EXAMPLE.gm_accum_samples,
  mu: SPEC_15_3_EXAMPLE.gain_step,
  fs: SPEC_15_3_EXAMPLE.sample_rate_hz,
})

/** 含 d 個 block 更新延遲時的臨界增益 g_crit = 2 sin(π/(4d+2)) */
export function gCritical(d: number): number {
  return 2 * Math.sin(Math.PI / (4 * d + 2))
}

/** 一階平均模型含 d 個 block 更新延遲時的 phase margin [deg]：90° − (2d + 1)·asin(g/2)（0 < g ≤ 2 才定義） */
export function pmDeg(g: number, d: number): number {
  if (!(g > 0 && g <= 2)) return NaN
  return 90 - (2 * d + 1) * ((Math.asin(g / 2) * 180) / Math.PI)
}

export interface LimitCycleDemo {
  a: number
  mu: number
  lsb: number
  /** 實體 code 的 limit-cycle 週期 [blocks] */
  period: number
  /** 後半段實體 gain 出現過的值（由小到大）[fs] */
  levels: number[]
  /** 後半段實體 gain 平均 [fs] */
  meanPhys: number
}

/**
 * §16.1 第 6 項的示範：σ_v = 0、a 落在兩個實體 code 之間、quantize_physical = true。
 * 無雜訊且 x = ±1 時 G = sign(a − w_phys)，與 N 無關，所以用很小的 N（16）在主執行緒直接跑同一個 runBlockLms；
 * preset「block-lms-json-limit-cycle」（N = 4096）的結果相同（jsonLabModel.test.ts）。
 */
export function limitCycleDemo(): LimitCycleDemo {
  const a = 3.05
  const mu = 0.05
  const r = runBlockLms({
    ...SPEC_15_3_EXAMPLE,
    gm_accum_samples: 16,
    num_blocks: 400,
    gain_true: a,
    gain_step: mu,
    pd_noise_rms_fs: 0,
    gain_register: { ...SPEC_15_3_EXAMPLE.gain_register, quantize_physical: true },
    record: { sample_trace_blocks: 0, decimate: 1 },
  })
  const K = r.blocks.wPhys.length - 1
  const tail = Array.from(r.blocks.wPhys.subarray(Math.ceil((K + 1) / 2)))
  const levels = [...new Set(tail)].sort((x, y) => x - y)
  return { a, mu, lsb: r.config.gain_register.lsb_fs, period: r.metrics.limitCyclePeriod, levels, meanPhys: r.metrics.meanWPhys }
}

/** T07 的單頻相關：φ = −120°、Ω = π/6、A = |H| = 1 時 C_D = ½cos(φ + ΩD)（D = 0 與對齊後的 D = 4） */
export function alignmentDemo(): { phiDeg: number; omega: number; c0: number; c4: number } {
  const phiDeg = -120
  const omega = Math.PI / 6
  const base = { amplitude: 1, magnitude: 1, phaseRad: (phiDeg * Math.PI) / 180, omega }
  return { phiDeg, omega, c0: corrSingleTone({ ...base, delay: 0 }), c4: corrSingleTone({ ...base, delay: 4 }) }
}
