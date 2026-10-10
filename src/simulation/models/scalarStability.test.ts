import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng } from '@/simulation/core'
import { classifyPole, fixedXPole, gaussianAlmostSureMuMax, gaussianLyapunov, meanSquareFactor } from './lms'
import {
  absPowerFactor,
  analyticCrossCheck,
  analyticTrajectory,
  blockMeanSquareBound,
  boundCurves,
  cltConvergedFraction,
  cltLog10Quantile,
  drawX,
  fastestAlmostSure,
  fourthPowerFactor,
  gaussianLyapunovDawson,
  hillEstimator,
  KESTEN_S_MAX,
  kestenTailExponent,
  logFactorVariance,
  lyapunovExponent,
  naiveCiCoverage,
  oneStepMc,
  pathStep,
  recordIndices,
  runStabilityMc,
  runStabilityMcCases,
  stabilityBounds,
  stabilityFactors,
  uniformLyapunov,
  uniformLyapunovQuad,
  validateDist,
  xMoments,
  type XDist,
} from './scalarStability'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}
const golden = (id: string): Vector => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))
const within = (actual: number, expected: number, tol: { abs?: number; rel?: number }) =>
  Math.abs(actual - expected) <= (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)

const GAUSS: XDist = { kind: 'gaussian', sigma: 1 }
const UNIT_UNIFORM: XDist = { kind: 'uniform', halfWidth: Math.sqrt(3) }
const BPSK: XDist = { kind: 'pm_one', amplitude: 1 }
const SPARSE: XDist = { kind: 'list', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] }

describe('scalarStability：固定 x（規格 §3）', () => {
  it('T02: 固定 x=2 的 pole、收斂判定與一步到位 μ 與 golden vector 一致', () => {
    const v = golden('T02')
    const x = v.inputs.x as number
    const mus = v.inputs.mu_list as number[]
    const poles = v.expected.pole_list as number[]
    const conv = v.expected.converges_list as number[]
    mus.forEach((mu, i) => {
      const f = stabilityFactors(mu, { kind: 'fixed', value: x })
      expect(within(f.meanPole, poles[i], v.tolerance)).toBe(true)
      expect(within(fixedXPole(mu, x), poles[i], v.tolerance)).toBe(true)
      // 固定 x：mean pole、g = p² 與 e^λ = |p| 三者對同一個 |p| 判定（Jensen 取等號）
      expect(f.g).toBeCloseTo(poles[i] * poles[i], 12)
      expect(f.geoMean).toBeCloseTo(Math.abs(poles[i]), 12)
      expect(Math.abs(f.meanPole) < 1 ? 1 : 0).toBe(conv[i])
    })
    const b = stabilityBounds({ kind: 'fixed', value: x })
    expect(within(b.meanMax, v.expected.mu_max as number, v.tolerance)).toBe(true)
    expect(b.msMax).toBeCloseTo(0.5, 14)
    expect(b.asMax).toBeCloseTo(0.5, 14)
    expect(b.asClosedForm).toBe(true)
    expect(within(b.msOpt, v.expected.mu_one_step as number, v.tolerance)).toBe(true)
    expect(b.msOptFactor).toBeCloseTo(0, 14) // μ = 1/x² 時 p = 0：一步到位
    expect(classifyPole(fixedXPole(v.expected.mu_one_step as number, x))).toBe('deadbeat')
  })

  it('T02: 固定 x 的 Monte Carlo（log 域）與封閉式 δ_n = p^n δ_0 逐點一致；μ=0.6 發散、μ=−0.01 也發散', () => {
    for (const mu of [0.1, 0.4, 0.6, -0.01]) {
      const r = runStabilityMc({ mu, dist: { kind: 'fixed', value: 2 }, delta0: 2, steps: 60, paths: 3, seed: 1, noiseSigma: 0 })
      const p = fixedXPole(mu, 2)
      r.n.forEach((n, i) => {
        const expected = Math.log10(2) + n * Math.log10(Math.abs(p))
        expect(r.q50[i]).toBeCloseTo(expected, 4) // Float32 記錄 → 約 1e−5
        expect(r.q10[i]).toBeCloseTo(r.q90[i], 6) // 所有路徑相同
      })
      if (Math.abs(p) >= 1) expect(r.q50.at(-1)!).toBeGreaterThan(Math.log10(2))
      else expect(r.q50.at(-1)!).toBeLessThan(-5)
      expect(r.lyapunovHat).toBeCloseTo(Math.log(Math.abs(p)), 12)
    }
  })

  it('有雜訊、固定 x：穩態 var(w) = μσ_v²/(2 − μx²)（勘誤 E42 的數值，0.0625），E[e²] = x²·MSD + σ_v²', () => {
    const p = { mu: 0.1, dist: { kind: 'fixed', value: 2 } as XDist, delta0: 0, noiseSigma: 1 }
    const tr = analyticTrajectory(p, [0, 1, 1000])
    expect(tr.msdInf).toBeCloseTo(0.0625, 14)
    expect(tr.mseInf).toBeCloseTo(4 * 0.0625 + 1, 14)
    // MC：δ 為線性 Gaussian 過程，δ² 的變異數有限 → 樣本平均的 CI 可信
    const root = createRng(5)
    const P = 4000
    let s = 0
    let s2 = 0
    for (let i = 0; i < P; i++) {
      const xr = root.fork(`x:${i}`)
      const vr = root.fork(`v:${i}`)
      let d = 0
      for (let n = 0; n < 60; n++) d = pathStep(d, p.mu, p.dist, xr, vr, p.noiseSigma)
      s += d * d
      s2 += d ** 4
    }
    const m = s / P
    const se = Math.sqrt((s2 / P - m * m) / P)
    expect(Math.abs(m - 0.0625)).toBeLessThan(4 * se)
  })
})

