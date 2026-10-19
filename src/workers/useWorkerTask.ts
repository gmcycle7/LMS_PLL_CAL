import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isWorkerCancelled, SimWorkerClient, type SimWorkerClientOptions } from './client'

export interface UseWorkerTaskOptions extends SimWorkerClientOptions {
  /**
   * true：新的 run() 會先 cancel 進行中的計算（終止 worker），適合「拖動滑桿只要最新結果」。
   * 被中止的 run() 以 WorkerCancelledError reject（用 isWorkerCancelled(err) 判斷後忽略）。
   */
  restartOnRun?: boolean
}

export interface WorkerTask<P, R> {
  /** 在 worker 中執行 module.fn(params)；cancel 時以 WorkerCancelledError reject */
  run: (params: P) => Promise<R>
  /** 終止 worker 並中止所有進行中的計算（下次 run 自動重建 worker） */
  cancel: () => void
  running: boolean
  /** 最近一次失敗的錯誤（取消不算錯誤）；下一次 run 開始時清除 */
  error: Error | null
  /** 最近一次成功執行的往返時間（ms） */
  lastDurationMs: number | null
  /** 'worker'：Web Worker；'inline'：環境不支援 Worker（例如 jsdom 測試）時在主執行緒執行 */
  mode: 'worker' | 'inline'
}

/**
 * 在 Web Worker 中執行 src/simulation/models/<module>.ts 匯出的純函式 fn(params)。
 *
 * 規則（詳見 src/workers/protocol.ts）：函式必須是純函式，參數與回傳值必須可 structured clone；
 * 回傳的 typed array 會以 transferable 零複製傳回。
 *
 * @example
 * const task = useWorkerTask<BlockLmsParams, BlockLmsResult>('blockLms', 'simulateBlockLms', { restartOnRun: true })
 * useEffect(() => {
 *   task.run(params).then(setResult).catch((e) => { if (!isWorkerCancelled(e)) console.error(e) })
 * }, [params])
 */
export function useWorkerTask<P, R>(module: string, fn: string, opts: UseWorkerTaskOptions = {}): WorkerTask<P, R> {
  const { restartOnRun = false, createWorker, loader, pool } = opts
  const clientRef = useRef<SimWorkerClient | null>(null)
  const optsRef = useRef<SimWorkerClientOptions>({ createWorker, loader, pool })
  optsRef.current = { createWorker, loader, pool }
  const mounted = useRef(true)
  // 每次 effect 掛載就加一；cleanup 時記下當時的值，稍後比對：沒變 = 真的卸載，變了 = StrictMode（或 Fast Refresh）立刻重新掛載了
  const generation = useRef(0)
  const inFlight = useRef(0)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastDurationMs, setLastDurationMs] = useState<number | null>(null)

  const getClient = useCallback((): SimWorkerClient => {
    if (!clientRef.current) clientRef.current = new SimWorkerClient(optsRef.current)
    return clientRef.current
  }, [])

  useEffect(() => {
    mounted.current = true
    const gen = ++generation.current
    return () => {
      mounted.current = false
      // React StrictMode（開發模式）會在掛載後立刻 cleanup 再重新掛載：如果在這裡同步 dispose，
      // 第一次 effect 裡呼叫的 run() 會被取消（WorkerCancelledError），而且白白多算一次。
      // 所以延到 microtask 再判斷：重新掛載是同步發生的（generation 已經變了）→ 保留 client 與進行中的計算；
      // 沒有重新掛載 = 真的卸載 → 這時才 dispose。
      queueMicrotask(() => {
        // 刻意讀「清理當下之後」的 generation：它要拿來判斷這段時間內有沒有重新掛載
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (generation.current !== gen || mounted.current) return
        clientRef.current?.dispose()
        clientRef.current = null
        inFlight.current = 0
      })
    }
  }, [])

  const run = useCallback(
    async (params: P): Promise<R> => {
      const client = getClient()
      if (restartOnRun && client.busy > 0) client.cancel('已由新的計算取代')
      inFlight.current++
      setRunning(true)
      setError(null)
      try {
        const { result, durationMs } = await client.run<R>(module, fn, params)
        if (mounted.current) setLastDurationMs(durationMs)
        return result
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        if (mounted.current && !isWorkerCancelled(e)) setError(e)
        throw e
      } finally {
        inFlight.current = Math.max(0, inFlight.current - 1)
        if (mounted.current) setRunning(inFlight.current > 0)
      }
    },
    [getClient, module, fn, restartOnRun],
  )

  const cancel = useCallback(() => {
    clientRef.current?.cancel()
  }, [])

  const mode = clientRef.current?.mode ?? (typeof Worker === 'undefined' ? 'inline' : 'worker')

  return useMemo(
    () => ({ run, cancel, running, error, lastDurationMs, mode }),
    [run, cancel, running, error, lastDurationMs, mode],
  )
}
