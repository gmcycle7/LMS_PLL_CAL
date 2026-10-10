import { describe, expect, it } from 'vitest'
import { xcorr, xcorrAtLag } from '@/simulation/signal/corr'
import { lcg, relErr } from '@/simulation/signal/testSignals'

// x = lcg(300, 7) − 0.5；y[n] = 0.8·x[n − 5]（n ≥ 5）+ 0.3·(lcg(280, 99) − 0.5)：y 比 x 延遲 5 個 sample
const u1 = lcg(300, 7).map((v) => v - 0.5)
const u2 = lcg(280, 99).map((v) => v - 0.5)
const y = new Float64Array(280)
for (let n = 0; n < 280; n++) y[n] = (n >= 5 ? 0.8 * u1[n - 5] : 0) + 0.3 * u2[n]

// 參考值：numpy.correlate(y, x, 'full')（S[ℓ] = Σ_m x[m] y[m+ℓ]），再除以有效樣本數
const REF: [lag: number, sum: number, mean: number, count: number][] = [
  [-10, -1.7007394808084508, -0.006074069574315896, 280],
  [-1, 0.9114741588397557, 0.0032552648529991274, 280],
  [0, -1.6012579386907422, -0.005718778352466937, 280],
  [4, -2.3090093771095668, -0.00836597600402017, 276],
  [5, 18.834892552026275, 0.06849051837100464, 275],
  [6, -1.7394641493759997, -0.006348409304291969, 274],
  [279, 0.05424994846546783, 0.05424994846546783, 1],
  [-299, 0.02084477913607488, 0.02084477913607488, 1],
]

describe('xcorrAtLag：R[ℓ] = mean_n x[n−ℓ]·y[n]', () => {
  it('vs numpy.correlate（mean 與 sum 正規化）', () => {
    for (const [lag, sum, mean] of REF) {
      expect(relErr(xcorrAtLag(u1, y, lag), mean), `lag ${lag}`).toBeLessThan(1e-12)
      expect(relErr(xcorrAtLag(u1, y, lag, 'sum'), sum), `lag ${lag}`).toBeLessThan(1e-12)
    }
  })

  it('lag 正負：y 延遲 d 個 sample → 峰值在 ℓ = +d', () => {
    const r = xcorr(u1, y, 20)
    let best = 0
    for (let i = 1; i < r.values.length; i++) if (r.values[i] > r.values[best]) best = i
    expect(r.lags[best]).toBe(5)
    // 理論峰值 ≈ 0.8·E{x²} = 0.8/12（統計誤差）
    expect(r.values[best]).toBeGreaterThan(0.8 / 12 - 0.015)
    expect(r.values[best]).toBeLessThan(0.8 / 12 + 0.015)
  })

  it('沒有重疊樣本時回傳 NaN；非整數 lag 丟出錯誤', () => {
    expect(xcorrAtLag(u1, y, 280)).toBeNaN()
    expect(xcorrAtLag(u1, y, -300)).toBeNaN()
    expect(() => xcorrAtLag(u1, y, 0.5)).toThrow()
  })
})

describe('xcorr', () => {
  it('lags、counts 與逐點 xcorrAtLag 一致', () => {
    const r = xcorr(u1, y, 12)
    expect(r.lags.length).toBe(25)
    expect(r.lags[0]).toBe(-12)
    expect(r.lags[24]).toBe(12)
    for (let i = 0; i < 25; i++) {
      expect(r.values[i]).toBe(xcorrAtLag(u1, y, r.lags[i]))
    }
    const c5 = REF.find((t) => t[0] === 5)
    expect(r.counts[12 + 5]).toBe(c5?.[3])
  })

  it("method='fft' 與 'direct' 一致（含邊界 lag 與無重疊 lag）", () => {
    const maxLag = 310
    const d = xcorr(u1, y, maxLag, { method: 'direct' })
    const f = xcorr(u1, y, maxLag, { method: 'fft' })
    let scale = 0
    for (const v of d.values) if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v))
    for (let i = 0; i < d.values.length; i++) {
      if (Number.isNaN(d.values[i])) {
        expect(f.values[i]).toBeNaN()
      } else {
        expect(Math.abs(f.values[i] - d.values[i])).toBeLessThan(1e-12 * scale * 300)
      }
    }
    for (const [lag, , mean] of REF) {
      expect(Math.abs(f.values[lag + maxLag] - mean)).toBeLessThan(1e-12)
    }
    const fs = xcorr(u1, y, 10, { method: 'fft', normalization: 'sum' })
    expect(relErr(fs.values[10 + 5], 18.834892552026275)).toBeLessThan(1e-12)
  })

  it('maxLag 必須為非負整數', () => {
    expect(() => xcorr(u1, y, -1)).toThrow()
    expect(xcorr(u1, y, 0).values.length).toBe(1)
  })
})
