import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { CLAIM_DESCRIPTION, CLAIM_LABEL, MODEL_LEVEL_INFO, SOURCE_DESCRIPTION, SOURCE_LABEL, modelLevelText } from './labels'
import type { ClaimKind, ModelLevelId, SourceKind } from './types'

export interface TipBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  className: string
  /** 徽章上的文字 */
  children: ReactNode
  /** tooltip 內容 */
  tip: ReactNode
}

/**
 * 帶 tooltip 的小徽章。徽章只是標示、沒有動作，所以**不可聚焦**（沒有 tabIndex）：一章有幾十個內容相同的徽章，
 * 不該各佔一個 Tab 停靠點（也不該在點一下之後留下焦點框）。
 * - 滑鼠：移上去顯示（CSS :hover）。
 * - 觸控／點擊：點一下切換顯示（`is-open`），點徽章以外的地方收起。
 * - 螢幕閱讀器：tooltip 以 aria-describedby 連到徽章，不論有沒有顯示都念得到（顯示前是 display:none，不會被當成徽章本文重複念）。
 * - 按 Esc 關閉（WCAG 1.4.13）：顯示中（滑鼠停留或已點開）時監聽 document 的 keydown，加上 `is-dismissed`；
 *   滑鼠移開或再點一次後重設。
 */
export function TipBadge({ className, children, tip, onClick, ...rest }: TipBadgeProps) {
  const tipId = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const active = hover || pinned

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDismissed(true)
        setPinned(false)
      }
    }
    const onOutside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setPinned(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onOutside)
    }
  }, [active])

  return (
    <span
      {...rest}
      ref={ref}
      className={`c-badge c-has-tip ${className}${pinned ? ' is-open' : ''}${dismissed ? ' is-dismissed' : ''}`}
      aria-describedby={tipId}
      onMouseEnter={() => {
        setHover(true)
        setDismissed(false)
      }}
      onMouseLeave={() => {
        setHover(false)
        setDismissed(false)
      }}
      onClick={(e) => {
        onClick?.(e)
        setDismissed(false)
        setPinned((p) => !p)
      }}
    >
      {children}
      <span className="c-tip" role="tooltip" id={tipId}>
        {tip}
      </span>
    </span>
  )
}

/** 規格 §0.1 三層結論標籤：「精確｜指定模型」「近似｜需驗證」「研究假說／延伸」 */
export function ClaimTag({ kind }: { kind: ClaimKind }) {
  return (
    <TipBadge className={`c-claim c-claim-${kind}`} tip={CLAIM_DESCRIPTION[kind]}>
      {CLAIM_LABEL[kind]}
    </TipBadge>
  )
}

/** 模型層級徽章 L0–L6；tooltip 取自規格 §15.1 表格 */
export function ModelLevel({ level, showName = false }: { level: ModelLevelId; showName?: boolean }) {
  const label = showName ? `${level} ${MODEL_LEVEL_INFO[level].model}` : `模型 ${level}`
  return (
    <TipBadge className={`c-level c-level-${level}`} tip={modelLevelText(level)}>
      {label}
    </TipBadge>
  )
}

/** 範例來源標示（預設 illustrative） */
export function SourceTag({ kind = 'illustrative' }: { kind?: SourceKind }) {
  return (
    <TipBadge className={`c-source c-source-${kind}`} tip={SOURCE_DESCRIPTION[kind]}>
      {SOURCE_LABEL[kind]}
    </TipBadge>
  )
}
