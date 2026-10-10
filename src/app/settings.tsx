import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** 三種學習模式共用同一計算核心，只改變呈現細節（規格 §18.2）。 */
export type LearningMode = 'beginner' | 'engineer' | 'research'
export type ThemeChoice = 'light' | 'dark' | 'system'

export const MODE_LABEL: Record<LearningMode, string> = {
  beginner: 'Beginner 入門',
  engineer: 'Engineer 工程',
  research: 'Research 研究',
}

const MODE_RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

interface Settings {
  mode: LearningMode
  setMode: (m: LearningMode) => void
  theme: ThemeChoice
  setTheme: (t: ThemeChoice) => void
  /** 目前實際套用的主題（system 解析後） */
  resolvedTheme: 'light' | 'dark'
  /** 目前模式是否至少為 min */
  atLeast: (min: LearningMode) => boolean
}

const SettingsContext = createContext<Settings | null>(null)

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
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
  const [mode, setModeState] = useState<LearningMode>(() =>
    readStored('lmspll.mode', ['beginner', 'engineer', 'research'] as const, 'engineer'),
  )
  const [theme, setThemeState] = useState<ThemeChoice>(() =>
    readStored('lmspll.theme', ['light', 'dark', 'system'] as const, 'system'),
  )
  const [sysDark, setSysDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => setSysDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  const setMode = useCallback((m: LearningMode) => {
    setModeState(m)
    writeStored('lmspll.mode', m)
  }, [])
  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t)
    writeStored('lmspll.theme', t)
  }, [])
  const atLeast = useCallback((min: LearningMode) => MODE_RANK[mode] >= MODE_RANK[min], [mode])

  const value = useMemo(
    () => ({ mode, setMode, theme, setTheme, resolvedTheme, atLeast }),
    [mode, setMode, theme, setTheme, resolvedTheme, atLeast],
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
