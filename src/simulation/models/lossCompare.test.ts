import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng, normCdf } from '@/simulation/core'
import { averageCost, fixedXPole, signErrorStep, type TieRule } from './lms'
import {
  FOUR_POINT_VALUES,
  batchHuber,
  batchL1,
  batchL2,
  MIN_BATCHES,
  contaminatedMedianApprox,
  costCurves,
  estimatorEfficiency,
  exactLmsTrace,
  expectedClipGaussian,
  fixedXStability,
  fracEq,
  fracFromNumber,
  fracToString,
  generateLossData,
  lmsSteadyState,
  lossPsi,
  lossRho,
  mixtureDensity,
  mixtureMedian,
  mixtureRawMoments,
  noiseMixture,
  playgroundClosedForm,
  playgroundEnsemble,
  playgroundTrace,
  playgroundVarW,
  playgroundVarWStationary,
  populationOptima,
  runTieStudy,
  runVariantOnData,
  signErrorFixedPointRun,
  signErrorJitterApprox,
  signErrorLatticeStationary,
  timeAverage,
  weightedMedian,
  type LossDataParams,
} from './lossCompare'

interface GoldenVector {
  inputs: Record<string, number | number[]>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

const golden = (id: string): GoldenVector =>
  JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8')) as GoldenVector

/** |a − e| ≤ abs + rel·|e|（golden/README 的容忍度規則） */
function expectGolden(actual: number, expected: number, tol: { abs?: number; rel?: number }) {
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound)
}

const HAND = { a: 3, w0: 1, x: 2, mu: 0.1, steps: 5, noiseSigma: 0, seed: 20261010 }

const FOUR: LossDataParams = {
  model: 'four_point',
  a: 0,
  xDist: 'const',
  xScale: 1,
  sigma: 0,
  outlierProb: 0,
  outlierSize: 0,
  outlierSign: 'positive',
  n: 400000,
  seed: 7,
}

describe('lossCompare：LMS Playground（§1.2）', () => {
  it('T01: a=3, w0=1, x=2, μ=0.1 ⇒ w1=1.8、w2=2.28；整條軌跡與 golden vector 一致（abs 1e-12）', () => {
    const g = golden('T01')
    const tr = playgroundTrace({ ...HAND, steps: Number(g.inputs.steps) })
    const wExp = g.expected.w_trace as number[]
    const eExp = g.expected.e_trace as number[]
    expect(tr.w.length).toBe(wExp.length)
    wExp.forEach((v, i) => expectGolden(tr.w[i], v, g.tolerance))
    eExp.forEach((v, i) => expectGolden(tr.e[i], v, g.tolerance))
    expectGolden(tr.w[1], g.expected.w1 as number, g.tolerance)
    expectGolden(tr.w[2], g.expected.w2 as number, g.tolerance)
    expectGolden(tr.e[0], g.expected.e0 as number, g.tolerance)
    expectGolden(tr.e[1], g.expected.e1 as number, g.tolerance)
    expectGolden(fixedXStability(0.1, 2).pole, g.expected.pole as number, g.tolerance)
    // 遞迴與封閉解 w_n = a − (a − w0)pⁿ 一致
    for (let n = 0; n <= 5; n++) expect(tr.w[n]).toBeCloseTo(playgroundClosedForm(3, 1, 2, 0.1, n), 13)
    // δ_n = a − w_n（勘誤 E39）：+2, +1.2, +0.72
    expect(tr.delta[0]).toBeCloseTo(2, 14)
    expect(tr.delta[1]).toBeCloseTo(1.2, 14)
    expect(tr.delta[2]).toBeCloseTo(0.72, 13)
  })

  it('T01: 精確有理數重算 w1 = 9/5、w2 = 57/25（不受 IEEE double 2.2800000000000002 影響）', () => {
    const w = exactLmsTrace(3, 1, 2, 0.1, 3)
    expect(fracToString(w[1])).toBe('9/5')
    expect(fracToString(w[2])).toBe('57/25')
    expect(fracEq(w[2], fracFromNumber(2.28))).toBe(true)
    expect(fracToString(w[3])).toBe('321/125') // 2.568
    expect(fracToString(fracFromNumber(0.1))).toBe('1/10')
    expect(fracToString(fracFromNumber(1e-7))).toBe('1/10000000')
    expect(fracToString(fracFromNumber(-2.5))).toBe('-5/2')
  })

  it('T02: 固定 x=2 ⇒ 0 < μ < 0.5；pole 與收斂判定和 golden vector 一致；μ = 0.25 一步到位', () => {
    const g = golden('T02')
    const x = Number(g.inputs.x)
    const mus = g.inputs.mu_list as number[]
    const poles = g.expected.pole_list as number[]
    const conv = g.expected.converges_list as number[]
    mus.forEach((mu, i) => {
      const s = fixedXStability(mu, x)
      expectGolden(s.pole, poles[i], g.tolerance)
      expect(s.converges ? 1 : 0).toBe(conv[i])
    })
    const s = fixedXStability(0.1, x)
    expectGolden(s.muMax, g.expected.mu_max as number, g.tolerance)
    expectGolden(s.muOneStep, g.expected.mu_one_step as number, g.tolerance)
    // 一步到位：μ = 1/x² ⇒ w_1 = a
    const one = playgroundTrace({ ...HAND, mu: 0.25, steps: 3 })
    expect(one.w[1]).toBe(3)
    expect(fixedXStability(0.25, 2).behaviour).toBe('deadbeat')
  })

  it('T02: 時域驗證——200 步後 |δ| 是否變小，與 |p| < 1 的判定一致', () => {
    const g = golden('T02')
    const mus = g.inputs.mu_list as number[]
    const conv = g.expected.converges_list as number[]
    mus.forEach((mu, i) => {
      const tr = playgroundTrace({ ...HAND, mu, steps: 200 })
      const shrink = Math.abs(tr.delta[200]) < 0.5 * Math.abs(tr.delta[0])
      expect(shrink ? 1 : 0).toBe(conv[i])
    })
  })

  it('T02: （反面）μ = 0.5 邊界 |δ| 不變且正負交替；μ = 0.6 振盪發散；μ < 0 單調發散', () => {
    const b = playgroundTrace({ ...HAND, mu: 0.5, steps: 10 })
    for (let n = 0; n <= 10; n++) expect(Math.abs(b.delta[n])).toBeCloseTo(2, 12)
    expect(Math.sign(b.delta[1])).toBe(-Math.sign(b.delta[0]))
    const d = playgroundTrace({ ...HAND, mu: 0.6, steps: 40 })
    expect(Math.abs(d.delta[40])).toBeGreaterThan(1e5) // |p| = 1.4
    expect(fixedXStability(0.6, 2).behaviour).toBe('divergent')
    const neg = playgroundTrace({ ...HAND, mu: -0.01, steps: 100 })
    for (let n = 1; n <= 100; n++) expect(neg.delta[n]).toBeGreaterThan(neg.delta[n - 1]) // 單調變大
    const huge = playgroundTrace({ ...HAND, mu: 5, steps: 200 })
    expect(huge.divergedAt).not.toBeNull()
    expect(Number.isNaN(huge.w[200])).toBe(true)
  })

  it('反面：x = 0 沒有 excitation——w 永遠不動、a 不可辨識；μ_max = ∞ 不代表「穩定學到 a」', () => {
    const tr = playgroundTrace({ ...HAND, x: 0, steps: 50 })
    for (let n = 0; n <= 50; n++) expect(tr.w[n]).toBe(1)
    const s = fixedXStability(0.1, 0)
    expect(s.pole).toBe(1)
    expect(s.converges).toBe(false)
    expect(s.muMax).toBe(Infinity)
  })

  it('反面（E41）: 若用沒有 ½ 的 J₂ 的 Hessian 2x² 推步長界會得 1/x² = 0.25，但 μ = 0.4 的實際 LMS 仍收斂', () => {
    const naiveBound = 1 / (2 * 2) // 錯誤：把 J₂ = E[e²] 的曲率 2x² 當成 LMS 的曲率
    expect(naiveBound).toBe(0.25)
    const tr = playgroundTrace({ ...HAND, mu: 0.4, steps: 100 })
    expect(Math.abs(tr.delta[100])).toBeLessThan(1e-12) // |p| = 0.6 < 1（只剩浮點捨入）
    // ½J₂ 的梯度 = −E[e·x] = −(a − w)x²，LMS 的單步更新 μ·e·x 正好是 −μ·∇(½J₂)
    const J = (w: number) => 0.5 * (3 - w) ** 2 * 4
    const h = 1e-6
    const grad = (J(1 + h) - J(1 - h)) / (2 * h)
    expect(grad).toBeCloseTo(-(3 - 1) * 4, 6)
    expect(tr.dw[0]).toBeCloseTo(-0.4 * grad, 6)
  })

  it('有雜訊：Var(w_n) 的精確式與 Monte Carlo（1500 條路徑）在 4·SE 內一致；穩態 μσ²/(2 − μx²) = 0.0625', () => {
    expect(playgroundVarWStationary(0.1, 2, 1)).toBeCloseTo(0.0625, 15)
    const mc = playgroundEnsemble({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 30, noiseSigma: 1, seed: 11, paths: 1500 })
    const ana = playgroundVarW(0.1, 2, 1, 30)
    expect(Math.abs(mc.varW - ana)).toBeLessThan(4 * mc.seVar)
    expect(Math.abs(mc.meanW - playgroundClosedForm(3, 1, 2, 0.1, 30))).toBeLessThan(4 * Math.sqrt(ana / 1500))
    expect(playgroundVarWStationary(0.6, 2, 1)).toBe(Infinity)
  })

  it('Freeze：凍結後 w 保持不變，誤差 e 仍隨雜訊變動', () => {
    const tr = playgroundTrace({ ...HAND, noiseSigma: 0.5, steps: 30, freezeAt: 10 })
    for (let n = 11; n <= 30; n++) expect(tr.w[n]).toBe(tr.w[10])
    expect(new Set(Array.from(tr.e.slice(10))).size).toBeGreaterThan(10)
  })

  it('同 seed 可重現；改 μ 不改變雜訊序列（paired）', () => {
    const p1 = playgroundTrace({ ...HAND, noiseSigma: 1, steps: 20 })
    const p2 = playgroundTrace({ ...HAND, noiseSigma: 1, steps: 20 })
    const p3 = playgroundTrace({ ...HAND, noiseSigma: 1, steps: 20, mu: 0.2 })
    expect(Array.from(p1.w)).toEqual(Array.from(p2.w))
    expect(Array.from(p1.v)).toEqual(Array.from(p3.v))
  })
})

