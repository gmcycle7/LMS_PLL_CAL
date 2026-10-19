import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, MathText, checkAnswer, defaultValues, inputError, randomValues } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { eigSym } from '@/simulation/core'
import {
  KQ_SIGMA100,
  corr2,
  eig2x2,
  eigenModes,
  lmsHandSteps,
  meanSquareRadius,
  meanTrajectory,
  modalCoords,
  pm1DegenerateProb,
  sampleEigRelStd,
  slidingWindowPe,
  stepsToDecay,
} from '@/simulation/models/pe'
import { FORMULAS } from './formulas'
import Chapter09 from './index'
import { HANDCALCS, HAND_WINDOW_N0, ch09HandCalc, signModeFactor } from './handcalcs'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

// 「題目在章內的位置」那一個測試會渲染整章：Plotly 與 Mermaid 以 mock 取代（jsdom 沒有 canvas／SVG 排版）
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

afterEach(() => {
  localStorage.clear()
})

interface Vector {
  expected: Record<string, unknown>
}

function golden(id: string): Record<string, number> {
  return (JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${id}.json`), 'utf8')) as Vector).expected as Record<string, number>
}

/** 會渲染 KaTeX 的測試：機器忙碌（多組測試同時跑）時遠超過 vitest 預設的 5 秒，給明確的上限 */
const RENDER_TIMEOUT = 60000

const IDS = ['HC-09.1', 'HC-09.2', 'HC-09.3', 'HC-09.4', 'HC-09.5', 'HC-09.6', 'HC-09.7', 'HC-09.8']

function values(def: HandCalcDef, patch: Record<string, number> = {}): Record<string, number> {
  return { ...defaultValues(def), ...patch }
}

function resultValues(def: HandCalcDef, patch: Record<string, number> = {}): number[] {
  return def.solve(values(def, patch)).results.map((r) => r.value)
}

/** ⌈ln 0.05 / ln|p|⌉（p = 0 ⇒ 1），測試內的獨立寫法 */
function k95Of(p: number): number {
  return p === 0 ? 1 : Math.ceil(Math.log(0.05) / Math.log(Math.abs(p)))
}

/** 對稱 2×2 的 eigenvalues（閉式；測試內的獨立寫法）：[λ_max, λ_min] */
function symEig(a: number, b: number, d: number): [number, number] {
  const half = (a + d) / 2
  const root = Math.sqrt(Math.max(0, half * half - (a * d - b * b)))
  return [half + root, half - root]
}

/**
 * 每一題的「獨立重算」：直接照本章公式寫，不呼叫 pe.ts（順序與 solve().results 相同）。
 * 用來確認 handcalcs.ts 取自模型函式的數字與公式一致。
 */
function independent(id: string, v: Record<string, number>): number[] {
  switch (id) {
    case 'HC-09.1': {
      const { a1, a2, mu, s } = v
      const e0 = a1 + a2 // w0 = (0, 0)、u0 = (1, 1)
      const w1 = [mu * e0, mu * e0]
      const e1 = a1 - w1[0] + s * (a2 - w1[1])
      const w2 = [w1[0] + mu * e1, w1[1] + mu * e1 * s]
      return [w2[0], w2[1], a1 - w2[0] - (a2 - w2[1])]
    }
    case 'HC-09.2': {
      const { rho, g, k } = v
      let d = [v.d1, v.d2]
      for (let i = 0; i < k; i++) d = [(1 - g) * d[0] - g * rho * d[1], -g * rho * d[0] + (1 - g) * d[1]]
      return [(d[0] + d[1]) / Math.SQRT2, (d[0] - d[1]) / Math.SQRT2, d[0], d[1]]
    }
    case 'HC-09.3': {
      const { rho, g } = v
      const p = 1 - g * (1 - rho)
      return [1 + rho, 1 - rho, (1 + rho) / (1 - rho), p, k95Of(p)]
    }
    case 'HC-09.4': {
      const { a, b, d } = v
      const ev = eigSym([
        [a, b],
        [b, d],
      ]).values // Jacobi（與 eig2x2 的閉式解不同的演算法）
      const kappa = ev[0] / ev[1]
      return [ev[0], ev[1], kappa, 2 / (a + d), (kappa - 1) / (kappa + 1)]
    }
    case 'HC-09.5': {
      const { rho, g, N } = v
      const lam = [1 + rho, 1 - rho]
      const aii = lam.map((l) => 1 - 2 * g * l + g * g * l * l * (1 + 2 / N)) // 本章的 A_ii
      const a12 = (g * g * lam[0] * lam[1]) / N
      const sign = lam.map((l) => (1 - g * l) ** 2 - (g * g * l * l) / N)
      return [symEig(aii[0], a12, aii[1])[0], Math.max(...lam.map((l) => (1 - g * l) ** 2)), Math.max(...sign.map(Math.abs))]
    }
    case 'HC-09.6': {
      let s11 = 0
      let s12 = 0
      let s22 = 0
      for (let n = 0; n < HAND_WINDOW_N0; n++) {
        s11 += v[`u1_${n}`] ** 2
        s12 += v[`u1_${n}`] * v[`u2_${n}`]
        s22 += v[`u2_${n}`] ** 2
      }
      const [lmax, lmin] = symEig(s11, s12, s22)
      return [lmax, lmin, lmin / HAND_WINDOW_N0, Math.sqrt(lmin), 1 - lmin / lmax]
    }
    case 'HC-09.7': {
      const { b, c } = v
      return [b + c, ...[v.a0, v.a1, v.a2, v.a3].map((a) => b + c + (a - c))]
    }
    case 'HC-09.8': {
      const { sigmaV, mu, rho, N0 } = v
      const g = (mu * Math.sqrt(2 / Math.PI)) / sigmaV
      return [g, k95Of(1 - g * (1 - rho)), ((1 + rho) / 2) ** N0 + ((1 - rho) / 2) ** N0, Math.sqrt(2 / N0)]
    }
    default:
      throw new Error(`沒有 ${id} 的獨立重算`)
  }
}

/** 整數的 k₉₅：ln 比值恰好落在整數邊界（±1e-9）時，兩種浮點路徑可以差 1 */
function expectClose(actual: number, expected: number, label: string, integerSteps = false): void {
  if (integerSteps) {
    expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(1)
    return
  }
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1e-9 + 1e-9 * Math.abs(expected))
}

describe('Ch09 帶入手算：題目結構', () => {
  it('8 題、ID 為 HC-09.1 … HC-09.8、頁面為 /ch/09，公式 ID 都存在於本章公式登錄', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(IDS)
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/09')
      expect(h.formulaId && formulaIds.has(h.formulaId), h.id).toBe(true)
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThan(0)
      expect(ch09HandCalc(h.id)).toBe(h)
    }
    expect(() => ch09HandCalc('HC-09.99')).toThrow(/找不到/)
  })

  it('難度分層誠實標示：只需四則運算的兩題是 beginner，其餘需要 √／ln／y^x 的是 engineer（本章沒有查表或複數題）', () => {
    const level = Object.fromEntries(HANDCALCS.map((h) => [h.id, h.level]))
    expect(level['HC-09.1']).toBe('beginner')
    expect(level['HC-09.7']).toBe('beginner')
    for (const id of ['HC-09.2', 'HC-09.3', 'HC-09.4', 'HC-09.5', 'HC-09.6', 'HC-09.8']) expect(level[id], id).toBe('engineer')
    // beginner 題的步驟裡不可出現開根號、對數或次方鍵
    for (const id of ['HC-09.1', 'HC-09.7']) {
      const def = ch09HandCalc(id)
      for (const s of def.solve(defaultValues(def)).steps) expect(s.tex, id).not.toMatch(/\\sqrt|\\ln|\\log|\^\{\d{2,}\}/)
    }
  })

  it('預設值與練習範圍都落在輸入的合法範圍內，且預設值通過 validate', () => {
    for (const h of HANDCALCS) {
      const d = defaultValues(h)
      expect(h.validate?.(d) ?? null, h.id).toBeNull()
      for (const i of h.inputs) {
        expect(inputError(i, i.default), `${h.id}.${i.key}`).toBeNull()
        expect(i.practice, `${h.id}.${i.key} 應有練習範圍`).toBeTruthy()
        for (const c of i.practice?.choices ?? []) expect(inputError(i, c), `${h.id}.${i.key} = ${c}`).toBeNull()
        if (i.practice?.min !== undefined) expect(inputError(i, i.practice.min)).toBeNull()
        if (i.practice?.max !== undefined) expect(inputError(i, i.practice.max)).toBeNull()
      }
    }
  })
})

describe('Ch09 帶入手算：(a) 預設值重現本章 worked example／模型函式／golden vector', () => {
  it('HC-09.1：a = (3, 1)、μ = 0.25、u 永遠是 (1, 1) ⇒ w₂ = (1.5, 1.5)、差仍是 2（文中第一張表）；s = −1 ⇒ w₂ = (1.5, 0.5)（第二張表）', () => {
    const def = ch09HandCalc('HC-09.1')
    expect(resultValues(def)).toEqual([1.5, 1.5, 2])
    expect(resultValues(def, { s: -1 })).toEqual([1.5, 0.5, 1])
    // 與模型的手算表函式逐列一致
    const same = lmsHandSteps({ a: [3, 1], w0: [0, 0], mu: 0.25, us: [[1, 1], [1, 1]] })
    expect(resultValues(def).slice(0, 2)).toEqual(same[1].wNext)
    const alt = lmsHandSteps({ a: [3, 1], w0: [0, 0], mu: 0.25, us: [[1, 1], [1, -1]] })
    expect(resultValues(def, { s: -1 }).slice(0, 2)).toEqual(alt[1].wNext)
    // u 固定時「差」永遠等於 a₁ − a₂
    for (const [a1, a2] of [[5, -1], [2, 2], [4, 0]]) expect(resultValues(def, { a1, a2 })[2]).toBeCloseTo(a1 - a2, 12)
  })

  it('T11: HC-09.2：δ₀ = (1, 0)、ρ = .99、g = .5，k = 1 ⇒ E[δ₁] = (0.5, −0.495)、模態座標 (0.0035, 0.7036)；k = 4 與 meanTrajectory 一致', () => {
    const def = ch09HandCalc('HC-09.2')
    const k1 = resultValues(def, { k: 1 })
    expect(k1[2]).toBeCloseTo(0.5, 12)
    expect(k1[3]).toBeCloseTo(-0.495, 12)
    expect(k1[0]).toBeCloseTo(0.005 / Math.SQRT2, 12) // 0.0035
    expect(k1[1]).toBeCloseTo(0.995 / Math.SQRT2, 12) // 0.7036
    expect(k1[0].toFixed(4)).toBe('0.0035')
    expect(k1[1].toFixed(4)).toBe('0.7036')
    // 預設 k = 4：文中「走四步」表的最後一列
    const traj = meanTrajectory(corr2(0.99), 0.5, [1, 0], 4)
    const k4 = resultValues(def)
    expect(k4[2]).toBe(traj[0][4])
    expect(k4[3]).toBe(traj[1][4])
    const c4 = modalCoords(eig2x2(1, 0.99, 1).vectors, [traj[0][4], traj[1][4]])
    expect(k4[0]).toBeCloseTo(c4[0], 12) // 0.005⁴/√2 ≈ 4.4e-10
    expect(k4[1]).toBeCloseTo(c4[1], 12)
    expect(k4[1]).toBeCloseTo(0.995 ** 4 / Math.SQRT2, 12)
    // 第 2、3 步（直接乘一步）顯示的就是 (0.5, −0.495)
    const steps = def.solve(defaultValues(def)).steps
    expect(steps[1].tex.endsWith('=0.5')).toBe(true)
    expect(steps[2].tex.endsWith('=-0.495')).toBe(true)
  })

  it('T10: HC-09.2 反面例子 ρ = 1（缺乏 PE）：30 步後和歸零、差模座標停在初值，E[δ₃₀] = (0.5, −0.5)', () => {
    const def = ch09HandCalc('HC-09.2')
    expect(def.validate?.(values(def, { rho: 1, k: 30 })) ?? null).toBeNull()
    const sol = def.solve(values(def, { rho: 1, k: 30 }))
    const [c1, c2, d1, d2] = sol.results.map((r) => r.value)
    expect(Math.abs(c1)).toBe(0) // p₁ = 1 − 0.5·2 = 0
    expect(c2).toBeCloseTo(1 / Math.SQRT2, 12)
    expect(d1).toBeCloseTo(0.5, 12)
    expect(d2).toBeCloseTo(-0.5, 12)
    expect(sol.notes?.join('')).toContain('不可辨識')
  })

  it('T10: HC-09.3：ρ = .99 ⇒ λ = 1.99、0.01，κ = 199（golden T10）', () => {
    const g10 = golden('T10')
    const [lmax, lmin, kappa] = resultValues(ch09HandCalc('HC-09.3'))
    expect(lmax).toBeCloseTo(g10.eig_max, 12)
    expect(lmin).toBeCloseTo(g10.eig_min, 12)
    expect(Math.abs(kappa - g10.cond)).toBeLessThan(1e-9 * g10.cond)
    expect(checkAnswer(199, { value: kappa }).ok).toBe(true)
  })

  it('T11: HC-09.3：g = μK_q = .5 ⇒ 慢 pole .995、快 pole .005、k₉₅ = ⌈597.647⌉ = 598（golden T11）', () => {
    const g11 = golden('T11')
    const def = ch09HandCalc('HC-09.3')
    const sol = def.solve(defaultValues(def))
    expect(sol.results[3].value).toBeCloseTo(g11.slow_pole, 12)
    expect(sol.results[4].value).toBe(g11.blocks_95)
    const tex = sol.steps.map((s) => s.tex).join('\n')
    expect(tex).toContain('=0.005') // 快 pole
    expect(tex).toContain(String.raw`\ln 0.995=-0.005012542`) // 第一次按 ln（保留 7 位）
    expect(tex).toContain(String.raw`\frac{-2.995732}{-0.005012542}=597.6473`) // 再相除：未取整的 ln 比值（golden blocks_95_real = 597.6473…）
    expect(-2.995732 / -0.005012542).toBeCloseTo(g11.blocks_95_real, 3) // 用畫面上的 7 位數字手算，取上整後仍是 598
    expect(Math.ceil(-2.995732 / -0.005012542)).toBe(g11.blocks_95)
    expect(g11.blocks_95_real).toBeCloseTo(597.6473, 4)
    expect(tex).toContain(String.raw`\frac{2.995732}{0.005}=599.146`) // 泰勒近似 ln 20 /(gλ_min)：畫面上的 7 位數字相除就是它
    expect(sol.steps[sol.steps.length - 1].why).toContain('597.6486') // 二階修正：599.1465 − ½ln20 = 597.6486（精確值 597.6473，差 0.25x = 0.0013）
    // 思考題 1 的數字（ρ = .9）也由同一題重現
    expect(resultValues(def, { rho: 0.9 })[4]).toBe(stepsToDecay(1 - 0.5 * 0.1))
    // p_slow = 0（ρ = 0、g = 1）：一步歸零，不顯示 ln 0
    const zero = def.solve(values(def, { rho: 0, g: 1 }))
    expect(zero.results[4].value).toBe(1)
    expect(zero.steps.map((s) => s.tex).join('')).not.toMatch(/NaN|\\infty/)
  })

  it('HC-09.4：先備知識框的例子 a = 2、b = .6、d = 1 ⇒ λ = 2.281、0.719，g* = 2/3；與 Jacobi eigSym 一致', () => {
    const def = ch09HandCalc('HC-09.4')
    const [lmax, lmin, kappa, gStar, rate] = resultValues(def)
    const ev = eigSym([[2, 0.6], [0.6, 1]]).values
    expect(lmax).toBeCloseTo(ev[0], 12)
    expect(lmin).toBeCloseTo(ev[1], 12)
    expect(lmax).toBeCloseTo(2.28102, 5)
    expect(lmin).toBeCloseTo(0.71898, 5)
    expect(kappa).toBeCloseTo(ev[0] / ev[1], 10)
    expect(gStar).toBeCloseTo(2 / 3, 12)
    expect(rate).toBeCloseTo((ev[0] - ev[1]) / 3, 12)
    // a = d = 1、b = ρ 退化成 F-09.5 / F-09.7：λ = 1 ± ρ、g* = 1、最佳收斂率 = ρ（文中 ρ = .99 ⇒ 0.99）
    const r = resultValues(def, { a: 1, b: 0.99, d: 1 })
    expect(r[0]).toBeCloseTo(1.99, 12)
    expect(r[1]).toBeCloseTo(0.01, 12)
    expect(r[3]).toBeCloseTo(1, 12)
    expect(r[4]).toBeCloseTo(0.99, 10)
  })

  it('T11: HC-09.5（勘誤 E23）：ρ = .99、g = .5 的均方半徑 N = 1 ⇒ 1.9801（發散）、N = 2 ⇒ 0.99254、N = 16 ⇒ 0.99003；1-bit N = 1 ⇒ 0.99', () => {
    const def = ch09HandCalc('HC-09.5')
    const n1 = resultValues(def)
    expect(n1[0]).toBeCloseTo(1.9801, 4)
    expect(n1[1]).toBeCloseTo(0.995 ** 2, 12)
    expect(n1[2]).toBeCloseTo(0.99, 10)
    expect(resultValues(def, { N: 2 })[0]).toBeCloseTo(0.99254, 5)
    expect(resultValues(def, { N: 16 })[0]).toBeCloseTo(0.99003, 4)
    // 與網站實際使用的 3×3 均方算子一致（linear 與 sign）
    for (const N of [1, 2, 4, 16, 256]) {
      const r = resultValues(def, { N })
      expect(r[0]).toBeCloseTo(meanSquareRadius('gaussian', 0.99, 0.5, N), 10)
      expect(r[2]).toBeCloseTo(meanSquareRadius('gaussian', 0.99, 0.5, N, 'sign'), 10)
      expect(r[0]).toBeGreaterThanOrEqual(r[1] - 1e-15) // Jensen：ρ_MS ≥ max p²
    }
    expect(def.solve(defaultValues(def)).notes?.[0]).toContain('發散')
    expect(def.solve(values(def, { N: 2 })).notes?.[0]).toContain('收斂')
    // ρ = 1（λ_min = 0）：差模 pole = 1，連 mean 都不衰減——說明改成「不可辨識」，不再宣稱「mean 收斂」，也不顯示 1-bit 的說明
    expect(def.validate?.(values(def, { rho: 1, N: 16 })) ?? null).toBeNull()
    const deg = def.solve(values(def, { rho: 1, N: 16 }))
    expect(deg.results[0].value).toBeGreaterThanOrEqual(1)
    expect(deg.results[1].value).toBe(1)
    expect(deg.notes?.[0]).toContain('不可辨識')
    expect(deg.notes?.join('')).not.toContain('mean 收斂')
    expect(deg.notes).toHaveLength(2)
    expect(def.solve(defaultValues(def)).notes).toHaveLength(3)
  })

  it('T10: HC-09.6：§9.1 的窗口 B ⇒ λ(S_k) = 6、2，λ_min(R_k) = 0.5，σ_min(U_k) = √2；窗口 A 退化（λ_min = 0、κ = ∞）', () => {
    const def = ch09HandCalc('HC-09.6')
    const b = resultValues(def)
    expect(b[0]).toBe(6)
    expect(b[1]).toBe(2)
    expect(b[2]).toBe(0.5)
    expect(b[3]).toBeCloseTo(Math.SQRT2, 12)
    expect(b[4]).toBeCloseTo(2 / 3, 12)
    const pe = slidingWindowPe([1, 1, -1, 1], [1, -1, -1, 1], 4)
    expect(b[2]).toBe(pe.lmin[0])
    expect(b[3]).toBe(pe.svMin[0])
    const bSteps = def.solve(defaultValues(def)).steps.map((s) => s.tex)
    expect(bSteps.some((t) => t.includes(String.raw`\kappa(\mathbf R_k)`) && t.endsWith('=3'))).toBe(true)
    // 每個等號一種運算：S₁₁ = 1+1+1+1 = 4、S₁₂ = 2、S₂₂ = 4 → T = 8、D = 16 − 4 = 12 → 4² − 12 = 16 − 12 = 4 → √4 = 2 → 4 ± 2
    expect(bSteps[0].endsWith('=1^2+1^2+(-1)^2+1^2=1+1+1+1=4')).toBe(true)
    expect(bSteps[1].endsWith(String.raw`=1\times1+1\times(-1)+(-1)\times(-1)+1\times1=1+(-1)+1+1=2`)).toBe(true)
    expect(bSteps[4].endsWith(String.raw`=4\times4-2^2=16-4=12`)).toBe(true)
    expect(bSteps[0].endsWith('=4')).toBe(true)
    expect(bSteps[1].endsWith('=2')).toBe(true)
    expect(bSteps[4].endsWith('=12')).toBe(true)
    expect(bSteps[5].endsWith('4^2-12=16-12=4')).toBe(true)
    expect(bSteps[6].endsWith(String.raw`\sqrt{4}=2`)).toBe(true)
    expect(bSteps[7].endsWith('=4+2=6')).toBe(true)
    expect(bSteps[8].endsWith('=4-2=2')).toBe(true)
    // 窗口 A：(1,1), (−1,−1), (1,1), (−1,−1)
    const A = { u1_0: 1, u2_0: 1, u1_1: -1, u2_1: -1, u1_2: 1, u2_2: 1, u1_3: -1, u2_3: -1 }
    expect(def.validate?.(A) ?? null).toBeNull()
    const sa = def.solve(A)
    expect(sa.results.map((r) => r.value)).toEqual([8, 0, 0, 0, 1])
    expect(sa.steps.some((s) => s.tex.includes(String.raw`\to\infty`))).toBe(true)
    expect(sa.notes?.[0]).toContain('退化窗口')
  })

  it('HC-09.7：§9.2 的例子 θ = (1,2,3,4,5)、c = −1 ⇒ b′ = 0，四相輸出仍是 3、4、5、6', () => {
    const def = ch09HandCalc('HC-09.7')
    expect(resultValues(def)).toEqual([0, 3, 4, 5, 6])
    const sol = def.solve(defaultValues(def))
    expect(sol.steps[1].tex).toContain(String.raw`(3,\ 4,\ 5,\ 6)`)
    // 思考題 2 的數字：θ = (2,1,4,0,3)、c = 2 ⇒ θ′ = (4,−1,2,−2,1)，輸出不變
    expect(resultValues(def, { b: 2, a0: 1, a1: 4, a2: 0, a3: 3, c: 2 })).toEqual([4, 3, 6, 2, 5])
    // 只動 b 不是 gauge：那一步明確顯示輸出不同
    expect(sol.steps.some((s) => s.tex.includes(String.raw`\ne`))).toBe(true)
    expect(def.solve(values(def, { c: 0 })).steps.some((s) => s.tex.includes(String.raw`\ne`))).toBe(false)
  })

  it('HC-09.8（審查 C01）：g > g⋆ = 1 時說明指出最慢的是共模（σ_v = 100 fs、μ = 150 fs、ρ = .5 ⇒ g = 1.197、pole −0.795／0.402、14 vs. 4 blocks）；g ≤ g⋆ 時沒有這一句', () => {
    const def = ch09HandCalc('HC-09.8')
    const big = { sigmaV: 100, mu: 150, rho: 0.5, N0: 100 }
    expect(def.validate?.(big)).toBeNull() // gλ_max = 1.795 < 2：仍在穩定範圍
    const sol = def.solve(big)
    const g = 150 * KQ_SIGMA100
    expect(g).toBeCloseTo(1.19683, 5)
    const modes = eigenModes(corr2(0.5), g)
    expect(modes.poles[0]).toBeCloseTo(-0.79524, 5)
    expect(modes.poles[1]).toBeCloseTo(0.40159, 5)
    expect(modes.k95).toEqual([14, 4])
    // 題目的 k₉₅ 仍然是「慢模式」的（標籤如此）；新增的說明給出整體要等的 14 個 blocks
    expect(sol.results.find((r) => r.symbol === 'k_{95}')?.value).toBe(4)
    expect(sol.results.find((r) => r.symbol === 'k_{95}')?.label).toContain('慢模式')
    const notes = sol.notes?.join('\n') ?? ''
    expect(notes).toContain(String.raw`>g^\star=1$`)
    expect(notes).toContain('最慢的反而是共模')
    expect(notes).toContain(String.raw`$k_{95}=14$ 個 blocks`)
    expect(notes).toContain(String.raw`比上面慢模式的 $4$ 個還久`)
    expect(notes).toContain(String.raw`$1-g\lambda_{\max}=-0.79524$`)
    // 「速度看 gλ_min」帶著條件
    expect(notes).toContain(String.raw`速度看 $g\lambda_{\min}$（$g\le g^\star=2/(\lambda_{\max}+\lambda_{\min})=1$ 時，F-09.7）`)
    // 對照：範例（g = 0.004）與 g = g⋆ 附近以下都沒有「最慢的反而是共模」
    for (const v of [defaultValues(def), { sigmaV: 100, mu: 100, rho: 0.5, N0: 100 }, { sigmaV: 100, mu: 200, rho: 0, N0: 20 }]) {
      const n = def.solve(v).notes?.join('\n') ?? ''
      expect(n, JSON.stringify(v)).not.toContain('最慢的反而是共模')
      expect(n).toContain(String.raw`（$g\le g^\star=2/(\lambda_{\max}+\lambda_{\min})=1$ 時，F-09.7）`)
    }
    // g 只比 g⋆ 大一點（μ = 126.6 fs ⇒ g = 1.0101、pole −0.51518／0.49494）：|p_fast| > |p_slow|，但取上整後兩個模式都是 5 個 blocks
    // ⇒ 說明不可以寫「比慢模式的 5 個還久」
    const near = def.solve({ sigmaV: 100, mu: 126.6, rho: 0.5, N0: 100 })
    const gNear = 126.6 * KQ_SIGMA100
    expect(k95Of(1 - gNear * 1.5)).toBe(5)
    expect(k95Of(1 - gNear * 0.5)).toBe(5)
    expect(near.results.find((r) => r.symbol === 'k_{95}')?.value).toBe(5)
    const nearNotes = near.notes?.join('\n') ?? ''
    expect(nearNotes).toContain(String.raw`$g=1.0101>g^\star=1$`)
    expect(nearNotes).toContain(String.raw`$|p_{\text{fast}}|=0.51518>|p_{\text{slow}}|=0.49494$——最慢的反而是共模。`)
    expect(nearNotes).toContain(String.raw`取上整之後共模也是 $k_{95}=5$ 個 blocks，和上面慢模式的一樣`)
    expect(nearNotes).not.toContain('還久')
    // 幾乎等於 g⋆（μ = 125.3315 fs ⇒ g = 1.0000007）：5 位有效數字會把兩邊都顯示成一樣的數（「1 > 1」「0.5 > 0.5」），
    // 所以顯示到看得出差別為止
    const tie = def.solve({ sigmaV: 100, mu: 125.3315, rho: 0.5, N0: 100 }).notes?.join('\n') ?? ''
    expect(125.3315 * KQ_SIGMA100).toBeCloseTo(1.0000007, 7)
    expect(tie).toContain(String.raw`$g=1.000001>g^\star=1$`)
    expect(tie).toContain(String.raw`$|p_{\text{fast}}|=0.500001>|p_{\text{slow}}|=0.5$`)
    expect(tie).not.toMatch(/\$g=1>g\^\\star=1\$/)
    // 所有出現這一句的輸入：畫面上「a > b」兩邊的數字都真的不同，而且左邊比較大
    for (const v of [big, { sigmaV: 100, mu: 126.6, rho: 0.5, N0: 100 }, { sigmaV: 100, mu: 125.3315, rho: 0.5, N0: 100 }, { sigmaV: 100, mu: 240, rho: 0.02, N0: 50 }]) {
      const n = def.solve(v).notes?.join('\n') ?? ''
      const mG = /\$g=([\d.]+)>g\^\\star=1\$/.exec(n)
      const mP = /\|p_\{\\text\{fast\}\}\|=([\d.]+)>\|p_\{\\text\{slow\}\}\|=([\d.]+)\$/.exec(n)
      expect(mG, JSON.stringify(v)).toBeTruthy()
      expect(mP, JSON.stringify(v)).toBeTruthy()
      expect(Number(mG![1])).toBeGreaterThan(1)
      expect(Number(mP![1])).toBeGreaterThan(Number(mP![2]))
    }
  })

  it('HC-09.3（審查 C01）：g > g⋆ 時說明指出名字叫「快」的共模反而最慢（不說「名字對調」——「快／慢」一律指 λ_max／λ_min 的模式）', () => {
    const def = ch09HandCalc('HC-09.3')
    const notes = def.solve({ rho: 0.5, g: 1.2 }).notes?.join('\n') ?? ''
    expect(notes).toContain(String.raw`$g>g^\star=2/(\lambda_{\max}+\lambda_{\min})=1$`)
    expect(notes).toContain(String.raw`$|p_{\text{fast}}|=0.8>|p_{\text{slow}}|=0.4$`)
    expect(notes).toContain('名字叫「快」的共模')
    expect(notes).toContain('反而是最慢的模式')
    expect(notes).toContain(String.raw`$k_{95}=14$ 個 blocks`)
    expect(notes).not.toContain('名字對調')
    // 對照：範例（g = 0.5 ≤ g⋆）仍是「整體收斂時間由 λ_min 決定」
    const base = def.solve(defaultValues(def)).notes?.join('\n') ?? ''
    expect(base).toContain(String.raw`慢模式（差模）要 $598$ 個：整體收斂時間由 $\lambda_{\min}$ 決定`)
    expect(base).not.toContain('反而是最慢的模式')
  })

  it('T11: HC-09.8（勘誤 E05）：σ_v = 100 fs、μ = 0.5 fs、ρ = .99 ⇒ K_q = 0.00797885 fs⁻¹、k₉₅ = 75,091；N₀ = 100 ⇒ 退化窗口 60.6%、√(2/N₀) = 0.1414', () => {
    const def = ch09HandCalc('HC-09.8')
    const sol = def.solve(defaultValues(def))
    const [g, k95, pDeg, rel] = sol.results.map((r) => r.value)
    expect(g).toBeCloseTo(0.5 * KQ_SIGMA100, 15)
    expect(k95).toBe(75091)
    expect(k95).toBe(eigenModes(corr2(0.99), 0.5 * KQ_SIGMA100).k95[1])
    expect(pDeg).toBe(pm1DegenerateProb(0.99, 100))
    expect(pDeg).toBeCloseTo(0.6058, 4)
    expect(rel).toBe(sampleEigRelStd(100))
    expect(rel).toBeCloseTo(0.14142, 5)
    expect(sol.steps[0].tex).toContain('0.0079788')
    const tex = sol.steps.map((s) => s.tex).join('\n')
    expect(tex).toContain(String.raw`\frac{0.7978846}{100}=0.007978846`) // K_q 保留 7 位
    expect(tex).toContain(String.raw`0.5\times0.007978846=0.003989423`) // g = μK_q
    expect(tex).toContain(String.raw`x=g\lambda_{\min}=0.003989423\times0.01=3.989423\times10^{-5}`) // 先乘出 x = gλ_min
    expect(tex).toContain(String.raw`=1-3.989423\times10^{-5}=0.99996010577`) // p_slow 顯示到「1 − p 還有 7 位」（11 位）
    expect(Math.log(0.99996010577)).toBeCloseTo(-3.989502e-5, 10) // 照畫面上的 p 按 ln，就是畫面上的 ln（舊版顯示 0.999960106 ⇒ ln = −3.98948e-5，對不起來）
    expect(tex).toContain(String.raw`\ln 0.99996010577=-3.989502\times10^{-5}`)
    // 用畫面上顯示的數字手算（ln 保留 7 位）取上整後就是 75,091——不會因為捨入差 1 個 block
    expect(tex).toContain(String.raw`\frac{-2.995732}{-3.989502\times10^{-5}}`)
    expect(Math.ceil(-2.995732 / -3.989502e-5)).toBe(75091)
    // 退化機率：先算 (1 ± ρ)/2，再各按一次 y^x，最後相加
    expect(tex).toContain(String.raw`\frac{1+0.99}{2}=\frac{1.99}{2}=0.995`)
    expect(tex).toContain(String.raw`0.995^{100}=0.60577`)
    expect(tex).toContain(String.raw`0.005^{100}=`)
    expect(0.995 ** 100 + 0.005 ** 100).toBeCloseTo(pDeg, 14)
    expect(Math.exp(-100 * 0.005)).toBeCloseTo(0.6065, 4) // tips 的 e^{-N₀x} 近似
    expect(Math.abs(Math.exp(-0.5) / pDeg - 1)).toBeLessThan(0.0013) // 相對誤差 ≈ N₀x²/2 = 0.125%
    expect(sol.notes?.[0]).toContain('62.666') // g = 0.5 需要的 μ = 0.5/K_q
    // 把 μ 換成 0.5/K_q 就回到規格的 598 blocks
    expect(resultValues(def, { mu: 0.5 / KQ_SIGMA100 })[1]).toBe(598)
  })

  it('範例答案以一般手算的四捨五入填入時會被判定正確（checkAnswer）', () => {
    const typed: Record<string, number[]> = {
      'HC-09.1': [1.5, 1.5, 2],
      'HC-09.2': [0, 0.693, 0.49, -0.49],
      'HC-09.3': [1.99, 0.01, 199, 0.995, 598],
      'HC-09.4': [2.28, 0.719, 3.17, 0.667, 0.521],
      'HC-09.5': [1.98, 0.99, 0.99],
      'HC-09.6': [6, 2, 0.5, 1.414, 0.667],
      'HC-09.7': [0, 3, 4, 5, 6],
      'HC-09.8': [0.00399, 75091, 0.606, 0.1414],
    }
    for (const h of HANDCALCS) {
      const res = h.solve(defaultValues(h)).results
      expect(res.length, h.id).toBe(typed[h.id].length)
      res.forEach((r, i) => expect(checkAnswer(typed[h.id][i], r).ok, `${h.id} 第 ${i + 1} 個答案 ${r.value}`).toBe(true))
    }
  })
})

describe('Ch09 帶入手算：(b) 隨機題（20 個 seed）有限且與獨立重算一致', () => {
  it.each(IDS)('%s：randomValues(def, seed) 的 solve() 結果有限、通過 validate，且等於測試內直接寫的公式', (id) => {
    const def = ch09HandCalc(id)
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, `${id} seed ${seed}`).toBeNull()
      const sol = def.solve(v)
      expect(sol.steps.length, `${id} seed ${seed}`).toBeGreaterThan(0)
      for (const s of sol.steps) expect(s.tex, `${id} seed ${seed}`).not.toMatch(/NaN|undefined|Infinity/)
      const exp = independent(id, v)
      expect(sol.results.length).toBe(exp.length)
      sol.results.forEach((r, i) => {
        expect(Number.isFinite(r.value), `${id} seed ${seed} 結果 ${i}`).toBe(true)
        expectClose(r.value, exp[i], `${id} seed ${seed} 結果 ${i}（${JSON.stringify(v)}）`, r.symbol === 'k_{95}')
      })
    }
    expect(seen.size, `${id} 應抽到多組不同的數字`).toBeGreaterThan(5)
  })

  it('HC-09.5 的 2×2 手算路徑在隨機參數下都等於網站的 3×3 均方算子（meanSquareRadius），1-bit 倍數等於 (1 − gλ)² − (gλ)²/N', () => {
    const def = ch09HandCalc('HC-09.5')
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      const [rhoMs] = def.solve(v).results.map((r) => r.value)
      expect(rhoMs).toBeCloseTo(meanSquareRadius('gaussian', v.rho, v.g, v.N), 9)
      for (const i of [0, 1] as const) {
        const x = v.g * (i === 0 ? 1 + v.rho : 1 - v.rho)
        expect(signModeFactor(v.rho, v.g, v.N, i)).toBeCloseTo((1 - x) ** 2 - (x * x) / v.N, 12)
      }
    }
  })

  it('HC-09.7：任意參數與任意 c，四相輸出都不變（gauge 恆等式對所有輸入成立，所以這一題不需要 validate）', () => {
    const def = ch09HandCalc('HC-09.7')
    expect(def.validate).toBeUndefined()
    for (const c of [-7.5, 0, 0.125, 1000]) {
      const v = { b: 0.3, a0: 1, a1: -0.5, a2: 0.2, a3: 0.7, c }
      const y = def.solve(v).results.slice(1).map((r) => r.value)
      ;[v.a0, v.a1, v.a2, v.a3].forEach((a, i) => expect(y[i]).toBeCloseTo(v.b + a, 9))
    }
  })
})

// ───────────────────────── 畫面上的算式：把每一步的 TeX 重新求值 ─────────────────────────

type Val = number | number[]

function matchBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  throw new Error(`大括號不成對：${s}`)
}

/**
 * 把一段「只含數字」的 TeX 求值：+ − × ^ \frac \sqrt \ln ⌈⌉、括號、a\times10^{b}，以及向量 (a,\ b)（逐分量運算）。
 * 含符號（字母）的片段回傳 null。自己做遞迴下降剖析（不用 eval），-10^{-6}、(-0.3)^{3}、(5\times10^{-5})^2 的優先順序和數學上相同。
 */
function evalTex(seg: string): Val | null {
  let s = seg
    .replace(/\\(?:left|right|big|Big)/g, '')
    .replace(/\\[,;!]|\\q?quad|\\ /g, ' ')
    .replace(/\\times/g, '*')
    .replace(/\\sqrt\s*\{/g, 'S{')
    .replace(/\\ln\s*/g, 'L')
    .replace(/\\lceil/g, 'C(')
    .replace(/\\rceil/g, ')')
  for (let i = s.indexOf('\\frac{'); i >= 0; i = s.indexOf('\\frac{')) {
    const a0 = i + 5
    const a1 = matchBrace(s, a0)
    const b1 = matchBrace(s, a1 + 1)
    s = `${s.slice(0, i)}((${s.slice(a0 + 1, a1)})/(${s.slice(a1 + 2, b1)}))${s.slice(b1 + 1)}`
  }
  s = s.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\s+/g, '')
  if (!/^[0-9.+\-*/^(),SLC]+$/.test(s) || !/[0-9]/.test(s)) return null
  let pos = 0
  const lift = (a: Val, b: Val, f: (x: number, y: number) => number): Val => {
    if (typeof a === 'number' && typeof b === 'number') return f(a, b)
    const n = Array.isArray(a) ? a.length : (b as number[]).length
    return Array.from({ length: n }, (_, i) => f(Array.isArray(a) ? a[i] : a, Array.isArray(b) ? b[i] : b))
  }
  const num = (v: Val): number => {
    if (typeof v !== 'number') throw new Error(`這裡應該是純量：${seg}`)
    return v
  }
  const expr = (): Val => {
    let v = term()
    while (s[pos] === '+' || s[pos] === '-') {
      const op = s[pos++]
      v = lift(v, term(), (x, y) => (op === '+' ? x + y : x - y))
    }
    return v
  }
  const term = (): Val => {
    let v = unary()
    while (s[pos] === '*' || s[pos] === '/') {
      const op = s[pos++]
      v = lift(v, unary(), (x, y) => (op === '*' ? x * y : x / y))
    }
    return v
  }
  const unary = (): Val => {
    if (s[pos] === '-') return pos++, lift(0, unary(), (x, y) => x - y)
    if (s[pos] === '+') return pos++, unary()
    const base = atom()
    if (s[pos] !== '^') return base
    pos++
    const e = s[pos] === '(' ? num(atom()) : Number(s[pos++])
    return num(base) ** e
  }
  const atom = (): Val => {
    const c = s[pos]
    if (c === '(') {
      pos++
      const items = [expr()]
      while (s[pos] === ',') {
        pos++
        items.push(expr())
      }
      if (s[pos++] !== ')') throw new Error(`括號不成對：${seg}`)
      return items.length === 1 ? items[0] : items.map(num)
    }
    if (c === 'S' || c === 'L' || c === 'C') {
      pos++
      const v = num(atom())
      return c === 'S' ? Math.sqrt(v) : c === 'L' ? Math.log(v) : Math.ceil(v)
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

/** 在最外層（不在大括號、括號裡）的分隔字串處切開。 */
function splitTop(tex: string, seps: string[]): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < tex.length; ) {
    const ch = tex[i]
    if (ch === '{' || ch === '(') depth++
    else if (ch === '}' || ch === ')') depth--
    const hit = depth === 0 ? seps.find((sp) => tex.startsWith(sp, i)) : undefined
    if (hit) {
      out.push(cur)
      cur = ''
      i += hit.length
    } else {
      cur += ch
      i++
    }
  }
  out.push(cur)
  return out.map((x) => x.trim())
}

const flat = (v: Val): number[] => (typeof v === 'number' ? [v] : v)
/** 顯示時四捨五入到 5 位以上 ⇒ 前後兩段最多差 2.5e-4（相對）；與 ch00 的檢查同一個容忍度 */
const sameShown = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 + 2.5e-4 * Math.max(Math.abs(a), Math.abs(b))

/**
 * 一步的 TeX「符號式 = 代入數字 =（中間結果 =）結果」：每一段數字算出來都要等於最後一段。
 * 以 \qquad 分開的並列小式各自檢查；「… \ne …」兩邊必須真的不相等；「… <2」必須真的小於 2。
 * 回傳每個小式最後的數字（向量展開成分量）。
 */
function checkStepTex(tex: string, label: string): number[] {
  const finals: number[] = []
  const cleaned = tex
    .replace(/\\ \(=D\)/g, '')
    .replace(/\\ \\mathrm\{fs\}\^\{-1\}/g, '')
    .replace(/<2$/, '')
  if (/<2$/.test(tex)) {
    const last = evalTex(splitTop(cleaned, ['=']).pop() ?? '')
    expect(typeof last === 'number' && last < 2, `${label}：「<2」不成立（${tex}）`).toBe(true)
  }
  const sides = splitTop(cleaned, [String.raw`\ \ne\ `])
  const sideFinals: number[][] = []
  for (const side of sides) {
    const mine: number[] = []
    for (const part of splitTop(side, [String.raw`,\qquad`, String.raw`\qquad`, String.raw`\ \Rightarrow\ `])) {
      const nums = splitTop(part.replace(/\\approx/g, '='), ['='])
        .map((seg) => ({ seg, v: evalTex(seg) }))
        .filter((x): x is { seg: string; v: Val } => x.v !== null)
      if (!nums.length) continue
      const last = flat(nums[nums.length - 1].v)
      mine.push(...last)
      for (const { seg, v } of nums.slice(0, -1)) {
        const got = flat(v)
        expect(got.length, `${label}：「${seg}」的分量數（${tex}）`).toBe(last.length)
        got.forEach((g, i) => expect(sameShown(g, last[i]), `${label}：「${seg}」= ${g}，但這一步的結果是 ${last[i]}（${tex}）`).toBe(true))
      }
    }
    sideFinals.push(mine)
    finals.push(...mine)
  }
  if (sides.length === 2) {
    const [l, r] = sideFinals.map((f) => f[f.length - 1])
    expect(l, `${label}：寫了 ≠ 但兩邊相等（${tex}）`).not.toBe(r)
  }
  return finals
}

/** 把 defaults 換成指定數字的同一題（HandCalc 以 defaults 當初始輸入，用來渲染任意數字） */
const withValues = (def: HandCalcDef, v: Record<string, number>): HandCalcDef => ({ ...def, inputs: def.inputs.map((i) => ({ ...i, default: v[i.key] })) })

/** 元素的文字，去掉 KaTeX：字串裡的 `$…$` 若沒有成對（或沒被 mathText 處理），這裡會看到殘留的 `$` */
function proseText(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}

const win = (rows: [number, number][]): Record<string, number> => Object.fromEntries(rows.flatMap(([a, b], n) => [[`u1_${n}`, a], [`u2_${n}`, b]]))

/**
 * 使用者自己打的數字（不在「換一題」的範圍內）：剛好抵銷成 0、兩個很接近的數相減、很長的小數、很接近 1 的 pole、
 * 很小／很大的數。舊版在這些情形會顯示 1e-16 的浮點殘渣、「50.5 − 50.498 = 0.0019792」或 ln 對不起來的 p。
 */
const USER_CASES: Record<string, Record<string, number>[]> = {
  'HC-09.1': [
    { a1: 3, a2: 1, mu: 0.25, s: -1 }, // 文中第二張表
    { a1: 0.3, a2: 0.1, mu: 0.5, s: 1 }, // e₁ 剛好是 0（double：−2.8e-17）
    { a1: 0.3, a2: 0.1, mu: 0.75, s: 1 }, // a₁ − w₁ 剛好是 0（0.75×0.4 在 double 裡是 0.30000000000000004）
    { a1: -2, a2: 5, mu: 0.3, s: 0.5 },
    { a1: 2.345, a2: -1.07, mu: 0.137, s: -1 },
    { a1: 0, a2: 0, mu: 0.25, s: 1 },
    { a1: 4, a2: -4, mu: 0.4, s: -1.5 }, // e₀ = 0：第一步完全不動
  ],
  'HC-09.2': [
    { rho: 0.99, g: 0.5, d1: 1, d2: 0, k: 1 }, // 「走四步」表的第 1 列
    { rho: 0.6, g: 1, d1: -1, d2: -1, k: 1 }, // δ₀ 在共模上：c₂ = 0（舊版顯示 1.1102×10⁻¹⁶）
    { rho: 0.8, g: 1, d1: 1, d2: -1, k: 1 }, // δ₀ 在差模上：c₁ = 0
    { rho: 1, g: 0.5, d1: 1, d2: 0, k: 30 }, // 缺乏 PE：p₁ = 0、p₂ = 1
    { rho: 0.9, g: 1.5, d1: -2, d2: 1, k: 3 }, // |p₁| > 1（發散，仍可照算）
    { rho: 0, g: 1, d1: 1, d2: 2, k: 2 }, // 兩個 pole 都是 0
    { rho: 0.25, g: 0.8, d1: 1, d2: 0, k: 3 }, // p₁ = 1 − 0.8×1.25 = 0
    { rho: 0.5, g: 0.25, d1: 1, d2: -1, k: 200 }, // k 很大：c ≈ 1e-12（不是殘渣）
    { rho: 0.3, g: 0.7, d1: -0.5, d2: -0.25, k: 7 },
    { rho: 0.123456, g: 0.654321, d1: 1.5, d2: -0.7, k: 5 }, // 很長的小數
    { rho: 0.5, g: 5, d1: 100, d2: -100, k: 200 }, // 上限：|p|^200 ≈ 1e30
  ],
  'HC-09.3': [
    { rho: 0, g: 0.5 },
    { rho: 0, g: 1 }, // p = 0：不顯示 ln 0
    { rho: 0.5, g: 1.2 }, // g > g*：p_fast < 0；x ≥ 0.5 不顯示泰勒近似
    { rho: 0.999, g: 0.01 }, // p_slow = 0.99999
    { rho: 0.99, g: 1 },
    { rho: 0.3, g: 1.5 }, // p_slow < 0
    { rho: 0.9, g: 0.001 }, // k₉₅ ≈ 29 956
    { rho: 0.123456, g: 0.654321 },
    { rho: 0.95, g: 0.000123 }, // p_slow = 0.99999385：ln 要算得準
  ],
  'HC-09.4': [
    { a: 1, b: 0.99, d: 1 }, // 退化成 λ = 1 ± ρ
    { a: 1, b: -0.5, d: 1 },
    { a: 4, b: 0, d: 1 }, // 已經是對角
    { a: 1, b: 0, d: 1 }, // κ = 1：根號是 0
    { a: 0.5, b: -0.6, d: 3 },
    { a: 100, b: 9.99, d: 1 }, // κ ≈ 51 029：舊版顯示「50.5 − 50.498 = 0.0019792」
    { a: 3, b: 1.7, d: 1 },
    { a: 2, b: 0.0001, d: 2.0003 }, // κ ≈ 1.0002：κ − 1 要算得準
    { a: 1.234, b: 0.5678, d: 0.9012 },
    { a: 0.0002, b: 0.0001, d: 0.0003 }, // 很小的功率
  ],
  'HC-09.5': [
    { rho: 0.99, g: 0.5, N: 2 }, // A₁₁ = A₂₂：h 剛好是 0（舊版顯示 5.551115×10⁻¹⁷）
    { rho: 0.99, g: 0.5, N: 4 },
    { rho: 0.99, g: 0.5, N: 256 },
    { rho: 1, g: 0.5, N: 1 }, // λ_min = 0
    { rho: 0, g: 0.5, N: 1 }, // 1-bit 的 s = 0.25 − 0.25 = 0
    { rho: 0, g: 1, N: 1 }, // p = 0
    { rho: 0.5, g: 1.2, N: 3 },
    { rho: 0.9, g: 1, N: 1 },
    { rho: 0.2, g: 1.6, N: 1 },
    { rho: 0.123456, g: 0.654321, N: 7 },
    { rho: 0.5, g: 0.001, N: 65536 },
  ],
  'HC-09.6': [
    win([[1, 1], [-1, -1], [1, 1], [-1, -1]]), // 窗口 A（退化）
    win([[1, -1], [1, -1], [-1, 1], [1, -1]]), // 全部 flip：共模退化
    win([[2, 0.5], [-1, 1], [0, 3], [1, 1]]),
    win([[1, 0], [1, 0], [1, 0], [1, 0]]), // 第 2 個 regressor 全為 0
    win([[0, 0], [0, 0], [0, 0], [3, -2]]), // 只有一筆資料：rank 1
    win([[0.5, -1.5], [2, 2], [-3, 1], [0, 0]]),
    win([[0.1, 0.3], [0.2, 0.6], [0.3, 0.9], [-0.1, -0.3]]), // u₂ = 3u₁（退化）而且是小數：D 的 double 殘渣
    win([[10, 9.99], [-10, -9.99], [10, 10], [-10, -9.98]]), // 幾乎退化：λ_min 是兩個很接近的數相減
    win([[1, 1], [1, 1], [1, 1], [1, 1.001]]),
  ],
  'HC-09.7': [
    { b: 0, a0: 0, a1: 0, a2: 0, a3: 0, c: 0 },
    { b: 1.5, a0: -2.25, a1: 3, a2: 0.1, a3: 7, c: 0.3 }, // 小數：(b + c) + (a − c) 在 double 裡差 1 ulp
    { b: -3, a0: 4, a1: -4, a2: 6, a3: 0, c: 3 },
    { b: 2, a0: 1, a1: 4, a2: 0, a3: 3, c: 2 }, // 思考題 2
    { b: 1000, a0: 0.0001, a1: -0.0001, a2: 999.9999, a3: -1000, c: -0.7 },
  ],
  'HC-09.8': [
    { sigmaV: 100, mu: 62.6657, rho: 0.99, N0: 100 }, // g ≈ 0.5：回到 598
    { sigmaV: 50, mu: 20, rho: 0.5, N0: 10 },
    { sigmaV: 200, mu: 50, rho: 0.8, N0: 2 },
    { sigmaV: 100, mu: 0.5, rho: 0, N0: 100 }, // 兩種退化機率相等（0.5¹⁰⁰）
    { sigmaV: 1, mu: 1, rho: 0.9, N0: 200 },
    { sigmaV: 100, mu: 200, rho: 0, N0: 20 }, // p_slow < 0
    { sigmaV: 1000, mu: 0.01, rho: 0.999, N0: 100000 }, // p_slow = 1 − 8e-9；((1−ρ)/2)^N₀ 在 double 裡是 0
    { sigmaV: 137.5, mu: 3.3, rho: 0.97, N0: 64 },
    { sigmaV: 100, mu: 150, rho: 0.5, N0: 100 }, // g = 1.197 > g⋆ = 1：最慢的是共模（審查 C01 的說明會出現）
    { sigmaV: 100, mu: 126.6, rho: 0.5, N0: 100 }, // g = 1.0101：|p_fast| > |p_slow| 但兩個 k₉₅ 取上整後都是 5
  ],
}

describe('Ch09 帶入手算：(f) 畫面上的算式自己算得出來', () => {
  it('USER_CASES 涵蓋每一題，而且都是合法輸入', () => {
    expect(Object.keys(USER_CASES)).toEqual(IDS)
    for (const def of HANDCALCS) {
      for (const v of USER_CASES[def.id]) {
        const label = `${def.id} ${JSON.stringify(v)}`
        expect(Object.keys(v).sort(), label).toEqual(def.inputs.map((i) => i.key).sort())
        def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${label} ${i.key}`).toBeNull())
        expect(def.validate?.(v) ?? null, label).toBeNull()
      }
    }
  })

  it.each(HANDCALCS.map((h) => [h.id, h] as const))(
    '%s：每一步「符號式 = 代入數字 = 結果」的數字重新求值後前後一致；每個答案都是某一步的結果（預設值、20 組隨機數字、使用者自己打的數字）',
    (_id, def) => {
      const cases = [defaultValues(def), ...Array.from({ length: 20 }, (_, k) => randomValues(def, k + 1)), ...USER_CASES[def.id]]
      for (const v of cases) {
        const label = `${def.id} ${JSON.stringify(v)}`
        const sol = def.solve(v)
        const finals = sol.steps.flatMap((s, k) => checkStepTex(s.tex, `${label} 第 ${k + 1} 步`))
        for (const s of sol.steps) expect(s.tex, label).not.toMatch(/NaN|undefined|Infinity/)
        for (const r of sol.results) {
          expect(Number.isFinite(r.value), `${label} ${r.symbol}`).toBe(true)
          // max|s_i| 這類答案是某一步結果的絕對值
          const hit = finals.some((f) => Math.abs(Math.abs(f) - Math.abs(r.value)) <= 1e-12 + 1e-4 * Math.max(Math.abs(f), Math.abs(r.value)))
          expect(hit, `${label}：答案 ${r.symbol} = ${r.value} 不是任何一步的結果（各步結果：${finals.join(', ')}）`).toBe(true)
        }
      }
    },
  )

  it.each(IDS)('%s：使用者自己打的數字，答案仍等於獨立重算', (id) => {
    const def = ch09HandCalc(id)
    for (const v of USER_CASES[id]) {
      const label = `${id} ${JSON.stringify(v)}`
      const sol = def.solve(v)
      const exp = independent(id, v)
      expect(sol.results.length, label).toBe(exp.length)
      // 獨立重算是 double：剛好抵銷的地方它會留下 1e-16 量級的殘渣，所以容忍度相對於這一題數字的大小
      const scale = Math.max(1, ...exp.filter(Number.isFinite).map(Math.abs), ...Object.values(v).map(Math.abs))
      sol.results.forEach((r, i) => {
        if (r.symbol === 'k_{95}') expect(Math.abs(r.value - exp[i]), `${label} k95`).toBeLessThanOrEqual(1)
        else expect(Math.abs(r.value - exp[i]), `${label} ${r.symbol}: ${r.value} vs ${exp[i]}`).toBeLessThanOrEqual(1e-9 * scale * Math.max(1, Math.abs(exp[i])))
      })
    }
  })

  it('剛好抵銷的地方顯示 0，而不是 double 的殘渣', () => {
    // HC-09.1：(0.3 − 0.2) + (0.1 − 0.2) 在 double 裡是 −2.8e-17；手算是 0，係數不再移動
    const s1 = ch09HandCalc('HC-09.1').solve({ a1: 0.3, a2: 0.1, mu: 0.5, s: 1 })
    expect(s1.steps[3].tex.endsWith('=0.1+(-0.1)=0')).toBe(true)
    expect(s1.steps[4].tex.endsWith(String.raw`=0\times(1,\ 1)=(0,\ 0)`)).toBe(true)
    expect(s1.results.slice(0, 2).map((r) => r.value)).toEqual([0.2, 0.2])
    expect(s1.results[2].value).toBeCloseTo(0.2, 14)
    // HC-09.2：δ₀ = (1, −1) 整個落在差模上 ⇒ c₁ = 0（cos 45° − sin 45° 在 double 裡是 1.1e-16）
    const s2 = ch09HandCalc('HC-09.2').solve({ rho: 0.8, g: 1, d1: 1, d2: -1, k: 1 })
    expect(s2.steps[5].tex.endsWith(String.raw`=\frac{1+(-1)}{1.41421}=\frac{0}{1.41421}=0`)).toBe(true)
    expect(s2.results[0].value).toBe(0)
    expect(s2.notes?.join('')).toContain('只有一個模式')
    expect(s2.notes?.join('')).not.toMatch(/10\^\{-1\d\}/)
    const s2b = ch09HandCalc('HC-09.2').solve({ rho: 0.6, g: 1, d1: -1, d2: -1, k: 1 })
    expect(s2b.results[1].value).toBe(0)
    expect(s2b.notes?.join('')).toContain('共模方向')
    // 「換一題」抽得到這種數字（d₁ = ±d₂）：20 個 seed 的每一步都不可以出現 1e-13 以下的殘渣
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(ch09HandCalc('HC-09.2'), seed)
      const sol = ch09HandCalc('HC-09.2').solve(v)
      for (const st of sol.steps) expect(st.tex, JSON.stringify(v)).not.toMatch(/10\^\{-1[3-9]\}/)
    }
    // HC-09.5：ρ = .99、g = .5、N = 2（tips 與勘誤 E23 引用的例子）A₁₁ = A₂₂ = 0.99005 ⇒ h = 0、ρ_MS = 0.99005 + 0.0024875
    const s5 = ch09HandCalc('HC-09.5').solve({ rho: 0.99, g: 0.5, N: 2 })
    const h = s5.steps.find((st) => st.tex.startsWith('h='))
    expect(h?.tex.endsWith(String.raw`=\frac{0.99005-0.99005}{2}=\frac{0}{2}=0`)).toBe(true)
    expect(s5.steps.map((st) => st.tex).join('')).not.toMatch(/10\^\{-1\d\}/)
    expect(s5.steps.find((st) => st.tex.startsWith(String.raw`\rho_{\mathrm{MS}}`))?.tex.endsWith('=0.99005+0.0024875=0.9925375')).toBe(true)
    // HC-09.5：ρ = 0、g = .5、N = 1 ⇒ 1-bit 的 s = 0.25 − 0.25 = 0
    const s5b = ch09HandCalc('HC-09.5').solve({ rho: 0, g: 0.5, N: 1 })
    expect(s5b.results[2].value).toBe(0)
    // HC-09.6：u₂ = 3u₁ 的小數窗口：D = 0.0225 − 0.0225 = 0（退化），不是 3e-18
    const s6 = ch09HandCalc('HC-09.6').solve(win([[0.1, 0.3], [0.2, 0.6], [0.3, 0.9], [-0.1, -0.3]]))
    expect(s6.results.slice(1, 4).map((r) => r.value)).toEqual([0, 0, 0])
    expect(s6.steps[4].tex.endsWith('=0')).toBe(true)
    expect(s6.steps.map((st) => st.tex).join('')).not.toMatch(/10\^\{-1\d\}/)
    // HC-09.7：小數的 (b + c) + (a − c) 與 b + a 差 1 ulp：說明裡的最大差是 0
    const s7 = ch09HandCalc('HC-09.7').solve({ b: 1.5, a0: -2.25, a1: 3, a2: 0.1, a3: 7, c: 0.3 })
    expect(s7.notes?.[0]).toContain(String.raw`\max_i|y_i-y_i'|=0$`)
    expect(s7.steps.map((st) => st.why).join('')).not.toContain('浮點')
  })

  it('兩個很接近的數相減：運算元多顯示抵銷掉的那幾位（照畫面上的數字相減就是答案）', () => {
    // HC-09.4：κ ≈ 51 029（舊版：50.5 − 50.498 = 0.0019792）
    const s4 = ch09HandCalc('HC-09.4').solve({ a: 100, b: 9.99, d: 1 })
    const lmin = s4.steps.find((st) => st.tex.startsWith(String.raw`\lambda_{\min}`))
    expect(lmin?.tex.endsWith('=50.5-50.4980208=0.0019792')).toBe(true)
    expect(50.5 - 50.4980208).toBeCloseTo(0.0019792, 9)
    expect(s4.steps[3].why).toContain('保留 9 位')
    expect(s4.steps[6].why).toContain(String.raw`D/\lambda_{\max}`) // 手算建議：κ 很大時改用 λ_min = D/λ_max
    // 沒有抵銷時不多顯示：範例的根號只多留一位（1.5 − 0.781025 = 0.718975 → 0.71898）
    const d4 = ch09HandCalc('HC-09.4').solve({ a: 2, b: 0.6, d: 1 })
    expect(d4.steps[3].tex.endsWith(String.raw`\sqrt{0.61}=0.781025`)).toBe(true)
    expect(d4.steps[5].tex.endsWith('=1.5-0.781025=0.71898')).toBe(true)
    // HC-09.8：p_slow = 1 − 8e-9：p 顯示到 ln 算得準為止；((1−ρ)/2)^N₀ 小於 10⁻⁹⁹ 時提醒計算機會顯示 0
    const s8 = ch09HandCalc('HC-09.8').solve({ sigmaV: 1000, mu: 0.01, rho: 0.999, N0: 100000 })
    const lnStep = s8.steps.find((st) => st.tex.startsWith(String.raw`\ln|p_{\text{slow}}|`))
    const shownP = Number(/\\ln ([0-9.]+)=/.exec(lnStep?.tex ?? '')?.[1])
    expect(Math.abs(Math.log(shownP) / Math.log(1 - 7.978845608e-9) - 1)).toBeLessThan(1e-6)
    expect(lnStep?.why).toContain(String.raw`\ln(1-x)\approx-x-\tfrac{x^2}{2}`)
    const d8 = ch09HandCalc('HC-09.8').solve(defaultValues(ch09HandCalc('HC-09.8')))
    expect(d8.steps.find((st) => st.tex.includes('0.005^{100}'))?.why).toContain('直接顯示 0')
    expect(d8.steps.find((st) => st.tex.includes('0.995^{100}'))?.why).not.toContain('直接顯示 0')
  })

  it('k₉₅：照畫面上顯示的 ln（7 位）相除、取上整，就是答案；x ≥ 0.5 時不顯示泰勒近似', () => {
    const cases: [string, Record<string, number>][] = [
      ...[...USER_CASES['HC-09.3'], defaultValues(ch09HandCalc('HC-09.3'))].map((v): [string, Record<string, number>] => ['HC-09.3', v]),
      ...[...USER_CASES['HC-09.8'], defaultValues(ch09HandCalc('HC-09.8'))].map((v): [string, Record<string, number>] => ['HC-09.8', v]),
    ]
    for (const [id, v] of cases) {
      const sol = ch09HandCalc(id).solve(v)
      const k95 = sol.results.find((r) => r.symbol === 'k_{95}')?.value ?? Number.NaN
      const ceil = sol.steps.find((st) => st.tex.includes(String.raw`\left\lceil`))
      if (!ceil) {
        expect(k95, JSON.stringify(v)).toBe(1) // p = 0：一步歸零
        continue
      }
      const shown = evalTex(/\\left\\lceil (.*)\\right\\rceil=/.exec(ceil.tex)?.[1] ?? '')
      expect(Math.ceil(shown as number), `${id} ${JSON.stringify(v)}`).toBe(k95)
      const x = Number(evalTex(/=\\frac\{2\.995732\}\{(.*)\}=/.exec(sol.steps.find((st) => st.tex.includes(String.raw`\approx`))?.tex ?? '')?.[1] ?? '') ?? Number.NaN)
      const taylor = sol.steps.some((st) => st.tex.includes(String.raw`\approx\frac{\ln 20}`))
      if (taylor) expect(x, JSON.stringify(v)).toBeLessThan(0.5)
    }
    // g > g*（ρ = .5、g = 1.2 ⇒ x = 0.6）：ln(1 − x) ≈ −x 已經沒有意義，不顯示
    expect(ch09HandCalc('HC-09.3').solve({ rho: 0.5, g: 1.2 }).steps.some((st) => st.tex.includes(String.raw`\approx`))).toBe(false)
  })

  it('使用者自己打的數字：<HandCalc> 渲染每一步，沒有 KaTeX 錯誤、沒有落單的 $', () => {
    for (const def of HANDCALCS) {
      for (const v of USER_CASES[def.id]) {
        const label = `${def.id} ${JSON.stringify(v)}`
        const sol = def.solve(v)
        const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
        expectNoTexErrors(container, label)
        expect(container.querySelectorAll('.c-step').length, label).toBe(sol.steps.length)
        expect(proseText(container), label).not.toContain('$')
        expect(container.textContent, label).not.toMatch(/NaN|undefined|無法計算/)
        unmount()
      }
    }
  }, 240_000)
})

