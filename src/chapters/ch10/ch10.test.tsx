import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, type LearningMode } from '@/app/settings'
import { MathText, listRegions } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import { DEFAULT_RULE, analyzeRule, buildPlant } from '@/simulation/models/mimo'
import mimoSrc from '@/simulation/models/mimo.ts?raw'
import { useState } from 'react'
import mimoPy from '../../../golden/lms_pll_golden/mimo.py?raw'
import Chapter10 from './index'
import { FORMULAS } from './formulas'
import { SymbolsLink, chop, goldenSection10, texMat } from './common'
import { CH10_DIAGRAMS, diagram } from './diagrams'
import { HANDCALCS } from './handcalcs'
import { MatrixEditor } from './experiments/MatrixEditor'
import { MimoLab } from './experiments/MimoLab'
import { k95Metric } from './experiments/labState'
import { S0Intro } from './sections/S0Intro'
import { S2UpdateMatrix } from './sections/S2UpdateMatrix'
import { S3Noise } from './sections/S3Noise'
import { S7Symbols } from './sections/S7Symbols'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: mermaidMock }))

function renderChapter(url = '/ch/10', mode: LearningMode = 'engineer') {
  localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <Chapter10 />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(async () => {
  // 記憶體：整章的 DOM（上千個 KaTeX 公式）在 jsdom 下約 370 MB。下面三件事只要少做一件，卸載後的整棵 DOM 就會留在 heap，
  // 本檔 12 次整章渲染累積起來會超過 worker 4 GB 的 heap 上限（FATAL ERROR: JavaScript heap out of memory）。
  // 三件都做之後，每個測試結束時的存活 heap 約 70 MB（最多再多留 1–2 棵），整個檔案在 2 GB 的 heap 上限下也跑得完：
  //  1. 測試一結束就立刻卸載時，掛載後才排入的非同步工作（動態載入的 Plotly／Mermaid、worker 的回呼）還沒有機會執行，
  //     那棵樹之後就不會被釋放（實測：同步結束的測試每個都多留一棵）。所以先在 act() 裡讓事件迴圈轉一圈（macrotask），再卸載。
  //  2. vi.fn 會記住每次呼叫的引數，而 Plotly.react(gd, …)／purge(gd) 的 gd 是章節 DOM 裡的節點（卸載時 Plot 還會再呼叫一次 purge）。
  //     所以卸載後清掉所有 mock 的呼叫紀錄。
  //  3. jsdom 的 selector 引擎會快取每個 selector 字串最後一次查詢的 context 與結果節點（見 releaseSelectorCache）。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  cleanup()
  for (const f of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize, mermaidMock.initialize, mermaidMock.render]) f.mockClear()
  releaseSelectorCache()
  errorSpy.mockRestore()
  localStorage.clear()
})

interface SelectorEngineCaches {
  selectResolvers?: { clear?: () => void }
  matchResolvers?: { clear?: () => void }
}

/**
 * jsdom 的 selector 引擎（nwsapi）會為「每一個用過的 selector 字串」快取最後一次查詢的 context 與結果節點（LRU，1000 筆）。
 * container.querySelector(…)、within(exp).getAllByText(…)（內部是 querySelectorAll('*')）查過的整章 DOM 因此在卸載後仍被抓住，
 * 直到同一個 selector 字串改在別的 context 上查詢為止——整章 DOM 在 jsdom 下約 370 MB，幾個測試就累積到數 GB。
 * 每個測試結束後清掉這個快取，並用一次對 document 的查詢把「最後查詢的 context」移回 document。
 * 這裡碰的是 jsdom 的內部欄位（沒有公開 API 可以清）；欄位不存在時什麼都不做——只是多佔記憶體，不影響任何斷言。
 */
function releaseSelectorCache(): void {
  const implSymbol = Object.getOwnPropertySymbols(document).find((s) => s.description === 'impl')
  const impl = implSymbol ? ((document as unknown as Record<symbol, unknown>)[implSymbol] as { _nwsapi?: SelectorEngineCaches; _nwsapiDontThrow?: SelectorEngineCaches } | undefined) : undefined
  for (const engine of [impl?._nwsapi, impl?._nwsapiDontThrow]) {
    engine?.selectResolvers?.clear?.()
    engine?.matchResolvers?.clear?.()
  }
  document.querySelector('body')
}

function reactWarnings(): string[] {
  return errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => /Warning|Each child|unique "key"/.test(s))
}

/**
 * 以按鈕上的文字找「唯一」的一顆按鈕（找不到或有多顆都丟錯，與 getByRole 一樣嚴格）。
 * 不用 getByRole('button', { name })：jsdom 要為實驗外框裡的每個元素（含上千個 KaTeX span）計算 accessibility tree，
 * 整章渲染時一次查詢就要十幾秒，機器忙的時候會讓測試逾時。
 */
/**
 * Lab 的 KPI「ρ(A) = …，k₉₅ = …」以 KaTeX 顯示（docs/teaching-style.md §3：數學一律 LaTeX），畫面上的文字被拆成許多 span；
 * 這裡比對 KaTeX 附帶的 MathML annotation（TeX 原始碼 `\rho(\mathbf A)=0.995,\ k_{95}=598`）。rho／k 省略時不限制。
 */
function kpiPoles(root: HTMLElement, want: { rho?: number; k?: number | '∞' }): Element[] {
  const re = /^\\rho\(\\mathbf A\)=(.+),\\ k_\{95\}=(.+)$/
  return Array.from(root.querySelectorAll('.ch10-kpi-value annotation')).filter((a) => {
    const m = re.exec(a.textContent ?? '')
    if (!m) return false
    if (want.rho !== undefined && Number(m[1]) !== want.rho) return false
    return want.k === undefined || m[2].replace(/\{,\}/g, '') === (want.k === '∞' ? '\\infty' : String(want.k))
  })
}

/**
 * 實驗外框警告區的每一則訊息：text = 拿掉 KaTeX 之後留下的文字（中文敘述）、tex = 訊息裡每個公式的 TeX 原始碼。
 * 模型（mimo.ts）回報的原因都用 `$...$` 寫數學，所以 text 裡不應該再有 Unicode 拼的公式，也不應該有落單的 `$`。
 */