describe('lossCompare：損失函數與次梯度（§2）', () => {
  it('ρ 與 ψ：MSE ψ = e、MAE ψ = sign(e)（tie 慣例明定，E40）、Huber 截斷；Huber 在 |e| = δ 連續且一階可微', () => {
    expect(lossPsi('mse', -3)).toBe(-3)
    expect(lossPsi('mae', -3)).toBe(-1)
    expect(lossPsi('mae', 0, 1, 'zero')).toBe(0)
    expect(lossPsi('mae', 0, 1, 'plus')).toBe(1)
    expect(lossPsi('mae', 0, 1, 'minus')).toBe(-1)
    expect(lossPsi('huber', 0.4, 1)).toBe(0.4)
    expect(lossPsi('huber', -7, 1)).toBe(-1)
    const d = 1.5
    expect(lossRho('huber', d, d)).toBeCloseTo(0.5 * d * d, 14)
    expect(lossRho('huber', d + 1e-9, d)).toBeCloseTo(0.5 * d * d, 8)
    const h = 1e-6
    for (const e of [-4, -0.3, 0.7, 2.5]) {
      for (const k of ['mse', 'huber'] as const) {
        const num = (lossRho(k, e + h, d) - lossRho(k, e - h, d)) / (2 * h)
        expect(num).toBeCloseTo(lossPsi(k, e, d), 6)
      }
    }
  })

  it('|e| 在 0 的次梯度集合是 [−1, 1]：|e| ≥ g·e 對所有 e 成立 ⇔ |g| ≤ 1', () => {
    const es = Array.from({ length: 401 }, (_, i) => -2 + i * 0.01)
    for (const g of [-1, -0.5, 0, 0.5, 1]) expect(es.every((e) => Math.abs(e) >= g * e - 1e-15)).toBe(true)
    for (const g of [-1.01, 1.2]) expect(es.every((e) => Math.abs(e) >= g * e - 1e-15)).toBe(false)
  })
})

