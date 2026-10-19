import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, within } from '@testing-library/react'
import { HandCalc, MathText, checkAnswer, defaultValues, inputError, randomValues, renderTex } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { conventionalStep } from '@/simulation/models/lms'
import {
  calBandwidths,
  calNoise,
  comparatorKq,
  conventionHandTable,
  criticalGain,
  delaySpectralRadius,
  delayedTrajectory,
  ditherErrorPowers,
  efQuantize,
  eigenExample,
  gainScale,
  muForScale,
  nlmsPosteriorFactor,
  nlmsStep,
  pmWithDelayDeg,
  poleFromEnbw,
  poleFromF3db,
  prbsHalfLsbDither,
  widrowStep,
} from './bridge'
import { LOCAL_PRESETS, analyzeLab, parseLabParams } from './experiments/labModel'
import { FORMULAS } from './formulas'
import { HANDCALCS, HC_DITHER_DEN, HC_DITHER_STEPS, handcalc } from './handcalcs'
import { clean, sigFor, snap, tx, txCeilArg, txInt, txP, txSq } from './handcalcTex'
import { D1_PARAMS, d1Inverse } from './panels/D1Noise'
import { D3_EXAMPLE } from './panels/D3Delay'
import { WH, d6Data } from './panels/D5D6Quant'
import { HAND } from './sections/S4Conventions'
import { expectNoTexErrors } from '@/test/katex'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
}
const vec = (name: string): Vector => JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector

const values = (def: HandCalcDef, v: Record<string, number>): number[] => def.solve(v).results.map((x) => x.value)
const withDefaults = (def: HandCalcDef, patch: Record<string, number> = {}): Record<string, number> => ({ ...defaultValues(def), ...patch })
/** 把某組數字當成預設值（HandCalc 以 inputs[].default 當初始輸入） */
const withValues = (def: HandCalcDef, v: Record<string, number>): HandCalcDef => ({ ...def, inputs: def.inputs.map((i) => ({ ...i, default: v[i.key] })) })

function close(got: number, want: number, rel = 1e-9, abs = 1e-12, msg = '') {
  expect(Number.isFinite(got), `${msg} got ${got}`).toBe(true)
  expect(Math.abs(got - want), `${msg} got ${got}, want ${want}`).toBeLessThanOrEqual(abs + rel * Math.abs(want))
}

/** 可見文字（去掉 KaTeX 節點）：用來檢查沒有殘留的 $ */
function proseText(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}
const unpaired = (s: string): boolean => (s.match(/(?<!\\)\$/g) ?? []).length % 2 !== 0

// ── 測試內的獨立重算：只用 Math，不呼叫 bridge.ts，而且盡量用「另一種算法」 ─────────────────────────

/** 在 [lo, hi] 內找 f 的根（f(lo)、f(hi) 異號） */
function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let a = lo
  let b = hi
  let fa = f(a)
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + b)
    const fm = f(m)
    if (fa * fm <= 0) b = m
    else {
      a = m
      fa = fm
    }
  }
  return 0.5 * (a + b)
}

/** |H(e^{jΩ})|²/|H(1)|²，H(z) = μ/(z − p) */
const relPower = (p: number, Om: number): number => (1 - p) ** 2 / (1 + p * p - 2 * p * Math.cos(Om))
/** one-sided ENBW / f_u：直接對 |H|² 做中點積分（不使用封閉式） */
function enbwOverFu(p: number, K = 20000): number {
  let acc = 0
  for (let i = 0; i < K; i++) acc += relPower(p, (Math.PI * (i + 0.5)) / K)
  return (0.5 * acc) / K
}

/** g*(d)：在單位圓上解 Im{z^d(1 − z)} = 0 的最小正角，再取實部（不用封閉式 2 sin(π/(4d+2))） */
function gStarIndep(d: number): number {
  if (d === 0) return 2 // p = 1 − g = −1
  const w = bisect((x) => Math.sin(d * x) - Math.sin((d + 1) * x), 1e-6, (2 * Math.PI) / (2 * d + 1))
  return Math.cos(d * w) - Math.cos((d + 1) * w)
}
/** PM：先找 |L| = 1 的 ω_c（|e^{jω} − 1| = g），再直接量 L = g·e^{−jdω}/(e^{jω} − 1) 的相位（不用 arcsin 公式） */
function pmIndepDeg(g: number, d: number): number {
  const wc = g >= 2 ? Math.PI : bisect((x) => Math.hypot(Math.cos(x) - 1, Math.sin(x)) - g, 1e-12, Math.PI)
  const angDen = Math.atan2(Math.sin(wc), Math.cos(wc) - 1) // ∠(e^{jω} − 1) ∈ (π/2, π]
  return 180 - ((d * wc + angDen) * 180) / Math.PI
}

/** HC-PR.6：兩個量化器都以整數分子直接模擬 */
function ditherIndep(c: number, bits: number[]): { y: number[]; yf: number[]; r: number[] } {
  const D = 100
  const C = Math.round(c * D)
  let R = 0
  let Rf = 0
  const y: number[] = []
  const yf: number[] = []
  const r: number[] = []
  for (const b of bits) {
    const V = C + R
    const yn = Math.floor((V + D * b) / D) // ⌊v + ξ + ½⌋，ξ = b − ½
    R = V - D * yn
    const Vf = C + Rf
    const yfn = Math.floor(Vf / D)
    Rf = Vf - D * yfn
    y.push(yn)
    yf.push(yfn)
    r.push(R / D)
  }
  return { y, yf, r }
}

// ── 把畫面上的算式重新求值：每個等號兩邊「只含數字」時，左邊算出來必須等於右邊 ─────────────────────────

const sind = (deg: number): number => Math.sin((deg * Math.PI) / 180)
const asind = (x: number): number => (Math.asin(x) * 180) / Math.PI

