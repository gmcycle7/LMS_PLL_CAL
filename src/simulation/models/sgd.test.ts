import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng, erfcx, mean, median, variance } from '@/simulation/core'
import { conventionalStep, runScalarLms } from './lms'
import {
  algoStepSizes,
  batchVsSgd,
  cycleTail,
  drawNoise,
  driftCurve,
  equalSpeedVarianceRatio,
  generateData,
  gradientDescent,
  logCheckpoints,
  meanFieldAnalysis,
  meanFieldDrift,
  meanFieldInputOf,
  monteCarloCompare,
  nlmsStep,
  noiseMedian,
  noiseOps,
  predictSteadyState,
  ratioFixedPoints,
  runShared,
  runSignErrorFixedX,
  signErrorLimitCycle,
  stepSize,
  stepsToTravel,
  travelDistance,
  weightedMedian,
  xMoments,
  type CaseConfig,
  type MeanFieldInput,
  type NoiseKind,
} from './sgd'

const golden = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))

/** golden vector 比較規則：|a − e| ≤ abs + rel·|e| */
function closeTo(actual: number, expected: number, tol: { abs?: number; rel?: number }) {
  return Math.abs(actual - expected) <= (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
}

const BASE: CaseConfig = {
  a: 3,
  w0: 0,
  mu: 0.02,
  steps: 3000,
  xKind: 'gauss',
  xAmp: 1,
  noiseKind: 'gaussian',
  sigma: 0.5,
  outlierProb: 0,
  outlierSize: 0,
  tie: 'plus',
  schedule: 'constant',
  n0: 500,
  stepMatch: 'same-mu',
  huberDelta: 0.5,
  nlmsEps: 0.1,
}

const mfInput = (over: Partial<MeanFieldInput> = {}): MeanFieldInput => ({
  a: 3,
  x: { kind: 'gauss', amp: 1 },
  noise: { kind: 'gaussian', sigma: 1, outlierProb: 0, outlierSize: 0 },
  huberDelta: 1,
  nlmsEps: 0.1,
  ...over,
})

describe('sgd：Gradient Descent = LMS（固定 x、½ 成本；勘誤 E41）', () => {
  it('T01: GD on ½(y−wx)² 逐步等於 golden w_trace / e_trace，也等於 lms.ts 的 conventionalStep', () => {
    const v = golden('T01')
    const { a, w0, x, mu, steps } = v.inputs
    const gd = gradientDescent({ a, x, w0, mu, steps, cost: 'half' })
    v.expected.w_trace.forEach((e: number, n: number) => expect(closeTo(gd.w[n], e, v.tolerance)).toBe(true))
    v.expected.e_trace.forEach((e: number, n: number) => expect(closeTo(gd.e[n], e, v.tolerance)).toBe(true))
    expect(closeTo(gd.w[1], v.expected.w1, v.tolerance)).toBe(true)
    expect(closeTo(gd.w[2], v.expected.w2, v.tolerance)).toBe(true)
    // 與 LMS 逐位元一致
    let w = w0
    for (let n = 0; n < steps; n++) {
      w = conventionalStep({ w, x, y: a * x, mu }).w
      expect(gd.w[n + 1]).toBe(w)
    }
    // 切線：J(w0) = 8、J'(w0) = −8；二次項 ½J''Δ² = ½·4·0.64 = 1.28 補足切線預測 1.6 → 2.88
    expect(gd.J[0]).toBeCloseTo(8, 14)
    expect(gd.dJ[0]).toBeCloseTo(-8, 14)
    expect(gd.J[1]).toBeCloseTo(8 - 8 * 0.8 + 0.5 * 4 * 0.64, 12)
  })

  it('T01: ½ 成本的 GD 對任意 (a, x, w₀, μ) 都與 conventionalStep 逐位元相同（同一個運算順序 μ·e·x）', () => {
    const rng = createRng(20261010)
    for (let i = 0; i < 20_000; i++) {
      const a = 3 * rng.normal()
      const x = 2 * rng.normal()
      const w0 = 3 * rng.normal()
      const mu = 0.3 * rng.uniform()
      const gd = gradientDescent({ a, x, w0, mu, steps: 3, cost: 'half' })
      let w = w0
      for (let n = 0; n < 3; n++) {
        w = conventionalStep({ w, x, y: a * x, mu }).w
        expect(gd.w[n + 1]).toBe(w)
      }
      // dw = −μ·J'(w)（數學上）；J' = −e·x
      expect(gd.dJ[0]).toBe(-(gd.e[0] * x))
    }
  })

  it('T01: 用沒有 ½ 的 J₂ 當成本時，同一個 μ 的步長大 2 倍（E41），穩定界變成 1/x²', () => {
    const full = gradientDescent({ a: 3, x: 2, w0: 1, mu: 0.1, steps: 2, cost: 'full' })
    expect(full.w[1]).toBeCloseTo(1 + 2 * 0.1 * 4 * 2, 14) // 2.6
    // μ = 0.3：½J 版 pole = 1 − 0.3·4 = −0.2（收斂）；J₂ 版 pole = 1 − 2·0.3·4 = −1.4（發散）
    const h = gradientDescent({ a: 3, x: 2, w0: 1, mu: 0.3, steps: 30, cost: 'half' })
    const f = gradientDescent({ a: 3, x: 2, w0: 1, mu: 0.3, steps: 30, cost: 'full' })
    expect(Math.abs(3 - h.w[30])).toBeLessThan(1e-12)
    expect(Math.abs(3 - f.w[30])).toBeGreaterThan(1e3)
  })
})

describe('sgd：SGD 的梯度估計不偏', () => {
  it('E[e·x | w] = (a − w)E[x²] = −J′(w)（Monte Carlo，固定 seed，4σ）', () => {
    const rng = createRng(20261010)
    const xr = rng.fork('x')
    const vr = rng.fork('v')
    const a = 3
    const w = 1.2
    const N = 200_000
    const g = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const x = xr.normal()
      const y = a * x + 0.7 * vr.normal()
      g[i] = (y - w * x) * x
    }
    const m = mean(g)
    const se = Math.sqrt(variance(g) / N)
    expect(Math.abs(m - (a - w) * 1)).toBeLessThan(4 * se)
    // 梯度雜訊變異 = E[e²x²] − (E[ex])² = d²(E x⁴ − 1) + σ²E[x²] = 1.8²·2 + 0.49
    expect(variance(g)).toBeCloseTo(1.8 * 1.8 * 2 + 0.49, 1)
  })

  it('batch GD 收斂到經驗最小平方解；SGD 在其附近抖動；mini-batch 介於兩者', () => {
    const r = batchVsSgd({ a: 3, w0: 0, xSigma: 1, sigma: 1, nData: 400, mu: 0.05, epochs: 20, batch: 20, seed: 7 })
    const [b, mb, s] = r.traces
    expect(b.method).toBe('batch')
    expect(b.updates).toBe(20)
    expect(s.updates).toBe(8000)
    expect(mb.updates).toBe(400)
    expect(Math.abs(r.wLs - 3)).toBeLessThan(0.2) // 400 筆、σ=1：SE ≈ 0.05
    // batch：w_k − w_LS = (1 − μP̂)^k (w_0 − w_LS)
    const pred = r.wLs + (0 - r.wLs) * (1 - 0.05 * r.pxHat) ** 20
    expect(b.w[b.w.length - 1]).toBeCloseTo(pred, 10)
    // SGD 最後的 cost 不會低於最小值，且接近
    expect(s.cost[s.cost.length - 1]).toBeGreaterThanOrEqual(r.costMin - 1e-12)
    expect(Math.abs(s.w[s.w.length - 1] - r.wLs)).toBeLessThan(0.3)
    // 所有方法看過的樣本數相同
    expect(b.samples[b.samples.length - 1]).toBe(8000)
    expect(s.samples[s.samples.length - 1]).toBe(8000)
  })
})

