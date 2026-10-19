import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cAbs, cAdd, cScale, cSub, c, eigvals, polyRoots } from '@/simulation/core'
import { polarityMarginDeg } from '@/simulation/models/pll'
import { runBlockLmsMonteCarlo } from '@/simulation/models/blockLms'
import { settleDelayed } from '@/pages/dashboard/thesisModel'
import {
  analyzeDualLoop,
  analyzeGeneral,
  buildSignLmsMcConfig,
  calLoopGain,
  calLoopGainGeneral,
  calLoopResponse,
  combinedMatrix,
  compareMcToLinear,
  comparatorKq,
  delayBoundTable,
  delayCharPoly,
  delayCriticalGain,
  delayCriticalGainNumeric,
  delayCriticalOmega,
  delayLoopCrossCheck,
  delayStable,
  dualLoopCharPoly,
  dualLoopFullMuRange,
  dualLoopGainMargin,
  dualLoopMatrix,
  dualLoopRootLocus,
  dualLoopSimplifiedMuRange,
  logOmegaGrid,
  loopMargins,
  loopResponse,
  observationTransfer,
  peakAbs,
  pmFirstOrder,
  pmWithDelay,
  polarityMarginArcsin,
  polarityMarginMod180Bug,
  polarityMarginWrap,
  simulateDelayRecursion,
  simulateFullModel,
  settleFromPoles,
  SETTLE_FROM_POLES_MAX_STEPS,
  delayModalBound,
  delayModalValue,
  delayModes,
  simulateGeneral,
  simulateQuasiStatic,
  stableIntervalsNumeric,
  unwrapDeg,
  wrap180Spec,
  type ObservationSystem,
} from './stability'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
}
const golden = (id: string): Vector => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))
const within = (actual: number, expected: number, tol: { abs?: number; rel?: number }) =>
  Math.abs(actual - expected) <= (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)

// ───────────────────────── §8.1 Polarity margin（E20） ─────────────────────────

describe('stability：§8.1 polarity margin（勘誤 E20）', () => {
  it('wrap_180 的值域是 [−180°, 180°)，週期 360°', () => {
    expect(wrap180Spec(180)).toBe(-180)
    expect(wrap180Spec(-180)).toBe(-180)
    expect(wrap180Spec(190)).toBeCloseTo(-170, 12)
    expect(wrap180Spec(-190)).toBeCloseTo(170, 12)
    expect(wrap180Spec(725)).toBeCloseTo(5, 12)
    for (let t = -1000; t <= 1000; t += 7.3) {
      const w = wrap180Spec(t)
      expect(w).toBeGreaterThanOrEqual(-180)
      expect(w).toBeLessThan(180)
    }
  })

  it('反面測試：θ = 200° → M = −70°、θ = −150° → M = −60°；mod-180 錯誤實作會得到 +70° / +60°', () => {
    expect(polarityMarginWrap(200)).toBeCloseTo(-70, 12)
    expect(polarityMarginArcsin(200)).toBeCloseTo(-70, 12)
    expect(polarityMarginWrap(-150)).toBeCloseTo(-60, 12)
    expect(polarityMarginArcsin(-150)).toBeCloseTo(-60, 12)
    expect(polarityMarginMod180Bug(200)).toBeCloseTo(70, 12)
    expect(polarityMarginMod180Bug(-150)).toBeCloseTo(60, 12)
    // 錯誤實作把「極性錯誤、平均發散」顯示成正的 margin
    expect(Math.sign(polarityMarginMod180Bug(-150))).not.toBe(Math.sign(Math.cos((-150 * Math.PI) / 180)))
  })

  it('arcsin(cos θ) 與正確 wrap 公式在大量角度上一致（≤ 1e-12），也與 pll.polarityMarginDeg 一致', () => {
    let maxDiff = 0
    for (let i = 0; i < 20000; i++) {
      const t = -720 + (1440 * i) / 19999 + 0.123
      maxDiff = Math.max(maxDiff, Math.abs(polarityMarginWrap(t) - polarityMarginArcsin(t)))
      maxDiff = Math.max(maxDiff, Math.abs(polarityMarginDeg(t) - polarityMarginArcsin(t)))
    }
    expect(maxDiff).toBeLessThan(1e-9)
    expect(polarityMarginArcsin(90)).toBeCloseTo(0, 12)
    expect(polarityMarginArcsin(180)).toBeCloseTo(-90, 12)
    expect(polarityMarginArcsin(0)).toBeCloseTo(90, 12)
  })
})

// ───────────────────────── §8.2 一階 loop（T08） ─────────────────────────