describe('lossCompare：批次與母體最佳解', () => {
  it('y = [0,0,0,10]：MSE 平均 2.5、MAE 中位數 0、Huber(δ=1) = 1/3；J 的最小值落在這些點', () => {
    const x = [1, 1, 1, 1]
    const y = [...FOUR_POINT_VALUES]
    expect(batchL2(x, y)).toBe(2.5)
    expect(batchL1(x, y)).toEqual({ lo: 0, hi: 0 })
    expect(batchHuber(x, y, 1)).toBeCloseTo(1 / 3, 12)
    const grid = Array.from({ length: 2001 }, (_, i) => -5 + i * 0.01)
    const c = costCurves(x, y, grid, 1)
    const argmin = (v: Float64Array) => grid[v.indexOf(Math.min(...v))]
    expect(argmin(c.mse)).toBeCloseTo(2.5, 10)
    expect(argmin(c.mae)).toBeCloseTo(0, 10)
    expect(argmin(c.huber)).toBeCloseTo(0.33, 10)
    // MSE 的充分統計量版本與 lms.ts 的逐筆 averageCost 一致
    for (const w of [-1, 0.5, 2.5, 7]) {
      expect(c.mse[grid.findIndex((g) => Math.abs(g - w) < 1e-9)]).toBeCloseTo(averageCost('mse', w, x, y), 10)
    }
  })

  it('outlier 影響力：10 → 1000 時平均跟著跑到 250，中位數仍為 0，Huber 仍為 1/3（bounded influence）', () => {
    const x = [1, 1, 1, 1]
    expect(batchL2(x, [0, 0, 0, 1000])).toBe(250)
    expect(batchL1(x, [0, 0, 0, 1000])).toEqual({ lo: 0, hi: 0 })
    expect(batchHuber(x, [0, 0, 0, 1000], 1)).toBeCloseTo(1 / 3, 12)
  })

  it('偶數筆中位數是一整段區間；加權中位數 = 暴力搜尋的最小值', () => {
    expect(weightedMedian([0, 10], [1, 1])).toEqual({ lo: 0, hi: 10 })
    expect(weightedMedian([1, 2, 3], [1, 1, 1])).toEqual({ lo: 2, hi: 2 })
    const x = [2, -1, 0.5, 3, -2, 1]
    const y = [5, -4, 2, 9.5, -5.5, 3.3]
    const m = batchL1(x, y)
    const J = (w: number) => x.reduce((s, xi, i) => s + Math.abs(y[i] - w * xi), 0)
    let best = Infinity
    let wBest = 0
    for (let i = 0; i <= 40000; i++) {
      const w = 2 + i * 0.00005
      const v = J(w)
      if (v < best - 1e-12) {
        best = v
        wBest = w
      }
    }
    expect(wBest).toBeGreaterThanOrEqual(m.lo - 1e-4)
    expect(wBest).toBeLessThanOrEqual(m.hi + 1e-4)
    expect(J(0.5 * (m.lo + m.hi))).toBeLessThanOrEqual(best + 1e-12) // 加權中位數不比任何網格點差
  })

  it('母體：contaminated（x ≡ 1, σ=1, ε=0.1, s=20）平均 a+εs、中位數解 0.9Φ(t)+0.1Φ(t−20) = ½、Huber 介於兩者', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 3, sigma: 1, outlierProb: 0.1, outlierSize: 20, n: 0 }
    const o = populationOptima(p, 1)
    expect(o.l2).toBeCloseTo(3 + 0.1 * 20, 12)
    const t = o.l1.lo - 3
    expect(0.9 * normCdf(t) + 0.1 * normCdf(t - 20)).toBeCloseTo(0.5, 12)
    expect(t).toBeCloseTo(contaminatedMedianApprox(1, 0.1), 8) // s ≫ σ 時近似幾乎精確
    expect(t).toBeCloseTo(0.13971, 4) // Φ⁻¹(5/9)
    expect(o.huber).toBeGreaterThan(o.l1.lo)
    expect(o.huber).toBeLessThan(o.l2)
    // x 零均值：三種最佳解都是 a
    const z = populationOptima({ ...p, xDist: 'gaussian' }, 1)
    expect(z).toMatchObject({ l2: 3, huber: 3, zeroMeanX: true })
  })

  it('E[clip(m+σZ)] 封閉式 = 數值積分', () => {
    for (const [m, s, d] of [
      [0.3, 1, 1],
      [2, 0.5, 1],
      [-1, 2, 0.7],
    ]) {
      let acc = 0
      const n = 20000
      for (let i = 0; i < n; i++) {
        const z = -10 + (20 * (i + 0.5)) / n
        acc += Math.max(-d, Math.min(d, m + s * z)) * Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) * (20 / n)
      }
      expect(expectedClipGaussian(m, s, d)).toBeCloseTo(acc, 6)
    }
  })

  it('大樣本批次最佳解收斂到母體最佳解（同一組資料）', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 3, sigma: 1, outlierProb: 0.1, outlierSize: 20, n: 200000, seed: 3 }
    const d = generateLossData(p)
    const o = populationOptima(p, 1)
    expect(batchL2(d.x, d.y)).toBeCloseTo(o.l2, 1)
    expect(0.5 * (batchL1(d.x, d.y).lo + batchL1(d.x, d.y).hi)).toBeCloseTo(o.l1.lo, 1)
    expect(batchHuber(d.x, d.y, 1)).toBeCloseTo(o.huber, 1)
  })
})

