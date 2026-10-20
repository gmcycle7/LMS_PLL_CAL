import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { wrapPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'
import Chapter11 from './index'
import { CH11_DIAGRAMS } from './diagrams'
import { BiasInlLab } from './experiments/BiasInlLab'
import { DcNullExperiment } from './experiments/DcNullExperiment'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

import { plotlyMock as P } from '@/test/mocks/plotly'
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

const wrap = (node: React.ReactNode, url = '/ch/11') => wrapPage(node, { url })

// 第一次造訪的預設是 Beginner；這個檔案的斷言是照 Engineer 模式寫的（個別測試會另外設定自己的模式）
beforeEach(() => localStorage.setItem('lmspll.mode', 'engineer'))
afterEach(() => {
  localStorage.clear()
})

/** 用 Unicode 拼數學時會出現的字元（希臘字母、上下標、關係與運算符號）；控制項的 label／hint／unit 與指標的名稱／單位一律寫 `$…$` */
const UNICODE_MATH = /[σμκεφρλθωΩΣΔπ√²³⁴⁻¹₀₁₂₃ₖ≤≥≈≠≡∂∈∞δηβ·×÷∓ŷ]/

/** 元素裡 KaTeX 以外的文字 */
function outsideKatex(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}

/**
 * 控制項（ParamControl／SelectControl／ToggleControl 的 label、單位、說明、暫存器名稱）與指標表（名稱、備註、單位）：
 * 數學都由 KaTeX 排版，KaTeX 以外沒有 Unicode 拼的數學（<option> 與匯出欄名是純文字，不在此列）。
 */
function expectLatexControls(root: Element): number {
  const where = ['.c-param-label', '.c-param-unit', '.c-param-meta', '.c-param-reg', '.c-metric-table tbody td:nth-child(1)', '.c-metric-table tbody td:nth-child(3)']
  const bad: string[] = []
  let katex = 0
  for (const sel of where) {
    for (const el of Array.from(root.querySelectorAll(sel))) {
      katex += el.querySelectorAll('.katex').length
      if (UNICODE_MATH.test(outsideKatex(el))) bad.push(`${sel}：${outsideKatex(el)}`)
    }
  }
  expect(bad).toEqual([])
  return katex
}

type PlotlyCall = [unknown, unknown, unknown, unknown]
/** 傳給 Plotly.react 的所有「會顯示的字串」（name／text／title／ticktext…）；Plot 元件已把其中的 `$…$` 轉成斜體符號與上下標。 */
function plotlyStrings(): string[] {
  const keys = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext'])
  const out: string[] = []
  const walk = (v: unknown, key: string | null, depth: number) => {
    if (typeof v === 'string') {
      if (key !== null && keys.has(key)) out.push(v)
      return
    }
    if (depth > 6 || v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return
    if (Array.isArray(v)) {
      if (typeof v[0] === 'number') return
      v.forEach((x) => walk(x, key, depth + 1))
      return
    }
    for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1)
  }
  for (const [, data, layout] of P.react.mock.calls as unknown as PlotlyCall[]) {
    walk(data, null, 0)
    walk(layout, null, 0)
  }
  return out
}

/** 圖表字串都經過 plotMath：沒有殘留的 TeX（反斜線、大括號、`$`）、沒有 `_`／`^`、沒有 Unicode 拼的上下標，希臘字母都是斜體變數（<i>…</i>）。 */
function expectTypesetPlotStrings(): string[] {
  const strings = plotlyStrings()
  const bare = (t: string) => t.replace(/<i>[^<]*<\/i>/g, '')
  expect(strings.filter((t) => /[\\{}$]/.test(t))).toEqual([])
  expect(strings.filter((t) => /[_^]/.test(t))).toEqual([])
  expect(strings.filter((t) => /[²³⁴⁻¹₀₁₂₃ₖ]/.test(t))).toEqual([])
  expect(strings.filter((t) => /[α-ω]/.test(bare(t)))).toEqual([])
  return strings
}

/**
 * 整章 render（8 題手算、3 個實驗、十幾段程式碼）在多個測試行程同時執行的機器上可能超過一分鐘：
 * 時間上限只防止卡死，不是效能規格。
 */
const SMOKE_TIMEOUT = 600000
const LAB_TIMEOUT = 300000
const WAIT = 120000

describe('Ch11 smoke tests（jsdom）', () => {
  it('整章可以 render，不會丟出錯誤，且包含主要段落與實驗', async () => {
    const errSpy = vi.spyOn(console, 'error')
    const { container } = render(wrap(<Chapter11 />))
    expect(screen.getByText('這一課要回答的問題')).toBeTruthy()
    expect(container.querySelector('#ch11-inl')).toBeTruthy()
    expect(container.querySelector('#ch11-lab')).toBeTruthy()
    expect(document.getElementById('formula-F-11.4')).toBeTruthy()
    expect(document.getElementById('formula-F-11.8')).toBeTruthy()
    // 公式登錄的每個 ID 在頁面上都有唯一錨點（MetricTable 的 formulaId 會連過去）
    for (const f of FORMULAS) expect(document.querySelectorAll(`[id="formula-${f.id}"]`).length, f.id).toBe(1)
    // 三個 ExperimentShell
    expect(screen.getAllByText(/Bias & INL Lab/).length).toBeGreaterThan(0)
    expect(screen.getByText(/主迴路 DC null 對 offset bias 的影響/)).toBeTruthy()
    // 標題裡的 C(FCW) → 0 以 KaTeX 顯示（字串屬性的 $…$），所以只比對前後的文字
    expect(screen.getByText(/Near-integer：\s*時 bias 被放大/)).toBeTruthy()
    // 程式碼區塊由真實原始碼擷取（region 存在才不會顯示錯誤）
    expect(container.querySelectorAll('.c-code').length).toBeGreaterThan(12)
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    expect(screen.queryByText(/程式碼載入錯誤/)).toBeNull()
    // 三種 DC null 架構的程式碼對照（dcOffset / linearizedFixedPoint）與差異行標示
    expect(container.textContent).toContain('(B) 共用 BBPD')
    expect(container.textContent).toContain('← 差異：(C) 分母 Var(x)')
    // 先備知識框：期望值、Var/Cov、Gaussian/erf、條件期望、加權中位數、特徵值、Ch06 頻率響應
    const pageText = container.textContent ?? ''
    for (const t of ['「很多次的平均」', '變異數、共變異數', 'comparator 的機率', '條件期望', '加權平均與加權中位數', '特徵值（eigenvalue）', '回顧 Ch06']) expect(pageText, t).toContain(t)
    // behavioral 測試清單的預期值由模型即時計算（T12b 的 1.3403458、dead zone 區間、E03 三種模式）
    expect(pageText).toContain('本章的 behavioral 測試清單')
    for (const t of ['1.340346', '(1.3333, 1.5)', '1.2141 ／ 1 ／ 1.5897']) expect(pageText, t).toContain(t)
    // 審查 C05：erf 的泰勒級數對任何有限引數都收斂；小 σ_v 時失準的是只取到三次項的低階截斷
    expect(pageText).not.toMatch(/泰勒(展開|級數)[^。]{0,8}不收斂/)
    expect(pageText).toContain('低階截斷')
    expect(pageText).toContain('erf 的泰勒級數對任何有限的引數都收斂')
    // 審查 C04：兩張殘差表的 x = 0 那一列是 0，緊接在表後面的文字不可說「沒有一個是 0」
    const colOf = (root: Element, head: string, col: number) =>
      Array.from(Array.from(root.querySelectorAll('table')).find((t) => (t.querySelector('thead')?.textContent ?? '').includes(head))!.querySelectorAll('tbody tr')).map((tr) => tr.children[col].textContent)
    const inl = container.querySelector('#ch11-inl')!
    expect(colOf(inl, 'e_0=e(x;1.34)', 2)).toEqual(['-0.12', '+0.24', '0', '-0.24', '+0.12'])
    expect(inl.textContent).not.toContain('欄沒有一個是 0')
    expect(inl.textContent).toContain('欄並非全部為 0')
    expect(inl.textContent).toContain('其餘四個 code 的殘差都不是 0')
    const hand = container.querySelector('#ch11-hand')!
    expect(colOf(hand, 'w=1.34', 4)).toEqual(['-0.12', '+0.24', '0', '-0.24', '+0.12'])
    expect(hand.textContent).not.toContain('沒有任何一個殘差是 0')
    expect(hand.textContent).toContain('最後一欄並非全部為 0')
    // 審查 R05：§11.A 的定義加上「階梯函數時固定點改指變號的位置」；§11.2 情境 (3) 說明 1.4 不是 E[G] = 0 的根
    expect(container.querySelector('#ch11-fixed-point')?.textContent).toContain('改指')
    expect(inl.textContent).toContain('平均 GMAC 變號')
    expect(inl.textContent).toContain('時間平均')
    expect(document.getElementById('formula-F-11.10')?.textContent).toContain('由正跳到負')
    // 帶入手算：8 題依序出現在頁面上（各自放在對應的推導後面），綜合題在思考題之前
    expect(Array.from(container.querySelectorAll('.c-handcalc')).map((el) => el.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    const sectionOf = (id: string) => document.getElementById(`handcalc-${id}`)?.closest('section.c-section')?.id
    expect(['HC-11.1', 'HC-11.2', 'HC-11.3', 'HC-11.4', 'HC-11.5', 'HC-11.6', 'HC-11.7', 'HC-11.8'].map(sectionOf)).toEqual([
      'ch11-hand',
      'ch11-fixed-point',
      'ch11-offset',
      'ch11-inl',
      'ch11-inl',
      'ch11-inl',
      'ch11-near-integer',
      'ch11-synthesis',
    ])
    const synthesis = container.querySelector('#ch11-synthesis') as HTMLElement
    const quiz = container.querySelector('#ch11-quiz') as HTMLElement
    expect(synthesis.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(synthesis.nextElementSibling).toBe(quiz)
    expect(container.querySelectorAll('.c-chapter-hand-lead').length).toBe(HANDCALCS.length)
    // 思考題 3 題、本課必記
    expect(container.querySelectorAll('.c-quiz').length).toBe(3)
    expect(container.querySelectorAll('.c-recap').length).toBe(1)
    // ── 方塊圖（teaching-style §8）：章首系統地圖 + 25 張圖，依登錄表的順序出現在各自的段落裡 ──
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(CH11_DIAGRAMS.length + 1)
    expect(CH11_DIAGRAMS).toHaveLength(25)
    const systemMap = figures[0]
    expect(systemMap.getAttribute('aria-label')).toContain('系統方塊圖')
    expect(systemMap.closest('.c-chapter-fig')).toBeNull()
    const question = screen.getByText('這一課要回答的問題').closest('.c-callout') as HTMLElement
    expect(question.nextElementSibling).toBe(systemMap) // 開場問題之後緊接系統地圖
    expect(question.textContent).toContain('完整的符號表在本章最後') // 開場就先用一句話說明 x、e、q、w
    const figs = Array.from(container.querySelectorAll('.c-chapter-fig'))
    expect(figs.map((el) => el.id)).toEqual(CH11_DIAGRAMS.map((d) => `ch11-fig-${d.id}`))
    expect(figs.map((el) => el.closest('section.c-section')?.id)).toEqual(CH11_DIAGRAMS.map((d) => d.section))
    figs.forEach((el, i) => {
      expect(el.querySelector('figcaption')?.textContent, el.id).toContain(`圖 11-${i + 1}｜`)
      expect(el.querySelector('figure.c-mermaid')?.getAttribute('aria-label'), el.id).toMatch(new RegExp(`^圖 11-${i + 1}：`))
    })
    // 正文引用的圖號（FigRef）都在圖的前面：先讀導讀再看圖
    for (const el of figs) {
      const label = el.querySelector('figcaption')?.textContent?.split('｜')[0] ?? ''
      const refs = Array.from(container.querySelectorAll('.c-figref')).filter((r) => r.textContent === label)
      expect(refs.length, label).toBeGreaterThanOrEqual(1)
      expect(refs[0].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy()
    }
    // 每個主要段落至少一張圖
    for (const id of ['ch11-hand', 'ch11-diagram', 'ch11-model', 'ch11-fixed-point', 'ch11-offset', 'ch11-inl', 'ch11-correlated', 'ch11-near-integer', 'ch11-lab', 'ch11-levels', 'ch11-synthesis'])
      expect(container.querySelectorAll(`#${id} .c-chapter-fig`).length, id).toBeGreaterThanOrEqual(1)
    // 圖放在推導之前：誤差模型的圖在 F-11.1 之前、三種架構的圖在 F-11.6 之前、near-integer 的路徑圖在 F-11.14 之前
    const before = (a: Element | null, b: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(document.getElementById('ch11-fig-error-budget'), document.getElementById('formula-F-11.1'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-bias-correlators'), document.getElementById('formula-F-11.4'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-offset-path'), document.getElementById('formula-F-11.5'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-dc-null'), document.getElementById('formula-F-11.6'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-servo-dither'), document.getElementById('formula-F-11.17'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-best-fit'), document.getElementById('formula-F-11.8'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-mean-vs-median'), document.getElementById('formula-F-11.10'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-identifiability'), document.getElementById('formula-F-11.13'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-near-integer-path'), document.getElementById('formula-F-11.14'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-mc-gaps'), document.getElementById('formula-F-11.16'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-comparator-model'), document.getElementById('formula-F-11.2'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-jitter-weight'), document.getElementById('formula-F-11.12'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-near-integer-why'), document.getElementById('ch11-fig-near-integer-check'))).toBe(true)
    // 審查 R01：適用條件的說明框緊接在 F-11.14／F-11.15 後面、敏感度鏈的圖之前（圖的導讀寫「見上面的說明框」、圖說寫「F-11.14 後面的說明框」）
    const niBox = Array.from(document.querySelectorAll('#ch11-near-integer .callout-warn')).find((el) => (el.textContent ?? '').includes('什麼時候才是 Sign-LMS 的固定點')) ?? null
    expect(before(document.getElementById('formula-F-11.15'), niBox)).toBe(true)
    expect(before(niBox, document.getElementById('ch11-fig-near-integer-why'))).toBe(true)
    expect(document.getElementById('ch11-fig-near-integer-why')?.textContent).toContain('F-11.14 後面的說明框')
    expect(document.getElementById('ch11-near-integer')?.textContent).toContain('見上面的說明框')
    expect(before(document.getElementById('ch11-fig-slope-measure'), document.getElementById('ch11-fig-mc-gaps'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-finite-step-loop'), document.getElementById('formula-F-11.16'))).toBe(true)
    // ── 符號表（teaching-style §5）：只有一份，在頁面最後（#symbols，本課必記之後）；章首只留一行跳轉 ──
    const root = container.querySelector('.ch11') as HTMLElement
    const symbols = document.getElementById('symbols') as HTMLElement
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    expect(root.lastElementChild).toBe(symbols)
    expect(before(container.querySelector('.c-recap'), symbols)).toBe(true)
    expect(before(quiz, symbols)).toBe(true)
    expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBeGreaterThanOrEqual(25)
    expect(symbols.textContent).toContain('本章符號表')
    // 章首骨架（teaching-style §9）：問題是第一個區塊、系統地圖緊接在後、「你在這裡」標成 .c-map-note、標籤列在它之後；
    // 不再有「本章符號表在最後」那一行（連結在 PageFrame 的 strip 裡），也沒有會改變路由的 href
    expect(Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('本章符號表在最後'))).toBeUndefined()
    expect(root.firstElementChild).toBe(question)
    expect(systemMap.nextElementSibling).toBe(container.querySelector('.c-map-note'))
    expect(before(container.querySelector('.c-map-note'), container.querySelector('.ch11-tags'))).toBe(true)
    expect(container.querySelector('a[href="#symbols"]')).toBeNull() // HashRouter：不能用會改變路由的 href
    // 章末的「回到章首」捲回章首（jsdom 沒有 scrollIntoView：先確認沒有也不會丟錯，再補上替身確認目標）
    const back = Array.from(symbols.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('回到章首')) as HTMLButtonElement
    expect(() => fireEvent.click(back)).not.toThrow()
    const proto = Element.prototype as unknown as { scrollIntoView?: (arg?: unknown) => void }
    const original = proto.scrollIntoView
    const scrolled: Element[] = []
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      fireEvent.click(back)
      expect(scrolled).toEqual([root])
      expect(document.activeElement).toBe(root) // 回到章首後，焦點移到章節頂端（tabIndex = -1）
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
    // Lab：Case 並列比較表與 Run to Convergence
    expect(screen.getByText(/Case 並列比較（共用誤差模型、code 與 seed）/)).toBeTruthy()
    // （getAllByRole 在整章的大 DOM 上很慢，直接比對按鈕文字）
    expect(Array.from(container.querySelectorAll('button')).some((b) => /Run-to-Convergence/.test(b.textContent ?? ''))).toBe(true)
    // 勘誤小標連到驗證頁
    const errata = container.querySelectorAll('a.c-erratum-link')
    expect(errata.length).toBeGreaterThan(5)
    // 必須套用的勘誤都有小標（E13：本章 S 與規格 §11.4 的 S_GMAC 正負號相反）
    const eids = new Set(Array.from(errata).map((e) => e.getAttribute('data-erratum')))
    for (const id of ['E01', 'E03', 'E11', 'E12', 'E13', 'E17']) expect(eids.has(id), id).toBe(true)
    expect((errata[0] as HTMLAnchorElement).getAttribute('href')).toMatch(/^\/verification\?e=E\d\d$/)
    await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: WAIT })
    // σ_v = 0.05 的說明由模型計算：x = ±2 停在 E[q|x] ≈ ±0.5（不是全部飽和）
    expect(container.querySelector('#ch11-fixed-point')?.textContent ?? '').toContain('0.5')
    // near-integer sweep（inline 模式在主執行緒跑）完成後，時域／頻域交叉比對與「你會發現」段落出現
    await waitFor(() => expect(screen.getAllByText(/時域 vs 頻域最大相對差/).length).toBeGreaterThan(0), { timeout: WAIT })
    await waitFor(() => expect(screen.getByText(/頻寬內諧波貢獻/)).toBeTruthy(), { timeout: WAIT })
    // 審查 R01：預設的掃描有 8 個 FCW 沒通過「代回完整 erf 平均」的檢查——圖、指標、警告與交叉比對都要說它們只是線性外推
    const ni = container.querySelector('#ch11-near-integer') as HTMLElement
    const niText = ni.textContent ?? ''
    for (const t of ['線性外推', '通過檢查的最小 frac', '24／32 個 FCW 通過', '線性化條件不成立', '只驗證', '不是「', '3.57914', '12.3812', '6.11853', '0.00202942', '0.0815712']) expect(niText, t).toContain(t)
    expect(niText).not.toContain('確定性序列（無隨機性），不需要 Monte Carlo')
    // γ_lin 那一列的檢查是 ✗（預設第一點不是固定點）；C 的時域／頻域比對仍是 ✓
    const niRows = Array.from(ni.querySelectorAll('.c-metric-table tbody tr'))
    expect(niRows.filter((tr) => tr.getAttribute('data-pass') === 'false').map((tr) => (tr.textContent ?? '').slice(0, 3))).toEqual(['殘餘比'])
    expect(niRows.filter((tr) => tr.getAttribute('data-pass') === 'true')).toHaveLength(1)
    // 公式旁邊（Engineer 模式也看得到）的適用條件
    expect(document.getElementById('formula-F-11.14')?.textContent).toContain('條件見下')
    expect(niText).toContain('什麼時候才是 Sign-LMS 的固定點')
    // 全章所有 TeX 都能被 KaTeX 解析（含 m() 的 $…$ 行內數學與非同步出現的段落）
    const bad = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)
    expect(bad).toEqual([])
    // 行內數學分隔符成對：渲染後的文字不應殘留 '$'
    expect(container.textContent ?? '').not.toMatch(/\$/)
    // 控制項與指標表的數學都是 KaTeX
    expect(expectLatexControls(container)).toBeGreaterThan(40)
    // 互動圖表（Plotly）裡的軸標題、圖例、標記文字：`$…$` 都已轉成斜體符號與真正的上下標
    const plotText = expectTypesetPlotStrings()
    expect(plotText.filter((t) => /<i>|<sub>|<sup>/.test(t)).length).toBeGreaterThan(20)
    for (const t of [
      '<i>e</i>（t.u.）',
      '<i>E</i>[<i>q</i>|<i>e</i>]',
      '<i>E</i>[<i>q</i>|<i>e</i>] = erf(<i>e</i>/(√2\u2009<i>σ</i><sub><i>v</i></sub>))',
      '<i>x</i> = −2',
      '<i>σ</i><sub><i>v</i></sub>（t.u.，log）',
      '<i>w</i><sup>∗</sup>（t.u.）',
      '二階近似 1.34+3.456×10<sup>−4</sup>/<i>σ</i><sub><i>v</i></sub><sup>2</sup>',
      '<i>C</i>（頻域：Σ<sub><i>k</i></sub>|<i>X</i><sub><i>k</i></sub>|<sup>2</sup>·Re\u2009<i>H</i><sub>PD</sub>）',
      '線性候選 |<i>B</i>/<i>C</i>|（t.u.）',
      '|<i>w</i><sup>∗</sup>−<i>a</i>| ≈ |<i>B</i>/<i>C</i>|（通過代回檢查，右軸）',
      '|<i>B</i>/<i>C</i>|：線性外推，未通過檢查（右軸）',
      'Case A：<i>E</i>[<i>G</i>](<i>w</i>)，Sign，<i>σ</i><sub><i>v</i></sub> = 1',
      '<i>w</i> = <i>w</i><sup>∗</sup>（1.34035）',
      '確定性殘差 <i>e</i><sub>det</sub>+<i>φ</i>（t.u.）',
    ])
      expect(plotText, t).toContain(t)
    // 不可把 NaN / undefined 印到頁面上（程式碼區塊本身含 Number.NaN，先移除再檢查）
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.c-code, pre, code').forEach((el) => el.remove())
    expect(clone.textContent ?? '').not.toMatch(/NaN|undefined/)
    // smoke render 期間沒有 console.error（React key 警告、act 警告、render 例外…）
    expect(errSpy.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([])
    errSpy.mockRestore()
  }, SMOKE_TIMEOUT)

  it.each(['beginner', 'research'])('%s 模式也能完整 render（ModeGate 內容）且沒有 TeX 錯誤', async (mode) => {
    localStorage.setItem('lmspll.mode', mode)
    const { container } = render(wrap(<Chapter11 />))
    expect(container.querySelector('#ch11-offset')).toBeTruthy()
    if (mode === 'research') {
      expect(screen.getByText('Research：mean-field 的嚴格意義')).toBeTruthy()
      // 「ρ_j（σ_v(x) 斜率）」與單位 code^{-2} 都由 KaTeX 排版
      const jitter = Array.from(container.querySelectorAll('.c-param-label')).find((l) => (l.textContent ?? '').includes('ρ'))
      expect(jitter?.textContent).toContain('斜率')
      expect(jitter?.querySelectorAll('.katex').length).toBe(2)
      expect(Array.from(container.querySelectorAll('.c-param-unit .katex')).length).toBeGreaterThanOrEqual(1)
    } else {
      expect(screen.queryByText('Research：mean-field 的嚴格意義')).toBeNull()
    }
    const bad = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)
    expect(bad).toEqual([])
    // 控制項的 label／單位／說明與指標表：數學都是 KaTeX，沒有 Unicode 拼的公式
    expect(expectLatexControls(container)).toBeGreaterThan(40)
    expect(container.textContent ?? '').not.toMatch(/\$/)
    await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: WAIT })
  }, SMOKE_TIMEOUT)

  it('Lab：預設（Gallery #7）顯示 Sign mean-field 1.34035；?preset= 載入 shared BBPD ⇒ w* = 1', async () => {
    const { container, unmount } = render(wrap(<BiasInlLab />))
    await waitFor(() => expect(container.textContent).toContain('1.34035'), { timeout: WAIT })
    unmount()
    const r2 = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-offset-shared-bbpd'))
    await waitFor(() => {
      const kpi = r2.container.querySelector('.ch11-kpi-value')
      expect(kpi?.textContent).toBe('1')
    }, { timeout: WAIT })
  }, LAB_TIMEOUT)

  it('Lab：inline 模式按 Run 會跑 Monte Carlo 並更新 KPI、交叉比對與 Case 比較表', async () => {
    const { container } = render(wrap(<BiasInlLab />))
    const run = screen.getAllByRole('button', { name: /執行 Run/ })[0]
    fireEvent.click(run)
    await waitFor(
      () => {
        const kpis = container.querySelectorAll('.ch11-kpi')
        const mc = within(kpis[2] as HTMLElement).getByText(/^1\.3/)
        expect(mc).toBeTruthy()
        // KPI 註記：與解析值一致（4·SE + 有限步長）
        expect((kpis[2] as HTMLElement).textContent).toContain('✓ 與解析值一致')
      },
      { timeout: WAIT },
    )
    // 比較表的 Case A 列有 MC 結果與 ✓
    const row = Array.from(container.querySelectorAll('tr.ch11-hl')).find((tr) => tr.textContent?.startsWith('A'))
    expect(row?.textContent).toMatch(/1\.3\d+ ± /)
    expect(row?.textContent).toContain('✓')
    expect(container.textContent).toContain('有限步長偏移估計')
    // 指標表的單位 t.u.^{-1}、控制項的 label 與說明都是 KaTeX
    const slopeRow = Array.from(container.querySelectorAll('.c-metric-table tbody tr')).find((tr) => (tr.textContent ?? '').includes('GMAC 斜率'))
    expect(slopeRow?.querySelector('td:nth-child(3) .katex')).toBeTruthy()
    expect(expectLatexControls(container)).toBeGreaterThan(30)
    expect(container.textContent ?? '').not.toMatch(/\$/)
    // Run 之後多了 MC 軌跡圖與 MC 標記：圖表字串一樣是排版好的符號與上下標
    const mcText = expectTypesetPlotStrings()
    for (const t of [
      'block <i>k</i>',
      '<i>w</i><sub><i>k</i></sub>（t.u.）',
      'Case A：MC <i>w\u0304</i>（95% CI）',
      'Case A：MC 凍結 <i>w</i> 的平均 <i>G</i>（95% CI）',
      'MC（目前 <i>σ</i><sub><i>v</i></sub>，95% CI）',
      'mean-field <i>w</i><sup>∗</sup>（1.34035）',
    ])
      expect(mcText, t).toContain(t)
  }, LAB_TIMEOUT)

  it('DC null 實驗：Run 之後圖表的軸標題與圖例（w*、σ_eff）是排版好的符號，控制項的 label 是 KaTeX', async () => {
    P.react.mockClear()
    const { container } = render(wrap(<DcNullExperiment />))
    fireEvent.click(screen.getAllByRole('button', { name: /執行 Run/ })[0])
    await waitFor(() => expect(plotlyStrings().some((t) => t.startsWith('servo-aware（'))).toBe(true), { timeout: WAIT })
    const text = expectTypesetPlotStrings()
    expect(text).toContain('servo-aware（<i>σ</i><sub>eff</sub>）')
    expect(text).toContain('<i>w</i><sup>∗</sup>（t.u.）')
    expect(text).toContain('Monte Carlo（95% CI）')
    // 控制項：b、c₂、c₃、x₀、σ_v、N 的 label 都是 KaTeX；暫存器名稱用 ASCII
    const labels = Array.from(container.querySelectorAll('.c-param-label'))
    expect(labels.filter((l) => l.querySelector('.katex')).length).toBeGreaterThanOrEqual(6)
    expect(expectLatexControls(container)).toBeGreaterThan(10)
    expectNoTexErrors(container)
    expect(container.textContent ?? '').not.toMatch(/\$/)
  }, LAB_TIMEOUT)

  it('Lab：dead zone preset 的 w* 顯示區間（不是任意一點），Run 後 MC 落在區間內', async () => {
    const { container } = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-deadzone-noisefree'))
    await waitFor(() => expect(container.querySelector('.ch11-kpi-value')?.textContent).toBe('(1.3333, 1.5)'), { timeout: WAIT })
    expect(screen.getAllByText(/dead zone/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: /執行 Run/ })[0])
    await waitFor(() => expect(container.textContent).toContain('落在 dead zone 內'), { timeout: WAIT })
    expect((container.querySelectorAll('.ch11-kpi')[2] as HTMLElement).textContent).toContain('✓')
    // 模型（bias.ts）的警告以 $…$ 表示數學：σ_v = 0 與 dead zone 區間都經 KaTeX 渲染，沒有殘留的 $ 或 KaTeX 錯誤
    const warns = Array.from(container.querySelectorAll('.c-exp-warnings p'))
    const dz = warns.find((w) => (w.textContent ?? '').includes('一整段區間')) as HTMLElement
    expect(dz).toBeTruthy()
    expect(dz.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5)
    expect(dz.textContent).toContain('1.33333')
    expectNoTexErrors(container)
    expect(container.textContent ?? '').not.toMatch(/\$/)
    // dead zone 的圖例（G = 0 的區間）與 σ_v = 0 的圖例是排版好的符號
    const dzText = expectTypesetPlotStrings()
    expect(dzText).toContain('Case A：dead zone（<i>G</i> = 0 的區間）')
    expect(dzText).toContain('Case A：<i>E</i>[<i>G</i>](<i>w</i>)，Sign，<i>σ</i><sub><i>v</i></sub> = 0')
    // Case 比較表的「設定」欄：σ_v 以 KaTeX 顯示
    const caseRow = Array.from(container.querySelectorAll('tr.ch11-hl')).find((tr) => /^[A-C]Sign/.test(tr.textContent ?? ''))
    expect(caseRow?.querySelector('td:nth-child(2) .katex')).toBeTruthy()
  }, LAB_TIMEOUT)

  it('Lab（審查 R05）：無雜訊的離散 code 把 w* 標成「E[G] 的變號點」，殘差表不再說最後一欄的平均是 0；有雜訊時仍是真正的根', async () => {
    const { container, unmount } = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-inl-cubic-noisefree'))
    await waitFor(() => expect(container.querySelector('.ch11-kpi-value')?.textContent).toBe('1.4'), { timeout: WAIT })
    const text = container.textContent ?? ''
    for (const t of ['的變號點', '時間平均', '跳到', '變號而不是連續地通過 0', '在表中這個數值解上的機率加權平均是']) expect(text, t).toContain(t)
    expect(text).not.toContain('機率加權平均為 0 的是最後一欄')
    expect(text).not.toContain('的根（指定模型的精確 mean-field）')
    expect(text).not.toContain('只影響測度為 0 的點')
    // 殘差表最後一欄（x·E[q|x]）：+2、−1、0、−1、+2，機率加權平均 +0.4（不是 0）
    const table = Array.from(container.querySelectorAll('table.ch11-table')).find((t) => (t.querySelector('caption')?.textContent ?? '').includes('殘差表')) as HTMLTableElement
    expect(Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.lastElementChild?.textContent)).toEqual(['+2', '-1', '0', '-1', '+2'])
    // tie 的 code（x = ±2）的殘差數學上是 0：顯示 0，不印二分法留下的 5e-14（審查 C04）；圖說說明最後一欄的 ±2 從哪裡來
    expect(Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.children[4].textContent)).toEqual(['0', '+0.3', '0', '-0.3', '0'])
    expect(Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.children[5].textContent)).toEqual(['0', '-0.3', '0', '-0.3', '0'])
    expect(table.querySelector('caption')?.textContent).toContain('就是 tie 的 code')
    expect(table.querySelector('caption')?.textContent).toContain('顯示時歸零')
    const caption = table.querySelector('caption') as HTMLElement
    // 圖說裡的三個數字（KaTeX 的 annotation 是 TeX 原文）：由 0.4 跳到 −1.2；最後一欄的平均 0.4
    expect(Array.from(caption.querySelectorAll('.katex annotation')).map((a) => a.textContent).filter((t) => /^-?[\d.]+$/.test(t ?? ''))).toEqual(['0.4', '-1.2', '0.4'])
    // 指標表的第一列：w*（變號點）= 1.4，連到 F-11.10
    const first = container.querySelector('.c-metric-table tbody tr') as HTMLElement
    expect(first.textContent).toContain('的變號點')
    expect(first.textContent).toContain('加權中位數')
    expect(first.querySelector('a[data-formula-link="F-11.10"]')).toBeTruthy()
    expectNoTexErrors(container)
    expect(text).not.toMatch(/\$/)
    unmount()
    // 對照：預設（σ_v = 1）的固定點是真正的根，文字不變
    const r2 = render(wrap(<BiasInlLab />))
    await waitFor(() => expect(r2.container.textContent).toContain('1.34035'), { timeout: WAIT })
    const t2 = r2.container.textContent ?? ''
    expect(t2).toContain('機率加權平均為 0 的是最後一欄')
    expect(t2).toContain('的根（指定模型的精確 mean-field）')
    expect(t2).not.toContain('的變號點）')
    expect(t2).toContain('勘誤 E40')
  }, LAB_TIMEOUT)

  it('Lab（審查 C04）：κ preset 每個 code 的殘差都是 0——表格不印浮點殘渣、KPI 與圖的標題不說「殘差不為 0」；MSE preset 的圖說是改寫後的文字', async () => {
    const residualTable = (root: Element) =>
      Array.from(root.querySelectorAll('table.ch11-table')).find((t) => (t.querySelector('caption')?.textContent ?? '').includes('殘差表')) as HTMLTableElement
    const cells = (t: HTMLTableElement) => Array.from(t.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent ?? ''))
    // (1) bias-kappa-identifiability：κ = 0.1、沒有 INL、Sign-LMS、σ_v = 1 ⇒ w* = a + κ = 1.1，e(x; w*) ≡ 0
    const { container, unmount } = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-kappa-identifiability'))
    await waitFor(() => expect(container.querySelector('.ch11-kpi-value')?.textContent).toBe('1.1'), { timeout: WAIT })
    const kpis = Array.from(container.querySelectorAll('.ch11-kpi')) as HTMLElement[]
    expect(kpis[0].textContent).toContain('= +0.1') // gain bias 是真的
    expect(kpis[3].querySelector('.ch11-kpi-value')?.textContent).toBe('0.02 → 0')
    expect(kpis[3].textContent).toContain('殘差功率也是 0')
    expect(kpis[3].textContent).toContain('不可辨識')
    // 「一階公式」KPI 的 max|e_det|/σ_v 是 0，不是 1.67×10⁻¹⁶
    expect(Array.from(kpis[1].querySelectorAll('.katex annotation')).map((a) => a.textContent)).toEqual([String.raw`\max|e_\mathrm{det}|/\sigma_v=0`])
    const kap = residualTable(container)
    // 欄位：x、p、t(x)、e(x; a)、e(x; w*)、x·e、x·E[q|x]
    expect(cells(kap).map((r) => r.slice(3))).toEqual([
      ['-0.2', '0', '0', '0'],
      ['-0.1', '0', '0', '0'],
      ['0', '0', '0', '0'],
      ['+0.1', '0', '0', '0'],
      ['+0.2', '0', '0', '0'],
    ])
    expect(kap.querySelector('caption')?.textContent).toContain('整欄都是 0')
    expect(kap.querySelector('caption')?.textContent).not.toContain('一般不為 0')
    const text = container.textContent ?? ''
    expect(text).toContain('殘差 vs code：這組設定下每個 code 的殘差都是 0')
    expect(text).not.toContain('殘差不歸零')
    // 整個 Lab（KPI、指標表、殘差表）都沒有 1e-16、1e-32 之類的殘渣
    const shown = [...kpis, ...Array.from(container.querySelectorAll('.c-metric-table tbody tr')), kap].map((el) => el.textContent ?? '')
    expect(shown.filter((t) => /\de-(1[3-9]|[2-9]\d)|10\^\{-(1[3-9]|[2-9]\d)\}/.test(t))).toEqual([])
    expectNoTexErrors(container)
    expect(text).not.toMatch(/\$/)
    unmount()
    // (2) bias-inl-cubic-mse：殘差 (−0.12, +0.24, 0, −0.24, +0.12) 是真的；圖說說的是「x·e 欄的平均為 0，e 欄不必每一列都是 0」
    const r2 = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-inl-cubic-mse'))
    await waitFor(() => expect(r2.container.querySelector('.ch11-kpi-value')?.textContent).toBe('1.34'), { timeout: WAIT })
    const mse = residualTable(r2.container)
    expect(cells(mse).map((r) => r[4])).toEqual(['-0.12', '+0.24', '0', '-0.24', '+0.12'])
    expect(cells(mse).map((r) => r[5])).toEqual(['+0.24', '-0.24', '0', '-0.24', '+0.24'])
    const cap = mse.querySelector('caption')?.textContent ?? ''
    expect(cap).toContain('欄的機率加權平均為 0（GMAC 歸零），但這不代表')
    expect(cap).toContain('欄的每一列都是 0')
    expect(cap).not.toContain('本身不為 0')
    const k2 = Array.from(r2.container.querySelectorAll('.ch11-kpi')) as HTMLElement[]
    expect(k2[3].querySelector('.ch11-kpi-value')?.textContent).toBe('0.26 → 0.0288')
    expect(k2[3].textContent).toContain('但殘差功率')
    expect(k2[3].textContent).not.toContain('也是 0')
    expect(r2.container.textContent).toContain('殘差 vs code：GMAC 歸零，殘差不全為 0')
    expectNoTexErrors(r2.container)
  }, LAB_TIMEOUT)

  it('Lab：σ_v = 0.1 時出現「線性化失效」警告（解釋原因而非只顯示錯誤）', async () => {
    const { container } = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-inl-cubic-sigma01'))
    await waitFor(() => expect(screen.getAllByText(/線性化失效風險/).length).toBeGreaterThan(0), { timeout: WAIT })
    // 警告裡的指標 max|e_det|/σ_v = 2.66577 > 0.3 以 KaTeX 顯示（字串屬性的 $…$），不是 Unicode 拼的公式
    const warn = Array.from(container.querySelectorAll('.c-exp-warnings p')).find((w) => (w.textContent ?? '').includes('線性化失效風險')) as HTMLElement
    expect(warn.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
    expect(warn.textContent).toContain('2.66577')
    expect(warn.textContent).not.toMatch(/σ_v|\$/)
    expectNoTexErrors(container)
  }, LAB_TIMEOUT)
})
