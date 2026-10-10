import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { conventionalStep, meanSquareFactor, meanSquareMuMax } from '@/simulation/models/lms'
import { deltaSigmaDitherStep, deltaSigmaStep, type QState, type QuantCtx } from '@/simulation/models/quantizer'
import {
  blockSignGmacStep,
  calBandwidths,
  calNoise,
  comparatorKq,
  conventionHandTable,
  corr2Eigs,
  criticalGain,
  criticalGainNumeric,
  criticalOmega,
  cycleLines,
  delayCharPoly,
  delaySpectralRadius,
  delayedTrajectory,
  ditherCompare,
  ditherErrorPowers,
  efCycle,
  efDitherStep,
  efQuantize,
  efStep,
  eigenExample,
  fxToneCorrelation,
  gainScale,
  multiToneCorrelation,
  multiToneEmpirical,
  muForScale,
  nlmsPosteriorFactor,
  nlmsStep,
  pmWithDelayDeg,
  poleFromEnbw,
  poleFromF3db,
  prbs7,
  prbs7Words,
  prbsHalfLsbDither,
  prbsWordDither,
  stepsToDecay,
  toneCorrelation,
  weakExcitation,
  widrowStep,
  type ConventionInput,
} from './bridge'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function vec(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}

/** golden 規則：|actual − expected| ≤ abs + rel·|expected|（tolerance_overrides 優先） */
function expectGolden(v: Vector, key: string, actual: number) {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const expected = v.expected[key] as number
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
  expect(Math.abs(actual - expected), `${key}: actual ${actual} vs expected ${expected}`).toBeLessThanOrEqual(bound)
}

const BASE: ConventionInput = {
  convention: 'half',
  mu: 0.5,
  traceR: 2,
  epsReg: 0,
  sigmaV: 100,
  N: 4096,
  sumMode: false,
  polarity: 1,
}

describe('步長寫法換算（½e² / Widrow / NLMS / block sign-GMAC）', () => {
  it('手算例 w0=1、a=3、x=2、μ=0.1：三種寫法換算後走出同一條 w_n（1.8、2.28、2.568）', () => {
    const rows = conventionHandTable({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 3 }, conventionalStep)
    expect(rows.map((r) => r.n)).toEqual([0, 1, 2, 3])
    expect(rows[1].wHalf).toBeCloseTo(1.8, 14)
    expect(rows[2].wHalf).toBeCloseTo(2.28, 14)
    expect(rows[3].wHalf).toBeCloseTo(2.568, 14)
    for (const r of rows) {
      expect(r.wWidrow).toBe(r.wHalf) // 2·(μ/2) 在浮點下精確等於 μ
      expect(r.wNlms).toBeCloseTo(r.wHalf, 14)
    }
    expect(rows[0].e).toBe(4)
  })

  it('Widrow 型的一步等於 ½e² 型用 2 倍步長；NLMS 的更新量與 x 的尺度無關', () => {
    const half = conventionalStep({ w: 0.3, x: -1.7, y: 2.2, mu: 0.08 })
    const wid = widrowStep({ w: 0.3, x: -1.7, y: 2.2, mu: 0.04 })
    expect(wid.w).toBe(half.w)
    // NLMS：x 與 y 同乘 10，Δw 不變（ε_reg = 0）
    const a = nlmsStep({ w: 0.3, x: -1.7, y: 2.2, mu: 0.5 })
    const b = nlmsStep({ w: 0.3, x: -17, y: 22, mu: 0.5 })
    expect(b.dw).toBeCloseTo(a.dw, 14)
  })

  it('gainScale / muForScale 互為反函數；Widrow 的 μ 上限是 ½e² 型的一半（勘誤 E41）', () => {
    const ctx = { traceR: 2, epsReg: 0.1, sigmaV: 100, N: 4096, sumMode: false }
    const s = gainScale({ ...BASE, convention: 'half', mu: 0.5 })
    expect(s).toBe(0.5)
    expect(muForScale(s, 'widrow', ctx)).toBe(0.25)
    expect(muForScale(s, 'nlms', ctx)).toBeCloseTo(0.5 * 2.1, 14)
    expect(muForScale(s, 'signBlock', ctx)).toBeCloseTo(0.5 / comparatorKq(100), 10)
    for (const c of ['half', 'widrow', 'nlms', 'signBlock'] as const) {
      const mu = muForScale(0.37, c, ctx)
      expect(gainScale({ ...BASE, ...ctx, convention: c, mu })).toBeCloseTo(0.37, 13)
    }
    // mean 界：½e² 型 0 < μ < 2/λ_max；Widrow 型 0 < μ_W < 1/λ_max
    const lmax = 4
    expect(muForScale(criticalGain(0) / lmax, 'half', ctx)).toBe(0.5)
    expect(muForScale(criticalGain(0) / lmax, 'widrow', ctx)).toBe(0.25)
  })

  it('NLMS 的 a posteriori 收縮：ε_reg = 0 時因子 1 − μ̃，0 < μ̃ < 2 ⇔ |因子| < 1', () => {
    expect(nlmsPosteriorFactor(1, 0, 3.7)).toBeCloseTo(0, 15)
    expect(Math.abs(nlmsPosteriorFactor(1.99, 0, 0.2))).toBeLessThan(1)
    expect(Math.abs(nlmsPosteriorFactor(2.01, 0, 0.2))).toBeGreaterThan(1)
    // 純量固定 x 的 NLMS：誤差 e_{n+1} = (1 − μ̃)·e_n（精確）
    const s = nlmsStep({ w: 1, x: 2, y: 6, mu: 0.4 })
    const ePost = 6 - s.w * 2
    expect(ePost).toBeCloseTo((1 - 0.4) * s.e, 14)
  })

  it('block sign-GMAC：e ≥ 0 → q = +1；sum 模式的 G 是 average 的 N 倍', () => {
    const xs = [1, -1, 1, 1]
    const vs = [0, 0, -5, 0]
    const avg = blockSignGmacStep({ w: 1, a: 1, xs, vs, mu: 10 })
    // δ = 0：e = v → q = [+1, +1, −1, +1]，Σqx = 1 − 1 − 1 + 1 = 0
    expect(avg.G).toBe(0)
    const s1 = blockSignGmacStep({ w: 0, a: 1, xs, vs: [0, 0, 0, 0], mu: 10 })
    expect(s1.G).toBe(1) // q = sign(x) ⇒ Σqx/N = mean|x| = 1
    const s2 = blockSignGmacStep({ w: 0, a: 1, xs, vs: [0, 0, 0, 0], mu: 10, sumMode: true })
    expect(s2.G).toBe(4)
    expect(s2.w - 0).toBe(4 * (s1.w - 0))
  })
})

