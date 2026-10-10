import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultValues, randomValues, renderTex } from '@/components'
import { analyzeBias, nearIntegerSweep, runDcNullComparison, simulateBiasLms, type ErrorModel } from '@/simulation/models/bias'
import { CODE_KIND_TEX, DC_MODE_TEX } from './common'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

/**
 * Ch11 的「字串屬性」LaTeX 檢查（docs/teaching-style.md §3）：
 * 會被 mathText 渲染的字串（ExperimentShell 的 warnings、公式登錄的 title／conditions、表格用的標籤）
 * 裡的數學一律寫成 `$…$`，不可用 Unicode 拼公式；每一段 `$…$` 都要能被 KaTeX 解析。
 */

vi.setConfig({ testTimeout: 180000 })

/** 用 Unicode 拼數學時會出現的字元（希臘字母、上下標、關係符號）；一般文字用的「⇒」「—」「±數字」不在此列 */
const UNICODE_MATH = /[σμκεφρλθωΩΣΔπ√²³⁴⁻¹₀₁₂₃ₖ≤≥≈≠≡∂∈∞]/

/** `$` 是否成對、每一段行內公式是否能被 KaTeX 解析、是否印出 NaN／undefined；回傳問題清單 */
function mathProblems(text: string, where: string): string[] {
  const bad: string[] = []
  const parts = text.split('$')
  if (parts.length % 2 === 0) bad.push(`${where}：$ 不成對 —— ${text}`)
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      if (p.trim() === '') bad.push(`${where}：空的 $$ —— ${text}`)
      if (/katex-error|c-tex-error/.test(renderTex(p, false))) bad.push(`${where}：KaTeX 無法解析 ${p}`)
    } else if (UNICODE_MATH.test(p)) bad.push(`${where}：公式外有 Unicode 數學字元 —— ${p}`)
  })
  if (/NaN|undefined|Infinity/.test(text)) bad.push(`${where}：出現 NaN／undefined —— ${text}`)
  return bad
}

const CUBIC: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 1 }
const model = (o: Partial<ErrorModel>): ErrorModel => ({ a: 1, b: 0, c2: 0, c3: 0, kappa: 0, sigmaV: 1, ...o })