describe('stability：§8.2 L_cal(z) = g/(z − 1)', () => {
  it('T08: g = 1 ⇒ pole 0、PM 60°、ω_c = π/3（golden vector）', () => {
    const v = golden('T08')
    const tol = v.tolerance
    const r = pmFirstOrder(v.inputs.g as number)
    expect(within(r.pole, v.expected.pole as number, tol)).toBe(true)
    expect(within(r.pmDeg, v.expected.pm_deg as number, tol)).toBe(true)
    expect(within(r.omegaC, v.expected.crossover_omega_rad as number, tol)).toBe(true)
    expect(r.stable).toBe(true)
    const gs = v.inputs.g_list as number[]
    const poles = v.expected.pole_list as number[]
    const pms = v.expected.pm_deg_list as number[]
    gs.forEach((g, i) => {
      const row = pmFirstOrder(g)
      expect(within(row.pole, poles[i], tol)).toBe(true)
      expect(within(row.pmDeg, pms[i], tol)).toBe(true)
    })
  })

  it('T08: PM 封閉式與數值 crossover（二分法 + 展開相位）一致', () => {
    for (const g of [0.05, 0.2, 0.5, 1, 1.5, 1.8, 1.99]) {
      const m = loopMargins((w) => calLoopGain(g, 0, w))
      const cf = pmFirstOrder(g)
      expect(m.crossovers).toHaveLength(1)
      expect(m.omegaC).toBeCloseTo(cf.omegaC, 10)
      expect(m.pmDeg).toBeCloseTo(cf.pmDeg, 8)
      // d = 0：唯一的 phase crossover 在 ω = π，|L| = g/2 ⇒ GM = 2/g
      expect(m.gmDb).toBeCloseTo(cf.gmDb, 8)
    }
  })

  it('很小的 g：ω_min 低於 crossover 時數值 PM 仍與封閉式一致（ω_c ≈ g）', () => {
    const g = 1e-5
    const m = loopMargins((w) => calLoopGain(g, 2, w), { omegaMin: g / 100 })
    expect(m.omegaC).toBeCloseTo(pmWithDelay(g, 2).omegaC, 12)
    expect(m.pmDeg).toBeCloseTo(pmWithDelay(g, 2).pmDeg, 6)
    // 起點太高（1e-4 > ω_c）時找不到 crossover：呼叫端必須調整 omegaMin
    expect(loopMargins((w) => calLoopGain(g, 2, w)).crossovers).toHaveLength(0)
  })

  it('d = 0 的 Nyquist 曲線是直線 Re L = −g/2；|L| = g/(2 sin(ω/2))', () => {
    const g = 0.7
    const resp = calLoopResponse(g, 0, logOmegaGrid(200, 1e-3, Math.PI))
    for (let i = 0; i < resp.omega.length; i++) {
      expect(resp.re[i]).toBeCloseTo(-g / 2, 10)
      expect(resp.mag[i]).toBeCloseTo(g / (2 * Math.sin(resp.omega[i] / 2)), 9)
      // 展開相位 = −90° − ω/2
      expect(resp.phaseDeg[i]).toBeCloseTo(-90 - (resp.omega[i] * 90) / Math.PI, 8)
    }
  })

  it('pmWithDelay(g, 0) 與 pmFirstOrder(g) 逐位相同', () => {
    for (const g of [0.01, 0.2, 0.5, 1, 1.5, 1.99, 2]) {
      const a = pmFirstOrder(g)
      const b = pmWithDelay(g, 0)
      expect(b.omegaC).toBe(a.omegaC)
      expect(b.pmDeg).toBe(a.pmDeg)
      expect(b.gmDb).toBeCloseTo(a.gmDb, 14)
      expect(b.delayMarginBlocks).toBe(a.delayMarginBlocks)
    }
  })

  it('delay margin：g = 1 剛好容忍 1 block；g = 1.5 只有 0.426 block', () => {
    expect(pmFirstOrder(1).delayMarginBlocks).toBeCloseTo(1, 12)
    expect(pmFirstOrder(1.5).delayMarginBlocks).toBeCloseTo(0.4261092824, 9)
    expect(pmFirstOrder(1.5).pmDeg).toBeCloseTo(41.409622109270856, 10)
  })

  it('反面測試：極性反轉（g < 0）、g = 2 臨界、g > 2 沒有 crossover', () => {
    const neg = golden('negative_tests')
    const muK = (neg.inputs.mu_fs as number) * (neg.inputs.kq_per_fs as number)
    const rev = pmFirstOrder(-muK)
    expect(rev.pole).toBeCloseTo(neg.expected.reversed_polarity_pole as number, 12)
    expect(rev.stable).toBe(false)
    expect(rev.pmDeg).toBeNaN()
    const crit = pmFirstOrder(2)
    expect(crit.marginal).toBe(true)
    expect(crit.stable).toBe(false)
    expect(crit.pmDeg).toBeCloseTo(0, 12)
    const big = pmFirstOrder(2.2)
    expect(big.stable).toBe(false)
    expect(big.omegaC).toBeNaN()
    expect(loopMargins((w) => calLoopGain(2.2, 0, w)).crossovers).toHaveLength(0)
  })

  it('時域：g = 0.5 ⇒ δ_k = 0.5^k；g = 1.5 ⇒ 1, −0.5, 0.25；g = 2.2 發散', () => {
    const a = simulateDelayRecursion(0.5, 0, 10).delta
    for (let k = 0; k <= 10; k++) expect(a[k]).toBeCloseTo(0.5 ** k, 14)
    const b = simulateDelayRecursion(1.5, 0, 3).delta
    expect(Array.from(b)).toEqual([1, -0.5, 0.25, -0.125])
    const run = simulateDelayRecursion(2.2, 0, 400)
    expect(run.divergedAt).not.toBeNull()
  })

  it('T08: 硬體單位換算——σ_v = 100 fs、μ = 10 fs ⇒ g = μK_q = 0.0797885、pole 0.92021（golden T13）；μ 上界 250.66 / 125.33 / 77.46 fs（d = 0, 1, 2）', () => {
    const t13 = golden('T13')
    const kq = comparatorKq(t13.inputs.sigma_v_fs as number)
    expect(within(kq, t13.expected.K_per_fs as number, t13.tolerance)).toBe(true)
    const g = (t13.inputs.mu_fs as number) * kq * (t13.inputs.C as number)
    expect(within(g, t13.expected.g as number, t13.tolerance)).toBe(true)
    const r = pmFirstOrder(g)
    expect(within(r.pole, t13.expected.p as number, t13.tolerance)).toBe(true)
    expect(r.pmDeg).toBeCloseTo(87.7136, 4)
    expect(r.delayMarginBlocks).toBeGreaterThan(19)
    expect(r.delayMarginBlocks).toBeLessThan(20)
    // 入門課 Lesson 4：0 < α < 250.66 fs；一個 block 延遲 ⇒ 減半；d = 2 ⇒ 0.618 倍
    expect(delayCriticalGain(0) / kq).toBeCloseTo(250.6628, 4)
    expect(delayCriticalGain(1) / kq).toBeCloseTo(125.3314, 4)
    expect(delayCriticalGain(2) / kq).toBeCloseTo(77.4591, 4)
    // 入門課 Lesson 10：α = 11.20 fs ⇒ PM ≈ 87.4°
    expect(pmFirstOrder(11.2 * kq).pmDeg).toBeCloseTo(87.44, 2)
    // DM 的整數部分 = 還能容忍的整數 block 延遲：d < DM ⇔ PM_d > 0
    for (const mu of [2, 10, 50, 100, 150, 250]) {
      const gg = mu * kq
      const dm = pmFirstOrder(gg).delayMarginBlocks
      for (let d = 0; d <= 6; d++) {
        if (Math.abs(d - dm) < 1e-9) continue
        expect(delayStable(gg, d).stable).toBe(d < dm)
        expect(pmWithDelay(gg, d).pmDeg > 0).toBe(d < dm)
      }
    }
  })

  it('反面測試：g < 0 的 Bode 相位採 lag 分支（−270° 起算），數值 PM = −90° − (2d+1)asin(|g|/2) < 0；不可出現 +270° 左右的假 PM', () => {
    const grid = logOmegaGrid(300, 1e-4, Math.PI)
    for (const d of [0, 1, 3]) {
      const g = -0.4
      const resp = calLoopResponse(g, d, grid)
      // ∠L = −270° − (d + ½)ω：每一點都在 −180° 以下
      for (let i = 0; i < grid.length; i++) {
        expect(resp.phaseDeg[i]).toBeCloseTo(-270 - ((d + 0.5) * grid[i] * 180) / Math.PI, 7)
        expect(resp.phaseDeg[i]).toBeLessThan(-180)
      }
      // |L| 與正的 |g| 相同：延遲與符號都不改大小
      const pos = calLoopResponse(-g, d, grid)
      for (let i = 0; i < grid.length; i += 37) expect(resp.mag[i]).toBeCloseTo(pos.mag[i], 12)
      const m = loopMargins((w) => calLoopGain(g, d, w), { lagBranch: true })
      expect(m.pmDeg).toBeCloseTo(-90 - (2 * d + 1) * ((Math.asin(0.2) * 180) / Math.PI), 6)
      expect(m.pmDeg).toBeLessThan(0)
      // 不設 lagBranch 時，主值起點 +90° 會算出沒有意義的「PM ≈ 270°」——這正是 UI 不可顯示的數字
      const wrong = loopMargins((w) => calLoopGain(g, d, w))
      expect(wrong.pmDeg).toBeCloseTo(m.pmDeg + 360, 6)
      expect(wrong.pmDeg).toBeGreaterThan(0)
    }
    // 正增益不受 lagBranch 影響（相位由 −90° 起算，本來就 ≤ 0）
    const a = loopResponse((w) => calLoopGain(0.7, 2, w), grid, true)
    const b = loopResponse((w) => calLoopGain(0.7, 2, w), grid, false)
    expect(Array.from(a.phaseDeg)).toEqual(Array.from(b.phaseDeg))
  })

  it('unwrapDeg 處理 ±180° 跳躍', () => {
    expect(Array.from(unwrapDeg([170, -170, -150, 170]))).toEqual([170, 190, 210, 170])
  })
})

