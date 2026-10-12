import { firstOrderPeriod, runDsm } from '@/simulation/models/dsm'
import { firstOrderAccumulator, residueSignals } from './residue'

describe('Ch04 §2：一階累加器與 fractional residue', () => {
  it('手算表（K_F = 5、4-bit）：telescoping 恆等式逐列成立、16 拍一個週期、5 次 carry', () => {
    const rows = firstOrderAccumulator(5, 4, 16)
    rows.forEach((r) => {
      expect(r.cumErr).toBeCloseTo(r.residue, 12)
      expect(r.residue).toBeLessThanOrEqual(0)
      expect(r.residue).toBeGreaterThan(-1)
      expect(r.t).toBe(r.sPrev + 5)
    })
    expect(rows.map((r) => r.s).slice(0, 4)).toEqual([5, 10, 15, 4])
    expect(rows.filter((r) => r.y === 1)).toHaveLength(5)
    expect(rows[15].s).toBe(0)
    expect(firstOrderPeriod(5, 4)).toBe(16)
  })

  it('與 dsm.ts（runDsm）逐點相同：y 與 residue（多組 frac / bits）', () => {
    for (const [frac, bits] of [
      [0.3125, 4],
      [0.3, 8],
      [0.123456, 12],
      [0.999, 10],
      [0, 6],
    ] as const) {
      const d = runDsm({ kind: 'first_order', frac, bits, length: 300 })
      const rows = firstOrderAccumulator(d.K, bits, 300)
      rows.forEach((r, i) => {
        expect(r.y).toBe(d.y[i])
        expect(r.residue).toBeCloseTo(d.residue[i], 12)
      })
    }
  })

  it('思考題 4：K_F = 3、3-bit ⇒ s = 3, 6, 1, 4，r[3] = −0.5', () => {
    const rows = firstOrderAccumulator(3, 3, 4)
    expect(rows.map((r) => r.s)).toEqual([3, 6, 1, 4])
    expect(rows[3].residue).toBe(-0.5)
  })

  it('residueSignals：需要的補償量（reference 端的 DTC 要把 reference edge 提前的時間）= −r·T_vco ∈ [0, T_vco)，殘差 = ε × 需要的補償量', () => {
    const s = residueSignals({ kind: 'first_order', frac: 0.3125, bits: 4, length: 64, gainErrPct: 1, fvcoGHz: 13 })
    expect(s.tvcoFs).toBeCloseTo(76923.0769, 3)
    for (let i = 0; i < 64; i++) {
      expect(s.dtcNeedFs[i]).toBeGreaterThanOrEqual(0)
      expect(s.dtcNeedFs[i]).toBeLessThan(s.tvcoFs)
      expect(s.residualFs[i]).toBeCloseTo(0.01 * s.dtcNeedFs[i], 9)
    }
    expect(s.period).toBe(16)
    const m = residueSignals({ kind: 'mash111', frac: 0.3, bits: 12, length: 512, gainErrPct: 1, fvcoGHz: 13 })
    for (const v of m.edgeErrFs) expect(Math.abs(v)).toBeLessThan(2 * m.tvcoFs)
  })
})
