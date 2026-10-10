/**
 * Block Sign-LMS JSON Lab（實驗 id 'block-lms-json'）的純函式：JSON 文字驗證／修改、指標、交叉比對、匯出。
 * 不 import React；數值一律來自 runBlockLms / analyzeBlockLms / runBlockLmsMonteCarlo（src/simulation/models/blockLms.ts）。
 */
import type { CheckEntry, CrossCheck, CsvColumns, MetricRow } from '@/components'
import {
  DEFAULT_BLOCK_LMS_CONFIG,
  SPEC_15_3_EXAMPLE,
  parseBlockLmsConfig,
  type BlockLmsAnalytic,
  type BlockLmsConfig,
  type BlockLmsModelLevel,
  type BlockLmsMonteCarloResult,
  type BlockLmsResult,
} from '@/simulation/models/blockLms'
import { texifyModelText } from './modelText'

export const EXPERIMENT_ID = 'block-lms-json'
/** 總樣本數（N × num_blocks）不超過此值時，編輯 JSON 後自動在 worker 重跑 */
export const AUTO_RUN_MAX_SAMPLES = 2 ** 23
/** 上傳 JSON 的大小上限（bytes） */
export const MAX_UPLOAD_BYTES = 1_000_000
/** 圖上每條曲線最多點數（CSV 匯出仍為完整資料） */
export const PLOT_MAX_POINTS = 20_000

export function toJsonText(v: unknown): string {
  return JSON.stringify(v, null, 2)
}

/** 規格 §15.3 範例原文（JSON 文字） */
export const SPEC_EXAMPLE_TEXT = toJsonText(SPEC_15_3_EXAMPLE)
/** 補齊本站擴充欄位後的完整預設設定 */
export const FULL_DEFAULT_TEXT = toJsonText(DEFAULT_BLOCK_LMS_CONFIG)

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 列出「輸入沒寫、由 schema 預設值補上」的欄位（點路徑）。整個物件缺漏時只列該物件本身。
 * 讓使用者清楚知道 §15.3 原文以外的擴充欄位實際用了什麼值（誠實揭露預設）。
 */
export function filledDefaultPaths(input: unknown, output: unknown, prefix = ''): string[] {
  if (!isPlainObject(output)) return []
  const inObj = isPlainObject(input) ? input : {}
  const out: string[] = []
  for (const key of Object.keys(output)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (!(key in inObj)) out.push(path)
    else if (isPlainObject(output[key]) && isPlainObject(inObj[key])) out.push(...filledDefaultPaths(inObj[key], output[key], path))
  }
  return out
}

export interface ConfigValidation {
  ok: boolean
  config: BlockLmsConfig | null
  /** 繁體中文錯誤（parseBlockLmsConfig 原文，「欄位路徑：訊息」） */
  errors: string[]
  /** 由預設值補上的欄位 */
  filled: string[]
  /** N × num_blocks（合法時） */
  totalSamples: number
}

/** 驗證 JSON 文字（zod schema + 中文錯誤）。 */
export function validateConfigText(text: string): ConfigValidation {
  if (text.trim() === '') return { ok: false, config: null, errors: ['（根）：JSON 內容是空的；請載入規格範例或貼上設定'], filled: [], totalSamples: 0 }
  const r = parseBlockLmsConfig(text)
  if (!r.ok || !r.config) return { ok: false, config: null, errors: r.errors, filled: [], totalSamples: 0 }
  let raw: unknown = null
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    raw = null
  }
  return {
    ok: true,
    config: r.config,
    errors: [],
    filled: filledDefaultPaths(raw, r.config),
    totalSamples: r.config.gm_accum_samples * r.config.num_blocks,
  }
}

/**
 * 在 JSON 文字中把 path 設成 value（整個取代該位置；中間物件不存在時建立）。
 * 文字無法解析成物件時回傳 null（UI 此時停用快速控制項）。
 */
export function setConfigPath(text: string, path: string[], value: Json): string | null {
  let root: unknown
  try {
    root = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (!isPlainObject(root) || path.length === 0) return null
  let cur: Record<string, unknown> = root
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]]
    if (!isPlainObject(next)) cur[path[i]] = {}
    cur = cur[path[i]] as Record<string, unknown>
  }
  cur[path[path.length - 1]] = value
  return toJsonText(root)
}

