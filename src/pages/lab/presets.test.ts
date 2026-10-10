import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_PRESETS, presetsForExperiment } from '@/app/presets'
import type { PresetEntry } from '@/data/types'
import {
  analyzeLab,
  analyzeTraining,
  combineMc,
  convergenceBlocks,
  fcwGrid,
  labParamErrors,
  mcChecks,
  mcSeeds,
  runMcChunk,
  runPipeline,
  sweepFcwChunk,
} from '@/simulation/models/unifiedLab'
import { texifyShared } from './common'
import {
  EXP,
  collectWarnings,
  compareCrossCheck,
  isInformational,
  mcCrossCheck,
  pipelineCrossCheck,
  sanitizeComparePreset,
  sanitizeLabParams,
  sanitizeMcPreset,
  sanitizeSweepPreset,
  sanitizeTrainingPreset,
  summarizeSweep,
  sweepCrossCheck,
  sweepErrors,
  sweepWarnings,
  trainingCrossCheck,
  trainingErrors,
} from './logic'

/**
 * lab-*.json 的每個「預期」都在這裡用模型重算核對（規格 §17 末段：模型公式有錯，UI 卻顯示成功——這種情況要被測試抓到）。
 * 文字裡寫的關鍵數字同時以 expected.includes(…) 檢查，preset 文字與模型不同步時測試會失敗。
 */
const LAB = ALL_PRESETS.filter((p) => p.id.startsWith('lab-'))
const byId = (id: string): PresetEntry => {
  const p = LAB.find((x) => x.id === id)
  if (!p) throw new Error(`找不到 preset ${id}`)
  return p
}
const status = (v: unknown): string => (typeof v === 'string' ? v : (v as { status: string }).status)

