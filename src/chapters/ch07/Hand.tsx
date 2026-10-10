import type { ReactNode } from 'react'
import { HandCalc } from '@/components'
import { HANDCALCS } from './handcalcs'

/**
 * 顯示本章的一題「帶入手算」（依 id 從 handcalcs.ts 的 HANDCALCS 取出），前面附一句邀請：
 * 先把數字換成自己的、用紙筆和計算機算一次，再展開步驟對答案（docs/teaching-style.md §7）。
 */
export function Hand({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`Ch07 找不到手算題 ${id}（請檢查 handcalcs.ts）`)
  return (
    <div className="ch07-hand">
      <p className="ch07-hand-invite">
        <strong>換你算：</strong>
        {children ?? '把下面的數字換成你自己的，先用紙筆和計算機算一次，再展開步驟對答案。'}
      </p>
      <HandCalc def={def} />
    </div>
  )
}