function shownWarnings(root: HTMLElement): { text: string; tex: string[] }[] {
  return Array.from(root.querySelectorAll('.c-exp-warnings .c-callout')).map((c) => {
    const tex = Array.from(c.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    const clone = c.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.katex').forEach((e) => e.remove())
    return { text: clone.textContent ?? '', tex }
  })
}
/** 警告區：沒有 KaTeX 錯誤、沒有落單的 `$`、KaTeX 以外沒有 Unicode 拼的數學（ρ、λ_min、Ĵ、≥、10⁻⁹…） */
function expectWarningsTypeset(root: HTMLElement) {
  expect(root.querySelectorAll('.c-exp-warnings .katex-error, .c-exp-warnings .c-tex-error').length).toBe(0)
  for (const w of shownWarnings(root)) {
    expect(w.text, w.text).not.toContain('$')
    expect(unicodeMathIn(w.text), w.text).toEqual([])
    // 帽子（Ĵ、R̂ 的組合用字元）、上標 T、1.2e-5 這種指數寫法
    expect(w.text, w.text).not.toMatch(/\u0134|\u0302|\u1d40|\d[eE][-+]\d/)
  }
}

function button(root: HTMLElement, name: RegExp): HTMLButtonElement {
  const hits = Array.from(root.querySelectorAll('button')).filter((b) => name.test((b.textContent ?? '').trim()))
  if (hits.length !== 1) throw new Error(`預期恰好一顆符合 ${String(name)} 的按鈕，找到 ${hits.length} 顆`)
  return hits[0]
}

// 整章渲染（jsdom + 上千個 KaTeX 公式）在多個 agent／開發者同時跑測試時會慢上數十倍（vite.config.ts 的說明）；
// 逾時只用來抓「卡死」，所以放寬（不影響任何斷言）：單一測試 LONG、等待 worker 結果 WAIT、卸載整章的 afterEach 也放寬。
const LONG = 240_000
const WAIT = { timeout: 90_000 }
vi.setConfig({ hookTimeout: 120_000 })

// getBy*／getAllBy* 找不到元素時，testing-library 預設會把「整個容器」pretty-print 進錯誤訊息（先把整棵 DOM 格式化成字串、再截成 7000 字）。
// 整章的 DOM 有數十萬個節點：waitFor 每輪詢一次（worker 還沒算完時）就要花好幾秒、產生數百 MB 的暫時字串——
// 這是機器忙時測試逾時、heap 逼近上限的主因。這裡改成只保留訊息、不印 DOM；所有斷言維持原樣。
configure({
  getElementError: (message) => {
    const error = new Error(message ?? '')
    error.name = 'TestingLibraryElementError'
    return error
  },
})

describe('Ch10 smoke test（jsdom）', () => {
  it.each(['beginner', 'engineer', 'research'] as const)('以 %s 模式渲染整章不拋錯、沒有 React 警告', async (mode) => {
    const { container } = renderChapter('/ch/10', mode)
    expect(screen.getByText(/這一課要回答的問題/)).toBeTruthy()
    expect(container.querySelectorAll('.c-quiz').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelector('.c-recap')).toBeTruthy()
    // 符號表在章末（docs/teaching-style.md §5）：整頁只有一張，包在 id="symbols" 裡，是 .ch10 的最後一個區塊，
    // 排在「本課必記」（Recap）與「連結到 PLL」之後；章首只剩一行「本章符號表在最後」的按鈕（在開場問題之前）
    const page = container.querySelector('.ch10') as HTMLElement
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols).toBeTruthy()
    expect(container.querySelectorAll('.c-symbols').length).toBe(1)
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBeGreaterThanOrEqual(35)
    expect(page.lastElementChild).toBe(symbols)
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(after(container.querySelector('.c-recap') as Element, symbols)).toBe(true)
    expect(after(container.querySelector('#ch10-pll') as Element, symbols)).toBe(true)
    expect(after(container.querySelector('#ch10-lab') as Element, symbols)).toBe(true)
    const link = container.querySelector('.ch10-symbols-link button') as HTMLButtonElement
    expect(link.textContent).toMatch(/本章符號表在最後/)
    expect(container.querySelectorAll('.ch10-symbols-link').length).toBe(1)
    expect(after(link, container.querySelector('#ch10-question') as Element)).toBe(true)
    // HashRouter：不用會改變路由的 href（頁面上沒有任何 href 以 #symbols 結尾的連結）
    expect(container.querySelector('a[href$="#symbols"]')).toBeNull()
    // 符號表不在章首了，開場就地說明會一路用到的記號
    const opening = (container.querySelector('#ch10-question') as HTMLElement).textContent ?? ''
    for (const phrase of [/learning rate/, /comparator 的小訊號增益/, /相關係數/, /還差多少/, /更新矩陣/, /sample 編號/]) expect(opening).toMatch(phrase)
    // 方塊圖（docs/teaching-style.md §8）：章首的 SystemMap + diagrams.ts 登錄的每一張圖（細節在 diagrams.test.tsx）
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(CH10_DIAGRAMS.length + 1)
    expect(Array.from(container.querySelectorAll<HTMLElement>('.ch10-fig')).map((f) => f.dataset.diagram)).toEqual(CH10_DIAGRAMS.map((d) => d.id))
    expect(Array.from(container.querySelectorAll('figure.c-mermaid')).filter((f) => /系統方塊圖/.test(f.getAttribute('aria-label') ?? '')).length).toBe(1)
    expect(container.querySelectorAll('.c-prereq').length).toBeGreaterThanOrEqual(5)
    // 勘誤 E25：標題改為「四種架構比較」
    // （不用 getByRole：jsdom 對含 KaTeX MathML 的 heading 計算 accessible name 時會在 getComputedStyle 崩潰）
    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4')).map((h) => h.textContent ?? '')
    expect(headings.some((t) => /四種架構比較/.test(t))).toBe(true)
    expect(screen.queryByText(/三種架構比較/)).toBeNull()
    // 每個指定勘誤都有標記
    for (const e of ['E05', 'E08', 'E21', 'E22', 'E24', 'E25', 'E37']) {
      expect(container.querySelectorAll(`a.ch10-erratum`).length).toBeGreaterThan(0)
      expect(Array.from(container.querySelectorAll('a.ch10-erratum')).some((a) => a.textContent?.includes(e))).toBe(true)
    }
    expect(container.querySelector('a.ch10-erratum')?.getAttribute('href')).toBe('#/verification')
    // 實驗外框存在、CodeCompare 有六個分頁
    expect(container.querySelector('[data-experiment="mimo-lms"]')).toBeTruthy()
    const tabs = container.querySelectorAll('.c-code-compare .c-code-tab')
    expect(tabs.length).toBe(6)
    // 沒有程式碼 region 錯誤
    expect(container.querySelector('.c-code')).toBeTruthy()
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    // 無 KaTeX 解析錯誤（katex-error 以紅字顯示）
    expect(container.querySelectorAll('.katex-error').length).toBe(0)
    // 帶入手算（docs/teaching-style.md §7）：8 題依序出現在對應推導之後，每題前有一句「換你算」的邀請；綜合題 HC-10.8 在思考題之前
    const hc = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(hc.map((e) => e.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(container.querySelectorAll('.ch10-hand > .ch10-hand-invite').length).toBe(HANDCALCS.length)
    hc.forEach((e) => expect(e.querySelectorAll('.c-step').length, e.id).toBeGreaterThan(0))
    const firstQuiz = container.querySelector('.c-quiz') as HTMLElement
    expect(hc[hc.length - 1].compareDocumentPosition(firstQuiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hc[hc.length - 2].compareDocumentPosition(firstQuiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 每題放在它所屬的段落裡（推導／worked example 的正後方）
    const home: Record<string, string> = {
      'HC-10.1': 'ch10-derive-G',
      'HC-10.2': 'ch10-598',
      'HC-10.3': 'ch10-598',
      'HC-10.4': 'ch10-noise',
      'HC-10.5': 'ch10-regularized',
      'HC-10.6': 'ch10-jacobian',
      'HC-10.7': 'ch10-t18',
      'HC-10.8': 'ch10-synthesis',
    }
    for (const e of hc) expect(e.closest('section.c-section')?.id, e.id).toBe(home[e.id.replace('handcalc-', '')])
    // worker（jsdom 下 inline）完成時域模擬後，KPI 顯示 Case A 的 ρ
    const lab = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(lab, { rho: 0.995, k: 598 }).length).toBeGreaterThan(0), WAIT)
    // KPI 與摘要列的數學都是 KaTeX，不再有 Unicode 拼出來的 ρ(A)、k₉₅、Ĵ
    expect(lab.querySelector('.ch10-kpi-value .katex')).toBeTruthy()
    // TestBadge 的 tooltip 會列出相關測試的標題（例如「…ρ(A) = 1.2（golden T18）」）：那是測試名稱、不是頁面上的數學，所以排除 .c-tip 之後再檢查。
    const labText: string[] = []
    const labWalker = document.createTreeWalker(lab, NodeFilter.SHOW_TEXT)
    for (let node = labWalker.nextNode(); node; node = labWalker.nextNode()) {
      if (!node.parentElement?.closest('.c-tip')) labText.push(node.nodeValue ?? '')
    }
    expect(labText.join('')).toContain('MIMO LMS Lab')
    expect(labText.join('')).not.toMatch(/ρ\(A\) =|k₉₅ =/)
    // 字串屬性裡的 $...$ 都已渲染成 KaTeX（docs/teaching-style.md §3）：指標名稱、假設、圖標題、程式碼標題與附註、先備知識標題
    for (const sel of ['.c-metric-table td', '.c-assumption-list li', '.c-plot-title', '.c-code-title', '.c-code-compare-note', '.c-code-caption', '.c-prereq > summary', '.c-param-label', '.c-param-hint']) {
      expect(container.querySelector(`${sel} .katex`), sel).toBeTruthy()
    }
    // 程式碼區塊以外（原始碼裡的 template literal 本來就有 $），頁面上不應該看到落單的 $，也沒有 KaTeX 錯誤。
    // 直接走訪文字節點（不 clone 整章 DOM：jsdom 下那是數百 MB 的暫時配置）。
    const stray: string[] = []
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue?.includes('$') && !node.parentElement?.closest('pre, code, annotation')) stray.push(node.nodeValue)
    }
    expect(stray).toEqual([])
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    expect(reactWarnings()).toEqual([])
  }, LONG)

  it('T18: ?preset=mimo-gallery12-offdiag-diverge ⇒ J 模式、Case A/B 的 ρ = 1.2 與發散警告，Case C 收斂', async () => {
    const { container } = renderChapter('/ch/10?preset=mimo-gallery12-offdiag-diverge')
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { rho: 1.2 }).length).toBeGreaterThanOrEqual(2), WAIT)
    expect(within(exp).getAllByText(/每個 loop 單獨穩定不代表 MIMO 一起穩定/).length).toBeGreaterThan(0)
    // 警告字串裡的數學已改成 $...$（KaTeX）：比對留下的中文敘述，並確認沒有落單的 $ 與 KaTeX 錯誤
    const jWarn = within(exp).getAllByText(/非正定（mismatched correlator/)
    expect(jWarn.length).toBeGreaterThan(0)
    expect(jWarn[0].querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5)
    expect(jWarn[0].textContent).not.toContain('$')
    expect(exp.querySelectorAll('.katex-error').length).toBe(0)
    expect(kpiPoles(exp, { rho: 0.5, k: 5 }).length).toBe(1)
    // 模型回報的發散原因也是 LaTeX：ρ(I + MJ) = 1.2 ≥ 1、pole 1.2、pole > 1、−J（不再是 Unicode 拼的「ρ(I + MJ) = 1.2000 ≥ 1」）
    const why = shownWarnings(exp).find((w) => w.text.includes('每個 loop 單獨穩定不代表 MIMO 一起穩定'))!
    expect(why.tex).toEqual([String.raw`\rho(\mathbf I+\mathbf M\mathbf J)=1.2000\ge1`, '1.200', '1.200', '>1', String.raw`-\mathbf J`])
    expect(why.text).toContain('代表該模式的更新方向相反')
    expectWarningsTypeset(exp)
  }, LONG)

  it('負面：sequential 陷阱 preset（ρ = 1）⇒ 完整反矩陣以「不可辨識」說明失敗，而非數值錯誤', async () => {
    const { container } = renderChapter('/ch/10?preset=mimo-sequential-trap')
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(within(exp).getAllByText(/不能製造缺失的資訊/).length).toBeGreaterThan(0), WAIT)
    // Plant 的警告：λ_min(R) ≈ 0（數學上是 0，不印 eigen 分解的浮點殘餘）
    const pe = shownWarnings(exp).find((w) => w.text.includes('不可辨識（缺乏 persistent excitation）'))!
    expect(pe.text).toContain('Plant：')
    expect(pe.tex).toEqual([String.raw`\lambda_{\min}(\mathbf R)\approx0`, String.raw`\lambda_{\max}`, '10^{-12}', String.raw`\mathbf v_{\min}`])
    // 完整反矩陣被拒絕的原因
    const full = shownWarnings(exp).find((w) => w.text.includes('不能製造缺失的資訊'))!
    expect(full.tex).toEqual([String.raw`\hat{\mathbf J}`, String.raw`\sigma_{\min}/\sigma_{\max}\le10^{-12}`, String.raw`\lambda_{\min}=0`, String.raw`(K_q\mathbf R)^{-1}`, String.raw`\lambda_{\mathrm{reg}}>0`])
    expectWarningsTypeset(exp)
    // 六種規則的表格「狀態」欄與 Matrix Inspector 也顯示同一個原因：一樣要排成公式，不可以把 `$` 印出來
    const cells = Array.from(exp.querySelectorAll('td.ch10-bad')).filter((td) => (td.textContent ?? '').includes('不能製造缺失的資訊'))
    expect(cells.length).toBeGreaterThan(0)
    for (const td of cells) {
      expect(td.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5)
      expect(td.textContent).not.toContain('$')
    }
  }, LONG)

  it('交叉比對誠實：E24 preset（Ĵ ≠ J，無封閉式）⇒ Analytic = n/a；598 preset ⇒ ok（poles 與 F-10.7 變異皆比對）', async () => {
    const e24 = renderChapter('/ch/10?preset=mimo-jhat-mismatch-e24')
    let exp = e24.container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(within(exp).getAllByText(/（相對誤差 [\d.]+%）：.*封閉式不再成立（勘誤 E24）/).length).toBeGreaterThan(0), WAIT)
    const first = (el: HTMLElement) => el.querySelector('.c-exp-crosscheck .c-check') as HTMLElement
    expect(first(exp).className).toContain('c-check-n/a')
    expect(first(exp).textContent).toMatch(/沒有封閉式可比/)
    e24.unmount()
    const ok = renderChapter('/ch/10?preset=mimo-rho099-598-5-65')
    exp = ok.container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 65 }).length).toBeGreaterThan(0), WAIT)
    expect(first(exp).className).toContain('c-check-ok')
    expect(first(exp).textContent).toMatch(/F-10\.7/)
  }, LONG)

  it('Freeze gain：按「凍結 Freeze」後摘要顯示凍結的 block，再按一次解除', async () => {
    const { container } = renderChapter('/ch/10?preset=mimo-rho099-598-5-65')
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
    fireEvent.click(button(exp, /凍結 Freeze/))
    // 沒有游標時凍結在 active case（Case A，scalar）的 k₉₅ = 598
    await waitFor(() => expect(exp.querySelector('[data-freeze-at="598"]')).toBeTruthy(), WAIT)
    const frozen = exp.querySelector('[data-freeze-at="598"]') as HTMLElement
    expect(frozen.textContent).toMatch(/Freeze gain：.*不再更新/)
    expect(Array.from(frozen.querySelectorAll('annotation')).map((a) => a.textContent)).toEqual(['k\\ge598', '\\mathbf w'])
    fireEvent.click(button(exp, /已凍結 Frozen/))
    await waitFor(() => expect(exp.querySelector('[data-freeze-at]')).toBeNull(), WAIT)
  }, LONG)

  it('Monte Carlo（按 Run）在 jsdom 以 inline worker 完成，交叉比對顯示結果', async () => {
    const { container } = renderChapter('/ch/10?preset=mimo-noise-e37')
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    // 等 preset 生效（預設狀態也有 Full inverse 字樣，所以要等「Case A」變成 Full inverse）
    await waitFor(() => expect(within(exp).getByText('Case A：Full inverse')).toBeTruthy(), WAIT)
    fireEvent.click(button(exp, /執行 Run/))
    await waitFor(() => expect(within(exp).getByText(/穩態分布與 95% 橢圓/)).toBeTruthy(), WAIT)
    expect(within(exp).getAllByText(/mode 2/).length).toBeGreaterThan(0)
  }, LONG)
})