/** 由 preset 的 params 取得 JSON 文字（params.config 為部分設定）。 */
export function presetConfigText(params: Record<string, unknown>): string | null {
  const cfg = params.config
  if (!isPlainObject(cfg)) return null
  return toJsonText(cfg)
}

/** 與 blockLms 內部相同的模型層級判定（L5 > L2 > L1）。 */
export function modelLevelOf(cfg: BlockLmsConfig): BlockLmsModelLevel {
  if (cfg.gain_register.quantize_physical) return 'L5'
  const isDsm = cfg.seeded_pattern.kind === 'dsm_first_order' || cfg.seeded_pattern.kind === 'mash111'
  const nl = cfg.dtc_nonlinearity
  const hasNl = nl.offset_fs !== 0 || nl.c2 !== 0 || nl.c3 !== 0
  if (cfg.pll_error_path.kind !== 'identity' || cfg.regressor_mode !== 'raw' || isDsm || hasNl) return 'L2'
  return 'L1'
}

/** ExperimentShell 的 params（只放小純量，寫入 JSON / 報告） */
export function summarizeParams(cfg: BlockLmsConfig): Record<string, string | number | boolean> {
  return {
    seed: cfg.seed,
    gm_accum_samples: cfg.gm_accum_samples,
    num_blocks: cfg.num_blocks,
    gain_true: cfg.gain_true,
    gain_initial: cfg.gain_initial,
    gain_step: cfg.gain_step,
    gm_mode: cfg.gm_mode,
    pd_noise_rms_fs: cfg.pd_noise_rms_fs,
    comparator_offset_fs: cfg.comparator_offset_fs,
    comparator_encoding: cfg.comparator_encoding,
    code_normalization: cfg.code_normalization,
    regressor_mode: cfg.regressor_mode,
    gm_code_delay_samples: cfg.gm_code_delay_samples,
    cal_update_delay_blocks: cfg.cal_update_delay_blocks,
    pll_error_path: cfg.pll_error_path.kind,
    seeded_pattern: cfg.seeded_pattern.kind,
    quantize_physical: cfg.gain_register.quantize_physical,
    sample_rate_hz: cfg.sample_rate_hz,
  }
}

export const PARAM_UNITS: Record<string, string> = {
  gain_true: 'fs per unit code',
  gain_initial: 'fs per unit code',
  gain_step: 'fs（average 模式；sum 模式為 fs per unit S）',
  pd_noise_rms_fs: 'fs',
  comparator_offset_fs: 'fs',
  gm_accum_samples: 'samples',
  num_blocks: 'blocks',
  gm_code_delay_samples: 'samples',
  cal_update_delay_blocks: 'blocks',
  sample_rate_hz: 'Hz',
}

// ───────────────────────────────────────────────────────────────────────────
// 穩態統計（後半段 blocks）
// ───────────────────────────────────────────────────────────────────────────

export interface TailStats {
  /** 後半段樣本數 m */
  m: number
  /** lag-1 自相關 ρ̂（夾在 (−0.99, 0.999)） */
  rho1: number
  /** 平均值的標準誤（AR(1) 有效樣本數修正）[fs] */
  seMean: number
  /** 樣本標準差的相對標準誤（AR(1) 近似） */
  relSeStd: number
}

// #region core:ar1StandardError
/** AR(1) 序列的有效樣本數（估計平均用）：N_eff = m(1 − ρ)/(1 + ρ)（F-15.12；m ≫ 1/(1 − ρ) 時成立） */
export function ar1EffectiveSamples(m: number, rho: number): number {
  return (m * (1 - rho)) / (1 + rho)
}

/** 平均值的標準誤 SE = s/√N_eff = s·√((1 + ρ)/((1 − ρ)m))（s 為樣本標準差） */
export function ar1SeMean(s: number, rho: number, m: number): number {
  return s * Math.sqrt((1 + rho) / ((1 - rho) * m))
}

