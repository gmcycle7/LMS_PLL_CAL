import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import katex from 'katex'
import { ALL_PRESETS } from '@/app/presets'
import type { PresetEntry } from '@/data/types'
import { checkExpected, perturbMetrics } from './consistency'
import { GALLERY_EXPECTED_KEYS, GALLERY_SLOTS, PREVIEWABLE_EXPERIMENTS } from './data'
import { hasPreviewer, PREVIEWER_IDS, previewPreset, tonePeriod, type PreviewResult } from './previews'

interface GoldenVector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function golden(id: string): GoldenVector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${id}.json`), 'utf8')) as GoldenVector
}
/** golden 的容差規則：|actual − expected| ≤ abs + rel·|expected|（key 有 override 時用 override） */
function expectGolden(v: GoldenVector, key: string, actual: number, index?: number) {
  const raw = v.expected[key]
  const exp = index === undefined ? (raw as number) : (raw as number[])[index]
  const t = v.tolerance_overrides?.[key] ?? v.tolerance
  const lim = (t.abs ?? 0) + (t.rel ?? 0) * Math.abs(exp)
  expect(Math.abs(actual - exp), `${key}${index === undefined ? '' : `[${index}]`}: actual ${actual}, expected ${exp}, tol ${lim}`).toBeLessThanOrEqual(lim)
}

const mk = (experiment: string, params: Record<string, unknown>, over: Partial<PresetEntry> = {}): PresetEntry => ({
  id: 'test-preset',
  title: 't',
  page: '/gallery',
  experiment,
  description: '',
  params,
  expected: '',
  source: 'illustrative',
  ...over,
})
function run(p: PresetEntry): PreviewResult {
  const o = previewPreset(p)
  if (o.status !== 'ok') throw new Error(`${p.id}: 預覽狀態 ${o.status}：${o.status === 'error' ? o.message : o.reason}`)
  return o.result
}
function slot(index: number): PresetEntry {
  const p = ALL_PRESETS.find((x) => x.galleryIndex === index)
  if (!p) throw new Error(`缺少 galleryIndex = ${index} 的 preset`)
  return p
}
function val(r: PreviewResult, key: string): number {
  const m = r.metrics.find((x) => x.key === key)
  if (!m) throw new Error(`預覽沒有 metric '${key}'（有：${r.metrics.map((x) => x.key).join(', ')}）`)
  if (typeof m.value !== 'number') throw new Error(`metric '${key}' 不是數字：${m.value}`)
  return m.value
}
const verdictText = (r: PreviewResult) => r.verdicts.map((v) => `${v.kind}:${v.text}`).join('\n')

describe('Gallery 預覽 vs golden vectors（T01–T18；每個數字都由真實模型函式算出）', () => {
  it('T01: #1 手算例 w₁ = 1.8、w₂ = 2.28、pole 0.6', () => {
    const g = golden('T01')
    const r = run(slot(1))
    expectGolden(g, 'w1', val(r, 'w1'))
    expectGolden(g, 'w2', val(r, 'w2'))
    expectGolden(g, 'pole', val(r, 'pole'))
    // 圖上的軌跡就是 runScalarLms 的 w_n
    const trace = g.expected.w_trace as number[]
    const y = r.chart?.series[0].y ?? []
    for (let i = 0; i < trace.length; i++) expect(y[i]).toBeCloseTo(trace[i], 12)
  })

  it('T02: 固定 x = 2 的穩定範圍 0 < μ < 0.5；邊界與超過邊界的判定', () => {
    const g = golden('T02')
    const base = slot(1).params
    expectGolden(g, 'mu_max', val(run(slot(1)), 'muMax'))
    const mus = [0.1, 0.25, 0.4, 0.49, 0.5, 0.51, -0.01]
    mus.forEach((mu, i) => expectGolden(g, 'pole_list', val(run(mk('lms-playground', { ...base, mu })), 'pole'), i))
    expect(verdictText(run(mk('lms-playground', { ...base, mu: 0.4 })))).toMatch(/^ok:/)
    expect(verdictText(run(mk('lms-playground', { ...base, mu: 0.5 })))).toMatch(/^warn:.*穩定邊界/)
    expect(verdictText(run(mk('lms-playground', { ...base, mu: 0.51 })))).toMatch(/^danger:.*超過/)
    expect(verdictText(run(mk('lms-playground', { ...base, mu: -0.01 })))).toMatch(/^danger:.*更新極性錯誤/)
  })

  it('T04: #2 的 P(q=+1) ≈ 0.503989、K_q ≈ 0.00797885 fs⁻¹', () => {
    const g = golden('T04')
    const r = run(slot(2))
    expectGolden(g, 'p_plus', val(r, 'pPlus'))
    expectGolden(g, 'mean_q', val(r, 'meanQ'))
    expectGolden(g, 'kq_per_fs', val(r, 'Kq'))
  })

  it('T05: 方向判斷成功率——奇數 N、tie 平分、嚴格三種算法與 95% 門檻（勘誤 E02）', () => {
    const g = golden('T05')
    const base = slot(2).params
    const r = run(slot(2)) // N = 10001（奇數）
    expectGolden(g, 'p_exact_odd_Nplus1_list', val(r, 'pCorrect'), 2)
    expectGolden(g, 'N_exact_odd_95', val(r, 'n95Odd'))
    expect(val(r, 'n95Clt')).toBeCloseTo(g.expected.N_clt_95 as number, 5)
    const Ns = g.inputs.N_list as number[]
    Ns.forEach((N, i) => {
      const half = run(mk('comparator-lab', { ...base, N, tieRule: 'half' }))
      expectGolden(g, 'p_exact_split_list', val(half, 'pCorrect'), i)
      expectGolden(g, 'p_clt_list', val(half, 'pClt'), i)
      const strict = run(mk('comparator-lab', { ...base, N, tieRule: 'strict' }))
      expectGolden(g, 'p_exact_strict_list', val(strict, 'pCorrect'), i)
    })
    // 反面：偶數 N + 嚴格 tie 規則 ⇒ 預覽要發出勘誤 E02 的警告
    expect(verdictText(run(mk('comparator-lab', { ...base, N: 100, tieRule: 'strict' })))).toContain('勘誤 E02')
  })

  it('T06: #3 原始相關器 φ = 120° ⇒ C < 0、pole > 1，並明講是極性問題', () => {
    const g = golden('T06')
    const r = run(slot(3))
    expectGolden(g, 'C', val(r, 'C'))
    expectGolden(g, 'pole', val(r, 'pole'))
    expect(val(r, 'C')).toBeLessThan(0)
    expect(val(r, 'pole')).toBeGreaterThan(1)
    expect(verdictText(r)).toContain('danger:C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散')
    const phis = [0, 60, 90, 120, 180]
    phis.forEach((phiDeg, i) => expectGolden(g, 'C_at_phi_list_deg', val(run(mk('polarity-explorer', { ...slot(3).params, phiDeg })), 'C'), i))
  })

  it('T07: φ = −120°、Ω = π/6、D = 4 ⇒ 殘餘相位 0°、C_D 為正最大；D = 0…11 的 C_D 全部相符', () => {
    const g = golden('T07')
    const inp = g.inputs as { A: number; H_mag: number; phi_deg: number; Omega_rad: number; D: number }
    const r = run(mk('polarity-explorer', { mode: 'tone', A: inp.A, mag: inp.H_mag, phiDeg: inp.phi_deg, omega: inp.Omega_rad, D: inp.D, mu: 10, sigmaV: 100, regressor: 'x' }))
    expectGolden(g, 'C_D', val(r, 'C'))
    expect(val(r, 'theta')).toBeCloseTo(g.expected.theta_deg as number, 9)
    expect(val(r, 'margin')).toBeCloseTo(g.expected.polarity_margin_deg as number, 9)
    const list = g.expected.C_D_list as number[]
    const y = r.chart?.series[0].y ?? []
    list.forEach((c, D) => expect(y[D]).toBeCloseTo(c, 12))
    expect(y.indexOf(Math.max(...y.slice(0, 12)))).toBe(g.expected.best_D)
    // #4 的 Lab 把 code 正規化成單位功率（A²/2 = 1），所以是 golden（A = 1）的 2 倍
    const lab = run(slot(4))
    expect(val(lab, 'C:A')).toBeCloseTo(2 * list[0], 12)
    expect(val(lab, 'C:B')).toBeCloseTo(2 * (g.expected.C_D as number), 12)
    expect(val(lab, 'pole:A')).toBeGreaterThan(1)
    expect(val(lab, 'pole:B')).toBeLessThan(1)
  })

  it('T08: g = 1、無延遲一階模型 ⇒ pole 0、PM 60°', () => {
    const g = golden('T08')
    const r = run(mk('pm-lab', { g: 1, d: 0, steps: 20 }))
    expectGolden(g, 'pole', val(r, 'pole'))
    expectGolden(g, 'pm_deg', val(r, 'pm'))
    expectGolden(g, 'crossover_omega_rad', val(r, 'omegaC'))
    const gs = g.inputs.g_list as number[]
    gs.forEach((gg, i) => {
      const rr = run(mk('pm-lab', { g: gg, d: 0, steps: 20 }))
      expectGolden(g, 'pole_list', val(rr, 'pole'), i)
      expectGolden(g, 'pm_deg_list', val(rr, 'pm'), i)
    })
    // g = 2 是臨界：不可標成穩定
    expect(verdictText(run(mk('pm-lab', { g: 2, d: 0, steps: 20 })))).toMatch(/^warn:.*marginal/)
  })

  it('T09: #5 雙迴路 r = 0.8、b = 0.2、c = 1、μ = 1.2 ⇒ |z| ≈ 1.0198 > 1，quasi-static 卻預測穩定（勘誤 E19）', () => {
    const g = golden('T09')
    const r = run(slot(5))
    expectGolden(g, 'pole_re', val(r, 'poleRe'))
    expectGolden(g, 'pole_im', val(r, 'poleIm'))
    expectGolden(g, 'pole_abs', val(r, 'rho'))
    expectGolden(g, 'mu_max_full', val(r, 'muFullHi'))
    expectGolden(g, 'mu_max_simplified', val(r, 'muQsHi'))
    expectGolden(g, 'simplified_pole_at_mu', val(r, 'simplifiedPole'))
    expect(Math.abs(val(r, 'simplifiedPole'))).toBeLessThan(1)
    expect(verdictText(r)).toMatch(/danger:.*quasi-static.*穩定.*勘誤 E19/)
  })

  it('T10: #6 的 R = [[1, 0.99], [0.99, 1]] ⇒ λ = 1.99、0.01，κ = 199', () => {
    const g = golden('T10')
    const r = run(slot(6))
    expectGolden(g, 'eig_max', val(r, 'lamMax'))
    expectGolden(g, 'eig_min', val(r, 'lamMin'))
    expectGolden(g, 'cond', val(r, 'kappa'))
    // 反面：ρ = 1（完全缺乏 PE）⇒ λ = 2、0，並明講不可辨識
    const miss = run(mk('pe-eigen-lab', { ...slot(6).params, rho: 1 }))
    const eig = g.expected.missing_pe_eig_list as number[]
    expect(val(miss, 'lamMax')).toBeCloseTo(eig[0], 12)
    expect(val(miss, 'lamMin')).toBeCloseTo(eig[1], 12)
    expect(verdictText(miss)).toContain('danger:λ_min = 0：不可辨識')
  })

  it('T11: #6 的慢 pole 0.995、95% 衰減 598 blocks（K_q 正規化為 1；勘誤 E05）', () => {
    const g = golden('T11')
    const r = run(slot(6))
    expectGolden(g, 'slow_pole', val(r, 'pSlow'))
    expectGolden(g, 'fast_pole', val(r, 'pFast'))
    expectGolden(g, 'blocks_95', val(r, 'k95Slow'))
    expectGolden(g, 'blocks_95_real', val(r, 'k95SlowReal'))
  })

  it('T12: #7 五值 code、c₃ = 0.1、a = 1 ⇒ MSE-LMS 固定點 1.34；Sign-LMS 隨 σ_v 趨近它（勘誤 E01）', () => {
    const g = golden('T12')
    const r = run(slot(7))
    expectGolden(g, 'Ex2', val(r, 'Ex2'))
    expectGolden(g, 'Ex4', val(r, 'Ex4'))
    expectGolden(g, 'w_star', val(r, 'wMse'))
    const sig = g.inputs.sigma_list as number[]
    const ws = g.expected.sign_lms_w_star_list as number[]
    sig.forEach((sigmaV, i) => expect(val(run(mk('bias-inl-lab', { ...slot(7).params, algorithm: 'sign', sigmaV })), 'wStar')).toBeCloseTo(ws[i], 8))
  })

  it('T13: #8 的 p ≈ 0.92021、σ_w ≈ 0.399 fs；sum 模式忘了 /N 時 g 放大 N 倍', () => {
    const g = golden('T13')
    const r = run(slot(8))
    expectGolden(g, 'K_per_fs', val(r, 'Kq'))
    expectGolden(g, 'g', val(r, 'g'))
    expectGolden(g, 'p', val(r, 'p'))
    expectGolden(g, 'sigma_w_fs', val(r, 'sigmaW'))
    const sum = run(mk('lms-noise-lab', { ...slot(8).params, gmMode: 'sum' }))
    expectGolden(g, 'g_sum_mode', val(sum, 'g'))
    expectGolden(g, 'pole_sum_mode', val(sum, 'p'))
    expect(verdictText(sum)).toMatch(/^danger:.*不穩定/)
  })

  it('T14: #8 的 f_u = 976.5625 kHz；四種「頻寬」各自的值（勘誤 E06、E10、E26）', () => {
    const g = golden('T14')
    const r = run(slot(8))
    expectGolden(g, 'f_u_hz', val(r, 'fu') * 1e3)
    expectGolden(g, 'bw_exact_3db_hz', val(r, 'f3dbExact') * 1e3)
    expectGolden(g, 'bw_neg_ln_p_hz', val(r, 'f3dbNegLnP') * 1e3)
    expectGolden(g, 'bw_one_minus_p_hz', val(r, 'f3dbOneMinusP') * 1e3)
    expectGolden(g, 'enbw_one_sided_hz', val(r, 'enbw') * 1e3)
  })

  it('T15: #9 的 13 GHz、0.5 fs peak ⇒ spur ≈ −93.8 dBc（小角與 Bessel）', () => {
    const g = golden('T15')
    const r = run(slot(9))
    expectGolden(g, 'beta_rad', val(r, 'beta'))
    expectGolden(g, 'spur_dbc', val(r, 'dbcSmall'))
    expectGolden(g, 'spur_dbc_bessel', val(r, 'dbcBessel'))
    const peaks = g.expected.mixing_tone_peak_s as number[]
    expect(val(r, 'tone:90') * 1e-15).toBeCloseTo(peaks[0], 24)
    expect(val(r, 'tone:110') * 1e-15).toBeCloseTo(peaks[1], 24)
  })

  it('T16: #10 的常數 32.4 ⇒ toggle 平均 32.4、週期 5；一階 ΔΣ 是同一個循環的移位（勘誤 E15）', () => {
    const g = golden('T16')
    const r = run(slot(10))
    expectGolden(g, 'mean', val(r, 'mean:toggle'))
    expectGolden(g, 'period', val(r, 'period:toggle'))
    expectGolden(g, 'ef_period', val(r, 'period:deltaSigma'))
    expectGolden(g, 'freeze_error_lsb', val(r, 'dc:freeze'))
    const dft = g.expected.dft_mag_list as number[]
    expect(val(r, 'line1:toggle')).toBeCloseTo(2 * dft[1] ** 2, 12)
    expect(val(r, 'line2:toggle')).toBeCloseTo(2 * dft[2] ** 2, 12)
    expect(val(r, 'line2:toggle')).toBeGreaterThan(val(r, 'line1:toggle')) // 主 tone 在 2f_u/5（勘誤 E47）
    expect(val(r, 'rotation')).toBeGreaterThanOrEqual(0)
    // ΔΣ 的整數輸出序列就是 golden 的 ef_cycle
    const ds = r.chart?.series.find((s) => s.name.includes('ΔΣ') && !s.name.toLowerCase().includes('dither'))
    const cyc = g.expected.ef_cycle as number[]
    expect(ds?.y.slice(0, 5)).toEqual(cyc)
  })

  it('T17: 隨機 32/33、P(33) = 0.4 ⇒ 理論變異 0.24 LSB²；4096 次樣本平均在 4 SE 內', () => {
    const g = golden('T17')
    const r = run(slot(10))
    expectGolden(g, 'variance', val(r, 'bernVar'))
    const n = 4096
    const seMean = Math.sqrt((g.expected.variance as number) / n)
    expect(Math.abs(val(r, 'mean:stochastic') - (g.expected.mean as number))).toBeLessThan(4 * seMean)
    // Bernoulli(0.4) 樣本二階動差的標準誤：√((μ₄ − σ⁴)/n)，μ₄ = p(1−p)(1 − 3p + 3p²)
    const p = 0.4
    const seVar = Math.sqrt((p * (1 - p) * (1 - 3 * p + 3 * p * p) - (p * (1 - p)) ** 2) / n)
    expect(Math.abs(val(r, 'power:stochastic') - (g.expected.variance as number))).toBeLessThan(4 * seVar + 4 * seMean * 0.4)
  })

  it('T18: #12 的 J = [[−1, 2], [2, −1]]、M = 0.2I ⇒ eig(I + MJ) = 1.2、0.4，單一 loop 的 pole 卻是 0.8', () => {
    const g = golden('T18')
    const r = run(slot(12))
    expectGolden(g, 'eig_A_desc', val(r, 'eigA0'), 0)
    expectGolden(g, 'eig_A_desc', val(r, 'eigA1'), 1)
    expectGolden(g, 'eig_J_desc', val(r, 'eigJ0'), 0)
    expectGolden(g, 'eig_J_desc', val(r, 'eigJ1'), 1)
    expectGolden(g, 'single_loop_poles', val(r, 'singlePole'), 0)
    expectGolden(g, 'spectral_radius', val(r, 'rho:A'))
    expect(verdictText(r)).toMatch(/danger:.*一起更新時發散——即使每個 loop 單獨調都穩定/)
  })
})

describe('預覽的涵蓋範圍與誠實性', () => {
  it('PREVIEWERS 與 data.ts 的 PREVIEWABLE_EXPERIMENTS 完全一致', () => {
    expect([...PREVIEWER_IDS].sort()).toEqual([...PREVIEWABLE_EXPERIMENTS].sort())
    for (const e of PREVIEWABLE_EXPERIMENTS) expect(hasPreviewer(e)).toBe(true)
    expect(hasPreviewer('stability-lab')).toBe(false)
  })

  it('沒有預覽函式的實驗 ⇒ unsupported 並說明原因（不猜數字）', () => {
    const o = previewPreset(mk('stability-lab', { mu: 0.5 }))
    expect(o.status).toBe('unsupported')
    expect(o.status === 'unsupported' && o.reason).toContain('載入並執行')
  })

  it('預覽函式不處理的模式 ⇒ unsupported：Polarity Explorer 的 PLL 模式', () => {
    const o = previewPreset(mk('polarity-explorer', { mode: 'pll', loopType: 'typeII' }))
    expect(o.status).toBe('unsupported')
    expect(o.status === 'unsupported' && o.reason).toContain('PLL 模式')
  })

  it('反面測試：看不懂的列舉值絕不悄悄換成預設值 ⇒ unsupported 並指出是哪個參數', () => {
    const a = previewPreset(mk('delay-fx-lab', { scenario: { pathKind: 'single_tone', codeKind: 'brand_new_code' } }))
    expect(a.status).toBe('unsupported')
    expect(a.status === 'unsupported' && a.reason).toContain('codeKind = "brand_new_code"')
    const b = previewPreset(mk('bias-inl-lab', { codeKind: 'pm_full_scale' }))
    expect(b.status).toBe('unsupported')
    const c = previewPreset(mk('comparator-lab', { tieRule: 'coin' }))
    expect(c.status).toBe('unsupported')
    // 沒寫（undefined）才用該實驗的預設值
    expect(previewPreset(mk('comparator-lab', { s: 1, sigma: 100 })).status).toBe('ok')
  })

  it('模型函式丟出的錯誤 ⇒ error，訊息原樣保留並解釋原因（主 PLL 不穩定時相關 C 沒有定義）', () => {
    const o = previewPreset(mk('delay-fx-lab', { scenario: { pathKind: 'type2_dt', wnTs: 0.5, zeta: 0.7, loopDelay: 8, codeKind: 'sinusoid' }, cases: [{ mode: 'raw', D: 0, mu: 10 }] }))
    expect(o.status).toBe('error')
    expect(o.status === 'error' && o.message).toMatch(/不穩定/)
  })

  it('每個可預覽的真實 preset：狀態是 ok 或 unsupported（沒有 error）；metric key 不重複；同 seed 重算結果相同', () => {
    const errors: string[] = []
    let ok = 0
    for (const p of ALL_PRESETS.filter((x) => hasPreviewer(x.experiment))) {
      const o = previewPreset(p)
      if (o.status === 'error') errors.push(`${p.id}: ${o.message}`)
      if (o.status !== 'ok') continue
      ok++
      const keys = o.result.metrics.map((m) => m.key)
      expect(new Set(keys).size, `${p.id} 的 metric key 重複`).toBe(keys.length)
      expect(o.result.experiment).toBe(p.experiment)
      expect(o.result.modelFns.length, p.id).toBeGreaterThan(0)
      expect(o.result.verdicts.length, `${p.id} 沒有判定`).toBeGreaterThan(0)
    }
    expect(errors).toEqual([])
    expect(ok).toBeGreaterThanOrEqual(60)
    // 決定性：有亂數的預覽（gauge、quantizer、mixing）同 seed 重算必須逐值相同
    for (const i of [9, 10, 11]) {
      const a = run(slot(i)).metrics.map((m) => m.value)
      const b = run(slot(i)).metrics.map((m) => m.value)
      expect(b).toEqual(a)
    }
  })

  it('所有預覽輸出的 TeX（標籤、單位、推導、$…$ 片段）都能被 KaTeX 解析', () => {
    const bad: string[] = []
    const tex = (s: string, where: string) => {
      try {
        katex.renderToString(s, { throwOnError: true, strict: 'ignore' })
      } catch (e) {
        bad.push(`${where}: ${s} → ${(e as Error).message}`)
      }
    }
    const rich = (s: string, where: string) => {
      if ((s.match(/\$/g) ?? []).length % 2 !== 0) bad.push(`${where}: $ 不成對：${s}`)
      for (const m of s.matchAll(/\$([^$]+)\$/g)) tex(m[1], where)
    }
    for (const p of ALL_PRESETS.filter((x) => hasPreviewer(x.experiment))) {
      const o = previewPreset(p)
      if (o.status !== 'ok') continue
      const r = o.result
      rich(r.summary, `${p.id} summary`)
      rich(r.stepsTitle, `${p.id} stepsTitle`)
      for (const m of r.metrics) {
        tex(m.label, `${p.id} label ${m.key}`)
        if (m.unit) tex(m.unit, `${p.id} unit ${m.key}`)
        if (m.note) rich(m.note, `${p.id} note ${m.key}`)
        if (typeof m.value === 'string') rich(m.value, `${p.id} value ${m.key}`)
      }
      for (const s of r.steps) {
        tex(s.tex, `${p.id} step`)
        rich(s.why, `${p.id} why`)
      }
      for (const v of r.verdicts) rich(v.text, `${p.id} verdict`)
      for (const n of r.notes) rich(n, `${p.id} note`)
      if (r.chart) rich(r.chart.title, `${p.id} chart title`)
      if (r.table) {
        rich(r.table.caption, `${p.id} table caption`)
        for (const h of r.table.head) rich(h, `${p.id} table head`)
        for (const row of r.table.rows) for (const c of row) if (typeof c === 'string') rich(c, `${p.id} table cell`)
      }
    }
    expect(bad).toEqual([])
  })

  it('圖表資料：每條曲線的 x、y 等長且至少 2 點；y 至少有一個有限值', () => {
    for (const p of ALL_PRESETS.filter((x) => hasPreviewer(x.experiment))) {
      const o = previewPreset(p)
      if (o.status !== 'ok' || !o.result.chart) continue
      for (const s of o.result.chart.series) {
        expect(s.x.length, `${p.id} ${s.name}`).toBe(s.y.length)
        expect(s.x.length, `${p.id} ${s.name}`).toBeGreaterThanOrEqual(2)
        expect(s.y.some((v) => Number.isFinite(v)), `${p.id} ${s.name}`).toBe(true)
      }
    }
  })
})

describe('12 個必備 preset：重算值與預期文字', () => {
  it('每一個都相符（checkExpected = ok），而且宣告的必備 key 全部產生', () => {
    const report: string[] = []
    for (let i = 1; i <= 12; i++) {
      const p = slot(i)
      const chk = checkExpected(p, run(p).metrics)
      if (chk.status !== 'ok') report.push(`#${i} ${p.id}: ${chk.note}`)
      expect(chk.rows.filter((r) => r.required).length + chk.missingKeys.length, p.id).toBe(GALLERY_EXPECTED_KEYS[p.id].length)
    }
    expect(report).toEqual([])
  })

  it('反面測試（規格 §17 末段）：把模型輸出改錯 1%，12 個全部被判為 mismatch', () => {
    for (let i = 1; i <= 12; i++) {
      const p = slot(i)
      const chk = checkExpected(p, perturbMetrics(run(p).metrics, 0.01))
      expect(chk.status, `#${i} ${p.id} 注入 1% 誤差後仍顯示一致`).toBe('mismatch')
    }
  })

  it('反面測試：預期文字被改掉一個數字（#8 的 σ_w 0.39919 → 0.39819）⇒ mismatch 並指出 sigmaW', () => {
    const p = slot(8)
    expect(p.expected).toContain('0.39919')
    const chk = checkExpected({ id: p.id, expected: p.expected.replace('0.39919', '0.39819') }, run(p).metrics)
    expect(chk.status).toBe('mismatch')
    expect(chk.note).toContain('sigmaW')
  })

  it('主執行緒負擔得起：12 個必備 preset 合計 < 2 s（典型值約 0.1 s）', () => {
    const t0 = performance.now()
    for (let i = 1; i <= 12; i++) run(slot(i))
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

describe('GALLERY_SLOTS 文字中的參考數字與模型一致（不是手打後就不管）', () => {
  it('#2：偶數 N = 100 的嚴格 P(S_N > 0) 是 49.2%', () => {
    expect(GALLERY_SLOTS[1].corrected).toContain('49.2')
    const r = run(mk('comparator-lab', { ...slot(2).params, N: 100, tieRule: 'strict' }))
    expect((100 * val(r, 'pPos')).toFixed(1)).toBe('49.2')
  })

  it('#2：s = 0.25σ_v 時 K_q 線性化高估約 1%', () => {
    expect(GALLERY_SLOTS[1].failure).toContain('0.25\\sigma_v')
    const r = run(mk('comparator-lab', { s: 25, sigma: 100, theta: 0, N: 101, tieRule: 'strict' }))
    expect(val(r, 'linErr')).toBeGreaterThan(0.009)
    expect(val(r, 'linErr')).toBeLessThan(0.012)
  })

  it('#6：物理 K_q = 0.00797885 fs⁻¹、μ = 0.5 fs 時要 75,091 blocks；正規化時 598', () => {
    expect(GALLERY_SLOTS[5].corrected).toContain('75{,}091')
    expect(GALLERY_SLOTS[5].corrected).toContain('0.00797885')
    const phys = run(mk('pe-eigen-lab', { ...slot(6).params, detector: 'sign', sigmaV: 100, kqMode: 'physical', muInput: 0.5 }))
    expect(val(phys, 'k95Slow')).toBe(75091)
    expect(val(phys, 'Kq').toPrecision(6)).toBe('0.00797885')
    expect(val(run(slot(6)), 'k95Slow')).toBe(598)
  })

  it('#7：MSE 1.34、無雜訊 Sign-LMS 1.40；±1 code 為 1.10、Gaussian code 為 1.30', () => {
    const s = GALLERY_SLOTS[6]
    expect(`${s.corrected} ${s.failure}`).toEqual(expect.stringContaining('1.34'))
    expect(val(run(slot(7)), 'wMse')).toBeCloseTo(1.34, 12)
    expect(val(run(slot(7)), 'wSign0')).toBeCloseTo(1.4, 12)
    expect(val(run(mk('bias-inl-lab', { ...slot(7).params, codeKind: 'pm_one', algorithm: 'mse' })), 'wMse')).toBeCloseTo(1.1, 12)
    expect(val(run(mk('bias-inl-lab', { ...slot(7).params, codeKind: 'gaussian', algorithm: 'mse' })), 'wMse')).toBeCloseTo(1.3, 9)
  })

  it('#8：ENBW 20.29 kHz、−3 dB 12.9 kHz、σ_w 0.399 fs', () => {
    expect(GALLERY_SLOTS[7].corrected).toContain('20.29')
    const r = run(slot(8))
    expect(val(r, 'enbw').toFixed(2)).toBe('20.29')
    expect(val(r, 'f3dbExact').toFixed(1)).toBe('12.9')
    expect(val(r, 'sigmaW').toFixed(3)).toBe('0.399')
  })

  it('#10：freeze 的誤差 w − w* = −0.4 LSB（勘誤 E49 的符號）', () => {
    expect(GALLERY_SLOTS[9].corrected).toContain('-0.4')
    expect(val(run(slot(10)), 'dc:freeze')).toBeCloseTo(-0.4, 12)
  })

  it('#11：one-hot + global offset ⇒ R_x 有一個零 eigenvalue；兩組 gauge 等價參數的輸出只差浮點捨入', () => {
    const r = run(slot(11))
    expect(val(r, 'eigRxA4')).toBeCloseTo(0, 12)
    expect(val(r, 'maxDiffGauge')).toBeLessThan(1e-12)
    expect(val(r, 'maxDiffB')).toBeGreaterThan(0.1)
    expect(verdictText(r)).toContain('warn:λ_min = 0：不可辨識')
  })
})

/* ───────────────────────── 推導步驟的等式必須與顯示的數字一致 ─────────────────────────
 * 規格 §17 末段的反面情境「模型公式有錯，UI 卻顯示成功」在推導步驟也會發生：數字是模型算的（正確），
 * 但旁邊寫的公式是另一個情形的公式（例如主迴路 DC null 時仍寫 E[x²] 當分母）。以下逐一把步驟上的公式
 * 用獨立的算式重算，確認它真的等於顯示的那個數。
 */
const real = (id: string): PresetEntry => {
  const p = ALL_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`找不到 preset ${id}`)
  return p
}
const stepsText = (r: PreviewResult) => r.steps.map((s) => `${s.tex} || ${s.why}`).join('\n')
const label = (r: PreviewResult, key: string) => r.metrics.find((m) => m.key === key)?.label ?? ''
const hasKey = (r: PreviewResult, key: string) => r.metrics.some((m) => m.key === key)

describe('推導步驟：顯示的公式就是算出那個數字的公式', () => {
  it('所有真實 preset 的摘要、步驟與判定都沒有裸露的 NaN／Infinity／undefined（不存在的量要用文字解釋）', () => {
    const bad: string[] = []
    for (const p of ALL_PRESETS.filter((x) => hasPreviewer(x.experiment))) {
      const o = previewPreset(p)
      if (o.status !== 'ok') continue
      const r = o.result
      const texts = [r.summary, ...r.steps.map((s) => `${s.tex} ${s.why}`), ...r.verdicts.map((v) => v.text)]
      for (const s of texts) if (/NaN|Infinity|undefined/.test(s)) bad.push(`${p.id}: ${s.slice(0, 120)}`)
    }
    expect(bad).toEqual([])
  })

  it('Bias Lab、主迴路 DC null（勘誤 E03）：分母是 Var(x) 而不是 E[x²]；線性 PD 保留 b·E[x]，共用 BBPD 則沒有', () => {
    // (C) linear PD：x ∈ {0,1,2,3}、b = 0.5 ⇒ 1 + 0.5·1.5/1.25 = 1.6（靜態式 1 + 0.5·1.5/3.5 = 1.214 是錯的公式）
    const lin = run(real('bias-offset-linear-pd'))
    const Ex = val(lin, 'Ex')
    const varX = val(lin, 'varX')
    const Ex2 = val(lin, 'Ex2')
    expect(varX).toBeCloseTo(Ex2 - Ex * Ex, 12)
    expect(val(lin, 'wMse')).toBeCloseTo(1 + (0.5 * Ex) / varX, 12)
    expect(val(lin, 'wMse')).toBeCloseTo(1.6, 12)
    expect(Math.abs(val(lin, 'wMse') - (1 + (0.5 * Ex) / Ex2))).toBeGreaterThan(0.3) // 靜態式給 1.214：差很多
    expect(stepsText(lin)).toContain('\\frac{b\\,E[x]+\\mathrm{Cov}(x,d)}{\\mathrm{Var}(x)}')
    expect(stepsText(lin)).toContain('=1+\\frac{0.75}{1.25}=1.6')
    expect(stepsText(lin)).not.toContain('{E[x^2]}=') // 不可再出現「除以 E[x²]」的靜態式
    // (B) shared BBPD：offset 被吸收 ⇒ w* = a，判定要說「沒有 gain bias」而不是「GMAC 歸零 ≠ 誤差歸零」
    const sh = run(real('bias-offset-shared-bbpd'))
    expect(val(sh, 'wMse')).toBeCloseTo(1, 12)
    expect(val(sh, 'wStar')).toBeCloseTo(1, 9)
    expect(val(sh, 'phiStar')).toBeCloseTo(-0.5, 9)
    expect(stepsText(sh)).toContain('\\frac{\\mathrm{Cov}(x,d)}{\\mathrm{Var}(x)}')
    expect(verdictText(sh)).toContain('沒有 gain bias')
    expect(verdictText(sh)).not.toContain('GMAC 歸零 ≠')
    // DSM residue + c₂：a + c₂·Cov(x, x²)/Var(x)（與預期文字的 1.09961 相同）
    const dsm = run(real('inl-dsm-residue-c2'))
    expect(val(dsm, 'wMse')).toBeCloseTo(1.09961, 5)
    expect(val(dsm, 'varX')).toBeCloseTo(1 / 12, 4)
    // (A) none：仍是靜態式
    const none = run(slot(7))
    expect(stepsText(none)).toContain('{E[x^2]}=1+\\frac{0.68}{2}=1.34')
    expect(hasKey(none, 'varX')).toBe(false)
  })

  it('Bias Lab、無雜訊 Sign-LMS 的 dead zone：固定點是一整段區間，不能顯示成單一的「Brent 根」', () => {
    const r = run(real('bias-deadzone-noisefree'))
    const w = r.metrics.find((m) => m.key === 'wStar')?.value
    expect(typeof w).toBe('string')
    expect(String(w)).toContain('1.33333')
    expect(String(w)).toContain('1.5')
    expect(verdictText(r)).toMatch(/^warn:.*dead zone/)
    expect(stepsText(r)).not.toContain('Brent')
    expect(stepsText(r)).toContain('|x|\\operatorname{sign}(t(x)-w)')
    // 單一中位數時（五值 code、c₃ = 0.1）仍是一個數：1.4
    const one = run(real('bias-inl-cubic-noisefree'))
    expect(val(one, 'wStar')).toBeCloseTo(1.4, 9)
    expect(verdictText(one)).toMatch(/^ok:.*GMAC 歸零 ≠ DTC 誤差歸零/)
  })

  it('LMS Noise Lab、colored η：σ_w² = μ²σ_η²/(1−p²)·(1+pr)/(1−pr)，步驟上的乘法等於顯示的結果', () => {
    const r = run(real('noise-colored-eta'))
    const p = val(r, 'p')
    const rr = 0.5
    const white = (10 * 10 * val(r, 'sigmaEta2')) / (1 - p * p)
    const factor = (1 + p * rr) / (1 - p * rr)
    expect(val(r, 'colorFactor')).toBeCloseTo(factor, 12)
    expect(val(r, 'sigmaW') ** 2).toBeCloseTo(white * factor, 12)
    expect(val(r, 'rho1')).toBeCloseTo(p + (rr * (1 - p * p)) / (1 + p * rr), 12)
    expect(label(r, 'sigmaW')).toContain('\\tfrac{1+pr}{1-pr}')
    expect(stepsText(r)).toContain('\\frac{1+pr}{1-pr}')
    // 白色時不出現修正因子，σ_w 回到 0.39919
    const w = run(slot(8))
    expect(hasKey(w, 'colorFactor')).toBe(false)
    expect(label(w, 'sigmaW')).not.toContain('pr')
    expect(val(w, 'sigmaW') ** 2).toBeCloseTo(white, 12)
  })

  it('LMS Noise Lab、沒有穩態或沒有 −3 dB 點：用文字解釋原因，不顯示 NaN', () => {
    const pol = run(real('noise-polarity-flip'))
    expect(pol.summary).toContain('不存在穩態')
    expect(stepsText(pol)).toContain('\\text{沒有固定點}')
    expect(stepsText(pol)).not.toContain('f_{3\\mathrm{dB}}')
    const sum = run(real('noise-sum-mode-bug'))
    expect(sum.summary).toContain('不存在穩態')
    expect(stepsText(sum)).toContain('\\times4096=')
    const no3 = run(real('noise-no-3db'))
    expect(no3.summary).toContain('−3 dB 點不存在')
    expect(stepsText(no3)).toContain('>1\\quad(\\text{無解：−3 dB 點不存在})')
    expect(val(no3, 'sigmaW')).toBeGreaterThan(0) // σ_w 仍然存在
    const hp = run(real('noise-highpass'))
    expect(hp.summary).toContain('high-pass')
    expect(stepsText(hp)).toContain('<0')
  })

  it('Polarity Explorer、Ω = π（勘誤 E46）：步驟用 2 倍公式 A²·H·cos(ΩD)，等式兩邊相等', () => {
    const r = run(real('polarity-omega-pi-edge'))
    expect(val(r, 'C')).toBeCloseTo(-1, 12)
    expect(label(r, 'C')).toBe('C_D=A^2\\,H\\cos(\\Omega D)')
    expect(stepsText(r)).toContain('A^2\\,H\\cos(\\Omega D)=1\\times(-1)\\times')
    expect(stepsText(r)).not.toContain('\\tfrac{1}{2}\\times1\\times\\cos') // 不可再把 ½·1·cos180° 寫成 −1
    expect(label(r, 'driftCont')).not.toContain('\\pi') // Ω = π 時大誤差增益是 A，不是 2A/π
    expect(val(r, 'driftCont')).toBeCloseTo(10, 12)
    expect(val(r, 'driftSampled')).toBeCloseTo(10, 12)
  })

  it('Polarity Explorer、θ = 90°：C 恰為 0（不是 3×10⁻¹⁷）、p = 1、沒有 μ_max；大誤差漂移恰為 0', () => {
    const r = run(real('polarity-phase90-zero'))
    expect(val(r, 'C')).toBe(0)
    expect(val(r, 'pole')).toBe(1)
    expect(hasKey(r, 'muMax')).toBe(false)
    expect(val(r, 'driftSampled')).toBe(0)
    expect(val(r, 'driftCont')).toBe(0)
    expect(stepsText(r)).toContain('C=0\\;\\Rightarrow\\;p=1')
    expect(stepsText(r)).not.toMatch(/10\^\{-1\d\}/)
  })

  it('Polarity Explorer：取樣後的大誤差增益對整數個週期平均（#3 恰為 μ(2+√3)/12）；非週期的 Ω 標成 approx', () => {
    const r = run(slot(3))
    expect(val(r, 'driftSampled')).toBeCloseTo((10 * (2 + Math.sqrt(3))) / 12, 9) // 一萬多個 sample 的浮點加總：約 1e-12
    expect(r.metrics.find((m) => m.key === 'driftSampled')?.claim).toBe('exact')
    const irr = run(mk('polarity-explorer', { ...slot(3).params, omega: 0.5 }))
    expect(irr.metrics.find((m) => m.key === 'driftSampled')?.claim).toBe('approx')
    // 非週期時仍接近連續時間極限 μ(2A/π)|cos θ|（每個週期 12.6 個 sample，差幾個百分點以內）
    expect(val(irr, 'driftSampled') / val(irr, 'driftCont')).toBeGreaterThan(0.95)
    expect(val(irr, 'driftSampled') / val(irr, 'driftCont')).toBeLessThan(1.05)
    expect(tonePeriod(Math.PI / 6)).toBe(12)
    expect(tonePeriod(Math.PI)).toBe(2)
    expect(tonePeriod((2 * Math.PI * 3) / 7)).toBe(7)
    expect(tonePeriod(0)).toBe(1)
    expect(tonePeriod(0.5)).toBe(0)
    expect(tonePeriod(NaN)).toBe(0)
  })

  it('Polarity Explorer、filtered-x regressor：θ = ΩD（φ 抵銷），C = (A|H|)²/2·cos(ΩD)', () => {
    const r = run(mk('polarity-explorer', { ...slot(3).params, regressor: 'u', mag: 0.5, A: 2, D: 2 }))
    expect(val(r, 'theta')).toBeCloseTo(60, 9)
    expect(val(r, 'C')).toBeCloseTo(((2 * 0.5) ** 2 / 2) * Math.cos(Math.PI / 3), 12)
    expect(stepsText(r)).toContain('\\theta=\\Omega D=')
    expect(stepsText(r)).not.toContain('\\theta=\\varphi+\\Omega D')
    // 圖上的曲線也是 filtered-x 的 C（D = 0 時最大）
    const y = r.chart?.series[0].y ?? []
    expect(y[0]).toBeCloseTo(0.5, 12)
    expect(y[2]).toBeCloseTo(val(r, 'C'), 12)
  })

  it('Phase Margin Lab：g ≤ 0 或 g > 2 沒有 gain crossover ⇒ 步驟寫「無解」而不是 arcsin = NaN；臨界點的 PM 恰為 0', () => {
    const neg = run(real('pm-reversed-polarity'))
    expect(stepsText(neg)).toContain('\\le0\\quad(\\text{無解})')
    expect(neg.summary).toContain('沒有 gain crossover')
    expect(Number.isNaN(val(neg, 'pm'))).toBe(true)
    const big = run(mk('pm-lab', { g: 2.5, d: 0, steps: 20 }))
    expect(stepsText(big)).toContain('>2\\quad(\\text{無解})')
    expect(verdictText(big)).toMatch(/^danger:/)
    const crit = run(real('pm-d1-critical'))
    expect(val(crit, 'pm')).toBe(0)
    expect(val(crit, 'gm')).toBe(0)
    expect(stepsText(crit)).toContain('z^{2}-z+1=0')
    expect(stepsText(crit)).toContain('90^\\circ-3\\times{30}^\\circ={0}^\\circ')
    const d0 = run(real('pm-g15-delay-margin'))
    expect(stepsText(d0)).toContain('z-1+1.5=0')
  })

  it('Comparator Lab：偶數 N + strict 的判對機率 < 50% 時不可判 ok；E[q] 指向錯誤方向時 N₉₅ 不存在（不寫成 = ∞）', () => {
    const even = run(real('comparator-even-n100-tie'))
    expect(val(even, 'pCorrect')).toBeLessThan(0.5)
    expect(verdictText(even)).not.toMatch(/^ok:/)
    expect(verdictText(even)).toMatch(/^warn:.*<0\.5/)
    const off = run(real('comparator-offset-beats-error'))
    expect(stepsText(off)).toContain('N_{95}\\ \\text{不存在}')
    expect(stepsText(off)).not.toContain('=\\infty')
    expect(stepsText(off)).toContain('\\times(-0.00797871)') // 負數加括號
    expect(hasKey(off, 'n95Odd')).toBe(false)
  })

  it('Delay / Filtered-x Lab：Ĥ ≠ H 時步驟用 |H||Ĥ|cos θ（勘誤 E45）；cos 90° 的殘渣歸零', () => {
    const r = run(real('filtered-x-latency-mismatch'))
    expect(val(r, 'C:A')).toBeCloseTo(1, 12)
    expect(val(r, 'C:B')).toBe(0)
    expect(val(r, 'pole:B')).toBe(1)
    expect(val(r, 'C:C')).toBeCloseTo(-0.5, 12)
    const s = stepsText(r)
    expect(s).toContain('\\hat H=H\\Rightarrow\\theta=\\Omega D')
    expect(s).toContain('|H||\\hat H|\\cos\\theta=1\\times1\\times\\cos({120}^\\circ)=-0.5')
    expect(s).toContain('勘誤 E45')
    // 每個單頻 preset：步驟上的 |H|(|Ĥ|)cos θ 就是 C（raw / delayed / filtered 皆然）
    for (const p of ALL_PRESETS.filter((x) => x.experiment === 'delay-fx-lab')) {
      const rr = run(p)
      for (const st of rr.steps) {
        const m = /C(?:=E\[u_f\\,u\])?=(?:\|H\|\^2\\cos\\theta|\|H\|\|\\hat H\|\\cos\\theta|\|H\|\\cos\\theta)=([-\d.]+)(?:\\times([-\d.]+))?\\times\\cos\(\{([-\d.]+)\}\^\\circ\)=([-\d.]+)/.exec(st.tex)
        if (!m) continue
        const prod = Number(m[1]) * (m[2] ? Number(m[2]) : 1) * Math.cos((Number(m[3]) * Math.PI) / 180)
        const shown = Number(m[4])
        expect(Math.abs(prod - shown), `${p.id}: ${st.tex}`).toBeLessThan(2e-3 * Math.max(1, Math.abs(shown))) // 顯示只有 5 位有效數字
      }
    }
  })

  it('MIMO：零 eigenvalue 不可寫成「全部為負」；「單一 loop」只對 scalar／diagonal 規則列出；sequential 的矩陣標成 sweep', () => {
    const trap = run(real('mimo-sequential-trap'))
    expect(stepsText(trap)).toContain('有零 eigenvalue')
    expect(stepsText(trap)).not.toContain('全部為負')
    expect(stepsText(trap)).toContain('\\Phi_{\\text{sweep}}')
    expect(stepsText(trap)).not.toContain('8.674') // 浮點殘渣不進矩陣
    const mis = run(real('mimo-jhat-mismatch-e24'))
    expect(hasKey(mis, 'singlePole')).toBe(false)
    expect(stepsText(mis)).not.toContain('單一 loop')
    const g12 = run(slot(12))
    expect(stepsText(g12)).toContain('每個 $|p_i|<1$')
    expect(stepsText(g12)).toContain('有實部為正的 eigenvalue')
  })

  it('Quantized Gain Lab：toggle 的平均不等於 w* 時（32.3、或 overflow）不可寫「平均值正好是 w*」', () => {
    const f = run(real('quant-float-tie-32p3'))
    expect(val(f, 'mean:toggle')).toBeCloseTo(32.2, 12)
    expect(stepsText(f)).toContain('不是 $w^*=32.3$')
    expect(stepsText(f)).not.toContain('平均值正好是')
    const o = run(real('quant-overload-wrap'))
    expect(stepsText(o)).toContain('實際輸出被 wrap')
    expect(verdictText(o)).toContain('來自 overflow')
    expect(stepsText(run(slot(10)))).toContain('平均值正好是 $w^*$')
  })

  it('Code Mixing Lab：code 有 DC 時步驟含 mB·cos(2πf_w t) 項；只有隨機成分時說明沒有離散 tone', () => {
    const dc = run(real('mixing-dc-offset'))
    expect(stepsText(dc)).toContain('mB\\cos(2\\pi f_wt)')
    expect(dc.summary).toContain('0.5+1\\cos')
    expect(val(dc, 'tone:10')).toBeCloseTo(0.5, 9)
    const rnd = run(real('mixing-random-skirt'))
    expect(rnd.summary).toContain('沒有離散 tone')
    expect(stepsText(rnd)).toContain('E[\\delta t^2]')
    // ZOH 權重就是 zohGain：0.5 × 0.997502 = 0.498751（與量到的 tone 相同）
    const zoh = run(real('mixing-zoh-hold'))
    const w = Math.sin((Math.PI * 1e4 * 16) / 4096e3) / (16 * Math.sin((Math.PI * 1e4) / 4096e3))
    expect(val(zoh, 'tone:90')).toBeCloseTo(0.5 * w, 9)
    expect(stepsText(zoh)).toContain('N_h=16')
  })

  it('純量 LMS 有雜訊時：步驟補上 σ_w² = μσ_v²/(2 − μx²)，與 metric 相同；x = 0 時不列（0/0）', () => {
    const r = run(real('lms-playground-noisy'))
    expect(val(r, 'sdW') ** 2).toBeCloseTo(0.0625, 12)
    expect(stepsText(r)).toContain('=\\frac{0.1\\times1}{2-0.4}=0.0625')
    const z = run(mk('lms-playground', { a: 3, w0: 1, x: 0, mu: 0.1, steps: 20, noiseSigma: 1, seed: 1 }))
    expect(hasKey(z, 'sdW')).toBe(false)
    expect(verdictText(z)).toMatch(/^danger:.*不可辨識/)
  })

  it('PE / Eigen Lab：λ_min = 0 時不顯示 ⌈∞⌉；物理 K_q 模式把 g = μK_q 的乘法寫出來', () => {
    const miss = run(real('pe-rho-1-missing'))
    expect(stepsText(miss)).toContain('k_{95}\\ \\text{不存在}')
    expect(miss.summary).toContain('永遠不收斂')
    const phys = run(real('pe-physical-kq'))
    expect(stepsText(phys)).toContain('g=\\mu K_q=0.5\\times0.00797885=0.00398942')
  })
})

describe('反面測試：參數落在模型沒有定義的地方時，預覽要解釋原因（不顯示 NaN，也不硬判「收斂」）', () => {
  const clean = (r: PreviewResult) => {
    const texts = [r.summary, ...r.steps.map((s) => `${s.tex} ${s.why}`), ...r.verdicts.map((v) => v.text)]
    for (const s of texts) expect(s, s.slice(0, 80)).not.toMatch(/NaN|Infinity|undefined/)
  }

  it('σ_v = 0（hard limiter）：Polarity 與 Delay/Filtered-x 都說明 K_q 與 pole 沒有定義，不可判「平均收斂」', () => {
    const pol = run(mk('polarity-explorer', { mode: 'tone', phiDeg: 60, omega: Math.PI / 6, sigmaV: 0, mu: 10 }))
    clean(pol)
    expect(pol.summary).toContain('沒有定義')
    expect(verdictText(pol)).toMatch(/^warn:.*hard limiter/)
    expect(verdictText(pol)).not.toMatch(/^ok:/m)
    // C < 0 時仍然要有規格要求的極性警告
    const neg = run(mk('polarity-explorer', { mode: 'tone', phiDeg: 120, omega: Math.PI / 6, sigmaV: 0, mu: 10 }))
    clean(neg)
    expect(verdictText(neg)).toContain('danger:C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散')
    const fxl = run(mk('delay-fx-lab', { scenario: { pathKind: 'single_tone', codeKind: 'sinusoid', sigmaV: 0 }, cases: [{ mode: 'delayed', D: 4, mu: 10 }] }))
    clean(fxl)
    expect(verdictText(fxl)).toMatch(/^warn:.*hard limiter/)
  })

  it('LMS Noise Lab：σ_v = 0 ⇒ 說明 K_q 無定義；colored η 的 |r| ≥ 1 ⇒ danger（不可顯示「Low-pass：σ_w = NaN」）', () => {
    const z = run(mk('lms-noise-lab', { sigmaV: 0 }))
    clean(z)
    expect(z.summary).toContain('無定義')
    const bad = run(mk('lms-noise-lab', { etaR: 1.2 }))
    clean(bad)
    expect(verdictText(bad)).toMatch(/^danger:.*沒有有限變異數/)
    expect(bad.summary).toContain('不存在穩態')
  })

  it('PE / Eigen Lab：sign detector + 物理 K_q + σ_v = 0 ⇒ unsupported 並說明原因（不是 eigvals 的 NaN 錯誤）', () => {
    const o = previewPreset(mk('pe-eigen-lab', { rho: 0.5, detector: 'sign', sigmaV: 0, kqMode: 'physical', muInput: 0.5 }))
    expect(o.status).toBe('unsupported')
    expect(o.status === 'unsupported' && o.reason).toContain('hard limiter')
  })

  it('Phase Margin Lab：g = 0 ⇒ p = 1（參數不動），不可寫成「p > 1」；g < 0 才是極性錯誤', () => {
    const z = run(mk('pm-lab', { g: 0, d: 0, steps: 20 }))
    clean(z)
    expect(verdictText(z)).toMatch(/^warn:.*\$p=1\$/)
    expect(verdictText(z)).not.toContain('p=1-g>1')
    expect(verdictText(run(mk('pm-lab', { g: -0.1, d: 0, steps: 20 })))).toMatch(/^danger:.*更新極性錯誤/)
  })

  it('Dual-Loop：r = 1 ⇒ quasi-static 近似要除以 0，步驟說明「不存在」而不是顯示 −∞', () => {
    const r = run(mk('dual-loop', { r: 1, b: 0.2, c: 1, mu: 0.5, steps: 50 }))
    clean(r)
    expect(r.summary).toContain('quasi-static 近似不存在')
    expect(stepsText(r)).not.toContain('\\infty')
    expect(verdictText(r)).toMatch(/^danger:/)
  })
})
