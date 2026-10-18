/**
 * 全站搜尋（命令面板）。Layout 放 <SearchButton>，面板以 lazy(loadSearchPalette) 延後載入：
 * 面板的程式碼與索引（./buildIndex.ts：公式登錄、presets、勘誤、術語、手算題）都在第一次開啟時才載入。
 * 這個檔案刻意不 re-export SearchPalette（那會讓它跟著共用元件的 barrel 一起載入）。
 */
export { SearchButton, SearchIcon, shortcutLabel, type SearchButtonProps } from './SearchButton'
export {
  search,
  scoreEntry,
  collectPageSections,
  headingText,
  makeEntry,
  pageOfPath,
  KIND_LABEL,
  KIND_ORDER,
  PER_GROUP,
  type SearchEntry,
  type SearchGroup,
  type SearchKind,
} from './searchCore'
export type { SearchPaletteProps, IndexLoader } from './SearchPalette'

/** 給 React.lazy 用：第一次開面板才載入面板與索引 */
export const loadSearchPalette = () => import('./SearchPalette').then((m) => ({ default: m.SearchPalette }))
