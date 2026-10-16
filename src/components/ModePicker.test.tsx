import { act, render, screen } from '@testing-library/react'
import { MODES, MODE_LABEL, SettingsProvider, useSettings } from '@/app/settings'
import { MODE_BLURB, MODE_PICKER_DISMISS, ModePicker } from './ModePicker'

function ModeProbe() {
  const { mode } = useSettings()
  return <span data-testid="mode">{mode}</span>
}

function renderPicker() {
  return render(
    <SettingsProvider>
      <ModePicker />
      <ModeProbe />
    </SettingsProvider>,
  )
}

afterEach(() => localStorage.clear())

describe('ModePicker（第一次造訪的一次性模式選擇器）', () => {
  it('localStorage 沒有 lmspll.mode 時顯示三張卡片（各一句說明）與「先用 Beginner 看看」', () => {
    renderPicker()
    const picker = screen.getByTestId('mode-picker')
    expect(picker.querySelector('h2')?.textContent).toBe('先選一個學習模式')
    const cards = picker.querySelectorAll('button.c-modepicker-card')
    expect(cards).toHaveLength(3)
    MODES.forEach((m, i) => {
      expect(cards[i].getAttribute('data-mode')).toBe(m)
      expect(cards[i].querySelector('strong')?.textContent).toBe(MODE_LABEL[m])
      expect(cards[i].querySelector('span')?.textContent).toBe(MODE_BLURB[m])
      // 一句話：單一句號結尾、沒有換行、不要太長
      expect(MODE_BLURB[m]).toMatch(/。$/)
      expect(MODE_BLURB[m].split('。').filter(Boolean)).toHaveLength(1)
      expect(MODE_BLURB[m].length).toBeLessThanOrEqual(60)
    })
    expect(screen.getByRole('button', { name: MODE_PICKER_DISMISS })).toBeTruthy()
    expect(screen.getByTestId('mode').textContent).toBe('beginner')
  })

  it('選 Engineer：寫入 localStorage、切換模式、選擇器消失', () => {
    renderPicker()
    act(() => (screen.getByTestId('mode-picker').querySelector('button[data-mode="engineer"]') as HTMLButtonElement).click())
    expect(localStorage.getItem('lmspll.mode')).toBe('engineer')
    expect(screen.getByTestId('mode').textContent).toBe('engineer')
    expect(screen.queryByTestId('mode-picker')).toBeNull()
  })

  it('「先用 Beginner 看看」：也會存 beginner，之後不再出現', () => {
    renderPicker()
    act(() => screen.getByRole('button', { name: MODE_PICKER_DISMISS }).click())
    expect(localStorage.getItem('lmspll.mode')).toBe('beginner')
    expect(screen.queryByTestId('mode-picker')).toBeNull()
  })

  it.each(MODES)('已存過 %s 時不顯示', (m) => {
    localStorage.setItem('lmspll.mode', m)
    renderPicker()
    expect(screen.queryByTestId('mode-picker')).toBeNull()
  })
})
