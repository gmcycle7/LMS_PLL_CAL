import { readFileSync } from 'node:fs'
import { gammaEff, gosHarmonic, gosRationalBeta, loopH, loopImpulse, makeL1, makeL2, makeL3, nominalLoops, typeIReH } from '@/simulation/models/sspll'
import {
  gosCertificate,
  gosKernelMin,
  gosLipschitz,
  gosPartialSum,
  gosPointCertificate,
  gosTypeIPositive,
  harmonicNumber,
  harmonicTailWeight,
  harmonicWeight,
} from './gosTheorem'

/**
 * GOS「D = 0 不反號」定理（§7b）：TS port 與 Python golden（analysis/sspll/golden/sspll_golden/gos_certificate.py）逐項比對
 * results/gos_certificate.json（tools/gos_certificate.py 產生），並檢查證書每個零件自己的數學性質。
 * 容差：L_g、g_min、Λ_M、T_M 是同一組脈衝響應／格點的和，相對 1e-9；證書的 worst_lower 經過上千次加總，相對 1e-6；
 * 步數是浮點路徑的函數（每一步的 β 都由上一步的 LB 決定），允許差 2 步。
 */
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const GOLDEN: Json = JSON.parse(readFileSync(new URL('../../../analysis/sspll/golden/results/gos_certificate.json', import.meta.url), 'utf8'))
const LOOPS = nominalLoops()
const TWO_PI2 = 2 * Math.PI ** 2

function close(a: number, e: number, rel: number, abs = 0, label = ''): void {
  expect(Number.isFinite(a), label).toBe(true)
  expect(Math.abs(a - e), `${label}：${a} vs ${e}`).toBeLessThanOrEqual(abs + rel * Math.abs(e))
}

describe('GOS D = 0 定理：L1 的一行證明', () => {
  it('SSPLL: Re H_PD 的 closed form 在 0 < K < 2 時處處 ≥ 0（只有整數 f 為 0），所以每條諧波 ≥ 0、C(β) > 0', () => {
    const K = Number(LOOPS.L1.params.K)
    for (let j = 0; j <= 4000; j++) {
      const f = j / 8000
      const g = typeIReH(K, f)
      expect(g).toBeGreaterThanOrEqual(-1e-15)
      close(g, loopH(LOOPS.L1, f).re, 1e-10, 1e-13, `f=${f}`) // closed form 與有理函數同值
      if (j > 0) expect(g).toBeGreaterThan(0)
    }
    for (const b of [0.016, 0.123, 0.25, 0.5, 0.9]) {
      const r = gosTypeIPositive(K, b)
      expect(r.ok).toBe(true)
      expect(r.firstTerm).toBeGreaterThan(0)
      expect(r.partial).toBeGreaterThanOrEqual(r.firstTerm)
      const gp = GOLDEN.typeI.points[String(b)]
      if (gp) {
        close(r.firstTerm, gp.first_term, 1e-10, 0, `first ${b}`)
        close(r.partial, gp.partial, 1e-10, 0, `partial ${b}`)
      }
      // 和 §7 的 ergodic 諧波和（M = 8192 + 尾項）一致到 0.5%
      close(r.partial, gosHarmonic(b / 8, gammaEff(LOOPS.L1)), 5e-3, 0, `harmonic ${b}`)
    }
    expect(gosTypeIPositive(K, 0).ok).toBe(false) // β = 0：ρ ≡ 0，GOS 不可觀測
    expect(gosTypeIPositive(2.5, 0.3).ok).toBe(false) // K ≥ 2：closed form 不再 ≥ 0
    close(K, GOLDEN.typeI.K, 1e-12)
  })
})

