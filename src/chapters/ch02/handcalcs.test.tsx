import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, inputError, randomValues, renderTex } from '@/components'
import type { HandCalcDef, PresetEntry } from '@/data/types'
import { createRng, normCdf, normInv } from '@/simulation/core'
import { conventionalStep, fixedXMuMax, signErrorStep, signSignStep } from '@/simulation/models/lms'
import {
  cycleTail,
  equalSpeedVarianceRatio,
  gradientDescent,
  harmonicReachSteps,
  harmonicTravelApprox,
  meanFieldAnalysis,
  meanFieldDrift,
  nlmsStep,
  noiseMedian,
  predictSteadyState,
  ratioFixedPoints,
  runSignErrorFixedX,
  signErrorLimitCycle,
  stepSize,
  stepsToTravel,
  travelDistance,
  type Schedule,
} from '@/simulation/models/sgd'
import { FORMULAS } from './formulas'
import { decimalsFor, isShort, resultDigits, sigAt, sigDigits, sigFor, sigRoundArg, tx, txInt, txP, txRoundArg, txSq } from './handcalcTex'
import { HANDCALCS, OUTLIER_MAX_PROB, OUTLIER_MIN_SIGMAS, SE_LINEAR_MAX_G, bpskModel, outlierModel, snapZero, tieSafeY, zsum } from './handcalcs'
import { expectNoTexErrors } from '@/test/katex'

const golden = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))
const preset = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), `src/data/presets/${id}.json`), 'utf8')) as PresetEntry

const byId = (id: string): HandCalcDef => {
  const d = HANDCALCS.find((h) => h.id === id)
  if (!d) throw new Error(`找不到 ${id}`)
  return d
}
/** 預設值的解與「symbol → value」對照 */
const solveDefault = (id: string) => {
  const d = byId(id)
  const sol = d.solve(defaultValues(d))
  return { d, sol, val: sol.results.map((r) => r.value) }
}

/** |actual − expected| ≤ abs + rel·|expected| */
function expectClose(actual: number, expected: number, msg: string, rel = 1e-9, abs = 1e-12) {
  expect(Math.abs(actual - expected), `${msg}: got ${actual}, expected ${expected}`).toBeLessThanOrEqual(abs + rel * Math.abs(expected))
}

const CONST: Schedule = { kind: 'constant', n0: 1 }

/**
 * 逾時（ms）：KaTeX 渲染在多個 agent／開發者同時跑測試時（load average 曾超過 600）會慢數十倍，
 * 所以設得很寬——逾時只是「不要卡死」的保險，不是效能斷言。
 */
const T_RENDER = 240_000
const T_ALL = 600_000 // 八題 × 多個種子全部渲染
vi.setConfig({ testTimeout: 120_000 }) // 沒有另外指定逾時的測試

/* ───────────── 與模型無關的獨立重算（直接寫在測試裡的公式） ───────────── */

/** 加權中位數（排序後累積權重第一次超過一半；不處理剛好一半的區間，那種輸入已被 validate 擋掉）。 */
function wmed(values: number[], weights: number[]): number {
  const idx = values.map((_, i) => i).sort((i, j) => values[i] - values[j])
  const W = weights.reduce((s, w) => s + w, 0)
  let cum = 0
  for (const i of idx) {
    cum += weights[i]
    if (cum > W / 2) return values[i]
  }
  return NaN
}

/** Gaussian + 單邊 outlier 的中位數：自己用二分法解 (1−p)Φ(m/σ) + pΦ((m−s)/σ) = ½。 */
function mixtureMedian(sigma: number, p: number, s: number): number {
  const F = (m: number) => (1 - p) * normCdf(m / sigma) + p * normCdf((m - s) / sigma) - 0.5
  let lo = -10 * sigma
  let hi = s + 10 * sigma
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (F(mid) < 0) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** 每一題的結果（與 solve().results 同順序）用最直接的公式重算。 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-02.1': ({ a, x, w0, mu }) => {
    const y = a * x
    const e0 = y - w0 * x
    const w1 = w0 + mu * e0 * x
    const e1 = y - w1 * x
    return [w1, 0.5 * e0 * e0 - mu * (e0 * x) ** 2, 0.5 * e1 * e1]
  },
  'HC-02.2': ({ a, x, w0, mu }) => {
    const h = mu * Math.abs(x)
    const d0 = a - w0
    const nc = Math.floor(Math.abs(d0) / h)
    const rho = Math.abs(d0) - nc * h
    const p1 = a - Math.sign(d0) * rho
    const p2 = a + Math.sign(d0) * (h - rho)
    return [nc, Math.min(p1, p2), Math.max(p1, p2), (p1 + p2) / 2]
  },
  'HC-02.3': ({ mu0, n0, n, x, D }) => {
    const mun = mu0 / (1 + n / n0)
    const c = mu0 * n0 * Math.abs(x)
    return [mun, mun * Math.abs(x), c * Math.log(1 + n / n0), n0 * (Math.exp(D / c) - 1)]
  },
  'HC-02.4': ({ w, x, y, mu }) => {
    const e = y - w * x
    return [w + mu * e * x, w + mu * Math.sign(e) * x, w + mu * Math.sign(e) * Math.sign(x)]
  },
  'HC-02.5': (v) => {
    const xs = [v.x1, v.x2, v.x3]
    const ys = [v.y1, v.y2, v.y3]
    const r = xs.map((x, i) => ys[i] / x)
    const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0)
    const sxx = xs.reduce((s, x) => s + x * x, 0)
    return [sxy / sxx, wmed(r, xs.map(Math.abs)), [...r].sort((p, q) => p - q)[1], (r[0] + r[1] + r[2]) / 3]
  },
  'HC-02.6': ({ a, A, sigma, p, s }) => {
    const m = mixtureMedian(sigma, p, s)
    return [a + (p * s) / A, m / A, a + m / A]
  },
  'HC-02.7': ({ w, x, y, mut, eps }) => {
    const e = y - w * x
    const muEff = mut / (eps + x * x)
    const w1 = w + muEff * e * x
    return [muEff, w1, y - w1 * x]
  },
  'HC-02.8': ({ sigma, A, mu }) => {
    const K = (Math.sqrt(2 / Math.PI) * A * A) / sigma
    const g = mu * K
    const varSe = (mu * A * A) / (K * (2 - g))
    return [K, 1 - g, -1 / Math.log(Math.abs(1 - g)), Math.sqrt(varSe), Math.PI / 2]
  },
}

/* ───────────── DOM 檢查工具（與 ch02.test.tsx 相同的規則） ───────────── */

const BARE_MACRO = /(?<![\\a-zA-Z])(operatorname|tfrac|dfrac|frac|equiv|Rightarrow|Leftarrow|iff|qquad|quad|varepsilon|ldots|cdots|boxed|neq|sigma|psi|lambda|sqrt|approx|tilde|mathbf|infty|times|cdot|pm|mu|delta|eta|tau|pi|hat|text|ln)(?![a-zA-Z])/
const stripText = (src: string) => src.replace(/\\text\{[^}]*\}/g, '')
function bareMacros(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('annotation[encoding="application/x-tex"]'))
    .map((a) => a.textContent ?? '')
    .filter((src) => BARE_MACRO.test(stripText(src)))
}
const UNICODE_MATH = /[μσδψεηλτρ²³⁴₀₁₂ₙ″≤≥≈∝√∞×±]|E\[/
function unicodeMath(root: ParentNode): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = (n.textContent ?? '').trim()
    const el = n.parentElement
    if (!t || !el || !UNICODE_MATH.test(t)) continue
    if (el.closest('.katex, input')) continue
    out.push(t.slice(0, 80))
  }
  return out
}
/** 字串（why／notes／tips／validate 訊息）裡的 $…$ 都能被 KaTeX 解析，$ 成對，且 $…$ 之外沒有 Unicode 拼的公式。 */
function expectCleanMathString(s: string, where: string) {
  expect((s.match(/(?<!\\)\$/g) ?? []).length % 2, `${where}: $ 不成對：${s}`).toBe(0)
  expect(s.replace(/\$[^$]*\$/g, ''), `${where}: ${s}`).not.toMatch(UNICODE_MATH)
  expect(s, `${where}: ${s}`).not.toMatch(/NaN|undefined|Infinity/)
  for (const m of s.matchAll(/\$([^$]*)\$/g)) {
    expect(renderTex(m[1], false), `${where}: ${m[1]}`).not.toMatch(/katex-error|c-tex-error/)
    expect(BARE_MACRO.test(stripText(m[1])), `${where}: ${m[1]}`).toBe(false)
  }
}

/**
 * 手算友善的數字不應該算出「10⁻¹⁶」這種答案：那是 IEEE double 的捨入殘值（精確算術下是 0）。
 * HC-02.2 備註裡刻意列出 IEEE double 逐步模擬的原始數值（rawNum，用來對照勘誤 E40），那一則不檢查。
 */
function expectNoFloatResidue(sol: { steps: { tex: string; why: string }[]; results: { value: number }[]; notes?: string[] }, where: string) {
  const RESIDUE = /10\^\{-(1[2-9]|[2-9]\d)\}/
  for (const s of sol.steps) {
    expect(s.tex, `${where}: ${s.tex}`).not.toMatch(RESIDUE)
    expect(s.why, `${where}: ${s.why}`).not.toMatch(RESIDUE)
  }
  for (const n of (sol.notes ?? []).filter((x) => !x.includes('IEEE double'))) expect(n, `${where}: ${n}`).not.toMatch(RESIDUE)
  for (const r of sol.results) expect(r.value === 0 || Math.abs(r.value) > 1e-12, `${where}: result ${r.value}`).toBe(true)
}

/* ═════════════════════════════ 測試 ═════════════════════════════ */

describe('Ch02 帶入手算：登錄資料', () => {
  it('8 題、ID 依序 HC-02.1…HC-02.8、頁面 /ch/02、公式 ID 都在本章公式登錄內；三種難度都有', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-02.1', 'HC-02.2', 'HC-02.3', 'HC-02.4', 'HC-02.5', 'HC-02.6', 'HC-02.7', 'HC-02.8'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/02')
      expect(h.formulaId && formulaIds.has(h.formulaId), `${h.id} formulaId ${h.formulaId}`).toBe(true)
      expect(h.tips?.length, h.id).toBeGreaterThanOrEqual(2)
      expect(renderTex(h.formulaTex, true), h.id).not.toMatch(/katex-error|c-tex-error/)
      expect(BARE_MACRO.test(stripText(h.formulaTex)), h.id).toBe(false)
      expectCleanMathString(h.title, `${h.id} title`)
      for (const t of h.tips ?? []) expectCleanMathString(t, `${h.id} tip`)
      for (const i of h.inputs) {
        expectCleanMathString(i.label, `${h.id} label ${i.key}`)
        expect(renderTex(i.symbol, false), `${h.id} ${i.key}`).not.toMatch(/katex-error|c-tex-error/)
        expect(i.practice, `${h.id} ${i.key} 要有 practice 範圍`).toBeTruthy()
        if (i.min !== undefined) expect(i.default).toBeGreaterThanOrEqual(i.min)
        if (i.max !== undefined) expect(i.default).toBeLessThanOrEqual(i.max)
        // practice 的數字都在合法範圍內
        for (const c of i.practice?.choices ?? []) {
          if (i.min !== undefined) expect(c).toBeGreaterThanOrEqual(i.min)
          if (i.max !== undefined) expect(c).toBeLessThanOrEqual(i.max)
          if (i.integer) expect(Number.isInteger(c)).toBe(true)
        }
      }
      // 預設值本身必須合法
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    // 難度標示要誠實：beginner 題的步驟不可出現 ln、e^x、開根號、Φ
    for (const h of HANDCALCS.filter((x) => x.level === 'beginner')) {
      const tex = h.solve(defaultValues(h)).steps.map((s) => s.tex).join(' ')
      expect(tex, h.id).not.toMatch(/\\ln|\\sqrt|\\Phi|\\mathrm\{e\}\^|\\log|\\exp/)
    }
    expect(byId('HC-02.3').solve(defaultValues(byId('HC-02.3'))).steps.map((s) => s.tex).join(' ')).toMatch(/\\ln/)
    expect(byId('HC-02.6').solve(defaultValues(byId('HC-02.6'))).steps.map((s) => s.tex).join(' ')).toMatch(/\\Phi\^\{-1\}/)
    expect(byId('HC-02.8').solve(defaultValues(byId('HC-02.8'))).steps.map((s) => s.tex).join(' ')).toMatch(/\\sqrt/)
  })
})

