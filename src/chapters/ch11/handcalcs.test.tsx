import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, randomValues, renderTex } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { normCdf } from '@/simulation/core'
import {
  KQ_FACTOR,
  autoMu,
  buildCodeDistribution,
  codeMoments,
  comparatorMean,
  eDet,
  linearizedFixedPoint,
  mseFixedPoint,
  mseWeightedMean,
  nearIntegerSensitivity,
  nearIntegerSweep,
  signFixedPoint,
  signSecondOrder,
  signWeightedMedian,
  type ErrorModel,
} from '@/simulation/models/bias'
import { HANDCALCS, LINEAR_OK_RATIO, PHI_TABLE_MAX, SECOND_ORDER_MAX_RATIO } from './handcalcs'

/* ───────────── 共用工具 ───────────── */

// KaTeX 渲染 8 題 × 20 個 seed 在忙碌的機器上可能超過預設的 5 s；時間上限只防止卡死，不是效能規格
vi.setConfig({ testTimeout: 180000 })

interface GoldenT12 {
  inputs: { x_values: number[]; a: number; c3: number; sigma_list: number[] }
  expected: { Ex2: number; Ex4: number; w_star: number; sign_lms_w_star_list: number[] }
  tolerance: { abs: number }
  tolerance_overrides: { sign_lms_w_star_list: { abs: number } }
}
const golden = JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors/T12.json'), 'utf8')) as GoldenT12

