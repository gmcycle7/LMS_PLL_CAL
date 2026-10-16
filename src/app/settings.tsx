import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** 三種學習模式共用同一計算核心，只改變呈現細節（規格 §18.2）。 */
export type LearningMode = 'beginner' | 'engineer' | 'research'
export type ThemeChoice = 'light' | 'dark' | 'system'

export const MODES: readonly LearningMode[] = ['beginner', 'engineer', 'research'] as const

export const MODE_LABEL: Record<LearningMode, string> = {
  beginner: 'Beginner 入門',
  engineer: 'Engineer 工程',
  research: 'Research 研究',
}

/** 窄螢幕（≤480px）頂列下拉選單用的短標籤，避免被截成「Engineer …」 */
export const MODE_SHORT: Record<LearningMode, string> = {
  beginner: 'Beginner',
  engineer: 'Engineer',
  research: 'Research',
}

/** 章節頁頂端的一行提示（PageFrame 顯示） */
export const MODE_HINT: Record<LearningMode, string> = {
  beginner: '目前是 Beginner 模式：推導與程式碼預設收合，右上角可切換。',
  engineer: '目前是 Engineer 模式：顯示假設、單位與硬體對應等工程細節，推導可一鍵展開，右上角可切換。',
  research: '目前是 Research 模式：推導預設展開，額外顯示嚴格條件、反例與 Monte Carlo 細節，右上角可切換。',
}

/** 第一次造訪（localStorage 還沒有 lmspll.mode）時的預設模式：只有微積分基礎的讀者先看 Beginner 版 */
export const DEFAULT_MODE: LearningMode = 'beginner'

export const MODE_STORAGE_KEY = 'lmspll.mode'
export const THEME_STORAGE_KEY = 'lmspll.theme'

const MODE_RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

interface Settings {
  mode: LearningMode
  setMode: (m: LearningMode) => void
  /** localStorage 已有合法的 lmspll.mode（讀者選過，或這次工作階段剛選）；false 時 PageFrame 顯示一次性的模式選擇器 */
  modeChosen: boolean
  theme: ThemeChoice
  setTheme: (t: ThemeChoice) => void
  /** 目前實際套用的主題（system 解析後） */
  resolvedTheme: 'light' | 'dark'
  /** 目前模式是否至少為 min */
  atLeast: (min: LearningMode) => boolean
}

const SettingsContext = createContext<Settings | null>(null)

/** 讀 localStorage；沒有或不合法時回傳 null */
function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — setting simply does not persist */
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [stored] = useState(() => ({
    mode: readStored(MODE_STORAGE_KEY, MODES),
    theme: readStored(THEME_STORAGE_KEY, ['light', 'dark', 'system'] as const),
  }))
  const [mode, setModeState] = useState<LearningMode>(stored.mode ?? DEFAULT_MODE)
  const [modeChosen, setModeChosen] = useState(stored.mode !== null)
  const [theme, setThemeState] = useState<ThemeChoice>(stored.theme ?? 'system')
  const [sysDark, setSysDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => setSysDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme

  // index.html 的 inline script 已在第一次繪製前設好 data-theme；這裡是之後切換主題時的唯一真相來源
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  const setMode = useCallback((m: LearningMode) => {
    setModeState(m)
    setModeChosen(true)
    writeStored(MODE_STORAGE_KEY, m)
  }, [])
  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t)
    writeStored(THEME_STORAGE_KEY, t)
  }, [])
  const atLeast = useCallback((min: LearningMode) => MODE_RANK[mode] >= MODE_RANK[min], [mode])

  const value = useMemo(
    () => ({ mode, setMode, modeChosen, theme, setTheme, resolvedTheme, atLeast }),
    [mode, setMode, modeChosen, theme, setTheme, resolvedTheme, atLeast],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): Settings {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}

/** 只在模式 >= min 時顯示內容（例如 Research 才顯示的推導細節）。 */
export function ModeGate({ min, children }: { min: LearningMode; children: ReactNode }) {
  const { atLeast } = useSettings()
  return atLeast(min) ? <>{children}</> : null
}