describe('Ch09 帶入手算：(c) validate 擋掉模型不適用的輸入並說明原因', () => {
  const cases: { id: string; patch: Record<string, number>; why: RegExp; name: string }[] = [
    { id: 'HC-09.1', patch: { mu: 1 }, why: /修正過頭/, name: 'μ‖u‖² ≥ 2' },
    { id: 'HC-09.1', patch: { mu: 0.5, s: 3 }, why: /修正過頭/, name: 'μ(1 + s²) ≥ 2' },
    { id: 'HC-09.1', patch: { mu: 0 }, why: /必須大於 0/, name: 'μ = 0' },
    { id: 'HC-09.2', patch: { g: 0 }, why: /必須大於 0/, name: 'g = 0' },
    { id: 'HC-09.2', patch: { d1: 0, d2: 0 }, why: /沒有東西可以衰減/, name: 'δ₀ = 0' },
    { id: 'HC-09.3', patch: { rho: 1 }, why: /不可辨識/, name: 'ρ = 1（λ_min = 0）' },
    { id: 'HC-09.3', patch: { g: 1.2 }, why: /平均遞迴發散/, name: 'gλ_max ≥ 2' },
    { id: 'HC-09.3', patch: { g: 0 }, why: /必須大於 0/, name: 'g = 0' },
    { id: 'HC-09.4', patch: { b: 2 }, why: /Cauchy–Schwarz/, name: 'b² > ad（不是相關矩陣）' },
    { id: 'HC-09.4', patch: { a: 1, b: 1, d: 1 }, why: /不可辨識/, name: 'b² = ad（奇異）' },
    { id: 'HC-09.4', patch: { a: 0 }, why: /功率/, name: 'a = 0' },
    { id: 'HC-09.5', patch: { g: 1.5 }, why: /mean 都發散/, name: 'gλ_max ≥ 2' },
    { id: 'HC-09.5', patch: { g: 0 }, why: /必須大於 0/, name: 'g = 0' },
    { id: 'HC-09.6', patch: { u1_0: 0, u2_0: 0, u1_1: 0, u2_1: 0, u1_2: 0, u2_2: 0, u1_3: 0, u2_3: 0 }, why: /沒有任何方向被激發/, name: '全 0 的窗口' },
    { id: 'HC-09.8', patch: { sigmaV: 0 }, why: /小訊號線性化失效/, name: 'σ_v = 0' },
    { id: 'HC-09.8', patch: { mu: 0 }, why: /必須大於 0/, name: 'μ = 0' },
    { id: 'HC-09.8', patch: { rho: 1 }, why: /不可辨識/, name: 'ρ = 1' },
    { id: 'HC-09.8', patch: { mu: 200 }, why: /快模式發散/, name: 'μK_qλ_max ≥ 2' },
  ]
  it.each(cases)('$id：$name ⇒ 拒絕並解釋', ({ id, patch, why }) => {
    const def = ch09HandCalc(id)
    const msg = def.validate?.(values(def, patch)) ?? null
    expect(msg, `${id} ${JSON.stringify(patch)}`).toMatch(why)
    // 訊息裡的 $...$ 都能渲染
    const { container, unmount } = render(<MathText>{msg}</MathText>)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
    expectNoTexErrors(container)
    unmount()
  }, RENDER_TIMEOUT)

  it('邊界剛好合法的輸入不被誤擋：gλ_max 略小於 2、b² 略小於 ad、退化但非全 0 的窗口', () => {
    expect(ch09HandCalc('HC-09.3').validate?.({ rho: 0.99, g: 1 })).toBeNull()
    expect(ch09HandCalc('HC-09.3').validate?.({ rho: 0, g: 1.99 })).toBeNull()
    expect(ch09HandCalc('HC-09.4').validate?.({ a: 1, b: 0.99, d: 1 })).toBeNull()
    expect(ch09HandCalc('HC-09.4').validate?.({ a: 2, b: -0.6, d: 1 })).toBeNull()
    expect(ch09HandCalc('HC-09.8').validate?.({ sigmaV: 100, mu: 100, rho: 0.99, N0: 100 })).toBeNull()
  })
})

