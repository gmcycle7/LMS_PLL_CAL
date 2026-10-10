import { evaluateMetric, formatMetricValue, metricToJson } from './metrics'

// 參考值以 Python 獨立計算：scipy.stats.norm.cdf(0.01) = 0.5039893563146316
// （規格 §20.3：1 fs error、100 fs RMS Gaussian noise 下 P(q = +1) = Φ(1/100)）
const PHI_001 = 0.5039893563146316

describe('evaluateMetric', () => {
  it('Δ = value − analytic，相對差以 |analytic| 正規化', () => {
    const ev = evaluateMetric({ name: 'p_positive', value: 0.503989, analytic: PHI_001 })
    // python: 0.503989 - norm.cdf(0.01) = -3.5631463157770327e-07
    expect(ev.delta).toBeCloseTo(-3.5631463157770327e-7, 18)
    expect(ev.relDelta).toBeCloseTo(-3.5631463157770327e-7 / PHI_001, 15)
    expect(ev.pass).toBeUndefined()
  })

  it('絕對容許誤差', () => {
    expect(evaluateMetric({ name: 'p', value: 0.503989, analytic: PHI_001, tolerance: 1e-6 }).pass).toBe(true)
    expect(evaluateMetric({ name: 'p', value: 0.503989, analytic: PHI_001, tolerance: 1e-7 }).pass).toBe(false)
  })

  it('相對容許誤差', () => {
    const row = { name: 'gain', value: 1.0105, analytic: 1.0, toleranceMode: 'rel' as const }
    expect(evaluateMetric({ ...row, tolerance: 0.011 }).pass).toBe(true)
    expect(evaluateMetric({ ...row, tolerance: 0.01 }).pass).toBe(false)
  })

  it('NaN / ∞ 一律不通過；字串數值有 tolerance 時不通過', () => {
    expect(evaluateMetric({ name: 'x', value: NaN, analytic: 1, tolerance: 1 }).pass).toBe(false)
    expect(evaluateMetric({ name: 'x', value: Infinity, analytic: 1, tolerance: 1e300 }).pass).toBe(false)
    expect(evaluateMetric({ name: 'x', value: 'Not implemented', analytic: 1, tolerance: 1 }).pass).toBe(false)
  })

  it('沒有 analytic 時不計算 Δ', () => {
    expect(evaluateMetric({ name: 'x', value: 2 })).toEqual({})
  })
})

describe('formatMetricValue / metricToJson', () => {
  it('格式化', () => {
    expect(formatMetricValue(null)).toBe('—')
    expect(formatMetricValue('n/a')).toBe('n/a')
    expect(formatMetricValue(PHI_001, 6)).toBe('0.503989')
  })
  it('JSON 欄位', () => {
    const j = metricToJson({ name: 'p', value: 0.5, analytic: 0.5, tolerance: 0, formulaId: 'F-5.1', unit: '—' })
    expect(j).toMatchObject({ name: 'p', value: 0.5, analytic: 0.5, delta: 0, pass: true, formula_id: 'F-5.1', tolerance_mode: 'abs' })
  })
})