/** 樣本標準差的相對標準誤（Gaussian AR(1) 近似）：√((1 + ρ²)/(2m(1 − ρ²))) */
export function ar1RelSeStd(rho: number, m: number): number {
  return Math.sqrt((1 + rho * rho) / (2 * m * (1 - rho * rho)))
}
// #endregion

/**
 * 後半段 w 的統計誤差：把 w 視為 AR(1)（一階 LMS 的 δ 正是 AR(1)，ρ = p），
 *   SE(mean) ≈ s·√((1+ρ)/((1−ρ)m))，relSE(s) ≈ √((1+ρ²)/(2m(1−ρ²)))。ρ 用資料的 lag-1 自相關估計。
 */
export function tailStats(w: ArrayLike<number>): TailStats {
  const K = w.length - 1
  const h0 = Math.ceil((K + 1) / 2)
  const m = K + 1 - h0
  if (m < 3) return { m, rho1: NaN, seMean: NaN, relSeStd: NaN }
  let mean = 0
  for (let i = h0; i <= K; i++) mean += w[i]
  mean /= m
  let c0 = 0
  let c1 = 0
  for (let i = h0; i <= K; i++) {
    const d = w[i] - mean
    c0 += d * d
    if (i > h0) c1 += d * (w[i - 1] - mean)
  }
  if (!(c0 > 0) || !Number.isFinite(c0)) return { m, rho1: NaN, seMean: 0, relSeStd: NaN }
  const rho = Math.min(0.999, Math.max(-0.99, c1 / c0))
  const s = Math.sqrt(c0 / (m - 1))
  return { m, rho1: rho, seMean: ar1SeMean(s, rho, m), relSeStd: ar1RelSeStd(rho, m) }
}

function fin(v: number): boolean {
  return Number.isFinite(v)
}

/** MetricTable 列（模擬值 vs 解析值；容忍度依 AR(1) 標準誤，4σ） */
export function buildMetricRows(res: BlockLmsResult): MetricRow[] {
  const { metrics: m, analytic: an, config: cfg } = res
  const ts = tailStats(res.blocks.w)
  const qz = cfg.gain_register.quantize_physical
  const lsb = cfg.gain_register.lsb_fs
  const meanTol = fin(ts.seMean) ? 4 * ts.seMean + (qz ? lsb : 0) : undefined
  const analyticUsable = !m.diverged && an.stableMean && cfg.pd_noise_rms_fs > 0
  const rows: MetricRow[] = [
    {
      name: '平均 $w$（後半段 blocks）',
      value: m.meanW,
      unit: 'fs',
      formulaId: 'F-15.7',
      claim: 'approx',
      analytic: analyticUsable && fin(an.wStarMeanField) ? an.wStarMeanField : undefined,
      tolerance: analyticUsable && meanTol !== undefined && fin(an.wStarMeanField) ? meanTol : undefined,
      note: '解析值為 mean-field 固定點 $w^*$；容忍度為 4 倍 SE（SE 以 AR(1) 有效樣本數估計）',
    },
    {
      name: 'bias：平均 $w-a$',
      value: m.bias,
      unit: 'fs',
      claim: 'approx',
      analytic: analyticUsable && fin(m.biasPred) ? m.biasPred : undefined,
      tolerance: analyticUsable && meanTol !== undefined && fin(m.biasPred) ? meanTol : undefined,
      note: 'GMAC 歸零不代表 DTC 誤差為零（規格 §11）；$\\delta=a-w$ 的極性下 bias $=-\\bar\\delta$',
    },
    {
      name: '$\\sigma_w$：後半段 $w$ 標準差',
      value: m.stdW,
      unit: 'fs',
      formulaId: 'F-15.5',
      claim: 'approx',
      analytic: analyticUsable && fin(an.sigmaWPred) && an.sigmaWPred > 0 ? an.sigmaWPred : undefined,
      tolerance: analyticUsable && fin(an.sigmaWPred) && fin(ts.relSeStd) ? Math.max(0.05, 4 * ts.relSeStd) : undefined,
      toleranceMode: 'rel',
      note: '解析值為線性化 $\\sigma_w$（GMAC 雜訊 iid、小訊號 $K_q$）；它是 gain-equivalent 雜訊，不是 output jitter',
    },
    { name: 'MSE：$\\overline{(w-a)^2}$（後半段）', value: m.mse, unit: 'fs²', claim: 'approx' },
    { name: 'settling block（落入 $4\\sigma$ 帶）', value: m.settlingBlock === null ? '未收斂（null）' : m.settlingBlock, unit: 'block' },
    { name: '平均 $G$（全部 blocks）', value: m.meanG, unit: cfg.gm_mode === 'average' ? '無因次（average）' : '無因次（sum）' },
    { name: 'saturation 次數', value: m.saturationCount, unit: '次' },
    { name: 'wrap 次數', value: m.wrapCount, unit: '次' },
    {
      name: '實體 code limit-cycle 週期',
      value: qz ? (m.limitCyclePeriod > 0 ? m.limitCyclePeriod : '無週期') : 'n/a（未啟用 quantize_physical）',
      unit: qz ? 'block' : undefined,
    },
    { name: '實體 code toggle 次數（後半段）', value: qz ? m.limitCycleCount : 'n/a', unit: qz ? '次' : undefined },
    { name: '發散', value: m.diverged ? `是（block ${m.divergenceBlock ?? '?'}）` : '否' },
  ]
  return rows
}

