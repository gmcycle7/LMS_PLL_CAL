import type { ModuleLoader } from '@/workers/protocol'
import * as unitsModel from './unitsModel'

/**
 * 換算器 Monte Carlo 的模組載入器（worker 與 inline fallback 共用同一份）：
 * 只認得 'unitsModel' 一個模組名稱，其他名稱丟出說明原因的錯誤。無 React／DOM，可在 Worker 中載入。
 */
export const UNITS_WORKER_MODULE = 'unitsModel'
export const UNITS_WORKER_FN = 'runUnitsMcBatch'

export const unitsModuleLoader: ModuleLoader = async (name: string) => {
  if (name !== UNITS_WORKER_MODULE) {
    throw new Error(`本頁的 worker 只提供模組 '${UNITS_WORKER_MODULE}'（src/pages/formulas/unitsModel.ts），收到 '${name}'`)
  }
  return unitsModel as unknown as Record<string, unknown>
}
