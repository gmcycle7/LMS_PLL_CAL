import type { ReactNode } from 'react'
import { IconAlert, IconBulb, IconDiagram, IconPencil, IconSigma, IconSliders } from './icons'
import { mathText } from './Tex'

/** 規格 §18.4：每章「直覺 → 圖 → 公式 → 範例 → 探索 → 注意假設」 */
export type SectionKind = 'intuition' | 'diagram' | 'formula' | 'example' | 'explore' | 'assumptions'

export const SECTION_LABEL: Record<SectionKind, string> = {
  intuition: '直覺',
  diagram: '圖',
  formula: '公式',
  example: '範例',
  explore: '探索',
  assumptions: '注意假設',
}

const SECTION_ICON: Record<SectionKind, (p: { size?: number }) => ReactNode> = {
  intuition: IconBulb,
  diagram: IconDiagram,
  formula: IconSigma,
  example: IconPencil,
  explore: IconSliders,
  assumptions: IconAlert,
}

export interface SectionProps {
  kind: SectionKind
  title?: ReactNode
  /** 標題層級（預設 h3） */
  level?: 2 | 3 | 4
  /** 錨點 id */
  id?: string
  children?: ReactNode
  className?: string
}

/** 章節段落：左側色條 + 小圖示 + 段落類型標籤 */
export function Section({ kind, title, level = 3, id, children, className }: SectionProps) {
  const Icon = SECTION_ICON[kind]
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <section className={`c-section c-section-${kind}${className ? ` ${className}` : ''}`} id={id} data-kind={kind}>
      <div className="c-section-kicker">
        <Icon size={14} />
        <span>{SECTION_LABEL[kind]}</span>
      </div>
      {title && <Heading className="c-section-title">{mathText(title)}</Heading>}
      <div className="c-section-body">{children}</div>
    </section>
  )
}
