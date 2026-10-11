import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateMetric } from '@/components'
import { createRng } from '@/simulation/core'
import type { PresetEntry } from '@/data/types'
import {
  SPEC_15_3_EXAMPLE,
  analyzeBlockLms,
  runBlockLms,
  runBlockLmsMonteCarlo,
  type BlockLmsConfigInput,
  type BlockLmsResult,
} from '@/simulation/models/blockLms'
import { SPEC_NUMBERS } from '../refNumbers'
import { UNICODE_MATH, outsideMath } from './modelText'
import {
  AUTO_RUN_MAX_SAMPLES,
  EXPERIMENT_ID,
  SPEC_EXAMPLE_TEXT,
  PAGE_ASSUMPTIONS,
  analyticRows,
  ar1EffectiveSamples,
  ar1RelSeStd,
  ar1SeMean,
  buildMetricRows,
  crossCheckOf,
  decimate,
  exportColumns,
  filledDefaultPaths,
  labAssumptions,
  labWarnings,
  modelLevelOf,
  presetConfigText,
  setConfigPath,
  shortLabel,
  shortLabelTex,
  summarizeParams,
  tailHistogram,
  tailStats,
  texNumber,
  validateConfigText,
} from './jsonLabModel'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function vec(name: string): Vector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as Vector
}

function golden(v: Vector, key: string, actual: number): void {
  const e = v.expected[key] as number
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e)
  expect(Math.abs(actual - e), `${key}: |${actual} − ${e}| ≤ ${bound}`).toBeLessThanOrEqual(bound)
}

const presetDir = resolve(process.cwd(), 'src/data/presets')
const PRESETS: PresetEntry[] = readdirSync(presetDir)
  .filter((f) => f.startsWith('block-lms-json') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(presetDir, f), 'utf8')) as PresetEntry)

function presetCfg(id: string): BlockLmsConfigInput {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`preset ${id} 不存在`)
  return (p.params as { config: BlockLmsConfigInput }).config
}

const runCache = new Map<string, BlockLmsResult>()
function runPreset(id: string): BlockLmsResult {
  const hit = runCache.get(id)
  if (hit) return hit
  const r = runBlockLms(presetCfg(id))
  runCache.set(id, r)
  return r
}

describe('JSON 文字驗證與修改', () => {
  it('§15.3 原文合法，並列出由預設補上的擴充欄位', () => {
    const v = validateConfigText(SPEC_EXAMPLE_TEXT)
    expect(v.ok).toBe(true)
    expect(v.totalSamples).toBe(4096 * 2000)
    expect(v.filled).toEqual(expect.arrayContaining(['num_blocks', 'regressor_mode', 'filtered_x_model', 'dtc_nonlinearity', 'record', 'gain_register.quantize_physical', 'gain_register.lsb_fs', 'gain_register.signed']))
    expect(v.filled).not.toContain('gm_mode')
    expect(v.totalSamples).toBeLessThanOrEqual(AUTO_RUN_MAX_SAMPLES)
  })

  it('反面：壞 JSON、未知 enum、型別錯誤、超過總樣本上限都回傳繁體中文錯誤（欄位路徑：原因）', () => {
    const bad = validateConfigText('{ "gm_mode": ')
    expect(bad.ok).toBe(false)
    expect(bad.errors[0]).toMatch(/^JSON 格式錯誤/)
    const e1 = validateConfigText(JSON.stringify({ ...SPEC_15_3_EXAMPLE, gm_mode: 'avg' }))
    expect(e1.errors.some((e) => e.startsWith('gm_mode：') && e.includes("'average' | 'sum'") && e.includes("'avg'"))).toBe(true)
    const e2 = validateConfigText(JSON.stringify({ ...SPEC_15_3_EXAMPLE, gm_accum_samples: 4096.5 }))
    expect(e2.errors.some((e) => e.startsWith('gm_accum_samples：') && e.includes('整數'))).toBe(true)
    const e3 = validateConfigText(JSON.stringify({ ...SPEC_15_3_EXAMPLE, gm_accum_samples: 1 << 20, num_blocks: 1000 }))
    expect(e3.errors.some((e) => e.startsWith('num_blocks：') && e.includes('超過上限'))).toBe(true)
    const e4 = validateConfigText(JSON.stringify({ ...SPEC_15_3_EXAMPLE, foo: 1 }))
    expect(e4.errors.some((e) => e.includes('未知的欄位') && e.includes('foo'))).toBe(true)
    expect(validateConfigText('   ').ok).toBe(false)
  })

  it('setConfigPath 取代指定路徑、建立缺少的物件；非物件 JSON 回傳 null', () => {
    const t = setConfigPath(SPEC_EXAMPLE_TEXT, ['gain_register', 'quantize_physical'], true)
    expect(t).not.toBeNull()
    const v = validateConfigText(t as string)
    expect(v.ok && v.config?.gain_register.quantize_physical).toBe(true)
    expect(v.config?.gain_register.internal_bits).toBe(20)
    const t2 = setConfigPath('{}', ['filtered_x_model', 'gain_mismatch'], 0.5)
    expect(JSON.parse(t2 as string)).toEqual({ filtered_x_model: { gain_mismatch: 0.5 } })
    expect(setConfigPath('[1,2]', ['a'], 1)).toBeNull()
    expect(setConfigPath('{oops', ['a'], 1)).toBeNull()
    expect(filledDefaultPaths({ a: 1 }, { a: 1, b: { c: 2 } })).toEqual(['b'])
  })

  it('preset 檔：experiment / page 正確、JSON 合法，且模型層級與 runBlockLms 一致', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(10)
    for (const p of PRESETS) {
      expect(p.experiment).toBe(EXPERIMENT_ID)
      expect(p.page).toBe('/models')
      const text = presetConfigText(p.params)
      expect(text, p.id).not.toBeNull()
      const v = validateConfigText(text as string)
      expect(v.errors, p.id).toEqual([])
      const r = runPreset(p.id)
      expect(modelLevelOf(v.config!), p.id).toBe(r.modelLevel)
      expect(Object.values(summarizeParams(v.config!)).every((x) => ['string', 'number', 'boolean'].includes(typeof x))).toBe(true)
    }
  }, 120000)
})

