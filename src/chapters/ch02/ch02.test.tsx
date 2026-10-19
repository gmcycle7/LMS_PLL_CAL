import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { PresetEntry } from '@/data/types'
import { deriveSeed, meanCI } from '@/simulation/core'
import {
  algoStepSizes,
  batchVsSgd,
  meanFieldAnalysis,
  monteCarloCompare,
  meanFieldInputOf,
  predictSteadyState,
  runShared,
  runSignErrorFixedX,
  signErrorLimitCycle,
  travelDistance,
  type AlgoId,
  type CaseConfig,
} from '@/simulation/models/sgd'
import Chapter02 from './index'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { SYMBOLS } from './sections/Symbols'
import { DEFAULT_CASE, DEFAULT_SHARED, caseWarnings, limitCycleLabel, sanitizeCase, sanitizeShared, stepsToSettle, unstableLabel } from './experiments/SignLmsCompare'
import { tn } from './common'
import { fixedPointConsistency, summarizeConsistency, texSig } from './experiments/consistency'
import { mathText, renderTex } from '@/components'
import { BATCH_MC_RUNS, BatchVsSgd, batchVsSgdMcCheck } from './experiments/BatchVsSgd'
import { FixedPointExplorer } from './experiments/FixedPointExplorer'
import { GdExplorer } from './experiments/GdExplorer'
import { LimitCycleBand } from './experiments/LimitCycleBand'
import { SignLmsCompare } from './experiments/SignLmsCompare'
import { plotlyMock } from '@/test/mocks/plotly'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

/**
 * 逾時（ms）。整章渲染在空機上只要幾秒；但多個 agent／開發者同時跑測試時（18 核機器的 load average 曾超過 600）
 * 會慢上數十倍，所以逾時刻意設得很寬——逾時只是「不要卡死」的保險，不是效能斷言。
 */
const T_PAGE = 600_000 // 渲染整章（五個實驗 + 八題手算 + 全部 KaTeX）
const T_EXP = 240_000 // 單一實驗、或逐一載入 preset
const T_WAIT = 120_000 // waitFor：等 debounce 與（jsdom 下 inline 的）Worker
vi.setConfig({ testTimeout: 120_000 }) // 沒有另外指定逾時的測試（Monte Carlo 對照等）

function renderAt(node: ReactNode, path = '/ch/02', mode: 'beginner' | 'engineer' | 'research' = 'engineer') {
  return renderPage(node, { mode, url: path, future: true })
}

/**
 * KaTeX 的 MathML annotation 保留原始 TeX。若 JS 字串裡的 TeX 少了一個反斜線（'\\pm' 寫成 '\pm'），
 * KaTeX 不會報錯，只會把 "pm"、"operatorname" 當成一般字母——這裡把這種無聲錯誤抓出來。
 */
const BARE_MACRO = /(?<![\\a-zA-Z])(operatorname|tfrac|dfrac|frac|equiv|Rightarrow|Leftarrow|iff|qquad|quad|varepsilon|ldots|cdots|boxed|neq|sigma|psi|lambda|sqrt|approx|tilde|mathbf|infty|times|cdot|pm|mu|delta|eta|tau|pi|hat|text|ln)(?![a-zA-Z])/
function bareMacros(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('annotation[encoding="application/x-tex"]'))
    .map((a) => a.textContent ?? '')
    .filter((src) => BARE_MACRO.test(src.replace(/\\text\{[^}]*\}/g, '')))
}

/**
 * teaching-style §3：字串屬性（警告、指標、假設、圖標題…）裡的數學也要是 KaTeX。
 * 找出 KaTeX 以外、仍用 Unicode 拼公式的文字節點（下拉選單 <option>、程式碼、Plotly 圖內文字除外；控制項的單位欄也要是 KaTeX）。
 */
const UNICODE_MATH = /[μσδψεηλτρ²³⁴₀₁₂ₙ″≤≥≈∝]|E\[/
function unicodeMath(root: ParentNode): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = (n.textContent ?? '').trim()
    const el = n.parentElement
    if (!t || !el || !UNICODE_MATH.test(t)) continue
    if (/個 ≤0 的點/.test(t)) continue // 共用 Plot 元件的 log 軸提示（不屬於本章）
    if (el.closest('.katex, pre, code, svg, select, option, input, .c-param-reg, .c-tip, .c-exp-summary')) continue
    out.push(t.slice(0, 80))
  }
  return out
}

/** 逐一載入某實驗的所有 preset（含會觸發警告的），每次都檢查：沒有 KaTeX 錯誤、沒有漏反斜線的巨集、沒有 Unicode 拼的公式。 */
async function cyclePresets(node: ReactNode, expId: string, path = '/ch/02') {
  const { container, unmount } = renderAt(node, path)
  const exp = container.querySelector(`[data-experiment="${expId}"]`) as HTMLElement
  const select = exp.querySelector('.c-exp-presets select') as HTMLSelectElement
  const names = Array.from(select.options)
    .slice(1)
    .map((o) => o.textContent ?? '')
  const seen: { name: string; warnings: number }[] = []
  for (let i = 0; i < names.length; i++) {
    act(() => {
      fireEvent.change(select, { target: { value: String(i) } })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320)) // 等 debounce 與 inline worker
    })
    expectNoTexErrors(exp, names[i])
    expect(bareMacros(exp).map((s) => `${names[i]}: ${s}`)).toEqual([])
    expect(unicodeMath(exp).map((s) => `${names[i]}: ${s}`)).toEqual([])
    seen.push({ name: names[i], warnings: exp.querySelectorAll('.c-exp-warnings .c-callout').length })
  }
  unmount()
  return seen
}

const PRESET_DIR = resolve(process.cwd(), 'src/data/presets')
const presets: PresetEntry[] = readdirSync(PRESET_DIR)
  .filter((f) => f.startsWith('sign-lms') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(PRESET_DIR, f), 'utf8')) as PresetEntry)

function caseFromPreset(id: string, which = 0): CaseConfig {
  const p = presets.find((x) => x.id === id)!.params as Record<string, unknown>
  const shared = sanitizeShared(p)
  const a = sanitizeCase(p)
  const cases = [a, ...((p.compare as Record<string, unknown>[] | undefined) ?? []).map((c) => sanitizeCase(c, a))]
  return { a: shared.a, w0: shared.w0, steps: shared.steps, ...cases[which] }
}

