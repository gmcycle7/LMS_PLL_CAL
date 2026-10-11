import { useState } from 'react'
import { Mermaid, ModelLevel } from '@/components'
import { CONDITIONS, ITEMS, ITEM_STATUS_LABEL, itemStatus, statusCounts, subgoalCounts, SUB_STATUS_LABEL, type ItemId, type ItemStatus, type SubStatus } from '../data'
import { StatusBadge } from '../common'
import { DEPENDENCY_CHART } from '../diagrams'

const SUB_ORDER: SubStatus[] = ['on-site', 'preview', 'in-analysis', 'pending', 'not-started']
const FILTERS: (ItemStatus | 'all')[] = ['all', 'partial', 'pending', 'not-started', 'in-analysis']

function SubBar({ counts }: { counts: Record<SubStatus, number> }) {
  const total = SUB_ORDER.reduce((a, s) => a + counts[s], 0)
  return (
    <div className="rm-bar" role="img" aria-label={SUB_ORDER.map((s) => `${SUB_STATUS_LABEL[s]} ${counts[s]}`).join('，')}>
      {SUB_ORDER.map((s) => (counts[s] > 0 ? <span key={s} className={s} style={{ width: `${(100 * counts[s]) / Math.max(1, total)}%` }} /> : null))}
    </div>
  )
}

export function Overview({ onOpen }: { onOpen: (id: ItemId) => void }) {
  const [filter, setFilter] = useState<ItemStatus | 'all'>('all')
  const counts = statusCounts()
  const subs = subgoalCounts()
  const rows = ITEMS.filter((it) => filter === 'all' || itemStatus(it) === filter)
  return (
    <>
      <p>
        共 {ITEMS.length} 個研究題目（R1–R10 + SSPLL 案例）、{Object.values(subs).reduce((a, b) => a + b, 0)} 個子目標。子目標的分布：
      </p>
      <SubBar counts={subs} />
      <p className="small muted">
        {SUB_ORDER.map((s) => `${SUB_STATUS_LABEL[s]} ${subs[s]}`).join('　·　')}
      </p>
      <div className="rm-filter" role="group" aria-label="依狀態篩選">
        {FILTERS.map((f) => (
          <button key={f} type="button" className="btn" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? `全部（${ITEMS.length}）` : `${ITEM_STATUS_LABEL[f]}（${counts[f]}）`}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="rm-overview">
          <thead>
            <tr>
              <th>項目</th>
              <th>狀態</th>
              <th>模型層級（目前 → 目標）</th>
              <th>子目標</th>
              <th>對應條件</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const c: Record<SubStatus, number> = { 'on-site': 0, preview: 0, pending: 0, 'not-started': 0, 'in-analysis': 0 }
              for (const s of it.subgoals) c[s.status]++
              return (
                <tr key={it.id} data-item={it.id}>
                  <td>
                    <button type="button" className="btn rm-jump" onClick={() => onOpen(it.id)} aria-label={`跳到 ${it.id}`}>
                      {it.id}
                    </button>{' '}
                    {it.title}
                  </td>
                  <td>
                    <StatusBadge status={itemStatus(it)} />
                  </td>
                  <td className="nowrap">
                    {it.levelNow.map((l) => (
                      <ModelLevel key={l} level={l} />
                    ))}{' '}
                    → <ModelLevel level={it.levelTarget} />
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <SubBar counts={c} />
                    <span className="small muted">
                      {it.subgoals.length} 項；待辦 / 未開始 {c.pending + c['not-started']}
                    </span>
                  </td>
                  <td>
                    <div className="rm-cond-chips">
                      {CONDITIONS.filter((cd) => it.conditions.includes(cd.id)).map((cd) => (
                        <span key={cd.id} className="rm-cond-chip">
                          {cd.label.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Mermaid chart={DEPENDENCY_CHART} caption="研究題目之間的依賴：箭頭表示「前者的結果是後者的輸入」（規劃用，非驗證結果）" ariaLabel="研究題目依賴圖" />
    </>
  )
}
