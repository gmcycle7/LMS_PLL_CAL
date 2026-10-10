import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, inputError, randomValues, renderTex } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { presetById } from '@/app/presets'
import { cAbs, cArg } from '@/simulation/core'
import { freqz } from '@/simulation/signal'
import {
  analyticCorr,
  analyzeFxLab,
  averagingPenalty,
  bestToneDelay,
  buildHat,
  calPole,
  calTimeConstant,
  delayToleranceRad,
  HAT_EXACT,
  kqFromSigma,
  multiToneCorr,
  multiToneCorrFiltered,
  normalizedCorr,
  pathStability,
  pathTransfer,
  runFxComparison,
  secondDiffResponse,
  toneCorrCodeDelay,
  toneCorrErrorDelay,
  type FxCodeSpec,
  type FxPathSpec,
} from '@/simulation/models/filteredX'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { parseLabPreset, toCaseSpec, toCodeSpec, toFxScenario, toHatSpec, toPathSpec } from './experiments/labState'

// 多個測試行程同時執行時 CPU 可能嚴重超額：閉迴路模擬與 jsdom 渲染給足夠的時間（預設只有 5 秒）
vi.setConfig({ testTimeout: 120_000 })

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
}
const T07 = JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', 'T07.json'), 'utf8')) as Vector
const T07_TOL = T07.tolerance.abs ?? 1e-12

