import { memo } from 'react'
import { ModelLevel, ParamControl, SelectControl, ToggleControl } from '@/components'
import { LAB_PARAM_LABEL, LAB_RANGES, type LabParams, type StageId } from '@/simulation/models/unifiedLab'
import { md, plain } from './common'
import { PANEL_GROUPS, PARAM_META, unitOf, type ParamMeta } from './paramMeta'

export type GroupId = StageId | 'sim'

export interface ParamPanelProps {
  value: LabParams
  onChange: (patch: Partial<LabParams>) => void
  /** 預設展開的分組（其餘收合；使用者可自行展開） */
  open?: GroupId[]
  /** 不顯示的欄位（例如 FCW sweep 分頁的 frac 由 sweep 決定） */
  hide?: (keyof LabParams)[]
  /** 每個分組標題後面加的小註（例如「此分頁不使用」） */
  disabled?: boolean
  /** aria 用的前綴，避免同頁多個面板的控制項同名 */
  idPrefix?: string
}

function Control({ m, value, onChange, disabled, prefix }: { m: ParamMeta; value: LabParams; onChange: (patch: Partial<LabParams>) => void; disabled: boolean; prefix: string }) {
  if (m.kind === 'num') {
    const r = LAB_RANGES[m.key]
    const integer = 'integer' in r && r.integer
    const label = LAB_PARAM_LABEL[m.key]
    return (
      <ParamControl
        label={md(label)}
        ariaLabel={`${prefix}${plain(label)}`}
        value={value[m.key]}
        onChange={(v) => onChange({ [m.key]: v } as Partial<LabParams>)}
        min={r.min}
        max={r.max}
        step={m.step ?? (integer ? 1 : undefined)}
        unit={unitOf(m.key)}
        log={m.log && r.min > 0}
        hint={m.hint ? md(m.hint) : undefined}
        reg={m.reg}
        digits={m.digits ?? 6}
        integer={integer}
        clampOnBlur={integer}
        disabled={disabled}
      />
    )
  }
  if (m.kind === 'enum') {
    return (
      <SelectControl<string>
        label={md(m.label)}
        ariaLabel={`${prefix}${plain(m.label)}`}
        value={value[m.key]}
        onChange={(v) => onChange({ [m.key]: v } as Partial<LabParams>)}
        options={m.options}
        hint={m.hint ? md(m.hint) : undefined}
        reg={m.reg}
        disabled={disabled}
      />
    )
  }
  return (
    <ToggleControl
      label={md(m.label)}
      ariaLabel={`${prefix}${plain(m.label)}`}
      value={value[m.key]}
      onChange={(v) => onChange({ [m.key]: v } as Partial<LabParams>)}
      hint={m.hint ? md(m.hint) : undefined}
      reg={m.reg}
      disabled={disabled}
    />
  )
}

/**
 * 整條 pipeline 的參數面板：依訊號流向分成九組（每組標示模型層級），
 * 每個數值控制項都有滑桿 + 精確數字輸入、單位、合法範圍，以及對應的 hardware register / behavioral parameter。
 * 只顯示在目前設定下有意義的欄位（例如 ζ 只在 Type-II 出現）。
 */
export const ParamPanel = memo(function ParamPanel({ value, onChange, open = ['dsm', 'gmac', 'update'], hide = [], disabled = false, idPrefix = '' }: ParamPanelProps) {
  return (
    <div className="lab-panel">
      {PANEL_GROUPS.map((g) => {
        const items = PARAM_META.filter((m) => m.stage === g.id && !hide.includes(m.key) && (!m.when || m.when(value)))
        if (items.length === 0) return null
        return (
          <details key={g.id} className="lab-group" open={open.includes(g.id)} data-group={g.id}>
            <summary>
              <span className="lab-group-title">{g.title}</span>
              {g.level && <ModelLevel level={g.level} />}
            </summary>
            <div className="lab-group-body">
              {items.map((m) => (
                <Control key={m.key} m={m} value={value} onChange={onChange} disabled={disabled} prefix={idPrefix} />
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
})
