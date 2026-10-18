import { Fragment, useCallback, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { pageById } from '@/app/registry'
import { useSettings, type LearningMode } from '@/app/settings'
import { accessibleText, Tex } from '@/components'
import { erratumById, erratumSummary } from './errata'
import { formulaById } from './registry'
import { jumpToFormula, showToast } from './jump'

/* ───────────── 學習模式（在 SettingsProvider 外不丟錯） ───────────── */

const MODE_RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

function useSettingsOrNull(): ReturnType<typeof useSettings> | null {
  try {
    return useSettings()
  } catch {
    return null
  }
}

export function useMode(): { mode: LearningMode; atLeast: (m: LearningMode) => boolean; setMode: ((m: LearningMode) => void) | null } {
  const s = useSettingsOrNull()
  const mode: LearningMode = s?.mode ?? 'engineer'
  return { mode, atLeast: (m) => MODE_RANK[mode] >= MODE_RANK[m], setMode: s?.setMode ?? null }
}

/** 與 ModeGate 相同，但在 SettingsProvider 之外也能用 */
export function Gate({ min, children }: { min: LearningMode; children: ReactNode }) {
  const { atLeast } = useMode()
  return atLeast(min) ? <>{children}</> : null
}

/* ───────────── 說明文字中的 $TeX$ ───────────── */

/** 把 '說明 $TeX$ 說明' 轉成文字 + KaTeX；'$$' 不支援（本頁只用行內）。 */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\$([^$]+)\$/g)
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <Tex key={i}>{p}</Tex> : <Fragment key={i}>{p}</Fragment>))}
    </>
  )
}

/* ───────────── 勘誤標記 ───────────── */

/** 驗證頁的勘誤深連結：'#/verification?e=E13'（驗證頁依 ID 列出勘誤並捲到該條） */
export function erratumHref(eid: string): string {
  return `#/verification?e=${encodeURIComponent(eid)}`
}

/** 「勘誤 Exx」：本站與規格書原文不同之處，連到驗證頁（依 ID 列出勘誤）；tooltip 為修正摘要 */
export function ErratumTag({ eid }: { eid: string }) {
  const rec = erratumById(eid)
  return (
    <a className={`fr-erratum fr-sev-${rec?.severity ?? 'unknown'}`} href={erratumHref(eid)} title={erratumSummary(eid)} data-erratum={eid}>
      勘誤 {eid}
    </a>
  )
}

export function ErrataList({ ids, empty = '—' }: { ids: readonly string[]; empty?: ReactNode }) {
  if (ids.length === 0) return <span className="muted">{empty}</span>
  return (
    <span className="fr-tag-row">
      {ids.map((e) => (
        <ErratumTag key={e} eid={e} />
      ))}
    </span>
  )
}

/* ───────────── 頁面與公式連結 ───────────── */

const SHORT_LABEL: Record<string, string> = {
  'case-sspll': '案例 SSPLL',
  models: 'Models',
  verification: '驗證頁',
  signoff: 'Sign-off',
  roadmap: 'Roadmap',
  lab: 'Lab',
  gallery: 'Gallery',
  papers: 'Papers',
  dashboard: 'Dashboard',
  formulas: '本頁',
}

/** 'ch12' → 'Ch12'；其他頁用短名 */
export function shortPageLabel(id: string, nav: string): string {
  if (/^ch\d\d$/.test(id)) return `Ch${id.slice(2)}`
  return SHORT_LABEL[id] ?? nav
}

export function PageLink({ id, short = false }: { id: string; short?: boolean }) {
  const p = pageById(id)
  if (!p) return <span className="fr-missing">{id}</span>
  const label = short ? shortPageLabel(id, p.nav) : p.nav
  return (
    <Link to={p.path} className="fr-page-link" title={p.title}>
      {label}
    </Link>
  )
}

export function PageLinks({ ids, short = true }: { ids: readonly string[]; short?: boolean }) {
  return (
    <span className="fr-tag-row">
      {ids.map((id) => (
        <PageLink key={id} id={id} short={short} />
      ))}
    </span>
  )
}

/**
 * 公式 ID 連結：先切換到該公式所在的頁面（HashRouter 路由），再等錨點 #formula-<id> 出現後捲過去。
 * href 仍是一般的 '#/ch/12'（可在新分頁開啟該頁）。
 */
