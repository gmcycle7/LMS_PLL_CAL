import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { neighbours, type PageEntry, type PageGroup } from './registry'
import { ErrorBoundary } from './ErrorBoundary'
import { MODE_HINT, useSettings } from './settings'
import { useNavigationInfo } from './navigation'
import { ModePicker } from '@/components/ModePicker'
import { AnchorDeepLink } from '@/components/links'

/** 章節頁（含 07b 案例）才顯示模式提示；工具頁與 Part D 不顯示 */
const CHAPTER_GROUPS: readonly PageGroup[] = ['A', 'B', 'C']

/** 每個頁面的共同外框：標題、章節對照、模式提示、上一頁/下一頁。 */
export function PageFrame({ entry }: { entry: PageEntry }) {
  const { prev, next } = neighbours(entry.id)
  const Page = entry.component
  const { mode, modeChosen } = useSettings()
  const { generation, announce } = useNavigationInfo()
  const articleRef = useRef<HTMLElement>(null)

  useEffect(() => {
    document.title = `${entry.nav} · LMS × PLL Lab`
    window.scrollTo(0, 0)
  }, [entry])

  // 換頁後（首次載入不算）：焦點移到本頁 h1、播報「已切換到：標題」。
  // 延後到下一個 macrotask，讓 Layout 先把抽屜的 inert 拿掉（否則 inert 裡的元素 focus() 無效）。
  useEffect(() => {
    if (generation === 0) return
    const id = setTimeout(() => {
      const h1 = articleRef.current?.querySelector<HTMLElement>('h1')
      if (h1) {
        if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1
        h1.focus({ preventScroll: true })
      }
      announce(`已切換到：${entry.title}`)
    }, 0)
    return () => clearTimeout(id)
  }, [generation, entry, announce])

  const isChapter = CHAPTER_GROUPS.includes(entry.group)

  return (
    <article className="page" data-page={entry.id} ref={articleRef}>
      <ModePicker />
      {entry.id !== 'dashboard' && (
        <header className="page-header">
          <div className="page-kicker">
            {entry.specSections && <span>規格書 §{entry.specSections.join(', §')}</span>}
            {entry.tests && entry.tests.length > 0 && <span>· 驗證 {entry.tests.join(' / ')}</span>}
          </div>
          <h1 tabIndex={-1}>{entry.title}</h1>
        </header>
      )}
      {isChapter && modeChosen && (
        <p className="c-mode-hint" data-mode={mode}>
          {MODE_HINT[mode]}
        </p>
      )}
      <ErrorBoundary key={entry.id}>
        <Page />
      </ErrorBoundary>
      {/* 貼上的 ?f=／?a= 深連結：頁面載好後捲到目標（連結元件自己會處理點擊；這裡只管手打或複製的網址） */}
      <AnchorDeepLink />
      <nav className="page-pager" aria-label="章節導覽">
        {prev ? <Link to={prev.path}>← {prev.nav}</Link> : <span />}
        {next ? <Link to={next.path}>{next.nav} →</Link> : <span />}
      </nav>
    </article>
  )
}
