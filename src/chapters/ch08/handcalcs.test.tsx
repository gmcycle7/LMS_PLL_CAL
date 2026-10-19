import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, randomValues, renderTex, texNum } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import {
  analyzeDualLoop,
  comparatorKq,
  delayCriticalGain,
  delayNoOvershootGain,
  delayStable,
  dualLoopGainMargin,
  omegaToHz,
  pmFirstOrder,
  pmWithDelay,
  polarityMarginArcsin,
  polarityMarginWrap,
  simulateDelayRecursion,
  updateRateHz,
  wrap180Spec,
} from '@/simulation/models/stability'
import { FORMULAS } from './formulas'
import { HAND_BLOCKS, HANDCALCS, OVERSHOOT_BLOCKS, handcalc } from './handcalcs'
import { expectNoTexErrors } from '@/test/katex'

interface Vector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
}
const golden = (id: string): Vector => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))

const D2R = Math.PI / 180
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const values = (sol: HandCalcSolution): number[] => sol.results.map((r) => r.value)
const solveDefault = (id: string) => handcalc(id).solve(defaultValues(handcalc(id)))
/** 相對（|want| > 1 時）或絕對誤差 ≤ tol */
function expectClose(got: number, want: number, tol = 1e-9, msg?: string) {
  expect(Math.abs(got - want), msg ?? `${got} vs ${want}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(want)))
}

/**
 * 每一題的「獨立重算」：直接照課本公式寫，不呼叫 stability.ts 的任何函式。
 * 回傳值的順序與 solve().results 相同。
 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-08.1': ({ theta }) => {
    let psi = theta
    while (psi >= 180) psi -= 360
    while (psi < -180) psi += 360
    return [psi, 90 - Math.abs(psi)]
  },
  'HC-08.2': ({ g }) => [1 - g, 90 - Math.asin(g / 2) / D2R, 2 * Math.asin(g / 2)],
  'HC-08.3': ({ g, fs, N }) => {
    const wc = 2 * Math.asin(g / 2)
    const fuHz = (fs * 1e6) / N
    return [((wc / (2 * Math.PI)) * fuHz) / 1e3, 20 * Math.log10(2 / g), (Math.PI / 2 - wc / 2) / wc]
  },
  'HC-08.4': ({ g, d, d0 }) => {
    const x = [d0]
    for (let k = 0; k < HAND_BLOCKS; k++) x.push(x[k] - g * (k - d < 0 ? d0 : x[k - d]))
    return x.slice(1)
  },
  'HC-08.5': ({ g }) => {
    const D = 1 - 4 * g
    if (D < -1e-12) {
      const im = Math.sqrt(-D) / 2
      return [im, Math.sqrt(g), Math.atan2(im, 0.5) / D2R]
    }
    const s = Math.sqrt(Math.max(0, D))
    const z1 = (1 + s) / 2
    const z2 = (1 - s) / 2
    return [z1, z2, Math.max(Math.abs(z1), Math.abs(z2))]
  },
  'HC-08.6': ({ d, g }) => {
    const gStar = 2 * Math.sin(Math.PI / (4 * d + 2))
    return [gStar, 20 * Math.log10(gStar / g), 90 - ((2 * d + 1) * Math.asin(g / 2)) / D2R]
  },
  'HC-08.7': ({ r, b, c, mu }) => {
    const tr = 1 + r
    const a0 = r + mu * b * c
    const D = tr * tr - 4 * a0
    const tail = [(1 - r) / (b * c), 1 - (mu * b * c) / (1 - r)]
    if (D < -1e-12) return [tr / 2, Math.sqrt(-D) / 2, Math.sqrt(a0), ...tail]
    const s = Math.sqrt(Math.max(0, D))
    const z1 = (tr + s) / 2
    const z2 = (tr - s) / 2
    return [z1, z2, Math.max(Math.abs(z1), Math.abs(z2)), ...tail]
  },
  'HC-08.8': ({ sigmaV, mu, C, d }) => {
    const kq = Math.sqrt(2 / Math.PI) / sigmaV
    const g = mu * kq * C
    const gStar = 2 * Math.sin(Math.PI / (4 * d + 2))
    return [g, 1 - g, gStar / (kq * C), 20 * Math.log10(gStar / g), 90 - ((2 * d + 1) * Math.asin(g / 2)) / D2R]
  },
}

/**
 * 預設值（本章 worked example）的完整步驟 TeX：由獨立的 Python 腳本（numpy／scipy，第一原理重算：brentq 找 crossover 與 g*、
 * numpy.roots／eigvals 求根、逐步遞迴）產生，不是從 handcalcs.ts 的輸出複製回來的。任何一步的代入數字或結果改變都會被抓到。
 */
const DEFAULT_STEPS: Record<string, string[]> = {
  'HC-08.1': [
    String.raw`\theta+180^\circ=(-150)^\circ+180^\circ=30^\circ`,
    String.raw`q=\left\lfloor\frac{\theta+180^\circ}{360^\circ}\right\rfloor=\left\lfloor\frac{30}{360}\right\rfloor=\lfloor0.083333\rfloor=0`,
    String.raw`(\theta+180^\circ)\bmod360^\circ=30^\circ-360^\circ\times0=30^\circ`,
    String.raw`\psi=\mathrm{wrap}_{180}(\theta)=30^\circ-180^\circ=-150^\circ`,
    String.raw`M_{\mathrm{polarity}}=90^\circ-|\psi|=90^\circ-150^\circ=-60^\circ`,
  ],
  'HC-08.2': [
    String.raw`p=1-g=1-1=0`,
    String.raw`\frac g2=\frac{1}{2}=0.5`,
    String.raw`\varphi=\arcsin\frac g2=\arcsin(0.5)=30^\circ`,
    String.raw`PM=90^\circ-\varphi=90^\circ-30^\circ=60^\circ`,
    String.raw`\omega_c=2\varphi\times\frac{\pi}{180^\circ}=2\times30\times0.017453=1.0472\ \mathrm{rad/block}`,
  ],
  'HC-08.3': [
    String.raw`\arcsin\frac g2=\arcsin\frac{1}{2}=\arcsin(0.5)=0.5236\ \mathrm{rad}`,
    String.raw`\omega_c=2\arcsin\frac g2=2\times0.5236=1.0472\ \mathrm{rad/block}`,
    String.raw`f_u=\frac{f_s}{N}=\frac{4000\ \mathrm{MHz}}{4096}=0.97656\ \mathrm{MHz}=976.56\ \mathrm{kHz}`,
    String.raw`f_c=\frac{\omega_c}{2\pi}\,f_u=\frac{1.0472}{6.2832}\times976.56\ \mathrm{kHz}=0.16667\times976.56\ \mathrm{kHz}=162.76\ \mathrm{kHz}`,
    String.raw`GM=\frac2g=\frac{2}{1}=2`,
    String.raw`GM_{\mathrm{dB}}=20\log_{10}(2)=6.0206\ \mathrm{dB}`,
    String.raw`PM\,[\mathrm{rad}]=\frac{\pi}{2}-\frac{\omega_c}{2}=1.5708-0.5236=1.0472`,
    String.raw`DM=\frac{PM\,[\mathrm{rad}]}{\omega_c}=\frac{1.0472}{1.0472}=1\ \text{blocks}`,
  ],
  'HC-08.4': [
    String.raw`\delta_{1}=\delta_{0}-g\,\delta_{-1}=1-0.5\times1=1-0.5=0.5`,
    String.raw`\delta_{2}=\delta_{1}-g\,\delta_{0}=0.5-0.5\times1=0.5-0.5=0`,
    String.raw`\delta_{3}=\delta_{2}-g\,\delta_{1}=0-0.5\times0.5=0-0.25=-0.25`,
    String.raw`\delta_{4}=\delta_{3}-g\,\delta_{2}=-0.25-0.5\times0=-0.25-0=-0.25`,
    String.raw`\delta_{5}=\delta_{4}-g\,\delta_{3}=-0.25-0.5\times(-0.25)=-0.25-(-0.125)=-0.125`,
  ],
  'HC-08.5': [
    String.raw`\Delta=1-4g=1-4\times0.5=1-2=-1`,
    String.raw`\mathrm{Re}\,z=\frac{1}{2}=0.5`,
    String.raw`\mathrm{Im}\,z=\pm\frac{\sqrt{-\Delta}}{2}=\pm\frac{\sqrt{1}}{2}=\pm\frac{1}{2}=\pm0.5`,
    String.raw`|z|^2=(\mathrm{Re}\,z)^2+(\mathrm{Im}\,z)^2=0.5^2+0.5^2=0.25+0.25=0.5`,
    String.raw`|z|=\sqrt{0.5}=0.70711`,
    String.raw`\angle z=\arctan\frac{\mathrm{Im}\,z}{\mathrm{Re}\,z}=\arctan\frac{0.5}{0.5}=\arctan(1)=45^\circ`,
  ],
  'HC-08.6': [
    String.raw`\frac{180^\circ}{4d+2}=\frac{180^\circ}{4\times2+2}=\frac{180^\circ}{10}=18^\circ`,
    String.raw`g^{*}(2)=2\sin18^\circ=2\times0.30902=0.61803`,
    String.raw`GM_d=\frac{0.61803}{0.3}=2.06011`,
    String.raw`GM_d\,[\mathrm{dB}]=20\log_{10}(2.06011)=6.2778\ \mathrm{dB}`,
    String.raw`\varphi=\arcsin\frac g2=\arcsin\frac{0.3}{2}=\arcsin(0.15)=8.62693^\circ`,
    String.raw`PM_d=90^\circ-(2d+1)\,\varphi=90^\circ-5\times8.62693^\circ=90^\circ-43.1346^\circ=46.865^\circ`,
  ],
  'HC-08.7': [
    String.raw`a_1=-(1+r_s)=-(1+0.8)=-1.8`,
    String.raw`a_0=r_s+\mu\,b_s\,c_s=0.8+1.2\times0.2\times1=0.8+0.24=1.04`,
    String.raw`\Delta=a_1^2-4a_0=(-1.8)^2-4\times1.04=3.24-4.16=-0.92`,
    String.raw`\mathrm{Re}\,z=-\frac{a_1}{2}=-\frac{-1.8}{2}=0.9`,
    String.raw`\mathrm{Im}\,z=\pm\frac{\sqrt{-\Delta}}{2}=\pm\frac{\sqrt{0.92}}{2}=\pm\frac{0.95917}{2}=\pm0.47958`,
    String.raw`|z|=\sqrt{a_0}=\sqrt{1.04}=1.0198`,
    String.raw`\mu_{\max}=\frac{1-r_s}{b_sc_s}=\frac{1-0.8}{0.2\times1}=\frac{0.2}{0.2}=1`,
    String.raw`g_{\mathrm{eff}}=\mu F(1)=\frac{\mu\,b_sc_s}{1-r_s}=\frac{0.24}{0.2}=1.2`,
    String.raw`p_{\mathrm{qs}}=1-g_{\mathrm{eff}}=1-1.2=-0.2`,
  ],
  'HC-08.8': [
    String.raw`\sqrt{\frac{2}{\pi}}=\sqrt{0.63662}=0.79788`,
    String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}=\frac{0.79788}{100\ \mathrm{fs}}=0.0079788\ \mathrm{fs}^{-1}`,
    String.raw`K=K_q\,C=0.0079788\ \mathrm{fs}^{-1}\times1=0.0079788\ \mathrm{fs}^{-1}`,
    String.raw`g=\mu\,K=10\ \mathrm{fs}\times0.0079788\ \mathrm{fs}^{-1}=0.079788`,
    String.raw`p=1-g=1-0.079788=0.92021`,
    String.raw`g^{*}(1)=2\sin\frac{180^\circ}{4\times1+2}=2\sin30^\circ=2\times0.5=1`,
    String.raw`\mu_{\max}=\frac{g^{*}(1)}{K}=\frac{1}{0.0079788\ \mathrm{fs}^{-1}}=125.33\ \mathrm{fs}`,
    String.raw`GM_d=\frac{1}{0.079788}=12.5331`,
    String.raw`GM_d\,[\mathrm{dB}]=20\log_{10}(12.5331)=21.961\ \mathrm{dB}`,
    String.raw`\varphi=\arcsin\frac g2=\arcsin\frac{0.079788}{2}=\arcsin(0.039894)=2.28638^\circ`,
    String.raw`PM_d=90^\circ-(2d+1)\,\varphi=90^\circ-3\times2.28638^\circ=90^\circ-6.85913^\circ=83.141^\circ`,
  ],
}