describe('lossCompare：同一組資料上的三種演算法與穩態', () => {
  it('三種變體吃完全相同的 (x, y)；只有更新律不同', () => {
    const p: LossDataParams = { ...FOUR, n: 50 }
    const d1 = generateLossData(p)
    const d2 = generateLossData(p)
    expect(Array.from(d1.y)).toEqual(Array.from(d2.y))
    const o = { w0: 1, mu: 0.2, tie: 'zero' as TieRule, huberDelta: 1 }
    const se = runVariantOnData('sign_error', d1, o)
    // 手動用 signErrorStep 重算
    let w = 1
    for (let n = 0; n < 50; n++) w = signErrorStep({ w, x: d1.x[n], y: d1.y[n], mu: 0.2, tie: 'zero' }).w
    expect(se.w[50]).toBe(w)
  })

  it('LMS 穩態（x ≡ 1）：時間平均 → 2.5、變異數 → μ·Var(y)/(2 − μ) = μ·18.75/(2 − μ)', () => {
    const mu = 0.2
    const ss = lmsSteadyState(FOUR, mu)
    expect(ss.mean).toBe(2.5)
    expect(ss.variance).toBeCloseTo((mu * 18.75) / (2 - mu), 12)
    const d = generateLossData({ ...FOUR, n: 200000 })
    const r = runVariantOnData('conventional', d, { w0: 0, mu, tie: 'zero', huberDelta: 1 })
    const ta = timeAverage(r.w)
    expect(Math.abs(ta.mean - 2.5)).toBeLessThan(4 * ta.se)
    expect(ta.std ** 2).toBeCloseTo(ss.variance, 1)
  })

  it('LMS 穩態（x ~ N(0,1) 零均值）：E[w] = a、MSD = μP_xE[n²]/(2P_x − μE[x⁴])（E42）', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 3, xDist: 'gaussian', sigma: 1, outlierProb: 0.05, outlierSize: 10, n: 300000, seed: 5 }
    const mu = 0.05
    const ss = lmsSteadyState(p, mu)
    const En2 = 0.95 * 1 + 0.05 * (100 + 1)
    expect(ss.variance).toBeCloseTo((mu * En2) / (2 - 3 * mu), 12)
    const d = generateLossData(p)
    const r = runVariantOnData('conventional', d, { w0: 3, mu, tie: 'zero', huberDelta: 1 })
    const ta = timeAverage(r.w)
    expect(Math.abs(ta.mean - 3)).toBeLessThan(4 * ta.se)
    expect(ta.std ** 2 / ss.variance).toBeGreaterThan(0.9)
    expect(ta.std ** 2 / ss.variance).toBeLessThan(1.1)
  })

  it('E40：lattice 鏈精確解——y = [0,0,0,10]、μ = 0.2 的 Sign-Error 時間平均：zero → μ/2、plus → μ、minus → 0（μ ≪ 10 的近似，這個步長下差約 5e−24；見下面審查 R08 的測試）', () => {
    const mu = 0.2
    const z = signErrorLatticeStationary(FOUR, { w0: 0, mu, tie: 'zero' })!
    const pl = signErrorLatticeStationary(FOUR, { w0: 0, mu, tie: 'plus' })!
    const mi = signErrorLatticeStationary(FOUR, { w0: 0, mu, tie: 'minus' })!
    expect(z.mean).toBeCloseTo(mu / 2, 12)
    expect(pl.mean).toBeCloseTo(mu, 12)
    expect(mi.mean).toBeCloseTo(0, 12)
    // π_0 = 2/3（zero）：幾何分布 π_k = (2/3)·3^{−k}
    expect(z.pi[z.grid.findIndex((g) => Math.abs(g) < 1e-12)]).toBeCloseTo(2 / 3, 12)
    // 格點不含 0（w0 = 0.1）時 tie 不會發生，三種慣例結果相同
    const off = (['zero', 'plus', 'minus'] as TieRule[]).map((tie) => signErrorLatticeStationary(FOUR, { w0: 0.1, mu, tie })!.mean)
    expect(off[0]).toBeCloseTo(off[1], 12)
    expect(off[0]).toBeCloseTo(off[2], 12)
    // 均落在中位數 0 附近的 O(μ) 帶內
    for (const m of [z.mean, pl.mean, mi.mean, ...off]) expect(Math.abs(m)).toBeLessThanOrEqual(mu + 1e-12)
  })

  // ───── 審查 R08：F-01.16 右式（μ/2、μ、0）是「把格點鏈當成向右無限延伸」的小步長近似，不是精確式 ─────
  // 鏈在另一個資料值 w = 10 到頭。10/μ = M 為正整數、w0 = 0 時（獨立以有理數解 πP = π 核對過）：
  //   sign(0) = 0：格點 0…M，π_k ∝ 3^{−k}
  //   sign(0) = +1：格點 0…M+1，權重 1, 4·3^{−k}（k = 1…M）, 3^{−M}；sign(0) = −1 是同一條鏈往下移一格
  //   三種慣例的時間平均都比右式少 (M + 1)μ/(3^{M+1} − 1) = (10 + μ)/(3^{1 + 10/μ} − 1)
  const lat3 = (mu: number, w0 = 0) => (['zero', 'plus', 'minus'] as TieRule[]).map((tie) => signErrorLatticeStationary(FOUR, { w0, mu, tie })!)
  const upperCorr = (mu: number) => (10 + mu) / (3 ** (1 + 10 / mu) - 1)
  const expectVec = (got: number[], want: number[]) => {
    expect(got).toHaveLength(want.length)
    want.forEach((v, k) => expect(got[k], `[${k}]`).toBeCloseTo(v, 12))
  }

  it('審查 R08 反例：μ = 5、w0 = 0——w 只待在 {0, 5, 10}，π = (9, 3, 1)/13，時間平均 25/13 ≈ 1.923 而不是 μ/2 = 2.5；plus → 115/26、minus → −15/26（不是 5 與 0）', () => {
    const [z, pl, mi] = lat3(5)
    expectVec(z.grid, [0, 5, 10])
    expectVec(z.pi, [9 / 13, 3 / 13, 1 / 13])
    expect(z.mean).toBeCloseTo(25 / 13, 12)
    expect(z.mean).toBeCloseTo(1.9230769230769231, 12)
    expect(Math.abs(z.mean - 5 / 2)).toBeGreaterThan(0.5) // F-01.16 右式在這裡差了 23%
    expectVec(pl.grid, [0, 5, 10, 15])
    expectVec(pl.pi, [9 / 26, 12 / 26, 4 / 26, 1 / 26])
    expect(pl.mean).toBeCloseTo(115 / 26, 12)
    expect(pl.mean).toBeCloseTo(4.423076923076923, 12)
    expectVec(mi.grid, [-5, 0, 5, 10])
    expectVec(mi.pi, [9 / 26, 12 / 26, 4 / 26, 1 / 26])
    expect(mi.mean).toBeCloseTo(-15 / 26, 12)
    expect(mi.mean).toBeCloseTo(-0.5769230769230769, 12)
    // 獨立核對：π 滿足 πP = π（zero tie 的三狀態轉移矩陣；w = 10 那一格抽到 10 是 e = 0、不動，抽到 0 往下，不會再往上）
    const Pm = [
      [0.75, 0.25, 0],
      [0.75, 0, 0.25],
      [0, 0.75, 0.25],
    ]
    for (let j = 0; j < 3; j++) expect(z.pi.reduce((acc, q, i) => acc + q * Pm[i][j], 0)).toBeCloseTo(z.pi[j], 12)
    // 右邊界上的 tie 也跟著慣例變：plus 會多走到 10 + μ = 15，minus 的最上面一格仍是 10（一定往下）
    expect(pl.grid[pl.grid.length - 1]).toBeCloseTo(15, 12)
    expect(mi.grid[mi.grid.length - 1]).toBeCloseTo(10, 12)
    // 左式不受影響：三種慣例的時間平均離中位數 0 都不超過 μ|x| = 5
    for (const r of [z, pl, mi]) expect(Math.abs(r.mean)).toBeLessThanOrEqual(5)
  })

  it('審查 R08：10/μ 為正整數時的有限鏈公式——zero → μ/2 − c、plus → μ − c、minus → −c，c = (10 + μ)/(3^{1 + 10/μ} − 1)', () => {
    // 期望值是用有理數獨立算出的（Python Fraction 解 πP = π），不是從被測函式抄回來的
    const exact: Record<number, [number, number, number]> = {
      10: [2.5, 7.5, -2.5],
      5: [1.9230769230769231, 4.423076923076923, -0.5769230769230769],
      2.5: [1.1983471074380165, 2.4483471074380163, -0.05165289256198347],
      2: [0.9835164835164835, 1.9835164835164836, -0.016483516483516484],
      1: [0.49993790432750385, 0.9999379043275038, -6.209567249613313e-5],
      0.5: [0.2499999989962098, 0.4999999989962098, -1.0037901968733158e-9],
    }
    for (const mu of [10, 5, 2.5, 2, 1, 0.5]) {
      const c = upperCorr(mu)
      const [z, pl, mi] = lat3(mu)
      expect(z.mean, `zero μ=${mu}`).toBeCloseTo(mu / 2 - c, 12)
      expect(pl.mean, `plus μ=${mu}`).toBeCloseTo(mu - c, 12)
      expect(mi.mean, `minus μ=${mu}`).toBeCloseTo(-c, 12)
      expectVec([z.mean, pl.mean, mi.mean], exact[mu])
      // 有限鏈的 π_0（zero）= (2/3)/(1 − 3^{−(M+1)})，只有 M 大時才是 2/3
      expect(z.pi[z.grid.findIndex((g) => Math.abs(g) < 1e-9)]).toBeCloseTo(2 / 3 / (1 - 3 ** -(1 + 10 / mu)), 12)
    }
    // 修正量的大小：μ = 1 約 6.2e−5（Lab 的 μ 範圍內看得見）、μ = 2 約 1.6e−2、μ = 5 約 0.58
    expect(upperCorr(1)).toBeCloseTo(6.209567249613313e-5, 15)
    expect(upperCorr(2)).toBeCloseTo(3 / 182, 12)
    expect(upperCorr(5)).toBeCloseTo(15 / 26, 12)
  })

  it('審查 R08 正常對照：小步長（μ = 0.2、0.02）時 μ/2、μ、0 準到 double 解析度以下——修正量 4.7e−24 與 9.2e−239', () => {
    for (const mu of [0.2, 0.02]) {
      const [z, pl, mi] = lat3(mu)
      expect(z.mean).toBeCloseTo(mu / 2, 12)
      expect(pl.mean).toBeCloseTo(mu, 12)
      expect(mi.mean).toBeCloseTo(0, 12)
      expect(upperCorr(mu)).toBeLessThan(1e-20)
      expect(upperCorr(mu)).toBeGreaterThan(0)
    }
    // 章內（MedianExample.tsx 的 UPPER_CORR_SS）與公式登錄 F-01.16 引用的數字
    expect(upperCorr(0.2) / 4.73604893493503e-24).toBeCloseTo(1, 10)
    expect(upperCorr(0.2).toExponential(1)).toBe('4.7e-24')
    expect((3 ** -50).toExponential(1)).toBe('1.4e-24') // 圖 2-6 導讀的 3^{−10/μ}
    expect(upperCorr(0.02)).toBeLessThan(1e-200)
    // zero tie 待在 w ≥ 10 的機率 = π_M = (2/3)·3^{−M}/(1 − 3^{−(M+1)}) < 3^{−10/μ}（μ = 5：1/13 < 1/9）
    const big = lat3(5)[0]
    expect(big.pi[2]).toBeCloseTo(1 / 13, 12)
    expect(big.pi[2]).toBeLessThan(3 ** -2)
    // 另外兩種慣例不適用「小於」：plus 在 w ≥ 10 的機率是 5/26 > 1/9（量級仍是 3^{−10/μ}），minus 是 1/26
    const [, plBig, miBig] = lat3(5)
    expect(plBig.pi[2] + plBig.pi[3]).toBeCloseTo(5 / 26, 12)
    expect(plBig.pi[2] + plBig.pi[3]).toBeGreaterThan(3 ** -2)
    expect(miBig.pi[3]).toBeCloseTo(1 / 26, 12)
  })

  it('審查 R08：單一修正量只在 10/μ 為正整數時成立——μ = 3（格點 0, 3, 6, 9, 12）是 228/161、57/20、−15/242，與公式不同；O(μ|x|) 的帶仍成立', () => {
    const mu = 3
    const [z, pl, mi] = lat3(mu)
    expectVec(z.grid, [0, 3, 6, 9, 12])
    expectVec(z.pi, [108 / 161, 36 / 161, 12 / 161, 4 / 161, 1 / 161]) // 最上面一格 w = 12 > 10：兩種 y 都往下
    expect(z.mean).toBeCloseTo(228 / 161, 12)
    expect(z.mean).toBeCloseTo(1.4161490683229814, 12)
    expect(pl.mean).toBeCloseTo(2.85, 12)
    expect(mi.mean).toBeCloseTo(-15 / 242, 12)
    expect(mi.mean).toBeCloseTo(-0.06198347107438017, 12)
    // 把 10/μ 不是整數的 μ 硬代進單一修正量公式會錯（差 0.028）
    expect(Math.abs(z.mean - (mu / 2 - upperCorr(mu)))).toBeGreaterThan(0.02)
    // 三種慣例離各自的小步長值的距離也不一樣：−0.0839、−0.15、−0.0620
    expect(z.mean - mu / 2).toBeCloseTo(-0.0838509316770186, 12)
    expect(pl.mean - mu).toBeCloseTo(-0.15, 12)
    expect(mi.mean - 0).toBeCloseTo(-0.06198347107438017, 12)
    for (const r of [z, pl, mi]) expect(Math.abs(r.mean)).toBeLessThanOrEqual(mu)
  })

  it('審查 R08：MSE vs MAE Lab「試試看 (2)」引用的數字——預設 w0 = 1、μ = 1、sign(0) = 0 的解析值是 44281/88573，顯示成 0.499938，不是 μ/2 = 0.5', () => {
    const r = signErrorLatticeStationary(FOUR, { w0: 1, mu: 1, tie: 'zero' })!
    expect(r.mean).toBeCloseTo(44281 / 88573, 12)
    expect(r.mean).toBeCloseTo(0.4999379043275038, 12)
    expect(Number(r.mean.toPrecision(6))).toBe(0.499938)
    expect(0.5 - r.mean).toBeCloseTo(upperCorr(1), 12)
    // w0 = 0 與 w0 = 1 是同一個格點（都是 μ 的整數倍），結果相同
    expect(lat3(1)[0].mean).toBeCloseTo(r.mean, 14)
  })

  it('E40：定點（整數 code）Monte Carlo 時間平均與 lattice 精確值一致；IEEE double 連加會讓 tie 慣例失效', () => {
    const res = runTieStudy({ data: FOUR, w0: 0, mu: 0.2 })
    expect(res.steps).toBe(400000)
    const fixed = res.rows.filter((r) => r.arithmetic === 'fixed')
    expect(fixed).toHaveLength(3)
    for (const r of fixed) expect(Math.abs(r.timeAvg - r.latticeMean!)).toBeLessThan(4 * r.se + 1e-3)
    const ieee = res.rows.filter((r) => r.arithmetic === 'ieee')
    // IEEE：0 + 0.2 + 0.2 + 0.2 − 0.2 − 0.2 − 0.2 ≠ 0，「中位數那一格」變成 5.55e−17，tie 幾乎不再發生
    const fixedZero = fixed.find((r) => r.tie === 'zero')!
    const ieeeZero = ieee.find((r) => r.tie === 'zero')!
    expect(ieeeZero.tieHits).toBeLessThan(fixedZero.tieHits / 100)
    expect(Math.abs(ieeeZero.timeAvg - 0.1)).toBeGreaterThan(8 * ieeeZero.se)
  })

  it('pm1 regressor：lattice 解與定點 MC 一致（σ = 0、ε = 0.3、s = 4、tie = plus）', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 1, xDist: 'pm1', xScale: 1, sigma: 0, outlierProb: 0.3, outlierSize: 4, n: 300000, seed: 9 }
    for (const tie of ['zero', 'plus', 'minus'] as TieRule[]) {
      const lat = signErrorLatticeStationary(p, { w0: 1, mu: 0.25, tie })!
      const fx = signErrorFixedPointRun(generateLossData(p), { w0: 1, mu: 0.25, tie })!
      const ta = timeAverage(fx.w)
      expect(Math.abs(ta.mean - lat.mean)).toBeLessThan(4 * ta.se + 2e-3)
    }
  })

  it('Gaussian 雜訊、x ≡ 1：lattice 解與定點 MC 一致；Sign-Error 平均落在母體中位數 ±μ 內', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 2, xDist: 'const', xScale: 1, sigma: 1, outlierProb: 0.1, outlierSize: 20, n: 300000, seed: 4 }
    const mu = 0.05
    const lat = signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!
    const fx = signErrorFixedPointRun(generateLossData(p), { w0: 0, mu, tie: 'zero' })!
    const ta = timeAverage(fx.w)
    expect(Math.abs(ta.mean - lat.mean)).toBeLessThan(4 * ta.se + 1e-3)
    const med = populationOptima(p, 1).l1.lo
    expect(Math.abs(lat.mean - med)).toBeLessThan(mu)
    expect(lat.truncated).toBe(false)
    // Gaussian x 沒有格點
    expect(signErrorLatticeStationary({ ...p, xDist: 'gaussian' }, { w0: 0, mu, tie: 'zero' })).toBeNull()
    expect(signErrorFixedPointRun(generateLossData({ ...p, xDist: 'gaussian', n: 10 }), { w0: 0, mu, tie: 'zero' })).toBeNull()
  })

  it('反面：outlier 讓 LMS（x ≡ 1）偏到 a + εs，Sign-Error 只偏一點點', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 3, sigma: 1, outlierProb: 0.1, outlierSize: 20, n: 100000, seed: 2 }
    const d = generateLossData(p)
    const o = { w0: 0, mu: 0.02, tie: 'zero' as TieRule, huberDelta: 1 }
    const lms = timeAverage(runVariantOnData('conventional', d, o).w)
    const se = timeAverage(runVariantOnData('sign_error', d, o).w)
    expect(lms.mean).toBeGreaterThan(4.8) // ≈ 5
    expect(Math.abs(se.mean - 3)).toBeLessThan(0.3) // ≈ 3.14（中位數）
  })

  it('反面（思考題 3）：{1,2,3,100} 的 MAE 最佳解是整段 [2,3]——Sign-Error 在區間內無漂移地遊走，std ≈ 1/√12，不是 O(μ)', () => {
    const p: LossDataParams = { ...FOUR, values: [1, 2, 3, 100], n: 300000, seed: 21 }
    expect(mixtureMedian(noiseMixture(p))).toEqual({ lo: 2, hi: 3 })
    const lat = [0.05, 0.01].map((mu) => signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!)
    for (const r of lat) {
      expect(r.truncated).toBe(false)
      expect(r.mean).toBeCloseTo(2.5, 9) // 資料對稱 ⇒ 時間平均在區間中點
      expect(r.std).toBeGreaterThan(0.28)
      expect(r.std).toBeLessThan(0.33)
    }
    // μ 縮小 5 倍，std 幾乎不變（→ 均勻分布的 1/√12 = 0.2887），只有溢出區間的部分縮小
    expect(Math.abs(lat[1].std - 1 / Math.sqrt(12))).toBeLessThan(Math.abs(lat[0].std - 1 / Math.sqrt(12)))
    expect(lat[0].std / lat[1].std).toBeLessThan(1.15)
    // 定點 Monte Carlo 交叉比對 lattice（μ = 0.05）
    const fx = signErrorFixedPointRun(generateLossData(p), { w0: 0, mu: 0.05, tie: 'zero' })!
    const ta = timeAverage(fx.w)
    expect(Math.abs(ta.mean - lat[0].mean)).toBeLessThan(4 * ta.se + 1e-3)
    expect(ta.std / lat[0].std).toBeGreaterThan(0.9)
    expect(ta.std / lat[0].std).toBeLessThan(1.1)
  })

  it('Sign-Sign 追 y/x 的「不加權」中位數，Sign-Error 追 |x| 加權中位數（Losses §2.2.1 與 §2.6 表格的說法）', () => {
    // x = 1（機率 0.6，y/x = 0）或 x = 4（機率 0.4，y/x = 10）：不加權中位數 0、|x| 加權中位數 10
    const rng = createRng(77)
    const N = 40000
    const data = { x: new Float64Array(N), y: new Float64Array(N), outlier: new Uint8Array(N) }
    for (let i = 0; i < N; i++) {
      const small = rng.uniform() < 0.6
      data.x[i] = small ? 1 : 4
      data.y[i] = small ? 0 : 40
    }
    const o = { w0: 5, mu: 0.05, tie: 'zero' as TieRule, huberDelta: 1 }
    const ss = timeAverage(runVariantOnData('sign_sign', data, o).w)
    const se = timeAverage(runVariantOnData('sign_error', data, o).w)
    expect(Math.abs(ss.mean - 0)).toBeLessThan(0.2)
    expect(Math.abs(se.mean - 10)).toBeLessThan(0.5)
    expect(batchL1(data.x, data.y)).toEqual({ lo: 10, hi: 10 }) // 批次 |x| 加權中位數
  })

  it('noiseMixture / mixtureMedian：four_point 的中位數為 0（點質量 ¾）', () => {
    expect(mixtureMedian(noiseMixture(FOUR))).toEqual({ lo: 0, hi: 0 })
  })

  it('估計量效率：乾淨 Gaussian 時 Var(中位數)/Var(平均) ≈ π/2；ε = 0.1 的 outlier 時中位數勝出', () => {
    const clean = estimatorEfficiency({ n: 201, trials: 3000, sigma: 1, outlierProb: 0, outlierSize: 0, huberDelta: 1.345, seed: 1 })
    const ratio = clean.median.variance / clean.mean.variance
    expect(ratio).toBeGreaterThan(1.4)
    expect(ratio).toBeLessThan(1.75)
    const dirty = estimatorEfficiency({ n: 201, trials: 2000, sigma: 1, outlierProb: 0.1, outlierSize: 20, huberDelta: 1.345, seed: 2 })
    const mse = (e: { avg: number; variance: number }) => e.avg ** 2 + e.variance
    expect(mse(dirty.median)).toBeLessThan(mse(dirty.mean) / 10)
    expect(mse(dirty.huber)).toBeLessThan(mse(dirty.mean) / 10)
  })

  it('pole 與 lms.ts 一致', () => {
    expect(fixedXStability(0.37, -1.3).pole).toBe(fixedXPole(0.37, -1.3))
  })
})