// ───────────────────────── §8.3 更新延遲 ─────────────────────────

describe('stability：§8.3 δ_{k+1} = δ_k − gδ_{k−d}', () => {
  it('T08: 臨界增益 g* = 2 sin(π/(4d+2)) 與數值求根一致（d = 0..6，golden delay_bounds）', () => {
    const v = golden('delay_bounds')
    const ds = v.inputs.d_list as number[]
    const gExp = v.expected.g_crit_list as number[]
    const wExp = v.expected.omega_crit_rad_list as number[]
    const table = delayBoundTable(6)
    ds.forEach((d, i) => {
      expect(within(delayCriticalGain(d), gExp[i], v.tolerance)).toBe(true)
      expect(within(delayCriticalOmega(d), wExp[i], v.tolerance)).toBe(true)
      expect(Math.abs(delayCriticalGainNumeric(d) - gExp[i])).toBeLessThan(1e-10)
      expect(table[d].rhoBelow).toBeLessThan(1)
      expect(table[d].rhoAbove).toBeGreaterThan(1)
    })
  })

  it('T08: 臨界時單位圓上的根角度為 π/(2d+1)', () => {
    for (let d = 1; d <= 6; d++) {
      const r = delayStable(delayCriticalGain(d), d)
      expect(r.marginal).toBe(true)
      expect(r.stable).toBe(false)
      const onCircle = r.roots.filter((z) => Math.abs(cAbs(z) - 1) < 1e-9 && z.im > 0)
      expect(onCircle).toHaveLength(1)
      expect(Math.atan2(onCircle[0].im, onCircle[0].re)).toBeCloseTo(Math.PI / (2 * d + 1), 9)
    }
  })

  it('特徵多項式係數：d = 0 → [1, g−1]；d = 2 → [1, −1, 0, g]', () => {
    expect(delayCharPoly(0.3, 0)).toEqual([1, -0.7])
    expect(delayCharPoly(0.3, 2)).toEqual([1, -1, 0, 0.3])
    expect(() => delayCharPoly(0.3, 1.5)).toThrow()
  })

  it('Jury：d = 1 ⇔ 0 < g < 1；d = 2 ⇔ g < (√5 − 1)/2 = 0.618（golden ratio 共軛）', () => {
    expect(delayStable(0.999, 1).stable).toBe(true)
    expect(delayStable(1.001, 1).stable).toBe(false)
    const phi = (Math.sqrt(5) - 1) / 2
    expect(delayCriticalGain(2)).toBeCloseTo(phi, 14)
    expect(delayStable(phi - 1e-6, 2).stable).toBe(true)
    expect(delayStable(phi + 1e-6, 2).stable).toBe(false)
    // g = φ 時三個根為 e^{±jπ/5} 與 −φ
    const roots = polyRoots(delayCharPoly(phi, 2))
    expect(roots.some((z) => Math.abs(z.re + phi) < 1e-9 && Math.abs(z.im) < 1e-9)).toBe(true)
  })

  it('T08: PM_d = 90° − (2d+1)asin(g/2) 與數值 PM 一致；GM = g*/g', () => {
    for (let d = 0; d <= 6; d++) {
      for (const g of [0.05, 0.2, 0.35]) {
        const cf = pmWithDelay(g, d)
        const m = loopMargins((w) => calLoopGain(g, d, w))
        expect(m.pmDeg).toBeCloseTo(cf.pmDeg, 7)
        expect(m.gmDb).toBeCloseTo(cf.gmDb, 7)
        expect(m.phaseCrossovers[0].omega).toBeCloseTo(Math.PI / (2 * d + 1), 9)
      }
    }
    // PM = 0 ⇔ g = g*（頻域與根軌跡兩種觀點一致）
    for (let d = 0; d <= 6; d++) expect(pmWithDelay(delayCriticalGain(d), d).pmDeg).toBeCloseTo(0, 9)
    expect(pmWithDelay(0.5, 1).gmDb).toBeCloseTo(20 * Math.log10(2), 12)
  })

  it('手算表：d = 1、g = 0.5 ⇒ 1, 0.5, 0, −0.25, −0.25, −0.125, 0, 0.0625', () => {
    const { delta } = simulateDelayRecursion(0.5, 1, 7)
    expect(Array.from(delta)).toEqual([1, 0.5, 0, -0.25, -0.25, -0.125, 0, 0.0625])
  })

  it('T08: PM Lab 的 Analytic 交叉比對（封閉式 vs 數值）在穩定、臨界、不穩定、g > 2 都一致', () => {
    for (let d = 0; d <= 6; d++) {
      for (const g of [1e-4, 0.05, 0.3, 0.618, 1, 1.5, 1.99, 2, 2.2, 2.9, delayCriticalGain(d)]) {
        const chk = delayLoopCrossCheck(g, d)
        expect(chk.ok, `g=${g}, d=${d}: ${chk.items.filter((i) => !i.ok).map((i) => i.name)}`).toBe(true)
      }
    }
  })

  it('反面測試（回歸）：g ≤ 0 時 Analytic 交叉比對不可誤報 mismatch——PM/GM 不適用，改驗實根 z ≥ 1', () => {
    const neg = golden('negative_tests')
    const g = -(neg.inputs.mu_fs as number) * (neg.inputs.kq_per_fs as number)
    for (let d = 0; d <= 6; d++) {
      const chk = delayLoopCrossCheck(g, d)
      expect(chk.ok).toBe(true)
      expect(chk.stab.stable).toBe(false)
      expect(chk.pm.pmDeg).toBeNaN()
      // |L| 仍有 crossover（數值會找到），但那不是穩定裕度
      expect(chk.margins.crossovers.length).toBeGreaterThan(0)
    }
    expect(delayLoopCrossCheck(g, 0).stab.rho).toBeCloseTo(neg.expected.reversed_polarity_pole as number, 12)
    const zero = delayLoopCrossCheck(0, 2)
    expect(zero.ok).toBe(true)
    expect(zero.stab.marginal).toBe(true)
  })

  it('反面測試：d = 2、g = 0.7 > 0.618 ⇒ 不穩定（一階模型卻說 0 < g < 2 都穩定）', () => {
    expect(pmFirstOrder(0.7).stable).toBe(true)
    const r = delayStable(0.7, 2)
    expect(r.stable).toBe(false)
    expect(r.rho).toBeGreaterThan(1)
    expect(pmWithDelay(0.7, 2).pmDeg).toBeLessThan(0)
    const run = simulateDelayRecursion(0.7, 2, 2000)
    expect(run.divergedAt).not.toBeNull()
  })
})

