import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBlockLmsConfig, runBlockLmsMonteCarlo } from '@/simulation/models/blockLms'
import { DEFAULT_PARAMS, evaluateThesis, type ThesisParams } from './thesisModel'
import {
  MC_GAIN_TRUE_FS,
  MC_PARAM_MAP,
  MC_RUNS,
  compareMonteCarlo,
  countTex,
  lateWindow,
  perRunMse,
  planMonteCarlo,
  productTex,
  toBlockLmsConfig,
  type McPlanOk,
} from './mcBridge'
import { mathTextProblems } from './mathTextTestUtils'

const SEED = 20261010
const t13: ThesisParams = { ...DEFAULT_PARAMS, B: 0 }

function golden(name: string): { expected: Record<string, number> } {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as { expected: Record<string, number> }
}

function okPlan(p: ThesisParams, seed = SEED): { r: ReturnType<typeof evaluateThesis>; plan: McPlanOk } {
  const r = evaluateThesis(p)
  const plan = planMonteCarlo(r, seed)
  if (!plan.ok) throw new Error(`plan 不應失敗：${plan.reason}`)
  return { r, plan }
}

function runCase(p: ThesisParams, seed = SEED) {
  const { r, plan } = okPlan(p, seed)
  const mc = runBlockLmsMonteCarlo({ config: plan.config, runs: plan.runs })
  return { r, plan, mc, cmp: compareMonteCarlo(r, plan, mc) }
}

