import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng, eigSym, erf, inv, matMul, matScale, normFro, svd } from '@/simulation/core'
import {
  DEFAULT_RULE,
  MAX_NORM_DECAY_ITER,
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
  isNormalMatrix,
  kqFromSigma,
  mFull,
  mRegularized,
  meanFieldTrajectory,
  modeVarianceClosed,
  normDecayBlocks,
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
    expect(p3.errors.join(' ')).toMatch(/不是半正定|無法用 \$\\pm1\$ 碼實現/)
    // 訊息裡的數學是 LaTeX（經 mathText 顯示）：σ_v 寫成 $\sigma_v=0\ \mathrm{fs}$
    expect(buildPlant({ mode: 'R', R: R099, sigmaV: 0, N: 64 }).errors.join(' ')).toContain(String.raw`$\sigma_v=0\ \mathrm{fs}$ 不合法`)
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
    expect(crit.warnings.join(' ')).toContain('pole $=-1$')
    expect(crit.warnings.join(' ')).toContain(String.raw`$\hat{\mathbf J}\ne\mathbf J$`)
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

// ───────────────────────────── 審查 R02：一般（非正規）A 的 95% 衰減 block 數 ─────────────────────────────

/** A^k（直接連乘） */
function matPow(A: Mat, k: number): Mat {
  let Pk: Mat = A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)))
  for (let i = 0; i < k; i++) Pk = matMul(A, Pk)
  return Pk
}
const norm2 = (A: Mat): number => svd(A).S[0]
/** 暴力版：1 + 最後一個 ‖A^j‖₂ > 0.05 的 j（j ≤ horizon；每一步都做 SVD，不用任何停止規則） */
function bruteDecayBlocks(A: Mat, horizon: number): number {
  let Pk: Mat = A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)))
  let last = 0
  for (let j = 1; j <= horizon; j++) {
    Pk = matMul(A, Pk)
    if (norm2(Pk) > 0.05) last = j
  }
  return last + 1
}
const plantJ2 = (Jn: Mat) => buildPlant({ mode: 'J', Jn, sigmaV: 100, N: 4096 })
const plantR2 = (R: Mat) => buildPlant({ mode: 'R', R, sigmaV: SIGMA_KQ1, N: 4096 })

