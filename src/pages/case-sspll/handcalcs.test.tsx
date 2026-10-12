import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, MathText, defaultValues, randomValues, renderTex } from '@/components'
import type { HandCalcDef } from '@/data/types'
import {
  W1,
  analyseAlpha,
  eqOffset,
  foldFreq,
  gammaEff,
  gosBeta,
  gosOffsetBias,
  kqGain,
  kqOffset,
  loopH,
  loopL,
  loopStable,
  makeL1,
  makeL2,
  nominalLoops,
  oneDiffMargin,
  phosM1Bounds,
  singleLinePhos,
  toySignLmsStep,
  typeIIFinv,
  typeIIOneDiffG,
  typeIIReL,
  typeIKClosedForm,
  typeILatencyCriterion,
  typeIReH,
} from '@/simulation/models/sspll'
import { FORMULAS } from './formulas'
import { PARAMS, WORKED } from './data'
import { HANDCALCS, HC_FREF_MHZ, HC_NOMINAL } from './handcalcs'

const hc = (id: string): HandCalcDef => {
  const d = HANDCALCS.find((h) => h.id === id)
  if (!d) throw new Error(`找不到 ${id}`)
  return d
}
const values = (def: HandCalcDef, v: Record<string, number>): number[] => def.solve(v).results.map((x) => x.value)
const withDefaults = (def: HandCalcDef, patch: Record<string, number> = {}): Record<string, number> => ({ ...defaultValues(def), ...patch })

function close(got: number, want: number, rel = 1e-9, abs = 1e-12, msg?: string) {
  expect(Number.isFinite(got), msg).toBe(true)
  expect(Math.abs(got - want), `${msg ?? ''} got ${got}, want ${want}`).toBeLessThanOrEqual(abs + rel * Math.abs(want))
}

// ── 測試內的獨立重算：只用 Math，不呼叫 sspll.ts ─────────────────────────────────────────
type Cx = [number, number]
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
/** z^-k 在單位圓上：e^{−jkΩ} */
const zPow = (W: number, k: number): Cx => [Math.cos(k * W), -Math.sin(k * W)]
/** 1 − z⁻¹ */
const oneMinusZ = (W: number): Cx => [1 - Math.cos(W), Math.sin(W)]
/** Type-I：L = K z^-d/(1 − z⁻¹) */
const typeIL = (K: number, d: number, W: number): Cx => {
  const q = cdiv(zPow(W, d), oneMinusZ(W))
  return [K * q[0], K * q[1]]
}
/** Type-II：L = (Kp + Ki/(1 − z⁻¹)) z⁻¹/(1 − z⁻¹) */
const typeIIL = (Kp: number, Ki: number, W: number): Cx => {
  const acc = cdiv([1, 0], oneMinusZ(W))
  return cmul([Kp + Ki * acc[0], Ki * acc[1]], cdiv(zPow(W, 1), oneMinusZ(W)))
}
const reH = (L: Cx): number => (1 + L[0]) / ((1 + L[0]) ** 2 + L[1] ** 2)
/** erf 的 Maclaurin 級數（|z| ≤ 2.2 時收斂到 1e-13） */
function erfSeries(z: number): number {
  let sum = 0
  let term = z // (−1)^k z^{2k+1}/k!
  for (let k = 0; k < 90; k++) {
    sum += term / (2 * k + 1)
    term *= (-z * z) / (k + 1)
  }
  return (2 / Math.sqrt(Math.PI)) * sum
}
const W1_INDEP = (64 * Math.sin(Math.PI / 8) ** 2) / Math.PI ** 2
const finvIndep = (Kp: number, Ki: number, fref: number): number => (fref / Math.PI) * Math.asin(Math.sqrt(Ki / (2 * (2 - Kp))))

/** 每一題的答案（results 的順序）以最直接的寫法重算 */
const INDEP: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-CS.1': ({ a, w0, mu, x, g }) => {
    const w = [w0]
    for (let i = 0; i < 4; i++) {
      const e = g * (a - w[i]) * x
      w.push(w[i] + mu * (e >= 0 ? 1 : -1) * x)
    }
    return [w[1], w[4], a - w[4]]
  },
  'HC-CS.2': ({ f, fref, Ki }) => {
    const W = (2 * Math.PI * f) / fref
    return [W, -(W * W) / Ki, (-4 * Math.sin(W / 2) ** 2) / Ki]
  },
  'HC-CS.3': ({ K, d, f, fref }) => {
    const W = (2 * Math.PI * f) / fref
    return [K * (d - 0.5), ((W * W) / (K * K)) * (1 - K * (d - 0.5)), reH(typeIL(K, d, W))]
  },
  'HC-CS.4': ({ Kp, Ki, fref }) => [Ki / (2 * (2 - Kp)), finvIndep(Kp, Ki, fref)],
  'HC-CS.5': ({ f, fref, Kp, Ki }) => {
    const L = typeIIL(Kp, Ki, (2 * Math.PI * f) / fref)
    return [L[0], (1 + L[0]) ** 2 + L[1] ** 2, reH(L), W1_INDEP * reH(L)]
  },
  'HC-CS.6': ({ Kp, Ki }) => [Kp - Ki / 2, 2 - Kp - Ki / 2, Math.min(Kp - Ki / 2, 2 - Kp - Ki / 2)],
  'HC-CS.7': ({ uos, sigma, kG, rho }) => {
    const Eq = erfSeries(uos / (Math.SQRT2 * sigma))
    const Kq = (Math.sqrt(2 / Math.PI) / sigma) * Math.exp((-uos * uos) / (2 * sigma * sigma))
    return [Eq, Kq, (-Eq * rho) / (Kq * (kG / 12))]
  },
  'HC-CS.8': ({ alpha, fref, Kp, Ki }) => {
    const fRot = Math.min(alpha, 1 - alpha) * fref
    const finv = finvIndep(Kp, Ki, fref)
    return [fRot, 8 * alpha - Math.floor(8 * alpha), finv, fRot - finv, Math.min(Kp - Ki / 2, 2 - Kp - Ki / 2)]
  },
}

// ── 畫面上的算式：把每一步的 TeX 重新求值（只用畫面上的數字） ───────────────────────────────
function matchBrace(t: string, open: number): number {
  let depth = 0
  for (let i = open; i < t.length; i++) {
    if (t[i] === '{') depth++
    else if (t[i] === '}' && --depth === 0) return i
  }
  throw new Error(`大括號不成對：${t}`)
}

/** 在最外層（不在括號或大括號裡）以 sep 切開 */
function splitTop(t: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '{' || c === '(') depth++
    else if (c === '}' || c === ')') depth--
    if (depth === 0 && t.startsWith(sep, i)) {
      out.push(cur)
      cur = ''
      i += sep.length - 1
    } else cur += c
  }
  out.push(cur)
  return out
}

/** TeX → 只含數字、運算子與函數代號的字串（S sin、C cos、A arcsin、E erf、X exp、R sqrt、M min、F floor、P π） */
function normTex(seg: string): string {
  let t = seg
    .replace(/\\ \\mathrm\{[A-Za-z/]+\}(\^\{-?\d+\})?/g, '') // 單位
    .replace(/\\[,;! ]/g, ' ')
    .replace(/\\(?:left|right|big|Big)/g, '')
    .replace(/\\\{/g, '(')
    .replace(/\\\}/g, ')')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\\lfloor/g, 'F(')
    .replace(/\\rfloor/g, ')')
    .replace(/\\mathrm\{erf\}/g, 'E')
    .replace(/\\arcsin/g, 'A')
    .replace(/\\sin/g, 'S')
    .replace(/\\cos/g, 'C')
    .replace(/\\min/g, 'M')
    .replace(/\\pi/g, 'P')
    .replace(/\\times|\\cdot/g, '*')
  t = t.replace(/\\[td]?frac(\d)(\d)/g, '(($1)/($2))') // \tfrac12
  for (let i = t.search(/\\[td]?frac/); i >= 0; i = t.search(/\\[td]?frac/)) {
    const a0 = t.indexOf('{', i)
    if (a0 !== i + t.slice(i).indexOf('frac') + 4) return 'x' // \frac 後面不是 {…}{…}：當成符號式
    const a1 = matchBrace(t, a0)
    const b1 = matchBrace(t, a1 + 1)
    t = `${t.slice(0, i)}((${t.slice(a0 + 1, a1)})/(${t.slice(a1 + 2, b1)}))${t.slice(b1 + 1)}`
  }
  for (let i = t.indexOf('\\sqrt{'); i >= 0; i = t.indexOf('\\sqrt{')) {
    const b = matchBrace(t, i + 5)
    t = `${t.slice(0, i)}R(${t.slice(i + 6, b)})${t.slice(b + 1)}`
  }
  for (let i = t.indexOf('e^{'); i >= 0; i = t.indexOf('e^{')) {
    const b = matchBrace(t, i + 2)
    t = `${t.slice(0, i)}X(${t.slice(i + 3, b)})${t.slice(b + 1)}`
  }
  return t.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\s+/g, '')
}

/**
 * 把一段「只含數字」的 TeX 求值；含符號（字母）的片段回傳 null。遞迴下降剖析（不用 eval），
 * 所以 8\times10^{-7}、(-0.3)^2、(5\times10^{-5})^2、2\pi\times20 的優先順序和數學上相同。
 */
