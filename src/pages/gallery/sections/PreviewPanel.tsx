import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ModelLevel, ModeGate, Plot, SourceTag, stripMathDelimiters, Tex } from '@/components'
import type { PresetEntry } from '@/data/types'
import { previewPreset, type PreviewChart, type PreviewOutcome, type PreviewResult } from '../previews'
import { checkExpected, type ExpectedCheck } from '../consistency'
import { MatchMark, NumTex, Rich, Steps } from '../common'
import { sigForMatch, texNum } from '../format'

/** Plotly traces / layout（memo：避免每次 render 都重新 Plotly.react） */
function useChartFigure(chart: PreviewChart | undefined): { data: Data[]; layout: Partial<Layout> } | null {
  return useMemo(() => {
    if (!chart) return null
    const xs = chart.series.flatMap((s) => s.x)
    const xMin = xs.length ? Math.min(...xs) : 0
    const xMax = xs.length ? Math.max(...xs) : 1
    const data: Data[] = chart.series.map((s) => ({ x: s.x, y: s.y, type: 'scatter', mode: s.mode ?? 'lines', name: s.name }))
    for (const h of chart.hLines ?? []) {
      data.push({ x: [xMin, xMax], y: [h.y, h.y], type: 'scatter', mode: 'lines', name: h.name, line: { dash: 'dot', width: 1 }, hoverinfo: 'y+name' })
    }
    const layout: Partial<Layout> = {
      xaxis: { title: { text: chart.xLabel } },
      yaxis: { title: { text: chart.yLabel } },
      showlegend: chart.series.length + (chart.hLines?.length ?? 0) > 1,
      margin: { l: 60, r: 16, t: 16, b: 48 },
    }
    return { data, layout }
  }, [chart])
}

/** 一個預覽結果的完整顯示（卡片內 compact、Inspector 內完整） */
export function PreviewView({
  preset,
  outcome,
  compact = false,
  tolK = 1.001,
}: {
  preset: PresetEntry
  outcome: PreviewOutcome
  compact?: boolean
  /** 比對容差倍數（Inspector 可調；卡片內固定 1.001） */
  tolK?: number
}) {
  const result = outcome.status === 'ok' ? outcome.result : null
  const check = useMemo(() => (result ? checkExpected(preset, result.metrics, tolK) : null), [preset, result, tolK])
  const fig = useChartFigure(result?.chart)
  if (outcome.status === 'unsupported')
    return (
      <Callout kind="info" title="這個 preset 沒有 Gallery 內預覽">
        <Rich text={outcome.reason} />
      </Callout>
    )
  if (outcome.status === 'error')
    return (
      <Callout kind="danger" title="模型函式拒絕這組參數（原因如下，不是程式當掉）">
        <Rich text={outcome.message} />
      </Callout>
    )
  const r = outcome.result
  return (
    <div className="gal-preview" data-experiment={r.experiment}>
      <p className="gal-preview-summary">
        <Rich text={r.summary} />
      </p>
      <div className="c-tag-row gal-preview-tags">
        <ClaimTag kind={r.claim} />
        <ModelLevel level={r.level} />
        <SourceTag kind={preset.source} />
        <span className="small muted">主執行緒計算 {outcome.ms.toFixed(1)} ms{r.seed !== undefined ? `，seed ${r.seed}` : ''}</span>
      </div>
      {r.verdicts.map((v, i) => (
        <Callout key={i} kind={v.kind} title={null}>
          <Rich text={v.text} />
        </Callout>
      ))}
      <MetricsTable result={r} check={check} compact={compact} />
      {check && <ExpectedSummary check={check} />}
      {r.steps.length > 0 && <Steps title={r.stepsTitle} steps={r.steps} />}
      {r.table && <PreviewTableView table={r.table} />}
      {r.chart && fig && (
        <Plot
          data={fig.data}
          layout={fig.layout}
          height={compact ? 240 : 300}
          title={r.chart.title}
          csvName={`gallery-${preset.id}`}
          yLog={r.chart.yLog}
          ariaLabel={`${stripMathDelimiters(r.chart.title)}：${r.chart.series.map((s) => s.name).join('、')}`}
        />
      )}
      <ModeGate min="engineer">
        <ul className="small gal-notes">
          {r.notes.map((n, i) => (
            <li key={i}>
              <Rich text={n} />
            </li>
          ))}
        </ul>
      </ModeGate>
      <ModeGate min="research">
        <p className="small muted gal-fns">
          實際呼叫的模型函式：
          {r.modelFns.map((f) => (
            <code key={f} className="gal-fn">
              {f}
            </code>
          ))}
        </p>
      </ModeGate>
    </div>
  )
}