describe('更新延遲：g*(d)、spectral radius、PM', () => {
  it('特徵多項式 z^{d+1} − z^d + g 的係數', () => {
    expect(delayCharPoly(0.3, 0)).toEqual([1, -0.7])
    expect(delayCharPoly(0.3, 2)).toEqual([1, -1, 0, 0.3])
  })

  it('golden delay_bounds：封閉式 g*(d) 與 ω* = π/(2d+1)（d = 0…6）', () => {
    const v = vec('delay_bounds')
    const ds = v.inputs.d_list as number[]
    const g = v.expected.g_crit_list as number[]
    const w = v.expected.omega_crit_rad_list as number[]
    ds.forEach((d, i) => {
      expect(Math.abs(criticalGain(d) - g[i])).toBeLessThanOrEqual(v.tolerance.abs ?? 0)
      expect(Math.abs(criticalOmega(d) - w[i])).toBeLessThanOrEqual(v.tolerance.abs ?? 0)
    })
  })

  it('數值求根（不用封閉式）找到的臨界增益與封閉式一致，且臨界時最大根落在單位圓', () => {
    for (let d = 0; d <= 6; d++) {
      const gn = criticalGainNumeric(d)
      expect(Math.abs(gn - criticalGain(d))).toBeLessThan(1e-8)
      expect(delaySpectralRadius(criticalGain(d) * (1 - 1e-6), d)).toBeLessThan(1)
      expect(delaySpectralRadius(criticalGain(d) * (1 + 1e-6), d)).toBeGreaterThan(1)
    }
  })

  it('T08: d = 0 時 L(z) = g/(z−1)：pole 1 − g，PM = 90° − asin(g/2)', () => {
    const v = vec('T08')
    const gs = v.inputs.g_list as number[]
    const poles = v.expected.pole_list as number[]
    const pms = v.expected.pm_deg_list as number[]
    gs.forEach((g, i) => {
      expect(Math.abs(1 - g - poles[i])).toBeLessThanOrEqual(v.tolerance.abs ?? 0)
      expect(Math.abs(pmWithDelayDeg(g, 0) - pms[i])).toBeLessThanOrEqual(1e-9)
    })
    expectGolden(v, 'pm_deg', pmWithDelayDeg(1, 0))
    expect(delaySpectralRadius(1, 0)).toBe(0)
  })

  it('PM 在 g = g*(d) 處恰為 0（兩種推導一致），且 g > 2 時 PM 無定義', () => {
    for (let d = 0; d <= 6; d++) expect(pmWithDelayDeg(criticalGain(d), d)).toBeCloseTo(0, 9)
    expect(Number.isNaN(pmWithDelayDeg(2.1, 0))).toBe(true)
    expect(Number.isNaN(pmWithDelayDeg(-0.1, 0))).toBe(true)
  })

  it('反面：極性正確（g > 0）但 d = 2、g = 0.7 > g*(2) = 0.618 ⇒ 平均誤差發散', () => {
    expect(delaySpectralRadius(0.7, 2)).toBeGreaterThan(1)
    const tr = delayedTrajectory(0.7, 2, 400)
    expect(Math.abs(tr[400])).toBeGreaterThan(10)
    const ok = delayedTrajectory(0.5, 2, 400)
    expect(Math.abs(ok[400])).toBeLessThan(1e-6)
  })

  it('延遲遞迴 d = 0 就是幾何級數 (1 − g)^k；軌跡的衰減率等於 spectral radius', () => {
    const tr = delayedTrajectory(0.3, 0, 50)
    expect(tr[50]).toBeCloseTo(0.7 ** 50, 15)
    const g = 0.2
    const d = 3
    const t = delayedTrajectory(g, d, 3000)
    const rate = Math.pow(Math.abs(t[3000]) / Math.abs(t[2000]), 1 / 1000)
    expect(rate).toBeCloseTo(delaySpectralRadius(g, d), 3)
  })

  it('stepsToDecay：ρ ≥ 1 為 ∞，ρ = 0 一步到位', () => {
    expect(stepsToDecay(1)).toBe(Infinity)
    expect(stepsToDecay(1.2)).toBe(Infinity)
    expect(stepsToDecay(0)).toBe(1)
  })
})

