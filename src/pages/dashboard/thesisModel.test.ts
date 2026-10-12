import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PARAMS,
  blocksTo95,
  characteristicPoly,
  comparatorGain,
  criticalGain,
  cumulativeEnergy,
  evaluateThesis,
  fixedToneRadius,
  impulseEnergy,
  impulseEnergyClosed,
  impulseEnergyClosedD1,
  impulseEnergyLyapunov,
  modePrecond,
  modeScalar,
  omega3dB,
  omega3dBClosed,
  phaseMarginDeg,
  polarityOf,
  settleDelayed,
  spectralRadiusOf,
  suggestHorizon,
  trajectory,
  weakStrongModes,
  type ThesisParams,
} from './thesisModel'
import { spectralRadius, zeros } from '@/simulation/core'
import { mathTextProblems } from './mathTextTestUtils'
import { THESIS_PRESETS, presetParams } from './presets'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function vec(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}

/** golden 規則：|a − e| ≤ abs + rel·|e| */
function expectGolden(v: Vector, key: string, actual: number) {
  const e = v.expected[key] as number
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e)
  expect(Math.abs(actual - e), `${key}: actual ${actual} vs expected ${e}`).toBeLessThanOrEqual(bound)
}

const t13: ThesisParams = { ...DEFAULT_PARAMS, B: 0 }

describe('thesisModel：對 golden vectors', () => {
  it('T04: K_q = √(2/π)/σ_v（σ_v = 100 fs）', () => {
    const v = vec('T04')
    expectGolden(v, 'kq_per_fs', comparatorGain(v.inputs.sigma_fs as number))
  })

  it('T06: φ = 120° ⇒ C < 0、正步長 pole > 1；θ 掃描與 golden 相同', () => {
    const v = vec('T06')
    const pol = polarityOf({ Px: (v.inputs.A as number) ** 2 / 2, Hmag: 1, phiDeg: 120, omega: v.inputs.Omega_rad as number, D: 0 })
    expectGolden(v, 'C', pol.C)
    expect(Math.sign(pol.C)).toBe(v.expected.C_sign)
    expectGolden(v, 'pole', 1 - (v.inputs.mu as number) * (v.inputs.kq_per_fs as number) * pol.C)
    const list = [0, 60, 90, 120, 180].map((phi) => polarityOf({ Px: 0.5, Hmag: 1, phiDeg: phi, omega: 0, D: 0 }).C)
    ;(v.expected.C_at_phi_list_deg as number[]).forEach((e, i) => expect(Math.abs(list[i] - e)).toBeLessThan(1e-12))
  })

  it('T07: φ = −120°、Ω = π/6、D = 4 ⇒ θ = 0°、C_D = 0.5、極性裕度 90°；C_D(D) 全表', () => {
    const v = vec('T07')
    const base = { Px: 0.5, Hmag: 1, phiDeg: -120, omega: v.inputs.Omega_rad as number }
    const pol = polarityOf({ ...base, D: 4 })
    expectGolden(v, 'theta_deg', pol.thetaDeg)
    expectGolden(v, 'C_D', pol.C)
    expectGolden(v, 'polarity_margin_deg', pol.marginDeg)
    ;(v.expected.C_D_list as number[]).forEach((e, D) => expect(Math.abs(polarityOf({ ...base, D }).C - e)).toBeLessThan(1e-12))
    ;(v.expected.misaligned_C_D_list_phi0 as number[]).forEach((e, D) =>
      expect(Math.abs(polarityOf({ ...base, phiDeg: 0, D }).C - e)).toBeLessThan(1e-12),
    )
  })

  it('T08: g = 1 ⇒ pole 0、PM 60°；PM 表', () => {
    const v = vec('T08')
    expectGolden(v, 'pole', spectralRadiusOf(1, 0))
    expectGolden(v, 'pm_deg', phaseMarginDeg(1, 0))
    const gs = v.inputs.g_list as number[]
    const pms = v.expected.pm_deg_list as number[]
    gs.forEach((g, i) => expect(Math.abs(phaseMarginDeg(g, 0) - pms[i])).toBeLessThan(1e-9))
    expect(Number.isNaN(phaseMarginDeg(2.1, 0))).toBe(true) // g > 2：|L| > 1，沒有 crossover
  })

  it('T08: delay bounds g* = 2 sin(π/(4d+2)) 與特徵根一致（d = 0..6）', () => {
    const v = vec('delay_bounds')
    const list = v.expected.g_crit_list as number[]
    ;(v.inputs.d_list as number[]).forEach((d, i) => {
      expect(Math.abs(criticalGain(d) - list[i])).toBeLessThan(1e-12)
      expect(spectralRadiusOf(list[i] * 0.999, d)).toBeLessThan(1)
      expect(spectralRadiusOf(list[i] * 1.001, d)).toBeGreaterThan(1)
      // 臨界時 PM = 0
      expect(Math.abs(phaseMarginDeg(list[i], d))).toBeLessThan(1e-9)
    })
  })

  it('T10: ρ = 0.99 ⇒ λ = 1.99、0.01、κ = 199', () => {
    const v = vec('T10')
    const r = evaluateThesis({ ...t13, twoParam: true, rho: 0.99 })
    expectGolden(v, 'eig_max', r.lamMax)
    expectGolden(v, 'eig_min', r.lamMin)
    expectGolden(v, 'cond', r.kappa)
    expect(r.checks.find((c) => c.id === 'identifiability')?.state).toBe('warn')
  })

  it('T11: 慢 pole 0.995 → 598 blocks；preconditioned pole 0.5 → 5 blocks', () => {
    const v = vec('T11')
    const mu = v.inputs.mu as number
    const lmin = v.inputs.lambda_min as number
    const slow = modeScalar(mu, lmin, 1)
    expectGolden(v, 'slow_pole', spectralRadiusOf(slow.gain, 0))
    expect(blocksTo95(spectralRadiusOf(slow.gain, 0))).toBe(v.expected.blocks_95)
    const pre = modePrecond(mu, lmin, 1)
    expectGolden(v, 'preconditioned_pole', spectralRadiusOf(pre.gain, 0))
    expect(blocksTo95(spectralRadiusOf(pre.gain, 0))).toBe(v.expected.preconditioned_blocks_95)
  })

  it('T13: σ_v = 100 fs、N = 4096、μ = 10 fs ⇒ p = 0.92021、σ_w = 0.3992 fs', () => {
    const v = vec('T13')
    const r = evaluateThesis(t13)
    expectGolden(v, 'K_per_fs', r.K)
    expectGolden(v, 'g', r.g)
    expectGolden(v, 'p', r.maxRadius)
    expectGolden(v, 'sigma_w_fs', r.sigmaW)
    expect(r.sigmaEta2).toBe(v.inputs.sigma_eta2)
    expect(r.checks.every((c) => c.state === 'ok')).toBe(true)
    expect(r.crossCheck.ok).toBe(true)
  })

  it('T13: 反面測試——GMAC sum 模式忘了 /N ⇒ g = 326.8、pole −325.8、判定不穩', () => {
    const v = vec('T13')
    const r = evaluateThesis({ ...t13, gmacMode: 'sum' })
    expectGolden(v, 'g_sum_mode', r.g)
    expectGolden(v, 'pole_sum_mode', 1 - r.g)
    expect(r.stable).toBe(false)
    expect(r.checks.find((c) => c.id === 'stability')?.state).toBe('fail')
    expect(r.warnings.join('')).toMatch(/sum 模式/)
  })

  it('T14: f_u = 976.5625 kHz、exact −3 dB 12.931 kHz、ENBW 20.289 kHz', () => {
    const v = vec('T14')
    const r = evaluateThesis(t13)
    const m = r.modes[0]
    expectGolden(v, 'f_u_hz', r.fuHz)
    expectGolden(v, 'bw_exact_3db_hz', m.f3dbHz)
    expectGolden(v, 'enbw_one_sided_hz', m.enbwHz)
    // ENBW 與 σ_w 的一致性：σ_w² = S_w^(1)(0)·ENBW，S_w^(1)(0) = 2q/(g² f_u)
    const S0 = (2 * r.q) / (r.g * r.g * r.fuHz)
    expect(Math.abs(S0 * m.enbwHz - r.sigmaW ** 2)).toBeLessThan(1e-12)
  })

  it('T15: f_out = 13 GHz、A_t = 0.5 fs peak、|T| = 1 ⇒ spur ≈ −93.80 dBc', () => {
    const v = vec('T15')
    // 單頻 code A = 1（P_x = 1/2）、C = 1/2、B = 0.25 fs ⇒ Δw = 0.5 fs ⇒ A_t = A·Δw = 0.5 fs
    const r = evaluateThesis({ ...t13, Px: 0.5, B: 0.25, foutGHz: 13, Tmag: 1 })
    expect(r.deltaW).toBeCloseTo(0.5, 14)
    expect(r.AtPeak).toBeCloseTo(0.5, 14)
    expectGolden(v, 'spur_dbc', r.spurDbc)
  })
})