/** 樣本平均與樣本標準差（ddof = 1） */
function meanStd(v: number[]): { m: number; s: number } {
  const m = v.reduce((p, q) => p + q, 0) / v.length
  return { m, s: Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / (v.length - 1)) }
}

describe('lossCompare：Sign-Error 的抖動——O(μ|x|) 只適用於點質量資料（審查修正）', () => {
  const GAUSS: LossDataParams = { ...FOUR, model: 'contaminated', a: 0, xDist: 'const', xScale: 1, sigma: 1, outlierProb: 0, outlierSize: 0, n: 0 }

  it('F-01.18：Gaussian 雜訊下 Var(w) ≈ μ/(4f(m)) = (μ/2)√(π/2)σ_v，與 lattice 精確 std 在小 μ 時相差 < 1%', () => {
    for (const [mu, tolRel] of [
      [0.2, 0.05],
      [0.05, 0.012],
      [0.0125, 0.004],
    ]) {
      const ap = signErrorJitterApprox(GAUSS, mu)
      expect(ap.applicable).toBe(true)
      expect(ap.density).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12) // f(0) = 1/(√(2π)σ)
      expect(ap.variance).toBeCloseTo((mu / 2) * Math.sqrt(Math.PI / 2), 12)
      const lat = signErrorLatticeStationary(GAUSS, { w0: 0, mu, tie: 'zero' })!
      expect(lat.truncated).toBe(false)
      expect(Math.abs(Math.sqrt(ap.variance) / lat.std - 1)).toBeLessThan(tolRel)
    }
  })

  it('反面：「Sign-Error 的軌跡困在中位數 ± μ|x| 內」在連續雜訊下不成立——std 是 O(√μ)，μ 縮小 16 倍 std 只縮小約 4 倍', () => {
    const big = signErrorLatticeStationary(GAUSS, { w0: 0, mu: 0.2, tie: 'zero' })!
    const small = signErrorLatticeStationary(GAUSS, { w0: 0, mu: 0.0125, tie: 'zero' })!
    expect(small.std / 0.0125).toBeGreaterThan(6) // std 是單步步長的 7 倍：不在 ±μ|x| 帶內
    expect(big.std / small.std).toBeGreaterThan(3.9)
    expect(big.std / small.std).toBeLessThan(4.3) // √16 = 4，不是 16
    // 落在 ±μ 帶外的機率超過一半
    const outside = small.grid.reduce((acc, g, i) => (Math.abs(g) > 0.0125 + 1e-12 ? acc + small.pi[i] : acc), 0)
    expect(outside).toBeGreaterThan(0.5)
    // 但「時間平均」離中位數仍是 O(μ)（E40 的界）
    expect(Math.abs(small.mean)).toBeLessThan(0.0125)
    // 對照：點質量資料 {0,0,0,10} 的 std 確實是 O(μ)：(√3/2)μ
    for (const mu of [0.2, 0.05]) {
      const four = signErrorLatticeStationary(FOUR, { w0: 0, mu, tie: 'zero' })!
      expect(four.std / mu).toBeCloseTo(Math.sqrt(3) / 2, 9)
    }
    expect(signErrorJitterApprox(FOUR, 0.2).applicable).toBe(false) // 點質量沒有密度
    expect(signErrorJitterApprox({ ...GAUSS, sigma: 0 }, 0.2).applicable).toBe(false)
    expect(signErrorJitterApprox({ ...GAUSS, xScale: 0 }, 0.2).applicable).toBe(false)
  })

  it('同樣收斂速度（μ_L = μK_q）下 Var(Sign-Error)/Var(LMS) → π/2（1-bit 的代價）；K_q = √(2/π)/σ_v 與 Ch05 的 T04 一致', () => {
    const sigma = 100 // fs（T04 的 comparator 雜訊）
    const p: LossDataParams = { ...GAUSS, sigma }
    const mu = 1 // fs：μK_q ≈ 0.008 ≪ 1
    const ap = signErrorJitterApprox(p, mu)
    const kq = 2 * ap.density
    expect(kq).toBeCloseTo(golden('T04').expected.kq_per_fs as number, 10) // 0.00797885 /fs
    const lat = signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!
    const lms = lmsSteadyState(p, mu * kq)
    expect(lat.std ** 2 / lms.variance).toBeGreaterThan(1.55)
    expect(lat.std ** 2 / lms.variance).toBeLessThan(1.58) // π/2 = 1.5708
  })

  it('一般 x：擴散近似與 |x| 無關——x ≡ 2、x = ±0.5 的 lattice std 與 √(μ/(4f)) 相差 < 2%；Gaussian x 的模擬 std 相差 < 8%', () => {
    const base: LossDataParams = { ...GAUSS, a: 3, outlierProb: 0.1, outlierSize: 20 }
    const mu = 0.01
    for (const cfg of [
      { ...base, xScale: 2 },
      { ...base, xDist: 'pm1' as const, xScale: 0.5 },
    ]) {
      const ap = signErrorJitterApprox(cfg, mu)
      const lat = signErrorLatticeStationary(cfg, { w0: 0, mu, tie: 'zero' })!
      expect(ap.smallness).toBeLessThan(0.05)
      expect(Math.abs(Math.sqrt(ap.variance) / lat.std - 1)).toBeLessThan(0.02)
    }
    // x ≡ A：固定點是雜訊的中位數；x 零均值：固定點是 0
    expect(signErrorJitterApprox(base, mu).tStar).toBeCloseTo(0.13971, 4)
    expect(signErrorJitterApprox({ ...base, xDist: 'pm1' }, mu).tStar).toBe(0)
    const g: LossDataParams = { ...base, xDist: 'gaussian', sigma: 0.5, outlierProb: 0.05, outlierSize: 30, n: 200000, seed: 5 }
    const ta = timeAverage(runVariantOnData('sign_error', generateLossData(g), { w0: 3, mu, tie: 'zero', huberDelta: 1 }).w)
    expect(Math.abs(ta.std / Math.sqrt(signErrorJitterApprox(g, mu).variance) - 1)).toBeLessThan(0.08)
    expect(ta.std).toBeGreaterThan(5 * mu * Math.sqrt(2 / Math.PI)) // 遠大於典型步長 μE|x|
  })

  it('mixtureDensity / mixtureRawMoments：混合 Gaussian 的密度與動差', () => {
    const mix = noiseMixture({ ...GAUSS, outlierProb: 0.1, outlierSize: 20 })
    // 數值積分 ∫f = 1、∫t²f = E[ṽ²]
    let area = 0
    let m2 = 0
    let m4 = 0
    const h = 0.001
    for (let t = -10; t <= 30; t += h) {
      const fv = mixtureDensity(mix, t)
      area += fv * h
      m2 += t * t * fv * h
      m4 += t ** 4 * fv * h
    }
    const mom = mixtureRawMoments(mix)
    expect(area).toBeCloseTo(1, 6)
    expect(mom.m1).toBeCloseTo(2, 12) // εs
    expect(mom.m2).toBeCloseTo(m2, 4)
    expect(mom.m4 / m4).toBeCloseTo(1, 5)
    expect(Number.isNaN(mixtureDensity(noiseMixture(FOUR), 0))).toBe(true)
  })
})

