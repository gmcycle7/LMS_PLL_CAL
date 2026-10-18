import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import katex from 'katex'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HandCalc, MathText, checkAnswer, defaultValues, randomValues } from '@/components'
import { SettingsProvider } from '@/app/settings'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { normCdf } from '@/simulation/core'
import {
  asymptoticFinalOptimum,
  budgetSplit,
  calPhaseMarginDeg,
  comparatorKq,
  convergenceMuMin,
  cornerInterval,
  gmacMeanField,
  gmacModel,
  loopGainK,
  msdAfterBlocks,
  msdRecursion,
  msdSplit,
  optimalSchedule,
  optimizeMu,
  slewLimitedBlocks,
  timeConstantBlocks,
} from '@/simulation/models/optimizer'
import Chapter14 from './index'
import { HANDCALCS } from './handcalcs'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })) },
}))

afterEach(() => localStorage.clear())

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}

function vector(name: string): Vector {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as Vector
}

function hc(id: string): HandCalcDef {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到 ${id}`)
  return def
}

/** 以 symbol 取出某個結果的數值。 */
function val(sol: HandCalcSolution, symbol: string): number {
  const r = sol.results.find((x) => x.symbol === symbol)
  if (!r) throw new Error(`沒有結果 ${symbol}：${sol.results.map((x) => x.symbol).join(' | ')}`)
  return r.value
}

function near(actual: number, expected: number, rel = 1e-9, abs = 1e-12): boolean {
  return Math.abs(actual - expected) <= abs + rel * Math.abs(expected)
}

const MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 一題的所有 TeX（步驟、結果符號、why／notes／tips／標籤裡的 $…$）都能被 KaTeX 嚴格解析。 */
function assertTexValid(def: HandCalcDef, sol: HandCalcSolution, ctx: string) {
  const strict = (tex: string, where: string) =>
    expect(() => katex.renderToString(tex, { throwOnError: true, strict: 'ignore' }), `${ctx} ${where}: ${tex}`).not.toThrow()
  const inline = (text: string, where: string) => {
    for (const m of text.matchAll(MATH)) strict(m[1], where)
  }
  strict(def.formulaTex, 'formulaTex')
  sol.steps.forEach((s, i) => {
    strict(s.tex, `step ${i + 1}`)
    inline(s.why, `why ${i + 1}`)
  })
  sol.results.forEach((r) => {
    strict(`${r.symbol} = 1${r.unit ? `\\ ${r.unit}` : ''}`, `result ${r.symbol}`)
    if (r.label) inline(r.label, 'result label')
  })
  sol.notes?.forEach((n, i) => inline(n, `note ${i + 1}`))
}

/** 數學以外的文字：把 $…$ 拿掉後不可殘留 TeX 指令、未配對的 $，或用 Unicode 拼湊的數學符號。 */
function proseLeaks(text: string): string[] {
  const prose = text.replace(MATH, ' ')
  const out: string[] = []
  if (prose.includes('$')) out.push(`未配對的 $：${text}`)
  if (/\\[a-zA-Z]+|\^\{|_\{/.test(prose)) out.push(`數學寫在 $ 外面：${text}`)
  if (/[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓]/.test(prose)) out.push(`Unicode 拼湊的數學：${text}`)
  return out
}

function allStrings(def: HandCalcDef, sol: HandCalcSolution): string[] {
  return [
    def.title,
    ...def.inputs.map((i) => i.label),
    ...sol.steps.map((s) => s.why),
    ...sol.results.map((r) => r.label ?? ''),
    ...(sol.notes ?? []),
    ...(def.tips ?? []),
  ]
}

/** Φ(z)：以 Simpson 積分獨立計算（不依賴 special.ts 的 erf／normCdf）。 */
function phiSimpson(z: number): number {
  const n = 4000
  const h = z / n
  const f = (t: number) => Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI)
  let s = f(0) + f(z)
  for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * f(i * h)
  return 0.5 + (s * h) / 3
}

const ROOT = Math.sqrt(2 / Math.PI)

/** 各題答案的「獨立重算」：直接照公式寫（迴圈加總、Math.pow…），不呼叫 optimizer.ts。順序與 results 相同。 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-14.1': ({ d0, g, K, N }) => {
    const mu = g / K
    const p = 1 - g
    const q = (mu * mu) / N
    let m = d0 * d0
    const out = [mu, q]
    for (let k = 0; k < 3; k++) {
      m = p * p * m + q
      out.push(m)
    }
    return out
  },
  'HC-14.2': ({ d0, mu, sv, N, B }) => {
    const p = 1 - (mu * ROOT) / sv
    const bias2 = d0 * d0 * Math.pow(p, 2 * B)
    let variance = 0
    for (let k = 0; k < B; k++) variance += ((mu * mu) / N) * Math.pow(p, 2 * k)
    return [p, bias2, variance, bias2 + variance, Math.sqrt(bias2 + variance)]
  },
  'HC-14.3': ({ sv, N, muA, muB }) => {
    const K = ROOT / sv
    const one = (mu: number) => {
      const g = mu * K
      return [-1 / Math.log(Math.abs(1 - g)), Math.sqrt(mu / N / (K * (2 - g)))]
    }
    return [...one(muA), ...one(muB)]
  },
  'HC-14.4': ({ d0, sv, mu, tgt }) => {
    const mean = 2 * phiSimpson(d0 / sv) - 1
    return [mean, d0 - mu * mean, (1 - (mu * ROOT) / sv) * d0, Math.ceil((d0 - tgt) / mu - 1e-9)]
  },
  'HC-14.5': ({ sv, N, T, d0 }) => {
    const K = ROOT / sv
    const B = T / N
    const A = 4 * T * K * K * d0 * d0
    const cost = (1 + Math.log(A)) / (4 * T * K * K)
    return [B, A, Math.log(A) / (2 * B * K), cost, Math.sqrt(cost)]
  },
  'HC-14.6': ({ kmin, kmax, eps, B }) => {
    const bExact = Math.log(eps) / Math.log(1 - kmin / kmax)
    return [bExact, Math.max(1, Math.ceil(bExact - 1e-9)), (1 - Math.pow(eps, 1 / B)) / kmin, 1 / kmax]
  },
  'HC-14.7': ({ d0, K, N, B }) => {
    const info = K * K * N
    const k0 = 1 / (d0 * d0) / info
    return [1 / (1 / (d0 * d0) + B * info), k0, 1 / (K * (1 + k0)), 1 / (K * (B + k0))]
  },
  'HC-14.8': ({ d0, sv, N, T, eps, theta }) => {
    const B = T / N
    const K = (ROOT * Math.cos((theta * Math.PI) / 180)) / sv
    const p = Math.pow(eps, 1 / B)
    const mu = (1 - p) / K
    let variance = 0
    for (let k = 0; k < B; k++) variance += ((mu * mu) / N) * Math.pow(p, 2 * k)
    const total = d0 * d0 * eps * eps + variance
    return [mu, p, 90 - (Math.asin((1 - p) / 2) * 180) / Math.PI, -1 / Math.log(p), Math.sqrt(total)]
  },
}

describe('Ch14 帶入手算：題庫結構', () => {
  it('8 題、id 為 HC-14.1…HC-14.8、page 為 /ch/14、三種難度都有', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(Array.from({ length: 8 }, (_, i) => `HC-14.${i + 1}`))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/14')
      expect(h.inputs.length).toBeGreaterThan(0)
      expect(h.tips?.length ?? 0).toBeGreaterThan(0)
      // 每個輸入都能「換一題」，而且預設值本身合法
      for (const i of h.inputs) expect(i.practice, `${h.id} ${i.key}`).toBeTruthy()
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    expect(Object.keys(INDEPENDENT).sort()).toEqual(HANDCALCS.map((h) => h.id).sort())
  })

  it('難度標示誠實：beginner 題的步驟與答案只用四則運算（沒有根號、對數、三角、次方根）', () => {
    for (const h of HANDCALCS.filter((x) => x.level === 'beginner')) {
      const sol = h.solve(defaultValues(h))
      for (const s of sol.steps) expect(s.tex, `${h.id}: ${s.tex}`).not.toMatch(/\\sqrt|\\ln|\\log|\\sin|\\cos|\\arcsin|\\Phi|\\exp|\^\{1\//)
      for (const r of sol.results) expect(r.symbol).not.toMatch(/\\sqrt/)
    }
    // research 題確實需要查表
    expect(hc('HC-14.4').solve(defaultValues(hc('HC-14.4'))).steps.some((s) => s.tex.includes('\\Phi'))).toBe(true)
  })

  it('文字一律 LaTeX：標題、標籤、說明、提示裡的數學都在 $…$ 內，沒有 Unicode 拼湊或漏出的 TeX', () => {
    const leaks: string[] = []
    for (const h of HANDCALCS) {
      for (let seed = 0; seed <= 6; seed++) {
        const v = seed === 0 ? defaultValues(h) : randomValues(h, seed)
        for (const s of allStrings(h, h.solve(v))) leaks.push(...proseLeaks(s).map((x) => `${h.id}: ${x}`))
      }
    }
    expect(leaks).toEqual([])
  })
})

describe('Ch14 帶入手算：(a) 範例數字 = 模型函式 = 文中的 worked example', () => {
  it('HC-14.1：§14.0.1 表格的三列（7.32835、5.97431、4.87754 fs²）＝ msdRecursion', () => {
    const def = hc('HC-14.1')
    const v = defaultValues(def)
    const sol = def.solve(v)
    // 與同一組輸入的模型遞迴完全一致
    const rec = msdRecursion(v.d0, 1 - v.g, v.g / v.K, 1 / v.N, 3)
    expect(val(sol, '\\mu')).toBe(v.g / v.K)
    expect(val(sol, 'E[\\delta_1^2]')).toBe(rec[1])
    expect(val(sol, 'E[\\delta_2^2]')).toBe(rec[2])
    expect(val(sol, 'E[\\delta_3^2]')).toBe(rec[3])
    // 文中的表格用精確的 K = √(2/π)/100（預設輸入是它的 6 位有效數字）：答案到 6 位有效數字相同
    const K = loopGainK(100, 0)
    expect(v.K).toBe(Number(K.toPrecision(6)))
    const text = msdRecursion(3, 0.9, 0.1 / K, 1 / 4096, 3)
    for (const k of [1, 2, 3]) expect(Number(sol.results[k + 1].value.toPrecision(6))).toBe(Number(text[k].toPrecision(6)))
    expect([1, 2, 3].map((k) => Number(text[k].toPrecision(6)))).toEqual([7.32835, 5.97431, 4.87754])
    expect(near(val(sol, '\\mu^2\\sigma_\\eta^2'), (0.1 / K) ** 2 / 4096, 1e-5)).toBe(true)
    // 封閉式（F-14.3）與遞迴一致
    expect(near(rec[3], msdAfterBlocks(v.d0, 1 - v.g, v.g / v.K, 1 / v.N, 3), 1e-12)).toBe(true)
  })

  it('HC-14.2：golden msd_after_blocks.json（δ0 = 20、μ = 10、B = 5…80）逐點一致，預設 B = 20', () => {
    const def = hc('HC-14.2')
    const g = vector('msd_after_blocks')
    const inp = g.inputs as { delta0_fs: number; mu_fs: number; sigma_eta2: number; B_list: number[] }
    const v = defaultValues(def)
    expect([v.d0, v.mu, v.sv, 1 / v.N, v.B]).toEqual([inp.delta0_fs, inp.mu_fs, 100, inp.sigma_eta2, 20])
    const list = g.expected.msd_list as number[]
    inp.B_list.forEach((B, i) => {
      if (B < 1) return
      const sol = def.solve({ ...v, B })
      const total = val(sol, 'E[\\delta_B^2]')
      expect(near(total, list[i], g.tolerance.rel ?? 1e-11), `B = ${B}`).toBe(true)
      expect(near(val(sol, '\\text{bias}^2') + val(sol, '\\text{variance}'), total, 1e-14)).toBe(true)
      expect(near(val(sol, '\\sqrt{E[\\delta_B^2]}'), Math.sqrt(list[i]), 1e-11)).toBe(true)
    })
    const sp = msdSplit(20, 1 - 10 * comparatorKq(100), 10, 1 / 4096, 20)
    const sol = def.solve(v)
    expect(val(sol, '\\text{bias}^2')).toBe(sp.bias2)
    expect(val(sol, '\\text{variance}')).toBe(sp.variance)
    expect(val(sol, 'E[\\delta_B^2]')).toBe(msdAfterBlocks(20, 1 - 10 * comparatorKq(100), 10, 1 / 4096, 20))
  })

  it('T13: HC-14.2 的 pole 與 B → ∞ 極限 = golden T13（p = 0.92021、σ_w² = 0.15935 fs²）', () => {
    const def = hc('HC-14.2')
    const t13 = vector('T13')
    expect(near(val(def.solve(defaultValues(def)), 'p'), t13.expected.p as number, 0, 1e-12)).toBe(true)
    // B 很大時 bias² → 0、variance → σ_w²
    const far = def.solve({ ...defaultValues(def), d0: 0, B: 100000 })
    expect(near(val(far, 'E[\\delta_B^2]'), t13.expected.sigma_w2_fs2 as number, 0, 1e-12)).toBe(true)
  })

  it('T13: HC-14.3 的候選 A（σ_v = 100、N = 4096、μ = 10）得到 σ_w = 0.399186 fs、τ = −1/ln p', () => {
    const def = hc('HC-14.3')
    const t13 = vector('T13')
    const v = defaultValues(def)
    expect([v.sv, v.N, v.muA]).toEqual([t13.inputs.sigma_v_fs, t13.inputs.N, t13.inputs.mu_fs])
    const sol = def.solve(v)
    expect(near(val(sol, '\\sigma_{w,A}'), t13.expected.sigma_w_fs as number, 0, 1e-12)).toBe(true)
    expect(val(sol, '\\tau_A')).toBe(timeConstantBlocks(t13.expected.p as number))
    // 候選 B（μ 減半）：穩態 = 很多 block 後的 E[δ²]
    const pB = 1 - v.muB * comparatorKq(v.sv)
    expect(near(val(sol, '\\sigma_{w,B}') ** 2, msdAfterBlocks(0, pB, v.muB, 1 / v.N, 1e6), 1e-12)).toBe(true)
    expect(val(sol, '\\tau_B')).toBe(timeConstantBlocks(pB))
    // 取捨的方向：μ 減半 ⇒ 雜訊變小、時間變長
    expect(val(sol, '\\sigma_{w,B}')).toBeLessThan(val(sol, '\\sigma_{w,A}'))
    expect(val(sol, '\\tau_B')).toBeGreaterThan(val(sol, '\\tau_A'))
  })

  it('HC-14.4：§14.1「設計含意」的例子 (100 − 10)/60 = 1.5 ⇒ 2 blocks；E[G|δ0 = σ_v] = 2Φ(1) − 1', () => {
    const def = hc('HC-14.4')
    const v = defaultValues(def)
    expect([v.d0, v.sv, v.mu, v.tgt]).toEqual([100, 100, 60, 10])
    const sol = def.solve(v)
    expect(slewLimitedBlocks(100, 10, 60)).toBe(1.5)
    expect(val(sol, 'B_{\\min}')).toBe(2)
    const mean = gmacMeanField(100, gmacModel(4096, 100, 0))
    expect(val(sol, 'E[G\\,|\\,\\delta_0]')).toBe(mean)
    expect(near(mean, 2 * normCdf(1) - 1, 1e-12)).toBe(true)
    expect(Number(mean.toPrecision(4))).toBe(0.6827)
    expect(near(val(sol, 'E[\\delta_1]'), 100 - 60 * mean, 1e-14)).toBe(true)
    expect(near(val(sol, 'p\\,\\delta_0'), (1 - 60 * comparatorKq(100)) * 100, 1e-14)).toBe(true)
    // 飽和 ⇒ 真實的第一步比線性模型預測的小（剩下的誤差比較大）
    expect(val(sol, 'E[\\delta_1]')).toBeGreaterThan(val(sol, 'p\\,\\delta_0'))
  })

  it('slewLimitedBlocks（F-14.5）：下界、對稱、已在目標內為 0、max|x| 的比例', () => {
    expect(slewLimitedBlocks(-100, 10, 60)).toBe(1.5)
    expect(slewLimitedBlocks(5, 10, 60)).toBe(0)
    expect(slewLimitedBlocks(100, 10, 60, 3)).toBeCloseTo(0.5, 14)
    expect(slewLimitedBlocks(200, 0, 50)).toBe(4)
  })

  it('HC-14.5：第 10 課條件 A ≈ 300、μ* ≈ 11.17 fs ＝ asymptoticFinalOptimum；RMS* ＝ budgetSplit 的一階預測（F-14.17）', () => {
    const def = hc('HC-14.5')
    const v = defaultValues(def)
    expect([v.sv, v.N, v.T, v.d0]).toEqual([100, 4096, 131072, 3])
    const sol = def.solve(v)
    const K = comparatorKq(100)
    const a = asymptoticFinalOptimum({ K, delta0: 3, sigmaEta2: 1 / 4096, B: 32 })
    expect(val(sol, 'B')).toBe(32)
    expect(val(sol, 'A')).toBe(a.A)
    expect(val(sol, '\\mu^*')).toBe(a.mu)
    expect(val(sol, 'E[\\delta_B^2]^*')).toBe(a.cost)
    expect(Math.round(a.A)).toBe(300)
    expect(Number(a.mu.toPrecision(4))).toBe(11.17)
    const fo = budgetSplit({ T: 131072, Ns: [4096], K, delta0: 3 })[0].rmsFirstOrder
    expect(near(val(sol, '\\text{RMS}^*'), fo, 1e-12)).toBe(true)
    // F-14.17：N 加倍、T 不變 ⇒ A 與 RMS* 不變、μ* 加倍
    const sol2 = def.solve({ ...v, N: 8192 })
    expect(def.validate?.({ ...v, N: 8192 })).toBeNull()
    expect(near(val(sol2, 'A'), a.A, 1e-12)).toBe(true)
    expect(near(val(sol2, '\\text{RMS}^*'), fo, 1e-12)).toBe(true)
    expect(near(val(sol2, '\\mu^*'), 2 * a.mu, 1e-12)).toBe(true)
  })

  it('HC-14.6：§14.5「先算一次」B_min = 11.358 → 12、區間 [79.677, 83.333] fs ＝ cornerInterval；golden corner（B = 100）', () => {
    const def = hc('HC-14.6')
    const v = defaultValues(def)
    expect([v.kmin, v.kmax, v.eps, v.B]).toEqual([0.004, 0.012, 0.01, 12])
    const sol = def.solve(v)
    const c = cornerInterval([0.004, 0.012], 0.01, 12)
    expect(val(sol, '\\frac{\\ln\\epsilon}{\\ln(1-r)}')).toBe(c.bMinExact)
    expect(val(sol, 'B_{\\min}')).toBe(12)
    expect(val(sol, '\\mu_{\\min}')).toBe(c.muLo)
    expect(val(sol, '\\mu_{\\max}')).toBe(c.muHi)
    expect(Number(c.bMinExact.toPrecision(5))).toBe(11.358)
    expect(Number(c.muLo.toPrecision(5))).toBe(79.677)
    expect(Number(c.muHi.toPrecision(5))).toBe(83.333)
    // B = 11：區間為空（仍然是合法輸入，答案照算，說明要指出是空集合）
    expect(def.validate?.({ ...v, B: 11 })).toBeNull()
    const empty = def.solve({ ...v, B: 11 })
    expect(val(empty, '\\mu_{\\min}')).toBeGreaterThan(val(empty, '\\mu_{\\max}'))
    expect(empty.notes?.join('')).toContain('區間為空')
    expect(sol.notes?.join('')).toContain('區間非空')
    // golden vector 的 corner 例
    const g = vector('msd_after_blocks')
    const corner = (g.inputs as { corner: { k_min: number; k_max: number; eps: number; B: number } }).corner
    const gs = def.solve({ kmin: corner.k_min, kmax: corner.k_max, eps: corner.eps, B: corner.B })
    expect(near(val(gs, '\\mu_{\\min}'), g.expected.corner_mu_lo as number, 1e-11)).toBe(true)
    expect(near(val(gs, '\\mu_{\\max}'), g.expected.corner_mu_hi as number, 1e-11)).toBe(true)
    // validation.md E16 的第二個例子：r = 0.5、ε = 0.001 ⇒ B ≥ 9.966 → 10
    const e16 = def.solve({ kmin: 0.005, kmax: 0.01, eps: 0.001, B: 10 })
    expect(Number(val(e16, '\\frac{\\ln\\epsilon}{\\ln(1-r)}').toPrecision(4))).toBe(9.966)
    expect(val(e16, 'B_{\\min}')).toBe(10)
  })

  it('HC-14.7：第 10 課條件的 Kalman 下界 ＝ optimalSchedule（封閉式 P_B = 遞迴 P[B]）', () => {
    const def = hc('HC-14.7')
    const v = defaultValues(def)
    expect([v.d0, v.N, v.B]).toEqual([3, 4096, 32])
    expect(v.K).toBe(Number(comparatorKq(100).toPrecision(6)))
    const sol = def.solve(v)
    const sch = optimalSchedule(3, v.K, 1 / 4096, 32)
    expect(val(sol, 'P_B')).toBe(sch.PB)
    expect(val(sol, 'k_0')).toBe(sch.k0)
    expect(val(sol, '\\mu_0')).toBe(sch.mu[0])
    expect(val(sol, '\\mu_{B-1}')).toBe(sch.mu[31])
    expect(near(sch.P[32], sch.PB, 1e-12)).toBe(true)
    // 下界：比 HC-14.5 的固定 μ 最佳值（漸近式）小
    const fixed = val(hc('HC-14.5').solve(defaultValues(hc('HC-14.5'))), 'E[\\delta_B^2]^*')
    expect(val(sol, 'P_B')).toBeLessThan(fixed)
    expect(val(sol, '\\mu_0') * v.K).toBeLessThanOrEqual(1)
  })

  it('HC-14.8（綜合題）：重現第 10 課設計計算器的 α = 11.20 fs、pole 0.9106、PM 87.4°、RMS 0.449 fs', () => {
    const def = hc('HC-14.8')
    const v = defaultValues(def)
    expect([v.d0, v.sv, v.N, v.T, v.eps, v.theta]).toEqual([3, 100, 4096, 131072, 0.05, 0])
    const sol = def.solve(v)
    const K = loopGainK(100, 0)
    const mu = convergenceMuMin(K, 0.05, 32)
    const p = 1 - mu * K
    expect(val(sol, '\\mu')).toBe(mu)
    expect(val(sol, 'p')).toBe(p)
    expect(val(sol, 'PM')).toBe(calPhaseMarginDeg(mu * K))
    expect(val(sol, '\\tau')).toBe(timeConstantBlocks(p))
    expect(near(val(sol, '\\sqrt{E[\\delta_B^2]}'), Math.sqrt(msdAfterBlocks(3, p, mu, 1 / 4096, 32)), 1e-14)).toBe(true)
    // 課程宣稱的四個數字（S5Calculator 的 LESSON_CLAIM）
    expect(val(sol, '\\mu').toFixed(2)).toBe('11.20')
    expect(val(sol, 'p').toFixed(4)).toBe('0.9106')
    expect(val(sol, 'PM').toFixed(1)).toBe('87.4')
    expect(val(sol, '\\sqrt{E[\\delta_B^2]}').toFixed(3)).toBe('0.449')
    // p^B = ε（這個 μ 的定義），所以 B/τ = ln(1/ε)
    expect(near(Math.pow(p, 32), 0.05, 1e-12)).toBe(true)
    expect(near(32 / val(sol, '\\tau'), Math.log(20), 1e-12)).toBe(true)
  })
})

describe('Ch14 帶入手算：(b) 換一題 20 組隨機數字 = 測試內的獨立重算', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：有限、通過 validate、與獨立公式一致（相對 1e-9）、TeX 可解析`, () => {
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(def, seed)
        seen.add(JSON.stringify(v))
        expect(def.validate?.(v) ?? null, `${def.id} seed ${seed}`).toBeNull()
        const sol = def.solve(v)
        const want = INDEPENDENT[def.id](v)
        expect(sol.results.length).toBe(want.length)
        sol.results.forEach((r, i) => {
          expect(Number.isFinite(r.value), `${def.id} seed ${seed} ${r.symbol}`).toBe(true)
          expect(near(r.value, want[i], 1e-9, 1e-12), `${def.id} seed ${seed} ${r.symbol}: ${r.value} vs ${want[i]} @ ${JSON.stringify(v)}`).toBe(true)
        })
        expect(sol.steps.length).toBeGreaterThan(0)
        assertTexValid(def, sol, `${def.id} seed ${seed}`)
      }
      // 抽出來的不是每次都同一題（多數題目應該有 10 種以上的組合）
      expect(seen.size).toBeGreaterThan(5)
      // 同一個 seed 可重現
      expect(randomValues(def, 3)).toEqual(randomValues(def, 3))
    })
  }

  it('預設值也與獨立重算一致', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const sol = def.solve(v)
      const want = INDEPENDENT[def.id](v)
      sol.results.forEach((r, i) => expect(near(r.value, want[i], 1e-9, 1e-12), `${def.id} ${r.symbol}`).toBe(true))
      assertTexValid(def, sol, def.id)
    }
  })

  it('照步驟上顯示的 6 位有效數字手算（不帶完整精度），答案仍落在容許誤差內', () => {
    // HC-14.2：p、p²、p^{2B} 都只取 6 位，再照步驟相乘相加
    const d2 = hc('HC-14.2')
    for (let seed = 1; seed <= 20; seed++) {
      const v = seed === 1 ? defaultValues(d2) : randomValues(d2, seed)
      const r6 = (x: number) => Number(x.toPrecision(6))
      const K = r6(r6(ROOT) / v.sv)
      const p = r6(1 - r6(v.mu * K))
      const p2 = r6(p * p)
      const p2B = r6(Math.pow(p2, v.B))
      const bias2 = r6(v.d0 * v.d0 * p2B)
      const noise = r6((v.mu * v.mu) / v.N)
      const variance = r6(noise * r6(r6(1 - p2B) / r6(1 - p2)))
      const sol = d2.solve(v)
      const byHand = [p, bias2, variance, r6(bias2 + variance), r6(Math.sqrt(r6(bias2 + variance)))]
      sol.results.forEach((r, i) => expect(checkAnswer(byHand[i], r).ok, `HC-14.2 seed ${seed} ${r.symbol}: ${byHand[i]} vs ${r.value}`).toBe(true))
    }
    // HC-14.4：Φ 只查到 4 位小數
    const d4 = hc('HC-14.4')
    for (let seed = 1; seed <= 20; seed++) {
      const v = seed === 1 ? defaultValues(d4) : randomValues(d4, seed)
      const phi4 = Number(normCdf(v.d0 / v.sv).toFixed(4))
      const mean = 2 * phi4 - 1
      const sol = d4.solve(v)
      expect(checkAnswer(mean, sol.results[0]).ok, `HC-14.4 seed ${seed} E[G]`).toBe(true)
      expect(checkAnswer(v.d0 - v.mu * mean, sol.results[1]).ok, `HC-14.4 seed ${seed} E[δ1]`).toBe(true)
    }
  })
})

