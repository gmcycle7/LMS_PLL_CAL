import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'
import { stripMathDelimiters } from '@/components'
import { analyzeBlockLms } from '@/simulation/models/blockLms'
import { DsmStream } from '@/simulation/models/dsm'
import {
  DEFAULT_LAB_PARAMS,
  DEFAULT_SWEEP_OPTIONS,
  LAB_PARAM_LABEL,
  LAB_RANGES,
  analyzeLab,
  combineMc,
  delayLoopRadius,
  meanDeltaTrajectory,
  labParamErrors,
  mcChecks,
  mcSeeds,
  runMcChunk,
  runPipeline,
  sweepFcwChunk,
  toBlockLmsConfig,
  type LabParams,
} from '@/simulation/models/unifiedLab'
import { bernoulliMoments, efbConstant, efbPeriod, toggleCycle } from '@/simulation/models/quantizer'
import { sig, texifyShared } from './common'
import {
  AUTO_RUN_MAX_SAMPLES,
  DEFAULT_SWEEP_GRID,
  DEFAULT_TRAINING_SHARED,
  EXP,
  TAB_ORDER,
  buildLabReport,
  collectWarnings,
  diffKeys,
  isInformational,
  labKey,
  mcCrossCheck,
  mcMetrics,
  pipelineCrossCheck,
  pipelineExport,
  pipelineMetrics,
  sanitizeComparePreset,
  sanitizeLabParams,
  sanitizeMcPreset,
  sanitizePattern,
  sanitizeSweepPreset,
  sanitizeTrainingPreset,
  summarizeSweep,
  sweepCrossCheck,
  sweepErrors,
  sweepExport,
  sweepWarnings,
  tabOfExperiment,
  tauMetricRow,
  timingPsdToDbc,
  trainingErrors,
} from './logic'
import { FORMULAS } from './formulas'
import { anchorNumbers, blockFixedPointExample, delayTable, dsmHandExample, FX_DELAY_EXAMPLE, pllNumbers, seNumbers, spurNumbers } from './numbers'
import { labelOf, LAB_UNITS, PANEL_GROUPS, PARAM_META } from './paramMeta'

interface GoldenVector {
  inputs: Record<string, number>
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

/** 字串裡每一段 `$...$` 都要能被 KaTeX 解析（throwOnError） */
function expectTexOk(s: string): void {
  for (const m of s.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)) {
    expect(() => katex.renderToString(m[1], { throwOnError: true, strict: 'ignore' }), `TeX「${m[1]}」（來自「${s}」）`).not.toThrow()
  }
  expect((s.match(/(?<!\\)\$/g) ?? []).length % 2, `「${s}」的 $ 不成對`).toBe(0)
}

const SMALL: LabParams = { ...DEFAULT_LAB_PARAMS, N: 512, blocks: 300, outBlocks: 32 }