describe('Ch02 頁面（jsdom smoke）', () => {
  it('完整章節可渲染：章末符號表、勘誤連結、五個實驗、程式碼比較、思考題與必記；TeX 全部可解析', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = renderAt(<Chapter02 />)
    // 符號表在章末（teaching-style §5）：只有一份，是頁面最後一個區塊（在「本課必記」與「下一個值得研究的問題」之後），外層 id="symbols"
    expect(Array.from(container.querySelectorAll('.c-symbols-title')).map((e) => e.textContent)).toEqual(['本章符號'])
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    const chapter = container.querySelector('.ch02')!
    const symbols = document.getElementById('symbols')!
    expect(symbols).toBeTruthy()
    expect(chapter.lastElementChild).toBe(symbols)
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(SYMBOLS.length)
    expect(new Set(SYMBOLS.map((r) => r.symbol)).size).toBe(SYMBOLS.length)
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(30) // 原有的 30 列都還在（另外補上方塊圖用到的 q、G_k、ŷ…）
    for (const before of ['.c-recap', '#ch02-s6', '[data-experiment="sign-lms-compare"]', '.c-section-assumptions:last-of-type'])
      expect(container.querySelector(before)!.compareDocumentPosition(symbols) & FOLLOWING, `${before} 應在符號表之前`).toBeTruthy()
    for (const el of Array.from(container.querySelectorAll('h2, .c-quiz, .c-handcalc, .c-recap, [data-diagram], [data-experiment]')).filter((e) => !symbols.contains(e)))
      expect(el.compareDocumentPosition(symbols) & FOLLOWING).toBeTruthy()
    // 章首骨架（teaching-style §9）：開場問題是第一個區塊、系統地圖緊接在後、「你在這裡」標成 .c-map-note（PageFrame 的本章資訊 strip 接在它後面）；
    // 不再有「本章符號表在最後」那一行（連結在 strip 裡），也沒有會改變路由的 href
    expect(container.querySelectorAll('.ch02-symbols-link')).toHaveLength(0)
    const question = container.querySelector('.ch02-question')!
    expect(question.nextElementSibling).toBe(container.querySelector('figure.c-mermaid.c-sysmap'))
    expect(question.nextElementSibling!.nextElementSibling).toBe(container.querySelector('p[data-system-map-note].c-map-note'))
    expect(question.compareDocumentPosition(container.querySelector('#ch02-s1')!) & FOLLOWING).toBeTruthy()
    expect(container.querySelector('.ch02 a[href="#symbols"], .ch02 a[href$="/symbols"]')).toBeNull()
    // 章末有「回到章首」：捲回開場問題
    const top = document.getElementById('ch02-top')!
    expect(top.classList.contains('ch02-question')).toBe(true)
    const topSpy = vi.fn()
    top.scrollIntoView = topSpy
    act(() => {
      fireEvent.click(symbols.querySelector('button[data-jump="ch02-top"]')!)
    })
    expect(topSpy).toHaveBeenCalledTimes(1)
    // 符號表不在章首了：每個符號第一次出現時，正文要就地用一句話說明（teaching-style §5）
    const body = Array.from(chapter.children)
      .filter((e) => e !== symbols)
      .map((e) => e.textContent ?? '')
      .join('\n')
    for (const phrase of [
      '是我們能調的係數（旋鈕）', // w（章首）
      '是成本（cost）', // J(w)
      '是藏在盒子裡、我們不知道的真實係數', // a
      '（又叫 regressor）', // x
      '（量到的減掉預測的）', // e = y − ŷ
      '一個我們自己選的正數，決定每一步走多大', // μ
      '（離谷底還差多少；全站一律是「真值減估計」）', // δ = a − w
      '成本的二階導數：坡度隨位置變化得多快', // J''
      '（量測時混進來、我們控制不了的隨機擾動）', // v
      '是輸入功率（', // P_x
      '（坡度為零的點，也叫固定點）', // w*
      '（只用第', // ĝ_n
      '資料的總筆數', // N
      'batch 大小', // B
      '是 block 的編號', // k
      '的標準差，', // σ_v
      '取正負號：正數給', // sign
      '就是這顆 comparator 的 1-bit 輸出', // q
      '（步長乘上輸入的大小，和誤差多大無關）', // h
      '還沒越過', // n_c
      '剩下的距離', // ρ
      '（平均更新方向）', // ψ(w)
      '只是取平均時把它當成一個固定的數', // d
      '是雜訊在 0 的機率密度', // f_v(0)
      '是起始步長', // μ₀
      '是時間常數（走到第', // n₀
      '叫做梯度雜訊變異', // σ_η²
      '是避免除以零的小常數', // ε
      '是除過之後的步長，沒有單位', // μ̃
      '是誤差與輸入的位元數', // B_e、B_x
      '每單位步長的 loop gain', // K
      '（正規化 loop gain）', // g
    ])
      expect(body, `正文缺少就地說明：${phrase}`).toContain(phrase)
    const errata = Array.from(container.querySelectorAll('a.c-erratum-link'))
    const ids = new Set(errata.map((a) => /E\d\d/.exec(a.textContent ?? '')?.[0]))
    for (const id of ['E40', 'E41', 'E43']) expect(ids.has(id), id).toBe(true)
    for (const a of errata) expect(a.getAttribute('href')).toBe(`/verification?e=${a.getAttribute('data-erratum')}`)
    for (const id of ['gd-tangent', 'gd-batch-vs-sgd', 'sign-lms-band', 'sign-lms-fixed-points', 'sign-lms-compare'])
      expect(container.querySelector(`[data-experiment="${id}"]`), id).toBeTruthy()
    for (const label of ['LMS', 'Sign-Error', 'Sign-Sign', 'Huber', 'NLMS']) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.c-code-mark').length).toBeGreaterThan(4)
    expect(container.querySelectorAll('.c-steps').length).toBeGreaterThan(10)
    act(() => {
      for (const b of screen.getAllByText('看答案與解析')) fireEvent.click(b)
    })
    expect(container.querySelectorAll('.c-quiz-answer').length).toBeGreaterThanOrEqual(6)
    expect(screen.getByText('這一課最重要的公式')).toBeTruthy()
    expectNoTexErrors(container)
    expect(bareMacros(container)).toEqual([])
    // 內文與字串屬性都沒有 Unicode 拼的公式（teaching-style §3）
    expect(unicodeMath(container)).toEqual([])
    // 程式碼 region 名稱都存在（找不到 region 時 CodeBlock 顯示「程式碼載入錯誤」）
    expect(container.textContent).not.toContain('程式碼載入錯誤')
    // 帶入手算（teaching-style §7）：8 題依 ID 順序出現，每題前面有一句「換你算」的引言；綜合題（HC-02.8）在最後一題思考題之前
    const hcs = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(hcs.map((e) => e.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    for (const e of hcs) {
      const slot = e.closest('.c-chapter-hand') as HTMLElement
      expect(slot.getAttribute('data-handcalc')).toBe(e.id.replace('handcalc-', ''))
      expect(slot.querySelector('.c-chapter-hand-lead')?.textContent).toMatch(/換你算：.*(先|親手)/)
      expect(e.querySelectorAll('.c-step').length, e.id).toBeGreaterThan(0)
    }
    const quiz6 = Array.from(container.querySelectorAll('.c-quiz')).find((q) => q.querySelector('.c-quiz-title')?.textContent?.includes('思考題 6'))!
    expect(hcs[hcs.length - 1].compareDocumentPosition(quiz6) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const quiz5 = Array.from(container.querySelectorAll('.c-quiz')).find((q) => q.querySelector('.c-quiz-title')?.textContent?.includes('思考題 5'))!
    expect(quiz5.compareDocumentPosition(hcs[hcs.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 每一題都放在它對應的公式之後（先看推導，再代數字）
    for (const h of HANDCALCS) {
      const anchor = document.getElementById(`formula-${h.formulaId}`)!
      const el = container.querySelector(`[id="handcalc-${h.id}"]`)!
      expect(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, `${h.id} 應在 ${h.formulaId} 之後`).toBeTruthy()
    }
    // §2 沒有自己的手算題：有一段指引說明它的公式在哪幾題代數字（列出的題號都存在）；章末有「手算練習簿」的連結與正確的題數
    const ptr = container.querySelector('[data-handcalc-pointer="s2"]')!
    const cited = Array.from(ptr.textContent!.matchAll(/HC-02\.\d+/g)).map((m) => m[0])
    expect(cited.length).toBeGreaterThanOrEqual(3)
    for (const id of cited) expect(HANDCALCS.some((h) => h.id === id), id).toBe(true)
    const wb = container.querySelector('[data-handcalc-pointer="workbook"]')!
    expect(wb.querySelector('a')?.getAttribute('href')).toBe('#/workbook')
    expect(wb.textContent).toContain(`本章共 ${HANDCALCS.length} 題帶入手算（HC-02.1–HC-02.${HANDCALCS.length}）`)
    // F-02.13 的適用條件：sign 類的小步長要在 comparator 輸入端比（μx² ≪ σ_v，即 μK ≪ 1），不是和帶寬 μ|x| 比（量綱不同）
    const f13 = document.getElementById('formula-F-02.13')!
    expect(f13.querySelector('annotation')?.textContent).toContain(String.raw`\mu x^2\ll\sigma_v`)
    expect(f13.querySelector('annotation')?.textContent).not.toContain(String.raw`\sigma_v\gg\mu|x|`)
    const validity = container.querySelector('[data-linearization-validity]')!
    expect(validity.textContent).toMatch(/Monte Carlo 對照/)
    expect(validity.textContent).toContain('HC-02.8')
    expect(FORMULAS.find((f) => f.id === 'F-02.13')!.conditions).toContain(String.raw`$\mu x^2\ll\sigma_v$`)
    // R05：「E[sign(e)x]=0」是連續分布的說法；有限個值時平均更新是階梯函數、固定點是它變號的位置——F-02.9、F-02.8 兩個方框後面各有一段小字，登錄的條件也寫了
    const stepNotes = Array.from(container.querySelectorAll('.ch02 .ch02-note')).filter((n) => /階梯函數/.test(n.textContent ?? ''))
    expect(stepNotes).toHaveLength(2)
    for (const note of stepNotes) expect(note.textContent).toMatch(/由正跳到負/)
    for (const [id, note] of [['F-02.9', stepNotes[0]], ['F-02.8', stepNotes[1]]] as const)
      expect(document.getElementById(`formula-${id}`)!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING, `${id} 方框之後`).toBeTruthy()
    expect(FORMULAS.find((f) => f.id === 'F-02.8')!.conditions).toMatch(/階梯函數.*由正跳到負.*變號的位置/)
    // Engineer 模式：除了 Research 專屬的 F-02.17 外，每個公式 ID 都有錨點
    for (const fm of FORMULAS.filter((f) => f.id !== 'F-02.17')) expect(document.getElementById(`formula-${fm.id}`), fm.id).toBeTruthy()
    // Worker（jsdom 下 inline）完成後，主實驗與固定點實驗的 analytic cross-check 應為 ok
    await waitFor(
      () => {
        const ok = container.querySelectorAll('[data-experiment="sign-lms-compare"] .c-check-ok, [data-experiment="sign-lms-fixed-points"] .c-check-ok')
        expect(ok.length).toBeGreaterThanOrEqual(4)
      },
      { timeout: T_WAIT },
    )
    expect(container.querySelectorAll('[data-experiment="sign-lms-compare"] .c-check-mismatch').length).toBe(0)
    expect(container.querySelectorAll('[data-experiment="sign-lms-fixed-points"] .c-check-mismatch').length).toBe(0)
    // 預設參數下，五個實驗的 MetricTable 都不應出現「超出容許誤差」
    expect(Array.from(container.querySelectorAll('.c-bad[title^="超出容許誤差"]')).map((e) => e.closest('tr')?.textContent)).toEqual([])
    expect(consoleError.mock.calls.map((c) => String(c[0])).filter((m) => !/not wrapped in act/.test(m))).toEqual([])
    consoleError.mockRestore()
  }, T_PAGE)

  it('Research 模式顯示 1/n 速率推導（F-02.17）；Beginner 模式隱藏程式碼段落', () => {
    const r1 = renderAt(<Chapter02 />, '/ch/02', 'research')
    for (const fm of FORMULAS) expect(document.getElementById(`formula-${fm.id}`), fm.id).toBeTruthy()
    expectNoTexErrors(r1.container)
    act(() => {
      for (const b of screen.getAllByText('看答案與解析')) fireEvent.click(b)
    })
    expect(bareMacros(r1.container)).toEqual([])
    expect(unicodeMath(r1.container)).toEqual([])
    expect(r1.container.textContent).not.toContain('程式碼載入錯誤')
    const codeResearch = r1.container.querySelectorAll('.c-code').length
    r1.unmount()
    const r2 = renderAt(<Chapter02 />, '/ch/02', 'beginner')
    expect(document.getElementById('formula-F-02.17')).toBeNull()
    expectNoTexErrors(r2.container)
    expect(unicodeMath(r2.container)).toEqual([])
    // Beginner：推導預設收合（<details> 沒有 open），但內容仍在 DOM 裡、一鍵可展開
    const folds = Array.from(r2.container.querySelectorAll('details.ch02-fold'))
    expect(folds.length).toBeGreaterThan(8)
    expect(folds.every((d) => !(d as HTMLDetailsElement).open)).toBe(true)
    expect(r2.container.querySelectorAll('.c-code').length).toBeLessThan(codeResearch)
    r2.unmount()
  }, T_PAGE)

  it('T01: GdExplorer 預設（½ 成本）顯示 w₁ = 1.8、w₂ = 2.28，analytic cross-check ok', async () => {
    plotlyMock.react.mockClear()
    const { container } = renderAt(<GdExplorer />)
    await waitFor(() => expect(plotlyMock.react).toHaveBeenCalled(), { timeout: T_WAIT })
    // 逐步數值表：第 n 列的 w_n（由同一個 gradientDescent() 計算）
    const rows = Array.from(container.querySelectorAll('[data-experiment="gd-tangent"] table.ch02-table tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    )
    expect(rows[0].slice(0, 2)).toEqual(['0', '1'])
    expect(rows[1].slice(0, 2)).toEqual(['1', '1.8'])
    expect(rows[2].slice(0, 2)).toEqual(['2', '2.28'])
    expect(container.querySelector('[data-experiment="gd-tangent"] .c-check-ok')).toBeTruthy()
    expect(container.querySelectorAll('[data-experiment="gd-tangent"] .c-bad[title^="超出容許誤差"]').length).toBe(0)
  }, T_EXP)

  it('LimitCycleBand 預設（a=3、x=1、μ=0.4、w₀=0）：週期 {2.8, 3.2}、analytic ok，沒有任何 metric 誤報（時間平均取偶數個樣本）', async () => {
    plotlyMock.react.mockClear()
    const { container } = renderAt(<LimitCycleBand />)
    await waitFor(() => expect(plotlyMock.react).toHaveBeenCalled(), { timeout: T_WAIT })
    const exp = container.querySelector('[data-experiment="sign-lms-band"]') as HTMLElement
    expect(exp.querySelector('.c-check-ok')).toBeTruthy()
    expect(exp.querySelector('.c-check-mismatch')).toBeNull()
    expect(exp.querySelectorAll('.c-bad[title^="超出容許誤差"]').length).toBe(0)
    expect(exp.textContent).toContain('3.2')
  }, T_EXP)

  it('URL preset：剛好踩到 a 的 band preset 顯示 sign(0) 說明，且 cross-check 為 n/a（不是 mismatch）', async () => {
    const { container } = renderAt(<Chapter02 />, '/ch/02?preset=sign-lms-band-exact-landing')
    const exp = container.querySelector('[data-experiment="sign-lms-band"]') as HTMLElement
    await waitFor(() => expect(exp.textContent).toContain('剛好踩到'), { timeout: T_WAIT })
    expect(exp.querySelector('.c-check-mismatch')).toBeNull()
    expect(bareMacros(exp)).toEqual([])
  }, T_PAGE)

  it('五個實驗逐一載入所有 preset：警告／指標／假設／圖標題的數學全部是可解析的 KaTeX，沒有 Unicode 拼的公式', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const gd = await cyclePresets(<GdExplorer />, 'gd-tangent')
    expect(gd.length).toBeGreaterThanOrEqual(4)
    expect(gd.find((p) => p.name.includes('J₂'))!.warnings).toBeGreaterThan(0) // μ = 0.3 + J₂：發散警告
    const batch = await cyclePresets(<BatchVsSgd />, 'gd-batch-vs-sgd')
    expect(batch.find((p) => p.name.includes('2.2'))!.warnings).toBeGreaterThan(0) // batch GD 發散
    const band = await cyclePresets(<LimitCycleBand />, 'sign-lms-band')
    expect(band.find((p) => p.name.includes('stall'))!.warnings).toBeGreaterThan(0)
    const fp = await cyclePresets(<FixedPointExplorer />, 'sign-lms-fixed-points')
    expect(fp.length).toBeGreaterThanOrEqual(4)
    const cmp = await cyclePresets(<SignLmsCompare />, 'sign-lms-compare')
    expect(cmp.length).toBeGreaterThanOrEqual(6)
    expect(consoleError.mock.calls.map((c) => String(c[0])).filter((m) => !/not wrapped in act/.test(m))).toEqual([])
    consoleError.mockRestore()
  }, T_PAGE)

  it('規格 §19 的操作：單步、執行至收斂、凍結（GdExplorer、LimitCycleBand、SignLmsCompare）', async () => {
    const stepsOf = (exp: HTMLElement, label: string) => {
      // 純文字標籤：<label> 的文字；含數學的標籤（lab()）：輸入框的 aria-label
      const byAria = Array.from(exp.querySelectorAll('input.c-param-input')).find((i) => i.getAttribute('aria-label') === label)
      const byText = Array.from(exp.querySelectorAll('.c-param')).find((p) => p.querySelector('.c-param-label')?.textContent?.trim() === label)
      return Number(((byAria ?? byText!.querySelector('input.c-param-input')) as HTMLInputElement).value)
    }
    const click = (exp: HTMLElement, text: string) =>
      act(() => {
        fireEvent.click(Array.from(exp.querySelectorAll('button')).find((b) => b.textContent?.includes(text))!)
      })
    // GdExplorer：預設 8 步、pole 0.6
    const g = renderAt(<GdExplorer />)
    const gd = g.container.querySelector('[data-experiment="gd-tangent"]') as HTMLElement
    expect(stepsOf(gd, '步數')).toBe(8)
    click(gd, '單步')
    expect(stepsOf(gd, '步數')).toBe(9)
    click(gd, '執行至收斂')
    expect(stepsOf(gd, '步數')).toBe(Math.ceil(Math.log(1e-6) / Math.log(0.6))) // 28：0.6²⁸ ≤ 10⁻⁶
    g.unmount()
    // LimitCycleBand：n_c = 7 ⇒ 7 + 12 步
    const b = renderAt(<LimitCycleBand />)
    const band = b.container.querySelector('[data-experiment="sign-lms-band"]') as HTMLElement
    click(band, '執行至收斂')
    expect(stepsOf(band, '步數 N')).toBe(19)
    expect(band.querySelector('.c-check-ok')).toBeTruthy()
    b.unmount()
    // SignLmsCompare：凍結後顯示說明；解除後消失；執行至收斂把步數設成各演算法估計的最大值
    const c = renderAt(<SignLmsCompare />)
    const cmp = c.container.querySelector('[data-experiment="sign-lms-compare"]') as HTMLElement
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250))
    })
    click(cmp, '凍結 Freeze')
    expect(cmp.textContent).toContain('圖表與表格停在按下「凍結」當時的參數')
    click(cmp, '已凍結')
    expect(cmp.textContent).not.toContain('圖表與表格停在按下「凍結」當時的參數')
    click(cmp, '執行至收斂')
    const base: CaseConfig = { a: DEFAULT_SHARED.a, w0: DEFAULT_SHARED.w0, steps: DEFAULT_SHARED.steps, ...DEFAULT_CASE }
    const inp = meanFieldInputOf(base)
    const mus = algoStepSizes(base, DEFAULT_SHARED.algos)
    const need = Math.max(
      ...DEFAULT_SHARED.algos.map((a) => {
        const mf = meanFieldAnalysis(a, inp)
        return stepsToSettle({ algo: a, mu: mus[a], mf, pred: predictSteadyState(mf, mus[a], inp) }, base)
      }),
    )
    expect(stepsOf(cmp, '步數 N')).toBe(Math.ceil(need))
    expect(need).toBeGreaterThan(500)
    expect(need).toBeLessThan(3000)
    c.unmount()
  }, T_EXP)

  it('URL preset（多 Case）會建立 Case B、C：sign(0) 慣例實驗', async () => {
    const { container } = renderAt(<Chapter02 />, '/ch/02?preset=sign-lms-tie-rules')
    await waitFor(() => expect(screen.getAllByText('Case C').length).toBeGreaterThan(0), { timeout: T_WAIT })
    const exp = container.querySelector('[data-experiment="sign-lms-compare"]') as HTMLElement
    expect(exp.textContent).toContain('Case B')
  }, T_PAGE)
})

describe('Ch02 presets', () => {
  it('每個 sign-lms*.json 都屬於本章實驗、id 與檔名一致、params 可被 sanitize', () => {
    expect(presets.length).toBeGreaterThanOrEqual(10)
    const exps = new Set(['sign-lms-compare', 'sign-lms-band', 'sign-lms-fixed-points'])
    for (const p of presets) {
      expect(exps.has(p.experiment), p.id).toBe(true)
      expect(p.page).toBe('/ch/02')
      expect(p.expected.length).toBeGreaterThan(10)
      expect(existsPreset(p.id)).toBe(true)
    }
  })

  it('limit-cycle preset：Sign-Error 在 2.8 ↔ 3.2 跳動；LMS pole 0.6', () => {
    const c = caseFromPreset('sign-lms-limit-cycle')
    const r = runShared({ ...c, algos: ['lms', 'sign_error'], seed: 1 })
    const w = r.w.sign_error!
    const tail = [w[c.steps - 1], w[c.steps]].sort((a, b) => a - b)
    expect(tail[0]).toBeCloseTo(2.8, 10)
    expect(tail[1]).toBeCloseTo(3.2, 10)
    expect(Math.abs(3 - r.w.lms![c.steps])).toBeLessThan(3 * 0.6 ** c.steps + 1e-12)
    expect(signErrorLimitCycle(3, 1, 0, 0.4, c.tie)).toMatchObject({ entryStep: 7 })
  })

  it('sign-lms-band presets 的 expected 數字（limit cycle、harmonic、stall、exact landing）', () => {
    const band = (id: string) => presets.find((x) => x.id === id)!.params as { a: number; x: number; w0: number; mu: number; steps: number; tie: 'zero' | 'plus' | 'minus'; schedule: 'constant' | 'harmonic' | 'gear'; n0: number }
    const run = (id: string) => {
      const b = band(id)
      return { b, w: runSignErrorFixedX(b.a, b.x, b.w0, b.steps, b.mu, { kind: b.schedule, n0: b.n0 }, b.tie) }
    }
    const d = run('sign-lms-band-default')
    expect([d.w[d.b.steps - 1], d.w[d.b.steps]].sort((p, q) => p - q).map((v) => Number(v.toFixed(10)))).toEqual([2.8, 3.2])
    const h = run('sign-lms-band-harmonic')
    expect(Math.abs(h.b.a - h.w[h.b.steps])).toBeLessThan(0.02)
    const st = band('sign-lms-band-stall')
    expect(travelDistance(st.mu, Math.abs(st.x), { kind: st.schedule, n0: st.n0 }, st.steps)).toBeCloseTo(0.535, 2)
    const e = run('sign-lms-band-exact-landing')
    expect(e.w[e.b.steps]).toBe(3)
    expect(e.w[e.b.steps - 1]).toBe(3)
  })

  it('tie-rules preset：μ = 0.125 時三種 sign(0) 慣例給出三種結果', () => {
    const finals = [0, 1, 2].map((k) => {
      const c = caseFromPreset('sign-lms-tie-rules', k)
      const w = runShared({ ...c, algos: ['sign_error'], seed: 1 }).w.sign_error!
      return [...new Set([w[c.steps - 1], w[c.steps]])].sort((a, b) => a - b)
    })
    expect(finals[0]).toEqual([3])
    expect(finals[1]).toEqual([3, 3.25])
    expect(finals[2]).toEqual([2.75, 3])
  })

  it('skewed / outliers preset 的 expected 數字由 mean-field 重現', () => {
    const fp = (id: string, k: number, algo: AlgoId) => meanFieldAnalysis(algo, meanFieldInputOf(caseFromPreset(id, k))).wStar
    expect(fp('sign-lms-skewed', 0, 'lms')).toBeCloseTo(3, 10)
    expect(fp('sign-lms-skewed', 0, 'sign_error')).toBeCloseTo(2.693, 3)
    expect(fp('sign-lms-skewed', 0, 'huber')).toBeCloseTo(2.734, 3)
    expect(fp('sign-lms-skewed', 1, 'sign_error')).toBeCloseTo(2.7195, 3)
    expect(fp('sign-lms-skewed', 1, 'sign_sign')).toBeCloseTo(2.697, 3)
    expect(fp('sign-lms-skewed', 2, 'sign_error')).toBeCloseTo(3, 8)
    expect(fp('sign-lms-outliers', 0, 'lms')).toBeCloseTo(4, 10)
    expect(fp('sign-lms-outliers', 0, 'sign_error')).toBeCloseTo(3.02, 3)
    expect(fp('sign-lms-outliers', 0, 'huber')).toBeCloseTo(3.029, 3)
    expect(fp('sign-lms-outliers', 1, 'lms')).toBeCloseTo(3, 10)
  })

  it('sign-lms-fp-* presets 的 expected 數字由 mean-field 重現（與 scipy 獨立驗算一致）', () => {
    const fp = (id: string, algo: AlgoId) => {
      const q = presets.find((x) => x.id === id)!.params as Record<string, unknown>
      const c: CaseConfig = { ...DEFAULT_CASE, ...sanitizeCase(q), a: q.a as number, w0: q.a as number, steps: q.steps as number }
      return meanFieldAnalysis(algo, meanFieldInputOf(c)).wStar
    }
    expect(fp('sign-lms-fp-skewed-uniform', 'lms')).toBeCloseTo(3, 10)
    expect(fp('sign-lms-fp-skewed-uniform', 'sign_error')).toBeCloseTo(2.7195, 4)
    expect(fp('sign-lms-fp-skewed-uniform', 'sign_sign')).toBeCloseTo(2.697, 3)
    expect(fp('sign-lms-fp-skewed-const', 'sign_error')).toBeCloseTo(3 + Math.LN2 - 1, 8)
    expect(fp('sign-lms-fp-skewed-const', 'sign_sign')).toBeCloseTo(3 + Math.LN2 - 1, 8)
    expect(fp('sign-lms-fp-skewed-const', 'huber')).toBeCloseTo(2.7345, 4)
    expect(fp('sign-lms-fp-outliers', 'lms')).toBeCloseTo(4, 10)
    expect(fp('sign-lms-fp-outliers', 'sign_error')).toBeCloseTo(3.0198, 4)
    expect(fp('sign-lms-fp-outliers', 'huber')).toBeCloseTo(3.0291, 4)
    for (const algo of ['lms', 'sign_error', 'sign_sign'] as AlgoId[]) expect(fp('sign-lms-fp-symmetric-x', algo)).toBeCloseTo(3, 8)
  })

  it('equal-speed preset：線性化 std 比 SE/LMS = √(π/2)、√(1/2)', () => {
    const ratio = (k: number) => {
      const c = caseFromPreset('sign-lms-equal-speed', k)
      const inp = meanFieldInputOf(c)
      const mus = algoStepSizes(c, ['lms', 'sign_error'])
      const se = predictSteadyState(meanFieldAnalysis('sign_error', inp), mus.sign_error, inp)
      const l = meanFieldAnalysis('lms', inp)
      const lin = Math.sqrt((mus.lms * l.gradVar) / (l.K * (2 - mus.lms * l.K)))
      return se.std / lin
    }
    expect(ratio(0)).toBeCloseTo(Math.sqrt(Math.PI / 2), 2)
    expect(ratio(1)).toBeCloseTo(Math.SQRT1_2, 2)
    expect(ratio(2)).toBeLessThan(0.6)
  })
})

describe('Ch02 analytic vs Monte Carlo：每個 preset 的固定點都一致（不會誤報 mismatch）', () => {
  const check = (c: CaseConfig, algos: AlgoId[], runs: number, seed = 20261010) => {
    const mc = monteCarloCompare({ ...c, algos, seed, runs })
    const inp = meanFieldInputOf(c)
    const mus = algoStepSizes(c, algos)
    return mc.stats.map((st) => {
      const mf = meanFieldAnalysis(st.algo, inp)
      const pred = predictSteadyState(mf, mus[st.algo], inp)
      return { algo: st.algo, ...fixedPointConsistency({ c, algo: st.algo, mu: mus[st.algo], mf, pred, st }), got: st.tavgMean }
    })
  }
  for (const p of presets.filter((x) => x.experiment === 'sign-lms-compare')) {
    it(`${p.id}：所有 Case × 演算法 ok`, () => {
      const params = p.params as Record<string, unknown>
      const shared = sanitizeShared(params)
      const nCases = 1 + ((params.compare as unknown[] | undefined)?.length ?? 0)
      for (let k = 0; k < nCases; k++) {
        const res = check(caseFromPreset(p.id, k), shared.algos, Math.min(shared.runs, 24))
        for (const r of res) expect(r.ok, `${p.id} case ${k} ${r.algo}: got ${r.got}, expect ${r.expect} ± ${r.tol}`).toBe(true)
      }
    })
  }
  for (const p of presets.filter((x) => x.experiment === 'sign-lms-fixed-points')) {
    it(`${p.id}：所有演算法 ok`, () => {
      const q = p.params as Record<string, unknown>
      const c: CaseConfig = {
        ...DEFAULT_CASE,
        ...sanitizeCase(q),
        a: q.a as number,
        w0: q.a as number,
        steps: q.steps as number,
        tie: 'plus',
        schedule: 'constant',
        n0: 1,
        stepMatch: 'same-mu',
      }
      const res = check(c, q.algos as AlgoId[], q.runs as number)
      for (const r of res) expect(r.ok, `${p.id} ${r.algo}: got ${r.got}, expect ${r.expect} ± ${r.tol}`).toBe(true)
    })
  }
})

describe('Ch02 analytic vs Monte Carlo：反面測試（公式錯時 UI 不可顯示成功）', () => {
  it('把 Sign-Error 的 w* 換成 LMS 的 w*（偏斜雜訊 + x ≡ 1）⇒ fixedPointConsistency 報 mismatch', () => {
    const c = caseFromPreset('sign-lms-skewed', 0)
    const algos: AlgoId[] = ['lms', 'sign_error']
    const mc = monteCarloCompare({ ...c, algos, seed: 20261010, runs: 16 })
    const inp = meanFieldInputOf(c)
    const mus = algoStepSizes(c, algos)
    const se = meanFieldAnalysis('sign_error', inp)
    const wrong = { ...se, wStar: meanFieldAnalysis('lms', inp).wStar } // 「用平均代替中位數」的錯誤公式
    const st = mc.stats.find((x) => x.algo === 'sign_error')!
    const right = fixedPointConsistency({ c, algo: 'sign_error', mu: mus.sign_error, mf: se, pred: predictSteadyState(se, mus.sign_error, inp), st })
    const bad = fixedPointConsistency({ c, algo: 'sign_error', mu: mus.sign_error, mf: wrong, pred: predictSteadyState(se, mus.sign_error, inp), st })
    expect(right.ok).toBe(true)
    expect(bad.ok).toBe(false)
    // 差距 ≈ σ(1 − ln 2) = 0.307，遠大於容差
    expect(Math.abs(bad.expect - st.tavgMean)).toBeGreaterThan(10 * bad.tol)
  })

  it('尚未收斂（μ 太小、步數太少，或遞減步長 stall）⇒ 不比較（ok = null 並說明原因），而不是誤報 mismatch', () => {
    const base: CaseConfig = { a: DEFAULT_SHARED.a, w0: DEFAULT_SHARED.w0, steps: 3000, ...DEFAULT_CASE }
    // 原因字串會經 mathText 顯示在 cross-check 列：數學（含很小的數字）一律是可解析的 $…$，不出現 "1.2e-7" 這種純文字指數
    const cleanReason = (s: string) => {
      expect((s.match(/\$/g) ?? []).length % 2, s).toBe(0)
      expect(s.replace(/\$[^$]*\$/g, ''), s).not.toMatch(/\de[+-]?\d|[μσδ≥±∞×]|NaN/)
      for (const m of s.matchAll(/\$([^$]*)\$/g)) {
        expect(renderTex(m[1], false), m[1]).not.toMatch(/katex-error|c-tex-error/)
        expect(BARE_MACRO.test(m[1].replace(/\\text\{[^}]*\}/g, '')), m[1]).toBe(false)
      }
    }
    const run = (c: CaseConfig, algos: AlgoId[]) => {
      const mc = monteCarloCompare({ ...c, algos, seed: 20261010, runs: 12 })
      const inp = meanFieldInputOf(c)
      const mus = algoStepSizes(c, algos)
      return mc.stats.map((st) => {
        const mf = meanFieldAnalysis(st.algo, inp)
        return fixedPointConsistency({ c, algo: st.algo, mu: mus[st.algo], mf, pred: predictSteadyState(mf, mus[st.algo], inp), st })
      })
    }
    for (const r of run({ ...base, mu: 1e-5 }, ['lms', 'sign_error'])) {
      expect(r.ok).toBeNull()
      expect(r.reason).toMatch(/漂移|暫態/)
      cleanReason(r.reason!)
    }
    for (const r of run({ ...base, schedule: 'harmonic', mu: 0.001, n0: 5 }, ['sign_error'])) {
      expect(r.ok).toBeNull()
      expect(r.reason).toMatch(/漂移/)
      expect(r.reason).toMatch(/第 3、4 段平均相差 \$-?[\d.]+(\\times10\^\{-?\d+\})?\$/) // 數字寫成 TeX
      cleanReason(r.reason!)
    }
    // 同樣的設定給足步數與 μ：可以比較，而且一致
    for (const r of run(base, ['lms', 'sign_error'])) expect(r.ok).toBe(true)
    // 重尾（NLMS、ε = 0、Gaussian x：更新量變異無限大）⇒ 不做 4·SE 比較
    const heavy: CaseConfig = { ...base, nlmsEps: 0 }
    for (const r of run(heavy, ['nlms'])) {
      expect(r.ok).toBeNull()
      expect(r.reason).toMatch(/變異數無限大/)
      cleanReason(r.reason!)
    }
    // sign 類 μK ≥ 2（步長遠大於雜訊）：有界但線性化失效 ⇒ 不比較並說明，不可報 mismatch 或 ok
    const big: CaseConfig = { ...base, mu: 1.9, sigma: 0.2, xKind: 'const' }
    const rb = run(big, ['sign_error'])[0]
    expect(rb.ok).toBeNull()
    expect(rb.reason).toMatch(/線性化/)
    cleanReason(rb.reason!)
    // summarize：全部未比較 ⇒ n/a（不是 ok）
    expect(summarizeConsistency([{ ok: null, reason: '尚未收斂', label: 'A·LMS' }]).status).toBe('n/a')
    expect(summarizeConsistency([{ ok: true, label: 'A·LMS' }, { ok: false, label: 'A·SE' }]).status).toBe('mismatch')
  })
})

describe('Ch02 主實驗的失敗解釋（反面測試）', () => {
  const base: CaseConfig = { a: DEFAULT_SHARED.a, w0: DEFAULT_SHARED.w0, steps: DEFAULT_SHARED.steps, ...DEFAULT_CASE }
  const analyse = (c: CaseConfig, algos: AlgoId[]) => {
    const inp = meanFieldInputOf(c)
    const mus = algoStepSizes(c, algos)
    return algos.map((a) => {
      const mf = meanFieldAnalysis(a, inp)
      return { algo: a, mu: mus[a], mf, pred: predictSteadyState(mf, mus[a], inp) }
    })
  }

  it('x ≡ 0 ⇒「不可辨識」', () => {
    const c = { ...base, xKind: 'const' as const, xAmp: 0 }
    const w = caseWarnings('', c, analyse(c, ['lms', 'sign_error']))
    expect(w.join()).toContain('不可辨識')
  })

  it('LMS 固定 x 且 μx² ≥ 2 ⇒ 發散警告（含正確上限 2/x²），並由模擬確認', () => {
    const c = { ...base, xKind: 'const' as const, xAmp: 2, mu: 0.6, noiseKind: 'none' as const, sigma: 0, steps: 100 }
    const an = analyse(c, ['lms', 'sign_error'])
    const run = runShared({ ...c, algos: ['lms', 'sign_error'], seed: 1 })
    const w = caseWarnings('', c, an, run).join('\n')
    expect(w).toContain(String.raw`2/x^2=0.5$`)
    expect(w).toContain(String.raw`LMS 在 $n\approx`)
    expect(run.diverged.sign_error).toBe(false)
  })

  it('隨機 x 的 LMS：μ ≥ 2E[x²]/E[x⁴] ⇒ 均方發散警告（E14）', () => {
    const c = { ...base, mu: 0.8 }
    expect(caseWarnings('', c, analyse(c, ['lms'])).join()).toContain('均方（MSD）發散')
  })

  it('harmonic 排程衰減太快 ⇒ stall 警告', () => {
    const c = { ...base, schedule: 'harmonic' as const, mu: 0.001, n0: 5, steps: 2000 }
    expect(caseWarnings('', c, analyse(c, ['sign_error'])).join()).toContain('stall')
  })

  it('NLMS μ̃ ≥ 2 ⇒ 發散警告；ε = 0 且 Gaussian x ⇒ 雜訊放大警告', () => {
    const c1 = { ...base, xKind: 'const' as const, mu: 2.5, nlmsEps: 0 }
    expect(caseWarnings('', c1, analyse(c1, ['nlms'])).join()).toContain('NLMS')
    const c2 = { ...base, nlmsEps: 0 }
    const w2 = caseWarnings('', c2, analyse(c2, ['nlms'])).join()
    expect(w2).toContain(String.raw`雜訊被 $1/x$ 放大`)
    expect(w2).toContain(String.raw`E[v^2/x^2]=\infty`)
  })

  it('Huber 固定 x 且 μx² ≥ 2：警告說明「線性區不收斂但有界」，模擬也確實不發散（不可寫成發散）', () => {
    const c = { ...base, xKind: 'const' as const, xAmp: 2, mu: 0.6, noiseKind: 'none' as const, sigma: 0, steps: 400, w0: 2.9 }
    const an = analyse(c, ['huber', 'lms'])
    const run = runShared({ ...c, algos: ['huber', 'lms'], seed: 1 })
    const w = caseWarnings('', c, an, run)
    const hub = w.find((s) => s.includes('Huber'))!
    expect(hub).toContain('不會發散到無限大')
    expect(hub).toContain('不收斂')
    expect(run.diverged.huber).toBe(false)
    expect(run.diverged.lms).toBe(true)
    // 有界：每步最多 μ·δ_H·|x| = 0.6·0.5·2 = 0.6，誤差被困在 a 附近
    const tail = Array.from(run.w.huber!.slice(350))
    expect(Math.max(...tail.map((v) => Math.abs(v - 3)))).toBeLessThan(2)
    expect(Math.max(...tail) - Math.min(...tail)).toBeGreaterThan(0.1) // 沒有收斂，持續跳動
  })

  it('警告字串裡的數學一律寫成 $…$（teaching-style §3），不殘留 Unicode 拼的公式', () => {
    const cs: [CaseConfig, AlgoId[]][] = [
      [{ ...base, xKind: 'const', xAmp: 0 }, ['lms']],
      [{ ...base, xKind: 'const', xAmp: 2, mu: 0.6, noiseKind: 'none', sigma: 0, steps: 100 }, ['lms', 'huber', 'nlms']],
      [{ ...base, mu: 0.8 }, ['lms']],
      [{ ...base, mu: 2 }, ['lms', 'nlms']],
      [{ ...base, schedule: 'harmonic', mu: 0.001, n0: 5, steps: 2000 }, ['sign_error', 'sign_sign']],
      [{ ...base, nlmsEps: 0 }, ['nlms']],
      [{ ...base, nlmsEps: 0, xKind: 'uniformPos' }, ['nlms']],
    ]
    const all = cs.flatMap(([c, algos]) => caseWarnings('', c, analyse(c, algos), runShared({ ...c, algos, seed: 1 })))
    expect(all.length).toBeGreaterThanOrEqual(8)
    for (const s of all) {
      const outside = s.replace(/\$[^$]*\$/g, '')
      expect(outside, s).not.toMatch(/[μσδψεηλτ²³⁴₀₁₂ₙ≤≥≈∞]|E\[/)
      expect((s.match(/\$/g) ?? []).length % 2, s).toBe(0)
      for (const m of s.matchAll(/\$([^$]*)\$/g)) {
        expect(renderTex(m[1], false), m[1]).not.toMatch(/katex-error|c-tex-error/)
        expect(BARE_MACRO.test(m[1].replace(/\\text\{[^}]*\}/g, '')), m[1]).toBe(false)
      }
    }
  })

  it('「執行至收斂」的步數估計：sign 類先算等速段 |a − w₀|/(μE|x|)，再加 8τ，整體乘 2（統計取後半段）', () => {
    const c = { ...base, mu: 0.002 }
    const [l, se, ss] = analyse(c, ['lms', 'sign_error', 'sign_sign'])
    // LMS：τ = −1/ln(1 − 0.002) ≈ 499.5 ⇒ 16τ ≈ 7992
    expect(stepsToSettle(l, c)).toBeCloseTo(16 * (-1 / Math.log(1 - 0.002)), 6)
    // Sign-Error（Gaussian x）：等速段 3/(0.002·√(2/π)) ≈ 1880 步
    const slew = 3 / (0.002 * Math.sqrt(2 / Math.PI))
    expect(stepsToSettle(se, c)).toBeCloseTo(2 * (slew + 8 * se.pred.tau), 3)
    expect(stepsToSettle(ss, c)).toBeCloseTo(2 * (3 / 0.002 + 8 * ss.pred.tau), 6)
    // 遞減步長：不給建議
    expect(stepsToSettle(se, { ...c, schedule: 'harmonic' })).toBe(0)
    // 用建議的步數重跑，MC 與 mean-field 可以比較且一致（原本 3000 步時是「未收斂」）
    const before = monteCarloCompare({ ...c, algos: ['sign_error'], seed: 20261010, runs: 12 })
    const inp = meanFieldInputOf(c)
    expect(fixedPointConsistency({ c, algo: 'sign_error', mu: se.mu, mf: se.mf, pred: se.pred, st: before.stats[0] }).ok).toBeNull()
    const c2 = { ...c, steps: Math.ceil(stepsToSettle(se, c)) }
    const after = monteCarloCompare({ ...c2, algos: ['sign_error'], seed: 20261010, runs: 12 })
    const mf = meanFieldAnalysis('sign_error', inp)
    expect(fixedPointConsistency({ c: c2, algo: 'sign_error', mu: se.mu, mf, pred: predictSteadyState(mf, se.mu, inp), st: after.stats[0] }).ok).toBe(true)
  })
})

describe('Ch02 共用小工具', () => {
  it('tn：數字 → TeX（科學記號、∞、NaN）', () => {
    expect(tn(0.5)).toBe('0.5')
    expect(tn(1.2e-7)).toBe(String.raw`1.2\times10^{-7}`)
    expect(tn(Infinity)).toBe(String.raw`\infty`)
    expect(tn(-Infinity)).toBe(String.raw`-\infty`)
    expect(tn(NaN)).toBe(String.raw`\text{—}`)
  })

  it('texSig：有效數字 → TeX；很小／很大的數寫成 a×10ᵇ 的 TeX，不留 "1.2e-7" 這種純文字指數', () => {
    expect(texSig(0.012345, 3)).toBe('0.0123')
    expect(texSig(-0.5, 2)).toBe('-0.5')
    expect(texSig(1.234e-7, 3)).toBe(String.raw`1.23\times10^{-7}`)
    expect(texSig(-4.56e-9, 2)).toBe(String.raw`-4.6\times10^{-9}`)
    expect(texSig(2.5e21, 2)).toBe(String.raw`2.5\times10^{21}`)
    expect(texSig(NaN, 2)).toBe(String.raw`\text{—}`)
    expect(texSig(Infinity, 2)).toBe(String.raw`\infty`)
    expect(texSig(-Infinity, 2)).toBe(String.raw`-\infty`)
    for (const v of [0.012345, 1.234e-7, -4.56e-9, 2.5e21, NaN, Infinity]) expect(renderTex(texSig(v, 3), false)).not.toMatch(/katex-error|c-tex-error/)
  })
})

describe('Ch02 公式登錄', () => {
  it('ID 唯一、格式 F-02.x、頁面 /ch/02、勘誤標註', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-02\.\d+$/)
      expect(f.page).toBe('/ch/02')
    }
    const errata = new Set(FORMULAS.map((f) => f.erratumId).filter(Boolean))
    for (const e of ['E40', 'E41', 'E43']) expect(errata.has(e)).toBe(true)
    // 登錄的 TeX 都能被 KaTeX 解析（Formula & Unit Reference 頁會直接渲染這些字串），且沒有漏反斜線的巨集
    for (const f of FORMULAS) {
      expect(renderTex(f.tex, true), f.id).not.toMatch(/katex-error|c-tex-error/)
      expect(BARE_MACRO.test(f.tex.replace(/\\text\{[^}]*\}/g, '')), f.id).toBe(false)
    }
    // F-02.10 用 n_c、ρ（不與 block 索引 k、比值 r 衝突）
    const lc = FORMULAS.find((f) => f.id === 'F-02.10')!
    expect(lc.tex).toContain('n_c')
    expect(lc.tex).toContain(String.raw`\rho`)
  })

  it('title／conditions（Formula Reference 頁經 mathText 顯示）裡的數學都是可解析的 $…$，不殘留 Unicode 拼的公式', () => {
    let withMath = 0
    for (const f of FORMULAS)
      for (const [field, text] of [['title', f.title], ['conditions', f.conditions]] as const) {
        const where = `${f.id}.${field}`
        expect((text.match(/\$/g) ?? []).length % 2, where).toBe(0)
        expect(text.replace(/\$[^$]*\$/g, ''), where).not.toMatch(/[μσδψεηλτρ²³⁴₀₁₂ₙ″≤≥≈∝⇔∞√]|E\[|[a-zA-Z]_[a-zA-Z0-9]/)
        for (const m of text.matchAll(/\$([^$]*)\$/g)) {
          withMath++
          expect(renderTex(m[1], false), `${where}: ${m[1]}`).not.toMatch(/katex-error|c-tex-error/)
          expect(BARE_MACRO.test(m[1].replace(/\\text\{[^}]*\}/g, '')), `${where}: ${m[1]}`).toBe(false)
        }
      }
    expect(withMath).toBeGreaterThan(40)
    // mathText 實際渲染：$ 不會原樣漏到畫面上
    const { container } = render(
      <ul>
        {FORMULAS.map((f) => (
          <li key={f.id}>
            {mathText(f.title)}｜{mathText(f.conditions)}
          </li>
        ))}
      </ul>,
    )
    expect(container.textContent).not.toContain('$')
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(40)
    expectNoTexErrors(container)
    expect(unicodeMath(container)).toEqual([])
  })
})

