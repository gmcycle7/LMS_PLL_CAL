import { HAND_CALC_HOWTO_TAIL, bindHandCalc } from '@/components'
import { HANDCALCS } from './handcalcs'

/**
 * 依 id 顯示本章的一題「帶入手算」（docs/teaching-style.md §7），前面加一句邀請讀者先自己算的引言。
 * children 可以補一句「這一題對應上面哪個推導、可以試哪些數字」；後面固定接一句怎麼用。
 */
export const Hand = bindHandCalc(HANDCALCS, { tail: HAND_CALC_HOWTO_TAIL })
