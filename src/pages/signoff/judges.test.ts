import { readFileSync } from 'node:fs'
import katex from 'katex'
import { join } from 'node:path'
import { binomCdf, erf, meanCI } from '@/simulation/core'
import { runBlockLmsMonteCarlo } from '@/simulation/models/blockLms'
import * as J from './judges'

/* ── golden vectors（golden/vectors/*.json）：|actual − expected| ≤ abs + rel·|expected| ── */
interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}
function vec(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}
function expectGolden(v: Vector, key: string, actual: number) {
  const e = v.expected[key] as number
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e)
  expect(Math.abs(actual - e), `${key}: actual ${actual} vs golden ${e}`).toBeLessThanOrEqual(bound)
}

describe('§17 反面測試的數學特徵 vs golden/vectors/negative_tests.json', () => {
  const neg = vec('negative_tests')
  const sig = J.negativeSignatures()

  it('T06: 極性反轉 ⇒ pole = 1 + μK > 1（negative_tests 與 T06 兩份 golden）', () => {
    expectGolden(neg, 'reversed_polarity_pole', sig.reversedPolarityPole)
    expectGolden(vec('T06'), 'reversed_polarity_pole', sig.reversedPolarityPole)
    expect(sig.reversedPolarityPole).toBeGreaterThan(1)
  })

  it('T10: 完全缺乏 PE（ρ = 1）⇒ λ_min = 0', () => {
    expectGolden(neg, 'missing_pe_eig_min', sig.missingPeEigMin)
  })

  it('T07: code misalignment（φ = 0、Ω = π/6、D = 4）⇒ C_D = −0.25 < 0', () => {
    expectGolden(neg, 'misaligned_C_D4_phi0', sig.misalignedCD4)
    expect(sig.misalignedCD4).toBeLessThan(0)
  })

  it('T13: sum 模式（沒有 /N）的有效 g 乘 N；與 T13 的 g_sum_mode、pole_sum_mode 一致', () => {
    expectGolden(neg, 'sum_mode_gain_multiplier', sig.sumModeGainMultiplier)
    const t13 = vec('T13')
    expectGolden(t13, 'g_sum_mode', sig.gSumMode)
    expectGolden(t13, 'pole_sum_mode', sig.poleSumMode)
    expect(sig.gWrongNScaling).toBeGreaterThan(2) // N 改 32 倍未重算 ⇒ g > 2 發散
  })

  it('T04: 錯誤 0/1 編碼 ⇒ w = a 的平均更新 E[x]/2 與固定點偏移 +41.27 fs', () => {
    expectGolden(neg, 'wrong_encoding_update_at_truth_dc_code', sig.wrongEncodingUpdateAtTruth)
    expect(J.unipolarUpdateAtTruth([-1, 1])).toBe(0) // 零均值 code 不偏（只是增益減半）
    expect(sig.wrongEncodingShiftFs).toBeCloseTo(vec('T04').expected.wrong_encoding_fixed_point_shift_fs as number, 6)
  })

  it('定點 overflow：6-bit × 4096 需 18 bit；17-bit wrap 成 −4096（翻號）；saturate 不翻號', () => {
    expectGolden(neg, 'gmac_bits_required', sig.gmacBitsRequired)
    expectGolden(neg, 'gmac_17bit_wrapped_sum', sig.gmacWrapped17)
    expect(sig.gmacSumExact).toBe(31 * 4096)
    expect(sig.gmacSaturated17).toBe(2 ** 16 - 1)
    expect(J.wrapTwos(-(2 ** 17), 18)).toBe(-(2 ** 17)) // 18 bit 剛好容納負端
  })

  it('E20：wrap180 寫成 mod 180 會把極性錯誤顯示成正 margin', () => {
    expect(sig.margin200).toBeCloseTo(-70, 12)
    expect(sig.margin200Naive).toBeCloseTo(70, 12)
    expect(sig.marginM150).toBeCloseTo(-60, 12)
    expect(sig.marginM150Naive).toBeCloseTo(60, 12)
  })

  it('路徑混淆：H_PD + T = 1；ω = 0.1ω_n 時 |H_PD| 小但 |T| > 1', () => {
    expect(sig.pathIdentityResidual).toBeLessThan(1e-14)
    expect(sig.hpdAt01).toBeLessThan(0.011)
    expect(sig.tAt01).toBeGreaterThan(1)
  })

  it('aliasing：0.6 f_s 折到 0.4 f_s，兩序列逐點相同', () => {
    expect(sig.aliasOf06).toBeCloseTo(0.4, 12)
    expect(sig.aliasMaxDiff).toBeLessThan(1e-9)
  })

  it('T08: 「公式錯 UI 卻成功」——正確 PM 與數值 crossover 相符，漏掉 /2 的公式不符', () => {
    const t08 = vec('T08')
    expectGolden(t08, 'pm_deg', sig.pmRight)
    expect(Math.abs(sig.pmNumeric - sig.pmRight)).toBeLessThan(1e-9)
    expect(Math.abs(sig.pmWrong - sig.pmNumeric)).toBeGreaterThan(1)
    const gList = t08.inputs.g_list as number[]
    const pmList = t08.expected.pm_deg_list as number[]
    gList.forEach((g, i) => {
      expect(Math.abs(J.pmDeg(g, 0) - pmList[i])).toBeLessThanOrEqual(1e-9)
      expect(Math.abs(J.pmNumeric(g, 0) - pmList[i])).toBeLessThanOrEqual(1e-6)
    })
  })

  it('T13: 獨立的時域 MC 涵蓋正確 σ_w、排除分母寫成 (1 − p) 的錯誤公式', () => {
    const K = J.kq(100)
    const runs = J.linearSigmaWMc({ pole: 1 - 10 * K, mu: 10, sigmaEta: 1 / 64, blocks: 20000, burn: 2000, seeds: 8, seed: 20261010 })
    const ci = meanCI(runs, 0.95)
    expectGolden(vec('T13'), 'sigma_w_fs', sig.sigmaWRight)
    expect(Math.abs(ci.mean - sig.sigmaWRight)).toBeLessThanOrEqual(ci.halfWidth)
    expect(Math.abs(ci.mean - sig.sigmaWWrong)).toBeGreaterThan(5 * ci.halfWidth)
  })

  it('comparator 大偏移：E[q] 飽和在 1 以下，K_q·s 外插 > 1；gauge 有零 eigenvalue', () => {
    expect(sig.eqAt500).toBeLessThan(1)
    expect(sig.eqAt500).toBeGreaterThan(0.99999)
    expect(sig.kqTimesS500).toBeGreaterThan(3.9)
    expect(Math.abs(sig.gaugeEigMin)).toBeLessThan(1e-12)
  })
})