describe('Ch02 帶入手算：通式不比欄位寬（拆行，內容不變）', () => {
  // 1280 px 桌面上這三條通式曾比欄位寬、要左右捲動；拆成 gathered 的 2–3 行（在逗號或分號處換行），項目一個不少
  const SPLIT: Record<string, { rows: number; terms: string[] }> = {
    'HC-02.2': {
      rows: 2,
      terms: [String.raw`\delta_0=a-w_0`, String.raw`h=\mu|x|`, String.raw`n_c=\Big\lfloor\frac{|\delta_0|}{h}\Big\rfloor`, String.raw`\rho=|\delta_0|-n_c\,h`, String.raw`w_n\in\big\{a-\operatorname{sgn}(\delta_0)\,\rho,\ \ a+\operatorname{sgn}(\delta_0)(h-\rho)\big\}\ \ (n\ge n_c)`],
    },
    'HC-02.6': {
      rows: 3,
      terms: [String.raw`\psi_{\rm LMS}(a)=E[v]\,E[x]`, String.raw`\psi_{\rm SE}(a)=E[\operatorname{sign}v]\,E[x]`, String.raw`x\equiv A:`, String.raw`w^*_{\rm LMS}=a+\frac{E[v]}{A}`, String.raw`w^*_{\rm SE}=a+\frac{\operatorname{med}(v)}{A}`, String.raw`\operatorname{med}(v)\approx\sigma_v\,\Phi^{-1}\!\Big(\frac{1}{2(1-p_{\rm out})}\Big)`],
    },
    'HC-02.8': {
      rows: 2,
      terms: [String.raw`K_q=\sqrt{\tfrac{2}{\pi}}\,\frac{1}{\sigma_v}`, String.raw`K_{\rm SE}=K_q\,E[x^2]`, String.raw`p=1-\mu K_{\rm SE}`, String.raw`\tau=\frac{-1}{\ln|p|}`, String.raw`\operatorname{Var}(w)\approx\frac{\mu\,\sigma_\eta^2}{K\,(2-\mu K)}`, String.raw`\frac{\operatorname{Var}_{\rm SE}}{\operatorname{Var}_{\rm LMS}}\bigg|_{\text{同 }\mu K}=\frac{\pi}{2}`],
    },
  }
  it('HC-02.2 / 02.6 / 02.8 的通式是 \\begin{gathered} 的多行式，每個項目原樣保留、可解析', () => {
    for (const [id, { rows, terms }] of Object.entries(SPLIT)) {
      const tex = byId(id).formulaTex
      expect(tex, id).toMatch(/^\\begin\{gathered\}.*\\end\{gathered\}$/s)
      expect(tex.split(String.raw`\\[4pt]`), `${id} 行數`).toHaveLength(rows)
      for (const t of terms) expect(tex, `${id}: ${t}`).toContain(t)
      expect(renderTex(tex, true), id).not.toMatch(/katex-error|c-tex-error/)
    }
  })
})

describe('Ch02 帶入手算：全站彙整', () => {
  it('「手算練習簿」頁用的彙整（import.meta.glob）收得到本章 8 題，而且就是同一批物件', async () => {
    // 動態匯入：彙整會一併載入其他章節的 handcalcs.ts，別的章節正在修改時只影響這一個測試
    const { handcalcsForPage, handcalcById } = await import('@/app/handcalcs')
    expect(handcalcsForPage('/ch/02').map((h) => h.id)).toEqual(HANDCALCS.map((h) => h.id))
    for (const h of HANDCALCS) expect(handcalcById(h.id)).toBe(h)
  })
})

describe('(a) 預設值：結果 = 模型函式 = 內文 worked example = golden vector', () => {
  it('T01: HC-02.1（a=3、x=2、w₀=1、μ=0.1）w₁ = golden w1 = 1.8；切線預測 1.6；真實 J(w₁) = ½·e1² = 2.88', () => {
    const g = golden('T01')
    const { d, val } = solveDefault('HC-02.1')
    const v = defaultValues(d)
    expect({ a: v.a, x: v.x, w0: v.w0, mu: v.mu }).toEqual({ a: g.inputs.a, x: g.inputs.x, w0: g.inputs.w0, mu: g.inputs.mu })
    expectClose(val[0], g.expected.w1, 'w1', 0, g.tolerance.abs)
    expectClose(val[2], 0.5 * g.expected.e1 ** 2, 'J(w1)', 0, 1e-12)
    // 內文（S1GradientDescent）的數字
    expect(val[0]).toBeCloseTo(1.8, 12)
    expect(val[1]).toBeCloseTo(1.6, 12)
    expect(val[2]).toBeCloseTo(2.88, 12)
    // 就是 gradientDescent() 的輸出（同一個函式、同一個運算順序 ⇒ 逐位元相同）
    const t = gradientDescent({ a: v.a, x: v.x, w0: v.w0, mu: v.mu, steps: 1, cost: 'half' })
    expect(val[0]).toBe(t.w[1])
    expect(val[1]).toBe(t.J[0] + t.dJ[0] * t.dw[0])
    expect(val[2]).toBe(t.J[1])
    // LMS 的同一步（T01）
    expect(val[0]).toBe(conventionalStep({ w: v.w0, x: v.x, y: v.a * v.x, mu: v.mu }).w)
  })

  it('T02: HC-02.1 備註的步長上限 = golden mu_max = 0.5、Newton 步長 = mu_one_step = 0.25（x = 2）', () => {
    const g = golden('T02')
    const { d, sol } = solveDefault('HC-02.1')
    expect(defaultValues(d).x).toBe(g.inputs.x)
    expect(fixedXMuMax(g.inputs.x)).toBe(g.expected.mu_max)
    const notes = sol.notes!.join(' ')
    expect(notes).toContain(String.raw`\mu_{\max}=2/J''=${g.expected.mu_max}$`)
    expect(notes).toContain(String.raw`\mu=1/J''=${g.expected.mu_one_step}$`)
    // pole = 0.6（golden pole_list[0]，對應 μ = 0.1）
    expect(notes).toContain(String.raw`p=1-\mu J''=${g.expected.pole_list[0]}$`)
    // 邊界與發散：μ = 0.5 成本不變、μ = 0.51 成本上升（golden converges_list 對應為 0）
    const at = (mu: number) => d.solve({ ...defaultValues(d), mu }).results
    expect(at(0.5)[2].value).toBeCloseTo(8, 12)
    expect(at(0.51)[2].value).toBeGreaterThan(8)
    expect(at(0.25)[2].value).toBeCloseTo(0, 12)
  })

  it('HC-02.2（a=3、x=1、w₀=0、μ=0.4）n_c = 7、在 2.8 與 3.2 之間跳、時間平均 3：等於 signErrorLimitCycle() 與實際模擬', () => {
    const { val } = solveDefault('HC-02.2')
    const lc = signErrorLimitCycle(3, 1, 0, 0.4)
    expect(val).toEqual([lc.entryStep, lc.lo, lc.hi, lc.mean])
    expect(val[0]).toBe(7)
    expect(val[1]).toBeCloseTo(2.8, 12)
    expect(val[2]).toBeCloseTo(3.2, 12)
    expect(val[3]).toBeCloseTo(3, 12)
    // 用 lms.ts 的 signErrorStep 逐步跑（IEEE double）：尾段兩點與時間平均
    const w = runSignErrorFixedX(3, 1, 0, 40, 0.4, CONST, 'plus')
    const tail = cycleTail(w, lc.entryStep)
    expectClose(tail.lo, val[1], 'lo', 1e-12)
    expectClose(tail.hi, val[2], 'hi', 1e-12)
    expectClose(tail.mean, val[3], 'mean', 1e-12)
    // 第一次越過 a 是第 n_c + 1 步
    expect(stepsToTravel(3, 0.4, 1, CONST)).toBe(val[0] + 1)
    expect(w[7]).toBeLessThan(3)
    expect(w[8]).toBeGreaterThan(3)
  })

  it('HC-02.3（μ₀=0.4、n₀=20、n=60、D=3）μ_60 = 0.1、N_reach ≈ 9.1；網站逐步累加是 9 步（內文的數字）', () => {
    const { val, sol } = solveDefault('HC-02.3')
    const sched: Schedule = { kind: 'harmonic', n0: 20 }
    expect(val[0]).toBe(stepSize(0.4, 60, sched))
    expect(val[0]).toBeCloseTo(0.1, 14)
    expect(val[1]).toBeCloseTo(0.1, 14)
    expect(val[2]).toBe(harmonicTravelApprox(0.4, 1, 20, 60))
    expect(val[2]).toBeCloseTo(8 * Math.log(4), 12)
    expect(val[3]).toBe(harmonicReachSteps(3, 0.4, 1, 20))
    expect(val[3]).toBeCloseTo(20 * (Math.exp(0.375) - 1), 12)
    // 內文：「實際只要 9 步」
    const exact = stepsToTravel(3, 0.4, 1, sched)
    expect(exact).toBe(9)
    expect(sol.steps[sol.steps.length - 1].why).toContain('$9$')
    // 積分近似的方向：距離低估、步數高估
    expect(val[2]).toBeLessThan(travelDistance(0.4, 1, sched, 60))
    expect(exact).toBeLessThanOrEqual(Math.ceil(val[3]))
  })

  it('T01: HC-02.4（w=1、x=2、y=6、μ=0.1）LMS = golden w1 = 1.8、Sign-Error 1.2、Sign-Sign 1.1：等於 lms.ts 的三個 stepper', () => {
    const g = golden('T01')
    const { d, val } = solveDefault('HC-02.4')
    const v = defaultValues(d)
    expect({ w: v.w, x: v.x, y: v.y, mu: v.mu }).toEqual({ w: g.inputs.w0, x: g.inputs.x, y: g.inputs.a * g.inputs.x, mu: g.inputs.mu })
    const inp = { w: v.w, x: v.x, y: v.y, mu: v.mu }
    expect(val).toEqual([conventionalStep(inp).w, signErrorStep(inp).w, signSignStep(inp).w])
    expectClose(val[0], g.expected.w1, 'LMS', 0, g.tolerance.abs)
    expect(val[1]).toBeCloseTo(1.2, 12)
    expect(val[2]).toBeCloseTo(1.1, 12)
    // 思考題 6 的數字（w=2、x=−3、y=−9、μ=0.1）
    const q6 = d.solve({ w: 2, x: -3, y: -9, mu: 0.1 }).results.map((r) => r.value)
    expect(q6[0]).toBeCloseTo(2.9, 12)
    expect(q6[1]).toBeCloseTo(2.3, 12)
    expect(q6[2]).toBeCloseTo(2.1, 12)
  })

  it('HC-02.5（(1,3)、(2,7)、(4,10)）LMS 57/21、Sign-Error 2.5、Sign-Sign 3、NLMS 3：等於 ratioFixedPoints()', () => {
    const { val } = solveDefault('HC-02.5')
    const rf = ratioFixedPoints([1, 2, 4], [3, 7, 10])
    expect(val).toEqual([rf.lms, rf.signError[0], rf.signSign[0], rf.nlms])
    expect(val[0]).toBeCloseTo(57 / 21, 14)
    expect(val.slice(1)).toEqual([2.5, 3, 3])
  })

  it('HC-02.6 預設值 = 「單邊 outlier」preset：LMS w* = 4.000、Sign-Error w* = 3.020（mean-field 的固定點）', () => {
    const p = preset('sign-lms-outliers').params as Record<string, number | string>
    const { d, val, sol } = solveDefault('HC-02.6')
    const v = defaultValues(d)
    expect(p.xKind).toBe('const')
    expect({ a: v.a, A: v.A, sigma: v.sigma, p: v.p, s: v.s }).toEqual({ a: p.a, A: p.xAmp, sigma: p.sigma, p: p.outlierProb, s: p.outlierSize })
    const { noise, inp } = outlierModel(v.a, v.A, v.sigma, v.p, v.s)
    const wL = meanFieldAnalysis('lms', inp).wStar
    const wS = meanFieldAnalysis('sign_error', inp).wStar
    expect(val).toEqual([wL, wS - v.a, wS])
    // preset 的 expected：「LMS w* = 3 + p·s = 4.000、Sign-Error 3.020」
    expect(val[0]).toBeCloseTo(4, 10)
    expect(val[2]).toBeCloseTo(3.02, 3)
    // 手算公式 σ·Φ⁻¹(1/(2(1−p))) 與模型的中位數一致
    const hand = v.sigma * normInv(1 / (2 * (1 - v.p)))
    expectClose(noiseMedian(noise), hand, 'median', 1e-9)
    expectClose(val[1], hand / v.A, 'shift', 1e-9)
    // F-02.18：ψ(a) = E[v]E[x]、E[sign v]E[x]
    expect(meanFieldDrift('lms', v.a, inp)).toBeCloseTo(v.p * v.s * v.A, 12)
    expect(meanFieldDrift('sign_error', v.a, inp)).toBeCloseTo(v.p * v.A, 9)
    // 小 z 近似 √(2π)(q − ½) 與 t + t³/6 的誤差在提示宣稱的範圍內
    const z = hand / v.sigma
    const t = Math.sqrt(2 * Math.PI) * (1 / (2 * (1 - v.p)) - 0.5)
    expect(Math.abs(t - z) / z).toBeLessThan(0.002)
    expect(Math.abs(t + t ** 3 / 6 - z) / z).toBeLessThan(0.0005)
    // 「對答案」：只答 a（忽略偏移）不可算對；答到 3 位有效的偏移才算對
    expect(checkAnswer(v.a, sol.results[2]).ok).toBe(false)
    expect(checkAnswer(3.0198, sol.results[2]).ok).toBe(true)
    expect(checkAnswer(0.0198, sol.results[1]).ok).toBe(true)
  })

  it('T01: HC-02.7（T01 的資料、μ̃ = μx² = 0.4、ε = 0）NLMS 與 LMS 相同：w₁ = golden w1、e⁺ = golden e1', () => {
    const g = golden('T01')
    const { d, val } = solveDefault('HC-02.7')
    const v = defaultValues(d)
    expect({ w: v.w, x: v.x, y: v.y }).toEqual({ w: g.inputs.w0, x: g.inputs.x, y: g.inputs.a * g.inputs.x })
    expect(v.mut).toBeCloseTo(g.inputs.mu * g.inputs.x ** 2, 15)
    const s = nlmsStep({ w: v.w, x: v.x, y: v.y, mu: v.mut, eps: v.eps })
    expect(val[1]).toBe(s.w)
    expect(val[2]).toBe(nlmsStep({ w: s.w, x: v.x, y: v.y, mu: v.mut, eps: v.eps }).e)
    expectClose(val[0], g.inputs.mu, 'mu_eff', 0, 1e-15)
    expectClose(val[1], g.expected.w1, 'w1', 0, g.tolerance.abs)
    expectClose(val[2], g.expected.e1, 'e+', 0, g.tolerance.abs)
    expectClose(val[2] / s.e, g.expected.pole, 'e+/e = pole', 0, g.tolerance.abs)
  })

  it('HC-02.8（σ_v=0.5、A=1、μ=0.02：主實驗預設的雜訊與步長）K、pole、τ、std = meanFieldAnalysis / predictSteadyState；變異比 = π/2', () => {
    const p = preset('sign-lms-equal-speed').params as Record<string, number | string>
    const { d, val } = solveDefault('HC-02.8')
    const v = defaultValues(d)
    expect({ sigma: v.sigma, A: v.A, mu: v.mu }).toEqual({ sigma: p.sigma, A: p.xAmp, mu: p.mu })
    const inp = bpskModel(v.A, v.sigma)
    const mf = meanFieldAnalysis('sign_error', inp)
    const ss = predictSteadyState(mf, v.mu, inp)
    expect(val.slice(0, 4)).toEqual([mf.K, ss.pole, ss.tau, ss.std])
    expectClose(val[4], equalSpeedVarianceRatio('sign_error', inp), 'ratio', 1e-12)
    expectClose(val[4], Math.PI / 2, 'π/2', 1e-12)
    expect(ss.stable).toBe(true)
    // 封閉式（F-02.12）：K_SE = √(2/π)·A²/σ_v
    expectClose(val[0], Math.sqrt(2 / Math.PI) / 0.5, 'K_SE', 1e-12)
    expect(val[2]).toBeCloseTo(30.83, 2)
    expect(val[3]).toBeCloseTo(0.0798, 4)
  })
})

