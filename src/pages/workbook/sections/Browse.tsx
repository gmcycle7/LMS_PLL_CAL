import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Callout, HandCalc, Tex, badgeClass, mathText } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { LEVELS, LEVEL_LABEL, isFiltered, type ChapterGroup, type Filters, type Level } from '../logic'
import { LevelBadge } from './common'

/* ───────────────────────── 篩選列（題庫瀏覽與隨機練習共用） ───────────────────────── */

export interface FilterBarProps {
  filters: Filters
  onChange: (f: Filters) => void
  /** 全部章節（含各章題數） */
  groups: readonly ChapterGroup[]
  /** 各難度的總題數 */
  levelCounts: Record<Level, number>
  /** 符合條件的題數／總題數 */
  shown: number
  total: number
}

export function FilterBar({ filters, onChange, groups, levelCounts, shown, total }: FilterBarProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  return (
    <div className="wb-filters" role="search" aria-label="篩選題目">
      <label className="wb-filter">
        <span className="wb-filter-label">章節</span>
        <select value={filters.chapter} onChange={(e) => set({ chapter: e.target.value })} aria-label="依章節篩選">
          <option value="">全部章節（{total}）</option>
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.nav}（{g.items.length}）
            </option>
          ))}
        </select>
      </label>
      <div className="wb-filter" role="group" aria-label="依難度篩選">
        <span className="wb-filter-label">難度</span>
        <div className="wb-chips">
          <button type="button" className={badgeClass('neutral', `wb-chip${filters.level === '' ? ' active' : ''}`)} aria-pressed={filters.level === ''} onClick={() => set({ level: '' })}>
            全部
          </button>
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              className={badgeClass('neutral', `wb-chip wb-chip-${l}${filters.level === l ? ' active' : ''}`)}
              aria-pressed={filters.level === l}
              data-level={l}
              onClick={() => set({ level: filters.level === l ? '' : l })}
            >
              {LEVEL_LABEL[l]}（{levelCounts[l]}）
            </button>
          ))}
        </div>
      </div>
      <label className="wb-filter wb-filter-search">
        <span className="wb-filter-label">搜尋標題</span>
        <input
          type="search"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="例如 pole、sigma、HC-05"
          aria-label="搜尋題目標題"
        />
      </label>
      <div className="wb-filter-result small" role="status" data-testid="wb-filter-count">
        符合 <strong>{shown}</strong>／{total} 題
        {isFiltered(filters) && (
          <button type="button" className="btn wb-clear" onClick={() => onChange({ chapter: '', level: '', q: '' })}>
            清除篩選
          </button>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────── 題庫瀏覽 ───────────────────────── */

export interface BrowseProps {
  /** 篩選後、依章節分組的題目 */
  groups: readonly ChapterGroup[]
  /** 在隨機練習中答對過的題號 */
  solved: readonly string[]
  /** 網址 ?hc=HC-03.1 指定要展開並捲到的題目 */
  focusId?: string | null
}

function Item({ def, open, solved, onToggle }: { def: HandCalcDef; open: boolean; solved: boolean; onToggle: () => void }) {
  const bodyId = `wb-item-body-${def.id}`
  return (
    <li className={`wb-item${open ? ' open' : ''}`} id={`wb-item-${def.id}`} data-handcalc={def.id} data-level={def.level}>
      <button type="button" className="wb-item-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="wb-item-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="wb-item-id">{def.id}</span>
        <span className="wb-item-title">{mathText(def.title)}</span>
        <span className="wb-item-meta">
          {solved && (
            <span className="wb-solved" title="在隨機練習中答對過">
              ✓ 已答對
            </span>
          )}
          <LevelBadge level={def.level} />
        </span>
      </button>
      {open && (
        <div className="wb-item-body" id={bodyId}>
          <HandCalc def={def} compact />
        </div>
      )}
    </li>
  )
}

/** 全部題目依章節分組；每一題點開才掛載完整的 <HandCalc compact />（161 題一次全畫會很慢）。 */
export function Browse({ groups, solved, focusId }: BrowseProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(focusId ? [focusId] : []))

  // 網址指定的題目：展開並捲到它。
  // 捲動延後一拍：第一次載入時外框（PageFrame）的 effect 會在子元件之後執行 window.scrollTo(0, 0)，同步捲動會被它蓋掉
  useEffect(() => {
    if (!focusId) return
    setOpen((s) => (s.has(focusId) ? s : new Set(s).add(focusId)))
    const timer = setTimeout(() => {
      const el = document.getElementById(`wb-item-${focusId}`)
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' })
    }, 0)
    return () => clearTimeout(timer)
  }, [focusId])

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const setGroup = (g: ChapterGroup, on: boolean) =>
    setOpen((s) => {
      const next = new Set(s)
      for (const d of g.items) {
        if (on) next.add(d.id)
        else next.delete(d.id)
      }
      return next
    })

  if (groups.length === 0) {
    return (
      <Callout kind="warn" title="沒有符合篩選條件的題目">
        請放寬章節、難度或關鍵字條件。關鍵字可以是題號（例如 <code>HC-05</code>）、公式編號（<code>F-12</code>）、英文術語（<code>pole</code>），或希臘字母的名稱（<code>sigma</code>；直接打{' '}
        <Tex>{String.raw`\sigma`}</Tex> 的字元也可以）。
      </Callout>
    )
  }

  return (
    <div className="wb-browse">
      {groups.map((g) => {
        const allOpen = g.items.every((d) => open.has(d.id))
        return (
          <section key={g.key} className="wb-group" aria-labelledby={`wb-group-${g.key}`} data-chapter={g.key}>
            <header className="wb-group-head">
              <h3 id={`wb-group-${g.key}`}>{g.nav}</h3>
              <span className="small muted">{g.items.length} 題</span>
              <Link className="small" to={g.path}>
                前往本章 →
              </Link>
              <button type="button" className="btn wb-group-toggle" onClick={() => setGroup(g, !allOpen)}>
                {allOpen ? '全部收合' : '全部展開'}
              </button>
            </header>
            <p className="small muted wb-group-title">{g.title}</p>
            <ul className="wb-items">
              {g.items.map((d) => (
                <Item key={d.id} def={d} open={open.has(d.id)} solved={solved.includes(d.id)} onToggle={() => toggle(d.id)} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
