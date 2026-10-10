import { describe, expect, it } from 'vitest'
import { createRng } from '@/simulation/core/rng'
import {
  autocorr,
  correlation,
  covariance,
  effectiveSampleSize,
  histogram,
  mean,
  meanCI,
  median,
  minMax,
  quantile,
  quantiles,
  rms,
  std,
  sum,
  variance,
  wilsonCI,
} from '@/simulation/core/stats'

// 參考資料：rng = np.random.default_rng(11)；x = round(2·standard_normal(20) + 0.5, 4)；參考值由 NumPy / SciPy 計算
const X = [
  0.5684, 3.2195, 2.9494, -0.5206, -0.0959, -0.5548, 1.6395, 0.3879, 1.9938, -3.1946, 3.6331, 0.3071, 1.8608, 0.2269,
  -0.2582, 1.4262, 2.149, 0.0949, 0.1944, 1.8714,
]
const rel = (a: number, b: number): number => Math.abs((a - b) / b)

describe('stats：描述統計（NumPy 參考值）', () => {
  it('mean / variance / std / rms', () => {
    expect(rel(mean(X), 0.8949100000000001)).toBeLessThan(1e-15)
    expect(rel(variance(X), 2.52909135568421)).toBeLessThan(1e-14)
    expect(rel(variance(X, 0), 2.4026367878999997)).toBeLessThan(1e-14)
    expect(rel(std(X), 1.5903117165147875)).toBeLessThan(1e-14)
    expect(rel(rms(X), 1.7898325888194127)).toBeLessThan(1e-14)
    expect(Number.isNaN(mean([]))).toBe(true)
    expect(Number.isNaN(variance([1]))).toBe(true)
    expect(variance([1], 0)).toBe(0)
    expect(rms([3, 4, 0, 0])).toBe(2.5)
  })

  it('大偏移量資料不發生抵消（1e9 + 0.1k，精確有理數計算的變異 = 0.09166666136847729）', () => {
    const y = Array.from({ length: 10 }, (_, k) => 1e9 + (k + 1) * 0.1)
    expect(rel(variance(y), 0.09166666136847729)).toBeLessThan(1e-12)
    expect(mean(y)).toBe(1000000000.55)
    // Float64Array 輸入亦可；補償加總：1 + 1e-16 × 1e4 個
    const z = new Float64Array(10001).fill(1e-16)
    z[0] = 1
    expect(sum(z)).toBe(1 + 1e-12)
  })

  it('quantile（linear，同 np.quantile）/ median / minMax', () => {
    const ref = [-3.1946, -0.5240199999999999, 0.0472, 0.47815, 2.97641, 3.6331]
    const qs = [0, 0.1, 0.25, 0.5, 0.9, 1]
    quantiles(X, qs).forEach((v, i) => expect(Math.abs(v - ref[i])).toBeLessThan(1e-14))
    expect(quantile(X, 0.25)).toBeCloseTo(0.0472, 14)
    expect(median(X)).toBeCloseTo(0.47815, 14)
    expect(minMax(X)).toEqual({ min: -3.1946, max: 3.6331 })
    expect(() => quantile(X, 1.5)).toThrow()
  })

  it('histogram（同 np.histogram：最後一個 bin 含右端點）', () => {
    const h = histogram(X, 5)
    expect(h.counts).toEqual([1, 2, 8, 6, 3])
    const edges = [-3.1946, -1.82906, -0.46351999999999993, 0.9020199999999998, 2.26756, 3.6331]
    h.edges.forEach((e, i) => expect(Math.abs(e - edges[i])).toBeLessThan(1e-14))
    expect(h.outside).toBe(0)
    const h2 = histogram(X, 4, [-2, 2])
    expect(h2.counts).toEqual([0, 4, 6, 5])
    expect(h2.edges).toEqual([-2, -1, 0, 1, 2])
    expect(h2.centers).toEqual([-1.5, -0.5, 0.5, 1.5])
    expect(h2.outside).toBe(5)
    // 右端點歸入最後一個 bin；常數資料用 [v − 0.5, v + 0.5]
    expect(histogram([0, 1, 1], 2).counts).toEqual([1, 2])
    expect(histogram([3, 3, 3], 2).edges).toEqual([2.5, 3, 3.5])
    expect(() => histogram(X, 0)).toThrow()
  })
})

