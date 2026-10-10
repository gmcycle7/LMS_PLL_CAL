import { cleanup, fireEvent, render } from '@testing-library/react'
import katex from 'katex'
import { HandCalc, MathText, defaultValues, randomValues } from '@/components'
import { normCdf, normInv } from '@/simulation/core'
import { classifyPole, fixedXMuMax, fixedXPole, meanPole, meanSquareFactor, meanSquareMuMax, runScalarLms, type PoleBehaviour } from '@/simulation/models/lms'
import {
  analyticTrajectory,
  blockMeanSquareBound,
  cltConvergedFraction,
  cltLog10Quantile,
  cltStepsBelowStart,
  cltZScore,
  logFactorVariance,
  lyapunovExponent,
  msdAfterSteps,
  stabilityBounds,
  stabilityFactors,
  steadyStateMsd,
  stepsToReach,
  timeConstant,
  xMoments,
  type XDist,
} from '@/simulation/models/scalarStability'
import { GAUSS_CLT_TABLE, HANDCALCS, handcalcById } from './handcalcs'
import { agree, sigDigits, sigFor, sigForN, sigLn, sigPow, snap, tx, txBase, txCeilArg, txFixed, txInt, txLn, txP, txPow, txSq } from './handcalcTex'
import { poleLabelTex } from './poleLabel'
import { chainLinks, evalTex, isSymbolic, splitTop } from './texEval'
import t01 from '../../../golden/vectors/T01.json'
import t02 from '../../../golden/vectors/T02.json'
import t03 from '../../../golden/vectors/T03.json'

// 多個測試程序同時跑時 KaTeX 渲染會變慢：放寬逾時，避免與正確性無關的失敗
vi.setConfig({ testTimeout: 60_000 })

afterEach(() => cleanup())

const GAUSS: XDist = { kind: 'gaussian', sigma: 1 }
const SPARSE: XDist = { kind: 'list', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] }

/** 以預設值求解，回傳各 result 的數值 */
function solveDefault(id: string): number[] {
  const def = handcalcById(id)
  expect(def.validate?.(defaultValues(def)) ?? null).toBeNull()
  return def.solve(defaultValues(def)).results.map((r) => r.value)
}
function values(id: string, v: Record<string, number>): number[] {
  return handcalcById(id).solve(v).results.map((r) => r.value)
}

/** 測試內自己寫的 Φ(z)：對標準常態密度做 Simpson 積分（不經過 normCdf） */
function phiBySimpson(zRaw: number): number {
  const lo = -12
  if (zRaw <= lo) return 0 // Φ(−12) ≈ 1.8e−33
  const z = Math.min(zRaw, 12) // 1 − Φ(12) ≈ 1.8e−33
  const m = 8000
  const h = (z - lo) / m
  const f = (t: number) => Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI)
  let s = f(lo) + f(z)
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(lo + i * h)
  return (s * h) / 3
}

/** scipy 求得的 Gaussian almost-sure 常數（scalarStability.test.ts 的 T03 用同一個數） */
const C_AS = 2.421249521
/** z_{0.9} = Φ⁻¹(0.9)（標準常態表） */
const Z90 = 1.2815515655446004

/**
 * 獨立重算：直接照公式寫在測試裡（不呼叫模型函式），用來核對 solve() 的每一個答案。
 * 回傳值的順序與各題 results 的順序相同。
 */
const RECOMPUTE: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-03.1': ({ a, w0, x, mu }) => {
    const p = 1 - mu * x * x
    const d2 = p * p * (a - w0)
    return [2 / (x * x), p, d2, a - d2]
  },
  'HC-03.2': ({ x, mu, eps }) => {
    const p = 1 - mu * x * x
    return [p, -1 / Math.log(Math.abs(p)), Math.ceil(Math.log(eps) / Math.log(Math.abs(p)))]
  },
  'HC-03.3': ({ x1, x2, x3, x4, x5, mu }) => {
    const xs = [x1, x2, x3, x4, x5]
    const Px = xs.reduce((s, v) => s + v ** 2, 0) / 5
    const M4 = xs.reduce((s, v) => s + v ** 4, 0) / 5
    return [Px, M4, M4 / Px ** 2, 2 / Px, 1 - mu * Px]
  },
  'HC-03.4': ({ Px, M4, mu, d0, n }) => {
    const g = 1 - 2 * mu * Px + mu * mu * M4
    return [(2 * Px) / M4, g, g ** n * d0 * d0]
  },
  'HC-03.5': ({ Px, M4, mu, sv }) => {
    const msd = (mu * Px * sv * sv) / (2 * Px - mu * M4)
    return [msd, Math.sqrt(msd), Px * msd + sv * sv]
  },
  'HC-03.6': ({ A, K, mu }) => {
    const Px = (A * A) / K
    const M4 = A ** 4 / K
    const lam = Math.log(Math.abs(1 - mu * A * A)) / K
    return [1 - mu * Px, 1 - 2 * mu * Px + mu * mu * M4, lam, Math.exp(lam)]
  },
  'HC-03.7': ({ lam, s, n, eps }) => {
    const z = (Math.log(eps) - n * lam) / (s * Math.sqrt(n))
    return [z, phiBySimpson(z), Math.ceil(((Z90 * s) / lam) ** 2)]
  },
  'HC-03.8': ({ sigma, mu, N }) => {
    const s2 = sigma * sigma
    const s4 = s2 * s2
    return [2 / s2, 2 / (3 * s2), C_AS / s2, 1 - 2 * mu * s2 + 3 * mu * mu * s4, (2 * s2) / (s4 + (3 * s4 - s4) / N)]
  },
}

const closeRel = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b))

/** `$…$` 成對，且每一段 TeX 都能被 KaTeX 嚴格解析 */
function expectMathTextOk(text: string, where: string) {
  const parts = text.split('$')
  expect(parts.length % 2, `${where}：$ 不成對：${text}`).toBe(1)
  parts.forEach((p, i) => {
    if (i % 2) expect(() => katex.renderToString(p, { throwOnError: true, strict: 'ignore' }), `${where}：${p}`).not.toThrow()
  })
}

describe('ch03 帶入手算：登錄', () => {
  it('8 題、ID 為 HC-03.1 … HC-03.8、頁面 /ch/03，三種難度都有；通式、標題、提示的 TeX 可嚴格解析', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(Array.from({ length: 8 }, (_, i) => `HC-03.${i + 1}`))
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/03')
      expect(h.formulaId).toMatch(/^F-03\.\d+$/)
      expect(() => katex.renderToString(h.formulaTex, { throwOnError: true, displayMode: true, strict: 'ignore' }), h.id).not.toThrow()
      expectMathTextOk(h.title, `${h.id} title`)
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(2)
      for (const t of h.tips ?? []) expectMathTextOk(t, `${h.id} tip`)
      for (const i of h.inputs) {
        expect(() => katex.renderToString(i.symbol, { throwOnError: true, strict: 'ignore' }), `${h.id} ${i.key}`).not.toThrow()
        expect(i.label, `${h.id} ${i.key}：label 用白話、不放 $（會進 aria-label）`).not.toMatch(/\$/)
        expect(i.practice, `${h.id} ${i.key} 要有手算友善的練習範圍`).toBeTruthy()
      }
    }
    expect(() => handcalcById('HC-03.99')).toThrow(/找不到手算題/)
  })
})

