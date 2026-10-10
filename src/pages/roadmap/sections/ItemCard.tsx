import type { ComponentType } from 'react'
import { ModelLevel, TexBlock } from '@/components'
import { useSettings } from '@/app/settings'
import { CONDITIONS, itemStatus, type ItemId, type RoadmapItem } from '../data'
import { ErratumTag, PageRef, Rich, StatusBadge, SubBadge } from '../common'
import R1Preview from '../previews/R1Colored'
import R2Preview from '../previews/R2Cyclo'
import R3Preview from '../previews/R3Quant'
import R4Preview from '../previews/R4Precond'
import R5Preview from '../previews/R5Design'
import R6Preview from '../previews/R6Comparator'
import R7Preview from '../previews/R7Multirate'
import R8Preview from '../previews/R8Tracking'
import R9Preview from '../previews/R9Accumulator'
import R10Preview from '../previews/R10Inverse'
import SspllPreview from '../previews/SspllPolarity'

export const PREVIEWS: Record<ItemId, ComponentType> = {
  R1: R1Preview,
  R2: R2Preview,
  R3: R3Preview,
  R4: R4Preview,
  R5: R5Preview,
  R6: R6Preview,
  R7: R7Preview,
  R8: R8Preview,
  R9: R9Preview,
  R10: R10Preview,
  SSPLL: SspllPreview,
}

export function cardDomId(id: ItemId): string {
  return `rm-item-${id}`
}

export function ItemCard({ item, open, onToggle }: { item: RoadmapItem; open: boolean; onToggle: () => void }) {
  const { atLeast } = useSettings()
  const Preview = PREVIEWS[item.id]
  return (
    <section className="rm-card" id={cardDomId(item.id)} aria-labelledby={`${cardDomId(item.id)}-h`} data-status={itemStatus(item)}>
      <div className="rm-card-head">
        <h3 id={`${cardDomId(item.id)}-h`}>
          {item.id}｜{item.title}
        </h3>
        <StatusBadge status={itemStatus(item)} />
      </div>
      <div className="rm-card-meta">
        <span>{item.spec}</span>
        <span>·</span>
        <span>
          目前 {item.levelNow.map((l) => <ModelLevel key={l} level={l} />)} → 目標 <ModelLevel level={item.levelTarget} />
        </span>
        <span>·</span>
        <span>
          條件：
          {CONDITIONS.filter((c) => item.conditions.includes(c.id))
            .map((c) => c.label.split(' ')[0])
            .join('、')}
        </span>
      </div>
      {item.link && (
        <a className="rm-link-out" href={item.link.href}>
          → {item.link.label}
        </a>
      )}
      <p>
        <strong>目標：</strong>
        <Rich text={item.goal} />
      </p>
      <p>
        <strong>為什麼重要：</strong>
        <Rich text={item.why} />
      </p>

      <details className="rm-math" open={atLeast('engineer')}>
        <summary>
          <strong>需要的數學</strong>（{item.math.length} 項）
        </summary>
        <ul className="rm-math-list">
          {item.math.map((m) => (
            <li key={m.label}>
              <div className="rm-math-label">
                <Rich text={m.label} />
              </div>
              <TexBlock>{m.tex}</TexBlock>
            </li>
          ))}
        </ul>
      </details>

      <h4>本站已經有的</h4>
      <ul>
        {item.covered.map((c) => (
          <li key={c.page + c.what}>
            <PageRef id={c.page} />：<Rich text={c.what} />
          </li>
        ))}
      </ul>

      <h4>子目標與狀態</h4>
      <div className="table-wrap">
        <table className="rm-subgoals">
          <tbody>
            {item.subgoals.map((s) => (
              <tr key={s.text} data-status={s.status}>
                <td>
                  <SubBadge status={s.status} />
                </td>
                <td>
                  <Rich text={s.text} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rm-badges" aria-label="相關勘誤">
        <span className="small muted">相關勘誤：</span>
        {item.errata.map((e) => (
          <ErratumTag key={e} eid={e} />
        ))}
      </div>
      {item.tests.length > 0 && (
        <p className="small muted">
          支撐本題的既有驗收測試：{item.tests.join('、')}（各 T-id 的狀態見 <a href="#/verification">驗證頁</a>；那是既有章節的狀態，不是本研究題目的狀態）。
        </p>
      )}

      {/* aria-label 用純文字：按鈕內有 KaTeX（MathML），讓輔助技術直接讀到「哪一題的預覽」 */}
      <button type="button" className="btn btn-primary rm-preview-toggle" aria-expanded={open} aria-label={open ? `收起數學預覽：${item.id}` : `展開數學預覽：${item.id}`} onClick={onToggle}>
        {open ? '收起數學預覽' : <>展開數學預覽：<Rich text={item.preview} /></>}
      </button>
      {open && <Preview />}
    </section>
  )
}
