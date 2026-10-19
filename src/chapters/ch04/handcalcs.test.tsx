import { readFileSync } from 'node:fs'
import { expectNoTexErrors } from '@/test/katex'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { HandCalc, defaultValues, inputError, randomValues, renderTex, texNum } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import {
  accumulatorBitsRequired,
  accumulatorSizing,
  bugFixedPointGaussian,
  bugMeanGmac,
  gmacAverage,
  gmacSum,
  roundingMeanError,
  shiftRound,
  sumAverageTable,
  wrapTwos,
} from '@/simulation/models/gmac'
import { FORMULAS } from './formulas'
import { HANDCALCS, HC_CYCLES, datapathAnalytic, handcalc } from './handcalcs'
import { criticalGain } from './latency'
import { firstOrderAccumulator, residueSignals } from './residue'
import { defaultBiasNumbers, wTruncNumbers } from './sections/FixedPoint'
import { HAND_GMAC, handGmac } from './sections/GmacMath'

interface Vector {
  inputs: Record<string, number>
  expected: Record<string, number>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

function golden(name: string): Vector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as Vector
}

function expectGolden(v: Vector, key: string, actual: number): void {
  const tol = v.tolerance_overrides?.[key] ?? v.tolerance
  const e = v.expected[key]
  expect(Math.abs(actual - e), key).toBeLessThanOrEqual((tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e))
}

const T04 = golden('T04')
const T13 = golden('T13')
const NEG = golden('negative_tests')

/** 以預設值求解，回傳各 result 的數值（依 results 的順序） */
function solveDefault(id: string): { def: HandCalcDef; v: Record<string, number>; sol: HandCalcSolution; vals: number[] } {
  const def = handcalc(id)
  const v = defaultValues(def)
  const sol = def.solve(v)
  return { def, v, sol, vals: sol.results.map((r) => r.value) }
}

/** 相對 1e-9（或絕對 1e-12）內相等 */
function expectSame(actual: number, expected: number, label: string): void {
  expect(Number.isFinite(actual), `${label} 有限`).toBe(true)
  expect(Math.abs(actual - expected), `${label}：${actual} vs ${expected}`).toBeLessThanOrEqual(1e-12 + 1e-9 * Math.abs(expected))
}

const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 字串裡每一段 $...$ 都能被 KaTeX 解析 */
function expectInlineMathOk(text: string, label: string): void {
  for (const m of text.matchAll(INLINE)) expect(renderTex(m[1], false), `${label}：${m[1]}`).not.toMatch(/katex-error|c-tex-error/)
  // 沒有落單的 $（成對之後不應再剩下未跳脫的 $）
  const plain = text.replace(INLINE, '').replace(/\\\$/g, '')
  expect(plain, `${label}：落單的 $`).not.toContain('$')
  // TeX 指令（例如 texNum 產生的 \times10^{-5}）不可以落在 $...$ 之外，否則會原樣顯示
  expect(plain, `${label}：$...$ 之外的 TeX`).not.toMatch(/\\[A-Za-z]|\^\{|_\{/)
}

function expectSolutionTexOk(sol: HandCalcSolution, label: string): void {
  expect(sol.steps.length, label).toBeGreaterThan(0)
  for (const s of sol.steps) {
    expect(renderTex(s.tex, true), `${label} step：${s.tex}`).not.toMatch(/katex-error|c-tex-error/)
    expect(s.tex, `${label} step 不可含 NaN／undefined`).not.toMatch(/NaN|undefined|Infinity/)
    expectInlineMathOk(s.why, `${label} why`)
  }
  for (const r of sol.results) {
    expect(renderTex(`${r.symbol}=1${r.unit ? `\\ ${r.unit}` : ''}`, true), `${label} result：${r.symbol}`).not.toMatch(/katex-error|c-tex-error/)
    if (r.label) expectInlineMathOk(r.label, `${label} result label`)
  }
  for (const n of sol.notes ?? []) expectInlineMathOk(n, `${label} note`)
}

// ───────────────────────────────────────────────────────────────────────────
// 獨立重算：直接照公式寫，不呼叫 gmac.ts / residue.ts / latency.ts（只用 Math）
// ───────────────────────────────────────────────────────────────────────────

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)

/** Φ(z) 的級數：Φ(z) = ½ + φ(z)·Σ_{k≥0} z^{2k+1}/(1·3·5⋯(2k+1))（與 core 的 normCdf 無關的實作） */
function phiSeries(z: number): number {
  let term = z
  let sum = z
  for (let k = 1; k < 200; k++) {
    term *= (z * z) / (2 * k + 1)
    sum += term
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break
  }
  return 0.5 + (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) * sum
}

/** round-half-even（獨立實作） */
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const frac = x - f
  if (frac < 0.5) return f
  if (frac > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-04.1': ({ KF, B, fvco, eps }) => {
    const M = 2 ** B
    const s = Array.from({ length: HC_CYCLES }, (_, n) => ((n + 1) * KF) % M) // 零初值：s[n] = (n+1)K_F mod M
    const sMax = Math.max(...s)
    const tau = (sMax / M) * (1e6 / fvco)
    return [s[HC_CYCLES - 1], -s[HC_CYCLES - 1] / M, tau, (eps / 100) * tau]
  },
  'HC-04.2': ({ a, w, mu, x0, x1, x2, x3, v0, v1, v2, v3 }) => {
    const x = [x0, x1, x2, x3]
    const v = [v0, v1, v2, v3]
    let S = 0
    for (let n = 0; n < 4; n++) S += ((a - w) * x[n] + v[n] >= 0 ? 1 : -1) * x[n]
    return [S, S / 4, w + (mu * S) / 4, w + mu * S]
  },
  'HC-04.3': ({ mu, sigmaV, C, N, N2 }) => {
    const Kq = SQRT_2_OVER_PI / sigmaV
    const g = mu * Kq * C
    return [Kq, g, 1 - g, N * g, 1 - N * g, N2 * g]
  },
  'HC-04.4': ({ b0, b1, b2, b3, x0, x1, x2, x3 }) => {
    const b = [b0, b1, b2, b3]
    const x = [x0, x1, x2, x3]
    const G = x.reduce((acc, xi, n) => acc + (2 * b[n] - 1) * xi, 0) / 4
    const xbar = x.reduce((acc, xi) => acc + xi, 0) / 4
    return [G, 0.5 * G + 0.5 * xbar, xbar] // G_bug 用恆等式 ½G + ½x̄ 算（solve 是直接累加 b·x）
  },
  'HC-04.5': ({ mx, sx, sigmaV, a, xi }) => {
    const xiLin = -mx / (SQRT_2_OVER_PI * (mx * mx + sx * sx))
    const gamma = Math.sqrt(1 + xi * xi * sx * sx)
    const z = (xi * mx) / gamma
    const h = mx * phiSeries(z) + (sx * sx * xi * Math.exp((-z * z) / 2)) / Math.sqrt(2 * Math.PI) / gamma
    return [xiLin, a - xiLin * sigmaV, h, a - xi * sigmaV]
  },
  'HC-04.6': ({ bx, N, full, Btry }) => {
    const Mx = full === 1 ? 2 ** (bx - 1) : 2 ** (bx - 1) - 1
    const worst = N * Mx
    let A = 1
    while (2 ** (A - 1) - 1 < worst) A++ // 最少的有號位元數：正端上限 2^{A−1} − 1 ≥ N·M_x
    let ceilLogN = 0
    while (2 ** ceilLogN < N) ceilLogN++
    const span = 2 ** Btry
    const wrapped = ((((worst + span / 2) % span) + span) % span) - span / 2
    return [worst, A, bx + ceilLogN, wrapped]
  },
  'HC-04.7': ({ S, m, FG, bx, K }) => {
    const ell = m - FG
    const eps = -(1 - 2 ** -ell) / 2
    const deltaG = 2 ** -FG / 2 ** (bx - 1)
    return [Math.floor(S / 2 ** ell), roundHalfEven(S / 2 ** ell), eps, (-eps * deltaG) / K]
  },
  // §5b：DTC 的範圍、LSB、量化抖動與 T_0 預算（只用 Math，不呼叫 dtc.ts）
  'HC-04.9': ({ tvco, eps, inl, hpct, B, sigmaV }) => {
    const tFs = tvco * 1000
    const h = (hpct / 100) * tFs
    const R = tFs * (1 + eps / 100) + inl + 2 * h
    const lsb = R / (2 ** B - 1)
    const sq = lsb / Math.sqrt(12)
    return [R, lsb, sq, sigmaV / Math.sqrt(sigmaV * sigmaV + sq * sq)]
  },
  'HC-04.10': ({ t0, lsb, B, w, x }) => {
    const want = t0 - w * x
    const code = Math.min(Math.max(Math.floor(want / lsb + 0.5), 0), 2 ** B - 1)
    const saturated = code !== Math.floor(want / lsb + 0.5)
    return [code, code * lsb - want, saturated ? 0 : -x]
  },
  'HC-04.8': ({ sigmaV, mu, bx, m, FG, lW, d }) => {
    const Mx = 2 ** (bx - 1) - 1
    const Ex2 = (Mx * (Mx + 1)) / 3 / 4 ** (bx - 1)
    const K = (SQRT_2_OVER_PI / sigmaV) * Ex2
    const g = mu * K
    const ell = m - FG
    const deltaG = 2 ** -FG / 2 ** (bx - 1)
    const biasG = (-(1 - 2 ** -ell) / 2) * (deltaG / K)
    const deltaW = 2 ** lW * mu * deltaG
    const biasW = ((-(1 - 2 ** -lW) / 2) * deltaW) / g
    return [K, g, 2 * Math.sin(Math.PI / (4 * d + 2)), bx + m, biasG, biasW, biasG + biasW]
  },
}

