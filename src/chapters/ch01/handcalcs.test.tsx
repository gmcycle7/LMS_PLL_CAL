import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import katex from 'katex'
import { HandCalc, MathText, checkAnswer, defaultValues, inputError, randomValues } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { createRng } from '@/simulation/core'
import { STEP, averageCost, batchOptima, lossValue } from '@/simulation/models/lms'
import {
  batchL1,
  batchL2,
  costCurves,
  fixedXStability,
  lmsSteadyState,
  mseParabola,
  playgroundEnsemble,
  playgroundTrace,
  populationOptima,
  signErrorDiffusionKappa,
  signErrorJitterApprox,
  signErrorLatticeStationary,
  type LossDataParams,
} from '@/simulation/models/lossCompare'
import type { PresetEntry } from '@/data/types'
import { DIFFUSION_KAPPA_MAX, DIFFUSION_SMALLNESS_MAX, HANDCALCS, OUTLIER_MIN_SIGMAS, handcalcOf } from './handcalcs'

interface GoldenVector {
  inputs: Record<string, number | number[]>
  expected: Record<string, number | number[]>
  tolerance: { abs?: number; rel?: number }
}
// 渲染 8 題（每題數十個 KaTeX 公式）與 20 個 seed 的嚴格 TeX 解析，在多個測試行程同時執行時會超過預設的 5 s；只放寬逾時，不放寬斷言
vi.setConfig({ testTimeout: 180_000 })

const golden = (id: string): GoldenVector => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8')) as GoldenVector
const preset = (id: string): PresetEntry => JSON.parse(readFileSync(resolve(process.cwd(), `src/data/presets/${id}.json`), 'utf8')) as PresetEntry

const values = (def: HandCalcDef, over: Record<string, number> = {}) => ({ ...defaultValues(def), ...over })
const solveDefault = (id: string, over: Record<string, number> = {}): HandCalcSolution => {
  const def = handcalcOf(id)
  return def.solve(values(def, over))
}
const vals = (sol: HandCalcSolution) => sol.results.map((r) => r.value)

/** 配對的 $...$（與 components/Tex.tsx 的 mathText 相同的規則） */
const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
const strictParse = (tex: string, displayMode: boolean): string | null => {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: 'ignore', displayMode })
    return null
  } catch (e) {
    return `${tex} ⇒ ${(e as Error).message}`
  }
}
/** 字串（why／notes／tips／validate 訊息）裡每一段 $...$ 都必須能被 KaTeX 嚴格解析，且 $ 必須成對 */
function inlineErrors(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(INLINE_MATH)) {
    const err = strictParse(m[1], false)
    if (err) out.push(err)
  }
  const rest = text.replace(INLINE_MATH, '').replace(/\\\$/g, '')
  if (rest.includes('$')) out.push(`未配對的 $：${text}`)
  // 手算題的文字一律用 LaTeX：$...$ 之外不可殘留下標／上標／希臘字母拼成的公式
  if (/[₀-₉⁰-⁹²³σμδεπΦφ√≤≥≠≈×∑]/.test(rest)) out.push(`$...$ 之外有 Unicode 數學符號：${rest}`)
  return out
}
/** 一題（定義 + 某組數字的解）所有 TeX 的嚴格檢查 */
function texErrors(def: HandCalcDef, sol: HandCalcSolution): string[] {
  const out: string[] = []
  const block = (t: string) => {
    const err = strictParse(t, true)
    if (err) out.push(err)
  }
  block(def.formulaTex)
  for (const i of def.inputs) {
    block(i.symbol)
    if (i.unit) block(i.unit)
  }
  for (const s of sol.steps) {
    block(s.tex)
    out.push(...inlineErrors(s.why))
    if (/NaN|Infinity|undefined/.test(s.tex)) out.push(`步驟出現非有限值：${s.tex}`)
  }
  for (const r of sol.results) block(`\\boxed{${r.symbol} = 1${r.unit ? `\\ ${r.unit}` : ''}}`)
  for (const t of [def.title, ...(sol.notes ?? []), ...(def.tips ?? []), ...def.inputs.map((i) => i.label), ...sol.results.map((r) => r.label ?? '')]) out.push(...inlineErrors(t))
  return out
}

// ───────────────────────── 步驟 TeX 的算術一致性：把每一段「純數字」的式子算出來，= 兩邊必須相等 ─────────────────────────

/** 數值與它的誤差上界（顯示的數字被四捨五入到 max(5, 顯示位數) 位有效數字；誤差一路傳播） */
interface Num {
  v: number
  err: number
}
const lit = (tok: string): Num => {
  const v = Number(tok)
  if (v === 0) return { v, err: 0 }
  const shown = tok.replace('.', '').replace(/^0+/, '').length
  return { v, err: 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(v))) - (Math.max(5, shown) - 1)) }
}
const mul = (p: Num, q: Num): Num => ({ v: p.v * q.v, err: Math.abs(p.v) * q.err + Math.abs(q.v) * p.err + p.err * q.err })
const div = (p: Num, q: Num): Num => {
  if (Math.abs(q.v) <= q.err) throw new Error('除以 0')
  return { v: p.v / q.v, err: (Math.abs(p.v) * q.err + Math.abs(q.v) * p.err) / (q.v * q.v - Math.abs(q.v) * q.err) }
}
const powInt = (p: Num, n: number): Num => {
  let out: Num = { v: 1, err: 0 }
  for (let k = 0; k < Math.abs(n); k++) out = mul(out, p)
  return n < 0 ? div({ v: 1, err: 0 }, out) : out
}

/**
 * 把手算步驟裡「只有數字」的 TeX 片段算成數值：支援 + − \times \cdot / ^ ( ) | | \frac \tfrac \sqrt e^{…} \big。
 * 含有符號（字母、其他指令）的片段回傳 null（那是通式，不是代入後的數字）。
 */
function evalTex(src: string): Num | null {
  const toks = src.match(/\\[a-zA-Z]+|\\[,;! ]|\d+\.\d+|\d+|\S/g) ?? []
  const t = toks.filter((k) => !/^\\(big|Big|bigg|left|right|[,;! ]|quad|qquad)$/.test(k))
  if (!t.length) return null
  let i = 0
  const peek = () => t[i]
  const take = () => t[i++]
  const expect1 = (k: string) => {
    if (take() !== k) throw new Error(`預期 ${k}`)
  }
  const braced = (f: () => Num): Num => {
    expect1('{')
    const v = f()
    expect1('}')
    return v
  }
  const expr = (inAbs = false): Num => {
    let v = term(inAbs)
    while (peek() === '+' || peek() === '-') {
      const op = take()
      const r = term(inAbs)
      v = { v: op === '+' ? v.v + r.v : v.v - r.v, err: v.err + r.err }
    }
    return v
  }
  const term = (inAbs: boolean): Num => {
    let v = unary(inAbs)
    for (;;) {
      const k = peek()
      if (k === '\\times' || k === '\\cdot') {
        take()
        v = mul(v, unary(inAbs))
      } else if (k === '/') {
        take()
        v = div(v, unary(inAbs))
      } else if (k === '(' || k === '\\frac' || k === '\\tfrac' || k === '\\sqrt' || (k === '|' && !inAbs)) v = mul(v, unary(inAbs)) // 省略乘號
      else return v
    }
  }
  const unary = (inAbs: boolean): Num => {
    if (peek() === '-') {
      take()
      const r = unary(inAbs)
      return { v: -r.v, err: r.err }
    }
    return power(inAbs)
  }
  const exponent = (): number => {
    const read = () => {
      let sign = 1
      if (peek() === '-') {
        take()
        sign = -1
      }
      const k = take()
      if (!/^\d+$/.test(k ?? '')) throw new Error('指數不是整數')
      return sign * Number(k)
    }
    if (peek() === '{') {
      take()
      const n = read()
      expect1('}')
      return n
    }
    return read()
  }
  const power = (inAbs: boolean): Num => {
    if (peek() === 'e' && t[i + 1] === '^') {
      i += 2
      const a = peek() === '{' ? braced(() => expr()) : atom(inAbs)
      return { v: Math.exp(a.v), err: Math.exp(a.v) * a.err * 1.01 }
    }
    const base = atom(inAbs)
    if (peek() !== '^') return base
    take()
    return powInt(base, exponent())
  }
  const atom = (inAbs: boolean): Num => {
    const k = take()
    if (k === undefined) throw new Error('式子不完整')
    if (/^\d/.test(k)) return lit(k)
    if (k === '(') {
      const v = expr()
      expect1(')')
      return v
    }
    if (k === '{') {
      const v = expr()
      expect1('}')
      return v
    }
    if (k === '|' && !inAbs) {
      const v = expr(true)
      expect1('|')
      return { v: Math.abs(v.v), err: v.err }
    }
    if (k === '\\frac') return div(braced(() => expr()), braced(() => expr()))
    if (k === '\\tfrac') {
      if (peek() === '{') return div(braced(() => expr()), braced(() => expr()))
      const d = take() // \tfrac12、\tfrac14：兩個個位數黏在一起
      if (!/^\d\d$/.test(d ?? '')) throw new Error('不支援的 \\tfrac')
      return { v: Number(d[0]) / Number(d[1]), err: 0 }
    }
    if (k === '\\sqrt') {
      const a = braced(() => expr())
      if (a.v < 0) throw new Error('負數開根號')
      return { v: Math.sqrt(a.v), err: a.v > 0 ? a.err / (2 * Math.sqrt(a.v)) + 1e-12 : Math.sqrt(a.err) }
    }
    throw new Error(`符號 ${k}`)
  }
  try {
    const v = expr()
    return i === t.length ? v : null
  } catch {
    return null
  }
}

/** 以頂層的 = 切開（不切大括號裡的 =） */
function splitTop(row: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of row) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === '=' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * 一步的 TeX 裡每一條「數字 = 數字 = …」的鏈：相鄰兩段必須在四捨五入誤差內相等。
 * 回傳 { chains: 純數字片段的總數, errors: 不一致之處 }。
 */
