import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng } from '@/simulation/core'
import { freqz, impulseResponse, lfilter } from '@/simulation/signal'
import {
  ar1Autocorr,
  ar1Psd,
  corrFromAutocorr,
  corrFromPsd,
  corrSingleTone,
  ctHpd as pllCtHpd,
  designDtLoop,
  errorPathTransfer,
} from '@/simulation/models/pll'
import {
  analyzePllPolarity,
  autocorrCorrelation,
  calPole,
  classifyPolarity,
  compareCtDt,
  ctHpd,
  DEFAULT_POLARITY_PARAMS,
  designPolarityLoop,
  dtTypeICoeffs,
  dtTypeIICoeffs,
  empiricalCorrelation,
  generatePolarityCode,
  kqFromSigma,
  lineCorrelation,
  lowFreqReCoef,
  naiveCtWhiteCorrelation,
  pathAndCode,
  periodogramCorrelation,
  periodogramLines,
  polarityMarginDeg,
  reSignBands,
  runPolarityClosedLoop,
  sawtoothFirstOrderIntegral,
  simulateSignLmsChain,
  spectralCorrelation,
  stableMuRange,
  sweepFcwPolarity,
  toneBlockCorrelation,
  toneCorrelation,
  toneEmpirical,
  toneFir,
  toneHandTable,
  toneLargeErrorGain,
  tonePath,
  toneRippleBound,
  buildRegressor,
  empiricalLargeErrorGain,
  impulseMoments,
  sawtoothAutocorr,
  sawtoothLines as sawtoothLinesForTest,
  sawtoothMomentApprox,
  dsmPhaseGrid,
  linearMomentCheck,
  meanFieldCurve,
  meanFieldGmac,
} from '@/simulation/models/polarity'
import { quantizeFcw, runDsm } from '@/simulation/models/dsm'
import { createZigguratNormal } from '@/simulation/models/blockLms'

