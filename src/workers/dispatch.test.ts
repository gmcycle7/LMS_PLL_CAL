import { collectTransferables, deserializeError, dispatch, serializeError } from './dispatch'
import { availableModelModules, createGlobLoader } from './modelLoader'
import type { ModuleLoader } from './protocol'

/** 假的模型模組：純函式、參數與回傳值皆可 structured clone */
const fakeModules: Record<string, Record<string, unknown>> = {
  blockLms: {
    // 固定 x 的 scalar LMS：w_{n+1} = w_n + μ (a − w_n) x²（規格 §1.2 手算例子）
    simulate: (p: { a: number; w0: number; x: number; mu: number; steps: number }) => {
      const w = new Float64Array(p.steps + 1)
      w[0] = p.w0
      for (let n = 0; n < p.steps; n++) w[n + 1] = w[n] + p.mu * (p.a - w[n]) * p.x * p.x
      return { w }
    },
    asyncFn: async (p: { v: number }) => p.v * 2,
    boom: () => {
      throw new RangeError('μ 超出穩定範圍')
    },
    notAFunction: 42,
  },
}

const loader: ModuleLoader = async (name) => {
  const m = fakeModules[name]
  if (!m) throw new Error(`找不到模擬模組 '${name}'`)
  return m
}

describe('dispatch', () => {
  it('呼叫模組的具名匯出函式並回傳結果（規格 §1.2：w1 = 1.8、w2 = 2.28）', async () => {
    const res = await dispatch(loader, { id: 7, module: 'blockLms', fn: 'simulate', params: { a: 3, w0: 1, x: 2, mu: 0.1, steps: 2 } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.id).toBe(7)
    const w = (res.result as { w: Float64Array }).w
    // 手算：w1 = 1 + 0.1·(3−1)·4 = 1.8；w2 = 1.8 + 0.1·(3−1.8)·4 = 2.28
    expect(w[1]).toBeCloseTo(1.8, 14)
    expect(w[2]).toBeCloseTo(2.28, 14)
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('支援 async 函式', async () => {
    const res = await dispatch(loader, { id: 1, module: 'blockLms', fn: 'asyncFn', params: { v: 21 } })
    expect(res).toMatchObject({ id: 1, ok: true, result: 42 })
  })

  it('函式丟出的錯誤包裝成 { ok: false }，保留 name 與 message', async () => {
    const res = await dispatch(loader, { id: 2, module: 'blockLms', fn: 'boom', params: {} })
    expect(res).toMatchObject({ id: 2, ok: false, error: { name: 'RangeError', message: 'μ 超出穩定範圍' } })
  })

  it('不存在的模組 / 函式、非函式匯出、原型鏈上的名稱都回報錯誤', async () => {
    expect(await dispatch(loader, { id: 3, module: 'nope', fn: 'x', params: {} })).toMatchObject({ ok: false, error: { message: expect.stringContaining('nope') } })
    expect(await dispatch(loader, { id: 4, module: 'blockLms', fn: 'missing', params: {} })).toMatchObject({
      ok: false,
      error: { message: "模組 'blockLms' 沒有匯出函式 'missing'" },
    })
    expect(await dispatch(loader, { id: 5, module: 'blockLms', fn: 'notAFunction', params: {} })).toMatchObject({ ok: false })
    expect(await dispatch(loader, { id: 6, module: 'blockLms', fn: 'toString', params: {} })).toMatchObject({ ok: false })
  })

  it('拒絕路徑注入的模組名稱，且不呼叫 loader', async () => {
    const spy = vi.fn(loader)
    const res = await dispatch(spy, { id: 8, module: '../../app/settings', fn: 'x', params: {} })
    expect(res).toMatchObject({ ok: false, error: { name: 'TypeError' } })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('collectTransferables', () => {
  it('收集 typed array 的 buffer，去重複，略過空 buffer', () => {
    const a = new Float64Array(4)
    const view = new Float64Array(a.buffer, 8, 2)
    const b = new Int32Array(3)
    const raw = new ArrayBuffer(16)
    const list = collectTransferables({ a, view, nested: { arr: [b, { raw }] }, empty: new Float64Array(0), n: 1, s: 'x' })
    expect(list).toHaveLength(3)
    expect(list).toContain(a.buffer)
    expect(list).toContain(b.buffer)
    expect(list).toContain(raw)
  })

  it('處理循環參照與 Map / Set', () => {
    const o: Record<string, unknown> = { m: new Map([['k', new Uint8Array(2)]]), s: new Set([new Float32Array(1)]) }
    o.self = o
    expect(collectTransferables(o)).toHaveLength(2)
  })

  it('原始值沒有 transferable', () => {
    expect(collectTransferables(42)).toEqual([])
    expect(collectTransferables(null)).toEqual([])
  })
})

describe('serializeError / deserializeError', () => {
  it('往返保留 name 與 message', () => {
    const e = deserializeError(serializeError(new TypeError('bad')))
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('TypeError')
    expect(e.message).toBe('bad')
    expect(serializeError('plain', 'p: ')).toEqual({ name: 'Error', message: 'p: plain' })
  })
})

describe('createGlobLoader', () => {
  it("模組名稱 'blockLms' 對應 '../simulation/models/blockLms.ts'", async () => {
    const load = vi.fn(async () => ({ run: () => 1 }))
    const l = createGlobLoader({ '../simulation/models/blockLms.ts': load, '../simulation/models/dsm.ts': async () => ({}) })
    const mod = await l('blockLms')
    expect(load).toHaveBeenCalledTimes(1)
    expect(typeof mod.run).toBe('function')
    await expect(l('pll')).rejects.toThrow(/找不到模擬模組 'pll'.*目前可用：blockLms, dsm/)
  })

  it('真實 glob 對應表不包含測試檔', () => {
    expect(availableModelModules().every((n) => !n.endsWith('.test'))).toBe(true)
  })
})
