import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { classifyPole, runScalarLms } from '@/simulation/models/lms'
import {
  CLEAN_DATA,
  NOISY_DATA,
  STEADY_STATE_EXAMPLE,
  analyticGradient,
  averagedStd,
  biasedFixedPoint,
  centralDifference,
  closedFormW,
  comparatorTeaser,
  correlatedNoiseBias,
  decimalToFraction,
  diceAverages,
  directionProbabilityClt,
  doubleMinusExact,
  doubleToFraction,
  equivalentAveragingLength,
  exactLmsTrace,
  fractionToString,
  handCalcRows,
  kurtosisExcessFloor,
  leastSquaresGain,
  lmsOnData,
  makeFraction,
  noiseAverageDegeneracy,
  poleTable,
  powerOfTwoCheckpoints,
  productMoments,
  productMomentsFromMoments,
  ratioTable,
  regressorMoments,
  sampleCost,
  samplesForTargetStd,
  signTieDemo,
  simulateNoiseAverage,
  stdTolerance,
  steadyStateVarW,
  stepsToFraction,
  timeAverageVarianceError,
  ulpOf,
  varianceZScore,
} from './model'
import { FORMULAS } from './formulas'
import { POLE_BEHAVIOUR_TEX, texNum, texRes } from './format'
import {
  DEFAULT_BASE,
  DIVERGE_LIMIT,
  MIN_VARIANCE_ESS,
  analyticDecayLine,
  analyticMaxError,
  ar1SampleVarianceFactor,
  ar1VarianceEss,
  baseWarnings,
  behaviourLabel,
  caseWarnings,
  deltaPlotScale,
  ePlotRange,
  runCase,
  steadyStateCheck,
  wPlotRange,
} from './experiments/playgroundModel'
import { effectiveSampleSize } from '@/simulation/core'
import { LEARNING_MAP } from './learningMap'