describe('ch03 帶入手算：(a) 預設值 = worked example = 模型函式 / golden vector', () => {
  it('T02: HC-03.1 固定 x=2、μ=0.1：μ_max=0.5、p=0.6、δ₂=0.72、w₂=2.28（T01 的 w₂）；golden 的每個 μ 的 pole 與收斂判定一致', () => {
    const [muMax, p, d2, w2] = solveDefault('HC-03.1')
    expect(muMax).toBeCloseTo(t02.expected.mu_max, 12)
    expect(muMax).toBe(fixedXMuMax(2))
    expect(p).toBeCloseTo(0.6, 12)
    expect(d2).toBeCloseTo(0.72, 12) // δ = a − w：3 − 2.28
    expect(w2).toBeCloseTo(t01.expected.w2, 12)
    const sim = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 0.1, steps: 2, x: { kind: 'fixed', value: 2 } })
    // 答案就是 LMS 程式實際迭代出來的值（只差 double 的捨入：0.7199999999999998 顯示並回報為 0.72）
    expect(Math.abs(w2 - sim.w[2])).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(d2 - sim.delta[2])).toBeLessThanOrEqual(1e-12)
    const def = handcalcById('HC-03.1')
    t02.inputs.mu_list.forEach((mu, i) => {
      const sol = def.solve({ a: 3, w0: 1, x: t02.inputs.x, mu })
      expect(Math.abs(sol.results[1].value - t02.expected.pole_list[i])).toBeLessThanOrEqual(t02.tolerance.abs)
      // 行為說明（notes[0]）與 golden 的收斂判定一致
      const converges = /收斂|一步到答案/.test(sol.notes![0]) && !/不保證|發散/.test(sol.notes![0])
      expect(converges, `μ=${mu}：${sol.notes![0]}`).toBe(t02.expected.converges_list[i] === 1)
    })
    // 一步到位的 μ 寫在 notes 裡
    expect(def.solve(defaultValues(def)).notes!.join('')).toContain(String(t02.expected.mu_one_step))
  })

  it('T02: HC-03.2 p=0.6：τ = −1/ln 0.6 = 1.958 samples、n_ε = 14 步；與模型的 timeConstant / stepsToReach 相同，且模擬在第 14 步才降到 10⁻³ 以下', () => {
    const [p, tau, n] = solveDefault('HC-03.2')
    expect(p).toBe(fixedXPole(0.1, 2))
    expect(tau).toBe(timeConstant(p))
    expect(tau).toBeCloseTo(1.9576, 4)
    expect(n).toBe(stepsToReach(p, 1e-3))
    expect(n).toBe(14)
    const sim = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 0.1, steps: 14, x: { kind: 'fixed', value: 2 } })
    expect(Math.abs(sim.delta[14] / sim.delta[0])).toBeLessThanOrEqual(1e-3)
    expect(Math.abs(sim.delta[13] / sim.delta[0])).toBeGreaterThan(1e-3)
    // p = −0.6（μ = 0.4）一樣快
    expect(values('HC-03.2', { x: 2, mu: 0.4, eps: 1e-3 })[2]).toBe(14)
  })

  it('HC-03.3 五階 code {−2,−1,0,1,2}：P_x=2、M_4=6.8、κ=1.7、mean 界 1、mean 因子 0.5（= xMoments / stabilityBounds / meanPole）', () => {
    const [Px, M4, kappa, muMean, pole] = solveDefault('HC-03.3')
    const dist: XDist = { kind: 'list', values: [-2, -1, 0, 1, 2] }
    const m = xMoments(dist)
    expect([Px, M4, kappa]).toEqual([m.Px, m.M4, m.kurtosis])
    expect([Px, M4, kappa]).toEqual([2, 6.8, 1.7])
    expect(muMean).toBe(stabilityBounds(dist).meanMax)
    expect(muMean).toBe(1)
    expect(pole).toBe(meanPole(0.25, m.Px))
    expect(pole).toBe(0.5)
  })

  it('T03: HC-03.4 Gaussian 動差（P_x=1、M_4=3）：μ_MS=2/3、g(0.5)=0.75、E[δ₅²]=0.75⁵；golden 的每個 μ 的 MS 因子一致（含 ±1 與 uniform 的界）', () => {
    const [muMs, g, msd] = solveDefault('HC-03.4')
    expect(muMs).toBeCloseTo(t03.expected.mu_ms_max, 12)
    expect(muMs).toBe(meanSquareMuMax(1, 3))
    expect(g).toBe(meanSquareFactor(0.5, 1, 3))
    expect(g).toBeCloseTo(0.75, 12)
    expect(msd).toBeCloseTo(0.75 ** 5, 12)
    // 與模型的解析軌跡（log 域）一致
    const tr = analyticTrajectory({ mu: 0.5, dist: GAUSS, delta0: 1, noiseSigma: 0 }, [5])
    expect(msd).toBeCloseTo(10 ** (2 * tr.log10Rms[0]), 10)
    const def = handcalcById('HC-03.4')
    t03.inputs.mu_list.forEach((mu, i) => {
      const r = def.solve({ Px: t03.inputs.Ex2, M4: t03.inputs.Ex4, mu, d0: 1, n: 1 }).results
      expect(Math.abs(r[1].value - t03.expected.ms_factor_list[i])).toBeLessThanOrEqual(t03.tolerance.abs)
      expect(Math.abs(r[2].value - t03.expected.ms_factor_list[i])).toBeLessThanOrEqual(t03.tolerance.abs) // n = 1：E[δ₁²] = g
    })
    expect(values('HC-03.4', { Px: 1, M4: 1, mu: 0.5, d0: 1, n: 1 })[0]).toBeCloseTo(t03.expected.mu_ms_max_bpsk, 12)
    expect(values('HC-03.4', { Px: 1, M4: 9 / 5, mu: 0.5, d0: 1, n: 1 })[0]).toBeCloseTo(t03.expected.mu_ms_max_uniform, 12)
  })

  it('HC-03.5 固定 x=2（P_x=4、M_4=16）、μ=0.1、σ_v=1：MSD∞=0.0625、RMS=0.25、MSE=1.25（思考題 5；= analyticTrajectory，勘誤 E42）', () => {
    const [msd, rms, mse] = solveDefault('HC-03.5')
    const tr = analyticTrajectory({ mu: 0.1, dist: { kind: 'fixed', value: 2 }, delta0: 0, noiseSigma: 1 }, [0])
    expect(msd).toBe(tr.msdInf)
    expect(mse).toBe(tr.mseInf)
    expect(msd).toBeCloseTo(0.0625, 14)
    expect(rms).toBeCloseTo(0.25, 14)
    expect(mse).toBeCloseTo(1.25, 14)
    // Gaussian、μ=0.3、σ_v=0.1（Stability Lab 的例子）也與模型一致
    const g = analyticTrajectory({ mu: 0.3, dist: GAUSS, delta0: 0, noiseSigma: 0.1 }, [0])
    const [m2, , e2] = values('HC-03.5', { Px: 1, M4: 3, mu: 0.3, sv: 0.1 })
    expect(m2).toBe(g.msdInf)
    expect(e2).toBe(g.mseInf)
  })

  it('HC-03.6 稀疏 code {0×9, 3}、μ=0.5：1−μP_x=0.55、g=2.125、λ=ln3.5/10=0.1253、e^λ=1.1335（思考題 4；= stabilityFactors）', () => {
    const [pole, g, lam, geo] = solveDefault('HC-03.6')
    const f = stabilityFactors(0.5, SPARSE)
    expect([pole, g, lam, geo]).toEqual([f.meanPole, f.g, f.lambda, f.geoMean])
    expect(pole).toBeCloseTo(0.55, 12)
    expect(g).toBeCloseTo(2.125, 12)
    expect(lam).toBeCloseTo(Math.log(3.5) / 10, 12)
    expect(lam.toPrecision(4)).toBe('0.1253')
    // 三種判據的結論：mean 收斂、MS 發散、a.s. 發散；Jensen 成立
    const notes = handcalcById('HC-03.6').solve({ A: 3, K: 10, mu: 0.5 }).notes!.join('\n')
    expect(notes).toMatch(/mean：.*收斂 ✓；mean-square：.*發散 ✗；almost-sure：.*發散 ✗/)
    expect(notes).toMatch(/mean 收斂、路徑卻發散/)
    expect(lam).toBeLessThanOrEqual(0.5 * Math.log(g))
  })

  it('T03: HC-03.7 Gaussian μ=2、n=200、ε=10⁻³：預設的 λ、s 是模型值的 4 位有效數字，CLT 收斂比例 83.1%（勘誤 E14）、n₉₀=177', () => {
    const def = handcalcById('HC-03.7')
    const d = defaultValues(def)
    const lam = lyapunovExponent(2, GAUSS)
    const s = Math.sqrt(logFactorVariance(2, GAUSS))
    expect(d.lam).toBe(Number(lam.toPrecision(4)))
    expect(d.s).toBe(Number(s.toPrecision(4)))
    const [z, frac, n90] = solveDefault('HC-03.7')
    expect(z).toBe(cltZScore(d.lam, d.s, d.n, d.eps)) // z 也來自模型（cltConvergedFraction 內部用的同一個函式）
    expect(frac).toBe(cltConvergedFraction(d.lam, d.s, d.n, d.eps))
    expect(frac).toBe(normCdf(z))
    expect(z).toBeCloseTo(0.958, 3)
    expect(frac).toBeCloseTo(0.831, 3)
    expect(Math.abs(frac - cltConvergedFraction(lam, s, 200, 1e-3))).toBeLessThan(5e-4) // 輸入四捨五入的影響
    expect(n90).toBe(Math.ceil(cltStepsBelowStart(d.lam, d.s, 0.9)))
    expect(n90).toBe(177)
    // n₉₀ 的意義：CLT 的 90% 分位數從這一步起低於起點（用模型的 cltLog10Quantile 交叉檢查）
    expect(cltLog10Quantile(d.lam, d.s, n90, 0.9)).toBeLessThan(0)
    expect(cltLog10Quantile(d.lam, d.s, n90 - 1, 0.9)).toBeGreaterThan(0)
    // 手算提示裡的 (μ, λ, s) 表與模型一致（4 位有效數字）
    for (const row of GAUSS_CLT_TABLE) {
      expect(closeRel(row.lambda, lyapunovExponent(row.mu, GAUSS), 5e-4), `λ(${row.mu})`).toBe(true)
      expect(closeRel(row.s, Math.sqrt(logFactorVariance(row.mu, GAUSS)), 5e-4), `s(${row.mu})`).toBe(true)
    }
  })

  it('T03: HC-03.8 Gaussian σ=1、μ=0.3、N=4096：三個界限 2、2/3、2.4212；g=0.67；block 界 1.99902（= stabilityBounds / blockMeanSquareBound / golden）', () => {
    const [muMean, muMs, muAs, g, blk] = solveDefault('HC-03.8')
    const b = stabilityBounds(GAUSS)
    expect([muMean, muMs, muAs]).toEqual([b.meanMax, b.msMax, b.asMax])
    expect(muMean).toBeCloseTo(t03.expected.mu_mean_max, 12)
    expect(muMs).toBeCloseTo(t03.expected.mu_ms_max, 12)
    expect(muAs).toBeCloseTo(C_AS, 8)
    expect(muAs.toPrecision(5)).toBe('2.4212') // 通式與提示裡寫的常數
    expect(Math.abs(g - t03.expected.ms_factor_list[0])).toBeLessThanOrEqual(t03.tolerance.abs) // μ = 0.3
    expect(blk).toBe(blockMeanSquareBound(xMoments(GAUSS), 4096))
    expect(blk.toPrecision(6)).toBe('1.99902')
    // σ 縮放：界限 ∝ 1/σ²
    const [m2, s2, a2] = values('HC-03.8', { sigma: 2, mu: 0.1, N: 1 })
    expect([m2, s2]).toEqual([0.5, 1 / 6])
    expect(a2).toBeCloseTo(C_AS / 4, 8)
    // N = 1 時 block 界就是原本的 MS 界
    expect(values('HC-03.8', { sigma: 1, mu: 0.3, N: 1 })[4]).toBeCloseTo(2 / 3, 12)
    // 三個區間的結論（μ = 0.3 / 0.8 / 2.3 / 2.6）
    const note = (mu: number) => handcalcById('HC-03.8').solve({ sigma: 1, mu, N: 4096 }).notes!.join('\n')
    expect(note(0.3)).toMatch(/mean 收斂 ✓.*mean-square 收斂 ✓.*almost-sure 收斂 ✓/)
    expect(note(0.3)).toMatch(/Sign-off 寫法/)
    expect(note(0.8)).toMatch(/mean 收斂 ✓.*mean-square 發散 ✗.*almost-sure 收斂 ✓/)
    expect(note(0.8)).toMatch(/MSD 發散，但幾乎每條路徑仍收斂/)
    expect(note(2.3)).toMatch(/mean 發散 ✗.*mean-square 發散 ✗.*almost-sure 收斂 ✓/)
    expect(note(2.6)).toMatch(/三種意義下都不收斂/)
  })
})

