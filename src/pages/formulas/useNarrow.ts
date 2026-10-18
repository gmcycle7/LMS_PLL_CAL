import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * 容器寬度小於 `below`（px）時回傳 true。
 * 用「容器」而不是視窗寬度：桌機的側欄占 288px，視窗 1000px 時內容欄只有約 650px，用 `matchMedia('(max-width: …)')` 量不到這一點。
 * `initial` 是量到之前的猜測（沒有 ResizeObserver 的環境，例如 jsdom，它就是答案）；寬度為 0（display:none、尚未排版）不算窄。
 */
export function useNarrow(ref: RefObject<HTMLElement | null>, below: number, initial = false): boolean {
  const [narrow, setNarrow] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setNarrow(w < below)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, below])
  return narrow
}