// ───────────────────────────────────────────────────────────────────────────

describe('Ch04 手算題：結構', () => {
  it('HC-04.1 … HC-04.10：id 唯一、依頁面順序（§5b 的 HC-04.9／10 在綜合題 HC-04.8 之前）、頁面 /ch/04、公式 ID 都登錄在 FORMULAS、三種難度都有', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-04.1', 'HC-04.2', 'HC-04.3', 'HC-04.4', 'HC-04.5', 'HC-04.6', 'HC-04.7', 'HC-04.9', 'HC-04.10', 'HC-04.8'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/04')
      expect(h.formulaId && formulaIds.has(h.formulaId), `${h.id} 的 formulaId`).toBe(true)
      expect(renderTex(h.formulaTex, true), h.id).not.toMatch(/katex-error|c-tex-error/)
      expect(h.tips?.length ?? 0, `${h.id} 要有手算提示`).toBeGreaterThan(0)
      expect(Object.keys(INDEPENDENT)).toContain(h.id)
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    expect(() => handcalc('HC-04.99')).toThrow(/找不到/)
  })

  it('通式比桌機欄寬長的三題（HC-04.1、HC-04.2、HC-04.8）排成對齊的兩行：把換行拿掉後和原本的一行逐字相同；HC-04.4 第 1 步四拍排成兩行', () => {
    // 把 aligned 的換行換回原本分隔兩段的 \qquad、拿掉對齊記號，應該得到原本的一行（沒有少項、沒有改符號）
    const oneLine = (tex: string): string =>
      tex
        .replace(String.raw`\begin{aligned}`, '')
        .replace(String.raw`\end{aligned}`, '')
        .replace(/\\\\(\[\d+pt\])?/g, String.raw`\qquad `)
        .replace(/&/g, '')
    const norm = (tex: string): string => tex.replace(/\\qquad\s*/g, String.raw`\qquad `) // \qquad 後面有沒有空白不影響排版
    const original: Record<string, string> = {
      'HC-04.1': String.raw`t[n]=s[n-1]+K_\mathrm{F},\quad s[n]=t[n]-M\,y[n];\qquad r[n]=\sum_{m=0}^{n}\Bigl(y[m]-\frac{K_\mathrm{F}}{M}\Bigr)=-\frac{s[n]}{M};\qquad\tau_\mathrm{need}[n]=\frac{s[n]}{M}\,T_\mathrm{vco},\quad e_\mathrm{det}[n]=(a-w)\,x[n]`,
      'HC-04.2': String.raw`e[n]=\delta\,x[n]+v[n],\quad b[n]=\bigl[e[n]\ge0\bigr],\quad q[n]=2b[n]-1;\qquad S=\sum_{n=0}^{N-1}q[n]\,x[n],\quad G=\frac{S}{N};\qquad w_\mathrm{avg}=w+\mu G,\quad w_\mathrm{sum}=w+\mu S`,
      'HC-04.8': String.raw`E[x^2]=\frac{M_x(M_x+1)}{3\cdot4^{B_x-1}},\quad K=\frac{\sqrt{2/\pi}}{\sigma_v}E[x^2],\quad g=\mu K<g_\mathrm{crit}(d)=2\sin\frac{\pi}{4d+2};\qquad w^*-a=\frac{\bar\varepsilon\,\Delta_G}{K}+\frac{\bar\varepsilon_W\Delta_W}{g}`,
    }
    for (const [id, tex] of Object.entries(original)) {
      const now = handcalc(id).formulaTex
      expect(now.startsWith(String.raw`\begin{aligned}&`), id).toBe(true)
      expect((now.match(/\\\\/g) ?? []).length, `${id} 的行數`).toBe(1) // 兩行
      expect(norm(oneLine(now)), id).toBe(norm(tex))
    }
    // HC-04.4 第 1 步：四拍的 q[n] 每行兩拍（預設值與「全部是 0」的最寬情形）
    const bitCases: Record<string, number>[] = [{}, { b0: 0, b1: 0, b2: 0, b3: 0 }]
    for (const bits of bitCases) {
      const def = handcalc('HC-04.4')
      const step = def.solve({ ...defaultValues(def), ...bits }).steps[0].tex
      expect(step.startsWith(String.raw`\begin{aligned}q[n]=2b[n]-1:\quad&q[0]=`)).toBe(true)
      expect(step).toContain(String.raw`,\;\\&q[2]=`)
      expect((step.match(/q\[\d\]=2\\times[01]-1=-?1/g) ?? []).length).toBe(4)
      expect(renderTex(step, true)).not.toMatch(/katex-error|c-tex-error/)
    }
  })

  it('每個輸入：預設值在合法範圍內、有「換一題」的 practice 範圍；預設值通過 validate', () => {
    for (const h of HANDCALCS) {
      const v = defaultValues(h)
      for (const i of h.inputs) {
        expect(inputError(i, i.default), `${h.id}.${i.key}`).toBeNull()
        expect(i.practice, `${h.id}.${i.key} practice`).toBeTruthy()
        for (const c of i.practice?.choices ?? []) expect(inputError(i, c), `${h.id}.${i.key} choice ${c}`).toBeNull()
        expect(renderTex(i.symbol, false), `${h.id}.${i.key} symbol`).not.toMatch(/katex-error|c-tex-error/)
        if (i.unit) expect(renderTex(i.unit, false), `${h.id}.${i.key} unit`).not.toMatch(/katex-error|c-tex-error/)
        expectInlineMathOk(i.label, `${h.id}.${i.key} label`)
      }
      expect(h.validate?.(v) ?? null, h.id).toBeNull()
      expectInlineMathOk(h.title, `${h.id} title`)
      for (const t of h.tips ?? []) expectInlineMathOk(t, `${h.id} tip`)
    }
  })
})