describe('Ch14 帶入手算：手算提示裡的近似式，適用範圍確實如所寫', () => {
  it('τ ≈ 1/g − 1/2：g ≤ 0.25 時誤差 < 1%', () => {
    for (let g = 0.005; g <= 0.25 + 1e-12; g += 0.005) {
      const exact = timeConstantBlocks(1 - g)
      expect(Math.abs(1 / g - 0.5 - exact) / exact).toBeLessThan(0.01)
    }
  })

  it('arcsin x ≈ 57.296°·x：x ≤ 0.2 時誤差 < 0.7%', () => {
    for (let x = 0.01; x <= 0.2 + 1e-12; x += 0.01) {
      const exact = (Math.asin(x) * 180) / Math.PI
      expect(Math.abs(57.296 * x - exact) / exact).toBeLessThan(0.007)
    }
  })

  it('2Φ(z) − 1 ≈ √(2/π)·z：|z| ≤ 0.2 時誤差 < 1%（≈ z²/6）；z ≥ 2.5 時 ≈ 1（誤差 < 1.3%）', () => {
    for (let z = 0.02; z <= 0.2 + 1e-12; z += 0.02) {
      const exact = 2 * normCdf(z) - 1
      const err = Math.abs(ROOT * z - exact) / exact
      expect(err).toBeLessThan(0.01)
      expect(Math.abs(err - (z * z) / 6)).toBeLessThan(0.001)
    }
    for (const z of [2.5, 3, 4]) expect(1 - (2 * normCdf(z) - 1)).toBeLessThan(0.013)
    // 獨立的 Simpson Φ 與 special.ts 的 normCdf 一致（HC-14.4 的獨立重算用得到）
    for (const z of [0.25, 0.5, 1, 1.5, 2, 3]) expect(near(phiSimpson(z), normCdf(z), 1e-10)).toBe(true)
  })

  it('ln(1 − r) ≈ −r：r ≤ 0.1 時 B_min 高估不到 6%（偏保守）', () => {
    for (let r = 0.01; r <= 0.1 + 1e-12; r += 0.01) {
      const ratio = -Math.log(1 - r) / r // 近似值 ÷ 精確值
      expect(ratio).toBeGreaterThan(1)
      expect(ratio).toBeLessThan(1.06)
    }
  })

  it('K|δ0| ≤ 0.4 相當於 θ = 0 時的 |δ0| ≤ 0.5σ_v（勘誤 E48 的門檻）', () => {
    expect(0.5 * comparatorKq(1)).toBeCloseTo(0.4, 2)
  })
})