/**
 * 步驟 TeX 的「算式鏈」求值器（獨立於 handcalcs.ts）：把一步以頂層的 `=` 切段，凡是只含數字的段落就算出數值。
 * 只認得手算題用到的語法（\frac、\sqrt、\times、⌊⌋、\sin（度）、\arcsin／\arctan、20\log_{10}、\max、^2、a\times10^{b}、單位）。
 * 含符號的段落（\theta、g、\delta_{1}…）回傳 null；\arcsin 的單位看這一步的結果有沒有「°」。
 */
function splitTopLevel(tex: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of tex) {
    if (ch === '{' || ch === '(') depth++
    else if (ch === '}' || ch === ')') depth--
    if (ch === '=' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function segmentToJs(seg: string): string | null {
  let s = seg
    .replace(/\\ \\mathrm\{[A-Za-z/]+\}(\^\{-1\})?/g, '') // 單位：\ \mathrm{fs}^{-1}、\ \mathrm{kHz}…
    .replace(/\\ \\text\{[a-z]+\}/g, '')
    .replace(/\\left|\\right|\\big|\\,|\\pm|\^\\circ/g, '')
    .replace(/(\d(?:\.\d+)?)\\times10\^\{(-?\d+)\}/g, '($1e$2)')
    .replace(/(?<![\d.])10\^\{(-?\d+)\}/g, '(1e$1)')
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))')
  }
  s = s
    .replace(/\\times/g, '*')
    .replace(/\\lfloor/g, 'floor(')
    .replace(/\\rfloor/g, ')')
    .replace(/(\d)\\log_\{10\}/g, '$1*log10')
    .replace(/\\arcsin/g, 'asin')
    .replace(/\\arctan/g, 'atand')
    .replace(/(\d)\\sin\s*(\d+(?:\.\d+)?)/g, '$1*sind($2)')
    .replace(/(\d)\\sin\(/g, '$1*sind(')
    .replace(/\\max/g, 'max')
    .replace(/\^(\d)/g, '**$1')
  if (s.includes('\\') || /[{}|[\]]/.test(s)) return null
  if (/[A-Za-z_]/.test(s.replace(/sqrt|floor|log10|max|sind|asin|atand|\de-?\d/g, ''))) return null
  return s.trim() === '' ? null : s
}

interface ChainSegment {
  text: string
  value: number
  /** 這一段裡最大的數字（用來訂四捨五入的容許誤差） */
  scale: number
}