interface GoldenVector {
  inputs: Record<string, number>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

function golden(id: string): GoldenVector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${id}.json`), 'utf8')) as GoldenVector
}

/** golden 比對規則：|actual − expected| ≤ abs + rel·|expected| */
function expectGolden(actual: number, expected: number, tol: { abs?: number; rel?: number }, label = ''): void {
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
  expect(Math.abs(actual - expected), `${label}: actual ${actual} vs expected ${expected}`).toBeLessThanOrEqual(bound)
}

const deg = (d: number): number => (d * Math.PI) / 180

describe('T06 單頻極性（golden/vectors/T06.json）', () => {
  const g = golden('T06')
  const tol = g.tolerance

  it('T06: C = (A²/2)|H|cosφ = −0.25 < 0；φ = 0/60/90/120/180° 與 golden 逐一相符', () => {
    const { A, H_mag, phi_deg, Omega_rad } = g.inputs
    const C = toneCorrelation({ A, mag: H_mag, phiRad: deg(phi_deg), omega: Omega_rad })
    expectGolden(C, g.expected.C as number, tol, 'C')
    expect(Math.sign(C)).toBe(g.expected.C_sign)
    expect(classifyPolarity(C, 0.5)).toBe('negative')
    const phis = [0, 60, 90, 120, 180]
    const ref = g.expected.C_at_phi_list_deg as number[]
    phis.forEach((p, i) => {
      const c = toneCorrelation({ A, mag: H_mag, phiRad: deg(p), omega: Omega_rad })
      expectGolden(c, ref[i], tol, `φ=${p}`)
      // 與 pll.ts 的 corrSingleTone 一致
      expect(c).toBeCloseTo(corrSingleTone({ amplitude: A, magnitude: H_mag, phaseRad: deg(p), omega: Omega_rad }), 14)
    })
    expect(polarityMarginDeg(120)).toBe(-30)
    expect(polarityMarginDeg(60)).toBe(30)
  })

  it('T06: 平均 pole p = 1 − μK_qC = 1.0199471 > 1；反面測試：comparator 極性接反 p = 1.0797885', () => {
    const { mu, kq_per_fs } = g.inputs
    const Kq = kqFromSigma(100)
    expectGolden(Kq, kq_per_fs, { abs: 1e-15 }, 'K_q')
    expectGolden(calPole(mu, Kq, g.expected.C as number), g.expected.pole as number, tol, 'pole')
    // 極性接反：等效 C → −C（C = 1 時）⇒ p = 1 + μK_q
    expectGolden(calPole(mu, Kq, -1), g.expected.reversed_polarity_pole as number, tol, 'reversed')
    const neg = golden('negative_tests')
    expectGolden(calPole(mu, Kq, -1), neg.expected.reversed_polarity_pole as number, neg.tolerance, 'negative_tests')
  })

  it('T06: 2-tap FIR h = [1, −√3] 在 Ω = π/6 給出 H = e^{j120°}；時域整數週期平均 = −0.25；手算表 12 點平均 = −0.25', () => {
    const { A, H_mag, phi_deg, Omega_rad } = g.inputs
    const h = toneFir(H_mag, deg(phi_deg), Omega_rad)
    const ref = g.expected.fir_h as number[]
    expectGolden(h[0], ref[0], tol, 'h0')
    expectGolden(h[1], ref[1], tol, 'h1')
    const H = freqz(h, [1], [Omega_rad])[0]
    expect(Math.hypot(H.re, H.im)).toBeCloseTo(1, 13)
    expect((Math.atan2(H.im, H.re) * 180) / Math.PI).toBeCloseTo(120, 11)
    const emp = toneEmpirical({ A, mag: H_mag, phiRad: deg(phi_deg), omega: Omega_rad, length: 12 * 200 })
    expect(emp.C).toBeCloseTo(-0.25, 12)
    const table = toneHandTable({ A, mag: H_mag, phiRad: deg(phi_deg), omega: Omega_rad, rows: 12 })
    expect(table.mean).toBeCloseTo(-0.25, 12)
    expect(table.u[0]).toBeCloseTo(-0.5, 12) // u[0] = 1 − √3·cos(−30°) = −0.5
    expect(table.xu[1]).toBeCloseTo(-0.75, 12)
  })

  it('T06: §6.1 Type-II H_PD(j0.3ω_n) = −0.0815 + j0.0376、相位 155.22°（封閉式 = pll.ts = golden）', () => {
    const { hpd_w_over_wn, hpd_zeta } = g.inputs
    const H = ctHpd('typeII', hpd_w_over_wn, hpd_zeta)
    expectGolden(H.re, g.expected.hpd_re as number, tol, 're')
    expectGolden(H.im, g.expected.hpd_im as number, tol, 'im')
    expectGolden((Math.atan2(H.im, H.re) * 180) / Math.PI, g.expected.hpd_phase_deg as number, { abs: 1e-10 }, 'phase')
    const ref = pllCtHpd(hpd_w_over_wn, { zeta: hpd_zeta, wn: 1 })
    expect(H.re).toBeCloseTo(ref.re, 14)
    expect(H.im).toBeCloseTo(ref.im, 14)
    // Type-I 同一點：Re > 0、相位 73.3°（只變慢、不變號）
    const H1 = ctHpd('typeI', 0.3)
    expect(H1.re).toBeGreaterThan(0)
    expect((Math.atan2(H1.im, H1.re) * 180) / Math.PI).toBeCloseTo(73.3008, 3)
  })

  it('T06: 閉迴路 block sign-LMS：φ = 120° 時 w 遠離 a（平均發散），φ = 0° 收斂；MC 平均符合線性 pole', () => {
    const base = { ...DEFAULT_POLARITY_PARAMS, blocks: 400 }
    const { results } = runPolarityClosedLoop({
      cases: [
        { ...base, id: 'A' },
        { ...base, phiDeg: 0, id: 'B' },
      ],
      seed: 20261010,
      chains: 8,
    })
    const [A, B] = results
    expect(A.C).toBeCloseTo(-0.25, 9)
    expect(A.pole).toBeCloseTo(1.0199471140200715, 9)
    expect(A.diverging).toBe(true)
    expect(Math.abs(A.deltaMean[400])).toBeGreaterThan(100) // δ₀ = 3 fs → 已遠離
    expect(A.check.status).toBe('ok')
    // 大誤差區：線性漂移，GMAC 增益 E[x·sign(u)] < 0
    expect(A.largeErrorGain).toBeLessThan(0)
    expect(B.C).toBeCloseTo(0.5, 9)
    expect(B.diverging).toBe(false)
    let tail = 0
    for (let k = 200; k <= 400; k++) tail += B.deltaMean[k]
    expect(Math.abs(tail / 201)).toBeLessThan(1)
  }, 30000)

  it('T06: 大誤差區的線性漂移：Ω = π/6、φ = 120° 時 E[x·sign u] = −(2+√3)/12（u = 0 的取樣點由雜訊決定），閉迴路斜率 = μ(2+√3)/12', () => {
    const omega = Math.PI / 6
    const exact = -(2 + Math.sqrt(3)) / 12
    for (const [phd, want] of [
      [120, exact],
      [90, 0],
      [0, 2 * ((2 + Math.sqrt(3)) / 12)],
    ] as const) {
      const path = tonePath(1, deg(phd), omega)
      const x = new Float64Array(12 * 100 + 1).map((_, i) => Math.cos(omega * (i - 1)))
      const u = lfilter(path.b, path.a, x).y
      // u 在零交越的取樣點是 ±1e−16 的捨入殘渣：不可讓它的正負號決定結果
      expect(empiricalLargeErrorGain(x, u, 1), `φ=${phd}`).toBeCloseTo(want, 12)
    }
    // 與等分布公式 (2A/π)cos120° = −1/π 只差 2%（F-06.15 標為近似的原因）
    expect(Math.abs(exact - toneLargeErrorGain(1, deg(120), omega))).toBeLessThan(0.008)
    // 閉迴路：誤差變大後 |δ| 每 block 增加 μ|E[x·sign u]| = 3.110 fs
    const { results } = runPolarityClosedLoop({ cases: [{ ...DEFAULT_POLARITY_PARAMS, blocks: 800, id: 'A' }], seed: 20261010, chains: 8, reference: false })
    const d = results[0].deltaMean
    const slope = (d[800] - d[400]) / 400
    expect(results[0].largeErrorGain).toBeCloseTo(exact, 5) // 非整數個週期的有限長度誤差 ~1e−7
    expect(Math.abs(slope - 10 * Math.abs(exact))).toBeLessThan(0.05)
  }, 30000)

  it('T06: 自寫 sign-LMS（chain 0）與 blockLms 參考模型逐 block 相同（同 seed、同 RNG 分流）', () => {
    const cases = [
      { ...DEFAULT_POLARITY_PARAMS, id: 'tone', blocks: 150 },
      { ...DEFAULT_POLARITY_PARAMS, id: 'dsm', mode: 'pll' as const, code: 'dsm1' as const, frac: 0.003, blocks: 60 },
      { ...DEFAULT_POLARITY_PARAMS, id: 'fx', regressor: 'u' as const, D: 2, blocks: 60 },
    ]
    const { results } = runPolarityClosedLoop({ cases, seed: 7, chains: 1 })
    for (const r of results) {
      expect(r.reference, r.id).not.toBeNull()
      let maxd = 0
      for (let k = 0; k < r.deltaMean.length; k++) maxd = Math.max(maxd, Math.abs(r.deltaChains[0][k] - r.reference!.delta[k]))
      expect(maxd, r.id).toBeLessThan(1e-8)
      // 兩者估計 C 的平均窗不同（blockLms 取前 2^17 個 sample），只差有限長度 ripple
      expect(Math.abs(r.C - r.reference!.Cest), r.id).toBeLessThan(1e-4)
    }
  }, 30000)

  it('T06: （反面）C < 0 時降低 μ 不能修正極性——對所有 μ > 0 都 p > 1，只是發散變慢', () => {
    const Kq = kqFromSigma(100)
    for (const mu of [1e-4, 1e-2, 0.1, 1, 10, 100]) {
      const p = calPole(mu, Kq, -0.25)
      expect(p).toBeGreaterThan(1)
    }
    expect(stableMuRange(Kq, -0.25)).toBeNull()
    expect(stableMuRange(Kq, 0)).toBeNull()
    const r = stableMuRange(Kq, 0.5)!
    expect(r[1]).toBeCloseTo(2 / (Kq * 0.5), 9)
    // C = 0：p = 1（沒有恢復力）
    expect(calPole(10, Kq, 0)).toBe(1)
  })

  it('T06: （反面）comparator 極性接反（q → −q）使原本收斂的 φ = 0° 發散', () => {
    const pc = pathAndCode({ ...DEFAULT_POLARITY_PARAMS, phiDeg: 0 })
    const N = 1024
    const K = 300
    const x = generatePolarityCode(pc.code, N * K, 1)
    const ref = buildRegressor(x, pc.path, 'x', 0)
    const run = (pol: 1 | -1) =>
      simulateSignLmsChain({
        x,
        ref,
        path: pc.path,
        a: 3,
        w0: 0,
        mu: 10,
        sigmaV: 100,
        N,
        blocks: K,
        noise: createZigguratNormal(createRng(11).fork('comparator-noise')),
        comparatorPolarity: pol,
      }).delta
    const good = run(1)
    const bad = run(-1)
    expect(Math.abs(good[K])).toBeLessThan(5)
    expect(Math.abs(bad[K])).toBeGreaterThan(100)
  }, 30000)
})

describe('T06 延伸：PLL 模式閉迴路與反面情境', () => {
  it('T06: Type-II、tone 在 0.3ω_n ⇒ 閉迴路發散；同一 tone 換 Type-I ⇒ 收斂（同 seed）', () => {
    const base = { ...DEFAULT_POLARITY_PARAMS, mode: 'pll' as const, code: 'tone' as const, toneRatio: 0.3, bwRatio: 0.01, mu: 100, blocks: 300 }
    const { results } = runPolarityClosedLoop({
      cases: [
        { ...base, loopType: 'typeII', id: 'II' },
        { ...base, loopType: 'typeI', id: 'I' },
      ],
      seed: 20261010,
      chains: 4,
    })
    const [r2, r1] = results
    expect(r2.C).toBeLessThan(0)
    expect(r2.pole).toBeGreaterThan(1)
    expect(r2.diverging).toBe(true)
    expect(r1.C).toBeGreaterThan(0)
    expect(r1.pole).toBeLessThan(1)
    expect(r1.diverging).toBe(false)
  }, 30000)

  it('T06: （反面）φ = 90° ⇒ C = 0、p = 1：沒有恢復力，δ 的 ensemble 變異隨 k 成長（random walk）', () => {
    const { results } = runPolarityClosedLoop({
      cases: [{ ...DEFAULT_POLARITY_PARAMS, phiDeg: 90, a: 0, w0: 0, N: 256, blocks: 400, id: 'z' }],
      seed: 3,
      chains: 32,
      reference: false,
    })
    const r = results[0]
    expect(Math.abs(r.C)).toBeLessThan(1e-9)
    expect(r.pole).toBeCloseTo(1, 12)
    // 只保留前 4 條 chain 的軌跡；用 ensemble 平均無法看變異，改看 4 條 chain 的平均平方
    const ms = (k: number) => r.deltaChains.reduce((acc, ch) => acc + ch[k] * ch[k], 0) / r.deltaChains.length
    expect(ms(400)).toBeGreaterThan(ms(50))
  }, 30000)

  it('T06: （反面）主 PLL 不穩定時拒絕分析並說明原因（不是默默算出數字）', () => {
    expect(() => analyzePllPolarity({ loopType: 'typeI', zeta: 0.7, bwRatio: 0.4, loopDelay: 3, code: 'iid', toneRatio: 1, frac: 0.1, D: 0, seed: 1 })).toThrow(/不穩定/)
    expect(() =>
      runPolarityClosedLoop({ cases: [{ ...DEFAULT_POLARITY_PARAMS, mode: 'pll', loopType: 'typeI', bwRatio: 0.4, loopDelay: 3, id: 'X' }], seed: 1, chains: 1 }),
    ).toThrow(/不穩定/)
    expect(() => runPolarityClosedLoop({ cases: [{ ...DEFAULT_POLARITY_PARAMS, N: 16384, blocks: 2000, id: 'big' }], seed: 1, chains: 1 })).toThrow(/超過/)
  })
})

describe('時間尺度分離的前提（警告必須解釋原因）', () => {
  it('（反面）block 比主 PLL 的記憶短、或不到一個 code 週期時，閉迴路回傳說明原因的警告；預設設定沒有這些警告', () => {
    const base = { ...DEFAULT_POLARITY_PARAMS, mode: 'pll' as const, blocks: 40 }
    const { results } = runPolarityClosedLoop({
      cases: [
        { ...base, id: 'ok' }, // BW/f_ref = 0.01、tone 在 0.3ω_n（週期 ≈ 683）、N = 1024
        { ...base, bwRatio: 0.002, N: 256, toneRatio: 1, id: 'slow-loop' },
        { ...base, code: 'dsm1', frac: 1e-4, id: 'long-period' },
      ],
      seed: 5,
      chains: 2,
      reference: false,
    })
    expect(results[0].warnings.join('')).not.toMatch(/記憶長度|不到一個 code 週期/)
    expect(results[1].warnings.join('')).toMatch(/不到主 PLL 記憶長度.*時間尺度分離/)
    expect(results[1].warnings.join('')).toMatch(/不到一個 code 週期/)
    expect(results[2].warnings.join('')).toMatch(/不到一個 code 週期（≈ 10000 samples）/)
    expect(results[2].warnings.join('')).not.toMatch(/記憶長度/)
  }, 30000)
})

describe('E46：單頻公式的邊界與有限 N block', () => {
  it('Ω = π：cos(2Ωn + …) 不會平均掉，C = A²|H|cosφ（一般公式的 2 倍）；時域交替序列驗證', () => {
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: 0, omega: Math.PI })).toBeCloseTo(1, 14)
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: deg(120), omega: Math.PI })).toBeCloseTo(-0.5, 14)
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: 0, omega: Math.PI, delay: 1 })).toBeCloseTo(-1, 14)
    // 實係數濾波器無法在 Ω = π 給 φ = 120°：toneFir 丟錯，tonePath 吸附到 180°
    expect(() => toneFir(1, deg(120), Math.PI)).toThrow(/E46/)
    const tp = tonePath(1, deg(120), Math.PI)
    expect(tp.edge).toBe(true)
    expect(tp.phiEffRad).toBe(Math.PI)
    const emp = toneEmpirical({ A: 1, mag: 1, phiRad: tp.phiEffRad, omega: Math.PI, length: 1000 })
    expect(emp.C).toBeCloseTo(-1, 12)
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: tp.phiEffRad, omega: Math.PI })).toBeCloseTo(-1, 14)
  })

  it('有限 N block：E46 數值（N = 64 時 −0.20045 / −0.67655、上界 0.78126；N = 1024 時 −0.28451、上界 0.04883）', () => {
    const phi = deg(-120)
    const b1 = toneBlockCorrelation({ A: 1, mag: 1, phiRad: phi, omega: 0.01, N: 64 })
    const b2 = toneBlockCorrelation({ A: 1, mag: 1, phiRad: phi, omega: Math.PI - 0.01, N: 64 })
    const b3 = toneBlockCorrelation({ A: 1, mag: 1, phiRad: phi, omega: Math.PI - 0.01, N: 1024 })
    expect(b1).toBeCloseTo(-0.20045, 5)
    expect(b2).toBeCloseTo(-0.67655, 5)
    expect(b3).toBeCloseTo(-0.28451, 5)
    // E46 的 0.78126 是未截斷的 (A²|H|/2)/(N|sinΩ|)；因 |sin(NΩ)| ≤ N|sinΩ|，可再與 A²|H|/2 取 min
    expect(0.5 / (64 * Math.sin(0.01))).toBeCloseTo(0.78126, 5)
    expect(toneRippleBound({ A: 1, mag: 1, omega: Math.PI - 0.01, N: 64 })).toBeCloseTo(0.5, 12)
    expect(Math.abs(b2 + 0.25)).toBeLessThanOrEqual(0.5)
    expect(toneRippleBound({ A: 1, mag: 1, omega: Math.PI - 0.01, N: 1024 })).toBeCloseTo(0.04883, 5)
  })

  it('toneBlockCorrelation 封閉式 = 實際 FIR 濾波後的逐點平均（隨機參數）', () => {
    const rng = createRng(5)
    for (let t = 0; t < 20; t++) {
      const A = 0.5 + rng.uniform()
      const mag = 0.2 + rng.uniform()
      const phi = (rng.uniform() * 2 - 1) * Math.PI
      const omega = 0.05 + rng.uniform() * 3
      const D = rng.int(0, 8)
      const N = rng.int(16, 300)
      const n0 = rng.int(0, 50)
      const h = toneFir(mag, phi, omega)
      let s = 0
      for (let n = n0; n < n0 + N; n++) {
        const u = h[0] * A * Math.cos(omega * n) + h[1] * A * Math.cos(omega * (n - 1))
        s += A * Math.cos(omega * (n - D)) * u
      }
      expect(toneBlockCorrelation({ A, mag, phiRad: phi, omega, delay: D, N, n0 })).toBeCloseTo(s / N, 10)
      expect(Math.abs(s / N - toneCorrelation({ A, mag, phiRad: phi, omega, delay: D }))).toBeLessThanOrEqual(
        toneRippleBound({ A, mag, omega, N }) + 1e-12,
      )
    }
  })

  it('大誤差增益：單頻等分布時 E[x_D·sign(u)] → (2A/π)cos(φ + ΩD)', () => {
    // Ω/2π 為無理數 ⇒ 相位等分布
    const omega = Math.SQRT2 / 3
    const phi = deg(130)
    const h = toneFir(1, phi, omega)
    let s = 0
    const M = 400000
    for (let n = 1; n <= M; n++) {
      const x = Math.cos(omega * n)
      const u = h[0] * x + h[1] * Math.cos(omega * (n - 1))
      s += x * (u >= 0 ? 1 : -1)
    }
    expect(s / M).toBeCloseTo(toneLargeErrorGain(1, phi, omega), 3)
  })
})

describe('E44：CT 原型與 DT 迴路', () => {
  it('dtTypeIICoeffs 與 pll.ts designDtLoop（dpll）的 H_PD 係數完全相同', () => {
    for (const [w, z, d] of [
      [0.01, 0.7, 0],
      [0.1, 0.7, 1],
      [0.3, 0.5, 2],
      [0.05, 1.2, 4],
    ] as const) {
      const mine = dtTypeIICoeffs(w, z, d)
      const ref = designDtLoop({ wnTs: w, zeta: z, loopDelay: d }).Hpd
      const n = Math.max(mine.a.length, ref.a.length)
      for (let i = 0; i < n; i++) {
        expect(mine.a[i] ?? 0).toBeCloseTo(ref.a[i] ?? 0, 15)
        expect(mine.b[i] ?? 0).toBeCloseTo(ref.b[i] ?? 0, 15)
      }
    }
  })

  it('Ω = 0.3ω_nT_s 的相位：DT d = 0 為 155.240/155.378/155.700°，d = 1 為 155.426/157.238/161.281°（CT 155.2249°）', () => {
    const table: [number, number, number][] = [
      [0, 0.01, 155.24],
      [0, 0.1, 155.378],
      [0, 0.3, 155.7],
      [1, 0.01, 155.426],
      [1, 0.1, 157.238],
      [1, 0.3, 161.281],
    ]
    for (const [d, w, ph] of table) {
      const r = compareCtDt({ type: 'typeII', zeta: 0.7, wLTs: w, loopDelay: d })
      expect(Math.abs(r.dtPhaseAt03 - ph), `d=${d} ω_nT=${w}`).toBeLessThan(2e-3)
      expect(r.ctPhaseAt03).toBeCloseTo(155.2249, 3)
    }
  })

  it('polarity 邊界 Re{H} = 0 由 ω_n 偏移：1.037ω_n / 1.131ω_n（d = 0）、1.122ω_n / 1.493ω_n（d = 1）；ω = ω_n 的相位 98.90° / 120.67°', () => {
    const cases: [number, number, number][] = [
      [0, 0.1, 1.037],
      [0, 0.3, 1.131],
      [1, 0.1, 1.122],
      [1, 0.3, 1.493],
    ]
    for (const [d, w, nu] of cases) {
      const r = compareCtDt({ type: 'typeII', zeta: 0.7, wLTs: w, loopDelay: d })
      expect(Math.abs((r.dtBoundaryNu ?? NaN) - nu), `d=${d} ω_nT=${w}`).toBeLessThan(1.5e-3)
    }
    for (const [d, ph] of [
      [0, 98.9],
      [1, 120.67],
    ] as const) {
      const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: 0.3, loopDelay: d })
      const H = freqz(des.b, des.a, [0.3])[0]
      expect(Math.abs((Math.atan2(H.im, H.re) * 180) / Math.PI - ph)).toBeLessThan(0.01)
    }
  })

  it('白色 code：DT 嚴格因果 ⇒ h[0] = 1、C = σ_x²（精確）；把 Ω 代入 CT H(jΩ/T) 的錯誤做法得 0.93097σ²', () => {
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: 0.1, loopDelay: 0 })
    expect(impulseResponse(des.b, des.a, 1)[0]).toBe(1)
    expect(compareCtDt({ type: 'typeII', zeta: 0.7, wLTs: 0.1, loopDelay: 0 }).whiteDt).toBe(1)
    expect(naiveCtWhiteCorrelation('typeII', 0.1, 0.7)).toBeCloseTo(0.93097, 5)
  })

  it('Type-I：dtTypeICoeffs(K, 0) = pll.ts first_order_hp（ρ = 1 − K）；d = 0 時 Re{H} ≥ 0（沒有負頻帶）', () => {
    const K = 0.2
    const mine = dtTypeICoeffs(K, 0)
    const ref = errorPathTransfer({ kind: 'first_order_hp', parameters: { pole: 1 - K } })
    const om = Array.from({ length: 50 }, (_, i) => 0.01 + (i * 3) / 50)
    const a = freqz(mine.b, mine.a, om)
    const b = freqz(ref.b, ref.a, om)
    a.forEach((v, i) => {
      expect(v.re).toBeCloseTo(b[i].re, 13)
      expect(v.im).toBeCloseTo(b[i].im, 13)
    })
    const sb = reSignBands(mine, { lo: 1e-5, hi: Math.PI, points: 3000, log: true })
    expect(sb.negative).toHaveLength(0)
    for (let nu = 0.01; nu < 100; nu *= 1.7) expect(ctHpd('typeI', nu).re).toBeGreaterThan(0)
  })

  it('低頻展開 Re{H} ≈ κ(Ω/ω_LT)²：Type-II κ = −1；Type-I κ = 1 − K(d + ½)，K(d + ½) > 1 時 Type-I 也在低頻變號（反面測試）', () => {
    const om = 1e-4
    const t2 = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: 0.05, loopDelay: 2 })
    expect(freqz(t2.b, t2.a, [om])[0].re / (om / 0.05) ** 2).toBeCloseTo(-1, 3)
    for (const [K, d] of [
      [0.3, 0],
      [0.6, 1],
      [0.8, 1],
      [0.45, 2],
    ] as const) {
      const des = designPolarityLoop({ type: 'typeI', zeta: 0.7, wLTs: K, loopDelay: d })
      expect(des.stable).toBe(true)
      const ratio = freqz(des.b, des.a, [om])[0].re / (om / K) ** 2
      expect(ratio).toBeCloseTo(lowFreqReCoef('typeI', K, d), 4)
      const sb = reSignBands(des, { lo: 1e-5, hi: Math.PI, points: 2000, log: true })
      if (K * (d + 0.5) > 1) {
        expect(sb.negative.length, `K=${K} d=${d}`).toBeGreaterThan(0)
        expect(sb.negative[0][0]).toBeLessThan(1e-4)
      }
    }
  })

  it('Type-I 迴路延遲的穩定界 K < 2sin(π/(4d+2))（與 §8.3 同一特徵方程）', () => {
    for (const d of [0, 1, 2, 3]) {
      const gc = 2 * Math.sin(Math.PI / (4 * d + 2))
      expect(designPolarityLoop({ type: 'typeI', zeta: 0.7, wLTs: gc * 0.98, loopDelay: d }).stable).toBe(true)
      const bad = designPolarityLoop({ type: 'typeI', zeta: 0.7, wLTs: gc * 1.02, loopDelay: d })
      expect(bad.stable).toBe(false)
      expect(bad.warnings.join('')).toMatch(/不穩定/)
    }
  })
})

describe('§6.2 多頻：C = (1/2π)∫S_xx Re{H} dΩ 的五種算法一致', () => {
  const h = [0.00123, 0.298746, -0.274138, -0.890592, -0.454671, -0.991647, 0.060144]
  const a1 = 0.7
  const sw2 = 1 - a1 * a1
  // Python（Σ h[k]R_x[k − D] 與 scipy quad 的頻域積分）參考值
  const ref: [number, number][] = [
    [0, -0.4982052129339999],
    [1, -0.7126178756199999],
    [2, -1.2363106365999998],
    [3, -1.719228508],
    [5, -1.7262996732999998],
  ]

  it('AR(1) × 隨機 FIR：autocorr 封閉式 = 頻域積分 = pll.ts 的 corrFromPsd / corrFromAutocorr', () => {
    const n = 4096
    const om = new Float64Array(n + 1).map((_, i) => (Math.PI * i) / n)
    const sxx = om.map((w) => ar1Psd(a1, sw2, w))
    const H = freqz(h, [1], om)
    for (const [D, v] of ref) {
      const closed = autocorrCorrelation(h, (l) => ar1Autocorr(a1, sw2, l), D)
      expect(Math.abs(closed - v)).toBeLessThan(1e-12)
      const sp = spectralCorrelation({ omega: om, sxx, H, delay: D })
      expect(Math.abs(sp - v)).toBeLessThan(1e-10)
      expect(sp).toBeCloseTo(corrFromPsd({ omega: om, sxx, h: { b: h, a: [1] }, delay: D }), 12)
      expect(closed).toBeCloseTo(corrFromAutocorr(h, (l) => ar1Autocorr(a1, sw2, l), D), 14)
    }
  })

  it('AR(1) 長序列：時域經驗值、週期圖譜線和都接近封閉式；週期圖譜線功率總和 = 平均功率（Parseval）', () => {
    const rng = createRng(20261010).fork('ar1')
    const L = 1 << 18
    const x = new Float64Array(L)
    x[0] = rng.normal()
    const g = Math.sqrt(sw2)
    for (let i = 1; i < L; i++) x[i] = a1 * x[i - 1] + g * rng.normal()
    const u = lfilter(h, [1], x).y
    const lines = periodogramLines(x)
    let ptot = 0
    let ms = 0
    for (let i = 0; i < lines.power.length; i++) ptot += lines.power[i]
    for (let i = 0; i < L; i++) ms += x[i] * x[i]
    expect(ptot).toBeCloseTo(ms / L, 10)
    for (const [D, v] of ref) {
      const emp = empiricalCorrelation(x, u, D, 16)
      expect(Math.abs(emp - v), `emp D=${D}`).toBeLessThan(0.05)
      const pg = periodogramCorrelation(x, { b: h, a: [1] }, D)
      // 週期圖 = 循環相關，與線性濾波只差 O(len(h)/L)
      expect(Math.abs(pg - emp), `pgram D=${D}`).toBeLessThan(1e-3)
    }
  })

  it('單一譜線的 lineCorrelation = toneCorrelation（任意 Ω、D）', () => {
    const rng = createRng(3)
    for (let t = 0; t < 10; t++) {
      const omega = 0.1 + 2.9 * rng.uniform()
      const D = rng.int(0, 10)
      const tf = { b: [0.3, -0.7, 0.2], a: [1, -0.4] }
      const H = freqz(tf.b, tf.a, [omega])
      const lc = lineCorrelation({ omega: Float64Array.of(omega), power: Float64Array.of(0.5) }, H, D)
      const mag = Math.hypot(H[0].re, H[0].im)
      const phi = Math.atan2(H[0].im, H[0].re)
      expect(lc).toBeCloseTo(toneCorrelation({ A: 1, mag, phiRad: phi, omega, delay: D }), 13)
    }
  })

  it('analyzePllPolarity：Type-II tone 在 0.3ω_n ⇒ C/σ² ≈ −0.0815（四種估計都 < 0 且彼此一致）；Type-I 同點 ≈ +0.0826', () => {
    const r2 = analyzePllPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, code: 'tone', toneRatio: 0.3, frac: 0.01, D: 0, seed: 1 })
    const th = r2.C.theory!
    expect(th / r2.C.sigma2).toBeCloseTo(-0.0815, 3)
    for (const v of [r2.C.empirical, r2.C.periodogram, r2.C.welch, r2.C.autocorr]) {
      expect(v).toBeLessThan(0)
      expect(Math.abs(v - th)).toBeLessThan(0.02 * Math.abs(th) + 2e-4)
    }
    expect(r2.warnings.join('')).toMatch(/C ≤ 0/)
    expect(r2.bands.negative.length).toBeGreaterThan(0)
    // filtered-x（Ĥ = H）：E[u²] = |H(e^{jΩ0})|²σ² > 0，不論 Re{H} 的正負
    const H0 = freqz(r2.design.b, r2.design.a, [r2.omegaTone!])[0]
    expect(r2.C.filtered).toBeGreaterThan(0)
    expect(Math.abs(r2.C.filtered / r2.C.sigma2 - (H0.re ** 2 + H0.im ** 2))).toBeLessThan(0.02 * (H0.re ** 2 + H0.im ** 2) + 1e-4)
    expect(r2.CD.filtered[0]).toBeCloseTo(r2.C.filtered, 12)
    const r1 = analyzePllPolarity({ loopType: 'typeI', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, code: 'tone', toneRatio: 0.3, frac: 0.01, D: 0, seed: 1 })
    // DT（ω_cT = 0.0628）與 CT 的 0.0826 差約 3%（低頻係數 κ = 1 − K/2，E44）
    expect(Math.abs(r1.C.theory! / r1.C.sigma2 - 0.0826)).toBeLessThan(0.004)
    expect(r1.C.empirical).toBeGreaterThan(0)
    expect(r1.bands.negative).toHaveLength(0)
  }, 30000)

  it('analyzePllPolarity：白色 iid code ⇒ C_D = h[D]σ²（D = 0 時 = σ²，E44 精確）', () => {
    const r = analyzePllPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 1, code: 'iid', toneRatio: 0.3, frac: 0.01, D: 0, seed: 9 })
    expect(r.C.theory).toBeCloseTo(r.C.sigma2, 12)
    // 經驗值的抽樣誤差約 √(Σh²/L)
    expect(Math.abs(r.C.empirical - r.C.theory!)).toBeLessThan(0.03)
    expect(Math.abs(r.C.periodogram - r.C.empirical)).toBeLessThan(0.01)
    const hD = impulseResponse(r.design.b, r.design.a, 6)
    for (let d = 0; d <= 5; d++) expect(r.CD.theory![d]).toBeCloseTo(hD[d] * r.C.sigma2, 12)
  }, 30000)
})

describe('低頻直覺：Type-II 的 PD 看到 x 的二次微分', () => {
  it('週期序列（完整週期）：E[x[n−1]·Δ²x[n]] = −E[(Δx[n])²] 恆成立（離散版的分部積分）', () => {
    const rng = createRng(17)
    const P = 97
    const base = Array.from({ length: P }, () => rng.normal())
    const x = (n: number): number => base[((n % P) + P) % P]
    let lhs = 0
    let rhs = 0
    for (let n = 0; n < P; n++) {
      lhs += x(n - 1) * (x(n) - 2 * x(n - 1) + x(n - 2))
      rhs += (x(n) - x(n - 1)) ** 2
    }
    expect(lhs / P).toBeCloseTo(-rhs / P, 12)
  })

  it('單頻：低頻近似 C ≈ −(A²/2)(ω/ω_n)²，0.3ω_n 時 −0.045（精確 −0.04077，二階修正 (1 − 4ζ²)ν²）', () => {
    const nu = 0.3
    const exact = 0.5 * ctHpd('typeII', nu, 0.7).re
    expect(exact).toBeCloseTo(-0.040767, 5)
    const lead = -0.5 * nu * nu
    const second = lead * (1 + (1 - 4 * 0.49) * nu * nu)
    expect(Math.abs(second - exact)).toBeLessThan(Math.abs(lead - exact))
    expect(lowFreqReCoef('typeII', 0.03, 3)).toBe(-1)
  })
})

describe('近整數 FCW：鋸齒波 residue 的抵消定理', () => {
  it('∫_0^∞ Re{H_CT(jν)}/ν² dν：Type-II = 0（ν → 1/ν 反對稱），Type-I = π/2', () => {
    for (const z of [0.4, 0.7, 1.5]) expect(Math.abs(sawtoothFirstOrderIntegral('typeII', z))).toBeLessThan(1e-5)
    expect(sawtoothFirstOrderIntegral('typeI', 0.7)).toBeCloseTo(Math.PI / 2, 5)
  })

  it('一階 DSM residue：近整數時 C/σ² → 0⁺ ≈ (3/π²)(Ω0/ω_n)²（不變號）；三角波 < 0（變號）；MASH ≈ 1', () => {
    const r = sweepFcwPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, fracMin: 5e-4, fracMax: 0.4, points: 14 })
    for (let i = 0; i < r.frac.length; i++) {
      expect(r.dsm1[i], `dsm1 frac=${r.frac[i]}`).toBeGreaterThan(0)
      expect(r.mash[i]).toBeGreaterThan(0.9)
      expect(Math.abs(r.dsm1[i] - r.sawTheory[i])).toBeLessThan(0.05 * Math.abs(r.sawTheory[i]) + 2e-3)
      if (r.ratio[i] < 0.3) {
        expect(r.dsm1[i]).toBeLessThan(0.05)
        expect(Math.abs(r.sawAsymptote[i] - r.dsm1[i])).toBeLessThan(0.15 * r.sawAsymptote[i] + 3e-4)
        expect(r.triangle[i]).toBeLessThan(0)
        expect(r.sine[i]).toBeLessThan(0)
      }
    }
    expect(r.fracL).toBeCloseTo(r.design.wLTs / (2 * Math.PI), 14)
  }, 60000)
})

describe('近整數 FCW：精確的 DT 推導（鋸齒自相關 + 脈衝響應動差）', () => {
  it('鋸齒自相關 R/σ² = 1 − 6t(1 − t)：與 20-bit 一階 DSM residue 的時域自相關一致', () => {
    const R = sawtoothAutocorr(0.25)
    expect(R(0)).toBe(1)
    expect(R(2)).toBeCloseTo(-0.5, 14) // t = ½：B₂(½)/2 = −1/24，除以 σ² = 1/12
    expect(R(-3)).toBeCloseTo(R(3), 14)
    const frac = 0.0123
    const res = runDsm({ kind: 'first_order', frac, bits: 20, length: 1 << 17, normalization: 'standardize' })
    const x = res.code
    const fq = quantizeFcw(frac, 20, false).fracEff
    const Rs = sawtoothAutocorr(fq)
    for (const lag of [0, 1, 7, 40, 81]) {
      let s = 0
      for (let n = lag; n < x.length; n++) s += x[n] * x[n - lag]
      expect(Math.abs(s / (x.length - lag) - Rs(lag)), `lag ${lag}`).toBeLessThan(3e-3)
    }
  })

  it('Type-II DPLL 的動差：Σh = Σk·h = 0（DC 雙重零點）、Σk²·h = 2/K_i（任何 d）；Type-I：Σk·h = −1/K', () => {
    for (const [w, d] of [
      [0.03, 0],
      [0.1, 1],
      [0.05, 3],
    ] as const) {
      const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: w, loopDelay: d })
      const [m0, m1, m2] = impulseMoments(impulseResponse(des.b, des.a, 60000))
      expect(Math.abs(m0)).toBeLessThan(1e-9)
      expect(Math.abs(m1)).toBeLessThan(1e-7 / w)
      expect(m2 * des.Ki).toBeCloseTo(2, 8)
    }
    const t1 = designPolarityLoop({ type: 'typeI', zeta: 0.7, wLTs: 0.2, loopDelay: 2 })
    const [n0, n1] = impulseMoments(impulseResponse(t1.b, t1.a, 20000))
    expect(Math.abs(n0)).toBeLessThan(1e-12)
    expect(n1 * 0.2).toBeCloseTo(-1, 10)
  })

  it('DT 頻域恆等式：∫₀^∞ Re{H(e^{jΩ})}/Ω² dΩ = ∫₀^π Re{H}/(4sin²(Ω/2)) dΩ = −(π/2)·m₁（Type-II = 0；Type-I + latency = π/(2K)）', () => {
    const integ = (tf: { b: number[]; a: number[] }, kappaOverWL2: number): number => {
      // 梯形法；Ω → 0 的極限 Re{H}/Ω² → κ/(ω_LT)²（|1 − e^{−jΩ}|² ≈ Ω²）
      const n = 400000
      const om = Float64Array.from({ length: n + 1 }, (_, i) => (Math.PI * i) / n)
      const H = freqz(tf.b, tf.a, om)
      let acc = 0
      let prev = kappaOverWL2
      for (let i = 1; i <= n; i++) {
        const cur = H[i].re / (4 * Math.sin(om[i] / 2) ** 2)
        acc += 0.5 * (prev + cur) * (Math.PI / n)
        prev = cur
      }
      return acc
    }
    for (const [w, d] of [
      [0.05, 0],
      [0.1, 2],
    ] as const) {
      const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: w, loopDelay: d })
      expect(Math.abs(integ(des, -1 / (w * w))) * w).toBeLessThan(1e-4)
    }
    for (const [K, d] of [
      [0.2, 0],
      [0.3, 1],
    ] as const) {
      const des = designPolarityLoop({ type: 'typeI', zeta: 0.7, wLTs: K, loopDelay: d })
      const m1 = impulseMoments(impulseResponse(des.b, des.a, 20000))[1]
      expect(integ(des, des.lowFreqCoef / (K * K)) / ((-Math.PI / 2) * m1)).toBeCloseTo(1, 4)
    }
  })

  it('（反面）譜線截斷會算錯符號：近整數時 4000 條鋸齒譜線和為負，精確自相關和為正並等於 12·frac²/K_i', () => {
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
    const h = impulseResponse(des.b, des.a, 60000)
    for (const frac of [1e-5, 1e-4]) {
      const exact = autocorrCorrelation(h, sawtoothAutocorr(frac))
      expect(exact).toBeGreaterThan(0)
      expect(exact / ((12 * frac * frac) / des.Ki)).toBeCloseTo(1, 2)
      const lines = sawtoothLinesForTest(2 * Math.PI * frac, 4000)
      const truncated = lineCorrelation(lines, freqz(des.b, des.a, lines.omega)) * 12
      expect(truncated).toBeLessThan(0) // 漏掉 Re{H} ≈ +1 的高頻尾巴 ≈ 6/(π²·4000)
    }
  })

  it('FCW sweep：DSM 模擬 = 精確鋸齒理論 = 動差展開 (3/π²)Δ²（Type-II、d = 0 與 d = 3）；Type-I + latency ≈ (3/π)Δ', () => {
    for (const d of [0, 3]) {
      const r = sweepFcwPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: d, fracMin: 1.5e-4, fracMax: 0.45, points: 10 })
      expect(r.moments[2] * r.design.Ki).toBeCloseTo(2, 8)
      for (let i = 0; i < r.frac.length; i++) {
        expect(r.sawTheory[i], `d=${d} frac=${r.frac[i]}`).toBeGreaterThan(0)
        expect(Math.abs(r.dsm1[i] - r.sawTheory[i])).toBeLessThan(0.2 * Math.abs(r.sawTheory[i]) + 2e-3)
        if (r.ratio[i] < 0.2) {
          expect(Math.abs(r.sawAsymptote[i] / r.sawTheory[i] - 1), `asym d=${d} frac=${r.frac[i]}`).toBeLessThan(0.02)
          const fq = quantizeFcw(r.frac[i], 20, false).fracEff
          expect(r.sawAsymptote[i]).toBeCloseTo((3 / Math.PI ** 2) * ((2 * Math.PI * fq) / r.design.wLTs) ** 2, 10)
        }
      }
    }
    const r1 = sweepFcwPolarity({ loopType: 'typeI', zeta: 0.7, bwRatio: 0.01, loopDelay: 2, fracMin: 1e-4, fracMax: 1e-3, points: 4 })
    for (let i = 0; i < r1.frac.length; i++) {
      const delta = (2 * Math.PI * quantizeFcw(r1.frac[i], 20, false).fracEff) / r1.design.wLTs
      expect(Math.abs(r1.sawTheory[i] / ((3 / Math.PI) * delta) - 1)).toBeLessThan(0.1)
    }
  }, 60000)

  it('T06: （反面）近整數一階 DSM + GMAC code delay D ≥ 1：C_D ≈ −12·frac·D + 12·frac²/K_i，D > frac/K_i 時變號；閉迴路由收斂變發散', () => {
    for (const d of [0, 1]) {
      const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: d })
      const h = impulseResponse(des.b, des.a, 8192)
      for (const frac of [0.002, 5e-4]) {
        for (let D = 0; D <= Math.min(d + 1, 4); D++) {
          const exact = autocorrCorrelation(h, sawtoothAutocorr(frac), D)
          const mom = sawtoothMomentApprox(h, frac, D)
          const twoTerm = -12 * frac * D + (12 * frac * frac) / des.Ki // h[0] = 1、h[1..d] = 0
          expect(Math.abs(mom - exact), `d=${d} frac=${frac} D=${D}`).toBeLessThan(0.01 * Math.abs(exact) + 2e-5)
          expect(Math.abs(twoTerm - exact)).toBeLessThan(0.01 * Math.abs(exact) + 2e-4)
          expect(Math.sign(exact)).toBe(D > frac / des.Ki ? -1 : 1)
        }
      }
    }
    // 20-bit DSM 時域模擬：frac = 0.002、D = 3 ⇒ C_D < 0（D = 0 時 > 0）
    const r0 = analyzePllPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, code: 'dsm1', toneRatio: 0.3, frac: 0.002, D: 0, seed: 1 })
    const r3 = analyzePllPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, code: 'dsm1', toneRatio: 0.3, frac: 0.002, D: 3, seed: 1 })
    expect(r0.C.empirical).toBeGreaterThan(0.04)
    expect(r3.C.empirical).toBeLessThan(-0.01)
    expect(Math.abs(r3.C.empirical - r3.C.theory!)).toBeLessThan(0.002)
    const base = { ...DEFAULT_POLARITY_PARAMS, mode: 'pll' as const, code: 'dsm1' as const, frac: 0.002, mu: 150, blocks: 400 }
    const { results } = runPolarityClosedLoop({
      cases: [
        { ...base, D: 0, id: 'D0' },
        { ...base, D: 4, id: 'D4' },
      ],
      seed: 20261010,
      chains: 4,
      reference: false,
    })
    expect(results[0].pole).toBeLessThan(1)
    expect(results[0].diverging).toBe(false)
    expect(results[1].C).toBeLessThan(0)
    expect(results[1].pole).toBeGreaterThan(1)
    expect(results[1].diverging).toBe(true)
  }, 60000)

  it('analyzePllPolarity：一階 DSM 有封閉式 σ²·Σh(1 − 6t(1 − t))，與時域、譜線和一致', () => {
    const r = analyzePllPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, code: 'dsm1', toneRatio: 0.3, frac: 0.002, D: 0, seed: 20261010 })
    expect(r.C.theory).not.toBeNull()
    expect(Math.abs(r.C.empirical - r.C.theory!)).toBeLessThan(0.03 * r.C.theory!)
    expect(r.C.theory! / r.C.sigma2).toBeGreaterThan(0)
    expect(r.CD.theory).not.toBeNull()
    for (const dd of [0, 3, 10]) expect(Math.abs(r.CD.theory![dd] - r.CD.empirical[dd]), `D=${dd}`).toBeLessThan(0.002)
  }, 30000)

  it('R01：C ≈ 0 的警告寫成「線性化的固定點 w* ≈ a + B/C」，同一句說明超出線性範圍時只是線性外推，並指向 §11.4 的代回檢查', () => {
    const base = { loopType: 'typeII' as const, zeta: 0.7, bwRatio: 0.01, loopDelay: 0, code: 'dsm1' as const, toneRatio: 0.3, D: 0, seed: 1 }
    // 近整數（frac = 1e-4）：C 仍是正的，但只剩 σ_x² 的萬分之一左右 ⇒ 歸類為 C ≈ 0
    const r = analyzePllPolarity({ ...base, frac: 1e-4 })
    expect(r.C.empirical / r.C.sigma2).toBeGreaterThan(0)
    expect(r.C.empirical / r.C.sigma2).toBeLessThan(1e-3)
    const zero = r.warnings.filter((s) => s.startsWith('C ≈ 0'))
    expect(zero).toHaveLength(1)
    const w = zero[0]
    // 整句的形狀：ch06 explorerModel.ts 的 MODEL_TEXT_RULES 以同樣的 regex 接這一句（…都極度敏感（§11.4 …）。，括號內沒有「）」）
    expect(w).toMatch(
      /^C ≈ 0：GMAC 沒有平均恢復力（C_D = [\d.e+-]+），w 會隨雜訊漂移；線性化的固定點 w\* ≈ a \+ B\/C 對任何 bias B 都極度敏感（§11\.4 的代回檢查：B\/C 大到超出線性範圍時只是線性外推，不再是固定點）。$/,
    )
    // 舊的寫法（無條件的「固定點 w* = a + B/C」）不可回來
    expect(w).not.toMatch(/；固定點 w\* = a \+ B\/C/)
    expect(w).not.toMatch(/w\* = a/)
    // 對照：frac = 0.002 時 C 是 σ_x² 的百分之幾，不是 C ≈ 0，沒有這條警告
    const ok = analyzePllPolarity({ ...base, frac: 0.002 })
    expect(ok.C.empirical / ok.C.sigma2).toBeGreaterThan(1e-3)
    expect(ok.warnings.some((s) => s.startsWith('C ≈ 0'))).toBe(false)
  }, 30000)
})

describe('有限相位格點的鋸齒自相關（dsmPhaseGrid）', () => {
  it('P 個等距相位：R/σ² = 1 − 6t(1 − t)·P²/(P² − 1)，與直接枚舉完全相同（P = 2…9、所有 lag）', () => {
    for (let P = 2; P <= 9; P++) {
      for (let q = 1; q < P; q++) {
        // 相位每個 sample 前進 q/P（q 與 P 互質時才走遍 P 個格點）
        let g = P
        let r = q
        while (r) [g, r] = [r, g % r]
        if (g !== 1) continue
        const vals = Array.from({ length: P }, (_, n) => ((n * q) % P) / P)
        const mean = vals.reduce((a, b) => a + b, 0) / P
        const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / P
        expect(varr).toBeCloseTo((P * P - 1) / (12 * P * P), 14)
        const R = sawtoothAutocorr(q / P, P)
        for (let lag = 0; lag < 2 * P; lag++) {
          let acc = 0
          for (let n = 0; n < P; n++) acc += (vals[n] - mean) * (vals[(n + lag) % P] - mean)
          expect(R(lag), `P=${P} q=${q} lag=${lag}`).toBeCloseTo(acc / P / varr, 12)
        }
      }
    }
    // 文件中的例子：frac = 0.25 ⇒ P = 4、R[1]/σ² = −0.2（連續相位公式給 −0.125）
    expect(sawtoothAutocorr(0.25, 4)(1)).toBeCloseTo(-0.2, 14)
    expect(sawtoothAutocorr(0.25)(1)).toBeCloseTo(-0.125, 14)
  })

  it('dsmPhaseGrid：dyadic frac 給真實週期（exact）；frac ≈ p/q 而週期長於紀錄時為 clustered；一般 frac 為 uniform', () => {
    expect(dsmPhaseGrid(0.25, 20, 65536)).toMatchObject({ period: 4, effective: 4, regime: 'exact' })
    expect(dsmPhaseGrid(0.5, 20, 65536)).toMatchObject({ period: 2, regime: 'exact' })
    expect(dsmPhaseGrid(0.375, 20, 65536)).toMatchObject({ period: 8, regime: 'exact' })
    const third = dsmPhaseGrid(1 / 3, 20, 65536)
    expect(third.regime).toBe('clustered')
    expect(third.q).toBe(3)
    expect(third.period).toBe(2 ** 20) // K = 349525 為奇數
    expect(third.effective).toBeGreaterThan(3)
    expect(third.effective).toBeLessThan(3.05)
    expect(dsmPhaseGrid(0.002, 20, 65536).regime).toBe('uniform')
    expect(dsmPhaseGrid(0.0123, 20, 65536).effective).toBe(Number.POSITIVE_INFINITY)
  })

  it('T06: （反面）frac = 0.25 / 0.5 / 0.125 / ⅓ / 0.3 / 0.2：封閉式用對相位格點後與 20-bit DSM 時域值一致（連續相位公式會差 1%–25%）', () => {
    const base = { loopType: 'typeII' as const, zeta: 0.7, bwRatio: 0.01, loopDelay: 0, code: 'dsm1' as const, toneRatio: 0.3, seed: 1 }
    for (const frac of [0.25, 0.5, 0.125, 1 / 3, 0.3, 0.2]) {
      for (const D of [0, 2]) {
        const r = analyzePllPolarity({ ...base, frac, D })
        expect(Math.abs(r.C.empirical - r.C.theory!), `frac=${frac} D=${D}`).toBeLessThan(5e-5)
      }
    }
    // 連續相位（P = ∞）的理論在 frac = 0.5 會錯 25%：C = H(e^{jπ}) ≈ 1.022，而不是 0.767
    const r = analyzePllPolarity({ ...base, frac: 0.5, D: 0 })
    const h = impulseResponse(r.design.b, r.design.a, 4096)
    const ideal = autocorrCorrelation(h, sawtoothAutocorr(0.5))
    expect(Math.abs(ideal - r.C.empirical / r.C.sigma2)).toBeGreaterThan(0.2)
    expect(r.C.empirical / r.C.sigma2).toBeCloseTo(freqz(r.design.b, r.design.a, [Math.PI])[0].re, 6)
  }, 60000)
})

describe('F-06.19 mean-field GMAC 特性 E[G](δ) = E[x_ref·erf(δu/√2σ_v)]', () => {
  const sigmaV = 100
  const Kq = kqFromSigma(sigmaV)

  it('兩個極限：|δu| ≪ σ_v ⇒ K_q·δ·C；|δu| ≫ σ_v ⇒ sign(δ)·E[x·sign u]；E[G] 是 δ 的奇函數', () => {
    const omega = Math.PI / 6
    const path = tonePath(1, deg(120), omega)
    const x = new Float64Array(12 * 200 + 1).map((_, i) => Math.cos(omega * (i - 1)))
    const u = lfilter(path.b, path.a, x).y
    const C = empiricalCorrelation(x, u, 0, 1)
    expect(C).toBeCloseTo(-0.25, 12)
    const small = meanFieldGmac(x, u, 0.5, sigmaV, 1)
    expect(small / (Kq * 0.5 * C)).toBeCloseTo(1, 4)
    const large = meanFieldGmac(x, u, 1e6, sigmaV, 1)
    expect(large).toBeCloseTo(empiricalLargeErrorGain(x, u, 1), 8)
    expect(large).toBeCloseTo(-(2 + Math.sqrt(3)) / 12, 8) // u = 0 的取樣點自動貢獻 0（erf(0) = 0；浮點殘渣 ~1e−16 也只貢獻 ~1e−12）
    expect(meanFieldGmac(x, u, -37, sigmaV, 1)).toBeCloseTo(-meanFieldGmac(x, u, 37, sigmaV, 1), 14)
  })

  it('單頻：E[G](δ) 與 δ·cos(φ + ΩD) 永遠同號——沒有變號點（極性不隨誤差大小改變）', () => {
    const omega = Math.SQRT2 / 3
    for (const [phd, D] of [
      [30, 0],
      [120, 0],
      [-100, 3],
      [80, 5],
    ] as const) {
      const path = tonePath(0.7, deg(phd), omega)
      const x = new Float64Array(20000).map((_, i) => Math.cos(omega * i))
      const u = lfilter(path.b, path.a, x).y
      const ref = buildRegressor(x, path, 'x', D)
      const c = meanFieldCurve(ref, u, sigmaV, { skip: 16, samples: 16384 })
      const want = Math.sign(Math.cos(deg(phd) + omega * D))
      expect(c.cross, `φ=${phd} D=${D}`).toBeNull()
      for (const g of c.G) expect(Math.sign(g)).toBe(want)
    }
  })

  it('T06: 近整數一階 DSM × Type-II：C > 0 但 E[G](δ) 在 δ_c 變號（frac = 0.002：δ_c ≈ 0.766σ_v；frac = 0.001：0.456σ_v）；Type-I 不變號', () => {
    // 參考值來自獨立的 Python（NumPy/SciPy）計算：δ_c = 76.60 fs、45.62 fs（σ_v = 100 fs）
    for (const [frac, want] of [
      [0.002, 76.6],
      [0.001, 45.62],
    ] as const) {
      const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
      const x = generatePolarityCode({ kind: 'dsm1', frac, bits: 20, normalization: 'standardize' }, 4096 + 2 ** 16, 1)
      const u = lfilter(des.b, des.a, x).y
      const C = empiricalCorrelation(x, u, 0, 4096)
      expect(C).toBeGreaterThan(0)
      const c = meanFieldCurve(x, u, sigmaV, { skip: 4096, samples: Math.round(Math.floor(32768 * frac) / frac) })
      expect(c.cross, `frac=${frac}`).not.toBeNull()
      expect(Math.abs(c.cross! - want) / want).toBeLessThan(0.02) // Python 用 2^19 點；這裡 32768 點（整數個週期）
      // 變號點兩側：小 δ 拉回（G > 0），大 δ 推走（G < 0）
      expect(meanFieldGmac(x, u, 0.5 * c.cross!, sigmaV, 4096, 32768)).toBeGreaterThan(0)
      expect(meanFieldGmac(x, u, 2 * c.cross!, sigmaV, 4096, 32768)).toBeLessThan(0)
      // δ_c 只和 δ/σ_v 有關
      const c2 = meanFieldCurve(x, u, 10, { skip: 4096, samples: Math.round(Math.floor(32768 * frac) / frac) })
      expect(c2.cross! / 10).toBeCloseTo(c.cross! / sigmaV, 6)
    }
    const t1 = designPolarityLoop({ type: 'typeI', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
    const x = generatePolarityCode({ kind: 'dsm1', frac: 0.002, bits: 20, normalization: 'standardize' }, 4096 + 2 ** 15, 1)
    const u = lfilter(t1.b, t1.a, x).y
    expect(meanFieldCurve(x, u, sigmaV, { skip: 4096, samples: 32000 }).cross).toBeNull()
  }, 60000)

  it('T06: （反面）閉迴路證實 basin：frac = 0.002、C > 0、線性 pole < 1，但 |δ₀| = 150 fs > δ_c 遠離 a、|δ₀| = 50 fs < δ_c 收斂；漂移斜率 = μ|E[G](δ)|', () => {
    const base = { ...DEFAULT_POLARITY_PARAMS, mode: 'pll' as const, code: 'dsm1' as const, frac: 0.002, mu: 50, blocks: 400 }
    const { results } = runPolarityClosedLoop({
      cases: [
        { ...base, w0: -147, id: 'out' },
        { ...base, w0: -47, id: 'in' },
      ],
      seed: 20261010,
      chains: 4,
      reference: false,
    })
    const [out, inn] = results
    for (const r of results) {
      expect(r.C).toBeGreaterThan(0.04)
      expect(r.pole).toBeLessThan(1)
      expect(r.sCurve.cross).not.toBeNull()
      expect(Math.abs(r.sCurve.cross! - 76.6)).toBeLessThan(1)
    }
    expect(out.diverging).toBe(true)
    expect(out.deltaMean[400]).toBeGreaterThan(1000)
    expect(Math.abs(out.driftSlope - out.driftPred)).toBeLessThan(out.driftTol)
    expect(out.driftPred).toBeGreaterThan(3 * 50 * Math.abs(out.largeErrorGain)) // δ → ∞ 極限（F-06.15）在這裡完全不適用
    expect(out.warnings.join('')).toMatch(/只保證小訊號.*已超過 δ_c/)
    expect(out.check.status).toBe('n/a') // 起始就在線性區之外：不拿線性 pole 來比
    expect(inn.diverging).toBe(false)
    expect(Math.abs(inn.deltaMean[400])).toBeLessThan(20)
  }, 60000)
})

describe('Monte Carlo 交叉比對：linearMomentCheck（平均 + 均方）', () => {
  /** 用線性隨機模型本身產生 R 條 chain：δ_{k+1} = p·δ_k − μ·η_k */
  function synth(pTrue: number, mu: number, noiseVar: number, d0: number, K: number, R: number, seed: number) {
    const rng = createRng(seed)
    const sum = new Float64Array(K + 1)
    const sumSq = new Float64Array(K + 1)
    for (let r = 0; r < R; r++) {
      let d = d0
      for (let k = 0; k <= K; k++) {
        sum[k] += d
        sumSq[k] += d * d
        d = pTrue * d - mu * Math.sqrt(noiseVar) * rng.normal()
      }
    }
    return { sum, sumSq }
  }

  it('模型正確時通過（穩定與不穩定各 20 個 seed 都不誤報）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = synth(0.96, 10, 0.5 / 1024, 3, 400, 8, seed)
      expect(linearMomentCheck({ d0: 3, pole: 0.96, mu: 10, noiseVar: 0.5 / 1024, linearLimit: 30, chains: 8, ...a }).status, `stable seed ${seed}`).toBe('ok')
      const b = synth(1.02, 10, 0.5 / 1024, 3, 400, 8, seed)
      const cb = linearMomentCheck({ d0: 3, pole: 1.02, mu: 10, noiseVar: 0.5 / 1024, linearLimit: 30, chains: 8, ...b })
      expect(cb.status, `unstable seed ${seed}`).toBe('ok')
      expect(cb.k).toBeLessThan(400) // 只比到離開線性區為止
    }
  })

  it('T06: （反面）pole 的符號弄反、GMAC 忘了除以 N、雜訊變異差 10 倍 ⇒ mismatch；線性區不足 ⇒ n/a 並說明原因', () => {
    const a = synth(0.96, 10, 0.5 / 1024, 3, 400, 8, 3)
    const good = { d0: 3, pole: 0.96, mu: 10, noiseVar: 0.5 / 1024, linearLimit: 30, chains: 8, ...a }
    expect(linearMomentCheck(good).status).toBe('ok')
    // C 的符號弄反：預測 p = 1.04（發散），模擬其實收斂
    expect(linearMomentCheck({ ...good, pole: 1.04 }).status).toBe('mismatch')
    // sum-mode / 忘了除以 N：預測的雜訊變異大 1024 倍
    expect(linearMomentCheck({ ...good, noiseVar: 0.5 }).status).toBe('mismatch')
    expect(linearMomentCheck({ ...good, noiseVar: (0.5 / 1024) * 10 }).status).toBe('mismatch')
    expect(linearMomentCheck({ ...good, noiseVar: 0.5 / 1024 / 10 }).status).toBe('mismatch')
    // 模擬是發散的（p = 1.02），卻拿穩定的 pole 去比
    const b = synth(1.02, 10, 0.5 / 1024, 3, 400, 8, 3)
    expect(linearMomentCheck({ ...good, ...b }).status).toBe('mismatch')
    const na = linearMomentCheck({ ...good, linearLimit: 2 })
    expect(na.status).toBe('n/a')
    expect(na.note).toMatch(/線性區不足/)
  })

  it('逐 block 的 pole（blockPoles）：Ĉ_k 起伏時用線性時變模型，平均預測 = δ₀·∏p_k', () => {
    const K = 60
    const poles = Float64Array.from({ length: K }, (_, k) => (k % 2 === 0 ? 0.9 : 1.05))
    const sum = new Float64Array(K + 1)
    const sumSq = new Float64Array(K + 1)
    let d = 5
    for (let k = 0; k <= K; k++) {
      sum[k] = 4 * d
      sumSq[k] = 4 * d * d
      if (k < K) d *= poles[k]
    }
    const r = linearMomentCheck({ d0: 5, pole: 0.975, mu: 1e-9, noiseVar: 1, linearLimit: 100, chains: 4, sum, sumSq, blockPoles: poles })
    expect(r.k).toBe(K)
    expect(r.pred).toBeCloseTo(5 * Math.pow(0.9 * 1.05, K / 2), 10)
    expect(r.mean).toBeCloseTo(r.pred, 10)
    expect(r.status).toBe('ok')
  })
})

describe('FCW sweep：GMAC code delay 與 basin', () => {
  it('D = 1：一階 DSM 在 frac < K_i·D 變號，模擬 = 精確理論 = 動差展開；D = 0 的近整數端有 basin、Type-I 沒有', () => {
    const p = { loopType: 'typeII' as const, zeta: 0.7, bwRatio: 0.01, loopDelay: 0, fracMin: 3e-4, fracMax: 0.45, points: 16 }
    const s1 = sweepFcwPolarity({ ...p, delay: 1 })
    expect(s1.delay).toBe(1)
    expect(s1.fracFlip).toBeCloseTo(s1.design.Ki, 12) // 1 ≤ D ≤ d + 1：frac* = K_i·D
    for (let i = 0; i < s1.frac.length; i++) {
      expect(Math.abs(s1.dsm1[i] - s1.sawTheory[i]), `frac=${s1.frac[i]}`).toBeLessThan(2e-3)
      expect(Math.abs(s1.triangle[i] - s1.triTheory[i])).toBeLessThan(5e-3)
      if (s1.frac[i] < 0.8 * s1.fracFlip) expect(s1.dsm1[i]).toBeLessThan(0)
      if (s1.frac[i] > 1.2 * s1.fracFlip && s1.frac[i] < 0.1) expect(s1.dsm1[i]).toBeGreaterThan(0)
      if (Number.isFinite(s1.sawAsymptote[i]) && s1.ratio[i] < 0.2) expect(Math.abs(s1.sawAsymptote[i] - s1.sawTheory[i])).toBeLessThan(0.02 * Math.abs(s1.sawTheory[i]) + 2e-5)
    }
    expect(Math.min(...s1.mash)).toBeLessThan(-0.5) // MASH：相鄰 sample 反相關，D = 1 就變號
    const s0 = sweepFcwPolarity({ ...p, delay: 0 })
    expect(Number.isNaN(s0.fracFlip)).toBe(true)
    // 整數個週期的紀錄 ⇒ 模擬與精確理論在近整數端幾乎重合
    expect(Math.abs(s0.dsm1[0] - s0.sawTheory[0])).toBeLessThan(1e-5)
    let last = 0
    for (let i = 0; i < s0.frac.length; i++) {
      if (s0.frac[i] < 0.003) {
        expect(s0.basin[i], `basin frac=${s0.frac[i]}`).toBeGreaterThan(last) // 越接近整數 basin 越小
        last = s0.basin[i]
      }
      if (s0.frac[i] > 0.01) expect(Number.isNaN(s0.basin[i])).toBe(true)
    }
    expect(last).toBeGreaterThan(0.2)
    const t1 = sweepFcwPolarity({ ...p, loopType: 'typeI', delay: 0, points: 6 })
    for (const b of t1.basin) expect(Number.isNaN(b)).toBe(true)
    // D 很大時 frac* 用一般式 K_i·Σ_{k<D}h[k](D − k)
    const s5 = sweepFcwPolarity({ ...p, delay: 5, points: 4 })
    const h = impulseResponse(s5.design.b, s5.design.a, 5)
    let sD = 0
    for (let k = 0; k < 5; k++) sD += h[k] * (5 - k)
    expect(s5.fracFlip).toBeCloseTo(s5.design.Ki * sD, 12)
    expect(() => sweepFcwPolarity({ ...p, loopType: 'typeI', bwRatio: 0.4, loopDelay: 3 })).toThrow(/不穩定/)
  }, 120000)
})

describe('reSignBands 與迴路設計', () => {
  it('Type-II（ω_nT = 0.01、d = 0）只有一個交點，位於 1.0035ω_n', () => {
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: 0.01, loopDelay: 0 })
    const sb = reSignBands(des, { lo: 1e-5, hi: Math.PI, points: 3000, log: true })
    expect(sb.crossings).toHaveLength(1)
    expect(sb.crossings[0] / 0.01).toBeCloseTo(1.0035, 3)
    expect(sb.negative[0][0]).toBe(1e-5)
  })

  it('BW/f_ref 換算：Type-I ω_cT = 2π·BW/f_ref；Type-II ω_nT = 2π·BW/f_ref / 2.04895（ζ = 0.7）', () => {
    expect(designPolarityLoop({ type: 'typeI', zeta: 0.7, bwRatio: 0.01 }).wLTs).toBeCloseTo(2 * Math.PI * 0.01, 14)
    expect(designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01 }).wLTs).toBeCloseTo((2 * Math.PI * 0.01) / 2.04895, 5)
    expect(() => designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: -1 })).toThrow(/loop latency/)
  })
})
