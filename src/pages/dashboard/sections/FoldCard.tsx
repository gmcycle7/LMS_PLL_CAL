import { useCallback, useState, type ReactNode, type SyntheticEvent } from 'react'

export interface FoldCardProps {
  /** details 的 id（「收合」按鈕要捲回的目標） */
  id?: string
  /** 額外的 class（ThesisFold 加上 dash-fold：較大的上下間距與標題） */
  className?: string
  title: ReactNode
  /** 標題下的一兩句說明：這張卡片裡有什麼、適合誰 */
  desc?: ReactNode
  /** 受控：由上層決定展開與否（頁內跳轉與深連結要先展開）；不給就自己管理，預設收合 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 展開的內容很長時，最後放一顆「收合」按鈕：收起來並捲回卡片本身（需要 id） */
  collapseLabel?: string
  children: ReactNode
}

/**
 * Beginner 模式的收合卡片：summary 就是卡片本身，按一下就地展開。
 * 內容只在展開之後才渲染——重的內容（上千條公式、方塊圖、互動實驗、整張表）不會一開始就進 DOM，新手首頁才不會一開始就是研究級的長頁。
 * 用原生 <details>：鍵盤（Enter／Space）、螢幕報讀器的展開／收合狀態與「在頁面中搜尋」都由瀏覽器處理。
 */
export function FoldCard({ id, className, title, desc, open, onOpenChange, collapseLabel, children }: FoldCardProps) {
  const [inner, setInner] = useState(false)
  const isOpen = open ?? inner
  const setOpen = useCallback(
    (next: boolean) => {
      setInner(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const onToggle = useCallback((e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open), [setOpen])
  const collapse = useCallback(() => {
    setOpen(false)
    if (id) document.getElementById(id)?.scrollIntoView?.({ behavior: 'auto', block: 'start' })
  }, [id, setOpen])
  return (
    <details id={id} className={`dash-foldcard${className ? ` ${className}` : ''}`} open={isOpen} onToggle={onToggle}>
      <summary className="dash-fold-summary">
        <span className="dash-fold-title">
          {title}
          <span className="dash-fold-state">（{isOpen ? '收合' : '展開'}）</span>
        </span>
        {desc && <span className="dash-fold-desc">{desc}</span>}
      </summary>
      {isOpen && (
        <div className="dash-fold-body">
          {children}
          {collapseLabel && (
            <div className="dash-fold-end">
              <button type="button" className="btn" onClick={collapse}>
                {collapseLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </details>
  )
}
