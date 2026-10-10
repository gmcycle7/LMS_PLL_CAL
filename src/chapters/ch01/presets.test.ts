import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PresetEntry } from '@/data/types'
import {
  fixedXStability,
  generateLossData,
  playgroundEnsemble,
  playgroundTrace,
  playgroundVarW,
  playgroundVarWStationary,
  lmsSteadyState,
  populationOptima,
  runVariantOnData,
  signErrorFixedPointRun,
  signErrorJitterApprox,
  signErrorLatticeStationary,
  timeAverage,
  type LossDataParams,
} from '@/simulation/models/lossCompare'
import { MSE_MAE_DEFAULTS, sanitizeMseMaeParams } from './experiments/MseMaeLab'
import { PLAYGROUND_DEFAULTS, sanitizePlaygroundParams } from './experiments/LmsPlayground'
import { FORMULAS } from './formulas'

const DIR = resolve(process.cwd(), 'src/data/presets')
const mine = readdirSync(DIR).filter((f) => /^(lms-playground|mse-mae).*\.json$/.test(f))
const load = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as PresetEntry
const byId = (id: string) => load(`${id}.json`)

function playground(id: string) {
  const p = byId(id)
  const params = { ...PLAYGROUND_DEFAULTS, ...sanitizePlaygroundParams(p.params) }
  return { params, seed: Number(p.params.seed ?? 20261010) }
}

function lab(id: string): { data: LossDataParams; mu: number; w0: number; tie: 'zero' | 'plus' | 'minus'; huberDelta: number } {
  const p = byId(id)
  const q = { ...MSE_MAE_DEFAULTS, ...sanitizeMseMaeParams(p.params) }
  return {
    data: {
      model: q.model,
      a: q.a,
      xDist: q.xDist,
      xScale: q.xScale,
      sigma: q.sigma,
      outlierProb: q.outlierProb,
      outlierSize: q.outlierSize,
      outlierSign: q.outlierSign,
      n: q.n,
      seed: Number(p.params.seed ?? 7),
    },
    mu: q.mu,
    w0: q.w0,
    tie: q.tie,
    huberDelta: q.huberDelta,
  }
}