describe('D7 / Ch09–Ch10：eigenvalue 例子', () => {
  it('T11: ρ = 0.99、μK_q = 0.5：慢 pole 0.995、598 blocks；M = 0.5R⁻¹ ⇒ pole 0.5、5 blocks', () => {
    const v = vec('T11')
    const ex = eigenExample(0.99, 0.5, 0.5)
    expectGolden(v, 'slow_pole', ex.pSlow)
    expectGolden(v, 'fast_pole', ex.pFast)
    expectGolden(v, 'blocks_95', ex.stepsSlow)
    expectGolden(v, 'preconditioned_pole', ex.pPrecond)
    expectGolden(v, 'preconditioned_blocks_95', ex.stepsPrecond)
    const M = v.expected.preconditioner_M as number[][]
    expect(Math.abs(ex.mDiag - M[0][0])).toBeLessThan(1e-9)
    expect(Math.abs(ex.mOff - M[0][1])).toBeLessThan(1e-9)
  })

  it('勘誤 E05：若改用物理 K_q = 0.00798 fs⁻¹、μ = 0.5 fs，慢 pole 0.99996011、約 75,091 blocks', () => {
    const g = 0.5 * comparatorKq(100)
    const ex = eigenExample(0.99, g, 0.5)
    expect(ex.pSlow).toBeCloseTo(0.99996011, 8)
    expect(ex.stepsSlow).toBe(75091)
  })

  it('T03: Gaussian 純量 x：mean 界 2、mean-square 界 2/3（呼叫 lms.ts 的實作）', () => {
    const v = vec('T03')
    expectGolden(v, 'mu_ms_max', meanSquareMuMax(1, 3))
    expect(meanSquareFactor(1, 1, 3)).toBe(2) // μ = 1：mean pole 0，但 E[δ²] 每步 ×2
  })

  it('反面：ρ = 1（λ_min = 0）時慢 mode 的 pole = 1，永遠不衰減（不可辨識）', () => {
    const ex = eigenExample(1, 0.5, 0.5)
    expect(ex.lmin).toBe(0)
    expect(ex.pSlow).toBe(1)
    expect(ex.stepsSlow).toBe(Infinity)
    expect(corr2Eigs(1, -0.4)).toEqual({ lmax: 1.4, lmin: 0.6 })
  })
})

describe('D1 / Ch12：係數雜訊', () => {
  const T13 = calNoise({ sigmaV: 100, N: 4096, mu: 10, C: 1, fs: 4e9 })

  it('T13: σ_v = 100 fs、N = 4096、μ = 10 fs、C = 1 ⇒ p ≈ 0.92021、σ_w ≈ 0.399 fs', () => {
    const v = vec('T13')
    expectGolden(v, 'K_per_fs', T13.Kq)
    expectGolden(v, 'g', T13.g)
    expectGolden(v, 'p', T13.p)
    expectGolden(v, 'sigma_w_fs', T13.sigmaW)
    expectGolden(v, 'sigma_w2_fs2', T13.sigmaW2)
  })

  it('T13: 反面測試：GMAC 用總和卻沿用 average 的 μ ⇒ g × N = 326.8、pole −325.8', () => {
    const v = vec('T13')
    expectGolden(v, 'g_sum_mode', T13.gSum)
    expectGolden(v, 'pole_sum_mode', T13.pSum)
    const neg = vec('negative_tests')
    const s = gainScale({ ...BASE, convention: 'signBlock', mu: 10, sumMode: true })
    expect(s / gainScale({ ...BASE, convention: 'signBlock', mu: 10 })).toBeCloseTo(neg.expected.sum_mode_gain_multiplier as number, 9)
  })

  it('T14: f_u = 976.5625 kHz；−3 dB exact / −ln p / (1−p) / ENBW 四種定義分列（勘誤 E06/E10）', () => {
    const v = vec('T14')
    expectGolden(v, 'f_u_hz', T13.fu)
    expectGolden(v, 'bw_exact_3db_hz', T13.f3dbExact)
    expectGolden(v, 'bw_neg_ln_p_hz', T13.f3dbNegLnP)
    expectGolden(v, 'bw_one_minus_p_hz', T13.f3dbOneMinusP)
    expectGolden(v, 'enbw_one_sided_hz', T13.enbw)
    // ENBW 的定義：σ_w² = S_w^(1)(0)·ENBW，S_w^(1)(0) = 2μ²σ_η²/((1−p)² f_u)
    const s0 = (2 * 100 * T13.sigmaEta2) / ((1 - T13.p) ** 2 * T13.fu)
    expect(Math.sqrt(s0 * T13.enbw)).toBeCloseTo(T13.sigmaW, 12)
  })

  it('p ≤ 3 − 2√2 時沒有 −3 dB 點（回傳 NaN 而不是硬套近似）', () => {
    const r = calNoise({ sigmaV: 1, N: 1, mu: 1, C: 0.9 / comparatorKq(1), fs: 1 })
    expect(r.p).toBeCloseTo(0.1, 12)
    expect(Number.isNaN(r.f3dbExact)).toBe(true)
  })
})

