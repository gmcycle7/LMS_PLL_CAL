import { useMemo, useSyncExternalStore } from 'react'

/**
 * 讀取 global.css 的設計 token（CSS variables）。
 *
 * 為什麼不直接用 useSettings().resolvedTheme？
 * SettingsProvider 在 parent 的 useEffect 才把 `data-theme` 寫到 <html>，
 * 而 child 的 effect 會先執行；若在 child effect 中讀 CSS 變數會拿到「舊主題」的顏色。
 * 這裡改為觀察 <html data-theme> 屬性本身（MutationObserver），保證讀到的是已套用的主題。
 */

export type DocumentTheme = 'light' | 'dark'

function getDocumentTheme(): DocumentTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

function subscribeDocumentTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

/** 目前 <html> 上實際套用的主題 */
export function useDocumentTheme(): DocumentTheme {
  return useSyncExternalStore(subscribeDocumentTheme, getDocumentTheme, () => 'light')
}

/** 讀取單一 CSS 變數（例如 cssVar('--series-1')）；讀不到時回傳 fallback */
export function cssVar(name: string, fallback = ''): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export interface ThemeTokens {
  theme: DocumentTheme
  text: string
  textMuted: string
  textFaint: string
  border: string
  borderStrong: string
  surface: string
  surface2: string
  accent: string
  danger: string
  fontSans: string
  fontMono: string
  /** --series-1..6，給 Plotly colorway 或手動指定 trace 顏色 */
  series: string[]
}

/**
 * 讀取目前主題的 token。Fallback 只在 CSS 尚未載入（例如 jsdom 測試）時使用，
 * 值與 global.css 淺色主題相同。
 */
export function readThemeTokens(theme: DocumentTheme = getDocumentTheme()): ThemeTokens {
  return {
    theme,
    text: cssVar('--text', '#1b2430'),
    textMuted: cssVar('--text-muted', '#5b6676'),
    textFaint: cssVar('--text-faint', '#8a94a3'),
    border: cssVar('--border', '#d9dee6'),
    borderStrong: cssVar('--border-strong', '#b9c1cd'),
    surface: cssVar('--surface', '#ffffff'),
    surface2: cssVar('--surface-2', '#f0f2f5'),
    accent: cssVar('--accent', '#1f5fa8'),
    danger: cssVar('--danger', '#b42318'),
    fontSans: cssVar('--font-sans', 'sans-serif'),
    fontMono: cssVar('--font-mono', 'monospace'),
    series: [
      cssVar('--series-1', '#1f5fa8'),
      cssVar('--series-2', '#d1495b'),
      cssVar('--series-3', '#2a9d6f'),
      cssVar('--series-4', '#e09f3e'),
      cssVar('--series-5', '#7b4fb8'),
      cssVar('--series-6', '#3d8fa8'),
    ],
  }
}

/** 主題 token，主題切換時自動更新（可用於手動指定 Plotly trace 顏色） */
export function useThemeTokens(): ThemeTokens {
  const theme = useDocumentTheme()
  return useMemo(() => readThemeTokens(theme), [theme])
}
