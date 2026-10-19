import type { ReactNode } from 'react'
import { HandCalc } from '@/components'
import { HANDCALCS } from './handcalcs'

/** 依 id 顯示本章的一題「帶入手算」（docs/teaching-style.md §7），前面加一句邀請讀者先自己算的引言。 */
export function Hand({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`Ch11b 找不到手算題 ${id}`)
  return (
    <div className="ch11b-hand">
      <p className="ch11b-hand-lead">
        <strong>換你算：</strong>
        {children} 把數字換成你自己的，下面會一步一步把它們代進公式；想先用紙筆（或一般的工程計算機）算，就切到「自己算算看」，算完再對答案；按「換一題」可以隨機出數字。
      </p>
      <HandCalc def={def} />
    </div>
  )
}