describe('手算提示（tips）裡宣稱的數字與近似誤差都經過驗算', () => {
  it('HC-02.2 提示：w₀ 改成 0.1 ⇒ 在 2.9 與 3.3 之間跳、時間平均 3.1；HC-02.7 提示：x、y 同乘 10 ⇒ e⁺/e 仍是 0.6', () => {
    const r2 = byId('HC-02.2').solve({ a: 3, x: 1, w0: 0.1, mu: 0.4 }).results.map((r) => r.value)
    expect(r2[0]).toBe(7)
    expect(r2[1]).toBeCloseTo(2.9, 12)
    expect(r2[2]).toBeCloseTo(3.3, 12)
    expect(r2[3]).toBeCloseTo(3.1, 12)
    expect(byId('HC-02.2').tips!.join(' ')).toContain('$2.9$ 與 $3.3$')
    const d7 = byId('HC-02.7')
    for (const [x, y] of [[2, 6], [20, 60]] as const) {
      const sol = d7.solve({ w: 1, x, y, mut: 0.4, eps: 0 })
      const e = y - 1 * x
      expect(sol.results[2].value / e).toBeCloseTo(0.6, 12)
    }
    expect(d7.tips!.join(' ')).toContain('$e^+/e$ 還是 $0.6$')
  })

  it('HC-02.3 提示：eᵗ − 1 ≈ t(1 + t/2)（t ≤ 0.2，誤差 < 0.7%）、ln(1 + u) ≈ u − u²/2（u ≤ 0.1，誤差 < 0.4%）、ln u = 2.3026·log₁₀u', () => {
    for (let t = 0.005; t <= 0.2 + 1e-12; t += 0.005) expect(Math.abs(t * (1 + t / 2) - Math.expm1(t)) / Math.expm1(t)).toBeLessThan(0.007)
    for (let u = 0.005; u <= 0.1 + 1e-12; u += 0.005) expect(Math.abs(u - (u * u) / 2 - Math.log1p(u)) / Math.log1p(u)).toBeLessThan(0.004)
    expect(Math.LN10).toBeCloseTo(2.3026, 4)
    const tips = byId('HC-02.3').tips!.join(' ')
    expect(tips).toContain(String.raw`誤差 $<0.7\%$`)
    expect(tips).toContain(String.raw`誤差 $<0.4\%$`)
    expect(tips).toContain('2.3026')
  })

  it('HC-02.6 提示：z ≈ t（|z| ≤ 0.1，< 0.2%）、z ≈ t + t³/6（|z| ≤ 0.3，< 0.05%；|z| ≤ 0.5，< 0.4%），t = √(2π)(Φ(z) − ½)', () => {
    const tOf = (z: number) => Math.sqrt(2 * Math.PI) * (normCdf(z) - 0.5)
    for (let z = 0.01; z <= 0.5 + 1e-12; z += 0.01) {
      const t = tOf(z)
      const e1 = Math.abs(t - z) / z
      const e3 = Math.abs(t + t ** 3 / 6 - z) / z
      if (z <= 0.1 + 1e-12) expect(e1, `z=${z}`).toBeLessThan(0.002)
      if (z <= 0.3 + 1e-12) expect(e3, `z=${z}`).toBeLessThan(0.0005)
      expect(e3, `z=${z}`).toBeLessThan(0.004)
    }
    expect(Math.sqrt(2 * Math.PI)).toBeCloseTo(2.5066, 4)
    expect(Math.sqrt(2 * Math.PI)).toBeCloseTo(2.50663, 5) // 步驟裡用的 6 位數
    // 提示裡的查表示範：四位數的常態表 Φ(0.06) = 0.5239、Φ(0.07) = 0.5279；q = 0.5263 線性內插得 0.066（精確值 0.066012）
    expect(normCdf(0.06).toFixed(4)).toBe('0.5239')
    expect(normCdf(0.07).toFixed(4)).toBe('0.5279')
    expect((1 / (2 * (1 - 0.05))).toFixed(4)).toBe('0.5263')
    const zTable = 0.06 + (0.01 * (0.5263 - 0.5239)) / (0.5279 - 0.5239)
    expect(zTable).toBeCloseTo(0.066, 10)
    expect(Math.abs(zTable - normInv(1 / 1.9)) / normInv(1 / 1.9)).toBeLessThan(0.001)
    const tip6 = byId('HC-02.6').tips!.join(' ')
    expect(tip6).toContain(String.raw`\Phi(0.06)=0.5239`)
    expect(tip6).toContain(String.raw`\Phi(0.07)=0.5279`)
    expect(tip6).toContain(String.raw`\dfrac{0.5263-0.5239}{0.5279-0.5239}=0.066`)
    // 允許範圍的上限 p_out = 0.3 ⇒ z = Φ⁻¹(1/1.4) ≈ 0.566：用提示的 z ≈ t + t³/6 算出的偏移仍在「對答案」的 3% 容許內
    const zMax = normInv(1 / (2 * (1 - OUTLIER_MAX_PROB)))
    expect(zMax).toBeCloseTo(0.566, 3)
    expect(Math.abs(tOf(zMax) + tOf(zMax) ** 3 / 6 - zMax) / zMax).toBeLessThan(0.03)
    // 「換一題」會出的 p_out（≤ 0.2）：連最粗的 z ≈ t 都在 3% 容許內，不查表也能對到答案
    const pIn = byId('HC-02.6').inputs.find((i) => i.key === 'p')!
    for (const p of pIn.practice!.choices!) {
      const z = normInv(1 / (2 * (1 - p)))
      expect(Math.abs(tOf(z) - z) / z, `p=${p}`).toBeLessThan(0.03)
    }
  })

  it('HC-02.8 提示：√(2/π) = 0.79788；τ ≈ 1/g − ½（g ≤ 0.2，誤差 < 0.5%）；π/2 = 1.5708', () => {
    expect(Math.sqrt(2 / Math.PI)).toBeCloseTo(0.79788, 5)
    expect(Math.PI / 2).toBeCloseTo(1.5708, 4)
    for (let g = 0.005; g <= 0.2 + 1e-12; g += 0.005) {
      const tau = -1 / Math.log(1 - g)
      expect(Math.abs(1 / g - 0.5 - tau) / tau, `g=${g}`).toBeLessThan(0.005)
    }
    // 預設值的步驟說明裡印出的近似值就是 1/g − ½
    const { d, sol } = solveDefault('HC-02.8')
    const g = 0.02 * sol.results[0].value
    const why = sol.steps.find((s) => s.tex.startsWith(String.raw`\tau=`))!.why
    expect(why).toContain(String.raw`\tau\approx1/g-\tfrac12=`)
    expect(1 / g - 0.5).toBeCloseTo(sol.results[2].value, 1)
    expect(d.tips!.join(' ')).toContain('0.79788')
  })
})

