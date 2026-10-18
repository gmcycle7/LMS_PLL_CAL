import { useRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  OUTLINE_COLUMN_GAP,
  OUTLINE_COLUMN_MIN_WIDTH,
  OUTLINE_COLUMN_QUERY,
  OUTLINE_COLUMN_WIDTH,
  OUTLINE_LINE_OFFSET,
  OUTLINE_MIN_ENTRIES,
  OUTLINE_RESCAN_MS,
  PageOutline,
  collectOutline,
  currentIndex,
  headingLabel,
  sectionProgress,
  slugify,
  type OutlineLayout,
} from './PageOutline'
import { BACK_TO_TOP_SCREENS, pastBackToTopThreshold } from './BackToTop'

/** KaTeX 輸出的最小結構：MathML（含 TeX 原始碼的 annotation）＋ HTML 層 */
const katex = (tex: string, html: string) =>
  `<span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${html}</span></span>`

/** 一頁的骨架：模式選擇器的 h2（要略過）、三種 id 情況的 h2、兩個實驗、一個手算、一個沒有 id 的思考題、符號表 */
const PAGE_HTML = `
  <section class="c-modepicker"><h2 id="c-modepicker-h">先選一個學習模式</h2></section>
  <h1>標題</h1>
  <h2 id="s1">一、${katex('K_q', 'Kq')} 的意思 <button type="button">提示</button></h2>
  <section class="c-exp" id="exp-a"></section>
  <section id="sec-b"><div class="c-section-kicker">公式</div><h2>二、第二節</h2><section class="c-handcalc" id="handcalc-HC-1"></section></section>
  <h2>三、沒有 id 的標題</h2>
  <div class="c-quiz"></div>
  <section class="c-exp" id="exp-b"></section>
  <section id="symbols"><h2>本章符號表</h2></section>
`
const EXPECTED_IDS = ['s1', 'sec-b', 'h-三-沒有-id-的標題', 'symbols']

function Harness({ html, onLayout, pageKey = 'p' }: { html: string; onLayout?: (l: OutlineLayout | null) => void; pageKey?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <MemoryRouter initialEntries={['/ch/05']}>
      <div ref={ref} data-testid="root">
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <PageOutline root={ref} pageKey={pageKey} onLayout={onLayout} />
      </div>
    </MemoryRouter>
  )
}

/** 假的 IntersectionObserver：記錄 callback，由測試決定標題的位置 */
class FakeIO {
  static instances: FakeIO[] = []
  observed: Element[] = []
  observe = (el: Element) => {
    this.observed.push(el)
  }
  disconnect = vi.fn()
  unobserve = vi.fn()
  takeRecords = () => []
  constructor(
    public cb: (entries: { target: Element; boundingClientRect: { top: number; width: number; height: number } }[]) => void,
    public opts?: IntersectionObserverInit,
  ) {
    FakeIO.instances.push(this)
  }
}

