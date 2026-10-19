import { describe, expect, it } from 'vitest'
import { createRng } from '@/simulation/core'
import {
  dtcBitsFor,
  dtcCodeRange,
  dtcCompensation,
  dtcCompensationStats,
  dtcEffectiveSigmaV,
  dtcKqRatio,
  dtcLsbFs,
  dtcQuantizationJitterRms,
  dtcRangeBudget,
  dtcDelayFs,
  dtcIdealCode,
  dtcInlDnl,
  dtcMapping,
  dtcNonlinearityFs,
  dtcTransfer,
  quantizeDtcCode,
} from '@/simulation/models/dtc'

describe('DTC delay mapping（fs）', () => {
  it('gain·code + offset + c2·code² + c3·code³', () => {
    const p = { gainFs: 2, offsetFs: 5, c2: 0.01, c3: -0.001 }
    expect(dtcMapping(10, p)).toBeCloseTo(20 + 5 + 1 - 1, 13)
    expect(dtcDelayFs(10.4, p)).toBeCloseTo(dtcMapping(10.4, p), 13) // 未給 bits：不量化
    expect(dtcIdealCode(25, { gainFs: 2, offsetFs: 5 })).toBe(10)
    expect(() => dtcIdealCode(1, { gainFs: 0 })).toThrow()
  })

  it('實體 code 量化與飽和（unsigned / signed、nearest / truncate）', () => {
    expect(dtcCodeRange(6)).toEqual([0, 63])
    expect(dtcCodeRange(6, true)).toEqual([-32, 31])
    const u = { bits: 6 }
    expect(quantizeDtcCode(63.6, u)).toEqual({ code: 63, saturated: true })
    expect(quantizeDtcCode(62.5, u)).toEqual({ code: 63, saturated: false }) // round-half-up
    expect(quantizeDtcCode(-0.4, u)).toEqual({ code: 0, saturated: false })
    expect(quantizeDtcCode(-0.6, u)).toEqual({ code: 0, saturated: true })
    const t = { bits: 6, rounding: 'truncate' as const }
    expect(quantizeDtcCode(2.9, t)).toEqual({ code: 2, saturated: false })
    expect(quantizeDtcCode(-0.1, t)).toEqual({ code: 0, saturated: true })
    const s = { bits: 6, signed: true, rounding: 'truncate' as const }
    expect(quantizeDtcCode(-2.5, s)).toEqual({ code: -3, saturated: false }) // 二補數截斷 = floor
    expect(quantizeDtcCode(-40, s)).toEqual({ code: -32, saturated: true })
    const r = dtcTransfer([1.2, 70, -3], { gainFs: 1.5, bits: 6 })
    expect(Array.from(r.codes)).toEqual([1, 63, 0])
    expect(Array.from(r.delayFs)).toEqual([1.5, 94.5, 0])
    expect(r.saturationCount).toBe(2)
  })

  it('INL 查表：整數 code 直接取值，非整數線性內插，超出範圍取端點', () => {
    const p = { gainFs: 1, inlLutFs: [0, 0.5, -0.5, 0] }
    expect(dtcMapping(1, p)).toBeCloseTo(1.5, 14)
    expect(dtcMapping(1.5, p)).toBeCloseTo(1.5, 14)
    expect(dtcMapping(2, p)).toBeCloseTo(1.5, 14)
    expect(dtcMapping(10, p)).toBeCloseTo(10, 14)
    const q = { gainFs: 1, bits: 3, signed: true, inlLutFs: [0.1, 0, 0, 0, 0, 0, 0, 0.7] }
    expect(dtcDelayFs(-4, q)).toBeCloseTo(-4 + 0.1, 14) // LUT 起點 = code 範圍下限 −4
    expect(dtcDelayFs(3, q)).toBeCloseTo(3 + 0.7, 14)
  })

  it('Endpoint-fit INL / DNL 與 numpy 一致', () => {
    const r = dtcInlDnl({ gainFs: 1.5, offsetFs: 3, c2: 0.002, c3: -0.0001, bits: 6 })
    expect(r.lsbFs).toBeCloseTo(1.2291, 12)
    expect(r.inlFs[20]).toBeCloseTo(5.417999999999999, 11)
    expect(r.maxAbsInlLsb).toBeCloseTo(6.261492148726709, 11)
    expect(r.dnlLsb[33]).toBeCloseTo(0.0683426897730035, 12)
    expect(r.inlFs[0]).toBe(0)
    expect(r.inlFs[63]).toBeCloseTo(0, 12)
  })

  it('blockLms 用的正規化非線性：offset + c2·x² + c3·x³', () => {
    expect(dtcNonlinearityFs(2, { offset_fs: 0.5, c2: 0.25, c3: 0.1 })).toBeCloseTo(0.5 + 1 + 0.8, 14)
    expect(dtcNonlinearityFs(-2, { offset_fs: 0, c2: 0, c3: 0.1 })).toBeCloseTo(-0.8, 14)
  })
})

