import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultValues, randomValues, renderTex } from '@/components'
import { analyzeBias, nearIntegerSweep, runDcNullComparison, simulateBiasLms, type ErrorModel } from '@/simulation/models/bias'
import { CODE_KIND_TEX, DC_MODE_TEX, gappedSeries, positiveOrGap } from './common'
import { CH11_DIAGRAMS } from './diagrams'
import { gainBiasShown, residualAllZero, residualCaption, residualDust, residualPlotTitle, residualPowerNote } from './experiments/BiasInlLab'
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

  it('審查 R01／R05：F-11.14 的適用條件與 F-11.10 的「變號點」寫在公式登錄裡，claim 標籤不變', () => {
    // R01：a + B/C 對 Sign-LMS 是 K_q 線性化，條件（0.3 與 γ_lin ≤ 0.05）與「超出時只是線性外推」都在 conditions 裡
    const ni = FORMULAS.find((f) => f.id === 'F-11.14')
    expect(ni?.claim).toBe('approx')
    for (const t of ['MSE-LMS', 'F-11.3', String.raw`\le0.3\,\sigma_v`, String.raw`|\gamma_\mathrm{lin}|\le0.05`, String.raw`2\sqrt3\,\sigma_x`, String.raw`0.087\,\sigma_v/\sigma_x`, '線性外推', 'Ch06 F-06.19'])
      expect(ni?.conditions, t).toContain(t)
    expect(0.3 / (2 * Math.sqrt(3))).toBeCloseTo(0.087, 3) // 門檻 0.3 ÷ sawtooth 跳變 2√3
    expect(FORMULAS.find((f) => f.id === 'F-11.15')?.conditions).toContain('小訊號斜率')
    // R05：無雜訊、離散 code 的 E[G] 是階梯——公式不再寫「= 0」，而是寫兩側的正負號與 MAE 的最小點
    const med = FORMULAS.find((f) => f.id === 'F-11.10')
    expect(med?.claim).toBe('exact')
    expect(med?.tex).not.toContain(String.raw`\big]=0`)
    expect(med?.tex).toContain(String.raw`\arg\min_w E|e|=1.4`)
    expect(med?.tex).toContain(String.raw`E[G](w)>0\ \ (w<w^*)`)
    expect(med?.title).toContain('變號點')
    for (const t of ['由正跳到負', String.raw`\operatorname{sign}(0)`, String.raw`$+0.4\to-1.2$`, String.raw`$E[G](1.4)=-0.4$`, 'dead zone']) expect(med?.conditions, t).toContain(t)
    const hc6 = HANDCALCS.find((h) => h.id === 'HC-11.6')
    expect(hc6?.formulaTex).not.toContain(String.raw`\big)=0`)
    expect(hc6?.formulaTex).toContain(String.raw`\text{由正變負的位置}=w^*`)
    expect(/katex-error|c-tex-error/.test(renderTex(hc6?.formulaTex ?? '', true))).toBe(false)
  })

  it('審查 C04：MSE-LMS 的殘差表不是「e 本身不為 0」——x = 0 那一列是 0；沒有 INL 時整欄都是 0', () => {
    const cubic = analyzeBias({ model: CUBIC, algorithm: 'mse', dcMode: 'none', code: { kind: 'five_level' } })
    expect(cubic.wStar).toBeCloseTo(1.34, 12)
    const want = [-0.12, 0.24, 0, -0.24, 0.12]
    cubic.residual?.forEach((r, i) => expect(r.eStar).toBeCloseTo(want[i], 12))
    expect(cubic.residual?.filter((r) => r.eStar === 0).map((r) => r.x)).toEqual([0]) // 恰好一個 0：x = 0
    // 舊圖說「但 e 本身不為 0」的反例：c₃ = 0 ⇒ w* = a，每一列的殘差都是 0
    const flat = analyzeBias({ model: { ...CUBIC, c3: 0 }, algorithm: 'mse', dcMode: 'none', code: { kind: 'five_level' } })
    expect(flat.wStar).toBe(1)
    expect(flat.residual?.every((r) => r.eStar === 0)).toBe(true)
  })

  it('審查 C04：Lab 的殘差表圖說、KPI 的殘差功率註記與殘差圖的標題跟著模型的數字走（不可對每一組設定都寫「不為 0」），數學上是 0 的殘差不印浮點殘渣', () => {
    const run = (o: Partial<ErrorModel>, algorithm: 'mse' | 'sign') => analyzeBias({ model: model(o), algorithm, dcMode: 'none', code: { kind: 'five_level' }, w0: 1 })
    // (1) 三階 INL（Lab 的預設）：四個非零 code 的殘差是真的
    for (const algorithm of ['mse', 'sign'] as const) {
      const cubic = run({ c3: 0.1 }, algorithm)
      expect(residualAllZero(cubic)).toBe(false)
      expect(cubic.residual?.map((r) => residualDust(cubic, r.eStar) === 0)).toEqual([false, false, true, false, false]) // 只有 x = 0 那一列是 0
      expect(residualDust(cubic, cubic.costs[2].mse, 2)).toBe(cubic.costs[2].mse) // 0.0288：不被歸零
      expect(gainBiasShown(cubic, 1)).toBe(cubic.wStar - 1)
    }
    // (2) preset bias-kappa-identifiability（κ = 0.1、沒有 INL）：w* = a + κ，每個 code 的殘差都是 0（§11.3）
    for (const algorithm of ['mse', 'sign'] as const) {
      const kap = run({ kappa: 0.1 }, algorithm)
      expect(residualAllZero(kap)).toBe(true)
      expect(kap.residual?.map((r) => residualDust(kap, r.eStar))).toEqual([0, 0, 0, 0, 0])
      expect(kap.residual?.map((r) => Number(residualDust(kap, r.eAtA).toFixed(12)))).toEqual([-0.2, -0.1, 0, 0.1, 0.2]) // w = a 處的殘差 κ·x 照舊
      expect(residualDust(kap, kap.costs[2].mse, 2)).toBe(0) // 模型回傳 1.4e-32
      expect(residualDust(kap, kap.costs[2].mae)).toBe(0)
      expect(residualDust(kap, kap.costs[0].mse, 2)).toBeCloseTo(0.02, 12) // 校正前 E[(κx)²] = 0.01·2
      expect(gainBiasShown(kap, 1)).toBeCloseTo(0.1, 12) // gain bias 是真的：誤差藏在 gain 裡
    }
    // (3) 沒有任何誤差來源、或置中 code + offset：gain bias 是 0（求根的 1e-13 不印出來），但 offset 的殘差 b 是真的
    const off = run({ b: 0.2 }, 'sign')
    expect(gainBiasShown(off, 1)).toBe(0)
    expect(residualAllZero(off)).toBe(false)
    expect(residualAllZero(run({}, 'mse'))).toBe(true)

    // KPI 註記：四種情形
    const notes = {
      root: residualPowerNote({ jump: false, allZero: false, biased: true }),
      jump: residualPowerNote({ jump: true, allZero: false, biased: true }),
      zeroBiased: residualPowerNote({ jump: false, allZero: true, biased: true }),
      zeroClean: residualPowerNote({ jump: false, allZero: true, biased: false }),
      jumpZero: residualPowerNote({ jump: true, allZero: true, biased: true }),
    }
    expect(notes.root).toBe(String.raw`$E[G]=0$ 但殘差功率 $\neq0$`)
    expect(notes.jump).toBe(String.raw`$E[G]$ 在 $w^*$ 變號（時間平均為 0），殘差功率 $\neq0$`)
    for (const n of [notes.zeroBiased, notes.zeroClean, notes.jumpZero]) {
      expect(n).toContain('殘差功率也是 0')
      expect(n).not.toContain(String.raw`殘差功率 $\neq0$`)
    }
    expect(notes.zeroBiased).toContain('不可辨識')
    expect(notes.zeroClean).toContain('沒有 gain bias')
    expect(notes.jumpZero).toContain('變號')

    // 殘差圖的標題
    expect(residualPlotTitle({ hasFixedPoint: true, allZero: false })).toBe('殘差 vs code：GMAC 歸零，殘差不全為 0')
    expect(residualPlotTitle({ hasFixedPoint: true, allZero: true })).toBe('殘差 vs code：這組設定下每個 code 的殘差都是 0')
    expect(residualPlotTitle({ hasFixedPoint: false, allZero: false })).not.toContain('GMAC 歸零')

    // 殘差表的圖說（審查 C04 改寫後的兩句；舊的「但 e 本身不為 0」不可回來）
    const cap = (o: Partial<Parameters<typeof residualCaption>[0]>) => residualCaption({ isSign: true, jump: false, allZero: false, gLeft: 0.4, gRight: -1.2, avgXg: 0.4, ...o })
    expect(cap({ isSign: false })).toBe(String.raw`MSE-LMS：$x\,e$ 欄的機率加權平均為 0（GMAC 歸零），但這不代表 $e(x;\,w^*)$ 欄的每一列都是 0。`)
    expect(cap({})).toContain(String.raw`$x\,e$ 欄的平均一般不為 0`)
    expect(cap({})).toContain(String.raw`機率加權平均為 0 的是最後一欄 $x\,E[q|x]$`)
    expect(cap({ allZero: true })).toContain('整欄都是 0')
    expect(cap({ allZero: true })).not.toContain('一般不為 0')
    expect(cap({ isSign: false, allZero: true })).toContain('每個 code 的殘差')
    expect(cap({ isSign: false, allZero: true })).not.toContain('不代表')
    const jumpCap = cap({ jump: true })
    for (const t of ['$0.4$ 跳到 $-1.2$', '變號而不是連續地通過 0', '在表中這個數值解上的機率加權平均是 $0.4$', '就是 tie 的 code', '顯示時歸零']) expect(jumpCap, t).toContain(t)
    const all = [...Object.values(notes), cap({ isSign: false }), cap({}), cap({ allZero: true }), cap({ isSign: false, allZero: true }), jumpCap, cap({ jump: true, allZero: true })]
    for (const t of all) expect(t).not.toMatch(/本身不為 0|沒有一個是 0/)
    expect(all.flatMap((t, i) => mathProblems(t, `Lab 字串 ${i}`))).toEqual([])
  })

  it('審查 C09：GMAC 固定點的條件是「正交」$E[x\\,e]=0$，不是「不相關」——code 沒有置中時兩者不同（HC-11.3 的預設值）', () => {
    // x ∈ {0,1,2,3}、a = 1、b = 0.5 的 MSE 固定點：w* = a + b·E[x]/E[x²] = 1 + 0.5·1.5/3.5
    const an = analyzeBias({ model: model({ b: 0.5 }), algorithm: 'mse', dcMode: 'none', code: { kind: 'unipolar4' } })
    expect(an.wStar).toBeCloseTo(1 + 0.75 / 3.5, 12)
    const rows = an.residual ?? []
    const E = (f: (r: (typeof rows)[number]) => number) => rows.reduce((acc, r) => acc + r.p * f(r), 0)
    const Ex = E((r) => r.x)
    const Ee = E((r) => r.eStar)
    const Exe = E((r) => r.x * r.eStar)
    expect(Math.abs(Exe)).toBeLessThan(1e-12) // 正交：GMAC 歸零
    expect(Ex).toBeCloseTo(1.5, 12)
    expect(Ee).toBeCloseTo(0.5 - (0.75 / 3.5) * 1.5, 12) // E[e] = b − (w* − a)·E[x] = 0.178571
    const cov = Exe - Ex * Ee
    expect(cov).toBeCloseTo(-0.2678571, 6) // 共變異數不是 0：e 與 x 並不是「不相關」
    const varX = E((r) => r.x * r.x) - Ex * Ex
    const varE = E((r) => r.eStar * r.eStar) - Ee * Ee
    expect(cov / Math.sqrt(varX * varE)).toBeCloseTo(-1, 9) // 相關係數 −1（e 是 x 的遞減直線）
    // 文字：Recap、§11.A、連結到 PLL、bias 表與 HC-11.3 都說「正交」，並在第一次出現時寫出什麼時候等於「不相關」
    const read = (f: string) => readFileSync(join(process.cwd(), 'src/chapters/ch11', f), 'utf8')
    const wrap = read('sections/WrapSection.tsx')
    const fp = read('sections/FixedPointSection.tsx')
    expect(wrap).toContain('GMAC 歸零只代表誤差「與 code 正交」（$E[x]=0$ 時也就是不相關）')
    expect(wrap).not.toContain('與 code 不相關')
    expect(wrap).not.toMatch(/與 <Tex>\{'x'\}<\/Tex> 不相關/)
    expect(wrap).toMatch(/只保證這個 pattern 與 <Tex>\{'x'\}<\/Tex> 正交/)
    expect(fp).toMatch(/「<Tex>\{'q'\}<\/Tex> 與 <Tex>\{'x'\}<\/Tex> 正交」/)
    expect(fp).not.toMatch(/與 <Tex>\{'x'\}<\/Tex> 不相關」/)
    expect(fp).not.toContain('干擾與 code 不相關')
    expect(fp).toMatch(/\\varepsilon_\{cc\}`\}<\/Tex> 與 <Tex>\{'x'\}<\/Tex> 正交（相乘再平均等於 0）/) // bias 表「何時為 0」：和上一列的「d(x) 與 x 正交」同一個詞
    const prereq = read('sections/ModelSection.tsx')
    for (const t of ['正交（orthogonal）', '不相關（uncorrelated）', '所以「GMAC 歸零」檢查的是正交']) expect(prereq, t).toContain(t)
    const hc3 = HANDCALCS.find((h) => h.id === 'HC-11.3')
    if (!hc3) throw new Error('HC-11.3 不存在')
    const why = hc3.solve(defaultValues(hc3)).steps[0].why
    expect(why).toContain('常數 offset 與 code 不正交')
    expect(why).toContain('共變異數則永遠是 0')
    expect(why).not.toMatch(/不相關|「相關」/)
    const centred = hc3.solve({ ...defaultValues(hc3), x1: -1.5, x2: -0.5, x3: 0.5, x4: 1.5 }).steps[0].why
    expect(centred).toContain('常數 offset 與 code 正交')
    expect(centred).not.toContain('不相關')
  })

  it('審查 R01 的收尾：匯出的 B/C 欄叫線性候選（不是 w_minus_a）；量測流程圖的「bias 被放大」寫明是線性化的；log 軸上 C ≤ 0 的點斷線', () => {
    const src = readFileSync(join(process.cwd(), 'src/chapters/ch11/sections/NearIntegerSection.tsx'), 'utf8')
    expect(src).toContain('B_over_C_linear: res.bias')
    expect(src).not.toContain('w_minus_a')
    expect(src).toContain('lin_valid: res.linValid.map')
    // 量測流程圖（slope-measure）與敏感度鏈（near-integer-why）用同一句話
    const slope = CH11_DIAGRAMS.find((d) => d.id === 'slope-measure')
    expect(slope?.chart).toContain(String.raw`線性化的 bias $= B / C$ 被放大`)
    expect(slope?.caption).toContain(String.raw`線性化的 bias $B/C$ 被放大`)
    expect(slope?.caption).toContain('不再是固定點')
    expect(mathProblems(slope?.caption ?? '', 'slope-measure caption')).toEqual([])
    expect(CH11_DIAGRAMS.find((d) => d.id === 'near-integer-why')?.chart).toContain(String.raw`線性化的 bias $= B / C$ 被放大`)
    // log 軸：≤ 0 的值改成 null（線在那裡斷開），正的值不動
    expect([0.5, 1e-9, 0, -0.01, Number.NaN].map(positiveOrGap)).toEqual([0.5, 1e-9, null, null, null])
    expect(src).toContain('res.Cfreq.map(positiveOrGap)')
    // ζ = 0.3、loop delay = 4、ω_nT_s = 0.1（滑桿到得了）：有 5 個 FCW 的 C < 0，其餘為正
    const fracs = Array.from({ length: 32 }, (_, i) => 10 ** (Math.log10(3e-4) + ((Math.log10(0.5) - Math.log10(3e-4)) * i) / 31))
    const r = nearIntegerSweep({ fracs, wnTs: 0.1, zeta: 0.3, loopDelay: 4, kappaDirect: 0.01, sigmaV: 1 })
    const neg = r.Cfreq.map((c, i) => (c <= 0 ? i : -1)).filter((i) => i >= 0)
    expect(neg).toEqual([10, 11, 12, 14, 16])
    const shown = r.Cfreq.map(positiveOrGap)
    expect(shown.filter((v) => v === null)).toHaveLength(5)
    expect(shown.every((v) => v === null || v > 0)).toBe(true)
  })

  it('審查 R01 的圖：通過／未通過的 FCW 各畫一條線，同一類的點不相鄰時在那裡斷線（線不跨過另一類的點）', () => {
    expect(gappedSeries([0, 1, 2], [10, 20, 30, 40], [1, 2, 3, 4])).toEqual({ x: [10, 20, 30], y: [1, 2, 3] })
    expect(gappedSeries([0, 2, 3], [10, 20, 30, 40], [1, 2, 3, 4])).toEqual({ x: [10, null, 30, 40], y: [1, null, 3, 4] })
    expect(gappedSeries([], [10], [1])).toEqual({ x: [], y: [] })
    // 滑桿到得了的設定（ζ = 0.3，其餘為預設）：第 8 點通過、第 9 點沒通過、第 10 點起又通過——兩條線都要在那裡斷開
    const fracs = Array.from({ length: 32 }, (_, i) => 10 ** (Math.log10(3e-4) + ((Math.log10(0.5) - Math.log10(3e-4)) * i) / 31))
    const r = nearIntegerSweep({ fracs, wnTs: 0.02, zeta: 0.3, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 })
    expect(r.linValid.slice(0, 11)).toEqual([false, false, false, false, false, false, false, false, true, false, true])
    const pick = (keep: boolean) => r.frac.map((_, i) => i).filter((i) => r.linValid[i] === keep)
    const ok = gappedSeries(pick(true), r.frac, r.bias)
    const no = gappedSeries(pick(false), r.frac, r.bias)
    expect(ok.x.slice(0, 3)).toEqual([r.frac[8], null, r.frac[10]])
    expect(no.x.slice(7, 10)).toEqual([r.frac[7], null, r.frac[9]])
    expect(ok.x.filter((v) => v !== null)).toHaveLength(pick(true).length)
    expect(no.y.filter((v) => v !== null)).toHaveLength(pick(false).length)
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
      'HC-11.7': [{ C: -0.01 }, { C: 1 }, { C: 2 }, { sigma: 20 }, { C: 0.5 }, { kd: 0, C: 0.1 }, { kd: -0.05, px: 0.5, C: 0.02, sigma: 0.5 }],
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
