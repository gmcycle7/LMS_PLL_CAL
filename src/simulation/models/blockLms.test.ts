import { describe, expect, it } from 'vitest'
import { createRng, normCdf } from '@/simulation/core'
import {
  analyzeBlockLms,
  BlockLmsConfigSchema,
  createZigguratNormal,
  DEFAULT_BLOCK_LMS_CONFIG,
  generateCodePattern,
  parseBlockLmsConfig,
  runBlockLms,
  runBlockLmsMonteCarlo,
  SPEC_15_3_EXAMPLE,
  type BlockLmsConfigInput,
} from '@/simulation/models/blockLms'
import { chainSumMoments, comparatorChain, meanQ, metaProb, nonidealSummary } from '@/simulation/models/comparator'

// 解析參考值由 python3（NumPy / SciPy）獨立計算後貼上；Monte Carlo 使用固定 seed 與統計容忍度。

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b)

/** 單頻 code（A = 1、不正規化）＋ single_tone 路徑 */
function toneConfig(phaseDeg: number, mode: 'raw' | 'delayed' | 'filtered', D: number, blocks = 800): BlockLmsConfigInput {
  return {
    num_blocks: blocks,
    code_normalization: 'none',
    seeded_pattern: { kind: 'sinusoid', parameters: { amplitude: 1, omega: Math.PI / 6, phase_deg: 0 } },
    pll_error_path: { kind: 'single_tone', parameters: { magnitude: 1, phase_deg: phaseDeg, omega: Math.PI / 6 } },
    regressor_mode: mode,
    gm_code_delay_samples: D,
    record: { sample_trace_blocks: 0, decimate: 1 },
  }
}

describe('Config schema（§15.3）與中文錯誤訊息', () => {
  it('DEFAULT_BLOCK_LMS_CONFIG 重現規格 §15.3 JSON，並補齊擴充欄位預設值', () => {
    const d = DEFAULT_BLOCK_LMS_CONFIG
    for (const [k, v] of Object.entries(SPEC_15_3_EXAMPLE)) expect(d[k as keyof typeof d]).toMatchObject(v as object)
    expect(d.gain_register.quantize_physical).toBe(false)
    expect(d.num_blocks).toBe(2000)
    expect(d.regressor_mode).toBe('raw')
    expect(d.dtc_nonlinearity).toEqual({ offset_fs: 0, c2: 0, c3: 0 })
    expect(d.seeded_pattern).toEqual({ kind: 'iid_pm_one', parameters: { amplitude: 1 } })
    // 空物件 ⇒ 全部預設
    const r = parseBlockLmsConfig({})
    expect(r.ok).toBe(true)
    expect(r.config).toEqual(d)
    // JSON 字串也可以
    expect(parseBlockLmsConfig(JSON.stringify(SPEC_15_3_EXAMPLE)).config).toEqual(d)
  })

  it('不合法輸入回傳繁體中文錯誤（欄位路徑：訊息）', () => {
    const r = parseBlockLmsConfig({
      gm_accum_samples: 0,
      gm_mode: 'mean',
      pd_noise_rms_fs: -1,
      typo_key: 1,
      seed: 1.5,
      pll_error_path: { kind: 'magic', parameters: {} },
    })
    expect(r.ok).toBe(false)
    const msg = r.errors.join('\n')
    expect(msg).toMatch(/gm_accum_samples：必須 ≥ 1/)
    expect(msg).toMatch(/gm_mode：必須為 'average' \| 'sum'，收到 'mean'/)
    expect(msg).toMatch(/pd_noise_rms_fs：必須 ≥ 0/)
    expect(msg).toMatch(/未知的欄位：typo_key/)
    expect(msg).toMatch(/seed：必須為整數/)
    expect(msg).toMatch(/pll_error_path\.kind：kind 必須為/)
    expect(parseBlockLmsConfig('{bad json').errors[0]).toMatch(/JSON 格式錯誤/)
  })

  it('跨欄位檢查：總樣本數上限、Ω = π 的單頻路徑（E46）、internal_bits ≥ physical_bits', () => {
    expect(parseBlockLmsConfig({ gm_accum_samples: 1 << 20, num_blocks: 1000 }).errors.join('')).toMatch(/總樣本數/)
    const e = parseBlockLmsConfig({
      pll_error_path: { kind: 'single_tone', parameters: { magnitude: 1, phase_deg: 120, omega: Math.PI } },
    })
    expect(e.errors.join('')).toMatch(/E46/)
    expect(parseBlockLmsConfig({ gain_register: { internal_bits: 4, physical_bits: 6 } }).errors.join('')).toMatch(/internal_bits/)
    expect(() => runBlockLms({ gm_mode: 'bogus' as never })).toThrow(/blockLms 參數錯誤/)
    // schema 本身可直接用
    expect(BlockLmsConfigSchema.safeParse({}).success).toBe(true)
  })
})