describe('D2 / Ch06–Ch07：單頻與多頻相關', () => {
  it('T06: φ = 0/60/90/120/180° 的 C 與 φ = 120° 的 pole 1.01995；反極性 pole 1.0798', () => {
    const v = vec('T06')
    const list = v.expected.C_at_phi_list_deg as number[]
    ;[0, 60, 90, 120, 180].forEach((deg, i) => {
      expect(Math.abs(toneCorrelation(1, 1, (deg * Math.PI) / 180) - list[i])).toBeLessThanOrEqual(1e-12)
    })
    const g0 = 10 * comparatorKq(100)
    expectGolden(v, 'pole', 1 - g0 * toneCorrelation(1, 1, (120 * Math.PI) / 180))
    expectGolden(v, 'reversed_polarity_pole', 1 - gainScale({ ...BASE, convention: 'signBlock', mu: 10, polarity: -1 }))
  })

  it('時域整數週期平均與解析式一致；兩個 tone 時 C 是加權和，可以因第二個 tone 而變號', () => {
    const t1 = { A: 1, mag: 1, phiRad: Math.PI / 3, omega: Math.PI / 6 }
    const t2 = { A: 1, mag: 1, phiRad: (150 * Math.PI) / 180, omega: Math.PI / 3 }
    expect(multiToneEmpirical([t1], 12 * 50)).toBeCloseTo(toneCorrelation(1, 1, Math.PI / 3), 12)
    const C2 = multiToneCorrelation([t1, t2])
    expect(C2).toBeCloseTo(0.5 * (0.5 - Math.sqrt(3) / 2), 14)
    expect(C2).toBeLessThan(0)
    expect(multiToneEmpirical([t1, t2], 12 * 50)).toBeCloseTo(C2, 12)
  })

  it('勘誤 E46：Ω = π 時單頻公式差 2 倍（時域平均 = A²|H|cos φ）', () => {
    const t = { A: 1, mag: 1, phiRad: 0, omega: Math.PI }
    expect(multiToneEmpirical([t], 1000)).toBeCloseTo(1, 12)
    expect(toneCorrelation(1, 1, 0)).toBe(0.5)
  })

  it('filtered-x：模型相位誤差 < 90° 時 E[u·u_f] > 0，超過 90° 反號（勘誤 E45）', () => {
    expect(fxToneCorrelation(1, 1, 2, 1, 2)).toBeCloseTo(0.5, 15)
    expect(fxToneCorrelation(1, 1, 2, 1, 2 - (89 * Math.PI) / 180)).toBeGreaterThan(0)
    expect(fxToneCorrelation(1, 1, 2, 1, 2 - (91 * Math.PI) / 180)).toBeLessThan(0)
  })
})

describe('D4：激勵變弱 C → 0', () => {
  it('bias、時間常數、σ_w 一起隨 1/C 變差（σ_w² ≈ μσ_η²/(2K_qC)）', () => {
    const base = { B: 0.05, mu: 10, sigmaV: 100, N: 4096 }
    const r1 = weakExcitation({ ...base, C: 1 })
    const r01 = weakExcitation({ ...base, C: 0.01 })
    expect(r1.bias).toBeCloseTo(0.05, 15)
    expect(r01.bias).toBeCloseTo(5, 12)
    expect(r01.tau / r1.tau).toBeGreaterThan(90)
    const approx = Math.sqrt((10 * (1 / 4096)) / (2 * comparatorKq(100) * 0.01))
    expect(r01.sigmaW / approx).toBeCloseTo(1, 3)
    expect(r01.sigmaW).toBeGreaterThan(9 * r1.sigmaW)
  })
})

