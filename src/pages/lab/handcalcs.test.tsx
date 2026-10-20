import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'
import { render } from '@testing-library/react'
import { HandCalc, defaultValues, randomValues } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { eigSym } from '@/simulation/core'
import { cppll3Loop, pllDesign } from '@/simulation/models/unifiedLab'
import { expectNoTexErrors } from '@/test/katex'
import { FORMULAS } from './formulas'
import { HANDCALCS, HC_CPPLL_DEFAULT, HC_PMUX_DEFAULT } from './handcalcs'
import { cppll3Numbers, pmuxNumbers } from './numbers'

/**
 * /lab 的帶入手算（HC-LAB.1、HC-LAB.2）：
 *  - 結構：ID、頁面、公式 ID、TeX 可解析、文字欄位不以 Unicode 拼公式、practice 的每一種組合都通過 validate。
 *  - 預設值 = §5b 的例子（numbers.ts 的 pmuxNumbers／cppll3Numbers，頁面上的表格就是這兩個函式的輸出）。
 *  - 獨立重算：HC-LAB.1 直接對 9×9 的資訊矩陣 R 做 eigSym（不用 2×2 封閉式）；HC-LAB.2 直接把 z = e^{jΩ} 代進 L(z) 的
 *    多項式比（複數運算，不用 −Re L 的封閉式），反號帶上緣用掃頻找 Re H_PD 的變號點。
 *  - 渲染：HandCalc 元件畫得出來、沒有 KaTeX 錯誤。
 */

const def = (id: string): HandCalcDef => {
  const d = HANDCALCS.find((h) => h.id === id)
  if (!d) throw new Error(id)
  return d
}
const values = (d: HandCalcDef, v: Record<string, number>): number[] => d.solve(v).results.map((r) => r.value)

function close(actual: number, expected: number, rel = 1e-9, abs = 1e-12, label = '') {
  expect(Math.abs(actual - expected), `${label} actual=${actual} expected=${expected}`).toBeLessThanOrEqual(abs + rel * Math.abs(expected))
}

const unpaired = (s: string): boolean => (s.match(/(?<!\\)\$/g) ?? []).length % 2 !== 0
const outsideMath = (s: string): string =>
  s
    .split(/(?<!\\)\$/)
    .filter((_, i) => i % 2 === 0)
    .join(' ')
/** 希臘字母、根號／求和、上下標數字（teaching-style §3） */
const UNICODE_MATH = /[α-ωΑ-Ω√∑∂₀-₉⁰-⁹²³]/u
function expectInlineTexOk(s: string) {
  expect(unpaired(s), `$ 不成對：${s}`).toBe(false)
  const parts = s.split(/(?<!\\)\$/)
  for (let i = 1; i < parts.length; i += 2) expect(() => katex.renderToString(parts[i], { throwOnError: true, strict: 'ignore' }), parts[i]).not.toThrow()
}

/** HC-LAB.1 的獨立重算：組出 9×9 的 R（PHOS 區塊 I/8、耦合 E[x]/8、R_xx = E[x²]），eigSym 取最大與最小特徵值 */
function indepPmux(v: Record<string, number>): number[] {
  const R = Array.from({ length: 9 }, (_, i) => Array.from({ length: 9 }, (_, j) => (i === 8 && j === 8 ? v.Ex2 : i === 8 || j === 8 ? v.Ex / 8 : i === j ? 1 / 8 : 0)))
  const ev = eigSym(R).values
  const lmax = ev[0]
  const lmin = ev[ev.length - 1]
  const Kq = Math.sqrt(2 / Math.PI) / v.sigmaV
  return [lmax / lmin, 2 / (Kq * lmax), 1 / (v.mu * Kq * lmin)]
}

/** L(z) = bL(z⁻¹)/aL(z⁻¹) 在 z = e^{jΩ} 的複數值（直接代入多項式，不用封閉式） */
function lAt(bL: number[], aL: number[], W: number): { re: number; im: number } {
  const ev = (c: number[]) => {
    let re = 0
    let im = 0
    c.forEach((x, k) => {
      re += x * Math.cos(-k * W)
      im += x * Math.sin(-k * W)
    })
    return { re, im }
  }
  const b = ev(bL)
  const a = ev(aL)
  const d = a.re * a.re + a.im * a.im
  return { re: (b.re * a.re + b.im * a.im) / d, im: (b.im * a.re - b.re * a.im) / d }
}

