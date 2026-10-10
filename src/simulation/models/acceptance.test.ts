import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import katex from 'katex'
import { createRng, normCdf, studentTCdf } from '@/simulation/core'
import {
  ACCEPTANCE_COMPUTE,
  ACCEPTANCE_IDS,
  ACCEPTANCE_INPUTS,
  KS_CRIT_001,
  MC_IDS,
  MC_PLAN,
  MUTANTS,
  SWEEP_SCORE_CRIT,
  aliasingWarnings,
  ar1Lag1Expectation,
  ar1LagSum,
  ar1SampleVarianceFactor,
  bernoulliVarianceSe,
  clampMcScale,
  compareToGolden,
  computeErrataEvidence,
  computeNegativeValues,
  diffNumeric,
  equivalentZ,
  evaluateMutants,
  falseAlarmRate,
  falseAlarmRateT,
  ksStatistic,
  parseQuotedNumber,
  pathConfusionCheck,
  quotedTolerance,
  runAcceptanceMcSweep,
  runAcceptanceMonteCarlo,
  runAllAcceptance,
  sweepScores,
  tCritical,
  toggleLag1,
  toleranceBound,
  type AcceptanceId,
  type GoldenVectorLike,
} from './acceptance'

const load = (name: string): GoldenVectorLike =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVectorLike

const VECTORS = Object.fromEntries(ACCEPTANCE_IDS.map((id) => [id, load(id)])) as Record<AcceptanceId, GoldenVectorLike>

