import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, type LearningMode } from '@/app/settings'
import { MathText, listRegions } from '@/components'
import mimoSrc from '@/simulation/models/mimo.ts?raw'
import { useState } from 'react'
import mimoPy from '../../../golden/lms_pll_golden/mimo.py?raw'
import Chapter10 from './index'
import { FORMULAS } from './formulas'
import { goldenSection10 } from './common'
import { HANDCALCS } from './handcalcs'
import { MatrixEditor } from './experiments/MatrixEditor'
import { MimoLab } from './experiments/MimoLab'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

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
    expect(container.querySelector('.c-symbols')).toBeTruthy()
    expect(container.querySelectorAll('.c-quiz').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelector('.c-recap')).toBeTruthy()
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
    expect(lab.textContent).not.toMatch(/ρ\(A\) =|k₉₅ =/)
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
  }, LONG)

  it('負面：sequential 陷阱 preset（ρ = 1）⇒ 完整反矩陣以「不可辨識」說明失敗，而非數值錯誤', async () => {
    const { container } = renderChapter('/ch/10?preset=mimo-sequential-trap')
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(within(exp).getAllByText(/不能製造缺失的資訊/).length).toBeGreaterThan(0), WAIT)
    expect(within(exp).getAllByText(/λ_min\(R\) = .* ≈ 0：不可辨識/).length).toBeGreaterThan(0)
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
    expect(within(exp).getAllByText(/R 不是半正定：λ_min = -0\.5000 < 0/).length).toBe(1)
    const analytic = exp.querySelector('.c-exp-crosscheck .c-check') as HTMLElement
    expect(analytic.className).toContain('c-check-n/a')
    expect(analytic.textContent).toMatch(/Plant 無效/)
    fireEvent.change(cell, { target: { value: '0.5' } })
    // ρ = 0.5、μK_q = 0.5：慢 pole 1 − 0.5·0.5 = 0.75 ⇒ ⌈ln 0.05 / ln 0.75⌉ = 11
    await waitFor(() => expect(kpiPoles(exp, { rho: 0.75, k: 11 }).length).toBe(1), WAIT)
    expect(within(exp).queryByText(/R 不是半正定/)).toBeNull()
    expect((exp.querySelector('.c-exp-crosscheck .c-check') as HTMLElement).className).toContain('c-check-ok')
  }, LONG)

  it('負面：切到 J 模式（預設 T18 的 J）⇒ scalar 說明「更新方向相反」、R 形式 regularized 說明為何不可逆；Analytic 只宣稱比對了有封閉式的 Case B', async () => {
    const { container } = renderLab()
    const exp = container.querySelector('[data-experiment="mimo-lms"]') as HTMLElement
    await waitFor(() => expect(kpiPoles(exp, { k: 598 }).length).toBeGreaterThan(0), WAIT)
    fireEvent.change(within(exp).getByLabelText('模型') as HTMLSelectElement, { target: { value: '1' } })
    await waitFor(() => expect(kpiPoles(exp, { rho: 1.5, k: '∞' }).length).toBe(1), WAIT)
    expect(within(exp).getAllByText(/pole > 1 代表該模式的更新方向相反/).length).toBeGreaterThan(0)
    expect(within(exp).getAllByText(/−Ĵ 必須半正定才適用 R 形式/).length).toBeGreaterThan(0)
    expect(kpiPoles(exp, { rho: 0.5, k: 5 }).length).toBe(1)
    const analytic = exp.querySelector('.c-exp-crosscheck .c-check') as HTMLElement
    expect(analytic.className).toContain('c-check-ok')
    expect(analytic.textContent).toMatch(/只比對 Case B/)
    // J 模式的 eigenvalue 不叫 λ_i（λ_i 保留給 R，勘誤 E22）
    const inspector = exp.querySelector('details.ch10-deriv') as HTMLElement
    expect(inspector.innerHTML).toContain('\\operatorname{eig}(\\mathbf J_n)')
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