describe('scalarStability：隨機 iid x（規格 §3.1，勘誤 E14 / E38 / E42）', () => {
  it('T03: Gaussian mean 上限 2、mean-square 上限 2/3；ms/mean factor 與 golden vector 一致（含 bpsk、uniform）', () => {
    const v = golden('T03')
    const mus = v.inputs.mu_list as number[]
    const m = xMoments(GAUSS)
    expect(m.Px).toBe(v.inputs.Ex2)
    expect(m.M4).toBe(v.inputs.Ex4)
    expect(m.kurtosis).toBe(3)
    mus.forEach((mu, i) => {
      const f = stabilityFactors(mu, GAUSS)
      expect(within(f.g, (v.expected.ms_factor_list as number[])[i], v.tolerance)).toBe(true)
      expect(within(f.meanPole, (v.expected.mean_factor_list as number[])[i], v.tolerance)).toBe(true)
    })
    const b = stabilityBounds(GAUSS)
    expect(within(b.meanMax, v.expected.mu_mean_max as number, v.tolerance)).toBe(true)
    expect(within(b.msMax, v.expected.mu_ms_max as number, v.tolerance)).toBe(true)
    expect(within(stabilityBounds(BPSK).msMax, v.expected.mu_ms_max_bpsk as number, v.tolerance)).toBe(true)
    expect(within(stabilityBounds(UNIT_UNIFORM).msMax, v.expected.mu_ms_max_uniform as number, v.tolerance)).toBe(true)
    // MS 界 = mean 界 / kurtosis
    for (const d of [GAUSS, BPSK, UNIT_UNIFORM, SPARSE]) {
      const bb = stabilityBounds(d)
      expect(bb.msMax).toBeCloseTo(bb.meanMax / xMoments(d).kurtosis, 12)
    }
  })

  it('T03: 單步 Monte Carlo 估計 E[(1−μx²)²] 與 E[1−μx²]（變異數有限，±4 SE 內；勘誤 E14 建議的驗證法）', () => {
    for (const mu of [0.3, 2 / 3, 1]) {
      const r = oneStepMc({ mu, dist: GAUSS, samples: 400000, seed: 20261010 })
      expect(Math.abs(r.g - meanSquareFactor(mu, 1, 3))).toBeLessThan(4 * r.gSe)
      expect(Math.abs(r.meanFactor - (1 - mu))).toBeLessThan(4 * r.meanFactorSe)
      expect(Math.abs(r.lambda - gaussianLyapunovDawson(mu))).toBeLessThan(4 * r.lambdaSe)
    }
    const b = oneStepMc({ mu: 2 / 3, dist: GAUSS, samples: 400000, seed: 7 })
    expect(Math.abs(b.g - 1)).toBeLessThan(4 * b.gSe) // g(2/3) = 1：mean-square 邊界
  })

  it('T03: iid 純量 x 的 mean / mean-square 遞迴是精確式（E38）：μ=0.5、n=5 的 E[δ_5]、E[δ_5²]', () => {
    // E[δ_5] = 0.5^5、E[δ_5²] = 0.75^5；使用真實標準誤（由 h(μ) = E[(1−μx²)⁴] 封閉式算出）判定
    const r = naiveCiCoverage({ mu: 0.5, dist: GAUSS, delta0: 1, n: 5, pathsPerBatch: 200000, batches: 1, seed: 20261010 })
    expect(r.exact).toBeCloseTo(0.75 ** 5, 14)
    expect(Math.abs(r.pooledMean - r.exact)).toBeLessThan(4 * r.trueSe)
    const rng = createRng(11)
    const P = 200000
    let s = 0
    let s2 = 0
    for (let i = 0; i < P; i++) {
      let d = 1
      for (let k = 0; k < 5; k++) {
        const x = drawX(GAUSS, rng)
        d *= 1 - 0.5 * x * x
      }
      s += d
      s2 += d * d
    }
    const m = s / P
    expect(Math.abs(m - 0.5 ** 5)).toBeLessThan(4 * Math.sqrt((s2 / P - m * m) / P))
  })

  it('T03: almost-sure 界 μ_as = 2.421249521（scipy，勘誤 E14）；Dawson 形式與 lms.ts 直接積分一致', () => {
    const b = stabilityBounds(GAUSS)
    expect(b.asMax).toBeCloseTo(2.421249521, 8)
    expect(gaussianLyapunovDawson(2 / 3)).toBeCloseTo(-0.48644, 5)
    expect(gaussianLyapunovDawson(1)).toBeCloseTo(-0.416992, 6)
    expect(gaussianLyapunovDawson(2)).toBeCloseTo(-0.116247, 6)
    expect(gaussianLyapunovDawson(2.5)).toBeCloseTo(0.020625, 6)
    for (const mu of [0.01, 0.0199, 0.0201, 0.1, 0.5, 1.5, 3, 8]) {
      expect(Math.abs(gaussianLyapunovDawson(mu) - gaussianLyapunov(mu))).toBeLessThan(1e-5)
    }
    expect(Math.abs(b.asMax - gaussianAlmostSureMuMax())).toBeLessThan(1e-4)
    // σ 縮放：λ(μ; σ) = λ(μσ²; 1)
    expect(gaussianLyapunovDawson(0.5, 2)).toBeCloseTo(gaussianLyapunovDawson(2, 1), 12)
    expect(stabilityBounds({ kind: 'gaussian', sigma: 2 }).asMax).toBeCloseTo(b.asMax / 4, 10)
    // 收斂最快的 μ（typical path）約 0.5855
    expect(fastestAlmostSure(GAUSS).mu).toBeCloseTo(0.5855, 3)
  })

  it('T03: 2/3 < μ < 2.42 時 E[δ²] 發散但幾乎每條路徑收斂（勘誤 E14：μ=0.8 與 μ=2）', () => {
    const r = runStabilityMc({ mu: 0.8, dist: GAUSS, delta0: 1, steps: 200, paths: 2000, seed: 1, noiseSigma: 0 })
    const tr = analyticTrajectory({ mu: 0.8, dist: GAUSS, delta0: 1, noiseSigma: 0 }, [200])
    expect(tr.log10Rms[0]).toBeGreaterThan(12) // √E[δ²] ≈ 1.32^100 ≈ 10^12
    expect(r.fracConverged.at(-1)).toBeGreaterThan(0.99)
    expect(r.q90.at(-1)!).toBeLessThan(-20)
    // 樣本路徑斜率 = λ（大數法則），±4 SE
    expect(Math.abs(r.lyapunovHat - gaussianLyapunovDawson(0.8))).toBeLessThan(4 * r.lyapunovSe)
    // μ = 2：mean pole = −1（邊界），仍約 83% 路徑 |δ| < 1e−3（E14 Python：83.25%）
    const r2 = runStabilityMc({ mu: 2, dist: GAUSS, delta0: 1, steps: 200, paths: 10000, seed: 2, noiseSigma: 0 })
    expect(r2.fracConverged.at(-1)).toBeGreaterThan(0.8)
    expect(r2.fracConverged.at(-1)).toBeLessThan(0.86)
    // μ = 2.6 > μ_as：λ > 0，典型路徑發散
    const r3 = runStabilityMc({ mu: 2.6, dist: GAUSS, delta0: 1, steps: 400, paths: 2000, seed: 3, noiseSigma: 0 })
    expect(gaussianLyapunovDawson(2.6)).toBeGreaterThan(0)
    expect(r3.lyapunovHat).toBeGreaterThan(0)
    expect(r3.q50.at(-1)!).toBeGreaterThan(0)
  })

  it('T03: （反面測試）heavy tail 讓 δ_n² 的天真樣本平均 + 樣本 SE 的 95% CI 嚴重失效（μ=0.8、n=5）', () => {
    const r = naiveCiCoverage({ mu: 0.8, dist: GAUSS, delta0: 1, n: 5, pathsPerBatch: 4000, batches: 120, seed: 20261010 })
    expect(r.exact).toBeCloseTo(1.32 ** 5, 12) // 4.0075
    expect(r.coverage).toBeLessThan(0.85) // 宣稱 95%，實際遠低於
    expect(r.medianSeRatio).toBeGreaterThan(2) // 樣本 SE 低估真實 SE
    // 單步 MC 的 ĝ^n 則可信
    expect(Math.abs(r.oneStepEstimate - r.exact)).toBeLessThan(4 * r.oneStepEstimateSe)
    // 對照：|x| 為常數（±1）時 δ_n² 是確定值，CI 不會失效
    const c = naiveCiCoverage({ mu: 0.8, dist: BPSK, delta0: 1, n: 5, pathsPerBatch: 200, batches: 20, seed: 1 })
    expect(c.coverage).toBe(1)
    expect(c.trueSe).toBeCloseTo(0, 12)
  })

  it('有雜訊、Gaussian x：穩態 MSD = μP_xσ_v²/(2P_x − μM_4)，E[e²] = P_x·MSD + σ_v²（E42）', () => {
    const p = { mu: 0.3, dist: GAUSS, delta0: 0, noiseSigma: 0.1 }
    const tr = analyticTrajectory(p, [0])
    const msd = (0.3 * 0.01) / (2 - 0.9)
    expect(tr.msdInf).toBeCloseTo(msd, 14)
    expect(tr.mseInf).toBeCloseTo(msd + 0.01, 14)
    expect(fourthPowerFactor(0.3, xMoments(GAUSS))).toBeLessThan(1) // 穩態 δ⁴ 有限 → 樣本平均 CI 可用
    const root = createRng(9)
    const P = 4000
    let s = 0
    let s2 = 0
    for (let i = 0; i < P; i++) {
      const xr = root.fork(`x:${i}`)
      const vr = root.fork(`v:${i}`)
      let d = 0
      for (let n = 0; n < 80; n++) d = pathStep(d, p.mu, p.dist, xr, vr, p.noiseSigma)
      s += d * d
      s2 += d ** 4
    }
    const m = s / P
    expect(Math.abs(m - msd)).toBeLessThan(4 * Math.sqrt((s2 / P - m * m) / P))
    // g ≥ 1 時穩態 MSD 為無限大（但樣本路徑仍有穩態分布：Kesten heavy tail）
    expect(analyticTrajectory({ ...p, mu: 0.8 }, [0]).msdInf).toBe(Infinity)
  })
})