function chainReport(tex: string): { chains: number; errors: string[] } {
  const errors: string[] = []
  let chains = 0
  const body = tex.replace(/\\(begin|end)\{(aligned|gathered)\}/g, '')
  for (const row of body.split(/\\\\(?:\[[^\]]*\])?/)) {
    const segs = splitTop(row.replace(/&/g, '').replace(/\\approx/g, '='))
      .map((sg) => sg.replace(/\\ \\checkmark\s*$/, '').replace(/\\qquad\(.*\)\s*$/, '').trim())
      .map((sg) => ({ sg, n: evalTex(sg) }))
      .filter((x): x is { sg: string; n: Num } => x.n !== null)
    chains += segs.length
    for (let k = 1; k < segs.length; k++) {
      const p = segs[k - 1]
      const q = segs[k]
      const slack = p.n.err + q.n.err + 1e-12 * Math.max(1, Math.abs(p.n.v), Math.abs(q.n.v))
      if (Math.abs(p.n.v - q.n.v) > slack) errors.push(`${p.sg} = ${p.n.v}（±${p.n.err}） ≠ ${q.sg} = ${q.n.v}（±${q.n.err}）`)
    }
  }
  return { chains, errors }
}

/** 相對誤差比較（|a − b| ≤ rel·max(1, |b|)） */
function expectClose(actual: number, expected: number, rel = 1e-9, msg = '') {
  expect(Math.abs(actual - expected), `${msg} actual=${actual} expected=${expected}`).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)))
}

// ───────────────────────── 測試內獨立重算用的小工具（不呼叫模型函式） ─────────────────────────

const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)
/** Φ(z)：0.5 + ∫₀ᶻ φ（Simpson 400 段） */
function Phi(z: number): number {
  const n = 400
  const h = z / n
  let s = phi(0) + phi(z)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * phi(i * h)
  return 0.5 + (s * h) / 3
}
/** Φ⁻¹(q)：二分法（q ∈ (0.5, 1) 的小範圍就夠） */
function PhiInv(q: number): number {
  let lo = -8
  let hi = 8
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi)
    if (Phi(mid) < q) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}
const sgn0 = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0)

/** 每一題的「獨立重算」：只用基本算術，順序與 results 相同 */
const RECOMPUTE: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-01.1': ({ x1, y1, x2, y2, x3, y3, a }) => {
    const sxx = x1 * x1 + x2 * x2 + x3 * x3
    const sxy = x1 * y1 + x2 * y2 + x3 * y3
    const sxv = x1 * (y1 - a * x1) + x2 * (y2 - a * x2) + x3 * (y3 - a * x3)
    return [sxx, sxy, sxy / sxx, sxv / sxx]
  },
  'HC-01.2': ({ sxx, sxy, syy, N, w }) => {
    const [Exx, Exy, Eyy] = [sxx / N, sxy / N, syy / N]
    return [0.5 * (Eyy - 2 * w * Exy + w * w * Exx), w * Exx - Exy, Exy / Exx, 0.5 * (Eyy - (Exy * Exy) / Exx)]
  },
  'HC-01.3': ({ w, x, y, mu }) => {
    const e = y - w * x
    return [w + mu * e * x, w + 2 * mu * e * x, 1 - mu * x * x, 1 - 2 * mu * x * x, 2 / (x * x)]
  },
  'HC-01.4': ({ a, w0, x, mu, sigma, n }) => {
    const p = 1 - mu * x * x
    let acc = 0 // 直接把 n 步注入的變異數逐項相加（不用等比級數公式）
    for (let k = 0; k < n; k++) acc += (mu * x * sigma) ** 2 * p ** (2 * k)
    const vInf = (mu * sigma * sigma) / (2 - mu * x * x)
    return [p, a - p ** n * (a - w0), acc, vInf, Math.sqrt(vInf)]
  },
  'HC-01.5': ({ w, x, y, mu, dH }) => {
    const e = y - w * x
    const clip = Math.max(-dH, Math.min(dH, e))
    return [e, w + mu * e * x, w + mu * sgn0(e) * x, w + mu * clip * x, Math.abs(e) <= dH ? 0.5 * e * e : dH * (Math.abs(e) - 0.5 * dH)]
  },
  'HC-01.6': ({ y1, y2, y3, y4, w }) => {
    const y = [y1, y2, y3, y4]
    const s = [...y].sort((p, q) => p - q)
    const below = y.filter((t) => t < w).length
    const above = y.filter((t) => t > w).length
    return [(y1 + y2 + y3 + y4) / 4, s[1], s[2], (below - above) / 4, y.reduce((acc, t) => acc + Math.abs(t - s[1]), 0) / 4]
  },
  'HC-01.7': ({ mu, sigma }) => {
    const kq = Math.sqrt(2 / Math.PI) / sigma
    const vSe = mu / (2 * kq)
    const muL = mu * kq
    const vLms = (muL * sigma * sigma) / (2 - muL)
    return [kq, vSe, Math.sqrt(vSe), vLms, vSe / vLms]
  },
  'HC-01.8': ({ a, sigma, eps, s, mu }) => {
    const z = eps === 0 ? 0 : PhiInv(1 / (2 * (1 - eps)))
    const f = ((1 - eps) * phi(z)) / sigma
    return [a + eps * s, Math.sqrt((mu * (sigma * sigma + eps * (1 - eps) * s * s)) / (2 - mu)), sigma * z, Math.sqrt(mu / (4 * f))]
  },
}
/** 各題獨立重算的相對容忍度（HC-01.8 的 Φ⁻¹ 用 Simpson + 二分法，精度約 1e-9） */
const RECOMPUTE_TOL: Record<string, number> = { 'HC-01.8': 1e-7 }

describe('Ch01 帶入手算：題目清單', () => {
  it('8 題、id 為 HC-01.1 … HC-01.8、頁面 /ch/01；三種難度都有；每個輸入的預設值都在合法範圍內', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(Array.from({ length: 8 }, (_, i) => `HC-01.${i + 1}`))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/01')
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(2)
      for (const i of h.inputs) expect(inputError(i, i.default), `${h.id} ${i.key}`).toBeNull()
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      expect(Object.keys(RECOMPUTE)).toContain(h.id)
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    expect(() => handcalcOf('HC-99.9')).toThrow()
  })
})