describe('基本正確性：freeze + ±Δw', () => {
  it('中央差分的截斷比：0.3σ_v ⇒ 0.98520、σ_v ⇒ 0.85562（validation.md 的 −1.5% / −14.4%）', () => {
    expect(J.secantRatio(30, 100)).toBeCloseTo(0.9852003, 6)
    expect(J.secantRatio(100, 100)).toBeCloseTo(0.8556244, 6)
    // 二階展開 1 − Δ²/(6σ²) 在小 Δ 時吻合
    expect(J.secantRatio(5, 100)).toBeCloseTo(1 - 25 / 60000, 6)
  })

  it('centralDifference 與 polarityVerdict 的三分法', () => {
    const est = J.centralDifference([-0.1, -0.12, -0.11], [0.1, 0.12, 0.11], 10)
    expect(est.S).toBeCloseTo(-0.011, 12)
    expect(est.K).toBeCloseTo(0.011, 12)
    expect(J.polarityVerdict(est.K, est.se, 3)).toBe('pass')
    expect(J.polarityVerdict(-1, 0.1, 3)).toBe('reversed')
    expect(J.polarityVerdict(0.1, 0.1, 3)).toBe('inconclusive')
    expect(J.polarityVerdict(NaN, 0.1, 3)).toBe('inconclusive')
  })

  it('requiredBlocks：M ≥ z²/(2NΔ²K²)', () => {
    const K = J.kq(100) * Math.cos((85 * Math.PI) / 180)
    const M = J.requiredBlocks(K, 20, 4096, 3)
    expect(M).toBe(Math.ceil(9 / (2 * 4096 * 400 * K * K)))
    expect(J.requiredBlocks(0, 20, 4096, 3)).toBe(Infinity)
  })

  it('slopeStdErr：se = σ_η/(Δ√(2M))、σ_η = 1/√N；requiredBlocks 正好是讓 |K|/se ≥ z 的最小 M', () => {
    expect(J.slopeStdErr(20, 4096, 8)).toBe(1 / 64 / 80)
    // se ∝ 1/(Δ√(MN))
    expect(J.slopeStdErr(40, 4096, 8)).toBeCloseTo(J.slopeStdErr(20, 4096, 8) / 2, 15)
    expect(J.slopeStdErr(20, 4 * 4096, 8)).toBeCloseTo(J.slopeStdErr(20, 4096, 8) / 2, 15)
    expect(J.slopeStdErr(20, 4096, 32)).toBeCloseTo(J.slopeStdErr(20, 4096, 8) / 2, 15)
    for (const [thetaDeg, delta, N, z] of [
      [85, 20, 4096, 3],
      [60, 10, 1024, 6],
      [95, 25, 2048, 2],
      [80, 30, 16384, 4],
    ]) {
      const K = J.kq(100) * Math.cos((thetaDeg * Math.PI) / 180)
      const M = J.requiredBlocks(K, delta, N, z)
      expect(Math.abs(K) / J.slopeStdErr(delta, N, M)).toBeGreaterThanOrEqual(z)
      if (M > 1) expect(Math.abs(K) / J.slopeStdErr(delta, N, M - 1)).toBeLessThan(z)
    }
    // 與實際的估計式一致：每個 block 的樣本變異數剛好是 1/N 時，centralDifference 的 se 就是 slopeStdErr
    const unit = [1, -1, 1, -1, 1, -1]
    const a = Math.sqrt(1 / 1024 / (unit.reduce((s2, u) => s2 + u * u, 0) / (unit.length - 1)))
    const est = J.centralDifference(
      unit.map((u) => 0.2 + a * u),
      unit.map((u) => -0.2 + a * u),
      15,
    )
    expect(est.se).toBeCloseTo(J.slopeStdErr(15, 1024, unit.length), 14)
  })

  it('meanFieldG：±1 code、identity path 時等於 erf((a − w)/(√2σ_v))；三種位元映射的關係', () => {
    const base = { code: 'bpsk' as const, magH: 1, phiDeg: 0, omega: Math.PI / 6, D: 0, sigmaV: 100, a: 3 }
    for (const w of [-50, 3, 40]) {
      const bip = J.meanFieldG({ ...base, mapping: 'bipolar' }, w)
      expect(bip).toBeCloseTo(erf((3 - w) / (Math.SQRT2 * 100)), 14)
      expect(J.meanFieldG({ ...base, mapping: 'reversed' }, w)).toBeCloseTo(-bip, 14)
      expect(J.meanFieldG({ ...base, mapping: 'unipolar' }, w)).toBeCloseTo(bip / 2, 14) // 零均值 code：增益減半、無 offset
    }
    // D ≥ 2：x[n − D] 與 q 獨立 ⇒ 0
    expect(J.meanFieldG({ ...base, mapping: 'bipolar', D: 3 }, 50)).toBe(0)
  })

  it('analyticC：單頻 = |H|cos(φ + ΩD)；±1 code = h[D]', () => {
    expect(J.analyticC({ code: 'tone', magH: 1, phiDeg: -120, omega: Math.PI / 6, D: 4 })).toBeCloseTo(1, 12)
    expect(J.analyticC({ code: 'tone', magH: 1, phiDeg: -120, omega: Math.PI / 6, D: 0 })).toBeCloseTo(-0.5, 12)
    expect(J.analyticC({ code: 'bpsk', magH: 1, phiDeg: 0, omega: 0.5, D: 0 })).toBeCloseTo(1, 12)
    expect(J.analyticC({ code: 'bpsk', magH: 1, phiDeg: 0, omega: 0.5, D: 1 })).toBeCloseTo(0, 12)
  })

  const SHARED = { sigmaV: 100, a: 3, w0: 3, delta: 20, N: 2048, M: 16, z: 3, sweepPoints: 0, sweepSpan: 300, sweepBlocks: 1 }

  it('T07: 對齊的單頻（φ = −120°、Ω = π/6、D = 4）⇒ K̂ 顯著 > 0，且與精確 mean-field 相差 ≤ 4se', () => {
    for (const seed of [1, 2, 3]) {
      const r = J.runPolarityPerturbation({ ...SHARED, code: 'tone', magH: 1, phiDeg: -120, omega: Math.PI / 6, D: 4, mapping: 'bipolar', seed })
      expect(r.verdict).toBe('pass')
      expect(Math.abs(r.est.K - r.KmeanField)).toBeLessThanOrEqual(4 * r.est.se)
      expect(r.KmeanField / r.Klin).toBeGreaterThan(0.98) // Δ = 0.2σ_v：截斷 < 2%
      expect(r.warnings.some((w) => w.startsWith('C ≤ 0'))).toBe(false)
    }
  })

  it('T06: 未對齊（D = 0 ⇒ θ = −120°，C < 0）⇒ 判為極性錯誤，警告解釋原因', () => {
    const r = J.runPolarityPerturbation({ ...SHARED, code: 'tone', magH: 1, phiDeg: -120, omega: Math.PI / 6, D: 0, mapping: 'bipolar', seed: 7 })
    expect(r.C).toBeCloseTo(-0.5, 12)
    expect(r.verdict).toBe('reversed')
    expect(r.warnings.some((w) => w.startsWith('C ≤ 0：更新極性錯誤'))).toBe(true)
    expect(Math.abs(r.est.K - r.KmeanField)).toBeLessThanOrEqual(4 * r.est.se)
  })

  it('T06: comparator 接反（q = 1 − 2b）在對齊路徑上同樣判為極性錯誤；未映射 q = b 斜率約減半', () => {
    const tone = { code: 'tone' as const, magH: 1, phiDeg: -120, omega: Math.PI / 6, D: 4 }
    const rev = J.runPolarityPerturbation({ ...SHARED, ...tone, mapping: 'reversed', seed: 11 })
    expect(rev.verdict).toBe('reversed')
    expect(rev.warnings.some((w) => w.includes('位元映射錯誤'))).toBe(true)
    const uni = J.runPolarityPerturbation({ ...SHARED, ...tone, mapping: 'unipolar', seed: 11 })
    const ok = J.runPolarityPerturbation({ ...SHARED, ...tone, mapping: 'bipolar', seed: 11 })
    expect(uni.KmeanField / ok.KmeanField).toBeCloseTo(0.5, 10)
  })

  it('負面：±1 code 但 D 超出路徑記憶（C = 0）⇒ 無恢復力、判為無法判定，警告說明不可辨識', () => {
    const r = J.runPolarityPerturbation({ ...SHARED, code: 'bpsk', magH: 1, phiDeg: 0, omega: 0.5, D: 4, mapping: 'bipolar', seed: 3 })
    expect(Math.abs(r.C)).toBe(0)
    expect(Math.abs(r.KmeanField)).toBe(0)
    expect(r.verdict).toBe('inconclusive')
    expect(r.warnings.some((w) => w.startsWith('C ≤ 0：$C_D=0$') && w.includes('不可辨識'))).toBe(true)
  })

  it('樣本預算：M 過大時自動降低並提示（每次 ≤ SAMPLE_BUDGET）', () => {
    const r = J.runPolarityPerturbation({ ...SHARED, N: 8192, M: 64, code: 'bpsk', magH: 1, phiDeg: 0, omega: 0.5, D: 0, mapping: 'bipolar', seed: 1 })
    expect(r.samplesUsed).toBeLessThanOrEqual(J.SAMPLE_BUDGET)
    expect(r.Meff).toBeLessThan(64)
    expect(r.warnings.some((w) => w.startsWith('樣本預算'))).toBe(true)
  })

  it('樣本預算：S 曲線掃描也受限（最多一半），而且任何合法的控制項組合都不超過預算', () => {
    const base = { ...SHARED, code: 'tone' as const, magH: 1, phiDeg: -120, omega: Math.PI / 6, D: 4, mapping: 'bipolar' as const, seed: 3 }
    // 控制項的上限：N 8192、M 64、掃描 21 點 × 8 block；三組比較時每組只有 1/3 的預算
    for (const budget of [J.SAMPLE_BUDGET, Math.floor(J.SAMPLE_BUDGET / 2), Math.floor(J.SAMPLE_BUDGET / 3)]) {
      const r = J.runPolarityPerturbation({ ...base, N: 8192, M: 64, sweepPoints: 21, sweepBlocks: 8, budget })
      expect(r.samplesUsed).toBeLessThanOrEqual(budget)
      expect(r.Meff).toBeGreaterThanOrEqual(2)
      expect(r.sweep.w.length * 8192).toBeLessThanOrEqual(budget / 2)
      expect(r.warnings.filter((w) => w.startsWith('樣本預算')).length).toBe(2)
      // 預算縮減不影響判決的正確性（只是誤差棒變寬）
      expect(r.verdict).toBe('pass')
    }
    // 預設設定（每組 1/3 預算）不觸發任何預算警告
    const d = J.runPolarityPerturbation({ ...base, M: 8, sweepPoints: 7, sweepBlocks: 2, budget: Math.floor(J.SAMPLE_BUDGET / 3) })
    expect(d.warnings.some((w) => w.startsWith('樣本預算'))).toBe(false)
    expect(d.Meff).toBe(8)
    expect(d.sweep.w.length).toBe(7)
  })

  it('每一種警告分支的字串都是合法的「文字 + $TeX$」（KaTeX throwOnError），且 $ 成對', () => {
    const base = { ...SHARED, code: 'tone' as const, magH: 1, phiDeg: 0, omega: Math.PI / 6, D: 0, mapping: 'bipolar' as const, seed: 5 }
    const scenarios: J.PolarityPerturbParams[] = [
      { ...base, phiDeg: -120 }, // C < 0
      { ...base, phiDeg: 90 }, // C = 0（單頻、有效相位 90°）
      { ...base, code: 'bpsk', D: 3 }, // C = 0（±1 code、D 超出路徑記憶）
      { ...base, phiDeg: 87 }, // C ≈ 0
      { ...base, mapping: 'reversed' },
      { ...base, mapping: 'unipolar', delta: 80 }, // 未映射 + Δ > 0.5σ_v
      { ...base, omega: 0.011, N: 64 }, // N|sin Ω| 太小
      { ...base, N: 8192, M: 64, sweepPoints: 21, sweepBlocks: 8 }, // 兩種樣本預算警告
    ]
    const two = [
      J.runTwoParamCheck({ rho: 0.3, cG: 1, cP: -0.8, sigmaV: 100, aG: 0, aP: 0, wG: 0, wP: 0, deltaG: 20, deltaP: 20, N: 2048, M: 12, muG: 10, muP: 10, z: 3, seed: 1 }), // PHOS 反向
      J.runTwoParamCheck({ rho: 0.3, cG: 1, cP: 0, sigmaV: 100, aG: 0, aP: 0, wG: 0, wP: 0, deltaG: 20, deltaP: 20, N: 512, M: 12, muG: 10, muP: 10, z: 6, seed: 1 }), // c_P = 0：PHOS 不顯著 + σ_min 不顯著
      J.runTwoParamCheck({ rho: 0.9, cG: 1, cP: 1, sigmaV: 100, aG: 0, aP: 0, wG: 0, wP: 0, deltaG: 20, deltaP: 20, N: 2048, M: 12, muG: 1.1 / J.kq(100), muP: 1.1 / J.kq(100), z: 3, seed: 1 }), // 各自穩定、聯合發散
      J.runTwoParamCheck({ rho: 0.3, cG: 1, cP: 0.8, sigmaV: 100, aG: 0, aP: 0, wG: 0, wP: 0, deltaG: 20, deltaP: 20, N: 8192, M: 48, muG: 10, muP: 10, z: 3, seed: 1 }), // 樣本預算
    ]
    const warnings = [...scenarios.flatMap((p) => J.runPolarityPerturbation(p).warnings), ...two.flatMap((r) => r.warnings)]
    const kinds = ['C ≤ 0：更新極性錯誤', 'C ≤ 0：$C_D=0$', '$C_D\\approx0$', '位元映射錯誤：$q=1-2b$', '位元映射錯誤：$q=b', '$\\Delta=', '$N|\\sin\\Omega|=', '樣本預算：S 曲線掃描', '樣本預算：本頁', 'C ≤ 0：PHOS', '不顯著', '$\\lambda_{\\min}\\approx0$', '各 loop 單獨穩定', '樣本預算：每次擾動']
    for (const k of kinds) expect(warnings.some((w) => w.includes(k)), k).toBe(true)
    for (const w of warnings) {
      const parts = w.split('$')
      expect(parts.length % 2, w).toBe(1)
      for (let i = 1; i < parts.length; i += 2) expect(() => katex.renderToString(parts[i], { throwOnError: true, strict: 'ignore' }), parts[i]).not.toThrow()
      // $…$ 之外不以 Unicode 拼公式（「C ≤ 0：」這個規格指定的前綴除外）
      const outside = parts.filter((_, i) => i % 2 === 0).join(' ')
      expect(/[α-ωΑ-Ω√∑∂₀-₉²³]|\u0302/u.test(outside), w).toBe(false)
    }
    expect(J.texNum(1234)).toBe('1.234\\times10^{3}')
    expect(J.texNum(0.5, 2)).toBe('5.00\\times10^{-1}')
    expect(J.texNum(2)).toBe('2.000')
    expect(J.texNum(Infinity)).toBe('\\infty')
  })

  it('同 seed 可重現（paired comparison 的前提）', () => {
    const p = { ...SHARED, code: 'bpsk' as const, magH: 1, phiDeg: 0, omega: 0.5, D: 0, mapping: 'bipolar' as const, seed: 99 }
    expect(Array.from(J.runPolarityPerturbation(p).gPlus)).toEqual(Array.from(J.runPolarityPerturbation(p).gPlus))
  })
})

