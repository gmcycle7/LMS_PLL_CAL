import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import katex from 'katex'
import { binomPmf, createRng } from '@/simulation/core'
import { runBlockLms } from '@/simulation/models/blockLms'
import {
  CODE_LABEL_TEX,
  P_MIN_3DB,
  REGIME_LABEL_TEX,
  autoBurnIn,
  besselJ,
  binomialFromUniform,
  bw3dbExact,
  bw3dbNegLnP,
  bw3dbNumeric,
  bw3dbOneMinusP,
  calLoop,
  codeSpectraAnalytic,
  dtPsdOneSided,
  dtTotalPower,
  enbwOneSided,
  integrateWithBreaks,
  mixBreakpoints,
  mixingCrossCheck,
  runNoiseLab,
  runNoiseLabBatch,
  sigmaW2Colored,
  simulateCodeSpectra,
  simulateMixing,
  spurBeta,
  spurDbcBessel,
  spurDbcSmallAngle,
  swDtft,
  swOneSided,
  swZohOneSided,
  texNum,
  zohGain,
  type MixingSimParams,
} from './calNoise'

interface Vector {
  inputs: Record<string, number>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function loadVector(id: string): Vector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${id}.json`), 'utf8')) as Vector
}

/** golden 規則：|a − e| ≤ abs + rel·|e| */
function expectGolden(v: Vector, key: string, actual: number): void {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const e = v.expected[key] as number
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e)
  expect(Math.abs(actual - e), `${key}: actual ${actual} vs expected ${e}`).toBeLessThanOrEqual(bound)
}

const T13_BASE = { N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 }
/** T15 的 Code Mixing Lab 預設（preset mixing-t15-spur） */
const MIX_BASE: MixingSimParams = {
  fsim: 4.096e6,
  L: 4096,
  fx: 1e5,
  A: 1,
  m: 0,
  codeWhite: 0,
  fw: 1e4,
  B: 1,
  holdN: 1,
  dwNoiseSigma: 0,
  dwNoiseP: 0.92,
  fOut: 13e9,
  Tmag: 1,
  window: 'rectangular',
  seed: 1,
}

describe('§12.1 係數雜訊：T13', () => {
  it('T13: K、g、p、σ_w、σ_w² 與 golden 向量一致（解析，1e-12）', () => {
    const v = loadVector('T13')
    const lp = calLoop({ N: v.inputs.N, fs: 4e9, mu: v.inputs.mu_fs, sigmaV: v.inputs.sigma_v_fs, C: v.inputs.C })
    expectGolden(v, 'K_per_fs', lp.K)
    expectGolden(v, 'g', lp.g)
    expectGolden(v, 'p', lp.p)
    expectGolden(v, 'sigma_w_fs', lp.sigmaW)
    expectGolden(v, 'sigma_w2_fs2', lp.sigmaW2)
    expect(lp.sigmaEta2).toBe(v.inputs.sigma_eta2)
    // 等價形式：σ_w² = μσ_η²/(K(2 − μK))（由 1 − p² = g(2 − g)）
    expect(lp.sigmaW2).toBeCloseTo((lp.input.mu * lp.sigmaEta2) / (lp.K * (2 - lp.g)), 14)
    expect(lp.regime).toBe('lowpass')
    expect(lp.warnings).toEqual([])
  })

  it('T13: 時域變異遞迴 V_{k+1} = p²V_k + μ²σ_η² 收斂到 μ²σ_η²/(1 − p²)，且 V_k = V_∞(1 − p^{2k})', () => {
    const lp = calLoop(T13_BASE)
    let V = 0
    const q = lp.input.mu ** 2 * lp.sigmaEta2
    for (let k = 1; k <= 400; k++) {
      V = lp.p * lp.p * V + q
      if (k === 10) expect(V).toBeCloseTo(lp.sigmaW2 * (1 - lp.p ** 20), 14)
    }
    expect(V).toBeCloseTo(lp.sigmaW2, 14)
    // Parseval：σ_η²Σh_k² 與 (1/2π)∫S_w dΩ
    let e = 0
    for (let k = 1; k < 2000; k++) e += (lp.input.mu * lp.p ** (k - 1)) ** 2
    expect(e * lp.sigmaEta2).toBeCloseTo(lp.sigmaW2, 12)
    const n = 200000
    let integ = 0
    for (let i = 0; i < n; i++) integ += swDtft(-Math.PI + ((i + 0.5) * 2 * Math.PI) / n, lp.input.mu, lp.p, lp.sigmaEta2)
    expect((integ / n) / lp.sigmaW2).toBeCloseTo(1, 9)
  })

  it('T13: 精確 Block Sign-LMS（x = ±1、Binomial 化簡）Monte Carlo：σ_w 的 95% CI 涵蓋 0.3992 fs', () => {
    const r = runNoiseLab({ ...T13_BASE, engine: 'binomial', blocks: 4000, chains: 24, seed: 20261010 })
    expect(r.diverged).toBe(false)
    expect(r.sigmaWLo).toBeLessThan(0.39918614299092886)
    expect(r.sigmaWHi).toBeGreaterThan(0.39918614299092886)
    expect(Math.abs(r.sigmaW / 0.39918614299092886 - 1)).toBeLessThan(0.03)
    expect(Math.abs(r.meanDw)).toBeLessThan(0.05) // 對稱情況 w* = a
    expect(r.pHat).toBeCloseTo(0.9202, 2)
  }, 30000)

  it('T13: 線性化遞迴 Monte Carlo 與解析 σ_w 一致（95% CI）', () => {
    const r = runNoiseLab({ ...T13_BASE, engine: 'linear', blocks: 4000, chains: 24, seed: 7 })
    expect(r.sigmaWLo).toBeLessThan(0.39918614299092886)
    expect(r.sigmaWHi).toBeGreaterThan(0.39918614299092886)
  })

  it('T13: 逐 sample Block Sign-LMS（runBlockLms：±1 code、Gaussian v、identity path、average）σ_w ≈ 0.399 fs', () => {
    const r = runNoiseLab({ ...T13_BASE, engine: 'sample', blocks: 1000, chains: 2, seed: 11 })
    expect(r.diverged).toBe(false)
    expect(Math.abs(r.sigmaW / 0.39918614299092886 - 1)).toBeLessThan(0.1)
    expect(r.sigmaWLo).toBeLessThan(0.3992)
    expect(r.sigmaWHi).toBeGreaterThan(0.3992)
    expect(r.workUnits).toBe(4096 * 2 * (1000 + autoBurnIn(r.loop)))
  }, 60000)

  it('T13: 反面測試：GMAC 用總和卻沿用 average 的 μ ⇒ g = 326.81、pole = −325.81，出現警告且不存在 σ_w', () => {
    const v = loadVector('T13')
    const lp = calLoop({ ...T13_BASE, gmMode: 'sum' })
    expectGolden(v, 'g_sum_mode', lp.g)
    expectGolden(v, 'pole_sum_mode', lp.p)
    expect(Number.isNaN(lp.sigmaW)).toBe(true)
    expect(lp.regime).toBe('unstable')
    expect(lp.warnings.join('\n')).toMatch(/gm_mode=sum 時有效增益放大 N 倍/)
    expect(lp.warnings.join('\n')).toMatch(/g ≥ 2：一階模型不穩定/)
    const r = runNoiseLab({ ...T13_BASE, gmMode: 'sum', engine: 'linear', blocks: 200, chains: 1, seed: 1, burnIn: 0 })
    expect(r.diverged).toBe(true)
  })

  it('T13: 反面測試：C ≤ 0（極性反轉）⇒ p > 1、極性警告，線性 MC 發散', () => {
    const lp = calLoop({ ...T13_BASE, C: -0.5 })
    expect(lp.p).toBeGreaterThan(1)
    expect(lp.regime).toBe('polarity')
    expect(lp.warnings[0]).toMatch(/C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散/)
    const r = runNoiseLab({ ...T13_BASE, C: -0.5, engine: 'linear', blocks: 2000, chains: 1, seed: 2, burnIn: 0, dw0: 1 })
    expect(r.diverged).toBe(true)
    // 非線性 Sign-LMS 不會指數發散，而是以約 μ·(固定值) 的速率線性漂移遠離 w*
    const b = runNoiseLab({ ...T13_BASE, C: -0.5, engine: 'binomial', blocks: 2000, chains: 1, seed: 2, burnIn: 0, dw0: 1 })
    const last = b.trace.dw[b.trace.dw.length - 1]
    expect(Math.abs(last)).toBeGreaterThan(1000)
    expect(b.diverged).toBe(false)
    // 警告必須解釋「為什麼沒有數值發散卻仍然是錯的」，且量到的漂移速率接近 μ（|G| → 1）
    const msg = b.warnings.join('')
    expect(msg).toMatch(/線性漂移遠離 \$w\^\*\$/)
    const rate = Number(/約 ([\d.]+) fs\/block/.exec(msg)?.[1])
    expect(rate).toBeGreaterThan(8)
    expect(rate).toBeLessThanOrEqual(10)
  })

  it('T13: 反面測試：g ≥ 2（μ = 260 fs）時 Sign-LMS 不發散而是有界振盪，警告說明 RMS 與負的 lag-1 自相關', () => {
    const r = runNoiseLab({ ...T13_BASE, mu: 260, engine: 'binomial', blocks: 2000, chains: 4, seed: 9 })
    expect(r.loop.regime).toBe('unstable')
    expect(r.diverged).toBe(false)
    expect(r.sigmaW).toBeGreaterThan(30) // 約 0.46σ_v，比 T13 例大兩個數量級
    expect(r.sigmaW).toBeLessThan(80)
    expect(r.pHat).toBeLessThan(-0.9)
    expect(r.warnings.join('')).toMatch(/有界振盪/)
  })

  it('T13: 反面測試：σ_v = 0 ⇒ K_q 無定義，線性引擎拒絕執行並說明原因', () => {
    const lp = calLoop({ ...T13_BASE, sigmaV: 0 })
    expect(lp.regime).toBe('undefined')
    expect(lp.warnings[0]).toMatch(/\\sigma_v=0\$：\$K_q=.*無定義/)
    expect(() => runNoiseLab({ ...T13_BASE, sigmaV: 0, engine: 'linear', blocks: 100, chains: 1, seed: 1 })).toThrow(/K_q=\\infty/)
  })

  it('T13: 反面測試：σ_v = 0 的 Binomial 引擎退化為確定性 sign（e = 0 時 q = +1），δw 在 ±μ 內做 limit cycle、不產生 NaN', () => {
    const r = runNoiseLab({ ...T13_BASE, sigmaV: 0, engine: 'binomial', blocks: 400, chains: 3, seed: 3, burnIn: 0, dw0: 3 })
    expect(r.diverged).toBe(false)
    expect(Array.from(r.trace.dw).every((x) => Number.isFinite(x))).toBe(true)
    // 由 δw_0 = 3 出發：3 → −7 → 3 → …（每步恰好 ±μ），永遠不會收斂到 0
    expect(r.trace.dw[1]).toBeCloseTo(3 - 10, 12)
    expect(r.trace.dw[2]).toBeCloseTo(3, 12)
    expect(Math.max(...Array.from(r.trace.dw).map(Math.abs))).toBeLessThanOrEqual(10 + 3 + 1e-9)
    expect(r.sigmaW).toBeGreaterThan(3) // 遠大於線性理論會給的任何雜訊值：這是 limit cycle，不是雜訊
    expect(r.warnings.join('')).toMatch(/limit cycle/)
  })

  it('T13: 反面測試：μ ≤ 0 ⇒ p ≥ 1，警告說明「learning rate 必須為正」', () => {
    for (const mu of [0, -5]) {
      const lp = calLoop({ ...T13_BASE, mu })
      expect(lp.regime).toBe('unstable')
      expect(Number.isNaN(lp.sigmaW)).toBe(true)
      expect(lp.warnings.join('')).toMatch(/\\mu\\le0\$：.*learning rate 必須為正/)
    }
  })

  it('T13: 反面測試：sum-mode 警告必須含 verbatim 片語，且不重複「g ≥ 2」', () => {
    const lp = calLoop({ ...T13_BASE, gmMode: 'sum' })
    const txt = lp.warnings.join('\n')
    expect(txt.match(/g ≥ 2：一階模型不穩定/g)?.length).toBe(1)
    expect(txt).toMatch(/g=\\mu KN=326\.8/)
  })

  it('大偏差（δw_0 = 10σ_v）時兩個引擎的差別：線性版每個 block 乘 p（指數收斂，不是發散），sign 版每個 block 最多走 μ', () => {
    // §12.9 程式碼對照的圖說：T13 的迴路 p = 0.9202（穩定），由 δw_0 = 1000 fs 起跑、不做 burn-in
    const lp = calLoop(T13_BASE)
    const start = (engine: 'linear' | 'binomial') => runNoiseLab({ ...T13_BASE, engine, dw0: 1000, blocks: 60, chains: 1, seed: 3, burnIn: 0, traceMax: 100 }).trace.dw
    const lin = start('linear')
    expect(lin[0]).toBe(1000)
    expect(lin[1] / lin[0]).toBeCloseTo(lp.p, 2) // 0.9203：G = −K·δw 沒有上限，一步就走了約 80 fs
    expect(lin[0] - lin[1]).toBeGreaterThan(7 * 10)
    expect(Math.abs(lin[40])).toBeLessThan(0.05 * 1000) // p^40 = 0.036
    const sgn = start('binomial')
    for (let k = 1; k <= 40; k++) expect(Math.abs(sgn[k] - sgn[k - 1])).toBeLessThanOrEqual(10 + 1e-9) // |G| ≤ 1 ⇒ 每步 ≤ μ = 10 fs
    expect(sgn[0] - sgn[1]).toBeCloseTo(10, 6) // 飽和：G ≈ −1
    expect(sgn[40]).toBeGreaterThan(1000 - 40 * 10 - 1e-9)
  })
})

describe('§12.1 小訊號判據的適用範圍（技術審查 R06c）：逐 sample 引擎、固定 w', () => {
  /**
   * 固定係數（gain_step = 0）、δw = w − a = 2 fs、σ_v = 1 fs、±1 iid code，量 GMAC 的平均輸出 E[G | δw]。
   * 精確值（四種 (x[n], x[n−1]) 組合各算一次 erf 再平均；Python 以 erfc 與直接積分各算過一次）：
   *   兩個 tap [0.05, 1]：−0.0108521；單一 tap [0.05]（無記憶 path）：−0.0796557；F-12.1 的線性值 −K·δw = −0.0797885。
   * 用 taps [0.05, 1] 而不是審查意見的 [0.001, 1]（那一組的解析值在 src/chapters/ch12/smallSignalScope.test.ts）：
   * 線性值大十倍（−0.0798 對 −0.008），和量到的 −0.0109 相差約 200 個標準誤差，Monte Carlo 的對照比較清楚。
   */
  const meanG = (taps: number[]) => {
    const r = runBlockLms({
      seed: 7,
      gm_accum_samples: 4096,
      gain_true: 3,
      gain_initial: 5,
      gain_step: 0,
      code_normalization: 'unit_rms',
      gm_mode: 'average',
      pd_noise_rms_fs: 1,
      pll_error_path: { kind: 'fir', parameters: { taps } },
      seeded_pattern: { kind: 'iid_pm_one', parameters: {} },
      num_blocks: 2000,
      record: { sample_trace_blocks: 0, decimate: 1 },
    })
    expect(r.blocks.w[0]).toBe(5)
    expect(r.blocks.w[r.blocks.w.length - 1]).toBe(5) // 係數真的沒有動：量到的是條件平均 E[G | δw = 2]
    let s = 0
    for (let k = 0; k < r.blocks.G.length; k++) s += r.blocks.G[k]
    return s / r.blocks.G.length // 2000 × 4096 個 sample：標準誤差 ≈ 0.00035
  }
  const linear = -Math.sqrt(2 / Math.PI) * 0.05 * 2 // −K·δw，K = K_q·C、C = 0.05

  it('反例：path 有記憶（taps [0.05, 1]）時 |C·δw| = 0.1σ_v 看似小訊號，量到的恢復力卻只有線性值的約 0.14 倍', () => {
    const g = meanG([0.05, 1])
    expect(linear).toBeCloseTo(-0.0797885, 6)
    expect(Math.abs(g - -0.0108521)).toBeLessThan(0.002)
    expect(Math.abs(g - linear)).toBeGreaterThan(0.06)
    expect(g / linear).toBeLessThan(0.2)
  }, 60000)

  it('對照組：無記憶 path（taps [0.05]，本章與 LMS Noise Lab 的模型）時量到的恢復力就是線性值（差 0.17%）', () => {
    const g = meanG([0.05])
    expect(Math.abs(g - -0.0796557)).toBeLessThan(0.002)
    expect(Math.abs(g / linear - 1)).toBeLessThan(0.03)
  }, 60000)
})

describe('§12.4 研究延伸：colored GMAC noise（AR(1) S_η）', () => {
  it('σ_w² 封閉式 (1 + pr)/(1 − pr) 修正 = Parseval 積分；r = 0 時與白色結果完全相同', () => {
    const lp = calLoop(T13_BASE)
    expect(sigmaW2Colored(10, lp.sigmaEta2, lp.p, 0)).toBe(lp.sigmaW2)
    for (const r of [-0.6, 0.5, 0.95]) {
      const closed = sigmaW2Colored(10, lp.sigmaEta2, lp.p, r)
      // 獨立核對（Python/scipy 以 quad 積分得 r = 0.5：0.43094966513；r = 0.95：2.37404949009）
      const n = 400000
      let acc = 0
      for (let i = 0; i < n; i++) acc += swDtft(-Math.PI + ((i + 0.5) * 2 * Math.PI) / n, 10, lp.p, lp.sigmaEta2, r)
      expect(acc / n / closed).toBeCloseTo(1, 7)
      const c = calLoop({ ...T13_BASE, etaR: r })
      expect(c.sigmaW2).toBeCloseTo(closed, 14)
      expect(c.colorFactor).toBeCloseTo((1 + lp.p * r) / (1 - lp.p * r), 14)
      // colored 時 σ_w² = S_w^(1)(0)·ENBW_eff，而 ENBW_eff ≠ H 的 ENBW
      expect(c.sw1Dc * c.enbwEff).toBeCloseTo(c.sigmaW2, 12)
      expect(Math.abs(c.enbwEff / c.enbw - 1)).toBeGreaterThan(0.01)
    }
    expect(sigmaW2Colored(10, lp.sigmaEta2, lp.p, 0.5)).toBeCloseTo(0.43094966513229427, 12)
    expect(sigmaW2Colored(10, lp.sigmaEta2, lp.p, 0.95)).toBeCloseTo(2.3740494900877342, 11)
  })

  it('線性引擎模擬 AR(1) η：σ_w 的 95% CI 涵蓋 colored 解析值；lag-1 自相關 = ρ₁ = p + r(1 − p²)/(1 + pr)', () => {
    const r = runNoiseLab({ ...T13_BASE, etaR: 0.5, engine: 'linear', blocks: 4000, chains: 24, seed: 31 })
    expect(r.loop.sigmaW).toBeCloseTo(Math.sqrt(0.43094966513229427), 12)
    expect(r.sigmaWLo).toBeLessThan(r.loop.sigmaW)
    expect(r.sigmaWHi).toBeGreaterThan(r.loop.sigmaW)
    expect(r.loop.rho1).toBeCloseTo(0.9726771657188955, 12)
    expect(Math.abs(r.pHat - r.loop.rho1)).toBeLessThan(0.005)
    // 白色假設下的 σ_w 不在 CI 內 ⇒ 模擬確實看得到 colored 的效應
    expect(r.sigmaWLo).toBeGreaterThan(0.3991861429909288)
  })

  it('反面：colored r 用在引擎 (b) 會提醒模型不同；|r| ≥ 1 時警告並拒絕線性引擎', () => {
    const b = runNoiseLab({ ...T13_BASE, etaR: 0.5, engine: 'binomial', blocks: 200, chains: 2, seed: 1 })
    expect(b.warnings.join('')).toMatch(/只作用於引擎 \(a\)/)
    const bad = calLoop({ ...T13_BASE, etaR: 1 })
    expect(bad.warnings[0]).toMatch(/\|r\|<1/)
    expect(Number.isNaN(bad.sigmaW)).toBe(true)
    expect(() => runNoiseLab({ ...T13_BASE, etaR: 1, engine: 'linear', blocks: 100, chains: 1, seed: 1 })).toThrow(/r=1\$ 不合法/)
  })
})

describe('LMS Noise Lab：A/B/C paired simulation', () => {
  it('T13: runNoiseLabBatch 依序跑各 case（同 seed 與單獨執行逐位元相同），單一 case 失敗只回傳錯誤字串', () => {
    const a = { ...T13_BASE, engine: 'binomial' as const, blocks: 500, chains: 6, seed: 42 }
    const out = runNoiseLabBatch({
      cases: [
        { id: 'A', params: a },
        { id: 'B', params: { ...a, mu: 2.5 } },
        { id: 'C', params: { ...a, sigmaV: 0, engine: 'linear' } },
      ],
    })
    expect(out.items.map((i) => i.id)).toEqual(['A', 'B', 'C'])
    const single = runNoiseLab(a)
    expect(out.items[0].result?.sigmaW).toBe(single.sigmaW)
    expect(Array.from(out.items[0].result?.trace.dw ?? [])).toEqual(Array.from(single.trace.dw))
    // μ 變 1/4 ⇒ σ_w 約減半（σ_w² ≈ μσ_η²/(2K)）
    expect(out.items[1].result!.loop.sigmaW / out.items[0].result!.loop.sigmaW).toBeCloseTo(Math.sqrt(2.5 / 10) * Math.sqrt((2 - 0.0797884560802865) / (2 - 0.0199471140200716)), 10)
    expect(out.items[2].result).toBeNull()
    expect(out.items[2].error).toMatch(/K_q=\\infty/)
    expect(() => structuredClone(out)).not.toThrow()
  })
})

describe('§12 Calibration 頻寬：T14', () => {
  it('T14: f_u、exact −3 dB、(1 − p)、−ln p、ENBW 與 golden 向量一致（rel 1e-10）', () => {
    const v = loadVector('T14')
    const p = v.inputs.p
    const fu = v.inputs.fs_hz / v.inputs.N
    expectGolden(v, 'f_u_hz', fu)
    expectGolden(v, 'bw_exact_3db_hz', bw3dbExact(p, fu))
    expectGolden(v, 'bw_one_minus_p_hz', bw3dbOneMinusP(p, fu))
    expectGolden(v, 'bw_neg_ln_p_hz', bw3dbNegLnP(p, fu))
    expectGolden(v, 'enbw_one_sided_hz', enbwOneSided(p, fu))
    const lp = calLoop(T13_BASE)
    expectGolden(v, 'bw_exact_3db_hz', lp.f3dbExact)
    expectGolden(v, 'enbw_one_sided_hz', lp.enbw)
  })

  it('T14: 封閉式 = 數值解：二分法 −3 dB、數值積分 ENBW；σ_w² = S_w^(1)(0)·ENBW；Parseval ∫_0^{f_u/2} S_w^(1) df = σ_w²', () => {
    const lp = calLoop(T13_BASE)
    expect(bw3dbNumeric(lp.p, lp.fu) / lp.f3dbExact).toBeCloseTo(1, 10)
    // acos 形式（validation E27）與 asin 形式一致
    const acosForm = (Math.acos(1 - (1 - lp.p) ** 2 / (2 * lp.p)) / (2 * Math.PI)) * lp.fu
    expect(acosForm / lp.f3dbExact).toBeCloseTo(1, 10)
    const S = (f: number) => swOneSided(f, lp.input.mu, lp.p, lp.sigmaEta2, lp.fu)
    const integ = integrateWithBreaks(S, 0, lp.fu / 2, [lp.f3dbExact], 1e-12 * lp.sigmaW2).value
    expect(integ / lp.sigmaW2).toBeCloseTo(1, 9)
    expect(S(0)).toBeCloseTo(lp.sw1Dc, 15)
    expect((lp.sw1Dc * lp.enbw) / lp.sigmaW2).toBeCloseTo(1, 12)
    const enbwNum = integrateWithBreaks((f) => S(f) / S(0), 0, lp.fu / 2, [lp.f3dbExact], 1e-6).value
    expect(enbwNum / lp.enbw).toBeCloseTo(1, 9)
    // ENBW/f_3dB → π/2（p → 1）
    expect(lp.enbw / lp.f3dbExact).toBeCloseTo(1.569, 3)
  })

  it('T14: 反面測試：把 f_3dB 當成「Noise BW」積分會低估 σ_w（0.319 vs 0.399 fs，E06 / E10）', () => {
    const lp = calLoop(T13_BASE)
    const wrong = Math.sqrt(lp.sw1Dc * lp.f3dbExact)
    expect(wrong).toBeCloseTo(0.31869, 4)
    expect(wrong / lp.sigmaW).toBeLessThan(0.81)
    expect((lp.sw1Dc * lp.f3dbExact) / lp.sigmaW2).toBeCloseTo(0.6373, 3) // 方差低估約 36%
  })

  it('T14: (1 − p) 近似的相對誤差 −4.10% ≈ −(1 − p)/2；−ln p 只差 −0.058%（E26）', () => {
    const lp = calLoop(T13_BASE)
    const e1 = lp.f3dbOneMinusP / lp.f3dbExact - 1
    const e2 = lp.f3dbNegLnP / lp.f3dbExact - 1
    expect(e1).toBeCloseTo(-0.041, 3)
    expect(e1 / (-(1 - lp.p) / 2)).toBeCloseTo(1.03, 1)
    expect(e2).toBeCloseTo(-0.00058, 4)
    expect(lp.f3dbSqrtP).toBeCloseTo(12927.56, 1)
  })

  it('T14: −ln p 近似的相對誤差是二階小量 ≈ −(1 − p)²/12；小 ε 時比值趨近 1（泰勒三次項 5/12 vs 1/3）', () => {
    const lp = calLoop(T13_BASE)
    const eps = 1 - lp.p
    const e2 = lp.f3dbNegLnP / lp.f3dbExact - 1
    expect(e2).toBeLessThan(0)
    expect(e2 / (-(eps * eps) / 12)).toBeCloseTo(1.09, 1) // 本例：−0.0576% vs −0.0531%
    // ε → 0 時主項精確：取 p = 0.999
    const r = bw3dbNegLnP(0.999, 1) / bw3dbExact(0.999, 1) - 1
    expect(r / (-(1e-3 * 1e-3) / 12)).toBeCloseTo(1, 2)
    // (1 − p) 版的主項是一階：−ε/2
    const r1 = bw3dbOneMinusP(0.999, 1) / bw3dbExact(0.999, 1) - 1
    expect(r1 / (-1e-3 / 2)).toBeCloseTo(1, 2)
  })

  it('T14: S_w^(1)(0) = πσ_v²/(C²f_s)：低頻位準與 μ、N 無關（μ 只改變 ENBW），且 σ_w² = S_w^(1)(0)·ENBW 對每組都成立', () => {
    const closed = (sigmaV: number, C: number, fs: number) => (Math.PI * sigmaV * sigmaV) / (C * C * fs)
    expect(calLoop(T13_BASE).sw1Dc).toBeCloseTo(closed(100, 1, 4e9), 18)
    expect(closed(100, 1, 4e9)).toBeCloseTo(7.85398163397e-6, 16) // = π/4 × 10⁻⁵ fs²/Hz（Python 獨立計算）
    for (const [mu, N, sigmaV, C] of [
      [2.5, 4096, 100, 1],
      [40, 4096, 100, 1],
      [10, 256, 100, 1],
      [10, 65536, 100, 1],
      [10, 4096, 30, 0.7],
    ] as const) {
      const lp = calLoop({ ...T13_BASE, mu, N, sigmaV, C })
      expect(lp.sw1Dc / closed(sigmaV, C, 4e9)).toBeCloseTo(1, 12)
      expect((lp.sw1Dc * lp.enbw) / lp.sigmaW2).toBeCloseTo(1, 12)
      // ENBW = (f_u/2)·g/(2 − g)
      expect(lp.enbw / ((lp.fu / 2) * (lp.g / (2 - lp.g)))).toBeCloseTo(1, 12)
    }
    // 1-bit 的代價：相對「v 的單邊 PSD 2σ_v²/f_s」多 π/2（1.96 dB）
    expect(10 * Math.log10(closed(100, 1, 4e9) / ((2 * 100 * 100) / 4e9))).toBeCloseTo(1.9612, 4)
  })

  it('C03：DTFT 形式的 S_w 是每 cycle/block 的密度：(1/2π)∫S_w dΩ = σ_w²，直接對 Ω 積分是 2πσ_w²；單邊 per-Hz 只乘 2/f_u', () => {
    const TWO_PI = 2 * Math.PI
    // ∫_{−π}^{π} S_w dΩ（S_w 對 Ω 偶對稱：2 × ∫_0^π）
    const plainIntegral = (mu: number, p: number, sEta: number, breaks: number[], tol: number) =>
      2 * integrateWithBreaks((om) => swDtft(om, mu, p, sEta), 0, Math.PI, breaks, tol).value
    // ── 反例（T13）：把 S_w 當成「每 rad/block」的密度直接對 Ω 積分，得到的不是變異數，而是 2π 倍 ──
    const lp = calLoop(T13_BASE)
    expect(lp.sigmaW2).toBeCloseTo(0.15934957675597428, 14)
    const I = plainIntegral(10, lp.p, lp.sigmaEta2, [(TWO_PI * lp.f3dbExact) / lp.fu], 1e-12 * lp.sigmaW2)
    expect(I).toBeCloseTo(1.00122291937842, 10)
    expect(I / TWO_PI / lp.sigmaW2).toBeCloseTo(1, 9) // 對 Ω/2π（cycle/block）積分才是 σ_w²
    expect(I / lp.sigmaW2).toBeCloseTo(6.283185307, 8) // 直接對 Ω 積分：2π·σ_w²
    // 能直接對 Ω 積分的「每 rad/block」密度是 S_w/(2π)；DC 處 S_w(0) = πσ_v²/(2N)，除以 2π 是 σ_v²/(4N)
    const s0 = swDtft(0, 10, lp.p, lp.sigmaEta2)
    expect(s0 / ((Math.PI * 1e4) / (2 * 4096))).toBeCloseTo(1, 12)
    expect(s0 / TWO_PI).toBeCloseTo(1e4 / (4 * 4096), 12) // 0.6103515625
    // ── per-Hz 那一側不要矯枉過正：S^(1)(0) = (2/f_u)·S_w(0) = πσ_v²/f_s，沒有 2π ──
    const s1 = swOneSided(0, 10, lp.p, lp.sigmaEta2, lp.fu)
    expect(s1 / ((Math.PI * 1e4) / 4e9)).toBeCloseTo(1, 12) // 7.853981634×10⁻⁶ fs²/Hz
    expect(s1 / ((2 / lp.fu) * s0)).toBeCloseTo(1, 14)
    expect((((4 * Math.PI) / lp.fu) * s0) / s1).toBeCloseTo(TWO_PI, 12) // 多乘 2π 的寫法（4.9348×10⁻⁵）差 2π 倍
    // 單位推算：fs²/(cycle/block) × (block/s)⁻¹ = fs²/Hz ⇒ ∫_0^{f_u/2} S^(1) df = ∫_{−1/2}^{1/2} S_w d(Ω/2π)
    expect((s1 * lp.enbw) / lp.sigmaW2).toBeCloseTo(1, 12)
    // ── 對照組：p = +0.5（low-pass）與 p = −0.5（high-pass），N = 16、f_s = 1 MHz、σ_v = 100 fs、C = 1 ──
    const K = Math.sqrt(2 / Math.PI) / 100
    const ctrl = (g: number) => {
      const mu = g / K
      const c = calLoop({ N: 16, fs: 1e6, mu, sigmaV: 100, C: 1 })
      return { mu, c, I: plainIntegral(mu, c.p, c.sigmaEta2, [], 1e-12 * c.sigmaW2) }
    }
    const lo = ctrl(0.5)
    expect(lo.mu).toBeCloseTo(62.665706865775014, 10)
    expect(lo.c.p).toBeCloseTo(0.5, 14)
    expect(lo.c.sigmaW2).toBeCloseTo(327.24923474893683, 9)
    expect(lo.I).toBeCloseTo(2056.167583560283, 6)
    expect(lo.I / lo.c.sigmaW2).toBeCloseTo(TWO_PI, 9)
    expect(lo.I / TWO_PI / lo.c.sigmaW2).toBeCloseTo(1, 10)
    expect(swDtft(0, lo.mu, lo.c.p, lo.c.sigmaEta2) / ((Math.PI * 1e4) / 32)).toBeCloseTo(1, 12) // 981.7477 = π·10⁴/32
    expect(swOneSided(0, lo.mu, lo.c.p, lo.c.sigmaEta2, lo.c.fu) / ((Math.PI * 1e4) / 1e6)).toBeCloseTo(1, 12) // 0.0314159 fs²/Hz
    const hi = ctrl(1.5)
    expect(hi.mu).toBeCloseTo(187.99712059732505, 10)
    expect(hi.c.p).toBeCloseTo(-0.5, 14)
    expect(hi.c.sigmaW2).toBeCloseTo(2945.243112740431, 8)
    expect(hi.I).toBeCloseTo(18505.508252042546, 5)
    expect(hi.I / hi.c.sigmaW2).toBeCloseTo(TWO_PI, 9)
    expect(hi.I / TWO_PI / hi.c.sigmaW2).toBeCloseTo(1, 10)
  })

  it('T14: 反面測試：p < 3 − 2√2 沒有 −3 dB 點、p < 0 為 high-pass、p = 0 flat、|p| ≥ 1 不穩定（E27）', () => {
    expect(P_MIN_3DB).toBeCloseTo(0.171573, 6)
    const Kq = Math.sqrt(2 / Math.PI) / 100
    const at = (g: number) => calLoop({ ...T13_BASE, mu: g / Kq })
    const edge = at(2 * Math.SQRT2 - 2)
    expect(edge.p).toBeCloseTo(P_MIN_3DB, 12)
    expect(edge.f3dbExact).toBeCloseTo(edge.fu / 2, 3) // 恰在 Nyquist
    const no3 = at(0.9)
    expect(no3.regime).toBe('no3db')
    expect(Number.isNaN(no3.f3dbExact)).toBe(true)
    expect(Number.isNaN(bw3dbNumeric(no3.p, no3.fu))).toBe(true)
    expect(no3.f3dbOneMinusP).toBeGreaterThan(0) // 近似仍會給數字 —— 這正是需要警告的原因
    expect(no3.warnings.join('')).toMatch(/−3 dB 點不存在/)
    expect(at(1).regime).toBe('flat')
    const hp = at(1.4)
    expect(hp.regime).toBe('highpass')
    expect(Number.isNaN(hp.f3dbOneMinusP)).toBe(true)
    expect(swDtft(Math.PI, 1, hp.p, 1)).toBeGreaterThan(swDtft(0, 1, hp.p, 1))
    expect(at(2.1).regime).toBe('unstable')
    expect(Number.isNaN(at(2.1).enbw)).toBe(true)
  })

  it('T14: Monte Carlo 的 Welch PSD 與解析 S_w^(1)(f) 一致；p̂ 推得的 ENBW ≈ 20.3 kHz', () => {
    const r = runNoiseLab({ ...T13_BASE, engine: 'binomial', blocks: 8192, chains: 16, seed: 99, nperseg: 512 })
    const ratios: number[] = []
    for (let i = 1; i < r.psd.f.length; i++) {
      if (r.psd.f[i] > 2e3 && r.psd.f[i] < 2e5) ratios.push(r.psd.sim[i] / r.psd.analytic[i])
    }
    ratios.sort((a, b) => a - b)
    const med = ratios[Math.floor(ratios.length / 2)]
    expect(Math.abs(med - 1)).toBeLessThan(0.08)
    expect(Math.abs(r.enbwFromPHat / 20289 - 1)).toBeLessThan(0.06)
    expect(Math.abs(r.f3dbFromPHat / 12931 - 1)).toBeLessThan(0.06)
  }, 30000)
})

describe('§12.2 Multirate 與三種 code 頻譜', () => {
  const lp = calLoop(T13_BASE)
  const sys = { fs: 4e9, N: 4096, mu: 10, p: lp.p, sEta: lp.sigmaEta2 }

  it('ZOH 的 sample-rate PSD 保持總功率（Parseval）且 f → 0 時與 block-rate S_w^(1)(0) 相同（E09 / E29）', () => {
    expect(swZohOneSided(1, 4e9, 4096, 10, lp.p, lp.sigmaEta2) / lp.sw1Dc).toBeCloseTo(1, 6)
    // 常數 code（m = 1）的 δt PSD 就是 ZOH 後的 S_w；白色 code 是平的 (2/f_s)σ_w²
    const constCode = { m: 1, A: 0, fx: 0, whiteVar: 0 }
    expect(dtPsdOneSided(3e3, constCode, sys)).toBe(swZohOneSided(3e3, 4e9, 4096, 10, lp.p, lp.sigmaEta2))
    expect(dtPsdOneSided(7e8, { m: 0, A: 0, fx: 0, whiteVar: 1 }, sys) / ((2 / 4e9) * lp.sigmaW2)).toBeCloseTo(1, 12)
    // 小 N 才能快速積分整個 0…f_s/2
    const s = { fs: 64e6, N: 16, mu: 10, p: 0.8, sEta: 1 / 16 }
    const sw2 = (s.mu ** 2 * s.sEta) / (1 - s.p ** 2)
    const tot = integrateWithBreaks(
      (f) => swZohOneSided(f, s.fs, s.N, s.mu, s.p, s.sEta),
      0,
      s.fs / 2,
      mixBreakpoints(s.fs / s.N, 0, s.fs / 2),
      1e-10 * sw2,
    ).value
    expect(tot / sw2).toBeCloseTo(1, 7)
  })

  it('E09 反面測試：把 block-rate S_w（Ω 為 rad/block）直接當 sample-rate PSD 會在 skirt 差約 N 倍', () => {
    const f = 5e3
    const correct = swZohOneSided(f, 4e9, 4096, 10, lp.p, lp.sigmaEta2)
    const wrong = (2 / 4e9) * swDtft((2 * Math.PI * f) / 4e9, 10, lp.p, lp.sigmaEta2) // 頻率軸、位準都錯
    expect(correct / wrong).toBeGreaterThan(1000)
  })

  it('E28：DTFT 形式與單邊 per-Hz 形式差 f_s/2（10log10(f_s/2) = 93.01 dB）', () => {
    const S = swDtft(0.01, 10, lp.p, lp.sigmaEta2)
    const S1 = (2 / 4e9) * S
    expect(10 * Math.log10(S / S1)).toBeCloseTo(93.01, 2)
  })

  it('三種 code（常數 / 單頻 / ±1 隨機）在 0…1 MHz 的 δt RMS：0.3976 / 0.2811 / 0.00893 fs（解析，multirate 修正）', () => {
    const cs = codeSpectraAnalytic({ ...T13_BASE, fx: 1e5, toneA: 1, fBw: 1e6, pll: { f3dbT: 1e6, zeta: 0.707 }, fL: 1e3, fH: 1e8 })
    const [c, t, w] = cs.rows
    expect(c.totalRms).toBeCloseTo(0.39919, 5)
    expect(c.inbandRms).toBeCloseTo(0.39759, 4)
    expect(t.totalRms).toBeCloseTo(0.39919 / Math.SQRT2, 5)
    expect(t.inbandRms).toBeCloseTo(0.28115, 4)
    expect(w.inbandRms).toBeCloseTo(lp.sigmaW * Math.sqrt((2 * 1e6) / 4e9), 8)
    expect(w.inbandRms).toBeCloseTo(0.008926, 5)
    // PD 看到的 vs output 看到的：常數 code 在 PD 很小、在 output 很大；白色 code 相反
    expect(c.outRms).toBeGreaterThan(5 * c.pdRms)
    expect(w.pdRms).toBeGreaterThan(5 * w.outRms)
  })

  it('三種 code：sample-level 模擬（ZOH + 整段 FFT）的 in-band 比例 CI 涵蓋解析值', () => {
    const an = codeSpectraAnalytic({ ...T13_BASE, fx: 1e5, toneA: 1, fBw: 1e6, pll: { f3dbT: 1e6, zeta: 0.707 }, fL: 1e3, fH: 1e8 })
    const sim = simulateCodeSpectra({ ...T13_BASE, fx: 1e5, toneA: 1, fBw: 1e6, blocks: 128, chains: 6, seed: 5, engine: 'linear' })
    for (let i = 0; i < 3; i++) {
      const a = an.rows[i]
      const s = sim.rows[i]
      expect(s.kind).toBe(a.kind)
      expect(s.fractionLo).toBeLessThan(a.inbandFraction)
      expect(s.fractionHi).toBeGreaterThan(a.inbandFraction)
      expect(s.inbandLo).toBeLessThan(a.inbandRms)
      expect(s.inbandHi).toBeGreaterThan(a.inbandRms)
    }
  }, 30000)

  it('三種 code：f_BW = f_s/2 時模擬的 in-band 功率恰等於時域總功率（Parseval；Nyquist bin 不重複計數）', () => {
    const sim = simulateCodeSpectra({ ...T13_BASE, N: 64, fx: 3e6, toneA: 1, fBw: 2e9, blocks: 64, chains: 2, seed: 3, engine: 'linear' })
    for (const r of sim.rows) {
      expect(r.fractionMean).toBeCloseTo(1, 10)
      expect(r.inbandRms / r.totalRms).toBeCloseTo(1, 10)
    }
  })

  it('δt 的總功率 = (m² + A²/2 + σ_x²)·σ_w²（Parseval），與 PSD 積分一致', () => {
    const s = { fs: 64e6, N: 16, mu: 10, p: 0.8, sEta: 1 / 16 }
    const code = { m: 0.5, A: 1, fx: 3e6, whiteVar: 0.25 }
    const tot = dtTotalPower(code, s)
    const integ = integrateWithBreaks((f) => dtPsdOneSided(f, code, s), 0, s.fs / 2, mixBreakpoints(s.fs / s.N, code.fx, s.fs / 2), 1e-10 * tot)
    expect(integ.value / tot).toBeCloseTo(1, 6)
  })
})

describe('§12.4 Spur：T15', () => {
  const base = MIX_BASE

  it('T15: β = 2π·13 GHz·0.5 fs、20log10(β/2)、Bessel 精確值與 golden 向量一致', () => {
    const v = loadVector('T15')
    const beta = spurBeta(v.inputs.f_out_hz, v.inputs.At_peak_s * 1e15)
    expectGolden(v, 'beta_rad', beta)
    expectGolden(v, 'spur_dbc', spurDbcSmallAngle(beta))
    expectGolden(v, 'spur_dbc_bessel', spurDbcBessel(beta))
  })

  it('T15: 時域乘積 δt = x·δw 在 90 / 110 kHz 各 0.5 fs peak；e^{jφ} 的 FFT 直接量測 −93.80 dBc', () => {
    const v = loadVector('T15')
    const r = simulateMixing(base)
    expect(r.tones.map((t) => t.f)).toEqual(v.expected.mixing_tone_freqs_hz)
    for (const t of r.tones) {
      expect(t.coherent).toBe(true)
      expect(Math.abs(t.measFs * 1e-15 - 5e-16)).toBeLessThan(1e-27 + 1e-12 * 5e-16)
      expect(t.dbcSmall).toBeCloseTo(-93.7987, 3)
    }
    expect(r.pmFftDbc).toBeCloseTo(v.expected.spur_dbc_bessel as number, 6)
    expect(r.warnings).toEqual([])
    // spectrum scaling：tone bin 讀數 10log10(P_φ/2) 就是 spur dBc（E28 一致性）
    const k = Math.round((1.1e5 * base.L) / base.fsim)
    expect(r.phaseDbc[k]).toBeCloseTo(-93.7987, 3)
  })

  it('T15: |T| = 0.1 ⇒ spur 低 20 dB；A_t 加倍 ⇒ +6.02 dB', () => {
    const b1 = spurBeta(13e9, 0.5, 1)
    expect(spurDbcSmallAngle(spurBeta(13e9, 0.5, 0.1)) - spurDbcSmallAngle(b1)).toBeCloseTo(-20, 10)
    expect(spurDbcSmallAngle(spurBeta(13e9, 1)) - spurDbcSmallAngle(b1)).toBeCloseTo(6.0206, 4)
    const r = simulateMixing({ ...base, Tmag: 0.1 })
    expect(r.tones[0].dbcSmall).toBeCloseTo(-113.7987, 3)
  })

  it('T15: code 有 DC（x = m + A cos）⇒ f_w 處出現 m·B 的低頻 tone（會通過 PLL 的 low-pass T）', () => {
    const r = simulateMixing({ ...base, m: 0.5 })
    const dc = r.tones.find((t) => t.f === 1e4)
    expect(dc).toBeDefined()
    expect(dc!.measFs).toBeCloseTo(0.5, 10)
    expect(dc!.predFs).toBeCloseTo(0.5, 12)
  })

  it('T15: 差頻在 f_x < f_w 時落在 f_w − f_x（不可漏掉）；f_x = 0 時三個產物都在 f_w，振幅為 |A + m|·B', () => {
    const lo = simulateMixing({ ...base, fx: 5e3, fw: 1e4 })
    expect(lo.tones.map((t) => t.f).sort((a, b) => a - b)).toEqual([5e3, 1.5e4])
    for (const t of lo.tones) {
      expect(t.predFs).toBeCloseTo(0.5, 12)
      expect(t.measFs).toBeCloseTo(0.5, 10)
    }
    expect(mixingCrossCheck(base, lo).analytic.status).toBe('ok')
    const dc = simulateMixing({ ...base, fx: 0, m: 0.3 })
    expect(dc.tones.length).toBe(1)
    expect(dc.tones[0].f).toBe(1e4)
    expect(dc.tones[0].predFs).toBeCloseTo(1.3, 12) // AB/2 + AB/2 + mB
    expect(dc.tones[0].measFs).toBeCloseTo(1.3, 10)
    expect(dc.warnings.join('')).toMatch(/相量和/)
    expect(mixingCrossCheck(base, dc).analytic.status).toBe('ok')
  })

  it('T15: f_x = 2f_w 且 code 有 DC：f_x − f_w 與直通項 m·δw 同頻，預測為相量和（含 ZOH 的相位），可相加也可抵消', () => {
    // 無 ZOH：同相 ⇒ AB/2 + mB
    const add = simulateMixing({ ...base, fx: 2e4, fw: 1e4, m: 0.5 })
    const t10 = add.tones.find((t) => t.f === 1e4)!
    expect(t10.predFs).toBeCloseTo(1.0, 12)
    expect(t10.measFs).toBeCloseTo(1.0, 10)
    expect(add.tones.find((t) => t.f === 3e4)!.measFs).toBeCloseTo(0.5, 10)
    // m = −A/2 ⇒ 完全抵消
    const cancel = simulateMixing({ ...base, fx: 2e4, fw: 1e4, m: -0.5 })
    const c10 = cancel.tones.find((t) => t.f === 1e4)!
    expect(c10.predFs).toBeCloseTo(0, 12)
    expect(c10.measFs).toBeLessThan(1e-10)
    expect(mixingCrossCheck(base, cancel).analytic.status).toBe('ok')
    // ZOH（hold 16）：δw 基頻多了相位延遲 φ_z，兩個產物的相位為 −φ_z 與 +φ_z ⇒ 不再同相
    const z = simulateMixing({ ...base, fx: 2e4, fw: 1e4, m: 0.5, holdN: 16 })
    const z10 = z.tones.find((t) => t.f === 1e4)!
    const g = zohGain(1e4, base.fsim, 16)
    const phi = (-Math.PI * 1e4 * 15) / base.fsim
    const expected = g * Math.hypot(0.5 * Math.cos(-phi) + 0.5 * Math.cos(phi), 0.5 * Math.sin(-phi) + 0.5 * Math.sin(phi))
    expect(z10.predFs).toBeCloseTo(expected, 12)
    expect(expected).toBeLessThan(g * 1.0) // 比同相相加小
    expect(z10.measFs / z10.predFs).toBeCloseTo(1, 9)
    expect(mixingCrossCheck(base, z).analytic.status).toBe('ok')
  })

  it('T15: δw 以 ZOH 保持時 tone 乘上 sinc 權重（E09）', () => {
    const r = simulateMixing({ ...base, holdN: 16 })
    const g = zohGain(1e4, base.fsim, 16)
    expect(g).toBeLessThan(1)
    for (const t of r.tones) {
      expect(t.predFs).toBeCloseTo(0.5 * g, 12)
      expect(t.measFs / t.predFs).toBeCloseTo(1, 9) // Dirichlet 權重是精確的（coherent sampling）
    }
    expect(mixingCrossCheck(base, r).analytic.status).toBe('ok')
    expect(r.warnings.join('')).toMatch(/ZOH/)
  })

  it('T15: 反面測試：f_x + f_w ≥ f_sim/2 ⇒ aliasing 警告；非整數 bin ⇒ leakage 警告', () => {
    const aliasPrm: MixingSimParams = { ...base, fsim: 2e5, L: 4000 }
    const a = simulateMixing(aliasPrm)
    expect(a.warnings.join('')).toMatch(/alias/)
    // 110 kHz 折回 90 kHz（200 − 110），與 90 kHz 產物同相疊加 ⇒ 量到 1.0 fs ≠ 預測 0.5 fs ⇒ analytic mismatch
    expect(a.tones.map((t) => t.f)).toEqual([9e4])
    expect(a.tones[0].measFs).toBeCloseTo(1, 9)
    expect(mixingCrossCheck(aliasPrm, a).analytic.status).toBe('mismatch')
    const b = simulateMixing({ ...base, fx: 100_300.7 })
    expect(b.warnings.join('')).toMatch(/coherent/)
    // toneFit 仍正確量到 peak
    expect(b.tones[0].measFs).toBeCloseTo(0.5, 3)
  })

  it('T15: 隨機係數雜訊只抬高 noise floor（skirt），不產生固定頻率的 tone', () => {
    const r = simulateMixing({ ...base, B: 0, dwNoiseSigma: 0.4, dwNoiseP: 0.92, L: 16384 })
    expect(r.tones).toEqual([])
    expect(r.dtRms).toBeGreaterThan(0.2)
    // B = 0 且 ZOH 時，警告不得宣稱「tone 乘上 sinc 權重」（沒有 tone），而是說明隨機雜訊的 Dirichlet 權重
    const z = simulateMixing({ ...base, B: 0, dwNoiseSigma: 0.4, dwNoiseP: 0.92, holdN: 4, L: 16384 })
    const msg = z.warnings.join('')
    expect(msg).toMatch(/沒有週期性 tone（\$B=0\$）/)
    expect(msg).not.toMatch(/tone 乘上 sinc 權重/)
  })

  it('T15: 同一條隨機 δw（同 seed）乘上 tone code ⇒ 功率集中在 f_x 附近的裙擺；乘上 ±1 白色 code ⇒ 攤平到整個頻帶', () => {
    const common = { ...base, B: 0, dwNoiseSigma: 0.399, dwNoiseP: 0.92, holdN: 4, L: 16384, seed: 20261010 }
    const tone = simulateMixing(common) // preset mixing-random-skirt
    const white = simulateMixing({ ...common, A: 0, codeWhite: 1 }) // preset mixing-white-code
    expect(tone.tones).toEqual([])
    expect(white.tones).toEqual([])
    expect(white.pmFftLabel).toBeNull()
    const bandFrac = (r: typeof tone, lo: number, hi: number) => {
      let inb = 0
      let tot = 0
      for (let i = 0; i < r.spec.f.length; i++) {
        tot += r.spec.p[i]
        if (r.spec.f[i] >= lo && r.spec.f[i] <= hi) inb += r.spec.p[i]
      }
      return inb / tot
    }
    // tone code：f_x ± 100 kHz（全頻帶的不到 10%）內含 > 85% 的功率
    expect(bandFrac(tone, 0, 2e5)).toBeGreaterThan(0.85)
    // 白色 code：同一個頻帶只有約 2e5/2.048e6 ≈ 9.8% 的功率（平的）
    const wf = bandFrac(white, 0, 2e5)
    expect(wf).toBeGreaterThan(0.07)
    expect(wf).toBeLessThan(0.13)
    // 總功率：E[x²]σ²——tone code σ²/2、白色 code σ²（均方值檢定皆通過）
    expect(tone.msCheck!.pred / white.msCheck!.pred).toBeCloseTo(0.5, 10)
    expect(mixingCrossCheck(common, tone).monteCarlo.status).toBe('ok')
    expect(mixingCrossCheck({ ...common, codeWhite: 1 }, white).monteCarlo.status).toBe('ok')
  })

  it('T15: β 的定義：A_t 是 DTC 端 δt tone 的 peak，output timing tone = |T|·A_t ⇒ spurBeta(f, A, |T|) = spurBeta(f, |T|·A, 1)', () => {
    expect(spurBeta(13e9, 0.5, 0.37)).toBeCloseTo(spurBeta(13e9, 0.5 * 0.37, 1), 18)
    expect(spurBeta(13e9, 0.5, 1)).toBeCloseTo(2 * Math.PI * 13e9 * 0.5e-15, 18)
  })

  it('T15: 交叉比對是誠實的：確定性 ⇒ analytic ok、Monte Carlo n/a；隨機 ⇒ δt 均方值的 batch-means z 檢定', () => {
    const det = mixingCrossCheck(base, simulateMixing(base))
    expect(det.analytic.status).toBe('ok')
    expect(det.monteCarlo.status).toBe('n/a')
    // preset mixing-random-skirt：σ = 0.399 fs、p = 0.92、hold 4、L = 16384
    const prm = { ...base, B: 0, dwNoiseSigma: 0.399, dwNoiseP: 0.92, holdN: 4, L: 16384 }
    const r = simulateMixing(prm)
    expect(r.msCheck).not.toBeNull()
    const c = r.msCheck!
    expect(c.pred).toBeCloseTo((0.399 ** 2) / 2, 12) // E[x²]·σ² = (A²/2)σ²
    expect(c.batches).toBeGreaterThanOrEqual(8)
    expect(Math.abs(c.z)).toBeLessThanOrEqual(c.zCrit)
    const cc = mixingCrossCheck(prm, r)
    expect(cc.monteCarlo.status).toBe('ok')
    expect(cc.analytic.status).toBe('n/a') // 沒有可預測的 tone
    // 白色 code 成分（iid ±1）＋確定性 δw tone：均方值檢定也要通過
    const w = { ...base, codeWhite: 0.5, L: 16384 }
    const rw = simulateMixing(w)
    expect(mixingCrossCheck(w, rw).monteCarlo.status).toBe('ok')
    expect(rw.msCheck!.pred).toBeCloseTo((0.5 + 0.25) * 0.5, 3) // (A²/2 + c_w²)·B²/2（時間平均）
  })

  it('T15: 反面測試：預測錯誤時交叉比對必須顯示 mismatch（不是永遠 ok）', () => {
    const r = simulateMixing(base)
    const tampered = { ...r, tones: r.tones.map((t) => ({ ...t, predFs: t.predFs * 1.01 })) }
    expect(mixingCrossCheck(base, tampered).analytic.status).toBe('mismatch')
    const prm = { ...base, B: 0, dwNoiseSigma: 0.399, dwNoiseP: 0.92, holdN: 4, L: 16384 }
    const rr = simulateMixing(prm)
    const wrong = { ...rr, msCheck: { ...rr.msCheck!, z: (rr.msCheck!.meas - 2 * rr.msCheck!.pred) / rr.msCheck!.se } }
    expect(mixingCrossCheck(prm, wrong).monteCarlo.status).toBe('mismatch')
    // 紀錄太短（相對 AR(1) 相關時間）⇒ n/a，而不是假裝通過
    const short = { ...prm, L: 512, dwNoiseP: 0.999 }
    expect(mixingCrossCheck(short, simulateMixing(short)).monteCarlo.status).toBe('n/a')
  })
})

describe('字串屬性內的 $...$ 行內公式（docs/teaching-style.md §3）', () => {
  /** 取出字串中所有 $...$ 片段（與 @/components 的 mathText 相同的配對規則） */
  const mathSegments = (t: string) => Array.from(t.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)).map((m) => m[1])

  it('所有警告 / 錯誤 / 交叉比對說明：$ 成對、每段都能被 KaTeX 解析，且 $ 之外不再用 Unicode 拼公式', () => {
    const msgs: string[] = []
    const loops = [
      { ...T13_BASE, sigmaV: 0 },
      { ...T13_BASE, C: -0.5 },
      { ...T13_BASE, gmMode: 'sum' as const },
      { ...T13_BASE, mu: 260 },
      { ...T13_BASE, mu: 0 },
      { ...T13_BASE, mu: 160 },
      { ...T13_BASE, mu: 1 / (Math.sqrt(2 / Math.PI) / 100) },
      { ...T13_BASE, mu: 110 },
      { ...T13_BASE, etaR: 1 },
      { ...T13_BASE, mu: 1e-9 }, // p 非常接近 1：數字以指數記法出現
    ]
    for (const l of loops) msgs.push(...calLoop(l).warnings)
    for (const k of ['lowpass', 'no3db', 'flat', 'highpass', 'unstable', 'polarity', 'undefined'] as const) msgs.push(REGIME_LABEL_TEX[k])
    for (const k of ['const', 'tone', 'white'] as const) msgs.push(CODE_LABEL_TEX[k])
    msgs.push(...runNoiseLab({ ...T13_BASE, C: -0.5, engine: 'binomial', blocks: 300, chains: 1, seed: 2, burnIn: 0, dw0: 1 }).warnings)
    msgs.push(...runNoiseLab({ ...T13_BASE, mu: 260, engine: 'binomial', blocks: 300, chains: 2, seed: 9 }).warnings)
    msgs.push(...runNoiseLab({ ...T13_BASE, mu: 60, sigmaV: 10, engine: 'binomial', blocks: 300, chains: 2, seed: 9 }).warnings) // K_q 線性化警告
    msgs.push(...runNoiseLab({ ...T13_BASE, sigmaV: 0, engine: 'binomial', blocks: 100, chains: 1, seed: 3 }).warnings)
    msgs.push(...runNoiseLab({ ...T13_BASE, etaR: 0.5, engine: 'binomial', blocks: 100, chains: 1, seed: 3 }).warnings)
    msgs.push(...runNoiseLab({ ...T13_BASE, gmMode: 'sum', engine: 'linear', blocks: 100, chains: 1, seed: 1, burnIn: 0 }).warnings)
    const errOf = (fn: () => unknown) => {
      try {
        fn()
      } catch (e) {
        return (e as Error).message
      }
      throw new Error('應該丟出錯誤')
    }
    msgs.push(errOf(() => runNoiseLab({ ...T13_BASE, sigmaV: 0, engine: 'linear', blocks: 100, chains: 1, seed: 1 })))
    msgs.push(errOf(() => runNoiseLab({ ...T13_BASE, etaR: 1, engine: 'linear', blocks: 100, chains: 1, seed: 1 })))
    msgs.push(errOf(() => runNoiseLab({ ...T13_BASE, N: 65536, engine: 'sample', blocks: 100000, chains: 64, seed: 1 })))
    msgs.push(errOf(() => simulateCodeSpectra({ ...T13_BASE, C: -1, fx: 1e5, toneA: 1, fBw: 1e6, blocks: 16, chains: 2, seed: 1, engine: 'linear' })))
    msgs.push(errOf(() => simulateCodeSpectra({ ...T13_BASE, N: 65536, fx: 1e5, toneA: 1, fBw: 1e6, blocks: 2048, chains: 2, seed: 1, engine: 'linear' })))
    msgs.push(errOf(() => simulateMixing({ ...MIX_BASE, L: 8 })))
    msgs.push(errOf(() => simulateMixing({ ...MIX_BASE, fsim: 0 })))
    msgs.push(...codeSpectraAnalytic({ ...T13_BASE, fx: 9.9e5, toneA: 1, fBw: 1e6, pll: { f3dbT: 1e6, zeta: 0.707 }, fL: 1e3, fH: 1e10 }).warnings)
    msgs.push(...codeSpectraAnalytic({ ...T13_BASE, C: -1, fx: 1e5, toneA: 1, fBw: 1e6, pll: { f3dbT: 1e6, zeta: 0.707 }, fL: 1e3, fH: 1e8 }).warnings)
    msgs.push(...simulateCodeSpectra({ ...T13_BASE, fx: 1e5, toneA: 1, fBw: 1e6, blocks: 16, chains: 2, seed: 1, engine: 'linear' }).warnings) // FFT bin 太粗
    const mixCases: MixingSimParams[] = [
      { ...MIX_BASE, fsim: 2e5, L: 4000 }, // aliasing + mismatch
      { ...MIX_BASE, fx: 100_300.7 }, // 非 coherent
      { ...MIX_BASE, holdN: 16 },
      { ...MIX_BASE, B: 0, dwNoiseSigma: 0.4, holdN: 4, L: 16384 },
      { ...MIX_BASE, fx: 0, m: 0.3 }, // 相量和
      { ...MIX_BASE, B: 0, dwNoiseSigma: 0.399, dwNoiseP: 0.999, L: 512 }, // 紀錄太短
    ]
    for (const m of mixCases) {
      const r = simulateMixing(m)
      const cc = mixingCrossCheck(m, r)
      msgs.push(...r.warnings, cc.analytic.note, cc.monteCarlo.note)
    }
    expect(msgs.length).toBeGreaterThan(35)
    for (const m of msgs) {
      // $ 必須成對
      expect((m.match(/(?<!\\)\$/g) ?? []).length % 2, m).toBe(0)
      for (const seg of mathSegments(m)) expect(() => katex.renderToString(seg, { throwOnError: true, strict: false }), `${seg} ← ${m}`).not.toThrow()
      // $ 之外：不得有希臘字母、下標、上標拼成的公式
      const outside = m.replace(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g, '').replace(/gm_mode=sum/g, '') // gm_mode 是設定鍵名，不是公式
      expect(outside, m).not.toMatch(/[σμηδτβθΩφΦ√²³∞]|[A-Za-z]_[A-Za-z0-9{]|\^/)
    }
  })

  it('texNum：一般數字原樣、指數記法改寫成 m×10^{e}、非有限值有對應符號', () => {
    expect(texNum(0.920212, 6)).toBe('0.920212')
    expect(texNum(-325.81351610485365)).toBe('-325.814')
    expect(texNum(1, 4)).toBe('1')
    expect(texNum(110000)).toBe('110000')
    expect(texNum(1e-9, 3)).toBe(String.raw`1\times10^{-9}`)
    expect(texNum(4.096e6)).toBe(String.raw`4.096\times10^{6}`)
    expect(texNum(-2e9, 4)).toBe(String.raw`-2\times10^{9}`)
    expect(texNum(Infinity)).toBe(String.raw`\infty`)
    expect(texNum(NaN)).toBe(String.raw`\mathrm{NaN}`)
  })
})

describe('數值輔助', () => {
  it('Bessel J0(1)、J1(1)、J1(β)/J0(β) ≈ β/2（小 β）', () => {
    expect(besselJ(0, 1)).toBeCloseTo(0.7651976865579666, 14)
    expect(besselJ(1, 1)).toBeCloseTo(0.44005058574493355, 14)
    expect(besselJ(1, 1e-4) / besselJ(0, 1e-4)).toBeCloseTo(5e-5, 12)
  })

  it('精確 Binomial 抽樣：平均、變異數與 pmf 一致（含 p 接近 0 / 1 的邊界）', () => {
    const rng = createRng(123)
    for (const [n, p] of [
      [4096, 0.5039894],
      [50, 0.03],
      [1000, 0.999],
    ] as const) {
      const M = 20000
      let s = 0
      let s2 = 0
      const counts = new Map<number, number>()
      for (let i = 0; i < M; i++) {
        const k = binomialFromUniform(n, p, rng.uniform())
        expect(k).toBeGreaterThanOrEqual(0)
        expect(k).toBeLessThanOrEqual(n)
        s += k
        s2 += k * k
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const m = s / M
      const v = s2 / M - m * m
      const se = Math.sqrt((n * p * (1 - p)) / M)
      expect(Math.abs(m - n * p)).toBeLessThan(5 * se)
      expect(v / (n * p * (1 - p))).toBeCloseTo(1, 1)
      const mode = Math.floor((n + 1) * p)
      const freq = (counts.get(mode) ?? 0) / M
      const pm = binomPmf(mode, n, p)
      expect(Math.abs(freq - pm)).toBeLessThan(5 * Math.sqrt((pm * (1 - pm)) / M))
    }
    expect(binomialFromUniform(10, 0, 0.5)).toBe(0)
    expect(binomialFromUniform(10, 1, 0.5)).toBe(10)
  })
})