describe('GOS D = 0 定理：證書的零件', () => {
  it('SSPLL: 權重 w_m 加總 1/12；H_M、T_M；截斷和 + 尾項權重 = 1/12', () => {
    let s = 0
    for (let m = 1; m <= 2_000_000; m++) s += harmonicWeight(m)
    close(s, 1 / 12, 1e-6)
    close(harmonicNumber(4), 25 / 12, 1e-14)
    for (const M of [4, 100, 1000]) {
      let p = 0
      for (let m = 1; m <= M; m++) p += harmonicWeight(m)
      close(p + harmonicTailWeight(M), 1 / 12, 1e-12, 0, `M=${M}`)
    }
  })

  it('SSPLL: L_g = 2πΣn|h[n]| 真的是 Re H_PD 斜率的上界（細格點的差分 ≤ L_g 且 ≥ 0.3 L_g）；留數展開重現 h[n]、尾項可忽略；數值與 golden 相同', () => {
    for (const key of ['L1', 'L2', 'L3'] as const) {
      const lip = gosLipschitz(LOOPS[key])
      expect(lip.tailBounded, key).toBe(true)
      expect(lip.residualErr).toBeLessThan(1e-10)
      expect(lip.tail).toBeLessThan(1e-30)
      const n = 400_001
      let slope = 0
      let prev = loopH(LOOPS[key], 0).re
      for (let j = 1; j < n; j++) {
        const g = loopH(LOOPS[key], (0.5 * j) / (n - 1)).re
        slope = Math.max(slope, Math.abs(g - prev))
        prev = g
      }
      slope /= 0.5 / (n - 1)
      expect(slope, key).toBeLessThanOrEqual(lip.Lg)
      expect(slope, key).toBeGreaterThanOrEqual(0.3 * lip.Lg)
      const g = GOLDEN.nominal[key].lipschitz
      close(lip.Lg, g.Lg, 1e-9, 0, `${key} Lg`)
      close(lip.sumN, g.sumN, 1e-9, 0, `${key} sumN`)
      close(lip.rhoMax, g.rho_max, 1e-9, 0, `${key} rho`)
    }
    close(gosLipschitz(LOOPS.L2).Lg, 49.0885, 1e-4)
    close(gosLipschitz(LOOPS.L3).Lg, 50.9714, 1e-4)
    // 反面：脈衝響應裡沒有 n = 0 那一項（它對斜率沒有貢獻），sumN 等於直接相加
    const h = loopImpulse(LOOPS.L2, 4097)
    let s = 0
    for (let k = 1; k <= 4096; k++) s += k * Math.abs(h[k])
    close(gosLipschitz(LOOPS.L2).sumN, s, 1e-14)
  })

  it('SSPLL: g_min 是下界（格點最小值減 L_g h/2，L2 在 83.8 MHz 附近 −0.2053）；截斷和 C_M 與有理數 β 的精確式在尾項之內', () => {
    const lip = gosLipschitz(LOOPS.L2)
    const km = gosKernelMin(LOOPS.L2, lip.Lg)
    close(km.gridMin, -0.20529, 0, 2e-5)
    close(km.fAtMin * 4000, 83.8, 0, 0.1)
    expect(km.gMin).toBeLessThan(km.gridMin)
    close(km.gMin, GOLDEN.nominal.L2.g_min, 1e-9)
    // β = a/b：Σ_{m≤M} 與 Σ_{k} 精確式的差不超過尾項的絕對上界 max|g|·T_M
    const gMax = 1.3
    for (const [a, b] of [
      [1, 3],
      [2, 7],
      [5, 17],
    ]) {
      const M = 4000
      const exact = gosRationalBeta(gammaEff(LOOPS.L2), a, b)
      const partial = gosPartialSum(LOOPS.L2, a / b, M)
      expect(Math.abs(exact - partial), `${a}/${b}`).toBeLessThanOrEqual(gMax * harmonicTailWeight(M))
    }
  })
})

describe('GOS D = 0 定理：證書（L2／L3 與密集掃描的迴路）', () => {
  it('SSPLL: 三個標稱迴路在 β ∈ [0.016, ½] 通過證書；L_g、Λ_M、g_min、T_M、最小下界與 golden 一致，步數差 ≤ 2', () => {
    for (const key of ['L1', 'L2', 'L3'] as const) {
      const r = gosCertificate(LOOPS[key])
      const g = GOLDEN.nominal[key]
      expect(r.ok, `${key}: ${r.reason}`).toBe(true)
      expect(g.ok).toBe(true)
      close(r.Lg, g.Lg, 1e-9, 0, `${key} Lg`)
      close(r.LamM, g.LamM, 1e-9, 0, `${key} LamM`)
      close(r.gMin, g.g_min, 1e-9, 0, `${key} gMin`)
      close(r.tailWeight, g.tail_weight, 1e-9, 0, `${key} TM`)
      close(r.worstLower, g.worst_lower, 1e-6, 0, `${key} worst`)
      close(r.worstAt, g.worst_at, 1e-9, 0, `${key} at`)
      expect(Math.abs(r.steps - g.steps), `${key} steps ${r.steps} vs ${g.steps}`).toBeLessThanOrEqual(2)
      close(r.LamM, (r.Lg * harmonicNumber(1000)) / TWO_PI2, 1e-14)
      expect(r.worstAt).toBe(0.016) // Type-II 的最小下界在 β_0（≈ β_0²/K_i）；L1 也是（單調上升）
    }
    // 數字（文件引用）：L2 最小下界 6.63e-3（12·LB ≈ 0.080）、L3 1.02e-2
    close(gosCertificate(LOOPS.L2).worstLower, 0.0066275, 2e-4)
    close(gosCertificate(LOOPS.L3).worstLower, 0.0102327, 2e-4)
  })

  it('SSPLL: 密集掃描的 8 個變形迴路（含兩個有反號帶的 Type-I）也通過；證書結果與 golden 相同', () => {
    const variants: [string, ReturnType<typeof makeL2>][] = [
      ['L2_pm45', makeL2({ pm: 45 })],
      ['L2_pm75', makeL2({ pm: 75 })],
      ['L2_lat2', makeL2({ pm: 60, lat: 2 })],
      ['L3_pm45', makeL3({ pmCt: 45 })],
      ['L3_pm55', makeL3({ pmCt: 55 })],
      ['L3_halfT', makeL3({ pmCt: 60, mapping: 'halfT' })],
      ['L1_lat5_band', makeL1({ lat: 5 })],
      ['L1_pole200M_band', makeL1({ fPoleHz: 200e6 })],
    ]
    for (const [name, loop] of variants) {
      const r = gosCertificate(loop)
      const g = GOLDEN.nominal[name]
      expect(r.ok, `${name}: ${r.reason}`).toBe(true)
      close(r.Lg, g.Lg, 1e-8, 0, `${name} Lg`)
      close(r.gMin, g.g_min, 1e-8, 0, `${name} gMin`)
      close(r.worstLower, g.worst_lower, 1e-5, 0, `${name} worst`)
      expect(Math.abs(r.steps - g.steps), `${name} steps`).toBeLessThanOrEqual(3)
    }
  })

  it('SSPLL: 更大的 M 把 β_0 往下推：L2 以 M = 16000 從 β = 2⁻¹⁰ 走到 ½（golden 的 extended），最小下界 ≈ β_0²/K_i', () => {
    const r = gosCertificate(LOOPS.L2, { betaMin: 2 ** -10, M: 16000 })
    const g = GOLDEN.extended.L2
    expect(r.ok, r.reason).toBe(true)
    close(r.worstLower, g.worst_lower, 1e-5)
    close(r.worstAt, 2 ** -10, 1e-12)
    close(r.worstLower, 2 ** -20 / Number(LOOPS.L2.params.Ki), 0.2)
    expect(Math.abs(r.steps - g.steps)).toBeLessThanOrEqual(5)
  }, 60_000)

  it('SSPLL: 反面——相關器晚一拍（D = 1）的 kernel：β = 1/64 的精確值為負，證書在第一個格點就失敗（不會說 ok）', () => {
    const d1 = gammaEff(LOOPS.L2, 'D:1')
    expect(gosRationalBeta(d1, 1, 64)).toBeLessThan(0)
    // 同一套零件直接套在 D = 1 的 kernel 上：單點下界為負
    const M = 1000
    let partial = 0
    for (let m = 1; m <= M; m++) partial += harmonicWeight(m) * d1((m * 0.016) % 1).re
    let gMin = 0
    for (let j = 0; j <= 200000; j++) gMin = Math.min(gMin, d1(j / 400000).re)
    expect(partial + gMin * harmonicTailWeight(M)).toBeLessThan(0)
    // 證書的失敗模式之一：步數上限（maxSteps）——不會卡住
    const tiny = gosCertificate(LOOPS.L2, { maxSteps: 3 })
    expect(tiny.ok).toBe(false)
    expect(tiny.reason).toMatch(/超過 3 步/)
  })
})

