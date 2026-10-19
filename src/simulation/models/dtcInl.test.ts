import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_STRUCTURE,
  MASH_CODE_AUTOCORR,
  MASH_CODE_FIR,
  MASH_RESIDUE_AUTOCORR,
  UNIFORM_CODE_AUTOCORR,
  UNIFORM_KAPPA4,
  analyzeInlStructure,
  basisComparison,
  basisValue,
  eig2,
  foldedPsdDc,
  foldedPsdDcLinearProcess,
  foldingAnalysis,
  foldingPrediction,
  generateInlCode,
  hankelFromMoments,
  hardwareCost,
  iidSquaredPsdDc,
  inbandPower,
  inlValue,
  kqFromSigma,
  lutApproxRms,
  lutClosedForm,
  meanFieldResidual,
  modeAnalysis,
  momentMatrix,
  paramNames,
  regressor,
  segmentClosedForm,
  segmentIndex,
  simulateInlLms,
  uniformMomentMatrix,
  uniformProjection,
  type InlLmsParams,
  type PolyBasis,
  type StructureConfig,
} from './dtcInl'

/**
 * Ch11b 模型（dtcInl.ts）與 Python golden（golden/lms_pll_golden/dtc_inl.py）的交叉比對：
 *   golden/vectors/dtc_inl_folding.json、dtc_inl_segments.json、dtc_inl_basis.json。
 * 判定規則同 golden/README.md §5：|actual − expected| ≤ abs + rel·|expected|；整數門檻（k95）用 abs = 0。
 * 另有模擬本身的 sanity（收斂到下限、gauge 奇異、警告）；Monte Carlo 的數字不放進 vectors（RNG 不同）。
 */

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
const load = (name: string): GoldenVector => JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector

