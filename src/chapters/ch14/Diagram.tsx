import type { ReactNode } from 'react'
import { ChapterFig } from '@/components'

/**
 * 方塊圖版位（docs/teaching-style.md §8）：一張 Mermaid 圖、一句圖說（要看什麼），
 * 下面緊接「先看…再看…」的導讀，以及「圖上的 X 就是公式裡的 x」的對照（children，可用 KaTeX）。
 * 外框是共用的 ChapterFig（放大、文字版、導讀樣式都在共用層）。
 * 圖說（caption）與圖內節點／連線標籤的數學一律用 `$...$` LaTeX（圖內的由共用的 Mermaid 元件用 KaTeX 排版，原始碼見 diagrams.ts）。
 * children 裡的數學用 <Tex> 寫。
 */
export function Diagram({ chart, caption, children }: { chart: string; caption: string; children?: ReactNode }) {
  return (
    <ChapterFig className="ch14-diagram" chart={chart} caption={caption}>
      {children}
    </ChapterFig>
  )
}