describe('MIMO LMS Lab：參數個數改變時的穩健性（回歸）', () => {
  function renderLab(url = '/ch/10') {
    return render(
      <SettingsProvider>
        <MemoryRouter initialEntries={[url]}>
          <MimoLab />
        </MemoryRouter>
      </SettingsProvider>,
    )
  }
  const errors = () => errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((t: string) => /TypeError|Uncaught|Cannot read/.test(t))

  it('回歸：載入 3×3 preset 時，預設 2×2 的舊時域結果不可拿來畫 δ₃（舊版在此崩潰）；完成後顯示 3 個 eigenvalue 與 119 / 5 / 11', async () => {
    const { container } = renderLab('/ch/10?preset=mimo-3x3-gos-phos-gain')
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 119 }).length).toBeGreaterThan(0), WAIT)
    expect(within(exp).getByText(/2\.214 \/ 0\.7363 \/ 0\.05/)).toBeTruthy()
    expect(kpiPoles(exp, { rho: 0.75, k: 11 }).length).toBe(1)
    expect(errors()).toEqual([])
  }, LONG)

  it('回歸：跑完 2×2 的 Monte Carlo 後把 P 改成 3 ⇒ 舊結果標示過期、表格用結果自己的維度，不崩潰；再改回 2 亦然', async () => {
    const { container } = renderLab('/ch/10?preset=mimo-noise-e37')
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    // 等 preset 真的生效（debounce 之後 Case A 變成 Full inverse、只剩兩個 case）；預設狀態也有 k₉₅ = 5，不能用它判斷
    await waitFor(() => expect(within(exp).getByText('Case A：Full inverse')).toBeTruthy(), WAIT)
    expect(within(exp).queryByText(/^Case C：/)).toBeNull()
    fireEvent.click(button(exp, /執行 Run/))
    await waitFor(() => expect(within(exp).getByText(/穩態分布與 95% 橢圓/)).toBeTruthy(), WAIT)
    // MC 交叉比對：linear 引擎、64 chains ⇒ Var(δ_j) 在 ±4 SE 內
    const mcCheck = exp.querySelectorAll('.c-exp-crosscheck .c-check')[1] as HTMLElement
    expect(mcCheck.className).toContain('c-check-ok')
    const select = within(exp).getByLabelText('參數個數 P') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '1' } }) // 第 2 個選項 = P 3
    await waitFor(() => expect(within(exp).getByText(/參數已改變：下列結果對應舊參數/)).toBeTruthy(), WAIT)
    // 3 個 eigenvalue 出現在 KPI（預設 3×3 的 R：1.99… / … / …）
    await waitFor(() => expect(within(exp).getAllByText(/^[\d.]+ \/ [\d.]+ \/ [\d.]+$/).length).toBeGreaterThan(0), WAIT)
    // 過期的 MC 表仍只有 2 個參數列（結果自己的維度）
    const paramRows = Array.from(exp.querySelectorAll('td')).filter((td) => /^參數/.test(td.textContent ?? '') && td.querySelector('.katex'))
    expect(paramRows.length).toBe(2)
    fireEvent.change(select, { target: { value: '0' } })
    // 改回原參數 ⇒ MC 結果不再過期
    await waitFor(() => expect(within(exp).queryByText(/參數已改變：下列結果對應舊參數/)).toBeNull(), WAIT)
    expect(errors()).toEqual([])
  }, LONG)
})

