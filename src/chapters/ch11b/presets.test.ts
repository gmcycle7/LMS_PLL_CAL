import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PresetEntry } from '@/data/types'
import { MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4, analyzeInlStructure, foldedPsdDcLinearProcess, foldingPrediction, iidSquaredPsdDc, inbandPower, lutApproxRms, segmentClosedForm } from '@/simulation/models/dtcInl'
import { applyFoldingPreset, FOLDING_ID } from './experiments/FoldingLab'
import { applyLmsPreset, LMS_ID, toConfig } from './experiments/InlLmsLab'
import { applyBasisPreset, BASIS_ID } from './experiments/BasisLab'

/**
 * Ch11b 的 presets（src/data/presets/dtc-inl-*.json）：格式、歸屬的實驗、預期文字裡的數字與模型一致。
 */
const dir = join(process.cwd(), 'src/data/presets')
const files = readdirSync(dir).filter((f) => /^dtc-inl-.*\.json$/.test(f))
const presets: PresetEntry[] = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetEntry)
const byId = (id: string) => {
  const p = presets.find((q) => q.id === id)
  if (!p) throw new Error(`沒有 preset ${id}`)
  return p
}

describe('Ch11b presets', () => {
  it('10 個檔、id 與檔名一致、都屬於本章的三個實驗、source illustrative、expected 有內容', () => {
    expect(presets.length).toBe(10)
    files.forEach((f, i) => {
      const p = presets[i]
      expect(`${p.id}.json`).toBe(f)
      expect(p.page).toBe('/ch/11b')
      expect([FOLDING_ID, LMS_ID, BASIS_ID]).toContain(p.experiment)
      expect(p.source).toBe('illustrative')
      expect(p.expected.length).toBeGreaterThan(20)
      expect(p.galleryIndex).toBeUndefined()
    })
    expect(presets.filter((p) => p.experiment === FOLDING_ID)).toHaveLength(3)
    expect(presets.filter((p) => p.experiment === LMS_ID)).toHaveLength(5)
    expect(presets.filter((p) => p.experiment === BASIS_ID)).toHaveLength(2)
  })

  it('折返 presets 的數字：MASH 精確式 0.3361、uniform 0.7111、三次的 Gaussian 0.0391', () => {
    const m = applyFoldingPreset(byId('dtc-inl-folding-mash-quadratic').params)
    const nuB = m.fBMHz / m.fsMHz
    expect(inbandPower(m.d2 ** 2 * foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), nuB)).toBeCloseTo(0.3361, 4)
    expect(foldingPrediction(MASH_CODE_AUTOCORR, m, nuB).Pin).toBeCloseTo(0.4861, 4)
    expect(byId('dtc-inl-folding-mash-quadratic').expected).toContain('0.336')
    const u = applyFoldingPreset(byId('dtc-inl-folding-uniform').params)
    expect(inbandPower(u.d2 ** 2 * iidSquaredPsdDc(1 / 5, 1 / 3), u.fBMHz / u.fsMHz)).toBeCloseTo(0.7111, 4)
    expect(byId('dtc-inl-folding-uniform').expected).toContain('0.7111')
    const c = applyFoldingPreset(byId('dtc-inl-folding-cubic').params)
    expect(foldingPrediction(MASH_CODE_AUTOCORR, c, c.fBMHz / c.fsMHz).Pin).toBeCloseTo(0.0391, 4)
    expect(byId('dtc-inl-folding-cubic').expected).toContain('0.0391')
  })

  it('LMS presets 的數字：分段 λ、k95；LUT MASH 的稀疏格；frac 0.3 的空格與奇異；gauge 的奇異；Legendre 的 floor ≈ 0', () => {
    const pw = applyLmsPreset(byId('dtc-inl-lms-piecewise-k8').params)
    const outer = segmentClosedForm(7, pw.K, pw.mu, pw.sigmaV, pw.N)
    expect(outer.lambda).toBeCloseTo(0.09635, 5)
    expect(outer.k95).toBe(194)
    expect(byId('dtc-inl-lms-piecewise-k8').expected).toContain('194')
    expect(lutApproxRms({ d2: 20, d3: 0 }, 8)).toBeGreaterThan(0)
    const analyze = (id: string) => {
      const p = applyLmsPreset(byId(id).params)
      return analyzeInlStructure({ config: toConfig(p), shape: { d2: p.d2, d3: p.d3, sawAmp: p.sawAmp, sawSegments: p.sawSegments }, code: { kind: p.codeKind, frac: p.frac }, a: p.a, w0: p.w0, b: p.b, sigmaV: p.sigmaV, mu: p.mu, N: p.N, algorithm: p.algorithm, seed: 20261019 })
    }
    const lutMash = analyze('dtc-inl-lms-lut-mash')
    expect(lutMash.visit.filter((v) => v > 0 && v < 0.01).length).toBeGreaterThanOrEqual(20)
    expect(byId('dtc-inl-lms-lut-mash').expected).toContain('25 個')
    const rational = analyze('dtc-inl-lms-lut-rational-fcw')
    expect(rational.visit.filter((v) => v === 0).length).toBeGreaterThanOrEqual(20)
    expect(rational.mode.singular).toBe(true)
    const gauge = analyze('dtc-inl-lms-gauge-gain')
    expect(gauge.mode.singular).toBe(true)
    expect(gauge.ls.singular).toBe(true)
    const leg = analyze('dtc-inl-lms-poly-legendre')
    expect(leg.ls.residualRms).toBeLessThan(1e-6)
    expect(leg.mode.cond).toBeGreaterThan(10)
  })

  it('基底 presets：參數能套用；full preconditioner 的 k95 = ⌈ln 0.05/ln 0.9⌉ = 29', () => {
    const b = applyBasisPreset(byId('dtc-inl-basis-uniform-m3').params)
    expect(b.M).toBe(3)
    expect(b.gMax).toBe(0.1)
    const f = applyBasisPreset(byId('dtc-inl-basis-full-precond').params)
    expect(f.precond).toBe('full')
    expect(Math.ceil(Math.log(0.05) / Math.log(1 - f.gamma))).toBe(29)
    expect(byId('dtc-inl-basis-full-precond').expected).toContain('29')
    expect(byId('dtc-inl-basis-uniform-m3').expected).toContain('67.6')
  })
})
