import { deserializeError, dispatch } from './dispatch'
import { loadModelModule } from './modelLoader'
import type { ModuleLoader, WorkerRequest, WorkerResponse } from './protocol'

/** run() 因 cancel() / 新的 run（restartOnRun）/ dispose 而中止時丟出的錯誤 */
export class WorkerCancelledError extends Error {
  constructor(message = '模擬已取消') {
    super(message)
    this.name = 'WorkerCancelledError'
  }
}

export function isWorkerCancelled(err: unknown): err is WorkerCancelledError {
  return err instanceof WorkerCancelledError || (err instanceof Error && err.name === 'WorkerCancelledError')
}

export interface RunResult<R> {
  result: R
  /** 主執行緒量到的往返時間（含傳輸），ms */
  durationMs: number
}

/** 最小 Worker 介面（方便以假物件測試） */
export interface WorkerLike {
  postMessage(msg: unknown): void
  terminate(): void
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  onmessageerror: ((e: MessageEvent) => void) | null
}

export interface SimWorkerClientOptions {
  /**
   * 建立 worker；回傳 null 表示不可用 → 改用 inline（主執行緒）模式。
   * 預設：瀏覽器有 Worker 時建立 sim.worker；jsdom / node 測試環境沒有 Worker → inline。
   */
  createWorker?: () => WorkerLike | null
  /** inline 模式使用的模組載入器（預設與 worker 相同的 import.meta.glob 對應表） */
  loader?: ModuleLoader
}

function defaultCreateWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null
  return new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'lmspll-sim' })
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function cloneLikeWorker<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : v
}

interface Pending {
  resolve: (r: RunResult<unknown>) => void
  reject: (e: Error) => void
  t0: number
}

/**
 * 管理一個 sim.worker 實例與待完成的請求。
 * - cancel()：終止 worker（真正停止計算）、拒絕所有待完成請求，下次 run 時重建 worker。
 * - Worker 不可用（或建立失敗）時退回 inline：在主執行緒以相同 dispatch 執行，
 *   並對 params / result 做 structuredClone，使語意與 worker 一致（不可 clone 的資料同樣會報錯）。
 */
export class SimWorkerClient {
  private worker: WorkerLike | null = null
  private inline = false
  private disposed = false
  private nextId = 1
  private pending = new Map<number, Pending>()
  private readonly createWorker: () => WorkerLike | null
  private readonly loader: ModuleLoader

  constructor(opts: SimWorkerClientOptions = {}) {
    this.createWorker = opts.createWorker ?? defaultCreateWorker
    this.loader = opts.loader ?? loadModelModule
  }

  /** 'worker' 或 'inline'（尚未執行過時依環境推測） */
  get mode(): 'worker' | 'inline' {
    if (this.inline) return 'inline'
    if (this.worker) return 'worker'
    return typeof Worker === 'undefined' ? 'inline' : 'worker'
  }

  /** 待完成的請求數 */
  get busy(): number {
    return this.pending.size
  }

  run<R>(module: string, fn: string, params: unknown): Promise<RunResult<R>> {
    if (this.disposed) return Promise.reject(new WorkerCancelledError('SimWorkerClient 已釋放'))
    const id = this.nextId++
    const req: WorkerRequest = { id, module, fn, params }
    return new Promise<RunResult<R>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: RunResult<unknown>) => void, reject, t0: now() })
      const w = this.ensureWorker()
      if (w) {
        try {
          w.postMessage(req)
        } catch (err) {
          // 例如 params 含函式 → DataCloneError
          this.pending.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
        return
      }
      void this.runInline(req)
    })
  }

  /** 中止所有進行中的計算 */
  cancel(reason = '模擬已取消'): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    const err = new WorkerCancelledError(reason)
    const list = [...this.pending.values()]
    this.pending.clear()
    for (const p of list) p.reject(err)
  }

  dispose(): void {
    this.cancel('SimWorkerClient 已釋放')
    this.disposed = true
  }

  private ensureWorker(): WorkerLike | null {
    if (this.inline) return null
    if (this.worker) return this.worker
    let w: WorkerLike | null = null
    try {
      w = this.createWorker()
    } catch (err) {
      console.warn('[SimWorkerClient] 無法建立 Web Worker，改在主執行緒執行：', err)
      w = null
    }
    if (!w) {
      this.inline = true
      return null
    }
    w.onmessage = (e: MessageEvent) => this.onResponse(e.data as WorkerResponse)
    w.onerror = (e: ErrorEvent) => {
      e.preventDefault?.()
      this.failAll(new Error(`模擬 worker 發生錯誤：${e.message || '未知錯誤（可能是模組載入失敗）'}`))
    }
    w.onmessageerror = () => this.failAll(new Error('模擬 worker 回傳的資料無法反序列化'))
    this.worker = w
    return w
  }

  /** worker 本身出錯（非單一請求的錯誤）：終止並拒絕所有請求，下次 run 重建 */
  private failAll(err: Error): void {
    this.worker?.terminate()
    this.worker = null
    const list = [...this.pending.values()]
    this.pending.clear()
    for (const p of list) p.reject(err)
  }

  private onResponse(res: WorkerResponse): void {
    const p = this.pending.get(res.id)
    if (!p) return // 已取消
    this.pending.delete(res.id)
    if (res.ok) p.resolve({ result: res.result, durationMs: now() - p.t0 })
    else p.reject(deserializeError(res.error))
  }

  private async runInline(req: WorkerRequest): Promise<void> {
    let params: unknown
    try {
      params = cloneLikeWorker(req.params)
    } catch (err) {
      const p = this.pending.get(req.id)
      this.pending.delete(req.id)
      p?.reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    // 讓出主執行緒一個 microtask，使 run() 的呼叫端先完成同步狀態更新
    await Promise.resolve()
    if (!this.pending.has(req.id)) return
    const res = await dispatch(this.loader, { ...req, params })
    if (res.ok) {
      try {
        this.onResponse({ ...res, result: cloneLikeWorker(res.result) })
      } catch (err) {
        this.onResponse({
          id: res.id,
          ok: false,
          error: {
            name: 'DataCloneError',
            message: `函式 ${req.module}.${req.fn} 的回傳值需可 structured clone：${err instanceof Error ? err.message : String(err)}`,
          },
        })
      }
    } else {
      this.onResponse(res)
    }
  }
}
