import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, randomValues, renderTex } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import {
  MASH_CODE_AUTOCORR,
  MASH_CODE_FIR,
  UNIFORM_KAPPA4,
  eig2,
  foldedPsdDcLinearProcess,
  hankelFromMoments,
  inbandPower,
  kqFromSigma,
  linearProcessSquaredVariance,
  lutApproxRms,
  lutClosedForm,
  modeAnalysis,
  segmentClosedForm,
  uniformResidualAfterGain,
} from '@/simulation/models/dtcInl'
import { HANDCALCS } from './handcalcs'

/**
 * Ch11b 手算題：(1) 每題的答案 = dtcInl.ts 的函式；(2) 獨立重算（不呼叫 dtcInl.ts）一致；(3) 與 golden vectors 一致；
 * (4) 所有 TeX 可解析、沒有 NaN；(5) 隨機出題（practice）每一組都解得出來；(6) HandCalc 元件能 render 並對答案。
 */

vi.setConfig({ testTimeout: 120000 })

interface Tol {
  abs?: number
  rel?: number
}
interface GoldenVector {
  expected: Record<string, unknown>
  tolerance: Tol
  tolerance_overrides?: Record<string, Tol>
}
const golden = (name: string): GoldenVector => JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector
const gv = (v: GoldenVector, key: string, i?: number): number => (i === undefined ? (v.expected[key] as number) : (v.expected[key] as number[])[i])