describe('D5 / D6 / Ch13：limit cycle、線譜、dither', () => {
  it('T16: 常數 32.4（= 162/5）、round-half-up：週期 5、循環 [32,33,32,33,32]；floor 為 [32,32,33,32,33]', () => {
    const v = vec('T16')
    const cyc = efCycle(162, 5)
    expect(cyc.transient).toBe(0)
    expectGolden(v, 'ef_period', cyc.period)
    expect(cyc.cycle).toEqual(v.expected.ef_cycle)
    expect(Array.from(efQuantize(162, 5, 5, { rounding: 'floor' }).y)).toEqual(v.inputs.pattern)
  })

  it('T16: 一個週期的 DFT 線譜 (√5∓1)/10，總誤差功率 0.24 LSB²、DC 誤差 0（勘誤 E15）', () => {
    const v = vec('T16')
    const mags = v.expected.dft_mag_list as number[]
    const L = cycleLines(efCycle(162, 5).cycle, 32.4)
    expect(Math.abs(L.amp[1] - mags[1])).toBeLessThan(1e-12)
    expect(Math.abs(L.amp[2] - mags[2])).toBeLessThan(1e-12)
    expect(L.totalPower).toBeCloseTo(0.24, 12)
    expect(L.dcError).toBeCloseTo(0, 12)
    expect(L.power[1]).toBeCloseTo(0.0305573, 6)
    expect(L.power[2]).toBeCloseTo(0.209443, 6)
    expect(L.power[1] + L.power[2]).toBeCloseTo(L.totalPower, 12) // Parseval
    expect(L.maxLineK).toBe(2)
  })

  it('golden quantizer_first_order：前 40 個輸出、r 序列與常數 32 + p/q 的週期 = q', () => {
    const v = vec('quantizer_first_order')
    const ef = efQuantize(162, 5, 40)
    expect(Array.from(ef.y)).toEqual(v.expected.y)
    const r = v.expected.r as number[]
    Array.from(ef.rNum).forEach((R, i) => expect(Math.abs(R / 5 - r[i])).toBeLessThan(1e-12))
    const fracs: [number, number][] = [
      [32, 1],
      [65, 2],
      [97, 3],
      [129, 4],
      [162, 5],
      [259, 8],
      [519, 16],
    ]
    expect(fracs.map(([P, q]) => efCycle(P, q).period)).toEqual(v.expected.period_list)
  })

  it('勘誤 E15：任何初始 r 都進入同一個週期 5；定點 F = 10 bit 時 32.4 量化成 33178/1024，週期 512', () => {
    for (const r0 of [1, -3, 2, 4]) expect(efCycle(162, 5, { r0Num: r0 }).period).toBe(5)
    const K = Math.round(32.4 * 1024)
    expect(K).toBe(33178)
    expect(efCycle(K, 1024).period).toBe(512)
  })

  it('PRBS-7：週期 127、64 個 1；±½ LSB 的週期 dither 讓輸出仍然週期性（有限狀態），平均偏移 = dither 的平均', () => {
    const b = prbs7()
    expect(b.length).toBe(127)
    expect(b.reduce((s, x) => s + x, 0)).toBe(64)
    // 127 是質數：只要不是常數序列，最小週期就是 127；再檢查 7-bit 視窗走遍 127 個非零狀態
    const windows = new Set<number>()
    for (let n = 0; n < 127; n++) {
      let s = 0
      for (let j = 0; j < 7; j++) s = (s << 1) | b[(n + j) % 127]
      windows.add(s)
    }
    expect(windows.size).toBe(127)
    expect(windows.has(0)).toBe(false)
    const dNum = prbsHalfLsbDither(b, 10)
    const cyc = efCycle(324, 10, { ditherNum: dNum })
    expect(Number.isFinite(cyc.period)).toBe(true)
    expect(cyc.period % 127).toBe(0)
    const mean = cyc.cycle.reduce((s, y) => s + y, 0) / cyc.period
    expect(mean - 32.4).toBeCloseTo(1 / 254, 12) // PRBS 的 64:63 不平衡 ⇒ (1/127)·½ LSB
    const L = cycleLines(cyc.cycle, 32.4)
    expect(L.maxLinePower).toBeGreaterThan(0)
    expect(L.totalPower).toBeGreaterThan(0.24)
    expect(() => prbsHalfLsbDither(b, 5)).toThrow()
  })

  it('dither 比較（固定 seed 的 Monte Carlo 落在解析值 ±4 SE 內）：0.16 / 0.24 / 1/12 LSB²', () => {
    const r = ditherCompare({ c: 32.4, n: 1 << 16, seed: 20261010 })
    expect(r.none.power).toBeCloseTo(0.16, 12)
    expect(r.analytic.nonSubtractivePower).toBeCloseTo(0.24, 12)
    expect(Math.abs(r.nonSubtractive.power - 0.24)).toBeLessThan(4 * r.nonSubtractive.sePower)
    expect(Math.abs(r.nonSubtractive.mean)).toBeLessThan(4 * r.nonSubtractive.seMean)
    expect(Math.abs(r.subtractive.power - 1 / 12)).toBeLessThan(4 * r.subtractive.sePower)
    expect(Math.abs(r.subtractive.mean)).toBeLessThan(4 * r.subtractive.seMean)
    // 同 seed 可重現
    expect(ditherCompare({ c: 32.4, n: 1000, seed: 7 })).toEqual(ditherCompare({ c: 32.4, n: 1000, seed: 7 }))
  })
})

describe('D1：四種「頻寬」的適用範圍（勘誤 E27）', () => {
  it('calNoise 的頻寬欄位就是 calBandwidths(p, f_u)；手算用的 1 − (1−p)²/(2p) 與程式的 (1+p²−2(1−p)²)/(2p) 是同一個數', () => {
    const n = calNoise({ sigmaV: 100, N: 4096, mu: 10, C: 1, fs: 4e9 })
    expect(calBandwidths(n.p, n.fu)).toEqual({ f3dbExact: n.f3dbExact, f3dbNegLnP: n.f3dbNegLnP, f3dbOneMinusP: n.f3dbOneMinusP, enbw: n.enbw })
    for (const p of [0.2, 0.5, 0.9, 0.92021, 0.999]) {
      const viaE27 = Math.acos(1 - (1 - p) ** 2 / (2 * p)) / (2 * Math.PI)
      expect(calBandwidths(p, 1).f3dbExact).toBeCloseTo(viaE27, 12)
    }
  })

  it('反面：p ≤ 3 − 2√2、p ≤ 0、p ≥ 1 時不回報 −3 dB 頻寬（NaN），不硬套公式', () => {
    const pMin = 3 - 2 * Math.SQRT2
    expect(Number.isNaN(calBandwidths(pMin - 1e-6, 1).f3dbExact)).toBe(true)
    expect(Number.isFinite(calBandwidths(pMin + 1e-6, 1).f3dbExact)).toBe(true)
    expect(calBandwidths(pMin + 1e-9, 1).f3dbExact).toBeCloseTo(0.5, 3) // 剛好存在時落在 Nyquist f_u/2
    for (const p of [0, -0.5, 1, 1.08]) {
      expect(Number.isNaN(calBandwidths(p, 1).f3dbExact), `p=${p}`).toBe(true)
      expect(Number.isNaN(calBandwidths(p, 1).f3dbNegLnP), `p=${p}`).toBe(true)
    }
  })
})

