import { fmtNum } from './format'
import type { MetricRow } from './types'

export interface MetricEvaluation {
  /** Δ = value − analytic；無法計算時為 undefined */
  delta?: number
  /** 相對差 Δ/|analytic|（analytic ≠ 0 時） */
  relDelta?: number
  /** 是否在容許誤差內；未提供 tolerance 時為 undefined */
  pass?: boolean
}

/**
 * 計算指標與解析值的差距與通過與否。
 * - value 非有限數（NaN、∞）一律判定為不通過。
 * - tolerance 模式：'abs' → |Δ| ≤ tol；'rel' → |Δ| ≤ tol·|analytic|。
 */
export function evaluateMetric(row: MetricRow): MetricEvaluation {
  if (row.analytic === undefined || typeof row.value !== 'number') {
    return row.tolerance !== undefined && row.analytic !== undefined ? { pass: false } : {}
  }
  const delta = row.value - row.analytic
  const relDelta = row.analytic !== 0 && Number.isFinite(row.analytic) ? delta / Math.abs(row.analytic) : undefined
  let pass: boolean | undefined
  if (row.tolerance !== undefined) {
    if (!Number.isFinite(row.value) || !Number.isFinite(delta)) pass = false
    else if (row.toleranceMode === 'rel') pass = Math.abs(delta) <= row.tolerance * Math.abs(row.analytic)
    else pass = Math.abs(delta) <= row.tolerance
  }
  return { delta, relDelta, pass }
}

/** 指標數值的顯示字串 */
export function formatMetricValue(v: MetricRow['value'], digits = 6): string {
  if (v === null) return '—'
  if (typeof v === 'string') return v
  return fmtNum(v, digits)
}

/** 指標列轉成 JSON 匯出用的扁平物件 */
export function metricToJson(row: MetricRow): Record<string, unknown> {
  const ev = evaluateMetric(row)
  return {
    name: row.name,
    value: row.value,
    unit: row.unit ?? null,
    formula_id: row.formulaId ?? null,
    claim: row.claim ?? null,
    analytic: row.analytic ?? null,
    delta: ev.delta ?? null,
    rel_delta: ev.relDelta ?? null,
    tolerance: row.tolerance ?? null,
    tolerance_mode: row.tolerance !== undefined ? (row.toleranceMode ?? 'abs') : null,
    pass: ev.pass ?? null,
  }
}