const hc = (id: string): HandCalcDef => {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到 ${id}`)
  return def
}
function solve(id: string, over: Record<string, number> = {}): HandCalcSolution {
  const def = hc(id)
  const v = { ...defaultValues(def), ...over }
  expect(def.validate?.(v) ?? null, `${id} validate`).toBeNull()
  return def.solve(v)
}
const values = (sol: HandCalcSolution) => sol.results.map((r) => r.value)
function expectNear(actual: number, expected: number, what: string, tol = 1e-9) {
  expect(Number.isFinite(actual), `${what} 有限`).toBe(true)
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)))
}

function texProblems(def: HandCalcDef, sol: HandCalcSolution): string[] {
  const bad: string[] = []
  const check = (tex: string, display: boolean, where: string) => {
    if (/katex-error|c-tex-error/.test(renderTex(tex, display))) bad.push(`${where}: ${tex}`)
  }
  const inline = (text: string, where: string) => {
    const parts = text.split('$')
    if (parts.length % 2 === 0) bad.push(`${where}: $ 不成對 —— ${text}`)
    parts.forEach((p, i) => {
      if (i % 2 === 1) check(p, false, where)
    })
    if (/NaN|undefined|Infinity/.test(text)) bad.push(`${where}: 出現 NaN／undefined —— ${text}`)
  }
  check(def.formulaTex, true, 'formulaTex')
  inline(def.title, 'title')
  def.inputs.forEach((i) => {
    check(i.symbol, false, `input ${i.key}`)
    inline(i.label, `input ${i.key} label`)
    if (i.unit) check(i.unit, false, `input ${i.key} unit`)
  })
  sol.steps.forEach((s, k) => {
    check(s.tex, true, `step ${k + 1}`)
    inline(s.why, `step ${k + 1} why`)
    if (/NaN|undefined/.test(s.tex)) bad.push(`step ${k + 1}: NaN —— ${s.tex}`)
  })
  sol.results.forEach((r, k) => {
    check(`${r.symbol}=1${r.unit ? `\\ ${r.unit}` : ''}`, true, `result ${k + 1}`)
    if (r.label) inline(r.label, `result ${k + 1} label`)
  })
  sol.notes?.forEach((n, k) => inline(n, `note ${k + 1}`))
  def.tips?.forEach((t, k) => inline(t, `tip ${k + 1}`))
  return bad
}

/* ───────────── 獨立重算（不呼叫 dtcInl.ts） ───────────── */
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
const LN005 = Math.log(0.05)
const k95of = (pole: number) => Math.ceil(LN005 / Math.log(pole))

const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-11B.1': ({ d2, fB, fs }) => {
    const R = [6 / 48, -4 / 48, 1 / 48]
    const s2 = 2 * (R[0] ** 2 + 2 * R[1] ** 2 + 2 * R[2] ** 2) + (1 / 80 - 3 / 144) * (0.25 + 1 + 0.25) ** 2
    const nuB = fB / fs
    const Pin = d2 * d2 * s2 * 2 * nuB
    const total = d2 * d2 * (2 * R[0] ** 2 + (1 / 80 - 3 / 144) * (1 / 16 + 1 + 1 / 16))
    return [s2, Pin, Math.sqrt(Pin), Pin / total]
  },
  'HC-11B.2': ({ K, k, mu, sigma, N }) => {
    const lo = -1 + (2 * (k - 1)) / K
    const hi = -1 + (2 * k) / K
    const lam = (hi ** 3 - lo ** 3) / 6
    const g = (mu * SQRT_2_OVER_PI * lam) / sigma
    const pole = 1 - g
    return [lam, 1 / g, k95of(pole), Math.sqrt((mu * mu * lam) / (N * (1 - pole * pole)))]
  },
  'HC-11B.3': ({ J, mu, sigma, N }) => {
    const Kq = SQRT_2_OVER_PI / sigma
    const g = (mu * Kq) / J
    const pole = 1 - g
    return [J / (mu * Kq), k95of(pole), (2 * N) / (mu * Kq), Math.sqrt((mu * mu) / J / (N * (1 - pole * pole)))]
  },
  'HC-11B.4': ({ m2, m4, m6 }) => {
    const e = (a: number, b: number, d: number) => {
      const tr = a + d
      const det = a * d - b * b
      const s = Math.sqrt(tr * tr - 4 * det)
      return [(tr + s) / 2, (tr - s) / 2]
    }
    const lam = [...e(1, m2, m4), ...e(m2, m4, m6)]
    const mx = Math.max(...lam)
    const mn = Math.min(...lam)
    return [mx, mn, mx / mn, mx / mn / 7]
  },
  'HC-11B.5': ({ d2, d3, J, mu, sigma, N }) => {
    const rms = Math.sqrt((4 * d2 * d2) / 45 + (4 * d3 * d3) / 175)
    const floor = (2 / J) * Math.sqrt(((4 * d2 * d2) / 3 + (9 * d3 * d3) / 5) / 12)
    const Kq = SQRT_2_OVER_PI / sigma
    const g = (mu * Kq) / J
    const pole = 1 - g
    const varT = (mu * mu) / J / (N * (1 - pole * pole))
    return [rms, floor, Math.sqrt(floor * floor + varT), k95of(pole)]
  },
}

describe('Ch11b 手算題：清單、TeX、預設值', () => {
  it('5 題、ID 依序、page 正確、每題 ≥ 4 步、≥ 2 個答案、有 tips', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-11B.1', 'HC-11B.2', 'HC-11B.3', 'HC-11B.4', 'HC-11B.5'])
    for (const def of HANDCALCS) {
      expect(def.page).toBe('/ch/11b')
      expect(def.formulaId?.startsWith('F-11B.')).toBe(true)
      const sol = solve(def.id)
      expect(sol.steps.length, def.id).toBeGreaterThanOrEqual(4)
      expect(sol.results.length, def.id).toBeGreaterThanOrEqual(2)
      expect(def.tips?.length ?? 0, def.id).toBeGreaterThan(0)
      expect(texProblems(def, sol), def.id).toEqual([])
      for (const r of sol.results) expect(Number.isFinite(r.value), `${def.id} ${r.symbol}`).toBe(true)
    }
  })

  it('每題的預設值解 = 獨立重算（不呼叫 dtcInl.ts）', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const got = values(def.solve(v))
      const want = INDEPENDENT[def.id](v)
      expect(got.length).toBe(want.length)
      got.forEach((g, i) => expectNear(g, want[i], `${def.id} result ${i + 1}`, 1e-9))
    }
  })

  it('隨機出題（20 個 seed）：每一組 practice 值都通過 validate 並解得出有限的答案，且與獨立重算一致', () => {
    for (const def of HANDCALCS) {
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(def, seed)
        if (def.validate?.(v)) continue // 模型不適用的組合被擋掉（有解釋）
        const got = values(def.solve(v))
        const want = INDEPENDENT[def.id](v)
        got.forEach((g, i) => expectNear(g, want[i], `${def.id} seed ${seed} result ${i + 1}`, 1e-9))
        expect(texProblems(def, def.solve(v)), `${def.id} seed ${seed}`).toEqual([])
      }
    }
  })
})

describe('Ch11b 手算題：與模型函式及 golden vectors 一致', () => {
  it('HC-11B.1 = foldedPsdDcLinearProcess／inbandPower；與 dtc_inl_folding.json 的 S2_unit_exact、Pin_exact_d2 相同', () => {
    const sol = solve('HC-11B.1')
    const [s2, Pin, rms, frac] = values(sol)
    expectNear(s2, foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), 'S2', 1e-12)
    expectNear(Pin, inbandPower(400 * s2, 0.01), 'Pin', 1e-12)
    expectNear(rms, Math.sqrt(Pin), 'rms', 1e-12)
    expectNear(frac, Pin / (400 * linearProcessSquaredVariance(MASH_CODE_AUTOCORR[0], MASH_CODE_FIR, UNIFORM_KAPPA4)), 'frac', 1e-12)
    const v = golden('dtc_inl_folding')
    expectNear(s2, gv(v, 'S2_unit_exact'), 'golden S2', 1e-12)
    expectNear(Pin, gv(v, 'Pin_exact_d2'), 'golden Pin', 1e-12)
    expectNear(s2, 121 / 2880, '121/2880', 1e-14)
    // 分數：35/576 − 3/160
    expect(sol.steps[2].tex).toContain('35}{576}')
    expect(sol.steps[4].tex).toContain('121}{2880}')
    // ν_B ≥ 0.1 或 f_B ≥ f_s/2 被擋掉（有原因）
    expect(hc('HC-11B.1').validate?.({ d2: 20, fB: 20, fs: 100 })).toMatch(/0\.1/)
    expect(hc('HC-11B.1').validate?.({ d2: 20, fB: 60, fs: 100 })).toMatch(/Nyquist/)
  })

  it('HC-11B.2 = segmentClosedForm；與 dtc_inl_segments.json 的第 8 段（λ、k95、std）相同', () => {
    const sol = solve('HC-11B.2')
    const [lam, tau, k95, std] = values(sol)
    const s = segmentClosedForm(7, 8, 2, 10, 64)
    expectNear(lam, s.lambda, 'λ', 1e-12)
    expectNear(tau, s.tau, 'τ', 1e-12)
    expect(k95).toBe(s.k95)
    expectNear(std, s.stdW, 'std', 1e-12)
    const v = golden('dtc_inl_segments')
    expectNear(lam, gv(v, 'segment_lambda', 7), 'golden λ', 1e-12)
    expect(k95).toBe(gv(v, 'segment_k95', 7))
    expectNear(std, gv(v, 'segment_std_w', 7), 'golden std', 1e-12)
    // 第 5 段（x = 0 右邊）慢 37 倍
    const inner = values(solve('HC-11B.2', { k: 5 }))
    expectNear(lam / inner[0], gv(v, 'lambda_ratio_outer_inner'), '37×', 1e-12)
    expect(hc('HC-11B.2').validate?.({ K: 8, k: 9, mu: 2, sigma: 10, N: 64 })).toMatch(/不存在/)
    expect(hc('HC-11B.2').validate?.({ K: 8, k: 8, mu: 400, sigma: 10, N: 64 })).toMatch(/發散/)
  })

  it('HC-11B.3 = lutClosedForm；與 dtc_inl_segments.json 的 lut_* 相同', () => {
    const [tau, k95, neff, std] = values(solve('HC-11B.3'))
    const l = lutClosedForm(64, 2, 10, 64)
    expectNear(tau, l.tau, 'τ', 1e-12)
    expect(k95).toBe(l.k95)
    expectNear(neff, l.effectiveSamples, 'n_eff', 1e-12)
    expectNear(std, l.stdTheta, 'std', 1e-12)
    const v = golden('dtc_inl_segments')
    expectNear(tau, gv(v, 'lut_tau'), 'golden τ', 1e-12)
    expect(k95).toBe(gv(v, 'lut_k95'))
    expectNear(neff, gv(v, 'lut_effective_samples'), 'golden n_eff', 1e-12)
    expectNear(std, gv(v, 'lut_std_theta'), 'golden std', 1e-12)
    // 每格樣本數與 J 無關：J = 32 與 64 的 N/(μK_q) 相同
    expect(lutClosedForm(32, 2, 10, 64).samplesPerBinPerTau).toBeCloseTo(l.samplesPerBinPerTau, 12)
  })

  it('HC-11B.4 = eig2／modeAnalysis(Hankel)；與 dtc_inl_basis.json 的 hankel_*、monomial_cond 相同', () => {
    const sol = solve('HC-11B.4')
    const [lmax, lmin, kappa, rel] = values(sol)
    const [eh] = eig2(1, 1 / 3, 1 / 5)
    const [, ol] = eig2(1 / 3, 1 / 5, 1 / 7)
    expectNear(lmax, eh, 'λmax', 1e-12)
    expectNear(lmin, ol, 'λmin', 1e-12)
    expectNear(kappa, modeAnalysis(hankelFromMoments(1 / 3, 1 / 5, 1 / 7), 1, 1, 1).cond, 'κ (Jacobi)', 1e-9)
    expectNear(rel, kappa / 7, 'κ/7', 1e-12)
    const v = golden('dtc_inl_basis')
    expectNear(lmax, gv(v, 'hankel_even_eig', 0), 'golden even', 1e-12)
    expectNear(lmin, gv(v, 'hankel_odd_eig', 1), 'golden odd', 1e-12)
    expectNear(kappa, gv(v, 'hankel_cond_by_hand'), 'golden κ', 1e-9)
    expectNear(kappa, gv(v, 'monomial_cond'), 'golden monomial_cond', 1e-9)
    expect(hc('HC-11B.4').validate?.({ m2: 0.5, m4: 0.2, m6: 0.1 })).toMatch(/m_4<m_2\^2/)
    expect(hc('HC-11B.4').validate?.({ m2: 1 / 3, m4: 0.3, m6: 0.2 })).toMatch(/Cauchy/)
    // ±1 兩點分布（m_2 = m_4 = m_6 = 1）：分塊奇異 ⇒ 被擋掉（x³ = x 不可辨識）
    expect(hc('HC-11B.4').validate?.({ m2: 1, m4: 1, m6: 1 })).toMatch(/奇異/)
  })

  it('HC-11B.5 = uniformResidualAfterGain／lutApproxRms／lutClosedForm；floor 與 dtc_inl_segments.json 的 lut_approx_rms_d2_20_d3_10 相同', () => {
    const sol = solve('HC-11B.5')
    const [rms, floor, final, k95] = values(sol)
    expectNear(rms, uniformResidualAfterGain({ d2: 20, d3: 10 }).rms, 'rms', 1e-12)
    expectNear(floor, lutApproxRms({ d2: 20, d3: 10 }, 64), 'floor', 1e-12)
    const l = lutClosedForm(64, 2, 10, 64)
    expectNear(final, Math.sqrt(floor * floor + l.varTheta), 'final', 1e-12)
    expect(k95).toBe(l.k95)
    expectNear(floor, gv(golden('dtc_inl_segments'), 'lut_approx_rms_d2_20_d3_10'), 'golden floor', 1e-12)
    expect(sol.notes?.length).toBe(2)
    // misadjustment vs floor 的判斷句隨數字改變
    const big = solve('HC-11B.5', { mu: 20 })
    expect(big.notes?.[0]).toContain('該降')
    const small = solve('HC-11B.5', { J: 8 })
    expect(small.notes?.[0]).toContain('再加格數')
    expect(kqFromSigma(10)).toBeCloseTo(0.0797884560802865, 15)
  })
})

describe('Ch11b 手算題：HandCalc 元件', () => {
  it('HC-11B.1 能 render、顯示四個答案；「自己算算看」對答案：正確值 ✓、錯誤值 ✗', () => {
    const def = hc('HC-11B.1')
    const sol = def.solve(defaultValues(def))
    expect(checkAnswer(sol.results[2].value * 1.001, sol.results[2]).ok).toBe(true)
    expect(checkAnswer(sol.results[2].value * 1.2, sol.results[2]).ok).toBe(false)
    const { container } = render(<HandCalc def={def} />)
    expect(container.querySelector('.c-handcalc')?.id).toBe('handcalc-HC-11B.1')
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(10)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(container.textContent).not.toMatch(/NaN|undefined/)
    const practice = screen.getAllByRole('tab').find((b) => /自己算算看/.test(b.textContent ?? ''))
    expect(practice).toBeTruthy()
    if (practice) fireEvent.click(practice)
    expect(container.querySelectorAll('input').length).toBeGreaterThanOrEqual(3)
  })
})
