import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, listRegions, randomValues, texNum } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import quantSrc from '@/simulation/models/quantizer.ts?raw'
import {
  LF_OSR_DIV,
  TOGGLE_PATTERN_5,
  bernoulliMoments,
  ditherVariance,
  efbConstant,
  efbInbandWhite,
  efbPeriod,
  efbResidualVar,
  efbWhitePower,
  lineSpectrum,
  ntfGain2,
  runQuantLab,
  stochasticQuantVar,
  stochasticQuantVarApprox,
  toggleCycle,
  validateQuantParams,
  zohLines,
  type QuantLabParams,
  type QuantStrategy,
} from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, LSB_FS_EXAMPLE } from './common'
import { crossChecks, metricRows, warnTex } from './experiments/labChecks'
import { FORMULAS } from './formulas'
import { DITHER_SIM, HANDCALCS } from './handcalcs'
import { expectNoTexErrors } from '@/test/katex'

// ───────────────────────────────────────────────────────────────────────────
// 工具
// ───────────────────────────────────────────────────────────────────────────

interface GoldenVector {
  expected: Record<string, number | number[]>
}
const golden = (name: string): GoldenVector => JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector

const def = (id: string): HandCalcDef => {
  const h = HANDCALCS.find((x) => x.id === id)
  if (!h) throw new Error(`找不到 ${id}`)
  return h
}
const solveDefault = (id: string): HandCalcSolution => def(id).solve(defaultValues(def(id)))
const values = (sol: HandCalcSolution): number[] => sol.results.map((r) => r.value)

/** |a − b| ≤ abs + rel·|b| */
function expectNear(a: number, b: number, msg: string, rel = 1e-9, abs = 1e-12) {
  expect(Math.abs(a - b), `${msg}: ${a} vs ${b}`).toBeLessThanOrEqual(abs + rel * Math.abs(b))
}

const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
const parses = (tex: string, displayMode: boolean) => katex.renderToString(tex, { displayMode, throwOnError: true, strict: 'ignore', trust: false })

/** 字串裡每一段 `$...$` 都要能被 KaTeX 解析，而且沒有落單的 `$`。 */
function expectMathText(s: string, where: string) {
  for (const m of s.matchAll(INLINE_MATH)) expect(() => parses(m[1], false), `${where}: ${m[1]}`).not.toThrow()
  expect(s.replace(INLINE_MATH, '').includes('$'), `${where}: 落單的 $ —— ${s}`).toBe(false)
}

/** 用 Unicode 拼數學的字元（「ΔΣ」是名稱不算）。docs/teaching-style.md §3：字串裡的數學一律寫成 `$...$`。 */
const UNICODE_MATH = /[σδεμζ≤≥≪≫≈≠√∫⌊⌋²³₀₁₂ȳ−±→⇒×÷]|Δ(?!Σ)/

/** 可以放 `$...$` 的說明文字：每段數學可解析，而且數學以外沒有 Unicode 拼的公式。 */
function expectProse(s: string, where: string) {
  expectMathText(s, where)
  expect(UNICODE_MATH.test(s.replace(INLINE_MATH, '')), `${where}: 數學請寫成 $...$ —— ${s}`).toBe(false)
}

function expectSolutionTex(sol: HandCalcSolution, tag: string) {
  expect(sol.steps.length, `${tag}: 至少一步`).toBeGreaterThan(0)
  sol.steps.forEach((s, i) => {
    expect(() => parses(s.tex, true), `${tag} step ${i + 1}: ${s.tex}`).not.toThrow()
    expectProse(s.why, `${tag} why ${i + 1}`)
    // 每一步都是「符號式 = 代入數字 = 結果」：至少要有一個等號，而且有說明
    expect(s.tex.includes('='), `${tag} step ${i + 1} 沒有等號`).toBe(true)
    expect(s.why.trim().length, `${tag} step ${i + 1} 沒有說明`).toBeGreaterThan(4)
  })
  for (const r of sol.results) {
    expect(() => parses(`\\boxed{${r.symbol} = 1${r.unit ? `\\ ${r.unit}` : ''}}`, true), `${tag} result ${r.symbol}`).not.toThrow()
    if (r.label) expectProse(r.label, `${tag} result label`)
  }
  for (const n of sol.notes ?? []) expectProse(n, `${tag} note`)
}

const lab = (strategy: QuantStrategy, over: Partial<typeof DEFAULT_LAB_PARAMS> = {}, lmsNoise = false) =>
  runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 4000, nperseg: 256, ...over }, cases: [{ id: 'A', strategy, lmsNoise, nUpd: 1 }], compareAll: false }).runs[0]

// ───────────────────────────────────────────────────────────────────────────
// 題目清單
// ───────────────────────────────────────────────────────────────────────────