describe('SSPLL GOS／PHOS 兩參數 Jacobian', () => {
  const base: J.TwoParamParams = { rho: 0.3, cG: 1, cP: 0.8, sigmaV: 100, aG: 0, aP: 0, wG: 0, wP: 0, deltaG: 20, deltaP: 20, N: 2048, M: 12, muG: 10, muP: 10, z: 3, seed: 5 }

  it('MC Ĵ 的四個元素都在精確 mean-field ±4se 內；小訊號 J = −K_q R diag(c)', () => {
    const r = J.runTwoParamCheck(base)
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) expect(Math.abs(r.Jhat[i][j] - r.JmeanField[i][j])).toBeLessThanOrEqual(4 * r.Jse[i][j])
    const k = J.kq(100)
    expect(r.Jlin[0][1]).toBeCloseTo(-k * 0.3 * 0.8, 15)
    expect(r.diagVerdicts).toEqual(['pass', 'pass'])
    expect(r.rhoA).toBeLessThan(1)
  })

  it('twoParamJlin = −K_q R diag(c)（runTwoParamCheck 用的就是它）；identifiabilityThreshold = z‖se‖_F', () => {
    const k = J.kq(100)
    expect(J.twoParamJlin(base)).toEqual([
      [-k * 1, -k * 0.3 * 0.8],
      [-k * 0.3 * 1, -k * 0.8],
    ])
    expect(J.runTwoParamCheck(base).Jlin).toEqual(J.twoParamJlin(base))
    // det(J) = K_q² c_G c_P (1 − ρ²)：c_P 變號 ⇒ 行列式變號
    const det = (m: number[][]) => m[0][0] * m[1][1] - m[0][1] * m[1][0]
    expect(det(J.twoParamJlin(base))).toBeCloseTo(k * k * 0.8 * (1 - 0.09), 15)
    expect(det(J.twoParamJlin({ ...base, cP: -0.8 }))).toBeLessThan(0)
    expect(J.identifiabilityThreshold([[3, 0], [0, 4]], 2)).toBe(10)
    expect(J.identifiabilityThreshold([[1, 1], [1, 1]], 3)).toBe(6)
  })

  it('負面：PHOS 路徑變號（c_P < 0）⇒ PHOS 判為極性錯誤並解釋', () => {
    const r = J.runTwoParamCheck({ ...base, cP: -0.8 })
    expect(r.diagVerdicts[0]).toBe('pass')
    expect(r.diagVerdicts[1]).toBe('reversed')
    expect(r.warnings.some((w) => w.startsWith('C ≤ 0：PHOS'))).toBe(true)
    expect(r.rhoA).toBeGreaterThan(1)
  })

  it('T18: 強耦合 + 大步長 ⇒ 各自穩定、聯合發散（以精確 mean-field J 判斷）', () => {
    const mu = 1.1 / J.kq(100)
    const r = J.runTwoParamCheck({ ...base, rho: 0.9, cP: 1, muG: mu, muP: mu })
    const mf = J.mimoJudge(r.JmeanField, [[mu, 0], [0, mu]])
    expect(mf.eachLoopStable).toBe(true)
    expect(mf.jointStable).toBe(false)
  })

  it('可辨識性：σ_min(Ĵ) > z‖se‖_F 才算顯著；Weyl 不等式 |σ_min(Ĵ) − σ_min(J)| ≤ ‖Ĵ − J‖_F 在每個 seed 成立', () => {
    // 預設（ρ = 0.3）：σ_min(J) ≈ 0.61 K_q，遠高於門檻 ⇒ 可辨識、沒有警告
    const ok = J.runTwoParamCheck(base)
    expect(ok.identifiable).toBe(true)
    expect(ok.singularValues[1]).toBeGreaterThan(ok.sigmaMinThreshold)
    expect(ok.sigmaMinThreshold).toBeCloseTo(3 * Math.hypot(...ok.Jse.flat()), 15)
    expect(ok.warnings.some((w) => w.includes('\\lambda_{\\min}'))).toBe(false)
    // 負面：ρ = 0.995 ⇒ σ_min(J) = 0.005 K_q，在這個量測長度下與 0 無法區分 ⇒ 警告解釋「不可辨識」與處置
    const bad = J.runTwoParamCheck({ ...base, rho: 0.995, cP: 1 })
    expect(bad.identifiable).toBe(false)
    expect(bad.warnings.some((w) => w.startsWith('$\\lambda_{\\min}\\approx0$') && w.includes('不可辨識'))).toBe(true)
    // 負面：ρ = 1（完全相同的 regressor）⇒ Ĵ 的兩行相同，σ_min 恰為 0
    const dup = J.runTwoParamCheck({ ...base, rho: 1, cP: 1 })
    expect(dup.singularValues[1]).toBeLessThan(1e-12)
    expect(dup.identifiable).toBe(false)
    // Weyl 不等式（精確的線性代數事實），以 mean-field J 當作真值
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = J.runTwoParamCheck({ ...base, rho: 0.9, cP: 1, seed })
      const sTrue = J.mimoJudge(r.JmeanField, [[0, 0], [0, 0]]).singularValues
      const errF = Math.hypot(...r.Jhat.flat().map((v, i) => v - r.JmeanField.flat()[i]))
      for (let i = 0; i < 2; i++) expect(Math.abs(r.singularValues[i] - sTrue[i])).toBeLessThanOrEqual(errF + 1e-15)
    }
  })
})

