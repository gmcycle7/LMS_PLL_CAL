import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'
import { createRng, effectiveSampleSize, erf } from '@/simulation/core'
import { toneFit } from '@/simulation/signal'
import { DsmStream } from '@/simulation/models/dsm'
import { runBlockLms, runBlockLmsMonteCarlo, analyzeBlockLms, parseBlockLmsConfig } from '@/simulation/models/blockLms'
import { bw3dbExact } from '@/simulation/models/calNoise'
import {
  DEFAULT_LAB_PARAMS,
  DEFAULT_SWEEP_OPTIONS,
  DEFAULT_TRAINING_PATTERN,
  LAB_PARAM_LABEL,
  LAB_RANGES,
  SNIPPET_SAMPLES,
  analyzeLab,
  analyzeTraining,
  ar1MeanVar,
  calBandwidths,
  combineMc,
  convergenceBlocks,
  delayLoopRadius,
  dtMag2,
  erfFast,
  fcwGrid,
  firstOrderResidueStats,
  foldFrequency,
  labParamErrors,
  linearPrediction,
  logTrapz,
  lowpass3dbHz,
  makeTone,
  mcChecks,
  mcSeeds,
  meanDeltaTrajectory,
  meanFieldTwin,
  outputFrequencyHz,
  pllDesign,
  quasiStaticFixedPoint,
  replayPipeline,
  routeWarning,
  runMcChunk,
  runPipeline,
  significantTones,
  sweepFcwChunk,
  texNum,
  toneSignificanceDb,
  toBlockLmsConfig,
  type1PoleFromBw,
  type LabParams,
  prepareLab,
  runLabLoop,
  usesLegacyEngine,
  PHOS_PATTERN,
  GOS_INDEX,
  phosOffsets,
  combineMcMimo,
  mcMimoChecks,
  cppll3Loop,
  cppll3InversionEdge,
  cppll3MinusReL,
  pmuxClosedFormEigen,
  pmuxUniformStepLimits,
  codeIndependentOfSeed,
} from './unifiedLab'
import { cppllFinv, cppllMinusReL, inversionBands as sspllBands, makeL3 } from '@/simulation/models/sspll'
import { eigSym } from '@/simulation/core'

