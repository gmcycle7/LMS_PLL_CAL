import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { GROUP_LABEL, PAGES, type PageGroup } from './registry'
import { MODE_LABEL, useSettings, type LearningMode, type ThemeChoice } from './settings'

const GROUP_ORDER: PageGroup[] = ['start', 'A', 'B', 'C', 'D', 'tools']

export function Layout({ children }: { children: ReactNode }) {
  const { mode, setMode, theme, setTheme } = useSettings()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setNavOpen(false), [location.pathname])

  return (
    <div className={`app-shell${navOpen ? ' nav-open' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="btn btn-icon nav-toggle"
          aria-label="開關目錄"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          ☰
        </button>
        <NavLink to="/" className="brand">
          LMS × PLL <span>Calibration Lab</span>
        </NavLink>
        <div className="topbar-controls">
          <label className="select-label">
            <span>學習模式</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as LearningMode)} aria-label="學習模式">
              {(Object.keys(MODE_LABEL) as LearningMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
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
      <nav className="sidebar" aria-label="章節目錄">
        {GROUP_ORDER.map((g) => (
          <div key={g} className="nav-group">
            <div className="nav-group-label">{GROUP_LABEL[g]}</div>
            {PAGES.filter((p) => p.group === g).map((p) => (
              <NavLink key={p.id} to={p.path} end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                {p.nav}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="nav-footer">
          v{__APP_VERSION__} · {__GIT_COMMIT__}
          <br />
          所有晶片數值均為 illustrative 示例，非量測數據。
        </div>
      </nav>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <main className="content">{children}</main>
    </div>
  )
}