export function FormulaLink({ id, children }: { id: string; children?: ReactNode }) {
  const navigate = useNavigate()
  const { mode, setMode } = useMode()
  const f = formulaById(id)
  if (!f) {
    return (
      <span className="fr-missing" title="公式登錄中找不到這個 ID">
        {id}（不存在）
      </span>
    )
  }
  return (
    <a
      href={`#${f.page}`}
      className="fr-formula-link"
      title={`${accessibleText(f.title)}（${f.pageNav}）`}
      data-formula={id}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // 讓瀏覽器自己開新分頁
        e.preventDefault()
        navigate(`${f.page}?f=${encodeURIComponent(id)}`)
        jumpToFormula(id, { onSwitchMode: setMode ? () => setMode('research') : undefined, isResearch: mode === 'research' })
      }}
    >
      {children ?? id}
    </a>
  )
}

/**
 * 攔截容器內所有公式連結（共用的 MetricTable「公式」欄用 <FormulaLink>，帶 data-formula-link）的點擊。
 * FormulaLink 自己先處理「本頁就有這條公式」（捲過去並 preventDefault，這裡看到 defaultPrevented 就不動）；
 * 剩下的是公式在別頁：這裡直接切到該公式所在的頁面，再捲到錨點（比 FormulaLink 的預設 href '#/formulas?f=…' 少一步，
 * 因為本頁有完整的公式登錄）。
 * 用法：<div onClick={useFormulaAnchorHandler()}>…</div>
 */
export function useFormulaAnchorHandler(): (e: ReactMouseEvent<HTMLElement>) => void {
  const navigate = useNavigate()
  const { mode, setMode } = useMode()
  return useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as Element | null
      const a = target?.closest?.('a[data-formula-link]')
      if (!a) return
      e.preventDefault() // 一律攔下：直接切頁，不經過 FormulaLink 的 '#/formulas?f=…'（同一頁的搜尋會把整頁過濾成一條公式）
      const id = a.getAttribute('data-formula-link') ?? ''
      const f = formulaById(id)
      if (!f) {
        showToast(`公式 ${id} 不在全站公式登錄中（可能是章節尚未登錄這個 ID）。`)
        return
      }
      navigate(`${f.page}?f=${encodeURIComponent(id)}`)
      jumpToFormula(id, { onSwitchMode: setMode ? () => setMode('research') : undefined, isResearch: mode === 'research' })
    },
    [navigate, mode, setMode],
  )
}

export function FormulaLinks({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return <span className="muted">—</span>
  return (
    <span className="fr-tag-row">
      {ids.map((id) => (
        <FormulaLink key={id} id={id} />
      ))}
    </span>
  )
}

/* ───────────── 頁內捲動（HashRouter 下不能用 <a href="#id">） ───────────── */

/** 捲到本頁的某個元素（扣掉 topbar 與黏在上方的搜尋列）；找不到時不做事 */
export function scrollToId(id: string, smooth = true): boolean {
  if (typeof document === 'undefined') return false
  const el = document.getElementById(id)
  if (!el) return false
  try {
    const cs = getComputedStyle(document.documentElement)
    const topbar = parseFloat(cs.getPropertyValue('--topbar-h')) || 52
    const bar = document.querySelector('.fr-search')
    const barH = bar instanceof HTMLElement ? bar.offsetHeight : 0
    const top = el.getBoundingClientRect().top + (window.scrollY || 0) - topbar - barH - 12
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  } catch {
    el.scrollIntoView?.()
  }
  return true
}

/* ───────────── 小元件 ───────────── */

/** 段落標題旁的「符合 n / m」計數 */
export function MatchCount({ shown, total, active }: { shown: number; total: number; active: boolean }) {
  if (!active) return <span className="fr-count">{total} 項</span>
  return (
    <span className={`fr-count${shown === 0 ? ' fr-count-zero' : ''}`} aria-live="polite">
      符合 {shown} / {total}
    </span>
  )
}

export function NoMatch({ what }: { what: string }) {
  return <p className="fr-nomatch muted">搜尋條件下沒有符合的{what}。清除搜尋或換一個關鍵字（中文、英文、TeX 或 Unicode 符號都可以）。</p>
}

/** 推導收合框：Beginner 預設收合、Engineer/Research 預設展開（教學規範 §6） */
export function Collapsible({ title, children, beginnerOpen = false }: { title: ReactNode; children: ReactNode; beginnerOpen?: boolean }) {
  const { mode } = useMode()
  const [open, setOpen] = useState(mode !== 'beginner' || beginnerOpen)
  return (
    <details className="fr-collapsible" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{title}</summary>
      <div className="fr-collapsible-body">{children}</div>
    </details>
  )
}