describe('sgd：Sign-Error 的 limit cycle（E40 tie 慣例）', () => {
  it('a=3, x=1, μ=0.4, w0=0 ⇒ 在 2.8 與 3.2 之間跳動（解析 + 模擬）', () => {
    const lc = signErrorLimitCycle(3, 1, 0, 0.4, 'plus')
    expect(lc.h).toBeCloseTo(0.4, 15)
    expect(lc.lo).toBeCloseTo(2.8, 12)
    expect(lc.hi).toBeCloseTo(3.2, 12)
    expect(lc.mean).toBeCloseTo(3, 12)
    expect(lc.entryStep).toBe(7)
    expect(lc.exactLanding).toBe(false)
    const w = runSignErrorFixedX(3, 1, 0, 40, 0.4, { kind: 'constant', n0: 1 }, 'plus')
    for (let n = 7; n <= 40; n++) expect(Math.abs(w[n] - (n % 2 === 1 ? 2.8 : 3.2))).toBeLessThan(1e-12)
    for (let n = 7; n <= 40; n++) expect(Math.abs(3 - w[n])).toBeLessThanOrEqual(0.4 + 1e-12) // |δ| < μ|x|
  })

  it('剛好踩到 w=a 時由 sign(0) 決定（T01 參數 a=3,x=2,w0=1,μ=0.1）', () => {
    expect(signErrorLimitCycle(3, 2, 1, 0.1, 'zero')).toMatchObject({ exactLanding: true, frozen: true, lo: 3, hi: 3, entryStep: 10 })
    const plus = signErrorLimitCycle(3, 2, 1, 0.1, 'plus')
    expect(plus.lo).toBeCloseTo(3, 14)
    expect(plus.hi).toBeCloseTo(3.2, 14)
    const minus = signErrorLimitCycle(3, 2, 1, 0.1, 'minus')
    expect(minus.lo).toBeCloseTo(2.8, 14)
    expect(minus.hi).toBeCloseTo(3, 14)
    // IEEE double：1 + 10 次 0.2 = 3.0000000000000004，e 微負 ⇒ 即使 sign(0)=0 也不會凍結
    const w = runSignErrorFixedX(3, 2, 1, 30, 0.1, { kind: 'constant', n0: 1 }, 'zero')
    expect(w[10]).toBe(3.0000000000000004)
    expect(w[11]).toBeCloseTo(2.8, 12)
    expect(w[12]).toBe(w[10])
  })

  it('手算例子接著走（a=3, x=1, w0=1, μ=0.2）：精確算術第 10 步踩到 a，但 IEEE double 的 w₁₀ ≠ 3（E40）', () => {
    const ex = signErrorLimitCycle(3, 1, 1, 0.2, 'plus')
    expect(ex).toMatchObject({ exactLanding: true, entryStep: 10, frozen: false })
    expect(ex.lo).toBeCloseTo(3, 14)
    expect(ex.hi).toBeCloseTo(3.2, 14)
    const w = runSignErrorFixedX(3, 1, 1, 30, 0.2, { kind: 'constant', n0: 1 }, 'plus')
    expect(w[10]).not.toBe(3)
    expect(Math.abs(w[10] - 3)).toBeLessThan(1e-14)
    // 時間平均一般不等於 a：a + sgn(δ₀)(h/2 − ρ)。例：w₀ = 0.1 ⇒ ρ = 2.9 − 7·0.4 = 0.1，平均 3 + 0.1
    const lc = signErrorLimitCycle(3, 1, 0.1, 0.4, 'plus')
    expect(lc.entryStep).toBe(7)
    expect(lc.mean).toBeCloseTo(3 + (0.2 - 0.1), 12)
    expect(lc.lo).toBeCloseTo(2.9, 12)
    expect(lc.hi).toBeCloseTo(3.3, 12)
  })

  it('遞減步長 μ0/(1+n/n0) 讓跳動帶寬 → 0；gear-shift 有下限', () => {
    const s = { kind: 'harmonic' as const, n0: 50 }
    expect(stepSize(0.4, 0, s)).toBe(0.4)
    expect(stepSize(0.4, 50, s)).toBeCloseTo(0.2, 15)
    const w = runSignErrorFixedX(3, 1, 0, 4000, 0.4, s, 'plus')
    expect(Math.abs(3 - w[4000])).toBeLessThanOrEqual(stepSize(0.4, 3999, s) + 1e-12)
    expect(Math.abs(3 - w[4000])).toBeLessThan(0.01)
    expect(stepSize(1, 10_000, { kind: 'gear', n0: 10 })).toBeCloseTo(1 / 64, 15)
    expect(stepSize(1, 25, { kind: 'gear', n0: 10 })).toBeCloseTo(0.25, 15)
  })

  it('反面：遞減太快會停滯（Σμ_n|x| 到不了目標）', () => {
    // harmonic：N 步可走 ≈ μ0 n0 ln(1+N/n0)；μ0=0.01、n0=10、距離 3 ⇒ 需要 ≈ 10(e^{30} − 1) 步
    const sched = { kind: 'harmonic' as const, n0: 10 }
    expect(travelDistance(0.01, 1, sched, 10_000)).toBeLessThan(0.75)
    expect(stepsToTravel(3, 0.01, 1, sched, 1_000_000)).toBe(Infinity)
    // gear（無 floor 時總距離 = 2μ0n0）：此處 floor 讓它最終仍可到達，但很慢
    expect(stepsToTravel(3, 0.01, 1, { kind: 'gear', n0: 10 })).toBeGreaterThan(15_000)
    expect(stepsToTravel(3, 0.4, 1, { kind: 'constant', n0: 1 })).toBe(8)
  })

  it('stepsToTravel 的 harmonic 上界捷徑與逐步累加一致（可到達時給同一個步數；到不了時回傳 Infinity）', () => {
    const brute = (dist: number, mu0: number, absX: number, n0: number, maxSteps: number) => {
      let d = 0
      for (let n = 0; n < maxSteps; n++) {
        d += (mu0 / (1 + n / n0)) * absX
        if (d >= dist) return n + 1
      }
      return Infinity
    }
    for (const [dist, mu0, n0, M] of [
      [3, 0.4, 20, 10_000],
      [3, 0.05, 50, 200_000],
      [1, 0.01, 10, 100_000],
      [0.5, 0.01, 10, 2000],
      [3, 0.01, 10, 50_000],
    ] as const) {
      expect(stepsToTravel(dist, mu0, 1, { kind: 'harmonic', n0 }, M)).toBe(brute(dist, mu0, 1, n0, M))
    }
  })

  it('cycleTail：period-2 的時間平均只用進入週期後的「偶數個」樣本；尚未進入時 count = 0', () => {
    // a = 3、x = 1、μ = 0.4、w₀ = 0：第 7 步進入 {2.8, 3.2}
    const w = runSignErrorFixedX(3, 1, 0, 40, 0.4, { kind: 'constant', n0: 1 }, 'plus')
    const t = cycleTail(w, 7)
    expect(t.count % 2).toBe(0)
    expect(t.count).toBe(34)
    expect(t.lo).toBeCloseTo(2.8, 12)
    expect(t.hi).toBeCloseTo(3.2, 12)
    expect(t.mean).toBeCloseTo(3, 12)
    // 反面：舊做法（從 N/2 起、21 個樣本）會偏離 (lo + hi)/2 約 h/42
    let s = 0
    for (let k = 20; k <= 40; k++) s += w[k]
    expect(Math.abs(s / 21 - 3)).toBeGreaterThan(0.009)
    // 步數不夠：還沒進入週期
    const short = runSignErrorFixedX(3, 1, 0, 7, 0.4, { kind: 'constant', n0: 1 }, 'plus')
    expect(cycleTail(short, 7).count).toBe(0)
    expect(cycleTail(runSignErrorFixedX(3, 1, 0, 8, 0.4, { kind: 'constant', n0: 1 }, 'plus'), 7).count).toBe(2)
  })
})

