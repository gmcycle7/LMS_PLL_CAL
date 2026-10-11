/**
 * Verification 頁 jsdom 測試共用的小工具（index.test.tsx 與 index.heavy.test.tsx）。
 * 整頁渲染一次會在 worker 的 heap 留下近 300 MB（unmount 之後仍沒釋放），單一檔案渲染十幾次就逼近 4.5 GB 的上限（OOM = Worker exited unexpectedly），
 * 所以測試拆成兩個檔案，各自一個 worker。vi.mock 必須留在各測試檔（會被提升），這裡只放與 mock 無關的工具。
 */
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
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