describe('(b) 換一題：20 個種子的結果都有限，且等於測試內直接寫的獨立公式', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：randomValues(def, 1…20)`, () => {
      const dflt = defaultValues(def)
      let nonDefault = 0
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(def, seed)
        expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
        expect(def.validate?.(v) ?? null, `${def.id} seed ${seed}: ${JSON.stringify(v)}`).toBeNull()
        if (JSON.stringify(v) !== JSON.stringify(dflt)) nonDefault++
        seen.add(JSON.stringify(v))
        const sol = def.solve(v)
        const want = INDEPENDENT[def.id](v)
        expect(sol.results.length).toBe(want.length)
        sol.results.forEach((r, i) => {
          expect(Number.isFinite(r.value), `${def.id} seed ${seed} ${r.symbol}`).toBe(true)
          expectClose(r.value, want[i], `${def.id} seed ${seed} ${r.symbol} ${JSON.stringify(v)}`, 1e-9, 1e-10)
          // 獨立公式算出的答案在「對答案」時會被判定為正確
          expect(checkAnswer(want[i], r).ok, `${def.id} seed ${seed} ${r.symbol}`).toBe(true)
        })
        // 每一步的 TeX 都能解析、沒有 NaN；說明文字的數學都是 $…$
        expect(sol.steps.length).toBeGreaterThan(0)
        for (const s of sol.steps) {
          expect(renderTex(s.tex, true), `${def.id} seed ${seed}: ${s.tex}`).not.toMatch(/katex-error|c-tex-error/)
          expect(s.tex, `${def.id} seed ${seed}`).not.toMatch(/NaN|undefined|Infinity/)
          expect(BARE_MACRO.test(stripText(s.tex)), s.tex).toBe(false)
          expectCleanMathString(s.why, `${def.id} seed ${seed} why`)
        }
        for (const n of sol.notes ?? []) expectCleanMathString(n, `${def.id} seed ${seed} note`)
        expectNoFloatResidue(sol, `${def.id} seed ${seed} ${JSON.stringify(v)}`)
      }
      expectNoFloatResidue(def.solve(dflt), `${def.id} 預設值`)
      // 「換一題」真的會換數字（不是每次都退回預設值）
      expect(nonDefault, def.id).toBeGreaterThanOrEqual(15)
      expect(seen.size, def.id).toBeGreaterThanOrEqual(10)
    }, T_RENDER)
  }

  it('HC-02.1：F-02.2 的精確下降量 μJ′²(1 − μJ″/2) 等於模型算的 J(w₀) − J(w₁)（含 μ 超過上限、成本上升的情形）', () => {
    const d = byId('HC-02.1')
    for (const [a, x, w0, mu] of [[3, 2, 1, 0.1], [3, 2, 1, 0.6], [-2, 0.5, 4, 3], [4, -3, -1, 0.25], [2, 1, 2, 0.3]] as const) {
      const t = gradientDescent({ a, x, w0, mu, steps: 1, cost: 'half' })
      const exact = mu * t.dJ[0] ** 2 * (1 - (mu / 2) * x * x)
      expectClose(t.J[0] - t.J[1], exact, `ΔJ ${a},${x},${w0},${mu}`, 1e-10, 1e-10)
      expect(d.solve({ a, x, w0, mu }).results[2].value).toBe(t.J[1])
    }
  })

  it('精確值是 0 的量不顯示成浮點殘值（10⁻¹⁶ 量級）：Newton 一步到位、NLMS μ̃ = 1、三個比值的平均剛好為 0', () => {
    expect(snapZero(1.1e-16, 0.6)).toBe(0)
    expect(snapZero(1e-14, 1e-14)).toBe(1e-14) // 本來就很小的量（相對於自己的尺度不小）不可被抹掉
    expect(snapZero(0, 0)).toBe(0)
    expect(snapZero(-2.5, 4)).toBe(-2.5)
    const noNoise = (id: string, v: Record<string, number>) => {
      const sol = byId(id).solve(v)
      const all = [...sol.steps.map((s) => s.tex), ...sol.steps.map((s) => s.why), ...(sol.notes ?? [])].join(' ')
      expect(all, `${id} ${JSON.stringify(v)}`).not.toMatch(/10\^\{-(1[2-9]|[2-9]\d)\}/)
      return sol.results.map((r) => r.value)
    }
    // HC-02.1：μJ″ = 0.01 × 10² = 1（Newton 步長）⇒ w₁ = a、J(w₁) = 0；模型用 IEEE double 算出 e₁ ≈ −3.6×10⁻¹⁵、J(w₁) ≈ 6×10⁻³⁰
    const v1 = { a: 2.3, x: 10, w0: 0.1, mu: 0.01 }
    const t = gradientDescent({ ...v1, steps: 1, cost: 'half' })
    expect(t.J[1]).toBeGreaterThan(0) // 模型的原始輸出確實留有捨入殘值……
    expect(t.J[1]).toBeLessThan(1e-24)
    const r1 = noNoise('HC-02.1', v1)
    expect(r1[0]).toBeCloseTo(2.3, 12)
    expect(r1[2]).toBe(0) // ……手算題顯示精確值 0
    // HC-02.7：μ̃ = 1、ε = 0 ⇒ e⁺ = (1 − μ̃)e = 0；模型的原始輸出是 −1.1×10⁻¹⁶，等效 LMS 的 pole 是 +1.1×10⁻¹⁶
    const v7 = { w: 0.1, x: 0.3, y: 0.7, mut: 1, eps: 0 }
    const raw7 = nlmsStep({ w: nlmsStep({ w: v7.w, x: v7.x, y: v7.y, mu: 1, eps: 0 }).w, x: v7.x, y: v7.y, mu: 1, eps: 0 }).e
    expect(raw7).not.toBe(0)
    expect(Math.abs(raw7)).toBeLessThan(1e-15)
    expect(noNoise('HC-02.7', v7)[2]).toBe(0)
    expect(noNoise('HC-02.7', { w: 0.3, x: 0.7, y: 1.1, mut: 1, eps: 0 })[2]).toBe(0) // 這一組的殘值出在備註的 pole（−2.2×10⁻¹⁶）
    // HC-02.5：r = 0.2、0.4、−0.6 ⇒ NLMS（平均）= 0；IEEE double 的 0.2 + 0.4 − 0.6 ≈ 1.1×10⁻¹⁶
    const v5 = { x1: 5, y1: 1, x2: 5, y2: 2, x3: -5, y3: 3 }
    expect(byId('HC-02.5').validate!(v5)).toBeNull()
    expect(0.2 + 0.4 - 0.6).not.toBe(0)
    const r5 = noNoise('HC-02.5', v5)
    expect(r5[3]).toBe(0)
    expect(r5[1]).toBe(0.2) // |x| 加權中位數：累積票數 5、10、15，第一次超過 7.5 的是 0.2
    expect(r5[2]).toBe(0.2)
    expectClose(r5[0], (5 * 1 + 5 * 2 - 5 * 3) / 75, 'LMS', 1e-12)
    // HC-02.2：a = 2、x = 0.5、w₀ = 5、μ = 0.8 ⇒ ρ = h/2，時間平均剛好是 a（偏離量 0，不是 −2.2×10⁻¹⁶）
    const sol2 = byId('HC-02.2').solve({ a: 2, x: 0.5, w0: 5, mu: 0.8 })
    expect(sol2.notes![0]).toContain(String.raw`(\tfrac h2-\rho)=0$`)
    expect(sol2.results[3].value).toBeCloseTo(2, 12)
  })

  it('勘誤 E40：精確算術下 e = 0 的輸入（0.9 − 0.3×3）不被浮點殘值誤判——三種更新都不動，和紙筆答案一致', () => {
    const v = { w: 0.3, x: 3, y: 0.9, mu: 0.1 }
    const raw = v.y - v.w * v.x
    expect(raw).not.toBe(0) // IEEE double：1.1×10⁻¹⁶
    expect(Math.abs(raw)).toBeLessThan(1e-15)
    expect(signErrorStep({ ...v, tie: 'zero' }).w).not.toBe(v.w) // 直接丟給 stepper 會被殘值的正負號推一步
    expect(tieSafeY(v.w, v.x, v.y)).toBe(v.w * v.x)
    expect(tieSafeY(1, 2, 6)).toBe(6) // 一般情況原樣回傳
    expect(tieSafeY(1, 2, 2 + 1e-9)).toBe(2 + 1e-9) // 真的很小但不是捨入殘值的誤差不可被抹掉
    const sol = byId('HC-02.4').solve(v)
    expect(sol.results.map((r) => r.value)).toEqual([0.3, 0.3, 0.3])
    expect(sol.notes!.join(' ')).toMatch(/E40/)
    expect(sol.steps[0].tex).toMatch(/=0$/)
    expectNoFloatResidue(sol, 'HC-02.4 tie')
    const sol7 = byId('HC-02.7').solve({ w: 0.3, x: 3, y: 0.9, mut: 0.5, eps: 0 })
    expect(sol7.results[1].value).toBe(0.3)
    expect(sol7.results[2].value).toBe(0)
    expectNoFloatResidue(sol7, 'HC-02.7 tie')
  })

  it('HC-02.2：對 20 組隨機數字，手算的兩點就是逐步模擬（IEEE double）最後停留的兩點', () => {
    const d = byId('HC-02.2')
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(d, seed)
      const [nc, lo, hi] = d.solve(v).results.map((r) => r.value)
      const w = runSignErrorFixedX(v.a, v.x, v.w0, nc + 20, v.mu, CONST, 'zero')
      const tail = [w[nc + 19], w[nc + 20]].sort((p, q) => p - q)
      expectClose(tail[0], lo, `seed ${seed} lo`, 1e-9, 1e-9)
      expectClose(tail[1], hi, `seed ${seed} hi`, 1e-9, 1e-9)
      expect(hi - lo).toBeCloseTo(v.mu * Math.abs(v.x), 9) // 兩點相距剛好一步 h
      expect(Math.abs(v.a - lo)).toBeLessThan(v.mu * Math.abs(v.x))
      expect(Math.abs(v.a - hi)).toBeLessThan(v.mu * Math.abs(v.x))
    }
  })

  it('HC-02.3：sgd.ts 新增的兩個封閉式（core:harmonicReach）與逐步累加的關係', () => {
    for (const [mu0, n0, absX, D] of [[0.4, 20, 1, 3], [0.2, 10, 2, 4], [0.5, 50, 0.5, 1], [0.05, 200, 1, 2], [0.4, 20, 1, 0.1]] as const) {
      const sched: Schedule = { kind: 'harmonic', n0 }
      const est = harmonicReachSteps(D, mu0, absX, n0)
      // 互為反函數：走 N_reach 步的近似距離剛好是 D
      expectClose(harmonicTravelApprox(mu0, absX, n0, est), D, 'inverse', 1e-12)
      // 和 ≥ 積分：實際步數 ≤ ⌈近似值⌉；且 Σ_{n<N} ≤ μ₀|x| + ∫₀^{N−1} ⇒ 實際步數 ≥ 1 + N_reach(D − μ₀|x|)
      const exact = stepsToTravel(D, mu0, absX, sched)
      expect(exact).toBeLessThanOrEqual(Math.ceil(est))
      expect(exact).toBeGreaterThanOrEqual(1 + harmonicReachSteps(D - mu0 * absX, mu0, absX, n0) - 1e-9)
      for (const n of [1, 10, 100, 1000]) {
        const sum = travelDistance(mu0, absX, sched, n)
        expect(harmonicTravelApprox(mu0, absX, n0, n)).toBeLessThanOrEqual(sum)
        expect(sum).toBeLessThanOrEqual(mu0 * absX + harmonicTravelApprox(mu0, absX, n0, n - 1) + 1e-12)
      }
    }
    expect(harmonicReachSteps(0, 0.4, 1, 20)).toBe(0)
    expect(harmonicReachSteps(3, 0, 1, 20)).toBe(Infinity)
    expect(harmonicReachSteps(3, 0.4, 0, 20)).toBe(Infinity)
    // 內文的 stall 例子：μ₀ = 0.01、n₀ = 10、D = 3 ⇒ 約 10·e³⁰ 步
    expectClose(harmonicReachSteps(3, 0.01, 1, 10), 10 * Math.expm1(30), 'stall', 1e-12)
    expect(byId('HC-02.3').validate!({ mu0: 0.01, n0: 10, n: 60, x: 1, D: 3 })).toBeNull()
  })

  it('HC-02.6：手算近似 σ_v·Φ⁻¹(q) 在整個允許範圍（p ≤ 0.3、s ≥ 6σ_v）內與模型的精確中位數差不到 10⁻⁶', () => {
    for (const p of [0, 0.01, 0.05, 0.1, 0.2, OUTLIER_MAX_PROB])
      for (const sigma of [0.2, 1, 5]) {
        const s = OUTLIER_MIN_SIGMAS * sigma
        expect(byId('HC-02.6').validate!({ a: 3, A: 1, sigma, p, s })).toBeNull()
        const { noise } = outlierModel(3, 1, sigma, p, s)
        const hand = sigma * normInv(1 / (2 * (1 - p)))
        expect(Math.abs(noiseMedian(noise) - hand)).toBeLessThanOrEqual(1e-6 * sigma)
        expect(Math.abs(mixtureMedian(sigma, p, s) - noiseMedian(noise))).toBeLessThanOrEqual(1e-9 * sigma)
      }
  })

  it('HC-02.8：對稱 code 的 LMS 穩態變異用的是 F-02.16 的精確式；變異比與 μ、A、σ_v 無關', () => {
    const d = byId('HC-02.8')
    for (const [sigma, A, mu] of [[0.5, 1, 0.02], [2, 2, 0.1], [1, 0.5, 0.01], [0.5, -1, 0.05]] as const) {
      const sol = d.solve({ sigma, A, mu })
      expectClose(sol.results[4].value, Math.PI / 2, `ratio ${sigma},${A},${mu}`, 1e-10)
      const K = (Math.sqrt(2 / Math.PI) * A * A) / sigma
      const g = mu * K
      const muL = g / (A * A)
      const varL = (muL * sigma * sigma * A * A) / (2 * A * A - muL * A ** 4)
      expectClose(sol.results[3].value ** 2 / varL, Math.PI / 2, 'Var_SE/Var_LMS', 1e-10)
    }
  })
})

/* ═════════════ 畫面上的算式：把每一步的 TeX 重新求值（符號式 = 代入數字 = 中間結果 = 結果） ═════════════ */

function matchBrace(str: string, open: number): number {
  let depth = 0
  for (let i = open; i < str.length; i++) {
    if (str[i] === '{') depth++
    else if (str[i] === '}' && --depth === 0) return i
  }
  throw new Error(`大括號不成對：${str}`)
}

/** 一段數字算式的值，以及它用到哪幾種運算（add：加減、mul：乘、div：除、pow：次方、fn：√／ln／eˣ／Φ⁻¹／取整／min／max）。 */
interface Evaluated {
  v: number
  ops: Set<string>
  /** 這一段出現過的最大數字（結果剛好是 0 時，用它當捨入誤差的尺度） */
  scale: number
}

/**
 * 把一段「只含數字」的 TeX 求值；含符號（字母）的片段回傳 null。
 * 自己用遞迴下降剖析（不用 eval），所以 -0.1\times(-8)^2、(5\times10^{-5})^2、\tfrac12\times16 的優先順序和數學上相同。
 * a\times10^{b} 與 10^{b} 當成一個數字（科學記號），不算一次乘法。
 */
function evalTex(seg: string): Evaluated | null {
  let t = seg
    .replace(/\\(?:left|right|big|Big)/g, '')
    .replace(/\\[,;!]|\\ |\\q?quad/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\\times10\^\{(-?\d+)\}/g, '$1e$2')
    .replace(/(?<![\d.])10\^\{(-?\d+)\}/g, '1e$1')
    .replace(/\\times/g, '*')
    .replace(/\\tfrac12/g, '0.5')
    .replace(/\\mathrm\{e\}\^/g, 'X')
    .replace(/\\Phi\^\{-1\}/g, 'I')
    .replace(/\\sqrt\s*\{/g, 'S{')
    .replace(/\\ln\s*/g, 'L')
    .replace(/\\lfloor/g, 'B(')
    .replace(/\\rfloor/g, ')')
    .replace(/\\min/g, 'm')
    .replace(/\\max/g, 'M')
  for (let i = t.search(/\\[td]?frac/); i >= 0; i = t.search(/\\[td]?frac/)) {
    const a0 = t.indexOf('{', i)
    const a1 = matchBrace(t, a0)
    const b1 = matchBrace(t, a1 + 1)
    t = `${t.slice(0, i)}((${t.slice(a0 + 1, a1)})/(${t.slice(a1 + 2, b1)}))${t.slice(b1 + 1)}`
  }
  t = t.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\s+/g, '')
  if (!/^[0-9.e+\-*/^(),XISLBmM]+$/.test(t) || !/[0-9]/.test(t)) return null
  const ops = new Set<string>()
  let scale = 0
  let pos = 0
  const expr = (): number => {
    let v = term()
    while (t[pos] === '+' || t[pos] === '-') {
      ops.add('add')
      v = t[pos++] === '+' ? v + term() : v - term()
    }
    return v
  }
  const term = (): number => {
    let v = unary()
    while (t[pos] === '*' || t[pos] === '/') {
      ops.add(t[pos] === '*' ? 'mul' : 'div')
      v = t[pos++] === '*' ? v * unary() : v / unary()
    }
    return v
  }
  const unary = (): number => {
    if (t[pos] === '-') return pos++, -unary()
    if (t[pos] === '+') return pos++, unary()
    const base = atom()
    if (t[pos] !== '^') return base
    pos++
    ops.add('pow')
    return base ** (t[pos] === '(' ? atom() : Number(t[pos++]))
  }
  const atom = (): number => {
    const c = t[pos]
    if (c === '(') {
      pos++
      const v = expr()
      if (t[pos++] !== ')') throw new Error(`括號不成對：${seg}`)
      return v
    }
    if (c === 'm' || c === 'M') {
      pos += 2 // 函數名 + '('
      const a = expr()
      if (t[pos++] !== ',') throw new Error(`min／max 要兩個引數：${seg}`)
      const b = expr()
      if (t[pos++] !== ')') throw new Error(`括號不成對：${seg}`)
      ops.add('fn')
      return c === 'm' ? Math.min(a, b) : Math.max(a, b)
    }
    if (c === 'S' || c === 'L' || c === 'X' || c === 'I' || c === 'B') {
      pos++
      const v = atom()
      ops.add('fn')
      return c === 'S' ? Math.sqrt(v) : c === 'L' ? Math.log(v) : c === 'X' ? Math.exp(v) : c === 'I' ? normInv(v) : Math.floor(v)
    }
    const m = /^\d+(?:\.\d+)?(?:e-?\d+)?/.exec(t.slice(pos))
    if (!m) throw new Error(`無法剖析：${seg}（位置 ${pos}：${t}）`)
    pos += m[0].length
    scale = Math.max(scale, Number(m[0]))
    return Number(m[0])
  }
  const v = expr()
  if (pos !== t.length) throw new Error(`無法剖析：${seg}（剩下 ${t.slice(pos)}）`)
  return { v, ops, scale }
}

/** 在最外層（不在大括號裡）的 = 或 \approx 處切開。 */
function splitChain(tex: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of tex.replace(/\\approx/g, '=')) {
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

/** 一步裡可能有好幾條算式（aligned 的各列、「,\qquad」、「⇒」、HC-02.5 排序那一步的「≤」）：拆開成一條一條。 */
function chainsOf(tex: string): string[] {
  return tex
    .replace(/\\begin\{aligned\}|\\end\{aligned\}|&/g, '')
    .replace(/\\ \(\|x\|=[^)]*(?:\([^)]*\))?[^)]*\)/g, '') // HC-02.5 的票數註記「\ (|x|=4)」
    .split(/\\\\ |,\\qquad|\\[;]\\Rightarrow\\[;]|\\ \\le\\ /)
}

/** 顯示成 5 位有效數字會有的捨入：畫面上的數字重新算出來的值，與畫面上的結果相對誤差不超過這個數。 */
const CHAIN_TOL = 1e-4

/**
 * 一條算式「a = b = c」：每一段數字算出來都要等於最後一段。
 * 回傳最後的數字（這一條算式的結果），以及「最後一個等號」左邊那一段用了哪幾種運算。
 */
function checkChain(chain: string, label: string): { final: number; lastOps: Set<string> } | null {
  const nums = splitChain(chain)
    .map((seg) => ({ seg, ev: evalTex(seg) }))
    .filter((x): x is { seg: string; ev: Evaluated } => x.ev !== null)
  if (!nums.length) return null
  const last = nums[nums.length - 1].ev.v
  for (const { seg, ev } of nums.slice(0, -1)) {
    const where = `${label}：「${seg}」照畫面上的數字算是 ${ev.v}，但這一步寫的結果是 ${last}（${chain}）`
    // 結果剛好是 0（完全抵銷）時，寫不完的運算元四捨五入後會剩下一點點：以這一段出現過的最大數字為尺度
    const tol = last === 0 ? CHAIN_TOL * ev.scale : CHAIN_TOL * Math.max(Math.abs(ev.v), Math.abs(last))
    expect(Math.abs(ev.v - last), where).toBeLessThanOrEqual(1e-12 + tol)
  }
  return { final: last, lastOps: nums.length > 1 ? nums[nums.length - 2].ev.ops : new Set() }
}

/**
 * 使用者自己打的數字（不在「換一題」的範圍內）：剛好抵銷成 0、接近抵銷、除不盡、很小／很大（科學記號）、負數。
 * expected：精確算術（紙筆）的答案，只在 IEEE double 的獨立重算會被捨入殘值誤導時才列出。
 */
const USER_CASES: Record<string, { v: Record<string, number>; why: string; expected?: number[] }[]> = {
  'HC-02.1': [
    { v: { a: 3, x: 3, w0: 1, mu: 0.1111 }, why: '幾乎一步到位：18 − 35.9964×0.50005 抵銷掉 8 位' },
    { v: { a: 2.3, x: 10, w0: 0.1, mu: 0.01 }, why: 'Newton 步長：J(w₁) 剛好是 0' },
    { v: { a: 3, x: 2, w0: 1, mu: 0.5 }, why: '穩定邊界：因子 0' },
    { v: { a: 3, x: 2, w0: 1, mu: 0.6 }, why: '成本上升：因子是負的' },
    { v: { a: 3, x: 0.7, w0: -1.3, mu: 0.37 }, why: '一般的小數' },
    { v: { a: 3, x: 2, w0: 2.99999, mu: 0.1 }, why: 'e₀ = 2×10⁻⁵：平方的底數是科學記號' },
    { v: { a: 0.3, x: 3, w0: 0.1, mu: 0.1 }, why: '0.3×3 在 double 裡是 0.8999999999999999' },
    { v: { a: -20, x: -10, w0: 20, mu: 10 }, why: '很大的數（J 超過 10⁶）' },
    { v: { a: 0.7, x: 1, w0: -0.3, mu: 0.3 }, why: 'w₁ = −0.3 + 0.3 剛好是 0' },
    { v: { a: 3, x: 2, w0: 3, mu: 0.1 }, why: '一開始就在谷底' },
    { v: { a: 1.23456, x: 2.34567, w0: 0.24, mu: 0.0553 }, why: '很長的小數（乘積超過 10 位）' },
  ],
  'HC-02.2': [
    { v: { a: 3, x: 1, w0: 0.1, mu: 0.4 }, why: '提示裡的例子' },
    { v: { a: 3, x: -2, w0: 0, mu: 0.4 }, why: '負的 x' },
    { v: { a: 3, x: 1, w0: 5, mu: 0.7 }, why: '從上面往下走；|δ₀|/h 除不盡' },
    { v: { a: 3, x: 1, w0: 2.9, mu: 0.4 }, why: 'n_c = 0：第一步就越過' },
    { v: { a: 0.2, x: 1, w0: -2.8, mu: 0.4 }, why: 'w_lo 剛好是 0（double：2.8×10⁻¹⁶）', expected: [7, 0, 0.4, 0.2] },
    { v: { a: 3, x: 1, w0: 0, mu: 0.23077 }, why: '|δ₀|/h = 12.99996：⌊·⌋ 裡的數不能寫成 13' },
    { v: { a: 2, x: 0.5, w0: 5, mu: 0.8 }, why: 'ρ = h/2：時間平均剛好是 a' },
    { v: { a: 3, x: 0.001, w0: 2.99995, mu: 0.03 }, why: 'h = 3×10⁻⁵：科學記號' },
    { v: { a: -3, x: 1, w0: 0.25, mu: 0.3 }, why: '負的 a' },
  ],
  'HC-02.3': [
    { v: { mu0: 0.01, n0: 10, n: 60, x: 1, D: 3 }, why: '內文的 stall 例子：N ≈ 10¹⁴' },
    { v: { mu0: 0.4, n0: 20, n: 0, x: 1, D: 3 }, why: 'n = 0：ln 1 = 0' },
    { v: { mu0: 0.4, n0: 20, n: 60, x: -2, D: 3 }, why: '負的 x' },
    { v: { mu0: 0.5, n0: 50, n: 10, x: 2, D: 0.01 }, why: 'D/c = 0.0002：eᵗ − 1 抵銷掉 4 位' },
    { v: { mu0: 0.4, n0: 1, n: 3, x: 1, D: 3 }, why: 'N_reach = 1807.04：⌈·⌉ 要看得出是 1808' },
    { v: { mu0: 0.4, n0: 7, n: 60, x: 1, D: 3 }, why: 'n/n₀ 除不盡' },
    { v: { mu0: 0.05, n0: 20, n: 60, x: 1, D: 20 }, why: 'e²⁰：科學記號' },
    { v: { mu0: 0.37, n0: 13, n: 29, x: 0.77, D: 1.9 }, why: '一般的小數' },
  ],
  'HC-02.4': [
    { v: { w: 0.3, x: 3, y: 0.9, mu: 0.1 }, why: 'e 剛好是 0（double：1.1×10⁻¹⁶）', expected: [0.3, 0.3, 0.3] },
    { v: { w: 1, x: 0, y: 6, mu: 0.1 }, why: 'x = 0' },
    { v: { w: 1, x: -2, y: 6, mu: 0.1 }, why: '負的 x' },
    { v: { w: 0.3, x: 1, y: -2.7, mu: 0.1 }, why: 'LMS：0.3 + (−0.3) 剛好是 0', expected: [0, 0.2, 0.2] },
    { v: { w: -0.1, x: 1, y: 5, mu: 0.1 }, why: 'Sign-Error：−0.1 + 0.1 剛好是 0', expected: [0.41, 0, 0] },
    { v: { w: 0.64, x: 0.7, y: 0.448001, mu: 0.35 }, why: 'e = 10⁻⁶（很小，但不是 0）' },
    { v: { w: 1.7, x: 0.3, y: -2.2, mu: 0.07 }, why: '一般的小數' },
    { v: { w: -20, x: -10, y: 100, mu: 5 }, why: '很大的數' },
    { v: { w: 2, x: -3, y: -9, mu: 0.1 }, why: '思考題 6 的數字' },
  ],
  'HC-02.5': [
    { v: { x1: 5, y1: 1, x2: 5, y2: 2, x3: -5, y3: 3 }, why: '三個比值的和剛好是 0', expected: [0, 0.2, 0.2, 0] },
    { v: { x1: 0.1, y1: 3, x2: 0.3, y2: -1, x3: 2, y3: 0 }, why: 'Σxy 剛好是 0（double：5.6×10⁻¹⁷）', expected: [0, 0, 0, (30 - 10 / 3) / 3] },
    { v: { x1: -1, y1: 3, x2: -2, y2: 7, x3: 4, y3: 10 }, why: '負的 x' },
    { v: { x1: 0.3, y1: 0.9, x2: 0.1, y2: 0.2, x3: 0.2, y3: 0.8 }, why: '小數票數：0.1 + 0.3 與 0.6/2 的 double 尾巴', expected: [0.45 / 0.14, 3, 3, 3] },
    { v: { x1: 3, y1: 10, x2: 3, y2: -9.75, x3: 3, y3: 0.3 }, why: '除不盡的比值相加後抵銷' },
    { v: { x1: 1, y1: 3, x2: 2, y2: 7, x3: 4, y3: 100 }, why: 'outlier' },
    { v: { x1: 0.00005, y1: 2, x2: 0.00002, y2: -3, x3: 1, y3: 1 }, why: '科學記號的 x' },
    { v: { x1: 2, y1: 6, x2: 1, y2: 3, x3: 1, y3: 5 }, why: '兩個比值相同' },
  ],
  'HC-02.6': [
    { v: { a: 3, A: 1, sigma: 0.3, p: 0, s: 20 }, why: '沒有突波' },
    { v: { a: 3, A: -1, sigma: 0.3, p: 0.05, s: 20 }, why: '負的 A：兩個固定點都往下偏' },
    { v: { a: 3, A: 1, sigma: 0.3, p: 0.3, s: 20 }, why: '機率上限' },
    { v: { a: 3, A: 1, sigma: 0.3, p: 0.05, s: 1.8 }, why: 's 剛好是 6σ_v' },
    { v: { a: 3, A: 2, sigma: 1, p: 0.2, s: 10 }, why: '一般' },
    { v: { a: 3, A: 1, sigma: 0.3, p: 0.001, s: 20 }, why: 'q − ½ = 0.0005：q 要多留 3 位' },
    { v: { a: -3, A: 0.5, sigma: 2, p: 0.15, s: 40 }, why: '負的 a' },
    { v: { a: 0, A: 1, sigma: 0.3, p: 0.05, s: 20 }, why: 'a = 0' },
    { v: { a: 3, A: 0.001, sigma: 0.3, p: 0.05, s: 20 }, why: '很小的 A：偏移很大' },
  ],
  'HC-02.7': [
    { v: { w: 0.1, x: 0.3, y: 0.7, mut: 1, eps: 0 }, why: 'μ̃ = 1：e⁺ 剛好是 0，w₁ = 7/3 除不盡', expected: [1 / 0.09, 7 / 3, 0] },
    { v: { w: 0, x: 3, y: 1, mut: 1, eps: 0 }, why: 'w₁ = 1/3', expected: [1 / 9, 1 / 3, 0] },
    { v: { w: 0, x: 4, y: 11, mut: 1, eps: 0.5 }, why: '11 − 2.6667×4：相減吃掉 2 位' },
    { v: { w: 1, x: 0, y: 6, mut: 0.4, eps: 1 }, why: 'x = 0 配 ε > 0' },
    { v: { w: 0.3, x: 3, y: 0.9, mut: 0.5, eps: 0 }, why: 'e 剛好是 0', expected: [0.5 / 9, 0.3, 0] },
    { v: { w: 1, x: 2, y: 6, mut: 2.5, eps: 0 }, why: 'μ̃ 太大' },
    { v: { w: 1, x: 20, y: 60, mut: 0.4, eps: 0 }, why: '提示裡的例子' },
    { v: { w: 1, x: -2, y: 6, mut: 0.4, eps: 1 }, why: '負的 x' },
    { v: { w: 1, x: 0.001, y: 6, mut: 0.4, eps: 0 }, why: 'x² = 10⁻⁶：科學記號當除數' },
    { v: { w: -1, x: 4, y: -8, mut: 1.5, eps: 1 }, why: '一般' },
    { v: { w: -2, x: 1, y: 3, mut: 0.4, eps: 0 }, why: 'w₁ = −2 + 2 剛好是 0', expected: [0.4, 0, 3] },
  ],
  'HC-02.8': [
    { v: { sigma: 0.5, A: -1, mu: 0.02 }, why: '負的 A' },
    { v: { sigma: 0.5, A: 1, mu: 0.3133 }, why: 'g = 0.49996：適用範圍的上限（p ≈ 0.5）' },
    { v: { sigma: 1, A: 0.25, mu: 6 }, why: '帶寬 μ|x| = 1.5 > σ_v，但 comparator 輸入端的跳動 μx² = 0.375 < σ_v（g = 0.299）：線性化適用' },
    { v: { sigma: 0.5, A: 2, mu: 0.05 }, why: 'g = 0.319：速算式 τ ≈ 1/g − ½ 不適用' },
    { v: { sigma: 2, A: 0.5, mu: 0.01 }, why: 'g = 0.001：ln 的引數很接近 1' },
    { v: { sigma: 10, A: 1, mu: 0.001 }, why: 'g = 8×10⁻⁵：科學記號' },
    { v: { sigma: 0.5, A: 1, mu: 0.0629 }, why: 'g = 0.10037：p 要多寫一位，上游跟著多留' },
    { v: { sigma: 0.3, A: 0.7, mu: 0.013 }, why: '一般的小數' },
    { v: { sigma: 1000, A: 100, mu: 0.00001 }, why: '很大的 σ_v 與 A' },
    { v: { sigma: 0.07, A: 0.3, mu: 0.11 }, why: '很小的 σ_v 與 A' },
  ],
}

describe('畫面上的算式自己算得出來：每個等號只做一種運算，數字前後一致', () => {
  it('evalTex：負數、科學記號、分數、次方、√、ln、eˣ、Φ⁻¹、⌊⌋、min／max', () => {
    const val = (tex: string) => evalTex(tex)?.v
    expect(val(String.raw`-0.1\times(-8)^2`)).toBeCloseTo(-6.4, 12)
    expect(val(String.raw`\tfrac12\times(2\times10^{-5})^2`)).toBeCloseTo(2e-10, 22)
    expect(val(String.raw`-10^{-6}`)).toBe(-1e-6)
    expect(val(String.raw`\tfrac{0.1}{2}\times4`)).toBeCloseTo(0.2, 12)
    expect(val(String.raw`\frac{-1}{\ln(0.968085)}`)).toBeCloseTo(-1 / Math.log(0.968085), 12)
    expect(val(String.raw`20\times(\mathrm{e}^{0.375}-1)`)).toBeCloseTo(20 * Math.expm1(0.375), 10)
    expect(val(String.raw`\sqrt{0.0063682}`)).toBeCloseTo(Math.sqrt(0.0063682), 12)
    expect(val(String.raw`\Phi^{-1}(0.526316)`)).toBeCloseTo(normInv(0.526316), 12)
    expect(val(String.raw`\Big\lfloor\frac{3}{0.4}\Big\rfloor`)).toBe(7)
    expect(val(String.raw`\min(3.6,\ 2.9)`)).toBe(2.9)
    expect(val(String.raw`3-(+1)\times0.2`)).toBeCloseTo(2.8, 12)
    expect(val(String.raw`8-(-2.88)`)).toBeCloseTo(10.88, 12)
    // 含符號的片段不求值
    for (const sym of [String.raw`w_0+\Delta w`, String.raw`\frac{|\delta_0|}{h}`, String.raw`r_{(2)}`, String.raw`\text{累積票數：}4,\ 5,\ 7`]) expect(evalTex(sym)).toBeNull()
    // 運算種類
    expect([...evalTex(String.raw`8-6.4\times0.8`)!.ops].sort()).toEqual(['add', 'mul'])
    expect([...evalTex(String.raw`10\times(1.0686\times10^{13})`)!.ops]).toEqual(['mul'])
    expect([...evalTex(String.raw`\tfrac12\times16`)!.ops]).toEqual(['mul'])
    // 檢查本身要抓得到錯：舊版的「11 − 2.6667×4 = 0.33333」（相減吃掉兩位）會被判為不一致
    expect(() => checkChain(String.raw`e^+=y-w_1\,x=11-2.6667\times4=0.33333`, '反例')).toThrow()
    expect(() => checkChain(String.raw`\tau=\frac{-1}{\ln(0.999)}=\frac{-1}{-0.00099785}=1002.2`, '反例')).toThrow()
    expect(checkChain(String.raw`e^+=y-w_1\,x=11-2.666667\times4=11-10.66667=0.33333`, '正例')!.final).toBe(0.33333)
  })

  it.each(HANDCALCS.map((h) => [h.id, h] as const))(
    '%s：每一步重新求值後前後一致；每個答案都是某一步的結果；最後一個等號只做一種運算（預設值、20 組隨機數字、使用者自己打的數字）',
    (_id, def) => {
      const cases = [defaultValues(def), ...Array.from({ length: 20 }, (_, k) => randomValues(def, k + 1)), ...USER_CASES[def.id].map((c) => c.v)]
      for (const v of cases) {
        const label = `${def.id} ${JSON.stringify(v)}`
        def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${label} ${i.key}`).toBeNull())
        expect(def.validate?.(v) ?? null, label).toBeNull()
        const sol = def.solve(v)
        const finals: number[] = []
        let chains = 0
        sol.steps.forEach((st, k) => {
          for (const chain of chainsOf(st.tex)) {
            const r = checkChain(chain, `${label} 第 ${k + 1} 步`)
            if (!r) continue
            chains++
            finals.push(r.final)
            // 最後一個等號的左邊只剩一種運算：一次（或同一種連做兩次的）加減、乘、除、次方，或按一次函數鍵
            expect([...r.lastOps].length, `${label} 第 ${k + 1} 步的最後一個等號同時做了 ${[...r.lastOps].join('＋')}：${chain}`).toBeLessThanOrEqual(1)
          }
        })
        expect(chains, label).toBeGreaterThanOrEqual(sol.steps.length - 2) // 幾乎每一步都有可驗算的數字（純符號的步驟最多兩步）
        for (const r of sol.results) {
          expect(Number.isFinite(r.value), `${label} ${r.symbol}`).toBe(true)
          const hit = finals.some((f) => Math.abs(f - r.value) <= 1e-9 + CHAIN_TOL * Math.max(Math.abs(f), Math.abs(r.value)))
          expect(hit, `${label}：答案 ${r.symbol} = ${r.value} 不是任何一步的結果（各步結果：${finals.join(', ')}）`).toBe(true)
        }
      }
    },
    T_RENDER,
  )

  it('使用者自己打的數字：答案等於獨立重算（或精確算術的答案）；沒有 KaTeX 錯誤、NaN、浮點殘值；說明文字的數學都是 $…$', () => {
    for (const def of HANDCALCS) {
      expect(USER_CASES[def.id].length, def.id).toBeGreaterThanOrEqual(8)
      for (const { v, why, expected } of USER_CASES[def.id]) {
        const label = `${def.id} ${JSON.stringify(v)}（${why}）`
        const sol = def.solve(v)
        const want = expected ?? INDEPENDENT[def.id](v)
        const scale = Math.max(1, ...Object.values(v).map(Math.abs))
        expect(sol.results.length, label).toBe(want.length)
        sol.results.forEach((r, k) => {
          expectClose(r.value, want[k], `${label} ${r.symbol}`, 1e-7, 1e-12 * scale ** 3)
          expect(checkAnswer(want[k], r).ok, `${label} ${r.symbol}：正確答案要能通過「對答案」`).toBe(true)
        })
        for (const st of sol.steps) {
          expect(renderTex(st.tex, true), `${label}: ${st.tex}`).not.toMatch(/katex-error|c-tex-error/)
          expect(st.tex, label).not.toMatch(/NaN|undefined|Infinity/)
          expect(BARE_MACRO.test(stripText(st.tex)), st.tex).toBe(false)
          expectCleanMathString(st.why, `${label} why`)
        }
        for (const n of sol.notes ?? []) expectCleanMathString(n, `${label} note`)
        for (const r of sol.results) expect(renderTex(String.raw`\boxed{${r.symbol} = ${tx(r.value, r.digits ?? 5)}}`, true), label).not.toMatch(/katex-error|c-tex-error/)
        expectNoFloatResidue(sol, label)
      }
    }
  }, T_ALL)

  it('使用者自己打的數字在畫面上完整渲染（每題挑抵銷最嚴重的兩組）', () => {
    for (const def of HANDCALCS) {
      for (const { v } of USER_CASES[def.id].slice(0, 2)) {
        const { container, unmount } = render(<HandCalc def={{ ...def, inputs: def.inputs.map((i) => ({ ...i, default: v[i.key] })) }} />)
        const label = `${def.id} ${JSON.stringify(v)}`
        expectNoTexErrors(container, label)
        expect(container.querySelectorAll('.c-step').length, label).toBe(def.solve(v).steps.length)
        expect(unicodeMath(container), label).toEqual([])
        unmount()
      }
    }
  }, T_ALL)

  it('相減會吃掉有效位數的地方多顯示幾位：HC-02.7 的 y − w₁x、HC-02.8 的 1 − g 與 ln p、HC-02.3 的 eᵗ − 1、HC-02.6 的 q − ½', () => {
    const texOf = (id: string, v: Record<string, number>) => byId(id).solve(v).steps.map((st) => st.tex)
    // HC-02.7：11 − 2.6667×4 用畫面上的數字算是 0.3332；多留兩位才是 0.33333
    const t7 = texOf('HC-02.7', { w: 0, x: 4, y: 11, mut: 1, eps: 0.5 })
    expect(t7[6]).toBe(String.raw`e^+=y-w_1\,x=11-2.666667\times4=11-10.66667=0.33333`)
    expect(t7[3]).toContain('=0.06060606') // 上游的 μ_eff 也跟著多留
    // 預設值不受影響（寫得完的數照原樣）
    expect(texOf('HC-02.7', defaultValues(byId('HC-02.7')))[6]).toBe(String.raw`e^+=y-w_1\,x=6-1.8\times2=6-3.6=2.4`)
    // HC-02.8：p 寫到和 g 同一個小數位，ln 才按得出同樣的數
    const t8 = texOf('HC-02.8', defaultValues(byId('HC-02.8')))
    expect(t8[5]).toBe(String.raw`p=1-g=1-0.031915=0.968085`)
    expect(t8[6]).toBe(String.raw`\tau=\frac{-1}{\ln|p|}=\frac{-1}{\ln(0.968085)}=\frac{-1}{-0.032436}=30.83`)
    expect(-1 / Math.log(0.968085)).toBeCloseTo(30.83, 2)
    expect(Math.abs(-1 / Math.log(0.96808) - 30.830150498558655)).toBeGreaterThan(0.004) // 只寫 5 位的 p 會差到第 4 位
    const t8s = texOf('HC-02.8', { sigma: 2, A: 0.5, mu: 0.01 })
    expect(t8s[5]).toBe(String.raw`p=1-g=1-0.00099736=0.99900264`)
    // g = 0.10037：ln p 要 5 位有效數字 ⇒ p 寫到小數第 6 位，g 與上游（√(2/π)、K_q、K_SE）跟著多留一位，畫面上的數字才能一路乘到 p
    const t8n = texOf('HC-02.8', { sigma: 0.5, A: 1, mu: 0.0629 })
    expect(t8n[0]).toBe(String.raw`\sqrt{\tfrac{2}{\pi}}=\sqrt{0.63662}=0.797885`)
    expect(t8n[4]).toBe(String.raw`g=\mu\,K_{\rm SE}=0.0629\times1.59577=0.100374`)
    expect(t8n[5]).toBe(String.raw`p=1-g=1-0.100374=0.899626`)
    // 15 步；說明文字裡提到的步數（第 3 步算 E[x⁴]、第 13 步用到）要對得上
    expect(t8.length).toBe(15)
    expect(t8[2]).toContain('E[x^4]')
    expect(t8[12].startsWith('2E[x^2]')).toBe(true)
    expect(byId('HC-02.8').tips!.join(' ')).toContain('15 步')
    // HC-02.3：e^{0.0002} 要寫 9 位，減 1 之後才有 5 位
    const t3 = texOf('HC-02.3', { mu0: 0.5, n0: 50, n: 10, x: 2, D: 0.01 })
    expect(t3[7]).toBe(String.raw`\mathrm{e}^{D/c}=\mathrm{e}^{0.0002}=1.00020002`)
    expect(t3[8]).toContain(String.raw`=50\times(1.00020002-1)=50\times0.00020002=0.010001`)
    expect(texOf('HC-02.3', defaultValues(byId('HC-02.3')))[8]).toContain(String.raw`=20\times(1.45499-1)=20\times0.45499=9.0998`)
    // N_reach = 1807.04：寫成 1807 的話「⌈N_reach⌉ = 1808」就對不起來
    expect(texOf('HC-02.3', { mu0: 0.4, n0: 1, n: 3, x: 1, D: 3 })[8]).toContain(String.raw`=1\times(1808.04-1)=1\times1807.04=1807.04`)
    // HC-02.6：q − ½
    const t6 = texOf('HC-02.6', defaultValues(byId('HC-02.6')))
    expect(t6[5]).toContain(String.raw`=\frac{1}{1.9}=0.526316`)
    expect(t6[6]).toBe(String.raw`t=\sqrt{2\pi}\,\big(q-\tfrac12\big)=2.50663\times(0.526316-0.5)=2.50663\times0.026316=0.065964`)
    expect(t6[7]).toBe(String.raw`z=\Phi^{-1}(q)=\Phi^{-1}(0.526316)=0.066012`)
    expect(Math.abs(normInv(0.52632) - 0.066012)).toBeGreaterThan(5e-6) // 只寫 5 位的 q 查出來的 z 會差到第 4 位
    expect(t6[10]).toBe(String.raw`w^*_{\rm SE}=a+\frac{\operatorname{med}(v)}{A}=3+0.019804=3.019804`)
    // HC-02.1：幾乎一步到位
    expect(texOf('HC-02.1', { a: 3, x: 3, w0: 1, mu: 0.1111 })[11]).toContain(String.raw`=18-35.9964\times0.50005=18-17.99999982=1.8\times10^{-7}`)
    // HC-02.2：⌊12.99996⌋ = 12（寫成 ⌊13⌋ 就錯了）
    expect(texOf('HC-02.2', { a: 3, x: 1, w0: 0, mu: 0.23077 })[2]).toContain(String.raw`\lfloor12.99996\rfloor=12`)
  })

  it('負數與科學記號在乘號、次方旁邊都有括號（不會讀錯，也不會讓 KaTeX 出現 double superscript）', () => {
    const t1 = byId('HC-02.1').solve({ a: 3, x: 2, w0: 2.99999, mu: 0.1 }).steps.map((st) => st.tex)
    expect(t1[2]).toBe(String.raw`J(w_0)=\tfrac12e_0^2=\tfrac12\times(2\times10^{-5})^2=\tfrac12\times(4\times10^{-10})=2\times10^{-10}`)
    expect(t1[4]).toBe(String.raw`\Delta w=-\mu\,J'(w_0)=-0.1\times(-4\times10^{-5})=4\times10^{-6}`)
    for (const st of t1) expect(st).not.toMatch(/\^\{-?\d+\}\^/) // 10^{-5}^2
    const t4 = byId('HC-02.4').solve({ w: 1, x: -2, y: 6, mu: 0.1 }).steps.map((st) => st.tex)
    expect(t4[0]).toBe(String.raw`e=y-w\,x=6-1\times(-2)=6-(-2)=8`)
    expect(t4[2]).toBe(String.raw`\Delta w_{\rm LMS}=\mu\,e\,x=0.1\times8\times(-2)=0.8\times(-2)=-1.6`)
    const t5 = byId('HC-02.5').solve({ x1: -1, y1: 3, x2: -2, y2: 7, x3: 4, y3: 10 }).steps.map((st) => st.tex)
    expect(t5[2]).toContain(String.raw`(-1)^2+(-2)^2+4^2=1+4+16=21`)
  })
})

