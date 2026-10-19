import { Suspense, lazy, useState, type ComponentType } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CHAPTER_FRAME_RESCAN_MS, PageFrame, placeChapterSlots } from './PageFrame'
import { formatMinutes } from '@/components/ChapterInfoStrip'
import { CHAPTER_FRAME_META } from './chapterMeta'
import { pageById, type PageEntry, type PageGroup } from './registry'
import { MODE_HINT, SettingsProvider, type LearningMode } from './settings'

const page = lazy(() => Promise.resolve({ default: () => <p>頁面內容</p> }))
const entry = (id: string, group: PageGroup, component: PageEntry['component'] = page): PageEntry => ({ id, path: `/${id}`, nav: id, title: `${id} 的標題`, group, component })

/** 三節的章節（本頁目錄要出現）；每次 render 計數，用來驗證外框的 state 變了不會把章節重畫 */
let longPageRenders = 0
const LongPage: ComponentType = () => {
  longPageRenders++
  return (
    <div>
      <p>頁面內容</p>
      <h2 id="s1">第一節</h2>
      <section id="s2">
        <h2>第二節</h2>
      </section>
      <h2>第三節</h2>
      <section className="c-exp" id="exp-x" />
    </div>
  )
}
const longPage = lazy(() => Promise.resolve({ default: LongPage }))

function renderFrame(e: PageEntry, mode?: LearningMode) {
  if (mode) localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter>
        <Suspense fallback={<div className="page-loading">載入中…</div>}>
          <PageFrame entry={e} />
        </Suspense>
      </MemoryRouter>
    </SettingsProvider>,
  )
}

const hint = () => document.querySelector('.c-mode-hint')

beforeEach(() => {
  window.scrollTo = vi.fn()
  longPageRenders = 0
})
afterEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', window.location.pathname)
})

describe('PageFrame：本頁目錄（PageOutline）', () => {
  it('三節以上的頁面：article 標成 data-outline="dock"（jsdom 沒有 matchMedia → 窄螢幕版）、右下角有「目錄」鈕，抽屜列出三節與「實驗（1）」；章節本體只 render 一次', async () => {
    // data-outline 的變化全部記下來：只能有一次（掛上去就是 dock），不能掃完之後才改（寬螢幕那就是內容欄先置中再往左跳）
    const changes: (string | null)[] = []
    const mo = new MutationObserver((recs) => {
      for (const r of recs) changes.push((r.target as Element).getAttribute('data-outline'))
    })
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-outline'] })
    renderFrame(entry('ch05', 'B', longPage), 'engineer')
    await screen.findByText('頁面內容')
    const btn = await screen.findByRole('button', { name: '目錄' })
    const article = document.querySelector('article.page')!
    await waitFor(() => expect(article.getAttribute('data-outline')).toBe('dock'))
    await new Promise((r) => setTimeout(r, 20))
    mo.disconnect()
    // 只設定過一次（目錄掛上去時的 layout effect，和章節同一次同步處理），之後沒有拿掉或改過：不能是「先沒有、掃完才加上」的兩段式
    expect(changes).toEqual(['dock'])
    // 目錄排在標題之後、模式提示之前
    const h1 = document.querySelector('h1')!
    expect(h1.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(btn.compareDocumentPosition(hint()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(btn)
    const sheet = screen.getByRole('dialog', { name: /^本頁目錄/ })
    expect(Array.from(sheet.querySelectorAll('.c-outline-list a')).map((a) => decodeURIComponent(a.getAttribute('href')!))).toEqual(['#/?a=s1', '#/?a=s2', '#/?a=h-第三節'])
    expect(screen.getByRole('button', { name: '實驗（1）' })).toBeTruthy()
    // 目錄的版面寫進外框的 state 時章節沒有重畫（memo）
    expect(longPageRenders).toBe(1)
  })

  it('只有一段內容（沒有三個 h2）的頁面：沒有目錄鈕、article 沒有 data-outline', async () => {
    renderFrame(entry('papers', 'tools'), 'engineer')
    await screen.findByText('頁面內容')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: '目錄' })).toBeNull()
    expect(document.querySelector('article.page')!.hasAttribute('data-outline')).toBe(false)
  })
})

