/**
 * 實驗 C 在 React StrictMode（dev 的預設）下也要自動跑完：StrictMode 會把 effect 先清理再跑一次，
 * useWorkerTask 的清理把第一次的計算取消了；自動重跑的鎖（lastAuto）若不在清理時解除，重新掛載後就永遠不會再跑，
 * 畫面停在「即時模擬尚未完成」（production build 沒有這個問題，所以只有 dev 看得到）。
 * 這裡以 jsdom 的 inline 模式（沒有 Worker）重現：有鎖沒解除時 spur 表永遠不出現。
 */
import { StrictMode } from 'react'
import { wrapPage } from '@/test/renderPage'
import { cleanup, render, waitFor } from '@testing-library/react'
import { ClosedLoopLms, LMS_EXPERIMENT_ID } from './experiments/ClosedLoopLms'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('實驗 C（閉迴路 LMS）在 StrictMode 下的自動重跑', () => {
  it('SSPLL: StrictMode 先清理再掛載一次之後，同一組參數仍會自動跑完——凍結後的 spur 表與三個 case 的指標都出現', async () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    const { container } = render(<StrictMode>{wrapPage(<ClosedLoopLms />, { url: '/case/sspll' })}</StrictMode>)
    const exp = () => container.querySelector(`#exp-${LMS_EXPERIMENT_ID}`) as HTMLElement
    expect(exp()).not.toBeNull()
    expect(exp().textContent).toContain('即時模擬尚未完成')
    await waitFor(() => expect(exp().textContent).toContain('凍結後的 spur 表'), { timeout: 60000 })
    expect(exp().textContent).not.toContain('即時模擬尚未完成')
    expect(exp().textContent).toMatch(/Case A（raw）不收斂/)
    expect(exp().textContent).toContain('凍結後最強的 fractional spur（閉合式）')
    expect(exp().textContent).not.toMatch(/模擬錯誤/)
  }, 90000)
})