describe('D1：反過來讀文獻——由「頻寬 B」換回 pole（F-PR.9 的反函數）', () => {
  it('T14: 來回驗算：p → calBandwidths → poleFromF3db / poleFromEnbw 回到同一個 p（含 golden 的 T14 數字）', () => {
    const v = vec('T14')
    const fu = v.expected.f_u_hz as number
    const p = v.inputs.p as number
    expect(Math.abs(poleFromF3db(v.expected.bw_exact_3db_hz as number, fu) - p)).toBeLessThan(1e-12)
    expect(Math.abs(poleFromEnbw(v.expected.enbw_one_sided_hz as number, fu) - p)).toBeLessThan(1e-12)
    for (const q of [0.18, 0.2, 0.5, 0.8, 0.9, 0.92021, 0.99, 0.999, 0.99999]) {
      const bw = calBandwidths(q, 976562.5)
      expect(Math.abs(poleFromF3db(bw.f3dbExact, 976562.5) - q), `f3dB p=${q}`).toBeLessThan(1e-10)
      expect(Math.abs(poleFromEnbw(bw.enbw, 976562.5) - q), `ENBW p=${q}`).toBeLessThan(1e-12)
    }
    // ENBW 的反函數對 0 < p < 1 全域成立（p 再小也有 ENBW，只是沒有 −3 dB 點）
    expect(poleFromEnbw(calBandwidths(0.05, 1).enbw, 1)).toBeCloseTo(0.05, 12)
  })

  it('獨立驗算：poleFromF3db 給的 p 真的讓 |H(e^{jΩ})|² 在 Ω = 2πB/f_u 降到 DC 的一半；poleFromEnbw 給的 p 的數值積分等於 B', () => {
    for (const [B, fu] of [
      [12.93, 976.5625],
      [5, 2000],
      [50, 500],
      [0.2, 1],
      [0.45, 1],
    ] as const) {
      const p = poleFromF3db(B, fu)
      expect(p).toBeGreaterThan(3 - 2 * Math.SQRT2)
      expect(p).toBeLessThan(1)
      const Om = (2 * Math.PI * B) / fu
      expect((1 - p) ** 2 / (1 + p * p - 2 * p * Math.cos(Om))).toBeCloseTo(0.5, 10)
      const pe = poleFromEnbw(B, fu)
      const K = 100_000
      let integ = 0
      for (let i = 0; i < K; i++) integ += ((1 - pe) ** 2 / (1 + pe * pe - 2 * pe * Math.cos((Math.PI * (i + 0.5)) / K)) / K) * (fu / 2)
      expect(integ / B).toBeCloseTo(1, 9)
    }
    // 兩種讀法的 loop gain 比值：B ≪ f_u 時趨近 π/2，隨 B/f_u 單調下降，B ≈ 0.324 f_u 時等於 1，再大就小於 1
    const ratio = (b: number) => (1 - poleFromF3db(b, 1)) / (1 - poleFromEnbw(b, 1))
    expect(ratio(1e-4)).toBeCloseTo(Math.PI / 2, 3)
    expect(ratio(0.1)).toBeCloseTo(1.3677, 3)
    expect(ratio(0.324069)).toBeCloseTo(1, 5)
    expect(ratio(0.45)).toBeLessThan(0.9)
    let prev = Infinity
    for (let b = 0.005; b < 0.5; b += 0.005) {
      expect(ratio(b)).toBeLessThan(prev)
      prev = ratio(b)
    }
  })

  it('反面：B ≤ 0 或 B ≥ f_u/2 時回傳 NaN（超過 Nyquist 沒有對應的 pole，勘誤 E27）；界限上 p → 3 − 2√2', () => {
    for (const f of [poleFromF3db, poleFromEnbw]) {
      expect(Number.isNaN(f(0, 1))).toBe(true)
      expect(Number.isNaN(f(-0.1, 1))).toBe(true)
      expect(Number.isNaN(f(0.5, 1))).toBe(true)
      expect(Number.isNaN(f(0.7, 1))).toBe(true)
      expect(Number.isNaN(f(Number.NaN, 1))).toBe(true)
    }
    expect(poleFromF3db(0.5 - 1e-9, 1)).toBeCloseTo(3 - 2 * Math.SQRT2, 8)
    expect(poleFromEnbw(0.5 - 1e-9, 1)).toBeCloseTo(0, 8)
  })
})