/** 把一段只含數字的 TeX 算式轉成 JS 求值；含有符號（字母）時回傳 null。只支援本頁手算題用到的寫法。 */
function evalTex(seg: string): number | null {
  let s = seg
    .replace(/\\(?:left|right|big|Big)(?![a-zA-Z])/g, '')
    .replace(/\\ ?\\mathrm\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '') // 單位：\ \mathrm{fs^{-1}}
    .replace(/\\checkmark/g, '')
    .replace(/\\[,;!]/g, '')
    .replace(/\\quad/g, ' ')
    .replace(/\\ /g, ' ')
    .replace(/\^\\circ/g, '') // 角度一律以度計
    .replace(/10\^\{(-?\d+)\}/g, '1e$1') // a\times10^{b}
  for (let guard = 0; guard < 10 && /\\frac\{[^{}]*\}\{[^{}]*\}/.test(s); guard++) s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))')
  s = s
    .replace(/\\sqrt\{([^{}]*)\}/g, 'Math.sqrt($1)')
    .replace(/\\lfloor/g, 'Math.floor(')
    .replace(/\\rfloor/g, ')')
    .replace(/\\lceil/g, 'Math.ceil(')
    .replace(/\\rceil/g, ')')
    .replace(/\\arcsin/g, 'asind')
    .replace(/\\sin/g, 'sind')
    .replace(/\\ln/g, 'Math.log')
    .replace(/\\max/g, 'Math.max')
    .replace(/\\times/g, '*')
    .replace(/\^\{?(\d+)\}?/g, '**$1')
    .trim()
  const probe = s.replace(/Math\.(?:floor|ceil|sqrt|log|max)|asind|sind|1e-?\d+/g, '')
  if (/[A-Za-z\\[\]{}|_'&]/.test(probe) || !/\d/.test(s)) return null
  try {
    const v = new Function('sind', 'asind', `"use strict"; return (${s})`)(sind, asind) as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** 一步的 TeX → 若干條「a = b = c」的等式鏈（aligned 的每一行、逗號隔開的每一段各算一條） */
function chains(tex: string): string[][] {
  const body = tex.replace(/\\begin\{aligned\}|\\end\{aligned\}/g, '')
  return body
    .split(/\\\\/)
    .flatMap((line) => line.split(/,&\\quad/))
    .map((eq) => eq.replace(/&/g, '').split('='))
}

/** 檢查一步裡所有「兩邊都是數字」的等號；回傳檢查了幾個 */
function checkStepArithmetic(tex: string, label: string): number {
  let checked = 0
  for (const segs of chains(tex)) {
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = evalTex(segs[i])
      const b = evalTex(segs[i + 1])
      if (a === null || b === null) continue
      // 畫面上的數字至少有 5 位有效數字：乘除的相對誤差 < 1e-4；加減另外容許運算元最後一位的捨入
      const literals = (segs[i].match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
      const scale = Math.max(Math.abs(a), Math.abs(b))
      const tol = 3e-4 * scale + 2e-5 * Math.max(0, ...literals) + 1e-12
      expect(Math.abs(a - b), `${label}：「${segs[i].trim()}」算出來是 ${a}，畫面寫 ${segs[i + 1].trim()}（${tex}）`).toBeLessThanOrEqual(tol)
      checked++
    }
  }
  return checked
}

/** 每一題的答案（results 的順序）以最直接的寫法重算 */
const INDEP: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-PR.1': ({ muW, lmax }) => [muW + muW, 1 - (muW + muW) * lmax, 1 / lmax],
  'HC-PR.2': ({ w, x, y, muT, eps }) => {
    const e = y - w * x
    const wN = w + (muT * e * x) / (eps + x * x)
    return [wN, y - wN * x, eps / (eps + x * x) + ((1 - muT) * x * x) / (eps + x * x)] // κ = (ε + (1 − μ̃)x²)/(ε + x²)
  },
  'HC-PR.3': ({ sigmaV, mu, N }) => {
    const Kq = Math.sqrt(2 / Math.PI) / sigmaV
    return [mu * Kq, (mu * Kq) / 2, (2 * sigmaV) / Math.sqrt(2 / Math.PI), mu * Kq * N]
  },
  'HC-PR.4': ({ B, fu }) => {
    const p3 = bisect((p) => relPower(p, (2 * Math.PI * B) / fu) - 0.5, 1e-9, 1 - 1e-12)
    const pE = bisect((p) => enbwOverFu(p) - B / fu, 1e-9, 1 - 1e-12)
    return [p3, 1 - p3, 1 - pE, (1 - p3) / (1 - pE)]
  },
  'HC-PR.5': ({ muW, lmax, d }) => {
    const g = 2 * muW * lmax
    const gs = gStarIndep(d)
    return [g, gs, pmIndepDeg(g, d), gs / (2 * lmax)]
  },
  'HC-PR.6': ({ c, b0, b1, b2, b3 }) => {
    const s = ditherIndep(c, [b0, b1, b2, b3])
    return [s.y.reduce((a, b) => a + b, 0), s.yf.reduce((a, b) => a + b, 0), s.r[3]]
  },
  'HC-PR.7': ({ c }) => {
    const f = c - Math.floor(c)
    const e0 = f >= 0.5 ? 1 - f : -f // round-half-up：Q(c) − c
    return [e0 * e0, f - f * f, 1 / 12]
  },
  'HC-PR.8': ({ muW, rho, Px }) => {
    const mu = 2 * muW
    const a = Math.max(Math.abs(1 - mu * Px * (1 + Math.abs(rho))), Math.abs(1 - mu * Px * (1 - Math.abs(rho))))
    // 不用 ln：直接連乘，找 aⁿ ≤ 0.05 的最小 n
    let n = 1
    let acc = a
    while (acc > 0.05) {
      acc *= a
      n++
    }
    return [mu, a, n]
  },
}

/**
 * 讀者「自己的數字」：不整齊的小數、很大或很小的值、剛好在邊界上的值。
 * 這些不在 practice 範圍內，但都合法；畫面上的每個等號一樣要成立（相減抵銷時要自動多顯示幾位）。
 */
const OWN_NUMBERS: Record<string, Record<string, number>[]> = {
  'HC-PR.1': [
    { muW: 0.123456, lmax: 3.3 },
    { muW: 1e-7, lmax: 2 },
    { muW: 0.25, lmax: 4 },
    { muW: 0.7, lmax: 1.9 },
  ],
  'HC-PR.2': [
    { w: -1.37, x: 0.3, y: 2.2, muT: 0.77, eps: 0.05 },
    { w: 0.448 / 0.64, x: 0.64, y: 0.448, muT: 1, eps: 0 },
    { w: 2, x: 0, y: 5, muT: 0.5, eps: 2 },
    { w: 1, x: -20, y: 60, muT: 2, eps: 0 },
    { w: 3, x: 1e-3, y: 1e-3, muT: 0.1, eps: 1e-6 },
  ],
  'HC-PR.3': [
    { sigmaV: 37.5, mu: 2.2, N: 2000 },
    { sigmaV: 1, mu: 5, N: 16 },
    { sigmaV: 250, mu: 0.01, N: 65536 },
    { sigmaV: 100, mu: 10, N: 1 },
  ],
  'HC-PR.4': [
    { B: 0.001, fu: 1000 },
    { B: 499, fu: 1000 },
    { B: 324.069, fu: 1000 },
    { B: 13.7, fu: 815.3 },
    { B: 1e-6, fu: 1 },
  ],
  'HC-PR.5': [
    { muW: 0.031, lmax: 1.7, d: 5 },
    { muW: 1, lmax: 1, d: 0 },
    { muW: 0.5, lmax: 1, d: 1 },
    { muW: 0.12, lmax: 1, d: 6 },
    { muW: 0.0005, lmax: 0.3, d: 3 },
  ],
  'HC-PR.6': [
    { c: 1, b0: 1, b1: 1, b2: 1, b3: 1 },
    { c: 61.99, b0: 1, b1: 0, b2: 0, b3: 1 },
    { c: 20.05, b0: 0, b1: 1, b2: 0, b3: 1 },
    { c: 33, b0: 0, b1: 0, b2: 1, b3: 0 },
    { c: 32.5, b0: 1, b1: 1, b2: 0, b3: 0 },
  ],
  'HC-PR.7': [{ c: 0.37 }, { c: 62.999 }, { c: 0 }, { c: 63 }, { c: 31.5 }, { c: 12.0625 }],
  'HC-PR.8': [
    { muW: 1e-4, rho: 0.9, Px: 1 },
    { muW: 0.6, rho: 0.5, Px: 1 },
    { muW: 0.5, rho: 0, Px: 1 },
    { muW: 0.137, rho: -0.731, Px: 2.4 },
    { muW: 0.25, rho: 0.999999, Px: 1 },
    { muW: 0.499, rho: 0.999, Px: 1 },
  ],
}

/** 各題的相對容差（預設 1e-9）：HC-PR.4 的 ENBW 以數值積分反解，HC-PR.5 的 PM 以數值求 ω_c */
const REL: Record<string, number> = { 'HC-PR.4': 1e-8, 'HC-PR.5': 1e-8 }

/** validate 必須擋下的輸入，以及訊息中應該出現的解釋 */
const INVALID: { id: string; name: string; patch: Record<string, number>; expect: RegExp }[] = [
  { id: 'HC-PR.1', name: 'λ_max = 0（不可辨識）', patch: { lmax: 0 }, expect: /不可辨識/ },
  { id: 'HC-PR.1', name: 'λ_max < 0', patch: { lmax: -1 }, expect: /不會是負的/ },
  { id: 'HC-PR.1', name: 'μ_W = 0', patch: { muW: 0 }, expect: /完全不更新/ },
  { id: 'HC-PR.1', name: 'μ_W < 0（極性接反）', patch: { muW: -0.05 }, expect: /方向接反/ },
  { id: 'HC-PR.2', name: 'x = 0 且 ε_reg = 0（0/0）', patch: { x: 0, eps: 0 }, expect: /0\/0/ },
  { id: 'HC-PR.3', name: 'μ = 0', patch: { mu: 0 }, expect: /不更新/ },
  { id: 'HC-PR.3', name: 'μ < 0（極性接反）', patch: { mu: -10 }, expect: /極性接反/ },
  { id: 'HC-PR.4', name: 'B = 0', patch: { B: 0 }, expect: /必須是正的/ },
  { id: 'HC-PR.4', name: 'B < 0', patch: { B: -5 }, expect: /必須是正的/ },
  { id: 'HC-PR.4', name: 'B = f_u/2（Nyquist）', patch: { B: 500, fu: 1000 }, expect: /Nyquist/ },
  { id: 'HC-PR.4', name: 'B > f_u/2', patch: { B: 800, fu: 1000 }, expect: /E27/ },
  { id: 'HC-PR.5', name: 'λ_max = 0', patch: { lmax: 0 }, expect: /不可辨識/ },
  { id: 'HC-PR.5', name: 'μ_W = 0', patch: { muW: 0 }, expect: /不會收斂/ },
  { id: 'HC-PR.5', name: 'g > 2（arcsin 無定義）', patch: { muW: 1.2, lmax: 1 }, expect: /沒有定義/ },
  { id: 'HC-PR.6', name: 'c < 1（overload）', patch: { c: 0.4 }, expect: /overload/ },
  { id: 'HC-PR.6', name: 'c ≥ 62（overload）', patch: { c: 62 }, expect: /飽和/ },
  { id: 'HC-PR.6', name: 'c 有三位小數', patch: { c: 32.123 }, expect: /兩位小數/ },
  { id: 'HC-PR.7', name: 'c < 0', patch: { c: -0.5 }, expect: /飽和/ },
  { id: 'HC-PR.7', name: 'c > 63', patch: { c: 63.2 }, expect: /飽和/ },
  { id: 'HC-PR.8', name: 'P_x = 0', patch: { Px: 0 }, expect: /不可辨識/ },
  { id: 'HC-PR.8', name: 'μ_W = 0', patch: { muW: 0 }, expect: /沒有「幾步收斂」可言/ },
  { id: 'HC-PR.8', name: 'ρ = 1（λ_min = 0）', patch: { rho: 1 }, expect: /不可辨識/ },
  { id: 'HC-PR.8', name: 'ρ = −1', patch: { rho: -1 }, expect: /不可辨識/ },
  { id: 'HC-PR.8', name: 'μλ_max ≥ 2', patch: { muW: 0.6, rho: 0.9 }, expect: /不收斂/ },
]

/** practice 範圍內的所有組合（choices 的笛卡兒積；min/max/step 的輸入展開成格點） */
function practiceGrid(def: HandCalcDef): Record<string, number>[] {
  const axes = def.inputs.map((i) => {
    const p = i.practice
    if (!p) return [i.default]
    if (p.choices?.length) return [...new Set(p.choices)]
    const lo = p.min ?? i.min ?? i.default
    const hi = p.max ?? i.max ?? i.default
    const step = p.step ?? 1
    const out: number[] = []
    for (let k = 0; lo + k * step <= hi + 1e-9; k++) out.push(Number((lo + k * step).toPrecision(10)))
    return out
  })
  let grid: Record<string, number>[] = [{}]
  def.inputs.forEach((i, k) => {
    grid = grid.flatMap((g) => axes[k].map((x) => ({ ...g, [i.key]: x })))
  })
  return grid
}

describe('Papers 頁的手算小工具（handcalcTex）', () => {
  it('tx：寫得完的小數完整顯示，寫不完的取 sig 位；txP／txSq 幫負數加括號；txInt 不取有效位數', () => {
    expect(tx(0.123456)).toBe('0.123456')
    expect(tx(976.5625)).toBe('976.5625')
    expect(tx(0.1 + 0.2)).toBe('0.3')
    expect(tx(1 / 3)).toBe('0.33333')
    expect(tx(1 / 3, 7)).toBe('0.3333333')
    expect(tx(Math.SQRT2, 6)).toBe('1.41421')
    expect(tx(0)).toBe('0')
    expect(txP(-0.6)).toBe('(-0.6)')
    expect(txP(0.6)).toBe('0.6')
    expect(txSq(-0.4)).toBe('(-0.4)^2')
    expect(txSq(2)).toBe('2^2')
    expect(txSq(5e-5)).toBe(String.raw`(5\times10^{-5})^2`)
    expect(txInt(123457)).toBe('123457')
    expect(txInt(598)).toBe('598')
  })

  it('snap／clean：捨入殘渣歸零；sigFor：相減抵銷時多顯示幾位；txCeilArg：顯示的數字取上整等於答案', () => {
    expect(snap(6 - 1.8 * 2 - 2.4, 6, 3.6)).toBe(0)
    expect(snap(0.1, 1, 0.9)).toBe(0.1)
    // clean：殘渣的大小看運算元（63），不是看結果（0.001）
    expect(clean(0.1 + 0.2, 0.1, 0.2)).toBe(0.3)
    expect(clean(32.4 - 32, 32.4)).toBe(0.4)
    expect(63 - 62.999).not.toBe(0.001)
    expect(clean(63 - 62.999, 63, 62.999)).toBe(0.001)
    expect(clean(1 - 0.999999, 1)).toBe(1e-6)
    expect(clean(1 - 0.99, 1)).toBe(0.01)
    expect(clean(1 - 0.5 * 1.99, 1, 0.995)).toBe(0.005)
    expect(clean(Math.cos(Math.PI / 2), 1)).toBe(0)
    expect(clean(1 / 3, 1)).toBeCloseTo(1 / 3, 12) // 真正的小數不會被改掉
    expect(clean(1e-9 - 3e-10, 1e-9)).toBeCloseTo(7e-10, 20)
    expect(clean(123456789.25 - 0.25, 123456789.25)).toBe(123456789)
    expect(clean(0, 0)).toBe(0)
    expect(Number.isNaN(clean(Number.NaN, 1))).toBe(true)
    expect(sigFor(-12.4366, 90, 102.4366)).toBe(6)
    expect(sigFor(0.6, 1, 0.4)).toBe(6)
    expect(sigFor(5, 2, 3)).toBe(5)
    expect(sigFor(0, 1, 1)).toBe(12)
    expect(txCeilArg(597.6473, 598)).toBe('597.65')
    expect(txCeilArg(598.00004, 599)).toBe('598.00004')
    expect(txCeilArg(0.2, 1)).toBe('0.2')
  })
})

describe('Papers 頁的帶入手算（HC-PR.1 – HC-PR.8）：結構', () => {
  it('8 題、ID 連號 HC-PR.n、頁面 /papers、公式 ID 已登錄、通式可渲染、預設值通過 validate、每題都能「換一題」', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-PR.1', 'HC-PR.2', 'HC-PR.3', 'HC-PR.4', 'HC-PR.5', 'HC-PR.6', 'HC-PR.7', 'HC-PR.8'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/papers')
      expect(h.formulaId, h.id).toBeTruthy()
      expect(formulaIds.has(h.formulaId as string), `${h.id} → ${h.formulaId}`).toBe(true)
      expect(renderTex(h.formulaTex, true), h.id).not.toMatch(/katex-error|c-tex-error/)
      expect(unpaired(h.title), h.title).toBe(false)
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(3)
      for (const t of h.tips ?? []) expect(unpaired(t), t).toBe(false)
      for (const i of h.inputs) {
        expect(i.practice, `${h.id}.${i.key} 要有手算友善的 practice 範圍`).toBeTruthy()
        expect(inputError(i, i.default), `${h.id}.${i.key} default`).toBeNull()
        expect(renderTex(i.symbol, false), `${h.id}.${i.key}`).not.toMatch(/katex-error|c-tex-error/)
        if (i.unit) expect(renderTex(i.unit, false), `${h.id}.${i.key} unit`).not.toMatch(/katex-error|c-tex-error/)
        expect(unpaired(i.label), i.label).toBe(false)
        for (const c of i.practice?.choices ?? []) expect(inputError(i, c), `${h.id}.${i.key}=${c}`).toBeNull()
      }
      expect(handcalc(h.id)).toBe(h)
    }
    expect(() => handcalc('HC-PR.99')).toThrow()
    // 這一頁登錄的換算公式（F-PR.1–F-PR.3、F-PR.15）與本頁獨有的結論（F-PR.14）都有題目
    expect(new Set(HANDCALCS.map((h) => h.formulaId))).toEqual(new Set(['F-PR.1', 'F-PR.2', 'F-PR.3', 'F-PR.15', 'F-PR.4', 'F-PR.14', 'F-PR.13', 'F-PR.11']))
    expect(HANDCALCS.filter((h) => h.level === 'beginner').length).toBeGreaterThanOrEqual(3)
    expect(HANDCALCS.filter((h) => h.level === 'engineer').length).toBeGreaterThanOrEqual(3)
    // 近似的只有 1-bit comparator 線性化那一題
    expect(HANDCALCS.filter((h) => h.claim !== 'exact').map((h) => h.id)).toEqual(['HC-PR.3'])
  })

  it('ID 全站唯一：HC-PR.* 只定義在本頁的 handcalcs.ts，且不重複', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name === 'handcalcs.ts') files.push(full)
      }
    }
    walk(join(process.cwd(), 'src'))
    expect(files.length).toBeGreaterThan(5)
    const mine = join(process.cwd(), 'src', 'pages', 'papers', 'handcalcs.ts')
    const owners = new Map<string, string[]>()
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/^\s*id: '(HC-[^']+)'/gm)) owners.set(m[1], [...(owners.get(m[1]) ?? []), f])
    }
    for (const h of HANDCALCS) expect(owners.get(h.id), h.id).toEqual([mine])
    for (const [id, fs] of owners) if (id.startsWith('HC-PR.')) expect(fs, id).toEqual([mine])
    // 本頁的 8 個 id 與全站其他任何題目都不相同
    const others = [...owners.entries()].filter(([, fs]) => !fs.includes(mine)).map(([id]) => id)
    for (const h of HANDCALCS) expect(others).not.toContain(h.id)
  })
})

