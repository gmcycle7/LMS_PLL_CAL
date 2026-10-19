import { Children, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { CLAIM_DESCRIPTION, CLAIM_LABEL, MODEL_LEVEL_INFO, SOURCE_DESCRIPTION, SOURCE_LABEL, modelLevelText } from './labels'
import type { ClaimKind, ModelLevelId, SourceKind } from './types'

/**
 * 徽章的語意 variant（components.css「Badge」一節；docs/dev-conventions.md §2.1）。一種顏色只代表一件事：
 *   exact／approx／research  結論強度：綠實心／琥珀實心／紫實心
 *   level                    模型層級：藍描邊
 *   verified／partial／fail／pending  T-id 測試狀態：青綠帶 ✓／琥珀描邊／紅／灰虛線
 *   erratum                  勘誤：琥珀描邊（不是實心）
 *   source                   來源：灰描邊（illustrative 再加 is-dashed）
 *   ok／mismatch／na／not-implemented  交叉比對與判決：綠／紅／灰／琥珀虛線
 *   neutral                  沒有語意的灰色（計數、ID）
 */
export type BadgeVariant =
  | 'exact'
  | 'approx'
  | 'research'
  | 'level'
  | 'verified'
  | 'partial'
  | 'fail'
  | 'pending'
  | 'erratum'
  | 'source'
  | 'ok'
  | 'mismatch'
  | 'na'
  | 'not-implemented'
  | 'neutral'

export const BADGE_VARIANTS: readonly BadgeVariant[] = [
  'exact',
  'approx',
  'research',
  'level',
  'verified',
  'partial',
  'fail',
  'pending',
  'erratum',
  'source',
  'ok',
  'mismatch',
  'na',
  'not-implemented',
  'neutral',
]

/** `c-badge c-badge--<variant> [extra]`；neutral 只有基底 */
export function badgeClass(variant: BadgeVariant = 'neutral', extra?: string): string {
  return `c-badge${variant === 'neutral' ? '' : ` c-badge--${variant}`}${extra ? ` ${extra}` : ''}`
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  children: ReactNode
}

/**
 * 靜態徽章（沒有 tooltip）：所有 pill／tag／chip 的基底。只是標示、沒有動作，所以不可聚焦（沒有 tabIndex）。
 * 要帶 tooltip 用 TipBadge；要在一行放很多個用 BadgeRow（≥ 4 個會摺疊）。
 */
export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={badgeClass(variant, className)}>
      {children}
    </span>
  )
}

export interface TipBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** 語意 variant（顏色）；沒給就是 neutral 灰 */
  variant?: BadgeVariant
  /** 額外的 hook 類別（例如 c-claim c-claim-exact；只給測試與資料用，沒有樣式） */
  className?: string
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
export function TipBadge({ variant, className, children, tip, onClick, ...rest }: TipBadgeProps) {
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
      className={`${badgeClass(variant, className)} c-has-tip${pinned ? ' is-open' : ''}${dismissed ? ' is-dismissed' : ''}`}
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

/** 規格 §0.1 三層結論標籤：「精確｜指定模型」「近似｜需驗證」「研究假說／延伸」（variant 同名：綠／琥珀／紫實心） */
export function ClaimTag({ kind }: { kind: ClaimKind }) {
  return (
    <TipBadge variant={kind} className={`c-claim c-claim-${kind}`} tip={CLAIM_DESCRIPTION[kind]}>
      {CLAIM_LABEL[kind]}
    </TipBadge>
  )
}

/** 模型層級徽章 L0–L6（藍描邊；層級寫在字上）；tooltip 取自規格 §15.1 表格 */
export function ModelLevel({ level, showName = false }: { level: ModelLevelId; showName?: boolean }) {
  const label = showName ? `${level} ${MODEL_LEVEL_INFO[level].model}` : `模型 ${level}`
  return (
    <TipBadge variant="level" className={`c-level c-level-${level}`} tip={modelLevelText(level)}>
      {label}
    </TipBadge>
  )
}

/** 範例來源標示（預設 illustrative）：灰描邊；illustrative 用虛線，提醒「不是數據」 */
export function SourceTag({ kind = 'illustrative' }: { kind?: SourceKind }) {
  return (
    <TipBadge variant="source" className={`c-source c-source-${kind}${kind === 'illustrative' ? ' is-dashed' : ''}`} tip={SOURCE_DESCRIPTION[kind]}>
      {SOURCE_LABEL[kind]}
    </TipBadge>
  )
}

export interface BadgeRowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** 子項目數 ≥ fold 時摺疊（預設 4） */
  fold?: number
  /** 摺疊時顯示前幾個（預設 3） */
  show?: number
  /** 群組名稱（aria-label；純文字） */
  label?: string
}

/**
 * 一行徽章。同一行連續 ≥ `fold`（預設 4）個時只顯示前 `show`（預設 3）個加一顆「+N」按鈕，點開展開、再點收起。
 * 摺疊起來的項目不在 DOM 裡（不是 display:none），所以頁面上數得到的徽章就是看得到的徽章；
 * 「+N」是真正的 <button>（鍵盤可操作、aria-expanded），外觀借用徽章的尺寸（.c-badge-more）。
 * 外層 class 沿用 .c-tag-row（flex-wrap），既有的版面規則不變。
 */
export function BadgeRow({ children, fold = 4, show = 3, label, className, ...rest }: BadgeRowProps) {
  const [open, setOpen] = useState(false)
  const items = Children.toArray(children)
  const foldable = items.length >= fold && show < items.length
  const folded = foldable && !open
  const hidden = items.length - show
  return (
    <div
      {...rest}
      className={`c-tag-row c-badge-row${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
      data-folded={foldable ? String(folded) : undefined}
    >
      {folded ? items.slice(0, show) : items}
      {foldable && (
        <button
          type="button"
          className="c-badge c-badge-more"
          aria-expanded={!folded}
          aria-label={folded ? `再顯示 ${hidden} 個標籤` : '收起標籤'}
          onClick={() => setOpen((o) => !o)}
        >
          {folded ? `+${hidden}` : '收起'}
        </button>
      )}
    </div>
  )
}
