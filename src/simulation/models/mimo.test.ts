import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng, eigSym, erf, inv, matMul, matScale, normFro, svd } from '@/simulation/core'
import {
  DEFAULT_RULE,
  analyzeMimo,
  analyzeRule,
  blockUpdate,
  buildPlant,
  buildUpdateMatrix,
  centralDiffJacobian,
  corrMatrix,
  dlyap,
  fdTruncationFactor,
  gmacSample,
  inspectMatrix,
  kqFromSigma,
  mFull,
  mRegularized,
  meanFieldTrajectory,
  modeVarianceClosed,
  preconditionedModeVar,
  propagateLinearMoments,
  resolveJhat,
  runMimoCovarianceMc,
  runMimoTrajectories,
  signGmacMean,
  stepsToDecay,
  stepsToDecayReal,
  tradeoffSweep,
  type Mat,
  type RuleConfig,
} from './mimo'
import { createZigguratNormal } from './blockLms'

interface Tol {
  abs?: number
  rel?: number
}
interface GoldenVector {
  id: string
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: Tol
  tolerance_overrides?: Record<string, Tol>
}
const load = (name: string): GoldenVector =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector

/** numpy.isclose 規則：|a − e| ≤ abs + rel·|e|（逐元素） */
function expectGolden(v: GoldenVector, key: string, actual: unknown) {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const exp = v.expected[key]
  const cmp = (a: unknown, e: unknown, path: string) => {
    if (Array.isArray(e)) {
      expect(Array.isArray(a), `${path} 應為陣列`).toBe(true)
      ;(e as unknown[]).forEach((ei, i) => cmp((a as unknown[])[i], ei, `${path}[${i}]`))
      return
    }
    const an = a as number
    const en = e as number
    const lim = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(en)
    expect(Math.abs(an - en), `${v.id}.${path}: actual ${an} vs expected ${en}`).toBeLessThanOrEqual(lim)
  }
  cmp(actual, exp, key)
}

const rule = (r: Partial<RuleConfig>): RuleConfig => ({ ...DEFAULT_RULE, ...r })
const R099 = corrMatrix(2, 0.99)
const KQ100 = kqFromSigma(100)
/** 讓 K_q = 1 fs⁻¹ 的 σ_v（「K_q 正規化為 1」，勘誤 E05/E08） */
const SIGMA_KQ1 = Math.sqrt(2 / Math.PI)