describe('Papers 頁的帶入手算：預設值 = 本頁 worked example，答案 = 實際模型函式', () => {
  it('T02: HC-PR.1 的預設值是 §4 手算表（μ_W = μ/2 = 0.05、λ_max = x² = 4）：μ = 0.1、p = 0.6（= 手算表相鄰兩列 δ 的比）', () => {
    const def = handcalc('HC-PR.1')
    const v = defaultValues(def)
    expect(v).toEqual({ muW: HAND.mu / 2, lmax: HAND.x * HAND.x })
    const [mu, p, muWMax] = values(def, v)
    expect(mu).toBe(HAND.mu)
    expect(mu).toBe(gainScale({ convention: 'widrow', mu: v.muW, traceR: 1, epsReg: 0, sigmaV: 1, N: 1, sumMode: false, polarity: 1 }))
    close(p, 0.6, 0, 1e-15)
    const rows = conventionHandTable(HAND, conventionalStep)
    for (let n = 0; n < HAND.steps; n++) close((HAND.a - rows[n + 1].wWidrow) / (HAND.a - rows[n].wWidrow), p, 1e-12)
    // Widrow 的一步（真的執行更新式）：δ₁ = p·δ₀
    const st = widrowStep({ w: HAND.w0, x: HAND.x, y: HAND.a * HAND.x, mu: v.muW })
    close(HAND.a - st.w, p * (HAND.a - HAND.w0), 1e-12)
    // golden T02：x = 2 時 μ_max = 0.5，所以 μ_W,max = 0.25
    const T02 = vec('T02')
    expect(T02.inputs.x).toBe(HAND.x)
    close(muWMax, (T02.expected.mu_max as number) / 2, 1e-12)
    const texts = def
      .solve(v)
      .steps.map((s) => s.tex)
      .join('\n')
    expect(texts).toContain(String.raw`2\times0.05 = 0.1`)
    expect(texts).toContain('1 - 0.4 = 0.6')
    // 界限上：μ_W = 1/λ_max ⇒ p = −1（等幅震盪），備註說明不收斂
    const edge = def.solve({ muW: 0.25, lmax: 4 })
    expect(edge.results[1].value).toBe(-1)
    expect(edge.notes?.join(' ')).toContain('等幅震盪')
    expect(edge.notes?.join(' ')).toContain('不收斂')
  })

  it('T01: HC-PR.2 的預設值是 §4 手算表的 NLMS 欄（μ̃ = μx² = 0.4）：w′ = 1.8（= T01 的 w₁）、e_post = 2.4、κ = 0.6（= nlmsStep / nlmsPosteriorFactor）', () => {
    const def = handcalc('HC-PR.2')
    const v = defaultValues(def)
    expect(v).toEqual({ w: HAND.w0, x: HAND.x, y: HAND.a * HAND.x, muT: 0.4, eps: 0 })
    close(v.muT, HAND.mu * HAND.x * HAND.x, 1e-15)
    const [wN, ePost, kappa] = values(def, v)
    const st = nlmsStep({ w: v.w, x: v.x, y: v.y, mu: v.muT, epsReg: v.eps })
    expect(wN).toBe(st.w)
    close(wN, vec('T01').expected.w1 as number, 1e-12)
    close(wN, conventionHandTable(HAND, conventionalStep)[1].wNlms, 1e-14)
    close(ePost, 2.4, 1e-12)
    close(ePost, vec('T01').expected.e1 as number, 1e-12) // 固定 x 時，更新後重算的誤差就是下一步的 a priori 誤差
    close(kappa, nlmsPosteriorFactor(v.muT, v.eps, v.x * v.x), 1e-15)
    close(ePost, kappa * st.e, 1e-12)
    // 提示 3：μ̃ = 2.5 ⇒ κ = −1.5；x、y 同乘 10 倍 κ 不變
    const big = values(def, withDefaults(def, { muT: 2.5 }))
    close(big[2], -1.5, 1e-12)
    expect(def.solve(withDefaults(def, { muT: 2.5 })).notes?.[0]).toContain('修正過頭')
    close(values(def, withDefaults(def, { x: 20, y: 60 }))[2], kappa, 1e-12)
    // x = 0、ε_reg > 0：係數不動
    const still = def.solve(withDefaults(def, { x: 0, eps: 1 }))
    expect(still.results.map((r) => r.value)).toEqual([v.w, v.y, 1])
    expect(still.notes?.[0]).toContain('係數不動')
  })

  it('T13: HC-PR.3 的預設值是 T13（σ_v = 100 fs、μ = 10 fs、N = 4096）：s = g、μ_W = g/2、sum 模式 326.8（golden、calNoise 與 §5 實驗的 preset 一致）', () => {
    const def = handcalc('HC-PR.3')
    const v = defaultValues(def)
    expect(v).toEqual({ sigmaV: D1_PARAMS.sigmaV, mu: D1_PARAMS.mu, N: D1_PARAMS.N })
    const T13 = vec('T13')
    expect(T13.inputs).toMatchObject({ sigma_v_fs: v.sigmaV, mu_fs: v.mu, N: v.N })
    const [s, muW, muMax, sSum] = values(def, v)
    const n = calNoise(D1_PARAMS)
    expect(s).toBe(n.g)
    close(s, T13.expected.g as number, 1e-13)
    close(sSum, T13.expected.g_sum_mode as number, 1e-13)
    expect(sSum).toBe(n.gSum)
    close(muW, s / 2, 1e-15)
    close(muMax, 2 / comparatorKq(v.sigmaV), 1e-13)
    // §5 實驗的 T13 與 sum 模式 preset
    const lab = analyzeLab(parseLabParams(LOCAL_PRESETS[1].params as Record<string, unknown>))
    expect(lab.s).toBe(s)
    close(lab.equivalents.widrow, muW, 1e-13)
    close(lab.bounds.signBlock, muMax, 1e-12)
    expect(analyzeLab(parseLabParams(LOCAL_PRESETS[2].params as Record<string, unknown>)).s).toBe(sSum)
    const sol = def.solve(v)
    const texts = sol.steps.map((x) => x.tex).join('\n')
    expect(texts).toContain('0.92021') // p（T13）
    expect(texts).toContain('-325.81') // sum 模式的 pole
    expect(Number((1 - sSum).toFixed(2))).toBe(Number((T13.expected.pole_sum_mode as number).toFixed(2)))
    expect(sol.notes?.join(' ')).toContain('立即發散')
    // sum 模式要得到同一個 s：μ/N（真的代回 gainScale 驗算）
    const muFix = muForScale(s, 'signBlock', { traceR: 1, epsReg: 0, sigmaV: v.sigmaV, N: v.N, sumMode: true })
    close(muFix, v.mu / v.N, 1e-13)
    close(gainScale({ convention: 'signBlock', mu: muFix, traceR: 1, epsReg: 0, sigmaV: v.sigmaV, N: v.N, sumMode: true, polarity: 1 }), s, 1e-13)
    expect(texts).toContain(tx(muFix))
    // N = 1：沒有 N 倍的陷阱
    expect(def.solve(withDefaults(def, { N: 1 })).notes?.join(' ')).toContain('同一件事')
  })

  it('T14: HC-PR.4 的預設值是 T14 的 exact −3 dB 頻率（12.93 kHz、f_u = 976.5625 kHz）：讀法 (a) 換回 T13 的 p；兩種讀法都能用 calBandwidths 來回驗算', () => {
    const def = handcalc('HC-PR.4')
    const v = defaultValues(def)
    const T14 = vec('T14')
    expect(v.B).toBe(Number(((T14.expected.bw_exact_3db_hz as number) / 1e3).toFixed(2)))
    expect(v.fu).toBe((T14.expected.f_u_hz as number) / 1e3)
    const [p3, g3, gE, k] = values(def, v)
    expect(p3).toBe(poleFromF3db(v.B, v.fu))
    close(g3, 1 - p3, 0, 1e-15)
    close(gE, 1 - poleFromEnbw(v.B, v.fu), 0, 1e-15)
    close(k, g3 / gE, 1e-14)
    // 12.93 是 12.9313 的四捨五入：換回的 p 與 T13 的 p 差不到 1e-5
    expect(Math.abs(p3 - (vec('T13').expected.p as number))).toBeLessThan(1e-5)
    // 來回驗算：p → 頻寬 → 同一個 B
    close(calBandwidths(p3, v.fu).f3dbExact, v.B, 1e-11)
    close(calBandwidths(1 - gE, v.fu).enbw, v.B, 1e-11)
    // 用 golden 的精確值（Hz）來回：得到 golden 的 p；ENBW 讀法用 golden 的 ENBW 也回到同一個 p
    close(poleFromF3db(T14.expected.bw_exact_3db_hz as number, T14.expected.f_u_hz as number), T14.inputs.p as number, 1e-12)
    close(poleFromEnbw(T14.expected.enbw_one_sided_hz as number, T14.expected.f_u_hz as number), T14.inputs.p as number, 1e-12)
    // 頁面 D1 面板的例子用同一組函式
    const inv = d1Inverse()
    close(inv.pA, T14.inputs.p as number, 1e-12)
    close(inv.ratio, k, 1e-3)
    expect(k).toBeGreaterThan(1.5)
    expect(k).toBeLessThan(Math.PI / 2)
    const sol = def.solve(v)
    const texts = sol.steps.map((x) => x.tex).join('\n')
    expect(texts).toContain('0.920219')
    expect(texts).toContain('0.948405')
    expect(sol.notes?.[0]).toContain('12.93')
    expect(sol.notes?.[0]).toContain('20.287') // p 的 ENBW（T14：20.29 kHz）
    expect(sol.notes?.[2]).toContain('9.999') // 換回 μ ≈ 10 fs（T13）
    // B ≪ f_u：比值趨近 π/2；提示裡的數字：B = 0.1 f_u ⇒ 1.37、B ≈ 0.32 f_u ⇒ 1、再大就小於 1
    close(values(def, { B: 0.01, fu: 1000 })[3], Math.PI / 2, 1e-4)
    expect(values(def, { B: 100, fu: 1000 })[3].toFixed(2)).toBe('1.37')
    close(values(def, { B: 324.069, fu: 1000 })[3], 1, 1e-5)
    expect(values(def, { B: 450, fu: 1000 })[3]).toBeLessThan(1)
    expect(def.tips?.join(' ')).toContain('1.37')
  })

  it('T08: HC-PR.5 的預設值是 D3 面板的例子（g = 0.7、d = 2）：g*(2) = 0.618、PM = −12.44°、|z|max > 1；d = 0 時同一個步長穩定', () => {
    const def = handcalc('HC-PR.5')
    const v = defaultValues(def)
    const [g, gStar, pm, muWMax] = values(def, v)
    expect(g).toBe(D3_EXAMPLE.g)
    expect(v.d).toBe(D3_EXAMPLE.d)
    expect(gStar).toBe(criticalGain(D3_EXAMPLE.d))
    close(gStar, (vec('delay_bounds').expected.g_crit_list as number[])[2], 1e-13)
    expect(pm).toBe(pmWithDelayDeg(D3_EXAMPLE.g, D3_EXAMPLE.d))
    expect(pm.toFixed(2)).toBe('-12.44')
    close(muWMax, gStar / 2, 1e-15)
    // §5 實驗「延遲 d = 2、g = 0.7」preset 的 Widrow 步長上限就是這個數
    const lab = analyzeLab(parseLabParams(LOCAL_PRESETS[4].params as Record<string, unknown>))
    close(lab.bounds.widrow, muWMax, 1e-13)
    expect(delaySpectralRadius(g, v.d)).toBeGreaterThan(1)
    const sol = def.solve(v)
    expect(sol.notes?.[0]).toContain('仍然不收斂')
    expect(sol.notes?.[0]).toContain(tx(delaySpectralRadius(g, v.d)))
    const texts = sol.steps.map((x) => x.tex).join('\n')
    expect(texts).toContain(String.raw`90^\circ - 102.437^\circ = -12.437^\circ`)
    // 判定與時域一致：把延遲遞迴真的跑 600 步（震盪發散，取最後 20 步的峰值）
    const tr = delayedTrajectory(g, 2, 600)
    let peak = 0
    for (let k = 580; k <= 600; k++) peak = Math.max(peak, Math.abs(tr[k]))
    expect(peak).toBeGreaterThan(1e3)
    const d0 = def.solve(withDefaults(def, { d: 0 }))
    expect(d0.results[1].value).toBe(2)
    expect(d0.results[2].value).toBeGreaterThan(0)
    expect(d0.notes?.[0]).toContain('平均誤差收斂')
    expect(Math.abs(delayedTrajectory(g, 0, 600)[600])).toBeLessThan(1e-12)
    // T08（d = 0）：PM = 90° − asin(g/2)
    const T08 = vec('T08')
    ;(T08.inputs.g_list as number[]).forEach((gg, i) => {
      if (gg <= 0 || gg > 2) return
      close(values(def, { muW: gg / 2, lmax: 1, d: 0 })[2], (T08.expected.pm_deg_list as number[])[i], 1e-9, 1e-9)
    })
    // 剛好在界限上（d = 1、g = 1）：PM = 0，判為不收斂（臨界）
    const edge = def.solve({ muW: 0.5, lmax: 1, d: 1 })
    expect(edge.results[2].value).toBe(0)
    expect(edge.notes?.[0]).toContain('仍然不收斂')
  })

  it('T16: HC-PR.6 的預設值是 D5 面板的 w_H = 32.4：對照組就是 T16 的 floor pattern，加 dither 的輸出逐拍等於 y_floor + b[n] − b[n−1]（F-PR.14）', () => {
    const def = handcalc('HC-PR.6')
    const v = defaultValues(def)
    expect(v.c).toBe(WH.value)
    expect(HC_DITHER_STEPS).toBe(4)
    const bits = [v.b0, v.b1, v.b2, v.b3]
    const cNum = Math.round(v.c * HC_DITHER_DEN)
    const dith = efQuantize(cNum, HC_DITHER_DEN, 4, { ditherNum: prbsHalfLsbDither(bits, HC_DITHER_DEN), shaped: true })
    const flr = efQuantize(cNum, HC_DITHER_DEN, 4, { rounding: 'floor' })
    expect(Array.from(flr.y)).toEqual((vec('T16').inputs.pattern as number[]).slice(0, 4))
    expect(Array.from(dith.y)).toEqual([33, 31, 34, 32])
    const [sumD, sumF, rLast] = values(def, v)
    expect(sumD).toBe(130)
    expect(sumF).toBe(129)
    close(rLast, -0.4, 0, 1e-12)
    // 以 1/100 LSB 的分子表示，和頁面用的 162/5（= 3240/100）是同一個序列
    expect(Array.from(efQuantize(WH.num, WH.den, 4, { rounding: 'floor' }).y)).toEqual(Array.from(flr.y))
    const sol = def.solve(v)
    expect(sol.steps.length).toBe(2 * HC_DITHER_STEPS + 4)
    expect(sol.steps[2 * HC_DITHER_STEPS].tex.match(/\\checkmark/g)?.length).toBe(HC_DITHER_STEPS)
    expect(sol.notes?.[0]).toContain('[33,31,34,32]')
    // 16 種 dither bit × 多個目標：恆等式逐拍成立，殘值 r = φ − b，總和只差 b[3]
    for (const c of [32.4, 32.25, 32.5, 32, 1, 61.99, 20.05]) {
      for (let m = 0; m < 16; m++) {
        const b = [m & 1, (m >> 1) & 1, (m >> 2) & 1, (m >> 3) & 1]
        const C = Math.round(c * HC_DITHER_DEN)
        const d = efQuantize(C, HC_DITHER_DEN, 4, { ditherNum: prbsHalfLsbDither(b, HC_DITHER_DEN), shaped: true })
        const f = efQuantize(C, HC_DITHER_DEN, 4, { rounding: 'floor' })
        for (let n = 0; n < 4; n++) {
          expect(d.y[n], `c=${c} b=${b.join('')} n=${n}`).toBe(f.y[n] + b[n] - (n === 0 ? 0 : b[n - 1]))
          expect(d.rNum[n]).toBe(f.rNum[n] - HC_DITHER_DEN * b[n])
          expect(d.y[n]).toBeGreaterThanOrEqual(0)
          expect(d.y[n]).toBeLessThanOrEqual(63)
        }
        const vv = { c, b0: b[0], b1: b[1], b2: b[2], b3: b[3] }
        expect(def.validate?.(vv) ?? null).toBeNull()
        const [sd, sf] = values(def, vv)
        expect(sd - sf).toBe(b[3])
      }
    }
    // 全 0：兩個量化器逐拍相同
    expect(def.solve(withDefaults(def, { b0: 0, b1: 0, b2: 0, b3: 0 })).notes?.[0]).toContain('完全相同')
  })

  it('T17: HC-PR.7 的預設值是 D6 面板的 c = 32.4：0.16 / 0.24 / 1/12（= ditherErrorPowers、golden T17 的變異數、D6 指標表的解析值）', () => {
    const def = handcalc('HC-PR.7')
    const v = defaultValues(def)
    expect(v.c).toBe(WH.value)
    const [pNone, pNs, pS] = values(def, v)
    const pw = ditherErrorPowers(v.c)
    expect([pNone, pNs, pS]).toEqual([pw.nonePower, pw.nonSubtractivePower, pw.subtractivePower])
    close(pNone, 0.16, 1e-12)
    close(pNs, vec('T17').expected.variance as number, 1e-12)
    expect(pS).toBe(1 / 12)
    expect(d6Data().analytic).toEqual({ nonePower: pNone, nonSubtractivePower: pNs, subtractivePower: pS })
    // tie（17.5）：round-half-up 進位，兩者都是 0.25；整數目標：前兩者為 0
    expect(values(def, { c: 17.5 }).slice(0, 2)).toEqual([0.25, 0.25])
    expect(def.solve({ c: 17.5 }).steps[2].tex).toContain(String.raw`\lfloor 18\rfloor = 18`)
    expect(values(def, { c: 33 }).slice(0, 2)).toEqual([0, 0])
    expect(def.solve({ c: 33 }).notes?.[0]).toContain('反而最差')
    // 離 code 很近（12.1）：不加 dither 的 0.01 比 subtractive 的 1/12 小
    expect(def.solve({ c: 12.1 }).notes?.[1]).toContain('不比 subtractive 大')
    // 邊界 0 與 63 都合法（不 overload）
    expect(def.validate?.({ c: 0 })).toBeNull()
    expect(def.validate?.({ c: 63 })).toBeNull()
  })

  it('T11: HC-PR.8 的預設值是 T11（μ_W = 0.25 ⇒ μ = 0.5、ρ = 0.99）：|p|slow = 0.995、N95 = 598（= golden、eigenExample、§5 實驗的第一個 preset）', () => {
    const def = handcalc('HC-PR.8')
    const v = defaultValues(def)
    const T11 = vec('T11')
    const [mu, pSlow, n95] = values(def, v)
    expect(mu).toBe(T11.inputs.mu)
    close(pSlow, T11.expected.slow_pole as number, 1e-12)
    expect(n95).toBe(T11.expected.blocks_95)
    expect(n95).toBe(eigenExample(v.rho, mu, 0.5, v.Px).stepsSlow)
    const lab = analyzeLab(parseLabParams(LOCAL_PRESETS[0].params as Record<string, unknown>))
    expect(lab.s).toBe(mu)
    expect(lab.stepsSlow).toBe(n95)
    close(lab.radiusSlow, pSlow, 1e-12)
    const texts = def
      .solve(v)
      .steps.map((s) => s.tex)
      .join('\n')
    expect(texts).toContain(String.raw`\lceil 597.65\rceil = 598`)
    expect(texts).toContain('1-0.005 = 0.995')
    close(Number(/\\lceil ([\d.]+)\\rceil/.exec(texts)?.[1]), T11.expected.blocks_95_real as number, 1e-4)
    // ρ < 0：只看 |ρ|
    expect(values(def, withDefaults(def, { rho: -0.99 }))).toEqual([mu, pSlow, n95])
    // 步長太大時最慢的是 λ_max 的 mode（過衝）：μ_W = 0.6、ρ = 0.5 ⇒ p₁ = −0.8、p₂ = 0.4 ⇒ N95 = ⌈ln0.05/ln0.8⌉ = 14
    const over = def.solve({ muW: 0.6, rho: 0.5, Px: 1 })
    close(over.results[1].value, 0.8, 1e-12)
    expect(over.results[2].value).toBe(14)
    expect(over.steps[5].why).toContain('過衝')
    // 直接迭代 2×2 的 (I − μR)，沿 λ_max 的特徵向量 [1, 1]：第 14 步才降到 5% 以下
    let d0 = 1
    let d1 = 1
    let steps = 0
    while (Math.hypot(d0, d1) > 0.05 * Math.SQRT2) {
      const n0 = d0 - 1.2 * (d0 + 0.5 * d1)
      const n1 = d1 - 1.2 * (0.5 * d0 + d1)
      d0 = n0
      d1 = n1
      steps++
    }
    expect(steps).toBe(14)
    // 兩個 mode 都一步歸零（μλ = 1、ρ = 0）
    const dead = def.solve({ muW: 0.5, rho: 0, Px: 1 })
    expect(dead.results.map((r) => r.value)).toEqual([1, 0, 1])
    expect(dead.steps[dead.steps.length - 1].why).toContain('一步歸零')
  })
})

