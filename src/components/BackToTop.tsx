import { useEffect, useState } from 'react'

/** 捲過這麼多個視窗高度之後才出現（短頁、頁首附近不需要它） */
export const BACK_TO_TOP_SCREENS = 1.5

/** 捲動位置是否已經超過門檻（純函式，測試用） */
export function pastBackToTopThreshold(scrollY: number, innerHeight: number): boolean {
  return scrollY > BACK_TO_TOP_SCREENS * innerHeight
}

/**
 * 浮動的「回到頂端」：捲過 1.5 個視窗才出現（PageOutline 把它放在右下角的浮動列裡）。
 * 捲動是瞬間的（長章節 6–8 萬 px，平滑捲動要 1.5 s 以上），回到頂端後把焦點放到本頁 h1。
 * 不用 hidden 屬性：.btn 的 display:inline-flex 會壓過 hidden 的 display:none（和 global.css 的 ☰ 一樣的坑），所以直接不渲染。
 */
export function BackToTop() {
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && pastBackToTopThreshold(window.scrollY, window.innerHeight))

  useEffect(() => {
    let raf: number | null = null
    const check = () => {
      raf = null
      const next = pastBackToTopThreshold(window.scrollY, window.innerHeight)
      setVisible((prev) => (prev === next ? prev : next))
    }
    const schedule = () => {
      if (raf !== null) return
      raf = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(check) : window.setTimeout(check, 16)
    }
    check()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf !== null) {
        if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(raf)
        window.clearTimeout(raf)
      }
    }
  }, [])

  if (!visible) return null
  return (
    <button
      type="button"
      className="btn c-backtop"
      onClick={() => {
        window.scrollTo(0, 0)
        const h1 = document.querySelector<HTMLElement>('main h1')
        if (h1) {
          if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1
          try {
            h1.focus({ preventScroll: true })
          } catch {
            /* 忽略 */
          }
        }
      }}
    >
      ↑ 回到頂端
    </button>
  )
}
