import { evaluateThesis, DEFAULT_PARAMS } from './thesisModel'
import { THESIS_PRESETS, presetParams, sanitizeParams } from './presets'

describe('六條件體檢 presets', () => {
  it('每個 preset 失敗的條件恰好是 expectFail（同一計算核心）', () => {
    for (const p of THESIS_PRESETS) {
      const r = evaluateThesis(presetParams(p))
      const failed = r.checks.filter((c) => c.state === 'fail').map((c) => c.id).sort()
      expect(failed, p.id).toEqual([...(p.expectFail ?? [])].sort())
      // 每個失敗都要有說明原因
      for (const c of r.checks) if (c.state !== 'ok') expect(c.reason.length, `${p.id}/${c.id}`).toBeGreaterThan(10)
    }
  })

  it('preset 說明文字中引用的數字都能由模型重算出來', () => {
    const ev = (id: string) => {
      const p = THESIS_PRESETS.find((x) => x.id === id)
      expect(p, id).toBeDefined()
      return evaluateThesis(presetParams(p!))
    }
    const t13 = ev('thesis-t13')
    expect(t13.maxRadius).toBeCloseTo(0.92021, 5)
    expect(t13.sigmaW).toBeCloseTo(0.399, 3)
    const sum = ev('thesis-sum-mode')
    expect(sum.g).toBeCloseTo(326.8, 1)
    expect(1 - sum.g).toBeCloseTo(-325.8, 1)
    const lat = ev('thesis-latency')
    expect(lat.g).toBeCloseTo(0.798, 3)
    expect(lat.gStar).toBeCloseTo(0.618, 3)
    const smallC = ev('thesis-small-c')
    expect(smallC.polarity.C).toBeCloseTo(0.087, 3)
    expect(smallC.deltaW).toBeCloseTo(1.15, 2)
    const spur = ev('thesis-spur-t15')
    expect(spur.deltaW).toBeCloseTo(0.5, 12)
    expect(spur.spurDbc).toBeCloseTo(-93.8, 1)
    const rho = ev('thesis-rho099')
    expect(rho.lamMin).toBeCloseTo(0.01, 12)
    expect(rho.kappa).toBeCloseTo(199, 6)
    const d4 = ev('thesis-delay-fix')
    expect(d4.polarity.thetaDeg).toBeCloseTo(0, 10)
    // 「B = 1.5 fs：GMAC 歸零，gain 卻偏了 1.5 fs」：極性、穩定、σ_w 都過關，只有固定點錯了
    const bias = ev('thesis-bias-only')
    expect(bias.deltaW).toBeCloseTo(1.5, 12)
    expect(bias.sigmaW).toBeCloseTo(t13.sigmaW, 12)
    expect(bias.maxRadius).toBeCloseTo(t13.maxRadius, 12)
  })

  it('preset id 唯一', () => {
    const ids = THESIS_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preconditioner 例：δt 看起來沒事，但係數雜訊被放大（說明文字要點出來）', () => {
    const p = THESIS_PRESETS.find((x) => x.id === 'thesis-rho099-precond')
    expect(p).toBeDefined()
    const r = evaluateThesis(presetParams(p!))
    expect(r.checks.find((c) => c.id === 'variance')?.reason).toMatch(/弱方向/)
    expect(r.checks.find((c) => c.id === 'system')?.state).toBe('ok')
  })

  it('sanitizeParams：只保留型別正確且在合法範圍內的欄位（反面測試）', () => {
    expect(sanitizeParams(null)).toEqual({})
    expect(sanitizeParams({ mu: '10', sigmaV: -5, N: 1e9, gmacMode: 'avg', twoParam: 'yes', foo: 1 })).toEqual({})
    expect(sanitizeParams({ mu: 20, N: 1024.4, gmacMode: 'sum', update: 'precond', twoParam: true, rho: -0.5 })).toEqual({
      mu: 20,
      N: 1024,
      gmacMode: 'sum',
      update: 'precond',
      twoParam: true,
      rho: -0.5,
    })
    expect(sanitizeParams({ phiDeg: Number.NaN, D: 3.7 })).toEqual({ D: 4 })
    expect(Object.keys(sanitizeParams(DEFAULT_PARAMS)).sort()).toEqual(Object.keys(DEFAULT_PARAMS).sort())
  })
})
