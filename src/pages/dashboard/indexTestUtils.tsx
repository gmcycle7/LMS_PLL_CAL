/**
 * Dashboard 頁 jsdom 測試共用的小工具（index.test.tsx 與 index.research.test.tsx）。
 * 整頁約 5 萬個 DOM 節點，每渲染一次就會在 worker 的 heap 留下約 200 MB（unmount 之後仍然沒釋放），
 * 單一檔案渲染十幾次就會超過 4.5 GB 的上限而 OOM（Worker exited unexpectedly），所以測試拆成兩個檔案，各自一個 worker。
 * vi.mock 必須留在各測試檔（會被提升），這裡只放與 mock 無關的工具。
 */
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PAGES } from '@/app/registry'
import { SettingsProvider } from '@/app/settings'
import DashboardPage from './index'

export const PAGE_PATHS = new Set(PAGES.map((p) => p.path))

export function renderPage(mode: 'beginner' | 'engineer' | 'research' = 'engineer', url = '/') {
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
export const texIn = (el: Element | null): string[] => Array.from(el?.querySelectorAll('annotation[encoding="application/x-tex"]') ?? [], (a) => a.textContent ?? '')

/**
 * 拿掉 KaTeX 與程式碼之後的純文字。
 * 也拿掉 .c-tip：TestBadge 的 tooltip 逐條列出全站測試名稱（來自 verify 產生的 JSON），其他頁的測試標題可能合法地含有「NaN」「$…$」。
 */
export function plainText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex, pre, code, .c-code, .c-tip, script, style').forEach((x) => x.remove())
  return clone.textContent ?? ''
}

export const precedes = (x: Element | null, y: Element | null) => !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
