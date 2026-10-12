import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, randomValues, renderTex, texNum } from '@/components'
import { handcalcsForPage } from '@/app/handcalcs'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { ctHpd as pllCtHpd, ctT, designDtLoop } from '@/simulation/models/pll'
import {
  autocorrCorrelation,
  calPole,
  ctHpd,
  designPolarityLoop,
  kqFromSigma,
  loopFreqFromBw,
  sawtoothAutocorr,
  toneCorrelation,
  toneFir,
  toneHandTable,
} from '@/simulation/models/polarity'
import { impulseResponse } from '@/simulation/signal'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

interface GoldenVector {
  inputs: Record<string, number>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

function golden(id: string): GoldenVector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${id}.json`), 'utf8')) as GoldenVector
}

const DEG = Math.PI / 180
const byId = (id: string): HandCalcDef => {
  const d = HANDCALCS.find((h) => h.id === id)
  if (!d) throw new Error(`找不到 ${id}`)
  return d
}
/** 依 symbol 取結果值 */
const val = (sol: HandCalcSolution, symbol: string): number => {
  const r = sol.results.find((x) => x.symbol === symbol)
  if (!r) throw new Error(`結果中沒有 ${symbol}：${sol.results.map((x) => x.symbol).join(', ')}`)
  return r.value
}
const solveDefault = (id: string): HandCalcSolution => {
  const d = byId(id)
  return d.solve(defaultValues(d))
}
/** 相對 + 絕對誤差 */
const near = (actual: number, expected: number, rel = 1e-10, abs = 1e-12): void => {
  expect(Math.abs(actual - expected), `actual ${actual} vs expected ${expected}`).toBeLessThanOrEqual(abs + rel * Math.abs(expected))
}

/** 字串裡所有 `$...$` 都能被 KaTeX 解析（HandCalc 以 mathText 顯示 why／notes／tips／validate 訊息） */
const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
function expectMathTextOk(text: string, where: string): void {
  // `$` 必須成對：拿掉成對的公式後不應再有落單的 `$`
  expect(text.replace(INLINE, '').replace(/\\\$/g, ''), `${where}：有落單的 $`).not.toContain('$')
  for (const m of text.matchAll(INLINE)) expect(renderTex(m[1], false), `${where}：${m[1]}`).not.toContain('katex-error')
  // 字串屬性不渲染 HTML：不可殘留標籤
  expect(text, where).not.toMatch(/<\/?(strong|em|b|i|code)>/)
  // docs/teaching-style.md §3：`$...$` 以外不再用 Unicode 拼數學（希臘字母、上下標、≤ ≈ ⇒ × …）
  expect(text.replace(INLINE, ''), `${where}：$...$ 以外有 Unicode 拼的數學`).not.toMatch(/[α-ωΑ-Ω≤≥≈≪≫√∫Σ∏²³₀-₉·±−⟨⟩⇒⇔×]|[A-Za-z]_[A-Za-z{]/)
}
function expectSolutionTexOk(def: HandCalcDef, sol: HandCalcSolution, tag: string): void {
  expect(sol.steps.length, `${def.id} ${tag}`).toBeGreaterThan(0)
  sol.steps.forEach((s, i) => {
    const html = renderTex(s.tex, true)
    expect(html, `${def.id} ${tag} step ${i}: ${s.tex}`).not.toContain('katex-error')
    expect(s.tex, `${def.id} ${tag} step ${i}`).not.toMatch(/NaN|undefined|Infinity|\\infty/)
    expect(s.why.length, `${def.id} step ${i} 沒有說明`).toBeGreaterThan(3)
    expectMathTextOk(s.why, `${def.id} ${tag} step ${i} why`)
  })
  for (const r of sol.results) {
    expect(Number.isFinite(r.value), `${def.id} ${tag} ${r.symbol}`).toBe(true)
    expect(renderTex(`\\boxed{${r.symbol} = 1${r.unit ? `\\ ${r.unit}` : ''}}`, true)).not.toContain('katex-error')
    if (r.label) expectMathTextOk(r.label, `${def.id} result label`)
    // 答案本身一定要被判為正確；差 30% 的答案一定要被判為錯（pole 類的容許誤差以 |p − 1| 計）
    expect(checkAnswer(r.value, r).ok).toBe(true)
  }
  for (const n of sol.notes ?? []) expectMathTextOk(n, `${def.id} ${tag} note`)
}

// ───────────────────────────────────────────────────────────────────────────
// 獨立重算：直接在測試裡寫公式（不經過 handcalcs.ts、也不經過 polarity.ts）
// ───────────────────────────────────────────────────────────────────────────

const KQ1 = Math.sqrt(2 / Math.PI)

/** 複數除法 (ar + j·ai)/(br + j·bi) */
function cdiv(ar: number, ai: number, br: number, bi: number): { re: number; im: number } {
  const d = br * br + bi * bi
  return { re: (ar * br + ai * bi) / d, im: (ai * br - ar * bi) / d }
}
const typeIIRe = (nu: number, zeta: number): number => cdiv(-nu * nu, 0, 1 - nu * nu, 2 * zeta * nu).re

type Recompute = (v: Record<string, number>) => Record<string, number>

const RECOMPUTE: Record<string, Recompute> = {
  'HC-06.1': ({ C, Kq, mu, d0 }) => {
    const p = 1 - mu * Kq * C
    return { p, 'E[\\delta_1]': p * d0, 'E[\\delta_2]': p * p * d0, 'p_{\\mu/2}': 1 - 0.5 * mu * Kq * C }
  },
  'HC-06.2': ({ A, mag, phi, P, D, mu, sigmaV }) => {
    const C = 0.5 * A * A * mag * Math.cos((phi + (360 * D) / P) * DEG)
    const Kq = KQ1 / sigmaV
    return { C_D: C, K_q: Kq, p: 1 - mu * Kq * C }
  },
  'HC-06.3': ({ mag, phi, P, n }) => {
    const Om = (2 * Math.PI) / P
    const h1 = (-mag * Math.sin(phi * DEG)) / Math.sin(Om)
    const h0 = mag * Math.cos(phi * DEG) - h1 * Math.cos(Om)
    // u 用穩態解 |H|cos(Ωn + φ) 獨立算（不是 h0·x[n] + h1·x[n−1]）
    const u = mag * Math.cos(Om * n + phi * DEG)
    return { h_1: h1, h_0: h0, [`u[${n}]`]: u, [`x[${n}]\\,u[${n}]`]: Math.cos(Om * n) * u }
  },
  'HC-06.4': ({ nu, A }) => {
    const H = cdiv(0, nu, 1, nu) // jν/(1 + jν)
    return {
      '\\operatorname{Re}H': H.re,
      '\\operatorname{Im}H': H.im,
      '|H|': Math.hypot(H.re, H.im),
      '\\angle H': Math.atan2(H.im, H.re) / DEG,
      C: 0.5 * A * A * H.re,
    }
  },
  'HC-06.5': ({ nu, zeta }) => {
    const H = cdiv(-nu * nu, 0, 1 - nu * nu, 2 * zeta * nu) // −ν²/(1 − ν² + j2ζν)
    return {
      '\\Delta': (1 - nu * nu) ** 2 + (2 * zeta * nu) ** 2,
      '\\operatorname{Re}H': H.re,
      '\\operatorname{Im}H': H.im,
      '|H|': Math.hypot(H.re, H.im),
      '\\angle H': Math.atan2(H.im, H.re) / DEG,
    }
  },
  'HC-06.6': ({ fref, bw, zeta, f }) => {
    const s = 1 + 2 * zeta * zeta
    const c = Math.sqrt(s + Math.sqrt(s * s + 1))
    const wn = (2 * Math.PI * (bw / fref)) / c
    const Om = (2 * Math.PI * f) / fref
    return { '\\omega_nT_s': wn, K_p: 2 * zeta * wn, K_i: wn * wn, '\\Omega': Om, '\\nu': Om / wn }
  },
  'HC-06.7': ({ zeta, nu1, A1, nu2, A2 }) => {
    const r1 = typeIIRe(nu1, zeta)
    const r2 = typeIIRe(nu2, zeta)
    const C = 0.5 * A1 * A1 * r1 + 0.5 * A2 * A2 * r2
    return { '\\operatorname{Re}H_1': r1, '\\operatorname{Re}H_2': r2, C, 'C/\\sigma_x^2': C / (0.5 * A1 * A1 + 0.5 * A2 * A2) }
  },
  'HC-06.8': ({ frac, wn, D, mu, sigmaV }) => {
    const Ki = wn * wn
    const t = D * frac
    const C = -12 * frac * D + (12 * frac * frac) / Ki
    return { 'R_x[D]/\\sigma_x^2': 1 - 6 * t * (1 - t), 'D^*': frac / Ki, 'C_D/\\sigma_x^2': C, p: 1 - mu * (KQ1 / sigmaV) * C }
  },
}

/** 各題獨立重算的容許誤差（HC-06.8 的模型值是「截斷的脈衝響應」的動差和，與封閉式差 O(1e−9)） */
const RECOMPUTE_TOL: Record<string, { rel: number; abs: number }> = {
  'HC-06.8': { rel: 1e-6, abs: 1e-9 },
}

// ───────────────────────────────────────────────────────────────────────────

describe('第 06 章手算題：登錄', () => {
  it('8 題、id 為 HC-06.n 且唯一、頁面 /ch/06、對應的公式都已登錄；手算練習簿能以 glob 找到', () => {
    expect(HANDCALCS.length).toBeGreaterThanOrEqual(5)
    expect(HANDCALCS.length).toBeLessThanOrEqual(8)
    expect(HANDCALCS.map((h) => h.id)).toEqual(HANDCALCS.map((_, i) => `HC-06.${i + 1}`))
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/06')
      expect(h.formulaId && formulaIds.has(h.formulaId), `${h.id} 的 formulaId ${h.formulaId}`).toBe(true)
      expect(Object.keys(RECOMPUTE)).toContain(h.id)
      expect(h.tips?.length ?? 0).toBeGreaterThan(0)
      // 每個輸入都有「換一題」的手算友善範圍，預設值在合法範圍內
      for (const i of h.inputs) {
        expect(i.practice, `${h.id}.${i.key}`).toBeTruthy()
        if (i.min !== undefined) expect(i.default).toBeGreaterThanOrEqual(i.min)
        if (i.max !== undefined) expect(i.default).toBeLessThanOrEqual(i.max)
      }
      expect(h.validate?.(defaultValues(h)) ?? null, `${h.id} 預設值應合法`).toBeNull()
    }
    expect(handcalcsForPage('/ch/06').map((h) => h.id)).toEqual(HANDCALCS.map((h) => h.id))
    // 難度誠實分層：三種都有
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
  })
})

describe('(a) 預設值 = 模型函式／文中 worked example／golden vector', () => {
  const g = golden('T06')

  it('HC-06.1：思考題 1 的數字 p = 1.016、μ 減半 1.008（= calPole）；E[δ₁] = p·δ₀', () => {
    const sol = solveDefault('HC-06.1')
    near(val(sol, 'p'), 1.016)
    near(val(sol, 'p'), calPole(20, 0.008, -0.1), 0, 0)
    near(val(sol, 'p_{\\mu/2}'), 1.008)
    near(val(sol, 'p_{\\mu/2}'), calPole(10, 0.008, -0.1), 0, 0)
    near(val(sol, 'E[\\delta_1]'), 10.16)
    near(val(sol, 'E[\\delta_2]'), 10.32256)
    // 文中步驟出現的數字
    expect(sol.steps.map((s) => s.tex).join('\n')).toContain('=1.016')
    expect(sol.notes?.join('')).toMatch(/減小 \$\\mu\$ 只會發散得慢一點/)
  })

  it('T06: HC-06.2 預設值重現 golden：C = −0.25、K_q = 0.0079788、pole = 1.0199471', () => {
    const d = byId('HC-06.2')
    const v = defaultValues(d)
    // 預設輸入就是 golden 的輸入（Ω = π/6 ⇔ P = 12）
    expect(v.A).toBe(g.inputs.A)
    expect(v.mag).toBe(g.inputs.H_mag)
    expect(v.phi).toBe(g.inputs.phi_deg)
    near((2 * Math.PI) / v.P, g.inputs.Omega_rad)
    expect(v.mu).toBe(g.inputs.mu)
    const sol = d.solve(v)
    near(val(sol, 'C_D'), g.expected.C as number, 0, 1e-12)
    near(val(sol, 'K_q'), g.inputs.kq_per_fs, 0, 1e-15)
    near(val(sol, 'p'), g.expected.pole as number, 0, 1e-12)
    near(val(sol, 'C_D'), toneCorrelation({ A: 1, mag: 1, phiRad: 120 * DEG, omega: Math.PI / 6 }), 0, 1e-15)
    near(val(sol, 'p'), calPole(10, kqFromSigma(100), -0.25), 0, 1e-15)
    expect(sol.steps[sol.steps.length - 1].tex).toContain('1.0199471')
    // golden 的 φ 清單（0/60/90/120/180°）逐一相符；φ = 90° 的殘渣 3e−17 顯示成 0
    const list = g.expected.C_at_phi_list_deg as number[]
    ;[0, 60, 90, 120, 180].forEach((phi, i) => near(val(d.solve({ ...v, phi }), 'C_D'), list[i], 0, 1e-12))
    expect(val(d.solve({ ...v, phi: 90 }), 'C_D')).toBe(0)
    expect(val(d.solve({ ...v, phi: 90 }), 'p')).toBe(1)
    // §7「試試看」第 4 點：D = 8 ⇒ θ = 360°、C 回到 +0.5（delay alignment）
    near(val(d.solve({ ...v, D: 8 }), 'C_D'), 0.5, 0, 1e-12)
    // 思考題 2：|H| = 0.8、φ = 150°、μ = 5、σ_v = 50（Ω = 0.4 ⇔ P = 2π/0.4）
    const q2 = d.solve({ A: 1, mag: 0.8, phi: 150, P: (2 * Math.PI) / 0.4, D: 0, mu: 5, sigmaV: 50 })
    near(val(q2, 'p'), calPole(5, kqFromSigma(50), toneCorrelation({ A: 1, mag: 0.8, phiRad: 150 * DEG, omega: 0.4 })), 0, 1e-14)
  })

  it('T06: HC-06.3 預設值的 h = golden fir_h = [1, −√3]；第 1 列 u = −0.866、x·u = −0.75（= toneHandTable）', () => {
    const sol = solveDefault('HC-06.3')
    const ref = g.expected.fir_h as number[]
    near(val(sol, 'h_0'), ref[0], 0, 1e-12)
    near(val(sol, 'h_1'), ref[1], 0, 1e-12)
    const h = toneFir(1, 120 * DEG, Math.PI / 6)
    near(val(sol, 'h_0'), h[0], 0, 1e-15)
    near(val(sol, 'h_1'), h[1], 0, 1e-15)
    const table = toneHandTable({ A: 1, mag: 1, phiRad: 120 * DEG, omega: Math.PI / 6, rows: 12 })
    near(val(sol, 'u[1]'), table.u[1], 0, 1e-15)
    near(val(sol, 'x[1]\\,u[1]'), -0.75, 0, 1e-12)
    // 12 列各算一次再平均 = §1 的 C = −0.25
    const d = byId('HC-06.3')
    let s = 0
    for (let n = 0; n < 12; n++) {
      const row = d.solve({ ...defaultValues(d), n })
      near(val(row, `x[${n}]\\,u[${n}]`), table.xu[n], 0, 1e-13)
      s += val(row, `x[${n}]\\,u[${n}]`)
    }
    near(s / 12, -0.25, 0, 1e-12)
    expect(sol.notes?.join('')).toContain('C=-0.25')
  })

  it('HC-06.4：§5.1 的 Type-I 例子 ν = 0.3 ⇒ 0.0826 + j0.2752、73.3°（= ctHpd）', () => {
    const sol = solveDefault('HC-06.4')
    const H = ctHpd('typeI', 0.3)
    near(val(sol, '\\operatorname{Re}H'), H.re, 0, 0)
    near(val(sol, '\\operatorname{Im}H'), H.im, 0, 0)
    expect(val(sol, '\\operatorname{Re}H').toFixed(4)).toBe('0.0826')
    expect(val(sol, '\\operatorname{Im}H').toFixed(4)).toBe('0.2752')
    expect(val(sol, '\\angle H').toFixed(1)).toBe('73.3')
    near(val(sol, 'C'), 0.5 * H.re)
  })

  it('T06: HC-06.5 預設值 = golden hpd_re / hpd_im / hpd_phase_deg（−0.0815 + j0.0376、155.22°）= polarity.ts = pll.ts', () => {
    const d = byId('HC-06.5')
    const v = defaultValues(d)
    expect(v.nu).toBe(g.inputs.hpd_w_over_wn)
    expect(v.zeta).toBe(g.inputs.hpd_zeta)
    const sol = d.solve(v)
    near(val(sol, '\\operatorname{Re}H'), g.expected.hpd_re as number, 0, 1e-12)
    near(val(sol, '\\operatorname{Im}H'), g.expected.hpd_im as number, 0, 1e-12)
    near(val(sol, '\\angle H'), g.expected.hpd_phase_deg as number, 0, 1e-10)
    expect(val(sol, '\\operatorname{Re}H').toFixed(4)).toBe('-0.0815')
    expect(val(sol, '\\operatorname{Im}H').toFixed(4)).toBe('0.0376')
    near(val(sol, '\\Delta'), 1.0045)
    const P = pllCtHpd(0.3, { zeta: 0.7, wn: 1 })
    near(val(sol, '\\operatorname{Re}H'), P.re, 1e-12)
    near(val(sol, '\\operatorname{Im}H'), P.im, 1e-12)
    // 思考題 3：ν = 2 ⇒ Re H = 12/16.84 > 0；ν = 1 ⇒ Re H = 0、相位 90°
    const q3 = d.solve({ nu: 2, zeta: 0.7 })
    near(val(q3, '\\operatorname{Re}H'), 12 / 16.84)
    expect(val(q3, '\\angle H')).toBeLessThan(90)
    const edge = d.solve({ nu: 1, zeta: 0.7 })
    expect(val(edge, '\\operatorname{Re}H')).toBe(0)
    near(val(edge, '\\angle H'), 90)
    expect(edge.steps[edge.steps.length - 1].tex).toContain('90^\\circ')
  })

  it('HC-06.6：BW/f_ref = 0.01、ζ = 0.7 ⇒ ω_nT_s = 0.030665、K_p、K_i（= loopFreqFromBw = designDtLoop）；frac = 0.002 ⇒ Δ = 0.410', () => {
    const sol = solveDefault('HC-06.6')
    const wn = loopFreqFromBw('typeII', 0.01, 0.7)
    near(val(sol, '\\omega_nT_s'), wn, 0, 0)
    expect(wn.toPrecision(5)).toBe('0.030665')
    const ref = designDtLoop({ fs: 100e6, fbw: 1e6, zeta: 0.7 })
    near(val(sol, '\\omega_nT_s'), ref.wnTs)
    near(val(sol, 'K_p'), ref.Kp)
    near(val(sol, 'K_i'), ref.Ki)
    expect(val(sol, 'K_i').toExponential(4)).toBe('9.4037e-4')
    near(val(sol, '\\Omega'), 2 * Math.PI * 0.002)
    expect(val(sol, '\\nu').toFixed(3)).toBe('0.410') // §7 的 Δ
    // 頻寬公式的獨立檢查：在 ω = c_3dB·ω_n 處 |T(jω)|² 恰為 1/2（pll.ts 的 ctT）
    for (const zeta of [0.5, 0.7, 1, 2]) {
      const s = 1 + 2 * zeta * zeta
      const c = Math.sqrt(s + Math.sqrt(s * s + 1))
      const T = ctT(c, { zeta, wn: 1 })
      near(T.re * T.re + T.im * T.im, 0.5, 1e-12)
    }
  })

  it('HC-06.7：tone 1 = §5.2 的 −0.0815、tone 2 = 思考題 3 的 +0.7126；A₂ = 0.3 時 C < 0，A₂ = 0.4 時翻成正的', () => {
    const d = byId('HC-06.7')
    const sol = solveDefault('HC-06.7')
    near(val(sol, '\\operatorname{Re}H_1'), ctHpd('typeII', 0.3, 0.7).re, 0, 0)
    near(val(sol, '\\operatorname{Re}H_2'), ctHpd('typeII', 2, 0.7).re, 0, 0)
    expect(val(sol, '\\operatorname{Re}H_2').toFixed(4)).toBe('0.7126')
    expect(val(sol, 'C')).toBeLessThan(0)
    // 單一 tone 時退化成 F-06.4（toneCorrelation；|H|cosφ = Re H）
    const only1 = d.solve({ ...defaultValues(d), A2: 0 })
    const H1 = ctHpd('typeII', 0.3, 0.7)
    near(val(only1, 'C'), toneCorrelation({ A: 1, mag: Math.hypot(H1.re, H1.im), phiRad: Math.atan2(H1.im, H1.re), omega: 1 }), 1e-12)
    near(val(only1, 'C/\\sigma_x^2'), H1.re, 1e-12)
    const flipped = d.solve({ ...defaultValues(d), A2: 0.4 })
    expect(val(flipped, 'C')).toBeGreaterThan(0)
    expect(flipped.notes?.[0]).toContain('C>0')
    // 加權平均一定落在兩個 Re H 之間
    const ratio = val(sol, 'C/\\sigma_x^2')
    expect(ratio).toBeGreaterThan(val(sol, '\\operatorname{Re}H_1'))
    expect(ratio).toBeLessThan(val(sol, '\\operatorname{Re}H_2'))
  })

  it('T06: HC-06.8（F-06.18 反面情境）：frac = 5e−4、D = 1 ⇒ C₁/σ² ≈ −0.00281 < 0、門檻 0.532；D = 0 ⇒ +12·frac²/K_i = (3/π²)Δ²；與精確自相關和一致', () => {
    const d = byId('HC-06.8')
    const v = defaultValues(d)
    const sol = d.solve(v)
    // §6.4 的表格（S6MultiTone：two = −12·fr·D + 12·fr²/K_i，預設迴路）
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
    const two = -12 * 5e-4 * 1 + (12 * 5e-4 * 5e-4) / des.Ki
    expect(val(sol, 'C_D/\\sigma_x^2').toPrecision(3)).toBe(two.toPrecision(3)) // −0.00281（輸入的 ω_nT_s 只有 5 位）
    expect(val(sol, 'C_D/\\sigma_x^2').toFixed(5)).toBe('-0.00281')
    expect(val(sol, 'D^*').toFixed(3)).toBe((5e-4 / des.Ki).toFixed(3)) // 0.532
    expect(val(sol, 'p')).toBeGreaterThan(1)
    // 精確自相關和（F-06.12 + F-06.17）：兩項近似與它相符
    const h = impulseResponse(des.b, des.a, 8192)
    const exact = autocorrCorrelation(h, sawtoothAutocorr(5e-4), 1)
    near(val(sol, 'C_D/\\sigma_x^2'), exact, 2e-3)
    near(val(sol, 'R_x[D]/\\sigma_x^2'), sawtoothAutocorr(5e-4)(1), 0, 0)
    // D = 0：只剩正的二階項 = (3/π²)Δ²（F-06.14）
    const d0 = d.solve({ ...v, D: 0 })
    const Delta = (2 * Math.PI * v.frac) / v.wn
    near(val(d0, 'C_D/\\sigma_x^2'), (3 / Math.PI ** 2) * Delta * Delta, 1e-6)
    expect(val(d0, 'p')).toBeLessThan(1)
    expect(val(d0, 'R_x[D]/\\sigma_x^2')).toBe(1)
    // preset polarity-fcw-delay1 的數字：frac = 3e−4、D = 1 ⇒ −0.00245
    expect(val(d.solve({ ...v, frac: 3e-4, wn: des.wLTs }), 'C_D/\\sigma_x^2').toFixed(5)).toBe('-0.00245')
  })
})

describe('逐步過程的中間數字 = 紙筆手算（獨立寫在測試裡）；步驟顯示 6 位、答案框 5 位', () => {
  /** 依序在各步驟的 TeX 裡找到這些片段（順序也要對） */
  const expectChain = (id: string, pieces: string[]): void => {
    const tex = solveDefault(id)
      .steps.map((s) => s.tex)
      .join('\n')
    let from = 0
    for (const piece of pieces) {
      const at = tex.indexOf(piece, from)
      expect(at, `${id}：步驟裡依序應出現 ${piece}\n${tex}`).toBeGreaterThanOrEqual(0)
      from = at + piece.length
    }
  }

  it('HC-06.1（思考題 1）：μK_q = 0.16、g = −0.016、p = 1.016、E[G₀] = −0.008、δ₁ = 10.16、δ₂ = 10.32256、p_{μ/2} = 1.008', () => {
    expectChain('HC-06.1', ['=0.16', '=-0.016', '=1.016', '=-0.008', '=10.16', '=10.32256', '=1.008'])
  })

  it('T06: HC-06.2（§1 手算表）：Ω = 30°、θ = 120°、cos θ = −0.5、A²/2 = 0.5、C = −0.25、K_q = 0.00797885、g = −0.0199471、p = 1.0199471', () => {
    expectChain('HC-06.2', ['=30^\\circ', '=120^\\circ', '=-0.5', '=0.5', '=-0.25', '=0.00797885', '=-0.0199471', '=1.0199471'])
  })

  it('T06: HC-06.3：sin 120° = 0.866025、sin 30° = 0.5 ⇒ h₁ = −1.73205；h₀ = 1；x[1] = 0.866025、u[1] = −0.866025、x·u = −0.75', () => {
    expectChain('HC-06.3', ['=30^\\circ', '=0.866025', '=0.5', '=-1.73205', '=-0.5', '=0.866025', '=1', 'x[1]=', '=0.866025', 'x[0]=', '=1', '=-0.866025', '=-0.866025', '=-0.75'])
  })

  it('HC-06.4（§5.1）：ν² = 0.09、1 + ν² = 1.09、Re = 0.0825688、Im = 0.275229、|H| = 0.3/1.04403 = 0.287348、∠H = 90° − 16.6992° = 73.3008°', () => {
    expectChain('HC-06.4', ['=0.09', '=1.09', '=0.0825688', '=0.275229', '\\sqrt{1.09}', '1.04403', '=0.287348', '16.6992^\\circ', '=73.3008^\\circ', '=0.0412844'])
  })

  it('T06: HC-06.5（規格 §6.1）：a = 0.91、b = 0.42、Δ = 0.8281 + 0.1764 = 1.0045、分子 −0.0819／0.0378、H = −0.0815331 + j0.0376307、|H| = 0.09/1.00225、∠H = 180° − 24.7751° = 155.225°', () => {
    expectChain('HC-06.5', ['=0.09', '=0.91', '=0.42', '=0.8281+0.1764=1.0045', '=-0.0819', '=0.0378', '=-0.0815331', '=0.0376307', '\\sqrt{1.0045}', '1.00225', '=0.0897982', '24.7751^\\circ', '=155.225^\\circ'])
  })

  it('HC-06.6：BW/f_ref = 0.01、β = 1.98、√4.9204 = 2.2182、c = 2.04895、ω_nT_s = 0.0306654、K_p = 0.0429315、K_i = 0.000940366、Ω = 0.0125664、ν = 0.40979', () => {
    expectChain('HC-06.6', ['=0.01', '=1.98', '\\sqrt{4.9204}=2.2182', '=2.04895', '6.28319\\times0.01', '=0.0306654', '=0.0429315', '=0.000940366', '=0.0125664', '=0.40979'])
  })

  it('HC-06.7：兩個 tone 的 a、b、Δ、Re H；P = 0.5、0.045；C = −0.04076655 + 0.03206651 = −0.00870004（相減抵消 1 位 ⇒ 中間值顯示 7 位）；C/σ² = −0.0159634', () => {
    // tone 1（ν = 0.3）與 HC-06.5 相同；tone 2（ν = 2）：a = −3、b = 2.8、Δ = 9 + 7.84 = 16.84、Re H = 12/16.84 = 0.7125891
    expectChain('HC-06.7', [
      '=1-0.09=0.91',
      '=0.42',
      '=0.8281+0.1764=1.0045',
      '\\frac{-0.0819}{1.0045}=-0.0815331',
      '=1-4=-3',
      '=2.8',
      '=9+7.84=16.84',
      '\\frac{12}{16.84}=0.7125891',
      '=0.5',
      '=0.045',
      '=-0.04076655',
      '=0.03206651',
      '=-0.04076655+0.03206651=-0.00870004',
      '=0.545',
      '=-0.0159634',
    ])
    // 手算：只留 6 位的 −0.0407666 + 0.0320665 = −0.0087001（第 5 位就不對了）；多留一位才得到 −0.00870004
    expect((-0.0407666 + 0.0320665).toPrecision(5)).not.toBe(val(solveDefault('HC-06.7'), 'C').toPrecision(5))
    expect((-0.04076655 + 0.03206651).toPrecision(5)).toBe(val(solveDefault('HC-06.7'), 'C').toPrecision(5))
    expect(solveDefault('HC-06.7').notes?.join('')).toMatch(/顯示 7 位/)
  })

  it('T06: HC-06.8（§6.4 表格）：K_i = 0.0306654² = 0.000940367、Δ = 0.102447、R/σ² = 1 − 0.0029985 = 0.9970015、D* = 0.531707、−0.006 + 0.00319024 = −0.00280976、g = −0.00336279、p = 1.00336279', () => {
    expectChain('HC-06.8', [
      '0.0306654^2=0.000940367',
      '=0.102447',
      '=0.0005',
      '=1-0.0029985=0.9970015',
      '=0.531707',
      '=-0.006',
      '\\frac{3\\times10^{-6}}{0.000940367}=0.00319024',
      '=-0.006+0.00319024=-0.00280976',
      '=0.00797885',
      '=-0.00336279',
      '=1.00336279',
    ])
    // 預設的 ω_nT_s 就是 HC-06.6 答案框顯示的 6 位數字（兩題接得起來）
    const d6 = byId('HC-06.6')
    const wn6 = d6.solve(defaultValues(d6)).results.find((r) => r.symbol === '\\omega_nT_s')!
    expect(defaultValues(byId('HC-06.8')).wn).toBe(Number(wn6.value.toPrecision(wn6.digits ?? 5)))
    expect(defaultValues(byId('HC-06.8')).wn).toBe(0.0306654)
  })

  it('保護位數：把步驟顯示的 6 位數字原樣代進下一步（計算機照按），答案框的 5 位有效數字不變', () => {
    const sig5 = (x: number): string => Number(x.toPrecision(5)).toString()
    // HC-06.5：|H| = 0.09/1.00225（只留 5 位的 1.0022 會得到 0.089802，第 4 位就錯了）
    const s5 = solveDefault('HC-06.5')
    expect(sig5(0.09 / 1.00225)).toBe(sig5(val(s5, '|H|')))
    expect(sig5(0.09 / 1.0022)).not.toBe(sig5(val(s5, '|H|')))
    expect(sig5(-0.0819 / 1.0045)).toBe(sig5(val(s5, '\\operatorname{Re}H')))
    expect(sig5(0.0378 / 1.0045)).toBe(sig5(val(s5, '\\operatorname{Im}H')))
    // HC-06.6：K_p、K_i、ν 都由顯示的 ω_nT_s = 0.0306654、Ω = 0.0125664 算出
    const s6 = solveDefault('HC-06.6')
    expect(sig5((6.28319 * 0.01) / 2.04895)).toBe(sig5(val(s6, '\\omega_nT_s')))
    expect(sig5(2 * 0.7 * 0.0306654)).toBe(sig5(val(s6, 'K_p')))
    expect(sig5(0.0306654 ** 2)).toBe(sig5(val(s6, 'K_i')))
    expect(sig5(0.030665 ** 2)).not.toBe(sig5(val(s6, 'K_i'))) // 只留 5 位的 0.030665 會得到 0.00094034
    expect(sig5(0.0125664 / 0.0306654)).toBe(sig5(val(s6, '\\nu')))
    // 上面兩個反例就是提示裡引用的數字
    expect(byId('HC-06.5').tips?.join('')).toContain(`|H|=0.09/1.0022=${sig5(0.09 / 1.0022)}$，和正確的 $${sig5(val(s5, '|H|'))}$`) // 0.089802 vs 0.089798
    expect(byId('HC-06.6').tips?.join('')).toContain(String.raw`K_i=${(0.030665 ** 2 * 1e4).toFixed(4)}\times10^{-4}$，而不是 $${(val(s6, 'K_i') * 1e4).toFixed(4)}\times10^{-4}$`)
    expect(byId('HC-06.6').tips?.join('')).toContain(`範例是 $${Number(val(s6, '\\omega_nT_s').toPrecision(6))}$`)
    // HC-06.4：|H| = 0.3/1.04403；HC-06.3：u[1] = 0.866025 − 1.73205
    expect(sig5(0.3 / 1.04403)).toBe(sig5(val(solveDefault('HC-06.4'), '|H|')))
    expect(sig5(1 * 0.866025 + -1.73205 * 1)).toBe(sig5(val(solveDefault('HC-06.3'), 'u[1]')))
    // HC-06.8：C_D/σ² 與 D*
    const s8 = solveDefault('HC-06.8')
    expect(sig5(-0.006 + (12 * 0.0005 ** 2) / 0.000940367)).toBe(sig5(val(s8, 'C_D/\\sigma_x^2')))
    expect(sig5(0.0005 / 0.000940367)).toBe(sig5(val(s8, 'D^*')))
  })
})

describe('手算提示裡的數字與近似式（不是手打的假數字）', () => {
  const tipsOf = (id: string): string => (byId(id).tips ?? []).join('\n')

  it('HC-06.6：ζ = 0.5、0.7、1 的 c_3dB 對照值 = 獨立公式 √(β + √(β² + 1))、β = 1 + 2ζ²（= 1.817、2.049、2.482）', () => {
    const expected = [0.5, 0.7, 1].map((zeta) => {
      const s2 = 1 + 2 * zeta * zeta
      return Math.sqrt(s2 + Math.sqrt(s2 * s2 + 1)).toFixed(3)
    })
    expect(expected).toEqual(['1.817', '2.049', '2.482'])
    expect(tipsOf('HC-06.6')).toContain(String.raw`c_{3\mathrm{dB}}=1.817,\ 2.049,\ 2.482$`)
    // 這三個值真的滿足 |T(jω)|² = 1/2（pll.ts 的 ctT）
    ;[0.5, 0.7, 1].forEach((zeta, i) => {
      const T = ctT(Number(expected[i]), { zeta, wn: 1 })
      near(T.re * T.re + T.im * T.im, 0.5, 2e-3)
    })
  })

  it('HC-06.4：tan⁻¹ 的常用值與小角度近似 57.3°×ν 的誤差宣稱（ν ≤ 0.3：< 3%、相位差 < 0.5°；|H| ≈ ν、Re H ≈ ν²）', () => {
    const tips = tipsOf('HC-06.4')
    const atanDeg = (x: number): number => Math.atan(x) / DEG
    expect(tips).toContain(String.raw`\tan^{-1}0.3=${atanDeg(0.3).toFixed(2)}^\circ`) // 16.70
    expect(tips).toContain(String.raw`\tan^{-1}2=${atanDeg(2).toFixed(2)}^\circ`) // 63.43
    expect((180 / Math.PI).toFixed(1)).toBe('57.3')
    for (const nu of [0.05, 0.1, 0.2, 0.3]) {
      const exact = atanDeg(nu)
      const approx = 57.3 * nu
      expect(Math.abs(approx - exact) / exact).toBeLessThan(0.03) // 相對誤差 < 3%
      expect(Math.abs(approx - exact)).toBeLessThan(0.5) // 相位差 < 0.5°
      near(approx / exact - 1, (nu * nu) / 3, 0.1, 2e-4) // 誤差 ≈ ν²/3
      const H = ctHpd('typeI', nu)
      near(nu / Math.hypot(H.re, H.im) - 1, (nu * nu) / 2, 0.05) // |H| ≈ ν 高估約 ν²/2
      near((nu * nu) / H.re - 1, nu * nu, 1e-9) // Re H ≈ ν² 高估恰為 ν²
    }
    near((0.3 * 0.3) / ctHpd('typeI', 0.3).re - 1, 0.09, 1e-9) // 提示裡的「9%」
    // 範例提示的數字就是預設值的答案
    const sol = solveDefault('HC-06.4')
    expect(tips).toContain(`H=${val(sol, '\\operatorname{Re}H').toFixed(4)}+j${val(sol, '\\operatorname{Im}H').toFixed(4)}`)
    expect(tips).toContain(String.raw`相位 $${val(sol, '\\angle H').toFixed(1)}^\circ$`)
  })

  it('HC-06.2／HC-06.3／HC-06.8：提示引用的常用值（cos、√(2/π)、h = [1, −√3]、D = 0 的 +0.00319）', () => {
    const t2 = tipsOf('HC-06.2')
    expect(t2).toContain(String.raw`\cos150^\circ=${Math.cos(150 * DEG).toFixed(6)}`) // −0.866025（與步驟顯示的 6 位一致）
    expect(t2).toContain(String.raw`\cos135^\circ=${Math.cos(135 * DEG).toFixed(6)}`) // −0.707107
    expect(t2).toContain(`p=${val(solveDefault('HC-06.2'), 'p').toFixed(7)}`) // 1.0199471
    const t3 = tipsOf('HC-06.3')
    expect(t3).toContain(`[1,\\,${val(solveDefault('HC-06.3'), 'h_1').toFixed(5)}]`) // −1.73205
    expect(t3).toContain(String.raw`\cos30^\circ=\sin60^\circ=${Math.cos(30 * DEG).toFixed(6)}`) // 0.866025
    expect(tipsOf('HC-06.6')).toContain(String.raw`2\pi=${(2 * Math.PI).toPrecision(6)}`) // 6.28319
    const d8 = byId('HC-06.8')
    const t8 = tipsOf('HC-06.8')
    expect(t8).toContain(String.raw`\sqrt{2/\pi}=${KQ1.toFixed(6)}`) // 0.797885（與步驟顯示的 6 位一致）
    expect(t8).toContain(`+${val(d8.solve({ ...defaultValues(d8), D: 0 }), 'C_D/\\sigma_x^2').toFixed(5)}`) // +0.00319
    expect(t8).toContain(`D^*=${val(solveDefault('HC-06.8'), 'D^*').toFixed(3)}`) // 0.532
    // HC-06.6 的範例提示：ω_nT_s、K_i、ν
    const s6 = solveDefault('HC-06.6')
    const t6 = tipsOf('HC-06.6')
    expect(t6).toContain(`\\omega_nT_s=${val(s6, '\\omega_nT_s').toPrecision(6)}`) // 0.0306654
    expect(t8).toContain(`\\omega_nT_s=${val(s6, '\\omega_nT_s').toPrecision(6)}`) // HC-06.8 的範例提示引用同一個數字
    expect(t6).toContain(String.raw`K_i=${(val(s6, 'K_i') * 1e4).toFixed(4)}\times10^{-4}`) // 9.4037×10⁻⁴
    expect(t6).toContain(`\\nu=\\Delta=${val(s6, '\\nu').toFixed(3)}`) // 0.410
  })
})

describe('(b) 隨機數字：有限、且等於測試內獨立重算', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：20 個 seed 的 solve() 與獨立公式一致，TeX 全部可渲染', (id, def) => {
    const tol = RECOMPUTE_TOL[id] ?? { rel: 1e-9, abs: 1e-12 }
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      expect(def.validate?.(v) ?? null, `${id} seed ${seed}：${JSON.stringify(v)}`).toBeNull()
      seen.add(JSON.stringify(v))
      const sol = def.solve(v)
      const ref = RECOMPUTE[id](v)
      expect(sol.results.map((r) => r.symbol).sort()).toEqual(Object.keys(ref).sort())
      for (const r of sol.results) {
        expect(Number.isFinite(r.value), `${id} seed ${seed} ${r.symbol}`).toBe(true)
        expect(Math.abs(r.value - ref[r.symbol]), `${id} seed ${seed} ${r.symbol}: ${r.value} vs ${ref[r.symbol]}（${JSON.stringify(v)}）`).toBeLessThanOrEqual(
          tol.abs + tol.rel * Math.abs(ref[r.symbol]),
        )
      }
      expectSolutionTexOk(def, sol, `seed ${seed}`)
    }
    expect(seen.size, `${id}：「換一題」應該真的換題`).toBeGreaterThan(8)
  })

  it('預設值的解同樣通過獨立重算', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const sol = def.solve(v)
      const ref = RECOMPUTE[def.id](v)
      const tol = RECOMPUTE_TOL[def.id] ?? { rel: 1e-9, abs: 1e-12 }
      for (const r of sol.results) {
        expect(Math.abs(r.value - ref[r.symbol]), `${def.id} ${r.symbol}`).toBeLessThanOrEqual(tol.abs + tol.rel * Math.abs(ref[r.symbol]))
      }
      expectSolutionTexOk(def, sol, 'default')
      for (const t of def.tips ?? []) expectMathTextOk(t, `${def.id} tip`)
      expectMathTextOk(def.title, `${def.id} title`)
      expect(renderTex(def.formulaTex, true), def.id).not.toContain('katex-error')
      for (const i of def.inputs) {
        expect(renderTex(i.symbol, false), `${def.id}.${i.key}`).not.toContain('katex-error')
        if (i.unit) expect(renderTex(i.unit, false), `${def.id}.${i.key} unit`).not.toContain('katex-error')
        expectMathTextOk(i.label, `${def.id}.${i.key} label`)
      }
    }
  })

  it('HC-06.8 的公式摘要排成兩行（gathered）：一行排完在桌機的正文欄會超出幾個像素，多出一條沒有用途的橫向捲軸', () => {
    const def = HANDCALCS.find((h) => h.id === 'HC-06.8')!
    expect(def.formulaTex.startsWith(String.raw`\begin{gathered}`)).toBe(true)
    const lines = def.formulaTex.replace(/\\begin\{gathered\}|\\end\{gathered\}/g, '').split(/\\\\(?:\[[^\]]*\])?/)
    expect(lines).toHaveLength(2)
    // 內容不變：第一行是鋸齒自相關（F-06.17），第二行是 C_D 的近似式（F-06.18）與 pole
    expect(lines[0]).toContain(String.raw`\frac{R_x[\ell]}{\sigma_x^2}=1-6\,t_\ell(1-t_\ell)`)
    expect(lines[0]).toContain(String.raw`t_\ell=|\ell|\,\mathrm{frac}`)
    expect(lines[1]).toContain(String.raw`\frac{C_D}{\sigma_x^2}\approx-12\,\mathrm{frac}\,D+\frac{12\,\mathrm{frac}^2}{K_i}`)
    expect(lines[1]).toContain(String.raw`K_i=(\omega_nT_s)^2`)
    expect(lines[1]).toContain(String.raw`p=1-\mu K_qC_D`)
  })

  it('沒有用途的捲軸：窄螢幕上手算步驟的等式鏈在等號後面換行，不為了幾個像素橫向捲動（桌機不受影響）', () => {
    // jsdom 不排版，這裡只確認規則還在、選擇器對得上真正的 DOM；實際寬度用
    // `node scripts/scroll-audit.mjs --routes /ch/06 --viewport mobile` 量（規則拿掉的話，375px 的手機上
    // HC-06.4「Im H = …」只比 284px 的欄位寬 6px、HC-06.7 最後一步只寬 2px，各多一列只能捲幾個像素的捲動區）。
    const css = readFileSync(resolve(process.cwd(), 'src/chapters/ch06/chapter.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const mobile = css.match(/@media \(max-width: 640px\) \{\s*\.ch06 \.c-handcalc \.c-step-tex \.katex-display > \.katex \{([^}]*)\}/)
    expect(mobile).not.toBeNull()
    expect(mobile?.[1]).toContain('white-space: normal')
    // 這條規則只出現在 @media 裡：桌機上的步驟維持一行（放不下才捲動）
    expect(css.match(/\.c-step-tex \.katex-display > \.katex \{/g)).toHaveLength(1)
    // 選擇器的前提：每一步的公式是 .c-handcalc 裡 .c-step-tex 底下的 display math（KaTeX 把最外層的等式鏈拆成好幾個可以換行的 .base）
    const { container, unmount } = render(<HandCalc def={HANDCALCS.find((h) => h.id === 'HC-06.4')!} />)
    const steps = Array.from(container.querySelectorAll('.c-handcalc .c-step-tex .katex-display > .katex'))
    expect(steps.length).toBe(container.querySelectorAll('.c-step').length)
    expect(steps.length).toBeGreaterThan(0)
    const imStep = steps.find((el) => /Im/.test(el.querySelector('annotation')?.textContent ?? ''))!
    expect(imStep).toBeDefined()
    expect(imStep.querySelectorAll('.katex-html > .base').length).toBeGreaterThanOrEqual(3)
    unmount()
  })

  it('pole 類答案的容許誤差以 |p − 1| 計：把 1.0199 答成 1.01 或 1.03 不會被判為正確', () => {
    const sol = solveDefault('HC-06.2')
    const p = sol.results.find((r) => r.symbol === 'p')!
    expect(checkAnswer(1.0199, p).ok).toBe(true)
    expect(checkAnswer(1.02, p).ok).toBe(true)
    expect(checkAnswer(1.01, p).ok).toBe(false)
    expect(checkAnswer(1.03, p).ok).toBe(false)
    expect(checkAnswer(0.98, p).ok).toBe(false) // 把 C 的負號弄丟
  })
})

describe('(c) validate 擋掉模型不適用的輸入，並解釋原因', () => {
  const reject = (id: string, patch: Record<string, number>, pattern: RegExp): void => {
    const def = byId(id)
    const msg = def.validate?.({ ...defaultValues(def), ...patch }) ?? null
    expect(msg, `${id} ${JSON.stringify(patch)} 應被拒絕`).not.toBeNull()
    expect(msg as string).toMatch(pattern)
    expect((msg as string).length, `${id}：訊息要解釋原因`).toBeGreaterThan(20)
    expectMathTextOk(msg as string, `${id} validate ${JSON.stringify(patch)}`)
  }
  const accept = (id: string, patch: Record<string, number>): void => {
    const def = byId(id)
    expect(def.validate?.({ ...defaultValues(def), ...patch }) ?? null, `${id} ${JSON.stringify(patch)}`).toBeNull()
  }

  it('HC-06.1：μ ≤ 0（本章只談正的 learning rate）、K_q ≤ 0', () => {
    reject('HC-06.1', { mu: 0 }, /learning rate/)
    reject('HC-06.1', { mu: -20 }, /變號/)
    reject('HC-06.1', { Kq: 0 }, /K_q/)
    accept('HC-06.1', { C: 0 }) // C = 0 是合法且重要的情況（p = 1）
    expect(val(byId('HC-06.1').solve({ C: 0, Kq: 0.008, mu: 20, d0: 10 }), 'p')).toBe(1)
  })

  it('HC-06.2／HC-06.3：P = 2（Ω = π，E46 邊界）與 P < 2（超過 Nyquist）；σ_v ≤ 0；μ ≤ 0', () => {
    reject('HC-06.2', { P: 2 }, /E46/)
    reject('HC-06.2', { P: 1.5 }, /Nyquist/)
    reject('HC-06.2', { sigmaV: 0 }, /sigma_v/)
    reject('HC-06.2', { mu: -1 }, /learning rate/)
    accept('HC-06.2', { P: 2.5 })
    reject('HC-06.3', { P: 2 }, /E46/)
    reject('HC-06.3', { P: 1 }, /Nyquist/)
    // 模型本身在這個邊界會丟錯（toneFir）——validate 必須先擋下來
    expect(() => toneFir(1, 120 * DEG, Math.PI)).toThrow(/E46/)
  })

  it('HC-06.4／HC-06.5：ν ≤ 0（DC：H = 0、相位沒有定義）；ζ ≤ 0', () => {
    reject('HC-06.4', { nu: 0 }, /DC/)
    reject('HC-06.5', { nu: 0 }, /DC/)
    reject('HC-06.5', { zeta: 0 }, /zeta/)
    accept('HC-06.5', { nu: 1 })
  })

  it('HC-06.6：f ≥ f_s/2（Nyquist）、f = 0、ζ ≤ 0、頻寬大到主 PLL 不穩定', () => {
    reject('HC-06.6', { f: 50 }, /Nyquist/)
    reject('HC-06.6', { f: 80 }, /Nyquist/)
    reject('HC-06.6', { f: 0 }, /DC/)
    reject('HC-06.6', { zeta: 0 }, /zeta/)
    reject('HC-06.6', { bw: 0 }, /正的頻率/)
    reject('HC-06.6', { bw: 40 }, /不穩定/) // BW/f_ref = 0.4
    expect(designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.4, loopDelay: 0 }).stable).toBe(false)
    accept('HC-06.6', { fref: 4000, bw: 320, f: 8 }) // BW/f_ref = 0.08：可算，但會提醒 ω_nT_s 不夠小
    const big = byId('HC-06.6').solve({ fref: 4000, bw: 320, zeta: 0.7, f: 8 })
    near(val(big, '\\omega_nT_s'), loopFreqFromBw('typeII', 0.08, 0.7), 0, 0)
    expect(big.notes?.join('')).not.toMatch(/E44），極性邊界與相位請以/) // 0.245 < 0.3：不出現警告
    const bigger = byId('HC-06.6').solve({ fref: 100, bw: 15, zeta: 0.7, f: 1 })
    expect(bigger.notes?.join('')).toMatch(/不算「遠小於 1」/)
  })

  it('HC-06.7：ν₁ = ν₂（同頻率不能把功率相加）、ν ≤ 0、沒有 code、ζ ≤ 0', () => {
    reject('HC-06.7', { nu2: 0.3 }, /同頻率/)
    reject('HC-06.7', { nu1: 0 }, /DC/)
    reject('HC-06.7', { A1: 0, A2: 0 }, /沒有 code/)
    reject('HC-06.7', { zeta: 0 }, /zeta/)
    accept('HC-06.7', { A2: 0 })
  })

  it('HC-06.8：D > d + 1（F-06.18 的適用範圍）、Δ ≥ 1（不是近整數）、frac 不在 (0, 0.5]、不穩定、σ_v、μ', () => {
    reject('HC-06.8', { D: 2 }, /d\+1/)
    reject('HC-06.8', { D: 3 }, /d\+1/)
    accept('HC-06.8', { D: 3, d: 2 })
    reject('HC-06.8', { frac: 0.01 }, /動差展開/) // Δ = 2.05
    reject('HC-06.8', { frac: 0 }, /整數 FCW/)
    reject('HC-06.8', { frac: 0.7 }, /Nyquist/)
    reject('HC-06.8', { wn: 1.2, frac: 0.05 }, /不穩定/)
    reject('HC-06.8', { wn: 1e-4, frac: 1e-6 }, /太小/)
    reject('HC-06.8', { sigmaV: 0 }, /sigma_v/)
    reject('HC-06.8', { mu: 0 }, /learning rate/)
    // 被擋下的 D > d + 1：訊息用「使用者自己的數字」說明硬套兩項式會差多少（−0.021 vs −0.0178），數字來自模型函式
    const d8 = byId('HC-06.8')
    const v8: Record<string, number> = { ...defaultValues(d8), D: 3, frac: 0.002 }
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: v8.wn, loopDelay: 0 })
    const h = impulseResponse(des.b, des.a, 8192)
    const two = -12 * 0.002 * 3 + (12 * 0.002 * 0.002) / des.Ki
    const exact = autocorrCorrelation(h, sawtoothAutocorr(0.002), 3)
    expect(two.toFixed(3)).toBe('-0.021')
    expect(exact.toFixed(4)).toBe('-0.0178')
    const msg = d8.validate?.(v8) ?? ''
    expect(msg).toContain(`$${texNum(two, 3)}$`)
    expect(msg).toContain(`$${texNum(exact, 3)}$`)
    // 換一組數字，訊息裡的數字跟著變（不是寫死的例子）
    const msg2 = d8.validate?.({ ...defaultValues(d8), D: 2 }) ?? ''
    expect(msg2).not.toContain(`$${texNum(two, 3)}$`)
    expect(msg2).toContain(`$${texNum(autocorrCorrelation(h, sawtoothAutocorr(5e-4), 2), 3)}$`)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 把每一步的 TeX 重新「按一次計算機」：畫面上的數字自己要算得出下一個等號
// ───────────────────────────────────────────────────────────────────────────

/** 去掉單位與排版用的空白，科學記號 a\times10^{b} → (aeb) */
function normalizeTex(src: string): string {
  return src
    .replace(/\\ \\mathrm\{fs\}\^\{-1\}/g, '')
    .replace(/\\ \\mathrm\{rad\/sample\}/g, '')
    .replace(/\\text\{\/sample\}/g, '')
    .replace(/\\approx/g, '=')
    .replace(/(\d[\d.]*)\\times10\^\{(-?\d+)\}/g, '($1e$2)')
    .replace(/(?<![\d.])10\^\{(-?\d+)\}/g, '(1e$1)')
    .replace(/\^\\circ/g, '')
    .replace(/\\[,;]/g, '')
    .trim()
}

/** 在大括號深度 0 的位置切開 */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    if (depth === 0 && src.startsWith(sep, i)) {
      out.push(cur)
      cur = ''
      i += sep.length - 1
      continue
    }
    cur += src[i]
  }
  out.push(cur)
  return out
}

class NotNumeric extends Error {}

/**
 * 只認得手算步驟會出現的 TeX 子集（+ − \times \frac \sqrt ^2 \cos \sin \tan^{-1}、括號、科學記號；角度一律用度）。
 * 片段裡有符號（字母）就丟 NotNumeric——那是「符號式」，不是要算的數字。
 */
function evalNumericTex(source: string): number {
  const s = normalizeTex(source)
  let i = 0
  const eat = (tok: string): boolean => {
    if (s.startsWith(tok, i)) {
      i += tok.length
      return true
    }
    return false
  }
  const group = (open: string, close: string): number => {
    if (!eat(open)) throw new NotNumeric(`預期 ${open}：${s.slice(i, i + 12)}`)
    const v = expr()
    if (!eat(close)) throw new NotNumeric(`預期 ${close}：${s.slice(i, i + 12)}`)
    return v
  }
  const atom = (): number => {
    if (eat('\\frac')) {
      const a = group('{', '}')
      const b = group('{', '}')
      return a / b
    }
    if (eat('\\sqrt')) return Math.sqrt(group('{', '}'))
    if (eat('\\cos')) return Math.cos(group('(', ')') * DEG)
    if (eat('\\sin')) return Math.sin(group('(', ')') * DEG)
    if (eat('\\tan^{-1}')) return Math.atan(s[i] === '(' ? group('(', ')') : atom()) / DEG
    if (s[i] === '(') return group('(', ')')
    const m = /^\d+(?:\.\d+)?(?:e-?\d+)?/.exec(s.slice(i))
    if (!m) throw new NotNumeric(`不是數字：${s.slice(i, i + 12)}`)
    i += m[0].length
    return Number(m[0])
  }
  const power = (): number => {
    let v = atom()
    while (eat('^2')) v *= v
    return v
  }
  const unary = (): number => (eat('-') ? -unary() : power())
  const term = (): number => {
    let v = unary()
    while (eat('\\times') || eat('\\cdot')) v *= unary()
    return v
  }
  function expr(): number {
    let v = term()
    for (;;) {
      if (eat('+')) v += term()
      else if (eat('-')) v -= term()
      else return v
    }
  }
  const v = expr()
  if (i !== s.length) throw new NotNumeric(`剩下：${s.slice(i, i + 12)}`)
  return v
}

/** 片段若是「單獨一個數字」，回傳它最後一位的單位（0.866025 → 1e−6；3\times10^{-6} → 1e−6）；否則 0 */
function lastDigitUnit(seg: string): number {
  const m = /^\(?-?(\d+)(?:\.(\d+))?(?:e(-?\d+))?\)?$/.exec(normalizeTex(seg).replace(/^\((.*)\)$/, '$1'))
  return m ? 10 ** (Number(m[3] ?? 0) - (m[2]?.length ?? 0)) : 0
}

interface ChainLink {
  tex: string
  value: number
}

/**
 * 排成對齊兩行的步驟（`\begin{aligned}a&=b\\&=c\end{aligned}`）：拿掉換行與對齊記號，還原成一行的「a=b=c」。
 * 這樣換行不會讓任何一段數字躲過下面的重新計算。
 */
function unalign(stepTex: string): string {
  if (!stepTex.startsWith(String.raw`\begin{aligned}`)) return stepTex
  return stepTex
    .replace(/\\begin\{aligned\}|\\end\{aligned\}/g, '')
    .replace(/\\\\(?:\[[^\]]*\])?/g, '')
    .replace(/&/g, '')
}

/** 一步的 TeX → 每條等式鏈裡「看得出數值」的片段（符號式跳過） */
function numericChains(stepTex: string): ChainLink[][] {
  return splitTop(unalign(stepTex), ',\\qquad').map((part) => {
    const links: ChainLink[] = []
    for (const seg of splitTop(part.replace(/\\approx/g, '='), '=')) {
      try {
        links.push({ tex: seg.trim(), value: evalNumericTex(seg) })
      } catch (e) {
        if (!(e instanceof NotNumeric)) throw e
      }
    }
    return links
  })
}

describe('每一步的 TeX 自己就算得出下一個等號（把畫面上的數字原樣按進計算機）', () => {
  it('evalNumericTex：手算步驟用到的 TeX 子集', () => {
    near(evalNumericTex(String.raw`\frac{6.28319\times0.01}{2.04895}`), (6.28319 * 0.01) / 2.04895)
    near(evalNumericTex(String.raw`1\times(-0.5)-(-1.73205)\times0.866025`), -0.5 + 1.73205 * 0.866025)
    near(evalNumericTex(String.raw`180^\circ-\tan^{-1}\frac{0.42}{0.91}`), 180 - Math.atan(0.42 / 0.91) / DEG)
    near(evalNumericTex(String.raw`90^\circ-\tan^{-1}(0.3)`), 90 - Math.atan(0.3) / DEG)
    near(evalNumericTex(String.raw`2\times\cos(45^\circ\times5+90^\circ)`), 2 * Math.cos(315 * DEG))
    near(evalNumericTex(String.raw`\frac{12\times(2\times10^{-5})^2}{0.0009}`), (12 * 4e-10) / 0.0009)
    near(evalNumericTex(String.raw`(-3)^2+2.8^2`), 16.84)
    near(evalNumericTex(String.raw`\sqrt{1.98^2+1}`), Math.sqrt(4.9204))
    near(evalNumericTex(String.raw`0.00797885\ \mathrm{fs}^{-1}`), 0.00797885)
    near(evalNumericTex(String.raw`-10^{8}`), -1e8)
    expect(() => evalNumericTex(String.raw`\mu K_q`)).toThrow(NotNumeric)
    expect(() => evalNumericTex(String.raw`h_0\,x[1]+h_1\,x[0]`)).toThrow(NotNumeric)
    expect(lastDigitUnit('0.866025')).toBeCloseTo(1e-6, 12)
    expect(lastDigitUnit(String.raw`3\times10^{-6}`)).toBeCloseTo(1e-6, 12)
    expect(lastDigitUnit(String.raw`\frac{1}{2}`)).toBe(0)
  })

  /** 相鄰兩個數值片段要相等：容許「前一段用顯示的 6 位數字算」造成的 1e−5 相對誤差，加上結果最後一位的 1 個單位 */
  const expectStepsReproducible = (def: HandCalcDef, v: Record<string, number>, tag: string): void => {
    const sol = def.solve(v)
    const finals: number[] = []
    sol.steps.forEach((step, k) => {
      for (const chain of numericChains(step.tex)) {
        const where = `${def.id} ${tag} step ${k + 1}：${step.tex}`
        // 每條等式鏈至少有「代入數字的式子」與「結果」兩個數值片段
        expect(chain.length, where).toBeGreaterThanOrEqual(2)
        for (let j = 1; j < chain.length; j++) {
          const prev = chain[j - 1]
          const cur = chain[j]
          const limit = 1e-5 * Math.abs(cur.value) + lastDigitUnit(cur.tex)
          expect(Math.abs(prev.value - cur.value), `${where}\n  ${prev.tex} = ${prev.value}，但畫面寫 ${cur.tex}`).toBeLessThanOrEqual(limit)
        }
        finals.push(chain[chain.length - 1].value)
      }
    })
    // 每個答案都是某一步算出來的最後一個數字（答案框不會憑空出現步驟裡沒有的量）
    for (const r of sol.results) {
      const hit = finals.some((x) => Math.abs(x - r.value) <= 2e-5 * Math.abs(r.value) + 2e-6)
      expect(hit, `${def.id} ${tag}：答案 ${r.symbol} = ${r.value} 不在任何一步的結果裡`).toBe(true)
    }
  }

  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值與 20 組隨機數字，每個等號都算得出來', (_id, def) => {
    expectStepsReproducible(def, defaultValues(def), 'default')
    for (let seed = 1; seed <= 20; seed++) expectStepsReproducible(def, randomValues(def, seed), `seed ${seed}`)
  })

  it('相減會抵消有效位數的地方自動多留位數：HC-06.7 的 C₁ + C₂、HC-06.8 的一階項 + 二階項、HC-06.4 的 90° − tan⁻¹ν', () => {
    // HC-06.7：ζ = 0.5、ν = 0.2／3、A = 1／0.2 ⇒ −0.019966722 + 0.019726027 = −0.000240695（抵消 2 位 ⇒ 顯示 8 位）
    const d7 = byId('HC-06.7')
    const v7 = { zeta: 0.5, nu1: 0.2, A1: 1, nu2: 3, A2: 0.2 }
    const tex7 = d7.solve(v7).steps.map((x) => x.tex).join('\n')
    expect(tex7).toContain('=-0.019966722+0.019726027=-0.000240695')
    expect(d7.solve(v7).notes?.join('')).toMatch(/顯示 8 位/)
    expectStepsReproducible(d7, v7, 'cancel')
    // 不抵消時（兩個 tone 同號）維持 6 位，也不出現「多留位數」的提醒
    const same = d7.solve({ zeta: 0.7, nu1: 0.3, A1: 1, nu2: 0.5, A2: 0.4 })
    expect(same.steps.map((x) => x.tex).join('\n')).toContain('=-0.0407666+(-0.0142518)=')
    expect(same.notes?.join('')).not.toMatch(/顯示 \d+ 位/)
    // HC-06.8：frac = 0.002、ω_nT_s = 0.03、d = D = 2 ⇒ −0.048 + 0.05333333 = 0.00533333
    const d8 = byId('HC-06.8')
    const v8 = { frac: 0.002, wn: 0.03, d: 2, D: 2, mu: 50, sigmaV: 100 }
    expect(d8.solve(v8).steps.map((x) => x.tex).join('\n')).toContain('=-0.048+0.05333333=0.00533333')
    expectStepsReproducible(d8, v8, 'cancel')
    // HC-06.4：ν = 100 ⇒ 90° − 89.42706° = 0.572939°（tan⁻¹ 多留位數）
    const d4 = byId('HC-06.4')
    expectStepsReproducible(d4, { nu: 100, A: 1 }, 'nu=100')
    expectStepsReproducible(d4, { nu: 1e4, A: 3 }, 'nu=1e4')
  })

  it('p = 1 − g：p 顯示到和 g 同一個小數位（不多給手算得不到的位數；p 很接近 1 時也不把有意義的位數捨掉）', () => {
    const d1 = byId('HC-06.1')
    // g = −4e−9 ⇒ p = 1.000000004（固定 8 位會顯示成 1）
    const tiny = d1.solve({ C: -1e-6, Kq: 0.004, mu: 1, d0: 3 })
    expect(tiny.steps[2].tex).toContain(String.raw`=1-(-4\times10^{-9})=1.000000004`)
    expect(texNum(val(tiny, 'p'), tiny.results[0].digits)).toBe('1.000000004')
    // g = 0.690988（6 位 ⇒ 小數 6 位）⇒ p = 1.690988，不是 1.6909883
    const d2 = byId('HC-06.2')
    const big = d2.solve({ A: 2, mag: 1, phi: 150, P: 12, D: 0, mu: 50, sigmaV: 100 })
    expect(big.steps[big.steps.length - 1].tex).toMatch(/=1-\(-0\.690988\)=1\.690988$/)
    expectStepsReproducible(d1, { C: 0.25, Kq: 0.0079788, mu: 37.5, d0: -13.7 }, 'ugly')
    expectStepsReproducible(d1, { C: 0.5, Kq: 0.01, mu: 500, d0: 10 }, 'g>2')
    // g ≥ 2：p ≤ −1，判定寫「振盪發散」
    expect(d1.solve({ C: 0.5, Kq: 0.01, mu: 500, d0: 10 }).notes?.[0]).toMatch(/p=-1\.5\\le-1/)
  })
})

describe('使用者會輸入奇怪的數字：TeX 不可壞掉、說明要跟著情況變', () => {
  const STRESS: Record<string, Record<string, number>[]> = {
    'HC-06.1': [
      { C: -1e-6, Kq: 0.004, mu: 1, d0: 3 },
      { C: 0, Kq: 0.008, mu: 20, d0: 10 },
      { C: 0.5, Kq: 0.01, mu: 200, d0: 0 },
      { C: -100, Kq: 10, mu: 1e5, d0: -1e5 },
    ],
    'HC-06.2': [
      { A: 0.001, mag: 0.37, phi: -75, P: 7, D: 3, mu: 12.5, sigmaV: 80 },
      { A: 100, mag: 0, phi: 720, P: 1e6, D: 256, mu: 1e5, sigmaV: 1e5 },
    ],
    'HC-06.3': [
      { mag: 1.3, phi: -40, P: 7, n: 0 },
      { mag: 0, phi: 60, P: 2.5, n: 60 },
    ],
    'HC-06.4': [
      { nu: 5e-5, A: 1 },
      { nu: 1e4, A: 100 },
    ],
    'HC-06.5': [
      { nu: 0.99999, zeta: 1e-5 },
      { nu: 1e4, zeta: 100 },
      { nu: 5e-5, zeta: 0.7 },
      { nu: 1, zeta: 1e-5 },
    ],
    'HC-06.6': [
      { fref: 4000, bw: 320, zeta: 0.7, f: 8 },
      { fref: 100, bw: 1, zeta: 0.001, f: 1e-5 },
      { fref: 1e6, bw: 1e-3, zeta: 100, f: 1e-6 },
    ],
    'HC-06.7': [
      { zeta: 1e-5, nu1: 5e-5, A1: 1, nu2: 1e4, A2: 0.001 },
      { zeta: 0.7, nu1: 1, A1: 1, nu2: 2, A2: 0 },
      { zeta: 100, nu1: 3, A1: 100, nu2: 2, A2: 100 },
    ],
    'HC-06.8': [
      { frac: 2e-5, wn: 0.03, d: 1, D: 2, mu: 150, sigmaV: 100 },
      { frac: 1e-7, wn: 0.001, d: 4, D: 5, mu: 1e5, sigmaV: 1e5 },
      { frac: 0.0009, wn: 0.03, d: 0, D: 1, mu: 150, sigmaV: 100 },
    ],
  }

  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：極小／極大／邊界輸入都能渲染（科學記號當底數或乘數時有括號）', (id, def) => {
    expect(STRESS[id]?.length ?? 0, id).toBeGreaterThan(0)
    for (const v of STRESS[id]) {
      expect(def.validate?.(v) ?? null, `${id} ${JSON.stringify(v)}`).toBeNull()
      const sol = def.solve(v)
      expectSolutionTexOk(def, sol, JSON.stringify(v))
      // 科學記號不可直接當底數（10^{-5}^2 是 KaTeX 的 double superscript）
      for (const st of sol.steps) expect(st.tex, `${id} ${JSON.stringify(v)}`).not.toMatch(/10\^\{-?\d+\}\^/)
      // 說明文字裡的數字一律在 `$...$` 裡：`$` 以外不會出現 TeX 指令
      for (const text of [...sol.steps.map((x) => x.why), ...(sol.notes ?? [])]) {
        expect(text.replace(INLINE, ''), `${id} ${JSON.stringify(v)}：${text}`).not.toMatch(/\\[a-zA-Z]+|\^\{/)
      }
    }
  })

  it('HC-06.1：發散得很慢時的百分比（4×10⁻⁷ %）放在公式裡，不會把 \\times 印成純文字', () => {
    const sol = byId('HC-06.1').solve({ C: -1e-6, Kq: 0.004, mu: 1, d0: 3 })
    expect(sol.notes?.[0]).toContain(String.raw`$4\times10^{-7}\%$`)
  })

  it('HC-06.3：手算會留下捨入殘餘的 0（u[n] = 0 的那一列）有提醒', () => {
    const d = byId('HC-06.3')
    const sol = d.solve({ mag: 1, phi: 60, P: 12, n: 1 }) // Ωn + φ = 90° ⇒ u[1] = 0
    expect(val(sol, 'u[1]')).toBe(0)
    expect(sol.steps[6].tex).toMatch(/=1\.73205\+\(-1\.73205\)=0$/)
    expect(sol.steps[6].why).toMatch(/四捨五入的殘餘/)
    expect(solveDefault('HC-06.3').steps[6].why).not.toMatch(/四捨五入的殘餘/)
  })

  it('HC-06.7：兩個 tone 在 ω_n 的同一側時，說明不再說「一個發散一個收斂」', () => {
    const d = byId('HC-06.7')
    const bothLow = d.solve({ zeta: 0.7, nu1: 0.3, A1: 1, nu2: 0.5, A2: 0.4 })
    expect(val(bothLow, 'C')).toBeLessThan(0)
    expect(bothLow.notes?.join('')).toMatch(/都在反相頻帶/)
    expect(bothLow.notes?.join('')).not.toMatch(/一定收斂/)
    const bothHigh = d.solve({ zeta: 0.7, nu1: 3, A1: 1, nu2: 2, A2: 0.4 })
    expect(val(bothHigh, 'C')).toBeGreaterThan(0)
    expect(bothHigh.notes?.join('')).toMatch(/沒有負的/)
    // 一低一高（預設）：保留「功率加權和」的說明
    expect(solveDefault('HC-06.7').notes?.join('')).toMatch(/功率加權和/)
    // 只有一個 tone 有功率：不算「拉鋸」
    expect(d.solve({ zeta: 0.7, nu1: 0.3, A1: 1, nu2: 2, A2: 0 }).notes?.join('')).toMatch(/都在反相頻帶/)
  })

  it('HC-06.8：與精確自相關和的比較說真話——一致／差幾 %／正負號不同／剛好抵消', () => {
    const d = byId('HC-06.8')
    const last = (v: Record<string, number>): string => {
      expect(d.validate?.(v) ?? null, JSON.stringify(v)).toBeNull()
      const notes = d.solve(v).notes ?? []
      return notes[notes.length - 1]
    }
    // 預設（Δ = 0.10）：鋸齒自相關在 |k − D|·frac < 1 內恰為二次式 ⇒ 兩項式與精確和相同到 1e−9
    const v0 = defaultValues(d)
    expect(last(v0)).toMatch(/和兩項式一致（相差小於 \$10\^\{-9\}\$）/)
    const loop = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: v0.wn, loopDelay: 0 })
    const exact0 = autocorrCorrelation(impulseResponse(loop.b, loop.a, 8192), sawtoothAutocorr(v0.frac), v0.D)
    near(val(d.solve(v0), 'C_D/\\sigma_x^2'), exact0, 1e-8)
    expect(last(v0)).toContain(`=${texNum(exact0, 6)}$`)
    // Δ = 0.63：尾巴還沒衰減完就折返 ⇒ 差約 1%，要明說
    const v1 = { frac: 0.002, wn: 0.02, d: 0, D: 1, mu: 100, sigmaV: 100 }
    const loop1 = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: 0.02, loopDelay: 0 })
    const exact1 = autocorrCorrelation(impulseResponse(loop1.b, loop1.a, 16384), sawtoothAutocorr(0.002), 1)
    const rel1 = Math.abs(val(d.solve(v1), 'C_D/\\sigma_x^2') - exact1) / Math.abs(exact1)
    expect(rel1).toBeGreaterThan(0.01)
    expect(rel1).toBeLessThan(0.02)
    expect(last(v1)).toContain(String.raw`兩項式差了 $${texNum(rel1 * 100, 2)}\%$`)
    // D 很接近 D*、Δ 又不小：兩項式給 +3.6e−4，精確和是負的 ⇒ 明確警告
    const v2 = { frac: 0.01003, wn: 0.1, d: 0, D: 1, mu: 100, sigmaV: 100 }
    const loop2 = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: 0.1, loopDelay: 0 })
    const exact2 = autocorrCorrelation(impulseResponse(loop2.b, loop2.a, 8192), sawtoothAutocorr(0.01003), 1)
    expect(val(d.solve(v2), 'C_D/\\sigma_x^2')).toBeGreaterThan(0)
    expect(exact2).toBeLessThan(0)
    expect(last(v2)).toMatch(/正負號和兩項式不同/)
    // D = D*（frac = K_i·D）：兩項剛好抵消 ⇒ C_D = 0、p = 1，不顯示 1e−13 的浮點殘渣
    const v3 = { frac: 0.0009, wn: 0.03, d: 0, D: 1, mu: 150, sigmaV: 100 }
    const s3 = d.solve(v3)
    expect(val(s3, 'C_D/\\sigma_x^2')).toBe(0)
    expect(val(s3, 'p')).toBe(1)
    expect(s3.steps.map((x) => x.tex).join('\n')).toContain('=-0.0108+0.0108=0')
    expect(s3.notes?.[0]).toMatch(/剛好抵消/)
    expect(last(v3)).toMatch(/和兩項式一致/)
    expect(last(v3)).not.toMatch(/10\^\{-1\d\}/)
  })
})

describe('(d) <HandCalc> 渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值渲染出步驟、答案與提示，沒有 KaTeX 錯誤', (id, def) => {
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.querySelector(`[id="handcalc-${id}"]`)).not.toBeNull()
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    const sol = def.solve(defaultValues(def))
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
    expect(container.querySelectorAll('.c-handcalc-tips li').length).toBe(def.tips?.length ?? 0)
    // 字串裡的 `$...$` 都已交給 KaTeX（頁面上不會看到落單的 $）
    expect(container.querySelector('.c-handcalc-solution')!.textContent).not.toContain('$')
    expect(container.querySelector('.c-handcalc-tips')!.textContent).not.toContain('$')
    unmount()
    // 「自己算算看」模式：每個答案一個輸入框，不先顯示步驟
    const practice = render(<HandCalc def={def} initialMode="practice" />)
    expect(practice.container.querySelectorAll('.c-step').length).toBe(0)
    expect(practice.container.querySelectorAll('.c-handcalc-answer').length).toBe(sol.results.length)
    expect(practice.container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    practice.unmount()
  })
})