interface GoldenVector {
  inputs: Record<string, number>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function golden(id: string): GoldenVector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${id}.json`), 'utf8')) as GoldenVector
}

function expectGolden(v: GoldenVector, key: string, actual: number): void {
  const e = v.expected[key] as number
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e)
  expect(Math.abs(actual - e), `${key}: ${actual} vs ${e}`).toBeLessThanOrEqual(bound)
}

/** 小而快的設定（單元測試用） */
const SMALL: LabParams = { ...DEFAULT_LAB_PARAMS, N: 512, blocks: 300, outBlocks: 32 }

describe('LabParams 驗證與對應', () => {
  it('預設參數合法；每個範圍的 min < max', () => {
    expect(labParamErrors(DEFAULT_LAB_PARAMS)).toEqual([])
    for (const r of Object.values(LAB_RANGES)) expect(r.min).toBeLessThan(r.max)
  })

  it('反面：超出範圍、N×blocks 過大、PLL 頻寬超過 Nyquist、internal < physical 都會被擋下並說明原因', () => {
    const e1 = labParamErrors({ ...DEFAULT_LAB_PARAMS, N: 65536, blocks: 20000 })
    expect(e1.some((e) => e.includes('N × blocks'))).toBe(true)
    const e2 = labParamErrors({ ...DEFAULT_LAB_PARAMS, pllBwHz: 2.5e9 })
    expect(e2.some((e) => e.includes('Nyquist'))).toBe(true)
    const e3 = labParamErrors({ ...DEFAULT_LAB_PARAMS, internalBits: 4, physicalBits: 6 })
    expect(e3.some((e) => e.includes('internalBits'))).toBe(true)
    const e4 = labParamErrors({ ...DEFAULT_LAB_PARAMS, N: 100.5 })
    expect(e4.some((e) => e.includes('整數'))).toBe(true)
    expect(() => runPipeline({ ...DEFAULT_LAB_PARAMS, fHHz: 10, fLHz: 100 })).toThrow(/f_H/)
  })

  it('toBlockLmsConfig：raw 模式把 code delay 設為 0；f_out = (N_int + frac_eff)·f_ref', () => {
    const cfg = toBlockLmsConfig({ ...DEFAULT_LAB_PARAMS, regressor: 'raw', codeDelay: 17 })
    expect(cfg.gm_code_delay_samples).toBe(0)
    const cfg2 = toBlockLmsConfig({ ...DEFAULT_LAB_PARAMS, regressor: 'delayed', codeDelay: 17 })
    expect(cfg2.gm_code_delay_samples).toBe(17)
    const f = outputFrequencyHz({ ...DEFAULT_LAB_PARAMS, frac: 0.25, nInt: 3, fRefHz: 4e9 })
    expect(f).toBe(13e9) // 0.25 在 20 bit 下精確 ⇒ 13 GHz（規格 §15.3 的 output_frequency_hz）
  })
})

describe('PLL 誤差路徑（Type-I 封閉式、Type-II、T = 1 − H_PD）', () => {
  it('Type-I：ρ = (√(1+s²) − s)² 反解的 −3 dB 與 calNoise 的 exact 公式一致（相對誤差 < 1e-10）', () => {
    for (const fbw of [1e5, 2e6, 5e7, 4e8]) {
      const rho = type1PoleFromBw(fbw, 4e9)
      expect(Math.abs(bw3dbExact(rho, 4e9) / fbw - 1)).toBeLessThan(1e-10) // arccos 在小角度的條件數 ⇒ 1e-12 等級的捨入
      // 數值求解 T 的 −3 dB 也一致
      const des = pllDesign({ pll: 'type1', pllBwHz: fbw, fRefHz: 4e9, zeta: 0.7, loopDelay: 0 })
      expect(Math.abs(des.f3dbTHz / fbw - 1)).toBeLessThan(1e-6)
    }
  })

  it('Type-I / Type-II：H_PD(1) = 0（DC null，E03）、T(1) = 1、H + T = 1（每個頻率）', () => {
    for (const pll of ['type1', 'type2'] as const) {
      const des = pllDesign({ pll, pllBwHz: 2e6, fRefHz: 4e9, zeta: 0.7, loopDelay: 1 })
      expect(des.hpdDc).toBeLessThan(1e-12)
      expect(Math.abs(dtMag2(des.T, 0) - 1)).toBeLessThan(1e-9)
      expect(des.stable).toBe(true)
      for (const om of [1e-4, 3e-3, 0.1, 1, 3]) {
        // H + T = 1 ⇒ 分子相加等於分母（係數層級）
        const n = Math.max(des.H.b.length, des.T.b.length, des.H.a.length)
        for (let i = 0; i < n; i++) expect((des.H.b[i] ?? 0) + (des.T.b[i] ?? 0)).toBeCloseTo(des.H.a[i] ?? 0, 12)
        expect(Number.isFinite(dtMag2(des.H, om))).toBe(true)
      }
    }
  })

  it('Type-II 的實際 DT −3 dB 與 CT 原型設計值接近（ω_nT_s ≪ 1）', () => {
    const des = pllDesign({ pll: 'type2', pllBwHz: 2e6, fRefHz: 4e9, zeta: 0.7, loopDelay: 0 })
    expect(des.wnTs).toBeLessThan(0.01)
    expect(Math.abs(des.f3dbTHz / 2e6 - 1)).toBeLessThan(0.02)
  })

  it('反面：loop latency 太大時主 PLL 線性模型不穩定，並給出原因', () => {
    const des = pllDesign({ pll: 'type1', pllBwHz: 4e8, fRefHz: 4e9, zeta: 0.7, loopDelay: 16 })
    expect(des.stable).toBe(false)
    expect(des.warnings.some((w) => w.includes('不穩定'))).toBe(true)
  })

  it('none：H = T = 1，lowpass3dbHz 回傳 NaN（沒有 low-pass）', () => {
    const des = pllDesign({ pll: 'none', pllBwHz: 2e6, fRefHz: 4e9, zeta: 0.7, loopDelay: 0 })
    expect(des.H).toEqual({ b: [1], a: [1] })
    expect(Number.isNaN(des.f3dbTHz)).toBe(true)
    expect(Number.isNaN(lowpass3dbHz({ b: [1], a: [1] }, 4e9))).toBe(true)
  })
})

describe('一階 DSM residue 的封閉式', () => {
  it('E[r]、E[r²]、基頻 A₁ = 1/(P sin(π/P)) 與直接產生的序列一致（整數週期）', () => {
    for (const [frac, bits] of [
      [0.3, 8],
      [0.1, 10],
      [0.5, 8],
      [3 / 64, 8],
      [0.0123, 12],
    ] as const) {
      const st = firstOrderResidueStats(frac, bits)
      const s = new DsmStream({ kind: 'first_order', frac, bits })
      const L = st.P * Math.max(4, Math.ceil(4096 / st.P))
      const r = new Float64Array(L)
      for (let i = 0; i < L; i++) {
        s.step()
        r[i] = s.residue
      }
      let m = 0
      let m2 = 0
      for (const v of r) {
        m += v
        m2 += v * v
      }
      m /= L
      m2 /= L
      expect(m).toBeCloseTo(st.mean, 12)
      expect(m2).toBeCloseTo(st.meanSquare, 12)
      expect(st.variance).toBeCloseTo(st.meanSquare - st.mean * st.mean, 12)
      if (st.P > 2) {
        const f1 = foldFrequency(st.fracEff, 1)
        const fit = toneFit(r, 1, f1)
        expect(fit.amplitudePeak).toBeCloseTo(st.line1, 9)
      } else {
        expect(st.line1).toBe(0.25) // P = 2：Nyquist 線
      }
    }
  })

  it('P → ∞ 時 E[r] → −½、E[r²] → ⅓、A₁ → 1/π', () => {
    const st = firstOrderResidueStats(0.3, 24)
    expect(st.mean).toBeCloseTo(-0.5, 6)
    expect(st.meanSquare).toBeCloseTo(1 / 3, 6)
    expect(st.line1).toBeCloseTo(1 / Math.PI, 10)
  })
})

describe('T13 / T14 / T15 錨點（golden vectors）', () => {
  const t13Params: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'iid_pm_one', pll: 'none', blocks: 400, outBlocks: 16 }

  it('T13: 整合 pipeline 的 iid ±1、identity、average 模式重現 K、g、p、σ_w（golden）', () => {
    const v = golden('T13')
    const a = analyzeLab(t13Params).analytic
    expectGolden(v, 'K_per_fs', a.K)
    expectGolden(v, 'g', a.g)
    expectGolden(v, 'p', a.p)
    expectGolden(v, 'sigma_w_fs', a.sigmaWPred)
  })

  it('T13: 反面測試——sum 模式沿用 average 的 μ ⇒ g × N = 326.8，pole −325.8，且有警告', () => {
    const v = golden('T13')
    const r = analyzeLab({ ...t13Params, gmMode: 'sum' })
    expectGolden(v, 'g_sum_mode', r.analytic.g)
    expectGolden(v, 'pole_sum_mode', r.analytic.p)
    expect(r.warnings.some((w) => w.includes('gm_mode=sum'))).toBe(true)
    expect(routeWarning(r.warnings.find((w) => w.includes('gm_mode=sum')) as string)).toBe('gmac')
  })

  it('T14: f_u、exact −3 dB、−ln p、(1 − p) 近似、ENBW 四種頻寬（golden）', () => {
    const v = golden('T14')
    const bw = calBandwidths(v.inputs.p, v.inputs.fs_hz / v.inputs.N)
    expectGolden(v, 'f_u_hz', v.inputs.fs_hz / v.inputs.N)
    expectGolden(v, 'bw_exact_3db_hz', bw.exact)
    expectGolden(v, 'bw_neg_ln_p_hz', bw.negLnP)
    expectGolden(v, 'bw_one_minus_p_hz', bw.oneMinusP)
    expectGolden(v, 'enbw_one_sided_hz', bw.enbw)
    // 整合 pipeline 的 analytic 也給出同一個 f_u 與 exact −3 dB
    const a = analyzeLab(t13Params)
    expect(a.analytic.fuHz).toBe(976562.5)
    expect(Math.abs(a.bandwidths.exact / (v.expected.bw_exact_3db_hz as number) - 1)).toBeLessThan(1e-9)
  })

  it('T15: 0.5 fs peak timing tone @ 13 GHz ⇒ −93.80 dBc（小角與 Bessel 精確）', () => {
    const v = golden('T15')
    const t = makeTone(90e3, v.inputs.At_peak_s * 1e15, v.inputs.f_out_hz, 'closed-form')
    expectGolden(v, 'spur_dbc', t.dbc)
    expectGolden(v, 'spur_dbc_bessel', t.dbcBessel)
  })

  it('T13: Monte Carlo（多 seeds、分段累加）的 σ_w 95% CI 與預測 0.399 fs 一致', () => {
    const p: LabParams = { ...t13Params, blocks: 800 }
    const chunks = [runMcChunk({ base: p, seeds: mcSeeds(p.seed, 0, 4) }), runMcChunk({ base: p, seeds: mcSeeds(p.seed, 4, 4) })]
    const s = combineMc(chunks)
    const c = mcChecks(s, chunks[0].analytic, p)
    expect(c.sigmaW.status).toBe('ok')
    expect(c.meanW.status).toBe('ok')
    expect(s.sigmaW.lo).toBeLessThan(0.3992)
    expect(s.sigmaW.hi * 1.15).toBeGreaterThan(0.3992)
  }, 60_000)
})

describe('審查 R02：含延遲的 τ 只是漸近衰減率', () => {
  it('「LMS 更新」卡片：d = 0 時 τ 標 exact；d ≥ 1 時改名為漸近衰減率、標 approx，並說明 ρ^k 不是包絡', () => {
    const tauRow = (updateDelay: number) => {
      const r = runPipeline({ ...SMALL, updateDelay })
      return r.stages.find((st) => st.id === 'update')!.metrics.find((m) => m.name.includes('\\tau=-1/\\ln\\rho'))!
    }
    const d0 = tauRow(0)
    expect(d0.claim).toBe('exact')
    expect(d0.name).not.toContain('漸近')
    const d1 = tauRow(1)
    expect(d1.claim).toBe('approx')
    expect(d1.name).toContain('漸近衰減率')
    expect(d1.note).toContain('不是平均誤差的包絡')
    // 數值本身不變：仍是 −1/ln ρ
    expect(Number.isFinite(d1.value as number)).toBe(true)
  })

  it('反例（g = 1/4、d = 1，雙根 1/2）：τ = 1/ln 2 ≈ 1.4427，但 δ_k = (1 + k/2)·2^{-k} 要到 k = 7 才低於 5%', () => {
    const delta = (k: number) => (1 + k / 2) * 2 ** -k
    expect(-1 / Math.log(0.5)).toBeCloseTo(1.4426950408889634, 12)
    expect(Math.ceil(Math.log(0.05) / Math.log(0.5))).toBe(5)
    expect(delta(5)).toBe(0.109375)
    expect(delta(6)).toBe(0.0625)
    expect(delta(7)).toBe(0.03515625)
    // 直接遞推 δ[k+1] = δ[k] − g·δ[k−1]，歷史 δ[−1] = δ[0] = 1
    let prev = 1
    let cur = 1
    const seq = [cur]
    for (let k = 0; k < 8; k++) {
      const nxt = cur - 0.25 * prev
      prev = cur
      cur = nxt
      seq.push(cur)
    }
    for (let k = 0; k <= 8; k++) expect(seq[k]).toBeCloseTo(delta(k), 14)
    expect(seq.findIndex((v) => Math.abs(v) < 0.05)).toBe(7)
  })
})

describe('跨級一致性：replay 與 runBlockLms 逐位元相同', () => {
  const cases: [string, Partial<LabParams>][] = [
    ['MASH + Type-II + raw', {}],
    ['一階 + Type-II + delayed D=64', { codeSource: 'dsm_first_order', frac: 1e-3, regressor: 'delayed', codeDelay: 64 }],
    ['filtered-x + Ĥ 失配 + Type-I d=2', { pll: 'type1', loopDelay: 2, regressor: 'filtered', codeDelay: 3, fxGain: 0.8, fxExtraDelay: 2 }],
    ['定點 6-bit + stochastic rounding + 更新延遲', { quantize: true, rounding: 'stochastic', updateDelay: 2, aFs: 3.05, sigmaV: 20 }],
    ['unipolar_unmapped_bug + offset + INL', { encoding: 'unipolar_unmapped_bug', compOffsetFs: 3, c2: 0.2, c3: 0.05, dtcOffsetFs: 1 }],
    ['unipolar_mapped + sum 模式（小 μ）', { encoding: 'unipolar_mapped', gmMode: 'sum', muFs: 0.01 }],
    ['iid ±1 + none', { codeSource: 'iid_pm_one', pll: 'none' }],
  ]
  for (const [name, over] of cases) {
    it(`${name}：重播 G_k 最大差 = 0`, () => {
      const r = runPipeline({ ...SMALL, ...over })
      expect(r.replay?.maxAbsDiffG).toBe(0)
      expect(r.checks.replay.status).toBe('ok')
      expect(r.replay?.blocksCompared).toBe(SMALL.blocks)
    })
  }

  it('連續 sample 片段（snippet）：最後一個 block 開頭的連續樣本；每一級的關係逐點成立（e_DTC = (a − w_app)x + d(x)、q = sign(e)）', () => {
    const p: LabParams = { ...SMALL, codeSource: 'dsm_first_order', frac: 0.01, c2: 0.2, c3: 0.05, dtcOffsetFs: 1, compOffsetFs: 3, updateDelay: 1 }
    const r = runPipeline(p)
    const s = r.snippet!
    expect(s.n.length).toBe(Math.min(p.N, SNIPPET_SAMPLES))
    expect(s.n[0]).toBe((p.blocks - 1) * p.N)
    expect(s.startSample).toBe(s.n[0])
    for (let i = 1; i < s.n.length; i++) expect(s.n[i] - s.n[i - 1]).toBe(1) // 連續、不抽樣
    for (let i = 0; i < s.n.length; i += 7) {
      const x = s.x[i]
      // DTC 級：用這個 block 實際作用的 gain（更新延遲 d = 1 ⇒ 是前一個 block 的 w）
      expect(s.eDtc[i]).toBeCloseTo((p.aFs - s.wApp) * x + p.dtcOffsetFs + p.c2 * x * x + p.c3 * x * x * x, 10)
      // comparator 級：tie 規則 e ≥ 0 ⇒ +1
      expect(s.q[i]).toBe(s.e[i] >= 0 ? 1 : -1)
      expect(s.xRef[i]).toBe(x) // raw regressor
      expect(Number.isFinite(s.uPd[i]) && Number.isFinite(s.tOut[i])).toBe(true)
    }
    // H_PD + T = 1 ⇒ u_pd + t_out = e_DTC（逐 sample，浮點等級）
    for (let i = 0; i < s.n.length; i += 11) expect(s.uPd[i] + s.tOut[i]).toBeCloseTo(s.eDtc[i], 8)
    // 大 N 時片段長度被夾在 SNIPPET_SAMPLES
    const big = runPipeline({ ...DEFAULT_LAB_PARAMS, blocks: 40, outBlocks: 8 })
    expect(big.snippet!.n.length).toBe(SNIPPET_SAMPLES)
  })

  it('參數的顯示名稱：每個數值參數都有標籤；錯誤訊息用標籤而不是裸的欄位名', () => {
    expect(Object.keys(LAB_PARAM_LABEL).sort()).toEqual(Object.keys(LAB_RANGES).sort())
    const e = labParamErrors({ ...DEFAULT_LAB_PARAMS, sigmaV: -1, dsmBits: 3 })
    expect(e).toHaveLength(2)
    expect(e.some((x) => x.includes('comparator 雜訊') && x.includes('[0, 10000]'))).toBe(true)
    expect(e.some((x) => x.includes('DSM 位元數'))).toBe(true)
  })

  it('stage 報告包含九級、各自有模型層級與假設；模擬層級在定點時為 L5', () => {
    const r = runPipeline({ ...SMALL, quantize: true })
    expect(r.stages.map((s) => s.id)).toEqual(['dsm', 'code', 'dtc', 'pll', 'comparator', 'gmac', 'register', 'update', 'output'])
    for (const s of r.stages) {
      expect(s.assumptions.length).toBeGreaterThan(0)
      expect(s.metrics.length).toBeGreaterThan(0)
    }
    expect(r.stages.find((s) => s.id === 'register')?.level).toBe('L5')
    expect(r.modelLevel).toBe('L5')
    expect(r.version).toMatch(/^unifiedLab\//)
  })

  it('架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端、殘差在 PD 的 reference 輸入注入（+H_PD、+T）、comparator 取 PD 的輸出', () => {
    const r = runPipeline({ ...SMALL, codeSource: 'dsm_first_order', frac: 0.01, normalization: 'unit_rms', dither: false })
    const stage = (id: string) => r.stages.find((s) => s.id === id)!.assumptions.join('\n')
    // ③ DTC：位置與「補償量」的說法；線性項仍是 (a − w_app)x
    expect(stage('dtc')).toContain('DTC 在 reference 輸入端')
    expect(stage('dtc')).toContain('補償量')
    expect(stage('dtc')).toContain('(a-w_{\\mathrm{app}})\\,x')
    // ④ PLL error path：注入在 PD 的 reference 輸入，兩個轉移函數都是正號
    expect(stage('pll')).toContain('PD 的 reference 輸入注入')
    expect(stage('pll')).toContain('u_{\\mathrm{pd}}=+H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}')
    expect(stage('pll')).toContain('t_{\\mathrm{out}}=+T\\{e_{\\mathrm{DTC}}\\}')
    // ⑤ Comparator：輸入是 PD 的輸出（送進 loop filter 的同一個訊號）
    expect(stage('comparator')).toContain('comparator 取的是 PD 的輸出')
    expect(stage('comparator')).toContain('送進 loop filter 的同一個訊號')
    expect(r.assumptions.join('\n')).toContain('DTC 在 reference 輸入端，回授路徑只有 divider；comparator 取 PD 的輸出')
    // 這幾句都會顯示在 Calibration Lab 的每級卡片上：`$...$` 成對，而且每一段都是 KaTeX 能解析的 TeX
    for (const text of [...r.assumptions, ...r.stages.flatMap((st) => st.assumptions)]) {
      expect((text.match(/(?<!\\)\$/g) ?? []).length % 2, text).toBe(0)
      for (const m of text.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)) expect(() => katex.renderToString(m[1], { throwOnError: true, strict: 'ignore' }), m[1]).not.toThrow()
    }
    // 舊接法的說法不能再出現
    const all = [...r.assumptions, ...r.stages.flatMap((s) => [...s.assumptions, ...s.metrics.map((m) => `${m.name} ${m.note ?? ''}`)])].join('\n')
    expect(all).not.toMatch(/比較端|divider 之後|插入延遲|插入的延遲/)
    expect(all).not.toMatch(/(feedback|回授) ?側/)
    // 文字寫的正號就是模型算的：u_pd = +H_PD{e_DTC}、t_out = +T{e_DTC}，H_PD + T = 1 ⇒ 相加回到 e_DTC
    const s = r.snippet!
    for (let i = 0; i < s.n.length; i += 5) expect(s.uPd[i] + s.tOut[i]).toBeCloseTo(s.eDtc[i], 8)
    // 這個模型的 x 是正規化後的 residue r（未置中的一階 DSM：x ≤ 0），和 §2a 的 x = s/M = −r 差一個負號（檔頭有說明）
    expect(Math.max(...s.x)).toBeLessThanOrEqual(0)
    // 忽略主 PLL 的教學基準（H_PD = T = 1）：文字不寫 T = 1 − H_PD，PD 與輸出都直接看到 e_DTC
    const none = runPipeline({ ...SMALL, pll: 'none' })
    const nonePll = none.stages.find((st) => st.id === 'pll')!.assumptions.join('\n')
    expect(nonePll).toContain('PD 的 reference 輸入注入')
    expect(nonePll).toContain('u_{\\mathrm{pd}}=+e_{\\mathrm{DTC}}')
    expect(nonePll).not.toContain('T=1-H_{\\mathrm{PD}}')
    // 整份報告最上面的假設清單也一樣：有主 PLL 時寫 T = 1 − H_PD；教學基準（H_PD = T = 1）不能再寫這一句（1 ≠ 1 − 1）
    expect(DEFAULT_LAB_PARAMS.pll).not.toBe('none')
    expect(r.assumptions.join('\n')).toContain('$T=1-H_{\\mathrm{PD}}$（線性、時不變）')
    expect(none.assumptions.join('\n')).not.toContain('T=1-H_{\\mathrm{PD}}')
    expect(none.assumptions.join('\n')).toContain('這個基準不滿足 $H_{\\mathrm{PD}}+T=1$')
    for (const text of [...none.assumptions, ...none.stages.flatMap((st) => st.assumptions)]) {
      expect((text.match(/(?<!\\)\$/g) ?? []).length % 2, text).toBe(0)
      for (const m of text.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)) expect(() => katex.renderToString(m[1], { throwOnError: true, strict: 'ignore' }), m[1]).not.toThrow()
    }
    const sn = none.snippet!
    for (let i = 0; i < sn.n.length; i += 5) {
      expect(sn.uPd[i]).toBe(sn.eDtc[i])
      expect(sn.tOut[i]).toBe(sn.eDtc[i])
    }
  })
})

describe('輸出端（L4）：靜態殘差 × code → fractional spur；gain noise 混頻', () => {
  it('一階 DSM 近整數：toneFit 量到的 fractional spur 與封閉式 |a − w̄|·s·A₁·|T(f₁)| 一致；gain-noise RMS 與 σ_w√(x̄² + Var(T{x̃})) 一致', () => {
    const r = runPipeline({ ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', frac: 1e-4, blocks: 800, outBlocks: 64 })
    expect(r.output).not.toBeNull()
    expect(r.checks.spur.status).toBe('ok')
    expect(r.checks.noiseMix.status).toBe('ok')
    const o = r.output!
    expect(o.toneClosedForm!.fHz).toBeCloseTo(foldFrequency(firstOrderResidueStats(1e-4, 20).fracEff * 4e9, 4e9), 3)
    // 近整數 tone（400 kHz）在 PLL 頻寬（2 MHz）內 ⇒ |T| ≈ 1，spur 很大
    expect(o.toneClosedForm!.dbc).toBeGreaterThan(-100)
    // 線性：t_out = T{靜態} + T{gain noise}；RMS² 至少接近兩部分之和（相關項有限）
    expect(o.rmsOut).toBeGreaterThan(Math.max(o.rmsStatic, o.rmsNoise) * 0.99)
  }, 30_000)

  it('PD 看到的（high-pass）與 output 看到的（low-pass）不同：MASH code 的 RMS(u_pd) ≫ RMS(t_out)（§12.3）', () => {
    const r = runPipeline({ ...SMALL, w0Fs: 0, blocks: 60, outBlocks: 16 })
    const o = r.output!
    expect(o.rmsPd).toBeGreaterThan(20 * o.rmsOut)
  })

  it('code 的 DC 讓 gain noise 直接進入輸出：unit_rms（x̄ ≠ 0）比 standardize（x̄ = 0）的 gain-noise 輸出大', () => {
    const base: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', frac: 0.01, N: 1024, blocks: 600, outBlocks: 64 }
    const a = runPipeline({ ...base, normalization: 'unit_rms' })
    const b = runPipeline({ ...base, normalization: 'standardize' })
    expect(Math.abs(a.output!.xMean)).toBeGreaterThan(0.8)
    expect(Math.abs(b.output!.xMean)).toBeLessThan(0.05)
    expect(a.output!.rmsNoise).toBeGreaterThan(5 * b.output!.rmsNoise)
  }, 30_000)

  it('logTrapz 對已知積分正確（∫₁^e 1/f df = 1）', () => {
    expect(logTrapz((f) => 1 / f, 1, Math.E, 2000)).toBeCloseTo(1, 6)
  })
})

describe('迴路小工具', () => {
  it('delayLoopRadius：臨界 g = 2 sin(π/(4d+2))（d = 0…4）', () => {
    for (let d = 0; d <= 4; d++) {
      const gc = 2 * Math.sin(Math.PI / (4 * d + 2))
      expect(delayLoopRadius(gc * 0.999, d)).toBeLessThan(1)
      expect(delayLoopRadius(gc * 1.001, d)).toBeGreaterThan(1)
    }
  })

  it('meanDeltaTrajectory：d = 0 時 δ_k = δ₀(1 − g)^k', () => {
    const t = meanDeltaTrajectory(2, 0.1, 0, 20)
    for (let k = 0; k <= 20; k++) expect(t[k]).toBeCloseTo(2 * Math.pow(0.9, k), 12)
  })

  it('ar1MeanVar：m = 1、ρ = 0 的特例與直接雙重和一致；m ≫ τ 時 → (σ²/m)(1+ρ)/(1−ρ)', () => {
    expect(ar1MeanVar(2, 0.5, 1)).toBe(2)
    expect(ar1MeanVar(2, 0, 10)).toBeCloseTo(0.2, 14)
    for (const [rho, m] of [
      [0.9, 7],
      [-0.4, 11],
      [0.99, 50],
    ] as const) {
      let s = 0
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) s += Math.pow(rho, Math.abs(i - j))
      expect(ar1MeanVar(1, rho, m)).toBeCloseTo(s / (m * m), 12)
    }
    const big = ar1MeanVar(1, 0.9, 1e6)
    expect(big / ((1 / 1e6) * (1.9 / 0.1))).toBeCloseTo(1, 4)
  })

  it('convergenceBlocks：T13 錨點（τ ≈ 12）建議 K_B = 2·max(n_s, 10τ)；極性錯誤、g 太大、σ_v = 0 時回傳原因而不是數字', () => {
    const base: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'iid_pm_one', pll: 'none' }
    const an = analyzeBlockLms(toBlockLmsConfig(base)).analytic
    const c = convergenceBlocks(an, base)
    const tau = -1 / Math.log(an.rhoMean)
    const ns = tau * Math.log((4 * 3) / an.sigmaWPred) // |δ_0| = 3 fs
    expect(c.blocks).toBe(Math.ceil(2 * Math.max(ns, 10 * tau)))
    expect(c.blocks).toBeGreaterThan(200)
    expect(c.blocks).toBeLessThan(300)
    // 反面
    const neg = { ...base, muFs: -10 }
    expect(convergenceBlocks(analyzeBlockLms(toBlockLmsConfig(neg)).analytic, neg).blocks).toBeNull()
    expect(convergenceBlocks(analyzeBlockLms(toBlockLmsConfig(neg)).analytic, neg).reason).toMatch(/極性/)
    const big = { ...base, muFs: 300 }
    expect(convergenceBlocks(analyzeBlockLms(toBlockLmsConfig(big)).analytic, big).reason).toMatch(/臨界值/)
    const noNoise = { ...base, sigmaV: 0 }
    expect(convergenceBlocks(analyzeBlockLms(toBlockLmsConfig(noNoise)).analytic, noNoise).blocks).toBeNull()
    // 需要的 block 數超過上限 ⇒ 夾到上限並說明
    const slow = { ...base, muFs: 0.001, N: 65536 }
    const cs = convergenceBlocks(analyzeBlockLms(toBlockLmsConfig({ ...slow, blocks: 100, outBlocks: 4 })).analytic, slow)
    expect(cs.needed).toBeGreaterThan(cs.blocks as number)
    expect(cs.reason).toMatch(/上限/)
  })

  it('texNum：一般數字去尾端 0；極大 / 極小用 ×10^{n}；NaN、±∞ 有明確符號', () => {
    expect(texNum(0.25)).toBe('0.25')
    expect(texNum(1234.5678, 6)).toBe('1234.57')
    expect(texNum(1e-7)).toBe('10^{-7}')
    expect(texNum(-2.5e8)).toBe('-2.5\\times10^{8}')
    expect(texNum(0)).toBe('0')
    expect(texNum(NaN)).toBe('\\text{NaN}')
    expect(texNum(Infinity)).toBe('\\infty')
  })

  it('linearPrediction：極性錯誤（g ≤ 0）時不套用線性模型並說明原因', () => {
    const an = analyzeBlockLms(toBlockLmsConfig({ ...SMALL, muFs: -5 })).analytic
    const lp = linearPrediction(an, SMALL, 100)
    expect(lp.valid).toBe(false)
    expect(lp.reason).toMatch(/極性/)
  })

  it('linearPrediction：沒有 mean-field 軌跡（或長度不對、含 NaN）時退回線性時不變模型；有的時候用它', () => {
    const an = analyzeBlockLms(toBlockLmsConfig(SMALL)).analytic
    const K = 100
    const lin = linearPrediction(an, SMALL, K)
    expect(lin.model).toBe('linear')
    expect(Array.from(lin.traj)).toEqual(Array.from(lin.trajLinear))
    expect(linearPrediction(an, SMALL, K, new Float64Array(K)).model).toBe('linear') // 長度不是 K + 1
    expect(linearPrediction(an, SMALL, K, new Float64Array(K + 1).fill(NaN)).model).toBe('linear')
    const fake = Float64Array.from({ length: K + 1 }, (_, k) => 1 + 0.01 * k)
    const mf = linearPrediction(an, SMALL, K, fake)
    expect(mf.model).toBe('mean-field')
    expect(mf.traj[K]).toBe(fake[K])
    expect(mf.halfDrift).toBeCloseTo(fake[K] - fake[Math.ceil((K + 1) / 2)], 12)
    expect(Number.isFinite(mf.trajLinear[K])).toBe(true) // 線性模型仍然算出來當對照
  })
})

describe('FCW sweep（§11.4、§16.2）', () => {
  it('凍結 w* ± Δ 的 GMAC 斜率 MC（common random numbers）的 95% CI 涵蓋同一段樣本的 mean-field 斜率', () => {
    const base: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', N: 2048 }
    const res = sweepFcwChunk({ base, fracs: [4e-4, 0.01, 0.2], opts: { ...DEFAULT_SWEEP_OPTIONS, slopeBlocks: 48, deltaFs: 10 }, offset: 0 })
    for (const pt of res.points) {
      const s = pt.slope!
      const half = (s.hi - s.lo) / 2
      expect(Math.abs(s.S - s.Smf)).toBeLessThanOrEqual(2 * half + 1e-12)
      // 小訊號：mean-field 斜率 ≈ K_q·C（線性化）
      expect(Math.abs(s.Smf / s.Klin - 1)).toBeLessThan(0.05)
      // 整段 C 與 blockLms 的 C 估計接近（record 涵蓋很多鋸齒時）
      expect(Math.abs(pt.C - pt.CblockLms)).toBeLessThan(0.02 * Math.max(Math.abs(pt.C), 0.05))
    }
  }, 60_000)

  it('反面：近整數 FCW + code delay 錯位（D = 64）⇒ C ≤ 0、sign flip、ρ > 1，並有中文警告', () => {
    const base: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', regressor: 'delayed', codeDelay: 64, normalization: 'standardize' }
    const res = sweepFcwChunk({ base, fracs: [2e-5], opts: { ...DEFAULT_SWEEP_OPTIONS, slopeMc: false }, offset: 0 })
    const pt = res.points[0]
    expect(pt.signFlip).toBe(true)
    expect(pt.rho).toBeGreaterThan(1)
    expect(pt.warnings.some((w) => w.includes('C ='))).toBe(true)
    // 第 6 章 F-06.18 的近似 C_D/σ² ≈ −12·frac·D + 12 frac²/(ω_nT_s)²：同號、量級 20% 內
    const wT = pllDesign(base).wnTs as number
    const approx = -12 * pt.fracEff * 64 + (12 * pt.fracEff * pt.fracEff) / (wT * wT)
    expect(Math.sign(pt.C)).toBe(Math.sign(approx))
    expect(Math.abs(pt.C / approx - 1)).toBeLessThan(0.2)
  })

  it('近整數時 PE（每個 GMAC block 的 u 能量最小值）≈ 0：H_PD 把慢速鋸齒濾掉，只剩 reset 處的激勵', () => {
    const base: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order' }
    const res = sweepFcwChunk({ base, fracs: [1e-5, 0.2], opts: { ...DEFAULT_SWEEP_OPTIONS, slopeMc: false }, offset: 0 })
    expect(res.points[0].peLambdaMin).toBeLessThan(1e-6)
    expect(res.points[1].peLambdaMin).toBeGreaterThan(0.1)
  })

  it('fcwGrid：log / linear 端點正確', () => {
    const g = fcwGrid(1e-5, 0.5, 5)
    expect(g[0]).toBeCloseTo(1e-5, 15)
    expect(g[4]).toBeCloseTo(0.5, 12)
    expect(g[0]).toBe(1e-5) // 端點不經過 pow / 加法，逐位元等於輸入
    expect(g[4]).toBe(0.5)
    const lin = fcwGrid(0.1, 0.3, 3, 'linear')
    expect(lin[0]).toBe(0.1)
    expect(lin[1]).toBeCloseTo(0.2, 15)
    expect(lin[2]).toBe(0.3)
    // log 格點：相鄰比值固定
    expect(g[2] / g[1]).toBeCloseTo(g[3] / g[2], 12)
  })
})

describe('Monte Carlo 分段累加', () => {
  it('兩段 runMcChunk 合併後的每 block 平均，與一次 runBlockLmsMonteCarlo（同 seeds）一致', () => {
    const p: LabParams = { ...SMALL, blocks: 120 }
    const seeds = mcSeeds(p.seed, 0, 6)
    const s = combineMc([runMcChunk({ base: p, seeds: seeds.slice(0, 2) }), runMcChunk({ base: p, seeds: seeds.slice(2) })])
    const ref = runBlockLmsMonteCarlo({ config: toBlockLmsConfig(p, { record: { sample_trace_blocks: 0, decimate: 1 } }), seeds })
    for (let k = 0; k <= p.blocks; k += 7) {
      expect(s.wMean[k]).toBeCloseTo(ref.wMean[k], 10)
      expect(s.wStd[k]).toBeCloseTo(ref.wStd[k], 8)
    }
    expect(s.meanW.mean).toBeCloseTo(ref.meanW.mean, 12)
    expect(s.runs).toBe(6)
  })
})

describe('Training Sequence（PE、Jacobian 秩、spur）', () => {
  const baseT = {
    seed: 7,
    fRefHz: 4e9,
    nInt: 3,
    pll: 'type2' as const,
    pllBwHz: 2e6,
    zeta: 0.7,
    loopDelay: 0,
    regressor: 'raw' as const,
    codeDelay: 0,
    sigmaV: 100,
    length: 1 << 16,
    N0: 4096,
    maxLag: 64,
    maxDelay: 32,
    residualGainFs: 0.1,
    c2: 0.05,
    c3: 0.02,
    basis: { gain: true, inl2: false, inl3: false, offset: true },
    patterns: [DEFAULT_TRAINING_PATTERN],
  }

  it('E04：H_PD(1) = 0 時 offset 基底結構性不可辨識（scaled J 秩 = 參數數 − 1）；none 路徑時恢復滿秩', () => {
    const r = analyzeTraining(baseT)
    expect(r.patterns[0].rank).toBe(1)
    expect(r.patterns[0].warnings.some((w) => w.includes('E04'))).toBe(true)
    const r2 = analyzeTraining({ ...baseT, pll: 'none' })
    expect(r2.patterns[0].rank).toBe(2)
  })

  it('LSB dither 打不散一階 DSM 的 fractional 譜線（鋸齒還在）；pipeline 的註記依 code 來源說明', () => {
    const r = analyzeTraining({
      ...baseT,
      length: 1 << 17,
      c2: 0,
      c3: 0,
      basis: { gain: true, inl2: false, inl3: false, offset: false },
      patterns: [
        { ...DEFAULT_TRAINING_PATTERN, frac: 1e-3 },
        { ...DEFAULT_TRAINING_PATTERN, frac: 1e-3, dither: true },
      ],
    })
    const [plain, dith] = r.patterns
    expect(plain.tones.length).toBeGreaterThan(0)
    expect(dith.tones.length).toBeGreaterThan(0)
    expect(Math.abs(dith.tones[0].ampFs / plain.tones[0].ampFs - 1)).toBeLessThan(0.05) // 振幅幾乎不變
    expect(Math.abs(dith.rawStd / plain.rawStd - 1)).toBeLessThan(0.01)
    const first = runPipeline({ ...SMALL, codeSource: 'dsm_first_order', frac: 1e-3, dither: true })
    expect(first.code.notes.some((n) => n.includes('仍然是鋸齒'))).toBe(true)
    const mash = runPipeline({ ...SMALL, dither: true })
    expect(mash.code.notes.some((n) => n.includes('idle tone'))).toBe(true)
    expect(mash.code.notes.some((n) => n.includes('仍然是鋸齒'))).toBe(false)
  }, 30_000)

  it('每組 code 的 dBc 用自己的 f_out = (N_int + α_eff)·f_ref 換算（不是都用第一組的）', () => {
    const r = analyzeTraining({
      ...baseT,
      nInt: 1,
      patterns: [
        { ...DEFAULT_TRAINING_PATTERN, frac: 1e-3 },
        { ...DEFAULT_TRAINING_PATTERN, frac: 0.75 },
      ],
    })
    expect(r.patterns[0].fOutHz).toBeCloseTo((1 + Math.round(1e-3 * 2 ** 20) / 2 ** 20) * 4e9, 3)
    expect(r.patterns[1].fOutHz).toBeCloseTo(1.75 * 4e9, 3)
    for (const pat of r.patterns) for (const tone of pat.tones) expect(tone.dbc).toBeCloseTo(makeTone(tone.fHz, tone.ampFs, pat.fOutHz, 'findTones').dbc, 9)
  })

  it('反面：iid ±1 code 時 x² ≡ 1 與 offset 共線 ⇒ INL₂ 與 offset 無法分開（即使 none 路徑）', () => {
    const r = analyzeTraining({
      ...baseT,
      pll: 'none',
      basis: { gain: true, inl2: true, inl3: false, offset: true },
      patterns: [{ ...DEFAULT_TRAINING_PATTERN, source: 'iid_pm_one', normalization: 'none' }],
    })
    expect(r.patterns[0].rank).toBe(2)
  })

  it('一階 DSM 封閉式（E[r]、E[r²]、A₁）與序列一致；靜態殘差經 T 產生 fractional spur；加上 overlay 後同樣 Δa 的 tone 較低，降幅就是正規化 scale 的比值（鋸齒本身沒有變小）', () => {
    const r = analyzeTraining({
      ...baseT,
      length: 1 << 18,
      patterns: [
        { ...DEFAULT_TRAINING_PATTERN, frac: 1e-3, dsmBits: 10 },
        { ...DEFAULT_TRAINING_PATTERN, frac: 1e-3, dsmBits: 10, randomization: 'pm1', randAmp: 1 },
      ],
    })
    const cf = r.patterns[0].closedForm!
    expect(cf.meanSim).toBeCloseTo(cf.mean, 3)
    expect(cf.meanSquareSim).toBeCloseTo(cf.meanSquare, 3)
    expect(Math.abs(cf.line1Sim / cf.line1 - 1)).toBeLessThan(0.01)
    const top0 = r.patterns[0].tones[0]?.dbc ?? -Infinity
    const top1 = r.patterns[1].tones[0]?.dbc ?? -Infinity
    expect(top0).toBeGreaterThan(top1 + 3)
    expect(r.patterns[1].warnings.some((w) => w.includes('研究延伸'))).toBe(true)
    // 機制：overlay 是加法，residue 的鋸齒（以 T_vco 計）不變；standardize 的 s = 1/std(raw) 變小，
    // 所以同樣的 Δa（fs per unit code）下 tone 振幅的比值 ≈ std₀/std₁（±1 overlay：√(1/12)/√(13/12) ≈ 0.277）
    const sRatio = r.patterns[0].rawStd / r.patterns[1].rawStd
    expect(sRatio).toBeCloseTo(Math.sqrt(1 / 13), 2)
    const ampRatio = r.patterns[1].tones[0].ampFs / r.patterns[0].tones[0].ampFs
    expect(Math.abs(ampRatio / sRatio - 1)).toBeLessThan(0.2)
    expect(r.patterns[1].warnings.some((w) => w.includes('鋸齒本身還在'))).toBe(true)
  }, 30_000)
})

describe('mean-field 平均軌跡（F-LAB.18）與非平穩的 code 統計', () => {
  it('erfFast：|z| < 0.5 的 Maclaurin 級數與 core 的 erf 相差 < 1e-9；範圍外就是 core 的 erf', () => {
    let worst = 0
    for (let z = -0.5; z <= 0.5; z += 1e-3) worst = Math.max(worst, Math.abs(erfFast(z) - erf(z)))
    expect(worst).toBeLessThan(1e-9)
    for (const z of [-3, -0.5, 0.5, 0.75, 2.5]) expect(erfFast(z)).toBe(erf(z))
    expect(erfFast(0)).toBe(0)
    expect(erfFast(-0.3)).toBeCloseTo(-erfFast(0.3), 15) // 奇函數
  })

  const twinCases: [string, Partial<LabParams>][] = [
    ['MASH + Type-II', {}],
    ['一階 + INL + offset + delayed', { codeSource: 'dsm_first_order', frac: 0.3, c2: 0.2, c3: 0.05, dtcOffsetFs: 1, compOffsetFs: 4, regressor: 'delayed', codeDelay: 2 }],
    ['filtered-x 失配 + Type-I + 更新延遲', { pll: 'type1', loopDelay: 1, regressor: 'filtered', codeDelay: 1, fxGain: 0.8, fxExtraDelay: 1, updateDelay: 2 }],
    ['0/1 未映射 + sum 模式 + 無 PLL', { encoding: 'unipolar_unmapped_bug', gmMode: 'sum', muFs: 0.01, pll: 'none', codeSource: 'dsm_first_order', frac: 0.3 }],
  ]
  for (const [name, over] of twinCases) {
    it(`meanFieldTwin（獨立版）與 replayPipeline 內嵌的版本逐位元一致：${name}`, () => {
      const p: LabParams = { ...SMALL, ...over }
      const parsed = parseBlockLmsConfig(toBlockLmsConfig(p))
      expect(parsed.ok).toBe(true)
      const cfg = parsed.config!
      const res = runBlockLms(cfg)
      const rp = replayPipeline({ config: cfg, wPhys: res.blocks.wPhys, G: res.blocks.G, normalization: res.analytic.normalization, T: pllDesign(p).T, windowBlocks: 4 })
      const tw = meanFieldTwin({ config: cfg, normalization: res.analytic.normalization })
      expect(rp.maxAbsDiffG).toBe(0)
      expect(Array.from(tw.w)).toEqual(Array.from(rp.meanField.w))
      expect(Array.from(tw.C)).toEqual(Array.from(rp.meanField.C))
      expect(Array.from(tw.B)).toEqual(Array.from(rp.meanField.B))
      expect(tw.w).toHaveLength(p.blocks + 1)
      expect(tw.w[0]).toBe(p.w0Fs)
    })
  }

  it('小訊號、平穩的 code（MASH）：mean-field 軌跡與線性時不變模型 w* − δ_k 幾乎重合（F-LAB.18 退化成 F-LAB.7）', () => {
    const r = runPipeline(SMALL)
    expect(r.meanModel).toBe('mean-field')
    let worst = 0
    for (let i = 0; i < r.blocks.k.length; i++) worst = Math.max(worst, Math.abs(r.blocks.wMeanModel[i] - r.blocks.wLinearModel[i]))
    expect(worst).toBeLessThan(0.05) // fs；a − w₀ = 3 fs、σ_w ≈ 1.1 fs（N = 512）
    expect(r.blocks.wMeanModel[r.blocks.k.length - 1]).toBeCloseTo(r.params.aFs, 3)
    // B_k = 0（沒有 offset / INL）⇒ 準靜態固定點恆為 a；沒有「固定點不是常數」的警告
    expect(r.fixedPointSwing).not.toBeNull()
    expect(r.fixedPointSwing!.max - r.fixedPointSwing!.min).toBeLessThan(1e-9)
    expect(r.stages.find((s) => s.id === 'update')!.warnings.some((w) => w.includes('固定點不是常數'))).toBe(false)
  })

  it('非平穩的區塊統計（一階 DSM α = 0.3、無 PLL、b = 20 fs）：單一 w* 的線性模型對不上，mean-field 軌跡對得上；並警告固定點在擺動', () => {
    const p: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', frac: 0.3, pll: 'none', compOffsetFs: 20, blocks: 1200 }
    const r = runPipeline(p)
    const K = p.blocks
    const h0 = Math.ceil((K + 1) / 2)
    // 模擬的後半段平均 ≈ 整個週期的 a + b·E[x]/E[x²] = 3 − 20·(√3/2) ≈ −14.32；blockLms 的 w*（前 2^14 個樣本）約 −15.2
    expect(r.metrics.meanW).toBeGreaterThan(-14.8)
    expect(r.metrics.meanW).toBeLessThan(-13.8)
    expect(r.analytic.wStarMeanField).toBeLessThan(-15)
    // (1) 線性時不變模型（常數 w*）：後半段預測與模擬的差超過容差
    const linOnly = linearPrediction(r.analytic, p, K)
    expect(linOnly.model).toBe('linear')
    expect(Math.abs(r.metrics.meanW - linOnly.halfMean)).toBeGreaterThan(r.checks.meanW.tolerance!)
    // (2) mean-field 軌跡：通過（差在抽樣誤差內），而且比線性模型近得多
    expect(r.meanModel).toBe('mean-field')
    expect(r.checks.meanW.status).toBe('ok')
    expect(Math.abs(r.metrics.meanW - r.checks.meanW.analytic!)).toBeLessThan(0.3 * Math.abs(r.metrics.meanW - linOnly.halfMean))
    expect(r.checks.sigmaW.status).toBe('ok')
    // (3) 固定點的擺動：遠大於 σ_w,pred，警告出現在更新迴路那一級；mean-field 軌跡自己在後半段也在擺動
    const sw = r.fixedPointSwing!
    expect(sw.max - sw.min).toBeGreaterThan(3 * r.analytic.sigmaWPred)
    expect(sw.mean).toBeGreaterThan(-14.8)
    expect(sw.mean).toBeLessThan(-13.8)
    expect(r.stages.find((s) => s.id === 'update')!.warnings.some((w) => w.includes('固定點不是常數'))).toBe(true)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < r.blocks.k.length; i++) {
      if (r.blocks.k[i] < h0) continue
      lo = Math.min(lo, r.blocks.wMeanModel[i])
      hi = Math.max(hi, r.blocks.wMeanModel[i])
    }
    expect(hi - lo).toBeGreaterThan(0.8)
  }, 30_000)

  it('quasiStaticFixedPoint：w*_k = a + B_k/C_k 只取後半段、跳過 C_k ≤ 0 的 block；0/1 未映射時不適用', () => {
    const mf = { C: Float64Array.from([1, 1, 2, 0, 0.5, -1]), B: Float64Array.from([9, 9, 4, 1, 1, 1]) }
    const q = quasiStaticFixedPoint(mf, { aFs: 3, encoding: 'bipolar_pm_one' }, 1)!
    // 後半段 = block 3、4、5：C = 0（跳過）、0.5（w* = 3 + 2 = 5）、−1（跳過）
    expect(q).toEqual({ min: 5, max: 5, mean: 5 })
    expect(quasiStaticFixedPoint(mf, { aFs: 3, encoding: 'unipolar_unmapped_bug' }, 1)).toBeNull()
    expect(quasiStaticFixedPoint({ C: new Float64Array(4), B: new Float64Array(4) }, { aFs: 3, encoding: 'bipolar_pm_one' }, 1)).toBeNull()
  })

  it('反面：σ_v = 0 沒有 mean-field（erf 退化成 sign）⇒ 軌跡為 NaN、檢查標「不適用」並說明原因', () => {
    const p: LabParams = { ...SMALL, sigmaV: 0 }
    const cfg = parseBlockLmsConfig(toBlockLmsConfig(p)).config!
    const tw = meanFieldTwin({ config: cfg, normalization: analyzeBlockLms(cfg).analytic.normalization })
    expect(Number.isNaN(tw.w[p.blocks])).toBe(true)
    const r = runPipeline(p)
    expect(r.checks.meanW.status).toBe('n/a')
    expect(r.checks.meanW.note).toMatch(/sigma_v=0/)
  })

  it('Monte Carlo：第一段附上 mean-field 軌跡；mcChecks 用它（沒有時退回線性模型）', () => {
    const p: LabParams = { ...SMALL, codeSource: 'iid_pm_one', pll: 'none', blocks: 200 }
    const c0 = runMcChunk({ base: p, seeds: mcSeeds(p.seed, 0, 4), meanField: true })
    const c1 = runMcChunk({ base: p, seeds: mcSeeds(p.seed, 4, 4) })
    expect(c0.meanField).toHaveLength(p.blocks + 1)
    expect(c1.meanField).toBeNull()
    const s = combineMc([c0, c1])
    const withMf = mcChecks(s, c0.analytic, p, c0.meanField)
    const without = mcChecks(s, c0.analytic, p)
    expect(withMf.lin.model).toBe('mean-field')
    expect(without.lin.model).toBe('linear')
    expect(withMf.meanW.status).toBe('ok')
    expect(Math.abs(withMf.lin.halfMean - without.lin.halfMean)).toBeLessThan(0.02) // iid ±1：兩個模型本來就幾乎相同
  })
})

describe('Monte Carlo × 非平穩的 code 統計', () => {
  it('8 個 seeds（一階 DSM α = 0.3、無 PLL、b = 20 fs）：mean-field 軌跡落在 mean w 的 95% CI 內、σ_w（含固定點的擺動）也一致；只用線性時不變模型則兩項都不一致', () => {
    const p: LabParams = { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', frac: 0.3, pll: 'none', compOffsetFs: 20, blocks: 1000 }
    const c0 = runMcChunk({ base: p, seeds: mcSeeds(p.seed, 0, 4), meanField: true })
    const c1 = runMcChunk({ base: p, seeds: mcSeeds(p.seed, 4, 4) })
    const s = combineMc([c0, c1])
    expect(s.valid).toBe(8)
    const mf = mcChecks(s, c0.analytic, p, c0.meanField)
    expect(mf.lin.model).toBe('mean-field')
    expect(mf.meanW.status).toBe('ok')
    expect(mf.sigmaW.status).toBe('ok')
    // 預測的 σ 比穩態的 σ_w,pred 大：多出來的是 mean-field 軌跡自己在後半段的起伏（固定點的擺動）
    expect(mf.sigmaW.analytic!).toBeGreaterThan(1.2 * c0.analytic.sigmaWPred)
    expect(mf.sigmaW.note).toContain('隨 code 擺動的固定點')
    const lin = mcChecks(s, c0.analytic, p)
    expect(lin.lin.model).toBe('linear')
    expect(lin.meanW.status).toBe('mismatch')
    expect(lin.sigmaW.status).toBe('mismatch')
  }, 60_000)
})

describe('譜線偵測的顯著性（避免把雜訊 PSD 的最高點當成 spur）', () => {
  it('toneSignificanceDb：平均段數越少門檻越高', () => {
    expect(toneSignificanceDb(15)).toBe(8)
    expect(toneSignificanceDb(4)).toBe(10)
    expect(toneSignificanceDb(1)).toBe(14)
  })

  it('significantTones：比鄰近中位數高不到門檻的候選被剔除，真的譜線保留；鄰近 bin 太少時不判斷', () => {
    const psd = new Float64Array(400).fill(1)
    psd[100] = 4 // +6 dB：雜訊起伏等級
    psd[300] = 100 // +20 dB：譜線
    const cand = [
      { index: 100, peakPsd: 4, lobe: [99, 101] as [number, number] },
      { index: 300, peakPsd: 100, lobe: [299, 301] as [number, number] },
    ]
    expect(significantTones(psd, cand, 15).map((c) => c.index)).toEqual([300])
    // 斜的雜訊底（MASH 那種 +40 dB/dec）：門檻跟著「當地」的中位數走，不是整條曲線的
    const sloped = Float64Array.from({ length: 400 }, (_, i) => (i + 1) ** 4)
    sloped[200] *= 3 // 只比當地高 4.8 dB
    expect(significantTones(sloped, [{ index: 200, peakPsd: sloped[200], lobe: [199, 201] as [number, number] }], 15)).toHaveLength(0)
    expect(significantTones(new Float64Array(6).fill(1), [{ index: 3, peakPsd: 1.5, lobe: [2, 4] as [number, number] }], 15)).toHaveLength(1)
  })

  it('T13: 錨點（iid ±1、無 PLL）的輸出是白雜訊：不報任何 tone；一階 DSM 的 fractional 譜線仍然被偵測到', () => {
    const white = runPipeline({ ...DEFAULT_LAB_PARAMS, codeSource: 'iid_pm_one', pll: 'none', blocks: 200, outBlocks: 64 })
    expect(white.output!.toneDetect.nSegments).toBeGreaterThanOrEqual(8)
    expect(white.output!.toneDetect.significanceDb).toBe(8)
    expect(white.output!.tones).toHaveLength(0)
    const first = runPipeline({ ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', frac: 0.01, normalization: 'standardize', blocks: 200, outBlocks: 64 })
    expect(first.output!.tones.length).toBeGreaterThan(0)
    // 最大的那根就是 fractional 基頻 f₁ = α_eff·f_ref（Welch 的解析度內）
    const f1 = first.output!.fracToneHz
    expect(Math.abs(first.output!.tones[0].fHz - f1)).toBeLessThan(2 * (DEFAULT_LAB_PARAMS.fRefHz / (1 << 15)))
  }, 30_000)
})

describe('交叉比對的說明要指出原因', () => {
  it('定點飽和（a 超出 6-bit unsigned 的範圍）：mean w 與 fixed-point 都標不一致，說明寫的是「飽和」而不是 dead zone', () => {
    const r = runPipeline({ ...SMALL, quantize: true, aFs: 9, sigmaV: 20 })
    expect(r.metrics.saturationCount).toBeGreaterThan(0)
    expect(r.checks.fixedPoint.status).toBe('mismatch')
    expect(r.checks.fixedPoint.note).toMatch(/飽和/)
    expect(r.checks.fixedPoint.note).not.toMatch(/dead zone/)
    expect(r.checks.meanW.status).toBe('mismatch')
    expect(r.checks.meanW.note).toMatch(/飽和/)
  })

  it('gain-noise 混頻的窄頻近似在 N 很小時失效（ZOH image 把 MASH 的高頻功率摺回頻寬內）：標不一致並說明要用完整的頻譜卷積（E09）', () => {
    const r = runPipeline({ ...DEFAULT_LAB_PARAMS, N: 16, blocks: 20000, outBlocks: 4096 })
    expect(r.checks.noiseMix.status).toBe('mismatch')
    expect(r.checks.noiseMix.value!).toBeGreaterThan(1.5 * r.checks.noiseMix.analytic!)
    expect(r.checks.noiseMix.note).toMatch(/ZOH/)
    expect(r.checks.noiseMix.note).toMatch(/E09/)
    // N = 4096（預設）時近似成立，說明裡沒有這一段
    const ok = runPipeline(SMALL)
    if (ok.checks.noiseMix.status === 'ok') expect(ok.checks.noiseMix.note).not.toMatch(/E09/)
  }, 30_000)

  it('平均軌跡在後半段還在移動（近整數：τ ≈ 1000 blocks、只跑 600）⇒ mean w 的說明提醒「一致不代表已收斂」', () => {
    const r = runPipeline({ ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order', frac: 1e-4, blocks: 600, w0Fs: -40 })
    expect(r.analytic.tauBlocks).toBeGreaterThan(600)
    expect(r.checks.meanW.status).toBe('ok')
    expect(r.checks.meanW.note).toMatch(/不代表已經收斂/)
  }, 30_000)
})

describe('其他反面測試', () => {
  it('unipolar_unmapped_bug + code 有 DC：mean-field 固定點不存在（或大幅偏離 a），w 一路漂走；警告分到 comparator 級', () => {
    const r = runPipeline({ ...SMALL, codeSource: 'dsm_first_order', frac: 0.01, encoding: 'unipolar_unmapped_bug' })
    // q ∈ {0, 1} ⇒ E[G] = ½E[x_ref] + ½E[sign(e)·x_ref]。unit_rms 的一階 residue 恆 ≤ 0（E[x] ≈ −0.866 = −E|x|），
    // 要 E[G] = 0 需要 E[sign(e)·x] = +E|x|，也就是每個樣本都 sign(e) = −1；但 u = H_PD{x} 零均值，做不到 ⇒ 沒有固定點。
    const ws = r.analytic.wStarMeanField
    expect(!Number.isFinite(ws) || Math.abs(ws - r.params.aFs) > 1).toBe(true)
    expect(Math.abs(r.metrics.bias)).toBeGreaterThan(100) // 300 blocks 就漂離 a 幾百 fs
    expect(r.checks.meanW.status).toBe('n/a') // 沒有固定點 ⇒ 不拿線性模型硬比
    const comp = r.stages.find((s) => s.id === 'comparator')!
    expect(comp.warnings.some((w) => w.includes('unipolar'))).toBe(true)
  })

  it('comparator offset × code DC（unit_rms）⇒ 假 gain bias b·E[x]/C；standardize 時消失（§11.1、E03）', () => {
    const base: LabParams = { ...SMALL, codeSource: 'dsm_first_order', frac: 0.01, compOffsetFs: 5 }
    const a = analyzeLab({ ...base, normalization: 'unit_rms' }).analytic
    const b = analyzeLab({ ...base, normalization: 'standardize' }).analytic
    const pred = (5 * a.ExRef) / a.Cest
    expect(Math.abs(a.wStarLinear - base.aFs - pred)).toBeLessThan(1e-9)
    expect(Math.abs(a.wStarLinear - base.aFs)).toBeGreaterThan(10)
    expect(Math.abs(b.wStarLinear - base.aFs)).toBeLessThan(0.2)
  })

  it('effectiveSampleSize 與 createRng 可用（基礎依賴健全性）', () => {
    const rng = createRng(1)
    const x = Float64Array.from({ length: 400 }, () => rng.normal())
    expect(effectiveSampleSize(x)).toBeGreaterThan(100)
  })
})

describe('wave 5：新引擎 runLabLoop 與 runBlockLms 的對應', () => {
  const VARIANTS: { name: string; p: LabParams }[] = [
    { name: 'MASH、type-II、raw（預設的小型版）', p: { ...SMALL } },
    { name: '一階 DSM、offset + INL、comparator offset、delayed D = 3、sum 模式', p: { ...SMALL, codeSource: 'dsm_first_order', frac: 0.3, dtcOffsetFs: 2, c2: 0.5, c3: -0.2, compOffsetFs: 3, regressor: 'delayed', codeDelay: 3, gmMode: 'sum', muFs: 10 / 512 } },
    { name: 'filtered-x（g_m = 0.8、D_x = 1）、Type-I、更新延遲 d = 1、0/1 映射', p: { ...SMALL, pll: 'type1', regressor: 'filtered', codeDelay: 2, fxGain: 0.8, fxExtraDelay: 1, updateDelay: 1, encoding: 'unipolar_mapped' } },
    { name: '定點 6-bit、stochastic rounding、wrap、signed', p: { ...SMALL, quantize: true, rounding: 'stochastic', overflow: 'wrap', signedReg: true, aFs: 3.05 } },
    { name: 'iid ±1、none 路徑、0/1 未映射（bug）', p: { ...SMALL, codeSource: 'iid_pm_one', pll: 'none', encoding: 'unipolar_unmapped_bug', normalization: 'standardize' } },
  ]
  for (const v of VARIANTS) {
    it(`legacy、gos_only：${v.name} —— w、w_phys、G 逐位元相同；解析量相同`, () => {
      expect(usesLegacyEngine(v.p)).toBe(true)
      const ref = runBlockLms(toBlockLmsConfig(v.p))
      const pr = prepareLab(v.p, pllDesign(v.p))
      const r = runLabLoop(pr, { windowBlocks: 4, trace: true, meanField: true })
      expect(r.P).toBe(1)
      for (let k = 0; k < v.p.blocks; k++) expect(r.G[0][k], `G[${k}]`).toBe(ref.blocks.G[k])
      for (let k = 0; k <= v.p.blocks; k++) {
        expect(r.w[0][k], `w[${k}]`).toBe(ref.blocks.w[k])
        expect(r.wPhys[0][k], `wPhys[${k}]`).toBe(ref.blocks.wPhys[k])
      }
      expect(r.metrics.meanW).toBe(ref.metrics.meanW)
      expect(r.metrics.stdW).toBe(ref.metrics.stdW)
      expect(r.metrics.settlingBlock).toBe(ref.metrics.settlingBlock)
      expect(r.metrics.saturationCount).toBe(ref.metrics.saturationCount)
      expect(r.metrics.wrapCount).toBe(ref.metrics.wrapCount)
      const a = pr.analytic
      const b = ref.analytic
      for (const k of ['Kq', 'Cest', 'K', 'g', 'p', 'rhoMean', 'sigmaEta2', 'sigmaWPred', 'Ex', 'Ex2', 'ExRef', 'ExRef2', 'wStarLinear', 'fuHz', 'enbwHz'] as const) {
        const x = a[k]
        const y = b[k]
        if (Number.isNaN(y)) expect(Number.isNaN(x), k).toBe(true)
        else expect(Math.abs(x - y), `${k}: ${x} vs ${y}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(y)))
      }
      expect(a.normalization.offset).toBe(b.normalization.offset)
      expect(a.normalization.scale).toBe(b.normalization.scale)
      if (Number.isFinite(b.wStarMeanField)) expect(Math.abs(a.wStarMeanField - b.wStarMeanField)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(b.wStarMeanField)))
      // 視窗與 mean-field twin 與 replayPipeline 一致
      const rp = replayPipeline({ config: ref.config, wPhys: ref.blocks.wPhys, G: ref.blocks.G, normalization: b.normalization, T: pr.design.T, windowBlocks: 4 })
      expect(rp.maxAbsDiffG).toBe(0)
      const win = r.window as NonNullable<typeof r.window>
      for (let i = 0; i < win.x.length; i += 97) {
        expect(win.x[i]).toBe(rp.window.x[i])
        expect(win.eDtc[i]).toBe(rp.window.eDtc[i])
        expect(win.uPd[i]).toBe(rp.window.uPd[i])
        expect(win.q[i]).toBe(rp.window.q[i])
        expect(win.tOut[i]).toBe(rp.window.tOut[i])
        expect(Math.abs(win.tStatic[i] - rp.window.tStatic[i])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(rp.window.tStatic[i])))
      }
      const mf = r.meanField as NonNullable<typeof r.meanField>
      for (let k = 0; k <= v.p.blocks; k += 7) {
        if (Number.isNaN(rp.meanField.w[k])) expect(Number.isNaN(mf.w[0][k])).toBe(true)
        else expect(Math.abs(mf.w[0][k] - rp.meanField.w[k])).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(rp.meanField.w[k])))
      }
    })
  }

  it("'spec' 正負號 = 'legacy' 把 a、w₀、c₃ 變號的鏡像：w 與 G 逐位元相反（IEEE 的負號對稱）；C、K_q、g、σ_w 相同", () => {
    const spec: LabParams = { ...SMALL, codeSource: 'dsm_first_order', frac: 0.3, regressorSign: 'spec', dtcOffsetFs: 1, c2: 0.3, c3: 0.1, compOffsetFs: 2, w0Fs: 0.5 }
    const mirror: LabParams = { ...spec, regressorSign: 'legacy', aFs: -spec.aFs, w0Fs: -spec.w0Fs, c3: -spec.c3 }
    expect(usesLegacyEngine(spec)).toBe(false)
    const a = runLabLoop(prepareLab(spec, pllDesign(spec)), { windowBlocks: 2, trace: true })
    const b = runBlockLms(toBlockLmsConfig(mirror))
    for (let k = 0; k < spec.blocks; k++) expect(a.G[0][k], `G[${k}]`).toBe(-b.blocks.G[k])
    for (let k = 0; k <= spec.blocks; k++) expect(a.w[0][k], `w[${k}]`).toBe(-b.blocks.w[k])
    const an = prepareLab(spec, pllDesign(spec)).analytic
    expect(an.Cest).toBeCloseTo(b.analytic.Cest, 12)
    expect(an.g).toBeCloseTo(b.analytic.g, 12)
    expect(an.sigmaWPred).toBeCloseTo(b.analytic.sigmaWPred, 12)
    expect(an.wStarLinear).toBeCloseTo(-b.analytic.wStarLinear, 9)
    expect(an.Ex).toBeCloseTo(-b.analytic.Ex, 12)
    // spec 的 x 真的是 s/M ≥ 0（一階、unit_rms 不置中）
    const win = a.window as NonNullable<typeof a.window>
    let min = Infinity
    for (let i = 0; i < win.x.length; i++) min = Math.min(min, win.x[i])
    expect(min).toBeGreaterThanOrEqual(0)
    expect(an.Ex).toBeGreaterThan(0)
  })
})

