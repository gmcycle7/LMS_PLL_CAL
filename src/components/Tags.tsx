import { useEffect, useId, useState, type HTMLAttributes, type ReactNode } from 'react'
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
 * 帶 tooltip 的小徽章。tooltip 用 CSS（:hover / :focus-within）顯示；同時以 aria-describedby 提供給螢幕閱讀器。
 * 徽章本身沒有動作，所以不進 Tab 順序（tabIndex=-1）：一章有幾十個內容相同的徽章，鍵盤使用者不必逐一停靠；
 * 點一下（滑鼠或觸控）仍會取得焦點而顯示 tooltip。按 Esc 可關閉 tooltip（WCAG 1.4.13）：
 * 聚焦時直接失焦，滑鼠停留時監聽 document 的 keydown；滑鼠移開後重設。
 */
export function TipBadge({ className, children, tip, ...rest }: TipBadgeProps) {
  const tipId = useId()
  const [hover, setHover] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!hover) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDismissed(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hover])

  return (
    <span
      {...rest}
      className={`c-badge c-has-tip ${className}${dismissed ? ' is-dismissed' : ''}`}
      tabIndex={-1}
      aria-describedby={tipId}
      onMouseEnter={() => {
        setHover(true)
        setDismissed(false)
      }}
      onMouseLeave={() => {
        setHover(false)
        setDismissed(false)
      }}
      onBlur={() => setDismissed(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDismissed(true)
          e.currentTarget.blur()
        }
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
