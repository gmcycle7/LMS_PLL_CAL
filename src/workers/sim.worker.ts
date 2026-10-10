/**
 * 通用模擬 Worker：收到 { id, module, fn, params } → 呼叫 src/simulation/models/<module>.ts 的 fn(params)
 * → 回傳 { id, ok, result } 或 { id, ok:false, error }。結果中的 typed array 以 transferable 傳回。
 * 由 SimWorkerClient 以 new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }) 建立。
 */
import { collectTransferables, dispatch, serializeError } from './dispatch'
import { loadModelModule } from './modelLoader'
import type { WorkerRequest, WorkerResponse } from './protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const res = await dispatch(loadModelModule, e.data)
  if (!res.ok) {
    ctx.postMessage(res)
    return
  }
  try {
    ctx.postMessage(res, collectTransferables(res.result))
  } catch (err) {
    // 例如結果含函式 → DataCloneError：明確告知是「回傳值不可 structured clone」
    const fail: WorkerResponse = {
      id: res.id,
      ok: false,
      error: serializeError(err, `函式 ${e.data.module}.${e.data.fn} 的回傳值無法傳回主執行緒（需可 structured clone）：`),
    }
    ctx.postMessage(fail)
  }
}