describe('ch03 帶入手算：手算提示（tips）裡寫的近似式與誤差範圍都是真的', () => {
  it('HC-03.7：Φ(z) 的三個計算機近似——logistic 三次式誤差 < 0.0002、1.702 logistic 誤差 < 0.01、|z| ≤ 0.3 的線性式誤差 < 0.002；查表例值正確', () => {
    const tips = handcalcById('HC-03.7').tips!.join('\n')
    // 提示裡寫的係數就是下面驗證的係數
    for (const c of ['1.5976', '0.07056', '1.702', '0.3989', '0.0002', '0.01', '0.002']) expect(tips, c).toContain(c)
    let worstCubic = 0
    let worstLogistic = 0
    let worstLinear = 0
    for (let i = -800; i <= 800; i++) {
      const z = i / 100
      const phi = normCdf(z)
      worstCubic = Math.max(worstCubic, Math.abs(1 / (1 + Math.exp(-(1.5976 * z + 0.07056 * z ** 3))) - phi))
      worstLogistic = Math.max(worstLogistic, Math.abs(1 / (1 + Math.exp(-1.702 * z)) - phi))
      if (Math.abs(z) <= 0.3) worstLinear = Math.max(worstLinear, Math.abs(0.5 + 0.3989 * z - phi))
    }
    expect(worstCubic).toBeLessThan(2e-4)
    expect(worstLogistic).toBeLessThan(0.01)
    expect(worstLinear).toBeLessThan(0.002)
    // 模型的 normCdf 與測試內的 Simpson 積分一致（查表例值：Φ(0.96)、Φ(1)、Φ(2)）
    for (const [z, table] of [
      [0.96, 0.8315],
      [1, 0.8413],
      [2, 0.9772],
    ] as const) {
      expect(tips).toContain(String.raw`\Phi(${z})=${table}`)
      expect(Number(normCdf(z).toFixed(4))).toBe(table) // 四捨五入到表的 4 位小數
      expect(phiBySimpson(z)).toBeCloseTo(normCdf(z), 7)
    }
    // z_{0.9} = 1.2816（通式與步驟裡用的分位點）
    expect(normInv(0.9)).toBeCloseTo(Z90, 9)
    expect(normInv(0.9).toPrecision(5)).toBe('1.2816')
    // 「換一題」的所有組合（3×3×2×3 = 54 組）都通過 validate，而且 |z| ≤ 2：落在一般常態表的範圍內
    const def = handcalcById('HC-03.7')
    const choices = (key: string) => def.inputs.find((i) => i.key === key)!.practice!.choices!
    let combos = 0
    for (const lam of choices('lam'))
      for (const s of choices('s'))
        for (const n of choices('n'))
          for (const eps of choices('eps')) {
            const v = { lam, s, n, eps }
            expect(def.validate!(v), JSON.stringify(v)).toBeNull()
            expect(Number.isInteger(Math.sqrt(n)), `n = ${n} 應為完全平方數（√n 可心算）`).toBe(true)
            const z = def.solve(v).results[0].value
            expect(Math.abs(z), JSON.stringify(v)).toBeLessThanOrEqual(2)
            combos++
          }
    expect(combos).toBe(54)
  })

  it('HC-03.2：小步長近似 τ ≈ 1/(μx²) 的相對誤差約 μx²/2（μx² = 0.1 時約 5%）；ln 與 log₁₀ 的換算常數 2.3026', () => {
    const tips = handcalcById('HC-03.2').tips!.join('\n')
    expect(tips).toContain('2.3026')
    expect(Math.LN10.toPrecision(5)).toBe('2.3026')
    for (const c of [0.02, 0.05, 0.1]) {
      const tau = timeConstant(1 - c) // 精確：−1/ln(1 − μx²)
      const relErr = (1 / c - tau) / tau
      expect(relErr).toBeGreaterThan(0) // 近似值偏大
      expect(Math.abs(relErr - c / 2)).toBeLessThan(0.1 * (c / 2) + 1e-3) // ≈ μx²/2（下一項是 (μx²)²/3）
    }
    expect((1 / 0.1 - timeConstant(0.9)) / timeConstant(0.9)).toBeCloseTo(0.054, 3)
    // 比值 ln ε / ln|p| 與 log₁₀ ε / log₁₀|p| 相同
    expect(Math.log(1e-3) / Math.log(0.6)).toBeCloseTo(Math.log10(1e-3) / Math.log10(0.6), 12)
  })

  it('HC-03.6：提示裡的心算近似——ln(1−u) ≈ −u − u²/2 在 u = 0.1 時誤差約 0.3%；|λ| ≤ 0.1 時 e^λ ≈ 1 + λ 誤差 < 0.6%；nat 換 dB 的常數 8.686', () => {
    const tips = handcalcById('HC-03.6').tips!.join('\n')
    for (const c of ['0.3%', String.raw`0.6\%`, '8.686', '2.3026']) expect(tips, c).toContain(c)
    const u = 0.1
    const relLn = Math.abs((-u - (u * u) / 2) / Math.log(1 - u) - 1)
    expect(relLn).toBeGreaterThan(0.002)
    expect(relLn).toBeLessThan(0.004)
    let worst = 0
    for (let i = -100; i <= 100; i++) {
      const lam = i / 1000
      worst = Math.max(worst, Math.abs((1 + lam) / Math.exp(lam) - 1))
    }
    expect(worst).toBeLessThan(0.006)
    expect(worst).toBeGreaterThan(0.004) // 寫 0.6% 不算太寬
    expect((20 * Math.log10(Math.E)).toPrecision(4)).toBe('8.686')
    // 範例數字：{0×9, 3} 的 λ 就是 ln 3.5 / 10
    expect(tips).toContain(String.raw`\lambda=\tfrac1{10}\ln3.5=0.1253`)
    expect((Math.log(3.5) / 10).toPrecision(4)).toBe('0.1253')
  })

  it('HC-03.3／HC-03.4／HC-03.5／HC-03.8：提示裡的常見分布動差與範例數字都與模型一致', () => {
    // HC-03.3 的範例數字（五階 code）就是 xMoments 的結果，也是第 2 節內文的數字例
    const c5 = xMoments({ kind: 'list', values: [-2, -1, 0, 1, 2] })
    expect([c5.Px, c5.M4, c5.kurtosis]).toEqual([2, 6.8, 1.7])
    expect(handcalcById('HC-03.3').tips!.join('\n')).toContain(String.raw`$P_x=10/5=2$、$M_4=34/5=6.8$、$\kappa=1.7$、$\mu_\text{mean}=1$`)
    // 稀疏 code {0×9, 3} 與 ±1 code
    const sp = xMoments(SPARSE)
    expect([sp.Px, sp.M4]).toEqual([0.9, 8.1])
    expect(sp.kurtosis).toBeCloseTo(10, 12)
    const pm = xMoments({ kind: 'pm_one', amplitude: 1 })
    expect([pm.Px, pm.M4, pm.kurtosis]).toEqual([1, 1, 1])
    // Gaussian：P_x = σ²、M_4 = 3σ⁴；Uniform U(−c, c)：c²/3、c⁴/5；±A：A²、A⁴
    const ga = xMoments({ kind: 'gaussian', sigma: 2 })
    expect(ga.Px).toBeCloseTo(4, 12)
    expect(ga.M4).toBeCloseTo(48, 12)
    const un = xMoments({ kind: 'uniform', halfWidth: 3 })
    expect(un.Px).toBeCloseTo(9 / 3, 12)
    expect(un.M4).toBeCloseTo(81 / 5, 12)
    const am = xMoments({ kind: 'pm_one', amplitude: 3 })
    expect([am.Px, am.M4]).toEqual([9, 81])
    // 小 μ 近似 MSD∞ ≈ μσ_v²/2，以及「固定 x」的退化式 μσ_v²/(2 − μx²)
    expect(steadyStateMsd(0.001, 1, 3, 1).msd).toBeCloseTo(0.0005, 5)
    expect(steadyStateMsd(0.1, 4, 16, 1).msd).toBeCloseTo((0.1 * 1) / (2 - 0.1 * 4), 14)
    // 均方收斂最快的步長 μ* = P_x/M_4（MS 界的一半）、g* = 1 − 1/κ（HC-03.4 的 notes）
    expect(stabilityBounds(GAUSS).msOpt).toBeCloseTo(meanSquareMuMax(1, 3) / 2, 14)
    expect(meanSquareFactor(1 / 3, 1, 3)).toBeCloseTo(1 - 1 / 3, 14)
    expect(handcalcById('HC-03.4').solve({ Px: 1, M4: 3, mu: 0.5, d0: 1, n: 5 }).notes!.join('')).toMatch(/\\mu\^\\ast=P_x\/M_4=0\.33333/)
    // HC-03.8 提示：2/4096 = 4.8828×10⁻⁴；μ = 0.8 / 1.5 / 2.3 / 2.6 的四種結論
    expect((2 / 4096).toExponential(4)).toBe('4.8828e-4')
    const verdicts = (mu: number) => {
      const f = stabilityFactors(mu, GAUSS)
      return [Math.abs(f.meanPole) < 1, f.g < 1, f.lambda < 0]
    }
    expect(verdicts(0.8)).toEqual([true, false, true])
    expect(verdicts(1.5)).toEqual([true, false, true])
    expect(verdicts(2.3)).toEqual([false, false, true])
    expect(verdicts(2.6)).toEqual([false, false, false])
  })
})