interface Vector {
  inputs: Record<string, number | number[]>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

function vector(id: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${id}.json`), 'utf8')) as Vector
}

function close(actual: number, expected: number, tol: { abs?: number; rel?: number }) {
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound)
}

describe('ch00：手算表與 T01', () => {
  const T01 = vector('T01')
  const inp = T01.inputs as { a: number; w0: number; x: number; mu: number; steps: number }

  it('T01: handCalcRows（conventionalStep）重現 w1 = 1.8、w2 = 2.28 與完整 w/e 軌跡（golden 容忍 1e-12）', () => {
    const rows = handCalcRows(inp)
    expect(rows).toHaveLength(inp.steps)
    close(rows[0].wNext, T01.expected.w1 as number, T01.tolerance)
    close(rows[1].wNext, T01.expected.w2 as number, T01.tolerance)
    close(rows[0].e, T01.expected.e0 as number, T01.tolerance)
    close(rows[1].e, T01.expected.e1 as number, T01.tolerance)
    const wTrace = [rows[0].w, ...rows.map((r) => r.wNext)]
    ;(T01.expected.w_trace as number[]).forEach((w, i) => close(wTrace[i], w, T01.tolerance))
    ;(T01.expected.e_trace as number[]).forEach((e, i) => close(rows[i].e, e, T01.tolerance))
    // δ_{n+1}/δ_n 就是 pole 0.6
    rows.forEach((r) => close(r.ratio, T01.expected.pole as number, { abs: 1e-12 }))
  })

  it('T01: 精確有理數 w1 = 9/5、w2 = 57/25，double 版本與精確值相差 ≤ 1e-12', () => {
    const ex = exactLmsTrace(inp)
    expect(ex.map(fractionToString).slice(0, 3)).toEqual(['1', '9/5', '57/25'])
    const rows = handCalcRows(inp)
    ex.slice(1).forEach((f, i) => close(rows[i].wNext, Number(f.num) / Number(f.den), { abs: 1e-12 }))
    // double 的 w2 不是剛好 2.28（1 ulp），所以測試不能用 ===
    expect(rows[1].wNext).not.toBe(2.28)
  })

  it('T01: δ 採全站極性 a − w（勘誤 E39）：+2、+1.2、+0.72', () => {
    const rows = handCalcRows(inp)
    close(rows[0].delta, 2, { abs: 1e-12 })
    close(rows[1].delta, 1.2, { abs: 1e-12 })
    close(rows[2].delta, 0.72, { abs: 1e-12 })
  })

  it('封閉解 w_n = a − (a − w0)pⁿ 與遞迴一致', () => {
    const rows = handCalcRows({ ...inp, steps: 20 })
    rows.forEach((r) => close(r.wNext, closedFormW(inp.a, inp.w0, inp.x, inp.mu, r.n + 1), { abs: 1e-12 }))
  })

  it('T01: double 的 w2 = 2.2800000000000002 比最接近 57/25 的 double 大 1 ulp；與精確值的真正差距為 7/28147497671065600 ≈ 2.4869e-16', () => {
    const rows = handCalcRows(inp)
    const w2 = rows[1].wNext
    const exact = exactLmsTrace(inp)[2]
    expect(fractionToString(exact)).toBe('57/25')
    const nearest = Number(exact.num) / Number(exact.den)
    expect((w2 - nearest) / ulpOf(nearest)).toBe(1)
    expect(ulpOf(nearest)).toBe(2 ** -51)
    // 精確相減（BigInt）：不是 w2 − 2.28 的 double 差（那會得到 1 ulp = 4.44e-16）
    const diff = doubleMinusExact(w2, exact)
    expect(diff).toBeCloseTo(7 / 28147497671065600, 30)
    expect(diff).toBeLessThan(w2 - nearest)
  })

  it('doubleToFraction 是精確的（0.1 的 IEEE double = 3602879701896397/2^55）', () => {
    expect(fractionToString(doubleToFraction(0.1))).toBe('3602879701896397/36028797018963968')
    expect(fractionToString(doubleToFraction(-2.5))).toBe('-5/2')
    expect(fractionToString(doubleToFraction(6))).toBe('6')
    expect(fractionToString(doubleToFraction(Number.MIN_VALUE))).toBe(`1/${2n ** 1074n}`)
    expect(doubleMinusExact(0.1, makeFraction(1n, 10n))).toBeCloseTo(5.551115123125783e-18, 30)
    expect(() => doubleToFraction(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('decimalToFraction 處理小數與指數寫法', () => {
    expect(fractionToString(decimalToFraction(0.1))).toBe('1/10')
    expect(fractionToString(decimalToFraction('1e-5'))).toBe('1/100000')
    expect(fractionToString(decimalToFraction(-2.5))).toBe('-5/2')
    expect(() => decimalToFraction(Number.NaN)).toThrow()
  })
})

describe('ch00：pole 與穩定性（T02）', () => {
  const T02 = vector('T02')
  it('T02: x = 2 的 pole 與收斂判定符合 golden（0 < μ < 0.5；μ = 0.25 一步到位）', () => {
    const mus = T02.inputs.mu_list as number[]
    const rows = poleTable(T02.inputs.x as number, mus)
    rows.forEach((r, i) => {
      close(r.p, (T02.expected.pole_list as number[])[i], T02.tolerance)
      const converges = ['monotone', 'oscillating', 'deadbeat'].includes(r.behaviour) ? 1 : 0
      expect(converges).toBe((T02.expected.converges_list as number[])[i])
    })
    expect(classifyPole(1 - (T02.expected.mu_one_step as number) * 4)).toBe('deadbeat')
  })

  it('pole 行為的 TeX 說明涵蓋 classifyPole 的每一種結果，且 $…$ 成對（會交給 mathText 排版）', () => {
    const seen = new Set([-1.6, -1, -0.6, 0, 0.6, 1, 1.2].map((p) => classifyPole(p)))
    expect(seen).toEqual(new Set(['divergent', 'boundary', 'oscillating', 'deadbeat', 'monotone', 'frozen']))
    for (const b of seen) {
      const label = POLE_BEHAVIOUR_TEX[b]
      expect(label, b).toMatch(/^\$[^$]+\$：/)
      expect((label.match(/\$/g) ?? []).length % 2).toBe(0)
      expect(behaviourLabel(b)).toBe(label)
    }
  })

  it('stepsToFraction：p = 0.6 需 10 步到 1%、p = 0 一步、|p| ≥ 1 永不', () => {
    expect(stepsToFraction(0.6)).toBe(10)
    expect(0.6 ** 10).toBeLessThanOrEqual(0.01)
    expect(0.6 ** 9).toBeGreaterThan(0.01)
    expect(stepsToFraction(0)).toBe(1)
    expect(stepsToFraction(-1)).toBe(Number.POSITIVE_INFINITY)
    expect(stepsToFraction(1.2)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('ch00：黑盒子資料與梯度', () => {
  it('乾淨資料每筆 y/x = 3；含雜訊資料最小平方解 = 64.6/21', () => {
    expect(ratioTable(CLEAN_DATA).map((r) => r.ratio)).toEqual([3, 3, 3])
    const ls = leastSquaresGain(NOISY_DATA)
    expect(ls.sxy).toBeCloseTo(64.6, 12)
    expect(ls.sxx).toBe(21)
    expect(ls.w).toBeCloseTo(64.6 / 21, 12)
    expect(Number.isNaN(leastSquaresGain([[0, 1]]).w)).toBe(true)
  })

  it('固定 μ 循環資料時，LMS 停在最小平方解附近 O(μ)（差距約與 μ 成正比）', () => {
    const ls = leastSquaresGain(NOISY_DATA).w
    const d = [0.02, 0.005, 0.001].map((mu) => {
      const t = lmsOnData(NOISY_DATA, 1, mu, 3000)
      return t[t.length - 1] - ls
    })
    expect(Math.abs(d[0])).toBeGreaterThan(Math.abs(d[1]))
    expect(Math.abs(d[1])).toBeGreaterThan(Math.abs(d[2]))
    const ratio = d[0] / d[1] // 理想上 ≈ 0.02/0.005 = 4
    expect(ratio).toBeGreaterThan(3)
    expect(ratio).toBeLessThan(5.5)
  })

  it('單筆成本帶 ½（勘誤 E41）：j(1) = ½·4² = 8；dj/dw = −e·x = −8，中央差分一致', () => {
    expect(sampleCost(1, 2, 6)).toBe(8)
    expect(analyticGradient(1, 2, 6)).toBe(-8)
    expect(centralDifference(1, 2, 6)).toBeCloseTo(-8, 9)
    // 沒有 ½ 的成本梯度是兩倍
    const h = 1e-6
    const noHalf = (((6 - 2 * (1 + h)) ** 2 - (6 - 2 * (1 - h)) ** 2) / (2 * h)) as number
    expect(noHalf / analyticGradient(1, 2, 6)).toBeCloseTo(2, 5)
  })
})

describe('ch00：雜訊平均（1/√N）', () => {
  it('productMoments：Gaussian δ=1、σ_v=1 ⇒ s₁² = 3；±1 碼 ⇒ s₁² = σ_v²', () => {
    expect(productMoments(3, 2, 1, 'gaussian')).toEqual({ mean: 1, variance: 3 })
    expect(productMoments(3, 2, 1, 'pm_one')).toEqual({ mean: 1, variance: 1 })
    expect(productMoments(3, 5, 0.5, 'gaussian').mean).toBe(-2) // 平均更新方向與 a − w 同號
  })

  it('同 seed 可重現；不同 seed 不同', () => {
    const p = { a: 3, w: 2, sigmaV: 1, xKind: 'gaussian' as const, trials: 50, nMax: 256, seed: 7 }
    const r1 = simulateNoiseAverage(p)
    const r2 = simulateNoiseAverage(p)
    expect(r1.mcStd).toEqual(r2.mcStd)
    expect(simulateNoiseAverage({ ...p, seed: 8 }).mcStd).not.toEqual(r1.mcStd)
    expect(powerOfTwoCheckpoints(256)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256])
  })

  it.each([
    ['gaussian', 1],
    ['gaussian', 3],
    ['pm_one', 1],
  ] as const)('Monte Carlo std 與 s₁/√N 一致（x = %s、σ_v = %s；所有檢查點 |z| < 4）', (xKind, sigmaV) => {
    const r = simulateNoiseAverage({ a: 3, w: 2, sigmaV, xKind, trials: 200, nMax: 1024, seed: 20261010 })
    r.mcStd.forEach((s, k) => expect(Math.abs(varianceZScore(s, r.theoryStd[k], r.mcKurtosis[k], 200))).toBeLessThan(4))
    // 總平均在 4 個標準誤內
    const se = r.s1 / Math.sqrt(1024 * 200)
    expect(Math.abs(r.mcMean[r.mcMean.length - 1] - r.theoryMean)).toBeLessThan(4 * se)
    // N 大時 sign 幾乎都正確
    expect(r.mcCorrect[r.mcCorrect.length - 1]).toBeGreaterThan(0.99)
  })

  it('退化情況的說明分類：±1 且無雜訊 → 每筆相同；w = a 且無雜訊 → 全為 0；w = a 有雜訊 → 只剩雜訊', () => {
    expect(noiseAverageDegeneracy(3, 2, 0, 'pm_one')).toEqual({ kind: 'no-randomness', constant: 1 })
    expect(noiseAverageDegeneracy(3, 3, 0, 'gaussian')).toEqual({ kind: 'no-randomness', constant: 0 })
    expect(noiseAverageDegeneracy(3, 3, 1, 'gaussian')).toEqual({ kind: 'at-answer' })
    expect(noiseAverageDegeneracy(3, 2, 0, 'gaussian')).toEqual({ kind: 'none' })
  })

  it('擲骰子平均：固定 seed，誤差在 4 個理論標準差內', () => {
    const d = diceAverages(20261010, [10, 100, 1000, 10000])
    expect(d.map((x) => x.n)).toEqual([10, 100, 1000, 10000])
    d.forEach((x) => expect(Math.abs(x.err)).toBeLessThan(4 * x.theoryStd))
    expect(diceAverages(20261010, [100])[0].avg).toBe(d[1].avg)
  })
})

describe('ch00：穩態變異數 Var(w∞) = μσ_v²/(2 − μx²)', () => {
  it('兩種寫法相等；|p| ≥ 1 時無穩態', () => {
    for (const mu of [0.01, 0.05, 0.2, 0.4]) {
      expect(steadyStateVarW(mu, 2, 0.5)).toBeCloseTo((mu * 0.25) / (2 - mu * 4), 14)
    }
    expect(steadyStateVarW(0.6, 2, 0.5)).toBe(Number.POSITIVE_INFINITY)
    expect(steadyStateVarW(0.1, 0, 0.5)).toBe(0)
  })

  it('AR(1) 樣本變異數的有限樣本因子 c(p, n) 與直接雙重求和一致；變異數用的有效樣本數 n(1 − p²)/(1 + p²)', () => {
    for (const p of [-0.6, 0, 0.6, 0.96]) {
      for (const n of [5, 40]) {
        let S = 0
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S += p ** Math.abs(i - j)
        expect(ar1SampleVarianceFactor(p, n)).toBeCloseTo((n - S / n) / (n - 1), 12)
      }
    }
    expect(ar1SampleVarianceFactor(-0.6, 5)).toBeCloseTo(1.16224, 12)
    expect(ar1VarianceEss(0, 100)).toBe(100)
    expect(ar1VarianceEss(-0.6, 100)).toBeCloseTo(100 * 0.64 / 1.36, 12)
  })

  it('反面測試：p < 0（震盪收斂）時，估「平均」用的 ESS 會大於 n，拿來當變異數的誤差棒會過度自信', () => {
    const base = { ...DEFAULT_BASE, steps: 1000, sigmaV: 0.5 }
    const r = runCase(base, 0.4, 3, null) // p = −0.6
    const chk = steadyStateCheck(base, r, null)!
    const meanEss = effectiveSampleSize(r.w.subarray(chk.start))
    expect(meanEss).toBeGreaterThan(chk.used) // 平均值用的 ESS：n(1 − p)/(1 + p) ≈ 4n（有上限截斷）
    expect(chk.ess).toBeLessThan(chk.used) // 變異數用的 ESS ≈ 0.47n
    expect(chk.ess).toBeCloseTo(chk.used * (1 - 0.36) / (1 + 0.36), 6)
  })

  it.each([0.02, 0.2, 0.4, 0.45])('穩態 z 檢定校準正確（μ = %s，60 個 seed：z 的標準差 ≈ 1、沒有 |z| ≥ 4 的假警報）', (mu) => {
    const base = { ...DEFAULT_BASE, steps: 1000, sigmaV: 0.5 }
    const zs: number[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const chk = steadyStateCheck(base, runCase(base, mu, seed, null), null)
      expect(chk).not.toBeNull()
      zs.push(chk!.z)
    }
    const m = zs.reduce((a, b) => a + b, 0) / zs.length
    const sd = Math.sqrt(zs.reduce((a, b) => a + (b - m) ** 2, 0) / (zs.length - 1))
    expect(Math.abs(m)).toBeLessThan(0.5)
    expect(sd).toBeGreaterThan(0.7)
    expect(sd).toBeLessThan(1.35)
    expect(Math.max(...zs.map(Math.abs))).toBeLessThan(4)
  })

  it('有效樣本數太少（μ 很小、步數不夠）時不做 z 檢定（回傳 null，而不是給出不可信的結論）', () => {
    const base = { ...DEFAULT_BASE, steps: 1000, sigmaV: 0.5 }
    expect(steadyStateCheck(base, runCase(base, 0.01, 1, null), null)).toBeNull()
    const longer = { ...base, steps: 2000 }
    const chk = steadyStateCheck(longer, runCase(longer, 0.01, 1, null), null)
    expect(chk).not.toBeNull()
    expect(chk!.ess).toBeGreaterThanOrEqual(MIN_VARIANCE_ESS)
  })

  it('長時間 runScalarLms 的樣本變異數與公式一致（ESS 修正，|z| < 4）', () => {
    const base = { ...DEFAULT_BASE, steps: 20000, sigmaV: 0.5 }
    for (const mu of [0.02, 0.2]) {
      const r = runCase(base, mu, 12345, null)
      const chk = steadyStateCheck(base, r, null)
      expect(chk).not.toBeNull()
      expect(Math.abs(chk!.z)).toBeLessThan(4)
      expect(chk!.stdTheory).toBeCloseTo(Math.sqrt((mu * 0.25) / (2 - 4 * mu)), 12)
    }
  })
})

describe('ch00：反面測試（失敗模式要被偵測並解釋）', () => {
  it('T02: 反面測試——μ < 0（極性錯誤）：|δ| 每步放大 1 + |μ|x²，警告提到 polarity', () => {
    const r = runCase(DEFAULT_BASE, -0.05, 1, null)
    expect(r.p).toBeCloseTo(1.2, 12)
    expect(Math.abs(r.delta[20])).toBeCloseTo(2 * 1.2 ** 20, 6)
    const w = caseWarnings('A', DEFAULT_BASE, r)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('polarity')
  })

  it('T02: 反面測試——μ = 0.65 > 2/x²：震盪發散，第 58 步 |w| 超過 1e12 後停止，警告解釋原因', () => {
    const r = runCase({ ...DEFAULT_BASE, steps: 80 }, 0.65, 1, null)
    expect(r.behaviour).toBe('divergent')
    expect(r.diverged).toBe(true)
    expect(r.divergeStep).toBe(58)
    const w = caseWarnings('C', DEFAULT_BASE, r)
    // 警告字串中的數學以 $…$ 行內 TeX 表示（ExperimentShell 以 KaTeX 顯示）
    expect(w[0]).toContain(String.raw`$\mu=0.65$ 超過穩定上限 $2/x^2=0.5$`)
    expect(w[0]).toContain('$p=1-\\mu x^2=-1.6$')
    expect(w[0]).toContain('第 58 步')
  })

  it('T02: 反面測試——μ = 0.5 邊界：|δ| 不變、正負交替（不收斂），標為 boundary', () => {
    const r = runCase({ ...DEFAULT_BASE, steps: 10 }, 0.5, 1, null)
    expect(r.behaviour).toBe('boundary')
    for (let n = 0; n < 10; n++) expect(r.delta[n + 1]).toBeCloseTo(-r.delta[n], 12)
    expect(caseWarnings('C', DEFAULT_BASE, r)[0]).toContain('邊界')
  })

  it('x = 0：不可辨識，w 永遠不動，警告說明原因', () => {
    const base = { ...DEFAULT_BASE, x: 0 }
    const r = runCase(base, 0.1, 1, null)
    expect(Array.from(r.w).every((v) => v === base.w0)).toBe(true)
    expect(baseWarnings(base)[0]).toContain('不可辨識')
  })

  it('正常 μ 不產生警告；無雜訊時 runScalarLms 與封閉解相對差 ≤ 1e-9', () => {
    const runs = [0.02, 0.1].map((mu) => runCase(DEFAULT_BASE, mu, 1, null))
    runs.forEach((r) => expect(caseWarnings('A', DEFAULT_BASE, r)).toEqual([]))
    expect(analyticMaxError(DEFAULT_BASE, runs, null)).toBeLessThanOrEqual(1e-9)
  })

  it('反面測試（模型公式有錯時不可顯示成功）：封閉解比對會抓到錯的 μ；穩態比對會抓到錯的 σ_v', () => {
    // 拿 μ = 0.1 的模擬軌跡去比 μ = 0.11 的封閉解：相對差遠大於通過門檻 1e-9
    const r = runCase(DEFAULT_BASE, 0.1, 1, null)
    expect(analyticMaxError(DEFAULT_BASE, [r], null)).toBeLessThanOrEqual(1e-9)
    expect(analyticMaxError(DEFAULT_BASE, [{ ...r, mu: 0.11 }], null)).toBeGreaterThan(1e-3)
    // 用 σ_v = 0.5 模擬，卻拿 σ_v = 0.6 的公式（理論 std 大 20%）去比：|z| 必須遠大於 4
    const base = { ...DEFAULT_BASE, steps: 20000, sigmaV: 0.5 }
    const noisy = runCase(base, 0.2, 12345, null)
    expect(Math.abs(steadyStateCheck(base, noisy, null)!.z)).toBeLessThan(4)
    const wrong = steadyStateCheck({ ...base, sigmaV: 0.6 }, { ...noisy, varTheory: steadyStateVarW(0.2, 2, 0.6) }, null)!
    expect(Math.abs(wrong.z)).toBeGreaterThan(10)
  })

  it('圖的縱軸範圍：發散的 Case 不會把收斂的 Case 壓扁（w 與 e 都夾在 a 附近的有限範圍）', () => {
    const base = { ...DEFAULT_BASE, steps: 80 }
    const runs = [0.02, 0.1, 0.65].map((mu) => runCase(base, mu, 1, null))
    const [wlo, whi] = wPlotRange(base, runs)
    expect(whi - wlo).toBeLessThan(20)
    expect(wlo).toBeLessThanOrEqual(base.w0)
    expect(whi).toBeGreaterThanOrEqual(base.a)
    const [elo, ehi] = ePlotRange(base, runs)
    expect(ehi - elo).toBeLessThan(20)
    expect(ehi).toBeGreaterThanOrEqual(base.x * (base.a - base.w0)) // e_0 = x(a − w0) = 4 看得到
  })

  it('|δ| 對數圖的範圍：有雜訊時下限是雜訊地板、解析線不會下溢到 0；發散時上限不超過 1e12', () => {
    // 有雜訊、2000 步：p = 0.2 的解析線 2·0.2ⁿ 若不裁切會在 n ≈ 460 下溢成 0（log 軸被拉到 1e-300）
    const nb = { ...DEFAULT_BASE, steps: 2000, sigmaV: 0.5 }
    const runs = [0.01, 0.05, 0.2].map((mu) => runCase(nb, mu, 20261010, null))
    const sc = deltaPlotScale(nb, runs)
    expect(sc.floor).toBeCloseTo(Math.sqrt(steadyStateVarW(0.01, 2, 0.5)) / 30, 12)
    expect(sc.top).toBeGreaterThanOrEqual(2)
    const line = analyticDecayLine(2, runs[2].p, 2000, sc)
    expect(line.y[0]).toBe(2)
    expect(line.n.length).toBeGreaterThan(2)
    expect(line.n.length).toBeLessThan(10)
    expect(line.y.every((v) => v >= sc.floor && v > 0)).toBe(true)
    expect(2 * 0.2 ** 2000).toBe(0) // 不裁切的話這些點全是 0
    // 發散：模擬在 |w| > 1e12 停止，解析線與縱軸上限也不超過這個門檻（不會畫到 1e300 / Infinity）
    const db = { ...DEFAULT_BASE, steps: 2000 }
    const dr = [runCase(db, 0.65, 1, null)]
    const ds = deltaPlotScale(db, dr)
    expect(ds.top).toBe(DIVERGE_LIMIT)
    const dl = analyticDecayLine(2, dr[0].p, 2000, ds)
    expect(dl.y.every(Number.isFinite)).toBe(true)
    expect(Math.max(...dl.y)).toBeLessThanOrEqual(DIVERGE_LIMIT * (1 + 1e-9))
    expect(dl.n.length).toBeLessThan(70)
    // 無雜訊：下限是倍精度極限（|a|·1e-17）
    expect(deltaPlotScale(DEFAULT_BASE, [runCase(DEFAULT_BASE, 0.1, 1, null)]).floor).toBeCloseTo(3e-17, 25)
    // 退化：w0 = a（全部是 0）也回傳合法範圍
    const z = { ...DEFAULT_BASE, w0: 3 }
    const zs = deltaPlotScale(z, [runCase(z, 0.1, 1, null)])
    expect(zs.floor).toBeGreaterThan(0)
    expect(zs.top).toBeGreaterThan(zs.floor)
    expect(analyticDecayLine(0, 0.6, 30, zs).n).toEqual([])
  })

  it('Freeze：凍結點之前與未凍結的路徑完全相同，之後 w 不變', () => {
    const base = { ...DEFAULT_BASE, steps: 40, sigmaV: 0.3 }
    const full = runCase(base, 0.05, 99, null)
    const fr = runCase(base, 0.05, 99, 15)
    for (let n = 0; n <= 15; n++) expect(fr.w[n]).toBe(full.w[n])
    for (let n = 16; n <= 40; n++) expect(fr.w[n]).toBe(fr.w[15])
    expect(fr.e).toHaveLength(40)
  })
})

describe('ch00：Sign-Error 預告（勘誤 E40）與比較器數字', () => {
  it('μ = 0.125（二進位精確）：三種 sign(0) 慣例行為不同', () => {
    const d = signTieDemo({ a: 3, w0: 1, x: 2, mu: 0.125, steps: 40 })
    expect(d.zero.tail).toEqual([3, 3, 3, 3])
    expect(new Set(d.plus.tail)).toEqual(new Set([3, 3.25]))
    expect(new Set(d.minus.tail)).toEqual(new Set([2.75, 3]))
    expect(d.zero.hitsExactly && d.plus.hitsExactly && d.minus.hitsExactly).toBe(true)
  })

  it('μ = 0.1（T01 參數）：浮點誤差讓 e 永遠不為 0，三種慣例結果相同（2.8000000000000003 / 3.0000000000000004）', () => {
    const d = signTieDemo({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 40 })
    expect(d.zero.tail).toEqual(d.plus.tail)
    expect(d.zero.tail).toEqual(d.minus.tail)
    expect(d.zero.hitsExactly).toBe(false)
    expect(new Set(d.zero.tail)).toEqual(new Set([2.8000000000000003, 3.0000000000000004]))
  })

  it('Sign vs LMS 一步：a=3、x=1、w=1、μ=0.2 ⇒ LMS 1.4、Sign 1.2', () => {
    const lms = runScalarLms({ variant: 'conventional', a: 3, w0: 1, mu: 0.2, steps: 1, x: { kind: 'fixed', value: 1 } })
    const sign = runScalarLms({ variant: 'sign_error', a: 3, w0: 1, mu: 0.2, steps: 1, x: { kind: 'fixed', value: 1 } })
    expect(lms.w[1]).toBeCloseTo(1.4, 12)
    expect(sign.w[1]).toBeCloseTo(1.2, 12)
  })

  it('比較器預告與 golden T04 一致；奇數 N = 10001 的 CLT 方向機率 ≈ 0.7875（勘誤 E02 的數值）', () => {
    const T04 = vector('T04')
    const c = comparatorTeaser(1, 100)
    close(c.pPlus, T04.expected.p_plus as number, T04.tolerance)
    close(c.meanQ, T04.expected.mean_q as number, { abs: 1e-12 })
    expect(directionProbabilityClt(c.meanQ, 10001)).toBeCloseTo(0.787548, 4)
    expect(directionProbabilityClt(c.meanQ, 101)).toBeCloseTo(0.532034, 3)
  })
})

describe('ch00：TeX 數字格式（頁面上所有代入數字的公式都經過這兩個函式）', () => {
  it('texNum：負數加括號（方便寫成乘法）、指數轉成 ×10^{…}、浮點尾數被清掉', () => {
    expect(texNum(2.2800000000000002)).toBe('2.28')
    expect(texNum(-3)).toBe('(-3)')
    expect(texNum(2.4869e-16, 4)).toBe(String.raw`2.487\times10^{-16}`)
    expect(texNum(-1.5e-7)).toBe(String.raw`(-1.5\times10^{-7})`)
    expect(texNum(Number.POSITIVE_INFINITY)).toBe(String.raw`\infty`)
    expect(texNum(Number.NaN)).toBe(String.raw`\text{NaN}`)
  })

  it('texRes：等號右邊的結果不加括號', () => {
    expect(texRes(-8)).toBe('-8')
    expect(texRes(-1.6)).toBe('-1.6')
    expect(texRes(0.6)).toBe('0.6')
    expect(texRes(-1.5e-7)).toBe(String.raw`-1.5\times10^{-7}`)
  })

  it('所有警告字串裡的 $…$ 都成對（極性錯誤、μ = 0、邊界、發散、x = 0）', () => {
    const texts = [
      ...[-0.05, 0, 0.5, 0.65].flatMap((mu) => caseWarnings('A', DEFAULT_BASE, runCase({ ...DEFAULT_BASE, steps: 80 }, mu, 1, null))),
      ...baseWarnings({ ...DEFAULT_BASE, x: 0 }),
    ]
    expect(texts).toHaveLength(5)
    for (const t of texts) {
      expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0)
      expect(t).not.toMatch(/[μσδ²√]/) // 數學一律 LaTeX，不用 Unicode 拼湊
    }
  })
})

describe('ch00：等效平均長度 N_eq = (1 + p)/(1 − p)', () => {
  it('x = 2：μ = 0.01 / 0.05 / 0.1 / 0.25 / 0.4 ⇒ N_eq = 49 / 9 / 4 / 1 / 0.25；一步到位（p = 0）剛好等於 1 筆', () => {
    const want = [49, 9, 4, 1, 0.25]
    ;[0.01, 0.05, 0.1, 0.25, 0.4].forEach((mu, i) => expect(equivalentAveragingLength(mu, 2)).toBeCloseTo(want[i], 12))
  })

  it('定義自洽：σ_v²/(N_eq·x²) 等於 LMS 的穩態變異數 μσ_v²/(2 − μx²)，且 N_eq = (1 + p)/(1 − p)', () => {
    for (const [mu, x, sigma] of [
      [0.01, 2, 0.5],
      [0.3, 1.5, 2],
      [0.4, 2, 0.1],
      [1.2, -1, 0.7],
    ]) {
      const neq = equivalentAveragingLength(mu, x)
      expect((sigma * sigma) / (neq * x * x)).toBeCloseTo(steadyStateVarW(mu, x, sigma), 12)
      const p = 1 - mu * x * x
      expect(neq).toBeCloseTo((1 + p) / (1 - p), 12)
    }
  })

  it('反面測試：μ ≤ 0、μ ≥ 2/x²（沒有穩態）與 x = 0（不可辨識）回傳 NaN，不給出假的數字', () => {
    expect(Number.isNaN(equivalentAveragingLength(0, 2))).toBe(true)
    expect(Number.isNaN(equivalentAveragingLength(-0.1, 2))).toBe(true)
    expect(Number.isNaN(equivalentAveragingLength(0.5, 2))).toBe(true)
    expect(Number.isNaN(equivalentAveragingLength(0.65, 2))).toBe(true)
    expect(Number.isNaN(equivalentAveragingLength(0.1, 0))).toBe(true)
  })

  it('直接模擬：p = 0 時 w_{n+1} = y_n/x，樣本變異數 ≈ σ_v²/x²（N_eq = 1）', () => {
    const base = { ...DEFAULT_BASE, steps: 4000, sigmaV: 0.5 }
    const r = runCase(base, 0.25, 7, null)
    // 每一步都把 w 換成最新一筆的 y/x：w_{n+1}·x 應等於 y_n（只差浮點捨入）
    for (let n = 0; n < 50; n++) expect(r.w[n + 1] * base.x).toBeCloseTo(r.y[n], 12)
    const chk = steadyStateCheck(base, r, null)!
    expect(chk.stdTheory).toBeCloseTo(0.5 / 2, 12)
    expect(Math.abs(chk.z)).toBeLessThan(4)
  })
})

describe('ch00：注意假設——E[v·x] ≠ 0 時的 bias（F-00.11）', () => {
  const demo = { a: 3, w0: 1, mu: 0.02, sigmaV: 0.5, steps: 20000, seed: 20261010 }

  it.each([0, 0.1, 0.2, -0.3])('κ = %s：時間平均收斂到 w* = a + κ（4 個理論標準誤 σ_v/√n 內）', (kappa) => {
    const r = correlatedNoiseBias({ ...demo, kappa })
    expect(r.wStar).toBeCloseTo(3 + kappa, 12)
    expect(r.se).toBeCloseTo(0.5 / Math.sqrt(r.used), 15)
    expect(Math.abs(r.wMean - r.wStar)).toBeLessThan(4 * r.se)
  })

  it('反面測試：κ = 0.2 時若拿真正的 a 當答案，偏差遠超過統計誤差（> 30 個標準誤），不會被誤判成「已校正」', () => {
    const r = correlatedNoiseBias({ ...demo, kappa: 0.2 })
    expect(Math.abs(r.wMean - demo.a)).toBeGreaterThan(30 * r.se)
    expect(r.wMean - demo.a).toBeCloseTo(0.2, 1)
  })

  it('w − w* 的路徑與 κ 無關（同 seed ⇒ 同一條雜訊路徑）；不同 seed 結果不同', () => {
    const r0 = correlatedNoiseBias({ ...demo, kappa: 0 })
    const r1 = correlatedNoiseBias({ ...demo, kappa: 0.2 })
    expect(r1.wMean - r1.wStar).toBeCloseTo(r0.wMean - r0.wStar, 9)
    expect(correlatedNoiseBias({ ...demo, kappa: 0.2 }).wMean).toBe(r1.wMean)
    expect(correlatedNoiseBias({ ...demo, kappa: 0.2, seed: 5 }).wMean).not.toBe(r1.wMean)
  })

  it('標準誤 σ_v/√n 校準正確：120 個 seed 的 z = (w̄ − w*)/SE 標準差 ≈ 1、沒有 |z| ≥ 4', () => {
    const zs: number[] = []
    for (let seed = 1; seed <= 120; seed++) {
      const r = correlatedNoiseBias({ ...demo, kappa: 0.2, steps: 4000, seed })
      zs.push((r.wMean - r.wStar) / r.se)
    }
    const m = zs.reduce((a, b) => a + b, 0) / zs.length
    const sd = Math.sqrt(zs.reduce((a, b) => a + (b - m) ** 2, 0) / (zs.length - 1))
    expect(Math.abs(m)).toBeLessThan(0.35)
    expect(sd).toBeGreaterThan(0.8)
    expect(sd).toBeLessThan(1.25)
    expect(Math.max(...zs.map(Math.abs))).toBeLessThan(4)
  })

  it('軌跡抽樣：stride = 20 時回傳 steps/20 + 1 個點，起點為 w0', () => {
    const r = correlatedNoiseBias({ ...demo, kappa: 0.1, stride: 20 })
    expect(r.traceN).toHaveLength(demo.steps / 20 + 1)
    expect(r.traceN[0]).toBe(0)
    expect(r.traceW[0]).toBe(demo.w0)
    expect(r.traceN[r.traceN.length - 1]).toBe(demo.steps)
  })
})

describe('ch00：退化情況的容忍度（不可把「0 對 0」顯示成不一致）', () => {
  it('kurtosis 為 NaN（樣本全相同）或小於 3 時，一律以 Gaussian 的 κ − 1 = 2 計；容忍度永遠是有限正數', () => {
    expect(kurtosisExcessFloor(Number.NaN)).toBe(2)
    expect(kurtosisExcessFloor(1)).toBe(2)
    expect(kurtosisExcessFloor(15)).toBe(14)
    expect(stdTolerance(0, Number.NaN, 200)).toBe(1e-12)
    expect(Number.isFinite(stdTolerance(1.7, Number.NaN, 200))).toBe(true)
    // SE(s) ≈ ½σ√((κ − 1)/M)：Gaussian、M = 200、σ = 1 ⇒ 4·SE = 0.2
    expect(stdTolerance(1, 3, 200)).toBeCloseTo(0.2, 9)
  })

  it('±1 碼、σ_v = 0（s₁ = 0）：Monte Carlo 的 std 只剩浮點捨入，落在容忍度內；平均等於 a − w', () => {
    for (const w of [2, 2.3]) {
      const r = simulateNoiseAverage({ a: 3, w, sigmaV: 0, xKind: 'pm_one', trials: 200, nMax: 1024, seed: 1 })
      expect(r.s1).toBe(0)
      r.mcStd.forEach((s, k) => expect(Math.abs(s - r.theoryStd[k])).toBeLessThanOrEqual(stdTolerance(r.theoryStd[k], r.mcKurtosis[k], 200)))
      expect(r.mcMean[r.mcMean.length - 1]).toBeCloseTo(3 - w, 9)
    }
  })
})

describe('ch00：「帶入手算」用到的小工具（與模擬共用同一份實作）', () => {
  it('productMomentsFromMoments：productMoments 只是先查出 E[x²]、E[x⁴] 再呼叫它（兩種 regressor 逐位元相同）', () => {
    for (const kind of ['gaussian', 'pm_one'] as const) {
      const { ex2, ex4 } = regressorMoments(kind)
      for (const [a, w, sv] of [
        [3, 2, 1],
        [3, 5, 0.5],
        [1, 1, 2],
        [-2, 0.3, 0],
      ]) {
        expect(productMomentsFromMoments(a - w, sv, ex2, ex4)).toEqual(productMoments(a, w, sv, kind))
      }
    }
    // 一般分布：均勻分布、單位變異數（E[x⁴] = 9/5）⇒ Var(z) = δ²·0.8 + σ_v²
    expect(productMomentsFromMoments(1.5, 3, 1, 1.8).variance).toBeCloseTo(1.5 ** 2 * 0.8 + 9, 12)
    // ±A 碼（x² ≡ A²）：E[x⁴] = E[x²]² ⇒ 訊號項沒有起伏
    expect(productMomentsFromMoments(7, 0.5, 4, 16)).toEqual({ mean: 28, variance: 1 })
  })

  it('averagedStd 與 samplesForTargetStd 互為反函數：N_min 是 s₁/√N ≤ target 的最小整數；浮點捨入不會多算一筆', () => {
    expect(averagedStd(Math.sqrt(3), 1024)).toBeCloseTo(Math.sqrt(3) / 32, 15)
    expect(averagedStd(2, 1)).toBe(2)
    // simulateNoiseAverage 的理論線就是 averagedStd
    const r = simulateNoiseAverage({ a: 3, w: 2, sigmaV: 1, xKind: 'gaussian', trials: 20, nMax: 64, seed: 3 })
    r.checkpoints.forEach((n, k) => expect(r.theoryStd[k]).toBe(averagedStd(r.s1, n)))
    expect(samplesForTargetStd(2, 0.05)).toBe(1600) // 思考題 3
    expect(samplesForTargetStd(Math.sqrt(3), 0.05)).toBe(1200)
    // double 的 (√2/0.1)² = 200.00000000000003：不可因此變成 201
    expect((Math.sqrt(2) / 0.1) ** 2).toBeGreaterThan(200)
    expect(samplesForTargetStd(Math.sqrt(2), 0.1)).toBe(200)
    // 比值上百億時也不可少算：(7.8125/5e-5)² = 24 414 062 500（保護量若是固定的相對 1e-9 會少 24 筆）
    expect(samplesForTargetStd(7.8125, 5e-5)).toBe(24414062500)
    expect(samplesForTargetStd(1000, 0.001)).toBe(1e12)
    expect(samplesForTargetStd(Math.sqrt(1200.5), 1)).toBe(1201)
    for (const [s1, target] of [
      [1.7, 0.3],
      [0.5, 0.07],
      [3, 1],
      [0.2, 5],
      [12.3, 0.011],
    ]) {
      const n = samplesForTargetStd(s1, target)
      expect(Number.isInteger(n)).toBe(true)
      expect(averagedStd(s1, n)).toBeLessThanOrEqual(target * (1 + 1e-9))
      if (n > 1) expect(averagedStd(s1, n - 1)).toBeGreaterThan(target)
    }
    // 退化情況：沒有雜訊 → 1 筆；目標 ≤ 0 → 不可能（Infinity，不給假的數字）
    expect(samplesForTargetStd(0, 0.1)).toBe(1)
    expect(samplesForTargetStd(1, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(samplesForTargetStd(1, -1)).toBe(Number.POSITIVE_INFINITY)
  })

  it('biasedFixedPoint：w* = a + E[vx]/E[x²]（F-00.11）；E[vx] = 0 ⇒ w* = a；E[x²] = 0 ⇒ NaN（不可辨識）', () => {
    expect(biasedFixedPoint(3, 0.2, 1)).toBe(3.2)
    expect(biasedFixedPoint(3, 0, 5)).toBe(3)
    expect(biasedFixedPoint(1, -0.6, 2)).toBeCloseTo(0.7, 15)
    expect(Number.isNaN(biasedFixedPoint(3, 0.2, 0))).toBe(true)
    // correlatedNoiseBias 的 w* 就是它（±1 碼：E[x²] = 1、E[vx] = κ）
    expect(correlatedNoiseBias({ a: 3, kappa: -0.3, w0: 1, mu: 0.02, sigmaV: 0.5, steps: 10, seed: 1 }).wStar).toBe(biasedFixedPoint(3, -0.3, 1))
  })

  it('timeAverageVarianceError：n 遠大於相關長度時趨近 0；n ≥ 40|p|/(1 − p²) 時 |誤差| 約 5% 以內', () => {
    expect(timeAverageVarianceError(0, 7)).toBe(0)
    expect(timeAverageVarianceError(0.98, 1e7)).toBeLessThan(1e-5)
    for (const p of [0.5, 0.9, 0.98, 0.999]) {
      const n = Math.ceil((40 * p) / (1 - p * p))
      const err = timeAverageVarianceError(p, n)
      expect(err).toBeGreaterThan(0)
      expect(err).toBeLessThanOrEqual(0.05)
    }
    // n 太短：誤差很大（μ = 0.02、n = 100 ⇒ 約 43%），手算題 HC-00.8 會擋下這種輸入
    expect(timeAverageVarianceError(0.98, 100)).toBeGreaterThan(0.4)
    expect(Number.isNaN(timeAverageVarianceError(-1, 10))).toBe(true)
  })
})

describe('ch00：公式登錄、presets 與學習地圖', () => {
  const dir = join(process.cwd(), 'src/chapters/ch00')
  const sources = [
    ...readdirSync(join(dir, 'sections')).map((f) => readFileSync(join(dir, 'sections', f), 'utf8')),
    ...readdirSync(join(dir, 'experiments')).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(join(dir, 'experiments', f), 'utf8')),
  ].join('\n')

  it('FORMULAS：ID 唯一、格式 F-00.x、每個 ID 都恰好在頁面上出現一次（TexBlock 錨點）', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-00\.\d+$/)
      expect(f.page).toBe('/ch/00')
      const count = sources.split(`id="${f.id}"`).length - 1
      expect(count, f.id).toBe(1)
    }
  })

  it('intro-* presets：格式正確，expected 中的數字與計算結果一致', () => {
    const pdir = join(process.cwd(), 'src/data/presets')
    const files = readdirSync(pdir).filter((f) => f.startsWith('intro-'))
    expect(files.length).toBeGreaterThanOrEqual(5)
    const presets = Object.fromEntries(
      files.map((f) => {
        const p = JSON.parse(readFileSync(join(pdir, f), 'utf8')) as { id: string; page: string; experiment: string; params: Record<string, unknown>; expected: string }
        expect(`${p.id}.json`).toBe(f)
        expect(p.page).toBe('/ch/00')
        expect(['intro-playground', 'intro-noise-average']).toContain(p.experiment)
        return [p.id, p]
      }),
    )
    // intro-noisy：三個 μ 的穩態 std
    for (const mu of [0.01, 0.05, 0.2]) {
      expect(presets['intro-noisy'].expected).toContain(Math.sqrt(steadyStateVarW(mu, 2, 0.5)).toFixed(4))
    }
    // intro-mu-explorer：pole 與發散步數
    const runs = [0.02, 0.1, 0.65].map((mu) => runCase({ ...DEFAULT_BASE, steps: 80 }, mu, 1, null))
    expect(runs.map((r) => r.p)).toEqual([0.92, 0.6, expect.closeTo(-1.6, 12)])
    expect(presets['intro-mu-explorer'].expected).toContain(`第 ${runs[2].divergeStep} 步`)
    expect(presets['intro-mu-explorer'].expected).toContain(`約 ${runs[1].n1pct} 步到 1%`)
    // intro-noisy：三個 Case 都能做穩態 Monte Carlo 比對（有效樣本數足夠），且 z 檢定通過
    const noisy = presets['intro-noisy'].params as { a: number; w0: number; x: number; steps: number; sigmaV: number; mus: number[] }
    const nb = { a: noisy.a, w0: noisy.w0, x: noisy.x, steps: noisy.steps, sigmaV: noisy.sigmaV }
    for (const mu of noisy.mus) {
      const chk = steadyStateCheck(nb, runCase(nb, mu, 20261010, null), null)
      expect(chk, `μ = ${mu}`).not.toBeNull()
      expect(Math.abs(chk!.z)).toBeLessThan(4)
    }
    // §0.7 內文的數值例與 intro-noisy preset 是同一組參數（讀者載入 preset 後看到的數字要和內文一樣）
    expect(STEADY_STATE_EXAMPLE.presetId).toBe('intro-noisy')
    expect({ x: noisy.x, sigmaV: noisy.sigmaV, mus: noisy.mus }).toEqual({ x: STEADY_STATE_EXAMPLE.x, sigmaV: STEADY_STATE_EXAMPLE.sigmaV, mus: STEADY_STATE_EXAMPLE.mus })
    // noise presets：s₁/√1024
    expect(presets['intro-noise-gaussian'].expected).toContain((Math.sqrt(3) / 32).toFixed(4))
    expect(presets['intro-noise-pm-one'].expected).toContain(String(1 / 32))
  })

  it('學習地圖涵蓋附錄 E 全部 15 題', () => {
    expect(LEARNING_MAP.map((m) => m.q)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    LEARNING_MAP.forEach((m) => expect(m.pages.length).toBeGreaterThan(0))
  })

  it('學習地圖：本章有入門版答案的題目都指向存在的段落錨點；問題文字中的 $…$ 成對', () => {
    const anchors = new Set([...sources.matchAll(/id="(ch00-[\w-]+)"/g)].map((m) => m[1]))
    anchors.add('ch00-playground') // §0.5 的 Section 在 index.tsx
    for (const m of LEARNING_MAP) {
      if (m.here) {
        expect(m.pages).toContain('ch00')
        expect(anchors.has(m.here.slice(1)), m.here).toBe(true)
        expect(m.hereLabel).toMatch(/^§0\.\d+/)
      }
      expect((m.question.match(/\$/g) ?? []).length % 2).toBe(0)
    }
    // Q11（GMAC 歸零 ≠ gain 正確）在 §0.10 的反例有入門版答案
    expect(LEARNING_MAP[10].here).toBe('#ch00-assumptions')
  })
})
