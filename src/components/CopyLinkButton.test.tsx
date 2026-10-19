import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CopyLinkButton, COPIED_FEEDBACK_MS } from './CopyLinkButton'

function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true })
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/ch/01')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setClipboard(undefined)
})

describe('CopyLinkButton', () => {
  it('按下去：把目前頁面 + ?a=／p=／seed= 的完整網址寫進剪貼簿，aria-live 區顯示「已複製」，之後消失', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    render(<CopyLinkButton experimentId="lms-playground" presetId="lms-stable" seed={42} />)
    const live = screen.getByRole('status')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '複製連結' }))
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toBe(`${window.location.origin}${window.location.pathname}#/ch/01?a=exp-lms-playground&p=lms-stable&seed=42`)
    expect(live.textContent).toBe('已複製')
    expect(screen.queryByLabelText('分享連結')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(COPIED_FEEDBACK_MS + 10)
    })
    expect(live.textContent).toBe('')
  })

  it('沒有 seed／preset：只有 a=', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    render(<CopyLinkButton experimentId="x" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '複製連結' }))
    })
    expect(writeText.mock.calls[0][0]).toMatch(/#\/ch\/01\?a=exp-x$/)
  })

  it('沒有 clipboard API：不假裝成功，顯示已全選、可選取的唯讀文字框', async () => {
    setClipboard(undefined)
    render(<CopyLinkButton experimentId="lms-playground" seed={7} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '複製連結' }))
    })
    const box = screen.getByLabelText('分享連結') as HTMLInputElement
    expect(box.readOnly).toBe(true)
    expect(box.value).toMatch(/#\/ch\/01\?a=exp-lms-playground&seed=7$/)
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(0)
    expect(box.selectionEnd).toBe(box.value.length)
    expect(screen.getByRole('status').textContent).toContain('無法自動複製')
    expect(screen.getByRole('status').textContent).not.toContain('已複製')
  })

  it('clipboard 被拒絕（權限、非 https）：同樣退回文字框', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    render(<CopyLinkButton experimentId="lms-playground" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '複製連結' }))
    })
    expect(screen.getByLabelText('分享連結')).toBeTruthy()
    expect(screen.getByRole('status').textContent).not.toContain('已複製')
  })

  it('網址在按下去的當下才算：props 改了，下一次複製就是新值', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    const { rerender } = render(<CopyLinkButton experimentId="e" seed={1} />)
    rerender(<CopyLinkButton experimentId="e" seed={2} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '複製連結' }))
    })
    expect(writeText.mock.calls[0][0]).toMatch(/seed=2$/)
  })
})
