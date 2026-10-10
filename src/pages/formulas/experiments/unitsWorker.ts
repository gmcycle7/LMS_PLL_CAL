import type { UseWorkerTaskOptions, WorkerLike } from '@/workers'
import { unitsModuleLoader } from '../unitsLoader'

/**
 * 換算器 Monte Carlo 的 worker 設定（給 useWorkerTask）。
 * - 瀏覽器：建立本頁專用的 units.worker（module worker；Vite 會把它打包成獨立 chunk）。
 * - jsdom／不支援 Worker 的環境：回傳 null → useWorkerTask 退回 inline，並用同一個 loader 在主執行緒執行。
 * 兩個函式都是模組層級的常數（identity 穩定），不會讓 hook 每次 render 重建 client。
 */
export function createUnitsWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null
  return new Worker(new URL('../units.worker.ts', import.meta.url), { type: 'module', name: 'lmspll-units' })
}

export const UNITS_WORKER_OPTIONS: UseWorkerTaskOptions = {
  createWorker: createUnitsWorker,
  loader: unitsModuleLoader,
  restartOnRun: true, // 再按一次 Run：終止上一次的計算，只留最新的
}