describe('解析數字對 golden（§15.3 範例）', () => {
  it('T13: §15.3 原文的 K_q、g、p、σ_w 與 golden T13 一致（analyzeBlockLms 與頁面封閉式兩條路）', () => {
    const v = vec('T13')
    const an = analyzeBlockLms(SPEC_15_3_EXAMPLE).analytic
    golden(v, 'K_per_fs', an.K)
    golden(v, 'g', an.g)
    golden(v, 'p', an.p)
    golden(v, 'sigma_w_fs', an.sigmaWPred)
    golden(v, 'K_per_fs', SPEC_NUMBERS.K)
    golden(v, 'p', SPEC_NUMBERS.p)
    golden(v, 'sigma_w_fs', SPEC_NUMBERS.sigmaW)
    golden(v, 'g_sum_mode', SPEC_NUMBERS.gSum)
    golden(v, 'pole_sum_mode', SPEC_NUMBERS.poleSum)
  })

  it('T14: f_u、exact −3 dB、ENBW、兩種近似頻寬與 golden T14 一致', () => {
    const v = vec('T14')
    const an = analyzeBlockLms(SPEC_15_3_EXAMPLE).analytic
    golden(v, 'f_u_hz', an.fuHz)
    golden(v, 'bw_exact_3db_hz', an.f3dbHz)
    golden(v, 'enbw_one_sided_hz', an.enbwHz)
    golden(v, 'bw_exact_3db_hz', SPEC_NUMBERS.f3db)
    golden(v, 'bw_neg_ln_p_hz', SPEC_NUMBERS.f3dbNegLn)
    golden(v, 'bw_one_minus_p_hz', SPEC_NUMBERS.f3dbOneMinusP)
    golden(v, 'enbw_one_sided_hz', SPEC_NUMBERS.enbw)
  })

  it('T04: 解析區塊的 K_q 與 golden T04 一致；0/1 未映射時 K 減半', () => {
    const v = vec('T04')
    const rows = analyticRows(analyzeBlockLms(SPEC_15_3_EXAMPLE).analytic, runPreset('block-lms-json-spec').config)
    golden(v, 'kq_per_fs', rows.find((r) => r.key === 'Kq')!.value as number)
    const bug = runPreset('block-lms-json-unipolar-bug')
    expect(bug.analytic.K).toBeCloseTo(0.5 * bug.analytic.Kq * bug.analytic.Cest, 12)
  })
})

