import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { polyRoots, cAbs } from '@/simulation/core'
import { analyzeBlockLms } from '@/simulation/models/blockLms'
import { SPEC_NUMBERS, alignmentDemo, gCritical, limitCycleDemo, loopNumbers, pmDeg } from './refNumbers'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

function vec(name: string): Vector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as Vector
}

function close(actual: number, expected: number, tol: { abs?: number; rel?: number }, what: string): void {
  const bound = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(expected)
  // 浮點運算順序不同時允許 4 ulp 的餘裕
  expect(Math.abs(actual - expected), what).toBeLessThanOrEqual(bound + 4 * Number.EPSILON * Math.max(1, Math.abs(expected)))
}

describe('頁面文字用的封閉式數字（refNumbers）', () => {
  it('T13: §15.3 範例的 K、g、p、σ_w、sum 模式增益與 golden T13 一致', () => {
    const v = vec('T13')
    close(SPEC_NUMBERS.K, v.expected.K_per_fs as number, v.tolerance, 'K')
    close(SPEC_NUMBERS.g, v.expected.g as number, v.tolerance, 'g')
    close(SPEC_NUMBERS.p, v.expected.p as number, v.tolerance, 'p')
    close(SPEC_NUMBERS.sigmaW, v.expected.sigma_w_fs as number, v.tolerance, 'sigma_w')
    close(SPEC_NUMBERS.gSum, v.expected.g_sum_mode as number, { abs: 1e-9 }, 'g_sum')
    close(SPEC_NUMBERS.poleSum, v.expected.pole_sum_mode as number, { abs: 1e-9 }, 'pole_sum')
  })

  it('T14: f_u、exact −3 dB、兩種近似與 ENBW 和 golden T14 一致；ENBW/f_3dB 接近 π/2', () => {
    const v = vec('T14')
    close(SPEC_NUMBERS.fu, v.expected.f_u_hz as number, v.tolerance, 'f_u')
    close(SPEC_NUMBERS.f3db, v.expected.bw_exact_3db_hz as number, { rel: 1e-9 }, 'f_3dB')
    close(SPEC_NUMBERS.f3dbNegLn, v.expected.bw_neg_ln_p_hz as number, { rel: 1e-9 }, '-ln p')
    close(SPEC_NUMBERS.f3dbOneMinusP, v.expected.bw_one_minus_p_hz as number, { rel: 1e-9 }, '1-p')
    close(SPEC_NUMBERS.enbw, v.expected.enbw_one_sided_hz as number, { rel: 1e-9 }, 'ENBW')
    // §3.4 的敘述：p → 1 時比值 → π/2；本例差 < 0.5%
    expect(Math.abs(SPEC_NUMBERS.enbw / SPEC_NUMBERS.f3db / (Math.PI / 2) - 1)).toBeLessThan(5e-3)
    // −ln p 近似比 (1 − p) 近似準（E26）
    expect(Math.abs(SPEC_NUMBERS.f3dbNegLn - SPEC_NUMBERS.f3db)).toBeLessThan(Math.abs(SPEC_NUMBERS.f3dbOneMinusP - SPEC_NUMBERS.f3db) / 10)
  })

  it('T14: §3.4 推導的中間式：半功率條件 1 − 2p cosΩ + p² = 2(1 − p)² 與 Ω ≈ (1 − p)/√p', () => {
    const p = SPEC_NUMBERS.p
    const omega = (2 * Math.PI * SPEC_NUMBERS.f3db) / SPEC_NUMBERS.fu
    expect(1 - 2 * p * Math.cos(omega) + p * p).toBeCloseTo(2 * (1 - p) * (1 - p), 12)
    expect(Math.abs(omega / ((1 - p) / Math.sqrt(p)) - 1)).toBeLessThan(1e-3)
    // p < 3 − 2√2 時沒有 −3 dB 點（E27）：loopNumbers 回傳 NaN 而不是硬套近似
    const flat = loopNumbers({ sigmaV: 100, N: 4096, mu: 110, fs: 4e9 })
    expect(flat.p).toBeLessThan(3 - 2 * Math.SQRT2)
    expect(Number.isNaN(flat.f3db)).toBe(true)
  })

  it('規格 §8.3：g_crit(d) = 2 sin(π/(4d+2)) 與 golden delay_bounds 一致，且就是特徵方程根碰到單位圓的增益', () => {
    const v = vec('delay_bounds')
    const ds = v.inputs.d_list as number[]
    const gs = v.expected.g_crit_list as number[]
    ds.forEach((d, i) => close(gCritical(d), gs[i], v.tolerance, `g_crit(${d})`))
    for (const d of [0, 1, 2, 3, 4]) {
      // z^{d+1} − z^d + g = 0（降冪係數）；d = 0 時為 z − (1 − g)
      const coeffs = (g: number): number[] => (d === 0 ? [1, g - 1] : [1, -1, ...new Array<number>(d - 1).fill(0), g])
      const rho = (g: number): number => Math.max(...polyRoots(coeffs(g)).map(cAbs))
      expect(rho(gCritical(d) * 0.98), `d=${d} 內側`).toBeLessThan(1)
      expect(rho(gCritical(d) * 1.02), `d=${d} 外側`).toBeGreaterThan(1)
      // PM = 0 恰好在 g_crit
      expect(Math.abs(pmDeg(gCritical(d), d))).toBeLessThan(1e-9)
    }
    expect(pmDeg(1, 0)).toBeCloseTo(60, 10)
    expect(Number.isNaN(pmDeg(2.5, 0))).toBe(true)
    expect(Number.isNaN(pmDeg(-0.1, 0))).toBe(true)
  })

  it('T08: pmDeg（§3.4 的 PM 公式）與 golden T08、blockLms.ts 的 analyzeBlockLms 一致；§11 思考題 5 的數字', () => {
    const v = vec('T08')
    close(pmDeg(1, 0), v.expected.pm_deg as number, v.tolerance, 'PM(g = 1, d = 0) = 60°')
    ;(v.inputs.g_list as number[]).forEach((g, i) => close(pmDeg(g, 0), (v.expected.pm_deg_list as number[])[i], v.tolerance, `PM(g = ${g})`))
    // 實際模型：三種更新延遲、三個 μ
    for (const d of [0, 1, 2]) {
      for (const mu of [10, 40, 60]) {
        const an = analyzeBlockLms({ gain_step: mu, cal_update_delay_blocks: d }).analytic
        close(pmDeg(an.g, d), an.pmDeg, { rel: 1e-12, abs: 1e-9 }, `PM(μ = ${mu}, d = ${d})`)
        close(gCritical(d), an.gCritical, { rel: 1e-12 }, `g_crit(${d})`)
      }
    }
    // 思考題 5：d = 1 時 §15.3 範例剩 83.14°；要求 PM ≥ 45° ⇒ g ≤ 2 sin 15° ⇒ μ ≤ 64.88 fs，代回實際模型 PM 恰為 45°
    expect(pmDeg(SPEC_NUMBERS.g, 1).toFixed(2)).toBe('83.14')
    const gMax = 2 * Math.sin(Math.PI / 12)
    const muMax = gMax / SPEC_NUMBERS.K
    expect(muMax.toFixed(2)).toBe('64.88')
    close(analyzeBlockLms({ gain_step: muMax, cal_update_delay_blocks: 1 }).analytic.pmDeg, 45, { abs: 1e-9 }, 'PM(μ_max) = 45°')
    // SPEC_NUMBERS.pmDeg（d = 0）就是同一個公式
    close(SPEC_NUMBERS.pmDeg, pmDeg(SPEC_NUMBERS.g, 0), { rel: 1e-12 }, 'SPEC_NUMBERS.pmDeg')
  })

  it('T07: 對齊示範 C_D（φ = −120°、Ω = π/6）：D = 4 為 0.5、D = 0 為 −0.25（golden T07）', () => {
    const v = vec('T07')
    const a = alignmentDemo()
    expect(a.phiDeg).toBe(v.inputs.phi_deg)
    close(a.omega, v.inputs.Omega_rad as number, { abs: 1e-15 }, 'Omega')
    close(a.c4, v.expected.C_D as number, v.tolerance, 'C_D(4)')
    close(a.c0, (v.expected.C_D_list as number[])[0], v.tolerance, 'C_D(0)')
    expect(a.c0).toBeLessThan(0) // 反面：沒對齊時更新方向相反
  })

  it('L5 limit cycle 示範（小 N）：實體 gain 在 3.000 / 3.125 fs 間週期 2，平均 3.0625 fs，不等於 a = 3.05', () => {
    const lc = limitCycleDemo()
    expect(lc.period).toBe(2)
    expect(lc.levels).toEqual([3, 3.125])
    expect(lc.meanPhys).toBeCloseTo(3.0625, 12)
    expect(lc.lsb).toBe(0.125)
    expect(Math.abs(lc.meanPhys - lc.a)).toBeGreaterThan(0.01)
  })
})