describe('ch03 帶入手算：(b) 隨機出題（20 個 seed）有限、且等於測試內的獨立重算', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：randomValues 可重現、通過 validate、答案與獨立重算一致、每一步與說明的 TeX 可解析`, () => {
      expect(randomValues(def, 3)).toEqual(randomValues(def, 3))
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(def, seed)
        seen.add(JSON.stringify(v))
        expect(def.validate?.(v) ?? null, `${def.id} seed ${seed}`).toBeNull()
        const sol = def.solve(v)
        const want = RECOMPUTE[def.id](v)
        expect(sol.results.length).toBe(want.length)
        sol.results.forEach((r, i) => {
          expect(Number.isFinite(r.value), `${def.id} seed ${seed} ${r.symbol}`).toBe(true)
          // HC-03.8 的 a.s. 常數以 scipy 的 9 位數為準；Φ 以 Simpson 積分為準
          const rel = def.id === 'HC-03.8' && i === 2 ? 1e-8 : def.id === 'HC-03.7' && i === 1 ? 1e-7 : 1e-9
          expect(closeRel(r.value, want[i], rel), `${def.id} seed ${seed} ${JSON.stringify(v)} ${r.symbol}: ${r.value} vs ${want[i]}`).toBe(true)
          expect(() => katex.renderToString(`${r.symbol} = 1${r.unit ? `\\ ${r.unit}` : ''}`, { throwOnError: true, strict: 'ignore' })).not.toThrow()
          if (r.label) expect(r.label, `${def.id} result label 不放 $（會進 aria-label）`).not.toMatch(/\$/)
        })
        expect(sol.steps.length).toBeGreaterThanOrEqual(7)
        for (const st of sol.steps) {
          expect(() => katex.renderToString(st.tex, { throwOnError: true, displayMode: true, strict: 'ignore' }), `${def.id} seed ${seed}: ${st.tex}`).not.toThrow()
          expect(st.tex).not.toMatch(/NaN|undefined|Infinity/)
          expect(st.why.length).toBeGreaterThan(0)
          expectMathTextOk(st.why, `${def.id} why`)
        }
        for (const n of sol.notes ?? []) {
          expectMathTextOk(n, `${def.id} note`)
          expect(n).not.toMatch(/NaN|undefined/)
        }
      }
      expect(seen.size, `${def.id}：20 個 seed 應抽出多組不同的題目`).toBeGreaterThanOrEqual(8)
    })
  }

  it('預設值也與獨立重算一致（8 題）', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const want = RECOMPUTE[def.id](v)
      def.solve(v).results.forEach((r, i) => {
        const rel = def.id === 'HC-03.8' && i === 2 ? 1e-8 : def.id === 'HC-03.7' && i === 1 ? 1e-7 : 1e-9
        expect(closeRel(r.value, want[i], rel), `${def.id} ${r.symbol}: ${r.value} vs ${want[i]}`).toBe(true)
      })
    }
  })
})

describe('ch03 帶入手算：(c) validate 擋掉模型不適用的輸入，並說明原因', () => {
  const reject = (id: string, patch: Record<string, number>, pattern: RegExp) => {
    const def = handcalcById(id)
    const msg = def.validate?.({ ...defaultValues(def), ...patch }) ?? null
    expect(msg, `${id} ${JSON.stringify(patch)} 應被拒絕`).not.toBeNull()
    expect(msg!).toMatch(pattern)
    expectMathTextOk(msg!, `${id} validate`)
    // 訊息經 mathText 顯示時沒有 KaTeX 錯誤，也沒有殘留的 $
    const { container, unmount } = render(<MathText>{msg!}</MathText>)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    container.querySelectorAll('.katex').forEach((k) => k.remove())
    expect(container.textContent).not.toMatch(/\$/)
    unmount()
  }

  it('T02: 固定 x 的兩題：x = 0（不可辨識）、p = 0（一步到位）、|p| ≥ 1（邊界／發散／μ < 0）、ε 不在 (0, 1)', () => {
    reject('HC-03.1', { x: 0 }, /不可辨識/)
    reject('HC-03.2', { x: 0 }, /不可辨識/)
    reject('HC-03.2', { mu: 0.25 }, /一步到位/)
    reject('HC-03.2', { mu: 0.5 }, /誤差不會縮小/) // p = −1（邊界）
    reject('HC-03.2', { mu: 0.6 }, /誤差不會縮小/) // p = −1.4
    reject('HC-03.2', { mu: -0.01 }, /誤差不會縮小/) // p = 1.04（極性反轉）
    reject('HC-03.2', { mu: 0 }, /誤差不會縮小/) // p = 1
    for (const eps of [0, 1, 2]) reject('HC-03.2', { eps }, /必須在/)
  })

  it('T03: 動差與步長：P_x = 0、M_4 < P_x²（κ < 1 不存在）、μ ≤ 0、μ ≥ μ_MS（穩態 MSD 無限大）', () => {
    reject('HC-03.3', { x1: 0, x2: 0, x3: 0, x4: 0, x5: 0 }, /不可辨識/)
    reject('HC-03.4', { Px: 0 }, /不可辨識/)
    reject('HC-03.4', { Px: 2, M4: 3 }, /不存在這樣的分布/)
    reject('HC-03.5', { Px: 0 }, /不可辨識/)
    reject('HC-03.5', { Px: 4, M4: 15 }, /不存在這樣的分布/)
    reject('HC-03.5', { mu: 0 }, /不會有穩態/)
    reject('HC-03.5', { mu: -0.1 }, /不會有穩態/)
    reject('HC-03.5', { mu: 0.5 }, /穩態 MSD 是無限大/) // μ = μ_MS = 2·4/16
    reject('HC-03.5', { mu: 1 }, /穩態 MSD 是無限大/)
    reject('HC-03.6', { A: 0 }, /不可辨識/)
    reject('HC-03.6', { A: 2, mu: 0.25 }, /deadbeat/) // 1 − μA² = 0 → λ = −∞
    reject('HC-03.8', { sigma: 0 }, /不可辨識/)
    reject('HC-03.8', { sigma: -1 }, /不可辨識/)
    reject('HC-03.8', { mu: 0 }, /三種意義下都不收斂/)
    reject('HC-03.8', { mu: -0.5 }, /三種意義下都不收斂/)
  })

  it('CLT 題：ε 不在 (0, 1)、s = 0（所有路徑相同）、λ ≥ 0（典型路徑不收斂）', () => {
    for (const eps of [0, 1]) reject('HC-03.7', { eps }, /必須在/)
    reject('HC-03.7', { s: 0 }, /不需要 CLT/)
    reject('HC-03.7', { lam: 0 }, /不存在/)
    reject('HC-03.7', { lam: 0.1 }, /不存在/)
  })

  it('預設值與幾個邊界內的合法值都不會被擋', () => {
    for (const def of HANDCALCS) expect(def.validate?.(defaultValues(def)) ?? null, def.id).toBeNull()
    expect(handcalcById('HC-03.2').validate!({ x: 2, mu: 0.49, eps: 0.5 })).toBeNull()
    expect(handcalcById('HC-03.4').validate!({ Px: 2, M4: 4, mu: 5, d0: 0, n: 1 })).toBeNull() // κ = 1（|x| 常數）；μ 很大只是發散
    expect(handcalcById('HC-03.5').validate!({ Px: 4, M4: 16, mu: 0.49, sv: 0 })).toBeNull()
    expect(handcalcById('HC-03.6').validate!({ A: -3, K: 2, mu: -0.1 })).toBeNull()
  })
})

describe('ch03 帶入手算：(d) HandCalc 元件渲染', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：預設值渲染出每一步、沒有 KaTeX 錯誤、沒有殘留的 $`, () => {
      const sol = def.solve(defaultValues(def))
      const { container } = render(<HandCalc def={def} />)
      expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(sol.steps.length).toBeGreaterThanOrEqual(1)
      expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
      expect(container.querySelector(`#handcalc-${def.id.replace('.', '\\.')}`)).not.toBeNull()
      const clone = container.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.katex').forEach((k) => k.remove())
      expect(clone.textContent).not.toMatch(/\$|NaN|undefined/)
    })
  }

  it('T02: HC-03.2 把 μ 改成 0.25（p = 0）時不顯示步驟，改顯示原因；改回合法值後恢復', () => {
    const def = handcalcById('HC-03.2')
    const { container } = render(<HandCalc def={def} />)
    const mu = container.querySelector('input[aria-label="學習率（mu）"]') as HTMLInputElement
    expect(mu.value).toBe('0.1')
    expect(container.textContent).toContain('14')
    fireEvent.change(mu, { target: { value: '0.25' } })
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    expect(container.querySelector('.callout-warn')?.textContent).toMatch(/一步到位/)
    expect(container.querySelector('.katex-error')).toBeNull()
    fireEvent.change(mu, { target: { value: '0.4' } })
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.querySelector('.callout-warn')).toBeNull()
  })

  it('HC-03.6「自己算算看」：填入範例答案（0.55、2.125、0.1253、1.1335）全部判為正確；填錯會指出', () => {
    const def = handcalcById('HC-03.6')
    const { container } = render(<HandCalc def={def} initialMode="practice" />)
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('.c-handcalc-answer input'))
    expect(inputs).toHaveLength(4)
    ;['0.55', '2.125', '0.1253', '1.2'].forEach((val, i) => fireEvent.change(inputs[i], { target: { value: val } }))
    const check = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '對答案')!
    fireEvent.click(check)
    expect(container.querySelectorAll('.c-handcalc-verdict.ok')).toHaveLength(3)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad')).toHaveLength(1) // e^λ = 1.1335，填 1.2 不對
  })
})