describe('模擬指標、交叉比對與 preset 預期', () => {
  it('T13: §15.3 原文模擬：平均 w 在 w* 的 4×SE 內、σ_w 與 0.3992 fs 相符；交叉比對 analytic = ok', () => {
    const r = runPreset('block-lms-json-spec')
    const rows = buildMetricRows(r)
    const mean = rows.find((x) => x.name.startsWith('平均 $w$'))!
    const std = rows.find((x) => x.name.startsWith('$\\sigma_w$'))!
    expect(evaluateMetric(mean).pass).toBe(true)
    expect(evaluateMetric(std).pass).toBe(true)
    const cc = crossCheckOf(r, null, null)
    expect(typeof cc.analytic === 'object' && cc.analytic.status).toBe('ok')
    expect(typeof cc.monteCarlo === 'object' && cc.monteCarlo.status).toBe('not-implemented')
    expect(typeof cc.fixedPoint === 'object' && cc.fixedPoint.status).toBe('n/a')
    const cols = exportColumns(r)
    expect(cols.k.length).toBe(2001)
    expect(cols.G.length).toBe(2000)
  }, 30000)

  it('T13: 8-seed Monte Carlo 的平均 w 95% CI 涵蓋 w*（較短設定），交叉比對 monteCarlo = ok', () => {
    const cfg: BlockLmsConfigInput = { ...SPEC_15_3_EXAMPLE, gm_accum_samples: 1024, num_blocks: 1500 }
    const r = runBlockLms(cfg)
    const mc = runBlockLmsMonteCarlo({ config: cfg, runs: 8 })
    const cc = crossCheckOf(r, mc, null)
    expect(typeof cc.monteCarlo === 'object' && cc.monteCarlo.status).toBe('ok')
    // pooled σ_w 與線性化預測（N = 1024：σ_w = 2·0.3992）
    expect(Math.abs(mc.pooledStdW / r.analytic.sigmaWPred - 1)).toBeLessThan(0.12)
  }, 60000)

  it('T13: 反面測試 sum 模式沿用 μ：g = 326.8（golden），發出 N 倍警告，w 為大振幅 period-2 振盪', () => {
    const v = vec('T13')
    const r = runPreset('block-lms-json-sum-mode')
    golden(v, 'g_sum_mode', r.analytic.g)
    expect(r.warnings.some((w) => w.includes('gm_mode=sum 時有效增益放大 N 倍'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('g ≥ 2：一階模型不穩定'))).toBe(true)
    const w = r.blocks.w
    const K = w.length - 1
    expect(Math.abs(w[K] - w[K - 2])).toBeLessThan(1e-9)
    expect(Math.abs(w[K] - w[K - 1])).toBeGreaterThan(1000)
    const cc = crossCheckOf(r, null, null)
    expect(typeof cc.analytic === 'object' && cc.analytic.status).toBe('n/a')
  }, 30000)

  it('sum 模式 + μ/N 與 average 逐位元相同', () => {
    const a = runPreset('block-lms-json-spec')
    const s = runPreset('block-lms-json-sum-scaled')
    expect(Array.from(s.blocks.w)).toEqual(Array.from(a.blocks.w))
  }, 30000)

  it('T06: preset φ = 120° ⇒ C = −0.25、pole = 1.01995（golden），C ≤ 0 警告，w 單調遠離 a', () => {
    const v = vec('T06')
    const r = runPreset('block-lms-json-polarity-t06')
    expect(Math.abs(r.analytic.Cest - (v.expected.C as number))).toBeLessThan(1e-6)
    expect(Math.abs(r.analytic.p - (v.expected.pole as number))).toBeLessThan(1e-6)
    expect(r.warnings.some((w) => w.startsWith('C ≤ 0：更新極性錯誤'))).toBe(true)
    const w = r.blocks.w
    expect(w[w.length - 1]).toBeLessThan(r.config.gain_true - 100)
  })

  it('T07: preset φ = −120°、D = 4 ⇒ C_D = 0.5（golden），收斂到 a', () => {
    const v = vec('T07')
    const r = runPreset('block-lms-json-delay-align-t07')
    expect(Math.abs(r.analytic.Cest - (v.expected.C_D as number))).toBeLessThan(1e-6)
    expect(Math.abs(r.metrics.meanW - r.config.gain_true)).toBeLessThan(0.5)
    expect(r.warnings.some((w) => w.startsWith('C ≤ 0'))).toBe(false)
  }, 30000)

  it('T04: 反面測試 0/1 未映射：固定點移到約 63 fs（mean-field 63.5），不是 3 fs', () => {
    const r = runPreset('block-lms-json-unipolar-bug')
    expect(r.analytic.wStarMeanField).toBeGreaterThan(62)
    expect(r.analytic.wStarMeanField).toBeLessThan(65)
    expect(Math.abs(r.metrics.meanW - r.analytic.wStarMeanField)).toBeLessThan(1)
    expect(r.warnings.some((w) => w.includes('unipolar_unmapped_bug'))).toBe(true)
  }, 30000)

  it('L5 limit cycle：實體 code 在 3.000 / 3.125 fs 間週期 2，平均 3.0625；定點對照與浮點同 seed 差 < 1 LSB', () => {
    const r = runPreset('block-lms-json-limit-cycle')
    expect(r.metrics.limitCyclePeriod).toBe(2)
    expect(r.metrics.meanWPhys).toBeCloseTo(3.0625, 9)
    const tail = new Set(Array.from(r.blocks.wPhys.slice(-20)))
    expect([...tail].sort()).toEqual([3, 3.125])
    const cc0 = crossCheckOf(r, null, null)
    expect(typeof cc0.fixedPoint === 'object' && cc0.fixedPoint.status).toBe('not-implemented')
    const twin = runBlockLms({ ...r.config, gain_register: { ...r.config.gain_register, quantize_physical: false }, record: { sample_trace_blocks: 0, decimate: 1 } })
    const cc = crossCheckOf(r, null, twin)
    expect(typeof cc.fixedPoint === 'object' && cc.fixedPoint.status).toBe('ok')
    expect(typeof cc.analytic === 'object' && cc.analytic.status).toBe('n/a')
  })

  it('反面測試：saturate 停在 rail 7.875 fs；wrap 模式出現 wrap 事件與警告', () => {
    const s = runPreset('block-lms-json-saturation')
    expect(s.blocks.wPhys[s.blocks.wPhys.length - 1]).toBe(7.875)
    expect(s.metrics.saturationCount).toBeGreaterThan(0)
    expect(s.warnings.some((w) => w.includes('飽和'))).toBe(true)
    const w = runPreset('block-lms-json-wrap')
    expect(w.metrics.wrapCount).toBeGreaterThan(0)
    expect(w.warnings.some((x) => x.includes('wrap'))).toBe(true)
  })

  it('更新延遲 d = 2、g = 0.798：ρ ≈ 1.077 > 1，延遲臨界增益警告', () => {
    const r = runPreset('block-lms-json-update-delay')
    expect(r.analytic.gCritical).toBeCloseTo(2 * Math.sin(Math.PI / 10), 12)
    expect(r.analytic.rhoMean).toBeGreaterThan(1.07)
    expect(r.analytic.rhoMean).toBeLessThan(1.085)
    expect(r.warnings.some((w) => w.startsWith('g ≥ 2sin(π/(4d+2))'))).toBe(true)
  })

  it('L2 type-II + MASH：C ≈ 0.99、收斂到 a；offset × 未置中 code：w* ≈ 3 + 30·E[x]/E[x²]', () => {
    const r = runPreset('block-lms-json-type2-mash')
    expect(r.modelLevel).toBe('L2')
    expect(r.analytic.Cest).toBeGreaterThan(0.9)
    expect(r.analytic.Cest).toBeLessThan(1.1)
    expect(Math.abs(r.metrics.meanW - 3)).toBeLessThan(0.5)
    const o = runPreset('block-lms-json-offset-dc')
    const pred = 3 + (30 * o.analytic.ExRef) / o.analytic.ExRef2
    expect(Math.abs(o.analytic.wStarLinear - pred)).toBeLessThan(1e-6)
    expect(Math.abs(o.analytic.wStarMeanField - (3 + 30 * Math.sqrt(3) * 0.5))).toBeLessThan(0.3)
    expect(Math.abs(o.metrics.meanW - o.analytic.wStarMeanField)).toBeLessThan(0.5)
  }, 30000)
})

describe('顯示層：模型的警告／假設換成 `$...$`（labWarnings / labAssumptions）', () => {
  it('T13: sum 模式沿用 μ：兩條模型警告都換成 LaTeX、數字不變（g = 326.8、pole = −325.8、μ/N = 0.002441）；不穩定時不加「已經縮放」的補充', () => {
    const r = runPreset('block-lms-json-sum-mode')
    const w = labWarnings(r)
    expect(w).toContain(String.raw`$g\ge2$：一階模型不穩定（$g=\mu K=326.8$，pole $p=-325.8$）`)
    expect(w).toContain(String.raw`gm_mode=sum 時有效增益放大 $N$ 倍（$N=4096$：$g=326.8$；若沿用 average 模式的 $\mu$，需改為 $\mu/N=0.002441$）`)
    expect(w.some((t) => t.includes('不必再除一次'))).toBe(false)
    expect(w.length).toBe(r.warnings.length)
    for (const t of w) expect(UNICODE_MATH.test(outsideMath(t)), t).toBe(false)
  }, 30000)

  it('sum 模式 + μ/N（已經縮放）：模型仍發出 N 倍提醒，本頁補一句說明目前的 g 已在穩定範圍內、不必再除一次', () => {
    const r = runPreset('block-lms-json-sum-scaled')
    expect(r.warnings.length).toBe(1) // 模型只要是 sum 模式就提醒
    const w = labWarnings(r)
    expect(w.length).toBe(2)
    expect(w[0]).toContain(String.raw`$g=0.07979$`)
    expect(w[1]).toContain(String.raw`$g=0.07979$`)
    expect(w[1]).toContain(String.raw`$(0,\,2)$`)
    expect(w[1]).toMatch(/不必再除一次/)
    for (const t of w) {
      expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0)
      expect(UNICODE_MATH.test(outsideMath(t)), t).toBe(false)
    }
    // average 模式沒有這句；沒有結果時是空陣列；執行錯誤附在最後
    expect(labWarnings(runPreset('block-lms-json-spec'))).toEqual([])
    expect(labWarnings(null)).toEqual([])
    expect(labWarnings(null, 'worker 掛了')).toEqual(['模擬失敗：worker 掛了'])
    expect(labWarnings(r, 'x').slice(-1)).toEqual(['模擬失敗：x'])
  }, 30000)

  it('假設：模型的 9 句換成 LaTeX（σ_v、δ = a − w、GMAC 定義都在 `$...$` 內），再接本頁的 3 句', () => {
    const r = runPreset('block-lms-json-spec')
    const a = labAssumptions(r)
    expect(a.length).toBe(r.assumptions.length + PAGE_ASSUMPTIONS.length)
    expect(a.slice(-PAGE_ASSUMPTIONS.length)).toEqual(PAGE_ASSUMPTIONS)
    expect(a[0]).toContain(String.raw`$\delta=a-w$`)
    expect(a.some((t) => t.includes(String.raw`$\sigma_v=100\,\mathrm{fs}$`))).toBe(true)
    expect(a.some((t) => t.includes(String.raw`$G_k=\frac1N\sum q\,x_\mathrm{ref}$（$N=4096$）`))).toBe(true)
    for (const t of a) expect(UNICODE_MATH.test(outsideMath(t)), t).toBe(false)
    expect(labAssumptions(null)).toEqual(PAGE_ASSUMPTIONS)
    // sum 模式：模型把總和也寫成 G_k，本頁改寫成 S_k（符號表的約定）
    expect(labAssumptions(runPreset('block-lms-json-sum-mode')).some((t) => t.includes(String.raw`$S_k=\sum q\,x_\mathrm{ref}$`))).toBe(true)
  }, 30000)
})