export interface AnalyticRow {
  key: string
  label: string
  /** 公式（TeX） */
  tex: string
  value: number | string
  unit: string
  claim: 'exact' | 'approx'
  note?: string
}

/** 解析區塊（BlockLmsAnalytic 的每個量 + 公式 + 單位 + 標籤） */
export function analyticRows(an: BlockLmsAnalytic, cfg: BlockLmsConfig): AnalyticRow[] {
  const d = cfg.cal_update_delay_blocks
  const sum = cfg.gm_mode === 'sum'
  const bug = cfg.comparator_encoding === 'unipolar_unmapped_bug'
  return [
    { key: 'Kq', label: 'Comparator 小訊號增益', tex: String.raw`K_q=\sqrt{2/\pi}\,/\,\sigma_v`, value: an.Kq, unit: '$\\mathrm{fs}^{-1}$', claim: 'approx', note: '$|e_\\mathrm{det}|\\ll\\sigma_v$ 時成立；$\\sigma_v=0$ 時無定義' },
    { key: 'C', label: '有效相關', tex: String.raw`C=E[x_\mathrm{ref}\,u],\;u=H_\mathrm{PD}\{x\}`, value: an.Cest, unit: '無因次', claim: 'exact', note: `由 ${an.statsSamples} 個 code 樣本估計（有限樣本）` },
    {
      key: 'K',
      label: '平均 GMAC 斜率',
      tex: bug ? String.raw`K=\tfrac12 K_qC\;(\text{0/1 bug})` : String.raw`K=K_qC=-\partial E[G]/\partial w`,
      value: an.K,
      unit: '$\\mathrm{fs}^{-1}$',
      claim: 'approx',
    },
    { key: 'g', label: '無因次 loop gain', tex: sum ? String.raw`g=\mu K N\;(\text{sum})` : String.raw`g=\mu K`, value: an.g, unit: '—', claim: 'approx' },
    { key: 'p', label: '一階 pole', tex: String.raw`p=1-g`, value: an.p, unit: '—', claim: 'exact', note: '$d=0$ 的平均模型' },
    { key: 'rho', label: '平均模型 spectral radius', tex: String.raw`\rho=\max|z|:\;z^{d+1}-z^{d}+g=0`, value: an.rhoMean, unit: '—', claim: 'exact', note: `$d=${d}$；$\\rho<1$ 等價於平均誤差收斂` },
    { key: 'gCritical', label: '臨界增益', tex: String.raw`g_\mathrm{crit}=2\sin\!\frac{\pi}{4d+2}`, value: an.gCritical, unit: '—', claim: 'exact' },
    { key: 'pmDeg', label: 'Calibration PM', tex: String.raw`\mathrm{PM}=90^\circ-(2d+1)\arcsin(g/2)`, value: an.pmDeg, unit: 'deg', claim: 'exact', note: '$0<g\\le2$ 才定義' },
    { key: 'sigmaEta2', label: '每 block GMAC 雜訊變異數', tex: sum ? String.raw`\sigma_\eta^2\approx N\,E[x_\mathrm{ref}^2]` : String.raw`\sigma_\eta^2\approx E[x_\mathrm{ref}^2]/N`, value: an.sigmaEta2, unit: '$[G]^2$', claim: 'approx', note: 'iid、近平衡（$E[G]=E[q\\,x_\\mathrm{ref}]\\approx0$）' },
    { key: 'sigmaWPred', label: '穩態 $\\sigma_w$ 預測', tex: String.raw`\sigma_w=|\mu|\sqrt{\sigma_\eta^2\textstyle\sum_k h_k^2}\;\overset{d=0}{=}\;\frac{|\mu|\sigma_\eta}{\sqrt{1-p^2}}`, value: an.sigmaWPred, unit: 'fs', claim: 'approx' },
    { key: 'fuHz', label: 'Block update rate', tex: String.raw`f_u=f_s/N`, value: an.fuHz, unit: 'Hz', claim: 'exact' },
    { key: 'f3dbHz', label: '$-3\\,\\mathrm{dB}$ 頻寬（exact，$d=0$）', tex: String.raw`f_\mathrm{3dB}=\frac{f_u}{2\pi}\arccos\!\Bigl(1-\frac{(1-p)^2}{2p}\Bigr)`, value: an.f3dbHz, unit: 'Hz', claim: 'exact', note: '$p<3-2\\sqrt2$ 時不存在（E27）；不是 Noise BW（E06）' },
    { key: 'enbwHz', label: 'One-sided ENBW（$d=0$）', tex: String.raw`\mathrm{ENBW}=\frac{f_u(1-p)}{2(1+p)}`, value: an.enbwHz, unit: 'Hz', claim: 'exact', note: '$\\sigma_w^2=S_w^{(1)}(0)\\cdot\\mathrm{ENBW}$（E06）' },
    { key: 'tauBlocks', label: '時間常數', tex: String.raw`\tau=-1/\ln\rho`, value: an.tauBlocks, unit: 'blocks', claim: 'exact' },
    {
      key: 'wStarLinear',
      label: '線性化固定點',
      tex: String.raw`w^*_\mathrm{lin}=a+\frac{E[x_\mathrm{ref}\,H\{\mathrm{nl}\}]+b\,E[x_\mathrm{ref}]}{C}`,
      value: an.wStarLinear,
      unit: 'fs',
      claim: 'approx',
      note: 'MSE 型線性化（規格 §11）；DC null 架構不適用（E03）',
    },
    {
      key: 'wStarMeanField',
      label: 'Mean-field 固定點',
      tex: String.raw`\textstyle\sum_n x_\mathrm{ref}[n]\bigl(2\Phi(e_n(w^*)/\sigma_v)-1\bigr)=0`,
      value: an.wStarMeanField,
      unit: 'fs',
      claim: 'approx',
      note: 'Gaussian $v$、凍結 $w$、此 code 序列的精確平均；仍忽略 $w$ 的波動',
    },
    {
      key: 'slopeMeanField',
      label: 'Mean-field 斜率（恢復力）',
      tex: String.raw`K_\mathrm{mf}=-\partial E[G]/\partial w\,\big|_{w^*}=-S_\mathrm{GMAC}`,
      value: an.slopeMeanField,
      unit: '$\\mathrm{fs}^{-1}$',
      claim: 'approx',
      note: '$K_\\mathrm{mf}>0$ 才有恢復力，也就是規格 §15.4 的 $S=\\partial G/\\partial w<0$；小訊號、無 bias 時 $K_\\mathrm{mf}\\to K$',
    },
    { key: 'gMeanField', label: 'Mean-field loop gain', tex: sum ? String.raw`g_\mathrm{mf}=\mu K_\mathrm{mf}N\;(\text{sum})` : String.raw`g_\mathrm{mf}=\mu K_\mathrm{mf}`, value: an.gMeanField, unit: '—', claim: 'approx' },
    { key: 'Ex', label: 'code 平均', tex: String.raw`E[x]`, value: an.Ex, unit: '無因次', claim: 'exact' },
    { key: 'Ex2', label: 'code 均方', tex: String.raw`E[x^2]`, value: an.Ex2, unit: '無因次', claim: 'exact' },
    { key: 'ExRef', label: '$x_\\mathrm{ref}$ 平均', tex: String.raw`E[x_\mathrm{ref}]`, value: an.ExRef, unit: '無因次', claim: 'exact' },
    { key: 'ExRef2', label: '$x_\\mathrm{ref}$ 均方', tex: String.raw`E[x_\mathrm{ref}^2]`, value: an.ExRef2, unit: '無因次', claim: 'exact' },
    {
      key: 'normalization',
      label: 'code 正規化',
      tex: String.raw`x=(x_\mathrm{raw}-o)\cdot s`,
      value: `${an.normalization.mode}：offset ${fmtNum(an.normalization.offset)}、scale ${fmtNum(an.normalization.scale)}`,
      unit: '—',
      claim: 'exact',
    },
  ]
}