/** HC-LAB.2 的獨立重算：−Re L(f) 直接用複數；f_inv = Re H_PD = (1 + Re L)/|1 + L|² 由負變正的頻率（掃頻 + 二分） */
function indepCppll(v: Record<string, number>): number[] {
  const wc = (2 * Math.PI * v.fc) / v.fref
  const { bL, aL } = cppll3Loop(wc, v.pm, v.rp, 0)
  const negReL = (f: number) => -lAt(bL, aL, (2 * Math.PI * f) / v.fref).re
  const reH = (f: number) => {
    const L = lAt(bL, aL, (2 * Math.PI * f) / v.fref)
    return (1 + L.re) / ((1 + L.re) ** 2 + L.im ** 2)
  }
  // 掃頻找第一個 Re H_PD ≥ 0 的點，再二分
  let lo = 1e-6 * v.fref
  let hi = lo
  const step = v.fref / 20000
  while (hi < v.fref / 2 && reH(hi) < 0) {
    lo = hi
    hi += step
  }
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi)
    if (reH(mid) < 0) lo = mid
    else hi = mid
  }
  return [negReL(v.ftest), 0.5 * (lo + hi)]
}

const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = { 'HC-LAB.1': indepPmux, 'HC-LAB.2': indepCppll }

describe('/lab 手算題：結構', () => {
  it('兩題、ID 連號 HC-LAB.n、page = /lab、公式 ID 在本頁的登錄表；每個輸入都有 practice；文字欄位不以 Unicode 拼公式、$ 成對、TeX 可解析', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-LAB.1', 'HC-LAB.2'])
    const ids = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/lab')
      expect(ids.has(h.formulaId as string), h.id).toBe(true)
      expect(() => katex.renderToString(h.formulaTex, { throwOnError: true, displayMode: true, strict: 'ignore' }), h.id).not.toThrow()
      expect(h.formulaTex).toContain('\\begin{aligned}') // 分行，不在 830 px 欄寬裡橫向捲動
      for (const i of h.inputs) {
        expect(i.practice, `${h.id}.${i.key}`).toBeDefined()
        expectInlineTexOk(i.label)
        expect(UNICODE_MATH.test(outsideMath(i.label)), `${h.id}.${i.key}：${i.label}`).toBe(false)
        expect(() => katex.renderToString(i.symbol, { throwOnError: true })).not.toThrow()
      }
      for (const t of h.tips ?? []) {
        expectInlineTexOk(t)
        expect(UNICODE_MATH.test(outsideMath(t)), t).toBe(false)
      }
      const sol = h.solve(defaultValues(h))
      for (const st of sol.steps) {
        expect(() => katex.renderToString(st.tex, { throwOnError: true, displayMode: true, strict: 'ignore' }), st.tex).not.toThrow()
        expect(st.tex).not.toMatch(/NaN|undefined|\\infty/)
        expectInlineTexOk(st.why)
        expect(UNICODE_MATH.test(outsideMath(st.why)), st.why).toBe(false)
      }
      for (const n of sol.notes ?? []) {
        expectInlineTexOk(n)
        expect(UNICODE_MATH.test(outsideMath(n)), n).toBe(false)
      }
      for (const r of sol.results) if (r.label) expectInlineTexOk(r.label)
    }
  })

  it('結論強度：HC-LAB.1 標「近似」——特徵值與條件數是精確的矩陣代數，但 K_q 是小訊號線性化、τ_slow = 1/g 是 g ≪ 1 的近似（步驟與 notes 都講清楚哪些是精確的）；HC-LAB.2 在線性三階 CPPLL 內精確', () => {
    const h1 = HANDCALCS.find((h) => h.id === 'HC-LAB.1')!
    expect(h1.claim).toBe('approx')
    const sol = h1.solve(defaultValues(h1))
    const why = (sym: string) => sol.steps.find((st) => st.tex.startsWith(sym))?.why ?? ''
    expect(why('K_q')).toMatch(/線性化/)
    expect(why('\\tau_{\\mathrm{slow}}')).toMatch(/近似/)
    expect((sol.notes ?? []).some((n) => n.includes('精確') && n.includes('近似'))).toBe(true)
    expect(HANDCALCS.find((h) => h.id === 'HC-LAB.2')!.claim).toBe('exact')
  })

  it('ID 全站唯一：其他頁的 handcalcs.ts 沒有用 HC-LAB 前綴', () => {
    const root = join(process.cwd(), 'src')
    const hits: string[] = []
    for (const base of ['chapters', 'pages']) {
      for (const d of readdirSync(join(root, base))) {
        if (base === 'pages' && d === 'lab') continue
        try {
          if (readFileSync(join(root, base, d, 'handcalcs.ts'), 'utf8').includes("'HC-LAB.")) hits.push(`${base}/${d}`)
        } catch {
          /* 沒有 handcalcs.ts */
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('practice 的每一種組合都通過 validate，答案都是有限值（換一題不會抽到模型不適用的數字）', () => {
    for (const h of HANDCALCS) {
      const keys = h.inputs.map((i) => i.key)
      const choices = h.inputs.map((i) => i.practice?.choices ?? [i.default])
      const combo = (k: number, acc: Record<string, number>): void => {
        if (k === keys.length) {
          expect(h.validate?.(acc) ?? null, `${h.id} ${JSON.stringify(acc)}`).toBeNull()
          for (const v of values(h, acc)) expect(Number.isFinite(v), `${h.id} ${JSON.stringify(acc)}`).toBe(true)
          return
        }
        for (const c of choices[k]) combo(k + 1, { ...acc, [keys[k]]: c })
      }
      combo(0, {})
    }
  })
})

describe('/lab 手算題：預設值 = §5b 的例子，答案 = unifiedLab.ts 的函式', () => {
  it('HC-LAB.1 的預設是 §5b.2 的表格（pmuxNumbers：E[x] = 1/2、E[x²] = 1/3、σ_v = 100 fs、μ = 10 fs）：κ、μ_max、τ_slow 逐位元相同', () => {
    const h = def('HC-LAB.1')
    const v = defaultValues(h)
    expect(v).toEqual({ ...HC_PMUX_DEFAULT })
    const pm = pmuxNumbers()
    const [kappa, muMax, tau] = values(h, v)
    expect(kappa).toBe(pm.cond)
    expect(muMax).toBe(pm.muMax)
    expect(tau).toBe(pm.tauSlowBlocks)
    // 封閉式：λ± = 11/48 ± √97/48
    close(kappa, (11 + Math.sqrt(97)) / (11 - Math.sqrt(97)), 1e-12)
  })

  it('HC-LAB.2 的預設是 §5b.3 的設計（cppll3Numbers：320 MHz、PM 60°、r_p = 4、4 GHz；f_c 取 4 位有效數字）：f_inv 與頁面表格的值相差 < 0.1%，100 MHz 在反號帶內', () => {
    const h = def('HC-LAB.2')
    const v = defaultValues(h)
    const cp = cppll3Numbers()
    expect(v.fc).toBe(HC_CPPLL_DEFAULT.fcMHz)
    expect(Math.abs(v.fc * 1e6 - cp.c.fcCtHz) / cp.c.fcCtHz).toBeLessThan(5e-4)
    const [negReL, fInv] = values(h, v)
    expect(Math.abs(fInv * 1e6 - cp.fInvHz) / cp.fInvHz).toBeLessThan(1e-3)
    expect(negReL).toBeGreaterThan(1)
    expect(negReL).toBeCloseTo(cp.test.total, 2)
    // 頁面上的數值反號帶（pllDesign 的 inversionBands）也一致
    const d = pllDesign({ pll: 'cppll3', pllBwHz: 320e6, fRefHz: 4e9, zeta: 0.7, loopDelay: 0, pllPmDeg: 60, pllP3Ratio: 4 })
    expect(Math.abs(d.inversionBands[0].fHiHz - fInv * 1e6) / d.inversionBands[0].fHiHz).toBeLessThan(1e-3)
  })

  it('預設與隨機 20 題：solve() 的答案與獨立重算一致（9×9 eigSym；L(z) 直接以複數代入、Re H_PD 掃頻找變號點）', () => {
    for (const h of HANDCALCS) {
      const sets = [defaultValues(h), ...Array.from({ length: 20 }, (_, i) => randomValues(h, 1000 + i))]
      for (const v of sets) {
        const got = values(h, v)
        const ref = INDEPENDENT[h.id](v)
        expect(got).toHaveLength(ref.length)
        got.forEach((g, i) => close(g, ref[i], h.id === 'HC-LAB.2' && i === 1 ? 1e-6 : 1e-9, 1e-12, `${h.id} #${i} ${JSON.stringify(v)}`))
      }
    }
  })
})

describe('/lab 手算題：validate 與渲染', () => {
  it('validate 擋下模型不適用的輸入並解釋原因（TeX 可解析）', () => {
    const h1 = def('HC-LAB.1')
    const e1 = h1.validate?.({ ...defaultValues(h1), Ex: 0.8, Ex2: 0.5 })
    expect(e1).toContain('變異數')
    expectInlineTexOk(e1 as string)
    const h2 = def('HC-LAB.2')
    const base = defaultValues(h2)
    for (const [patch, word] of [
      [{ pm: 80, rp: 2 }, '零點'],
      [{ ftest: 2500 }, 'Nyquist'],
      [{ fc: 1500 }, 'f_c'],
    ] as const) {
      const e = h2.validate?.({ ...base, ...patch })
      expect(e, JSON.stringify(patch)).toContain(word)
      expectInlineTexOk(e as string)
    }
  })

  it('兩題都畫得出來：通式、輸入、步驟、答案，沒有 KaTeX 錯誤', () => {
    for (const h of HANDCALCS) {
      const { container, unmount } = render(<HandCalc def={h} />)
      expect(container.querySelector(`#handcalc-${h.id.replace('.', '\\.')}`)).not.toBeNull()
      expect(container.querySelectorAll('.c-handcalc-input')).toHaveLength(h.inputs.length)
      expectNoTexErrors(container)
      unmount()
    }
  })
})