describe('MIMO LMS Lab：失敗情境要說明原因（負面測試）', () => {
  function renderLab() {
    return render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <MimoLab />
        </MemoryRouter>
      </SettingsProvider>,
    )
  }

  it('負面：把 R₁₂ 改成 1.5（非半正定）⇒ 一則「R 不是半正定」說明、KPI 顯示 Plant 無效、Analytic = n/a；改回 0.5 後恢復且封閉式比對 ok', async () => {
    const { container } = renderLab()
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
    const cell = within(exp).getByLabelText(/第 1 列第 2 行/) as HTMLInputElement
    fireEvent.change(cell, { target: { value: '1.5' } })
    const kpi = exp.querySelector('.ch10-kpi') as HTMLElement
    // 三個 case 的 KPI 都標成 Plant 無效（不是「等待 Ĵ…」）
    await waitFor(() => expect(within(kpi).getAllByText('Plant 無效（見警告）').length).toBe(3), WAIT)
    expect(within(kpi).queryByText(/等待/)).toBeNull()
    // 原因只列一次（時域模擬回報的是同一個原因，不重複）
    const notPsd = shownWarnings(exp).filter((w) => w.text.includes('不是半正定'))
    expect(notPsd.length).toBe(1)
    expect(notPsd[0].tex.slice(0, 2)).toEqual([String.raw`\mathbf R`, String.raw`\lambda_{\min}=-0.5000<0`])
    expect(notPsd[0].tex).toContain(String.raw`|\rho|>1`)
    expectWarningsTypeset(exp)
    const analytic = exp.querySelector('.c-exp-crosscheck .c-check') as HTMLElement
    expect(analytic.className).toContain('c-check-n/a')
    expect(analytic.textContent).toMatch(/Plant 無效/)
    fireEvent.change(cell, { target: { value: '0.5' } })
    // ρ = 0.5、μK_q = 0.5：慢 pole 1 − 0.5·0.5 = 0.75 ⇒ ⌈ln 0.05 / ln 0.75⌉ = 11
    await waitFor(() => expect(kpiPoles(exp, { rho: 0.75, k: 11 }).length).toBe(1), WAIT)
    expect(shownWarnings(exp).some((w) => w.text.includes('不是半正定'))).toBe(false)
    expect((exp.querySelector('.c-exp-crosscheck .c-check') as HTMLElement).className).toContain('c-check-ok')
  }, LONG)

  it('負面：切到 J 模式（預設 T18 的 J）⇒ scalar 說明「更新方向相反」、R 形式 regularized 說明為何不可逆；Analytic 只宣稱比對了有封閉式的 Case B', async () => {
    const { container } = renderLab()
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
    fireEvent.change(within(exp).getByLabelText('模型') as HTMLSelectElement, { target: { value: '1' } })
    await waitFor(() => expect(kpiPoles(exp, { rho: 1.5, k: '∞' }).length).toBe(1), WAIT)
    const shown = shownWarnings(exp)
    // Case A（scalar μK_q = 0.5、T18 的 J）：eig(I + 0.5J) = 1.5、−0.5 ⇒ pole > 1
    const dir = shown.find((w) => w.text.includes('代表該模式的更新方向相反'))!
    expect(dir.text).toContain('Case A（Scalar）：')
    expect(dir.tex).toEqual([String.raw`\rho(\mathbf I+\mathbf M\mathbf J)=1.5000\ge1`, '1.500', '1.500', '>1', String.raw`-\mathbf J`])
    // Case C（R 形式 regularized、λ_reg = 0.1）：R̂ = −J 的 eigenvalue 是 3、−1 ⇒ λ_min + λ_reg = −0.9 < 0
    const reg = shown.find((w) => w.text.includes('必須半正定才適用 R 形式'))!
    expect(reg.tex).toEqual([
      String.raw`\hat{\mathbf R}+\lambda_{\mathrm{reg}}\mathbf I`,
      String.raw`\lambda_{\min}(\hat{\mathbf R})+\lambda_{\mathrm{reg}}=-0.900<0`,
      String.raw`\lambda_{\mathrm{reg}}`,
      String.raw`\hat{\mathbf J}`,
      String.raw`-\hat{\mathbf J}`,
    ])
    expectWarningsTypeset(exp)
    expect(kpiPoles(exp, { rho: 0.5, k: 5 }).length).toBe(1)
    const analytic = exp.querySelector('.c-exp-crosscheck .c-check') as HTMLElement
    expect(analytic.className).toContain('c-check-ok')
    expect(analytic.textContent).toMatch(/只比對 Case B/)
    // J 模式的 eigenvalue 不叫 λ_i（λ_i 保留給 R，勘誤 E22）
    const inspector = exp.querySelector('details.ch10-deriv') as HTMLElement
    expect(inspector.innerHTML).toContain('\\operatorname{eig}(\\mathbf J_n)')
  }, LONG)

  it('審查 R02：J 模式輸入 J_n = [[−1, 2], [0, −1]]（Case A：scalar μK_q = 0.5）⇒ KPI 顯示 ρ(A) = 0.5、k₉₅ = 9（不是 5）；指標列說明 F-10.5 的 5 只是下界；「執行至收斂」停在第 9 個 block', async () => {
    const { container } = renderLab()
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
    fireEvent.change(within(exp).getByLabelText('模型') as HTMLSelectElement, { target: { value: '1' } })
    await waitFor(() => expect(kpiPoles(exp, { rho: 1.5, k: '∞' }).length).toBe(1), WAIT)
    // 把 T18 的 J₂₁ = 2 改成 0：J_n = [[−1, 2], [0, −1]]（合法的 J-mode plant，沒有任何 Plant 警告）
    fireEvent.change(within(exp).getByLabelText('J_n=J/K_q 第 2 列第 1 行') as HTMLInputElement, { target: { value: '0' } })
    await waitFor(() => expect(kpiPoles(exp, { rho: 0.5, k: 9 }).length).toBe(1), WAIT)
    const shown = Array.from(exp.querySelectorAll('.c-exp-warnings .c-callout')).map((c) => c.textContent ?? '')
    expect(shown.some((w) => w.includes('Plant：'))).toBe(false)
    expect(shown.some((w) => w.includes('Case A'))).toBe(false) // 一般的非正規情形不另外發警告（說明在指標列）
    // Case B（完整反矩陣 γ = 0.5）：A = 0.5·I ⇒ 5
    expect(kpiPoles(exp, { rho: 0.5, k: 5 }).length).toBe(1)
    // 指標列：Case A 顯示 9，說明 F-10.5 的 5 只是下界，且不再連到 F-10.5；Case B 照舊連到 F-10.5
    const rows = Array.from(exp.querySelectorAll('.c-metric-table tbody tr'))
    const rowA = rows.find((tr) => (tr.textContent ?? '').includes('Case A 95% 收斂 blocks'))!
    expect(rowA.querySelector('td.num')!.textContent).toBe('9')
    expect(rowA.textContent).toContain('非正規')
    expect(rowA.textContent).toContain('只是下界')
    expect(Array.from(rowA.querySelectorAll('annotation')).map((a) => a.textContent)).toEqual(expect.arrayContaining([String.raw`\|\mathbf A^j\|_2\le0.05`, '5']))
    expect(rowA.querySelector('a[data-formula-link="F-10.5"]')).toBeNull()
    expect(rowA.textContent).toContain('精確')
    const rowB = rows.find((tr) => (tr.textContent ?? '').includes('Case B 95% 收斂 blocks'))!
    expect(rowB.querySelector('td.num')!.textContent).toBe('5')
    expect(rowB.querySelector('a[data-formula-link="F-10.5"]')).toBeTruthy()
    expect(rowB.textContent).not.toContain('下界')
    // 「執行至收斂」：游標移到最慢的 case 的 k₉₅ = 9（修正前會停在 5，那時誤差還有 31%）
    fireEvent.click(button(exp, /執行至收斂/))
    await waitFor(() => expect(exp.querySelector('.ch10-step-cursor')!.textContent).toBe('k = 9'), WAIT)
  }, LONG)
})

describe('Ch10 公式登錄與程式碼 region', () => {
  it.each(['beginner', 'engineer', 'research'] as const)('FORMULAS：ID 唯一、格式 F-10.x，且 %s 模式的頁面上每個 ID 都有對應的 TexBlock 錨點（F-10.x 連結在任何模式都不會失效）', (mode) => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id) => expect(id).toMatch(/^F-10\.\d+$/))
    const { container } = renderChapter('/ch/10', mode)
    for (const id of ids) expect(container.querySelectorAll(`#formula-${id.replace('.', '\\.')}`).length, `${id}（${mode}）`).toBe(1)
    const withErratum = FORMULAS.filter((f) => f.erratumId).map((f) => f.erratumId)
    expect(withErratum).toEqual(expect.arrayContaining(['E05', 'E08', 'E22', 'E24', 'E37']))
  }, LONG)

  it('FORMULAS 的 title／conditions 用 $...$ 寫數學（Formula & Unit Reference 頁以 mathText 顯示）：可渲染、沒有落單的 $、不再用 Unicode 拼公式', () => {
    for (const f of FORMULAS) {
      const { container, unmount } = render(
        <p>
          <MathText>{f.title}</MathText>｜<MathText>{f.conditions}</MathText>
        </p>,
      )
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length, f.id).toBe(0)
      expect(container.textContent, f.id).not.toContain('$')
      unmount()
      const outside = `${f.title} ${f.conditions}`.replace(/\$[^$]*\$/g, '')
      expect(outside, `${f.id} 的 $...$ 以外不應有 Unicode 數學符號`).not.toMatch(/[σμλδγρηξ≤≥≈≪²⁻√πĴᵀ‖]/)
    }
    expect(FORMULAS.filter((f) => f.conditions.includes('$')).length).toBeGreaterThanOrEqual(12)
  })

  it('審查 C01／R02：F-10.5 的條件寫明「代哪個 pole」與「什麼時候才是整個誤差向量的 k₉₅」；公式本身、ID 與 claim 不變', () => {
    const f = FORMULAS.find((x) => x.id === 'F-10.5')!
    expect(f.tex).toBe(String.raw`k_{95}=\left\lceil\frac{\ln 0.05}{\ln|p|}\right\rceil`)
    expect(f.claim).toBe('exact')
    expect(f.title).toBe('95% 衰減所需 block 數（單一模式）')
    // C01：不是「慢模式決定整體」，而是絕對值最大的 pole；scalar LMS 的換手點
    expect(f.conditions).not.toContain('slow mode 決定整體')
    expect(f.conditions).toContain(String.raw`\max_i|p_i|`)
    expect(f.conditions).toContain(String.raw`\mu K_q>2/(\lambda_{\max}+\lambda_{\min})`)
    // R02：整個誤差向量需要 A 正規；非正規時只是下界，改用 ‖A^k‖₂
    expect(f.conditions).toContain('正規矩陣')
    expect(f.conditions).toContain(String.raw`\mathbf A\mathbf A^T=\mathbf A^T\mathbf A`)
    expect(f.conditions).toContain('只是下界')
    expect(f.conditions).toContain(String.raw`\|\mathbf A^k\|_2\le0.05`)
    expect(f.conditions).toContain('不含更新延遲')
    // 沒有為了這件事新增公式 ID（每個登錄的 ID 都要在三種模式有 TexBlock 錨點）
    expect(FORMULAS.length).toBe(15)
  })

  it('mimo.ts 的 core regions 都存在（頁面顯示的就是實際執行的程式碼），且每個規則 region 有一行「← 差異」', () => {
    const regions = listRegions(mimoSrc)
    for (const r of ['mScalar', 'mDiagonal', 'mNlms', 'mFull', 'mRegularized', 'mSequential', 'blockUpdate', 'gmacLinear', 'gmacSample', 'signGmacMean', 'lyapunov', 'centralDiffJacobian']) {
      expect(regions).toContain(r)
    }
    for (const r of ['mScalar', 'mDiagonal', 'mNlms', 'mFull', 'mSequential']) {
      const body = mimoSrc.split(`// #region core:${r}`)[1].split('// #endregion')[0]
      expect(body.match(/← 差異/g)?.length, r).toBe(1)
    }
  })
})