describe('PageFrame：章節頁的模式提示', () => {
  it.each(['beginner', 'engineer', 'research'] as const)('%s 模式：章節頁 h1 下方一行提示（依模式換字），h1 可被程式聚焦', async (mode) => {
    renderFrame(entry('ch05', 'B'), mode)
    await screen.findByText('頁面內容')
    expect(hint()?.textContent).toBe(MODE_HINT[mode])
    expect(hint()?.getAttribute('data-mode')).toBe(mode)
    const h1 = document.querySelector('h1') as HTMLElement
    expect(h1.textContent).toBe('ch05 的標題')
    expect(h1.getAttribute('tabindex')).toBe('-1')
    // 提示在標題之後、內容之前
    expect(h1.compareDocumentPosition(hint()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hint()!.compareDocumentPosition(screen.getByText('頁面內容')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('mode-picker')).toBeNull()
  })

  it('Part A / B / C（含 07b 案例）顯示提示；Part D、工具頁、Dashboard 不顯示', async () => {
    for (const [id, group, expected] of [
      ['ch00', 'A', true],
      ['case-sspll', 'B', true],
      ['ch13', 'C', true],
      ['models', 'D', false],
      ['workbook', 'tools', false],
      ['dashboard', 'start', false],
    ] as const) {
      const r = renderFrame(entry(id, group), 'beginner')
      await screen.findByText('頁面內容')
      expect(hint() !== null, `${id} (${group})`).toBe(expected)
      r.unmount()
    }
  })

  it('沒有存過模式：頁首先出現模式選擇器、提示先不顯示；選了 Engineer 後選擇器消失、提示換成 Engineer 的字', async () => {
    renderFrame(entry('ch05', 'B'))
    await screen.findByText('頁面內容')
    const picker = screen.getByTestId('mode-picker')
    const article = document.querySelector('article.page') as HTMLElement
    expect(article.firstElementChild).toBe(picker)
    expect(hint()).toBeNull()
    fireEvent.click(picker.querySelector('button[data-mode="engineer"]')!)
    expect(screen.queryByTestId('mode-picker')).toBeNull()
    expect(hint()?.textContent).toBe(MODE_HINT.engineer)
    expect(localStorage.getItem('lmspll.mode')).toBe('engineer')
  })
})

/** 長得像真的章節的假頁面：開場問題 → 系統地圖（figure.c-mermaid）→ 「你在這裡」（.c-map-note）→ 各節、手算題 → 本課必記 → #symbols */
function ChapterLikePage() {
  const [extra, setExtra] = useState(false)
  return (
    <div className="chx">
      <div className="callout c-callout" data-question>
        這次我們要回答的問題
      </div>
      <figure className="c-mermaid c-sysmap" aria-label="系統方塊圖" />
      <p className="c-map-note">你在這裡：藍色方塊是本章的主角</p>
      <h2 id="s1">第一節</h2>
      <section className="c-handcalc" id="handcalc-HC-05.1" />
      <button type="button" onClick={() => setExtra(true)}>
        加一題
      </button>
      {extra && <section className="c-handcalc" id="handcalc-HC-05.9" />}
      <h2 id="s2">第二節</h2>
      <h2 id="s3">第三節</h2>
      <div className="c-recap" />
      <section id="symbols" />
    </div>
  )
}
const chapterLikePage = lazy(() => Promise.resolve({ default: ChapterLikePage }))

const following = (a: Element | null, b: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('PageFrame：章首／章末骨架（ChapterInfoStrip、PrereqCheck、ChapterHandoff）', () => {
  it('章節頁：h1 之後第一個區塊是開場問題、再來是系統地圖；strip → 模式提示 → 先備自檢 放在圖與「你在這裡」之後；交棒放在 #symbols 之前；h1 上方沒有 eyebrow', async () => {
    const real = pageById('ch05')!
    renderFrame({ ...real, component: chapterLikePage }, 'engineer')
    const strip = await screen.findByRole('navigation', { name: '本章資訊' })
    const article = document.querySelector('article.page')!
    // 不再有 h1 上方的「規格書 §… · 驗證 T…」
    expect(article.querySelector('.page-kicker')).toBeNull()
    const h1 = article.querySelector('h1')!
    expect(h1.textContent).toBe(real.title)
    const question = article.querySelector('[data-question]')!
    const figure = article.querySelector('figure.c-mermaid')!
    const note = article.querySelector('.c-map-note')!
    // 順序：h1 → 問題 → 圖 → 你在這裡 → 插槽（strip、模式提示、先備自檢）→ 第一節
    const slot = note.nextElementSibling as HTMLElement
    expect(slot.getAttribute('data-chapter-slot')).toBe('opening')
    expect(slot.classList.contains('c-chapter-opening')).toBe(true)
    expect(following(h1, question) && following(question, figure) && following(figure, note) && following(note, slot) && following(slot, article.querySelector('#s1'))).toBe(true)
    expect(Array.from(slot.children).map((el) => el.className.split(' ')[0])).toEqual(['c-chinfo', 'c-mode-hint', 'c-prereq-check'])
    expect(slot.contains(strip)).toBe(true)
    expect(slot.querySelector('.c-mode-hint')!.textContent).toBe(MODE_HINT.engineer)
    // 問題與圖之間沒有別的區塊（插槽只有一個）
    expect(article.querySelectorAll('[data-chapter-slot="opening"]')).toHaveLength(1)
    expect(question.nextElementSibling).toBe(figure)
    // strip 的內容：規格書 §、驗證、閱讀時間、勘誤、手算（從 DOM 數：1 題）、符號表
    expect(Array.from(strip.querySelectorAll('.c-chinfo-item')).map((li) => li.getAttribute('data-item'))).toEqual(['spec', 'tests', 'reading', 'errata', 'handcalcs', 'symbols'])
    expect(strip.querySelector('[data-item="spec"]')!.textContent).toBe('規格書§5、§5.1')
    expect(strip.querySelector('[data-item="handcalcs"] a')!.textContent).toBe('手算 1 題')
    expect(strip.querySelector('[data-item="handcalcs"] a')!.getAttribute('href')).toMatch(/\?a=handcalc-HC-05\.1$/)
    expect(strip.querySelector('[data-item="symbols"] a')!.getAttribute('href')).toMatch(/\?a=symbols$/)
    expect(strip.querySelector('.c-chinfo-mode.is-current')!.textContent).toBe(`Engineer ${formatMinutes(CHAPTER_FRAME_META.ch05.readingMinutes.engineer)}`)
    // 先備自檢：ch05 的三條，每條一個連結
    const prereq = slot.querySelector('.c-prereq-check')!
    expect(prereq.querySelectorAll('li')).toHaveLength(CHAPTER_FRAME_META.ch05.prereqs.length)
    expect(prereq.querySelectorAll('li a.c-chref')).toHaveLength(CHAPTER_FRAME_META.ch05.prereqs.length)
    // 交棒：#symbols 的前一個元素就是插槽，裡面是「下一章」ch06
    const symbols = article.querySelector('#symbols')!
    const handoffSlot = symbols.previousElementSibling as HTMLElement
    expect(handoffSlot.getAttribute('data-chapter-slot')).toBe('handoff')
    const handoff = handoffSlot.querySelector('.c-handoff')!
    expect(handoff.getAttribute('data-next')).toBe('ch06')
    expect(handoff.querySelector('a.c-chref')!.getAttribute('href')).toBe('/ch/06')
    expect(following(article.querySelector('.c-recap'), handoff) && following(handoff, symbols)).toBe(true)
    expect(article.querySelectorAll('.c-handoff')).toHaveLength(1)
    // 模式提示只畫一次（在插槽裡，不在 h1 下面）
    expect(article.querySelectorAll('.c-mode-hint')).toHaveLength(1)
    expect(following(figure, article.querySelector('.c-mode-hint'))).toBe(true)
  })

  it('章節之後才長出來的手算題：MutationObserver 重掃之後 strip 的「手算 N 題」跟著變；插槽不會多出第二個', async () => {
    vi.useFakeTimers()
    try {
      const real = pageById('ch05')!
      renderFrame({ ...real, component: chapterLikePage }, 'beginner')
      await act(() => vi.advanceTimersByTimeAsync(10))
      const article = document.querySelector('article.page')!
      expect(article.querySelector('[data-item="handcalcs"] a')!.textContent).toBe('手算 1 題')
      fireEvent.click(screen.getByText('加一題'))
      await act(() => vi.advanceTimersByTimeAsync(CHAPTER_FRAME_RESCAN_MS + 50))
      expect(article.querySelector('[data-item="handcalcs"] a')!.textContent).toBe('手算 2 題')
      expect(article.querySelectorAll('[data-chapter-slot="opening"]')).toHaveLength(1)
      expect(article.querySelectorAll('[data-chapter-slot="handoff"]')).toHaveLength(1)
      // 新的 section 插在按鈕後面，插槽還在「你在這裡」後面
      expect(article.querySelector('.c-map-note')!.nextElementSibling!.getAttribute('data-chapter-slot')).toBe('opening')
    } finally {
      vi.useRealTimers()
    }
  })

  it('頁面上沒有圖也沒有 #symbols（例如載入失敗的替代內容）：strip 畫在內容前面、交棒畫在內容後面（上一頁／下一頁之前）', async () => {
    const real = pageById('ch05')!
    renderFrame({ ...real, component: longPage }, 'engineer')
    const strip = await screen.findByRole('navigation', { name: '本章資訊' })
    const article = document.querySelector('article.page')!
    const content = screen.getByText('頁面內容')
    expect(following(article.querySelector('h1'), strip) && following(strip, content)).toBe(true)
    const handoff = article.querySelector('.c-handoff')!
    expect(following(content, handoff) && following(handoff, article.querySelector('.page-pager'))).toBe(true)
    // 沒有 #symbols 與手算題：strip 不列那兩項
    expect(Array.from(strip.querySelectorAll('.c-chinfo-item')).map((li) => li.getAttribute('data-item'))).toEqual(['spec', 'tests', 'reading', 'errata'])
    expect(longPageRenders).toBe(1) // 插槽的 state 變了也不重畫章節
  })

  it('工具頁（沒有 chapterMeta）：沒有 strip、先備自檢與交棒；案例頁 07b 有', async () => {
    const r = renderFrame(entry('papers', 'tools'), 'engineer')
    await screen.findByText('頁面內容')
    expect(document.querySelector('.c-chinfo, .c-prereq-check, .c-handoff')).toBeNull()
    r.unmount()
    renderFrame({ ...pageById('case-sspll')!, component: page }, 'engineer')
    await screen.findByRole('navigation', { name: '本章資訊' })
    expect(document.querySelector('.c-handoff')!.getAttribute('data-next')).toBe('ch08')
  })

  it('placeChapterSlots：圖後面沒有 .c-map-note 就直接放在圖後面；再呼叫一次不會搬動或新增；沒有圖就回傳 null', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>q</p><figure class="c-mermaid"></figure><p>x</p><section id="symbols"></section>'
    const a = placeChapterSlots(root)
    expect(a.opening!.previousElementSibling!.tagName).toBe('FIGURE')
    expect(a.opening!.nextElementSibling!.textContent).toBe('x')
    expect(a.handoff!.nextElementSibling!.id).toBe('symbols')
    const b = placeChapterSlots(root)
    expect(b.opening).toBe(a.opening)
    expect(b.handoff).toBe(a.handoff)
    expect(root.querySelectorAll('[data-chapter-slot]')).toHaveLength(2)
    const empty = document.createElement('div')
    empty.innerHTML = '<p>只有文字</p>'
    expect(placeChapterSlots(empty)).toEqual({ opening: null, handoff: null, handcalcIds: [], hasSymbols: false })
  })
})
