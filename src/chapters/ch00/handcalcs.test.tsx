import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HandCalc, defaultValues, inputError, randomValues } from '@/components'
import { SettingsProvider } from '@/app/settings'
import type { HandCalcDef } from '@/data/types'
import { conventionalStep, fixedXPole, signErrorStep } from '@/simulation/models/lms'
import { HANDCALCS } from './handcalcs'
import { Dec, FULL, sigFor, tx, txBase, txCeilArg, txInt, txP, txPow, txSq } from './handcalcTex'
import { FORMULAS } from './formulas'
import {
  NOISY_DATA,
  STEADY_STATE_EXAMPLE,
  analyticGradient,
  centralDifference,
  closedFormW,
  correlatedNoiseBias,
  equivalentAveragingLength,
  handCalcRows,
  leastSquaresGain,
  productMoments,
  regressorMoments,
  samplesForTargetStd,
  simulateNoiseAverage,
  steadyStateVarW,
  stepsToFraction,
  timeAverageVarianceError,
} from './model'
import Chapter00 from './index'
import { HAND_CALC_PARAMS } from './sections/HandCalc'
import { BIAS_DEMO, BIAS_KAPPA_LIST } from './sections/Assumptions'
import { GRADIENT_EXAMPLE } from './sections/WhyEx'
import { SIGN_ONE_STEP } from './sections/SignTeaser'
import { QUIZ3 } from './sections/Wrapup'
import { NOISE_LAB_DEFAULTS } from './experiments/NoiseAverageLab'

// 重量級外部函式庫：jsdom 中以假物件取代（整章渲染的測試需要）
vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn(async () => undefined),
    purge: vi.fn(),
    toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    downloadImage: vi.fn(async () => ''),
    Plots: { resize: vi.fn() },
    Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
  },
}))
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  },
}))

interface Vector {
  inputs: Record<string, number | number[]>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

function vector(id: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${id}.json`), 'utf8')) as Vector
}

const hc = (id: string): HandCalcDef => {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到 ${id}`)
  return def
}

const values = (def: HandCalcDef, v: Record<string, number>): number[] => def.solve(v).results.map((r) => r.value)

/** |actual − expected| ≤ abs + rel·|expected| */
function close(actual: number, expected: number, rel = 1e-9, abs = 1e-12, label = '') {
  expect(Math.abs(actual - expected), `${label} actual=${actual} expected=${expected}`).toBeLessThanOrEqual(abs + rel * Math.abs(expected))
}

/** 把 defaults 換成指定數字的同一題（HandCalc 以 defaults 當初始輸入，用來渲染任意數字） */
const withValues = (def: HandCalcDef, v: Record<string, number>): HandCalcDef => ({ ...def, inputs: def.inputs.map((i) => ({ ...i, default: v[i.key] })) })

/** 元素的文字，去掉 KaTeX：字串裡的 `$…$` 若沒有成對（或沒被 mathText 處理），這裡會看到殘留的 `$` */
function proseText(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}

const unpaired = (s: string): boolean => (s.match(/(?<!\\)\$/g) ?? []).length % 2 !== 0

/** 公式裡不可以印出 NaN／∞／undefined（符號 w_∞ 的下標不算） */
const badNumber = (tex: string): boolean => /NaN|undefined|\\infty/.test(tex.replace(/w_\\infty/g, 'w'))

/**
 * 獨立重算：直接在測試裡把公式再寫一次（刻意不呼叫 model.ts／lms.ts，而且盡量用「另一種寫法」），
 * 用來和 solve()（呼叫實際模擬函式）逐一比對。順序與各題 results 相同。
 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-00.1': ({ w0, x, y, mu }) => {
    const w1 = w0 + mu * (y - w0 * x) * x
    return [w1, w1 + mu * (y - w1 * x) * x]
  },
  'HC-00.2': ({ x, mu, d0, n }) => [2 / (x * x), 1 - mu * x * x, d0 * (1 - mu * x * x) ** n],
  'HC-00.3': ({ x1, y1, x2, y2, x3, y3 }) => {
    const sxy = x1 * y1 + x2 * y2 + x3 * y3
    const sxx = x1 ** 2 + x2 ** 2 + x3 ** 2
    return [sxy, sxx, sxy / sxx]
  },
  'HC-00.4': ({ w, x, y, h, mu }) => {
    const j = (ww: number) => 0.5 * (y - ww * x) ** 2
    const e = y - w * x
    return [-e * x, (j(w + h) - j(w - h)) / (2 * h), w + mu * e * x]
  },
  'HC-00.5': ({ a, w, sv, ex2, ex4, N, target }) => {
    const d = a - w
    // max(0, ·)：±A 碼時 double 的 E[x⁴] − E[x²]² 可能是 −7e-18（數學上是 0）
    const s1 = Math.sqrt(Math.max(0, d * d * (ex4 - ex2 * ex2) + sv * sv * ex2))
    // 不用 ⌈(s₁/target)²⌉：直接找「s₁/√N ≤ target 的最小整數 N」
    let nMin = Math.max(1, Math.floor((s1 / target) ** 2) - 2)
    while (s1 / Math.sqrt(nMin) > target * (1 + 1e-9)) nMin++
    return [d * ex2, s1, s1 / Math.sqrt(N), nMin]
  },
  'HC-00.6': ({ mu, x, sv }) => {
    const p = 1 - mu * x * x
    const v = (mu * sv * sv) / (2 - mu * x * x) // model.ts 用的是另一個等價式 μ²x²σ²/(1 − p²)
    return [v, Math.sqrt(v), (1 + p) / (1 - p)]
  },
  'HC-00.7': ({ w, x, y, mu }) => {
    const e = y - w * x
    return [w + mu * e * x, w + mu * Math.sign(e) * x]
  },
  'HC-00.8': ({ a, kappa, mu, sv, n }) => {
    const p = 1 - mu
    // 不用 ln：直接連乘，找 |p|ⁿ ≤ 0.01 的最小 n
    let n1 = 1
    let r = Math.abs(p)
    while (r > 0.01 * (1 + 1e-9)) {
      r *= Math.abs(p)
      n1++
    }
    return [a + kappa, p, n1, Math.sqrt((mu * sv * sv) / (2 - mu)), sv / Math.sqrt(n)]
  },
}

/** validate 必須擋下的輸入（docs/teaching-style.md §7），以及訊息中應該出現的解釋。 */
const INVALID: { id: string; name: string; patch: Record<string, number>; expect: RegExp }[] = [
  { id: 'HC-00.2', name: 'x = 0（不可辨識）', patch: { x: 0 }, expect: /不可辨識/ },
  { id: 'HC-00.3', name: '三筆 x 都是 0', patch: { x1: 0, x2: 0, x3: 0 }, expect: /不可辨識/ },
  { id: 'HC-00.4', name: 'h = 0（0/0）', patch: { h: 0 }, expect: /0\/0/ },
  { id: 'HC-00.4', name: 'h 太小（兩個 j 相減只剩捨入誤差）', patch: { h: 1e-12 }, expect: /捨入誤差/ },
  { id: 'HC-00.5', name: 'E[x²] = 0', patch: { ex2: 0 }, expect: /不可辨識/ },
  { id: 'HC-00.5', name: 'E[x⁴] < E[x²]²', patch: { ex2: 2, ex4: 3 }, expect: /不對應任何真實的輸入/ },
  { id: 'HC-00.5', name: '目標標準差 = 0', patch: { target: 0 }, expect: /不可能/ },
  { id: 'HC-00.6', name: 'x = 0', patch: { x: 0 }, expect: /不可辨識/ },
  { id: 'HC-00.6', name: 'μ = 0', patch: { mu: 0 }, expect: /不更新/ },
  { id: 'HC-00.6', name: 'μ < 0（極性相反）', patch: { mu: -0.1 }, expect: /極性相反/ },
  { id: 'HC-00.6', name: 'μ = 2/x²（邊界）', patch: { mu: 0.5 }, expect: /沒有落在穩定區/ },
  { id: 'HC-00.6', name: 'μ > 2/x²（發散）', patch: { mu: 0.65 }, expect: /沒有落在穩定區/ },
  { id: 'HC-00.6', name: 'μx² 剛好是 2（非 2 的冪次的小數）', patch: { mu: 1.28, x: 1.25 }, expect: /沒有落在穩定區/ },
  { id: 'HC-00.7', name: 'e = 0（sign(0) 慣例，勘誤 E40）', patch: { y: 1 }, expect: /E40/ },
  { id: 'HC-00.7', name: 'e = 0，但 double 算成 5.6e-17（正負號只是捨入誤差）', patch: { w: 0.64, x: 0.7, y: 0.448 }, expect: /E40/ },
  { id: 'HC-00.8', name: 'μ = 0', patch: { mu: 0 }, expect: /不會收斂/ },
  { id: 'HC-00.8', name: 'μ < 0', patch: { mu: -0.02 }, expect: /不會收斂/ },
  { id: 'HC-00.8', name: 'μ = 2（|p| = 1）', patch: { mu: 2 }, expect: /不會收斂/ },
  { id: 'HC-00.8', name: 'n 遠小於相關長度', patch: { n: 100 }, expect: /高度相關/ },
]

