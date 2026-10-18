import { fireEvent, waitFor, within } from '@testing-library/react'
import { SIX_CONDITIONS } from './data'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { PAGE_PATHS, renderPage, texIn } from './indexTestUtils'
import { UNICODE_MATH } from './mathTextTestUtils'
import { FOLD_IDS } from './sections/ThesisFold'

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
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
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

/** jsdom 沒有 scrollIntoView：記下被捲到的元素 id（index.test.tsx 的 Beginner 測試用同樣的做法） */
function stubScrollIntoView() {
  const ids: string[] = []
  const proto = Element.prototype as Element & { scrollIntoView?: () => void }
  const original = proto.scrollIntoView
  proto.scrollIntoView = function (this: Element) {
    ids.push(this.id)
  }
  return {
    ids,
    restore() {
      proto.scrollIntoView = original
    },
  }
}

describe('DashboardPage（jsdom smoke，第二組）', () => {
  it('URL preset 參數會先經 sanitizeParams 檢查（不存在的 preset 不影響頁面）', () => {
    const { container } = renderPage('engineer', '/?preset=does-not-exist')
    expect(container.querySelectorAll('#dash-check .dash-check-table .dash-state-ok').length).toBe(6)
  })

  it('內建 preset 可由網址載入（#/?preset=thesis-phase120 ⇒ 極性未通過），並捲到體檢', async () => {
    const scrolled = stubScrollIntoView()
    try {
      const { container } = renderPage('engineer', '/?preset=thesis-phase120')
      const polarityCard = container.querySelector('#dash-cond-polarity') as HTMLElement
      await waitFor(() => expect(within(polarityCard).getByRole('img', { name: '未通過' })).toBeTruthy())
      expect(scrolled.ids).toEqual(['dash-check'])
    } finally {
      scrolled.restore()
    }
  })

  it('Beginner 的深連結：?preset= 先展開卡片、捲到體檢並套用參數；指到卡片裡的 ?f=／?a= 一開始就展開；卡片外的不展開；FOLD_IDS 恰好涵蓋卡片裡的 id', async () => {
    const scrolled = stubScrollIntoView()
    try {
      // ?preset=：第一次造訪的預設模式是 Beginner，分享出去的體檢連結必須看得到體檢（卡片展開、捲到 #dash-check、極性未通過）
      const a = renderPage('beginner', '/?preset=thesis-phase120')
      const fold = a.container.querySelector('details.dash-fold') as HTMLDetailsElement
      expect(fold).not.toBeNull()
      await waitFor(() => expect(a.container.querySelector('#dash-check')).not.toBeNull())
      expect(fold.open).toBe(true)
      await waitFor(() => expect(scrolled.ids).toEqual(['dash-check']))
      // 參數由剛掛上的 HealthCheck 套用，再經 useDeferredValue 重算：jsdom 裡這一輪渲染很慢，等久一點、用便宜的選擇器
      await waitFor(() => expect(a.container.querySelector('#dash-cond-polarity [role="img"][aria-label="未通過"]')).not.toBeNull(), { timeout: 15_000 })
      // FOLD_IDS：卡片裡每個 dash-／formula-／handcalc-／exp- 開頭的 id 都符合規則（深連結與頁內跳轉才會先展開）；卡片外的都不符合
      const inside: string[] = []
      const outside: string[] = []
      for (const el of Array.from(a.container.querySelectorAll('[id]'))) {
        if (el === fold || !/^(dash-|formula-|handcalc-|exp-|symbols)/.test(el.id)) continue // 卡片本身（dash-fold）不算在裡面
        ;(fold.contains(el) ? inside : outside).push(el.id)
      }
      expect(inside.length).toBeGreaterThan(20)
      expect(outside.length).toBeGreaterThan(20)
      for (const id of inside) expect(FOLD_IDS.test(id), `卡片裡的 ${id} 應符合 FOLD_IDS`).toBe(true)
      for (const id of outside) expect(FOLD_IDS.test(id), `卡片外的 ${id} 不應符合 FOLD_IDS`).toBe(false)
      expect(inside).toContain('formula-F-DB.1')
      expect(inside).toContain('handcalc-HC-DB.1')
      // 綜合題 HC-DB.6 不在這張卡片裡：它在「綜合手算」卡片（本頁必記那一段，收合時不渲染，規則見 foldIds.ts 與 index.beginner.test.tsx）
      expect(outside).not.toContain('handcalc-HC-DB.6')
      a.unmount()
      // 不存在的 preset：卡片維持收合、不捲動
      scrolled.ids.length = 0
      const b = renderPage('beginner', '/?preset=does-not-exist')
      expect((b.container.querySelector('details.dash-fold') as HTMLDetailsElement).open).toBe(false)
      expect(b.container.querySelector('#dash-check')).toBeNull()
      expect(scrolled.ids).toEqual([])
      b.unmount()
      // ?f=F-DB.1（公式速查頁的深連結）：一開始就展開，PageFrame 的 AnchorDeepLink 才找得到 #formula-F-DB.1
      const c = renderPage('beginner', '/?f=F-DB.1')
      expect((c.container.querySelector('details.dash-fold') as HTMLDetailsElement).open).toBe(true)
      await waitFor(() => expect(c.container.querySelector('[id="formula-F-DB.1"]')).not.toBeNull())
      c.unmount()
      // ?a= 指到卡片外（15 個問題的第 3 題）：不展開
      const d = renderPage('beginner', '/?a=dash-q-3')
      expect((d.container.querySelector('details.dash-fold') as HTMLDetailsElement).open).toBe(false)
      expect(d.container.querySelector('#dash-q-3')).not.toBeNull()
      d.unmount()
    } finally {
      scrolled.restore()
    }
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
    // 按鈕（.btn 是 inline-flex）裡的「載入反例：公式＋文字」是一個元素：不會被拆成三個 flex item（手機上會排成三欄）
    for (const b of Array.from(container.querySelectorAll('.dash-cond-example'))) {
      expect(b.childNodes, b.textContent ?? '').toHaveLength(1)
      expect((b.firstChild as HTMLElement).tagName).toBe('SPAN')
      expect(b.textContent).toContain('載入反例：')
    }
    // R01：卡片 5 的「不滿足時」說明 C → 0 的 bias 是線性化的值（大到 comparator 飽和時 a + B/C 不再是固定點）
    expect(card('bias').textContent).toContain('大到 comparator 飽和時它只是線性外推')
    expect(card('bias').textContent).toContain('Ch11 §11.4')
    // C06：Engineer 模式的穩定卡片就看得到「一半」只屬於 Ch08 的二狀態模型（不必開 Research）
    expect(card('stability').textContent).toContain('二狀態模型')
    expect(card('stability').textContent).toContain('不是所有 PLL 雙迴路的通則')
    expect(card('stability').textContent).not.toContain('雙迴路的完整界限只有簡化模型的一半')
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
    // C06：推導 5 與 Q10 把雙迴路的「一半」限定在 Ch08 §8.4 的二狀態模型，數字不變（2、1、|z| = 1.0198）
    const spineText = container.querySelector('#dash-spine')?.textContent ?? ''
    expect(spineText).toContain('二狀態模型')
    expect(spineText).toContain('不是所有 PLL 雙迴路的通則')
    expect(spineText).not.toContain('完整界限只有簡化模型一半的原因')
    const q10 = container.querySelector('#dash-q-10 .dash-q-answer')
    expect(q10?.textContent).toContain('二狀態模型')
    expect(q10?.textContent).toContain('比例不一定是一半')
    expect(q10?.textContent).not.toContain('完整雙迴路只有')
    expect(texIn(q10)).toContain(String.raw`0<\mu<2(1-r)/(bc)=2`)
    expect(texIn(q10)).toContain(String.raw`0<\mu<(1-r)/(bc)=1`)
    expect(texIn(q10).some((t) => t.includes('|z|=1.0198>1'))).toBe(true)
    // R05：Q11 不再說無雜訊 Sign-LMS「停在」中位數並讓 GMAC 歸零——E[G] 在那裡是由正變負的跳躍；1.34 / 1.4 兩個數字不變
    const q11 = container.querySelector('#dash-q-11 .dash-q-answer')
    expect(q11?.textContent).toContain('的兩側來回跳')
    expect(q11?.textContent).toContain('由正變負，不是等於 0')
    expect(q11?.textContent).not.toContain('兩者都讓 GMAC 歸零')
    expect(texIn(q11)).toContain('1+c_3E[x^4]/E[x^2]=1.34')
    expect(texIn(q11)).toContain('1.4')
    // R06b：推導 1 的第一步就地寫出「把 (a − w_k) 提到卷積外面」的前提
    expect(spineText).toContain('前提是')
    expect(spineText).toContain('的記憶長度內幾乎不變')
    // R12：推導 7 的提醒（Research）有 F-DB.6 與反例的數字 0.25 對 1.323
    const f6 = container.querySelector('[id="formula-F-DB.6"]')
    expect(f6?.closest('.c-callout')?.querySelector('.c-callout-title')?.textContent).toContain('多了一個假設')
    const calloutTex = texIn(f6?.closest('.c-callout') ?? null)
    expect(calloutTex.some((t) => t.includes(String.raw`1-1.5\cos60^\circ=0.25`))).toBe(true)
    expect(calloutTex.some((t) => t.includes(String.raw`|z|=\sqrt{1.75}\approx1.323`))).toBe(true)
    // R14：推導 4 的第四個提醒用模型算出的 0.3992 fs 說明「在預算內」不等於「比校正前好」
    expect(spineText).toContain('四個提醒')
    expect(spineText).toContain('不是「比校正前好」')
    expect(texIn(container.querySelector('#dash-spine')).some((t) => t.includes(String.raw`\sqrt{P_x}\,\sigma_w=0.3992\,\mathrm{fs}`))).toBe(true)
  })

  it('帶入手算：六題在三種模式下都顯示在頁面上（HandCalc），各自放在對應推導的正後方、綜合題在思考題之前', async () => {
    for (const mode of ['beginner', 'engineer', 'research'] as const) {
      const { container, unmount } = renderPage(mode)
      // Beginner 把六個條件／一條方程式／動手體檢收成一張卡片，展開才渲染（index.test.tsx 的「Beginner：…收成一張卡片」）：先展開
      if (mode === 'beginner') {
        // 六題都收在卡片裡：HC-DB.1–5 在「六條件一分鐘體檢」，綜合題 HC-DB.6 在「綜合手算」（本頁必記那一段的三張卡片之一）
        expect(container.querySelectorAll('section.c-handcalc')).toHaveLength(0)
        fireEvent.click(container.querySelector('details.dash-fold > summary') as HTMLElement)
        await waitFor(() => expect(container.querySelector('#dash-spine')).not.toBeNull())
        for (const summary of Array.from(container.querySelectorAll('#dash-recap > details.dash-foldcard > summary'))) fireEvent.click(summary)
        await waitFor(() => expect(container.querySelector('#dash-recap [data-handcalc="HC-DB.6"]')).not.toBeNull())
      } else expect(container.querySelector('details.dash-fold')).toBeNull()
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
    expect(container.querySelector('a.dash-erratum[href="/verification?e=E20"]')?.getAttribute('title')).toContain('M polarity 等於 90 度 減 絕對值') // title 是 accessibleText 之後的可念文字
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