describe('Ch04 手算題：(a) 預設值 = 模型函式、文中 worked example、golden', () => {
  it('HC-04.1：§2 手算表（K_F = 5、M = 16）的 s[4] = 9、r[4] = −0.5625；1% gain 誤差的最大殘差 721.15 fs', () => {
    const { vals, sol } = solveDefault('HC-04.1')
    const rows = firstOrderAccumulator(5, 4, HC_CYCLES)
    expect(rows.map((r) => r.s)).toEqual([5, 10, 15, 4, 9]) // §2 表格的前 5 列
    expect(vals[0]).toBe(rows[4].s)
    expect(vals[1]).toBe(rows[4].residue)
    expect(vals[1]).toBe(-0.5625)
    expect(rows[4].cumErr).toBeCloseTo(rows[4].residue, 14) // telescoping
    // 與 §2 文字、preset gmac-residue-hand-example 相同的數字（64 拍的最大值就出現在前 5 拍的 s = 15）
    const sig64 = residueSignals({ kind: 'first_order', frac: 5 / 16, bits: 4, length: 64, gainErrPct: 1, fvcoGHz: 13 })
    expect(vals[2]).toBe(Math.max(...sig64.dtcNeedFs))
    expect(vals[3]).toBe(sig64.residualFs.reduce((a, x) => Math.max(a, Math.abs(x)), 0))
    expect(vals[2]).toBeCloseTo(72115.38, 2)
    expect(vals[3]).toBeCloseTo(721.15, 2)
    // 每一拍一個步驟 + M、carry 數、兩種 r、s_max、x、T_vco、τ、e
    expect(sol.steps.length).toBe(1 + HC_CYCLES + 8)
    // 架構（全站約定，docs/assumptions.md §2a）：72115.38 fs 是「需要的補償量」τ_need——feedback edge 早到多少，reference 端的 DTC 就把 reference edge 提前多少
    // （從基準延遲 T_0 少延遲這麼多）；它不是 DTC 加上去的延遲。數字與原來相同，只有符號與說明改了
    const tauStep = sol.steps[1 + HC_CYCLES + 6]
    expect(tauStep.tex).toMatch(/^\\tau_\\mathrm\{need\}\^\{\\max\}=x\[2\]\\,T_\\mathrm\{vco\}=/)
    expect(tauStep.why).toContain('feedback（divider）edge 早到')
    expect(tauStep.why).toContain('reference 端的 DTC')
    expect(tauStep.why).toContain('基準延遲 $T_0$')
    expect(sol.steps[1 + HC_CYCLES + 7].tex).toContain(String.raw`=\varepsilon\,\tau_\mathrm{need}^{\max}=`)
    expect(sol.results[2].symbol).toBe(String.raw`\tau_\mathrm{need}^{\max}`)
    expect(sol.results[2].label).toContain('需要的補償量')
    expect(handcalc('HC-04.1').title).toBe('一階 DSM 累加器走 5 拍：residue、DTC 需要的補償量、gain 誤差的殘差')
    expect(handcalc('HC-04.1').formulaTex).toContain(String.raw`\tau_\mathrm{need}[n]=\frac{s[n]}{M}\,T_\mathrm{vco}`)
    const hc1Text = JSON.stringify([handcalc('HC-04.1').title, handcalc('HC-04.1').formulaTex, handcalc('HC-04.1').tips, sol.steps, sol.results, sol.notes])
    for (const old of ['tau_\\\\mathrm{DTC}', '要延遲這麼多', '要補的延遲']) expect(hc1Text, old).not.toContain(old)
    // 很小的 residue（B = 16、K_F = 1：r[4] = −5/65536）會用科學記號：步驟與附註的數字都要在 $...$ 裡
    const tiny = handcalc('HC-04.1').solve({ KF: 1, B: 16, fvco: 13, eps: 1 })
    expect(tiny.results[1].value).toBe(-5 / 65536)
    expect(tiny.notes?.[0]).toContain('\\times10^{-5}$')
    expectSolutionTexOk(tiny, 'HC-04.1 tiny')
  })

  it('HC-04.2：§3「先算一次」的 N = 4 block：S = 2、G = 0.5、w_avg = 2、w_sum = 5（與 handGmac 相同）', () => {
    const { v, vals, sol } = solveDefault('HC-04.2')
    expect([v.a, v.w, v.mu]).toEqual([HAND_GMAC.a, HAND_GMAC.w, HAND_GMAC.mu])
    expect([v.x0, v.x1, v.x2, v.x3]).toEqual(HAND_GMAC.x)
    expect([v.v0, v.v1, v.v2, v.v3]).toEqual(HAND_GMAC.v)
    const h = handGmac()
    expect(vals).toEqual([h.Ssum, h.G, h.wAvg, h.wSum])
    expect(vals).toEqual([2, 0.5, 2, 5])
    expect(sol.steps[1].tex).toContain('=2.5') // e[0] = 2×1 + 0.5
    // tie：e = 0 判成 +1（E07）
    const tie = handcalc('HC-04.2').solve({ ...v, v0: -2 })
    expect(tie.steps[2].tex).toContain('b[0]=1')
    expect(tie.notes?.join('')).toContain('tie')
  })

  it('T13: HC-04.3 的 K_q、g、p 與 sum 模式的 g、pole 等於 golden T13（σ_v = 100 fs、N = 4096、μ = 10 fs、C = 1）', () => {
    const { v, vals } = solveDefault('HC-04.3')
    expect([v.mu, v.sigmaV, v.C, v.N]).toEqual([T13.inputs.mu_fs, T13.inputs.sigma_v_fs, T13.inputs.C, T13.inputs.N])
    expectGolden(T13, 'K_per_fs', vals[0])
    expectGolden(T13, 'g', vals[1])
    expectGolden(T13, 'p', vals[2])
    expectGolden(T13, 'g_sum_mode', vals[3])
    expectGolden(T13, 'pole_sum_mode', vals[4])
    expectGolden(NEG, 'sum_mode_gain_multiplier', Math.round(vals[3] / vals[1]))
    // N' = 1024：g_sum 變成 1/4
    const [row] = sumAverageTable({ mu: 10, sigmaV: 100, C: 1, Ex2: 1, Ns: [1024] })
    expect(vals[5]).toBe(row.gSum)
    expect(vals[3] / vals[5]).toBeCloseTo(4, 12)
  })

  it('T04: HC-04.3 的 K_q 等於 golden T04 的 kq_per_fs（σ_v = 100 fs）', () => {
    expectGolden(T04, 'kq_per_fs', solveDefault('HC-04.3').vals[0])
  })

  it('HC-04.4：手算表的 b = [1,0,0,0]：G = 0.5、G_bug = 0.25、x̄ = 0；恆等式 G_bug = ½G + ½x̄', () => {
    const { v, vals } = solveDefault('HC-04.4')
    const h = handGmac()
    expect([v.b0, v.b1, v.b2, v.b3]).toEqual(h.b)
    expect(vals).toEqual([h.G, h.Gbug, h.xbar])
    expect(vals).toEqual([0.5, 0.25, 0])
    // 有 DC 的 code：偏差項 ½x̄ 出現
    const dc = handcalc('HC-04.4').solve({ ...v, x0: 0.5, x1: 1, x2: 1.5, x3: 1 })
    const [G, Gbug, xbar] = dc.results.map((r) => r.value)
    expect(xbar).toBe(1)
    expect(Gbug).toBeCloseTo(0.5 * G + 0.5 * xbar, 14)
    expect(Gbug).toBe(gmacAverage([1, 0, 0, 0], [0.5, 1, 1.5, 1]))
    expect(G).toBe(gmacSum([1, -1, -1, -1], [0.5, 1, 1.5, 1]) / 4)
  })

  it('T04: HC-04.5（反面測試：忘了映射）：線性化 53.13 fs；ξ = −0.6023 時 h ≈ 0、w = 63.23 fs = mean-field 固定點 63.2341 fs', () => {
    const { v, vals, sol } = solveDefault('HC-04.5')
    const fp = bugFixedPointGaussian({ codeMean: 0.5, codeSigma: 1, sigmaV: 100, aTrue: 3 })
    expect(vals[0]).toBe(fp.xiLin)
    expect(vals[1]).toBe(fp.wStarLinear)
    expect(vals[1]).toBeCloseTo(53.13, 2) // §3 文字：「線性化 w* ≈ 53.133 fs」
    expect(vals[2]).toBe(bugMeanGmac(v.xi, 0.5, 1))
    expect(Math.abs(vals[2])).toBeLessThan(5e-5)
    expect(vals[3]).toBeCloseTo(63.23, 10)
    expect(fp.wStar).toBeCloseTo(63.2341, 4) // gmac.test.ts 引用的 Python mean-field 根
    expect(Math.abs(vals[3] - fp.wStar)).toBeLessThan(0.005)
    expect(sol.notes?.[0]).toContain('63.2341')
    // h(ξ) = E[x·Φ(ξx)] 的數值積分（Simpson）與題目的答案一致
    const n = 4000
    const lo = 0.5 - 10
    const dx = 20 / n
    let acc = 0
    for (let i = 0; i <= n; i++) {
      const x = lo + i * dx
      const wgt = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2
      acc += wgt * x * phiSeries(v.xi * x) * (Math.exp(-((x - 0.5) ** 2) / 2) / Math.sqrt(2 * Math.PI))
    }
    expect((acc * dx) / 3).toBeCloseTo(vals[2], 9)
    // 把試探值換成線性化的根：h 明顯不是 0（線性化低估）
    const atLin = handcalc('HC-04.5').solve({ ...v, xi: fp.xiLin })
    expect(atLin.results[2].value).toBeGreaterThan(0.01)
    expect(atLin.notes?.[0]).toContain('h(\\xi)>0')
  })

  it('HC-04.6：golden 反面測試——6-bit 對稱 code × 4096 需要 18 bits；17 bits 時 126976 wrap 成 −4096', () => {
    const { v, vals, sol } = solveDefault('HC-04.6')
    expect([v.bx, v.N]).toEqual([NEG.inputs.gmac_input_bits, NEG.inputs.N])
    expect(vals[0]).toBe(126976)
    expectGolden(NEG, 'gmac_bits_required', vals[1])
    expectGolden(NEG, 'gmac_17bit_wrapped_sum', vals[3])
    expect(vals[1]).toBe(accumulatorBitsRequired(6, 4096, 'symmetric')) // 封閉式 = 窮舉
    expect(vals[2]).toBe(accumulatorSizing(6, 4096, 'symmetric').bitsRule)
    expect(vals[3]).toBe(wrapTwos(31 * 4096, 17))
    expect(sol.notes?.[0]).toContain('變號')
    // full range：19 bits，經驗法則少 1 bit；18-bit 暫存器放得下對稱 code 的最壞情況
    const full = handcalc('HC-04.6').solve({ ...v, full: 1 }).results.map((r) => r.value)
    expect(full.slice(0, 3)).toEqual([131072, 19, 18])
    const fits = handcalc('HC-04.6').solve({ ...v, Btry: 18 })
    expect(fits.results[3].value).toBe(126976)
    expect(fits.notes?.[0]).toContain('位元數足夠')
  })

  it('HC-04.7：S = −300、ℓ = 8 的四種取整與 §5 表格 F_G = 2 的 floor 偏差 δ* ≈ 1.510 fs', () => {
    const { v, vals, sol } = solveDefault('HC-04.7')
    expect(vals[0]).toBe(shiftRound(-300, 8, 'floor'))
    expect(vals[1]).toBe(shiftRound(-300, 8, 'half_even'))
    expect(vals.slice(0, 2)).toEqual([-2, -1])
    expect(vals[2]).toBe(roundingMeanError(8, 'floor'))
    const page = defaultBiasNumbers(2) // §5.3 表格用的數字
    expect([v.m, v.FG, v.bx]).toEqual([Math.log2(page.N), 2, page.bx])
    expect(v.K).toBeCloseTo(page.K, 7) // 預設 K 是文中 K 的 5 位有效數字
    expect(vals[3]).toBeCloseTo(page.deltaStar, 4)
    expect(handcalc('HC-04.7').solve({ ...v, K: page.K }).results[3].value).toBeCloseTo(page.deltaStar, 12)
    // 題目內的 Δ_G 與 gmac.ts 閉迴路模型的 deltaG 相同（F_G = 2、B_x = 6）
    const an = datapathAnalytic({ sigmaV: 100, mu: 10, bx: 6, m: 10, FG: 2, lW: 0, d: 0 }).an
    expect(sol.steps.some((s) => s.tex.includes(`=${an.deltaG}`))).toBe(true)
    expect(-vals[3]).toBeCloseTo(an.biasPredRound, 4)
    // tie：S = −14、ℓ = 2 ⇒ −3.5：floor −4、half-even −4（偶數）、half-up −3
    const tie = handcalc('HC-04.7').solve({ S: -14, m: 2, FG: 0, bx: 6, K: 0.0025 })
    expect(tie.results.slice(0, 2).map((r) => r.value)).toEqual([-4, -4])
    expect(tie.notes?.[0]).toContain('half-up $-3$')
    // 外部審查 R11：附註不再寫「half-even 的平均誤差是 0」這種無條件的說法——閉迴路沒有固定偏差的理由是奇對稱，開迴路的 0 另需 F-04.10 的條件
    for (const note of [sol.notes?.[0] ?? '', tie.notes?.[0] ?? '']) {
      expect(note).toContain(String.raw`half-even 在閉迴路沒有固定偏差：它是奇函數 $Q(-S)=-Q(S)$，平衡點 $\delta=0$ 時 $S$ 的分布對 $0$ 對稱，平均輸出就是 $0$`)
      expect(note).toContain('（開迴路的平均誤差為 $0$ 則要 F-04.10 的條件）')
      expect(note).not.toContain('half-even 的平均誤差是 0')
    }
    // 奇對稱本身：這一題的例子與它的鏡像
    expect(shiftRound(300, 8, 'half_even')).toBe(-shiftRound(-300, 8, 'half_even'))
    expect(shiftRound(14, 2, 'half_even')).toBe(-shiftRound(-14, 2, 'half_even')) // tie：+3.5 → 4、−3.5 → −4
    expect(shiftRound(14, 2, 'floor')).not.toBe(-shiftRound(-14, 2, 'floor')) // 對照：floor 是 3 與 −4
  })

  it('HC-04.8：§5.6「第二個截斷點」的例子——g、Δ_W、(w*−a)_W = −2.653 fs；÷N 也用 floor 時再加 −0.373 fs', () => {
    const { v, vals, sol } = solveDefault('HC-04.8')
    const wt = wTruncNumbers() // §5.6 文字與 preset gmac-fp-w-truncation 的數字
    const page4 = defaultBiasNumbers(4)
    expect([v.sigmaV, v.mu, v.bx, 2 ** v.m, v.lW]).toEqual([100, wt.mu, wt.bx, wt.N, wt.ellW])
    const { an, deltaW, gCrit } = datapathAnalytic(v)
    expect(deltaW).toBe(wt.wLsb)
    expect(an.wRatio).toBe(wt.R)
    expect(vals[0]).toBeCloseTo(page4.K, 15)
    expect(vals[1]).toBeCloseTo(wt.g, 15)
    expect(vals[2]).toBe(criticalGain(1))
    expect(gCrit).toBeCloseTo(1, 12)
    expect(vals[3]).toBe(accumulatorSizing(6, 1024, 'symmetric').bitsExact)
    expect(vals[4]).toBeCloseTo(-page4.deltaStar, 12)
    expect(vals[5]).toBeCloseTo(wt.bias, 12)
    expect(vals[5]).toBeCloseTo(-2.653, 3)
    expect(vals[4]).toBeCloseTo(-0.373, 3)
    expect(vals[6]).toBeCloseTo(vals[4] + vals[5], 12)
    expect(vals[6]).toBeCloseTo((-(1 - 2 ** -(an.ell + v.lW)) * deltaW) / (2 * an.g), 12) // 兩次 floor = 一次右移 ℓ + ℓ_W
    expect(sol.steps.length).toBe(18)
    // 思考題 6：Δ_W 不變、μ 減半（ℓ_W 加 1）⇒ W 的偏差約加倍（−5.685 fs），÷N 的偏差不變
    const half = handcalc('HC-04.8').solve({ ...v, mu: 5, lW: 4 }).results.map((r) => r.value)
    expect(half[5]).toBeCloseTo(wt.biasHalf, 12)
    expect(half[5]).toBeCloseTo(-5.685, 3)
    expect(half[4]).toBeCloseTo(vals[4], 12)
  })
})

