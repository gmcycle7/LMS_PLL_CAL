/**
 * 主執行緒 ↔ sim.worker 的訊息格式。
 *
 * Worker 可呼叫的函式（src/simulation/models/<module>.ts 的具名匯出）必須：
 * 1. 是純函式：不得依賴或修改模組層級的可變狀態（每次呼叫可能在不同 worker 實例中執行，
 *    cancel 會終止並重建 worker）。隨機性一律由參數中的 seed 經 createRng(seed) 產生。
 * 2. 只接收一個參數 params，且 params 與回傳值都必須可被 structured clone
 *    （plain object、array、number、string、boolean、null、typed array、Map、Set、Date；
 *    不可含函式、class instance 的方法、DOM 節點）。
 * 3. 回傳的 typed array 應為新配置的陣列：結果中的 ArrayBuffer 會以 transferable 方式傳回主執行緒
 *    （零複製），傳送後在 worker 端即被 detach。
 * 4. 可以是 async（回傳 Promise）。
 */

export interface WorkerRequest {
  id: number
  /** 模組名稱：'blockLms' → src/simulation/models/blockLms.ts */
  module: string
  /** 該模組的具名匯出函式 */
  fn: string
  params: unknown
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown; /** worker 內純計算時間（ms） */ durationMs: number }
  | { id: number; ok: false; error: SerializedError }

/** 依模組名稱載入模組（回傳模組的具名匯出） */
export type ModuleLoader = (module: string) => Promise<Record<string, unknown>>
