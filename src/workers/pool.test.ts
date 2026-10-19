import { isWorkerCancelled } from './errors'
import { DEFAULT_IDLE_MS, DEFAULT_MAX_WORKERS, WorkerPool, getSharedWorkerPool, resetSharedWorkerPool, warmUpWorkerPool, type WorkerLike } from './pool'
import type { WorkerRequest, WorkerResponse } from './protocol'

/** 手動回應的假 worker：測試決定什麼時候完成哪個請求 */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  onmessageerror: ((e: MessageEvent) => void) | null = null
  terminated = false
  posted: WorkerRequest[] = []
  throwOnPost: Error | null = null
  postMessage(msg: unknown): void {
    if (this.throwOnPost) throw this.throwOnPost
    this.posted.push(msg as WorkerRequest)
  }
  terminate(): void {
    this.terminated = true
  }
  /** 回應最後一個（或指定 id 的）請求 */
  finish(result: unknown = 'ok', id = this.posted.at(-1)!.id): void {
    const res: WorkerResponse = { id, ok: true, result, durationMs: 1 }
    this.onmessage?.({ data: res } as MessageEvent)
  }
  crash(message: string): void {
    this.onerror?.({ message, preventDefault: () => {} } as unknown as ErrorEvent)
  }
}

function makePool(opts: { maxWorkers?: number; idleMs?: number } = {}) {
  const workers: FakeWorker[] = []
  const pool = new WorkerPool({ createWorker: () => (workers.push(new FakeWorker()), workers.at(-1)!), ...opts })
  return { pool, workers }
}

/** 排一個工作並記錄結果 */
function submit(pool: WorkerPool, module = 'm', fn = 'f') {
  const log: { results: unknown[]; errors: Error[] } = { results: [], errors: [] }
  const job = pool.enqueue(
    { module, fn, params: {} },
    {
      onResponse: (r) => log.results.push(r.ok ? r.result : r.error),
      onFail: (e) => log.errors.push(e),
    },
  )
  return { job, log }
}

afterEach(() => {
  vi.useRealTimers()
  resetSharedWorkerPool()
})

describe('WorkerPool：上限與佇列', () => {
  it('預設最多 2 條 worker、閒置 60 s', () => {
    expect(DEFAULT_MAX_WORKERS).toBe(2)
    expect(DEFAULT_IDLE_MS).toBe(60_000)
    const pool = new WorkerPool({ createWorker: () => new FakeWorker() })
    expect(pool.maxWorkers).toBe(2)
    expect(pool.idleMs).toBe(60_000)
    pool.dispose()
  })

  it('第三個工作排隊，前一個完成後才送出；同一條 worker 重用', () => {
    const { pool, workers } = makePool()
    const a = submit(pool)
    const b = submit(pool)
    const c = submit(pool)
    expect(workers).toHaveLength(2)
    expect([pool.size, pool.running, pool.queued]).toEqual([2, 2, 1])
    expect(workers[0].posted).toHaveLength(1)
    expect(workers[1].posted).toHaveLength(1)

    workers[0].finish('A')
    expect(a.log.results).toEqual(['A'])
    expect(workers).toHaveLength(2) // 沒有開第三條
    expect(workers[0].posted).toHaveLength(2) // 排隊的 c 送給剛空出來的那條
    expect(pool.queued).toBe(0)
    workers[0].finish('C')
    workers[1].finish('B')
    expect(c.log.results).toEqual(['C'])
    expect(b.log.results).toEqual(['B'])
    expect([pool.running, pool.queued]).toEqual([0, 0])
    pool.dispose()
  })

  it('工作 id 在 pool 內唯一，晚到或不認得的回應會被忽略', () => {
    const { pool, workers } = makePool()
    const a = submit(pool)
    submit(pool)
    expect(workers[0].posted[0].id).not.toBe(workers[1].posted[0].id)
    workers[0].finish('x', 999) // 沒人在等 id 999
    expect(a.log.results).toEqual([])
    expect(pool.running).toBe(2)
    pool.dispose()
  })

  it('優先把工作排給「已載入同一個模組」的閒置 worker', () => {
    const { pool, workers } = makePool()
    submit(pool, 'alpha')
    submit(pool, 'beta')
    workers[0].finish()
    workers[1].finish()
    expect(pool.running).toBe(0)
    submit(pool, 'beta')
    expect(workers[0].posted).toHaveLength(1) // alpha 的那條沒動
    expect(workers[1].posted).toHaveLength(2) // beta 回到載入過 beta 的那條
    pool.dispose()
  })

  it('maxWorkers 可調：1 條時全部排隊', () => {
    const { pool, workers } = makePool({ maxWorkers: 1 })
    submit(pool)
    submit(pool)
    expect(workers).toHaveLength(1)
    expect(pool.queued).toBe(1)
    pool.dispose()
  })
})