describe('thesisModel：內部一致性', () => {
  it('特徵多項式：d = 0 為 z − (1 − g)，d = 2 為 z³ − z² + g', () => {
    expect(characteristicPoly(0.3, 0)).toEqual([1, -0.7])
    expect(characteristicPoly(0.3, 2)).toEqual([1, -1, 0, 0.3])
  })

  it('脈衝響應能量：d = 0 數值 = 封閉式 1/(g(2−g))；d > 0 與暴力加總一致', () => {
    for (const g of [0.01, 0.0797, 0.5, 1, 1.7]) {
      const e = impulseEnergy(g, 0)
      expect(e.converged).toBe(true)
      expect(Math.abs(e.energy - impulseEnergyClosed(g)) / impulseEnergyClosed(g)).toBeLessThan(1e-10)
    }
    const g = 0.4
    const d = 2
    const y: number[] = [1]
    for (let m = 1; m < 5000; m++) y.push(y[m - 1] - g * (m - 1 - d >= 0 ? y[m - 1 - d] : 0))
    const brute = y.reduce((s, v) => s + v * v, 0)
    expect(Math.abs(impulseEnergy(g, d).energy - brute) / brute).toBeLessThan(1e-12)
    const c = cumulativeEnergy(g, d, 5000)
    expect(Math.abs(c[5000] - brute) / brute).toBeLessThan(1e-12)
  })

  it('Σy² 的兩種算法一致：Lyapunov 方程 = 直接加總（d = 0..8）；d = 0 等於封閉式；不穩定時為 ∞', () => {
    for (let d = 0; d <= 8; d++) {
      for (const frac of [0.05, 0.3, 0.7, 0.95]) {
        const g = frac * criticalGain(d)
        const sum = impulseEnergy(g, d, 5_000_000)
        expect(sum.converged, `g=${g} d=${d}`).toBe(true)
        const lyap = impulseEnergyLyapunov(g, d)
        expect(Math.abs(lyap - sum.energy) / sum.energy, `g=${g} d=${d}`).toBeLessThan(1e-9)
      }
      expect(impulseEnergyLyapunov(criticalGain(d) * 1.01, d)).toBe(Infinity)
      expect(impulseEnergyLyapunov(-0.1, d)).toBe(Infinity)
    }
    expect(impulseEnergyLyapunov(0.3, 0)).toBe(impulseEnergyClosed(0.3))
    // d = 1 的封閉式（頁面上的推導 5）：(1 + g)/(g(1 − g)(2 + g))
    for (const g of [0.01, 0.0797885, 0.3, 0.6, 0.95]) {
      expect(Math.abs(impulseEnergyLyapunov(g, 1) - impulseEnergyClosedD1(g)) / impulseEnergyClosedD1(g)).toBeLessThan(1e-11)
      expect(Math.abs(impulseEnergy(g, 1, 5_000_000).energy - impulseEnergyClosedD1(g)) / impulseEnergyClosedD1(g)).toBeLessThan(1e-9)
    }
    expect(impulseEnergyClosedD1(1)).toBe(Infinity)
    expect(impulseEnergyClosedD1(0.3)).toBeCloseTo(1.3 / (0.3 * 0.7 * 2.3), 14)
    // 延遲讓雜訊增益上升：同樣的 g，d 越大 Σy² 越大
    expect(impulseEnergyLyapunov(0.3, 1)).toBeGreaterThan(impulseEnergyLyapunov(0.3, 0))
    expect(impulseEnergyLyapunov(0.3, 2)).toBeGreaterThan(impulseEnergyLyapunov(0.3, 1))
  })

  it('極慢的 mode：直接加總在步數上限內加不完，但 σ_w 仍採 Lyapunov / 封閉式的精確值（不會悄悄低估）', () => {
    // g ≈ 8e-7：直接加總要 10⁷ 步以上
    const slow = evaluateThesis({ ...t13, sigmaV: 1000, mu: 1e-3 })
    const m = slow.modes[0]
    expect(m.energyConverged).toBe(false)
    expect(m.energySum).toBeLessThan(m.energy) // 部分和一定比較小
    expect(m.energy).toBeCloseTo(impulseEnergyClosed(m.gain), 3)
    expect(Math.abs(slow.sigmaW - Math.sqrt(slow.q * impulseEnergyClosed(slow.g))) / slow.sigmaW).toBeLessThan(1e-12)
    expect(Number.isNaN(slow.sigmaWSum)).toBe(true)
    expect(slow.crossCheck.ok).toBe(true)
    expect(slow.crossCheck.note).toMatch(/未收斂/)
    // d > 0 的慢 mode 同樣精確：與 d = 0 的封閉式只差 O(g)
    const slowD = evaluateThesis({ ...t13, sigmaV: 1000, mu: 1e-3, d: 3 })
    expect(Math.abs(slowD.sigmaW - slow.sigmaW) / slow.sigmaW).toBeLessThan(1e-4)
    // 一般情況：兩種算法都有，且一致
    const normal = evaluateThesis({ ...t13, d: 2, mu: 40 })
    expect(normal.modes[0].energyConverged).toBe(true)
    expect(Math.abs(normal.sigmaWSum - normal.sigmaW) / normal.sigmaW).toBeLessThan(1e-9)
    expect(normal.crossCheck.note).toMatch(/Lyapunov 方程 = 直接加總/)
  })

  it('−3 dB：數值掃描 = 封閉式（d = 0）；p < 3 − 2√2 時不存在', () => {
    for (const g of [1e-4, 0.0797, 0.3, 0.8]) expect(Math.abs(omega3dB(g, 0) - omega3dBClosed(g)) / omega3dBClosed(g)).toBeLessThan(1e-9)
    expect(Number.isNaN(omega3dB(0.9, 0))).toBe(true)
    expect(Number.isNaN(omega3dBClosed(0.9))).toBe(true)
  })

  it('d > 0 的穩態 variance 與時域軌跡終值一致', () => {
    const p = { ...t13, d: 2, mu: 40 }
    const r = evaluateThesis(p)
    expect(r.stable).toBe(true)
    const tr = trajectory(r, 4000)
    expect(Math.abs(tr.sd[4000] - r.sigmaW) / r.sigmaW).toBeLessThan(1e-9)
  })

  it('平均軌跡收斂到 bias Δw = B/C（有延遲、2 參數、兩種更新矩陣）', () => {
    for (const update of ['scalar', 'precond'] as const) {
      const r = evaluateThesis({ ...DEFAULT_PARAMS, B: 0.3, d: 1, mu: 60, twoParam: true, rho: 0.6, update })
      expect(r.stable).toBe(true)
      expect(r.deltaW).toBeCloseTo(0.3, 12)
      const K = suggestHorizon(r) * 4
      const tr = trajectory(r, K)
      expect(tr.mean[K]).toBeCloseTo(r.deltaW, 6)
      expect(tr.mean[0]).toBeCloseTo(DEFAULT_PARAMS.w0MinusA, 12)
    }
  })

  it('2 參數 random DTC error：P_x Σ λ̃_i Var_i；ρ = 0 時是單參數的 √2 倍', () => {
    const one = evaluateThesis(t13)
    const two = evaluateThesis({ ...t13, twoParam: true, rho: 0 })
    expect(two.sigmaW).toBeCloseTo(one.sigmaW, 12)
    expect(two.sigmaDtRand).toBeCloseTo(Math.SQRT2 * one.sigmaDtRand, 12)
  })

  it('Preconditioner 加快弱方向、但把弱方向雜訊放大 1/λ̃（Q13）', () => {
    const base = { ...t13, twoParam: true, rho: 0.99, mu: 100 }
    const sc = evaluateThesis({ ...base, update: 'scalar' })
    const pc = evaluateThesis({ ...base, update: 'precond' })
    expect(pc.slowT95Blocks).toBeLessThan(sc.slowT95Blocks / 50)
    const weakSc = sc.modes[1]
    const weakPc = pc.modes[1]
    const strongPc = pc.modes[0]
    expect(weakPc.variance / strongPc.variance).toBeCloseTo(pc.kappa, 6) // 同 loop gain 下 ∝ 1/λ̃
    expect(weakPc.variance).toBeGreaterThan(weakSc.variance * 10)
  })
})

