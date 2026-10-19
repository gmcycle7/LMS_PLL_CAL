/**
 * 閱讀位置記憶：每一頁記最後的 scrollY，上一頁／重新整理回到同一頁時還原。
 *
 *   sessionStorage  lmspll.scroll.<路徑>  = scrollY（整數 px）；路徑是路由的 pathname，例如 '/ch/04'
 *
 * 還原的條件（useScrollMemory）：
 *   - 這次導覽是「回去」（react-router 的 POP：瀏覽器上一頁／下一頁）或「整頁載入」（重新整理、從書籤打開），且
 *   - 網址沒有 ?a=、?f=、?e=（那些是明確的定位目標，由 AnchorDeepLink／驗證頁自己捲過去），且
 *   - 這一頁有記過一個大於 0 的位置。
 * 點連結換章（PUSH）永遠從頂端開始——新的一章不該跳到上次看的地方。
 *
 * 為什麼要自己做：章節是 lazy 載入、圖表（Plotly／Mermaid）接近視窗才畫，瀏覽器內建的捲動還原發生在內容長出來之前，只會被夾到頁尾。
 * 這裡的做法和 links/anchor.ts 的 settleScroll 一樣：每 80 ms 檢查一次，頁面夠高了就（瞬間）捲到目標，之後 2 秒內偏掉就拉回來；
 * 使用者自己動了捲軸（wheel／touch／key／mouse）就停止，不跟使用者搶捲軸。還原期間不寫入新的位置（PageFrame 換頁時會先捲到 0）。
 * 因此 useScrollMemory 也把 history.scrollRestoration 設成 'manual'，讓這裡成為唯一的還原者。
 *
 * sessionStorage 讀寫失敗（無痕、被封鎖）時安靜地略過。
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

export const SCROLL_KEY_PREFIX = 'lmspll.scroll.'
/** 這些參數代表網址已經指著一個明確目標：不還原 */
export const EXPLICIT_TARGET_PARAMS = ['a', 'f', 'e'] as const
/** 小於這個位置不值得還原（就在頁首） */
export const MIN_RESTORE_Y = 40
const POLL_MS = 80
const TIMEOUT_MS = 6000
const SETTLE_MS = 2000

export function scrollKey(path: string): string {
  return `${SCROLL_KEY_PREFIX}${path}`
}

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readScroll(path: string): number | null {
  try {
    const raw = store()?.getItem(scrollKey(path))
    if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null
    return Number(raw)
  } catch {
    return null
  }
}

export function writeScroll(path: string, y: number): void {
  try {
    store()?.setItem(scrollKey(path), String(Math.max(0, Math.round(y))))
  } catch {
    /* 忽略 */
  }
}

/** search（'?a=x&p=y'，有沒有 ? 都可以）是否帶明確的定位參數 */
export function hasExplicitTarget(search: string): boolean {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  return EXPLICIT_TARGET_PARAMS.some((k) => params.has(k))
}

/** 這次導覽要不要還原：整頁載入或 POP、沒有明確目標、有記過位置。回傳要捲到的位置或 null */
export function restoreTarget(opts: { path: string; search: string; navigationType: string; firstLoad: boolean }): number | null {
  if (!(opts.firstLoad || opts.navigationType === 'POP')) return null
  if (hasExplicitTarget(opts.search)) return null
  const y = readScroll(opts.path)
  return y !== null && y >= MIN_RESTORE_Y ? y : null
}

const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown', 'pointerdown'] as const

/**
 * 等頁面夠高就捲到 y，之後 settleMs 內偏掉就拉回；回傳取消函式。完成（到了、逾時、使用者動了、被取消）時呼叫 onDone 一次。
 * 頁面一直長不到 y（內容比上次短）：逾時就停在原地，不勉強。
 */
export function restoreScroll(y: number, opts: { onDone?: () => void; timeoutMs?: number; settleMs?: number; pollMs?: number } = {}): () => void {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const settleMs = opts.settleMs ?? SETTLE_MS
  const pollMs = opts.pollMs ?? POLL_MS
  const t0 = Date.now()
  let reachedAt: number | null = null
  let timer: number | null = null
  let done = false
  const finish = () => {
    if (done) return
    done = true
    if (timer !== null) window.clearTimeout(timer)
    for (const ev of USER_SCROLL_EVENTS) window.removeEventListener(ev, finish)
    opts.onDone?.()
  }
  for (const ev of USER_SCROLL_EVENTS) window.addEventListener(ev, finish, { passive: true })
  const tick = () => {
    timer = null
    if (done) return
    const now = Date.now()
    const maxY = document.documentElement.scrollHeight - window.innerHeight
    if (maxY >= y - 2) {
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y)
      if (reachedAt === null) reachedAt = now
    }
    if ((reachedAt !== null && now - reachedAt >= settleMs) || now - t0 >= timeoutMs) {
      finish()
      return
    }
    timer = window.setTimeout(tick, pollMs)
  }
  timer = window.setTimeout(tick, 0)
  return finish
}

/**
 * 掛在 Router 底下的 Layout：記錄捲動位置，回到同一頁時還原。
 * 寫入是同步的（每個 scroll 事件一次 sessionStorage.setItem，約每個 frame 一次）：離開頁面的那一刻，
 * 新頁面的 commit 與 PageFrame 的 scrollTo(0, 0) 會讓 scrollY 變掉，若等到離開時才寫就記到錯的值。
 */
export function useScrollMemory(): void {
  const { pathname, search } = useLocation()
  const navigationType = useNavigationType()
  const pathRef = useRef(pathname)
  const restoring = useRef(false)
  const firstLoad = useRef(true)

  useEffect(() => {
    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    } catch {
      /* 忽略 */
    }
    const onScroll = () => {
      if (!restoring.current) writeScroll(pathRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 在 commit 當下（早於任何新頁面造成的 scroll 事件）把「目前這一頁」換掉
  useLayoutEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  useEffect(() => {
    const isFirst = firstLoad.current
    firstLoad.current = false
    const y = restoreTarget({ path: pathname, search, navigationType, firstLoad: isFirst })
    if (y === null) return
    restoring.current = true
    const cancel = restoreScroll(y, {
      onDone: () => {
        restoring.current = false
      },
    })
    return () => {
      cancel()
      restoring.current = false
    }
    // 只在換頁時決定要不要還原；同一頁的 search 變動（?a= 之類）不重來
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
}
