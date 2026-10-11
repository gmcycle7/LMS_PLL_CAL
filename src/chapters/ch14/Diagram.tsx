import type { ReactNode } from 'react'
import { Mermaid } from '@/components'

/**
 * 方塊圖版位（docs/teaching-style.md §8）：一張 Mermaid 圖、一句圖說（要看什麼），
 * 下面緊接「先看…再看…」的導讀，以及「圖上的 X 就是公式裡的 x」的對照（children，可用 KaTeX）。
 * 圖說（caption）支援 `$...$` 行內公式，圖說裡的數學一律用 LaTeX；圖內節點文字才用 Unicode（Mermaid 不渲染 KaTeX）。
 * children 裡的數學用 <Tex> 寫。
 */
export function Diagram({ chart, caption, children }: { chart: string; caption: string; children?: ReactNode }) {
  return (
    <div className="ch14-diagram">
      <Mermaid chart={chart} caption={caption} />
      {children && <div className="ch14-diagram-walk">{children}</div>}
    </div>
  )
}