describe('Ch04 手算題：(b) 隨機出題（20 個 seed）', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：randomValues 的每一題都通過 validate、答案有限，且等於測試內的獨立重算', (id, def) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      seen.add(JSON.stringify(v))
      for (const i of def.inputs) expect(inputError(i, v[i.key]), `${id} seed ${seed} ${i.key}`).toBeNull()
      expect(def.validate?.(v) ?? null, `${id} seed ${seed}`).toBeNull()
      const sol = def.solve(v)
      const expected = INDEPENDENT[id](v)
      expect(sol.results.length).toBe(expected.length)
      sol.results.forEach((r, k) => expectSame(r.value, expected[k], `${id} seed ${seed} ${r.symbol} @ ${JSON.stringify(v)}`))
      expectSolutionTexOk(sol, `${id} seed ${seed}`)
    }
    // 真的抽出了不同的題目（不是每次都退回預設值）
    expect(seen.size).toBeGreaterThanOrEqual(10)
    expect(seen.has(JSON.stringify(defaultValues(def)))).toBe(false)
  })

  it('預設值的答案也等於獨立重算', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const expected = INDEPENDENT[def.id](v)
      def.solve(v).results.forEach((r, k) => expectSame(r.value, expected[k], `${def.id} ${r.symbol}`))
    }
  })
})