describe('ch00 手算題：結構', () => {
  it('5–8 題、ID 連號 HC-00.n、page 與難度標示正確，每個輸入都有手算友善的 practice 範圍', () => {
    expect(HANDCALCS.length).toBeGreaterThanOrEqual(5)
    expect(HANDCALCS.length).toBeLessThanOrEqual(8)
    expect(HANDCALCS.map((h) => h.id)).toEqual(HANDCALCS.map((_, i) => `HC-00.${i + 1}`))
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/00')
      expect(['beginner', 'engineer', 'research']).toContain(h.level)
      if (h.formulaId) expect(formulaIds.has(h.formulaId), h.id).toBe(true)
      for (const i of h.inputs) {
        expect(i.practice, `${h.id}.${i.key}`).toBeTruthy()
        expect(inputError(i, i.default), `${h.id}.${i.key} default`).toBeNull()
        // 輸入的白話說明不放 `$`（它也會被當成 aria-label）
        expect(i.label, `${h.id}.${i.key}`).not.toContain('$')
      }
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      for (const t of [h.title, ...(h.tips ?? [])]) expect(unpaired(t), `${h.id}: ${t}`).toBe(false)
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(2)
    }
    // 難度誠實標示：只有四則運算的題目是 beginner；用到 √ 或 ln 的是 engineer
    expect(Object.fromEntries(HANDCALCS.map((h) => [h.id, h.level]))).toEqual({
      'HC-00.1': 'beginner',
      'HC-00.2': 'beginner',
      'HC-00.3': 'beginner',
      'HC-00.4': 'beginner',
      'HC-00.5': 'engineer',
      'HC-00.6': 'engineer',
      'HC-00.7': 'beginner',
      'HC-00.8': 'engineer',
    })
    for (const h of HANDCALCS) {
      const usesCalculator = h.solve(defaultValues(h)).steps.some((s) => /\\sqrt|\\ln/.test(s.tex))
      expect(usesCalculator, h.id).toBe(h.level !== 'beginner')
    }
  })

  it('本章每一條重要公式都有一題：F-00.2／.3／.5／.8／.9／.10／.11（F-00.4、.6、.7 併在 HC-00.2、HC-00.5 的通式裡）', () => {
    const used = new Set(HANDCALCS.map((h) => h.formulaId))
    for (const id of ['F-00.2', 'F-00.3', 'F-00.5', 'F-00.8', 'F-00.9', 'F-00.10', 'F-00.11']) expect(used.has(id), id).toBe(true)
    expect(hc('HC-00.2').formulaTex).toContain(String.raw`\delta_n = p^{\,n}\,\delta_0`) // F-00.4 / F-00.6
    expect(hc('HC-00.5').formulaTex).toContain(String.raw`E[e\,x]=(a-w)\,E[x^2]`) // F-00.7
  })
})

