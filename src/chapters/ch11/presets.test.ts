import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PresetEntry } from '@/data/types'
import { analyzeBias, buildCodeDistribution, fixedPoint, mcAgreement, signWeightedMedian, simulateBiasLms } from '@/simulation/models/bias'
import { splitPresetParams, toCode, toModel } from './experiments/BiasInlLab'
import { DCNULL_PRESETS } from './experiments/DcNullExperiment'
import { FORMULAS } from './formulas'

const dir = join(process.cwd(), 'src/data/presets')
const files = readdirSync(dir).filter((f) => /^(bias|inl).*\.json$/.test(f))
const presets: PresetEntry[] = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetEntry)

function wStarOf(p: PresetEntry): number {
  const { shared, kase } = splitPresetParams(p.params)
  return analyzeBias({ model: toModel(shared, kase), code: toCode(shared), algorithm: kase.algorithm, dcMode: kase.dcMode, w0: shared.w0 }).wStar
}

describe('Ch11 presets（bias*.json / inl*.json）', () => {
  it('格式正確、id 與檔名一致、都屬於 bias-inl-lab', () => {
    expect(presets.length).toBeGreaterThanOrEqual(10)
    files.forEach((f, i) => {
      const p = presets[i]
      expect(`${p.id}.json`).toBe(f)
      expect(p.page).toBe('/ch/11')
      expect(p.experiment).toBe('bias-inl-lab')
      expect(p.source).toBe('illustrative')
      expect(p.expected.length).toBeGreaterThan(20)
    })
  })

  it('T12: Gallery #7（勘誤 E11 修正文字）—— 5-level、a = 1、c₃ = 0.1、Sign σ_v = 1 ⇒ 1.340346；文字註明 1.10 / 1.30 / 1.40', () => {
    const g7 = presets.find((p) => p.galleryIndex === 7)
    expect(g7).toBeDefined()
    if (!g7) return
    expect(g7.params.codeKind).toBe('five_level')
    expect(g7.params.c3).toBe(0.1)
    expect(wStarOf(g7)).toBeCloseTo(1.3403458341, 9)
    for (const s of ['1.34', '1.10', '1.30', '1.40', 'E11']) expect(g7.expected).toContain(s)
    // 切到 MSE-LMS 得精確 1.34
    expect(wStarOf({ ...g7, params: { ...g7.params, algorithm: 'mse' } })).toBeCloseTo(1.34, 13)
  })

  it('每個 preset 的預期數字與模型一致', () => {
    const want: Record<string, number> = {
      'bias-inl-cubic-mse': 1.34,
      'bias-inl-cubic-noisefree': 1.4,
      'bias-inl-cubic-sigma01': 1.366577,
      'bias-offset-static': 1.2141047,
      'bias-offset-shared-bbpd': 1,
      'bias-offset-linear-pd': 1.5897266,
      'bias-jitter-centering': 0.9600663,
      'bias-kappa-identifiability': 1.1,
      'inl-dsm-residue-c2': 1.0996094,
      'inl-gaussian-code': 1.2775286,
      'bias-servo-dither': 1.366577,
    }
    for (const [id, w] of Object.entries(want)) {
      const p = presets.find((q) => q.id === id)
      expect(p, id).toBeDefined()
      if (p) expect(Math.abs(wStarOf(p) - w), id).toBeLessThan(2e-6)
    }
    const dz = presets.find((q) => q.id === 'bias-deadzone-noisefree')
    expect(dz).toBeDefined()
    if (dz) {
      const { shared, kase } = splitPresetParams(dz.params)
      const d = buildCodeDistribution(toCode(shared))
      const z = signWeightedMedian(toModel(shared, kase), d.values, d.probs)
      expect(z.lo).toBeCloseTo(4 / 3, 12)
      expect(z.hi).toBeCloseTo(1.5, 12)
    }
  }, 60000)

  it('preset expected 文字裡的次要數字也由模型重現（切換演算法 / σ_v / DC 模式後的值）', () => {
    const get = (id: string) => presets.find((q) => q.id === id) as PresetEntry
    const w = (p: PresetEntry, over: Record<string, unknown>) => wStarOf({ ...p, params: { ...p.params, ...over } })
    // inl-gaussian-code：MSE 1.30；σ_v = 0 時 |x| 加權中位數 = a + c₃·2ln2 = 1.13863（Exp(1) 的中位數 ln2）
    const g = get('inl-gaussian-code')
    expect(w(g, { algorithm: 'mse' })).toBeCloseTo(1.3, 10)
    expect(w(g, { sigmaV: 0 })).toBeCloseTo(1 + 0.1 * 2 * Math.log(2), 8)
    // bias-deadzone-noisefree：σ_v = 1 時唯一根 1.4272
    expect(w(get('bias-deadzone-noisefree'), { sigmaV: 1 })).toBeCloseTo(1.42715, 4)
    // inl-dsm-residue-c2：none 1.15、linear PD 1.3975
    const d = get('inl-dsm-residue-c2')
    expect(w(d, { dcMode: 'none' })).toBeCloseTo(1.15, 4)
    expect(w(d, { dcMode: 'linear_pd' })).toBeCloseTo(1.3975, 4)
    // bias-jitter-centering：MSE 1.0、σ_v 常數 1.0、加 c₃ = 0.1 → 1.3008（σ_v 常數 1.3403）
    const j = get('bias-jitter-centering')
    expect(w(j, { algorithm: 'mse' })).toBeCloseTo(1, 12)
    expect(w(j, { jitterSlope: 0 })).toBeCloseTo(1, 12)
    expect(w(j, { c3: 0.1 })).toBeCloseTo(1.3008, 4)
    expect(w(j, { c3: 0.1, jitterSlope: 0 })).toBeCloseTo(1.3403, 4)
    // bias-inl-cubic-sigma01：二階近似 1.37456
    const s01 = get('bias-inl-cubic-sigma01')
    const { shared, kase } = splitPresetParams(s01.params)
    expect(analyzeBias({ model: toModel(shared, kase), code: toCode(shared), algorithm: 'sign', dcMode: 'none' }).wSecondOrder).toBeCloseTo(1.37456, 10)
    // bias-offset-static：一階 1.2143；bias-offset-linear-pd：一階 1.6
    const st = splitPresetParams(get('bias-offset-static').params)
    expect(analyzeBias({ model: toModel(st.shared, st.kase), code: toCode(st.shared), algorithm: 'sign', dcMode: 'none' }).wLinear).toBeCloseTo(1.2143, 4)
    const lp = splitPresetParams(get('bias-offset-linear-pd').params)
    expect(analyzeBias({ model: toModel(lp.shared, lp.kase), code: toCode(lp.shared), algorithm: 'sign', dcMode: 'linear_pd' }).wLinear).toBeCloseTo(1.6, 12)
  }, 60000)

  it('bias-servo-dither：expected 文字的 MC 敘述由模型重現（比理想 mean-field 低約 0.002、φ std ≈ 0.035、σ_eff ≈ 0.106、與 servo-aware 一致）', () => {
    const p = presets.find((q) => q.id === 'bias-servo-dither') as PresetEntry
    const { shared, kase } = splitPresetParams(p.params)
    const an = analyzeBias({ model: toModel(shared, kase), code: toCode(shared), algorithm: kase.algorithm, dcMode: kase.dcMode, w0: shared.w0 })
    // Lab 的預設 MC 設定：auto μ（g = 0.02）、N = 64、3000 blocks、16 chains、seed 20261012、k_φ = 0.01
    const mc = simulateBiasLms({ model: toModel(shared, kase), code: toCode(shared), algorithm: kase.algorithm, dcMode: kase.dcMode, mu: 0.02 / an.slope, N: 64, blocks: 3000, chains: 16, w0: shared.w0, seed: 20261012, traceChains: 0, servoGain: 0.01 })
    expect(mc.mean - an.wStar).toBeLessThan(-1.5e-3)
    expect(mc.mean - an.wStar).toBeGreaterThan(-2.5e-3)
    expect(mc.phiStd).toBeCloseTo(0.035, 2)
    expect(Math.hypot(kase.sigmaV, mc.phiStd)).toBeCloseTo(0.106, 3)
    expect(mc.reference.wServoAware).toBeCloseTo(1.3648, 3)
    expect(mcAgreement(mc, an.zeroSet).pass).toBe(true)
    for (const t of ['1.366577', '0.106', '1.3648', 'F-11.17']) expect(p.expected).toContain(t)
  }, 120000) // Monte Carlo：機器忙碌時會超過預設的 5 s

  it('DcNull 實驗的本地 presets：名稱中的三個數字與 mean-field 一致（勘誤 E03）', () => {
    for (const pr of DCNULL_PRESETS) {
      if (!pr.expected) continue
      const p = pr.params
      const dist = buildCodeDistribution({ kind: p.codeKind, shift: p.codeShift, dsmFrac: 0.3 })
      const model = { a: 1, b: p.b, c2: p.c2, c3: p.c3, kappa: 0, sigmaV: p.sigmaV }
      const got = (['none', 'shared_bbpd', 'linear_pd'] as const).map((mode) => fixedPoint(p.algorithm, model, dist, mode).w)
      got.forEach((w, i) => expect(Math.abs(w - (pr.expected as number[])[i]), `${pr.name} #${i}`).toBeLessThan(6e-5))
    }
  }, 60000)

  it('公式登錄：ID 唯一、格式 F-11.x、勘誤 id 存在', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id) => expect(id).toMatch(/^F-11\.\d+$/))
    const errata = JSON.parse(readFileSync(join(process.cwd(), 'src/data/errata.json'), 'utf8')) as { errata: { eid: string }[] }
    const known = new Set(errata.errata.map((e) => e.eid))
    FORMULAS.filter((f) => f.erratumId).forEach((f) => expect(known.has(f.erratumId as string)).toBe(true))
  })
})