describe('sgd：固定點 = y/x 的加權平均／加權中位數（比值觀點）', () => {
  it('(1,3),(2,7),(4,10)：LMS 57/21、Sign-Error 2.5、Sign-Sign 3、NLMS 3', () => {
    const r = ratioFixedPoints([1, 2, 4], [3, 7, 10])
    expect(r.lms).toBeCloseTo(57 / 21, 14)
    expect(r.signError).toEqual([2.5, 2.5])
    expect(r.signSign).toEqual([3, 3])
    expect(r.nlms).toBeCloseTo(3, 14)
  })
  it('y=[0,0,0,10]、x≡1：平均 2.5 vs 中位數 0（規格 §2.3）', () => {
    const r = ratioFixedPoints([1, 1, 1, 1], [0, 0, 0, 10])
    expect(r.lms).toBeCloseTo(2.5, 14)
    expect(r.signError).toEqual([0, 0])
    expect(r.signSign).toEqual([0, 0])
  })
  it('weightedMedian：剛好平分時回傳區間', () => {
    expect(weightedMedian([1, 2, 3, 4], [1, 1, 1, 1])).toEqual([2, 3])
    expect(weightedMedian([5], [0])).toEqual([NaN, NaN])
  })
})

describe('sgd：雜訊模型（封閉式期望值 vs 抽樣）', () => {
  const kinds: NoiseKind[] = ['gaussian', 'laplacian', 'impulsive', 'skewed']
  it.each(kinds)('%s：E[v]=0、E[v²]=σ²（封閉式部分動差與抽樣一致）', (kind) => {
    const n = { kind, sigma: 0.7, outlierProb: 0, outlierSize: 0 }
    const ops = noiseOps(n)
    expect(ops.pm1(-Infinity, Infinity)).toBeCloseTo(0, 12)
    expect(ops.pm2(-Infinity, Infinity)).toBeCloseTo(0.49, 12)
    expect(ops.prob(-Infinity, Infinity)).toBeCloseTo(1, 12)
    const rng = createRng(11)
    const s = Float64Array.from({ length: 200_000 }, () => drawNoise(kind, 0.7, rng))
    expect(Math.abs(mean(s))).toBeLessThan(4 * Math.sqrt(0.49 / s.length) * (kind === 'impulsive' ? 1 : 1))
    expect(variance(s)).toBeCloseTo(0.49, 1)
    // 中位數（skewed：σ(ln2 − 1)）
    expect(Math.abs(median(s) - noiseMedian(n))).toBeLessThan(0.01)
  })
  it('skewed 的中位數 = σ(ln 2 − 1) ≈ −0.307σ；有 outlier 時 E[v] = p·s', () => {
    expect(noiseMedian({ kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 })).toBeCloseTo(Math.LN2 - 1, 10)
    const ops = noiseOps({ kind: 'gaussian', sigma: 1, outlierProb: 0.1, outlierSize: 5 })
    expect(ops.mean).toBeCloseTo(0.5, 15)
    expect(ops.meanSquare).toBeCloseTo(1 + 0.1 * 25, 15)
  })
})

