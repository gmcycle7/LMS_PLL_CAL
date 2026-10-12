import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cAbs, cArg, createRng, normCdf } from '@/simulation/core'
import { freqz, lfilter } from '@/simulation/signal'
import { ar1Psd, corrFromAutocorr, corrFromPsd, crossResponse, polarityMarginDeg, singleToneFir } from '@/simulation/models/pll'
import { generateCodePattern, runBlockLms } from '@/simulation/models/blockLms'
import {
  HAT_EXACT,
  analyticCorr,
  analyticCorrDirect,
  analyticCorrSweep,
  analyzeFxLab,
  crossIntegralSplit,
  secondDiffApproxEdge,
  secondDiffAr1Corr,
  secondDiffFailBand,
  secondDiffPhaseErrApprox,
  truncatedImpulse,
  bestToneDelay,
  buildHat,
  closedLoopConsistent,
  empiricalCorr,
  pathStability,
  meanWStdErr,
  rawPolarityBoundary,
  codeConfig,
  computeRegressor,
  fxBlockLmsConfig,
  gmacUpdate,
  multiToneCorr,
  multiToneCorrFiltered,
  pathTransfer,
  regressorDelayed,
  regressorFiltered,
  regressorRaw,
  regressorSecondDiff,
  residualPhaseDeg,
  runFxComparison,
  secondDiffResponse,
  secondDiffTransfer,
  toneBlockCorr,
  toneCorrCodeDelay,
  toneCorrErrorDelay,
  type FxCaseResult,
  type FxCaseSpec,
  type FxScenario,
} from './filteredX'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
}

function loadVector(name: string): Vector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as Vector
}