function evaluateChain(tex: string): ChainSegment[] {
  const segs = splitTopLevel(tex)
  const last = segs[segs.length - 1]
  const inDegrees = last.includes(String.raw`^\circ`)
  const toKHz = last.includes('kHz')
  const fns = {
    sqrt: Math.sqrt,
    floor: Math.floor,
    log10: Math.log10,
    max: Math.max,
    sind: (x: number) => Math.sin(x * D2R),
    asin: (x: number) => (inDegrees ? Math.asin(x) / D2R : Math.asin(x)),
    atand: (x: number) => Math.atan(x) / D2R,
  }
  const out: ChainSegment[] = []
  for (const text of segs) {
    const js = segmentToJs(text)
    if (js === null) continue
    const raw = new Function('f', `"use strict"; const { sqrt, floor, log10, max, sind, asin, atand } = f; return (${js})`)(fns) as number
    const literals = (js.match(/\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number)
    const unit = toKHz && text.includes('MHz') ? 1e3 : 1
    out.push({ text, value: raw * unit, scale: Math.max(0, ...literals) * unit })
  }
  return out
}

/** 一步裡所有「純數字」的等號段都要相等（容許顯示位數造成的四捨五入：最大數字的 2e-4 倍） */
function expectChainConsistent(tex: string, tag: string) {
  const chain = evaluateChain(tex)
  expect(chain.length, `${tag}：這一步沒有可驗算的數字段 ${tex}`).toBeGreaterThan(0)
  const final = chain[chain.length - 1]
  for (const seg of chain) {
    expect(Number.isFinite(seg.value), `${tag}：${seg.text}`).toBe(true)
    const tol = 2e-4 * Math.max(Math.abs(final.value), seg.scale, 1e-300)
    expect(Math.abs(seg.value - final.value), `${tag}：「${seg.text}」= ${seg.value} 與結果 ${final.value} 對不上（${tex}）`).toBeLessThanOrEqual(tol)
  }
  return chain
}

/** 字串內所有 `$…$` 片段（與共用元件 mathText 相同的切法） */
const inlineMath = (text: string): string[] => Array.from(text.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g), (m) => m[1])
/** 一份解答的所有 TeX 都能被 KaTeX 渲染；說明文字的 `$` 成對 */
function expectSolutionRenders(def: HandCalcDef, sol: HandCalcSolution, tag: string) {
  for (const s of sol.steps) {
    expect(renderTex(s.tex, true), `${tag} step: ${s.tex}`).not.toContain('katex-error')
    expect(s.tex, tag).not.toMatch(/NaN|undefined|Infinity|\\infty/)
    expect(s.why.trim().length, tag).toBeGreaterThan(5)
  }
  for (const r of sol.results) {
    const boxed = `\\boxed{${r.symbol} = ${texNum(r.value, r.digits ?? 5)}${r.unit ? `\\ ${r.unit}` : ''}}`
    expect(renderTex(boxed, true), `${tag} result: ${boxed}`).not.toContain('katex-error')
  }
  for (const text of [...sol.steps.map((s) => s.why), ...(sol.notes ?? []), ...(def.tips ?? []), def.title]) {
    expect((text.match(/(?<!\\)\$/g) ?? []).length % 2, `${tag} 的 $ 不成對：${text}`).toBe(0)
    expect(text, tag).not.toMatch(/NaN|undefined/)
    for (const m of inlineMath(text)) expect(renderTex(m, false), `${tag} inline: ${m}`).not.toContain('katex-error')
  }
}

describe('Ch08 handcalcs：題庫結構', () => {
  it('8 題、id 為 HC-08.1 … HC-08.8、頁面 /ch/08、公式 id 都在 FORMULAS 內、三種難度都有', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-08.1', 'HC-08.2', 'HC-08.3', 'HC-08.4', 'HC-08.5', 'HC-08.6', 'HC-08.7', 'HC-08.8'])
    const formulaIds = FORMULAS.map((f) => f.id)
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/08')
      expect(formulaIds, h.id).toContain(h.formulaId)
      expect(renderTex(h.formulaTex, true), h.id).not.toContain('katex-error')
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(2)
      for (const i of h.inputs) {
        expect(i.default, `${h.id}.${i.key}`).toBeGreaterThanOrEqual(i.min ?? -Infinity)
        expect(i.default, `${h.id}.${i.key}`).toBeLessThanOrEqual(i.max ?? Infinity)
        expect(i.practice, `${h.id}.${i.key} 要有 practice 範圍`).toBeDefined()
        // 輸入標籤是純文字（同時用在 aria-label）；符號另外以 TeX 顯示
        expect(i.label).not.toContain('$')
        expect(renderTex(i.symbol, false)).not.toContain('katex-error')
        if (i.unit) expect(renderTex(i.unit, false)).not.toContain('katex-error')
      }
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    expect(() => handcalc('HC-08.99')).toThrow()
  })

  it('公式登錄的 title／conditions（Formula Reference 頁以 mathText 顯示）：數學都在 $…$ 裡、$ 成對、KaTeX 可渲染', () => {
    for (const f of FORMULAS) {
      for (const text of [f.title, f.conditions]) {
        expect((text.match(/(?<!\\)\$/g) ?? []).length % 2, `${f.id} 的 $ 不成對：${text}`).toBe(0)
        for (const m of inlineMath(text)) expect(renderTex(m, false), `${f.id}: ${m}`).not.toContain('katex-error')
        const prose = text.replace(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g, ' ')
        expect(prose, `${f.id}：$…$ 外面還有用 Unicode／ASCII 拼的公式`).not.toMatch(/[μσδρωθφπΩλΔ²³√≤≥≠≈×±∠∞⇒⇔≪ᵀ⁻¹]|[A-Za-z]_[A-Za-z0-9{]|\^[0-9{]|[A-Za-z)]\s[<>=]\s/)
      }
    }
  })

  it('全站彙整的約定：檔案位於 src/chapters/ch08/handcalcs.ts 並以具名匯出 HANDCALCS（@/app/handcalcs 以 glob 收集；彙整本身由共用的 HandCalc.test.tsx 驗證）', async () => {
    // 不直接匯入 @/app/handcalcs：它會 eager 載入所有章節的題庫，本章的測試不應該被其他章節的編譯狀態影響
    const mod = await import('./handcalcs')
    expect(mod.HANDCALCS).toBe(HANDCALCS)
    expect(Array.isArray(mod.HANDCALCS)).toBe(true)
  })
})

