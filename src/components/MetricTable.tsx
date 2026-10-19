import { ClaimTag } from './Tags'
import { fmtNum } from './format'
import { evaluateMetric, formatMetricValue } from './metrics'
import type { MetricRow } from './types'
import { mathText } from './Tex'
import { ScrollRegion } from './ScrollRegion'
import { FormulaLink } from './links'

export interface MetricTableProps {
  rows: MetricRow[]
  caption?: string
}

/**
 * 指標表：名稱、數值、單位、公式 ID、結論標籤；有 analytic 時顯示 Δ，有 tolerance 時顯示 ✓ / ✗。
 * 容器窄（例如實驗的右欄、手機）時由 CSS 改排成一個指標一張小卡，不必橫向捲動（見 components.css）。
 */
export function MetricTable({ rows, caption }: MetricTableProps) {
  if (rows.length === 0) return null
  const hasAnalytic = rows.some((r) => r.analytic !== undefined)
  const hasFormula = rows.some((r) => r.formulaId)
  const hasClaim = rows.some((r) => r.claim)
  return (
    <ScrollRegion className="table-wrap c-metric-wrap" label="指標表（可左右捲動）">
      <table className="c-metric-table">
        {/* 沒給標題時仍要有 <caption>（螢幕閱讀器的表格名稱）：視覺隱藏的通用名稱 */}
        {caption ? <caption>{mathText(caption)}</caption> : <caption className="c-sr-only">指標表</caption>}
        <thead>
          <tr>
            <th scope="col">指標</th>
            <th scope="col" className="num">數值</th>
            <th scope="col">單位</th>
            {hasFormula && <th scope="col">公式</th>}
            {hasClaim && <th scope="col">標籤</th>}
            {hasAnalytic && <th scope="col" className="num">解析值</th>}
            {hasAnalytic && <th scope="col" className="num">Δ（模擬 − 解析）</th>}
            {hasAnalytic && <th scope="col">檢查</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const ev = evaluateMetric(r)
            const digits = r.digits ?? 6
            const nonFinite = typeof r.value === 'number' && !Number.isFinite(r.value)
            return (
              <tr key={`${r.name}-${i}`} data-pass={ev.pass === undefined ? undefined : String(ev.pass)}>
                <td>
                  {mathText(r.name)}
                  {r.note && <div className="small muted">{mathText(r.note)}</div>}
                </td>
                <td className={`num mono${nonFinite ? ' c-bad' : ''}`}>{formatMetricValue(r.value, digits)}</td>
                <td>{r.unit ? mathText(r.unit) : ''}</td>
                {hasFormula && (
                  <td>{r.formulaId ? <FormulaLink id={r.formulaId} /> : ''}</td>
                )}
                {hasClaim && <td>{r.claim ? <ClaimTag kind={r.claim} /> : ''}</td>}
                {hasAnalytic && (
                  <td className="num mono" data-label="解析值">
                    {r.analytic !== undefined ? fmtNum(r.analytic, digits) : ''}
                  </td>
                )}
                {hasAnalytic && (
                  <td className="num mono" data-label="Δ">
                    {ev.delta !== undefined ? fmtNum(ev.delta, 3) : ''}
                    {ev.relDelta !== undefined && Number.isFinite(ev.relDelta) && (
                      <span className="small muted"> ({fmtNum(ev.relDelta * 100, 3)}%)</span>
                    )}
                  </td>
                )}
                {hasAnalytic && (
                  <td data-col="check">
                    {ev.pass === undefined ? (
                      ''
                    ) : ev.pass ? (
                      <span className="c-ok" title={`容許誤差 ${r.toleranceMode === 'rel' ? '相對' : '絕對'} ${r.tolerance}`}>
                        ✓
                      </span>
                    ) : (
                      <span className="c-bad" title={`超出容許誤差 ${r.toleranceMode === 'rel' ? '相對' : '絕對'} ${r.tolerance}`}>
                        ✗
                      </span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </ScrollRegion>
  )
}