describe('D5：PRBS dither 加在哪裡、有幾個準位（勘誤 E15）', () => {
  const bits = prbs7()
  const bitDither = prbsHalfLsbDither(bits, 10)
  const words = prbs7Words(bits)
  const wordDither = prbsWordDither(words, 640)

  it('efDitherStep：沒有 dither 時兩種接法都退化成 efStep；shaped 的 r = (捨入誤差) − ξ', () => {
    for (const V of [-17, -5, 0, 3, 5, 162, 324, 329]) {
      expect(efDitherStep(V, 0, 10, 'nearest', false)).toEqual(efStep(V, 10, 'nearest'))
      expect(efDitherStep(V, 0, 10, 'nearest', true)).toEqual(efStep(V, 10, 'nearest'))
      for (const xi of [-5, 5, 3]) {
        const [y, rq] = efStep(V + xi, 10, 'nearest')
        expect(efDitherStep(V, xi, 10, 'nearest', false)).toEqual([y, rq])
        expect(efDitherStep(V, xi, 10, 'nearest', true)).toEqual([y, rq - xi])
        expect(rq - xi).toBe(V - y * 10) // r[n] = v[n] − y[n]
      }
    }
  })

  it('T16: shaped 接法逐點等於 Ch13 的策略 E（quantizer.ts 的 deltaSigmaDitherStep）；沒有 dither 時等於策略 D', () => {
    const ctx = (D: number, dither: () => number): QuantCtx => ({
      D,
      rounding: 'nearest',
      overflow: 'saturate',
      maxCode: 63,
      nCodes: 64,
      antiWindup: false,
      rLo: -D,
      rHi: D,
      togglePeriod: 5,
      toggleOrder: 'spread',
      rand: () => 0,
      dither,
    })
    const state = (): QState => ({ n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 })
    for (const [cNum, den, dn] of [
      [324, 10, bitDither],
      [20736, 640, wordDither],
    ] as const) {
      const N = 127 * 12
      const mine = efQuantize(cNum, den, N, { ditherNum: dn, shaped: true })
      const s = state()
      let n = 0
      const c = ctx(den, () => dn[n % dn.length])
      for (n = 0; n < N; n++) {
        expect(deltaSigmaDitherStep(cNum, s, c), `den=${den} n=${n}`).toBe(mine.y[n])
        expect(s.r).toBe(mine.rNum[n])
      }
      expect(s.overflow).toBe(0)
    }
    const plain = efQuantize(162, 5, 40)
    const s = state()
    const c = ctx(5, () => 0)
    for (let n = 0; n < 40; n++) expect(deltaSigmaStep(162, s, c)).toBe(plain.y[n])
  })

  it('F-PR.14 恆等式：1-bit ±½ LSB dither 只加在量化器輸入 ⇒ y[n] = y_floor[n] + b[n] − b[n−1]（limit cycle 原封不動）', () => {
    const N = 127 * 10
    const y = efQuantize(324, 10, N, { ditherNum: bitDither, shaped: true }).y
    const yFloor = efQuantize(162, 5, N, { rounding: 'floor' }).y
    for (let n = 0; n < N; n++) expect(y[n], `n=${n}`).toBe(yFloor[n] + bits[n % 127] - (n === 0 ? 0 : bits[(n - 1) % 127]))
    // 所以譜線包含無 dither 的兩條線，大小完全相同
    const cyc = efCycle(324, 10, { ditherNum: bitDither, shaped: true })
    expect(cyc.period).toBe(635)
    const L = cycleLines(cyc.cycle, 32.4)
    const L0 = cycleLines(efCycle(162, 5).cycle, 32.4)
    expect(L.power[127]).toBeCloseTo(L0.power[1], 12) // f_u/5
    expect(L.power[254]).toBeCloseTo(L0.power[2], 12) // 2f_u/5
    expect(L.maxLineK).toBe(254)
    expect(L.maxLinePower).toBeCloseTo(L0.maxLinePower, 12)
    expect(L.dcError).toBeCloseTo(0, 12)
    // 總功率 = limit cycle 的 0.24 + E[(b[n] − b[n−1])²]（兩組譜線頻率不重疊，功率直接相加）
    let diff2 = 0
    for (let n = 0; n < 127; n++) diff2 += (bits[n] - bits[(n + 126) % 127]) ** 2 / 127
    expect(diff2).toBeCloseTo(64 / 127, 12) // 最大長度序列一個週期有 64 次 0↔1 轉態
    expect(L.totalPower).toBeCloseTo(0.24 + diff2, 12)
  })

  it('F-PR.14 恆等式：1-bit ±½ LSB dither 併入殘值 ⇒ y[n] = y_{31.9}[n] + b[n]（只是換了一個 limit cycle）', () => {
    const N = 127 * 10
    const y = efQuantize(324, 10, N, { ditherNum: bitDither }).y
    const yShift = efQuantize(319, 10, N).y // 目標 c − ½ = 31.9、無 dither、同樣 r[−1] = 0
    for (let n = 0; n < N; n++) expect(y[n], `n=${n}`).toBe(yShift[n] + bits[n % 127])
    const shifted = efCycle(319, 10)
    expect(shifted.period).toBe(10)
    const Ls = cycleLines(shifted.cycle, 31.9)
    const L = cycleLines(efCycle(324, 10, { ditherNum: bitDither }).cycle, 32.4)
    expect(L.maxLinePower).toBeCloseTo(Ls.maxLinePower, 12) // 「降低」的最大譜線其實是 31.9 那個循環的譜線
    expect(Ls.maxLinePower).toBeCloseTo(0.02, 12)
    expect(L.dcError).toBeCloseTo(1 / 254, 12)
  })

  it('7-bit PRBS 字：127 個相異準位、平均恰為 0、落在 (−½, ½) LSB；下一個字只多 1 個新 bit', () => {
    expect(words.length).toBe(127)
    expect(new Set(words).size).toBe(127)
    expect(Math.min(...words)).toBe(1)
    expect(Math.max(...words)).toBe(127)
    expect(words.reduce((a, b) => a + b, 0)).toBe(127 * 64)
    expect(wordDither.reduce((a, b) => a + b, 0)).toBe(0)
    for (const x of wordDither) expect(Math.abs(x / 640)).toBeLessThan(0.5)
    for (let n = 0; n < 127; n++) expect(words[(n + 1) % 127]).toBe(((words[n] << 1) & 0x7f) | bits[(n + 7) % 127])
    expect(() => prbsWordDither(words, 100)).toThrow()
  })

  it('7-bit 字 dither 真的打散 limit cycle：最大譜線降 15 dB 以上，但仍是週期 635 的線譜；總誤差功率沒有變少', () => {
    const base = cycleLines(efCycle(162, 5).cycle, 32.4).maxLinePower
    const shaped = efCycle(20736, 640, { ditherNum: wordDither, shaped: true })
    const input = efCycle(20736, 640, { ditherNum: wordDither })
    expect(shaped.period).toBe(635)
    expect(input.period).toBe(635)
    const Ls = cycleLines(shaped.cycle, 32.4)
    const Li = cycleLines(input.cycle, 32.4)
    expect(10 * Math.log10(Ls.maxLinePower / base)).toBeLessThan(-15)
    expect(10 * Math.log10(Li.maxLinePower / base)).toBeLessThan(-14)
    expect(Ls.maxLinePower).toBeGreaterThan(1e-3) // 還是有譜線
    // shaped：輸出只有 32、33 兩個 code、平均恰為 32.4 ⇒ 誤差功率必為 f(1 − f) = 0.24
    expect([...new Set(shaped.cycle)].sort()).toEqual([32, 33])
    expect(Ls.totalPower).toBeCloseTo(0.24, 12)
    expect(Ls.dcError).toBeCloseTo(0, 12)
    // 併入殘值：零均值 dither ⇒ DC 誤差 0，但用到第三個 code，總功率更大
    expect([...new Set(input.cycle)].sort()).toEqual([31, 32, 33])
    expect(Li.totalPower).toBeGreaterThan(0.24)
    expect(Li.dcError).toBeCloseTo(0, 12)
    // Parseval：各線功率加總 = 總功率
    for (const L of [Ls, Li]) expect(Array.from(L.power).reduce((a, b) => a + b, 0)).toBeCloseTo(L.totalPower, 10)
  })

  it('有限狀態的界限對兩種接法都成立：shaped 時 r ∈ [−½ − ξ_max, ½ − ξ_min)，R 最多 2·den 個值', () => {
    for (const shaped of [false, true]) {
      const { rNum } = efQuantize(324, 10, 127 * 20, { ditherNum: bitDither, shaped })
      const lo = Math.min(...rNum)
      const hi = Math.max(...rNum)
      if (shaped) {
        expect(lo).toBeGreaterThanOrEqual(-10)
        expect(hi).toBeLessThan(10)
      } else {
        expect(lo).toBeGreaterThanOrEqual(-5)
        expect(hi).toBeLessThan(5)
      }
      expect(efCycle(324, 10, { ditherNum: bitDither, shaped }).period).toBeLessThanOrEqual((shaped ? 20 : 10) * 127)
    }
  })

  it('T17: ditherErrorPowers：32.4 ⇒ 0.16 / 0.24 / 1/12；整數目標時前兩者為 0；f(1−f) ≥ (Q(c)−c)² 恆成立', () => {
    const T17 = vec('T17')
    const p = ditherErrorPowers(32.4)
    expect(p.q).toBe(32)
    expect(p.f).toBeCloseTo(0.4, 12)
    expect(p.nonePower).toBeCloseTo(0.16, 12)
    expectGolden(T17, 'variance', p.nonSubtractivePower)
    expect(p.subtractivePower).toBe(1 / 12)
    expect(ditherErrorPowers(33)).toMatchObject({ f: 0, q: 33, nonePower: 0, nonSubtractivePower: 0 })
    expect(ditherErrorPowers(17.5)).toMatchObject({ q: 18, nonePower: 0.25, nonSubtractivePower: 0.25 }) // tie：round-half-up 進位
    for (let c = 0; c <= 4; c += 0.01) {
      const q = ditherErrorPowers(c)
      expect(q.nonSubtractivePower + 1e-12).toBeGreaterThanOrEqual(q.nonePower)
    }
    expect(ditherCompare({ c: 32.4, n: 16, seed: 1 }).analytic).toEqual({ nonePower: p.nonePower, nonSubtractivePower: p.nonSubtractivePower, subtractivePower: p.subtractivePower })
  })
})
