import { memo } from 'react'
import { ModelLevel, ParamControl, SelectControl, ToggleControl } from '@/components'
import { LAB_PARAM_LABEL, LAB_RANGES, type LabParams, type StageId } from '@/simulation/models/unifiedLab'
import { md } from './common'
import { PANEL_GROUPS, PARAM_META, unitOf, type ParamMeta } from './paramMeta'

export type GroupId = StageId | 'sim'

/**
 * 分組下方的一句說明（wave 5）：依目前的選項告訴使用者「這個選擇代表什麼」。
 * 只在該分組真的有對應的控制項時顯示；字串內的 `$...$` 是 TeX。
 */
const GROUP_NOTE: Partial<Record<GroupId, (p: LabParams) => string | null>> = {
  dsm: (p) =>
    p.architecture === 'pmux8_gos'
      ? `目前是使用者的架構：8 相 PMUX 在回授路徑、input DTC 只補一個相位步 $\\Delta=T_{\\mathrm{vco}}/8$。DSM 跑在 $(8\\alpha\\bmod 1)$，PMUX 每個週期固定前進 $\\lfloor8\\alpha\\rfloor$ 相；9 個權重（PHOS $w_0\\dots w_7$ + GOS $w_g$）各自一個 GMAC，共模經 $H_{\\mathrm{PD}}(1)=0$ 不可觀測。${p.pmuxOrder === 'random' ? '已知的隨機旋轉讓 one-hot 白化（研究延伸）。' : ''}`
      : null,
  code: (p) =>
    p.regressorSign === 'legacy'
      ? '正負號目前是 legacy（$x=r\\le0$，既有 preset 與 golden vector 的約定）：$w$、$G$、$\\sigma_w$ 與 spec 完全相同，只有畫出來的 $x$、$e_{\\mathrm{DTC}}$ 是鏡像；要看 §2a 的 $x=s/M\\ge0$ 請切到 spec（docs/assumptions.md §4）。'
      : '正負號是 spec（$x=s/M\\ge0$，§2a）：迴路改由 runLabLoop 執行，單一 gain 時用「$a$、$w_0$、$c_3$ 變號的 legacy」runBlockLms 鏡像做逐位元的跨級一致性檢查。',
}

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
        ariaLabel={`${prefix}${label}`}
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
        ariaLabel={`${prefix}${m.label}`}
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
      ariaLabel={`${prefix}${m.label}`}
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
              {(() => {
                const note = GROUP_NOTE[g.id]?.(value)
                return note ? (
                  <p className="small muted lab-group-note" data-group-note={g.id}>
                    {md(note)}
                  </p>
                ) : null
              })()}
            </div>
          </details>
        )
      })}
    </div>
  )
})