describe('Ch14 帶入手算：(c) validate 擋掉模型不適用的輸入，並說明原因', () => {
  const reject = (id: string, patch: Record<string, number>, pattern: RegExp) => {
    const def = hc(id)
    const msg = def.validate?.({ ...defaultValues(def), ...patch }) ?? null
    expect(msg, `${id} ${JSON.stringify(patch)} 應該被拒絕`).not.toBeNull()
    expect(msg as string, `${id} ${JSON.stringify(patch)}`).toMatch(pattern)
    expect((msg as string).length).toBeGreaterThan(25) // 不是只丟一句「不合法」
    expect(proseLeaks(msg as string)).toEqual([])
    for (const m of (msg as string).matchAll(MATH)) expect(() => katex.renderToString(m[1], { throwOnError: true, strict: 'ignore' }), m[1]).not.toThrow()
  }
  const accept = (id: string, patch: Record<string, number>) => {
    const def = hc(id)
    expect(def.validate?.({ ...defaultValues(def), ...patch }) ?? null, `${id} ${JSON.stringify(patch)}`).toBeNull()
  }

  it('C ≤ 0（極性錯誤）：K ≤ 0 或 |θ| ≥ 90° 一律拒絕，訊息說明不是調 μ 能解決', () => {
    for (const K of [0, -0.008]) {
      reject('HC-14.1', { K }, /更新極性錯誤/)
      reject('HC-14.7', { K }, /更新極性錯誤/)
    }
    reject('HC-14.6', { kmin: 0 }, /更新極性錯誤/)
    reject('HC-14.6', { kmin: -0.004 }, /更新極性錯誤/)
    for (const theta of [90, 95, -90, -120, 180]) reject('HC-14.8', { theta }, /更新極性錯誤/)
    accept('HC-14.8', { theta: 89 })
    accept('HC-14.8', { theta: -60 })
  })

  it('g ≥ 2（|p| ≥ 1，沒有穩態）與 μ ≤ 0', () => {
    reject('HC-14.1', { g: 2 }, /\\ge2/)
    reject('HC-14.1', { g: 2.5 }, /\\ge2/)
    reject('HC-14.1', { g: 0 }, /必須大於 0/)
    reject('HC-14.1', { g: -0.1 }, /必須大於 0/)
    accept('HC-14.1', { g: 1.5 }) // 1 < g < 2：振盪收斂，公式仍成立
    reject('HC-14.2', { mu: 300 }, /\\ge2/) // g = 300·0.00798 = 2.39
    reject('HC-14.2', { mu: 0 }, /必須大於 0/)
    reject('HC-14.2', { mu: -10 }, /必須大於 0/)
    reject('HC-14.3', { muA: 300 }, /g_A.*\\ge2/)
    reject('HC-14.3', { muB: 260 }, /g_B.*\\ge2/)
    reject('HC-14.3', { muA: 0 }, /\\mu_A.*必須大於 0/)
    reject('HC-14.3', { muB: -1 }, /\\mu_B.*必須大於 0/)
    reject('HC-14.4', { mu: 0 }, /必須大於 0/)
    reject('HC-14.4', { mu: 300 }, /\\ge2/)
    for (const id of ['HC-14.2', 'HC-14.3', 'HC-14.4', 'HC-14.5', 'HC-14.8']) reject(id, { sv: 0 }, /\\sigma_v.*必須大於 0/)
  })

  it('勘誤 E48：|δ0| > 0.5σ_v（或 K|δ0| > 0.4）時線性公式不適用，導向 HC-14.4', () => {
    reject('HC-14.2', { d0: 60 }, /slew-limited.*勘誤 E48.*HC-14\.4/)
    reject('HC-14.2', { d0: -200 }, /勘誤 E48/)
    accept('HC-14.2', { d0: 50 }) // 剛好 0.5σ_v
    reject('HC-14.5', { d0: 80 }, /勘誤 E48/)
    reject('HC-14.8', { d0: 80 }, /勘誤 E48/)
    reject('HC-14.1', { d0: 100 }, /勘誤 E48.*HC-14\.4/) // K·δ0 = 0.8
    reject('HC-14.7', { d0: 100 }, /勘誤 E48/)
    accept('HC-14.7', { d0: 30 }) // 內文建議「把 δ0 改大 10 倍」
    // HC-14.4 本身就是處理大 δ0 的題目，不擋
    accept('HC-14.4', { d0: 400 })
  })

  it('勘誤 E16：ε 必須是相對縮減比 0 < ε < 1（把「1 fs」直接代進去會被拒絕）', () => {
    for (const eps of [1, 1.5, 50, 0, -0.1]) {
      reject('HC-14.6', { eps }, /相對縮減比.*勘誤 E16/)
      reject('HC-14.8', { eps }, /相對縮減比.*勘誤 E16/)
    }
    accept('HC-14.6', { eps: 0.02 })
    accept('HC-14.6', { eps: 0.999 })
  })

  it('其他：K_min > K_max、T 不是 N 的整數倍、預算不足一個 block、漸近式的前提、目標 ≥ 初始誤差、δ0 = 0', () => {
    reject('HC-14.6', { kmin: 0.02 }, /請對調/)
    accept('HC-14.6', { kmin: 0.012 }) // r = 1：沒有散佈
    reject('HC-14.5', { T: 100000 }, /不是整數/)
    reject('HC-14.8', { T: 100000 }, /不是整數/)
    reject('HC-14.5', { T: 2048 }, /小於一個 block/)
    reject('HC-14.8', { T: 2048 }, /小於一個 block/)
    reject('HC-14.5', { d0: 0.1 }, /\\le1/) // A = 0.33
    reject('HC-14.5', { d0: 0.5 }, /漸近式不適用/) // A = 8.3 < 20
    reject('HC-14.5', { N: 32768 }, /漸近式不適用/) // B = 4：g* = ln A/(2B) = 0.71
    reject('HC-14.4', { tgt: 100 }, /不需要 coarse/)
    reject('HC-14.4', { tgt: 150 }, /不需要 coarse/)
    reject('HC-14.4', { tgt: -1 }, /不可為負/)
    reject('HC-14.4', { d0: 0 }, /請輸入正的/)
    reject('HC-14.4', { d0: -100 }, /請輸入正的/)
    reject('HC-14.7', { d0: 0 }, /已經在答案上/)
    reject('HC-14.8', { d0: 0 }, /沒有初始誤差/)
  })

  it('特殊分支的詳解也能解析：p < 0（g > 1）、r = 1、區間為空、z 很小／很大', () => {
    const cases: [string, Record<string, number>][] = [
      ['HC-14.1', { g: 1.5 }],
      ['HC-14.1', { g: 1 }],
      ['HC-14.2', { mu: 200 }],
      ['HC-14.2', { d0: 0 }],
      ['HC-14.2', { d0: 40 }],
      ['HC-14.3', { muA: 200, muB: 150 }],
      ['HC-14.4', { d0: 10, tgt: 2 }],
      ['HC-14.4', { d0: 40 }],
      ['HC-14.4', { d0: 400 }],
      ['HC-14.6', { kmin: 0.012 }],
      ['HC-14.6', { B: 11 }],
      ['HC-14.6', { B: 1 }],
      ['HC-14.7', { B: 2 }],
      ['HC-14.8', { theta: 60 }],
      ['HC-14.8', { theta: -45, eps: 0.01 }],
    ]
    for (const [id, patch] of cases) {
      const def = hc(id)
      const v = { ...defaultValues(def), ...patch }
      expect(def.validate?.(v) ?? null, `${id} ${JSON.stringify(patch)}`).toBeNull()
      const sol = def.solve(v)
      for (const r of sol.results) expect(Number.isFinite(r.value), `${id} ${JSON.stringify(patch)} ${r.symbol}`).toBe(true)
      assertTexValid(def, sol, `${id} ${JSON.stringify(patch)}`)
      for (const s of allStrings(def, sol)) expect(proseLeaks(s)).toEqual([])
      const want = INDEPENDENT[id](v)
      sol.results.forEach((r, i) => expect(near(r.value, want[i], 1e-9, 1e-12), `${id} ${JSON.stringify(patch)} ${r.symbol}`).toBe(true))
    }
    // r = 1：任何 B ≥ 1 都可以
    expect(val(hc('HC-14.6').solve({ kmin: 0.012, kmax: 0.012, eps: 0.01, B: 12 }), 'B_{\\min}')).toBe(1)
    // θ = 60°：K 減半、μ 加倍、pole 與 PM 不變（提示裡的說法）
    const d8 = hc('HC-14.8')
    const a = d8.solve(defaultValues(d8))
    const b = d8.solve({ ...defaultValues(d8), theta: 60 })
    expect(near(val(b, '\\mu'), 2 * val(a, '\\mu'), 1e-12)).toBe(true)
    expect(near(val(b, 'p'), val(a, 'p'), 1e-12)).toBe(true)
    expect(near(val(b, 'PM'), val(a, 'PM'), 1e-12)).toBe(true)
    expect(val(b, '\\sqrt{E[\\delta_B^2]}') / val(a, '\\sqrt{E[\\delta_B^2]}')).toBeGreaterThan(1.8)
  })
})