function expectClose(actual: number, v: GoldenVector, key: string, index?: number | [number, number]) {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const raw = v.expected[key]
  let exp: number
  if (index === undefined) exp = raw as number
  else if (typeof index === 'number') exp = (raw as number[])[index]
  else exp = (raw as number[][])[index[0]][index[1]]
  expect(Number.isFinite(actual), `${key}${index !== undefined ? `[${index}]` : ''} 有限`).toBe(true)
  expect(Math.abs(actual - exp), `${key}${index !== undefined ? `[${index}]` : ''}: ${actual} vs ${exp}`).toBeLessThanOrEqual((tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(exp))
}

const SHAPE20 = { d2: 20, d3: 0, sawAmp: 0, sawSegments: 8 }
const cfg = (o: Partial<StructureConfig>): StructureConfig => ({ ...DEFAULT_STRUCTURE, ...o })

describe('Ch11b 噪聲折返（golden/vectors/dtc_inl_folding.json）', () => {
  const v = load('dtc_inl_folding')

  it('MASH 1-1-1 residue 與正規化 code 的自相關 (1/12)[6, −4, 1]、(1/48)[6, −4, 1]', () => {
    for (let m = 0; m < 3; m++) {
      expectClose(MASH_RESIDUE_AUTOCORR[m], v, 'R_residue', m)
      expect(Math.abs(MASH_CODE_AUTOCORR[m] - (v.inputs.R_code as number[])[m])).toBeLessThanOrEqual(1e-15)
    }
    expectClose(MASH_CODE_AUTOCORR[0], v, 'sigma2_code')
  })

  it('Gaussian–Isserlis：S_2(0) = 2ΣR² = 35/576、S_3(0) = 6ΣR³ = 5/1024；uniform iid 2σ⁴ = 2/9', () => {
    expectClose(foldedPsdDc(MASH_CODE_AUTOCORR, 2), v, 'S2_unit_gaussian')
    expectClose(foldedPsdDc(MASH_CODE_AUTOCORR, 3), v, 'S3_unit_gaussian')
    expect(foldedPsdDc(MASH_CODE_AUTOCORR, 2)).toBeCloseTo(35 / 576, 15)
    expect(foldedPsdDc(MASH_CODE_AUTOCORR, 3)).toBeCloseTo(5 / 1024, 15)
    expectClose(foldedPsdDc(UNIFORM_CODE_AUTOCORR, 2), v, 'uniform_S2_unit_gaussian')
  })

  it('線性過程精確式：κ_4 = −1/120、Σh² = 3/2、S_2(0) = 121/2880；uniform iid Var(x²) = 4/45', () => {
    expectClose(UNIFORM_KAPPA4, v, 'kappa4_uniform')
    expectClose(MASH_CODE_FIR.reduce((s, h) => s + h * h, 0), v, 'sum_h2')
    expectClose(foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), v, 'S2_unit_exact')
    expect(foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4)).toBeCloseTo(121 / 2880, 15)
    expectClose(iidSquaredPsdDc(0.2, 1 / 3), v, 'uniform_var_x2')
  })

  it('d_2 = 20、ν_B = 0.01 的帶內功率：Gaussian 0.48611、精確 0.33611、rms、殘餘功率與帶內比例；d_3 = 10 的 gain 吸收 3.75', () => {
    const pred = foldingPrediction(MASH_CODE_AUTOCORR, { d2: 20, d3: 0 }, 0.01)
    expectClose(pred.Pin, v, 'Pin_gaussian_d2')
    expectClose(pred.rmsIn, v, 'rms_in_gaussian_d2')
    expectClose(pred.residualPower, v, 'residual_power_gaussian_d2')
    expectClose(pred.inbandFraction, v, 'inband_fraction_gaussian_d2')
    expectClose(inbandPower(400 * foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), 0.01), v, 'Pin_exact_d2')
    const p3 = foldingPrediction(MASH_CODE_AUTOCORR, { d2: 0, d3: 10 }, 0.01)
    expectClose(p3.Pin, v, 'Pin_gaussian_d3')
    expectClose(p3.gainAbsorbed, v, 'gain_absorbed_d3')
    expectClose(p3.residualPower, v, 'residual_power_gaussian_d3')
    expectClose(inbandPower(400 * iidSquaredPsdDc(0.2, 1 / 3), 0.01), v, 'uniform_Pin_exact_d2')
  })

  it('foldingAnalysis（MASH、frac 0.618、2^16 樣本）：樣本自相關 ≈ 理論、Welch 帶內功率 ≈ 精確式（±8%）、Gaussian 式高估、峰度 ≈ 2.4', () => {
    const r = foldingAnalysis({ code: { kind: 'mash111', frac: 0.618, length: 1 << 16 }, shape: SHAPE20, sigmaV: 10, fs: 100e6, fB: 1e6, seed: 1 })
    for (let m = 0; m < 3; m++) expect(Math.abs(r.Rx[m] - MASH_CODE_AUTOCORR[m])).toBeLessThan(4e-3)
    expect(Math.abs(r.PinMeasured - r.PinExactTheory) / r.PinExactTheory).toBeLessThan(0.08)
    expect(Math.abs(r.PinExactAutocov - r.PinMeasured) / r.PinMeasured).toBeLessThan(0.08)
    expect(r.PinGaussianTheory).toBeGreaterThan(1.3 * r.PinMeasured)
    expect(r.PinGaussianEmpirical / r.PinGaussianTheory).toBeCloseTo(1, 1)
    expect(Math.abs(r.kurtosis - 2.4)).toBeLessThan(0.1)
    expect(r.gainAbsorbedMeasured).toBeCloseTo(0, 2)
    expect(r.nuB).toBeCloseTo(0.01, 12)
    expect(r.welch.nperseg).toBe(4096)
    expect(r.f.length).toBeLessThanOrEqual(1024)
    expect(r.psdResidual.length).toBe(r.f.length)
    // 結構可 structured clone（worker 回傳）
    expect(() => structuredClone(r)).not.toThrow()
  })

  it('foldingAnalysis（三次 INL）：gain 校正吸收 ≈ 3d_3E[x²]·(E[x⁴]/(3σ⁴)) 的量測值，Gaussian 預測 3d_3σ²；uniform iid 的帶內 = Var(x²)·2ν_B', () => {
    const r3 = foldingAnalysis({ code: { kind: 'mash111', frac: 0.618, length: 1 << 16 }, shape: { ...SHAPE20, d2: 0, d3: 20 }, sigmaV: 10, fs: 100e6, fB: 1e6, seed: 1 })
    expect(r3.gainAbsorbedMeasured).toBeGreaterThan(5)
    expect(r3.gainAbsorbedGaussian).toBeCloseTo(3 * 20 * r3.sigma2, 6)
    expect(Number.isNaN(r3.PinExactTheory)).toBe(true)
    const ru = foldingAnalysis({ code: { kind: 'uniform', length: 1 << 16 }, shape: SHAPE20, sigmaV: 10, fs: 100e6, fB: 1e6, seed: 1 })
    expect(Math.abs(ru.PinMeasured - ru.PinExactTheory) / ru.PinExactTheory).toBeLessThan(0.1)
    expect(ru.PinGaussianTheory / ru.PinExactTheory).toBeCloseTo(2.5, 1)
  })

  it('鋸齒與 first-order 的警告；f_B 解析度不足與 f_B ≥ f_s/2 的錯誤', () => {
    const saw = foldingAnalysis({ code: { kind: 'mash111', frac: 0.618, length: 1 << 14 }, shape: { ...SHAPE20, d2: 0, sawAmp: 5 }, sigmaV: 0, fs: 100e6, fB: 1e6, seed: 1 })
    expect(saw.warnings.some((w) => w.includes('鋸齒'))).toBe(true)
    expect(Number.isNaN(saw.PinExactAutocov)).toBe(true)
    const fo = foldingAnalysis({ code: { kind: 'first_order', frac: 0.3, length: 1 << 14 }, shape: SHAPE20, sigmaV: 0, fs: 100e6, fB: 1e6, seed: 1 })
    expect(fo.warnings.some((w) => w.includes('first-order'))).toBe(true)
    const narrow = foldingAnalysis({ code: { kind: 'uniform', length: 1 << 12 }, shape: SHAPE20, sigmaV: 0, fs: 100e6, fB: 20e3, nperseg: 1024, seed: 1 })
    expect(narrow.warnings.some((w) => w.includes('解析度'))).toBe(true)
    expect(() => foldingAnalysis({ code: { kind: 'uniform', length: 1 << 10 }, shape: SHAPE20, sigmaV: 0, fs: 100e6, fB: 60e6, seed: 1 })).toThrow(/f_B/)
  })
})

