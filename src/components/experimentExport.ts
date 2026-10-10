import { APP_VERSION, GIT_COMMIT } from './buildInfo'
import { csvPreview } from './download'
import { fmtNum, toJsonSafe } from './format'
import { CHECK_LABEL, CLAIM_LABEL, MODEL_LEVEL_INFO, SOURCE_LABEL } from './labels'
import { evaluateMetric, formatMetricValue, metricToJson } from './metrics'
import type { ReportInput, ReportPlot } from './report'
import { getTestStatus } from './testStatus'
import type { CheckEntry, CheckStatus, ClaimKind, CrossCheck, CsvColumns, MetricRow, ModelLevelId, SourceKind } from './types'

/**
 * ExperimentShell 匯出（JSON / HTML 報告）的純函式部分，方便單元測試。
 * JSON 欄位命名沿用規格 §20.3 的 API 契約（experiment_id、model_level、input_parameters…）。
 */

export interface ExperimentExportInput {
  id: string
  title: string
  level: ModelLevelId
  claim?: ClaimKind
  source?: SourceKind
  tests?: string[]
  assumptions: string[]
  params: Record<string, unknown>
  seed?: number
  units?: Record<string, string>
  metrics?: MetricRow[]
  warnings?: string[]
  crossCheck?: CrossCheck
  /** 預設為 __APP_VERSION__ / __GIT_COMMIT__ */
  appVersion?: string
  commit?: string
}

export const CROSS_CHECK_NAMES: Record<keyof CrossCheck, string> = {
  analytic: 'Analytic',
  monteCarlo: 'Monte Carlo',
  fixedPoint: 'Fixed-Point',
}

/** 交叉比對未提供時，三項一律視為 'not-implemented'（不得隱藏） */
export function normalizeCrossCheck(cc?: CrossCheck): Record<keyof CrossCheck, CheckEntry> {
  const norm = (v: CheckStatus | CheckEntry | undefined): CheckEntry =>
    v === undefined ? { status: 'not-implemented' } : typeof v === 'string' ? { status: v } : v
  return {
    analytic: norm(cc?.analytic),
    monteCarlo: norm(cc?.monteCarlo),
    fixedPoint: norm(cc?.fixedPoint),
  }
}

export interface ExperimentPayload {
  experiment_id: string
  title: string
  model_level: ModelLevelId
  claim: ClaimKind | null
  source: SourceKind
  tests: { id: string; status: string }[]
  status: 'success' | 'warning'
  seed: number | null
  input_parameters: unknown
  units: Record<string, string>
  metrics: Record<string, unknown>
  metric_details: Record<string, unknown>[]
  warnings: string[]
  assumptions: string[]
  cross_check: Record<string, CheckEntry>
  app_version: string
  git_commit: string
  generated_at: string
}

/** 建立「下載 JSON」的內容物件（所有值都已轉為 JSON 安全格式，NaN / ∞ 以字串保存） */
export function buildExperimentPayload(input: ExperimentExportInput, now: Date = new Date()): ExperimentPayload {
  const metrics: Record<string, unknown> = {}
  for (const m of input.metrics ?? []) metrics[m.name] = toJsonSafe(m.value) ?? null
  const warnings = input.warnings ?? []
  return {
    experiment_id: input.id,
    title: input.title,
    model_level: input.level,
    claim: input.claim ?? null,
    source: input.source ?? 'illustrative',
    tests: (input.tests ?? []).map((id) => ({ id, status: getTestStatus(id).status })),
    status: warnings.length > 0 ? 'warning' : 'success',
    seed: input.seed ?? null,
    input_parameters: toJsonSafe(input.params) ?? {},
    units: { ...(input.units ?? {}) },
    metrics,
    metric_details: (input.metrics ?? []).map((m) => toJsonSafe(metricToJson(m)) as Record<string, unknown>),
    warnings: [...warnings],
    assumptions: [...input.assumptions],
    cross_check: normalizeCrossCheck(input.crossCheck),
    app_version: input.appVersion ?? APP_VERSION,
    git_commit: input.commit ?? GIT_COMMIT,
    generated_at: now.toISOString(),
  }
}

/** 參數值序列化成報告表格用的字串 */
function paramValueText(v: unknown): string {
  if (typeof v === 'number') return fmtNum(v, 12)
  if (typeof v === 'string') return v
  const s = JSON.stringify(toJsonSafe(v))
  return s === undefined ? String(v) : s
}

/** 建立 buildReportHtml 的輸入 */
export function buildExperimentReportInput(
  input: ExperimentExportInput,
  opts: { plots?: ReportPlot[]; data?: CsvColumns; notes?: string[]; now?: Date } = {},
): ReportInput {
  const now = opts.now ?? new Date()
  const cc = normalizeCrossCheck(input.crossCheck)
  return {
    title: input.title,
    experimentId: input.id,
    generatedAt: now.toISOString(),
    appVersion: input.appVersion ?? APP_VERSION,
    commit: input.commit ?? GIT_COMMIT,
    modelLevel: input.level,
    modelLevelDescription: MODEL_LEVEL_INFO[input.level].model,
    claim: input.claim ? CLAIM_LABEL[input.claim] : undefined,
    source: SOURCE_LABEL[input.source ?? 'illustrative'],
    tests: (input.tests ?? []).map((id) => ({ id, status: getTestStatus(id).status })),
    seed: input.seed ?? null,
    assumptions: input.assumptions,
    warnings: input.warnings ?? [],
    params: Object.entries(input.params).map(([name, value]) => ({
      name,
      value: paramValueText(value),
      unit: input.units?.[name],
    })),
    units: input.units,
    metrics: (input.metrics ?? []).map((m) => {
      const ev = evaluateMetric(m)
      return {
        name: m.name,
        value: formatMetricValue(m.value, m.digits ?? 6),
        unit: m.unit,
        formulaId: m.formulaId,
        claim: m.claim ? CLAIM_LABEL[m.claim] : undefined,
        analytic: m.analytic !== undefined ? fmtNum(m.analytic, m.digits ?? 6) : undefined,
        delta: ev.delta !== undefined ? fmtNum(ev.delta, 4) : undefined,
        pass: ev.pass,
      }
    }),
    crossCheck: (Object.keys(cc) as (keyof CrossCheck)[]).map((k) => ({
      name: CROSS_CHECK_NAMES[k],
      status: CHECK_LABEL[cc[k].status],
      note: cc[k].note,
    })),
    plots: opts.plots ?? [],
    dataPreview: opts.data ? csvPreview(opts.data, 200) : undefined,
    notes: opts.notes,
  }
}