describe('Ch02 主實驗表格的文字標籤（穩態 std 欄）', () => {
  it('limit cycle／不穩定的說明用 $…$ 寫數學，數字來自參數', () => {
    const base: CaseConfig = { a: DEFAULT_SHARED.a, w0: DEFAULT_SHARED.w0, steps: DEFAULT_SHARED.steps, ...DEFAULT_CASE }
    const labels = [
      limitCycleLabel('sign_sign', 0.02, base),
      limitCycleLabel('sign_error', 0.4, { ...base, xKind: 'const', xAmp: 2 }),
      limitCycleLabel('sign_error', 0.4, base), // Gaussian x：每步大小不固定
      unstableLabel('lms'),
      unstableLabel('sign_error'),
    ]
    expect(labels[0]).toContain(String.raw`$\pm0.02$`)
    expect(labels[1]).toContain(String.raw`$\pm0.8$`)
    expect(labels[2]).toContain('$|x|$')
    expect(labels[3]).toContain(String.raw`$\infty$`)
    expect(labels[4]).toContain(String.raw`$\mu K\ge2$`)
    for (const s of labels) {
      expect(s.replace(/\$[^$]*\$/g, ''), s).not.toMatch(/[μσδ≥±∞]|\|x\|/)
      for (const m of s.matchAll(/\$([^$]*)\$/g)) expect(renderTex(m[1], false), m[1]).not.toMatch(/katex-error|c-tex-error/)
    }
  })
})