describe('ch00 手算題：預設值 = 本章 worked example，答案 = 實際模擬函式', () => {
  it('T01: HC-00.1 的預設值就是 golden T01；w1 = 1.8、w2 = 2.28，並與 §0.4 手算表（handCalcRows → conventionalStep）逐位元相同', () => {
    const T01 = vector('T01')
    const inp = T01.inputs as { a: number; w0: number; x: number; mu: number }
    const exp = T01.expected as { w1: number; w2: number }
    const def = hc('HC-00.1')
    expect(defaultValues(def)).toEqual({ w0: inp.w0, x: inp.x, y: inp.a * inp.x, mu: inp.mu })
    expect(defaultValues(def)).toEqual({ w0: HAND_CALC_PARAMS.w0, x: HAND_CALC_PARAMS.x, y: HAND_CALC_PARAMS.a * HAND_CALC_PARAMS.x, mu: HAND_CALC_PARAMS.mu })
    const [w1, w2] = values(def, defaultValues(def))
    close(w1, exp.w1, 0, T01.tolerance.abs)
    close(w2, exp.w2, 0, T01.tolerance.abs)
    const rows = handCalcRows(HAND_CALC_PARAMS)
    expect(w1).toBe(rows[0].wNext)
    expect(w2).toBe(rows[1].wNext)
    // 文中的數字
    expect(Number(w1.toPrecision(12))).toBe(1.8)
    expect(Number(w2.toPrecision(12))).toBe(2.28)
  })

  it('T02: HC-00.2 在 x = 2 時 μ_max = 0.5；golden T02 的每個 μ 都得到相同的 pole 與收斂判定', () => {
    const T02 = vector('T02')
    const inp = T02.inputs as { x: number; mu_list: number[] }
    const exp = T02.expected as { mu_max: number; mu_one_step: number; pole_list: number[]; converges_list: number[] }
    const def = hc('HC-00.2')
    inp.mu_list.forEach((mu, i) => {
      const v = { x: inp.x, mu, d0: 2, n: 3 }
      expect(def.validate?.(v) ?? null).toBeNull()
      def.inputs.forEach((input) => expect(inputError(input, v[input.key as keyof typeof v]), `${input.key}=${v[input.key as keyof typeof v]}`).toBeNull())
      const [muMax, p, dn] = values(def, v)
      close(muMax, exp.mu_max, 0, T02.tolerance.abs)
      close(p, exp.pole_list[i], 0, T02.tolerance.abs)
      expect(Math.abs(p) < 1 - 1e-12 ? 1 : 0, `μ = ${mu}`).toBe(exp.converges_list[i])
      // δ₃ 來自真的把 LMS 跑 3 步；與等比數列 p³δ₀ 相同
      close(dn, 2 * exp.pole_list[i] ** 3, 1e-9)
    })
    // 一步到位：μ = 1/x² ⇒ p = 0、δ₁ = 0
    expect(values(def, { x: inp.x, mu: exp.mu_one_step, d0: 2, n: 1 }).slice(1)).toEqual([0, 0])
  })

  it('HC-00.2 的預設值是 §0.4 手算表（x = 2、μ = 0.1、δ₀ = a − w₀ = 2）：p = 0.6、δ₃ = 0.432 = 表中第 3 步的 δ', () => {
    const def = hc('HC-00.2')
    const P = HAND_CALC_PARAMS
    expect(defaultValues(def)).toEqual({ x: P.x, mu: P.mu, d0: P.a - P.w0, n: 3 })
    const [muMax, p, d3] = values(def, defaultValues(def))
    expect(muMax).toBe(0.5)
    expect(p).toBe(fixedXPole(P.mu, P.x))
    close(p, 0.6)
    close(d3, 0.432)
    close(d3, handCalcRows(P)[2].deltaNext) // 表中 δ₃ = a − w₃（全站極性 δ = a − w，勘誤 E39）
    close(d3, P.a - closedFormW(P.a, P.w0, P.x, P.mu, 3)) // 封閉解 F-00.6
  })

  it('HC-00.3 的預設值是 §0.1 的含雜訊資料；答案 = leastSquaresGain(NOISY_DATA) = 64.6/21', () => {
    const def = hc('HC-00.3')
    const d = defaultValues(def)
    expect([
      [d.x1, d.y1],
      [d.x2, d.y2],
      [d.x3, d.y3],
    ]).toEqual(NOISY_DATA.map(([x, y]) => [x, y]))
    const ls = leastSquaresGain(NOISY_DATA)
    expect(values(def, d)).toEqual([ls.sxy, ls.sxx, ls.w])
    close(ls.sxy, 64.6)
    expect(ls.sxx).toBe(21)
    close(ls.w, 64.6 / 21)
    // 提示裡寫的數字與計算結果一致
    expect(def.tips!.join('')).toContain(String(Number(ls.w.toPrecision(5))))
    // 乾淨資料 y = 3x：答案剛好是 3
    expect(values(def, { x1: 1, y1: 3, x2: 2, y2: 6, x3: 4, y3: 12 })[2]).toBe(3)
  })

  it('HC-00.4 的預設值是 §0.6 的數字驗算（w₀ = 1、x = 2、y = 6、μ = 0.1）：dj/dw = −8、中央差分 = −8、下坡一步 = 1.8（= T01 的 w₁）', () => {
    const def = hc('HC-00.4')
    const d = defaultValues(def)
    expect({ w: d.w, x: d.x, y: d.y, mu: d.mu }).toEqual(GRADIENT_EXAMPLE)
    expect(GRADIENT_EXAMPLE).toEqual({ w: HAND_CALC_PARAMS.w0, x: HAND_CALC_PARAMS.x, y: HAND_CALC_PARAMS.a * HAND_CALC_PARAMS.x, mu: HAND_CALC_PARAMS.mu })
    const [g, fd, wNew] = values(def, d)
    expect(g).toBe(analyticGradient(d.w, d.x, d.y))
    expect(fd).toBe(centralDifference(d.w, d.x, d.y, d.h))
    expect(wNew).toBe(conventionalStep({ w: d.w, x: d.x, y: d.y, mu: d.mu }).w)
    expect(g).toBe(-8)
    expect(fd).toBe(-8)
    close(wNew, 1.8)
    close(wNew, d.w - d.mu * g) // gradient descent 一步 = LMS 一步
    // 二次函數：換任何 h，中央差分都相同（沒有截斷誤差）
    for (const h of [1e-3, 0.1, 1, -0.25]) close(values(def, { ...d, h })[1], -8, 1e-9)
  })

  it('HC-00.5 的預設值是 §0.7 Monte Carlo 實驗的預設：s₁ = √3、N = 1024 的 std = √3/32（= simulateNoiseAverage 的理論值）、N_min = 1200', () => {
    const def = hc('HC-00.5')
    const d = defaultValues(def)
    const L = NOISE_LAB_DEFAULTS
    const mom = regressorMoments(L.xKind)
    expect(d).toEqual({ a: L.a, w: L.w, sv: L.sigmaV, ex2: mom.ex2, ex4: mom.ex4, N: L.nMax, target: QUIZ3.target })
    const [mean, s1, stdN, nMin] = values(def, d)
    const pm = productMoments(L.a, L.w, L.sigmaV, L.xKind)
    expect(mean).toBe(pm.mean)
    expect(s1).toBe(Math.sqrt(pm.variance))
    close(s1, Math.sqrt(3))
    const sim = simulateNoiseAverage({ ...L, trials: 20, seed: 1 })
    expect(sim.checkpoints[sim.checkpoints.length - 1]).toBe(1024)
    expect(s1).toBe(sim.s1)
    expect(stdN).toBe(sim.theoryStd[sim.theoryStd.length - 1])
    close(stdN, Math.sqrt(3) / 32)
    expect(nMin).toBe(1200)
    // 提示裡寫的對照數字（實驗指標表顯示 6 位有效數字）
    const tips = def.tips!.join('')
    expect(tips).toContain(String(Number(s1.toPrecision(6))))
    expect(tips).toContain(String(Number(stdN.toPrecision(6))))
  })

  it('HC-00.5：±1 碼時 s₁ = σ_v（= productMoments 的 pm_one）；思考題 3（s₁ = 2、目標 0.05）⇒ N_min = 1600', () => {
    const def = hc('HC-00.5')
    const d = defaultValues(def)
    const pmOne = regressorMoments('pm_one')
    const [, s1] = values(def, { ...d, ex2: pmOne.ex2, ex4: pmOne.ex4 })
    expect(s1).toBe(Math.sqrt(productMoments(d.a, d.w, d.sv, 'pm_one').variance))
    expect(s1).toBe(d.sv)
    const quiz = values(def, { ...d, a: 2, w: 2, sv: QUIZ3.s1, target: QUIZ3.target })
    expect(quiz[0]).toBe(0)
    expect(quiz[1]).toBe(QUIZ3.s1)
    expect(quiz[3]).toBe(1600)
    expect(def.tips!.join('')).toContain('1600')
    // 目標減半 ⇒ 筆數 4 倍
    expect(values(def, { ...d, target: d.target / 2 })[3]).toBe(4 * 1200)
    // s₁ = 0（±1 碼、沒有雜訊）：一筆就夠，不是 0 筆
    expect(values(def, { ...d, sv: 0, ex4: 1 }).slice(1)).toEqual([0, 0, 1])
  })

  it('HC-00.6 的預設值是 §0.7 的數值例（x = 2、σ_v = 0.5、μ = 0.05）：std = 0.08333；三個 μ 都與 steadyStateVarW 及提示中的數字一致', () => {
    const def = hc('HC-00.6')
    const S = STEADY_STATE_EXAMPLE
    expect(defaultValues(def)).toEqual({ mu: S.mus[1], x: S.x, sv: S.sigmaV })
    const tips = def.tips!.join('')
    for (const mu of S.mus) {
      const [v, sd, nEq] = values(def, { mu, x: S.x, sv: S.sigmaV })
      expect(v).toBe(steadyStateVarW(mu, S.x, S.sigmaV))
      expect(sd).toBe(Math.sqrt(steadyStateVarW(mu, S.x, S.sigmaV)))
      expect(nEq).toBe(equivalentAveragingLength(mu, S.x))
      // 直接平均 N_eq 筆 y/x 的標準差 σ_v/(|x|√N_eq) 與 LMS 的穩態 std 相同
      close(S.sigmaV / (Math.abs(S.x) * Math.sqrt(nEq)), sd)
      expect(tips).toContain(String(Number(sd.toPrecision(6))))
    }
    const [v, sd, nEq] = values(def, defaultValues(def))
    close(v, 0.0125 / 1.8)
    close(sd, 1 / 12)
    close(nEq, 9)
  })

  it('HC-00.7 的預設值是 §0.9 的「同一步、兩種更新」：LMS → 1.4、Sign-Error → 1.2（= conventionalStep／signErrorStep）', () => {
    const def = hc('HC-00.7')
    expect(defaultValues(def)).toEqual(SIGN_ONE_STEP)
    const [wLms, wSign] = values(def, defaultValues(def))
    expect(wLms).toBe(conventionalStep(SIGN_ONE_STEP).w)
    expect(wSign).toBe(signErrorStep(SIGN_ONE_STEP).w)
    close(wLms, 1.4)
    close(wSign, 1.2)
    // |e| < 1 時反而是 Sign-Error 走得遠；e < 0 時兩者都往下
    const small = values(def, { ...SIGN_ONE_STEP, y: 1.5 })
    expect(small[1] - 1).toBeGreaterThan(small[0] - 1)
    const neg = values(def, { ...SIGN_ONE_STEP, y: -2 })
    expect(neg[0]).toBeLessThan(1)
    close(neg[1], 0.8)
  })

  it('HC-00.8 的預設值是 §0.10 反例表 κ = 0.2 那一列：w* = 3.2、std(w̄) = correlatedNoiseBias 的 se、n₁% = 228', () => {
    const def = hc('HC-00.8')
    const d = defaultValues(def)
    expect(BIAS_KAPPA_LIST).toContain(d.kappa)
    const r = correlatedNoiseBias({ ...BIAS_DEMO, kappa: d.kappa })
    expect(d).toEqual({ a: BIAS_DEMO.a, kappa: 0.2, mu: BIAS_DEMO.mu, sv: BIAS_DEMO.sigmaV, n: r.used })
    const [wStar, p, n1, sdW, se] = values(def, d)
    expect(wStar).toBe(r.wStar)
    close(wStar, 3.2)
    expect(p).toBe(fixedXPole(BIAS_DEMO.mu, 1))
    close(p, 0.98)
    expect(n1).toBe(stepsToFraction(p))
    expect(n1).toBe(228)
    expect(sdW).toBe(Math.sqrt(steadyStateVarW(BIAS_DEMO.mu, 1, BIAS_DEMO.sigmaV)))
    close(sdW, Math.sqrt(0.005 / 1.98))
    expect(se).toBe(r.se)
    // 模擬的時間平均確實落在 w* 的 4 個 std(w̄) 內，而且離真正的 a 很遠（bias 不是 variance）
    expect(Math.abs(r.wMean - wStar)).toBeLessThan(4 * se)
    expect(Math.abs(r.wMean - d.a)).toBeGreaterThan(30 * se)
    // 提示與內文表格的數字：容忍度 4σ/√n ≈ 0.02、std(w̄) ≈ 0.005
    expect(Number((4 * se).toPrecision(2))).toBe(0.02)
    expect(Number(se.toPrecision(2))).toBe(0.005)
    // μ = 1（p = 0）：一步到位，不取 ln 0
    const dead = def.solve({ ...d, mu: 1 })
    expect(dead.results[2].value).toBe(1)
    expect(dead.steps.some((s) => /\\ln/.test(s.tex) || badNumber(s.tex))).toBe(false)
  })

  it('HC-00.8 的適用範圍判準：近似 Var(w̄) ≈ V(1+p)/((1−p)n) 的相對誤差公式與暴力雙重求和一致；預設值的誤差 < 1%', () => {
    for (const [p, n] of [
      [0.98, 400],
      [0.5, 10],
      [-0.9, 7],
      [-0.5, 3],
      [0, 5],
    ]) {
      let s = 0
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += Math.pow(p, Math.abs(i - j))
      const exact = s / (n * n) // Var(w̄)/V
      const approx = (1 + p) / ((1 - p) * n)
      close(timeAverageVarianceError(p, n), (approx - exact) / approx, 1e-9, 1e-12, `p=${p}, n=${n}`)
    }
    const d = defaultValues(hc('HC-00.8'))
    expect(Math.abs(timeAverageVarianceError(1 - d.mu, d.n))).toBeLessThan(0.01)
    expect(Number.isNaN(timeAverageVarianceError(1, 10))).toBe(true)
  })
})