describe('Ch01 帶入手算 (a)：預設數字 = 模型函式 = 本章 worked example', () => {
  const X = [1, 2, 4]
  const Y = [3.2, 5.7, 12.5]

  it('HC-01.1：§1.0／§1.2 的三筆資料 ⇒ Σx² = 21、Σxy = 64.6、w* = 64.6/21 = 3.07619（batchL2）、bias = 1.6/21', () => {
    const [sxx, sxy, wStar, bias] = vals(solveDefault('HC-01.1'))
    expect(sxx).toBe(21)
    expectClose(sxy, 64.6)
    expect(wStar).toBe(batchL2(X, Y))
    expect(wStar).toBeCloseTo(3.07619, 5) // 章內顯示的數字
    expectClose(bias, 1.6 / 21)
    expectClose(3 + bias, wStar) // F-01.4 的兩種寫法一致
    // 文中的兩個「試試看」：v = 0.5x ⇒ bias 恰為 0.5；Σxv = 0 ⇒ w* = a
    expectClose(vals(solveDefault('HC-01.1', { y1: 3.5, y2: 7, y3: 14 }))[3], 0.5)
    const ortho = solveDefault('HC-01.1', { y1: 3.4, y2: 6.2, y3: 11.8 })
    expect(vals(ortho)[3]).toBe(0)
    expectClose(vals(ortho)[2], 3)
  })

  it('HC-01.1 的 normal equation 驗算（F-01.5）：殘差 (0.1238095, −0.452381, 0.1952381) 與 x 正交，Σe*x = 0；步驟顯示 7 位，照著顯示的數字相加也是 0；= mseParabola 在 w* 的斜率；換題 20 次也都是 0', () => {
    const def = handcalcOf('HC-01.1')
    const neStep = (sol: HandCalcSolution) => sol.steps.find((s) => s.tex.startsWith(String.raw`\sum_i e^*_ix_i=`))!
    const sol = solveDefault('HC-01.1')
    expect(sol.steps.some((s) => s.tex.includes('3.2-3.07619\\times1=0.1238095') && s.tex.includes('=-0.452381') && s.tex.includes('=0.1952381'))).toBe(true)
    expect(neStep(sol).tex.endsWith('=0.1238095+(-0.9047619)+0.7809524=0')).toBe(true)
    // 讀者照著顯示的數字手算：三個乘積相加的尾數 < 10⁻⁶（舊版只顯示 5 位時，換題後會剩下 10⁻³）
    expect(Math.abs(0.1238095 - 0.9047619 + 0.7809524)).toBeLessThan(1e-6)
    expect(Math.abs(0.1238095 * 1 + -0.452381 * 2 + 0.1952381 * 4)).toBeLessThan(1e-6)
    // w* 在第 3、4、9 步都顯示成同一個數（3.07619），答案框也是
    expect(sol.steps.filter((s) => s.tex.includes('3.07619')).length).toBeGreaterThanOrEqual(3)
    expect(sol.steps.some((s) => s.tex.endsWith(String.raw`=3+0.07619048=3.07619=w^*\ \checkmark`))).toBe(true)
    expect(sol.results[2].digits).toBe(6)
    // 獨立重算：Σ(yᵢ − w*xᵢ)xᵢ = Σxy − w*Σx² = 0；也就是成本拋物線在 w* 的斜率（× −N）
    const wStar = 64.6 / 21
    expect(Math.abs(X.reduce((s, xi, i) => s + (Y[i] - wStar * xi) * xi, 0))).toBeLessThan(1e-12)
    expect(Math.abs(mseParabola(21 / 3, 64.6 / 3, 198.98 / 3, batchL2(X, Y)).slope)).toBeLessThan(1e-12)
    // 提示：只取 w* ≈ 3.08 時總和剩下 64.6 − 3.08 × 21 = −0.08（捨入，不是公式錯）
    expectClose(64.6 - 3.08 * 21, -0.08)
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      const s = def.solve(v)
      expect(neStep(s).tex.endsWith('=0'), `seed ${seed} ${neStep(s).tex}`).toBe(true)
      // 顯示出來的三個乘積（7 位有效數字）相加，尾數必須小到看得出是 0
      const shown = neStep(s).tex.split('=').at(-2)!
      const total = evalTex(shown)!
      expect(Math.abs(total.v), `seed ${seed} ${shown}`).toBeLessThan(2e-5)
      const w = (v.x1 * v.y1 + v.x2 * v.y2 + v.x3 * v.y3) / (v.x1 ** 2 + v.x2 ** 2 + v.x3 ** 2)
      const direct = (v.y1 - w * v.x1) * v.x1 + (v.y2 - w * v.x2) * v.x2 + (v.y3 - w * v.x3) * v.x3
      expect(Math.abs(direct), `seed ${seed}`).toBeLessThan(1e-9)
    }
  })

  it('HC-01.2：§1.2 的拋物線——J(2.5) = 1.205、斜率 −4.0333、w* = 3.07619、J(w*) = 0.043016；與逐筆平均成本（lms.averageCost）、costCurves、batchL2 一致', () => {
    const [J, slope, wStar, jMin] = vals(solveDefault('HC-01.2'))
    expectClose(J, averageCost('mse', 2.5, X, Y))
    expectClose(J, 1.205)
    expectClose(slope, -(64.6 / 3 - 2.5 * 7)) // Parabola.tsx 的切線斜率 −E[e·x]
    expect(slope).toBeCloseTo(-4.0333, 4)
    expect(wStar).toBe(batchL2(X, Y))
    const cc = costCurves(X, Y, [2.5, wStar], 1).mse
    expectClose(J, cc[0])
    expectClose(jMin, cc[1], 1e-12)
    expect(jMin).toBeCloseTo(0.043016, 6)
    // normal equation（F-01.5，動差形式）放在 §1.2.1 的推導正後方：E[e*x] = E[xy] − w*E[x²] = 21.53333 − 3.07619 × 7 = 0
    const neq = solveDefault('HC-01.2').steps.find((st) => st.tex.startsWith('E[e^*x]='))!
    expect(neq.tex).toBe(String.raw`E[e^*x]=E[xy]-w^*E[x^2]=21.53333-3.07619\times7=21.53333-21.53333=0`)
    expect(neq.why).toMatch(/F-01\.5/)
    expectClose(64.6 / 3 - (64.6 / 21) * 7, 0)
    expect(Math.abs(X.reduce((acc, xi, i) => acc + (Y[i] - wStar * xi) * xi, 0) / 3)).toBeLessThan(1e-12) // 逐筆算的 E[e*x] 也是 0
    for (let seed = 1; seed <= 20; seed++) {
      const st = handcalcOf('HC-01.2').solve(randomValues(handcalcOf('HC-01.2'), seed)).steps.find((q) => q.tex.startsWith('E[e^*x]='))!
      expect(st.tex.endsWith('=0'), `seed ${seed} ${st.tex}`).toBe(true)
    }
    // 提示中的 §1.4 對照：固定 x = 2、y = 6 ⇒ w* = 3、J(w*) = 0、斜率 −(a − w)x²
    const hand = vals(solveDefault('HC-01.2', { sxx: 4, sxy: 12, syy: 36, N: 1, w: 1 }))
    expect(hand).toEqual([8, -8, 3, 0])
  })

  it('mseParabola（lossCompare.ts 新增的 core 函式）：隨機資料上 J = 逐筆平均成本、w* = batchL2、J = J(w*) + 二次碗、w* 處斜率為 0；x ≡ 0 時 w* 為 NaN', () => {
    const rng = createRng(20261010)
    for (let t = 0; t < 50; t++) {
      const n = 2 + Math.floor(rng.uniform() * 6)
      const x = Array.from({ length: n }, () => 3 * rng.normal())
      const y = Array.from({ length: n }, () => 5 * rng.normal())
      const w = 4 * rng.normal()
      const mean = (f: (i: number) => number) => x.reduce((s, _, i) => s + f(i), 0) / n
      const [Exx, Exy, Eyy] = [mean((i) => x[i] * x[i]), mean((i) => x[i] * y[i]), mean((i) => y[i] * y[i])]
      const m = mseParabola(Exx, Exy, Eyy, w)
      expectClose(m.J, averageCost('mse', w, x, y), 1e-10)
      expectClose(m.wStar, batchL2(x, y), 1e-10)
      expectClose(m.jMin, averageCost('mse', m.wStar, x, y), 1e-9)
      expectClose(m.jMin + m.bowl, m.J, 1e-10)
      expectClose(mseParabola(Exx, Exy, Eyy, m.wStar).slope, 0, 1e-10)
      // 斜率 = 數值微分
      const h = 1e-5
      expectClose(m.slope, (averageCost('mse', w + h, x, y) - averageCost('mse', w - h, x, y)) / (2 * h), 1e-6)
    }
    const flat = mseParabola(0, 0, 4, 1.7)
    expect(flat.J).toBe(2)
    expect(flat.slope).toBe(0)
    expect(Number.isNaN(flat.wStar) && Number.isNaN(flat.jMin) && Number.isNaN(flat.bowl)).toBe(true)
  })

  it('T02: HC-01.3 預設（x = 2、μ = 0.4）⇒ LMS 的 p = −0.6（golden pole_list）、μ_max = 0.5（golden mu_max）；「J₂ 配 μ」的 p = −2.2 發散、w 走到 7.4', () => {
    const g = golden('T02')
    const [wLms, wDbl, p, p2, muMax] = vals(solveDefault('HC-01.3'))
    const i = (g.inputs.mu_list as number[]).indexOf(0.4)
    expect(Math.abs(p - (g.expected.pole_list as number[])[i])).toBeLessThanOrEqual(g.tolerance.abs ?? 0)
    expect(Math.abs(muMax - (g.expected.mu_max as number))).toBeLessThanOrEqual(g.tolerance.abs ?? 0)
    expect((g.expected.converges_list as number[])[i]).toBe(1) // μ = 0.4 的 LMS 收斂
    expectClose(wLms, 4.2)
    expectClose(wDbl, 7.4)
    expectClose(p2, -2.2)
    // 與實際步進器一致：「J₂ 配 μ」= 步長 2μ 的 LMS
    expect(wLms).toBe(STEP.conventional({ w: 1, x: 2, y: 6, mu: 0.4 }).w)
    expect(wDbl).toBe(STEP.conventional({ w: 1, x: 2, y: 6, mu: 0.8 }).w)
    // 誤差真的每步乘上 p：δ = a − w（勘誤 E39），a = y/x = 3
    expectClose((3 - wLms) / (3 - 1), p)
    expectClose((3 - wDbl) / (3 - 1), p2)
    // 步驟裡寫的「錯誤上限」1/x² 就是 golden 的 mu_one_step
    expect(fixedXStability(0.4, 2).muOneStep).toBe(g.expected.mu_one_step)
    // x² 先單獨算一步，後面的 pole 與上限都代同一個數；μ/2 那一步把除法寫出來
    const tex = solveDefault('HC-01.3').steps.map((s) => s.tex)
    expect(tex).toContain('x^2=2^2=4')
    expect(tex.indexOf('x^2=2^2=4')).toBeLessThan(tex.findIndex((t) => t.startsWith('p=')))
    expect(tex.some((t) => t.endsWith(String.raw`=1-\frac{0.4}{2}\times(-16)=1-0.2\times(-16)=4.2`))).toBe(true)
    expect(solveDefault('HC-01.3', { x: -2 }).steps.map((s) => s.tex)).toContain('x^2=(-2)^2=4')
  })

  it('T01: HC-01.3 把 μ 改成 0.1 ⇒ w_LMS = 1.8（golden w1）；HC-01.4 預設 ⇒ E[w₂] = 2.28（golden w2）、p = 0.6（golden pole）', () => {
    const g = golden('T01')
    const tol = g.tolerance.abs ?? 0
    expect(Math.abs(vals(solveDefault('HC-01.3', { mu: 0.1 }))[0] - (g.expected.w1 as number))).toBeLessThanOrEqual(tol)
    const def = handcalcOf('HC-01.4')
    expect(values(def)).toMatchObject({ a: g.inputs.a, w0: g.inputs.w0, x: g.inputs.x, mu: g.inputs.mu })
    const [p, w2] = vals(def.solve(values(def)))
    expect(Math.abs(p - (g.expected.pole as number))).toBeLessThanOrEqual(tol)
    expect(Math.abs(w2 - (g.expected.w2 as number))).toBeLessThanOrEqual(tol)
    const trace = g.expected.w_trace as number[]
    for (let n = 1; n < trace.length; n++) expect(Math.abs(vals(def.solve(values(def, { n })))[1] - trace[n]), `n=${n}`).toBeLessThanOrEqual(tol)
  })

  it('HC-01.4：σ_v = 1 ⇒ Var(w₂) = 0.0544、Var(w∞) = 0.0625、std = 0.25（§1.4.1／勘誤 E42 的數值證據）；與 Monte Carlo（playgroundEnsemble，4000 條路徑）在 4·SE 內一致', () => {
    const [, w2, var2, varInf, stdInf] = vals(solveDefault('HC-01.4'))
    expectClose(var2, 0.0544)
    expectClose(varInf, 0.0625)
    expectClose(stdInf, 0.25)
    const mc = playgroundEnsemble({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 2, noiseSigma: 1, seed: 20261010, paths: 4000 })
    expect(Math.abs(mc.varW - var2)).toBeLessThan(4 * mc.seVar)
    expect(Math.abs(mc.meanW - w2)).toBeLessThan(4 * Math.sqrt(var2 / mc.paths))
    // 無雜訊軌跡的第 2 步就是平均值
    expect(playgroundTrace({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 2, noiseSigma: 0, seed: 1 }).w[2]).toBe(w2)
  })

  it('HC-01.4 的中間步驟一次只做一種運算，數字與等比級數逐項相加一致：p² = 0.36、p⁴ = 0.1296、1 − p⁴ = 0.8704、1 − p² = 0.64、0.04 × 0.8704/0.64 = 0.0544', () => {
    const tex = solveDefault('HC-01.4').steps.map((s) => s.tex)
    expect(tex.some((t) => t.includes('p^2=0.6^2=0.36'))).toBe(true)
    expect(tex.some((t) => t.includes(String.raw`\big(p^{\,2}\big)^2=0.36^2=0.1296`))).toBe(true)
    expect(tex.some((t) => t.includes('1-0.1296=0.8704') && t.includes('1-0.36=0.64'))).toBe(true)
    expect(tex.some((t) => t.includes(String.raw`0.04\times\frac{0.8704}{0.64}=0.0544`))).toBe(true)
    // μx² 先算一次（p 與穩態公式的分母都用它）；穩態公式先化成「分子／分母」再相除；MSE 把兩項分開
    expect(tex[0]).toBe(String.raw`\mu x^2=0.1\times2^2=0.4`)
    expect(tex[1]).toBe(String.raw`p=1-\mu x^2=1-0.4=0.6`)
    expect(tex.some((t) => t.endsWith(String.raw`=0.1^2\times2^2\times1^2=0.01\times4\times1=0.04`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`=\frac{0.1\times1^2}{2-0.4}=\frac{0.1}{1.6}=0.0625`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`=2^2\times0.0625+1^2=0.25+1=1.25`))).toBe(true)
    // 逐項相加：μ²x²σ²(1 + p²) = 0.04 × 1.36
    expectClose(0.04 * (1 + 0.36), 0.0544)
    // p < 0（μ = 0.4 ⇒ p = −0.6）：負數代入時加括號，並提醒計算機的 [x^y] 可能不接受負的底數
    const neg = solveDefault('HC-01.4', { mu: 0.4, n: 3 })
    const negTex = neg.steps.map((s) => s.tex)
    expect(negTex.some((t) => t.includes('(-0.6)^{3}=-0.216'))).toBe(true)
    expect(negTex.some((t) => t.includes(String.raw`\big(p^{\,3}\big)^2=(-0.216)^2=0.046656`))).toBe(true)
    expect(neg.steps.some((s) => /負的底數/.test(s.why))).toBe(true)
    expect(solveDefault('HC-01.4').steps.some((s) => /負的底數/.test(s.why))).toBe(false)
    // 註記依 p 的正負分三種：p > 0 是速度與抖動的取捨；p = 0 一步到位；p < 0（μ 超過 1/x²）兩頭都吃虧
    expect(solveDefault('HC-01.4').notes![0]).toMatch(/永遠的取捨/)
    expect(solveDefault('HC-01.4', { mu: 0.25 }).notes![0]).toMatch(/一步到答案/)
    expect(neg.notes![0]).toMatch(/兩頭都吃虧/)
    // 「兩頭都吃虧」的數值證據：x = 2 時 μ = 0.4（p = −0.6）比 μ = 0.25（p = 0）收斂慢、穩態變異數也大
    expect(vals(solveDefault('HC-01.4', { mu: 0.4 }))[3]).toBeGreaterThan(vals(solveDefault('HC-01.4', { mu: 0.25 }))[3])
  })

  it('HC-01.5：§2.2.1 的單步比較（e = 2）⇒ LMS 1.4、Sign-Error 1.2、Huber 1.2；ρ_H = 1.5；與 lms.ts 的 STEP 完全相同', () => {
    const [e, wLms, wSe, wH, rhoH] = vals(solveDefault('HC-01.5'))
    const s = { w: 1, x: 1, y: 3, mu: 0.2, tie: 'zero' as const, huberDelta: 1 }
    expect(e).toBe(2)
    expect(wLms).toBe(STEP.conventional(s).w)
    expect(wSe).toBe(STEP.sign_error(s).w)
    expect(wH).toBe(STEP.huber(s).w)
    expect([wLms, wSe, wH]).toEqual([1.4, 1.2, 1.2])
    expect(rhoH).toBe(lossValue('huber', 2, 1))
    expect(rhoH).toBe(1.5)
    // 提示：y = 21（outlier）時 LMS 一步跳 4，其他兩個仍只走 0.2；y = 1.5 時 Huber = LMS
    const out = vals(solveDefault('HC-01.5', { y: 21 }))
    expectClose(out[1] - 1, 4)
    expectClose(out[2] - 1, 0.2)
    expectClose(out[3] - 1, 0.2)
    const small = vals(solveDefault('HC-01.5', { y: 1.5 }))
    expect(small[3]).toBe(small[1])
    // Huber 損失兩個分支都把數字代進去：門檻外 δ_H(|e| − ½δ_H)、門檻內 ½e²
    expect(solveDefault('HC-01.5').steps.at(-1)!.tex.endsWith(String.raw`=1\times\big(2-\tfrac12\times1\big)=1\times1.5=1.5`)).toBe(true)
    expect(solveDefault('HC-01.5', { y: 1.5 }).steps.at(-1)!.tex).toContain(String.raw`=\tfrac12\times0.5^2=0.125`)
  })

  it('HC-01.6：{0,0,0,10} ⇒ 平均 2.5、中位數 [0, 0]、w = 5 的斜率 0.5、J_MAE(0) = 2.5（規格 §2.3；batchOptima = batchL2／batchL1）', () => {
    const [mean, lo, hi, slope, jMed] = vals(solveDefault('HC-01.6'))
    const y = [0, 0, 0, 10]
    const ones = [1, 1, 1, 1]
    expect([mean, lo, hi, slope, jMed]).toEqual([2.5, 0, 0, 0.5, 2.5])
    expect(mean).toBe(batchL2(ones, y))
    expect(batchL1(ones, y)).toEqual({ lo, hi })
    expect(batchOptima(y)).toEqual({ mse: mean, maeLow: lo, maeHigh: hi })
    // 斜率 = MAE 成本的數值微分
    const h = 1e-6
    expectClose(slope, (averageCost('mae', 5 + h, ones, y) - averageCost('mae', 5 - h, ones, y)) / (2 * h), 1e-8)
    // 思考題 3：{1,2,3,100} 的中位數是整段 [2, 3]，區間內斜率為 0
    const q3 = vals(solveDefault('HC-01.6', { y1: 1, y2: 2, y3: 3, y4: 100, w: 2.5 }))
    expect(q3.slice(0, 4)).toEqual([26.5, 2, 3, 0])
    // §2.3 成本表的四個數（3.75、2.5、9.375、12.5）在步驟裡都從 |yᵢ − w| 一路算出來：先距離、再平方
    const tex = solveDefault('HC-01.6').steps.map((s) => s.tex)
    expect(tex.some((t) => t.endsWith(String.raw`\big(|0-2.5|+|0-2.5|+|0-2.5|+|10-2.5|\big)=\tfrac14\big(2.5+2.5+2.5+7.5\big)=3.75`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`\big(|0-0|+|0-0|+|0-0|+|10-0|\big)=\tfrac14\big(0+0+0+10\big)=2.5`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`\big(2.5^2+2.5^2+2.5^2+7.5^2\big)=\tfrac14\cdot\tfrac12\big(6.25+6.25+6.25+56.25\big)=9.375`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`\big(0^2+0^2+0^2+10^2\big)=\tfrac14\cdot\tfrac12\big(0+0+0+100\big)=12.5`))).toBe(true)
  })

  it('T04: HC-01.7 以 σ_v = 100 fs 代入 ⇒ K_q = 0.00797885 fs⁻¹（golden kq_per_fs）', () => {
    const g = golden('T04')
    const [kq] = vals(solveDefault('HC-01.7', { sigma: g.inputs.sigma_fs as number, mu: 1 }))
    expect(Math.abs(kq - (g.expected.kq_per_fs as number))).toBeLessThanOrEqual(g.tolerance.abs ?? 0)
  })

  it('HC-01.7：§2.3.2 表格的 σ_v = 1、μ = 0.05 ⇒ 近似 std 0.17701（signErrorJitterApprox）、同速度 LMS 變異數 0.020353（lmsSteadyState）、比值 1.5395 → π/2；與格點鏈精確 std 相差 < 1%', () => {
    const [kq, vSe, sdSe, vLms, ratio] = vals(solveDefault('HC-01.7'))
    const p: LossDataParams = { model: 'contaminated', a: 0, xDist: 'const', xScale: 1, sigma: 1, outlierProb: 0, outlierSize: 0, outlierSign: 'positive', n: 0, seed: 0 }
    const jit = signErrorJitterApprox(p, 0.05)
    expect(vSe).toBe(jit.variance)
    expect(kq).toBe(2 * jit.density)
    expect(vLms).toBe(lmsSteadyState(p, 0.05 * kq).variance)
    expect(sdSe).toBeCloseTo(0.17701, 5)
    expect(vLms).toBeCloseTo(0.020353, 6)
    expect(ratio).toBeCloseTo(1.5395, 4)
    expect(ratio).toBeLessThan(Math.PI / 2)
    const lat = signErrorLatticeStationary(p, { w0: 0, mu: 0.05, tie: 'zero' })!
    expect(Math.abs(sdSe / lat.std - 1)).toBeLessThan(0.01)
    // 提示裡寫的數字：格點鏈精確 std 0.1784、同速度 LMS 的 std √0.020353 = 0.1427
    expect(lat.std).toBeCloseTo(0.1784, 4)
    expect(Math.sqrt(vLms)).toBeCloseTo(0.1427, 4)
    // 步驟說明裡的 dB 換算：10·log10(π/2) ≈ 1.96 dB
    expect(10 * Math.log10(Math.PI / 2)).toBeCloseTo(1.96, 2)
    // 兩個複合分式都先把分母（或分子）算成一個數，再相除
    const tex = solveDefault('HC-01.7').steps.map((s) => s.tex)
    expect(tex.some((t) => t.endsWith(String.raw`=\frac{0.05}{2\times0.79788}=\frac{0.05}{1.5958}=0.031333`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`=\frac{0.039894\times1^2}{2-0.039894}=\frac{0.039894}{1.9601}=0.020353`))).toBe(true)
    // μ 越小越接近 π/2
    expect(vals(solveDefault('HC-01.7', { mu: 0.001 }))[4]).toBeCloseTo(Math.PI / 2, 2)
  })

  it('HC-01.8：預設 = preset「DC 估計 + 10% outlier」的參數 ⇒ LMS 平均 5、std 0.97402；中位數偏移 0.13971（L1 = 3.1397）；Sign-Error std ≈ 0.1875（格點鏈 0.1892，差 < 2%）', () => {
    const def = handcalcOf('HC-01.8')
    const ps = preset('mse-mae-outliers-dc').params as Record<string, number | string>
    expect(values(def)).toEqual({ a: ps.a, sigma: ps.sigma, eps: ps.outlierProb, s: ps.outlierSize, mu: ps.mu })
    expect(ps.xDist).toBe('const')
    expect(ps.xScale).toBe(1)
    const p: LossDataParams = { model: 'contaminated', a: 3, xDist: 'const', xScale: 1, sigma: 1, outlierProb: 0.1, outlierSize: 20, outlierSign: 'positive', n: 0, seed: 0 }
    const [meanLms, sdLms, m, sdSe] = vals(def.solve(values(def)))
    const pop = populationOptima(p, 1)
    const ss = lmsSteadyState(p, 0.05)
    expect(meanLms).toBe(pop.l2)
    expect(meanLms).toBe(ss.mean)
    expect(meanLms).toBe(5)
    expect(sdLms).toBe(Math.sqrt(ss.variance))
    expect(sdLms).toBeCloseTo(0.97402, 5)
    expectClose(3 + m, pop.l1.lo, 1e-12)
    expect(3 + m).toBeCloseTo(3.1397, 4)
    expect(sdSe).toBe(Math.sqrt(signErrorJitterApprox(p, 0.05).variance))
    expect(sdSe).toBeCloseTo(0.1875, 4)
    const lat = signErrorLatticeStationary(p, { w0: 0, mu: 0.05, tie: 'zero' })!
    expect(Math.abs(sdSe / lat.std - 1)).toBeLessThan(0.02)
    expect(lat.std).toBeCloseTo(0.1892, 4) // 提示裡寫的格點鏈精確值
    expect(Math.abs(lat.mean - (3 + m))).toBeLessThan(0.05) // 時間平均在中位數 ± μ 內（勘誤 E40）
    // 拆開的中間步驟：outlier 開關的變異數 ε(1 − ε)s² = 0.1 × 0.9 × 400 = 36，總雜訊變異數 1 + 36 = 37（= 混合分布的二階動差 − 一階動差²）
    const tex = def.solve(values(def)).steps.map((s) => s.tex)
    expect(tex.some((t) => t.endsWith(String.raw`=0.1\times(1-0.1)\times20^2=0.1\times0.9\times400=36`))).toBe(true)
    expect(tex.some((t) => t.endsWith('=1^2+36=1+36=37'))).toBe(true)
    // 複合分式都先化成「一個數除以一個數」；e 的指數先把 z²/2 算出來
    expect(tex.some((t) => t.endsWith(String.raw`=\frac{0.05\times37}{2-0.05}=\frac{1.85}{1.95}=0.94872`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`=\frac{1}{2\times0.9}=\frac{1}{1.8}=0.55556`))).toBe(true)
    expect(tex.some((t) => t.includes(String.raw`\frac{e^{-0.13971^2/2}}{2.5066}=\frac{e^{-0.0097595}}{2.5066}=\frac{0.99029}{2.5066}=0.39507`))).toBe(true)
    expect(tex.some((t) => t.endsWith(String.raw`=\frac{0.05}{4\times0.35556}=\frac{0.05}{1.4222}=0.035156`))).toBe(true)
    expectClose(ss.variance, (0.05 * 37) / (2 - 0.05))
  })

  it('擴散近似的有效性（HC-01.7／HC-01.8 的門檻）：格點鏈精確解顯示 std 的相對誤差 ≈ −κ/4，κ = (1 + z²)·Var_SE/σ_v²；門檻內誤差 < 5.5%，只看 μf 會放行誤差 30% 以上的組合', () => {
    const def = handcalcOf('HC-01.8')
    const model = (eps: number, sigma: number, s: number): LossDataParams => ({ model: 'contaminated', a: 0, xDist: 'const', xScale: 1, sigma, outlierProb: eps, outlierSize: s, outlierSign: 'positive', n: 0, seed: 0 })
    let accepted = 0
    let rejectedByKappaOnly = 0
    for (const eps of [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.45]) {
      for (const mu of [0.01, 0.02, 0.05, 0.1, 0.2]) {
        const p = model(eps, 1, 12)
        const jit = signErrorJitterApprox(p, mu)
        const kappa = signErrorDiffusionKappa(p, mu)
        const lat = signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!
        expect(lat.truncated).toBe(false)
        const err = Math.sqrt(jit.variance) / lat.std - 1 // 近似／精確 − 1
        const msg = def.validate!(values(def, { a: 0, sigma: 1, eps, s: 12, mu }))
        const tag = `ε=${eps} μ=${mu} κ=${kappa} err=${err}`
        // 獨立重算 κ：z = Φ⁻¹(1/(2(1 − ε)))、f = (1 − ε)φ(z)、Var = μ/(4f)
        const z = eps === 0 ? 0 : PhiInv(1 / (2 * (1 - eps)))
        expectClose(kappa, ((1 + z * z) * mu) / (4 * (1 - eps) * phi(z)), 1e-6, tag)
        if (jit.smallness <= DIFFUSION_SMALLNESS_MAX && kappa <= DIFFUSION_KAPPA_MAX) {
          accepted++
          expect(msg, tag).toBeNull()
          expect(Math.abs(err), tag).toBeLessThan(0.055)
          expect(Math.abs(err + kappa / 4), tag).toBeLessThan(0.004) // 二階修正的預測
        } else {
          expect(msg, tag).not.toBeNull()
          expect(inlineErrors(msg!), tag).toEqual([])
          if (jit.smallness <= DIFFUSION_SMALLNESS_MAX) {
            rejectedByKappaOnly++ // 舊規則（只看 μf）會放行的組合：誤差其實都超過 4.5%
            expect(msg!, tag).toMatch(/不夠準/)
            expect(Math.abs(err), tag).toBeGreaterThan(0.045)
            // 訊息建議的 μ 填回去就會過
            const suggested = Number(/請把 \$\\mu\$ 降到 \$([0-9.]+)\$ 以下/.exec(msg!)![1])
            expect(suggested).toBeLessThan(mu)
            expect(def.validate!(values(def, { a: 0, sigma: 1, eps, s: 12, mu: suggested })), tag).toBeNull()
          }
        }
      }
    }
    expect(accepted).toBeGreaterThanOrEqual(20)
    expect(rejectedByKappaOnly).toBeGreaterThanOrEqual(5)
    // 最糟的例子：ε = 0.45、μ = 0.2 時 μf = 0.018「看起來很小」，近似的 std 卻比精確值小 30% 以上
    const worst = model(0.45, 1, 12)
    expect(signErrorJitterApprox(worst, 0.2).smallness).toBeLessThan(0.02)
    expect(Math.sqrt(signErrorJitterApprox(worst, 0.2).variance) / signErrorLatticeStationary(worst, { w0: 0, mu: 0.2, tie: 'zero' })!.std - 1).toBeLessThan(-0.3)
    // κ 無因次：σ、μ、s 一起放大不變；x ≡ A 時只和 μA² 有關；無 outlier 時 κ = (π/2)·μf（所以 HC-01.7 的 μf ≤ 0.1 已經夠嚴）
    expectClose(signErrorDiffusionKappa(model(0.2, 2, 24), 0.1), signErrorDiffusionKappa(model(0.2, 1, 12), 0.05), 1e-9)
    expectClose(signErrorDiffusionKappa({ ...model(0.2, 1, 12), xScale: 2 }, 0.0125), signErrorDiffusionKappa(model(0.2, 1, 12), 0.05), 1e-9)
    const clean = model(0, 1, 0)
    expectClose(signErrorDiffusionKappa(clean, 0.05), (Math.PI / 2) * signErrorJitterApprox(clean, 0.05).smallness, 1e-12)
    expect((Math.PI / 2) * DIFFUSION_SMALLNESS_MAX).toBeLessThan(DIFFUSION_KAPPA_MAX)
    expect(Number.isNaN(signErrorDiffusionKappa({ ...clean, sigma: 0 }, 0.05))).toBe(true) // 點質量：沒有密度
    expect(Number.isNaN(signErrorDiffusionKappa({ ...clean, xDist: 'gaussian' }, 0.05))).toBe(true) // 只對 x ≡ A 推導
    expect(Number.isNaN(signErrorDiffusionKappa({ ...clean, model: 'four_point' }, 0.05))).toBe(true)
    // outlier 與主體重疊（離固定點不到 8σ）時，固定點附近的密度不是主體 Gaussian：不給 κ；剛好 8σ（HC-01.8 合法範圍的邊界）有定義
    expect(Number.isNaN(signErrorDiffusionKappa(model(0.1, 1, 5), 0.05))).toBe(true)
    expect(Number.isNaN(signErrorDiffusionKappa({ ...model(0.1, 1, 5), outlierSign: 'symmetric' }, 0.05))).toBe(true)
    expect(Number.isFinite(signErrorDiffusionKappa({ ...model(0.1, 1, 12), outlierSign: 'symmetric' }, 0.05))).toBe(true)
    const zEdge = PhiInv(1 / (2 * 0.9))
    expect(Number.isFinite(signErrorDiffusionKappa(model(0.1, 1, 8 + zEdge), 0.05))).toBe(true)
    expect(handcalcOf('HC-01.8').validate!(values(handcalcOf('HC-01.8'), { s: 8.14 }))).toBeNull()
    expect(solveDefault('HC-01.8', { s: 8.14 }).notes!.join(' ')).not.toMatch(/NaN/)
    // 註記把預測的誤差寫出來，和同一則註記裡的格點鏈比較對得上：HC-01.7 預設 (π/8)·μf = 0.78%（格點鏈 −0.78%）；HC-01.8 預設 κ/4 = 0.9%（格點鏈 −0.89%）
    const n7 = solveDefault('HC-01.7').notes!.join(' ')
    expect(n7).toContain(String.raw`\approx0.78\%`)
    expect(n7).toContain(String.raw`$-0.78\%$`)
    const n8 = solveDefault('HC-01.8').notes!.join(' ')
    expect(n8).toContain(String.raw`\kappa/4\approx0.9\%`)
    expect(n8).toContain(String.raw`$-0.89\%$`)
  })

  it('HC-01.8 提示中的手算近似：z ≈ t + t³/6 在 ε ≤ 0.3 誤差 < 1%；只取 z ≈ t 在 ε ≤ 0.15 誤差 < 1%；e^{−u} ≈ 1 − u 在 u ≤ 0.05 誤差 < 0.13%；s ≥ 8σ 時近似式與精確中位數一致', () => {
    for (const eps of [0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
      const q = 1 / (2 * (1 - eps))
      const z = PhiInv(q)
      const t = (q - 0.5) * Math.sqrt(2 * Math.PI)
      expect(Math.abs((t + t ** 3 / 6) / z - 1), `ε=${eps}`).toBeLessThan(0.01)
      if (eps <= 0.15) expect(Math.abs(t / z - 1), `ε=${eps}`).toBeLessThan(0.01)
    }
    expect(Math.abs((1 - 0.05) / Math.exp(-0.05) - 1)).toBeLessThan(0.0013)
    // 合法範圍的邊界：outlier 那一群剛好比中位數高 8σ（s = m + 8σ）時，步驟用的右式 σ·Φ⁻¹(q) 與答案用的精確（數值求根）中位數
    // 一致到 1e-11·σ——ε 接近 0.5 也一樣。只要求 s ≥ 8σ 的舊規則在 ε = 0.499 會差到 2e-5·σ（步驟的 σ·z 對不上答案）。
    const def8 = handcalcOf('HC-01.8')
    for (const eps of [0.05, 0.2, 0.45, 0.49, 0.499]) {
      for (const sigma of [0.5, 1, 2]) {
        const z = PhiInv(1 / (2 * (1 - eps)))
        const sMin = Math.ceil((OUTLIER_MIN_SIGMAS + z) * sigma * 100) / 100
        const mu = 1e-4 * sigma // 夠小，讓 ε = 0.499（z = 2.88）也通過擴散近似的 κ 門檻；這裡只測「離中位數 8σ」這一條
        const v = values(def8, { sigma, eps, s: sMin, mu })
        expect(def8.validate!(v), `ε=${eps} σ=${sigma} s=${sMin}`).toBeNull()
        const exact = populationOptima({ model: 'contaminated', a: 3, xDist: 'const', xScale: 1, sigma, outlierProb: eps, outlierSize: sMin, outlierSign: 'positive', n: 0, seed: 0 }, 1).l1.lo - 3
        expect(Math.abs(vals(def8.solve(v))[2] - exact)).toBeLessThan(1e-12)
        expect(Math.abs(exact - sigma * z), `ε=${eps} σ=${sigma}`).toBeLessThan(1e-7 * sigma) // PhiInv（Simpson + 二分）的精度
        expect(def8.solve(v).steps.flatMap((st) => chainReport(st.tex).errors), `ε=${eps} σ=${sigma}`).toEqual([])
        // 再靠近一點（s 少 0.05σ）就會被擋下來，訊息會算出該填多少
        const msg = def8.validate!(values(def8, { sigma, eps, s: sMin - 0.05 * sigma, mu }))
        expect(msg, `ε=${eps} σ=${sigma}`).toMatch(/重疊/)
        expect(inlineErrors(msg!)).toEqual([])
      }
    }
    // 舊規則的反例：ε = 0.499、s = 8σ 時右式與精確中位數差 > 1e-5（所以現在不接受）
    const loose: LossDataParams = { model: 'contaminated', a: 0, xDist: 'const', xScale: 1, sigma: 1, outlierProb: 0.499, outlierSize: 8, outlierSign: 'positive', n: 0, seed: 0 }
    expect(Math.abs(populationOptima(loose, 1).l1.lo - PhiInv(1 / (2 * 0.501)))).toBeGreaterThan(1e-5)
    expect(def8.validate!(values(def8, { eps: 0.499, s: 8, mu: 0.001 }))).toMatch(/重疊/)
  })
})