describe('Ch09 帶入手算：(d) 渲染', () => {
  it.each(IDS)('%s：<HandCalc> 以範例數字渲染，每一步都有、沒有 KaTeX 錯誤', (id) => {
    const def = ch09HandCalc(id)
    const sol = def.solve(defaultValues(def))
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(sol.steps.length).toBeGreaterThan(0)
    expectNoTexErrors(container)
    expect(container.querySelector(`[id="handcalc-${id}"]`)).toBeTruthy()
    expect(container.textContent).not.toMatch(/NaN|undefined/)
    unmount()
  }, RENDER_TIMEOUT)

  it.each(IDS)('%s：「換一題」數次後看詳解，隨機數字的每一步也都能渲染', (id) => {
    const def = ch09HandCalc(id)
    const { container, unmount } = render(<HandCalc def={def} />)
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByText('換一題（隨機數字）'))
      expect(container.querySelectorAll('.c-step').length).toBe(0) // 練習模式先不顯示詳解
      fireEvent.click(screen.getByText('看詳解'))
      expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
      expectNoTexErrors(container)
      expect(container.textContent).not.toMatch(/NaN|undefined|無法計算/)
    }
    unmount()
  }, RENDER_TIMEOUT)

  it('不適用的輸入：ρ 改成 1 時顯示「不可辨識」的說明而不是步驟；改回來後恢復', () => {
    const { container } = render(<HandCalc def={ch09HandCalc('HC-09.3')} />)
    const rho = screen.getByLabelText(/相關係數/) as HTMLInputElement
    fireEvent.change(rho, { target: { value: '1' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('不可辨識')
    expectNoTexErrors(container)
    fireEvent.change(rho, { target: { value: '0.9' } })
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('58.40') // ρ = .9、g = .5 ⇒ ln 比值 58.40…
    expect(container.textContent).toContain('=59') // k₉₅ = ⌈58.40⌉ = 59
  }, RENDER_TIMEOUT)

  it('退化窗口（窗口 A）的詳解顯示 κ → ∞ 且沒有 KaTeX 錯誤', () => {
    const { container } = render(<HandCalc def={ch09HandCalc('HC-09.6')} />)
    fireEvent.change(screen.getByLabelText(/第 1 筆的 u 2/), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/第 1 筆的 u 1/), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText(/第 1 筆的 u 2/), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText(/第 2 筆的 u 1/), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/第 2 筆的 u 2/), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/第 3 筆的 u 1/), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText(/第 3 筆的 u 2/), { target: { value: '-1' } })
    expect(container.textContent).toContain('退化窗口')
    expectNoTexErrors(container)
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
  }, RENDER_TIMEOUT)
})