describe('Ch04 手算題：(c) validate 擋掉模型不適用的輸入，並說明原因', () => {
  const cases: [string, Record<string, number>, RegExp][] = [
    ['HC-04.1', { KF: 16, B: 4 }, /frac.*<1/],
    ['HC-04.1', { KF: 9, B: 3 }, /K_\\mathrm\{F\}=9\\ge M=2\^\{3\}=8/],
    ['HC-04.2', { x0: 0, x1: 0, x2: 0, x3: 0 }, /沒有激勵/],
    ['HC-04.3', { sigmaV: 0 }, /K_q.*沒有定義/],
    ['HC-04.3', { C: 0 }, /C\\le0/],
    ['HC-04.3', { C: -0.5 }, /更新方向錯誤/],
    ['HC-04.3', { mu: 0 }, /\\mu\\le0/],
    ['HC-04.4', { b0: 2 }, /只能是 \$0\$ 或 \$1\$/],
    ['HC-04.5', { sx: 0 }, /沒有固定點/],
    ['HC-04.5', { sigmaV: 0 }, /\\sigma_v\\le0/],
    ['HC-04.6', { full: 2 }, /對稱.*full range/],
    ['HC-04.6', { bx: 1 }, /2\\le B_x\\le16/],
    ['HC-04.6', { N: 0 }, /正整數/],
    ['HC-04.6', { Btry: 1 }, /暫存器寬度/],
    ['HC-04.7', { FG: 10 }, /不需要右移/],
    ['HC-04.7', { FG: 12 }, /\\ell=\\log_2N-F_G\\le0/],
    ['HC-04.7', { K: 0 }, /K\\le0/],
    ['HC-04.7', { S: 40000 }, /超過最壞情況.*32768/],
    ['HC-04.7', { S: 5, m: 20, FG: 0, bx: 4 }, /滿刻度.*dead zone/],
    ['HC-04.8', { sigmaV: 0 }, /K_q.*沒有定義/],
    ['HC-04.8', { mu: 0 }, /\\mu\\le0/],
    ['HC-04.8', { bx: 6.5 }, /必須是整數/],
    ['HC-04.8', { FG: 10 }, /第一個截斷點不存在/],
    ['HC-04.8', { mu: 500 }, /g_\\mathrm\{crit\}.*不穩定/],
    ['HC-04.8', { mu: 100, d: 8 }, /g_\\mathrm\{crit\}\(d=8\)/],
    ['HC-04.8', { m: 14, FG: 0 }, /\\sigma_S\/2\^\{\\ell\}.*dead zone/],
    ['HC-04.8', { lW: 6 }, /\\mu\\sigma_G\/\\Delta_W.*F-04\.18/],
    ['HC-04.8', { m: 4, FG: 0, lW: 3 }, /小訊號線性化/],
    ['HC-04.9', { tvco: 0 }, /T_\\mathrm\{vco\}.*大於 0/],
    ['HC-04.9', { B: 0 }, /1\\ldots20/],
    ['HC-04.9', { sigmaV: 0 }, /K_q.*沒有定義/],
    ['HC-04.9', { inl: -1 }, /不能是負的/],
    ['HC-04.10', { lsb: 0 }, /\\Delta.*大於 0/],
    ['HC-04.10', { B: 21 }, /1\\ldots20/],
  ]

  it.each(cases)('%s %j', (id, patch, re) => {
    const def = handcalc(id)
    const msg = def.validate?.({ ...defaultValues(def), ...patch })
    expect(msg, `${id} ${JSON.stringify(patch)} 應被拒絕`).toBeTruthy()
    expect(msg).toMatch(re)
    expectInlineMathOk(msg as string, `${id} validate`)
  })

  it('每一題都有 validate；HC-04.8 的檢查值來自 gmac.ts 的 analytic（g_crit、dither 比、linearValid）', () => {
    for (const h of HANDCALCS) expect(typeof h.validate, h.id).toBe('function')
    // g 剛好低於 / 高於 g_crit(d = 2) = 0.618 的兩個 μ
    const def = handcalc('HC-04.8')
    const base = { ...defaultValues(def), d: 2 }
    const K = datapathAnalytic(base).an.K
    expect(def.validate?.({ ...base, mu: 0.61 / K })).toBeNull()
    expect(def.validate?.({ ...base, mu: 0.63 / K })).toMatch(/不穩定/)
    // ℓ_W = 0：W 的格點和更新量一樣細，第二個截斷點沒有偏差（不檢查 μσ_G/Δ_W）
    const noW = def.solve({ ...defaultValues(def), lW: 0 })
    expect(def.validate?.({ ...defaultValues(def), lW: 0 })).toBeNull()
    expect(noW.results[5].value).toBe(0)
    expect(noW.results[6].value).toBeCloseTo(noW.results[4].value, 12)
  })
})