describe('ch13 handcalcs：題目清單', () => {
  it('HC-13.1 … HC-13.8：id 唯一、頁面 /ch/13、對應的公式 ID 都登錄在本章、難度三種都有', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(Array.from({ length: 8 }, (_, i) => `HC-13.${i + 1}`))
    const fids = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/ch/13')
      expect(h.formulaId && fids.has(h.formulaId), `${h.id}: ${h.formulaId}`).toBe(true)
      expect(() => parses(h.formulaTex, true), `${h.id} formulaTex`).not.toThrow()
      expectProse(h.title, `${h.id} title`)
      expect(h.inputs.some((i) => i.practice), `${h.id}: 至少一個輸入可以「換一題」`).toBe(true)
      for (const i of h.inputs) {
        expect(() => parses(i.symbol, false), `${h.id} ${i.key}`).not.toThrow()
        if (i.unit) expect(() => parses(i.unit!, false), `${h.id} ${i.key} unit`).not.toThrow()
        expectProse(i.label, `${h.id} ${i.key} label`)
        // 預設值本身在合法範圍內
        if (i.min !== undefined) expect(i.default).toBeGreaterThanOrEqual(i.min)
        if (i.max !== undefined) expect(i.default).toBeLessThanOrEqual(i.max)
      }
      expect(h.tips && h.tips.length > 0, `${h.id}: 要有手算提示`).toBe(true)
      for (const t of h.tips ?? []) expectProse(t, `${h.id} tip`)
      expect(h.validate?.(defaultValues(h)) ?? null, `${h.id}: 預設值必須合法`).toBeNull()
    }
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    // 近似式的題目要誠實標成 approx
    expect(def('HC-13.7').claim).toBe('approx')
    expect(def('HC-13.8').claim).toBe('approx')
  })

  it('桌機寬度放不下的通式拆成兩行（HC-13.1／13.2／13.4／13.5）：分行不丟項、不丟條件', () => {
    // 這四條原本是一整行，在 1280px 的欄位裡比欄寬多 85–301px，要橫向捲動；拆成 gathered 兩行（只在逗號或 ⇒ 處換行）。
    const terms: Record<string, [string, string][]> = {
      'HC-13.1': [
        [String.raw`y=Q_B(w^*)=\Big\lfloor w^*+\tfrac12\Big\rfloor,\qquad \delta w=y-w^*\;\;(\delta=a-w=-\delta w),\qquad E[\delta w^2]=(\delta w)^2`, String.raw`\delta w\,[\mathrm{fs}]=\Delta_\mathrm{LSB}\cdot\delta w\,[\mathrm{LSB}]`],
      ],
      'HC-13.2': [
        [String.raw`p=w^*-\lfloor w^*\rfloor,\quad h=\mathrm{round}(pL_t),\quad y[n']=\lfloor w^*\rfloor+\Big\lfloor\tfrac{(n'+1)h}{L_t}\Big\rfloor-\Big\lfloor\tfrac{n'h}{L_t}\Big\rfloor`, String.raw`\overline y=\lfloor w^*\rfloor+\frac{h}{L_t},\quad \overline{e^2}=\frac{h}{L_t}\Big(1-\frac{h}{L_t}\Big)+\big(\overline y-w^*\big)^2`],
      ],
      'HC-13.4': [
        [String.raw`p=w^*-\lfloor w^*\rfloor,\qquad E[y]=\lfloor w^*\rfloor+p,\qquad \mathrm{Var}(y)=p(1-p),\qquad \sigma_y=\sqrt{p(1-p)}`, String.raw`S_e^{(1)}(f)=\frac{2p(1-p)}{f_u},\qquad \sigma_{\bar y}=\frac{\sigma_y}{\sqrt N}`],
      ],
      'HC-13.5': [
        [String.raw`v[n]=w_H+r[n-1],\qquad y[n]=Q_B\big(v[n]\big),\qquad r[n]=v[n]-y[n]`, String.raw`\Rightarrow\;\;y[n]=w_H+r[n-1]-r[n],\qquad\sum_{n=0}^{N-1}\big(y[n]-w_H\big)=r[-1]-r[N-1]`],
      ],
    }
    for (const [id, [[line1, line2]]] of Object.entries(terms)) {
      const tex = def(id).formulaTex
      expect(tex, `${id}: 兩行`).toBe(String.raw`\begin{gathered}${line1}\\[4pt]${line2}\end{gathered}`)
      expect(() => parses(tex, true), `${id} formulaTex`).not.toThrow()
    }
  })

  it('預設值 = 本章 worked example 的參數（w* = 32.4、Δ_LSB、L_t、σ_w、f_B = f_u/64、A）', () => {
    const d = (id: string, key: string) => def(id).inputs.find((i) => i.key === key)!.default
    for (const [id, key] of [['HC-13.1', 'w'], ['HC-13.2', 'w'], ['HC-13.4', 'w'], ['HC-13.5', 'wH'], ['HC-13.6', 'wH'], ['HC-13.8', 'w']] as const) expect(d(id, key), id).toBe(DEFAULT_LAB_PARAMS.target)
    expect(d('HC-13.1', 'lsb')).toBe(LSB_FS_EXAMPLE)
    expect(d('HC-13.8', 'lsb')).toBe(DEFAULT_LAB_PARAMS.lsbFs)
    expect(d('HC-13.2', 'L')).toBe(DEFAULT_LAB_PARAMS.togglePeriod)
    expect(d('HC-13.5', 'r0')).toBe(DEFAULT_LAB_PARAMS.rInit)
    expect(d('HC-13.6', 'F')).toBe(DEFAULT_LAB_PARAMS.fracBits)
    expect(d('HC-13.7', 'R')).toBe(LF_OSR_DIV)
    expect(d('HC-13.7', 'A')).toBe(DEFAULT_LAB_PARAMS.ditherLsb)
    expect(d('HC-13.8', 'R')).toBe(LF_OSR_DIV)
    expect(d('HC-13.8', 'sw')).toBe(DEFAULT_LAB_PARAMS.sigmaW)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (a) 預設值：等於模型函式／內文數字／golden vector
// ───────────────────────────────────────────────────────────────────────────

describe('(a) 預設值的答案 = 模型函式、章內 worked example 與 golden vector', () => {
  it('T16: HC-13.1 Freeze —— code 32、δw = −0.4 LSB（δ = a − w = +0.4）、0.16 LSB²、−0.05 fs；與 Lab 的 Freeze 指標相同', () => {
    const g = golden('T16').expected
    const sol = solveDefault('HC-13.1')
    const [y, dw, pow, fs] = values(sol)
    expect(y).toBe(g.freeze_code)
    expectNear(dw, g.freeze_error_lsb as number, 'δw', 0, 1e-12)
    expectNear(pow, 0.16, 'E[δw²]')
    expectNear(fs, -0.05, 'fs')
    const m = lab('freeze').metrics
    expectNear(dw, m.dcError, 'Lab dcError', 0, 1e-12)
    expectNear(pow, m.errPower, 'Lab errPower', 0, 1e-12)
    // 兩種正負號約定都出現在步驟裡（勘誤 E49）
    const all = sol.steps.map((s) => s.tex).join('\n')
    expect(all).toContain(String.raw`\delta w=y-w^*=32-32.4=-0.4`)
    expect(all).toContain(String.raw`\delta=a-w=w^*-y=32.4-32=0.4`)
  })

  it('T16: HC-13.2 Toggle —— h = 2、比例 0.4、平均 32.4、DC 誤差 0、總功率 0.24；pattern = [32,32,33,32,33]', () => {
    const g = golden('T16').expected
    const sol = solveDefault('HC-13.2')
    const [h, frac, mean, dc, pow] = values(sol)
    expect(h).toBe(2)
    expectNear(frac, 0.4, 'h/L')
    expectNear(mean, g.mean as number, 'mean')
    expect(dc).toBe(0)
    expectNear(pow, 0.24, 'pow')
    expect(toggleCycle(32.4, 5)).toEqual([...TOGGLE_PATTERN_5])
    expect(sol.notes!.join(' ')).toContain(`[${TOGGLE_PATTERN_5.join(',')}]`)
    expect(sol.notes!.join(' ')).toContain(`=${g.period as number}$`)
    const th = lab('toggle').theory!
    expectNear(mean, th.mean, 'Lab theory mean')
    expectNear(pow, th.errPower, 'Lab theory errPower')
    expect(th.period).toBe(5)
  })

  it('T16: HC-13.3 譜線 —— |c_2| = (√5+1)/10、P_2 = 0.20944、ZOH N_h = 64 後 0.11998 LSB²；k = 1 為 (√5−1)/10、0.03056、0.02674', () => {
    const g = golden('T16').expected.dft_mag_list as number[]
    const e = TOGGLE_PATTERN_5.map((y) => y - 32.4)
    const ls = lineSpectrum(e)
    const zl = zohLines(e, 64, 320)
    for (const k of [1, 2]) {
      const [mag, Pk, g2, Pz] = values(def('HC-13.3').solve({ na: 2, nb: 4, k, Nh: 64 }))
      expectNear(mag, g[k], `|c_${k}| golden`, 0, 1e-12)
      expectNear(mag, k === 1 ? (Math.sqrt(5) - 1) / 10 : (Math.sqrt(5) + 1) / 10, `|c_${k}| 閉式`)
      expectNear(Pk, ls[k].power, `P_${k}`)
      expectNear(Pz, zl.find((l) => l.k === k)!.power, `P_${k}^ZOH`)
      expectNear(g2, Pz / Pk, 'G²')
    }
    const [, P2, , Pz2] = values(solveDefault('HC-13.3'))
    expect(P2).toBeCloseTo(0.20944, 5)
    expect(Pz2).toBeCloseTo(0.11998, 5)
    // Parseval：兩條線加起來 = 0.24（寫在補充觀察裡）
    expect(solveDefault('HC-13.3').notes!.join(' ')).toContain('P_1+P_2=0.24')
  })

  it('T17: HC-13.4 Stochastic rounding —— E[y] = 32.4、Var = 0.24 LSB²、σ = 0.4899 LSB；f_u = 1 MHz 時 PSD 4.8e-7；N = 1024 的平均誤差 √(0.24/1024)', () => {
    const g = golden('T17').expected
    const [mean, variance, rms, psd, meanRms] = values(solveDefault('HC-13.4'))
    expectNear(mean, g.mean as number, 'mean', 0, 1e-12)
    expectNear(variance, g.variance as number, 'variance', 0, 1e-12)
    expectNear(rms, g.rms as number, 'rms', 0, 1e-12)
    expectNear(psd, 4.8e-7, 'PSD')
    expectNear(meanRms, Math.sqrt(0.24 / 1024), 'σ_ȳ')
    const m = bernoulliMoments(32, 0.4)
    expect([mean, variance, rms]).toEqual([m.mean, m.variance, m.rms])
    // Lab 的白色理論 PSD（errorPsdTheory）就是 2·Var/f_u
    const run = lab('stochastic', { fs: 1e6 })
    expectNear(psd, run.psd.theory![3], 'Lab theory PSD')
  })

  it('T16: HC-13.5 一階 ΔΣ 手算 6 列 —— y = [32,33,32,33,32,32]、r = [0.4,−0.2,0.2,−0.4,0,0.4]（golden、efbConstant）；floor 版 = [32,32,33,32,33,32]', () => {
    const g = golden('quantizer_first_order').expected
    const gy = (g.y as number[]).slice(0, 6)
    const gr = (g.r as number[]).slice(0, 6)
    const sol = solveDefault('HC-13.5')
    const [sum, r5, meanErr] = values(sol)
    expect(sum).toBe(gy.reduce((a, c) => a + c, 0))
    expectNear(r5, gr[5], 'r[5]', 0, 1e-12)
    expectNear(meanErr, (0 - gr[5]) / 6, 'mean err')
    const ef = efbConstant({ target: 32.4, steps: 6 })
    expect(ef.y).toEqual(gy)
    expect(sol.notes![0]).toContain(`[${gy.join(',')}]`)
    // 每一列的三行（v、y、r）都和模型逐點相同
    gy.forEach((y, n) => {
      expect(sol.steps[n].tex).toContain(`y[${n}]&=`)
      expect(sol.steps[n].tex).toMatch(new RegExp(`\\\\rfloor=${y}\\\\\\\\`))
      expect(sol.steps[n].tex.endsWith(`=${Number(gr[n].toPrecision(12))}\\end{aligned}`), `r[${n}]: ${sol.steps[n].tex}`).toBe(true)
    })
    // 穩態循環 = golden 的 ef_cycle，而且是方法 B 的循環移位（勘誤 E15）
    expect(sol.notes!.join(' ')).toContain(`[${(golden('T16').expected.ef_cycle as number[]).join(',')}]`)
    expect(sol.notes!.join(' ')).toContain('循環移位')
    // floor 版與方法 B 逐點相同
    const fl = def('HC-13.5').solve({ wH: 32.4, r0: 0, mode: 1 })
    expect(fl.notes![0]).toContain('[32,32,33,32,33,32]')
    expect(efbConstant({ target: 32.4, steps: 6, rounding: 'floor' }).y).toEqual([32, 32, 33, 32, 33, 32])
    expectNear(fl.results[1].value, 0.4, 'floor r[5]')
  })

  it('T16: HC-13.6 週期 —— 32.4 = 162/5 ⇒ 5；F = 10：K = 33178、K mod 1024 = 410、週期 512（F = 8 / 12 / 16：128 / 2048 / 32768），並以實際模擬偵測週期驗證', () => {
    expect(values(solveDefault('HC-13.6'))).toEqual([golden('T16').expected.ef_period, 33178, 410, 512])
    // 就是模型的 efbPeriod()（Lab 的「解析週期」用的同一個函式）
    expect([efbPeriod(162, 5), efbPeriod(33178, 1024)]).toEqual([5, 512])
    for (const [F, period] of [[8, 128], [12, 2048], [16, 32768]] as const) expect(def('HC-13.6').solve({ wH: 32.4, F }).results[3].value).toBe(period)
    // 真的跑定點 ΔΣ：最小重複週期就是手算的答案（不靠 gcd 公式）
    for (const F of [4, 8, 10]) {
      const P = def('HC-13.6').solve({ wH: 32.4, F }).results[3].value
      const y = efbConstant({ target: 32.4, steps: 3 * P + 8, arithmetic: 'fixed', fracBits: F }).y
      const repeats = (q: number) => y.every((v, i) => i + q >= y.length || y[i + q] === v)
      expect(repeats(P), `F = ${F}: 週期 ${P}`).toBe(true)
      for (let q = 1; q < P; q++) if (P % q === 0) expect(repeats(q), `F = ${F}: 更短的週期 ${q}`).toBe(false)
    }
    // 可以被定點精確表示的值：兩個週期相同
    expect(values(def('HC-13.6').solve({ wH: 32.375, F: 4 }))).toEqual([8, 518, 6, 8])
  })

  it('HC-13.7 白色近似 —— f_B = f_u/64：|NTF|² = −20.16 dB、A = 1 的 E[e²] = 1/3、P_in^(D) = 8.37e-6、P_in^(E) = 2 倍；與 Lab 的理論曲線一致', () => {
    const [ntfDb, total, inD, inE] = values(solveDefault('HC-13.7'))
    expectNear(ntfDb, 10 * Math.log10(4 * Math.sin(Math.PI / 64) ** 2), 'NTF dB')
    expect(ntfDb).toBeCloseTo(-20.16, 2)
    expectNear(total, 1 / 3, 'E[e²]')
    expectNear(inD, ((8 * Math.PI ** 2) / 3) * (1 / 12) * (1 / 64) ** 3, 'P_in^(D)')
    expect(inD).toBeCloseTo(8.3666e-6, 9)
    expectNear(inE, 2 * inD, 'P_in^(E)')
    // 與 Lab（runQuantLab 的 strategyTheory / errorPsdTheory）逐點比對：helper 不是另一套公式
    for (const [A, pdf] of [[1, 'uniform'], [0.5, 'uniform'], [2, 'triangular']] as const) {
      const run = lab('deltaSigmaDither', { ditherLsb: A, ditherPdf: pdf })
      const sr2 = efbResidualVar(ditherVariance(A, pdf))
      expectNear(efbWhitePower(sr2), run.theory!.errPower, `E[e²] A=${A} ${pdf}`)
      for (const i of [1, 7, 40, 100]) expectNear((ntfGain2(run.psd.f[i] / run.fu) * 2 * sr2) / run.fu, run.psd.theory![i], `PSD theory bin ${i}`)
    }
    expectNear(total, lab('deltaSigmaDither').theory!.errPower, 'Lab E 的白色近似')
  })

  it('HC-13.7 補充觀察裡的「實際丟進模型跑」= Lab／§13.4E 掃描表的同一次模擬（同 seed、同長度），不是寫死的數字', () => {
    expect(DITHER_SIM.seed).toBe(DEFAULT_LAB_PARAMS.seed)
    expect(DITHER_SIM.target).toBe(DEFAULT_LAB_PARAMS.target)
    for (const A of [0, 0.5, 1, 2]) {
      const run = runQuantLab({
        params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: DITHER_SIM.length, nperseg: 256, ditherLsb: A, ditherPdf: 'uniform' },
        cases: [{ id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 }],
        compareAll: false,
      }).runs[0]
      const note = def('HC-13.7').solve({ R: 64, A }).notes![1]
      expect(note, `A = ${A}`).toContain(String.raw`總誤差功率是 $${texNum(run.metrics.errPower, 4)}\,\mathrm{LSB}^2$`)
      // A < 1：只有兩階、總功率鎖在 0.24；A ≥ 1：code 範圍與模擬一致
      if (A < 1) {
        expect(run.metrics.errPower).toBeCloseTo(0.24, 3)
        expect(note).toContain('兩階')
      } else expect(note).toContain(String.raw`$${run.metrics.codeMin}\ldots${run.metrics.codeMax}$`)
    }
    // A = 1：模擬 0.3234 vs 白色近似 1/3（內文「讀表」的數字）
    expect(def('HC-13.7').solve({ R: 64, A: 1 }).notes![1]).toContain('0.3234')
  })

  it('HC-13.8 綜合題 —— 0.05 fs（Freeze）、0.0612 fs（兩階切換）、頻帶內 C 0.00988 fs、D 3.62e-4 fs；E[p(1−p)] 的近似與模型的數值積分差 < 2%', () => {
    const sol = solveDefault('HC-13.8')
    const [dtA, dtSw, fsC, fsD] = values(sol)
    expectNear(dtA, 0.05, 'Freeze')
    expectNear(dtSw, LSB_FS_EXAMPLE * Math.sqrt(0.24), '兩階')
    expectNear(fsC, LSB_FS_EXAMPLE * Math.sqrt((2 * (0.24 - 0.04)) / 64), 'C')
    expectNear(fsD, LSB_FS_EXAMPLE * Math.sqrt(((8 * Math.PI ** 2) / 36) * (1 / 64) ** 3), 'D')
    expect(dtA).toBeLessThan(dtSw) // 總 RMS：Freeze 比較小
    expect(fsD).toBeLessThan(fsC) // 頻帶內：ΔΣ 小很多
    expect(fsC).toBeLessThan(dtA)
    // 與 Lab 的指標對照：Freeze 的 DC 誤差 × Δ_LSB、兩階的 √(總功率) × Δ_LSB
    expectNear(dtA, Math.abs(lab('freeze').metrics.dcError) * LSB_FS_EXAMPLE, 'Lab Freeze', 0, 1e-12)
    expectNear(dtSw, Math.sqrt(lab('toggle').theory!.errPower) * LSB_FS_EXAMPLE, 'Lab toggle')
    const exact = stochasticQuantVar(32.4, 0.2)
    const approx = stochasticQuantVarApprox(0.4, 0.2)
    expectNear(approx, 0.2, 'p0(1−p0) − σ²')
    expect(Math.abs(approx - exact) / exact).toBeLessThan(0.02)
    expect(sol.notes!.join(' ')).toContain('數值積分')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// quantizer.ts 新增的閉式 helper（core:whiteApprox）
// ───────────────────────────────────────────────────────────────────────────

describe('core:whiteApprox（手算題與內文共用的閉式）', () => {
  it('region 存在；ntfGain2 的端點值；efbInbandWhite.exact = 把 4 sin² 數值積分；lowFreq 的相對誤差 ≈ (πx)²/5', () => {
    expect(listRegions(quantSrc)).toContain('whiteApprox')
    expect(ntfGain2(0)).toBe(0)
    expectNear(ntfGain2(0.5), 4, 'Nyquist')
    expectNear(ditherVariance(1), 1 / 12, 'RPDF')
    expectNear(ditherVariance(1, 'triangular'), 1 / 24, 'TPDF')
    expectNear(efbWhitePower(efbResidualVar(0)), 1 / 6, '白色模型的 2/12')
    for (const x of [1 / 16, 1 / 64, 1 / 256]) {
      const sr2 = 0.1
      // Simpson 積分 ∫₀ˣ 4 sin²(πu)·2σ_r² du
      const n = 2000
      let s = 0
      for (let i = 0; i <= n; i++) s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * ntfGain2((x * i) / n) * 2 * sr2
      const num = (s * (x / n)) / 3
      const { exact, lowFreq } = efbInbandWhite(sr2, x)
      expectNear(exact, num, `exact x=${x}`, 1e-9)
      expectNear((lowFreq - exact) / exact, (Math.PI * x) ** 2 / 5, `lowFreq 誤差 x=${x}`, 0.02, 1e-9)
    }
    // R_MIN = 16 的由來：低頻近似的誤差在 f_u/f_B = 16 時 < 1%
    const b = efbInbandWhite(1 / 12, 1 / 16)
    expect((b.lowFreq - b.exact) / b.exact).toBeLessThan(0.01)
  })

  it('stochasticQuantVarApprox：在題目允許的範圍（σ_w ≤ min(p₀, 1−p₀)/2）內與數值積分差 < 5%，σ_w = 0 時完全相同', () => {
    for (const [w, sw] of [[32.4, 0.2], [32.5, 0.25], [32.3, 0.15], [32.2, 0.1], [32.4, 0.1], [32.6, 0.05]] as const) {
      const p0 = w - Math.floor(w)
      const ex = stochasticQuantVar(w, sw)
      expect(Math.abs(stochasticQuantVarApprox(p0, sw) - ex) / ex, `${w}, ${sw}`).toBeLessThan(0.05)
    }
    expectNear(stochasticQuantVarApprox(0.4, 0), stochasticQuantVar(32.4, 0), 'σ = 0', 1e-12)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (b) 隨機題目：有限，而且等於直接寫在測試裡的獨立重算
// ───────────────────────────────────────────────────────────────────────────

/** 週期序列一條線的 |c_k|（直接照定義做 DFT）。 */
function dftMag(seq: number[], k: number): number {
  let re = 0
  let im = 0
  seq.forEach((x, n) => {
    const th = (2 * Math.PI * k * n) / seq.length
    re += x * Math.cos(th)
    im -= x * Math.sin(th)
  })
  return Math.hypot(re, im) / seq.length
}

/** 每一題的獨立重算（整數算術或直接照定義，不呼叫 quantizer.ts）。回傳值的順序 = results 的順序。 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-13.1': ({ w, lsb }) => {
    const W = Math.round(w * 10) // 練習題的 w* 是 0.1 的倍數
    const y = Math.floor((W + 5) / 10)
    const dw = (10 * y - W) / 10
    return [y, dw, dw * dw, dw * lsb]
  },
  'HC-13.2': ({ w, L }) => {
    const W = Math.round(w * 100) // 0.05 的倍數
    const lo = Math.floor(W / 100)
    const fr = W - 100 * lo
    const h = Math.floor((2 * fr * L + 100) / 200) // round-half-up(fr·L/100)
    const dc = (100 * (lo * L + h) - W * L) / (100 * L)
    return [h, h / L, lo + h / L, dc, (h / L) * (1 - h / L) + dc * dc]
  },
  'HC-13.3': ({ na, nb, k, Nh }) => {
    const e = [0, 1, 2, 3, 4].map((n) => (n === na || n === nb ? 0.6 : -0.4))
    const mag = dftMag(e, k)
    const held = e.flatMap((x) => Array.from({ length: Nh }, () => x)) // 真的把每個 code 保持 N_h 次再做 DFT
    const magZ = dftMag(held, k)
    return [mag, 2 * mag * mag, (magZ / mag) ** 2, 2 * magZ * magZ]
  },
  'HC-13.4': ({ w, fu, N }) => {
    const W = Math.round(w * 100)
    const lo = Math.floor(W / 100)
    const p = (W - 100 * lo) / 100
    const v = p * (1 - p)
    return [lo + p, v, Math.sqrt(v), (2 * v) / fu, Math.sqrt(v) / Math.sqrt(N)]
  },
  'HC-13.5': ({ wH, r0, mode }) => {
    const DEN = 8000 // 練習題的數字都是 1/8000 的倍數
    const W = Math.round(wH * DEN)
    let R = Math.round(r0 * DEN)
    let sum = 0
    for (let n = 0; n < 6; n++) {
      const V = W + R
      const y = mode === 1 ? Math.floor(V / DEN) : Math.floor((2 * V + DEN) / (2 * DEN))
      R = V - y * DEN
      sum += y
    }
    return [sum, R / DEN, (sum * DEN - 6 * W) / DEN / 6]
  },
  'HC-13.6': ({ wH, F }) => {
    const W = Math.round(wH * 10000) // 最多 4 位小數
    let q = 1
    while ((W * q) % 10000 !== 0) q++
    const D = 2 ** F
    const K = Math.floor((2 * W * D + 10000) / 20000) // round-half-up(w·2^F)
    const f = K % D
    let P = 1
    while ((f * P) % D !== 0) P++ // 最小的 P 使 P·f 為 2^F 的倍數（不用 gcd）
    return [q, K, f, P]
  },
  'HC-13.7': ({ R, A }) => {
    const sr2 = 1 / 12 + (A * A) / 12
    const c = (8 * Math.PI * Math.PI) / 3 / R ** 3
    return [10 * Math.log10(4 * Math.sin(Math.PI / R) ** 2), 2 * sr2, c / 12, c * sr2]
  },
  'HC-13.8': ({ w, lsb, xr, sw, R }) => {
    const W = Math.round(w * 100)
    const lo = Math.floor(W / 100)
    const p = (W - 100 * lo) / 100
    const y = Math.floor((W + 50) / 100)
    const dw = Math.abs(100 * y - W) / 100
    const pinC = (2 * (p * (1 - p) - sw * sw)) / R
    const pinD = (((8 * Math.PI * Math.PI) / 3) * (1 / 12)) / R ** 3
    return [lsb * dw * xr, lsb * Math.sqrt(p * (1 - p)) * xr, lsb * Math.sqrt(pinC) * xr, lsb * Math.sqrt(pinD) * xr]
  },
}

describe('(b) randomValues(def, seed)：20 個 seed 的答案有限、等於獨立重算，所有 TeX 可解析', () => {
  for (const h of HANDCALCS) {
    it(`${h.id}：20 個隨機題`, () => {
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(h, seed)
        expect(randomValues(h, seed), '同 seed 可重現').toEqual(v)
        seen.add(JSON.stringify(v))
        expect(h.validate?.(v) ?? null, `${h.id} seed ${seed}: ${JSON.stringify(v)}`).toBeNull()
        const sol = h.solve(v)
        const want = INDEPENDENT[h.id](v)
        expect(sol.results.length).toBe(want.length)
        sol.results.forEach((r, i) => {
          expect(Number.isFinite(r.value), `${h.id} seed ${seed} ${r.symbol}`).toBe(true)
          expectNear(r.value, want[i], `${h.id} seed ${seed} ${JSON.stringify(v)} → ${r.symbol}`, 1e-9, 1e-11)
          // 手算的人照答案填，一定判定為正確
          expect(checkAnswer(want[i], r).ok, `${h.id} seed ${seed} checkAnswer ${r.symbol}`).toBe(true)
        })
        expectSolutionTex(sol, `${h.id} seed ${seed}`)
      }
      // 「換一題」真的會換數字
      expect(seen.size, `${h.id}: 20 個 seed 應該抽到多組不同的數字`).toBeGreaterThan(5)
    })
  }

  it('預設值也通過同一套獨立重算', () => {
    for (const h of HANDCALCS) {
      const v = defaultValues(h)
      const want = INDEPENDENT[h.id](v)
      h.solve(v).results.forEach((r, i) => expectNear(r.value, want[i], `${h.id} ${r.symbol}`, 1e-9, 1e-11))
    }
  })

  it('HC-13.2 的 tie（p·L_t 剛好 x.5）照 round-half-up 進位：w* = 32.3、L_t = 5 ⇒ h = 2（與模型的整數 toggleStep 相同）', () => {
    const [h, , mean, dc] = values(def('HC-13.2').solve({ w: 32.3, L: 5 }))
    expect(h).toBe(2)
    expectNear(mean, 32.4, 'mean')
    expectNear(dc, 0.1, 'DC 誤差 = 1/(2L_t)')
    expect(lab('toggle', { target: 32.3 }).cycle?.filter((y) => y === 33).length).toBe(2)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (b2) 驗證時補上的檢查：畫面上的數字彼此對得起來、換一題不出廢題、邊界情況的說明正確
// ───────────────────────────────────────────────────────────────────────────

/** TeX 片段裡依序出現的十進位數字（a\times10^{b} 算一個數；其他 TeX 指令先去掉）。 */
function numsIn(tex: string): number[] {
  const flat = tex.replace(/\\times10\^\{(-?\d+)\}/g, 'e$1').replace(/\\[a-zA-Z]+/g, ' ')
  return [...flat.matchAll(/(?<![\d.])-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map((m) => Number(m[0]))
}
/** 照抄畫面上的數字算出來的值，四捨五入到 5 位有效數字後要和畫面上的結果一致（容許最後一位差 0.6）。 */
function expectShown(calc: number, shown: number, msg: string) {
  const ulp5 = shown === 0 ? 1e-12 : 10 ** (Math.floor(Math.log10(Math.abs(shown))) - 4)
  expect(Math.abs(calc - shown), `${msg}: 照抄畫面數字算出 ${calc}，畫面顯示 ${shown}`).toBeLessThanOrEqual(0.6 * ulp5)
}

describe('(b2) 手算的人照抄畫面上的數字，算得出下一步顯示的結果', () => {
  it('所有題目的步驟、說明、提示都沒有控制字元（Python／JS 字串把 \\t、\\n 吃掉的痕跡）', () => {
    // eslint-disable-next-line no-control-regex
    const CTRL = /[\u0000-\u001f]/
    for (const h of HANDCALCS) {
      const sol = h.solve(defaultValues(h))
      const all = [h.title, h.formulaTex, ...(h.tips ?? []), ...h.inputs.map((i) => i.label), ...sol.steps.flatMap((s) => [s.tex, s.why]), ...(sol.notes ?? []), ...sol.results.map((r) => r.label ?? '')]
      all.forEach((t) => expect(CTRL.test(t), `${h.id}: ${JSON.stringify(t)}`).toBe(false))
      for (const bad of [{ R: 4, A: 1, w: 63.9, wH: 63.9, r0: 0, mode: 0, L: 5, lsb: 1, xr: 1, sw: 0.4, fu: 1, N: 1, F: 4, na: 1, nb: 1, k: 1, Nh: 1 }]) {
        const msg = h.validate?.(bad)
        if (msg) expect(CTRL.test(msg), `${h.id} validate`).toBe(false)
      }
    }
  })

  it('極小的數（顯示成 a×10^b）被平方或立方時會加括號：不會出現 10^{-5}^2 這種 KaTeX 解析不了的式子', () => {
    const cases: [string, Record<string, number>][] = [
      ['HC-13.1', { w: 31.99995, lsb: 0.125 }], // δw = 5e-5
      ['HC-13.2', { w: 32.39995, L: 5 }], // DC 誤差 5e-5
      ['HC-13.7', { R: 150846.99, A: 1.4 }], // sin θ ≈ 2e-5、(f_B/f_u)³
      ['HC-13.7', { R: 1e6, A: 0.00002 }], // A² 也是
      ['HC-13.8', { w: 32.4, lsb: 0.125, xr: 1, sw: 0.00005, R: 1e5 }],
    ]
    for (const [id, v] of cases) {
      const h = def(id)
      expect(h.validate?.(v) ?? null, `${id} ${JSON.stringify(v)}`).toBeNull()
      const sol = h.solve(v)
      expectSolutionTex(sol, `${id} ${JSON.stringify(v)}`)
      const all = sol.steps.map((st) => st.tex).join('\n')
      expect(all).not.toMatch(/10\^\{-?\d+\}\^/)
      expect(all).toMatch(/\\times10\^\{-\d+\}\)\^[23]/)
    }
    // 負數的平方照舊加括號
    expect(solveDefault('HC-13.1').steps[4].tex).toContain('(-0.4)^2=0.16')
  })

  it('HC-13.3：sinc 權重的每一步（分母、相除、平方、相乘）用畫面上的數字都接得上；20 個隨機題', () => {
    const h = def('HC-13.3')
    for (let seed = 0; seed <= 20; seed++) {
      const v = seed === 0 ? defaultValues(h) : randomValues(h, seed)
      const st = h.solve(v).steps
      expect(st.length).toBe(14)
      // 步驟 3、4 是查表；步驟 5、6 把查到的值相加再除以 5
      const [ca, sa] = numsIn(st[2].tex.replace(/\\(cos|sin)\d+(\.\d+)?\^\\circ/g, ''))
      const [cb, sb] = numsIn(st[3].tex.replace(/\\(cos|sin)\d+(\.\d+)?\^\\circ/g, ''))
      const re = numsIn(st[4].tex).at(-1)!
      const im = numsIn(st[5].tex).at(-1)!
      expectShown((ca + cb) / 5, re, `seed ${seed} Re`)
      expectShown(-(sa + sb) / 5, im, `seed ${seed} Im`)
      const mag2 = numsIn(st[6].tex).at(-1)!
      expectShown(re * re + im * im, mag2, `seed ${seed} |c|²`)
      expectShown(Math.sqrt(mag2), numsIn(st[7].tex.split('\\ \\mathrm')[0]).at(-1)!, `seed ${seed} |c|`)
      const Pk = numsIn(st[8].tex.split('\\ \\mathrm')[0]).at(-1)!
      expectShown(2 * mag2, Pk, `seed ${seed} P_k`)
      // G_k = num/den、G_k² = G²、P^ZOH = P_k·G²
      const g = numsIn(st[11].tex.split('=').slice(-2).join('='))
      expectShown(g[0] / g[1], g[2], `seed ${seed} G`)
      const g2 = numsIn(st[12].tex.split('=').slice(-2).join('=').replace(/\^2/, ''))
      expectShown(g2[0] ** 2, g2[1], `seed ${seed} G²`)
      const pz = numsIn(st[13].tex.split('=').slice(-2).join('=').split('\\ \\mathrm')[0])
      expectShown(pz[0] * pz[1], pz[2], `seed ${seed} P^ZOH`)
    }
  })

  it('HC-13.2：L_t 不是 2、5 的倍數時（1/12 是循環小數）平均值多留幾位，相減才對得上 DC 誤差', () => {
    const st = def('HC-13.2').solve({ w: 62.9, L: 12 }).steps
    const [mean, w, dc] = numsIn(st[6].tex.split('=').slice(-2).join('=').split('\\ \\mathrm')[0])
    expect(w).toBe(62.9)
    expectShown(mean - w, dc, 'ȳ − w*')
    expect(dc).toBeCloseTo(1 / 60, 6)
  })

  it('HC-13.7：|NTF|² 分成「平方、乘 4、取 log」三步，數字接得上；用 sin θ ≈ θ 估的 dB 也在容許誤差內（f_u/f_B = 16 … 256）', () => {
    const h = def('HC-13.7')
    for (const R of [16, 32, 64, 128, 256]) {
      const sol = h.solve({ R, A: 1 })
      const [sinT, , sin2] = numsIn(sol.steps[3].tex.split('=').slice(-2).join('='))
      expectShown(sinT * sinT, sin2, `R = ${R} sin²`)
      const ntf = numsIn(sol.steps[4].tex).at(-1)!
      expectShown(4 * sin2, ntf, `R = ${R} 4sin²`)
      expect(Math.abs(10 * Math.log10(ntf) - sol.results[0].value)).toBeLessThan(0.001)
      // 沒有 sin 鍵的人用 (2π f_B/f_u)²
      expect(checkAnswer(10 * Math.log10((2 * Math.PI / R) ** 2), sol.results[0]).ok, `R = ${R}`).toBe(true)
    }
  })

  it('HC-13.8：四個答案都是 fs 的 timing error，都和 x_rms 成正比；w* = x.5 時 Freeze 與兩階切換相等，其他時候 Freeze 不會輸', () => {
    const h = def('HC-13.8')
    const base = { w: 32.4, lsb: 0.125, xr: 1, sw: 0.2, R: 64 }
    const a = values(h.solve(base))
    const b = values(h.solve({ ...base, xr: 2 }))
    a.forEach((x, i) => expectNear(b[i], 2 * x, `result ${i} ∝ x_rms`))
    for (const r of h.solve(base).results) expect(r.unit).toBe(String.raw`\mathrm{fs}`)
    const tie = h.solve({ w: 32.5, lsb: 1, xr: 2, sw: 0.25, R: 16 })
    expectNear(tie.results[0].value, tie.results[1].value, 'x.5')
    expect(tie.notes![0]).toContain('兩者相等')
    for (const w of [32.4, 20.4, 45.7, 27.25, 12.3, 32.6]) {
      const sol = h.solve({ ...base, w, sw: 0.05 })
      expect(sol.results[0].value).toBeLessThan(sol.results[1].value)
      expect(sol.notes![0]).toContain('反而比兩階切換')
    }
    // σ_w = 0：近似沒有誤差，而且提醒常數輸入的 ΔΣ 是 limit cycle
    const s0 = h.solve({ ...base, sw: 0 })
    expect(s0.notes!.join(' ')).toContain('limit cycle（譜線）')
    expect(s0.notes!.join(' ')).not.toMatch(/10\^\{-1\d\}/)
  })

  it('HC-13.5：表內從哪一列開始重複，由模型多跑幾列比對出來（r[−1] 在穩態範圍外時第 0 列是暫態）', () => {
    const h = def('HC-13.5')
    expect(h.solve({ wH: 32.4, r0: 0, mode: 0 }).notes![1]).toContain('第 5 列（$n=5$）和第 0 列完全相同')
    // r[−1] = 0.5 不在 [−½, ½)：y = [33,32,32,33,32,32]，第 4 列 ≠ 第 0 列，第 5 列 = 第 1 列
    const tr = h.solve({ wH: 32.25, r0: 0.5, mode: 0 })
    expect(tr.notes![0]).toContain('[33,32,32,33,32,32]')
    expect(tr.notes![1]).toContain('暫態')
    expect(tr.notes![1]).toContain('表中第 5 列和第 1 列相同')
    const ef = efbConstant({ target: 32.25, steps: 12, rInit: 0.5 })
    expect(ef.y[4]).not.toBe(ef.y[0])
    expect(ef.y.slice(5, 9)).toEqual(ef.y.slice(1, 5))
    // floor 版的穩態範圍是 [0, 1)：負的 r[−1] 也是暫態
    expect(h.solve({ wH: 32.4, r0: -0.3, mode: 1 }).notes![1]).toContain('[0,1)')
    expect(h.solve({ wH: 32.4, r0: 0.25, mode: 1 }).notes![1]).toContain('和第 0 列完全相同')
    // 週期比表長：要算到第 q 列
    expect(h.solve({ wH: 12.375, r0: 0, mode: 1 }).notes![1]).toContain('要算到第 8 列')
  })

  it('HC-13.6：定點週期可能比精確分數的週期長、短或相同，補充觀察的說法要跟著變（不能一律說「變長、變密」）', () => {
    const h = def('HC-13.6')
    const note = (wH: number, F: number) => h.solve({ wH, F }).notes![0]
    // 32.4、F = 10：5 → 512（變長）
    expect(note(32.4, 10)).toContain('週期變長')
    // 32.375 = 259/8、F = 2：K = round(129.5) = 130 → 32.5，週期 8 → 2（變短）
    expect(values(h.solve({ wH: 32.375, F: 2 }))).toEqual([8, 130, 2, 2])
    expect(note(32.375, 2)).toContain('週期反而變短')
    expect(note(32.375, 2)).not.toContain('變長')
    // 12.3456 = 7716/625、F = 7：625 → 32（變短）
    expect(values(h.solve({ wH: 12.3456, F: 7 }))).toEqual([625, 1580, 44, 32])
    expect(note(12.3456, 7)).toContain('週期反而變短')
    // 32.02、F = 2：捨入成整數 32，沒有 limit cycle，退化成 Freeze
    expect(values(h.solve({ wH: 32.02, F: 2 }))).toEqual([50, 128, 0, 1])
    expect(note(32.02, 2)).toContain('Freeze')
    // 可精確表示：相同
    expect(note(32.375, 4)).toContain('兩個週期相同')
    // 真的跑定點 ΔΣ 驗證「變短」的那個週期
    const y = efbConstant({ target: 32.375, steps: 12, arithmetic: 'fixed', fracBits: 2 }).y
    expect(y.slice(0, 6)).toEqual([y[0], y[1], y[0], y[1], y[0], y[1]])
    expect(y[0]).not.toBe(y[1])
  })

  it('「換一題」不出廢題：HC-13.1／13.4 不抽整數的 w*，HC-13.2 不抽 h = 0 或 h = L_t（pattern 不切換）', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const v1 = randomValues(def('HC-13.1'), seed)
      expect(Number.isInteger(v1.w), `HC-13.1 seed ${seed}: w* = ${v1.w}`).toBe(false)
      const v4 = randomValues(def('HC-13.4'), seed)
      expect(Number.isInteger(v4.w), `HC-13.4 seed ${seed}: w* = ${v4.w}`).toBe(false)
      expect(def('HC-13.4').solve(v4).results[1].value).toBeGreaterThan(0)
      const v2 = randomValues(def('HC-13.2'), seed)
      const h = def('HC-13.2').solve(v2).results[0].value
      expect(h > 0 && h < v2.L, `HC-13.2 seed ${seed}: ${JSON.stringify(v2)} → h = ${h}`).toBe(true)
      // 手算友善：w* 最多兩位小數
      for (const w of [v1.w, v2.w, v4.w]) expect(Math.abs(w * 100 - Math.round(w * 100))).toBeLessThan(1e-9)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (c) validate：擋掉模型不適用的輸入，並說明原因
// ───────────────────────────────────────────────────────────────────────────

describe('(c) validate() 擋掉模型不適用的輸入（訊息說明原因，內含的 LaTeX 可解析）', () => {
  const cases: { id: string; bad: Record<string, number>[]; good: Record<string, number>[]; mustMention: string[] }[] = [
    { id: 'HC-13.1', bad: [{ w: 63.5, lsb: 0.125 }, { w: -0.6, lsb: 0.125 }, { w: 80, lsb: 0.125 }], good: [{ w: 63.4, lsb: 0.125 }, { w: -0.5, lsb: 0.125 }, { w: 0, lsb: 1 }], mustMention: ['overload'] },
    { id: 'HC-13.2', bad: [{ w: 63.4, L: 5 }, { w: -1, L: 5 }, { w: 70, L: 4 }], good: [{ w: 62.9, L: 5 }, { w: 0.5, L: 2 }], mustMention: ['saturate'] },
    { id: 'HC-13.3', bad: [{ na: 2, nb: 2, k: 2, Nh: 64 }, { na: 2, nb: 4, k: 5, Nh: 64 }, { na: 2, nb: 4, k: 10, Nh: 64 }, { na: 2, nb: 4, k: 3, Nh: 1 }], good: [{ na: 2, nb: 4, k: 2, Nh: 1 }, { na: 0, nb: 1, k: 4, Nh: 2 }], mustMention: ['不能相同', 'ZOH 的零點', '鏡像'] },
    { id: 'HC-13.4', bad: [{ w: 63, fu: 1e6, N: 16 }, { w: 64.2, fu: 1e6, N: 16 }, { w: -0.1, fu: 1e6, N: 16 }], good: [{ w: 62.9, fu: 1e6, N: 1 }, { w: 0, fu: 1, N: 1 }], mustMention: ['saturate'] },
    { id: 'HC-13.5', bad: [{ wH: 63.3, r0: 0, mode: 0 }, { wH: 0.5, r0: 0, mode: 0 }, { wH: 32.4, r0: 1.5, mode: 0 }, { wH: 10 * Math.PI, r0: 0, mode: 0 }, { wH: 32.4, r0: Math.SQRT1_2, mode: 1 }], good: [{ wH: 32.4, r0: 0.1, mode: 0 }, { wH: 62, r0: 1, mode: 1 }, { wH: 1, r0: -1, mode: 0 }], mustMention: ['overload', 'windup', '有理數'] },
    { id: 'HC-13.6', bad: [{ wH: 63.3, F: 10 }, { wH: -1, F: 10 }, { wH: 32.123456, F: 10 }], good: [{ wH: 32.4, F: 1 }, { wH: 63, F: 16 }, { wH: 0.0625, F: 4 }], mustMention: ['overload', '4 位小數'] },
    { id: 'HC-13.7', bad: [{ R: 8, A: 1 }, { R: 2, A: 0 }, { R: 64, A: 5 }], good: [{ R: 16, A: 0 }, { R: 1000, A: 4 }], mustMention: ['低頻近似', 'overload'] },
    { id: 'HC-13.8', bad: [{ w: 63.2, lsb: 0.125, xr: 1, sw: 0.05, R: 64 }, { w: 32, lsb: 0.125, xr: 1, sw: 0, R: 64 }, { w: 32.4, lsb: 0.125, xr: 1, sw: 0.3, R: 64 }, { w: 32.4, lsb: 0.125, xr: 1, sw: 0.2, R: 8 }], good: [{ w: 32.4, lsb: 0.125, xr: 1, sw: 0.2, R: 64 }, { w: 32.5, lsb: 1, xr: 2, sw: 0.25, R: 16 }], mustMention: ['saturate', '整數', '數值積分', '低頻近似'] },
  ]
  for (const c of cases) {
    it(`${c.id}：${c.bad.length} 個不合法組合被擋下，${c.good.length} 個邊界內的組合可以解`, () => {
      const h = def(c.id)
      const msgs: string[] = []
      for (const v of c.bad) {
        const msg = h.validate?.(v) ?? null
        expect(msg, `${c.id} 應該擋下 ${JSON.stringify(v)}`).not.toBeNull()
        expect(msg!.length).toBeGreaterThan(20) // 要解釋原因，不是只說「不合法」
        expectProse(msg!, `${c.id} validate`)
        msgs.push(msg!)
      }
      for (const word of c.mustMention) expect(msgs.some((m) => m.includes(word)), `${c.id}: 沒有任何訊息提到「${word}」`).toBe(true)
      for (const v of c.good) {
        expect(h.validate?.(v) ?? null, `${c.id} 不該擋 ${JSON.stringify(v)}`).toBeNull()
        expect(h.solve(v).results.every((r) => Number.isFinite(r.value))).toBe(true)
      }
    })
  }
})

// ───────────────────────────────────────────────────────────────────────────
// (d) 渲染：沒有 KaTeX 錯誤、至少一步
// ───────────────────────────────────────────────────────────────────────────

describe('(d) <HandCalc> 渲染每一題：沒有 .katex-error、步驟數正確', () => {
  for (const h of HANDCALCS) {
    it(`${h.id} 可以渲染`, () => {
      const { container, unmount } = render(<HandCalc def={h} />)
      expectNoTexErrors(container, h.id)
      const steps = container.querySelectorAll('.c-step')
      expect(steps.length).toBeGreaterThan(0)
      expect(steps.length).toBe(h.solve(defaultValues(h)).steps.length)
      expect(container.querySelector(`[id="handcalc-${h.id}"]`)).not.toBeNull()
      unmount()
      // 「自己算算看」模式：先不顯示步驟
      const practice = render(<HandCalc def={h} initialMode="practice" />)
      expect(practice.container.querySelectorAll('.c-step').length).toBe(0)
      expectNoTexErrors(practice.container, `${h.id} practice`)
      expect(screen.getAllByPlaceholderText('你的答案').length).toBe(h.solve(defaultValues(h)).results.length)
      practice.unmount()
    })
  }

  it('HC-13.5：把 w_H 改成 63.3 會顯示 overload 的原因（含公式），不顯示步驟；改回合法值後表格跟著更新', () => {
    const { container } = render(<HandCalc def={def('HC-13.5')} />)
    const wH = screen.getByLabelText(/內部高解析係數/) as HTMLInputElement
    fireEvent.change(wH, { target: { value: '63.3' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('overload')
    expectNoTexErrors(container)
    fireEvent.change(wH, { target: { value: '32.25' } })
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(6)
    // 32.25 = 129/4 ⇒ 週期 4；v[1] = 32.5 是 tie，round-half-up 進位到 33
    expect(container.textContent).toContain('[32,33,32,32,32,33]')
    expect(container.textContent).toContain('tie')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// TASK 2：字串屬性裡的數學都是可解析的 `$...$`，不再用 Unicode 拼公式
// ───────────────────────────────────────────────────────────────────────────

describe('字串屬性的 LaTeX（MetricRow name / note、crossCheck note、公式登錄）', () => {
  it('公式登錄的 title / conditions：`$...$` 可解析、沒有 Unicode 拼的公式', () => {
    for (const f of FORMULAS) {
      expectMathText(f.title, `${f.id} title`)
      expectMathText(f.conditions, `${f.id} conditions`)
      expect(UNICODE_MATH.test(f.title), `${f.id} title: ${f.title}`).toBe(false)
      expect(UNICODE_MATH.test(f.conditions), `${f.id} conditions: ${f.conditions}`).toBe(false)
    }
  })

  it('Lab 的指標表與交叉比對：每個情境的 name / note 都可解析，而且沒有 Unicode 拼的公式', () => {
    const { lmsNoise: _a, nUpd: _b, ...shared } = { ...DEFAULT_LAB_PARAMS }
    const scenarios: { strategy: QuantStrategy; over: Partial<typeof DEFAULT_LAB_PARAMS>; noise?: boolean }[] = [
      { strategy: 'freeze', over: {} },
      { strategy: 'toggle', over: {} },
      { strategy: 'stochastic', over: {} },
      { strategy: 'stochastic', over: { randomSource: 'prbs' } },
      { strategy: 'deltaSigma', over: {} },
      { strategy: 'deltaSigma', over: { arithmetic: 'fixed', fracBits: 10 } },
      { strategy: 'deltaSigma', over: { arithmetic: 'fixed', fracBits: 16 } },
      { strategy: 'deltaSigma', over: { arithmetic: 'float', target: 32.3 } },
      { strategy: 'deltaSigma', over: { arithmetic: 'fixed', fracBits: 8, lmsFreezeAt: 1000 }, noise: true },
      { strategy: 'deltaSigma', over: { target: 63.4 } },
      { strategy: 'deltaSigmaDither', over: {} },
      { strategy: 'deltaSigmaDither', over: { ditherLsb: 0.25 } },
      { strategy: 'freeze', over: {}, noise: true },
      { strategy: 'stochastic', over: {}, noise: true },
      { strategy: 'toggle', over: { mixing: true, mixSamples: 4096, nperseg: 256 } },
    ]
    let checked = 0
    for (const sc of scenarios) {
      const run = lab(sc.strategy, sc.over, sc.noise)
      const p = { ...shared, mixing: false, length: 4000, nperseg: 256, ...sc.over }
      const tag = `${sc.strategy} ${JSON.stringify(sc.over)}`
      for (const row of metricRows(run, p)) {
        expectMathText(row.name, `${tag} name`)
        expect(UNICODE_MATH.test(row.name), `${tag} name: ${row.name}`).toBe(false)
        if (row.note) {
          expectMathText(row.note, `${tag} note`)
          expect(UNICODE_MATH.test(row.note), `${tag} note: ${row.note}`).toBe(false)
        }
        checked++
      }
      for (const c of Object.values(crossChecks(run, p, p.length))) {
        if (!c.note) continue
        expectMathText(c.note, `${tag} crossCheck`)
        expect(UNICODE_MATH.test(c.note), `${tag} crossCheck: ${c.note}`).toBe(false)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(200)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// TASK 2（續）：模型的警告訊息 → warnTex → ExperimentShell 的 warnings
// ───────────────────────────────────────────────────────────────────────────

describe('warnTex：量化模型的警告／參數檢查訊息在顯示前把 Unicode 數學換成 `$...$`', () => {
  /** 轉換後「數學以外」不該再出現的字元（ΔΣ 是名稱；× · … 只會出現在式子裡）。 */
  const LEFTOVER = /[σδεμζ≤≥≪≫≈√∫⌊⌋²³⁶₀₁₂ȳ−±½→⇒·…×]|Δ(?!Σ)|[A-Za-z]_[A-Za-z]|\^|w\*/

  /** 一個情境的所有警告：runQuantLab 的整體警告 + 該 run 的警告 + mixing 的警告（QuantizedGainLab 顯示的就是這三種）。 */
  const warningsOf = (strategy: QuantStrategy, over: Partial<QuantLabParams> = {}, lmsNoise = false, nUpd = 1): string[] => {
    const res = runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 4000, nperseg: 256, ...over }, cases: [{ id: 'A', strategy, lmsNoise, nUpd }], compareAll: false })
    return [...res.warnings, ...res.runs[0].warnings, ...(res.runs[0].mixing?.warnings ?? [])]
  }

  function expectClean(raw: string, where: string): void {
    const out = warnTex(raw)
    expectMathText(out, where)
    const text = out.replace(INLINE_MATH, '')
    expect(LEFTOVER.test(text), `${where}: 還有沒轉成 LaTeX 的數學 —— ${out}`).toBe(false)
    // 只動數學：中文說明一個字都不會多、不會少、不會換位置
    const cjk = (t: string) => t.replace(/[^\u4e00-\u9fff]/g, '')
    expect(cjk(out), where).toBe(cjk(raw))
    // 原訊息有 Unicode 數學時，轉換後一定出現 `$...$`
    if (LEFTOVER.test(raw)) expect(out, where).toContain('$')
  }

  it('runQuantLab 的每一種警告：轉換後所有 `$...$` 可解析，數學以外不再有 Unicode 拼的公式', () => {
    const mix = { mixing: true, mixSamples: 1 << 17, length: 1 << 17, nperseg: 256 }
    const all: string[] = [
      ...warningsOf('deltaSigma', { target: 63.4 }), // 超出範圍 + overload（r 無界累積）
      ...warningsOf('deltaSigma', { target: 63.4, antiWindup: true }), // anti-windup
      ...warningsOf('deltaSigma', { target: 63.4, overflow: 'wrap' }), // wrap
      ...warningsOf('deltaSigmaDither', { target: 0.6, ditherLsb: 1 }), // dither 的 overload margin
      ...warningsOf('deltaSigma', { target: 32.4 + 1e-10 }), // 分母 ≤ 10⁶ 的分數表示不了（最近的是 162/5，差 1e-10）
      ...warningsOf('deltaSigma', {}, true), // rational + 時變 w_H
      ...warningsOf('deltaSigma', { arithmetic: 'fixed', fracBits: 16 }), // 解析週期太長
      ...warningsOf('stochastic', { sigmaW: 1.5 }, true), // σ_w ≥ 1 LSB
      ...warningsOf('toggle', { target: 32.43 }), // toggle 表示不了的小數
      ...warningsOf('freeze', { target: 32.6, rounding: 'floor' }), // floor 的 Freeze
      ...warningsOf('stochastic', { randomSource: 'prbs', prbsBits: 7 }), // PRBS
      ...warningsOf('deltaSigma', { arithmetic: 'fixed', fracBits: 8, lmsFreezeAt: 3000 }, true), // 凍結點在偵測窗口之後
      ...warningsOf('toggle', { mixing: true, mixSamples: 4096 }, false, 256), // mixing 涵蓋的 code 更新太少
      ...warningsOf('toggle', { ...mix, dsmFrac: 0.1 }), // 混頻週期比紀錄長（FCW 陷阱）
      ...warningsOf('freeze', { ...mix, dsmFrac: 0.1 }), // 慢變成分
      ...warningsOf('toggle', { ...mix, dsmFrac: 0.1, sigmaW: 0 }, true), // 整段平均不為 0（w_H 標成時變 ⇒ 沒有解析的混頻週期可比）
    ]
    // 每一種訊息都真的被觸發（否則下面的檢查沒有意義）
    const kinds = ['超出 6-bit code 範圍', '無界累積', 'anti-windup 已把', '使用 wrap', 'dither 寬度', '無法以分母', 'rational 模式', '可偵測上限', '已像 dither', '只能表示', 'truncation', 'PRBS-7', '凍結點', 'mixing 只涵蓋', '混頻產物', '慢變成分', '整段平均不為 0']
    for (const k of kinds) expect(all.some((w) => w.includes(k)), `沒有觸發含「${k}」的警告`).toBe(true)
    const unique = [...new Set(all)]
    unique.forEach((w, i) => expectClean(w, `warning ${i}`))
    // 原訊息確實含 Unicode 數學（測試不是空轉）
    expect(unique.filter((w) => LEFTOVER.test(w)).length).toBeGreaterThan(12)
  })

  it('validateQuantParams 的每一條訊息也一樣', () => {
    const base: QuantLabParams = { ...DEFAULT_LAB_PARAMS }
    const bad: Partial<QuantLabParams>[] = [
      { target: NaN },
      { bits: 0 },
      { arithmetic: 'fixed', fracBits: 40 },
      { sigmaW: -1 },
      { ditherLsb: -1 },
      { lsbFs: 0 },
      { rInit: NaN },
      { driftPerK: NaN },
      { lmsFreezeAt: -1 },
      { nperseg: 8 },
      { mixing: true, mixSamples: 10 },
      { mixing: true, pllZeta: 0 },
      { length: 10 },
      { nUpd: 0 },
      { togglePeriod: 1 },
      { fs: 0 },
      { pole: 1 },
      { randomSource: 'prbs', prbsBits: 8 },
      { mixing: true, dsmFrac: 0 },
      { mixing: true, pllBwHz: 1e12 },
    ]
    const msgs = new Set<string>()
    for (const over of bad) {
      const errs = validateQuantParams({ ...base, ...over })
      expect(errs.length, JSON.stringify(over)).toBeGreaterThan(0)
      errs.forEach((e) => msgs.add(e))
    }
    expect(msgs.size).toBeGreaterThanOrEqual(bad.length)
    ;[...msgs].forEach((m, i) => expectClean(m, `validate ${i}`))
    expect(validateQuantParams(base)).toEqual([])
  })

  it('逐字對照幾個代表性的訊息；沒有數學的訊息、已經是 `$...$` 的訊息不動', () => {
    expect(warnTex('σ_w = 1.5 LSB ≥ 1 LSB：LMS 更新雜訊本身已像 dither')).toBe(String.raw`$\sigma_w$ = 1.5 LSB $\ge1$ LSB：LMS 更新雜訊本身已像 dither`)
    expect(warnTex('Δ_LSB 必須 > 0（fs/LSB），收到 0')).toBe(String.raw`$\Delta_\mathrm{LSB}$ 必須 $>0$（fs/LSB），收到 0`)
    expect(warnTex('N_upd 必須是 1…65536 的整數，收到 0')).toBe(String.raw`$N_\mathrm{upd}$ 必須是 $1\ldots 65536$ 的整數，收到 0`)
    expect(warnTex('LMS 凍結時刻必須是 0…L−1 的整數（0 = 不凍結），收到 -1')).toBe(String.raw`LMS 凍結時刻必須是 $0\ldots L-1$ 的整數（0 = 不凍結），收到 -1`)
    expect(warnTex('AR(1) pole p 必須在 [0, 1)')).toBe('AR(1) pole $p$ 必須在 $[0,1)$')
    expect(warnTex('PLL 頻寬必須在 (0, f_s/2)')).toBe('PLL 頻寬必須在 $(0,f_s/2)$')
    expect(warnTex('平均 code 偏 -3.00e-2 LSB（static error，上限 1/(2L_t) = 0.100 LSB）。加長 L_t')).toBe(
      String.raw`平均 code 偏 $-3.00\times10^{-2}$ LSB（static error，上限 $1/(2L_t)$ = 0.100 LSB）。加長 $L_t$`,
    )
    expect(warnTex('Freeze 輸出 ⌊w*⌋ = 32；static error 為 −0.6 LSB（誤差落在 (−1, 0]，平均偏 −½ LSB）')).toBe(
      String.raw`Freeze 輸出 $\lfloor w^*\rfloor$ = 32；static error 為 $-0.6$ LSB（誤差落在 $(-1,0]$，平均偏 $-\tfrac12$ LSB）`,
    )
    expect(warnTex('dither 被截斷 → 平均值偏移（需 A ≤ w* < 63 − A）。')).toBe(String.raw`dither 被截斷 $\to$ 平均值偏移（需 $A\le w^*<63-A$）。`)
    expect(warnTex('請把凍結點設在 L/4 之前（或加長 L）。')).toBe('請把凍結點設在 $L/4$ 之前（或加長 $L$）。')
    // 英文單字、Case 名稱、策略代號不會被當成變數
    for (const plain of ['Overflow 12 次且使用 wrap：code 由 63 跳到 0（或 0 跳到 63）', 'PRBS 長度只支援 7, 9, 11', '模擬失敗：worker 被終止', 'nperseg（8192）大於訊號長度（4000），改用 nperseg = 4000']) expect(warnTex(plain)).toBe(plain)
    const done = String.raw`已經是 $\sigma_w$ 的訊息`
    expect(warnTex(done)).toBe(done)
  })
})
