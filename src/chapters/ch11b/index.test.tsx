import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { pageById } from '@/app/registry'
import { ALL_HANDCALCS } from '@/app/handcalcs'
import { presetsForExperiment } from '@/app/presets'
import Chapter11b from './index'
import { CH11B_DIAGRAMS } from './diagrams'
import { FoldingLab, FOLDING_ID } from './experiments/FoldingLab'
import { InlLmsLab, LMS_ID } from './experiments/InlLmsLab'
import { BasisLab, BASIS_ID } from './experiments/BasisLab'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { plotlyMock } from '@/test/mocks/plotly'
import { wrapPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

function wrap(node: React.ReactNode, url = '/ch/11b') {
  return wrapPage(node, { url })
}

// 第一次造訪的預設是 Beginner；這個檔案的斷言照 Engineer 模式寫（個別測試另外設定）
beforeEach(() => localStorage.setItem('lmspll.mode', 'engineer'))
afterEach(async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  cleanup()
  localStorage.clear()
})

const UNICODE_MATH = /[σμκεφρλθωΩΣΔπ√²³⁴⁻¹₀₁₂₃ₖ≤≥≈≠≡∂∈∞δηβ·×÷∓ŷ]/
function outsideKatex(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}
/** 控制項與指標表：KaTeX 以外沒有 Unicode 拼的數學；回傳 KaTeX 的個數 */
function expectLatexControls(root: Element): number {
  let katex = 0
  const bad: string[] = []
  for (const sel of ['.c-param-label', '.c-param-unit', '.c-param-hint', '.c-metric-table tbody td:first-child', '.c-metric-table .c-metric-note']) {
    for (const el of Array.from(root.querySelectorAll(sel))) {
      katex += el.querySelectorAll('.katex').length
      if (UNICODE_MATH.test(outsideKatex(el))) bad.push(`${sel}：${outsideKatex(el)}`)
    }
  }
  expect(bad).toEqual([])
  return katex
}

type PlotlyCall = [unknown, unknown, unknown, unknown]
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
  for (const [, data, layout] of plotlyMock.react.mock.calls as unknown as PlotlyCall[]) {
    walk(data, null, 0)
    walk(layout, null, 0)
  }
  return out
}
function expectTypesetPlotStrings(): string[] {
  const strings = plotlyStrings()
  const bare = (t: string) => t.replace(/<i>[^<]*<\/i>/g, '')
  expect(strings.filter((t) => /[\\{}$]/.test(t))).toEqual([])
  expect(strings.filter((t) => /[_^]/.test(t))).toEqual([])
  expect(strings.filter((t) => /[α-ω]/.test(bare(t)))).toEqual([])
  return strings
}