describe('ch03 模型的小工具（帶入手算與頁面共用；core:timeConstant / msdClosedForm / cltStepsBelowStart）', () => {
  it('T02: timeConstant / stepsToReach：p=0 一步到位、|p| ≥ 1 回傳 NaN、±p 相同', () => {
    expect(timeConstant(0)).toBe(0)
    expect(stepsToReach(0)).toBe(1)
    for (const p of [1, -1, 1.04, -1.4, Infinity, NaN]) {
      expect(timeConstant(p)).toBeNaN()
      expect(stepsToReach(p)).toBeNaN()
    }
    expect(timeConstant(-0.6)).toBe(timeConstant(0.6))
    expect(timeConstant(0.6)).toBeCloseTo(-1 / Math.log(0.6), 14)
    expect(stepsToReach(-0.6, 1e-3)).toBe(14)
    expect(stepsToReach(0.2, 0.9)).toBe(1) // 至少 1 步
    // e^{−n/τ} = |p|ⁿ
    expect(Math.exp(-5 / timeConstant(0.8))).toBeCloseTo(0.8 ** 5, 12)
  })

  it('T03: msdAfterSteps / steadyStateMsd 與 analyticTrajectory 完全同式（Gaussian、Uniform、±1、固定 x、清單；有無雜訊；g = 1 的極限）', () => {
    const dists: XDist[] = [GAUSS, { kind: 'gaussian', sigma: 0.5 }, { kind: 'uniform', halfWidth: Math.sqrt(3) }, { kind: 'pm_one', amplitude: 1 }, { kind: 'fixed', value: 2 }, SPARSE]
    for (const dist of dists) {
      const m = xMoments(dist)
      for (const mu of [0.05, 0.1, 0.3]) {
        for (const noiseSigma of [0, 0.1, 1]) {
          const ns = [1, 2, 5, 20]
          const tr = analyticTrajectory({ mu, dist, delta0: 1.5, noiseSigma }, ns)
          ns.forEach((n, i) => {
            const got = msdAfterSteps(mu, m.Px, m.M4, n, 1.5, noiseSigma)
            const want = 10 ** (2 * tr.log10Rms[i])
            // analyticTrajectory 經過 log10 來回一次，容許相對 1e−12
            expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-12 * Math.max(want, 1e-300))
          })
          const ss = steadyStateMsd(mu, m.Px, m.M4, noiseSigma)
          expect(ss.msd).toBe(tr.msdInf)
          expect(ss.mse).toBe(tr.mseInf)
        }
      }
    }
    // g ≥ 1：有雜訊時穩態 MSD 無限大；無雜訊時為 0（沒有注入）
    expect(steadyStateMsd(0.8, 1, 3, 0.1).msd).toBe(Infinity)
    expect(steadyStateMsd(0.8, 1, 3, 0).msd).toBe(0)
    // g = 1（Gaussian μ = 2/3 的精確邊界用有理數湊：P_x = 1、M_4 = 2、μ = 1）：E[δ_n²] = δ₀² + n·μ²P_xσ_v²
    expect(meanSquareFactor(1, 1, 2)).toBe(1)
    expect(msdAfterSteps(1, 1, 2, 10, 2, 0.5)).toBeCloseTo(4 + 10 * 0.25, 12)
  })

  it('T03: cltStepsBelowStart = (z_p·s/λ)²；λ ≥ 0 回傳 NaN；與 cltLog10Quantile 的變號點一致', () => {
    const lam = lyapunovExponent(2.3, GAUSS)
    const s = Math.sqrt(logFactorVariance(2.3, GAUSS))
    const n90 = cltStepsBelowStart(lam, s, 0.9)
    expect(n90).toBeCloseTo(((Z90 * s) / lam) ** 2, 6)
    expect(cltLog10Quantile(lam, s, Math.ceil(n90), 0.9)).toBeLessThan(0)
    expect(cltLog10Quantile(lam, s, Math.floor(n90), 0.9)).toBeGreaterThan(0)
    expect(cltStepsBelowStart(0, 1)).toBeNaN()
    expect(cltStepsBelowStart(0.1, 1)).toBeNaN()
    expect(cltStepsBelowStart(-Infinity, 1)).toBeNaN()
    expect(cltStepsBelowStart(-0.1, 0)).toBe(0)
  })

  it('poleLabelTex：六種行為的標籤都轉成 $…$、可由 KaTeX 解析，且分類與 lms.ts 一致', () => {
    const cases: [number, PoleBehaviour, RegExp][] = [
      [0.6, 'monotone', /^\$0 < p < 1\$：/],
      [-0.6, 'oscillating', /^\$-1 < p < 0\$：/],
      [0, 'deadbeat', /^\$p = 0\$：/],
      [-1, 'boundary', /^\$\|p\| = 1\$：/],
      [1.04, 'divergent', /^\$\|p\| > 1\$：/],
      [1, 'frozen', /^\$p = 1\$：\$\\mu = 0\$/],
    ]
    for (const [p, kind, re] of cases) {
      expect(classifyPole(p)).toBe(kind)
      const label = poleLabelTex(p)
      expect(label).toMatch(re)
      expect(label).not.toMatch(/[−μ]/)
      expectMathTextOk(label, `poleLabelTex(${p})`)
    }
  })
})

/* ───────────── 獨立驗算後補上的回歸測試：讀者打「自己的數字」時，畫面上的每一步仍然算得出來 ───────────── */

const xs5 = (a: number[], mu: number) => ({ x1: a[0], x2: a[1], x3: a[2], x4: a[3], x5: a[4], mu })

/**
 * 讀者真的會打的「不漂亮」數字：很小的 μ（10⁻⁶、2⁻²⁰）、很小的 σ／σ_v（科學記號當底數）、很多位的小數、
 * 相減後幾乎抵銷、比值恰為整數、負的 μ……獨立驗算（python）時，舊版在這些輸入下出現過
 * KaTeX double superscript、「ln 1 = −10⁻⁶」、「⌈2⌉ = 3」、「0 × 0.2 = −5.6×10⁻¹⁷」等問題。
 */
