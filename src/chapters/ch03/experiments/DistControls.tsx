import { useId, useState } from 'react'
import { ParamControl, SelectControl } from '@/components'
import { tx } from '../common'
import { DIST_LABEL, validateDist, type XDist, type XDistKind } from '@/simulation/models/scalarStability'

/** 實驗參數中描述 x 分布的欄位（全部是純量 / 字串，方便 preset 與 JSON 匯出） */
export interface DistFields {
  dist: XDistKind
  /** fixed：x 的值 */
  xValue: number
  /** gaussian：σ */
  sigma: number
  /** uniform：半寬 c（U(−c, c)） */
  halfWidth: number
  /** pm_one：幅度 A */
  amplitude: number
  /** list：以逗號／空白分隔的數值 */
  listText: string
}

export const DEFAULT_DIST_FIELDS: DistFields = {
  dist: 'gaussian',
  xValue: 2,
  sigma: 1,
  halfWidth: Math.sqrt(3),
  amplitude: 1,
  listText: '0, 0, 0, 0, 0, 0, 0, 0, 0, 3',
}

/** 解析清單文字；回傳數值陣列或中文錯誤訊息 */
export function parseList(text: string): { values: number[]; error: string | null } {
  const parts = text
    .split(/[\s,;，、；]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return { values: [], error: '清單至少要有一個數值' }
  if (parts.length > 1000) return { values: [], error: '清單最多 1000 個數值' }
  const values = parts.map((s) => Number(s.replace(/−/g, '-')))
  const bad = parts.find((_, i) => !Number.isFinite(values[i]))
  if (bad !== undefined) return { values: [], error: `「${bad}」不是有效的數字` }
  return { values, error: null }
}

/** 欄位 → XDist；不合法時 dist 為 null 並附錯誤訊息 */
export function toXDist(f: DistFields): { dist: XDist | null; error: string | null } {
  let d: XDist
  switch (f.dist) {
    case 'fixed':
      d = { kind: 'fixed', value: f.xValue }
      break
    case 'gaussian':
      d = { kind: 'gaussian', sigma: f.sigma }
      break
    case 'uniform':
      d = { kind: 'uniform', halfWidth: f.halfWidth }
      break
    case 'pm_one':
      d = { kind: 'pm_one', amplitude: f.amplitude }
      break
    case 'list': {
      const { values, error } = parseList(f.listText)
      if (error) return { dist: null, error }
      d = { kind: 'list', values }
      break
    }
    default:
      return { dist: null, error: `未知的分布「${String(f.dist)}」` }
  }
  const err = validateDist(d)
  return err ? { dist: null, error: err } : { dist: d, error: null }
}

/** 一句話描述分布（給圖例與摘要） */
export function distSummary(f: DistFields): string {
  switch (f.dist) {
    case 'fixed':
      return `固定 x = ${f.xValue}`
    case 'gaussian':
      return `Gaussian σ = ${f.sigma}`
    case 'uniform':
      return `Uniform ±${Number(f.halfWidth.toPrecision(4))}`
    case 'pm_one':
      return `±${f.amplitude}`
    case 'list':
      return `清單 {${f.listText.length > 24 ? `${f.listText.slice(0, 24)}…` : f.listText}}`
  }
}

const KINDS: XDistKind[] = ['fixed', 'gaussian', 'uniform', 'pm_one', 'list']

function ListInput({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  if (synced !== value) {
    setSynced(value)
    setText(value)
  }
  const { error } = parseList(text)
  return (
    <div className="ch03-listinput">
      <label htmlFor={id}>x 的清單（每筆 iid 等機率抽一個）</label>
      <input
        id={id}
        type="text"
        inputMode="text"
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          if (!parseList(e.target.value).error) onChange(e.target.value)
        }}
      />
      <span className="small muted">以逗號或空白分隔，例如「0, 0, 0, 3」；最多 1000 筆。對應硬體：一段 DSM / training code 的取值集合。</span>
      {error && <span className="ch03-listinput-err">{error}（未套用）</span>}
    </div>
  )
}

/** x 分布選擇 + 對應參數（每個欄位都有精確數字輸入、單位與合法範圍） */
export function DistControls({ value, onChange }: { value: DistFields; onChange: (patch: Partial<DistFields>) => void }) {
  return (
    <>
      <SelectControl<XDistKind>
        label="x 的分布"
        value={value.dist}
        onChange={(dist) => onChange({ dist })}
        options={KINDS.map((k) => ({ value: k, label: DIST_LABEL[k] }))}
        reg="regressor / DSM code 統計（behavioral）"
        hint={tx`每一筆 $x_n$ 都由此分布獨立抽樣（iid）`}
      />
      {value.dist === 'fixed' && (
        <ParamControl label="x（固定值）" value={value.xValue} onChange={(xValue) => onChange({ xValue })} min={-4} max={4} step={0.01} unit="[x]" reg="DTC code（固定）" />
      )}
      {value.dist === 'gaussian' && (
        <ParamControl label="σ（x 的標準差）" value={value.sigma} onChange={(sigma) => onChange({ sigma })} min={0} max={4} step={0.01} unit="[x]" reg="code RMS（正規化）" hint={tx`$P_x=\sigma^2$，$M_4=3\sigma^4$`} />
      )}
      {value.dist === 'uniform' && (
        <ParamControl
          label="c（半寬，U(−c, c)）"
          value={value.halfWidth}
          onChange={(halfWidth) => onChange({ halfWidth })}
          min={0}
          max={4}
          step={0.001}
          unit="[x]"
          reg="code 峰值（正規化）"
          hint={tx`$c=\sqrt3\approx1.732$ 時 $P_x=c^2/3=1$；$M_4=c^4/5$`}
        />
      )}
      {value.dist === 'pm_one' && (
        <ParamControl label="A（±A 的幅度）" value={value.amplitude} onChange={(amplitude) => onChange({ amplitude })} min={-4} max={4} step={0.01} unit="[x]" reg="bipolar code 幅度" hint={tx`$|x|$ 恆為 $|A|$：三種界限相同`} />
      )}
      {value.dist === 'list' && <ListInput value={value.listText} onChange={(listText) => onChange({ listText })} />}
    </>
  )
}