function evalTex(seg: string): number | null {
  const t = normTex(seg)
  if (!/^[0-9.+\-*/^(),SCAEXRMFP]+$/.test(t) || !/[0-9]/.test(t)) return null
  let pos = 0
  const FN: Record<string, (...a: number[]) => number> = {
    S: Math.sin,
    C: Math.cos,
    A: Math.asin,
    E: erfSeries,
    X: Math.exp,
    R: Math.sqrt,
    M: Math.min,
    F: Math.floor,
  }
  const expr = (): number => {
    let v = term()
    while (t[pos] === '+' || t[pos] === '-') v = t[pos++] === '+' ? v + term() : v - term()
    return v
  }
  const startsAtom = (): boolean => pos < t.length && /[0-9.(SCAEXRMFP]/.test(t[pos])
  const term = (): number => {
    let v = unary()
    for (;;) {
      if (t[pos] === '*') {
        pos++
        v *= unary()
      } else if (t[pos] === '/') {
        pos++
        v /= unary()
      } else if (startsAtom()) v *= unary() // 省略的乘號：2\pi、)(…
      else return v
    }
  }
  const unary = (): number => {
    if (t[pos] === '-') return pos++, -unary()
    if (t[pos] === '+') return pos++, unary()
    const base = atom()
    if (t[pos] !== '^') return base
    pos++
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
    if (c === 'P') return pos++, Math.PI
    if (FN[c]) {
      pos++
      if (t[pos++] !== '(') throw new Error(`函數後面要有括號：${seg}`)
      const args = [expr()]
      while (t[pos] === ',') {
        pos++
        args.push(expr())
      }
      if (t[pos++] !== ')') throw new Error(`括號不成對：${seg}`)
      return FN[c](...args)
    }
    const m = /^\d+(?:\.\d+)?/.exec(t.slice(pos))
    if (!m) throw new Error(`無法剖析：${seg}（${t}，位置 ${pos}）`)
    pos += m[0].length
    return Number(m[0])
  }
  const v = expr()
  if (pos !== t.length) throw new Error(`無法剖析：${seg}（${t}，剩下 ${t.slice(pos)}）`)
  return v
}

/** 一個數字在畫面上寫到小數第幾位（a\times10^{b} 也算）；不是單一數字時回傳 null */
function shownDecimals(seg: string): number | null {
  const t = normTex(seg)
  let m = /^-?\d+(?:\.(\d+))?$/.exec(t)
  if (m) return m[1]?.length ?? 0
  m = /^-?\d+(?:\.(\d+))?\*10\^\((-?\d+)\)$/.exec(t)
  if (m) return (m[1]?.length ?? 0) - Number(m[2])
  m = /^-?10\^\((-?\d+)\)$/.exec(t)
  return m ? -Number(m[1]) : null
}

/**
 * 太長的步驟排成對齊的多行（`\begin{aligned}A&=B\\&=C\end{aligned}`，1280px 的欄位才放得下，不必橫向捲動）：
 * 去掉排版用的外殼（aligned、換行 `\\`、對齊點 `&`），剩下的就是同一串「A=B=C」。不是這種寫法的 TeX 原樣回傳。
 */
function unwrapAligned(tex: string): string {
  const m = /^\\begin\{aligned\}([\s\S]*)\\end\{aligned\}$/.exec(tex)
  return m ? m[1].replace(/\\\\(?:\[[^\]]*\])?/g, '').replace(/&/g, '') : tex
}

/**
 * 一步的 TeX「符號式 = 代入數字 =（中間結果 =）結果」：每一段數字用畫面上的數字重算，都要等於最後一段。
 * 多行（aligned）的步驟先用 unwrapAligned 還原成一行再檢查。
 * - 乘除、函數：容許 6 位有效數字的捨入（相對 3×10⁻⁵）；
 * - 純加減（只有十進位數與 + −）：運算元要寫到不比結果粗的小數位（否則畫面上的數字加不出結果的後幾位），
 *   而且相加後與結果的差不超過捨入（每個數各 ±0.5 個「結果最後一位」）；
 * - sin／cos 在特殊角的精確 0：角度只顯示 6 位，重算會得到 10⁻⁶ 左右，視為一致（why 會說明）。
 * 回傳這一步每個等式最後的數字。
 */
function checkStepTex(tex: string, label: string): number[] {
  const finals: number[] = []
  for (const eq of splitTop(unwrapAligned(tex), '\\qquad')) {
    const segs = splitTop(eq.replace(/,\s*$/, ''), '=')
    const nums = segs.map((x) => ({ seg: x, v: evalTex(x) })).filter((x): x is { seg: string; v: number } => x.v !== null)
    expect(nums.length, `${label}：要有「代入數字」與「結果」兩段以上的數字：${eq}`).toBeGreaterThanOrEqual(2)
    const last = nums[nums.length - 1]
    expect(evalTex(segs[segs.length - 1]), `${label}：最後一段必須是數字：${eq}`).not.toBeNull()
    const pRes = shownDecimals(last.seg)
    for (const { seg, v } of nums.slice(0, -1)) {
      const err = Math.abs(v - last.v)
      const t = normTex(seg)
      if (pRes !== null && /^[0-9.+\-()]+$/.test(t) && /\d[+-]/.test(t)) {
        const ops = (t.match(/\d+(?:\.\d+)?/g) ?? []).map((m) => (m.includes('.') ? m.split('.')[1].length : 0))
        expect(Math.max(...ops), `${label}：加減法的運算元寫得比結果粗：${eq}`).toBeGreaterThanOrEqual(Math.min(pRes, 12))
        expect(err, `${label}：加減法要對得起來：${eq}`).toBeLessThanOrEqual((0.5 * ops.length + 0.5) * 10 ** -pRes + 1e-15)
      } else {
        const trigZero = last.v === 0 && Math.abs(v) < 1e-5 && /\\sin|\\cos/.test(seg)
        if (!trigZero) expect(err, `${label}：${seg} = ${v}，但畫面寫 ${last.v}（${eq}）`).toBeLessThanOrEqual(3e-5 * Math.abs(last.v) + 1e-12)
      }
    }
    finals.push(last.v)
  }
  return finals
}

/** 一整題：每一步都通過 checkStepTex，而且每個答案都是某一步最後的數字（或輸入值本身） */
function expectStepsConsistent(def: HandCalcDef, v: Record<string, number>) {
  const label = `${def.id} ${JSON.stringify(v)}`
  expect(def.validate?.(v) ?? null, label).toBeNull()
  const sol = def.solve(v)
  const finals: number[] = []
  sol.steps.forEach((st, i) => finals.push(...checkStepTex(st.tex, `${label} 第 ${i + 1} 步`)))
  for (const res of sol.results) {
    const hit = [...finals, ...Object.values(v)].some((x) => Math.abs(x - res.value) <= 2e-5 * Math.abs(res.value) + 1e-9)
    expect(hit, `${label}：答案 ${res.symbol} = ${res.value} 要是某一步的結果`).toBe(true)
  }
}

/** 步驟、說明、結論與答案的 TeX 都能渲染（沒有 KaTeX 錯誤） */
function expectRenders(def: HandCalcDef, v: Record<string, number>) {
  expect(def.validate?.(v) ?? null, `${def.id} ${JSON.stringify(v)}`).toBeNull()
  const sol = def.solve(v)
  expect(sol.steps.length).toBeGreaterThan(0)
  for (const s of sol.steps) {
    expect(renderTex(s.tex, true), `${def.id}: ${s.tex}`).not.toMatch(/katex-error|c-tex-error/)
    expect(s.tex, def.id).not.toMatch(/NaN|undefined|Infinity/)
    expect(s.tex.split('=').length, `${def.id}: 每一步都是「符號式 = 代入 = 結果」`).toBeGreaterThanOrEqual(3)
  }
  for (const x of sol.results) {
    expect(Number.isFinite(x.value), `${def.id} ${x.symbol}`).toBe(true)
    expect(renderTex(`\\boxed{${x.symbol} = 1${x.unit ? `\\ ${x.unit}` : ''}}`, true), `${def.id}: ${x.symbol}`).not.toMatch(/katex-error|c-tex-error/)
  }
  const strings = [...sol.steps.map((s) => s.why), ...(sol.notes ?? []), ...sol.results.map((x) => x.label ?? '')]
  for (const t of strings) expect(t, def.id).not.toMatch(/NaN|undefined|Infinity/)
  const { container, unmount } = render(
    <div>
      {strings.map((t, i) => (
        <p key={i}>
          <MathText>{t}</MathText>
        </p>
      ))}
    </div>,
  )
  expect(container.querySelectorAll('.katex-error, .c-tex-error').length, def.id).toBe(0)
  unmount()
}

/**
 * 各題的分支與邊界情況（渲染測試與「畫面上的數字重算」測試共用）：反號／不反號、d > 1、near-grid、帶外、
 * 特殊角（f = f_ref/2）、接近帶緣（兩個接近的數相減）、很小的數（科學記號）、使用者自己打的長小數。
 */