describe('Ch10 符號表：章首的一行連結與章末的 id="symbols"', () => {
  it('按「本章符號表在最後」⇒ 對 #symbols 呼叫 scrollIntoView（不改變路由）；章末的「回到剛才閱讀的位置」捲回按下連結時的位置', () => {
    const scrollIntoView = vi.fn()
    const scrollTo = vi.fn()
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown }
    const original = proto.scrollIntoView
    proto.scrollIntoView = scrollIntoView
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo as unknown as typeof window.scrollTo)
    const scrollYDesc = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { value: 1234, configurable: true })
    try {
      const { container } = render(
        <MemoryRouter initialEntries={['/ch/10']}>
          <SymbolsLink />
          <S7Symbols />
        </MemoryRouter>,
      )
      const before = window.location.href
      const symbols = container.querySelector('#symbols') as HTMLElement
      expect(symbols.querySelector('.c-symbols')).toBeTruthy()
      fireEvent.click(button(container, /本章符號表在最後/))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.instances[0]).toBe(symbols)
      expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: 'start' })
      expect(window.location.href).toBe(before)
      fireEvent.click(button(container, /回到剛才閱讀的位置/))
      expect(scrollTo).toHaveBeenCalledTimes(1)
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 1234 })
      // 符號表的內容沒有變：δ = a − w 的極性註記與 λ_reg 的勘誤都還在
      const tex = Array.from(symbols.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
      expect(tex).toContain('\\boldsymbol\\delta_k=\\mathbf a-\\mathbf w_k')
      expect(tex).toContain('\\lambda_{\\mathrm{reg}}')
      expect(symbols.textContent).toMatch(/全站約定（規格 §0）/)
      expect(symbols.textContent).toMatch(/勘誤 E22/)
    } finally {
      proto.scrollIntoView = original
      scrollToSpy.mockRestore()
      if (scrollYDesc) Object.defineProperty(window, 'scrollY', scrollYDesc)
    }
  })

  it('負面：頁面上沒有 #symbols（或瀏覽器沒有 scrollIntoView）時，按連結不會拋錯', () => {
    const { container } = render(<SymbolsLink />)
    expect(() => fireEvent.click(button(container, /本章符號表在最後/))).not.toThrow()
  })
})

describe('Ch10 MatrixEditor 與 golden 程式碼片段', () => {
  function Harness() {
    const [A, setA] = useState<number[][]>([
      [1, 0.99],
      [0.99, 1],
    ])
    return (
      <>
        <MatrixEditor label={'\\mathbf R'} value={A} onChange={setA} symmetric min={-1} max={4} reg="BEH_R[i][j]" unit="無因次" />
        <output data-testid="val">{JSON.stringify(A)}</output>
      </>
    )
  }

  it('可以逐字輸入負數（"-" → "-0" → "-0." → "-0.5"）：輸入到一半的文字不會被重寫，對稱格同步更新', () => {
    render(<Harness />)
    const cell = screen.getByLabelText('R 第 1 列第 2 行') as HTMLInputElement
    const mirror = screen.getByLabelText('R 第 2 列第 1 行') as HTMLInputElement
    fireEvent.change(cell, { target: { value: '-' } })
    expect(cell.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('val').textContent).toBe('[[1,0.99],[0.99,1]]') // 不是數字 ⇒ 不套用
    fireEvent.change(cell, { target: { value: '-0' } })
    expect(cell.value).toBe('-0') // 舊版會被重寫成 "0"，負號消失
    fireEvent.change(cell, { target: { value: '-0.' } })
    expect(cell.value).toBe('-0.')
    fireEvent.change(cell, { target: { value: '-0.5' } })
    expect(cell.value).toBe('-0.5')
    expect(mirror.value).toBe('-0.5')
    expect(screen.getByTestId('val').textContent).toBe('[[1,-0.5],[-0.5,1]]')
    // 尾端的 0 也保留（"0.50" 與 0.5 數值相同，不重寫）
    fireEvent.change(cell, { target: { value: '0.50' } })
    expect(cell.value).toBe('0.50')
    expect(screen.getByTestId('val').textContent).toBe('[[1,0.5],[0.5,1]]')
  })

  it('負面：超出合法範圍的值不套用並說明原因；失焦後還原顯示', () => {
    render(<Harness />)
    const cell = screen.getByLabelText('R 第 1 列第 2 行') as HTMLInputElement
    fireEvent.change(cell, { target: { value: '9' } })
    expect(screen.getByText(/超出合法範圍 \[-1, 4\]，未套用/)).toBeTruthy()
    expect(screen.getByTestId('val').textContent).toBe('[[1,0.99],[0.99,1]]')
    fireEvent.blur(cell)
    expect(cell.value).toBe('0.99')
    expect(screen.queryByText(/超出合法範圍/)).toBeNull()
  })

  it('goldenSection10：取出的 Python 片段就是 golden/mimo.py 的 §10 段落（含 preconditioner 與 regularized pinv），不含 §9 的函式', () => {
    const py = goldenSection10(mimoPy)
    expect(mimoPy.includes(py)).toBe(true) // 是原始檔的連續片段，不是另外手寫的示意版
    for (const fn of ['def preconditioner_ideal', 'def preconditioned_var_closed', 'def jacobian_loop_matrix', 'def regularized_update_matrix', 'def finite_difference_jacobian']) {
      expect(py).toContain(fn)
    }
    expect(py).not.toContain('def windowed_pe')
    expect(py.length).toBeLessThan(mimoPy.length)
    // 找不到段落標題時退回整個檔案（仍是真實程式碼）
    expect(goldenSection10('x = 1\n')).toBe('x = 1\n')
  })
})