describe('wave 5：8 相 PMUX + GOS 的 9 個權重（pmux8_gos）', () => {
  const PM: LabParams = { ...SMALL, architecture: 'pmux8_gos', regressorSign: 'spec', codeSource: 'dsm_first_order', frac: 0.137, phosRmsFs: 60, muPhosFs: 10, muFs: 10, sigmaV: 100, blocks: 400, N: 512 }

  it('regressor 正負號：spec 的 DTC code x = s/M ≥ 0（一個相位步以內，[0, 1)），legacy 是 −x ≤ 0（審查：原本 pmux8 分支把正負號套了兩次）', () => {
    for (const sg of ['spec', 'legacy'] as const) {
      const p: LabParams = { ...PM, regressorSign: sg, normalization: 'none', pll: 'none', blocks: 4, outBlocks: 2 }
      const r = runLabLoop(prepareLab(p, pllDesign(p)), { windowBlocks: 2, trace: true })
      const xs = (r.window as NonNullable<typeof r.window>).x
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < xs.length; i++) {
        lo = Math.min(lo, xs[i])
        hi = Math.max(hi, xs[i])
      }
      if (sg === 'spec') {
        expect(lo).toBeGreaterThanOrEqual(0)
        expect(hi).toBeLessThan(1)
      } else {
        expect(hi).toBeLessThanOrEqual(0)
        expect(lo).toBeGreaterThan(-1)
      }
    }
  })

  it('PHOS 圖樣：去共模、RMS = 1；phosOffsets 乘上 RMS', () => {
    expect(PHOS_PATTERN).toHaveLength(8)
    expect(Math.abs(PHOS_PATTERN.reduce((a, b) => a + b, 0))).toBeLessThan(1e-12)
    expect(Math.sqrt(PHOS_PATTERN.reduce((a, b) => a + b * b, 0) / 8)).toBeCloseTo(1, 12)
    expect(phosOffsets(60)[7]).toBeCloseTo(60 * PHOS_PATTERN[7], 12)
  })

  it('none 路徑（H_PD = 1）：共模可觀測，9 個權重都收斂到目標附近；GMAC 的 one-hot 真的只在被選的相累加', () => {
    const p: LabParams = { ...PM, pll: 'none' }
    const pr = prepareLab(p, pllDesign(p))
    expect(pr.P).toBe(9)
    expect(pr.mimo).not.toBeNull()
    const ma = pr.mimo as NonNullable<typeof pr.mimo>
    expect(ma.commonModeObservable).toBe(true)
    expect(ma.obs.nullDim).toBe(0)
    expect(ma.minReEig).toBeGreaterThan(0)
    expect(ma.stable).toBe(true)
    // 相位走訪：α = 0.137 ⇒ 8 相都走到
    for (const o of ma.occupancy) expect(o).toBeGreaterThan(0.05)
    const r = runLabLoop(pr, { meanField: true })
    expect(r.divergenceBlock).toBeNull()
    for (let j = 0; j < 9; j++) expect(Math.abs(r.perWeight.meanW[j] - pr.target[j]), `w_${j}`).toBeLessThan(4 * Math.max(0.5, r.perWeight.stdW[j]) + 1)
    expect(r.phosRmsFs).toBeLessThan(6)
    // one-hot：每個 block 的 Σ_p G_p = (1/N)Σ q = mean(q)（所有相的 GMAC 加起來就是 q 的平均）
    for (let k = 0; k < 20; k++) {
      let sum = 0
      for (let j = 0; j < 8; j++) sum += r.G[j][k]
      expect(Math.abs(sum)).toBeLessThanOrEqual(1 + 1e-12)
    }
  })

  it('type-II 路徑：共模是結構性 null（nullDim = 1，E04），其餘 8 個模式收斂；PHOS 去共模殘差小；9 權重的 ρ < 1；mean-field 交叉比對一致', () => {
    const p: LabParams = { ...PM, pll: 'type2', pllBwHz: 20e6, blocks: 600 }
    const r = runPipeline(p)
    expect(r.engine).toBe('labLoop')
    expect(r.mimo).not.toBeNull()
    const m = r.mimo as NonNullable<typeof r.mimo>
    expect(m.analysis.obs.nullDim).toBe(1)
    expect(m.analysis.commonModeObservable).toBe(false)
    expect(m.analysis.stable).toBe(true)
    expect(m.analysis.minReEig).toBeGreaterThan(0)
    expect(Number.isFinite(m.analysis.obs.cond)).toBe(true)
    expect(m.phosRmsFs).toBeLessThan(8)
    expect(Math.abs(m.perWeight[GOS_INDEX].meanW - p.aFs)).toBeLessThan(1.5)
    expect(m.checks.meanW.status).toBe('ok')
    expect(m.checks.stability.status).toBe('ok')
    expect(r.checks.replay.status).toBe('n/a')
    expect(r.stages.find((s) => s.id === 'gmac')?.metrics.some((x) => x.name.includes('條件數'))).toBe(true)
    expect(r.output).not.toBeNull()
    expect(r.window).not.toBeNull()
    expect(m.windowPhase?.length).toBe(r.window?.n.length)
    for (const v of Array.from(m.snippetPhase as Float64Array)) expect(v >= 0 && v <= 7 && Number.isInteger(v)).toBe(true)
  })

  it('spec 單一 gain（gos_only）：pipeline 的 replay 用變號的 blockLms 鏡像，逐位元一致（maxAbsDiffG = 0）', () => {
    const p: LabParams = { ...SMALL, regressorSign: 'spec', codeSource: 'dsm_first_order', frac: 0.3 }
    const r = runPipeline(p)
    expect(r.engine).toBe('labLoop')
    expect(r.checks.replay.status).toBe('ok')
    expect(r.replay?.maxAbsDiffG).toBe(0)
    expect(r.mimo).toBeNull()
    expect(r.code.rawRange[0]).toBe(0)
    expect(r.analytic.Ex).toBeGreaterThan(0)
  })

  it('Monte Carlo（pmux8）：每個 seed 一次 runLabLoop；9 權重的 CI 涵蓋 mean-field；twin 選項附上同 seed 浮點對照', () => {
    // 實體 12 bits signed、LSB 0.125 fs ⇒ ±256 fs，涵蓋 ε_p 的最大值 60 × 2.1 ≈ 126 fs（10 bits 只到 ±64 fs，會飽和、mean w 就會不一致——這也是對的判定）
    const p: LabParams = { ...PM, pll: 'none', blocks: 300, quantize: true, lsbFs: 0.125, signedReg: true, internalBits: 22, physicalBits: 12 }
    const seeds = mcSeeds(p.seed, 0, 6)
    const c = runMcChunk({ base: p, seeds, meanField: true, twin: true })
    expect(c.mimo).not.toBeNull()
    expect(c.twin).toBeDefined()
    expect(c.twin?.seeds).toEqual(seeds)
    expect(c.twin?.twin).toBeUndefined()
    const s = combineMcMimo([c]) as NonNullable<ReturnType<typeof combineMcMimo>>
    expect(s.P).toBe(9)
    expect(s.valid).toBe(6)
    const ck = mcMimoChecks(s, p)
    expect(ck.meanW.status).toBe('ok')
    expect(['ok', 'n/a']).toContain(ck.phos.status)
    // GOS 通道的 combineMc 照舊可用
    const g = combineMc([c])
    expect(g.valid).toBe(6)
  })

  it('FCW sweep（pmux8）：每點重算 PMUX 序列；α = 1/4 時 frac(8α) = 0、PMUX 每週期固定走 2 相 ⇒ 只走訪 4 相、GOS 鋸齒消失，不可觀測方向變多；twin 只重跑迴路', () => {
    const base: LabParams = { ...PM, pll: 'none', blocks: 200 }
    const opts = { ...DEFAULT_SWEEP_OPTIONS, closedLoop: true, loopBlocks: 120, slopeMc: false }
    const r = sweepFcwChunk({ base: { ...base, quantize: true, signedReg: true, physicalBits: 10, lsbFs: 0.125 }, fracs: [0.137, 0.25], opts, offset: 0, twin: true })
    expect(r.points).toHaveLength(2)
    expect(r.twinPoints).toHaveLength(2)
    expect(r.points[0].mimo).not.toBeNull()
    expect(r.points[0].twinLoop).toBeUndefined()
    expect(r.twinPoints?.[0].loop?.meanW).not.toBe(r.points[0].loop?.meanW)
    expect(r.points[0].loop?.phosRmsFs).not.toBeNull()
    // 審查：twin 的閉迴路與「整段 quantize = false 再跑一次」逐位元相同（只重跑迴路，不改變結果）
    const full = sweepFcwChunk({ base: { ...base, quantize: false, signedReg: true, physicalBits: 10, lsbFs: 0.125 }, fracs: [0.137, 0.25], opts, offset: 0 })
    for (let i = 0; i < 2; i++) expect(r.twinPoints?.[i].loop).toEqual(full.points[i].loop)
    const quarter = r.points[1].mimo as NonNullable<FcwPointMimo>
    expect(quarter.occupancy.filter((o) => o > 0)).toHaveLength(4) // 0, 2, 4, 6 各 1/4
    for (const o of quarter.occupancy.filter((v) => v > 0)) expect(o).toBeCloseTo(0.25, 12)
    expect(quarter.nullDim).toBeGreaterThanOrEqual(4) // 4 個沒走訪的相位（+ x ≡ 0 的 GOS）
    expect(r.points[1].warnings.some((w) => w.includes('不可辨識') || w.includes('不可觀測'))).toBe(true)
    const generic = r.points[0].mimo as NonNullable<FcwPointMimo>
    expect(generic.nullDim).toBe(0) // none 路徑：共模可觀測、8 相都走到
    expect(generic.peLambdaMin).toBeGreaterThan(0)
    // 不開 twin 時沒有 twinPoints
    const r2 = sweepFcwChunk({ base, fracs: [0.137], opts, offset: 0 })
    expect(r2.twinPoints).toBeUndefined()
  })
})