describe('mimo：審查 R02——ρ(A) 只給漸近速率，95% 衰減的 block 數要看 ‖A^k‖₂', () => {
  const JA: Mat = [
    [-1, 2],
    [0, -1],
  ]

  it('反例：J_n=[[−1,2],[0,−1]]、μK_q=0.5 ⇒ A=[[0.5,1],[0,0.5]]，ρ=0.5 但要 9 個 block（F-10.5 只給 5）', () => {
    const plant = plantJ2(JA)
    // 合法的 J-mode plant：不是非法輸入
    expect(plant.errors).toEqual([])
    expect(plant.warnings).toEqual([])
    const cfg = rule({ rule: 'scalar', muKq: 0.5 })
    const an = analyzeRule(plant, cfg, plant.Jn)
    expect(an.A).toEqual([
      [0.5, 1],
      [0, 0.5],
    ])
    expect(an.spectralRadius).toBeCloseTo(0.5, 12)
    expect(an.stable).toBe(true)
    expect(an.warnings).toEqual([])
    expect(stepsToDecay(an.spectralRadius)).toBe(5)
    expect(an.blocks95Asymptotic).toBe(5)
    expect(an.blocks95).toBe(9)
    expect(an.blocks95Basis).toBe('norm')
    // 時域（平均遞迴）：δ₀ = (0, 1) ⇒ δ_k = (k·2^{−(k−1)}, 2^{−k})；‖δ₅‖ = 0.314、‖δ₈‖ = 0.0626、‖δ₉‖ = 0.0352
    const mom = propagateLinearMoments(plant, cfg, plant.Jn, [0, 1], 12)!
    const len = (k: number) => Math.hypot(mom.mean[0][k], mom.mean[1][k])
    expect(mom.mean[0][5]).toBeCloseTo(5 / 16, 14)
    expect(mom.mean[1][5]).toBeCloseTo(1 / 32, 14)
    expect(len(5)).toBeCloseTo(0.3140586, 6)
    expect(len(8)).toBeCloseTo(0.062622, 6)
    expect(len(9)).toBeCloseTo(0.0352105, 6)
    expect(len(5)).toBeGreaterThan(0.05)
    expect(len(8)).toBeGreaterThan(0.05)
    expect(len(9)).toBeLessThan(0.05)
    // 最壞方向（2-norm）也是 9：‖A⁸‖₂ = 0.0627 > 0.05 ≥ ‖A⁹‖₂ = 0.0353
    expect(norm2(matPow(an.A!, 8))).toBeCloseTo(0.0627432, 6)
    expect(norm2(matPow(an.A!, 9))).toBeCloseTo(0.0352644, 6)
  })

  it('同一個 plant 的其他規則：NLMS γ=0.5 ⇒ ρ=11/12、35 → 63；diagonal γ=0.5 ⇒ 5 → 9；完整反矩陣 γ=0.5 ⇒ A=0.5·I、5 = 5', () => {
    const plant = plantJ2(JA)
    const nl = analyzeRule(plant, rule({ rule: 'nlms', gamma: 0.5 }), plant.Jn)
    // tr R_x = tr(J_n J_nᵀ) = 6 ⇒ A = I + (0.5/6)·J_n = [[11/12, 1/6], [0, 11/12]]
    expect(nl.A![0][0]).toBeCloseTo(11 / 12, 14)
    expect(nl.A![0][1]).toBeCloseTo(1 / 6, 14)
    expect(nl.spectralRadius).toBeCloseTo(11 / 12, 12)
    expect(nl.blocks95Asymptotic).toBe(35)
    expect(nl.blocks95).toBe(63)
    expect(nl.blocks95Basis).toBe('norm')
    expect(norm2(matPow(nl.A!, 62))).toBeGreaterThan(0.05) // 0.0516
    expect(norm2(matPow(nl.A!, 63))).toBeLessThan(0.05) // 0.0480
    const dg = analyzeRule(plant, rule({ rule: 'diagonal', gamma: 0.5 }), plant.Jn)
    expect([dg.blocks95Asymptotic, dg.blocks95, dg.blocks95Basis]).toEqual([5, 9, 'norm'])
    const full = analyzeRule(plant, rule({ rule: 'full', gamma: 0.5 }), plant.Jn)
    expect(full.A![0][0]).toBeCloseTo(0.5, 12)
    expect(Math.abs(full.A![0][1])).toBeLessThan(1e-12)
    expect([full.blocks95Asymptotic, full.blocks95, full.blocks95Basis]).toEqual([5, 5, 'pole'])
  })

  it('對照（A 對稱或正規）：數字與 F-10.5 完全相同、basis 是 pole——598 / 5 / 65 / 5996 / 598 / 598 / 75,091，以及正規的複數 pole 27', () => {
    const plant = plantR2(R099)
    const cases: [RuleConfig, number][] = [
      [rule({ rule: 'scalar', muKq: 0.5 }), 598],
      [rule({ rule: 'full', gamma: 0.5 }), 5],
      [rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }), 65],
      [rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0.1 }), 5996],
      [rule({ rule: 'diagonal', gamma: 0.5 }), 598],
      [rule({ rule: 'nlms', gamma: 1 }), 598],
    ]
    for (const [cfg, k] of cases) {
      const an = analyzeRule(plant, cfg, plant.Jn)
      expect(an.blocks95, cfg.rule).toBe(k)
      expect(an.blocks95Asymptotic, cfg.rule).toBe(k)
      expect(an.blocks95Basis, cfg.rule).toBe('pole')
      expect(an.warnings.join(' ')).not.toMatch(/下界/)
    }
    const phys = buildPlant({ mode: 'R', R: R099, sigmaV: 100, N: 4096 })
    const ph = analyzeRule(phys, rule({ rule: 'scalar', muKq: 0.5 * phys.Kq }), phys.Jn)
    expect([ph.blocks95, ph.blocks95Asymptotic, ph.blocks95Basis]).toEqual([75091, 75091, 'pole'])
    // J = [[−1,2],[−2,−1]] 不對稱但正規（旋轉 + 縮放）：A = [[0.8,0.4],[−0.4,0.8]]，|p| = √0.8，‖A^k‖₂ = |p|^k
    const Jn: Mat = [
      [-1, 2],
      [-2, -1],
    ]
    const pn = plantJ2(Jn)
    const rot = analyzeRule(pn, rule({ rule: 'scalar', muKq: 0.2 }), pn.Jn)
    expect(rot.spectralRadius).toBeCloseTo(Math.sqrt(0.8), 12)
    expect(Math.abs(rot.poles[0].im)).toBeCloseTo(0.4, 12)
    expect([rot.blocks95, rot.blocks95Asymptotic, rot.blocks95Basis]).toEqual([27, 27, 'pole'])
    expect(norm2(matPow(rot.A!, 26))).toBeCloseTo(Math.pow(0.8, 13), 12)
    // 極慢但對稱的迴路（1 − ρ(A) ≈ 10⁻⁷…10⁻⁸）不可被浮點誤差誤判成非正規
    const slowPlant = plantR2(corrMatrix(2, 0.9999))
    for (const cfg of [
      rule({ rule: 'scalar', muKq: 0.001 }),
      rule({ rule: 'regularized', regForm: 'R', gamma: 0.001, lambdaReg: 10 }),
      rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0.1 }),
    ]) {
      const an = analyzeRule(slowPlant, cfg, slowPlant.Jn)
      expect(an.blocks95Basis, `${cfg.rule}/${cfg.regForm}`).toBe('pole')
      expect(an.blocks95).toBe(an.blocks95Asymptotic)
      expect(an.blocks95!).toBeGreaterThan(1e7)
    }
  })

  it('「之後不再超過」而不是「第一次低於」：J=[[−1,4],[−1,−1]]、μK_q=0.3 ⇒ ‖A⁴⁰‖₂ 已低於 5%，41–43 又超過，44 才定下來', () => {
    const Jn: Mat = [
      [-1, 4],
      [-1, -1],
    ]
    const plant = plantJ2(Jn)
    const an = analyzeRule(plant, rule({ rule: 'scalar', muKq: 0.3 }), plant.Jn)
    expect(an.spectralRadius).toBeCloseTo(0.921954, 6) // |0.7 ± 0.6j| = √0.85
    expect(an.blocks95Asymptotic).toBe(37)
    expect(an.blocks95).toBe(44)
    expect(an.blocks95Basis).toBe('norm')
    const A = an.A!
    let Pk = matPow(A, 39)
    expect(norm2(Pk)).toBeGreaterThan(0.05) // 0.0648
    Pk = matMul(A, Pk)
    expect(norm2(Pk)).toBeCloseTo(0.0408679, 6) // k = 40：第一次低於 5%
    const back: number[] = []
    for (let j = 41; j <= 43; j++) {
      Pk = matMul(A, Pk)
      back.push(norm2(Pk))
    }
    expect(back[0]).toBeCloseTo(0.0592309, 6)
    expect(back[1]).toBeCloseTo(0.0657557, 6)
    expect(back[2]).toBeCloseTo(0.0540096, 6)
    for (let j = 44; j <= 400; j++) {
      Pk = matMul(A, Pk)
      expect(norm2(Pk)).toBeLessThanOrEqual(0.05)
    }
  })

  it('其他非正規輸入：diagonal 遇到 R_ii 不相等（10 → 11）、J₁₂=20（5 → 13）、Ĵ ≠ J 的完整反矩陣（6 → 7）', () => {
    // R = [[1,0.9],[0.9,4]]、diagonal γ=0.5 ⇒ M_n = diag(0.5, 0.125)、A = [[0.5,−0.45],[−0.1125,0.5]]（不對稱）
    const pr = plantR2([
      [1, 0.9],
      [0.9, 4],
    ])
    const dg = analyzeRule(pr, rule({ rule: 'diagonal', gamma: 0.5 }), pr.Jn)
    expect(dg.A![0][1]).toBeCloseTo(-0.45, 12)
    expect(dg.A![1][0]).toBeCloseTo(-0.1125, 12)
    expect(dg.spectralRadius).toBeCloseTo(0.725, 12)
    expect([dg.blocks95Asymptotic, dg.blocks95, dg.blocks95Basis]).toEqual([10, 11, 'norm'])
    // 同一個 R、同樣的 loop gain，用 scalar（A 對稱）就回到 F-10.5
    const sc = analyzeRule(pr, rule({ rule: 'scalar', muKq: 0.2 }), pr.Jn)
    expect(sc.blocks95Basis).toBe('pole')
    expect(sc.blocks95).toBe(sc.blocks95Asymptotic)

    const J20: Mat = [
      [-1, 20],
      [0, -1],
    ]
    const p20 = plantJ2(J20)
    const a20 = analyzeRule(p20, rule({ rule: 'scalar', muKq: 0.5 }), p20.Jn)
    expect([a20.blocks95Asymptotic, a20.blocks95, a20.blocks95Basis]).toEqual([5, 13, 'norm'])
    expect(norm2(matPow(a20.A!, 12))).toBeCloseTo(0.0585948, 6)
    expect(norm2(matPow(a20.A!, 13))).toBeCloseTo(0.0317388, 6)

    // T18 的 J，M 用量錯的 Ĵ 建構：A = I − 0.5·Ĵ⁻¹J 不對稱
    const J18: Mat = [
      [-1, 2],
      [2, -1],
    ]
    const p18 = plantJ2(J18)
    const mis = analyzeRule(p18, rule({ rule: 'full', gamma: 0.5 }), [
      [-1, 1.6],
      [2.4, -1],
    ])
    expect(mis.spectralRadius).toBeCloseTo(0.5938064, 6)
    expect([mis.blocks95Asymptotic, mis.blocks95, mis.blocks95Basis]).toEqual([6, 7, 'norm'])
    // 用正確的 Ĵ = J：A = 0.5·I
    const ok = analyzeRule(p18, rule({ rule: 'full', gamma: 0.5 }), J18)
    expect([ok.blocks95Asymptotic, ok.blocks95, ok.blocks95Basis]).toEqual([5, 5, 'pole'])
  })

  it('步長很小時 A ≈ I，仍要認得出非正規：J₁₂=0.3、μK_q=10⁻⁴ ⇒ 29,956 → 34,990（不能用 ‖A‖_F² 當尺度）', () => {
    const Jn: Mat = [
      [-1, 0.3],
      [0, -1],
    ]
    const plant = plantJ2(Jn)
    const an = analyzeRule(plant, rule({ rule: 'scalar', muKq: 1e-4 }), plant.Jn)
    const A = an.A!
    // 以 ‖A‖_F² 當尺度的 ‖AAᵀ − AᵀA‖_F 只有 1.3×10⁻⁹（看起來「幾乎正規」）
    const At = A[0].map((_, j) => A.map((r) => r[j]))
    const AAt = matMul(A, At)
    const AtA = matMul(At, A)
    const comm = normFro(AAt.map((r, i) => r.map((x, j) => x - AtA[i][j])))
    expect(comm).toBeLessThan(2e-9)
    expect(isNormalMatrix(A)).toBe(false)
    expect(an.spectralRadius).toBeCloseTo(0.9999, 12)
    expect(an.blocks95Asymptotic).toBe(29956)
    expect(an.blocks95Basis).toBe('norm')
    // A^k = p^k·[[1, k·c], [0, 1]]，c = 3×10⁻⁵/p：直接用封閉式找最後一個 ‖A^k‖₂ > 0.05 的 k
    const p = 1 - 1e-4
    const c = 3e-5 / p
    const normAt = (k: number) => Math.pow(p, k) * norm2([[1, k * c], [0, 1]])
    let last = 0
    for (let k = 29000; k <= 40000; k++) if (normAt(k) > 0.05) last = k
    expect(last + 1).toBe(34990)
    expect(an.blocks95).toBe(34990)
  })

  it('算不完時不可以假裝精確：J₁₂=100、μK_q=10⁻⁵ ⇒ basis = lower-bound、警告寫明是下界', () => {
    const Jn: Mat = [
      [-1, 100],
      [0, -1],
    ]
    const plant = plantJ2(Jn)
    const an = analyzeRule(plant, rule({ rule: 'scalar', muKq: 1e-5 }), plant.Jn)
    expect(an.stable).toBe(true)
    expect(an.blocks95Basis).toBe('lower-bound')
    expect(an.blocks95Asymptotic).toBe(299572)
    expect(an.blocks95).toBe(299572)
    expect(an.warnings.join(' ')).toMatch(/下界/)
    // 數字帶千分位（TeX 的 {,}），和 KPI 的 299,572 同一種寫法
    expect(MAX_NORM_DECAY_ITER).toBe(200000)
    expect(an.warnings.join(' ')).toContain(String.raw`在 $200{,}000$ 個 block 內`)
    expect(an.warnings.join(' ')).toContain(String.raw`下界 $299{,}572$`)
    // 真的還沒收斂：‖A^k‖₂ ≥ p^k·k·10⁻³/p，在 k = 299,572 是 0.05 × 299.6 ≈ 15
    expect(normDecayBlocks(an.A!)).toBeNull()
    const k = 299572
    expect(Math.pow(1 - 1e-5, k) * k * 1e-3).toBeGreaterThan(10)
  })

  it('Sequential 用同一個定義：Gauss–Seidel（γ=1）仍是 334；過度修正 γ=1.9 時「第一次低於」是 155，定下來是 181', () => {
    const p99 = plantR2(R099)
    const gs = analyzeRule(p99, rule({ rule: 'sequential', gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 1000 }), p99.Jn)
    expect([gs.blocks95, gs.blocks95Basis, gs.blocks95Asymptotic]).toEqual([334, 'norm', null])

    const p05 = plantR2(corrMatrix(2, 0.5))
    const cfg = rule({ rule: 'sequential', gamma: 1.9, seqBlocksPerPhase: 30, seqSweeps: 10 })
    const over = analyzeRule(p05, cfg, p05.Jn)
    expect([over.blocks95, over.blocks95Basis, over.blocks95Asymptotic]).toEqual([181, 'norm', null])
    // 獨立重算：每個階段只更新一個座標，A_i = I − γ·e_i e_iᵀ R / R_ii
    const R = corrMatrix(2, 0.5)
    const Ai = [0, 1].map((i) => R.map((_, r) => R.map((__, cIdx) => (r === cIdx ? 1 : 0) - (r === i ? (1.9 * R[i][cIdx]) / R[i][i] : 0))))
    let Phi: Mat = [
      [1, 0],
      [0, 1],
    ]
    let first = 0
    let last = 0
    for (let k = 0; k < 600; k++) {
      Phi = matMul(Ai[Math.floor(k / 30) % 2], Phi)
      const above = norm2(Phi) > 0.05
      if (!above && first === 0) first = k + 1
      if (above) last = k + 1
    }
    expect(first).toBe(155)
    expect(last + 1).toBe(181)
  })

  it('輔助函式：normDecayBlocks 與 isNormalMatrix', () => {
    expect(
      normDecayBlocks([
        [0.5, 1],
        [0, 0.5],
      ]),
    ).toBe(9)
    expect(
      normDecayBlocks([
        [0.5, 0],
        [0, 0.5],
      ]),
    ).toBe(5)
    // 冪零：A¹ ≠ 0、A² = 0
    expect(
      normDecayBlocks([
        [0, 1],
        [0, 0],
      ]),
    ).toBe(2)
    expect(normDecayBlocks([[0]])).toBe(1)
    // 不穩定或門檻不合理：null
    expect(normDecayBlocks([[1.01]], 0.05, 2000)).toBeNull()
    expect(normDecayBlocks([[0.5]], 1.5)).toBeNull()
    expect(isNormalMatrix(R099)).toBe(true)
    expect(
      isNormalMatrix([
        [0.5, 0.5],
        [-0.5, 0.5],
      ]),
    ).toBe(true)
    expect(
      isNormalMatrix([
        [0.7, 0],
        [0, 0.7],
      ]),
    ).toBe(true)
    expect(
      isNormalMatrix([
        [0.5, 1],
        [0, 0.5],
      ]),
    ).toBe(false)
    // 加上 c·I 不改變是否正規（A = I + μJ、μ 很小時也一樣）
    expect(
      isNormalMatrix([
        [1 - 1e-6, 2e-6],
        [0, 1 - 1e-6],
      ]),
    ).toBe(false)
    expect(
      isNormalMatrix([
        [1 - 1e-6, 2e-6],
        [-2e-6, 1 - 1e-6],
      ]),
    ).toBe(true)
    // 捨入殘差不可以被當成「非正規」：完整反矩陣（Ĵ = J）的 A 數學上是 (1 − γ)·I，算出來會帶 10⁻¹⁶ 的非對角殘差
    expect(
      isNormalMatrix([
        [0.5, 1e-17],
        [0, 0.5],
      ]),
    ).toBe(true)
    const p3 = plantR2(corrMatrix(3, 0.6))
    const full3 = analyzeRule(p3, rule({ rule: 'full', gamma: 0.7 }), p3.Jn)
    // 非對角元素只剩捨入殘差（這個例子約 10⁻¹⁶；上一個斷言用寫死的 10⁻¹⁷ 確保這條路徑一定被測到）
    const offDiag = Math.max(...full3.A!.flatMap((r, i) => r.filter((_, j) => j !== i).map(Math.abs)))
    expect(offDiag).toBeLessThan(1e-14)
    expect(isNormalMatrix(full3.A!)).toBe(true)
    expect(full3.blocks95Basis).toBe('pole')
    // 不對稱的 J 用正確的 Ĵ = J 做完整反矩陣：A = 0.7·I + 捨入殘差，一樣是正規
    const pjn = plantJ2([
      [-1, 0.37],
      [1.3, -0.8],
    ])
    const fullJ = analyzeRule(pjn, rule({ rule: 'full', gamma: 0.3 }), pjn.Jn)
    expect(isNormalMatrix(fullJ.A!)).toBe(true)
    expect([fullJ.blocks95, fullJ.blocks95Basis]).toEqual([9, 'pole'])
    // 經過反矩陣算出來的對稱 A（regularized）也是正規
    for (const regForm of ['R', 'J'] as const) {
      const rg = analyzeRule(p3, rule({ rule: 'regularized', regForm, gamma: 0.5, lambdaReg: 0.1 }), p3.Jn)
      expect(isNormalMatrix(rg.A!), regForm).toBe(true)
    }
    // 捨入下限不會把真正的非正規放過去：10⁻⁹ 等級的非對稱耦合（遠大於 10⁻¹³）仍判為非正規
    expect(
      isNormalMatrix([
        [0.5, 1e-9],
        [0, 0.5],
      ]),
    ).toBe(false)
  })

  it('basis = pole 的判準是 ‖A‖₂ = ρ(A)（正規矩陣一定滿足）：3×3 的「不正規但 ‖A‖₂ = ρ」也用 F-10.5，而且與暴力結果相同', () => {
    // A = diag(0.9) ⊕ [[0.1, 0.5], [0, 0.1]]：非正規，但最慢的模式（0.9）自己一個方向，‖A‖₂ = 0.9 = ρ(A) ⇒ ‖A^k‖₂ = 0.9^k
    const Jn: Mat = [
      [-0.1, 0, 0],
      [0, -0.9, 0.5],
      [0, 0, -0.9],
    ]
    const plant = plantJ2(Jn)
    expect(plant.errors).toEqual([])
    const an = analyzeRule(plant, rule({ rule: 'scalar', muKq: 1 }), plant.Jn)
    const A = an.A!
    expect(isNormalMatrix(A)).toBe(false)
    expect(norm2(A)).toBeCloseTo(0.9, 12)
    expect(an.spectralRadius).toBeCloseTo(0.9, 12)
    expect([an.blocks95, an.blocks95Asymptotic, an.blocks95Basis]).toEqual([29, 29, 'pole'])
    expect(bruteDecayBlocks(A, 600)).toBe(29)
    expect(normDecayBlocks(A)).toBe(29)
    // 把耦合加大到 ‖A‖₂ > ρ(A)（下方 2×2 區塊的 2-norm 超過 0.9）就要逐 block 算；這個例子的 block 數剛好還是 29
    const Jbig: Mat = [
      [-0.1, 0, 0],
      [0, -0.9, 1.2],
      [0, 0, -0.9],
    ]
    const pb = plantJ2(Jbig)
    const big = analyzeRule(pb, rule({ rule: 'scalar', muKq: 1 }), pb.Jn)
    expect(norm2(big.A!)).toBeGreaterThan(0.9)
    expect(big.blocks95Basis).toBe('norm')
    expect(big.blocks95).toBe(bruteDecayBlocks(big.A!, 600))
    expect([big.blocks95, big.blocks95Asymptotic]).toEqual([29, 29])
  })

  it('性質：200 個隨機穩定矩陣（2×2…4×4）——normDecayBlocks = 逐步 SVD 的暴力結果，且不小於 ⌈ln 0.05/ln ρ⌉', () => {
    const rng = createRng(20261012)
    let strictlyLarger = 0
    for (let t = 0; t < 200; t++) {
      const P = rng.int(2, 4)
      const raw: Mat = Array.from({ length: P }, () => Array.from({ length: P }, () => rng.normal()))
      const rho0 = Math.max(...inspectMatrix(raw).eig.map((z) => Math.hypot(z.re, z.im)))
      const target = 0.05 + 0.87 * rng.uniform() // ρ(A) ∈ [0.05, 0.92]
      const A = matScale(raw, target / rho0)
      const horizon = 700
      const brute = bruteDecayBlocks(A, horizon)
      // 暴力版的視窗夠長：最後的範數遠低於門檻
      expect(norm2(matPow(A, horizon))).toBeLessThan(1e-9)
      const k = normDecayBlocks(A)
      expect(k, `t=${t}`).toBe(brute)
      const asym = stepsToDecay(target)
      expect(k!).toBeGreaterThanOrEqual(asym)
      if (k! > asym) strictlyLarger++
    }
    // 隨機矩陣幾乎都不是正規的：其中一大部分（這個 seed 是 84 個）連取整後的 block 數都比 F-10.5 多
    expect(strictlyLarger).toBeGreaterThan(50)
  })

  it('性質：本檔出現過的每一種穩定設定，blocks95 ≥ blocks95Asymptotic；basis = pole 時相等', () => {
    const plants = [plantR2(R099), plantR2(corrMatrix(3, 0.6)), plantR2([[1, 0.9], [0.9, 4]]), plantJ2(JA), plantJ2([[-1, 4], [-1, -1]]), plantJ2([[-1, 2], [-2, -1]])]
    const cfgs = [
      rule({ rule: 'scalar', muKq: 0.05 }),
      rule({ rule: 'scalar', muKq: 0.3 }),
      rule({ rule: 'diagonal', gamma: 0.5 }),
      rule({ rule: 'nlms', gamma: 0.5 }),
      rule({ rule: 'full', gamma: 0.7 }),
      rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }),
      rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0.1 }),
    ]
    let checked = 0
    for (const plant of plants) {
      for (const cfg of cfgs) {
        const an = analyzeRule(plant, cfg, plant.Jn)
        if (!an.ok || !an.stable) {
          expect(an.blocks95).toBeNull()
          expect(an.blocks95Basis).toBeNull()
          expect(an.blocks95Asymptotic).toBeNull()
          continue
        }
        checked++
        expect(an.blocks95Asymptotic).toBe(stepsToDecay(an.spectralRadius))
        expect(an.blocks95!).toBeGreaterThanOrEqual(an.blocks95Asymptotic!)
        if (an.blocks95Basis === 'pole') expect(an.blocks95).toBe(an.blocks95Asymptotic)
        else expect(an.blocks95).toBe(bruteDecayBlocks(an.A!, 3000))
      }
    }
    expect(checked).toBeGreaterThan(30)
  })
})

