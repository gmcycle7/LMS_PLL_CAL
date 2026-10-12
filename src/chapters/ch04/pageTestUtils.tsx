/**
 * Ch04 整頁（jsdom）測試共用的輔助函式（只給 ch04.test.tsx 與 ch04.interaction.test.tsx 用，頁面不會匯入）。
 *
 * 整頁渲染一次約 10 萬個 DOM 節點；jsdom 下同一個 worker 每渲染一次，heap 會多留數百 MB，所以需要整頁渲染的測試分成兩個檔案
 * （各自一個 worker、各自的 heap 上限）。vi.mock 必須寫在各自的測試檔裡（會被 hoist），這裡只放不依賴 mock 的函式。
 */
import { StrictMode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import Chapter04 from './index'

export function renderAt(url = '/ch/04', strict = false) {
  const tree = (
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <Chapter04 />
      </MemoryRouter>
    </SettingsProvider>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

/** KaTeX 節點換成它的 TeX 原始碼（annotation）：含公式的指標名稱、警告、交叉比對附註可以直接比對文字 */
export function texText(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.katex').forEach((k) => k.replaceWith(k.querySelector('annotation')?.textContent ?? ''))
  return c.textContent ?? ''
}

/**
 * 程式碼區塊以外的文字（程式碼裡的 template literal 本來就有 $）。
 * TestBadge 的提示框（.c-tip-list）逐字列出測試名稱，名稱本身可能含有「`$...$`」這種字樣（例如別頁的顯示層測試），
 * 那是原文照錄、不是沒轉成 KaTeX 的公式，所以和程式碼一樣排除。
 */
export function proseText(el: Element): string {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('pre, code, .c-code, .c-tip-list').forEach((k) => k.remove())
  return c.textContent ?? ''
}

/** 某個實驗的 ExperimentShell（整頁約 10 萬個 DOM 節點：輪詢時只複製這一塊，不要每次複製整頁） */
export function shellOf(root: ParentNode, experimentId: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#exp-${experimentId}`)
  if (!el) throw new Error(`找不到實驗 ${experimentId}`)
  return el
}

/**
 * jsdom 整頁渲染的逾時（ms）。單獨跑一個測試約 15–25 秒；同一個 worker 連續渲染多次、或機器同時在跑其他測試時會慢好幾倍，
 * 所以給寬鬆的上限——逾時只是保護，判定仍由斷言決定。
 */
export const PAGE_TIMEOUT = 240_000
export const WAIT = { timeout: 90_000 }

export function caseButtons(root: ParentNode, experimentId: string): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(`#exp-${experimentId} .c-case-btn`))
}