describe('Corner、延遲與雜訊增益', () => {
  it('delay_bounds：g_crit(d) = 2 sin(π/(4d + 2)) 與 golden 相符，且在 g_crit 時 spectral radius = 1', () => {
    const v = vec('delay_bounds')
    const ds = v.inputs.d_list as number[]
    const gs = v.expected.g_crit_list as number[]
    ds.forEach((d, i) => {
      expect(Math.abs(J.gCrit(d) - gs[i])).toBeLessThanOrEqual(1e-12)
      expect(J.delayPoles(gs[i], d).rho).toBeCloseTo(1, 6)
      expect(J.delayPoles(0.95 * gs[i], d).rho).toBeLessThan(1)
      expect(J.delayPoles(1.05 * gs[i], d).rho).toBeGreaterThan(1)
    })
  })

  it('技術審查 R13：單參數時「穩定」⇔ 0 < g < g_crit(d)——穩定已經包含極性正確（g = μK > 0），反過來不成立', () => {
    // 反例（對「六個條件互相獨立」）：極性錯誤 g < 0 時，任何 d 都不穩定。g = −0.5·10·√(2/π)/100（C = −0.5、μ = 10 fs、σ_v = 100 fs）
    const gNeg = -0.5 * 10 * J.kq(100)
    expect(gNeg).toBeCloseTo(-0.0398942280401, 12)
    const rhoNeg = [1.03989422804, 1.03841826496, 1.03709162111, 1.03588967703, 1.03479330082] // 獨立的 numpy.roots 結果
    rhoNeg.forEach((r, d) => expect(J.delayPoles(gNeg, d).rho).toBeCloseTo(r, 9))
    for (let d = 0; d <= 8; d++) {
      // g ≤ 0：不收斂（g = 0 時根在 z = 1 上）；多小的負 g 都救不回來
      for (const g of [-1, -0.3, -1e-3, -1e-6]) expect(J.delayPoles(g, d).rho, `g=${g}, d=${d}`).toBeGreaterThan(1)
      expect(J.delayPoles(0, d).rho).toBeCloseTo(1, 12)
      // 正常對照：0 < g < g_crit(d) 都穩定
      for (const f of [0.02, 0.2, 0.5, 0.8, 0.98]) expect(J.delayPoles(f * J.gCrit(d), d).rho, `f=${f}, d=${d}`).toBeLessThan(1)
      // 反方向不成立：極性正確（g > 0）但 g ≥ g_crit(d) 時不收斂
      for (const f of [1.02, 1.5, 3]) expect(J.delayPoles(f * J.gCrit(d), d).rho, `f=${f}, d=${d}`).toBeGreaterThan(1)
    }
    // 密掃一次：穩定 ⇒ g > 0（沒有例外），而且穩定區間就是 (0, g_crit)
    for (let d = 0; d <= 4; d++) {
      for (let i = 0; i <= 640; i++) {
        const g = -1 + (3.2 * i) / 640
        const stable = J.delayPoles(g, d).rho < 1 - 1e-9
        if (stable) expect(g, `g=${g}, d=${d}`).toBeGreaterThan(0)
        if (Math.abs(g) > 1e-6 && Math.abs(g - J.gCrit(d)) > 1e-2) expect(stable, `g=${g}, d=${d}`).toBe(g > 0 && g < J.gCrit(d))
      }
    }
    expect(J.delayPoles(0.5 * J.gCrit(1), 1).rho).toBeCloseTo(Math.SQRT1_2, 12) // d = 1、g = 0.5：|z| = 1/√2
  })

  // 逐 block 的平均遞迴 δ_{k+1} = δ_k − g·δ_{k−d}，初始歷史都是 1：1 + 最後一次 |δ_k| > 5% 的 k（獨立於 settleDelayed 的寫法：不用環形緩衝、不用停止規則，直接跑 5000 步）
  const brute = (g: number, d: number) => {
    const y = new Array<number>(d + 1).fill(1)
    let last = 0
    for (let k = 1; k < 5000; k++) {
      y.push(y[y.length - 1] - g * y[y.length - 1 - d])
      if (Math.abs(y[y.length - 1]) > 0.05) last = k
    }
    return last + 1
  }
  const oneCorner = (g: number, d: number, B = Infinity) =>
    J.cornerJudge([{ name: 'x', sigmaV: 100, thetaDeg: 0 }], { mu: g / J.kq(100), d, pmTargetDeg: 0, B, N: 4096, sigmaWMax: Infinity })[0]

  it('技術審查 R02／A6：k95 逐 block 數（判定用），⌈ln 0.05/ln ρ⌉ 另列成「ρ 漸近估計」——d = 0 兩者相同，d ≥ 1 可能多也可能少', () => {
    // 反例（Corner 判斷器假設欄寫的那一組）：d = 1、g = 1/4 是重根 z = 1/2，δ_k = (1 + k/2)·2^{−k}
    expect(J.delayPoles(0.25, 1).rho).toBeCloseTo(0.5, 6)
    const dbl = oneCorner(0.25, 1)
    expect(dbl.settleAsym).toBe(5)
    expect(dbl.settle95).toBe(7)
    expect(dbl.settle95Exact).toBe(true)
    expect(brute(0.25, 1)).toBe(7)
    expect((1 + 5 / 2) * 2 ** -5).toBe(0.109375) // k = 5 還有 10.9%
    expect((1 + 6 / 2) * 2 ** -6).toBeGreaterThan(0.05)
    expect((1 + 7 / 2) * 2 ** -7).toBeLessThan(0.05)
    // 兩個方向都會差（獨立的 NumPy 重算：漸近估計／逐 block）
    const cases: [number, number, number, number][] = [
      [4 / 27, 2, 8, 11],
      [27 / 256, 3, 11, 16],
      [0.33 * J.gCrit(3), 3, 14, 8],
      [0.8, 1, 27, 26],
    ]
    for (const [g, d, asym, actual] of cases) {
      const r = oneCorner(g, d)
      expect(r.settleAsym, `漸近估計 g=${g}, d=${d}`).toBe(asym)
      expect(r.settle95, `逐 block g=${g}, d=${d}`).toBe(actual)
      expect(brute(g, d), `暴力遞推 g=${g}, d=${d}`).toBe(actual)
      expect(r.settle95Exact).toBe(true)
    }
    // 正常對照：d = 0 時兩者相同，都等於 T11 的封閉式
    for (const g of [0.005, 0.0797884561, 0.25, 0.5, 0.9, 1.5]) {
      const r = oneCorner(g, 0)
      expect(r.settle95, `g=${g}`).toBe(brute(g, 0))
      expect(r.settleAsym, `g=${g}`).toBe(r.settle95)
    }
    expect(oneCorner(0.005, 0).settle95).toBe(598) // T11
    // deadbeat（g = 1、d = 0）：ρ = 0，ln 0 = −∞，但仍需要 1 次更新
    expect(oneCorner(1, 0).settle95).toBe(1)
    expect(oneCorner(1, 0).settleAsym).toBe(1)
    // 不穩定：k95 與漸近估計都是 ∞（不當成有限的數字比大小）
    const bad = oneCorner(1.2 * J.gCrit(1), 1)
    expect([bad.settle95, bad.settleAsym, bad.settle95Exact]).toEqual([Infinity, Infinity, true])
  })

  it('A6：d = 1 在整個 g ∈ (0, 1) 掃一遍，cornerJudge 的 k95 都等於暴力遞推；漸近估計與它的相對差最大 40%（出現在 g = 1/4 附近）', () => {
    let worst = { rel: 0, g: 0 }
    for (let i = 1; i < 100; i++) {
      const g = i / 100
      const r = oneCorner(g, 1)
      expect(r.settle95, `g=${g}`).toBe(brute(g, 1))
      const rel = Math.abs(r.settleAsym - r.settle95) / r.settleAsym
      if (rel > worst.rel) worst = { rel, g }
    }
    expect(worst.rel).toBeCloseTo(0.4, 12)
    expect(Math.abs(worst.g - 0.25)).toBeLessThan(0.02)
  })

  it('A6：pass/fail 用逐 block 的 k95——d = 1、g = 1/4、B = 6：漸近估計 5 ≤ 6 會誤判通過，逐 block 的 7 > 6 不合格；反過來 g = 0.8、B = 26：估計 27 > 26 會誤判不合格，逐 block 的 26 剛好合格', () => {
    const a = oneCorner(0.25, 1, 6)
    expect(a.settleAsym <= 6).toBe(true) // 舊的判法會給綠燈
    expect(a.ok.settle).toBe(false)
    expect(oneCorner(0.25, 1, 7).ok.settle).toBe(true)
    const b = oneCorner(0.8, 1, 26)
    expect(b.settleAsym <= 26).toBe(false)
    expect(b.ok.settle).toBe(true)
    expect(oneCorner(0.8, 1, 25).ok.settle).toBe(false)
    // d = 0 時兩種判法永遠一致（沒有翻盤的可能）
    for (const g of [0.005, 0.0797884561, 0.25, 0.5, 0.9, 1.5])
      for (const B of [1, 5, 20, 100, 598, 1000]) {
        const r = oneCorner(g, 0, B)
        expect(r.ok.settle, `g=${g}, B=${B}`).toBe(r.settleAsym <= B)
      }
  })

  it('A6：逐 block 沒有數完（極慢的 mode）時 settle95Exact = false，settle95 退回漸近估計當下界；步數上限可由 settleMaxSteps 指定', () => {
    const slow = oneCorner(1e-6, 1) // ρ ≈ 1 − 10⁻⁶：衰減到停止規則的門檻要約 10⁷ 步 > SETTLE_MAX_STEPS = 2×10⁶
    expect(slow.settle95Exact).toBe(false)
    expect(slow.settle95).toBe(slow.settleAsym)
    expect(slow.settle95).toBeGreaterThan(2_000_000)
    expect(oneCorner(1e-6, 1, 100_000).ok.settle).toBe(false) // 下界已經超過 B 的上限（100000）：一定不合格
    const capped = J.cornerJudge([{ name: 'x', sigmaV: 100, thetaDeg: 0 }], { mu: 0.01 / J.kq(100), d: 1, pmTargetDeg: 0, B: Infinity, N: 4096, sigmaWMax: Infinity, settleMaxSteps: 50 })[0]
    expect(capped.settle95Exact).toBe(false)
    expect(capped.settle95).toBe(capped.settleAsym)
    // 正常大小的 mode 都數得完
    expect(oneCorner(0.0399, 1).settle95Exact).toBe(true)
  })

  it('A6：cornerFeasibleScan 的格點判定（步數上限 50B + 5000）與逐點的 cornerJudge（完整上限）完全一致', () => {
    const corners = [
      { name: 'TT', sigmaV: 100, thetaDeg: 0 },
      { name: 'SS', sigmaV: 140, thetaDeg: 25 },
      { name: 'FF', sigmaV: 70, thetaDeg: 10 },
      { name: 'grid', sigmaV: 100, thetaDeg: 60 },
    ]
    for (const d of [0, 1, 3]) {
      for (const B of [6, 20, 120, 1000]) {
        const o = { d, pmTargetDeg: 60, B, N: 4096, sigmaWMax: 1 }
        const scan = J.cornerFeasibleScan(corners, o, 120, [10])
        scan.mu.forEach((mu, i) => {
          const rows = J.cornerJudge(corners, { mu, ...o })
          expect(scan.ok[i], `d=${d}, B=${B}, μ=${mu}`).toBe(rows.every((r) => Object.values(r.ok).every(Boolean)))
        })
      }
    }
  })

  it('A6：Corner 預設的四個 corner（d = 1、μ = 10）——每個 corner 的逐 block k95 與漸近估計都列出來；d = 3、μ = 30 時兩者開始不同（TT 24 → 21、FF 53 → 47），B = 120 下判定不變', () => {
    const corners = [
      { name: 'TT 25°C', sigmaV: 100, thetaDeg: 0 },
      { name: 'SS −40°C', sigmaV: 140, thetaDeg: 25 },
      { name: 'FF 125°C', sigmaV: 70, thetaDeg: 10 },
      { name: 'near-grid FCW', sigmaV: 100, thetaDeg: 60 },
    ]
    const base = { pmTargetDeg: 60, B: 120, N: 4096, sigmaWMax: 1 }
    const d1 = J.cornerJudge(corners, { mu: 10, d: 1, ...base })
    expect(d1.map((r) => r.settle95)).toEqual([33, 54, 22, 71])
    expect(d1.map((r) => r.settleAsym)).toEqual([33, 54, 22, 71])
    const d3 = J.cornerJudge(corners, { mu: 30, d: 3, ...base })
    expect(d3.map((r) => r.settle95)).toEqual([21, 15, 47, 12])
    expect(d3.map((r) => r.settleAsym)).toEqual([24, 15, 53, 12])
    for (const r of [...d1, ...d3]) expect(r.ok.settle).toBe(r.settleAsym <= 120)
  })

  it('T08: g = 1、d = 0 ⇒ pole 0、PM 60°；d = 1 時剛好臨界', () => {
    expect(J.delayPoles(1, 0).rho).toBeCloseTo(0, 14)
    expect(J.pmDeg(1, 0)).toBeCloseTo(60, 12)
    expect(J.pmDeg(1, 1)).toBeCloseTo(0, 12)
    expect(J.pmDeg(0, 0)).toBeNaN()
  })

  it('noiseGainSum：d = 0 為 1/(1 − p²)；d = 1 與 AR(2) 變異數封閉式 (1 + g)/((1 − g)g(g + 2)) 相符', () => {
    const g = 0.0797884560802865
    expect(J.noiseGainSum(g, 0)).toBeCloseTo(1 / (1 - (1 - g) ** 2), 10)
    expect(J.noiseGainSum(g, 1)).toBeCloseTo((1 + g) / ((1 - g) * g * (g + 2)), 8)
    expect(J.noiseGainSum(2.5, 0)).toBe(Infinity)
  })

  it('T13: cornerJudge 在 T13 條件（d = 0）重現 σ_w = 0.3992 fs', () => {
    const [row] = J.cornerJudge([{ name: 'T13', sigmaV: 100, thetaDeg: 0 }], { mu: 10, d: 0, pmTargetDeg: 60, B: 1000, N: 4096, sigmaWMax: 1 })
    expectGolden(vec('T13'), 'sigma_w_fs', row.sigmaW)
    expectGolden(vec('T13'), 'p', 1 - row.g)
  })

  it('負面：某個 corner 有效相位 > 90° ⇒ 極性不合，且沒有任何 μ 可行', () => {
    const corners = [
      { name: 'TT', sigmaV: 100, thetaDeg: 0 },
      { name: 'bad', sigmaV: 100, thetaDeg: 100 },
    ]
    const rows = J.cornerJudge(corners, { mu: 10, d: 1, pmTargetDeg: 60, B: 120, N: 4096, sigmaWMax: 1 })
    expect(rows[1].ok.polarity).toBe(false)
    expect(rows[1].ok.stable).toBe(false)
    const scan = J.cornerFeasibleScan(corners, { d: 1, pmTargetDeg: 60, B: 120, N: 4096, sigmaWMax: 1 }, 80)
    expect(scan.lo).toBeNaN()
  })

  it('預設四個 corner 有非空的可行 μ 區間，且區間內每一點都通過所有判準', () => {
    const corners = [
      { name: 'TT', sigmaV: 100, thetaDeg: 0 },
      { name: 'SS', sigmaV: 140, thetaDeg: 25 },
      { name: 'FF', sigmaV: 70, thetaDeg: 10 },
      { name: 'grid', sigmaV: 100, thetaDeg: 60 },
    ]
    const o = { d: 1, pmTargetDeg: 60, B: 120, N: 4096, sigmaWMax: 1 }
    const scan = J.cornerFeasibleScan(corners, o, 80)
    expect(scan.hi).toBeGreaterThan(scan.lo)
    const mid = Math.sqrt(scan.lo * scan.hi)
    expect(J.cornerJudge(corners, { mu: mid, ...o }).every((r) => Object.values(r.ok).every(Boolean))).toBe(true)
  })

  it('effectiveSamples：AR(1) 的等效樣本數', () => {
    const e = J.effectiveSamples(10000, 0.9)
    expect(e.forMean).toBeCloseTo((10000 * 0.1) / 1.9, 10)
    expect(e.forVariance).toBeCloseTo((10000 * 0.19) / 1.81, 10)
  })
})