describe('Ch10 圖表與控制項：數學都是 LaTeX（docs/teaching-style.md §3：圖裡面的數學也要用 LaTeX）', () => {
  /**
   * 去掉 KaTeX 之後剩下的文字。另外排除不是「畫面上的數學」的純文字：<option>（選單項目只能是純文字）、TestBadge 的 tooltip（測試標題）、
   * 程式碼、暫存器／行為參數的識別字（`.mono`，例如 BEH_RHO）、按鈕（Case 的「×」是關閉圖示）、
   * 「模擬條件摘要」（匯出 JSON 用的 `名稱: 單位` 純文字，與匯出檔同一份）、以及共用元件 MetricTable 的表頭（「Δ（模擬 − 解析）」不屬於本章）。
   */
  function plainTextOf(root: HTMLElement): string {
    const c = root.cloneNode(true) as HTMLElement
    c.querySelectorAll('.katex, option, .c-tip, pre, code, script, style, svg, .mono, button, .c-exp-summary, .c-metric-table thead').forEach((e) => e.remove())
    return c.textContent ?? ''
  }

  type PlotCall = [unknown, { name?: unknown }[], { xaxis?: { title?: unknown }; yaxis?: { title?: unknown } }]
  const titleOf = (axis?: { title?: unknown }): string | undefined => {
    const t = axis?.title
    return typeof t === 'string' ? t : (t as { text?: string } | undefined)?.text
  }
  /** 傳給 Plotly.react 的（已經過 plotMath 轉換的）軸標題與圖例名稱 */
  function plotted() {
    const calls = P.react.mock.calls as unknown as PlotCall[]
    return {
      x: calls.map((c) => titleOf(c[2]?.xaxis)).filter((t): t is string => !!t),
      y: calls.map((c) => titleOf(c[2]?.yaxis)).filter((t): t is string => !!t),
      names: calls.flatMap((c) => (c[1] ?? []).map((d) => d.name).filter((t): t is string => typeof t === 'string')),
    }
  }
  /** 轉換後的圖上文字不可殘留 TeX（反斜線、大括號、$） */
  function expectTypeset(list: string[], what: string) {
    expect(list.length, what).toBeGreaterThan(0)
    for (const t of list) expect(t, `${what}：${t}`).not.toMatch(/[\\{}$]/)
  }
  function selectByText(root: HTMLElement, label: string, text: RegExp) {
    const sel = within(root).getByLabelText(label) as HTMLSelectElement
    const opt = Array.from(sel.options).find((o) => text.test(o.textContent ?? ''))
    if (!opt) throw new Error(`「${label}」沒有符合 ${String(text)} 的選項`)
    fireEvent.change(sel, { target: { value: opt.value } })
  }

  it('MIMO LMS Lab：每個 Ĵ 來源、每種更新規則、R／J 兩種模型的控制項、指標、KPI 與表格，KaTeX 以外都沒有 Unicode 拼的數學；軸標題與圖例轉成斜體符號與下標', async () => {
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <MimoLab />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
    // 控制項改變後 250 ms 才重算（debounce），時域模擬再由 worker 回傳：等這兩件事都完成再檢查，
    // 否則檢查到的是改變「之前」的畫面（新的警告、Ĵ 來源說明、Matrix Inspector 都還沒出現）。
    const settle = async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 320))
      })
      await waitFor(() => expect(Array.from(exp.querySelectorAll('.c-plot-title')).some((t) => (t.textContent ?? '').includes('計算中'))).toBe(false), WAIT)
    }
    const check = async (what: string) => {
      await settle()
      expect(unicodeMathIn(plainTextOf(exp)), what).toEqual([])
      expect(exp.querySelectorAll('.katex-error, .c-tex-error').length, what).toBe(0)
      // 落單的 `$`（字串沒有經過 mathText）
      const c = exp.cloneNode(true) as HTMLElement
      c.querySelectorAll('.katex, pre, code, .c-exp-summary').forEach((e) => e.remove())
      expect(c.textContent ?? '', what).not.toContain('$')
    }
    await check('預設（R 模型、Case A scalar）')
    // 單位與暫存器名稱：μK_q 的 `× K_q`、`R₁₂` 之類的說明改放進 label／hint，reg 欄只剩暫存器名稱
    expect(Array.from(exp.querySelectorAll('.c-param-reg')).map((e) => e.textContent)).toContain('REG_CAL_MU')
    // 指標表的單位：fs⁻¹ → KaTeX
    const kqRow = Array.from(exp.querySelectorAll('.c-metric-table tr')).find((tr) => /K_q=\\sqrt/.test(tr.querySelector('annotation')?.textContent?.replace(/\s/g, '') ?? ''))
    expect(kqRow?.querySelector('annotation[encoding="application/x-tex"]')).toBeTruthy()
    expect(Array.from(kqRow?.querySelectorAll('annotation') ?? []).map((a) => a.textContent)).toContain('\\mathrm{fs}^{-1}')
    // KPI：K_q 的單位也是 KaTeX
    expect(Array.from(exp.querySelectorAll('.ch10-kpi-value annotation')).map((a) => a.textContent)).toContain('\\mathrm{fs}^{-1}')
    // 矩陣編輯器的大小標示 2×2 與單位
    expect(Array.from(exp.querySelectorAll('.ch10-matrix-head annotation')).map((a) => a.textContent)).toEqual(expect.arrayContaining(['2\\times2']))

    // Case A 的每一種規則
    for (const rule of [/Diagonal/, /Block NLMS/, /Full Preconditioner/, /Regularized/, /Sequential/]) {
      selectByText(exp, 'Case A 規則', rule)
      await check(`Case A：${String(rule)}`)
    }
    // regularized 的兩種形式（單位：R 尺度／J_n² 尺度）
    selectByText(exp, 'Case A 規則', /Regularized/)
    selectByText(exp, 'Regularizer 形式', /^J 形式/)
    await check('Regularized：J 形式')
    expect(Array.from(exp.querySelectorAll('.c-param-unit annotation')).map((a) => a.textContent)).toContain('J_n^2')
    selectByText(exp, 'Regularizer 形式', /^R 形式/)
    expect(Array.from(exp.querySelectorAll('.c-param-unit annotation')).map((a) => a.textContent)).toContain('\\mathbf R')

    // Ĵ 來源
    for (const src of [/^perturbed/, /^finiteDiff/, /^custom/]) {
      selectByText(exp, 'Ĵ 來源', src)
      await check(`Ĵ 來源：${String(src)}`)
      // Ĵ 來源的說明（Matrix Inspector 與最下面的摘要列）是模型回傳的字串：數學要排成公式
      const noteTex = Array.from(exp.querySelectorAll('details.ch10-deriv annotation')).map((a) => a.textContent ?? '')
      if (String(src) === String(/^perturbed/)) expect(noteTex).toEqual(expect.arrayContaining([String.raw`\hat{\mathbf J}=\mathbf J`, String.raw`\varepsilon=0.01`]))
      if (String(src) === String(/^finiteDiff/)) expect(noteTex.some((t) => /^\\Delta=[\d.]+\\ \\mathrm\{fs\}$/.test(t))).toBe(true)
    }
    selectByText(exp, 'Ĵ 來源', /^exact/)
    // J 模型（T18）與 ±1 碼：J 模型預設就是 T18 的 J，Case A（regularized R 形式）被拒絕、警告區有說明
    selectByText(exp, '模型', /^J：/)
    await check('J 模型')
    expect(shownWarnings(exp).length).toBeGreaterThan(0)
    expectWarningsTypeset(exp)
    selectByText(exp, '模型', /^R：/)
    selectByText(exp, 'Regressor 分布', /±1 碼/)
    await check('±1 碼')
    selectByText(exp, '參數個數 P', /^3/)
    await check('P = 3')
    selectByText(exp, '參數個數 P', /^2/)

    // 圖：全部六種規則（‖δ_k‖）、時域軌跡、相平面、poles
    fireEvent.click(within(exp).getByLabelText('同時畫出全部六種規則（同 seed）'))
    await waitFor(() => expect(plotted().y.some((t) => t.includes('‖'))).toBe(true), WAIT)
    const { x, y, names } = plotted()
    expect(x).toEqual(expect.arrayContaining(['block <i>k</i>', '<i>δ</i><sub>1</sub> (fs)', 'Re']))
    expect(y).toEqual(
      expect.arrayContaining(['<i>δ</i><sub><i>k</i>,<i>i</i></sub> = <i>a</i><sub><i>i</i></sub>−<i>w</i><sub><i>k</i>,<i>i</i></sub> (fs)', '‖<i>δ</i><sub><i>k</i></sub>‖ (fs)', '<i>δ</i><sub>2</sub> (fs)', 'Im']),
    )
    expectTypeset([...x, ...y], '軸標題')
    expectTypeset(names, '圖例')
    expect(names).toContain('單位圓 |<i>z</i>| = 1')
    expect(names.some((t) => /^Case A：Scalar <i>δ<\/i><sub>1<\/sub>$/.test(t))).toBe(true)
    expect(names.some((t) => t.includes('<i>E</i>[<i>δ</i><sub>1</sub>]（線性解析）'))).toBe(true)
    await check('六種規則的圖與表')
  }, LONG)

  it('S2、S3 的互動圖與控制項：軸標題、圖例用 LaTeX（k₉₅、ρ、γ、λ_reg）；暫存器欄只剩名稱，單位／說明在 KaTeX 以外沒有 Unicode 拼的數學', async () => {
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <S2UpdateMatrix />
          <S3Noise />
        </MemoryRouter>
      </SettingsProvider>,
    )
    await waitFor(() => expect(plotted().names.some((t) => t.startsWith('一般 LMS（掃'))).toBe(true), WAIT)
    const { x, y, names } = plotted()
    expect(x).toEqual(expect.arrayContaining(['1−<i>ρ</i>（越往左 regressor 越相關）', '<i>k</i><sub>95</sub>（blocks，越左越快）']))
    expect(y).toEqual(expect.arrayContaining(['<i>k</i><sub>95</sub>（blocks）', 'max<sub><i>j</i></sub> std(<i>δ</i><sub><i>j</i></sub>)（fs，越低越安靜）']))
    expect(names).toEqual(
      expect.arrayContaining([
        '一般 LMS（掃 <i>μK</i><sub><i>q</i></sub>）',
        '完整反矩陣（掃 <i>γ</i>）',
        'Regularized（<i>γ</i> = 0.5，掃 <i>λ</i><sub>reg</sub>）',
        '§10.1 例：<i>μK</i><sub><i>q</i></sub> = 0.5 / <i>γ</i> = 0.5 / <i>λ</i><sub>reg</sub> = 0.1',
      ]),
    )
    expect(names.some((t) => /^目前 <i>ρ<\/i> = [\d.]+$/.test(t))).toBe(true)
    expectTypeset([...x, ...y, ...names], 'S2／S3 的圖')
    // 控制項：label／單位／說明／暫存器欄
    const params = Array.from(container.querySelectorAll<HTMLElement>('.c-param'))
    expect(params.length).toBeGreaterThanOrEqual(8)
    for (const el of params) expect(unicodeMathIn(plainTextOf(el)), el.textContent ?? '').toEqual([])
    const regs = Array.from(container.querySelectorAll('.c-param-reg')).map((e) => e.textContent ?? '')
    expect(regs).toEqual(expect.arrayContaining(['BEH_RHO', 'REG_CAL_MU', 'REG_CAL_GAMMA', 'REG_CAL_LAMBDA_REG']))
    for (const r of regs) expect(r, r).toMatch(/^[A-Z0-9_[\]:]+$/)
    // R₁₂ 的對應改放在 ρ 的說明裡
    expect(Array.from(container.querySelectorAll('.c-param-hint annotation')).map((a) => a.textContent)).toEqual(expect.arrayContaining(['\\rho=R_{12}']))
  }, LONG)

  it('plotMath 的對照：圖表字串用到的 TeX 都轉得出來（沒有殘留反斜線／大括號）', () => {
    const samples = [
      String.raw`$\delta_{k,i} = a_i - w_{k,i}$ (fs)`,
      String.raw`$\|\delta_k\|$ (fs)`,
      String.raw`$\max_j\ \operatorname{std}(\delta_j)$（fs）`,
      String.raw`Case A $E[\delta_1]$（線性解析）`,
      String.raw`$\pm2\sigma$ $\delta_2$`,
      String.raw`平均更新方向 $-\mathbf M\mathbf G$（active case）`,
      String.raw`單位圓 $|z| = 1$`,
      String.raw`Case A：Sequential（sweep $\Phi$）`,
    ]
    for (const t of samples) expect(plotMath(t), t).not.toMatch(/[\\{}$]/)
  })
})

