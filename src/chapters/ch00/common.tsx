import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useUrlPreset } from '@/app/presets'
import { pageById } from '@/app/registry'
import type { PresetEntry } from '@/data/types'
import { ChapterFig, FigRef as SharedFigRef, Tex, bindHandCalc, scrollToElement } from '@/components'
import { HANDCALCS } from './handcalcs'
import { diagramByName, figureLabel, type DiagramName } from './diagrams'

/** 連到其他章節／頁面；標題取自 registry（避免硬寫章節名稱）。 */
export function PageLink({ id, children }: { id: string; children?: ReactNode }) {
  const p = pageById(id)
  if (!p) return <span>{children ?? id}</span>
  return <Link to={p.path}>{children ?? p.nav}</Link>
}

/** 「試試看」提示清單。 */
export function TryIt({ items }: { items: ReactNode[] }) {
  return (
    <div className="ch00-tryit">
      <div className="ch00-tryit-title">試試看</div>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 章內的「帶入手算」題（docs/teaching-style.md §7）：依 id 從本章的 HANDCALCS 取出，前面加一句邀請讀者「先自己算、再對答案」的話
 * （children 可換成該段落專屬的說法）。id 打錯時直接丟錯（測試會抓到），不會默默少一題。
 */
export const ChapterHandCalc = bindHandCalc(HANDCALCS)

/**
 * 章內的方塊圖（docs/teaching-style.md §8）：依名稱從 diagrams.ts 取出 Mermaid 原始碼與圖說，圖說前自動加上圖號。
 * children 是「怎麼看這張圖」的導讀：先看哪裡、再看哪裡，以及「圖上的 X 就是公式裡的 x」的對應（圖上的公式一律用 <Tex> 排版，
 * 不用 <code> 拼 Unicode）。圖說與圖內標籤的數學寫成 `$...$`，由 Mermaid 元件以 KaTeX 排版。
 * 名稱打錯時 TypeScript 與 diagramByName 都會擋下來，不會默默少一張圖。
 */
export function ChapterDiagram({ name, children }: { name: DiagramName; children: ReactNode }) {
  const d = diagramByName(name)
  const label = figureLabel(name)
  return (
    <ChapterFig chart={d.chart} label={label} caption={d.caption} ariaLabel={`${label}：${d.ariaLabel}`} id={`fig-${d.id}`} dataAttrs={{ 'data-diagram': d.name }} walkLabel={`怎麼看${label}`}>
      {children}
    </ChapterFig>
  )
}

/** 內文裡提到某張圖（例如「圖 0.8」）：點了會捲到那張圖。 */
export function FigRef({ name }: { name: DiagramName }) {
  return <SharedFigRef label={figureLabel(name)} target={`fig-${diagramByName(name).id}`} />
}

/** 小型的「你會發現…」重點框。 */
export function Observe({ children }: { children: ReactNode }) {
  return (
    <div className="ch00-observe">
      <span className="ch00-observe-label">你會發現</span>
      <div>{children}</div>
    </div>
  )
}

/**
 * 讀取網址上的 preset（`?preset=<id>`，且屬於此實驗），並回傳「這一次導覽」的識別字串 `visit`。
 * `visit` 由 preset id 與 react-router 的 location.key 組成：同一個 preset 連結再點一次也會得到新的值，
 * 所以內文裡「載入這組參數」的連結每次點都會重新套用（只比對 preset id 的話，第二次點會沒有反應）。
 */
export function usePresetVisit(experimentId: string): { preset: PresetEntry | undefined; visit: string | undefined } {
  const preset = useUrlPreset(experimentId)
  const { key } = useLocation()
  return { preset, visit: preset ? `${preset.id}@${key}` : undefined }
}

/**
 * 每次有新的 preset 導覽（`visit` 改變）時，把那個實驗（ExperimentShell 的 `#exp-<id>`）捲進畫面。
 * 本章很長、又有兩個實驗；不捲動的話，從 Gallery 或內文連結點進來的讀者只會停在原地，不知道 preset 已經套用。
 * 用 setTimeout 排在 PageFrame 的「換頁回到頂端」之後；上方的圖（Mermaid / Plotly）是延遲載入的，載入後版面會被推開，
 * 共用的 scrollToElement 會在 2 秒內再對齊幾次——使用者一旦自己捲動或按鍵就不再干涉。
 */
export function useScrollToExperiment(experimentId: string, visit: string | undefined) {
  useEffect(() => {
    if (!visit) return
    // scrollToElement 會在之後 2 秒內校正版面晚到造成的位移（上方的圖延遲載入），使用者自己捲動就停止
    const t = setTimeout(() => {
      const el = document.getElementById(`exp-${experimentId}`)
      if (el) scrollToElement(el)
    }, 0)
    return () => clearTimeout(t)
  }, [experimentId, visit])
}

/** 把 `文字 $tex$ 文字` 拆開排版：`$…$` 之間交給 KaTeX（給存在 .ts 資料檔裡、含少量數學的句子用）。 */
export function InlineMath({ text }: { text: string }) {
  const parts = text.split('$')
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <Tex key={i}>{part}</Tex> : part))}
    </>
  )
}
