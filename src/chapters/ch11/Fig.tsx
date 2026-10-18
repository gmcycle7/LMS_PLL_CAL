import { Mermaid, accessibleText, mathText } from '@/components'
import { CH11_DIAGRAMS, type Ch11DiagramId } from './diagrams'

/** 圖號：依 CH11_DIAGRAMS 的順序（= 頁面上出現的順序）編成「圖 11-n」。 */
export function figLabel(id: Ch11DiagramId): string {
  const i = CH11_DIAGRAMS.findIndex((d) => d.id === id)
  if (i < 0) throw new Error(`Ch11 找不到方塊圖 ${id}`)
  return `圖 11-${i + 1}`
}

/** 正文中引用圖號（「先看圖 11-3 的左邊…」）；圖的順序改變時文字會自動跟著改。 */
export function FigRef({ id }: { id: Ch11DiagramId }) {
  return <strong className="ch11-figref">{figLabel(id)}</strong>
}

/**
 * 依 id 顯示本章的一張方塊圖（docs/teaching-style.md §8）。
 * 圖裡面的標籤（節點、連線、subgraph 標題）直接寫 `$…$`，由 `Mermaid` 元件用 KaTeX 排版；
 * 圖名與圖說不交給 Mermaid 的 caption，而是另外以 mathText 顯示（`$…$` 一樣是 KaTeX）；
 * 螢幕閱讀器用的 aria-label 則是去掉 `$` 的純文字。
 */
export function Fig({ id }: { id: Ch11DiagramId }) {
  const d = CH11_DIAGRAMS.find((x) => x.id === id)
  if (!d) throw new Error(`Ch11 找不到方塊圖 ${id}`)
  const label = figLabel(id)
  return (
    <div className="ch11-fig" id={`ch11-fig-${d.id}`}>
      <Mermaid chart={d.chart} ariaLabel={`${label}：${accessibleText(d.title)}`} />
      <p className="c-figcaption ch11-figcap">
        <strong>
          {label}：{mathText(d.title)}
        </strong>
        <br />
        {mathText(d.caption)}
      </p>
    </div>
  )
}