describe('handcalcTex：顯示用的小工具', () => {
  it('sigDigits／isShort：寫得完的小數（去掉 double 尾巴後）與寫不完的數', () => {
    expect(sigDigits(0.1 + 0.2)).toBe(1)
    expect(sigDigits(3 - 2.8000000000000003)).toBe(1)
    expect(sigDigits(3.09375)).toBe(6)
    expect(sigDigits(17.99999982)).toBe(10)
    expect(sigDigits(0)).toBe(1)
    expect(sigDigits(1 / 3)).toBe(14)
    for (const x of [0.5, -1.6, 123456.789, 1e-5, 2.999994]) expect(isShort(x), String(x)).toBe(true)
    for (const x of [1 / 3, Math.SQRT2, Math.log(4), 57 / 21, Math.PI]) expect(isShort(x), String(x)).toBe(false)
  })

  it('tx：寫得完的整個寫出、寫不完的四捨五入；txP／txSq 在需要的地方加括號', () => {
    expect(tx(3.09375)).toBe('3.09375') // texNum 會給 3.0938
    expect(tx(0.1 + 0.2)).toBe('0.3')
    expect(tx(57 / 21)).toBe('2.7143')
    expect(tx(57 / 21, 7)).toBe('2.714286')
    expect(tx(1 / 3, 99)).toBe('0.333333333333') // 最多 12 位
    expect(tx(2e-5)).toBe(String.raw`2\times10^{-5}`)
    expect(tx(1e-6)).toBe('10^{-6}')
    expect(tx(-39980)).toBe('-39980')
    expect(tx(0)).toBe('0')
    expect(tx(Infinity)).toBe(String.raw`\infty`)
    expect(txP(-3)).toBe('(-3)')
    expect(txP(2)).toBe('2')
    expect(txP(2e-5)).toBe(String.raw`(2\times10^{-5})`)
    expect(txP(1e-6)).toBe('10^{-6}')
    expect(txSq(-0.3)).toBe('(-0.3)^2')
    expect(txSq(2e-5)).toBe(String.raw`(2\times10^{-5})^2`)
    expect(txSq(1e-6)).toBe('(10^{-6})^2')
    expect(txSq(4)).toBe('4^2')
    for (const tex of [txSq(2e-5), txSq(1e-6), txSq(-0.3), `2\\times${txP(-4e-5)}`]) expect(renderTex(tex, true)).not.toMatch(/katex-error/)
  })

  it('sigFor／decimalsFor／sigAt：相減的運算元要寫到和結果同一個小數位', () => {
    expect(sigFor(1 / 3, 11, 32 / 3)).toBe(7) // 11 − 10.66667 = 0.33333
    expect(sigFor(Math.expm1(0.375), Math.exp(0.375), 1)).toBe(6) // 1.45499 − 1
    expect(sigFor(2 - 0.031915, 2, 0.031915)).toBe(5) // 沒有抵銷：不必多寫
    expect(sigFor(4, 6, 2)).toBe(5)
    expect(sigFor(0, 0.7, 0.7)).toBe(5) // 剛好抵銷：運算元照平常顯示
    expect(sigFor(1.8e-7, 18, 17.99999982)).toBe(13)
    expect(decimalsFor(0.031915)).toBe(6)
    expect(decimalsFor(1.5958)).toBe(4)
    expect(decimalsFor(12345)).toBe(0)
    expect(sigAt(0.968085, 6)).toBe(6)
    expect(sigAt(3.0198, 6)).toBe(7)
    expect(sigAt(0.00099736, 8)).toBe(5)
  })

  it('txInt／sigRoundArg／txRoundArg／resultDigits', () => {
    expect(txInt(123457)).toBe('123457') // texNum 會給 123460
    expect(txInt(7)).toBe('7')
    expect(txRoundArg(7.5, 7, 'floor')).toBe('7.5')
    expect(txRoundArg(3 / 0.23077, 12, 'floor')).toBe('12.99996')
    expect(Math.floor(Number(tx(3 / 0.23077)))).toBe(13) // 5 位的話會寫成 13
    expect(sigRoundArg(1807.0424144560632, 1808, 'ceil')).toBe(6)
    expect(sigRoundArg(9.0998, 10, 'ceil')).toBe(5)
    expect(txRoundArg(40 / 3, 13, 'floor')).toBe('13.333')
    expect(resultDigits(3.09375)).toBe(6)
    expect(resultDigits(1.8)).toBe(5)
    expect(resultDigits(57 / 21)).toBe(5)
  })

  it('zsum：加減的結果相對於運算元只剩捨入殘值時是 0', () => {
    expect(zsum(-0.3 + 0.30000000000000004, -0.3, 0.3)).toBe(0)
    expect(zsum(0.2 - 0.19999999999999973, 0.2, 0.2)).toBe(0)
    expect(zsum(1e-9, 1, 1)).toBe(1e-9) // 真的很小但不是殘值
    expect(zsum(1.8, 1, 0.8)).toBe(1.8)
  })
})

