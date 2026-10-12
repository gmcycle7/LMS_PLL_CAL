import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StrictMode } from 'react'
import { act, render, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderTex } from '@/components'
import { plotMath } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { SettingsProvider } from '@/app/settings'
import type { PresetEntry } from '@/data/types'
import Chapter04 from './index'
import { CH04_DIAGRAMS } from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { DEFAULT_FLOW_CASE, DEFAULT_FLOW_SHARED, FLOW_MC_RUNS, flowAnalyticCheck, flowConfig, flowMonteCarlo } from './experiments/SignalFlowExperiment'
import { DEFAULT_FP_CASE, DEFAULT_FP_SHARED, buildLoopParams } from './experiments/FixedPointExperiment'
import { ar1MeanSe, compareEncodings, runFixedGmacLoop } from '@/simulation/models/gmac'
import { DEFAULT_ENCODING } from './experiments/BitEncodingExperiment'
import { runBlockLms } from '@/simulation/models/blockLms'
import { handGmac } from './sections/GmacMath'
import { sliceGoldenGmac, defaultBiasNumbers, negateBugNumbers, windupNumbers, wTruncNumbers } from './sections/FixedPoint'
import { clearVsNoClear } from './sections/HardwareNotes'
import { DEFAULT_RESIDUE } from './sections/Residue'
import { CH04_SYMBOLS } from './sections/Symbols'
import { residueSignals } from './residue'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
// 記錄 Plot 送進 Plotly 之前的 data／layout（`$...$` 還沒轉成 pseudo-HTML），檢查圖內文字都用 LaTeX 寫
const PM = vi.hoisted(() => ({ calls: [] as [unknown, unknown][] }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...orig,
    applyPlotMath: <D, L>(data: D, layout: L) => {
      PM.calls.push([data, layout])
      return orig.applyPlotMath(data, layout)
    },
  }
})
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  },
}))

function renderAt(url = '/ch/04', strict = false) {
  const tree = (
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <Chapter04 />
      </MemoryRouter>
    </SettingsProvider>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

afterEach(() => localStorage.clear())

function loadPreset(id: string): PresetEntry {
  return JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', `${id}.json`), 'utf8')) as PresetEntry
}

/** Plot 的 data／layout 裡會顯示的文字欄位（與 plotMath.ts 處理的欄位相同）的字串 */
const PLOT_TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label'])
function plotStrings(value: unknown, key: string | null = null, depth = 0, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (key !== null && PLOT_TEXT_KEYS.has(key)) out.push(value)
    return out
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return out
  if (Array.isArray(value)) {
    if (typeof value[0] === 'number') return out
    for (const v of value) plotStrings(v, key, depth + 1, out)
    return out
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) plotStrings(v, k, depth + 1, out)
  return out
}

function headings(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4')).map((h) => (h.textContent ?? '').trim())
}

/** KaTeX 節點換成它的 TeX 原始碼（annotation）：含公式的指標名稱、警告、交叉比對附註可以直接比對文字 */
function texText(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.katex').forEach((k) => k.replaceWith(k.querySelector('annotation')?.textContent ?? ''))
  return c.textContent ?? ''
}

/**
 * 程式碼區塊以外的文字（程式碼裡的 template literal 本來就有 $）。
 * TestBadge 的提示框（.c-tip-list）逐字列出測試名稱，名稱本身可能含有「`$...$`」這種字樣（例如別頁的顯示層測試），
 * 那是原文照錄、不是沒轉成 KaTeX 的公式，所以和程式碼一樣排除。
 */
function proseText(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('pre, code, .c-code, .c-tip-list').forEach((k) => k.remove())
  return c.textContent ?? ''
}

/** 某個實驗的 ExperimentShell（整頁約 10 萬個 DOM 節點：輪詢時只複製這一塊，不要每次複製整頁） */
function shellOf(root: ParentNode, experimentId: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#exp-${experimentId}`)
  if (!el) throw new Error(`找不到實驗 ${experimentId}`)
  return el
}

/**
 * jsdom 整頁渲染的逾時（ms）。單獨跑一個測試約 15–25 秒；同一個 worker 連續渲染多次、或機器同時在跑其他測試時會慢好幾倍，
 * 所以給寬鬆的上限——逾時只是保護，判定仍由下面的斷言決定。
 */
const PAGE_TIMEOUT = 240_000
const WAIT = { timeout: 90_000 }

function caseButtons(root: ParentNode, experimentId: string): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(`#exp-${experimentId} .c-case-btn`))
}

