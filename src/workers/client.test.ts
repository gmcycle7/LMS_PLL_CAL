import { isWorkerCancelled, SimWorkerClient, WorkerCancelledError, type WorkerLike } from './client'
import { dispatch } from './dispatch'
import type { ModuleLoader, WorkerRequest, WorkerResponse } from './protocol'

const modules: Record<string, Record<string, unknown>> = {
  m: {
    double: (p: { x: Float64Array }) => ({ y: p.x.map((v) => 2 * v) }),
    slow: (p: { ms: number }) => new Promise((r) => setTimeout(() => r(p.ms), p.ms)),
    returnsFn: () => ({ f: () => 1 }),
    fail: () => {
      throw new Error('C ≤ 0：polarity 錯誤')
    },
  },
}
const loader: ModuleLoader = async (name) => {
  const m = modules[name]
  if (!m) throw new Error(`no module ${name}`)
  return m
}

describe('SimWorkerClient（inline 模式：環境沒有 Worker）', () => {
  it('執行並回傳結果；params 以 structuredClone 複製（與 worker 語意一致）', async () => {
    const c = new SimWorkerClient({ createWorker: () => null, loader })
    const x = new Float64Array([1, 2, 3])
    const { result, durationMs } = await c.run<{ y: Float64Array }>('m', 'double', { x })
    expect(Array.from(result.y)).toEqual([2, 4, 6])
    expect(durationMs).toBeGreaterThanOrEqual(0)
    expect(c.mode).toBe('inline')
    expect(Array.from(x)).toEqual([1, 2, 3])
  })

  it('函式錯誤以 Error reject', async () => {
    const c = new SimWorkerClient({ createWorker: () => null, loader })
    await expect(c.run('m', 'fail', {})).rejects.toThrow('C ≤ 0：polarity 錯誤')
  })

  it('參數或回傳值不可 structured clone 時明確報錯', async () => {
    const c = new SimWorkerClient({ createWorker: () => null, loader })
    await expect(c.run('m', 'double', { x: new Float64Array(1), cb: () => 1 })).rejects.toThrow()
    await expect(c.run('m', 'returnsFn', {})).rejects.toThrow(/structured clone/)
  })

  it('cancel() 以 WorkerCancelledError reject 進行中的請求', async () => {
    const c = new SimWorkerClient({ createWorker: () => null, loader })
    const p = c.run('m', 'slow', { ms: 30 })
    expect(c.busy).toBe(1)
    c.cancel()
    await expect(p).rejects.toBeInstanceOf(WorkerCancelledError)
    expect(c.busy).toBe(0)
    // cancel 後仍可繼續使用
    await expect(c.run('m', 'slow', { ms: 1 })).resolves.toMatchObject({ result: 1 })
  })

  it('dispose 後 run 直接 reject', async () => {
    const c = new SimWorkerClient({ createWorker: () => null, loader })
    c.dispose()
    const err = await c.run('m', 'double', { x: new Float64Array(0) }).catch((e: unknown) => e)
    expect(isWorkerCancelled(err)).toBe(true)
  })
})

/** 以 dispatch 模擬 worker 端行為的假 Worker */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  onmessageerror: ((e: MessageEvent) => void) | null = null
  terminated = false
  posted: WorkerRequest[] = []
  constructor(private readonly auto = true) {}
  postMessage(msg: unknown): void {
    const req = structuredClone(msg) as WorkerRequest
    this.posted.push(req)
    if (this.auto) void this.respond(req)
  }
  async respond(req: WorkerRequest): Promise<void> {
    const res: WorkerResponse = await dispatch(loader, req)
    if (!this.terminated) this.onmessage?.({ data: res } as MessageEvent)
  }
  terminate(): void {
    this.terminated = true
  }
  crash(message: string): void {
    this.onerror?.({ message, preventDefault: () => {} } as unknown as ErrorEvent)
  }
}

describe('SimWorkerClient（worker 模式）', () => {
  it('經由 postMessage 往返，id 對應正確', async () => {
    const workers: FakeWorker[] = []
    const c = new SimWorkerClient({ createWorker: () => (workers.push(new FakeWorker()), workers.at(-1)!) })
    const [a, b] = await Promise.all([
      c.run<{ y: Float64Array }>('m', 'double', { x: new Float64Array([1]) }),
      c.run<{ y: Float64Array }>('m', 'double', { x: new Float64Array([5]) }),
    ])
    expect(Array.from(a.result.y)).toEqual([2])
    expect(Array.from(b.result.y)).toEqual([10])
    expect(workers).toHaveLength(1)
    expect(workers[0].posted.map((r) => r.id)).toEqual([1, 2])
    expect(c.mode).toBe('worker')
  })

  it('cancel() 終止 worker、reject 請求，下次 run 重建 worker', async () => {
    const workers: FakeWorker[] = []
    const c = new SimWorkerClient({ createWorker: () => (workers.push(new FakeWorker(false)), workers.at(-1)!) })
    const p = c.run('m', 'slow', { ms: 5 })
    c.cancel()
    await expect(p).rejects.toBeInstanceOf(WorkerCancelledError)
    expect(workers[0].terminated).toBe(true)
    // 被終止的 worker 即使之後回應也會被忽略
    await workers[0].respond(workers[0].posted[0])
    const q = c.run('m', 'slow', { ms: 1 })
    expect(workers).toHaveLength(2)
    await workers[1].respond(workers[1].posted[0])
    await expect(q).resolves.toMatchObject({ result: 1 })
  })

  it('worker 崩潰（onerror）時 reject 所有請求並在下次重建', async () => {
    const workers: FakeWorker[] = []
    const c = new SimWorkerClient({ createWorker: () => (workers.push(new FakeWorker(false)), workers.at(-1)!) })
    const p1 = c.run('m', 'slow', { ms: 1 })
    const p2 = c.run('m', 'slow', { ms: 1 })
    workers[0].crash('Failed to fetch dynamically imported module')
    await expect(p1).rejects.toThrow(/模擬 worker 發生錯誤：Failed to fetch/)
    await expect(p2).rejects.toThrow()
    expect(workers[0].terminated).toBe(true)
    void c.run('m', 'slow', { ms: 1 }).catch(() => {})
    expect(workers).toHaveLength(2)
    c.dispose()
  })

  it('建立 worker 丟例外時退回 inline 模式', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = new SimWorkerClient({
      createWorker: () => {
        throw new Error('SecurityError')
      },
      loader,
    })
    await expect(c.run('m', 'slow', { ms: 1 })).resolves.toMatchObject({ result: 1 })
    expect(c.mode).toBe('inline')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