interface ErratumJson {
  eid: string
  location: string
  problem: string
  correction: string
  evidence: string
}
const ERRATA = (JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/errata.json'), 'utf8')) as { errata: ErratumJson[] }).errata
const ERRATA_IDS = new Set(ERRATA.map((e) => e.eid))

/** 文字欄位中的每一段 `$…$` 都必須是 KaTeX 可解析的 TeX（throwOnError） */
function expectTexOk(text: string, where: string) {
  const parts = text.split('$')
  expect(parts.length % 2, `${where}：$ 不成對 → ${text}`).toBe(1)
  parts.forEach((p, i) => {
    if (i % 2 === 1) expect(() => katex.renderToString(p, { throwOnError: true, strict: 'ignore' }), `${where}：${p}`).not.toThrow()
  })
}

/** 每個 T-id：網站必須算出 golden 的「每一個」 expected key，且全部在容忍度內；獨立路徑也必須一致。 */
function expectFullMatch(id: AcceptanceId) {
  const comp = ACCEPTANCE_COMPUTE[id]()
  const cmp = compareToGolden(VECTORS[id], comp.values)
  const bad = cmp.keys.filter((k) => k.pass !== true).map((k) => `${k.key}: actual=${JSON.stringify(k.actual)} expected=${JSON.stringify(k.expected)} ratio=${k.diff?.worstRatio}`)
  expect(bad, `${id} 未通過的 key`).toEqual([])
  expect(cmp.status).toBe('pass')
  expect(cmp.missing).toBe(0)
  expect(cmp.passed).toBe(Object.keys(VECTORS[id].expected).length)
  const failedChecks = comp.checks.filter((c) => !c.pass).map((c) => `${c.label}: ${c.primary} vs ${c.secondary}`)
  expect(failedChecks, `${id} 獨立路徑不一致`).toEqual([])
  expect(comp.calls.length).toBeGreaterThan(0)
  return comp
}

describe('acceptance：golden 比對規則本身（golden/README §5）', () => {
  it('bound = abs + rel·|e|；陣列逐元素；形狀不符或 NaN 一律不通過', () => {
    expect(toleranceBound(2, { abs: 1e-12 })).toBe(1e-12)
    expect(toleranceBound(-200, { rel: 1e-10 })).toBeCloseTo(2e-8, 20)
    expect(toleranceBound(5, {})).toBe(0)
    expect(diffNumeric([1, 2], [1, 2 + 1e-13], { abs: 1e-12 }).worstRatio).toBeLessThan(1)
    expect(diffNumeric([1, 2], [1, 2, 3], { abs: 1 }).shapeMismatch).toBe(true)
    expect(diffNumeric(Number.NaN, 1, { abs: 1 }).worstRatio).toBe(Infinity)
    // 整數門檻 abs = 0：必須完全相等
    expect(diffNumeric(598, 598, { abs: 0 }).worstRatio).toBe(0)
    expect(diffNumeric(599, 598, { abs: 0 }).worstRatio).toBe(Infinity)
    // 巢狀矩陣
    expect(diffNumeric([[1, 2], [3, 4]], [[1, 2], [3, 4.5]], { abs: 0.1 }).worstRatio).toBeCloseTo(5, 12)
  })

  it('沒有計算的 key 會被列為 missing（incomplete），不會被當成通過', () => {
    const cmp = compareToGolden(VECTORS.T01, { w1: 1.8 })
    expect(cmp.status).toBe('incomplete')
    expect(cmp.passed).toBe(1)
    expect(cmp.missing).toBe(Object.keys(VECTORS.T01.expected).length - 1)
    const bad = compareToGolden(VECTORS.T01, { w1: 1.9 })
    expect(bad.status).toBe('fail')
  })

  it('tolerance_overrides 優先於整體 tolerance（T05 的整數門檻、T13 的 sum-mode rel）', () => {
    const c = compareToGolden(VECTORS.T05, { N_exact_odd_95: 42499 + 1e-9 })
    const k = c.keys.find((x) => x.key === 'N_exact_odd_95')!
    expect(k.overridden).toBe(true)
    expect(k.pass).toBe(false) // abs = 0，1e-9 也不行
  })

  it('單項 z 門檻的雙尾誤報率：z = 4 ⇒ 6.33e−5；z = 3 ⇒ 2.70e−3', () => {
    expect(falseAlarmRate(4)).toBeCloseTo(6.334248e-5, 9)
    expect(falseAlarmRate(3)).toBeCloseTo(2.69979606e-3, 9)
    expect(bernoulliVarianceSe(0.4, 1e6)).toBeCloseTo(Math.sqrt((0.24 * (1 - 3 * 0.24) - 0.24 * 0.24) / 1e6), 15)
  })
})

describe('acceptance：輸入條件與 golden vectors 一致', () => {
  it('ACCEPTANCE_INPUTS 的數值與 golden inputs 相同（含單位換算）', () => {
    const v = (id: AcceptanceId) => VECTORS[id].inputs
    expect(v('T01')).toMatchObject(ACCEPTANCE_INPUTS.T01)
    expect(v('T02').mu_list).toEqual(ACCEPTANCE_INPUTS.T02.mu_list)
    expect(v('T03').mu_list).toEqual(ACCEPTANCE_INPUTS.T03.mu_list)
    expect(v('T03').Ex2).toBe(1)
    expect(v('T03').Ex4).toBe(3)
    expect(v('T04')).toMatchObject({ s_fs: ACCEPTANCE_INPUTS.T04.s_fs, sigma_fs: ACCEPTANCE_INPUTS.T04.sigma_fs })
    expect(v('T05').N_list).toEqual(ACCEPTANCE_INPUTS.T05.N_list)
    expect(v('T06')).toMatchObject({ A: 1, H_mag: 1, phi_deg: 120, mu: 10, hpd_w_over_wn: 0.3, hpd_zeta: 0.7 })
    expect(v('T06').Omega_rad).toBeCloseTo(ACCEPTANCE_INPUTS.T06.Omega_rad, 15)
    expect(v('T07').D_list).toEqual(ACCEPTANCE_INPUTS.T07.D_list)
    expect(v('T08').g_list).toEqual(ACCEPTANCE_INPUTS.T08.g_list)
    expect(v('T09')).toMatchObject(ACCEPTANCE_INPUTS.T09)
    expect(v('T10').R).toEqual([
      [1, 0.99],
      [0.99, 1],
    ])
    expect(v('T11')).toMatchObject({ mu: 0.5, lambda_min: 0.01, lambda_max: 1.99, decay_fraction: 0.05 })
    expect(v('T12').x_values).toEqual(ACCEPTANCE_INPUTS.T12.x_values)
    expect(v('T12').sigma_list).toEqual(ACCEPTANCE_INPUTS.T12.sigma_list)
    expect(v('T13')).toMatchObject({ sigma_v_fs: 100, N: 4096, mu_fs: 10, C: 1, sigma_eta2: 1 / 4096 })
    expect(v('T14')).toMatchObject({ fs_hz: 4e9, N: 4096 })
    expect(v('T15').At_peak_s).toBeCloseTo(ACCEPTANCE_INPUTS.T15.At_peak_fs * 1e-15, 30)
    expect(v('T15')).toMatchObject({ f_out_hz: 13e9, fx_hz: 1e5, fw_hz: 1e4 })
    expect(v('T16')).toMatchObject({ target_lsb: 32.4, pattern: [32, 32, 33, 32, 33], bits: 6 })
    expect(v('T17')).toMatchObject(ACCEPTANCE_INPUTS.T17)
    expect(v('T18').J).toEqual(ACCEPTANCE_INPUTS.T18.J)
    expect(v('T18').M).toEqual([
      [0.2, 0],
      [0, 0.2],
    ])
  })
})

describe('acceptance：T01–T18 每個 key 都與 golden vector 一致（呼叫各章模型）', () => {
  it('T01: 手算 LMS w₁ = 1.8、w₂ = 2.28（= 57/25）、trace、pole 0.6（lms.runScalarLms）', () => {
    const c = expectFullMatch('T01')
    expect(c.values.w2).toBeCloseTo(2.28, 14)
  })
  it('T02: 固定 x = 2 ⇒ 0 < μ < 0.5（二分法求邊界、pole 分類、converges_list）', () => {
    const c = expectFullMatch('T02')
    expect(c.values.converges_list).toEqual([1, 1, 1, 1, 0, 0, 0])
  })
  it('T03: Gaussian ⇒ mean 上限 2、mean-square 上限 2/3；±1 與 Uniform 的均方上限', () => {
    expectFullMatch('T03')
  })
  it('T04: P(q=+1) = 0.503989、K_q = 0.00797885/fs；0/1 編碼反面（0.125、+41.27 fs）', () => {
    expectFullMatch('T04')
  })
  it('T05: CLT / split / strict / 奇數 N+1 四種解讀、95%/99% 精確門檻（42499、85011、42500、42750）', () => {
    const c = expectFullMatch('T05')
    expect(c.values.N_exact_even_strict_95).toBe(42750)
  })
  it('T06: φ = 120° ⇒ C = −0.25 < 0、p = 1.01995；H_PD(j0.3ω_n) 155.22°；極性接反 p = 1.0798', () => {
    expectFullMatch('T06')
  })
  it('T07: φ = −120°、Ω = π/6、D = 4 ⇒ θ = 0°、C_D = 0.5、best D = 4、PM_pol = 90°', () => {
    expectFullMatch('T07')
  })
  it('T08: g = 1 ⇒ pole 0、PM 60°、ω_c = π/3（封閉式 = 數值 crossover）', () => {
    expectFullMatch('T08')
  })
  it('T09: r = .8、b = .2、c = 1、μ = 1.2 ⇒ |z| = 1.01980 > 1；full 0 < μ < 1、簡化 0 < μ < 2', () => {
    expectFullMatch('T09')
  })
  it('T10: R(ρ = .99) ⇒ λ = 1.99 / 0.01、κ = 199、eigenvectors；ρ = 1 ⇒ [2, 0]', () => {
    expectFullMatch('T10')
  })
  it('T11: 慢 pole 0.995、598 blocks（時域第一次 ≤ 5% 也是 598）；M = 0.5R⁻¹ ⇒ 0.5、5 blocks', () => {
    expectFullMatch('T11')
  })
  it('T12: x ∈ {−2..2}、c₃ = 0.1 ⇒ MSE-LMS w* = 1.34；Sign-LMS mean-field σ = 10、100', () => {
    expectFullMatch('T12')
  })
  it('T13: p = 0.92021、σ_w = 0.39919 fs；sum 模式 g = 326.8、pole −325.8', () => {
    expectFullMatch('T13')
  })
  it('T14: f_u = 976.5625 kHz；(1 − p) 12.40、−ln p 12.92、exact 12.93 kHz；ENBW 20.29 kHz', () => {
    expectFullMatch('T14')
  })
  it('T15: β = 4.084e−5 rad、−93.80 dBc；δt = x·δw 在 90/110 kHz 各 0.5 fs peak（時域 toneFit）', () => {
    expectFullMatch('T15')
  })
  it('T16: 平均 32.4、週期 5；freeze 32（−0.4 LSB）；|DFT|/5；一階 EFB [32,33,32,33,32]', () => {
    expectFullMatch('T16')
  })
  it('T17: Bernoulli：平均 32.4、變異 0.24 LSB²、RMS 0.4899', () => {
    expectFullMatch('T17')
  })
  it('T18: A = I + MJ = [[.8,.4],[.4,.8]]、eig 1.2 / 0.4（發散）；regularized poles 0.5455 / 0.5055', () => {
    expectFullMatch('T18')
  })

  it('獨立路徑的說明文字：每段 $…$ 都是合法 TeX；標註的勘誤編號都存在；至少 20 項比對連到勘誤', () => {
    let tagged = 0
    for (const id of ACCEPTANCE_IDS) {
      const c = ACCEPTANCE_COMPUTE[id]()
      const labels = new Set<string>()
      for (const k of c.checks) {
        expectTexOk(k.label, `${id} label`)
        expectTexOk(k.method, `${id} method`)
        expect(labels.has(k.label), `${id} 重複的 label：${k.label}`).toBe(false)
        labels.add(k.label)
        for (const e of k.errata) expect(ERRATA_IDS.has(e), `${id}：${e}`).toBe(true)
        if (k.errata.length) tagged++
      }
    }
    expect(tagged).toBeGreaterThanOrEqual(20)
  })

  it('runAllAcceptance：18 項全部算完、沒有例外，總耗時合理', () => {
    const t0 = Date.now()
    const { results, errors } = runAllAcceptance()
    expect(errors).toEqual({})
    expect(results.map((r) => r.id)).toEqual([...ACCEPTANCE_IDS])
    expect(Date.now() - t0).toBeLessThan(15000)
  })
})

describe('acceptance：反面測試（規格 §17 末段；golden negative_tests.json）', () => {
  const neg = load('negative_tests')

  it('T06/T10/T07/T13/T04: 極性反轉、缺乏 PE、code 錯位、sum-mode scaling、0/1 編碼、定點 overflow 全部與 golden 一致', () => {
    const cmp = compareToGolden(neg, computeNegativeValues())
    expect(cmp.keys.filter((k) => k.pass !== true).map((k) => k.key)).toEqual([])
    expect(cmp.status).toBe('pass')
    const v = computeNegativeValues()
    expect(v.reversed_polarity_pole as number).toBeGreaterThan(1) // 發散
    expect(v.gmac_17bit_wrapped_sum as number).toBeLessThan(0) // 正相關被讀成負
  })

  it('PLL 誤差與輸出路徑混淆：H_PD + T = 1；ω = 0.1ω_n 時 |H_PD| < 0.011 但 |T| > 1', () => {
    const rows = pathConfusionCheck()
    for (const r of rows) expect(r.sumErr).toBeLessThan(1e-14)
    const r01 = rows.find((r) => r.nu === 0.1)!
    expect(r01.hpdMag).toBeLessThan(0.011)
    expect(r01.tMag).toBeGreaterThan(1)
  })

  it('低取樣率 aliasing：f_x + f_w ≥ f_sim/2 時 simulateMixing 必須警告；正常設定沒有警告', () => {
    const w = aliasingWarnings()
    expect(w.ok).toEqual([])
    expect(w.aliased.join(' ')).toMatch(/alias/)
  })

  it('模型公式有錯，UI 卻顯示成功：9 個故意寫錯的公式全部被 golden 比對抓到；δ 極性約定（E39）則本來就看不出來', () => {
    const res = evaluateMutants(VECTORS)
    expect(res).toHaveLength(MUTANTS.length)
    for (const r of res) {
      const spec = MUTANTS.find((m) => m.id === r.id)!
      expect(r.expected, r.id).not.toBeNull()
      expect(r.detected, `${r.id}: value ${JSON.stringify(r.value)} vs ${JSON.stringify(r.expected)}`).toBe(spec.expectDetected)
      expect(r.asExpected).toBe(true)
    }
    expect(res.filter((r) => r.detected)).toHaveLength(MUTANTS.filter((m) => m.expectDetected).length)
    // 具體數值：PM 漏 /2 ⇒ 0°；σ_w 用 (1 − p) ⇒ 0.553 fs；f_3dB 當 ENBW ⇒ 低估 36%
    const byId = Object.fromEntries(res.map((r) => [r.id, r.value as number]))
    expect(byId['pm-missing-half']).toBeCloseTo(0, 12)
    expect(byId['sigma-w-one-minus-p']).toBeCloseTo(0.5530, 3)
    expect(byId['enbw-as-f3db'] / 20289.018256251733).toBeCloseTo(0.6373, 3)
    expect(byId['strict-tie-as-table']).toBeCloseTo(0.49205, 5)
    expect(byId['kq-forgotten']).toBeCloseTo(0.99996011, 8)
    expect(byId['sign-vs-mse']).toBeCloseTo(1.4, 9)
  })

  it('反面：mutant 自己丟出例外時回報 error（不算「抓到」、asExpected = false），而且不影響其他 mutant', () => {
    const boom = { ...MUTANTS[0], id: 'boom', compute: () => { throw new Error('模型壞了') } }
    const res = evaluateMutants(VECTORS, [boom, MUTANTS[0]])
    expect(res[0]).toMatchObject({ id: 'boom', detected: false, asExpected: false, error: '模型壞了' })
    expect(Number.isNaN(res[0].value as number)).toBe(true)
    expect(res[1]).toMatchObject({ id: MUTANTS[0].id, detected: true, asExpected: true })
    expect(res[1].error).toBeUndefined()
    // golden 缺少該 key 時也不能算抓到（expected = null）
    const noKey = evaluateMutants({}, [MUTANTS[0]])[0]
    expect(noKey).toMatchObject({ expected: null, detected: false, asExpected: false })
  })
})

describe('acceptance：Monte Carlo（固定 seed；與 worker 相同的純函式）', () => {
  it('T03/T04/T05/T17: 單步 g(2/3)、p̂(+1)、N = 42499 判對率、stochastic rounding 的 |z| ≤ 4；E02 反面項目被拒絕', () => {
    const r = runAcceptanceMonteCarlo({ seed: 20261010, scale: 0.5, ids: ['T03', 'T04', 'T05', 'T17'] })
    const bad = r.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.label}: z = ${c.z}`)
    expect(bad).toEqual([])
    expect(r.checks.filter((c) => c.id === 'T05' && c.expect === 'reject')).toHaveLength(1)
    expect(r.checks.every((c) => c.kind === 'behaviour' || Number.isFinite(c.se))).toBe(true)
    // 同 seed 可重現
    const r2 = runAcceptanceMonteCarlo({ seed: 20261010, scale: 0.5, ids: ['T04'] })
    expect(r2.checks[0].estimate).toBe(r.checks.find((c) => c.id === 'T04')!.estimate)
  }, 60000)

  it('T13: 精確 block sign-LMS（Binomial 化簡）的 σ_w² 與 0.15935 fs² 在 4 SE 內；T14: p̂ 推得的 ENBW 與 20.29 kHz 一致', () => {
    const r = runAcceptanceMonteCarlo({ seed: 7, scale: 0.5, ids: ['T13', 'T14'] })
    expect(r.checks).toHaveLength(2)
    for (const c of r.checks) expect(c.pass, `${c.id}: z = ${c.z}`).toBe(true)
    expect(Math.sqrt(r.checks[0].estimate)).toBeCloseTo(0.399, 1)
  }, 60000)

  it('T12: Sign-LMS σ_v = 1 的 block MC 與 mean-field 1.340346 一致（4 SE）', () => {
    const r = runAcceptanceMonteCarlo({ seed: 20261012, scale: 0.5, ids: ['T12'] })
    expect(r.checks[0].pass, `z = ${r.checks[0].z}`).toBe(true)
    expect(r.checks[0].target).toBeCloseTo(1.340346, 6)
  }, 60000)

  it('T06/T07/T18: 閉迴路——φ = 120° 發散且符合線性 pole；D = 4 收斂、D = 0 發散；MIMO 1-bit 引擎發散', () => {
    const r = runAcceptanceMonteCarlo({ seed: 20261010, scale: 0.5, ids: ['T06', 'T07', 'T18'] })
    expect(r.checks.map((c) => c.id)).toEqual(['T06', 'T07', 'T07', 'T18'])
    const bad = r.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.label}: ${c.note}`)
    expect(bad).toEqual([])
  }, 120000)

  it('MC 的 ids 篩選與參數界限：scale 夾在 [0.05, 16]；MC_IDS 都在 ACCEPTANCE_IDS 內', () => {
    for (const id of MC_IDS) expect(ACCEPTANCE_IDS).toContain(id)
    const r = runAcceptanceMonteCarlo({ seed: 1, scale: 0.001, ids: ['T17'] })
    expect(r.scale).toBe(0.05)
    expect(r.checks.every((c) => c.id === 'T17')).toBe(true)
  })

  it('反面：若把期望值故意改錯（target 偏 10 SE），MC 檢查必須判為不通過', () => {
    const r = runAcceptanceMonteCarlo({ seed: 3, scale: 0.25, ids: ['T17'] })
    const c = r.checks[0]
    const zWrong = (c.estimate - (c.target + 10 * c.se)) / c.se
    expect(Math.abs(zWrong)).toBeGreaterThan(c.zCrit)
  })
})