type FcwPointMimo = NonNullable<ReturnType<typeof sweepFcwChunk>['points'][number]['mimo']>

describe('wave 5：三階 CPPLL（cppll3）與反號帶', () => {
  it('PM = 60°、r_p = √b 的對稱放置與 sspll.ts 的 makeL3（impulse）係數相同；反號帶與 cppllFinv 一致', () => {
    const l3 = makeL3({ pmCt: 60, mapping: 'impulse', bwHz: 320e6, fRefHz: 4e9 })
    const b = Number(l3.params.b)
    const wc = Number(l3.params.wc)
    const mine = cppll3Loop(wc, 60, Math.sqrt(b), 0)
    expect(mine.bL.length).toBe(l3.bL.length)
    for (let i = 0; i < l3.bL.length; i++) expect(mine.bL[i]).toBeCloseTo(l3.bL[i], 12)
    for (let i = 0; i < l3.aL.length; i++) expect(mine.aL[i]).toBeCloseTo(l3.aL[i], 12)
    expect(mine.design.K).toBeCloseTo(Number(l3.params.K), 12)
    const d = pllDesign({ pll: 'cppll3', pllBwHz: 320e6, fRefHz: 4e9, zeta: 0.7, loopDelay: 0, pllPmDeg: 60, pllP3Ratio: Math.sqrt(b) })
    expect(d.kind).toBe('cppll3')
    expect(d.stable).toBe(true)
    expect(Math.abs(d.f3dbTHz / 320e6 - 1)).toBeLessThan(2e-3)
    expect(d.cppll?.wc).toBeCloseTo(wc, 4)
    expect(d.inversionBands.length).toBe(1)
    const bands = sspllBands(l3)
    expect(d.inversionBands[0].fHiHz / 4e9).toBeCloseTo(bands[0].fHi, 6)
    expect(d.inversionBands[0].fHiHz / 4e9).toBeCloseTo(cppllFinv(l3.params), 6)
    expect(d.hpdDc).toBeLessThan(1e-9)
    // H + T = 1
    for (const f of [1e5, 1e7, 3.2e8, 1e9]) {
      const om = (2 * Math.PI * f) / 4e9
      expect(Math.sqrt(dtMag2(d.H, om)) ** 2 + 0).toBeGreaterThan(0)
      const h = d.H
      const t = d.T
      // 直接驗 b 多項式：H.b + T.b = a
      for (let i = 0; i < d.H.a.length; i++) expect((h.b[i] ?? 0) + (t.b[i] ?? 0)).toBeCloseTo(d.H.a[i], 12)
      void om
    }
  })

  it('PM 與第三極點比可以獨立設定：r_p 變大時零點往 crossover 靠（θ_z 變小）；PM + arctan(1/r_p) ≥ 90° 被 labParamErrors 擋下', () => {
    const a = cppll3Loop(0.1, 60, 3, 0).design
    const b = cppll3Loop(0.1, 60, 10, 0).design
    expect(b.thetaZDeg).toBeLessThan(a.thetaZDeg)
    expect(b.wz).toBeGreaterThan(a.wz)
    const errs = labParamErrors({ ...DEFAULT_LAB_PARAMS, pll: 'cppll3', pllPmDeg: 80, pllP3Ratio: 2 })
    expect(errs.some((e) => e.includes('arctan'))).toBe(true)
    expect(labParamErrors({ ...DEFAULT_LAB_PARAMS, pll: 'cppll3' })).toEqual([])
  })

  it('type-II（2 MHz）的既有迴路也報反號帶（DC 起的一段）且 type-I 沒有；pipeline 在 cppll3 下能跑並標出反號帶警告', () => {
    const t2 = pllDesign({ ...DEFAULT_LAB_PARAMS })
    expect(t2.inversionBands.length).toBe(1)
    expect(t2.inversionBands[0].fLoHz).toBe(0)
    expect(Number.isFinite(t2.fcHz)).toBe(true)
    const t1 = pllDesign({ ...DEFAULT_LAB_PARAMS, pll: 'type1' })
    expect(t1.inversionBands).toEqual([])
    const r = runPipeline({ ...SMALL, pll: 'cppll3', pllBwHz: 2e6, blocks: 200 })
    expect(r.pll.kind).toBe('cppll3')
    expect(r.warnings.some((w) => w.includes('反號帶'))).toBe(true)
    expect(r.stages.find((s) => s.id === 'pll')?.metrics.some((m) => m.name.includes('反號帶'))).toBe(true)
  })
})

