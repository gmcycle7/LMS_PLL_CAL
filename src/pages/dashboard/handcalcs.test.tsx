import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, randomValues, renderTex, texNum } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { FORMULAS } from './formulas'
import { BETA_SMALL_ANGLE_MAX, HANDCALCS, handcalc } from './handcalcs'
import { mathTextProblems } from './mathTextTestUtils'
import { THESIS_PRESETS, presetParams } from './presets'
import { DEFAULT_PARAMS, evaluateThesis, impulseEnergyClosed, impulseEnergyClosedD1, trajectory } from './thesisModel'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}
const golden = (id: string): Vector => JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${id}.json`), 'utf8')) as Vector
function expectGolden(v: Vector, key: string, actual: number) {
  const e = v.expected[key] as number
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  expect(Math.abs(actual - e), `${key}: ${actual} vs ${e}`).toBeLessThanOrEqual((tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e))
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const D2R = Math.PI / 180
const values = (sol: HandCalcSolution): number[] => sol.results.map((r) => r.value)
const solveDefault = (id: string) => handcalc(id).solve(defaultValues(handcalc(id)))
function expectClose(got: number, want: number, tol = 1e-9, msg?: string) {
  expect(Math.abs(got - want), msg ?? `${got} vs ${want}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(want)))
}

/**
 * 每一題的「獨立重算」：直接照課本公式寫，不呼叫 thesisModel.ts 的任何函式。回傳值的順序與 solve().results 相同。
 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-DB.1': ({ sigmaV, mu, Px, Hmag, theta }) => {
    const kq = Math.sqrt(2 / Math.PI) / sigmaV
    const c0 = Math.cos(theta * D2R)
    const C = Px * Hmag * (Math.abs(c0) < 1e-12 ? 0 : c0)
    const g = mu * kq * C
    return [kq, C, g, 1 - g]
  },
  'HC-DB.2': ({ B, C, g, w0 }) => {
    const dW = B / C
    const p = 1 - g
    const d0 = -w0
    const d1 = p * d0 - g * dW
    const d2 = p * d1 - g * dW
    return [dW, d1, d2]
  },
  'HC-DB.3': ({ mu, N, Px, g }) => {
    const eta2 = Px / N
    const s0 = mu * Math.sqrt(eta2 / (g * (2 - g)))
    const s1 = mu * Math.sqrt((eta2 * (1 + g)) / (g * (1 - g) * (2 + g)))
    return [s0, s1, s1 / s0]
  },
  'HC-DB.4': ({ mu, N, g, rho }) => {
    const V0 = (mu * mu) / (N * g * (2 - g))
    const sStrong = Math.sqrt(V0 / (1 + rho))
    const sWeak = Math.sqrt(V0 / (1 - rho))
    return [(1 + rho) / (1 - rho), sStrong, sWeak, Math.sqrt((1 + rho) / (1 - rho)), Math.sqrt(V0 / (1 - rho * rho))]
  },
  'HC-DB.5': ({ sigmaW, dW, Px, fout, Tmag }) => {
    const At = Math.sqrt(2 * Px) * Math.abs(dW)
    const beta = 2 * Math.PI * fout * 1e9 * Tmag * At * 1e-15
    return [Math.sqrt(Px * (dW * dW + sigmaW * sigmaW)), At, beta, 20 * Math.log10(beta / 2)]
  },
  'HC-DB.6': ({ sigmaV, mu, N, phi, B }) => {
    const C = Math.cos(phi * D2R)
    const g = (mu * Math.sqrt(2 / Math.PI) * C) / sigmaV
    const sw = mu / Math.sqrt(N * g * (2 - g))
    const dW = B / C
    return [g, sw, dW, Math.hypot(dW, sw)]
  },
}

/** 題目上所有會以 mathText 顯示的文字 */
const textsOf = (def: HandCalcDef, sol: HandCalcSolution): string[] => [...sol.steps.map((s) => s.why), ...(sol.notes ?? []), ...(def.tips ?? []), def.title]