describe('Ch08 handcalcs：(a) 預設值＝本章 worked example／golden vector／模型函式', () => {
  it('HC-08.1：θ = −150° ⇒ wrap = −150°、M = −60°（E20 反面測試）；θ = 200° ⇒ −70°；與 polarityMarginWrap／Arcsin 一致', () => {
    expect(values(solveDefault('HC-08.1'))).toEqual([-150, -60])
    const def = handcalc('HC-08.1')
    expect(values(def.solve({ theta: 200 }))).toEqual([-160, -70])
    for (const theta of [0, 45, 60, 89, 90, 120, 150, 180, 200, -150, 270, -300, 725, -1000.5]) {
      const [psi, M] = values(def.solve({ theta }))
      expect(psi).toBe(wrap180Spec(theta))
      expectClose(M, polarityMarginWrap(theta), 1e-12)
      expectClose(M, polarityMarginArcsin(theta), 1e-9)
    }
    // θ = 90°：M 恰為 0（不可顯示成 6e-17 之類的浮點尾巴）
    const sol90 = def.solve({ theta: 90 })
    expect(sol90.results[1].value).toBe(0)
    expect(sol90.notes?.join('')).toContain('沒有平均恢復力')
    // 負角度的 floor：θ = −300° ⇒ q = −1、餘數 240°、ψ = 60°、M = 30°
    const neg = def.solve({ theta: -300 })
    expect(neg.steps[1].tex).toContain('=-1')
    expect(values(neg)).toEqual([60, 30])
  })

  it('T08: HC-08.2 預設 g = 1 ⇒ pole 0、PM 60°、ω_c = π/3（golden vector T08 與 pmFirstOrder）', () => {
    const v = golden('T08')
    const tol = v.tolerance.abs ?? 1e-9
    const [p, pm, wc] = values(solveDefault('HC-08.2'))
    expectClose(p, v.expected.pole as number, tol)
    expectClose(pm, v.expected.pm_deg as number, tol)
    expectClose(wc, v.expected.crossover_omega_rad as number, tol)
    const def = handcalc('HC-08.2')
    const gs = v.inputs.g_list as number[]
    gs.forEach((g, i) => {
      const [pp, pmm, w] = values(def.solve({ g }))
      expectClose(pp, (v.expected.pole_list as number[])[i], tol)
      expectClose(pmm, (v.expected.pm_deg_list as number[])[i], tol)
      const r = pmFirstOrder(g)
      expect(w).toBe(r.omegaC)
    })
    // 思考題 2 的數字：g = 1.2 ⇒ pole −0.2、PM 53.13°
    const q2 = values(def.solve({ g: 1.2 }))
    expect(q2[0]).toBeCloseTo(-0.2, 12)
    expect(q2[1]).toBeCloseTo(53.13, 2)
  })

  it('T08: HC-08.3 預設（g = 1、f_s = 4 GHz、N = 4096）⇒ f_c = f_u/6 = 162.76 kHz、GM 6.02 dB、DM 1 block', () => {
    const [fc, gm, dm] = values(solveDefault('HC-08.3'))
    const r = pmFirstOrder(1)
    expect(updateRateHz(4e9, 4096)).toBe(976562.5)
    expect(fc).toBeCloseTo(976.5625 / 6, 9)
    expect(fc).toBeCloseTo(162.76, 2)
    expect(fc).toBe(omegaToHz(r.omegaC, updateRateHz(4e9, 4096)) / 1e3)
    expect(gm).toBeCloseTo(6.0206, 4)
    expect(gm).toBe(r.gmDb)
    expect(dm).toBeCloseTo(1, 12)
    // 換算函式本身：ω = π（Nyquist）⇔ f_u/2；ω = 2π ⇔ f_u
    expect(omegaToHz(Math.PI, 1000)).toBeCloseTo(500, 12)
    expect(omegaToHz(2 * Math.PI, 976562.5)).toBeCloseTo(976562.5, 6)
    // 硬體例子（μ = 10 fs ⇒ g = 0.0797885）：ω_c = 0.07981 rad/block、DM ≈ 19.18 blocks
    const g = 10 * comparatorKq(100)
    const hw = handcalc('HC-08.3').solve({ g, fs: 4000, N: 4096 })
    expect(hw.results[2].value).toBeCloseTo(19.18, 2)
    expect(hw.results[0].value).toBeCloseTo((0.07981 / (2 * Math.PI)) * 976.5625, 1)
  })

  it('HC-08.4 預設（g = 0.5、d = 1、δ0 = 1）⇒ 0.5, 0, −0.25, −0.25, −0.125（§8.3「先算一次」的表＝simulateDelayRecursion）', () => {
    const got = values(solveDefault('HC-08.4'))
    expect(got).toEqual([0.5, 0, -0.25, -0.25, -0.125])
    expect(got).toEqual(Array.from(simulateDelayRecursion(0.5, 1, HAND_BLOCKS).delta).slice(1))
    const def = handcalc('HC-08.4')
    // §8.2 的例子：d = 0、g = 1.5 ⇒ δ1 = −0.5、δ2 = 0.25
    expect(values(def.solve({ g: 1.5, d: 0, d0: 1 })).slice(0, 3)).toEqual([-0.5, 0.25, -0.125])
    // g = 1.2、d = 1：一階模型說穩定，實際振盪發散
    const div = def.solve({ g: 1.2, d: 1, d0: 1 })
    expect(values(div)).toEqual(Array.from(simulateDelayRecursion(1.2, 1, HAND_BLOCKS).delta).slice(1))
    expect(div.notes?.join('')).toContain('振盪發散')
    // 歷史值：k − d < 0 時用 δ0
    expect(def.solve({ g: 0.5, d: 2, d0: 4 }).steps[1].tex).toBe(String.raw`\delta_{2}=\delta_{1}-g\,\delta_{-1}=2-0.5\times4=2-2=0`)
  })

  it('T08: HC-08.5 預設 g = 0.5 ⇒ z = 0.5 ± j0.5、|z| = √0.5、45°；g = 1 ⇒ |z| = 1、角度 60° = ω*（golden delay_bounds）', () => {
    const [im, mod, ang] = values(solveDefault('HC-08.5'))
    expect(im).toBeCloseTo(0.5, 12)
    expect(mod).toBeCloseTo(Math.SQRT1_2, 12)
    expect(mod).toBe(delayStable(0.5, 1).rho)
    expect(ang).toBeCloseTo(45, 9)
    const def = handcalc('HC-08.5')
    const crit = values(def.solve({ g: 1 }))
    expect(crit[1]).toBeCloseTo(1, 12)
    expectClose(crit[2] * D2R, (golden('delay_bounds').expected.omega_crit_rad_list as number[])[1], 1e-9)
    // 實根分支：g = 0.24 ⇒ z = 0.6、0.4；重根 g = 0.25 ⇒ 0.5、0.5；g = 0 ⇒ 1、0；g < 0 ⇒ 有實根 > 1
    expect(values(def.solve({ g: 0.24 })).map((x) => Number(x.toFixed(9)))).toEqual([0.6, 0.4, 0.6])
    expect(values(def.solve({ g: 0.25 }))).toEqual([0.5, 0.5, 0.5])
    expect(values(def.solve({ g: 0 })).map((x) => Number(x.toFixed(9)))).toEqual([1, 0, 1])
    expect(def.solve({ g: -1 }).results[2].value).toBeCloseTo((1 + Math.sqrt(5)) / 2, 9)
  })

  it('T08: HC-08.6 預設（d = 2、g = 0.3）⇒ g* = 0.618034（golden delay_bounds）、PM_2 = 46.87°（§8.3 數值驗證表）、GM = 6.28 dB；思考題 3（g = 0.65）⇒ PM_2 = −4.83°；d = 0…6 都與 golden 一致', () => {
    const v = golden('delay_bounds')
    const list = v.expected.g_crit_list as number[]
    const [gStar, gm, pm] = values(solveDefault('HC-08.6'))
    expectClose(gStar, list[2], v.tolerance.abs ?? 1e-12)
    expect(gStar).toBe(delayCriticalGain(2))
    expect(pm).toBeCloseTo(46.87, 2)
    expect(pm).toBe(pmWithDelay(0.3, 2).pmDeg)
    expect(gm).toBeCloseTo(6.28, 2)
    expect(gm).toBe(pmWithDelay(0.3, 2).gmDb)
    const def = handcalc('HC-08.6')
    // 思考題 3／preset pm-d2-unstable：g = 0.65 ⇒ PM_2 = −4.83°、GM = −0.44 dB，一階模型卻以為有 71.03°
    const q3 = def.solve({ d: 2, g: 0.65 })
    expect(q3.results[2].value).toBeCloseTo(-4.83, 2)
    expect(q3.results[2].value).toBe(pmWithDelay(0.65, 2).pmDeg)
    expect(q3.results[1].value).toBeCloseTo(-0.438, 3)
    expect(q3.notes?.join('')).toContain('振盪發散')
    expect(q3.notes?.join('')).toContain(String.raw`71.03^\circ`)
    ;(v.inputs.d_list as number[]).forEach((d, i) => {
      const sol = def.solve({ d, g: 0.3 })
      expectClose(sol.results[0].value, list[i], v.tolerance.abs ?? 1e-12)
      expect(sol.results[2].value).toBeCloseTo(pmWithDelay(0.3, d).pmDeg, 12)
    })
    // d = 0 退化成 §8.2：g* = 2、GM = 2/g、PM = 90° − asin(g/2)
    const d0 = values(def.solve({ d: 0, g: 1 }))
    expect(d0[0]).toBeCloseTo(2, 12)
    expect(d0[1]).toBeCloseTo(pmFirstOrder(1).gmDb, 12)
    expect(d0[2]).toBeCloseTo(60, 12)
    // 思考題 5：d = 1、g = 0.5 ⇒ GM = 6.02 dB
    expect(def.solve({ d: 1, g: 0.5 }).results[1].value).toBeCloseTo(6.0206, 4)
  })

  it('T09: HC-08.7 預設（r_s = 0.8、b_s = 0.2、c_s = 1、μ = 1.2）⇒ 0.9 ± j0.4796、|z| = 1.0198、μ_max = 1、quasi-static pole −0.2（golden vector T09）', () => {
    const v = golden('T09')
    const tol = Math.max(v.tolerance.abs ?? 0, 1e-12)
    const sol = solveDefault('HC-08.7')
    const [re, im, mod, muMax, pqs] = values(sol)
    expectClose(re, v.expected.pole_re as number, tol)
    expectClose(im, v.expected.pole_im as number, tol)
    expectClose(mod, v.expected.pole_abs as number, tol)
    expectClose(muMax, v.expected.mu_max_full as number, tol)
    expectClose(pqs, v.expected.simplified_pole_at_mu as number, tol)
    expect(mod).toBeCloseTo(1.0198, 4)
    expect(im).toBeCloseTo(0.4796, 4)
    const an = analyzeDualLoop({ r: 0.8, b: 0.2, c: 1, mu: 1.2 })
    expect(mod).toBe(an.rho)
    expect(muMax).toBe(an.fullRange.hi)
    // 步驟裡的特徵式係數＝golden 的 char_poly [1, −1.8, 1.04]
    expect(sol.steps[0].tex).toContain('=-1.8')
    expect(sol.steps[1].tex).toContain('=1.04')
    expect(sol.steps[2].tex).toContain('=-0.92')
    expect(sol.notes?.join('')).toContain('簡化模型給出相反的結論')
    // quasi-static 上界 2（golden mu_max_simplified）恰為 2 倍
    expectClose(an.simplifiedRange.hi, v.expected.mu_max_simplified as number, tol)
    expect(sol.notes?.join('')).toContain(String.raw`\frac{2(1-r_s)}{b_sc_s}=2`)
  })

  it('T09: HC-08.7 的 E19 數值——μ = 0.5 ⇒ ρ = 0.9487（簡化 0.5）；μ = 0.05 ⇒ 重根 0.9；μ = 0.02 ⇒ 兩個實根；r_s = 0 ⇒ 就是 d = 1', () => {
    const def = handcalc('HC-08.7')
    const half = def.solve({ r: 0.8, b: 0.2, c: 1, mu: 0.5 })
    expect(half.results[2].value).toBeCloseTo(0.9487, 4)
    expect(half.results[4].value).toBeCloseTo(0.5, 12)
    expect(half.notes?.join('')).toContain(texNum(dualLoopGainMargin({ r: 0.8, b: 0.2, c: 1, mu: 0.5 }).gmFullDb, 3))
    const dbl = def.solve({ r: 0.8, b: 0.2, c: 1, mu: 0.05 })
    expect(dbl.results.map((r) => r.symbol).slice(0, 3)).toEqual(['z_1', 'z_2', String.raw`\rho`])
    expect(dbl.results[0].value).toBeCloseTo(0.9, 9)
    expect(dbl.results[1].value).toBeCloseTo(0.9, 9)
    expect(dbl.results[2].value).toBeCloseTo(0.9, 6)
    const real = def.solve({ r: 0.8, b: 0.2, c: 1, mu: 0.02 })
    const an = analyzeDualLoop({ r: 0.8, b: 0.2, c: 1, mu: 0.02 })
    expect(real.results[2].value).toBe(an.rho)
    expect(real.results[0].value + real.results[1].value).toBeCloseTo(1.8, 9)
    expect(real.results[0].value * real.results[1].value).toBeCloseTo(0.804, 9)
    // r_s = 0、b_s c_s = 1：與 HC-08.5（d = 1、g = μ）同一組根
    const d1 = def.solve({ r: 0, b: 1, c: 1, mu: 0.5 })
    const ref = handcalc('HC-08.5').solve({ g: 0.5 })
    expect(d1.results[1].value).toBeCloseTo(ref.results[0].value, 12)
    expect(d1.results[2].value).toBeCloseTo(ref.results[1].value, 12)
    expect(d1.notes?.join('')).toContain('HC-08.5')
  })

  it('T08: HC-08.8 預設（σ_v = 100 fs、μ = 10 fs、C = 1、d = 1）⇒ g = 0.0797885、p = 0.92021（golden T13）、μ_max = 125.33 fs；d = 0／2 ⇒ 250.66／77.46 fs', () => {
    const t13 = golden('T13')
    const tol = t13.tolerance.abs ?? 1e-9
    const [g, p, muMax, gm, pm] = values(solveDefault('HC-08.8'))
    expectClose(g, t13.expected.g as number, tol)
    expectClose(p, t13.expected.p as number, tol)
    expect(muMax).toBeCloseTo(125.3314, 4)
    expect(pm).toBe(pmWithDelay(g, 1).pmDeg)
    expect(pm).toBeCloseTo(83.14, 2)
    expect(gm).toBe(pmWithDelay(g, 1).gmDb)
    expect(gm).toBeCloseTo(20 * Math.log10(125.3314 / 10), 4)
    const def = handcalc('HC-08.8')
    expect(def.solve({ sigmaV: 100, mu: 10, C: 1, d: 0 }).results[2].value).toBeCloseTo(250.6628, 4)
    expect(def.solve({ sigmaV: 100, mu: 10, C: 1, d: 2 }).results[2].value).toBeCloseTo(77.4591, 4)
    expect(def.solve({ sigmaV: 100, mu: 10, C: 1, d: 0 }).results[4].value).toBeCloseTo(87.71, 2)
    // 步驟裡的 K_q＝comparatorKq（golden T13 的 K_per_fs）
    expectClose(comparatorKq(100), t13.expected.K_per_fs as number, tol)
    expect(solveDefault('HC-08.8').steps[1].tex).toContain(texNum(comparatorKq(100)))
  })

  it('步驟、提示裡寫死的常數與近似式的適用範圍都經過驗算（不是憑印象寫的）', () => {
    const all = HANDCALCS.flatMap((h) => [...(h.tips ?? []), ...h.solve(defaultValues(h)).steps.flatMap((s) => [s.tex, s.why])]).join('\n')
    // 常數：π/180、180/π、2π、π/2、2/π、√(2/π)、57.296/2
    const constants: [string, number, number][] = [
      ['0.017453', Math.PI / 180, 6],
      ['57.296', 180 / Math.PI, 3],
      ['6.2832', 2 * Math.PI, 4],
      ['1.5708', Math.PI / 2, 4],
      ['0.63662', 2 / Math.PI, 5],
      ['0.79788', Math.sqrt(2 / Math.PI), 5],
      ['28.65', 90 / Math.PI, 2],
    ]
    for (const [text, value, digits] of constants) {
      expect(all, text).toContain(text)
      expect(Number(text), text).toBeCloseTo(value, digits)
    }
    // HC-08.2 的 arcsin 小抄
    const table: [number, number][] = [[0.1, 5.74], [0.25, 14.48], [0.5, 30], [0.6, 36.87], [0.75, 48.59]]
    for (const [x, degrees] of table) {
      expect(Math.asin(x) / D2R).toBeCloseTo(degrees, 2)
      expect(all).toContain(String.raw`\arcsin${x}=${degrees}^\circ`)
    }
    // 近似式的適用範圍：arcsin x ≈ x（x ≤ 0.25 誤差 < 1.1%）、ω_c ≈ g（g ≤ 0.5 誤差 < 1.1%）、ω_c ≈ g + g³/24（g ≤ 1 誤差 < 0.6%）
    expect(Math.abs(0.25 / Math.asin(0.25) - 1)).toBeLessThan(0.011)
    expect(Math.abs(0.5 / pmFirstOrder(0.5).omegaC - 1)).toBeLessThan(0.011)
    for (const g of [0.25, 0.5, 0.75, 1]) expect(Math.abs((g + g ** 3 / 24) / pmFirstOrder(g).omegaC - 1)).toBeLessThan(0.006)
    // g*(d) ≈ π/(2d + 1)（d ≥ 3 誤差 < 1%）；d = 2 時 g* = (√5 − 1)/2
    for (const d of [3, 4, 5, 6]) expect(Math.abs(Math.PI / (2 * d + 1) / delayCriticalGain(d) - 1)).toBeLessThan(0.01)
    expect(delayCriticalGain(2)).toBeCloseTo((Math.sqrt(5) - 1) / 2, 12)
    // HC-08.4 提示：g = 1.25、d = 1 的振幅越來越大（ρ = √1.25 > 1）
    expect(delayStable(1.25, 1).rho).toBeCloseTo(Math.sqrt(1.25), 12)
    // HC-08.6 提示：GM_d 與 PM_d 同號（0 < g ≤ 2）
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      for (const g of [0.1, 0.3, 0.6, 0.9, 1.2, 1.9]) {
        const pm = pmWithDelay(g, d)
        expect(Math.sign(pm.gmDb), `d=${d} g=${g}`).toBe(Math.sign(pm.pmDeg))
      }
    }
  })

  it('手算答案四捨五入到 3 位有效數字都會被判定為正確（預設值）', () => {
    for (const h of HANDCALCS) {
      for (const r of h.solve(defaultValues(h)).results) {
        expect(checkAnswer(Number(r.value.toPrecision(3)), r).ok, `${h.id} ${r.symbol}`).toBe(true)
      }
    }
  })
})

