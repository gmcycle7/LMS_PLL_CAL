import { describe, expect, it } from 'vitest'
import { createRng, deriveSeed, normalizeSeed, seedState, xoshiro128ss } from '@/simulation/core/rng'

// 參考值由獨立的 Python 實作（splitmix32 + xoshiro128**，純整數運算）產生
describe('rng：演算法參考向量', () => {
  it('xoshiro128** 以狀態 {1,2,3,4} 產生官方參考序列', () => {
    const next = xoshiro128ss(1, 2, 3, 4)
    const out = Array.from({ length: 10 }, () => next())
    expect(out).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804])
  })

  it('splitmix32 seeding 與前 8 個 uint32 輸出（seed = 0、20261010）', () => {
    expect(seedState(0)).toEqual([1684164658, 3653269916, 2939563536, 2141751570])
    expect(seedState(20261010)).toEqual([2276518332, 2670786744, 1565042879, 2565287453])
    const r0 = createRng(0)
    expect(Array.from({ length: 8 }, () => r0.uint32())).toEqual([
      1789933344, 44971166, 2521387044, 3848737593, 1138324114, 749234105, 1899511038, 1995189375,
    ])
    const r1 = createRng(20261010)
    expect(Array.from({ length: 8 }, () => r1.uint32())).toEqual([
      3453758581, 609415454, 2804131996, 2936663919, 4087987899, 3718805989, 3001367291, 2407104922,
    ])
  })

  it('uniform() 由兩個 32-bit 輸出組成 53-bit 值', () => {
    const r = createRng(20261010)
    const u = [r.uniform(), r.uniform(), r.uniform(), r.uniform()]
    expect(u).toEqual([0.8041408296070292, 0.6528878560941319, 0.9518088539380728, 0.698810276094435])
  })

  it('normal()：Box–Muller（cos 在前、sin 為快取 spare）', () => {
    const ref = [-1.0347100719003706, -1.47989657068787, -0.7785202646063076, -2.3364644509424433]
    const r = createRng(20261010)
    for (const v of ref) expect(Math.abs(r.normal() - v)).toBeLessThan(1e-14)
    const r0 = createRng(0)
    for (const v of [-0.8868947106344905, -0.5400935828026158, -0.7337002414628956, 0.27848424041139835]) {
      expect(Math.abs(r0.normal() - v)).toBeLessThan(1e-14)
    }
  })

  it('fork 子 seed 由 (seed, label) 雜湊得到', () => {
    expect(deriveSeed(20261010, 'noise')).toBe(2921072818)
    expect(deriveSeed(20261010, 'dither')).toBe(458901236)
    expect(deriveSeed(0, 1)).toBe(2891899017)
    expect(deriveSeed(0, '1')).toBe(2891899017)
  })
})

describe('rng：可重現性（determinism）', () => {
  it('同 seed ⇒ 完全相同序列；不同 seed ⇒ 不同序列', () => {
    const a = createRng(42)
    const b = createRng(42)
    const c = createRng(43)
    const xa = Array.from({ length: 1000 }, () => a.normal())
    const xb = Array.from({ length: 1000 }, () => b.normal())
    const xc = Array.from({ length: 1000 }, () => c.normal())
    expect(xa).toEqual(xb)
    expect(xa).not.toEqual(xc)
  })

  it('normalizeSeed：[0, 2^32) 整數不變；小數截斷；負數與大數仍可重現', () => {
    expect(normalizeSeed(0)).toBe(0)
    expect(normalizeSeed(4294967295)).toBe(4294967295)
    expect(normalizeSeed(12.9)).toBe(12)
    expect(normalizeSeed(-1)).toBe(normalizeSeed(-1))
    expect(normalizeSeed(2 ** 40 + 5)).not.toBe(5)
    expect(() => createRng(NaN)).toThrow(/seed/)
    expect(createRng(12.9).uniform()).toBe(createRng(12).uniform())
  })

  it('rng.seed 保留原值；createRng(fork.seed) 重現 fork 串流', () => {
    const r = createRng(20261010)
    expect(r.seed).toBe(20261010)
    const f = r.fork('comparator-noise')
    const g = createRng(f.seed)
    for (let i = 0; i < 100; i++) expect(g.uniform()).toBe(f.uniform())
  })

  it('fork 與父串流已抽取的數量無關', () => {
    const r1 = createRng(7)
    const r2 = createRng(7)
    for (let i = 0; i < 12345; i++) r2.uniform()
    const f1 = r1.fork('dsm')
    const f2 = r2.fork('dsm')
    for (let i = 0; i < 50; i++) expect(f1.normal()).toBe(f2.normal())
  })
})