describe('Ch09 帶入手算：(e) 題目在章內的位置', () => {
  it('帶入手算：8 題都在章內、各自緊跟在對應的公式／例子之後，綜合題在「思考題」之前，每題都有邀請句', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = renderPage(<Chapter09 />, { url: '/ch/09' })
    const at = (sel: string): Element => {
      const el = container.querySelector(sel)
      expect(el, sel).toBeTruthy()
      return el as Element
    }
    /** a 在文件順序上早於 b */
    const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const hc = (id: string) => at(`[id="handcalc-${id}"]`)
    const formula = (id: string) => at(`[id="formula-${id}"]`)
    const ids = HANDCALCS.map((h) => h.id)
    // 每一題恰好出現一次，而且依 HC-09.1 … HC-09.8 的順序出現
    expect(Array.from(container.querySelectorAll('section.c-handcalc')).map((el) => el.id)).toEqual(ids.map((id) => `handcalc-${id}`))
    // 每一題前面都有一句「換你算：…」邀請讀者先用紙筆算
    const invites = Array.from(container.querySelectorAll('.c-chapter-hand-lead'))
    expect(invites).toHaveLength(ids.length)
    for (const p of invites) {
      expect(p.textContent?.startsWith('換你算：')).toBe(true)
      expect((p.textContent ?? '').length).toBeGreaterThan(20)
      expect(p.nextElementSibling?.classList.contains('c-handcalc')).toBe(true)
    }
    // HC-09.1：開場兩張手算表之後、仍在「一個黑盒子」那一節結束之前的例子裡（先備知識之前）
    expect(before(at('#ch09-intro'), hc('HC-09.1'))).toBe(true)
    expect(before(hc('HC-09.1'), at('#ch09-prereq'))).toBe(true)
    expect(hc('HC-09.1').closest('section.c-section')?.querySelectorAll('table.ch09-table').length).toBeGreaterThanOrEqual(1)
    // 其餘各題：在「前一個公式」之後、「下一個公式／小節」之前
    const between: [string, Element, Element][] = [
      ['HC-09.2', formula('F-09.5'), formula('F-09.6')], // 「走四步」的表之後、598 的推導之前
      ['HC-09.3', formula('F-09.6'), formula('F-09.7')], // k₉₅ 的推導之後
      ['HC-09.4', formula('F-09.7'), formula('F-09.16')], // 最佳 scalar gain 之後
      ['HC-09.5', formula('F-09.18'), at('#ch09-pe')], // mean-square（linear 與 1-bit）之後
      ['HC-09.6', formula('F-09.10'), formula('F-09.11')], // singular value 之後、有限窗口的陷阱之前
      ['HC-09.7', formula('F-09.13'), formula('F-09.14')], // gauge 恆等式之後
      ['HC-09.8', at('#ch09-compare'), at('#ch09-quiz')], // 綜合題：比較表之後、思考題之前
    ]
    for (const [id, prev, next] of between) {
      expect(before(prev, hc(id)), `${id} 應在對應推導之後`).toBe(true)
      expect(before(hc(id), next), `${id} 應在下一個公式／小節之前`).toBe(true)
    }
    // 綜合題緊接在思考題之前：兩者之間沒有其他 level-2 小節
    expect(hc('HC-09.8').closest('section.c-section')?.id).toBe('ch09-synthesis')
    expect(at('#ch09-synthesis').nextElementSibling?.id).toBe('ch09-quiz')
    // 預設直接顯示逐步帶入（每題至少一步），沒有 KaTeX 錯誤
    for (const id of ids) expect(hc(id).querySelectorAll('.c-step').length, id).toBeGreaterThan(0)
    expectNoTexErrors(container)
  }, 60000)
})