describe('mimo：T18 Jacobian 反例（§10.2）', () => {
  const v = load('T18')
  const J = v.inputs.J as Mat
  const plantJ = buildPlant({ mode: 'J', Jn: J, sigmaV: SIGMA_KQ1, N: 4096 })

  it('T18: J=[[−1,2],[2,−1]]、M=0.2I ⇒ A=I+MJ=[[0.8,0.4],[0.4,0.8]]，eig 1.2 / 0.4（golden）', () => {
    expect(plantJ.Kq).toBeCloseTo(1, 14)
    const an = analyzeRule(plantJ, rule({ rule: 'scalar', muKq: 0.2 }), J)
    expect(an.ok).toBe(true)
    expectGolden(v, 'A', an.A)
    const eig = an.poles.map((z) => z.re).sort((a, b) => b - a)
    expectGolden(v, 'eig_A_desc', eig)
    an.poles.forEach((z) => expect(Math.abs(z.im)).toBeLessThan(1e-14))
    expectGolden(v, 'spectral_radius', an.spectralRadius)
    expect(an.stable).toBe(false)
    expect(an.blocks95).toBeNull()
    expect(an.warnings.join(' ')).toMatch(/每個 loop 單獨穩定不代表 MIMO 一起穩定/)
  })

  it('T18: eig(J) = +1, −3；每個 loop 單獨的 pole = 1 + 0.2·J_ii = 0.8（golden）', () => {
    const ins = inspectMatrix(J)
    expect(ins.symmetric).toBe(true)
    expectGolden(v, 'eig_J_desc', ins.eigSym!.values)
    expectGolden(v, 'single_loop_poles', J.map((row, i) => 1 + 0.2 * row[i]))
    // diagonal 規則（各 loop 調成 pole 0.8）與 scalar 0.2 完全相同 ⇒ Gallery #12：對角斜率正確仍發散
    const diag = analyzeRule(plantJ, rule({ rule: 'diagonal', gamma: 0.2 }), J)
    expect(diag.Mn).toEqual([
      [0.2, 0],
      [0, 0.2],
    ])
    expect(diag.spectralRadius).toBeCloseTo(1.2, 12)
  })

  it('T18: regularized pinv M=−γ(JᵀJ+λ_reg I)⁻¹Jᵀ ⇒ p_i = 1 − γσ_i²/(σ_i²+λ_reg) = 0.5455 / 0.5055（golden）', () => {
    const gamma = v.inputs.reg_gamma as number
    const lambdaReg = v.inputs.reg_lambda as number
    const an = analyzeRule(plantJ, rule({ rule: 'regularized', regForm: 'J', gamma, lambdaReg }), J)
    expect(an.stable).toBe(true)
    const eig = an.poles.map((z) => z.re).sort((a, b) => b - a)
    expectGolden(v, 'reg_poles_desc', eig)
    expectGolden(v, 'reg_poles_desc', an.closedPoles!.slice().sort((a, b) => b - a))
    expect(svd(J).S[0]).toBeCloseTo(3, 12)
    expect(svd(J).S[1]).toBeCloseTo(1, 12)
  })

  it('T18: 時域遞迴沿 [1,1]/√2 以 1.2^k 成長（線性引擎、σ→0 等效於 mean recursion）', () => {
    const mom = propagateLinearMoments(plantJ, rule({ rule: 'scalar', muKq: 0.2 }), J, [1, 1], 20)!
    for (let k = 0; k <= 20; k++) expect(mom.mean[0][k]).toBeCloseTo(Math.pow(1.2, k), 9)
    // 差模 [1,−1] 以 0.4^k 衰減
    const mom2 = propagateLinearMoments(plantJ, rule({ rule: 'scalar', muKq: 0.2 }), J, [1, -1], 10)!
    expect(mom2.mean[0][10]).toBeCloseTo(Math.pow(0.4, 10), 12)
  })

  it('T18: 完整反矩陣 M = −γJ⁻¹ 讓所有 pole = 1 − γ（修正共模極性）', () => {
    const an = analyzeRule(plantJ, rule({ rule: 'full', gamma: 0.5 }), J)
    an.poles.forEach((z) => expect(z.re).toBeCloseTo(0.5, 12))
    expect(an.closedPoles).toEqual([0.5, 0.5])
  })

  it('T18: 負面—sample 引擎（真正 1-bit）同樣發散，但因 |G| 有界而線性漂移', () => {
    const res = runMimoTrajectories({
      plant: { mode: 'J', Jn: J, sigmaV: 100, N: 256 },
      cases: [rule({ rule: 'scalar', muKq: 0.2 }), rule({ rule: 'full', gamma: 0.5 })],
      delta0: [5, 5],
      blocks: 300,
      engine: 'sample',
      jhat: { source: 'exact' },
      seed: 7,
    })
    expect(res.ok).toBe(true)
    const [sc, full] = res.cases
    const last = sc.norm[300]
    expect(last).toBeGreaterThan(50 * 5) // 共模持續成長
    // 線性漂移：後段每 block 增量近似常數（不是指數）
    const inc1 = sc.norm[200] - sc.norm[150]
    const inc2 = sc.norm[300] - sc.norm[250]
    expect(inc2 / inc1).toBeGreaterThan(0.7)
    expect(inc2 / inc1).toBeLessThan(1.4)
    expect(full.norm[300]).toBeLessThan(20)
  })

  it('T18: 中央差分在線性 plant 上精確還原 J（golden 的 finite_difference 對應）', () => {
    const Jp = centralDiffJacobian((d) => J.map((row) => -(row[0] * d[0] + row[1] * d[1])), [0.3, -0.2], 0.01)
    // G = J(w − w*) = −J δ
    expect(normFro(Jp.map((r, i) => r.map((x, j) => x - J[i][j])))).toBeLessThan(1e-12)
  })
})

describe('mimo：T10 / T11 重用（§9–§10.1 的 R(ρ=.99) 例子）', () => {
  it('T10: R=[[1,.99],[.99,1]] ⇒ eigenvalues 1.99 / 0.01、cond 199、eigenvectors（golden，經 inspectMatrix）', () => {
    const v = load('T10')
    const ins = inspectMatrix(v.inputs.R as Mat)
    expectGolden(v, 'eig_max', ins.eigSym!.values[0])
    expectGolden(v, 'eig_min', ins.eigSym!.values[1])
    expectGolden(v, 'cond', ins.cond)
    const V = ins.eigSym!.vectors
    expectGolden(v, 'eigvec_max', [V[0][0], V[1][0]])
    // golden 正規化：第一個非零分量為正
    const vmin = V[0][1] < 0 ? [-V[0][1], -V[1][1]] : [V[0][1], V[1][1]]
    expectGolden(v, 'eigvec_min', vmin)
    expect(ins.positiveDefinite).toBe(true)
  })

  it('T10: 負面—ρ=1（缺乏 PE）⇒ eig [2, 0]、完整 preconditioner 拒絕並解釋「不可辨識」', () => {
    const v = load('T10')
    const R1 = corrMatrix(2, v.inputs.rho_missing_pe as number)
    expectGolden(v, 'missing_pe_eig_list', eigSym(R1).values)
    const plant = buildPlant({ mode: 'R', R: R1, sigmaV: 100, N: 4096 })
    expect(plant.errors).toEqual([])
    expect(plant.warnings.join(' ')).toMatch(/不可辨識/)
    const full = analyzeRule(plant, rule({ rule: 'full' }), plant.Jn)
    expect(full.ok).toBe(false)
    expect(full.error).toMatch(/不可辨識/)
    expect(full.error).toMatch(/不能製造缺失的資訊/)
    // regularized 仍可運作；但 null 方向 [1,−1] 的 pole = 1（永遠不動）
    const reg = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'R', lambdaReg: 0.1 }), plant.Jn)
    expect(reg.ok).toBe(true)
    expect(Math.max(...reg.poles.map((z) => z.re))).toBeCloseTo(1, 12)
    expect(reg.stable).toBe(false)
  })

  it('T11: μK_q = 0.5 ⇒ 慢 pole 0.995、598 blocks；M=0.5R⁻¹ ⇒ pole 0.5、5 blocks，M ≈ [[25.13,−24.87],…]（golden，K_q 正規化為 1）', () => {
    const v = load('T11')
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
    const sc = analyzeRule(plant, rule({ rule: 'scalar', muKq: v.inputs.mu as number }), plant.Jn)
    expectGolden(v, 'slow_pole', sc.closedPoles![1])
    expectGolden(v, 'fast_pole', sc.closedPoles![0])
    expectGolden(v, 'blocks_95', sc.blocks95)
    expectGolden(v, 'blocks_95_real', stepsToDecayReal(0.995))
    const full = analyzeRule(plant, rule({ rule: 'full', gamma: 0.5 }), plant.Jn)
    expectGolden(v, 'preconditioned_pole', full.spectralRadius)
    expectGolden(v, 'preconditioned_blocks_95', full.blocks95)
    expectGolden(v, 'preconditioner_M', full.Mn)
    // K_q = 1 ⇒ 實體 M = M_n
    expectGolden(v, 'preconditioner_M', full.Mphys)
  })
})

