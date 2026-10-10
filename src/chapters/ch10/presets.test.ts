import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PresetEntry } from '@/data/types'
import { studentTInv } from '@/simulation/core'
import { MAX_SAMPLE_BUDGET, analyzeMimo, analyzeRule, estimateSampleCost, resolveJhat, buildPlant, runMimoCovarianceMc, runMimoTrajectories } from '@/simulation/models/mimo'
import { DEFAULT_PARAMS, EXPERIMENT_ID, allRulesFrom, delta0Of, ellipsePoints, jhatSpecOf, parsePresetParams, plantSpecOf, sliceMat } from './experiments/labState'

const dir = resolve(process.cwd(), 'src/data/presets')
const files = readdirSync(dir).filter((f) => /^mimo.*\.json$/.test(f))
const load = (id: string): PresetEntry => JSON.parse(readFileSync(resolve(dir, `${id}.json`), 'utf8')) as PresetEntry

function analyze(id: string) {
  const pr = load(id)
  const p = parsePresetParams(pr.params)
  return analyzeMimo({ plant: plantSpecOf(p.params), cases: p.cases, jhat: jhatSpecOf(p.params), delta0: delta0Of(p.params), seed: p.seed })
}

describe('Ch10 presets（src/data/presets/mimo*.json）', () => {
  it('每個 preset 格式正確、id 與檔名一致、屬於 mimo-lms；Gallery #12 恰好一個', () => {
    expect(files.length).toBeGreaterThanOrEqual(6)
    let gallery12 = 0
    for (const f of files) {
      const p = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as PresetEntry
      expect(`${p.id}.json`).toBe(f)
      expect(p.experiment).toBe(EXPERIMENT_ID)
      expect(p.page).toBe('/ch/10')
      expect(p.source).toBe('illustrative')
      expect(p.expected.length).toBeGreaterThan(10)
      if (p.galleryIndex === 12) gallery12++
      // parse 不丟例外，且 cases 數 1–3
      const parsed = parsePresetParams(p.params)
      expect(parsed.cases.length).toBeGreaterThanOrEqual(1)
      expect(parsed.cases.length).toBeLessThanOrEqual(3)
      const plant = buildPlant(plantSpecOf(parsed.params))
      expect(plant.errors, f).toEqual([])
    }
    expect(gallery12).toBe(1)
  })

  it('T18: Gallery #12 的 expected 文字與計算一致（diagonal / scalar ρ = 1.2、full 0.5）', () => {
    const r = analyze('mimo-gallery12-offdiag-diverge')
    expect(r.analyses[0].rule).toBe('diagonal')
    expect(r.analyses[0].spectralRadius).toBeCloseTo(1.2, 12)
    expect(r.analyses[1].spectralRadius).toBeCloseTo(1.2, 12)
    expect(r.analyses[2].spectralRadius).toBeCloseTo(0.5, 12)
    // 單一 loop pole 0.8
    expect(r.analyses[0].Mn![0][0] * r.Jn[0][0] + 1).toBeCloseTo(0.8, 12)
    // 時域：共模每 block ×1.2
    const pr = parsePresetParams(load('mimo-gallery12-offdiag-diverge').params)
    const t = runMimoTrajectories({ plant: plantSpecOf(pr.params), cases: pr.cases, delta0: delta0Of(pr.params), blocks: 40, engine: 'linear', jhat: jhatSpecOf(pr.params), seed: pr.seed })
    const grow = t.cases[0].norm[40] / t.cases[0].norm[30]
    expect(grow).toBeCloseTo(Math.pow(1.2, 10), -1)
    expect(t.cases[2].norm[40]).toBeLessThan(0.1)
    // 「六種規則」表用 active case（Case A）的超參數：必須與 Case A / B 的數字一致（scalar 也是 1.2，不是預設 μK_q = 0.5 的 1.5）
    const plant = buildPlant(plantSpecOf(pr.params))
    const all = allRulesFrom(pr.cases[0]).map((c) => analyzeRule(plant, c, plant.Jn))
    const by = Object.fromEntries(all.map((a) => [a.rule, a]))
    expect(by.scalar.spectralRadius).toBeCloseTo(1.2, 12)
    expect(by.diagonal.spectralRadius).toBeCloseTo(1.2, 12)
    expect(by.full.spectralRadius).toBeCloseTo(0.8, 12)
    // regularized pinv（J 形式，γ = 0.2、λ_reg = 0.1）：1 − 0.2·σ²/(σ²+0.1)，σ = 3、1 ⇒ 0.8022、0.8182（修正了共模極性）
    expect(by.regularized.ok).toBe(true)
    expect(by.regularized.stable).toBe(true)
    expect(by.regularized.spectralRadius).toBeCloseTo(1 - 0.2 / 1.1, 12)
    // 發散的規則都要附上原因（pole > 1：更新方向相反；且每個 loop 單獨穩定）
    expect(by.scalar.warnings.join(' ')).toMatch(/更新方向相反/)
    expect(by.scalar.warnings.join(' ')).toMatch(/每個 loop 單獨穩定不代表 MIMO 一起穩定/)
  })

  it('有限差分 preset 的 Monte Carlo 設定在 sample 引擎的運算預算內（載入後按 Run 不會被拒絕）', () => {
    const pr = parsePresetParams(load('mimo-fd-jacobian').params)
    expect(pr.params.engine).toBe('sample')
    // burn-in 最多約 6/(−ln ρ)；scalar μK_q = 0.5、λ_min = 0.1 ⇒ ρ = 0.95 ⇒ 117 blocks
    const worstBlocks = pr.params.mcRecord + 200
    expect(estimateSampleCost({ cases: 1, blocks: worstBlocks, N: pr.params.N, chains: pr.params.mcChains })).toBeLessThan(MAX_SAMPLE_BUDGET)
  })

  it('598 / 5 / 65 preset：blocks 與 RMS 與 expected 文字一致', () => {
    const r = analyze('mimo-rho099-598-5-65')
    expect(r.analyses.map((a) => a.blocks95)).toEqual([598, 5, 65])
    const rms = r.analyses.map((a) => Math.sqrt(a.perParamVar![0]))
    expect(rms[0]).toBeCloseTo(1.198, 3)
    expect(rms[1]).toBeCloseTo(8.015, 3)
    expect(rms[2]).toBeCloseTo(2.182, 3)
  })

  it('E37 preset：Monte Carlo（preset 的 chains / record / seed）落在解析值 ±4 SE 內，expected 文字中的區間與計算一致', () => {
    const pr = parsePresetParams(load('mimo-noise-e37').params)
    const mc = runMimoCovarianceMc({
      plant: plantSpecOf(pr.params),
      rule: pr.cases[0],
      jhat: jhatSpecOf(pr.params),
      engine: pr.params.engine,
      chains: pr.params.mcChains,
      recordBlocks: pr.params.mcRecord,
      delta0: delta0Of(pr.params),
      seed: pr.seed,
    })
    expect(mc.ok).toBe(true)
    expect(mc.modeVarClosed![0]).toBeCloseTo(0.64237, 4)
    expect(mc.modeVarClosed![1]).toBeCloseTo(127.8317, 3)
    const tq = studentTInv(0.975, mc.chains - 1)
    for (let i = 0; i < 2; i++) {
      const se = (mc.modeVarHi[i] - mc.modeVarLo[i]) / 2 / tq
      expect(Math.abs(mc.modeVar[i] - mc.modeVarClosed![i]) / se, `mode ${i + 1}`).toBeLessThan(4)
      const seP = (mc.covHi[i][i] - mc.covLo[i][i]) / 2 / tq
      expect(Math.abs(mc.cov[i][i] - 64.237) / seP, `param ${i + 1}`).toBeLessThan(4)
    }
    // expected 文字引用的快模式 95% CI（同 seed 可重現）
    expect(mc.modeVarLo[0]).toBeCloseTo(0.6289, 4)
    expect(mc.modeVarHi[0]).toBeCloseTo(0.6422, 4)
  })

  it('E24 preset：poles −1.5 / 0.003、0.655、0.961', () => {
    const r = analyze('mimo-jhat-mismatch-e24')
    const poles = r.analyses.map((a) => a.poles.map((z) => z.re).sort((x, y) => x - y))
    expect(poles[0][0]).toBeCloseTo(-1.5, 9)
    expect(poles[0][1]).toBeCloseTo(0.003, 3)
    expect(poles[1][1]).toBeCloseTo(0.655, 3)
    expect(poles[2][1]).toBeCloseTo(0.961, 3)
    expect(r.analyses[0].stable).toBe(false)
  })

  it('Sequential 陷阱 preset：平均終值 δ = (−1, 1)、full 失敗、regularized 差模 pole = 1', () => {
    const pr = parsePresetParams(load('mimo-sequential-trap').params)
    const t = runMimoTrajectories({ plant: plantSpecOf(pr.params), cases: pr.cases, delta0: delta0Of(pr.params), blocks: 120, engine: 'linear', jhat: jhatSpecOf(pr.params), seed: pr.seed })
    expect(t.cases[0].meanAnalytic![0][120]).toBeCloseTo(-1, 9)
    expect(t.cases[0].meanAnalytic![1][120]).toBeCloseTo(1, 9)
    expect(t.cases[1].ok).toBe(false)
    expect(t.cases[1].error).toMatch(/不可辨識/)
    const r = analyze('mimo-sequential-trap')
    expect(Math.max(...r.analyses[2].poles.map((z) => z.re))).toBeCloseTo(1, 12)
  })

  it('3×3 preset：λ ≈ 2.214 / 0.736 / 0.050、blocks 119 / 5 / 11、RMS 1.21 / 3.63 / 2.42', () => {
    const r = analyze('mimo-3x3-gos-phos-gain')
    expect(r.modeValues[0]).toBeCloseTo(2.214, 3)
    expect(r.modeValues[1]).toBeCloseTo(0.736, 3)
    expect(r.modeValues[2]).toBeCloseTo(0.05, 3)
    expect(r.modeValues[0] / r.modeValues[2]).toBeCloseTo(44.3, 1)
    expect(r.analyses.map((a) => a.blocks95)).toEqual([119, 5, 11])
    const rms = r.analyses.map((a) => Math.sqrt(a.perParamVar![0]))
    expect(rms[0]).toBeCloseTo(1.21, 2)
    expect(rms[1]).toBeCloseTo(3.63, 2)
    expect(rms[2]).toBeCloseTo(2.42, 2)
  })

  it('有限差分 preset：δ₀ = (40, 0) 的理論 E[Ĵ_n] ≈ [[−0.912, −0.820], …]；δ₀ = 0 時 = −0.9852·R；std ≈ 0.046', () => {
    const pr = parsePresetParams(load('mimo-fd-jacobian').params)
    const plant = buildPlant(plantSpecOf(pr.params))
    const at = resolveJhat(plant, jhatSpecOf(pr.params), delta0Of(pr.params), pr.seed)
    expect(at.info.expected![0][0]).toBeCloseTo(-0.912, 3)
    expect(at.info.expected![0][1]).toBeCloseTo(-0.8205, 3)
    expect(at.info.std![0][0]).toBeCloseTo(0.046, 3)
    const at0 = resolveJhat(plant, jhatSpecOf(pr.params), [0, 0], pr.seed)
    expect(at0.info.expected![0][0]).toBeCloseTo(-0.9852, 4)
    expect(at0.info.expected![0][1]).toBeCloseTo(-0.9852 * 0.9, 4)
  })
})

