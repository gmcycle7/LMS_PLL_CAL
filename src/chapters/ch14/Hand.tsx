import type { ReactNode } from 'react'
import { HandCalc } from '@/components'
import { HANDCALCS } from './handcalcs'

/** 捲到某一題（HashRouter 下不能用純 #anchor 連結，否則會改到路由）。 */
export function HandLink({ id }: { id: string }) {
  return (
    <a
      href={`#handcalc-${id}`}
      onClick={(e) => {
        e.preventDefault()
        document.getElementById(`handcalc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}
    >
      {id}
    </a>
  )
}

/**
 * 「帶入手算」的章內版位（docs/teaching-style.md §7）：依 id 從本章的 HANDCALCS 取題，
 * 前面放一句邀請讀者「先換成自己的數字、用紙筆算一次」的話（children 可換成和上下文相關的說法）。
 * 題目放在對應推導或 worked example 的正後方；章末「思考題」之前再放綜合題。
 */
export function Hand({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) return null
  return (
    <div className="ch14-handcalc">
      <p className="ch14-handcalc-invite">
        <strong>換你算。</strong>
        {children ?? '把下面的數字換成你自己的設計值，先用紙筆和計算機算一次，再和網站逐步對答案。'}
      </p>
      <HandCalc def={def} />
    </div>
  )
}