/* ───────────── 獨立的 TeX 算式檢查：把每一步「符號式 = 代入數字 = 結果」裡的數字真的算出來 ───────────── */

class TexSymbolic extends Error {}
type TexFn = (L: number[]) => number

/** 去掉單位、排版用的空白與 aligned 的換行記號（`\\`、`&`），以及尾端的文字註記（區間非空／為空、p = 0）。 */
function cleanTex(tex: string): string {
  return tex
    .replace(/\\begin\{aligned\}|\\end\{aligned\}|\\\\|&/g, ' ')
    .replace(/\\mathrm\{fs(\^\{?-?\d\}?)?\}|\\text\{blocks\}/g, '')
    .replace(/\\quad\(.*$/, '')
    .replace(/\\qquad|\\quad|\\[,!;]|\\[Bb]ig[lr]?|\\left|\\right/g, ' ')
    .replace(/\\ /g, ' ')
}

/** 在最外層（不在 {}、() 裡）以 sep 切開。 */
function splitTop(tex: string, seps: string[]): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < tex.length; ) {
    const c = tex[i]
    if (c === '{' || c === '(') depth++
    else if (c === '}' || c === ')') depth--
    const hit = depth === 0 ? seps.find((x) => tex.startsWith(x, i) && !(x.startsWith('\\') && /[A-Za-z]/.test(tex[i + x.length] ?? ''))) : undefined
    if (hit) {
      out.push(cur.trim())
      cur = ''
      i += hit.length
    } else {
      cur += c
      i++
    }
  }
  out.push(cur.trim())
  return out
}

