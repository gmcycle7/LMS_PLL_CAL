import { useId, type ReactNode } from 'react'
import { mathText } from './Tex'

export type CalloutKind = 'info' | 'warn' | 'danger' | 'ok'

const DEFAULT_TITLE: Record<CalloutKind, string> = {
  info: '提示',
  warn: '注意',
  danger: '警告',
  ok: '通過',
}

export interface CalloutProps {
  kind?: CalloutKind
  /** 標題；傳 null 可隱藏預設標題 */
  title?: ReactNode | null
  children?: ReactNode
  className?: string
}

/** 提示框：info / warn / danger / ok（沿用 global.css 的 .callout 樣式） */
export function Callout({ kind = 'info', title, children, className }: CalloutProps) {
  const heading = title === null ? null : (title ?? DEFAULT_TITLE[kind])
  const titleId = useId()
  return (
    <div
      className={`callout${kind === 'info' ? '' : ` callout-${kind}`} c-callout${className ? ` ${className}` : ''}`}
      role={kind === 'danger' ? 'alert' : 'note'}
      // 有標題時以標題命名（螢幕閱讀器念「注意，註記」而不是一段無名的文字）；title={null} 時不給名稱
      aria-labelledby={heading !== null ? titleId : undefined}
    >
      {heading !== null && (
        <div className="c-callout-title" id={titleId}>
          {mathText(heading)}
        </div>
      )}
      {children}
    </div>
  )
}