describe('stats：信賴區間', () => {
  it('meanCI：Student-t（SciPy stats.t.interval）', () => {
    const ci95 = meanCI(X)
    expect(Math.abs(ci95.lo - 0.15062120597268824)).toBeLessThan(1e-12)
    expect(Math.abs(ci95.hi - 1.6391987940273118)).toBeLessThan(1e-12)
    // t_{0.975, 19} = 2.0930240544083087（SciPy）
    expect(rel(ci95.halfWidth / ci95.se, 2.0930240544083087)).toBeLessThan(1e-12)
    const ci99 = meanCI(X, 0.99)
    expect(Math.abs(ci99.lo - -0.12245124988720457)).toBeLessThan(1e-12)
    expect(Math.abs(ci99.hi - 1.9122712498872048)).toBeLessThan(1e-12)
    expect(Number.isNaN(meanCI([1]).halfWidth)).toBe(true)
  })

  it('wilsonCI：與 (p̂ − p)² = z² p(1−p)/n 的兩根一致（NumPy roots）', () => {
    const cases: [number, number, number, number][] = [
      [504, 1000, 0.47305527933504565, 0.5349141065970698],
      [0, 20, 0, 0.16112515805281938],
      [20, 20, 0.8388748419471801, 1],
      [42, 100, 0.3279838267435474, 0.5179351329695702],
    ]
    for (const [k, n, lo, hi] of cases) {
      const ci = wilsonCI(k, n)
      expect(Math.abs(ci.lo - lo)).toBeLessThan(1e-14)
      expect(Math.abs(ci.hi - hi)).toBeLessThan(1e-14)
    }
    const ci99 = wilsonCI(42, 100, 0.99)
    expect(Math.abs(ci99.lo - 0.3017634651808456)).toBeLessThan(1e-14)
    expect(Math.abs(ci99.hi - 0.548191844853686)).toBeLessThan(1e-14)
    expect(() => wilsonCI(5, 4)).toThrow()
  })

  it('meanCI 覆蓋率：2000 次 N = 10 的常態樣本，95% CI 涵蓋真值的比例在 Wilson 99.9% 界內', () => {
    const r = createRng(777)
    let hit = 0
    const T = 2000
    for (let t = 0; t < T; t++) {
      const ci = meanCI(r.normalArray(10, 2))
      if (ci.lo <= 0 && 0 <= ci.hi) hit++
    }
    // 覆蓋率 0.95 時，SE = √(0.95·0.05/2000) ≈ 0.00487；±3.3σ
    expect(Math.abs(hit / T - 0.95)).toBeLessThan(3.3 * 0.00487)
  })
})

describe('stats：自相關與有效樣本數', () => {
  it('autocorr（biased，同 statsmodels acf(adjusted=False)；NumPy 手算）', () => {
    const ref = [1.0, -0.3513595620679958, 0.049837766175494, -0.3266075531128764, 0.20338958407738286, 0.04225450356719727]
    autocorr(X, 5).forEach((v, i) => expect(Math.abs(v - ref[i])).toBeLessThan(1e-14))
    expect(autocorr([2, 2, 2], 1).every((v) => Number.isNaN(v))).toBe(true)
    expect(autocorr(X, 100).length).toBe(20)
  })

  it('AR(1) φ = 0.5：ρ_k ≈ φ^k，有效樣本數 ≈ N(1−φ)/(1+φ) = N/3', () => {
    const r = createRng(4242)
    const N = 200_000
    const phi = 0.5
    const x = new Float64Array(N)
    let s = 0
    for (let i = 0; i < N; i++) {
      s = phi * s + r.normal()
      x[i] = s
    }
    const rho = autocorr(x, 3)
    // ρ̂_k 的 SE 約 √((1+φ²)/(1−φ²)/N) ≈ 3.5e-3
    expect(Math.abs(rho[1] - 0.5)).toBeLessThan(0.02)
    expect(Math.abs(rho[2] - 0.25)).toBeLessThan(0.02)
    const ess = effectiveSampleSize(x)
    expect(Math.abs(ess / (N / 3) - 1)).toBeLessThan(0.1)
    // 白雜訊：ESS ≈ N
    const w = r.normalArray(N)
    expect(Math.abs(effectiveSampleSize(w) / N - 1)).toBeLessThan(0.1)
  })

  it('covariance / correlation', () => {
    const y = X.map((v) => 3 * v - 1)
    expect(rel(covariance(X, y), 3 * 2.52909135568421)).toBeLessThan(1e-13)
    expect(correlation(X, y)).toBeCloseTo(1, 14)
    expect(correlation(X, y.map((v) => -v))).toBeCloseTo(-1, 14)
    expect(() => covariance([1, 2], [1])).toThrow()
  })
})
