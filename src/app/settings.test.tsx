import { act, render, screen } from '@testing-library/react'
import { DEFAULT_MODE, MODES, MODE_HINT, MODE_LABEL, MODE_SHORT, ModeGate, SettingsProvider, useSettings } from './settings'

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

describe('ModeGate：Beginner 看不到的區塊留一行佔位', () => {
  const gated = (min: 'engineer' | 'research', summary?: string) => (
    <SettingsProvider>
      <Probe />
      <ModeGate min={min} summary={summary}>
        <p>進階內容</p>
      </ModeGate>
    </SettingsProvider>
  )

  it('Beginner：不渲染內容，改顯示「這一段在 Engineer 模式才展開：摘要」與切換按鈕；按下去切換並展開', () => {
    const { container } = render(gated('engineer', '單位換算的細節'))
    expect(screen.queryByText('進階內容')).toBeNull()
    const hint = container.querySelector('.c-modegate')!
    expect(hint.textContent).toContain('（這一段在 Engineer 模式才展開：單位換算的細節）')
    act(() => screen.getByRole('button', { name: '切換到 Engineer' }).click())
    expect(screen.getByTestId('mode').textContent).toBe('engineer')
    expect(localStorage.getItem('lmspll.mode')).toBe('engineer')
    expect(screen.getByText('進階內容')).toBeTruthy()
    expect(container.querySelector('.c-modegate')).toBeNull()
  })

  it('沒給 summary：顯示通用句；min=research 的按鈕直接切到 Research', () => {
    const { container } = render(gated('research'))
    expect(container.querySelector('.c-modegate')!.textContent).toContain('（這一段在 Research 模式才展開）')
    act(() => screen.getByRole('button', { name: '切換到 Research' }).click())
    expect(screen.getByTestId('mode').textContent).toBe('research')
  })

  it('summary 可含行內公式（以 KaTeX 排版）', () => {
    const { container } = render(gated('engineer', '$\\mu$ 的上界'))
    expect(container.querySelector('.c-modegate .katex')).toBeTruthy()
  })

  it('Engineer 看 Research 區塊：維持原樣（不渲染、不加佔位）；夠高的模式直接顯示內容', () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    const a = render(gated('research'))
    expect(a.container.querySelector('.c-modegate')).toBeNull()
    expect(screen.queryByText('進階內容')).toBeNull()
    a.unmount()
    localStorage.setItem('lmspll.mode', 'research')
    render(gated('research'))
    expect(screen.getByText('進階內容')).toBeTruthy()
  })
})