describe('單位：提示裡的量綱說明與更新式一致', () => {
  it('把 x 放大 c 倍、y 放大 d 倍：w 的單位是 [y]/[x]；要得到「同一個物理更新」，LMS／Sign-Error／Sign-Sign 的 μ 分別要乘 1/c²、d/c²、d/c', () => {
    const base = { w: 1, x: 2, y: 6, mu: 0.1 }
    const c = 10 // [x] 的換算
    const d = 1000 // [y] 的換算
    const wScale = d / c // [w] = [y]/[x]
    const scaled = (mu: number) => ({ w: base.w * wScale, x: base.x * c, y: base.y * d, mu })
    const l0 = conventionalStep(base)
    const s0 = signErrorStep({ ...base, tie: 'zero' })
    const ss0 = signSignStep({ ...base, tie: 'zero' })
    // LMS：μ 的單位 1/[x]²
    expectClose(conventionalStep(scaled(base.mu / c ** 2)).w, l0.w * wScale, 'LMS', 1e-12)
    // Sign-Error：μ 的單位 [w]/[x] = [y]/[x]²
    expectClose(signErrorStep({ ...scaled((base.mu * d) / c ** 2), tie: 'zero' }).w, s0.w * wScale, 'Sign-Error', 1e-12)
    // Sign-Sign：μ 的單位 [w] = [y]/[x]
    expectClose(signSignStep({ ...scaled(base.mu * wScale), tie: 'zero' }).w, ss0.w * wScale, 'Sign-Sign', 1e-12)
    const tip4 = byId('HC-02.4').tips!.join(' ')
    expect(tip4).toContain(String.raw`LMS 是 $1/[x]^2$、Sign-Error 是 $[w]/[x]$、Sign-Sign 是 $[w]$`)
    // HC-02.8：g = μK_SE 無因次——同樣的換算下（σ_v ∝ [y]、A ∝ [x]、μ ∝ [y]/[x]²）g、p、τ 不變，σ_w 跟著 [w] 走
    const d8 = byId('HC-02.8')
    const r0 = d8.solve({ sigma: 0.5, A: 1, mu: 0.02 }).results.map((r) => r.value)
    const r1 = d8.solve({ sigma: 0.5 * d, A: 1 * c, mu: (0.02 * d) / c ** 2 }).results.map((r) => r.value)
    expectClose(r1[1], r0[1], 'pole', 1e-12)
    expectClose(r1[2], r0[2], 'tau', 1e-9)
    expectClose(r1[3], r0[3] * wScale, 'sigma_w', 1e-9)
    expectClose(r1[0], (r0[0] * c ** 2) / d, 'K_SE 的單位 [x]²/[y]', 1e-12)
    expect(d8.tips!.join(' ')).toContain(String.raw`$g=\mu K_{\rm SE}$ 與 $p$ 無因次`)
  })
})