describe('Ziggurat Gaussian（comparator noise 產生器）', () => {
  it('KS 檢定、動差與尾端機率符合 N(0, 1)', () => {
    const g = createZigguratNormal(createRng(20261010).fork('zig-test'))
    const n = 1 << 22
    const x = new Float64Array(n)
    let s1 = 0
    let s2 = 0
    let s4 = 0
    let tailR = 0
    let tail4 = 0
    for (let i = 0; i < n; i++) {
      const v = g()
      x[i] = v
      s1 += v
      s2 += v * v
      s4 += v * v * v * v
      if (Math.abs(v) > 3.442619855899) tailR++
      if (v > 4) tail4++
    }
    const m = s1 / n
    const v2 = s2 / n
    expect(Math.abs(m)).toBeLessThan(5 / Math.sqrt(n))
    expect(Math.abs(v2 - 1)).toBeLessThan(5 * Math.sqrt(2 / n))
    expect(Math.abs(s4 / n - 3)).toBeLessThan(5 * Math.sqrt(96 / n))
    // python：P(|z| > R) = 5.761085e-4、P(z > 4) = 3.167124e-5
    expect(Math.abs(tailR - 5.761085123916393e-4 * n)).toBeLessThan(5 * Math.sqrt(5.76e-4 * n))
    expect(Math.abs(tail4 - 3.167124183311986e-5 * n)).toBeLessThan(5 * Math.sqrt(3.17e-5 * n))
    // KS（前 2^20 個樣本）
    const k = x.slice(0, 1 << 20).sort()
    let D = 0
    for (let i = 0; i < k.length; i++) {
      const F = normCdf(k[i])
      D = Math.max(D, Math.abs((i + 1) / k.length - F), Math.abs(F - i / k.length))
    }
    expect(D * Math.sqrt(k.length)).toBeLessThan(1.95) // p ≈ 0.001
  })
})

describe('解析量（§8.2、§12.1、E06、E27）', () => {
  it('預設設定：K_q、g、p、σ_w、PM、f_u、f_3dB、ENBW 與 python 一致', () => {
    const { analytic: an, warnings, modelLevel } = analyzeBlockLms(DEFAULT_BLOCK_LMS_CONFIG)
    expect(rel(an.Kq, 0.007978845608028654)).toBeLessThan(1e-14)
    expect(an.Cest).toBeCloseTo(1, 14) // iid ±1、unit_rms、identity ⇒ C = E[x²] = 1
    expect(rel(an.g, 0.07978845608028654)).toBeLessThan(1e-12)
    expect(an.p).toBeCloseTo(0.9202115439197135, 12)
    expect(rel(an.sigmaWPred, 0.39918614299092886)).toBeLessThan(1e-12)
    expect(an.pmDeg).toBeCloseTo(87.71362235215027, 10)
    expect(an.fuHz).toBe(976562.5)
    expect(rel(an.f3dbHz, 12931.284485590144)).toBeLessThan(1e-10)
    expect(rel(an.enbwHz, 20289.018256251733)).toBeLessThan(1e-10)
    expect(an.tauBlocks).toBeCloseTo(12.02621286350715, 8)
    expect(an.stableMean).toBe(true)
    expect(an.wStarMeanField).toBeCloseTo(3, 10)
    expect(rel(an.slopeMeanField, 0.007978845608028654)).toBeLessThan(1e-6)
    expect(warnings).toEqual([])
    expect(modelLevel).toBe('L1')
  })

  it('反面測試：gm_mode=sum 卻沿用 average 的 μ ⇒ g = 326.81（pole −325.8），警告；sign-LMS 的 |G| ≤ N 使其成為大振幅 limit cycle', () => {
    const r = runBlockLms({ gm_mode: 'sum', num_blocks: 200, record: { sample_trace_blocks: 0, decimate: 1 } })
    expect(rel(r.analytic.g, 326.81351610485365)).toBeLessThan(1e-12)
    expect(r.analytic.p).toBeCloseTo(-325.81351610485365, 10)
    expect(r.analytic.stableMean).toBe(false)
    expect(Number.isNaN(r.analytic.sigmaWPred)).toBe(true)
    const msg = r.warnings.join('\n')
    expect(msg).toMatch(/gm_mode=sum 時有效增益放大 N 倍/)
    expect(msg).toMatch(/g ≥ 2：一階模型不穩定/)
    expect(msg).toMatch(/limit cycle/)
    // 每 block 最多移動 μ·N = 40960 fs：週期 2 的大振幅振盪（理想值 σ_w ≈ 0.4 fs）
    expect(r.metrics.diverged).toBe(false)
    expect(r.metrics.stdW).toBeGreaterThan(1e4)
    let alternations = 0
    for (let k = 100; k < 200; k++) if ((r.blocks.w[k + 1] - 3) * (r.blocks.w[k] - 3) < 0) alternations++
    expect(alternations).toBeGreaterThan(95)
  }, 20000)

  it('更新延遲 d：PM = 90° − (2d+1)asin(g/2)；σ_w 雜訊增益（python lfilter 脈衝能量）', () => {
    const Kq = Math.sqrt(2 / Math.PI) / 100
    const a1 = analyzeBlockLms({ cal_update_delay_blocks: 1, gain_step: 0.5 / Kq })
    expect(a1.analytic.g).toBeCloseTo(0.5, 12)
    expect(a1.analytic.pmDeg).toBeCloseTo(46.567463442210226, 10)
    // σ_w = μ·√(σ_η²·2.4)，σ_η² = 1/N
    expect(rel(a1.analytic.sigmaWPred, (0.5 / Kq) * Math.sqrt(2.4 / 4096))).toBeLessThan(1e-9)
    expect(Number.isNaN(a1.analytic.f3dbHz)).toBe(true) // d > 0 不提供
    const a2 = analyzeBlockLms({ cal_update_delay_blocks: 2, gain_step: 0.3 / Kq })
    expect(rel(a2.analytic.sigmaWPred, (0.3 / Kq) * Math.sqrt(3.8894246223079394 / 4096))).toBeLessThan(1e-9)
    expect(a2.analytic.gCritical).toBeCloseTo(0.6180339887498948, 14)
    const a3 = analyzeBlockLms({ cal_update_delay_blocks: 2, gain_step: 0.8 / Kq })
    expect(a3.analytic.stableMean).toBe(false)
    expect(a3.analytic.rhoMean).toBeCloseTo(1.0780489796045327, 9)
    expect(a3.analytic.pmDeg).toBeCloseTo(-27.890892391009174, 9)
    expect(Number.isNaN(a3.analytic.sigmaWPred)).toBe(true)
    expect(a3.warnings.join('')).toMatch(/2sin\(π\/\(4d\+2\)\)/)
  }, 20000)
})