describe('Ch01 帶入手算 (b)：換一題（20 個 seed）——結果有限，且等於測試內的獨立重算', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：randomValues(def, 1…20)`, () => {
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(def, seed)
        expect(randomValues(def, seed)).toEqual(v) // 可重現
        expect(def.validate?.(v) ?? null, `seed ${seed}`).toBeNull()
        for (const i of def.inputs) expect(inputError(i, v[i.key]), `seed ${seed} ${i.key}=${v[i.key]}`).toBeNull()
        const sol = def.solve(v)
        expect(sol.steps.length).toBeGreaterThan(0)
        const expected = RECOMPUTE[def.id](v)
        expect(sol.results).toHaveLength(expected.length)
        sol.results.forEach((r, k) => {
          expect(Number.isFinite(r.value), `seed ${seed} ${r.symbol}`).toBe(true)
          expectClose(r.value, expected[k], RECOMPUTE_TOL[def.id] ?? 1e-9, `${def.id} seed ${seed} result ${k} ${JSON.stringify(v)}`)
          // 正確答案一定要被「對答案」判為正確；明顯錯的答案（差 10% 且差 0.1 以上）要被判錯
          expect(checkAnswer(r.value, r).ok).toBe(true)
          expect(checkAnswer(r.value + 0.1 + 0.1 * Math.abs(r.value), r).ok).toBe(false)
        })
        expect(texErrors(def, sol), `seed ${seed} ${JSON.stringify(v)}`).toEqual([])
        // 步驟裡顯示的每一條「代入數字 = 中間值 = 結果」都必須算得起來（照著顯示的數字手算會得到同一個答案）
        sol.steps.forEach((st, k) => expect(chainReport(st.tex).errors, `${def.id} seed ${seed} 第 ${k + 1} 步 ${JSON.stringify(v)}`).toEqual([]))
        seen.add(JSON.stringify(v))
      }
      expect(seen.size).toBeGreaterThan(5) // 真的有在換題
    })
  }

  it('算術檢查器本身會抓到錯：代錯數字、正負號顛倒、平方漏掉、分式沒除、√ 與 e 的次方算錯', () => {
    const bad = [
      String.raw`p=1-\mu x^2=1-0.4\times4=-0.5`, // 結果錯
      String.raw`\delta_0=a-w_0=1-3=2`, // δ 極性顛倒（應為 a − w）
      String.raw`w_{\text{LMS}}=w-\mu\,(-e\,x)=1-0.4\times8=4.2`, // 梯度少了負號
      String.raw`\mu x^2=0.1\times2=0.4`, // 漏掉平方
      String.raw`\frac{0.1\times1^2}{2-0.4}=\frac{0.1}{1.6}=0.16`, // 沒有相除
      String.raw`\operatorname{std}=\sqrt{0.0625}=0.0625`,
      String.raw`\frac{e^{-0.0097595}}{2.5066}=\frac{0.9029}{2.5066}=0.39507`,
      String.raw`\begin{aligned}1-p^{\,4}&=1-0.1296=0.8704\\1-p^2&=1-0.36=0.46\end{aligned}`, // aligned 的第二列錯
      String.raw`J=\tfrac14\big(|0-2.5|+|10-2.5|\big)=\tfrac14\big(2.5+7.5\big)=5`,
    ]
    for (const t of bad) expect(chainReport(t).errors.length, t).toBeGreaterThanOrEqual(1)
    const good = [
      String.raw`p=1-\mu x^2=1-0.4\times4=-0.6`,
      String.raw`p^{\,3}=(-0.6)^{3}=-0.216`,
      String.raw`J=\tfrac14\cdot\tfrac12\big(2.5^2+2.5^2+2.5^2+7.5^2\big)=\tfrac14\cdot\tfrac12\big(6.25+6.25+6.25+56.25\big)=9.375`,
      String.raw`\varphi(z)=\frac{e^{-z^2/2}}{\sqrt{2\pi}}=\frac{e^{-0.13971^2/2}}{2.5066}=\frac{e^{-0.0097595}}{2.5066}=\frac{0.99029}{2.5066}=0.39507`,
      String.raw`x=2\times10^{-5}=0.00002`,
    ]
    for (const t of good) {
      const r = chainReport(t)
      expect(r.errors, t).toEqual([])
      expect(r.chains, t).toBeGreaterThanOrEqual(2)
    }
    expect(evalTex(String.raw`\tfrac12e^2`)).toBeNull() // 通式（含符號）不算數
    expect(evalTex('w^*')).toBeNull()
    expect(evalTex(String.raw`\tfrac12\times(-0.5761905)^2`)!.v).toBeCloseTo(0.16599775, 7)
  })

  it('每一步都有「代入數字 = 結果」：除了比大小、排序、區間與查表這幾步，每一步至少兩段純數字；預設數字的每條算式都算得起來', () => {
    // 沒有「數字 = 數字」的步驟：HC-01.5 的門檻比較與 |e|、HC-01.6 的排序與中位數區間、HC-01.8 的 Φ⁻¹ 查表
    const SYMBOLIC_STEPS: Record<string, number> = { 'HC-01.5': 2, 'HC-01.6': 2, 'HC-01.8': 1 }
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const reports = sol.steps.map((st) => chainReport(st.tex))
      reports.forEach((r, k) => expect(r.errors, `${def.id} 第 ${k + 1} 步`).toEqual([]))
      expect(reports.filter((r) => r.chains < 2).length, def.id).toBe(SYMBOLIC_STEPS[def.id] ?? 0)
    }
  })

  it('單位（教學規範 §3）：沿用本章符號表的 [x]／[y] 記號；每題的輸入與答案都標了單位（無因次量與「同一個 μ 給兩種演算法」除外）', () => {
    const unitsOf = (id: string) => {
      const def = handcalcOf(id)
      const sol = def.solve(defaultValues(def))
      return { inputs: Object.fromEntries(def.inputs.map((i) => [i.key, i.unit])), results: sol.results.map((r) => r.unit) }
    }
    for (const def of HANDCALCS) {
      const u = unitsOf(def.id)
      for (const unit of [...Object.values(u.inputs), ...u.results]) if (unit !== undefined) expect(unit, def.id).toMatch(/^(1\/)?\[[xy]\](\^2)?(\/?\[[xy]\](\^2)?)?$/)
      expect(Object.values(u.inputs).filter(Boolean).length, def.id).toBeGreaterThanOrEqual(2)
      expect(u.results.filter(Boolean).length, def.id).toBeGreaterThanOrEqual(3)
    }
    // w = y/x ⇒ [y]/[x]；LMS 的 μ·x² 無因次 ⇒ μ 是 1/[x]²；Var(w) 是 w 的平方
    expect(unitsOf('HC-01.1')).toEqual({ inputs: { x1: '[x]', y1: '[y]', x2: '[x]', y2: '[y]', x3: '[x]', y3: '[y]', a: '[y]/[x]' }, results: ['[x]^2', '[x][y]', '[y]/[x]', '[y]/[x]'] })
    expect(unitsOf('HC-01.2').results).toEqual(['[y]^2', '[x][y]', '[y]/[x]', '[y]^2'])
    expect(unitsOf('HC-01.3')).toMatchObject({ inputs: { mu: '1/[x]^2' }, results: ['[y]/[x]', '[y]/[x]', undefined, undefined, '1/[x]^2'] })
    expect(unitsOf('HC-01.4')).toMatchObject({ inputs: { mu: '1/[x]^2', sigma: '[y]', n: undefined }, results: [undefined, '[y]/[x]', '[y]^2/[x]^2', '[y]^2/[x]^2', '[y]/[x]'] })
    // 同一個 μ 數值在 LMS 與 Sign-Error 的單位不同：HC-01.5／HC-01.8 的 μ 不標單位，改在提示／註記說明
    expect(unitsOf('HC-01.5').inputs.mu).toBeUndefined()
    expect(unitsOf('HC-01.8').inputs.mu).toBeUndefined()
    expect(handcalcOf('HC-01.5').tips!.join('')).toMatch(/單位提醒/)
    expect(solveDefault('HC-01.8').notes!.join('')).toMatch(/注意單位/)
    // x ≡ 1 的三題：w 的單位就是 [y]；K_q 是 1/[y]（T04：fs⁻¹），比值與斜率無因次
    expect(unitsOf('HC-01.6').results).toEqual(['[y]', '[y]', '[y]', undefined, '[y]'])
    expect(unitsOf('HC-01.7')).toEqual({ inputs: { mu: '[y]', sigma: '[y]' }, results: ['1/[y]', '[y]^2', '[y]', '[y]^2', undefined] })
    expect(unitsOf('HC-01.8').results).toEqual(['[y]', '[y]', '[y]', '[y]'])
  })

  it('預設數字的解也等於獨立重算', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const expected = RECOMPUTE[def.id](v)
      def.solve(v).results.forEach((r, k) => expectClose(r.value, expected[k], RECOMPUTE_TOL[def.id] ?? 1e-9, `${def.id} result ${k}`))
    }
  })
})

describe('Ch01 帶入手算 (c)：validate 擋掉模型不適用的輸入，並說明原因', () => {
  const reject = (id: string, over: Record<string, number>, pattern: RegExp) => {
    const def = handcalcOf(id)
    const msg = def.validate?.(values(def, over)) ?? null
    expect(msg, `${id} ${JSON.stringify(over)}`).not.toBeNull()
    expect(msg!).toMatch(pattern)
    expect(inlineErrors(msg!), `${id} ${JSON.stringify(over)}`).toEqual([])
    const { container, unmount } = render(<MathText>{msg}</MathText>)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    unmount()
  }
  const accept = (id: string, over: Record<string, number>) => {
    const def = handcalcOf(id)
    expect(def.validate?.(values(def, over)) ?? null, `${id} ${JSON.stringify(over)}`).toBeNull()
  }

  it('HC-01.1：三筆 x 全為 0（沒有 excitation）', () => {
    reject('HC-01.1', { x1: 0, x2: 0, x3: 0 }, /不含.*資訊/)
    accept('HC-01.1', { x1: 0, x2: 0, x3: 1 })
  })

  it('HC-01.2：Σx² = 0（不可辨識）、負的平方和、違反 Cauchy–Schwarz（J(w*) 會是負的）', () => {
    reject('HC-01.2', { sxx: 0, sxy: 0 }, /不可辨識/)
    reject('HC-01.2', { sxx: -1 }, /不可能是負的/)
    reject('HC-01.2', { syy: -1 }, /不可能是負的/)
    reject('HC-01.2', { sxx: 4, sxy: 30, syy: 100 }, /Cauchy/)
    accept('HC-01.2', { sxx: 4, sxy: 20, syy: 100 }) // 等號成立：資料完全共線
    // 只有一筆資料時三個和不能任意給：(x₁y₁)² 必等於 x₁²·y₁²（否則會算出「一筆資料也有雜訊底」這種不可能的結果）
    reject('HC-01.2', { N: 1 }, /一筆資料/)
    reject('HC-01.2', { sxx: 8, sxy: 4, syy: 100, N: 1 }, /一筆資料/)
    accept('HC-01.2', { sxx: 4, sxy: 12, syy: 36, N: 1 }) // §1.4 的手算例：x = 2、y = 6
    accept('HC-01.2', { sxx: 8, sxy: 4, syy: 100, N: 2 })
    for (let seed = 1; seed <= 40; seed++) expect(randomValues(handcalcOf('HC-01.2'), seed).N, `seed ${seed}`).toBeGreaterThanOrEqual(2)
    expect(vals(solveDefault('HC-01.2', { sxx: 4, sxy: 20, syy: 100 }))[3]).toBe(0)
    const def = handcalcOf('HC-01.2')
    const N = def.inputs.find((i) => i.key === 'N')!
    expect(inputError(N, 0)).not.toBeNull()
    expect(inputError(N, 2.5)).not.toBeNull()
  })

  it('HC-01.3：x = 0（梯度恆為 0）、μ < 0（極性錯誤：p > 1）；μ = 0 與超過上限的 μ 仍可算（這題就是要比較）', () => {
    reject('HC-01.3', { x: 0 }, /不可辨識/)
    reject('HC-01.3', { mu: -0.1 }, /極性錯誤/)
    expect(handcalcOf('HC-01.3').validate!(values(handcalcOf('HC-01.3'), { mu: -0.1 }))).toContain('=1.4>1') // p = 1 − (−0.1)·4
    accept('HC-01.3', { mu: 0 })
    accept('HC-01.3', { mu: 0.6 }) // LMS 也發散：註記會說明
    expect(inputError(handcalcOf('HC-01.3').inputs.find((i) => i.key === 'mu')!, -0.1)).toBeNull() // 交給 validate 解釋原因，而不是只說「不可小於 0」
  })

  it('T02: HC-01.4 只接受 golden 表中收斂的 μ（x = 2：0.1、0.25、0.4、0.49），拒絕 0.5（邊界）、0.51、−0.01；x = 0 也拒絕', () => {
    const g = golden('T02')
    const mus = g.inputs.mu_list as number[]
    const conv = g.expected.converges_list as number[]
    mus.forEach((mu, i) => {
      if (conv[i]) accept('HC-01.4', { x: g.inputs.x as number, mu })
      else reject('HC-01.4', { x: g.inputs.x as number, mu }, mu <= 0 ? /上坡|不更新/ : /無界成長/)
    })
    reject('HC-01.4', { mu: 0 }, /不更新/)
    reject('HC-01.4', { x: 0 }, /不含.*資訊/)
    accept('HC-01.4', { sigma: 0 }) // 無雜訊是合法的（變異數為 0）
    expect(vals(solveDefault('HC-01.4', { sigma: 0 })).slice(2)).toEqual([0, 0, 0])
  })

  it('HC-01.5：δ_H ≤ 0、μ < 0（極性錯誤）；兩者都由 validate 解釋原因', () => {
    reject('HC-01.5', { dH: 0 }, /正數/)
    reject('HC-01.5', { dH: -1 }, /正數/)
    reject('HC-01.5', { mu: -0.2 }, /極性錯誤/)
    accept('HC-01.5', { mu: 0 })
    const def = handcalcOf('HC-01.5')
    expect(inputError(def.inputs.find((i) => i.key === 'dH')!, -1)).toBeNull()
    expect(inputError(def.inputs.find((i) => i.key === 'mu')!, -0.2)).toBeNull()
  })

  it('HC-01.6：w 剛好等於某筆資料（尖點，導數不存在）', () => {
    reject('HC-01.6', { w: 0 }, /尖點/)
    reject('HC-01.6', { w: 10 }, /尖點/)
    // 訊息建議的替代位置不會剛好又是另一筆資料：{0, 0.5, 0.75, 10} 的 w = 0 ⇒ 建議 0.25，不是 0.5
    const def6 = handcalcOf('HC-01.6')
    expect(def6.validate!(values(def6, { y1: 0, y2: 0.5, y3: 0.75, y4: 10, w: 0 }))).toContain('例如 $0.25$')
    expect(def6.validate!(values(def6, { w: 0 }))).toContain('例如 $0.5$')
    accept('HC-01.6', { y1: 0, y2: 0.5, y3: 0.75, y4: 10, w: 0.25 })
    accept('HC-01.6', { w: -3 })
  })

  it('HC-01.7：σ_v = 0（點質量，沒有密度）、μ ≤ 0、μ f(0) 超過門檻（擴散近似失效）', () => {
    reject('HC-01.7', { sigma: 0 }, /沒有連續雜訊/)
    reject('HC-01.7', { mu: 0 }, /沒有穩態/)
    reject('HC-01.7', { mu: -0.1 }, /沒有穩態/)
    reject('HC-01.7', { mu: 1 }, /不夠小/)
    // 門檻：μ f(0) ≤ 0.1；§2.3.2 表格的三個 μ（0.2、0.05、0.0125）都在範圍內
    for (const mu of [0.2, 0.05, 0.0125]) accept('HC-01.7', { mu })
    const fMax = 1 / Math.sqrt(2 * Math.PI)
    accept('HC-01.7', { mu: (DIFFUSION_SMALLNESS_MAX / fMax) * 0.999 })
    reject('HC-01.7', { mu: (DIFFUSION_SMALLNESS_MAX / fMax) * 1.001 }, /不夠小/)
    // 訊息建議的 μ（往下取 3 位有效數字：0.250，不是四捨五入的 0.251）填回去一定會過
    const msg7 = handcalcOf('HC-01.7').validate!(values(handcalcOf('HC-01.7'), { mu: 1 }))!
    const suggested = Number(/降到 \$([0-9.]+)\$ 以下/.exec(msg7)![1])
    expect(suggested).toBe(0.25)
    accept('HC-01.7', { mu: suggested })
    for (const sigma of [0.3, 0.7, 1.3, 3, 100]) {
      const m = handcalcOf('HC-01.7').validate!(values(handcalcOf('HC-01.7'), { mu: 1e6, sigma }))!
      accept('HC-01.7', { sigma, mu: Number(/降到 \$([0-9.]+)\$ 以下/.exec(m)![1]) })
    }
  })

  it('HC-01.8：σ_v = 0、ε ≥ 0.5（breakdown）、s < 8σ_v、μ 超出 (0, 2)、μ f 太大', () => {
    reject('HC-01.8', { sigma: 0 }, /沒有連續雜訊/)
    reject('HC-01.8', { eps: 0.5 }, /breakdown/)
    reject('HC-01.8', { eps: 0.7 }, /breakdown/)
    reject('HC-01.8', { s: 7.9 }, /重疊/)
    // 門檻是「比中位數高 8σ」：預設 ε = 0.1 時 m = 0.1397，所以 s = 8.1 還不夠、8.14 才行；訊息會直接告訴你 8.14
    reject('HC-01.8', { s: 8.1 }, /s\\ge8\.14/)
    accept('HC-01.8', { s: 8.14 })
    reject('HC-01.8', { eps: 0.45, s: 9 }, /重疊/) // m = 1.335
    accept('HC-01.8', { eps: 0.45, s: 9.4, mu: 0.01 })
    // ε 大時中位數在主體的尾巴（z = 1.335）：μ = 0.2 的 μf 只有 0.018，但抖動寬度已經和 σ_v 同量級 ⇒ 擴散近似不準
    reject('HC-01.8', { eps: 0.45, s: 9.4, mu: 0.2 }, /不夠準/)
    reject('HC-01.8', { eps: 0.4, s: 12, mu: 0.05 + 0.02 }, /kappa/)
    reject('HC-01.8', { mu: 0 }, /0<\\mu<2/)
    reject('HC-01.8', { mu: 2 }, /0<\\mu<2/)
    reject('HC-01.8', { mu: 0.5 }, /不夠小/)
    accept('HC-01.8', { eps: 0 }) // 沒有 outlier 是合法的：兩種演算法都不偏
    accept('HC-01.8', { eps: 0, s: 0 }) // ε = 0 時 s 用不到，不必滿足 s ≥ 8σ
    const clean = vals(solveDefault('HC-01.8', { eps: 0 }))
    expect(clean[0]).toBe(3)
    expect(clean[2]).toBe(0)
  })
})

describe('Ch01 帶入手算 (d)：<HandCalc> 渲染', () => {
  it('每一題：至少一步、沒有 .katex-error／.c-tex-error、所有 TeX（步驟、說明、註記、提示）都能嚴格解析、答案框出現', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      expect(texErrors(def, sol), def.id).toEqual([])
      const { container, unmount } = render(<HandCalc def={def} />)
      expect(container.querySelector('.katex-error, .c-tex-error'), def.id).toBeNull()
      expect(container.querySelectorAll('.c-step').length, def.id).toBe(sol.steps.length)
      expect(sol.steps.length, def.id).toBeGreaterThanOrEqual(5)
      expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length, def.id).toBe(sol.results.length)
      // KaTeX 把未定義的指令畫成紅字（不會有 .katex-error）
      expect(container.querySelectorAll('.katex [mathcolor="#cc0000"]').length, def.id).toBe(0)
      for (const ann of Array.from(container.querySelectorAll('.katex-mathml annotation'))) expect(strictParse(ann.textContent ?? '', false), def.id).toBeNull()
      expect(container.querySelector('.c-handcalc-tips')).toBeTruthy()
      unmount()
    }
  })

  it('HC-01.4：把 μ 改成 0.6（μx² ≥ 2）⇒ 步驟消失、顯示解釋原因的警告；「自己算算看」輸入 2.28 判為正確', () => {
    const def = handcalcOf('HC-01.4')
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.textContent).toContain('2.28')
    fireEvent.change(screen.getByLabelText(/學習率/), { target: { value: '0.6' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toMatch(/無界成長/)
    expect(container.querySelector('.katex-error')).toBeNull()
    fireEvent.click(screen.getByText('還原範例數字'))
    fireEvent.click(screen.getByText('自己算算看'))
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const answers = screen.getAllByPlaceholderText('你的答案')
    expect(answers).toHaveLength(5)
    fireEvent.change(answers[1], { target: { value: '2.28' } })
    fireEvent.change(answers[4], { target: { value: '0.3' } })
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(1)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad').length).toBeGreaterThanOrEqual(1)
    unmount()
  })

  it('各題各分支的文字（斜率正負、門檻內外、e = 0、中位數區間、無 outlier…）也都能嚴格解析', () => {
    const cases: [string, Record<string, number>][] = [
      ['HC-01.1', { y1: 3.5, y2: 7, y3: 14 }], // v = 0.5x
      ['HC-01.1', { y1: 3.4, y2: 6.2, y3: 11.8 }], // Σxv = 0
      ['HC-01.1', { x1: 0, y1: 1 }], // 有一筆 x = 0（不顯示比值）
      ['HC-01.1', { x1: -2, y1: -6.5, a: -3 }],
      ['HC-01.2', { w: 4 }], // 斜率 > 0
      ['HC-01.2', { sxx: 4, sxy: 12, syy: 36, N: 1, w: 3 }], // 斜率 = 0、J(w*) = 0
      ['HC-01.2', { sxy: -64.6, w: -2.5 }],
      ['HC-01.3', { mu: 0 }],
      ['HC-01.3', { mu: 0.1 }],
      ['HC-01.3', { mu: 0.25 }],
      ['HC-01.3', { mu: 0.5 }],
      ['HC-01.3', { mu: 0.6, x: -2, y: -6, w: 5 }],
      ['HC-01.4', { mu: 0.25 }], // p = 0
      ['HC-01.4', { mu: 0.4, n: 3, w0: 5 }], // p < 0、δ₀ < 0
      ['HC-01.4', { sigma: 0 }],
      ['HC-01.5', { y: 1 }], // e = 0
      ['HC-01.5', { y: 1.5 }], // 門檻內
      ['HC-01.5', { y: -4, x: -2, w: -1 }], // 負的 e 與 x
      ['HC-01.6', { y1: 1, y2: 2, y3: 3, y4: 100, w: 2.5 }], // 區間、斜率 0
      ['HC-01.6', { w: -1 }], // 斜率 < 0
      ['HC-01.6', { y1: -3, y2: -1, y3: 4, y4: -20, w: 0.5 }],
      ['HC-01.7', { mu: 0.2 }],
      ['HC-01.7', { mu: 1e-5, sigma: 100 }], // μ/σ 太小：不算格點鏈
      ['HC-01.8', { eps: 0 }],
      ['HC-01.8', { eps: 0.4 }], // 級數近似誤差 > 1%：提示改查表
      ['HC-01.8', { a: -2, sigma: 0.5, s: 5, mu: 0.01 }],
    ]
    for (const [id, over] of cases) {
      const def = handcalcOf(id)
      const v = values(def, over)
      expect(def.validate?.(v) ?? null, `${id} ${JSON.stringify(over)}`).toBeNull()
      const sol = def.solve(v)
      expect(sol.results.every((r) => Number.isFinite(r.value)), `${id} ${JSON.stringify(over)}`).toBe(true)
      expect(texErrors(def, sol), `${id} ${JSON.stringify(over)}`).toEqual([])
      const expected = RECOMPUTE[id](v)
      sol.results.forEach((r, k) => expectClose(r.value, expected[k], RECOMPUTE_TOL[id] ?? 1e-9, `${id} ${JSON.stringify(over)} result ${k}`))
    }
  })
})
