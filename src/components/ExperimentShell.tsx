import { useId, useRef, useState, type ReactNode } from 'react'
import { APP_VERSION, GIT_COMMIT } from './buildInfo'
import { Callout } from './Callout'
import { downloadText, toCsv } from './download'
import {
  buildExperimentPayload,
  buildExperimentReportInput,
  CROSS_CHECK_NAMES,
  normalizeCrossCheck,
  type ExperimentExportInput,
} from './experimentExport'
import { fileTimestamp, prettyJson, safeFileName } from './format'
import { randomSeed } from './hooks'
import { CHECK_LABEL } from './labels'
import { MetricTable } from './MetricTable'
import { createPlotRegistry, PlotRegistryProvider, type PlotRegistry } from './plotRegistry'
import { buildReportHtml } from './report'
import { ClaimTag, ModelLevel, SourceTag } from './Tags'
import { TestBadge } from './TestBadge'
import { mathText } from './Tex'
import type {
  ClaimKind,
  CrossCheck,
  CsvColumns,
  ExperimentActions,
  ExperimentPreset,
  MetricRow,
  ModelLevelId,
  SourceKind,
} from './types'

export interface ExperimentShellProps {
  /** 實驗 ID，例如 'lms-playground'（匯出檔名與報告使用） */
  id: string
  title: string
  level: ModelLevelId
  claim?: ClaimKind
  /** 預設 'illustrative' */
  source?: SourceKind
  /** 對應的 T-id，例如 ['T01', 'T02'] */
  tests?: string[]
  /** 標題下方的簡短說明 */
  description?: ReactNode
  /** 假設清單：顯示在頁面並寫入 JSON / 報告 */
  assumptions: string[]
  /** 參數面板（ParamControl 等） */
  controls: ReactNode
  /** 圖表與結果 */
  children: ReactNode
  /** 目前參數（匯出 JSON / 報告用） */
  params: Record<string, unknown>
  seed?: number
  onSeedChange?: (s: number) => void
  /** 參數或指標的單位，例如 { mu: 'fs', sigma_v: 'fs' } */
  units?: Record<string, string>
  metrics?: MetricRow[]
  /** 失穩 / 無解等警告；以 danger callout 顯示（必須解釋原因） */
  warnings?: string[]
  /** 未提供時三項都顯示 Not implemented */
  crossCheck?: CrossCheck
  actions?: ExperimentActions
  /** CSV 欄位（長度可不同，短欄以空白補齊） */
  exportData?: () => CsvColumns
  presets?: ExperimentPreset[]
  onLoadPreset?: (p: ExperimentPreset) => void
  /** 標題層級（預設 h3） */
  headingLevel?: 2 | 3 | 4
}

const SEED_MAX = 0xffff_ffff

function SeedControl({ seed, onSeedChange }: { seed: number; onSeedChange?: (s: number) => void }) {
  const id = useId()
  const [text, setText] = useState(String(seed))
  const [synced, setSynced] = useState(seed)
  if (synced !== seed) {
    setSynced(seed)
    setText(String(seed))
  }
  const trimmed = text.trim()
  const valid = /^\d+$/.test(trimmed) && Number(trimmed) <= SEED_MAX
  return (
    <div className="c-seed">
      <label htmlFor={id} className="c-seed-label">
        seed
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className="c-seed-input mono"
        value={text}
        readOnly={!onSeedChange}
        aria-invalid={valid ? undefined : true}
        onChange={(e) => {
          setText(e.target.value)
          const t = e.target.value.trim()
          if (/^\d+$/.test(t) && Number(t) <= SEED_MAX && onSeedChange) onSeedChange(Number(t))
        }}
        onBlur={() => {
          if (!valid) setText(String(seed))
        }}
      />
      {onSeedChange && (
        <button type="button" className="btn" onClick={() => onSeedChange(randomSeed())}>
          隨機新 seed
        </button>
      )}
      {!valid && <span className="c-param-warn small">seed 必須是 0–4294967295 的整數</span>}
    </div>
  )
}

