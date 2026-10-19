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

/**
 * Analytic / Monte Carlo / Fixed-Point 交叉比對狀態（規格 §19；語意見 docs/dev-conventions.md §9）：
 *   'ok'              兩種獨立方法在寫明的 tolerance 內一致（真的算過才能標）
 *   'mismatch'        超出 tolerance（note 要寫差多少、容許多少）
 *   'not-implemented' 這個實驗應該有這種比對、但還沒做（會列在 roadmap；note 寫缺什麼）
 *   'n/a'             這種方法對這個實驗沒有意義、或此刻沒有可比的量（例如還沒執行、模型發散）；必附 note 說明原因
 */
export type CheckStatus = 'ok' | 'mismatch' | 'not-implemented' | 'n/a'

/** 可附註的交叉比對項目，例如 `{ status: 'mismatch', note: 'Δ = 3.2σ' }`；ExperimentShell 會把 note 顯示在狀態旁（含 `$…$` 行內公式） */
export interface CheckEntry {
  status: CheckStatus
  /** 一句說明：ok／mismatch 寫比了什麼、差多少；n/a 寫為什麼不適用；not-implemented 寫缺什麼 */
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
  /** 分享網址裡的 preset key（?p=）；沒有就用名稱的 slug（改名字網址就失效），有 PresetEntry 的實驗請帶 PresetEntry.id */
  id?: string
  name: string
  params: Record<string, unknown>
  description?: string
}

/** 「執行 Run」的語意：compute = 背景計算（worker / 同步算完）；animate = 固定速度逐步播放（可「跳到結尾」） */
export type RunKind = 'compute' | 'animate'

/** 執行進度：done / total（例如 worker 回報「已完成 3/9 seeds」，或動畫的「第 112/408 步」） */
export interface RunProgress {
  done: number
  total: number
  /** 單位字（預設：animate 顯示「步」、compute 不顯示） */
  unit?: string
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
  /**
   * 「執行 Run」的語意（預設 'compute'）：'animate' 時 Run 鈕旁多一顆「跳到結尾」（需 onSkipToEnd），
   * 手機上按執行就捲到結果區（結果從第一步就在變）；compute 則等結果到了才捲
   */
  runKind?: RunKind
  /** 執行進度：有給就畫確定式進度條（role=progressbar、aria-valuenow）、Run 鈕顯示進度文字；沒給而 running 時畫不確定式 */
  progress?: RunProgress
  /** 「跳到結尾」：停止動畫並直接給出終點的結果；必須和逐步執行共用同一個計算核心 */
  onSkipToEnd?: () => void
}

/** CSV 匯出欄位：欄名 → 數列（可為 typed array；長度可不同，短欄以空白補齊） */
export type CsvCell = number | string | boolean | null | undefined
export type CsvColumns = Record<string, ArrayLike<CsvCell>>