describe('Ch08 handcalcs：(a2) 每一步的算式都對得起來（人照著按計算機會得到同一個數字）', () => {
  it('算式鏈求值器本身：分數、根號、⌊⌋、sin（度）、arcsin（度／rad）、log、10 的次方、單位換算', () => {
    const v = (tex: string) => evaluateChain(tex).map((c) => Number(c.value.toPrecision(6)))
    expect(v(String.raw`x=\frac{1+0.2}{2}=0.6`)).toEqual([0.6, 0.6])
    expect(v(String.raw`\mathrm{Im}\,z=\pm\frac{\sqrt{-\Delta}}{2}=\pm\frac{\sqrt{0.92}}{2}=\pm\frac{0.95917}{2}=\pm0.47958`)).toEqual([0.479583, 0.479585, 0.47958])
    expect(v(String.raw`q=\left\lfloor\frac{-120}{360}\right\rfloor=\lfloor-0.33333\rfloor=-1`)).toEqual([-1, -1, -1])
    expect(v(String.raw`g^{*}(2)=2\sin18^\circ=2\times0.30902=0.61803`)).toEqual([0.618034, 0.61804, 0.61803])
    expect(v(String.raw`\varphi=\arcsin(0.5)=30^\circ`)).toEqual([30, 30])
    expect(v(String.raw`\arcsin(0.5)=0.5236\ \mathrm{rad}`)).toEqual([0.523599, 0.5236])
    expect(v(String.raw`GM=20\log_{10}(2)=6.0206\ \mathrm{dB}`)).toEqual([6.0206, 6.0206])
    expect(v(String.raw`\Delta=1-4\times0.2500001=1-1.0000004=-4\times10^{-7}`)).toEqual([-4e-7, -4e-7, -4e-7])
    expect(v(String.raw`f_u=\frac{4000\ \mathrm{MHz}}{4096}=0.97656\ \mathrm{MHz}=976.56\ \mathrm{kHz}`)).toEqual([976.563, 976.56, 976.56])
    expect(v(String.raw`\Delta=(-1.8)^2-4\times1.04=3.24-4.16=-0.92`)).toEqual([-0.92, -0.92, -0.92])
    // 抓得到錯：代入的數字和結果對不上
    expect(() => expectChainConsistent(String.raw`p=1-g=1-0.3=0.8`, 'bad')).toThrow()
    expect(() => expectChainConsistent(String.raw`\varphi=\arcsin(0.5)=0.5236^\circ`, 'bad')).toThrow() // 度／rad 搞錯
  })

  it('預設值的每一步＝獨立的 Python 第一原理重算（逐字比對 TeX）', () => {
    for (const h of HANDCALCS) {
      const got = h.solve(defaultValues(h)).steps.map((s) => s.tex)
      expect(got, h.id).toEqual(DEFAULT_STEPS[h.id])
    }
  })

  it('HC-08.6／HC-08.8 的 GM_d 那一步：算式只留代入的數字（375px 的卡片才放得下，不會多一條只差幾 px 的捲軸），通式 GM_d = g*/g 改寫在同一步的說明與題目的 formulaTex 裡', () => {
    for (const id of ['HC-08.6', 'HC-08.8']) {
      const def = handcalc(id)
      const step = solveDefault(id).steps.find((s) => s.tex.startsWith('GM_d='))
      expect(step, id).toBeTruthy()
      expect(step!.tex, id).toMatch(/^GM_d=\\frac\{[\d.]+\}\{[\d.]+\}=[\d.]+$/)
      expect(step!.why, id).toContain(String.raw`$GM_d=\frac{g^{*}}{g}$`)
      expect(def.formulaTex, id).toContain(String.raw`GM_d=\frac{g^{*}(d)}{g}`)
    }
  })

  it('HC-08.8 的通式分成兩行（aligned，和 HC-08.7 相同）：七個式子排成一行比桌機的正文欄寬，會多出一條橫向捲軸；七個式子都還在', () => {
    const tex = handcalc('HC-08.8').formulaTex
    expect(tex.startsWith(String.raw`\begin{aligned}&`) && tex.endsWith(String.raw`\end{aligned}`)).toBe(true)
    const rows = tex.slice(String.raw`\begin{aligned}`.length, -String.raw`\end{aligned}`.length).split(/\\\\(?:\[[^\]]*\])?/)
    expect(rows).toHaveLength(2)
    expect(rows[0].split(String.raw`,\qquad `)).toEqual([String.raw`&K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`, 'K=K_qC', String.raw`g=\mu K`, 'p=1-g'])
    expect(rows[1].split(String.raw`,\qquad `)).toEqual([String.raw`&\mu_{\max}(d)=\frac{g^{*}(d)}{K}`, String.raw`GM_d=\frac{g^{*}(d)}{g}`, String.raw`PM_d=90^\circ-(2d+1)\arcsin\frac g2`])
  })

  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值與 20 組隨機題的每一步，等號兩邊的數字都對得起來', (id, def) => {
    for (const v of [defaultValues(def), ...SEEDS.map((seed) => randomValues(def, seed))]) {
      const sol = def.solve(v)
      sol.steps.forEach((s, k) => {
        const chain = expectChainConsistent(s.tex, `${id} ${JSON.stringify(v)} 第 ${k + 1} 步`)
        // 「符號式 = 代入數字 = 結果」：至少要有一段代入的算式和一個結果（寫死常數的那一步除外）
        expect(chain.length, `${id} 第 ${k + 1} 步：${s.tex}`).toBeGreaterThanOrEqual(2)
      })
    }
  })

  it('使用者輸入的數字照原樣代入（不被四捨五入成 5 位）：g = 0.0797885、g = 0.2500001、θ = 123.456789°', () => {
    const g = 0.0797885
    const hc2 = handcalc('HC-08.2').solve({ g })
    expect(hc2.steps[0].tex).toBe(String.raw`p=1-g=1-0.0797885=0.9202115`)
    expect(hc2.steps[1].tex).toBe(String.raw`\frac g2=\frac{0.0797885}{2}=0.03989425`)
    hc2.steps.forEach((s, k) => expectChainConsistent(s.tex, `HC-08.2 第 ${k + 1} 步`))
    const hc3 = handcalc('HC-08.3').solve({ g, fs: 4000, N: 4096 })
    expect(hc3.steps[0].tex).toContain(String.raw`\arcsin\frac{0.0797885}{2}=\arcsin(0.03989425)`)
    hc3.steps.forEach((s, k) => expectChainConsistent(s.tex, `HC-08.3 第 ${k + 1} 步`))
    // 判別式接近 0：1 − 4g 不可顯示成 1 − 1
    for (const gg of [0.2500001, 0.2499999]) {
      const hc5 = handcalc('HC-08.5').solve({ g: gg })
      expect(hc5.steps[0].tex).toContain(gg > 0.25 ? String.raw`=1-1.0000004=-4\times10^{-7}` : String.raw`=1-0.9999996=4\times10^{-7}`)
      hc5.steps.forEach((s, k) => expectChainConsistent(s.tex, `HC-08.5 g=${gg} 第 ${k + 1} 步`))
    }
    const hc1 = handcalc('HC-08.1').solve({ theta: 123.456789 })
    expect(hc1.steps[0].tex).toBe(String.raw`\theta+180^\circ=123.456789^\circ+180^\circ=303.456789^\circ`)
    expect(hc1.steps[4].tex).toBe(String.raw`M_{\mathrm{polarity}}=90^\circ-|\psi|=90^\circ-123.456789^\circ=-33.456789^\circ`)
    expect(hc1.results.map((r) => texNum(r.value, r.digits ?? 5))).toEqual(['123.456789', '-33.456789'])
    // 雙迴路：非整齊的輸入也要逐步對得起來
    const hc7 = handcalc('HC-08.7').solve({ r: 0.8125, b: 0.1875, c: 1.5, mu: 0.3333 })
    hc7.steps.forEach((s, k) => expectChainConsistent(s.tex, `HC-08.7 第 ${k + 1} 步`))
    const hc8 = handcalc('HC-08.8').solve({ sigmaV: 87.5, mu: 11.2, C: 0.9, d: 3 })
    hc8.steps.forEach((s, k) => expectChainConsistent(s.tex, `HC-08.8 第 ${k + 1} 步`))
  })

  it('HC-08.1：反面教材的方向——θ = −150° 是「把極性錯誤看成正的」，θ = −60° 是「把極性正確看成負的」', () => {
    const def = handcalc('HC-08.1')
    expect(def.solve({ theta: -150 }).notes?.join('')).toContain('把極性錯誤看成正的 margin')
    const ok = def.solve({ theta: -60 })
    expect(values(ok)).toEqual([-60, 30])
    expect(ok.notes?.join('')).toContain(String.raw`會得到 $-30^\circ$`)
    expect(ok.notes?.join('')).toContain('把極性正確看成負的 margin')
    // 兩種寫法同號時不出現反面教材
    expect(def.solve({ theta: 45 }).notes?.join('')).not.toContain('反面教材')
  })

  it('HC-08.4：會不會衝過頭由同一個遞迴決定；門檻 d^d/(d+1)^{d+1} 與模擬的變號一致', () => {
    expect([0, 1, 2, 3].map(delayNoOvershootGain)).toEqual([1, 1 / 4, 4 / 27, 27 / 256])
    const flips = (g: number, d: number, n: number) => Array.from(simulateDelayRecursion(g, d, n).delta).some((x) => x < 0)
    for (const d of [1, 2, 3]) {
      const thr = delayNoOvershootGain(d)
      expect(flips(thr, d, 5000), `d=${d} g=門檻`).toBe(false)
      expect(flips(thr * 0.5, d, 5000), `d=${d} g=門檻/2`).toBe(false)
      expect(flips(thr * 1.02, d, 5000), `d=${d} g=1.02×門檻`).toBe(true)
      // 門檻的來源：g ≤ 門檻 ⇔ 特徵式有正實根（最大的根是實數）
      const below = delayStable(thr * 0.98, d).roots[0]
      const above = delayStable(thr * 1.05, d).roots[0]
      expect(Math.abs(below.im)).toBeLessThan(1e-9)
      expect(Math.abs(above.im)).toBeGreaterThan(1e-3)
    }
    const def = handcalc('HC-08.4')
    // g = 0.25、d = 1（「換一題」會抽到）：不會衝過頭——舊版備註寫「所以會衝過頭」是錯的
    const smooth = def.solve({ g: 0.25, d: 1, d0: 1 })
    expect(values(smooth)).toEqual([0.75, 0.5, 0.3125, 0.1875, 0.109375])
    expect(smooth.notes?.join('')).toContain('不會變號')
    expect(smooth.notes?.join('')).not.toContain('衝過頭）')
    expect(flips(0.25, 1, OVERSHOOT_BLOCKS)).toBe(false)
    // 預設 g = 0.5、d = 1：δ3 第一次變號
    expect(solveDefault('HC-08.4').notes?.join('')).toContain(String.raw`$\delta_k$ 在 $k=3$ 第一次變號`)
    // g = 0.25、d = 2 > 4/27：k = 5 變號
    expect(def.solve({ g: 0.25, d: 2, d0: 4 }).notes?.join('')).toContain(String.raw`$k=5$ 第一次變號`)
    // g > 1：一階模型自己就正負交替，不把變號歸因給延遲；ρ 由 |1 − g| 變大
    const fast = def.solve({ g: 1.5, d: 1, d0: 2 })
    expect(fast.notes?.join('')).toContain('就算沒有延遲')
    expect(fast.notes?.join('')).toContain(String.raw`$|1-g|=0.5$ 變大成 $${texNum(delayStable(1.5, 1).rho)}$`)
    // g 只比門檻大一點：200 個 block 內看不到變號，備註不可說「夠小」
    //（g = 0.25001：根的角度只有 atan√(4g − 1) ≈ 0.36°，第一次過零大約在第 500 個 block）
    const edge = def.solve({ g: 0.25001, d: 1, d0: 1 })
    expect(flips(0.25001, 1, OVERSHOOT_BLOCKS)).toBe(false)
    expect(flips(0.25001, 1, 600)).toBe(true)
    expect(edge.notes?.join('')).toContain('遲早會變號')
    expect(edge.notes?.join('')).not.toContain('夠小')
  })

  it('HC-08.4：「換一題」的所有組合，δ_1…δ_5 都是有限小數而且照原樣顯示（不四捨五入）', () => {
    const def = handcalc('HC-08.4')
    const [gs, ds, d0s] = def.inputs.map((i) => i.practice?.choices ?? [])
    for (const g of gs) {
      for (const d of ds) {
        for (const d0 of d0s) {
          const sol = def.solve({ g, d, d0 })
          for (const r of sol.results) {
            expect(r.digits).toBe(10)
            expect(Number(texNum(r.value, r.digits)), `g=${g} d=${d} δ0=${d0} ${r.symbol}`).toBe(r.value)
          }
          sol.steps.forEach((s, k) => expectChainConsistent(s.tex, `HC-08.4 g=${g} d=${d} δ0=${d0} 第 ${k + 1} 步`))
        }
      }
    }
  })

  it('HC-08.7：quasi-static 是樂觀還是保守，直接比較 |p_qs| 與 ρ（不寫「兩者接近」）', () => {
    const def = handcalc('HC-08.7')
    const cases: [Record<string, number>, string][] = [
      [{ r: 0.8, b: 0.2, c: 1, mu: 0.5 }, '比實際樂觀'], // |p_qs| = 0.5 < ρ = 0.9487
      [{ r: 0.8, b: 0.2, c: 1, mu: 0.05 }, '比實際保守'], // 重根 0.9 < p_qs = 0.95
      [{ r: 0.6, b: 0.25, c: 1, mu: 0.1 }, '比實際保守'], // 實根 0.92247 < p_qs = 0.9375
      [{ r: 0, b: 0.25, c: 1, mu: 1.2 }, '比實際保守'], // 複數根 √0.3 = 0.5477 < p_qs = 0.7
    ]
    for (const [v, word] of cases) {
      const an = analyzeDualLoop(v as { r: number; b: number; c: number; mu: number })
      expect(Math.abs(an.simplifiedPole) < an.rho, JSON.stringify(v)).toBe(word === '比實際樂觀')
      const note = def.solve(v).notes?.join('') ?? ''
      expect(note, JSON.stringify(v)).toContain(word)
      expect(note).not.toContain('兩者接近')
    }
  })
})