describe('mcBridge：體檢參數 → 共用 block Sign-LMS 設定', () => {
  it('toBlockLmsConfig 是合法的 §15.3 設定（zod 驗證通過），欄位一一對應', () => {
    const p: ThesisParams = { ...t13, N: 512, mu: 7, sigmaV: 80, Px: 0.5, Hmag: 0.8, phiDeg: -120, omega: Math.PI / 6, D: 4, d: 2, gmacMode: 'sum', w0MinusA: -4, fsGHz: 2, foutGHz: 10 }
    const parsed = parseBlockLmsConfig(toBlockLmsConfig(p, 300, 42))
    expect(parsed.errors).toEqual([])
    const c = parsed.config!
    expect(c.seed).toBe(42)
    expect(c.sample_rate_hz).toBe(2e9)
    expect(c.output_frequency_hz).toBe(10e9)
    expect(c.gm_accum_samples).toBe(512)
    expect(c.gm_mode).toBe('sum')
    expect(c.gain_true).toBe(MC_GAIN_TRUE_FS)
    expect(c.gain_initial).toBe(MC_GAIN_TRUE_FS - 4)
    expect(c.gain_step).toBe(7)
    expect(c.pd_noise_rms_fs).toBe(80)
    expect(c.code_normalization).toBe('none')
    expect(c.seeded_pattern).toEqual({ kind: 'sinusoid', parameters: { amplitude: 1, omega: Math.PI / 6, phase_deg: 0, random_phase: false } })
    expect(c.pll_error_path).toEqual({ kind: 'single_tone', parameters: { magnitude: 0.8, phase_deg: -120, omega: Math.PI / 6 } })
    expect(c.regressor_mode).toBe('delayed')
    expect(c.gm_code_delay_samples).toBe(4)
    expect(c.cal_update_delay_blocks).toBe(2)
    expect(c.num_blocks).toBe(300)
    expect(c.record.sample_trace_blocks).toBe(0)
    // 沒有打開任何定點 / 非線性選項（這個比對只涵蓋條件 2–4）
    expect(c.gain_register.quantize_physical).toBe(false)
    expect(c.dtc_nonlinearity).toEqual({ offset_fs: 0, c2: 0, c3: 0 })
    expect(c.comparator_offset_fs).toBe(0)
  })

  it('對照表列出的 JSON 欄位都真的出現在設定中', () => {
    const cfg = toBlockLmsConfig(t13, 100, 1) as Record<string, unknown>
    for (const m of MC_PARAM_MAP) {
      const key = m.json.split(/[\s（=]/)[0]
      if (key === 'gain_initial') continue // 'gain_initial − gain_true'
      expect(Object.keys(cfg), m.json).toContain(key)
    }
  })

  it('planMonteCarlo：收斂時取 40τ（後半段 20τ 做統計），樣本數在預算內；key 隨參數與 seed 改變', () => {
    const { r, plan } = okPlan(t13)
    const tau = -1 / Math.log(r.maxRadius)
    expect(plan.expectStable).toBe(true)
    expect(plan.tauBlocks).toBeCloseTo(tau, 12)
    expect(plan.numBlocks).toBe(Math.ceil(40 * tau) + 1)
    expect(plan.runs).toBe(MC_RUNS)
    expect(plan.lateBlocks).toBe(lateWindow(plan.numBlocks).count)
    expect(plan.lateBlocks / tau).toBeGreaterThan(19)
    expect(plan.totalSamples).toBe(plan.runs * plan.numBlocks * t13.N)
    expect(plan.totalSamples).toBeLessThanOrEqual(5e7)
    expect(plan.notes).toEqual([])
    expect(planMonteCarlo(r, SEED + 1)).toHaveProperty('ok', true)
    expect((planMonteCarlo(r, SEED + 1) as McPlanOk).key).not.toBe(plan.key)
    expect(okPlan({ ...t13, mu: 11 }).plan.key).not.toBe(plan.key)
    // B、預算、spur 上限不進入模擬設定：改它們不會讓 Monte Carlo 結果失效
    expect(okPlan({ ...t13, B: 0.3, jitterBudget: 2, spurLimit: -60, Tmag: 0.5 }).plan.key).toBe(plan.key)
    const bNote = okPlan({ ...t13, B: 0.3 }).plan.notes.join('')
    expect(bNote).toContain('Monte Carlo 以 $B=0$ 模擬')
    expect(mathTextProblems(bNote)).toEqual([])
  })

  it('樣本數的 TeX：小於 10⁶ 寫出整數並用等號；四捨五入過的用 ≈（不把近似寫成相等）', () => {
    expect(countTex(494592)).toEqual({ tex: '494592', exact: true })
    expect(countTex(5e7)).toEqual({ tex: '5\\times10^{7}', exact: true })
    expect(countTex(1e7)).toEqual({ tex: '10^{7}', exact: true })
    expect(countTex(32243712)).toEqual({ tex: '3.22\\times10^{7}', exact: false })
    expect(productTex([8, 483, 128])).toBe('$8\\times483\\times128=494592$')
    expect(8 * 483 * 128).toBe(494592)
    expect(productTex([8, 984, 4096])).toBe('$8\\times984\\times4096\\approx3.22\\times10^{7}$')
    expect(8 * 984 * 4096).toBe(32243712)
    expect(productTex([4, 250, 10000])).toBe('$4\\times250\\times10000=10^{7}$')
  })

  it('後半段統計窗與 blockLms 的 metrics 定義相同（block ⌈(K+1)/2⌉…K）', () => {
    expect(lateWindow(600)).toEqual({ start: 301, count: 300 })
    expect(lateWindow(483)).toEqual({ start: 242, count: 242 })
    expect(lateWindow(1)).toEqual({ start: 1, count: 1 })
  })

  it('反面：無法模擬時說明原因（兩參數、P_x = 0、Ω = 0 或 π、時間常數太長）', () => {
    const reason = (p: ThesisParams) => {
      const plan = planMonteCarlo(evaluateThesis(p), SEED)
      expect(plan.ok).toBe(false)
      return plan.ok ? '' : plan.reason
    }
    expect(reason({ ...t13, twoParam: true, rho: 0.5 })).toMatch(/只有一個校正係數/)
    expect(reason({ ...t13, Px: 0 }).startsWith('$P_x=0$：')).toBe(true)
    expect(reason({ ...t13, omega: 0 }).startsWith(String.raw`$\Omega=0$ 或 $\pi$：`)).toBe(true)
    expect(reason({ ...t13, omega: Math.PI })).toMatch(/E46/)
    // μ = 0.2 fs：τ = −1/ln(1 − g) ≈ 626 blocks ⇒ 至少 12τ + 1 = 7516 個 block × 4096 × 4 seeds ≈ 1.23e8 > 5e7
    const slow = evaluateThesis({ ...t13, mu: 0.2 })
    const tau = -1 / Math.log(slow.maxRadius)
    expect(Number(tau.toPrecision(3))).toBe(626)
    const need = Math.ceil(12 * tau) + 1
    expect(reason({ ...t13, mu: 0.2 })).toContain(String.raw`時間常數 $\tau=626$ 個 block 太長`)
    expect(reason({ ...t13, mu: 0.2 })).toContain(productTex([need, 4096, 4]))
    expect(reason({ ...t13, mu: 0.2 })).toContain(String.raw`預算 $5\times10^{7}$`)
    expect(need * 4096 * 4).toBeGreaterThan(5e7)
    expect(reason({ ...t13, N: 1_048_576 })).toMatch(/超過瀏覽器內 Monte Carlo 的預算/)
    // 說明文字照 LaTeX 規範
    for (const p of [{ ...t13, twoParam: true, rho: 0.5 }, { ...t13, Px: 0 }, { ...t13, omega: 0 }, { ...t13, mu: 0.2 }, { ...t13, N: 1_048_576 }])
      expect(mathTextProblems(reason(p)), reason(p)).toEqual([])
  })

  it('時間常數偏長時 seeds 由 8 減為 4（寧可少 seed，也不把暫態當穩態），並在 notes 說明', () => {
    const { plan } = okPlan({ ...t13, phiDeg: 85 })
    expect(plan.runs).toBe(4)
    expect(plan.numBlocks).toBeGreaterThanOrEqual(Math.ceil(12 * plan.tauBlocks))
    expect(plan.totalSamples).toBeLessThanOrEqual(5e7)
    expect(plan.notes.join('')).toMatch(/seeds 由 8 減為 4/)
    for (const n of plan.notes) expect(mathTextProblems(n), n).toEqual([])
    // 初始誤差太大、樣本預算不足時的提醒也一樣
    const big = okPlan({ ...t13, w0MinusA: -60, mu: 1, N: 8192 }).plan
    expect(big.notes.length).toBeGreaterThanOrEqual(2)
    for (const n of big.notes) expect(mathTextProblems(n), n).toEqual([])
  })

  it('不收斂的情況固定跑 400 blocks，並標記 expectStable = false', () => {
    const { plan } = okPlan({ ...t13, phiDeg: 120 })
    expect(plan.expectStable).toBe(false)
    expect(plan.numBlocks).toBe(400)
    expect(Number.isNaN(plan.tauBlocks)).toBe(true)
  })
})