describe('ch00 手算題：隨機 20 題與獨立重算一致', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：randomValues(seed 1…20) 都通過 validate、答案有限，且等於測試裡直接重寫的公式', (_id, def) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, JSON.stringify(v)).toBeNull()
      def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${i.key}=${v[i.key]}`).toBeNull())
      const sol = def.solve(v)
      const expected = INDEPENDENT[def.id](v)
      expect(sol.results).toHaveLength(expected.length)
      sol.results.forEach((r, k) => {
        expect(Number.isFinite(r.value), `${r.symbol} @ ${JSON.stringify(v)}`).toBe(true)
        close(r.value, expected[k], 1e-9, 1e-12, `${def.id} ${r.symbol} @ ${JSON.stringify(v)}`)
      })
      // 每一步都是「符號式 = 代入數字 = 結果」，而且有一句說明；字串中的 $ 成對；不會把 NaN／∞ 印進公式
      expect(sol.steps.length).toBeGreaterThan(0)
      for (const s of sol.steps) {
        expect((s.tex.match(/=/g) ?? []).length, s.tex).toBeGreaterThanOrEqual(2)
        expect(badNumber(s.tex), s.tex).toBe(false)
        expect(s.why.length).toBeGreaterThan(0)
        expect(unpaired(s.why), s.why).toBe(false)
      }
      for (const note of sol.notes ?? []) {
        expect(unpaired(note), note).toBe(false)
        expect(note).not.toMatch(/NaN|undefined/)
      }
    }
    // 「換一題」真的會換數字（不是每次都因 validate 不過而退回預設值）
    expect(seen.size, def.id).toBeGreaterThanOrEqual(10)
  })
})

// ───────────────────────── 畫面上的算式：把每一步的 TeX 重新求值 ─────────────────────────

function matchBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  throw new Error(`大括號不成對：${s}`)
}

/**
 * 把一段「只含數字」的 TeX（+ − × ^ \frac \sqrt \ln sign 括號、a\times10^{b}）求值；含符號（字母）的片段回傳 null。
 * 用遞迴下降自己剖析（不用 eval），所以 -10^{-6}、(-0.3)^{3}、(5\times10^{-5})^2 的優先順序和數學上相同。
 */
function evalTex(seg: string): number | null {
  let s = seg
    .replace(/\\(?:left|right|big|Big)/g, '')
    .replace(/\\[,;!]|\\q?quad/g, ' ')
    .replace(/\\times/g, '*')
    .replace(/\\mathrm\{sign\}/g, 'G')
    .replace(/\\sqrt\s*\{/g, 'S{')
    .replace(/\\ln\s*/g, 'L')
  for (let i = s.indexOf('\\frac'); i >= 0; i = s.indexOf('\\frac')) {
    const a0 = s.indexOf('{', i)
    const a1 = matchBrace(s, a0)
    const b1 = matchBrace(s, a1 + 1)
    s = `${s.slice(0, i)}((${s.slice(a0 + 1, a1)})/(${s.slice(a1 + 2, b1)}))${s.slice(b1 + 1)}`
  }
  s = s.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\s+/g, '')
  if (!/^[0-9.+\-*/^()GSL]+$/.test(s) || !/[0-9]/.test(s)) return null
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
    if (s[pos] === '+') return pos++, unary()
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
    if (c === 'S' || c === 'L' || c === 'G') {
      pos++
      const v = atom()
      return c === 'S' ? Math.sqrt(v) : c === 'L' ? Math.log(v) : Math.sign(v)
    }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(pos))
    if (!m) throw new Error(`無法剖析：${seg}（位置 ${pos}）`)
    pos += m[0].length
    return Number(m[0])
  }
  const v = expr()
  if (pos !== s.length) throw new Error(`無法剖析：${seg}（剩下 ${s.slice(pos)}）`)
  return v
}

/** 在最外層（不在大括號裡）的 = 或 \approx 處切開。 */
function splitChain(tex: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  const t = tex.replace(/\\approx/g, '=')
  for (const ch of t) {
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

const CEIL_RE = /^\\left\\lceil(.*)\\right\\rceil$/

/**
 * 一步的 TeX「a = b = c」：每一段數字算出來都要等於最後一段（容許顯示時四捨五入到 5 位的誤差）。
 * 回傳每個子鏈（以 ⇒ 分開）最後的數字。⌈r⌉ 的段落檢查「n 是 r 的上整」。
 */
function checkStepTex(tex: string, label: string): number[] {
  const finals: number[] = []
  for (const part of tex.split(/\\;\\Rightarrow\\;|\\Rightarrow/)) {
    const segs = splitChain(part)
    const nums = segs
      .map((seg) => {
        const c = CEIL_RE.exec(seg)
        return { seg, ceil: !!c, v: evalTex(c ? c[1] : seg) }
      })
      .filter((x): x is { seg: string; ceil: boolean; v: number } => x.v !== null)
    if (!nums.length) continue
    const last = nums[nums.length - 1].v
    finals.push(last)
    for (const { seg, ceil, v } of nums.slice(0, -1)) {
      const where = `${label}：「${seg}」= ${v}，但這一步的結果是 ${last}（${tex}）`
      if (ceil) {
        // last = ⌈v⌉（至少 1）：v 是四捨五入後的顯示值，容許整數邊界上 3e-5 的相對誤差
        expect(v, where).toBeLessThanOrEqual(last * (1 + 3e-5))
        if (last > 1) expect(v, where).toBeGreaterThan((last - 1) * (1 - 3e-5))
      } else expect(Math.abs(v - last), where).toBeLessThanOrEqual(1e-12 + 2.5e-4 * Math.max(Math.abs(v), Math.abs(last)))
    }
  }
  return finals
}

/**
 * 使用者自己打的數字（不在「換一題」的範圍內）：剛好抵銷成 0、非 2 的冪次的小數、很長的小數、很小／很大的數。
 * 這些在舊版會出現 1e-17 的浮點殘渣、sign(殘渣)、NaN、「6 − 6 = 4×10⁻⁵」或 KaTeX 的 double superscript。
 */
const USER_CASES: Record<string, Record<string, number>[]> = {
  'HC-00.1': [
    { w0: 0.35, x: 0.35, y: 0.1225, mu: 0.12 }, // e₀ 剛好是 0
    { w0: 0.2, x: 3, y: 0.6, mu: 0.1 }, // 0.2×3 在 double 裡是 0.6000000000000001
    { w0: 1, x: 2.5, y: 7, mu: 0.16 }, // μx² = 1：一步到位，e₁ = 0
    { w0: 0.24, x: -0.045275, y: 4.7871, mu: 0.553 }, // 長小數：w₁ + Δw₁ 幾乎抵銷
    { w0: 1.23456, x: 2.34567, y: 2.89588, mu: 0.3 },
    { w0: -20, x: -10, y: 100, mu: 5 },
    { w0: 0, x: 0, y: 5, mu: 0.1 },
  ],
  'HC-00.2': [
    { x: 2.5, mu: 0.16, d0: 3, n: 4 }, // p 剛好是 0
    { x: -0.4, mu: 6.249375, d0: 0.45, n: 5 }, // p = 10⁻⁴：次方的底數是科學記號
    { x: 0.00005, mu: 1, d0: 1, n: 2 }, // x² 的底數是科學記號
    { x: 0.26133, mu: -0.55, d0: -0.07791, n: 20 }, // 連乘 20 次：底數要多留幾位
    { x: 2, mu: 0.2, d0: 2, n: 50 }, // δ₅₀ ≈ 2e-35（不是殘渣）
    { x: 10, mu: 10, d0: 100, n: 50 },
    { x: 2, mu: 0.5, d0: 2, n: 3 }, // 邊界 p = −1
  ],
  'HC-00.3': [
    { x1: 1.5, y1: 4.7, x2: 0.64, y2: -11.015625, x3: 0, y3: 0 }, // 分子剛好抵銷成 0
    { x1: 0.1, y1: 3, x2: 0.3, y2: -1, x3: 2, y3: 0 }, // 0.1×3 − 0.3 在 double 裡是 5.6e-17
    { x1: -3.21, y1: 41.714, x2: 3.2, y2: 0.06057, x3: 0.268, y3: -0.10067 },
    { x1: 0.00005, y1: 2, x2: 0.00002, y2: -3, x3: 0, y3: 1 },
    { x1: -100, y1: 1000, x2: 100, y2: -1000, x3: 0.5, y3: 0.25 },
  ],
  'HC-00.4': [
    { w: 2, x: -3, y: 9, h: 0.1, mu: 0.1 }, // 117.045 − 108.045：5 位有效數字會算成 9.01
    { w: 1, x: 2, y: 6, h: 0.000001, mu: 0.1 }, // 很小的 h：j(w±h) 要顯示到看得出差別
    { w: 4.7, x: 1.5, y: 7.05, h: 0.001, mu: 0.16 }, // e 剛好是 0（double：8.9e-16）
    { w: 1, x: 3, y: 3.3, h: 0.1, mu: 0.1 }, // e₊ 剛好是 0
    { w: 0.37, x: 1.7, y: -2.3, h: 0.001, mu: 0.013 },
    { w: 1, x: 0, y: 6, h: 0.5, mu: 0.1 },
    { w: -4.7, x: 0.1, y: -0.470001, h: 0.00001, mu: 0.07 }, // e = −10⁻⁶：平方的底數是科學記號
  ],
  'HC-00.5': [
    { a: 0.8, w: 0.3, sv: 0, ex2: 0.2025, ex4: 0.04100625, N: 7, target: 0.1 }, // ±0.45 碼、無雜訊：舊版是 √(−1.7e-18) = NaN
    { a: 3, w: 2, sv: 1, ex2: 0.2025, ex4: 0.04100625, N: 100, target: 0.1 }, // ±0.45 碼、有雜訊：舊版顯示 E[x⁴] − E[x²]² = −6.9×10⁻¹⁸
    { a: -0.6, w: 4.7, sv: 0, ex2: 0.1, ex4: 0.018, N: 1000000, target: 0.00005 }, // 目標是科學記號；N_min 上億
    { a: 3, w: 2, sv: 1, ex2: 1, ex4: 3.0000001, N: 1024, target: 0.05 }, // ⌈1200.00004⌉ = 1201
    { a: -0.60646, w: 0.07299, sv: 0.4, ex2: 0.6, ex4: 979.1, N: 15800, target: 0.011 }, // 商很大：s₁² 要多留幾位
    { a: 3, w: 2, sv: 7.8125, ex2: 1, ex4: 1, N: 100, target: 0.00005 }, // N_min = 24 414 062 500
    { a: 2, w: 2, sv: 2, ex2: 1, ex4: 3, N: 1600, target: 0.05 },
  ],
  'HC-00.6': [
    { mu: 0.16, x: 2.5, sv: 0.5 }, // p 剛好是 0
    { mu: 0.4, x: 2, sv: 0.5 }, // p < 0
    { mu: 2.5, x: 0.3, sv: 0.00003 }, // σ_v 是科學記號
    { mu: 0.037, x: -1.3, sv: 0.77 },
    { mu: 1.9999999, x: 1, sv: 1 }, // 很靠近邊界
    { mu: 0.0001, x: 1, sv: 1000 },
  ],
  'HC-00.7': [
    { w: 0.64, x: 0.7, y: 0.448001, mu: 0.35 }, // e = 10⁻⁶（很小，但不是 0）
    { w: 0.3, x: 1, y: -2.7, mu: 0.1 }, // LMS：0.3 + (−0.3) 剛好是 0
    { w: 0.1, x: 1, y: 3, mu: 0.1 }, // Sign-Error：w + μ 是 0.2（double：0.2）
    { w: -0.1, x: 1, y: 5, mu: 0.1 }, // Sign-Error：−0.1 + 0.1 剛好是 0
    { w: -0.11, x: 0.48, y: 30.86, mu: 0.418 },
    { w: 1, x: -2, y: 3, mu: 0 },
  ],
  'HC-00.8': [
    { a: 3, kappa: 0.2, mu: 1, sv: 0.5, n: 10001 }, // p = 0
    { a: 0.3, kappa: -0.3, mu: 0.02, sv: 0.5, n: 10001 }, // w* 剛好是 0
    { a: -6.25, kappa: -0.1, mu: 0.5, sv: 0.00002, n: 123457 }, // σ 是科學記號
    { a: 3, kappa: 0.2, mu: 0.0001, sv: 0.5, n: 1000000000 }, // n₁% ≈ 46 050：ln 要多留幾位
    { a: 3, kappa: 0.2, mu: 1.5, sv: 0.5, n: 400 }, // p < 0
    { a: -2, kappa: -3.7, mu: 0.137, sv: 2.2, n: 777 },
  ],
}

describe('ch00 手算題：畫面上的算式自己算得出來', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))(
    '%s：每一步「符號式 = 代入數字 = 結果」的數字重新求值後前後一致；每個答案都是某一步的結果（預設值、20 組隨機數字、使用者自己打的數字）',
    (_id, def) => {
      const cases = [defaultValues(def), ...Array.from({ length: 20 }, (_, k) => randomValues(def, k + 1)), ...USER_CASES[def.id]]
      for (const v of cases) {
        const label = `${def.id} ${JSON.stringify(v)}`
        def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${label} ${i.key}`).toBeNull())
        expect(def.validate?.(v) ?? null, label).toBeNull()
        const sol = def.solve(v)
        const finals = sol.steps.flatMap((s, k) => checkStepTex(s.tex, `${label} 第 ${k + 1} 步`))
        for (const r of sol.results) {
          expect(Number.isFinite(r.value), `${label} ${r.symbol}`).toBe(true)
          const hit = finals.some((f) => Math.abs(f - r.value) <= 1e-12 + 1e-4 * Math.max(Math.abs(f), Math.abs(r.value)))
          expect(hit, `${label}：答案 ${r.symbol} = ${r.value} 不是任何一步的結果（各步結果：${finals.join(', ')}）`).toBe(true)
        }
      }
    },
  )

  it('使用者自己打的數字：答案仍等於獨立重算；畫面上沒有 KaTeX 錯誤、沒有 NaN、沒有 1e-13 以下的浮點殘渣', () => {
    for (const def of HANDCALCS) {
      for (const v of USER_CASES[def.id]) {
        const label = `${def.id} ${JSON.stringify(v)}`
        const sol = def.solve(v)
        const expected = INDEPENDENT[def.id](v)
        // 獨立重算是 double：剛好抵銷的地方它會留下 1e-16 量級的殘渣，所以用「相對於輸入大小」的絕對容忍度
        const scale = Math.max(1, ...Object.values(v).map(Math.abs))
        sol.results.forEach((r, k) => close(r.value, expected[k], 1e-7, 1e-12 * scale ** 3, `${label} ${r.symbol}`))
        for (const s of sol.steps) expect(badNumber(s.tex), `${label}：${s.tex}`).toBe(false)
        const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
        expect(Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title')), label).toEqual([])
        expect(container.querySelector('.c-tex-error'), label).toBeNull()
        expect(container.querySelectorAll('.c-step').length, label).toBe(sol.steps.length)
        expect(proseText(container), label).not.toContain('$')
        unmount()
      }
    }
  }, 120_000)

  it('剛好抵銷的地方顯示 0，而不是 double 的殘渣；sign(e) 不會被殘渣決定', () => {
    // HC-00.1：0.1225 − 0.35×0.35（double：1.4e-17）
    const s1 = hc('HC-00.1').solve({ w0: 0.35, x: 0.35, y: 0.1225, mu: 0.12 })
    expect(s1.steps[1].tex).toBe(String.raw`e_0 = y - \hat y_0 = 0.1225 - 0.1225 = 0`)
    expect(s1.results.map((r) => r.value)).toEqual([0.35, 0.35])
    expect(s1.notes![0]).toContain('$e_0 = 0$')
    // 0.2×3 在 double 裡是 0.6000000000000001：預測已經正確，e₀ = 0、w 不動（答案是模擬的值，只差 1 ulp）
    const s1b = hc('HC-00.1').solve({ w0: 0.2, x: 3, y: 0.6, mu: 0.1 })
    expect(s1b.steps[1].tex).toBe(String.raw`e_0 = y - \hat y_0 = 0.6 - 0.6 = 0`)
    expect(s1b.steps[5].tex.endsWith('= 0.2')).toBe(true)
    s1b.results.forEach((r) => close(r.value, 0.2, 1e-15))
    // HC-00.2：μx² = 0.16×2.5² 剛好是 1 ⇒ p = 0（一步到位），不是 1e-16 的「單調收斂」
    const s2 = hc('HC-00.2').solve({ x: 2.5, mu: 0.16, d0: 3, n: 4 })
    expect(s2.results.slice(1).map((r) => r.value)).toEqual([0, 0])
    expect(s2.notes![0]).toContain('$p=0$')
    // HC-00.3：7.05 + (−7.05) + 0
    const s3 = hc('HC-00.3').solve(USER_CASES['HC-00.3'][0])
    expect(s3.steps[3].tex).toBe(String.raw`\sum_i x_iy_i = 7.05 + (-7.05) + 0 = 0`)
    expect([s3.results[0].value, s3.results[2].value]).toEqual([0, 0])
    // HC-00.4：e = 0 ⇒ 斜率 0、差分 0、w 不動（double 的 j(w+h) − j(w−h) 是 1.3e-18）
    const s4 = hc('HC-00.4').solve({ w: 4.7, x: 1.5, y: 7.05, h: 0.001, mu: 0.16 })
    expect(s4.results.map((r) => r.value)).toEqual([0, 0, 4.7])
    expect(s4.notes!.join('')).toContain('已經在谷底')
    // HC-00.7：LMS 走到剛好 0（0.3 − 0.3）
    const s7 = values(hc('HC-00.7'), { w: 0.3, x: 1, y: -2.7, mu: 0.1 })
    expect(s7[0]).toBe(0)
    close(s7[1], 0.2, 1e-15)
    // HC-00.8：w* = 0.3 + (−0.3) = 0；μ = 1 ⇒ p = 0
    expect(values(hc('HC-00.8'), USER_CASES['HC-00.8'][1])[0]).toBe(0)
  })

  it('HC-00.5：±A 碼（E[x⁴] = E[x²]²）不會因為 double 的 0.2025² ≠ 0.04100625 變成 NaN 或浮點殘渣；商很大時 N_min 每一位都對', () => {
    const def = hc('HC-00.5')
    // double：0.2025 × 0.2025 = 0.04100625000000001 > 0.04100625 ⇒ E[x⁴] − E[x²]² = −6.9e-18（數學上是 0）
    expect(0.2025 * 0.2025).toBeGreaterThan(0.04100625)
    for (const v of USER_CASES['HC-00.5'].slice(0, 2)) {
      expect(def.validate?.(v) ?? null).toBeNull()
      const sol = def.solve(v)
      sol.results.forEach((r) => expect(Number.isFinite(r.value), r.symbol).toBe(true))
      expect(sol.steps[2].tex.endsWith('= 0')).toBe(true) // E[x⁴] − E[x²]² = 0
      close(sol.results[1].value, v.sv * 0.45, 1e-12) // ±A 碼：δ 項消失，s₁² = σ_v²E[x²] ⇒ s₁ = σ_v·A（A = 0.45）
    }
    // 真的不可能的分布仍然擋下
    expect(def.validate?.({ ...defaultValues(def), ex2: 0.2025, ex4: 0.04100624 })).toMatch(/不對應任何真實的輸入/)
    // ⌈1200.00004⌉ = 1201：畫面上不可以寫成 ⌈1200⌉ = 1201
    const edge = def.solve(USER_CASES['HC-00.5'][3])
    expect(edge.results[3].value).toBe(1201)
    expect(edge.steps[10].tex).toContain(String.raw`\left\lceil 1200.00004\right\rceil = 1201`)
    // 商上百億：N_min = (7.8125/5e-5)² = 24 414 062 500（samplesForTargetStd 的保護量不可吃掉 24 筆）
    const big = def.solve(USER_CASES['HC-00.5'][5])
    expect(big.results[3].value).toBe(24414062500)
    expect(big.results[3].value).toBe(samplesForTargetStd(7.8125, 0.00005))
    expect(big.steps[10].tex).toContain(String.raw`\left\lceil 24414062500\right\rceil = 24414062500`)
  })

  it('HC-00.4：兩個很接近的 j 相減時多顯示幾位（117.045 − 108.045 = 9，不是 117.05 − 108.04）；很小的 h 也對得起來', () => {
    const def = hc('HC-00.4')
    const s = def.solve({ w: 2, x: -3, y: 9, h: 0.1, mu: 0.1 })
    expect(s.steps[7].tex).toBe(String.raw`j(w+h)-j(w-h) = 117.045 - 108.045 = 9`)
    expect(s.steps[8].tex).toBe(String.raw`D_h = \frac{j(w+h)-j(w-h)}{2h} = \frac{9}{2\times0.1} = \frac{9}{0.2} = 45`)
    const tiny = def.solve({ w: 1, x: 2, y: 6, h: 0.000001, mu: 0.1 })
    expect(tiny.steps[7].tex).toBe(String.raw`j(w+h)-j(w-h) = 7.999992 - 8.000008 = -1.6\times10^{-5}`)
    close(tiny.results[1].value, -8, 1e-9)
  })
})