/** 顯示用數字（非有限顯示 NaN/∞ 字樣，避免把 NaN 當 0） */
export function fmtNum(v: number, digits = 6): string {
  if (Number.isNaN(v)) return 'NaN（未定義）'
  if (v === Infinity) return '∞'
  if (v === -Infinity) return '−∞'
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-4) return v.toExponential(digits - 1)
  return String(Number(v.toPrecision(digits)))
}

/** fmtNum 的 TeX 版本（放在 `$...$` 內）：科學記號轉成 a×10^{n}，非有限值包成 \\text{…} */
export function texNumber(v: number, digits = 6): string {
  const s = fmtNum(v, digits)
  if (!Number.isFinite(v)) return `\\text{${s}}`
  const m = /^(-?[\d.]+)e([+-]\d+)$/.exec(s)
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : s
}

function entry(status: CheckEntry['status'], note: string): CheckEntry {
  return { status, note }
}

/**
 * Analytic / Monte Carlo / Fixed-Point 交叉比對（誠實：沒算就是 not-implemented，不適用就是 n/a）。
 * @param mc  runBlockLmsMonteCarlo 的結果（同一設定；尚未執行為 null）
 * @param twin quantize_physical = true 時，同 seed 的理想浮點對照（尚未執行為 null）
 */
