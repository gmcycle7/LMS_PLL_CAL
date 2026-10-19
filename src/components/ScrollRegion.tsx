import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'

/** 橫向只超出這麼多 px 以內不算「可捲動」（隱藏捲軸、不可聚焦） */
export const TINY_OVERFLOW_PX = 6

export interface ScrollRegionProps extends HTMLAttributes<HTMLElement> {
  /** 元素種類：表格用 div（.table-wrap），程式碼用 pre（.c-code-pre） */
  as?: 'div' | 'pre'
  /** 可聚焦時的無障礙名稱，例如「程式碼（可捲動）」 */
  label: string
  children: ReactNode
}

/**
 * 可捲動區域（程式碼、寬表格、長 JSON）。內容真的比框大時才給 tabIndex=0、role=group 與 aria-label，
 * 讓鍵盤使用者能聚焦後用方向鍵捲動（axe：scrollable-region-focusable）；放得下時不多一個 Tab 停靠點。
 * 大小由 ResizeObserver 追蹤（欄寬改變、字型載入後重新判斷）。
 */
export function ScrollRegion({ as: Tag = 'div', label, className, children, ...rest }: ScrollRegionProps) {
  const ref = useRef<HTMLElement | null>(null)
  const [scrollable, setScrollable] = useState(false)
  // 只超出 1–6px（padding、四捨五入）：隱藏橫向捲軸，不給 tabIndex——一條只能捲幾 px 的捲軸沒有用途（同 formulas/TableWrap 的 data-tiny）
  const [tiny, setTiny] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const dx = el.scrollWidth - el.clientWidth
    const dy = el.scrollHeight - el.clientHeight
    const nextTiny = dx > 0 && dx <= TINY_OVERFLOW_PX && dy <= 2
    const next = !nextTiny && (dx > 2 || dy > 2)
    setTiny((prev) => (prev === nextTiny ? prev : nextTiny))
    setScrollable((prev) => (prev === next ? prev : next))
  }, [])

  // 每次 render 後重量（內容換了）；元素或其內容的大小改變時也重量
  useEffect(measure)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [measure, children])

  const a11y = scrollable ? { tabIndex: 0, role: 'group', 'aria-label': label } : {}
  return (
    <Tag ref={ref as never} className={`c-scroll${className ? ` ${className}` : ''}`} data-tiny={tiny ? 'true' : undefined} {...a11y} {...rest}>
      {children}
    </Tag>
  )
}