/**
 * 很小的 TeX 算式求值器：數字、+ − × /、^{…}、\frac、\sqrt、\ln、\cos（度）、\arcsin（度）、\Phi、\lceil…\rceil、括號。
 * 每個數字都當成「四捨五入到 max(6, 顯示位數) 位有效數字」的值，回傳算出來的值與這些捨入造成的最大偏差。
 * 遇到符號（K、\mu…）就丟 TexSymbolic：那一段是符號式，不檢查。
 */
class TexCalc {
  private i = 0
  readonly lits: { v: number; h: number }[] = []
  private readonly t: string[]
  constructor(src: string) {
    this.t = Array.from(src.matchAll(/\s*(\d+\.\d+|\d+|\\[A-Za-z]+|\S)/g), (m) => m[1])
  }

  static evaluate(src: string): { value: number; dev: number } {
    const c = new TexCalc(src)
    if (c.t.length === 0) throw new TexSymbolic('empty')
    const f = c.expr()
    if (c.i !== c.t.length) throw new TexSymbolic(`trailing ${c.t.slice(c.i).join(' ')}`)
    const L0 = c.lits.map((l) => l.v)
    const value = f(L0)
    let dev = 0
    c.lits.forEach((l, k) => {
      if (l.h === 0) return
      const at = (x: number) => f(L0.map((v, j) => (j === k ? x : v)))
      const d = Math.max(Math.abs(at(l.v + l.h) - value), Math.abs(at(l.v - l.h) - value))
      dev += Number.isNaN(d) ? Infinity : d
    })
    return { value, dev }
  }

  private peek(): string | undefined {
    return this.t[this.i]
  }
  private eat(x?: string): string {
    const tok = this.t[this.i]
    if (tok === undefined || (x !== undefined && tok !== x)) throw new TexSymbolic(`expected ${x} got ${tok}`)
    this.i++
    return tok
  }
  private lit(tok: string): TexFn {
    const v = Number(tok)
    const digits = tok.replace('.', '').replace(/^0+/, '').length || 1
    const h = v === 0 ? 0 : 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(v))) - Math.max(6, digits) + 1)
    const idx = this.lits.push({ v, h }) - 1
    return (L) => L[idx]
  }
  private group(): TexFn {
    this.eat('{')
    const e = this.expr()
    this.eat('}')
    return e
  }
  private expr(): TexFn {
    let e = this.term()
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.eat()
      const a = e
      const b = this.term()
      e = op === '+' ? (L) => a(L) + b(L) : (L) => a(L) - b(L)
    }
    return e
  }
  private term(): TexFn {
    let e = this.unary()
    while (this.peek() === '\\times' || this.peek() === '/') {
      const op = this.eat()
      const a = e
      const b = this.unary()
      e = op === '/' ? (L) => a(L) / b(L) : (L) => a(L) * b(L)
    }
    return e
  }
  private unary(): TexFn {
    if (this.peek() !== '-') return this.power()
    this.eat()
    const r = this.unary()
    return (L) => -r(L)
  }
  private power(): TexFn {
    let b = this.atom()
    while (this.peek() === '^') {
      this.eat()
      if (this.peek() === '\\circ') {
        this.eat() // 度的記號：數值不變
        continue
      }
      const a = b
      const x = this.peek() === '{' ? this.group() : this.number()
      b = (L) => Math.pow(a(L), x(L))
    }
    return b
  }
  private number(): TexFn {
    const tok = this.eat()
    if (!/^\d+(\.\d+)?$/.test(tok)) throw new TexSymbolic(`not a number: ${tok}`)
    return this.lit(tok)
  }
  private atom(): TexFn {
    const tok = this.peek()
    if (tok === undefined) throw new TexSymbolic('eof')
    if (/^\d+(\.\d+)?$/.test(tok)) return this.number()
    this.eat()
    switch (tok) {
      case '(': {
        const e = this.expr()
        this.eat(')')
        return e
      }
      case '{': {
        this.i--
        return this.group()
      }
      case '\\frac':
      case '\\tfrac': {
        const a = this.group()
        const b = this.group()
        return (L) => a(L) / b(L)
      }
      case '\\sqrt': {
        const a = this.group()
        return (L) => Math.sqrt(a(L))
      }
      case '\\ln': {
        const a = this.power()
        return (L) => Math.log(a(L))
      }
      case '\\cos': {
        const a = this.power()
        return (L) => Math.cos((a(L) * Math.PI) / 180)
      }
      case '\\arcsin': {
        const a = this.power()
        return (L) => (Math.asin(a(L)) * 180) / Math.PI
      }
      case '\\Phi': {
        const a = this.atom()
        return (L) => phiSimpson(a(L))
      }
      case '\\lceil': {
        const a = this.expr()
        this.eat('\\rceil')
        return (L) => Math.ceil(a(L) - 1e-9)
      }
      case '\\infty':
        return () => Infinity
      default:
        throw new TexSymbolic(`symbol ${tok}`)
    }
  }
}

