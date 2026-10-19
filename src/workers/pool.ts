import { WorkerCancelledError } from './errors'
import type { WorkerRequest, WorkerResponse } from './protocol'

/** 最小 Worker 介面（方便以假物件測試） */
export interface WorkerLike {
  postMessage(msg: unknown): void
  terminate(): void
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  onmessageerror: ((e: MessageEvent) => void) | null
}

export interface WorkerPoolOptions {
  /** 建立 worker；回傳 null 或丟例外表示不可用 → 整個 pool 改為 inline（由呼叫端在主執行緒執行） */
  createWorker?: () => WorkerLike | null
  /** 最多同時存在幾條 worker（預設 2：夠讓兩個實驗平行，又不會把核心與記憶體吃光） */
  maxWorkers?: number
  /** worker 閒置多久（ms）後終止並回收（預設 60 s；下次需要時重新建立） */
  idleMs?: number
}

/** 一個排入 pool 的工作；cancel() 會把它從佇列移除，或（已在執行時）終止它所在的 worker */
export interface PoolJob {
  readonly id: number
  cancel(): void
}

export interface PoolJobHandlers {
  onResponse(res: WorkerResponse): void
  /** worker 崩潰、postMessage 失敗、pool 釋放等「不是函式本身丟的錯」 */
  onFail(err: Error): void
}

export const DEFAULT_MAX_WORKERS = 2
export const DEFAULT_IDLE_MS = 60_000

interface Job extends PoolJob {
  req: WorkerRequest
  handlers: PoolJobHandlers
  slot: Slot | null
}

interface Slot {
  worker: WorkerLike
  job: Job | null
  /** 這條 worker 載入過哪些模型模組：同一模組的下一個工作優先排給它（模組已在記憶體裡，省掉動態 import） */
  modules: Set<string>
  idleTimer: ReturnType<typeof setTimeout> | null
}

export function defaultCreateWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null
  return new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'lmspll-sim' })
}

/**
 * 小型 worker pool（預設最多 2 條，閒置 60 s 回收）。
 *
 * 為什麼：每個實驗各開一條冷 worker（載入 worker 腳本 + 動態 import 模型模組），同一頁有好幾個實驗時
 * 啟動成本被重複付多次；pool 讓同頁的實驗共用已經暖好的 worker。
 *
 * 語意（和「一個 client 一條 worker」時代相同的部分）：
 * - 一條 worker 同一時間只跑一個工作（worker 是單執行緒，多工只會互相排隊）；其餘工作在佇列裡等，先進先出。
 * - 取消一個正在執行的工作 = 終止它的 worker（真正停止計算），下一個工作會用新的 worker；取消佇列中的工作只是把它移掉，
 *   不會影響別的工作。所以取消只會殺掉「被取消的那個工作」，不會連累共用 pool 的其他實驗。
 * - worker 崩潰（onerror）只讓它正在跑的那個工作失敗，並移除這條 worker。
 * - 環境沒有 Worker（jsdom／node）或建立失敗 → `enqueue` 回傳 null，呼叫端改在主執行緒 inline 執行。
 */
export class WorkerPool {
  private slots: Slot[] = []
  private queue: Job[] = []
  private nextId = 1
  private inline = false
  private disposed = false
  private readonly createWorker: () => WorkerLike | null
  readonly maxWorkers: number
  readonly idleMs: number

  constructor(opts: WorkerPoolOptions = {}) {
    this.createWorker = opts.createWorker ?? defaultCreateWorker
    this.maxWorkers = Math.max(1, Math.floor(opts.maxWorkers ?? DEFAULT_MAX_WORKERS))
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
  }

  /** 'worker' 或 'inline'（尚未建立過 worker 時依環境推測） */
  get mode(): 'worker' | 'inline' {
    if (this.inline) return 'inline'
    if (this.slots.length > 0) return 'worker'
    return typeof Worker === 'undefined' ? 'inline' : 'worker'
  }

  /** 目前存在的 worker 條數（含閒置） */
  get size(): number {
    return this.slots.length
  }

  /** 正在執行工作的 worker 條數 */
  get running(): number {
    return this.slots.filter((s) => s.job !== null).length
  }

  /** 在佇列中等待 worker 的工作數 */
  get queued(): number {
    return this.queue.length
  }

  /**
   * 排入一個工作。回傳 null 表示 worker 不可用 → 呼叫端自己在主執行緒執行（此時 handlers 不會被呼叫）。
   * `req.id` 由 pool 配發（pool 內唯一），回應用它對回工作。
   */
  enqueue(req: Omit<WorkerRequest, 'id'>, handlers: PoolJobHandlers): PoolJob | null {
    if (this.disposed) throw new WorkerCancelledError('WorkerPool 已釋放')
    if (this.inline) return null
    const id = this.nextId++
    const job: Job = {
      id,
      req: { ...req, id },
      handlers,
      slot: null,
      cancel: () => this.cancelJob(job),
    }
    this.queue.push(job)
    this.pump()
    if (this.inline) {
      // 第一次建立 worker 就失敗：這個工作交還給呼叫端 inline 執行
      const i = this.queue.indexOf(job)
      if (i >= 0) this.queue.splice(i, 1)
      return null
    }
    return job
  }

  /** 先建立一條閒置的 worker（已有 worker、環境不支援或已釋放時什麼都不做）；閒置 `idleMs` 後仍會被回收 */
  warm(): void {
    if (this.disposed || this.inline || this.slots.length > 0) return
    this.spawn()
  }

