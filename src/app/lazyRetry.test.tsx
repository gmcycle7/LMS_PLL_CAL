import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { CHUNK_RELOAD_KEY, clearChunkReloadFlag, importWithRetry, isChunkLoadError, lazyWithRetry } from './lazyRetry'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/index-CgGu2P7y.js')

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  }
}

/** 等一小段時間，確認 promise 既沒 resolve 也沒 reject（頁面正在 reload） */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending')
  const r = await Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((res) => setTimeout(() => res(marker), 30))])
  return r === marker
}

describe('isChunkLoadError', () => {
  it('認得 Chrome / Firefox / Safari / Vite 的 chunk 載入錯誤訊息', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: https://x/assets/a.js',
      'error loading dynamically imported module: https://x/assets/a.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/a.css',
      'Load failed',
    ]) {
      expect(isChunkLoadError(new Error(msg))).toBe(true)
    }
  })
  it('章節程式本身的錯誤不算', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isChunkLoadError(new RangeError('Invalid array length'))).toBe(false)
  })
})

describe('importWithRetry', () => {
  it('第一次失敗、第二次成功：回傳模組、不 reload、清掉旗標', async () => {
    const storage = memStorage({ [CHUNK_RELOAD_KEY]: '1' })
    const reload = vi.fn()
    const factory = vi.fn<() => Promise<{ default: string }>>().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce({ default: 'ok' })
    const mod = await importWithRetry(factory, { delayMs: 0, storage, reload })
    expect(mod.default).toBe('ok')
    expect(factory).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull()
  })

  it('連續兩次失敗、還沒 reload 過：設旗標、整頁 reload 一次，promise 保持 pending（畫面停在「載入中…」）', async () => {
    const storage = memStorage()
    const reload = vi.fn()
    const factory = vi.fn<() => Promise<{ default: string }>>().mockRejectedValue(chunkError())
    const p = importWithRetry(factory, { delayMs: 0, storage, reload })
    expect(await stillPending(p)).toBe(true)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(storage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull()
  })

  it('reload 過一次仍失敗（旗標已存在）：不再 reload，把錯誤丟給 ErrorBoundary', async () => {
    const storage = memStorage({ [CHUNK_RELOAD_KEY]: '1' })
    const reload = vi.fn()
    const err = chunkError()
    const factory = vi.fn<() => Promise<{ default: string }>>().mockRejectedValue(err)
    await expect(importWithRetry(factory, { delayMs: 0, storage, reload })).rejects.toBe(err)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('沒有 sessionStorage 時不自動 reload（避免無法守衛的迴圈），直接丟錯', async () => {
    const reload = vi.fn()
    const factory = vi.fn<() => Promise<{ default: string }>>().mockRejectedValue(chunkError())
    await expect(importWithRetry(factory, { delayMs: 0, storage: null, reload })).rejects.toThrow(/dynamically imported module/)
    expect(reload).not.toHaveBeenCalled()
  })

  it('不是 chunk 載入錯誤（章節程式本身壞掉）：不重試、不 reload，直接丟錯', async () => {
    const storage = memStorage()
    const reload = vi.fn()
    const err = new TypeError("Cannot read properties of undefined (reading 'map')")
    const factory = vi.fn<() => Promise<{ default: string }>>().mockRejectedValue(err)
    await expect(importWithRetry(factory, { delayMs: 0, storage, reload })).rejects.toBe(err)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull()
  })

  it('clearChunkReloadFlag 清掉旗標', () => {
    const storage = memStorage({ [CHUNK_RELOAD_KEY]: '1' })
    clearChunkReloadFlag(storage)
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull()
  })
})

describe('lazyWithRetry', () => {
  it('第一次 import 失敗時 Suspense 仍會等到第二次成功、畫出元件', async () => {
    const factory = vi
      .fn<() => Promise<{ default: () => JSX.Element }>>()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValueOnce({ default: () => <p>章節內容</p> })
    const Lazy = lazyWithRetry(factory, { delayMs: 0, storage: memStorage(), reload: vi.fn() })
    render(
      <Suspense fallback={<p>載入中…</p>}>
        <Lazy />
      </Suspense>,
    )
    expect(screen.getByText('載入中…')).toBeTruthy()
    expect(await screen.findByText('章節內容')).toBeTruthy()
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
