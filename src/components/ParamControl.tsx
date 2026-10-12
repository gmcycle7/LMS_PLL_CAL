import { useId, useState, type ChangeEvent, type ReactNode } from 'react'
import { fmtNum } from './format'
import { mathText, stripMathDelimiters } from './Tex'
import {
  checkValue,
  clampValue,
  formatInput,
  fromLogPosition,
  niceStep,
  parseNumberInput,
  toLogPosition,
} from './paramMath'

export interface ParamControlProps {
  /** 顯示名稱（可含 <Tex>）；非字串時請另給 ariaLabel */
  label: ReactNode
  ariaLabel?: string
  value: number
  onChange: (v: number) => void
  /** 合法範圍（含端點） */
  min: number
  max: number
  /** 滑桿步長；未指定時取 (max−min)/500 的 1/2/5×10^k；log 模式下不使用 */
  step?: number
  unit?: string
  /** log10 刻度滑桿（需 min > 0） */
  log?: boolean
  /** 補充說明 */
  hint?: ReactNode
  /**
   * 對應 Hardware Reg 或 Behavioral Parameter，例如 'REG_GMAC_N[15:0]'。
   * 說明文字裡若有數學，寫成 `$...$`（以 KaTeX 顯示；SelectControl／ToggleControl 的 reg 相同），不要用 Unicode 拼。
   */
  reg?: string
  /** 顯示有效位數（預設 6）；只影響顯示，不改變輸入的精確值 */
  digits?: number
  /** 只接受整數（例如 N、bits） */
  integer?: boolean
  /** 離開輸入框時把超出範圍的值夾回 [min, max] 並套用 */
  clampOnBlur?: boolean
  /** 允許把超出範圍的值仍傳給 onChange（預設 false：只顯示警告、不套用） */
  allowOutOfRange?: boolean
  disabled?: boolean
  id?: string
}

function labelText(label: ReactNode, ariaLabel?: string): string {
  if (ariaLabel) return ariaLabel
  // 無障礙名稱是純文字：拿掉 `$` 分隔符，保留 TeX 原始碼
  return typeof label === 'string' || typeof label === 'number' ? stripMathDelimiters(String(label)) : '參數'
}

/**
 * 滑桿 + 數字輸入（同步），可精確輸入例如 0.00001（不受滑桿步長限制）。
 *
 * 行為：
 * - 輸入合法數值 → 立即 onChange。
 * - 超出 [min, max] → 顯示「超出合法範圍 [min, max]」；預設不套用（allowOutOfRange 時仍套用）。
 *   若 clampOnBlur，離開欄位時夾回範圍並套用。
 * - 無法解析的文字 → 顯示警告；離開欄位時還原為目前值。
 */
export function ParamControl({
  label,
  ariaLabel,
  value,
  onChange,
  min,
  max,
  step,
  unit: rawUnit,
  log = false,
  hint,
  reg,
  digits = 6,
  integer = false,
  clampOnBlur = false,
  allowOutOfRange = false,
  disabled = false,
  id,
}: ParamControlProps) {
  // 「—」「-」只是呼叫端表示「沒有單位」的寫法，不顯示出來
  const unit = rawUnit && !/^[—–-]$/.test(rawUnit.trim()) ? rawUnit : undefined
  const autoId = useId()
  const inputId = id ?? `${autoId}-input`
  const rangeId = `${autoId}-range`
  const hintId = `${autoId}-hint`
  const warnId = `${autoId}-warn`
  const name = labelText(label, ariaLabel)

  // 輸入框文字為本地 state；外部 value 改變（滑桿、preset、reset）時同步，
  // 但若文字本身就代表該數值（例如使用者輸入 '1e-5' 而 value = 0.00001）則保留使用者的寫法。
  const [text, setText] = useState(() => formatInput(value, digits))
  const [synced, setSynced] = useState(value)
  if (!Object.is(synced, value)) {
    setSynced(value)
    const p = parseNumberInput(text)
    if (p === null || !Object.is(p, value)) setText(formatInput(value, digits))
  }

  const logOk = log && min > 0 && max > min
  const parsed = parseNumberInput(text)
  const check = checkValue(parsed, min, max, integer)
  const rangeText = `[${fmtNum(min, digits)}, ${fmtNum(max, digits)}]`

  let warning: string | null = null
  if (!check.ok) {
    if (check.problem === 'parse') warning = text.trim() === '' ? '請輸入數值' : '不是有效的數字'
    else if (check.problem === 'integer') warning = '必須為整數'
    else
      warning = `超出合法範圍 ${rangeText}${
        allowOutOfRange ? '（仍套用；結果僅供探索）' : clampOnBlur ? '（離開欄位時夾回範圍）' : '，未套用'
      }`
  }

  const emit = (v: number) => {
    if (!Object.is(v, value)) onChange(v)
  }

  const onText = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setText(raw)
    const p = parseNumberInput(raw)
    if (p === null) return
    const c = checkValue(p, min, max, integer)
    if (c.ok || (allowOutOfRange && c.problem === 'range' && (!integer || Number.isInteger(p)))) emit(p)
  }

  const onBlur = () => {
    const p = parseNumberInput(text)
    if (p === null) {
      setText(formatInput(value, digits))
      return
    }
    if (clampOnBlur && !checkValue(p, min, max, integer).ok) {
      const c = clampValue(p, min, max, integer)
      setText(formatInput(c, digits))
      emit(c)
    }
  }

  const onSlider = (e: ChangeEvent<HTMLInputElement>) => {
    const pos = Number(e.target.value)
    let v = logOk ? fromLogPosition(pos, min, max) : pos
    if (integer) v = clampValue(v, min, max, true)
    setText(formatInput(v, digits))
    emit(v)
  }

  const sliderStep = logOk ? (Math.log10(max) - Math.log10(min)) / 400 : (step ?? (integer ? Math.max(1, niceStep((max - min) / 500)) : niceStep((max - min) / 500)))
  const sliderMin = logOk ? Math.log10(min) : min
  const sliderMax = logOk ? Math.log10(max) : max
  const sliderValue = logOk ? toLogPosition(value, min, max) : Math.min(Math.max(value, min), max)
  const valueText = `${fmtNum(value, digits)}${unit ? ` ${stripMathDelimiters(unit)}` : ''}`
  const describedBy = [rangeId, hint ? hintId : null, warning ? warnId : null].filter(Boolean).join(' ')

  return (
    <div className={`c-param${warning ? ' has-warning' : ''}${disabled ? ' is-disabled' : ''}`}>
      <div className="c-param-head">
        <label className="c-param-label" htmlFor={inputId}>
          {mathText(label)}
        </label>
        {reg && <span className="c-param-reg mono">{mathText(reg)}</span>}
      </div>
      <div className="c-param-row">
        <input
          type="range"
          className="c-param-slider"
          min={sliderMin}
          max={sliderMax}
          step={sliderStep}
          value={Number.isFinite(sliderValue) ? sliderValue : sliderMin}
          onChange={onSlider}
          disabled={disabled}
          aria-label={`${name}（滑桿${logOk ? '，log 刻度' : ''}）`}
          aria-valuetext={valueText}
        />
        <span className="c-param-input-wrap">
          <input
            id={inputId}
            type="text"
            inputMode={min < 0 ? 'text' : 'decimal'}
            autoComplete="off"
            spellCheck={false}
            className="c-param-input mono"
            value={text}
            onChange={onText}
            onBlur={onBlur}
            disabled={disabled}
            aria-label={ariaLabel ?? (typeof label === 'string' ? undefined : name)}
            aria-invalid={warning ? true : undefined}
            aria-describedby={describedBy}
          />
          {unit && <span className="c-param-unit">{mathText(unit)}</span>}
        </span>
      </div>
      <div className="c-param-meta small muted">
        <span id={rangeId}>
          合法範圍 {rangeText}
          {unit ? <> {mathText(unit)}</> : ''}
          {logOk ? '（log 刻度）' : ''}
          {integer ? '（整數）' : ''}
        </span>
        {hint && (
          <span id={hintId} className="c-param-hint">
            {mathText(hint)}
          </span>
        )}
      </div>
      {warning && (
        <div id={warnId} className="c-param-warn small" role="status">
          {warning}
        </div>
      )}
    </div>
  )
}