/** window.matchMedia：只有右欄的 query 成立（useMediaQuery 讀 window.matchMedia，不是全域變數） */
function stubMatchMedia(columnMatches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === OUTLINE_COLUMN_QUERY && columnMatches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const resetUrl = () => window.history.replaceState(null, '', window.location.pathname)
const links = (scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLAnchorElement>('.c-outline-list a'))
const chipTexts = (scope: ParentNode = document) => Array.from(scope.querySelectorAll('.c-outline-chip')).map((b) => b.textContent)

beforeEach(() => {
  window.scrollTo = vi.fn()
  resetUrl()
})
afterEach(() => {
  vi.unstubAllGlobals()
  // @ts-expect-error jsdom 沒有 matchMedia；測試裡定義的要拿掉
  delete window.matchMedia
  resetUrl()
})

describe('純函式', () => {
  it('headingLabel：KaTeX 還原成 $tex$、略過按鈕、空白合併', () => {
    const div = document.createElement('div')
    div.innerHTML = `<h2>一、 ${katex('K_q', 'Kq')}   的意思 <button>提示</button><span class="c-tip">氣泡</span></h2>`
    expect(headingLabel(div.firstElementChild!)).toBe('一、 $K_q$ 的意思')
  })

  it('slugify：小寫、字母數字以外換成 -、去掉 $…$、最長 48 字、空字串退回 section', () => {
    expect(slugify('三、沒有 id 的標題')).toBe('三-沒有-id-的標題')
    expect(slugify('  A/B  Test! ')).toBe('a-b-test')
    expect(slugify('5. 小訊號增益 $K_q$')).toBe('5-小訊號增益-k-q')
    expect(slugify('')).toBe('section')
    expect(slugify('、、')).toBe('section')
    expect(slugify('字'.repeat(80)).length).toBeLessThanOrEqual(48)
  })

  it('currentIndex：文件順序裡最後一個在判定線之上的標題；NaN（沒有版面）略過；都在下面是 -1', () => {
    expect(currentIndex([-500, 40, 900], 76)).toBe(1)
    expect(currentIndex([-500, NaN, 900], 76)).toBe(0)
    expect(currentIndex([-500, 40, NaN], 76)).toBe(1)
    expect(currentIndex([200, 900], 76)).toBe(-1)
    expect(currentIndex([], 76)).toBe(-1)
  })

  it('sectionProgress：判定線在本節與下一節之間的百分比，夾在 0–100，沒有長度是 0', () => {
    expect(sectionProgress(-5000, 5000, 0)).toBe(50)
    expect(sectionProgress(-5000, 5000, 76)).toBe(51)
    expect(sectionProgress(76, 1076, 76)).toBe(0)
    expect(sectionProgress(-2000, -1000, 76)).toBe(100)
    expect(sectionProgress(100, 100, 76)).toBe(0)
    expect(sectionProgress(100, NaN, 76)).toBe(0)
  })

  it('右欄的門檻 = global.css 的側欄寬 + 內容欄左右 padding + 內容欄最大寬 + 間距 + 右欄寬 + 傳統捲軸 16px（改了 token 就要一起改）', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')
    const token = (name: string) => Number(css.match(new RegExp(`${name}:\\s*(\\d+)px`))![1])
    // .content { padding: calc(var(--topbar-h) + 24px) 32px 64px } → 左右 32px
    const contentPad = Number(css.match(/\.content\s*\{[^}]*padding:\s*calc\([^;]*?\)\s+(\d+)px\s+\d+px;/)![1])
    expect(OUTLINE_COLUMN_MIN_WIDTH).toBe(token('--sidebar-w') + 2 * contentPad + token('--content-max') + OUTLINE_COLUMN_GAP + OUTLINE_COLUMN_WIDTH + 16)
    expect(OUTLINE_COLUMN_QUERY).toBe(`(min-width: ${OUTLINE_COLUMN_MIN_WIDTH}px)`)
    // PageOutline.css 讓出的 padding-right 要等於間距 + 右欄寬
    const own = readFileSync(join(process.cwd(), 'src/components/PageOutline.css'), 'utf8')
    expect(own).toContain(`padding-right: ${OUTLINE_COLUMN_GAP + OUTLINE_COLUMN_WIDTH}px`)
    expect(own).toContain(`width: ${OUTLINE_COLUMN_WIDTH}px`)
    // 目標停在 topbar 下方 16px，判定線再往下 8px：捲到之後剛好算作目前節
    expect(own).toMatch(/main \[id\]\s*\{\s*scroll-margin-top: calc\(var\(--topbar-h, 52px\) \+ 16px\)/)
    expect(OUTLINE_LINE_OFFSET).toBeGreaterThan(16)
  })
})

describe('collectOutline', () => {
  it('h2 → 目錄項目：自己的 id、祖先 section 的 id、沒有就產生 slug 並寫到 h2 上；略過模式選擇器的 h2', () => {
    const root = document.createElement('div')
    root.innerHTML = PAGE_HTML
    document.body.appendChild(root)
    try {
      const m = collectOutline(root)
      expect(m.entries.map((e) => e.id)).toEqual(EXPECTED_IDS)
      expect(m.entries.map((e) => e.label)).toEqual(['一、$K_q$ 的意思', '二、第二節', '三、沒有 id 的標題', '本章符號表'])
      // target = id 所在的元素（捲動與 scroll-spy 都用它）：h2 自己，或 h2 沒有 id 時的祖先 section
      expect(m.entries.map((e) => e.target.id)).toEqual(EXPECTED_IDS)
      expect(m.entries.map((e) => e.target.tagName)).toEqual(['H2', 'SECTION', 'H2', 'SECTION'])
      expect(m.entries.every((e) => e.heading.tagName === 'H2')).toBe(true)
      expect(root.querySelector('h2:not([id]):not(.x)')?.textContent).toBe('二、第二節') // 祖先 section 有 id 的 h2 不用自己有 id
      expect(document.getElementById('h-三-沒有-id-的標題')?.tagName).toBe('H2')
      expect(m.shortcuts).toEqual({ exp: ['exp-a', 'exp-b'], handcalc: ['handcalc-HC-1'], quiz: ['quiz-1'], symbols: 'symbols' })
      expect(root.querySelector('.c-quiz')?.id).toBe('quiz-1')
      expect(m.aboveTool).toBe(false)
      // 再掃一次：id 穩定、不會變成 -2
      const again = collectOutline(root)
      expect(again.entries.map((e) => e.id)).toEqual(EXPECTED_IDS)
      expect(again.shortcuts.quiz).toEqual(['quiz-1'])
    } finally {
      root.remove()
    }
  })

  it('slug 和頁面上既有的 id 撞到就加 -2；同一個祖先 section 裡的第二個 h2 也用 slug', () => {
    const root = document.createElement('div')
    root.innerHTML = `<div id="h-重複"></div><h2>重複</h2><section id="one"><h2>甲</h2><h2>乙</h2></section>`
    document.body.appendChild(root)
    try {
      const m = collectOutline(root)
      expect(m.entries.map((e) => e.id)).toEqual(['h-重複-2', 'one', 'h-乙'])
    } finally {
      root.remove()
    }
  })

  it('h2 自己的 id 和前面的重複（不合法的 HTML）：不改章節自己的 id，兩項指向同一個目標', () => {
    const root = document.createElement('div')
    root.innerHTML = `<h2 id="dup">甲</h2><h2 id="dup">乙</h2><h2 id="c">丙</h2>`
    document.body.appendChild(root)
    try {
      const m = collectOutline(root)
      expect(m.entries.map((e) => e.id)).toEqual(['dup', 'dup', 'c'])
      expect(Array.from(root.querySelectorAll('h2')).map((h) => h.id)).toEqual(['dup', 'dup', 'c'])
    } finally {
      root.remove()
    }
  })

  it('右下角有「手算工具」鈕（.wb-dock）時 aboveTool 為 true', () => {
    const root = document.createElement('div')
    root.innerHTML = `<h2 id="a">A</h2><div class="wb-dock"></div>`
    expect(collectOutline(root).aboveTool).toBe(true)
  })
})

describe('PageOutline：窄螢幕（沒有 matchMedia／query 不成立）＝右下角「目錄」鈕＋抽屜', () => {
  it('目錄鈕、抽屜裡的項目對應 h2、四個捷徑、Esc 關閉並把焦點還給按鈕', async () => {
    const onLayout = vi.fn()
    render(<Harness html={PAGE_HTML} onLayout={onLayout} />)
    const btn = await screen.findByRole('button', { name: '目錄' })
    expect(onLayout).toHaveBeenLastCalledWith('dock')
    expect(screen.queryByRole('navigation', { name: '本頁目錄' })).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.c-outline-sheet')).toBeNull()

    fireEvent.click(btn)
    const sheet = screen.getByRole('dialog', { name: /^本頁目錄/ })
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(sheet.querySelector('.c-outline-sheet-title')?.textContent).toBe('本頁目錄 4 節')
    expect(sheet.querySelector('.c-outline-head')).toBeNull() // 抽屜的標題列已經有節數，不再重複一次表頭
    expect(links(sheet).map((a) => a.getAttribute('href'))).toEqual(EXPECTED_IDS.map((id) => `#/ch/05?a=${encodeURIComponent(id).replace(/%20/g, '+')}`))
    // 完整文字在 title（右欄只留兩行），TeX 轉成可念的文字（accessibleText，不是原始碼）；標題裡的 KaTeX 在目錄裡重新排版（textContent 會含 MathML 的複本，所以不用它比）
    expect(links(sheet).map((a) => a.getAttribute('title'))).toEqual(['一、K q 的意思', '二、第二節', '三、沒有 id 的標題', '本章符號表'])
    expect(links(sheet)[0].querySelector('.katex annotation')?.textContent).toBe('K_q')
    expect(chipTexts(sheet)).toEqual(['實驗（2）', '手算（1）', '思考題', '符號表'])
    expect(document.activeElement?.textContent).toBe('實驗（2）')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.c-outline-sheet')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('點目錄項目：捲到目標、把 ?a=<id> 寫進網址（replaceState，不經過路由）、抽屜關閉；修飾鍵點擊交給瀏覽器', async () => {
    render(<Harness html={PAGE_HTML} />)
    fireEvent.click(await screen.findByRole('button', { name: '目錄' }))
    const target = document.getElementById('sec-b')!
    const focus = vi.spyOn(target, 'focus')
    const a = links().find((x) => x.getAttribute('href')!.endsWith('?a=sec-b'))!
    const clicked = fireEvent.click(a)
    expect(clicked).toBe(false) // preventDefault：沒有真的跟著 href 走
    expect(window.location.hash).toBe('#/?a=sec-b')
    expect(focus).toHaveBeenCalled()
    expect(document.querySelector('.c-outline-sheet')).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: '目錄' }))
    const b = links().find((x) => x.getAttribute('href')!.endsWith('?a=s1'))!
    // 交給瀏覽器（新分頁）：元件沒有 preventDefault。jsdom 會真的照 href 導覽，所以在 React 之後（document 層）自己擋下來
    let leftToBrowser: boolean | null = null
    const stop = (e: Event) => {
      leftToBrowser = !e.defaultPrevented
      e.preventDefault()
    }
    document.addEventListener('click', stop)
    fireEvent.click(b, { ctrlKey: true })
    document.removeEventListener('click', stop)
    expect(leftToBrowser).toBe(true)
    expect(window.location.hash).toBe('#/?a=sec-b')
  })

  it('捷徑：跳到目前位置之後的第一個實驗／手算／思考題／符號表（jsdom 沒有版面 → 第一個）並寫進網址', async () => {
    render(<Harness html={PAGE_HTML} />)
    const open = async () => fireEvent.click(await screen.findByRole('button', { name: '目錄' }))
    for (const [name, id] of [
      ['實驗（2）', 'exp-a'],
      ['手算（1）', 'handcalc-HC-1'],
      ['思考題', 'quiz-1'],
      ['符號表', 'symbols'],
    ] as const) {
      await open()
      fireEvent.click(screen.getByRole('button', { name }))
      expect(window.location.hash, name).toBe(`#/?a=${id}`)
      expect(document.querySelector('.c-outline-sheet'), name).toBeNull()
    }
  })

  it('少於 OUTLINE_MIN_ENTRIES 節：什麼都不顯示、onLayout(null)', async () => {
    const onLayout = vi.fn()
    render(<Harness html={'<h2 id="a">A</h2><h2 id="b">B</h2>'} onLayout={onLayout} />)
    await waitFor(() => expect(onLayout).toHaveBeenLastCalledWith(null))
    expect(OUTLINE_MIN_ENTRIES).toBe(3)
    // 掃描之前先當作有目錄（讓出位置），掃完發現太短才收回
    expect(onLayout.mock.calls[0][0]).toBe('dock')
    expect(screen.queryByRole('button', { name: '目錄' })).toBeNull()
    expect(document.querySelector('.c-outline-dock')).toBeNull()
  })

  it('DOM 變了（章節載入、模式切換）就重新掃描：新加的 h2 出現在目錄', async () => {
    render(<Harness html={PAGE_HTML} />)
    fireEvent.click(await screen.findByRole('button', { name: '目錄' }))
    expect(links()).toHaveLength(4)
    const extra = document.createElement('h2')
    extra.id = 'late'
    extra.textContent = '晚一點才出現的節'
    screen.getByTestId('root').firstElementChild!.appendChild(extra)
    await waitFor(() => expect(links()).toHaveLength(5), { timeout: OUTLINE_RESCAN_MS * 10 })
    expect(links()[4].getAttribute('href')).toBe('#/ch/05?a=late')
  })

  it('/workbook 右下角已有「手算工具」鈕：浮動列加上 raised class 疊在它上面', async () => {
    render(<Harness html={`${PAGE_HTML}<div class="wb-dock"><button class="wb-dock-toggle">手算工具</button></div>`} />)
    await screen.findByRole('button', { name: '目錄' })
    expect(document.querySelector('.c-outline-dock')?.classList.contains('c-outline-dock-raised')).toBe(true)
  })
})