describe('scalarStability：其他分布、界限排序與 PLL 連結', () => {
  it('Uniform λ 封閉式：與單步 MC 一致、級數分支連續、a.s. 界約 2.0905（unit power）', () => {
    for (const mu of [0.2, 1, 2, 3]) {
      const r = oneStepMc({ mu, dist: UNIT_UNIFORM, samples: 300000, seed: 3 })
      expect(Math.abs(r.lambda - uniformLyapunov(mu, Math.sqrt(3)))).toBeLessThan(4 * r.lambdaSe)
    }
    const uSmall = 0.01 - 1e-12
    const uBig = 0.01 + 1e-12
    expect(uniformLyapunov(uSmall * uSmall, 1)).toBeCloseTo(uniformLyapunov(uBig * uBig, 1), 12)
    expect(uniformLyapunov(1, 1)).toBeCloseTo(2 * Math.log(2) - 2, 14) // u = 1 的極限
    const b = stabilityBounds(UNIT_UNIFORM)
    expect(b.asMax).toBeGreaterThan(2.08)
    expect(b.asMax).toBeLessThan(2.1)
    expect(lyapunovExponent(b.asMax, UNIT_UNIFORM)).toBeCloseTo(0, 10)
  })

  it('界限排序：MS ⇒ mean 且 MS ⇒ a.s.（Jensen）；mean 與 a.s. 沒有一般順序', () => {
    for (const d of [GAUSS, UNIT_UNIFORM, BPSK, SPARSE, { kind: 'list', values: [0.3, -1, 2.5] } as XDist]) {
      const b = stabilityBounds(d)
      expect(b.msMax).toBeLessThanOrEqual(b.meanMax * (1 + 1e-12))
      expect(b.msMax).toBeLessThanOrEqual(b.asMax * (1 + 1e-9))
      for (const mu of [0.05, 0.3, 0.9, 1.7]) {
        const f = stabilityFactors(mu, d)
        expect(f.lambda).toBeLessThanOrEqual(0.5 * Math.log(f.g) + 1e-12) // λ ≤ ½ ln g
        expect(f.g).toBeGreaterThanOrEqual(f.meanPole * f.meanPole - 1e-12) // g ≥ (1−μP)²
      }
    }
    expect(stabilityBounds(GAUSS).asMax).toBeGreaterThan(stabilityBounds(GAUSS).meanMax) // Gaussian：a.s. > mean
    const sp = stabilityBounds(SPARSE)
    expect(sp.asMax).toBeCloseTo(2 / 9, 10) // 稀疏 code：a.s. = MS = 2/9
    expect(sp.msMax).toBeCloseTo(2 / 9, 12)
    expect(sp.meanMax).toBeCloseTo(20 / 9, 12) // mean 界大 10 倍
  })

  it('反面測試：稀疏 code（9 個 0 + 一個 3）μ=0.5 時 mean 收斂、但幾乎每條路徑發散', () => {
    const f = stabilityFactors(0.5, SPARSE)
    expect(Math.abs(f.meanPole)).toBeLessThan(1)
    expect(f.lambda).toBeGreaterThan(0)
    const r = runStabilityMc({ mu: 0.5, dist: SPARSE, delta0: 1, steps: 300, paths: 2000, seed: 4, noiseSigma: 0 })
    expect(r.q50.at(-1)!).toBeGreaterThan(5)
    expect(r.fracConverged.at(-1)).toBe(0)
  })

  it('清單分布的 almost-sure 穩定集合可以不是一個區間（研究：x ∈ {1, 10}）', () => {
    const b = stabilityBounds({ kind: 'list', values: [1, 10] })
    expect(b.asCrossings.length).toBe(3)
    expect(b.asMax).toBeCloseTo(0.0202, 3)
    expect(lyapunovExponent(1, { kind: 'list', values: [1, 10] })).toBe(-Infinity)
    expect(lyapunovExponent(0.5, { kind: 'list', values: [1, 10] })).toBeGreaterThan(0)
  })

  it('PLL 連結：block 平均 N 筆 x² 後 MS 界 → mean 界（N=1 為 2/3，N=4096 約 1.999）', () => {
    const m = xMoments(GAUSS)
    expect(blockMeanSquareBound(m, 1)).toBeCloseTo(2 / 3, 14)
    expect(blockMeanSquareBound(m, 4096)).toBeCloseTo(2 / (1 + 2 / 4096), 14)
    expect(blockMeanSquareBound(xMoments(BPSK), 7)).toBeCloseTo(2, 14) // |x| 常數：與 N 無關
    // block 界由「block 因子 1 − μS_k」的 MSD 因子 g_N = 1 − 2μP_x + μ²E[S_k²] 定義：在界上 g_N = 1（以 MC 的 S_k 樣本驗證 E[S_k²]）
    const N = 8
    const rng = createRng(123)
    const M = 200000
    let s2 = 0
    let s4 = 0
    for (let i = 0; i < M; i++) {
      let acc = 0
      for (let k = 0; k < N; k++) {
        const x = drawX(GAUSS, rng)
        acc += x * x
      }
      const S = acc / N
      s2 += S * S
      s4 += S ** 4
    }
    const ES2 = s2 / M
    const se = Math.sqrt((s4 / M - ES2 * ES2) / M)
    expect(Math.abs(ES2 - (1 + 2 / N))).toBeLessThan(4 * se) // E[S²] = P_x² + (M_4 − P_x²)/N
    const muB = blockMeanSquareBound(m, N)
    expect(1 - 2 * muB * m.Px + muB * muB * (m.Px * m.Px + (m.M4 - m.Px * m.Px) / N)).toBeCloseTo(1, 12)
  })

  it('（反面測試）GMAC 用 sum 而不是 average 卻沿用 average 的 μ：等效步長放大 N 倍，mean pole 跑出單位圓', () => {
    const m = xMoments(GAUSS)
    const N = 4096
    const muAvg = 0.5 * blockMeanSquareBound(m, N) // average mode 下很安全的步長（界的一半）
    expect(Math.abs(1 - muAvg * m.Px)).toBeLessThan(1) // average：mean pole ≈ 0
    const poleSum = 1 - muAvg * N * m.Px // sum mode：因子 1 − μ·N·S_k
    expect(Math.abs(poleSum)).toBeGreaterThan(1000) // 發散
    // 正確做法：sum mode 的界 = average 的界 / N
    const muSumMax = blockMeanSquareBound(m, N) / N
    expect(muSumMax).toBeCloseTo(2 / (N + 2), 12)
    expect(Math.abs(1 - 0.5 * muSumMax * N * m.Px)).toBeLessThan(1)
  })

  it('反面測試：P_x = 0（x 恆為 0）不可辨識；非法參數會丟出中文錯誤', () => {
    expect(stabilityBounds({ kind: 'fixed', value: 0 }).degenerate).toBe(true)
    expect(stabilityBounds({ kind: 'list', values: [0, 0] }).degenerate).toBe(true)
    expect(validateDist({ kind: 'list', values: [] })).toMatch(/至少/)
    expect(validateDist({ kind: 'gaussian', sigma: -1 })).toMatch(/σ/)
    expect(() => runStabilityMc({ mu: 0.5, dist: GAUSS, delta0: 1, steps: 20000, paths: 50000, seed: 1, noiseSigma: 0 })).toThrow(/上限/)
    expect(() => runStabilityMc({ mu: 0.5, dist: { kind: 'list', values: [] }, delta0: 1, steps: 10, paths: 10, seed: 1, noiseSigma: 0 })).toThrow(/分布/)
    expect(() => naiveCiCoverage({ mu: 0.5, dist: GAUSS, delta0: 1, n: 0, pathsPerBatch: 10, batches: 1, seed: 1 })).toThrow(/n/)
  })

  it('負 μ（極性反轉）：每個判據都發散', () => {
    for (const d of [GAUSS, UNIT_UNIFORM, BPSK]) {
      const f = stabilityFactors(-0.05, d)
      expect(f.meanPole).toBeGreaterThan(1)
      expect(f.g).toBeGreaterThan(1)
      expect(f.lambda).toBeGreaterThan(0)
    }
  })

  it('決定性：同 seed 結果相同；增加路徑數不改變前幾條路徑；解析軌跡在 log 域不 overflow', () => {
    const base = { mu: 0.9, dist: GAUSS, delta0: 1, steps: 50, seed: 42, noiseSigma: 0.05 }
    const a = runStabilityMc({ ...base, paths: 20 })
    const b = runStabilityMc({ ...base, paths: 20 })
    const c = runStabilityMc({ ...base, paths: 40 })
    expect(Array.from(a.q50)).toEqual(Array.from(b.q50))
    expect(Array.from(a.sample)).toEqual(Array.from(c.sample))
    const cases = runStabilityMcCases({ cases: [{ ...base, paths: 20 }, { ...base, paths: 20, mu: 0.1 }] })
    expect(Array.from(cases.results[0].q50)).toEqual(Array.from(a.q50))
    const tr = analyticTrajectory({ mu: 3, dist: GAUSS, delta0: 1, noiseSigma: 1 }, [0, 10, 5000])
    expect(Number.isFinite(tr.log10Rms[2])).toBe(true)
    expect(tr.log10Rms[2]).toBeGreaterThan(1000)
    expect(recordIndices(10).length).toBe(11)
    const ri = recordIndices(10000, 101)
    expect(ri[0]).toBe(0)
    expect(ri.at(-1)).toBe(10000)
  })

  it('研究：Kesten 尾指數 κ_t（E|1−μx²|^κ = 1）在 μ=2/3 恰為 2；有雜訊時 MC 的 Hill 估計與理論一致', () => {
    expect(kestenTailExponent(2 / 3, GAUSS)).toBeCloseTo(2, 6) // m(2) = g(2/3) = 1
    expect(kestenTailExponent(0.3, GAUSS)).toBeGreaterThan(2) // g < 1 ⇒ 穩態變異數有限
    const k08 = kestenTailExponent(0.8, GAUSS)
    expect(k08).toBeGreaterThan(1)
    expect(k08).toBeLessThan(2) // g > 1 ⇒ 穩態變異數無限大（但分布存在）
    expect(kestenTailExponent(2.6, GAUSS)).toBe(0) // λ > 0：沒有穩態
    expect(kestenTailExponent(0.5, BPSK)).toBe(Infinity) // |1−μx²| < 1 恆成立：沒有 heavy tail
    expect(kestenTailExponent(0.5, UNIT_UNIFORM)).toBe(Infinity)
    // Gaussian 的 x 無上界，κ_t 永遠有限：μ = 0.05 時根仍在搜尋範圍內；μ = 0.01 時 κ_t > KESTEN_S_MAX，回傳 Infinity（文件已說明）
    const k005 = kestenTailExponent(0.05, GAUSS)
    expect(k005).toBeGreaterThan(20)
    expect(k005).toBeLessThan(KESTEN_S_MAX)
    expect(absPowerFactor(0.05, GAUSS, k005)).toBeCloseTo(1, 6)
    expect(absPowerFactor(0.01, GAUSS, KESTEN_S_MAX)).toBeLessThan(1)
    expect(kestenTailExponent(0.01, GAUSS)).toBe(Infinity)
    const r = runStabilityMc({ mu: 0.8, dist: GAUSS, delta0: 0, steps: 300, paths: 20000, seed: 1, noiseSigma: 0.1, oneStepSamples: 1000 })
    const hill = hillEstimator(r.finalLog10, 400)
    expect(Math.abs(hill - k08) / k08).toBeLessThan(0.15)
  })

  it('boundCurves：三條每步因子在各自的界限處等於 1', () => {
    const b = stabilityBounds(GAUSS)
    const cv = boundCurves(GAUSS, [b.meanMax, b.msMax, b.asMax])
    expect(cv.meanAbs[0]).toBeCloseTo(1, 12)
    expect(cv.g[1]).toBeCloseTo(1, 12)
    expect(cv.geo[2]).toBeCloseTo(1, 8)
  })
})

