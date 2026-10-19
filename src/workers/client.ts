import { deserializeError, dispatch } from './dispatch'
import { WorkerCancelledError, isWorkerCancelled } from './errors'
import { loadModelModule } from './modelLoader'
import { WorkerPool, getSharedWorkerPool, type PoolJob, type WorkerLike } from './pool'
import type { ModuleLoader, WorkerRequest, WorkerResponse } from './protocol'

// 錯誤類別搬到 ./errors（pool 也要用，避免 client ↔ pool 循環匯入）；這裡照舊匯出，既有的 import 不受影響
export { WorkerCancelledError, isWorkerCancelled }
export type { WorkerLike }

export interface RunResult<R> {
  result: R
  /** 主執行緒量到的往返時間（含傳輸），ms */
  durationMs: number
}

export interface SimWorkerClientOptions {
  /**
   * 建立 worker；回傳 null 表示不可用 → 改用 inline（主執行緒）模式。
   * 不給：使用全站共用的 worker pool（瀏覽器有 Worker 時是 sim.worker，最多 2 條、閒置 60 s 回收；jsdom / node 測試環境沒有 Worker → inline）。
   * 給了：這個 client 用自己私有的 pool（測試注入假 worker 用），dispose 時一併釋放。
   */
  createWorker?: () => WorkerLike | null
  /** 直接指定 pool（優先於 createWorker；不會在 dispose 時釋放，因為不是 client 擁有的） */
  pool?: WorkerPool
  /** inline 模式使用的模組載入器（預設與 worker 相同的 import.meta.glob 對應表） */
  loader?: ModuleLoader
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function cloneLikeWorker<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : v
}

interface Pending {
  resolve: (r: RunResult<unknown>) => void
  reject: (e: Error) => void
  t0: number
  /** 排進 worker pool 的工作（inline 模式為 null） */
  job: PoolJob | null
}

/**
 * 一個呼叫端（通常是一個實驗元件）對 worker pool 的視圖：管理自己的待完成請求。
 * - worker 由 pool 提供：同頁的實驗共用最多 2 條 worker（見 ./pool.ts），不再每個實驗各開一條冷 worker。
 * - cancel()：中止「這個 client 的」所有待完成請求。佇列中的請求直接移除；正在執行的請求會終止它所在的 worker
 *   （真正停止計算），不會影響 pool 中其他 client 的請求；下次 run 時 pool 會補一條新的 worker。
 * - Worker 不可用（或建立失敗）時退回 inline：在主執行緒以相同 dispatch 執行，
 *   並對 params / result 做 structuredClone，使語意與 worker 一致（不可 clone 的資料同樣會報錯）。
 */
export class SimWorkerClient {
  private inline = false
  private disposed = false
  private nextId = 1
  private pending = new Map<number, Pending>()
  private readonly pool: WorkerPool
  private readonly ownsPool: boolean
  private readonly loader: ModuleLoader

  constructor(opts: SimWorkerClientOptions = {}) {
    if (opts.pool) {
      this.pool = opts.pool
      this.ownsPool = false
    } else if (opts.createWorker) {
      this.pool = new WorkerPool({ createWorker: opts.createWorker })
      this.ownsPool = true
    } else {
      this.pool = getSharedWorkerPool()
      this.ownsPool = false
    }
    this.loader = opts.loader ?? loadModelModule
  }

  /** 'worker' 或 'inline'（尚未執行過時依環境推測） */
  get mode(): 'worker' | 'inline' {
    return this.inline ? 'inline' : this.pool.mode
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
      const pending: Pending = { resolve: resolve as (r: RunResult<unknown>) => void, reject, t0: now(), job: null }
      this.pending.set(id, pending)
      if (!this.inline) {
        let job: PoolJob | null
        try {
          job = this.pool.enqueue(
            { module, fn, params },
            {
              // pool 回的 id 是 pool 內的流水號，這裡直接以 client 的 id 對回請求
              onResponse: (res) => this.onResponse({ ...res, id }),
              onFail: (err) => this.fail(id, err),
            },
          )
        } catch (err) {
          // pool 已釋放（enqueue 丟 WorkerCancelledError）：不能留下待完成的請求，否則 busy 永遠不歸零
          this.fail(id, err instanceof Error ? err : new Error(String(err)))
          return
        }
        if (job) {
          pending.job = job
          return
        }
        this.inline = true // pool 沒有 worker 可用（環境不支援或建立失敗）
      }
      void this.runInline(req)
    })
  }

  /** 中止這個 client 所有進行中的計算（不影響共用 pool 中其他 client 的請求） */
  cancel(reason = '模擬已取消'): void {
    const err = new WorkerCancelledError(reason)
    const list = [...this.pending.values()]
    this.pending.clear()
    for (const p of list) p.job?.cancel()
    for (const p of list) p.reject(err)
  }

  dispose(): void {
    this.cancel('SimWorkerClient 已釋放')
    this.disposed = true
    if (this.ownsPool) this.pool.dispose()
  }

  /** pool 通知這個請求失敗（worker 崩潰、postMessage 失敗…） */
  private fail(id: number, err: Error): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    p.reject(err)
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
