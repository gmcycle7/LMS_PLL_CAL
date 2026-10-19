import { Suspense, lazy } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import App from './App'
import { Layout } from './Layout'
import { DocumentTitle, documentTitleFor } from './navigation'
import { PageFrame } from './PageFrame'
import type { PageEntry } from './registry'
import { SettingsProvider } from './settings'

beforeEach(() => {
  localStorage.setItem('lmspll.mode', 'engineer')
  window.scrollTo = vi.fn()
})
afterEach(() => {
  localStorage.clear()
  window.location.hash = ''
})

describe('App：未知的路由顯示 404 頁', () => {
  it('path="*" 是 NotFound：標題、三個出路；「搜尋全站」打開全站搜尋面板', async () => {
    window.location.hash = '#/不存在的頁面'
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: '找不到此頁面' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /回 Dashboard/ })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '章節清單' })).toBeTruthy()
    expect(document.title).toBe('找不到頁面 · LMS × PLL Calibration Lab')
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /搜尋全站/ }))
    expect(await screen.findByRole('dialog', { name: '搜尋全站' }, { timeout: 10000 })).toBeTruthy()
  })
})

describe('document.title 隨頁面變：DocumentTitle 放在 PageFrame 後面，不會被 PageFrame 內部的標題蓋掉', () => {
  const entry: PageEntry = {
    id: 'ch05',
    path: '/ch/05',
    nav: '05 測試章',
    title: '第五章標題',
    group: 'B',
    component: lazy(() => Promise.resolve({ default: () => <p>第五章內容</p> })),
  }
  it('lazy 頁面載入完成後，最終標題是 registry 的 title', async () => {
    render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/05']}>
          <Layout>
            <Suspense fallback={<div>載入中…</div>}>
              <Routes>
                <Route
                  path={entry.path}
                  element={
                    <>
                      <PageFrame entry={entry} />
                      <DocumentTitle entry={entry} />
                    </>
                  }
                />
              </Routes>
            </Suspense>
          </Layout>
        </MemoryRouter>
      </SettingsProvider>,
    )
    await screen.findByText('第五章內容')
    await waitFor(() => expect(document.title).toBe(documentTitleFor(entry)))
    expect(document.title).toBe('第五章標題 · LMS × PLL Calibration Lab')
  })
})