function expectSolutionRenders(def: HandCalcDef, sol: HandCalcSolution, tag: string) {
  for (const s of sol.steps) {
    expect(renderTex(s.tex, true), `${tag} step: ${s.tex}`).not.toMatch(/katex-error|c-tex-error/)
    expect(s.tex, tag).not.toMatch(/NaN|undefined|Infinity|\\infty/)
    expect(s.tex, tag).not.toMatch(/(^|[^\\])\\\\[a-zA-Z]/) // 不得出現「兩個反斜線接字母」
    expect(s.tex.split('=').length, `${tag}：每一步都是「符號式 = 代入數字 = 結果」`).toBeGreaterThanOrEqual(3)
    expect(s.why.trim().length, tag).toBeGreaterThan(5)
  }
  for (const r of sol.results) {
    expect(Number.isFinite(r.value), `${tag} ${r.symbol}`).toBe(true)
    const boxed = `\\boxed{${r.symbol} = ${texNum(r.value, r.digits ?? 5)}${r.unit ? `\\ ${r.unit}` : ''}}`
    expect(renderTex(boxed, true), `${tag} result: ${boxed}`).not.toMatch(/katex-error|c-tex-error/)
  }
  // 說明文字：$ 成對、TeX 可解析、$…$ 之外沒有 Unicode 拼的公式（teaching-style §3）
  for (const text of textsOf(def, sol)) expect(mathTextProblems(text), `${tag}：${text}`).toEqual([])
}

/** practice 的所有組合（每個輸入都是 choices 清單） */
function practiceGrid(def: HandCalcDef): Record<string, number>[] {
  let out: Record<string, number>[] = [{}]
  for (const i of def.inputs) {
    const choices = i.practice?.choices ?? [i.default]
    out = out.flatMap((v) => choices.map((c) => ({ ...v, [i.key]: c })))
  }
  return out
}

describe('Dashboard handcalcs：題庫結構', () => {
  it('6 題、id 為 HC-DB.1 … HC-DB.6、頁面 /、公式 id 都在 FORMULAS 內、預設值合法、practice 都是手算友善的 choices', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-DB.1', 'HC-DB.2', 'HC-DB.3', 'HC-DB.4', 'HC-DB.5', 'HC-DB.6'])
    const formulaIds = FORMULAS.map((f) => f.id)
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/')
      if (h.formulaId) expect(formulaIds, h.id).toContain(h.formulaId)
      expect(renderTex(h.formulaTex, true), h.id).not.toMatch(/katex-error|c-tex-error/)
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(2)
      for (const i of h.inputs) {
        expect(i.default, `${h.id}.${i.key}`).toBeGreaterThanOrEqual(i.min ?? -Infinity)
        expect(i.default, `${h.id}.${i.key}`).toBeLessThanOrEqual(i.max ?? Infinity)
        expect(i.practice?.choices?.length ?? 0, `${h.id}.${i.key} 要有 practice.choices`).toBeGreaterThanOrEqual(2)
        for (const c of i.practice?.choices ?? []) {
          expect(c, `${h.id}.${i.key}`).toBeGreaterThanOrEqual(i.min ?? -Infinity)
          expect(c, `${h.id}.${i.key}`).toBeLessThanOrEqual(i.max ?? Infinity)
          if (i.integer) expect(Number.isInteger(c), `${h.id}.${i.key}`).toBe(true)
          // 手算友善：最多 3 位有效數字
          expect(Number(c.toPrecision(3)), `${h.id}.${i.key} = ${c}`).toBe(i.integer ? Number(c.toPrecision(3)) : c)
        }
        expect(i.label).not.toContain('$') // 標籤是純文字（同時用在 aria-label）；符號另外以 TeX 顯示
        expect(mathTextProblems(i.label), `${h.id}.${i.key}`).toEqual([])
        expect(renderTex(i.symbol, false)).not.toMatch(/katex-error|c-tex-error/)
        if (i.unit) expect(renderTex(i.unit, false)).not.toMatch(/katex-error|c-tex-error/)
      }
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer']))
    expect(() => handcalc('HC-DB.99')).toThrow()
  })

  it('id 全站唯一：其他章節 / 頁面的 handcalcs.ts 沒有 HC-DB. 開頭的 id（@/app/handcalcs 以 glob 收集具名匯出 HANDCALCS）', async () => {
    const mod = await import('./handcalcs')
    expect(mod.HANDCALCS).toBe(HANDCALCS)
    const idsIn = (file: string) => Array.from(readFileSync(file, 'utf8').matchAll(/^\s*id:\s*'(HC-[^']+)'/gm), (m) => m[1])
    const mine = idsIn(join(process.cwd(), 'src', 'pages', 'dashboard', 'handcalcs.ts'))
    expect(mine).toEqual(HANDCALCS.map((h) => h.id))
    expect(new Set(mine).size).toBe(mine.length)
    let others = 0
    for (const group of ['chapters', 'pages']) {
      const root = join(process.cwd(), 'src', group)
      for (const dir of readdirSync(root)) {
        if (group === 'pages' && dir === 'dashboard') continue
        let ids: string[]
        try {
          ids = idsIn(join(root, dir, 'handcalcs.ts'))
        } catch {
          continue // 這個資料夾沒有 handcalcs.ts
        }
        others += ids.length
        for (const id of ids) expect(id.startsWith('HC-DB.'), `${group}/${dir}: ${id}`).toBe(false)
      }
    }
    expect(others).toBeGreaterThan(0) // 確實掃到了其他章節的題目
  })
})