describe('Corner 判斷器的 Monte Carlo 交叉比對（blockLms 真實 block sign-LMS，8 seeds）', () => {
  const corners = [
    { name: 'TT 25°C', sigmaV: 100, thetaDeg: 0 },
    { name: 'SS −40°C', sigmaV: 140, thetaDeg: 25 },
    { name: 'FF 125°C', sigmaV: 70, thetaDeg: 10 },
    { name: 'near-grid FCW', sigmaV: 100, thetaDeg: 60 },
  ]
  const base = { pmTargetDeg: 60, B: 120, N: 4096, sigmaWMax: 1 }
  const plan = (cs: typeof corners, mu: number, d: number) => J.cornerMcPlan(cs, J.cornerJudge(cs, { mu, d, ...base }), d, 20261010)

  it('T08: 挑 k95 最大的穩定 corner（預設是 near-grid FCW，k95 = 71）；δ0 = 0.2σ_v、μ_eff = g/K_q、8 seeds、涵蓋 k95', () => {
    const p = plan(corners, 10, 1)!
    expect(p.name).toBe('near-grid FCW')
    expect(p.index).toBe(3)
    expect(p.k95).toBe(71)
    expect(p.runs).toBe(8)
    expect(p.setup).toMatchObject({ d: 1, sigmaV: 100, N: J.CORNER_MC_N, delta0: 20, seed: 20261010 })
    expect(p.setup.g).toBeCloseTo(10 * J.kq(100) * Math.cos(Math.PI / 3), 12)
    expect(p.setup.blocks).toBeGreaterThan(71) // 117：1.5·k95 + 10
    expect(p.truncated).toBe(false)
    const cfg = J.cornerMcConfig(p)
    expect(cfg.cal_update_delay_blocks).toBe(1)
    expect(cfg.gain_step).toBeCloseTo(p.setup.g / J.kq(100), 12)
    expect(cfg.pd_noise_rms_fs).toBe(100)
    expect(cfg.gain_true).toBe(20)
    // 只挑「極性正確且穩定」的：把最慢的換成極性錯誤的 corner ⇒ 改挑剩下 k95 最大的 SS −40°C（54）
    const bad = [...corners.slice(0, 3), { name: 'rev', sigmaV: 100, thetaDeg: 100 }]
    const p2 = plan(bad, 10, 1)!
    expect([p2.name, p2.k95]).toEqual(['SS −40°C', 54])
    // 全部不能比：極性錯誤、或 g ≥ g_crit(d) 的 corner 沒有線性遞迴可比（sign-LMS 的 |G| ≤ 1 讓實際誤差有界，limit cycle）
    expect(plan([{ name: 'rev', sigmaV: 100, thetaDeg: 100 }], 10, 1)).toBeNull()
    expect(plan([{ name: 'fast', sigmaV: 100, thetaDeg: 0 }], 200, 1)).toBeNull()
  })

  it('T08: 預設 case——8 seeds 的 blockLms 平均軌跡 δ_MC,k = δ0 − mean(w_k) 與逐 block 遞迴在 Student-t·SE＋線性化容許量內一致；第 71 個 block 的 |δ|/δ0 兩者相差在 4 se 內', () => {
    const p = plan(corners, 10, 1)!
    const res = runBlockLmsMonteCarlo({ config: J.cornerMcConfig(p), runs: p.runs })
    expect(res.seeds).toHaveLength(8)
    expect(res.analytic.g).toBeCloseTo(p.setup.g, 9) // blockLms 由實際 code 估計的 g 就是設定的 g
    const c = J.compareCornerMc(p, res)
    expect(c.cmp.pass).toBe(true)
    expect(c.cmp.worstRatio).toBeLessThan(1)
    expect(c.atK95).not.toBeNull()
    expect(c.atK95!.k).toBe(71)
    expect(c.atK95!.lin).toBeCloseTo(0.04895, 4) // y_71 = 0.04895 < 0.05
    expect(Math.abs(c.atK95!.mc - c.atK95!.lin)).toBeLessThanOrEqual(4 * c.atK95!.se)
  })

  it('T08: 這個比對不是空的——拿錯的模型去比，同一份 MC 結果會被判不一致：g 乘 1.6（預設 case）；d 少算一個 block（d = 3、μ = 30 的 g = 0.34 才分得出；預設的 g = 0.04 太小，d = 1 與 d = 0 的軌跡幾乎相同）', () => {
    const p = plan(corners, 10, 1)!
    const res = runBlockLmsMonteCarlo({ config: J.cornerMcConfig(p), runs: p.runs })
    expect(J.compareCornerMc(p, res).cmp.pass).toBe(true)
    expect(J.compareCornerMc({ ...p, setup: { ...p.setup, g: 1.6 * p.setup.g } }, res).cmp.pass).toBe(false)
    // blockLms 回報的有效 g 與設定的 g 不符（設定沒有套用）也判不一致
    expect(J.compareCornerMc(p, { ...res, analytic: { ...res.analytic, g: 1.01 * p.setup.g } }).cmp.pass).toBe(false)
    // d 少算一個 block：預設的 g = 0.04 太小，d = 1 與 d = 0 的平均軌跡幾乎重合（8 seeds 分不出來，比值約 0.25）；d = 3、μ = 30（FF 125°C 的 g = 0.34）才看得出，比值 > 1
    expect(J.compareCornerMc({ ...p, setup: { ...p.setup, d: 0 } }, res).cmp.worstRatio).toBeLessThan(1)
    const p3 = plan(corners, 30, 3)!
    const res3 = runBlockLmsMonteCarlo({ config: J.cornerMcConfig(p3), runs: p3.runs })
    expect(J.compareCornerMc(p3, res3).cmp.pass).toBe(true)
    expect(J.compareCornerMc({ ...p3, setup: { ...p3.setup, d: 2 } }, res3).cmp.pass).toBe(false)
  })

  it('T08: d = 3、μ = 30（FF 125°C 最慢，k95 = 47）與 d = 0 的大步長（g = 1.6、k95 = 6）也一致；k95 超過 MC 範圍時標 truncated', () => {
    for (const [mu, d] of [[30, 3], [200, 0]] as const) {
      const p = plan(corners, mu, d)!
      const res = runBlockLmsMonteCarlo({ config: J.cornerMcConfig(p), runs: p.runs })
      const c = J.compareCornerMc(p, res)
      expect(c.cmp.pass, `μ=${mu}, d=${d}`).toBe(true)
      expect(c.atK95?.k, `μ=${mu}, d=${d}`).toBe(p.k95)
    }
    expect(plan(corners, 30, 3)!.k95).toBe(47)
    // μ = 2 fs：g = 0.008、k95 = 371 > 300 個 block：只比對前 300 個 block，atK95 為 null
    const slow = plan(corners, 2, 1)!
    expect([slow.setup.blocks, slow.truncated]).toEqual([J.CORNER_MC_MAX_BLOCKS, true])
    expect(slow.k95).toBeGreaterThan(J.CORNER_MC_MAX_BLOCKS)
    const res = runBlockLmsMonteCarlo({ config: J.cornerMcConfig(slow), runs: slow.runs })
    const c = J.compareCornerMc(slow, res)
    expect(c.cmp.pass).toBe(true)
    expect(c.atK95).toBeNull()
  })
})