const UGLY: Record<string, Record<string, number>[]> = {
  'HC-03.1': [
    { a: 0.3, w0: 0.1, x: 10, mu: 0.01 },
    { a: 3, w0: 1, x: 0.00001, mu: 0.1 },
    { a: 1.23456789, w0: -0.987654, x: 1.5, mu: 0.123456 },
    { a: 3, w0: 1, x: 2, mu: -0.1 },
    { a: 3, w0: 3, x: 2, mu: 0.1 },
    { a: -3, w0: 1, x: -2, mu: 0.3 },
    { a: 3, w0: 1, x: 2, mu: 0.000001 },
    { a: 100, w0: -100, x: 10, mu: 5 },
    { a: 0.7, w0: 0.1, x: 5, mu: 0.04 },
    { a: 3, w0: 1, x: 2, mu: 0 },
    { a: 0.1, w0: 0.3, x: 1, mu: 1 },
    { a: 100, w0: 99.999, x: 3, mu: 0.1 },
    { a: 2.5, w0: -7.25, x: -0.3, mu: 4.4 },
    { a: 0.00001, w0: 0.00003, x: 2, mu: 0.2 },
    { a: 3, w0: 1, x: 2, mu: 0.2499999 },
    { a: 3, w0: 1, x: 3, mu: 0.111111 },
  ],
  'HC-03.2': [
    { x: 1, mu: 0.9, eps: 0.001 },
    { x: 1, mu: 0.5, eps: 0.125 },
    { x: 1, mu: 0.5, eps: 0.5 },
    { x: 1, mu: 0.000001, eps: 0.001 },
    { x: 1, mu: 0.0001, eps: 0.5 },
    { x: 2, mu: 0.49, eps: 0.999 },
    { x: 1, mu: 1.9, eps: 0.01 },
    { x: 0.001, mu: 5, eps: 0.001 },
    { x: 1, mu: 0.99, eps: 0.0001 },
    { x: 1, mu: 0.8, eps: 0.008 },
    { x: 1, mu: 0.999999, eps: 0.000001 },
    { x: 1, mu: 1.5, eps: 0.03125 },
    { x: 2, mu: 0.3, eps: 0.0016 },
    { x: 1, mu: 0.6, eps: 0.064 },
    { x: 1, mu: 0.7, eps: 0.0081 },
    { x: 1, mu: 0.00000095367431640625, eps: 0.001 },
    { x: 1, mu: 0.0009765625, eps: 0.01 },
    { x: 3, mu: 0.0123, eps: 0.37 },
    { x: 0.5, mu: 0.01, eps: 0.000001 },
    { x: 1, mu: 0.1, eps: 0.729 },
  ],
  'HC-03.3': [
    xs5([0.00001, 0, 0, 0, 0], 0.1),
    xs5([1.5, -2.5, 0.25, 3.75, -0.5], 0.123),
    xs5([100, 100, 100, 100, 100], 100),
    xs5([1, 1, 1, 1, 1], 2),
    xs5([-2, -1, 0, 1, 2], -0.1),
    xs5([-2, -1, 0, 1, 2], 0),
    xs5([12.345, -6.789, 0.001, 50.5, -99.99], 0.0001),
    xs5([-2, -1, 0, 1, 2], 1.5),
    xs5([0.1, 0.2, 0.3, 0.1, 0.2], 0.00002),
    xs5([1, 1, 1, 1, 1], 1),
    xs5([0.001, 0.002, 0, 0, 0], 99.5),
  ],
  'HC-03.4': [
    { Px: 1, M4: 3, mu: 0.00001, d0: 1, n: 5 },
    { Px: 1, M4: 3, mu: 0.666667, d0: 1, n: 5 },
    { Px: 0.0001, M4: 0.00000003, mu: 100, d0: 1, n: 3 },
    { Px: 1, M4: 1, mu: 1, d0: 1, n: 3 },
    { Px: 1, M4: 3, mu: 0.5, d0: 0.00001, n: 200 },
    { Px: 1, M4: 3, mu: -0.5, d0: 1, n: 2 },
    { Px: 1.2345, M4: 5.4321, mu: 0.123, d0: -0.5, n: 7 },
    { Px: 1, M4: 3, mu: 0, d0: 1, n: 5 },
    { Px: 0.5, M4: 0.75, mu: 1.9, d0: 3, n: 200 },
    { Px: 1, M4: 1.00000001, mu: 1, d0: 1, n: 2 },
    { Px: 1, M4: 3, mu: 0.000001, d0: 1, n: 200 },
    { Px: 1, M4: 3, mu: 0.0123456789, d0: 0.333, n: 150 },
    { Px: 1, M4: 3, mu: 0.5, d0: 0, n: 5 },
  ],
  'HC-03.5': [
    { Px: 4, M4: 16, mu: 0.1, sv: 0.00001 },
    { Px: 1, M4: 3, mu: 0.000001, sv: 1 },
    { Px: 1, M4: 3, mu: 0.3, sv: 0.1 },
    { Px: 1, M4: 3, mu: 0.3, sv: 0 },
    { Px: 0.000001, M4: 0.000000000003, mu: 100, sv: 0.001 },
    { Px: 2.5, M4: 19.123, mu: 0.0123, sv: 0.0456 },
    { Px: 4, M4: 16, mu: 0.4999999, sv: 2 },
    { Px: 1000000, M4: 3000000000000, mu: 0.0000003, sv: 1000 },
  ],
  'HC-03.6': [
    { A: 0.001, K: 10, mu: 0.5 },
    { A: 3, K: 10, mu: 0.00001 },
    { A: -3, K: 1000, mu: 0.5 },
    { A: 3, K: 2, mu: -0.1 },
    { A: 100, K: 2, mu: 100 },
    { A: 1, K: 2, mu: 2 },
    { A: 1.5, K: 7, mu: 0.3333 },
    { A: 3, K: 10, mu: 0.25 },
    { A: 1, K: 3, mu: 0.999999 },
    { A: 2, K: 4, mu: 0.5 },
    { A: 0.02, K: 64, mu: 2500.5 },
    { A: 1, K: 2, mu: 0.000001 },
  ],
  'HC-03.7': [
    { lam: -0.00001, s: 1, n: 1000000, eps: 0.001 },
    { lam: -100, s: 0.01, n: 1, eps: 0.5 },
    { lam: -0.4657, s: 0.9285, n: 20, eps: 0.001 },
    { lam: -0.03243, s: 1.253, n: 200, eps: 0.001 },
    { lam: -0.1, s: 1, n: 7, eps: 0.999 },
    { lam: -0.123456, s: 0.00001, n: 3, eps: 0.5 },
    { lam: -0.128155, s: 1, n: 5, eps: 0.5 },
    { lam: -0.05, s: 1, n: 25, eps: 0.001 },
    { lam: -5, s: 0.1, n: 1000, eps: 0.5 },
    { lam: -0.0001, s: 5, n: 4, eps: 0.000001 },
    { lam: -0.23025850929940458, s: 1, n: 10, eps: 0.1 },
    { lam: -0.3, s: 0.7, n: 12, eps: 0.02 },
  ],
  'HC-03.8': [
    { sigma: 0.00002, mu: 0.3, N: 4096 },
    { sigma: 0.000000000002, mu: 1000, N: 1 },
    { sigma: 1, mu: 0.666667, N: 1 },
    { sigma: 1, mu: 2.4212, N: 8 },
    { sigma: 0.5, mu: 8, N: 3 },
    { sigma: 1000, mu: 0.000001, N: 10000000 },
    { sigma: 1.5, mu: 0.1234, N: 7 },
    { sigma: 1, mu: 1000, N: 1 },
    { sigma: 3, mu: 0.05, N: 123457 },
    { sigma: 0.1, mu: 33.3, N: 1024 },
    { sigma: 0.37, mu: 1.5, N: 1000 },
  ],
}

/** 一組輸入的完整檢查：嚴格 KaTeX、每個等號重新求值、步驟確實走到每一個答案 */
function expectHandDoable(id: string, v: Record<string, number>) {
  const def = handcalcById(id)
  const where = `${id} ${JSON.stringify(v)}`
  expect(def.validate?.(v) ?? null, where).toBeNull()
  const sol = def.solve(v)
  const finals: number[] = []
  sol.steps.forEach((st, k) => {
    // strict: 'error'——double superscript 之類的排版錯誤一律視為失敗
    expect(() => katex.renderToString(st.tex, { throwOnError: true, displayMode: true, strict: 'error' }), `${where} 第 ${k + 1} 步：${st.tex}`).not.toThrow()
    expect(st.tex, where).not.toMatch(/NaN|undefined|Infinity/)
    const { values, links } = chainLinks(st.tex, phiBySimpson)
    expect(values.length, `${where} 第 ${k + 1} 步沒有代入數字：${st.tex}`).toBeGreaterThanOrEqual(1)
    expect(values.every((x) => Number.isFinite(x)), `${where} 第 ${k + 1} 步有非有限值：${st.tex}`).toBe(true)
    for (const l of links) expect(l.ok, `${where} 第 ${k + 1} 步：${l.from} = ${l.a}，但畫面寫 ${l.to}（= ${l.b}）\n${st.tex}`).toBe(true)
    finals.push(...values)
    expectMathTextOk(st.why, `${where} why`)
  })
  // 每一個答案都是某一步算出來的數（顯示的四捨五入範圍內）
  for (const r of sol.results) {
    expect(Number.isFinite(r.value), `${where} ${r.symbol}`).toBe(true)
    const hit = finals.some((f) => Math.abs(f - r.value) <= Math.max(2e-4 * Math.abs(r.value), 1e-4 * Math.abs(f), 1e-300) || (Math.abs(r.value) < 1 && Math.abs(f - r.value) <= 6e-5))
    expect(hit, `${where}：答案 ${r.symbol} = ${r.value} 不是任何一步的結果`).toBe(true)
  }
  for (const n of sol.notes ?? []) {
    expectMathTextOk(n, `${where} note`)
    expect(n, where).not.toMatch(/NaN|undefined/)
  }
  return sol
}

