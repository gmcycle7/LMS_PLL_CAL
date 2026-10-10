/**
 * 共用 UI 元件的型別定義（docs/dev-conventions.md §2–§3）。
 * 這些型別也被 report / export 等純函式使用，因此不得 import React。
 */

/** 規格 §0.1 三層結論標籤 */
export type ClaimKind = 'exact' | 'approx' | 'research'

/** 規格 §18.4：範例來源標示 */
export type SourceKind = 'illustrative' | 'simulation' | 'literature' | 'measured'

/** 規格 §15.1 模型層級 */
export type ModelLevelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'

/** Analytic / Monte Carlo / Fixed-Point 交叉比對狀態（規格 §19） */
export type CheckStatus = 'ok' | 'mismatch' | 'not-implemented' | 'n/a'

/** 可附註的交叉比對項目，例如 `{ status: 'mismatch', note: 'Δ = 3.2σ' }` */
export interface CheckEntry {
  status: CheckStatus
  note?: string
}

export interface CrossCheck {
  analytic: CheckStatus | CheckEntry
  monteCarlo: CheckStatus | CheckEntry
  fixedPoint: CheckStatus | CheckEntry
}

/** 指標表的一列 */
export interface MetricRow {
  name: string
  /** 數值；字串會原樣顯示（例如 'Not implemented'），null 顯示「—」 */
  value: number | string | null
  unit?: string
  /** 對應公式 ID，例如 'F-3.1' */
  formulaId?: string
  claim?: ClaimKind
  /** 解析參考值；有值時顯示 Δ = value − analytic */
  analytic?: number
  /** 容許誤差；有值時顯示 ✓ / ✗（需同時提供 analytic） */
  tolerance?: number
  /** 'abs'（預設）：|Δ| ≤ tolerance；'rel'：|Δ| ≤ tolerance·|analytic| */
  toleranceMode?: 'abs' | 'rel'
  /** 顯示用有效位數（預設 6） */
  digits?: number
  /** 補充說明（顯示在名稱下方） */
  note?: string
}

export interface ExperimentPreset {
  name: string
  params: Record<string, unknown>
  description?: string
}

export interface ExperimentActions {
  onReset?: () => void
  onStep?: () => void
  onRun?: () => void
  onRunToConvergence?: () => void
  /** 提供時，running 期間 Run 按鈕會變成「停止」 */
  onStop?: () => void
  /** Freeze 為切換鈕；frozen 表示目前狀態 */
  onFreeze?: () => void
  running?: boolean
  frozen?: boolean
}

/** CSV 匯出欄位：欄名 → 數列（可為 typed array；長度可不同，短欄以空白補齊） */
export type CsvCell = number | string | boolean | null | undefined
export type CsvColumns = Record<string, ArrayLike<CsvCell>>
