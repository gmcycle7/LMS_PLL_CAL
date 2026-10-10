import type { ReactNode } from 'react'
import { mathText } from '@/components'

/** 「單位與時間索引」段落的一個子題（id 對應 searchIndex.ts 的 UNIT_TOPICS；搜尋時只顯示符合的子題） */
export function Topic({ id, no, title, children }: { id: string; no: string; title: string; children: ReactNode }) {
  return (
    <section className="fr-topic" id={`fr-unit-${id}`} data-topic={id}>
      <h3 className="fr-topic-title">
        <span className="fr-topic-no">{no}</span> {mathText(title)}
      </h3>
      {children}
    </section>
  )
}
