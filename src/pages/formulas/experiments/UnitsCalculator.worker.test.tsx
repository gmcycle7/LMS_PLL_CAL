import { fireEvent, waitFor } from '@testing-library/react'
import { UnitsCalculator } from './UnitsCalculator'
import { buttonByText, count, mountAt, q, renderProblems } from '../domTestUtils'

/**
 * 換算器的 Monte Carlo 走 Web Worker 的三種情況（jsdom 沒有真正的 Worker，所以注入假的 WorkerLike）：
 *   ok   ：假 worker 以與 units.worker.ts 相同的 dispatch + loader 回應（含 structured clone）→ 標示「Web Worker」
 *   fail ：worker 一收到訊息就觸發 onerror（模擬模組載入失敗）→ 自動退回主執行緒，結果仍然出來，並說明原因
 *   hang ：worker 永遠不回應 → 按「停止」會 terminate，畫面回到可再執行的狀態，沒有殘留結果
 */
const W = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'fail' | 'hang', created: 0, terminated: 0, posted: 0 }))

vi.mock('plotly.js-cartesian-dist-min', async () => ({ default: (await import('../domTestUtils')).PLOTLY_STUB }))
vi.mock('./unitsWorker', async () => {
  const { dispatch } = await import('@/workers/dispatch')
  const { unitsModuleLoader } = await import('../unitsLoader')
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: ((e: ErrorEvent) => void) | null = null
    onmessageerror: ((e: MessageEvent) => void) | null = null
    private dead = false
    postMessage(msg: unknown) {
      W.posted++
      if (W.mode === 'hang') return
      if (W.mode === 'fail') {
        queueMicrotask(() => this.onerror?.({ message: '模組載入失敗（測試）', preventDefault: () => undefined } as unknown as ErrorEvent))
        return
      }
      const req = structuredClone(msg) as Parameters<typeof dispatch>[1]
      void dispatch(unitsModuleLoader, req).then((res) => {
        if (!this.dead) this.onmessage?.({ data: structuredClone(res) } as MessageEvent)
      })
    }
    terminate() {
      this.dead = true
      W.terminated++
    }
  }
  const createUnitsWorker = () => {
    W.created++
    return new FakeWorker()
  }
  return { createUnitsWorker, UNITS_WORKER_OPTIONS: { createWorker: createUnitsWorker, loader: unitsModuleLoader, restartOnRun: true } }
})

vi.setConfig({ testTimeout: 120_000 })

beforeEach(() => {
  W.mode = 'ok'
  W.created = 0
  W.terminated = 0
  W.posted = 0
})

const allText = (root: HTMLElement) => root.textContent ?? ''

describe('UnitsCalculator × Web Worker（注入假的 worker）', () => {
  it('T13: worker 正常：Run 的結果經由 worker 回來（|z| ≤ 4），說明標示「Web Worker」；離開頁面時 terminate', async () => {
    const { container, unmount } = mountAt(<UnitsCalculator />)
    const root = q(container, '#fr-units-calculator')
    fireEvent.click(buttonByText(root, /^(Run|執行)/))
    await waitFor(() => expect(allText(root)).toMatch(/引擎：精確 1-bit Binomial/), { timeout: 20_000 })
    expect(W.created).toBe(1)
    expect(W.posted).toBe(1) // A/B/C 所有 case 一次送出（一個訊息）
    const all = allText(root)
    expect(all).toMatch(/執行環境：Web Worker，\d+ ms（不佔用主執行緒）/)
    expect(all).not.toMatch(/Web Worker 失敗後自動改用/)
    expect(all).not.toMatch(/先換一個 seed 排除偶然/) // 沒有 mismatch
    expect(count(root, '.callout-danger')).toBe(0)
    expect(renderProblems(root)).toEqual([])
    unmount()
    expect(W.terminated).toBeGreaterThanOrEqual(1)
  })

  it('反面：worker 失敗（onerror）→ 自動改在主執行緒重算，同一個 seed 得到結果，並說明 worker 失敗的原因', async () => {
    W.mode = 'fail'
    const { container } = mountAt(<UnitsCalculator />)
    const root = q(container, '#fr-units-calculator')
    fireEvent.click(buttonByText(root, /^(Run|執行)/))
    await waitFor(() => expect(allText(root)).toMatch(/Web Worker 失敗後自動改用/), { timeout: 20_000 })
    const all = allText(root)
    expect(all).toMatch(/原因：模擬 worker 發生錯誤：模組載入失敗（測試）/)
    expect(all).toMatch(/引擎：精確 1-bit Binomial/) // 結果照樣出來，交叉比對 ok
    expect(all).not.toMatch(/Monte Carlo 無法執行/)
    expect(count(root, '.callout-danger')).toBe(0)
    expect(renderProblems(root)).toEqual([])
  })

  it('worker 沒有回應時可以按「停止」：terminate、回到可再執行的狀態、沒有殘留結果；之後再 Run 仍可用', async () => {
    W.mode = 'hang'
    const { container } = mountAt(<UnitsCalculator />)
    const root = q(container, '#fr-units-calculator')
    fireEvent.click(buttonByText(root, /^(Run|執行)/))
    const stop = await waitFor(() => buttonByText(root, /停止/))
    expect(allText(root)).toMatch(/尚未執行/)
    fireEvent.click(stop)
    await waitFor(() => expect(() => buttonByText(root, /^(Run|執行)/)).not.toThrow())
    expect(W.terminated).toBe(1)
    expect(allText(root)).toMatch(/尚未執行/)
    expect(allText(root)).not.toMatch(/Monte Carlo 無法執行/) // 取消不是錯誤
    // worker 恢復正常後再按一次
    W.mode = 'ok'
    fireEvent.click(buttonByText(root, /^(Run|執行)/))
    await waitFor(() => expect(allText(root)).toMatch(/執行環境：Web Worker/), { timeout: 20_000 })
    expect(W.created).toBe(2) // 取消後下一次 Run 重建 worker
  })
})