// ───────────────────────────── 審查 C01：最慢的是 |p| 最大的模式，不一定是 λ_min ─────────────────────────────

describe('mimo：審查 C01——scalar LMS 的收斂速度看 max|1 − μK_qλ_i|', () => {
  const half = buildPlant({ mode: 'R', R: corrMatrix(2, 0.5), sigmaV: SIGMA_KQ1, N: 4096 })

  it('反例：λ = {1.5, 0.5}、μK_q = 1.2 ⇒ poles {−0.8, 0.4}，最慢的是 λ_max 的模式（14 個 block；λ_min 的模式只要 4 個）', () => {
    expect(half.modeValues[0]).toBeCloseTo(1.5, 12)
    expect(half.modeValues[1]).toBeCloseTo(0.5, 12)
    const cfg = rule({ rule: 'scalar', muKq: 1.2 })
    const sc = analyzeRule(half, cfg, half.Jn)
    // closedPoles 的順序跟 modeValues 一樣：[λ_max 的模式, λ_min 的模式]
    expect(sc.closedPoles![0]).toBeCloseTo(-0.8, 12)
    expect(sc.closedPoles![1]).toBeCloseTo(0.4, 12)
    expect(sc.spectralRadius).toBeCloseTo(0.8, 12)
    expect(sc.stable).toBe(true)
    expect(sc.blocks95).toBe(14)
    expect(sc.blocks95Basis).toBe('pole') // A 對稱：R02 不影響這個數字
    expect(stepsToDecay(sc.closedPoles![1])).toBe(4)
    // 時域：沿共模 (1,1)（λ_max）每個 block 乘 −0.8；沿差模 (1,−1)（λ_min）乘 0.4
    const com = propagateLinearMoments(half, cfg, half.Jn, [1, 1], 14)!
    expect(com.mean[0][1]).toBeCloseTo(-0.8, 12)
    expect(Math.abs(com.mean[0][13])).toBeCloseTo(0.0549756, 6) // 0.8¹³ > 0.05
    expect(Math.abs(com.mean[0][14])).toBeCloseTo(0.0439805, 6) // 0.8¹⁴ ≤ 0.05
    const dif = propagateLinearMoments(half, cfg, half.Jn, [1, -1], 4)!
    expect(dif.mean[0][3]).toBeCloseTo(0.064, 12)
    expect(dif.mean[0][4]).toBeCloseTo(0.0256, 12)
  })

  it('對照：μK_q ≤ 2/(λ_max+λ_min) = 1 時最慢的是 λ_min 的模式；μK_q = 1 兩個模式一樣慢', () => {
    const a05 = analyzeRule(half, rule({ rule: 'scalar', muKq: 0.5 }), half.Jn)
    expect(a05.closedPoles![0]).toBeCloseTo(0.25, 12)
    expect(a05.closedPoles![1]).toBeCloseTo(0.75, 12)
    expect(a05.blocks95).toBe(11)
    expect(stepsToDecay(a05.closedPoles![1])).toBe(11)
    const a1 = analyzeRule(half, rule({ rule: 'scalar', muKq: 1 }), half.Jn)
    expect(a1.closedPoles![0]).toBeCloseTo(-0.5, 12)
    expect(a1.closedPoles![1]).toBeCloseTo(0.5, 12)
    expect(a1.spectralRadius).toBeCloseTo(0.5, 12)
    expect(a1.blocks95).toBe(5)

    const p99 = plantR2(R099)
    expect(analyzeRule(p99, rule({ rule: 'scalar', muKq: 0.5 }), p99.Jn).blocks95).toBe(598)
    // μK_q = 1 = 2/(λ_max+λ_min)：max|p| = (κ−1)/(κ+1) = 198/200
    const b1 = analyzeRule(p99, rule({ rule: 'scalar', muKq: 1 }), p99.Jn)
    expect(b1.spectralRadius).toBeCloseTo(198 / 200, 12)
    expect(b1.blocks95).toBe(299)
    // 再大一點點（1.003，仍小於 2/λ_max = 1.005）：λ_max 的模式 |p| = 0.99597，742 個 block；λ_min 的模式自己只要 298 個
    const b2 = analyzeRule(p99, rule({ rule: 'scalar', muKq: 1.003 }), p99.Jn)
    expect(b2.stable).toBe(true)
    expect(b2.closedPoles![0]).toBeCloseTo(-0.99597, 10)
    expect(b2.spectralRadius).toBeCloseTo(0.99597, 10)
    expect(b2.blocks95).toBe(742)
    expect(stepsToDecay(b2.closedPoles![1])).toBe(298)
  })

  it('性質：200 組隨機 (λ_min, λ_max, g)——λ_max 的模式較慢 ⇔ g > 2/(λ_max+λ_min)；min_g max|p| = (κ−1)/(κ+1)', () => {
    const rng = createRng(20261013)
    for (let t = 0; t < 200; t++) {
      const x = 0.01 + 2.99 * rng.uniform()
      const y = 0.01 + 2.99 * rng.uniform()
      const lmin = Math.min(x, y)
      const lmax = Math.max(x, y)
      if (lmax - lmin < 1e-6) continue
      const gStar = 2 / (lmax + lmin)
      const g = (2 / lmax) * (0.001 + 0.998 * rng.uniform())
      if (Math.abs(g - gStar) < 1e-9) continue
      const fastMinusSlow = Math.abs(1 - g * lmax) - Math.abs(1 - g * lmin)
      expect(Math.sign(fastMinusSlow)).toBe(Math.sign(g - gStar))
      // 細格點掃 g ∈ (0, 2/λ_max)：max(|1 − gλ_min|, |1 − gλ_max|) 的最小值
      let best = Infinity
      for (let i = 1; i < 4000; i++) {
        const gi = ((2 / lmax) * i) / 4000
        best = Math.min(best, Math.max(Math.abs(1 - gi * lmin), Math.abs(1 - gi * lmax)))
      }
      expect(Math.abs(best - (lmax - lmin) / (lmax + lmin))).toBeLessThan(1e-3)
    }
  })
})

