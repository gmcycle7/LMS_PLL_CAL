import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { binomCdf, binomSf, createRng, normCdf, normInv } from '@/simulation/core'
import {
  MC_TAIL_ALPHA,
  accumulatorBits,
  applyTieRule,
  berryEsseenBound,
  binomCdfLarge,
  binomialAcceptance,
  binomialTable,
  binnedSumPmf,
  bitToBipolar,
  directionClt,
  directionCltPlain,
  directionCurve,
  directionExact,
  directionOutcomeClt,
  directionOutcomeExact,
  kq,
  kqLocal,
  latticeEdges,
  linearizationRelError,
  logNormCdf,
  meanDecision,
  meanGmacEncoding,
  meanQ,
  minNForTarget,
  pPlus,
  poissonCdf,
  runComparatorMC,
  runComparatorSweep,
  runSignLoopBatch,
  sampleFromTable,
  samplesForConfidence,
  samplesSmallSignal,
  signLmsFixedPointEncoding,
  signLoopLinearRms,
  signLoopStationary,
  simulateSignLoop,
  sumMoments,
  sumVarianceAr1,
  sumVarianceSe,
  tieRuleEquilibrium,
  varQ,
  chainSlope,
  chainSumMoments,
  chainSumPmf,
  comparatorChain,
  comparatorTransitions,
  directionCltChain,
  directionCurveChain,
  directionExactChain,
  kqHysteresis,
  kqMetaDrop,
  metaProb,
  metaWindowAfter,
  nonidealSummary,
  nuHysteresis,
  samplesForConfidenceChain,
  latticeEdgesSpaced,
  binnedPmf,
} from './comparator'

interface GoldenVector {
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

const golden = (id: string): GoldenVector => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))

/** golden 規則：|a − e| ≤ abs + rel·|e|（逐元素）；tolerance_overrides 優先。 */
function expectGolden(v: GoldenVector, key: string, actual: number | number[]) {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const exp = v.expected[key]
  const ea = Array.isArray(exp) ? exp : [exp]
  const aa = Array.isArray(actual) ? actual : [actual]
  expect(aa.length).toBe(ea.length)
  ea.forEach((e, i) => {
    const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e)
    const diff = Math.abs(aa[i] - e)
    if (!(diff <= bound)) throw new Error(`${key}[${i}]：actual ${aa[i]} vs expected ${e}（|Δ|=${diff} > ${bound}）`)
  })
}

const S = 1 // fs
const SIGMA = 100 // fs
const P = pPlus(S, SIGMA)
const M = meanQ(S, SIGMA)