describe('Ch01 presets 與公式登錄', () => {
  it('每個 preset 都符合 PresetEntry、指向本章實驗、id 與檔名一致', () => {
    expect(mine.length).toBeGreaterThanOrEqual(10)
    for (const f of mine) {
      const p = load(f)
      expect(`${p.id}.json`).toBe(f)
      expect(p.page).toBe('/ch/01')
      expect(['lms-playground', 'mse-vs-mae']).toContain(p.experiment)
      expect(typeof p.title).toBe('string')
      expect(typeof p.description).toBe('string')
      expect(typeof p.expected).toBe('string')
      expect(['illustrative', 'simulation', 'literature', 'measured']).toContain(p.source)
      expect(p.params && typeof p.params).toBe('object')
    }
    const gallery = mine.map(load).filter((p) => p.galleryIndex !== undefined)
    expect(gallery.map((p) => p.galleryIndex)).toEqual([1])
  })

  it('T01: Gallery preset #1（w₀=1, a=3, x=2, μ=0.1）重現 w₁ = 1.8、w₂ = 2.28、p = 0.6', () => {
    const { params, seed } = playground('lms-playground-hand')
    const tr = playgroundTrace({ ...params, seed })
    expect(tr.w[1]).toBeCloseTo(1.8, 12)
    expect(tr.w[2]).toBeCloseTo(2.28, 12)
    expect(fixedXStability(params.mu, params.x).pole).toBeCloseTo(0.6, 15)
  })

  it('T02: deadbeat / oscillating / boundary / divergent presets 的行為與 pole 一致', () => {
    const cases: [string, string][] = [
      ['lms-playground-deadbeat', 'deadbeat'],
      ['lms-playground-oscillating', 'oscillating'],
      ['lms-playground-boundary', 'boundary'],
      ['lms-playground-divergent', 'divergent'],
      ['lms-playground-slow', 'monotone'],
    ]
    for (const [id, beh] of cases) {
      const { params } = playground(id)
      expect(fixedXStability(params.mu, params.x).behaviour).toBe(beh)
    }
    const { params, seed } = playground('lms-playground-divergent')
    const tr = playgroundTrace({ ...params, seed })
    expect(Math.abs(tr.delta[30])).toBeCloseTo(2 * 1.4 ** 30, 6)
  })

  it('noisy preset：穩態 Var = 0.0625，MC 在 4·SE 內', () => {
    const { params, seed } = playground('lms-playground-noisy')
    expect(playgroundVarWStationary(params.mu, params.x, params.noiseSigma)).toBeCloseTo(0.0625, 14)
    const mc = playgroundEnsemble({ ...params, seed, paths: 800 })
    expect(Math.abs(mc.varW - 0.0625)).toBeLessThan(4 * mc.seVar)
    // 頁面實際使用的設定（400 條路徑、preset seed）：crossCheck 的 monteCarlo 欄應為 ok
    const ui = playgroundEnsemble({ ...params, seed, paths: 400 })
    expect(Math.abs(ui.varW - playgroundVarW(params.mu, params.x, params.noiseSigma, params.steps))).toBeLessThan(4 * ui.seVar)
  })

  it('mse-mae presets 的 expected 文字與計算一致', () => {
    // four_point：LMS std ≈ 1.443、定點 Sign-Error → μ/2
    const fp = lab('mse-mae-four-point')
    const d = generateLossData(fp.data)
    const lmsTa = timeAverage(runVariantOnData('conventional', d, fp).w)
    expect(Math.abs(lmsTa.mean - 2.5)).toBeLessThan(4 * lmsTa.se)
    expect(signErrorLatticeStationary(fp.data, fp)!.mean).toBeCloseTo(fp.mu / 2, 12)
    // comparator tie：lattice = μ
    const cp = lab('mse-mae-four-point-comparator')
    expect(signErrorLatticeStationary(cp.data, cp)!.mean).toBeCloseTo(cp.mu, 12)
    const fx = signErrorFixedPointRun(generateLossData(cp.data), cp)!
    const ta = timeAverage(fx.w)
    expect(Math.abs(ta.mean - cp.mu)).toBeLessThan(4 * ta.se + 0.02)
    // DC + outlier：L2 = 5、L1 = 3.1397
    const dc = lab('mse-mae-outliers-dc')
    const o = populationOptima(dc.data, dc.huberDelta)
    expect(o.l2).toBeCloseTo(5, 12)
    expect(o.l1.lo).toBeCloseTo(3.1397, 4)
    // 零均值 x：三者 = a
    const rg = lab('mse-mae-outliers-regression')
    expect(populationOptima(rg.data, rg.huberDelta)).toMatchObject({ l2: 3, huber: 3 })
    // ±1 code：lattice 與定點 MC 一致
    const pm = lab('mse-mae-pm1-codes')
    const lat = signErrorLatticeStationary(pm.data, pm)!
    const fpm = timeAverage(signErrorFixedPointRun(generateLossData(pm.data), pm)!.w)
    expect(Math.abs(fpm.mean - lat.mean)).toBeLessThan(4 * fpm.se + 0.01)
  })

  it('mse-mae presets 的 expected 文字中「抖動」的數字（審查修正：Sign-Error 的 std 不是 μ|x|）', () => {
    // four_point：點質量 ⇒ std = (√3/2)μ ≈ 0.173
    const fp = lab('mse-mae-four-point')
    expect(signErrorLatticeStationary(fp.data, fp)!.std).toBeCloseTo((Math.sqrt(3) / 2) * fp.mu, 9)
    expect(signErrorJitterApprox(fp.data, fp.mu).applicable).toBe(false)
    // DC + outlier：lattice 精確 std ≈ 0.19 ≈ √(μ/(4f))，是 μ = 0.05 的近 4 倍
    const dc = lab('mse-mae-outliers-dc')
    const lat = signErrorLatticeStationary(dc.data, dc)!
    const ap = signErrorJitterApprox(dc.data, dc.mu)
    expect(lat.std).toBeGreaterThan(0.185)
    expect(lat.std).toBeLessThan(0.195)
    expect(Math.abs(Math.sqrt(ap.variance) / lat.std - 1)).toBeLessThan(0.02)
    expect(lat.std / dc.mu).toBeGreaterThan(3.5)
    expect(Math.abs(lat.mean - populationOptima(dc.data, dc.huberDelta).l1.lo)).toBeLessThan(dc.mu) // 時間平均仍在中位數 ± μ 內
    // 零均值 Gaussian x：LMS std ≈ 0.48、Sign-Error 擴散近似 ≈ 0.057；平均窗口夠長（≥ 20τ）才可檢定
    const rg = lab('mse-mae-outliers-regression')
    const ss = lmsSteadyState(rg.data, rg.mu)
    expect(Math.sqrt(ss.variance)).toBeCloseTo(0.479, 2)
    expect(Math.sqrt(signErrorJitterApprox(rg.data, rg.mu).variance)).toBeCloseTo(0.0574, 3)
    expect(rg.data.n / 2).toBeGreaterThanOrEqual(20 * ss.tauMean)
    // ±1 code：std ≈ 0.19
    const pm = lab('mse-mae-pm1-codes')
    expect(signErrorLatticeStationary(pm.data, pm)!.std).toBeCloseTo(0.188, 2)
  })

  it('mse-mae-noise-free-tie preset（勘誤 E40 的數值證據）：定點凍結在 3；IEEE 在 {2.8, 3.0000000000000004} 來回，時間平均 2.9 仍在 μ|x| 內', () => {
    const q = lab('mse-mae-noise-free-tie')
    const d = generateLossData(q.data)
    const fx = signErrorFixedPointRun(d, q)!
    expect(fx.w[fx.w.length - 1]).toBe(3)
    expect(timeAverage(fx.w).std).toBe(0)
    const ieee = runVariantOnData('sign_error', d, q).w
    expect(new Set(Array.from(ieee.slice(-6))).has(3.0000000000000004)).toBe(true)
    expect(timeAverage(ieee).mean).toBeCloseTo(2.9, 2) // 後半段 201 筆（奇數）⇒ 2.9005
    const lat = signErrorLatticeStationary(q.data, q)!
    expect(lat.mean).toBeCloseTo(3, 12)
    expect(Math.abs(timeAverage(ieee).mean - lat.mean)).toBeLessThanOrEqual(q.mu * 2) // μ|x| = 0.2
    // Conventional LMS 無雜訊：精確收斂到 a
    const lms = runVariantOnData('conventional', d, q).w
    expect(lms[lms.length - 1]).toBeCloseTo(3, 12)
    expect(lmsSteadyState(q.data, q.mu).variance).toBe(0)
  })

  it('公式 ID 唯一且格式為 F-01.x', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^F-01\.\d+$/)
  })
})