describe('PageOutline：寬螢幕（右欄）與 scroll-spy', () => {
  beforeEach(() => {
    FakeIO.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIO)
    stubMatchMedia(true)
  })

  it('右欄是 nav「本頁目錄」、沒有目錄鈕、onLayout("column")；IntersectionObserver 觀察每一項的目標（h2 自己，或祖先 section）', async () => {
    const onLayout = vi.fn()
    render(<Harness html={PAGE_HTML} onLayout={onLayout} />)
    const nav = await screen.findByRole('navigation', { name: '本頁目錄' })
    expect(onLayout).toHaveBeenLastCalledWith('column')
    expect(screen.queryByRole('button', { name: '目錄' })).toBeNull()
    expect(links(nav)).toHaveLength(4)
    expect(nav.querySelector('.c-outline-head')?.textContent).toBe('本頁目錄4 節')
    const io = FakeIO.instances.at(-1)!
    const root = screen.getByTestId('root')
    const h2s = Array.from(root.querySelectorAll('h2')).filter((h) => !h.closest('.c-modepicker'))
    expect(h2s.map((h) => h.id)).toEqual(['s1', '', 'h-三-沒有-id-的標題', ''])
    // 觀察的是「id 所在的元素」（和點擊捲到的是同一個）：h2 沒有 id 時是祖先 section，不是 h2
    expect(io.observed).toEqual([h2s[0], root.querySelector('#sec-b'), h2s[2], root.querySelector('#symbols')])
    expect(io.observed.map((el) => el.id)).toEqual(EXPECTED_IDS)
    expect(io.opts?.rootMargin).toMatch(/^0px 0px -\d+px 0px$/) // 根區域 = 視窗頂端到判定線
  })

  it('scroll-spy：最後一個越過判定線的目標是目前節（aria-current=location）、顯示本節百分比；往回捲就換成上一節', async () => {
    render(<Harness html={PAGE_HTML} />)
    const nav = await screen.findByRole('navigation', { name: '本頁目錄' })
    const [h1, h2, h3, h4] = FakeIO.instances.at(-1)!.observed // 各項的目標（h2 或祖先 section）
    const rect = (top: number) => ({ top, width: 600, height: 30 })
    act(() => {
      FakeIO.instances.at(-1)!.cb([
        { target: h1, boundingClientRect: rect(-5000) },
        { target: h2, boundingClientRect: rect(40) },
        { target: h3, boundingClientRect: rect(3040) },
        { target: h4, boundingClientRect: rect(9000) },
      ])
    })
    const current = () => links(nav).filter((a) => a.getAttribute('aria-current') === 'location')
    expect(current().map((a) => a.getAttribute('href'))).toEqual(['#/ch/05?a=sec-b'])
    expect(nav.querySelector('.c-outline-head')?.textContent).toBe('本頁目錄2／4 節')
    // 判定線 = 52 + 24 = 76：(76 − 40) / (3040 − 40) = 1.2% → 1%
    expect(current()[0].querySelector('.c-outline-pct')?.textContent).toBe('1%')

    // 往回捲：第二節的標題回到判定線下方 → 第一節是目前節
    act(() => {
      FakeIO.instances.at(-1)!.cb([{ target: h2, boundingClientRect: rect(500) }])
    })
    expect(current().map((a) => a.getAttribute('href'))).toEqual(['#/ch/05?a=s1'])
    expect(current()[0].querySelector('.c-outline-pct')?.textContent).toBe('92%') // (76 + 5000) / (500 + 5000)

    // 收合的 <details> 裡的標題（沒有版面：rect 全 0）不算
    act(() => {
      FakeIO.instances.at(-1)!.cb([{ target: h3, boundingClientRect: { top: 0, width: 0, height: 0 } }])
    })
    expect(current().map((a) => a.getAttribute('href'))).toEqual(['#/ch/05?a=s1'])
  })

  it('h2 用祖先 section 的 id：section 頂端越過判定線就是目前節，h2 本身（kicker 下方 ~30px）還在判定線下面也一樣 —— 點了目錄捲到 section 時不能把上一節標成目前節', async () => {
    render(<Harness html={PAGE_HTML} />)
    const nav = await screen.findByRole('navigation', { name: '本頁目錄' })
    const io = FakeIO.instances.at(-1)!
    const rect = (top: number) => ({ top, width: 600, height: 30 })
    const section = document.getElementById('sec-b')!
    // 點了「二、第二節」之後的版面：section 停在 scroll-margin-top = 52 + 16 = 68（判定線 76 之上），裡面的 h2 在 kicker 下方 98
    act(() => {
      io.cb([
        { target: document.getElementById('s1')!, boundingClientRect: rect(-5000) },
        { target: section, boundingClientRect: rect(68) },
        { target: section.querySelector('h2')!, boundingClientRect: rect(98) },
        { target: document.getElementById('h-三-沒有-id-的標題')!, boundingClientRect: rect(3040) },
        { target: document.getElementById('symbols')!, boundingClientRect: rect(9000) },
      ])
    })
    const current = links(nav).filter((a) => a.getAttribute('aria-current') === 'location')
    expect(current.map((a) => a.getAttribute('href'))).toEqual(['#/ch/05?a=sec-b'])
    expect(current[0].querySelector('.c-outline-pct')?.textContent).toBe('0%') // (76 − 68) / (3040 − 68) = 0.3%
    expect(nav.querySelector('.c-outline-head')?.textContent).toBe('本頁目錄2／4 節')
  })

  it('掛上去就先回報 column（還沒掃描也讓出右欄的位置），之後不會再變成 null：章節第一次畫出來時內容欄不能先置中再往左跳', async () => {
    const onLayout = vi.fn()
    render(<Harness html={PAGE_HTML} onLayout={onLayout} />)
    await screen.findByRole('navigation', { name: '本頁目錄' })
    expect(onLayout.mock.calls[0][0]).toBe('column')
    expect(onLayout).not.toHaveBeenCalledWith(null)
    expect(onLayout).not.toHaveBeenCalledWith('dock')
  })

  it('右欄的項目點了一樣寫 ?a=（深連結）', async () => {
    render(<Harness html={PAGE_HTML} />)
    const nav = await screen.findByRole('navigation', { name: '本頁目錄' })
    fireEvent.click(links(nav)[2])
    expect(window.location.hash).toBe('#/?a=h-%E4%B8%89-%E6%B2%92%E6%9C%89-id-%E7%9A%84%E6%A8%99%E9%A1%8C')
    expect(decodeURIComponent(window.location.hash)).toBe('#/?a=h-三-沒有-id-的標題')
  })
})