describe('Ch10 §10.3：審查 C01（哪個模式最慢）與 R02（A 不對稱時 F-10.5 只是下界）的正文', () => {
  function renderS2(mode: LearningMode) {
    localStorage.setItem('lmspll.mode', mode)
    return render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <S2UpdateMatrix />
        </MemoryRouter>
      </SettingsProvider>,
    )
  }
  const annotations = (root: Element) => Array.from(root.querySelectorAll('annotation')).map((a) => a.textContent ?? '')

  it.each(['beginner', 'engineer'] as const)('C01（%s 模式）：F-10.3 下面寫的是「絕對值最大的 pole」與步長條件，並有 λ_max 模式拖住收斂的例子（−0.8 / 0.4、14 vs 4）', (mode) => {
    const { container } = renderS2(mode)
    const text = container.textContent ?? ''
    expect(text).not.toContain('收斂速度由最小 eigenvalue 決定')
    expect(text).toContain('絕對值最大')
    expect(text).toContain('拖住收斂')
    // 條件就在 F-10.3 的正下方（同一個 Section、不分模式）：一句話 → 展示式 max|p_i| → 步長條件
    const f103 = container.querySelector('#formula-F-10\\.3')!
    const lead = f103.nextElementSibling!
    expect(lead.tagName).toBe('P')
    expect(lead.textContent).toContain('絕對值最大')
    const display = lead.nextElementSibling!
    expect(annotations(display)).toEqual([String.raw`\max_i|p_i|=\max\big(|1-\mu K_q\lambda_{\min}|,\ |1-\mu K_q\lambda_{\max}|\big)`])
    const para = display.nextElementSibling!
    expect(para.tagName).toBe('P')
    const tex = annotations(para)
    expect(tex).toContain(String.raw`\mu K_q\le 2/(\lambda_{\max}+\lambda_{\min})`)
    expect(tex).toContain(String.raw`\mu K_q\le1`)
    expect(para.textContent).toContain('最慢的是最小 eigenvalue 的慢模式')
    // 例子（數字由模型計算：NUM.fastLed）
    const example = para.nextElementSibling!
    expect(annotations(example)).toEqual(expect.arrayContaining([String.raw`\rho=0.5`, String.raw`\lambda=1.5,\ 0.5`, String.raw`\mu K_q=1.2`, String.raw`2/1.5\approx1.333`, String.raw`p=-0.8,\ 0.4`]))
    expect(example.textContent).toContain('只縮到 0.8 倍')
    expect(example.textContent).toContain('0.4 倍')
    // 最佳也只有 (κ−1)/(κ+1)
    const bound = example.nextElementSibling!
    expect(annotations(bound)).toEqual(expect.arrayContaining([String.raw`1-2/\kappa`, String.raw`(\kappa-1)/(\kappa+1)`, String.raw`\kappa=199`]))
    expect(bound.textContent).toContain('最好也只有 0.99')
    // 互動小工具的圖說與「試試看」同步
    const tryit = Array.from(container.querySelectorAll('.ch10-tryit')).map((e) => e.textContent ?? '').join(' ')
    expect(tryit).toContain('14 個 block')
    expect(tryit).toContain('只要 4 個')
    expect(tryit).toContain('−0.8')
    expect(annotations(container)).toEqual(expect.arrayContaining([String.raw`|1-\mu K_q(1+\rho)|`, String.raw`\rho\ge2/(\mu K_q)-1`]))
    // §10.3.1 步驟 2：代的是絕對值最大的 pole
    const f105 = container.querySelector('#formula-F-10\\.5')!
    const step = f105.closest('li')!
    expect(step.textContent).toContain('絕對值最大')
    expect(step.textContent).toContain('一次只算一個模式')
    expect(annotations(step)).toContain(String.raw`|p|=\rho(\mathbf A_{\mathrm{cal}})`)
  }, LONG)

  it('R02：Engineer 模式在 F-10.5 的步驟後面有「A 不對稱時只是下界」的提醒（例子 5 → 9、‖δ₅‖ = 0.314、‖δ₈‖ = 0.0626、‖δ₉‖ = 0.0352）；Beginner 模式不顯示這個框，但仍有「本例對稱」那一句', () => {
    const eng = renderS2('engineer')
    const callout = Array.from(eng.container.querySelectorAll('.c-callout')).find((c) => (c.textContent ?? '').includes('只是下界'))!
    expect(callout).toBeTruthy()
    const tex = annotations(callout)
    expect(tex).toEqual(
      expect.arrayContaining([
        String.raw`\mathbf A\mathbf A^T=\mathbf A^T\mathbf A`,
        String.raw`\|\mathbf A^k\|_2\ge\rho(\mathbf A)^k`,
        String.raw`\mathbf J_n=\begin{bmatrix}-1&2\\0&-1\end{bmatrix}`,
        String.raw`\mathbf A=\mathbf I+\mu K_q\mathbf J_n=\begin{bmatrix}0.5&1\\0&0.5\end{bmatrix}`,
        String.raw`\lceil\ln0.05/\ln0.5\rceil=5`,
        String.raw`\mathbf A^k=\begin{bmatrix}2^{-k}&k\,2^{-(k-1)}\\0&2^{-k}\end{bmatrix}`,
        String.raw`\|\boldsymbol\delta_5\|=0.314`,
        String.raw`\|\boldsymbol\delta_8\|=0.0626`,
        String.raw`\|\boldsymbol\delta_9\|=0.0352`,
        String.raw`\|\mathbf A^k\|_2\le0.05`,
      ]),
    )
    expect(callout.textContent).toContain('9 個 block 才低於 5%')
    expect(callout.textContent).toContain('穩定的判斷不變')
    // 位置：就在 F-10.5 那個步驟清單的後面、表格之前
    const list = eng.container.querySelector('#formula-F-10\\.5')!.closest('ol')!
    expect(list.compareDocumentPosition(callout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    eng.unmount()

    const beg = renderS2('beginner')
    expect(Array.from(beg.container.querySelectorAll('.c-callout')).some((c) => (c.textContent ?? '').includes('只是下界'))).toBe(false)
    expect(beg.container.querySelector('#formula-F-10\\.5')!.closest('li')!.textContent).toContain('是對稱矩陣')
  }, LONG)

  it('R02：Lab 指標列的說明與「算不完只列下界」的警告都用 LaTeX 寫數學（可渲染、沒有落單的 $、KaTeX 以外沒有 Unicode 拼的數學）', () => {
    const cfg = (r: Partial<typeof DEFAULT_RULE>) => ({ ...DEFAULT_RULE, ...r })
    const pj = buildPlant({ mode: 'J', Jn: [[-1, 2], [0, -1]], sigmaV: 100, N: 4096 }) // prettier-ignore
    const slow = buildPlant({ mode: 'J', Jn: [[-1, 100], [0, -1]], sigmaV: 100, N: 4096 }) // prettier-ignore
    const pr = buildPlant({ mode: 'R', R: [[1, 0.99], [0.99, 1]], sigmaV: 100, N: 4096 }) // prettier-ignore
    const nn = analyzeRule(pj, cfg({ rule: 'scalar', muKq: 0.5 }), pj.Jn)
    const lb = analyzeRule(slow, cfg({ rule: 'scalar', muKq: 1e-5 }), slow.Jn)
    const seq = analyzeRule(pr, cfg({ rule: 'sequential', gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 1000 }), pr.Jn)
    expect(lb.blocks95Basis).toBe('lower-bound')
    expect(lb.warnings.length).toBe(1)
    const texts = [k95Metric('A', nn), k95Metric('B', lb), k95Metric('C', seq)].flatMap((m) => [m.name, m.note ?? '']).concat(lb.warnings)
    for (const t of texts) {
      const { container, unmount } = render(
        <p>
          <MathText>{t}</MathText>
        </p>,
      )
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length, t).toBe(0)
      expect(container.textContent, t).not.toContain('$')
      container.querySelectorAll('.katex').forEach((e) => e.remove())
      expect(unicodeMathIn(container.textContent ?? ''), t).toEqual([])
      unmount()
    }
  })
})