describe('Monte Carlo', () => {
  it('T13: σ_v=100 fs、N=4096、μ=10 fs、a=3、w0=0、iid ±1、identity ⇒ mean(w) → 3，σ_w ≈ 0.399 fs', () => {
    const mc = runBlockLmsMonteCarlo({ config: DEFAULT_BLOCK_LMS_CONFIG, runs: 6 })
    expect(mc.perRun.diverged).toBe(0)
    // 每 run 後半段 1000 blocks 平均的標準誤 ≈ σ_w√((1+p)/(1−p)/1000) ≈ 0.062；6 runs ⇒ 0.025
    expect(Math.abs(mc.meanW.mean - 3)).toBeLessThan(0.1)
    expect(mc.meanW.lo).toBeLessThan(3.05)
    expect(mc.meanW.hi).toBeGreaterThan(2.95)
    // 每 run 的 stdW 相對標準誤約 8%（有效樣本 ≈ 83）；6 runs 合併 ≈ 3.2%
    expect(Math.abs(mc.pooledStdW / 0.39918614299092886 - 1)).toBeLessThan(0.1)
    expect(rel(mc.analytic.sigmaWPred, 0.39918614299092886)).toBeLessThan(1e-12)
  }, 30000)

  it('更新延遲 d = 1、g = 0.5：MC σ_w 與脈衝能量預測（2.4/N）一致', () => {
    const Kq = Math.sqrt(2 / Math.PI) / 100
    const r = runBlockLms({ cal_update_delay_blocks: 1, gain_step: 0.5 / Kq, num_blocks: 3000, record: { sample_trace_blocks: 0, decimate: 1 } })
    expect(r.analytic.sigmaWPred).toBeCloseTo(1.5172, 3)
    expect(Math.abs(r.metrics.sigmaWRatio - 1)).toBeLessThan(0.1)
    expect(Math.abs(r.metrics.meanW - 3)).toBeLessThan(0.3)
  }, 20000)
})

describe('PLL error path 的相位與 regressor 對齊（T06 / T07 定性）', () => {
  it('T06: single-tone 路徑 φ = 120°、raw regressor ⇒ C < 0、正 μ 使 w 遠離 a；delayed D = 8（θ = 0°）修正', () => {
    const raw = runBlockLms(toneConfig(120, 'raw', 0))
    expect(raw.analytic.Cest).toBeCloseTo(-0.25, 4)
    expect(raw.warnings.join('\n')).toMatch(/C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散/)
    const w = raw.blocks.w
    expect(Math.abs(w[200] - 3)).toBeGreaterThan(Math.abs(w[50] - 3))
    expect(w[800]).toBeLessThan(3 - 100) // 已遠離 a = 3
    expect(raw.modelLevel).toBe('L2')
    const fixed = runBlockLms(toneConfig(120, 'delayed', 8))
    expect(fixed.analytic.Cest).toBeCloseTo(0.5, 4)
    expect(fixed.warnings.join('')).not.toMatch(/C ≤ 0/)
    expect(Math.abs(fixed.metrics.meanW - 3)).toBeLessThan(0.4)
    expect(fixed.metrics.settlingBlock).not.toBeNull()
  }, 20000)

  it('T07: φ = −120°、Ω = π/6、D = 4 ⇒ θ = 0°、C_D = 0.5 最大，收斂到 a；raw 則發散；filtered-x（Ĥ = H）亦收斂', () => {
    const raw = runBlockLms(toneConfig(-120, 'raw', 0, 600))
    expect(raw.analytic.Cest).toBeCloseTo(-0.25, 4)
    expect(Math.abs(raw.blocks.w[600] - 3)).toBeGreaterThan(50)
    const del = runBlockLms(toneConfig(-120, 'delayed', 4))
    expect(del.analytic.Cest).toBeCloseTo(0.5, 4)
    expect(Math.abs(del.metrics.meanW - 3)).toBeLessThan(0.4)
    const fx = runBlockLms(toneConfig(-120, 'filtered', 0))
    expect(fx.analytic.Cest).toBeCloseTo(0.5, 4) // E[u²] = A²|H|²/2
    expect(Math.abs(fx.metrics.meanW - 3)).toBeLessThan(0.4)
    // Filtered-x 模型多算 6 samples latency（Ω·6 = 180°）⇒ E[u·u_f] = −0.5，同樣反向（E45）
    const bad = runBlockLms({ ...toneConfig(-120, 'filtered', 0, 50), filtered_x_model: { extra_delay_samples: 6 } })
    expect(bad.analytic.Cest).toBeCloseTo(-0.5, 4)
    expect(bad.warnings.join('\n')).toMatch(/Ĥ ≠ H/)
  }, 20000)
})