describe('Ch08 handcalcs：(b) 隨機出題（20 個 seed）', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：solve() 有限、等於獨立重算、TeX 可渲染、3 位有效數字的答案判為正確', (id, def) => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同一個 seed 可重現
      expect(def.validate?.(v) ?? null, `${id} seed ${seed}`).toBeNull()
      seen.add(JSON.stringify(v))
      const sol = def.solve(v)
      const want = INDEPENDENT[id](v)
      expect(sol.results.length, id).toBe(want.length)
      expect(sol.steps.length, id).toBeGreaterThan(0)
      sol.results.forEach((r, i) => {
        expect(Number.isFinite(r.value), `${id} seed ${seed} ${r.symbol}`).toBe(true)
        expectClose(r.value, want[i], 1e-7, `${id} seed ${seed} ${JSON.stringify(v)} ${r.symbol}: ${r.value} vs ${want[i]}`)
        expect(checkAnswer(Number(r.value.toPrecision(3)), r).ok, `${id} seed ${seed} ${r.symbol}`).toBe(true)
      })
      expectSolutionRenders(def, sol, `${id} seed ${seed}`)
    }
    // 「換一題」真的會換數字
    expect(seen.size, id).toBeGreaterThan(1)
  })
})

describe('Ch08 handcalcs：(c) validate 擋掉模型不適用的輸入，並說明原因', () => {
  const rejects = (id: string, v: Record<string, number>, pattern: RegExp) => {
    const def = handcalc(id)
    const msg = def.validate?.({ ...defaultValues(def), ...v })
    expect(msg, `${id} ${JSON.stringify(v)}`).toMatch(pattern)
    for (const m of inlineMath(msg ?? '')) expect(renderTex(m, false), `${id}: ${m}`).not.toContain('katex-error')
    expect(((msg ?? '').match(/(?<!\\)\$/g) ?? []).length % 2).toBe(0)
  }
  const accepts = (id: string, v: Record<string, number>) => {
    const def = handcalc(id)
    expect(def.validate?.({ ...defaultValues(def), ...v }) ?? null, `${id} ${JSON.stringify(v)}`).toBeNull()
  }

  it('g ≤ 0（極性錯誤／沒有更新）與 g > 2（沒有 crossover）：HC-08.2、HC-08.3、HC-08.6 都拒絕；g = 2（臨界）可以算', () => {
    for (const id of ['HC-08.2', 'HC-08.3', 'HC-08.6']) {
      rejects(id, { g: 0 }, /極性錯誤/)
      rejects(id, { g: -0.1 }, /極性錯誤/)
      rejects(id, { g: 2.2 }, /沒有 gain crossover/)
      accepts(id, { g: 2 })
      accepts(id, { g: 0.001 })
    }
    // g = 2：PM = 0°、DM = 0、GM = 0 dB，全部有限
    expect(values(handcalc('HC-08.2').solve({ g: 2 }))).toEqual([-1, 0, Math.PI])
    const crit = values(handcalc('HC-08.3').solve({ g: 2, fs: 4000, N: 4096 }))
    expect(crit[1]).toBe(0)
    expect(crit[2]).toBe(0)
    expect(handcalc('HC-08.2').solve({ g: 2 }).notes?.join('')).toContain('臨界')
  })

  it('HC-08.4：δ0 = 0 沒有動態可看；g < 0（極性錯誤）仍可手算，並在備註說明不會收斂', () => {
    rejects('HC-08.4', { d0: 0 }, /非零的初始誤差/)
    accepts('HC-08.4', { g: -0.5 })
    const sol = handcalc('HC-08.4').solve({ g: -0.5, d: 1, d0: 1 })
    expect(values(sol)).toEqual([1.5, 2, 2.75, 3.75, 5.125])
    expect(sol.notes?.join('')).toContain('極性錯誤')
  })

  it('HC-08.7：|r_s| ≥ 1（觀測沒有穩態）、b_s c_s = 0（不可觀測）、b_s c_s < 0（極性錯誤）、μ ≤ 0 都拒絕', () => {
    rejects('HC-08.7', { r: 1 }, /沒有穩態/)
    rejects('HC-08.7', { r: 1.1 }, /沒有穩態/)
    rejects('HC-08.7', { r: -1 }, /沒有穩態/)
    rejects('HC-08.7', { b: 0 }, /不可觀測/)
    rejects('HC-08.7', { c: 0 }, /不可觀測/)
    rejects('HC-08.7', { b: -0.2 }, /極性/)
    rejects('HC-08.7', { c: -1 }, /極性/)
    rejects('HC-08.7', { mu: 0 }, /沒有更新/)
    rejects('HC-08.7', { mu: -0.5 }, /沒有更新|方向相反/)
    accepts('HC-08.7', { b: -0.2, c: -1 }) // 兩個負號相乘：b_s c_s > 0，極性正確
    accepts('HC-08.7', { r: -0.5 })
  })

  it('HC-08.8：C ≤ 0（極性／沒有恢復力）與 g = μK_qC > 2 都拒絕，訊息含 μ 的上限', () => {
    rejects('HC-08.8', { C: 0 }, /沒有恢復力/)
    rejects('HC-08.8', { C: -0.5 }, /極性錯誤/)
    rejects('HC-08.8', { mu: 300 }, /250\.66/)
    accepts('HC-08.8', { mu: 250 })
  })

  it('整數／範圍限制：d 必須是 0…6 的整數、N 必須是正整數（由 HandCalc 的輸入檢查擋下，不會進到 solve）', () => {
    const d = handcalc('HC-08.6').inputs.find((i) => i.key === 'd')!
    expect(d.integer).toBe(true)
    expect([d.min, d.max]).toEqual([0, 6])
    const N = handcalc('HC-08.3').inputs.find((i) => i.key === 'N')!
    expect(N.integer).toBe(true)
    expect(N.min).toBe(1)
    const { container, getByLabelText } = render(<HandCalc def={handcalc('HC-08.6')} />)
    fireEvent.change(getByLabelText(/更新延遲/), { target: { value: '7' } })
    expect(container.textContent).toContain('不可大於 6')
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    fireEvent.change(getByLabelText(/更新延遲/), { target: { value: '1.5' } })
    expect(container.textContent).toContain('必須是整數')
  })
})