describe('GOS D = 0 定理：單點證書（HC-CS.10）與 β < β_0 的漸近段', () => {
  it('SSPLL: L2、β = 0.25、M = 4：前四項、尾項權重、下界與 Lipschitz 半徑和 golden 相同；下界不超過精確值', () => {
    const p = gosPointCertificate(LOOPS.L2, 0.25, 4)
    const g = GOLDEN.points['0.25']
    expect(p.terms).toHaveLength(4)
    p.terms.forEach((t, i) => {
      close(t.f, g.terms[i].f, 1e-12, 1e-15, `f${i}`)
      close(t.g, g.terms[i].g, 1e-10, 1e-15, `g${i}`)
      close(t.w, g.terms[i].w, 1e-12, 0, `w${i}`)
    })
    close(p.CM, g.CM, 1e-10)
    close(p.tailWeight, (Math.PI ** 2 / 6 - (1 + 1 / 4 + 1 / 9 + 1 / 16)) / TWO_PI2, 1e-12)
    close(p.tailLower, g.tail_lower, 1e-9)
    close(p.lower, g.lower, 1e-9)
    close(p.LamM, g.LamM, 1e-9)
    close(p.delta, g.delta, 1e-9)
    expect(p.lower).toBeGreaterThan(0)
    expect(p.delta).toBeGreaterThan(0.01)
    for (const b of [0.25, 0.3, 0.123, 0.05]) {
      const q = gosPointCertificate(LOOPS.L2, b, 4)
      const exact = gosHarmonic(b / 8, gammaEff(LOOPS.L2))
      expect(q.lower, `β=${b}`).toBeLessThanOrEqual(exact + 1e-12)
      close(q.lower, GOLDEN.points[String(b)].lower, 1e-9, 0, `point ${b}`)
    }
  })

  it('SSPLL: β < β_0：精確諧波和與漸近式 β²/K_i 的比值在 β ≤ 1/64 時都在 1 ± 1% 內（golden 的 asymptote_ratio）', () => {
    const Ki = Number(LOOPS.L2.params.Ki)
    close(Ki, GOLDEN.asymptote_ratio.Ki, 1e-12)
    for (const [b, row] of Object.entries(GOLDEN.asymptote_ratio.rows as Record<string, Json>)) {
      const beta = 1 / Number(b)
      const C = gosHarmonic(beta / 8, gammaEff(LOOPS.L2), 200000)
      close(C, row.C, 1e-8, 0, `C ${b}`)
      close(C / (beta * beta / Ki), 1, 0, 0.01, `ratio ${b}`)
    }
  })
})
