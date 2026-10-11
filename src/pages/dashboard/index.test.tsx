import { fireEvent, waitFor, within } from '@testing-library/react'
import { ROUTES, QUESTIONS, SIX_CONDITIONS } from './data'
import { galleryPresets } from './sections/Gallery'
import { DASH_SYMBOLS } from './sections/Symbols'
import { DASH_CHARTS, DASH_SYSTEM_FOCUS } from './diagrams'
import { precedes, plainText, renderPage, texIn } from './indexTestUtils'
import { summarizeErrata } from './summaries'
import { systemMapModel } from '@/components'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) } }))

// vi.fn() 會把每次呼叫的引數整份留在 mock.calls 裡；Plot 每次都把整張圖的資料（上千點的陣列）交給 P.react，所以每個測試之後清掉呼叫紀錄
afterEach(() => {
  P.react.mockClear()
  P.purge.mockClear()
  P.toImage.mockClear()
  P.downloadImage.mockClear()
})

// 整頁約 5 萬個 DOM 節點（KaTeX），jsdom 首次渲染需數秒；其他 agent 同時跑測試時更慢
vi.setConfig({ testTimeout: 60_000 })


/**
 * 符號表在頁末（docs/teaching-style.md §5）：全頁只有一張，包在 id="symbols" 裡，是頁面的最後一個區塊（在頁尾說明之後）；
 * 頁首（系統地圖那一節）只留一行按鈕。整頁約 2 萬個 DOM 節點，再多渲染一次會讓 jsdom 記憶體吃緊，所以和 smoke test 共用同一次渲染。
 */
function expectSymbolsAtEnd(container: HTMLElement) {
  const page = container.querySelector('.dash') as HTMLElement
  const symbols = container.querySelector('#symbols') as HTMLElement
  expect(symbols).not.toBeNull()
  expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
  expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(DASH_SYMBOLS.length)
  expect(page.lastElementChild).toBe(symbols)
  expect(symbols.lastElementChild?.classList.contains('c-symbols')).toBe(true)
  expect(precedes(container.querySelector('#dash-recap'), symbols)).toBe(true)
  expect(precedes(container.querySelector('.dash-footnote'), symbols)).toBe(true)
  expect(symbols.querySelector('h2')?.textContent).toBe('本頁符號表')
  // 「一條方程式」那一節裡不再有符號表
  expect(container.querySelector('#dash-spine .c-symbols')).toBeNull()
  // 頁首只留一行「本頁符號表在最後 ↓」：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），在第一個內容區塊（系統地圖）裡
  const jump = container.querySelector('.dash-symbols-jump button') as HTMLButtonElement
  expect(jump.textContent).toBe('本頁符號表在最後 ↓')
  expect(container.querySelectorAll('.dash-symbols-jump')).toHaveLength(1)
  expect(jump.closest('a')).toBeNull()
  expect(container.querySelector('a[href*="#symbols"]')).toBeNull()
  expect(jump.closest('#dash-map')).toBeTruthy()
  expect(precedes(jump, container.querySelector('#dash-spine'))).toBe(true)
  // 按下去捲到頁末的 #symbols；符號表旁的「回到頁首」捲回頁首（jsdom 沒有 scrollIntoView，這裡裝一個假的）
  const down = vi.fn()
  const up = vi.fn()
  symbols.scrollIntoView = down
  ;(container.querySelector('#dash-title') as HTMLElement).scrollIntoView = up
  fireEvent.click(jump)
  expect(down).toHaveBeenCalledTimes(1)
  fireEvent.click(within(symbols).getByRole('button', { name: /回到頁首/ }))
  expect(up).toHaveBeenCalledTimes(1)
}

