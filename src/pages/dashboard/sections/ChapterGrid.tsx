import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ModelLevel, ScrollRegion, TestBadge } from '@/components'
import { GROUP_LABEL, PAGES, type PageGroup } from '@/app/registry'
import { CHAPTER_META, conditionsForPage, questionsForPage } from '../data'
import { summarizeErrata } from '../summaries'
import { ConditionChip, Rich, scrollToId, type Progress } from '../ui'

const GROUPS: PageGroup[] = ['A', 'B', 'C', 'D', 'tools']

/**
 * Beginner 的章節地圖：一張表，每章一列（已讀、章名連結、一句話）。
 * 模型層級、acceptance tests、涵蓋的條件與對應問題是 Engineer 以上才需要的資訊，留在卡片版；新手首頁因此少掉約 2,000 px。
 */
function ChapterTable({ progress }: { progress: Progress }) {
  return (
    <section id="dash-chapters" aria-labelledby="dash-chapters-h">
      <h2 id="dash-chapters-h" className="dash-h2">
        章節地圖 <span className="dash-h2-kicker">規格 §18.3</span>
      </h2>
      <p className="dash-lead-sm">
        點章名前往；勾選「已讀」只記在你自己的瀏覽器，路線的進度條會跟著更新。模型層級、驗收測試與涵蓋的條件，切到 Engineer 模式的卡片上看。
      </p>
      <ScrollRegion label="章節地圖（可捲動）" className="table-wrap">
        <table className="dash-ch-table">
          <thead>
            <tr>
              <th scope="col">已讀</th>
              <th scope="col">章節</th>
              <th scope="col">這一章在講什麼</th>
            </tr>
          </thead>
          {GROUPS.map((g) => {
            const pages = PAGES.filter((p) => p.group === g)
            if (pages.length === 0) return null
            return (
              <tbody key={g}>
                <tr className="dash-ch-group">
                  <th scope="rowgroup" colSpan={3}>
                    {GROUP_LABEL[g]}
                  </th>
                </tr>
                {pages.map((p) => {
                  const meta = CHAPTER_META[p.id]
                  const done = progress.done.has(p.id)
                  return (
                    <tr key={p.id} className={done ? 'is-done' : undefined}>
                      <td className="dash-ch-check">
                        <input type="checkbox" checked={done} onChange={() => progress.toggle(p.id)} aria-label={`標記「${p.nav}」為已讀`} />
                      </td>
                      <td>
                        <Link to={p.path} className="dash-ch-nav" title={p.title}>
                          {p.nav}
                        </Link>
                      </td>
                      <td className="dash-ch-line">{meta ? <Rich text={meta.summary} /> : p.title}</td>
                    </tr>
                  )
                })}
              </tbody>
            )
          })}
        </table>
      </ScrollRegion>
      {progress.done.size > 0 && (
        <p className="small muted" style={{ marginTop: 10 }}>
          你已標記 {progress.done.size} 頁為已讀。{' '}
          <button type="button" className="btn btn-icon" onClick={progress.clear}>
            清除已讀紀錄
          </button>
        </p>
      )}
    </section>
  )
}

/** 章節地圖：每頁的導覽名稱、規格段落、模型層級、T-id 驗證狀態、涵蓋的條件與回答的問題（compact = Beginner：精簡的表格版） */
export const ChapterGrid = memo(function ChapterGrid({ progress, compact = false }: { progress: Progress; compact?: boolean }) {
  const errata = useMemo(() => summarizeErrata(), [])
  if (compact) return <ChapterTable progress={progress} />
  return (
    <section id="dash-chapters" aria-labelledby="dash-chapters-h">
      <h2 id="dash-chapters-h" className="dash-h2">
        章節地圖 <span className="dash-h2-kicker">規格 §18.3</span>
      </h2>
      <p className="dash-lead-sm">
        每張卡片列出：規格書段落、本頁互動實驗使用的模型層級（L0–L6，滑過可看定義）、負責的 acceptance tests 與目前驗證狀態、涵蓋六個條件中的哪幾個、回答附錄 E 的哪幾題，以及相關勘誤數。Part A–C 的模型層級會由測試與各章原始碼核對；其餘頁面為編輯對照。
      </p>
      {GROUPS.map((g) => {
        const pages = PAGES.filter((p) => p.group === g)
        if (pages.length === 0) return null
        return (
          <div key={g}>
            <h3 className="dash-group-title">{GROUP_LABEL[g]}</h3>
            <div className="dash-ch-grid">
              {pages.map((p) => {
                const meta = CHAPTER_META[p.id]
                const conds = conditionsForPage(p.id)
                const qs = questionsForPage(p.id)
                const nErr = errata.byPage[p.id] ?? 0
                const done = progress.done.has(p.id)
                return (
                  <article key={p.id} className={`dash-ch-card${done ? ' is-done' : ''}`} aria-labelledby={`dash-ch-${p.id}`}>
                    <div className="dash-ch-top">
                      <Link to={p.path} className="dash-ch-nav" id={`dash-ch-${p.id}`}>
                        {p.nav}
                      </Link>
                      <label className="dash-done">
                        <input type="checkbox" checked={done} onChange={() => progress.toggle(p.id)} aria-label={`標記「${p.nav}」為已讀`} />
                        已讀
                      </label>
                    </div>
                    <div className="dash-ch-title">{p.title}</div>
                    {meta && (
                      <div className="dash-ch-summary">
                        <Rich text={meta.summary} />
                      </div>
                    )}
                    <div className="dash-ch-meta">
                      {p.specSections && p.specSections.length > 0 ? `規格 §${p.specSections.join('、§')}` : '規格：—'}
                      {nErr > 0 && ` · 相關勘誤 ${nErr} 項`}
                    </div>
                    {meta && meta.levels.length > 0 && (
                      <div className="dash-badges">
                        {meta.levels.map((l) => (
                          <ModelLevel key={l} level={l} />
                        ))}
                      </div>
                    )}
                    {p.tests && p.tests.length > 0 && (
                      <div className="dash-badges">
                        {p.tests.map((t) => (
                          <TestBadge key={t} id={t} />
                        ))}
                      </div>
                    )}
                    {(conds.length > 0 || qs.length > 0) && (
                      <div className="dash-chips">
                        {conds.map((c) => (
                          <ConditionChip key={c} id={c} />
                        ))}
                        {qs.map((q) => (
                          <button key={q} type="button" className="dash-chip" onClick={() => scrollToId(`dash-q-${q}`)} title={`附錄 E 第 ${q} 題`}>
                            Q{q}
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </div>
        )
      })}
      <p className="small muted" style={{ marginTop: 10 }}>
        另有 {errata.global} 項勘誤屬於全站符號 / 單位一致性（不限單一章節）。
        {progress.done.size > 0 && (
          <>
            {' '}
            你已標記 {progress.done.size} 頁為已讀。{' '}
            <button type="button" className="btn btn-icon" onClick={progress.clear}>
              清除已讀紀錄
            </button>
          </>
        )}
      </p>
    </section>
  )
})