describe('BackToTop：捲過 1.5 屏才出現，按了回到頂端並聚焦 h1', () => {
  const setScroll = (scrollY: number, innerHeight: number) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: scrollY })
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: innerHeight })
  }
  afterEach(() => setScroll(0, 768))

  it('pastBackToTopThreshold', () => {
    expect(BACK_TO_TOP_SCREENS).toBe(1.5)
    expect(pastBackToTopThreshold(1200, 800)).toBe(false)
    expect(pastBackToTopThreshold(1201, 800)).toBe(true)
  })

  it('頁首沒有按鈕；捲過 1.5 屏之後出現在浮動列；按下去 scrollTo(0,0) 並聚焦 main h1', async () => {
    setScroll(0, 800)
    render(
      <main>
        <h1>本頁標題</h1>
        <Harness html={PAGE_HTML} />
      </main>,
    )
    await screen.findByRole('button', { name: '目錄' })
    expect(screen.queryByRole('button', { name: '↑ 回到頂端' })).toBeNull()

    setScroll(1300, 800)
    fireEvent.scroll(window)
    const top = await screen.findByRole('button', { name: '↑ 回到頂端' })
    expect(top.closest('.c-outline-dock')).not.toBeNull()
    expect(top.compareDocumentPosition(screen.getByRole('button', { name: '目錄' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // 疊在目錄鈕上面

    fireEvent.click(top)
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
    expect(document.activeElement?.tagName).toBe('H1')

    setScroll(100, 800)
    fireEvent.scroll(window)
    await waitFor(() => expect(screen.queryByRole('button', { name: '↑ 回到頂端' })).toBeNull())
  })
})