describe('HC-02.8 的適用範圍：Sign-Error 線性化在 g = μK_SE 多大時還準（Monte Carlo 對照）', () => {
  /** 用 lms.ts 的 signErrorStep 實際跑 x = ±A、Gaussian 雜訊的 Sign-Error（a = 0），回傳穩態 std 與 lag-1 自相關。 */
  function simulate(sigma: number, A: number, mu: number, steps: number, seed: number) {
    const rng = createRng(seed)
    let w = 0
    let s1 = 0
    let s2 = 0
    let sLag = 0
    let n = 0
    const burn = Math.floor(steps / 10)
    for (let k = 0; k < steps; k++) {
      const x = A * rng.sign()
      const next = signErrorStep({ w, x, y: sigma * rng.normal(), mu, tie: 'plus' }).w
      if (k >= burn) {
        s1 += next
        s2 += next * next
        sLag += next * w
        n++
      }
      w = next
    }
    const mean = s1 / n
    const variance = s2 / n - mean * mean
    return { std: Math.sqrt(variance), lag1: (sLag / n - mean * mean) / variance }
  }
  const c0 = Math.sqrt(2 / Math.PI)
  /** 給定 g，回傳線性化預測（網站的 predictSteadyState）與 Monte Carlo 的相對差：pred/MC − 1 */
  function overshoot(g: number, sigma: number, A: number, seed: number) {
    const mu = (g * sigma) / (c0 * A * A)
    const inp = bpskModel(A, sigma)
    const mf = meanFieldAnalysis('sign_error', inp)
    const pred = predictSteadyState(mf, mu, inp)
    expectClose(mu * mf.K, g, 'g', 1e-9)
    const mc = simulate(sigma, A, mu, 1_500_000, seed)
    return { err: pred.std / mc.std - 1, pole: pred.pole, lag1: mc.lag1 }
  }

  it('g = 0.1／0.2／0.5／1：公式高估 σ_w 約 0.6%／1.5%／5%／18%（備註、§5 內文與 validate 訊息引用的數字）；只和 g 有關，和 A 無關', () => {
    const at = (g: number, sigma = 0.5, A = 1) => overshoot(g, sigma, A, 20261010)
    const e01 = at(0.1)
    const e02 = at(0.2)
    const e05 = at(SE_LINEAR_MAX_G)
    const e10 = at(1)
    expect(e01.err).toBeGreaterThan(-0.003)
    expect(e01.err).toBeLessThan(0.01) // 「不到 1%」
    expect(e02.err).toBeGreaterThan(0.008)
    expect(e02.err).toBeLessThan(0.02) // 「不到 2%」「約 1.5%」
    expect(e05.err).toBeGreaterThan(0.04)
    expect(e05.err).toBeLessThan(0.065) // 「約 5%」
    expect(e10.err).toBeGreaterThan(0.15)
    expect(e10.err).toBeLessThan(0.21) // 「約 18%」
    // 同一個 g、不同的 A 與 σ_v（帶寬 μ|x| 與 σ_v 的比值差 4 倍）：誤差相同 ⇒ 決定準確度的是 g（μx²/σ_v），不是 μ|x|/σ_v
    const wide = overshoot(0.5, 1, 2, 7) // μ|x|/σ_v = 0.313
    const narrow = overshoot(0.5, 1, 0.5, 7) // μ|x|/σ_v = 1.25
    expect(Math.abs(wide.err - e05.err)).toBeLessThan(0.01)
    expect(Math.abs(narrow.err - e05.err)).toBeLessThan(0.01)
    // 「實際殘留的比例比 p = 1 − g 略靠近 1」：穩態抖動的 lag-1 自相關大於線性化的 pole
    for (const r of [e02, e05, e10]) expect(r.lag1).toBeGreaterThan(r.pole + 0.01)
    expect(e01.lag1).toBeGreaterThan(e01.pole)
    expect(e01.lag1 - e01.pole).toBeLessThan(0.01)
  }, T_RENDER)

  it('validate 的門檻就是 SE_LINEAR_MAX_G；預設值（g = 0.032）遠在範圍內；「換一題」的每個組合都通過同一個門檻', () => {
    const d = byId('HC-02.8')
    expect(SE_LINEAR_MAX_G).toBe(0.5)
    const muAt = (g: number) => (g * 0.5) / c0 // σ_v = 0.5、A = 1
    expect(d.validate!({ sigma: 0.5, A: 1, mu: muAt(0.499) })).toBeNull()
    expect(d.validate!({ sigma: 0.5, A: 1, mu: muAt(0.501) })).toMatch(/小步長假設/)
    const g0 = 0.02 * d.solve(defaultValues(d)).results[0].value
    expect(g0).toBeCloseTo(0.0319, 4)
    // 舊的判準「μ|x| ≤ σ_v」量綱不對：下面兩組它會判反
    expect(d.validate!({ sigma: 1, A: 0.25, mu: 6 })).toBeNull() // μ|x| = 1.5 > σ_v，但 g = 0.299：線性化適用
    expect(d.validate!({ sigma: 1, A: 4, mu: 0.1 })).not.toBeNull() // μ|x| = 0.4 < σ_v，但 g = 1.28：線性化不適用
    const sols = Array.from({ length: 20 }, (_, k) => randomValues(d, k + 1))
    for (const v of sols) expect(v.mu * d.solve(v).results[0].value, JSON.stringify(v)).toBeLessThanOrEqual(SE_LINEAR_MAX_G)
    // 備註印出這一題的 μx² 與 g
    const note = d.solve(defaultValues(d)).notes![0]
    expect(note).toContain(String.raw`\mu x^2=0.02$`)
    expect(note).toContain(String.raw`g=0.0319$`)
  })
})