describe('DTC 範圍、LSB、量化抖動、飽和與 T_0 預算（Ch04 §5b）', () => {
  it('T_0 預算：R = T_vco(1 + ε) + INL + 2·headroom、T_0 = headroom + INL + 最大補償量；Δ = R/(2^B − 1)、σ_q = Δ/√12', () => {
    const b = dtcRangeBudget({ tVcoFs: 62500, calRangeFrac: 0.2, inlPeakFs: 500, headroomFrac: 0.05, bits: 10 })
    expect(b.maxCompFs).toBeCloseTo(75000, 9)
    expect(b.rangeFs).toBeCloseTo(75000 + 500 + 2 * 3125, 9)
    expect(b.t0Fs).toBeCloseTo(3125 + 500 + 75000, 9)
    expect(b.lsbFs).toBeCloseTo(b.rangeFs / 1023, 9)
    expect(b.jitterRmsFs).toBeCloseTo(b.lsbFs / Math.sqrt(12), 12)
    expect(b.codes).toBe(1024)
    // 補償量為 0 時 τ = T_0 在範圍內（上面留 headroom），為最大時 τ = T_0 − maxComp = headroom + INL ≥ 0
    expect(b.t0Fs).toBeLessThanOrEqual(b.rangeFs)
    expect(b.rangeFs - b.t0Fs).toBeCloseTo(3125, 9)
    expect(b.t0Fs - b.maxCompFs).toBeCloseTo(3625, 9)
    // 預設值：ε = 0.2、INL = 0、headroom 5%；沒給 bits 時 Δ、σ_q 為 NaN
    const d = dtcRangeBudget({ tVcoFs: 1000 })
    expect(d.rangeFs).toBeCloseTo(1200 + 100, 9)
    expect(Number.isNaN(d.lsbFs)).toBe(true)
    expect(dtcLsbFs(1023, 10)).toBeCloseTo(1, 12)
    expect(() => dtcLsbFs(1000, 0)).toThrow()
    expect(dtcBitsFor(81750, 100)).toBe(10) // 2^10 − 1 = 1023 ≥ 817.5
    expect(dtcBitsFor(81750, 50)).toBe(11)
    expect(dtcBitsFor(1023, 1)).toBe(10)
    expect(dtcBitsFor(1024, 1)).toBe(11)
  })

  it('量化抖動進入 e[n]：σ_v,eff² = σ_v² + Δ²/12，K_q 縮小 σ_v/σ_v,eff；Monte Carlo 的量化誤差 RMS 與 Δ/√12 一致（4 位有效數字）', () => {
    expect(dtcQuantizationJitterRms(Math.sqrt(12))).toBeCloseTo(1, 12)
    expect(dtcEffectiveSigmaV(100, 80)).toBeCloseTo(Math.sqrt(100 * 100 + (80 * 80) / 12), 12)
    expect(dtcKqRatio(100, 80)).toBeCloseTo(100 / Math.sqrt(10000 + 6400 / 12), 12)
    expect(dtcKqRatio(100, 0)).toBe(1)
    const rng = createRng(20261019)
    const xs = rng.uniformArray(200_000)
    const lsb = 80
    const st = dtcCompensationStats(xs, { w: 62500, t0Fs: 78625, lsbFs: lsb, bits: 10 })
    expect(st.saturatedFraction).toBe(0)
    expect(Math.abs(st.errorRmsFs / (lsb / Math.sqrt(12)) - 1)).toBeLessThan(0.01)
    expect(Math.abs(st.errorMeanFs)).toBeLessThan(0.3) // nearest：平均 0（±0.5 LSB 均勻）
    const tr = dtcCompensationStats(xs, { w: 62500, t0Fs: 78625, lsbFs: lsb, bits: 10, rounding: 'truncate' })
    expect(tr.errorMeanFs).toBeCloseTo(-lsb / 2, 0) // truncate：平均 −Δ/2
  })

  it('飽和：code 夾在 [0, 2^B − 1] 時 ∂e/∂w = 0（sign-LMS 沒有梯度可跟），沒飽和時 ∂e/∂w = −x；量化誤差含夾住的部分', () => {
    const base = { t0Fs: 78625, lsbFs: 80, bits: 10 }
    const ok = dtcCompensation({ ...base, w: 62500, x: 0.5 })
    expect(ok.saturated).toBe(false)
    expect(ok.dEdw).toBe(-0.5)
    expect(ok.wantFs).toBeCloseTo(78625 - 31250, 9)
    expect(Math.abs(ok.errorFs)).toBeLessThanOrEqual(40 + 1e-9)
    expect(ok.delayFs).toBeCloseTo(ok.code * 80, 9)
    // 補償量超過 T_0：想要的延遲變負 → 夾在 code 0
    const sat = dtcCompensation({ ...base, w: 90000, x: 0.95 })
    expect(sat.saturated).toBe(true)
    expect(sat.code).toBe(0)
    expect(sat.dEdw).toBe(0)
    expect(sat.errorFs).toBeCloseTo(0 - (78625 - 90000 * 0.95), 9) // 夾住的部分 = 85500 − 78625 = 6875 fs
    // 補償量為負（w < 0）：想要的延遲超過最大 code
    const top = dtcCompensation({ ...base, w: -10000, x: 0.9 })
    expect(top.saturated).toBe(true)
    expect(top.code).toBe(1023)
    expect(top.dEdw).toBe(0)
    // 飽和比例：w 比預算大 50% 時約有一部分的 x 飽和
    const rng = createRng(7)
    const xs = rng.uniformArray(100_000)
    const st = dtcCompensationStats(xs, { ...base, w: 1.5 * 62500 })
    expect(st.saturatedFraction).toBeGreaterThan(0.1)
    expect(st.saturatedFraction).toBeLessThan(0.3)
    expect(st.saturatedFraction).toBeCloseTo(1 - 78625 / (1.5 * 62500), 2) // x > T_0/w 才飽和（均勻 x）
  })
})
