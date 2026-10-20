import type { ReactNode } from 'react'
import { scrollToElement } from '../links/anchor'

/**
 * 頁內跳轉（捲到本頁的某個元素）。
 *
 * HashRouter 下 `href="#id"` 會被當成路由（整頁換成「找不到此頁面」），所以頁內跳轉一律是「按鈕＋共用的 scrollToElement」：
 * 它會先展開目標的所有祖先 <details>（Beginner 模式的推導框、Ch04 的 Part 2 都預設收合），再捲動（扣掉 topbar）、聚焦並短暫標示。
 * 各章原本各有一份（scrollToId 用 scrollIntoView，沒有展開祖先、沒有聚焦；JumpTo／jumpTo 的行為又各不相同）。
 */
export function jumpToId(id: string): boolean {
  if (typeof document === 'undefined') return false
  const el = document.getElementById(id)
  if (!el) return false
  scrollToElement(el)
  return true
}

export interface JumpToProps {
  /** 目標元素的 id（本頁內） */
  target: string
  children: ReactNode
  /** 額外的 class（預設 `c-jump`：外觀同連結） */
  className?: string
  /** 捲動之前先做的事（例如先收起某個面板） */
  onJump?: () => void
}

/** 長得像連結的頁內跳轉按鈕（章首目錄、「本章符號表在最後」、「回到章首」）。 */
export function JumpTo({ target, children, className, onJump }: JumpToProps) {
  return (
    <button
      type="button"
      className={className ? `c-jump ${className}` : 'c-jump'}
      data-jump={target}
      onClick={() => {
        onJump?.()
        jumpToId(target)
      }}
    >
      {children}
    </button>
  )
}
