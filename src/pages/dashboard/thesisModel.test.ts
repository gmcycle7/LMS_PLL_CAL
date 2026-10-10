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
  spectralRadiusOf,
  suggestHorizon,
  trajectory,
  type ThesisParams,
} from './thesisModel'
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

  it('variance 與 bias 各自過關、合起來超出預算 ⇒ system-level 失敗（獨立條件）', () => {
    // σ_rand ≈ 0.399 fs、σ_det = 0.9 fs，預算 0.95 fs
    const r = evaluateThesis({ ...t13, B: 0.9, jitterBudget: 0.95 })
    expect(r.checks.find((c) => c.id === 'variance')?.state).toBe('ok')
    expect(r.checks.find((c) => c.id === 'bias')?.state).not.toBe('fail')
    const sys = r.checks.find((c) => c.id === 'system')
    expect(sys?.state).toBe('fail')
    expect(sys?.reason).toMatch(/獨立的條件/)
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
    expect(r.notes.join('')).toContain(String.raw`$|w_0-a|\sqrt{P_x}/\sigma_v=0.6>0.3$`)
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