describe('Comparator 編碼（反面測試：錯誤位元符號）', () => {
  const base: BlockLmsConfigInput = {
    code_normalization: 'none',
    seeded_pattern: { kind: 'gaussian', parameters: { mean: 0.5, sigma: 1 } },
    num_blocks: 2000,
    record: { sample_trace_blocks: 0, decimate: 1 },
  }

  it('unipolar_mapped（q = 2b − 1）與 bipolar_pm_one 完全相同', () => {
    const a = runBlockLms({ ...base, num_blocks: 200 })
    const b = runBlockLms({ ...base, num_blocks: 200, comparator_encoding: 'unipolar_mapped' })
    expect(Array.from(b.blocks.w)).toEqual(Array.from(a.blocks.w))
  })

  it('unipolar_unmapped_bug（q = b ∈ {0,1}）：E[x] = 0.5 時固定點偏到 w* ≈ 63.23 fs（python mean-field），而非 a = 3', () => {
    const good = runBlockLms(base)
    expect(Math.abs(good.metrics.meanW - 3)).toBeLessThan(0.4)
    const bug = runBlockLms({ ...base, comparator_encoding: 'unipolar_unmapped_bug' })
    expect(bug.warnings.join('\n')).toMatch(/unipolar_unmapped_bug/)
    // python：E_x[x·Φ((a − w)x/σ_v)] = 0，x ~ N(0.5, 1) ⇒ w* = 63.234073849554626；預測 σ_w ≈ 0.3746
    expect(Math.abs(bug.metrics.meanW - 63.234073849554626)).toBeLessThan(0.5)
    expect(bug.metrics.bias).toBeGreaterThan(50)
    // 解析 mean-field（2^14 個 code 樣本，E[x] 抽樣誤差 ±0.008 ⇒ w* 約 ±1 fs）
    expect(Math.abs(bug.analytic.wStarMeanField - 63.234073849554626)).toBeLessThan(4)
    expect(bug.analytic.K).toBeCloseTo(good.analytic.K / 2, 12) // 小訊號增益減半
  }, 20000)
})

describe('GMAC scaling 與決定性', () => {
  it('sum 模式用 μ/N 與 average 模式用 μ 完全相同（N = 4096 為 2 的冪，逐位元相等）', () => {
    const avg = runBlockLms({ num_blocks: 200 })
    const sum = runBlockLms({ num_blocks: 200, gm_mode: 'sum', gain_step: 10 / 4096 })
    expect(Array.from(sum.blocks.w)).toEqual(Array.from(avg.blocks.w))
    expect(sum.analytic.g).toBeCloseTo(avg.analytic.g, 14)
    sum.blocks.G.forEach((v, k) => expect(v).toBe(avg.blocks.G[k] * 4096))
  }, 20000)

  it('同 seed 完全重現（blocks、trace）；不同 seed 不同', () => {
    const cfg: BlockLmsConfigInput = {
      num_blocks: 100,
      seeded_pattern: { kind: 'mash111', parameters: { frac: 0.3, dither: true } },
      pll_error_path: { kind: 'type2_dt', parameters: { wn_ts: 0.05, zeta: 0.7, loop_delay: 1 } },
      gain_register: { quantize_physical: true, rounding: 'stochastic' },
    }
    const a = runBlockLms(cfg)
    const b = runBlockLms(cfg)
    const c = runBlockLms({ ...cfg, seed: 7 })
    expect(Array.from(a.blocks.w)).toEqual(Array.from(b.blocks.w))
    expect(Array.from(a.blocks.wPhys)).toEqual(Array.from(b.blocks.wPhys))
    expect(Array.from(a.trace.e)).toEqual(Array.from(b.trace.e))
    expect(Array.from(a.blocks.w)).not.toEqual(Array.from(c.blocks.w))
  }, 20000)

  it('效能：N = 4096 × 2000 blocks 在 Node 遠低於 2 s（寬鬆量測）', () => {
    // 單獨執行約 0.3–0.6 s；門檻放寬到 4 s，避免平行測試負載造成 flaky
    const t0 = performance.now()
    const r = runBlockLms({ record: { sample_trace_blocks: 1, decimate: 16 } })
    const dt = performance.now() - t0
    expect(r.blocks.w.length).toBe(2001)
    expect(dt).toBeLessThan(4000)
  }, 20000)
})