const EXTRA: Record<string, Record<string, number>[]> = {
  'HC-CS.1': [{ g: 1 }, { g: 0.5, w0: 0.9, mu: 0.25 }, { a: -1, x: -1, g: -1 }, { w0: 1 }, { a: 0.3, g: 1 }, { a: 0.7, w0: 0.4, g: 0.3 }, { a: 1, w0: 0.9, mu: 0.25, x: 2, g: 1 }, { a: 1e-5, mu: 1e-6, g: 1 }],
  'HC-CS.2': [{ f: 5 }, { f: 130 }, { Ki: 0.08, Kp: 0.5, f: 40 }, { f: 0.05 }, { f: 17.3, fref: 3840, Ki: 0.0123, Kp: 0.777 }],
  'HC-CS.3': [
    { K: 0.244662, d: 5 },
    { K: 0.4, d: 3 },
    { K: 0.5, d: 3, f: 100 },
    { K: 1.5, f: 2000 },
    { K: 0.3, d: 3, f: 2000 },
    { K: 0.4, d: 2, f: 1600 },
    { K: 0.5, d: 2, f: 1000, fref: 6000 },
    { K: 0.5, d: 2, f: 2000, fref: 6000 },
    { K: 0.39999, d: 3 },
    { K: 1.9, f: 1500 },
    { K: 0.00005, f: 0.05 },
    { f: 0.05 },
    { K: 1.999, f: 1999 },
    { K: 0.123456, d: 8, f: 77.7, fref: 5000 },
  ],
  'HC-CS.4': [{ Kp: 0.5, Ki: 0.08 }, { Kp: 1.5, Ki: 0.9 }, { fref: 2000 }, { Kp: 0.3, Ki: 0.00001 }, { Kp: 1.9, Ki: 0.19 }],
  'HC-CS.5': [
    { f: 84 },
    { f: 320 },
    { f: 2000 },
    { f: 1000 },
    { f: 1 },
    { Kp: 0.4, Ki: 0.02, f: 160 },
    { Kp: 0.4, Ki: 0.02, f: 100 },
    { f: 134.82 },
    { f: 134.825 },
    { f: 134.82009642754227 },
    { f: 0.05 },
    { f: 1999 },
    { fref: 6000, f: 1000, Kp: 1, Ki: 0.5 },
    { f: 1333.33, fref: 3999.99, Kp: 1.234, Ki: 0.777 },
  ],
  'HC-CS.6': [{ Kp: 0.1, Ki: 0.5 }, { Kp: 1.5, Ki: 0.8 }, { Kp: 1, Ki: 0.2 }, { Kp: 0.3, Ki: 0.6 }, { Kp: 0.25, Ki: 0.4999 }, { Kp: 0.28771696, Ki: 0.575433921 }, { Kp: 1.7, Ki: 0.5999 }],
  'HC-CS.7': [{ uos: -25 }, { uos: 0 }, { rho: 0 }, { kG: 0.0803 }, { uos: 600 }, { uos: -40, sigma: 100 }, { uos: 0.01 }],
  'HC-CS.8': [
    { alpha: 0.137 },
    { alpha: 0.123 },
    { alpha: 0.25 },
    { alpha: 0.496 },
    { alpha: 0.98 },
    { alpha: 0.002 },
    { alpha: 0.033 },
    { Kp: 0.1, Ki: 0.5 },
    { alpha: 0.5 },
    { alpha: 0.1250001 },
    { alpha: 0.0337 },
    { alpha: 0.9999 },
    { alpha: 0.12499991 },
    { alpha: 0.1250000001 },
    { alpha: 0.7654321, fref: 3840.5, Kp: 0.777, Ki: 0.0123 },
    { Kp: 0.28771696, Ki: 0.575433921 },
  ],
}

