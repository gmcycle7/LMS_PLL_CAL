import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ErratumLink, erratumRoute } from './index'

afterEach(cleanup)

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

describe('ErratumLink', () => {
  it('顯示「勘誤 E44」，連到 /verification?e=E44；提示有嚴重度與區域', () => {
    render(
      <MemoryRouter>
        <ErratumLink id="E44" />
      </MemoryRouter>,
    )
    const a = screen.getByText('勘誤 E44').closest('a')!
    expect(a.getAttribute('href')).toBe('/verification?e=E44')
    expect(a.getAttribute('data-erratum')).toBe('E44')
    expect(a.getAttribute('title')).toMatch(/^E44（(嚴重|中|輕微)）：\S/)
    expect(a.getAttribute('title')).not.toContain('$')
    expect(a.hasAttribute('data-missing')).toBe(false)
  })

  it('在 Router 裡點擊是站內導覽（路由變成 /verification?e=E44）', () => {
    render(
      <MemoryRouter initialEntries={['/ch/05']}>
        <Routes>
          <Route path="*" element={<><ErratumLink id="E44">DTC 極性</ErratumLink><Where /></>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where').textContent).toBe('/ch/05')
    expect(screen.getByText('：DTC 極性')).toBeTruthy()
    fireEvent.click(screen.getByText('勘誤 E44', { exact: false }))
    expect(screen.getByTestId('where').textContent).toBe('/verification?e=E44')
  })

  it('Router 之外（單元測試）退回 <a href="#/verification?e=…">', () => {
    render(<ErratumLink id="E05" />)
    expect(screen.getByText('勘誤 E05').closest('a')!.getAttribute('href')).toBe('#/verification?e=E05')
  })

  it('找不到的編號：照樣是連結，但標示 data-missing 且提示說找不到', () => {
    render(<ErratumLink id="E99" />)
    const a = screen.getByText('勘誤 E99').closest('a')!
    expect(a.getAttribute('data-missing')).toBe('true')
    expect(a.getAttribute('title')).toContain('找不到此勘誤')
  })

  it('erratumRoute 編碼特殊字元', () => {
    expect(erratumRoute('E44')).toBe('/verification?e=E44')
    expect(erratumRoute('E 4&4')).toBe('/verification?e=E%204%264')
  })
})