function existsPreset(id: string): boolean {
  try {
    readFileSync(resolve(PRESET_DIR, `${id}.json`))
    return true
  } catch {
    return false
  }
}

describe('Ch02 Batch-vs-SGD 的多 seed Monte Carlo 欄（有 seed 與隨機 mini-batch，不再標 Not implemented）', () => {
  const DEF = { a: 3, w0: 0, xSigma: 1, sigma: 1, nData: 200, mu: 0.05, epochs: 10, batch: 10 }

  it('預設參數：12 個 seeds 的 SGD 最後 w − w_LS 跨 seeds 平均在 4 se 內 ⇒ ok；數值來自 batchVsSgd 逐 seed 重算（deriveSeed）', () => {
    const mc = batchVsSgdMcCheck(DEF, 20261010)
    expect(BATCH_MC_RUNS).toBeGreaterThanOrEqual(8)
    expect(mc.runs).toBe(BATCH_MC_RUNS)
    expect(mc.diffs).toHaveLength(BATCH_MC_RUNS)
    expect(mc.status).toBe('ok')
    expect(Math.abs(mc.mean)).toBeLessThanOrEqual(mc.tol)
    expect(mc.lo).toBeLessThan(mc.hi)
    expect(mc.note).toContain('12 個 seeds')
    // 逐 seed 核對：d_r 就是該 seed 的 SGD 終值減 w_LS
    for (let r = 0; r < 3; r++) {
      const res = batchVsSgd({ ...DEF, seed: deriveSeed(20261010, r) })
      const sgd = res.traces.find((t) => t.method === 'sgd')!
      expect(mc.diffs[r]).toBeCloseTo(sgd.w[sgd.w.length - 1] - res.wLs, 12)
    }
    // σ = 0：每個 seed 的 d_r 都是捨入誤差 ⇒ 仍 ok（容差有相對 10⁻⁹ 的下限）
    expect(batchVsSgdMcCheck({ ...DEF, sigma: 0 }, 1).status).toBe('ok')
  })

  it('反面：transient 還沒消失（μ 很小、更新次數 < 8τ）⇒ n/a 並說明；SGD 發散（μ 太大）⇒ n/a；判定不是寫死的——把每個 seed 的差都加上 1 就變 mismatch', () => {
    const slow = batchVsSgdMcCheck({ ...DEF, mu: 1e-4, epochs: 2 }, 1)
    expect(slow.status).toBe('n/a')
    expect(slow.note).toContain('transient')
    // μ ≥ 2/(3σ_x²)：均方不穩定（Ch03）⇒ 沒有信賴區間可言 ⇒ n/a（preset「μ = 2.2」與 μ = 3 都是）
    for (const mu of [2.2, 3]) {
      const div = batchVsSgdMcCheck({ ...DEF, mu, epochs: 3 }, 1)
      expect(div.status, `mu=${mu}`).toBe('n/a')
      expect(div.note).toContain('均方')
    }
    expect(batchVsSgdMcCheck({ ...DEF, mu: 0.5, epochs: 4 }, 20261010).status).toBe('ok') // preset「μ = 0.5」：0.5 < 2/3，仍可比
    const mc = batchVsSgdMcCheck(DEF, 20261010)
    const shifted = meanCI(mc.diffs.map((d) => d + 1))
    expect(Math.abs(shifted.mean)).toBeGreaterThan(4 * shifted.se) // 同一組散布、平均偏 1 ⇒ 超出 4 se
  })

  it('UI：交叉比對三欄 [Analytic ok, Monte Carlo ok, Fixed-Point n/a]，每一格都有說明文字；指標表多一列「多 seed」', async () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    const { container } = renderPage(<BatchVsSgd />)
    await waitFor(() => expect(container.querySelectorAll('.c-exp-crosscheck .c-check').length).toBe(3))
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.c-exp-crosscheck .c-check'))
    expect(cells.map((c) => c.className.replace('c-check c-check-', ''))).toEqual(['ok', 'ok', 'n/a'])
    for (const c of cells) expect((c.getAttribute('title') ?? '').length).toBeGreaterThan(10)
    expect(cells[1].getAttribute('title')).toContain('12 個 seeds')
    expect(cells[2].getAttribute('title')).toContain('L0')
    expect(container.textContent).toContain('多 seed')
    expectNoTexErrors(container)
  }, T_PAGE)
})