function hc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到 ${id}`)
  return def
}
const vals = (sol: HandCalcSolution): number[] => sol.results.map((r) => r.value)
/** 把角度（度）折回 (−180°, 180°]（測試自己的實作，不呼叫模型） */
function wrap(deg: number): number {
  let w = ((deg % 360) + 360) % 360
  if (w > 180) w -= 360
  return w
}
/** 角度相等（mod 360°；避免 ±180° 邊界上的浮點分歧） */
function expectAngle(actual: number, expected: number, tol = 1e-7): void {
  expect(Math.abs(wrap(actual - expected))).toBeLessThan(tol)
}
const KQ = (sigma: number) => Math.sqrt(2 / Math.PI) / sigma

/** 所有 `$...$` 片段與獨立 TeX 都能被 KaTeX 解析 */
function expectTexOk(tex: string, where: string): void {
  const html = renderTex(tex, true)
  expect(html.includes('katex-error') || html.includes('c-tex-error'), `${where}: ${tex}`).toBe(false)
}
function expectMathTextOk(text: string, where: string): void {
  // 每個 $ 都要成對
  expect((text.replace(/\\\$/g, '').match(/\$/g) ?? []).length % 2, `${where}（$ 未成對）: ${text}`).toBe(0)
  for (const m of text.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)) expectTexOk(m[1], where)
}
function expectSolutionTexOk(def: HandCalcDef, sol: HandCalcSolution, tag: string): void {
  expect(sol.steps.length, `${def.id} ${tag}`).toBeGreaterThan(0)
  sol.steps.forEach((s, i) => {
    expectTexOk(s.tex, `${def.id} ${tag} step ${i + 1}`)
    expectMathTextOk(s.why, `${def.id} ${tag} why ${i + 1}`)
    // 步驟內不得出現未清掉的浮點尾巴或非有限數
    expect(s.tex, `${def.id} ${tag} step ${i + 1}`).not.toMatch(/NaN|Infinity|undefined|\\infty|\d{9,}/)
  })
  sol.results.forEach((r) => {
    expectTexOk(`${r.symbol} = 1${r.unit ? `\\ ${r.unit}` : ''}`, `${def.id} ${tag} result`)
    if (r.label) expectMathTextOk(r.label, `${def.id} ${tag} result label`)
  })
  for (const n of sol.notes ?? []) {
    expectMathTextOk(n, `${def.id} ${tag} note`)
    expect(n, `${def.id} ${tag} note`).not.toMatch(/NaN|Infinity|undefined/)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 測試內的獨立重算（只用 Math.*，不呼叫 filteredX.ts）
// ─────────────────────────────────────────────────────────────────────────────

type V = Record<string, number>
const INDEPENDENT: Record<string, (v: V) => number[]> = {
  'HC-07.1': ({ phi, omega, D }) => {
    const theta = wrap(phi + omega * D)
    return [theta, 90 - Math.abs(theta)]
  },
  'HC-07.2': ({ A, mag, phi, omega, D }) => [
    wrap(phi + omega * D),
    ((A * A) / 2) * mag * Math.cos((phi + omega * D) * RAD),
    ((A * A) / 2) * mag * Math.cos((phi - omega * D) * RAD),
  ],
  'HC-07.3': ({ phi, omega }) => {
    const omDeg = omega * DEG
    const dStar = ((((-phi) % 360) + 360) % 360) / omDeg
    // F-07.4 的手算規則：取最接近 D* 的整數（剛好 .5 時取較小的）
    const lo = Math.floor(dStar + 1e-9)
    const D = dStar - lo <= 0.5 + 1e-9 ? lo : lo + 1
    const out = [dStar, D, wrap(phi + omDeg * D)]
    if (D >= 1) out.push(Math.PI / (2 * D))
    return out
  },
  'HC-07.4': ({ mag1, phi1, om1, mag2, phi2, om2, D }) => {
    const p1 = 0.5 * mag1 * Math.cos(phi1 * RAD + om1 * D)
    const p2 = 0.5 * mag2 * Math.cos(phi2 * RAD + om2 * D)
    return [p1, p2, p1 + p2]
  },
  'HC-07.5': ({ A, mag, phi, omega, D }) => {
    const cosT = Math.cos((phi + omega * D) * RAD)
    const out = [((A * A) / 2) * mag * cosT, ((A * A) / 2) * mag * mag, cosT]
    if (cosT > 0) out.push(1 / (cosT * cosT))
    return out
  },
  'HC-07.6': ({ mag, ratio, omega, Delta, mu, sigmaV }) => {
    const E = mag * (ratio * mag) * Math.cos(omega * Delta * RAD)
    return [E, 1 - mu * KQ(sigmaV) * E, 1 - mu * KQ(sigmaV) * mag * mag]
  },
  'HC-07.7': ({ wnTs, zeta, d, omega }) => {
    // 複數以 [re, im] 表示：H = ∇²/(∇² + (K_i + K_p∇)·e^{−j(1+d)Ω})，Ĥ₂ = K₂∇²
    type C = [number, number]
    const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
    const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]]
    const div = (a: C, b: C): C => {
      const m = b[0] * b[0] + b[1] * b[1]
      return [(a[0] * b[0] + a[1] * b[1]) / m, (a[1] * b[0] - a[0] * b[1]) / m]
    }
    const om = omega * RAD
    const Kp = 2 * zeta * wnTs
    const Ki = wnTs * wnTs
    const nab: C = [1 - Math.cos(om), Math.sin(om)]
    const nab2 = mul(nab, nab)
    const z: C = [Math.cos((1 + d) * om), -Math.sin((1 + d) * om)]
    const den = add(nab2, mul(add([Ki, 0], [Kp * nab[0], Kp * nab[1]]), z))
    const H = div(nab2, den)
    const H2: C = [nab2[0] / Ki, nab2[1] / Ki]
    return [H[0], H[1], H[0] * H2[0] + H[1] * H2[1]]
  },
  'HC-07.8': ({ mag, phi, omega, D, mu, sigmaV }) => {
    const Craw = mag * Math.cos(phi * RAD)
    const CD = mag * Math.cos((phi + omega * D) * RAD)
    const Eu2 = mag * mag
    const k = mu * KQ(sigmaV)
    return [Craw, CD, Eu2, 1 - k * Craw, 1 - k * CD, 1 - k * Eu2]
  },
}
/** 哪幾個結果是角度（以 mod 360° 比較） */
const ANGLE_RESULTS: Record<string, number[]> = { 'HC-07.1': [0], 'HC-07.2': [0], 'HC-07.3': [2] }

function expectMatchesIndependent(def: HandCalcDef, v: V, tag: string): void {
  const got = vals(def.solve(v))
  const want = INDEPENDENT[def.id](v)
  expect(got.length, `${def.id} ${tag}：結果數`).toBe(want.length)
  got.forEach((g, i) => {
    expect(Number.isFinite(g), `${def.id} ${tag} result ${i}`).toBe(true)
    if (ANGLE_RESULTS[def.id]?.includes(i)) expectAngle(g, want[i])
    else expect(Math.abs(g - want[i]), `${def.id} ${tag} result ${i}: ${g} vs ${want[i]}（${JSON.stringify(v)}）`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want[i])))
  })
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Ch07 handcalcs：登錄資料', () => {
  it('8 題、ID 為 HC-07.1…HC-07.8、頁面 /ch/07、公式 ID 都登錄在 FORMULAS、難度有分層', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-07.1', 'HC-07.2', 'HC-07.3', 'HC-07.4', 'HC-07.5', 'HC-07.6', 'HC-07.7', 'HC-07.8'])
    const formulaIds = FORMULAS.map((f) => f.id)
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/07')
      expect(formulaIds, h.id).toContain(h.formulaId)
      expectTexOk(h.formulaTex, `${h.id} formulaTex`)
      expectMathTextOk(h.title, `${h.id} title`)
      for (const t of h.tips ?? []) expectMathTextOk(t, `${h.id} tip`)
      for (const i of h.inputs) {
        expectTexOk(i.symbol, `${h.id} input ${i.key}`)
        expectMathTextOk(i.label, `${h.id} input label ${i.key}`)
        if (i.unit) expectTexOk(i.unit, `${h.id} unit ${i.key}`)
        expect(i.practice, `${h.id} ${i.key} 要有 practice 範圍`).toBeDefined()
      }
      expect(h.validate?.(defaultValues(h)) ?? null, `${h.id}：預設值必須合法`).toBeNull()
    }
    const levels = HANDCALCS.map((h) => h.level)
    expect(levels.filter((l) => l === 'beginner').length).toBeGreaterThanOrEqual(2)
    expect(levels.filter((l) => l === 'engineer').length).toBeGreaterThanOrEqual(3)
    expect(levels).toContain('research')
  })

  it('beginner 題的步驟不含三角函數、開根號或對數（只有四則運算）', () => {
    for (const h of HANDCALCS.filter((d) => d.level === 'beginner')) {
      for (const seed of [0, ...SEEDS.slice(0, 5)]) {
        const v = seed === 0 ? defaultValues(h) : randomValues(h, seed)
        for (const s of h.solve(v).steps) expect(s.tex, `${h.id}: ${s.tex}`).not.toMatch(/\\cos|\\sin|\\tan|\\sqrt|\\ln|\\log|\\arc/)
      }
    }
  })
})

describe('Ch07 handcalcs：(a) 預設值 = 模型函式／本文 worked example／golden vector', () => {
  it('T07: HC-07.1 的預設值（φ = −120°、Ω = 30°、D = 4）⇒ θ = 0°、M_pol = 90°（golden T07.json）；D = 0…11 的 θ 與 7.1 節掃描表一致', () => {
    const def = hc('HC-07.1')
    const [theta, M] = vals(def.solve(defaultValues(def)))
    expect(Math.abs(theta - (T07.expected.theta_deg as number))).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(M - (T07.expected.polarity_margin_deg as number))).toBeLessThanOrEqual(1e-9)
    // 掃描表：有效的是 D ∈ {2,…,6}；D = 1、7 時 M_pol = 0
    const margins = (T07.inputs.D_list as number[]).map((D) => vals(def.solve({ phi: -120, omega: 30, D }))[1])
    expect(margins.map((m) => Math.sign(m))).toEqual([-1, 0, 1, 1, 1, 1, 1, 0, -1, -1, -1, -1])
    // 對照（延遲 error）出現在 notes：D = 4 時 θ′ = 120°
    expect(def.solve(defaultValues(def)).notes?.join('')).toContain('120^\\circ')
  })

  it('T07: HC-07.2 的 C_D 對 D = 0…11 逐一等於 golden C_D_list（φ = −120°）與 misaligned_C_D_list_phi0（φ = 0）；C′_4 = −0.25', () => {
    const def = hc('HC-07.2')
    const d0 = defaultValues(def)
    expect(d0).toMatchObject({ A: T07.inputs.A, mag: T07.inputs.H_mag, phi: T07.inputs.phi_deg, D: T07.inputs.D })
    expect(d0.omega * RAD).toBeCloseTo(T07.inputs.Omega_rad as number, 14)
    const [theta, C, CE] = vals(def.solve(d0))
    expect(Math.abs(theta)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(C - (T07.expected.C_D as number))).toBeLessThanOrEqual(T07_TOL)
    expect(CE).toBeCloseTo(-0.25, 12)
    const list = T07.expected.C_D_list as number[]
    const mis = T07.expected.misaligned_C_D_list_phi0 as number[]
    ;(T07.inputs.D_list as number[]).forEach((D, i) => {
      expect(Math.abs(vals(def.solve({ ...d0, D }))[1] - list[i]), `D = ${D}`).toBeLessThanOrEqual(T07_TOL)
      expect(Math.abs(vals(def.solve({ ...d0, phi: 0, D }))[1] - mis[i]), `phi = 0, D = ${D}`).toBeLessThanOrEqual(T07_TOL)
    })
    // 與模型函式逐一相同（含延遲 error 的版本）
    const tone = { A: 1, mag: 1, phiRad: -120 * RAD, omega: Math.PI / 6 }
    for (let D = 0; D <= 11; D++) {
      const [, c, ce] = vals(def.solve({ ...d0, D }))
      expect(c).toBeCloseTo(toneCorrCodeDelay(tone, D), 12)
      expect(ce).toBeCloseTo(toneCorrErrorDelay(tone, D), 12)
    }
  })

  it('HC-07.2 的步驟編號與 7.2 節內文的引用一致：第 5 步是 C_4 = 0.5、第 8 步是 C′_4 = −0.25', () => {
    const sol = hc('HC-07.2').solve(defaultValues(hc('HC-07.2')))
    expect(sol.steps).toHaveLength(8)
    expect(sol.steps[4].tex).toBe(String.raw`C_D = \frac{A^2}{2}\,|H|\cos\theta = 0.5\times1\times1 = 0.5`)
    expect(sol.steps[7].tex).toBe(String.raw`C'_D = \frac{A^2}{2}\,|H|\cos\theta' = 0.5\times1\times(-0.5) = -0.25`)
    const prose = readFileSync(resolve(process.cwd(), 'src/chapters/ch07/sections/S2DelayDerivation.tsx'), 'utf8')
    expect(prose).toContain('手算題 HC-07.2 的第 5 步與第 8 步')
  })

  it('T07: HC-07.3 代入 T07（φ = −120°、Ω = π/6）⇒ D = best_D = 4、θ = 0°、容許頻偏 π/8 = 22.5°', () => {
    const [dStar, D, theta, tol] = vals(hc('HC-07.3').solve({ phi: -120, omega: Math.PI / 6 }))
    expect(dStar).toBeCloseTo(4, 10)
    expect(D).toBe(T07.expected.best_D)
    expect(Math.abs(theta)).toBeLessThanOrEqual(1e-9)
    expect(tol * DEG).toBeCloseTo(22.5, 10)
  })

  it('HC-07.3 的預設值重現 7.3 節 Type-II 例子：∠H = 155.378°、D* ≈ 119.04、D = 119（bestToneDelay／freqz）', () => {
    const def = hc('HC-07.3')
    const H = pathTransfer({ kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 })
    const z = freqz(H.b, H.a, [0.03])[0]
    const best = bestToneDelay(cArg(z), 0.03, 400)
    const d0 = defaultValues(def)
    expect(d0.phi).toBeCloseTo(cArg(z) * DEG, 3)
    expect(d0.phi).toBe(155.378)
    expect(d0.omega).toBe(0.03)
    const [dStar, D, theta, tol] = vals(def.solve(d0))
    expect(D).toBe(best.D)
    expect(D).toBe(119)
    expect(dStar).toBeCloseTo(best.continuous, 3)
    expect(dStar).toBeCloseTo(119.04, 2)
    expect(theta).toBeCloseTo(best.thetaDeg, 3)
    expect(tol).toBeCloseTo(delayToleranceRad(119), 14)
    // 思考題 1：φ = −90°、Ω = 45° ⇒ D = 2
    expect(vals(def.solve({ phi: -90, omega: 45 * RAD }))[1]).toBe(2)
  })

  it('HC-07.4 的預設值重現 7.3 節多頻表「對 tone 1 對齊（D = 119）」那一列：tone 2 的貢獻為負、總和 < 0（multiToneCorr）', () => {
    const def = hc('HC-07.4')
    const d0 = defaultValues(def)
    const H = pathTransfer({ kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 })
    const tones = [
      { A: 1, omega: 0.03 },
      { A: 1, omega: 0.05 },
    ]
    const info = multiToneCorr({ tones, h: H, D: 119 })
    // 預設輸入 = 模型的 |H_i|、φ_i 取到本文表格顯示的位數
    expect(d0).toMatchObject({ om1: 0.03, om2: 0.05, D: 119 })
    expect(d0.mag1).toBeCloseTo(info.mags[0], 4)
    expect(d0.mag2).toBeCloseTo(info.mags[1], 4)
    expect(d0.phi1).toBeCloseTo(info.phasesDeg[0], 2)
    expect(d0.phi2).toBeCloseTo(info.phasesDeg[1], 2)
    const sol = def.solve(d0)
    const [p1, p2, total] = vals(sol)
    // 捨入後的輸入造成的差異 < 1e-4（表格顯示 5 位小數）
    expect(Math.abs(p1 - info.parts[0])).toBeLessThan(1e-4)
    expect(Math.abs(p2 - info.parts[1])).toBeLessThan(1e-4)
    expect(Math.abs(total - info.total)).toBeLessThan(1e-4)
    expect(p1).toBeGreaterThan(0)
    expect(p2).toBeLessThan(0)
    expect(total).toBeLessThan(0)
    // 用完整精度的輸入則與 multiToneCorr 完全相同
    const exact = vals(def.solve({ ...d0, mag1: info.mags[0], phi1: info.phasesDeg[0], mag2: info.mags[1], phi2: info.phasesDeg[1] }))
    expect(exact[0]).toBeCloseTo(info.parts[0], 12)
    expect(exact[1]).toBeCloseTo(info.parts[1], 12)
    expect(exact[2]).toBeCloseTo(info.total, 12)
    // notes 的 filtered-x 對照值 = multiToneCorrFiltered（Ĥ = H）
    const fx = multiToneCorrFiltered({ tones, h: H, hHat: H })
    expect(fx).toBeGreaterThan(0)
    expect(sol.notes?.join('')).toContain(fx.toPrecision(3).slice(0, 5))
  })

  it('T07: HC-07.5 的預設值（D = 2）⇒ C_2 = golden C_D_list[2] = 0.25、E[u²] = 0.5、ρ = 0.5、N 要 4 倍；ρ 與 Lab 的 rhoActive 一致', () => {
    const def = hc('HC-07.5')
    const d0 = defaultValues(def)
    const [C, Eu2, rho, pen] = vals(def.solve(d0))
    expect(Math.abs(C - (T07.expected.C_D_list as number[])[2])).toBeLessThanOrEqual(T07_TOL)
    expect(Eu2).toBeCloseTo(0.5, 12)
    expect(rho).toBeCloseTo(0.5, 12)
    expect(pen).toBeCloseTo(4, 10)
    expect(pen).toBeCloseTo(averagingPenalty(rho), 12)
    // ρ 與 A、|H| 無關
    expect(vals(def.solve({ ...d0, A: 2, mag: 0.5 }))[2]).toBeCloseTo(0.5, 12)
    // Lab 的即時分析（同一段 code 的時間平均）：delayed-x、D = 2 的 ρ ≈ 0.5
    const an = analyzeFxLab({
      path: { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: Math.PI / 6 },
      code: { kind: 'sinusoid', omega: Math.PI / 6 },
      mode: 'delayed',
      D: 2,
      hat: HAT_EXACT,
      seed: 1,
      Dmax: 11,
    })
    expect(an.rhoActive).toBeCloseTo(rho, 3)
    expect(an.rhoActive).toBeCloseTo(normalizedCorr(an.corr.active.empirical, an.ExRef2, an.Eu2.empirical), 12)
  })

  it('HC-07.6 的預設值重現 7.5 節失效表的 Δ = 4 那一列（E[u·u_f] = −0.5、p_f = 1.03989、誤用 E[u²] 得 0.92021），Δ = 0…6 逐列與 buildHat + analyticCorr 相同', () => {
    const def = hc('HC-07.6')
    const d0 = defaultValues(def)
    const [E, pf, pw] = vals(def.solve(d0))
    expect(E).toBeCloseTo(-0.5, 12)
    expect(pf).toBeCloseTo(1.03989, 5)
    expect(pw).toBeCloseTo(0.92021, 5)
    // 與 S5Mismatch 的表格相同的呼叫
    const path: FxPathSpec = { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: Math.PI / 6 }
    const code: FxCodeSpec = { kind: 'sinusoid', omega: Math.PI / 6 }
    const H = pathTransfer(path)
    for (let Delta = 0; Delta <= 6; Delta++) {
      const c = analyticCorr({ code, h: H, g: buildHat(path, { ...HAT_EXACT, extraDelay: Delta }, code).full, D: 0 }) as number
      const got = vals(def.solve({ ...d0, Delta }))
      expect(got[0]).toBeCloseTo(c, 12)
      expect(got[1]).toBeCloseTo(1 - 10 * kqFromSigma(100) * c, 12)
      expect(got[2]).toBeCloseTo(pw, 12) // 誤用 E[u²] 的 pole 與 Δ 無關
    }
    // 思考題 2：Δ = 3 ⇒ E[u·u_f] = 0、p_f = 1
    expect(vals(def.solve({ ...d0, Delta: 3 }))).toEqual([0, 1, pw])
    // 增益誤差只改變大小、不改變符號
    expect(vals(def.solve({ ...d0, ratio: 2 }))[0]).toBeCloseTo(-1, 12)
    expect(vals(def.solve({ ...d0, ratio: 0.5, Delta: 1 }))[0]).toBeCloseTo(0.5 * Math.cos(Math.PI / 6), 12)
  })

  it('HC-07.6／HC-07.8 的 pole 與閉迴路模擬（runBlockLms）的 analytic 欄位一致：preset「E45：Ĥ 多算 latency」與 Gallery #4', () => {
    const run = (id: string) => {
      const parsed = parseLabPreset(presetById(id)?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
      const res = runFxComparison({
        scenario: toFxScenario({ ...parsed.scenario, blocks: 40 }, parsed.seed ?? 1),
        cases: parsed.cases.map((c, i) => ({ id: 'ABC'[i], spec: toCaseSpec(c) })),
      })
      return { parsed, res }
    }
    // E45 preset：Case C 是 Ĥ = H·z⁻⁴
    const lat = run('filtered-x-latency-mismatch')
    const s = lat.parsed.scenario
    const [E, pf] = vals(hc('HC-07.6').solve({ mag: s.mag, ratio: 1, omega: s.omega * DEG, Delta: lat.parsed.cases[2].extraDelay, mu: lat.parsed.cases[2].mu, sigmaV: s.sigmaV }))
    const c = lat.res.cases[2].analytic
    expect(c.Cest).toBeCloseTo(E, 2) // blockLms 的 C 是同一段 code 的估計值
    expect(c.p).toBeCloseTo(pf, 3)
    // Gallery #4：A raw-x、B delayed-x（D = 4）、C filtered-x
    const g4 = run('delay-phi-m120-d4')
    const sc = g4.parsed.scenario
    const got = vals(hc('HC-07.8').solve({ mag: sc.mag, phi: sc.phiDeg, omega: sc.omega * DEG, D: g4.parsed.cases[1].D, mu: g4.parsed.cases[1].mu, sigmaV: sc.sigmaV }))
    g4.res.cases.forEach((cs, i) => {
      expect(cs.analytic.Cest, `Case ${cs.id} C`).toBeCloseTo(got[i], 2)
      expect(cs.analytic.p, `Case ${cs.id} p`).toBeCloseTo(got[3 + i], 3)
      // 手算題用的 calPole／calTimeConstant 與 runBlockLms 的公式相同（代入同一個 C）
      const mine = calPole(cs.mu, sc.sigmaV, cs.analytic.Cest)
      expect(mine.Kq).toBeCloseTo(cs.analytic.Kq, 15)
      expect(mine.g).toBeCloseTo(cs.analytic.g, 12)
      expect(mine.p).toBeCloseTo(cs.analytic.p, 12)
      if (cs.analytic.p > 0 && cs.analytic.p < 1) expect(calTimeConstant(mine.p)).toBeCloseTo(cs.analytic.tauBlocks, 9)
      else expect(calTimeConstant(mine.p)).toBe(Infinity)
    })
  })

  it('HC-07.7 的預設值重現思考題 3／preset「二次差分在中頻 tone 失效」：∠H = 16.3°、相位差 −133.7°、E[u·u_f] = −19.9（analyzeFxLab）', () => {
    const def = hc('HC-07.7')
    const parsed = parseLabPreset(presetById('filtered-x-second-diff-hf-fail')?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
    const s = parsed.scenario
    const d0 = defaultValues(def)
    expect(d0).toMatchObject({ wnTs: s.wnTs, zeta: s.zeta, d: s.loopDelay })
    expect(d0.omega * RAD).toBeCloseTo(s.omega, 14)
    const an = analyzeFxLab({ path: toPathSpec(s), code: toCodeSpec(s), mode: parsed.cases[1].mode, D: 0, hat: toHatSpec(parsed.cases[1]), seed: 1, Dmax: 8 })
    const sol = def.solve(d0)
    const [re, im, E] = vals(sol)
    expect(re).toBeCloseTo(an.tone?.H.re as number, 12)
    expect(im).toBeCloseTo(an.tone?.H.im as number, 12)
    expect(E).toBeCloseTo(an.corr.filtered.analytic as number, 9)
    expect(E).toBeCloseTo(-19.9, 1)
    expect(Math.atan2(im, re) * DEG).toBeCloseTo(16.3, 1)
    expect(re * re + im * im).toBeCloseTo(an.Eu2.analytic as number, 10) // E[u²] = 1.156
    // notes 的極座標對照：∠Ĥ₂ = 150°、相位差 −133.7°（= Lab 的殘餘相位 θ）
    expect(an.tone?.thetaDeg).toBeCloseTo(-133.7, 1)
    const notes = sol.notes?.join('') ?? ''
    expect(notes).toContain('150^\\circ')
    expect(notes).toContain('-133.7^\\circ')
    // 最後一步 = |H||Ĥ₂|cos(相位差)
    const H2 = secondDiffResponse(s.omega, 100)
    expect(E).toBeCloseTo(Math.hypot(re, im) * cAbs(H2) * Math.cos((an.tone?.thetaDeg as number) * RAD), 9)
    // 低頻 tone（Ω = 0.03 rad）：二次差分的極性是對的（preset「二次差分（低頻 tone）」的 0.00740）
    expect(vals(def.solve({ ...d0, omega: 0.03 * DEG }))[2]).toBeCloseTo(0.0074, 4)
  })

  it('T07: HC-07.8 的預設值 = Lab 預設（Gallery #4）的解析值：C_raw = −0.5、C_4 = +1、E[u²] = 1（unit power = golden 的 2 倍）；p = 1.03989／0.92021／0.92021', () => {
    const def = hc('HC-07.8')
    const d0 = defaultValues(def)
    const parsed = parseLabPreset(presetById('delay-phi-m120-d4')?.params) as NonNullable<ReturnType<typeof parseLabPreset>>
    const s = parsed.scenario
    expect(d0).toMatchObject({ mag: s.mag, phi: s.phiDeg, D: parsed.cases[1].D, mu: parsed.cases[1].mu, sigmaV: s.sigmaV })
    expect(d0.omega * RAD).toBeCloseTo(s.omega, 14)
    const an = analyzeFxLab({ path: toPathSpec(s), code: toCodeSpec(s), mode: 'delayed', D: parsed.cases[1].D, hat: HAT_EXACT, seed: parsed.seed ?? 1, Dmax: 11 })
    const [Craw, CD, Eu2, pr, pd, pf] = vals(def.solve(d0))
    expect(Craw).toBeCloseTo(an.corr.raw.analytic as number, 12)
    expect(CD).toBeCloseTo(an.corr.delayed.analytic as number, 12)
    expect(Eu2).toBeCloseTo(an.Eu2.analytic as number, 12)
    // unit power（A = √2）是 golden（A = 1）的 2 倍
    const list = T07.expected.C_D_list as number[]
    expect(Math.abs(Craw - 2 * list[0])).toBeLessThanOrEqual(1e-11)
    expect(Math.abs(CD - 2 * (T07.expected.C_D as number))).toBeLessThanOrEqual(1e-11)
    expect(pr).toBeCloseTo(1.03989, 5)
    expect(pd).toBeCloseTo(0.92021, 5)
    expect(pf).toBeCloseTo(0.92021, 5)
    // 7.1 節（A = 1）的 pole：C 減半 ⇒ 1.01995 與 0.96011
    expect(calPole(10, 100, list[0]).p).toBeCloseTo(1.01995, 5)
    expect(calPole(10, 100, 0.5).p).toBeCloseTo(0.96011, 5)
    expect(calTimeConstant(calPole(10, 100, 0.5).p)).toBeCloseTo(24.6, 1)
  })

  it('每一題的預設值：solve() = 測試內的獨立重算', () => {
    for (const def of HANDCALCS) expectMatchesIndependent(def, defaultValues(def), 'defaults')
  })
})

describe('Ch07 handcalcs：(b) 換一題（randomValues）20 個 seed', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：結果有限、等於獨立重算、輸入落在合法範圍、所有 TeX 可渲染', (_id, def) => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, `${def.id} seed ${seed}`).toBeNull()
      for (const i of def.inputs) {
        expect(Number.isFinite(v[i.key])).toBe(true)
        if (i.min !== undefined) expect(v[i.key]).toBeGreaterThanOrEqual(i.min)
        if (i.max !== undefined) expect(v[i.key]).toBeLessThanOrEqual(i.max)
        if (i.integer) expect(Number.isInteger(v[i.key])).toBe(true)
      }
      expectMatchesIndependent(def, v, `seed ${seed}`)
      const sol = def.solve(v)
      expectSolutionTexOk(def, sol, `seed ${seed}`)
      // 正確答案一定通過自己的容許誤差；差 10% 的答案不通過（避免容許誤差設得太鬆）
      for (const r of sol.results) {
        expect(checkAnswer(r.value, r).ok).toBe(true)
        if (Math.abs(r.value) > 1) expect(checkAnswer(r.value * 1.1, r).ok, `${def.id} ${r.symbol} = ${r.value}`).toBe(false)
      }
    }
    // 真的有在換題目（不是每次都退回預設值）
    expect(seen.size).toBeGreaterThanOrEqual(10)
  })

  it('HC-07.3：φ、Ω 的格點掃描——|θ| ≤ Ω/2；模型的 bestToneDelay（第一個週期內的暴力搜尋）找到不同的 D 時，notes 會說明', () => {
    const def = hc('HC-07.3')
    let differs = 0
    for (const phi of [-180, -150, -91, -45, -5, 0, 3, 9, 45, 90, 155.378, 180]) {
      for (const omega of [0.02, 0.03, 0.1, Math.PI / 12, Math.PI / 6, 0.5, 1, 2, 3]) {
        const v = { phi, omega }
        expectMatchesIndependent(def, v, `phi=${phi}, omega=${omega}`)
        const sol = def.solve(v)
        expectSolutionTexOk(def, sol, `phi=${phi}, omega=${omega}`)
        const [, D, theta] = vals(sol)
        expect(Math.abs(theta), `phi=${phi}, omega=${omega}`).toBeLessThanOrEqual((omega * DEG) / 2 + 1e-9)
        // 暴力搜尋第一個週期內 cos 最大的整數（相等時取較小的）——與模型的 bestToneDelay 相同
        let bestD = 0
        let bestCos = -Infinity
        for (let k = 0; k <= Math.ceil((2 * Math.PI) / omega); k++) {
          const c = Math.cos(phi * RAD + omega * k)
          if (c > bestCos + 1e-12) {
            bestCos = c
            bestD = k
          }
        }
        expect(bestToneDelay(phi * RAD, omega, Infinity).D).toBe(bestD)
        // 模型的選擇不會比「最接近 D*」差；兩者不同時 notes 要指出模型（Lab）的 D
        expect(bestCos).toBeGreaterThanOrEqual(Math.cos(theta * RAD) - 1e-12)
        const mentions = (sol.notes ?? []).some((n) => n.includes('整數最佳'))
        expect(mentions, `phi=${phi}, omega=${omega}`).toBe(bestD !== D)
        if (bestD !== D) differs++
      }
    }
    expect(differs).toBeGreaterThan(0)
    // 整數週期（12 samples）、φ 略為超前：round(D*) = 12 與 D = 0 相位相同（少繞一圈）
    const sol = def.solve({ phi: 9, omega: Math.PI / 6 })
    expect(vals(sol)).toEqual([expect.closeTo(11.7, 9), 12, expect.closeTo(9, 9), expect.closeTo(Math.PI / 24, 12)])
    expect(sol.notes?.join('')).toContain('只差整數圈')
    // Ω 很大（格點很粗）：φ = −45°、Ω = 1 rad ⇒ round(D*) = 1（θ ≈ 12.3°），模型在 D = 7 找到 θ ≈ −3.9°
    const coarse = def.solve({ phi: -45, omega: 1 })
    expect(vals(coarse)[1]).toBe(1)
    expect(bestToneDelay(-45 * RAD, 1, Infinity).D).toBe(7)
    expect(coarse.notes?.join('')).toContain('D=7')
  })
})

describe('Ch07 handcalcs：(c) validate 擋掉模型不適用的輸入', () => {
  it('單頻題：Ω = 0 或 180°（π）被拒絕，訊息說明 E46 的 2 倍公式', () => {
    for (const id of ['HC-07.1', 'HC-07.2', 'HC-07.5', 'HC-07.6', 'HC-07.7', 'HC-07.8']) {
      const def = hc(id)
      for (const omega of [0, 180]) {
        const msg = def.validate?.({ ...defaultValues(def), omega })
        expect(msg, `${id} omega=${omega}`).toMatch(/E46/)
        expectMathTextOk(msg as string, `${id} validate`)
      }
    }
    const d3 = hc('HC-07.3')
    for (const omega of [0, Math.PI, 3.1416]) expect(d3.validate?.({ phi: -120, omega }), `omega=${omega}`).toMatch(/E46/)
    const d4 = hc('HC-07.4')
    expect(d4.validate?.({ ...defaultValues(d4), om1: 0 })).toMatch(/E46/)
    expect(d4.validate?.({ ...defaultValues(d4), om2: 3.1416 })).toMatch(/E46/)
  })

  it('HC-07.4：兩個 tone 同頻被拒絕（交叉項不會平均成 0）', () => {
    const def = hc('HC-07.4')
    const msg = def.validate?.({ ...defaultValues(def), om2: 0.03 })
    expect(msg).toMatch(/頻率必須不同/)
    expectMathTextOk(msg as string, 'HC-07.4 validate')
  })

  it('HC-07.5：θ = ±90°（C_D = 0、ρ = 0）被拒絕——N 的倍數是無限大', () => {
    const def = hc('HC-07.5')
    for (const D of [1, 7]) {
      const msg = def.validate?.({ ...defaultValues(def), D })
      expect(msg, `D=${D}`).toMatch(/\\rho=0/)
      expectMathTextOk(msg as string, 'HC-07.5 validate')
    }
    // ρ < 0（極性錯誤）不拒絕，但不給「N 的倍數」
    const neg = def.solve({ ...defaultValues(def), D: 0 })
    expect(def.validate?.({ ...defaultValues(def), D: 0 })).toBeNull()
    expect(neg.results).toHaveLength(3)
    expect(neg.results[2].value).toBeCloseTo(-0.5, 12)
  })

  it('HC-07.6／HC-07.8：σ_v = 0 被拒絕（線性化 pole 不適用）；HC-07.6 的 r ≤ 0 被拒絕', () => {
    for (const id of ['HC-07.6', 'HC-07.8']) {
      const def = hc(id)
      const msg = def.validate?.({ ...defaultValues(def), sigmaV: 0 })
      expect(msg, id).toMatch(/\\sigma_v/)
      expectMathTextOk(msg as string, `${id} validate`)
    }
    const d6 = hc('HC-07.6')
    expect(d6.validate?.({ ...defaultValues(d6), ratio: 0 })).toMatch(/反相/)
  })

  it('HC-07.7：主 PLL 迴路不穩定的參數被拒絕（H_PD 沒有定義）', () => {
    const def = hc('HC-07.7')
    const bad = { wnTs: 1, zeta: 0.7, d: 3, omega: 30 }
    expect(pathStability({ kind: 'type2_dt', wnTs: bad.wnTs, zeta: bad.zeta, loopDelay: bad.d }).stable).toBe(false)
    const msg = def.validate?.(bad)
    expect(msg).toMatch(/不穩定/)
    expectMathTextOk(msg as string, 'HC-07.7 validate')
  })
})

describe('Ch07 handcalcs：(d) <HandCalc> 渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值渲染出步驟與答案，沒有 KaTeX 錯誤', (_id, def) => {
    const sol = def.solve(defaultValues(def))
    expectSolutionTexOk(def, sol, 'defaults')
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.querySelector(`[id="handcalc-${def.id}"]`)).not.toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    expect(container.querySelectorAll('.c-handcalc-results .katex').length).toBeGreaterThanOrEqual(sol.results.length)
    expect(container.textContent ?? '').not.toMatch(/NaN|undefined|Infinity/)
    unmount()
  })

  it('HC-07.1：把 Ω 改成 180 顯示 E46 的原因、不顯示步驟；「換一題」後仍可渲染', () => {
    const def = hc('HC-07.1')
    const { container } = render(<HandCalc def={def} />)
    fireEvent.change(screen.getByLabelText(/每個 sample 轉幾度/), { target: { value: '180' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('E46')
    expect(container.querySelectorAll('.katex-error').length).toBe(0)
    fireEvent.click(screen.getByText('還原範例數字'))
    expect(container.querySelectorAll('.c-step').length).toBe(4)
    fireEvent.click(screen.getByText('換一題（隨機數字）'))
    fireEvent.click(screen.getByText('看詳解'))
    expect(container.querySelectorAll('.c-step').length).toBe(4)
    expect(container.querySelectorAll('.katex-error').length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (e) 畫面上的算式：把每一步的 TeX 重新求值（角度一律是「度」）
// ─────────────────────────────────────────────────────────────────────────────

function matchBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  throw new Error(`大括號不成對：${s}`)
}

/**
 * 把一段「只含數字」的 TeX 求值：+ − × ^ \frac \sqrt \cos \sin（度）、wrap_180、round、括號、a\times10^{b}；
 * 單位（°、rad、rad/sample、fs⁻¹）直接去掉。含符號（字母）的片段回傳 null。遞迴下降自己剖析（不用 eval）。
 */
function evalTex(seg: string): number | null {
  let s = seg
    .replace(/\\ \\mathrm\{(?:rad\/sample|rad|fs\^\{-1\})\}/g, '')
    .replace(/\\big/g, '')
    .replace(/\^\\circ/g, '')
    .replace(/\\[,;!]|\\ /g, ' ')
    .replace(/\\times/g, '*')
    .replace(/\\mathrm\{wrap\}_\{180\}/g, 'W')
    .replace(/\\mathrm\{round\}/g, 'R')
    .replace(/\\sqrt\s*\{/g, 'S{')
    .replace(/\\cos/g, 'C')
    .replace(/\\sin/g, 'N')
  for (let i = s.indexOf('\\frac'); i >= 0; i = s.indexOf('\\frac')) {
    const a0 = s.indexOf('{', i)
    const a1 = matchBrace(s, a0)
    const b1 = matchBrace(s, a1 + 1)
    s = `${s.slice(0, i)}((${s.slice(a0 + 1, a1)})/(${s.slice(a1 + 2, b1)}))${s.slice(b1 + 1)}`
  }
  s = s.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\s+/g, '')
  if (!/^[0-9.+\-*/^()WRSCN]+$/.test(s) || !/[0-9]/.test(s)) return null
  let pos = 0
  const expr = (): number => {
    let v = term()
    while (s[pos] === '+' || s[pos] === '-') v = s[pos++] === '+' ? v + term() : v - term()
    return v
  }
  const term = (): number => {
    let v = unary()
    while (s[pos] === '*' || s[pos] === '/') v = s[pos++] === '*' ? v * unary() : v / unary()
    return v
  }
  const unary = (): number => {
    if (s[pos] === '-') return pos++, -unary()
    const base = atom()
    if (s[pos] !== '^') return base
    pos++
    return base ** (s[pos] === '(' ? atom() : Number(s[pos++]))
  }
  const atom = (): number => {
    const c = s[pos]
    if (c === '(') {
      pos++
      const v = expr()
      if (s[pos++] !== ')') throw new Error(`括號不成對：${seg}`)
      return v
    }
    if ('WRSCN'.includes(c)) {
      pos++
      const v = atom()
      if (c === 'S') return Math.sqrt(v)
      if (c === 'C') return Math.cos(v * RAD)
      if (c === 'N') return Math.sin(v * RAD)
      if (c === 'W') return wrap(v)
      const lo = Math.floor(v) // round：最接近的整數，剛好 .5 取較小的
      return v - lo <= 0.5 ? lo : lo + 1
    }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(pos))
    if (!m) throw new Error(`無法剖析：${seg}（位置 ${pos}：${s}）`)
    pos += m[0].length
    return Number(m[0])
  }
  const v = expr()
  if (pos !== s.length) throw new Error(`無法剖析：${seg}（剩下 ${s.slice(pos)}）`)
  return v
}

/** 在最外層（不在大括號裡）的 = 處切開。 */
function splitChain(tex: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of tex) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === '=' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim())
}

/** 一段算式裡用到幾「種」運算（連乘、連加各算一種；a\times10^{b} 的科學記號不算）。 */
function opKinds(seg: string): number {
  const s = seg.replace(/(?:\d(?:\.\d+)?\\times)?10\^\{-?\d+\}/g, '9').replace(/\^\\circ/g, '')
  return [/\\times/, / [+-] /, /\\frac/, /\^/, /\\cos|\\sin|\\sqrt|\\mathrm\{(?:wrap|round)\}/].filter((re) => re.test(s)).length
}

/**
 * 一步的 TeX「a = b = c」（需要折返時以 ⇒ 分成兩句）：每一段數字算出來都要等於那一句最後的數字
 * （容許顯示時四捨五入的誤差：相對 2.5×10⁻⁴，與 ch00 的範本相同），而且最後一個等號只做一種運算。回傳每一句最後的數字。
 */
function checkStepTex(tex: string, label: string): number[] {
  const finals: number[] = []
  for (const part of tex.split(String.raw`\;\Rightarrow\;`)) {
    const nums = splitChain(part)
      .map((seg) => ({ seg, v: evalTex(seg) }))
      .filter((x): x is { seg: string; v: number } => x.v !== null)
    if (!nums.length) continue
    const last = nums[nums.length - 1].v
    expect(Number.isFinite(last), `${label}：${tex}`).toBe(true)
    finals.push(last)
    for (const { seg, v } of nums.slice(0, -1)) {
      expect(Math.abs(v - last), `${label}：「${seg}」= ${v}，但這一步的結果是 ${last}（${tex}）`).toBeLessThanOrEqual(1e-12 + 2.5e-4 * Math.max(Math.abs(v), Math.abs(last)))
    }
    if (nums.length >= 2) expect(opKinds(nums[nums.length - 2].seg), `${label}：最後一個等號做了不只一種運算（${tex}）`).toBeLessThanOrEqual(1)
  }
  return finals
}

/**
 * 使用者自己打的數字（不在「換一題」的範圍內）：很長的小數、很大的 D、剛好抵銷、相減吃掉有效位數、
 * 很小／很大的量（科學記號）、θ 剛好在 ±90°／180°、g ≈ 1、g ≥ 2、μ = 0。
 * 舊版在這些地方會出現「17.35°×123 = 2134.1°」（輸入被四捨五入）、「−0.41421 + 0.39775 = −0.016466」、
 * 「7.0434×10⁻⁶²」（KaTeX double superscript）、把 5×10⁻¹¹ 顯示成 0。
 */
const USER_CASES: Record<string, V[]> = {
  'HC-07.1': [
    { phi: -120.5, omega: 30.25, D: 7 },
    { phi: 37.123, omega: 17.35, D: 123 },
    { phi: 180, omega: 179.99, D: 5000 },
    { phi: -180, omega: 0.01, D: 0 }, // θ = +180°（不是 −180°）
    { phi: 0, omega: 90, D: 1 }, // θ = 90°：M_pol = 0
    { phi: -90, omega: 30.1, D: 7 }, // 30.1×7 在 double 裡是 210.70000000000002
    { phi: -120.00001, omega: 30, D: 4 }, // θ = −10⁻⁵°：角度不可寫成科學記號再接 °
  ],
  'HC-07.2': [
    { A: 1.234, mag: 0.0893, phi: 155.378, omega: 1.71887, D: 119 },
    { A: 100, mag: 100, phi: -120, omega: 30, D: 4 },
    { A: 0.001, mag: 0, phi: 10, omega: 22.5, D: 3 }, // A²/2 = 5×10⁻⁷、|H| = 0
    { A: 0.7, mag: 1.3, phi: -33.3, omega: 22.5, D: 3 },
    { A: 1, mag: 1, phi: -120, omega: 30, D: 1 }, // θ = −90°：C_D 剛好是 0
    { A: 1, mag: 1, phi: 37.123, omega: 17.35, D: 123 },
  ],
  'HC-07.3': [
    { phi: -120, omega: 0.5236 },
    { phi: 9, omega: Math.PI / 6 }, // 使用者貼上 16 位的 π/6
    { phi: -45, omega: 1 },
    { phi: 0, omega: 0.3 }, // D = 0
    { phi: 3, omega: 0.02 },
    { phi: -179.9, omega: 3.14 },
    { phi: 100, omega: 0.0001 }, // D = 45379
    { phi: -0.5, omega: 1 },
    { phi: 155.3782, omega: 0.031 }, // φ 有 4 位小數
    { phi: -90, omega: 0.7854 },
  ],
  'HC-07.4': [
    { mag1: 1, phi1: -90, om1: 0.1, mag2: 1, phi2: 90, om2: 0.2, D: 0 }, // 兩個 tone 都是 0
    { mag1: 1, phi1: -60, om1: 0.1, mag2: 1, phi2: 120.01, om2: 0.2, D: 0 }, // 0.25 − 0.25007557
    { mag1: 0.5, phi1: -60, om1: 0.1, mag2: 0.5, phi2: 120, om2: 0.2, D: 0 }, // 剛好抵銷成 0
    { mag1: 0.0893, phi1: 155.38, om1: 0.03, mag2: 0.2407, phi2: 137.65, om2: 0.05, D: 281 },
    { mag1: 100, phi1: 180, om1: 3.1, mag2: 0, phi2: -180, om2: 0.001, D: 5000 }, // 15500 rad：57.2958 的位數不夠
    { mag1: 1, phi1: 0, om1: 0.5, mag2: 1, phi2: 31.7, om2: 1, D: 1 }, // θ₂ ≈ 89°：cos 對角度很敏感
  ],
  'HC-07.5': [
    { A: 3.3, mag: 0.07, phi: -100, omega: 12.5, D: 7 },
    { A: 1, mag: 1, phi: -120, omega: 30.1, D: 1 }, // ρ = 0.0017
    { A: 1, mag: 1, phi: -120, omega: 30, D: 0 }, // ρ < 0
    { A: 100, mag: 0.001, phi: 45, omega: 1, D: 5000 },
  ],
  'HC-07.6': [
    { mag: 1, ratio: 1.25, omega: 30, Delta: 0, mu: 50, sigmaV: 50 }, // g = 0.9974：1 − g 吃掉有效位數
    { mag: 2, ratio: 0.8, omega: 30, Delta: 0, mu: 20, sigmaV: 50 }, // g = 1.0213
    { mag: 2, ratio: 2, omega: 15, Delta: 0, mu: 50, sigmaV: 50 }, // g ≥ 2
    { mag: 1, ratio: 1, omega: 30, Delta: 4, mu: 0, sigmaV: 100 }, // μ = 0
    { mag: 1, ratio: 1, omega: 30, Delta: 3, mu: 10, sigmaV: 100 }, // cos 90° = 0
    { mag: 0.37, ratio: 1.07, omega: 12.5, Delta: 5, mu: 3.3, sigmaV: 77 }, // g = 0.0023
    { mag: 1, ratio: 1, omega: 30, Delta: 4, mu: 1000000, sigmaV: 1000000 }, // 科學記號的 K_q
    { mag: 1, ratio: 1, omega: 30, Delta: 0, mu: 12.5331414, sigmaV: 10 }, // g = 1 + 2×10⁻⁹
    { mag: 1, ratio: 1, omega: 30, Delta: 64, mu: 10, sigmaV: 0.001 }, // p ≈ 3990
  ],
  'HC-07.7': [
    { wnTs: 0.05, zeta: 0.707, d: 2, omega: 10 },
    { wnTs: 0.3, zeta: 1, d: 0, omega: 179 },
    { wnTs: 0.001, zeta: 0.05, d: 0, omega: 1 }, // 10⁻⁶…10⁻¹¹ 的量：科學記號當乘數、當平方的底數
    { wnTs: 0.1, zeta: 0.7, d: 0, omega: 1.71887 }, // 低頻 tone：E[u·u_f] > 0
    { wnTs: 0.25, zeta: 1, d: 0, omega: 45 }, // Re 𝒟 = −0.414214 + 0.397748
    { wnTs: 0.1, zeta: 0.5, d: 1, omega: 60 }, // Im H 的分子相減
    { wnTs: 0.25, zeta: 1, d: 1, omega: 30 },
    { wnTs: 0.2, zeta: 0.7, d: 0, omega: 90 }, // cos 90° = 0、Re ∇² = 0
  ],
  'HC-07.8': [
    { mag: 1, phi: -120, omega: 30, D: 4, mu: 0, sigmaV: 100 },
    { mag: 1.25, phi: 0, omega: 30, D: 0, mu: 50, sigmaV: 50 },
    { mag: 2, phi: -120, omega: 30, D: 4, mu: 50, sigmaV: 50 },
    { mag: 0.37, phi: 37.123, omega: 17.35, D: 123, mu: 3.3, sigmaV: 77 },
    { mag: 1, phi: -90, omega: 30, D: 3, mu: 10, sigmaV: 100 }, // C_raw = C_D = 0
  ],
}

/** 以指定的數字當預設值（渲染使用者自己打的數字） */
const withValues = (def: HandCalcDef, v: V): HandCalcDef => ({ ...def, inputs: def.inputs.map((i) => ({ ...i, default: v[i.key] })) })

describe('Ch07 handcalcs：(e) 畫面上的算式自己算得出來', () => {
  it('evalTex：本章步驟會出現的寫法都能求值', () => {
    const r = String.raw
    expect(evalTex(r`30^\circ\times4`)).toBe(120)
    expect(evalTex(r`2171.173^\circ - 6\times360^\circ`)).toBeCloseTo(11.173, 9)
    expect(evalTex(r`\mathrm{wrap}_{180}\big(585^\circ\big)`)).toBe(-135)
    expect(evalTex(r`\mathrm{wrap}_{180}\big(-180^\circ\big)`)).toBe(180)
    expect(evalTex(r`\mathrm{round}(119.044)`)).toBe(119)
    expect(evalTex(r`\mathrm{round}(1.5)`)).toBe(1)
    expect(evalTex(r`\cos\big(-60^\circ\big)`)).toBeCloseTo(0.5, 12)
    expect(evalTex(r`1 - \cos\big(30^\circ\big)`)).toBeCloseTo(1 - Math.sqrt(3) / 2, 12)
    expect(evalTex(r`\frac{(-0.23205)\times(-0.17215) + 0.13397\times0.18022}{0.062113}`)).toBeCloseTo(1.03185, 4)
    expect(evalTex(r`(7.0434\times10^{-6})^2`)).toBeCloseTo(4.9609e-11, 14)
    expect(evalTex(r`\frac{0.79788}{10^{6}}`)).toBeCloseTo(7.9788e-7, 12)
    expect(evalTex(r`\sqrt{0.25}`)).toBe(0.5)
    expect(evalTex(r`0.0132\ \mathrm{rad/sample}`)).toBe(0.0132)
    expect(evalTex(r`0.0079788\ \mathrm{fs^{-1}}`)).toBe(0.0079788)
    expect(evalTex(r`\phi+\Omega D`)).toBeNull()
    expect(evalTex(r`\frac{A^2}{2}\,|H|\cos\theta`)).toBeNull()
    expect(opKinds(r`1 - 0.079788\times(-0.5)`)).toBe(2)
    expect(opKinds(r`1 - (-0.039894)`)).toBe(1)
    expect(opKinds(r`(1.0152\times10^{-6})\times0.99985`)).toBe(1)
    expect(opKinds(r`\frac{0.064092}{0.062113}`)).toBe(1)
  })

  it.each(HANDCALCS.map((h) => [h.id, h] as const))(
    '%s：每一步「符號式 = 代入數字 =（中間結果 =）結果」的數字重新求值後前後一致、每一步都有代入數字、每個答案都是某一步的結果（預設值、30 組隨機數字、使用者自己打的數字）',
    (_id, def) => {
      const cases = [defaultValues(def), ...Array.from({ length: 30 }, (_, k) => randomValues(def, k + 1)), ...USER_CASES[def.id]]
      for (const v of cases) {
        const label = `${def.id} ${JSON.stringify(v)}`
        def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${label} ${i.key}`).toBeNull())
        expect(def.validate?.(v) ?? null, label).toBeNull()
        const sol = def.solve(v)
        const finals = sol.steps.flatMap((s, k) => {
          const f = checkStepTex(s.tex, `${label} 第 ${k + 1} 步`)
          expect(f.length, `${label} 第 ${k + 1} 步沒有代入數字：${s.tex}`).toBeGreaterThan(0)
          return f
        })
        for (const r of sol.results) {
          expect(Number.isFinite(r.value), `${label} ${r.symbol}`).toBe(true)
          // 照步驟算到的數字（畫面上四捨五入後的值）要被「對答案」接受，而且就是這個答案（不是碰巧落在容許誤差內的別的量）
          const hit = finals.some((f) => checkAnswer(f, r).ok && Math.abs(f - r.value) <= 1.5e-3 * Math.max(1, Math.abs(r.value)))
          expect(hit, `${label}：答案 ${r.symbol} = ${r.value} 不是任何一步的結果（各步結果：${finals.join(', ')}）`).toBe(true)
        }
      }
    },
  )

  it('使用者自己打的數字：答案仍等於獨立重算；渲染沒有 KaTeX 錯誤、沒有 NaN、畫面上沒有落單的 $', () => {
    for (const def of HANDCALCS) {
      for (const v of USER_CASES[def.id]) {
        const label = `${def.id} ${JSON.stringify(v)}`
        expectMatchesIndependent(def, v, label)
        const sol = def.solve(v)
        expectSolutionTexOk(def, sol, label)
        const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
        expect(Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title')), label).toEqual([])
        expect(container.querySelector('.c-tex-error'), label).toBeNull()
        expect(container.querySelectorAll('.c-step').length, label).toBe(sol.steps.length)
        const prose = container.cloneNode(true) as HTMLElement
        prose.querySelectorAll('.katex, input').forEach((n) => n.remove())
        expect(prose.textContent ?? '', label).not.toMatch(/\$|NaN|undefined|Infinity/)
        unmount()
      }
    }
  })

  it('輸入的數字完整顯示（不四捨五入到 5 位），角度的加減在十進位格點上精確計算', () => {
    const r = String.raw
    const s1 = hc('HC-07.1').solve({ phi: 37.123, omega: 17.35, D: 123 })
    expect(s1.steps[0].tex).toBe(r`\Omega D = 17.35^\circ\times123 = 2134.05^\circ`)
    expect(s1.steps[1].tex).toBe(r`\phi+\Omega D = 37.123^\circ + 2134.05^\circ = 2171.173^\circ`)
    expect(s1.steps[2].tex).toBe(r`\theta = \mathrm{wrap}_{180}\big(2171.173^\circ\big) = 2171.173^\circ - 6\times360^\circ = 2171.173^\circ - 2160^\circ = 11.173^\circ`)
    expect(s1.steps[3].tex).toBe(r`M_{\mathrm{pol}} = 90^\circ - |\theta| = 90^\circ - 11.173^\circ = 78.827^\circ`)
    expect(vals(s1)).toEqual([11.173, 78.827])
    // 30.1×7 在 double 裡是 210.70000000000002；θ = +180° 不會因為浮點誤差變成 −180°
    expect(hc('HC-07.1').solve({ phi: -90, omega: 30.1, D: 7 }).steps[0].tex).toBe(r`\Omega D = 30.1^\circ\times7 = 210.7^\circ`)
    for (const v of [
      { phi: -180, omega: 0.01, D: 0 },
      { phi: -90, omega: 90, D: 7 },
      { phi: 180, omega: 60, D: 6 },
    ]) expect(vals(hc('HC-07.1').solve(v)), JSON.stringify(v)).toEqual([180, -90])
    // 很小的角度不寫成科學記號（−10^{-5}^\circ 是 KaTeX 的 double superscript）
    const tiny = hc('HC-07.1').solve({ phi: -120.00001, omega: 30, D: 4 })
    expect(tiny.steps[1].tex).toBe(r`\phi+\Omega D = -120.00001^\circ + 120^\circ = -0.00001^\circ`)
    // 需要折返時寫成兩句（每個等號都成立），不是「−240° = 120°」
    expect(hc('HC-07.2').solve(defaultValues(hc('HC-07.2'))).steps[5].tex).toBe(r`\phi-\Omega D = -120^\circ - 120^\circ = -240^\circ\;\Rightarrow\;\theta' = -240^\circ + 360^\circ = 120^\circ`)
    expect(hc('HC-07.5').solve(defaultValues(hc('HC-07.5'))).steps[1].tex).toBe(r`\theta = \phi+\Omega D = -120^\circ + 60^\circ = -60^\circ`)
    // A = 1.234：A² = 1.522756、A²/2 = 0.761378 都是短小數，完整顯示
    expect(hc('HC-07.2').solve({ A: 1.234, mag: 0.0893, phi: 155.378, omega: 1.71887, D: 119 }).steps[0].tex).toBe(r`\frac{A^2}{2} = \frac{1.234^2}{2} = \frac{1.522756}{2} = 0.761378`)
  })

  it('相減會吃掉有效位數的地方，運算元自動多顯示幾位，並在說明裡提醒', () => {
    const r = String.raw
    // HC-07.7：Re 𝒟 = Re ∇² + Re{Qz}（5 位有效數字會算成 −0.01646，但答案是 −0.016466）
    const s7 = hc('HC-07.7').solve({ wnTs: 0.25, zeta: 1, d: 0, omega: 45 })
    const reD = s7.steps.find((s) => s.tex.startsWith(r`\mathrm{Re}\,\mathcal D`))
    expect(reD?.tex.endsWith('= -0.414214 + 0.397748 = -0.016466')).toBe(true)
    expect(reD?.why).toContain('多寫了幾位')
    // 預設值不需要多寫：每一步都沒有這句提醒
    for (const def of HANDCALCS) for (const s of def.solve(defaultValues(def)).steps) expect(s.why, `${def.id}：${s.tex}`).not.toContain('多寫了幾位')
    // HC-07.6：g = 0.9974 ⇒ p = 1 − g 只剩 3 位；μK_q 多寫幾位、p 顯示 5 位有效數字
    const s6 = hc('HC-07.6').solve({ mag: 1, ratio: 1.25, omega: 30, Delta: 0, mu: 50, sigmaV: 50 })
    expect(s6.steps[7].tex).toBe(r`p_f = 1-\mu K_q\,E[u\,u_f] = 1 - 0.7978846\times1.25 = 1 - 0.997356 = 0.0026443`)
    expect(s6.steps[7].why).toContain('多寫了幾位')
    expect(s6.steps[8].tex).toBe(r`p_{E[u^2]} = 1-\mu K_q\,E[u^2] = 1 - 0.79788\times1 = 1 - 0.79788 = 0.20212`)
    // HC-07.4：0.25 + (−0.25007557)
    const s4 = hc('HC-07.4').solve(USER_CASES['HC-07.4'][1])
    expect(s4.steps[10].tex).toBe(r`C_D = 0.25 + (-0.25007557) = -7.5571\times10^{-5}`)
    // 15500 rad × 180°/π：57.2958 只有 6 位，角度會差 0.3°——自動改用 57.29578
    expect(hc('HC-07.4').solve(USER_CASES['HC-07.4'][4]).steps[1].tex).toContain(r`15500\times57.29578^\circ = 888084.582^\circ`)
    // 很小的量：科學記號當乘數、當平方的底數時加括號；5×10⁻¹¹ 不會被當成 0
    const small = hc('HC-07.7').solve({ wnTs: 0.001, zeta: 0.05, d: 0, omega: 1 })
    const d2 = small.steps.find((s) => s.tex.startsWith(r`|\mathcal D|^2`))
    expect(d2?.tex).toContain(r`(7.0434\times10^{-6})^2`)
    expect(d2?.tex).toContain(r`9.2123\times10^{-8} + 4.961\times10^{-11} = 9.2173\times10^{-8}`)
  })

  it('pole 的判讀與容許誤差：以 loop gain g = 1 − p 為準', () => {
    const d6 = hc('HC-07.6')
    // g = 0.0023（p = 0.99769）：答「p = 1」（沒有恢復力）或 g 差 10% 都不可以判對
    const slow = d6.solve({ mag: 0.37, ratio: 1.07, omega: 12.5, Delta: 5, mu: 3.3, sigmaV: 77 })
    const pf = slow.results[1]
    expect(pf.value).toBeCloseTo(0.997687, 6)
    expect(checkAnswer(pf.value, pf).ok).toBe(true)
    expect(checkAnswer(0.99769, pf).ok).toBe(true)
    expect(checkAnswer(1, pf).ok).toBe(false)
    expect(checkAnswer(1 - 1.1 * (1 - pf.value), pf).ok).toBe(false)
    // 預設值：用 K_q ≈ 0.008/σ_v 的手算（p = 1.04）仍然接受；極性算反（0.96011）不接受
    const def0 = d6.solve(defaultValues(d6)).results[1]
    expect(checkAnswer(1.04, def0).ok).toBe(true)
    expect(checkAnswer(0.96011, def0).ok).toBe(false)
    // μ = 0：兩個 pole 都是 1——備註不可說誤用 E[u²] 的 pole「仍然顯示收斂」
    const mu0 = d6.solve({ mag: 1, ratio: 1, omega: 30, Delta: 4, mu: 0, sigmaV: 100 })
    expect(vals(mu0)).toEqual([-0.5, 1, 1])
    expect(mu0.notes?.join('')).not.toContain('仍然顯示')
    expect(mu0.notes?.[0]).toContain('$p=1$')
    // g ≥ 2：p ≤ −1 是發散，不是「收斂」
    const big = d6.solve({ mag: 2, ratio: 2, omega: 15, Delta: 0, mu: 50, sigmaV: 50 })
    expect(big.results[1].value).toBeLessThan(-1)
    expect(big.notes?.[0]).toMatch(/發散/)
    // g = 1（p ≈ 0）：一個 block 修完，不顯示「τ = 0.05 blocks」這種數字
    const dead = d6.solve({ mag: 1, ratio: 1, omega: 30, Delta: 0, mu: 12.5331414, sigmaV: 10 })
    expect(dead.notes?.[0]).toContain('一個 block')
    expect(dead.notes?.[0]).not.toContain('\\tau')
    // 預設值的備註維持原來的結論
    expect(d6.solve(defaultValues(d6)).notes?.join('')).toContain('仍然顯示「收斂」')
  })

  it('「換一題」第一次按下去就會換數字（seed 2 不等於預設值）', () => {
    for (const def of HANDCALCS) expect(randomValues(def, 2), def.id).not.toEqual(defaultValues(def))
  })
})