/**
 * 警告／錯誤／說明字串會經 mathText 顯示在 Lab 的警告區、表格與 Gallery（docs/teaching-style.md §3：數學一律 LaTeX）。
 * 這裡把每一條訊息都觸發一次，檢查：`$` 成對、`$...$` 以外沒有 Unicode 拼的數學、數字不印成 1.2e-5 這種寫法、
 * 數學上是 0 的量不印浮點殘餘。能否被 KaTeX 排出來，另由 src/chapters/ch10/ch10.test.tsx 檢查（那裡有 DOM）。
 */
describe('訊息字串：數學寫成 `$...$` LaTeX，沒有 Unicode 拼的公式，也沒有浮點殘餘', () => {
  /** `$...$` 以外不可以出現的東西：希臘字母、上下標數字、運算符號、帽子／轉置、x_y 式的底線下標 */
  const UNICODE_MATH = /[\u0370-\u03ff\u2070-\u209f\u00b2\u00b3\u00b9\u0134\u1d40\u2211\u220f\u221a\u221e\u2264\u2265\u2260\u2248\u00b1\u2213\u00b7\u00d7\u00f7\u2202\u2207\u2208\u221d\u230a\u230b\u2308\u2309\u2016]|\u0302|\b[A-Za-z]{1,3}_[A-Za-z0-9{]|\^[-0-9{]/u
  const outsideMath = (t: string) => t.replace(/\$[^$]*\$/g, '')
  const J18: Mat = [
    [-1, 2],
    [2, -1],
  ]

  /** 觸發 mimo.ts 裡每一條會顯示給讀者的訊息 */
  function collect(): string[] {
    const out: string[] = []
    const push = (...xs: (string | null | undefined)[]) => xs.forEach((x) => x && out.push(x))
    const plantOf = (spec: Parameters<typeof buildPlant>[0]) => {
      const p = buildPlant(spec)
      push(...p.errors, ...p.warnings)
      return p
    }
    const ruleOf = (p: ReturnType<typeof buildPlant>, c: Partial<RuleConfig>, Jhat: Mat = p.Jn) => {
      const an = analyzeRule(p, rule(c), Jhat)
      push(an.error, ...an.warnings)
      return an
    }
    // ── buildPlant ──
    plantOf({ mode: 'R', R: [[1, 0.5]], sigmaV: 100, N: 64 }) // 不是方陣
    plantOf({ mode: 'R', R: [[1, NaN], [NaN, 1]], sigmaV: 100, N: 64 }) // prettier-ignore
    plantOf({ mode: 'R', R: R099, sigmaV: 0, N: 64 })
    plantOf({ mode: 'R', R: R099, sigmaV: -2.5e-7, N: 64 })
    plantOf({ mode: 'R', R: R099, sigmaV: 100, N: 0.5 })
    plantOf({ mode: 'R', R: [[1, 0.5], [0.4, 1]], sigmaV: 100, N: 64 }) // prettier-ignore
    plantOf({ mode: 'R', R: corrMatrix(2, 1.2), sigmaV: 100, N: 64 })
    plantOf({ mode: 'R', R: corrMatrix(4, 0.1), sigmaV: 100, N: 64, dist: 'pm1' })
    plantOf({ mode: 'R', R: [[2, 0.5], [0.5, 1]], sigmaV: 100, N: 64, dist: 'pm1' }) // prettier-ignore
    plantOf({ mode: 'R', R: [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]], sigmaV: 100, N: 64, dist: 'pm1' }) // prettier-ignore
    plantOf({ mode: 'R', R: [[1, 0.6, -0.6], [0.6, 1, 0.6], [-0.6, 0.6, 1]], sigmaV: 100, N: 64, dist: 'pm1' }) // prettier-ignore
    plantOf({ mode: 'R', R: [[0, 0], [0, 0]], sigmaV: 100, N: 64 }) // prettier-ignore
    plantOf({ mode: 'J', Jn: [[0, 0], [0, 0]], sigmaV: 100, N: 64 }) // prettier-ignore
    plantOf({ mode: 'J', Jn: [[-1, -1], [-1, -1]], sigmaV: 100, N: 64 }) // prettier-ignore
    const p1 = plantOf({ mode: 'R', R: corrMatrix(2, 1), sigmaV: 100, N: 4096 }) // λ_min = 0
    const p099 = plantOf({ mode: 'R', R: R099, sigmaV: SIGMA_KQ1, N: 4096 })
    const p9999 = plantOf({ mode: 'R', R: corrMatrix(2, 0.9999), sigmaV: 100, N: 4096 })
    const pT18 = plantOf({ mode: 'J', Jn: J18, sigmaV: 100, N: 4096 })
    // ── buildUpdateMatrix ──
    ruleOf(plantOf({ mode: 'J', Jn: [[-1, 0.5], [0.5, 1]], sigmaV: 100, N: 64 }), { rule: 'diagonal' }) // prettier-ignore
    ruleOf(p099, { rule: 'sequential', seqBlocksPerPhase: 1.5 })
    ruleOf(p099, { rule: 'sequential', seqSweeps: 0 })
    ruleOf(p099, { rule: 'sequential', seqBlocksPerPhase: 10000, seqSweeps: 1000 })
    ruleOf(pT18, { rule: 'nlms' }, [[0, 0], [0, 0]]) // prettier-ignore
    ruleOf(p1, { rule: 'full' })
    ruleOf(p9999, { rule: 'full' }) // condition number 19999 > 10³
    ruleOf(p099, { rule: 'regularized', lambdaReg: -1 })
    ruleOf(p099, { rule: 'regularized', regForm: 'R' }, [[-1, -0.9], [-0.8, -1]]) // prettier-ignore
    ruleOf(pT18, { rule: 'regularized', regForm: 'R', lambdaReg: 0.1 }) // λ_min(R̂) + λ_reg = −0.9
    ruleOf(pT18, { rule: 'regularized', regForm: 'R', lambdaReg: 1 }) // 和恰為 0
    ruleOf(p1, { rule: 'regularized', regForm: 'R', lambdaReg: 0 }) // 和是浮點殘餘
    ruleOf(p1, { rule: 'regularized', regForm: 'J', lambdaReg: 0 })
    // ── explainInstability 的五種情形（含 Ĵ ≠ J 的附註） ──
    ruleOf(pT18, { rule: 'scalar', muKq: 0.2 }) // pole > 1
    ruleOf(p099, { rule: 'scalar', muKq: 1.5 }) // pole < −1
    ruleOf(plantOf({ mode: 'J', Jn: [[-0.1, 2], [-2, -0.1]], sigmaV: 100, N: 64 }), { rule: 'scalar', muKq: 0.5 }) // prettier-ignore
    ruleOf(plantOf({ mode: 'J', Jn: [[-1, 1], [-1, -1]], sigmaV: 100, N: 64 }), { rule: 'scalar', muKq: 1 }) // prettier-ignore
    ruleOf(p1, { rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }) // pole = +1
    ruleOf(p099, { rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 0 }, matScale(corrMatrix(2, 0.995), -1)) // pole = −1、Ĵ ≠ J
    ruleOf(p099, { rule: 'regularized', regForm: 'J', gamma: 1, lambdaReg: 0 }, matScale(corrMatrix(2, 0.996), -1)) // pole < −1、Ĵ ≠ J
    // ── sequential 沒收斂就凍結；非正規又算不完只列下界 ──
    ruleOf(pT18, { rule: 'sequential', gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 3 })
    ruleOf(plantJ2([[-1, 100], [0, -1]]), { rule: 'scalar', muKq: 1e-5 }) // prettier-ignore
    // ── resolveJhat ──
    const jhat = (spec: Parameters<typeof resolveJhat>[1]) => {
      const r = resolveJhat(p099, spec, [0, 0], 1)
      push(r.info.note, r.error)
    }
    jhat({ source: 'exact' })
    jhat({ source: 'custom', custom: [[-1]] })
    jhat({ source: 'custom', custom: [[-1, -0.9], [-0.9, -1]] }) // prettier-ignore
    jhat({ source: 'perturbed', perturbRel: 1e-7 })
    jhat({ source: 'finiteDiff', fdDeltaFs: 0, fdSamples: 64 })
    jhat({ source: 'finiteDiff', fdDeltaFs: 2.5e-7, fdSamples: 4096 })
    // ── 時域模擬與 Monte Carlo 的拒絕原因 ──
    const spec099 = { mode: 'R' as const, R: R099, sigmaV: 100, N: 4096 }
    const traj = (o: Partial<Parameters<typeof runMimoTrajectories>[0]>) =>
      push(runMimoTrajectories({ plant: spec099, cases: [rule({})], delta0: [10, 0], blocks: 10, engine: 'linear', jhat: { source: 'exact' }, seed: 1, ...o }).error)
    traj({ blocks: 0 })
    traj({ delta0: [1] })
    traj({ engine: 'sample', blocks: 50000 })
    const mc = (o: Partial<Parameters<typeof runMimoCovarianceMc>[0]>) => {
      const r = runMimoCovarianceMc({ plant: spec099, rule: rule({ rule: 'full' }), jhat: { source: 'exact' }, engine: 'linear', chains: 4, recordBlocks: 50, seed: 1, ...o })
      push(r.error, ...r.warnings)
    }
    mc({ chains: 1 })
    mc({ rule: rule({ rule: 'scalar', muKq: 1.5 }) })
    mc({ engine: 'sample', chains: 4096, recordBlocks: 200000 })
    mc({ plant: { ...spec099, N: 1 } }) // 有效性指標 Pγπ/(2N(2−γ)) = 1.05 > 0.05
    return out
  }

  const msgs = collect()

  it('每一種訊息都觸發到了（共 50 條以上）', () => {
    expect(msgs.length).toBeGreaterThanOrEqual(50)
    for (const key of ['不是半正定', '無法用', '沒有任何激勵', '錯誤極性', '超過上限', 'NLMS 無法正規化', '不能製造缺失的資訊', 'condition number', '已取對稱部分', '不可逆', '更新方向相反', '過度修正', '旋轉', '臨界', '沒有被消除就凍結', '下界', '尺寸不符', '隨機誤差', '中央差分', '模型完全匹配', '超過預算', '迴路不穩定', '有效性指標']) {
      expect(msgs.some((m) => m.includes(key)), key).toBe(true)
    }
  })

  it('`$` 成對；`$...$` 以外沒有 Unicode 拼的數學；整條訊息沒有 1.2e-5 這種指數寫法', () => {
    for (const m of msgs) {
      expect((m.match(/\$/g) ?? []).length % 2, m).toBe(0)
      expect(outsideMath(m), m).not.toMatch(UNICODE_MATH)
      expect(m, m).not.toMatch(/\d[eE][-+]?\d/)
    }
    // 檢查本身抓得到舊的寫法
    expect(outsideMath('ρ(I + MJ) = 1.3093 ≥ 1')).toMatch(UNICODE_MATH)
    expect(outsideMath('Ĵ 奇異（σ_min/σ_max = 5.6e-17）')).toMatch(UNICODE_MATH)
    expect(outsideMath(String.raw`$\rho(\mathbf I+\mathbf M\mathbf J)=1.3093\ge1$：發散`)).not.toMatch(UNICODE_MATH)
  })

  it('數字的寫法：小數用 \\times10^{n}、整數加千分位、數學上是 0 的量不印浮點殘餘', () => {
    const has = (t: string) => expect(msgs.some((m) => m.includes(t)), t).toBe(true)
    has(String.raw`$\sigma_v=-2.5\times10^{-7}\ \mathrm{fs}$ 不合法`)
    has(String.raw`$N=0.5$ 不合法`)
    has(String.raw`$\lambda_{\min}=-0.2000<0$`) // ρ = 1.2 ⇒ λ_min = 1 − 1.2
    has(String.raw`超過上限 $100{,}000$`)
    has(String.raw`$P\times\text{sweeps}\times K=20{,}000{,}000$`)
    has(String.raw`在 $200{,}000$ 個 block 內`)
    has(String.raw`$\varepsilon=1\times10^{-7}$`)
    has(String.raw`$\Delta=2.5\times10^{-7}\ \mathrm{fs}$`)
    has(String.raw`$N_J=4{,}096$ samples`)
    has(String.raw`超過預算 $4\times10^{7}$`)
    has(String.raw`$\kappa=2.00\times10^{4}$`) // ρ = 0.9999 ⇒ κ = 19999
    // ρ = 1：λ_min 與 σ_min/σ_max 數學上是 0，訊息不印 2.2e−16 之類的殘餘
    has(String.raw`$\lambda_{\min}(\mathbf R)\approx0$（不到 $\lambda_{\max}$ 的 $10^{-12}$ 倍）`)
    has(String.raw`$\sigma_{\min}/\sigma_{\max}\le10^{-12}$`)
    // R 形式的 regularizer：和是負的就印數字（−1 + 0.1 = −0.9），是 0（含浮點殘餘）就印 0
    has(String.raw`$\lambda_{\min}(\hat{\mathbf R})+\lambda_{\mathrm{reg}}=-0.900<0$`)
    has(String.raw`$\lambda_{\min}(\hat{\mathbf R})+\lambda_{\mathrm{reg}}=0$`)
    for (const m of msgs) expect(m, m).not.toMatch(/10\^\{-1[5-9]\}/)
    // 失穩說明裡的數字不變：T18 的 1.2、過度修正的 loop gain 2.985、旋轉的 0.95 ± j1.00
    has(String.raw`$\rho(\mathbf I+\mathbf M\mathbf J)=1.2000\ge1$：平均誤差沿 pole $1.200$ 的模式發散`)
    has(String.raw`loop gain $1-p=2.985>2$`)
    has(String.raw`複數 pole $0.9500\pm j1.00$（$|p|=1.379$）`)
  })
})

describe('mimo：審查 R06a——p = 1 − μK_qλ 是線性模型的 pole；1-bit 時只在小訊號區成立', () => {
  it('審查者的反例：單一參數、λ = 1、σ_v = 1、μ = 0.1、δ₀ = σ_v ⇒ 線性式給 0.9202，精確平均（Bussgang）是 0.9436', () => {
    const plant = buildPlant({ mode: 'R', R: [[1]], sigmaV: 1, N: 1 })
    expect(plant.errors).toEqual([])
    const Kq = plant.Kq
    expect(Kq).toBeCloseTo(0.7978845608, 10) // √(2/π)
    // 線性模型：F-10.3 的 pole = 1 − μK_qλ
    const an = analyzeRule(plant, rule({ rule: 'scalar', muKq: 0.1 * Kq }), plant.Jn)
    expect(an.closedPoles![0]).toBeCloseTo(0.9202115439, 10)
    // 精確的條件平均：E[sign(u·δ + v)·u] = √(2/π)·δ/√(σ_v² + δ²) = 1/√π（δ = σ_v = 1）
    const G = signGmacMean(plant, [1])[0]
    expect(G).toBeCloseTo(1 / Math.sqrt(Math.PI), 12)
    expect(G).toBeCloseTo(0.5641895835, 10)
    expect(1 - 0.1 * G).toBeCloseTo(0.9435810416, 10)
    // 線性式高估修正量 √2 倍（s_δ = 1 ⇒ 增益壓縮 1/√2）
    expect((1 - an.closedPoles![0]) / (0.1 * G)).toBeCloseTo(Math.SQRT2, 12)
  })

  it('對照：小訊號（δ₀ = 0.01σ_v）時兩者只差 5×10⁻⁵（1 − 1/√1.0001）；linear 引擎（G = K_qRδ + η）本來就照這個 pole 走', () => {
    const plant = buildPlant({ mode: 'R', R: [[1]], sigmaV: 1, N: 1 })
    const G = signGmacMean(plant, [0.01])[0]
    expect(G / (plant.Kq * 0.01)).toBeCloseTo(1 / Math.sqrt(1 + 1e-4), 12)
    expect(Math.abs(G / (plant.Kq * 0.01) - 1)).toBeLessThan(1e-4)
    const mom = propagateLinearMoments(plant, rule({ rule: 'scalar', muKq: 0.1 * plant.Kq }), plant.Jn, [1], 3)!
    expect(mom.mean[0][1]).toBeCloseTo(0.9202115439, 10)
    expect(mom.mean[0][2]).toBeCloseTo(0.9202115439 ** 2, 10)
  })
})