describe('rng：統計性質（固定 seed + 信賴界限）', () => {
  it('1e6 個 normal：平均、變異、峰度落在 5σ 區間內', () => {
    const r = createRng(123456)
    const N = 1_000_000
    const x = r.normalArray(N)
    let s1 = 0
    let s2 = 0
    let s4 = 0
    for (let i = 0; i < N; i++) {
      s1 += x[i]
      const q = x[i] * x[i]
      s2 += q
      s4 += q * q
    }
    const mean = s1 / N
    const m2 = s2 / N
    const m4 = s4 / N
    // SE(mean) = 1/√N = 1e-3；SE(E[x²]) = √(2/N) ≈ 1.414e-3；SE(E[x⁴]) = √(96/N) ≈ 9.8e-3
    expect(Math.abs(mean)).toBeLessThan(5e-3)
    expect(Math.abs(m2 - 1)).toBeLessThan(5 * 1.4142e-3)
    expect(Math.abs(m4 - 3)).toBeLessThan(5 * 9.798e-3)
  })

  it('normalArray(n, σ) 依 σ 縮放', () => {
    const x = createRng(9).normalArray(200_000, 100)
    let s2 = 0
    for (const v of x) s2 += v * v
    // SE(σ̂²/σ²) = √(2/N) ≈ 3.16e-3
    expect(Math.abs(s2 / x.length / 1e4 - 1)).toBeLessThan(5 * 3.163e-3)
  })

  it('uniform：100 bins 卡方檢定（χ²_99 的 1−1e-6 分位數 = 180.792，scipy）', () => {
    const r = createRng(2024)
    const N = 1_000_000
    const counts = new Array<number>(100).fill(0)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < N; i++) {
      const u = r.uniform()
      lo = Math.min(lo, u)
      hi = Math.max(hi, u)
      counts[Math.floor(u * 100)]++
    }
    expect(lo).toBeGreaterThanOrEqual(0)
    expect(hi).toBeLessThan(1)
    const e = N / 100
    const chi2 = counts.reduce((acc, c) => acc + ((c - e) * (c - e)) / e, 0)
    expect(chi2).toBeLessThan(180.79201532577878)
    expect(chi2).toBeGreaterThan(45.834423983696226) // 太完美也可疑（χ²_99 的 1e-6 分位數，scipy）
  })

  it('int(lo, hi) 均勻無偏：10 個值的卡方（χ²_9 的 1−1e-6 分位數 = 44.811）', () => {
    const r = createRng(99)
    const N = 200_000
    const counts = new Array<number>(10).fill(0)
    let bad = 0
    for (let i = 0; i < N; i++) {
      const k = r.int(-3, 6)
      if (!(Number.isInteger(k) && k >= -3 && k <= 6)) bad++
      else counts[k + 3]++
    }
    expect(bad).toBe(0)
    const e = N / 10
    const chi2 = counts.reduce((acc, c) => acc + ((c - e) * (c - e)) / e, 0)
    expect(chi2).toBeLessThan(44.81093787062026)
    expect(() => r.int(3, 2)).toThrow()
    expect(() => r.int(0.5, 2)).toThrow()
    expect(r.int(5, 5)).toBe(5)
  })

  it('bernoulli(p) 與 sign() 的頻率', () => {
    const r = createRng(5)
    const N = 400_000
    let k = 0
    let s = 0
    for (let i = 0; i < N; i++) {
      if (r.bernoulli(0.503989)) k++
      s += r.sign()
    }
    // SE = √(p(1−p)/N) ≈ 7.9e-4；sign 和的 SE = √N ≈ 632
    expect(Math.abs(k / N - 0.503989)).toBeLessThan(5 * 7.906e-4)
    expect(Math.abs(s)).toBeLessThan(5 * 632.5)
    expect(createRng(1).bernoulli(0)).toBe(false)
    expect(createRng(1).bernoulli(1)).toBe(true)
  })

  it('fork 子串流彼此獨立：相關係數 ≈ 0（|ρ| < 5/√N）', () => {
    const r = createRng(31337)
    const N = 200_000
    const streams = [r, r.fork('a'), r.fork('b'), r.fork(0), r.fork(1)].map((g) => g.normalArray(N))
    const corr = (x: Float64Array, y: Float64Array): number => {
      let sxy = 0
      let sxx = 0
      let syy = 0
      for (let i = 0; i < N; i++) {
        sxy += x[i] * y[i]
        sxx += x[i] * x[i]
        syy += y[i] * y[i]
      }
      return sxy / Math.sqrt(sxx * syy)
    }
    const bound = 5 / Math.sqrt(N)
    for (let i = 0; i < streams.length; i++) {
      for (let j = i + 1; j < streams.length; j++) {
        expect(Math.abs(corr(streams[i], streams[j]))).toBeLessThan(bound)
      }
    }
    // lag-1 自相關也應 ≈ 0
    const x = streams[0]
    let s = 0
    let s0 = 0
    for (let i = 0; i < N - 1; i++) s += x[i] * x[i + 1]
    for (let i = 0; i < N; i++) s0 += x[i] * x[i]
    expect(Math.abs(s / s0)).toBeLessThan(bound)
  })
})
