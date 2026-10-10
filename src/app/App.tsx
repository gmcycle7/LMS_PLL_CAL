import { Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from './settings'
import { Layout } from './Layout'
import { PAGES } from './registry'
import { PageFrame } from './PageFrame'

export default function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <Layout>
          <Suspense fallback={<div className="page-loading">載入中…</div>}>
            <Routes>
              {PAGES.map((p) => (
                <Route key={p.id} path={p.path} element={<PageFrame entry={p} />} />
              ))}
              <Route path="*" element={<div className="page-loading">找不到此頁面。請由左側目錄選擇章節。</div>} />
            </Routes>
          </Suspense>
        </Layout>
      </HashRouter>
    </SettingsProvider>
  )
}