describe('handcalcTex：精確十進位數 Dec 與顯示工具', () => {
  const D = Dec.of

  it('Dec.of 取的是「使用者打的那串數字」；加、減、乘、整數次方沒有捨入誤差', () => {
    expect(D(0.1).add(D(0.2)).toString()).toBe('0.3')
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(D(0.1225).sub(D(0.35).mul(D(0.35))).isZero).toBe(true)
    expect(0.1225 - 0.35 * 0.35).not.toBe(0)
    expect(D(0.6).pow(3).toString()).toBe('0.216')
    expect(D(-0.3).pow(3).toString()).toBe('-0.027')
    expect(D(1e-7).toString()).toBe('0.0000001')
    expect(D(-1.5e21).toString()).toBe('-1500000000000000000000')
    expect(D(0).isZero).toBe(true)
    expect(D(-0).toString()).toBe('0')
    expect(D(2.5).mul(D(4)).toString()).toBe('10')
    expect([D(3).sign, D(-0.001).sign, D(0).sign]).toEqual([1, -1, 0])
    expect(D(1.2345).mul(D(2.3456)).mul(D(3.4567)).toNumber()).toBeCloseTo(1.2345 * 2.3456 * 3.4567, 12)
    expect(() => D(Number.NaN)).toThrow()
    expect(() => D(Infinity)).toThrow()
  })

  it('digits／exponent／round', () => {
    expect([D(117.045).digits, D(1200).digits, D(0).digits, D(0.00056).digits]).toEqual([6, 2, 1, 2])
    expect([D(123.4).exponent, D(0.00056).exponent, D(1e6).exponent]).toEqual([2, -4, 6])
    expect(D(117.045).round(5).toString()).toBe('117.05')
    expect(D(123456789).round(3).toString()).toBe('123000000')
    expect(D(0.99996).round(4).toString()).toBe('1')
    expect(D(-2.5).round(1).toString()).toBe('-3')
    expect(D(1.8).round(5).toString()).toBe('1.8')
  })

  it('tx：輸入值與 10 位以內的數完整顯示，更長的四捨五入；double 四捨五入到 5 位；極大極小值用科學記號', () => {
    expect(tx(D(15.509967))).toBe('15.509967')
    expect(tx(D(0.1).mul(D(0.2)))).toBe('0.02')
    expect(tx(D(117.045))).toBe('117.045')
    expect(tx(D(0))).toBe('0')
    expect(tx(D(5e-5))).toBe(String.raw`5\times10^{-5}`)
    expect(tx(D(1e-6))).toBe('10^{-6}')
    expect(tx(D(-1e-6))).toBe('-10^{-6}')
    expect(tx(D(1234567))).toBe(String.raw`1.234567\times10^{6}`)
    expect(tx(D(0.0001))).toBe('0.0001')
    expect(tx(D(999999))).toBe('999999')
    // 使用者打了 12 位：照原樣顯示
    expect(tx(D(0.111111111111))).toBe('0.111111111111')
    // 算出來的 13 位小數：四捨五入到 5 位（需要時由 sig 指定更多位）
    const long = D(1.2345).mul(D(2.3456)).mul(D(3.4567)) // 10.00936984944
    expect(long.toString()).toBe('10.00936984944')
    expect(long.digits).toBe(13)
    expect(tx(long)).toBe('10.009')
    expect(tx(long, 9)).toBe('10.0093698')
    expect(tx(long, 8)).toBe('10.00937') // 10.009370：尾端的 0 不寫
    expect(tx(long, FULL)).toBe('10.00936984944')
    expect(tx(1 / 3)).toBe('0.33333')
    expect(tx(Math.sqrt(3), 99)).toBe('1.73205080756888') // double 最多 15 位
  })

  it('括號：負數當乘數／加數、負數與科學記號當底數', () => {
    expect(txP(D(-3))).toBe('(-3)')
    expect(txP(D(3))).toBe('3')
    expect(txP(D(5e-5))).toBe(String.raw`5\times10^{-5}`)
    expect(txBase(D(5e-5))).toBe(String.raw`(5\times10^{-5})`)
    expect(txSq(D(5e-5))).toBe(String.raw`(5\times10^{-5})^2`)
    expect(txSq(D(-3))).toBe('(-3)^2')
    expect(txSq(D(0.5))).toBe('0.5^2')
    expect(txPow(D(1e-5), 5)).toBe('(10^{-5})^{5}')
    expect(txPow(D(1e-4), 5)).toBe('0.0001^{5}')
    expect(txPow(D(-0.3), 3)).toBe('(-0.3)^{3}')
  })

  it('sigFor：相減的運算元要顯示到「結果還有 5 位」；剛好抵銷時完整顯示', () => {
    expect(sigFor(D(9), D(117.045), D(108.045))).toBe(7)
    expect(sigFor(D(4), D(6), D(2))).toBe(6)
    expect(sigFor(D(8), D(6), D(2))).toBe(5) // 沒有抵銷
    expect(sigFor(D(0), D(1525.87890625), D(1525.87890625))).toBe(FULL)
    expect(sigFor(D(0), D(0), D(0))).toBe(5)
    expect(sigFor(1e-12, 7, 7)).toBe(18)
  })

  it('txInt／txCeilArg：整數每一位都寫出；⌈r⌉ 的 r 顯示到看得出上整是多少', () => {
    expect(txInt(123457)).toBe('123457')
    expect(txInt(24414062500)).toBe('24414062500')
    expect(txCeilArg(227.946, 228)).toBe('227.95')
    expect(txCeilArg(1200.0000000000002, 1200)).toBe('1200')
    expect(txCeilArg(1200.00004, 1201)).toBe('1200.00004')
    expect(txCeilArg(0.3, 1)).toBe('0.3')
    expect(txCeilArg(24414062500.000004, 24414062500)).toBe('24414062500')
  })
})