describe('Ch11 字串屬性的 LaTeX（mathText 會渲染的字串）', () => {
  it('公式登錄：title／conditions 的數學都在 $…$ 內，且每一段都能被 KaTeX 解析', () => {
    expect(FORMULAS.length).toBe(17)
    const bad: string[] = []
    let withMath = 0
    for (const f of FORMULAS) {
      bad.push(...mathProblems(f.title, `${f.id} title`), ...mathProblems(f.conditions, `${f.id} conditions`))
      if (/katex-error|c-tex-error/.test(renderTex(f.tex, true))) bad.push(`${f.id} tex`)
      if (f.title.includes('$') || f.conditions.includes('$')) withMath++
    }
    expect(bad).toEqual([])
    expect(withMath).toBeGreaterThanOrEqual(15) // 幾乎每一條的條件都含符號
    // 抽查：轉換後的寫法
    expect(FORMULAS.find((f) => f.id === 'F-11.9')?.title).toBe('Sign-LMS 固定點的 $\\sigma_v$ 二階修正')
    expect(FORMULAS.find((f) => f.id === 'F-11.14')?.conditions).toContain('$C\\le0$ 時固定點為 repelling')
  })

  it('帶入手算：題目、輸入說明、每一步的說明、補充觀察、提示與 validate 訊息的數學都在 $…$ 內（HandCalc 以 mathText 渲染）', () => {
    const bad: string[] = []
    let checked = 0
    const scan = (text: string, where: string) => {
      checked++
      bad.push(...mathProblems(text, where))
    }
    // 會被 validate 擋下的輸入（各題的每一種訊息）
    const invalid: Record<string, Record<string, number>[]> = {
      'HC-11.2': [{ sigma: 0 }, { e: 4, sigma: 1 }],
      'HC-11.3': [{ x1: 2, x2: 2, x3: 2, x4: 2 }],
      'HC-11.4': [{ x1: 0, x2: 0, x3: 0, x4: 0, x5: 0 }],
      'HC-11.5': [{ sigma: 0 }, { eps: 0 }, { sigma: 0.05 }],
      'HC-11.7': [{ px: 0 }, { sigma: 0 }, { C: 0 }],
      'HC-11.8': [{ sigma: 0 }],
    }
    // 會走到不同補充說明分支的輸入（dead zone、repelling、共線、線性化失效、對稱特例、σ_min 超出適用範圍…）
    const branches: Record<string, Record<string, number>[]> = {
      'HC-11.1': [{ w: 1 }, { w: 1.4 }, { c3: 0, w: 1 }],
      'HC-11.2': [{ e: 0 }, { sigma: 0.3 }],
      'HC-11.3': [{ x1: -1.5, x2: -0.5, x3: 0.5, x4: 1.5 }, { b: 0, c2: 0.1 }],
      'HC-11.4': [{ x1: -1, x2: -1, x3: 1, x4: 1, x5: 1 }, { x1: -2, x2: -2, x3: 0, x4: 2, x5: 2 }],
      'HC-11.5': [{ c3: 0 }, { sigma: 100 }, { sigma: 0.5, c3: 0.2, eps: 0.005 }, { a: 0.9, c3: 0.05, eps: 0.005 }, { c3: 0.0001 }],
      'HC-11.6': [{ b: 0.1, c3: 0 }, { b: 0, c3: 0 }, { b: 0.05 }],
      'HC-11.7': [{ C: -0.01 }, { C: 1 }, { C: 2 }],
      'HC-11.8': [{ sigma: 0.5 }, { b: 0.2, c2: 0.05, c3: 0, kappa: 0.05, sigma: 0.5 }, { c3: 0 }, { b: 0.2, c3: 0, x0: 2 }, { kappa: 0.05, b: 0.1 }],
    }
    for (const def of HANDCALCS) {
      scan(def.title, `${def.id} title`)
      def.inputs.forEach((i) => scan(i.label, `${def.id} input ${i.key}`))
      def.tips?.forEach((t, k) => scan(t, `${def.id} tip ${k + 1}`))
      for (const over of invalid[def.id] ?? []) {
        const msg = def.validate?.({ ...defaultValues(def), ...over })
        expect(msg, `${def.id} ${JSON.stringify(over)} 應被擋下`).toBeTruthy()
        scan(msg as string, `${def.id} validate ${JSON.stringify(over)}`)
      }
      const cases = [defaultValues(def), ...[1, 2, 3, 4, 5, 6].map((seed) => randomValues(def, seed)), ...(branches[def.id] ?? []).map((over) => ({ ...defaultValues(def), ...over }))]
      for (const v of cases) {
        expect(def.validate?.(v) ?? null, `${def.id} ${JSON.stringify(v)}`).toBeNull()
        const sol = def.solve(v)
        const where = `${def.id} ${JSON.stringify(v)}`
        sol.steps.forEach((st, k) => scan(st.why, `${where} step ${k + 1} why`))
        sol.results.forEach((r, k) => r.label && scan(r.label, `${where} result ${k + 1}`))
        sol.notes?.forEach((n, k) => scan(n, `${where} note ${k + 1}`))
      }
    }
    expect(bad).toEqual([])
    expect(checked).toBeGreaterThan(800)
  })

  it('表格用的 code 分布／DC null 模式標籤可渲染', () => {
    const bad: string[] = []
    for (const [k, v] of Object.entries({ ...CODE_KIND_TEX, ...DC_MODE_TEX })) bad.push(...mathProblems(v, k))
    expect(bad).toEqual([])
    expect(CODE_KIND_TEX.five_level).toContain('$\\{-2,-1,0,1,2\\}$')
    expect(DC_MODE_TEX.shared_bbpd).toContain('$E[q]=0$')
  })

  it('bias.ts 的每一種警告（analyzeBias／Monte Carlo／DC null 比較／near-integer）都以 $…$ 表示數學並可渲染', () => {
    const five = { kind: 'five_level' as const }
    const pool: string[] = [
      // E[x²] = 0（整數 FCW：residue 恆為 0）與 K = 0 的註記
      ...analyzeBias({ model: model({ b: 0.1 }), code: { kind: 'dsm', dsmFrac: 0 }, algorithm: 'mse', dcMode: 'none' }).warnings,
      // Var(x) = 0 + DC null
      ...analyzeBias({ model: model({ b: 0.1 }), code: { kind: 'dsm', dsmFrac: 0 }, algorithm: 'sign', dcMode: 'shared_bbpd' }).warnings,
      // comparator 飽和：|b| ≫ σ_v
      ...analyzeBias({ model: model({ b: 5, sigmaV: 0.1 }), code: five, algorithm: 'sign', dcMode: 'none' }).warnings,
      // σ_v = 0：加權中位數（唯一解）與 dead zone（區間）
      ...analyzeBias({ model: { ...CUBIC, sigmaV: 0 }, code: five, algorithm: 'sign', dcMode: 'none' }).warnings,
      ...analyzeBias({ model: model({ b: 0.1, sigmaV: 0 }), code: five, algorithm: 'sign', dcMode: 'none' }).warnings,
      // 線性化失效（σ_v = 0.1）
      ...analyzeBias({ model: { ...CUBIC, sigmaV: 0.1 }, code: five, algorithm: 'sign', dcMode: 'none' }).warnings,
      // κ ≠ 0（不可辨識）
      ...analyzeBias({ model: model({ kappa: 0.1 }), code: five, algorithm: 'sign', dcMode: 'none' }).warnings,
      // ±1 code：x³ 與 x 共線
      ...analyzeBias({ model: CUBIC, code: { kind: 'pm_one' }, algorithm: 'mse', dcMode: 'none' }).warnings,
      // 置中的 code + code-dependent jitter + offset（勘誤 E17）
      ...analyzeBias({ model: model({ b: 0.2, jitterSlope: 0.25, jitterRef: -2 }), code: five, algorithm: 'sign', dcMode: 'none' }).warnings,
      // DSM 接近整數 FCW + DC null：servo 跟著 code pattern 走
      ...analyzeBias({ model: model({ b: 0.05, c2: 0.1, sigmaV: 0.5 }), code: { kind: 'dsm', dsmFrac: 1 / 256 }, algorithm: 'sign', dcMode: 'shared_bbpd', w0: 1, servoGain: 0.01 }).warnings,
      // Monte Carlo：發散（g = μE[x²] = 100）與尚未收斂（burn-in 只有 1 個時間常數）
      ...simulateBiasLms({ model: CUBIC, code: five, algorithm: 'mse', dcMode: 'none', mu: 50, N: 4, blocks: 60, chains: 2, w0: 1, seed: 11, traceChains: 0 }).warnings,
      ...simulateBiasLms({ model: CUBIC, code: five, algorithm: 'sign', dcMode: 'none', mu: 0.02 / (Math.sqrt(2 / Math.PI) * 2), N: 64, blocks: 100, chains: 16, w0: 1, seed: 20261012, traceChains: 0 }).warnings,
      // DC null 比較：Var(x) = 0 時設不出 μ
      ...runDcNullComparison({ model: model({ b: 0.1 }), code: { kind: 'dsm', dsmFrac: 0 }, algorithm: 'sign', N: 16, blocks: 200, chains: 2, w0: 1, seed: 1 }).warnings,
      // near-integer：主 PLL 不穩定（只取 bias.ts 自己的訊息；designDtLoop 的警告來自共用的 pll.ts，不在本章範圍）
      ...nearIntegerSweep({ fracs: [0.01, 0.1], wnTs: 1.5, zeta: 0.3, loopDelay: 4, kappaDirect: 0.01, sigmaV: 1 }).warnings.filter((w) => w.startsWith('主 PLL 不穩定')),
    ]
    // 每一種警告都真的被觸發（關鍵字與 bias.test.ts 相同）
    for (const key of ['residue 恆為 0', '沒有激勵', '有效 regressor', 'Comparator 飽和', 'MAE 解', 'dead zone', '線性化失效風險', '與真實 gain 共線', '三階 INL 完全被當成 gain 誤差', '勘誤 E17', 'servo 會跟著 code pattern', '發散', '尚未收斂', '略過 Monte Carlo', '主 PLL 不穩定'])
      expect(pool.some((w) => w.includes(key)), key).toBe(true)
    const bad = pool.flatMap((w, i) => mathProblems(w, `warning ${i}`))
    expect(bad).toEqual([])
    // 代入的數字用 TeX 記號：dead zone 區間、線性化指標
    expect(pool.find((w) => w.includes('一整段區間'))).toContain('$(0.95,\\ 1.05)$')
    // σ_v = 0.1 的三階 INL 例：指標 2.66577（bias.test.ts 的 validityRatio）
    expect(pool.some((w) => w.includes('線性化失效風險') && /\\max\|e_\\mathrm\{det\}\|\/\\sigma_v=2\.66\d*>0\.3\$/.test(w))).toBe(true)
  })

  it('bias.ts 原始碼：所有 String.raw 訊息（含沒被上面觸發的）在代入數字後都可渲染', () => {
    const src = readFileSync(join(process.cwd(), 'src/simulation/models/bias.ts'), 'utf8')
    const literals = Array.from(src.matchAll(/String\.raw`((?:[^`\\]|\\.)*)`/g), (mm) => mm[1].replace(/\$\{[^}]*\}/g, '1'))
    expect(literals.length).toBeGreaterThanOrEqual(18)
    const bad = literals.filter((s) => s.includes('$')).flatMap((s, i) => mathProblems(s, `String.raw #${i}`))
    expect(bad).toEqual([])
    // push 到 warnings 的字串（單行，或 push( 換行後的下一行）在 $…$ 之外不再用 Unicode 拼數學
    const lines = src.split('\n')
    const pushed = lines.flatMap((l, i) => (/warnings\.push\(/.test(l) && !/^\s*\/\//.test(l) ? [l.trim().endsWith('(') ? lines[i + 1] : l] : []))
    expect(pushed.length).toBeGreaterThan(15)
    const outsideMath = (l: string) =>
      l
        .replace(/\$\{[^}]*\}/g, '1')
        .split('$')
        .filter((_, i) => i % 2 === 0)
        .join(' ')
    expect(pushed.filter((l) => UNICODE_MATH.test(outsideMath(l)))).toEqual([])
  })
})