describe('scalarStability：分位帶與收斂比例的 CLT 預測（F-03.18，勘誤 E14）', () => {
  // scipy.integrate.quad 的參考值（analysis 用 Python 獨立計算）：s² = Var(ln|1 − μx²|)
  const GAUSS_VAR: [number, number][] = [
    [0.05, 0.007629124],
    [0.3, 0.463110331],
    [0.5, 0.667190677],
    [0.8, 0.862100059],
    [1, 0.976111984],
    [1.5, 1.2339006],
    [2, 1.454563927],
    [2.3, 1.570798448],
    [2.6, 1.676492197],
    [5, 2.267911881],
  ]
  const UNIFORM_VAR: [number, number][] = [
    [0.2, 0.06357901674175129],
    [1 / 3, 0.7101318663035887],
    [1, 0.9090956811713412],
    [2, 1.2906386738815052],
    [3, 1.5932199046834499],
  ]

  it('T03: s² = Var(ln|1−μx²|) 的數值積分與 scipy 參考值一致（含對數奇點），並與單步 MC 的樣本變異數一致', () => {
    for (const [mu, ref] of GAUSS_VAR) expect(Math.abs(logFactorVariance(mu, GAUSS) - ref), `gauss μ=${mu}`).toBeLessThan(2e-9)
    for (const [mu, ref] of UNIFORM_VAR) expect(Math.abs(logFactorVariance(mu, UNIT_UNIFORM) - ref), `uniform μ=${mu}`).toBeLessThan(1e-10)
    // 小 μ 展開：Y ≈ −c t² − c²t⁴/2 ⇒ s² ≈ 2c² + 12c³
    expect(logFactorVariance(0.001, GAUSS)).toBeCloseTo(2e-6 + 12e-9, 9)
    // σ 縮放：只與 c = μσ² 有關
    expect(logFactorVariance(0.2, { kind: 'gaussian', sigma: 2 })).toBeCloseTo(logFactorVariance(0.8, GAUSS), 12)
    // 奇點附近（u = c√μ 跨過 1）連續且有限：過去的寫法在這裡會因浮點相消算出 ln 0
    const near = [0.3333, 1 / 3, 0.3334].map((mu) => logFactorVariance(mu, UNIT_UNIFORM))
    expect(near.every((v) => Number.isFinite(v))).toBe(true)
    expect(Math.abs(near[0] - near[1])).toBeLessThan(0.01)
    expect(Math.abs(near[2] - near[1])).toBeLessThan(0.01)
    for (let i = 1; i <= 400; i++) {
      const v = logFactorVariance(i * 0.025, GAUSS)
      expect(Number.isFinite(v) && v > 0, `μ=${i * 0.025}`).toBe(true)
    }
    // 單步 MC：樣本標準差 = lambdaSe·√M
    for (const [d, mu] of [
      [GAUSS, 0.8],
      [GAUSS, 2],
      [UNIT_UNIFORM, 1],
    ] as [XDist, number][]) {
      const os = oneStepMc({ mu, dist: d, samples: 400000, seed: 20261010 })
      const sd = Math.sqrt(logFactorVariance(mu, d))
      expect(Math.abs(os.lambdaSe * Math.sqrt(os.samples) - sd) / sd).toBeLessThan(0.02)
    }
    // 離散分布：直接計算；|x| 常數時為 0；含 f = 0 的值時沒有定義
    expect(logFactorVariance(0.5, SPARSE)).toBeCloseTo(0.09 * Math.log(3.5) ** 2, 14) // p(1−p)·(ln 3.5)²
    expect(logFactorVariance(0.3, BPSK)).toBe(0)
    expect(logFactorVariance(0.1, { kind: 'fixed', value: 2 })).toBe(0)
    expect(Number.isNaN(logFactorVariance(0.25, { kind: 'fixed', value: 2 }))).toBe(true)
    expect(Number.isNaN(logFactorVariance(1 / 9, SPARSE))).toBe(true)
  })

  it('T03: CLT 預測重現勘誤 E14 的數字：Gaussian μ=2、N=200 收斂比例 83.1%（Python MC 83.25%）；μ=2.3 約一半 / 四分之三；並與本站 MC 一致', () => {
    const pred = (mu: number, n: number) => cltConvergedFraction(lyapunovExponent(mu, GAUSS), Math.sqrt(logFactorVariance(mu, GAUSS)), n, 1e-3)
    expect(pred(2, 200)).toBeCloseTo(0.8310, 4)
    expect(Math.abs(pred(2, 200) - 0.8325)).toBeLessThan(0.01) // docs/validation.md E14 的 Python Monte Carlo
    expect(pred(2.3, 200)).toBeCloseTo(0.4905, 4)
    expect(pred(2.3, 1000)).toBeCloseTo(0.7402, 4)
    expect(pred(0.8, 200)).toBeGreaterThan(0.999999)
    // 與本站 Monte Carlo 比較：二項分布的 4 SE + CLT 近似誤差 1.5%
    for (const [mu, n, seed] of [
      [2, 200, 2],
      [2.3, 200, 20261010],
      [2.3, 1000, 20261010],
      [1.5, 60, 5],
    ] as const) {
      const P = 10000
      const r = runStabilityMc({ mu, dist: GAUSS, delta0: 1, steps: n, paths: P, seed, noiseSigma: 0, oneStepSamples: 1000 })
      const p = pred(mu, n)
      const mc = r.fracConverged.at(-1)!
      expect(Math.abs(mc - p), `μ=${mu}, n=${n}: MC ${mc} vs CLT ${p}`).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / P) + 0.015)
    }
  })

  it('T03: CLT 預測的 10% / 50% / 90% 分位與 MC 分位帶一致（μ=0.8、N=200：−47.76 / −40.45 / −33.15）', () => {
    const lam = lyapunovExponent(0.8, GAUSS)
    const sd = Math.sqrt(logFactorVariance(0.8, GAUSS))
    expect(cltLog10Quantile(lam, sd, 200, 0.1)).toBeCloseTo(-47.762, 2)
    expect(cltLog10Quantile(lam, sd, 200, 0.5)).toBeCloseTo(-40.454, 2)
    expect(cltLog10Quantile(lam, sd, 200, 0.9)).toBeCloseTo(-33.146, 2)
    const r = runStabilityMc({ mu: 0.8, dist: GAUSS, delta0: 1, steps: 200, paths: 10000, seed: 20261010, noiseSigma: 0, oneStepSamples: 1000 })
    // 帶寬約 14.6 decade；MC 分位數的抽樣誤差約 0.1–0.2 decade，CLT 偏態修正約 0.2 decade
    expect(Math.abs(r.q10.at(-1)! - cltLog10Quantile(lam, sd, 200, 0.1))).toBeLessThan(0.6)
    expect(Math.abs(r.q50.at(-1)! - cltLog10Quantile(lam, sd, 200, 0.5))).toBeLessThan(0.6)
    expect(Math.abs(r.q90.at(-1)! - cltLog10Quantile(lam, sd, 200, 0.9))).toBeLessThan(0.6)
    // 帶的中心 ∝ n、寬度 ∝ √n：n 變 4 倍，寬度只變 2 倍
    const width = (n: number) => cltLog10Quantile(lam, sd, n, 0.9) - cltLog10Quantile(lam, sd, n, 0.1)
    expect(width(800) / width(200)).toBeCloseTo(2, 12)
  })

  it('T03: （反面測試／邊界）|x| 常數時 s = 0：收斂比例是階梯、分位數全等；λ = −∞ 或 s 無定義時回傳 NaN 而不是假數字', () => {
    const lam = Math.log(0.6) // 固定 x = 2、μ = 0.1
    expect(cltConvergedFraction(lam, 0, 13)).toBe(0) // 0.6^13 = 1.3e−3 > 1e−3
    expect(cltConvergedFraction(lam, 0, 14)).toBe(1) // 0.6^14 = 7.8e−4 < 1e−3
    expect(cltLog10Quantile(lam, 0, 200, 0.1)).toBeCloseTo(200 * Math.log10(0.6), 12)
    expect(cltLog10Quantile(lam, 0, 200, 0.9)).toBeCloseTo(200 * Math.log10(0.6), 12)
    expect(cltConvergedFraction(lam, 0, 0)).toBe(0) // n = 0：|δ_0| 不小於 10⁻³|δ_0|
    expect(Number.isNaN(cltConvergedFraction(-Infinity, 0, 10))).toBe(true)
    expect(Number.isNaN(cltConvergedFraction(-0.1, NaN, 10))).toBe(true)
    expect(Number.isNaN(cltLog10Quantile(-0.1, NaN, 10, 0.5))).toBe(true)
    // 發散（λ > 0）：比例隨 n 趨近 0
    const lamUp = lyapunovExponent(2.6, GAUSS)
    const sdUp = Math.sqrt(logFactorVariance(2.6, GAUSS))
    expect(cltConvergedFraction(lamUp, sdUp, 4000)).toBeLessThan(cltConvergedFraction(lamUp, sdUp, 400))
    expect(cltConvergedFraction(lamUp, sdUp, 1e6)).toBeLessThan(1e-6)
  })
})

