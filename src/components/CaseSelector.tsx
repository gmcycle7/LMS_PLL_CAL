import { CASE_IDS, type UseCasesResult } from './hooks'
import { useRovingTabs } from './useRovingTabs'

/**
 * Case A / B / C 切換列（搭配 useCases）。色點使用 --series-1..3，與 Plot colorway 一致。
 */
export function CaseSelector<P>({ cases, label = '比較組' }: { cases: UseCasesResult<P>; label?: string }) {
  const { cases: list, activeId, setActive, addCase, removeCase, canAdd, seed } = cases
  // roving tabindex + ← → Home End（Case 沒有對應的 tabpanel，所以不用 tabProps 的 aria-controls）
  const activeIndex = Math.max(0, list.findIndex((c) => c.id === activeId))
  const tabs = useRovingTabs(list.length, activeIndex, (i) => setActive(list[i].id))
  return (
    <div className="c-cases" role="group" aria-label={label}>
      <span className="small muted">{label}</span>
      <div className="c-cases-list" role="tablist" aria-label={label} onKeyDown={tabs.onKeyDown}>
        {list.map((c, i) => (
          <span key={c.id} className={`c-case${c.id === activeId ? ' is-active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={c.id === activeId}
              tabIndex={tabs.tabProps(i).tabIndex}
              className="c-case-btn"
              onClick={() => setActive(c.id)}
            >
              <span className="c-case-dot" style={{ background: `var(${c.colorVar})` }} aria-hidden="true" />
              Case {c.id}
            </button>
            {list.length > 1 && (
              <button
                type="button"
                className="c-case-remove"
                aria-label={`移除 Case ${c.id}`}
                onClick={() => removeCase(c.id)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {canAdd && (
        <button type="button" className="btn btn-icon" onClick={() => addCase()} aria-label="新增比較組（複製目前參數）">
          ＋ Case {CASE_IDS.find((id) => !list.some((c) => c.id === id))}
        </button>
      )}
      <span className="small muted">共用 seed {seed}（paired comparison）</span>
    </div>
  )
}