describe('Ch11b 分段／LUT 的封閉式（golden/vectors/dtc_inl_segments.json）', () => {
  const v = load('dtc_inl_segments')

  it('K = 8、μ = 2、σ_v = 10、N = 64：每段的 λ_k、g、pole、k95（整數相同）、τ、std；外／內段比 37', () => {
    expectClose(kqFromSigma(10), v, 'Kq')
    for (let k = 0; k < 8; k++) {
      const s = segmentClosedForm(k, 8, 2, 10, 64)
      expectClose(s.lambda, v, 'segment_lambda', k)
      expectClose(s.g, v, 'segment_g', k)
      expectClose(s.pole, v, 'segment_pole', k)
      expectClose(s.k95, v, 'segment_k95', k)
      expectClose(s.tau, v, 'segment_tau', k)
      expectClose(s.stdW, v, 'segment_std_w', k)
    }
    expectClose(segmentClosedForm(7, 8, 2, 10, 64).lambda / segmentClosedForm(4, 8, 2, 10, 64).lambda, v, 'lambda_ratio_outer_inner')
    // uniformMomentMatrix 的對角線 = 同一組 λ_k
    const R = uniformMomentMatrix(cfg({ structure: 'piecewise', K: 8 }))
    for (let k = 0; k < 8; k++) expectClose(R[k][k], v, 'segment_lambda', k)
    expectClose(Math.sqrt(2 / (2 * kqFromSigma(10) * 64)), v, 'small_g_std')
  })

  it('LUT 64 格：p_j、g、pole、τ、k95、每格樣本數、有效平均長度、std；近似誤差 Δ√(E[d′²]/12)', () => {
    const l = lutClosedForm(64, 2, 10, 64)
    expectClose(l.pj, v, 'lut_pj')
    expectClose(l.g, v, 'lut_g')
    expectClose(l.pole, v, 'lut_pole')
    expectClose(l.tau, v, 'lut_tau')
    expectClose(l.k95, v, 'lut_k95')
    expectClose(l.samplesPerBinPerTau, v, 'lut_samples_per_bin_per_tau')
    expectClose(l.effectiveSamples, v, 'lut_effective_samples')
    expectClose(l.stdTheta, v, 'lut_std_theta')
    expectClose(lutApproxRms({ d2: 20, d3: 0 }, 64), v, 'lut_approx_rms_d2_20')
    expectClose(lutApproxRms({ d2: 20, d3: 10 }, 64), v, 'lut_approx_rms_d2_20_d3_10')
  })

  it('modeAnalysis 在對角 R（分段、uniform 封閉式）上給出同一組 pole／k95／std（特徵值由大到小）', () => {
    const R = uniformMomentMatrix(cfg({ structure: 'piecewise', K: 8 }))
    const m = modeAnalysis(R, kqFromSigma(10), 2, 64)
    const lam = (v.expected.segment_lambda as number[]).slice().sort((a, b) => b - a)
    m.lambdas.forEach((l, i) => expect(l).toBeCloseTo(lam[i], 12))
    expect(m.k95Slowest).toBe(Math.max(...(v.expected.segment_k95 as number[])))
    expect(m.cond).toBeCloseTo(v.expected.lambda_ratio_outer_inner as number, 9)
    // 對角 R：每個參數的 std = 各自模式的 std
    const std = (v.expected.segment_std_w as number[]).slice().sort((a, b) => a - b)
    m.paramStd.slice().sort((a, b) => a - b).forEach((s, i) => expect(s).toBeCloseTo(std[i], 12))
    expect(m.stable).toBe(true)
    expect(m.singular).toBe(false)
  })
})