describe('sgd：mean-field 固定點與線性化', () => {
  it('對稱雜訊（x 與 v 獨立）：五種演算法的 w* 都等於 a', () => {
    for (const kind of ['gaussian', 'laplacian', 'impulsive'] as NoiseKind[]) {
      for (const xk of ['gauss', 'uniformPos', 'const', 'bpsk'] as const) {
        const inp = mfInput({ x: { kind: xk, amp: 1 }, noise: { kind, sigma: 1, outlierProb: 0, outlierSize: 0 } })
        for (const algo of ['lms', 'sign_error', 'sign_sign', 'huber', 'nlms'] as const) {
          expect(meanFieldAnalysis(algo, inp).wStar).toBeCloseTo(3, 9)
        }
      }
    }
  })

  it('Gaussian 雜訊：K_SE = 2f_v(0)E[x²] = √(2/π)/σ·E[x²]（= ch05 的 K_q·E[x²]）', () => {
    const mf = meanFieldAnalysis('sign_error', mfInput({ noise: { kind: 'gaussian', sigma: 100, outlierProb: 0, outlierSize: 0 } }))
    expect(mf.K).toBeCloseTo(0.00797884560802865, 9)
    const ss = meanFieldAnalysis('sign_sign', mfInput())
    expect(ss.K).toBeCloseTo(Math.sqrt(2 / Math.PI) * Math.sqrt(2 / Math.PI), 7) // 2f(0)E|x|（Simpson 積分，相對誤差 ~1e-8）
    expect(ss.gradVar).toBeCloseTo(1, 12)
  })

  it('skewed 雜訊 + 正值 x：E[ex]=0 與 E[sign(e)x]=0 給出不同 w*', () => {
    // x ≡ 1：LMS → a + E[v] = a；Sign-Error = Sign-Sign → a + median(v) = a + σ(ln2 − 1)
    const c = mfInput({ x: { kind: 'const', amp: 1 }, noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 } })
    expect(meanFieldAnalysis('lms', c).wStar).toBeCloseTo(3, 12)
    expect(meanFieldAnalysis('sign_error', c).wStar).toBeCloseTo(3 + Math.LN2 - 1, 9)
    expect(meanFieldAnalysis('sign_sign', c).wStar).toBeCloseTo(3 + Math.LN2 - 1, 9)
    // x ~ U[0.5, 1.5]：三者都不同
    const u = mfInput({ x: { kind: 'uniformPos', amp: 1 }, noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 } })
    const wl = meanFieldAnalysis('lms', u).wStar
    const we = meanFieldAnalysis('sign_error', u).wStar
    const ws = meanFieldAnalysis('sign_sign', u).wStar
    expect(wl).toBeCloseTo(3, 12)
    expect(we).toBeLessThan(2.8)
    expect(ws).toBeLessThan(we) // |x| 小的樣本 y/x 偏差較大，Sign-Sign 給它們同權
    expect(Math.abs(meanFieldDrift('sign_error', we, u))).toBeLessThan(1e-12)
    // 對稱 x（±1 或 Gaussian）時偏斜雜訊不造成偏差：x 與 −x 成對抵消
    const b = mfInput({ x: { kind: 'bpsk', amp: 1 }, noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 } })
    expect(meanFieldAnalysis('sign_error', b).wStar).toBeCloseTo(3, 9)
    expect(meanFieldAnalysis('sign_sign', mfInput({ noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 } })).wStar).toBeCloseTo(3, 9)
  })

  it('F-02.18：在 w = a 處 ψ_LMS = E[v]E[x]、ψ_SE = E[sign v]E[x]、ψ_SS = E[sign v]E[sign x]（v 與 x 獨立）', () => {
    const cases: MeanFieldInput[] = [
      mfInput({ x: { kind: 'uniformPos', amp: 1 }, noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 } }),
      mfInput({ x: { kind: 'const', amp: 1.7 }, noise: { kind: 'skewed', sigma: 0.6, outlierProb: 0, outlierSize: 0 } }),
      mfInput({ x: { kind: 'const', amp: 1 }, noise: { kind: 'gaussian', sigma: 0.3, outlierProb: 0.05, outlierSize: 20 } }),
      mfInput({ x: { kind: 'bpsk', amp: 2 }, noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 } }),
    ]
    for (const inp of cases) {
      const ops = noiseOps(inp.noise)
      const m = xMoments(inp.x)
      const signV = ops.signMean(0)
      const eSignX = inp.x.kind === 'bpsk' ? 0 : 1 // 本例的 x 不是 ±A 就是正值
      expect(meanFieldDrift('lms', inp.a, inp)).toBeCloseTo(ops.mean * m.m1, 10)
      expect(meanFieldDrift('sign_error', inp.a, inp)).toBeCloseTo(signV * m.m1, 7)
      expect(meanFieldDrift('sign_sign', inp.a, inp)).toBeCloseTo(signV * eSignX, 7)
    }
    // 偏斜雜訊：E[sign v] = 1 − 2F(0) = 2/e − 1，與 σ 無關
    expect(noiseOps({ kind: 'skewed', sigma: 0.37, outlierProb: 0, outlierSize: 0 }).signMean(0)).toBeCloseTo(2 / Math.E - 1, 14)
    // ψ(a) < 0 ⇒ w* < a（ψ 嚴格遞減）
    const u = cases[0]
    expect(meanFieldDrift('sign_error', u.a, u)).toBeLessThan(0)
    expect(meanFieldAnalysis('sign_error', u).wStar).toBeLessThan(u.a)
  })

  it('單邊 outlier 且 E[x] ≠ 0：LMS 被拉走 p·s·E[x]/E[x²]，Sign-Error 幾乎不動，Huber 介於兩者', () => {
    const inp = mfInput({ x: { kind: 'const', amp: 1 }, noise: { kind: 'gaussian', sigma: 0.5, outlierProb: 0.1, outlierSize: 20 } })
    const wl = meanFieldAnalysis('lms', inp).wStar
    const we = meanFieldAnalysis('sign_error', inp).wStar
    const wh = meanFieldAnalysis('huber', inp).wStar
    expect(wl).toBeCloseTo(3 + 2, 12)
    expect(we - 3).toBeGreaterThan(0)
    expect(we - 3).toBeLessThan(0.1)
    expect(wh).toBeGreaterThan(we)
    expect(wh).toBeLessThan(wl)
    expect(Math.abs(meanFieldDrift('huber', wh, inp))).toBeLessThan(1e-10)
  })

  it('同收斂速度下 Sign-Error / LMS 的變異比：Gaussian π/2、Laplacian 1/2（中位數 vs 平均的效率）', () => {
    const g = equalSpeedVarianceRatio('sign_error', mfInput())
    expect(g).toBeCloseTo(Math.PI / 2, 8)
    const l = equalSpeedVarianceRatio('sign_error', mfInput({ noise: { kind: 'laplacian', sigma: 1, outlierProb: 0, outlierSize: 0 } }))
    expect(l).toBeCloseTo(0.5, 8)
    const imp = equalSpeedVarianceRatio('sign_error', mfInput({ noise: { kind: 'impulsive', sigma: 1, outlierProb: 0, outlierSize: 0 } }))
    const sb = 1 / Math.sqrt(0.95 + 0.05 * 100)
    const f0 = (0.95 / sb + 0.05 / (10 * sb)) / Math.sqrt(2 * Math.PI)
    expect(imp).toBeCloseTo(1 / (4 * f0 * f0), 8)
    expect(imp).toBeLessThan(0.3)
    // Sign-Sign 再多付 E[x²]/(E|x|)²（Gaussian x：π/2；±1：1）
    expect(equalSpeedVarianceRatio('sign_sign', mfInput())).toBeCloseTo((Math.PI / 2) * (Math.PI / 2), 6)
    expect(equalSpeedVarianceRatio('sign_sign', mfInput({ x: { kind: 'bpsk', amp: 1 } }))).toBeCloseTo(Math.PI / 2, 8)
  })

  it('NLMS + Gaussian x：K = E[x²/(ε+x²)] 與 σ_η² = σ²E[x²/(ε+x²)²] 等於 erfcx 封閉式（小 ε 的尖峰也積得準）', () => {
    // t ~ N(0,1)、c = ε/A²、z = √(c/2)：I(c) = E[1/(c+t²)] = √(π/(2c))·erfcx(z)
    //   E[t²/(c+t²)]  = 1 − c·I = 1 − √(πc/2)·erfcx(z)
    //   E[t²/(c+t²)²] = I + c·I′ = √(π/2)·erfcx(z)·(1+c)/(2√c) − ½     （I′ = dI/dc）
    for (const [A, eps, sigma] of [
      [1, 0.1, 0.5],
      [1, 1e-3, 1],
      [2, 1e-3, 0.7],
      [1, 1e-5, 1],
      [0.5, 4, 1],
    ] as const) {
      const c = eps / (A * A)
      const z = Math.sqrt(c / 2)
      const K = 1 - Math.sqrt((Math.PI * c) / 2) * erfcx(z)
      const s2 = (Math.sqrt(Math.PI / 2) * erfcx(z) * (1 + c)) / (2 * Math.sqrt(c)) - 0.5
      const mf = meanFieldAnalysis('nlms', mfInput({ x: { kind: 'gauss', amp: A }, noise: { kind: 'gaussian', sigma, outlierProb: 0, outlierSize: 0 }, nlmsEps: eps }))
      expect(mf.wStar).toBeCloseTo(3, 9)
      expect(Math.abs(mf.K / K - 1)).toBeLessThan(1e-8)
      expect(Math.abs(mf.gradVar / ((sigma * sigma * s2) / (A * A)) - 1)).toBeLessThan(1e-7)
    }
    // Gaussian 節點的基本動差：E|x| = √(2/π)、E[x²] = 1、E[x⁴] = 3
    const ss = meanFieldAnalysis('sign_sign', mfInput())
    expect(Math.abs(ss.K / (2 / Math.PI) - 1)).toBeLessThan(1e-12) // 2f_v(0)·E|x| = √(2/π)·√(2/π)
  })

  it('反面：NLMS、ε = 0、Gaussian x ⇒ 固定點仍是 a、K = 1，但 E[v²/x²] = ∞（梯度雜訊變異無限大，穩態 std 無限大）', () => {
    const inp = mfInput({ nlmsEps: 0 })
    const mf = meanFieldAnalysis('nlms', inp)
    expect(mf.identifiable).toBe(true)
    expect(mf.wStar).toBeCloseTo(3, 9)
    expect(mf.K).toBeCloseTo(1, 9)
    expect(mf.gradVar).toBe(Infinity)
    const pred = predictSteadyState(mf, 0.02, inp)
    expect(pred.std).toBe(Infinity)
    expect(pred.meanShift).toBe(0)
    // 無雜訊時沒有東西可以被放大：變異為 0
    expect(meanFieldAnalysis('nlms', mfInput({ nlmsEps: 0, noise: { kind: 'none', sigma: 0, outlierProb: 0, outlierSize: 0 } })).gradVar).toBe(0)
    // 固定幅度或 |x| ≥ 0.5A 的分布：ε = 0 仍有限
    expect(meanFieldAnalysis('nlms', mfInput({ nlmsEps: 0, x: { kind: 'bpsk', amp: 2 } })).gradVar).toBeCloseTo(1 / 4, 12)
    expect(Number.isFinite(meanFieldAnalysis('nlms', mfInput({ nlmsEps: 0, x: { kind: 'uniformPos', amp: 1 } })).gradVar)).toBe(true)
  })

  it('反面：x ≡ 0 不可辨識（λ_min = E[x²] = 0）', () => {
    const mf = meanFieldAnalysis('sign_error', mfInput({ x: { kind: 'const', amp: 0 } }))
    expect(mf.identifiable).toBe(false)
    expect(Number.isNaN(mf.wStar)).toBe(true)
    expect(predictSteadyState(mf, 0.1, mfInput({ x: { kind: 'const', amp: 0 } })).stable).toBe(false)
  })

  it('driftCurve 的零交越 = w*', () => {
    const inp = mfInput({ x: { kind: 'uniformPos', amp: 1 }, noise: { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 } })
    const { w, psi } = driftCurve('sign_sign', inp, 1, 5, 401)
    const ws = meanFieldAnalysis('sign_sign', inp).wStar
    const i = psi.findIndex((v) => v < 0)
    expect(w[i - 1]).toBeLessThanOrEqual(ws)
    expect(w[i]).toBeGreaterThanOrEqual(ws)
  })
})

