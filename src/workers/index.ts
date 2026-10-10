/**
 * Web Worker 基礎設施。使用方式：
 *   import { useWorkerTask, isWorkerCancelled } from '@/workers'
 * 規則見 ./protocol.ts（worker 可呼叫的函式必須是純函式、參數與回傳值可 structured clone）。
 */
export { useWorkerTask, type UseWorkerTaskOptions, type WorkerTask } from './useWorkerTask'
export {
  SimWorkerClient,
  WorkerCancelledError,
  isWorkerCancelled,
  type RunResult,
  type SimWorkerClientOptions,
  type WorkerLike,
} from './client'
export { dispatch, collectTransferables, serializeError, deserializeError } from './dispatch'
export { createGlobLoader, loadModelModule, availableModelModules } from './modelLoader'
export type { ModuleLoader, SerializedError, WorkerRequest, WorkerResponse } from './protocol'
