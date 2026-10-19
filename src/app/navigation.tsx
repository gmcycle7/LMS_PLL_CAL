import { createContext, useContext, useEffect } from 'react'
import { PAGES, type PageEntry } from './registry'

/**
 * Layout 提供、PageFrame 使用的換頁資訊：
 * - generation：第幾次 pathname 變更（首次載入是 0；hash / search 變更不算）
 * - announce：把一句話寫進 Layout 常駐的 role=status 區，讓螢幕閱讀器播報
 * - openSearch：開啟全站搜尋面板（404 頁的「搜尋」出路用；與頂列 🔍 鈕、`/` 鍵同一個入口）
 */
export interface NavigationInfo {
  generation: number
  announce: (text: string) => void
  openSearch: () => void
}

export const NavigationContext = createContext<NavigationInfo>({ generation: 0, announce: () => {}, openSearch: () => {} })

export function useNavigationInfo(): NavigationInfo {
  return useContext(NavigationContext)
}

/* ---------- 上一頁／下一頁 ---------- */

/**
 * 「上一頁／下一頁」的順序：
 * - 章節鏈 = 所有不是工具頁的頁面（Dashboard → Part A → B → C → D），照 registry 的順序一路讀下去；
 * - 工具頁（group === 'tools'：Lab、手算練習簿、Gallery …）是一組彼此獨立的參考頁，只在工具頁之間照 registry 的順序前後移動。
 * 兩條鏈**不互相接**：Part D 的最後一頁沒有「下一頁」、第一個工具頁沒有「上一頁」（原本 `Verification → Lab` 的跨組跳轉對讀者沒有意義；
 * 想去工具頁請用側欄或 Dashboard）。
 */
export function pageNeighbours(id: string): { prev?: PageEntry; next?: PageEntry } {
  const me = PAGES.find((p) => p.id === id)
  if (!me) return {}
  const chain = PAGES.filter((p) => (p.group === 'tools') === (me.group === 'tools'))
  const i = chain.findIndex((p) => p.id === id)
  return { prev: i > 0 ? chain[i - 1] : undefined, next: i < chain.length - 1 ? chain[i + 1] : undefined }
}

/* ---------- 瀏覽器分頁標題 ---------- */

export const TITLE_SUFFIX = 'LMS × PLL Calibration Lab'
export const NOT_FOUND_TITLE = '找不到頁面'

/** `<頁面標題> · LMS × PLL Calibration Lab`；頁面標題取自 registry 的 title（Dashboard 用「Dashboard / 學習路線」，避免和後綴重複） */
export function documentTitleFor(entry: PageEntry | undefined): string {
  const name = !entry ? NOT_FOUND_TITLE : entry.id === 'dashboard' ? 'Dashboard / 學習路線' : entry.title
  return `${name} · ${TITLE_SUFFIX}`
}

/**
 * 設定 document.title。要放在 `<PageFrame>` 的**後面**（App.tsx 的路由元素）：
 * 同一個 commit 裡 effect 依樹的順序執行，後面的最後寫入，才不會被 PageFrame 內部的 `${nav} · LMS × PLL Lab` 蓋掉。
 */
export function DocumentTitle({ entry }: { entry?: PageEntry }) {
  const title = documentTitleFor(entry)
  useEffect(() => {
    document.title = title
  }, [title])
  return null
}