describe('教學段落的數字（numbers.ts）：全部由模型計算，並與 golden vectors 一致', () => {
  it('T13: 例 B 的手算表（K_q、g、p、σ_w）等於 golden vector', () => {
    const v = golden('T13')
    const a = anchorNumbers()
    expectGolden(v, 'K_per_fs', a.K)
    expectGolden(v, 'g', a.g)
    expectGolden(v, 'p', a.p)
    expectGolden(v, 'sigma_w_fs', a.sigmaW)
    // 第一個 block 的平均更新：erf 與線性近似差 (δ/σ)²/6 等級
    expect(a.meanG0).toBeLessThan(a.meanG0Lin)
    expect(a.meanG0 / a.meanG0Lin).toBeCloseTo(1 - (a.delta0 / a.sigmaV) ** 2 / 6, 6)
    expect(a.w1).toBeCloseTo(a.mu * a.meanG0, 12)
  })

  it('T14: 例 B 的 f_u、exact −3 dB、ENBW 等於 golden vector', () => {
    const v = golden('T14')
    const a = anchorNumbers()
    expectGolden(v, 'f_u_hz', a.fu)
    expectGolden(v, 'bw_exact_3db_hz', a.bw.exact)
    expectGolden(v, 'enbw_one_sided_hz', a.bw.enbw)
  })

  it('T15: §4.9 的 spur 例子（0.5 fs peak @ 13 GHz）等於 golden vector；近整數例子的每個因子自洽', () => {
    const v = golden('T15')
    const s = spurNumbers()
    expectGolden(v, 'spur_dbc', s.t15.dbc)
    expectGolden(v, 'spur_dbc_bessel', s.t15.dbcBessel)
    expect(s.amp).toBeCloseTo(s.deltaA * s.scale * s.st.line1 * s.tMag, 14)
    expect(s.st.line1).toBeCloseTo(1 / Math.PI, 6) // P = 2^20/gcd 很大 ⇒ A₁ → 1/π
    expect(s.scale).toBeCloseTo(Math.sqrt(3), 3) // unit_rms：1/√(1/3)
    expect(s.tMag).toBeGreaterThan(0.95) // f₁ ≈ 400 kHz 在 2 MHz 頻寬內
    expect(s.tMag).toBeLessThan(1.3)
    expect(s.tone.dbc).toBeCloseTo(20 * Math.log10(Math.PI * s.fOut * s.amp * 1e-15), 9) // 20log10(β/2)，β = 2π f_out A
  })

  it('例 A（α = 1/4、4-bit）：residue = −1/4, −1/2, −3/4, 0 重複；E[r] = −3/8、E[r²] = 7/32', () => {
    const ex = dsmHandExample()
    expect(ex.rows.map((r) => r.r)).toEqual([-0.25, -0.5, -0.75, 0, -0.25, -0.5, -0.75, 0])
    expect(ex.rows.map((r) => r.y)).toEqual([0, 0, 0, 1, 0, 0, 0, 1])
    expect(ex.st.P).toBe(4)
    expect(ex.st.mean).toBe(-3 / 8)
    expect(ex.st.meanSquare).toBe(7 / 32)
    expect(ex.scale * ex.scale * ex.st.meanSquare).toBeCloseTo(1, 14)
  })

  it('PLL 數字：Type-I 的 ρ_T 滿足 sin(Ω₃/2) = (1 − ρ)/(2√ρ)；H + T = 1 ⇒ 頻寬以下 |T| ≈ 1、|H_PD| ≪ 1；Type-II 低頻衰減更快', () => {
    const p = pllNumbers()
    expect((1 - p.rho) / (2 * Math.sqrt(p.rho))).toBeCloseTo(p.s, 14)
    const low = p.rows[0] // f_BW/100
    expect(low.t1).toBeCloseTo(1, 3)
    expect(low.h1).toBeLessThan(0.02)
    expect(low.h2).toBeLessThan(low.h1 * 0.2) // 兩個積分器：40 dB/dec
    const hi = p.rows[4] // 100 f_BW
    expect(hi.h1).toBeGreaterThan(0.95)
    expect(hi.t1).toBeLessThan(0.02)
  })

  it('AR(1) 的標準誤差：例 B 的 1000 個 block 只相當於約 42 個獨立樣本；延遲表在 d = 0 的 ρ = 1 − g', () => {
    const s = seNumbers()
    expect(s.ratio).toBeGreaterThan(4.5)
    expect(s.ratio).toBeLessThan(5.2)
    expect(s.nEffMean).toBeGreaterThan(38)
    expect(s.nEffMean).toBeLessThan(46)
    const a = anchorNumbers()
    const t = delayTable(a.g)
    expect(t[0].rho).toBeCloseTo(1 - a.g, 10)
    expect(t[0].gCrit).toBe(2)
    expect(t[1].gCrit).toBeCloseTo(1, 12)
    for (const r of t) expect(r.rho).toBeLessThan(1) // g = 0.08 遠小於任何一個臨界值
  })

  it('延遲表：g_break = d^d/(d+1)^{d+1} 是 z^d(1 − z) 的最大值（實根合併成複根的分界）；小 g 時 ρ 隨 d 變小、PM 每個 block 少 2·asin(g/2)', () => {
    const a = anchorNumbers()
    const t = delayTable(a.g)
    expect(Number.isNaN(t[0].gBreak)).toBe(true) // d = 0 沒有這個分界
    expect(t[1].gBreak).toBeCloseTo(1 / 4, 14)
    expect(t[2].gBreak).toBeCloseTo(4 / 27, 14)
    expect(t[4].gBreak).toBeCloseTo(256 / 3125, 14)
    for (const r of t.slice(1)) {
      // 數值確認：f(z) = z^d(1 − z) 在 z = d/(d+1) 取得最大值 g_break
      const f = (z: number) => Math.pow(z, r.d) * (1 - z)
      const z0 = r.d / (r.d + 1)
      expect(f(z0)).toBeCloseTo(r.gBreak, 14)
      expect(f(z0 - 1e-3)).toBeLessThan(r.gBreak)
      expect(f(z0 + 1e-3)).toBeLessThan(r.gBreak)
      expect(r.gBreak).toBeLessThan(r.gCrit) // 先振鈴，再不穩定
      // 例 B 的 g 小於每個 g_break ⇒ 主導根是實根，且滿足 z^d(1 − z) = g
      expect(a.g).toBeLessThan(r.gBreak)
      expect(f(r.rho)).toBeCloseTo(a.g, 9)
    }
    for (let d = 1; d < t.length; d++) {
      expect(t[d].rho).toBeLessThan(t[d - 1].rho) // 容易讀錯的地方：小 g 時延遲讓主導 pole 往內
      expect(t[d - 1].pmDeg - t[d].pmDeg).toBeCloseTo((2 * Math.asin(a.g / 2) * 180) / Math.PI, 10)
      expect(t[d].rhoHalfCrit).toBeLessThan(1)
    }
    expect(t[0].pmDeg).toBeCloseTo(90 - (Math.asin(a.g / 2) * 180) / Math.PI, 12)
  })

  it('§5.2 的例子（一階 DSM α = 0.3、b = 20 fs、無 PLL）：每個 block 的準靜態固定點擺動超過 1 fs；整個週期的值是 a + b·E[x]', () => {
    const fp = blockFixedPointExample()
    expect(fp.st.P).toBe(2 ** 20)
    expect(fp.superPeriodBlocks).toBe(256)
    const ws = fp.rows.map((r) => r.wStar)
    expect(Math.max(...ws) - Math.min(...ws)).toBeGreaterThan(1)
    // 文字說「每 128 個 block 繞一圈、第 127 與 128 個 block 之間跳回起點」：
    // 10K mod M = 2 ⇒ 每 10 個 sample 相位前進 2/M；10 個 level 平移一格（1/10）要 (1/10)/(2/M) = M/20 次 × 10 個 sample = M/2 個 sample = 128 個 block
    expect((10 * fp.st.K) % fp.st.M).toBe(2)
    expect(fp.st.M / 2 / fp.N).toBe(128)
    const at = (k: number) => fp.rows.find((r) => r.k === k)!.wStar
    expect(Math.abs(at(128) - at(0))).toBeLessThan(0.01)
    expect(at(127) - at(0)).toBeGreaterThan(1.5)
    expect(at(32)).toBeGreaterThan(at(0))
    expect(at(96)).toBeGreaterThan(at(64))
    for (const r of fp.rows) {
      expect(r.wStar).toBeCloseTo(fp.a + (fp.b * r.xMean) / r.x2Mean, 12)
      expect(r.xMean).toBeLessThan(0) // 一階 residue 恆 ≤ 0
    }
    // 整個週期：E[x²] = 1（unit_rms）、E[x] = E[r]·s → −√3/2
    expect(fp.wFull).toBeCloseTo(fp.a + fp.b * fp.st.mean * fp.s, 12)
    expect(fp.wFull).toBeCloseTo(3 - 20 * (Math.sqrt(3) / 2), 3)
    // 封閉式的 residue 與 DSM 串流一致（block 0 的前 8 個樣本）
    const s = new DsmStream({ kind: 'first_order', frac: fp.frac, bits: fp.bits })
    for (let n = 0; n < 8; n++) {
      s.step()
      expect(s.residue).toBe(-(((n + 1) * fp.st.K) % fp.st.M) / fp.st.M)
    }
    // 與整條 pipeline 的 mean-field twin 回報的 C_k、B_k 一致：w*_0 = a + B_0/C_0
    const r = runPipeline({ ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', frac: fp.frac, pll: 'none', compOffsetFs: fp.b, N: fp.N, blocks: 256, outBlocks: 16 })
    expect(r.fixedPointSwing).not.toBeNull()
    // blockLms 的正規化取自整段 record（256 個 block = 一個完整週期），所以 scale 與封閉式的 s 相同
    expect(r.code.normScale).toBeCloseTo(fp.s, 6)
    // 表中只取了五個 block；pipeline 的範圍涵蓋後半個週期的每一個 block，所以略寬，但同一個量級
    expect(r.fixedPointSwing!.min).toBeGreaterThan(Math.min(...ws) - 0.5)
    expect(r.fixedPointSwing!.max).toBeLessThan(Math.max(...ws) + 0.5)
    expect(r.fixedPointSwing!.max - r.fixedPointSwing!.min).toBeGreaterThan(1)
  }, 30_000)
})

describe('參數補值與檢查', () => {
  it('sanitizeLabParams：認得的欄位覆寫、其餘保留預設；每個被忽略的欄位都有原因', () => {
    const r = sanitizeLabParams({ frac: 1e-5, codeSource: 'dsm_first_order', quantize: true, bogus: 1, pll: 'type3', N: '4096', seed: -1, dither: 'yes' })
    expect(r.params.frac).toBe(1e-5)
    expect(r.params.codeSource).toBe('dsm_first_order')
    expect(r.params.quantize).toBe(true)
    expect(r.params.pll).toBe(DEFAULT_LAB_PARAMS.pll)
    expect(r.params.N).toBe(DEFAULT_LAB_PARAMS.N)
    expect(r.params.seed).toBe(DEFAULT_LAB_PARAMS.seed)
    expect(r.issues).toHaveLength(5)
    expect(r.issues.some((i) => i.includes('未知欄位 bogus'))).toBe(true)
    expect(r.issues.some((i) => i.includes('pll') && i.includes('合法選項'))).toBe(true)
    expect(sanitizeLabParams(undefined)).toEqual({ params: DEFAULT_LAB_PARAMS, issues: [] })
    expect(sanitizeLabParams('x').issues).toHaveLength(1)
    // 不改到預設物件
    expect(DEFAULT_LAB_PARAMS.frac).toBe(0.3)
  })

  it('超出範圍的數值會保留，由 labParamErrors 用參數的顯示名稱說明（TeX 可解析）', () => {
    const r = sanitizeLabParams({ N: 8, muFs: 1e9 })
    expect(r.issues).toEqual([])
    const errs = labParamErrors(r.params)
    expect(errs).toHaveLength(2)
    expect(errs[0]).toContain('GMAC 長度')
    for (const e of errs) expectTexOk(e)
  })

  it('每個 LabParams 欄位都有 UI 設定；數值欄位的標籤、單位、分組齊全，TeX 可解析', () => {
    const keys = Object.keys(DEFAULT_LAB_PARAMS).filter((k) => k !== 'seed')
    expect(PARAM_META.map((m) => m.key).sort()).toEqual(keys.sort())
    for (const m of PARAM_META) {
      expect(PANEL_GROUPS.some((g) => g.id === m.stage)).toBe(true)
      expect(m.reg.length).toBeGreaterThan(3)
      if (m.hint) expectTexOk(m.hint)
      expectTexOk(labelOf(m.key))
      if (m.kind === 'enum') expect(m.options.some((o) => o.value === DEFAULT_LAB_PARAMS[m.key])).toBe(true)
    }
    for (const k of Object.keys(LAB_RANGES) as (keyof typeof LAB_RANGES)[]) {
      expectTexOk(LAB_PARAM_LABEL[k])
      expect(LAB_UNITS[k]).toBeTruthy()
    }
  })

  it('preset 形狀：sweep / MC / training / compare 各自補成完整設定', () => {
    const s = sanitizeSweepPreset({ base: { regressor: 'delayed', codeDelay: 64 }, grid: { min: 1e-4, max: 0.2, points: 9.4, scale: 'linear' }, opts: { closedLoop: true, loopBlocks: 300 } })
    expect(s.base.codeSource).toBe('dsm_first_order') // sweep 的預設 code 是一階 DSM
    expect(s.grid).toEqual({ min: 1e-4, max: 0.2, points: 9, scale: 'linear' })
    expect(s.opts.closedLoop).toBe(true)
    expect(s.opts.loopBlocks).toBe(300)
    expect(s.opts.slopeBlocks).toBe(DEFAULT_SWEEP_OPTIONS.slopeBlocks)
    expect(sanitizeSweepPreset(null).grid).toEqual(DEFAULT_SWEEP_GRID)

    expect(sanitizeMcPreset({ runs: 1000 }).runs).toBe(256)
    expect(sanitizeMcPreset({ runs: 1 }).runs).toBe(2)
    expect(sanitizeMcPreset({}).runs).toBe(16)

    const t = sanitizeTrainingPreset({ shared: { pll: 'none', basis: { offset: false, inl3: true }, length: 65536 }, patterns: [{ source: 'mash111' }, { randomization: 'pm1', randAmp: 2 }, {}, {}] })
    expect(t.shared.pll).toBe('none')
    expect(t.shared.basis).toEqual({ gain: true, inl2: true, inl3: true, offset: false })
    expect(t.shared.length).toBe(65536)
    expect(t.patterns).toHaveLength(3)
    expect(t.patterns[0].source).toBe('mash111')
    expect(t.patterns[1].randomization).toBe('pm1')
    expect(DEFAULT_TRAINING_SHARED.basis.inl3).toBe(false) // 沒有改到預設物件
    expect(sanitizePattern({ source: 'nope', frac: 'x' }).source).toBe('dsm_first_order')

    const c = sanitizeComparePreset({ base: { frac: 0.01 }, cases: [{ regressor: 'raw' }, { regressor: 'delayed', codeDelay: 8, nope: 1 }] })
    expect(c.cases).toHaveLength(2)
    expect(c.cases.every((x) => x.frac === 0.01)).toBe(true)
    expect(c.cases[1].codeDelay).toBe(8)
    expect(c.issues).toEqual(['Case B.未知欄位 nope：已忽略'])
    expect(diffKeys(c.cases)).toEqual(['regressor', 'codeDelay'])
    expect(diffKeys([DEFAULT_LAB_PARAMS])).toEqual([])
  })

  it('sweepErrors / trainingErrors：每一種不合法都有說明原因的訊息', () => {
    expect(sweepErrors(DEFAULT_SWEEP_GRID, DEFAULT_SWEEP_OPTIONS, { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order' })).toEqual([])
    const e = sweepErrors({ min: 0.3, max: 0.1, points: 1, scale: 'log' }, { ...DEFAULT_SWEEP_OPTIONS, deltaFs: 0 }, DEFAULT_LAB_PARAMS)
    expect(e.some((x) => x.includes('上限必須大於下限'))).toBe(true)
    expect(e.some((x) => x.includes('2–200'))).toBe(true)
    expect(e.some((x) => x.includes('Delta w'))).toBe(true)
    for (const x of e) expectTexOk(x)
    const iid = sweepErrors(DEFAULT_SWEEP_GRID, DEFAULT_SWEEP_OPTIONS, { ...DEFAULT_LAB_PARAMS, codeSource: 'iid_pm_one' })
    expect(iid.some((x) => x.includes('sweep 沒有意義'))).toBe(true)

    expect(trainingErrors(DEFAULT_TRAINING_SHARED, [sanitizePattern({})])).toEqual([])
    const te = trainingErrors({ ...DEFAULT_TRAINING_SHARED, length: 100, basis: { gain: false, inl2: false, inl3: false, offset: false }, pllBwHz: 3e9 }, [sanitizePattern({ frac: 2, randAmp: 99 })])
    expect(te.some((x) => x.includes('序列長度'))).toBe(true)
    expect(te.some((x) => x.includes('至少要選一個參數基底'))).toBe(true)
    expect(te.some((x) => x.includes('Nyquist'))).toBe(true)
    expect(te.some((x) => x.startsWith('Case A：frac'))).toBe(true)
    for (const x of te) expectTexOk(x)
  })

  it('實驗 ID 與分頁的對應', () => {
    for (const t of TAB_ORDER) expect(tabOfExperiment(EXP[t])).toBe(t)
    expect(tabOfExperiment('nope')).toBeNull()
    expect(tabOfExperiment(undefined)).toBeNull()
    expect(DEFAULT_LAB_PARAMS.N * DEFAULT_LAB_PARAMS.blocks).toBeLessThanOrEqual(AUTO_RUN_MAX_SAMPLES) // 預設設定會自動執行
    expect(labKey({ ...DEFAULT_LAB_PARAMS })).toBe(labKey(DEFAULT_LAB_PARAMS))
  })
})

describe('共用模型的 Unicode 警告 → TeX（texifyShared）', () => {
  const configs: Partial<LabParams>[] = [
    { muFs: -5 },
    { muFs: 300 },
    { muFs: 20, updateDelay: 3, gmMode: 'sum' },
    { sigmaV: 0 },
    { codeSource: 'dsm_first_order', frac: 0.01, encoding: 'unipolar_unmapped_bug', compOffsetFs: 3, c3: 0.5 },
    { codeSource: 'dsm_first_order', frac: 2e-5, regressor: 'delayed', codeDelay: 64, normalization: 'standardize' },
    { regressor: 'filtered', fxGain: -0.5, fxExtraDelay: 3 },
    { quantize: true, sigmaV: 1, muFs: 0.1 },
    { regressor: 'raw', codeDelay: 9 },
  ]
  const warnings = Array.from(new Set(configs.flatMap((c) => analyzeBlockLms(toBlockLmsConfig({ ...SMALL, ...c })).warnings)))

  it('真實的 blockLms 警告轉完後：每段 TeX 可解析、$ 成對、原文的 Unicode 數學符號不再裸露在外', () => {
    expect(warnings.length).toBeGreaterThan(8)
    for (const w of warnings) {
      const t = texifyShared(w)
      expectTexOk(t)
      const outside = t.replace(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g, '')
      expect(outside, `「${w}」→「${t}」`).not.toMatch(/[σμ≤≥≈≠Ĥ]|K_q|x_ref|w\*/)
    }
  })

  it('具體例子：C ≤ 0、σ_v = 0、g = μK = …、H_PD(z=1) = 0', () => {
    expect(texifyShared('C ≤ 0：更新極性錯誤（C = -0.3946；需 delay alignment）')).toBe('$C \\le 0$：更新極性錯誤（$C = -0.3946$；需 delay alignment）')
    expect(texifyShared('σ_v = 0：comparator 為純 sign，K_q 無定義')).toBe('$\\sigma_v = 0$：comparator 為純 sign，$K_q$ 無定義')
    expect(texifyShared('g ≥ 2：一階模型不穩定（g = μK = 327.7，pole = -326.7）')).toBe('$g \\ge 2$：一階模型不穩定（$g = \\mu K = 327.7$，pole = -326.7）')
    expect(texifyShared('H_PD(z=1) = 0：DC 成分到不了 comparator')).toBe('$H_{\\mathrm{PD}}(1) = 0$：DC 成分到不了 comparator')
    expect(texifyShared('量化步階 1.5e-7 fs，σ_w = 1e-9 fs')).toBe('量化步階 1.5e-7 fs，$\\sigma_w = 1\\times10^{-9}$ fs')
  })

  it('不動已經是 TeX 的段落、不動一般文字（delay、dead zone、GMAC 等英文單字裡的字母）', () => {
    const s = '已有 $\\sigma_v=0$ 的段落；delay alignment、dead zone、GMAC、LSB = 0.125 fs'
    expect(texifyShared(s)).toBe(s)
    expect(texifyShared('沒有數學的句子')).toBe('沒有數學的句子')
    expect(stripMathDelimiters(texifyShared('C ≈ 0：沒有恢復力'))).toBe('C \\approx 0：沒有恢復力')
  })
})

describe('Pipeline 的整理函式（以一次小型模擬為素材）', () => {
  const r = runPipeline({ ...SMALL, codeSource: 'dsm_first_order', frac: 0.01, compOffsetFs: 2 })

  it('collectWarnings：每一級與整體的警告都在、不重複；informational 的註記被分開', () => {
    const all = collectWarnings(r)
    expect(new Set(all.map((w) => w.text)).size).toBe(all.length)
    for (const w of r.warnings) expect(all.some((x) => x.text === w)).toBe(true)
    for (const s of r.stages) for (const w of s.warnings) expect(all.some((x) => x.text === w)).toBe(true)
    expect(all.some((w) => isInformational(w.text))).toBe(true) // Welch 解析度的註記
    expect(isInformational('C ≤ 0：更新極性錯誤')).toBe(false)
    for (const w of all) expectTexOk(texifyShared(w.text))
  })

  it('pipelineMetrics：名稱、註記的 TeX 可解析；公式 ID 都是 F-LAB.n；有解析值的列附容差', () => {
    const rows = pipelineMetrics(r)
    expect(rows.length).toBeGreaterThan(10)
    for (const m of rows) {
      expectTexOk(m.name)
      if (m.note) expectTexOk(m.note)
      if (m.formulaId) expect(m.formulaId).toMatch(/^F-LAB\.\d+$/)
    }
    const replay = rows[0]
    expect(replay.value).toBe(0)
    expect(replay.analytic).toBe(0)
    expect(rows.find((m) => m.name.startsWith('fractional tone'))?.analytic).toBeGreaterThan(0)
  })

  it('九級的指標名稱、假設、警告與七項交叉比對的說明都能被 KaTeX 解析', () => {
    for (const s of r.stages) {
      expectTexOk(s.title)
      for (const a of s.assumptions) expectTexOk(a)
      for (const m of s.metrics) {
        expectTexOk(m.name)
        if (m.note) expectTexOk(m.note)
        if (m.unit) expectTexOk(m.unit)
        if (typeof m.value === 'string') expectTexOk(m.value)
      }
      for (const w of s.warnings) expectTexOk(texifyShared(w))
    }
    for (const c of Object.values(r.checks)) expectTexOk(c.note)
    for (const a of r.assumptions) expectTexOk(a)
  })

  it('pipelineCrossCheck：三欄的狀態來自模型的檢查，不是寫死的', () => {
    const cc = pipelineCrossCheck(r)
    expect(typeof cc.analytic).toBe('object')
    expect((cc.fixedPoint as { status: string }).status).toBe('n/a') // 沒開定點
    expect(['ok', 'mismatch', 'n/a']).toContain((cc.analytic as { status: string }).status)
    const q = runPipeline({ ...SMALL, quantize: true, aFs: 3.05 })
    expect((pipelineCrossCheck(q).fixedPoint as { status: string }).status).toBe(q.checks.fixedPoint.status)
    expect(q.checks.fixedPoint.status).not.toBe('n/a')
  })

  it('pipelineExport：block 級、sample 級、PSD 的欄位齊全且長度一致', () => {
    const c = pipelineExport(r)
    expect(c.block_k.length).toBe(SMALL.blocks + 1)
    expect(c.w_fs.length).toBe(c.block_k.length)
    expect(c.x.length).toBe(c.sample_n.length)
    expect(c.t_out_fs.length).toBe(c.sample_n.length)
    expect(c.psd_f_hz.length).toBe(c.psd_t_out_fs2_per_hz.length)
    expect(c.T_mag2.length).toBe(c.analytic_f_hz.length)
  })

  it('完整報告：全部參數、seed 與 fork 標籤、版本、九級、交叉比對、全部警告；可序列化且 NaN 不會變成 null', () => {
    const rep = buildLabReport(r, { appVersion: '1.2.3', gitCommit: 'abc1234', generatedAt: '2026-10-10T00:00:00.000Z', presetId: 'lab-x' })
    const text = JSON.stringify(rep)
    const back = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(back.input_parameters as object).sort()).toEqual(Object.keys(DEFAULT_LAB_PARAMS).sort())
    expect(back.seed).toBe(SMALL.seed)
    expect((back.rng as { forks: Record<string, string> }).forks.comparator_noise).toContain('comparator-noise')
    expect(back.simulation_version).toMatch(/^unifiedLab\//)
    expect(back.app_version).toBe('1.2.3')
    expect(back.git_commit).toBe('abc1234')
    expect(back.preset_id).toBe('lab-x')
    expect(back.model_level).toBe('L4')
    expect(back.stages as unknown[]).toHaveLength(9)
    expect((back.warnings as string[]).length).toBe(collectWarnings(r).length)
    expect(Object.keys(back.cross_check as object)).toEqual(['replay', 'meanW', 'sigmaW', 'noiseMix', 'spur', 'code', 'fixedPoint'])
    expect((back.block_lms_config as { gm_accum_samples: number }).gm_accum_samples).toBe(512)
    expect((back.assumptions as string[]).length).toBeGreaterThan(5)
    // 平均模型、準靜態固定點的範圍、譜線偵測的條件都寫進報告（可追溯）
    const derived = back.derived as { mean_model: string; fixed_point_swing_fs: { min: number; max: number; mean: number } | null }
    expect(derived.mean_model).toBe('mean-field')
    expect(derived.fixed_point_swing_fs).not.toBeNull()
    const det = (back.output as { tone_detection: { segments: number; min_above_local_median_db: number; min_prominence_db: number } }).tone_detection
    expect(det.min_prominence_db).toBe(15)
    expect([8, 10, 14]).toContain(det.min_above_local_median_db)
    // CSV：兩條平均軌跡都匯出，長度與 block 軸一致
    const csv = pipelineExport(r)
    expect(csv.w_mean_model_fs.length).toBe(csv.block_k.length)
    expect(csv.w_linear_model_fs.length).toBe(csv.block_k.length)
    // 沒有 PLL 時 f3dbTHz 是 NaN：報告裡是字串 'NaN'，不是 null
    const none = buildLabReport(runPipeline({ ...SMALL, pll: 'none', codeSource: 'iid_pm_one' }), { appVersion: 'x', gitCommit: 'y', generatedAt: 'z' })
    const pll = (JSON.parse(JSON.stringify(none)) as { derived: { pll: { f3db_T_hz: unknown } } }).derived.pll
    expect(pll.f3db_T_hz).toBe('NaN')
  })

  it('反面（極性反轉）：μ < 0 時 w 線性漂走（sign-LMS 的 G 有界，所以不是數值爆炸）；報告與 CSV 仍可產生，交叉比對不會給「一致」', () => {
    const bad = runPipeline({ ...SMALL, muFs: -1000, blocks: 600, outBlocks: 16 })
    expect(bad.analytic.g).toBeLessThan(0)
    expect(bad.analytic.rhoMean).toBeGreaterThan(1)
    expect(Math.abs(bad.metrics.bias)).toBeGreaterThan(1e4) // 600 個 block 就漂離數萬 fs
    expect(bad.metrics.diverged).toBe(false) // |G| ≤ max|x_ref| ⇒ 每個 block 最多移動 |μ|·max|x|
    expect(bad.checks.meanW.status).toBe('n/a')
    expect(bad.checks.meanW.note).toContain('極性錯誤')
    expect(bad.checks.replay.status).toBe('ok') // 兩份程式仍然一致——一致不代表正確
    const rep = buildLabReport(bad, { appVersion: 'x', gitCommit: 'y', generatedAt: 'z' })
    expect(() => JSON.stringify(rep)).not.toThrow()
    expect((rep.warnings as string[]).some((w) => w.includes('gain_step'))).toBe(true)
    expect(pipelineExport(bad).block_k.length).toBe(601)
    // 沒有可比的迴路預測 ⇒ Analytic 欄是「不適用」：既不亂報 mismatch，也不因為旁支子檢查通過就亮綠燈
    expect((pipelineCrossCheck(bad).analytic as { status: string }).status).toBe('n/a')
    expect(bad.checks.noiseMix.status).toBe('ok')
    expect((pipelineCrossCheck(bad).monteCarlo as { status: string }).status).toBe('n/a')
  })
})

describe('PSD → ℒ(f)（E28）', () => {
  it('S_t = 2A²/Δf 的等效：ℒ = 10log10((2πf_out)²S_t/2)；非正值回傳 NaN（不畫）', () => {
    const fOut = 13e9
    const k = 2 * Math.PI * fOut * 1e-15
    const L = timingPsdToDbc([1e-6, 0, -1, 4e-6], fOut)
    expect(L[0]).toBeCloseTo(10 * Math.log10((k * k * 1e-6) / 2), 10)
    expect(Number.isNaN(L[1])).toBe(true)
    expect(Number.isNaN(L[2])).toBe(true)
    expect(L[3] - L[0]).toBeCloseTo(10 * Math.log10(4), 10) // PSD ×4 ⇒ +6.02 dB
  })
})

describe('FCW sweep 的摘要與交叉比對', () => {
  const base: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', regressor: 'delayed', codeDelay: 64, normalization: 'standardize' }
  const opts = { ...DEFAULT_SWEEP_OPTIONS, slopeBlocks: 16 }
  const pts = sweepFcwChunk({ base, fracs: [2e-5, 1e-3, 5.5e-3, 0.2], opts, offset: 0 }).points

  it('反面（code misalignment）：D = 64 在近整數與 α = 0.0055 讓 C ≤ 0；摘要與警告點名這些 α 並說明原因', () => {
    const s = summarizeSweep(pts, opts.loopBlocks)
    expect(s.n).toBe(4)
    expect(s.flips.map((p) => p.frac)).toEqual([2e-5, 5.5e-3])
    expect(s.minC).toBeLessThan(0)
    expect(s.maxRho).toBeGreaterThan(1)
    const w = sweepWarnings(s, opts)
    expect(w[0]).toContain('更新極性錯誤')
    expect(w[0]).toContain('減小 $\\mu$ 不會改變符號')
    for (const x of w) expectTexOk(x)
    expect(sweepWarnings(summarizeSweep([pts[1], pts[3]], 600), opts)).toEqual([]) // 沒問題的點不產生警告
  })

  it('一階 DSM 開 LSB dither 仍然是鋸齒：近整數的點同樣不拿去和 blockLms 的 2^17 視窗比（不會因為「沒有嚴格週期」就被當成 noise-like）', () => {
    const d = sweepFcwChunk({ base: { ...base, dither: true, regressor: 'raw', codeDelay: 0 }, fracs: [2e-5, 0.2], opts: { ...opts, slopeMc: false }, offset: 0 }).points
    expect(d.map((p) => p.P)).toEqual([0, 0]) // 有 dither ⇒ 沒有封閉式的週期
    expect(d.map((p) => p.sawtooth)).toEqual([true, true])
    const cc = sweepCrossCheck(d, { ...opts, slopeMc: false }, false)
    // α = 2e-5：2^17 個樣本內只有 2.6 個鋸齒 ⇒ 不比；α = 0.2 可比
    expect((cc.analytic as { note: string }).note).toContain('1/2 個可比的點')
    const mash = sweepFcwChunk({ base: { ...base, codeSource: 'mash111', regressor: 'raw', codeDelay: 0 }, fracs: [2e-5], opts: { ...opts, slopeMc: false }, offset: 0 }).points
    expect(mash[0].sawtooth).toBe(false)
    expect((sweepCrossCheck(mash, { ...opts, slopeMc: false }, false).analytic as { note: string }).note).toContain('1/1 個可比的點')
  })

  it('交叉比對：MC 斜率在 mean-field 斜率的 2 倍 CI 半寬內 ⇒ ok；關掉斜率量測 ⇒ n/a；定點 ⇒ not-implemented（誠實標示）', () => {
    const cc = sweepCrossCheck(pts, opts, false)
    expect((cc.monteCarlo as { status: string }).status).toBe('ok')
    expect((cc.fixedPoint as { status: string }).status).toBe('n/a')
    expect((sweepCrossCheck(pts, { ...opts, slopeMc: false }, true).monteCarlo as { status: string }).status).toBe('n/a')
    expect((sweepCrossCheck(pts, opts, true).fixedPoint as { status: string }).status).toBe('not-implemented')
    expect(sweepCrossCheck([], opts, false)).toEqual({ analytic: 'n/a', monteCarlo: 'n/a', fixedPoint: 'n/a' })
    // 反面：把 MC 斜率竄改成反號 ⇒ mismatch
    const forged = pts.map((p) => (p.slope ? { ...p, slope: { ...p.slope, S: -p.slope.S - 1 } } : p))
    expect((sweepCrossCheck(forged, opts, false).monteCarlo as { status: string }).status).toBe('mismatch')
  })

  it('CSV：每點一列、欄位長度一致', () => {
    const c = sweepExport(pts)
    for (const col of Object.values(c)) expect(col.length).toBe(4)
    expect(Array.from(c.sign_flip as number[])).toEqual([1, 0, 1, 0])
  })
})

describe('Monte Carlo 的摘要', () => {
  it('T13: 8 個 seeds 的指標表與交叉比對（mean w、σ_w 都與線性模型一致；沒開定點 ⇒ Fixed-Point n/a）', () => {
    const p: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'iid_pm_one', pll: 'none', blocks: 600, outBlocks: 16 }
    const chunks = [runMcChunk({ base: p, seeds: mcSeeds(p.seed, 0, 4) }), runMcChunk({ base: p, seeds: mcSeeds(p.seed, 4, 4) })]
    const s = combineMc(chunks)
    const c = mcChecks(s, chunks[0].analytic, p)
    const rows = mcMetrics(s, c.lin, p.aFs, chunks[0].analytic.sigmaWPred)
    for (const m of rows) {
      expectTexOk(m.name)
      if (m.note) expectTexOk(m.note)
    }
    expect(rows[0].value).toBe('8 / 8')
    const cc = mcCrossCheck(c, false)
    expect((cc.analytic as { status: string }).status).toBe('ok')
    expect((cc.monteCarlo as { status: string }).status).toBe('ok')
    expect((cc.fixedPoint as { status: string }).status).toBe('n/a')
    expect((mcCrossCheck(c, true).fixedPoint as { status: string }).status).toBe('not-implemented')
    expect(mcCrossCheck(null, false).analytic).toBe('n/a')
  }, 60_000)
})

describe('量化策略 what-if 用到的第 13 章函式', () => {
  it('T16: 目標 32.4 LSB：toggle pattern 平均 32.4、週期 5；一階 EFB 的輸出平均也是 32.4', () => {
    const cyc = toggleCycle(32.4, 5)
    expect(cyc.reduce((a, b) => a + b, 0) / 5).toBeCloseTo(32.4, 12)
    const efb = efbConstant({ target: 32.4, steps: 10, bits: 6 })
    expect(efbPeriod(efb.W, efb.D)).toBe(5)
    expect(efb.y.reduce((a, b) => a + b, 0) / 10).toBeCloseTo(32.4, 12)
  })

  it('T17: stochastic rounding 的誤差變異 p(1 − p) = 0.24 LSB²（p = 0.4）', () => {
    const b = bernoulliMoments(32, 0.4)
    expect(b.mean).toBeCloseTo(32.4, 12)
    expect(b.variance).toBeCloseTo(0.24, 12)
  })

  it('sig：一般數字去尾端 0、極小值用指數、非有限值有明確符號', () => {
    expect(sig(0.25)).toBe('0.25')
    expect(sig(1234.5678, 6)).toBe('1234.57')
    expect(sig(1.5e-7, 3)).toBe('1.5e-7')
    expect(sig(NaN)).toBe('NaN')
    expect(sig(null)).toBe('—')
    expect(sig(Infinity)).toBe('∞')
  })
})

describe('技術審查的回歸測試（R02、R03、R06b）：/lab 的文字與它自己的模型一致', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), 'src/pages/lab', f), 'utf8')

  it('R03：filtered-x、Ĥ = H_PD（g_m = 1、D_x = 0）時 C 只有 D = 0 保證 ≥ 0；D = 1 就變號——§4.6 表格下的數字（FX_DELAY_EXAMPLE）就是 analyzeLab 的結果', () => {
    const fx = (D: number) => analyzeLab({ ...DEFAULT_LAB_PARAMS, regressor: 'filtered', fxGain: 1, fxExtraDelay: 0, codeDelay: D }).analytic
    const a = FX_DELAY_EXAMPLE.delays.map((D) => fx(D))
    // D = 0：C = E[u_x²] > 0，pole 在單位圓內；D = 1：C < 0、pole > 1（極性反轉）；D = 2：又變回正的、但很小
    expect(a[0].Cest).toBeGreaterThan(0.95)
    expect(a[0].p).toBeLessThan(1)
    expect(a[1].Cest).toBeLessThan(-0.6)
    expect(a[1].p).toBeGreaterThan(1)
    expect(a[2].Cest).toBeGreaterThan(0.1)
    expect(a[2].Cest).toBeLessThan(0.25)
    // 頁面上寫的兩位小數
    a.forEach((x, i) => expect(Math.abs(x.Cest - FX_DELAY_EXAMPLE.C[i]), `D=${FX_DELAY_EXAMPLE.delays[i]}：C=${x.Cest}`).toBeLessThan(0.005))
    expect(Math.abs(a[1].p - FX_DELAY_EXAMPLE.poleAtD1)).toBeLessThan(0.005)
    // MASH 1-1-1 的 residue 近似 (1 − z⁻¹)² 整形的白雜訊：R[1]/R[0] = −4/6、R[2]/R[0] = 1/6（H_PD 在這些頻率幾乎是 1）
    expect(a[1].Cest / a[0].Cest).toBeCloseTo(-2 / 3, 2)
    expect(a[2].Cest / a[0].Cest).toBeCloseTo(1 / 6, 2)
    // 文字：filtered-x 那一列寫出 D，並且不再無條件地說「Ĥ = H 時 = E[u_x²] ≥ 0」
    const s2 = src('sections/S2Chain.tsx')
    expect(s2).toContain(String.raw`C_{f,D}=E\\bigl[\\hat u[n-D]\\,u_x[n]\\bigr]`)
    expect(s2).toContain(String.raw`<Tex>{'D=0'}</Tex> 時 <Tex>{'=E[u_x^2]\\ge0'}</Tex>`)
    expect(s2).toContain(String.raw`<Tex>{'D\\ne0'}</Tex> 時 <Tex>{'=R_u[D]'}</Tex>，可以是負的`)
    expect(s2).toContain('設錯')
    expect(s2).not.toContain(String.raw`<Tex>{'\\hat H=H'}</Tex> 時 <Tex>{'=E[u_x^2]\\ge0'}</Tex>`)
    expect(s2).toContain('FX_DELAY_NOTE')
  })

  it('R02：τ = −1/ln ρ 那一列——d = 0 是精確的 1/e 時間；d ≥ 1 只是漸近衰減率（ρ^k 不是誤差的包絡），標成近似並加註', () => {
    const r0 = tauMetricRow(12.03, 0)
    expect(r0.claim).toBe('exact')
    expectTexOk(r0.name)
    expectTexOk(r0.note as string)
    const r1 = tauMetricRow(1.4427, 1)
    expect(r1.claim).toBe('approx')
    expect(r1.name).toContain('漸近衰減率')
    expect(r1.note).toContain('不是平均誤差的包絡')
    expectTexOk(r1.name)
    expectTexOk(r1.note as string)
    // 反例：d = 1、g = 1/4 是重根 1/2：τ = 1/ln 2 = 1.4427 個 block，但平均誤差要 7 個 block 才低於 5%，而且每一步都在 ρ^k 之上
    const rho = delayLoopRadius(0.25, 1)
    expect(rho).toBeCloseTo(0.5, 6)
    expect(-1 / Math.log(rho)).toBeCloseTo(1.4427, 3)
    const y = meanDeltaTrajectory(1, 0.25, 1, 12)
    expect(Array.from(y.slice(1, 6))).toEqual([0.75, 0.5, 0.3125, 0.1875, 0.109375])
    for (let k = 1; k <= 12; k++) expect(y[k], `k=${k}`).toBeGreaterThan(rho ** k)
    expect(y[6]).toBeGreaterThan(0.05)
    expect(y[7]).toBeLessThan(0.05)
    // d = 0：|δ_k| = ρ^k 是等式
    const y0 = meanDeltaTrajectory(1, 0.25, 0, 8)
    for (let k = 0; k <= 8; k++) expect(y0[k]).toBeCloseTo(0.75 ** k, 12)
    // 模擬後的指標表與即時解析表都用同一個函式；登錄的條件也寫出來
    expect(src('logic.ts')).toContain('tauMetricRow(an.tauBlocks, r.params.updateDelay)')
    expect(src('tabs/PipelineTab.tsx')).toContain('tauMetricRow(an.tauBlocks, updateDelay)')
    expect(FORMULAS.find((f) => f.id === 'F-LAB.7')?.conditions).toContain('不是平均誤差的包絡')
    expect(FORMULAS.find((f) => f.id === 'F-LAB.17')?.conditions).toContain('漸近')
  })

  it('R06b：多參數的 u_pd ≈ Σ δθ_j φ_{u,j} 寫 ≈，並說明前提（δθ_j 在 H_PD 的記憶長度內近似常數）；F-LAB.15 的條件同步', () => {
    const s3 = src('sections/S3Analysis.tsx')
    expect(s3).toContain(String.raw`u_{\mathrm{pd}}[n]\approx\sum_j\delta\theta_j\,\phi_{u,j}[n]`)
    expect(s3).not.toContain(String.raw`u_{\mathrm{pd}}[n]=\sum_j\delta\theta_j\,\phi_{u,j}[n]`)
    expect(s3).toContain('記憶長度內近似常數，才能提到濾波器外面')
    expect(FORMULAS.find((f) => f.id === 'F-LAB.15')?.conditions).toContain('記憶長度內近似不變')
  })
})
