/**
 * Beginner 模式的收合卡片：哪些元素 id 收在哪一張卡片裡。
 * Hero 的膠囊／目錄、系統地圖的按鈕、條件卡片的「載入反例」、網址的 ?a=／?f= 深連結都可能指到收合的內容；
 * 目標在收合的卡片裡時，index.tsx 要先展開那一張（內容展開才渲染）、等內容出現再捲過去。
 */

/**
 * 「六條件一分鐘體檢」卡片（ThesisFold）裡的元素 id：三個段落與它們的標題、六張條件卡片、四段推導的公式 F-DB.n 與帶入手算 HC-DB.1–5
 * （HC-DB.6 在「本頁必記」的卡片）、體檢實驗本身（exp-dashboard-thesis-check）與 Monte Carlo 交叉比對。
 * index.research.test.tsx 檢查這條規則恰好涵蓋卡片裡的 id。
 */
export const FOLD_IDS = /^(dash-thesis|dash-spine|dash-check|dash-cond-|dash-mc|formula-F-DB\.|handcalc-HC-DB\.[1-5]$|exp-dashboard-thesis-check)/

/** 「綜合手算」卡片（本頁必記那一段的三張卡片之一）裡的 id：只有綜合題 HC-DB.6 */
export const HANDCALC_FOLD_IDS = /^handcalc-HC-DB\.6$/

/** 頁末的符號表卡片：「本頁符號表在最後 ↓」與網址的 ?a=symbols 都要把它展開 */
export const SYMBOLS_FOLD_IDS = /^symbols$/

export type FoldKey = 'thesis' | 'handcalc' | 'symbols'

/** 這個 id 收在哪一張卡片裡（不在任何卡片裡就是 null） */
export function foldKeyOf(id: string): FoldKey | null {
  if (FOLD_IDS.test(id)) return 'thesis'
  if (HANDCALC_FOLD_IDS.test(id)) return 'handcalc'
  if (SYMBOLS_FOLD_IDS.test(id)) return 'symbols'
  return null
}