const hc = (id: string): HandCalcDef => {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到 ${id}`)
  return def
}
/** 以預設值（可覆寫部分輸入）求解；先確認 validate 通過 */
function solve(id: string, over: Record<string, number> = {}): HandCalcSolution {
  const def = hc(id)
  const v = { ...defaultValues(def), ...over }
  expect(def.validate?.(v) ?? null, `${id} validate`).toBeNull()
  return def.solve(v)
}
const values = (sol: HandCalcSolution) => sol.results.map((r) => r.value)

const FIVE = buildCodeDistribution({ kind: 'five_level' })
const U4 = buildCodeDistribution({ kind: 'unipolar4' })
const model = (o: Partial<ErrorModel>): ErrorModel => ({ a: 1, b: 0, c2: 0, c3: 0, kappa: 0, sigmaV: 0, ...o })

/** 相對容差比較（|Δ| ≤ tol·max(1, |期望值|)） */
function expectNear(actual: number, expected: number, what: string, tol = 1e-9) {
  expect(Number.isFinite(actual), `${what} 有限`).toBe(true)
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)))
}

/** 一題的所有 TeX（通式、步驟、答案符號、`$…$` 行內數學）是否都能被 KaTeX 解析；回傳錯誤清單 */
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
    if (/NaN|undefined/.test(s.tex)) bad.push(`step ${k + 1}: 出現 NaN／undefined —— ${s.tex}`)
  })
  sol.results.forEach((r, k) => {
    check(`${r.symbol}=1${r.unit ? `\\ ${r.unit}` : ''}`, true, `result ${k + 1}`)
    if (r.label) inline(r.label, `result ${k + 1} label`)
  })
  sol.notes?.forEach((n, k) => inline(n, `note ${k + 1}`))
  def.tips?.forEach((t, k) => inline(t, `tip ${k + 1}`))
  return bad
}

/* ───────────── 獨立重算（直接寫在測試裡，不呼叫 bias.ts） ───────────── */

const CODES5 = [-2, -1, 0, 1, 2]
const avg = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)

/** erf(u) = (2/√π)∫₀^u e^{−t²}dt：composite Simpson（與 core/special.ts 的實作無關） */
function erfSimpson(u: number, n = 4000): number {
  const h = u / n
  let s = 1 + Math.exp(-u * u)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * Math.exp(-((i * h) ** 2))
  return ((2 / Math.sqrt(Math.PI)) * s * h) / 3
}

/** |x| 加權的下／上中位數：用「累積票重 ≥ 一半」與「> 一半」兩個定義（與 signWeightedMedian 的寫法無關） */
function weightedMedianInterval(items: { t: number; wt: number }[]): [number, number] {
  const sorted = [...items].sort((p, q) => p.t - q.t)
  const half = sorted.reduce((s, it) => s + it.wt, 0) / 2
  let cum = 0
  let lo = Number.NaN
  let hi = Number.NaN
  for (const it of sorted) {
    cum += it.wt
    if (Number.isNaN(lo) && cum >= half - 1e-12) lo = it.t
    if (Number.isNaN(hi) && cum > half + 1e-12) hi = it.t
  }
  return [lo, hi]
}

const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-11.1': ({ a, c3, w }) => {
    const e = (x: number) => (a - w) * x + c3 * x ** 3
    return [e(1), e(2), avg(CODES5.map((x) => x * e(x))), avg(CODES5.map((x) => e(x) ** 2))]
  },
  'HC-11.2': ({ e, sigma }) => {
    const kq = SQRT_2_OVER_PI / sigma
    return [erfSimpson(e / (Math.SQRT2 * sigma)), kq, kq * e, kq * (e - e ** 3 / (6 * sigma ** 2))]
  },
  'HC-11.3': ({ a, b, c2, x1, x2, x3, x4 }) => {
    const xs = [x1, x2, x3, x4]
    const m1 = avg(xs)
    const m2 = avg(xs.map((x) => x * x))
    const m3 = avg(xs.map((x) => x ** 3))
    const varX = avg(xs.map((x) => (x - m1) ** 2))
    const cov = avg(xs.map((x) => (x - m1) * (x * x - m2)))
    return [a + (b * m1 + c2 * m3) / m2, a + (c2 * cov) / varX, a + (b * m1 + c2 * cov) / varX, varX]
  },
  'HC-11.4': ({ a, c3, x1, x2, x3, x4, x5 }) => {
    const xs = [x1, x2, x3, x4, x5]
    const m2 = avg(xs.map((x) => x * x))
    const m4 = avg(xs.map((x) => x ** 4))
    return [m2, m4, a + (c3 * m4) / m2]
  },
  // 5-level code 的封閉式：w_1 = a + 3.4c_3；e_0(1) = −2.4c_3、e_0(2) = 1.2c_3 ⇒ E[x e_0³] = −4.1472c_3³ ⇒ Δ = 0.3456c_3³/σ_v²
  'HC-11.5': ({ a, c3, sigma, eps }) => {
    const w1 = a + 3.4 * c3
    const delta = (0.3456 * c3 ** 3) / sigma ** 2
    return [w1, delta, w1 + delta, Math.sqrt((Math.abs(delta) * sigma ** 2) / eps)]
  },
  'HC-11.6': ({ a, b, c3 }) => {
    const [lo, hi] = weightedMedianInterval([-2, -1, 1, 2].map((x) => ({ t: a + b / x + c3 * x * x, wt: 0.2 * Math.abs(x) })))
    // x² 加權平均：Σp·x²·(a + b/x + c_3x²)/Σp·x² = a + b·E[x]/E[x²] + c_3E[x⁴]/E[x²] = a + 3.4c_3
    return [lo, hi, a + 3.4 * c3]
  },
  'HC-11.7': ({ a, kd, px, C, sigma }) => [a + kd, a + (kd * px) / C, (-kd * px) / (C * C), (SQRT_2_OVER_PI / sigma) * C],
  'HC-11.8': ({ a, b, c2, c3, kappa, x0, sigma }) => {
    const xs = CODES5.map((x) => x + x0)
    const m = (n: number) => avg(xs.map((x) => x ** n))
    const off = (b * m(1)) / m(2)
    const inl = (c2 * m(3) + c3 * m(4)) / m(2)
    const w = a + off + inl + kappa
    const emax = Math.max(...xs.map((x) => Math.abs((a + kappa - w) * x + b + c2 * x * x + c3 * x ** 3)))
    return [off, inl, w, emax / sigma, 0.02 / ((SQRT_2_OVER_PI / sigma) * m(2))]
  },
}

/* ───────────── 步驟的算術鏈檢查（把 TeX 裡代入的數字真的算一次） ───────────── */

/** 在大括號深度 0 的位置，依任一分隔字串切開 */
function splitTop(s: string, seps: string[]): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; ) {
    const ch = s[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    const hit = depth === 0 ? seps.find((sep) => s.startsWith(sep, i)) : undefined
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
  return out
}

/** 純數字的 TeX 片段 → 只含 數字 + - * / ^ ( ) 與 sqrt 的算式；含符號（字母、\Phi…）時回傳 null */
function texToExpr(seg: string): string | null {
  let s = seg
  for (const sp of [String.raw`\,`, String.raw`\;`, String.raw`\ `, String.raw`\!`, String.raw`\qquad`, String.raw`\quad`]) s = s.split(sp).join(' ')
  s = s.split(String.raw`\times`).join('*').split(String.raw`\cdot`).join('*')
  s = s.replace(/\\[bB]ig[([]/g, '(').replace(/\\[bB]ig[)\]]/g, ')')
  s = s.replace(/\^\{([^{}]*)\}/g, '^($1)')
  s = s.replace(/\\[td]?frac(\d)(\d)/g, '(($1)/($2))')
  for (let guard = 0; guard < 40; guard++) {
    const t = s.replace(/\\[td]?frac\{([^{}]*)\}\{([^{}]*)\}/, '(($1)/($2))').replace(/\\sqrt\{([^{}]*)\}/, 'sqrt($1)')
    if (t === s) break
    s = t
  }
  s = s.replace(/\s+/g, '')
  if (s === '' || !/\d/.test(s)) return null
  return /^(?:sqrt|[\d.+\-*/^()])+$/.test(s) ? s : null
}

/** 遞迴下降求值：expr = term (± term)*；term = unary ((*|/) unary | 隱含乘法)*；unary = −unary | atom (^ unary)? */
function evalExpr(src: string): number {
  let i = 0
  const peek = () => src[i]
  const expr = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') v = src[i++] === '+' ? v + term() : v - term()
    return v
  }
  const term = (): number => {
    let v = unary()
    for (;;) {
      if (peek() === '*') {
        i++
        v *= unary()
      } else if (peek() === '/') {
        i++
        v /= unary()
      } else if (peek() === '(' || peek() === 's') v *= unary() // \tfrac15\big( … \big)
      else return v
    }
  }
  const unary = (): number => {
    if (peek() === '-') {
      i++
      return -unary()
    }
    const base = atom()
    if (peek() === '^') {
      i++
      return base ** unary()
    }
    return base
  }
  const atom = (): number => {
    if (src.startsWith('sqrt', i)) {
      i += 4
      return Math.sqrt(atom())
    }
    if (peek() === '(') {
      i++
      const v = expr()
      if (src[i++] !== ')') throw new Error(`缺少右括號：${src}`)
      return v
    }
    const m = /^\d+\.?\d*/.exec(src.slice(i))
    if (!m) throw new Error(`無法解析：${src}（位置 ${i}）`)
    i += m[0].length
    return Number(m[0])
  }
  const v = expr()
  if (i !== src.length) throw new Error(`多餘的字元：${src}（位置 ${i}）`)
  return v
}

/**
 * 檢查一個步驟：每一條「… = 代入數字 = 中間結果 = 結果」的等號鏈，相鄰的純數字片段必須相等
 *（容差 2e−4 × 鏈上最大的數，足以容納顯示時的四捨五入，但抓得到代錯數字、正負號、漏乘的錯誤）。
 * 回傳 { checked: 比對了幾組, bad: 不一致的鏈, seen: 出現過的所有純數字片段的值 }。
 */
function chainCheck(tex: string): { checked: number; bad: string[]; seen: number[] } {
  const body = tex
    .replace(/\\begin\{(?:aligned|array)\}(?:\{[^}]*\})?/g, '')
    .replace(/\\end\{(?:aligned|array)\}/g, '')
    .split(String.raw`\hline`)
    .join('')
  let checked = 0
  const bad: string[] = []
  const seen: number[] = []
  for (const row of splitTop(body, [String.raw`\\`])) {
    // \; 只是間距（「乘積清單 \;=\; 結果清單」），先拿掉，免得和當分隔用的分號混在一起
    const line = row.split(String.raw`\;`).join(' ').split(String.raw`\approx`).join('=').split('&=').join('=')
    for (const raw of splitTop(line, [String.raw`\qquad`, String.raw`\quad`, ':', '&'])) {
      const stmt = raw.trim().replace(/[,;]$/, '')
      const numeric: { values: number[]; scale: number }[] = []
      for (const seg0 of splitTop(stmt, ['='])) {
        let seg = seg0.split(String.raw`\Rightarrow`).join('').trim()
        const isList = seg.includes(String.raw`,\ `)
        if (isList && seg.startsWith(String.raw`\big(`) && seg.endsWith(String.raw`\big)`)) seg = seg.slice(5, -5)
        const exprs = (isList ? splitTop(seg, [String.raw`,\ `]) : [seg]).map(texToExpr)
        if (exprs.some((e) => e === null)) continue
        const values = (exprs as string[]).map(evalExpr)
        const lits = (exprs as string[]).flatMap((e) => (e.match(/\d+\.?\d*/g) ?? []).map(Number))
        numeric.push({ values, scale: Math.max(...lits, ...values.map(Math.abs)) })
        seen.push(...values)
      }
      for (let k = 0; k + 1 < numeric.length; k++) {
        const p = numeric[k]
        const q = numeric[k + 1]
        if (p.values.length !== q.values.length) {
          bad.push(`長度不同：${stmt}`)
          continue
        }
        p.values.forEach((v, j) => {
          checked++
          if (!(Math.abs(v - q.values[j]) <= 2e-4 * Math.max(p.scale, q.scale) + 1e-12)) bad.push(`${v} ≠ ${q.values[j]}：${stmt}`)
        })
      }
    }
  }
  return { checked, bad, seen }
}

/* ───────────── (a) 預設值 = 本章 worked example／模型函式／golden vector ───────────── */

describe('Ch11 handcalcs：題目清單', () => {
  it('HC-11.1 … HC-11.8、頁面 /ch/11、id 唯一、三種難度都有、公式 ID 存在於本章', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-11.1', 'HC-11.2', 'HC-11.3', 'HC-11.4', 'HC-11.5', 'HC-11.6', 'HC-11.7', 'HC-11.8'])
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/11')
      expect(h.formulaId, h.id).toMatch(/^F-11\.\d+$/)
      expect(h.inputs.length, h.id).toBeGreaterThan(0)
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThan(0)
      // 每個輸入都有手算友善的隨機範圍，預設值落在 [min, max] 內
      for (const i of h.inputs) {
        expect(i.practice, `${h.id}.${i.key}`).toBeDefined()
        if (i.min !== undefined) expect(i.default, `${h.id}.${i.key}`).toBeGreaterThanOrEqual(i.min)
        if (i.max !== undefined) expect(i.default, `${h.id}.${i.key}`).toBeLessThanOrEqual(i.max)
      }
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
  })
})

describe('Ch11 handcalcs：預設值重現本章的 worked example（數值來自 bias.ts）', () => {
  it('T12: HC-11.1 預設 w = 1.34 重現殘差表 (−0.12, +0.24, 0, −0.24, +0.12)、E[x e] = 0、E[e²] = 0.0288；w = 1 / 1.2 / 1.4 → 0.68 / 0.28 / −0.12', () => {
    const sol = solve('HC-11.1')
    const [e1, e2, G, mse] = values(sol)
    const cubic = model({ c3: 0.1 })
    expect(e1).toBe(eDet(1, 1.34, cubic))
    expect(e2).toBe(eDet(2, 1.34, cubic))
    expect(e1).toBeCloseTo(-0.24, 12)
    expect(e2).toBeCloseTo(0.12, 12)
    expect(G).toBe(0) // −1.1e−16 的浮點捨入已歸零
    expect(mse).toBeCloseTo(0.0288, 12)
    // 殘差表與「逐項相乘」都出現在步驟裡
    expect(sol.steps[2].tex).toContain(String.raw`-0.12,\ 0.24,\ 0,\ -0.24,\ 0.12`)
    expect(sol.steps[3].tex).toContain(String.raw`0.24,\ -0.24,\ 0,\ -0.24,\ 0.24`)
    expect(sol.notes?.[0]).toContain('GMAC 歸零不代表誤差歸零')
    // 開場「先算一次」的另外三個 w
    expect(values(solve('HC-11.1', { w: 1 }))[2]).toBeCloseTo(0.68, 12)
    expect(values(solve('HC-11.1', { w: 1.2 }))[2]).toBeCloseTo(0.28, 12)
    expect(values(solve('HC-11.1', { w: 1.4 }))[2]).toBeCloseTo(-0.12, 12)
    // 成本表：w = 1.4 時 E[e²] = 0.036（勘誤 E01）
    expect(values(solve('HC-11.1', { w: 1.4 }))[3]).toBeCloseTo(0.036, 12)
  })

  it('HC-11.2 預設（e = 0.24、σ_v = 1）= comparatorMean／KQ_FACTOR；e = 1、σ_v = 100 → 先備知識框的 0.0079787', () => {
    const [q, kq, lin, third] = values(solve('HC-11.2'))
    expect(q).toBe(comparatorMean(0.24, 1))
    expect(q).toBeCloseTo(2 * normCdf(0.24) - 1, 14)
    expect(q).toBeCloseTo(0.189670, 6)
    expect(kq).toBe(KQ_FACTOR)
    expect(lin).toBeCloseTo(0.191492, 6)
    expect(third).toBeCloseTo(0.189654, 6)
    // 線性化高估約 z²/6 = 0.96%；三次項把誤差壓到 1e−4 以下
    expect((lin - q) / q).toBeCloseTo(0.0096, 3)
    expect(Math.abs((third - q) / q)).toBeLessThan(1e-4)
    const ch05 = values(solve('HC-11.2', { e: 1, sigma: 100 }))
    expect(ch05[0]).toBeCloseTo(0.0079787126, 9)
    expect(ch05[1]).toBeCloseTo(0.0079788456, 9)
  })

  it('HC-11.2 隨機題的 z = e/σ_v 一定是小數兩位以內（Φ 表可直接查，不必內插）；步驟裡的 Φ 與 K_q 多列幾位讓下一步對得上', () => {
    const def = hc('HC-11.2')
    const es = def.inputs[0].practice?.choices ?? []
    const sigmas = def.inputs[1].practice?.choices ?? []
    expect(es.length * sigmas.length).toBeGreaterThanOrEqual(20)
    for (const e of es)
      for (const s of sigmas) {
        const z100 = (e / s) * 100
        expect(Math.abs(z100 - Math.round(z100)), `e = ${e}、σ_v = ${s}`).toBeLessThan(1e-9)
        expect(def.validate?.({ e, sigma: s })).toBeNull()
      }
    const sol = solve('HC-11.2')
    expect(sol.steps[1].tex).toContain('0.59483487')
    expect(sol.steps[2].tex).toContain(String.raw`2\times0.59483487-1=0.18967`)
    expect(sol.steps[3].tex).toContain(String.raw`\frac{0.797885}{1}=0.797885`)
    // Ch05／T04 的例子：畫面上的 2Φ − 1 用顯示的數字自己算也得到 0.0079787（原本只列 6 位時會算出 0.007978）
    const t04 = solve('HC-11.2', { e: 1, sigma: 100 })
    expect(t04.steps[2].tex).toContain(String.raw`2\times0.50398936-1=0.0079787`)
  })

  it('HC-11.2 手算提示的 Φ 近似：|z| ≤ 0.5 誤差 < 3.2e−4、|z| ≤ 0.3 誤差 < 2.5e−5', () => {
    const approx = (z: number) => 0.5 + 0.39894 * z * (1 - (z * z) / 6)
    let m5 = 0
    let m3 = 0
    for (let i = -500; i <= 500; i++) {
      const z = i / 1000
      const err = Math.abs(approx(z) - normCdf(z))
      m5 = Math.max(m5, err)
      if (Math.abs(z) <= 0.3) m3 = Math.max(m3, err)
    }
    expect(m5).toBeLessThan(3.2e-4)
    expect(m5).toBeGreaterThan(2.5e-4) // 界不是鬆到沒有意義
    expect(m3).toBeLessThan(2.5e-5)
  })

  it('HC-11.3 預設（勘誤 E03：x ∈ {0,1,2,3}、b = 0.5）→ 1.2143／1／1.6 = linearizedFixedPoint；b = 0、c₂ = 0.1 → 1.2571／1.3／1.3', () => {
    const sol = solve('HC-11.3')
    const [wA, wB, wC, varX] = values(sol)
    const off = model({ b: 0.5, sigmaV: 1 })
    expect(wA).toBe(linearizedFixedPoint(off, U4, 'none', false).w)
    expect(wB).toBe(linearizedFixedPoint(off, U4, 'shared_bbpd', false).w)
    expect(wC).toBe(linearizedFixedPoint(off, U4, 'linear_pd', false).w)
    expect(wA).toBeCloseTo(1 + 0.75 / 3.5, 12)
    expect(wB).toBeCloseTo(1, 12)
    expect(wC).toBeCloseTo(1.6, 12)
    expect(varX).toBeCloseTo(1.25, 12)
    // 每一步只做一種運算：分子 → 商 → 加上 a
    expect(sol.steps[3].tex).toContain(String.raw`0.5\times1.5+0\times9=0.75+0=0.75`)
    expect(sol.steps[4].tex).toContain(String.raw`1+\frac{0.75}{3.5}=1+0.214286=1.2143`)
    expect(sol.steps[8].tex).toContain(String.raw`1+\frac{0.75+0}{1.25}=1+\frac{0.75}{1.25}=1+0.6=1.6`)
    // 一階公式也是 MSE-LMS 在三種架構下的精確固定點
    ;(['none', 'shared_bbpd', 'linear_pd'] as const).forEach((mode, i) => expect([wA, wB, wC][i]).toBeCloseTo(mseFixedPoint(off, U4, mode), 12))
    // 補充說明裡的 Sign mean-field（σ_v = 1）：1.2141／1／1.5897
    const note = sol.notes?.join(' ') ?? ''
    for (const s of ['1.2141', '1.5897', '2.8']) expect(note, s).toContain(s)
    const [iA, iB, iC] = values(solve('HC-11.3', { b: 0, c2: 0.1 }))
    expect(iA).toBeCloseTo(1 + 0.9 / 3.5, 12)
    expect(iB).toBeCloseTo(1.3, 12)
    expect(iC).toBeCloseTo(1.3, 12)
    // 置中的 code：三種架構都不受 b 影響
    const centred = values(solve('HC-11.3', { x1: -1.5, x2: -0.5, x3: 0.5, x4: 1.5 }))
    for (const w of centred.slice(0, 3)) expect(w).toBeCloseTo(1, 12)
  })

  it('T12: HC-11.4 預設值 = golden vector T12（E[x²] = 2、E[x⁴] = 6.8、w* = 1.34）且等於 mseFixedPoint；±1 code → 1.10（勘誤 E11）', () => {
    const def = hc('HC-11.4')
    const d = defaultValues(def)
    expect([d.x1, d.x2, d.x3, d.x4, d.x5]).toEqual(golden.inputs.x_values)
    expect(d.a).toBe(golden.inputs.a)
    expect(d.c3).toBe(golden.inputs.c3)
    const [Ex2, Ex4, wStar] = values(solve('HC-11.4'))
    expect(Math.abs(Ex2 - golden.expected.Ex2)).toBeLessThanOrEqual(golden.tolerance.abs)
    expect(Math.abs(Ex4 - golden.expected.Ex4)).toBeLessThanOrEqual(golden.tolerance.abs)
    expect(Math.abs(wStar - golden.expected.w_star)).toBeLessThanOrEqual(golden.tolerance.abs)
    const mo = codeMoments(FIVE)
    expect(Ex2).toBe(mo.Ex2)
    expect(Ex4).toBe(mo.Ex4)
    expect(wStar).toBe(mseFixedPoint(model({ c3: 0.1 }), FIVE))
    const pm = solve('HC-11.4', { x1: -1, x2: -1, x3: 1, x4: 1, x5: 1 })
    expect(values(pm)[2]).toBeCloseTo(1.1, 12)
    expect(pm.notes?.[0]).toContain('共線')
  })

  it('T12: HC-11.5 預設 → Δ = 3.456e−4、1.3403456 = signSecondOrder（T12b）、σ_min = 0.588；σ_v = 10、100 對上 golden 的 mean-field 根', () => {
    const sol = solve('HC-11.5')
    const [w1, delta, w2, sigMin] = values(sol)
    const m = model({ c3: 0.1, sigmaV: 1 })
    expect(w1).toBe(mseFixedPoint(m, FIVE))
    expect(w2).toBe(signSecondOrder(m, FIVE))
    expect(delta).toBeCloseTo(3.456e-4, 12)
    // Δ 就是模型的 signSecondOrder − w₁（顯示時用同一行算式，避免相減損失有效位數）
    expect(Math.abs(delta - (w2 - w1))).toBeLessThan(1e-13)
    expect(sol.steps[5].tex).toContain(String.raw`-\frac{-0.0041472}{12}=0.0003456`)
    expect(sol.steps[6].tex).toContain('1.34+0.0003456=1.3403456')
    expect(sol.notes?.join(' ')).not.toContain('量級估計')
    expect(w2).toBeCloseTo(1.3403456, 12)
    expect(sigMin).toBeCloseTo(Math.sqrt(0.3456), 9)
    expect(sigMin).toBeCloseTo(0.588, 3)
    // σ_min 的定義：把 σ_v 換成 σ_min 時，模型的二階修正量剛好等於 ε
    expect(signSecondOrder(model({ c3: 0.1, sigmaV: sigMin }), FIVE) - w1).toBeCloseTo(0.001, 12)
    // 與 mean-field 精確根（T12b：1.3403458）只差 2e−7
    expect(Math.abs(w2 - signFixedPoint(m, FIVE).w)).toBeLessThan(5e-7)
    expect(sol.notes?.join(' ')).toContain('1.3403458')
    golden.inputs.sigma_list.forEach((s, i) => {
      const w = values(solve('HC-11.5', { sigma: s }))[2]
      expect(Math.abs(w - golden.expected.sign_lms_w_star_list[i]), `σ_v = ${s}`).toBeLessThanOrEqual(golden.tolerance_overrides.sign_lms_w_star_list.abs)
    })
    // σ_v = 100：二階近似與 mean-field 根只差浮點捨入（2e−16），補充說明不把它當成有意義的差距顯示
    const far = solve('HC-11.5', { sigma: 100 })
    expect(far.steps[6].tex).toContain(String.raw`1.34+3.456\times10^{-8}=1.340000035`)
    expect(far.notes?.[0]).toContain('1.340000035')
    expect(far.notes?.[0]).toContain('相同')
    expect(far.notes?.join(' ')).not.toMatch(/10\^\{-1[5-9]\}/)
    expect(solve('HC-11.5', { sigma: 10 }).notes?.[0]).toContain(String.raw`2.5\times10^{-11}`)
    // 對答案的容差：1.34035 算對、只寫 1.3403 或 1.34 不算（看不出修正量）
    const r = sol.results[2]
    expect(checkAnswer(1.34035, r).ok).toBe(true)
    expect(checkAnswer(1.3403, r).ok).toBe(false)
    expect(checkAnswer(1.34, r).ok).toBe(false)
  })

  it('HC-11.5 的適用範圍：max|e₀|/σ_v ≤ 1.2（σ_v = 0.2）時二階近似離 mean-field 根 < 1e−4；超過就拒絕', () => {
    const def = hc('HC-11.5')
    const at = (sigma: number) => ({ ...defaultValues(def), sigma })
    // 邊界：0.24/0.2 = 1.2
    expect(0.24 / 0.2).toBeCloseTo(SECOND_ORDER_MAX_RATIO, 12)
    expect(def.validate?.(at(0.2))).toBeNull() // 內文的「σ_v ≳ 0.2 時有效」：邊界值本身可以算
    const w = def.solve(at(0.2)).results[2].value
    expect(Math.abs(w - signFixedPoint(model({ c3: 0.1, sigmaV: 0.2 }), FIVE).w)).toBeLessThan(1e-4)
    expect(def.validate?.(at(0.19))).toMatch(/不收斂/)
    expect(def.validate?.(at(0.1))).toMatch(/不收斂/)
  })

  it('HC-11.5：很小的 c₃ 時 Δ 不會被捨成 0（步驟與答案一致）；σ_min 落在適用範圍外時加註「只能當量級估計」', () => {
    const tiny = solve('HC-11.5', { c3: 1e-4 })
    const [w1, delta, w2] = values(tiny)
    expect(delta).toBeGreaterThan(0)
    expect(Math.abs(delta / 3.456e-13 - 1)).toBeLessThan(1e-9) // 0.3456·c₃³/σ_v²
    expect(Math.abs(w2 - w1 - delta)).toBeLessThan(1e-15)
    expect(tiny.steps[5].tex).toContain(String.raw`3.456\times10^{-13}`)
    // 這時 σ_min = 1.9e−5 沒有意義：無雜訊的中位數離 w₁ 也只有 0.6c₃ = 6e−5 < ε ⇒ 補充說明直接講「任何 σ_v 都合格」
    expect(tiny.notes?.join(' ')).toContain('任何 $\\sigma_v$ 都合格')
    expect(Math.abs(signWeightedMedian(model({ c3: 1e-4 }), FIVE.values, FIVE.probs).lo - w1)).toBeLessThan(0.001)
    // c₃ = 0：所有殘差都是 0，Δ = 0、σ_min = 0，不出現浮點殘渣
    const none = solve('HC-11.5', { c3: 0 })
    expect(values(none)).toEqual([1, 0, 1, 0])
    expect(none.steps.map((s) => s.tex).join(' ')).not.toMatch(/10\^\{-\d\d\}/)
    // c₃ = 0.05、ε = 0.005：σ_min = 0.093，max|e₀|/σ_min = 0.12/0.093 = 1.29 > 1.2 ⇒ 加註
    const wide = solve('HC-11.5', { a: 0.9, c3: 0.05, eps: 0.005 })
    expect(values(wide)[3]).toBeCloseTo(Math.sqrt(0.00864), 9)
    expect(wide.notes?.join(' ')).toContain('量級估計')
    // 加註是誠實的提醒而不是誤報：這時 mean-field 根的實際偏移與 ε 只差 2% 以內（不是差一個量級）
    const mf = signFixedPoint(model({ a: 0.9, c3: 0.05, sigmaV: values(wide)[3] }), FIVE).w
    expect(Math.abs((mf - values(wide)[0]) / 0.005 - 1)).toBeLessThan(0.03)
  })

  it('T12: HC-11.6 預設 → 1.4 = signWeightedMedian（T12c）、MSE 1.34（T12a）；b = 0.1、c₃ = 0 → dead zone (0.95, 1.05)', () => {
    const sol = solve('HC-11.6')
    const [lo, hi, mean] = values(sol)
    const nf = model({ c3: 0.1 })
    const med = signWeightedMedian(nf, FIVE.values, FIVE.probs)
    expect(lo).toBe(med.lo)
    expect(hi).toBe(med.hi)
    expect(lo).toBeCloseTo(1.4, 12)
    expect(hi).toBeCloseTo(1.4, 12)
    expect(mean).toBe(mseWeightedMean(nf, FIVE.values, FIVE.probs))
    expect(mean).toBeCloseTo(1.34, 12)
    // 驗算步驟：零交越兩側 +0.4 → −1.2
    expect(sol.steps[5].tex).toContain('-0.4+0.8=0.4')
    expect(sol.steps[5].tex).toContain('-0.4-0.8=-1.2')
    // MSE 的加權平均拆成兩步：先列四個乘積，再相加後相除
    expect(sol.steps[6].tex).toContain(String.raw`0.8\times1.4,\ 0.2\times1.1,\ 0.2\times1.1,\ 0.8\times1.4\;=\;1.12,\ 0.22,\ 0.22,\ 1.12`)
    expect(sol.steps[7].tex).toContain(String.raw`\frac{1.12+0.22+0.22+1.12}{0.8+0.2+0.2+0.8}=\frac{2.68}{2}=1.34`)
    const dz = solve('HC-11.6', { b: 0.1, c3: 0 })
    expect(values(dz)[0]).toBeCloseTo(0.95, 12)
    expect(values(dz)[1]).toBeCloseTo(1.05, 12)
    expect(values(dz)[2]).toBeCloseTo(1, 12) // MSE：置中的 code 下 offset 不造成 bias
    expect(dz.notes?.[0]).toContain('dead zone')
    expect(dz.steps[5].tex).toContain(String.raw`\text{稍低於 }0.95\big)=-0.2+0.4+0.4+0.2=0.8`)
    expect(dz.steps[5].tex).toContain(String.raw`\text{稍高於 }1.05\big)=-0.2-0.4-0.4+0.2=-0.8`)
    // 沒有 offset 也沒有 INL：四個 t 都相同（表只有一列），驗算不重複寫成「1.2=1.2」，補充說明改成「兩種演算法沒有差別」
    const flat = solve('HC-11.6', { b: 0, c3: 0 })
    expect(values(flat)).toEqual([1, 1, 1])
    expect(flat.steps[5].tex).not.toContain('1.2=1.2')
    expect(flat.steps[5].tex).toContain(String.raw`E[G](w^*\text{ 稍低})=1.2,`)
    expect(flat.notes?.[1]).toContain('沒有差別')
    // 兩種效應都有：b = 0.05、c₃ = 0.1 → 唯一的中位數 1.375
    for (const w of values(solve('HC-11.6', { b: 0.05 })).slice(0, 2)) expect(w).toBeCloseTo(1.375, 12)
  })

  it('HC-11.7 預設（§11.4 表：B = 0.01、C = 0.01）→ 1.01、2、−100、S = K_q·C；其餘三列與 repelling 註記', () => {
    const sol = solve('HC-11.7')
    const [wStatic, wNear, dwdC, S] = values(sol)
    expect(wStatic).toBeCloseTo(1.01, 12)
    expect(wNear).toBeCloseTo(2, 12)
    expect(dwdC).toBeCloseTo(-100, 9)
    expect(S).toBe(KQ_FACTOR * 0.01)
    // 表格其餘三列（B = 0.01）：C = 1、0.1、−0.01
    const rows: [number, number, number][] = [
      [1, 0.01, -0.01],
      [0.1, 0.1, -1],
      [-0.01, -1, -100],
    ]
    for (const [C, bias, sens] of rows) {
      const v = values(solve('HC-11.7', { C }))
      expect(v[1] - 1, `C = ${C}`).toBeCloseTo(bias, 10)
      expect(v[2], `C = ${C}`).toBeCloseTo(sens, 8)
    }
    expect(solve('HC-11.7', { C: -0.01 }).notes?.[0]).toContain('repelling')
    // 靜態結果 a + κ 與 E[x²] 無關，並等於模型的 MSE／Sign 固定點（F-11.13）
    for (const w of values(solve('HC-11.7', { kd: 0.1, px: 2, C: 2 })).slice(0, 2)) expect(w).toBeCloseTo(1.1, 12)
    expect(mseFixedPoint(model({ kappa: 0.1 }), FIVE)).toBeCloseTo(1.1, 12)
    expect(signFixedPoint(model({ kappa: 0.1, sigmaV: 0.5 }), FIVE).w).toBeCloseTo(1.1, 9)
  })

  it('nearIntegerSensitivity（HC-11.7 與 §11.4 表格用）與 nearIntegerSweep 的 bias／slope 逐點相同', () => {
    const sigmaV = 0.8
    const sweep = nearIntegerSweep({ fracs: [0.004, 0.05, 0.3], wnTs: 0.05, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV, length: 4096 })
    expect(sweep.frac.length).toBe(3)
    sweep.frac.forEach((_, i) => {
      const s = nearIntegerSensitivity(sweep.B, sweep.Cfreq[i], sigmaV)
      expect(s.bias).toBe(sweep.bias[i])
      expect(s.slope).toBe(sweep.slope[i])
      expect(s.Kq).toBe(sweep.Kq)
      expect(s.attracting).toBe(sweep.Cfreq[i] > 0)
      // 同一個 C 代進手算題：標準化 code（E[x²] = 1）、κ_d = B
      const v = values(solve('HC-11.7', { kd: sweep.B, px: 1, C: sweep.Cfreq[i], sigma: sigmaV }))
      expect(v[1] - 1).toBeCloseTo(sweep.bias[i], 10)
      expect(v[3]).toBe(sweep.slope[i])
    })
    // 邊界：C = 0 不可辨識、σ_v = 0 沒有 K_q
    expect(nearIntegerSensitivity(0.01, 0, 1).bias).toBeNaN()
    expect(nearIntegerSensitivity(0.01, 0.1, 0).Kq).toBeNaN()
  })

  it('T12: HC-11.8 預設（Gallery #7）→ offset 0、INL 0.34、w* = 1.34、指標 0.24、μ = autoMu(K_q·E[x²])；Lab「試試看」#4 的 0.0667', () => {
    const sol = solve('HC-11.8')
    const [off, inl, wStar, ratio, mu] = values(sol)
    const m = model({ c3: 0.1, sigmaV: 1 })
    const lin = linearizedFixedPoint(m, FIVE, 'none', false)
    expect(off).toBe(0)
    expect(inl).toBeCloseTo(0.34, 12)
    expect(wStar).toBe(lin.w)
    expect(wStar).toBeCloseTo(1.34, 12)
    expect(ratio).toBeCloseTo(0.24, 12)
    expect(ratio).toBeLessThanOrEqual(LINEAR_OK_RATIO)
    expect(lin.slope).toBeCloseTo(KQ_FACTOR * 2, 12)
    expect(mu).toBe(autoMu(lin.slope))
    expect(mu).toBeCloseTo(0.0125331, 6)
    // 殘差表（每列：三個乘積 → 最後一欄的 e_det）與 mean-field 根（T12b）出現在步驟／補充說明
    const table = sol.steps[9].tex
    expect(table).toContain(String.raw`-2&(-0.34)\times(-2)=0.68&0&0\times4=0&0.1\times(-8)=-0.8&-0.12`)
    expect(table).toContain(String.raw`-1&(-0.34)\times(-1)=0.34&0&0\times1=0&0.1\times(-1)=-0.1&0.24`)
    expect(table).toContain(String.raw`2&(-0.34)\times2=-0.68&0&0\times4=0&0.1\times8=0.8&0.12`)
    expect(table.split(String.raw`\\`).length).toBe(6) // 表頭 + 5 個 code
    expect(sol.notes?.join(' ')).toContain('1.340346')
    // 中間量比答案多顯示一位：K_q = 0.797885、S = 1.59577 ⇒ μ = 0.02/1.59577 = 0.012533
    expect(sol.steps[11].tex).toContain('0.797885')
    expect(sol.steps[13].tex).toContain(String.raw`\frac{0.02}{1.59577}=0.012533`)
    // Lab「試試看」第 4 點：c₃ = 0、b = 0.2、x₀ = 2 → b·E[x]/E[x²] = 0.2·2/6
    const shifted = values(solve('HC-11.8', { c3: 0, b: 0.2, x0: 2 }))
    expect(shifted[0]).toBeCloseTo(0.2 / 3, 12)
    expect(shifted[2]).toBeCloseTo(1 + 0.2 / 3, 12)
    // σ_v = 0.5：指標 0.48 > 0.3 ⇒ 補充說明改成「線性化失效風險」
    const noisy = solve('HC-11.8', { sigma: 0.5 })
    expect(values(noisy)[3]).toBeCloseTo(0.48, 12)
    expect(noisy.notes?.[0]).toContain('線性化失效風險')
    // 殘差是偶函數（c₃ = 0、置中的 code）：指標 0.8 > 0.3，但 mean-field 根仍等於一階解 ⇒ 不說「相差 0」，改成解釋對稱性
    const even = { b: 0.2, c2: 0.05, c3: 0, kappa: 0.05, sigma: 0.5 }
    const evenSol = solve('HC-11.8', even)
    expect(values(evenSol)[3]).toBeCloseTo(0.8, 12)
    expect(signFixedPoint(model({ b: 0.2, c2: 0.05, kappa: 0.05, sigmaV: 0.5 }), FIVE).w).toBeCloseTo(values(evenSol)[2], 9)
    expect(evenSol.notes?.[0]).toContain('偶函數')
    expect(evenSol.notes?.[0]).not.toContain('相差')
    // 完全沒有誤差：不出現 1.1e−16 之類的浮點殘渣
    const clean = solve('HC-11.8', { c3: 0 })
    expect(clean.notes?.[0]).toContain('相同')
    expect(clean.notes?.join(' ')).not.toMatch(/10\^\{-1\d\}/)
  })
})

/* ───────────── (b) 隨機出題：有限、與獨立重算一致、TeX 可渲染 ───────────── */

describe('Ch11 handcalcs：換一題（randomValues）', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：20 個 seed 的答案有限、等於測試內的獨立重算，且所有 TeX 可渲染', (id, def) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同一個 seed 可重現
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, `${id} seed ${seed}`).toBeNull()
      const sol = def.solve(v)
      expect(sol.steps.length).toBeGreaterThan(0)
      const want = INDEPENDENT[id](v)
      expect(sol.results.length).toBe(want.length)
      sol.results.forEach((r, i) => expectNear(r.value, want[i], `${id} seed ${seed} ${JSON.stringify(v)} 第 ${i + 1} 個答案`))
      expect(texProblems(def, sol), `${id} seed ${seed} ${JSON.stringify(v)}`).toEqual([])
    }
    expect(seen.size, `${id} 抽到的題目種類`).toBeGreaterThanOrEqual(8)
  })

  it('預設值也通過同一組獨立重算（worked example 與手算鏈一致）', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const sol = def.solve(v)
      const want = INDEPENDENT[def.id](v)
      sol.results.forEach((r, i) => expectNear(r.value, want[i], `${def.id} 第 ${i + 1} 個答案`))
    }
  })
})

/* ───────────── (b2) 每一步的數字都對得起來（手算的人照著畫面上的數字算，會得到下一個數字） ───────────── */

describe('Ch11 handcalcs：步驟裡代入的數字前後一致（算術鏈）', () => {
  it('檢查器本身：正確的鏈通過；代錯數字、正負號顛倒（δ 極性）、漏乘都抓得到', () => {
    expect(evalExpr('((1)/(5))(4+1+0+1+4)')).toBeCloseTo(2, 12)
    expect(evalExpr('-((-0.0041472)/(6*1^2*2))')).toBeCloseTo(3.456e-4, 12)
    expect(evalExpr('sqrt(((0.0003456*1^2)/(0.001)))')).toBeCloseTo(Math.sqrt(0.3456), 12)
    expect(evalExpr('4.32*10^(-5)')).toBeCloseTo(4.32e-5, 15)
    const good = chainCheck(String.raw`e(1;w)=(a-w)\cdot1+c_3\cdot1^3=(1-1.34)+0.1=-0.34+0.1=-0.24`)
    expect(good.checked).toBe(2)
    expect(good.bad).toEqual([])
    expect(good.seen).toHaveLength(3)
    // δ = a − w 寫成 w − a：(1.34 − 1) + 0.1 = 0.44 ≠ −0.24
    expect(chainCheck(String.raw`e(1;w)=(a-w)\cdot1+c_3\cdot1^3=(1.34-1)+0.1=-0.34+0.1=-0.24`).bad.length).toBe(1)
    expect(chainCheck(String.raw`E[x^2]=\tfrac15\big(4+1+0+1+4\big)=\tfrac{10}{5}=2.2`).bad.length).toBe(1)
    expect(chainCheck(String.raw`x\,e:\quad (-2)\times(-0.12),\ 2\times0.12\;=\;0.24,\ -0.24`).bad.length).toBe(1)
    expect(chainCheck(String.raw`\begin{array}{r|l}x&k\,x\\\hline2&(-0.34)\times2=0.68\end{array}`).bad.length).toBe(1)
    // 含符號的片段不參與比對
    expect(chainCheck(String.raw`\Phi(z)=\Phi(0.24)\approx0.59483487`).checked).toBe(0)
  })

  const EXTRA: Record<string, Record<string, number>[]> = {
    'HC-11.1': [{ a: -1.5, c3: -0.3, w: -2 }, { a: 1, c3: 0, w: 1 }],
    'HC-11.2': [{ e: 1, sigma: 100 }, { e: -3.4, sigma: 1 }, { e: 0, sigma: 2 }, { e: 0.24, sigma: 0.3 }],
    'HC-11.3': [{ a: 1, b: 0, c2: 0.1, x1: 0, x2: 1, x3: 2, x4: 3 }, { a: -1, b: 0.3, c2: -0.2, x1: -3, x2: 0.5, x3: 2, x4: 7 }, { a: 1, b: -0.2, c2: 0.05, x1: -1, x2: 0, x3: 1, x4: 3 }],
    'HC-11.4': [{ a: 1, c3: -0.1, x1: -2, x2: -2, x3: 0, x4: 2, x5: 2 }, { a: -2, c3: 0.3, x1: 0.5, x2: 1.5, x3: -2.5, x4: 4, x5: 0 }],
    'HC-11.5': [{ a: 1, c3: 0.1, sigma: 100, eps: 0.001 }, { a: 1, c3: 0.1, sigma: 0.2, eps: 0.001 }, { a: 1, c3: -0.1, sigma: 0.5, eps: 0.002 }, { a: 1, c3: 0, sigma: 1, eps: 0.001 }, { a: 1, c3: 0.0001, sigma: 1, eps: 0.001 }],
    'HC-11.6': [{ a: 1, b: 0.1, c3: 0 }, { a: 1, b: 0, c3: -0.1 }, { a: 1, b: -0.3, c3: 0.02 }, { a: 1, b: 0, c3: 0 }, { a: 1, b: 0.6, c3: 0.1 }],
    'HC-11.7': [{ a: 1, kd: 0.01, px: 1, C: -0.01, sigma: 1 }, { a: 1, kd: -0.05, px: 0.5, C: 0.02, sigma: 0.5 }, { a: 1, kd: 0, px: 1, C: 0.1, sigma: 2 }],
    'HC-11.8': [{ a: 1, b: 0.2, c2: 0, c3: 0, kappa: 0, x0: 2, sigma: 1 }, { a: 1, b: -0.2, c2: 0.05, c3: -0.05, kappa: -0.02, x0: -1, sigma: 1 }, { a: 1, b: 0.1, c2: 0.05, c3: 0.1, kappa: 0.02, x0: 0.5, sigma: 2 }],
  }

  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值、20 個隨機題與手動輸入的邊界值（負數、非整數 code、C < 0…），每條等號鏈都相等', (id, def) => {
    const cases = [defaultValues(def), ...Array.from({ length: 20 }, (_, k) => randomValues(def, k + 1)), ...EXTRA[id]]
    let total = 0
    for (const v of cases) {
      expect(def.validate?.(v) ?? null, `${id} ${JSON.stringify(v)}`).toBeNull()
      const sol = def.solve(v)
      let perCase = 0
      const seen: number[] = []
      sol.steps.forEach((s, k) => {
        const r = chainCheck(s.tex)
        expect(r.bad, `${id} 第 ${k + 1} 步 ${JSON.stringify(v)}：${s.tex}`).toEqual([])
        perCase += r.checked
        seen.push(...r.seen)
      })
      // 幾乎每一步都至少有一組「代入 = 結果」被實際比對（檢查器沒有因為解析不了而整題略過）
      expect(perCase, `${id} ${JSON.stringify(v)} 比對的組數`).toBeGreaterThanOrEqual(sol.steps.length - 2)
      // 步驟真的走到答案：每個答案（來自 bias.ts）都以顯示的精度出現在某一步裡，不是另外冒出來的數字
      for (const r of sol.results)
        expect(
          seen.some((x) => Math.abs(x - r.value) <= 1e-4 * Math.abs(r.value) + 1e-12),
          `${id} ${JSON.stringify(v)}：答案 ${r.symbol} = ${r.value} 沒有出現在步驟裡`,
        ).toBe(true)
      total += perCase
    }
    expect(total).toBeGreaterThan(cases.length * 6)
  })
})

/* ───────────── (c) validate：擋掉模型不適用的輸入並說明原因 ───────────── */

describe('Ch11 handcalcs：validate', () => {
  const reject = (id: string, over: Record<string, number>, pattern: RegExp) => {
    const def = hc(id)
    const msg = def.validate?.({ ...defaultValues(def), ...over })
    expect(msg, `${id} ${JSON.stringify(over)}`).toMatch(pattern)
    // 訊息裡的 $…$ 都能渲染
    const parts = (msg ?? '').split('$')
    expect(parts.length % 2, `${id} 訊息的 $ 成對`).toBe(1)
    parts.forEach((p, i) => {
      if (i % 2 === 1) expect(renderTex(p, false), `${id}: ${p}`).not.toMatch(/katex-error|c-tex-error/)
    })
  }

  it('預設值都合法；HC-11.1 與 HC-11.6 沒有不適用的區域', () => {
    for (const def of HANDCALCS) expect(def.validate?.(defaultValues(def)) ?? null, def.id).toBeNull()
    expect(hc('HC-11.1').validate).toBeUndefined()
    expect(hc('HC-11.6').validate).toBeUndefined()
  })

  it('HC-11.2：σ_v = 0（無雜訊，沒有 K_q）與 |e|/σ_v 超出 Φ 表範圍', () => {
    reject('HC-11.2', { sigma: 0 }, /無雜訊/)
    reject('HC-11.2', { e: 4, sigma: 1 }, /飽和/)
    expect(hc('HC-11.2').validate?.({ e: PHI_TABLE_MAX, sigma: 1 })).toBeNull()
    expect(hc('HC-11.2').validate?.({ e: -3.5, sigma: 1 })).toMatch(/飽和/)
  })

  it('HC-11.3：四個 code 都相同（Var(x) = 0）；HC-11.4：五個 code 都是 0（E[x²] = 0）', () => {
    reject('HC-11.3', { x1: 2, x2: 2, x3: 2, x4: 2 }, /不可辨識/)
    reject('HC-11.3', { x1: 0, x2: 0, x3: 0, x4: 0 }, /不可辨識/)
    reject('HC-11.4', { x1: 0, x2: 0, x3: 0, x4: 0, x5: 0 }, /不可辨識/)
    expect(hc('HC-11.4').validate?.({ a: 1, c3: 0.1, x1: 0, x2: 0, x3: 0, x4: 0, x5: 3 })).toBeNull()
  })

  it('HC-11.5：σ_v = 0、ε ≤ 0、以及 max|e₀|/σ_v > 1.2（泰勒展開不收斂）', () => {
    reject('HC-11.5', { sigma: 0 }, /加權中位數/)
    reject('HC-11.5', { eps: 0 }, /大於 0/)
    reject('HC-11.5', { sigma: 0.05 }, /不收斂/)
    reject('HC-11.5', { c3: 0.6 }, /不收斂/) // max|e₀| = 2.4·0.6 = 1.44 > 1.2σ_v
  })

  it('HC-11.7：C = 0（不可辨識）、E[x²] ≤ 0、σ_v ≤ 0；C < 0 可以算（標成 repelling）', () => {
    reject('HC-11.7', { C: 0 }, /不可辨識/)
    reject('HC-11.7', { px: 0 }, /激勵/)
    reject('HC-11.7', { sigma: 0 }, /K_q/)
    expect(hc('HC-11.7').validate?.({ ...defaultValues(hc('HC-11.7')), C: -0.5 })).toBeNull()
  })

  it('HC-11.8：σ_v = 0（一階公式與 μ = g/(K_q E[x²]) 都不適用）', () => {
    reject('HC-11.8', { sigma: 0 }, /加權中位數/)
  })
})

/* ───────────── (d) 元件渲染 ───────────── */

describe('Ch11 handcalcs：<HandCalc> 渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值渲染出所有步驟與答案，沒有 KaTeX 錯誤、沒有殘留的 $', (_id, def) => {
    const sol = def.solve(defaultValues(def))
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(sol.steps.length).toBeGreaterThanOrEqual(6)
    expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length).toBe(sol.results.length)
    expect(container.querySelectorAll('.c-handcalc-input').length).toBe(def.inputs.length)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\$/)
    expect(text).not.toMatch(/NaN|undefined/)
    expect(texProblems(def, sol)).toEqual([])
    unmount()
  })

  it('不合法的輸入顯示原因（含公式）而不是步驟；改回合法值後恢復', () => {
    const { container } = render(<HandCalc def={hc('HC-11.5')} />)
    const sigma = screen.getByLabelText(/comparator 前雜訊的標準差/) as HTMLInputElement
    fireEvent.change(sigma, { target: { value: '0.05' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('泰勒展開不收斂')
    expect(container.querySelector('.callout-warn .katex')).not.toBeNull()
    expect(container.querySelector('.katex-error')).toBeNull()
    fireEvent.change(sigma, { target: { value: '0.5' } })
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('1.3413824') // 1.34 + 3.456e−4/0.25
  })

  it('自己算算看：HC-11.4 填入 2、6.8、1.34 全對；填錯會被抓到', () => {
    const { container } = render(<HandCalc def={hc('HC-11.4')} initialMode="practice" />)
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const boxes = screen.getAllByPlaceholderText('你的答案')
    expect(boxes.length).toBe(3)
    fireEvent.change(boxes[0], { target: { value: '2' } })
    fireEvent.change(boxes[1], { target: { value: '6.8' } })
    fireEvent.change(boxes[2], { target: { value: '1.4' } }) // 把無雜訊 Sign 的答案誤當成 MSE
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(2)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad').length).toBe(1)
    fireEvent.change(boxes[2], { target: { value: '1.34' } })
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(3)
  })
})
