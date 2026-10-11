import { fireEvent, waitFor, within } from '@testing-library/react'
import { SIX_CONDITIONS } from './data'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { PAGE_PATHS, renderPage, texIn } from './indexTestUtils'
import { UNICODE_MATH } from './mathTextTestUtils'

/**
 * 首頁的第二組 jsdom 測試（接續 index.test.tsx）：URL preset、載入反例，以及 Research 模式整頁展開後的檢查
 * （KaTeX 解析、公式錨點、帶入手算、Unicode 數學、版面與無障礙）。拆成兩個檔案是為了讓每個 worker 的記憶體不超過上限（見 indexTestUtils.tsx）。
 */
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

describe('DashboardPage（jsdom smoke，第二組）', () => {
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
    clone.querySelectorAll('.katex, pre, code, .c-code, .c-tip, script, style').forEach((el) => el.remove())
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