/** 方塊圖（docs/teaching-style.md §8）：四張（系統地圖＋本頁的三張）依序出現，有圖說與替代文字，放在對應的文字說明之後、推導之前。 */
function expectDiagrams(container: HTMLElement) {
  const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
  expect(figs).toHaveLength(1 + DASH_CHARTS.length)
  for (const f of figs) {
    const cap = f.querySelector('figcaption')?.textContent ?? ''
    expect(cap.length, cap).toBeGreaterThan(20)
    expect(cap, cap).not.toMatch(/\$/)
    expect((f.getAttribute('aria-label') ?? '').length).toBeGreaterThan(20)
  }
  const [map, flowFig, loopFig, eqFig] = figs
  // 第一張是共用的系統地圖：手排的 SVG（figure.c-sysmap），不是 Mermaid；首頁談整個系統，所以所有方塊都是主角（is-focus）
  expect(map.classList.contains('c-sysmap')).toBe(true)
  const expected = systemMapModel(DASH_SYSTEM_FOCUS).blocks
  const drawn = Array.from(map.querySelectorAll('g.c-sysmap-block'))
  expect(drawn.map((b) => b.getAttribute('data-block')).sort()).toEqual(expected.map((b) => b.id).sort())
  expect(map.querySelectorAll('g.c-sysmap-block.is-focus')).toHaveLength(expected.length)
  expect(drawn.every((b) => b.getAttribute('data-focus') === 'true')).toBe(true)
  // 另外三張是 Mermaid（這個測試把 mermaid mock 掉了，所以只有外框與圖說）：外框裡沒有 .c-mermaid-svg 是正常的
  for (const f of [flowFig, loopFig, eqFig]) expect(f.classList.contains('c-sysmap'), f.getAttribute('aria-label') ?? '').toBe(false)
  // 順序：系統地圖（#dash-map）→ 六個條件的檢查流程（#dash-thesis）→ 條件在迴路上的位置、block 方程式（#dash-spine）
  expect((container.querySelector('#dash-map') as HTMLElement).contains(map)).toBe(true)
  expect((container.querySelector('#dash-thesis') as HTMLElement).contains(flowFig)).toBe(true)
  const spine = container.querySelector('#dash-spine') as HTMLElement
  expect(spine.contains(loopFig) && spine.contains(eqFig)).toBe(true)
  expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
  expect(flowFig.getAttribute('aria-label')).toContain('六個條件的檢查流程')
  expect(loopFig.getAttribute('aria-label')).toContain('六個條件分別標在')
  expect(eqFig.getAttribute('aria-label')).toContain('線性化 block 方程式')
  // 圖在它的推導之前：檢查流程在六張條件卡片之前；位置圖與 block 方程式在第一個逐步推導（details）之前
  expect(precedes(flowFig, container.querySelector('#dash-cond-identifiability'))).toBe(true)
  expect(precedes(loopFig, eqFig) && precedes(eqFig, spine.querySelector('details.dash-details'))).toBe(true)
  // 檢查流程與 block 方程式各有「怎麼讀」導讀，並用 KaTeX 把圖上的名字對回公式
  for (const f of [flowFig, eqFig]) expect(f.closest('.dash-diagram')?.querySelector('.dash-diagram-walk .katex'), f.getAttribute('aria-label') ?? '').toBeTruthy()
}

