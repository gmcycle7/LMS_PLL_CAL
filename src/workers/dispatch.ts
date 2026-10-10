import type { ModuleLoader, SerializedError, WorkerRequest, WorkerResponse } from './protocol'

/**
 * Worker 端的純分派邏輯（與 Worker API 無關，可直接單元測試）：
 * 驗證名稱 → 載入模組 → 呼叫具名匯出函式 → 包裝成功 / 失敗回應。
 */

/** 模組與函式名稱只允許識別字，防止 '../' 之類的路徑注入 */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function serializeError(err: unknown, prefix = ''): SerializedError {
  if (err instanceof Error) return { name: err.name, message: prefix + err.message, stack: err.stack }
  return { name: 'Error', message: prefix + String(err) }
}

export function deserializeError(e: SerializedError): Error {
  const err = new Error(e.message)
  err.name = e.name
  if (e.stack) err.stack = e.stack
  return err
}

export async function dispatch(loader: ModuleLoader, msg: WorkerRequest): Promise<WorkerResponse> {
  const id = msg?.id
  try {
    if (!msg || typeof msg !== 'object') throw new TypeError('無效的 worker 訊息')
    if (typeof msg.module !== 'string' || !IDENT_RE.test(msg.module)) {
      throw new TypeError(`無效的模組名稱：${String(msg.module)}`)
    }
    if (typeof msg.fn !== 'string' || !IDENT_RE.test(msg.fn)) {
      throw new TypeError(`無效的函式名稱：${String(msg.fn)}`)
    }
    const mod = await loader(msg.module)
    const f = Object.prototype.hasOwnProperty.call(mod, msg.fn) ? mod[msg.fn] : undefined
    if (typeof f !== 'function') {
      throw new TypeError(`模組 '${msg.module}' 沒有匯出函式 '${msg.fn}'`)
    }
    const t0 = now()
    const result: unknown = await (f as (p: unknown) => unknown)(msg.params)
    return { id, ok: true, result, durationMs: now() - t0 }
  } catch (err) {
    return { id, ok: false, error: serializeError(err) }
  }
}

/**
 * 收集結果中所有 typed array / ArrayBuffer 的底層 buffer，作為 postMessage 的 transfer list。
 * - 重複的 buffer 只列一次（同一 buffer 的多個 view 可同時傳送）。
 * - SharedArrayBuffer 不可 transfer，會略過。
 * - 只往下走 maxDepth 層，避免巨大巢狀物件耗時。
 */
export function collectTransferables(value: unknown, maxDepth = 6): Transferable[] {
  const out = new Set<ArrayBuffer>()
  const seen = new Set<object>()
  const walk = (v: unknown, depth: number) => {
    if (v === null || typeof v !== 'object' || depth > maxDepth) return
    if (v instanceof ArrayBuffer) {
      if (v.byteLength > 0) out.add(v)
      return
    }
    if (ArrayBuffer.isView(v)) {
      const b = v.buffer
      if (b instanceof ArrayBuffer && b.byteLength > 0) out.add(b)
      return
    }
    if (seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
    } else if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(k, depth + 1)
        walk(x, depth + 1)
      }
    } else if (v instanceof Set) {
      for (const x of v) walk(x, depth + 1)
    } else {
      for (const x of Object.values(v)) walk(x, depth + 1)
    }
  }
  walk(value, 0)
  return [...out]
}