describe('小工具', () => {
  it('F-15.12 的三個函式：N_eff、SE(mean)、relSE(std)（§15.3 範例：1000 個 block、ρ₁ = p）', () => {
    const p = SPEC_NUMBERS.p
    expect(ar1EffectiveSamples(1000, p)).toBeCloseTo((1000 * (1 - p)) / (1 + p), 12)
    expect(ar1EffectiveSamples(1000, p).toFixed(2)).toBe('41.55')
    expect(ar1SeMean(SPEC_NUMBERS.sigmaW, p, 1000)).toBeCloseTo(SPEC_NUMBERS.sigmaW / Math.sqrt(ar1EffectiveSamples(1000, p)), 12)
    expect(ar1SeMean(SPEC_NUMBERS.sigmaW, p, 1000).toFixed(4)).toBe('0.0619')
    expect(ar1RelSeStd(p, 1000)).toBeCloseTo(Math.sqrt((1 + p * p) / (2000 * (1 - p * p))), 12)
    // 獨立樣本（ρ = 0）退化成熟悉的 s/√m 與 1/√(2m)
    expect(ar1EffectiveSamples(400, 0)).toBe(400)
    expect(ar1SeMean(2, 0, 400)).toBeCloseTo(0.1, 12)
    expect(ar1RelSeStd(0, 200)).toBeCloseTo(0.05, 12)
    // 負相關：有效樣本數比 block 數多
    expect(ar1EffectiveSamples(100, -0.5)).toBeCloseTo(300, 12)
  })


  it('tailStats：AR(1)（ρ = 0.9）的 lag-1 自相關估計與 SE 公式', () => {
    const rng = createRng(7)
    const K = 40000
    const w = new Float64Array(K + 1)
    for (let k = 1; k <= K; k++) w[k] = 0.9 * w[k - 1] + rng.normal()
    const ts = tailStats(w)
    expect(ts.rho1).toBeGreaterThan(0.88)
    expect(ts.rho1).toBeLessThan(0.92)
    const s = Math.sqrt(1 / (1 - 0.81))
    expect(ts.seMean).toBeCloseTo(s * Math.sqrt(1.9 / (0.1 * ts.m)), 1)
  })

  it('texNumber / shortLabelTex：放進 $...$ 的數字不含裸的 e 記號或未包裝的 NaN', () => {
    expect(texNumber(0.25)).toBe('0.25')
    expect(texNumber(1.5e-7, 3)).toBe('1.50\\times10^{-7}')
    expect(texNumber(-3.2e9, 2)).toBe('-3.2\\times10^{9}')
    expect(texNumber(NaN)).toBe('\\text{NaN（未定義）}')
    expect(texNumber(Infinity)).toBe('\\text{∞}')
    const cfg = validateConfigText(SPEC_EXAMPLE_TEXT).config!
    expect(shortLabel(cfg)).toBe('μ=10 · N=4096 · average · raw')
    expect(shortLabelTex(cfg)).toBe('$\\mu=10$ / $N=4096$ / average / raw')
    const d = validateConfigText(presetConfigText(PRESETS.find((x) => x.id === 'block-lms-json-update-delay')!.params) as string).config!
    expect(shortLabelTex(d)).toContain('$d=2$')
    // 所有指標名稱與說明裡的 $ 都成對
    const r = runPreset('block-lms-json-spec')
    const strings = [...buildMetricRows(r).flatMap((x) => [x.name, x.note ?? '']), ...analyticRows(r.analytic, r.config).flatMap((x) => [x.label, x.note ?? '', x.unit])]
    for (const t of strings) expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0)
    const cc = crossCheckOf(r, null, null)
    for (const e of [cc.analytic, cc.monteCarlo, cc.fixedPoint]) if (typeof e === 'object' && e.note) expect((e.note.match(/\$/g) ?? []).length % 2, e.note).toBe(0)
  }, 30000)

  it('decimate 保留端點；tailHistogram 密度積分為 1', () => {
    const y = Float64Array.from({ length: 100001 }, (_, i) => i)
    const d = decimate(y, 1000)
    expect(d.x[0]).toBe(0)
    expect(d.x[d.x.length - 1]).toBe(100000)
    expect(d.x.length).toBeLessThanOrEqual(1002)
    const r = runPreset('block-lms-json-spec')
    const h = tailHistogram(r.blocks.w, r.analytic.wStarMeanField, r.analytic.sigmaWPred)!
    const width = h.centers[1] - h.centers[0]
    expect(h.density.reduce((a, b) => a + b, 0) * width).toBeCloseTo(1, 9)
  }, 30000)
})
