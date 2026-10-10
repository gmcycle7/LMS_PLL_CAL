import { refValues, T13_SETUP } from './refValues'
import { goldenList, readGolden, withinGolden } from './testUtils'

/**
 * 本頁「代入數字」的來源 refValues()（呼叫站內各章的模擬／解析核心）
 * 與 golden/vectors/*.json（Python NumPy／SciPy 獨立計算）的交叉比對。
 * 容差規則同 golden：|actual − expected| ≤ abs + rel·|expected|。
 */
const r = refValues()

function check(vec: string, key: string, actual: number) {
  const v = readGolden(vec)
  const res = withinGolden(v, key, actual)
  expect(res.ok, res.detail).toBe(true)
}

function checkList(vec: string, key: string, index: number, actual: number, tol = 1e-9) {
  const e = goldenList(readGolden(vec), key)[index]
  expect(Math.abs(actual - e), `${vec}.${key}[${index}]: actual=${actual} expected=${e}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(e)))
}

describe('refValues × golden vectors（Python 獨立計算）', () => {
  it('T01: 手算 LMS w_1 = 1.8、w_2 = 2.28、pole 0.6；δ = a − w 為 2、1.2、0.72', () => {
    check('T01', 'w1', r.t01.w[1])
    check('T01', 'w2', r.t01.w[2])
    check('T01', 'pole', r.t01.pole)
    expect(r.t01.delta).toEqual([2, 1.2, 0.72])
    // δ_{n+1} = (1 − μx²)δ_n（極性不影響 pole）
    expect(r.t01.delta[1] / r.t01.delta[0]).toBeCloseTo(r.t01.pole, 12)
    expect(r.t01.delta[2] / r.t01.delta[1]).toBeCloseTo(r.t01.pole, 12)
  })

  it('T02: 固定 x = 2 的穩定界 0 < μ < 0.5；μ = 0.1 的 pole 0.6', () => {
    check('T02', 'mu_max', r.fixedX.muMax)
    checkList('T02', 'pole_list', 0, r.fixedX.poleAtMu)
  })

  it('T03: Gaussian x 的 mean 界 2、mean-square 界 2/3；±1 code 兩界相同（2）', () => {
    check('T03', 'mu_mean_max', r.stability.meanMuMax)
    check('T03', 'mu_ms_max', r.stability.msMuMax)
    check('T03', 'mu_ms_max_bpsk', r.stability.msMuMaxBpsk)
    // almost-sure 界（E14）：介於 MS 界與 e^{γ+…} ≈ 2.4213 之間，且大於 mean 界
    expect(r.stability.asMuMax).toBeGreaterThan(2.42)
    expect(r.stability.asMuMax).toBeLessThan(2.423)
    expect(r.stability.meanPoleAt05).toBeCloseTo(0.5, 12)
  })

  it('T04: s = 1 fs、σ_v = 100 fs 的 P(q=+1)、E[q]、K_q', () => {
    check('T04', 'p_plus', r.comparator.pPlus)
    check('T04', 'mean_q', r.comparator.meanQ)
    check('T04', 'kq_per_fs', r.comparator.kq)
    check('T04', 'kq_times_s', r.comparator.kqTimesS)
    // K_q·s 高估 E[q] 的相對量 ≈ (s/σ)²/6
    expect(r.comparator.relDiff).toBeCloseTo(1e-4 / 6, 8)
    // s/σ_v = 0.56 時約高估 5%（E 的建議邊界情況）
    expect(r.comparator.linErrAt056).toBeGreaterThan(0.045)
    expect(r.comparator.linErrAt056).toBeLessThan(0.06)
  })

  it('T05: N = 100 的方向機率 —— 嚴格 49.2%、tie 平分 53.2%、CLT 53.2%；N = 101 為 53.2%', () => {
    const v = readGolden('T05')
    const strict = goldenList(v, 'p_exact_strict_list')[0]
    const split = goldenList(v, 'p_exact_split_list')[0]
    const clt = goldenList(v, 'p_clt_list')[0]
    const odd = goldenList(v, 'p_exact_odd_Nplus1_list')[0]
    expect(Math.abs(r.direction.n100.pos - strict)).toBeLessThan(1e-9)
    expect(Math.abs(r.direction.n100.pos + 0.5 * r.direction.n100.tie - split)).toBeLessThan(1e-9)
    expect(Math.abs(r.direction.n100Clt - clt)).toBeLessThan(1e-9)
    expect(Math.abs(r.direction.n101 - odd)).toBeLessThan(1e-9)
    check('T05', 'm', r.direction.m)
    // 三種 tie rule 的機率加起來要一致：P(>0) + P(=0) + P(<0) = 1
    expect(r.direction.n100.pos + r.direction.n100.tie + r.direction.n100.neg).toBeCloseTo(1, 12)
    expect(r.direction.n100PlusRule).toBeCloseTo(r.direction.n100.pos + r.direction.n100.tie, 14)
    // E18：sum 與 average 的平均／標準差差 N 倍
    const N = 10000
    expect(r.direction.sum10000.mean / r.direction.sum10000.meanAvg).toBeCloseTo(N, 6)
    expect(r.direction.sum10000.sd / r.direction.sum10000.sdAvg).toBeCloseTo(N, 6)
  })

  it('T06: 單頻相關 C = (A²/2)|H|cos φ：φ = 120° ⇒ C = −0.25、pole 1.0199（平均發散）；comparator 極性接反的 pole 1.0798', () => {
    check('T06', 'C', r.tone.C)
    check('T06', 'pole', r.tone.pole)
    check('T06', 'reversed_polarity_pole', r.tone.reversedPole)
    expect(Math.sign(r.tone.C)).toBe(readGolden('T06').expected.C_sign)
    expect(r.tone.pole).toBeGreaterThan(1)
    // 輸入條件與 golden 相同
    const inp = readGolden('T06').inputs as Record<string, number>
    expect([r.tone.A, r.tone.mag, r.tone.phiDeg]).toEqual([inp.A, inp.H_mag, inp.phi_deg])
    expect(r.tone.omega).toBeCloseTo(inp.Omega_rad, 15)
  })

  it('T07: Delayed code C_D = (A²/2)|H|cos(φ + ΩD)：φ = −120°、D = 4 ⇒ θ = 0°、C_D = +0.5；D = 0…11 整張表；反面：φ = 0 卻延遲 D = 4 ⇒ −0.25', () => {
    check('T07', 'C_D', r.tone.CD)
    r.tone.CDList.forEach((v, D) => checkList('T07', 'C_D_list', D, v, 1e-12))
    expect(r.tone.CDelay0).toBeCloseTo(r.tone.CDList[0], 15)
    expect(r.tone.CDelay0).toBeLessThan(0) // 不延遲時是負的（極性錯誤）
    expect(r.tone.CDList.indexOf(Math.max(...r.tone.CDList))).toBe(readGolden('T07').expected.best_D)
    expect(r.tone.D).toBe((readGolden('T07').inputs as Record<string, number>).D)
    // 反面測試（code misalignment）
    check('negative_tests', 'misaligned_C_D4_phi0', r.tone.misalignedCD)
    checkList('T07', 'misaligned_C_D_list_phi0', 4, r.tone.misalignedCD, 1e-12)
  })

  it('T08: g = 1 的 pole 0、PM 60°、ω_c = π/3；g*(d)，d = 0…6', () => {
    check('T08', 'pole', r.pm.g1.pole)
    check('T08', 'pm_deg', r.pm.g1.pmDeg)
    check('T08', 'crossover_omega_rad', r.pm.g1.omegaC)
    checkList('T08', 'pm_deg_list', 3, r.pm.g15.pmDeg)
    const g = goldenList(readGolden('delay_bounds'), 'g_crit_list')
    expect(r.pm.gCrit.length).toBe(7)
    r.pm.gCrit.forEach((gi, d) => expect(Math.abs(gi - g[d]), `g*(${d})`).toBeLessThan(1e-12))
    // g = 1.5 的 delay margin 不到 1 個 block（0.426）
    expect(r.pm.g15.delayMargin).toBeGreaterThan(0.42)
    expect(r.pm.g15.delayMargin).toBeLessThan(0.43)
  })

  it('T09: 雙迴路 —— 完整模型 μ < 1、quasi-static 模型 μ < 2（差 2 倍，E19）', () => {
    check('T09', 'mu_max_full', r.dual.muFullHi)
    check('T09', 'mu_max_simplified', r.dual.muSimpHi)
    expect(r.dual.muSimpHi / r.dual.muFullHi).toBeCloseTo(2, 10)
  })

  it('T10: R = [[1, .99], [.99, 1]] 的 eigenvalues 1.99 / 0.01、condition number 199', () => {
    check('T10', 'eig_max', r.mimo.lamMax)
    check('T10', 'eig_min', r.mimo.lamMin)
    check('T10', 'cond', r.mimo.lamMax / r.mimo.lamMin)
  })

  it('T11: 慢 pole 0.995、598 blocks；preconditioned pole 0.5、5 blocks；0.5R⁻¹ 的元素 25.13 / −24.87', () => {
    check('T11', 'slow_pole', r.mimo.slowPole)
    check('T11', 'blocks_95', r.mimo.blocks95)
    check('T11', 'preconditioned_pole', r.mimo.preconditionedPole)
    check('T11', 'preconditioned_blocks_95', r.mimo.preconditionedBlocks95)
    const M = (readGolden('T11').expected.preconditioner_M as number[][])
    expect(Math.abs(r.mimo.mDiag - M[0][0])).toBeLessThan(1e-9)
    expect(Math.abs(r.mimo.mOff - M[0][1])).toBeLessThan(1e-9)
    // E21：R⁻¹ 本身約 ±50，是 0.5R⁻¹ 的兩倍
    expect(r.mimo.rInvDiag).toBeCloseTo(2 * M[0][0], 8)
    expect(r.mimo.rInvOff).toBeCloseTo(2 * M[0][1], 8)
    // E05 / E08：物理 K_q 下慢了兩個數量級
    expect(r.mimo.physicalBlocks95).toBeGreaterThan(50 * r.mimo.blocks95)
    // E37：mode 變異數（127.8 / 0.642 fs²）vs 每個參數的變異數（64.2 fs²）
    const pv = readGolden('preconditioner_variance')
    const slow = goldenList(pv, 'var_lambda_min_list')[0]
    const fast = goldenList(pv, 'var_lambda_max_list')[0]
    expect(Math.abs(r.mimo.modeVarSlow - slow) / slow).toBeLessThan(1e-10)
    expect(Math.abs(r.mimo.modeVarFast - fast) / fast).toBeLessThan(1e-10)
    expect(r.mimo.paramVar).toBeCloseTo((slow + fast) / 2, 8)
  })

  it('T12: 三階 INL —— E[x²] = 2、E[x⁴] = 6.8、MSE-LMS w* = 1.34；Sign-LMS 不同（E01）', () => {
    check('T12', 'Ex2', r.bias.ex2)
    check('T12', 'Ex4', r.bias.ex4)
    check('T12', 'w_star', r.bias.mse)
    // 無雜訊 Sign-LMS 的固定點是 |x| 加權中位數解 1.4；σ_v = 1 時落在 1.34 與 1.4 之間
    expect(r.bias.sign0).toBeCloseTo(1.4, 9)
    expect(r.bias.sign1).toBeGreaterThan(1.34)
    expect(r.bias.sign1).toBeLessThan(1.345)
    // E11：w* 取決於 code 分布
    expect(r.bias.pm1Code).toBeCloseTo(1.1, 12)
    expect(r.bias.gaussianCode).toBeCloseTo(1.3, 12)
  })

  it('T13: K = 0.0079788 fs⁻¹、g = 0.079788、p = 0.92021、σ_w = 0.39919 fs；sum mode g = 326.8（E18 反面）', () => {
    check('T13', 'K_per_fs', r.loop.K)
    check('T13', 'g', r.loop.g)
    check('T13', 'p', r.loop.p)
    check('T13', 'sigma_w_fs', r.loop.sigmaW)
    check('T13', 'g_sum_mode', r.loop.gSum)
    check('T13', 'pole_sum_mode', r.loop.pSum)
    expect(r.loop.Kq).toBeCloseTo(r.loop.K, 15) // C = 1
    // 單位鏈：g = μ[fs]·K[fs⁻¹]
    expect(r.loop.g).toBeCloseTo(T13_SETUP.mu * r.loop.K, 15)
    expect(r.loop.gSum / r.loop.g).toBeCloseTo(T13_SETUP.N, 9)
    // 反面：sum mode 的 pole 在單位圓外
    expect(Math.abs(r.loop.pSum)).toBeGreaterThan(1)
  })

  it('T14: f_u = 976.5625 kHz；(1−p) 12.40 kHz、−ln p 12.92 kHz、exact 12.93 kHz、ENBW 20.29 kHz（E06 / E10 / E26）', () => {
    check('T14', 'f_u_hz', r.loop.fu)
    check('T14', 'bw_one_minus_p_hz', r.loop.f3dbOneMinusP)
    check('T14', 'bw_neg_ln_p_hz', r.loop.f3dbNegLnP)
    check('T14', 'bw_exact_3db_hz', r.loop.f3dbExact)
    check('T14', 'enbw_one_sided_hz', r.loop.enbw)
    // ENBW ≈ (π/2)·f_3dB（一階），所以 √(S(0)·f_3dB) 低估 σ_w 約 20%
    expect(r.loop.enbwOverF3db).toBeGreaterThan(1.56)
    expect(r.loop.enbwOverF3db).toBeLessThan(1.58)
    expect(r.loop.sigmaFromF3db / r.loop.sigmaW).toBeCloseTo(Math.sqrt(1 / r.loop.enbwOverF3db), 12)
    // Parseval：σ_w² = S_w^(1)(0)·ENBW
    expect(r.loop.sw1Dc * r.loop.enbw).toBeCloseTo(r.loop.sigmaW ** 2, 14)
    // rad/block 與 rad/sample 差 N 倍
    expect(r.loop.omega3dbBlock / r.loop.theta3dbSample).toBeCloseTo(T13_SETUP.N, 8)
    // E27：−3 dB 點存在的範圍 3 − 2√2 ≤ p < 1
    expect(r.loop.pMin3db).toBeCloseTo(3 - 2 * Math.SQRT2, 14)
    expect(r.loop.muKMax3db).toBeCloseTo(2 * Math.SQRT2 - 2, 14)
  })

  it('T15: f_out = 13 GHz、A_t = 0.5 fs ⇒ β = 4.084e−5 rad、spur −93.80 dBc（小角與 Bessel 一致）', () => {
    check('T15', 'beta_rad', r.spur.beta)
    check('T15', 'spur_dbc', r.spur.dbc)
    check('T15', 'spur_dbc_bessel', r.spur.dbcBessel)
    // 1 fs ↔ 2π·f_out·1e−15 rad
    expect(r.spur.radPerFs).toBeCloseTo(2 * Math.PI * 13e9 * 1e-15, 18)
    expect(r.spur.beta).toBeCloseTo(r.spur.radPerFs * r.spur.At, 18)
  })

  it('T16: 32.4 的週期 5 pattern —— 兩條譜線 |c_1| = 0.1236、|c_2| = 0.3236 LSB；總功率 0.24 LSB²', () => {
    const mags = goldenList(readGolden('T16'), 'dft_mag_list')
    expect(Math.abs(r.quant.f5Peak / 2 - mags[1])).toBeLessThan(1e-12)
    expect(Math.abs(r.quant.f25Peak / 2 - mags[2])).toBeLessThan(1e-12)
    expect(r.quant.f5Power).toBeCloseTo(2 * mags[1] ** 2, 12)
    expect(r.quant.f25Power).toBeCloseTo(2 * mags[2] ** 2, 12)
    // Parseval（E47）：DC 之外的線功率和 = p(1 − p) = 0.24；DC 線是 0（平均無偏）
    expect(r.quant.total).toBeCloseTo(0.24, 12)
    // E49：freeze 的誤差 0.16 LSB² 全在 DC；white-uniform 模型 2/12 不等於 0.24
    expect(r.quant.freezePower).toBeCloseTo(0.16, 12)
    expect(r.quant.whiteModel).toBeCloseTo(1 / 6, 14)
    // 2f/5 才是主 tone：高 8.36 dB
    expect(r.quant.ratioDb).toBeCloseTo(20 * Math.log10(mags[2] / mags[1]), 9)
    expect(r.quant.ratioDb).toBeGreaterThan(8)
  })

  it('T17: stochastic rounding 32 / 33、P(high) = 0.4 的變異數 0.24 LSB²', () => {
    check('T17', 'variance', r.quant.stochasticVar)
  })

  it('T18: J = [[−1, 2], [2, −1]]、M = 0.2I ⇒ eig(I + MJ) = 1.2、0.4（一起更新時發散）', () => {
    const e = goldenList(readGolden('T18'), 'eig_A_desc')
    expect(Math.abs(r.mimo.t18Eig[0] - e[0])).toBeLessThan(1e-12)
    expect(Math.abs(r.mimo.t18Eig[1] - e[1])).toBeLessThan(1e-12)
    expect(Math.max(...r.mimo.t18Eig.map(Math.abs))).toBeGreaterThan(1)
  })
})

describe('refValues：非 golden 的衍生量（以獨立公式驗算）', () => {
  it('E20：polarity margin —— θ = −150° 是 −60°（mod 180° 的寫法會錯給 +60°）；θ = 200° 是 −70°', () => {
    expect(r.polarity.correct).toBeCloseTo(-60, 10)
    expect(r.polarity.bug).toBeCloseTo(60, 10)
    expect(r.polarity.correct200).toBeCloseTo(-70, 10)
    // arcsin(cos θ) 的獨立計算
    expect(r.polarity.correct).toBeCloseTo((Math.asin(Math.cos((-150 * Math.PI) / 180)) * 180) / Math.PI, 10)
  })

  it('E16：corner-based μ 區間 —— 非空條件 B ≥ ln ε / ln(1 − K_min/K_max) = 11.36 → 12', () => {
    expect(r.corner.bMin).toBeCloseTo(Math.log(0.01) / Math.log(2 / 3), 12)
    expect(r.corner.bCeil).toBe(12)
    expect(r.corner.muLo).toBeCloseTo((1 - Math.pow(r.corner.eps, 1 / r.corner.B)) / r.corner.kMin, 12)
    expect(r.corner.muHi).toBeCloseTo(1 / r.corner.kMax, 12)
    expect(r.corner.muLo).toBeLessThanOrEqual(r.corner.muHi)
    // 反面：B = 11 時區間是空的
    const lo11 = (1 - Math.pow(r.corner.eps, 1 / 11)) / r.corner.kMin
    expect(lo11).toBeGreaterThan(r.corner.muHi)
  })

  it('T04: 反面 —— 0/1 位元未映射成 ±1：w = a 時的平均更新是 E[x]/2 = 0.125，固定點偏移 +41.27 fs', () => {
    check('T04', 'wrong_encoding_mean_update_at_w_eq_a', r.encoding.meanUpdateAtTruth)
    check('T04', 'wrong_encoding_fixed_point_shift_fs', r.encoding.shiftFs)
    expect(r.encoding.meanX).toBeCloseTo(0.25, 14)
    expect(r.encoding.meanUpdateAtTruth).toBeCloseTo(r.encoding.meanX / 2, 12)
    // 正確映射（q = 2b − 1）時在 w = a 的平均更新為 0；零均值 code 即使沒映射也是 0（只有增益減半）
    expect(r.encoding.meanUpdateBipolar).toBeCloseTo(0, 14)
    expect(r.encoding.zeroMeanUpdate).toBeCloseTo(0, 14)
    // 線性化估計 E[x]/(K_q E[x²]) ≈ 39.6 fs：與精確值同量級、略小（偏移已達 0.4σ_v，erf 開始彎）
    expect(r.encoding.ex2).toBeCloseTo(4.75 / 6, 14)
    expect(r.encoding.shiftLinear).toBeCloseTo(0.25 / (r.comparator.kq * (4.75 / 6)), 10)
    expect(r.encoding.shiftLinear).toBeGreaterThan(38)
    expect(r.encoding.shiftLinear).toBeLessThan(r.encoding.shiftFs)
    const neg = readGolden('negative_tests')
    expect(Math.abs(r.encoding.meanUpdateAtTruth - (neg.expected.wrong_encoding_update_at_truth_dc_code as number))).toBeLessThan(1e-12)
  })

  it('單位與時間索引的例子：fs ↔ rad ↔ UI、sample ↔ block、code 尺度與 μ 的關係', () => {
    const u = r.units
    // 1 fs 在 f_ref = 4 GHz 是 2π·4e9·1e−15 rad；output 端乘上 f_out/f_ref = 3.25
    expect(u.radPerFsRef).toBeCloseTo(2 * Math.PI * 4e9 * 1e-15, 20)
    expect(r.spur.radPerFs / u.radPerFsRef).toBeCloseTo(u.divRatio, 12)
    expect(u.divRatio).toBeCloseTo(3.25, 12)
    expect(u.uiPerFsOut).toBeCloseTo(1.3e-5, 18)
    // 1 sample = 250 ps、1 block = 1.024 μs
    expect(u.samplePeriodPs).toBeCloseTo(250, 9)
    expect(u.blockPeriodUs).toBeCloseTo(1.024, 12)
    expect(u.blockPeriodUs * 1e-6 * r.loop.fu).toBeCloseTo(1, 12)
    // n = 10000 落在 block k = 2（8192 … 12287）；commit latency n_c = 2000 時仍在用 block 1 的係數
    expect(u.exampleK).toBe(2)
    expect(u.exampleBlockStart).toBe(8192)
    expect(u.exampleBlockEnd).toBe(12287)
    expect(u.exampleN).toBeGreaterThanOrEqual(u.exampleBlockStart)
    expect(u.exampleN).toBeLessThanOrEqual(u.exampleBlockEnd)
    expect(u.exampleKWithLatency).toBe(1)
    // code 放大 k_x 倍：C 變 k_x² 倍，μ 要除以 k_x² 才維持同一個 g（否則 g 放大 k_x² 倍）
    expect(u.scale.gScaled).toBeCloseTo(r.loop.g, 14)
    expect(u.scale.gIfMuNotRescaled / r.loop.g).toBeCloseTo(u.scale.kx ** 2, 9)
    expect(u.scale.muScaled * u.scale.cScaled).toBeCloseTo(10, 12)
    // σ_w 的三種單位
    expect(u.sigmaWLsb).toBeCloseTo(r.loop.sigmaW / 0.125, 12)
    expect(u.sigmaWRad).toBeCloseTo(r.loop.sigmaW * r.spur.radPerFs, 18)
    // sum mode 的等效 μ
    expect(u.muSumEquivalent).toBeCloseTo(10 / 4096, 15)
    // Part A：μ 的單位是 1/[x]²，x 放大 10 倍 ⇒ μ_max 縮小 100 倍
    expect(u.lmsScale.muMax1 / u.lmsScale.muMax2).toBeCloseTo(100, 10)
  })

  it('E28 / E29：PSD 正規化 —— 單邊 per-Hz = (2/f_r)·DTFT 形式；ZOH 之後 per-Hz 在 DC 不變、DTFT 形式差 N 倍', () => {
    const q = r.psd
    // S_w(e^{j0}) = μ²σ_η²/(1 − p)²
    expect(q.swDtftDc).toBeCloseTo((100 / 4096) / (1 - r.loop.p) ** 2, 10)
    expect(q.sw1Dc).toBeCloseTo((2 / r.loop.fu) * q.swDtftDc, 18)
    expect(q.sw1Dc).toBeCloseTo(r.loop.sw1Dc, 18)
    // 忘了換算的誤差：10log10(f_u/2) ≈ 56.9 dB（block）、10log10(f_s/2) ≈ 93.0 dB（sample）
    expect(q.dbErrBlock).toBeCloseTo(10 * Math.log10(976562.5 / 2), 10)
    expect(q.dbErrSample).toBeCloseTo(93.0103, 3)
    expect(q.dbErrSample - q.dbErrBlock).toBeCloseTo(10 * Math.log10(4096), 9)
    // ZOH：DTFT 形式在 DC 放大 N 倍；但 per-Hz（物理量）不變
    expect(q.zohOverBlockDtft).toBeCloseTo(4096, 6)
    expect(q.swZoh1Dc / q.sw1Dc).toBeCloseTo(1, 10)
    // f_u/2 處的 ZOH droop：[sin(π/2)/(N·sin(π/(2N)))]² → (2/π)² = −3.92 dB
    expect(q.zohDroopAtHalfFu).toBeCloseTo((2 / Math.PI) ** 2, 6)
    expect(q.zohDroopDb).toBeCloseTo(-3.922, 2)
    // 白序列：S^(1) = 2σ²/f_r，積分 0…f_r/2 得 σ²
    expect(q.whiteEta1 * (r.loop.fu / 2)).toBeCloseTo(1 / 4096, 18)
    // ℒ(f) = 10log10(S_φ^(1)/2)，S_φ = (2π f_out)²·S_t
    expect(q.exampleSphi).toBeCloseTo((2 * Math.PI * 13e9 * 1e-15) ** 2 * 1e-6, 24)
    expect(q.exampleL).toBeCloseTo(10 * Math.log10(q.exampleSphi) - 3.0103, 4)
  })

  it('Part A 的手算例：同一筆資料 LMS 走到 1.4、Sign-Error 走到 1.2；穩態 MSD 0.0625 ≠ MSE 1.25（E42）', () => {
    const st = r.partA.step
    // LMS：w + μ(a − w)x·x；Sign-Error：w + μ·sign(e)·x（入門課第 3 課的數字）
    expect(st.lms).toBeCloseTo(st.w0 + st.mu * (st.a - st.w0) * st.x * st.x, 12)
    expect(st.sign).toBeCloseTo(st.w0 + st.mu * st.x, 12)
    expect([st.lms, st.sign]).toEqual([1.4, 1.2])
    const m = r.partA.msd
    // 封閉式 μP_xσ_v²/(2P_x − μE[x⁴])（validation E42 的數值證據：0.0625）
    expect(m.msd).toBeCloseTo((m.mu * m.px * m.sigmaV ** 2) / (2 * m.px - m.mu * m.px * m.px), 14)
    expect(m.msd).toBeCloseTo(0.0625, 12)
    expect(m.factor).toBeCloseTo((1 - m.mu * m.px) ** 2, 14)
    // 直接疊代 MSD_{n+1} = factor·MSD_n + μ²P_xσ_v² 到收斂，應得到同一個固定點
    let msd = 0
    for (let n = 0; n < 400; n++) msd = m.factor * msd + m.mu * m.mu * m.px * m.sigmaV ** 2
    expect(msd).toBeCloseTo(m.msd, 12)
    expect(m.mse).toBeCloseTo(m.px * m.msd + m.sigmaV ** 2, 14)
    expect(m.mse).toBeCloseTo(1.25, 12)
  })

  it('§14 的 E[δ_B²]（golden msd_after_blocks）：δ0 = 20 fs，B = 10 → 75.95 fs²、B = 40 → 0.6756 fs²；B → ∞ 趨近 σ_w²', () => {
    const g = readGolden('msd_after_blocks')
    const inp = g.inputs as { delta0_fs: number; B_list: number[] }
    expect(r.msdB.delta0).toBe(inp.delta0_fs)
    r.msdB.B.forEach((B, i) => {
      const idx = inp.B_list.indexOf(B)
      expect(idx, `B = ${B} 不在 golden 的 B_list`).toBeGreaterThanOrEqual(0)
      checkList('msd_after_blocks', 'msd_list', idx, r.msdB.msd[i], 1e-11)
    })
    check('msd_after_blocks', 'p', r.loop.p)
    expect(r.msdB.floor).toBeCloseTo(r.loop.sigmaW ** 2, 14)
    expect(r.msdB.msd[1]).toBeGreaterThan(r.msdB.floor)
    expect(r.msdB.msd[0]).toBeGreaterThan(r.msdB.msd[1])
  })

  it('E03：offset 的假 gain bias —— x ∈ {0,1,2,3}、b = 0.5：靜態式 1.2143；共用 BBPD（E[q] = 0）時回到 a = 1', () => {
    const o = r.offsetBias
    expect(o.values).toEqual([0, 1, 2, 3])
    expect([o.ex, o.ex2, o.varX]).toEqual([1.5, 3.5, 1.25])
    expect(o.staticW).toBeCloseTo(o.a + (o.b * o.ex) / o.ex2, 13) // w* = a + bE[x]/E[x²]
    expect(o.staticW).toBeCloseTo(1.2143, 4) // validation E03 的數值證據（MC 1.2140 ± 0.0002）
    expect(o.sharedW).toBeCloseTo(o.a, 13) // Cov(x, 常數 b) = 0
  })

  it('換算器「試試看」的數字是反推出來的：113 fs → 沒有 −3 dB 點、188 fs → high-pass、σ_v = 3.9 fs → g > 2', () => {
    const t = r.tryIt
    expect(t.gSum).toBeCloseTo(r.loop.gSum, 12)
    // μ = 113 fs：p = 1 − g 落在 (0, 3 − 2√2)（E27）
    expect(t.muNo3db).toBe(113)
    expect(1 - t.gNo3db).toBeGreaterThan(0)
    expect(1 - t.gNo3db).toBeLessThan(r.loop.pMin3db)
    // μ = 188 fs：p < 0
    expect(t.muHighPass).toBe(188)
    expect(1 - t.gHighPass).toBeLessThan(0)
    expect(1 - t.gHighPass).toBeGreaterThan(-1)
    // σ_v = 3.9 fs：g 剛超過 2；再大 0.1 fs（4.0 fs）就還穩定
    expect(t.sigmaUnstable).toBeCloseTo(3.9, 12)
    expect(t.gUnstable).toBeGreaterThan(2)
    expect((T13_SETUP.mu * Math.sqrt(2 / Math.PI)) / (t.sigmaUnstable + 0.1)).toBeLessThan(2)
    expect(t.N2).toBe(1024)
  })

  it('refValues() 有快取：兩次呼叫回傳同一個物件；所有數值欄位有限', () => {
    expect(refValues()).toBe(r)
    const bad: string[] = []
    const walk = (o: unknown, path: string) => {
      if (typeof o === 'number') {
        if (!Number.isFinite(o)) bad.push(path)
      } else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`))
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
    }
    walk(r, 'r')
    expect(bad).toEqual([])
  })
})