describe('acceptance：Monte Carlo 的統計工具（等效 z、相關樣本的偏差修正、校準分數）', () => {
  it('equivalentZ：ν = ∞ 時不變；ν 有限時 |z| < |t|，且尾機率相同；奇對稱、單調', () => {
    expect(equivalentZ(2.5, Infinity)).toBe(2.5)
    expect(equivalentZ(Number.NaN, 23)).toBeNaN()
    const z = equivalentZ(4, 23)
    expect(z).toBeLessThan(4)
    expect(z).toBeGreaterThan(3.3)
    expect(normCdf(-z)).toBeCloseTo(studentTCdf(-4, 23), 12) // 尾機率相同
    expect(equivalentZ(-4, 23)).toBeCloseTo(-z, 12)
    expect(equivalentZ(0, 15)).toBe(0)
    let prev = -Infinity
    for (let t = -8; t <= 8; t += 0.5) {
      const v = equivalentZ(t, 15)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    // 直接拿 t 和 z_crit = 4 比：ν = 23 時實際誤報率是常態的約 9 倍
    expect(falseAlarmRateT(4, 23) / falseAlarmRate(4)).toBeGreaterThan(5)
    expect(falseAlarmRateT(4, Infinity)).toBe(falseAlarmRate(4))
    // tCritical 是 equivalentZ 的反函數：把 z_crit 換回「幾個估計的 SE」（scipy：t.isf(norm.sf(4), 23) = 4.876700876…）
    expect(tCritical(4, Infinity)).toBe(4)
    expect(tCritical(4, 23)).toBeCloseTo(4.876700876028876, 9)
    expect(tCritical(4, 15)).toBeCloseTo(5.4803760818702125, 9)
    expect(equivalentZ(tCritical(4, 23), 23)).toBeCloseTo(4, 10)
    expect(tCritical(2.5, 5)).toBeGreaterThan(2.5)
    expect(tCritical(0, 23)).toBe(0)
    // 與 scipy 對照：P(|t₂₃| > 4) = 5.625419150716338e−4、等效 z = 3.4490598923107205
    expect(falseAlarmRateT(4, 23)).toBeCloseTo(5.625419150716338e-4, 12)
    expect(equivalentZ(4, 23)).toBeCloseTo(3.4490598923107205, 9)
  })

  it('AR(1) 的 E[s²] 與 E[r₁]：封閉式 = 以共變異矩陣暴力計算的 tr(·)（n = 7、p = 0.7 與 p = −0.4）', () => {
    for (const p of [0.7, -0.4, 0.92]) {
      const n = 7
      // Γ_ij = p^{|i−j|}；c = Mx，M = I − 11ᵀ/n ⇒ E[cᵀAc] = tr(A·MΓM)
      const G = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Math.pow(p, Math.abs(i - j))))
      const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - 1 / n))
      const mul = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)))
      const C = mul(mul(M, G), M) // Cov(c)
      let den = 0
      let num = 0
      for (let i = 0; i < n; i++) den += C[i][i]
      for (let i = 0; i + 1 < n; i++) num += C[i][i + 1]
      // S₁ 的封閉式 = 直接加總
      let s1 = 0
      for (let k = 1; k < n; k++) s1 += (n - k) * Math.pow(p, k)
      expect(ar1LagSum(p, n)).toBeCloseTo(s1, 12)
      expect(ar1SampleVarianceFactor(p, n)).toBeCloseTo(den / (n - 1), 12)
      // 很多條 chain 合併時（R → ∞）E[r₁] → E[num]/E[den]
      expect(ar1Lag1Expectation(p, n, 1e12)).toBeCloseTo(num / den, 10)
    }
    expect(ar1LagSum(1, 5)).toBe(10)
    // 大 n 的漸近式：E[s²]/σ² ≈ 1 − 2p/((1 − p)n)；E[r₁] ≈ p − (1 + 3p)/n（Kendall / Marriott–Pope）
    const p = 0.92
    const n = 4000
    expect(1 - ar1SampleVarianceFactor(p, n)).toBeCloseTo((2 * p) / ((1 - p) * n), 4)
    expect(ar1Lag1Expectation(p, n, 1) - p).toBeCloseTo(-(1 + 3 * p) / n, 5)
    // iid（p = 0）：s² 無偏；r₁ 的期望值 ≈ −1/n
    expect(ar1SampleVarianceFactor(0, 100)).toBe(1)
    expect(ar1Lag1Expectation(0, 100, 1e12)).toBeCloseTo(-1 / 100, 3)
  })

  it('AR(1) 偏差修正的獨立驗證：Gaussian AR(1) Monte Carlo（R = 24 條合併）——E[s²]、合併的 E[r₁] 與封閉式一致；Bartlett 的 SE 在短 chain 低估一成多', () => {
    const p = 0.9202115439197135 // T13 的 pole
    const R = 24
    const sim = (n: number, reps: number, seed: number) => {
      const rng = createRng(seed)
      const sig = Math.sqrt(1 - p * p) // 讓穩態變異數 = 1
      const x = new Float64Array(n)
      let s2Sum = 0
      let s2Sq = 0
      let rSum = 0
      let rSq = 0
      for (let rep = 0; rep < reps; rep++) {
        let num = 0
        let den = 0
        for (let c = 0; c < R; c++) {
          x[0] = rng.normal() // 由穩態分布起跑
          let m = x[0]
          for (let k = 1; k < n; k++) {
            x[k] = p * x[k - 1] + sig * rng.normal()
            m += x[k]
          }
          m /= n
          let d = 0
          let nu = 0
          for (let k = 0; k < n; k++) {
            const ck = x[k] - m
            d += ck * ck
            if (k + 1 < n) nu += ck * (x[k + 1] - m)
          }
          num += nu
          den += d
          const s2 = d / (n - 1)
          s2Sum += s2
          s2Sq += s2 * s2
        }
        const r1 = num / den // 與 calNoise.runNoiseLab 相同：分子、分母各自對 R 條 chain 加總後再相除
        rSum += r1
        rSq += r1 * r1
      }
      const nS = reps * R
      const s2Mean = s2Sum / nS
      const rMean = rSum / reps
      const rSd = Math.sqrt((rSq / reps - rMean * rMean) * (reps / (reps - 1)))
      return { s2Mean, s2Se: Math.sqrt((s2Sq / nS - s2Mean * s2Mean) / nS), rMean, rSd, rSe: rSd / Math.sqrt(reps) }
    }
    // (a) 短 chain n = 200（scale = 0.05 的情形）
    const a = sim(200, 1500, 20261010)
    expect(Math.abs(a.s2Mean - ar1SampleVarianceFactor(p, 200))).toBeLessThan(4 * a.s2Se) // E[s²]/σ² 是精確式
    expect(1 - a.s2Mean).toBeGreaterThan(0.08) // 偏低約 11%：不修正一定被抓到
    const expA = ar1Lag1Expectation(p, 200, R)
    expect(Math.abs(a.rMean - expA)).toBeLessThan(0.12 * a.rSd) // 一階修正的殘餘誤差 ≪ r₁ 自己的標準差（z 偏移 < 0.12）
    expect((p - a.rMean) / a.rSd).toBeGreaterThan(2) // 不修正：系統偏移超過 2 個標準差
    const bartlettA = Math.sqrt((1 - p * p) / (200 * R))
    expect(a.rSd / bartlettA).toBeGreaterThan(1.05) // 漸近 SE 在 n = 200 低估「一成多」（頁面的警告文字）
    expect(a.rSd / bartlettA).toBeLessThan(1.25)
    // (b) n = 1000（scale = 0.25，多 seed 校準的預設）：低估縮小到幾個百分點
    const b = sim(1000, 600, 7)
    expect(Math.abs(b.s2Mean - ar1SampleVarianceFactor(p, 1000))).toBeLessThan(4 * b.s2Se)
    expect(Math.abs(b.rMean - ar1Lag1Expectation(p, 1000, R))).toBeLessThan(0.12 * b.rSd)
    const bartlettB = Math.sqrt((1 - p * p) / (1000 * R))
    expect(b.rSd / bartlettB).toBeGreaterThan(0.95)
    expect(b.rSd / bartlettB).toBeLessThan(1.15)
  }, 120000)

  it('sweepScores / ksStatistic：N(0,1) 的分位數樣本通過；平移 1 或放大 1.5 倍的樣本被抓到', () => {
    const K = 200
    const q = Array.from({ length: K }, (_, i) => -Math.SQRT2 * inverseErfc((2 * (i + 0.5)) / K)) // Φ⁻¹((i + ½)/K)
    const ok = sweepScores(q)
    expect(Math.abs(ok.meanScore)).toBeLessThan(0.5)
    expect(Math.abs(ok.sdScore)).toBeLessThan(1)
    expect(ksStatistic(q.slice().sort((a, b) => a - b)) * Math.sqrt(K)).toBeLessThan(0.2)
    const shifted = sweepScores(q.map((v) => v + 1))
    expect(shifted.meanScore).toBeGreaterThan(SWEEP_SCORE_CRIT)
    const wide = sweepScores(q.map((v) => 1.5 * v))
    expect(wide.sdScore).toBeGreaterThan(SWEEP_SCORE_CRIT)
    expect(ksStatistic(q.map((v) => v + 1).sort((a, b) => a - b)) * Math.sqrt(K)).toBeGreaterThan(KS_CRIT_001)
  })

  it('MC_PLAN：key 唯一、文字為合法 TeX；runAcceptanceMonteCarlo 依清單順序輸出全部 15 項，且 seed 可重現', () => {
    expect(new Set(MC_PLAN.map((p) => p.key)).size).toBe(MC_PLAN.length)
    for (const p of MC_PLAN) {
      expectTexOk(p.label, p.key)
      expectTexOk(p.quantity, p.key)
      expectTexOk(p.method, p.key)
      expect(MC_IDS).toContain(p.id)
    }
    const r = runAcceptanceMonteCarlo({ seed: 5, scale: 0.05 })
    expect(r.checks.map((c) => c.key)).toEqual(MC_PLAN.map((p) => p.key))
    for (const c of r.checks) expectTexOk(c.note, `${c.key} note`)
    const r2 = runAcceptanceMonteCarlo({ seed: 5, scale: 0.05 })
    expect(r2.checks.map((c) => c.estimate)).toEqual(r.checks.map((c) => c.estimate))
    expect(clampMcScale(undefined)).toBe(1)
    expect(clampMcScale(99)).toBe(16)
  }, 120000)

  it('T17: 兩點分布的樣本變異完全由樣本平均決定（z 幾乎相同，不算獨立證據）；lag-1 自相關才是獨立檢查，週期 toggle 的 r₁ = −2/3', () => {
    const r = runAcceptanceMonteCarlo({ seed: 11, scale: 0.5, ids: ['T17'] })
    const [mean, variance, acf] = r.checks
    expect(variance.independent).toBe(false)
    expect(variance.z).toBeCloseTo(mean.z, 2)
    expect(acf.independent).toBe(true)
    expect(Math.abs(acf.z)).toBeLessThan(4)
    expect(toggleLag1()).toBeCloseTo(-2 / 3, 12)
    // 若把 stochastic rounding 換成週期 toggle，r₁ = −2/3 相當於 −2/3·√n 個標準誤
    expect(Math.abs((toggleLag1() - acf.target) / acf.se)).toBeGreaterThan(100)
  }, 60000)

  it('T13/T14: 相關樣本的偏差修正——未修正的 target 會讓 z 有系統性偏移，修正後才以 0 為中心', () => {
    const r = runAcceptanceMonteCarlo({ seed: 21, scale: 0.25, ids: ['T13', 'T14'] })
    const t13 = r.checks[0]
    const t14 = r.checks[1]
    expect(t13.dof).toBe(23)
    expect(Math.abs(t13.z)).toBeLessThan(Math.abs(t13.t) + 1e-12) // 等效 z 比 t 保守
    // n = 1000 個 block：E[s²] 比 σ_w² 低約 2.3%；E[p̂] 比 p 低約 (1 + 2p)/n
    const f = ar1SampleVarianceFactor(0.9202115439197135, 1000)
    expect(f).toBeGreaterThan(0.975)
    expect(f).toBeLessThan(0.98)
    expect(t13.target / 0.15934957675597428).toBeCloseTo(f, 9)
    expect(t14.target).toBeGreaterThan(20289.018256251733) // p̂ 偏低 ⇒ ENBW 偏高
    expect(t14.target / 20289.018256251733 - 1).toBeLessThan(0.04)
  }, 60000)

  it('T03/T04/T05/T13/T14/T17: 換 30 個 seed 重跑——每項 z 的平均 ≈ 0、標準差 ≈ 1（校準通過），合併後通過 KS 檢定；E02 反面項目每次都被拒絕', () => {
    const r = runAcceptanceMcSweep({ seed: 20261010, runs: 30, scale: 0.25, ids: ['T03', 'T04', 'T05', 'T13', 'T14', 'T17'] })
    expect(r.runs).toBe(30)
    expect(new Set(r.seeds).size).toBe(30)
    const cal = r.rows.filter((x) => x.calibrated !== null)
    expect(cal.map((x) => x.key)).toEqual(['T03-g', 'T03-lambda', 'T04-p', 'T05-odd', 'T13-var', 'T14-enbw', 'T17-mean', 'T17-var', 'T17-acf'])
    const bad = cal.filter((x) => !x.calibrated).map((x) => `${x.key}: meanScore ${x.meanScore.toFixed(2)}, sdScore ${x.sdScore.toFixed(2)}`)
    expect(bad).toEqual([])
    for (const x of cal) expect(x.passCount, x.key).toBe(30)
    const strict = r.rows.find((x) => x.key === 'T05-strict')!
    expect(strict.calibrated).toBeNull()
    expect(strict.passCount).toBe(30)
    expect(strict.meanZ).toBeLessThan(-5)
    // 合併：8 個獨立項目 × 30 seeds（T17-var 不計）
    expect(r.pooled.n).toBe(8 * 30)
    expect(r.pooled.ksScaled).toBeLessThan(KS_CRIT_001)
    expect(Math.abs(r.pooled.mean)).toBeLessThan(0.25)
    expect(r.pooled.sd).toBeGreaterThan(0.85)
    expect(r.pooled.sd).toBeLessThan(1.15)
    expect(r.pooled.sorted).toHaveLength(r.pooled.n)
  }, 240000)
})