describe('thesisModel：反面測試（失敗時要說明原因）', () => {
  it('極性反轉：φ = 180° ⇒ C < 0、迴路不穩、bias 不可達、警告提到「極性」', () => {
    const r = evaluateThesis({ ...t13, phiDeg: 180 })
    expect(r.polarity.C).toBeLessThan(0)
    expect(r.maxRadius).toBeGreaterThan(1)
    expect(r.checks.find((c) => c.id === 'polarity')?.state).toBe('fail')
    expect(r.checks.find((c) => c.id === 'bias')?.reason).toMatch(/排斥點/)
    // 警告以 LaTeX 寫出判斷依據與算出來的數字：C < 0、θ = 180°、cos θ = −1、C = −1
    const warn = r.warnings.find((w) => w.startsWith('$C<0$：更新極性錯誤'))
    expect(warn).toBeDefined()
    expect(warn).toContain(String.raw`$\theta=\phi+\Omega D=180^\circ$`)
    expect(warn).toContain(String.raw`$C=P_x|H|\cos\theta=-1$`)
    // 規格 negative_tests：reversed polarity pole = 1 + μK_q = 1.0797885
    const neg = vec('negative_tests')
    expect(Math.abs(1 - r.g - (neg.expected.reversed_polarity_pole as number))).toBeLessThan(1e-12)
  })

  it('θ = ±90° ⇒ C = 0：random walk，不得判定為通過', () => {
    const r = evaluateThesis({ ...t13, phiDeg: 90 })
    expect(r.polarity.C).toBe(0)
    expect(r.checks.find((c) => c.id === 'polarity')?.reason).toMatch(/^\$C=0\$：.*random walk/)
    expect(r.stable).toBe(false)
    // C = 0 時 w* = a + B/C 沒有定義：不是「排斥點」，而是沒有固定點（B ≠ 0 時等速漂移）
    const bias = evaluateThesis({ ...DEFAULT_PARAMS, phiDeg: 90 }).checks.find((c) => c.id === 'bias')
    expect(bias?.state).toBe('fail')
    expect(bias?.summary).toBe('沒有固定點')
    expect(bias?.reason).toMatch(/沒有恢復力/)
    expect(bias?.reason).not.toMatch(/排斥點/)
    // 線性模型的平均軌跡確實是等速漂移：每個 block 移動 μ K_q B
    const drift = evaluateThesis({ ...DEFAULT_PARAMS, phiDeg: 90 })
    const tr = trajectory(drift, 10)
    const step = DEFAULT_PARAMS.mu * drift.Kq * DEFAULT_PARAMS.B
    for (let k = 1; k <= 10; k++) expect(tr.mean[k] - tr.mean[k - 1]).toBeCloseTo(step, 12)
  })

  it('勘誤 E20：θ = 200° ⇒ M = −70°；θ = −150° ⇒ M = −60°', () => {
    expect(polarityOf({ Px: 1, Hmag: 1, phiDeg: 200, omega: 0, D: 0 }).marginDeg).toBeCloseTo(-70, 10)
    expect(polarityOf({ Px: 1, Hmag: 1, phiDeg: -150, omega: 0, D: 0 }).marginDeg).toBeCloseTo(-60, 10)
  })

  it('完全缺乏 PE：ρ = 1 ⇒ λ_min = 0、不可辨識；null 方向凍結在初值', () => {
    const r = evaluateThesis({ ...t13, twoParam: true, rho: 1 })
    expect(r.lamMin).toBe(0)
    expect(r.identifiable).toBe(false)
    expect(r.warnings.some((w) => w.startsWith(String.raw`$\lambda_{\min}=0$（$\rho=1$）`))).toBe(true)
    const tr = trajectory(r, 2000)
    // 只有 (1,1) mode 會動：gain 誤差停在初值的一半（加上一半的 bias）
    expect(tr.mean[2000]).toBeCloseTo(DEFAULT_PARAMS.w0MinusA / 2, 6)
    const pre = evaluateThesis({ ...t13, twoParam: true, rho: 1, update: 'precond' })
    expect(Number.isNaN(pre.sigmaW)).toBe(true)
  })

  it('|H| = 0（error path 擋掉 code）⇒ 有效 regressor 功率為 0，不可辨識', () => {
    const r = evaluateThesis({ ...t13, Hmag: 0 })
    expect(r.lamMin).toBe(0)
    expect(r.identifiable).toBe(false)
    const reason = r.checks.find((c) => c.id === 'identifiability')?.reason ?? ''
    expect(reason.startsWith('$|H|=0$：')).toBe(true)
    expect(reason).toContain('$|H|^2P_x=0$')
  })

  it('P_x = 0（沒有激勵）⇒ 不可辨識 + C = 0', () => {
    const r = evaluateThesis({ ...t13, Px: 0 })
    expect(r.checks.find((c) => c.id === 'identifiability')?.state).toBe('fail')
    expect(r.checks.find((c) => c.id === 'polarity')?.state).toBe('fail')
  })

  it('update latency：g = 0.798、d = 2 > g* = 0.618 ⇒ 不穩；d = 0 時穩定', () => {
    expect(evaluateThesis({ ...t13, mu: 100, d: 0 }).stable).toBe(true)
    const r = evaluateThesis({ ...t13, mu: 100, d: 2 })
    expect(r.stable).toBe(false)
    // 原因裡的數字：g = 0.7979 ≥ g*(2) = 0.618，max|z| ≥ 1
    const reason = r.checks.find((c) => c.id === 'stability')?.reason ?? ''
    expect(reason).toContain(String.raw`$g_i=0.7979\ge g^*(d=2)=2\sin\frac{\pi}{4d+2}=0.618$`)
    expect(reason).toContain(String.raw`$\max|z|=${Number(r.maxRadius.toPrecision(4))}\ge1$`)
    expect(r.maxRadius).toBeGreaterThan(1)
    expect(r.gStar).toBeCloseTo(0.6180339887, 9)
  })

  it('variance 與 bias 各自過關、合起來超出預算 ⇒ system-level 失敗（條件 4、5 過關不保證條件 6）', () => {
    // σ_rand ≈ 0.399 fs、σ_det = 0.9 fs，預算 0.95 fs
    const r = evaluateThesis({ ...t13, B: 0.9, jitterBudget: 0.95 })
    expect(r.checks.find((c) => c.id === 'variance')?.state).toBe('ok')
    expect(r.checks.find((c) => c.id === 'bias')?.state).not.toBe('fail')
    const sys = r.checks.find((c) => c.id === 'system')
    expect(sys?.state).toBe('fail')
    expect(sys?.reason).toMatch(/要另外檢查/)
    expect(sys?.reason).not.toMatch(/獨立的條件/)
  })

  it('C → 0 放大 bias：φ = 85° 時 Δw = B/cos 85°', () => {
    const r = evaluateThesis({ ...DEFAULT_PARAMS, phiDeg: 85 })
    expect(r.deltaW).toBeCloseTo(DEFAULT_PARAMS.B / Math.cos((85 * Math.PI) / 180), 10)
    expect(r.checks.find((c) => c.id === 'bias')?.state).toBe('fail')
  })

  it('Ω = 0 或 π 時 φ 只能是 0° / 180°（勘誤 E46）；block 內 code 週期太少也要提醒', () => {
    expect(evaluateThesis({ ...t13, omega: 0, phiDeg: 60 }).notes.join('')).toMatch(/E46/)
    expect(evaluateThesis({ ...t13, omega: Math.PI, phiDeg: 60, D: 3 }).notes.join('')).toMatch(/E46/)
    expect(evaluateThesis({ ...t13, omega: 0, phiDeg: 180 }).notes.join('')).not.toMatch(/E46/)
    expect(evaluateThesis({ ...t13, omega: 0.001 }).notes.join('')).toMatch(/不到 10 個 code 週期/)
    expect(evaluateThesis(t13).notes).toEqual([])
  })

  it('大初始誤差 ⇒ 標示線性化（K_q）失效風險', () => {
    const r = evaluateThesis({ ...t13, w0MinusA: -60 })
    expect(r.notes.join('')).toMatch(/飽和/)
    expect(r.notes.join('')).toContain(String.raw`$|w_0-a|\,|H|\sqrt{P_x}/\sigma_v=0.6>0.3$`)
    // 指標是初始 gain 殘差 (a − w_0)·u 的 RMS：u = h*x 的 RMS 是 |H|√P_x，所以要乘 |H|
    expect(r.linearityInit).toBeCloseTo((60 * 1 * 1) / 100, 14)
    const small = evaluateThesis({ ...t13, w0MinusA: -60, Hmag: 0.4 }) // 60 × 0.4 / 100 = 0.24
    expect(small.linearityInit).toBeCloseTo(0.24, 14)
    expect(small.notes.join('')).not.toMatch(/飽和/)
    const big = evaluateThesis({ ...t13, w0MinusA: -20, Hmag: 2 }) // 20 × 2 / 100 = 0.4
    expect(big.linearityInit).toBeCloseTo(0.4, 14)
    expect(big.notes.join('')).toContain(String.raw`$|w_0-a|\,|H|\sqrt{P_x}/\sigma_v=0.4>0.3$`)
    // 剛好在門檻上（30 fs / 100 fs = 0.3）不算超過
    expect(evaluateThesis({ ...t13, w0MinusA: -30 }).notes.join('')).not.toMatch(/飽和/)
  })
})

describe('thesisModel：說明文字一律 LaTeX（docs/teaching-style.md §3）', () => {
  // 涵蓋每一種判定分支：通過 / 注意 / 未通過、單參數 / 雙參數、兩種更新矩陣、延遲、sum 模式、邊界頻率
  const cases: ThesisParams[] = [
    DEFAULT_PARAMS,
    ...THESIS_PRESETS.map(presetParams),
    { ...t13, phiDeg: 90 },
    { ...t13, phiDeg: 180 },
    { ...t13, phiDeg: 75 }, // 極性裕度 < 30°
    { ...t13, Px: 0 },
    { ...t13, Hmag: 0 },
    { ...t13, twoParam: true, rho: 1, update: 'precond' },
    { ...t13, twoParam: true, rho: 0.999, update: 'precond' },
    { ...t13, twoParam: true, rho: -0.999 },
    { ...t13, mu: 200 }, // PM < 45°
    { ...t13, mu: 260 }, // g > 2
    { ...t13, mu: 100, d: 1 },
    { ...t13, sigmaV: 1000, mu: 1e-3 }, // 直接加總未收斂
    { ...t13, B: 40 }, // bias 超出預算
    { ...t13, B: 40, jitterBudget: 100 }, // 預算夠大，但 |B|/σ_v > 0.3：Sign-LMS 的固定點不再是 a + B/C（注意）
    { ...t13, B: 0.9, jitterBudget: 0.95 },
    { ...t13, B: 0 },
    { ...t13, omega: 0, phiDeg: 60 },
    { ...t13, omega: Math.PI, phiDeg: 60 },
    { ...t13, omega: 0.001 },
    { ...t13, w0MinusA: -60 },
    { ...t13, gmacMode: 'sum' },
    { ...t13, spurLimit: -120, B: 0.25, Px: 0.5 },
    // R12：雙參數且 θ ≠ 0°（模型穩定、固定同頻 code 不穩定／兩者都穩定／模型自己不穩定；兩種更新矩陣）
    { ...t13, mu: 1.5 / comparatorGain(100), twoParam: true, rho: 0, phiDeg: 60 },
    { ...t13, mu: 1.5 / comparatorGain(100), twoParam: true, rho: 0.5, phiDeg: 60, update: 'precond' },
    { ...t13, twoParam: true, rho: 0.9, phiDeg: 30 },
    { ...t13, mu: 1.23 / comparatorGain(100), twoParam: true, rho: 0.9, phiDeg: 30 },
    { ...DEFAULT_PARAMS, sigmaV: (10 * Math.sqrt(2 / Math.PI)) / 1.5, w0MinusA: -1, twoParam: true, rho: 0, phiDeg: 50 },
    // C01：κ > 100 而最慢的是強方向（d = 1、g 接近 g*）；以及強方向已經不穩定
    { ...t13, mu: 0.5 / comparatorGain(100), twoParam: true, rho: 0.99, d: 1 },
    { ...t13, mu: 1.2 / comparatorGain(100), twoParam: true, rho: 0.99 },
  ]

  it('每個條件的 summary / reason、warnings、notes、交叉比對說明：$ 成對、KaTeX 可解析、$…$ 之外沒有 Unicode 拼的公式', () => {
    const seen = new Set<string>()
    for (const p of cases) {
      const r = evaluateThesis(p)
      expect(r.checks.map((c) => c.id)).toEqual(['identifiability', 'polarity', 'stability', 'variance', 'bias', 'system'])
      const texts = [...r.checks.flatMap((c) => [c.summary, c.reason]), ...r.warnings, ...r.notes, r.crossCheck.note]
      for (const t of texts) expect(mathTextProblems(t), `${JSON.stringify(p)}\n${t}`).toEqual([])
      for (const c of r.checks) {
        seen.add(`${c.id}:${c.state}`)
        expect(c.reason.length, `${c.id}`).toBeGreaterThan(8)
      }
      // 每一個失敗都列在 warnings 或逐項說明裡（ExperimentShell 以 danger 顯示 warnings）
      for (const w of r.warnings) expect(r.checks.some((c) => c.reason === w)).toBe(true)
    }
    // 這組案例確實走過所有分支（六個條件 × 通過 / 未通過，以及有「注意」狀態的四個條件）
    for (const id of ['identifiability', 'polarity', 'stability', 'variance', 'bias', 'system']) {
      expect(seen.has(`${id}:ok`), `${id}:ok`).toBe(true)
      expect(seen.has(`${id}:fail`), `${id}:fail`).toBe(true)
    }
    for (const id of ['identifiability', 'polarity', 'stability', 'bias']) expect(seen.has(`${id}:warn`), `${id}:warn`).toBe(true)
  })
})

