import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PAGES } from '@/app/registry'
import { SettingsProvider } from '@/app/settings'
import DashboardPage from './index'
import { ROUTES, QUESTIONS, SIX_CONDITIONS } from './data'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { UNICODE_MATH } from './mathTextTestUtils'
import { galleryPresets } from './sections/Gallery'
import { summarizeErrata } from './summaries'

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

// 整頁約 2 萬個 DOM 節點（KaTeX），jsdom 首次渲染需數秒；其他 agent 同時跑測試時更慢
vi.setConfig({ testTimeout: 60_000 })

const PAGE_PATHS = new Set(PAGES.map((p) => p.path))

function renderPage(mode: 'beginner' | 'engineer' | 'research' = 'engineer', url = '/') {
  try {
    localStorage.setItem('lmspll.mode', mode)
    localStorage.removeItem('lmspll.dashboard.done')
  } catch {
    /* jsdom storage 不可用時沿用預設 */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <DashboardPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

/** 區塊內所有 KaTeX 公式的 TeX 原始碼（MathML annotation） */
const texIn = (el: Element | null): string[] => Array.from(el?.querySelectorAll('annotation[encoding="application/x-tex"]') ?? [], (a) => a.textContent ?? '')
/** 拿掉 KaTeX 與程式碼之後的純文字 */
function plainText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex, pre, code, .c-code, script, style').forEach((x) => x.remove())
  return clone.textContent ?? ''
}

describe('DashboardPage（jsdom smoke）', () => {
  it('渲染不出錯：Hero、從這裡開始（/ch/00）、六個條件、三條路線、15 題、模式、勘誤', async () => {
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
    // 系統圖（Mermaid）與六個條件的圖例
    const spine = container.querySelector('#dash-spine') as HTMLElement
    expect(spine.querySelector('.c-mermaid')).toBeTruthy()
    expect(spine.querySelectorAll('.dash-legend-table tbody tr')).toHaveLength(6)
    // 12 個必備實驗：由 preset 註冊表彙整，連結帶 ?preset=
    const gal = container.querySelector('#dash-gallery') as HTMLElement
    const presets = galleryPresets()
    expect(gal.querySelectorAll('.dash-gal-card')).toHaveLength(presets.length)
    if (presets.length > 0) expect(gal.querySelector('.dash-gal-link')?.getAttribute('href')).toBe(`${presets[0].page}?preset=${presets[0].id}`)
    // KaTeX 有渲染（數學一律 LaTeX）
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(50)
    // 圖表呼叫 Plotly
    await waitFor(() => expect(P.react).toHaveBeenCalled())
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
    plain.querySelectorAll('.katex, pre, code, .c-code, script, style').forEach((el) => el.remove())
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

  it('URL preset 參數會先經 sanitizeParams 檢查（不存在的 preset 不影響頁面）', () => {
    const { container } = renderPage('engineer', '/?preset=does-not-exist')
    expect(container.querySelectorAll('#dash-check .dash-check-table .dash-state-ok').length).toBe(6)
  })

  it('內建 preset 可由網址載入（#/?preset=thesis-phase120 ⇒ 極性未通過）', async () => {
    const { container } = renderPage('engineer', '/?preset=thesis-phase120')
    const polarityCard = container.querySelector('#dash-cond-polarity') as HTMLElement
    await waitFor(() => expect(within(polarityCard).getByRole('img', { name: '未通過' })).toBeTruthy())
  })

  it('條件卡片的「載入反例」：按下後該條件的燈號變成未通過，其他無關條件仍通過', async () => {
    const { container } = renderPage('engineer')
    const card = (id: string) => container.querySelector(`#dash-cond-${id}`) as HTMLElement
    // system-level 的反例（T15 spur）：前五個條件都過，只有第六個不過
    fireEvent.click(card('system').querySelector('.dash-cond-example') as HTMLButtonElement)
    await waitFor(() => expect(within(card('system')).getByRole('img', { name: '未通過' })).toBeTruthy())
    for (const id of ['identifiability', 'polarity', 'stability', 'variance', 'bias']) expect(within(card(id)).getByRole('img', { name: '通過' })).toBeTruthy()
    // 原因：spur ≈ 20 log10(π f_out |T| A_t) = −93.8 dBc，超過這個 preset 設的 −95 dBc 上限
    expect(texIn(container.querySelector('#dash-check'))).toContain(String.raw`\approx20\log_{10}(\pi f_{\mathrm{out}}|T|A_t)=-93.8\,\mathrm{dBc}>-95\,\mathrm{dBc}`)
    // 每張卡片都有反例按鈕
    expect(container.querySelectorAll('.dash-cond-example')).toHaveLength(SIX_CONDITIONS.length)
  })

  it('Research 模式（全部展開）：沒有 KaTeX 解析錯誤，文字中沒有 undefined / NaN / 未配對的 $', () => {
    const { container } = renderPage('research')
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    // 只檢查非數學的文字節點（KaTeX 的 MathML annotation 會含原始 TeX）
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.katex, pre, code, .c-code, script, style').forEach((el) => el.remove())
    const text = clone.textContent ?? ''
    expect(text).not.toMatch(/undefined/)
    expect(text).not.toMatch(/NaN/)
    expect(text).not.toMatch(/\$/)
    // 公式登錄（formulas.ts）的每個 ID 在頁面上都有錨點（Formula & Unit Reference 頁會跳到 #formula-<id>）
    for (const fm of FORMULAS) expect(container.querySelector(`[id="formula-${fm.id}"]`), fm.id).toBeTruthy()
    // TeX 原始碼不得出現「兩個反斜線接字母」（JSX 屬性字串不處理跳脫字元，寫成 "\\tilde" 會被 KaTeX 當成換行 + 文字）
    const tex = Array.from(container.querySelectorAll('annotation[encoding="application/x-tex"]')).map((el) => el.textContent ?? '')
    expect(tex.length).toBeGreaterThan(100)
    for (const src of tex) expect(src, src).not.toMatch(/(^|[^\\])\\\\[a-zA-Z]/)
  })

  it('帶入手算：六題在三種模式下都顯示在頁面上（HandCalc），各自放在對應推導的正後方、綜合題在思考題之前', () => {
    for (const mode of ['beginner', 'engineer', 'research'] as const) {
      const { container, unmount } = renderPage(mode)
      for (const h of HANDCALCS) expect(container.querySelector(`section.c-handcalc[id="handcalc-${h.id}"]`), `${mode} ${h.id}`).toBeTruthy()
      expect(container.querySelectorAll('section.c-handcalc')).toHaveLength(HANDCALCS.length)
      // 頁面上的順序：推導 1 → HC-DB.1、推導 2 → HC-DB.2、推導 3 → HC-DB.3、推導 4 → HC-DB.5、（Research：推導 5–7）→ HC-DB.4，最後是綜合題 HC-DB.6
      const order = Array.from(container.querySelectorAll('[data-handcalc]'), (el) => el.getAttribute('data-handcalc'))
      expect(order).toEqual(['HC-DB.1', 'HC-DB.2', 'HC-DB.3', 'HC-DB.5', 'HC-DB.4', 'HC-DB.6'])
      const spine = container.querySelector('#dash-spine') as HTMLElement
      const blocks = Array.from(spine.querySelectorAll(':scope > details.dash-details > summary, :scope > [data-handcalc]'), (el) =>
        el.hasAttribute('data-handcalc') ? (el.getAttribute('data-handcalc') as string) : (/推導 \d/.exec(el.textContent ?? '')?.[0] ?? '?'),
      )
      // Research 模式多出推導 5–7：HC-DB.4 緊接在推導 7 之後；其他模式沒有這三段推導，但題目仍然顯示
      expect(blocks).toEqual([
        '推導 1',
        'HC-DB.1',
        '推導 2',
        'HC-DB.2',
        '推導 3',
        'HC-DB.3',
        '推導 4',
        'HC-DB.5',
        ...(mode === 'research' ? ['推導 5', '推導 6', '推導 7'] : []),
        'HC-DB.4',
      ])
      // 綜合題在「本頁必記」區塊、思考題之前
      const recap = container.querySelector('#dash-recap') as HTMLElement
      const hc6 = recap.querySelector('[data-handcalc="HC-DB.6"]') as HTMLElement
      const quiz = recap.querySelector('.c-quiz') as HTMLElement
      expect(hc6.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(recap.querySelector('a[href="/workbook"]')).toBeTruthy()
      // 預設值算出的答案就是文中的數字：HC-DB.2 的 E[δ_1] = 4.5931 fs（體檢預設圖的第一點）、HC-DB.3 的 σ_w = 0.39919 fs（T13）、HC-DB.5 的 spur = −93.799 dBc（T15）
      expect(texIn(container.querySelector('[id="handcalc-HC-DB.2"]')).some((t) => t.includes(String.raw`\boxed{E[\delta_1] = 4.5931\ \mathrm{fs}}`))).toBe(true)
      expect(texIn(container.querySelector('[id="handcalc-HC-DB.3"]')).some((t) => t.includes(String.raw`\boxed{\sigma_w\big|_{d=0} = 0.39919\ \mathrm{fs}}`))).toBe(true)
      expect(texIn(container.querySelector('[id="handcalc-HC-DB.5"]')).some((t) => t.includes(String.raw`\boxed{\mathrm{Spur} = -93.799\ \mathrm{dBc}}`))).toBe(true)
      expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
      unmount()
    }
  })

  it('數學一律 LaTeX：頁面文字（KaTeX 之外）沒有 Unicode 拼的公式；title / aria-label 這類純文字屬性沒有殘留的 $', () => {
    const { container } = renderPage('research')
    // 純文字情境不在檢查範圍：<option>（下拉選單）、共用元件的 tooltip（測試名稱、模型層級說明）、指標表表頭、
    // registry 的章節名稱（例如「ΔΣ」）、src/data/presets 的 Gallery 文字——它們不屬於這一頁，或本來就只能放純文字
    const clone = container.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll('.katex, pre, code, .c-code, script, style, option, .c-tip, .c-metric-table thead, .dash-ch-nav, .dash-ch-title, #dash-gallery')
      .forEach((el) => el.remove())
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
    const hits: string[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent ?? ''
      if (UNICODE_MATH.test(t)) hits.push(t.trim().slice(0, 80))
    }
    expect(hits).toEqual([])
    // 本頁自己產生的 title / aria-label（勘誤連結、圖表、燈號、按鈕）不得含 $
    const own = Array.from(container.querySelectorAll('[class*="dash-"][title], [class*="dash-"][aria-label], figure.c-plot[aria-label], .c-handcalc [aria-label]'))
    expect(own.length).toBeGreaterThan(20)
    for (const el of own) for (const a of ['title', 'aria-label']) expect(el.getAttribute(a) ?? '', `${a} on .${el.getAttribute('class')}`).not.toMatch(/\$/)
    expect(container.querySelector('a.dash-erratum[href="/verification?e=E20"]')?.getAttribute('title')).toContain(String.raw`M_{\mathrm{polarity}}=90^\circ`)
  })

  it('版面與無障礙：每張表格都在可水平捲動的 .table-wrap 內；每個輸入框與按鈕都有可讀的名稱；渲染過程沒有 console.error', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { container } = renderPage('research')
      const tables = Array.from(container.querySelectorAll('table'))
      expect(tables.length).toBeGreaterThan(8)
      for (const t of tables) expect(t.closest('.table-wrap'), `table.${t.getAttribute('class') ?? ''}：${(t.textContent ?? '').slice(0, 30)}`).toBeTruthy()
      for (const el of Array.from(container.querySelectorAll('input, select'))) {
        const id = el.getAttribute('id')
        const named = !!el.getAttribute('aria-label') || !!el.closest('label') || (!!id && !!container.querySelector(`label[for="${id}"]`))
        expect(named, `${el.tagName} ${el.getAttribute('type') ?? ''} 缺少標籤`).toBe(true)
      }
      for (const b of Array.from(container.querySelectorAll('button'))) expect(((b.textContent ?? '').trim() || b.getAttribute('aria-label') || '').length, b.outerHTML.slice(0, 80)).toBeGreaterThan(0)
      // 頁內連結都是 HashRouter 的路徑（不以 # 開頭，否則會被當成路由），而且都對應 registry 裡存在的頁面
      const hrefs = new Set(Array.from(container.querySelectorAll('a[href]'), (a) => a.getAttribute('href') ?? ''))
      expect(hrefs.size).toBeGreaterThan(20)
      for (const h of hrefs) {
        expect(h.startsWith('/'), h).toBe(true)
        expect(PAGE_PATHS.has(h.split('?')[0]), h).toBe(true)
      }
      expect(errors.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([])
    } finally {
      errors.mockRestore()
    }
  })
})