describe('ch00 手算題：validate 擋下模型不適用的輸入並解釋原因', () => {
  it.each(INVALID.map((c) => [`${c.id} ${c.name}`, c] as const))('%s', (_name, c) => {
    const def = hc(c.id)
    const msg = def.validate?.({ ...defaultValues(def), ...c.patch })
    expect(msg, c.name).toBeTruthy()
    expect(msg!).toMatch(c.expect)
    expect(msg!.length).toBeGreaterThan(20) // 是解釋，不是只有「不合法」
    expect(unpaired(msg!), msg!).toBe(false)
  })

  it('不合法的輸入在畫面上顯示原因（KaTeX 排版、沒有殘留的 $），不顯示任何步驟或答案', () => {
    for (const c of INVALID) {
      const def = hc(c.id)
      const { container, unmount } = render(<HandCalc def={withValues(def, { ...defaultValues(def), ...c.patch })} />)
      const warn = container.querySelector('.callout-warn')
      expect(warn, `${c.id} ${c.name}`).toBeTruthy()
      expect(warn!.querySelector('.katex'), `${c.id} ${c.name}`).toBeTruthy()
      expect(proseText(warn!)).not.toContain('$')
      expect(container.querySelector('.katex-error'), `${c.id} ${c.name}`).toBeNull()
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      expect(container.querySelector('.c-handcalc-results')).toBeNull()
      unmount()
    }
  })

  it('輸入欄的合法範圍：負的雜訊標準差、非整數的筆數會被擋下', () => {
    const byKey = (id: string, key: string) => hc(id).inputs.find((i) => i.key === key)!
    expect(inputError(byKey('HC-00.6', 'sv'), -0.1)).toBeTruthy()
    expect(inputError(byKey('HC-00.5', 'N'), 10.5)).toBeTruthy()
    expect(inputError(byKey('HC-00.5', 'N'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-00.8', 'n'), 0.5)).toBeTruthy()
    expect(inputError(byKey('HC-00.2', 'n'), 0)).toBeTruthy()
    // HC-00.2 允許 μ < 0（極性錯誤也是值得算的情況）：p > 1
    expect(inputError(byKey('HC-00.2', 'mu'), -0.01)).toBeNull()
    expect(values(hc('HC-00.2'), { x: 2, mu: -0.01, d0: 2, n: 3 })[1]).toBeGreaterThan(1)
  })
})

describe('ch00 手算題：渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值與 6 組隨機數字都能渲染，沒有 .katex-error、沒有殘留的 $，步驟數與 solve() 相同', (_id, def) => {
    const cases = [defaultValues(def), ...[1, 2, 3, 4, 5, 6].map((seed) => randomValues(def, seed))]
    for (const v of cases) {
      const sol = def.solve(v)
      const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
      expect(container.querySelector('.katex-error'), JSON.stringify(v)).toBeNull()
      expect(container.querySelector('.c-tex-error')).toBeNull()
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(sol.steps.length).toBeGreaterThanOrEqual(1)
      expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
      expect(proseText(container), JSON.stringify(v)).not.toContain('$')
      unmount()
    }
  })

  it('自己算算看：把 solve() 的答案四捨五入到 4 位有效數字填回去，每一格都判定正確；差 5% 則判定錯誤', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} initialMode="practice" />)
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      const view = within(container)
      const inputs = view.getAllByPlaceholderText('你的答案') as HTMLInputElement[]
      expect(inputs).toHaveLength(sol.results.length)
      const integerAnswer = (v: number) => Number.isInteger(v) && Math.abs(v) >= 100
      inputs.forEach((el, k) => {
        const v = sol.results[k].value
        fireEvent.change(el, { target: { value: integerAnswer(v) ? String(v) : String(Number(v.toPrecision(4))) } })
      })
      fireEvent.click(view.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.ok').length, def.id).toBe(sol.results.length)
      // 第一格故意差 5%（答案為 0 時改填 0.5）
      const first = sol.results[0].value
      fireEvent.change(inputs[0], { target: { value: String(first === 0 ? 0.5 : first * 1.05) } })
      fireEvent.click(view.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.bad').length, def.id).toBe(1)
      unmount()
    }
  })

  it('T01: HC-00.1 維持共用元件測試（HandCalc.test.tsx）依賴的介面：答案順序 w1、w2；「學習率」只有一欄；改成 0.2 ⇒ w1 = 2.6', () => {
    const def = hc('HC-00.1')
    const sol = def.solve({ w0: 1, x: 2, y: 6, mu: 0.1 })
    expect(sol.results.map((r) => r.symbol)).toEqual(['w_1', 'w_2'])
    expect(sol.results[0].value).toBeCloseTo(1.8, 12)
    expect(sol.results[1].value).toBeCloseTo(2.28, 12)
    const { container } = render(<HandCalc def={def} />)
    expect(container.textContent).toContain('2.28')
    const mu = within(container).getByLabelText(/學習率/) as HTMLInputElement
    fireEvent.change(mu, { target: { value: '0.2' } })
    expect(container.textContent).toContain('2.6') // w1 = 1 + 0.2·4·2
    fireEvent.change(mu, { target: { value: 'abc' } })
    expect(container.textContent).toContain('請輸入數字')
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
  })

  it('改輸入會即時重新帶入：HC-00.6 把 μ 改成 0.2 ⇒ std = 0.2041；改成 0.5（邊界）⇒ 顯示原因', () => {
    const def = hc('HC-00.6')
    const { container } = render(<HandCalc def={def} />)
    const mu = within(container).getByLabelText(/學習率/) as HTMLInputElement
    fireEvent.change(mu, { target: { value: '0.2' } })
    expect(container.textContent).toContain(String(Number(Math.sqrt(steadyStateVarW(0.2, 2, 0.5)).toPrecision(5))))
    fireEvent.change(mu, { target: { value: '0.5' } })
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('沒有落在穩定區')
  })
})