describe('SSPLL 案例頁的帶入手算（HC-CS.1 – HC-CS.8）', () => {
  it('SSPLL: 題目清單——8 題、ID 連號、頁面 /case/sspll、公式 ID 已登錄、三種難度都有、預設值通過 validate', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-CS.1', 'HC-CS.2', 'HC-CS.3', 'HC-CS.4', 'HC-CS.5', 'HC-CS.6', 'HC-CS.7', 'HC-CS.8'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/case/sspll')
      if (h.formulaId) expect(formulaIds.has(h.formulaId), `${h.id} → ${h.formulaId}`).toBe(true)
      expect(renderTex(h.formulaTex, true), h.id).not.toMatch(/katex-error|c-tex-error/)
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      expect(h.inputs.some((i) => i.practice), `${h.id} 要能「換一題」`).toBe(true)
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(2)
      for (const i of h.inputs) {
        if (i.min !== undefined) expect(i.default).toBeGreaterThanOrEqual(i.min)
        if (i.max !== undefined) expect(i.default).toBeLessThanOrEqual(i.max)
        for (const c of i.practice?.choices ?? []) {
          if (i.min !== undefined) expect(c, `${h.id}.${i.key}`).toBeGreaterThanOrEqual(i.min)
          if (i.max !== undefined) expect(c, `${h.id}.${i.key}`).toBeLessThanOrEqual(i.max)
        }
      }
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    expect(HANDCALCS.filter((h) => h.level === 'beginner').length).toBeGreaterThanOrEqual(2)
  })

  it('SSPLL: 預設值就是內文的數字——K = 0.388836、(K_p, K_i) = (0.287717, 0.0382535)（設計值取 8 位有效數字）、f_ref = 4000 MHz', () => {
    const L = nominalLoops()
    expect(HC_FREF_MHZ).toBe(4000)
    // 設計結果取 8 位有效數字
    expect(HC_NOMINAL.K).toBe(Number(Number(L.L1.params.K).toPrecision(8)))
    expect(HC_NOMINAL.K).toBe(Number(typeIKClosedForm().toPrecision(8)))
    expect(HC_NOMINAL.Kp).toBe(Number(Number(L.L2.params.Kp).toPrecision(8)))
    expect(HC_NOMINAL.Ki).toBe(Number(Number(L.L2.params.Ki).toPrecision(8)))
    // 內文印出的位數（§6：fx(K, 6)、fx(K_p, 6)、fx(K_i, 7)）
    expect(HC_NOMINAL.K.toFixed(6)).toBe('0.388836')
    expect(HC_NOMINAL.Kp.toFixed(6)).toBe('0.287717')
    expect(HC_NOMINAL.Ki.toFixed(7)).toBe('0.0382535')
    expect(defaultValues(hc('HC-CS.3'))).toMatchObject({ K: HC_NOMINAL.K, d: 1, f: 20, fref: 4000 })
    expect(defaultValues(hc('HC-CS.4'))).toMatchObject({ Kp: HC_NOMINAL.Kp, Ki: HC_NOMINAL.Ki, fref: 4000 })
    for (const id of ['HC-CS.2', 'HC-CS.5', 'HC-CS.6', 'HC-CS.8']) expect(defaultValues(hc(id))).toMatchObject({ Kp: HC_NOMINAL.Kp, Ki: HC_NOMINAL.Ki })
  })

  it('SSPLL: HC-CS.1 重現 §4.1 的表——情況 B（g = −0.2）w = 0, −0.1, …, −0.4；情況 A（g = +1）w = 0, 0.1, …, 0.4', () => {
    const def = hc('HC-CS.1')
    const B = values(def, defaultValues(def))
    close(B[0], WORKED['e_H=-0.2'][1], 0, 1e-12)
    close(B[1], WORKED['e_H=-0.2'][4], 0, 1e-12)
    close(B[2], 1 - WORKED['e_H=-0.2'][4], 0, 1e-12)
    const A = values(def, withDefaults(def, { g: 1 }))
    close(A[0], WORKED['e_H=+1'][1], 0, 1e-12)
    close(A[1], WORKED['e_H=+1'][4], 0, 1e-12)
    // 模型函式本身：逐步與 golden 的手算表相同；|g| 的大小不影響軌跡
    for (const [g, key] of [
      [1, 'e_H=+1'],
      [-0.2, 'e_H=-0.2'],
      [-5, 'e_H=-0.2'],
    ] as const) {
      let w = 0
      for (let i = 0; i < 4; i++) {
        close(w, WORKED[key][i], 0, 1e-12)
        w = toySignLmsStep(w, 1, 1, 0.1, g).w
      }
      close(w, WORKED[key][4], 0, 1e-12)
    }
    expect(toySignLmsStep(1, 1, 1, 0.1, 1)).toEqual({ e: 0, q: 1, w: 1.1 }) // e = 0 時取 +1
    // 四步各兩行（殘差、更新），最後一行把 δ₄ = a − w₄ 寫出來
    const steps = def.solve(defaultValues(def)).steps
    expect(steps.length).toBe(9)
    expect(steps[8].tex).toBe('\\delta_4=a-w_4=1-(-0.4)=1.4')
    // 使用者自己打的數字：0.1 + 0.1 + 0.1 在 double 裡是 0.30000000000000004。紙筆上 a − w₃ = 0.3 − 0.3 = 0 ⇒ q = +1 ⇒ w₄ = 0.4；
    // 不去掉殘渣的話 a − w₃ = −5.6e-17 ⇒ q = −1 ⇒ w₄ = 0.2，和手算相反
    expect(toySignLmsStep(0.1 + 0.1 + 0.1, 0.3, 1, 0.1, 1).q).toBe(-1)
    const v03 = withDefaults(def, { a: 0.3, g: 1 })
    const r03 = values(def, v03)
    expect(r03).toEqual([0.1, 0.4, -0.1])
    const s03 = def.solve(v03).steps
    expect(s03[6].tex).toBe('e_3=g\\,(a-w_3)\\,x=1\\times(0.3-0.3)\\times1=1\\times0\\times1=0')
    expect(s03[7].tex).toContain('\\times(+1)\\times1=0.3+0.1=0.4')
    expect(s03[7].why).toContain('$e_3=0$ 時取 $+1$')
    // 答案沒有 double 的尾巴（0.7000000000000002 之類）
    const tails: Record<string, number>[] = [{ a: 2, w0: 0.5, mu: 0.2, x: -1, g: 0.5 }, { a: 0.7, w0: 0.4, mu: 0.1, g: 0.3 }, { a: 1, w0: 0.9, mu: 0.25, x: 2, g: 1 }]
    for (const patch of tails)
      for (const x of values(def, withDefaults(def, patch))) expect(x).toBe(Number(x.toPrecision(12)))
  })

  it('SSPLL: HC-CS.2 重現 §5.2 的 20 MHz 例——−Ω²/K_i = −0.02580，精確值 −0.02493（loopH）', () => {
    const def = hc('HC-CS.2')
    const v = defaultValues(def)
    const [W, approx, approxSin] = values(def, v)
    close(W, (2 * Math.PI * 20) / 4000, 1e-14)
    close(approx, WORKED.f_minusW2_over_Ki, 2e-7)
    expect(approx.toFixed(5)).toBe(WORKED.f_minusW2_over_Ki.toFixed(5)) // 內文印 −0.02580
    close(approxSin, 1 / typeIIReL(0, v.Ki, 20 / 4000), 1e-12)
    expect(Math.abs(approxSin)).toBeLessThan(Math.abs(approx)) // sin x < x
    const exact = loopH(makeL2({ Kp: v.Kp, Ki: v.Ki }), 20 / 4000).re
    close(exact, WORKED.f_ReH_L2_20MHz, 2e-7)
    expect(exact.toFixed(5)).toBe(WORKED.f_ReH_L2_20MHz.toFixed(5)) // 內文印 −0.02493
    expect(def.solve(v).notes?.join(' ')).toContain('-0.0249263')
    expect(def.solve(v).notes?.join(' ')).toContain('高估了 $3.51\\%$')
    expect((approx - exact) / Math.abs(exact)).toBeLessThan(0) // 近似比精確值更負（高估）
    expect(Math.abs(approx - exact) / Math.abs(exact)).toBeLessThan(0.04)
  })

  it('SSPLL: HC-CS.3 重現 L1——判據 K/2 = 0.1944 < 1、低頻近似 0.005259、精確 Re H(20 MHz) = 0.005237（= F-CS.7）；d = 5 時判據 1.101 > 1、低頻反號', () => {
    const def = hc('HC-CS.3')
    const v = defaultValues(def)
    const [crit, approx, exact] = values(def, v)
    expect(crit).toBe(typeILatencyCriterion(v.K, v.d))
    close(crit, PARAMS.typeI_criteria.lat1.criterion, 2e-7)
    close(approx, WORKED.f_typeI_lowf, 2e-7)
    close(exact, WORKED.f_ReH_L1_20MHz, 2e-7)
    expect(approx.toFixed(6)).toBe(WORKED.f_typeI_lowf.toFixed(6)) // 內文印 +0.005259
    expect(exact.toFixed(6)).toBe(WORKED.f_ReH_L1_20MHz.toFixed(6)) // 內文印 +0.005237
    close(exact, typeIReH(v.K, 20 / 4000), 1e-12)
    expect(exact).toBe(loopH(makeL1({ K: v.K, lat: 1 }), 20 / 4000).re)
    // d = 1 時多三步 F-CS.7 的驗算（分子、分母、相除），最後一步的結果與「實部、虛部分開算」的第 13 步相同
    const steps1 = def.solve(v).steps
    expect(steps1.length).toBe(16)
    const lastNum = (tex: string) => tex.slice(tex.lastIndexOf('=') + 1)
    expect(lastNum(steps1[15].tex)).toBe(lastNum(steps1[12].tex))
    expect(lastNum(steps1[15].tex)).toBe(String(Number(exact.toPrecision(6))))
    expect(steps1[15].why).toContain('第 13 步')
    expect(def.level).toBe('research') // 實部、虛部分開算（複數運算），不是「只要計算機」
    // 驗算步的分子、分母：(2 − K)(1 − cos Ω) 與 |1 − (1 − K)e^{−jΩ}|²（直接用 cos 重算）
    const W20 = (2 * Math.PI * 20) / 4000
    const num1 = (2 - v.K) * (1 - Math.cos(W20))
    const den1 = (1 - (1 - v.K) * Math.cos(W20)) ** 2 + ((1 - v.K) * Math.sin(W20)) ** 2
    close(num1 / den1, exact, 1e-10)
    expect(steps1[13].tex).toContain(String(Number(num1.toPrecision(6))))
    expect(steps1[14].tex).toContain(String(Number(den1.toPrecision(6))))
    // §6.1 表格的 d = 5 那一列（重新調到 320 MHz 的 K）
    const g5 = PARAMS.typeI_criteria.lat5
    const v5 = withDefaults(def, { K: Number(g5.K.toFixed(6)), d: 5 })
    expect(def.validate?.(v5)).toBeNull()
    const [c5, a5, e5] = values(def, v5)
    close(c5, g5.criterion, 2e-6)
    expect(c5).toBeGreaterThan(1)
    expect(a5).toBeLessThan(0)
    expect(e5).toBeLessThan(0)
    expect(e5).toBe(loopH(makeL1({ K: v5.K, lat: 5 }), 20 / 4000).re)
    expect(def.solve(v5).steps.length).toBe(13)
    expect(def.solve(v5).notes?.[0]).toContain('不是天生免疫')
    // f = f_ref/2、d = 1：θ = π/2，cos θ 的精確值是 0（不是 double 的 6.1e-17），Im L = 0，Re H = 1/(1 − K/2)
    const sPi = def.solve(withDefaults(def, { K: 1.5, f: 2000 }))
    expect(sPi.steps[7].tex).toBe('\\cos\\theta=\\cos(1.5708)=0')
    expect(sPi.steps[7].why).toContain('精確值是 0')
    expect(lastNum(sPi.steps[9].tex)).toBe('0')
    close(sPi.results[2].value, 1 / (1 - 1.5 / 2), 1e-12)
    // K > 1 時 1 − K < 0：分母那一步的負數有括號（不會出現「+-」）
    expect(sPi.steps[14].tex).toContain('=2.25+(-2)=0.25')
    expect(def.solve(withDefaults(def, { K: 1.9, f: 1500 })).steps[14].tex).toContain('=3.61+(-3.072792)=0.537208')
    expect(sPi.steps.map((x) => x.tex).join(' ')).not.toMatch(/\+-|\\times-/)
    // 判據接近 1：1 + Re L 是兩個接近的數相減，Re L 會多寫幾位，畫面上的減法才對得起來
    const sNear = def.solve(withDefaults(def, { K: 0.39999, d: 3 }))
    expect(sNear.steps[10].tex).toBe('1+\\mathrm{Re}\\,L=1+(-0.99898834)=0.00101166')
    expect(sNear.steps[10].why).toContain('多寫了幾位')
    expect(def.solve(v).steps[10].why).not.toContain('多寫了幾位')
    // 步驟裡的 Re L、Im L 就是 loopL
    const L = loopL(makeL1({ K: v5.K, lat: 5 }), 20 / 4000)
    const Li = typeIL(v5.K, 5, (2 * Math.PI * 20) / 4000)
    close(L.re, Li[0], 1e-10)
    close(L.im, Li[1], 1e-10)
  })

  it('SSPLL: HC-CS.4 重現 §6.2 的手算——0.0111703 → 0.105690 → 0.105887 → f_inv = 134.82 MHz', () => {
    const def = hc('HC-CS.4')
    const v = defaultValues(def)
    const [ratio, finv] = values(def, v)
    close(ratio, WORKED.b_ratio, 2e-7)
    expect(finv).toBe(typeIIFinv(v.Kp, v.Ki) * 4000)
    close(finv, WORKED.b_f_inv_MHz, 2e-7)
    expect(finv.toFixed(3)).toBe(WORKED.b_f_inv_MHz.toFixed(3)) // 內文印 134.820
    expect(ratio.toFixed(7)).toBe(WORKED.b_ratio.toFixed(7))
    close(finv, PARAMS.loops.L2.ReH_neg_bands_MHz[0][1], 0, 1e-3)
    expect(finv.toFixed(2)).toBe('134.82')
    const texts = def.solve(v).steps.map((s) => s.tex).join('\n')
    expect(texts).toContain('0.0111703')
    expect(texts).toContain('0.10569')
    expect(texts).toContain('0.105887')
    expect(texts).toContain('134.82')
    // 驗算步：帶緣上 Re L = −1
    close(typeIIReL(v.Kp, v.Ki, typeIIFinv(v.Kp, v.Ki)), -1, 1e-12)
    // 思考題 1：K_i 加倍
    const [, f2] = values(def, withDefaults(def, { Ki: 2 * v.Ki }))
    close(f2, finvIndep(v.Kp, 2 * v.Ki, 4000), 1e-12)
    expect(f2 / finv).toBeGreaterThan(1.41)
    expect(f2 / finv).toBeLessThan(1.43)
  })

  it('SSPLL: HC-CS.5 重現 §6.2 的 83.8 MHz 例——Re L = −2.35476、|1 + L|² = 6.59912、Re H = −0.20529；單線近似 = W₁·Re H', () => {
    const def = hc('HC-CS.5')
    const v = defaultValues(def)
    const loop = makeL2({ Kp: v.Kp, Ki: v.Ki })
    const fn = 83.8 / 4000
    const [reL, den, h, k1] = values(def, v)
    close(reL, WORKED.a_ReL_closed, 2e-7)
    close(den, WORKED.a_abs_1plusL_sq, 2e-7)
    close(h, WORKED.a_ReH, 2e-7)
    // 與內文印出的位數逐位相同：−2.354764、6.59912、−0.20529
    expect(reL.toFixed(6)).toBe(WORKED.a_ReL_closed.toFixed(6))
    expect(den.toFixed(5)).toBe(WORKED.a_abs_1plusL_sq.toFixed(5))
    expect(h.toFixed(5)).toBe(WORKED.a_ReH.toFixed(5))
    expect(h).toBe(loopH(loop, fn).re)
    expect(k1).toBe(singleLinePhos(fn, gammaEff(loop)))
    close(k1, W1 * h, 1e-14)
    const texts = def.solve(v).steps.map((s) => s.tex).join('\n')
    expect(texts).toContain(String(Number(WORKED.a_Omega.toPrecision(6)))) // Ω = 0.131633
    expect(texts).toContain('0.00432554') // sin²(Ω/2)
    expect(texts).toContain('-2.1826') // Im L
    close(loopL(loop, fn).im, WORKED.a_L_complex[1], 2e-7)
    // α·f_ref = 84 MHz（§8.1 的例子）：W₁·Re H = −0.19495，完整諧波和 −0.1395
    const sol84 = def.solve(withDefaults(def, { f: 84 }))
    close(sol84.results[2].value, WORKED.c_ReH_84MHz, 2e-7)
    close(sol84.results[3].value, WORKED.c_W1_ReH, 2e-7)
    expect(sol84.notes?.join(' ')).toContain('-0.13953')
    // κ₁ 是複數（F-CS.13）：單線近似與完整的諧波和比的都是實部，式子寫成 Re κ₁（不是 κ₁ ≈ 實數）
    const steps = def.solve(v).steps
    const last = steps[steps.length - 1].tex
    expect(last.startsWith(String.raw`\mathrm{Re}\,\kappa_1\approx W_1\,\mathrm{Re}\,H_{PD}=`)).toBe(true)
    expect(last.endsWith('=-0.194956')).toBe(true)
    expect(def.formulaTex).toContain(String.raw`\mathrm{Re}\,\kappa_1\approx W_1`)
    expect(def.formulaTex).not.toMatch(/(?<!\\mathrm\{Re\}\\,)\\kappa_1\\approx/)
    expect(def.solve(v).results[3].label).toContain(String.raw`$\mathrm{Re}\,\kappa_1$`)
    expect(def.solve(v).notes?.join(' ')).toContain(String.raw`\mathrm{Re}\,\kappa_1=-0.13961`) // 83.8 MHz
    expect(sol84.notes?.join(' ')).toContain(String.raw`\mathrm{Re}\,\kappa_1=-0.13953`) // 84 MHz
    close(analyseAlpha(loop, fn).kappaM[0].re, -0.13961, 0, 6e-6)
    close(analyseAlpha(loop, fn).kappaM[0].im, 0.30988, 0, 6e-6) // 虛部不小：只有實部能和單線近似比
    // f/f_ref 在 ¼、½ 附近：多一條 alias 的提醒（單線近似看不到 mode-2／mode-4 折回帶內）；其他頻率沒有
    expect(def.solve(v).notes?.length).toBe(3)
    for (const f of [1000, 2000, 1950]) {
      const notes = def.solve(withDefaults(def, { f })).notes ?? []
      expect(notes.length, `f = ${f}`).toBe(4)
      expect(notes[3]).toContain('alias dead zone')
    }
    expect(def.solve(withDefaults(def, { f: 548 })).notes?.length).toBe(3)
    // 帶緣上 Re H = 0；帶外為正
    const edge = typeIIFinv(v.Kp, v.Ki) * 4000
    expect(Math.abs(values(def, withDefaults(def, { f: edge }))[2])).toBeLessThan(1e-12)
    expect(values(def, withDefaults(def, { f: 320 }))[2]).toBeGreaterThan(0)
  })

  it('SSPLL: HC-CS.6 重現 §11.1——g(0) = K_p − K_i/2 = 0.26859、g(π) = 1.69316，與 oneDiffMargin 的掃描一致；K_i > 2K_p 時 margin 為負', () => {
    const def = hc('HC-CS.6')
    const v = defaultValues(def)
    const [g0, gPi, gMin] = values(def, v)
    const T = PARAMS.remedy_kernels.typeII_closed
    close(g0, T.Kp_minus_Ki_over_2, 2e-7)
    close(gPi, 2 - T.Kp_plus_Ki_over_2, 2e-7)
    expect(gMin).toBe(g0)
    close(gMin, oneDiffMargin(makeL2({ Kp: v.Kp, Ki: v.Ki })).min, 0, 1e-6)
    close(gMin, oneDiffMargin(nominalLoops().L2).min, 0, 1e-6)
    // closed form g(Ω) = 1 − cos Ω + Re{(1 − e^{−jΩ})L}（oneDiffMargin 掃描的那個量）
    for (const [Kp, Ki] of [
      [v.Kp, v.Ki],
      [0.1, 0.5],
      [1.5, 0.8],
    ]) {
      for (const f of [0.001, 0.02, 0.137, 0.25, 0.4, 0.5]) {
        const W = 2 * Math.PI * f
        const L = typeIIL(Kp, Ki, W)
        close(typeIIOneDiffG(Kp, Ki, f), 1 - Math.cos(W) + (1 - Math.cos(W)) * L[0] - Math.sin(W) * L[1], 1e-9, 1e-12)
      }
      close(Math.min(typeIIOneDiffG(Kp, Ki, 0), typeIIOneDiffG(Kp, Ki, 0.5)), oneDiffMargin(makeL2({ Kp, Ki })).min, 0, 1e-6)
    }
    // 穩定但 K_i > 2K_p：一階差分不保證安全
    const bad = withDefaults(def, { Kp: 0.1, Ki: 0.5 })
    expect(def.validate?.(bad)).toBeNull()
    expect(values(def, bad)[2]).toBeCloseTo(-0.15, 12)
    expect(def.solve(bad).notes?.[0]).toContain('也可能反號')
    // K_p > 1：最小值在 Ω = π
    const hi = values(def, withDefaults(def, { Kp: 1.5, Ki: 0.8 }))
    expect(hi[2]).toBe(hi[1])
    expect(hi[2]).toBeCloseTo(0.1, 12)
  })

  it('SSPLL: HC-CS.7 重現 §13——u_os = 25 fs、σ_v = 200 fs ⇒ E[q] = 0.0995、K_q0 = 0.003989 fs⁻¹、L2 α = 0.137 的 raw GOS 偏差 −145.8 fs', () => {
    const def = hc('HC-CS.7')
    const v = defaultValues(def)
    const g = PARAMS.offset.points['L2|137/1000|u=25'] as { twelveC: number; rho_mean: number; Eq: number; Kq_ratio: number; gos_bias_raw_fs: number }
    const [Eq, KqU, bias] = values(def, v)
    expect(Eq).toBe(eqOffset(25, 200))
    close(Eq, g.Eq, 1e-10)
    expect(KqU).toBe(kqOffset(25, 200))
    close(KqU / kqGain(200), g.Kq_ratio, 1e-10)
    close(kqGain(200), WORKED.g_Kq_per_fs, 1e-10)
    expect(v.rho).toBe(g.rho_mean)
    close(v.kG, g.twelveC, 2e-5) // 內文顯示 1.0259
    expect(bias).toBe(gosOffsetBias(v.kG / 12, v.rho, 25, 200))
    close(bias, g.gos_bias_raw_fs, 2e-5)
    expect(bias.toFixed(1)).toBe('-145.8')
    // 用未捨入的 12C 就是 golden 的值
    close(values(def, withDefaults(def, { kG: g.twelveC }))[2], g.gos_bias_raw_fs, 1e-9)
    // near-grid（α = 0.123）：12C = 0.0803 ⇒ 約 −1.86 ps
    const ng = PARAMS.offset.points['L2|123/1000|u=25'] as { twelveC: number; gos_bias_raw_fs: number }
    close(values(def, withDefaults(def, { kG: ng.twelveC }))[2], ng.gos_bias_raw_fs, 1e-9)
    expect(def.tips?.join(' ')).toContain('-1860')
    // zero-mean regressor：偏差為 0
    expect(values(def, withDefaults(def, { rho: 0 }))[2]).toBeCloseTo(0, 15)
    // 步驟中的手算近似：erf(z) ≈ (2/√π)(z − z³/3) 在 |z| ≤ 0.3 時相對誤差 < 0.1%；e^{−x} ≈ 1 − x 在 x ≤ 0.05 時 < 0.13%
    for (const z of [0.05, 0.0883883, 0.2, 0.3]) expect(Math.abs((2 / Math.sqrt(Math.PI)) * (z - z ** 3 / 3) - erfSeries(z)) / erfSeries(z)).toBeLessThan(1e-3)
    for (const x of [0.0078125, 0.02, 0.05]) expect(Math.abs(1 - x - Math.exp(-x)) / Math.exp(-x)).toBeLessThan(1.3e-3)
    // tips：erf(z) ≈ 1.12838 z 在 |z| ≤ 0.1 時誤差 < 0.4%
    for (const z of [0.02, 0.05, 0.1]) expect(Math.abs(1.12838 * z - erfSeries(z)) / erfSeries(z)).toBeLessThan(4e-3)
    close(erfSeries(25 / (Math.SQRT2 * 200)), eqOffset(25, 200), 1e-12) // sspll.ts 用 core/special 的 erf（W. J. Cody 的有理逼近，double 精度）
  })

  it('SSPLL: HC-CS.8（綜合）重現 §8.1 的頻道——α = 0.021：f_rot = 84 MHz、β = 0.168、f_inv = 134.82 MHz、在帶內、1diff margin 0.2686；α = 0.137 在帶外、α = 0.123 是 near-grid', () => {
    const def = hc('HC-CS.8')
    const v = defaultValues(def)
    const loop = makeL2({ Kp: v.Kp, Ki: v.Ki })
    const [fRot, beta, finv, dF, gMin] = values(def, v)
    close(fRot, 84, 1e-12)
    close(beta, 0.168, 1e-12)
    expect(beta).toBe(analyseAlpha(loop, 0.021).beta)
    expect(finv).toBe(values(hc('HC-CS.4'), defaultValues(hc('HC-CS.4')))[1])
    close(dF, 84 - finv, 1e-12)
    expect(dF).toBeLessThan(0)
    expect(gMin).toBe(values(hc('HC-CS.6'), defaultValues(hc('HC-CS.6')))[2])
    // 結論引用的是 sspll.ts 的判斷：Re H(84 MHz)、單線近似、嚴格界限（上界 < 0 ⇒ 一定反號）
    const notes = def.solve(v).notes ?? []
    const b = phosM1Bounds(loop, 0.021)
    expect(b.upper).toBeLessThan(0)
    close(loopH(loop, 0.021).re, WORKED.c_ReH_84MHz, 2e-7)
    close(singleLinePhos(0.021, gammaEff(loop)), WORKED.c_W1_ReH, 2e-7)
    close(b.upper, analyseAlpha(loop, 0.021).m1Upper, 1e-12)
    expect(notes[0]).toContain('一定反號')
    expect(notes[0]).toContain('-0.20529')
    expect(notes[0]).toContain('-0.19495')
    // 界限夾的是 Re κ₁（κ₁ 是複數，不能和實數比大小）
    expect(notes[0]).toContain(String.raw`$-0.2053\le\mathrm{Re}\,\kappa_1\le-0.1355$`)
    expect(notes[0]).toContain(String.raw`單線近似 $\mathrm{Re}\,\kappa_1\approx W_1\mathrm{Re}\,H_{PD}=`)
    // 帶緣對照：α = 0.03175（127 MHz，在帶內）的界限 [−0.0598, 0.0100] 跨過 0——很小的是 Re κ₁，|κ₁| 其實是 0.65
    const edge = def.solve(withDefaults(def, { alpha: 0.03175 })).notes ?? []
    const bEdge = phosM1Bounds(loop, 0.03175)
    close(bEdge.lower, -0.0598, 0, 6e-5)
    close(bEdge.upper, 0.01, 0, 6e-5)
    expect(edge[0]).toContain('界限跨過 0')
    expect(edge[0]).toContain(String.raw`\lvert\mathrm{Re}\,\kappa_1\rvert`)
    expect(edge[0]).not.toContain(String.raw`\lvert\kappa_1\rvert`)
    const kEdge = analyseAlpha(loop, 0.03175).kappaM[0]
    expect(Math.abs(kEdge.re)).toBeLessThan(0.01)
    expect(Math.hypot(kEdge.re, kEdge.im)).toBeGreaterThan(0.6)
    expect(notes[1]).toContain('672')
    expect(notes[notes.length - 1]).toContain('任何 $\\alpha$ 都安全')
    // α = 0.137（§7.1 的例子）：548 MHz 在帶外、β = 0.096
    const sol137 = def.solve(withDefaults(def, { alpha: 0.137 }))
    close(sol137.results[0].value, 548, 1e-12)
    close(sol137.results[1].value, WORKED.d_beta, 1e-12)
    expect(sol137.results[3].value).toBeGreaterThan(0)
    expect(sol137.notes?.[0]).toContain('不可能反號')
    // α = 0.123（near-grid，β = 0.984）：12C ≈ 12(1 − β)²/K_i ≈ 0.0803（§13 的數字）
    const sol123 = def.solve(withDefaults(def, { alpha: 0.123 }))
    close(sol123.results[1].value, 0.984, 1e-9)
    expect(sol123.notes?.[1]).toContain('near-grid')
    expect(sol123.notes?.[1]).toContain('0.0803')
    // α > ½ 會折回；α = k/8 時 GOS 不可觀測；α ≈ ¼ 的 alias 提醒
    close(values(def, withDefaults(def, { alpha: 0.98 }))[0], 80, 1e-9)
    const sol25 = def.solve(withDefaults(def, { alpha: 0.25 }))
    expect(sol25.results[1].value).toBe(0)
    expect(sol25.notes?.join(' ')).toContain('不可觀測')
    expect(sol25.notes?.join(' ')).toContain('dead zone')
    // 模型的小工具
    expect(foldFreq(0.021)).toBe(0.021)
    close(foldFreq(0.98), 0.02, 1e-12)
    close(foldFreq(1.25), 0.25, 1e-12)
    expect(foldFreq(0.5)).toBe(0.5)
    expect(gosBeta(0.125)).toBe(0)
    expect(gosBeta(0.137)).toBe(WORKED.d_beta)
    for (const a of [0.002, 0.02, 0.123, 0.253, 0.496]) expect(gosBeta(a)).toBe(analyseAlpha(loop, a).beta)
  })

  it('SSPLL: 步驟與提示裡的手算近似——sin、cos、arcsin 的誤差界限成立（不必按計算機的替代算法）', () => {
    // HC-CS.2／3：sin x ≈ x − x³/6，|x| ≤ 0.2 時誤差 < 3×10⁻⁶；cos x ≈ 1 − x²/2，|x| ≤ 0.2 時誤差 < 7×10⁻⁵
    for (const x of [0.0157, 0.05, 0.1, 0.2]) {
      expect(Math.abs(x - x ** 3 / 6 - Math.sin(x))).toBeLessThan(3e-6)
      expect(Math.abs(1 - x ** 2 / 2 - Math.cos(x))).toBeLessThan(7e-5)
    }
    // HC-CS.4／8：arcsin x ≈ x + x³/6，x ≤ 0.3 時誤差 < 2×10⁻⁴
    for (const x of [0.05, 0.10569, 0.2, 0.3]) expect(Math.abs(x + x ** 3 / 6 - Math.asin(x))).toBeLessThan(2e-4)
    // HC-CS.4 的結論：不按 arcsin（arcsin x ≈ x）在根號內的值 ≤ 0.09 時誤差 < 1.6%
    for (const x2 of [0.0111703, 0.04, 0.09]) expect(Math.abs(Math.sqrt(x2) - Math.asin(Math.sqrt(x2))) / Math.asin(Math.sqrt(x2))).toBeLessThan(0.016)
    // 預設題目真的落在這些範圍內（所以提示的近似可以直接用）
    const v4 = defaultValues(hc('HC-CS.4'))
    expect(Math.sqrt(v4.Ki / (2 * (2 - v4.Kp)))).toBeLessThan(0.3)
    const v2 = defaultValues(hc('HC-CS.2'))
    expect((Math.PI * v2.f) / v2.fref).toBeLessThan(0.2)
    // 用近似式手算 HC-CS.4 的 f_inv：與答案的差在「對答案」的容許誤差（1%）內
    const root = Math.sqrt(v4.Ki / (2 * (2 - v4.Kp)))
    const byHand = (v4.fref / Math.PI) * (root + root ** 3 / 6)
    const [, finv] = values(hc('HC-CS.4'), v4)
    expect(Math.abs(byHand - finv) / finv).toBeLessThan(1e-4)
  })

  it('SSPLL: 換一題——每一題 20 個 seed 的答案都是有限值，並與測試內的獨立重算一致；同一 seed 可重現', () => {
    for (const def of HANDCALCS) {
      expect(INDEP[def.id], def.id).toBeTypeOf('function')
      const want0 = INDEP[def.id](defaultValues(def))
      const got0 = values(def, defaultValues(def))
      expect(got0.length, def.id).toBe(want0.length)
      got0.forEach((g, i) => close(g, want0[i], 1e-7, 1e-9, `${def.id} 預設值 result ${i}`))
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(def, seed)
        expect(randomValues(def, seed)).toEqual(v)
        expect(def.validate?.(v) ?? null, `${def.id} seed ${seed}`).toBeNull()
        const got = values(def, v)
        const want = INDEP[def.id](v)
        expect(got.length).toBe(want.length)
        // 相同算式的不同寫法（HC-CS.7 的 erf：測試用 Maclaurin 級數，sspll.ts 用 core/special 的 Cody 有理逼近，兩者都是 double 精度）
        got.forEach((g, i) => close(g, want[i], 1e-9, 1e-12, `${def.id} seed ${seed} ${JSON.stringify(v)} result ${i}`))
        seen.add(JSON.stringify(v))
      }
      expect(seen.size, `${def.id} 的隨機題目要有變化`).toBeGreaterThanOrEqual(5)
    }
  })

  it('SSPLL: validate 擋掉模型不適用的輸入，並說明原因（訊息可渲染）', () => {
    const INVALID: Record<string, [Record<string, number>, RegExp][]> = {
      'HC-CS.1': [
        [{ x: 0 }, /不可觀測/],
        [{ g: 0 }, /dead zone/],
        [{ mu: 0 }, /步長/],
      ],
      'HC-CS.2': [
        [{ f: 0 }, /必須大於 0/],
        [{ f: 2500 }, /f_\{ref\}\/2/],
        [{ f: 134.9 }, /超過反號帶上緣/],
        [{ f: 0.03 }, /太低/],
        [{ f: 500 }, /超過反號帶上緣/],
        [{ Ki: 0 }, /不是 Type-II/],
        [{ Kp: 0 }, /比例路徑/],
        [{ Kp: 1.9, Ki: 0.4 }, /主迴路不穩定/],
      ],
      'HC-CS.3': [
        [{ K: 0 }, /必須大於 0/],
        [{ K: 1.2, d: 2 }, /主迴路不穩定/],
        [{ K: 0.5, d: 4 }, /主迴路不穩定/],
        [{ f: 0 }, /必須大於 0/],
        [{ f: 2001 }, /f_\{ref\}\/2/],
        [{ f: 0.001 }, /太低/],
      ],
      'HC-CS.4': [
        [{ Kp: 0 }, /比例路徑/],
        [{ Ki: 0 }, /不是 Type-II/],
        [{ Kp: 2 }, /主迴路不穩定/],
        [{ Kp: 1.5, Ki: 1.2 }, /主迴路不穩定/],
      ],
      'HC-CS.5': [
        [{ f: 0 }, /必須大於 0/],
        [{ f: 2000.5 }, /f_\{ref\}\/2/],
        [{ f: 0.0005 }, /太低/],
        [{ Ki: 0 }, /不是 Type-II/],
        [{ Kp: 1.5, Ki: 1.2 }, /主迴路不穩定/],
      ],
      'HC-CS.6': [
        [{ Kp: 0 }, /比例路徑/],
        [{ Ki: 0 }, /不是 Type-II/],
        [{ Kp: 1.5, Ki: 1.2 }, /主迴路不穩定/],
      ],
      'HC-CS.7': [
        [{ sigma: 0 }, /Bussgang/],
        [{ kG: 0 }, /沒有恢復力/],
        [{ kG: -0.5 }, /沒有恢復力/],
        [{ uos: 700 }, /飽和/],
        [{ uos: -601 }, /飽和/],
      ],
      'HC-CS.8': [
        [{ alpha: 0 }, /整數頻道/],
        [{ alpha: 1 }, /0<\\alpha<1/],
        [{ Ki: 0 }, /不是 Type-II/],
        [{ Kp: 1.5, Ki: 1.2 }, /主迴路不穩定/],
      ],
    }
    for (const def of HANDCALCS) {
      expect(INVALID[def.id]?.length, def.id).toBeGreaterThanOrEqual(3)
      for (const [patch, re] of INVALID[def.id]) {
        const msg = def.validate?.(withDefaults(def, patch))
        expect(msg, `${def.id} ${JSON.stringify(patch)}`).toMatch(re)
        const { container, unmount } = render(<MathText>{msg}</MathText>)
        expect(container.querySelectorAll('.katex-error, .c-tex-error').length, `${def.id} ${JSON.stringify(patch)}`).toBe(0)
        unmount()
      }
    }
    // 判斷用的是模型自己的穩定性函式：邊界兩側
    expect(loopStable(makeL2({ Kp: 1.5, Ki: 0.99 }))).toBe(true)
    expect(loopStable(makeL2({ Kp: 1.5, Ki: 1.01 }))).toBe(false)
    expect(hc('HC-CS.4').validate?.({ Kp: 1.5, Ki: 0.99, fref: 4000 })).toBeNull()
    for (const d of [1, 2, 3, 4, 5]) {
      const kMax = 2 * Math.sin(Math.PI / (2 * (2 * d - 1)))
      expect(hc('HC-CS.3').validate?.({ K: 0.999 * kMax, d, f: 20, fref: 4000 }), `d = ${d}`).toBeNull()
      expect(hc('HC-CS.3').validate?.({ K: 1.001 * kMax, d, f: 20, fref: 4000 }), `d = ${d}`).toMatch(/主迴路不穩定/)
    }
    // 合法的邊界仍可計算
    expect(hc('HC-CS.2').validate?.(withDefaults(hc('HC-CS.2'), { f: 134 }))).toBeNull()
    expect(hc('HC-CS.5').validate?.(withDefaults(hc('HC-CS.5'), { f: 2000 }))).toBeNull()
    expect(hc('HC-CS.7').validate?.(withDefaults(hc('HC-CS.7'), { uos: 0 }))).toBeNull()
    expect(hc('HC-CS.7').validate?.(withDefaults(hc('HC-CS.7'), { uos: 600 }))).toBeNull()
  })

  it('SSPLL: 每一題的 <HandCalc> 都能渲染——至少一步、沒有 KaTeX 錯誤；換一題後看詳解也一樣', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} />)
      expect(container.querySelector(`#handcalc-${def.id.replace('.', '\\.')}`), def.id).not.toBeNull()
      expect(container.querySelectorAll('.c-step').length, def.id).toBe(sol.steps.length)
      expect(sol.steps.length, def.id).toBeGreaterThanOrEqual(4)
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length, def.id).toBe(0)
      expect(container.querySelectorAll('.c-handcalc-tips li').length, def.id).toBe(def.tips?.length ?? 0)
      const text = (() => {
        const clone = container.cloneNode(true) as HTMLElement
        clone.querySelectorAll('annotation').forEach((el) => el.remove())
        return clone.textContent ?? ''
      })()
      expect(text, def.id).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
      // 換一題（隨機數字）→ 練習模式 → 看詳解
      for (let k = 0; k < 4; k++) {
        fireEvent.click(screen.getByText('換一題（隨機數字）'))
        expect(container.querySelectorAll('.c-step').length, def.id).toBe(0)
        expect(screen.getAllByPlaceholderText('你的答案').length, def.id).toBe(sol.results.length)
        fireEvent.click(screen.getByText('看詳解'))
        expect(container.querySelectorAll('.c-step').length, `${def.id} 第 ${k + 1} 題`).toBeGreaterThanOrEqual(4)
        expect(container.querySelectorAll('.katex-error, .c-tex-error').length, `${def.id} 第 ${k + 1} 題`).toBe(0)
        expect(container.querySelector('.callout-warn'), `${def.id} 第 ${k + 1} 題`).toBeNull()
      }
      unmount()
    }
  }, 120000)

  it('SSPLL: TeX 重算工具本身——運算優先順序、省略的乘號、科學記號、函數；含符號的片段回傳 null', () => {
    close(evalTex('\\frac{2\\pi\\times20}{4000}') ?? NaN, (2 * Math.PI * 20) / 4000, 1e-14)
    close(evalTex('8\\times10^{-7}') ?? NaN, 8e-7, 1e-14)
    close(evalTex('(6.20415\\times10^{-5})^2') ?? NaN, 6.20415e-5 ** 2, 1e-14)
    close(evalTex('(-1.35476)^2+(-2.1826)^2') ?? NaN, 1.35476 ** 2 + 2.1826 ** 2, 1e-14)
    close(evalTex('-\\frac{0.287717}{2}-\\frac{0.0382535}{4\\times0.00432554}') ?? NaN, -0.287717 / 2 - 0.0382535 / (4 * 0.00432554), 1e-14)
    close(evalTex('\\Big(\\frac{0.0314159}{0.38883636}\\Big)^2') ?? NaN, (0.0314159 / 0.38883636) ** 2, 1e-14)
    close(evalTex('\\sin\\frac{0.0314159}{2}') ?? NaN, Math.sin(0.0314159 / 2), 1e-14)
    close(evalTex('\\arcsin(0.10569)') ?? NaN, Math.asin(0.10569), 1e-14)
    close(evalTex('\\sqrt{0.0111703}') ?? NaN, Math.sqrt(0.0111703), 1e-14)
    close(evalTex('e^{-0.0078125}') ?? NaN, Math.exp(-0.0078125), 1e-14)
    close(evalTex('\\mathrm{erf}(0.0883883)') ?? NaN, erfSeries(0.0883883), 1e-14)
    close(evalTex('\\min(0.168,\\ 1-0.168)\\times4000') ?? NaN, 672, 1e-12)
    close(evalTex('\\min\\{0.26859,\\ 1.69316\\}') ?? NaN, 0.26859, 1e-14)
    close(evalTex('8\\times0.137-\\lfloor8\\times0.137\\rfloor') ?? NaN, 0.096, 1e-12)
    close(evalTex('134.82\\ \\mathrm{MHz}') ?? NaN, 134.82, 1e-14)
    close(evalTex('0.00398942\\ \\mathrm{fs}^{-1}') ?? NaN, 0.00398942, 1e-14)
    close(evalTex('0+0.1\\times(-1)\\times1') ?? NaN, -0.1, 1e-14)
    for (const sym of ['e_0', 'g\\,(a-w_0)\\,x', '\\frac{2\\pi f}{f_{ref}}', '\\mathrm{Re}\\,L', '1+\\mathrm{Re}\\,L', '\\min_\\Omega g', 'K\\big(d-\\tfrac12\\big)']) expect(evalTex(sym), sym).toBeNull()
    // 檢查器抓得到錯：代錯數字、加減法差一位、沒有代入數字的步驟
    expect(() => checkStepTex('x=2\\times3=7', 'bad')).toThrow()
    expect(() => checkStepTex('f=84-134.82=-50.8201', 'bad')).toThrow()
    expect(() => checkStepTex('f=x+y=3', 'bad')).toThrow()
    expect(checkStepTex('f=84-134.8201=-50.8201\\ \\mathrm{MHz}', 'ok')).toEqual([-50.8201])
    expect(checkStepTex('a=\\sin(0.5)=0.479426,\\qquad b=\\cos(0.5)=0.877583', 'ok')).toEqual([0.479426, 0.877583])
  })

  it('SSPLL: 每一步「符號式 = 代入數字 =（中間結果 =）結果」用畫面上的數字重算都前後一致，每個答案都是某一步的結果——預設值、邊界情況、20 組隨機數字', () => {
    let nSteps = 0
    for (const def of HANDCALCS) {
      const all = [defaultValues(def), ...EXTRA[def.id].map((patch) => withDefaults(def, patch)), ...Array.from({ length: 20 }, (_, i) => randomValues(def, i + 1))]
      for (const v of all) {
        expectStepsConsistent(def, v)
        nSteps += def.solve(v).steps.length
      }
    }
    expect(nSteps).toBeGreaterThan(2000)
  })

  it('SSPLL: 顯示耐得住使用者自己打的數字——輸入照樣代入、接近的數相減時多寫幾位、特殊角的 0、科學記號當底數加括號', () => {
    // 輸入值照輸入框的樣子代進去（不四捨五入成 6 位）
    const s4 = hc('HC-CS.4').solve(defaultValues(hc('HC-CS.4'))).steps
    expect(s4[0].tex).toBe('2-K_p=2-0.28771696=1.71228')
    expect(s4[5].tex).toContain('=-0.143858-0.856142=-1')
    // HC-CS.2：sin² 另成一步
    const s2 = hc('HC-CS.2').solve(defaultValues(hc('HC-CS.2'))).steps
    expect(s2.length).toBe(6)
    expect(s2[4].tex).toBe('\\sin^2\\frac{\\Omega}{2}=0.0157073^2=0.00024672')
    // 很小的頻率：Ω 是科學記號，平方時底數有括號（否則是 KaTeX 的 double superscript）
    const tiny = hc('HC-CS.2').solve(withDefaults(hc('HC-CS.2'), { f: 0.05 })).steps
    expect(tiny[1].tex).toBe('\\Omega^2=(7.85398\\times10^{-5})^2=6.1685\\times10^{-9}')
    for (const st of tiny) expect(renderTex(st.tex, true)).not.toMatch(/katex-error|c-tex-error/)
    // HC-CS.5：cos 另成一步；接近帶緣時 Re L 多寫幾位；f = f_ref/2 時 cos(π/2) 是 0
    const d5 = hc('HC-CS.5')
    const s5 = d5.solve(defaultValues(d5)).steps
    expect(s5.length).toBe(11)
    expect(s5[4].tex).toBe('\\cos\\frac{\\Omega}{2}=\\cos(0.0658164)=0.997835')
    expect(s5[7].tex).toBe('1+\\mathrm{Re}\\,L=1+(-2.35476)=-1.35476')
    const near = d5.solve(withDefaults(d5, { f: 134.825 }))
    expect(near.steps[7].tex).toBe('1+\\mathrm{Re}\\,L=1+(-0.9999379585)=6.20415\\times10^{-5}')
    expect(near.steps[7].why).toContain('多寫了幾位')
    expect(near.steps[8].tex).toContain('(6.20415\\times10^{-5})^2+(-1.35347)^2')
    expect(near.notes?.[0]).toContain('134.820096')
    expect(near.notes?.[near.notes.length - 1]).toContain('PVT margin')
    expect(d5.solve(defaultValues(d5)).notes?.join(' ')).not.toContain('PVT margin')
    const half = d5.solve(withDefaults(d5, { f: 2000 }))
    expect(half.steps[4].tex).toBe('\\cos\\frac{\\Omega}{2}=\\cos(1.5708)=0')
    expect(half.steps[4].why).toContain('精確值是 0')
    expect(half.steps[6].tex.endsWith('\\times0=0')).toBe(true)
    // 剛好在帶緣（double 留下 1e-16 的殘渣）：1 + Re L = 0、Re H = 0，而不是 −6.7e-17
    const edge = d5.solve(withDefaults(d5, { fref: 6000, f: 1000, Kp: 1, Ki: 0.5 }))
    expect(edge.steps[7].tex).toBe('1+\\mathrm{Re}\\,L=1+(-1)=0')
    expect(edge.results[2].value).toBe(0)
    expect(edge.results[3].value).toBe(0)
    expect(edge.notes?.[0]).toContain('剛好在反號帶的上緣')
    // HC-CS.6：K_i = 2K_p 時 closed form 剛好是 0；掃描的 −3e-8 是捨入，不顯示成負數
    const s6 = hc('HC-CS.6').solve({ Kp: 0.3, Ki: 0.6 })
    expect(s6.results[2].value).toBe(0)
    expect(s6.notes?.[0]).toContain('\\ge0')
    expect(s6.notes?.[1]).toContain('$\\min_\\Omega g=0$')
    // HC-CS.7：指數就是 z²（一次平方）；√2 多寫兩位，z 才對得起來
    const d7 = hc('HC-CS.7')
    const s7 = d7.solve(defaultValues(d7)).steps
    expect(s7[0].tex).toContain('\\frac{25}{1.4142136\\times200}=0.0883883')
    expect(s7[3].tex).toBe('\\frac{u_{os}^2}{2\\sigma_v^2}=z^2=0.0883883^2=0.0078125')
    expect(d7.solve(withDefaults(d7, { uos: -25 })).steps[3].tex).toContain('(-0.0883883)^2')
    expect(d7.solve(withDefaults(d7, { uos: 0.01 })).steps[3].tex).toContain('(3.53553\\times10^{-5})^2')
    // HC-CS.8：f_inv 寫到和答案相同的小數位；8α 接近整數時多寫幾位；1 − β 與 K_i/2 都寫出來
    const d8 = hc('HC-CS.8')
    const s8 = d8.solve(defaultValues(d8)).steps
    expect(s8.length).toBe(11)
    expect(s8[2].tex).toContain('8\\times0.021-\\lfloor8\\times0.021\\rfloor=0.168-0=0.168')
    expect(unwrapAligned(s8[3].tex)).toContain('\\min(0.168,\\ 1-0.168)\\times4000=\\min(0.168,\\ 0.832)\\times4000=0.168\\times4000=672')
    expect(s8[4].tex).toContain('2\\times(2-0.28771696)')
    expect(s8[8].tex).toBe('f_{rot}-f_{inv}=84-134.8201=-50.8201\\ \\mathrm{MHz}')
    expect(s8[9].tex).toBe('\\tfrac{K_i}{2}=\\tfrac{0.038253471}{2}=0.0191267')
    expect(d8.solve(withDefaults(d8, { alpha: 0.1250001 })).steps[2].tex).toContain('1.0000008-1=8\\times10^{-7}')
    expect(d8.solve(withDefaults(d8, { alpha: 0.1250000001 })).steps[2].tex).toContain('1.0000000008-1=8\\times10^{-10}') // 不是 8.000000662×10⁻¹⁰（double 的殘渣）
    // α、f_ref 的乘與加減照十進位寫，不四捨五入成 6 位
    const sDec = d8.solve(withDefaults(d8, { alpha: 0.12499991 })).steps
    expect(sDec[0].tex).toBe('\\alpha f_{ref}=0.12499991\\times4000=499.99964\\ \\mathrm{MHz}')
    expect(sDec[2].tex).toContain('=0.99999928-0=0.99999928')
    expect(sDec[3].tex).toContain('=\\min(0.99999928,\\ 7.2\\times10^{-7})\\times4000=7.2\\times10^{-7}\\times4000=0.00288')
    expect(values(d8, withDefaults(d8, { alpha: 0.98 }))[0]).toBe(80) // 不是 80.00000000000007
    expect(d8.solve(withDefaults(d8, { alpha: 0.496 })).notes?.[1]).toContain('b=\\min(\\beta,1-\\beta)')
    expect(d8.solve(withDefaults(d8, { Kp: 0.1, Ki: 0.5 })).notes?.[0]).toContain('只看基波無法判定符號')
  })

  it('SSPLL: 太長的步驟排成對齊的多行（1280px 的欄位放得下，不必橫向捲動）——內容和排成一行時相同，只多了換行與對齊點', () => {
    // 預設值下原本比欄位寬的四步：HC-CS.3 的 closed form 驗算（分子、分母）、HC-CS.8 的 f_saw 與 min g
    const d3 = hc('HC-CS.3')
    const s3 = d3.solve(defaultValues(d3)).steps
    const d8 = hc('HC-CS.8')
    const s8 = d8.solve(defaultValues(d8)).steps
    const wide: [string, string, number][] = [
      [s3[13].tex, '(2-K)(1-\\cos\\Omega)=(2-K)\\cdot2\\sin^2\\frac{\\Omega}{2}=(2-0.38883636)\\times2\\times0.0157073^2=1.61116\\times2\\times0.00024672=0.000795012', 2],
      [s3[14].tex, '\\lvert1-(1-K)e^{-j\\Omega}\\rvert^2=K^2+4(1-K)\\sin^2\\frac{\\Omega}{2}=0.38883636^2+4\\times(1-0.38883636)\\times0.00024672=0.151194+0.000603145=0.151797', 3],
      [s8[3].tex, 'f_{saw}=\\min(\\beta,\\ 1-\\beta)\\,f_{ref}=\\min(0.168,\\ 1-0.168)\\times4000=\\min(0.168,\\ 0.832)\\times4000=0.168\\times4000=672\\ \\mathrm{MHz}', 2],
      [s8[10].tex, '\\min_\\Omega g=\\min\\Big\\{K_p-\\frac{K_i}{2},\\ 2-K_p-\\frac{K_i}{2}\\Big\\}=\\min\\{0.28771696-0.0191267,\\ 2-0.28771696-0.0191267\\}=\\min\\{0.26859,\\ 1.69316\\}=0.26859', 3],
    ]
    for (const [tex, oneLine, lines] of wide) {
      expect(tex.startsWith('\\begin{aligned}') && tex.endsWith('\\end{aligned}'), tex).toBe(true)
      expect(tex.split('\\\\').length, tex).toBe(lines)
      expect(unwrapAligned(tex), tex).toBe(oneLine) // 沒有少掉任何一項、數字或單位
      // 每一行都從對齊點「&=」開始（第一行是「左式&=」），所以等號上下對齊
      const rows = tex.slice('\\begin{aligned}'.length, -'\\end{aligned}'.length).split('\\\\')
      expect(rows[0].split('&=').length, tex).toBe(2)
      for (const row of rows.slice(1)) expect(row.startsWith('&='), tex).toBe(true)
      expect(renderTex(tex, true), tex).not.toMatch(/katex-error|c-tex-error/)
      expect(checkStepTex(tex, 'aligned')).toHaveLength(1)
    }
    // 還原工具本身：不是 aligned 的 TeX 原樣回傳；換行後面的間距（\\[4pt]）一併去掉
    expect(unwrapAligned('a=1+1=2')).toBe('a=1+1=2')
    expect(unwrapAligned('\\begin{aligned}a&=1+1\\\\[4pt]&=2\\end{aligned}')).toBe('a=1+1=2')
    expect(checkStepTex('\\begin{aligned}a&=2\\times3\\\\&=6\\end{aligned}', 'ok')).toEqual([6])
    expect(() => checkStepTex('\\begin{aligned}a&=2\\times3\\\\&=7\\end{aligned}', 'bad')).toThrow() // 多行也照樣抓得到算錯的步驟
  })

  it('SSPLL: 各題的分支（反號／不反號、d > 1、near-grid、帶外…）與 20 個隨機題目的步驟、說明、結論都能渲染', () => {
    for (const def of HANDCALCS) {
      expectRenders(def, defaultValues(def))
      for (const patch of EXTRA[def.id]) expectRenders(def, withDefaults(def, patch))
      for (let seed = 1; seed <= 20; seed++) expectRenders(def, randomValues(def, seed))
    }
  }, 120000)
})
