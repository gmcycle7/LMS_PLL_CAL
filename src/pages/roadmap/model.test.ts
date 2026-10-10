import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normPdf, normSf } from '@/simulation/core'
import { sigmaW2Colored as sharedSigmaW2Colored } from '@/simulation/models/calNoise'
import {
  accumulatorBits,
  analyzeEf,
  cAr1,
  cAr1BySum,
  closedLoopSummary,
  comparatorMean,
  comparatorSlope,
  coloredPsd,
  cTone,
  cWhite,
  cWhiteByIntegral,
  cycloAutocorr,
  designMetrics,
  drawNoise,
  dualLoopMuMax,
  efQuantizerInt,
  efTheoryPeriod,
  eig2,
  firstDiffKernelMin,
  floorTol,
  firstDiffMarginTypeII,
  hpdReGrid,
  hysteresisStats,
  inverseDesign,
  kalmanSteady,
  kalmanTrackStep,
  liftedDualLoop,
  loopTransfer,
  MC_BURN_CAP,
  mcComparator,
  nearIntegerAsymptote,
  nearIntegerKeepOut,
  noiseCdf,
  noisePdf,
  optimalTrackingGain,
  pmuxKappa,
  pmuxSureBand,
  PMUX_W1,
  polarityScan,
  precondSweep,
  quasiStaticPole,
  regularizedPreconditioner,
  saturateTwos,
  scalarLmsPoles,
  sigmaW2Colored,
  sigmaW2Lyapunov,
  simulateColoredLms,
  simulateCyclo,
  simulateMultirate,
  simulatePrecond,
  simulateTracking,
  trackingVariance,
  uniformCodeR,
  windowLambdaMin,
  worstCaseAccumulate,
  worstCaseSafeCount,
  wrapTwos,
  zetaWnFromKpKi,
  type LoopSpec,
  type NoiseSpec,
} from './model'
import { createRng } from '@/simulation/core'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
}

function golden(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}

function within(actual: number, expected: number, tol: { abs?: number; rel?: number }) {
  const lim = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(lim)
}

// T13 參數（§12.1）
const KQ = Math.sqrt(2 / Math.PI) / 100
const T13 = { p: 1 - 10 * KQ, mu: 10, sigmaEta2: 1 / 4096 }