describe('多參數 MIMO 判斷', () => {
  it('T18: eig(I + 0.2J) = 1.2、0.4；單獨 pole 0.8；regularized pinv poles 與 golden 相符', () => {
    const v = vec('T18')
    const Jm = v.inputs.J as number[][]
    const res = J.mimoJudge(Jm, v.inputs.M as number[][])
    const eig = res.eigA.map((z) => z.re).sort((a, b) => b - a)
    const exp = v.expected.eig_A_desc as number[]
    eig.forEach((x, i) => expect(Math.abs(x - exp[i])).toBeLessThanOrEqual(1e-12))
    expectGolden(v, 'spectral_radius', res.rho)
    expect(res.diagPoles).toEqual((v.expected.single_loop_poles as number[]).map((x) => expect.closeTo(x, 12)))
    expect(res.eachLoopStable).toBe(true)
    expect(res.jointStable).toBe(false)
    const reg = J.mimoJudge(Jm, J.regPinvM(Jm, v.inputs.reg_gamma as number, v.inputs.reg_lambda as number))
    const regEig = reg.eigA.map((z) => z.re).sort((a, b) => b - a)
    ;(v.expected.reg_poles_desc as number[]).forEach((x, i) => expect(Math.abs(regEig[i] - x)).toBeLessThanOrEqual(1e-12))
  })

  it('Bauer–Fike：Â 對稱時 ρ(A_true) ≤ ρ(Â) + ‖E‖₂（E24 的兩組設定）', () => {
    const Jt = [[-1, -0.99], [-0.99, -1]]
    const Jh = [[-1, -0.996], [-0.996, -1]]
    for (const eps of [0, 1e-4, 1e-3]) {
      const r = J.jacobianRobustness(Jt, Jh, J.regPinvM(Jh, 1, eps))
      expect(r.symmetric).toBe(true)
      expect(r.rhoTrue).toBeLessThanOrEqual(r.bound + 1e-9)
    }
    const r4 = J.jacobianRobustness(Jt, Jh, J.regPinvM(Jh, 1, 1e-4))
    expect(r4.rhoTrue).toBeCloseTo(0.655, 3) // validation.md E24
    expect(r4.bound).toBeGreaterThan(1) // 充分條件不成立，但真實穩定
  })

  it('E24：近奇異 J，Ĵ 用 ρ̂ = 0.996、γ = 1、ε_J = 0 ⇒ pole −1.5；ε_J = 1e-4 ⇒ 穩定', () => {
    const Jt = [[-1, -0.99], [-0.99, -1]]
    const Jh = [[-1, -0.996], [-0.996, -1]]
    const bad = J.mimoJudge(Jt, J.regPinvM(Jh, 1, 0))
    expect(Math.min(...bad.eigA.map((z) => z.re))).toBeCloseTo(-1.5, 6)
    const good = J.mimoJudge(Jt, J.regPinvM(Jh, 1, 1e-4))
    expect(good.jointStable).toBe(true)
  })
})