describe('WorkerPool：取消與崩潰', () => {
  it('取消佇列中的工作只是移除，不終止任何 worker', () => {
    const { pool, workers } = makePool({ maxWorkers: 1 })
    submit(pool)
    const q = submit(pool)
    q.job!.cancel()
    expect(pool.queued).toBe(0)
    expect(workers[0].terminated).toBe(false)
    pool.dispose()
  })

  it('取消執行中的工作 = 終止它的 worker；排隊的工作改用新的 worker', () => {
    const { pool, workers } = makePool({ maxWorkers: 1 })
    const a = submit(pool)
    const b = submit(pool)
    a.job!.cancel()
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1].posted).toHaveLength(1)
    // 被取消的 worker 之後再回應也不會影響結果
    workers[0].finish('late', a.job!.id)
    expect(a.log.results).toEqual([])
    workers[1].finish('B')
    expect(b.log.results).toEqual(['B'])
    pool.dispose()
  })

  it('重複 cancel 與完成後 cancel 都是 no-op', () => {
    const { pool, workers } = makePool()
    const a = submit(pool)
    workers[0].finish()
    a.job!.cancel()
    a.job!.cancel()
    expect(workers[0].terminated).toBe(false)
    expect(pool.size).toBe(1)
    pool.dispose()
  })

  it('worker 崩潰只讓它正在跑的工作失敗，另一條不受影響，佇列用新的 worker 繼續', () => {
    const { pool, workers } = makePool()
    const a = submit(pool)
    const b = submit(pool)
    const c = submit(pool)
    workers[0].crash('Failed to fetch dynamically imported module')
    expect(a.log.errors[0].message).toMatch(/模擬 worker 發生錯誤：Failed to fetch/)
    expect(b.log.errors).toEqual([])
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(3)
    expect(workers[2].posted).toHaveLength(1) // c 送給補上的新 worker
    workers[2].finish('C')
    expect(c.log.results).toEqual(['C'])
    pool.dispose()
  })

  it('postMessage 失敗（DataCloneError）：該工作失敗，worker 保留給下一個', () => {
    const { pool, workers } = makePool()
    const a = submit(pool)
    workers[0].finish()
    expect(a.log.results).toHaveLength(1)
    workers[0].throwOnPost = new Error('DataCloneError')
    const bad = submit(pool)
    expect(bad.log.errors[0].message).toBe('DataCloneError')
    expect(workers[0].terminated).toBe(false)
    workers[0].throwOnPost = null
    const ok = submit(pool)
    expect(workers).toHaveLength(1)
    workers[0].finish('fine')
    expect(ok.log.results).toEqual(['fine'])
    pool.dispose()
  })

  it('dispose：終止所有 worker、拒絕執行中與排隊的工作，之後 enqueue 丟 WorkerCancelledError', () => {
    const { pool, workers } = makePool({ maxWorkers: 1 })
    const a = submit(pool)
    const b = submit(pool)
    pool.dispose()
    expect(workers[0].terminated).toBe(true)
    expect(isWorkerCancelled(a.log.errors[0])).toBe(true)
    expect(isWorkerCancelled(b.log.errors[0])).toBe(true)
    expect(() => submit(pool)).toThrow(/已釋放/)
  })
})