describe('R1｜有色 GMAC 雜訊', () => {
  it('T13: ρ = 0 時封閉式退化成白雜訊 σ_w（與 golden/vectors/T13.json 一致）', () => {
    const v = golden('T13')
    const e = v.expected as Record<string, number>
    within(T13.p, e.p, v.tolerance)
    within(sigmaW2Colored({ ...T13, rho: 0 }), e.sigma_w2_fs2, v.tolerance)
    within(Math.sqrt(sigmaW2Colored({ ...T13, rho: 0 })), e.sigma_w_fs, v.tolerance)
  })

  it('封閉式 = Lyapunov 數值解（多組 p、ρ，含負值）', () => {
    for (const p of [0.92021, 0.5, -0.3, 0.99]) {
      for (const rho of [0, 0.5, -0.5, 0.9, -0.95]) {
        const a = sigmaW2Colored({ p, mu: 10, sigmaEta2: 1 / 4096, rho })
        const b = sigmaW2Lyapunov({ p, mu: 10, sigmaEta2: 1 / 4096, rho })
        expect(Math.abs(a - b) / a).toBeLessThan(1e-10)
      }
    }
  })

  it('Parseval：單邊 PSD 的積分 = σ_w²（ρ = 0.5）', () => {
    const P = { ...T13, rho: 0.5 }
    const { integral } = coloredPsd({ ...P, fu: 4e9 / 4096, points: 200001 })
    expect(Math.abs(integral - sigmaW2Colored(P)) / sigmaW2Colored(P)).toBeLessThan(2e-3)
  })

  it('Monte Carlo（固定 seed）落在 95% CI 附近：ρ = 0、0.6、−0.5', () => {
    for (const rho of [0, 0.6, -0.5]) {
      const P = { ...T13, rho }
      const mc = simulateColoredLms({ ...P, chains: 24, blocks: 6000, seed: 20261010 })
      const th = sigmaW2Colored(P)
      const half = (mc.hi - mc.lo) / 2
      expect(Math.abs(mc.meanSq - th)).toBeLessThan(2 * half + 0.01 * th)
    }
  })

  it('與第 12 章共用模型 calNoise.sigmaW2Colored（該章記作 r）逐點一致：兩份獨立實作', () => {
    for (const p of [0.92021, 0.5, -0.3, 0.99]) {
      for (const rho of [0, 0.5, -0.5, 0.9, -0.95]) {
        const mine = sigmaW2Colored({ p, mu: 10, sigmaEta2: 1 / 4096, rho })
        const shared = sharedSigmaW2Colored(10, 1 / 4096, p, rho)
        expect(Math.abs(mine - shared) / shared).toBeLessThan(1e-13)
      }
    }
  })

  it('反面：迴路太慢時 burn-in 被上限截斷（< 5τ），回傳 burnInAdequate = false——不可拿來判定', () => {
    const ok = simulateColoredLms({ ...T13, rho: 0.5, chains: 4, blocks: 200, seed: 1 })
    expect(ok.burnInAdequate).toBe(true)
    expect(ok.burnIn).toBe(Math.ceil(20 * ok.tauBlocks))
    const slowP = { p: 0.99996, mu: 0.005, sigmaEta2: 1 / 4096, rho: 0 }
    const slow = simulateColoredLms({ ...slowP, chains: 16, blocks: 500, seed: 1 })
    expect(slow.tauBlocks).toBeCloseTo(25000, 3)
    expect(slow.burnIn).toBe(MC_BURN_CAP)
    expect(slow.burnInAdequate).toBe(false)
    // 真的偏低：從 δw = 0 出發只跑了不到 0.1τ，變異數只長到穩態值的 1 − e^{−2k/τ}（k ≈ burn-in + blocks/2），遠小於 1
    expect(slow.meanSq).toBeLessThan(0.6 * sigmaW2Colored(slowP))
  })

  it('反面：|p| ≥ 1 或 |ρ| ≥ 1 時回傳 ∞（不可宣稱有穩態變異數）', () => {
    expect(sigmaW2Colored({ p: 1.02, mu: 10, sigmaEta2: 1e-3, rho: 0 })).toBe(Number.POSITIVE_INFINITY)
    expect(sigmaW2Colored({ p: 0.9, mu: 10, sigmaEta2: 1e-3, rho: 1 })).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('R2｜cyclostationary DSM × ZOH 係數雜訊', () => {
  it('gcd(P, N) = 1 時時間平均自相關精確分解（中國餘數定理）', () => {
    const r = cycloAutocorr({ K: 3, M: 8, N: 15, p: 0.6, maxLag: 45 })
    expect(r.g).toBe(1)
    expect(r.maxRelErr).toBeLessThan(1e-12)
  })

  it('gcd(P, N) > 1（N = 16 與 P = 8 同步）時「獨立平穩」近似明顯失準', () => {
    const r = cycloAutocorr({ K: 3, M: 8, N: 16, p: 0.6, maxLag: 48 })
    expect(r.g).toBe(8)
    expect(r.maxRelErr).toBeGreaterThan(1e-3)
    // lag 0 不受影響：E[δt²] 的時間平均 = mean(x²)·σ_w²
    expect(Math.abs(r.exact[0] - r.factorized[0])).toBeLessThan(1e-14)
  })

  it('Monte Carlo 的時間平均自相關吻合精確式（N = 16 的同步情況）', () => {
    const P = { K: 3, M: 8, N: 16, p: 0.6, maxLag: 32 }
    const ex = cycloAutocorr(P)
    const mc = simulateCyclo({ ...P, seed: 7, budget: 1 << 17 })
    let maxErr = 0
    for (let m = 0; m <= 32; m++) maxErr = Math.max(maxErr, Math.abs(mc.empirical[m] - ex.exact[m]))
    expect(maxErr / ex.exact[0]).toBeLessThan(0.08)
  })

  it('frac = 0（K ≡ 0 mod M）時 residue 恆為 0：不會產生 NaN', () => {
    const r = cycloAutocorr({ K: 8, M: 8, N: 16, p: 0.6, maxLag: 4 })
    expect(r.P).toBe(1)
    expect(r.exact.every((v) => v === 0)).toBe(true)
    expect(Number.isFinite(r.maxRelErr)).toBe(true)
  })
})

describe('R3｜一階 EF quantizer 的 limit cycle', () => {
  it('golden quantizer_first_order：32.4 = 162/5、round-half-up、r[−1] = 0 的 40 步輸出與 r', () => {
    const v = golden('quantizer_first_order')
    const e = v.expected as { y: number[]; r: number[]; period: number; cycle: number[]; y_floor_rounding_first10: number[]; period_list: number[] }
    const run = efQuantizerInt(162, 5, 40, 'nearest', 0)
    expect(run.y).toEqual(e.y)
    run.R.forEach((R, i) => expect(Math.abs(R / 5 - e.r[i])).toBeLessThan(1e-12))
    expect(efTheoryPeriod(162, 5)).toBe(e.period)
    expect(run.y.slice(0, 5)).toEqual(e.cycle)
    expect(efQuantizerInt(162, 5, 10, 'floor', 0).y).toEqual(e.y_floor_rounding_first10)
    const targets: [number, number][] = [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 5],
      [3, 8],
      [7, 16],
    ]
    const periods = targets.map(([num, den]) => analyzeEf({ mode: 'rational', target: 32, fracBits: 0, num, den, rounding: 'nearest', bits: 6 }).period)
    expect(periods).toEqual(e.period_list)
  })

  it('T16: 一週期的譜線 |Y_k|/5 = (√5 ∓ 1)/10，平均恰為 32.4、誤差功率 0.24 LSB²', () => {
    const v = golden('T16')
    const e = v.expected as { dft_mag_list: number[]; ef_period: number; ef_cycle: number[] }
    const a = analyzeEf({ mode: 'rational', target: 32, fracBits: 0, num: 2, den: 5, rounding: 'nearest', bits: 6 })
    expect(a.period).toBe(e.ef_period)
    expect(a.cycle).toEqual(e.ef_cycle)
    within(a.cycleMean, 32.4, v.tolerance)
    within(a.errorPower, 0.24, { abs: 1e-12 })
    const byK = new Map(a.topLines.map((l) => [l.k, l.mag]))
    within(byK.get(1) ?? NaN, e.dft_mag_list[1], v.tolerance)
    within(byK.get(2) ?? NaN, e.dft_mag_list[2], v.tolerance)
  })

  it('定點：F = 10 → 32.400390625、週期 512；F = 16 → 週期 32768（S/gcd）', () => {
    const f10 = analyzeEf({ mode: 'fixed', target: 32.4, fracBits: 10, num: 0, den: 1, rounding: 'nearest', bits: 6 })
    expect(f10.represented).toBe(32.400390625)
    expect(f10.period).toBe(512)
    expect(f10.periodTheory).toBe(512)
    expect(Math.abs(f10.cycleMean - f10.represented)).toBeLessThan(1e-12)
    const f16 = analyzeEf({ mode: 'fixed', target: 32.4, fracBits: 16, num: 0, den: 1, rounding: 'nearest', bits: 6 })
    expect(f16.period).toBe(32768)
  })

  it('反面：目標超出 6-bit 範圍時標示 overload', () => {
    const a = analyzeEf({ mode: 'fixed', target: 63.7, fracBits: 4, num: 0, den: 1, rounding: 'nearest', bits: 6 })
    expect(a.overload).toBe(true)
  })
})

describe('R4｜Regularized preconditioner', () => {
  const J = [
    [-1, 2],
    [2, -1],
  ]
  it('T18: M = 0.2I 的 poles 1.2、0.4（發散）；正則化 γ = 0.5、ε = 0.1 的 poles 與 golden 一致', () => {
    const v = golden('T18')
    const e = v.expected as { eig_A_desc: number[]; reg_poles_desc: number[] }
    const raw = scalarLmsPoles(J, 0.2)
      .map((z) => z.re)
      .sort((a, b) => b - a)
    within(raw[0], e.eig_A_desc[0], v.tolerance)
    within(raw[1], e.eig_A_desc[1], v.tolerance)
    const r = regularizedPreconditioner({ J, gamma: 0.5, eps: 0.1, sigmaEta2: 1 })
    const sorted = [...r.poles].sort((a, b) => b - a)
    within(sorted[0], e.reg_poles_desc[0], v.tolerance)
    within(sorted[1], e.reg_poles_desc[1], v.tolerance)
    // 直接 eig(I + MJ) 與封閉式一致
    r.polesEig.forEach((p, i) => expect(Math.abs(p - sorted[i])).toBeLessThan(1e-12))
  })

  it('不定 J：任何純量 M = μI（μ 正或負）都至少有一個 pole 在單位圓外', () => {
    for (let mu = -2.5; mu <= 2.5; mu += 0.01) {
      const rho = Math.max(...scalarLmsPoles(J, mu).map((z) => Math.hypot(z.re, z.im)))
      expect(rho).toBeGreaterThanOrEqual(1 - 1e-12)
    }
  })

  it('每個 mode 的變異數封閉式 = Lyapunov trace = Monte Carlo（CI）', () => {
    const P = { J, gamma: 0.5, eps: 0.3, sigmaEta2: 0.01 }
    const r = regularizedPreconditioner(P)
    expect(r.totalVarLyap).not.toBeNull()
    expect(Math.abs((r.totalVarLyap as number) - r.totalVar) / r.totalVar).toBeLessThan(1e-10)
    const mc = simulatePrecond({ ...P, chains: 16, blocks: 4000, seed: 11 })
    const half = (mc.hi - mc.lo) / 2
    expect(Math.abs(mc.meanSq - r.totalVar)).toBeLessThan(2 * half + 0.02 * r.totalVar)
  })

  it('ε ↑：收斂變慢、雜訊變小（取捨單調）', () => {
    const sw = precondSweep({ J: [[1, 0.99], [0.99, 1]], gamma: 0.5, sigmaEta2: 1, epsGrid: [0, 1e-3, 1e-2, 1e-1, 1] })
    for (let i = 1; i < sw.eps.length; i++) {
      expect(sw.totalVar[i]).toBeLessThanOrEqual(sw.totalVar[i - 1] + 1e-12)
      expect(sw.settle[i]).toBeGreaterThanOrEqual(sw.settle[i - 1])
    }
  })

  it('反面：奇異 J（λ_min = 0）→ 一個 null 方向、pole = 1、Lyapunov 無解', () => {
    const r = regularizedPreconditioner({ J: [[1, 1], [1, 1]], gamma: 0.5, eps: 0.1, sigmaEta2: 1 })
    expect(r.nullDirs).toBe(1)
    expect(Math.max(...r.poles)).toBe(1)
    expect(r.totalVarLyap).toBeNull()
  })
})

describe('R5｜E-optimal / D-optimal 與 near-integer PE', () => {
  it('det R = s²h²/3 與平均無關；λ_min 隨 |平均| 下降（centering 只影響 E-optimal）', () => {
    const d0 = designMetrics(uniformCodeR(0, 0.5, 1))
    const d1 = designMetrics(uniformCodeR(0.4, 0.5, 1))
    expect(Math.abs(d0.det - 0.25 / 3)).toBeLessThan(1e-12)
    expect(Math.abs(d1.det - 0.25 / 3)).toBeLessThan(1e-12)
    expect(d1.lambdaMin).toBeLessThan(d0.lambdaMin)
  })

  it('換單位（對角縮放 S）：det 只乘上 det(S)²，λ_min 的排名卻可能翻轉', () => {
    const A = uniformCodeR(0, 0.5, 1) // centered，Var = 1/12
    const B = uniformCodeR(0.3, 0.6, 1) // 有平均，Var = 0.12
    const As = uniformCodeR(0, 0.5, 0.1)
    const Bs = uniformCodeR(0.3, 0.6, 0.1)
    const [a, b, as, bs] = [A, B, As, Bs].map(designMetrics)
    expect(Math.abs(as.det / a.det - 0.01)).toBeLessThan(1e-12)
    expect(Math.abs(bs.det / b.det - 0.01)).toBeLessThan(1e-12)
    expect(b.det > a.det).toBe(bs.det > as.det) // D-optimal 排名不變
    expect(a.lambdaMin > b.lambdaMin).not.toBe(as.lambdaMin > bs.lambdaMin) // E-optimal 排名翻轉
  })

  it('小 α：最差窗口 λ_min → α²(N0² − 1)/15（λ ∝ α²）', () => {
    for (const alpha of [1e-5, 3e-5]) {
      const w = windowLambdaMin(alpha, 256)
      const ratio = w.worst / nearIntegerAsymptote(alpha, 256)
      expect(ratio).toBeGreaterThan(0.95)
      expect(ratio).toBeLessThan(1.1)
    }
  })

  it('keep-out 邊界 α_keep = √(15λ_t/(N0² − 1)) 是漸近式的反函數；與 1/N0 成正比', () => {
    for (const [lt, N0] of [
      [1e-3, 256],
      [1e-4, 64],
      [4e-3, 512],
    ]) {
      const keep = nearIntegerKeepOut(lt, N0)
      expect(nearIntegerAsymptote(keep, N0)).toBeCloseTo(lt, 15)
      expect(keep * N0).toBeLessThan(0.5) // 仍在「窗口內沒有 wrap」的適用範圍
    }
    expect(nearIntegerKeepOut(1e-3, 1024) / nearIntegerKeepOut(1e-3, 256)).toBeCloseTo(0.25, 4)
    // 數值掃描：α 比 keep-out 邊界小一半時最差窗口不到門檻，大一倍時超過門檻
    const keep = nearIntegerKeepOut(1e-3, 256)
    expect(windowLambdaMin(keep / 2, 256, 48).worst).toBeLessThan(1e-3)
    expect(windowLambdaMin(keep * 2, 256, 48).worst).toBeGreaterThan(1e-3)
  })

  it('α ≫ 1/N0：每個窗口都看到完整 sawtooth，λ_min 接近 1/12', () => {
    const w = windowLambdaMin(0.137, 256)
    expect(w.worst).toBeGreaterThan(0.07)
    expect(w.worst).toBeLessThan(0.0834)
  })
})

describe('R6｜Comparator 非理想', () => {
  const sig = 100
  it('2f_v(0)：Gaussian √(2/π)/σ、Laplace √2/σ、uniform 1/(√3σ)、Student-t₃ 4/(πσ)', () => {
    expect(Math.abs(comparatorSlope({ kind: 'gaussian', sigma: sig }, 0) - Math.sqrt(2 / Math.PI) / sig)).toBeLessThan(1e-15)
    expect(Math.abs(comparatorSlope({ kind: 'laplace', sigma: sig }, 0) - Math.SQRT2 / sig)).toBeLessThan(1e-15)
    expect(Math.abs(comparatorSlope({ kind: 'uniform', sigma: sig }, 0) - 1 / (Math.sqrt(3) * sig))).toBeLessThan(1e-15)
    expect(Math.abs(comparatorSlope({ kind: 'student3', sigma: sig }, 0) - 4 / (Math.PI * sig))).toBeLessThan(1e-13)
  })

  it('CDF 與 PDF 一致：數值微分 dF/dv = f（五種分布）', () => {
    const kinds: NoiseSpec[] = [
      { kind: 'gaussian', sigma: 1 },
      { kind: 'laplace', sigma: 1 },
      { kind: 'uniform', sigma: 1 },
      { kind: 'student3', sigma: 1 },
      { kind: 'dualDirac', sigma: 1, djFrac: 0.6 },
    ]
    for (const k of kinds) {
      for (const v of [-1.3, -0.4, 0.2, 0.9]) {
        const h = 1e-5
        const num = (noiseCdf(k, v + h) - noiseCdf(k, v - h)) / (2 * h)
        expect(Math.abs(num - noisePdf(k, v))).toBeLessThan(1e-6)
      }
      // 數值微分 E[q|s] = 斜率
      const h = 1e-5
      const d = (comparatorMean(k, 0.1 + h, 0.05) - comparatorMean(k, 0.1 - h, 0.05)) / (2 * h)
      expect(Math.abs(d - comparatorSlope(k, 0.1, 0.05))).toBeLessThan(1e-6)
    }
  })

  it('抽樣的變異數 ≈ σ²（五種分布、固定 seed）', () => {
    const rng = createRng(3)
    for (const kind of ['gaussian', 'laplace', 'uniform', 'dualDirac'] as const) {
      const spec: NoiseSpec = { kind, sigma: 2, djFrac: 0.5 }
      let s2 = 0
      const n = 200000
      for (let i = 0; i < n; i++) s2 += drawNoise(spec, rng) ** 2
      expect(Math.abs(s2 / n - 4) / 4).toBeLessThan(0.02)
    }
  })

  it('遲滯 H = 0 退化為一般 comparator；H > 0 時 s = 0 的斜率 = f(H/2)/c，ℐ 隨 H 下降（Gaussian）', () => {
    const g: NoiseSpec = { kind: 'gaussian', sigma: 1 }
    const h0 = hysteresisStats(g, 0.3, 0)
    expect(Math.abs(h0.nu)).toBeLessThan(1e-15)
    expect(Math.abs(h0.mean - comparatorMean(g, 0.3))).toBeLessThan(1e-14)
    expect(Math.abs(hysteresisStats(g, 0, 0).info - 2 / Math.PI)).toBeLessThan(1e-14)
    let prev = Infinity
    for (const H of [0, 0.25, 0.5, 1, 2, 4]) {
      const st = hysteresisStats(g, 0, H)
      const c = normSf(H / 2)
      expect(Math.abs(st.slope - normPdf(H / 2) / c)).toBeLessThan(1e-12)
      expect(st.info).toBeLessThan(prev + 1e-15)
      prev = st.info
    }
  })

  it('反面：uniform 雜訊且 H/2 > √3σ 時 chain 永不翻轉（ν = 1、ℐ = 0），不會回傳 NaN 的資訊量', () => {
    const st = hysteresisStats({ kind: 'uniform', sigma: 1 }, 0, 4)
    expect(st.tUp + st.tDown).toBe(0)
    expect(st.nu).toBe(1)
    expect(st.info).toBe(0)
  })

  it('Monte Carlo：E[q|s] 與 lag-1 相關吻合 Markov 解析（H = 1、Laplace）', () => {
    const spec: NoiseSpec = { kind: 'laplace', sigma: 1 }
    const s = [-0.5, 0, 0.4]
    const mc = mcComparator({ spec, theta: 0, H: 1, sValues: s, samples: 60000, seed: 5 })
    s.forEach((sv, i) => {
      const th = hysteresisStats(spec, sv, 1)
      const half = (mc.hi[i] - mc.lo[i]) / 2
      expect(Math.abs(mc.mean[i] - th.mean)).toBeLessThan(2 * half + 0.01)
      expect(Math.abs(mc.lag1[i] - th.nu)).toBeLessThan(0.03)
    })
  })
})

describe('R7｜多速率 lifting', () => {
  const base = { r: 0.8, b: 0.2, c: 1 }
  it('N = 1 時就是規格 §8.4：μ = 1.2 的極點 0.9 ± j0.4796、|z| = √1.04（發散）', () => {
    const A = liftedDualLoop({ ...base, mu: 1.2, N: 1 })
    expect(A).toEqual([
      [0.8, 0.2],
      [-1.2, 1],
    ])
    const { z, rho } = eig2(A)
    expect(Math.abs(z[0].re - 0.9)).toBeLessThan(1e-12)
    expect(Math.abs(Math.abs(z[0].im) - Math.sqrt(1.04 - 0.81))).toBeLessThan(1e-12)
    expect(Math.abs(rho - Math.sqrt(1.04))).toBeLessThan(1e-12)
  })

  it('lifted 矩陣的冪次 = 逐 sample 直接模擬（N = 1、7、16）', () => {
    for (const N of [1, 7, 16]) {
      const P = { ...base, mu: 0.9, N }
      const A = liftedDualLoop(P)
      const sim = simulateMultirate(P, 30, 0.3, 1)
      let x = [0.3, 1]
      for (let k = 1; k <= 30; k++) {
        x = [A[0][0] * x[0] + A[0][1] * x[1], A[1][0] * x[0] + A[1][1] * x[1]]
        expect(Math.abs(x[1] - sim.delta[k])).toBeLessThan(1e-10)
        expect(Math.abs(x[0] - sim.s[k])).toBeLessThan(1e-10)
      }
    }
  })

  it('穩定上限：N = 1 為 μ < 1（Jury），N → ∞ 趨近 quasi-static 的 2(1 − r)/(bc) = 2', () => {
    expect(Math.abs(dualLoopMuMax(base, 1) - 1)).toBeLessThan(1e-6)
    const big = dualLoopMuMax(base, 4096)
    expect(Math.abs(big - 2)).toBeLessThan(0.01)
    // 大 N 的慢 pole → quasi-static pole
    const A = liftedDualLoop({ ...base, mu: 1.2, N: 4096 })
    expect(Math.abs(A[1][1] - quasiStaticPole({ ...base, mu: 1.2, N: 1 }))).toBeLessThan(2e-3)
  })
})

describe('R8｜Tracking：最佳固定增益 = 穩態 Kalman 增益', () => {
  it('g* = P⁻/(P⁻ + σ_y²)、V(g*) = P⁻、g* < 1', () => {
    for (const [sz2, sy2] of [
      [1e-4, 1],
      [0.01, 0.3],
      [1, 1],
      [50, 0.1],
    ]) {
      const g = optimalTrackingGain(sz2, sy2)
      const k = kalmanSteady(sz2, sy2)
      expect(Math.abs(g - k.gain)).toBeLessThan(1e-12)
      expect(Math.abs(trackingVariance(g, sz2, sy2) - k.Pprior) / k.Pprior).toBeLessThan(1e-12)
      expect(g).toBeLessThan(1)
      // 是最小值：左右各偏一點都比較大
      expect(trackingVariance(g * 1.01, sz2, sy2)).toBeGreaterThan(k.Pprior)
      expect(trackingVariance(g * 0.99, sz2, sy2)).toBeGreaterThan(k.Pprior)
    }
  })

  it('小 σ_ζ 時 g* ≈ σ_ζ/σ_y（第 14 章 F-14.13 的近似）', () => {
    const g = optimalTrackingGain(1e-8, 1)
    expect(Math.abs(g / 1e-4 - 1)).toBeLessThan(1e-3)
  })

  it('Kalman 遞迴的增益收斂到穩態值', () => {
    const sz2 = 0.01
    const sy2 = 0.3
    let st = { w: 0, P: 10 }
    for (let k = 0; k < 500; k++) st = kalmanTrackStep(st.w, st.P, 0, sz2, sy2)
    const Pp = st.P + sz2
    expect(Math.abs(Pp / (Pp + sy2) - kalmanSteady(sz2, sy2).gain)).toBeLessThan(1e-12)
  })

  it('Monte Carlo（固定 seed）吻合 V(g*)', () => {
    const sz2 = 0.04
    const sy2 = 1
    const g = optimalTrackingGain(sz2, sy2)
    const mc = simulateTracking({ g, sz2, sy2, chains: 16, blocks: 8000, seed: 9 })
    const th = trackingVariance(g, sz2, sy2)
    const half = (mc.hi - mc.lo) / 2
    expect(Math.abs(mc.meanSq - th)).toBeLessThan(2 * half + 0.02 * th)
  })

  it('反面：g 很小時 burn-in 不足 5τ，標示 burnInAdequate = false', () => {
    const fast = simulateTracking({ g: 0.2, sz2: 0.04, sy2: 1, chains: 4, blocks: 500, seed: 3 })
    expect(fast.burnInAdequate).toBe(true)
    const slow = simulateTracking({ g: 5e-5, sz2: 1e-8, sy2: 4, chains: 4, blocks: 500, seed: 3 })
    expect(slow.burnIn).toBe(MC_BURN_CAP)
    expect(slow.burnInAdequate).toBe(false)
  })

  it('反面：g ≤ 0 或 g ≥ 2 沒有穩態（∞）', () => {
    expect(trackingVariance(0, 1, 1)).toBe(Infinity)
    expect(trackingVariance(2, 1, 1)).toBe(Infinity)
  })
})

describe('R9｜bit-true accumulator', () => {
  it('negative_tests：6-bit × 4096 需要 18 bits；17-bit wrap 把 126976 變成 −4096（符號翻轉）', () => {
    const v = golden('negative_tests')
    const e = v.expected as { gmac_bits_required: number; gmac_17bit_wrapped_sum: number }
    expect(accumulatorBits(6, 4096, false).bitsRequired).toBe(e.gmac_bits_required)
    expect(wrapTwos(31 * 4096, 17)).toBe(e.gmac_17bit_wrapped_sum)
    const w = worstCaseAccumulate(6, 4096, 17, false)
    expect(w.wrapped).toBe(e.gmac_17bit_wrapped_sum)
    expect(w.saturated).toBe(2 ** 16 - 1)
  })

  it('最負 code（−32）經 conditional negate 變 +32：需要 19 bits，否則 18-bit 也會 wrap', () => {
    expect(accumulatorBits(6, 4096, true).bitsRequired).toBe(19)
    const w = worstCaseAccumulate(6, 4096, 18, true)
    expect(w.trueSum).toBe(131072)
    expect(w.wrapped).toBe(-131072)
    expect(w.firstOverflowAt).toBe(4096)
  })

  it('最壞情況下放得下幾筆 n_safe = ⌊(2^{W−1} − 1)/max|qx|⌋：第一次溢位恰在第 n_safe + 1 筆（或整個 block 都不溢位）', () => {
    expect(worstCaseSafeCount(6, 17, false)).toBe(2114) // ⌊65535/31⌋
    expect(worstCaseAccumulate(6, 4096, 17, false).firstOverflowAt).toBe(2115)
    expect(worstCaseSafeCount(6, 18, true)).toBe(4095) // ⌊131071/32⌋：只差最後一筆
    expect(worstCaseSafeCount(6, 18, false)).toBe(4228)
    expect(worstCaseAccumulate(6, 4096, 18, false).firstOverflowAt).toBeNull()
    for (const codeBits of [2, 4, 6, 8])
      for (const accBits of [8, 12, 16, 20])
        for (const most of [false, true])
          for (const N of [1, 16, 1000, 4096]) {
            const safe = worstCaseSafeCount(codeBits, accBits, most)
            expect(worstCaseAccumulate(codeBits, N, accBits, most).firstOverflowAt, `${codeBits}/${accBits}/${most}/${N}`).toBe(safe < N ? safe + 1 : null)
          }
  })

  it('wrap 與 saturate 的定義', () => {
    expect(wrapTwos(2 ** 15, 16)).toBe(-(2 ** 15))
    expect(wrapTwos(-(2 ** 15) - 1, 16)).toBe(2 ** 15 - 1)
    expect(saturateTwos(1e9, 16)).toBe(2 ** 15 - 1)
    expect(saturateTwos(-1e9, 16)).toBe(-(2 ** 15))
  })
})

describe('R10｜由規格反推 (N, μ)', () => {
  const base = { sigmaV: 100, C: 1, fs: 4e9, sigmaWMax: 0.5, tMax: 200e-6, eps: 0.01, delta0: 20, pmMinDeg: 60, log2Nmin: 6, log2Nmax: 16 }

  it('T13: 同一個 σ_w² = g/(K²N(2 − g)) 在 N = 4096、μ = 10 fs 時重現 0.3992 fs', () => {
    const v = golden('T13')
    const e = v.expected as Record<string, number>
    const g = e.g
    const K = e.K_per_fs
    within(Math.sqrt(g / (K * K * 4096 * (2 - g))), e.sigma_w_fs, v.tolerance)
    within(inverseDesign(base).K, K, v.tolerance)
  })

  it('整數 B_max 的 σ_w ≥ 連續式（tanh 律）；連續式介於一次平均下界與多 block 極限之間', () => {
    const r = inverseDesign(base)
    for (const row of r.rows) {
      if (!row.feasible || row.gLo !== row.gTime) continue
      expect(row.sigmaWAtLo).toBeGreaterThanOrEqual(row.sigmaWContinuous * (1 - 1e-12))
      expect(row.sigmaWContinuous).toBeLessThanOrEqual(r.floorMany * (1 + 1e-12))
      expect(row.sigmaWContinuous).toBeGreaterThan(r.floorOneShot)
    }
    expect(r.best).not.toBeNull()
  })

  it('B_max 是整數的 block 數：f_s·T_max 的浮點捨入不會讓它少算一個 block（floorTol）', () => {
    // 4.096e9 × (200 × 1e-6) 在 double 裡是 819199.9999999999；除以 4096 應該是 200，不是 199
    const total = 4.096e9 * (200 * 1e-6)
    expect(total).toBeLessThan(819200)
    expect(Math.floor(total / 4096)).toBe(199)
    expect(floorTol(total / 4096)).toBe(200)
    const res = inverseDesign({ sigmaV: 100, C: 1, fs: 4.096e9, sigmaWMax: 0.5, tMax: 200 * 1e-6, eps: 0.01, delta0: 20, pmMinDeg: 60, log2Nmin: 12, log2Nmax: 12 })
    expect(res.rows[0].Bmax).toBe(200)
    // 整除時整數 B 與連續的 tanh 律是同一個數
    expect(res.rows[0].sigmaWAtLo).toBeCloseTo(res.rows[0].sigmaWContinuous, 12)
    // 反面：真的不到整數時不會被進位
    expect(floorTol(199.999)).toBe(199)
    expect(floorTol(0.9999999)).toBe(0)
    expect(floorTol(195.3125)).toBe(195)
    expect(floorTol(7)).toBe(7)
  })

  it('反面：σ_w,max 低於多 block 極限很多時，所有 N 都不可行並說明原因', () => {
    const r = inverseDesign({ ...base, sigmaWMax: 0.05 })
    expect(r.rows.every((row) => !row.feasible)).toBe(true)
    expect(r.rows.some((row) => row.reason.includes('時間下界'))).toBe(true)
    expect(r.best).toBeNull()
  })

  it('反面：δ0 很大時 slew 限制（sign-LMS 每 block 最多走 μ）成為瓶頸', () => {
    const r = inverseDesign({ ...base, delta0: 5000, log2Nmin: 14, log2Nmax: 16 })
    expect(r.rows.some((row) => row.reason.startsWith('slew'))).toBe(true)
  })
})

describe('SSPLL｜Re{H_PD} 與 raw-x GMAC 極性', () => {
  const t1: LoopSpec = { kind: 'type1', KL: 0.4, zeta: 0.7, wnTs: 0.1, d: 0 }
  const t2: LoopSpec = { kind: 'type2', KL: 0.4, zeta: 0.7, wnTs: 0.1, d: 0 }

  it('恆等式 Re H = (1 + Re L)/|1 + L|²（freqz 直接算 vs 由 L 算）', () => {
    for (const s of [t1, t2, { ...t2, d: 2 }, { ...t1, d: 3 }]) {
      const sc = polarityScan(s, 4e9, 600)
      expect(sc.identityMaxErr).toBeLessThan(1e-12)
    }
  })

  it('Type-I、d = 0：Re L ≡ −K_L/2，永不反號', () => {
    const sc = polarityScan(t1, 4e9, 800)
    expect(sc.bands).toHaveLength(0)
    expect(sc.minRe).toBeGreaterThan(0)
  })

  it('Type-I 加大延遲使 K_L(d + ½) > 1：低頻出現反號帶（與低頻漸近式一致）', () => {
    // 反號且穩定的窗口：1/(d + ½) < K_L < 2sin(π/(4d + 2))；d = 3 時為 (0.2857, 0.4450)
    const s: LoopSpec = { ...t1, KL: 0.4, d: 3 }
    expect(loopTransfer(s).stable).toBe(true)
    const sc = polarityScan(s, 4e9, 1200)
    expect(sc.bands.length).toBeGreaterThan(0)
    expect(sc.bands[0][0]).toBe(0)
    expect(Math.abs(sc.reH[0] / sc.asym[0] - 1)).toBeLessThan(1e-3)
  })

  it('Type-II、d = 0：反號帶從 DC 到封閉式邊界 (f_ref/π)·asin√(K_i/(2(2 − K_p)))', () => {
    const sc = polarityScan(t2, 4e9, 1600)
    expect(sc.bands).toHaveLength(1)
    expect(sc.bands[0][0]).toBe(0)
    expect(sc.closedFormEdge).not.toBeNull()
    expect(Math.abs(sc.bands[0][1] / (sc.closedFormEdge as number) - 1)).toBeLessThan(1e-8)
    expect(Math.abs(sc.reH[0] / sc.asym[0] - 1)).toBeLessThan(1e-3)
  })

  it('白色 code：C = h[0] = 1（頻域積分與 impulse response 兩種算法）', () => {
    for (const s of [t1, t2, { ...t2, d: 1 }]) {
      const H = loopTransfer(s).Hpd
      expect(Math.abs(cWhite(H) - 1)).toBeLessThan(1e-15)
      expect(Math.abs(cWhiteByIntegral(H) - 1)).toBeLessThan(1e-6)
    }
  })

  it('AR(1) code：C = H_PD(z⁻¹ = β) > 0（任何穩定的 Type-I / Type-II、任何 d）', () => {
    for (const s of [t1, t2, { ...t2, d: 1 }, { ...t2, d: 3, wnTs: 0.05 }, { ...t1, KL: 0.4, d: 3 }]) {
      const H = loopTransfer(s).Hpd
      for (const beta of [0.3, 0.9, 0.99]) {
        const cc = cAr1(H, beta)
        expect(cc).toBeGreaterThan(0)
        expect(Math.abs(cc - cAr1BySum(H, beta)) / cc).toBeLessThan(1e-8)
      }
    }
  })

  it('反面：Type-I 的 K_L 超過 2sin(π/(4d + 2)) 時主迴路本身不穩定（不可再談 LMS 極性）', () => {
    expect(loopTransfer({ ...t1, KL: 0.44, d: 3 }).stable).toBe(true)
    expect(loopTransfer({ ...t1, KL: 0.45, d: 3 }).stable).toBe(false)
    expect(loopTransfer({ ...t1, KL: 2.01, d: 0 }).stable).toBe(false)
  })

  it('反面：單頻 code 落在反號帶內 → C < 0（正 μ 會發散）', () => {
    const H = loopTransfer(t2).Hpd
    const sc = polarityScan(t2, 1, 800)
    const fMid = 0.5 * sc.bands[0][1]
    expect(cTone(H, 2 * Math.PI * fMid)).toBeLessThan(0)
    expect(cTone(H, 2 * Math.PI * 0.2)).toBeGreaterThan(0)
  })
})

/**
 * 使用者的設計點：f_ref = 4 GHz、閉迴路 −3 dB = 320 MHz、延遲 1 個 reference cycle。
 * 迴路參數與參考數字取自離線分析 docs/analysis/sspll-gos-phos-polarity.md（§0.4、§7、§8，Python golden）；
 * 這裡用本頁的 model.ts（共用 pll.ts 的 designDtLoop + 自己的掃描）獨立重算，當作兩份實作的交叉比對。
 * 這不是 T-id 驗收：SSPLL 項目的狀態仍是「分析中」。
 */
describe('SSPLL｜使用者的 L1 / L2 設計點：與離線分析的參考數字交叉比對', () => {
  const F_REF = 4e9
  const l1: LoopSpec = { kind: 'type1', KL: 0.38883636436862934, zeta: 0.7, wnTs: 0.1, d: 0 }
  const l2: LoopSpec = { kind: 'type2', KL: 0, ...zetaWnFromKpKi(0.2877169595860344, 0.03825347062779322), d: 0 }
  const H1 = loopTransfer(l1).Hpd
  const H2 = loopTransfer(l2).Hpd

  it('zetaWnFromKpKi 還原 designDtLoop 的 K_p、K_i', () => {
    const lt = loopTransfer(l2)
    expect(lt.Kp).toBeCloseTo(0.2877169595860344, 12)
    expect(lt.Ki).toBeCloseTo(0.03825347062779322, 12)
    expect(lt.stable).toBe(true)
  })

  it('L1：閉迴路 −3 dB = 320 MHz、PM 78.79°、沒有 peaking、沒有反號帶', () => {
    const cs = closedLoopSummary(loopTransfer(l1), F_REF)
    expect(Math.abs(cs.f3dB / 1e6 - 320)).toBeLessThan(0.01)
    expect(Math.abs(cs.pmDeg - 78.7893)).toBeLessThan(1e-3)
    expect(cs.peakDb).toBe(0)
    expect(polarityScan(l1, F_REF, 1200).bands).toHaveLength(0)
  })

  it('L2：閉迴路 −3 dB = 320 MHz、PM 60.00°、peaking 2.127 dB；反號帶 0–134.820 MHz、最低 −0.2053', () => {
    const cs = closedLoopSummary(loopTransfer(l2), F_REF)
    expect(Math.abs(cs.f3dB / 1e6 - 320)).toBeLessThan(0.01)
    expect(Math.abs(cs.pmDeg - 60)).toBeLessThan(1e-3)
    expect(Math.abs(cs.peakDb - 2.1275)).toBeLessThan(1e-3)
    const sc = polarityScan(l2, F_REF, 2400)
    expect(sc.bands).toHaveLength(1)
    expect(sc.bands[0][0]).toBe(0)
    expect(Math.abs(sc.bands[0][1] / 1e6 - 134.8201)).toBeLessThan(1e-3)
    expect(Math.abs(sc.minRe - -0.2052947)).toBeLessThan(1e-5)
    // 反號帶一定落在 |T| > 1 的 peaking 區內
    expect(cs.peakDb).toBeGreaterThan(0)
  })

  it('W₁ = 64·sin²(π/8)/π² = 0.94964；數值積分的 Fourier 係數 |c₁|² 相同', () => {
    expect(PMUX_W1).toBeCloseTo(0.9496412, 6)
    // c₁ = ∫₀¹ e^{−j2π⌊8φ⌋/8}·e^{+j2πφ} dφ（中點法）
    const M = 80000
    let re = 0
    let im = 0
    for (let i = 0; i < M; i++) {
      const phi = (i + 0.5) / M
      const th = 2 * Math.PI * phi - (2 * Math.PI * Math.floor(8 * phi)) / 8
      re += Math.cos(th) / M
      im += Math.sin(th) / M
    }
    expect(re * re + im * im).toBeCloseTo(PMUX_W1, 8)
  })

  it('PHOS mode-1：L2、α = 21/1000（PMUX 旋轉 84 MHz）κ₁ = −0.13953；譜線權重和 = 1', () => {
    const r = pmuxKappa(H2, 21, 1000)
    expect(r.circulant).toBe(true)
    expect(Math.abs(r.kappaPhos1 - -0.13953)).toBeLessThan(2e-5)
    // 基波：84 MHz、權重 ≈ W₁、Re H = −0.20529、貢獻 −0.19495；第二條在 588 MHz（ℓ = −7）
    expect(r.lines[0].fNorm).toBeCloseTo(0.021, 12)
    expect(Math.abs(r.lines[0].weight - 0.94964)).toBeLessThan(1e-5)
    expect(Math.abs(r.lines[0].reH - -0.20529)).toBeLessThan(1e-5)
    expect(Math.abs(r.lines[0].contribution - -0.19495)).toBeLessThan(1e-5)
    expect(r.lines[1].fNorm).toBeCloseTo(0.147, 12)
    expect(Math.abs(r.lines[1].contribution - 0.02127)).toBeLessThan(1e-5)
  })

  it('PHOS mode-1：j/4096 格點上 L2 最差 κ₁ = −0.1397（83.0 MHz）；L1 全部為正', () => {
    const g2 = hpdReGrid(H2, 4096)
    const g1 = hpdReGrid(H1, 4096)
    let worst = Infinity
    let at = 0
    let minL1 = Infinity
    for (let j = 1; j < 2048; j++) {
      if (j % 1024 === 0) continue // 8 ∤ Q_red：不是 circulant
      const k2 = pmuxKappa(H2, j, 4096, g2).kappaPhos1
      if (k2 < worst) {
        worst = k2
        at = j
      }
      minL1 = Math.min(minL1, pmuxKappa(H1, j, 4096, g1).kappaPhos1)
    }
    expect(Math.abs(worst - -0.13966)).toBeLessThan(2e-5)
    expect(Math.abs((at / 4096) * 4000 - 83.0)).toBeLessThan(0.05)
    expect(minL1).toBeGreaterThan(0)
  })

  it('mode-1「一定反號」帶：L2 的門檻 −0.06264（max Re H = 1.18123）、32.68–125.33 MHz；L1 沒有', () => {
    const s2 = pmuxSureBand(H2, F_REF)
    expect(Math.abs(s2.maxRe - 1.18123)).toBeLessThan(1e-5)
    expect(Math.abs(s2.threshold - -0.06264)).toBeLessThan(1e-5)
    expect(s2.band).not.toBeNull()
    expect(Math.abs((s2.band as [number, number])[0] / 1e6 - 32.68)).toBeLessThan(0.01)
    expect(Math.abs((s2.band as [number, number])[1] / 1e6 - 125.33)).toBeLessThan(0.01)
    expect(pmuxSureBand(H1, F_REF).band).toBeNull()
    // 帶內任取幾個 α：exact κ₁ 的確為負，而且不超過上界
    const g2 = hpdReGrid(H2, 4096)
    for (const j of [40, 60, 86, 110, 125]) {
      const r = pmuxKappa(H2, j, 4096, g2)
      expect(r.kappaPhos1).toBeLessThan(0)
      expect(r.kappaPhos1).toBeLessThanOrEqual(PMUX_W1 * g2[j] + (1 - PMUX_W1) * s2.maxRe + 1e-6)
    }
  })

  it('GOS：12C 在 D = 0 時為正；near-grid 的 dead zone 吻合漸近式（L2：12β²/K_i，L1：6β/K）', () => {
    // L1、α = 137/1000：12C = 0.91025；L2、α = 123/1000：12C ≈ 0.080
    expect(Math.abs(pmuxKappa(H1, 137, 1000).twelveCGos - 0.9102502)).toBeLessThan(1e-6)
    expect(Math.abs(pmuxKappa(H2, 123, 1000).twelveCGos - 0.0803)).toBeLessThan(5e-4)
    // β = 1/1000（α = (1 + β)/8 = 1001/8000）
    const near2 = pmuxKappa(H2, 1001, 8000).twelveCGos
    expect(Math.abs(near2 - 3.137e-4)).toBeLessThan(1e-7)
    expect(Math.abs(near2 / ((12 * 1e-6) / 0.03825347062779322) - 1)).toBeLessThan(1e-3)
    const near1 = pmuxKappa(H1, 1001, 8000).twelveCGos
    expect(Math.abs(near1 / ((6 * 1e-3) / 0.38883636436862934) - 1)).toBeLessThan(0.01)
    // j/4096 格點上兩個迴路都沒有負值（研究假說的數值證據，不是證明）
    for (const H of [H1, H2]) {
      const g = hpdReGrid(H, 4096)
      for (let j = 1; j < 2048; j += 7) expect(pmuxKappa(H, j, 4096, g).twelveCGos).toBeGreaterThanOrEqual(0)
    }
  })

  it('反面：α = 1/4（8 ∤ Q）不是 circulant；α = k/8 時 ρ[n] 為常數，GOS 沒有激發（12C = 0）', () => {
    const r = pmuxKappa(H2, 1024, 4096)
    expect(r.Qred).toBe(4)
    expect(r.circulant).toBe(false)
    const grid = pmuxKappa(H2, 512, 4096) // α = 1/8
    expect(grid.twelveCGos).toBe(0)
  })

  it('一階差分 regressor：L1 / L2 的 kernel 處處非負；封閉式條件 K_i ≤ 2K_p、K_p + K_i/2 ≤ 2 與數值掃描一致', () => {
    expect(firstDiffKernelMin(H1).minRe).toBeGreaterThanOrEqual(0)
    expect(firstDiffKernelMin(H2).minRe).toBeGreaterThanOrEqual(-1e-12)
    expect(firstDiffMarginTypeII(0.2877169595860344, 0.03825347062779322).nonInverting).toBe(true)
    // 掃描穩定的 (K_p, K_i)：封閉式判定與 kernel 最小值的符號一致
    for (const [Kp, Ki] of [
      [0.3, 0.04],
      [0.05, 0.02],
      [0.01, 0.03],
      [0.02, 0.05],
      [1.2, 0.1],
    ]) {
      const s: LoopSpec = { kind: 'type2', KL: 0, ...zetaWnFromKpKi(Kp, Ki), d: 0 }
      const lt = loopTransfer(s)
      if (!lt.stable) continue
      const numeric = firstDiffKernelMin(lt.Hpd, 8192).minRe >= -1e-9
      expect(numeric).toBe(firstDiffMarginTypeII(Kp, Ki).nonInverting)
    }
  })

  it('反面：Type-I 加大延遲（K_L = 0.4、d = 3）時一階差分也救不回來（kernel 有負值）', () => {
    const s: LoopSpec = { kind: 'type1', KL: 0.4, zeta: 0.7, wnTs: 0.1, d: 3 }
    expect(loopTransfer(s).stable).toBe(true)
    expect(firstDiffKernelMin(loopTransfer(s).Hpd).minRe).toBeLessThan(-0.1)
  })
})