describe('acceptance：勘誤的數值證據（errata.json 引用的數字，以章節模型即時重算）', () => {
  it('parseQuotedNumber / quotedTolerance：U+2212 負號、+ 號、千分位；容許誤差 = 引用精度的半格', () => {
    expect(parseQuotedNumber('−49.7487')).toEqual({ value: -49.7487, decimals: 4 })
    expect(parseQuotedNumber('+0.020625')).toEqual({ value: 0.020625, decimals: 6 })
    expect(parseQuotedNumber('75,091')).toEqual({ value: 75091, decimals: 0 })
    expect(parseQuotedNumber('-0.5000')).toEqual({ value: -0.5, decimals: 4 })
    expect(() => parseQuotedNumber('1.2e-3')).toThrow(/無法解析/)
    expect(() => parseQuotedNumber('約 3')).toThrow()
    expect(quotedTolerance(1.34, 2)).toBeCloseTo(0.0051, 12)
    expect(quotedTolerance(512, 0)).toBeCloseTo(0.51, 9)
  })

  it('每一項證據都通過；refText 逐字出現在該勘誤的文字中（不是另外手寫的數字）；涵蓋 30 項以上的勘誤', () => {
    const ev = computeErrataEvidence()
    expect(ev.length).toBeGreaterThan(100)
    const failed = ev.filter((e) => !e.pass).map((e) => `${e.eid} ${e.label}: ${e.value} vs ${e.refText} (tol ${e.tol})`)
    expect(failed).toEqual([])
    for (const e of ev) {
      const src = ERRATA.find((x) => x.eid === e.eid)
      expect(src, e.eid).toBeDefined()
      const text = `${src!.location}\n${src!.problem}\n${src!.correction}\n${src!.evidence}`
      expect(text.includes(e.refText), `${e.eid}：「${e.refText}」不在勘誤文字中`).toBe(true)
      expectTexOk(e.label, `${e.eid} evidence`)
      expect(e.call.length).toBeGreaterThan(3)
      expect(Number.isFinite(e.value)).toBe(true)
    }
    const covered = new Set(ev.map((e) => e.eid))
    expect(covered.size).toBeGreaterThanOrEqual(30)
    for (const eid of ['E01', 'E02', 'E05', 'E06', 'E14', 'E19', 'E24', 'E44', 'E46']) expect(covered.has(eid), eid).toBe(true)
  })

  it('反面：證據比對真的有檢定力——把引用的數字改掉最後一位就不通過', () => {
    const ev = computeErrataEvidence()
    const e = ev.find((x) => x.refText === '0.492050')!
    const wrong = parseQuotedNumber('0.492052')
    expect(Math.abs(e.value - wrong.value)).toBeGreaterThan(quotedTolerance(wrong.value, wrong.decimals))
    // lms.gaussianLyapunov（共用檔）在 λ(2/3) 有約 1.6e−6 的積分誤差：以 6 位小數的引用精度會被抓到，所以證據改用 Dawson 封閉式
    const lam = ev.find((x) => x.refText === '−0.486440')!
    expect(Math.abs(lam.value - lam.reference)).toBeLessThan(5e-7)
  })
})

