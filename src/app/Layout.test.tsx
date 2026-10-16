import { Suspense, lazy } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { DRAWER_QUERY, Layout, NARROW_QUERY } from './Layout'
import { PageFrame } from './PageFrame'
import { GROUP_LABEL, PAGES, type PageEntry } from './registry'
import { MODE_LABEL, MODE_SHORT, MODES, SettingsProvider } from './settings'

/** 只有指定 query 成立的 matchMedia（jsdom 沒有 matchMedia） */
function installMatchMedia(truthy: string[]) {
  window.matchMedia = ((query: string) =>
    ({
      matches: truthy.includes(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
}

const page = (text: string) =>
  lazy(() =>
    Promise.resolve({
      default: () => (
        <div>
          <p>{text}</p>
          <Link to="#symbols">本章符號表</Link>
        </div>
      ),
    }),
  )
const ENTRIES: PageEntry[] = [
  { id: 'ch05', path: '/ch/05', nav: '05 測試章', title: '第五章標題', group: 'B', component: page('第五章內容') },
  { id: 'ch04', path: '/ch/04', nav: '04 測試章', title: '第四章標題', group: 'B', component: page('第四章內容') },
]

function renderApp(initial = '/ch/05') {
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Layout>
          <Suspense fallback={<div>載入中…</div>}>
            <Routes>
              {ENTRIES.map((e) => (
                <Route key={e.id} path={e.path} element={<PageFrame entry={e} />} />
              ))}
            </Routes>
          </Suspense>
        </Layout>
      </MemoryRouter>
    </SettingsProvider>,
  )
}

const status = () => document.querySelector('[role="status"]') as HTMLElement
const sidebar = () => document.getElementById('sidebar-nav') as HTMLElement
const main = () => document.getElementById('main') as HTMLElement
const toggle = () => document.querySelector('.nav-toggle') as HTMLButtonElement | null

beforeEach(() => {
  localStorage.setItem('lmspll.mode', 'engineer')
  window.scrollTo = vi.fn()
  installMatchMedia([])
})
afterEach(() => {
  localStorage.clear()
})

describe('Layout：導覽骨架（桌面）', () => {
  it('第一個可聚焦的元素是 skip link，按下去把焦點移到 <main id="main" tabindex="-1">', async () => {
    const { container } = renderApp()
    await screen.findByText('第五章內容')
    const first = container.querySelector('button, a, select, input, [tabindex]') as HTMLElement
    expect(first.classList.contains('c-skip-link')).toBe(true)
    expect(first.textContent).toBe('跳到主要內容')
    expect(main().getAttribute('tabindex')).toBe('-1')
    fireEvent.click(first)
    expect(document.activeElement).toBe(main())
  })

  it('桌面不渲染沒有作用的 ☰ 按鈕；側欄是 <ul>/<li>，六個群組都用 aria-labelledby 標出群組名', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    expect(toggle()).toBeNull()
    const nav = sidebar()
    expect(nav.tagName).toBe('NAV')
    expect(nav.getAttribute('aria-label')).toBe('章節目錄')
    const groups = nav.querySelectorAll('[role="group"][aria-labelledby]')
    expect(groups).toHaveLength(Object.keys(GROUP_LABEL).length)
    const labels = [...groups].map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)
    expect(labels).toEqual(['開始', GROUP_LABEL.A, GROUP_LABEL.B, GROUP_LABEL.C, GROUP_LABEL.D, GROUP_LABEL.tools])
    expect(nav.querySelectorAll('ul.c-nav-list')).toHaveLength(groups.length)
    const items = nav.querySelectorAll('ul.c-nav-list > li')
    expect(items).toHaveLength(PAGES.length)
    for (const li of items) expect(li.querySelectorAll(':scope > a.nav-link')).toHaveLength(1)
    // 側欄不在 main 裡，main 之前只有 skip link、狀態區與頂列
    expect(main().contains(nav)).toBe(false)
  })

  it('首次載入不播報；換頁（pathname 變更）後焦點移到 h1、role=status 播報「已切換到：標題」；只改 hash 不播報', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    expect(status().getAttribute('aria-live')).toBe('polite')
    expect(status().textContent).toBe('')
    expect(document.activeElement).toBe(document.body)

    fireEvent.click(sidebar().querySelector('a[href="/ch/04"]')!)
    await screen.findByText('第四章內容')
    await waitFor(() => expect(status().textContent).toBe('已切換到：第四章標題'))
    const h1 = document.querySelector('main h1') as HTMLElement
    expect(h1.textContent).toBe('第四章標題')
    expect(h1.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(h1)
    expect(document.title).toBe('04 測試章 · LMS × PLL Lab')

    // 同一頁內的 hash 連結：不算換頁
    fireEvent.click(screen.getByText('本章符號表'))
    await new Promise((r) => setTimeout(r, 20))
    expect(status().textContent).toBe('已切換到：第四章標題')

    fireEvent.click(sidebar().querySelector('a[href="/ch/05"]')!)
    await screen.findByText('第五章內容')
    await waitFor(() => expect(status().textContent).toBe('已切換到：第五章標題'))
    expect((document.activeElement as HTMLElement).textContent).toBe('第五章標題')
  })

  it('桌面的模式選單用完整標籤', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    const select = screen.getByLabelText('學習模式') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(MODES.map((m) => MODE_LABEL[m]))
  })
})

describe('Layout：手機抽屜（≤900px）', () => {
  beforeEach(() => installMatchMedia([DRAWER_QUERY, NARROW_QUERY]))

  it('收起時側欄 inert（鍵盤到不了）、☰ 有 aria-controls；打開後焦點到第一個連結、main inert', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    const btn = toggle()!
    expect(btn.getAttribute('aria-controls')).toBe('sidebar-nav')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(sidebar().hasAttribute('inert')).toBe(true)
    expect(main().hasAttribute('inert')).toBe(false)

    fireEvent.click(btn)
    expect(document.querySelector('.app-shell.nav-open')).not.toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(sidebar().hasAttribute('inert')).toBe(false)
    expect(main().hasAttribute('inert')).toBe(true)
    const firstLink = sidebar().querySelector('a.nav-link') as HTMLElement
    expect(document.activeElement).toBe(firstLink)
  })

  it('Esc 與點 scrim 都會關閉抽屜並把焦點還給 ☰', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    const btn = toggle()!
    fireEvent.click(btn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.app-shell.nav-open')).toBeNull()
    expect(document.activeElement).toBe(btn)
    expect(sidebar().hasAttribute('inert')).toBe(true)
    expect(main().hasAttribute('inert')).toBe(false)

    fireEvent.click(btn)
    expect(document.querySelector('.app-shell.nav-open')).not.toBeNull()
    fireEvent.click(document.querySelector('.nav-scrim')!)
    expect(document.querySelector('.app-shell.nav-open')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('從抽屜選章節：抽屜關閉、main 不再 inert、焦點到新頁的 h1', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    fireEvent.click(toggle()!)
    fireEvent.click(sidebar().querySelector('a[href="/ch/04"]')!)
    await screen.findByText('第四章內容')
    expect(document.querySelector('.app-shell.nav-open')).toBeNull()
    expect(main().hasAttribute('inert')).toBe(false)
    await waitFor(() => expect((document.activeElement as HTMLElement).textContent).toBe('第四章標題'))
    expect(status().textContent).toBe('已切換到：第四章標題')
  })

  it('窄螢幕的模式選單改用短標籤（不會被截成「Engineer …」）', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    const select = screen.getByLabelText('學習模式') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(MODES.map((m) => MODE_SHORT[m]))
  })
})