export function crossCheckOf(res: BlockLmsResult, mc: BlockLmsMonteCarloResult | null, twin: BlockLmsResult | null): CrossCheck {
  const { metrics: m, analytic: an, config: cfg } = res
  const ts = tailStats(res.blocks.w)
  const qz = cfg.gain_register.quantize_physical
  const lsb = cfg.gain_register.lsb_fs

  let analytic: CheckEntry
  if (m.diverged) analytic = entry('n/a', '模擬發散：解析穩態預測不適用')
  else if (cfg.pd_noise_rms_fs === 0) analytic = entry('n/a', '$\\sigma_v=0$：$K_q$ 無定義，小訊號解析式不適用')
  else if (!an.stableMean) analytic = entry('n/a', `線性化平均模型不穩定（$\\rho=${texNumber(an.rhoMean, 4)}\\ge1$）：沒有可比較的穩態`)
  else if (!fin(an.wStarMeanField) || !fin(an.sigmaWPred) || !fin(ts.seMean)) analytic = entry('n/a', '解析固定點或 $\\sigma_w$ 未定義（見 analytic 區塊的 NaN 說明）')
  else {
    const tolMean = 4 * ts.seMean + (qz ? lsb : 0)
    const dMean = m.meanW - an.wStarMeanField
    const ratio = m.stdW / an.sigmaWPred
    const tolStd = Math.max(0.05, 4 * ts.relSeStd)
    const okMean = Math.abs(dMean) <= tolMean
    const okStd = Math.abs(ratio - 1) <= tolStd || qz
    const note = `平均 $w-w^*=${texNumber(dMean, 3)}$ fs（容忍 $\\pm${texNumber(tolMean, 3)}$）；$\\sigma_w$ 模擬／預測 $=${texNumber(ratio, 3)}$（容忍 $\\pm${texNumber(100 * tolStd, 2)}\\%$${qz ? '；L5 量化時不比較 $\\sigma_w$' : ''}）`
    analytic = entry(okMean && okStd ? 'ok' : 'mismatch', note)
  }

  let monteCarlo: CheckEntry
  if (!mc) monteCarlo = entry('not-implemented', '尚未執行：按「Monte Carlo（8 seeds）」取得多 seed 95% CI')
  else if (mc.perRun.diverged > 0) monteCarlo = entry('n/a', `${mc.perRun.diverged}/${mc.seeds.length} 個 seed 發散：CI 無意義`)
  else if (!fin(an.wStarMeanField)) monteCarlo = entry('n/a', 'mean-field 固定點未定義，無解析值可比')
  else {
    const slack = qz ? lsb / 2 : 0
    const inside = an.wStarMeanField >= mc.meanW.lo - slack && an.wStarMeanField <= mc.meanW.hi + slack
    monteCarlo = entry(
      inside ? 'ok' : 'mismatch',
      `${mc.seeds.length} seeds：平均 $w$ 的 95% CI 為 $[${texNumber(mc.meanW.lo, 5)},\\,${texNumber(mc.meanW.hi, 5)}]$ fs，$w^*=${texNumber(an.wStarMeanField, 6)}$ fs${inside ? ' 落在 CI 內' : ' 不在 CI 內'}`,
    )
  }

  let fixedPoint: CheckEntry
  if (!qz) fixedPoint = entry('n/a', 'quantize_physical = false：本次為理想浮點模型（L1/L2），沒有定點對照')
  else if (!twin) fixedPoint = entry('not-implemented', '尚未計算同 seed 的浮點對照')
  else if (twin.metrics.diverged || m.diverged) fixedPoint = entry('n/a', '定點或浮點模擬發散')
  else {
    const tsT = tailStats(twin.blocks.w)
    const d = m.meanWPhys - twin.metrics.meanW
    const tol = Math.max(lsb, 4 * (fin(tsT.seMean) ? tsT.seMean : 0))
    fixedPoint = entry(
      Math.abs(d) <= tol ? 'ok' : 'mismatch',
      `實體 code 平均減去浮點平均為 $${texNumber(d, 4)}$ fs（容忍 $\\pm${texNumber(tol, 3)}$ fs，取 1 LSB 與 4 倍 SE 的較大者）${Math.abs(d) <= tol ? '' : '：量化／飽和／wrap 造成的偏差'}`,
    )
  }
  return { analytic, monteCarlo, fixedPoint }
}

