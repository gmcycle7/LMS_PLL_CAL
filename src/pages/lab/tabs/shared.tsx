import { useCallback, useMemo } from 'react'
import { useThemeTokens, type ExperimentPreset } from '@/components'
import { presetsForExperiment } from '@/app/presets'
import { md, texifyShared } from '../common'
import { useLab } from '../store'
import type { Palette } from './plots'

/** Plotly 用的顏色（Plotly 讀不到 CSS 變數） */
export function usePalette(): Palette {
  const t = useThemeTokens()
  return useMemo(() => ({ series: t.series, muted: t.textMuted, danger: t.danger }), [t])
}

/** ExperimentShell 的 preset 下拉選單：列出屬於此實驗的 lab-*.json，載入時連同 preset id 一起套用。 */
export function useShellPresets(experiment: string): { presets: ExperimentPreset[]; onLoadPreset: (p: ExperimentPreset) => void } {
  const { applyPreset } = useLab()
  const list = useMemo(() => presetsForExperiment(experiment), [experiment])
  const presets = useMemo<ExperimentPreset[]>(() => list.map((p) => ({ name: p.title, params: p.params, description: p.description })), [list])
  const onLoadPreset = useCallback(
    (p: ExperimentPreset) => {
      const hit = list.find((x) => x.title === p.name)
      applyPreset(experiment, p.params, hit?.id)
    },
    [applyPreset, experiment, list],
  )
  return { presets, onLoadPreset }
}

/** preset 載入後的提示：這個 preset 預期看到什麼（文字來自 preset JSON，並由 presets.test.ts 以模型重算核對）。 */
export function PresetNote({ experiment }: { experiment: string }) {
  const { presetId, presetIssues } = useLab()
  const hit = useMemo(() => presetsForExperiment(experiment).find((p) => p.id === presetId), [experiment, presetId])
  if (!hit && presetIssues.length === 0) return null
  return (
    <div className="lab-preset-note">
      {hit && (
        <p className="small">
          <strong>已載入 preset：{md(hit.title)}</strong>
          <br />
          {md(hit.description)}
          <br />
          <span className="muted">預期：</span>
          {md(hit.expected)}
        </p>
      )}
      {presetIssues.length > 0 && (
        <p className="small lab-preset-issues" role="status">
          preset 有 {presetIssues.length} 個欄位未套用：{presetIssues.join('；')}
        </p>
      )}
    </div>
  )
}

/** 警告字串：共用模型的 Unicode 片段轉成 TeX（顯示時才轉；匯出仍是原字串加 `$`）。 */
export const tw = (s: string): string => texifyShared(s)