function ActionBar({ actions }: { actions: ExperimentActions }) {
  const { onReset, onStep, onRun, onRunToConvergence, onStop, onFreeze, running = false, frozen = false } = actions
  return (
    <div className="c-exp-actions" role="group" aria-label="模擬控制">
      {onReset && (
        <button type="button" className="btn" onClick={onReset}>
          重設 Reset
        </button>
      )}
      {onStep && (
        <button type="button" className="btn" onClick={onStep} disabled={running}>
          單步 Step
        </button>
      )}
      {onRun &&
        (running && onStop ? (
          <button type="button" className="btn btn-primary" onClick={onStop}>
            <span className="c-spinner" aria-hidden="true" />
            停止 Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onRun} disabled={running}>
            {running && <span className="c-spinner" aria-hidden="true" />}
            {running ? '執行中…' : '執行 Run'}
          </button>
        ))}
      {onRunToConvergence && (
        <button type="button" className="btn" onClick={onRunToConvergence} disabled={running}>
          執行至收斂 Run-to-Convergence
        </button>
      )}
      {onFreeze && (
        <button
          type="button"
          className={`btn c-freeze${frozen ? ' is-active' : ''}`}
          aria-pressed={frozen}
          onClick={onFreeze}
        >
          {frozen ? '已凍結 Frozen' : '凍結 Freeze'}
        </button>
      )}
      <span className="c-sr-only" aria-live="polite">
        {running ? '模擬執行中' : ''}
      </span>
    </div>
  )
}

function CrossCheckRow({ crossCheck }: { crossCheck?: CrossCheck }) {
  const cc = normalizeCrossCheck(crossCheck)
  return (
    <div className="c-exp-crosscheck" aria-label="交叉比對">
      <span className="c-exp-crosscheck-title">交叉比對</span>
      {(Object.keys(cc) as (keyof CrossCheck)[]).map((k) => (
        <span key={k} className={`c-check c-check-${cc[k].status}`} title={cc[k].note}>
          <span className="c-check-name">{CROSS_CHECK_NAMES[k]}</span>
          <span className="c-check-status">{CHECK_LABEL[cc[k].status]}</span>
          {cc[k].note && <span className="c-check-note small muted">{mathText(cc[k].note)}</span>}
        </span>
      ))}
    </div>
  )
}

/**
 * 互動實驗外框（conventions §3 / 規格 §19）：標題 + 標籤、控制列、雙欄（參數｜結果）、
 * 警告、交叉比對、假設、模擬條件摘要與 JSON / CSV / HTML 報告匯出。
 */