describe('R02：95% 收斂 block 數（有 commit 延遲時逐 block 數，不是 ⌈ln 0.05 / ln max|z|⌉）', () => {
  const Kq = comparatorGain(100)
  /** 暴力對照：1 + 最後一個 |E[w_k − a]/E[w_0 − a]| > 5% 的 k（單參數、B = 0 時就是 y_k） */
  const bruteFromPlot = (p: ThesisParams, horizon: number): number => {
    const r = evaluateThesis(p)
    const m = trajectory(r, horizon).mean
    let last = 0
    for (let k = 1; k <= horizon; k++) if (Math.abs(m[k] / m[0]) > 0.05) last = k
    return last + 1
  }

  it('審查的反例：d = 1、g = 1/4 是重根 z = 1/2，δ_k = (1 + k/2)·2^{−k} ⇒ 7 個 block（⌈ln 0.05 / ln 0.5⌉ = 5 太少）', () => {
    const p: ThesisParams = { ...DEFAULT_PARAMS, mu: 0.25 / Kq, d: 1, B: 0, w0MinusA: -1 }
    const r = evaluateThesis(p)
    expect(r.g).toBeCloseTo(0.25, 12)
    expect(r.maxRadius).toBeCloseTo(0.5, 6) // 重根：數值求根的誤差是 √ε 等級
    expect(r.modes[0].t95Asymptotic).toBe(5)
    expect(r.slowT95Blocks).toBe(7)
    expect(r.slowT95Exact).toBe(true)
    // 頁面上那張圖（平均軌跡）的數字：k = 5、6、7 是 0.109375、0.0625、0.03515625
    const m = trajectory(r, 12).mean
    for (let k = 0; k <= 12; k++) expect(m[k]).toBeCloseTo(-(1 + k / 2) * 2 ** -k, 12)
    expect(m[5]).toBeCloseTo(-0.109375, 12)
    expect(m[6]).toBeCloseTo(-0.0625, 12)
    expect(m[7]).toBeCloseTo(-0.03515625, 12)
    expect(Math.abs(m[6])).toBeGreaterThan(0.05)
    expect(Math.abs(m[7])).toBeLessThan(0.05)
    expect(settleDelayed(0.25, 1)).toEqual({ blocks: 7, exact: true })
    // B ≠ 0 只移動固定點：相對於固定點的暫態相同，block 數不變
    const withBias = evaluateThesis({ ...p, B: 0.1 })
    expect(withBias.slowT95Blocks).toBe(7)
    const mb = trajectory(withBias, 12).mean
    for (let k = 0; k <= 12; k++) expect((mb[k] - withBias.deltaW) / (mb[0] - withBias.deltaW)).toBeCloseTo((1 + k / 2) * 2 ** -k, 10)
  })

  it('正常對照：d = 0 就是 ⌈ln 0.05 / ln|1 − g|⌉（0.5 → 5、T11 的 0.995 → 598、預設 37）；不穩定或 g ≤ 0 是 ∞', () => {
    expect(settleDelayed(0.5, 0)).toEqual({ blocks: 5, exact: true })
    expect(settleDelayed(0.005, 0)).toEqual({ blocks: 598, exact: true })
    expect(settleDelayed(1.5, 0).blocks).toBe(blocksTo95(0.5)) // 負的 pole：|p| = 0.5
    const dflt = evaluateThesis(DEFAULT_PARAMS)
    expect(dflt.slowT95Blocks).toBe(37)
    expect(dflt.slowT95Blocks).toBe(blocksTo95(dflt.maxRadius))
    expect(dflt.slowT95Exact).toBe(true)
    expect(dflt.modes[0].t95Asymptotic).toBe(37)
    for (let d = 0; d <= 8; d++) {
      expect(settleDelayed(1.001 * criticalGain(d), d).blocks, `d=${d}`).toBe(Infinity) // 剛好在 g* 上的根落在單位圓上，數值上不判定
      expect(settleDelayed(1.2 * criticalGain(d), d).blocks, `d=${d}`).toBe(Infinity)
      expect(settleDelayed(0, d).blocks, `d=${d}`).toBe(Infinity)
      expect(settleDelayed(-0.1, d).blocks, `d=${d}`).toBe(Infinity)
    }
    // 極慢的 mode（步數上限內數不完）：改列漸近估計，並標成不是逐 block 數出來的
    const slow = settleDelayed(1e-6, 8)
    expect(slow.exact).toBe(false)
    expect(slow.blocks).toBe(blocksTo95(spectralRadiusOf(1e-6, 8)))
    const slowCase = evaluateThesis({ ...t13, sigmaV: 1000, mu: 1e-3, d: 3 })
    expect(slowCase.slowT95Exact).toBe(false)
    expect(slowCase.slowT95Blocks).toBe(blocksTo95(slowCase.maxRadius))
  })

  it('指標 = 圖：單參數、B = 0 時，95% 收斂 block 數就是軌跡圖最後一次超過 5% 的下一個 block（d = 0…8、g/g* = 0.05…0.95）', () => {
    const got: Record<number, number[]> = {}
    for (let d = 0; d <= 8; d++) {
      got[d] = []
      for (const frac of [0.05, 0.2, 0.5, 0.8, 0.95]) {
        const p: ThesisParams = { ...DEFAULT_PARAMS, mu: (frac * criticalGain(d)) / Kq, d, B: 0, w0MinusA: -1 }
        const r = evaluateThesis(p)
        expect(r.slowT95Exact, `d=${d} frac=${frac}`).toBe(true)
        const horizon = Math.max(400, 8 * blocksTo95(r.maxRadius))
        expect(r.slowT95Blocks, `d=${d} frac=${frac}`).toBe(bruteFromPlot(p, horizon))
        got[d].push(r.slowT95Blocks)
      }
    }
    // 抽查值（另以 Python 的獨立遞推核對）
    expect(got[0]).toEqual([0.05, 0.2, 0.5, 0.8, 0.95].map((f) => blocksTo95(Math.abs(1 - 2 * f))))
    expect(got[1]).toEqual([56, 10, 9, 26, 119])
    expect(got[2]).toEqual([90, 16, 15, 44, 203])
  })

  it('max|z| 的公式兩個方向都會錯：重根、複數根時偏少，也可能偏多；雙參數取各 mode 的最大值', () => {
    const both = (g: number, d: number) => [settleDelayed(g, d).blocks, blocksTo95(spectralRadiusOf(g, d))]
    expect(both(0.5, 1)).toEqual([9, 9])
    expect(both(0.8, 1)).toEqual([26, 27])
    expect(both(4 / 27, 2)).toEqual([11, 8]) // d = 2 的重根 z = 2/3
    expect(both(27 / 256, 3)).toEqual([16, 11]) // d = 3 的重根 z = 3/4
    expect(both(8 ** 8 / 9 ** 9, 8)).toEqual([38, 26]) // d = 8 的重根 z = 8/9
    expect(both(0.33 * criticalGain(3), 3)).toEqual([8, 14])
    const two = evaluateThesis({ ...DEFAULT_PARAMS, twoParam: true, rho: 0.6, d: 1, mu: 0.25 / Kq })
    expect(two.modes.map((m) => m.gain)).toEqual([expect.closeTo(0.4, 12), expect.closeTo(0.1, 12)])
    expect(two.modes.map((m) => m.t95Blocks)).toEqual([7, 26])
    expect(two.slowT95Blocks).toBe(26)
  })

  it('停止規則的依據：狀態最多再放大 sup_j ‖F^j‖_∞ = 1 + d·g ≤ 2.48 倍（d ≤ 8、g ≤ g*），離 5% 還有約 400 倍餘裕', () => {
    let worst = 0
    for (let d = 1; d <= 8; d++) {
      const L = d + 1
      for (const frac of [0.02, 0.3, 0.6, 0.9, 0.99, 0.99999, 1]) {
        const g = frac * criticalGain(d)
        // F：y_m = y_{m−1} − g·y_{m−1−d} 的 companion matrix
        let P: number[][] = Array.from({ length: L }, (_, i) => Array.from({ length: L }, (_, j) => (i === j ? 1 : 0)))
        let sup = 1
        for (let j = 1; j <= 3000; j++) {
          const next = P.map((row) => row.slice())
          for (let c = 0; c < L; c++) {
            next[0][c] = P[0][c] - g * P[d][c]
            for (let i = 1; i < L; i++) next[i][c] = P[i - 1][c]
          }
          P = next
          sup = Math.max(sup, ...P.map((row) => row.reduce((s, v) => s + Math.abs(v), 0)))
        }
        expect(sup, `d=${d} g/g*=${frac}`).toBeCloseTo(1 + d * g, 9)
        worst = Math.max(worst, sup)
      }
    }
    expect(worst).toBeCloseTo(1 + 8 * criticalGain(8), 9) // 2.4763
    expect(worst * 0.05 * 1e-3).toBeLessThan(0.05 / 400)
  })
})