export interface SelectOption<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectControlProps<T extends string | number> {
  label: ReactNode
  ariaLabel?: string
  value: T
  onChange: (v: T) => void
  /** 選項：可直接給值陣列，或 { value, label } 陣列 */
  options: ReadonlyArray<T | SelectOption<T>>
  hint?: ReactNode
  reg?: string
  disabled?: boolean
}

function normOption<T extends string | number>(o: T | SelectOption<T>): SelectOption<T> {
  return typeof o === 'object' ? o : { value: o, label: String(o) }
}

/** 下拉選單（選項值可為字串或數字，onChange 會回傳原型別） */
export function SelectControl<T extends string | number>({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  hint,
  reg,
  disabled = false,
}: SelectControlProps<T>) {
  const id = useId()
  const opts = options.map(normOption)
  const idx = opts.findIndex((o) => Object.is(o.value, value))
  return (
    <div className="c-param c-select">
      <div className="c-param-head">
        <label className="c-param-label" htmlFor={id}>
          {mathText(label)}
        </label>
        {reg && <span className="c-param-reg mono">{mathText(reg)}</span>}
      </div>
      <select
        id={id}
        className="c-select-input"
        value={idx >= 0 ? String(idx) : ''}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          const o = opts[Number(e.target.value)]
          if (o) onChange(o.value)
        }}
      >
        {idx < 0 && <option value="">（未選擇）</option>}
        {opts.map((o, i) => (
          <option key={`${String(o.value)}-${i}`} value={String(i)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <HintRow hint={hint} />}
    </div>
  )
}

/**
 * SelectControl／ToggleControl 的說明列。`.c-param-meta` 是 flex 容器（ParamControl 用它把「合法範圍」與 hint 排成一列），
 * 所以 hint 一定要包成單一個元素：否則「文字 + 行內公式 + 文字」會變成三個 flex item，公式自己佔一行、句子被拆成三段。
 * 刻意不用 `.c-param-hint` 這個 class：各頁的字串測試以它選取 ParamControl 的 hint，範圍不應因此改變。
 */
function HintRow({ hint }: { hint: ReactNode }) {
  return (
    <div className="c-param-meta small muted">
      <span className="c-param-note">{mathText(hint)}</span>
    </div>
  )
}

export interface ToggleControlProps {
  label: ReactNode
  ariaLabel?: string
  value: boolean
  onChange: (v: boolean) => void
  hint?: ReactNode
  reg?: string
  disabled?: boolean
}

/** 開關（checkbox，role="switch"） */
export function ToggleControl({ label, ariaLabel, value, onChange, hint, reg, disabled = false }: ToggleControlProps) {
  const id = useId()
  return (
    <div className="c-param c-toggle">
      <div className="c-toggle-row">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="c-toggle-input"
          checked={value}
          disabled={disabled}
          aria-checked={value}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label className="c-param-label" htmlFor={id}>
          {mathText(label)}
        </label>
        {reg && <span className="c-param-reg mono">{mathText(reg)}</span>}
      </div>
      {hint && <HintRow hint={hint} />}
    </div>
  )
}