describe('Ch11b 多項式基底（golden/vectors/dtc_inl_basis.json）', () => {
  const v = load('dtc_inl_basis')
  const bases: PolyBasis[] = ['monomial', 'legendre', 'legendre_norm', 'chebyshev']

  it.each(bases)('%s：uniform x 的 R、特徵值、條件數、θ*、μ（μK_qλ_max = 0.1）與 mean-field k95 都與 golden 一致', (basis) => {
    const c = cfg({ structure: 'poly', M: 3, basis })
    const R = uniformMomentMatrix(c)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) expectClose(R[i][j], v, `${basis}_R`, [i, j])
    const Kq = kqFromSigma(10)
    const m = modeAnalysis(R, Kq, 1, 64)
    m.lambdas.forEach((l, i) => expectClose(l, v, `${basis}_lambdas`, i))
    expectClose(m.cond, v, `${basis}_cond`)
    const p = uniformProjection((x) => inlValue(x, { ...SHAPE20, d3: 10 }), c)
    const theta = lsOptimumFromR(R, p)
    theta.forEach((t, i) => expectClose(t, v, `${basis}_theta_star`, i))
    const mu = 0.1 / (Kq * m.lambdaMax)
    expectClose(mu, v, `${basis}_mu_gmax_0p1`)
    const mf = meanFieldResidual(R, theta.map((t) => -t), Kq, mu, 5000, 0)
    expectClose(mf.k95, v, `${basis}_k95_mean_field`)
  })

  it('Hankel 的 2×2 分塊手算：偶 {1, x²}、奇 {x, x³} 的特徵值與條件數 ≈ 67.5；Legendre 7、normalized 1', () => {
    const [eh, el] = eig2(1, 1 / 3, 1 / 5)
    const [oh, ol] = eig2(1 / 3, 1 / 5, 1 / 7)
    expectClose(eh, v, 'hankel_even_eig', 0)
    expectClose(el, v, 'hankel_even_eig', 1)
    expectClose(oh, v, 'hankel_odd_eig', 0)
    expectClose(ol, v, 'hankel_odd_eig', 1)
    expectClose(eh / ol, v, 'hankel_cond_by_hand')
    expect(hankelFromMoments(1 / 3, 1 / 5, 1 / 7)).toEqual(uniformMomentMatrix(cfg({ structure: 'poly', M: 3, basis: 'monomial' })))
    expect(modeAnalysis(uniformMomentMatrix(cfg({ structure: 'poly', M: 3, basis: 'legendre' })), 1, 1, 64).cond).toBeCloseTo(7, 9)
    expect(modeAnalysis(uniformMomentMatrix(cfg({ structure: 'poly', M: 3, basis: 'legendre_norm' })), 1, 1, 64).cond).toBeCloseTo(1, 9)
    expect(v.expected.monomial_cond as number).toBeGreaterThan(60)
  })

  it('basisValue：Legendre／Chebyshev 遞迴與已知值；normalized Legendre 在 uniform 下正交歸一（樣本 R ≈ I）', () => {
    expect(basisValue('legendre', 2, 0.5)).toBeCloseTo((3 * 0.25 - 1) / 2, 12)
    expect(basisValue('legendre', 3, 0.5)).toBeCloseTo((5 * 0.125 - 3 * 0.5) / 2, 12)
    expect(basisValue('chebyshev', 3, 0.5)).toBeCloseTo(4 * 0.125 - 3 * 0.5, 12)
    expect(basisValue('legendre_norm', 1, 0.5)).toBeCloseTo(Math.sqrt(3) * 0.5, 12)
    const x = generateInlCode({ kind: 'uniform', length: 1 << 16, seed: 3 }).x
    const R = momentMatrix(x, cfg({ structure: 'poly', M: 3, basis: 'legendre_norm' }))
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) expect(Math.abs(R[i][j] - (i === j ? 1 : 0))).toBeLessThan(0.03)
  })

  it('basisComparison（uniform、M = 3）：條件數順序 monomial > Legendre ≈ Chebyshev > normalized；mean-field k95 與 golden 同量級，MC 的 k95 在 mean-field 的 0.5–2 倍內', () => {
    const r = basisComparison({ code: { kind: 'uniform' }, shape: { ...SHAPE20, d3: 10 }, M: 3, bases, gMax: 0.1, sigmaV: 10, N: 64, blocks: 3000, a: 1, b: 0, seed: 1 })
    const by = Object.fromEntries(r.rows.map((row) => [row.basis, row]))
    expect(by.monomial.cond).toBeGreaterThan(by.legendre.cond)
    expect(by.legendre.cond).toBeGreaterThan(by.legendre_norm.cond)
    expect(by.legendre_norm.cond).toBeLessThan(1.2)
    for (const basis of bases) {
      const golden = v.expected[`${basis}_k95_mean_field`] as number
      expect(Math.abs(by[basis].k95Analytic - golden) / golden, basis).toBeLessThan(0.15) // 樣本 R vs 封閉式 R
      const mc = by[basis].k95Measured
      expect(mc, basis).not.toBeNull()
      if (mc !== null) expect(mc / by[basis].k95Analytic, basis).toBeGreaterThan(0.5)
      if (mc !== null) expect(mc / by[basis].k95Analytic, basis).toBeLessThan(2)
      expect(by[basis].residualRmsFloor).toBeLessThan(1e-6) // d ∈ span
    }
    expect(() => structuredClone(r)).not.toThrow()
  })
})

