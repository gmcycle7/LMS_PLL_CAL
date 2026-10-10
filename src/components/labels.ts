import type { CheckStatus, ClaimKind, ModelLevelId, SourceKind } from './types'

/** 規格 §0.1 三層結論標籤文字 */
export const CLAIM_LABEL: Record<ClaimKind, string> = {
  exact: '精確｜指定模型',
  approx: '近似｜需驗證',
  research: '研究假說／延伸',
}

export const CLAIM_DESCRIPTION: Record<ClaimKind, string> = {
  exact: '在條件說明的模型中可代數推導。',
  approx: '獨立性、Gaussian、小誤差、長時間平均或時間尺度分離後的近似。',
  research: '需以 behavioral simulation、SPICE 或實測證明。',
}

/** 規格 §18.4 範例來源 */
export const SOURCE_LABEL: Record<SourceKind, string> = {
  illustrative: 'Illustrative 示例',
  simulation: 'Simulation 模擬',
  literature: 'Literature 文獻',
  measured: 'Measured 量測',
}

export const SOURCE_DESCRIPTION: Record<SourceKind, string> = {
  illustrative: '示例數值，非量測數據；只用於說明概念。',
  simulation: '由本網站的 behavioral simulation 產生（可由 seed 重現）。',
  literature: '取自已發表文獻；請以原文的條件與定義為準。',
  measured: '實際晶片量測數據。',
}

export interface ModelLevelInfo {
  model: string
  timebase: string
  verifies: string
}

/** 規格 §15.1 模型層級表 */
export const MODEL_LEVEL_INFO: Record<ModelLevelId, ModelLevelInfo> = {
  L0: { model: 'Scalar exact LMS / Sign-Error LMS', timebase: '每 Sample', verifies: 'MSE/MAE、固定 x、一步更新' },
  L1: { model: 'Block GMAC + Gaussian Comparator', timebase: '每 Sample + Block', verifies: 'N、μ、統計增益、sample correlation' },
  L2: { model: 'DTC Residue + H_PD / T', timebase: 'Reference / Comparator Clock', verifies: 'Phase Shift、Delay Alignment、Polarity、FCW' },
  L3: { model: 'Multi-Parameter GOS/PHOS/Gain + Jacobian', timebase: 'Sample + Block', verifies: 'PE、Cross-Coupling、SVD、Preconditioner' },
  L4: { model: 'Noise PSD + Output Timing Error + Jitter', timebase: '多速率', verifies: 'Phase Noise、Spur、相干性、Output Transfer' },
  L5: { model: 'Quantized / RTL-like Control', timebase: '精確 clock cycles', verifies: 'overflow、rounding、update latency、limit cycle' },
  L6: { model: 'Advanced reference PLL / DSM / FCW', timebase: 'PLL time step 或 reference events', verifies: '周期性、fractional pattern、仿真與物理模型比對' },
}

/** 模型層級的一句話說明（tooltip / 報告用） */
export function modelLevelText(level: ModelLevelId): string {
  const info = MODEL_LEVEL_INFO[level]
  const scope = level === 'L0' || level === 'L1' || level === 'L2' ? '教學用模型層級' : level === 'L3' ? '多參數模型層級' : '可做架構 sign-off 的模型層級'
  return `${level}｜${info.model}；時間基準：${info.timebase}；驗證：${info.verifies}（${scope}）`
}

export const CHECK_LABEL: Record<CheckStatus, string> = {
  ok: '✓ 一致（ok）',
  mismatch: '✗ 不一致（mismatch）',
  'not-implemented': 'Not implemented',
  'n/a': 'n/a',
}