describe('mimo：勘誤 E05 / E08 / E21 / E22 / E24 / E37 的數值', () => {
  it('E05/E08：K_q = 0.00797885 fs⁻¹、μ = 0.5 fs ⇒ 慢 pole 0.99996011、75,091 blocks；誤用 M=0.5R⁻¹ ⇒ 0.99601、750 blocks', () => {
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: 100, N: 4096 })
    expect(plant.Kq).toBeCloseTo(0.007978845608028654, 15)
    const sc = analyzeRule(plant, rule({ rule: 'scalar', muKq: 0.5 * plant.Kq }), plant.Jn)
    expect(sc.spectralRadius).toBeCloseTo(0.99996011, 8)
    expect(sc.blocks95).toBe(75091)
    // 忘記 K_q：M = 0.5 R⁻¹（fs）⇒ M_n = K_q·0.5R⁻¹
    const Mn = matScale(inv(R099), 0.5 * plant.Kq)
    const A = Mn.map((r, i) => r.map((_, j) => (i === j ? 1 : 0) - (matMul(Mn, R099)[i][j])))
    const rho = Math.max(...eigSym(A).values.map(Math.abs))
    expect(rho).toBeCloseTo(1 - 0.5 * plant.Kq, 12)
    expect(rho).toBeCloseTo(0.99601, 5)
    expect(stepsToDecay(rho)).toBe(750)
    // 正確的 γ(K_qR)⁻¹ 與 K_q 無關：pole 0.5
    const full = analyzeRule(plant, rule({ rule: 'full', gamma: 0.5 }), plant.Jn)
    expect(full.spectralRadius).toBeCloseTo(0.5, 12)
    expect(full.Mphys![0][0]).toBeCloseTo(25.12562814070348 / plant.Kq, 6)
  })

  it('E21：R⁻¹ ≈ [[50.25,−49.75],…]；eig(0.5R⁻¹) = 50、0.2513；慢模式變異放大 133 倍、trace 44.8 倍', () => {
    const Ri = inv(R099)
    expect(Ri[0][0]).toBeCloseTo(50.2512563, 6)
    expect(Ri[0][1]).toBeCloseTo(-49.7487437, 6)
    const ev = eigSym(matScale(Ri, 0.5)).values
    expect(ev[0]).toBeCloseTo(50, 9)
    expect(ev[1]).toBeCloseTo(0.2512563, 6)
    // K_q = 1、N = 1 的「每 N」變異
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 1 })
    const sc = analyzeRule(plant, rule({ rule: 'scalar', muKq: 0.5 }), plant.Jn)
    const full = analyzeRule(plant, rule({ rule: 'full', gamma: 0.5 }), plant.Jn)
    expect(sc.closedModeVar![1]).toBeCloseTo(0.25063, 4)
    expect(full.closedModeVar![1]).toBeCloseTo(33.3333, 3)
    expect(full.closedModeVar![1] / sc.closedModeVar![1]).toBeCloseTo(133.0, 0)
    expect(full.totalVar! / sc.totalVar!).toBeCloseTo(44.8, 1)
    // Lyapunov 與閉式一致
    sc.modeVar!.forEach((x, i) => expect(x).toBeCloseTo(sc.closedModeVar![i], 9))
    full.modeVar!.forEach((x, i) => expect(x).toBeCloseTo(full.closedModeVar![i], 8))
  })

  it('E37：模式變異 127.83 / 0.642，每個參數的變異 64.24 fs²（ρ=.99、γ=.5、N=4096、σ_v=100 fs；golden preconditioner_variance）', () => {
    const v = load('preconditioner_variance')
    const N = v.inputs.N as number
    const kq = v.inputs.kq_per_fs as number
    const gl = v.inputs.gamma_list as number[]
    const lmax = 1.99
    const lmin = 0.01
    expectGolden(v, 'var_lambda_max_list', gl.map((g) => preconditionedModeVar(g, kq, N, lmax)))
    expectGolden(v, 'var_lambda_min_list', gl.map((g) => preconditionedModeVar(g, kq, N, lmin)))
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: 100, N })
    const full = analyzeRule(plant, rule({ rule: 'full', gamma: 0.5 }), plant.Jn)
    expect(full.modeVar![0]).toBeCloseTo(0.642370514189967, 8)
    expect(full.modeVar![1]).toBeCloseTo(127.83173232380344, 6)
    expect(full.perParamVar![0]).toBeCloseTo(64.237, 2)
    expect(full.perParamVar![1]).toBeCloseTo(64.237, 2)
    // 每個參數 = c·[R⁻¹]_jj，c = γ/(K_q² N (2−γ))
    const c = 0.5 / (kq * kq * N * 1.5)
    expect(full.perParamVar![0]).toBeCloseTo(c * inv(R099)[0][0], 8)
    // σ_weak/σ_strong = √199
    expect(Math.sqrt(full.modeVar![1] / full.modeVar![0])).toBeCloseTo(Math.sqrt(199), 9)
  })

  it('E22：R 形式 λ_reg = 0.1、γ = 0.5 ⇒ 慢 pole 1 − γλ/(λ+λ_reg) = 0.95455、65 blocks（598 / 5 / 65 的 65）', () => {
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
    const reg = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }), plant.Jn)
    expect(reg.closedPoles![1]).toBeCloseTo(1 - (0.5 * 0.01) / 0.11, 12)
    expect(reg.spectralRadius).toBeCloseTo(1 - (0.5 * 0.01) / 0.11, 12)
    expect(reg.blocks95).toBe(65)
    // 同一個數值放進 J 形式，pole 完全不同（單位不同：J 形式的 λ_reg 與 J² 同尺度）
    const regJ = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0.1 }), plant.Jn)
    expect(regJ.closedPoles![1]).toBeCloseTo(1 - (0.5 * 1e-4) / (1e-4 + 0.1), 12)
    expect(regJ.blocks95!).toBeGreaterThan(5000)
    // 直接比對 mRegularized 與定義式
    const MnR = mRegularized(plant.Jn, rule({ regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }))
    const direct = matScale(inv([
      [1.1, 0.99],
      [0.99, 1.1],
    ]), 0.5)
    expect(normFro(MnR.map((r, i) => r.map((x, j) => x - direct[i][j])))).toBeLessThan(1e-12)
  })

  it('E24：Ĵ 用 ρ̂=.996、γ=1、λ_reg=0 ⇒ pole −1.5（發散）；λ_reg=1e-4 ⇒ 0.003 / 0.655；ρ̂=.94、γ=.5 ⇒ 0.487 / 0.917', () => {
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
    const Jhat = (rh: number) => matScale(corrMatrix(2, rh), -1)
    const a0 = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 0 }), Jhat(0.996))
    const p0 = a0.poles.map((z) => z.re).sort((a, b) => a - b)
    expect(p0[0]).toBeCloseTo(-1.5, 9)
    expect(p0[1]).toBeCloseTo(0.003, 3)
    expect(a0.stable).toBe(false)
    // 封閉式 1 − γσ²/(σ²+λ) 只在 Ĵ = J 時成立 ⇒ 此時不提供
    expect(a0.closedPoles).toBeNull()
    const a1 = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 1e-4 }), Jhat(0.996))
    const p1 = a1.poles.map((z) => z.re).sort((a, b) => a - b)
    expect(p1[0]).toBeCloseTo(0.003, 3)
    expect(p1[1]).toBeCloseTo(0.655, 3)
    const a2 = analyzeRule(plant, rule({ rule: 'full', gamma: 0.5 }), Jhat(0.94))
    const p2 = a2.poles.map((z) => z.re).sort((a, b) => a - b)
    expect(p2[0]).toBeCloseTo(0.487, 3)
    expect(p2[1]).toBeCloseTo(0.917, 3)
  })
})

