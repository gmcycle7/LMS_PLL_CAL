import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { fmt } from '@/simulation/core'
import { HandCalc, Mermaid, Tex } from '@/components'
import { handcalc } from './handcalcs'

/** 在 SettingsProvider 之外（例如單元測試）退回 'engineer'，不丟錯。useSettings 只呼叫一次 useContext。 */
export function useModeSafe(): LearningMode {
  try {
    return useSettings().mode
  } catch {
    return 'engineer'
  }
}

/** 「勘誤 Exx」小標籤：連到驗證頁（該頁依編號列出勘誤）。 */
export function Erratum({ id, note }: { id: string; note?: string }) {
  return (
    <a className="ch04-erratum" href="#/verification" title={note ?? `本站依 docs/validation.md 勘誤 ${id} 修正，與規格書原文不同`}>
      勘誤 {id}
    </a>
  )
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
 * Mermaid 圖 + 支援 `$...$` 的圖說。共用 Mermaid 的 caption 屬性是純文字（不經 mathText），
 * 圖說裡有符號（$\mu$、$H_\mathrm{PD}$、$S_k$ …）時改用這個包裝，就不必用 Unicode 拼公式（docs/teaching-style.md §3）。
 */
export function MermaidFig({ chart, caption, ariaLabel }: { chart: string; caption: string; ariaLabel: string }) {
  return (
    <div className="ch04-mermaid-fig">
      <Mermaid chart={chart} ariaLabel={ariaLabel} />
      <p className="c-figcaption ch04-mermaid-caption">{mt(caption)}</p>
    </div>
  )
}

/**
 * 「帶入手算」題（docs/teaching-style.md §7）：依 id 從本章 handcalcs.ts 取出，放在對應推導的正後方。
 * children 是邀請讀者「先換成自己的數字、用紙筆算一次」的那句話。
 */
export function HandCalcBox({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="ch04-handcalc">
      <p className="ch04-handcalc-lead">
        <strong>換你算：</strong>
        {children}
      </p>
      <HandCalc def={handcalc(id)} />
    </div>
  )
}
