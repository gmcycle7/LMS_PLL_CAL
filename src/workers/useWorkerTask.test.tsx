import { StrictMode, useEffect } from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { isWorkerCancelled } from './client'
import type { ModuleLoader } from './protocol'
import { useWorkerTask } from './useWorkerTask'

// jsdom 沒有 Worker → useWorkerTask 走 inline fallback；以注入的 loader 取代 import.meta.glob
const loader: ModuleLoader = async (name) => {
  if (name !== 'scalarLms') throw new Error(`找不到模擬模組 '${name}'`)
  return {
    // 固定 x 的 scalar LMS 誤差：δ_{n+1} = (1 − μx²) δ_n（規格 §3）
    deltaAfter: (p: { delta0: number; mu: number; x: number; n: number }) => p.delta0 * Math.pow(1 - p.mu * p.x * p.x, p.n),
    slow: (p: { ms: number; tag: string }) => new Promise((r) => setTimeout(() => r(p.tag), p.ms)),
    fail: () => {
      throw new Error('λ_min = 0：不可辨識')
    },
  }
}

describe('useWorkerTask（inline fallback）', () => {
  it('run 回傳結果並更新 running / lastDurationMs', async () => {
    const { result } = renderHook(() =>
      useWorkerTask<{ delta0: number; mu: number; x: number; n: number }, number>('scalarLms', 'deltaAfter', { loader }),
    )
    expect(result.current.mode).toBe('inline')
    expect(result.current.running).toBe(false)
    let out = NaN
    await act(async () => {
      out = await result.current.run({ delta0: 2, mu: 0.1, x: 2, n: 2 })
    })
    // 手算：δ_2 = 2·(1 − 0.4)² = 0.72（對應 w_2 = 3 − 0.72 = 2.28）
    expect(out).toBeCloseTo(0.72, 14)
    expect(result.current.running).toBe(false)
    expect(result.current.lastDurationMs).not.toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('錯誤寫入 error 並 reject', async () => {
    const { result } = renderHook(() => useWorkerTask<object, never>('scalarLms', 'fail', { loader }))
    let caught: unknown
    await act(async () => {
      caught = await result.current.run({}).catch((e: unknown) => e)
    })
    expect((caught as Error).message).toBe('λ_min = 0：不可辨識')
    expect(result.current.error?.message).toBe('λ_min = 0：不可辨識')
  })

  it('restartOnRun：新的 run 取消前一個（取消不算錯誤）', async () => {
    const { result } = renderHook(() =>
      useWorkerTask<{ ms: number; tag: string }, string>('scalarLms', 'slow', { loader, restartOnRun: true }),
    )
    let first: Promise<string> = Promise.resolve('')
    act(() => {
      first = result.current.run({ ms: 40, tag: 'old' })
    })
    await waitFor(() => expect(result.current.running).toBe(true))
    let second = ''
    await act(async () => {
      const p = result.current.run({ ms: 1, tag: 'new' })
      const err = await first.catch((e: unknown) => e)
      expect(isWorkerCancelled(err)).toBe(true)
      second = await p
    })
    expect(second).toBe('new')
    expect(result.current.error).toBeNull()
    expect(result.current.running).toBe(false)
  })

  it('cancel() 中止進行中的 run', async () => {
    const { result } = renderHook(() => useWorkerTask<{ ms: number; tag: string }, string>('scalarLms', 'slow', { loader }))
    let p: Promise<string> = Promise.resolve('')
    act(() => {
      p = result.current.run({ ms: 50, tag: 'x' })
    })
    let err: unknown
    await act(async () => {
      result.current.cancel()
      err = await p.catch((e: unknown) => e)
    })
    expect(isWorkerCancelled(err)).toBe(true)
    expect(result.current.running).toBe(false)
  })

  it('卸載時釋放 client，之後的回應不會更新狀態', async () => {
    const { result, unmount } = renderHook(() => useWorkerTask<{ ms: number; tag: string }, string>('scalarLms', 'slow', { loader }))
    let p: Promise<string> = Promise.resolve('')
    act(() => {
      p = result.current.run({ ms: 20, tag: 'x' })
    })
    unmount()
    const err = await p.catch((e: unknown) => e)
    expect(isWorkerCancelled(err)).toBe(true)
  })
})

describe('useWorkerTask：StrictMode 的雙重 effect', () => {
  /** 掛載時在 effect 裡呼叫 run()（章節實驗的慣用寫法）；把每次 run 的 promise 收集起來 */
  function Probe({ runs, onTask }: { runs: Promise<string>[]; onTask?: (t: ReturnType<typeof useWorkerTask<{ ms: number; tag: string }, string>>) => void }) {
    const task = useWorkerTask<{ ms: number; tag: string }, string>('scalarLms', 'slow', { loader })
    onTask?.(task)
    useEffect(() => {
      runs.push(task.run({ ms: 10, tag: `run${runs.length + 1}` }))
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在掛載時跑一次（StrictMode 會再跑一次）
    }, [])
    return null
  }

  it('第一次 effect 的 run() 不會被 StrictMode 的模擬卸載取消，兩次 run 都完成', async () => {
    const runs: Promise<string>[] = []
    render(
      <StrictMode>
        <Probe runs={runs} />
      </StrictMode>,
    )
    expect(runs).toHaveLength(2) // StrictMode：effect 跑了兩次
    let settled: PromiseSettledResult<string>[] = []
    await act(async () => {
      settled = await Promise.allSettled(runs)
    })
    expect(settled.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(settled.map((r) => (r as PromiseFulfilledResult<string>).value)).toEqual(['run1', 'run2'])
  })

  it('非 StrictMode 的真正卸載仍會釋放 client 並取消進行中的 run', async () => {
    const runs: Promise<string>[] = []
    const { unmount } = render(<Probe runs={runs} />)
    expect(runs).toHaveLength(1)
    unmount()
    const err = await runs[0].catch((e: unknown) => e)
    expect(isWorkerCancelled(err)).toBe(true)
  })

  it('StrictMode 之後真正卸載：進行中的 run 仍會被取消（generation 比對只吃掉模擬卸載）', async () => {
    const runs: Promise<string>[] = []
    const { unmount } = render(
      <StrictMode>
        <Probe runs={runs} />
      </StrictMode>,
    )
    await Promise.resolve() // 讓模擬卸載排下的 microtask 先跑完（此時不該 dispose）
    unmount()
    const settled = await Promise.allSettled(runs)
    expect(settled.every((r) => r.status === 'rejected' && isWorkerCancelled(r.reason))).toBe(true)
  })
})