export function ExperimentShell(props: ExperimentShellProps) {
  const {
    id,
    title,
    level,
    claim,
    source = 'illustrative',
    tests,
    description,
    assumptions,
    controls,
    children,
    params,
    seed,
    onSeedChange,
    units,
    metrics,
    warnings = [],
    crossCheck,
    actions,
    exportData,
    presets,
    onLoadPreset,
    headingLevel = 3,
  } = props

  const registryRef = useRef<PlotRegistry | null>(null)
  if (!registryRef.current) registryRef.current = createPlotRegistry()
  const [busy, setBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const presetId = useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  const exportInput = (): ExperimentExportInput => ({
    id,
    title,
    level,
    claim,
    source,
    tests,
    assumptions,
    params,
    seed,
    units,
    metrics,
    warnings,
    crossCheck,
  })
  const baseName = () => `${safeFileName(id)}-${fileTimestamp()}`

  const safeExportData = (): { data?: CsvColumns; error?: string } => {
    if (!exportData) return {}
    try {
      return { data: exportData() }
    } catch (err) {
      return { error: `資料匯出失敗：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  const onJson = () => {
    setExportError(null)
    const payload = buildExperimentPayload(exportInput())
    downloadText(`${baseName()}.json`, 'application/json', JSON.stringify(payload, null, 2))
  }

  const onCsv = () => {
    setExportError(null)
    const { data, error } = safeExportData()
    if (error || !data) {
      setExportError(error ?? '沒有可匯出的資料')
      return
    }
    downloadText(`${baseName()}.csv`, 'text/csv', toCsv(data), { bom: true })
  }

  const onReport = async () => {
    setExportError(null)
    setBusy(true)
    try {
      const { plots, failed } = await registryRef.current!.captureAll()
      const { data, error } = safeExportData()
      const notes = [...(failed.length > 0 ? [`以下圖表無法擷取（可能尚未載入）：${failed.join('、')}`] : []), ...(error ? [error] : [])]
      const html = buildReportHtml(buildExperimentReportInput(exportInput(), { plots, data, notes }))
      downloadText(`${baseName()}-report.html`, 'text/html', html)
    } catch (err) {
      setExportError(`報告產生失敗：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const summary = {
    experiment_id: id,
    model_level: level,
    seed: seed ?? null,
    params,
    units: units ?? {},
    app_version: APP_VERSION,
    git_commit: GIT_COMMIT,
  }

  const hasToolbar = Boolean(actions || seed !== undefined || (presets && presets.length > 0 && onLoadPreset))

  return (
    <PlotRegistryProvider registry={registryRef.current}>
      <section className="c-exp" id={`exp-${id}`} data-experiment={id} aria-labelledby={`exp-${id}-title`}>
        <header className="c-exp-head">
          <Heading className="c-exp-title" id={`exp-${id}-title`}>
            {mathText(title)}
          </Heading>
          <div className="c-tag-row">
            <ModelLevel level={level} />
            {claim && <ClaimTag kind={claim} />}
            <SourceTag kind={source} />
            {tests?.map((t) => <TestBadge key={t} id={t} />)}
          </div>
          {description && <div className="c-exp-desc">{mathText(description)}</div>}
        </header>

        {warnings.length > 0 && (
          <div className="c-exp-warnings">
            {warnings.map((w, i) => (
              <Callout key={`${i}-${w}`} kind="danger" title="警告">
                <p>{mathText(w)}</p>
              </Callout>
            ))}
          </div>
        )}

        {hasToolbar && (
          <div className="c-exp-toolbar">
            {actions && <ActionBar actions={actions} />}
            {seed !== undefined && <SeedControl seed={seed} onSeedChange={onSeedChange} />}
            {presets && presets.length > 0 && onLoadPreset && (
              <div className="c-exp-presets">
                <label htmlFor={presetId} className="small muted">
                  Preset
                </label>
                <select
                  id={presetId}
                  value=""
                  onChange={(e) => {
                    const p = presets[Number(e.target.value)]
                    if (p) onLoadPreset(p)
                  }}
                >
                  <option value="">載入 preset…</option>
                  {presets.map((p, i) => (
                    <option key={`${p.name}-${i}`} value={String(i)} title={p.description}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="c-exp-body">
          <div className="c-exp-controls" aria-label="參數">
            {controls}
          </div>
          <div className="c-exp-results">
            {children}
            {metrics && metrics.length > 0 && <MetricTable rows={metrics} />}
          </div>
        </div>

        <CrossCheckRow crossCheck={crossCheck} />

        <div className="c-exp-assumptions">
          <div className="c-exp-subtitle">假設（Assumptions）</div>
          {assumptions.length > 0 ? (
            <ul className="c-assumption-list">
              {assumptions.map((a, i) => (
                <li key={`${i}-${a}`}>{mathText(a)}</li>
              ))}
            </ul>
          ) : (
            <p className="small muted">未列出假設。</p>
          )}
        </div>

        <details className="c-exp-summary" onToggle={(e) => setSummaryOpen(e.currentTarget.open)}>
          <summary>模擬條件摘要</summary>
          <dl className="c-exp-summary-list small">
            <dt>seed</dt>
            <dd className="mono">{seed ?? '（無隨機性）'}</dd>
            <dt>模型層級</dt>
            <dd>{level}</dd>
            <dt>版本</dt>
            <dd className="mono">
              v{APP_VERSION} · {GIT_COMMIT}
            </dd>
            {units && Object.keys(units).length > 0 && (
              <>
                <dt>單位</dt>
                <dd>
                  {Object.entries(units)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('；')}
                </dd>
              </>
            )}
          </dl>
          {summaryOpen && <SummaryJson text={prettyJson(summary)} />}
        </details>

        <div className="c-exp-export" role="group" aria-label="匯出">
          <button type="button" className="btn" onClick={onJson}>
            下載 JSON
          </button>
          {exportData && (
            <button type="button" className="btn" onClick={onCsv}>
              下載 CSV
            </button>
          )}
          <button type="button" className="btn" onClick={() => void onReport()} disabled={busy}>
            {busy ? '產生報告中…' : '下載 HTML 報告'}
          </button>
          {exportError && <span className="c-param-warn small">{exportError}</span>}
        </div>
      </section>
    </PlotRegistryProvider>
  )
}

/** 不超過這麼多行的摘要 JSON 整段顯示（超過才收進 320px 的可捲動框）：為了兩三行放一條捲軸沒有用途 */
export const SUMMARY_JSON_FULL_LINES = 24

function SummaryJson({ text }: { text: string }) {
  const short = text.split('\n').length <= SUMMARY_JSON_FULL_LINES
  return <pre className={`c-exp-json${short ? ' is-full' : ''}`}>{text}</pre>
}
