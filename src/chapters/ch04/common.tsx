import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { fmt } from '@/simulation/core'
import { ChapterFig, FigRef as SharedFigRef, Tex, bindHandCalc } from '@/components'
import { diagramNumber } from './diagrams'
import { HANDCALCS } from './handcalcs'

/** 在 SettingsProvider 之外（例如單元測試）退回 'engineer'，不丟錯。useSettings 只呼叫一次 useContext。 */
export function useModeSafe(): LearningMode {
  try {
    return useSettings().mode
  } catch {
    return 'engineer'
  }
}

/**
 * 推導摺疊框：Beginner 預設收合（一鍵展開），Engineer / Research 預設展開（docs/teaching-style.md §6）。
 * 以 key 綁定模式，切換模式時重設預設狀態。
 */
export function DerivationFold({
  title,
  children,
  openAt = 'engineer',
  badge = '推導',
}: {
  title: ReactNode
  children: ReactNode
  openAt?: LearningMode
  /** 摺疊框左側的小標籤（預設「推導」；程式碼對照用「Python」等） */
  badge?: string
}) {
  const mode = useModeSafe()
  const rank: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }
  const open = rank[mode] >= rank[openAt]
  return (
    <details className="ch04-fold" open={open} key={mode}>
      <summary>
        <span className="ch04-fold-badge">{badge}</span> {title}
      </summary>
      <div className="ch04-fold-body">{children}</div>
    </details>
  )
}

/** 數字顯示（有限位數；非有限數顯示 —）。 */
export function f(x: number, digits = 4): string {
  return Number.isFinite(x) ? fmt(x, digits) : '—'
}

/** 數字轉 TeX（負號、科學記號）。 */
export function tx(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : '\\text{NaN}'
  const s = fmt(x, digits)
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  if (m) return `${m[1]}\\times10^{${Number(m[2])}}`
  return s
}

/** 同 tx，但負數加括號（放在乘號或加號後面時用，例如 10 × (−0.125)）。 */
export function txp(x: number, digits = 4): string {
  const s = tx(x, digits)
  return s.startsWith('-') ? `(${s})` : s
}

/** 小型 KPI 卡片列 */
export function KpiRow({ items }: { items: { label: ReactNode; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <div className="ch04-kpis">
      {items.map((it, i) => (
        <div key={i} className="ch04-kpi">
          <div className="ch04-kpi-label">{it.label}</div>
          <div className="ch04-kpi-value">{it.value}</div>
          {it.note && <div className="ch04-kpi-note">{it.note}</div>}
        </div>
      ))}
    </div>
  )
}

/** 把字串中 `$…$` 的片段以 KaTeX 行內公式顯示（推導理由、表格說明用；其餘為一般文字）。 */
export function mt(s: string): ReactNode {
  const parts = s.split('$')
  return <>{parts.map((part, i) => (i % 2 === 1 ? <Tex key={i}>{part}</Tex> : part ? <span key={i}>{part}</span> : null))}</>
}

/**
 * Mermaid 圖 + 支援 `$...$` 的圖說（共用的 ChapterFig：圖說前面是圖號「圖 4-n」，`$…$` 以 KaTeX 排版，不必用 Unicode 拼公式，docs/teaching-style.md §3）。
 * 圖號由 diagrams.ts 的登錄表（頁面順序）自動產生；沒有登錄（＝沒有經過 parser 測試）的圖會丟錯。
 */
export function MermaidFig({ chart, caption, ariaLabel }: { chart: string; caption: string; ariaLabel: string }) {
  const no = diagramNumber(chart)
  return <ChapterFig chart={chart} label={`圖 4-${no}`} caption={caption} ariaLabel={ariaLabel} id={`ch04-fig-${no}`} />
}

/** 正文裡引用某張圖的圖號（「圖 4-n」）：由登錄表查號，圖的順序調整時不會對不上。 */
export function FigRef({ chart }: { chart: string }) {
  return <SharedFigRef label={`圖 4-${diagramNumber(chart)}`} />
}

/**
 * 「帶入手算」題（docs/teaching-style.md §7）：依 id 從本章 handcalcs.ts 取出，放在對應推導的正後方。
 * children 是邀請讀者「先換成自己的數字、用紙筆算一次」的那句話。
 */
export const HandCalcBox = bindHandCalc(HANDCALCS)

/**
 * 本章分成兩個 Part（2026-10-19 審查：Beginner 路徑上第一個 PLL 章卻是全站最重的一章，RTL 細節和訊號流混在同一頁）：
 *   Part 1「訊號流：DTC → DSM → PD → GMAC」= §1–§3 + 思考題；Part 2「硬體實作：定點、暫存器、RTL 對照」= §4–§7。
 * PartHead 是 Part 1 的標題橫幅。PartFold 是 Part 2 的外框：Beginner 模式整段收成一個 <details>（只留一句摘要與「Engineer 模式才展開」的提示），
 * Engineer／Research 預設展開。內容永遠在 DOM 裡——公式錨點、?a= 深連結、站內搜尋與頁內目錄都找得到，
 * 共用的 revealAnchor／scrollToElement 會展開祖先 <details>——所以收合只影響版面，不影響任何連結。
 * 以 key 綁定模式：切換模式時重設預設狀態；使用者手動展開／收合優先。
 */
export function PartHead({ n, title, id, children }: { n: number; title: ReactNode; id: string; children: ReactNode }) {
  return (
    <div className="ch04-part-head">
      <span className="ch04-part-badge">Part {n}</span>
      <h2 className="ch04-part-title" id={id}>
        {title}
      </h2>
      <p className="ch04-part-lead">{children}</p>
    </div>
  )
}

export function PartFold({ n, title, id, lead, children }: { n: number; title: ReactNode; id: string; lead: ReactNode; children: ReactNode }) {
  const mode = useModeSafe()
  const open = mode !== 'beginner'
  return (
    <details className="ch04-part" open={open} key={mode} data-mode={mode}>
      <summary className="ch04-part-summary">
        <span className="ch04-part-badge">Part {n}</span>
        <h2 className="ch04-part-title" id={id}>
          {title}
        </h2>
        <span className="ch04-part-lead">{lead}</span>
        {!open && <span className="ch04-part-hint">目前是 Beginner 模式，這一部分預設收合：按這裡展開，或把頁首的學習模式切到 Engineer，就會自動展開。</span>}
      </summary>
      <div className="ch04-part-body">{children}</div>
    </details>
  )
}
