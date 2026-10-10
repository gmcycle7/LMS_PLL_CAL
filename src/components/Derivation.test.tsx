import type { ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { SettingsProvider } from '@/app/settings'
import { Derivation } from './Derivation'

function renderInMode(mode: 'beginner' | 'engineer' | 'research', ui: ReactElement) {
  localStorage.setItem('lmspll.mode', mode)
  return render(<SettingsProvider>{ui}</SettingsProvider>)
}

const ui = (
  <Derivation
    title="LMS 更新式的推導"
    formulaId="F-1.1"
    derivation={<p>沿負梯度更新</p>}
    symbols={[{ symbol: 'w_n', meaning: '第 n 次的係數估計', unit: '同 a' }]}
    units={{ e: 'fs', mu: 'fs⁻¹' }}
    assumptions={['x 固定', '無雜訊']}
    level="L0"
    claim="exact"
  />
)

afterEach(() => localStorage.clear())

describe('Derivation', () => {
  it('Beginner 模式預設收合', () => {
    renderInMode('beginner', ui)
    const toggle = screen.getByRole('button', { name: /LMS 更新式的推導/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('沿負梯度更新')).toBeNull()
  })

  it('Research 模式預設展開，且有五個分頁', () => {
    renderInMode('research', ui)
    expect(screen.getByText('沿負梯度更新')).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Derivation 推導',
      'Symbols 符號',
      'Units 單位',
      'Assumptions 假設',
      'Model Level 模型層級',
    ])
  })

  it('點擊展開並切換分頁；鍵盤方向鍵切換', () => {
    renderInMode('engineer', ui)
    fireEvent.click(screen.getByRole('button', { name: /LMS 更新式的推導/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Symbols 符號' }))
    expect(screen.getByText('第 n 次的係數估計')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Symbols 符號' }), { key: 'ArrowRight' })
    expect(screen.getByText('fs⁻¹')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Units 單位' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Model Level 模型層級' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toContain('時間基準：每 Sample')
  })

  it('沒有 SettingsProvider 時仍可使用（預設收合），defaultOpen 可覆寫', () => {
    render(<Derivation title="T" derivation={<p>body</p>} defaultOpen />)
    expect(screen.getByText('body')).toBeTruthy()
    // 只有 derivation 時不顯示分頁列
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })
})
