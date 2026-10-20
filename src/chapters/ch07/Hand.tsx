import { bindHandCalc } from '@/components'
import { HANDCALCS } from './handcalcs'

/**
 * 顯示本章的一題「帶入手算」（依 id 從 handcalcs.ts 的 HANDCALCS 取出），前面附一句邀請：
 * 先把數字換成自己的、用紙筆和計算機算一次，再展開步驟對答案（docs/teaching-style.md §7）。
 */
export const Hand = bindHandCalc(HANDCALCS)
