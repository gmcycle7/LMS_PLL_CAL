import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { revealFromRoute } from './anchor'

/**
 * 網址帶 ?f=F-05.1（公式）或 ?a=ch14-budget（一般錨點）時，頁面載入後捲到對應的元素——不管這一頁有沒有指著它的連結。
 * FormulaLink／AnchorLink 掛上來時已經會處理「網址指著自己」的情形；這個元件補的是目標沒有被任何連結指到的情況
 * （例如手打的網址）。掛在每個頁面都有的外框（PageFrame）裡即可，同一次導覽只會捲一次（revealFromRoute 會去重）。
 * 公式速查頁（/formulas）自己用 ?f= 當搜尋字串，所以略過。
 */
export function AnchorDeepLink() {
  const { pathname, search } = useLocation()
  useEffect(() => revealFromRoute(`${pathname}${search}`) ?? undefined, [pathname, search])
  return null
}