describe('C01：κ > 100 的說明把「弱方向」和「最慢的 mode」分開', () => {
  const base: ThesisParams = { ...DEFAULT_PARAMS, twoParam: true, rho: 0.99, update: 'scalar', mu: 0.5 / comparatorGain(100) }
  const ident = (p: ThesisParams) => {
    const r = evaluateThesis(p)
    return { r, reason: r.checks.find((c) => c.id === 'identifiability')?.reason ?? '' }
  }

  it('正常對照（d = 0、g = 0.5）：弱方向就是最慢的，文字不變（598 個 block）', () => {
    const { r, reason } = ident(base)
    expect(r.modes.map((m) => m.t95Blocks)).toEqual([1, 598])
    expect(r.slowT95Blocks).toBe(598)
    expect(reason).toContain('95% 收斂要 $598$ 個 block；改用 preconditioner')
    expect(reason).not.toMatch(/強方向/)
  })

  it('反例：d = 1（g*=1）時強方向 g·λ̃₊ = 0.995 太接近上限，最慢的是強方向（1241），弱方向只要 595', () => {
    const { r, reason } = ident({ ...base, d: 1 })
    expect(r.modes[0].gain).toBeCloseTo(0.995, 12)
    expect(r.modes[0].radius).toBeCloseTo(0.9974968672, 9)
    expect(r.modes[1].radius).toBeCloseTo(0.9949747468, 9)
    expect(r.modes.map((m) => m.t95Blocks)).toEqual([1241, 595])
    expect(r.modes.map((m) => m.t95Asymptotic)).toEqual([1196, 595]) // 只看 max|z| 會給 1196
    expect(r.slowT95Blocks).toBe(1241)
    expect(reason).toContain('要 $595$ 個 block')
    expect(reason).toContain('$1241$')
    expect(reason).toMatch(/最慢的不是它：強方向/)
    expect(reason).not.toContain('95% 收斂要 $1241$ 個 block')
  })

  it('反例：d = 0、g = 1.003 ⇒ 強方向的 pole −0.99597（742 個 block），弱方向 298 個', () => {
    const { r, reason } = ident({ ...base, mu: 1.003 / comparatorGain(100) })
    expect(r.modes.map((m) => m.t95Blocks)).toEqual([742, 298])
    expect(reason).toContain('要 $298$ 個 block')
    expect(reason).toContain('$742$')
    expect(reason).toMatch(/強方向/)
    // 強方向已經不穩定時不寫「要 ∞ 個 block」
    const hot = ident({ ...base, mu: 1.2 / comparatorGain(100) })
    expect(hot.r.stable).toBe(false)
    expect(hot.reason).toContain('強方向的 loop gain 已經達到或超過穩定上限 $g^*$，不收斂')
    expect(hot.reason).not.toContain('\\infty')
  })
})