describe('lossCompare：交叉比對用的標準誤（審查修正：容忍度不是猜的百分比）', () => {
  it('timeAverage：批次長度 ≥ 5τ；樣本太短（< 8 個獨立批次）時 SE = NaN，不做假的檢定', () => {
    // AR(1)：w_{n+1} = p·w_n + ε，τ = (1+p)/(1−p)
    const rng = createRng(123)
    const make = (p: number, n: number) => {
      const w = new Float64Array(n)
      for (let i = 1; i < n; i++) w[i] = p * w[i - 1] + rng.normal()
      return w
    }
    const long = timeAverage(make(0.9, 200000))
    expect(long.tau).toBeGreaterThan(15)
    expect(long.tau).toBeLessThan(23) // 理論 19
    expect(long.batchLen).toBeGreaterThanOrEqual(Math.ceil(5 * long.tau))
    expect(long.nBatches).toBeGreaterThanOrEqual(MIN_BATCHES)
    // 理論 SE(平均) = σ_w·√(τ/n)，σ_w² = 1/(1 − p²)
    const theory = Math.sqrt((1 / (1 - 0.81)) * (19 / long.n))
    expect(long.se / theory).toBeGreaterThan(0.6)
    expect(long.se / theory).toBeLessThan(1.5)
    expect(long.n).toBe(100000)
    const short = timeAverage(make(0.99, 1200)) // τ ≈ 199 ⇒ 600 筆切不出 8 批
    expect(short.nBatches).toBeLessThan(MIN_BATCHES)
    expect(Number.isNaN(short.se)).toBe(true)
    expect(Number.isNaN(short.varSe)).toBe(true)
    expect(Number.isFinite(short.mean)).toBe(true)
  })

  it('lmsSteadyState 的理論標準誤（AR(1) + Bartlett）= 多個 seed 的實際離散程度（x ≡ 1、x = ±1；± 25%）', () => {
    const cases: [LossDataParams, number][] = [
      [{ ...FOUR, n: 4000 }, 0.2],
      [{ ...FOUR, model: 'contaminated', a: 3, xDist: 'pm1', sigma: 1, outlierProb: 0.1, outlierSize: 20, n: 6000 }, 0.05],
    ]
    for (const [base, mu] of cases) {
      const ss = lmsSteadyState(base, mu)
      expect(ss.seExact).toBe(true)
      expect(ss.pole).toBeCloseTo(1 - mu, 12)
      expect(ss.tauMean).toBeCloseTo((2 - mu) / mu, 9)
      const means: number[] = []
      const vars: number[] = []
      let n = 0
      for (let seed = 1; seed <= 160; seed++) {
        const ta = timeAverage(runVariantOnData('conventional', generateLossData({ ...base, seed }), { w0: ss.mean, mu, tie: 'zero', huberDelta: 1 }).w)
        means.push(ta.mean)
        vars.push(ta.std ** 2)
        n = ta.n
      }
      const seMean = Math.sqrt((ss.variance * ss.tauMean) / n)
      const seVar = ss.variance * Math.sqrt(ss.varFactor / n)
      expect(meanStd(means).s / seMean).toBeGreaterThan(0.75)
      expect(meanStd(means).s / seMean).toBeLessThan(1.25)
      expect(meanStd(vars).s / seVar).toBeGreaterThan(0.75)
      expect(meanStd(vars).s / seVar).toBeLessThan(1.25)
      expect(Math.abs(meanStd(means).m - ss.mean)).toBeLessThan((4 * seMean) / Math.sqrt(160))
    }
    // {0,0,0,10} 的峰度 η = 7/3 ⇒ c = η − 3 + 2(1 + p²)/(1 − p²)
    const ss = lmsSteadyState(FOUR, 0.2)
    expect(ss.varFactor).toBeCloseTo(7 / 3 - 3 + (2 * 1.64) / 0.36, 9)
    expect(lmsSteadyState({ ...FOUR, model: 'contaminated', xDist: 'gaussian', sigma: 1 }, 0.05).seExact).toBe(false)
    expect(Number.isNaN(lmsSteadyState(FOUR, 2.5).tauMean)).toBe(true) // 不穩定：沒有標準誤
  })

  it('lattice 鏈的精確標準誤（Poisson 方程式封閉解）= 多個 seed 的定點 Sign-Error 時間平均／樣本變異數的離散程度（± 25%）', () => {
    const cases: [LossDataParams, number, TieRule][] = [
      [{ ...FOUR, n: 6000 }, 0.2, 'zero'],
      [{ ...FOUR, model: 'contaminated', a: 3, sigma: 1, outlierProb: 0.1, outlierSize: 20, n: 6000 }, 0.05, 'plus'],
    ]
    for (const [base, mu, tie] of cases) {
      const lat = signErrorLatticeStationary(base, { w0: 0, mu, tie })!
      const means: number[] = []
      const vars: number[] = []
      let n = 0
      for (let seed = 1; seed <= 160; seed++) {
        const fx = signErrorFixedPointRun(generateLossData({ ...base, seed }), { w0: 0, mu, tie })!
        const ta = timeAverage(fx.w)
        means.push(ta.mean)
        vars.push(ta.std ** 2)
        n = ta.n
      }
      const seMean = Math.sqrt(lat.meanAvar / n)
      const seVar = Math.sqrt(lat.varAvar / n)
      expect(meanStd(means).s / seMean).toBeGreaterThan(0.75)
      expect(meanStd(means).s / seMean).toBeLessThan(1.25)
      expect(meanStd(vars).s / seVar).toBeGreaterThan(0.7)
      expect(meanStd(vars).s / seVar).toBeLessThan(1.3)
      expect(Math.abs(meanStd(means).m - lat.mean)).toBeLessThan((4 * seMean) / Math.sqrt(160) + 1e-4)
    }
    // piMax 以迴圈計算，與 pi 陣列一致
    const lat = signErrorLatticeStationary(FOUR, { w0: 0, mu: 0.2, tie: 'zero' })!
    expect(lat.piMax).toBeCloseTo(Math.max(...lat.pi), 15)
    expect(lat.piMax).toBeCloseTo(2 / 3, 12)
  })

  it('E40 的數值證據（T01 參數、無雜訊 Sign-Error）：精確算術 zero → 凍結在 3、plus → {3, 3.2}、minus → {2.8, 3}；IEEE double → {2.8, 3.0000000000000004}', () => {
    const N = 60
    const data = { x: new Float64Array(N).fill(2), y: new Float64Array(N).fill(6), outlier: new Uint8Array(N) }
    const cycle = (w: Float64Array) => Array.from(new Set(Array.from(w.slice(-8)))).sort((p, q) => p - q)
    const fixed = (tie: TieRule) => cycle(signErrorFixedPointRun(data, { w0: 1, mu: 0.1, tie })!.w)
    expect(fixed('zero')).toEqual([3])
    expect(fixed('plus').map((v) => Number(v.toFixed(12)))).toEqual([3, 3.2])
    expect(fixed('minus').map((v) => Number(v.toFixed(12)))).toEqual([2.8, 3])
    // IEEE double 連加：1 + 10×0.2 ≠ 3 ⇒ e = 0 不會發生，三種慣例都落在同一個循環
    for (const tie of ['zero', 'plus', 'minus'] as TieRule[]) {
      const c = cycle(runVariantOnData('sign_error', data, { w0: 1, mu: 0.1, tie, huberDelta: 1 }).w)
      expect(c).toHaveLength(2)
      expect(c[1]).toBe(3.0000000000000004)
      expect(c[0]).toBeCloseTo(2.8, 12)
    }
    // 對應的 lattice：單一狀態（凍結）、平均 3、時間平均的標準誤為 0
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 3, xScale: 2, sigma: 0 }
    const lat = signErrorLatticeStationary(p, { w0: 1, mu: 0.1, tie: 'zero' })!
    expect(lat.mean).toBeCloseTo(3, 12)
    expect(lat.std).toBe(0)
    expect(lat.meanAvar).toBe(0)
    const latPlus = signErrorLatticeStationary(p, { w0: 1, mu: 0.1, tie: 'plus' })!
    expect(latPlus.mean).toBeCloseTo(3.1, 12) // {3, 3.2} 各半
    expect(latPlus.meanAvar).toBeCloseTo(0, 12) // 確定性的來回：時間平均沒有隨機誤差
    // IEEE 的時間平均 2.9 與精確值 3 差 0.1 ≤ μ|x| = 0.2：正是 E40 要求的驗證容忍度
    const ieee = timeAverage(runVariantOnData('sign_error', data, { w0: 1, mu: 0.1, tie: 'zero', huberDelta: 1 }).w)
    expect(Math.abs(ieee.mean - lat.mean)).toBeGreaterThan(0.09)
    expect(Math.abs(ieee.mean - lat.mean)).toBeLessThanOrEqual(0.2)
  })

  it('runTieStudy 回報軌跡的 std 與 lattice 精確 std', () => {
    const res = runTieStudy({ data: { ...FOUR, n: 60000 }, w0: 0, mu: 0.2 })
    const fz = res.rows.find((r) => r.arithmetic === 'fixed' && r.tie === 'zero')!
    expect(fz.latticeStd).toBeCloseTo((0.2 * Math.sqrt(3)) / 2, 9)
    expect(fz.std / fz.latticeStd!).toBeGreaterThan(0.9)
    expect(fz.std / fz.latticeStd!).toBeLessThan(1.1)
  })
})

