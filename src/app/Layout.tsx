import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { GROUP_LABEL, PAGES, type PageGroup } from './registry'
import { MODE_LABEL, MODE_SHORT, MODES, useSettings, type LearningMode, type ThemeChoice } from './settings'
import { NavigationContext } from './navigation'
import { useMediaQuery } from './useMediaQuery'
// skip link、sr-only 狀態區、側欄清單與模式選擇器的樣式在 components.css；章節 chunk 還沒載入（或載入失敗）時也要有，所以由 Layout 直接引入
import '@/components/components.css'

const GROUP_ORDER: PageGroup[] = ['start', 'A', 'B', 'C', 'D', 'tools']
/** 零寬空白：同一句播報連續兩次時附加，讓 live region 的內容真的有變 */
const ZWSP = String.fromCharCode(0x200b)

/** 側欄變成抽屜的寬度（和 global.css 的 @media (max-width: 900px) 一致） */
export const DRAWER_QUERY = '(max-width: 900px)'
/** 頂列下拉選單改用短標籤的寬度（和 global.css 的 @media (max-width: 480px) 一致） */
export const NARROW_QUERY = '(max-width: 480px)'

export function Layout({ children }: { children: ReactNode }) {
  const { mode, setMode, theme, setTheme } = useSettings()
  const location = useLocation()
  const isDrawer = useMediaQuery(DRAWER_QUERY)
  const isNarrow = useMediaQuery(NARROW_QUERY)

  const [navOpen, setNavOpen] = useState(false)
  const [status, setStatus] = useState('')
  // 換頁（pathname 變更，hash / search 不算）：在同一次 render 關掉抽屜、把世代 +1，PageFrame 據此聚焦 h1 並播報
  const [prevPath, setPrevPath] = useState(location.pathname)
  const [generation, setGeneration] = useState(0)
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname)
    setNavOpen(false)
    setGeneration((g) => g + 1)
  }

  const toggleRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  const announce = useCallback((text: string) => {
    // 同一句話連播兩次時加一個零寬空白，讓 live region 的內容真的有變
    setStatus((prev) => (prev === text ? text + ZWSP : text))
  }, [])
  const navInfo = useMemo(() => ({ generation, announce }), [generation, announce])

  const closeNav = useCallback((returnFocus: boolean) => {
    setNavOpen(false)
    if (returnFocus) toggleRef.current?.focus()
  }, [])

  // 回到桌面寬度時抽屜狀態歸零
  useEffect(() => {
    if (!isDrawer) setNavOpen(false)
  }, [isDrawer])

  // 抽屜收起時側欄的 26 個連結不可被 Tab 到；抽屜打開時主內容不可操作（inert），焦點移到第一個連結
  useEffect(() => {
    const sidebar = sidebarRef.current
    const main = mainRef.current
    sidebar?.toggleAttribute('inert', isDrawer && !navOpen)
    main?.toggleAttribute('inert', isDrawer && navOpen)
    if (isDrawer && navOpen) {
      const first = sidebar?.querySelector<HTMLElement>('a.nav-link')
      first?.focus({ preventScroll: true })
    }
  }, [isDrawer, navOpen])

  // Esc 關閉抽屜並把焦點還給 ☰
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeNav(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen, closeNav])

  const skipToMain = useCallback(() => {
    mainRef.current?.focus()
  }, [])

  return (
    <NavigationContext.Provider value={navInfo}>
      <div className={`app-shell${navOpen ? ' nav-open' : ''}`}>
        {/* HashRouter 下 href="#main" 會被當成路由，所以 skip link 用按鈕聚焦 <main> */}
        <button type="button" className="c-skip-link" onClick={skipToMain}>
          跳到主要內容
        </button>
        <div className="c-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {status}
        </div>
        <header className="topbar">
          {isDrawer && (
            <button
              type="button"
              className="btn btn-icon nav-toggle"
              aria-label="開關目錄"
              aria-expanded={navOpen}
              aria-controls="sidebar-nav"
              ref={toggleRef}
              onClick={() => (navOpen ? closeNav(true) : setNavOpen(true))}
            >
              ☰
            </button>
          )}
          <NavLink to="/" className="brand">
            LMS × PLL <span>Calibration Lab</span>
          </NavLink>
          <div className="topbar-controls">
            <label className="select-label">
              <span>學習模式</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as LearningMode)} aria-label="學習模式">
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {isNarrow ? MODE_SHORT[m] : MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-label">
              <span>主題</span>
              <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)} aria-label="主題">
                <option value="system">跟隨系統</option>
                <option value="light">淺色</option>
                <option value="dark">深色</option>
              </select>
            </label>
          </div>
        </header>
        <nav id="sidebar-nav" className="sidebar" aria-label="章節目錄" ref={sidebarRef}>
          {GROUP_ORDER.map((g) => {
            const labelId = `nav-group-${g}`
            return (
              <div key={g} className="nav-group" role="group" aria-labelledby={labelId}>
                <div id={labelId} className="nav-group-label">
                  {GROUP_LABEL[g]}
                </div>
                <ul className="c-nav-list">
                  {PAGES.filter((p) => p.group === g).map((p) => (
                    <li key={p.id}>
                      <NavLink to={p.path} end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                        {p.nav}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <div className="nav-footer">
            v{__APP_VERSION__} · {__GIT_COMMIT__}
            <br />
            所有晶片數值均為 illustrative 示例，非量測數據。
          </div>
        </nav>
        <div className="nav-scrim" onClick={() => closeNav(true)} aria-hidden="true" />
        <main id="main" className="content" tabIndex={-1} ref={mainRef}>
          {children}
        </main>
      </div>
    </NavigationContext.Provider>
  )
}