describe('mimo：交叉耦合、NLMS、Sequential trap', () => {
  it('交叉耦合：R=[[1,.8],[.8,1]]、δ=(0, δ₂) ⇒ E[G₁] = 0.8 K_q δ₂ ≠ 0（線性與精確 Bussgang 皆然）', () => {
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, 0.8), sigmaV: 100, N: 4096 })
    const d = [0, 10]
    const exact = signGmacMean(plant, d)
    const Kq = plant.Kq
    const shrink = 1 / Math.sqrt(1 + 100 / 10000) // √(σ²+δᵀRδ) 的增益壓縮
    expect(exact[0]).toBeCloseTo(0.8 * Kq * 10 * shrink, 14)
    expect(exact[1]).toBeCloseTo(Kq * 10 * shrink, 14)
    // scalar μ = 10 fs 一個 block：w₁ 被推離正確值 0.8·K_q·δ₂·μ
    const next = blockUpdate(d, [
      [10 * Kq, 0],
      [0, 10 * Kq],
    ], [0.8 * Kq * 10, Kq * 10], Kq)
    expect(next[0]).toBeCloseTo(-0.8 * Kq * 10 * 10, 12)
  })

  it('NLMS：poles = 1 − γλ_i/tr R ⇒ γ = 1 時與 μK_q = 0.5 的 scalar LMS 相同（不會修正 eigenvalue spread）', () => {
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
    const nl = analyzeRule(plant, rule({ rule: 'nlms', gamma: 1 }), plant.Jn)
    const sc = analyzeRule(plant, rule({ rule: 'scalar', muKq: 0.5 }), plant.Jn)
    expect(nl.closedPoles).toEqual(sc.closedPoles)
    expect(nl.blocks95).toBe(598)
  })

  it('Sequential trap：x₁ = x₂（ρ = 1）⇒ 所有誤差被先校正的 w₁ 吸收，w₂ 永遠不動', () => {
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, 1), sigmaV: SIGMA_KQ1, N: 4096 })
    const cfg = rule({ rule: 'sequential', gamma: 0.5, seqBlocksPerPhase: 60, seqSweeps: 1 })
    // a = (3, 1)、w₀ = (0, 0) ⇒ δ₀ = (3, 1)
    const mom = propagateLinearMoments(plant, cfg, plant.Jn, [3, 1], 120)!
    const d1 = mom.mean[0][120]
    const d2 = mom.mean[1][120]
    expect(d1 + d2).toBeCloseTo(0, 9) // 輸出誤差歸零
    expect(d2).toBeCloseTo(1, 12) // w₂ 沒動（δ₂ 維持 1）
    expect(d1).toBeCloseTo(-1, 9) // w₁ = a₁ + δ₂(0) = 4（吸收全部）
    const an = analyzeRule(plant, cfg, plant.Jn)
    expect(an.blocks95).toBeNull()
    expect(an.warnings.join(' ')).toMatch(/凍結/)
  })

  it('Sequential（ρ = 0.99，多個 sweep）= Gauss–Seidel：每個 sweep 收縮約 ρ² = 0.98', () => {
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
    const cfg = rule({ rule: 'sequential', gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 400 })
    const an = analyzeRule(plant, cfg, plant.Jn)
    // γ = 1 時每個 phase 一步解出該座標 ⇒ 一個 sweep 的轉移矩陣 ρ = ρ²
    const rhoSweep = Math.pow(an.spectralRadius, 2)
    expect(rhoSweep).toBeCloseTo(0.99 * 0.99, 9)
  })

  it('負面—diagonal 遇到 J_ii ≥ 0（單一 loop 極性錯誤）⇒ 解釋原因而非數值錯誤', () => {
    const b = buildUpdateMatrix(rule({ rule: 'diagonal' }), [
      [0.5, 0.1],
      [0.1, -1],
    ], 'J')
    expect(b.Mn).toBeNull()
    expect(b.error).toMatch(/錯誤極性/)
  })

  it('負面—R 非半正定 / ±1 碼無法實現 / σ_v ≤ 0 皆給出說明', () => {
    expect(buildPlant({ mode: 'R', R: corrMatrix(2, 1.2), sigmaV: 100, N: 64 }).errors.join(' ')).toMatch(/不是半正定/)
    const bad3 = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ]
    const p3 = buildPlant({ mode: 'R', R: bad3, sigmaV: 100, N: 64, dist: 'pm1' })
    expect(p3.errors.join(' ')).toMatch(/不是半正定|無法用 ±1 碼實現/)
    expect(buildPlant({ mode: 'R', R: R099, sigmaV: 0, N: 64 }).errors.join(' ')).toMatch(/σ_v/)
  })

  it('負面—失穩的原因要分清楚：pole > 1（方向相反）、pole < −1（過度修正）、複數 pole（旋轉）、|pole| = 1（臨界，不算穩定）', () => {
    const pn = buildPlant({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
    // (a) pole < −1：scalar μK_q = 1.5 > 2/λ_max = 1.005 ⇒ 快模式 pole 1 − 1.5·1.99 = −1.985（loop gain 2.985 > 2）
    const over = analyzeRule(pn, rule({ rule: 'scalar', muKq: 1.5 }), pn.Jn)
    expect(over.stable).toBe(false)
    expect(over.spectralRadius).toBeCloseTo(1.985, 12)
    expect(over.warnings.join(' ')).toMatch(/過度修正/)
    expect(over.warnings.join(' ')).toMatch(/2\.985/)
    // 這不是 T18 那種耦合問題，不可附上「每個 loop 單獨穩定不代表 MIMO 一起穩定」
    expect(over.warnings.join(' ')).not.toMatch(/每個 loop 單獨穩定/)
    expect(over.blocks95).toBeNull()
    expect(over.cov).toBeNull()

    // (b) pole > 1 但有一個對角斜率本身就是錯的（J_22 > 0）：說明方向相反，但不可說「每個 loop 單獨穩定」
    const Jbad: Mat = [
      [-1, 0],
      [0, 0.5],
    ]
    const pb = buildPlant({ mode: 'J', Jn: Jbad, sigmaV: SIGMA_KQ1, N: 64 })
    const wrong = analyzeRule(pb, rule({ rule: 'scalar', muKq: 0.2 }), Jbad)
    expect(wrong.spectralRadius).toBeCloseTo(1.1, 12)
    expect(wrong.warnings.join(' ')).toMatch(/更新方向相反/)
    expect(wrong.warnings.join(' ')).not.toMatch(/每個 loop 單獨穩定/)

    // (c) 複數 pole：不對稱 J = [[−0.1, 2], [−2, −0.1]]、M = 0.5I ⇒ eig(I + 0.5J) = 0.95 ± j，|p| = √(0.95² + 1) = 1.379
    const Jrot: Mat = [
      [-0.1, 2],
      [-2, -0.1],
    ]
    const pr = buildPlant({ mode: 'J', Jn: Jrot, sigmaV: SIGMA_KQ1, N: 64 })
    const rot = analyzeRule(pr, rule({ rule: 'scalar', muKq: 0.5 }), Jrot)
    expect(rot.spectralRadius).toBeCloseTo(Math.hypot(0.95, 1), 12)
    expect(rot.warnings.join(' ')).toMatch(/複數 pole/)
    expect(rot.warnings.join(' ')).toMatch(/旋轉/)

    // (d) 臨界 pole = +1：ρ = 1 的 regularized（差模方向 λ = 0 ⇒ loop gain 0 ⇒ 誤差凍結）——不可回報為「穩定」
    const p1 = buildPlant({ mode: 'R', R: corrMatrix(2, 1), sigmaV: SIGMA_KQ1, N: 4096 })
    const frozen = analyzeRule(p1, rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }), p1.Jn)
    expect(frozen.ok).toBe(true)
    expect(frozen.stable).toBe(false)
    expect(frozen.blocks95).toBeNull()
    expect(frozen.warnings.join(' ')).toMatch(/臨界/)
    expect(frozen.warnings.join(' ')).toMatch(/凍結/)
    expect(frozen.warnings.join(' ')).toMatch(/不可辨識/)

    // (e) 臨界 pole = −1（浮點上是 −0.99999999998）：E24 的 ρ̂ = .995、γ = 1 ⇒ 1 − 0.01/0.005 = −1。
    //     舊版以 ρ < 1 判定而回報「穩定、約 10¹¹ blocks」；現在視為臨界，並註明 M 由 Ĵ ≠ J 建構
    const crit = analyzeRule(pn, rule({ rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 0 }), matScale(corrMatrix(2, 0.995), -1))
    expect(Math.abs(crit.spectralRadius - 1)).toBeLessThan(1e-9)
    expect(crit.stable).toBe(false)
    expect(crit.blocks95).toBeNull()
    expect(crit.warnings.join(' ')).toMatch(/pole = −1/)
    expect(crit.warnings.join(' ')).toMatch(/Ĵ ≠ J/)
  })
})

