import { Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from './settings'
import { Layout } from './Layout'
import { PAGES } from './registry'
import { PageFrame } from './PageFrame'
import { DocumentTitle } from './navigation'
import { NotFound } from './NotFound'

export default function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <Layout>
          <Suspense fallback={<div className="page-loading">載入中…</div>}>
            <Routes>
              {PAGES.map((p) => (
                // DocumentTitle 在 PageFrame 後面：同一個 commit 裡後面的 effect 後執行，最後寫入的標題才是 registry 的 title
                <Route
                  key={p.id}
                  path={p.path}
                  element={
                    <>
                      <PageFrame entry={p} />
                      <DocumentTitle entry={p} />
                    </>
                  }
                />
              ))}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </HashRouter>
    </SettingsProvider>
  )
}