/** JSON Lab 另外寫在「假設」區的三件事（本頁的顯示與統計方式，不是模型假設） */
export const PAGE_ASSUMPTIONS = [
  '頁面顯示的核心程式碼（core:blockLmsBlockLoop 等）與 worker 中執行的 runBlockLms 是同一份原始碼',
  '圖上曲線最多抽樣 20000 點顯示；CSV 匯出為完整資料',
  '統計（平均、標準差、SE）只用後半段 blocks；SE 以 AR(1) 有效樣本數近似（F-15.12）',
]

/**
 * ExperimentShell 的 warnings：模型（blockLms.ts）的警告逐句換成 `$...$` 版本（modelText.ts），再加上本頁的補充。
 * 補充：sum 模式只要啟用，模型就會發出「有效增益放大 N 倍…需改為 μ/N」的提醒——即使目前的 μ 已經除過 N。
 * 這時（g 在穩定範圍內）加一句說明，避免讀者把已經縮放過的 μ 再除一次。
 */
export function labWarnings(res: BlockLmsResult | null, runError: string | null = null): string[] {
  const out = res ? res.warnings.map(texifyModelText) : []
  if (res && res.config.gm_mode === 'sum' && res.analytic.stableMean && res.analytic.g > 0) {
    out.push(
      `目前的 $\\mu=${texNumber(res.config.gain_step, 4)}$ fs 在 sum 模式下 $g=${texNumber(res.analytic.g, 4)}$，已在穩定範圍 $(0,\\,${texNumber(res.analytic.gCritical, 4)})$ 內：上一句只是提醒 sum 模式的 scaling。如果這個 $\\mu$ 本來就是 average 的值除以 $N$（例如 preset「sum GMAC + $\\mu/N$」），不必再除一次。`,
    )
  }
  if (runError) out.push(`模擬失敗：${runError}`)
  return out
}