describe('WorkerPool：閒置回收（60 s）', () => {
  it('閒置 idleMs 後終止 worker；下一個工作重新建立', () => {
    vi.useFakeTimers()
    const { pool, workers } = makePool()
    submit(pool)
    workers[0].finish()
    vi.advanceTimersByTime(DEFAULT_IDLE_MS - 1)
    expect(workers[0].terminated).toBe(false)
    expect(pool.size).toBe(1)
    vi.advanceTimersByTime(1)
    expect(workers[0].terminated).toBe(true)
    expect(pool.size).toBe(0)
    const again = submit(pool)
    expect(workers).toHaveLength(2)
    workers[1].finish('new')
    expect(again.log.results).toEqual(['new'])
    pool.dispose()
  })

  it('執行中的 worker 不會被回收；完成後才重新計時', () => {
    vi.useFakeTimers()
    const { pool, workers } = makePool()
    submit(pool)
    vi.advanceTimersByTime(DEFAULT_IDLE_MS * 3) // 算很久也不能被殺
    expect(workers[0].terminated).toBe(false)
    workers[0].finish()
    vi.advanceTimersByTime(DEFAULT_IDLE_MS - 1)
    expect(workers[0].terminated).toBe(false)
    vi.advanceTimersByTime(1)
    expect(workers[0].terminated).toBe(true)
    pool.dispose()
  })

  it('兩條 worker 各自計時：先閒置的先被回收', () => {
    vi.useFakeTimers()
    const { pool, workers } = makePool({ idleMs: 1000 })
    submit(pool)
    submit(pool)
    workers[0].finish()
    vi.advanceTimersByTime(600)
    workers[1].finish()
    vi.advanceTimersByTime(400)
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].terminated).toBe(false)
    vi.advanceTimersByTime(600)
    expect(workers[1].terminated).toBe(true)
    expect(pool.size).toBe(0)
    pool.dispose()
  })

  it('warm()：先建一條閒置 worker，也會被回收；已有 worker 時不再多開', () => {
    vi.useFakeTimers()
    const { pool, workers } = makePool()
    pool.warm()
    pool.warm()
    expect(workers).toHaveLength(1)
    expect(pool.running).toBe(0)
    const a = submit(pool)
    expect(workers).toHaveLength(1) // 第一個工作用暖好的那條
    expect(workers[0].posted).toHaveLength(1)
    workers[0].finish()
    expect(a.log.results).toHaveLength(1)
    vi.advanceTimersByTime(DEFAULT_IDLE_MS)
    expect(pool.size).toBe(0)
    pool.dispose()
  })
})

describe('WorkerPool：沒有 Worker 時退回 inline', () => {
  it('createWorker 回傳 null：enqueue 回傳 null、mode 為 inline', () => {
    const pool = new WorkerPool({ createWorker: () => null })
    expect(submit(pool).job).toBeNull()
    expect(pool.mode).toBe('inline')
    expect(submit(pool).job).toBeNull()
  })

  it('createWorker 丟例外：警告一次後 inline', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pool = new WorkerPool({
      createWorker: () => {
        throw new Error('SecurityError')
      },
    })
    expect(submit(pool).job).toBeNull()
    expect(submit(pool).job).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('jsdom 沒有 Worker：共用 pool 為 inline，warmUpWorkerPool 什麼都不做', () => {
    expect(typeof Worker).toBe('undefined')
    const pool = getSharedWorkerPool()
    expect(pool.mode).toBe('inline')
    warmUpWorkerPool()
    expect(pool.size).toBe(0)
    expect(getSharedWorkerPool()).toBe(pool)
    resetSharedWorkerPool()
    expect(getSharedWorkerPool()).not.toBe(pool)
  })
})