describe('Papers 頁的帶入手算：隨機 20 題與獨立重算一致', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：randomValues(seed 1…20) 都通過 validate、答案有限，且等於測試裡直接重寫（或數值求解）的結果', (_id, def) => {
    const seen = new Set<string>()
    const rel = REL[def.id] ?? 1e-9
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, JSON.stringify(v)).toBeNull()
      def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${i.key}=${v[i.key]}`).toBeNull())
      const sol = def.solve(v)
      const expected = INDEP[def.id](v)
      expect(sol.results).toHaveLength(expected.length)
      sol.results.forEach((r, k) => {
        expect(Number.isFinite(r.value), `${r.symbol} @ ${JSON.stringify(v)}`).toBe(true)
        close(r.value, expected[k], rel, 1e-10, `${def.id} ${r.symbol} @ ${JSON.stringify(v)}`)
      })
      // 每一步都是「符號式 = 代入數字 = 結果」，而且有一句說明；字串中的 $ 成對；不會把 NaN／∞ 印進公式
      expect(sol.steps.length).toBeGreaterThanOrEqual(5)
      for (const s of sol.steps) {
        expect((s.tex.match(/=/g) ?? []).length, s.tex).toBeGreaterThanOrEqual(2)
        expect(s.tex, def.id).not.toMatch(/NaN|undefined|Infinity|\\infty/)
        expect(renderTex(s.tex, true), s.tex).not.toMatch(/katex-error|c-tex-error/)
        expect(s.why.length).toBeGreaterThan(0)
        expect(unpaired(s.why), s.why).toBe(false)
      }
      for (const note of sol.notes ?? []) {
        expect(unpaired(note), note).toBe(false)
        expect(note).not.toMatch(/NaN|undefined|Infinity/)
      }
    }
    // 「換一題」真的會換數字（HC-PR.7 只有一個輸入、7 個選項）
    expect(seen.size, def.id).toBeGreaterThanOrEqual(def.id === 'HC-PR.7' ? 5 : 10)
  })

  it('practice 範圍內的「每一種」組合都合法、答案有限（不必靠重抽才抽到合法的題目），而且與獨立重算一致', () => {
    let total = 0
    for (const def of HANDCALCS) {
      const grid = practiceGrid(def)
      expect(grid.length, def.id).toBeGreaterThanOrEqual(7)
      // 抽樣做完整比對（格點很多的題目每隔幾個取一個），其餘只檢查 validate 與有限性
      const stride = Math.max(1, Math.floor(grid.length / 400))
      grid.forEach((v, idx) => {
        expect(def.validate?.(v) ?? null, `${def.id} ${JSON.stringify(v)}`).toBeNull()
        def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${def.id}.${i.key}=${v[i.key]}`).toBeNull())
        if (idx % stride !== 0) return
        const got = values(def, v)
        const want = INDEP[def.id](v)
        got.forEach((x, k) => close(x, want[k], REL[def.id] ?? 1e-9, 1e-10, `${def.id}[${k}] @ ${JSON.stringify(v)}`))
        total++
      })
    }
    expect(total).toBeGreaterThan(500)
  }, 120000)
})