describe('sgd：共用資料模擬與 Monte Carlo', () => {
  it('同 seed 同資料；runShared 的 LMS 與 lms.ts runScalarLms 的遞迴相同', () => {
    const d1 = generateData(BASE, 5)
    const d2 = generateData(BASE, 5)
    expect(d1.x).toEqual(d2.x)
    expect(d1.y).toEqual(d2.y)
    const res = runShared({ ...BASE, algos: ['lms'], seed: 5 })
    let w = BASE.w0
    for (let n = 0; n < 50; n++) w = conventionalStep({ w, x: d1.x[n], y: d1.y[n], mu: BASE.mu }).w
    expect(res.w.lms![50]).toBe(w)
  })

  it('反面：LMS 在固定 x、μx² ≥ 2 時發散；Sign-Error 同 μ 不發散（步長有界）；NLMS μ̃ ≥ 2 發散', () => {
    const cfg: CaseConfig = { ...BASE, xKind: 'const', xAmp: 2, mu: 0.6, noiseKind: 'none', sigma: 0, steps: 200, w0: 1 }
    const r = runShared({ ...cfg, algos: ['lms', 'sign_error', 'nlms'], seed: 1 })
    expect(r.diverged.lms).toBe(true)
    expect(r.diverged.sign_error).toBe(false)
    expect(Math.abs(3 - r.w.sign_error![200])).toBeLessThanOrEqual(0.6 * 2 + 1e-12)
    // NLMS：μ̃ = μ·E[x²] = 2.4 ⇒ pole 1 − 2.4·4/(0.1 + 4) < −1
    expect(r.diverged.nlms).toBe(true)
    // 與 lms.ts 自己的 runner 一致
    const ref = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 0.6, steps: 200, x: { kind: 'fixed', value: 2 } })
    expect(ref.diverged).toBe(true)
  })

  it('NLMS 對 x 的幅度不敏感：x 放大 10 倍時 LMS 發散、NLMS 不變', () => {
    const s = nlmsStep({ w: 1, x: 20, y: 60, mu: 0.5, eps: 0 })
    expect(s.w).toBeCloseTo(2, 12) // 正好走一半距離
    const lms = conventionalStep({ w: 1, x: 20, y: 60, mu: 0.5 })
    expect(Math.abs(lms.w)).toBeGreaterThan(100)
  })

  it('MC（Gaussian x、Gaussian v）：穩態 std 與 mean-field 預測一致；時間平均落在 w* 附近', () => {
    const mc = monteCarloCompare({ ...BASE, algos: ['lms', 'sign_error', 'sign_sign'], seed: 20261010, runs: 48, steps: 4000 })
    const inp = meanFieldInputOf(BASE)
    for (const st of mc.stats) {
      const mf = meanFieldAnalysis(st.algo, inp)
      const pred = predictSteadyState(mf, st.mu, inp)
      expect(st.diverged).toBe(0)
      expect(st.tavgStd / pred.std).toBeGreaterThan(0.85)
      expect(st.tavgStd / pred.std).toBeLessThan(1.15)
      expect(Math.abs(st.tavgMean - mf.wStar)).toBeLessThan(4 * st.tavgSe + 1e-3)
      expect(st.absDeltaMedian.length).toBe(mc.checkpoints.length)
    }
  })

  it('MC（skewed 雜訊、x ≡ 1）：Sign-Error 收斂到中位數 a + σ(ln2−1)，LMS 收斂到平均 a', () => {
    const cfg: CaseConfig = { ...BASE, xKind: 'const', noiseKind: 'skewed', sigma: 1, mu: 0.01, steps: 6000 }
    const mc = monteCarloCompare({ ...cfg, algos: ['lms', 'sign_error'], seed: 3, runs: 40 })
    const inp = meanFieldInputOf(cfg)
    const [l, s] = mc.stats
    expect(Math.abs(l.tavgMean - 3)).toBeLessThan(4 * l.tavgSe + 1e-3)
    const mf = meanFieldAnalysis('sign_error', inp)
    const pred = predictSteadyState(mf, s.mu, inp)
    expect(Math.abs(s.tavgMean - (mf.wStar + pred.meanShift))).toBeLessThan(4 * s.tavgSe + Math.abs(pred.meanShift) + 2e-3)
    expect(s.tavgMean).toBeLessThan(2.75)
  })

  it('same-speed：步長依 K 調整，線性化 pole 相同', () => {
    const mus = algoStepSizes({ ...BASE, stepMatch: 'same-speed' }, ['lms', 'sign_error', 'sign_sign'])
    const inp = meanFieldInputOf(BASE)
    const kL = xMoments(inp.x).m2
    expect(mus.lms * kL).toBeCloseTo(mus.sign_error * meanFieldAnalysis('sign_error', inp).K, 12)
    expect(mus.lms * kL).toBeCloseTo(mus.sign_sign * meanFieldAnalysis('sign_sign', inp).K, 12)
  })

  it('logCheckpoints 含端點且遞增', () => {
    const c = logCheckpoints(1000, 50)
    expect(c[0]).toBe(0)
    expect(c[c.length - 1]).toBe(1000)
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1])
  })
})
