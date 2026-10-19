import { Suspense, lazy } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { DRAWER_QUERY, Layout, NARROW_QUERY, ROUTES_WITH_OWN_SLASH } from './Layout'
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
  { id: 'formulas', path: '/formulas', nav: '公式速查', title: '公式速查標題', group: 'tools', component: page('公式速查內容') },
]

/**
 * 全站搜尋的面板是 lazy 載入的（真的面板與索引在 src/components/search 自己的測試裡測）；
 * 這裡換成一個只有輸入框與關閉鈕的假面板，測 Layout 的部分：按鈕、快捷鍵、開關與焦點。
 */
/** 面板 chunk 的載入閘：hold=true 時第一次 lazy 載入停在 Suspense 的殼，release() 才放行（React.lazy 只載一次，所以只有第一個開面板的測試用得到） */
const gate = vi.hoisted(() => ({ hold: false, release: () => {} }))
vi.mock('@/components/search', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/search')>()
  const { createElement } = await import('react')
  function FakePalette({ onClose }: { onClose: () => void }) {
    return createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': '搜尋全站' },
      createElement('input', { 'aria-label': '假的搜尋框', autoFocus: true }),
      createElement('button', { type: 'button', onClick: onClose }, '關閉'),
    )
  }
  const loadSearchPalette = () =>
    gate.hold
      ? new Promise<{ default: typeof FakePalette }>((resolve) => {
          gate.release = () => resolve({ default: FakePalette })
        })
      : Promise.resolve({ default: FakePalette })
  return { ...mod, loadSearchPalette }
})

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
    // 瀏覽器分頁標題由 App.tsx 的 <DocumentTitle> 設定（navigation.test.tsx、App.test.tsx）；PageFrame 本身不寫 document.title

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

describe('Layout：全站搜尋（🔍 鈕與快捷鍵）', () => {
  const searchButton = () => screen.getByRole('button', { name: /^搜尋全站/ }) as HTMLButtonElement
  const dialog = () => screen.queryByRole('dialog')

  it('面板 chunk 還在載入（Suspense 的殼）時：Esc 與點背景都能關閉、焦點回到按鈕；載好之後再開才是真的面板', async () => {
    gate.hold = true
    try {
      renderApp()
      await screen.findByText('第五章內容')
      fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
      const shell = await screen.findByRole('dialog')
      expect(shell.getAttribute('aria-busy')).toBe('true')
      expect(screen.getByText('載入搜尋…')).toBeTruthy()
      const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => {
        document.body.dispatchEvent(esc)
      })
      expect(esc.defaultPrevented).toBe(true)
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(searchButton())

      fireEvent.click(searchButton())
      expect((await screen.findByRole('dialog')).getAttribute('aria-busy')).toBe('true')
      fireEvent.mouseDown(document.querySelector('.c-search-backdrop')!)
      expect(dialog()).toBeNull()
      expect(document.activeElement).toBe(searchButton())
    } finally {
      gate.hold = false
      gate.release()
    }
    fireEvent.click(searchButton())
    await screen.findByLabelText('假的搜尋框')
    expect(screen.getByRole('dialog').hasAttribute('aria-busy')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    expect(dialog()).toBeNull()
  })

  it('頂列有搜尋鈕（aria-haspopup=dialog、提示 / 與 ⌘K／Ctrl+K），排在兩個下拉選單前面；按下去開面板、關閉後焦點回到按鈕', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    const btn = searchButton()
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-label')).toMatch(/搜尋全站（\/ 或 (⌘K|Ctrl\+K)）/)
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('/ Meta+K Control+K')
    const controls = document.querySelector('.topbar-controls')!
    expect(controls.firstElementChild).toBe(btn)
    expect(dialog()).toBeNull()

    fireEvent.click(btn)
    await screen.findByRole('dialog')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    expect(dialog()).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(btn)
  })

  it('`/` 開面板（焦點不在輸入框時）、⌘K／Ctrl-K 開與關；都是 preventDefault', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    const slash = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    act(() => {
      document.body.dispatchEvent(slash)
    })
    expect(slash.defaultPrevented).toBe(true)
    await screen.findByRole('dialog')
    expect(document.activeElement).toBe(screen.getByLabelText('假的搜尋框'))

    const cmdK = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
    act(() => {
      document.body.dispatchEvent(cmdK)
    })
    expect(cmdK.defaultPrevented).toBe(true)
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(searchButton())

    fireEvent.keyDown(document.body, { key: 'K', ctrlKey: true })
    await screen.findByRole('dialog')
    // 面板開著時再按 `/` 不會重開
    fireEvent.keyDown(document.body, { key: '/' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(dialog()).toBeNull()
  })

  it('`/` 在輸入框、文字區、下拉選單裡是要打的字，不開面板；帶 Ctrl／⌘／Alt 的 `/` 也不算；⌘K 在輸入框裡仍然有效', async () => {
    renderApp()
    await screen.findByText('第五章內容')
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    document.body.append(input, textarea)
    const select = screen.getByLabelText('主題')
    for (const el of [input, textarea, select]) {
      el.focus()
      const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
      act(() => {
        el.dispatchEvent(ev)
      })
      expect(ev.defaultPrevented).toBe(false)
      expect(dialog()).toBeNull()
    }
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '/', altKey: true })
    fireEvent.keyDown(document.body, { key: '/', metaKey: true })
    expect(dialog()).toBeNull()

    input.focus()
    fireEvent.keyDown(input, { key: 'k', metaKey: true })
    await screen.findByRole('dialog')
    // 關閉後焦點回到開啟前的元素（那個輸入框），不是搜尋鈕
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    expect(document.activeElement).toBe(input)
    input.remove()
    textarea.remove()
  })

  it('公式速查頁自己把 `/` 綁在頁內搜尋框：那一頁 `/` 不開面板，⌘K 仍然開', async () => {
    expect([...ROUTES_WITH_OWN_SLASH]).toEqual(['/formulas'])
    renderApp('/formulas')
    await screen.findByText('公式速查內容')
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    act(() => {
      document.body.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    await screen.findByRole('dialog')
  })

  it('手機：開面板會先收起抽屜', async () => {
    installMatchMedia([DRAWER_QUERY, NARROW_QUERY])
    renderApp()
    await screen.findByText('第五章內容')
    fireEvent.click(toggle()!)
    expect(document.querySelector('.app-shell.nav-open')).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    await screen.findByRole('dialog')
    expect(document.querySelector('.app-shell.nav-open')).toBeNull()
  })
})
