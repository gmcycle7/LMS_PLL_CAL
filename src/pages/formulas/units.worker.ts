/**
 * 本頁專用的 Web Worker：把「單位與頻寬換算器」的 Monte Carlo（unitsModel.runUnitsMcBatch）搬離主執行緒。
 *
 * 為什麼不用共用的 sim.worker：它只載入 src/simulation/models/*.ts，而本頁的計算核心在 src/pages/formulas/unitsModel.ts
 * （本頁只擁有自己的資料夾）。訊息格式、分派邏輯與錯誤處理完全沿用 @/workers 的 dispatch／protocol，
 * 所以主執行緒端仍然是 useWorkerTask（只是換一個 createWorker 與 loader）。
 * 由 experiments/unitsWorker.ts 以 new Worker(new URL('../units.worker.ts', import.meta.url), { type: 'module' }) 建立。
 */
import { collectTransferables, dispatch, serializeError } from '@/workers/dispatch'
import type { WorkerRequest, WorkerResponse } from '@/workers/protocol'
import { unitsModuleLoader } from './unitsLoader'

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const res = await dispatch(unitsModuleLoader, e.data)
  if (!res.ok) {
    ctx.postMessage(res)
    return
  }
  try {
    ctx.postMessage(res, collectTransferables(res.result))
  } catch (err) {
    const fail: WorkerResponse = {
      id: res.id,
      ok: false,
      error: serializeError(err, `函式 ${e.data.module}.${e.data.fn} 的回傳值無法傳回主執行緒（需可 structured clone）：`),
    }
    ctx.postMessage(fail)
  }
}