describe('Ch04 手算題：(e) 顯示的數字彼此對得上（拿上一步顯示的數字接著算，會得到下一步顯示的數字）', () => {
  /** 取出某一步 TeX 最後一個「=」右邊的數字字串（去掉單位） */
  const lastRhs = (tex: string): string =>
    tex
      .slice(tex.lastIndexOf('=') + 1)
      .replace(/\\,\\mathrm\{fs\}.*$/, '')
      .trim()

  it('HC-04.3：1 − g 顯示到和 g 相同的小數位（g_sum ≈ 1 時不會出現 1 − 1.0213 = −0.021292）', () => {
    const sol = handcalc('HC-04.3').solve({ mu: 1, sigmaV: 50, C: 1, N: 64, N2: 16 })
    expect(sol.steps[5].tex).toContain('=1.0213')
    expect(sol.steps[6].tex).toMatch(/=1-1\.0213=-0\.0213$/)
    expect(sol.results[4].value).toBeCloseTo(-0.021292, 6) // 框內的答案仍是完整精度的值
    expect(handcalc('HC-04.3').solve(defaultValues(handcalc('HC-04.3'))).steps[4].tex).toMatch(/=1-0\.079788=0\.920212$/)
  })

  it('HC-04.5：h = 兩項相加，顯示到兩項共同的小數位；γ、u 各自成一步', () => {
    const def = handcalc('HC-04.5')
    const d = def.solve(defaultValues(def))
    expect(d.steps.length).toBe(13)
    expect(d.steps[3].tex).toMatch(/^\\xi\^2\\sigma_x\^2=\(-0\.6023\)\^2\\times1\^2=0\.362765\\times1=0\.362765$/)
    expect(d.steps[4].tex).toMatch(/=\\sqrt\{1\+0\.362765\}=\\sqrt\{1\.362765\}=1\.16738$/)
    expect(d.steps[7].tex).toMatch(/^u=\\frac\{z\^2\}\{2\}=/)
    expect(d.steps[11].tex).toBe('h(\\xi)=0.199107+(-0.199095)=1.2\\times10^{-5}') // 0.199107 − 0.199095 = 0.000012
    const far = def.solve({ mx: 0.25, sx: 0.5, sigmaV: 100, a: 30, xi: -0.2 })
    expect(far.steps[11].tex).toBe('h(\\xi)=0.12004+(-0.0198236)=0.100216') // 舊版顯示成 0.1
    // m_x = 0：第一項是 0，和就等於第二項（不可因為「0 沒有小數位」而被四捨五入成整數）
    const zero = def.solve({ ...defaultValues(def), mx: 0 })
    expect(lastRhs(zero.steps[11].tex)).toBe('-0.205832')
  })

  it('HC-04.6：⌈log2 N⌉ 與 wrap 的 k 都有算式；2 的冪時提醒不要多進一位', () => {
    const def = handcalc('HC-04.6')
    const d = def.solve(defaultValues(def))
    expect(d.steps.length).toBe(9)
    expect(d.steps[6].tex).toBe('B_x+\\lceil\\log_2N\\rceil=6+\\lceil\\log_2{4096}\\rceil=6+12=18')
    expect(d.steps[7].tex).toContain('\\lfloor0.96875+0.5\\rfloor=\\lfloor1.46875\\rfloor=1')
    expect(d.steps[8].tex).toMatch(/=126976-1\\times131072=126976-131072=-4096$/)
    const odd = def.solve({ bx: 6, N: 1000, full: 0, Btry: 14 })
    expect(odd.steps[6].tex).toBe('B_x+\\lceil\\log_2N\\rceil=6+\\lceil\\log_2{1000}\\rceil=6+\\lceil9.96578\\rceil=6+10=16')
    expect(odd.steps[7].tex).toMatch(/=2$/) // 31000 / 16384 = 1.89 ⇒ k = 2
    expect(odd.results[3].value).toBe(wrapTwos(31000, 14))
    expect(odd.results[3].value).toBe(31000 - 2 * 16384)
    // N·M_x + 1 = 4 = 2²：log2 是整數
    const pow = def.solve({ bx: 2, N: 3, full: 0, Btry: 17 })
    expect(pow.steps[3].why).toContain('恰好是 2 的冪')
    expect(d.steps[3].why).not.toContain('恰好是 2 的冪')
    expect(pow.steps.length).toBe(8) // 放得下：沒有 k 那一步
    // full range 且 N 不是 2 的冪：經驗法則剛好等於精確值（不是「一定少 1 bit」）
    const full = def.solve({ bx: 4, N: 100, full: 1, Btry: 10 })
    expect(full.results[1].value).toBe(full.results[2].value)
    expect(full.results[1].value).toBe(accumulatorBitsRequired(4, 100, 'full'))
  })

  it('HC-04.7：2 的冪的分數完整顯示；ε̄ 用分數算；dither 的註記與 gmac.ts 閉迴路模型相同', () => {
    const def = handcalc('HC-04.7')
    const d = def.solve(defaultValues(def))
    expect(d.steps[2].tex).toBe('\\frac{S}{2^\\ell}=\\frac{-300}{256}=-1.171875')
    expect(d.steps[5].tex).toContain('\\frac{-172}{256}')
    expect(d.steps[8].tex).toMatch(/=-2-\(-1\.171875\)=-0\.828125=-\\frac\{212\}\{256\}$/)
    expect(d.steps[9].tex).toMatch(/=-\\frac\{255\}\{512\}=-0\.498046875$/)
    expect(d.steps[10].tex).toMatch(/=\\frac\{1\}\{2\^\{7\}\}=\\frac\{1\}\{128\}=0\.0078125$/)
    for (const [bx, m, FG] of [
      [6, 10, 2],
      [6, 10, 0],
      [8, 6, 4],
      [4, 10, 0],
    ]) {
      const an = datapathAnalytic({ sigmaV: 100, mu: 10, bx, m, FG, lW: 0, d: 0 }).an
      const v = { S: 5, m, FG, bx, K: 0.0025 }
      expect(def.validate?.(v) ?? null).toBeNull()
      const note = def.solve(v).notes?.[2] ?? ''
      expect(note).toContain(`=${texNum(an.sigmaS, 4)}$`)
      expect(note).toContain(`\\sigma_S/2^\\ell=${texNum(an.ditherRatio, 3)}$`)
      expect(note.includes('不夠')).toBe(an.ditherRatio < 0.25)
    }
    // 「換一題」不會抽到 dead zone 的組合（以對稱 uniform code 估計）
    for (let seed = 1; seed <= 60; seed++) {
      const v = randomValues(def, seed)
      expect(datapathAnalytic({ sigmaV: 100, mu: 10, bx: v.bx, m: v.m, FG: v.FG, lW: 0, d: 0 }).an.ditherRatio, JSON.stringify(v)).toBeGreaterThanOrEqual(0.25)
    }
  })

  it('HC-04.8：ε̄、ε̄_W 用分數算，R 與 Δ_W 分成兩步，合計顯示到兩項共同的小數位', () => {
    const def = handcalc('HC-04.8')
    const d = def.solve(defaultValues(def))
    expect(d.steps[6].tex).toMatch(/=1-0\.025765=0\.974235$/)
    expect(d.steps[10].tex).toMatch(/=\\frac\{1\}\{512\}=0\.001953125$/)
    expect(d.steps[11].tex).toMatch(/=-\\frac\{63\}\{128\}=-0\.4921875$/)
    expect(d.steps[13].tex).toBe('R=2^{\\ell_W}=2^{3}=8')
    expect(d.steps[14].tex).toMatch(/=8\\times10\\times0\.001953125=80\\times0\.001953125=0\.15625\\,\\mathrm\{fs\}$/)
    expect(d.steps[15].tex).toMatch(/=-\\frac\{7\}\{16\}=-0\.4375$/)
    expect(lastRhs(d.steps[17].tex)).toBe('-3.0263')
    // ℓ_W = 0：R = 1，第二個截斷點沒有偏差，各步仍可渲染
    const noW = def.solve({ ...defaultValues(def), lW: 0 })
    expect(noW.steps[15].tex).toMatch(/=-\\frac\{0\}\{2\}=0$/)
    expect(lastRhs(noW.steps[17].tex)).toBe('-0.3731')
    expectSolutionTexOk(noW, 'HC-04.8 lW = 0')
  })

  it('HC-04.1：T_vco 多留一位，x·T_vco 與下一步的 ε·τ 用顯示的數字就能對上', () => {
    const d = handcalc('HC-04.1').solve(defaultValues(handcalc('HC-04.1')))
    expect(d.steps[11].tex).toContain('=76923.077\\,\\mathrm{fs}')
    expect(d.steps[12].tex).toContain('0.9375\\times76923.077=72115.38')
    expect((0.9375 * 76923.077).toFixed(2)).toBe('72115.38')
    expect(d.steps[13].tex).toContain('0.01\\times72115.38=721.1538')
  })
})

describe('Ch04 手算題：(d) 渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：<HandCalc> 顯示所有步驟與答案，沒有 KaTeX 錯誤', (id, def) => {
    const sol = def.solve(defaultValues(def))
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.querySelector(`[id="handcalc-${id}"]`)).not.toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length).toBe(sol.results.length)
    expectNoTexErrors(container)
    expect(container.textContent).not.toMatch(/NaN|undefined/)
    expect(container.textContent).not.toContain('$') // 所有 $...$ 都被轉成 KaTeX
    unmount()
    // 「自己算算看」：答案欄數量 = results 數量，步驟先藏起來
    const practice = render(<HandCalc def={def} initialMode="practice" />)
    expect(practice.container.querySelectorAll('.c-step').length).toBe(0)
    expect(practice.container.querySelectorAll('.c-handcalc-answer').length).toBe(sol.results.length)
    expectNoTexErrors(practice.container)
    practice.unmount()
  })
})
