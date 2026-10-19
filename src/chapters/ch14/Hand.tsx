import { bindHandCalc } from '@/components'
import { HANDCALCS } from './handcalcs'

/**
 * 「帶入手算」的章內版位（docs/teaching-style.md §7）：依 id 從本章的 HANDCALCS 取題（共用的 ChapterHandCalc；id 打錯會丟錯），
 * 前面放一句邀請讀者「先換成自己的數字、用紙筆算一次」的話（children 可換成和上下文相關的說法）。
 * 題目放在對應推導或 worked example 的正後方；章末「思考題」之前再放綜合題。
 * 頁內跳到某一題用 `@/components` 的 HandLink。
 */
export const Hand = bindHandCalc(HANDCALCS)
