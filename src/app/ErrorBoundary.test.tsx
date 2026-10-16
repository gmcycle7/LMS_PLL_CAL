import { act, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'
import { CHUNK_RELOAD_KEY } from './lazyRetry'

function Boom({ message }: { message: string }): JSX.Element {
  throw new TypeError(message)
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errSpy.mockRestore()
  sessionStorage.clear()
})

describe('ErrorBoundary', () => {
  it('程式檔案載入失敗：顯示「重新載入頁面」（真的 reload，不是只 setState 讓 React.lazy 再丟同一個錯），並清掉一次性旗標', () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
    const reload = vi.fn()
    render(
      <ErrorBoundary reload={reload}>
        <Boom message="Failed to fetch dynamically imported module: https://x/assets/ch05-abc.js" />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('data-error-kind')).toBe('chunk')
    expect(alert.textContent).toContain('這一頁的程式檔案載入失敗')
    expect(screen.queryByRole('button', { name: '重試' })).toBeNull()
    act(() => screen.getByRole('button', { name: '重新載入頁面' }).click())
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull()
  })

  it('一般的執行錯誤：顯示錯誤訊息、「重試」會重新渲染子元件，另有「重新載入頁面」', () => {
    const reload = vi.fn()
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('Cannot read properties of undefined')
      return <p>恢復了</p>
    }
    render(
      <ErrorBoundary label="實驗" reload={reload}>
        <Flaky />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('data-error-kind')).toBe('runtime')
    expect(alert.textContent).toContain('實驗：元件執行錯誤')
    expect(alert.textContent).toContain('Cannot read properties of undefined')
    shouldThrow = false
    act(() => screen.getByRole('button', { name: '重試' }).click())
    expect(screen.getByText('恢復了')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })
})
