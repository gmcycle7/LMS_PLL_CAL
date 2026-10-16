import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * React.lazy 的動態 import 在「部署後舊 hash 被刪」時會 404（Failed to fetch dynamically imported module），
 * 而 React.lazy 會把被 reject 的 promise 快取起來，之後怎麼重試都是同一個錯誤。
 * 這裡的做法（標準的 chunk load error → reload once）：
 *   1. 失敗時等 delayMs 再 import 一次（暫時性的網路問題）；
 *   2. 再失敗就整頁重新載入一次，用 sessionStorage 旗標避免無限迴圈；
 *   3. 旗標已存在（剛重新載入過仍失敗）就把錯誤丟給 ErrorBoundary，顯示「重新載入頁面」按鈕。
 */
export const CHUNK_RELOAD_KEY = 'lmspll.chunkReload'

const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk|Failed to fetch|NetworkError|Load failed/i

/** 是否為「程式檔案載入失敗」（而不是章節程式本身的錯誤） */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return CHUNK_ERROR_RE.test(msg)
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface RetryOptions {
  /** 第一次失敗後等多久再試（預設 300 ms） */
  delayMs?: number
  /** 整頁重新載入的動作（測試時可替換） */
  reload?: () => void
  /** 一次性旗標存放處；null 表示沒有 storage（就不自動 reload） */
  storage?: StorageLike | null
}

function safeSessionStorage(): StorageLike | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 清掉一次性旗標（例如使用者自己按了「重新載入頁面」，下次仍允許自動 reload 一次） */
export function clearChunkReloadFlag(storage: StorageLike | null = safeSessionStorage()) {
  try {
    storage?.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    /* ignore */
  }
}

/** 包住動態 import：失敗重試一次，再失敗 reload 一次（有旗標守衛），仍失敗才 reject。 */
export async function importWithRetry<T>(factory: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { delayMs = 300 } = opts
  const storage = opts.storage === undefined ? safeSessionStorage() : opts.storage
  const reload = opts.reload ?? (() => window.location.reload())

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const mod = await factory()
      clearChunkReloadFlag(storage)
      return mod
    } catch (err) {
      if (!isChunkLoadError(err)) throw err
      lastError = err
      if (attempt === 0) await sleep(delayMs)
    }
  }

  let alreadyReloaded = true
  try {
    alreadyReloaded = !!storage?.getItem(CHUNK_RELOAD_KEY)
    if (!alreadyReloaded) storage?.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    alreadyReloaded = true
  }
  if (storage && !alreadyReloaded) {
    reload()
    // 頁面正在重新載入：永不 resolve，讓 Suspense 的「載入中…」留在畫面上而不是閃一下錯誤
    return new Promise<T>(() => {})
  }
  throw lastError
}

/** React.lazy 加上失敗復原（見檔頭說明） */
export function lazyWithRetry<T extends ComponentType>(
  factory: () => Promise<{ default: T }>,
  opts?: RetryOptions,
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(factory, opts))
}
