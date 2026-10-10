import { collectTransferables, dispatch } from '@/workers/dispatch'
import type { WorkerRequest, WorkerResponse } from '@/workers/protocol'
import { UNITS_WORKER_FN, UNITS_WORKER_MODULE, unitsModuleLoader } from './unitsLoader'
import { runUnitsMc, runUnitsMcBatch, type UnitsMcBatchParams, type UnitsMcParams, type UnitsMcResult } from './unitsModel'

/**
 * 本頁專用 worker（units.worker.ts）與它的模組載入器：
 * Node 測試環境沒有真正的 Worker，所以用一個假的 worker global（self）載入 units.worker.ts，
 * 直接呼叫它註冊的 onmessage，檢查回傳訊息與 transfer list —— 這就是瀏覽器裡 worker 端實際執行的程式。
 */
const BASE: UnitsMcParams = { mu: 10, sigmaV: 100, C: 1, N: 4096, gmMode: 'average', engine: 'sign', chains: 4, blocks: 600, seed: 20261010 }

interface Posted {
  msg: WorkerResponse
  transfer?: Transferable[]
}

describe('unitsLoader：換算器 Monte Carlo 的模組載入器', () => {
  it('只提供 unitsModel；其他名稱丟出說明原因的錯誤', async () => {
    const mod = await unitsModuleLoader(UNITS_WORKER_MODULE)
    expect(typeof mod[UNITS_WORKER_FN]).toBe('function')
    expect(mod[UNITS_WORKER_FN]).toBe(runUnitsMcBatch)
    await expect(unitsModuleLoader('blockLms')).rejects.toThrow(/只提供模組 'unitsModel'/)
  })

  it('dispatch（worker 端的分派邏輯）＋ loader：結果與直接呼叫相同、可 structured clone；錯的函式名稱回報失敗而不是丟例外', async () => {
    const params: UnitsMcBatchParams = { cases: [BASE, { ...BASE, engine: 'linear' }] }
    const res = await dispatch(unitsModuleLoader, { id: 1, module: UNITS_WORKER_MODULE, fn: UNITS_WORKER_FN, params: structuredClone(params) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const out = structuredClone(res.result) as UnitsMcResult[] // 過一次 structured clone：與跨執行緒傳輸相同
    expect(out.length).toBe(2)
    const direct = params.cases.map((c) => runUnitsMc(c))
    for (let i = 0; i < 2; i++) {
      expect(out[i].varHat).toBe(direct[i].varHat) // 同 seed：逐位元相同
      expect(out[i].z).toBe(direct[i].z)
      expect(out[i].trace).toBeInstanceOf(Float64Array)
      expect(Array.from(out[i].trace)).toEqual(Array.from(direct[i].trace))
      expect(out[i].note).toBe(direct[i].note)
    }
    // typed array 以 transferable 傳回（每個 case 一個 buffer）
    expect(collectTransferables(res.result).length).toBe(2)
    const bad = await dispatch(unitsModuleLoader, { id: 2, module: UNITS_WORKER_MODULE, fn: 'noSuchFunction', params: {} })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.message).toMatch(/沒有匯出函式/)
  })
})

describe('units.worker.ts（worker 進入點；以假的 worker global 載入）', () => {
  const posted: Posted[] = []
  const fakeSelf: { onmessage: ((e: { data: WorkerRequest }) => Promise<void>) | null; postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void } = {
    onmessage: null,
    postMessage: (msg, transfer) => {
      posted.push({ msg, transfer })
    },
  }

  beforeAll(async () => {
    vi.stubGlobal('self', fakeSelf)
    await import('./units.worker')
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    posted.length = 0
  })

  it('T13: 收到 { id, module, fn, params } → postMessage({ id, ok, result }) 並把 trace 的 buffer 放進 transfer list；σ̂_w 與解析值一致', async () => {
    expect(typeof fakeSelf.onmessage).toBe('function')
    await fakeSelf.onmessage!({ data: { id: 7, module: UNITS_WORKER_MODULE, fn: UNITS_WORKER_FN, params: { cases: [{ ...BASE, chains: 16, blocks: 4000 }] } } })
    expect(posted.length).toBe(1)
    const { msg, transfer } = posted[0]
    expect(msg.id).toBe(7)
    expect(msg.ok).toBe(true)
    if (!msg.ok) return
    const [r] = msg.result as UnitsMcResult[]
    expect(r.valid).toBe(true)
    expect(Math.abs(r.z)).toBeLessThanOrEqual(4)
    expect(r.sigmaHat).toBeGreaterThan(0.38)
    expect(r.sigmaHat).toBeLessThan(0.42) // 解析 σ_w = 0.3992 fs
    expect(transfer?.length).toBe(1)
    expect(transfer?.[0]).toBe(r.trace.buffer)
  })

  it('反面：不認得的模組／函式 → 回傳 ok: false 與原因（不 transfer、不丟例外）', async () => {
    await fakeSelf.onmessage!({ data: { id: 8, module: 'blockLms', fn: 'runBlockLms', params: {} } })
    await fakeSelf.onmessage!({ data: { id: 9, module: UNITS_WORKER_MODULE, fn: '../evil', params: {} } })
    expect(posted.map((p) => p.msg.ok)).toEqual([false, false])
    expect(posted.every((p) => p.transfer === undefined)).toBe(true)
    const [a, b] = posted.map((p) => (p.msg.ok ? '' : p.msg.error.message))
    expect(a).toMatch(/只提供模組 'unitsModel'/)
    expect(b).toMatch(/無效的函式名稱/)
  })
})
