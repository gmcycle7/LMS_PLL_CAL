import { useThemeTokens } from '@/components'
import { ALGO_IDS, ALGO_LABEL, type AlgoId } from '@/simulation/models/sgd'
import { ALGO_SERIES } from '../common'

/** 選擇要比較哪些演算法（顏色與全章一致）。至少保留一個。 */
export function AlgoToggles({ value, onChange, options = ALGO_IDS }: { value: AlgoId[]; onChange: (v: AlgoId[]) => void; options?: readonly AlgoId[] }) {
  const tokens = useThemeTokens()
  return (
    <fieldset className="ch02-controls-group">
      <legend>比較的演算法（同一組資料）</legend>
      <div className="ch02-algo-toggles">
        {options.map((a) => {
          const on = value.includes(a)
          return (
            <label key={a}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  const next = on ? value.filter((v) => v !== a) : ALGO_IDS.filter((v) => v === a || value.includes(v))
                  if (next.length) onChange(next)
                }}
              />
              <span className="ch02-swatch" style={{ background: tokens.series[ALGO_SERIES[a]] }} aria-hidden="true" />
              {ALGO_LABEL[a]}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
