import type { ReactNode } from 'react'
import { Mermaid } from '../Mermaid'
import { JumpTo } from './JumpTo'
import './chapter.css'

export interface ChapterFigProps {
  /** Mermaid 原始碼（圖內標籤的數學寫 `$…$`） */
  chart: string
  /** 圖號文字，例如 '圖 10-3'、'圖 0.8'；會放在圖說最前面（「圖 10-3｜…」） */
  label?: string
  /** 圖種（例如「比較圖」）：括在圖號後面 */
  kind?: string
  /** 圖說：一句話說明要看什麼；`$…$` 以 KaTeX 排版。和 richCaption 擇一 */
  caption?: string
  /**
   * 圖說是 JSX（裡面有 `<Tex>`、`<strong>`）時用這個：畫成圖下方的一段 `<p class="c-figcaption">`，圖號（粗體）與圖種接在前面。
   * 圖本身不帶 figcaption，螢幕閱讀器的文字替代用 ariaLabel。
   */
  richCaption?: ReactNode
  /** 螢幕閱讀器用的文字替代（純文字；數學要先經過 accessibleText）。預設用圖說 */
  ariaLabel?: string
  /** 圖外框的 id（正文用 FigRef 或 ?a= 連過來） */
  id?: string
  /** 加在外框上的 class（章節自己的 hook） */
  className?: string
  /** 加在外框上的 data-* 屬性（測試與審查腳本的 hook），例如 { 'data-diagram': 'g1' } */
  dataAttrs?: Record<`data-${string}`, string | undefined>
  /** 「怎麼看這張圖」的導讀：先看哪裡、再看哪裡，以及「圖上的 X 就是公式裡的 x」的對應 */
  children?: ReactNode
  /** 導讀的標籤；false = 不要標籤。預設「怎麼看這張圖」 */
  walkLabel?: ReactNode | false
}

/**
 * 章內的方塊圖（docs/teaching-style.md §8）：Mermaid 圖（共用的 DiagramFrame：放大、文字版）＋圖號圖說＋可選的導讀。
 * 圖說的 `$` 不成對時丟錯（和 mathText 一樣，由章節測試抓到），避免圖說裡留下沒有排版的 TeX。
 * 圖的查表（依 id 找到 chart、圖號、圖說）是每章自己的事（diagrams.ts 的登錄表）；這裡只負責外框與版面，
 * 原本 13 章各有一份外框（Diagram／Fig／ChapterDiagram／BlockDiagram／MermaidFig），圖號、圖說、導讀的樣式各不相同。
 */
export function ChapterFig({ chart, label, kind, caption = '', richCaption, ariaLabel, id, className, dataAttrs, children, walkLabel }: ChapterFigProps) {
  if (caption.split('$').length % 2 === 0) throw new Error(`ChapterFig：圖說的 $ 不成對：${caption}`)
  const head = label && !richCaption ? `${label}${kind ? `（${kind}）` : ''}${caption ? '｜' : ''}` : ''
  return (
    <div className={className ? `c-chapter-fig ${className}` : 'c-chapter-fig'} id={id} {...dataAttrs}>
      <Mermaid chart={chart} caption={richCaption ? undefined : `${head}${caption}` || undefined} ariaLabel={ariaLabel} />
      {richCaption ? (
        <p className="c-figcaption c-chapter-fig-richcap">
          {label ? <strong>{label}</strong> : null}
          {kind ? `（${kind}）` : null}
          {richCaption}
        </p>
      ) : null}
      {children ? (
        <div className="c-chapter-fig-walk">
          {walkLabel !== false && <span className="c-chapter-fig-walk-label">{walkLabel ?? '怎麼看這張圖'}</span>}
          <div className="c-chapter-fig-walk-body">{children}</div>
        </div>
      ) : null}
    </div>
  )
}

export interface FigRefProps {
  /** 圖號文字，例如 '圖 10-3'（由各章的登錄表算出，圖的順序改變時不會對不上） */
  label: string
  /** 圖外框的 id；給了就是「點了捲到那張圖」的按鈕，沒給就是一般的粗體文字 */
  target?: string
  className?: string
  /** 加在圖號上的 data-* 屬性（測試的 hook），例如 { 'data-figref': 'coupling' } */
  dataAttrs?: Record<`data-${string}`, string | undefined>
}

/** 正文裡提到某張圖（「先看圖 11-3 的左邊…」）：圖號不要在中間斷行。 */
export function FigRef({ label, target, className, dataAttrs }: FigRefProps) {
  const cls = className ? `c-figref ${className}` : 'c-figref'
  if (target) {
    return (
      <JumpTo target={target} className={cls}>
        {label}
      </JumpTo>
    )
  }
  return (
    <strong className={cls} {...dataAttrs}>
      {label}
    </strong>
  )
}