describe('wave 5：帶入手算的封閉式（HC-LAB.1、HC-LAB.2）', () => {
  it('pmuxClosedFormEigen：2×2 封閉式 = 9×9 矩陣的 eigSym；E[x] = 1/2、E[x²] = 1/3 時 λ± = 11/48 ± √97/48、條件數約 18.1；與 none 路徑的實際 R_u 相符', () => {
    const cf = pmuxClosedFormEigen(0.5, 1 / 3)
    expect(cf.lambdaPlus).toBeCloseTo(11 / 48 + Math.sqrt(97) / 48, 12)
    expect(cf.lambdaMinus).toBeCloseTo(11 / 48 - Math.sqrt(97) / 48, 12)
    expect(cf.cond).toBeCloseTo((11 / 48 + Math.sqrt(97) / 48) / (11 / 48 - Math.sqrt(97) / 48), 10)
    const ev = eigSym(cf.R).values
    expect(ev[0]).toBeCloseTo(cf.lambdaPlus, 12)
    expect(ev[ev.length - 1]).toBeCloseTo(cf.lambdaMinus, 12)
    for (let i = 1; i < 8; i++) expect(ev[i]).toBeCloseTo(1 / 8, 12)
    // 實際的 R_u（none 路徑、spec、normalization none、一階 DSM α = 0.137 ⇒ x ∈ [0,1) 近似均勻）
    const p: LabParams = { ...SMALL, architecture: 'pmux8_gos', regressorSign: 'spec', codeSource: 'dsm_first_order', frac: 0.137, pll: 'none', normalization: 'none', blocks: 400 }
    const pr = prepareLab(p, pllDesign(p))
    const ma = pr.mimo as NonNullable<typeof pr.mimo>
    const cfE = pmuxClosedFormEigen(pr.analytic.Ex, pr.analytic.Ex2)
    expect(ma.obs.lambdaMax).toBeCloseTo(cfE.lambdaMax, 2)
    expect(ma.obs.lambdaMin).toBeCloseTo(cfE.lambdaMin, 2)
    expect(Math.abs(ma.obs.cond / cfE.cond - 1)).toBeLessThan(0.1)
    const lim = pmuxUniformStepLimits(pr.analytic.Kq, cfE.lambdaMax, cfE.lambdaMin, 10)
    expect(lim.muMax).toBeCloseTo(2 / (pr.analytic.Kq * cfE.lambdaMax), 12)
    // 共用步長 μ = 10 fs 時的 μ_max（封閉式）與可觀測子空間上的 uniformStepMuMax 同量級（H_PD = 1 時 J = K_q R 對稱）
    expect(Math.abs(ma.muMaxUniform / lim.muMax - 1)).toBeLessThan(0.1)
  })

  it('cppll3MinusReL 與 cppll3InversionEdge：與 sspll.ts 的 cppllMinusReL／cppllFinv 相同', () => {
    const l3 = makeL3({ pmCt: 60, mapping: 'impulse', bwHz: 320e6, fRefHz: 4e9 })
    const d = { K: Number(l3.params.K), B: Number(l3.params.B), p: Number(l3.params.p) }
    for (const f of [0.001, 0.01, 0.02, 0.05, 0.2]) expect(cppll3MinusReL(d, f).total).toBeCloseTo(cppllMinusReL(l3.params, f), 10)
    expect(cppll3InversionEdge(d)).toBeCloseTo(cppllFinv(l3.params), 9)
    const des = pllDesign({ pll: 'cppll3', pllBwHz: 320e6, fRefHz: 4e9, zeta: 0.7, loopDelay: 0, pllPmDeg: 60, pllP3Ratio: Math.sqrt(Number(l3.params.b)) })
    expect(cppll3InversionEdge(des.cppll as NonNullable<typeof des.cppll>) * 4e9).toBeCloseTo(des.inversionBands[0].fHiHz, 0)
  })
})