describe('Ch08 handcalcs：(d) <HandCalc> 渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值渲染出所有步驟、沒有 KaTeX 錯誤、沒有殘留的 $ 或 NaN', (id, def) => {
    const sol = def.solve(defaultValues(def))
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.querySelector(`#handcalc-${id.replace('.', '\\.')}`)).not.toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expectNoTexErrors(container)
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll('annotation').forEach((el) => el.remove())
    expect(prose.textContent).not.toContain('$')
    expect(prose.textContent).not.toMatch(/NaN|undefined/)
    unmount()
  })

  it('HC-08.2：改成 g = 2.5 會顯示原因（沒有 gain crossover）而不是步驟；改回 1.2 得到 PM = 53.13°', () => {
    const { container, getByLabelText } = render(<HandCalc def={handcalc('HC-08.2')} />)
    const input = getByLabelText(/正規化 loop gain/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2.5' } })
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('沒有 gain crossover')
    expectNoTexErrors(container)
    fireEvent.change(input, { target: { value: '1.2' } })
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('53.13')
  })

  it('HC-08.7：把 b_s 改成負的會顯示極性錯誤的原因；μ 改成 0.5 會切到「都穩定」的結論', () => {
    const { container, getByLabelText } = render(<HandCalc def={handcalc('HC-08.7')} />)
    fireEvent.change(getByLabelText(/誤差進入觀測狀態的耦合/), { target: { value: '-0.2' } })
    expect(container.querySelector('.callout-warn')?.textContent).toContain('極性')
    expectNoTexErrors(container)
    fireEvent.change(getByLabelText(/誤差進入觀測狀態的耦合/), { target: { value: '0.2' } })
    fireEvent.change(getByLabelText(/正規化步長/), { target: { value: '0.5' } })
    expect(container.textContent).toContain('完整模型穩定')
    expect(container.textContent).toContain('0.94868')
  })

  it('HC-08.4：「自己算算看」模式先藏起步驟，填對 5 個 δ 之後全部判為正確', () => {
    const { container, getAllByPlaceholderText, getByText } = render(<HandCalc def={handcalc('HC-08.4')} initialMode="practice" />)
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    const boxes = getAllByPlaceholderText('你的答案')
    expect(boxes).toHaveLength(HAND_BLOCKS)
    ;['0.5', '0', '-0.25', '-0.25', '-0.125'].forEach((ans, i) => fireEvent.change(boxes[i], { target: { value: ans } }))
    fireEvent.click(getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok')).toHaveLength(HAND_BLOCKS)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad')).toHaveLength(0)
  })
})
