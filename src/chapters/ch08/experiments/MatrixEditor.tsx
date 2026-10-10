import { useId, useState, type ReactNode } from 'react'
import { parseNumberInput } from '@/components'

/**
 * 小型矩陣／向量輸入表（一般化 state-space 模式用）。每個格子都是可精確輸入的數字欄位，
 * 合法範圍 [min, max]；不合法時標紅且不套用（與 ParamControl 行為一致）。
 */
function Cell({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  label: string
}) {
  const [text, setText] = useState(String(value))
  const [synced, setSynced] = useState(value)
  if (!Object.is(synced, value)) {
    setSynced(value)
    const p = parseNumberInput(text)
    if (p === null || !Object.is(p, value)) setText(String(value))
  }
  const p = parseNumberInput(text)
  const ok = p !== null && p >= min && p <= max
  return (
    <input
      type="text"
      inputMode="text"
      className={`ch08-cell mono${ok ? '' : ' is-invalid'}`}
      value={text}
      aria-label={label}
      aria-invalid={ok ? undefined : true}
      title={ok ? label : `${label}：超出合法範圍 [${min}, ${max}] 或不是數字，未套用`}
      onChange={(e) => {
        setText(e.target.value)
        const v = parseNumberInput(e.target.value)
        if (v !== null && v >= min && v <= max && !Object.is(v, value)) onChange(v)
      }}
      onBlur={() => {
        if (!ok) setText(String(value))
      }}
    />
  )
}

export interface MatrixEditorProps {
  /** TeX 以外的純文字名稱，例如 'A_s' */
  name: string
  /** 顯示用標題（可含 Tex） */
  title: ReactNode
  rows: number[][]
  onChange: (rows: number[][]) => void
  min?: number
  max?: number
  /** 對應的 behavioral parameter / 暫存器說明 */
  reg?: string
}

export function MatrixEditor({ name, title, rows, onChange, min = -5, max = 5, reg }: MatrixEditorProps) {
  const id = useId()
  return (
    <div className="ch08-matrix" role="group" aria-labelledby={id}>
      <div className="ch08-matrix-head">
        <span id={id} className="ch08-matrix-title">
          {title}
        </span>
        {reg && <span className="c-param-reg mono">{reg}</span>}
      </div>
      <div className="ch08-matrix-grid" style={{ gridTemplateColumns: `repeat(${rows[0]?.length ?? 1}, minmax(0, 1fr))` }}>
        {rows.map((row, i) =>
          row.map((v, j) => (
            <Cell
              key={`${i}-${j}`}
              value={v}
              min={min}
              max={max}
              label={`${name}[${i + 1}][${j + 1}]`}
              onChange={(nv) => onChange(rows.map((r, ii) => r.map((x, jj) => (ii === i && jj === j ? nv : x))))}
            />
          )),
        )}
      </div>
      <div className="small muted">
        合法範圍 [{min}, {max}]（每格可精確輸入，例如 0.00001）
      </div>
    </div>
  )
}
