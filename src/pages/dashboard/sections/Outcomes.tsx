import { memo, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { badgeClass } from '@/components'
import { GROUP_LABEL, pageById } from '@/app/registry'
import { OUTCOMES, shortCode } from '../data'
import { Rich } from '../ui'

/**
 * Hero 下方的「學完你能做什麼」：三個 Part 各兩句可以驗證的能力，每句連到教那件事的章節。
 * 入口頁的工作是讓新手知道從哪開始、走完會得到什麼；這一條帶子就是答案，放在系統地圖與路線之前。
 */
export const OutcomesSection = memo(function OutcomesSection() {
  return (
    <section id="dash-outcomes" aria-labelledby="dash-outcomes-h">
      <h2 id="dash-outcomes-h" className="dash-h2">
        學完你能做什麼 <span className="dash-h2-kicker">三個 Part，各兩件做得到的事</span>
      </h2>
      <div className="dash-outcomes">
        {OUTCOMES.map((o) => (
          <article
            key={o.part}
            className="dash-outcome"
            style={{ '--outcome-c': `var(${o.color})` } as CSSProperties}
            aria-labelledby={`dash-outcome-${o.part}-h`}
          >
            <h3 id={`dash-outcome-${o.part}-h`} className="dash-outcome-title">
              {GROUP_LABEL[o.part]}
            </h3>
            <div className="dash-outcome-lead">學完之後你可以：</div>
            <ul className="dash-outcome-list">
              {o.can.map((c) => {
                const page = pageById(c.page)
                return (
                  <li key={c.page + c.text}>
                    <Rich text={c.text} />
                    {page && (
                      <Link to={page.path} className={badgeClass('neutral', 'dash-chip dash-chip-primary')} title={page.title}>
                        {shortCode(c.page) ?? page.nav} →
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </article>
        ))}
      </div>
    </section>
  )
})