describe('定點與量化', () => {
  it('T16: 常數 32.4 的一階 EFB：週期 5、cycle [32,33,32,33,32]、平均 32.4、誤差功率 0.24 LSB²；floor 給 [32,32,33,32,33]', () => {
    const t16 = vec('T16')
    const y = J.efbSequence(162, 5, 5, 'round').y
    expect(y).toEqual(t16.expected.ef_cycle)
    expect(J.efbPeriod(162, 5)).toBe(t16.expected.ef_period)
    expect(y.reduce((s, v) => s + v, 0) / 5).toBeCloseTo(32.4, 12)
    expect(J.errorPower(y, 32.4)).toBeCloseTo(0.24, 12)
    expect(J.efbSequence(162, 5, 5, 'floor').y).toEqual(t16.inputs.pattern)
    const mags = J.dftMagnitudes(t16.inputs.pattern as number[])
    ;(t16.expected.dft_mag_list as number[]).forEach((m, k) => expect(Math.abs(mags[k] - m)).toBeLessThanOrEqual(1e-12))
  })

  it('quantizer_first_order：40 步序列與有理目標的週期列表（精確整數算術）', () => {
    const v = vec('quantizer_first_order')
    expect(J.efbSequence(162, 5, 40, 'round').y).toEqual(v.expected.y)
    const fracs: [number, number][] = [[32, 1], [65, 2], [97, 3], [129, 4], [162, 5], [259, 8], [519, 16]]
    expect(fracs.map(([P, q]) => J.efbPeriod(P, q))).toEqual(v.expected.period_list)
  })

  it('E15：定點 F 個小數位元時週期 2^F/gcd（F = 8/10/12 ⇒ 128/512/2048），與精確模擬一致', () => {
    for (const [F, T] of [[8, 128], [10, 512], [12, 2048]]) {
      expect(J.fixedPointPeriod(32.4, F)).toBe(T)
      expect(J.efbPeriod(Math.round(32.4 * 2 ** F), 2 ** F)).toBe(T)
    }
    expect(J.fixedPointPeriod(32, 10)).toBe(1)
  })

  it('DFT：period-5 誤差的兩條譜線 |X1|/5 = (√5 − 1)/10、|X2|/5 = (√5 + 1)/10（T16 dft_mag_list）', () => {
    const y = J.efbSequence(162, 5, 5, 'floor').y
    const mags = J.dftMagnitudes(y.map((v) => v - 32.4))
    expect(mags[0]).toBeCloseTo(0, 12)
    expect(mags[1]).toBeCloseTo((Math.sqrt(5) - 1) / 10, 12)
    expect(mags[2]).toBeCloseTo((Math.sqrt(5) + 1) / 10, 12)
  })

  it('累加器位元、最壞情況、shift scaling', () => {
    expect(J.accumulatorBitsRequired(6, 4096)).toBe(18)
    expect(J.accumulatorBitsRequired(6, 3000)).toBe(18)
    expect(J.worstCaseSum(6, 4096)).toEqual({ max: 31 * 4096, min: -32 * 4096 })
    expect(J.shiftScale(3000, 12)).toBeCloseTo(3000 / 4096, 15)
    expect(J.wrapTwos(5, 4)).toBe(5)
    expect(J.wrapTwos(9, 4)).toBe(-7)
    expect(J.saturateTwos(-100, 4)).toBe(-8)
  })
})