describe('Trace、code pattern 與誤差模型', () => {
  it('trace：identity 時 u = x；delayed 時 xRef[n] = x[n − D]；decimate 取樣；q ∈ {±1}', () => {
    const r = runBlockLms({ num_blocks: 3, gm_accum_samples: 64, regressor_mode: 'delayed', gm_code_delay_samples: 5, record: { sample_trace_blocks: 2, decimate: 1 } })
    expect(r.trace.x.length).toBe(128)
    expect(Array.from(r.trace.u)).toEqual(Array.from(r.trace.x))
    for (let n = 0; n < 128; n++) expect(r.trace.xRef[n]).toBe(n >= 5 ? r.trace.x[n - 5] : 0)
    expect(r.trace.q.every((v) => v === 1 || v === -1)).toBe(true)
    // e 與 q 一致（tie：e ≥ 0 ⇒ +1）
    r.trace.e.forEach((e, i) => expect(r.trace.q[i]).toBe(e >= 0 ? 1 : -1))
    const d = runBlockLms({ num_blocks: 2, gm_accum_samples: 64, record: { sample_trace_blocks: 2, decimate: 10 } })
    expect(Array.from(d.trace.n)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
  })

  it('generateCodePattern 與模擬內部使用的 code 完全相同（含正規化）', () => {
    const pattern = { kind: 'mash111' as const, parameters: { frac: 0.27, bits: 16, dither: false, signal: 'residue' as const } }
    const r = runBlockLms({
      num_blocks: 4,
      gm_accum_samples: 256,
      seeded_pattern: pattern,
      code_normalization: 'standardize',
      record: { sample_trace_blocks: 4, decimate: 1 },
    })
    const g = generateCodePattern({ pattern, length: 1024, seed: 20261010, normalization: 'standardize' })
    for (let i = 0; i < 1024; i++) expect(r.trace.x[i]).toBeCloseTo(g.code[i], 12)
    expect(r.analytic.normalization.mode).toBe('standardize')
  })

  it('DTC 三階非線性（單頻 code、整數週期）：MSE 固定點 a + c3·E[x⁴]/E[x²] = 4.5；σ_v = 0.5 時 sign-LMS mean-field = 4.500805（python）', () => {
    const cfg = (sigma: number): BlockLmsConfigInput => ({
      num_blocks: 600,
      code_normalization: 'none',
      pd_noise_rms_fs: sigma,
      seeded_pattern: { kind: 'sinusoid', parameters: { omega: Math.PI / 8 } },
      dtc_nonlinearity: { offset_fs: 0, c2: 0, c3: 2 },
      record: { sample_trace_blocks: 0, decimate: 1 },
    })
    const r = runBlockLms(cfg(100))
    expect(r.analytic.wStarLinear).toBeCloseTo(4.5, 10)
    expect(r.analytic.wStarMeanField).toBeCloseTo(4.5000000000004885, 8)
    expect(Math.abs(r.metrics.meanW - 4.5)).toBeLessThan(0.3)
    expect(r.warnings.join('')).toMatch(/GMAC 歸零 ≠ DTC 誤差為零/)
    const a = analyzeBlockLms(cfg(0.5))
    expect(a.analytic.wStarMeanField).toBeCloseTo(4.5008054753841416, 7)
  }, 20000)

  it('PLL type-II 路徑 + MASH 1-1-1 residue：C ≈ h_PD[0]·E[x²] 附近、收斂', () => {
    const r = runBlockLms({
      num_blocks: 300,
      seeded_pattern: { kind: 'mash111', parameters: { frac: 0.3, dither: true } },
      code_normalization: 'standardize',
      pll_error_path: { kind: 'type2_dt', parameters: { wn_ts: 0.05, zeta: 0.7, loop_delay: 0 } },
      record: { sample_trace_blocks: 1, decimate: 4 },
    })
    expect(r.analytic.Cest).toBeGreaterThan(0.9)
    expect(r.analytic.Cest).toBeLessThan(1.1)
    expect(Math.abs(r.metrics.meanW - 3)).toBeLessThan(0.5)
    expect(r.modelLevel).toBe('L2')
  }, 20000)
})

// 技術審查 R06b：F-07.1 的 e_PD[n] = (a − w)·u[n] + v[n]（u = h * x）只有 w 凍結時是等式。
// 模擬核心照電路的順序算：先乘 (a − w_k)，再進「狀態跨 block 保留」的 H_PD；trace.u 另用一顆同係數的濾波器算 h * x。
// 下面三個測試把「本站的閉迴路模擬不用這個近似」這句話（Ch07 §7.4、docs/assumptions.md 第 8 點）釘在真正的核心上。
describe('R06b：模擬核心先乘 (a − w_k) 再過 H_PD；e = (a − w)·u 只有 w 凍結時成立', () => {
  /** 兩拍反例：h = [1, −1]（u[n] = x[n] − x[n−1]）、x ≡ 1、a = 1、N = 1、μ = 1、無雜訊 */
  const TWO_TAP: BlockLmsConfigInput = {
    seed: 1,
    gm_accum_samples: 1,
    num_blocks: 6,
    gain_initial: 0,
    gain_true: 1,
    gain_step: 1,
    code_normalization: 'none',
    pd_noise_rms_fs: 0,
    pll_error_path: { kind: 'fir', parameters: { taps: [1, -1] } },
    seeded_pattern: { kind: 'sinusoid', parameters: { amplitude: 1, omega: 0, phase_deg: 0 } },
    record: { sample_trace_blocks: 6, decimate: 1 },
  }
  /** Type-II 誤差路徑（ω_nT_s = 0.05、ζ = 0.7）、單頻 code Ω = π/6、無雜訊；μ 由呼叫端決定 */
  const type2 = (mu: number): BlockLmsConfigInput => ({
    seed: 1,
    gm_accum_samples: 64,
    num_blocks: 8,
    gain_initial: 1.25,
    gain_true: 3,
    gain_step: mu,
    code_normalization: 'none',
    pd_noise_rms_fs: 0,
    pll_error_path: { kind: 'type2_dt', parameters: { wn_ts: 0.05, zeta: 0.7 } },
    seeded_pattern: { kind: 'sinusoid', parameters: { amplitude: 1, omega: Math.PI / 6, phase_deg: 0 } },
    record: { sample_trace_blocks: 8, decimate: 1 },
  })
  /** −0 → +0（toEqual 以 Object.is 比較數字） */
  const list = (a: ArrayLike<number>): number[] => Array.from(a, (v) => v + 0)
  /** 逐 sample 的 e[n] − (a − w_{k(n)})·u[n]；w_{k(n)} 是該 sample 所在 block 實際作用的係數 */
  const residual = (r: ReturnType<typeof runBlockLms>): number[] => {
    const N = r.config.gm_accum_samples
    return list(r.trace.e).map((e, n) => e - (r.config.gain_true - r.blocks.wPhys[Math.floor(n / N)]) * r.trace.u[n] + 0)
  }

  it('兩拍反例：w 在 0 與 1 之間來回跳，從第二個 sample 起 e 與 (a − w)·u 差 ±1（不是等式）', () => {
    const r = runBlockLms(TWO_TAP)
    expect(list(r.trace.x)).toEqual([1, 1, 1, 1, 1, 1])
    expect(list(r.trace.u)).toEqual([1, 0, 0, 0, 0, 0]) // h * x：只有第一拍不是 0
    expect(list(r.blocks.w)).toEqual([0, 1, 0, 1, 0, 1, 0])
    // 真實電路：e[n] = (a − w[n])·x[n] − (a − w[n−1])·x[n−1] = w[n−1] − w[n]（第一拍 w[−1] 視為沒有訊號 ⇒ e[0] = 1）
    expect(list(r.trace.e)).toEqual([1, -1, 1, -1, 1, -1])
    // 簡化式 (a − w[n])·u[n] = [1, 0, 0, 0, 0, 0]：第二拍起差的就是「上一拍的 w 還留在 h 的記憶裡」那一項
    expect(residual(r)).toEqual([0, -1, 1, -1, 1, -1])
  })

  it('對照（w 凍結，μ = 0）：e = (a − w)·u 逐 sample 成立——兩拍路徑的殘差恰為 0，Type-II 路徑只剩捨入誤差', () => {
    const fir = runBlockLms({ ...TWO_TAP, gain_step: 0 })
    expect(list(fir.blocks.w)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(list(fir.trace.e)).toEqual([1, 0, 0, 0, 0, 0])
    expect(residual(fir)).toEqual([0, 0, 0, 0, 0, 0])
    const iir = runBlockLms(type2(0))
    expect(iir.trace.e.length).toBe(512)
    expect(list(iir.blocks.w)).toEqual(Array<number>(9).fill(1.25))
    expect(Math.max(...Array.from(iir.trace.u, Math.abs))).toBeGreaterThan(1) // u 不是 0：比較有意義
    expect(Math.max(...residual(iir).map(Math.abs))).toBeLessThan(1e-12) // 實測 2.2e-14
  })

  it('反面對照：同一個 Type-II 設定讓 w 每個 block 更新（μ = 0.5），殘差比捨入誤差大十個數量級', () => {
    const r = runBlockLms(type2(0.5))
    expect(r.blocks.w[1]).not.toBe(r.blocks.w[0])
    const res = residual(r)
    // 第一個 block 裡 w 還沒動過：等式仍然成立
    expect(Math.max(...res.slice(0, 64).map(Math.abs))).toBeLessThan(1e-12)
    // w 第一次更新之後，H_PD 的記憶（約 28 個 sample）裡還留著舊的 w
    expect(Math.max(...res.slice(64).map(Math.abs))).toBeGreaterThan(1e-2) // 實測 0.0428
  })
})

describe('定點 gain register（L5）', () => {
  it('quantize_physical：wPhys 為 LSB 整數倍、平均接近 a；超出範圍時飽和（anti-windup 警告）', () => {
    const r = runBlockLms({ num_blocks: 600, gain_register: { quantize_physical: true }, record: { sample_trace_blocks: 0, decimate: 1 } })
    expect(r.modelLevel).toBe('L5')
    for (const v of r.blocks.wPhys) expect(Number.isInteger(v / 0.125)).toBe(true)
    expect(Math.abs(r.metrics.meanWPhys - 3)).toBeLessThan(0.4)
    expect(r.metrics.limitCycleCount).toBeGreaterThan(0)
    // a = 10 fs > 上限 63·0.125 = 7.875 fs
    const s = runBlockLms({ num_blocks: 300, gain_true: 10, gain_register: { quantize_physical: true }, record: { sample_trace_blocks: 0, decimate: 1 } })
    expect(s.metrics.saturationCount).toBeGreaterThan(0)
    expect(Math.max(...s.blocks.wPhys)).toBe(7.875)
    expect(s.warnings.join('')).toMatch(/飽和/)
    // wrap：溢位後跳到另一端
    const w = runBlockLms({
      num_blocks: 300,
      gain_true: 10,
      gain_register: { quantize_physical: true, overflow: 'wrap' },
      record: { sample_trace_blocks: 0, decimate: 1 },
    })
    expect(w.metrics.wrapCount).toBeGreaterThan(0)
    expect(Math.min(...w.blocks.wPhys.subarray(100))).toBeLessThan(1)
  }, 20000)

  it('無雜訊、常數目標：內部暫存器停在 a 附近，physical code 呈週期性（limit-cycle 偵測）', () => {
    // σ_v = 0、a = 3.05 fs（24.4 LSB）、內部 F = 14 bits；μ 小 ⇒ 內部 w 在 a 附近以 ±μ/N 級距振盪
    const r = runBlockLms({
      num_blocks: 400,
      pd_noise_rms_fs: 0,
      gain_true: 3.05,
      gain_step: 0.05,
      gain_initial: 3,
      gain_register: { quantize_physical: true },
      record: { sample_trace_blocks: 0, decimate: 1 },
    })
    expect(r.warnings.join('')).toMatch(/σ_v = 0/)
    expect(Number.isNaN(r.analytic.Kq)).toBe(true)
    // DTC 實際用的是實體 gain：wPhys = 3.0 < a ⇒ G = +1、w += μ；wPhys = 3.125 > a ⇒ G = −1 ⇒ 週期 2 的 limit cycle
    for (const v of r.blocks.wPhys.subarray(200)) expect([3, 3.125]).toContain(v)
    expect(r.metrics.limitCyclePeriod).toBe(2)
    expect(r.metrics.limitCycleCount).toBe(199)
    // 時間平均 gain 3.0625 ≠ a = 3.05：平均正確 ≠ 量化 toggle 的佔空比正確（§13.2）
    expect(r.metrics.meanWPhys).toBe(3.0625)
  })
})

describe('Ch05 §5b：comparator 選項（hysteresis_fs、meta_window_fs、meta_policy；預設關閉，行為不變）', () => {
  /** x ≡ 1（振幅 1、ω = 0 的「弦波」）、凍結 w（μ = 0）：GMAC 的平均就是 comparator 在 s = a − w₀ 的平均輸出 */
  const frozen = (over: Partial<BlockLmsConfigInput>, N = 1024, blocks = 600): BlockLmsConfigInput => ({
    gm_accum_samples: N,
    num_blocks: blocks,
    gain_step: 0,
    gain_initial: 0,
    gain_true: 10,
    code_normalization: 'none',
    seeded_pattern: { kind: 'sinusoid', parameters: { amplitude: 1, omega: 0, phase_deg: 0 } },
    record: { sample_trace_blocks: 2, decimate: 1 },
    ...over,
  })
  const meanG = (G: Float64Array) => Array.from(G).reduce((x, y) => x + y, 0) / G.length

  it('schema：預設 comparator = { hysteresis_fs: 0, meta_window_fs: 0, meta_policy: drop }；負值與未知欄位被擋下；DEFAULT 設定沒有 comparatorModel', () => {
    expect(DEFAULT_BLOCK_LMS_CONFIG.comparator).toEqual({ hysteresis_fs: 0, meta_window_fs: 0, meta_policy: 'drop' })
    expect(parseBlockLmsConfig({ comparator: { hysteresis_fs: -1 } }).ok).toBe(false)
    expect(parseBlockLmsConfig({ comparator: { meta_policy: 'random' } }).ok).toBe(false)
    expect(parseBlockLmsConfig({ comparator: { hysteresis: 3 } }).errors.join('\n')).toMatch(/未知的欄位/)
    expect(parseBlockLmsConfig({ comparator: { hysteresis_fs: 30, meta_window_fs: 5, meta_policy: 'late' } }).config?.comparator).toEqual({ hysteresis_fs: 30, meta_window_fs: 5, meta_policy: 'late' })
    expect(analyzeBlockLms({}).analytic.comparatorModel).toBeUndefined()
    expect(analyzeBlockLms({}).assumptions.join('\n')).not.toContain('hysteresis')
  })

  it('h = ε = 0（任何 policy）與沒有 comparator 欄位時逐位元相同；T13 的預設結果不變', () => {
    const base = runBlockLms({ num_blocks: 300, record: { sample_trace_blocks: 1, decimate: 1 } })
    for (const meta_policy of ['drop', 'hold', 'late'] as const) {
      const r = runBlockLms({ num_blocks: 300, record: { sample_trace_blocks: 1, decimate: 1 }, comparator: { hysteresis_fs: 0, meta_window_fs: 0, meta_policy } })
      expect(Array.from(r.blocks.w)).toEqual(Array.from(base.blocks.w))
      expect(Array.from(r.trace.q)).toEqual(Array.from(base.trace.q))
      expect(r.analytic.comparatorModel).toBeUndefined()
    }
  })

  it('hysteresis h = σ_v、x ≡ 1、凍結 w：GMAC 平均 = chain 的平穩 E[y]（4 SE 內）；解析摘要的斜率比 1.91、ν = 0.683、雜訊因子 5.30', () => {
    const N = 1024
    const K = 600
    const r = runBlockLms(frozen({ comparator: { hysteresis_fs: 100, meta_window_fs: 0, meta_policy: 'drop' } }, N, K))
    const ch = comparatorChain(10, 100, 100, 0) // s = a − w₀ = 10 fs
    const mo = chainSumMoments(N, ch)
    const se = mo.sdSum / N / Math.sqrt(K)
    expect(Math.abs(meanG(r.blocks.G) - ch.meanOut)).toBeLessThan(4 * se)
    // 遲滯讓平均輸出比理想 comparator 大（斜率 1.91 倍）
    expect(ch.meanOut / meanQ(10, 100)).toBeGreaterThan(1.5)
    const cm = r.analytic.comparatorModel!
    expect(cm.h).toBe(100)
    expect(cm.slopeRatio).toBeCloseTo(nonidealSummary(100, 100, 0).slopeRatio, 12)
    expect(cm.slopeRatio.toFixed(2)).toBe('1.91')
    expect(cm.nu.toFixed(3)).toBe('0.683')
    expect(cm.noiseFactor.toFixed(2)).toBe('5.30')
    expect(r.warnings.join('\n')).toContain('comparator hysteresis h = 100 fs')
    expect(r.assumptions.join('\n')).toContain('hysteresis h = 100 fs')
    // trace 的 q 仍是 ±1（沒有 metastable）
    expect(Array.from(r.trace.q).every((q) => q === 1 || q === -1)).toBe(true)
  })

  it('metastability ε = 5 fs（drop）、x ≡ 1、凍結 w：trace 裡 q = 0 的比例 ≈ P_meta，GMAC 平均 = chain 的 E[y]（除數仍是 N）', () => {
    const N = 1024
    const K = 600
    const r = runBlockLms(frozen({ comparator: { hysteresis_fs: 0, meta_window_fs: 5, meta_policy: 'drop' } }, N, K))
    const ch = comparatorChain(10, 100, 0, 5)
    const zeros = Array.from(r.trace.q).filter((q) => q === 0).length / r.trace.q.length
    expect(Math.abs(zeros - ch.pMeta)).toBeLessThan(4 * Math.sqrt((ch.pMeta * (1 - ch.pMeta)) / r.trace.q.length))
    expect(ch.pMeta).toBeCloseTo(metaProb(10, 100, 5), 14)
    const mo = chainSumMoments(N, ch)
    expect(Math.abs(meanG(r.blocks.G) - ch.meanOut)).toBeLessThan((4 * mo.sdSum) / N / Math.sqrt(K))
    expect(r.warnings.join('\n')).toMatch(/metastability 窗 ε = 5 fs（drop）：每個 block 約 \d+\.\d+ 個 sample 解不出來/)
  })

  it('hold 與 late（x ≡ 1、凍結 w）：hold 的平均 = E[y_drop] + P_meta·E[σ]；late 的平均 = 理想 comparator 的 E[q]（晚一拍但都算進來）', () => {
    const N = 1024
    const K = 600
    const ch = comparatorChain(10, 100, 0, 20)
    const hold = runBlockLms(frozen({ comparator: { hysteresis_fs: 0, meta_window_fs: 20, meta_policy: 'hold' } }, N, K))
    const predHold = ch.meanOut + ch.pMeta * ch.meanState
    expect(Math.abs(meanG(hold.blocks.G) - predHold)).toBeLessThan(4 / Math.sqrt(N * K) * 1.5)
    expect(Array.from(hold.trace.q).every((q) => q === 1 || q === -1)).toBe(true) // 沒有 0：沿用上一個輸出
    const late = runBlockLms(frozen({ comparator: { hysteresis_fs: 0, meta_window_fs: 20, meta_policy: 'late' } }, N, K))
    expect(Math.abs(meanG(late.blocks.G) - meanQ(10, 100))).toBeLessThan(4 / Math.sqrt(N * K) * 1.5)
    // late 的 trace 裡有 0（那一拍沒有）也有 ±2（上一拍補進來的 + 這一拍的）
    const qs = new Set(Array.from(late.trace.q))
    expect(qs.has(0)).toBe(true)
    expect(qs.has(2) || qs.has(-2)).toBe(true)
  })

  it('late ＋ 單頻 code：全部 metastable（ε ≫ σ_v）時 q[n] 乘到 x[n+1]，相關變成 E[x[n+1]·m((a−w)x[n])]（多一拍 code delay，Ch07）', () => {
    const N = 1200 // 100 個週期
    const K = 300
    const cfg: BlockLmsConfigInput = frozen(
      {
        gain_true: 30,
        seeded_pattern: { kind: 'sinusoid', parameters: { amplitude: 1, omega: Math.PI / 6, phase_deg: 0 } },
        comparator: { hysteresis_fs: 0, meta_window_fs: 1e6, meta_policy: 'late' },
      },
      N,
      K,
    )
    const r = runBlockLms(cfg)
    // 期望值：對一個週期（12 點）平均 x[n+1]·(2Φ(30·x[n]/100) − 1)；對照：沒有延遲時是 x[n]·m(30x[n])
    let late = 0
    let aligned = 0
    for (let n = 0; n < 12; n++) {
      const x0 = Math.cos((Math.PI / 6) * n)
      const x1 = Math.cos((Math.PI / 6) * (n + 1))
      const m = meanQ(30 * x0, 100)
      late += (x1 * m) / 12
      aligned += (x0 * m) / 12
    }
    expect(late / aligned).toBeCloseTo(Math.cos(Math.PI / 6), 1) // 小訊號下剛好是 cos Ω
    const se = 1 / Math.sqrt(N * K) // Var(q·x) ≤ 1
    expect(Math.abs(meanG(r.blocks.G) - late)).toBeLessThan(5 * se)
    expect(Math.abs(meanG(r.blocks.G) - aligned)).toBeGreaterThan(5 * se) // 和對齊的相關明顯不同
    expect(r.warnings.join('\n')).toContain('等效多一拍 code delay')
  })

  it('unipolar_unmapped_bug ＋ late：每個 −1 算 0、每個 +1 算 1（兩拍補進來時 q 可以是 2）', () => {
    const r = runBlockLms(frozen({ comparator_encoding: 'unipolar_unmapped_bug', comparator: { hysteresis_fs: 0, meta_window_fs: 1e6, meta_policy: 'late' } }, 256, 20))
    const qs = new Set(Array.from(r.trace.q))
    expect([...qs].every((q) => q === 0 || q === 1)).toBe(true) // 全部 late：每一拍恰好補進前一拍的一個 ±1
    const r2 = runBlockLms(frozen({ comparator_encoding: 'unipolar_unmapped_bug', comparator: { hysteresis_fs: 0, meta_window_fs: 20, meta_policy: 'late' } }, 256, 20))
    expect([...new Set(Array.from(r2.trace.q))].every((q) => q === 0 || q === 1 || q === 2)).toBe(true)
  })
})
