import { memo, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { pageById } from '@/app/registry'
import { ROUTES, shortCode, type RouteDef } from '../data'
import type { Progress } from '../ui'

const ROUTE_COLOR: Record<RouteDef['id'], string> = { math: '--series-1', pll: '--series-3', chip: '--series-5' }

function RouteFlow({ route, progress }: { route: RouteDef; progress: Progress }) {
  // 同一頁可能出現在兩個步驟（例如 H(z) 與 Polarity 都在 Ch06）：進度以不重複的頁面計
  const pages = [...new Set(route.steps.map((s) => s.page))]
  const done = pages.filter((id) => progress.done.has(id)).length
  const style = { '--n': route.steps.length, '--route-c': `var(${ROUTE_COLOR[route.id]})` } as CSSProperties
  return (
    <article className="dash-route" style={style} aria-labelledby={`dash-route-${route.id}`}>
      <div className="dash-route-head">
        <h3 className="dash-route-title" id={`dash-route-${route.id}`}>
          {route.title}
          <small>{route.en}</small>
        </h3>
        <div className="dash-progress" aria-label={`${route.title} 已讀 ${done} / ${pages.length} 頁`}>
          <span className="dash-progress-bar" aria-hidden="true">
            <span style={{ width: `${(100 * done) / Math.max(1, pages.length)}%` }} />
          </span>
          已讀 {done}/{pages.length}
        </div>
      </div>
      <p className="small muted" style={{ margin: '4px 0 0' }}>
        {route.blurb}
      </p>
      <ol className="dash-flow">
        {route.steps.map((s, i) => {
          const page = pageById(s.page)
          if (!page) return null
          return (
            <li key={`${s.label}-${i}`} className={`dash-step${progress.done.has(s.page) ? ' is-done' : ''}`}>
              <Link to={page.path} className="dash-step-card" title={page.title}>
                <span className="dash-step-n">STEP {i + 1}</span>
                <span className="dash-step-label">{s.label}</span>
                <span className="dash-step-zh">{s.zh}</span>
                <span className="dash-step-meta">
                  {shortCode(s.page) ?? page.nav} · {s.sections}
                  {progress.done.has(s.page) ? ' ✓' : ''}
                </span>
              </Link>
              {s.also && s.also.length > 0 && (
                <div className="dash-step-also">
                  也見：
                  {s.also.map((id) => {
                    const p = pageById(id)
                    return p ? (
                      <Link key={id} to={p.path} title={p.title}>
                        {shortCode(id) ?? p.nav}
                      </Link>
                    ) : null
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </article>
  )
}

/** 規格 §19.1 的三條學習路線：步驟圖由 registry 的頁面組成，點擊即前往該章 */
export const RoutesSection = memo(function RoutesSection({ progress }: { progress: Progress }) {
  return (
    <section id="dash-routes" aria-labelledby="dash-routes-h">
      <h2 id="dash-routes-h" className="dash-h2">
        三條學習路線 <span className="dash-h2-kicker">規格 §19.1</span>
      </h2>
      <p className="dash-lead-sm">
        三條路線交會在同一組章節：數學路線告訴你<strong>為什麼</strong>，PLL 架構路線告訴你<strong>在哪裡</strong>，晶片驗證路線告訴你
        <strong>夠不夠好</strong>。第一次來建議先走數學路線的前三步，再沿 PLL 架構路線把訊號流走一遍。章節卡片上的「已讀」只存在你自己的瀏覽器。
      </p>
      {ROUTES.map((r) => (
        <RouteFlow key={r.id} route={r} progress={progress} />
      ))}
    </section>
  )
})