describe('(c) validate：模型不適用的輸入要被擋下，並說明原因', () => {
  const cases: [string, Record<string, number>, RegExp][] = [
    ['HC-02.1', { a: 3, x: 0, w0: 1, mu: 0.1 }, /不含 \$a\$ 的資訊/],
    ['HC-02.1', { a: 3, x: 2, w0: 1, mu: 0 }, /必須大於 0/],
    ['HC-02.2', { a: 3, x: 0, w0: 0, mu: 0.4 }, /永遠不動/],
    ['HC-02.2', { a: 3, x: 1, w0: 0, mu: 0 }, /必須大於 0/],
    ['HC-02.2', { a: 3, x: 1, w0: 1, mu: 0.2 }, /剛好踩到.*E40/], // 內文手算例（|δ₀|/h = 10）
    ['HC-02.2', { a: 3, x: 1, w0: 0.2, mu: 0.4 }, /剛好踩到/], // 思考題 3（|δ₀|/h = 7）
    ['HC-02.2', { a: 3, x: 2, w0: 3, mu: 0.4 }, /剛好踩到/], // 一開始就在 a
    ['HC-02.3', { mu0: 0, n0: 20, n: 60, x: 1, D: 3 }, /必須大於 0/],
    ['HC-02.3', { mu0: 0.4, n0: 20, n: 60, x: 0, D: 3 }, /永遠走不到/],
    ['HC-02.3', { mu0: 0.4, n0: 20, n: 60, x: 1, D: 0 }, /必須大於 0/],
    ['HC-02.3', { mu0: 0.001, n0: 10, n: 60, x: 1, D: 3 }, /stall/],
    ['HC-02.4', { w: 1, x: 2, y: 6, mu: 0 }, /必須大於 0/],
    ['HC-02.5', { x1: 0, y1: 3, x2: 2, y2: 7, x3: 4, y3: 10 }, /x_1=0/],
    ['HC-02.5', { x1: 1, y1: 3, x2: 2, y2: 7, x3: 0, y3: 10 }, /x_3=0/],
    ['HC-02.5', { x1: 3, y1: 3, x2: 1, y2: 7, x3: 2, y3: 10 }, /整段區間/], // r = 1, 7, 5；|x| = 3 剛好是總票數 6 的一半
    ['HC-02.6', { a: 3, A: 0, sigma: 0.3, p: 0.05, s: 20 }, /不可辨識/],
    ['HC-02.6', { a: 3, A: 1, sigma: 0, p: 0.05, s: 20 }, /必須大於 0/],
    ['HC-02.6', { a: 3, A: 1, sigma: 0.3, p: 0.5, s: 20 }, /超過一半/],
    ['HC-02.6', { a: 3, A: 1, sigma: 0.3, p: 0.4, s: 20 }, /誤差變大/],
    ['HC-02.6', { a: 3, A: 1, sigma: 0.3, p: 0.05, s: 1 }, /不夠遠/],
    ['HC-02.7', { w: 1, x: 0, y: 6, mut: 0.4, eps: 0 }, /0\/0/],
    ['HC-02.7', { w: 1, x: 2, y: 6, mut: 0, eps: 0 }, /必須大於 0/],
    ['HC-02.8', { sigma: 0, A: 1, mu: 0.02 }, /limit cycle/],
    ['HC-02.8', { sigma: 0.5, A: 0, mu: 0.02 }, /不可辨識/],
    ['HC-02.8', { sigma: 0.5, A: 1, mu: 0 }, /必須大於 0/],
    ['HC-02.8', { sigma: 0.5, A: 1, mu: 0.6 }, /小步長假設/], // g = 0.957
    ['HC-02.8', { sigma: 1, A: 3, mu: 0.3 }, /小步長假設/], // g = 2.15
    ['HC-02.8', { sigma: 1, A: 4, mu: 0.1 }, /\\mu x\^2=1\.6.*小步長假設/], // 帶寬 μ|x| = 0.4 < σ_v，但 comparator 輸入端的跳動 μx² = 1.6 > σ_v（g = 1.28）
    ['HC-02.8', { sigma: 0.5, A: 2, mu: 0.1 }, /g=\\mu K_\{\\rm SE\}=0\.6383>0\.5/], // g = 0.638：線性化誤差超過 5%
  ]
  it.each(cases)('%s 拒絕 %j', (id, v, re) => {
    const msg = byId(id).validate!(v)
    expect(msg, `${id} ${JSON.stringify(v)}`).toMatch(re)
    expectCleanMathString(msg!.replace(/Infinity/g, ''), `${id} validate`)
  })

  it('合法但特殊的輸入不被擋：e = 0（sign(0) 備註）、x = 0 配 ε > 0、μ 超過穩定上限、p_out = 0', () => {
    const e0 = byId('HC-02.4').solve({ w: 3, x: 2, y: 6, mu: 0.1 })
    expect(e0.results.map((r) => r.value)).toEqual([3, 3, 3])
    expect(e0.notes!.join(' ')).toMatch(/E40/)
    expect(byId('HC-02.7').validate!({ w: 1, x: 0, y: 6, mut: 0.4, eps: 1 })).toBeNull()
    expect(byId('HC-02.7').solve({ w: 1, x: 0, y: 6, mut: 0.4, eps: 1 }).results[1].value).toBe(1)
    const over = byId('HC-02.1').solve({ a: 3, x: 2, w0: 1, mu: 0.6 })
    expect(over.results[2].value).toBeGreaterThan(8) // 成本上升
    expect(over.results[1].value).toBeLessThan(8) // 切線仍預測下降
    expect(over.notes!.join(' ')).toMatch(/成本反而上升/)
    const noOut = byId('HC-02.6').solve({ a: 3, A: 1, sigma: 0.3, p: 0, s: 20 })
    expect(noOut.results[0].value).toBeCloseTo(3, 12)
    expect(noOut.results[2].value).toBeCloseTo(3, 9)
    // p_out = 0 時說明文字不可再說「不是 0」：ψ(a) = 0，a 就是固定點
    const whys = noOut.steps.map((s) => s.why).join(' ')
    expect(whys).not.toMatch(/不是 0，所以/)
    expect(whys).toMatch(/\$a\$ 就是 LMS 的固定點/)
    expect(whys).toMatch(/沒有突波時也是 0/)
    expectNoFloatResidue(noOut, 'HC-02.6 p=0')
    // Newton 步長（μJ″ = 1）：備註直接說「一步到位」，切線預測的下降量是 J(w₀) 的兩倍
    const newton = byId('HC-02.1').solve({ a: 3, x: 2, w0: 1, mu: 0.25 })
    expect(newton.results.map((r) => r.value)).toEqual([3, -8, 0])
    expect(newton.notes!.join(' ')).toMatch(/剛好是 Newton 步長.*一步就到谷底/)
    // 穩定邊界（μJ″ = 2）：成本完全沒降
    const edge = byId('HC-02.1').solve({ a: 3, x: 2, w0: 1, mu: 0.5 })
    expect(edge.results[2].value).toBe(8)
    expect(edge.notes!.join(' ')).toMatch(/剛好是穩定邊界/)
    // HC-02.6：沒有常態表時的近似，依 |z| 說明適用範圍（0.3、0.5 兩個門檻）；p_out = 0 時 z = 0
    const whyZ = (p: number) => byId('HC-02.6').solve({ a: 3, A: 1, sigma: 0.3, p, s: 20 }).steps.find((s) => s.tex.startsWith(String.raw`z=\Phi^{-1}`))!.why
    expect(whyZ(0.05)).toMatch(/誤差 \$<0\.05\\%\$/)
    expect(whyZ(0.2)).toMatch(/\|z\|>0\.3.*誤差放寬到 \$<0\.4\\%\$/)
    expect(whyZ(0.3)).toMatch(/\|z\|>0\.5.*誤差約 \$0\.5\d?\\%\$/)
    expect(whyZ(0)).toMatch(/z=0\$，不必查表/)
    for (const p of [0, 0.05, 0.2, 0.3]) expectCleanMathString(whyZ(p), `HC-02.6 why p=${p}`)
    // HC-02.8：g > 0.2 時不推薦速算式 τ ≈ 1/g − ½，並印出它實際會差多少
    const v8 = { sigma: 0.5, A: 2, mu: 0.05 } // g = 0.319：在 0.2 與上限 0.5 之間
    expect(byId('HC-02.8').validate!(v8)).toBeNull()
    const sol8 = byId('HC-02.8').solve(v8)
    const g8 = v8.mu * sol8.results[0].value
    expect(g8).toBeGreaterThan(0.2)
    const whyTau = sol8.steps.find((s) => s.tex.startsWith(String.raw`\tau=`))!.why
    expect(whyTau).toMatch(/只適用 \$g\\le0\.2\$.*請直接按/)
    expect(Math.abs(1 / g8 - 0.5 - sol8.results[2].value) / sol8.results[2].value).toBeGreaterThan(0.005)
    expectCleanMathString(whyTau, 'HC-02.8 why tau')
    // NLMS：μ̃ ≥ 2 不擋，但備註說明誤差沒有變小
    expect(byId('HC-02.7').solve({ w: 1, x: 2, y: 6, mut: 2.5, eps: 0 }).notes!.join(' ')).toMatch(/太大/)
  })
})

describe('(d) 渲染：每一題的 <HandCalc> 都沒有 KaTeX 錯誤，步驟、答案與提示齊全', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：看帶入過程`, () => {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} />)
      expectNoTexErrors(container, def.id)
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(sol.steps.length).toBeGreaterThanOrEqual(1)
      expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
      expect(bareMacros(container)).toEqual([])
      expect(unicodeMath(container)).toEqual([])
      expect(container.textContent).not.toMatch(/NaN|undefined/)
      expect(container.querySelector(`[id="handcalc-${def.id}"]`)).toBeTruthy()
      expect(container.textContent).toContain('手算提示')
      unmount()
    }, T_RENDER)

    it(`${def.id}：自己算算看——填入獨立公式的答案全部判定正確，亂填則判定錯誤`, () => {
      const v = defaultValues(def)
      const want = INDEPENDENT[def.id](v)
      const { container, unmount } = render(<HandCalc def={def} initialMode="practice" />)
      expect(container.querySelectorAll('.c-step').length).toBe(0) // 先不顯示詳解
      const inputs = screen.getAllByPlaceholderText('你的答案')
      expect(inputs.length).toBe(want.length)
      inputs.forEach((el, i) => fireEvent.change(el, { target: { value: String(Number(want[i].toPrecision(6))) } }))
      fireEvent.click(screen.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(want.length)
      inputs.forEach((el, i) => fireEvent.change(el, { target: { value: String(want[i] * 1.5 + 7) } }))
      fireEvent.click(screen.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.bad').length).toBe(want.length)
      fireEvent.click(screen.getByText('看詳解'))
      expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
      expectNoTexErrors(container)
      unmount()
    }, T_RENDER)
  }

  it('改數字會重新帶入；不適用的數字顯示原因（含可渲染的公式）而不是錯誤的答案', () => {
    const { container } = render(<HandCalc def={byId('HC-02.2')} />)
    const mu = screen.getByLabelText(/步長（mu）/) as HTMLInputElement
    fireEvent.change(mu, { target: { value: '0.7' } }) // h = 0.7、n_c = 4、ρ = 0.2 ⇒ {2.8, 3.5}
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('3.5')
    fireEvent.change(mu, { target: { value: '0.3' } }) // |δ₀|/h = 10：剛好踩到
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('剛好踩到')
    expect(container.querySelector('.callout-warn .katex')).toBeTruthy()
    expectNoTexErrors(container)
    expect(unicodeMath(container)).toEqual([])
    fireEvent.click(screen.getByText('還原範例數字'))
    expect(container.textContent).toContain('3.2')
  }, T_RENDER)

  it('「換一題」的每一組數字都能完整渲染（各題 3 個種子）', () => {
    for (const def of HANDCALCS) {
      const { container, unmount } = render(<HandCalc def={def} />)
      for (let k = 0; k < 3; k++) {
        fireEvent.click(screen.getByText('換一題（隨機數字）'))
        fireEvent.click(screen.getByText('看詳解'))
        expectNoTexErrors(container, `${def.id} #${k}`)
        expect(container.querySelectorAll('.c-step').length, `${def.id} #${k}`).toBeGreaterThan(0)
        expect(bareMacros(container), `${def.id} #${k}`).toEqual([])
        expect(unicodeMath(container), `${def.id} #${k}`).toEqual([])
        expect(container.querySelector('.callout-warn'), `${def.id} #${k}`).toBeNull()
      }
      unmount()
    }
  }, T_ALL)
})
