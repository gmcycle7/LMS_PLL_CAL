import { useSettings, type LearningMode } from '@/app/settings'

interface OptionalSettings {
  mode: LearningMode
  resolvedTheme: 'light' | 'dark'
}

/**
 * 與 useSettings() 相同，但在 <SettingsProvider> 之外（例如單元測試、獨立預覽）不會丟錯，
 * 而是回傳 null，讓元件以預設值運作。
 * useSettings 內部只呼叫一次 useContext，因此 hook 呼叫順序不受 try/catch 影響。
 */
export function useOptionalSettings(): OptionalSettings | null {
  try {
    return useSettings()
  } catch {
    return null
  }
}
