import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { DocumentTitle, useNavigationInfo } from './navigation'
import { GROUP_LABEL, PAGES, type PageGroup } from './registry'

const GROUP_ORDER: PageGroup[] = ['start', 'A', 'B', 'C', 'D', 'tools']

/**
 * 404：網址對不到任何頁面時顯示（App.tsx 的 path='*'）。
 * 說明這一頁不存在，並給三個出路：回 Dashboard、打開全站搜尋、直接從章節清單挑一章。
 * 路由的 pathname 會在說明裡原樣列出（HashRouter 下是 `#` 後面的部分），方便使用者看出是不是網址打錯。
 */
export function NotFound() {
  const { pathname } = useLocation()
  const { openSearch, announce } = useNavigationInfo()
  const headingRef = useRef<HTMLHeadingElement>(null)

  // 和 PageFrame 一致：換頁後焦點移到標題並播報（首次載入也一樣，因為這一頁本身就是「出錯」的訊息）
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
    announce('找不到這一頁。可以回 Dashboard、搜尋全站，或從章節清單選一章。')
  }, [announce, pathname])

  return (
    <article className="page c-notfound" data-page="not-found">
      <DocumentTitle />
      <header className="page-header">
        <h1 ref={headingRef} tabIndex={-1}>
          找不到此頁面
        </h1>
      </header>
      <p>
        網址 <code className="c-notfound-path">{pathname}</code> 沒有對應的頁面。可能是連結過時、章節改了編號，或網址打錯了。
      </p>

      <div className="c-notfound-exits">
        <Link to="/" className="btn btn-primary">
          回 Dashboard／學習路線
        </Link>
        <button type="button" className="btn" onClick={openSearch}>
          搜尋全站（快捷鍵 / 或 Ctrl／⌘ K）
        </button>
      </div>

      <nav className="c-notfound-list" aria-label="章節清單">
        <h2>或者直接挑一章</h2>
        {GROUP_ORDER.map((g) => (
          <section key={g} aria-labelledby={`nf-group-${g}`}>
            <h3 id={`nf-group-${g}`}>{GROUP_LABEL[g]}</h3>
            <ul>
              {PAGES.filter((p) => p.group === g).map((p) => (
                <li key={p.id}>
                  <Link to={p.path}>{p.nav}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </article>
  )
}
