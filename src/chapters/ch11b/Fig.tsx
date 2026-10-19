import { ChapterFig, FigRef as SharedFigRef, accessibleText } from '@/components'
import { CH11B_DIAGRAMS, type Ch11bDiagramId } from './diagrams'

/** 圖號：依 CH11B_DIAGRAMS 的順序（= 頁面上出現的順序）編成「圖 11b-n」。 */
export function figLabel(id: Ch11bDiagramId): string {
  const i = CH11B_DIAGRAMS.findIndex((d) => d.id === id)
  if (i < 0) throw new Error(`Ch11b 找不到方塊圖 ${id}`)
  return `圖 11b-${i + 1}`
}

/** 正文中引用圖號；圖的順序改變時文字會自動跟著改。 */
export function FigRef({ id }: { id: Ch11bDiagramId }) {
  return <SharedFigRef label={figLabel(id)} />
}

/**
 * 依 id 顯示本章的一張方塊圖（docs/teaching-style.md §8；共用的 ChapterFig）。
 * 圖裡面的標籤（節點、連線、subgraph 標題）直接寫 `$…$`，由 `Mermaid` 元件用 KaTeX 排版；
 * 圖說是「圖號｜圖名：一句話圖說」，同樣 `$…$` 以 KaTeX 排版；螢幕閱讀器用的 aria-label 是去掉 `$` 的純文字。
 */
export function Fig({ id }: { id: Ch11bDiagramId }) {
  const d = CH11B_DIAGRAMS.find((x) => x.id === id)
  if (!d) throw new Error(`Ch11b 找不到方塊圖 ${id}`)
  const label = figLabel(id)
  return <ChapterFig chart={d.chart} label={label} caption={`${d.title}：${d.caption}`} ariaLabel={`${label}：${accessibleText(d.title)}`} id={`ch11b-fig-${d.id}`} />
}