// ───────────────────────── §8.4 雙迴路（T09） ─────────────────────────

describe('stability：§8.4 雙迴路', () => {
  const ex = { r: 0.8, b: 0.2, c: 1, mu: 1.2 }

  it('T09: r=.8, b=.2, c=1, μ=1.2 ⇒ poles 0.9 ± j0.4796、|z| = 1.0198 > 1（golden vector）', () => {
    const v = golden('T09')
    const tol = v.tolerance
    const a = analyzeDualLoop(ex)
    const cp = dualLoopCharPoly(ex)
    const exp = v.expected.char_poly as number[]
    cp.forEach((x, i) => expect(within(x, exp[i], tol)).toBe(true))
    const top = a.poles.find((z) => z.im > 0)!
    expect(within(top.re, v.expected.pole_re as number, tol)).toBe(true)
    expect(within(top.im, v.expected.pole_im as number, tol)).toBe(true)
    expect(within(a.rho, v.expected.pole_abs as number, tol)).toBe(true)
    expect(a.stable).toBe(false)
    // eigvals(A) 與特徵式求根一致
    const topEig = a.polesEig.find((z) => z.im > 0)!
    expect(topEig.re).toBeCloseTo(top.re, 12)
    expect(topEig.im).toBeCloseTo(top.im, 12)
    expect(within(a.fullRange.lo, v.expected.mu_min_full as number, tol)).toBe(true)
    expect(within(a.fullRange.hi, v.expected.mu_max_full as number, tol)).toBe(true)
    expect(within(a.simplifiedRange.hi, v.expected.mu_max_simplified as number, tol)).toBe(true)
    expect(within(a.simplifiedPole, v.expected.simplified_pole_at_mu as number, tol)).toBe(true)
  })

  it('T09: 反面測試——簡化模型說穩定（pole −0.2），完整模型發散得很慢：前 30 blocks 峰值只有 1.70；|δ_100| = 0.431 落在零交越附近，但同一週期峰值 6.76；|δ_300| ≈ 204', () => {
    const a = analyzeDualLoop(ex)
    expect(a.simplifiedStable).toBe(true)
    expect(a.stable).toBe(false)
    const full = simulateFullModel(ex, 300).delta
    // 振盪週期 2π/arg z ≈ 12.83 blocks
    const top = a.poles.find((z) => z.im > 0)!
    const period = (2 * Math.PI) / Math.atan2(top.im, top.re)
    expect(period).toBeCloseTo(12.833, 3)
    const P = Math.ceil(period)
    // 短模擬：峰值只從 1 長到 1.70（看起來像「還在收斂的振盪」）
    expect(peakAbs(full, 0, 30)).toBeCloseTo(1.699355074645683, 9)
    // 單一時間點的陷阱：|δ_100| 很小，但同一個週期內的峰值已經 6.76（≈ ρ^100 = 7.1 的量級）
    expect(Math.abs(full[100])).toBeCloseTo(0.431043451231818, 9)
    expect(peakAbs(full, 100 - P, 100)).toBeCloseTo(6.755788024175185, 9)
    expect(a.rho ** 100).toBeCloseTo(7.11, 2)
    expect(full[300]).toBeCloseTo(-203.7939163674217, 6)
    const simp = simulateQuasiStatic(ex, 300)
    expect(Math.abs(simp[300])).toBeLessThan(1e-100)
  })

  it('peakAbs：視窗截到陣列範圍', () => {
    const x = [1, -3, 2, -0.5]
    expect(peakAbs(x, 0, 3)).toBe(3)
    expect(peakAbs(x, 2, 10)).toBe(2)
    expect(peakAbs(x, -5, 0)).toBe(1)
  })

  it('T09: 完整 μ 上界 (1 − r)/(bc) 與數值掃描一致，且恰為 quasi-static 上界的一半（E19，與 r 無關）', () => {
    const cases: [number, number, number, number][] = [
      [0.8, 0.2, 1, 1],
      [0, 0.5, 1, 2],
      [0.5, 0.3, 2, 0.8333333333333334],
      [-0.5, 0.4, 1, 3.75],
      [0.95, 0.05, 1, 1],
      [0.99, 0.01, 1, 1],
    ]
    for (const [r, b, cc, hiExp] of cases) {
      const full = dualLoopFullMuRange(r, b, cc)
      const simp = dualLoopSimplifiedMuRange(r, b, cc)
      expect(full.hi).toBeCloseTo(hiExp, 12)
      expect(full.lo).toBe(0)
      expect(full.hi / simp.hi).toBeCloseTo(0.5, 12)
      const num = stableIntervalsNumeric((mu) => analyzeDualLoop({ r, b, c: cc, mu }).rho, 0, 3 * simp.hi, 601)
      expect(num).toHaveLength(1)
      expect(num[0].lo).toBeLessThan(1e-9)
      expect(num[0].hi).toBeCloseTo(hiExp, 8)
    }
  })

  it('T09: E19——r = 0 時完整模型就是 §8.3 的 d = 1（g = μbc）', () => {
    const p = { r: 0, b: 0.5, c: 1, mu: 1.6 }
    const g = p.mu * p.b * p.c
    // s_0 = bδ_{−1} = bδ_0 ⇔ 延遲遞迴的常數歷史
    const full = simulateFullModel(p, 40, 1, p.b * 1).delta
    const delay = simulateDelayRecursion(g, 1, 40).delta
    for (let k = 0; k <= 40; k++) expect(full[k]).toBeCloseTo(delay[k], 12)
    expect(dualLoopFullMuRange(0, 0.5, 1).hi * 0.5).toBeCloseTo(delayCriticalGain(1), 12)
  })

  it('T09: E19 數值——μ = 0.05 重根 0.9；μ = 0.5 ρ = 0.9487（簡化 0.5）；μ = 0.8 ρ = 0.9798（簡化 0.2）', () => {
    const a05 = analyzeDualLoop({ ...ex, mu: 0.05 })
    expect(a05.rho).toBeCloseTo(0.9, 7)
    expect(a05.simplifiedPole).toBeCloseTo(0.95, 12)
    expect(a05.muComplex).toBeCloseTo(0.05, 12)
    const a5 = analyzeDualLoop({ ...ex, mu: 0.5 })
    expect(a5.rho).toBeCloseTo(0.948683298050514, 12)
    expect(a5.simplifiedPole).toBeCloseTo(0.5, 12)
    expect(analyzeDualLoop({ ...ex, mu: 0.8 }).rho).toBeCloseTo(0.9797958971132713, 12)
    // 複數區 |z|² = r + μbc
    expect(analyzeDualLoop({ ...ex, mu: 0.3 }).rho ** 2).toBeCloseTo(0.8 + 0.3 * 0.2, 12)
  })

  it('T09: 完整模型的 PM 在 μ = 1 時為 0°，簡化模型卻是 60°', () => {
    const sys: ObservationSystem = { A: [[0.8]], b: [0.2], c: [1], d: 0 }
    const m = loopMargins((w) => calLoopGainGeneral(sys, 1, w))
    expect(m.pmDeg).toBeCloseTo(0, 6)
    expect(pmFirstOrder(1 * analyzeGeneral(sys, 1).dcGain).pmDeg).toBeCloseTo(60, 10)
    const m12 = loopMargins((w) => calLoopGainGeneral(sys, 1.2, w))
    expect(m12.pmDeg).toBeLessThan(0)
  })

  it('T09: E19 的頻域版本——cos ω_180 = (1 + r)/2、|L(ω_180)| = g_eff ⇒ GM_完整 = 1/g_eff，恰比 quasi-static 的 2/g_eff 少 6.02 dB，與 r 無關', () => {
    const cases: [number, number, number, number][] = [
      [0.8, 0.2, 1, 0.5],
      [0.8, 0.2, 1, 1.2],
      [0, 0.5, 1, 1.2],
      [-0.5, 0.4, 1, 2],
      [0.5, 0.3, 2, 0.6],
      [0.95, 0.05, 1, 0.3],
      [0.99, 0.01, 1, 0.9],
    ]
    for (const [r, b, cc, mu] of cases) {
      const cf = dualLoopGainMargin({ r, b, c: cc, mu })
      const sys: ObservationSystem = { A: [[r]], b: [b], c: [cc], d: 0 }
      const num = loopMargins((w) => calLoopGainGeneral(sys, mu, w), { omegaMin: 1e-5 })
      expect(cf.gEff).toBeCloseTo((mu * b * cc) / (1 - r), 12)
      expect(Math.cos(cf.omega180)).toBeCloseTo((1 + r) / 2, 12)
      expect(num.phaseCrossovers).toHaveLength(1)
      expect(num.phaseCrossovers[0].omega).toBeCloseTo(cf.omega180, 8)
      expect(num.gmDb).toBeCloseTo(cf.gmFullDb, 7)
      // 兩個開迴路 pole 到臨界點的距離相等：|e^{jω}−1| = |e^{jω}−r| = √(1−r)
      const zc = { re: Math.cos(cf.omega180), im: Math.sin(cf.omega180) }
      expect(Math.hypot(zc.re - 1, zc.im)).toBeCloseTo(Math.sqrt(1 - r), 12)
      expect(Math.hypot(zc.re - r, zc.im)).toBeCloseTo(Math.sqrt(1 - r), 12)
      // 觀測路徑在 ω_180 的相位（quasi-static 當它是 0°）
      const F = observationTransfer(sys, zc)
      expect((Math.atan2(F.im, F.re) * 180) / Math.PI).toBeCloseTo(cf.obsPhaseAt180Deg, 9)
      // 恰差 2 倍（6.0206 dB），與 r 無關
      expect(cf.gmSimplifiedDb - cf.gmFullDb).toBeCloseTo(20 * Math.log10(2), 12)
      expect(cf.gmSimplifiedDb).toBeCloseTo(pmFirstOrder(cf.gEff).gmDb, 12)
      // GM > 0 dB ⇔ 完整模型穩定 ⇔ g_eff < 1
      expect(cf.gmFullDb > 0).toBe(analyzeDualLoop({ r, b, c: cc, mu }).stable)
    }
    // r = 0：ω_180 = π/3（與 §8.3 d = 1 相同）、∠F = −ω_180 = −60°（純一個 block 的延遲）
    const r0 = dualLoopGainMargin({ r: 0, b: 0.5, c: 1, mu: 1 })
    expect(r0.omega180).toBeCloseTo(delayCriticalOmega(1), 12)
    expect(r0.obsPhaseAt180Deg).toBeCloseTo(-60, 12)
    // μ = 0.5 的頁面例子：g_eff = 0.5、GM 6.02 dB vs 12.04 dB、完整 PM 19.07° vs 簡化 75.52°
    const ex05 = dualLoopGainMargin({ ...ex, mu: 0.5 })
    expect(ex05.gmFullDb).toBeCloseTo(6.0206, 4)
    expect(ex05.gmSimplifiedDb).toBeCloseTo(12.0412, 4)
    const pm05 = loopMargins((w) => calLoopGainGeneral({ A: [[0.8]], b: [0.2], c: [1], d: 0 }, 0.5, w)).pmDeg
    expect(pm05).toBeCloseTo(19.0736, 3)
    expect(pmFirstOrder(0.5).pmDeg).toBeCloseTo(75.5225, 3)
  })

  it('反面測試：dualLoopGainMargin 在極性錯誤（bc < 0）、μ = 0 或 |r| ≥ 1 時回傳 NaN（GM 不適用），不可給出看似合理的數字', () => {
    for (const p of [
      { r: 0.8, b: -0.2, c: 1, mu: 0.5 },
      { r: 0.8, b: 0.2, c: 1, mu: 0 },
      { r: 1, b: 0.2, c: 1, mu: 0.5 },
      { r: 1.1, b: 0.2, c: 1, mu: 0.5 },
    ]) {
      const g = dualLoopGainMargin(p)
      expect(g.omega180).toBeNaN()
      expect(g.gmFullDb).toBeNaN()
      expect(g.gmSimplifiedDb).toBeNaN()
      expect(g.obsPhaseAt180Deg).toBeNaN()
    }
    // 極性錯誤的二狀態迴路：lag 分支下數值 PM 為負；不設 lagBranch 會得到 > 180° 的假 PM
    const sys: ObservationSystem = { A: [[0.8]], b: [-0.2], c: [1], d: 0 }
    const L = (w: number) => calLoopGainGeneral(sys, 0.5, w)
    expect(loopMargins(L, { lagBranch: true }).pmDeg).toBeLessThan(0)
    expect(loopMargins(L).pmDeg).toBeGreaterThan(180)
    expect(analyzeDualLoop({ r: 0.8, b: -0.2, c: 1, mu: 0.5 }).stable).toBe(false)
  })

  it('反面測試：r_s = 1（觀測含積分器）時 analyzeDualLoop 不拋錯——F(1) = ∞、兩個區間皆為空、完整模型不穩定', () => {
    const a = analyzeDualLoop({ r: 1, b: 0.2, c: 1, mu: 1.2 })
    expect(Number.isFinite(a.dcGain)).toBe(false)
    expect(a.fullRange.empty).toBe(true)
    expect(a.simplifiedRange.empty).toBe(true)
    expect(a.simplifiedStable).toBe(false)
    expect(a.stable).toBe(false)
    expect(a.rho).toBeCloseTo(Math.sqrt(1 + 1.2 * 0.2), 12)
  })

  it('T09: E19 反事實——觀測沒有 latency（d_s = c_s b_s）時界限變成 0 < μbc < 2(1 + r)，r = 0 時與 quasi-static 相同', () => {
    for (const r of [-0.5, 0, 0.5, 0.8, 0.95]) {
      const b = 0.2
      const cc = 1
      const zl: ObservationSystem = { A: [[r]], b: [b], c: [cc * r], d: cc * b }
      const F1 = analyzeGeneral(zl, 1).dcGain
      expect(F1).toBeCloseTo((b * cc) / (1 - r), 12)
      const iv = stableIntervalsNumeric((mu) => analyzeGeneral(zl, mu).rho, 0, (2 * (1 + r)) / (b * cc) + 5, 801)
      expect(iv).toHaveLength(1)
      expect(iv[0].hi).toBeCloseTo((2 * (1 + r)) / (b * cc), 7)
    }
    // r = 0：無 latency 模型 = quasi-static（2/(bc)），有 latency 模型 = 一半
    expect(dualLoopSimplifiedMuRange(0, 0.2, 1).hi).toBeCloseTo(10, 12)
    expect(dualLoopFullMuRange(0, 0.2, 1).hi).toBeCloseTo(5, 12)
  })

  it('反面測試：bc < 0（觀測極性錯誤）⇒ 沒有任何正 μ 能穩定', () => {
    const full = dualLoopFullMuRange(0.8, -0.2, 1)
    expect(full.empty).toBe(true)
    const num = stableIntervalsNumeric((mu) => analyzeDualLoop({ r: 0.8, b: -0.2, c: 1, mu }).rho, 1e-6, 5, 401)
    expect(num).toHaveLength(0)
    expect(dualLoopFullMuRange(0.8, 0, 1).empty).toBe(true)
    expect(dualLoopSimplifiedMuRange(1.1, 0.2, 1).empty).toBe(true)
  })

  it('根軌跡封閉式與 eigvals 一致', () => {
    const mus = [0, 0.03, 0.05, 0.4, 1.2]
    const loc = dualLoopRootLocus(0.8, 0.2, 1, mus)
    mus.forEach((mu, i) => {
      const ev = eigvals(dualLoopMatrix({ r: 0.8, b: 0.2, c: 1, mu }))
      const sortKey = (z: { re: number; im: number }) => z.re * 1e3 + z.im
      const a = [...loc[i]].sort((x, y) => sortKey(x) - sortKey(y))
      const e = [...ev].sort((x, y) => sortKey(x) - sortKey(y))
      a.forEach((z, j) => {
        expect(z.re).toBeCloseTo(e[j].re, 6)
        expect(z.im).toBeCloseTo(e[j].im, 6)
      })
    })
  })
})