describe('filteredX.ts：手算題用的小工具（core:calPole／normalizedCorr／delayTolerance）', () => {
  it('kqFromSigma、calPole、calTimeConstant 的數值與邊界', () => {
    expect(kqFromSigma(100)).toBeCloseTo(0.00797884560802865, 15)
    const p = calPole(10, 100, 0.5)
    expect(p.g).toBeCloseTo(10 * 0.00797884560802865 * 0.5, 15)
    expect(p.p).toBeCloseTo(1 - p.g, 15)
    expect(calTimeConstant(0)).toBe(0)
    expect(calTimeConstant(1)).toBe(Infinity)
    expect(calTimeConstant(1.02)).toBe(Infinity)
    expect(calTimeConstant(-1)).toBe(Infinity)
    expect(calTimeConstant(0.9)).toBeCloseTo(-1 / Math.log(0.9), 14)
    expect(calTimeConstant(-0.5)).toBeCloseTo(-1 / Math.log(0.5), 14)
    // 手算提示的近似：τ ≈ 1/g − 1/2，g ≤ 0.1 時誤差 < 0.1%；只用 1/g 約高估 5%
    for (const g of [0.01, 0.05, 0.1]) {
      const tau = calTimeConstant(1 - g)
      expect(Math.abs(1 / g - 0.5 - tau) / tau).toBeLessThan(1e-3)
    }
    expect((1 / 0.1 - calTimeConstant(0.9)) / calTimeConstant(0.9)).toBeGreaterThan(0.05)
    expect((1 / 0.1 - calTimeConstant(0.9)) / calTimeConstant(0.9)).toBeLessThan(0.06)
  })

  it('normalizedCorr：|ρ| ≤ 1（Cauchy–Schwarz），單頻 delayed-x 的 ρ = cos θ；averagingPenalty = 1/ρ²', () => {
    for (const thetaDeg of [0, 30, 60, 120, 180]) {
      const C = 0.5 * 0.7 * Math.cos(thetaDeg * RAD)
      const rho = normalizedCorr(C, 0.5, 0.5 * 0.7 * 0.7)
      expect(rho).toBeCloseTo(Math.cos(thetaDeg * RAD), 12)
      expect(Math.abs(rho)).toBeLessThanOrEqual(1 + 1e-12)
    }
    expect(averagingPenalty(0.5)).toBe(4)
    expect(averagingPenalty(-0.5)).toBe(4)
    expect(averagingPenalty(1)).toBe(1)
  })

  it('delayToleranceRad：在 Ω₀ ± π/(2D) 處 C_D 剛好為 0，窗內為正、窗外為負（φ 視為常數）', () => {
    for (const [D, omega0] of [
      [4, Math.PI / 6],
      [119, 0.03],
      [2, 0.7],
    ] as const) {
      const tol = delayToleranceRad(D)
      const C = (om: number) => toneCorrCodeDelay({ A: 1, mag: 1, phiRad: -omega0 * D, omega: om }, D)
      expect(Math.abs(C(omega0 + tol))).toBeLessThan(1e-12)
      expect(Math.abs(C(omega0 - tol))).toBeLessThan(1e-12)
      expect(C(omega0 + 0.9 * tol)).toBeGreaterThan(0)
      expect(C(omega0 - 0.9 * tol)).toBeGreaterThan(0)
      expect(C(omega0 + 1.1 * tol)).toBeLessThan(0)
      expect(C(omega0 - 1.1 * tol)).toBeLessThan(0)
    }
    expect(delayToleranceRad(4) * DEG).toBeCloseTo(22.5, 12) // 7.3 節：D = 4 ⇒ ±22.5°
  })
})