describe('DashboardPage（jsdom smoke）', () => {
  it('渲染不出錯：Hero、從這裡開始（/ch/00）、六個條件、三條路線、15 題、模式、勘誤；四張方塊圖與頁末的符號表', async () => {
    const { container } = renderPage()
    const hero = container.querySelector('.dash-hero') as HTMLElement
    expect(within(hero).getByRole('heading', { level: 1, name: /LMS × Fractional-N PLL Calibration Lab/ })).toBeTruthy()
    const start = within(hero).getByRole('link', { name: /開始第一課/ })
    expect(start.getAttribute('href')).toBe('/ch/00')
    // 手算表：w1 = 1.8、w2 = 2.28（由 runScalarLms 算出）
    expect(container.querySelector('.dash-start')?.textContent).toMatch(/1\.8/)
    expect(container.querySelector('.dash-start')?.textContent).toMatch(/2\.28/)
    expect(container.querySelectorAll('.dash-cond-card')).toHaveLength(SIX_CONDITIONS.length)
    expect(container.querySelectorAll('.dash-route')).toHaveLength(ROUTES.length)
    expect(container.querySelectorAll('.dash-q')).toHaveLength(QUESTIONS.length)
    expect(container.querySelectorAll('.dash-mode')).toHaveLength(3)
    // 勘誤數與 errata.json 一致，並連到 /verification
    const e = summarizeErrata()
    expect(within(container.querySelector('#dash-verify') as HTMLElement).getByText(`規格勘誤 ${e.total} 項`)).toBeTruthy()
    expect(container.querySelectorAll('a[href^="/verification"]').length).toBeGreaterThan(3)
    // 「勘誤 Exx」深連結到驗證頁的那一條；T-id 深連結到驗收列
    expect(container.querySelector('a.dash-erratum[href="/verification?e=E01"]')).toBeTruthy()
    expect(container.querySelector('#dash-verify a[href="/verification?t=T13"]')).toBeTruthy()
    // 條件在迴路上的位置圖（Mermaid）與六個條件的圖例
    const spine = container.querySelector('#dash-spine') as HTMLElement
    expect(spine.querySelector('.c-mermaid')).toBeTruthy()
    expect(spine.querySelectorAll('.dash-legend-table tbody tr')).toHaveLength(6)
    // 12 個必備實驗：由 preset 註冊表彙整，連結帶 ?preset=
    const gal = container.querySelector('#dash-gallery') as HTMLElement
    const presets = galleryPresets()
    expect(gal.querySelectorAll('.dash-gal-card')).toHaveLength(presets.length)
    if (presets.length > 0) expect(gal.querySelector('.dash-gal-link')?.getAttribute('href')).toBe(`${presets[0].page}?preset=${presets[0].id}`)
    // 方塊圖與頁末的符號表（兩個 helper 見上）
    expectDiagrams(container)
    expectSymbolsAtEnd(container)
    // KaTeX 有渲染（數學一律 LaTeX）
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(50)
    // 圖表呼叫 Plotly
    await waitFor(() => expect(P.react).toHaveBeenCalled())
  })

  it('符號表的內容：每個符號與單位的 TeX 都能解析，符號不重複（React key）', async () => {
    const katex = (await import('katex')).default
    for (const r of DASH_SYMBOLS) {
      expect(() => katex.renderToString(r.symbol, { throwOnError: true, strict: 'ignore' }), r.symbol).not.toThrow()
      if (r.unit) expect(() => katex.renderToString(r.unit as string, { throwOnError: true, strict: 'ignore' }), r.unit).not.toThrow()
    }
    expect(new Set(DASH_SYMBOLS.map((r) => r.symbol)).size).toBe(DASH_SYMBOLS.length)
  })

  it('路線步驟由 registry 組成，每一步都是可點擊的章節連結', () => {
    const { container } = renderPage()
    const route = container.querySelector('.dash-route') as HTMLElement
    const links = within(route).getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(ROUTES[0].steps.length)
    expect(links[0].getAttribute('href')).toBe('/ch/01')
  })

  // 注意：整頁有約 2 萬個 DOM 節點（KaTeX 的 HTML + MathML），document 層級的 getByRole / getByLabelText 會非常慢，
  // 因此以下一律先用 querySelector 找到段落，再在段落內查詢。
  it('預設（T13）六個條件全部通過；改成 φ = 120° 後極性燈號變成未通過並顯示原因', async () => {
    const { container } = renderPage('engineer')
    const polarityCard = container.querySelector('#dash-cond-polarity') as HTMLElement
    expect(within(polarityCard).getByRole('img', { name: '通過' })).toBeTruthy()
    const check = container.querySelector('#dash-check') as HTMLElement
    expect(check.querySelectorAll('.dash-check-table .dash-state-ok').length).toBe(6)
    const phiInput = check.querySelector('input[aria-label="phi（error path 相位）"]') as HTMLInputElement
    expect(phiInput).toBeTruthy()
    fireEvent.change(phiInput, { target: { value: '120' } })
    await waitFor(() => expect(within(polarityCard).getByRole('img', { name: '未通過' })).toBeTruthy())
    // 原因以 LaTeX 顯示：「C < 0：更新極性錯誤」，並列出算出來的 C = P_x|H|cos θ = −0.5
    expect(plainText(check)).toMatch(/：更新極性錯誤。/)
    expect(texIn(check)).toContain('C<0')
    expect(texIn(check)).toContain(String.raw`C=P_x|H|\cos\theta=-0.5`)
    expect(plainText(check)).not.toMatch(/\$/)
    // 失敗原因以 danger callout 顯示（ExperimentShell warnings）
    expect(check.querySelector('[role="alert"]')?.textContent).toMatch(/極性/)
  })

  it('模式切換：Beginner 隱藏進階參數；按鈕可切到 Research 並顯示額外推導', async () => {
    const { container } = renderPage('beginner')
    const dInput = () => container.querySelector('input[aria-label="D（GMAC code delay）"]')
    const spine = () => (container.querySelector('#dash-spine') as HTMLElement).textContent ?? ''
    expect(dInput()).toBeNull()
    expect(spine()).not.toMatch(/推導 5（Research）/)
    // Beginner 模式的文字同樣不得出現 undefined / NaN / 未配對的 $
    const plain = container.cloneNode(true) as HTMLElement
    plain.querySelectorAll('.katex, pre, code, .c-code, .c-tip, script, style').forEach((el) => el.remove())
    expect(plain.textContent ?? '').not.toMatch(/undefined|NaN|\$/)
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    const modes = container.querySelector('#dash-modes') as HTMLElement
    fireEvent.click(within(modes).getByRole('button', { name: /切換到 Research/ }))
    await waitFor(() => expect(spine()).toMatch(/推導 5（Research）/))
    expect(dInput()).toBeTruthy()
    expect(within(modes).getByRole('button', { name: '目前模式' })).toBeTruthy()
  })

  it('已讀紀錄：勾選章節卡片後路線進度更新', () => {
    const { container } = renderPage()
    const grid = container.querySelector('#dash-chapters') as HTMLElement
    const box = grid.querySelector('input[aria-label="標記「01 LMS 起源與 MSE / MAE」為已讀"]') as HTMLInputElement
    expect(box).toBeTruthy()
    fireEvent.click(box)
    const math = container.querySelector('.dash-route') as HTMLElement
    expect(math.textContent).toMatch(/已讀 1\//)
  })

  it('Monte Carlo 交叉比對：按下執行後以共用的 block Sign-LMS 模擬，結果與解析值一致；改參數後舊結果失效', async () => {
    const { container } = renderPage('engineer')
    const check = container.querySelector('#dash-check') as HTMLElement
    // 尚未執行：不得顯示成已比對
    expect(check.querySelector('.dash-mc-verdict')).toBeNull()
    expect(check.textContent).toMatch(/尚未執行/)
    // 用小的 N 讓測試快（jsdom 沒有 Worker，useWorkerTask 會在主執行緒 inline 執行）
    const nInput = check.querySelector('input[aria-label="N（每個 GMAC block 的樣本數）"]') as HTMLInputElement
    fireEvent.change(nInput, { target: { value: '128' } })
    const runBtn = () => check.querySelector('.dash-mc-bar button') as HTMLButtonElement
    // 8 seeds × 483 blocks（40τ + 1，τ = 12.03）× N = 128 = 494592 個 sample
    await waitFor(() => expect(texIn(check.querySelector('.dash-mc-bar'))).toContain('N=128'))
    expect(texIn(check.querySelector('.dash-mc-bar'))).toContain(String.raw`8\times483\times128=494592`)
    expect(plainText(check.querySelector('.dash-mc-bar') as Element)).toMatch(/8 個 seed、每個 seed 483 個 block/)
    fireEvent.click(runBtn())
    await waitFor(() => expect(check.querySelector('.dash-mc-verdict')).toBeTruthy(), { timeout: 30_000 })
    expect(check.querySelector('.dash-mc-verdict')?.getAttribute('data-status')).toBe('ok')
    expect(check.querySelectorAll('.dash-mc-table tbody tr')).toHaveLength(3)
    expect(check.querySelectorAll('.dash-mc-table .dash-state-ok')).toHaveLength(3)
    // ExperimentShell 的交叉比對列：Analytic 與 Monte Carlo 都是 ok，Fixed-Point 誠實標示 Not implemented
    expect(check.querySelectorAll('.c-exp-crosscheck .c-check-ok')).toHaveLength(2)
    expect(check.querySelector('.c-exp-crosscheck .c-check-not-implemented')).toBeTruthy()
    // 改 μ ⇒ 先前的結果不適用
    const muInput = check.querySelector('input[aria-label="mu（學習率）"]') as HTMLInputElement
    fireEvent.change(muInput, { target: { value: '12' } })
    await waitFor(() => expect(check.querySelector('.dash-mc-verdict')).toBeNull())
    expect(check.textContent).toMatch(/參數或 seed 已變更/)
    expect(check.querySelectorAll('.c-exp-crosscheck .c-check-ok')).toHaveLength(1)
  })

  it('Monte Carlo 不適用時說明原因（兩參數模型）', async () => {
    const { container } = renderPage('engineer')
    const check = container.querySelector('#dash-check') as HTMLElement
    const toggle = check.querySelector('input[role="switch"]') as HTMLInputElement
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => expect(check.querySelector('.dash-mc')?.textContent).toMatch(/只有一個校正係數/))
    expect(check.querySelector('.dash-mc-bar')).toBeNull()
  })
})