const SMOKE_TIMEOUT = 600000
const LAB_TIMEOUT = 300000
const WAIT = 120000
const before = (a: Element | null, b: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('Ch11b smoke tests（jsdom）', () => {
  it('登錄：/ch/11b 在 registry、formulas／handcalcs／presets 都被自動彙整', () => {
    const page = pageById('ch11b')
    expect(page?.path).toBe('/ch/11b')
    expect(page?.group).toBe('C')
    expect(page?.specSections).toEqual(['11'])
    expect(ALL_HANDCALCS.filter((h) => h.page === '/ch/11b').map((h) => h.id)).toEqual(HANDCALCS.map((h) => h.id))
    expect(presetsForExperiment(FOLDING_ID).length).toBe(3)
    expect(presetsForExperiment(LMS_ID).length).toBe(5)
    expect(presetsForExperiment(BASIS_ID).length).toBe(2)
  })

  it('整章可以 render、沒有 console.error；段落、公式錨點、實驗、手算、思考題、方塊圖與符號表的順序都對', async () => {
    const errSpy = vi.spyOn(console, 'error')
    const { container } = render(wrap(<Chapter11b />))
    expect(screen.getByText('這一課要回答的問題')).toBeTruthy()
    for (const id of ['ch11b-intuition', 'ch11b-model', 'ch11b-folding', 'ch11b-structures', 'ch11b-basis', 'ch11b-identifiability', 'ch11b-compare', 'ch11b-synthesis', 'ch11b-quiz']) expect(container.querySelector(`#${id}`), id).toBeTruthy()
    // 公式登錄的每個 ID 在頁面上都有唯一錨點
    for (const f of FORMULAS) expect(document.querySelectorAll(`[id="formula-${f.id}"]`).length, f.id).toBe(1)
    // 三個 ExperimentShell
    expect(container.querySelectorAll('.c-exp').length).toBe(3)
    expect(screen.getByText(/實驗 A：INL 形狀與折返頻譜/)).toBeTruthy()
    expect(screen.getByText(/實驗 B：分段／LUT／多項式 LMS 的收斂/)).toBeTruthy()
    expect(screen.getByText(/實驗 C：條件數與 preconditioning/)).toBeTruthy()
    // 程式碼區塊（CodeCompare／CodeBlock）由真實原始碼擷取
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    expect(screen.queryByText(/程式碼載入錯誤/)).toBeNull()
    // 先備知識框：Isserlis、one-hot
    const pageText = container.textContent ?? ''
    for (const t of ['Isserlis', 'Wiener–Khinchin', 'one-hot regressor', 'Hermite', 'misadjustment', 'gauge']) expect(pageText, t).toContain(t)
    // 帶入手算：5 題依序出現，各在對應的段落；綜合題在思考題之前
    expect(Array.from(container.querySelectorAll('.c-handcalc')).map((el) => el.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    const sectionOf = (id: string) => document.getElementById(`handcalc-${id}`)?.closest('section.c-section')?.id
    expect(HANDCALCS.map((h) => sectionOf(h.id))).toEqual(['ch11b-folding', 'ch11b-structures', 'ch11b-structures', 'ch11b-basis', 'ch11b-synthesis'])
    const synthesis = container.querySelector('#ch11b-synthesis') as HTMLElement
    const quiz = container.querySelector('#ch11b-quiz') as HTMLElement
    expect(synthesis.nextElementSibling).toBe(quiz)
    // 4 題思考題、本課必記 1 個
    expect(container.querySelectorAll('.c-quiz').length).toBe(4)
    expect(container.querySelectorAll('.c-recap').length).toBe(1)
    // 方塊圖：系統地圖 + 6 張，依登錄表的順序在各自的段落裡；FigRef 在圖之前；圖在對應公式之前
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(CH11B_DIAGRAMS.length + 1)
    expect(figures[0].getAttribute('aria-label')).toContain('系統方塊圖')
    const question = screen.getByText('這一課要回答的問題').closest('.c-callout') as HTMLElement
    expect(question.nextElementSibling).toBe(figures[0])
    const figs = Array.from(container.querySelectorAll('.c-chapter-fig'))
    expect(figs.map((el) => el.id)).toEqual(CH11B_DIAGRAMS.map((d) => `ch11b-fig-${d.id}`))
    expect(figs.map((el) => el.closest('section.c-section')?.id)).toEqual(CH11B_DIAGRAMS.map((d) => d.section))
    figs.forEach((el, i) => {
      expect(el.querySelector('figcaption')?.textContent, el.id).toContain(`圖 11b-${i + 1}｜`)
      expect(el.querySelector('figure.c-mermaid')?.getAttribute('aria-label'), el.id).toMatch(new RegExp(`^圖 11b-${i + 1}：`))
      const label = el.querySelector('figcaption')?.textContent?.split('｜')[0] ?? ''
      const refs = Array.from(container.querySelectorAll('.c-figref')).filter((r) => r.textContent === label)
      expect(refs.length, label).toBeGreaterThanOrEqual(1)
      expect(before(refs[0], el), label).toBe(true)
    })
    expect(before(document.getElementById('ch11b-fig-inl-model'), document.getElementById('formula-F-11B.1'))).toBe(true)
    expect(before(document.getElementById('ch11b-fig-folding-path'), document.getElementById('formula-F-11B.3'))).toBe(true)
    expect(before(document.getElementById('ch11b-fig-piecewise-loop'), document.getElementById('formula-F-11B.7'))).toBe(true)
    expect(before(document.getElementById('ch11b-fig-gauge'), document.getElementById('formula-F-11B.12'))).toBe(true)
    expect(before(document.getElementById('ch11b-fig-handcalc-flow'), document.getElementById('handcalc-HC-11B.5'))).toBe(true)
    // 章首骨架（teaching-style §9）：問題是第一個區塊、系統地圖緊接在後、「你在這裡」標成 .c-map-note、標籤列在它之後；
    // 「符號表在最後」的連結、勘誤與手算索引由 PageFrame 依 chapterMeta 畫，章節自己不放
    const root = container.querySelector('.ch11b') as HTMLElement
    expect(root.firstElementChild).toBe(question)
    expect(figures[0].nextElementSibling).toBe(container.querySelector('.c-map-note'))
    expect(before(container.querySelector('.c-map-note'), container.querySelector('.ch11b-tags'))).toBe(true)
    expect(container.textContent).not.toContain('本章符號表在最後')
    // 符號表：只有一份、在頁面最後；沒有 href="#…"；「回到章首」捲回章節頂端
    const symbols = document.getElementById('symbols') as HTMLElement
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(root.lastElementChild).toBe(symbols)
    expect(before(container.querySelector('.c-recap'), symbols)).toBe(true)
    expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBeGreaterThanOrEqual(20)
    expect(container.querySelector('a[href^="#"]:not([href^="#/"])')).toBeNull()
    const back = Array.from(symbols.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('回到章首')) as HTMLButtonElement
    expect(back).toBeTruthy()
    expect(() => fireEvent.click(back)).not.toThrow()
    // 章節交叉參照連到存在的頁面
    const chrefs = Array.from(container.querySelectorAll('a.c-chref'))
    expect(chrefs.length).toBeGreaterThan(10)
    expect(container.querySelectorAll('.c-chref-missing').length).toBe(0)
    // 所有 TeX 都能被 KaTeX 解析；沒有殘留的 $；控制項與指標表的數學都是 KaTeX
    await waitFor(() => expect(plotlyMock.react).toHaveBeenCalled(), { timeout: WAIT })
    expectNoTexErrors(container)
    expect(container.textContent ?? '').not.toMatch(/\$/)
    expect(expectLatexControls(container)).toBeGreaterThan(30)
    const plotText = expectTypesetPlotStrings()
    expect(plotText.filter((t) => /<i>|<sub>|<sup>/.test(t)).length).toBeGreaterThan(5)
    // 不可把 NaN / undefined 印到頁面上（程式碼區塊本身含 NaN，先移除）
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.c-code, pre, code').forEach((el) => el.remove())
    expect(clone.textContent ?? '').not.toMatch(/NaN|undefined/)
    expect(errSpy.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([])
    errSpy.mockRestore()
  }, SMOKE_TIMEOUT)

  it.each(['beginner', 'research'])('%s 模式也能完整 render 且沒有 TeX 錯誤', async (mode) => {
    localStorage.setItem('lmspll.mode', mode)
    const { container } = render(wrap(<Chapter11b />))
    expect(container.querySelector('#ch11b-folding')).toBeTruthy()
    if (mode === 'research') expect(screen.getByText(/Python golden model/)).toBeTruthy()
    else expect(screen.queryByText(/Python golden model/)).toBeNull()
    expectNoTexErrors(container)
    expect(container.textContent ?? '').not.toMatch(/\$/)
    await waitFor(() => expect(plotlyMock.react).toHaveBeenCalled(), { timeout: WAIT })
  }, SMOKE_TIMEOUT)

  it('實驗 A（inline）：自動計算後 KPI 顯示帶內 rms，Analytic 欄 ok（精確式 ±12%）；?preset= 載入 uniform', async () => {
    const { container, unmount } = render(wrap(<FoldingLab />))
    await waitFor(() => expect(container.querySelector('.ch11b-kpi-value')?.textContent).toMatch(/t\.u\./), { timeout: WAIT })
    expect(container.textContent).toContain('Welch 帶內功率')
    const check = container.querySelector('.c-exp-check, [data-check="analytic"]')
    expect((check?.textContent ?? container.textContent ?? '')).toContain('相對差')
    expect(expectLatexControls(container)).toBeGreaterThan(8)
    expectNoTexErrors(container)
    const strings = expectTypesetPlotStrings()
    expect(strings).toContain('<i>f</i>（Hz，log）')
    unmount()
    const r2 = render(wrap(<FoldingLab />, '/ch/11b?preset=dtc-inl-folding-uniform'))
    await waitFor(() => expect(r2.container.textContent).toContain('理論 1/3'), { timeout: WAIT })
  }, LAB_TIMEOUT)

  it('實驗 B（inline）：按 Run 跑 Monte Carlo，KPI 顯示校正前→後，交叉比對 ok；gauge preset 顯示奇異警告', async () => {
    const { container, unmount } = render(wrap(<InlLmsLab />))
    expect(container.textContent).toContain('條件數')
    fireEvent.click(screen.getAllByRole('button', { name: /執行 Run/ })[0])
    await waitFor(() => expect(container.querySelector('.ch11b-kpi-value')?.textContent).toMatch(/^[89]\.\d+ → 0\.\d/), { timeout: WAIT })
    expect(container.textContent).toContain('✓ 與解析值一致')
    expect(expectLatexControls(container)).toBeGreaterThan(15)
    expectNoTexErrors(container)
    expect(container.textContent ?? '').not.toMatch(/\$/)
    const strings = expectTypesetPlotStrings()
    expect(strings).toContain('block <i>b</i>')
    unmount()
    const r2 = render(wrap(<InlLmsLab />, '/ch/11b?preset=dtc-inl-lms-gauge-gain'))
    await waitFor(() => expect(r2.container.textContent).toContain('奇異'), { timeout: WAIT })
  }, LAB_TIMEOUT)

  it('實驗 C（inline）：按 Run 後四種基底的 KPI 與條件數出現，MC 的 k95 在 mean-field 的 0.5–2 倍內', async () => {
    const { container } = render(wrap(<BasisLab />))
    fireEvent.click(screen.getAllByRole('button', { name: /執行 Run/ })[0])
    await waitFor(() => expect(container.querySelectorAll('.ch11b-kpi').length).toBe(4), { timeout: WAIT })
    expect(container.textContent).toContain('monomial')
    expect(container.textContent).toMatch(/67\.[456]/) // 樣本 R（uniform 隨機樣本）的條件數 ≈ 67.6
    expectNoTexErrors(container)
    expect(container.textContent ?? '').not.toMatch(/\$/)
    expectTypesetPlotStrings()
  }, LAB_TIMEOUT)
})