describe('Dashboard handcalcs：預設值＝規格的 worked example／golden vector', () => {
  it('T13: HC-DB.1 預設（σ_v = 100 fs、μ = 10 fs、C = 1）⇒ K_q、g、p 與 golden 相同', () => {
    const v = golden('T13')
    const [kq, C, g, p] = values(solveDefault('HC-DB.1'))
    expectGolden(golden('T04'), 'kq_per_fs', kq)
    expect(C).toBe(1)
    expectGolden(v, 'g', g)
    expectGolden(v, 'p', p)
    // 與體檢的計算核心是同一個數字
    const r = evaluateThesis({ ...DEFAULT_PARAMS, B: 0 })
    expect([kq, C, g, p]).toEqual([r.Kq, r.polarity.C, r.g, 1 - r.g])
  })

  it('T06: HC-DB.1 換成 θ = 120°、P_x = 1/2 ⇒ C = −0.25、pole > 1；θ = 90° 時 C 恰為 0（random walk）；g ≥ 2 指出條件 3', () => {
    const v = golden('T06')
    const def = handcalc('HC-DB.1')
    const sol = def.solve({ ...defaultValues(def), theta: 120, Px: 0.5 })
    const [, C, , p] = values(sol)
    expectGolden(v, 'C', C)
    expectGolden(v, 'pole', p)
    expect(p).toBeGreaterThan(1)
    expect(sol.notes?.join('')).toContain(String.raw`$C<0$：$p=${texNum(p)}>1$`)
    expect(sol.notes?.join('')).toMatch(/條件 2/)
    const s90 = def.solve({ ...defaultValues(def), theta: 90 })
    expect(s90.results[1].value).toBe(0)
    expect(s90.results[3].value).toBe(1)
    expect(s90.notes?.join('')).toMatch(/random walk/)
    // 步子太大（g = 2.39 ≥ 2）
    const big = def.solve({ ...defaultValues(def), mu: 300 })
    expect(big.results[2].value).toBeGreaterThan(2)
    expect(big.notes?.join('')).toMatch(/條件 3/)
    // 預設（0 < g < 1）：說明裡的時間常數 −1/ln p 由 p 算出
    const dflt = solveDefault('HC-DB.1')
    const tau = -1 / Math.log(dflt.results[3].value)
    expect(dflt.notes?.join('')).toContain(String.raw`\tau=-1/\ln p=${texNum(tau, 4)}`)
    expect(tau).toBeCloseTo(12.026, 3)
  })

  it('HC-DB.2：答案來自體檢的平均軌跡（trajectory），並收斂到 Δw = B/C 而不是 0', () => {
    const def = handcalc('HC-DB.2')
    // 預設輸入＝「動手體檢」的預設值：B = 0.1 fs、C = 1、w_0 − a = −5 fs、g = 0.079788（HC-DB.1 的答案）
    expect(defaultValues(def)).toEqual({ B: DEFAULT_PARAMS.B, C: 1, g: Number(evaluateThesis(DEFAULT_PARAMS).g.toPrecision(5)), w0: DEFAULT_PARAMS.w0MinusA })
    const [dW0, d10, d20] = values(solveDefault('HC-DB.2'))
    expect(dW0).toBeCloseTo(0.1, 12)
    // 手算：p = 0.920212 ⇒ 0.920212×5 − 0.0079788 = 4.5930812；0.920212×4.5930812 − 0.0079788 = 4.2186296
    expect(d10).toBeCloseTo(4.5930812, 6)
    expect(d20).toBeCloseTo(4.2186296, 6)
    // 就是體檢預設那張圖的前兩個點（輸入的 g 只取 5 位有效數字 ⇒ 差在 1e-5 以內）
    const site = trajectory(evaluateThesis(DEFAULT_PARAMS), 2)
    expect(-site.mean[1]).toBeCloseTo(d10, 5)
    expect(-site.mean[2]).toBeCloseTo(d20, 5)
    expect(def.tips?.join('')).toContain(String.raw`$E[\delta_1]=${texNum(d10)}\ \mathrm{fs}$、$E[\delta_2]=${texNum(d20)}\ \mathrm{fs}$`)
    // 好算的數字（g = 0.5）：δ_0 = 5、p = 0.5、gΔw = 0.05 ⇒ 2.45、1.175
    const [dW, d1, d2] = values(def.solve({ B: 0.1, C: 1, g: 0.5, w0: -5 }))
    expect(dW).toBeCloseTo(0.1, 12)
    expect(d1).toBeCloseTo(2.45, 12)
    expect(d2).toBeCloseTo(1.175, 12)
    // 與 evaluateThesis + trajectory 直接比對（同一個核心）
    const r = evaluateThesis({ ...DEFAULT_PARAMS, mu: 0.5 / evaluateThesis(DEFAULT_PARAMS).Kq, B: 0.1, w0MinusA: -5 })
    const tr = trajectory(r, 400)
    expect(-tr.mean[1]).toBeCloseTo(d1, 12)
    expect(-tr.mean[2]).toBeCloseTo(d2, 12)
    expect(tr.mean[400]).toBeCloseTo(dW, 9)
    // 提示裡的數字就是這幾個答案
    expect(def.tips?.join('')).toContain(String.raw`$E[\delta_1]=2.45\ \mathrm{fs}$、$E[\delta_2]=1.175\ \mathrm{fs}$`)
    // 反面：C < 0（排斥點）、C = 0（沒有恢復力）、g 超出 (0, 2) 都要說明原因
    expect(def.validate?.({ B: 0.1, C: -0.5, g: 0.5, w0: -5 })).toMatch(/^\$C<0\$：.*排斥點/)
    expect(def.validate?.({ B: 0.1, C: 0, g: 0.5, w0: -5 })).toMatch(/^\$C=0\$：沒有恢復力/)
    expect(def.validate?.({ B: 0.1, C: 1, g: 2, w0: -5 })).toContain('$0<g<2$')
    expect(def.validate?.({ B: 0.1, C: 1, g: 2, w0: -5 })).toContain('$p=1-g=-1$')
    expect(def.validate?.({ B: 0.1, C: 1, g: 0, w0: -5 })).toContain('$0<g<2$')
    expect(def.validate?.({ B: 0.1, C: 1, g: 1.9, w0: -5 })).toBeNull()
  })

  it('HC-DB.2 邊界：初值剛好在固定點上（δ_0 = δ*）時不除以 0，說明「一步都不會動」', () => {
    // B = 0.5、C = 0.25 ⇒ Δw = 2；w_0 − a = 2 ⇒ δ_0 = −2 = δ*（這一組在 practice 的組合裡）
    const def = handcalc('HC-DB.2')
    const sol = def.solve({ B: 0.5, C: 0.25, g: 0.2, w0: 2 })
    expect(values(sol)).toEqual([2, expect.closeTo(-2, 12), expect.closeTo(-2, 12)])
    expect(sol.notes?.join('')).toMatch(/一步都不會動/)
    expect(sol.notes?.join('')).not.toMatch(/NaN|Infinity/)
    // B = 0：固定點就是真值
    const b0 = def.solve({ B: 0, C: 1, g: 0.5, w0: -5 })
    expect(b0.results[0].value).toBe(0)
    expect(b0.steps.map((s) => s.why).join('')).toMatch(/固定點就是真值/)
  })

  it('T13: HC-DB.3 預設（g 取 HC-DB.1 答案的 5 位有效數字）⇒ σ_w(d = 0) = 0.3992 fs；d = 1 等於封閉式；g ≥ 1 時說明 g*(1) = 1', () => {
    const v = golden('T13')
    const def = handcalc('HC-DB.3')
    // 預設輸入就是 T13：μ = 10 fs、N = 4096、P_x = 1、g = 0.079788
    expect(defaultValues(def)).toEqual({ mu: 10, N: 4096, Px: 1, g: Number((v.expected.g as number).toPrecision(5)) })
    const [d0] = values(solveDefault('HC-DB.3'))
    expect(d0).toBeCloseTo(v.expected.sigma_w_fs as number, 5) // 輸入 g 只取 5 位有效數字
    expect(texNum(d0, 4)).toBe('0.3992')
    // 以 golden 的完整 g 代入：與 golden 的 σ_w 完全相同
    const g = v.expected.g as number
    const [s0, s1, ratio] = values(def.solve({ mu: 10, N: 4096, Px: 1, g }))
    expectGolden(v, 'sigma_w_fs', s0)
    expectClose(s1, 10 * Math.sqrt(impulseEnergyClosedD1(g) / 4096), 1e-10)
    expectClose(ratio, Math.sqrt(impulseEnergyClosedD1(g) / impulseEnergyClosed(g)), 1e-10)
    // 與體檢（d = 1）是同一個數字
    expectClose(s1, evaluateThesis({ ...DEFAULT_PARAMS, d: 1 }).sigmaW, 1e-12)
    expect(def.validate?.({ mu: 10, N: 4096, Px: 1, g: 1 })).toContain(String.raw`$g^*(1)=2\sin(\pi/6)=1$`)
    expect(def.validate?.({ mu: 10, N: 4096, Px: 1, g: 0.5 })).toBeNull()
  })

  it('T10: HC-DB.4 預設＝體檢 preset「ρ = 0.99 ＋ preconditioner」：κ = 199、σ_ξ 與 σ_w 等於 evaluateThesis，比值 = √κ', () => {
    const def = handcalc('HC-DB.4')
    const [kappa, sStrong, sWeak, ratio, sigmaW] = values(solveDefault('HC-DB.4'))
    expectGolden(golden('T10'), 'cond', kappa)
    expect(ratio).toBeCloseTo(Math.sqrt(199), 9)
    const preset = THESIS_PRESETS.find((p) => p.id === 'thesis-rho099-precond')
    expect(preset).toBeDefined()
    const r = evaluateThesis(presetParams(preset!))
    // 輸入的 g 只取 5 位有效數字 ⇒ 與 preset 的差在 1e-5 以內
    expectClose(sStrong, Math.sqrt(r.modes[0].variance), 1e-5)
    expectClose(sWeak, Math.sqrt(r.modes[1].variance), 1e-5)
    expectClose(sigmaW, r.sigmaW, 1e-5)
    expect(r.checks.find((c) => c.id === 'variance')?.state).toBe('fail') // 提示說「條件 4 未通過」
    expect(sigmaW).toBeGreaterThan(DEFAULT_PARAMS.jitterBudget)
    // 提示引用的數字（4 位有效數字）就是手算的答案
    const tips = def.tips?.join('') ?? ''
    expect(tips).toContain(`$${texNum(sStrong, 4)}$ 與 $${texNum(sWeak, 4)}\\ \\mathrm{fs}$`)
    expect(tips).toContain(String.raw`$\sigma_w=${texNum(sigmaW, 4)}\ \mathrm{fs}$`)
    // 反面：ρ = 1（不可辨識）、g 超出 (0, 2)（不穩）
    expect(def.validate?.({ mu: 10, N: 4096, g: 0.5, rho: 1 })).toMatch(/不可辨識/)
    expect(def.validate?.({ mu: 10, N: 4096, g: 2, rho: 0.5 })).toContain('$0<g<2$')
    expect(def.validate?.({ mu: 10, N: 4096, g: 2, rho: 0.5 })).toMatch(/條件 3/)
    expect(def.validate?.({ mu: 10, N: 4096, g: 1.9, rho: 0 })).toBeNull()
    // ρ = 0：兩個 mode 一樣吵，σ_w 等於單參數的值
    const flat = values(def.solve({ mu: 10, N: 4096, g: 0.5, rho: 0 }))
    expect(flat[0]).toBe(1)
    expect(flat[3]).toBe(1)
    expectClose(flat[4], flat[1], 1e-12)
    // g(1 + ρ) ≥ 2：一般 LMS 已經不穩，說明要點出來（preconditioner 仍然穩定）
    const hot = def.solve({ mu: 10, N: 4096, g: 1.5, rho: 0.5 })
    expect(hot.notes?.join('')).toMatch(/已經不穩/)
    expect(values(hot).every(Number.isFinite)).toBe(true)
  })

  it('HC-DB.4 對 golden「preconditioner_variance」：Var(ξ) = γ/(K_q² N λ(2 − γ))（γ = 0.5、1、1.5）', () => {
    const v = golden('preconditioner_variance')
    const def = handcalc('HC-DB.4')
    const kq = v.inputs.kq_per_fs as number
    const N = v.inputs.N as number
    ;(v.inputs.gamma_list as number[]).forEach((gamma, i) => {
      // γ 就是每個 mode 的 loop gain g；μ = γ/K_q（C = 1）
      const [, sStrong, sWeak] = values(def.solve({ mu: gamma / kq, N, g: gamma, rho: 0.99 }))
      expectClose(sStrong ** 2, (v.expected.var_lambda_max_list as number[])[i], 1e-10)
      expectClose(sWeak ** 2, (v.expected.var_lambda_min_list as number[])[i], 1e-10)
    })
  })

  it('T15: HC-DB.5 預設（A_t = 0.5 fs peak、13 GHz、|T| = 1）⇒ β、spur 與 golden 相同；σ_δt 取自體檢', () => {
    const v = golden('T15')
    const def = handcalc('HC-DB.5')
    const [sigmaDt, At, beta, spur] = values(solveDefault('HC-DB.5'))
    expect(At).toBeCloseTo(0.5, 14)
    expectGolden(v, 'beta_rad', beta)
    expectGolden(v, 'spur_dbc', spur)
    // 預設輸入＝體檢 preset「13 GHz、0.5 fs peak tone（T15）」：σ_w 取指標表顯示的 4 位有效數字
    const preset = THESIS_PRESETS.find((p) => p.id === 'thesis-spur-t15')
    expect(preset).toBeDefined()
    const r = evaluateThesis(presetParams(preset!))
    expect(defaultValues(def)).toEqual({ sigmaW: Number(r.sigmaW.toPrecision(4)), dW: 0.5, Px: 0.5, fout: 13, Tmag: 1 })
    expect(r.deltaW).toBeCloseTo(0.5, 12)
    expectClose(sigmaDt, r.sigmaDt, 1e-4)
    expect(sigmaDt).toBeCloseTo(Math.sqrt(0.5 * (0.25 + defaultValues(def).sigmaW ** 2)), 12)
    expect(texNum(sigmaDt, 4)).toBe(texNum(r.sigmaDt, 4)) // 提示引用的「σ_δt 合計」就是手算的答案
    expect(def.tips?.join('')).toContain(String.raw`$\sigma_{\delta t}$ 合計 $=${texNum(r.sigmaDt, 4)}\ \mathrm{fs}$`)
    // σ_δt：把體檢算出的完整 σ_w 當輸入，應得到體檢的合計值
    const again = values(def.solve({ sigmaW: r.sigmaW, dW: r.deltaW, Px: 0.5, fout: 13, Tmag: 1 }))
    expectClose(again[0], r.sigmaDt, 1e-12)
    expectClose(again[3], r.spurDbc, 1e-12)
    // Δw 的正負號不影響 tone 幅度；σ_w = 0 時只剩 bias 那一項
    expect(values(def.solve({ sigmaW: 0.4, dW: -0.5, Px: 0.5, fout: 13, Tmag: 1 }))[3]).toBeCloseTo(spur, 12)
    const noNoise = values(def.solve({ sigmaW: 0, dW: 0.5, Px: 0.5, fout: 13, Tmag: 1 }))
    expect(noNoise.every(Number.isFinite)).toBe(true)
    expect(noNoise[0]).toBeCloseTo(Math.sqrt(0.5) * 0.5, 14)
  })

  it('HC-DB.5 的適用範圍：Δw = 0（沒有 tone）與 β 太大（不是小角度）都要說明原因', () => {
    const def = handcalc('HC-DB.5')
    expect(def.validate?.({ sigmaW: 0.4, dW: 0, Px: 0.5, fout: 13, Tmag: 1 })).toMatch(/沒有 gain bias/)
    // Δw = 100 fs、P_x = 4、100 GHz、|T| = 4 ⇒ β = 2π·1e11·4·(√8·100e-15) ≈ 0.711 rad
    const big = { sigmaW: 0.4, dW: 100, Px: 4, fout: 100, Tmag: 4 }
    const beta = 2 * Math.PI * 100e9 * 4 * Math.sqrt(8) * 100e-15
    expect(beta).toBeGreaterThan(BETA_SMALL_ANGLE_MAX)
    expect(def.validate?.(big)).toContain(String.raw`=${texNum(beta, 3)}\ \mathrm{rad}$ 已經不算小角度`)
    expect(def.validate?.(big)).toMatch(/Bessel/)
    // 剛好在界線內的例子可以算，而且小角度近似的誤差確實很小：(β/2)(1 + β²/8) vs β/2 差不到 0.05 dB
    const edge = { sigmaW: 0.4, dW: 10, Px: 0.5, fout: 100, Tmag: 0.3 }
    expect(def.validate?.(edge)).toBeNull()
    const b = values(def.solve(edge))[2]
    expect(b).toBeLessThanOrEqual(BETA_SMALL_ANGLE_MAX)
    expect(20 * Math.log10(1 + (BETA_SMALL_ANGLE_MAX * BETA_SMALL_ANGLE_MAX) / 8)).toBeLessThan(0.05)
  })

  it('T13: HC-DB.6（綜合）預設＝體檢的預設值：g、σ_w、Δw、σ_δt 與 evaluateThesis 完全相同，六個條件全部通過', () => {
    const r = evaluateThesis(DEFAULT_PARAMS)
    const sol = solveDefault('HC-DB.6')
    expect(values(sol)).toEqual([r.g, r.sigmaW, r.deltaW, r.sigmaDt])
    expectGolden(golden('T13'), 'sigma_w_fs', sol.results[1].value)
    expect(sol.notes?.[0]).toMatch(/1\. 資訊足夠：通過.*6\. 真正改善 PLL 輸出：通過/)
    expect(sol.notes).toHaveLength(2) // 全部通過時沒有額外的失敗原因
    // 預算太小 ⇒ 第六個條件未通過，並在說明中點出，同時引用體檢給的原因
    const def = handcalc('HC-DB.6')
    const tight = def.solve({ ...defaultValues(def), B: 0.5, budget: 0.5 })
    expect(tight.notes?.join('')).toMatch(/6\. 真正改善 PLL 輸出：未通過/)
    expect(tight.notes?.join('')).toMatch(/超出預算/)
    expect(tight.notes?.join('')).toMatch(/條件 6（未通過）：/)
    // timing error 在預算內、但 spur 超過體檢預設的上限：不能只說「在預算內」
    const spurOnly = def.solve({ ...defaultValues(def), B: 5, budget: 10 })
    const rs = evaluateThesis({ ...DEFAULT_PARAMS, B: 5, jitterBudget: 10 })
    expect(rs.sigmaDt).toBeLessThan(10)
    expect(rs.spurDbc).toBeGreaterThan(DEFAULT_PARAMS.spurLimit)
    expect(spurOnly.notes?.join('')).toMatch(/6\. 真正改善 PLL 輸出：未通過/)
    expect(spurOnly.notes?.join('')).toContain(String.raw`\approx20\log_{10}(\pi f_{\mathrm{out}}|T|A_t)`)
    // 反面：極性錯誤、步子太大
    expect(def.validate?.({ ...defaultValues(def), phi: 120 })).toMatch(/條件 2/)
    expect(def.validate?.({ ...defaultValues(def), phi: 120 })).toContain(String.raw`$C=\cos\phi=-0.5\le0$`)
    expect(def.validate?.({ ...defaultValues(def), phi: 90 })).toContain(String.raw`$C=\cos\phi=0\le0$`)
    expect(def.validate?.({ ...defaultValues(def), mu: 300 })).toMatch(/條件 3/)
  })
})