describe('scalarStability：解析交叉比對（實驗的 Analytic 欄）', () => {
  it('T03: g、h 的動差封閉式與直接數值積分 E|1−μx²|^s 一致；λ 的兩種算法一致（Gaussian：Dawson vs lms.ts；Uniform：封閉式 vs 積分）', () => {
    const dists: XDist[] = [
      GAUSS,
      { kind: 'gaussian', sigma: 0.3 },
      { kind: 'gaussian', sigma: 4 },
      UNIT_UNIFORM,
      { kind: 'uniform', halfWidth: 0.2 },
      { kind: 'uniform', halfWidth: 4 },
      BPSK,
      { kind: 'fixed', value: 2 },
      SPARSE,
    ]
    for (const d of dists) {
      for (const mu of [-0.05, 0.001, 0.1, 1 / 3, 2 / 3, 0.8, 1, 2, 2.4212, 5, 20]) {
        const xc = analyticCrossCheck(mu, d)
        expect(xc.ok, `${JSON.stringify(d)} μ=${mu}`).toBe(true)
        expect(xc.gRelDev).toBeLessThan(1e-6)
        expect(xc.hRelDev).toBeLessThan(1e-6)
      }
    }
    // T03 的關鍵點：g(2/3) = 1 由兩種獨立算法同時得到
    expect(absPowerFactor(2 / 3, GAUSS, 2)).toBeCloseTo(1, 9)
    // Uniform 封閉式 vs 積分：涵蓋 u < 1、u = 1（端點對數奇點）、u 略大於 1、u ≫ 1
    for (const mu of [0.3, 1 / 3, 0.334, 1, 2.0905, 5]) {
      expect(Math.abs(uniformLyapunov(mu, Math.sqrt(3)) - uniformLyapunovQuad(mu, Math.sqrt(3)))).toBeLessThan(1e-9)
    }
    expect(analyticCrossCheck(1, GAUSS).lambdaAlt).not.toBeNull()
    expect(analyticCrossCheck(1, SPARSE).lambdaAlt).toBeNull() // 有限清單：直接平均即精確式
  })

  it('T03: （反面測試）公式寫錯時 Analytic 交叉比對必須回報 mismatch，而不是顯示成功', () => {
    const m = xMoments(GAUSS)
    const mu = 0.5
    // (a) 誤把 E[x⁴] 當成 E[x²]²（忽略 kurtosis）→ g 錯
    expect(analyticCrossCheck(mu, GAUSS, { g: 1 - 2 * mu * m.Px + mu * mu * m.Px * m.Px }).ok).toBe(false)
    // (b) J2 少了 ½（勘誤 E41）：等效步長變 2μ → g 錯
    expect(analyticCrossCheck(mu, GAUSS, { g: meanSquareFactor(2 * mu, m.Px, m.M4) }).ok).toBe(false)
    // (c) 把 λ 誤當成 ½ln g（把 Jensen 不等式當等式）
    expect(analyticCrossCheck(mu, GAUSS, { lambda: 0.5 * Math.log(meanSquareFactor(mu, m.Px, m.M4)) }).ok).toBe(false)
    // (d) h 少了 μ⁴M_8 項
    expect(analyticCrossCheck(mu, GAUSS, { h: fourthPowerFactor(mu, m) - mu ** 4 * m.M8 }).ok).toBe(false)
    // 正確公式則為 ok
    expect(analyticCrossCheck(mu, GAUSS).ok).toBe(true)
  })
})
