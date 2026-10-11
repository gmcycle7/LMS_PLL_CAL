import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useUrlPreset } from '@/app/presets'
import { pageById } from '@/app/registry'
import type { PresetEntry } from '@/data/types'
import { HandCalc, Mermaid, Tex } from '@/components'
import errataData from '@/data/errata.json'
import { HANDCALCS } from './handcalcs'
import { diagramByName, figureLabel, type DiagramName } from './diagrams'

interface ErratumRecord {
  eid: string
  location: string
  correction: string
}

const ERRATA: ErratumRecord[] = (errataData as { errata: ErratumRecord[] }).errata

/**
 * 「勘誤 Exx」小標記：本頁與規格書原文不同之處，連到驗證頁（列出全部勘誤）。
 * 展開後顯示 docs/validation.md 的官方修正文字（來自 src/data/errata.json）。
 */
export function ErratumNote({ eid, children }: { eid: string; children: ReactNode }) {
  const rec = ERRATA.find((e) => e.eid === eid)
  return (
    <aside className="ch00-erratum" aria-label={`勘誤 ${eid}`}>
      <a className="ch00-erratum-badge" href="#/verification" title={rec ? `規格位置：${rec.location}` : undefined}>
        勘誤 {eid}
      </a>
      <span className="ch00-erratum-text">{children}</span>
      {rec && (
        <details className="ch00-erratum-details">
          <summary>官方修正文字</summary>
          <p className="small">{rec.correction}</p>
        </details>
      )}
    </aside>
  )
}

/** 行內的「勘誤 Exx」小標記（連到驗證頁；滑鼠移上去顯示規格位置）。用在句子中間提到勘誤時。 */
export function ErratumRef({ eid }: { eid: string }) {
  const rec = ERRATA.find((e) => e.eid === eid)
  return (
    <a className="ch00-erratum-badge ch00-erratum-inline" href="#/verification" title={rec ? `規格位置：${rec.location}` : undefined}>
      勘誤 {eid}
    </a>
  )
}

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
 * 章內的「帶入手算」題（docs/teaching-style.md §7）：依 id 從本章的 HANDCALCS 取出定義，
 * 前面加一句邀請讀者「先自己算、再對答案」的話（children 可換成該段落專屬的說法）。
 * id 打錯時直接丟錯（測試會抓到），不會默默少一題。
 */
export function ChapterHandCalc({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`找不到手算題 ${id}`)
  return (
    <div className="ch00-handcalc" data-handcalc={id}>
      <p className="ch00-handcalc-lead">
        <strong>換你算：</strong>
        {children ?? '把下面的數字換成你自己的，先用紙筆和計算機算一遍，再切到「看帶入過程」或按「對答案」和網站比。'}
      </p>
      <HandCalc def={def} />
    </div>
  )
}

/**
 * 捲動到本頁的某個元素。HashRouter 下 `href="#id"` 會被當成路由，所以頁內跳轉一律用按鈕 + scrollIntoView。
 * jsdom 沒有 scrollIntoView，所以用可選呼叫。
 */
export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

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
    <div className="ch00-diagram" id={`fig-${d.id}`} data-diagram={d.name}>
      <Mermaid chart={d.chart} caption={`${label}｜${d.caption}`} ariaLabel={`${label}：${d.ariaLabel}`} />
      <div className="ch00-diagram-walk">
        <span className="ch00-diagram-walk-label">怎麼看{label}</span>
        <div>{children}</div>
      </div>
    </div>
  )
}

/** 內文裡提到某張圖（例如「圖 0.8」）：點了會捲到那張圖。 */
export function FigRef({ name }: { name: DiagramName }) {
  return (
    <button type="button" className="ch00-link-button" onClick={() => scrollToId(`fig-${diagramByName(name).id}`)}>
      {figureLabel(name)}
    </button>
  )
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
 * 所以稍後再對齊兩次——使用者一旦自己捲動或按鍵就不再干涉。jsdom 沒有 scrollIntoView，所以用可選呼叫。
 */
export function useScrollToExperiment(experimentId: string, visit: string | undefined) {
  useEffect(() => {
    if (!visit) return
    let cancelled = false
    const stop = () => {
      cancelled = true
    }
    const scroll = () => {
      if (!cancelled) document.getElementById(`exp-${experimentId}`)?.scrollIntoView?.({ block: 'start' })
    }
    const timers = [0, 500, 1500].map((ms) => setTimeout(scroll, ms))
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const
    events.forEach((ev) => window.addEventListener(ev, stop, { passive: true, once: true }))
    return () => {
      stop()
      timers.forEach(clearTimeout)
      events.forEach((ev) => window.removeEventListener(ev, stop))
    }
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
