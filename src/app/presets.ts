import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { PresetEntry } from '@/data/types'

const modules = import.meta.glob<PresetEntry>('../data/presets/*.json', { eager: true, import: 'default' })

/** 所有 preset（依 galleryIndex、id 排序）。 */
export const ALL_PRESETS: PresetEntry[] = Object.values(modules).sort(
  (a, b) => (a.galleryIndex ?? 99) - (b.galleryIndex ?? 99) || a.id.localeCompare(b.id),
)

export function presetById(id: string): PresetEntry | undefined {
  return ALL_PRESETS.find((p) => p.id === id)
}

export function presetsForExperiment(experiment: string): PresetEntry[] {
  return ALL_PRESETS.filter((p) => p.experiment === experiment)
}

/** 產生載入某 preset 的連結（HashRouter 路徑 + ?preset=id）。 */
export function presetHref(p: PresetEntry): string {
  return `${p.page}?preset=${encodeURIComponent(p.id)}`
}

/**
 * 實驗元件用：若網址帶 `?preset=<id>` 且該 preset 屬於此實驗，回傳其參數，否則 undefined。
 * 典型用法：`const preset = useUrlPreset('lms-playground'); useEffect(() => { if (preset) apply(preset.params) }, [preset])`
 */
export function useUrlPreset(experiment: string): PresetEntry | undefined {
  const [params] = useSearchParams()
  const id = params.get('preset')
  return useMemo(() => {
    if (!id) return undefined
    const p = presetById(id)
    return p && p.experiment === experiment ? p : undefined
  }, [id, experiment])
}
