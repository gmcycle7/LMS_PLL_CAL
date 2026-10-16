import { createContext, useContext } from 'react'

/**
 * Layout 提供、PageFrame 使用的換頁資訊：
 * - generation：第幾次 pathname 變更（首次載入是 0；hash / search 變更不算）
 * - announce：把一句話寫進 Layout 常駐的 role=status 區，讓螢幕閱讀器播報
 */
export interface NavigationInfo {
  generation: number
  announce: (text: string) => void
}

export const NavigationContext = createContext<NavigationInfo>({ generation: 0, announce: () => {} })

export function useNavigationInfo(): NavigationInfo {
  return useContext(NavigationContext)
}