describe('證據強度與穩定性語意', () => {
  it('Clopper–Pearson：k = 0 封閉式；k > 0 時 P(X ≤ k | n, p_U) = α', () => {
    expect(J.failureUpperBound(0, 100)).toBeCloseTo(1 - Math.pow(0.05, 0.01), 14)
    const pu = J.failureUpperBound(2, 1000, 0.95)
    expect(binomCdf(2, 1000, pu)).toBeCloseTo(0.05, 8)
    expect(J.failureUpperBound(5, 5)).toBe(1)
    expect(J.trialsForZeroFailure(0.01)).toBe(299)
    expect(J.failureUpperBound(0, J.trialsForZeroFailure(0.01))).toBeLessThanOrEqual(0.01)
  })

  it('T03: g₂(2/3) = 1；μ = 0.8 時均方發散但有限 seeds 的樣本路徑幾乎全部收斂（E14）', () => {
    expect(1 - 2 * (2 / 3) + 3 * (2 / 3) ** 2).toBeCloseTo(1, 14)
    const s = J.scalarPathStudy(0.8, 200, 200, 7)
    expect(s.log10TheoryMsd).toBeGreaterThan(20) // E[δ²] 理論值爆大
    expect(s.fracConverged).toBeGreaterThan(0.95) // 但路徑幾乎都收斂
    expect(s.log10SampleMsd).toBeLessThan(s.log10TheoryMsd - 30) // 樣本平均嚴重低估
    expect(s.log10Abs.length).toBe(200)
  })

  it('Kesten 尾指數：μ = 2/3（均方邊界）時 κ = 2；μ = 0.8 時 κ < 2（變異數無限）；λ ≥ 0 時無正根', () => {
    expect(J.kestenTailIndex(2 / 3)).toBeCloseTo(2, 6)
    expect(J.kestenTailIndex(0.5)).toBeGreaterThan(2)
    expect(J.kestenTailIndex(0.8)).toBeLessThan(2)
    expect(J.kestenTailIndex(0.8)).toBeGreaterThan(0)
    expect(J.kestenTailIndex(2.5)).toBeNaN() // μ > μ_as ≈ 2.42
  })

  it('Chebyshev 上界', () => {
    expect(J.chebyshevBound(0.16, 1.6)).toBeCloseTo(0.0625, 14)
    expect(J.chebyshevBound(10, 1)).toBe(1)
  })

  it('T12: 三階 INL 例：MSE-LMS 固定點 1.34（golden）；無雜訊 Sign-LMS 固定點 1.4（E01）', () => {
    const t12 = vec('T12')
    expectGolden(t12, 'w_star', J.inlMseFixedPoint(t12.inputs.x_values as number[], 1, 0.1))
    expect(J.inlSignFixedPoint([-2, -1, 0, 1, 2], 1, 0.1)).toBeCloseTo(1.4, 9)
  })

  it('T15: spur ≈ 20log10(πf_out A_t)，13 GHz、0.5 fs ⇒ −93.80 dBc', () => {
    expectGolden(vec('T15'), 'spur_dbc', J.spurDbc(13e9, 0.5))
  })
})