function MetricsTable({ result, check, compact }: { result: PreviewResult; check: ExpectedCheck | null; compact: boolean }) {
  const byKey = useMemo(() => new Map((check?.rows ?? []).map((r) => [r.key, r])), [check])
  // compact（卡片內）：必備數值與相符數值優先，最多 10 列；其餘在 Inspector 看
  const rows = useMemo(() => {
    if (!compact) return result.metrics
    const prio = (k: string) => (byKey.get(k)?.required ? 0 : byKey.get(k)?.status === 'match' ? 1 : 2)
    return [...result.metrics].sort((a, b) => prio(a.key) - prio(b.key)).slice(0, 10)
  }, [result, compact, byKey])
  return (
    <div className="table-wrap gal-metric-wrap">
      <table className="gal-metric-table">
        <caption className="small muted">
          以真實模型函式重算（{rows.length}/{result.metrics.length} 個量{compact && rows.length < result.metrics.length ? '；完整清單見下方 Preset Inspector' : ''}）
        </caption>
        <thead>
          <tr>
            <th>量</th>
            <th className="num">數值</th>
            <th>標籤</th>
            <th>預期文字</th>
            <th>說明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const c = byKey.get(m.key)
            return (
              <tr key={m.key} data-key={m.key} data-check={c?.status} className={c?.required ? 'gal-row-required' : undefined}>
                <td className="gal-metric-label">
                  <Tex>{m.label}</Tex>
                </td>
                <td className="num nowrap">
                  <NumTex value={m.value} sig={typeof m.value === 'number' && c?.hit ? sigForMatch(m.value, c.hit.tol, m.sig ?? 6) : (m.sig ?? 6)} />
                  {m.unit && (
                    <>
                      {' '}
                      <Tex>{m.unit}</Tex>
                    </>
                  )}
                </td>
                <td>
                  <ClaimTag kind={m.claim} />
                </td>
                <td className="nowrap">{c ? <MatchMark status={c.status} raw={c.hit?.raw} /> : '—'}</td>
                <td className="small">{m.note ? <Rich text={m.note} /> : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ExpectedSummary({ check }: { check: ExpectedCheck }) {
  const kind = check.status === 'ok' ? 'ok' : check.status === 'mismatch' ? 'danger' : 'info'
  return (
    <Callout kind={kind} title={check.status === 'ok' ? '與 preset 預期文字一致' : check.status === 'mismatch' ? '與 preset 預期文字不一致' : '預期文字比對'}>
      {check.note}
    </Callout>
  )
}

function PreviewTableView({ table }: { table: NonNullable<PreviewResult['table']> }) {
  return (
    <div className="table-wrap">
      <table className="gal-data-table">
        <caption className="small muted">{table.caption}</caption>
        <thead>
          <tr>
            {table.head.map((h, i) => (
              <th key={i}>
                <Rich text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>
                  {typeof cell === 'number' ? <Tex>{texNum(cell, 6)}</Tex> : <Rich text={cell} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 卡片內的預覽（lazy chunk 的預設匯出）：mount 時計算一次 */
export default function PreviewPanel({ preset }: { preset: PresetEntry }) {
  const outcome = useMemo(() => previewPreset(preset), [preset])
  return <PreviewView preset={preset} outcome={outcome} compact />
}
