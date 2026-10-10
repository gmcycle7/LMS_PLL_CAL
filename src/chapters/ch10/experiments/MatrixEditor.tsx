import { useId, useState } from 'react'
import { Tex, mathText, parseNumberInput } from '@/components'
import type { Mat } from '@/simulation/models/mimo'

export interface MatrixEditorProps {
  /** TeX 名稱，例如 '\\mathbf R' */
  label: string
  /** P×P 矩陣（顯示用） */
  value: Mat
  onChange: (A: Mat) => void
  /** 對稱編輯：改 (i, j) 同時改 (j, i) */
  symmetric?: boolean
  /** 對角固定（例如 ±1 碼的相關係數矩陣） */
  lockDiagonal?: boolean
  min?: number
  max?: number
  /** 硬體暫存器或行為參數名稱 */
  reg?: string
  unit?: string
  /** 說明文字；其中的 `$...$` 以 KaTeX 顯示 */
  hint?: string
}

const fmtCell = (v: number) => {
  const s = Number(v.toPrecision(6)).toString()
  return s
}

/**
 * P×P 矩陣編輯器：每格可精確輸入（支援 1e-5、全形數字、U+2212 負號），超出合法範圍不套用並標紅。
 */
export function MatrixEditor({ label, value, onChange, symmetric = false, lockDiagonal = false, min = -10, max = 10, reg, unit, hint }: MatrixEditorProps) {
  const P = value.length
  const key = JSON.stringify(value)
  const [synced, setSynced] = useState(key)
  const [texts, setTexts] = useState<string[][]>(() => value.map((r) => r.map(fmtCell)))
  const [bad, setBad] = useState<string | null>(null)
  const id = useId()
  if (synced !== key) {
    // 外部值改變（preset、ρ 滑桿、或自己剛剛 onChange）：只重寫「文字解析後不等於新值」的格子。
    // 否則輸入到一半的文字會被洗掉（例如想打 −0.5：打到「-0」時值是 0，若重寫成「0」負號就不見了；「0.50」也會被改成「0.5」）。
    setSynced(key)
    setTexts(
      value.map((r, i) =>
        r.map((v, j) => {
          const t = texts[i]?.[j]
          return t !== undefined && parseNumberInput(t) === v ? t : fmtCell(v)
        }),
      ),
    )
  }

  const edit = (i: number, j: number, s: string) => {
    const next = texts.map((r) => r.slice())
    next[i][j] = s
    if (symmetric) next[j][i] = s
    setTexts(next)
    const v = parseNumberInput(s)
    if (v === null) {
      setBad(`(${i + 1},${j + 1}) 不是數字`)
      return
    }
    if (v < min || v > max) {
      setBad(`(${i + 1},${j + 1}) = ${v} 超出合法範圍 [${min}, ${max}]，未套用`)
      return
    }
    setBad(null)
    const A = value.map((r) => r.slice())
    A[i][j] = v
    if (symmetric) A[j][i] = v
    onChange(A)
  }

  return (
    <div className="ch10-matrix-wrap" role="group" aria-labelledby={`${id}-label`}>
      <div className="ch10-matrix-head">
        <span id={`${id}-label`}>
          <Tex>{label}</Tex>
        </span>
        <span className="small muted">
          {P}×{P}
          {unit ? `，單位 ${unit}` : ''}，合法範圍 [{min}, {max}]{symmetric ? '，對稱' : ''}
        </span>
        {reg && <span className="small mono muted">{reg}</span>}
      </div>
      <div className="ch10-matrix" style={{ gridTemplateColumns: `repeat(${P}, auto)` }}>
        {texts.slice(0, P).map((row, i) =>
          row.slice(0, P).map((t, j) => {
            const parsed = parseNumberInput(t)
            const invalid = parsed === null || parsed < min || parsed > max
            return (
              <input
                key={`${i}-${j}`}
                type="text"
                inputMode="decimal"
                aria-label={`${label.replace(/\\mathbf\s*/g, '').replace(/[\\{}]/g, '')} 第 ${i + 1} 列第 ${j + 1} 行`}
                value={t}
                disabled={lockDiagonal && i === j}
                aria-invalid={invalid ? true : undefined}
                onChange={(e) => edit(i, j, e.target.value)}
                onBlur={() => {
                  if (invalid) {
                    setTexts(value.map((r) => r.map(fmtCell)))
                    setBad(null)
                  }
                }}
              />
            )
          }),
        )}
      </div>
      {bad && <div className="ch10-matrix-msg">{bad}</div>}
      {hint && <div className="small muted">{mathText(hint)}</div>}
    </div>
  )
}