// ───────────────────────── 一般化 state-space（E31） ─────────────────────────

describe('stability：一般化 A_comb 與 F(z)', () => {
  it('一維觀測時 A_comb 等於二狀態矩陣；F(1) = c_s b_s/(1 − A_s) = 1（E31 數值證據）', () => {
    const sys: ObservationSystem = { A: [[0.8]], b: [0.2], c: [1], d: 0 }
    expect(combinedMatrix(sys, 1.2)).toEqual(dualLoopMatrix({ r: 0.8, b: 0.2, c: 1, mu: 1.2 }))
    const g = analyzeGeneral(sys, 1.2)
    expect(g.dcGain).toBeCloseTo(1, 14)
    expect(g.rho).toBeCloseTo(1.019803902718557, 12)
    expect(g.simplifiedMuMax).toBeCloseTo(2, 12)
    const F1 = observationTransfer(sys, c(1))
    expect(F1.re).toBeCloseTo(1, 14)
    expect(F1.im).toBeCloseTo(0, 14)
  })

  it('A_comb 的每個 eigenvalue λ 都滿足 λ − 1 + μF(λ) = 0（Schur complement）', () => {
    const sys: ObservationSystem = {
      A: [
        [0.6, 0.2, 0],
        [-0.1, 0.5, 0.3],
        [0, 0.2, 0.4],
      ],
      b: [0.3, 0.1, -0.05],
      c: [1, 0.5, 0.2],
      d: 0.1,
    }
    const mu = 0.7
    const ev = eigvals(combinedMatrix(sys, mu))
    expect(ev).toHaveLength(4)
    for (const lam of ev) {
      const res = cAdd(cSub(lam, c(1)), cScale(observationTransfer(sys, lam), mu))
      expect(cAbs(res)).toBeLessThan(1e-9)
    }
  })

  it('d_s 為 0、A_s 為空（0 維）時退化成 §8.2：A_comb = [1 − μd_s]', () => {
    const sys: ObservationSystem = { A: [], b: [], c: [], d: 1 }
    expect(combinedMatrix(sys, 0.4)).toEqual([[0.6]])
    expect(analyzeGeneral(sys, 0.4).dcGain).toBe(1)
  })

  it('一般化時域與二狀態時域一致', () => {
    const p = { r: 0.8, b: 0.2, c: 1, mu: 0.5 }
    const gen = simulateGeneral({ A: [[p.r]], b: [p.b], c: [p.c], d: 0 }, p.mu, 60).delta
    const full = simulateFullModel(p, 60).delta
    for (let k = 0; k <= 60; k++) expect(gen[k]).toBeCloseTo(full[k], 12)
  })

  it('A_s 含 z = 1 積分器 ⇒ F(1) 不存在（NaN），不可套 quasi-static', () => {
    const g = analyzeGeneral({ A: [[1]], b: [0.2], c: [1], d: 0 }, 0.5)
    expect(g.dcGain).toBeNaN()
    expect(g.simplifiedMuMax).toBeNaN()
  })
})