describe('mimo：引擎與 Monte Carlo', () => {
  it('Lyapunov 解 = 閉式 m_i²λ_i/(K_q²N(1−p_i²))（scalar / full / regularized 兩種形式）', () => {
    const plant = buildPlant({ mode: 'R', R: corrMatrix(3, 0.6), sigmaV: 50, N: 512 })
    for (const r of [
      rule({ rule: 'scalar', muKq: 0.3 }),
      rule({ rule: 'full', gamma: 0.7 }),
      rule({ rule: 'regularized', regForm: 'R', lambdaReg: 0.2 }),
      rule({ rule: 'regularized', regForm: 'J', lambdaReg: 0.05 }),
    ]) {
      const an = analyzeRule(plant, r, plant.Jn)
      expect(an.closedModeVar).not.toBeNull()
      an.modeVar!.forEach((x, i) => expect(x / an.closedModeVar![i]).toBeCloseTo(1, 9))
    }
    expect(modeVarianceClosed(0.5, 0.01, 1, 1)).toBeCloseTo(0.25063, 4)
  })

  it('dlyap：不穩定回傳 null；與直接迭代一致', () => {
    expect(dlyap([[1.1]], [[1]])).toBeNull()
    const A = [
      [0.5, 0.2],
      [-0.1, 0.7],
    ]
    const Q = [
      [1, 0.3],
      [0.3, 2],
    ]
    let X = [
      [0, 0],
      [0, 0],
    ]
    for (let k = 0; k < 400; k++) {
      const AX = matMul(matMul(A, X), [
        [A[0][0], A[1][0]],
        [A[0][1], A[1][1]],
      ])
      X = AX.map((r, i) => r.map((x, j) => x + Q[i][j]))
    }
    const L = dlyap(A, Q)!
    expect(normFro(L.map((r, i) => r.map((x, j) => x - X[i][j])))).toBeLessThan(1e-10)
  })

  it('sample 引擎：G 的 MC 平均落在精確 Bussgang 平均的 ±4 SE 內（Gaussian 與 ±1 碼）', () => {
    for (const dist of ['gaussian', 'pm1'] as const) {
      const plant = buildPlant({ mode: 'R', R: corrMatrix(2, 0.7), sigmaV: 100, N: 200000, dist })
      const rng = createRng(11)
      const normal = createZigguratNormal(rng)
      const d = [40, -15]
      const G = gmacSample(plant, d, normal, () => rng.uniform())
      const m = signGmacMean(plant, d)
      for (let i = 0; i < 2; i++) {
        const se = Math.sqrt((plant.Rx[i][i] - m[i] * m[i]) / plant.N)
        expect(Math.abs(G[i] - m[i])).toBeLessThan(4 * se)
      }
    }
  })

  it('中央差分截斷：±1 碼 Δ = 0.3σ_v → −1.5%、Δ = σ_v → −14.4%；Gaussian 1/√(1+Δ²/σ²)', () => {
    expect(fdTruncationFactor('pm1', 0.3)).toBeCloseTo(0.98520, 5)
    expect(fdTruncationFactor('pm1', 1)).toBeCloseTo(0.8556, 4)
    expect(fdTruncationFactor('gaussian', 1)).toBeCloseTo(1 / Math.SQRT2, 14)
    expect(erf(1 / Math.SQRT2)).toBeCloseTo(0.6827, 4)
    // resolveJhat 的期望值（δ=0）= J × 截斷係數
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: 100, N: 4096, dist: 'pm1' })
    const { info } = resolveJhat(plant, { source: 'finiteDiff', fdDeltaFs: 30, fdSamples: 20000 }, [0, 0], 3)
    const f = fdTruncationFactor('pm1', 0.3)
    expect(info.expected![0][0]).toBeCloseTo(-1 * f, 10)
    expect(info.expected![0][1]).toBeCloseTo(-0.99 * f, 10)
  })

  it('有限差分 Ĵ 的 MC 誤差與預測 std 同量級，且同 seed 可重現', () => {
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: 100, N: 4096 })
    const a = resolveJhat(plant, { source: 'finiteDiff', fdDeltaFs: 30, fdSamples: 8192 }, [0, 0], 5)
    const b = resolveJhat(plant, { source: 'finiteDiff', fdDeltaFs: 30, fdSamples: 8192 }, [0, 0], 5)
    expect(a.JnHat).toEqual(b.JnHat)
    const err = a.JnHat.flatMap((r, i) => r.map((x, j) => (x - a.info.expected![i][j]) / a.info.std![i][j]))
    err.forEach((z) => expect(Math.abs(z)).toBeLessThan(5))
  })

  it('穩態共變異 MC（linear 引擎）：full preconditioner 的模式變異 CI 包含 127.8 / 0.642 fs²（E37）', () => {
    const res = runMimoCovarianceMc({
      plant: { mode: 'R', R: R099, sigmaV: 100, N: 4096 },
      rule: rule({ rule: 'full', gamma: 0.5 }),
      jhat: { source: 'exact' },
      engine: 'linear',
      chains: 64,
      recordBlocks: 2000,
      seed: 20261010,
    })
    expect(res.ok).toBe(true)
    // 95% CI 半寬 ≈ 2·SE ⇒ 以 ±4 SE（= 2 個半寬）判定，避免 5% 的偶發落在 95% CI 外
    for (let m = 0; m < 2; m++) {
      const a = res.modeVarClosed![m]
      const half = (res.modeVarHi[m] - res.modeVarLo[m]) / 2
      expect(Math.abs(res.modeVar[m] - a)).toBeLessThan(2 * half)
      expect(half / a).toBeLessThan(0.02)
    }
    expect(res.modeVarClosed![1]).toBeCloseTo(127.83, 1)
    for (let i = 0; i < 2; i++) {
      const half = (res.covHi[i][i] - res.covLo[i][i]) / 2
      expect(Math.abs(res.cov[i][i] - res.covAnalytic![i][i])).toBeLessThan(2 * half)
    }
  })

  it('穩態共變異 MC（sample 引擎，真正 1-bit）：scalar LMS 的每參數變異與 Lyapunov 相符（±CI）', () => {
    const res = runMimoCovarianceMc({
      plant: { mode: 'R', R: corrMatrix(2, 0.6), sigmaV: 100, N: 256 },
      rule: rule({ rule: 'scalar', muKq: 0.2 }),
      jhat: { source: 'exact' },
      engine: 'sample',
      chains: 24,
      recordBlocks: 1500,
      seed: 99,
    })
    expect(res.ok).toBe(true)
    expect(res.validityIndexMc).toBeLessThan(0.05)
    for (let i = 0; i < 2; i++) {
      const a = res.covAnalytic![i][i]
      expect(res.covLo[i][i] * 0.97).toBeLessThan(a)
      expect(res.covHi[i][i] * 1.03).toBeGreaterThan(a)
    }
  })

  it('MC 拒絕不穩定迴路並說明原因', () => {
    const res = runMimoCovarianceMc({
      plant: { mode: 'J', Jn: [
        [-1, 2],
        [2, -1],
      ], sigmaV: SIGMA_KQ1, N: 64 },
      rule: rule({ rule: 'scalar', muKq: 0.2 }),
      jhat: { source: 'exact' },
      engine: 'linear',
      chains: 8,
      recordBlocks: 100,
      seed: 1,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/不穩定/)
  })

  it('paired：同 seed 時每個 case 看到完全相同的雜訊（兩個相同規則的 case 軌跡一致），且結果可 structuredClone', () => {
    const p = {
      plant: { mode: 'R' as const, R: R099, sigmaV: 100, N: 64 },
      cases: [rule({ rule: 'scalar' }), rule({ rule: 'scalar' }), rule({ rule: 'full' })],
      delta0: [30, 0],
      blocks: 50,
      engine: 'sample' as const,
      jhat: { source: 'exact' as const },
      seed: 4,
    }
    const r = runMimoTrajectories(p)
    expect(Array.from(r.cases[0].delta[0])).toEqual(Array.from(r.cases[1].delta[0]))
    const r2 = runMimoTrajectories(p)
    expect(Array.from(r2.cases[2].delta[1])).toEqual(Array.from(r.cases[2].delta[1]))
    expect(() => structuredClone(r)).not.toThrow()
    expect(r.cases[0].meanField).not.toBeNull()
  })

  it('Freeze gain（freezeAt）：k ≥ freezeAt 後 δ 完全不動（模擬、解析平均/std、mean-field 皆然），之前與未凍結的同 seed 軌跡相同', () => {
    const base = {
      plant: { mode: 'R' as const, R: R099, sigmaV: 100, N: 64 },
      cases: [rule({ rule: 'full', gamma: 0.5 })],
      delta0: [30, 0],
      blocks: 60,
      jhat: { source: 'exact' as const },
      seed: 21,
    }
    for (const engine of ['linear', 'sample'] as const) {
      const free = runMimoTrajectories({ ...base, engine })
      const frz = runMimoTrajectories({ ...base, engine, freezeAt: 20 })
      const a = free.cases[0]
      const b = frz.cases[0]
      for (let i = 0; i < 2; i++) {
        // 凍結前：同一條亂數串流 ⇒ 完全相同
        for (let k = 0; k <= 20; k++) expect(b.delta[i][k]).toBe(a.delta[i][k])
        // 凍結後：w 不再更新
        for (let k = 21; k <= 60; k++) expect(b.delta[i][k]).toBe(b.delta[i][20])
        expect(b.meanAnalytic![i][60]).toBe(b.meanAnalytic![i][20])
        expect(b.stdAnalytic![i][60]).toBe(b.stdAnalytic![i][20])
        if (engine === 'sample') expect(b.meanField![i][60]).toBe(b.meanField![i][20])
      }
      // 凍結後的亂數串流照樣消耗：解除凍結後同 seed 的路徑不受影響（paired）
      expect(Array.from(a.delta[0])).toEqual(Array.from(runMimoTrajectories({ ...base, engine }).cases[0].delta[0]))
    }
  })

  it('MC（sequential，排程結束）：樣本平均落在解析平均 Φ_total δ₀ 附近（陷阱例 ⇒ (−1, 1)），橢圓以平均為中心', () => {
    const res = runMimoCovarianceMc({
      plant: { mode: 'R', R: corrMatrix(2, 1), sigmaV: 10, N: 4096 },
      rule: rule({ rule: 'sequential', gamma: 0.5, seqBlocksPerPhase: 60, seqSweeps: 1 }),
      jhat: { source: 'exact' },
      engine: 'linear',
      chains: 400,
      recordBlocks: 1,
      delta0: [3, 1],
      seed: 5,
    })
    expect(res.ok).toBe(true)
    expect(res.kind).toBe('final')
    expect(res.meanAnalytic![0]).toBeCloseTo(-1, 9)
    expect(res.meanAnalytic![1]).toBeCloseTo(1, 9)
    for (let i = 0; i < 2; i++) {
      const se = Math.sqrt(res.covAnalytic![i][i] / 400)
      expect(Math.abs(res.mean[i] - res.meanAnalytic![i])).toBeLessThan(4 * se)
    }
  })

  it('mean-field（精確 erf 增益）在大初始誤差時比線性模型慢', () => {
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, 0.5), sigmaV: 10, N: 4096 })
    const cfg = rule({ rule: 'full', gamma: 0.5 })
    const mf = meanFieldTrajectory(plant, cfg, plant.Jn, [100, 0], 10)!
    const lin = propagateLinearMoments(plant, cfg, plant.Jn, [100, 0], 10)!
    expect(Math.abs(mf[0][3])).toBeGreaterThan(Math.abs(lin.mean[0][3]))
  })

  it('tradeoffSweep：λ_reg 增加 ⇒ 收斂變慢、穩態變異變小（單調）', () => {
    const plant = buildPlant({ mode: 'R', R: R099, sigmaV: 100, N: 4096 })
    const pts = tradeoffSweep(plant, rule({ rule: 'regularized', regForm: 'R', gamma: 0.5 }), plant.Jn, [1e-3, 1e-2, 0.1, 1])
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].blocks95!).toBeGreaterThanOrEqual(pts[i - 1].blocks95!)
      expect(pts[i].totalVar!).toBeLessThan(pts[i - 1].totalVar!)
    }
  })

  it('analyzeMimo：mFull 與 inv 一致，結果可 structuredClone', () => {
    const r = analyzeMimo({
      plant: { mode: 'R', R: R099, sigmaV: 100, N: 4096 },
      cases: [rule({ rule: 'scalar' }), rule({ rule: 'full' })],
      jhat: { source: 'exact' },
      delta0: [30, 0],
      seed: 1,
    })
    expect(r.ok).toBe(true)
    const Mf = mFull(r.Jn, rule({ gamma: 0.5 }))
    expect(Mf[0][0]).toBeCloseTo(25.12562814070348, 9)
    expect(KQ100).toBeCloseTo(r.Kq, 15)
    expect(() => structuredClone(r)).not.toThrow()
  })
})