describe('Dashboard handcalcs：獨立重算、KaTeX、隨機出題', () => {
  it('practice 的每一種組合都合法（validate 通過）、答案有限且等於照課本公式的獨立重算，說明文字沒有 NaN', () => {
    let total = 0
    for (const def of HANDCALCS) {
      for (const v of practiceGrid(def)) {
        total++
        const tag = `${def.id} ${JSON.stringify(v)}`
        expect(def.validate?.(v) ?? null, tag).toBeNull()
        const sol = def.solve(v)
        const want = INDEPENDENT[def.id](v)
        expect(sol.results).toHaveLength(want.length)
        sol.results.forEach((r, i) => {
          expect(Number.isFinite(r.value), `${tag} ${r.symbol}`).toBe(true)
          expectClose(r.value, want[i], 1e-9, `${tag} ${r.symbol}: ${r.value} vs ${want[i]}`)
        })
        const text = [...sol.steps.flatMap((s) => [s.tex, s.why]), ...(sol.notes ?? [])].join('\n')
        expect(text, tag).not.toMatch(/NaN|undefined|Infinity|\\infty/)
      }
    }
    expect(total).toBeGreaterThan(1000)
  })

  it('每一題：預設值與 20 組隨機題目的答案都等於獨立重算；所有 TeX 可渲染、文字中的數學都在 $…$ 內', () => {
    for (const def of HANDCALCS) {
      const sets = [defaultValues(def), ...SEEDS.map((s) => randomValues(def, s))]
      // 20 個 seed 不是同一題重複 20 次
      expect(new Set(sets.map((v) => JSON.stringify(v))).size, def.id).toBeGreaterThan(5)
      for (const v of sets) {
        expect(def.validate?.(v) ?? null, `${def.id} ${JSON.stringify(v)}`).toBeNull()
        const sol = def.solve(v)
        const want = INDEPENDENT[def.id](v)
        expect(sol.results).toHaveLength(want.length)
        sol.results.forEach((r, i) => expectClose(r.value, want[i], 1e-9, `${def.id} ${r.symbol} ${JSON.stringify(v)}: ${r.value} vs ${want[i]}`))
        expectSolutionRenders(def, sol, `${def.id} ${JSON.stringify(v)}`)
        // 正確答案一定被判為正確；差 5% 的答案被判錯（接近 0 的答案除外：容許誤差以絕對值計）
        for (const r of sol.results) {
          expect(checkAnswer(r.value, r).ok, `${def.id} ${r.symbol}`).toBe(true)
          if (Math.abs(r.value) > 0.05 && !r.tolerance?.abs) expect(checkAnswer(r.value * 1.05, r).ok, `${def.id} ${r.symbol} +5%`).toBe(false)
        }
      }
    }
  })

  it('validate 的說明文字也照 LaTeX 規範（$ 成對、可解析、$…$ 之外沒有 Unicode 公式）', () => {
    const bad: [string, Record<string, number>][] = [
      ['HC-DB.2', { B: 0.1, C: -0.5, g: 0.5, w0: -5 }],
      ['HC-DB.2', { B: 0.1, C: 0, g: 0.5, w0: -5 }],
      ['HC-DB.2', { B: 0.1, C: 1, g: 2.5, w0: -5 }],
      ['HC-DB.3', { mu: 10, N: 4096, Px: 1, g: 1 }],
      ['HC-DB.4', { mu: 10, N: 4096, g: 0.5, rho: 1 }],
      ['HC-DB.4', { mu: 10, N: 4096, g: 2.5, rho: 0.5 }],
      ['HC-DB.5', { sigmaW: 0.4, dW: 0, Px: 0.5, fout: 13, Tmag: 1 }],
      ['HC-DB.5', { sigmaW: 0.4, dW: 100, Px: 4, fout: 100, Tmag: 4 }],
      ['HC-DB.6', { sigmaV: 100, mu: 10, N: 4096, phi: 120, B: 0.1, budget: 1 }],
      ['HC-DB.6', { sigmaV: 100, mu: 300, N: 4096, phi: 0, B: 0.1, budget: 1 }],
    ]
    for (const [id, v] of bad) {
      const msg = handcalc(id).validate?.(v)
      expect(typeof msg, `${id} ${JSON.stringify(v)}`).toBe('string')
      expect((msg as string).length).toBeGreaterThan(20) // 有解釋原因，不是只說「不合法」
      expect(mathTextProblems(msg as string), `${id}: ${msg}`).toEqual([])
    }
  })

  it('每個答案都出現在某一步的等號右邊；最後一步用到最後一個答案（步驟與結果不脫節）', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const tex = sol.steps.map((s) => s.tex).join('\n')
      for (const r of sol.results) expect(tex, `${def.id} ${r.symbol}`).toContain(`=${texNum(r.value, r.digits ?? 5)}`)
      // HC-DB.2 的最後一步把 E[δ_2] 換回 w 的座標（變號），所以比的是絕對值
      const last = sol.results[sol.results.length - 1]
      expect(sol.steps[sol.steps.length - 1].tex, def.id).toContain(texNum(Math.abs(last.value), last.digits ?? 5))
    }
  })

  it('HandCalc 元件可以渲染每一題；輸入不適用的數字時顯示原因而不是崩潰', () => {
    for (const def of HANDCALCS) {
      const { container, unmount } = render(<HandCalc def={def} />)
      expect(container.querySelector(`[id="handcalc-${def.id}"]`)).toBeTruthy()
      expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
      expect(container.textContent).not.toMatch(/undefined|NaN/)
      // 沒有漏網的 $（字串都經過 mathText）
      const plain = container.cloneNode(true) as HTMLElement
      plain.querySelectorAll('.katex').forEach((el) => el.remove())
      expect(plain.textContent ?? '', def.id).not.toMatch(/\$/)
      unmount()
    }
    // HC-DB.6：把相位改成 120° ⇒ 顯示「條件 2」的說明
    const def = handcalc('HC-DB.6')
    const { container } = render(<HandCalc def={def} />)
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[]
    const phiIndex = def.inputs.findIndex((i) => i.key === 'phi')
    fireEvent.change(inputs[phiIndex], { target: { value: '120' } })
    expect(container.textContent).toMatch(/條件 2/)
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    // 「換一題」：抽到的數字合法，切到「自己算算看」，填入正確答案後判為正確
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => /換一題/.test(b.textContent ?? '')) as HTMLButtonElement)
    expect(container.querySelector('.callout-warn')).toBeNull()
    const vals = Object.fromEntries(def.inputs.map((i, k) => [i.key, Number((container.querySelectorAll('.c-handcalc-inputs input')[k] as HTMLInputElement).value)]))
    const sol = def.solve(vals)
    const answers = Array.from(container.querySelectorAll('.c-handcalc-practice input')) as HTMLInputElement[]
    expect(answers).toHaveLength(sol.results.length)
    answers.forEach((el, k) => fireEvent.change(el, { target: { value: String(Number(sol.results[k].value.toPrecision(4))) } }))
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '對答案') as HTMLButtonElement)
    expect(container.querySelectorAll('.c-handcalc-verdict.ok')).toHaveLength(sol.results.length)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad')).toHaveLength(0)
  })
})
