import { describe, expect, it } from 'vitest'
import { createRng } from '@/simulation/core'
import {
  analyzeDsm,
  codeStats,
  detectPeriod,
  DsmStream,
  dsmSpectra,
  firstOrderPeriod,
  normalizeCode,
  psdSlopeDbPerDecade,
  quantizeFcw,
  runDsm,
} from '@/simulation/models/dsm'

// 參考序列與 checksum 由 python3 以獨立實作（整數運算）產生後貼上。

function checksum(x: ArrayLike<number>, scale = 1): number {
  let s = 0
  for (let n = 0; n < x.length; n++) s += (n + 1) * Math.round(x[n] * scale)
  return s
}

describe('一階累加器 DSM', () => {
  it('frac = 0.25、B = 8：y = [0,0,0,1,…]，residue = [−0.25, −0.5, −0.75, 0, …]，週期 4', () => {
    const r = runDsm({ kind: 'first_order', frac: 0.25, bits: 8, length: 12 })
    expect(Array.from(r.y)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(Array.from(r.residue)).toEqual([-0.25, -0.5, -0.75, 0, -0.25, -0.5, -0.75, 0, -0.25, -0.5, -0.75, 0])
    expect(r.K).toBe(64)
    expect(r.period).toBe(4)
    expect(codeStats(r.y).mean).toBe(0.25)
  })

  it('mean(y) = frac：整數週期內精確等於 K/M；長序列 |mean − frac| ≤ 1/M + 1/L', () => {
    const r = runDsm({ kind: 'first_order', frac: 0.3, bits: 10, length: 1024 * 7 })
    expect(r.K).toBe(307)
    expect(codeStats(r.y).mean).toBe(307 / 1024)
    const r2 = runDsm({ kind: 'first_order', frac: 0.123456789, bits: 20, length: 100000 })
    expect(Math.abs(codeStats(r2.y).mean - 0.123456789)).toBeLessThanOrEqual(1 / 2 ** 20 + 1 / 100000)
  })

  it('K = 307、B = 10：與 python 獨立實作的 checksum 一致；residue ∈ (−1, 0]；週期 = M/gcd(K, M) = 1024', () => {
    const r = runDsm({ kind: 'first_order', frac: 0.3, bits: 10, length: 20000 })
    expect(checksum(r.y)).toBe(59972052)
    expect(checksum(r.residue, 1024)).toBe(-102244789776)
    expect(r.residueRange[0]).toBe(-1023 / 1024)
    expect(r.residueRange[1]).toBe(0)
    expect(r.period).toBe(1024)
    expect(firstOrderPeriod(307, 10)).toBe(1024)
    expect(firstOrderPeriod(64, 8)).toBe(4)
    expect(firstOrderPeriod(0, 8)).toBe(1)
  })
})

describe('MASH 1-1-1', () => {
  it('前 40 個 y 與整數 residue 與 python 一致（K = 307、B = 10、零初值）', () => {
    const r = runDsm({ kind: 'mash111', frac: 0.3, bits: 10, length: 40 })
    expect(Array.from(r.y)).toEqual([
      0, 1, -1, 2, 0, -1, 2, -2, 3, -2, 2, 0, -1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2, -2, 2, -1, 2, -2, 3, -2, 1, 1, 0, -1, 3,
      -3, 3,
    ])
    const rInt = Array.from(r.residue, (v) => v * 1024)
    expect(rInt).toEqual([
      -307, 410, -921, 820, 513, -818, 923, -1432, 1333, -1022, 719, 412, -919, -202, 515, 208, -99, -406, 311, 4, -303, 414,
      107, -200, -507, 1234, -1121, 620, -711, 1030, -1325, 1440, -915, -198, 519, 212, -1119, 1646, -1733, 1032,
    ])
  })

  it('20000 點 checksum、y ∈ {−3…4}、|residue| < 2、週期 2048', () => {
    const r = runDsm({ kind: 'mash111', frac: 0.3, bits: 10, length: 20000 })
    expect(checksum(r.y)).toBe(59982061)
    let sy2 = 0
    for (const v of r.y) sy2 += v * v
    expect(sy2).toBe(37395)
    expect(checksum(r.residue, 1024)).toBe(9281008)
    expect(r.residueRange).toEqual([-1927 / 1024, 1927 / 1024])
    expect(r.yRange[0]).toBeGreaterThanOrEqual(-3)
    expect(r.yRange[1]).toBeLessThanOrEqual(4)
    expect(r.period).toBe(2048)
    // 量化誤差的累加 = residue
    let acc = 0
    for (let n = 0; n < 20000; n++) acc += r.quantError[n]
    expect(acc).toBeCloseTo(r.residue[19999], 9)
  })

  it('NTF 塑形（dither、B = 20）：y − frac 低頻約 60 dB/dec，phase residue 約 40 dB/dec；變異數 20/12 與 6/12', () => {
    const fs = 1
    const r = runDsm({ kind: 'mash111', frac: Math.PI / 10, bits: 20, length: 1 << 18, dither: true, seed: 5 })
    const sp = dsmSpectra(r, fs, { nperseg: 4096 })
    // python（scipy welch、同設定、不同亂數）：59.73 / 39.81 dB/dec
    const sq = psdSlopeDbPerDecade(sp.quantError.f, sp.quantError.psd, 1 / 400, 1 / 40)
    const sr = psdSlopeDbPerDecade(sp.residue.f, sp.residue.psd, 1 / 400, 1 / 40)
    expect(sq).toBeGreaterThan(58)
    expect(sq).toBeLessThan(62)
    expect(sr).toBeGreaterThan(38)
    expect(sr).toBeLessThan(42)
    // white-uniform 理論 PSD 的中位數比值（python 0.996）
    const ratio = (psd: Float64Array, th: Float64Array, f: Float64Array): number => {
      const v: number[] = []
      for (let i = 0; i < f.length; i++) if (f[i] > 0.01 && f[i] < 0.45) v.push(psd[i] / th[i])
      v.sort((a, b) => a - b)
      return v[Math.floor(v.length / 2)]
    }
    expect(Math.abs(ratio(sp.quantError.psd, sp.theoryQuantError, sp.quantError.f) - 1)).toBeLessThan(0.08)
    expect(Math.abs(ratio(sp.residue.psd, sp.theoryResidue, sp.residue.f) - 1)).toBeLessThan(0.08)
    expect(Math.abs(codeStats(r.quantError).std ** 2 / (20 / 12) - 1)).toBeLessThan(0.03)
    expect(Math.abs(codeStats(r.residue).std ** 2 / (6 / 12) - 1)).toBeLessThan(0.03)
    // 有界
    expect(Math.max(Math.abs(r.residueRange[0]), Math.abs(r.residueRange[1]))).toBeLessThan(2)
    // dither 時不偵測週期
    expect(r.period).toBe(0)
    expect(r.fracEff).toBe((r.K + 0.5) / 2 ** 20)
  })

  it('analyzeDsm（worker 版）：f_s = 4 GHz 時斜率不變、PSD 欄位齊全', () => {
    const r = analyzeDsm({ options: { kind: 'mash111', frac: 0.3141592653589793, bits: 20, length: 1 << 17, dither: true, seed: 2 }, fs: 4e9 })
    expect(r.slopeQuantErrorDbPerDec).toBeGreaterThan(57)
    expect(r.slopeQuantErrorDbPerDec).toBeLessThan(63)
    expect(r.slopeResidueDbPerDec).toBeGreaterThan(37)
    expect(r.slopeResidueDbPerDec).toBeLessThan(43)
    expect(r.spectra.residue.window).toBe('hann')
    expect(r.spectra.residue.nperseg).toBe(4096)
    expect(r.spectra.residue.onesided).toBe(true)
    expect(r.spectra.residue.units).toBe('x^2/Hz')
    // Parseval：∫ PSD df ≈ 時域變異數（detrend = 去平均）
    let integral = 0
    const sp = r.spectra.residue
    for (let i = 0; i < sp.psd.length; i++) integral += sp.psd[i] * sp.df
    expect(Math.abs(integral / codeStats(r.result.residue).std ** 2 - 1)).toBeLessThan(0.05)
  })

  it('一階 DSM 的 y − frac 只有 20 dB/dec（對照）', () => {
    const r = runDsm({ kind: 'first_order', frac: Math.PI / 10, bits: 20, length: 1 << 18, dither: true, seed: 5 })
    const sp = dsmSpectra(r, 1, { nperseg: 4096 })
    const sq = psdSlopeDbPerDecade(sp.quantError.f, sp.quantError.psd, 1 / 400, 1 / 40)
    expect(sq).toBeGreaterThan(15)
    expect(sq).toBeLessThan(25)
    expect(r.residueRange[0]).toBeGreaterThan(-1)
    expect(r.residueRange[1]).toBeLessThanOrEqual(0)
  })
})

describe('決定性、串流與正規化', () => {
  it('同 seed 完全重現；不同 seed 不同', () => {
    const a = runDsm({ kind: 'mash111', frac: 0.37, bits: 16, length: 5000, dither: true, seed: 42 })
    const b = runDsm({ kind: 'mash111', frac: 0.37, bits: 16, length: 5000, dither: true, seed: 42 })
    const c = runDsm({ kind: 'mash111', frac: 0.37, bits: 16, length: 5000, dither: true, seed: 43 })
    expect(Array.from(a.y)).toEqual(Array.from(b.y))
    expect(Array.from(a.residue)).toEqual(Array.from(b.residue))
    expect(Array.from(a.y)).not.toEqual(Array.from(c.y))
  })

  it('DsmStream 與 runDsm 一致；reset 回到初始狀態；初值改變序列', () => {
    const r = runDsm({ kind: 'mash111', frac: 0.3, bits: 10, length: 100 })
    const s = new DsmStream({ kind: 'mash111', frac: 0.3, bits: 10 })
    for (let n = 0; n < 100; n++) {
      expect(s.step()).toBe(r.y[n])
      expect(s.residue).toBe(r.residue[n])
    }
    s.reset()
    expect(s.step()).toBe(r.y[0])
    const r2 = runDsm({ kind: 'mash111', frac: 0.3, bits: 10, length: 100, initialState: [1, 0, 0] })
    expect(Array.from(r2.y)).not.toEqual(Array.from(r.y))
    expect(() => new DsmStream({ kind: 'first_order', frac: 0.3, bits: 10, initialState: [1024] })).toThrow()
  })

  it('code_normalization：none / zero_mean / unit_rms（保留平均）/ standardize', () => {
    const x = [1, 2, 3, 6]
    const none = normalizeCode(x, 'none')
    expect(Array.from(none.code)).toEqual(x)
    const zm = normalizeCode(x, 'zero_mean')
    expect(codeStats(zm.code).mean).toBeCloseTo(0, 15)
    const ur = normalizeCode(x, 'unit_rms')
    expect(codeStats(ur.code).meanSquare).toBeCloseTo(1, 14)
    expect(ur.code[0] / ur.code[3]).toBeCloseTo(1 / 6, 14) // 不減平均
    const st = normalizeCode(x, 'standardize')
    expect(codeStats(st.code).mean).toBeCloseTo(0, 14)
    expect(codeStats(st.code).std).toBeCloseTo(1, 14)
    const z = normalizeCode([0, 0, 0], 'unit_rms')
    expect(z.warnings[0]).toMatch(/Persistent Excitation/)
    const r = runDsm({ kind: 'mash111', frac: 0.3, bits: 10, length: 4096, normalization: 'standardize' })
    expect(codeStats(r.code).std).toBeCloseTo(1, 12)
  })

  it('quantizeFcw：四捨五入、範圍檢查', () => {
    expect(quantizeFcw(0.3, 10).K).toBe(307)
    expect(quantizeFcw(0.9999999, 8).K).toBe(255)
    expect(quantizeFcw(0.9999999, 8).warnings.length).toBeGreaterThan(0)
    expect(() => quantizeFcw(1, 8)).toThrow(/frac/)
    expect(() => quantizeFcw(0.5, 33)).toThrow(/位元/)
  })
})

describe('detectPeriod', () => {
  it('KMP（完全相等）、容忍度模式、暫態起點、無週期', () => {
    expect(detectPeriod([1, 2, 3, 1, 2, 3, 1, 2])).toBe(3)
    expect(detectPeriod([1, 2, 3, 1, 2])).toBe(0) // 不足兩次重複
    expect(detectPeriod([9, 9, 1, 2, 1, 2, 1, 2], { start: 2 })).toBe(2)
    expect(detectPeriod([9, 9, 1, 2, 1, 2, 1, 2])).toBe(0)
    expect(detectPeriod([0.1, 0.2000001, 0.1, 0.2, 0.1, 0.2], { tol: 1e-6 })).toBe(2)
    const rng = createRng(9)
    expect(detectPeriod(rng.normalArray(5000))).toBe(0)
    // 長週期：一階 DSM，B = 16、K 奇數 ⇒ 週期 65536
    const r = runDsm({ kind: 'first_order', frac: 12345 / 65536, bits: 16, length: 65536 * 3 })
    expect(detectPeriod(r.residue)).toBe(65536)
  })
})
