import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { neighbours, type PageEntry } from './registry'
import { ErrorBoundary } from './ErrorBoundary'

/** 每個頁面的共同外框：標題、章節對照、上一頁/下一頁。 */
export function PageFrame({ entry }: { entry: PageEntry }) {
  const { prev, next } = neighbours(entry.id)
  const Page = entry.component

  useEffect(() => {
    document.title = `${entry.nav} · LMS × PLL Lab`
    window.scrollTo(0, 0)
  }, [entry])

  return (
    <article className="page" data-page={entry.id}>
      {entry.id !== 'dashboard' && (
        <header className="page-header">
          <div className="page-kicker">
            {entry.specSections && <span>規格書 §{entry.specSections.join(', §')}</span>}
            {entry.tests && entry.tests.length > 0 && <span>· 驗證 {entry.tests.join(' / ')}</span>}
          </div>
          <h1>{entry.title}</h1>
        </header>
      )}
      <ErrorBoundary key={entry.id}>
        <Page />
      </ErrorBoundary>
      <nav className="page-pager" aria-label="章節導覽">
        {prev ? <Link to={prev.path}>← {prev.nav}</Link> : <span />}
        {next ? <Link to={next.path}>{next.nav} →</Link> : <span />}
      </nav>
    </article>
  )
}