describe('收尾：技術審查 R06a 的 Ch10 部分——pole 公式屬於線性模型，1-bit 時是小訊號區的局部結果', () => {
  const byId = (id: string) => FORMULAS.find((f) => f.id === id)!
  const annotations = (root: Element) => Array.from(root.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
  function renderS2(mode: LearningMode) {
    localStorage.setItem('lmspll.mode', mode)
    return render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <S2UpdateMatrix />
        </MemoryRouter>
      </SettingsProvider>,
    )
  }

  it('公式登錄：F-10.3 與第 9 章 F-09.4 是同一條 pole 公式，使用條件要寫出「線性模型／1-bit 小訊號」；其餘由 A_cal 算 pole 的公式也都帶這個條件；claim 不變', () => {
    const f3 = byId('F-10.3')
    expect(f3.claim).toBe('exact')
    expect(f3.tex).toBe(String.raw`p_i=1-\mu K_q\lambda_i(\mathbf R),\qquad 0<\mu K_q<\frac{2}{\lambda_{\max}}`)
    expect(f3.conditions).toContain('指定模型是 F-10.2 的線性遞迴')
    expect(f3.conditions).toContain('F-09.4')
    expect(f3.conditions).toContain(String.raw`1-bit comparator 時 $p_i$ 只是小訊號區（$|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v$，F-10.1）的局部 pole`)
    expect(f3.conditions).toContain('F-10.13')
    // F-10.2：等號屬於線性模型；1-bit 時繼承 F-10.1 的小訊號條件（初始誤差與穩態抖動都要成立）
    const f2 = byId('F-10.2')
    expect(f2.claim).toBe('exact')
    expect(f2.conditions).toContain('線性模型裡，本式是精確的代數')
    expect(f2.conditions).toContain(String.raw`F-10.1 的小訊號近似（$|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v$`)
    expect(f2.conditions).toContain('穩態抖動')
    // 其餘 pole／k₉₅ 公式：一句話指回 F-10.1 的小訊號條件
    for (const id of ['F-10.4', 'F-10.5', 'F-10.8', 'F-10.10', 'F-10.12']) {
      const f = byId(id)
      expect(f.claim, id).toBe('exact')
      expect(f.conditions, id).toMatch(/1-bit[^。]*小訊號區（F-10\.1）/)
    }
    // 小訊號近似本身（F-10.1）與 Bussgang 精確式（F-10.13）的標籤不變
    expect(byId('F-10.1').claim).toBe('approx')
    expect(byId('F-10.13').claim).toBe('exact')
  })

  it.each(['beginner', 'engineer'] as const)('頁面（%s 模式）：F-10.2 與 F-10.3 之間說明等號屬於線性模型、1-bit 只在小訊號區；F-10.3 的標籤與實體 K_q 那三列也寫出條件', (mode) => {
    const { container } = renderS2(mode)
    const note = container.querySelector('#ch10-linear-model-note') as HTMLElement
    expect(note).toBeTruthy()
    const f2 = container.querySelector('#formula-F-10\\.2')!
    const f3 = container.querySelector('#formula-F-10\\.3')!
    expect(f2.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(f3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(annotations(note)).toEqual(expect.arrayContaining([String.raw`\approx`, String.raw`\mathbf G=K_q\mathbf R\boldsymbol\delta+\boldsymbol\eta`, String.raw`|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v`]))
    expect(note.textContent).toContain('只是小訊號區的局部結果')
    expect(note.querySelector('.c-claim-approx')).toBeTruthy()
    // 多小才算小（Engineer 以上）：s_δ = 0.1 / 0.3 / 1 ⇒ 增益少 0.5% / 4.2% / 29%（1 − 1/√(1 + s_δ²)，由 signGmacMean 算）
    const detail = note.nextElementSibling as HTMLElement
    if (mode === 'engineer') {
      expect(annotations(detail)).toEqual(
        expect.arrayContaining([String.raw`s_\delta=\sqrt{\boldsymbol\delta^T\mathbf R\boldsymbol\delta}/\sigma_v`, String.raw`K_q/\sqrt{1+s_\delta^2}`, String.raw`s_\delta=0.1`, String.raw`s_\delta=0.3`, String.raw`s_\delta=1`]),
      )
      expect(detail.textContent).toContain('少 0.5%')
      expect(detail.textContent).toContain('4.2%')
      expect(detail.textContent).toContain('少 29%')
      expect(detail.textContent).toContain('穩態抖動')
    } else {
      expect(container.textContent).not.toContain('多小才算小')
    }
    // F-10.3 的標籤（公式正下方，所有模式）
    expect(f3.querySelector('figcaption')!.textContent).toBe('Scalar LMS 的模式 pole 與穩定範圍（線性模型的 mean recursion；1-bit 時是小訊號區的局部 pole）')
    // §10.3.1 的表：實體 K_q 的 75,091 / 750 / 5 是 1-bit 小訊號的數字
    const phys = container.querySelector('#ch10-phys-kq-note') as HTMLElement
    expect(phys.querySelector('.c-claim-approx')).toBeTruthy()
    expect(phys.textContent).toContain('75,091、750、5')
    expect(annotations(phys)).toContain(String.raw`|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v=100\ \mathrm{fs}`)
    expect(phys.textContent).toContain('單位換算本身是精確的算術')
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
  }, LONG)
})

describe('收尾：技術審查 R07 的 Ch10 部分——λ₁ = 1 + ρ 是「快」只在 ρ ≥ 0 時成立', () => {
  const annotations = (root: Element) => Array.from(root.querySelectorAll('annotation')).map((a) => a.textContent ?? '')

  it('圖 eigen-modes 的圖說、看圖說明與章首的先備知識都寫出 ρ ≥ 0 的條件與 ρ < 0 時對調；Lab 的 ρ₁₂ 說明用 |ρ₁₂| = 1', async () => {
    const cap = diagram('eigen-modes').caption
    expect(cap).toContain(String.raw`圖畫的是 $\rho\ge0$：共模（綠）快，差模（紅）慢`)
    expect(cap).toContain(String.raw`$\rho<0$ 時兩者對調`)
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <S0Intro />
          <S2UpdateMatrix />
          <MimoLab />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const fig = container.querySelector('[data-diagram="eigen-modes"]') as HTMLElement
    const walk = fig.querySelector('.ch10-fig-walk') as HTMLElement
    expect(annotations(fig.querySelector('.ch10-fig-caption')!)).toEqual([String.raw`\rho\ge0`, String.raw`\rho<0`])
    expect(annotations(walk)).toEqual(expect.arrayContaining([String.raw`\rho\ge0`, String.raw`\lambda_1=1+\rho`, String.raw`\lambda_2=1-\rho`, String.raw`\rho<0`, String.raw`\lambda_{\max,\min}=1\pm|\rho|`]))
    expect(walk.textContent).toContain('差模快、共模慢')
    // 章首先備知識：配對對任何 ρ 成立，哪個較大看正負號；本章正文的例子都取 ρ ≥ 0
    const prereq = Array.from(container.querySelectorAll('.c-prereq')).find((p) => (p.textContent ?? '').includes('共模'))!
    expect(annotations(prereq)).toEqual(expect.arrayContaining([String.raw`\lambda_{\max}=\lambda_1`, String.raw`\lambda_{\max}=\lambda_2`, String.raw`\lambda_{\max,\min}=1\pm|\rho|`]))
    expect(prereq.textContent).toContain('本章正文的例子都取')
    // Lab 的 ρ₁₂ 滑桿範圍是 [−1, 1]：不可辨識的條件是 |ρ₁₂| = 1
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    expect(Array.from(exp.querySelectorAll('.c-param-hint annotation')).map((a) => a.textContent)).toEqual(expect.arrayContaining([String.raw`|\rho_{12}|=1\Rightarrow\lambda_{\min}=0`]))
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
  }, LONG)

  it('數字：ρ = −0.5 時 λ_max = 1.5 屬於差模 (1, −1)/√2，μK_q = 0.5 的 pole 是差模 0.25（快）、共模 0.75（慢）；ρ = +0.5 相反', () => {
    for (const [rho, fastIsDiff] of [[-0.5, true], [0.5, false]] as const) {
      const plant = buildPlant({ mode: 'R', R: [[1, rho], [rho, 1]], sigmaV: 100, N: 4096 }) // prettier-ignore
      expect(plant.modeValues[0]).toBeCloseTo(1.5, 12)
      expect(plant.modeValues[1]).toBeCloseTo(0.5, 12)
      // λ_max 的 eigenvector：兩個分量同號 = 共模，異號 = 差模
      const vmax = [plant.modeBasis[0][0], plant.modeBasis[1][0]]
      expect(Math.abs(vmax[0])).toBeCloseTo(Math.SQRT1_2, 12)
      expect(Math.sign(vmax[0] * vmax[1])).toBe(fastIsDiff ? -1 : 1)
      const an = analyzeRule(plant, { ...DEFAULT_RULE, rule: 'scalar', muKq: 0.5 }, plant.Jn)
      expect(an.closedPoles![0]).toBeCloseTo(0.25, 12) // λ_max 的模式：快
      expect(an.closedPoles![1]).toBeCloseTo(0.75, 12) // λ_min 的模式：慢
    }
  })
})

describe('收尾：版面與顯示——手機不橫向溢出、數學上是 0 的量不印浮點殘餘', () => {
  it('並排的兩張圖（poles／相平面）：欄位比 340px 窄時下限改成欄寬，不把 375px 的頁面撐寬', () => {
    // vitest 不處理 CSS（`?raw` 匯入拿到的是空字串），所以直接讀檔
    const chapterCss = readFileSync(resolve(process.cwd(), 'src/chapters/ch10/chapter.css'), 'utf8')
    expect(chapterCss).toContain('grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));')
    expect(chapterCss).not.toContain('minmax(340px, 1fr)')
    expect(chapterCss).toMatch(/\.ch10-plot-pair > \* \{\s*min-width: 0;/)
  })

  it('chop／texMat：pole 與 A = I + MJ 的浮點殘餘顯示成 0；真正的小數不受影響', () => {
    expect(chop(1.11e-16)).toBe(0)
    expect(chop(-8.33e-17)).toBe(0)
    expect(chop(5.68e-14)).toBe(0)
    expect(chop(1e-9)).toBe(1e-9)
    expect(chop(-0.5)).toBe(-0.5)
    // deadbeat 的 A（ρ = 0.8、γ = 1 算出來的樣子）：整個矩陣都是殘餘，要給量級 1 才清得掉
    const dust = [[-2.22e-16, 0], [4.44e-16, 0]] // prettier-ignore
    expect(texMat(dust, 4, 1)).toBe(String.raw`\begin{bmatrix}0&0\\0&0\end{bmatrix}`)
    // 不給量級時維持原來的相對判斷（比最大元素小 12 個數量級才清）
    expect(texMat([[1, 8.7e-19], [0.25, 1]], 4)).toBe(String.raw`\begin{bmatrix}1&0\\0.25&1\end{bmatrix}`) // prettier-ignore
    expect(texMat([[2e-13, 0], [0, 1e-13]], 4)).toBe(String.raw`\begin{bmatrix}2\times10^{-13}&0\\0&1\times10^{-13}\end{bmatrix}`) // prettier-ignore
  })

  it('Lab：R₁₂ = 0.8、完整反矩陣 γ = 1（deadbeat）⇒ KPI 是 ρ(A) = 0、k₉₅ = 1，Matrix Inspector 的 A 與 poles 都是 0（模型算出的 −2.2e−16 不印出來）', async () => {
    // 模型的數值沒有被改：殘餘仍在（顯示層才清掉）
    const plant = buildPlant({ mode: 'R', R: [[1, 0.8], [0.8, 1]], sigmaV: 100, N: 4096 }) // prettier-ignore
    const an = analyzeRule(plant, { ...DEFAULT_RULE, rule: 'full', gamma: 1 }, plant.Jn)
    expect(an.spectralRadius).toBeGreaterThan(0)
    expect(an.spectralRadius).toBeLessThan(1e-12)
    expect(an.blocks95).toBe(1)

    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <MimoLab />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
    fireEvent.change(within(exp).getByLabelText(/第 1 列第 2 行/) as HTMLInputElement, { target: { value: '0.8' } })
    const ruleSel = within(exp).getByLabelText('Case A 規則') as HTMLSelectElement
    const full = Array.from(ruleSel.options).find((o) => /Full Preconditioner/.test(o.textContent ?? ''))!
    fireEvent.change(ruleSel, { target: { value: full.value } })
    fireEvent.change(within(exp).getByLabelText('γ（目標 loop gain）') as HTMLInputElement, { target: { value: '1' } })
    await waitFor(() => expect(kpiPoles(exp, { rho: 0, k: 1 }).length).toBe(1), WAIT)
    const inspector = exp.querySelector('details.ch10-deriv') as HTMLElement
    expect(Array.from(inspector.querySelectorAll('annotation')).map((a) => a.textContent)).toContain(String.raw`\mathbf A=\mathbf I+\mathbf M\mathbf J=\begin{bmatrix}0&0\\0&0\end{bmatrix}`)
    expect(inspector.textContent).toContain('poles：0、0')
    expect(inspector.textContent).toContain('：0、0 ') // 封閉式 1 − γ = 0
    // KPI、Matrix Inspector、六種規則的表：沒有 e−16 或 10^{−16} 之類的殘餘
    const table = exp.querySelector('.ch10-hl')!.closest('table') as HTMLElement
    for (const el of [exp.querySelector('.ch10-kpi') as HTMLElement, inspector, table]) {
      expect(el.textContent ?? '').not.toMatch(/e[-−]1\d/)
      for (const t of Array.from(el.querySelectorAll('annotation')).map((a) => a.textContent ?? '')) expect(t, t).not.toMatch(/10\^\{-1\d\}/)
    }
    // 指標列：ρ(I + MJ) 的模擬值與解析值都是 0
    const row = Array.from(exp.querySelectorAll('.c-metric-table tbody tr')).find((tr) => (tr.textContent ?? '').includes('Case A') && (tr.textContent ?? '').includes('Full inverse'))!
    expect(row.querySelector('td.num')!.textContent).toBe('0')
    expect(row.textContent ?? '').not.toMatch(/e[-−]1\d/)
  }, LONG)
})
