/**
 * Verification 頁 jsdom 測試共用的小工具（index.test.tsx 與 index.heavy.test.tsx）。
 * 整頁渲染一次會在 worker 的 heap 留下近 300 MB（unmount 之後仍沒釋放），單一檔案渲染十幾次就逼近 4.5 GB 的上限（OOM = Worker exited unexpectedly），
 * 所以測試拆成兩個檔案，各自一個 worker。vi.mock 必須留在各測試檔（會被提升），這裡只放與 mock 無關的工具。
 */
import type { ReactNode } from 'react'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, type LearningMode } from '@/app/settings'

export function wrap(ui: ReactNode, url: string, mode: LearningMode) {
  localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </SettingsProvider>,
  )
}

/**
 * 等本頁所有「延後載入」的區塊（NearGate 的占位區）都換成真正的內容。
 * jsdom 沒有 IntersectionObserver，NearGate 立刻掛載 React.lazy 的區塊，但 chunk 是非同步載入的：
 * 要檢查 §V.3–§V.6 或驗收表展開列裡的程式碼時，先 await 這個。占位區都帶 data-lazy-gate（見 lazy.tsx）。
 */
export async function settleLazy(container: ParentNode = document, timeout = 60_000): Promise<void> {
  await waitFor(() => expect(container.querySelector('[data-lazy-gate]'), '還有延後載入的區塊沒有載完').toBeNull(), { timeout, interval: 25 })
}
