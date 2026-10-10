import type { ModuleLoader } from './protocol'

/**
 * 以 Vite import.meta.glob 延遲載入 src/simulation/models/*.ts（不含 *.test.ts）。
 * 模組名稱 'blockLms' 對應 '../simulation/models/blockLms.ts'。
 * 主執行緒的 inline fallback 與 sim.worker 共用同一份對應表。
 */
const MODEL_PREFIX = '../simulation/models/'

const modelModules = import.meta.glob(['../simulation/models/*.ts', '!../simulation/models/*.test.ts'])

/** 由 glob 對應表建立 ModuleLoader（可注入假的對應表做測試） */
export function createGlobLoader(globMap: Record<string, () => Promise<unknown>>, prefix = MODEL_PREFIX): ModuleLoader {
  return async (name: string) => {
    const load = globMap[`${prefix}${name}.ts`]
    if (!load) {
      const available = Object.keys(globMap)
        .map((k) => k.slice(prefix.length).replace(/\.ts$/, ''))
        .sort()
      throw new Error(
        `找不到模擬模組 '${name}'（預期檔案 src/simulation/models/${name}.ts）。目前可用：${available.length > 0 ? available.join(', ') : '（無）'}`,
      )
    }
    const mod = await load()
    return mod as Record<string, unknown>
  }
}

export const loadModelModule: ModuleLoader = createGlobLoader(modelModules)

/** 目前可由 worker 呼叫的模組名稱 */
export function availableModelModules(): string[] {
  return Object.keys(modelModules)
    .map((k) => k.slice(MODEL_PREFIX.length).replace(/\.ts$/, ''))
    .sort()
}