function close(actual: number, expected: number, tol: { abs?: number; rel?: number }): boolean {
  return Math.abs(actual - expected) <= (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
}

const OMEGA = Math.PI / 6
const PHI = (-120 * Math.PI) / 180
const DEG = 180 / Math.PI

/** x = A cos(Ωn) 通過真實濾波器後，取整數週期平均 E[x_ref·u]（略過 warm-up） */
function toneTimeAverage(h: number[], omega: number, periodSamples: number, periods: number, ref: (x: Float64Array) => Float64Array, A = 1): number {
  const warm = 4 * periodSamples
  const n = warm + periods * periodSamples
  const x = Float64Array.from({ length: n }, (_, i) => A * Math.cos(omega * i))
  const u = lfilter(h, [1], x).y
  const xr = ref(x)
  let s = 0
  for (let i = warm; i < n; i++) s += xr[i] * u[i]
  return s / (periods * periodSamples)
}

describe('filteredX：T07 Delay Alignment（golden T07.json）', () => {
  const vec = loadVector('T07')
  const inp = vec.inputs as { A: number; H_mag: number; phi_deg: number; Omega_rad: number; D: number; D_list: number[] }
  const exp = vec.expected as {
    theta_deg: number
    C_D: number
    C_D_list: number[]
    best_D: number
    polarity_margin_deg: number
    misaligned_C_D_list_phi0: number[]
  }
  const tone = { A: inp.A, mag: inp.H_mag, phiRad: (inp.phi_deg * Math.PI) / 180, omega: inp.Omega_rad }

  it('T07: φ = −120°、Ω = π/6、D = 4 ⇒ 殘餘相位 0°、C_D = A²|H|/2 = 0.5、polarity margin 90°', () => {
    expect(close(residualPhaseDeg(tone.phiRad, tone.omega, inp.D), exp.theta_deg, vec.tolerance)).toBe(true)
    expect(close(toneCorrCodeDelay(tone, inp.D), exp.C_D, vec.tolerance)).toBe(true)
    expect(polarityMarginDeg(residualPhaseDeg(tone.phiRad, tone.omega, inp.D))).toBeCloseTo(exp.polarity_margin_deg, 12)
    const best = bestToneDelay(tone.phiRad, tone.omega, 11)
    expect(best.D).toBe(exp.best_D)
    expect(best.continuous).toBeCloseTo(4, 12)
  })

  it('T07: C_D 對 D = 0…11 的整條曲線與 golden 一致（含 code 錯位的反面清單）', () => {
    inp.D_list.forEach((D, i) => {
      expect(close(toneCorrCodeDelay(tone, D), exp.C_D_list[i], vec.tolerance)).toBe(true)
      expect(close(toneCorrCodeDelay({ ...tone, phiRad: 0 }, D), exp.misaligned_C_D_list_phi0[i], vec.tolerance)).toBe(true)
    })
    // 正相關窗：D ∈ {2..6}（mod 12）
    const positive = inp.D_list.filter((D) => toneCorrCodeDelay(tone, D) > 1e-12)
    expect(positive).toEqual([2, 3, 4, 5, 6])
  })

  it('T07: 真實 2-tap FIR + 時域整數週期平均（用 regressorDelayed）重現公式，誤差 < 1e-12', () => {
    const h = singleToneFir(1, PHI, OMEGA)
    for (let D = 0; D < 12; D++) {
      const td = toneTimeAverage(h, OMEGA, 12, 40, (x) => regressorDelayed(x, D))
      expect(td).toBeCloseTo(toneCorrCodeDelay(tone, D), 12)
    }
  })

  it('T07: 閉迴路 runBlockLms（同 seed paired）——raw-x 發散、delayed-x（D=4）與 filtered-x 收斂到 a', () => {
    const scenario: FxScenario = {
      path: { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: OMEGA },
      code: { kind: 'sinusoid', omega: OMEGA },
      a: 3,
      w0: 0,
      sigmaV: 100,
      N: 1200,
      blocks: 300,
      seed: 20261010,
    }
    const mk = (mode: FxCaseSpec['mode'], D: number): FxCaseSpec => ({ mode, D, mu: 10, hat: HAT_EXACT })
    const res = runFxComparison({ scenario, cases: [{ id: 'A', spec: mk('raw', 0) }, { id: 'B', spec: mk('delayed', 4) }, { id: 'C', spec: mk('filtered', 0) }] })
    const [A, B, C] = res.cases
    // 解析：unit-power code（A²/2 = 1）⇒ C_raw = cos(−120°) = −0.5，C_4 = 1，E[u²] = |H|² = 1
    expect(A.analytic.Cest).toBeCloseTo(-0.5, 2)
    expect(B.analytic.Cest).toBeCloseTo(1, 2)
    expect(C.analytic.Cest).toBeCloseTo(1, 2)
    expect(A.analytic.p).toBeGreaterThan(1)
    expect(B.analytic.p).toBeCloseTo(1 - 10 * Math.sqrt(2 / Math.PI) / 100, 3)
    expect(A.warnings.some((w) => w.startsWith('C ≤ 0'))).toBe(true)
    // 模擬：raw 被推離 a，delayed / filtered 收斂
    expect(Math.abs(A.metrics.wEnd - 3)).toBeGreaterThan(100)
    expect(Math.abs(B.metrics.meanW - 3)).toBeLessThan(0.5)
    expect(Math.abs(C.metrics.meanW - 3)).toBeLessThan(0.5)
    expect(closedLoopConsistent(A, 3, 0).status).toBe('ok')
    expect(closedLoopConsistent(B, 3, 0).status).toBe('ok')
    expect(closedLoopConsistent(C, 3, 0).status).toBe('ok')
  })

  it('T07: 反面——改成延遲 comparator 誤差而不是 code ⇒ 相位變成 φ − ΩD，D = 4 時仍是 −0.25（極性仍錯）', () => {
    expect(toneCorrErrorDelay(tone, 4)).toBeCloseTo(-0.25, 14)
    expect(residualPhaseDeg(tone.phiRad, tone.omega, 4, 'error')).toBeCloseTo(120, 12)
    // 時域：E[x[n]·u[n−D]]
    const h = singleToneFir(1, PHI, OMEGA)
    for (const D of [0, 2, 4, 8]) {
      const warm = 48
      const n = warm + 480
      const x = Float64Array.from({ length: n }, (_, i) => Math.cos(OMEGA * i))
      const u = lfilter(h, [1], x).y
      let s = 0
      for (let i = warm; i < n; i++) s += x[i] * u[i - D]
      expect(s / 480).toBeCloseTo(toneCorrErrorDelay(tone, D), 12)
    }
    // 延遲 error 的最佳 D 是 8（−120° − 240° ≡ 0°），不是 4
    expect(bestToneDelay(tone.phiRad, tone.omega, 11, 'error').D).toBe(8)
  })

  it('T07: 反面——H = 1 但 GMAC code 錯位 D = 4 ⇒ C_D = −0.25（negative_tests.json）', () => {
    const neg = loadVector('negative_tests')
    const e = neg.expected as { misaligned_C_D4_phi0: number }
    const omega = (neg.inputs as { Omega_rad: number }).Omega_rad
    expect(close(toneCorrCodeDelay({ A: 1, mag: 1, phiRad: 0, omega }, 4), e.misaligned_C_D4_phi0, neg.tolerance)).toBe(true)
    const td = toneTimeAverage([1], omega, 12, 40, (x) => regressorDelayed(x, 4))
    expect(close(td, e.misaligned_C_D4_phi0, neg.tolerance)).toBe(true)
  })
})

describe('filteredX：E46 單頻公式的邊界', () => {
  it('Ω = π（交替碼）時時間平均是一般公式的 2 倍：C_D = A²H(e^{jπ})(−1)^D', () => {
    const p = { A: 1, mag: 1, phiRad: 0, omega: Math.PI }
    expect(toneCorrCodeDelay(p, 0)).toBeCloseTo(1, 14)
    expect(toneCorrCodeDelay(p, 1)).toBeCloseTo(-1, 14)
    const td = toneTimeAverage([1], Math.PI, 2, 200, (x) => regressorDelayed(x, 3))
    expect(td).toBeCloseTo(-1, 12)
    // φ = 180°（H = −1）
    expect(toneCorrCodeDelay({ ...p, phiRad: Math.PI }, 0)).toBeCloseTo(-1, 14)
  })

  it('有限 N 的 block 值與 Dirichlet 確切式一致，且 |誤差| ≤ ripple 上界（validation E46 的數值）', () => {
    const cases = [
      { omega: 0.01, N: 64, expect: -0.20045 },
      { omega: Math.PI - 0.01, N: 64, expect: -0.67655 },
      { omega: Math.PI - 0.01, N: 1024, expect: -0.28451 },
    ]
    for (const c of cases) {
      const r = toneBlockCorr({ A: 1, mag: 1, phiRad: PHI, omega: c.omega, D: 0, N: c.N, n0: 0 })
      expect(r.exact).toBeCloseTo(c.expect, 4)
      expect(Math.abs(r.exact - r.longRun)).toBeLessThanOrEqual(r.rippleBound + 1e-15)
      // 時域直接平均（u = |H|cos(Ωn + φ) 的穩態合成）
      let s = 0
      for (let n = 0; n < c.N; n++) s += Math.cos(c.omega * n) * Math.cos(c.omega * n + PHI)
      expect(s / c.N).toBeCloseTo(r.exact, 12)
    }
    const big = toneBlockCorr({ A: 1, mag: 1, phiRad: PHI, omega: 0.01, D: 0, N: 64, n0: 0 })
    // validation 引用的未截斷上界 (A²|H|/2)/(N|sinΩ|) = 0.78126；因 |sin(NΩ)/(N sinΩ)| ≤ 1，本站取 min(1, ·) ⇒ 0.5
    expect(0.5 / (64 * Math.sin(0.01))).toBeCloseTo(0.78126, 4)
    expect(big.rippleBound).toBeCloseTo(0.5, 12)
  })
})

describe('filteredX：多頻與 PSD 積分', () => {
  const h = { b: [0.3, -0.8, 0.5], a: [1] }

  it('多頻 C_D = Σ 各頻 (A_i²/2)|H_i|cos(φ_i + Ω_iD)，與時域平均一致', () => {
    const tones = [
      { A: 1, omega: Math.PI / 6 },
      { A: 0.7, omega: Math.PI / 2 },
    ]
    for (const D of [0, 1, 3, 4]) {
      const mt = multiToneCorr({ tones, h, D })
      const warm = 24
      const n = warm + 12 * 200
      const x = Float64Array.from({ length: n }, (_, i) => tones.reduce((s, t) => s + t.A * Math.cos(t.omega * i), 0))
      const u = lfilter(h.b, h.a, x).y
      const xr = regressorDelayed(x, D)
      let s = 0
      for (let i = warm; i < n; i++) s += xr[i] * u[i]
      expect(s / (n - warm)).toBeCloseTo(mt.total, 12)
    }
  })

  it('AR(1) + FIR：Σ r_hg[m]R_x[m−D]、corrFromAutocorr 與 PSD 積分 (1/2π)∫S Re{H e^{jΩD}} 一致；錯號 e^{−jΩD} 會得到不同值', () => {
    const rho = 0.6
    const code = { kind: 'ar1' as const, rho }
    const grid = Float64Array.from({ length: 4097 }, (_, i) => (Math.PI * i) / 4096)
    const sxx = Float64Array.from(grid, (o) => ar1Psd(rho, 1 - rho * rho, o))
    for (const D of [0, 1, 2, 3]) {
      const a = analyticCorr({ code, h, g: null, D }) as number
      const b = corrFromAutocorr(h.b, (m) => Math.pow(rho, Math.abs(m)), D)
      const c = corrFromPsd({ omega: grid, sxx, h, delay: D })
      expect(a).toBeCloseTo(b, 12)
      expect(a).toBeCloseTo(c, 8)
    }
    // 錯號回歸：把 e^{+jΩD} 寫成 e^{−jΩD} 等於延遲 error，D = 2 時數值不同
    const right = analyticCorr({ code, h, g: null, D: 2 }) as number
    const wrong = analyticCorr({ code, h, g: null, D: -2 }) as number
    expect(Math.abs(right - wrong)).toBeGreaterThan(0.1)
  })

  it('經驗 C（同一段 code）與解析值在 5 個標準誤內一致：sinusoid、AR(1)、white；mash111 無封閉式', () => {
    const base = {
      path: { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 1 },
      mode: 'delayed' as const,
      D: 3,
      hat: HAT_EXACT,
      seed: 7,
      Dmax: 32,
    }
    for (const code of [
      { kind: 'sinusoid' as const, omega: 0.2 },
      { kind: 'ar1' as const, rho: 0.8 },
      { kind: 'white_pm_one' as const },
    ]) {
      const r = analyzeFxLab({ ...base, code })
      for (const k of ['raw', 'delayed', 'filtered'] as const) {
        const c = r.corr[k]
        expect(c.analytic).not.toBeNull()
        expect(Math.abs(c.empirical - (c.analytic as number))).toBeLessThanOrEqual(5 * c.se + 1e-9)
      }
      // sweep 的解析與經驗值
      const an = r.sweep.codeDelay.analytic as Float64Array
      expect(an[3]).toBeCloseTo(r.corr.delayed.analytic as number, 12)
    }
    const mash = analyzeFxLab({ ...base, code: { kind: 'mash111', frac: 0.3 } })
    expect(mash.corr.raw.analytic).toBeNull()
    expect(Number.isFinite(mash.corr.raw.empirical)).toBe(true)
  })
})

describe('filteredX：Filtered-x 與模型誤差（E45）', () => {
  it('Ĥ = H 時 E[u·u_f] = E[u²] ≥ 0，正規化相關 ρ = 1（Cauchy–Schwarz 上限）', () => {
    const r = analyzeFxLab({
      path: { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 },
      code: { kind: 'ar1', rho: 0.9 },
      mode: 'filtered',
      D: 0,
      hat: HAT_EXACT,
      seed: 3,
      Dmax: 8,
    })
    expect(r.corr.filtered.analytic as number).toBeCloseTo(r.Eu2.analytic as number, 12)
    expect(r.rhoActive).toBeCloseTo(1, 12)
    expect(r.hat.exact).toBe(true)
  })

  it('E45：E[u·u_f] = (1/2π)∫S_xx Re{H Ĥ*} dΩ；Ĥ = H·z⁻³ 時與 E[u²] 不同', () => {
    const h = { b: [1, -0.6, 0.25, 0.1, -0.05], a: [1] }
    const hHat = { b: [0, 0, 0, ...h.b], a: [1] }
    const rho = 0.7
    const grid = Float64Array.from({ length: 4097 }, (_, i) => (Math.PI * i) / 4096)
    const sxx = Float64Array.from(grid, (o) => ar1Psd(rho, 1 - rho * rho, o))
    const viaPsd = corrFromPsd({ omega: grid, sxx, h: crossResponse(h, hHat, grid) })
    const closed = analyticCorr({ code: { kind: 'ar1', rho }, h, g: hHat, D: 0 }) as number
    const eu2 = analyticCorr({ code: { kind: 'ar1', rho }, h, g: h, D: 0 }) as number
    expect(closed).toBeCloseTo(viaPsd, 8)
    expect(Math.abs(eu2 - closed)).toBeGreaterThan(0.2)
  })

  it('E45：Monte Carlo E[q·u_f] ≈ K_q·δ·E[u·u_f]（Gaussian v，δ = 5 fs，σ_v = 100 fs，Ĥ = H·z⁻³）', () => {
    const h = { b: [1, -0.6, 0.25, 0.1, -0.05], a: [1] }
    const hHat = { b: [0, 0, 0, ...h.b], a: [1] }
    const rho = 0.7
    const n = 1_000_000
    const rng = createRng(4507)
    const xg = rng.fork('code')
    const vg = rng.fork('noise')
    const x = new Float64Array(n)
    let y = xg.normal()
    for (let i = 0; i < n; i++) {
      y = rho * y + Math.sqrt(1 - rho * rho) * xg.normal()
      x[i] = y
    }
    const u = lfilter(h.b, h.a, x).y
    const uf = regressorFiltered(x, hHat, 0)
    const delta = 5
    const sigma = 100
    let s = 0
    let s2 = 0
    for (let i = 16; i < n; i++) {
      const q = delta * u[i] + sigma * vg.normal() >= 0 ? 1 : -1
      const t = q * uf[i]
      s += t
      s2 += t * t
    }
    const m = n - 16
    const mean = s / m
    const se = Math.sqrt((s2 / m - mean * mean) / m)
    const Kq = Math.sqrt(2 / Math.PI) / sigma
    const pred = Kq * delta * (analyticCorr({ code: { kind: 'ar1', rho }, h, g: hHat, D: 0 }) as number)
    expect(Math.abs(mean - pred)).toBeLessThanOrEqual(4.5 * se + 0.01 * Math.abs(pred))
    // 誤用 E[u²] 的預測差很多
    const wrong = Kq * delta * (analyticCorr({ code: { kind: 'ar1', rho }, h, g: h, D: 0 }) as number)
    expect(Math.abs(mean - wrong)).toBeGreaterThan(10 * se)
    // 理論上的 E[q|u] = erf(δu/(√2σ))：一階近似誤差在這裡 < 1%
    expect(Math.abs(2 * normCdf((delta * 1) / sigma) - 1 - Kq * delta) / (Kq * delta)).toBeLessThan(1e-3)
  })

  it('E45（反面）: 單頻 Ω = π/6，Ĥ = H·z⁻⁴ ⇒ E[u·u_f] = cos 120° = −0.5（unit power），filtered-x 也發散；z⁻³ ⇒ 0', () => {
    const path = { kind: 'single_tone' as const, magnitude: 1, phaseDeg: -120, omega: OMEGA }
    const code = { kind: 'sinusoid' as const, omega: OMEGA }
    const H = pathTransfer(path)
    const hat4 = buildHat(path, { ...HAT_EXACT, extraDelay: 4 }, code)
    const hat3 = buildHat(path, { ...HAT_EXACT, extraDelay: 3 }, code)
    expect(analyticCorr({ code, h: H, g: hat4.full, D: 0 })).toBeCloseTo(-0.5, 12)
    expect(analyticCorr({ code, h: H, g: hat3.full, D: 0 })).toBeCloseTo(0, 12)
    const scenario: FxScenario = { path, code, a: 3, w0: 0, sigmaV: 100, N: 1200, blocks: 300, seed: 11 }
    const res = runFxComparison({
      scenario,
      cases: [
        { id: 'A', spec: { mode: 'filtered', D: 0, mu: 10, hat: HAT_EXACT } },
        { id: 'B', spec: { mode: 'filtered', D: 0, mu: 10, hat: { ...HAT_EXACT, extraDelay: 4 } } },
      ],
    })
    expect(Math.abs(res.cases[0].metrics.meanW - 3)).toBeLessThan(0.5)
    expect(res.cases[1].analytic.Cest).toBeCloseTo(-0.5, 2)
    expect(Math.abs(res.cases[1].metrics.wEnd - 3)).toBeGreaterThan(100)
    expect(res.cases[1].warnings.some((w) => w.includes('E45'))).toBe(true)
    // filtered 模式的 D 是 regressor 的額外延遲：Ĥ = H 時 C_{f,D} = R_u[D] 在 D = 0 最大（不需要、也不應該再延遲）
    const lab = analyzeFxLab({ path, code, mode: 'filtered', D: 0, hat: HAT_EXACT, seed: 1, Dmax: 11 })
    const fil = lab.sweep.filtered.analytic as Float64Array
    expect(Array.from(fil).indexOf(Math.max(...fil))).toBe(0)
  })

  it('相位誤差 Δφ：旋轉器 R(z) 在 code 頻率精確給出 |R| = 1、∠R = Δφ；寬頻 code 時給警告', () => {
    const path = { kind: 'single_tone' as const, magnitude: 0.8, phaseDeg: 40, omega: 0.4 }
    const code = { kind: 'sinusoid' as const, omega: 0.4 }
    const H = pathTransfer(path)
    for (const dphi of [-100, -60, 30, 89, 95]) {
      const hat = buildHat(path, { ...HAT_EXACT, phaseErrDeg: dphi }, code)
      const Hh = freqz(hat.full.b, hat.full.a, [0.4])[0]
      const Hz = freqz(H.b, H.a, [0.4])[0]
      expect(cAbs(Hh)).toBeCloseTo(cAbs(Hz), 12)
      expect((cArg(Hh) - cArg(Hz)) * DEG).toBeCloseTo(dphi, 9)
      const c = analyticCorr({ code, h: H, g: hat.full, D: 0 }) as number
      expect(c).toBeCloseTo(0.64 * Math.cos(dphi / DEG), 12)
      expect(c > 0).toBe(Math.abs(dphi) < 90)
    }
    const wide = buildHat(path, { ...HAT_EXACT, phaseErrDeg: 30 }, { kind: 'white_pm_one' })
    expect(wide.warnings.some((w) => w.includes('相位誤差'))).toBe(true)
  })

  it('Type-II 頻寬誤差（±50%）在低頻 tone 上仍保持 E[u·u_f] > 0（相位差 < 90°）', () => {
    const path = { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 0 }
    const code = { kind: 'sinusoid' as const, omega: 0.03 }
    const H = pathTransfer(path)
    for (const bw of [-50, -20, 20, 100]) {
      const hat = buildHat(path, { ...HAT_EXACT, bwErrPct: bw }, code)
      expect(analyticCorr({ code, h: H, g: hat.full, D: 0 }) as number).toBeGreaterThan(0)
    }
  })
})

describe('filteredX：Type-II DT 例子（E44）與二次差分 regressor', () => {
  const path = { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 0 }

  it('E44：DT H_PD 在 Ω = 0.3ω_nT_s 的相位為 155.378°（CT 為 155.225°），code 需延遲 D = 119', () => {
    const H = pathTransfer(path)
    const z = freqz(H.b, H.a, [0.03])[0]
    expect(cArg(z) * DEG).toBeCloseTo(155.378, 3)
    const best = bestToneDelay(cArg(z), 0.03, 300)
    expect(best.D).toBe(119)
    expect(best.continuous).toBeCloseTo(119.044, 2)
    expect(toneCorrCodeDelay({ A: Math.SQRT2, mag: cAbs(z), phiRad: cArg(z), omega: 0.03 }, 0)).toBeLessThan(0)
  })

  it('regressorSecondDiff 與 filtered-x(Ĥ = [s, −2s, s]) 逐點相同；封閉式 Ĥ₂ = −4 sin²(Ω/2)e^{−jΩ}', () => {
    const rng = createRng(5)
    const x = rng.normalArray(500)
    const s = 37.5
    const a = regressorSecondDiff(x, s)
    const b = regressorFiltered(x, secondDiffTransfer(s), 0)
    for (let i = 0; i < x.length; i++) expect(a[i]).toBeCloseTo(b[i], 10)
    for (const om of [0.01, 0.3, 1.2, 3]) {
      const z = freqz([1, -2, 1], [1], [om])[0]
      const c = secondDiffResponse(om)
      expect(z.re).toBeCloseTo(c.re, 12)
      expect(z.im).toBeCloseTo(c.im, 12)
      expect(cArg(c) * DEG).toBeCloseTo(180 - om * DEG, 9)
    }
  })

  it('二次差分在低頻 tone（Ω = 0.03）修正極性，但在 Ω = π/6 失效（相位差 ≈ −134°）', () => {
    const H = pathTransfer(path)
    const low = { kind: 'sinusoid' as const, omega: 0.03 }
    const high = { kind: 'sinusoid' as const, omega: Math.PI / 6 }
    const hatLow = buildHat(path, { ...HAT_EXACT, base: 'second_diff' }, low)
    expect(analyticCorr({ code: low, h: H, g: null, D: 0 }) as number).toBeLessThan(0)
    expect(analyticCorr({ code: low, h: H, g: hatLow.full, D: 0 }) as number).toBeGreaterThan(0)
    const hatHigh = buildHat(path, { ...HAT_EXACT, base: 'second_diff' }, high)
    expect(analyticCorr({ code: high, h: H, g: null, D: 0 }) as number).toBeGreaterThan(0)
    expect(analyticCorr({ code: high, h: H, g: hatHigh.full, D: 0 }) as number).toBeLessThan(0)
    // computeRegressor 走 secondDiff 的硬體寫法
    const x = Float64Array.from({ length: 64 }, (_, i) => Math.cos(0.03 * i))
    const viaRegion = computeRegressor(x, 'filtered', 2, hatLow)
    const viaFilter = regressorFiltered(x, hatLow.full, 2)
    for (let i = 0; i < 64; i++) expect(viaRegion[i]).toBeCloseTo(viaFilter[i], 9)
  })

  it('二次差分閉迴路：raw-x 發散，second-diff 與 Ĥ = H 都收斂（Ω = 0.03、同 seed）', () => {
    const scenario: FxScenario = {
      path,
      code: { kind: 'sinusoid', omega: 0.03 },
      a: 10,
      w0: 0,
      sigmaV: 20,
      N: 2048,
      blocks: 300,
      seed: 20261010,
    }
    const res = runFxComparison({
      scenario,
      cases: [
        { id: 'A', spec: { mode: 'raw', D: 0, mu: 14, hat: HAT_EXACT } },
        { id: 'B', spec: { mode: 'filtered', D: 0, mu: 160, hat: { ...HAT_EXACT, base: 'second_diff' } } },
        { id: 'C', spec: { mode: 'filtered', D: 0, mu: 160, hat: HAT_EXACT } },
        { id: 'D', spec: { mode: 'delayed', D: 119, mu: 14, hat: HAT_EXACT } },
      ],
    })
    const [A, B, C, D] = res.cases
    expect(A.analytic.p).toBeGreaterThan(1)
    expect(Math.abs(A.metrics.wEnd - 10)).toBeGreaterThan(10)
    for (const r of [B, C, D]) {
      expect(r.analytic.stableMean).toBe(true)
      expect(Math.abs(r.metrics.meanW - 10)).toBeLessThan(2)
    }
  })
})

describe('filteredX：顯示的 regressor 程式碼 = blockLms 實際使用的 x_ref', () => {
  it('raw / delayed / filtered（含模型誤差）與 runBlockLms 的 trace.xRef 逐點一致', () => {
    const scenario: FxScenario = {
      path: { kind: 'type2_dt', wnTs: 0.08, zeta: 0.7, loopDelay: 1 },
      code: { kind: 'ar1', rho: 0.5 },
      a: 3,
      w0: 0,
      sigmaV: 100,
      N: 256,
      blocks: 4,
      seed: 99,
    }
    const specs: FxCaseSpec[] = [
      { mode: 'raw', D: 0, mu: 10, hat: HAT_EXACT },
      { mode: 'delayed', D: 5, mu: 10, hat: HAT_EXACT },
      { mode: 'filtered', D: 2, mu: 10, hat: HAT_EXACT },
      { mode: 'filtered', D: 1, mu: 10, hat: { ...HAT_EXACT, bwErrPct: 30, loopDelayErr: -1, extraDelay: 2, gainErrPct: -20 } },
      { mode: 'filtered', D: 0, mu: 10, hat: { ...HAT_EXACT, base: 'second_diff', extraDelay: 1 } },
    ]
    const { pattern, normalization } = codeConfig(scenario.code)
    const x = generateCodePattern({ pattern, length: scenario.N * 2, seed: scenario.seed, normalization }).code
    for (const spec of specs) {
      const res = runBlockLms(fxBlockLmsConfig(scenario, spec, 2))
      const hat = buildHat(scenario.path, spec.hat, scenario.code)
      const mine = computeRegressor(x, spec.mode, spec.D, hat)
      expect(res.trace.xRef.length).toBe(x.length)
      for (let i = 0; i < x.length; i++) expect(res.trace.xRef[i]).toBeCloseTo(mine[i], 9)
    }
  })

  it('gmacUpdate：G = (1/N)Σ q·x_ref、w ← w + μG', () => {
    const r = gmacUpdate(1, [1, -1, 1, 1], [0.5, -0.5, 1, 0], 2)
    expect(r.G).toBeCloseTo(0.5, 15)
    expect(r.w).toBeCloseTo(2, 15)
    expect(Array.from(regressorRaw([1, 2, 3]))).toEqual([1, 2, 3])
  })
})

describe('filteredX：多頻例子（延遲只是線性相位）', () => {
  it('Type-II 兩個低頻 tone：對 tone 1 最佳的 D 讓總相關變負，filtered-x 恆為 Σ(A²/2)|H|² > 0', () => {
    const H = pathTransfer({ kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 })
    const tones = [
      { A: 1, omega: 0.03 },
      { A: 1, omega: 0.05 },
    ]
    expect(multiToneCorr({ tones, h: H, D: 0 }).total).toBeLessThan(0)
    expect(multiToneCorr({ tones, h: H, D: 119 }).total).toBeLessThan(0)
    const fx = multiToneCorrFiltered({ tones, h: H, hHat: H })
    const mags = multiToneCorr({ tones, h: H, D: 0 }).mags
    expect(fx).toBeCloseTo(0.5 * (mags[0] ** 2 + mags[1] ** 2), 12)
    // 最佳 D 存在但 ρ < 1
    let best = -Infinity
    for (let D = 0; D <= 400; D++) best = Math.max(best, multiToneCorr({ tones, h: H, D }).total)
    const rhoBest = best / Math.sqrt(1 * fx)
    expect(rhoBest).toBeLessThan(0.95)
    expect(fx / Math.sqrt(fx * fx)).toBeCloseTo(1, 12)
  })
})

describe('filteredX：審查後補上的回歸測試', () => {
  const T2 = { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 0 }

  it('bestToneDelay 只在第一個週期內搜尋：Ω = 0.05 時 D = 78（不是下一圈的 329）', () => {
    const H = pathTransfer(T2)
    const z = freqz(H.b, H.a, [0.05])[0]
    const b = bestToneDelay(cArg(z), 0.05, 400)
    expect(b.D).toBe(78)
    expect(b.continuous).toBeCloseTo(77.6158, 3)
    expect(Math.abs(b.D - b.continuous)).toBeLessThan(1)
    // Dmax 小於一個週期時仍受 Dmax 限制
    expect(bestToneDelay(cArg(z), 0.05, 20).D).toBeLessThanOrEqual(20)
  })

  it('多頻例子：對 tone 2 對齊（D = 78）總和為正但 ρ < 1；0…400 的最佳 D = 329 ≈ D₁* + 1 圈 ≈ D₂* + 2 圈', () => {
    const H = pathTransfer(T2)
    const tones = [
      { A: 1, omega: 0.03 },
      { A: 1, omega: 0.05 },
    ]
    const fx = multiToneCorrFiltered({ tones, h: H, hHat: H })
    const at78 = multiToneCorr({ tones, h: H, D: 78 })
    expect(at78.total).toBeGreaterThan(0)
    expect(at78.total / Math.sqrt(fx)).toBeLessThan(0.8)
    let bestD = 0
    let best = -Infinity
    for (let D = 0; D <= 400; D++) {
      const c = multiToneCorr({ tones, h: H, D }).total
      if (c > best) {
        best = c
        bestD = D
      }
    }
    expect(bestD).toBe(329)
    const d1 = bestToneDelay(cArg(freqz(H.b, H.a, [0.03])[0]), 0.03, 400).continuous
    const d2 = bestToneDelay(cArg(freqz(H.b, H.a, [0.05])[0]), 0.05, 400).continuous
    expect(Math.round((bestD - d1) / ((2 * Math.PI) / 0.03))).toBe(1)
    expect(Math.round((bestD - d2) / ((2 * Math.PI) / 0.05))).toBe(2)
  })

  it('analyticCorrSweep 的 AR(1) 遞迴（O(n)）與直接和 Σ_m r_hg[m]ρ^{|m−D|} 一致（正負 ρ、正負 D、IIR h 與 g）', () => {
    const h = pathTransfer({ kind: 'type2_dt', wnTs: 0.07, zeta: 0.9, loopDelay: 2 })
    const g = buildHat({ kind: 'type2_dt', wnTs: 0.07, zeta: 0.9, loopDelay: 2 }, { ...HAT_EXACT, bwErrPct: 40, extraDelay: 1 }, { kind: 'ar1', rho: 0.5 }).full
    for (const rho of [-0.6, 0, 0.5, 0.95]) {
      const code = { kind: 'ar1' as const, rho }
      const Ds = [-7, -1, 0, 1, 3, 25]
      const sweep = analyticCorrSweep({ code, h, g, Ds }) as Float64Array
      Ds.forEach((D, i) => expect(sweep[i]).toBeCloseTo(analyticCorrDirect({ code, h, g, D }) as number, 11))
      const raw = analyticCorrSweep({ code, h, g: null, Ds }) as Float64Array
      Ds.forEach((D, i) => expect(raw[i]).toBeCloseTo(corrFromAutocorr(truncatedImpulse(h), (m) => Math.pow(rho, Math.abs(m)), D), 11))
    }
  })

  it('analyzeFxLab 在極端設定（ρ_x = 0.999、Dmax = 1024、慢迴路）仍能即時完成（主執行緒；單機約 0.2 s）', () => {
    const t0 = performance.now()
    const r = analyzeFxLab({
      path: { kind: 'type2_dt', wnTs: 0.005, zeta: 0.3, loopDelay: 8 },
      code: { kind: 'ar1', rho: 0.999 },
      mode: 'filtered',
      D: 5,
      hat: { ...HAT_EXACT, bwErrPct: 30 },
      seed: 1,
      Dmax: 1024,
    })
    const ms = performance.now() - t0
    // 單機約 0.1–0.2 s；門檻放寬到 4 s（平行跑其他測試時也不會誤報），仍足以抓到 O(len·D) 的退化（數十秒）
    expect(ms).toBeLessThan(4000)
    expect(r.sweep.codeDelay.analytic?.length).toBe(1025)
  }, 20000)

  it('F-07.15：DT 二次差分的低頻相位差 ≈ (1+d)Ω − 2ζΩ/(ω_nT_s)（Ω = 0.01 時相對誤差 < 0.5%），近似邊界與精確失效頻帶一致', () => {
    for (const d of [0, 1, 2]) {
      const path = { ...T2, loopDelay: d }
      const H = pathTransfer(path)
      for (const om of [0.003, 0.01]) {
        const exact = cArg(freqz(H.b, H.a, [om])[0]) - (Math.PI - om)
        const approx = secondDiffPhaseErrApprox(om, 0.1, 0.7, d)
        expect(Math.abs(exact - approx) / Math.abs(exact)).toBeLessThan(0.005)
      }
      const band = secondDiffFailBand(path)
      expect(band).not.toBeNull()
      const edge = secondDiffApproxEdge(0.1, 0.7, d)
      expect(Math.abs(edge - (band as { lo: number }).lo) / edge).toBeLessThan(0.1)
    }
    const b0 = secondDiffFailBand(T2) as { lo: number; hi: number }
    expect(b0.lo).toBeCloseTo(0.1127, 3)
    expect(b0.hi).toBeCloseTo(1.486, 2)
    expect(Number.isNaN(secondDiffApproxEdge(0.5, 0.2, 0))).toBe(true)
  })

  it('F-07.16（反面）：AR(1) 低通 code 下二次差分的確切式 = 封閉式 = 頻域正負票總和；d ≥ 1 時 h[1] = 0、ρ_ref ≈ 0（不適合寬頻 code）', () => {
    const s = 100
    for (const d of [0, 1]) {
      const path = { ...T2, loopDelay: d }
      const H = pathTransfer(path)
      const hImp = truncatedImpulse(H)
      expect(hImp[0]).toBeCloseTo(1, 14)
      expect(hImp[1]).toBeCloseTo(d === 0 ? -(2 * 0.7 * 0.1 + 0.01) : 0, 14)
      for (const rho of [0.98, 0.995]) {
        const code = { kind: 'ar1' as const, rho }
        const g = secondDiffTransfer(s)
        const parts = secondDiffAr1Corr(hImp, rho)
        const closed = analyticCorr({ code, h: H, g, D: 0 }) as number
        expect(s * parts.total).toBeCloseTo(closed, 9)
        const split = crossIntegralSplit({ code, h: H, g }) as { pos: number; neg: number; total: number }
        expect(split.total).toBeCloseTo(closed, 6)
        // 正負票幾乎一樣大（d ≥ 1 時抵消到 1e-3 以內）
        expect(split.pos).toBeGreaterThan(0)
        expect(split.neg).toBeLessThan(0)
        const eu2 = analyticCorr({ code, h: H, g: H, D: 0 }) as number
        const euf2 = analyticCorr({ code, h: g, g, D: 0 }) as number
        expect(euf2).toBeCloseTo(2 * s * s * (1 - rho) * (3 - rho), 8)
        const rhoRef = closed / Math.sqrt(eu2 * euf2)
        if (d === 0) {
          // 主導項 2s(1−ρ)(K_p + K_i) > 0
          expect(closed).toBeGreaterThan(0)
          expect(Math.abs(s * parts.t1 - closed) / closed).toBeLessThan(0.05)
          expect(rhoRef).toBeLessThan(0.1)
        } else {
          expect(Math.abs(split.total)).toBeLessThan(1e-3 * split.pos)
          expect(Math.abs(rhoRef)).toBeLessThan(1e-3)
        }
      }
    }
  })

  it('Lab 提示：type2_dt + 白色 code 的 C_D = h_PD[D] 在 D = 0 最大；single_tone 2-tap FIR + 白色 code 則不在 D = 0', () => {
    const Ds = Array.from({ length: 41 }, (_, i) => i)
    const t2 = analyticCorrSweep({ code: { kind: 'white_pm_one' }, h: pathTransfer({ ...T2, loopDelay: 1 }), g: null, Ds }) as Float64Array
    expect(Array.from(t2).indexOf(Math.max(...t2))).toBe(0)
    const st = analyticCorrSweep({ code: { kind: 'white_pm_one' }, h: pathTransfer({ kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: OMEGA }), g: null, Ds }) as Float64Array
    expect(Array.from(st).indexOf(Math.max(...st))).not.toBe(0)
  })

  it('§7.3 寬頻表的敘述：三種 AR(1) 的最小 C_D 都 < 0，最佳 delayed-x 的 ρ 隨 ρ_x 增大而下降且都 < 1', () => {
    const H = pathTransfer(T2)
    const Ds = Array.from({ length: 121 }, (_, i) => i)
    let prev = Infinity
    for (const rho of [0.5, 0.9, 0.99]) {
      const code = { kind: 'ar1' as const, rho }
      const c = analyticCorrSweep({ code, h: H, g: null, Ds }) as Float64Array
      expect(Math.min(...c)).toBeLessThan(0)
      const r = Math.max(...c) / Math.sqrt(analyticCorr({ code, h: H, g: H, D: 0 }) as number)
      expect(r).toBeLessThan(1)
      expect(r).toBeLessThan(prev)
      prev = r
    }
  })

  it('analyzeFxLab 的解釋性警告（反面）：Ĥ = H·z⁻⁴ ⇒「C ≤ 0 … E45」、z⁻³ ⇒「C ≈ 0」、raw-x 帶 D ⇒ 忽略 D', () => {
    const path = { kind: 'single_tone' as const, magnitude: 1, phaseDeg: -120, omega: OMEGA }
    const code = { kind: 'sinusoid' as const, omega: OMEGA }
    const base = { path, code, seed: 3, Dmax: 12 }
    const w4 = analyzeFxLab({ ...base, mode: 'filtered', D: 0, hat: { ...HAT_EXACT, extraDelay: 4 } }).warnings
    expect(w4.some((w) => w.startsWith('C ≤ 0') && w.includes('E45'))).toBe(true)
    expect(w4.some((w) => w.startsWith('Ĥ ≠ H'))).toBe(true)
    const w3 = analyzeFxLab({ ...base, mode: 'filtered', D: 0, hat: { ...HAT_EXACT, extraDelay: 3 } }).warnings
    expect(w3.some((w) => w.startsWith('C ≈ 0'))).toBe(true)
    const wr = analyzeFxLab({ ...base, mode: 'raw', D: 4, hat: HAT_EXACT }).warnings
    expect(wr.some((w) => w.includes('raw-x 模式忽略 D'))).toBe(true)
    expect(wr.some((w) => w.startsWith('C ≤ 0：更新極性錯誤'))).toBe(true)
  })
})

describe('filteredX：第二輪審查補上的測試（E44 極性邊界、閉迴路交叉比對的判準）', () => {
  it('E44：raw-x 的極性邊界 Re{H_PD} = 0 隨 ω_nT_s 與 loop latency 上移（validation.md：1.037／1.122／1.131／1.493 ω_n）', () => {
    const edge = (wnTs: number, d: number) => (rawPolarityBoundary({ kind: 'type2_dt', wnTs, zeta: 0.7, loopDelay: d }) as number) / wnTs
    // validation.md 的值四捨五入到 3 位小數 ⇒ 容差 1e-3
    for (const [wnTs, d, ref] of [
      [0.1, 0, 1.037],
      [0.1, 1, 1.122],
      [0.3, 0, 1.131],
      [0.3, 1, 1.493],
    ] as const) {
      expect(Math.abs(edge(wnTs, d) - ref)).toBeLessThan(1e-3)
    }
    // 小 ω_nT_s 時回到 CT 原型的 ω_n；邊界兩側 Re{H} 的符號相反
    expect(edge(0.01, 0)).toBeCloseTo(1, 2)
    const path = { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 1 }
    const ob = rawPolarityBoundary(path) as number
    const H = pathTransfer(path)
    expect(freqz(H.b, H.a, [0.98 * ob])[0].re).toBeLessThan(0)
    expect(freqz(H.b, H.a, [1.02 * ob])[0].re).toBeGreaterThan(0)
  })

  it('meanWStdErr：AR(1) 的 M 點平均的標準誤 σ√((1+p)/((1−p)M))（Monte Carlo，保守 < 10%）', () => {
    const p = 0.92
    const M = 150
    const sigma = 0.8
    const rng = createRng(77)
    const trials = 4000
    const drive = sigma * Math.sqrt(1 - p * p)
    let s2 = 0
    for (let t = 0; t < trials; t++) {
      let w = sigma * rng.normal() // 從穩態分布出發
      let acc = 0
      for (let k = 0; k < M; k++) {
        w = p * w + drive * rng.normal()
        acc += w
      }
      s2 += (acc / M) ** 2
    }
    const mc = Math.sqrt(s2 / trials)
    const formula = meanWStdErr(sigma, p, M)
    // 確切值多一個有限 M 的修正項（略小），所以公式略為保守；不是 σ/√M（那會小 4.9 倍）
    expect(formula / mc).toBeGreaterThan(0.97)
    expect(formula / mc).toBeLessThan(1.1)
    expect(formula / (sigma / Math.sqrt(M))).toBeCloseTo(Math.sqrt(1.92 / 0.08), 12)
  })

  /** 合成一個閉迴路結果（只填 closedLoopConsistent 會讀的欄位） */
  function fake(o: { g: number; meanW: number; wEnd?: number; sigmaW?: number; K?: number; mu?: number; sigmaEta2?: number; diverged?: boolean }): FxCaseResult {
    const K = o.K ?? 300
    const p = 1 - o.g
    return {
      id: 'A',
      mu: o.mu ?? 10,
      w: new Float64Array(K + 1),
      G: new Float64Array(K),
      metrics: { meanW: o.meanW, stdW: o.sigmaW ?? 0.8, bias: o.meanW - 3, diverged: o.diverged ?? false, settlingBlock: null, wEnd: o.wEnd ?? o.meanW },
      analytic: {
        Cest: o.g > 0 ? 1 : -1,
        Kq: 0.008,
        g: o.g,
        p,
        stableMean: o.g > 0 && o.g < 2,
        wStarMeanField: 3,
        sigmaWPred: o.sigmaW ?? 0.8,
        tauBlocks: p > 0 && p < 1 ? -1 / Math.log(p) : NaN,
        sigmaEta2: o.sigmaEta2 ?? 1 / 1024,
      },
      warnings: [],
      modelLevel: 'L2',
    }
  }

  it('closedLoopConsistent（反面）：w 完全沒動、但雜訊大到舊判準（5·std）會放行的情況，現在不會標成 ok', () => {
    // a = 3、w0 = 0、σ_w = 0.8、p = 0.92、M = 150 ⇒ SE = 0.32；後半段平均還在 0（沒有收斂）
    const stuck = closedLoopConsistent(fake({ g: 0.08, meanW: 0 }), 3, 0)
    expect(stuck.status).toBe('mismatch') // |0 − 3| = 3 > 5·SE + 1% = 1.63
    // 舊判準 5·std = 4 > 3 會回傳 ok；確認新的容許值確實比 |a − w0| 小
    expect(5 * meanWStdErr(0.8, 0.92, 150)).toBeLessThan(3)
    // 收斂到 a 附近：ok，而且 note 寫出 SE
    const good = closedLoopConsistent(fake({ g: 0.08, meanW: 3.3 }), 3, 0)
    expect(good.status).toBe('ok')
    expect(good.note).toContain('SE')
    // 雜訊太大（σ_w = 3）：平均落在容許範圍內，但也分不出是否離開初值 ⇒ n/a，而不是 ok
    const noisy = closedLoopConsistent(fake({ g: 0.08, meanW: 2.5, sigmaW: 3 }), 3, 0)
    expect(noisy.status).toBe('n/a')
    expect(noisy.note).toContain('雜訊太大')
    // block 數不足 10τ ⇒ n/a；預測收斂但模擬發散 ⇒ mismatch
    expect(closedLoopConsistent(fake({ g: 0.008, meanW: 2.9 }), 3, 0).status).toBe('n/a')
    expect(closedLoopConsistent(fake({ g: 0.08, meanW: NaN, diverged: true }), 3, 0).status).toBe('mismatch')
  })

  it('closedLoopConsistent（反面）：預測發散時，位移要超過隨機漫步 3σ_rw 才算 ok；靠近真值是 mismatch', () => {
    // μ = 10、σ_η² = 1/1024、K = 300 ⇒ σ_rw = 10·√(300/1024) = 5.41 fs
    const sigRw = 10 * Math.sqrt(300 / 1024)
    expect(closedLoopConsistent(fake({ g: -0.04, meanW: NaN, wEnd: -988 }), 3, 0).status).toBe('ok')
    // 只移開 5 fs（< 3σ_rw = 16.2）：分不出發散與隨機漫步
    const weak = closedLoopConsistent(fake({ g: -0.04, meanW: NaN, wEnd: -5 }), 3, 0)
    expect(weak.status).toBe('n/a')
    expect(weak.note).toContain(sigRw.toPrecision(3))
    // 從很遠的初值（w0 = −100）走回 a 附近：與預測相反
    expect(closedLoopConsistent(fake({ g: -0.04, meanW: NaN, wEnd: 2.5 }), 3, -100).status).toBe('mismatch')
    // 數值上直接發散（|w| 超過上限）也算符合預測
    expect(closedLoopConsistent(fake({ g: -0.04, meanW: NaN, wEnd: NaN, diverged: true }), 3, 0).status).toBe('ok')
    // g ≈ 0：沒有恢復力，不做定量比對
    expect(closedLoopConsistent(fake({ g: 1e-5, meanW: 1 }), 3, 0).status).toBe('n/a')
  })

  it('runFxComparison 回傳每個 Case 的 μ 與 σ_η² = E[x_ref²]/N（交叉比對的隨機漫步尺度）', () => {
    const scenario: FxScenario = {
      path: { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: OMEGA },
      code: { kind: 'sinusoid', omega: OMEGA },
      a: 3,
      w0: 0,
      sigmaV: 100,
      N: 1024,
      blocks: 40,
      seed: 5,
    }
    const res = runFxComparison({ scenario, cases: [{ id: 'A', spec: { mode: 'raw', D: 0, mu: 7, hat: HAT_EXACT } }] })
    expect(res.cases[0].mu).toBe(7)
    expect(res.cases[0].analytic.sigmaEta2).toBeCloseTo(1 / 1024, 5)
  })

  it('empiricalCorr（輕量經驗相關）：與封閉式一致（sinusoid、AR(1)），Ĥ = H 的 filtered-x 恆為 ρ = 1；與 analyzeFxLab 同一段 code', () => {
    const tonePath = { kind: 'single_tone' as const, magnitude: 1, phaseDeg: -120, omega: OMEGA }
    const tone = { kind: 'sinusoid' as const, omega: OMEGA }
    expect(empiricalCorr({ path: tonePath, code: tone, mode: 'raw', seed: 1 }).C).toBeCloseTo(-0.5, 3)
    expect(empiricalCorr({ path: tonePath, code: tone, mode: 'delayed', D: 4, seed: 1 }).rho).toBeCloseTo(1, 3)
    const t2 = { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 1 }
    const ar = { kind: 'ar1' as const, rho: 0.9 }
    const H = pathTransfer(t2)
    const exact = analyticCorr({ code: ar, h: H, g: null, D: 0 }) as number
    const emp = empiricalCorr({ path: t2, code: ar, mode: 'raw', seed: 3, samples: 1 << 17 })
    expect(Math.abs(emp.C - exact)).toBeLessThan(0.02)
    expect(empiricalCorr({ path: t2, code: ar, mode: 'filtered', seed: 3 }).rho).toBeCloseTo(1, 12)
    // 同 seed、同樣本數時與 analyzeFxLab 的經驗值一致（暫態長度可能不同 ⇒ 允許統計誤差）
    const an = analyzeFxLab({ path: t2, code: { kind: 'mash111', frac: 0.3 }, mode: 'raw', D: 0, hat: HAT_EXACT, seed: 9, Dmax: 4 })
    const light = empiricalCorr({ path: t2, code: { kind: 'mash111', frac: 0.3 }, mode: 'raw', seed: 9, samples: an.samples })
    expect(Math.abs(light.rho - an.rhoActive)).toBeLessThan(0.01)
    expect(() => empiricalCorr({ path: t2, code: ar, mode: 'delayed', D: -1, seed: 1 })).toThrow(/非負整數/)
  })

  it('一階 DSM code（dsm1）：FCW 決定 raw-x 的恢復力——寬頻 PLL（ω_nT_s = 0.25、d = 2）在 frac = 0.05 變號，MASH 1-1-1 則與 FCW 無關', () => {
    const path = { kind: 'type2_dt' as const, wnTs: 0.25, zeta: 0.7, loopDelay: 2 }
    const rho = (kind: 'dsm1' | 'mash111', frac: number) => empiricalCorr({ path, code: { kind, frac }, mode: 'raw', seed: 20261010 }).rho
    expect(rho('dsm1', 0.3)).toBeGreaterThan(0.8)
    expect(rho('dsm1', 0.05)).toBeLessThan(-0.02) // 基頻 Ω = 0.314 < 極性邊界 0.407：負票勝出
    expect(Math.abs(rho('dsm1', 0.01))).toBeLessThan(0.05) // near-integer：幾乎沒有恢復力
    expect(2 * Math.PI * 0.05).toBeLessThan(rawPolarityBoundary(path) as number)
    for (const frac of [0.3, 0.05, 0.01]) expect(rho('mash111', frac)).toBeGreaterThan(0.95)
    // 沒有封閉式：analyticCorr 回傳 null；code 序列確定（無 dither）⇒ 與 seed 無關
    expect(analyticCorr({ code: { kind: 'dsm1', frac: 0.05 }, h: pathTransfer(path), g: null, D: 0 })).toBeNull()
    const a = empiricalCorr({ path, code: { kind: 'dsm1', frac: 0.05 }, mode: 'raw', seed: 1 }).C
    const b = empiricalCorr({ path, code: { kind: 'dsm1', frac: 0.05 }, mode: 'raw', seed: 2 }).C
    expect(a).toBeCloseTo(b, 12)
    // sawtooth 的基頻在 2π·frac：code 的自相關在一個週期（1/frac = 20 samples）後回到接近 1
    const x = generateCodePattern({ pattern: codeConfig({ kind: 'dsm1', frac: 0.05 }).pattern, length: 4000, seed: 1, normalization: 'standardize' }).code
    let r20 = 0
    let r10 = 0
    for (let i = 20; i < x.length; i++) {
      r20 += x[i] * x[i - 20]
      r10 += x[i] * x[i - 10]
    }
    expect(r20 / (x.length - 20)).toBeGreaterThan(0.95)
    expect(r10 / (x.length - 20)).toBeLessThan(-0.4)
  })

  it('失穩時解釋原因（反面）：主 PLL 不穩定 ⇒ 分析丟出說明性錯誤；Ĥ 不穩定 ⇒ filtered 模式丟錯、raw 模式改用 Ĥ = H 並警告；不會出現「C ≈ 0（NaN）」', () => {
    const bad = { kind: 'type2_dt' as const, wnTs: 0.25, zeta: 0.7, loopDelay: 3 }
    expect(pathStability(bad).stable).toBe(false)
    expect(pathStability(bad).radius).toBeGreaterThan(1)
    expect(pathStability({ ...bad, loopDelay: 2 }).stable).toBe(true)
    expect(pathStability({ kind: 'identity' }).stable).toBe(true)
    const white = { kind: 'white_pm_one' as const }
    expect(() => analyzeFxLab({ path: bad, code: white, mode: 'raw', D: 0, hat: HAT_EXACT, seed: 1, Dmax: 8 })).toThrow(/主 PLL 迴路不穩定.*pole 半徑.*請降低/)
    expect(() => empiricalCorr({ path: bad, code: white, mode: 'raw', seed: 1 })).toThrow(/主 PLL 迴路不穩定/)
    // 真實迴路穩定（d = 0），但模型多算 3 拍 latency ⇒ Ĥ 的模型迴路不穩定
    const ok = { ...bad, loopDelay: 0 }
    const hatBad = { ...HAT_EXACT, loopDelayErr: 3 }
    expect(buildHat(ok, hatBad, white).stable).toBe(false)
    expect(() => analyzeFxLab({ path: ok, code: white, mode: 'filtered', D: 0, hat: hatBad, seed: 1, Dmax: 8 })).toThrow(/模型 Ĥ 不穩定.*u_f.*發散/)
    expect(() => empiricalCorr({ path: ok, code: white, mode: 'filtered', hat: hatBad, seed: 1 })).toThrow(/模型 Ĥ 不穩定/)
    const raw = analyzeFxLab({ path: ok, code: white, mode: 'raw', D: 0, hat: hatBad, seed: 1, Dmax: 8 })
    expect(raw.warnings.some((w) => w.includes('Ĥ 設定不穩定') && w.includes('Ĥ = H'))).toBe(true)
    expect(Number.isFinite(raw.corr.filtered.empirical)).toBe(true)
    expect(raw.corr.filtered.analytic as number).toBeCloseTo(raw.Eu2.analytic as number, 12)
    expect(raw.warnings.some((w) => w.includes('NaN'))).toBe(false)
    // 閉迴路端：C 非有限 ⇒ 交叉比對標 n/a，並說明原因（不是「g ≈ 0」）
    const res = runFxComparison({
      scenario: { path: bad, code: white, a: 3, w0: 0, sigmaV: 100, N: 256, blocks: 20, seed: 1 },
      cases: [{ id: 'A', spec: { mode: 'raw', D: 0, mu: 10, hat: HAT_EXACT } }],
    })
    expect(res.cases[0].warnings.some((w) => w.includes('不穩定'))).toBe(true)
    const cc = closedLoopConsistent(res.cases[0], 3, 0)
    expect(cc.status).toBe('n/a')
    expect(cc.note).toContain('pll_error_path 不穩定')
    expect(cc.note).toContain('無法比對')
    // 沒有不穩定警告、但 g 非有限時也不會被說成「g ≈ 0」
    expect(closedLoopConsistent(fake({ g: NaN, meanW: NaN }), 3, 0).note).toContain('不是有限數')
  })
})

describe('filteredX：filtered-x 的 regressor 再延遲 D（R03）', () => {
  // F-07.10 的 regressor 是 u_f[n − D]：平均相關是 C_{f,D} = E[u[n]·u_f[n − D]] = (1/2π)∫S_xx|H||Ĥ|cos(∠H − ∠Ĥ + ΩD)dΩ（F-07.12），
  // 不是 E[u·u_f]。Ĥ = H 時 C_{f,D} = R_u[D]，只有 D = 0 才保證是 E[u²] ≥ 0。
  const ID = { b: [1], a: [1] }
  const QUARTER = { kind: 'sinusoid' as const, omega: Math.PI / 2 }
  const T07_PATH = { kind: 'single_tone' as const, magnitude: 1, phaseDeg: -120, omega: OMEGA }
  const T07_CODE = { kind: 'sinusoid' as const, omega: OMEGA }
  const TYPE2 = { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 1 }
  const WHITE = { kind: 'white_pm_one' as const }

  it('反例：H = Ĥ = 1、x = cos(πn/2)、D = 2 ⇒ u_f[n − 2] = −u[n]，C_{f,2} = −1/2（沒有 D 的式子會給 +1/2）', () => {
    const c = (D: number) => multiToneCorrFiltered({ tones: [{ A: 1, omega: Math.PI / 2 }], h: ID, hHat: ID, D })
    expect(c(0)).toBeCloseTo(0.5, 12)
    expect(c(1)).toBeCloseTo(0, 12)
    expect(c(2)).toBeCloseTo(-0.5, 12)
    expect(c(4)).toBeCloseTo(0.5, 12)
    // 時域直接平均（一個週期 1, 0, −1, 0；不經過任何公式）
    const x = Float64Array.from({ length: 64 }, (_, n) => Math.cos((Math.PI * n) / 2))
    const uf2 = regressorFiltered(x, ID, 2)
    let s = 0
    for (let n = 8; n < 64; n++) s += x[n] * uf2[n]
    expect(s / 56).toBeCloseTo(-0.5, 12)
    // Lab 的 unit-power code（A = √2）：+1 與 −1
    expect(analyticCorr({ code: QUARTER, h: ID, g: ID, D: 0 })).toBeCloseTo(1, 12)
    expect(analyticCorr({ code: QUARTER, h: ID, g: ID, D: 2 })).toBeCloseTo(-1, 12)
  })

  it('Lab 分析：Ĥ = H、D = 2 ⇒ ρ = −1，警告說明原因是 D（F-07.12），不再歸咎於「Ĥ 與 H 的相位差」；正常對照（D = 0）沒有警告', () => {
    const an = analyzeFxLab({ path: { kind: 'identity' }, code: QUARTER, mode: 'filtered', D: 2, hat: HAT_EXACT, seed: 1, Dmax: 8 })
    expect(an.corr.filtered.analytic).toBeCloseTo(-1, 12)
    expect(Math.abs(an.corr.filtered.empirical + 1)).toBeLessThan(1e-9)
    expect(an.Eu2.analytic).toBeCloseTo(1, 12)
    expect(an.rhoActive).toBeCloseTo(-1, 9)
    expect(an.hat.exact).toBe(true)
    expect(Math.abs(an.tone?.thetaDeg as number)).toBeCloseTo(180, 9)
    expect(an.warnings).toHaveLength(2)
    expect(an.warnings[0].startsWith('C ≤ 0：E[u[n]·u_f[n−D]] = -1.000 < 0（D = 2）')).toBe(true)
    expect(an.warnings[0].endsWith('（F-07.12）')).toBe(true)
    expect(an.warnings[1]).toBe('D = 2 ≠ 0：有效相關是 E[u[n]·u_f[n−D]] = -1.000，不是 E[u²] = 1.000（F-07.12）')
    expect(an.warnings.some((w) => w.includes('Ĥ 與 H 在激勵頻帶的相位差超過 90°（E45）'))).toBe(false)
    // 正常對照：T07 的單頻、Ĥ = H、D = 0 ⇒ C = E[u²] = 1、ρ = 1、沒有任何警告
    const ok = analyzeFxLab({ path: T07_PATH, code: T07_CODE, mode: 'filtered', D: 0, hat: HAT_EXACT, seed: 1, Dmax: 8 })
    expect(ok.corr.filtered.analytic).toBeCloseTo(1, 12)
    expect(ok.corr.filtered.analytic as number).toBeCloseTo(ok.Eu2.analytic as number, 12)
    expect(ok.rhoActive).toBeCloseTo(1, 9)
    expect(ok.warnings).toEqual([])
  })

  it('D 只讓相關變小（還是正的）也要提醒；Ĥ ≠ H 與 D ≠ 0 同時存在時兩個原因都寫出來', () => {
    // Type-II（ω_nT_s = 0.1、ζ = 0.7、d = 1）、白色 ±1 code、Ĥ = H、D = 1：C 從 1.1402 掉到 0.1280（ρ = 0.112），沒有變號
    const t2 = analyzeFxLab({ path: TYPE2, code: WHITE, mode: 'filtered', D: 1, hat: HAT_EXACT, seed: 3, Dmax: 8 })
    expect(t2.corr.filtered.analytic as number).toBeCloseTo(0.1279517584, 9)
    expect(t2.warnings).toEqual(['D = 1 ≠ 0：有效相關是 E[u[n]·u_f[n−D]] = 0.1280，不是 E[u²] = 1.140（F-07.12）'])
    // T07 的單頻：Ĥ = H·z⁻²、D = 2 ⇒ 殘餘相位 30°·(2 + 2) = 120°，C = −0.5
    const both = analyzeFxLab({ path: T07_PATH, code: T07_CODE, mode: 'filtered', D: 2, hat: { ...HAT_EXACT, extraDelay: 2 }, seed: 1, Dmax: 8 })
    expect(both.corr.filtered.analytic).toBeCloseTo(-0.5, 12)
    const note = both.warnings.filter((w) => w.startsWith('Ĥ ≠ H、D = 2 ≠ 0：'))
    expect(note).toHaveLength(1)
    expect(note[0].endsWith('（E45）')).toBe(true)
    // D = 0 的兩句訊息維持原樣（diagText.test.tsx 也釘住這兩句）
    const d0 = analyzeFxLab({ path: T07_PATH, code: T07_CODE, mode: 'filtered', D: 0, hat: { ...HAT_EXACT, extraDelay: 4 }, seed: 3, Dmax: 12 }).warnings
    expect(d0).toEqual([
      'C ≤ 0：E[u·u_f] = -0.5000 < 0，Ĥ 與 H 在激勵頻帶的相位差超過 90°（E45）：filtered-x 一樣會反向更新',
      'Ĥ ≠ H：有效相關是 E[u·u_f] = -0.5000，不是 E[u²] = 1.000（E45）',
    ])
  })

  it('延遲 regressor D 個 sample = 把模型換成 Ĥ·z⁻ᴰ：T07 的單頻兩者都是 cos(30°·k)（§7.5 的 Δ 表與 D 逐列相同）', () => {
    const H = pathTransfer(T07_PATH)
    for (let k = 0; k <= 6; k++) {
      const viaD = analyticCorr({ code: T07_CODE, h: H, g: buildHat(T07_PATH, HAT_EXACT, T07_CODE).full, D: k }) as number
      const viaModel = analyticCorr({ code: T07_CODE, h: H, g: buildHat(T07_PATH, { ...HAT_EXACT, extraDelay: k }, T07_CODE).full, D: 0 }) as number
      expect(viaD).toBeCloseTo(Math.cos((k * 30 * Math.PI) / 180), 12)
      expect(viaModel).toBeCloseTo(viaD, 12)
    }
    // 章內文字引用的三個值：D = 2、3、4 ⇒ 0.5、0、−0.5
    const c = (D: number) => analyticCorr({ code: T07_CODE, h: H, g: H, D }) as number
    expect([c(2), c(3), c(4)].map((v) => Number(v.toFixed(4)))).toEqual([0.5, 0, -0.5])
  })

  it('閉迴路：同一個 seed，Ĥ = H 的 filtered-x 在 D = 0 收斂、D = 2 被推離真值（p = 1 ∓ μK_q）', () => {
    const res = runFxComparison({
      scenario: { path: { kind: 'identity' }, code: QUARTER, a: 100, w0: 80, sigmaV: 100, N: 256, blocks: 600, seed: 7 },
      cases: [
        { id: 'A', spec: { mode: 'filtered', D: 0, mu: 10, hat: HAT_EXACT } },
        { id: 'B', spec: { mode: 'filtered', D: 2, mu: 10, hat: HAT_EXACT } },
      ],
    })
    const [A, B] = res.cases
    const g = (10 * Math.sqrt(2 / Math.PI)) / 100 // μK_q·|C|，|C| = 1
    expect(A.analytic.Cest).toBeCloseTo(1, 9)
    expect(A.analytic.p).toBeCloseTo(1 - g, 9) // 0.920212
    expect(A.analytic.p).toBeCloseTo(0.920212, 6)
    expect(Math.abs(A.metrics.meanW - 100)).toBeLessThan(2)
    expect(closedLoopConsistent(A, 100, 80).status).toBe('ok')
    expect(B.analytic.Cest).toBeCloseTo(-1, 9)
    expect(B.analytic.p).toBeCloseTo(1 + g, 9) // 1.079788：沒有 D 的公式會預測 0.920212
    expect(B.analytic.p).toBeCloseTo(1.079788, 6)
    expect(Math.abs(B.metrics.wEnd - 100)).toBeGreaterThan(1000)
    const cc = closedLoopConsistent(B, 100, 80)
    expect(cc.status).toBe('ok')
    expect(cc.note.startsWith('預測發散')).toBe(true)
  })

  it('寬頻 code：Type-II（d = 1）、白色 ±1、Ĥ = H ⇒ C_{f,D} = R_u[D] = 1.14016／0.12795／−0.03737（ρ = 1／0.1122／−0.0328），時域雙重和 = 頻域積分', () => {
    const H = pathTransfer(TYPE2)
    const c = (D: number) => analyticCorr({ code: WHITE, h: H, g: H, D }) as number
    expect(c(0)).toBeCloseTo(1.1401641836, 9)
    expect(c(1)).toBeCloseTo(0.1279517584, 9)
    expect(c(2)).toBeCloseTo(-0.0373720482, 9)
    expect(c(1) / c(0)).toBeCloseTo(0.11222, 4)
    expect(c(2) / c(0)).toBeCloseTo(-0.03278, 4)
    // |R_u[D]| ≤ R_u[0] = E[u²]（Cauchy–Schwarz）
    for (let D = 1; D <= 16; D++) expect(Math.abs(c(D))).toBeLessThan(c(0))
    // 頻域：(1/2π)∫S_xx·Re{H·Ĥ*·e^{+jΩD}}dΩ（F-07.12 的 +ΩD）
    for (const D of [0, 1, 2]) {
      const split = crossIntegralSplit({ code: WHITE, h: H, g: H, D }) as { pos: number; neg: number; total: number }
      expect(Math.abs(split.total - c(D))).toBeLessThan(1e-9)
    }
  })

  it('D 補得回、補不回的延遲：串在路徑上的純延遲 z⁻² 用 D = 2 補回；模型漏算的 loop latency（在迴路內部）在這組參數的白色與低通 AR(1) code 下，用 D 只會更差', () => {
    // (1) 串聯純延遲：H = z⁻²、Ĥ = 1 ⇒ D = 2 時 regressor 與 u 完全相同，C = E[u²] = 1
    const hs = { b: [0, 0, 1], a: [1] }
    const corr = (code: Parameters<typeof analyticCorr>[0]['code'], D: number) => analyticCorr({ code, h: hs, g: ID, D }) as number
    expect(corr(WHITE, 0)).toBeCloseTo(0, 12)
    expect(corr(WHITE, 2)).toBeCloseTo(1, 12)
    expect(corr(QUARTER, 0)).toBeCloseTo(-1, 12)
    expect(corr(QUARTER, 2)).toBeCloseTo(1, 12)
    expect(corr({ kind: 'ar1', rho: 0.6 }, 0)).toBeCloseTo(0.36, 12)
    expect(corr({ kind: 'ar1', rho: 0.6 }, 2)).toBeCloseTo(1, 12)
    // (2) 漏算 loop latency：真實 d = 1、模型 d̂ = 0。H(d) 不是 Ĥ(d̂)·z⁻ᴸ，D = 1、2 的 ρ 一路變小（Lab 的 Δd 提示）
    const H = pathTransfer(TYPE2)
    const hat = buildHat(TYPE2, { ...HAT_EXACT, loopDelayErr: -1 }, WHITE)
    expect(hat.exact).toBe(false)
    const rho = (code: Parameters<typeof analyticCorr>[0]['code'], D: number) =>
      (analyticCorr({ code, h: H, g: hat.full, D }) as number) /
      Math.sqrt((analyticCorr({ code, h: H, g: H, D: 0 }) as number) * (analyticCorr({ code, h: hat.full, g: hat.full, D: 0 }) as number))
    const white = [0, 1, 2].map((D) => rho(WHITE, D))
    expect(white[0]).toBeCloseTo(0.98771, 5)
    expect(white[1]).toBeCloseTo(0.11271, 5)
    expect(white[2]).toBeCloseTo(-0.03011, 5)
    const lp = [0, 1, 2].map((D) => rho({ kind: 'ar1', rho: 0.98 }, D))
    expect(lp[0]).toBeCloseTo(0.99448, 5)
    expect(lp[1]).toBeCloseTo(0.87261, 5)
    expect(lp[2]).toBeCloseTo(0.72074, 5)
    for (const r of [white, lp]) {
      expect(r[1]).toBeLessThan(r[0])
      expect(r[2]).toBeLessThan(r[1])
    }
  })

  it('Lab 的 Δd 提示：漏算 loop latency 時，白色 code 下任何 D > 0 都比 D = 0 差；單頻 code 則和 delayed-x 一樣可以用 D 轉回那個頻率的相位（所以提示不能寫成「一律補不回」）', () => {
    // 漏算的 loop latency 不是串聯純延遲：h[0] = ĥ[0] = 1，H = Ĥ·z⁻ᴸ 只可能是 L = 0、Ĥ = H
    const TONE1 = { kind: 'sinusoid' as const, omega: 1 }
    // (a) 白色 ±1 code：C(D) = Σ_l h[l + D]·ĥ[l]。掃 ω_nT_s、ζ、d 與每一種漏算量，D = 1…32 都小於 D = 0
    let cases = 0
    for (const wnTs of [0.05, 0.1, 0.2, 0.3]) {
      for (const zeta of [0.5, 0.7, 1, 1.5]) {
        for (const loopDelay of [1, 2, 3]) {
          const path = { kind: 'type2_dt' as const, wnTs, zeta, loopDelay }
          if (!(pathStability(path).radius < 0.999)) continue
          const H = pathTransfer(path)
          expect(H.b[0] / H.a[0]).toBe(1)
          for (let err = -loopDelay; err <= -1; err++) {
            const hat = buildHat(path, { ...HAT_EXACT, loopDelayErr: err }, WHITE)
            expect(hat.exact).toBe(false)
            expect(hat.full.b[0] / hat.full.a[0]).toBe(1)
            const c = (D: number) => analyticCorr({ code: WHITE, h: H, g: hat.full, D }) as number
            const c0 = c(0)
            expect(c0).toBeGreaterThan(0)
            for (let D = 1; D <= 32; D++) expect(c(D), `${wnTs}/${zeta}/${loopDelay}/${err}/D=${D}`).toBeLessThan(c0)
            cases++
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(60)
    // (b) 單頻反例：ω_nT_s = 0.25、ζ = 0.7、d = 2、模型 d̂ = 0、Ω = 1 rad/sample——D = 1 就把 ρ 從 0.688 拉回 0.983，D = 7 是 0.995
    const path = { kind: 'type2_dt' as const, wnTs: 0.25, zeta: 0.7, loopDelay: 2 }
    const H = pathTransfer(path)
    const hat = buildHat(path, { ...HAT_EXACT, loopDelayErr: -2 }, TONE1)
    const rho = (D: number) =>
      (analyticCorr({ code: TONE1, h: H, g: hat.full, D }) as number) /
      Math.sqrt((analyticCorr({ code: TONE1, h: H, g: H, D: 0 }) as number) * (analyticCorr({ code: TONE1, h: hat.full, g: hat.full, D: 0 }) as number))
    expect(rho(0)).toBeCloseTo(0.68757, 5)
    expect(rho(1)).toBeCloseTo(0.9825, 5)
    expect(rho(7)).toBeCloseTo(0.99541, 5)
    // 單頻的 ρ 就是 cos(殘餘相位)：D 每加 1，相位加 Ω = 1 rad
    const th0 = Math.acos(rho(0))
    expect(Math.min(Math.abs(Math.cos(th0 + 1) - rho(1)), Math.abs(Math.cos(-th0 + 1) - rho(1)))).toBeLessThan(1e-9)
  })
})

describe('filteredX：F-07.1 的等號只在 w 凍結時成立——用真正的閉迴路核心 runBlockLms 驗證（R06b）', () => {
  // Ch07 §7.4 與 Lab 的假設欄寫「本站的閉迴路模擬照真實電路的順序計算（先乘 (a − w_k)，再進狀態跨 block 保留的濾波器），不用這個近似」。
  // 這裡把章內「兩拍的反例」原封不動送進 runBlockLms：h = [1, −1]、x ≡ 1、a = 1、N = 1、μ = 1、無雜訊（sign(0) = +1）。
  const TWO_TAP = {
    seed: 1,
    gm_accum_samples: 1,
    num_blocks: 6,
    gain_initial: 0,
    gain_true: 1,
    gain_step: 1,
    code_normalization: 'none' as const,
    pd_noise_rms_fs: 0,
    pll_error_path: { kind: 'fir' as const, parameters: { taps: [1, -1] } },
    seeded_pattern: { kind: 'sinusoid' as const, parameters: { amplitude: 1, omega: 0, phase_deg: 0 } },
    record: { sample_trace_blocks: 6, decimate: 1 },
  }
  /** e[n] − (a − w_{k(n)})·u[n]：F-07.1 的寫法（先濾後乘）和核心實際算出的 PD 誤差差多少 */
  const residual = (res: ReturnType<typeof runBlockLms>, a: number, N: number): number[] => {
    const t = res.trace as NonNullable<typeof res.trace>
    return Array.from(t.e, (e, n) => e - (a - res.blocks.w[Math.floor(n / N)]) * t.u[n])
  }

  it('反例：w 每拍都在跳（0、1、0、1…）時 e[n] ≠ (a − w[n])·u[n]——核心算的是先乘後濾，殘差從第二拍起是 ∓1', () => {
    const res = runBlockLms(TWO_TAP)
    const t = res.trace as NonNullable<typeof res.trace>
    // 手算：e[0] = (1 − 0)·1 = 1 ⇒ q = +1 ⇒ w = 1；e[1] = (1 − 1)·1 − (1 − 0)·1 = −1 ⇒ w = 0；e[2] = (1 − 0)·1 − (1 − 1)·1 = +1 ⇒ w = 1；…
    expect(Array.from(res.blocks.w)).toEqual([0, 1, 0, 1, 0, 1, 0])
    expect(Array.from(t.x)).toEqual([1, 1, 1, 1, 1, 1])
    expect(Array.from(t.e)).toEqual([1, -1, 1, -1, 1, -1])
    // u = h * x = x[n] − x[n − 1]：只有第一拍（濾波器初始狀態 0）是 1，之後恆為 0 ⇒ 「先濾後乘」的 (a − w)·u 從第二拍起是 0
    expect(Array.from(t.u)).toEqual([1, 0, 0, 0, 0, 0])
    expect(residual(res, 1, 1)).toEqual([0, -1, 1, -1, 1, -1])
  })

  it('對照（正常情況）：w 凍結（μ = 0）時兩種寫法逐點相同——2-tap 路徑殘差恰為 0，Type-II 路徑 < 1e−12', () => {
    const frozen = runBlockLms({ ...TWO_TAP, gain_step: 0 })
    expect(Array.from(frozen.blocks.w)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(Array.from((frozen.trace as NonNullable<typeof frozen.trace>).e)).toEqual([1, 0, 0, 0, 0, 0])
    expect(residual(frozen, 1, 1)).toEqual([0, 0, 0, 0, 0, 0])
    // 有記憶的 IIR 路徑（ω_nT_s = 0.05、ζ = 0.7 的 Type-II）、單頻 code、w 固定在 1.25（a = 3）：e = (a − w)·u 到捨入誤差
    const type2 = runBlockLms({
      ...TWO_TAP,
      gain_initial: 1.25,
      gain_true: 3,
      gain_step: 0,
      gm_accum_samples: 64,
      num_blocks: 8,
      pll_error_path: { kind: 'type2_dt', parameters: { wn_ts: 0.05, zeta: 0.7 } },
      seeded_pattern: { kind: 'sinusoid', parameters: { amplitude: 1, omega: Math.PI / 6, phase_deg: 0 } },
      record: { sample_trace_blocks: 8, decimate: 1 },
    })
    expect(Array.from(type2.blocks.w).every((w) => w === 1.25)).toBe(true)
    const r = residual(type2, 3, 64)
    expect(r).toHaveLength(8 * 64)
    expect(Math.max(...r.map(Math.abs))).toBeLessThan(1e-12)
    // 不是因為訊號本身是 0 才過關：e 的振幅是 (a − w)·|u| 的量級
    expect(Math.max(...Array.from((type2.trace as NonNullable<typeof type2.trace>).e, Math.abs))).toBeGreaterThan(1)
  })
})

describe('filteredX：regressor 的延遲 D 是前饋——改的是相關 C_{f,D}，不是 g 的穩定上限（§7.10 的敘述）', () => {
  // Type-II（ω_nT_s = 0.1、ζ = 0.7、d = 1）、白色 ±1、Ĥ = H：C_{f,0} = 1.14016、C_{f,1} = 0.12795（上面 R03 的測試）。
  // 把兩個 Case 的 μ 調成同一個 g = μK_qC_{f,D}：平均模型的 pole 一樣、穩定與否一樣；D = 1 只是 ρ 小（0.112），同樣的 g 下 w 的抖動大約 1/ρ 倍。
  const path = { kind: 'type2_dt' as const, wnTs: 0.1, zeta: 0.7, loopDelay: 1 }
  const code = { kind: 'white_pm_one' as const }
  const H = pathTransfer(path)
  const Kq = Math.sqrt(2 / Math.PI) / 100
  const C0 = analyticCorr({ code, h: H, g: H, D: 0 }) as number
  const C1 = analyticCorr({ code, h: H, g: H, D: 1 }) as number
  const run = (g: number) =>
    runFxComparison({
      scenario: { path, code, a: 100, w0: 99, sigmaV: 100, N: 16384, blocks: 120, seed: 11 },
      cases: [
        { id: 'A', spec: { mode: 'filtered', D: 0, mu: g / (Kq * C0), hat: HAT_EXACT } },
        { id: 'B', spec: { mode: 'filtered', D: 1, mu: g / (Kq * C1), hat: HAT_EXACT } },
      ],
    }).cases

  it('g = 1.5（< 2）：D = 0 與 D = 1 都預測穩定、pole 都是 −0.5，模擬的 std(w) 與各自的預測相符；D = 1 的 μ 是 C_{f,0}/C_{f,1} ≈ 8.9 倍', () => {
    expect(C0 / C1).toBeCloseTo(8.911, 2)
    const [A, B] = run(1.5)
    expect(B.mu / A.mu).toBeCloseTo(C0 / C1, 9)
    for (const c of [A, B]) {
      expect(c.analytic.stableMean, c.id).toBe(true)
      expect(c.analytic.g, c.id).toBeGreaterThan(1.45)
      expect(c.analytic.g, c.id).toBeLessThan(1.55)
      expect(c.analytic.p, c.id).toBeCloseTo(-0.5, 1)
      expect(c.metrics.diverged, c.id).toBe(false)
      // 實測 std(w)／預測：A 1.10、B 0.92
      expect(c.metrics.stdW / c.analytic.sigmaWPred, c.id).toBeGreaterThan(0.7)
      expect(c.metrics.stdW / c.analytic.sigmaWPred, c.id).toBeLessThan(1.4)
      expect(Math.abs(c.metrics.meanW - 100), c.id).toBeLessThan(2)
    }
    // 同一個 g：D = 1 的抖動大（ρ 小），但沒有因為 D 而失穩
    expect(B.metrics.stdW / A.metrics.stdW).toBeGreaterThan(5)
    expect(B.metrics.stdW / A.metrics.stdW).toBeLessThan(12)
  })

  it('g = 2.3（> 2）：D = 0 與 D = 1 同樣超出穩定上限（「g ≥ 2」的警告兩個都有），w 變成大振幅振盪——上限是 g 的，和 D 無關', () => {
    const stable = run(1.5)
    const unstable = run(2.3)
    unstable.forEach((c, i) => {
      expect(c.analytic.stableMean, c.id).toBe(false)
      expect(c.analytic.p, c.id).toBeLessThan(-1)
      expect(c.warnings.some((w) => w.startsWith('g ≥ 2：一階模型不穩定')), c.id).toBe(true)
      // 實測：A 74.8 fs（g = 1.5 時 1.75 fs）、B 45.2 fs（g = 1.5 時 12.9 fs）
      expect(c.metrics.stdW, c.id).toBeGreaterThan(3 * stable[i].metrics.stdW)
    })
    stable.forEach((c) => expect(c.warnings.some((w) => w.startsWith('g ≥ 2')), c.id).toBe(false))
  })
})

describe('filteredX：Lab 的 Δd 提示——低通的有色 code 下，小的 D 偶爾讓相關多幾個百分點，一樣補不回', () => {
  it('AR(1) ρ_x = 0.9、Type-II（ω_nT_s = 0.2、ζ = 0.7、d = 3）、模型漏算 1 拍：ρ 由 0.4806（D = 0）升到 0.5169（D = 1），之後下降；離 1 很遠', () => {
    const path = { kind: 'type2_dt' as const, wnTs: 0.2, zeta: 0.7, loopDelay: 3 }
    const code = { kind: 'ar1' as const, rho: 0.9 }
    const H = pathTransfer(path)
    const hat = buildHat(path, { ...HAT_EXACT, loopDelayErr: -1 }, code)
    expect(hat.exact).toBe(false)
    const norm = Math.sqrt((analyticCorr({ code, h: H, g: H, D: 0 }) as number) * (analyticCorr({ code, h: hat.full, g: hat.full, D: 0 }) as number))
    const rho = (D: number) => (analyticCorr({ code, h: H, g: hat.full, D }) as number) / norm
    expect(rho(0)).toBeCloseTo(0.4806, 4)
    expect(rho(1)).toBeCloseTo(0.5169, 4)
    expect(rho(1) / rho(0) - 1).toBeGreaterThan(0.05)
    expect(rho(1) / rho(0) - 1).toBeLessThan(0.1)
    // D = 1 就是最好的；再大只會更差，而且始終離 ρ = 1 很遠（補不回）
    for (let D = 2; D <= 32; D++) expect(rho(D), `D=${D}`).toBeLessThan(rho(1))
    expect(rho(1)).toBeLessThan(0.6)
  })
})