/** 一步裡相鄰的兩個「純數字」段落必須相等（容許顯示位數造成的捨入）。回傳不一致的說明與檢查到的等號數。 */
function checkStepArithmetic(tex: string): { bad: string[]; pairs: number } {
  const bad: string[] = []
  let pairs = 0
  for (const chain of splitTop(cleanTex(tex), ['\\Rightarrow'])) {
    const nums: { seg: string; value: number; dev: number }[] = []
    for (const seg of splitTop(chain, ['=', '\\approx', '\\gtrsim'])) {
      try {
        nums.push({ seg, ...TexCalc.evaluate(seg) })
      } catch (e) {
        if (!(e instanceof TexSymbolic)) throw e
      }
    }
    for (let k = 1; k < nums.length; k++) {
      const a = nums[k - 1]
      const b = nums[k]
      pairs++
      const ok = a.value === b.value || Math.abs(a.value - b.value) <= (a.dev + b.dev) * 1.0001 + 1e-12 * Math.max(1, Math.abs(a.value))
      if (!ok) bad.push(`[${a.seg}] = ${a.value} ≠ [${b.seg}] = ${b.value}（容許 ${a.dev + b.dev}）`)
    }
  }
  return { bad, pairs }
}

/** 整題：每一步至少有一個「代入數字 = 結果」，而且全部對得起來。 */
function assertArithmetic(def: HandCalcDef, v: Record<string, number>) {
  const sol = def.solve(v)
  sol.steps.forEach((s, i) => {
    const r = checkStepArithmetic(s.tex)
    expect(r.bad, `${def.id} step ${i + 1} @ ${JSON.stringify(v)}：${s.tex}`).toEqual([])
    // 唯一沒有代入的步驟：deadbeat 的 τ = 0
    if (!/\(p_[AB]=0\)/.test(s.tex)) expect(r.pairs, `${def.id} step ${i + 1} 沒有可檢查的等號：${s.tex}`).toBeGreaterThan(0)
  })
  return sol
}

/** 使用者自己代的「不漂亮」數字：很小的 g（p 很接近 1）、很小的 K／ε（科學記號）、接近 deadbeat、很大的 B。 */
const STRESS: [string, Record<string, number>][] = [
  ['HC-14.1', { K: 0.00005, g: 0.001 }],
  ['HC-14.1', { K: 1e-7, g: 0.5 }],
  ['HC-14.1', { g: 0.0012345 }],
  ['HC-14.1', { g: 0.999999 }],
  ['HC-14.1', { d0: 0.00002 }],
  ['HC-14.1', { g: 1.9 }],
  ['HC-14.2', { mu: 0.01, B: 1000 }],
  ['HC-14.2', { mu: 0.0125331, B: 5 }],
  ['HC-14.2', { mu: 1.25331e-5, B: 100000 }],
  ['HC-14.2', { mu: 125.331 }],
  ['HC-14.2', { sv: 10000, d0: 2000, mu: 500 }],
  ['HC-14.2', { mu: 2000000, sv: 5e7 }],
  ['HC-14.2', { d0: 0.00003 }],
  ['HC-14.3', { muA: 0.02, muB: 0.01 }],
  ['HC-14.3', { muA: 125.331, muB: 0.001 }],
  ['HC-14.3', { sv: 20000, muA: 100, muB: 50 }],
  ['HC-14.4', { d0: 400 }],
  ['HC-14.4', { d0: 800 }],
  ['HC-14.4', { d0: 250 }],
  ['HC-14.4', { d0: 0.001, tgt: 0 }],
  ['HC-14.4', { sv: 20000, d0: 30000, mu: 5000, tgt: 100 }],
  ['HC-14.5', { N: 1000, T: 1000000000 }],
  ['HC-14.5', { sv: 20000, d0: 500, T: 131072 * 64 }],
  ['HC-14.5', { d0: 0.78 }],
  ['HC-14.6', { eps: 0.00001, B: 40 }],
  ['HC-14.6', { B: 1000 }],
  ['HC-14.6', { kmin: 0.00797, kmax: 0.00801 }],
  ['HC-14.6', { kmin: 0.00005, kmax: 0.00008 }],
  ['HC-14.6', { eps: 0.999, B: 3 }],
  ['HC-14.6', { kmin: 0.012 }],
  ['HC-14.6', { B: 8 }],
  ['HC-14.7', { K: 0.00005, d0: 0.001, N: 1000000 }],
  ['HC-14.7', { d0: 0.0005 }],
  ['HC-14.7', { B: 100000 }],
  ['HC-14.7', { K: 2e-7, d0: 1000, N: 100000000 }],
  ['HC-14.8', { eps: 0.00005 }],
  ['HC-14.8', { T: 409600000 }],
  ['HC-14.8', { sv: 20000, theta: -30 }],
  ['HC-14.8', { eps: 0.999 }],
  ['HC-14.8', { theta: 89.9 }],
  ['HC-14.8', { T: 4096 }],
  ['HC-14.8', { d0: 0.00002 }],
]

