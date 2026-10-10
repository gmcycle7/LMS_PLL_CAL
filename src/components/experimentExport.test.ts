import { APP_VERSION, GIT_COMMIT } from './buildInfo'
import { buildExperimentPayload, buildExperimentReportInput, normalizeCrossCheck, type ExperimentExportInput } from './experimentExport'
import { buildReportHtml } from './report'

// 參考值以 Python 獨立計算：scipy.stats.norm.cdf(0.01) = 0.5039893563146316，2Φ−1 = 0.007978712629263196
const input: ExperimentExportInput = {
  id: 'one-bit-comparator',
  title: '1-bit Comparator Lab',
  level: 'L1',
  claim: 'approx',
  tests: ['T04'],
  assumptions: ['gaussian iid noise', 'fixed scalar error'],
  params: { signal_fs: 1, noise_rms_fs: 100, samples: 10000, trace: new Float64Array([1, 2]) },
  seed: 20261010,
  units: { signal_fs: 'fs', noise_rms_fs: 'fs' },
  metrics: [
    { name: 'p_positive', value: 0.503989, analytic: 0.5039893563146316, tolerance: 1e-6 },
    { name: 'mean_q', value: 0.007979, analytic: 0.007978712629263196 },
    { name: 'kappa', value: NaN },
  ],
  warnings: ['C ≤ 0：polarity 錯誤，LMS 會發散'],
}

describe('buildExperimentPayload', () => {
  const now = new Date('2026-10-10T01:02:03.004Z')
  const p = buildExperimentPayload(input, now)

  it('包含 seed、版本、commit、假設、ISO 時間戳記、模型層級與實驗 ID', () => {
    expect(p.seed).toBe(20261010)
    expect(p.app_version).toBe(APP_VERSION)
    expect(p.git_commit).toBe(GIT_COMMIT)
    expect(p.app_version).not.toBe('')
    expect(p.assumptions).toEqual(['gaussian iid noise', 'fixed scalar error'])
    expect(p.generated_at).toBe('2026-10-10T01:02:03.004Z')
    expect(p.model_level).toBe('L1')
    expect(p.experiment_id).toBe('one-bit-comparator')
    expect(p.units).toEqual({ signal_fs: 'fs', noise_rms_fs: 'fs' })
    expect(p.warnings).toEqual(['C ≤ 0：polarity 錯誤，LMS 會發散'])
    expect(p.status).toBe('warning')
    expect(p.claim).toBe('approx')
    expect(p.source).toBe('illustrative')
  })

  it('參數與指標可 JSON 往返，NaN 以字串保存、typed array 轉為陣列', () => {
    const round = JSON.parse(JSON.stringify(p))
    expect(round.input_parameters).toEqual({ signal_fs: 1, noise_rms_fs: 100, samples: 10000, trace: [1, 2] })
    expect(round.metrics).toEqual({ p_positive: 0.503989, mean_q: 0.007979, kappa: 'NaN' })
    expect(round.metric_details[0]).toMatchObject({ name: 'p_positive', pass: true, tolerance: 1e-6 })
    // python: 0.503989 - norm.cdf(0.01) = -3.5631463157770327e-07
    expect(round.metric_details[0].delta).toBeCloseTo(-3.5631463157770327e-7, 18)
  })

  it('未提供 crossCheck 時三項皆為 not-implemented（不得隱藏）', () => {
    expect(p.cross_check).toEqual({
      analytic: { status: 'not-implemented' },
      monteCarlo: { status: 'not-implemented' },
      fixedPoint: { status: 'not-implemented' },
    })
    expect(normalizeCrossCheck({ analytic: 'ok', monteCarlo: { status: 'mismatch', note: '3σ' }, fixedPoint: 'n/a' })).toEqual({
      analytic: { status: 'ok' },
      monteCarlo: { status: 'mismatch', note: '3σ' },
      fixedPoint: { status: 'n/a' },
    })
  })

  it('測試狀態取自 verification-status.json；沒有警告時 status = success', () => {
    const q = buildExperimentPayload({ ...input, warnings: [] }, now)
    expect(q.status).toBe('success')
    expect(q.tests).toEqual([{ id: 'T04', status: expect.stringMatching(/^(pass|partial|fail|missing)$/) }])
  })
})

describe('buildExperimentReportInput → buildReportHtml', () => {
  it('報告包含參數、指標、假設、警告與資料預覽', () => {
    const ri = buildExperimentReportInput(input, {
      now: new Date('2026-10-10T00:00:00Z'),
      data: { n: [0, 1, 2], w: [1, 1.8] },
    })
    expect(ri.claim).toBe('近似｜需驗證')
    expect(ri.modelLevelDescription).toBe('Block GMAC + Gaussian Comparator')
    expect(ri.params.find((r) => r.name === 'noise_rms_fs')).toEqual({ name: 'noise_rms_fs', value: '100', unit: 'fs' })
    expect(ri.crossCheck?.map((c) => c.status)).toEqual(['Not implemented', 'Not implemented', 'Not implemented'])
    expect(ri.dataPreview?.rows).toEqual([
      ['0', '1'],
      ['1', '1.8'],
      ['2', ''],
    ])
    const html = buildReportHtml(ri)
    expect(html).toContain('1-bit Comparator Lab')
    expect(html).toContain('gaussian iid noise')
    expect(html).toContain('C ≤ 0：polarity 錯誤，LMS 會發散')
    expect(html).toContain('20261010')
    expect(html).toContain('✓ 在容許誤差內')
  })
})