describe('Ch10 lab state（純函式）', () => {
  it('parsePresetParams：不合法欄位退回預設，P×P 矩陣嵌回 3×3', () => {
    const p = parsePresetParams({ P: 2, R: [[1, 0.5], [0.5, 1]], sigmaV: -3, N: 'x', cases: [{ rule: 'bogus', gamma: 9 }] })
    expect(p.params.sigmaV).toBe(DEFAULT_PARAMS.sigmaV)
    expect(p.params.N).toBe(DEFAULT_PARAMS.N)
    expect(sliceMat(p.params.R, 2)).toEqual([
      [1, 0.5],
      [0.5, 1],
    ])
    expect(p.params.R[2][2]).toBe(1)
    expect(p.cases[0].rule).toBe('scalar')
    expect(p.cases[0].gamma).toBe(0.5)
    expect(p.seed).toBe(20261010)
  })

  it('ellipsePoints：95% 橢圓半軸 = √(5.991 λ)，方向沿 eigenvector', () => {
    const e = ellipsePoints([
      [4, 0],
      [0, 1],
    ])
    const rx = Math.max(...e.x.map(Math.abs))
    const ry = Math.max(...e.y.map(Math.abs))
    expect(rx).toBeCloseTo(Math.sqrt(5.991464547107979 * 4), 6)
    expect(ry).toBeCloseTo(Math.sqrt(5.991464547107979), 2)
    const e2 = ellipsePoints([
      [1, 0.9],
      [0.9, 1],
    ])
    // 長軸沿 [1,1]：x ≈ y 的點距離最大
    const r2 = e2.x.map((x, i) => Math.hypot(x, e2.y[i]))
    const k = r2.indexOf(Math.max(...r2))
    expect(Math.abs(e2.x[k] - e2.y[k])).toBeLessThan(0.05 * r2[k])
  })
})
