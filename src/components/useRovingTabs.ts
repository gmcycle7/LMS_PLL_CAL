import { useCallback, useId, type KeyboardEvent } from 'react'

/**
 * WAI-ARIA Tabs 模式（自動啟用）的共用鍵盤與屬性：
 * - tablist 內只有「目前分頁」是 Tab 停靠點（roving tabindex：選中 tabIndex=0，其餘 -1），
 *   所以一組 N 個分頁只佔 1 個停靠點，不是 N 個；
 * - ← → 在分頁間移動（首尾循環），Home／End 跳到第一個／最後一個；焦點移到哪個分頁就選到哪個；
 * - 每個分頁有 id 與 aria-controls，對應的面板有 id 與 aria-labelledby（用 `panelProps(i)`）。
 *
 * 用法：
 * ```tsx
 * const tabs = useRovingTabs(items.length, active, setActive)
 * <div role="tablist" aria-label="…" onKeyDown={tabs.onKeyDown}>
 *   {items.map((it, i) => <button role="tab" {...tabs.tabProps(i)} onClick={() => setActive(i)}>…</button>)}
 * </div>
 * {items.map((it, i) => <div role="tabpanel" {...tabs.panelProps(i)} hidden={i !== active}>…</div>)}
 * ```
 * 垂直排列的 tablist 請傳 `orientation: 'vertical'`（改用 ↑ ↓）。
 */
export interface RovingTabs {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  tabProps: (i: number) => { id: string; tabIndex: 0 | -1; 'aria-selected': boolean; 'aria-controls': string }
  panelProps: (i: number) => { id: string; 'aria-labelledby': string }
}

export function useRovingTabs(
  count: number,
  active: number,
  onSelect: (i: number) => void,
  { orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' } = {},
): RovingTabs {
  const base = useId()
  const tabId = (i: number) => `${base}-tab-${i}`
  const panelId = (i: number) => `${base}-panel-${i}`

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.altKey || e.ctrlKey || e.metaKey || count === 0) return
      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
      let to: number
      if (e.key === nextKey) to = (active + 1) % count
      else if (e.key === prevKey) to = (active - 1 + count) % count
      else if (e.key === 'Home') to = 0
      else if (e.key === 'End') to = count - 1
      else return
      e.preventDefault()
      onSelect(to)
      // 焦點跟著移動：此時新的分頁還沒 re-render，直接依序號找 DOM 節點
      const tabs = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')
      tabs[to]?.focus()
    },
    [active, count, onSelect, orientation],
  )

  return {
    onKeyDown,
    tabProps: (i) => ({ id: tabId(i), tabIndex: i === active ? 0 : -1, 'aria-selected': i === active, 'aria-controls': panelId(i) }),
    panelProps: (i) => ({ id: panelId(i), 'aria-labelledby': tabId(i) }),
  }
}