describe('ch03 帶入手算：(e) 每一步的 TeX 重新求值——畫面上的數字自己算得出下一個等號', () => {
  it('texEval 本身：四則、分數、次方、√、ln、e^x、Φ、⌈⌉、科學記號；符號段不求值；double superscript 會丟錯', () => {
    const R = String.raw
    expect(evalTex(R`1-0.1\times4`)).toBeCloseTo(0.6, 12)
    expect(evalTex(R`(-1.4)\times(-5.6)`)).toBeCloseTo(7.84, 12)
    expect(evalTex(R`\frac{-1}{-0.51083}\ \text{samples}`)).toBeCloseTo(1 / 0.51083, 12)
    expect(evalTex(R`\lceil 13.523\rceil`)).toBe(14)
    expect(evalTex(R`\sqrt{5.2083\times10^{-5}}`)).toBeCloseTo(Math.sqrt(5.2083e-5), 15)
    expect(evalTex(R`\tfrac12\times\ln 2.125`)).toBeCloseTo(0.5 * Math.log(2.125), 12)
    expect(evalTex(R`\ln(5\times10^{11})`)).toBeCloseTo(Math.log(5e11), 10)
    expect(evalTex(R`e^{0.12528}`)).toBeCloseTo(Math.exp(0.12528), 12)
    expect(evalTex(R`(5\times10^{-5})^2`)).toBeCloseTo(2.5e-9, 20)
    expect(evalTex(R`\Phi(0.96)`, phiBySimpson)).toBeCloseTo(0.8315, 4)
    expect(evalTex(R`\Big\lceil\Big(\frac{1.2816\times1.206}{-0.1162}\Big)^{2}\Big\rceil`)).toBe(177)
    expect(() => evalTex(R`10^{-5}^2`)).toThrow(/double superscript/)
    expect(isSymbolic(R`1-\mu x^2`)).toBe(true)
    expect(isSymbolic(R`|-0.6|`)).toBe(true)
    expect(isSymbolic(R`e^{-0.05}`)).toBe(false)
    expect(splitTop(R`a=\frac{b=c}{d}=e`)).toEqual(['a', R`\frac{b=c}{d}`, 'e'])
    // 算錯的鏈會被抓到；四捨五入範圍內的不會
    expect(chainLinks(R`p=1-\mu x^2=1-0.1\times4=1-0.4=0.6`, phiBySimpson).links.every((l) => l.ok)).toBe(true)
    expect(chainLinks(R`p=1-\mu x^2=1-0.1\times4=1-0.4=0.7`, phiBySimpson).links.every((l) => l.ok)).toBe(false)
    expect(chainLinks(R`\ln|p|=\ln 1=-10^{-6}`, phiBySimpson).links.every((l) => l.ok)).toBe(false)
    expect(chainLinks(R`x_i^2:\quad (-2)^2,\ 3^2\;=\;4,\ 9`, phiBySimpson).links.map((l) => l.ok)).toEqual([true, true])
    expect(chainLinks(R`\tau=\frac{-1}{\ln|p|}=\frac{-1}{-0.51083}=1.9576\ \text{samples}`, phiBySimpson).links.every((l) => l.ok)).toBe(true)
  })

  for (const def of HANDCALCS) {
    it(`${def.id}：預設值、20 個隨機題、${UGLY[def.id].length} 組「自己的數字」——每個等號都對得起來，沒有 KaTeX 錯誤，步驟走到每一個答案`, () => {
      expectHandDoable(def.id, defaultValues(def))
      for (let seed = 1; seed <= 20; seed++) expectHandDoable(def.id, randomValues(def, seed))
      for (const v of UGLY[def.id]) expectHandDoable(def.id, v)
    })
  }

  it('每個等號只做一種運算：1 − μx² 這類「先乘再減」的步驟都把中間結果寫出來', () => {
    const tex = (id: string, k: number) => handcalcById(id).solve(defaultValues(handcalcById(id))).steps[k].tex
    expect(tex('HC-03.1', 3)).toBe(String.raw`p=1-\mu x^2=1-0.1\times4=1-0.4=0.6`)
    expect(tex('HC-03.2', 1)).toBe(String.raw`p=1-\mu x^2=1-0.1\times4=1-0.4=0.6`)
    expect(tex('HC-03.3', 7)).toBe(String.raw`1-\mu P_x=1-0.25\times2=1-0.5=0.5`)
    expect(tex('HC-03.4', 0)).toBe(String.raw`\mu_\text{MS}=\frac{2P_x}{M_4}=\frac{2\times1}{3}=\frac{2}{3}=0.66667`)
    expect(tex('HC-03.5', 3)).toBe(String.raw`2P_x-\mu M_4=2\times4-1.6=8-1.6=6.4`)
    expect(tex('HC-03.5', 6)).toBe(String.raw`E[e^2]=P_x\,\text{MSD}_\infty+\sigma_v^2=4\times0.0625+1=0.25+1=1.25`)
    expect(tex('HC-03.6', 7)).toBe(String.raw`f_A=1-\mu A^2=1-0.5\times9=1-4.5=-3.5`)
    expect(tex('HC-03.7', 7)).toBe(String.raw`\frac{z_{0.9}\,s}{\lambda}=\frac{1.2816\times1.206}{-0.1162}=\frac{1.54555}{-0.1162}=-13.3008`)
    expect(tex('HC-03.8', 10)).toBe(String.raw`\frac{M_4-P_x^2}{N}=\frac{3-1}{4096}=\frac{2}{4096}=0.00048828125`)
    expect(tex('HC-03.8', 12)).toBe(String.raw`\mu_{\text{MS},N}=\frac{2P_x}{E[S^2]}=\frac{2\times1}{1.00048828125}=\frac{2}{1.00048828125}=1.99902`)
  })

  it('T02: HC-03.2 比值 ln ε / ln|p| 恰為整數時不多算一步（舊版顯示「⌈2⌉ = 3」）；模擬在那一步也確實到達門檻', () => {
    const cases: [number, number, number][] = [
      [0.6, 0.064, 3], // p = 0.4：0.4³ = 0.064
      [0.99, 0.0001, 2], // p = 0.01
      [0.9, 0.001, 3], // p = 0.1
      [0.5, 0.125, 3], // p = 0.5
      [0.8, 0.008, 3], // p = 0.2
      [0.7, 0.0081, 4], // p = 0.3
      [1.5, 0.03125, 5], // p = −0.5
      [0.1, 0.729, 3], // p = 0.9
    ]
    for (const [mu, eps, n] of cases) {
      const v = { x: 1, mu, eps }
      const sol = expectHandDoable('HC-03.2', v)
      expect(sol.results[2].value, JSON.stringify(v)).toBe(n)
      expect(sol.steps[7].tex, JSON.stringify(v)).toBe(String.raw`n_\varepsilon=\lceil ${n}\rceil=${n}`)
      expect(sol.notes!.join('')).toMatch(/比值恰為整數/)
      // 模擬：第 n 步的 |δ_n/δ_0| 與 ε 只差 double 的捨入誤差，少一步則明顯不夠
      const sim = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu, steps: n, x: { kind: 'fixed', value: 1 } })
      expect(Math.abs(sim.delta[n] / sim.delta[0])).toBeLessThanOrEqual(eps * (1 + 1e-9))
      expect(Math.abs(sim.delta[n - 1] / sim.delta[0])).toBeGreaterThan(eps * 1.1)
    }
    // 不是整數的比值照常無條件進位；非常接近整數時 ⌈·⌉ 裡多顯示幾位（不會出現「⌈100⌉ = 101」）
    expect(stepsToReach(0.6, 1e-3)).toBe(14)
    expect(stepsToReach(0.4, 0.064 * (1 - 1e-6))).toBe(4)
    expect(stepsToReach(0.4, 0.064 * (1 + 1e-6))).toBe(3)
    const near = handcalcById('HC-03.7').solve({ lam: -0.128155, s: 1, n: 5, eps: 0.5 })
    expect(near.results[2].value).toBe(101)
    expect(near.steps[8].tex).toContain(String.raw`\lceil 100.0002\rceil=101`)
  })

  it('很接近 1 的數取 ln：μ = 10⁻⁶ 時 p 顯示成 0.999999（不是 1），2⁻²⁰ 也看得出來；g = 1.05625 不被四捨五入成 1.0562', () => {
    const s1 = handcalcById('HC-03.2').solve({ x: 1, mu: 0.000001, eps: 0.001 })
    expect(s1.steps[1].tex).toBe(String.raw`p=1-\mu x^2=1-10^{-6}\times1=1-10^{-6}=0.999999`)
    expect(s1.steps[3].tex).toBe(String.raw`\ln|p|=\ln 0.999999=-1.0000005\times10^{-6}`) // 步數有 7 位數，所以 ln 多顯示幾位
    expect(s1.steps[7].tex).toBe(String.raw`n_\varepsilon=\lceil 6907752\rceil=6907752`)
    expect(s1.results[1].value).toBeCloseTo(999999.5, 0) // τ ≈ 1/(μx²) − 1/2
    const s2 = handcalcById('HC-03.2').solve({ x: 1, mu: 2 ** -20, eps: 0.001 })
    expect(s2.steps[2].tex).toContain('0.999999046326')
    expect(s2.steps[3].tex).not.toContain(String.raw`\ln 1=`)
    const s3 = handcalcById('HC-03.6').solve({ A: 3, K: 10, mu: 0.25 })
    expect(s3.steps[6].tex).toBe(String.raw`g=1-2\mu P_x+\mu^2M_4=1-0.45+0.50625=1.05625`)
    expect(s3.steps[10].tex).toContain(String.raw`\ln 1.05625`)
    // 相減後幾乎抵銷：運算元多顯示幾位
    const s4 = handcalcById('HC-03.5').solve({ Px: 4, M4: 16, mu: 0.4999999, sv: 2 })
    expect(s4.steps[3].tex).toBe(String.raw`2P_x-\mu M_4=2\times4-7.9999984=8-7.9999984=1.6\times10^{-6}`)
    const s5 = handcalcById('HC-03.1').solve({ a: 1.23456789, w0: -0.987654, x: 1.5, mu: 0.123456 })
    expect(s5.steps[0].tex).toBe(String.raw`\delta_0=a-w_0=1.23456789-(-0.987654)=2.22222189`)
  })

  it('科學記號當底數或 ln 的引數時加括號（舊版是 KaTeX double superscript 錯誤）；浮點殘渣顯示成 0', () => {
    const t = (id: string, v: Record<string, number>) =>
      handcalcById(id)
        .solve(v)
        .steps.map((s) => s.tex)
        .join('\n')
    expect(t('HC-03.1', { a: 3, w0: 1, x: 0.00001, mu: 0.1 })).toContain(String.raw`x^2=(10^{-5})^2=10^{-10}`)
    expect(t('HC-03.4', { Px: 1, M4: 3, mu: 0.00001, d0: 1, n: 5 })).toContain(String.raw`\mu^2M_4=(10^{-5})^2\times3=10^{-10}\times3=3\times10^{-10}`)
    expect(t('HC-03.5', { Px: 4, M4: 16, mu: 0.1, sv: 0.00001 })).toContain(String.raw`\sigma_v^2=(10^{-5})^2=10^{-10}`)
    expect(t('HC-03.8', { sigma: 0.00002, mu: 0.3, N: 4096 })).toContain(String.raw`P_x=\sigma^2=(2\times10^{-5})^2=4\times10^{-10}`)
    expect(t('HC-03.6', { A: 100, K: 2, mu: 100 })).toContain(String.raw`\ln(4.99999000001\times10^{11})`)
    expect(t('HC-03.2', { x: 1, mu: 0.999999, eps: 0.000001 })).toContain(String.raw`\ln\varepsilon=\ln(10^{-6})`)
    // 0.3 − 0.30000000000000004 = −5.6e−17：手算是 0（舊版顯示「0 × 0.2 = −5.5511×10⁻¹⁷」）
    const res = handcalcById('HC-03.1').solve({ a: 0.3, w0: 0.1, x: 10, mu: 0.01 })
    expect(res.steps[4].tex).toBe(String.raw`\delta_1=p\,\delta_0=0\times0.2=0`)
    expect(res.results.map((r) => r.value)).toEqual([0.02, 0, 0, 0.3])
    // 很小但真實的 δ₂（3.2×10⁻¹³）不可被當成殘渣
    const tiny = handcalcById('HC-03.1').solve({ a: 3, w0: 1, x: 2, mu: 0.2499999 })
    expect(tiny.results[2].value).toBeGreaterThan(3e-13)
    expect(tiny.results[2].value).toBeLessThan(3.3e-13)
  })

  it('T01: HC-03.1 的 δ₂、w₂ 就是 LMS 程式（runScalarLms）實際迭代兩步的結果：預設值、20 個隨機題與「自己的數字」都只差 double 的捨入誤差', () => {
    const def = handcalcById('HC-03.1')
    const inputs = [defaultValues(def), ...Array.from({ length: 20 }, (_, i) => randomValues(def, i + 1)), ...UGLY['HC-03.1']]
    for (const v of inputs) {
      const sim = runScalarLms({ variant: 'conventional', a: v.a, w0: v.w0, mu: v.mu, steps: 2, x: { kind: 'fixed', value: v.x } })
      const [, p, d2, w2] = def.solve(v).results.map((r) => r.value)
      const scale = Math.max(Math.abs(v.a), Math.abs(sim.w[1]), Math.abs(sim.w[2]), Math.abs(sim.delta[2]))
      expect(Math.abs(d2 - sim.delta[2]), JSON.stringify(v)).toBeLessThanOrEqual(1e-12 * scale)
      expect(Math.abs(w2 - sim.w[2]), JSON.stringify(v)).toBeLessThanOrEqual(1e-12 * scale)
      expect(Math.abs(p - fixedXPole(v.mu, v.x)), JSON.stringify(v)).toBeLessThanOrEqual(1e-12)
      // δ = a − w（勘誤 E39）：w₂ + δ₂ = a
      expect(Math.abs(w2 + d2 - v.a), JSON.stringify(v)).toBeLessThanOrEqual(1e-12 * scale)
    }
  })

  it('T03: HC-03.4／HC-03.8 中間結果超出 double 範圍時說明原因，不顯示 ∞ 或 NaN', () => {
    const msg = handcalcById('HC-03.4').validate!({ Px: 1000000, M4: 1000000000000, mu: 100, d0: 1000, n: 200 })
    expect(msg).toMatch(/超出計算機與 double 能表示的範圍/)
    expectMathTextOk(msg!, 'HC-03.4 range')
    expect(handcalcById('HC-03.4').validate!({ Px: 1, M4: 3, mu: 0.3, d0: 1e-200, n: 200 })).toMatch(/超出/) // 下溢成 0
    expect(handcalcById('HC-03.4').validate!({ Px: 1, M4: 1, mu: 1, d0: 1, n: 3 })).toBeNull() // g 恰為 0：答案就是 0，不是下溢
    expect(handcalcById('HC-03.4').validate!({ Px: 1, M4: 3, mu: 0.5, d0: 0, n: 5 })).toBeNull()
    expect(handcalcById('HC-03.8').validate!({ sigma: 1e-90, mu: 0.3, N: 4 })).toMatch(/超出/)
    expect(handcalcById('HC-03.8').validate!({ sigma: 0.000000000002, mu: 1000, N: 1 })).toBeNull()
  })

  it('HC-03.3 的說明分清楚 μ = 0、μ < 0、恰在邊界、超過邊界', () => {
    const note = (mu: number) => handcalcById('HC-03.3').solve({ x1: -2, x2: -1, x3: 0, x4: 1, x5: 2, mu }).notes![0]
    expect(note(0.25)).toMatch(/mean 收斂/)
    expect(note(0)).toMatch(/完全不更新/)
    expect(note(-0.1)).toMatch(/更新方向反了/)
    expect(note(1)).toMatch(/恰在 mean 邊界/)
    expect(note(1.5)).toMatch(/mean 發散/)
    expect(note(0.75)).toMatch(/每步變號/)
  })

  it('元件：打入 σ_v = 0.00001、σ = 0.00002 這種數字，畫面仍顯示每一步、沒有 KaTeX 錯誤', () => {
    for (const [id, label, value] of [
      ['HC-03.5', '量測雜訊的標準差（sv）', '0.00001'],
      ['HC-03.8', 'code 的標準差（sigma）', '0.00002'],
      ['HC-03.2', '學習率（mu）', '0.000001'],
    ] as const) {
      const def = handcalcById(id)
      const { container, unmount } = render(<HandCalc def={def} />)
      const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
      expect(input, `${id} ${label}`).not.toBeNull()
      fireEvent.change(input, { target: { value } })
      expect(container.querySelector('.katex-error, .c-tex-error'), id).toBeNull()
      expect(container.querySelector('.callout-warn'), id).toBeNull()
      expect(container.querySelectorAll('.c-step').length, id).toBeGreaterThanOrEqual(7)
      unmount()
    }
  })
})

