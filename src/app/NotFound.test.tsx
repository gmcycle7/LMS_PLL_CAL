import { render, screen, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NotFound } from './NotFound'
import { NavigationContext } from './navigation'
import { GROUP_LABEL, PAGES } from './registry'

function renderAt(path: string, openSearch = vi.fn(), announce = vi.fn()) {
  render(
    <NavigationContext.Provider value={{ generation: 1, announce, openSearch }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<p>這是 Dashboard</p>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    </NavigationContext.Provider>,
  )
  return { openSearch, announce }
}

describe('NotFound（404）', () => {
  it('說明哪個網址找不到；標題取得焦點並播報；document.title 是「找不到頁面」', () => {
    const { announce } = renderAt('/ch/99')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('找不到此頁面')
    expect(document.activeElement).toBe(h1)
    expect(screen.getByText('/ch/99').tagName).toBe('CODE')
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('找不到這一頁'))
    expect(document.title).toBe('找不到頁面 · LMS × PLL Calibration Lab')
  })

  it('三個出路：回 Dashboard、打開搜尋、章節清單（每個頁面都有連結，依群組分段）', () => {
    const { openSearch } = renderAt('/nope')
    const home = screen.getByRole('link', { name: /回 Dashboard/ })
    expect(home.getAttribute('href')).toBe('/')
    fireEvent.click(screen.getByRole('button', { name: /搜尋全站/ }))
    expect(openSearch).toHaveBeenCalledTimes(1)
    const list = screen.getByRole('navigation', { name: '章節清單' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(PAGES.length)
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      (['start', 'A', 'B', 'C', 'D', 'tools'] as const).flatMap((g) => PAGES.filter((p) => p.group === g).map((p) => p.path)),
    )
    expect(within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(
      (['start', 'A', 'B', 'C', 'D', 'tools'] as const).map((g) => GROUP_LABEL[g]),
    )
  })

  it('點「回 Dashboard」真的回到首頁', () => {
    renderAt('/nope')
    fireEvent.click(screen.getByRole('link', { name: /回 Dashboard/ }))
    expect(screen.getByText('這是 Dashboard')).toBeTruthy()
  })
})