describe('ch00 手算題：章內位置', () => {
  it('每一題都放在對應推導／例題的段落裡（beginner 模式也看得到），綜合題 HC-00.8 緊接在思考題之前', async () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/00']}>
          <Chapter00 />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const where: Record<string, string> = {
      'HC-00.3': 'ch00-blackbox', // §0.1 最小平方
      'HC-00.1': 'ch00-hand', // §0.4 手算表
      'HC-00.4': 'ch00-why-ex', // §0.6 梯度
      'HC-00.2': 'ch00-why-ex', // §0.6 pole 與穩定條件
      'HC-00.5': 'ch00-noise', // §0.7 1/√N
      'HC-00.6': 'ch00-noise', // §0.7 穩態變異數
      'HC-00.7': 'ch00-sign', // §0.9 Sign-Error
      'HC-00.8': 'ch00-assumptions', // §0.10 反例（綜合題）
    }
    expect(Object.keys(where).sort()).toEqual(HANDCALCS.map((h) => h.id).sort())
    const all = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(all).toHaveLength(HANDCALCS.length)
    // 頁面上的出現順序
    expect(all.map((el) => el.id.replace('handcalc-', ''))).toEqual(Object.keys(where))
    for (const el of all) {
      const id = el.id.replace('handcalc-', '')
      expect(el.parentElement?.closest('section[id^="ch00-"]')?.id, id).toBe(where[id])
      // 前面有一句邀請讀者先自己算的話
      const lead = el.parentElement?.querySelector('.ch00-handcalc-lead')
      expect(lead?.textContent, id).toContain('換你算')
      expect(el.parentElement?.getAttribute('data-handcalc')).toBe(id)
      expect(el.querySelectorAll('.c-step').length, id).toBeGreaterThan(0)
    }
    // 綜合題在思考題之前，而且中間沒有別的手算題
    const quiz = container.querySelector('#ch00-quiz')!
    const last = all[all.length - 1]
    expect(last.id).toBe('handcalc-HC-00.8')
    expect(last.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('#ch00-assumptions')!.nextElementSibling).toBe(quiz)
    // HC-00.5 放在 Monte Carlo 實驗之前（先手算、再對照實驗的指標表）
    const lab = container.querySelector('#exp-intro-noise-average')!
    expect(container.querySelector('[id="handcalc-HC-00.5"]')!.compareDocumentPosition(lab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 整章（含 8 題手算）沒有 KaTeX 錯誤，也沒有殘留的 $
    expect(Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title'))).toEqual([])
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll('pre, .katex').forEach((e) => e.remove())
    expect(prose.textContent).not.toContain('$')
    await act(async () => {})
    localStorage.clear()
  }, 90_000)
})