describe('Ch04 頁面（jsdom smoke test）', () => {
  it('渲染不丟錯：章末的符號表、所有段落、三個實驗、勘誤連結、公式錨點與 FORMULAS 一致', async () => {
    const errSpy = vi.spyOn(console, 'error')
    PM.calls.length = 0
    const { container } = renderAt()
    // 符號表在整頁最後（Recap 與「連結到 PLL」之後），外層 id="symbols"；章首不放符號表，只留一行捲到它的連結（teaching-style §5）
    const page = container.querySelector('.ch04')!
    const symbols = container.querySelector('#symbols')!
    expect(page.lastElementChild).toBe(symbols)
    expect(container.querySelectorAll('.c-symbols').length).toBe(1)
    expect(symbols.lastElementChild!.classList.contains('c-symbols')).toBe(true)
    expect(symbols.querySelector('.c-symbols-title')!.textContent).toBe('本章符號表')
    expect(symbols.querySelectorAll('tbody tr').length).toBe(CH04_SYMBOLS.length)
    expect(new Set(CH04_SYMBOLS.map((r) => r.symbol)).size).toBe(CH04_SYMBOLS.length)
    for (const after of ['.c-recap', '#ch04-wrap', '.c-quiz']) {
      const all = container.querySelectorAll(after)
      expect(all[all.length - 1].compareDocumentPosition(symbols) & Node.DOCUMENT_POSITION_FOLLOWING, after).toBeTruthy()
    }
    const question = container.querySelector<HTMLElement>('#ch04-question')!
    expect(question.querySelector('.c-symbols')).toBeNull()
    expect(question.querySelectorAll('.ch04-symbols-link').length).toBe(1)
    // （這一頁很大：按鈕直接用 selector 找，不用 getByRole——後者要對整個子樹算 accessibility，很慢）
    const toSymbols = question.querySelector<HTMLButtonElement>('.ch04-symbols-link button')!
    expect(toSymbols.textContent).toBe('本章符號表在最後 ↓')
    expect(toSymbols.type).toBe('button')
    // HashRouter 下 href="#symbols" 會改到路由：連結是按鈕，以 scrollIntoView 捲動（jsdom 沒有這個方法，這裡補一個來記錄）
    const proto = Element.prototype as unknown as { scrollIntoView?: (this: Element) => void }
    const scrolled: string[] = []
    proto.scrollIntoView = function () {
      scrolled.push(this.id)
    }
    const scrollTo = vi.fn()
    const origScrollTo = window.scrollTo
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    act(() => toSymbols.click())
    expect(scrolled).toEqual(['symbols'])
    // 符號表上方的「回到剛才讀到的地方」捲回按下連結時的位置
    const back = symbols.querySelector<HTMLButtonElement>('.ch04-symbols-back button')!
    expect(back.textContent).toContain('回到剛才讀到的地方')
    act(() => back.click())
    expect(scrollTo).toHaveBeenCalledWith({ top: window.scrollY, behavior: 'smooth' })
    // 章首目錄同樣是按鈕：第一個捲到 §1
    const toc = Array.from(question.querySelectorAll<HTMLButtonElement>('.ch04-toc button'))
    expect(toc.map((b) => b.textContent)).toEqual(['§1 系統全貌', '§2 Fractional residue', '§3 硬體對應與時序', '§4 GMAC 數學', '§5 定點 GMAC', '§6 RTL 檢查清單', '§7 思考題與本課必記'])
    act(() => toc[0].click())
    expect(scrolled).toEqual(['symbols', 'ch04-system'])
    delete proto.scrollIntoView
    window.scrollTo = origScrollTo
    // 本章自己寫的內容沒有會改到路由的 href="#xxx"（「#/…」是 HashRouter 的路由連結，不算；
    // 實驗框內共用 MetricTable 的「#formula-…」連結不屬於本章，另行回報）
    const hashAnchors = Array.from(container.querySelectorAll('a[href^="#"]')).filter((a) => !a.getAttribute('href')!.startsWith('#/'))
    expect(hashAnchors.filter((a) => !a.closest('[id^="exp-"]')).map((a) => a.getAttribute('href'))).toEqual([])
    const hs = headings(container)
    for (const t of ['§1 完整概念系統', '§2 Fractional residue', '§3 硬體對應', '§4 GMAC 的數學', '§5 定點 GMAC', '§6 RTL 檢查清單', '§7 比較表']) {
      expect(hs.some((h) => h.startsWith(t))).toBe(true)
    }
    for (const t of ['GMAC 訊號流：一個 block 內逐 sample 追蹤', '定點 GMAC：位元數、overflow、rounding 偏差與 anti-windup', 'Fractional residue explorer：DSM → DTC 要補償什麼']) {
      expect(hs).toContain(t)
    }
    // 標題裡的 ±1 是 KaTeX（$\pm1$）
    const encTitle = Array.from(container.querySelectorAll('h1, h2, h3, h4')).find((h) => (h.textContent ?? '').startsWith('反面教材：comparator 0/1 忘了映射成'))
    expect(encTitle && texText(encTitle)).toBe('反面教材：comparator 0/1 忘了映射成 \\pm1')
    // 八題「帶入手算」都在頁面上，最後一題（綜合題）在思考題之前
    const hcIds = Array.from(container.querySelectorAll('section.c-handcalc')).map((s) => s.id)
    expect(hcIds).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(container.querySelectorAll('.ch04-handcalc-lead').length).toBe(HANDCALCS.length)
    const lastHc = container.querySelector('[id="handcalc-HC-04.8"]')!
    const firstQuiz = container.querySelector('.c-quiz')!
    expect(lastHc.compareDocumentPosition(firstQuiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const s of Array.from(container.querySelectorAll('section.c-handcalc'))) expect(s.querySelectorAll('.c-step').length, s.id).toBeGreaterThan(0)
    // 22 張 Mermaid 圖的圖說由 MermaidFig 顯示：符號是 KaTeX（共用 Mermaid 的 caption 只能放純文字）；
    // 圖的內容、順序與實際渲染由 diagrams.test.tsx 檢查
    const figCaptions = Array.from(container.querySelectorAll('.ch04-mermaid-fig .ch04-mermaid-caption'))
    expect(figCaptions.length).toBe(CH04_DIAGRAMS.length)
    expect(figCaptions.length).toBe(22)
    for (const c of figCaptions) expect(c.querySelector('.katex'), c.textContent ?? '').not.toBeNull()
    expect(figCaptions.map((c) => texText(c)).join('\n')).toContain('乘 \\mu')
    // 共用 Mermaid 自己的 figcaption 只有章首的系統地圖（SystemMap）那一個
    const ownCaptions = Array.from(container.querySelectorAll('.c-mermaid figcaption'))
    expect(ownCaptions.length).toBe(1)
    expect(ownCaptions[0].textContent).toMatch(/^系統地圖：藍色是這一課從頭走到尾的訊號路徑/)
    expect(ownCaptions[0].querySelector('.katex')).not.toBeNull() // 圖說裡的符號是 KaTeX
    expect(question.contains(ownCaptions[0])).toBe(true)
    // 勘誤標籤連到驗證頁
    const errata = Array.from(container.querySelectorAll('a.ch04-erratum'))
    for (const id of ['E07', 'E13', 'E18']) expect(errata.some((a) => a.textContent === `勘誤 ${id}` && a.getAttribute('href') === '#/verification')).toBe(true)
    // 每個登錄的公式在頁面上都有錨點
    for (const fm of FORMULAS) expect(container.querySelector(`[id="formula-${fm.id}"]`), fm.id).not.toBeNull()
    // CodeBlock 的 region 都找得到（找不到時顯示「程式碼載入錯誤」）
    expect(container.textContent).not.toContain('程式碼載入錯誤')
    // 所有 TeX 都能被 KaTeX 解析（含 Beginner 收合的推導；預設 engineer 模式）
    const texErrors = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => `${e.getAttribute('title') ?? ''} ⟵ ${e.textContent ?? ''}`)
    expect(texErrors).toEqual([])
    // Worker 計算（jsdom 下 inline）完成後出現結果
    await waitFor(() => expect(shellOf(container, 'gmac-fixed-point').textContent).toContain('（定點減浮點）[fs]'), WAIT)
    await waitFor(() => expect(texText(shellOf(container, 'gmac-bit-encoding'))).toContain('0/1 直接用（bug）：後半段平均 w'), WAIT)
    // 實驗算完後（指標名稱、交叉比對附註、警告都出現了）：字串屬性裡的 $...$ 全部轉成 KaTeX，沒有殘留的 $，也沒有 KaTeX 錯誤
    expect(proseText(container)).not.toContain('$')
    expect(Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)).toEqual([])
    expect(texText(shellOf(container, 'gmac-bit-encoding'))).toContain('0/1 → q=2b-1：後半段平均 w')
    expect(texText(shellOf(container, 'gmac-fixed-point'))).toContain('最壞情況需要的 B_\\mathrm{acc}（精確）')
    expect(P.react).toHaveBeenCalled()
    // 互動圖裡的數學也是 LaTeX（docs/teaching-style.md §3）：圖內文字（軸標題、圖例、標題）的公式寫成 `$...$`，
    // 其餘文字沒有 Unicode 拼的數學；轉成 Plotly 的 pseudo-HTML 之後不剩反斜線、大括號與 `$`
    const plotTexts = [...new Set(PM.calls.flatMap(([d, l]) => [...plotStrings(d), ...plotStrings(l)]))]
    expect(plotTexts.filter((t) => t.includes('$')).length).toBeGreaterThanOrEqual(25)
    for (const t of plotTexts) {
      expect((t.match(/(?<!\\)\$/g) ?? []).length % 2, `「${t}」的 $ 沒有成對`).toBe(0)
      expect(unicodeMathIn(t.replace(/\$[^$]*\$/g, ' ')), `圖內文字「${t}」還有 Unicode 拼的數學`).toEqual([])
      const shown = plotMath(t).replace(/<\/?(i|b|sub|sup|br)>/g, '').replace(/%\{[^}]*\}/g, '')
      expect(shown, `圖內文字「${t}」轉換後還有 TeX 語法`).not.toMatch(/[\\{}$]/)
    }
    for (const t of [String.raw`$w_k$ [fs/code]`, String.raw`block $k$`, String.raw`bipolar $\pm1$`, String.raw`$a(k)$`, String.raw`$E[S]/2^{\ell}$（真實平均，輸出 LSB）`, String.raw`$y[n]$`, String.raw`$E[\delta_k]/\delta_0$`, String.raw`累加 $S$（running sum）`]) {
      expect(plotTexts, t).toContain(t)
    }
    // React 不應報錯（key、DOM 巢狀、hooks 規則…）
    expect(errSpy.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([])
    errSpy.mockRestore()
  }, PAGE_TIMEOUT)

  it('Research 模式顯示額外內容（golden Python、Poisson summation）且 TeX 全部可解析；Beginner 模式推導預設收合', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const r = renderAt()
    expect(r.container.textContent).toContain('def accumulator_bits_required')
    expect(r.container.textContent).toContain('Research：dither 不夠時會怎樣？平衡點為什麼不靠「餘數均勻」？')
    const texErrors = Array.from(r.container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)
    expect(texErrors).toEqual([])
    expect(Array.from(r.container.querySelectorAll('details.ch04-fold')).every((d) => (d as HTMLDetailsElement).open)).toBe(true)
    r.unmount()
    localStorage.setItem('lmspll.mode', 'beginner')
    const b = renderAt()
    const folds = Array.from(b.container.querySelectorAll('details.ch04-fold')) as HTMLDetailsElement[]
    expect(folds.length).toBeGreaterThan(8)
    expect(folds.every((d) => !d.open)).toBe(true)
    expect(b.container.textContent).not.toContain('def accumulator_bits_required')
    // Beginner 模式下每個登錄的公式仍有錨點（Formula Reference 頁的連結不會落空），先備知識框也都在
    for (const fm of FORMULAS) expect(b.container.querySelector(`[id="formula-${fm.id}"]`), fm.id).not.toBeNull()
    for (const t of ['Z transform', '期望值', 'Gaussian 分布', 'pole 與單位圓', '二補數']) expect(b.container.textContent).toContain(t)
    b.unmount()
  }, PAGE_TIMEOUT)

  it('?preset=gmac-flow-sum-vs-average 會載入三個 case（A/B/C），切到 B 時顯示 sum 模式的警告', async () => {
    const { container } = renderAt('/ch/04?preset=gmac-flow-sum-vs-average')
    await waitFor(() => expect(caseButtons(container, 'gmac-signal-flow').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B', 'Case C']), WAIT)
    act(() => caseButtons(container, 'gmac-signal-flow')[1].click())
    // blockLms 的警告是純文字（Unicode 拼的數學），頁面在顯示層轉成 $...$：N、μ/N 都是 KaTeX
    const shell = shellOf(container, 'gmac-signal-flow')
    await waitFor(() => expect(texText(shell)).toContain('Case B：gm_mode=sum 時有效增益放大 N 倍（N=16：g=6.383；若沿用 average 模式的 \\mu，需改為 \\mu/N=0.625）'), WAIT)
    expect(shell.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(proseText(shell)).not.toContain('$')
    // 假設清單（blockLms 的 assumptions）也轉成 LaTeX；sum 模式的總和寫成 S_k（勘誤 E07 / E18）
    expect(texText(shell)).toContain('K_q=\\sqrt{2/\\pi}/\\sigma_v 為小訊號近似')
    expect(texText(shell)).toContain('GMAC（sum 模式）：S_k=\\sum q\\,x_\\mathrm{ref}（N=16）')
    // 模型原本的 Unicode 寫法不再出現（TestBadge 提示框逐字列出的測試名稱不算，見 proseText）
    expect(proseText(shell)).not.toMatch(/σ_v|x_ref|w\* − a/)
  }, PAGE_TIMEOUT)
})

describe('Ch04 在 React StrictMode（dev server）下', () => {
  it('反面測試：effect 連跑兩次時 preset 的 case 不會重複加入——預設 gmac-fixed-point 只有 A/B，不會多出 Case C', async () => {
    const { container } = renderAt('/ch/04', true)
    await waitFor(() => expect(caseButtons(container, 'gmac-fixed-point').length).toBeGreaterThanOrEqual(2), WAIT)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(caseButtons(container, 'gmac-fixed-point').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B'])
    expect(caseButtons(container, 'gmac-signal-flow').map((b) => b.textContent?.trim())).toEqual(['Case A'])
  }, PAGE_TIMEOUT)

  it('?preset=gmac-fp-negate-bug（2 個 case）：載入後剛好是 A（正確取負）與 B（取負 bug），不會被預設的 case 蓋掉', async () => {
    const { container } = renderAt('/ch/04?preset=gmac-fp-negate-bug', true)
    await waitFor(() => expect(caseButtons(container, 'gmac-fixed-point').length).toBeGreaterThanOrEqual(2), WAIT)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(caseButtons(container, 'gmac-fixed-point').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B'])
    // 共用參數與 case 參數都來自 preset：full range code、B_acc = 17、B 為 inplace 取負
    const shell = container.querySelector('#exp-gmac-fixed-point')!
    await waitFor(() => expect(texText(shell)).toMatch(/B_\\mathrm\{acc\}=17，取負 bug/), WAIT)
    expect(texText(shell)).toContain('full range（含 -2^{B_x-1}）')
  }, PAGE_TIMEOUT)
})

describe('Ch04 實驗互動（jsdom）', () => {
  it('?preset=gmac-fp-w-truncation：三個 case；切到 B 顯示 W 截斷的警告、R 與 F-04.18 的預測，Fixed-Point 交叉比對一致', async () => {
    const { container } = renderAt('/ch/04?preset=gmac-fp-w-truncation')
    await waitFor(() => expect(caseButtons(container, 'gmac-fixed-point').map((b) => b.textContent?.trim())).toEqual(['Case A', 'Case B', 'Case C']), WAIT)
    act(() => caseButtons(container, 'gmac-fixed-point')[1].click())
    const shell = container.querySelector('#exp-gmac-fixed-point')!
    await waitFor(() => expect(texText(shell)).toContain('取整到 W 的 LSB \\Delta_W=0.1563\\,\\mathrm{fs}（R=\\Delta_W/(\\mu\\Delta_G)=8）'), WAIT)
    expect(texText(shell)).toContain('\\Rightarrow w^*-a\\approx\\bar\\varepsilon_W\\Delta_W/g=-2.653\\,\\mathrm{fs}（F-04.18）')
    expect(shell.textContent).not.toMatch(/Δ_W = |ε̄_W|w\* − a/) // 模型原本的 Unicode 寫法不再出現
    expect(texText(shell)).toContain('Case B：R=\\Delta_W/(\\mu\\Delta_G)、\\mu\\sigma_G/\\Delta_W')
    expect(texText(shell)).toMatch(/Case B：w_\\mathrm\{fixed\}-w_\\mathrm\{float\}=-2\.578\\pm0\.0716\\,\\mathrm\{fs\}（AR\(1\) SE），預測（\\div N rounding 0 \+ W 取整 -2\.653）=-2\.653\\,\\mathrm\{fs\}/)
    expect(shell.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(proseText(shell)).not.toContain('$')
    // 舊 preset（case 沒有 wLsb / wRounding 欄位）載入後，控制項拿到的是預設值而不是 undefined
    const lsb = Array.from(shell.querySelectorAll('input')).find((i) => /Δ_W（W 的 LSB/.test(i.getAttribute('aria-label') ?? ''))
    expect(lsb).toBeTruthy()
    expect((lsb as HTMLInputElement).value).not.toMatch(/NaN|undefined/)
  }, PAGE_TIMEOUT)


  it('gmac-fixed-point：打開 Monte Carlo 開關後顯示多 seed 結果；gmac-bit-encoding 的 Monte Carlo 自動執行', async () => {
    const { container } = renderAt()
    const enc = shellOf(container, 'gmac-bit-encoding')
    const fp = shellOf(container, 'gmac-fixed-point')
    await waitFor(() => expect(texText(enc)).toContain('bug：Monte Carlo 平均 w（6 seeds）'), WAIT)
    const sw = within(fp).getByRole('switch', { name: /Monte Carlo（目前 case 另跑 6 seeds/ })
    act(() => sw.click())
    await waitFor(() => expect(texText(fp)).toMatch(/Case A：Monte Carlo w_\\mathrm\{fixed\}-w_\\mathrm\{float\}（6 seeds）/), WAIT)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
  }, PAGE_TIMEOUT)
})

describe('Ch04 資料與輔助計算', () => {
  it('FORMULAS：ID 唯一、格式 F-04.n、頁面 /ch/04', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-04\.\d+$/)
      expect(f.page).toBe('/ch/04')
      expect(f.tex.length).toBeGreaterThan(5)
    }
  })

  it('FORMULAS 的 title / conditions：數學都寫成 $...$（Formula Reference 頁以 mathText 顯示），每一段都能被 KaTeX 解析', () => {
    const inline = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
    let withMath = 0
    for (const f of FORMULAS) {
      expect(renderTex(f.tex, true), f.id).not.toMatch(/katex-error|c-tex-error/)
      for (const text of [f.title, f.conditions]) {
        for (const m of text.matchAll(inline)) expect(renderTex(m[1], false), `${f.id}：${m[1]}`).not.toMatch(/katex-error|c-tex-error/)
        const plain = text.replace(inline, '')
        expect(plain, `${f.id} 落單的 $`).not.toContain('$')
        // $...$ 之外不可再有 Unicode 拼的數學（σ_v、≤、² …）、底線下標或落單的 TeX 指令
        expect(plain, `${f.id}：${plain}`).not.toMatch(/[σμδΔεχℓπφΦξ≤≥≈≠±∝⇒⇔→√½¼−·×²³∞≪≲≳∈′⌈⌉⌊⌋~]|[A-Za-z]_[A-Za-z{]|\^|\\[A-Za-z]/)
      }
      if (f.conditions.includes('$')) withMath++
    }
    expect(withMath).toBe(FORMULAS.length) // 每一條的使用條件都含有符號
    // 抽查：極性與 tie 規則（勘誤 E07）、F-04.18 的串接式
    expect(FORMULAS.find((f) => f.id === 'F-04.2')!.conditions).toContain(String.raw`$\delta=a-w$`)
    // 架構（全站約定，docs/assumptions.md §2a）：DTC 在 reference 輸入端，延遲從基準延遲 T_0 往回扣補償量；需要的補償量另用 τ_need；殘差的式子不變
    const f042 = FORMULAS.find((f) => f.id === 'F-04.2')!
    expect(f042.tex).toBe(String.raw`\tau_\mathrm{need}[n]=\frac{s[n]}{M}\,T_\mathrm{vco},\qquad\tau_\mathrm{DTC}[n]=T_0-w\,x[n],\qquad e_\mathrm{det}[n]=(a-w)\,x[n]`)
    expect(f042.conditions).toContain('DTC 在 reference 輸入端')
    expect(f042.conditions).toContain(String.raw`從固定的基準延遲 $T_0$ 往回扣補償量 $w\,x[n]$`)
    expect(f042.conditions).toContain('PD 量的是 DTC 延遲後的 reference edge 減 feedback edge')
    expect(FORMULAS.find((f) => f.id === 'F-04.1')!.conditions).toContain('feedback（divider）edge 的累積時間誤差（正 = 晚到）')
    // 符號表：τ_need（需要的補償量）、τ_DTC = T_0 − w_k·x[n]、兩條 edge 的時刻、e[n] 是 PD 的輸出
    const sym = (s: string) => CH04_SYMBOLS.find((r) => r.symbol === s)
    for (const s of [String.raw`\tau_\mathrm{need}[n]`, String.raw`\tau_\mathrm{DTC}[n],\;T_0`, String.raw`t_\mathrm{ref}'[n],\;t_\mathrm{fb}[n]`, String.raw`e_\mathrm{det}[n]`, 'e[n]']) expect(sym(s), s).toBeTruthy()
    expect(FORMULAS.find((f) => f.id === 'F-04.3')!.conditions).toContain(String.raw`$b=1\Leftrightarrow e\ge0$（tie 判 $+1$）`)
    expect(FORMULAS.find((f) => f.id === 'F-04.18')!.conditions).toContain(String.raw`$=-(1-2^{-(\ell+\ell_W)})\,\Delta_W/(2g)$`)
  })

  it('presets：本章三個實驗的 preset 都在 /ch/04，參數鍵都是實驗認得的欄位', () => {
    const dir = join(process.cwd(), 'src', 'data', 'presets')
    const known: Record<string, { shared: string[]; cases?: string[]; seeded: boolean }> = {
      'gmac-signal-flow': { shared: Object.keys(DEFAULT_FLOW_SHARED), cases: Object.keys(DEFAULT_FLOW_CASE), seeded: true },
      'gmac-fixed-point': { shared: Object.keys(DEFAULT_FP_SHARED), cases: Object.keys(DEFAULT_FP_CASE), seeded: true },
      'gmac-bit-encoding': { shared: Object.keys(DEFAULT_ENCODING), seeded: true },
      'gmac-residue': { shared: Object.keys(DEFAULT_RESIDUE), seeded: false }, // 確定性序列，沒有 seed
    }
    // gmac-*.json 也有其他頁面（例如 /models 的 gmac-datapath-sizing）的 preset：只檢查本章實驗的
    const files = readdirSync(dir)
      .filter((f) => /^gmac-.*\.json$/.test(f))
      .filter((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetEntry).experiment in known)
    expect(files.length).toBe(14)
    for (const f of files) {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetEntry
      expect(p.id).toBe(f.replace(/\.json$/, ''))
      expect(p.page).toBe('/ch/04')
      const k = known[p.experiment]
      expect(k).toBeTruthy()
      const { cases, seed, ...rest } = p.params as { cases?: Record<string, unknown>[]; seed?: number }
      expect(typeof seed).toBe(k.seeded ? 'number' : 'undefined')
      for (const key of Object.keys(rest)) expect(k.shared).toContain(key)
      if (cases) for (const c of cases) for (const key of Object.keys(c)) expect(k.cases).toContain(key)
      expect(p.expected.length).toBeGreaterThan(10)
    }
  })

  it('preset gmac-residue-*：expected 的數字由 residue.ts / dsm.ts 支持', () => {
    const run = (id: string) => {
      const p = loadPreset(id)
      const prm = { ...DEFAULT_RESIDUE, ...(p.params as Partial<typeof DEFAULT_RESIDUE>) }
      const sig = residueSignals(prm)
      return { sig, maxResid: sig.residualFs.reduce((a, v) => Math.max(a, Math.abs(v)), 0), maxNeed: Math.max(...sig.dtcNeedFs), minNeed: Math.min(...sig.dtcNeedFs) }
    }
    const hand = run('gmac-residue-hand-example')
    expect([hand.sig.K, hand.sig.M, hand.sig.period]).toEqual([5, 16, 16])
    expect(hand.sig.residueRange).toEqual([-0.9375, 0])
    expect(hand.minNeed).toBe(0)
    expect(Object.is(hand.minNeed, -0)).toBe(false) // 不顯示 −0
    expect(hand.maxNeed).toBeCloseTo(72115.38, 2)
    expect(hand.maxResid).toBeCloseTo(721.15, 2)
    const mash = run('gmac-residue-mash111')
    expect([mash.sig.K, mash.sig.M]).toEqual([1229, 4096])
    expect(mash.sig.fracEff).toBeCloseTo(0.30004883, 8)
    expect(mash.sig.residueRange[0]).toBeCloseTo(-1.814, 3)
    expect(mash.sig.residueRange[1]).toBeCloseTo(1.889, 3)
    expect(mash.minNeed).toBeLessThan(0) // 需要 DTC offset
    expect(Math.round(mash.maxResid)).toBe(1453)
    const zero = run('gmac-residue-integer-fcw')
    expect(zero.sig.K).toBe(0)
    expect(Array.from(zero.sig.y).every((v) => v === 0)).toBe(true)
    expect(zero.maxResid).toBe(0)
  })

  it('preset gmac-flow-sum-vs-average 的 expected 由模擬支持：B 振盪、C 與 A 重合', () => {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', 'gmac-flow-sum-vs-average.json'), 'utf8')) as PresetEntry
    const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
    const s = { ...DEFAULT_FLOW_SHARED, ...shared }
    const [a, b, c] = cases.map((cs) => runBlockLms(flowConfig(s, cs, seed)))
    expect(Array.from(c.blocks.w)).toEqual(Array.from(a.blocks.w))
    expect(b.analytic.g).toBeCloseTo(16 * a.analytic.g, 10)
    expect(Math.max(...b.blocks.w) - Math.min(...b.blocks.w.subarray(4))).toBeGreaterThan(100)
    // expected 文字：「w 在 −40 與 120 fs 之間來回跳」「g ≈ 6.38、pole ≈ −5.4」
    expect(Array.from(new Set(b.blocks.w.subarray(4))).sort((x, y) => x - y)).toEqual([-40, 120])
    expect(b.analytic.g).toBeCloseTo(6.38, 2)
    expect(b.analytic.p).toBeCloseTo(-5.38, 2)
  })

  it('preset gmac-flow-unmapped-dsm：code 全 ≤ 0 + 忘了映射 ⇒ 每個 G ≤ 0、w 單調下降；正確映射時收斂到 a', () => {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', 'gmac-flow-unmapped-dsm.json'), 'utf8')) as PresetEntry
    const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
    const s = { ...DEFAULT_FLOW_SHARED, ...shared }
    const bug = runBlockLms(flowConfig(s, cases[0], seed))
    expect(Math.max(...bug.trace.xRef)).toBeLessThanOrEqual(0)
    for (const g of bug.blocks.G) expect(g).toBeLessThanOrEqual(0)
    for (let k = 1; k < bug.blocks.w.length; k++) expect(bug.blocks.w[k]).toBeLessThanOrEqual(bug.blocks.w[k - 1])
    expect(bug.metrics.meanW).toBeLessThan(-15)
    const good = runBlockLms(flowConfig({ ...s, encoding: 'bipolar_pm_one' }, cases[0], seed))
    expect(Math.abs(good.metrics.meanW - s.aTrue)).toBeLessThan(2)
  })

  it('preset gmac-fp-6bit-4096：開機時 17-bit wrap 讓 w 往反方向跑，18-bit 與 17-bit saturate 收斂', () => {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'presets', 'gmac-fp-6bit-4096.json'), 'utf8')) as PresetEntry
    const { cases, seed, ...shared } = p.params as { cases: Partial<typeof DEFAULT_FP_CASE>[]; seed: number }
    const [ok, wrap, sat] = cases.map((c) => runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared }, { ...DEFAULT_FP_CASE, ...c }, seed)))
    expect(ok.stats.accOverflow).toBe(0)
    expect(Math.abs(ok.stats.meanFixed - 3)).toBeLessThan(1)
    expect(wrap.stats.accOverflow).toBeGreaterThanOrEqual(300)
    expect(wrap.wFixedApplied[300]).toBeLessThan(-450)
    expect(sat.stats.accOverflow).toBeGreaterThan(0)
    expect(Math.abs(sat.stats.meanFixed - 3)).toBeLessThan(1)
  }, 30000)

  it('gmac-signal-flow 的解析交叉比對：各 preset × 多 seed，聚合 |z| ≤ 4 且 gmac.ts 重算與 blockLms 逐 block 相同', () => {
    let worst = 0
    for (const id of ['gmac-flow-basic', 'gmac-flow-sum-vs-average', 'gmac-flow-dsm-residue', 'gmac-flow-unmapped-dsm']) {
      const p = loadPreset(id)
      const { cases, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
      const s = { ...DEFAULT_FLOW_SHARED, ...shared }
      for (const c of cases) {
        for (let seed = 1; seed <= 8; seed++) {
          for (const sh of [s, { ...s, N: 1 }, { ...s, path: 'first_order_hp' as const }]) {
            const r = runBlockLms(flowConfig(sh, c, seed))
            const chk = flowAnalyticCheck(r, sh, c.gmMode)
            expect(chk.maxImpl).toBeLessThanOrEqual(1e-9)
            worst = Math.max(worst, Math.abs(chk.aggZ))
          }
        }
      }
    }
    expect(worst).toBeLessThan(4)
  }, 60000)

  it('gmac-signal-flow 的 Monte Carlo 交叉比對：各 preset 的 |z| ≤ 4；把條件平均的模型故意弄錯（a、編碼、σ_v）時能被抓到', () => {
    for (const id of ['gmac-flow-basic', 'gmac-flow-sum-vs-average', 'gmac-flow-dsm-residue', 'gmac-flow-unmapped-dsm']) {
      const p = loadPreset(id)
      const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
      const s = { ...DEFAULT_FLOW_SHARED, ...shared }
      for (const c of cases) {
        const mc = flowMonteCarlo(s, c, seed)
        expect(mc.runs).toBe(FLOW_MC_RUNS)
        expect(mc.failed).toBe(0)
        expect(mc.blocks).toBe(FLOW_MC_RUNS * s.numBlocks)
        expect(Math.abs(mc.z), `${id} ${c.gmMode}`).toBeLessThan(4)
      }
    }
    // 同一批 seed 可重現
    expect(flowMonteCarlo(DEFAULT_FLOW_SHARED, DEFAULT_FLOW_CASE, 7).z).toBe(flowMonteCarlo(DEFAULT_FLOW_SHARED, DEFAULT_FLOW_CASE, 7).z)
    // 反面測試：解析那一側故意用錯的模型，z 必須遠超過門檻（a 差 10 fs、把 ±1 當成忘了映射、σ_v 差 4 倍）
    const zWith = (wrong: Partial<typeof DEFAULT_FLOW_SHARED>): number => {
      let sumDiff = 0
      let sumVar = 0
      for (let seed = 1; seed <= FLOW_MC_RUNS; seed++) {
        const r = runBlockLms(flowConfig(DEFAULT_FLOW_SHARED, DEFAULT_FLOW_CASE, seed))
        const chk = flowAnalyticCheck(r, { ...DEFAULT_FLOW_SHARED, ...wrong }, 'average')
        sumDiff += chk.sumDiff
        sumVar += chk.sumVar
      }
      return sumDiff / Math.sqrt(sumVar)
    }
    expect(Math.abs(zWith({}))).toBeLessThan(4)
    expect(zWith({ aTrue: DEFAULT_FLOW_SHARED.aTrue + 10 })).toBeLessThan(-20)
    expect(zWith({ aTrue: DEFAULT_FLOW_SHARED.aTrue - 10 })).toBeGreaterThan(20)
    expect(Math.abs(zWith({ encoding: 'unipolar_unmapped_bug' }))).toBeGreaterThan(8)
    expect(Math.abs(zWith({ sigmaV: 4 * DEFAULT_FLOW_SHARED.sigmaV }))).toBeGreaterThan(5)
    // σ_v = 0：G 為確定值，差值必須恰為 0
    expect(flowMonteCarlo({ ...DEFAULT_FLOW_SHARED, sigmaV: 0 }, DEFAULT_FLOW_CASE, 3).z).toBe(0)
  }, 60000)

  it('preset gmac-flow-basic / gmac-flow-dsm-residue 的 expected 由模擬支持（K、g、pole、收斂到 a）', () => {
    for (const id of ['gmac-flow-basic', 'gmac-flow-dsm-residue']) {
      const p = loadPreset(id)
      const { cases, seed, ...shared } = p.params as { cases: { gmMode: 'average' | 'sum'; mu: number }[]; seed: number }
      const s = { ...DEFAULT_FLOW_SHARED, ...shared }
      const r = runBlockLms(flowConfig(s, cases[0], seed))
      if (id === 'gmac-flow-basic') {
        expect(r.analytic.K).toBeCloseTo(Math.sqrt(2 / Math.PI) / 20, 10)
        expect(r.analytic.g).toBeCloseTo(0.399, 3)
        expect(r.analytic.p).toBeCloseTo(0.601, 3)
        expect(Math.abs(r.blocks.w[10] - 30)).toBeLessThan(5)
        expect(Math.abs(r.metrics.meanW - 30)).toBeLessThan(2)
        expect(r.metrics.stdW).toBeLessThan(5)
      } else {
        const xr = Array.from(r.trace.xRef)
        const Ex = xr.reduce((a, v) => a + v, 0) / xr.length
        const Ex2 = xr.reduce((a, v) => a + v * v, 0) / xr.length
        expect(Math.max(...xr)).toBeLessThanOrEqual(0)
        expect(Ex).toBeCloseTo(-0.45, 2)
        expect(Ex2).toBeCloseTo(0.285, 2)
        expect(r.analytic.g).toBeCloseTo(0.114, 3)
        expect(Math.abs(r.metrics.meanW - 29.7)).toBeLessThan(0.5)
      }
    }
  })

  it('preset gmac-fp-floor-bias / gmac-fp-negate-bug / gmac-fp-antiwindup 的 expected 由模擬支持', () => {
    const run = (id: string) => {
      const p = loadPreset(id)
      const { cases, seed, ...shared } = p.params as { cases: Partial<typeof DEFAULT_FP_CASE>[]; seed: number }
      return cases.map((c) => runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared }, { ...DEFAULT_FP_CASE, ...c }, seed)))
    }
    const [fA, fB, fC] = run('gmac-fp-floor-bias')
    // preset expected：「A ≈ −1.59 ± 0.05 fs（預測 −1.51）；B ≈ 0；C ≈ −0.39 ± 0.02 fs（預測 −0.373）」
    expect(fA.stats.biasDiff).toBeCloseTo(-1.59, 2)
    expect(fA.stats.biasDiffSe).toBeGreaterThan(0.04)
    expect(fA.stats.biasDiffSe).toBeLessThan(0.055)
    expect(fA.analytic.biasPred).toBeCloseTo(-1.51, 2)
    expect(Math.abs(fB.stats.biasDiff)).toBeLessThan(4 * fB.stats.biasDiffSe)
    expect(fC.stats.biasDiff).toBeCloseTo(-0.39, 2)
    expect(fC.stats.biasDiffSe).toBeGreaterThan(0.012)
    expect(fC.stats.biasDiffSe).toBeLessThan(0.025)
    expect(fC.analytic.biasPred).toBeCloseTo(-0.373, 3)
    const [nA, nB] = run('gmac-fp-negate-bug')
    expect(Math.abs(nA.stats.biasDiff)).toBeLessThan(4 * nA.stats.biasDiffSe + 0.02)
    // §5.4 的頁面文字：「模擬值約 −6.08 ± 0.09 fs」；preset expected：「約 −6.1 fs（自洽預測 −6.16；近似 −5.87）」
    expect(nB.stats.biasDiff).toBeCloseTo(-6.08, 2)
    expect(nB.stats.biasDiffSe).toBeGreaterThan(0.085)
    expect(nB.stats.biasDiffSe).toBeLessThan(0.095)
    expect(nB.analytic.biasPred).toBeCloseTo(-6.16, 2)
    expect(-negateBugNumbers().approx).toBeCloseTo(-5.87, 2)
    expect(Math.abs(nB.stats.biasDiff - nB.analytic.biasPred)).toBeLessThan(4 * nB.stats.biasDiffSe)
    const [wA, wB, wC] = run('gmac-fp-antiwindup')
    expect(Math.max(...wA.wFixed)).toBe(32)
    // §5.5 的頁面文字與 preset expected：「模擬約 243 blocks（預測約 242），anti-windup 只要約 7 blocks」
    expect(wA.stats.recoveryFixed).toBe(243)
    expect(wA.stats.recoveryPredFixed).toBeCloseTo(242.03, 2)
    expect(wB.stats.recoveryFixed).toBe(7)
    expect(wC.stats.wWrap).toBe(1)
    expect(Math.min(...wC.wFixedApplied.subarray(0, 250))).toBe(0) // rail 到 rail
    // 頁面文字的數字
    expect(windupNumbers().unwind).toBeCloseTo(232.9, 1)
    expect(-negateBugNumbers().deltaStar).toBeCloseTo(nB.analytic.biasPred, 9)
  }, 60000)

  it('preset gmac-fp-w-truncation 與 §5.6 的數字：W floor 的偏差 ≈ ε̄_WΔ_W/g，half-even 與浮點 W 無偏差', () => {
    const p = loadPreset('gmac-fp-w-truncation')
    const { cases, seed, ...shared } = p.params as { cases: Partial<typeof DEFAULT_FP_CASE>[]; seed: number }
    const [a, b, c] = cases.map((cs) => runFixedGmacLoop(buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared }, { ...DEFAULT_FP_CASE, ...cs }, seed)))
    // expected：「A ≈ 0；B ≈ −2.58 ± 0.07 fs（預測 −2.653）；C ≈ 0」
    expect(Math.abs(a.stats.biasDiff)).toBeLessThan(4 * a.stats.biasDiffSe + 0.02)
    expect(a.analytic.biasPred).toBe(0)
    expect(b.stats.biasDiff).toBeCloseTo(-2.58, 2)
    expect(b.stats.biasDiffSe).toBeGreaterThan(0.065)
    expect(b.stats.biasDiffSe).toBeLessThan(0.075)
    expect(b.analytic.biasPred).toBeCloseTo(-2.653, 3)
    expect(Math.abs(b.stats.biasDiff - b.analytic.biasPred)).toBeLessThan(4 * b.stats.biasDiffSe)
    expect(Math.abs(c.stats.biasDiff)).toBeLessThan(4 * c.stats.biasDiffSe + 0.02)
    expect(c.analytic.biasPred).toBe(0)
    // 頁面 §5.6 的手算數字與模型的 analytic 相同
    const wt = wTruncNumbers()
    expect(wt.wLsb).toBe(0.15625)
    expect(wt.R).toBe(8)
    expect(wt.bias).toBeCloseTo(b.analytic.biasPred, 10)
    expect(wt.g).toBeCloseTo(b.analytic.g, 12)
    expect(wt.ditherW).toBeCloseTo(b.analytic.ditherRatioW, 10)
    const halfMu = runFixedGmacLoop({ ...buildLoopParams({ ...DEFAULT_FP_SHARED, ...shared, mu: 5 }, { ...DEFAULT_FP_CASE, ...cases[1] }, seed), numBlocks: 20 })
    expect(wt.biasHalf).toBeCloseTo(halfMu.analytic.biasPred, 10)
    expect(wt.biasHalf).toBeCloseTo(-5.685, 3) // preset expected 的「−5.685 fs」
    expect(wt.Rhalf).toBe(16)
    // 設計規則：Δ_W ≤ 2g·δ_tol = 0.00515 fs ⇒ 0.125 fs 的實體 LSB 下面至少 5 個小數位元
    expect(wt.wLsbMax).toBeCloseTo(0.00515, 5)
    expect(wt.fracBits).toBe(5)
  }, 60000)

  it('preset gmac-encoding-dc-code / gmac-encoding-zero-mean 的 expected 由模擬支持', () => {
    for (const id of ['gmac-encoding-dc-code', 'gmac-encoding-zero-mean']) {
      const p = loadPreset(id)
      const { seed, ...rest } = p.params as Record<string, number>
      const r = compareEncodings({ ...DEFAULT_ENCODING, ...rest, seed })
      const [good, mapped, bug] = r.runs
      expect(Array.from(mapped.w)).toEqual(Array.from(good.w))
      expect(Math.abs(good.meanW - 3)).toBeLessThan(4 * ar1MeanSe(good.w.subarray(750), good.meanW))
      expect(bug.K / good.K).toBeCloseTo(0.5, 12)
      const se = ar1MeanSe(bug.w.subarray(750), bug.meanW)
      expect(Math.abs(bug.meanW - r.bugExactPred)).toBeLessThan(4 * se)
      if (id === 'gmac-encoding-dc-code') {
        expect(r.bugExactPred).toBeCloseTo(63.23, 2)
        expect(r.bugLinearPred).toBeCloseTo(53.1, 1)
      } else expect(r.bugExactPred).toBe(3)
    }
  }, 60000)

  it('手算 GMAC 例子：S = 2、G = 0.5、w_avg = 2、w_sum = 5、G_bug = 0.25', () => {
    const h = handGmac()
    expect(h.Ssum).toBe(2)
    expect(h.G).toBe(0.5)
    expect(h.wAvg).toBe(2)
    expect(h.wSum).toBe(5)
    expect(h.Gbug).toBe(0.25)
    expect(Array.from(h.S)).toEqual([1, 2, 1, 2])
  })

  it('golden Python 片段擷取完整（含三個函式、不含其他段落）', () => {
    const src = readFileSync(join(process.cwd(), 'golden', 'lms_pll_golden', 'quantization.py'), 'utf8')
    const s = sliceGoldenGmac(src)
    expect(s.startsWith('def accumulator_bits_required')).toBe(true)
    expect(s).toMatch(/def wrap_twos_complement/)
    expect(s).toMatch(/def gmac_accumulate/)
    expect(s).toMatch(/return acc$/)
  })

  it('floor 偏差表：F_G 每加 2 bits，偏差約縮小 4 倍；預設例子 −1.51 fs', () => {
    const r2 = defaultBiasNumbers(2)
    const r4 = defaultBiasNumbers(4)
    expect(r2.deltaStar).toBeCloseTo(1.5101835229434817, 10)
    expect(r2.deltaStar / r4.deltaStar).toBeCloseTo(4 * (1 - 2 ** -8) / (1 - 2 ** -6), 10)
    // F_G = 0：dither 比 0.568 < 1，但預測仍可用（gmac.test.ts 的多 seed：−6.13 ± 0.04 vs −6.059）；回復斜率 χ ≈ 0.997
    const r0 = defaultBiasNumbers(0)
    expect(r0.ditherRatio).toBeCloseTo(0.568, 3)
    expect(r0.deltaStar).toBeCloseTo(6.059, 3)
    expect(r0.rho).toBeGreaterThan(0.99)
    expect(r2.rho).toBeCloseTo(1, 9)
  })

  it('忘了清除 S：二階遞迴 |z| = 1（0 < g < 4），平均誤差不衰減；正確時幾何衰減', () => {
    const r = clearVsNoClear(0.2, 200)
    expect(r.radius).toBeCloseTo(1, 12)
    expect(Math.abs(r.clear[200])).toBeLessThan(1e-15)
    const tail = r.noClear.slice(150).map(Math.abs)
    expect(Math.max(...tail)).toBeGreaterThan(0.5)
    // 與 δ_{k+1} − (2 − g)δ_k + δ_{k−1} = 0 一致
    for (let k = 1; k < 199; k++) expect(r.noClear[k + 1] - (2 - 0.2) * r.noClear[k] + r.noClear[k - 1]).toBeCloseTo(0, 10)
  })
})