describe('Ch14 帶入手算：(e) 畫面上的每一個數字都對得起來（獨立的 TeX 算式檢查）', () => {
  it('檢查器本身抓得到錯：代錯數字、少一個平方、度／弧度弄錯、進位錯', () => {
    expect(checkStepArithmetic('g=\\mu K=10\\times0.00797885=0.0797885').bad).toEqual([])
    expect(checkStepArithmetic('g=\\mu K=10\\times0.00797885=0.0798885').bad.length).toBe(1)
    expect(checkStepArithmetic('p^2=0.920212^2=0.920212').bad.length).toBe(1)
    expect(checkStepArithmetic('p^2=(-0.595769)^2=0.354941').bad).toEqual([])
    expect(checkStepArithmetic('C=\\cos\\theta=\\cos 60^\\circ=0.5').bad).toEqual([])
    expect(checkStepArithmetic('C=\\cos\\theta=\\cos 60^\\circ=-0.952413').bad.length).toBe(1) // cos(60 rad)
    expect(checkStepArithmetic('PM=90^\\circ-\\arcsin 0.0446841=90^\\circ-2.56106^\\circ=87.4389^\\circ').bad).toEqual([])
    expect(checkStepArithmetic('PM=90^\\circ-\\arcsin 0.0446841=90^\\circ-0.0446990^\\circ=89.9553^\\circ').bad.length).toBe(1) // arcsin 的弧度值
    expect(checkStepArithmetic('x=\\frac{-4.60517}{-0.405465}=11.3577\\ \\Rightarrow\\ B_{\\min}=\\lceil11.3577\\rceil=11').bad.length).toBe(1)
    expect(checkStepArithmetic('\\ln A=\\ln 300.395=2.47769').bad.length).toBe(1) // log10
    expect(checkStepArithmetic('a=(6.3662\\times10^{-5})\\times4096=0.26076\\ \\mathrm{fs^{-2}}').bad).toEqual([])
    // 顯示 6 位以內的捨入不算錯；差到第 5 位就算錯
    expect(checkStepArithmetic('m=0.81\\times7.32835+0.0383495=5.93596+0.0383495=5.97431\\ \\mathrm{fs^2}').bad).toEqual([])
    expect(checkStepArithmetic('m=0.81\\times7.32835+0.0383495=5.93596+0.0383495=5.97441\\ \\mathrm{fs^2}').bad.length).toBe(1)
    expect(checkStepArithmetic('K=\\sqrt{\\tfrac{2}{\\pi}}\\,\\frac{1}{\\sigma_v}').pairs).toBe(0) // 純符號
    // 拆成兩行（aligned）的步驟照樣檢查：HC-14.3 的 σ_w = √(σ_w²)
    const twoLine = (r: string) => String.raw`\begin{aligned}\sigma_{w,A}&=\sqrt{0.15935}\\&=${r}\ \mathrm{fs}\end{aligned}`
    expect(checkStepArithmetic(twoLine('0.399186'))).toEqual({ bad: [], pairs: 1 })
    expect(checkStepArithmetic(twoLine('0.399286')).bad.length).toBe(1)
  })

  it('HC-14.3：σ_w 那一步的數字帶單位 fs（為了不在手機上多一條 2 px 的捲軸而拆成兩行，單位不能因此拿掉）', () => {
    const def = HANDCALCS.find((h) => h.id === 'HC-14.3')!
    const sol = def.solve(defaultValues(def))
    const rms = sol.steps.filter((s) => /^\\begin\{aligned\}\\sigma_\{w,[AB]\}&=\\sqrt/.test(s.tex))
    expect(rms.map((s) => s.tex)).toEqual([
      String.raw`\begin{aligned}\sigma_{w,A}&=\sqrt{0.15935}\\&=0.399186\ \mathrm{fs}\end{aligned}`,
      String.raw`\begin{aligned}\sigma_{w,B}&=\sqrt{0.0780532}\\&=0.27938\ \mathrm{fs}\end{aligned}`,
    ])
  })

  it('預設值、20 組隨機題、特殊分支：每一步的「代入數字 = 結果」都成立，沒有任何一步缺代入', () => {
    for (const def of HANDCALCS) {
      assertArithmetic(def, defaultValues(def))
      for (let seed = 1; seed <= 20; seed++) assertArithmetic(def, randomValues(def, seed))
    }
    const special: [string, Record<string, number>][] = [
      ['HC-14.1', { g: 1.5 }],
      ['HC-14.1', { g: 1 }],
      ['HC-14.2', { mu: 200 }],
      ['HC-14.2', { d0: 0 }],
      ['HC-14.2', { B: 1 }],
      ['HC-14.3', { muA: 200, muB: 150 }],
      ['HC-14.3', { muA: 5, muB: 10 }],
      ['HC-14.4', { d0: 10, tgt: 2 }],
      ['HC-14.4', { d0: 130 }],
      ['HC-14.5', { N: 8192 }],
      ['HC-14.6', { B: 11 }],
      ['HC-14.6', { B: 1 }],
      ['HC-14.7', { B: 2 }],
      ['HC-14.7', { d0: -3 }],
      ['HC-14.8', { theta: 60 }],
      ['HC-14.8', { theta: -45, eps: 0.01 }],
      ['HC-14.8', { eps: 0.001 }],
    ]
    for (const [id, patch] of special) assertArithmetic(hc(id), { ...defaultValues(hc(id)), ...patch })
  }, 60000)

  it('使用者自己的「不漂亮」數字（科學記號、p 很接近 1、接近 deadbeat、很大的 B）：通過 validate、TeX 可解析、算式仍然對得起來', () => {
    for (const [id, patch] of STRESS) {
      const def = hc(id)
      const v = { ...defaultValues(def), ...patch }
      const ctx = `${id} ${JSON.stringify(patch)}`
      expect(def.validate?.(v) ?? null, ctx).toBeNull()
      const sol = assertArithmetic(def, v)
      assertTexValid(def, sol, ctx)
      for (const r of sol.results) expect(Number.isFinite(r.value), `${ctx} ${r.symbol}`).toBe(true)
      for (const s of allStrings(def, sol)) expect(proseLeaks(s), ctx).toEqual([])
      const want = INDEPENDENT[id](v)
      sol.results.forEach((r, i) => expect(near(r.value, want[i], 1e-6, 1e-12), `${ctx} ${r.symbol}: ${r.value} vs ${want[i]}`).toBe(true))
      // 科學記號當底數、乘數或 ln 的引數時一定有括號：不會出現 10^{-5}^2（KaTeX double superscript）
      for (const s of sol.steps) {
        expect(s.tex, ctx).not.toMatch(/10\^\{-?\d+\}\^/)
        expect(s.tex, ctx).not.toMatch(/\\ln \d[\d.]*\\times/)
      }
    }
  }, 60000)

  it('p 很接近 1 時多顯示幾位：1 − p² 用畫面上的數字算，仍和下一格的結果一致到 5 位', () => {
    const def = hc('HC-14.2')
    const sol = def.solve({ ...defaultValues(def), mu: 0.01, B: 1000 }) // g = 7.98e-5
    const p2Step = sol.steps.find((s) => s.tex.startsWith('p^2='))?.tex ?? ''
    const shown = Number(p2Step.split('=').pop())
    const p = 1 - 0.01 * comparatorKq(100)
    expect(p2Step.split('=').pop()?.replace('.', '').replace(/^0+/, '').length).toBeGreaterThanOrEqual(8)
    expect(Math.abs((1 - shown) / (1 - p * p) - 1)).toBeLessThan(1e-5)
    // 一般情形（預設值）維持 6 位，不多顯示
    const d = def.solve(defaultValues(def))
    expect(d.steps.find((s) => s.tex.startsWith('p^2='))?.tex).toBe('p^2=0.920212^2=0.846789')
  })

  it('說明文字跟著數字走：HC-14.8 的「谷底很平」只在真的很平時出現；HC-14.6 的區間寬窄；HC-14.7 的近似條件；HC-14.4 的飽和', () => {
    const d8 = hc('HC-14.8')
    const n8 = (patch: Record<string, number>) => d8.solve({ ...defaultValues(d8), ...patch }).notes?.[0] ?? ''
    expect(n8({})).toMatch(/只比它多 \$0\.31\\%\$（谷底很平/)
    expect(n8({ eps: 0.5 })).toMatch(/太寬鬆.*還沒收完/)
    expect(n8({ eps: 0.5 })).not.toContain('谷底很平')
    expect(n8({ eps: 0.00005 })).toMatch(/還嚴.*variance/)
    expect(n8({ eps: 0.00005 })).not.toContain('谷底很平')
    // 全部的練習組合：「谷底很平」⇔ RMS 只多不到 2%
    const d8in = d8.inputs.map((i) => i.practice?.choices ?? [i.default])
    const combos = d8in.reduce<number[][]>((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]])
    expect(combos.length).toBeGreaterThan(1000)
    for (const c of combos.filter((_, k) => k % 7 === 0)) {
      const v = Object.fromEntries(d8.inputs.map((i, k) => [i.key, c[k]]))
      const sol = d8.solve(v)
      const K = loopGainK(v.sv, v.theta)
      const best = Math.sqrt(optimizeMu('final', { K, delta0: v.d0, sigmaEta2: 1 / v.N, B: v.T / v.N }).cost)
      const flat = val(sol, '\\sqrt{E[\\delta_B^2]}') / best - 1 < 0.02
      expect((sol.notes?.[0] ?? '').includes('谷底很平'), JSON.stringify(v)).toBe(flat)
    }

    const d6 = hc('HC-14.6')
    expect(d6.solve(defaultValues(d6)).notes?.[0]).toMatch(/區間非空，但寬度只有上限的 \$4\.39\\%\$/)
    expect(d6.solve({ ...defaultValues(d6), B: 40 }).notes?.[0]).toMatch(/區間非空，寬度是上限的.*還有選擇的空間/)
    expect(d6.solve({ ...defaultValues(d6), B: 11 }).notes?.[0]).toMatch(/^區間為空/)
    for (const B of [12, 40, 11]) expect(d6.solve({ ...defaultValues(d6), B }).notes?.every((n) => n.length > 0)).toBe(true)

    const d7 = hc('HC-14.7')
    expect(d7.solve(defaultValues(d7)).notes?.[1]).toMatch(/幾乎與 \$\\delta_0\$ 無關/)
    expect(d7.solve({ ...defaultValues(d7), d0: 0.0005 }).notes?.[1]).toMatch(/還沒有遠大於先驗資訊/)

    const d4 = hc('HC-14.4')
    expect(d4.solve(defaultValues(d4)).notes?.join('')).toContain('erf 沒有完全飽和')
    const sat = d4.solve({ ...defaultValues(d4), d0: 400 })
    expect(sat.notes?.join('')).toContain('幾乎完全飽和')
    expect(sat.steps[5].tex).toContain('=400-59.9962=340.004')

    // HC-14.5：4TK² 單獨一步，後面兩步都用同一個數；它就是模型的 A/δ0²
    const d5 = hc('HC-14.5')
    const s5 = d5.solve(defaultValues(d5))
    const a = asymptoticFinalOptimum({ K: comparatorKq(100), delta0: 3, sigmaEta2: 1 / 4096, B: 32 })
    const step = s5.steps.find((s) => s.tex.startsWith('4TK^2='))?.tex ?? ''
    expect(near(Number(step.replace(/\\ \\mathrm.*$/, '').split('=').pop()), a.A / 9, 1e-5)).toBe(true)
    expect(s5.steps.filter((s) => s.tex.includes('33.3772')).length).toBe(3)
    // 很小的百分比差不硬寫兩位有效數字（低於數值求根的解析度）
    expect(d5.solve({ ...defaultValues(d5), N: 1000, T: 1000000000 }).notes?.[0]).toContain('<0.01\\%')
  }, 60000)

  it('<HandCalc>：輸入科學記號等級的數字（K = 5e-5、ε = 5e-5、μ 使 p ≈ 0）也沒有 .katex-error', () => {
    const cases: [string, RegExp, string][] = [
      ['HC-14.7', /GMAC 斜率/, '0.00005'],
      ['HC-14.1', /GMAC 斜率/, '0.00005'],
      ['HC-14.8', /收斂要求/, '0.00005'],
      ['HC-14.6', /相對縮減比/, '0.00001'],
      ['HC-14.2', /learning rate/, '125.331'],
    ]
    for (const [id, label, value] of cases) {
      const { container, unmount } = render(<HandCalc def={hc(id)} />)
      fireEvent.change(within(container).getByLabelText(label), { target: { value } })
      expect(container.querySelector('.callout-warn'), id).toBeNull()
      expect(container.querySelectorAll('.c-step').length, id).toBeGreaterThan(0)
      expect(container.querySelector('.katex-error'), id).toBeNull()
      expect(container.querySelector('.c-tex-error'), id).toBeNull()
      unmount()
    }
  }, 60000)
})