// ───────────────────────── Monte Carlo：真實 block sign-LMS vs 線性延遲模型 ─────────────────────────

describe('stability：Monte Carlo 交叉比對（blockLms）', () => {
  const runMc = (g: number, d: number, blocks: number) => {
    const setup = { g, d, sigmaV: 100, N: 1024, delta0: 20, blocks, seed: 20261010 }
    const runs = 16
    const mc = runBlockLmsMonteCarlo({ config: buildSignLmsMcConfig(setup), runs })
    const deltaMc = Array.from(mc.wMean, (w) => setup.delta0 - w)
    const lin = simulateDelayRecursion(mc.analytic.g, d, blocks, setup.delta0).delta
    return { mc, cmp: compareMcToLinear(deltaMc, mc.wStd, runs, lin, setup.delta0, setup.sigmaV), deltaMc }
  }

  it('μ = g/K_q 的換算：blockLms 的 analytic.g 等於指定 g', () => {
    const cfg = buildSignLmsMcConfig({ g: 0.8, d: 1, sigmaV: 100, N: 256, delta0: 20, blocks: 10, seed: 1 })
    expect(cfg.gain_step).toBeCloseTo(0.8 / comparatorKq(100), 12)
    expect(cfg.cal_update_delay_blocks).toBe(1)
  })

  it('T08: 穩定區（g = 1, d = 0；g = 0.5, d = 1）ensemble 平均與線性模型在 Student-t·SE（Bonferroni）＋線性化容許量內一致', () => {
    const a = runMc(1, 0, 40)
    expect(a.mc.analytic.g).toBeCloseTo(1, 6)
    expect(a.cmp.pass).toBe(true)
    const b = runMc(0.5, 1, 40)
    expect(b.cmp.pass).toBe(true)
  })

  it('反面測試：d = 2、g = 0.65（preset pm-d2-unstable，300 blocks）線性模型長到 > 1000 fs，真實 sign-LMS 停在 σ_v 量級的有界 limit cycle', () => {
    const r = runMc(0.65, 2, 300)
    expect(r.cmp.pass).toBe(false)
    const lin = simulateDelayRecursion(r.mc.analytic.g, 2, 300, 20).delta
    expect(peakAbs(lin, 260, 300)).toBeGreaterThan(1000)
    const mcPeak = peakAbs(r.deltaMc, 260, 300)
    expect(mcPeak).toBeGreaterThan(20) // 沒有收斂（仍是失敗）
    expect(mcPeak).toBeLessThan(2 * 100) // 但有界：σ_v = 100 fs 的量級
  })

  it('反面測試：d = 1、g = 1.3（> g* = 1）線性模型發散，但 sign-LMS 因 |G| ≤ 1 而有界 ⇒ 比對必須顯示 mismatch', () => {
    const r = runMc(1.3, 1, 120)
    expect(r.cmp.pass).toBe(false)
    expect(r.deltaMc.every((x) => Number.isFinite(x) && Math.abs(x) < 1e4)).toBe(true)
  })
})

