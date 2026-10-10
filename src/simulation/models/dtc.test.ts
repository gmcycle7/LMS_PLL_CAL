import { describe, expect, it } from 'vitest'
import {
  dtcCodeRange,
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