interface GoldenVector {
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}
const golden = (id: string): GoldenVector => JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${id}.json`), 'utf8')) as GoldenVector
function expectGolden(v: GoldenVector, key: string, actual: number): void {
  const e = v.expected[key] as number
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  expect(Math.abs(actual - e), `${key}: ${actual} vs ${e}`).toBeLessThanOrEqual((tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e))
}

describe('lab-*.json 的格式', () => {
  it('十個 preset：頁面 /lab、實驗 ID 屬於本頁、來源 simulation、五個分頁各至少一個', () => {
    expect(LAB.map((p) => p.id).sort()).toEqual([
      'lab-compare-regressor',
      'lab-fcw-delay-sign-flip',
      'lab-fixed-point-6bit',
      'lab-mc-t13',
      'lab-near-integer-spur',
      'lab-negative-sum-mode',
      'lab-offset-fixed-point-swing',
      'lab-t13-anchor',
      'lab-training-code-compare',
      'lab-wideband-320mhz',
    ])
    const ids = Object.values(EXP) as string[]
    for (const p of LAB) {
      expect(p.page).toBe('/lab')
      expect(ids).toContain(p.experiment)
      expect(p.source).toBe('simulation')
      expect(p.galleryIndex).toBeUndefined() // 規格 §19.2 的 12 個編號屬於各章
      expect(p.title.length).toBeGreaterThan(6)
      expect(p.description.length).toBeGreaterThan(30)
      expect(p.expected.length).toBeGreaterThan(30)
    }
    for (const id of ids) expect(presetsForExperiment(id).length).toBeGreaterThanOrEqual(1)
  })

  it('每個 preset 都能乾淨地套用：沒有被忽略的欄位、參數合法', () => {
    for (const p of LAB) {
      if (p.experiment === EXP.pipeline) {
        const s = sanitizeLabParams(p.params)
        expect(s.issues, p.id).toEqual([])
        expect(labParamErrors(s.params), p.id).toEqual([])
      } else if (p.experiment === EXP.fcw) {
        const s = sanitizeSweepPreset(p.params)
        expect(s.issues, p.id).toEqual([])
        expect(sweepErrors(s.grid, s.opts, s.base), p.id).toEqual([])
      } else if (p.experiment === EXP.mc) {
        const s = sanitizeMcPreset(p.params)
        expect(s.issues, p.id).toEqual([])
        expect(labParamErrors(s.base), p.id).toEqual([])
      } else if (p.experiment === EXP.training) {
        const s = sanitizeTrainingPreset(p.params)
        expect(trainingErrors(s.shared, s.patterns), p.id).toEqual([])
      } else {
        const s = sanitizeComparePreset(p.params)
        expect(s.issues, p.id).toEqual([])
        for (const c of s.cases) expect(labParamErrors(c), p.id).toEqual([])
      }
    }
  })
})

describe('Pipeline presets：預期文字 vs 模型', () => {
  it('T13: lab-t13-anchor 重現 K、g、p、σ_w（golden）；跨級一致性；mean w 與 σ_w 的檢查通過', () => {
    const p = byId('lab-t13-anchor')
    const prm = sanitizeLabParams(p.params).params
    const a = analyzeLab(prm)
    const v = golden('T13')
    expectGolden(v, 'K_per_fs', a.analytic.K)
    expectGolden(v, 'g', a.analytic.g)
    expectGolden(v, 'p', a.analytic.p)
    expectGolden(v, 'sigma_w_fs', a.analytic.sigmaWPred)
    // 文字裡寫的數字
    expect(p.expected).toContain(a.analytic.Kq.toFixed(7))
    expect(p.expected).toContain(`g = ${a.analytic.g.toFixed(6)}`)
    expect(p.expected).toContain(`p = ${a.analytic.p.toFixed(5)}`)
    expect(p.expected).toContain(`${a.analytic.sigmaWPred.toFixed(4)} fs`)
    expect(p.expected).toContain(`${(a.analytic.fuHz / 1e3).toFixed(4)} kHz`)
    expect(p.expected).toContain(`${(a.bandwidths.exact / 1e3).toFixed(2)} kHz`)
    expect(p.expected).toContain(`${(a.bandwidths.enbw / 1e3).toFixed(2)} kHz`)
    expect(a.analytic.tauBlocks).toBeCloseTo(12.03, 2)
    const r = runPipeline(prm)
    expect(r.replay?.maxAbsDiffG).toBe(0)
    expect(r.checks.meanW.status).toBe('ok')
    expect(r.checks.sigmaW.status).toBe('ok')
    expect(Math.abs(r.metrics.meanW - 3)).toBeLessThan(4 * 0.062)
    expect(status(pipelineCrossCheck(r).analytic)).toBe('ok')
    expect(collectWarnings(r).filter((w) => !isInformational(w.text))).toEqual([])
    // 白雜訊的輸出：不報任何 tone（雜訊 PSD 的最高點不是 spur）
    expect(p.expected).toContain('tone 表是空的')
    expect(r.output!.tones).toHaveLength(0)
    expect(r.meanModel).toBe('mean-field')
  }, 60_000)

  it('lab-offset-fixed-point-swing：固定點隨 block 擺動；單一 w* 的線性模型對不上、mean-field 平均軌跡對得上（F-LAB.18）', () => {
    const p = byId('lab-offset-fixed-point-swing')
    const prm = sanitizeLabParams(p.params).params
    const r = runPipeline(prm)
    const sw = r.fixedPointSwing!
    // 文字裡寫的數字
    expect(p.expected).toContain(`w* ≈ ${r.analytic.wStarMeanField.toFixed(2).replace('-', '−')} fs`)
    expect(p.expected).toContain(`後半段平均是 ${r.metrics.meanW.toFixed(2).replace('-', '−')} fs`)
    expect(p.expected).toContain(`${sw.min.toFixed(2).replace('-', '−')} 到 ${sw.max.toFixed(2).replace('-', '−')} fs`)
    expect(p.expected).toContain(`幅度約 ${(sw.max - sw.min).toFixed(2)} fs`)
    expect(p.expected).toContain(`σ_w 預測 ${r.analytic.sigmaWPred.toFixed(3)} fs`)
    expect(p.expected).toContain(`同段預測是 ${r.checks.meanW.analytic!.toFixed(2).replace('-', '−')} fs`)
    expect((sw.max - sw.min) / r.analytic.sigmaWPred).toBeGreaterThan(4)
    // 交叉比對：mean-field 軌跡 ⇒ 兩項都一致；線性時不變模型（常數 w*）的同段預測差了 0.8 fs 以上
    expect(r.meanModel).toBe('mean-field')
    expect(r.checks.meanW.status).toBe('ok')
    expect(r.checks.sigmaW.status).toBe('ok')
    expect(status(pipelineCrossCheck(r).analytic)).toBe('ok')
    const last = r.blocks.k.length - 1
    expect(r.blocks.wLinearModel[last]).toBeCloseTo(r.analytic.wStarMeanField, 6)
    expect(Math.abs(r.metrics.meanW - r.blocks.wLinearModel[last])).toBeGreaterThan(0.8)
    expect(collectWarnings(r).some((w) => w.text.includes('固定點不是常數'))).toBe(true)
    // 「試著改」的三個說法
    const noOffset = runPipeline({ ...prm, compOffsetFs: 0 })
    expect(noOffset.fixedPointSwing!.max - noOffset.fixedPointSwing!.min).toBeLessThan(1e-9)
    const mash = runPipeline({ ...prm, codeSource: 'mash111' })
    expect(mash.fixedPointSwing!.max - mash.fixedPointSwing!.min).toBeLessThan(0.02)
    const std = runPipeline({ ...prm, normalization: 'standardize' })
    expect(std.fixedPointSwing!.max - std.fixedPointSwing!.min).toBeCloseTo(6.8, 0)
    expect(Math.abs(std.metrics.meanW - 3)).toBeLessThan(0.5)
    expect(std.checks.meanW.status).toBe('ok')
  }, 120_000)

  it('T14: lab-t13-anchor 的 f_u、exact −3 dB、ENBW 等於 golden vector', () => {
    const a = analyzeLab(sanitizeLabParams(byId('lab-t13-anchor').params).params)
    const v = golden('T14')
    expectGolden(v, 'f_u_hz', a.analytic.fuHz)
    expectGolden(v, 'bw_exact_3db_hz', a.bandwidths.exact)
    expectGolden(v, 'enbw_one_sided_hz', a.bandwidths.enbw)
    expectGolden(v, 'bw_neg_ln_p_hz', a.bandwidths.negLnP)
    expectGolden(v, 'bw_one_minus_p_hz', a.bandwidths.oneMinusP)
  })

  it('T15: lab-near-integer-spur——C 崩塌、τ ≈ 1036、λ_min ≈ 0 的警告；fractional spur 的 toneFit 與封閉式相差 < 1 dB', () => {
    const p = byId('lab-near-integer-spur')
    const prm = sanitizeLabParams(p.params).params
    const r = runPipeline(prm)
    expect(r.analytic.Cest).toBeCloseTo(0.0121, 3)
    expect(p.expected).toContain(`C ≈ ${r.analytic.Cest.toFixed(4)}`)
    expect(Math.round(r.analytic.tauBlocks)).toBe(1036)
    expect(p.expected).toContain(`τ ≈ ${Math.round(r.analytic.tauBlocks)} blocks`)
    expect(p.expected).toContain(`σ_w 預測 ≈ ${r.analytic.sigmaWPred.toFixed(2)} fs`)
    expect(r.code.fracToneHz / 1e3).toBeCloseTo(400.5, 1)
    const o = r.output!
    expect(o.toneClosedForm).not.toBeNull()
    expect(Math.abs(o.toneFitSim!.dbc - o.toneClosedForm!.dbc)).toBeLessThan(1)
    expect(r.checks.spur.status).toBe('ok')
    expect(o.toneFitSim!.dbc).toBeGreaterThan(-95) // 此 seed 約 −81 dBc；殘差由 σ_w ≈ 3.6 fs 的抖動主導
    expect(o.toneFitSim!.dbc).toBeLessThan(-70)
    const gmac = r.stages.find((s) => s.id === 'gmac')!
    expect(gmac.warnings.some((w) => w.includes('\\lambda_{\\min}') && w.includes('Persistent Excitation'))).toBe(true)
    // Run-to-Convergence：需要的 block 數超過上限，說明原因
    const c = convergenceBlocks(r.analytic, prm)
    expect(c.needed).toBeGreaterThan(15000)
    expect(c.blocks).toBe(8192)
    expect(c.reason).toContain('超過上限')
    expect(r.replay?.maxAbsDiffG).toBe(0)
  }, 60_000)

  it('lab-wideband-320mhz：DT 的 −3 dB 與設計值差 > 10%（E44 警告）；C > 1；輸出 RMS 比 2 MHz 時大兩個數量級', () => {
    const p = byId('lab-wideband-320mhz')
    const prm = sanitizeLabParams(p.params).params
    const r = runPipeline(prm)
    expect(r.pll.wnTs).toBeCloseTo(0.245, 3)
    expect(p.expected).toContain(`${(r.pll.f3dbTHz / 1e6).toFixed(1)} MHz`)
    expect(r.pll.warnings.some((w) => w.includes('E44'))).toBe(true)
    expect(collectWarnings(r).some((w) => w.stage.includes('PLL') && w.text.includes('E44'))).toBe(true)
    expect(p.expected).toContain(`C ≈ ${r.analytic.Cest.toFixed(2)}`)
    expect(r.analytic.Cest).toBeGreaterThan(1.1)
    expect(r.analytic.tauBlocks).toBeCloseTo(9.8, 1)
    expect(p.expected).toContain(`σ_w 預測 ≈ ${r.analytic.sigmaWPred.toFixed(3)} fs`)
    expect(r.output!.rmsOut).toBeGreaterThan(0.08)
    expect(r.output!.rmsOut).toBeLessThan(0.15)
    const narrow = runPipeline({ ...prm, pllBwHz: 2e6 })
    expect(r.output!.rmsOut / narrow.output!.rmsOut).toBeGreaterThan(100)
    expect(narrow.output!.rmsOut).toBeLessThan(1e-3)
    expect(r.replay?.maxAbsDiffG).toBe(0)
  }, 60_000)

  it('lab-fixed-point-6bit：L5；定點 vs 同 seed 浮點相差 ≪ 1 LSB；沒有飽和；code 持續 toggle（雜訊就是 dither）', () => {
    const p = byId('lab-fixed-point-6bit')
    const prm = sanitizeLabParams(p.params).params
    const r = runPipeline(prm)
    expect(r.modelLevel).toBe('L5')
    expect(r.loopLevel).toBe('L5')
    expect(r.checks.fixedPoint.status).toBe('ok')
    expect(Math.abs(r.metrics.meanWPhys - r.floatTwin!.meanW)).toBeLessThan(0.1 * prm.lsbFs)
    expect(r.metrics.saturationCount).toBe(0)
    expect(r.metrics.wrapCount).toBe(0)
    expect(r.metrics.limitCycleCount).toBeGreaterThan(200)
    expect(status(pipelineCrossCheck(r).fixedPoint)).toBe('ok')
    // what-if 的目標：浮點收斂值 ÷ LSB ≈ 24.8
    const target = r.floatTwin!.meanW / prm.lsbFs
    expect(target).toBeCloseTo(24.8, 1)
    expect(Math.round(target) - target).toBeCloseTo(0.17, 1) // freeze 的靜態誤差（LSB）
    // 文字裡的後續操作：σ_v = 2、μ = 0.2 ⇒ LSB ≫ σ_w 的警告
    const tight = runPipeline({ ...prm, sigmaV: 2, muFs: 0.2 })
    expect(tight.warnings.some((w) => w.includes('LSB') && w.includes('量化誤差主導'))).toBe(true)
    expect(tight.checks.sigmaW.status).toBe('n/a')
  }, 60_000)

  it('T13: lab-negative-sum-mode（反面測試：N 改變卻忘記 scaling）——g × N、警告說明原因、交叉比對不硬給結論', () => {
    const p = byId('lab-negative-sum-mode')
    const prm = sanitizeLabParams(p.params).params
    const r = runPipeline(prm)
    expect(r.analytic.g).toBeGreaterThan(300)
    expect(p.expected).toContain(`g ≈ ${r.analytic.g.toFixed(1)}`)
    expect(p.expected).toContain(`pole ≈ −${Math.abs(r.analytic.p).toFixed(1)}`)
    const all = collectWarnings(r)
    const sum = all.find((w) => w.text.includes('gm_mode=sum'))!
    expect(sum.stage).toContain('GMAC')
    expect(texifyShared(sum.text)).toContain('$\\mu /N = 0.002441$')
    expect(all.some((w) => w.text.includes('g ≥ 2'))).toBe(true)
    expect(all.some((w) => w.text.includes('limit cycle'))).toBe(true)
    expect(r.metrics.diverged).toBe(false)
    expect(r.metrics.stdW).toBeGreaterThan(1000)
    expect(r.checks.meanW.status).toBe('n/a')
    expect(r.checks.sigmaW.status).toBe('n/a')
    expect(r.checks.replay.status).toBe('ok')
    expect(status(pipelineCrossCheck(r).analytic)).toBe('n/a')
    expect(convergenceBlocks(r.analytic, prm).blocks).toBeNull()
    expect(convergenceBlocks(r.analytic, prm).reason).toContain('sum 模式要再除以 $N$')
  }, 60_000)
})

describe('第 7 節「試試看」清單裡的數字', () => {
  it('一階 DSM、frac = 0.01：unit_rms 時 C ≈ 0.25、τ ≈ 50、x̄ ≈ −0.87，gain-noise 輸出約 0.3 fs；standardize 後 C ≈ 1、輸出小一個數量級以上', () => {
    const base = sanitizeLabParams({ codeSource: 'dsm_first_order', frac: 0.01 }).params
    const a = runPipeline(base)
    const b = runPipeline({ ...base, normalization: 'standardize' })
    expect(a.analytic.Cest).toBeCloseTo(0.25, 2)
    expect(a.analytic.tauBlocks).toBeCloseTo(50, 0)
    expect(a.output!.xMean).toBeCloseTo(-0.87, 2)
    expect(a.output!.rmsNoise).toBeGreaterThan(0.2)
    expect(a.output!.rmsNoise).toBeLessThan(0.45)
    expect(b.analytic.Cest).toBeCloseTo(1.0, 2)
    expect(a.output!.rmsNoise / b.output!.rmsNoise).toBeGreaterThan(10)
    // 預設（MASH）的輸出 RMS < 1e-3 fs、τ ≈ 12
    const d = runPipeline(sanitizeLabParams({}).params)
    expect(d.output!.rmsOut).toBeLessThan(1e-3)
    expect(d.analytic.tauBlocks).toBeCloseTo(12, 0)
    expect(d.checks.replay.status).toBe('ok')
  }, 60_000)
})

describe('FCW sweep preset', () => {
  it('lab-fcw-delay-sign-flip：25 點中 14 點 C ≤ 0（含最接近整數的 6 點）；raw 時 0 個 sign flip 但近整數 6 點 λ_min ≈ 0', () => {
    const p = byId('lab-fcw-delay-sign-flip')
    const s = sanitizeSweepPreset(p.params)
    const fracs = fcwGrid(s.grid.min, s.grid.max, s.grid.points, s.grid.scale)
    expect(fracs).toHaveLength(25)
    const pts = sweepFcwChunk({ base: s.base, fracs, opts: s.opts, offset: 0 }).points
    const sum = summarizeSweep(pts, s.opts.loopBlocks)
    expect(p.expected).toContain(`有 ${sum.flips.length} 個 C ≤ 0`)
    expect(sum.flips.length).toBe(14)
    expect(pts.slice(0, 6).every((x) => x.signFlip)).toBe(true)
    expect(p.expected).toContain(`min C ≈ −${Math.abs(sum.minC).toFixed(3)}`)
    expect(p.expected).toContain(`max ρ ≈ ${sum.maxRho.toFixed(3)}`)
    const w = sweepWarnings(sum, s.opts)
    expect(w[0]).toContain('14 個 FCW')
    expect(status(sweepCrossCheck(pts, s.opts, false).monteCarlo)).toBe('ok')
    // 文字裡的後續操作：regressor 改回 raw
    const raw = sweepFcwChunk({ base: { ...s.base, regressor: 'raw' }, fracs, opts: { ...s.opts, slopeMc: false }, offset: 0 }).points
    const sr = summarizeSweep(raw, s.opts.loopBlocks)
    expect(sr.flips).toHaveLength(0)
    expect(sr.noPe).toHaveLength(6)
    expect(sr.noPe.every((x) => x.frac <= 1e-4)).toBe(true)
    expect(sweepWarnings(sr, s.opts).some((x) => x.includes('\\lambda_{\\min}\\approx0') && x.includes('不可辨識'))).toBe(true)
  }, 120_000)
})

describe('Monte Carlo preset', () => {
  it('T13: lab-mc-t13——16 個 seeds：σ_w 的 CI 涵蓋 0.3992 fs、mean w 的 CI 涵蓋 3 fs、沒有發散', () => {
    const p = byId('lab-mc-t13')
    const s = sanitizeMcPreset(p.params)
    expect(s.runs).toBe(16)
    const chunks = [0, 4, 8, 12].map((i) => runMcChunk({ base: s.base, seeds: mcSeeds(s.base.seed, i, 4), meanField: i === 0 }))
    const sum = combineMc(chunks)
    const c = mcChecks(sum, chunks[0].analytic, s.base, chunks[0].meanField)
    expect(c.lin.model).toBe('mean-field')
    expect(p.expected).toContain('mean-field 平均軌跡的同段預測')
    expect(sum.runs).toBe(16)
    expect(sum.diverged).toBe(0)
    expect(c.meanW.status).toBe('ok')
    expect(c.sigmaW.status).toBe('ok')
    expect(sum.sigmaW.lo).toBeLessThan(0.3992)
    expect(sum.sigmaW.hi).toBeGreaterThan(0.3992)
    expect(sum.meanW.lo).toBeLessThan(3)
    expect(sum.meanW.hi).toBeGreaterThan(3)
    const cc = mcCrossCheck(c, false)
    expect(status(cc.analytic)).toBe('ok')
    expect(status(cc.monteCarlo)).toBe('ok')
  }, 120_000)
})

describe('Training preset', () => {
  it('lab-training-code-compare：三組滿秩；條件數 A > C > B；A 有 fractional tone、B 沒有、C 較低；開 offset 後秩少 1（E04）', () => {
    const p = byId('lab-training-code-compare')
    const s = sanitizeTrainingPreset(p.params)
    const r = analyzeTraining({ ...s.shared, patterns: s.patterns })
    const [A, B, C] = r.patterns
    expect([A.rank, B.rank, C.rank]).toEqual([3, 3, 3])
    expect(p.expected).toContain(`A ≈ ${Math.round(A.condScaled)}、B ≈ ${Math.round(B.condScaled)}、C ≈ ${Math.round(C.condScaled)}`)
    expect(A.condScaled).toBeGreaterThan(C.condScaled)
    expect(C.condScaled).toBeGreaterThan(B.condScaled)
    expect(A.tones[0].dbc).toBeCloseTo(-114, 0)
    expect(A.tones[0].fHz / 1e6).toBeCloseTo(4.0, 1)
    expect(B.tones).toHaveLength(0)
    // C（加上 overlay）：同樣的 Δa 下 tone 低 5–6 dB；降幅來自正規化的 scale（鋸齒本身沒有變小）
    expect(C.tones.length).toBeGreaterThan(0)
    expect(A.tones[0].dbc - C.tones[0].dbc).toBeGreaterThan(5)
    expect(A.tones[0].dbc - C.tones[0].dbc).toBeLessThan(6.5)
    expect(p.expected).toContain(`${A.rawStd.toFixed(3)} → ${C.rawStd.toFixed(3)} T_vco`)
    expect(C.rawStd / A.rawStd).toBeCloseTo(Math.sqrt(5), 1) // Var：1/12 → 1/12 + 1/3
    expect(Math.abs(C.tones[0].fHz - A.tones[0].fHz)).toBeLessThan(2 * (4e9 / (1 << 15))) // 同一根譜線（α_eff·f_ref）
    expect(A.closedForm).not.toBeNull()
    expect(status(trainingCrossCheck(r).analytic)).toBe('ok')
    expect(status(trainingCrossCheck(r).monteCarlo)).toBe('not-implemented')
    expect(C.warnings.some((w) => w.includes('研究延伸'))).toBe(true)
    // 開 offset 基底：結構性不可辨識
    const r2 = analyzeTraining({ ...s.shared, basis: { ...s.shared.basis, offset: true }, patterns: s.patterns })
    for (const q of r2.patterns) {
      expect(q.rank).toBe(3)
      expect(q.basisNames).toHaveLength(4)
      expect(q.warnings.some((w) => w.includes('E04'))).toBe(true)
    }
  }, 120_000)
})

describe('Compare preset', () => {
  it('lab-compare-regressor：raw 收斂、delayed（D = 64）極性錯誤漂走、filtered-x 收斂；三者的 replay 都一致', () => {
    const p = byId('lab-compare-regressor')
    const s = sanitizeComparePreset(p.params)
    expect(s.cases.map((c) => c.regressor)).toEqual(['raw', 'delayed', 'filtered'])
    const [A, B, C] = s.cases.map((c) => runPipeline(c))
    expect(A.analytic.Cest).toBeCloseTo(1.0, 2)
    expect(C.analytic.Cest).toBeCloseTo(1.0, 2)
    expect(B.analytic.Cest).toBeCloseTo(-0.39, 2)
    expect(p.expected).toContain(`C ≈ −${Math.abs(B.analytic.Cest).toFixed(2)}`)
    expect(A.analytic.tauBlocks).toBeCloseTo(12, 0)
    expect(Math.abs(A.metrics.bias)).toBeLessThan(0.3)
    expect(Math.abs(C.metrics.bias)).toBeLessThan(0.3)
    expect(Math.abs(B.metrics.bias)).toBeGreaterThan(1000)
    expect(collectWarnings(B).some((w) => w.text.startsWith('C ≤ 0：更新極性錯誤'))).toBe(true)
    for (const r of [A, B, C]) expect(r.checks.replay.status).toBe('ok')
    const cc = compareCrossCheck([A, B, C].map((r, i) => ({ id: 'ABC'[i], cc: pipelineCrossCheck(r) })))
    expect(status(cc.analytic)).toBe('n/a') // B 沒有可比的迴路預測 ⇒ 整欄不亮綠燈，並點名 Case B
    expect((cc.analytic as { note: string }).note).toContain('Case B')
    const ok = compareCrossCheck([A, C].map((r, i) => ({ id: 'AC'[i], cc: pipelineCrossCheck(r) })))
    expect(status(ok.analytic)).toBe('ok')
  }, 120_000)
})