/** erfc 的反函數（測試用；二分法）：用來產生 N(0,1) 的精確分位數 */
function inverseErfc(y: number): number {
  // Φ⁻¹(u) = −√2·erfc⁻¹(2u)；這裡直接對 Φ 做二分
  const u = y / 2
  let lo = -10
  let hi = 10
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (lo + hi)
    if (normCdf(m) < u) lo = m
    else hi = m
  }
  return -0.5 * (lo + hi) / Math.SQRT2
}

describe('acceptance：TeX 數字格式', () => {
  it('texNumber：一般數字、極小／極大值改用科學記號、0 / NaN / ∞', async () => {
    const { texNumber } = await import('./acceptance')
    expect(texNumber(0.9202115439, 6)).toBe('0.920212')
    expect(texNumber(0.0000148898, 4)).toBe('1.489\\times10^{-5}')
    expect(texNumber(251300.4, 3)).toBe('251000')
    expect(texNumber(3.2e9, 2)).toBe('3.2\\times10^{9}')
    expect(texNumber(-1e-7, 3)).toBe('-1\\times10^{-7}')
    expect(texNumber(0)).toBe('0')
    expect(texNumber(Number.NaN)).toBe('\\mathrm{NaN}')
    expect(texNumber(-Infinity)).toBe('-\\infty')
  })
})