describe('wave 5（接手補完）：同 seed 浮點對照只重跑迴路、one-hot 的延遲、9 權重的檢查語意', () => {
  const same = (a: Float64Array, b: Float64Array, label: string) => {
    expect(a.length, label).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      if (Number.isNaN(b[i])) expect(Number.isNaN(a[i]), `${label}[${i}]`).toBe(true)
      else expect(a[i], `${label}[${i}]`).toBe(b[i])
    }
  }

  it('legacy 的 Monte Carlo twin：沿用 runBlockLms 的 normalization 與解析量、只用 runLabLoop 重跑迴路——與「整段 quantize = false 再跑一次」逐位元相同', () => {
    const p: LabParams = { ...SMALL, blocks: 200, quantize: true, rounding: 'stochastic', overflow: 'saturate', signedReg: true, aFs: 3.05 }
    expect(usesLegacyEngine(p)).toBe(true)
    const seeds = mcSeeds(p.seed, 0, 3)
    const c = runMcChunk({ base: p, seeds, twin: true })
    const old = runMcChunk({ base: { ...p, quantize: false }, seeds })
    const tw = c.twin as NonNullable<typeof c.twin>
    expect(tw.seeds).toEqual(seeds)
    for (const k of ['meanW', 'stdW', 'bias', 'settling', 'wSum', 'wSum2'] as const) same(tw[k], old[k], k)
    expect(tw.nValid).toBe(old.nValid)
    expect(tw.diverged).toBe(old.diverged)
    // 定點本身沒有被 twin 影響
    const noTwin = runMcChunk({ base: p, seeds })
    same(c.meanW, noTwin.meanW, 'meanW（定點）')
    expect(noTwin.twin).toBeUndefined()
  })

  it('新引擎的 Monte Carlo：code 與 seed 無關時沿用 base.seed 的 prepare（只換 seed），結果與每個 seed 各自 prepareLab 逐位元相同；twin 與整段浮點重跑相同', () => {
    const p: LabParams = { ...SMALL, architecture: 'pmux8_gos', regressorSign: 'spec', codeSource: 'dsm_first_order', frac: 0.137, phosRmsFs: 60, pll: 'none', blocks: 120, quantize: true, signedReg: true, internalBits: 22, physicalBits: 12, lsbFs: 0.125 }
    expect(codeIndependentOfSeed(p)).toBe(true)
    expect(codeIndependentOfSeed({ ...p, dither: true })).toBe(false)
    expect(codeIndependentOfSeed({ ...p, codeSource: 'iid_pm_one' })).toBe(false)
    expect(codeIndependentOfSeed({ ...p, pmuxOrder: 'random' })).toBe(false)
    const seeds = mcSeeds(p.seed, 2, 3)
    const c = runMcChunk({ base: p, seeds, twin: true })
    const design = pllDesign(p)
    seeds.forEach((seed, r) => {
      const ref = runLabLoop(prepareLab({ ...p, seed }, design))
      expect(c.meanW[r], `seed ${seed}`).toBe(ref.metrics.meanW)
      for (let j = 0; j < 9; j++) expect(c.mimo?.meanW[r * 9 + j], `seed ${seed} w_${j}`).toBe(ref.perWeight.meanW[j])
    })
    const old = runMcChunk({ base: { ...p, quantize: false }, seeds })
    const tw = c.twin as NonNullable<typeof c.twin>
    for (const k of ['meanW', 'stdW', 'bias', 'wSum'] as const) same(tw[k], old[k], `twin ${k}`)
    same((tw.mimo as NonNullable<typeof tw.mimo>).meanW, (old.mimo as NonNullable<typeof old.mimo>).meanW, 'twin 9 權重')
  })

  it('delayed regressor（D = 3）的 one-hot：第一個 block 的前 D 個樣本沒有 p[n−D]，不累加；之後 Σ_p G_p = mean(q)', () => {
    const p: LabParams = { ...SMALL, architecture: 'pmux8_gos', regressorSign: 'spec', codeSource: 'dsm_first_order', frac: 0.137, phosRmsFs: 60, pll: 'none', regressor: 'delayed', codeDelay: 3, blocks: 4, outBlocks: 4 }
    const pr = prepareLab(p, pllDesign(p))
    const r = runLabLoop(pr, { trace: true, windowBlocks: 4 })
    const win = r.window as NonNullable<typeof r.window>
    expect(win.startBlock).toBe(0)
    const N = p.N
    const sumG = (k: number) => Array.from({ length: 8 }, (_, j) => r.G[j][k]).reduce((a, b) => a + b, 0)
    let q0 = 0
    for (let n = 3; n < N; n++) q0 += win.q[n]
    expect(sumG(0)).toBeCloseTo(q0 / N, 12)
    let q1 = 0
    for (let n = 0; n < N; n++) q1 += win.q[N + n]
    expect(sumG(1)).toBeCloseTo(q1 / N, 12)
  })

  it('9 權重的穩定性檢查：一階 DSM、α f_ref 落在 CPPLL 的反號帶（PHOS mode-1 反號）⇒ 平均模型 ρ ≥ 1、模擬的可觀測殘差也不收斂 ⇒ 「一致」；mean w／σ 沒有固定點可比 ⇒ n/a', () => {
    const p: LabParams = {
      ...SMALL,
      architecture: 'pmux8_gos',
      regressorSign: 'spec',
      codeSource: 'dsm_first_order',
      frac: 0.02,
      normalization: 'none',
      phosRmsFs: 173,
      aFs: 250,
      muPhosFs: 40,
      muFs: 10,
      pll: 'cppll3',
      pllBwHz: 320e6,
      pllPmDeg: 60,
      pllP3Ratio: 2 + Math.sqrt(3),
      sigmaV: 200,
      N: 512,
      blocks: 1200,
    }
    const r = runPipeline(p)
    const m = r.mimo as NonNullable<typeof r.mimo>
    expect(m.analysis.minReEig).toBeLessThan(0)
    expect(m.analysis.stable).toBe(false)
    expect(m.checks.stability.status).toBe('ok')
    expect(m.checks.stability.note).toContain('沒有收斂')
    expect(m.checks.meanW.status).toBe('n/a')
    expect(m.checks.sigma.status).toBe('n/a')
    expect(m.phosRmsFs).toBeGreaterThan(50)
    // 同一組參數換成 MASH：one-hot 的功率被打散，極性回到正確
    const ok = runPipeline({ ...p, codeSource: 'mash111' })
    expect((ok.mimo as NonNullable<typeof ok.mimo>).analysis.minReEig).toBeGreaterThan(0)
    expect((ok.mimo as NonNullable<typeof ok.mimo>).checks.stability.status).toBe('ok')
  })

  it('共模不可觀測時（type-II）9 權重的統計先去共模：Σ stdObs² ≤ Σ stdW²、Monte Carlo 的 commonModeRemoved = true；none 路徑共模可觀測、不去共模', () => {
    const base: LabParams = { ...SMALL, architecture: 'pmux8_gos', regressorSign: 'spec', codeSource: 'dsm_first_order', frac: 0.137, phosRmsFs: 60, muPhosFs: 10, blocks: 300 }
    const r = runPipeline({ ...base, pll: 'type2', pllBwHz: 20e6 })
    const m = r.mimo as NonNullable<typeof r.mimo>
    expect(m.analysis.commonModeObservable).toBe(false)
    // Σ_j Var(w_j − cm) = Σ_j Var(w_j) − 8·Var(cm) ≤ Σ_j Var(w_j)（個別的權重不一定變小）
    const ss = (f: (w: (typeof m.perWeight)[number]) => number) => m.perWeight.slice(0, 8).reduce((acc, w) => acc + f(w) ** 2, 0)
    expect(ss((w) => w.stdObs)).toBeLessThanOrEqual(ss((w) => w.stdW) * (1 + 1e-12))
    expect(m.perWeight[8].stdObs).toBe(m.perWeight[8].stdW)
    const s2 = combineMcMimo([runMcChunk({ base: { ...base, pll: 'type2', pllBwHz: 20e6 }, seeds: mcSeeds(base.seed, 0, 2) })]) as NonNullable<ReturnType<typeof combineMcMimo>>
    expect(s2.commonModeRemoved).toBe(true)
    // 去共模後 8 個 PHOS 的跨 seeds 平均加起來是 0
    expect(Math.abs(s2.perWeight.slice(0, 8).reduce((a, w) => a + w.meanW, 0))).toBeLessThan(1e-9)
    const s0 = combineMcMimo([runMcChunk({ base: { ...base, pll: 'none' }, seeds: mcSeeds(base.seed, 0, 2) })]) as NonNullable<ReturnType<typeof combineMcMimo>>
    expect(s0.commonModeRemoved).toBe(false)
  })
})
