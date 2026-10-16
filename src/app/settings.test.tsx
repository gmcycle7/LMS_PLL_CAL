import { act, render, screen } from '@testing-library/react'
import { DEFAULT_MODE, MODES, MODE_HINT, MODE_LABEL, MODE_SHORT, SettingsProvider, useSettings } from './settings'

function Probe() {
  const s = useSettings()
  return (
    <div>
      <span data-testid="mode">{s.mode}</span>
      <span data-testid="chosen">{String(s.modeChosen)}</span>
      <span data-testid="theme">{s.resolvedTheme}</span>
      <button type="button" onClick={() => s.setMode('research')}>
        research
      </button>
      <button type="button" onClick={() => s.setTheme('dark')}>
        dark
      </button>
    </div>
  )
}

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('SettingsProvider：第一次造訪的預設模式', () => {
  it('localStorage 沒有 lmspll.mode 時預設 beginner，而且 modeChosen = false（PageFrame 會顯示模式選擇器）', () => {
    expect(DEFAULT_MODE).toBe('beginner')
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('mode').textContent).toBe('beginner')
    expect(screen.getByTestId('chosen').textContent).toBe('false')
    // 只是預設值，不會自己寫進 localStorage（否則選擇器永遠不會出現）
    expect(localStorage.getItem('lmspll.mode')).toBeNull()
  })

  it.each(MODES)('存過 %s 時沿用，modeChosen = true', (m) => {
    localStorage.setItem('lmspll.mode', m)
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('mode').textContent).toBe(m)
    expect(screen.getByTestId('chosen').textContent).toBe('true')
  })

  it('不合法的值當作沒存過', () => {
    localStorage.setItem('lmspll.mode', 'expert')
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('mode').textContent).toBe('beginner')
    expect(screen.getByTestId('chosen').textContent).toBe('false')
  })

  it('setMode 寫入 localStorage 並把 modeChosen 設為 true', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    act(() => screen.getByRole('button', { name: 'research' }).click())
    expect(screen.getByTestId('mode').textContent).toBe('research')
    expect(screen.getByTestId('chosen').textContent).toBe('true')
    expect(localStorage.getItem('lmspll.mode')).toBe('research')
  })

  it('三種模式都有完整標籤、短標籤（單一英文單字）與章節頁提示（一句話、提到右上角可切換）', () => {
    for (const m of MODES) {
      expect(MODE_LABEL[m]).toMatch(/^(Beginner|Engineer|Research) /)
      expect(MODE_SHORT[m]).toMatch(/^[A-Za-z]+$/)
      expect(MODE_LABEL[m].startsWith(MODE_SHORT[m])).toBe(true)
      expect(MODE_HINT[m]).toMatch(/^目前是 (Beginner|Engineer|Research) 模式：.+右上角可切換。$/)
      expect(MODE_HINT[m]).not.toContain('\n')
    }
    expect(MODE_HINT.beginner).toBe('目前是 Beginner 模式：推導與程式碼預設收合，右上角可切換。')
  })
})

describe('SettingsProvider：主題', () => {
  it('掛載後 data-theme 跟著 resolvedTheme，切換主題時更新並寫入 localStorage', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    expect(document.documentElement.dataset.theme).toBe('light')
    act(() => screen.getByRole('button', { name: 'dark' }).click())
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('lmspll.theme')).toBe('dark')
  })
})