function wrap(node: ReactNode) {
  return (
    <MemoryRouter initialEntries={['/ch/14']}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>
  )
}

describe('Ch14 帶入手算：(d) <HandCalc> 渲染', () => {
  it('每一題：沒有 .katex-error、步驟數與 solve() 相同、答案框與提示都在', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} />)
      expect(container.querySelector('.katex-error'), def.id).toBeNull()
      expect(container.querySelector('.c-tex-error'), def.id).toBeNull()
      expect(container.querySelectorAll('.c-step').length, def.id).toBe(sol.steps.length)
      expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
      expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length, def.id).toBe(sol.results.length)
      expect(container.querySelector('.c-handcalc-tips'), def.id).toBeTruthy()
      expect(container.querySelector(`#handcalc-${def.id.replace('.', '\\.')}`)).toBeTruthy()
      // 字串裡的 $…$ 都被轉成 KaTeX：KaTeX 以外的文字不含 $ 或 TeX 指令
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest('.katex')) continue
        expect(n.textContent ?? '', def.id).not.toMatch(/\$|\\[a-zA-Z]+|\^\{|_\{/)
      }
      unmount()
    }
  }, 60000)

  it('「換一題」連按 5 次：每一題都還是沒有 .katex-error，並切到「自己算算看」', () => {
    for (const def of HANDCALCS) {
      const { container, unmount } = render(<HandCalc def={def} />)
      for (let i = 0; i < 5; i++) {
        fireEvent.click(within(container).getByText('換一題（隨機數字）'))
        expect(container.querySelector('.katex-error'), def.id).toBeNull()
        expect(container.querySelector('.callout-warn'), `${def.id}：隨機題不應該被 validate 擋下`).toBeNull()
        expect(container.querySelectorAll('.c-handcalc-answer').length).toBeGreaterThan(0)
      }
      fireEvent.click(within(container).getByText('看詳解'))
      expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
      expect(container.querySelector('.katex-error'), def.id).toBeNull()
      unmount()
    }
  }, 60000)

  it('HC-14.6：把 ε 改成 1 ⇒ 顯示勘誤 E16 的原因（KaTeX）、詳解消失；改回 0.02 ⇒ 重新帶入', () => {
    const { container } = render(<HandCalc def={hc('HC-14.6')} />)
    const eps = screen.getByLabelText(/相對縮減比/) as HTMLInputElement
    fireEvent.change(eps, { target: { value: '1' } })
    const warn = container.querySelector('.callout-warn')
    expect(warn?.textContent).toContain('勘誤 E16')
    expect(warn?.querySelector('.katex')).toBeTruthy()
    expect(warn?.querySelector('.katex-error')).toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    fireEvent.change(eps, { target: { value: '0.02' } })
    expect(container.querySelector('.callout-warn')).toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
  }, 60000)

  it('HC-14.8：自己算算看——填入課程的四個數字（11.20、0.9106、87.4、10.68、0.449）全部判定正確', () => {
    const { container } = render(<HandCalc def={hc('HC-14.8')} initialMode="practice" />)
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const boxes = screen.getAllByPlaceholderText('你的答案')
    ;['11.20', '0.9106', '87.4', '10.68', '0.449'].forEach((t, i) => fireEvent.change(boxes[i], { target: { value: t } }))
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(5)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad').length).toBe(0)
  }, 60000)

  it('HC-14.8：θ = 95° ⇒「更新極性錯誤」', () => {
    const { container } = render(<HandCalc def={hc('HC-14.8')} />)
    fireEvent.change(screen.getByLabelText(/誤差路徑相位/), { target: { value: '95' } })
    expect(container.querySelector('.callout-warn')?.textContent).toContain('更新極性錯誤')
    expect(container.querySelectorAll('.c-step').length).toBe(0)
  }, 60000)

  it('validate 訊息可以用 MathText 渲染（沒有 katex-error）', () => {
    const def = hc('HC-14.5')
    const msg = def.validate?.({ ...defaultValues(def), d0: 0.5 }) as string
    const { container } = render(<MathText>{msg}</MathText>)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(1)
    expect(container.querySelector('.katex-error')).toBeNull()
  }, 60000)
})

describe('Ch14 頁面上的手算題位置', () => {
  it('8 題都在頁面上、各自緊跟在對應公式之後、綜合題在思考題之前；整頁沒有 .katex-error', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const { container } = render(wrap(<Chapter14 />))
    const el = (id: string) => container.querySelector(`[id="${id}"]`) as HTMLElement
    const before = (a: string, b: string) => {
      expect(el(a), a).toBeTruthy()
      expect(el(b), b).toBeTruthy()
      expect(el(a).compareDocumentPosition(el(b)) & Node.DOCUMENT_POSITION_FOLLOWING, `${a} 應在 ${b} 之前`).toBeTruthy()
    }
    for (const h of HANDCALCS) expect(el(`handcalc-${h.id}`), h.id).toBeTruthy()
    expect(container.querySelectorAll('.c-handcalc').length).toBe(HANDCALCS.length)
    // 每一題前面都有一句「換你算」的邀請
    expect(container.querySelectorAll('.ch14-handcalc-invite').length).toBe(HANDCALCS.length)
    for (const p of Array.from(container.querySelectorAll('.ch14-handcalc-invite'))) expect(p.textContent).toContain('換你算')
    // 位置：推導／worked example → 手算題 → 下一段
    before('ch14-hand', 'handcalc-HC-14.1')
    before('handcalc-HC-14.1', 'ch14-msd')
    before('formula-F-14.3', 'handcalc-HC-14.2')
    before('handcalc-HC-14.2', 'formula-F-14.6')
    before('formula-F-14.6', 'handcalc-HC-14.3')
    before('handcalc-HC-14.3', 'formula-F-14.4')
    before('formula-F-14.5', 'handcalc-HC-14.4')
    before('handcalc-HC-14.4', 'ch14-objectives')
    before('formula-F-14.8', 'handcalc-HC-14.5')
    before('handcalc-HC-14.5', 'formula-F-14.10')
    before('formula-F-14.16', 'handcalc-HC-14.6')
    before('handcalc-HC-14.6', 'formula-F-14.21')
    before('formula-F-14.19', 'handcalc-HC-14.7')
    before('handcalc-HC-14.7', 'ch14-state-machine')
    before('ch14-compare', 'handcalc-HC-14.8')
    before('handcalc-HC-14.8', 'ch14-quiz')
    expect(el('handcalc-HC-14.8').closest('#ch14-synthesis')).toBeTruthy()
    // 內文指回手算題的連結（§14.3 → HC-14.5、§14.4 → HC-14.8）
    // AnchorLink 的 href 是 '#/ch/14?a=handcalc-HC-14.5'（可複製、中鍵可用），不再是會被 HashRouter 當成路由的 '#handcalc-…'
    const links = Array.from(container.querySelectorAll('a[href*="handcalc-HC-14."]')).map((a) => a.getAttribute('href') ?? '')
    expect(links.some((h) => h.includes('a=handcalc-HC-14.5'))).toBe(true)
    expect(links.some((h) => h.includes('a=handcalc-HC-14.8'))).toBe(true)
    expect(links.every((h) => !h.startsWith('#handcalc-'))).toBe(true)
    // KaTeX 全部可解析；F-14.5 的程式碼 region 有顯示
    expect(Array.from(container.querySelectorAll('.katex-error')).map((e) => e.textContent)).toEqual([])
    expect(container.textContent).toContain('core:slewLimited')
    expect(container.textContent).not.toContain('程式碼載入錯誤')
  }, 120000)

  it('Task 2：標題與公式名稱裡的數學是 KaTeX（「$B$ 次更新後的均方誤差」「$|p|=1$ 的極限」「$C$ 是什麼」）', () => {
    const { container } = render(wrap(<Chapter14 />))
    const label = (id: string) => container.querySelector(`[id="formula-${id}"] .c-texblock-label`)
    expect(label('F-14.3')?.querySelector('.katex')).toBeTruthy()
    expect(label('F-14.3')?.textContent).toContain('次更新後的均方誤差')
    expect(label('F-14.4')?.querySelector('.katex')).toBeTruthy()
    expect(label('F-14.4')?.textContent).not.toContain('|p| = 1')
    const prereq = Array.from(container.querySelectorAll('.c-prereq summary, .c-prereq-title, .c-prereq')).find((e) => e.textContent?.includes('相關（correlation）'))
    expect(prereq?.querySelector('.katex')).toBeTruthy()
    // 字串屬性沒有漏出未轉換的 $
    // （.c-tip：TestBadge 的 tooltip 逐字列出 src/data/verification-status.json 裡的測試名稱，那是共用資料、不是本章的字串屬性；
    //   其中一個別頁的測試名稱本身就含有「`$...$`」字樣。ch14.test.tsx 的 unicodeMathLeaks 也同樣略過 .c-tip。）
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const dollars: string[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest('.katex, pre, code, script, style, .c-tip')) continue
      if ((n.textContent ?? '').includes('$')) dollars.push((n.textContent ?? '').slice(0, 60))
    }
    expect(dollars).toEqual([])
  }, 120000)
})
