/**
 * 案例頁的大型資料檔（按需載入）。
 *
 * `src/data/sspll/` 裡最大的兩組檔案——sign map（signmap_L*.json，各約 260–300 KB）與 H_PD 網格（hpd_L*.json，各約 140–155 KB）——
 * 只有三個地方用到：實驗 A（HpdExplorer）、實驗 B（SignMapExplorer）與 §15 的 near-grid 區間。原本 data.ts 靜態 import 它們，
 * 整個案例頁的 chunk 因此多了約 1.3 MB（原始大小）。現在改成 `import()`：每個檔案各自成為一個 chunk，
 * 該迴路的資料要用到時才載入（而且只在對應的區塊接近視窗時才開始載入）。
 *
 * 用法：元件呼叫 `useSspllData('hpd' | 'signmap', loop, watchId)`，資料還沒到時回傳 `data: null`，到了之後自動重新渲染；
 * 測試用 `loadAllSspllData()` 先把全部載進快取，之後第一次渲染就拿得到資料。
 * 其餘較小的檔案（params.json、pred_vs_sim.json、worked_examples 等）仍由 data.ts 同步 import，頁面第一次渲染就用得到。
 * 顯示的數字與靜態 import 時完全相同（同一份 JSON，沒有縮減精度）。
 */
import { useEffect, useReducer, useState } from 'react'
import type { HpdJson, LoopKey, SignMapJson } from './data'

/** 可按需載入的資料種類與它的型別 */
export interface SspllBigData {
  /** hpd_L*.json：H_PD 的 golden 網格（1500 點）與各對策的 Re Γ */
  hpd: HpdJson
  /** signmap_L*.json：α sign map（2000 點）：GOS、PHOS 各模態、大訊號、各對策 */
  signmap: SignMapJson
}
export type SspllDataKind = keyof SspllBigData

type Importer = () => Promise<{ default: unknown }>

/** 每個檔案各一個 `import()`（路徑必須是字面字串，Vite 才能把它切成獨立的 chunk） */
const IMPORTERS: { [K in SspllDataKind]: Record<LoopKey, Importer> } = {
  hpd: {
    L1: () => import('@/data/sspll/hpd_L1.json'),
    L2: () => import('@/data/sspll/hpd_L2.json'),
    L3: () => import('@/data/sspll/hpd_L3.json'),
  },
  signmap: {
    L1: () => import('@/data/sspll/signmap_L1.json'),
    L2: () => import('@/data/sspll/signmap_L2.json'),
    L3: () => import('@/data/sspll/signmap_L3.json'),
  },
}

const loaded = new Map<string, unknown>()
const pending = new Map<string, Promise<unknown>>()
const keyOf = (kind: SspllDataKind, loop: LoopKey) => `${kind}:${loop}`

/** 已載入的資料（同步）；還沒載入時為 null */
export function peekSspllData<K extends SspllDataKind>(kind: K, loop: LoopKey): SspllBigData[K] | null {
  return (loaded.get(keyOf(kind, loop)) as SspllBigData[K] | undefined) ?? null
}

/** 載入一個檔案（同一個檔案只會載一次；失敗時不留下半成品，下次呼叫會重試） */
export function loadSspllData<K extends SspllDataKind>(kind: K, loop: LoopKey): Promise<SspllBigData[K]> {
  const key = keyOf(kind, loop)
  const hit = loaded.get(key)
  if (hit !== undefined) return Promise.resolve(hit as SspllBigData[K])
  let p = pending.get(key)
  if (!p) {
    p = IMPORTERS[kind][loop]().then(
      (m) => {
        loaded.set(key, m.default)
        pending.delete(key)
        return m.default
      },
      (e: unknown) => {
        pending.delete(key)
        throw e
      },
    )
    pending.set(key, p)
  }
  return p as Promise<SspllBigData[K]>
}

/** 全部載入（測試與離線檢查用；頁面本身不呼叫它） */
export async function loadAllSspllData(): Promise<{ HPD: Record<LoopKey, HpdJson>; SIGNMAP: Record<LoopKey, SignMapJson> }> {
  const L: LoopKey[] = ['L1', 'L2', 'L3']
  const [h, s] = await Promise.all([Promise.all(L.map((l) => loadSspllData('hpd', l))), Promise.all(L.map((l) => loadSspllData('signmap', l)))])
  return { HPD: { L1: h[0], L2: h[1], L3: h[2] }, SIGNMAP: { L1: s[0], L2: s[1], L3: s[2] } }
}

/** 區塊進入視窗下緣之前這麼多 px 就開始載入（讀者捲到之前資料多半已經到了） */
export const APPROACH_MARGIN_PX = 900

export interface SspllDataState<K extends SspllDataKind> {
  /** 資料；還沒載入（或載入失敗）時為 null */
  data: SspllBigData[K] | null
  /** idle：區塊還離得很遠，沒有開始載入；loading：載入中；ready：資料已就緒；error：載入失敗（網路中斷等） */
  status: 'idle' | 'loading' | 'ready' | 'error'
}

/**
 * 按需載入 `kind` 在迴路 `loop` 的資料。
 * `watchId` 是會用到這份資料的區塊的 DOM id：給了而且瀏覽器支援 IntersectionObserver 時，等該區塊離視窗不到 {@link APPROACH_MARGIN_PX} px 才開始載入；
 * 沒給（或沒有 IntersectionObserver，例如 jsdom）就在第一次渲染後立刻載入。已經在快取裡的資料第一次渲染就同步回傳。
 */
export function useSspllData<K extends SspllDataKind>(kind: K, loop: LoopKey, watchId?: string): SspllDataState<K> {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [failed, setFailed] = useState<string | null>(null)
  const key = keyOf(kind, loop)
  const data = peekSspllData(kind, loop)
  const [near, setNear] = useState(() => data !== null || !watchId || typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (near) return
    const el = watchId ? document.getElementById(watchId) : null
    if (!el) {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      { rootMargin: `${APPROACH_MARGIN_PX}px 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near, watchId])

  useEffect(() => {
    if (!near || data !== null) return
    let alive = true
    loadSspllData(kind, loop).then(
      () => {
        if (alive) bump()
      },
      () => {
        if (alive) setFailed(key)
      },
    )
    return () => {
      alive = false
    }
  }, [near, data, kind, loop, key])

  if (data !== null) return { data, status: 'ready' }
  return { data: null, status: failed === key ? 'error' : near ? 'loading' : 'idle' }
}
