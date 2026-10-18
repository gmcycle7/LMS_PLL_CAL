import { forwardRef } from 'react'
import './search.css'

/** 放大鏡（線條圖示，跟隨文字顏色） */
export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="c-icon"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

/** 這台機器的快捷鍵寫法（Mac 顯示 ⌘K，其他顯示 Ctrl+K） */
export function shortcutLabel(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent ?? '')
  return mac ? '⌘K' : 'Ctrl+K'
}

export interface SearchButtonProps {
  /** 面板是否開著（aria-expanded） */
  open: boolean
  onClick: () => void
}

/**
 * 頂列的搜尋鈕（Layout 使用）。面板本身是延後載入的（loadSearchPalette），這顆按鈕與它的樣式則隨主程式載入。
 * 寬螢幕顯示「搜尋」字樣與 / 的提示；≤900px 只剩圖示（頂列要和 ☰、品牌字、兩個下拉選單一起放進 320px）。
 */
export const SearchButton = forwardRef<HTMLButtonElement, SearchButtonProps>(function SearchButton({ open, onClick }, ref) {
  const label = `搜尋全站（/ 或 ${shortcutLabel()}）`
  return (
    <button
      type="button"
      className="btn btn-icon c-search-btn"
      ref={ref}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts="/ Meta+K Control+K"
    >
      <SearchIcon />
      <span className="c-search-btn-text">搜尋</span>
      <kbd className="c-search-kbd" aria-hidden="true">
        /
      </kbd>
    </button>
  )
})