describe('ch03 帶入手算：顯示用的小工具（handcalcTex.ts）', () => {
  it('tx：寫得完的小數完整顯示、寫不完的取 5 位；txP／txBase／txSq／txPow／txLn 的括號', () => {
    expect(tx(1.05625)).toBe('1.05625')
    expect(tx(0.7199999999999998)).toBe('0.72')
    expect(tx(2.2800000000000002)).toBe('2.28')
    expect(tx(2 / 3)).toBe('0.66667')
    expect(tx(2 / 3, 7)).toBe('0.6666667')
    expect(tx(2 / 4096)).toBe('0.00048828125')
    expect(tx(1e-6)).toBe('10^{-6}')
    expect(tx(0)).toBe('0')
    expect(txP(-0.4)).toBe('(-0.4)')
    expect(txP(0.4)).toBe('0.4')
    expect(txBase(2e-5)).toBe(String.raw`(2\times10^{-5})`)
    expect(txSq(-2)).toBe('(-2)^2')
    expect(txSq(1e-5)).toBe('(10^{-5})^2')
    expect(txSq(0.3)).toBe('0.3^2')
    expect(txPow(0.75, 5)).toBe('0.75^{5}')
    expect(txPow(1e-8, 2)).toBe('(10^{-8})^{2}')
    expect(txLn(0.6)).toBe(String.raw`\ln 0.6`)
    expect(txLn(5e11)).toBe(String.raw`\ln(5\times10^{11})`)
    expect(txInt(123457)).toBe('123457')
    expect(txInt(10000000)).toBe('10000000')
    for (const s of [txSq(1e-5), txPow(2e-7, 3), txLn(1e-6), `e^{${tx(-5.1e-5)}}`]) expect(() => katex.renderToString(s, { throwOnError: true, strict: 'error' })).not.toThrow()
  })

  it('snap／agree：只有 double 的捨入殘渣才歸零；sigFor／sigLn／sigPow：需要時多顯示幾位', () => {
    expect(snap(0.3 - 0.30000000000000004, 0.3, 0.30000000000000004)).toBe(0)
    expect(snap(1 - 0.01 * 100, 1, 1)).toBe(0)
    expect(snap(1e-6, 1, 0.999999)).toBe(1e-6)
    expect(agree(0.7199999999999998, 0.72, 3, 2.28)).toBe(0.72)
    expect(agree(-5.551115123125783e-17, 0, 0.3, 0.3)).toBe(0)
    expect(agree(0.73, 0.72, 3, 2.28)).toBe(0.73) // 真的不相等：保留模擬值
    expect(agree(3.2018832030189515e-13, 3.2e-13, 3, 3)).toBe(3.2e-13)
    expect(sigDigits(117.045)).toBe(6)
    expect(sigDigits(0.1)).toBe(1)
    expect(sigFor(0.6, 1, 0.4)).toBe(6)
    expect(sigFor(1.4, 1, -0.4)).toBe(5)
    expect(sigFor(0.07544, 1.2346, 1.1591)).toBe(7)
    expect(sigFor(0, 8, 8)).toBe(12)
    expect(sigForN(7, 1.000488, 1, 0.000488)).toBe(7)
    expect(sigLn(0.6)).toBe(6)
    expect(sigLn(3.5)).toBe(5)
    expect(sigLn(0.999999)).toBe(11)
    expect(sigLn(1)).toBe(5)
    expect(sigPow(5)).toBe(6)
    expect(sigPow(200)).toBe(8)
    expect(sigPow(1)).toBe(5)
    // 按顯示的位數算回去，ln 與次方都有 5 位有效數字
    for (const x of [0.999999046325684, 0.9990234375, 0.72222, 1.0112234, 0.36787944]) {
      const shown = Number(x.toPrecision(sigLn(x)))
      expect(Math.abs(Math.log(shown) / Math.log(x) - 1)).toBeLessThan(6e-5)
    }
    for (const [g, n] of [
      [0.998003112233, 200],
      [1.070123456789, 150],
      [0.7784952409123, 7],
    ]) {
      const shown = Number(g.toPrecision(sigPow(n)))
      expect(Math.abs(shown ** n / g ** n - 1)).toBeLessThan(6e-5)
    }
  })

  it('txFixed／txCeilArg：查表用的固定小數位；⌈·⌉ 裡的數顯示到「取上整等於答案」為止', () => {
    expect(txFixed(0.9575987, 4)).toBe('0.9576')
    expect(txFixed(-0.5657755, 4)).toBe('-0.5658')
    expect(txFixed(0.8308674, 4)).toBe('0.8309')
    expect(txFixed(-0.00001, 4)).toBe('0')
    expect(txFixed(10.5, 4)).toBe('10.5')
    expect(txFixed(120, 0)).toBe('120')
    expect(txFixed(100, 4)).toBe('100')
    expect(txCeilArg(13.523, 14)).toBe('13.523')
    expect(txCeilArg(3, 3)).toBe('3')
    expect(txCeilArg(2.9999999999999996, 3)).toBe('3')
    expect(txCeilArg(100.0002, 101)).toBe('100.0002')
    expect(txCeilArg(42.00004, 43)).toBe('42.00004')
    expect(txCeilArg(1.6e-8, 1)).toBe(String.raw`1.6\times10^{-8}`)
  })
})
