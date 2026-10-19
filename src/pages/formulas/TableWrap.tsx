import { Children, cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { ScrollRegion } from '@/components'

/**
 * 本頁所有表格的外框：內容放得下時什麼都不多；放不下時才會橫向捲動，並且
 *   - 可用鍵盤聚焦（ScrollRegion：role=group + aria-label，axe 的 scrollable-region-focusable），
 *   - 在還有內容的那一側顯示一條漸層（`.fr-fade[data-fade-start / data-fade-end]`，formulas.css），
 *     讓讀者知道欄位沒有到此為止，不會再有「最右兩欄被切在畫面外、卻沒有任何提示」。
 * 捲動位置與大小用 scroll 事件與 ResizeObserver 追蹤，直接改 DOM 的 data 屬性（不經 React state，捲動時不重新 render）：
 *   data-fade-start / data-fade-end  還能往左／往右捲（漸層）
 *   data-fit    放得下（溢位 ≤ 2px，與 ScrollRegion 的判斷門檻相同）。`sticky` 的表格在 fit 時外框改成 overflow: visible，
 *               表頭的 position: sticky 才會相對於視窗（外框是捲動容器時它只相對於外框）；放不下時外框照常橫向捲動、表頭不黏
 *   data-tiny   只超出 1–6px（多半是 padding 或四捨五入）：隱藏橫向捲軸、不畫漸層，一條只能捲幾 px 的捲軸沒有用途
 *
 * `caption`：表格的標題（螢幕閱讀器念表格時先念它）。children 是單一 `<table>` 時，TableWrap 在它最前面插入視覺隱藏的 `<caption>`；
 * 沒給時由 Layout 的 a11yEnhance 依最近的標題自動補一個，所以每張表至少有 caption；有明確標題的表請傳 `caption`。
 */
export function TableWrap({
  className,
  label = '表格（可左右捲動）',
  sticky = false,
  caption,
  children,
}: {
  className?: string
  label?: string
  sticky?: boolean
  /** 表格標題（視覺隱藏的 <caption>）；純文字（名稱欄位不放 `$…$`，要先經過 accessibleText） */
  caption?: string
  children: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  const update = useCallback(() => {
    const host = hostRef.current
    const sc = host?.firstElementChild as HTMLElement | null
    if (!host || !sc) return
    const max = sc.scrollWidth - sc.clientWidth
    const scrollable = max > 2
    const big = max > 6 // 超出 1–6px 只是 padding 或四捨五入：不畫漸層（也不隱藏任何內容）
    const set = (k: 'fadeStart' | 'fadeEnd' | 'fit' | 'tiny', on: boolean) => {
      const v = on ? '1' : '0'
      if (host.dataset[k] !== v) host.dataset[k] = v
    }
    set('fadeStart', big && sc.scrollLeft > 2)
    set('fadeEnd', big && sc.scrollLeft < max - 2)
    set('fit', !scrollable)
    set('tiny', max > 0 && max <= 6)
  }, [])

  // 內容換了（搜尋過濾、展開 details）就重量。layout effect：第一次繪製之前就量好，sticky 表頭才不會先錯位一格再跳回來
  useLayoutEffect(update)
  useEffect(() => {
    const host = hostRef.current
    const sc = host?.firstElementChild as HTMLElement | null
    if (!sc) return
    sc.addEventListener('scroll', update, { passive: true })
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update)
      ro.observe(sc)
      if (sc.firstElementChild) ro.observe(sc.firstElementChild)
    }
    return () => {
      sc.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [update])

  return (
    <div className="fr-fade" ref={hostRef} data-fade-start="0" data-fade-end="0" data-fit="1" data-tiny="0">
      <ScrollRegion className={`table-wrap${sticky ? ' fr-sticky-wrap' : ''}${className ? ` ${className}` : ''}`} label={label}>
        {withCaption(children, caption)}
      </ScrollRegion>
    </div>
  )
}

/** children 是單一 <table> 且沒有自己的 <caption> 時，在最前面插入視覺隱藏的 <caption> */
function withCaption(children: ReactNode, caption: string | undefined): ReactNode {
  if (!caption || !isValidElement(children) || children.type !== 'table') return children
  const table = children as ReactElement<{ children?: ReactNode }>
  // 作者已經寫了 <caption> 就不再插一個（一張表只能有一個 caption）
  if (Children.toArray(table.props.children).some((c) => isValidElement(c) && c.type === 'caption')) return children
  return cloneElement(table, undefined, <caption className="c-sr-only">{caption}</caption>, table.props.children)
}