  /** 終止所有 worker、拒絕所有工作；之後 enqueue 會丟 WorkerCancelledError */
  dispose(): void {
    this.disposed = true
    const err = new WorkerCancelledError('WorkerPool 已釋放')
    const jobs = [...this.queue, ...this.slots.flatMap((s) => (s.job ? [s.job] : []))]
    this.queue = []
    for (const s of [...this.slots]) this.removeSlot(s)
    for (const j of jobs) j.handlers.onFail(err)
  }

  private cancelJob(job: Job): void {
    const qi = this.queue.indexOf(job)
    if (qi >= 0) {
      this.queue.splice(qi, 1)
      return
    }
    const slot = job.slot
    if (!slot || slot.job !== job) return // 已完成
    slot.job = null
    job.slot = null
    this.removeSlot(slot)
    this.pump()
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0]
      let slot = this.pickIdleSlot(next.req.module)
      if (!slot && this.slots.length < this.maxWorkers) slot = this.spawn()
      if (!slot) {
        if (this.inline) {
          // 一條 worker 都建立不起來：佇列裡除了正在 enqueue 的那一個以外都只能失敗（正常情況下佇列此時只有它）
          const rest = this.queue.slice(1)
          this.queue = [next]
          const err = new Error('無法建立模擬 worker')
          for (const j of rest) j.handlers.onFail(err)
        }
        return
      }
      this.queue.shift()
      this.start(slot, next)
    }
  }

  private pickIdleSlot(module: string): Slot | null {
    let fallback: Slot | null = null
    for (const s of this.slots) {
      if (s.job) continue
      if (s.modules.has(module)) return s
      fallback ??= s
    }
    return fallback
  }

  private spawn(): Slot | null {
    let w: WorkerLike | null = null
    try {
      w = this.createWorker()
    } catch (err) {
      console.warn('[WorkerPool] 無法建立 Web Worker，改在主執行緒執行：', err)
      w = null
    }
    if (!w) {
      if (this.slots.length === 0) this.inline = true
      return null
    }
    const slot: Slot = { worker: w, job: null, modules: new Set(), idleTimer: null }
    w.onmessage = (e: MessageEvent) => this.onResponse(slot, e.data as WorkerResponse)
    w.onerror = (e: ErrorEvent) => {
      e.preventDefault?.()
      this.crash(slot, new Error(`模擬 worker 發生錯誤：${e.message || '未知錯誤（可能是模組載入失敗）'}`))
    }
    w.onmessageerror = () => this.crash(slot, new Error('模擬 worker 回傳的資料無法反序列化'))
    this.slots.push(slot)
    this.armIdle(slot)
    return slot
  }

  private start(slot: Slot, job: Job): void {
    this.disarmIdle(slot)
    slot.job = job
    job.slot = slot
    slot.modules.add(job.req.module)
    try {
      slot.worker.postMessage(job.req)
    } catch (err) {
      // 例如 params 含函式 → DataCloneError；worker 本身沒事，留著給下一個工作
      slot.job = null
      job.slot = null
      this.armIdle(slot)
      job.handlers.onFail(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private onResponse(slot: Slot, res: WorkerResponse): void {
    const job = slot.job
    if (!job || job.req.id !== res.id) return // 已取消的工作的遲到回應
    slot.job = null
    job.slot = null
    this.armIdle(slot)
    job.handlers.onResponse(res)
    this.pump()
  }

  /** worker 本身出錯：移除這條 worker，只有它正在跑的工作失敗；佇列照常用新的 worker 處理 */
  private crash(slot: Slot, err: Error): void {
    if (!this.slots.includes(slot)) return
    const job = slot.job
    slot.job = null
    if (job) job.slot = null
    this.removeSlot(slot)
    job?.handlers.onFail(err)
    this.pump()
  }

  private removeSlot(slot: Slot): void {
    this.disarmIdle(slot)
    slot.worker.onmessage = null
    slot.worker.onerror = null
    slot.worker.onmessageerror = null
    slot.worker.terminate()
    const i = this.slots.indexOf(slot)
    if (i >= 0) this.slots.splice(i, 1)
  }

  private armIdle(slot: Slot): void {
    this.disarmIdle(slot)
    if (!Number.isFinite(this.idleMs)) return
    slot.idleTimer = setTimeout(() => {
      slot.idleTimer = null
      if (!slot.job && this.slots.includes(slot)) this.removeSlot(slot)
    }, this.idleMs)
  }

  private disarmIdle(slot: Slot): void {
    if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer)
      slot.idleTimer = null
    }
  }
}

let shared: WorkerPool | null = null

/** 全站共用的 pool（所有沒有注入 createWorker 的 SimWorkerClient 都用它） */
export function getSharedWorkerPool(): WorkerPool {
  shared ??= new WorkerPool()
  return shared
}

/** 釋放並丟棄共用 pool（測試用；下次 getSharedWorkerPool 會建立新的） */
export function resetSharedWorkerPool(): void {
  shared?.dispose()
  shared = null
}

/**
 * 先把一條 worker 暖起來（載入 worker 腳本），讓使用者第一次按下「執行」時不必再等 worker 啟動。
 * 環境沒有 Worker 時什麼都不做；已有 worker 時也不會再多開。
 */
export function warmUpWorkerPool(): void {
  const pool = getSharedWorkerPool()
  if (pool.mode === 'inline' || pool.size > 0) return
  pool.warm()
}