describe('R12：雙參數的交叉相關假設 E[x_i u_j] = C·R̃_ij', () => {
  const Kq = comparatorGain(100)
  const D2R = Math.PI / 180
  const check = (p: ThesisParams, id: string) => evaluateThesis(p).checks.find((c) => c.id === id)!
  const ASSUMPTION_TEX = String.raw`E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}`
  /** 獨立對照：δ_{k+1} = δ_k − M·C·δ_{k−d} 的 block companion（2(d+1) 維）的 spectral radius；C_ij = cos(θ + ψ_j − ψ_i) */
  const bruteRadius = (rho: number, thetaDeg: number, gp: number, d: number, precond: boolean): number => {
    const th = thetaDeg * D2R
    const psi = Math.acos(rho)
    const C = [
      [Math.cos(th), Math.cos(th + psi)],
      [Math.cos(th - psi), Math.cos(th)],
    ]
    const det = 1 - rho * rho
    const M = precond
      ? [
          [gp / det, (-gp * rho) / det],
          [(-gp * rho) / det, gp / det],
        ]
      : [
          [gp, 0],
          [0, gp],
        ]
    const MC = [0, 1].map((i) => [0, 1].map((j) => M[i][0] * C[0][j] + M[i][1] * C[1][j]))
    const n = 2 * (d + 1)
    const A = zeros(n, n)
    A[0][0] = 1
    A[1][1] = 1
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) A[i][2 * d + j] -= MC[i][j]
    for (let k = 1; k <= d; k++) for (let i = 0; i < 2; i++) A[2 * k + i][2 * (k - 1) + i] = 1
    return spectralRadius(A)
  }

  it('審查的反例：ρ = 0、φ = 60°、μK_q = 1.5 ⇒ 模型 max|z| = 0.25（不變），兩個固定正交 code 是 √1.75 = 1.3229；燈號降為「注意」並說明', () => {
    const p: ThesisParams = { ...DEFAULT_PARAMS, B: 0, sigmaV: 100, mu: 1.5 / Kq, twoParam: true, rho: 0, phiDeg: 60 }
    const r = evaluateThesis(p)
    // 計算核心不變
    expect(r.maxRadius).toBeCloseTo(0.25, 12)
    expect(r.stable).toBe(true)
    // 對照值
    expect(r.crossAssumptionActive).toBe(true)
    expect(r.fixedToneRadius).toBeCloseTo(Math.sqrt(1.75), 12)
    expect(r.fixedToneRadius).toBeCloseTo(1.3228756555322954, 12)
    // 獨立建立 A = I − 1.5·[[cos60°, cos150°], [cos(−30°), cos60°]]
    const c = Math.cos(60 * D2R)
    const sn = Math.sin(60 * D2R)
    expect(spectralRadius([[1 - 1.5 * c, 1.5 * sn], [-1.5 * sn, 1 - 1.5 * c]])).toBeCloseTo(r.fixedToneRadius, 12)
    expect(bruteRadius(0, 60, 1.5, 0, false)).toBeCloseTo(r.fixedToneRadius, 12)
    // 燈號與文字：穩定 → 注意；variance / system 因 1 fs 預算本來就未通過（不改）
    const st = r.checks.find((k) => k.id === 'stability')!
    expect(st.state).toBe('warn')
    expect(st.reason).toContain(ASSUMPTION_TEX)
    expect(st.reason).toContain('1.323')
    expect(st.summary).toContain('1.323')
    expect(r.checks.find((k) => k.id === 'variance')?.state).toBe('fail')
    expect(r.checks.find((k) => k.id === 'system')?.state).toBe('fail')
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toContain('F-DB.6')
    expect(r.notes[0]).toContain(ASSUMPTION_TEX)
    for (const w of r.warnings) expect(r.checks.some((k) => k.reason === w)).toBe(true)
    // preconditioned：模型 0.25；固定同頻 code 的特徵值是 e^{±jθ}，與 ρ 無關
    for (const rho of [0, 0.5]) {
      const pc = evaluateThesis({ ...p, rho, update: 'precond' })
      expect(pc.maxRadius).toBeCloseTo(0.25, 12)
      expect(pc.fixedToneRadius).toBeCloseTo(Math.sqrt(1.75), 12)
      expect(pc.checks.find((k) => k.id === 'stability')?.state).toBe('warn')
    }
  })

  it('原本六個燈全綠的情況（φ = 50°）：穩定與 system-level 改成「注意」，其餘數字不變', () => {
    const p: ThesisParams = { ...DEFAULT_PARAMS, sigmaV: (10 * Math.sqrt(2 / Math.PI)) / 1.5, w0MinusA: -1, twoParam: true, rho: 0, phiDeg: 50 }
    const r = evaluateThesis(p)
    expect(r.checks.map((k) => k.state)).toEqual(['ok', 'ok', 'warn', 'ok', 'ok', 'warn'])
    expect(r.maxRadius).toBeCloseTo(0.0358185854701909, 12)
    expect(r.sigmaW).toBeCloseTo(0.15635032866386742, 12)
    expect(r.deltaW).toBeCloseTo(0.1 / Math.cos(50 * D2R), 12)
    expect(r.fixedToneRadius).toBeCloseTo(Math.sqrt(3.25 - 3 * Math.cos(50 * D2R)), 12)
    expect(r.fixedToneRadius).toBeCloseTo(1.149624795722666, 12)
    expect(r.notes).toHaveLength(1)
    expect(r.crossCheck.ok).toBe(true)
    expect(r.crossCheck.note).toContain('交叉相關假設')
    expect(r.checks[5].reason).toContain('在預算內')
    expect(r.checks[5].reason).toContain('這個結論對它們不適用')
    const pc = evaluateThesis({ ...p, update: 'precond', rho: 0.5 })
    expect(pc.checks.map((k) => k.state)).toEqual(['ok', 'ok', 'warn', 'ok', 'ok', 'warn'])
    expect(pc.fixedToneRadius).toBeCloseTo(1.149624795722666, 12)
    expect(pc.notes[0]).toContain(String.raw`$1-g'e^{\pm j\theta}$`)
  })

  it('兩種 code 都穩定（小步長）：燈號不變，只加註對照值 0.9507', () => {
    const p: ThesisParams = { ...DEFAULT_PARAMS, twoParam: true, rho: 0, phiDeg: 50 }
    const r = evaluateThesis(p)
    expect(r.checks.map((k) => k.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
    expect(r.maxRadius).toBeCloseTo(0.9487129690355732, 12)
    const gp = 10 * Kq
    expect(r.fixedToneRadius).toBeCloseTo(Math.sqrt(1 - 2 * gp * Math.cos(50 * D2R) + gp * gp), 12)
    expect(r.fixedToneRadius).toBeCloseTo(0.9506798282254769, 12)
    expect(check(p, 'stability').reason).toContain(ASSUMPTION_TEX)
    expect(check(p, 'stability').reason).toContain('0.9507')
    expect(r.notes).toHaveLength(1)
  })

  it('其他對照值：簡化模型不一定偏樂觀（ρ = 0.9、θ = 30° 時它反而保守）；失敗的原因不被改寫', () => {
    const mk = (rho: number, phiDeg: number, gp: number, d = 0): ThesisParams => ({ ...DEFAULT_PARAMS, B: 0, mu: gp / Kq, twoParam: true, rho, phiDeg, d })
    const a = evaluateThesis(mk(0.5, 60, 1.5))
    expect(a.maxRadius).toBeCloseTo(0.625, 12)
    expect(a.fixedToneRadius).toBeCloseTo(Math.sqrt(1.1875), 12) // 1.0897247359
    expect(a.checks[2].state).toBe('warn')
    const b = evaluateThesis(mk(0.9, 30, 1.0))
    expect(b.maxRadius).toBeCloseTo(0.9133974596, 9)
    expect(b.fixedToneRadius).toBeCloseTo(0.8823060736, 9) // 兩者都穩定，而且固定同頻 code 比較快
    expect(b.checks[2].state).toBe('warn') // 來自 PM = 34.64° < 45°，不是來自對照
    expect(b.checks[2].reason).toMatch(/PM/)
    expect(b.checks[2].reason).toContain(ASSUMPTION_TEX)
    expect(b.notes).toHaveLength(1)
    const c = evaluateThesis(mk(0.9, 30, 1.23))
    expect(c.maxRadius).toBeCloseTo(1.0239013686, 9) // 模型不穩定
    expect(c.fixedToneRadius).toBeCloseTo(0.9856589638, 9) // 固定同頻 code 反而穩定
    expect(c.checks[2].state).toBe('fail')
    expect(c.checks[2].reason).not.toContain(ASSUMPTION_TEX) // fail 的原因同時在 warnings，不後處理
    expect(c.warnings).toContain(c.checks[2].reason)
    expect(c.notes.some((n) => n.includes('F-DB.6'))).toBe(true)
    const d1 = evaluateThesis(mk(0, 60, 0.6, 1))
    expect(d1.maxRadius).toBeCloseTo(0.5477225575, 9)
    expect(d1.fixedToneRadius).toBeCloseTo(1.121526426, 9)
    const d2 = evaluateThesis(mk(0.3, 45, 0.3, 2))
    expect(d2.maxRadius).toBeCloseTo(0.7935456587, 9)
    expect(d2.fixedToneRadius).toBeCloseTo(0.9769918155, 9)
  })

  it('fixedToneRadius 的封閉式 = 2(d+1) 維 block companion 的 spectral radius（ρ、θ、g′、d、兩種更新矩陣的格點）；cos θ ≤ 0 時一定不收斂', () => {
    let n = 0
    for (const rho of [-0.6, 0, 0.3, 0.9])
      for (const theta of [0, 20, 45, 60, 80, 100, 150])
        for (const gp of [0.2, 0.75, 1.5])
          for (const d of [0, 1, 2, 3])
            for (const update of ['scalar', 'precond'] as const) {
              const got = fixedToneRadius({ ...DEFAULT_PARAMS, mu: gp / Kq, rho, phiDeg: theta, d, update })
              expect(got, `rho=${rho} theta=${theta} g'=${gp} d=${d} ${update}`).toBeCloseTo(bruteRadius(rho, theta, gp, d, update === 'precond'), 8)
              n++
            }
    expect(n).toBe(672)
    for (const theta of [90, 100, 135, 180])
      for (const rho of [-0.6, 0, 0.3, 0.9])
        for (const gp of [0.2, 0.75, 1.5])
          for (const d of [0, 1, 2, 3]) expect(fixedToneRadius({ ...DEFAULT_PARAMS, mu: gp / Kq, rho, phiDeg: theta, d, update: 'scalar' }), `theta=${theta}`).toBeGreaterThanOrEqual(1 - 1e-12)
  })

  it('正常對照：θ = 0°、單參數、|ρ| = 1、C ≤ 0、Ω = 0 都不加註，燈號與所有 preset 的判定不變', () => {
    // (a) θ = 0°：假設成立，函式與模型給同一個數
    const a: ThesisParams = { ...DEFAULT_PARAMS, B: 0, mu: 0.75 / Kq, twoParam: true, rho: 0.5, phiDeg: 0 }
    const ra = evaluateThesis(a)
    expect(ra.crossAssumptionActive).toBe(false)
    expect(Number.isNaN(ra.fixedToneRadius)).toBe(true)
    expect(ra.maxRadius).toBeCloseTo(0.625, 12)
    expect(fixedToneRadius(a)).toBeCloseTo(ra.maxRadius, 12)
    expect(ra.notes).toEqual([])
    expect(ra.checks[2]).toMatchObject({ state: 'ok', reason: String.raw`所有可辨識 mode 的特徵根都在單位圓內（$g^*=2$）。` })
    // (b) 用 code delay 把 θ 修回 0°（φ = −120°、Ω = π/6、D = 4）
    const rb = evaluateThesis({ ...a, phiDeg: -120, omega: Math.PI / 6, D: 4 })
    expect(rb.crossAssumptionActive).toBe(false)
    expect(rb.maxRadius).toBeCloseTo(0.625, 12)
    // (c) 所有內建 preset：不加註，失敗清單不變
    for (const preset of THESIS_PRESETS) {
      const r = evaluateThesis(presetParams(preset))
      expect(r.crossAssumptionActive, preset.id).toBe(false)
      expect(r.checks.filter((k) => k.state === 'fail').map((k) => k.id), preset.id).toEqual(preset.expectFail ?? [])
    }
    expect(evaluateThesis(presetParams(THESIS_PRESETS.find((x) => x.id === 'thesis-rho099')!)).maxRadius).toBeCloseTo(0.9992021154391971, 12)
    expect(evaluateThesis(presetParams(THESIS_PRESETS.find((x) => x.id === 'thesis-rho099-precond')!)).maxRadius).toBeCloseTo(0.9202115439197135, 12)
    // (d) 單參數、φ = 60°：沒有第二個 regressor，不加註
    const rd = evaluateThesis({ ...t13, phiDeg: 60 })
    expect(rd.crossAssumptionActive).toBe(false)
    expect(rd.notes).toEqual([])
    // (e) 有延遲、θ = 0°：函式與模型相同
    const e: ThesisParams = { ...DEFAULT_PARAMS, B: 0, mu: 0.3 / Kq, twoParam: true, rho: 0.3, phiDeg: 0, d: 2 }
    expect(fixedToneRadius(e)).toBeCloseTo(evaluateThesis(e).maxRadius, 12)
    expect(evaluateThesis(e).maxRadius).toBeCloseTo(0.8757904847032983, 9)
    // (f) |ρ| = 1、C < 0、Ω = 0：不啟動（各自另有判定或提醒）
    for (const patch of [{ rho: 1 }, { rho: -1 }, { phiDeg: 120 }, { omega: 0 }] as Partial<ThesisParams>[]) {
      const r = evaluateThesis({ ...a, phiDeg: 60, ...patch })
      expect(r.crossAssumptionActive, JSON.stringify(patch)).toBe(false)
      expect(r.notes.some((n) => n.includes('F-DB.6')), JSON.stringify(patch)).toBe(false)
    }
    // (g) 單參數的 T13 仍然沒有任何提醒
    expect(evaluateThesis(t13).notes).toEqual([])
  })
})

describe('六個條件之間的邏輯關係（不是互相獨立）', () => {
  const run = (patch: Partial<ThesisParams>) => evaluateThesis({ ...DEFAULT_PARAMS, ...patch })
  const states = (patch: Partial<ThesisParams>) => run(patch).checks.map((c) => c.state)

  it('反例（不是互相獨立）：極性錯了，穩定、variance、bias、system 一起失敗；再小的步長也救不回來', () => {
    const r = run({ phiDeg: 120 })
    expect(r.checks.map((c) => c.state)).toEqual(['ok', 'fail', 'fail', 'fail', 'fail', 'fail'])
    expect(r.polarity.C).toBeCloseTo(-0.5, 12)
    expect(r.g).toBeCloseTo(-0.039894228, 9)
    expect(r.maxRadius).toBeCloseTo(1.039894228, 9)
    const tiny = run({ phiDeg: 120, mu: 1e-3 })
    expect(tiny.maxRadius).toBeCloseTo(1.0000039894, 9)
    expect(tiny.maxRadius).toBeGreaterThan(1)
    expect(tiny.checks[2].state).toBe('fail')
    expect(run({ phiDeg: 120, d: 3 }).maxRadius).toBeCloseTo(1.035889677, 9)
    const zero = run({ phiDeg: 90 })
    expect(zero.polarity.C).toBe(0)
    expect(zero.checks[2].state).toBe('fail') // max|z| = 1 不是 < 1
  })

  it('格點掃描（1300 組）：穩定沒有失敗 ⇒ 極性沒有失敗且 C > 0；極性失敗 ⇒ 後面四項都失敗', () => {
    const variants: Partial<ThesisParams>[] = [
      {},
      { twoParam: true, rho: 0.5, update: 'scalar' },
      { twoParam: true, rho: 0.99, update: 'scalar' },
      { twoParam: true, rho: 0.5, update: 'precond' },
      { twoParam: true, rho: -0.5, update: 'scalar' },
    ]
    let stableCount = 0
    let polFail = 0
    let total = 0
    for (let phiDeg = -180; phiDeg <= 180; phiDeg += 30)
      for (const mu of [1e-3, 1, 10, 100, 1e4])
        for (const d of [0, 1, 2, 3])
          for (const v of variants) {
            total++
            const r = run({ phiDeg, mu, d, ...v })
            const [, pol, stab, vari, bias, sys] = r.checks.map((c) => c.state)
            const tag = JSON.stringify({ phiDeg, mu, d, ...v })
            if (stab !== 'fail') {
              stableCount++
              expect(pol, tag).not.toBe('fail')
              expect(r.polarity.C, tag).toBeGreaterThan(0)
            }
            if (pol === 'fail') {
              polFail++
              expect([stab, vari, bias, sys], tag).toEqual(['fail', 'fail', 'fail', 'fail'])
            }
          }
    expect(total).toBe(1300)
    // 兩個方向都不是空命題
    expect(stableCount).toBe(353)
    expect(polFail).toBe(800)
  })

  it('正常對照：預設值六項全過（C = 1、g = 0.0798、max|z| = 0.9202、σ_w = 0.3992 fs、σ_δt = 0.4115 fs）', () => {
    const r = run({})
    expect(r.checks.map((c) => c.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
    expect(r.polarity.C).toBe(1)
    expect(r.g).toBeCloseTo(0.0797884561, 9)
    expect(r.maxRadius).toBeCloseTo(0.9202115439, 9)
    expect(r.sigmaW).toBeCloseTo(0.399186143, 9)
    expect(r.sigmaDt).toBeCloseTo(0.4115210526, 9)
  })

  it('真正成立的是單向的敘述：前 k 個過關不保證第 k+1 個（每一步各一個例子）', () => {
    expect(states({ phiDeg: 120 }).slice(0, 2)).toEqual(['ok', 'fail'])
    const k2 = run({ mu: 100, d: 2 })
    expect(k2.checks.slice(0, 3).map((c) => c.state)).toEqual(['ok', 'ok', 'fail'])
    expect(k2.g).toBeCloseTo(0.7978845608, 9)
    expect(k2.gStar).toBeCloseTo(0.6180339887, 9)
    expect(k2.maxRadius).toBeCloseTo(1.0772148807, 9)
    const k3 = run({ B: 0, jitterBudget: 0.3 })
    expect(k3.checks.slice(0, 4).map((c) => c.state)).toEqual(['ok', 'ok', 'ok', 'fail'])
    expect(k3.sigmaW).toBeGreaterThan(0.3)
    const k4 = run({ B: 1.5 })
    expect(k4.checks.slice(0, 5).map((c) => c.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'fail'])
    expect(k4.deltaW).toBeCloseTo(1.5, 12)
    const k5 = run({ B: 0.9, jitterBudget: 0.95 })
    expect(k5.checks.slice(0, 5).every((c) => c.state !== 'fail')).toBe(true)
    expect(k5.checks[5].state).toBe('fail')
    expect(k5.sigmaDt).toBeCloseTo(0.9845555224, 9)
  })

  it('也不是全序或等價：極性對不保證穩定；bias 過不保證 variance 過；雙參數時 system 過不保證 variance 過', () => {
    // (a) 單參數：system 沒有失敗時，其他五項也都沒有失敗
    let passing = 0
    for (const B of [0, 0.1, 0.9, 1.5])
      for (const jitterBudget of [0.3, 0.95, 1]) {
        const st = states({ B, jitterBudget })
        if (st[5] !== 'fail') {
          passing++
          expect(st.slice(0, 5).every((x) => x !== 'fail'), `B=${B} budget=${jitterBudget}`).toBe(true)
        }
      }
    expect(passing).toBe(5)
    // (b) variance 失敗、bias 通過
    const b = states({ B: 0, jitterBudget: 0.3 })
    expect([b[3], b[4]]).toEqual(['fail', 'ok'])
    // (c) 雙參數 preconditioner：variance 失敗、system 通過
    const c = evaluateThesis(presetParams(THESIS_PRESETS.find((x) => x.id === 'thesis-rho099-precond')!)).checks.map((k) => k.state)
    expect([c[3], c[5]]).toEqual(['fail', 'ok'])
    // (d) 極性通過、穩定失敗
    const d = states({ mu: 100, d: 2 })
    expect([d[1], d[2]]).toEqual(['ok', 'fail'])
  })
})

describe('R14：條件 6 是「在預算內」，不是「比校正前好」，σ_δt 也不是輸出 jitter', () => {
  const sysOf = (p: ThesisParams) => evaluateThesis(p).checks.find((c) => c.id === 'system')!

  it('審查的反例：gain 本來就正確（B = 0、w_0 = a）⇒ 開著追蹤反而多出 0.3992 fs，仍然「在預算內」；文字不得說改善', () => {
    const p: ThesisParams = { ...DEFAULT_PARAMS, B: 0, w0MinusA: 0 }
    const r = evaluateThesis(p)
    expect(r.sigmaDtRand).toBeCloseTo(0.39918614299, 10)
    expect(r.sigmaDt).toBeCloseTo(0.39918614299, 10)
    expect(r.sigmaDtDet).toBe(0)
    expect(r.spurDbc).toBe(-Infinity)
    const before = Math.sqrt(p.Px) * Math.abs(p.w0MinusA) // 不校正（gain 凍結在 w_0）時的 gain-error timing
    expect(before).toBe(0)
    expect(r.sigmaDt).toBeGreaterThan(before)
    expect(r.checks.every((c) => c.state === 'ok')).toBe(true)
    const sys = sysOf(p)
    expect(sys.reason).toMatch(/在預算內/)
    expect(sys.reason).toMatch(/DTC-referred/)
    expect(sys.reason).not.toMatch(/改善|變好/)
  })

  it('正常對照：預設值（B = 0.1 fs、w_0 − a = −5 fs）⇒ 0.4115 fs、−104.77 dBc，通過', () => {
    const r = evaluateThesis(DEFAULT_PARAMS)
    expect(r.sigmaDt).toBeCloseTo(0.41152105263, 10)
    expect(r.spurDbc).toBeCloseTo(-104.7678, 3)
    expect(Math.sqrt(DEFAULT_PARAMS.Px) * Math.abs(DEFAULT_PARAMS.w0MinusA)).toBeGreaterThan(r.sigmaDt)
    expect(sysOf(DEFAULT_PARAMS).state).toBe('ok')
  })

  it('是和預算比、不是校正前後的比較：判定完全不看初始誤差 w_0 − a', () => {
    const ref = sysOf(DEFAULT_PARAMS)
    for (const w0MinusA of [0, -0.1, -5, 5, -500, 500]) expect(sysOf({ ...DEFAULT_PARAMS, w0MinusA })).toEqual(ref)
  })

  it('σ_δt 是 DTC-referred：|T| 只進入 spur（|T| 由 1 改成 0.01，σ_δt 不變、spur 降 40 dB）', () => {
    const a = evaluateThesis(DEFAULT_PARAMS)
    const b = evaluateThesis({ ...DEFAULT_PARAMS, Tmag: 0.01 })
    expect(b.sigmaDt).toBe(a.sigmaDt)
    expect(a.sigmaDt).toBeCloseTo(0.41152105262789923, 14)
    expect(b.spurDbc - a.spurDbc).toBeCloseTo(-40, 9)
  })

  it('前面的條件失敗時：說明沒有穩態的量可以和預算比，不說「談不上改善」', () => {
    const sys = sysOf({ ...DEFAULT_PARAMS, phiDeg: 180 })
    expect(sys.state).toBe('fail')
    expect(sys.reason).not.toMatch(/改善/)
    expect(sys.reason).toContain('沒有穩態的')
    expect(mathTextProblems(sys.reason)).toEqual([])
  })

  it('卡片上的封閉式只適用單參數：雙參數（ρ = 0）時 random 部分是兩個 mode 的總和（√2 倍）', () => {
    const two = evaluateThesis({ ...DEFAULT_PARAMS, twoParam: true, rho: 0 })
    expect(two.sigmaDtRand).toBeCloseTo(Math.SQRT2 * 0.39918614299092875, 10) // 0.5645344573
    expect(two.sigmaDt).toBeCloseTo(0.5733229051, 9)
    expect(two.sigmaDt).toBeGreaterThan(Math.sqrt(DEFAULT_PARAMS.Px * (two.deltaW ** 2 + two.sigmaW ** 2))) // 0.4115210526
  })
})

describe('R07：弱 / 強方向依 λ̃ 的大小決定，不是固定的 mode 順序（ρ < 0 時對調）', () => {
  it('preconditioner：σ_ξ,weak / σ_ξ,strong = √κ，ρ 的正負號不影響；固定用 modes[1] / modes[0] 在 ρ < 0 時會得到 1/√κ', () => {
    for (const rho of [0.5, -0.5, 0.99, -0.99]) {
      const r = evaluateThesis({ ...t13, twoParam: true, rho, update: 'precond' })
      const kappa = (1 + Math.abs(rho)) / (1 - Math.abs(rho))
      expect(r.kappa, `rho=${rho}`).toBeCloseTo(kappa, 9)
      const ws = weakStrongModes(r.modes)!
      expect(ws.weak.lam, `rho=${rho}`).toBeCloseTo(1 - Math.abs(rho), 14)
      expect(ws.strong.lam, `rho=${rho}`).toBeCloseTo(1 + Math.abs(rho), 14)
      // 弱方向：ρ > 0 時是 (1, −1)/√2（第二個 mode），ρ < 0 時是 (1, 1)/√2（第一個）
      expect([ws.weakIndex, ws.strongIndex], `rho=${rho}`).toEqual(rho > 0 ? [1, 0] : [0, 1])
      const ratio = Math.sqrt(ws.weak.variance / ws.strong.variance)
      expect(ratio, `rho=${rho}`).toBeCloseTo(Math.sqrt(kappa), 9)
      // 舊寫法（固定的 −/+ 配對）
      const fixedPairing = Math.sqrt(r.modes[1].variance / r.modes[0].variance)
      expect(fixedPairing, `rho=${rho}`).toBeCloseTo(rho > 0 ? Math.sqrt(kappa) : 1 / Math.sqrt(kappa), 9)
    }
    // 審查者實測的數字：ρ = −0.5 ⇒ √κ = √3 = 1.732（舊寫法顯示 0.5774）；ρ = −0.99 ⇒ √199 = 14.11（舊寫法 0.07089）
    const half = evaluateThesis({ ...t13, twoParam: true, rho: -0.5, update: 'precond' })
    const wsHalf = weakStrongModes(half.modes)!
    expect(Math.sqrt(wsHalf.weak.variance / wsHalf.strong.variance)).toBeCloseTo(1.7320508076, 9)
    expect(Math.sqrt(half.modes[1].variance / half.modes[0].variance)).toBeCloseTo(0.5773502692, 9)
    const near = evaluateThesis({ ...t13, twoParam: true, rho: -0.99, update: 'precond' })
    const wsNear = weakStrongModes(near.modes)!
    expect(Math.sqrt(wsNear.weak.variance / wsNear.strong.variance)).toBeCloseTo(14.1067359797, 8)
    expect(Math.sqrt(near.modes[1].variance / near.modes[0].variance)).toBeCloseTo(0.0708881205, 9)
  })

  it('一般 LMS、小步長：兩個方向的雜訊相近，比值 √((2 − g·λ̃_max)/(2 − g·λ̃_min))，ρ → −ρ 不變', () => {
    const g = evaluateThesis(t13).g
    const expected = Math.sqrt((2 - g * 1.5) / (2 - g * 0.5)) // 0.9794
    expect(expected).toBeCloseTo(0.9794359, 6)
    for (const rho of [0.5, -0.5]) {
      const r = evaluateThesis({ ...t13, twoParam: true, rho })
      const ws = weakStrongModes(r.modes)!
      expect(Math.sqrt(ws.weak.variance / ws.strong.variance), `rho=${rho}`).toBeCloseTo(expected, 9)
    }
  })

  it('邊界：ρ = 0 時沒有強弱之分（比值 1）；ρ = ±1 或單參數時不到兩個可辨識的 mode ⇒ undefined', () => {
    const flat = evaluateThesis({ ...t13, twoParam: true, rho: 0, update: 'precond' })
    const ws = weakStrongModes(flat.modes)!
    expect([ws.weakIndex, ws.strongIndex]).toEqual([1, 0])
    expect(ws.weak.variance / ws.strong.variance).toBe(1)
    expect(weakStrongModes(evaluateThesis({ ...t13, twoParam: true, rho: 1 }).modes)).toBeUndefined()
    expect(weakStrongModes(evaluateThesis({ ...t13, twoParam: true, rho: -1 }).modes)).toBeUndefined()
    expect(weakStrongModes(evaluateThesis(t13).modes)).toBeUndefined()
  })
})

describe('R01：條件 5 的線性化指標要跟著 1/C 放大（C 越小，同樣的 B 需要越大的 Δw）', () => {
  const biasOf = (p: ThesisParams) => evaluateThesis(p).checks.find((c) => c.id === 'bias')!

  it('審查的反例：φ = 85°（C = 0.0872）、B = 0.25σ_v ⇒ gain 殘差的 RMS 是 2.87σ_v（peak 4.06σ_v），要亮「注意」', () => {
    const p: ThesisParams = { ...t13, phiDeg: 85, B: 25, jitterBudget: 1000 } // 預算放大到不會先因為 Δw 超出而失敗
    const r = evaluateThesis(p)
    const c = Math.cos((85 * Math.PI) / 180)
    expect(r.polarity.C).toBeCloseTo(0.0871557427, 9)
    expect(r.deltaW).toBeCloseTo(25 / c, 9) // 286.84 fs
    // 獨立重算：|Δw|·|H|·√P_x/σ_v，與 |B|/(√P_x σ_v |cos θ|) 相同
    expect(r.linearityBias).toBeCloseTo((Math.abs(r.deltaW) * p.Hmag * Math.sqrt(p.Px)) / p.sigmaV, 12)
    expect(r.linearityBias).toBeCloseTo(0.25 / c, 12)
    expect(r.linearityBias).toBeCloseTo(2.8684284, 6)
    expect(Math.SQRT2 * r.linearityBias).toBeCloseTo(4.0566, 3) // 單頻：peak = √2 × RMS
    // 沒有隨 1/C 放大的舊指標 |B|/(√P_x σ_v) = 0.25 ≤ 0.3，不會亮燈
    expect(Math.abs(p.B) / (Math.sqrt(p.Px) * p.sigmaV)).toBe(0.25)
    const bias = biasOf(p)
    expect(bias.state).toBe('warn')
    expect(bias.reason).toContain(String.raw`|B|/(\sqrt{P_x}\,\sigma_v\,|\cos\theta|)=2.868>0.3`)
    expect(bias.reason).toContain('線性化的值')
    expect(bias.reason).toContain('Ch11 §11.4')
    expect(mathTextProblems(bias.reason)).toEqual([])
  })

  it('θ = 0° 時和原來的 |B|/(√P_x σ_v) 相同；|H| 不影響（Δw ∝ 1/|H|，殘差 Δw·u ∝ |H|）；P_x 以 1/√P_x 進入', () => {
    expect(evaluateThesis({ ...t13, B: 40 }).linearityBias).toBe(0.4)
    expect(evaluateThesis({ ...t13, B: -40 }).linearityBias).toBe(0.4)
    const a = evaluateThesis({ ...t13, phiDeg: 85, B: 25 })
    const b = evaluateThesis({ ...t13, phiDeg: 85, B: 25, Hmag: 0.5 })
    expect(b.linearityBias).toBeCloseTo(a.linearityBias, 12)
    expect((Math.abs(b.deltaW) * 0.5) / 100).toBeCloseTo(a.linearityBias, 9)
    const half = evaluateThesis({ ...t13, phiDeg: 85, B: 25, Px: 0.5 })
    expect(half.linearityBias).toBeCloseTo(a.linearityBias * Math.SQRT2, 12)
    expect((Math.abs(half.deltaW) * Math.sqrt(0.5)) / 100).toBeCloseTo(half.linearityBias, 9)
    // C = 0：沒有固定點，指標為 ∞（條件 5 另有「沒有固定點」的判定）
    expect(evaluateThesis({ ...t13, phiDeg: 90, B: 1 }).linearityBias).toBe(Infinity)
  })

  it('判定：超過 0.3 才亮「注意」；剛好等於 0.3（含 cos θ 的浮點誤差）算在門檻內；內建 preset 的燈號不變', () => {
    expect(biasOf({ ...t13, B: 30, jitterBudget: 100 }).state).toBe('ok') // 30/100 = 0.3
    expect(biasOf({ ...t13, B: 31, jitterBudget: 100 }).state).toBe('warn')
    // θ = −60°（φ = −90°、Ω = π/6、D = 1）：cos θ 算出來是 0.49999999999999994，15/(100·cos θ) 會是 0.30000000000000004
    const dust: ThesisParams = { ...t13, phiDeg: -90, D: 1, B: 15, jitterBudget: 100 }
    expect(evaluateThesis(dust).linearityBias).toBeCloseTo(0.3, 12)
    expect(biasOf(dust).state).toBe('ok')
    expect(biasOf({ ...dust, B: 16 }).state).toBe('warn') // 16/(100 × 0.5) = 0.32
    // preset 的 σ_v = 100 fs、B ≤ 1.5 fs：指標最大 0.1/cos 85° ≈ 0.0115，遠低於門檻
    for (const preset of THESIS_PRESETS) {
      const r = evaluateThesis(presetParams(preset))
      if (Number.isFinite(r.linearityBias)) expect(r.linearityBias, preset.id).toBeLessThan(0.02)
      const failed = r.checks.filter((c) => c.state === 'fail').map((c) => c.id)
      expect(failed, preset.id).toEqual(preset.expectFail ?? [])
    }
  })
})

describe('門檻上的浮點誤差：剛好落在門檻的值不因 cos / asin 的最後一位而改變燈號', () => {
  const polOf = (p: ThesisParams) => evaluateThesis(p).checks.find((c) => c.id === 'polarity')!

  it('顯示的 θ 不帶浮點殘渣：φ + ΩD 剛好是 0°、±60°、120°、180° 時就是這些數字（不是 −2.5e−14° 或 119.99999999999999°）', () => {
    const th = (phiDeg: number, D: number) => polarityOf({ Px: 1, Hmag: 1, phiDeg, omega: Math.PI / 6, D }).thetaDeg
    // 不四捨五入時：−150° + 5 × 30° 算出 −2.5e−14°，60° + 10 × 30° 折返後是 −5.7e−14°
    expect(((-150 * Math.PI) / 180 + (Math.PI / 6) * 5) * (180 / Math.PI)).not.toBe(0)
    expect(th(-150, 5)).toBe(0)
    expect(th(60, 10)).toBe(0)
    expect(th(-120, 4)).toBe(0)
    expect(th(120, 0)).toBe(120)
    expect(th(120, 6)).toBe(-60)
    expect(th(120, 2)).toBe(180)
    expect(th(-180, 0)).toBe(180) // 折返到 (−180°, 180°]
    expect(th(37.3, 0)).toBeCloseTo(37.3, 9)
    // C 與裕度不受影響：仍由 cos θ 計算
    const p = polarityOf({ Px: 1, Hmag: 1, phiDeg: -150, omega: Math.PI / 6, D: 5 })
    expect(p.cosTheta).toBe(1)
    expect(p.C).toBe(1)
    expect(p.marginDeg).toBe(90)
  })

  it('極性裕度剛好 30°：φ = 60°（算出 30.00000000000001°）與 θ = −60°（算出 29.999999999999993°）都是通過；30° 以下才亮「注意」', () => {
    const viaDelay = polarityOf({ Px: 1, Hmag: 1, phiDeg: -90, omega: Math.PI / 6, D: 1 })
    expect(viaDelay.marginDeg).toBeLessThan(30) // 浮點：比 30 小一點點
    expect(viaDelay.marginDeg).toBeCloseTo(30, 12)
    expect(polarityOf({ Px: 1, Hmag: 1, phiDeg: 60, omega: Math.PI / 6, D: 0 }).marginDeg).toBeGreaterThanOrEqual(30)
    expect(polOf({ ...t13, phiDeg: 60 }).state).toBe('ok')
    expect(polOf({ ...t13, phiDeg: -60 }).state).toBe('ok')
    expect(polOf({ ...t13, phiDeg: -90, D: 1 }).state).toBe('ok')
    expect(polOf({ ...t13, phiDeg: 120, D: 6 }).state).toBe('ok') // θ = 300° ≡ −60°
    // 真的小於 30° 的才亮「注意」，說明裡不會出現「30° < 30°」
    for (const p of [{ ...t13, phiDeg: 60.1 }, { ...t13, phiDeg: -90.1, D: 1 }, { ...t13, phiDeg: 75 }]) {
      const c = polOf(p)
      expect(c.state, JSON.stringify(p.phiDeg)).toBe('warn')
      expect(c.reason).not.toContain(String.raw`=30^\circ<30^\circ`)
    }
  })
})

