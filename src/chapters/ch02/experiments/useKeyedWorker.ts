import { useEffect, useMemo, useRef, useState } from 'react'
import { isWorkerCancelled, useWorkerTask } from '@/workers'

export interface KeyedWorkerState<R> {
  /** 與目前參數對應的結果（參數改變後、新結果回來前為 null） */
  result: R | null
  /** 上一份結果（計算中時可先顯示，標示為過期） */
  last: R | null
  pending: boolean
  error: string | null
  durationMs: number | null
  mode: 'worker' | 'inline'
}

/**
 * 參數一變就在 Worker 重算（restartOnRun：舊的計算會被取消），並以參數的 JSON 當 key，
 * 保證畫面上的 Monte Carlo 結果一定對應目前參數（不會把舊結果當新結果顯示）。
 * Effect 只依賴 key（內容），不依賴 params 物件的 identity：呼叫端忘了 useMemo 也不會無限重算。
 */
export function useKeyedWorker<P, R>(module: string, fn: string, params: P | null): KeyedWorkerState<R> {
  const task = useWorkerTask<P, R>(module, fn, { restartOnRun: true })
  const { run } = task
  const key = useMemo(() => (params === null ? '' : JSON.stringify(params)), [params])
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [state, setState] = useState<{ key: string; result: R | null; error: string | null }>({ key: '', result: null, error: null })
  useEffect(() => {
    const p = paramsRef.current
    if (p === null || key === '') return
    let alive = true
    run(p).then(
      (r) => {
        if (alive) setState({ key, result: r, error: null })
      },
      (e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setState({ key, result: null, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [key, run])
  const fresh = state.key === key
  return {
    result: fresh ? state.result : null,
    last: state.result,
    pending: params !== null && !fresh,
    error: fresh ? state.error : null,
    durationMs: task.lastDurationMs,
    mode: task.mode,
  }
}