describe('Papers 頁的帶入手算：畫面上的算式自己就算得出下一個等號', () => {
  it('evalTex：本頁手算題用到的 TeX 寫法都能求值；含符號的片段回傳 null', () => {
    expect(evalTex(String.raw`2\times0.05`)).toBeCloseTo(0.1, 15)
    expect(evalTex(String.raw`6 - 1\times2`)).toBe(4)
    expect(evalTex(String.raw`\frac{0.4\times4}{4}`)).toBeCloseTo(0.4, 15)
    expect(evalTex(String.raw`(-0.4)^2`)).toBeCloseTo(0.16, 15)
    expect(evalTex(String.raw`\sin(18^\circ)`)).toBeCloseTo(0.30901699, 8)
    expect(evalTex(String.raw`\arcsin\frac{0.7}{2}`)).toBeCloseTo(20.487315, 5)
    expect(evalTex(String.raw`\frac{180^\circ}{4\times2+2}`)).toBe(18)
    expect(evalTex(String.raw`\sqrt{1 + 6.16838\times10^{-5}}`)).toBeCloseTo(1.0000308, 7)
    expect(evalTex(String.raw`\left\lceil\frac{-2.9957}{-0.0050125}\right\rceil`)).toBe(598)
    expect(evalTex(String.raw`\lfloor 32.4+0.5\rfloor`)).toBe(32)
    expect(evalTex(String.raw`\ln(0.995)`)).toBeCloseTo(-0.0050125, 7)
    expect(evalTex(String.raw`\max(0.005,\ 0.995)`)).toBe(0.995)
    expect(evalTex(String.raw` 250.66\ \mathrm{fs}`)).toBe(250.66)
    expect(evalTex(String.raw` 0.0079788\ \mathrm{fs^{-1}}`)).toBe(0.0079788)
    expect(evalTex(String.raw` 1\ \checkmark`)).toBe(1)
    expect(evalTex(String.raw`\mu\,\lambda_{\max}`)).toBeNull()
    expect(evalTex(String.raw`2\sin\theta^*`)).toBeNull()
    expect(evalTex(String.raw`y[0]-y_{\mathrm{floor}}[0]`)).toBeNull()
    // 抓得到錯：故意寫錯的算式
    expect(() => checkStepArithmetic(String.raw`p = 1 - g = 1 - 0.4 = 0.7`, 'bad')).toThrow()
    expect(checkStepArithmetic(String.raw`p = 1 - g = 1 - 0.4 = 0.6`, 'ok')).toBe(1)
  })

  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值、20 組隨機數字與 practice 格點（抽樣）——每一步的每個等號都成立，而且每一步至少有一個可以驗算的等號', (_id, def) => {
    const grid = practiceGrid(def)
    const stride = Math.max(1, Math.floor(grid.length / 120))
    const cases = [defaultValues(def), ...Array.from({ length: 20 }, (_, k) => randomValues(def, k + 1)), ...grid.filter((_, idx) => idx % stride === 0), ...(OWN_NUMBERS[def.id] ?? [])]
    for (const v of OWN_NUMBERS[def.id] ?? []) {
      expect(def.validate?.(v) ?? null, `${def.id} ${JSON.stringify(v)}`).toBeNull()
      def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${def.id}.${i.key}=${v[i.key]}`).toBeNull())
    }
    let total = 0
    for (const v of cases) {
      const sol = def.solve(v)
      for (const t of [...sol.steps.flatMap((s) => [s.tex, s.why]), ...(sol.notes ?? [])]) {
        expect(t, `${def.id} @ ${JSON.stringify(v)}`).not.toMatch(/NaN|undefined|Infinity|\\infty/)
        // 畫面上不出現 double 的捨入殘渣：沒有任何數字寫到 14 位以上的有效數字（0.010000000000000009、0.000999999999997669 這一類）
        for (const lit of t.match(/\d+\.\d+/g) ?? []) {
          const sig = lit.replace('.', '').replace(/^0+/, '').length
          expect(sig, `${def.id} @ ${JSON.stringify(v)}：${lit}（${t}）`).toBeLessThan(14)
        }
      }
      for (const r of sol.results) expect(Number.isFinite(r.value), `${def.id} ${r.symbol} @ ${JSON.stringify(v)}`).toBe(true)
      sol.steps.forEach((s, k) => {
        const n = checkStepArithmetic(s.tex, `${def.id} 第 ${k + 1} 步 @ ${JSON.stringify(v)}`)
        // 唯一沒有數字等號的一步：HC-PR.8 兩個 mode 都一步歸零時的「|p| = 0 ⇒ N = 1」
        if (!s.tex.includes(String.raw`\Longrightarrow`)) expect(n, `${def.id} 第 ${k + 1} 步沒有可驗算的等號：${s.tex}`).toBeGreaterThanOrEqual(1)
        total += n
      })
      // 最後答案也出現在步驟裡：每個 result 的值（5 位有效數字）至少和某一步最後一個等號的右邊相同
      for (const r of sol.results) {
        const hit = sol.steps.some((s) =>
          chains(s.tex).some((segs) => {
            const last = evalTex(segs[segs.length - 1]) ?? (segs.length >= 2 ? evalTex(segs[segs.length - 2]) : null)
            return last !== null && Math.abs(last - r.value) <= 3e-4 * Math.abs(r.value) + 1e-9
          }),
        )
        expect(hit, `${def.id} 的答案 ${r.symbol} = ${r.value} 沒有出現在任何一步的結尾 @ ${JSON.stringify(v)}`).toBe(true)
      }
    }
    // 題目最少的 HC-PR.1 每組數字也有 5 個可驗算的等號
    expect(total).toBeGreaterThanOrEqual(cases.length * 5)
  })
})

describe('Papers 頁的帶入手算：讀者自己的數字', () => {
  it('相減的結果不顯示 double 的殘渣：63 − 62.999 = 0.001、1 − 0.999999 = 10⁻⁶、0.448 − 0.7×0.64 = 0', () => {
    const p7 = handcalc('HC-PR.7').solve({ c: 62.999 })
    expect(p7.steps[3].tex).toContain('63 - 62.999 = 0.001')
    expect(p7.steps[4].tex).toContain(String.raw`0.001^2 = 10^{-6}`)
    expect(p7.steps[5].tex).toContain(String.raw`0.999\times0.001 = 0.000999`)
    const p8 = handcalc('HC-PR.8').solve({ muW: 0.25, rho: 0.999999, Px: 1 })
    expect(p8.steps[2].tex).toContain(String.raw`1\times(1-0.999999) = 1\times10^{-6} = 10^{-6}`)
    expect(p8.results[2].value).toBe(Math.ceil(Math.log(0.05) / Math.log(1 - 0.5 * (1 - 0.999999))))
    expect(p8.notes?.[0]).toContain(String.raw`=1.999999\times10^{6}$`) // λ_max/λ_min = 1.999999/10⁻⁶
    // 不整齊的比值不會被顯示成 12 位小數
    expect(handcalc('HC-PR.8').solve({ muW: 0.137, rho: -0.731, Px: 2.4 }).notes?.[0]).toContain('=6.4349$')
    const p2 = handcalc('HC-PR.2').solve({ w: 0.448 / 0.64, x: 0.64, y: 0.448, muT: 1, eps: 0 })
    expect(p2.results.map((r) => r.value)).toEqual([0.448 / 0.64, 0, 0])
    expect(p2.steps[0].tex).toContain('0.448 - 0.448 = 0')
  })

  it('HC-PR.4：f_BW 接近 Nyquist 時讀法 (b) 的 p_E 沒有 −3 dB 點——備註說明原因，不印出 NaN；兩種讀法的比值小於 1', () => {
    const def = handcalc('HC-PR.4')
    const sol = def.solve({ B: 499, fu: 1000 })
    expect(sol.notes?.[0]).toContain('點不存在')
    expect(sol.notes?.[0]).toContain('E27')
    expect(sol.notes?.join(' ')).not.toMatch(/NaN/)
    expect(sol.results[3].value).toBeLessThan(1)
    close(sol.results[0].value, 3 - 2 * Math.SQRT2, 1e-4) // p → 3 − 2√2
    expect(Number.isNaN(calBandwidths(1 - sol.results[2].value, 1000).f3dbExact)).toBe(true)
    // 很小的 f_BW：p 很接近 1，畫面自動多顯示幾位，1 − p 才對得起來
    const tiny = def.solve({ B: 1e-6, fu: 1 })
    expect(tiny.steps[7].tex).toContain(String.raw`1 - 0.99999371683 = 6.2832\times10^{-6}`)
  })
})

describe('Papers 頁的帶入手算：validate 擋下模型不適用的輸入並解釋原因', () => {
  it.each(INVALID.map((c) => [`${c.id} ${c.name}`, c] as const))('%s', (_name, c) => {
    const def = handcalc(c.id)
    const v = { ...defaultValues(def), ...c.patch }
    // 這些值都在輸入欄的合法範圍內：擋下它們的是 validate（有解釋），不是「不可小於 0」
    def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${c.id}.${i.key}=${v[i.key]}`).toBeNull())
    const msg = def.validate?.(v)
    expect(msg, c.name).toBeTruthy()
    expect(msg!).toMatch(c.expect)
    expect(msg!.length).toBeGreaterThan(20) // 是解釋，不是只有「不合法」
    expect(unpaired(msg!), msg!).toBe(false)
  })

  it('不合法的輸入在畫面上顯示原因（KaTeX 排版、沒有殘留的 $），不顯示任何步驟或答案', () => {
    for (const c of INVALID) {
      const def = handcalc(c.id)
      const { container, unmount } = render(<HandCalc def={withValues(def, { ...defaultValues(def), ...c.patch })} />)
      const warn = container.querySelector('.callout-warn')
      expect(warn, `${c.id} ${c.name}`).toBeTruthy()
      expect(warn!.querySelector('.katex'), `${c.id} ${c.name}`).toBeTruthy()
      expect(proseText(warn!)).not.toContain('$')
      expectNoTexErrors(container, `${c.id} ${c.name}`)
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      expect(container.querySelector('.c-handcalc-results')).toBeNull()
      unmount()
    }
  })

  it('輸入欄的合法範圍：dither bit 只能是 0 或 1、延遲與 N 必須是整數、ρ 不超過 ±1', () => {
    const byKey = (id: string, key: string) => handcalc(id).inputs.find((i) => i.key === key)!
    expect(inputError(byKey('HC-PR.6', 'b0'), 2)).toBeTruthy()
    expect(inputError(byKey('HC-PR.6', 'b2'), 0.5)).toBeTruthy()
    expect(inputError(byKey('HC-PR.6', 'b3'), -1)).toBeTruthy()
    expect(inputError(byKey('HC-PR.5', 'd'), 1.5)).toBeTruthy()
    expect(inputError(byKey('HC-PR.5', 'd'), 7)).toBeTruthy()
    expect(inputError(byKey('HC-PR.3', 'N'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-PR.3', 'N'), 100.5)).toBeTruthy()
    expect(inputError(byKey('HC-PR.3', 'sigmaV'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-PR.8', 'rho'), 1.01)).toBeTruthy()
    expect(inputError(byKey('HC-PR.2', 'eps'), -1)).toBeTruthy()
    // 發散但模型仍適用的輸入不擋：HC-PR.1 的 μ_W 超過上限 ⇒ 照算，p < −1
    expect(handcalc('HC-PR.1').validate?.({ muW: 0.3, lmax: 4 })).toBeNull()
    expect(values(handcalc('HC-PR.1'), { muW: 0.3, lmax: 4 })[1]).toBeLessThan(-1)
    // HC-PR.3 的 s ≥ 2：照算並在備註說明
    expect(handcalc('HC-PR.3').validate?.({ sigmaV: 1, mu: 5, N: 16 })).toBeNull()
    expect(handcalc('HC-PR.3').solve({ sigmaV: 1, mu: 5, N: 16 }).notes?.[0]).toContain('不收斂')
  })
})

describe('Papers 頁的帶入手算：渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值與 6 組隨機數字都能渲染，沒有 .katex-error、沒有殘留的 $，步驟數與 solve() 相同', (_id, def) => {
    const cases = [defaultValues(def), ...[1, 2, 3, 4, 5, 6].map((seed) => randomValues(def, seed))]
    for (const v of cases) {
      const sol = def.solve(v)
      const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
      expectNoTexErrors(container, JSON.stringify(v))
      expectNoTexErrors(container)
      expect(container.querySelector('.callout-warn'), JSON.stringify(v)).toBeNull()
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
      expect(proseText(container), JSON.stringify(v)).not.toContain('$')
      expect(proseText(container)).not.toMatch(/NaN|undefined|\[object/)
      unmount()
    }
  })

  it('標題、提示、備註與步驟說明裡的 $…$ 都能被 KaTeX 排版（沒有 .katex-error）', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const strings = [def.title, ...(def.tips ?? []), ...sol.steps.map((s) => s.why), ...(sol.notes ?? []), ...sol.results.map((x) => x.label ?? ''), ...def.inputs.map((i) => i.label)]
      const { container, unmount } = render(
        <div>
          {strings.map((t, i) => (
            <p key={i}>
              <MathText>{t}</MathText>
            </p>
          ))}
        </div>,
      )
      expectNoTexErrors(container, def.id)
      expect(proseText(container), def.id).not.toContain('$')
      // 數學一律 LaTeX：說明文字不以 Unicode 拼公式
      expect(proseText(container), def.id).not.toMatch(/[α-ωΑ-Ω²³⁻¹₀-₉√≈≤≥∞‖⇒⇔∝½]/)
      unmount()
    }
  })

  it('自己算算看：把 solve() 的答案四捨五入到 4 位有效數字填回去，每一格都判定正確；整數答案差 1 判定錯誤', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} initialMode="practice" />)
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      const view = within(container)
      const inputs = view.getAllByPlaceholderText('你的答案') as HTMLInputElement[]
      expect(inputs).toHaveLength(sol.results.length)
      inputs.forEach((el, k) => {
        const v = sol.results[k].value
        fireEvent.change(el, { target: { value: Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))) } })
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
    // HC-PR.6 的 code 總和是整數：差 1 就是錯（不適用預設的 1% 相對容差）
    const sums = handcalc('HC-PR.6').solve(defaultValues(handcalc('HC-PR.6'))).results
    expect(checkAnswer(130, sums[0]).ok).toBe(true)
    expect(checkAnswer(131, sums[0]).ok).toBe(false)
    expect(checkAnswer(129, sums[0]).ok).toBe(false)
    // HC-PR.8 的步數容許 ±1 或 2%（ln 的四捨五入）
    const n95 = handcalc('HC-PR.8').solve(defaultValues(handcalc('HC-PR.8'))).results[2]
    expect(checkAnswer(600, n95).ok).toBe(true)
    expect(checkAnswer(650, n95).ok).toBe(false)
  })

  it('改輸入會即時重新帶入：HC-PR.5 把 d 改成 0 ⇒ g*(0) = 2、顯示「平均誤差收斂」；把 μ_W 改成 1.2 ⇒ 顯示原因', () => {
    const def = handcalc('HC-PR.5')
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(proseText(container)).toContain('仍然不收斂')
    const view = within(container)
    fireEvent.change(view.getByLabelText(/更新延遲/), { target: { value: '0' } })
    expect(proseText(container)).toContain('平均誤差收斂')
    expect(container.querySelectorAll('.c-step').length).toBe(def.solve({ muW: 0.35, lmax: 1, d: 0 }).steps.length)
    fireEvent.change(view.getByLabelText(/書上的步長/), { target: { value: '1.2' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(proseText(container.querySelector('.callout-warn')!)).toContain('沒有定義')
    expectNoTexErrors(container)
    unmount()
  })
})