describe('stability：§8.3 補充——以 d + 1 個極點的模態展開數 k95（settleFromPoles）', () => {
  /** 獨立的暴力遞推：不用環形緩衝、不用停止規則，直接跑 n 步 */
  const brute = (g: number, d: number, n = 5000) => {
    const y = new Array<number>(d + 1).fill(1)
    let last = 0
    for (let k = 1; k < n; k++) {
      y.push(y[y.length - 1] - g * y[y.length - 1 - d])
      if (Math.abs(y[y.length - 1]) > 0.05) last = k
    }
    return last + 1
  }

  it('模態展開 y_k = Σ c_p k^p λ^k 與逐 block 遞迴逐點相同（d = 0…6、各 120 個 g，前 200 步差 < 10⁻¹²）；重根（d = 1、g = 1/4 ⇒ z = 1/2 二重）也解得出來', () => {
    let worst = 0
    for (let d = 0; d <= 6; d++) {
      const gc = delayCriticalGain(d)
      for (let i = 1; i <= 120; i++) {
        const g = (gc * i) / 121
        const m = delayModes(g, d)
        expect(m.modes, `g=${g}, d=${d}`).not.toBeNull()
        expect(m.modes!.reduce((s, x) => s + (x.real ? 1 : 2) * x.multiplicity, 0)).toBe(d + 1) // 未知數個數 = 極點數
        const y = new Array<number>(d + 1).fill(1)
        for (let k = 1; k <= 200; k++) {
          y.push(y[y.length - 1] - g * y[y.length - 1 - d])
          worst = Math.max(worst, Math.abs(delayModalValue(m, k) - y[y.length - 1]))
          expect(Math.abs(y[y.length - 1])).toBeLessThanOrEqual(delayModalBound(m, k) + 1e-12) // 三角不等式上界
        }
        // 初始條件：k = −d…0 都是 1
        for (let k = -d; k <= 0; k++) expect(delayModalValue(m, k)).toBeCloseTo(1, 9)
      }
    }
    expect(worst).toBeLessThan(1e-12)
    const dbl = delayModes(0.25, 1)
    expect(dbl.modes).toHaveLength(1)
    expect(dbl.modes![0].multiplicity).toBe(2)
    expect(dbl.modes![0].lambda.re).toBeCloseTo(0.5, 9)
    // 重根解：y_k = (k + 2)/2^{k+1} ⇒ c_0 = 1、c_1 = 1/2（c_0 λ^k + c_1 k λ^k = (1 + k/2)·2^{−k}）
    expect(dbl.modes![0].coeff[0].re).toBeCloseTo(1, 9)
    expect(dbl.modes![0].coeff[1].re).toBeCloseTo(0.5, 9)
    expect(delayModalValue(dbl, 6)).toBeCloseTo(8 / 128, 12)
    expect(delayModalValue(dbl, 7)).toBeCloseTo(9 / 256, 12)
  })

  it('T08: k95（極點模態展開）與 settleDelayed（逐 block 遞推）在 d = 0…6 的整個穩定區逐點相同（誤差 < 1 步，實際為 0），也等於暴力遞推', () => {
    let n = 0
    for (let d = 0; d <= 6; d++) {
      const gc = delayCriticalGain(d)
      for (let i = 1; i <= 120; i++) {
        const g = (gc * i) / 121
        const a = settleFromPoles(g, d)
        const b = settleDelayed(g, d)
        expect(a.exact, `g=${g}, d=${d}`).toBe(true)
        expect(b.exact, `g=${g}, d=${d}`).toBe(true)
        expect(Math.abs(a.blocks - b.blocks), `g=${g}, d=${d}`).toBeLessThan(1)
        expect(a.blocks, `g=${g}, d=${d}`).toBe(brute(g, d))
        expect(a.provenAt).not.toBeNull()
        expect(a.provenAt!).toBeGreaterThanOrEqual(a.blocks - 1)
        n++
      }
    }
    expect(n).toBe(840)
    // 反例：只看 ρ 的漸近估計兩個方向都會錯（Corner 判斷器假設欄的那幾組）
    const cases: [number, number, number, number][] = [
      [0.25, 1, 5, 7],
      [4 / 27, 2, 8, 11],
      [27 / 256, 3, 11, 16],
      [0.33 * delayCriticalGain(3), 3, 14, 8],
      [0.8, 1, 27, 26],
    ]
    for (const [g, d, asym, actual] of cases) {
      const r = settleFromPoles(g, d)
      expect(r.asymptotic, `漸近 g=${g}, d=${d}`).toBe(asym)
      expect(r.blocks, `模態 g=${g}, d=${d}`).toBe(actual)
      expect(r.method).toBe('modes')
    }
    // d = 0：封閉式 ⌈ln 0.05/ln|1 − g|⌉（T11：g = 0.005 ⇒ 598）；deadbeat g = 1 ⇒ 1（λ = 0 沒有模態展開，退回遞推）
    expect(settleFromPoles(0.005, 0).blocks).toBe(598)
    expect(settleFromPoles(0.005, 0).asymptotic).toBe(598)
    const dead = settleFromPoles(1, 0)
    expect([dead.blocks, dead.asymptotic, dead.exact, dead.method]).toEqual([1, 1, true, 'recursion'])
    // 不穩定（含 g ≤ 0）：∞
    for (const [g, d] of [[1.2 * delayCriticalGain(1), 1], [0, 1], [-0.1, 2], [2.5, 0]] as const) {
      const r = settleFromPoles(g, d)
      expect([r.blocks, r.asymptotic, r.stable, r.exact]).toEqual([Infinity, Infinity, false, true])
    }
  })

  it('極慢的 mode：證明需要的步數 ln(0.05/A)/ln ρ 超過上限就直接回報沒數完（exact = false、blocks = 漸近估計），不掃兩百萬步；步數上限可指定', () => {
    const t0 = performance.now()
    const slow = settleFromPoles(1e-6, 1)
    expect(performance.now() - t0).toBeLessThan(50)
    expect(slow.exact).toBe(false)
    expect(slow.provenAt).toBeNull()
    expect(slow.blocks).toBe(slow.asymptotic)
    expect(slow.blocks).toBeGreaterThan(SETTLE_FROM_POLES_MAX_STEPS)
    expect(settleDelayed(1e-6, 1).exact).toBe(false)
    const capped = settleFromPoles(0.01, 1, 0.05, 50)
    expect([capped.exact, capped.blocks]).toEqual([false, capped.asymptotic])
    expect(settleFromPoles(0.01, 1).blocks).toBe(296) // 上限夠就數得完
    expect(settleFromPoles(0.01, 1).exact).toBe(true)
  })
})