describe('mcBridge：解析模型 vs sample-level Monte Carlo（固定 seed + 99% CI）', () => {
  it('T13: σ_v = 100 fs、N = 4096、μ = 10 fs——解析 σ_w = 0.3992 fs 落在 Monte Carlo 的信賴區間內，固定點與暫態一致', () => {
    const { r, cmp, plan } = runCase(t13)
    expect(Math.abs(r.sigmaW - golden('T13').expected.sigma_w_fs)).toBeLessThan(1e-6)
    expect(cmp.kind).toBe('converged')
    expect(cmp.status).toBe('ok')
    expect(cmp.rows.map((x) => x.id)).toEqual(['sigma', 'mean', 'transient'])
    const s = cmp.rows[0]
    expect(s.analytic).toBe(r.sigmaW)
    expect(s.lo).toBeLessThan(r.sigmaW)
    expect(s.hi).toBeGreaterThan(r.sigmaW)
    expect(Math.abs(s.mc - r.sigmaW) / r.sigmaW).toBeLessThan(0.15) // 8 seeds × 20τ 的統計精度
    // 摘要裡的數字就是表格第一列的數字（4 位有效數字），解析值是 0.3992 fs
    const f4 = (x: number) => Number(x.toPrecision(4)).toString()
    expect(cmp.note).toBe(
      String.raw`8 seeds：$\sigma_w=${f4(s.mc)}\,\mathrm{fs}$（99% CI $[${f4(s.lo)},\,${f4(s.hi)}]$）vs 解析 $0.3992\,\mathrm{fs}$；固定點與暫態一致`,
    )
    // 表格的名稱、判定規則與摘要都照 LaTeX 規範
    for (const t of [cmp.note, ...cmp.rows.flatMap((x) => [x.name, x.criterion])]) expect(mathTextProblems(t), t).toEqual([])
    expect(cmp.divergedRuns).toBe(0)
    expect(plan.totalSamples).toBeGreaterThan(1e7)
  }, 60_000)

  it('T07: φ = −120°、Ω = π/6、D = 4——code delay 把極性修回來，Monte Carlo 收斂且 pole、σ_w 與解析一致', () => {
    const { r, cmp } = runCase({ ...t13, N: 512, Px: 0.5, phiDeg: -120, omega: Math.PI / 6, D: 4 })
    expect(r.polarity.C).toBeCloseTo(golden('T07').expected.C_D, 12)
    expect(cmp.status).toBe('ok')
    expect(cmp.rows.every((x) => x.pass)).toBe(true)
    // 暫態列：一個時間常數後誤差約為初值的 1/e
    const tr = cmp.rows.find((x) => x.id === 'transient')!
    expect(tr.analytic / DEFAULT_PARAMS.w0MinusA).toBeGreaterThan(0.3)
    expect(tr.analytic / DEFAULT_PARAMS.w0MinusA).toBeLessThan(0.42)
  }, 60_000)

  it('T06: φ = 120°（C < 0）——正的 μ 讓誤差遠離 a：Monte Carlo 也不收斂', () => {
    const { r, cmp, mc } = runCase({ ...t13, N: 512, Px: 0.5, phiDeg: 120 })
    expect(r.polarity.C).toBeCloseTo(golden('T06').expected.C, 12)
    expect(cmp.kind).toBe('not-converged')
    expect(cmp.status).toBe('ok')
    expect(cmp.rmsMc).toBeGreaterThan(20 * Math.abs(DEFAULT_PARAMS.w0MinusA))
    expect(cmp.note).toMatch(/也沒有收斂/)
    for (const t of [cmp.note, ...cmp.rows.flatMap((x) => [x.name, x.criterion])]) expect(mathTextProblems(t), t).toEqual([])
    // 共用模擬器自己也發出極性警告
    expect(mc.warnings.join('')).toMatch(/C ≤ 0：更新極性錯誤/)
  }, 60_000)

  it('T08: commit 延遲 d = 2——g < g* 時 Monte Carlo 的 σ_w 與 Lyapunov 解一致；g > g* 時不收斂', () => {
    const stable = runCase({ ...t13, N: 512, mu: 40, d: 2 })
    expect(stable.r.g).toBeLessThan(stable.r.gStar)
    expect(stable.cmp.status).toBe('ok')
    expect(stable.cmp.rows[0].id).toBe('sigma')
    // d = 2 的 σ_w 比同樣 g、d = 0 的封閉式大（延遲讓雜訊增益上升）
    const d0 = evaluateThesis({ ...t13, N: 512, mu: 40, d: 0 })
    expect(stable.r.sigmaW).toBeGreaterThan(1.2 * d0.sigmaW)
    expect(stable.cmp.rows[0].lo).toBeGreaterThan(d0.sigmaW * 0.95) // MC 能分辨兩者：d = 0 的公式會被判為不一致
    const unstable = runCase({ ...t13, N: 512, mu: 100, d: 2 })
    expect(unstable.r.g).toBeGreaterThan(unstable.r.gStar)
    expect(unstable.cmp.kind).toBe('not-converged')
    expect(unstable.cmp.status).toBe('ok')
  }, 60_000)

  it('T13: 反面——GMAC sum 模式忘了 /N：Monte Carlo 的 RMS 誤差比收斂時大上萬倍', () => {
    const { cmp } = runCase({ ...t13, N: 512, gmacMode: 'sum' })
    expect(cmp.kind).toBe('not-converged')
    expect(cmp.status).toBe('ok')
    expect(cmp.rmsMc).toBeGreaterThan(1000)
  }, 60_000)

  it('反面：C = 0（φ = 90°）是 random walk——誤差沒有縮小，不會被判成「其實收斂了」', () => {
    for (const seed of [SEED, 7, 99]) {
      const { cmp } = runCase({ ...t13, N: 512, phiDeg: 90 }, seed)
      expect(cmp.kind).toBe('not-converged')
      expect(cmp.status, `seed ${seed}`).toBe('ok')
    }
  }, 60_000)

  it('反面：模型公式有錯時不會顯示成功——把解析 σ_w 故意改成 2 倍或 1/2，比對回報 mismatch', () => {
    const { r, plan, mc } = runCase({ ...t13, N: 512 })
    expect(compareMonteCarlo(r, plan, mc).status).toBe('ok')
    for (const k of [2, 0.5]) {
      const wrong = compareMonteCarlo({ ...r, sigmaW: r.sigmaW * k }, plan, mc)
      expect(wrong.status).toBe('mismatch')
      expect(wrong.rows.find((x) => x.id === 'sigma')?.pass).toBe(false)
      // 摘要點出是哪一項不一致，並列出兩邊的數字（解析值是被改錯的那一個）
      const row = wrong.rows.find((x) => x.id === 'sigma')!
      const f4 = (x: number) => Number(x.toPrecision(4)).toString()
      expect(wrong.note).toContain(String.raw`不一致：$\sigma_w$ MC $${f4(row.mc)}\,\mathrm{fs}$ vs 解析 $${f4(r.sigmaW * k)}\,\mathrm{fs}$`)
      expect(mathTextProblems(wrong.note), wrong.note).toEqual([])
    }
    // 反面：若解析模型誤判為「不收斂」，而 Monte Carlo 明明收斂，也會回報 mismatch
    const wrongPlan: McPlanOk = { ...plan, expectStable: false }
    const flipped = compareMonteCarlo(r, wrongPlan, mc)
    expect(flipped.status).toBe('mismatch')
    expect(flipped.note).toMatch(/線性模型預測不收斂，但 Monte Carlo/)
  }, 60_000)

  it('同一個 seed 可重現；不同 seed 的結果不同', () => {
    const p = { ...t13, N: 256 }
    const a = runCase(p, 5)
    const b = runCase(p, 5)
    const c = runCase(p, 6)
    expect(Array.from(a.mc.perRun.stdW)).toEqual(Array.from(b.mc.perRun.stdW))
    expect(a.cmp.rows[0].mc).toBe(b.cmp.rows[0].mc)
    expect(a.cmp.rows[0].mc).not.toBe(c.cmp.rows[0].mc)
  }, 60_000)

  it('perRunMse：(n−1)/n·s² + bias²；發散（NaN）的 run 視為無界', () => {
    const fake = {
      perRun: { meanW: new Float64Array(2), stdW: Float64Array.from([2, NaN]), bias: Float64Array.from([1, NaN]), settlingBlock: new Float64Array(2), diverged: 1 },
      wMean: new Float64Array(3),
      wStd: new Float64Array(3),
    }
    const v = perRunMse(fake, 10)
    expect(v[0]).toBeCloseTo(0.9 * 4 + 1, 12)
    expect(v[1]).toBe(Infinity)
  })
})