describe('comparator：單一樣本（§5）', () => {
  it('T04: s = 1 fs、σ_v = 100 fs ⇒ P(q=+1) = Φ(0.01) ≈ 0.503989、E[q] = erf(s/(√2σ))、K_q ≈ 0.00797885/fs（golden T04）', () => {
    const v = golden('T04')
    expectGolden(v, 'p_plus', P)
    expectGolden(v, 'p_minus', pPlus(-S, SIGMA))
    expectGolden(v, 'mean_q', M)
    expectGolden(v, 'kq_per_fs', kq(SIGMA))
    expectGolden(v, 'kq_times_s', kq(SIGMA) * S)
    expect(P).toBeCloseTo(0.503989, 6)
    expect(kq(SIGMA)).toBeCloseTo(0.00797885, 8)
    // E[q] = 2Φ − 1 與 erf 寫法一致
    expect(2 * P - 1).toBeCloseTo(M, 14)
    expect(varQ(M)).toBeCloseTo(1 - M * M, 15)
  })

  it('T04: S 曲線表（golden comparator_table）：P(+1)、E[q]、線性近似 √(2/π)·r', () => {
    const v = golden('comparator_table')
    const rs = (JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors/comparator_table.json'), 'utf8')) as { inputs: { s_over_sigma_list: number[] } }).inputs
      .s_over_sigma_list
    expectGolden(v, 'p_plus_list', rs.map((r) => pPlus(r, 1)))
    expectGolden(v, 'mean_q_list', rs.map((r) => meanQ(r, 1)))
    expectGolden(v, 'linear_approx_list', rs.map((r) => kq(1) * r))
    expectGolden(v, 'n_clt_95_s1_sigma100', samplesForConfidence(M, 0.95))
  })

  it('T04: 線性化誤差 ≈ (s/σ)²/6：r ≈ 0.246 高估 1%、r ≈ 0.56 高估 5%；大 |s| 時飽和、局部斜率 → 0', () => {
    expect(linearizationRelError(0.01)).toBeCloseTo(0.01 ** 2 / 6, 9)
    // K_q·s 與 E[q] 的相對差（golden notes：(s/σ)²/6）
    expect((kq(SIGMA) * S) / M - 1).toBeCloseTo(1e-4 / 6, 9)
    expect(linearizationRelError(0.246)).toBeGreaterThan(0.0095)
    expect(linearizationRelError(0.246)).toBeLessThan(0.0105)
    expect(linearizationRelError(0.56)).toBeGreaterThan(0.048)
    expect(linearizationRelError(0.56)).toBeLessThan(0.056)
    expect(kqLocal(0, SIGMA)).toBeCloseTo(kq(SIGMA), 15)
    expect(kqLocal(400, SIGMA) / kq(SIGMA)).toBeLessThan(1e-3)
    expect(meanQ(400, SIGMA)).toBeGreaterThan(0.9999)
  })

  it('T04: σ_v = 0 退化成 hard limiter（e ≥ θ → +1）', () => {
    expect(pPlus(1, 0)).toBe(1)
    expect(pPlus(-1, 0)).toBe(0)
    expect(pPlus(0, 0)).toBe(1)
    expect(meanQ(-3, 0)).toBe(-1)
    expect(pPlus(1, 100, 2)).toBeCloseTo(normCdf(-0.01), 15)
  })

  it('T04: 反面測試——0/1 位元沒有映射成 q = 2b − 1，w = a 時平均更新 E[x]/2 = 0.125、固定點偏移 +41.27 fs（golden T04）', () => {
    const v = golden('T04')
    const xs = [-1, -0.5, 0, 0.5, 1, 1.5]
    const ps = xs.map(() => 1 / 6)
    expect(bitToBipolar(0)).toBe(-1)
    expect(bitToBipolar(1)).toBe(1)
    expectGolden(v, 'wrong_encoding_mean_update_at_w_eq_a', meanGmacEncoding(300, 300, xs, ps, SIGMA, 'unipolar'))
    expect(meanGmacEncoding(300, 300, xs, ps, SIGMA, 'bipolar')).toBe(0)
    const wStar = signLmsFixedPointEncoding(300, xs, ps, SIGMA, 'unipolar', [-700, 1300])
    expectGolden(v, 'wrong_encoding_fixed_point_shift_fs', wStar - 300)
    // 正確編碼的固定點就是 a
    expect(signLmsFixedPointEncoding(300, xs, ps, SIGMA, 'bipolar', [-700, 1300])).toBeCloseTo(300, 8)
  })

  it('T04: Monte Carlo（sample-level，2e6 個 comparator 決策）：p̂ 的 4·SE 區間包含 0.503989 且排除 0.5', () => {
    const r = runComparatorMC({ s: S, sigma: SIGMA, N: 1000, trials: 2000, seed: 20261010, tieRule: 'half', method: 'sample' })
    expect(r.methodUsed).toBe('sample')
    expect(Math.abs(r.pHatPlus - P)).toBeLessThan(4 * r.pHatSe)
    expect(r.pHatPlus - 0.5).toBeGreaterThan(4 * r.pHatSe)
    // 同 seed 可重現
    const r2 = runComparatorMC({ s: S, sigma: SIGMA, N: 1000, trials: 2000, seed: 20261010, tieRule: 'half', method: 'sample' })
    expect(Array.from(r2.sums.slice(0, 20))).toEqual(Array.from(r.sums.slice(0, 20)))
  })
})

describe('comparator：反面測試（golden negative_tests）', () => {
  it('T04: 0/1 位元未映射——零均值 code 在真值的平均更新 = 0（只是增益減半）、DC code = 0.125（golden negative_tests）', () => {
    const v = golden('negative_tests')
    const zm = [-1, -0.5, 0, 0.5, 1]
    const pz = zm.map(() => 1 / 5)
    expectGolden(v, 'wrong_encoding_update_at_truth_zero_mean_code', meanGmacEncoding(300, 300, zm, pz, SIGMA, 'unipolar'))
    const dc = [-1, -0.5, 0, 0.5, 1, 1.5]
    expectGolden(v, 'wrong_encoding_update_at_truth_dc_code', meanGmacEncoding(300, 300, dc, dc.map(() => 1 / 6), SIGMA, 'unipolar'))
    // 零均值 code：E[b x] = ½E[q x]，斜率剛好減半、固定點仍在 a
    const h = 1e-3
    const slope = (enc: 'bipolar' | 'unipolar') => (meanGmacEncoding(300 + h, 300, zm, pz, SIGMA, enc) - meanGmacEncoding(300 - h, 300, zm, pz, SIGMA, enc)) / (2 * h)
    expect(slope('unipolar') / slope('bipolar')).toBeCloseTo(0.5, 9)
    expect(signLmsFixedPointEncoding(300, zm, pz, SIGMA, 'unipolar', [-700, 1300])).toBeCloseTo(300, 8)
  })

  it('累加器位寬 ⌈log₂(N+1)⌉ + 1：N = 4096 需 14 bits、N = 1e7 需 25 bits；非法 N 丟錯', () => {
    expect(accumulatorBits(1)).toBe(2)
    expect(accumulatorBits(4096)).toBe(14)
    expect(accumulatorBits(4095)).toBe(13)
    expect(accumulatorBits(1e7)).toBe(25)
    // 位寬剛好裝得下 ±N：two's complement 範圍 [−2^(b−1), 2^(b−1) − 1]
    for (const N of [1, 2, 100, 4095, 4096, 65535, 1e7]) {
      const b = accumulatorBits(N)
      expect(2 ** (b - 1) - 1).toBeGreaterThanOrEqual(N)
      expect(2 ** (b - 2) - 1).toBeLessThan(N)
    }
    expect(() => accumulatorBits(0)).toThrow(/N 必須/)
  })
})

describe('comparator：總和 S_N 與方向判斷（§5，勘誤 E02 / E07 / E18）', () => {
  it('T05: S_N 的矩：N = 10000 時 sum E = 79.787、SD = 99.997；average E = 0.0079787、SD = 0.0099997（E18）', () => {
    const mo = sumMoments(10000, M)
    expect(mo.meanSum).toBeCloseTo(79.787, 3)
    expect(mo.sdSum).toBeCloseTo(99.997, 3)
    expect(mo.meanAvg).toBeCloseTo(0.0079787, 7)
    expect(mo.sdAvg).toBeCloseTo(0.0099997, 7)
    expect(mo.snr).toBeCloseTo((M * 100) / Math.sqrt(1 - M * M), 12)
  })

  it('T05: CLT Φ(m√N/√(1−m²)) 與 exact binomial（split / strict / 奇數 N+1）逐列對 golden T05', () => {
    const v = golden('T05')
    const Ns = [100, 1000, 10000, 42500, 85000]
    expectGolden(v, 'm', M)
    expectGolden(v, 'p_clt_list', Ns.map((N) => directionCltPlain(M, N)))
    expectGolden(v, 'p_exact_split_list', Ns.map((N) => directionOutcomeExact(P, N, 'half').correct))
    expectGolden(v, 'p_exact_strict_list', Ns.map((N) => directionOutcomeExact(P, N, 'strict').correct))
    expectGolden(v, 'p_exact_odd_Nplus1_list', Ns.map((N) => directionOutcomeExact(P, N + 1, 'strict').correct))
  })

  it('T05: N ≈ 42500 達 95%：CLT 42497.29、精確門檻 odd 42499 / even-split 42500 / even-strict 42750；99%：odd 85011（golden T05）', () => {
    const v = golden('T05')
    expectGolden(v, 'N_clt_95', samplesForConfidence(M, 0.95))
    expectGolden(v, 'N_clt_99', samplesForConfidence(M, 0.99))
    expectGolden(v, 'N_exact_odd_95', minNForTarget(P, 0.95, 'odd') ?? NaN)
    expectGolden(v, 'N_exact_odd_99', minNForTarget(P, 0.99, 'odd') ?? NaN)
    expectGolden(v, 'N_exact_even_split_95', minNForTarget(P, 0.95, 'even', 'half') ?? NaN)
    expectGolden(v, 'N_exact_even_strict_95', minNForTarget(P, 0.95, 'even', 'strict') ?? NaN)
    // 門檻兩側：42497 未達、42499 達標
    expect(directionOutcomeExact(P, 42497, 'strict').correct).toBeLessThan(0.95)
    expect(directionOutcomeExact(P, 42499, 'strict').correct).toBeGreaterThanOrEqual(0.95)
    // 小訊號近似 (zσ/s)²·π/2 與完整 CLT 反解只差 (1 − m²) 與 erf 線性化
    expect(samplesSmallSignal(S / SIGMA, 0.95) / samplesForConfidence(M, 0.95)).toBeCloseTo(1, 3)
  })

  it('T05: tie 對照框（E02 / E07）：偶數 N 的 P(S>0)/P(S=0)/P(S<0) 與 sign(0)=+1 的 P(S≥0)', () => {
    const t100 = directionExact(P, 100)
    expect(t100.pos).toBeCloseTo(0.4920, 4)
    expect(t100.tie).toBeCloseTo(0.0793, 4)
    expect(t100.neg).toBeCloseTo(0.4286, 4)
    expect(t100.pos + t100.tie + t100.neg).toBeCloseTo(1, 12)
    const t1000 = directionExact(P, 1000)
    expect([t1000.pos, t1000.tie, t1000.neg].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0.5874, 0.0244, 0.3882])
    const t10000 = directionExact(P, 10000)
    expect([t10000.pos, t10000.tie, t10000.neg].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([0.7846, 0.0058, 0.2096])
    expect(directionOutcomeExact(P, 100, 'plus').correct).toBeCloseTo(0.5714, 4)
    expect(directionOutcomeExact(P, 1000, 'plus').correct).toBeCloseTo(0.6118, 4)
    expect(directionOutcomeExact(P, 10000, 'plus').correct).toBeCloseTo(0.7904, 4)
    const skip = directionOutcomeExact(P, 100, 'skip')
    expect([skip.correct, skip.hold, skip.wrong].map((x) => Math.round(x * 1000) / 1000)).toEqual([0.492, 0.079, 0.429])
    // 奇數 N 沒有 tie，四種 rule 完全相同
    const o = (['strict', 'half', 'plus', 'skip'] as const).map((r) => directionOutcomeExact(P, 101, r).correct)
    o.forEach((x) => expect(x).toBe(o[0]))
    expect(o[0]).toBeCloseTo(0.532034, 6)
    // N = 2 strict 只有 p² ≈ 25.4%
    expect(directionOutcomeExact(P, 2, 'strict').correct).toBeCloseTo(P * P, 14)
  })

  it('T05: 精確恆等式：偶數 N 平分 tie 的判對率 = 奇數 N − 1 的判對率（多出一個樣本沒有幫助）', () => {
    for (const N of [2, 10, 100, 1000, 10000, 42500]) {
      expect(directionOutcomeExact(P, N, 'half').correct).toBeCloseTo(directionOutcomeExact(P, N - 1, 'strict').correct, 12)
    }
    for (const p of [0.3, 0.51, 0.9]) {
      expect(directionOutcomeExact(p, 20, 'half').correct).toBeCloseTo(directionOutcomeExact(p, 19, 'half').correct, 13)
    }
  })

  it('T05: CLT 連續性修正：偶數 N 的嚴格 P(S>0) ≈ Φ((Nm−1)/√(N(1−m²)))（E02），奇數 N 不需修正', () => {
    const c100 = directionOutcomeClt(M, 100, 'strict').correct
    expect(c100).toBeCloseTo(normCdf((100 * M - 1) / Math.sqrt(100 * (1 - M * M))), 14)
    expect(Math.abs(c100 - directionOutcomeExact(P, 100, 'strict').correct)).toBeLessThan(2e-3)
    expect(Math.abs(directionOutcomeClt(M, 100, 'plus').correct - directionOutcomeExact(P, 100, 'plus').correct)).toBeLessThan(2e-3)
    const odd = directionClt(M, 101)
    expect(odd.tie).toBeCloseTo(0, 14)
    expect(odd.pos).toBeCloseTo(directionCltPlain(M, 101), 14)
    // 無修正的規格式在偶數 N 近似的是 split，而不是 strict
    expect(Math.abs(directionCltPlain(M, 100) - directionOutcomeExact(P, 100, 'half').correct)).toBeLessThan(1e-3)
    expect(Math.abs(directionCltPlain(M, 100) - directionOutcomeExact(P, 100, 'strict').correct)).toBeGreaterThan(0.035)
  })

  it('T05: Monte Carlo（binomial 引擎）N = 42499：判對率 Wilson 95% CI 涵蓋精確 0.95', () => {
    const r = runComparatorMC({ s: S, sigma: SIGMA, N: 42499, trials: 20000, seed: 7, tieRule: 'strict', method: 'binomial' })
    const exact = directionOutcomeExact(P, 42499, 'strict').correct
    expect(r.methodUsed).toBe('binomial')
    const se = Math.sqrt((exact * (1 - exact)) / 20000)
    expect(Math.abs(r.wilson.p - exact)).toBeLessThan(4 * se)
    expect(r.counts.tie).toBe(0) // 奇數 N 不可能 tie
  })

  it('T05: 反面測試（E02）——偶數 N = 100 照字面算 strict P(S_N>0)，MC 的 CI 不包含規格表格的 53.2%', () => {
    const r = runComparatorMC({ s: S, sigma: SIGMA, N: 100, trials: 40000, seed: 20261010, tieRule: 'strict', method: 'sample' })
    expect(r.wilson.hi).toBeLessThan(directionCltPlain(M, 100))
    expect(r.wilson.lo).toBeLessThan(directionOutcomeExact(P, 100, 'strict').correct)
    expect(r.wilson.hi).toBeGreaterThan(directionOutcomeExact(P, 100, 'strict').correct)
    expect(r.counts.tie / r.trialsUsed).toBeCloseTo(directionExact(P, 100).tie, 1)
    // half rule 的 MC 才會回到 53.2%
    const h = runComparatorMC({ s: S, sigma: SIGMA, N: 100, trials: 40000, seed: 20261010, tieRule: 'half', method: 'sample' })
    expect(h.wilson.lo).toBeLessThan(0.5318)
    expect(h.wilson.hi).toBeGreaterThan(0.5318)
  })

  it('T05: sample-level 與 binomial 兩個引擎的 S_N 分布一致（平均與變異數在 CI 內，histogram 與精確 pmf 吻合）', () => {
    const N = 400
    const a = runComparatorMC({ s: 20, sigma: 100, N, trials: 20000, seed: 3, tieRule: 'half', method: 'sample' })
    const b = runComparatorMC({ s: 20, sigma: 100, N, trials: 20000, seed: 3, tieRule: 'half', method: 'binomial' })
    const mo = sumMoments(N, meanQ(20, 100))
    for (const r of [a, b]) {
      expect(Math.abs(r.sumMean - mo.meanSum)).toBeLessThan((4 * mo.sdSum) / Math.sqrt(20000))
      expect(r.sumVar / mo.varSum).toBeGreaterThan(0.95)
      expect(r.sumVar / mo.varSum).toBeLessThan(1.05)
      const totalExpected = r.hist.expected.reduce((x, y) => x + y, 0)
      const totalCount = r.hist.counts.reduce((x, y) => x + y, 0)
      expect(totalCount + r.hist.outside).toBe(20000)
      expect(Math.abs(totalExpected - 20000)).toBeLessThan(20) // ±4.5σ 之外的質量 < 1e-5
      // 粗略 χ²：只看期望 ≥ 20 的 bin
      let chi2 = 0
      let dof = 0
      r.hist.expected.forEach((e, i) => {
        if (e >= 20) {
          chi2 += (r.hist.counts[i] - e) ** 2 / e
          dof++
        }
      })
      expect(chi2 / dof).toBeLessThan(2)
    }
  })

  it('binomial 抽樣表：平均 / 變異數 = Np / Np(1−p)；表格截尾質量可忽略；格點對齊的 bin 邊界', () => {
    const t = binomialTable(5000, 0.3)
    expect(t.cdf[t.cdf.length - 1]).toBeCloseTo(1, 12)
    const rng = createRng(11)
    let s1 = 0
    let s2 = 0
    const n = 50000
    for (let i = 0; i < n; i++) {
      const k = sampleFromTable(t, rng.uniform())
      s1 += k
      s2 += k * k
    }
    const mean = s1 / n
    const v = s2 / n - mean * mean
    expect(Math.abs(mean - 1500)).toBeLessThan((4 * Math.sqrt(1050)) / Math.sqrt(n))
    expect(v / 1050).toBeGreaterThan(0.97)
    expect(v / 1050).toBeLessThan(1.03)
    const edges = latticeEdges(101, 0.8, 10)
    // 邊界在格點中點（N 奇數 ⇒ 格點為奇數 ⇒ 邊界為偶數）
    Array.from(edges).forEach((e) => expect(Math.abs(e % 2)).toBe(0))
    const binned = binnedSumPmf(binomialTable(101, P), edges)
    expect(binned.reduce((x, y) => x + y, 0)).toBeGreaterThan(0.99999)
    // σ_v = 0：只有一個格點
    const e0 = latticeEdges(10, 10, 0)
    expect(Array.from(e0)).toEqual([9, 11])
  })

  it('P(判對) vs N 曲線與 MC 掃描：MC 的 99.9% Wilson 區間全部涵蓋精確值', () => {
    const c = directionCurve(P, 50000, 'strict')
    const i101 = c.oddN.indexOf(101)
    expect(i101).toBeGreaterThanOrEqual(0)
    expect(c.oddExact[i101]).toBeCloseTo(0.532034, 6)
    // strict：偶數 N 低於相鄰奇數（鋸齒）
    const i100 = c.evenN.indexOf(100)
    expect(c.evenExact[i100]).toBeLessThan(c.oddExact[c.oddN.indexOf(99)])
    const sw = runComparatorSweep({ s: S, sigma: SIGMA, Ns: [2, 3, 100, 101, 1000, 1001, 42499], trials: 4000, seed: 5, tieRule: 'strict', level: 0.999 })
    for (let i = 0; i < sw.N.length; i++) {
      expect(sw.lo[i]).toBeLessThanOrEqual(sw.exact[i])
      expect(sw.hi[i]).toBeGreaterThanOrEqual(sw.exact[i])
    }
  })
})

describe('comparator：失敗模式與反面測試', () => {
  it('Offset θ > s：E[q] 與 s 反號，N 越大越確定判錯；精確門檻不存在（null）', () => {
    const p = pPlus(1, 100, 2) // θ = 2 fs 把 s = 1 fs 蓋過
    expect(p).toBeLessThan(0.5)
    const pc = [101, 1001, 10001, 100001].map((N) => directionOutcomeExact(p, N, 'half', 1).correct)
    for (let i = 1; i < pc.length; i++) expect(pc[i]).toBeLessThan(pc[i - 1])
    expect(pc[3]).toBeLessThan(0.01)
    expect(minNForTarget(p, 0.95, 'odd')).toBeNull()
    expect(samplesForConfidence(0, 0.95)).toBe(Infinity)
  })

  it('s < 0 時正確方向是 −1：判對機率對稱；sign(0)=+1 的 tie 對 s < 0 是判錯', () => {
    const pn = pPlus(-1, 100)
    expect(directionOutcomeExact(pn, 101, 'strict', -1).correct).toBeCloseTo(directionOutcomeExact(P, 101, 'strict', 1).correct, 13)
    const plusNeg = directionOutcomeExact(pn, 100, 'plus', -1)
    expect(plusNeg.correct).toBeCloseTo(directionOutcomeExact(P, 100, 'strict', 1).correct, 13)
    expect(applyTieRule({ pos: 0.2, tie: 0.1, neg: 0.7 }, 'skip', -1)).toEqual({ correct: 0.7, wrong: 0.2, hold: 0.1 })
  })

  it('非法輸入會丟出說明清楚的錯誤', () => {
    expect(() => runComparatorMC({ s: 1, sigma: 100, N: 0, trials: 10, seed: 1, tieRule: 'half' })).toThrow(/N 必須是正整數/)
    expect(() => runComparatorMC({ s: 1, sigma: -1, N: 10, trials: 10, seed: 1, tieRule: 'half' })).toThrow(/σ_v/)
    expect(() => runComparatorMC({ s: 1, sigma: 100, N: 10.5, trials: 10, seed: 1, tieRule: 'half' })).toThrow()
  })
})

describe('comparator：雜訊當 dither（逐 sample Sign-LMS，x ≡ 1）', () => {
  it('σ_v = 0：period-2 limit cycle，時間平均偏差最多 μ/2（a = 1.1、μ = 0.5 ⇒ 平均 1.25、bias +0.15）', () => {
    const st = signLoopStationary({ a: 1.1, w0: 0, mu: 0.5, sigma: 0 })
    expect(st.limitCycle).toBe(true)
    expect(st.mean).toBeCloseTo(1.25, 12)
    expect(st.bias).toBeCloseTo(0.15, 12)
    const sim = simulateSignLoop({ a: 1.1, w0: 0, mu: 0.5, sigma: 0, steps: 400, seed: 1 })
    expect(sim.tailMean).toBeCloseTo(1.25, 2)
    const tail = Array.from(sim.w.slice(-4))
    expect([...new Set(tail)].sort()).toEqual([1, 1.5])
    expect(tail[0]).not.toBe(tail[1]) // 每一步都換邊：period 2
  })

  it('runSignLoopBatch（worker）：每個 Case 與單獨呼叫 simulateSignLoop 完全相同（paired、可重現）', () => {
    const b = runSignLoopBatch({ a: 1.1, w0: 0, steps: 500, seed: 4, cases: [{ sigma: 0, mu: 0.5 }, { sigma: 1, mu: 0.5 }] })
    const one = simulateSignLoop({ a: 1.1, w0: 0, steps: 500, seed: 4, sigma: 1, mu: 0.5 })
    expect(Array.from(b.runs[1].w)).toEqual(Array.from(one.w))
    expect(b.runs[0].tailMean).toBeCloseTo(1.25, 2)
    expect(() => runSignLoopBatch({ a: 0, w0: 0, steps: 0, seed: 1, cases: [] })).toThrow(/steps/)
  })

  it('σ_v > 0：精確穩態（birth–death 細緻平衡）與長時間 MC 吻合；適度雜訊讓時間平均去偏', () => {
    const p = { a: 1.1, w0: 0, mu: 0.5, sigma: 1 }
    const st = signLoopStationary(p)
    expect(st.ok).toBe(true)
    expect(Math.abs(st.bias)).toBeLessThan(0.01)
    const sim = simulateSignLoop({ ...p, steps: 400000, seed: 9 })
    expect(Math.abs(sim.tailMean - st.mean)).toBeLessThan(0.02)
    expect(sim.tailRms / st.rms).toBeGreaterThan(0.97)
    expect(sim.tailRms / st.rms).toBeLessThan(1.03)
  })

  it('σ_v ≪ μ 時精確穩態仍有限（log 空間細緻平衡），並連續地趨近 σ_v = 0 的 limit cycle；log Φ 左尾不下溢', () => {
    expect(logNormCdf(-40)).toBeCloseTo(Math.log(normCdf(-30)) - (40 * 40 - 30 * 30) / 2 - Math.log(40 / 30), 1)
    expect(Number.isFinite(logNormCdf(-400))).toBe(true)
    expect(logNormCdf(0)).toBeCloseTo(Math.log(0.5), 15)
    expect(logNormCdf(-4.9)).toBeCloseTo(Math.log(normCdf(-4.9)), 12)
    expect(logNormCdf(-5.1)).toBeCloseTo(Math.log(normCdf(-5.1)), 10)
    for (const ratio of [0.001, 0.01, 0.05, 0.2]) {
      const st = signLoopStationary({ a: 1.1, w0: 0, mu: 0.5, sigma: ratio * 0.5 })
      expect(st.ok).toBe(true)
      expect(Number.isFinite(st.mean)).toBe(true)
      expect(Number.isFinite(st.rms)).toBe(true)
    }
    expect(signLoopStationary({ a: 1.1, w0: 0, mu: 0.5, sigma: 0.005 }).mean).toBeCloseTo(1.25, 6)
  })

  it('dither 去偏：σ_v = 0 偏 +0.15 fs；σ_v = μ 時 |偏差| < 1e-4 fs、σ_v = 2μ 時 < 1e-8 fs（頁面表格的「幾乎無偏」）', () => {
    const base = { a: 1.1, w0: 0, mu: 0.5 }
    expect(signLoopStationary({ ...base, sigma: 0 }).bias).toBeCloseTo(0.15, 12)
    const b1 = Math.abs(signLoopStationary({ ...base, sigma: 0.5 }).bias)
    const b2 = Math.abs(signLoopStationary({ ...base, sigma: 1 }).bias)
    expect(b1).toBeLessThan(1e-4)
    expect(b1).toBeGreaterThan(0) // 不是精確為 0：頁面標「近似」
    expect(b2).toBeLessThan(1e-8)
    // σ_v ≪ μ 時偏差仍接近 limit cycle（dither 不夠）
    expect(signLoopStationary({ ...base, sigma: 0.05 }).bias).toBeGreaterThan(0.1)
  })

  it('雜訊大時線性化 RMS √(μ/(K_q(2−μK_q))) 逼近精確值；雜訊越大 RMS 越大（不是越多越好）', () => {
    const big = signLoopStationary({ a: 1.1, w0: 0, mu: 0.5, sigma: 30 })
    expect(big.rms / signLoopLinearRms(0.5, 30)).toBeGreaterThan(0.97)
    expect(big.rms / signLoopLinearRms(0.5, 30)).toBeLessThan(1.03)
    const mid = signLoopStationary({ a: 1.1, w0: 0, mu: 0.5, sigma: 1 })
    expect(big.rms).toBeGreaterThan(mid.rms)
    expect(signLoopLinearRms(0.5, 0.1)).toBeNaN() // μK_q ≥ 2：線性模型不適用
  })
})

describe('comparator：延伸——時間相關雜訊（arcsine law，s = 0）', () => {
  it('arcsine law 本身：E[sign X·sign Y] = (2/π)·arcsin ρ（ρ = 0.5 ⇒ 1/3；ρ = −0.8），MC 4 SE 內', () => {
    const rng = createRng(77)
    for (const rho of [0.5, -0.8]) {
      const n = 200000
      let acc = 0
      for (let i = 0; i < n; i++) {
        const x = rng.normal()
        const y = rho * x + Math.sqrt(1 - rho * rho) * rng.normal()
        acc += (x >= 0 ? 1 : -1) * (y >= 0 ? 1 : -1)
      }
      const est = acc / n
      const th = (2 / Math.PI) * Math.asin(rho)
      expect(Math.abs(est - th)).toBeLessThan(4 * Math.sqrt((1 - th * th) / n))
    }
    expect((2 / Math.PI) * Math.asin(0.5)).toBeCloseTo(1 / 3, 15)
  })

  it('ρ = 0 ⇒ Var(S_N) = N；AR(1) ρ = 0.9 的 MC Var(S_N) 與 arcsine 公式吻合', () => {
    expect(sumVarianceAr1(64, 0).varSum).toBe(64)
    const N = 64
    const rho = 0.9
    const th = sumVarianceAr1(N, rho)
    const rng = createRng(2026)
    const trials = 20000
    let s2 = 0
    for (let j = 0; j < trials; j++) {
      let v = rng.normal()
      let S2 = 0
      for (let i = 0; i < N; i++) {
        if (i > 0) v = rho * v + Math.sqrt(1 - rho * rho) * rng.normal()
        S2 += v >= 0 ? 1 : -1
      }
      s2 += S2 * S2
    }
    const est = s2 / trials
    expect(est / th.varSum).toBeGreaterThan(0.95)
    expect(est / th.varSum).toBeLessThan(1.05)
    expect(th.nEff).toBeLessThan(N / 5)
  })
})

describe('comparator：Monte Carlo 計數的精確接受域（Analytic ↔ MC 交叉比對）', () => {
  it('接受域 [kLo, kHi] 的定義：P(X < kLo) < α ≤ P(X ≤ kLo)、P(X > kHi) < α ≤ P(X ≥ kHi)（對 SciPy 參考值）', () => {
    // 參考值：scipy.stats.binom 以同一個 α = Φ(−4) 逐點搜尋
    const ref: [number, number, number, number][] = [
      [4000, 0.7875, 3045, 3252],
      [4000, 1e-5, 0, 2],
      [40000, 0.492, 19280, 20080],
      [10, 0.5, 0, 10],
      [1, 0.3, 0, 1],
    ]
    for (const [n, p, lo, hi] of ref) {
      const a = binomialAcceptance(n, p)
      expect([a.kLo, a.kHi], `n=${n}, p=${p}`).toEqual([lo, hi])
      if (a.kLo > 0) expect(binomCdf(a.kLo - 1, n, p)).toBeLessThan(MC_TAIL_ALPHA)
      expect(binomCdf(a.kLo, n, p)).toBeGreaterThanOrEqual(MC_TAIL_ALPHA)
      if (a.kHi < n) expect(binomSf(a.kHi, n, p)).toBeLessThan(MC_TAIL_ALPHA)
      expect(binomSf(a.kHi - 1, n, p)).toBeGreaterThanOrEqual(MC_TAIL_ALPHA)
    }
    expect(MC_TAIL_ALPHA).toBeCloseTo(normCdf(-4), 18)
    expect(binomialAcceptance(50, 0)).toEqual({ kLo: 0, kHi: 0 })
    expect(binomialAcceptance(50, 1)).toEqual({ kLo: 50, kHi: 50 })
    expect(() => binomialAcceptance(10, 1.2)).toThrow(/0 ≤ p ≤ 1/)
  })

  it('反面測試——稀有事件下 4·SE 的常態近似會誤報，精確接受域不會（飽和 preset：P(判錯) ≈ 7.5e-7、T = 4000）', () => {
    const pc = directionOutcomeExact(pPlus(60, 100), 101, 'half').correct
    expect(1 - pc).toBeLessThan(1e-6)
    const T = 4000
    // 剛好出現 1 次判錯：機率 ≈ T·(1 − pc) ≈ 0.3%，是正常會發生的事
    const pHat = (T - 1) / T
    const z = Math.abs(pHat - pc) / Math.sqrt((pc * (1 - pc)) / T)
    expect(z).toBeGreaterThan(15) // 舊的判準 z ≤ 4 會把正確的模擬判成 mismatch
    const acc = binomialAcceptance(T, pc)
    expect(acc).toEqual({ kLo: T - 1, kHi: T }) // 精確接受域：0 或 1 次判錯都合理
    expect(T - 2).toBeLessThan(acc.kLo) // 2 次判錯（機率 ≈ 4.5e-6）才判 mismatch
  })

  it('大 n（N·T 到 1e12）：常態 + 連續性修正 / Poisson 極限，與 SciPy 精確值的接受域一致', () => {
    expect(binomialAcceptance(2e8, P)).toEqual({ kLo: 100769588, kHi: 100826155 }) // 常態分支（變異數 5e7）
    expect(binomialAcceptance(2e8, 1 - 2.9e-7)).toEqual({ kLo: 199999909, kHi: 199999970 }) // Poisson 分支（稀有事件在 n − X）
    expect(binomialAcceptance(1e10, 3e-9)).toEqual({ kLo: 11, kHi: 54 }) // Poisson 分支（稀有事件在 X）
    expect(binomialAcceptance(6e7, 0.999999)).toEqual({ kLo: 59999907, kHi: 59999968 })
    const big = binomialAcceptance(2e12, P)
    const sd = Math.sqrt(2e12 * P * (1 - P))
    expect((2e12 * P - big.kLo) / sd).toBeGreaterThan(3.95)
    expect((2e12 * P - big.kLo) / sd).toBeLessThan(4.05)
    // 邊界：大 n 與小 n 兩個分支在邊界值上都合法
    expect(binomCdfLarge(-1, 1e9, 0.5)).toBe(0)
    expect(binomCdfLarge(1e9, 1e9, 0.5)).toBe(1)
    expect(binomCdfLarge(5e8, 1e9, 0.5)).toBeCloseTo(0.5, 4)
    expect(binomCdfLarge(3, 10, 0.5)).toBeCloseTo(binomCdf(3, 10, 0.5), 15)
  })

  it('Poisson CDF：對 SciPy 參考值；λ 到數百不下溢', () => {
    expect(poissonCdf(3, 2.5)).toBeCloseTo(0.7575761331330662, 12)
    expect(poissonCdf(700, 800)).toBeCloseTo(0.00016609078555177717, 12)
    expect(poissonCdf(0, 0.004)).toBeCloseTo(Math.exp(-0.004), 14)
    expect(poissonCdf(-1, 3)).toBe(0)
    expect(poissonCdf(5, 0)).toBe(1)
    expect(poissonCdf(1e6, 10)).toBe(1)
  })

  it('樣本變異數的標準誤：N 大時 → Var·√(2/T)；N = 1（q 本身）與飽和時用 Binomial 四階矩；MC 驗證', () => {
    const T = 4000
    expect(sumVarianceSe(10001, P, T) / (4 * 10001 * P * (1 - P) * Math.sqrt(2 / T))).toBeCloseTo(1, 3)
    // N = 1、p = ½：S = ±1，s² 幾乎是常數 ⇒ SE 遠小於 Gaussian 式
    expect(sumVarianceSe(1, 0.5, 100)).toBeLessThan(0.2 * Math.sqrt(2 / 100))
    expect(sumVarianceSe(10, 0.5, 1)).toBeNaN()
    expect(sumVarianceSe(10, 1, 100)).toBe(0)
    // 飽和（p = 0.999、N = 101）：重尾，Gaussian 式低估 SE 好幾倍；以 MC 直接量樣本變異數的離散程度
    const N = 101
    const p = 0.999
    const se = sumVarianceSe(N, p, 400)
    expect(se).toBeGreaterThan(2 * 4 * N * p * (1 - p) * Math.sqrt(2 / 400))
    const rng = createRng(123)
    const table = binomialTable(N, p)
    const vars: number[] = []
    for (let rep = 0; rep < 400; rep++) {
      let s1 = 0
      let s2 = 0
      for (let j = 0; j < 400; j++) {
        const S = 2 * sampleFromTable(table, rng.uniform()) - N
        s1 += S
        s2 += S * S
      }
      vars.push((s2 - (s1 * s1) / 400) / 399)
    }
    const mean = vars.reduce((x, y) => x + y, 0) / vars.length
    const sd = Math.sqrt(vars.reduce((x, y) => x + (y - mean) ** 2, 0) / (vars.length - 1))
    expect(sd / se).toBeGreaterThan(0.85)
    expect(sd / se).toBeLessThan(1.15)
  })

  it('runComparatorMC 回傳精確的 +1 計數 plusCount（= Σ(S + N)/2），兩個引擎都落在接受域內', () => {
    for (const method of ['sample', 'binomial'] as const) {
      const r = runComparatorMC({ s: S, sigma: SIGMA, N: 501, trials: 3000, seed: 99, tieRule: 'half', method })
      let k = 0
      for (const s of r.sums) k += (s + 501) / 2
      expect(r.plusCount).toBe(k)
      expect(r.pHatPlus).toBeCloseTo(k / (501 * 3000), 15)
      const acc = binomialAcceptance(501 * 3000, P)
      expect(r.plusCount).toBeGreaterThanOrEqual(acc.kLo)
      expect(r.plusCount).toBeLessThanOrEqual(acc.kHi)
      const accC = binomialAcceptance(3000, directionOutcomeExact(P, 501, 'half').correct)
      expect(r.outcome.correct).toBeGreaterThanOrEqual(accC.kLo)
      expect(r.outcome.correct).toBeLessThanOrEqual(accC.kHi)
    }
  })
})

describe('comparator：CLT 誤差界與 tie rule 的系統偏差', () => {
  it('T05: Berry–Esseen 上界永遠蓋住 CLT 的實際誤差（含偶數 N 的 tie 質量）', () => {
    for (const N of [2, 10, 100, 101, 1000, 10000]) {
      const bound = berryEsseenBound(M, N)
      const err = Math.abs(directionCltPlain(M, N) - directionOutcomeExact(P, N, 'strict').correct)
      expect(err).toBeLessThanOrEqual(bound)
    }
    expect(berryEsseenBound(M, 100)).toBeCloseTo(0.04748, 4)
  })

  it('strict 是評分慣例而非硬體規則：s > 0 時等同硬體 sign(0) = −1，s < 0 時等同 sign(0) = +1', () => {
    for (const s of [1, -1, 7, -7]) {
      const p = pPlus(s, SIGMA)
      const d = directionExact(p, 100)
      const strict = applyTieRule(d, 'strict', s > 0 ? 1 : -1).correct
      // 硬體 sign(0) = ∓1 的判決 d ∈ {±1}：P(d = +1) = (1 + E[d])/2
      const pPlusMinus1 = (1 + meanDecision(d, 'strict')) / 2 // sign(0) = −1
      const pPlusPlus1 = (1 + meanDecision(d, 'plus')) / 2 // sign(0) = +1
      if (s > 0) expect(strict).toBeCloseTo(pPlusMinus1, 14)
      else expect(strict).toBeCloseTo(1 - pPlusPlus1, 14)
    }
    // half / skip 的平均決策不含 tie
    const d = directionExact(P, 100)
    expect(meanDecision(d, 'half')).toBeCloseTo(d.pos - d.neg, 15)
    expect(meanDecision(d, 'skip')).toBeCloseTo(d.pos - d.neg, 15)
  })

  it('偶數 N 的確定性 tie rule 造成平衡點偏移 ∓1/(N K_q)：N = 100、σ_v = 100 fs 時約 ∓1.25 fs；half / skip 無偏；奇數 N 無偏', () => {
    const approx = 1 / (100 * kq(100))
    expect(tieRuleEquilibrium(100, 100, 'plus')).toBeCloseTo(-approx, 1)
    expect(tieRuleEquilibrium(100, 100, 'strict')).toBeCloseTo(approx, 1)
    expect(Math.abs(tieRuleEquilibrium(100, 100, 'half'))).toBeLessThan(1e-8)
    expect(Math.abs(tieRuleEquilibrium(100, 100, 'skip'))).toBeLessThan(1e-8)
    expect(Math.abs(tieRuleEquilibrium(101, 100, 'plus'))).toBeLessThan(1e-8)
    expect(tieRuleEquilibrium(4096, 100, 'plus') / (-1 / (4096 * kq(100)))).toBeCloseTo(1, 2)
  })
})

describe('comparator §5b：非理想 comparator（hysteresis ±h、metastability 決策窗 ε；golden comparator_hysteresis）', () => {
  const v = golden('comparator_hysteresis')
  const inputs = (JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors/comparator_hysteresis.json'), 'utf8')) as { inputs: { h_over_sigma_list: number[]; eps_over_sigma_list: number[] } }).inputs
  const hs = inputs.h_over_sigma_list.map((r) => r * SIGMA)
  const epss = inputs.eps_over_sigma_list.map((r) => r * SIGMA)

  it('h = ε = 0 完全回到 §5 的 iid comparator：transitions = Φ、ν = 0、E[y] = erf、Var(S_N) = N(1 − m²)、DP 的 pmf = Binomial', () => {
    const tr = comparatorTransitions(S, SIGMA, 0, 0, 1)
    expect(tr.plus).toBe(P)
    expect(tr.minus).toBeCloseTo(1 - P, 15)
    expect(tr.meta).toBe(0)
    const ch = comparatorChain(S, SIGMA, 0, 0)
    expect(ch.nu).toBe(0)
    expect(ch.meanOut).toBeCloseTo(M, 14)
    expect(ch.varInf).toBeCloseTo(1 - M * M, 14)
    const mo = chainSumMoments(10000, ch)
    const ref = sumMoments(10000, M)
    expect(mo.meanSum).toBeCloseTo(ref.meanSum, 10)
    expect(mo.varSum).toBeCloseTo(ref.varSum, 9)
    expect(mo.nEff).toBeCloseTo(10000, 8)
    const dp = directionExactChain(ch, 100)!
    const bi = directionExact(P, 100)
    expect(dp.pos).toBeCloseTo(bi.pos, 14)
    expect(dp.tie).toBeCloseTo(bi.tie, 14)
    expect(dp.neg).toBeCloseTo(bi.neg, 14)
    const t = chainSumPmf(ch, 100)!
    const bt = binomialTable(100, P)
    for (let k = bt.kLo; k <= bt.kHi; k++) expect(t.pmf[2 * k - 100 + t.offset]).toBeCloseTo(bt.pmf[k - bt.kLo], 14)
    expect(nonidealSummary(SIGMA, 0, 0).slopeRatio).toBeCloseTo(1, 9)
    expect(nonidealSummary(SIGMA, 0, 0).noiseFactor).toBeCloseTo(1, 14)
  })

  it('F-05.22：純遲滯的平穩斜率 φ(η)/(σΦ(−η))、ν = 1 − 2Φ(−η)、雜訊因子 (1+ν)/(1−ν)、K_eff 與所需 N 的倍數（golden）', () => {
    const sums = hs.map((h) => nonidealSummary(SIGMA, h, 0))
    expectGolden(v, 'hyst_slope_ratio_list', sums.map((x) => x.slopeRatio))
    expectGolden(v, 'hyst_slope_closed_ratio_list', hs.map((h) => kqHysteresis(SIGMA, h) / kq(SIGMA)))
    expectGolden(v, 'hyst_nu_list', sums.map((x) => x.nu))
    expectGolden(v, 'hyst_noise_factor_list', sums.map((x) => x.noiseFactor))
    expectGolden(v, 'hyst_kq_eff_ratio_list', sums.map((x) => x.kqEffRatio))
    expectGolden(v, 'hyst_n_ratio_list', sums.map((x) => x.nRatio))
    expectGolden(v, 'hyst_var_sum_N100_list', hs.map((h) => chainSumMoments(100, comparatorChain(0, SIGMA, h, 0)).varSum))
    // 數值微分 = 封閉式（相對 1e-9）；斜率隨 h 變大、資訊隨 h 變少；ν = 1 − 2Φ(−η)
    for (let i = 0; i < hs.length; i++) {
      expect(Math.abs(sums[i].slope / kqHysteresis(SIGMA, hs[i]) - 1), `h = ${hs[i]}`).toBeLessThan(1e-9)
      expect(sums[i].nu).toBeCloseTo(nuHysteresis(SIGMA, hs[i]), 14)
      expect(sums[i].noiseFactor).toBeCloseTo((1 + sums[i].nu) / (1 - sums[i].nu), 12)
      if (i > 0) {
        expect(sums[i].slopeRatio).toBeGreaterThan(sums[i - 1].slopeRatio)
        expect(sums[i].kqEffRatio).toBeLessThan(sums[i - 1].kqEffRatio)
      }
    }
    // 手算題 HC-05.9 的數字：h = 0.3σ_v ⇒ 斜率比 1.2510、ν = 0.2358、K_eff 比 0.9837、N 多 3.3%
    const h03 = nonidealSummary(SIGMA, 30, 0)
    expect(h03.slopeRatio.toFixed(4)).toBe('1.2510')
    expect(h03.nu.toFixed(4)).toBe('0.2358')
    expect(h03.kqEffRatio.toFixed(4)).toBe('0.9837')
    expect(h03.nRatio.toFixed(3)).toBe('1.033')
    // h = σ_v：斜率 1.91 倍、ν = 0.6827、N 要 1.45 倍
    const h1 = nonidealSummary(SIGMA, SIGMA, 0)
    expect(h1.slopeRatio.toFixed(2)).toBe('1.91')
    expect(h1.nu.toFixed(4)).toBe('0.6827')
    expect(h1.nRatio.toFixed(2)).toBe('1.45')
  })

  it('F-05.24／F-05.25：P_meta = Φ((ε−d)/σ) − Φ((−ε−d)/σ)（≈ K_q·ε）、drop 的斜率 K_q·e^{−ε²/2σ²}、Var(y) = 1 − P_meta（golden）', () => {
    expectGolden(v, 'meta_p_meta_at_zero_list', epss.map((e) => metaProb(0, SIGMA, e)))
    expectGolden(v, 'meta_p_meta_s1_list', epss.map((e) => metaProb(S, SIGMA, e)))
    const sums = epss.map((e) => nonidealSummary(SIGMA, 0, e))
    expectGolden(v, 'meta_slope_ratio_list', sums.map((x) => x.slopeRatio))
    expectGolden(v, 'meta_slope_closed_ratio_list', epss.map((e) => kqMetaDrop(SIGMA, e) / kq(SIGMA)))
    expectGolden(v, 'meta_noise_factor_list', sums.map((x) => x.noiseFactor))
    expectGolden(v, 'meta_kq_eff_ratio_list', sums.map((x) => x.kqEffRatio))
    expectGolden(v, 'meta_dropped_per_block_N4096_eps5', 4096 * metaProb(0, SIGMA, 5))
    for (let i = 0; i < epss.length; i++) {
      expect(Math.abs(sums[i].slope / kqMetaDrop(SIGMA, epss[i]) - 1)).toBeLessThan(1e-9)
      expect(sums[i].noiseFactor).toBeCloseTo(1 - metaProb(0, SIGMA, epss[i]), 12)
      if (i > 0) expect(sums[i].infoRatio).toBeGreaterThan(1) // 漏掉的是幾乎不帶資訊的樣本
    }
    // 手算題 HC-05.10 的數字：ε = 0.05σ_v ⇒ P_meta = 0.03988、每 block 4096 個漏掉 163.3 個、斜率只少 0.125%
    const pm = metaProb(0, SIGMA, 5)
    expect(pm.toFixed(5)).toBe('0.03988')
    expect((4096 * pm).toFixed(1)).toBe('163.3')
    expect(Math.abs(pm / (kq(SIGMA) * 5) - 1)).toBeLessThan(5e-4) // P_meta ≈ K_q·ε，相對差 (ε/σ)²/6
    expect((1 - kqMetaDrop(SIGMA, 5) / kq(SIGMA)) * 100).toBeCloseTo(0.125, 2)
    // 決策時間 T 與再生時間常數：ε(T) = ε₀e^{−T/τ_m}（T = 5τ_m 時剩 0.67%）
    expect(metaWindowAfter(100, 5, 1)).toBeCloseTo(100 * Math.exp(-5), 12)
    expect(metaWindowAfter(100, 0, 1)).toBe(100)
    expect(metaProb(0, SIGMA, 0)).toBe(0)
    expect(metaProb(0, 0, 5)).toBe(1) // σ_v = 0：e 固定落在窗內
    expect(metaProb(10, 0, 5)).toBe(0)
  })

  it('h = 30 fs、ε = 5 fs、s = 1 fs 同時存在：transitions、chain 的平穩統計、數值斜率、Var(S_N) 與 DP 精確分布（golden）', () => {
    const ch = comparatorChain(S, SIGMA, 30, 5)
    expectGolden(v, 'mix_t_up', ch.tUp)
    expectGolden(v, 'mix_t_down', ch.tDown)
    expectGolden(v, 'mix_p_plus_given_prev_plus', ch.fromPlus.plus)
    expectGolden(v, 'mix_p_plus_given_prev_minus', ch.fromMinus.plus)
    expectGolden(v, 'mix_p_meta_given_prev_plus', ch.fromPlus.meta)
    expectGolden(v, 'mix_nu', ch.nu)
    expectGolden(v, 'mix_pi_plus', ch.piPlus)
    expectGolden(v, 'mix_mean_out', ch.meanOut)
    expectGolden(v, 'mix_p_meta', ch.pMeta)
    expectGolden(v, 'mix_var_inf', ch.varInf)
    expectGolden(v, 'mix_var_sum_N1001', chainSumMoments(1001, ch).varSum)
    expectGolden(v, 'mix_slope_numeric', chainSlope(SIGMA, 30, 5))
    const h30 = comparatorChain(S, SIGMA, 30, 0)
    expectGolden(v, 'h30_mean_out_s1', h30.meanOut)
    expectGolden(v, 'h30_var_sum_N1001', chainSumMoments(1001, h30).varSum)
    const ex100 = directionExactChain(ch, 100)!
    expectGolden(v, 'mix_exact_N100', [ex100.pos, ex100.tie, ex100.neg])
    const ex1001 = directionExactChain(ch, 1001)!
    expectGolden(v, 'mix_exact_N1001', [ex1001.pos, ex1001.tie, ex1001.neg])
    const clt = directionCltChain(ch, 1001)
    expectGolden(v, 'mix_clt_N1001', [clt.pos, clt.tie, clt.neg])
    // 三種結果相加 = 1；有 drop 時奇數 N 也會 tie；CLT 與精確相差 < 2e-3
    expect(ex1001.pos + ex1001.tie + ex1001.neg).toBeCloseTo(1, 12)
    expect(ex1001.tie).toBeGreaterThan(0)
    expect(Math.abs(clt.pos - ex1001.pos)).toBeLessThan(2e-3)
    // 轉移機率的結構：q_prev = +1 時門檻低（θ − h），所以 P(+1 | +1) > P(+1 | −1)
    expect(ch.fromPlus.plus).toBeGreaterThan(ch.fromMinus.plus)
    expect(ch.fromPlus.plus + ch.fromPlus.minus + ch.fromPlus.meta).toBeCloseTo(1, 14)
    // 所需 N（CLT、漸近）：z²·varInf/E[y]²
    expect(samplesForConfidenceChain(ch, 0.95)).toBeCloseTo((normInv(0.95) ** 2 * ch.varInf) / (ch.meanOut * ch.meanOut), 10)
  })

  it('Monte Carlo（帶 latch 狀態的 sample-level）：判對、tie、+1 與 metastable 的計數都落在精確 DP 的接受域；同 seed 可重現；h = ε = 0 的路徑不變', () => {
    const N = 400
    const T = 10000
    const r = runComparatorMC({ s: S, sigma: SIGMA, N, trials: T, seed: 20261010, tieRule: 'half', method: 'binomial', h: 30, eps: 5 })
    expect(r.methodUsed).toBe('sample') // binomial 引擎不適用：自動改走 sample-level
    expect(r.notes.join(' ')).toContain('不再獨立')
    const ch = r.nonideal!.chain
    const ex = r.nonideal!.exact!
    const band = (p: number, n: number) => binomialAcceptance(n, p)
    const okIn = (k: number, p: number, n: number) => {
      const { kLo, kHi } = band(p, n)
      return k >= kLo && k <= kHi
    }
    expect(okIn(r.counts.pos, ex.pos, T)).toBe(true)
    expect(okIn(r.counts.tie, ex.tie, T)).toBe(true)
    expect(okIn(r.outcome.correct, ex.pos + ex.tie / 2, T)).toBe(true)
    // metastable 的比例（樣本相關，但 P_meta 的估計以 4·SE·√((1+ν)/(1−ν)) 為容差）
    const pm = r.nonideal!.metaCount / (N * T)
    expect(Math.abs(pm - ch.pMeta)).toBeLessThan(4 * Math.sqrt((ch.pMeta * (1 - ch.pMeta)) / (N * T)) * Math.sqrt((1 + ch.nu) / (1 - ch.nu)))
    // 平均與變異數對 chain 的矩
    const mo = chainSumMoments(N, ch)
    expect(Math.abs(r.sumMean - mo.meanSum)).toBeLessThan((4 * mo.sdSum) / Math.sqrt(T))
    expect(r.sumVar / mo.varSum).toBeGreaterThan(0.93)
    expect(r.sumVar / mo.varSum).toBeLessThan(1.07)
    // histogram：格點間距 1（drop 的 0），期望個數由精確 pmf 逐 bin 加總
    expect(r.nonideal!.lattice).toBe(1)
    expect(r.hist.expected.reduce((x, y) => x + y, 0)).toBeCloseTo(T, 0)
    expect(r.hist.counts.reduce((x, y) => x + y, 0) + r.hist.outside).toBe(T)
    const r2 = runComparatorMC({ s: S, sigma: SIGMA, N, trials: T, seed: 20261010, tieRule: 'half', h: 30, eps: 5 })
    expect(Array.from(r2.sums.slice(0, 50))).toEqual(Array.from(r.sums.slice(0, 50)))
    // h = ε = 0：和沒有這兩個欄位時逐位元相同（既有行為不變）
    const a = runComparatorMC({ s: S, sigma: SIGMA, N: 101, trials: 500, seed: 3, tieRule: 'half', method: 'sample' })
    const b = runComparatorMC({ s: S, sigma: SIGMA, N: 101, trials: 500, seed: 3, tieRule: 'half', method: 'sample', h: 0, eps: 0 })
    expect(Array.from(b.sums)).toEqual(Array.from(a.sums))
    expect(b.nonideal).toBeUndefined()
    expect(b.methodUsed).toBe('sample')
  })

  it('P(判對) vs N 曲線（非理想）：N ≤ 120 精確 DP、其餘 CLT；MC 掃描的 99.9% Wilson 區間涵蓋解析值；純遲滯沒有 drop 時格點仍是間距 2', () => {
    const ch = comparatorChain(S, SIGMA, 30, 5)
    const c = directionCurveChain(ch, 5000, 'half')
    expect(c.oddN.length).toBe(120)
    expect(c.evenN).toEqual([])
    expect(c.allN.length).toBeGreaterThan(120)
    // 精確與 CLT 在 N = 100 相差 < 5e-3；大 N 單調上升
    const i100 = c.allN.indexOf(100)
    expect(Math.abs(c.oddExact[99] - c.cltPlain[i100])).toBeLessThan(5e-3)
    for (let i = 130; i < c.cltPlain.length; i++) expect(c.cltPlain[i]).toBeGreaterThanOrEqual(c.cltPlain[i - 1] - 1e-12)
    const sw = runComparatorSweep({ s: S, sigma: SIGMA, Ns: [3, 100, 101, 1000, 1001], trials: 2000, seed: 5, tieRule: 'half', level: 0.999, h: 30, eps: 5 })
    for (let i = 0; i < sw.N.length; i++) {
      expect(sw.lo[i], `N = ${sw.N[i]}`).toBeLessThanOrEqual(sw.exact[i])
      expect(sw.hi[i], `N = ${sw.N[i]}`).toBeGreaterThanOrEqual(sw.exact[i])
    }
    // 純遲滯：S_N 與 N 同奇偶（沒有 0），histogram 用間距 2 的格點；DP 的 tie 在奇數 N 為 0
    const pure = comparatorChain(S, SIGMA, 30, 0)
    expect(directionExactChain(pure, 101)!.tie).toBe(0)
    const rp = runComparatorMC({ s: S, sigma: SIGMA, N: 101, trials: 300, seed: 1, tieRule: 'half', h: 30 })
    expect(rp.nonideal!.lattice).toBe(2)
    expect(rp.counts.tie).toBe(0)
    const e1 = latticeEdgesSpaced(10, 0, 2, 1)
    expect(Math.abs(e1[0] % 1)).toBe(0.5)
    const pmf = Float64Array.of(0, 0.5, 0.5)
    expect(Array.from(binnedPmf(pmf, 1, [-1.5, -0.5, 0.5, 1.5]))).toEqual([0, 0.5, 0.5])
    // 工作量上限：超過就回傳 null（改用 CLT）
    expect(chainSumPmf(ch, 100000, 1e6)).toBeNull()
    // latch 卡住（σ_v = 0、|s| 落在窗內）：chain 標 stuck，DP 不適用
    expect(comparatorChain(1, 0, 0, 5).stuck).toBe(true)
    expect(directionExactChain(comparatorChain(1, 0, 0, 5), 10)).toBeNull()
  })
})
