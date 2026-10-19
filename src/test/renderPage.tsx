/**
 * jsdom 測試的渲染包裝：SettingsProvider（學習模式、主題）＋ MemoryRouter（網址）。
 *
 * 整章／整頁的測試幾乎都要這兩層；各檔原本各寫一份 `renderChapter`／`renderPage`／`renderAt`，現在統一從這裡來：
 *
 *   import { renderPage } from '@/test/renderPage'
 *   const { container } = renderPage(<Chapter05 />, { url: '/ch/05', mode: 'engineer' })
 *
 * - `mode`：寫進 `localStorage['lmspll.mode']`（SettingsProvider 初次渲染時讀取）。**沒給就不動 localStorage**，
 *   沿用上一個測試留下的值或預設的 Beginner（Beginner 把很多區塊藏起來；要數圖、數段落請明確寫 'engineer' 或 'research'）。
 * - `url`：MemoryRouter 的初始網址（預設 '/'）。
 * - `future`：true 時打開 React Router 的 v7 future flags（`v7_startTransition`、`v7_relativeSplatPath`），
 *   只在原本就這樣設定的測試用（會改變導航更新的時序）。
 * - `routes`：要把 `ui` 放在哪個 `<Route path>` 底下，其餘路徑顯示「其他頁面」；用在要測導航的案例。
 * - 回傳值是 RTL 的 `RenderResult`；`rerender` 只換 `ui`（外層兩層保持原樣，狀態不會被重置）。
 */
import type { ReactNode } from 'react'
import { act, render, type RenderResult } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'

export type TestMode = 'beginner' | 'engineer' | 'research'

export interface RenderPageOptions {
  mode?: TestMode
  url?: string
  future?: boolean
  /** 把 `ui` 掛在這個路由 pattern 底下（例如 '/lab'）；其餘網址顯示 `<div data-testid="other-page">`。 */
  routePath?: string
}

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const

/** 設定學習模式（localStorage 不可用時沿用預設）。需要在 render 之前呼叫的測試可以單獨用。 */
export function setTestMode(mode: TestMode): void {
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* storage 不可用時沿用預設 */
  }
}

/** 包好 Settings＋Router 的元素樹（不 render）；給需要自己呼叫 render／rerender 的測試。 */
export function wrapPage(ui: ReactNode, opts: Pick<RenderPageOptions, 'url' | 'future' | 'routePath'> = {}): ReactNode {
  const { url = '/', future = false, routePath } = opts
  const body = routePath ? (
    <Routes>
      <Route path={routePath} element={ui} />
      <Route path="*" element={<div data-testid="other-page">其他頁面</div>} />
    </Routes>
  ) : (
    ui
  )
  return (
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]} future={future ? FUTURE : undefined}>
        {body}
      </MemoryRouter>
    </SettingsProvider>
  )
}

export function renderPage(ui: ReactNode, opts: RenderPageOptions = {}): RenderResult {
  if (opts.mode) setTestMode(opts.mode)
  return render(wrapPage(ui, opts))
}

export interface SharedMount {
  container: HTMLElement
  unmount: () => void
}

/**
 * 整章／整頁只渲染一次、給同一個 `describe` 裡的多個 `it` 共用（巨型測試拆分用，見 docs/dev-conventions.md §6）。
 *
 * RTL 的 `render` 會在每個測試之後自動 cleanup，`beforeAll` 裡 render 的樹在第一個 `it` 結束時就被卸載了；
 * 這個函式改用 react-dom 的 `createRoot` 掛在 `document.body` 底下（RTL 不追蹤，所以不會被 cleanup），由呼叫端在 `afterAll` 卸載：
 *
 *   describe('Ch06 Research 模式整章', () => {
 *     let page: SharedMount
 *     beforeAll(() => { page = mountPageOnce(<Chapter06 />, { url: '/ch/06', mode: 'research' }) }, FULL_TIMEOUT)
 *     afterAll(() => page.unmount())
 *     it('骨架', () => { expect(page.container.querySelector('#ch06-s1')).not.toBeNull() })
 *     it('實驗', async () => { await waitFor(…) })   // `screen`／`waitFor` 照常可用（容器在 document.body 底下）
 *   })
 *
 * 注意：共用的是同一棵 DOM，所以（1）會改動 DOM 的操作（點按鈕、改輸入）放在只讀斷言之後，或另外開一個 describe；
 * （2）`src/test/setup.jsdom.ts` 在每個 `it` 之後清空 plotlyMock／mermaidMock 的呼叫紀錄，要比對這些呼叫的話在 `beforeAll` 裡先複製出來。
 */
export function mountPageOnce(ui: ReactNode, opts: RenderPageOptions = {}): SharedMount {
  if (opts.mode) setTestMode(opts.mode)
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  act(() => {
    root.render(wrapPage(ui, opts))
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}