/** ExperimentShell 的 assumptions：模型的假設（換成 `$...$` 版本）＋ 本頁的顯示／統計方式 */
export function labAssumptions(res: BlockLmsResult | null): string[] {
  return res ? [...res.assumptions.map(texifyModelText), ...PAGE_ASSUMPTIONS] : PAGE_ASSUMPTIONS
}

/** CSV 欄位：k、w、wPhys、G（G 比 w 少一筆，CSV 以空白補齊） */
export function exportColumns(res: BlockLmsResult): CsvColumns {
  const K = res.blocks.G.length
  return {
    k: Array.from({ length: K + 1 }, (_, i) => i),
    w_fs: res.blocks.w,
    w_phys_fs: res.blocks.wPhys,
    G: res.blocks.G,
  }
}

/** 等間隔抽點（含最後一點）；用於繪圖，不用於統計 */
export function decimate(y: ArrayLike<number>, maxPts = PLOT_MAX_POINTS, x0 = 0): { x: number[]; y: number[] } {
  const n = y.length
  const stride = Math.max(1, Math.ceil(n / maxPts))
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < n; i += stride) {
    xs.push(x0 + i)
    ys.push(y[i])
  }
  if (n > 0 && (n - 1) % stride !== 0) {
    xs.push(x0 + n - 1)
    ys.push(y[n - 1])
  }
  return { x: xs, y: ys }
}

/** 一行摘要的 `$...$` 版本（圖說等 HTML 文字用；Plotly 圖例仍用 shortLabel） */
export function shortLabelTex(cfg: BlockLmsConfig): string {
  const parts = [
    `$\\mu=${texNumber(cfg.gain_step, 4)}$`,
    `$N=${cfg.gm_accum_samples}$`,
    cfg.gm_mode,
    cfg.regressor_mode === 'raw' ? 'raw' : `${cfg.regressor_mode} $D=${cfg.gm_code_delay_samples}$`,
  ]
  if (cfg.cal_update_delay_blocks > 0) parts.push(`$d=${cfg.cal_update_delay_blocks}$`)
  if (cfg.pll_error_path.kind !== 'identity') parts.push(cfg.pll_error_path.kind)
  if (cfg.gain_register.quantize_physical) parts.push('L5')
  return parts.join(' · ')
}

/** 一行摘要（釘選比較曲線的標籤） */
export function shortLabel(cfg: BlockLmsConfig): string {
  const parts = [
    `μ=${fmtNum(cfg.gain_step, 4)}`,
    `N=${cfg.gm_accum_samples}`,
    cfg.gm_mode,
    cfg.regressor_mode === 'raw' ? 'raw' : `${cfg.regressor_mode} D=${cfg.gm_code_delay_samples}`,
  ]
  if (cfg.cal_update_delay_blocks > 0) parts.push(`d=${cfg.cal_update_delay_blocks}`)
  if (cfg.pll_error_path.kind !== 'identity') parts.push(cfg.pll_error_path.kind)
  if (cfg.gain_register.quantize_physical) parts.push('L5')
  return parts.join(' · ')
}

/** 後半段 w 的直方圖與 N(w*, σ_w²) 理論曲線（密度，1/fs） */
export function tailHistogram(
  w: ArrayLike<number>,
  center: number,
  sigma: number,
  bins = 40,
): { centers: number[]; density: number[]; gauss: number[] } | null {
  const K = w.length - 1
  const h0 = Math.ceil((K + 1) / 2)
  const vals: number[] = []
  for (let i = h0; i <= K; i++) if (Number.isFinite(w[i])) vals.push(w[i])
  if (vals.length < 20 || !(sigma > 0) || !Number.isFinite(center)) return null
  let lo = center - 4 * sigma
  let hi = center + 4 * sigma
  for (const v of vals) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!(hi > lo)) return null
  const width = (hi - lo) / bins
  const counts = new Array<number>(bins).fill(0)
  for (const v of vals) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)))]++
  const centers = counts.map((_, i) => lo + (i + 0.5) * width)
  const density = counts.map((c) => c / (vals.length * width))
  const gauss = centers.map((c) => Math.exp(-0.5 * ((c - center) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI)))
  return { centers, density, gauss }
}