/** 用核心的 solve 直接解 R θ = p（測試用；lsOptimum 走樣本路徑） */
function lsOptimumFromR(R: number[][], p: number[]): number[] {
  const n = R.length
  // Gauss 消去（小矩陣）
  const A = R.map((row, i) => [...row, p[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]
    }
  }
  return A.map((row, i) => row[n] / row[i])
}

describe('Ch11b block LMS 模擬（sanity；Monte Carlo 不進 vectors）', () => {
  const base: InlLmsParams = { config: cfg({}), shape: SHAPE20, code: { kind: 'uniform' }, a: 1, w0: 1, b: 0, sigmaV: 10, mu: 2, N: 64, blocks: 3000, algorithm: 'sign', seed: 1 }

  it('regressor：分段 one-hot × x、LUT one-hot、多項式冪次；含 gain 時第一個元素是 x；參數名稱', () => {
    expect(Array.from(regressor(0.9, cfg({ structure: 'piecewise', K: 4 })))).toEqual([0, 0, 0, 0.9])
    expect(Array.from(regressor(-0.9, cfg({ structure: 'lut', J: 4 })))).toEqual([1, 0, 0, 0])
    expect(Array.from(regressor(0.5, cfg({ structure: 'poly', M: 3, basis: 'monomial' })))).toEqual([1, 0.5, 0.25, 0.125])
    expect(Array.from(regressor(0.5, cfg({ structure: 'poly', M: 1, basis: 'monomial', gainMode: 'adapt' })))).toEqual([0.5, 1, 0.5])
    expect(segmentIndex(1, 8)).toBe(7)
    expect(segmentIndex(-1, 8)).toBe(0)
    expect(paramNames(cfg({ structure: 'piecewise', K: 2, gainMode: 'adapt' }))).toEqual(['w', 'w_{1}', 'w_{2}'])
    expect(hardwareCost(cfg({ structure: 'lut', J: 64 })).multipliers).toBe(0)
    expect(hardwareCost(cfg({ structure: 'poly', M: 3 })).multipliers).toBe(3)
  })

  it('分段 K = 8、uniform、d_2 = 20：殘餘 INL 從 ≈ 9.1 降到下限附近；量測 k95 在 mean-field 的 0.5–2 倍內；穩態 rms ≈ 預測（±20%）；外段 std ≈ 預測', () => {
    const r = simulateInlLms(base)
    expect(r.residualRms0).toBeCloseTo(Math.sqrt(400 * (1 / 5 - 1 / 9) + 400 / 9), 0)
    expect(r.residualRmsFloor).toBeGreaterThan(0.5)
    expect(r.residualRmsFinal).toBeLessThan(0.15 * r.residualRms0)
    expect(Math.abs(r.residualRmsFinal - r.residualRmsPredicted) / r.residualRmsPredicted).toBeLessThan(0.2)
    expect(r.k95Measured).not.toBeNull()
    expect(Number.isFinite(r.k95Analytic)).toBe(true)
    expect((r.k95Measured as number) / r.k95Analytic).toBeGreaterThan(0.5)
    expect((r.k95Measured as number) / r.k95Analytic).toBeLessThan(2)
    // 最外段（λ 最大、τ 最短）：量到的 std 與 μ²λ/(N(1−p²)) 一致（±25%）
    expect(Math.abs(r.thetaStd[7] - r.analytic.paramStd[7]) / r.analytic.paramStd[7]).toBeLessThan(0.25)
    expect(r.thetaMean[7]).toBeCloseTo(r.analytic.thetaStar[7], 0)
    // 最內段的 pole 最慢（λ ∝ x²）
    expect(r.analytic.k95Slowest).toBeGreaterThan(5000)
    expect(r.trace.k[r.trace.k.length - 1]).toBe(3000)
    expect(r.curve.residual.length).toBe(201)
    expect(r.cost.memoryWords).toBe(8)
    expect(r.analytic.visit.length).toBe(8)
    expect(r.analytic.visit.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(() => structuredClone(r)).not.toThrow()
  })

  it('LUT 64 格、uniform：收斂到近似誤差下限 ≈ Δ√(E[d′²]/12)，含 misadjustment 的預測與量測相符（±25%）', () => {
    const r = simulateInlLms({ ...base, config: cfg({ structure: 'lut', J: 64 }), blocks: 4000 })
    expect(r.residualRmsFloor).toBeCloseTo(lutApproxRms({ d2: 20, d3: 0 }, 64), 1)
    expect(Math.abs(r.residualRmsFinal - r.residualRmsPredicted) / r.residualRmsPredicted).toBeLessThan(0.25)
    expect(r.cost.multipliers).toBe(0)
  })

  it('MSE-LMS（K_q = 1、η 的變異數 ∝ σ_v²）：pole 與 k95 有限，穩態 rms ≈ 預測', () => {
    const r = simulateInlLms({ ...base, algorithm: 'mse', mu: 0.1 })
    expect(Number.isFinite(r.k95Analytic)).toBe(true)
    expect(r.analytic.Kq).toBe(1)
    expect(Math.abs(r.residualRmsFinal - r.residualRmsPredicted) / r.residualRmsPredicted).toBeLessThan(0.25)
  })

  it('多項式 Legendre M = 3、MASH code：d ∈ span ⇒ 下限 ≈ 0，殘餘 INL 降到 misadjustment 等級；條件數由樣本 R 算出', () => {
    const r = simulateInlLms({ ...base, config: cfg({ structure: 'poly', M: 3, basis: 'legendre' }), shape: { ...SHAPE20, d3: 10 }, code: { kind: 'mash111', frac: 0.618 } })
    expect(r.residualRmsFloor).toBeLessThan(1e-6)
    expect(r.residualRmsFinal).toBeLessThan(0.2 * r.residualRms0)
    expect(r.analytic.cond).toBeGreaterThan(1)
    expect(r.warnings).toEqual([])
  })

  it('gauge：分段／多項式（含 x）與 gain 同時校正 ⇒ R 奇異、LS 最佳解不唯一並警告；LUT + gain 只是「幾乎」共線', () => {
    const pw = analyzeInlStructure({ config: cfg({ gainMode: 'adapt' }), shape: SHAPE20, code: { kind: 'uniform' }, a: 1.2, w0: 1, b: 0, sigmaV: 10, mu: 2, N: 64 })
    expect(pw.mode.singular).toBe(true)
    expect(pw.ls.singular).toBe(true)
    expect(pw.warnings.some((w) => w.includes('奇異'))).toBe(true)
    const poly = analyzeInlStructure({ config: cfg({ structure: 'poly', M: 3, basis: 'monomial', gainMode: 'adapt' }), shape: SHAPE20, code: { kind: 'uniform' }, a: 1.2, w0: 1, b: 0, sigmaV: 10, mu: 2, N: 64 })
    expect(poly.mode.singular).toBe(true)
    const lut = analyzeInlStructure({ config: cfg({ structure: 'lut', J: 16, gainMode: 'adapt' }), shape: SHAPE20, code: { kind: 'uniform' }, a: 1.2, w0: 1, b: 0, sigmaV: 10, mu: 2, N: 64 })
    expect(lut.mode.singular).toBe(false)
    expect(lut.mode.cond).toBeGreaterThan(100)
    // 模擬仍能跑：總補償量收斂（殘餘接近下限），個別參數漂移
    const sim = simulateInlLms({ ...base, config: cfg({ gainMode: 'adapt' }), a: 1.2, blocks: 2000 })
    expect(sim.warnings.some((w) => w.includes('不唯一'))).toBe(true)
    expect(sim.residualRmsFinal).toBeLessThan(0.2 * sim.residualRms0)
  })

  it('缺乏 PE：MASH code（frac 0.3 的 1/10 格點）在 LUT 64 格留下沒被造訪的格 ⇒ 警告、λ_min = 0、k95 ∞', () => {
    const r = analyzeInlStructure({ config: cfg({ structure: 'lut', J: 64 }), shape: SHAPE20, code: { kind: 'mash111', frac: 0.3 }, a: 1, w0: 1, b: 0, sigmaV: 10, mu: 2, N: 64 })
    expect(r.visit.filter((p) => p === 0).length).toBeGreaterThan(10)
    expect(r.mode.singular).toBe(true)
    const sim = simulateInlLms({ ...base, config: cfg({ structure: 'lut', J: 64 }), code: { kind: 'mash111', frac: 0.3 }, blocks: 500 })
    expect(sim.warnings.some((w) => w.includes('完全沒有被 code 造訪'))).toBe(true)
    expect(sim.warnings.some((w) => w.includes('發散'))).toBe(false) // pole = 1 的未激發模式不是發散
  })

  it('Sign-LMS 一開始飽和（殘餘 ≫ σ_v）時警告（勘誤 E01）；μ 太大時 pole ≥ 1 的警告', () => {
    const sat = simulateInlLms({ ...base, sigmaV: 1, blocks: 200 })
    expect(sat.warnings.some((w) => w.includes('飽和'))).toBe(true)
    const big = analyzeInlStructure({ config: cfg({}), shape: SHAPE20, code: { kind: 'uniform' }, a: 1, w0: 1, b: 0, sigmaV: 10, mu: 400, N: 64 })
    expect(big.mode.stable).toBe(false)
    expect(big.warnings.some((w) => w.includes('發散'))).toBe(true)
  })

  it('同 seed 可重現；不同 seed 的最終值在穩態 std 的量級內', () => {
    const a = simulateInlLms({ ...base, blocks: 800 })
    const b = simulateInlLms({ ...base, blocks: 800 })
    expect(Array.from(a.trace.residualRms)).toEqual(Array.from(b.trace.residualRms))
    const c = simulateInlLms({ ...base, blocks: 800, seed: 2 })
    expect(Math.abs(c.thetaFinal[7] - a.thetaFinal[7])).toBeLessThan(6 * a.analytic.paramStd[7])
  })
})
