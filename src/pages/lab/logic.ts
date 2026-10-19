/**
 * Unified Calibration Lab 頁的純邏輯（不含 React）：
 *   preset / 參數的檢查與補值、警告彙整、交叉比對對應、CSV 欄位、完整報告 JSON、PSD → ℒ(f) 換算、sweep / MC 摘要。
 * 所有數值都來自 src/simulation/models/unifiedLab.ts 的結果；這裡不產生任何「資料」，只整理與判讀。
 */
import type { CheckEntry, CrossCheck, CsvColumns, MetricRow } from '@/components'
import { fsToRad, meanCI } from '@/simulation/core'
import { psdToDbcHz } from '@/simulation/signal'
import {
  DEFAULT_LAB_PARAMS,
  DEFAULT_SWEEP_OPTIONS,
  DEFAULT_TRAINING_PATTERN,
  LAB_RANGES,
  STAGE_TITLES,
  UNIFIED_LAB_VERSION,
  ar1MeanVar,
  combineChecks,
  labParamErrors,
  texNum,
  type CheckItem,
  type FcwPoint,
  type FcwSweepOptions,
  type LabParams,
  type McChunk,
  type McSummary,
  type PipelineResult,
  type TrainingParams,
  type TrainingPatternSpec,
  type TrainingResult,
} from '@/simulation/models/unifiedLab'

/* ------------------------------------------------------------------ */
/* 實驗 ID 與分頁                                                      */
/* ------------------------------------------------------------------ */

export const EXP = {
  pipeline: 'unified-lab',
  fcw: 'unified-lab-fcw',
  mc: 'unified-lab-mc',
  training: 'training-sequence-lab',
  compare: 'unified-lab-compare',
} as const

export type TabId = keyof typeof EXP
export const TAB_ORDER: TabId[] = ['pipeline', 'fcw', 'mc', 'training', 'compare']
export const TAB_LABEL: Record<TabId, string> = {
  pipeline: 'Pipeline（完整 trace 與報告）',
  fcw: 'FCW sweep',
  mc: 'Monte Carlo',
  training: 'Training Sequence Lab',
  compare: 'Compare A / B / C',
}

export function tabOfExperiment(experiment: string | undefined): TabId | null {
  if (!experiment) return null
  return (Object.keys(EXP) as TabId[]).find((t) => EXP[t] === experiment) ?? null
}

/** 自動重跑的 sample 數上限（N × blocks）；超過時要手動按 Run。 */
export const AUTO_RUN_MAX_SAMPLES = 2 ** 23 + 2 ** 20

/* ------------------------------------------------------------------ */
/* 參數補值與檢查                                                      */
/* ------------------------------------------------------------------ */

const ENUMS: { [K in 'codeSource' | 'normalization' | 'pll' | 'encoding' | 'gmMode' | 'regressor' | 'rounding' | 'overflow']: readonly LabParams[K][] } = {
  codeSource: ['dsm_first_order', 'mash111', 'iid_pm_one'],
  normalization: ['none', 'zero_mean', 'unit_rms', 'standardize'],
  pll: ['none', 'type1', 'type2'],
  encoding: ['bipolar_pm_one', 'unipolar_mapped', 'unipolar_unmapped_bug'],
  gmMode: ['average', 'sum'],
  regressor: ['raw', 'delayed', 'filtered'],
  rounding: ['nearest', 'truncate', 'stochastic'],
  overflow: ['saturate', 'wrap'],
}
const BOOLS = ['dither', 'quantize', 'signedReg'] as const

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * 把來源不明的物件（preset JSON、URL）補成完整的 LabParams：
 * 認得且型別正確的欄位覆寫 base，其餘保留 base；每個被忽略的欄位都回報原因（不默默吞掉）。
 * 範圍檢查留給 labParamErrors（超出範圍的數字會保留，並在實驗框以警告說明）。
 */
export function sanitizeLabParams(raw: unknown, base: LabParams = DEFAULT_LAB_PARAMS): { params: LabParams; issues: string[] } {
  const out: LabParams = { ...base }
  const issues: string[] = []
  if (raw === undefined || raw === null) return { params: out, issues }
  if (!isObj(raw)) return { params: out, issues: ['參數不是物件：已使用預設值'] }
  const rec = out as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'seed') {
      if (isNum(v) && Number.isInteger(v) && v >= 0 && v <= 0xffffffff) out.seed = v
      else issues.push(`seed = ${JSON.stringify(v)} 不是 0–4294967295 的整數：已忽略`)
    } else if (k in LAB_RANGES) {
      if (isNum(v)) rec[k] = v
      else issues.push(`${k} = ${JSON.stringify(v)} 不是有限數：已忽略`)
    } else if (k in ENUMS) {
      const allowed = ENUMS[k as keyof typeof ENUMS] as readonly string[]
      if (typeof v === 'string' && allowed.includes(v)) rec[k] = v
      else issues.push(`${k} = ${JSON.stringify(v)} 不是合法選項（${allowed.join(' / ')}）：已忽略`)
    } else if ((BOOLS as readonly string[]).includes(k)) {
      if (typeof v === 'boolean') rec[k] = v
      else issues.push(`${k} = ${JSON.stringify(v)} 不是 true / false：已忽略`)
    } else {
      issues.push(`未知欄位 ${k}：已忽略`)
    }
  }
  return { params: out, issues }
}

/** 參數的比對 key（同 key ⇒ 同一次模擬的結果可以直接沿用） */
export function labKey(p: LabParams): string {
  return JSON.stringify(p)
}

/* ---------- FCW sweep ---------- */

export interface SweepGrid {
  min: number
  max: number
  points: number
  scale: 'log' | 'linear'
}

export const DEFAULT_SWEEP_GRID: SweepGrid = { min: 1e-5, max: 0.5, points: 25, scale: 'log' }

export const SWEEP_RANGES = {
  min: { min: 1e-7, max: 0.5 },
  max: { min: 1e-6, max: 0.999999 },
  points: { min: 2, max: 200 },
  loopBlocks: { min: 20, max: 5000 },
  slopeBlocks: { min: 4, max: 512 },
  deltaFs: { min: 0.01, max: 1000 },
  residualGainFs: { min: 0, max: 100 },
} as const

export function sweepErrors(g: SweepGrid, o: FcwSweepOptions, base: LabParams): string[] {
  const err: string[] = []
  const inR = (v: number, r: { min: number; max: number }) => Number.isFinite(v) && v >= r.min && v <= r.max
  if (!inR(g.min, SWEEP_RANGES.min)) err.push(`sweep 下限 $\\alpha_{\\min}=${texNum(g.min)}$ 超出 $[10^{-7},\\,0.5]$`)
  if (!inR(g.max, SWEEP_RANGES.max)) err.push(`sweep 上限 $\\alpha_{\\max}=${texNum(g.max)}$ 超出 $[10^{-6},\\,0.999999]$`)
  if (!(g.max > g.min)) err.push('sweep 上限必須大於下限')
  if (!(Number.isInteger(g.points) && inR(g.points, SWEEP_RANGES.points))) err.push('sweep 點數必須是 2–200 的整數')
  if (!(Number.isInteger(o.loopBlocks) && inR(o.loopBlocks, SWEEP_RANGES.loopBlocks))) err.push('每點閉迴路 block 數必須是 20–5000 的整數')
  if (!(Number.isInteger(o.slopeBlocks) && inR(o.slopeBlocks, SWEEP_RANGES.slopeBlocks))) err.push('斜率量測 block 數必須是 4–512 的整數')
  if (!inR(o.deltaFs, SWEEP_RANGES.deltaFs)) err.push('$\\Delta w$ 必須在 $[0.01,\\,1000]$ fs')
  if (!inR(o.residualGainFs, SWEEP_RANGES.residualGainFs)) err.push('殘餘 gain 誤差 $\\Delta a$ 必須在 $[0,\\,100]$ fs')
  if (base.codeSource === 'iid_pm_one') err.push('code 來源是 iid $\\pm1$（不是 DSM）：FCW 不影響 code，sweep 沒有意義。請改成一階 DSM 或 MASH 1-1-1。')
  // 與 worker 內相同的檢查（frac 會被 sweep 覆寫，blocks 用 loopBlocks）
  for (const e of labParamErrors({ ...base, blocks: Math.max(base.blocks, o.loopBlocks), outBlocks: Math.min(base.outBlocks, o.loopBlocks) })) err.push(e)
  return err
}

export function sanitizeSweepPreset(raw: unknown): { base: LabParams; grid: SweepGrid; opts: FcwSweepOptions; issues: string[] } {
  const r = isObj(raw) ? raw : {}
  const b = sanitizeLabParams(r.base, { ...DEFAULT_LAB_PARAMS, codeSource: 'dsm_first_order' })
  const issues = b.issues.map((i) => `base.${i}`)
  const grid: SweepGrid = { ...DEFAULT_SWEEP_GRID }
  if (isObj(r.grid)) {
    if (isNum(r.grid.min)) grid.min = r.grid.min
    if (isNum(r.grid.max)) grid.max = r.grid.max
    if (isNum(r.grid.points)) grid.points = Math.round(r.grid.points)
    if (r.grid.scale === 'log' || r.grid.scale === 'linear') grid.scale = r.grid.scale
  }
  const opts: FcwSweepOptions = { ...DEFAULT_SWEEP_OPTIONS }
  if (isObj(r.opts)) {
    if (typeof r.opts.closedLoop === 'boolean') opts.closedLoop = r.opts.closedLoop
    if (typeof r.opts.slopeMc === 'boolean') opts.slopeMc = r.opts.slopeMc
    if (isNum(r.opts.loopBlocks)) opts.loopBlocks = Math.round(r.opts.loopBlocks)
    if (isNum(r.opts.slopeBlocks)) opts.slopeBlocks = Math.round(r.opts.slopeBlocks)
    if (isNum(r.opts.deltaFs)) opts.deltaFs = r.opts.deltaFs
    if (isNum(r.opts.residualGainFs)) opts.residualGainFs = r.opts.residualGainFs
  }
  return { base: b.params, grid, opts, issues }
}

/* ---------- Monte Carlo ---------- */

export const MC_RUN_RANGE = { min: 2, max: 256 } as const

export function sanitizeMcPreset(raw: unknown): { base: LabParams; runs: number; issues: string[] } {
  const r = isObj(raw) ? raw : {}
  const b = sanitizeLabParams(r.base)
  const runs = isNum(r.runs) ? Math.min(MC_RUN_RANGE.max, Math.max(MC_RUN_RANGE.min, Math.round(r.runs))) : 16
  return { base: b.params, runs, issues: b.issues.map((i) => `base.${i}`) }
}

/* ---------- Training ---------- */

export type TrainingShared = Omit<TrainingParams, 'patterns'>

export const DEFAULT_TRAINING_SHARED: TrainingShared = {
  seed: DEFAULT_LAB_PARAMS.seed,
  fRefHz: DEFAULT_LAB_PARAMS.fRefHz,
  nInt: DEFAULT_LAB_PARAMS.nInt,
  pll: DEFAULT_LAB_PARAMS.pll,
  pllBwHz: DEFAULT_LAB_PARAMS.pllBwHz,
  zeta: DEFAULT_LAB_PARAMS.zeta,
  loopDelay: DEFAULT_LAB_PARAMS.loopDelay,
  regressor: 'raw',
  codeDelay: 0,
  sigmaV: DEFAULT_LAB_PARAMS.sigmaV,
  length: 1 << 17,
  N0: 4096,
  maxLag: 128,
  maxDelay: 96,
  residualGainFs: 0.1,
  c2: 0.05,
  c3: 0.02,
  basis: { gain: true, inl2: true, inl3: false, offset: true },
}

export const TRAINING_RANGES = {
  log2Length: { min: 12, max: 20 },
  N0: { min: 16, max: 65536 },
  maxLag: { min: 1, max: 4096 },
  maxDelay: { min: 0, max: 4096 },
  codeDelay: { min: 0, max: 4096 },
  residualGainFs: { min: -100, max: 100 },
  randAmp: { min: 0, max: 8 },
} as const

export function sanitizePattern(raw: unknown, base: TrainingPatternSpec = DEFAULT_TRAINING_PATTERN): TrainingPatternSpec {
  const out: TrainingPatternSpec = { ...base }
  if (!isObj(raw)) return out
  if (typeof raw.source === 'string' && (ENUMS.codeSource as readonly string[]).includes(raw.source)) out.source = raw.source as TrainingPatternSpec['source']
  if (isNum(raw.frac)) out.frac = raw.frac
  if (isNum(raw.dsmBits)) out.dsmBits = Math.round(raw.dsmBits)
  if (typeof raw.dither === 'boolean') out.dither = raw.dither
  if (raw.randomization === 'none' || raw.randomization === 'pm1' || raw.randomization === 'uniform') out.randomization = raw.randomization
  if (isNum(raw.randAmp)) out.randAmp = raw.randAmp
  if (typeof raw.normalization === 'string' && (ENUMS.normalization as readonly string[]).includes(raw.normalization)) out.normalization = raw.normalization as TrainingPatternSpec['normalization']
  return out
}

export function sanitizeTrainingPreset(raw: unknown): { shared: TrainingShared; patterns: TrainingPatternSpec[] } {
  const r = isObj(raw) ? raw : {}
  const s: TrainingShared = { ...DEFAULT_TRAINING_SHARED, basis: { ...DEFAULT_TRAINING_SHARED.basis } }
  if (isObj(r.shared)) {
    const q = r.shared
    for (const k of ['seed', 'fRefHz', 'nInt', 'pllBwHz', 'zeta', 'loopDelay', 'codeDelay', 'sigmaV', 'length', 'N0', 'maxLag', 'maxDelay', 'residualGainFs', 'c2', 'c3'] as const) {
      if (isNum(q[k])) s[k] = q[k]
    }
    if (typeof q.pll === 'string' && (ENUMS.pll as readonly string[]).includes(q.pll)) s.pll = q.pll as TrainingShared['pll']
    if (typeof q.regressor === 'string' && (ENUMS.regressor as readonly string[]).includes(q.regressor)) s.regressor = q.regressor as TrainingShared['regressor']
    if (isObj(q.basis)) {
      for (const k of ['gain', 'inl2', 'inl3', 'offset'] as const) if (typeof q.basis[k] === 'boolean') s.basis[k] = q.basis[k]
    }
  }
  const pats = Array.isArray(r.patterns) ? r.patterns.slice(0, 3).map((p) => sanitizePattern(p)) : [{ ...DEFAULT_TRAINING_PATTERN }]
  return { shared: s, patterns: pats.length > 0 ? pats : [{ ...DEFAULT_TRAINING_PATTERN }] }
}

export function trainingErrors(s: TrainingShared, patterns: TrainingPatternSpec[]): string[] {
  const err: string[] = []
  const L = s.length
  if (!(Number.isInteger(L) && L >= 4096 && L <= 1 << 20)) err.push('序列長度必須是 $2^{12}$ – $2^{20}$ 的整數')
  if (!(Number.isInteger(s.N0) && s.N0 >= 16 && s.N0 <= L)) err.push('PE 視窗 $N_0$ 必須是 16 到序列長度之間的整數')
  if (!(Number.isInteger(s.maxLag) && s.maxLag >= 1 && s.maxLag <= 4096)) err.push('自相關最大 lag 必須是 1–4096 的整數')
  if (!(Number.isInteger(s.maxDelay) && s.maxDelay >= 0 && s.maxDelay <= 4096)) err.push('$C_D$ 掃描的最大 $D$ 必須是 0–4096 的整數')
  if (!(s.pllBwHz > 0 && s.pllBwHz < s.fRefHz / 2)) err.push('PLL 頻寬必須小於 $f_{\\mathrm{ref}}/2$（Nyquist）')
  if (!(s.zeta >= LAB_RANGES.zeta.min && s.zeta <= LAB_RANGES.zeta.max)) err.push(`$\\zeta$ 必須在 $[${LAB_RANGES.zeta.min},\\,${LAB_RANGES.zeta.max}]$`)
  if (!(s.sigmaV >= 0)) err.push('$\\sigma_v$ 不可為負')
  if (!Object.values(s.basis).some(Boolean)) err.push('至少要選一個參數基底（gain / INL / offset）：沒有參數就沒有 Jacobian')
  patterns.forEach((p, i) => {
    const id = 'ABC'[i]
    if (p.source !== 'iid_pm_one') {
      if (!(p.frac >= 0 && p.frac < 1)) err.push(`Case ${id}：frac 必須在 $[0,1)$`)
      if (!(Number.isInteger(p.dsmBits) && p.dsmBits >= 4 && p.dsmBits <= 24)) err.push(`Case ${id}：DSM 位元數必須是 4–24 的整數`)
    }
    if (!(p.randAmp >= 0 && p.randAmp <= TRAINING_RANGES.randAmp.max)) err.push(`Case ${id}：隨機化振幅必須在 $[0,\\,${TRAINING_RANGES.randAmp.max}]\\,T_{\\mathrm{vco}}$`)
  })
  return err
}

/* ---------- Compare ---------- */

export function sanitizeComparePreset(raw: unknown): { cases: LabParams[]; issues: string[] } {
  const r = isObj(raw) ? raw : {}
  const base = sanitizeLabParams(r.base)
  const issues = base.issues.map((i) => `base.${i}`)
  const list = Array.isArray(r.cases) && r.cases.length > 0 ? r.cases.slice(0, 3) : [{}]
  const cases = list.map((c, i) => {
    const s = sanitizeLabParams(c, base.params)
    issues.push(...s.issues.map((x) => `Case ${'ABC'[i]}.${x}`))
    return s.params
  })
  return { cases, issues }
}

/* ---------- preset → 整頁的初始狀態 ---------- */

/** 套用一個 preset 之後，五個分頁各自的狀態（沒有被 preset 指定的分頁維持預設）。 */
export interface LabInit {
  tab: TabId
  /** Pipeline / FCW sweep / Monte Carlo 共用的基準參數 */
  params: LabParams
  grid: SweepGrid
  opts: FcwSweepOptions
  runs: number
  shared: TrainingShared
  patterns: TrainingPatternSpec[]
  cases: LabParams[]
  presetId: string | null
  issues: string[]
}

/**
 * 由 preset（URL 的 ?preset=<id> 或下拉選單）算出整頁狀態。純函式：
 * 頁面第一次 render 就用它當初始值，所以不會先用預設參數跑一次模擬、再被 preset 蓋掉。
 * 不屬於本頁的實驗 ID 或 undefined ⇒ 全部預設。
 */
export function labInit(preset?: { id?: string; experiment: string; params: unknown }): LabInit {
  const init: LabInit = {
    tab: 'pipeline',
    params: { ...DEFAULT_LAB_PARAMS },
    grid: { ...DEFAULT_SWEEP_GRID },
    opts: { ...DEFAULT_SWEEP_OPTIONS },
    runs: 16,
    shared: { ...DEFAULT_TRAINING_SHARED, basis: { ...DEFAULT_TRAINING_SHARED.basis } },
    patterns: [{ ...DEFAULT_TRAINING_PATTERN }],
    cases: [{ ...DEFAULT_LAB_PARAMS }],
    presetId: null,
    issues: [],
  }
  const tab = tabOfExperiment(preset?.experiment)
  if (!preset || !tab) return init
  init.tab = tab
  init.presetId = preset.id ?? null
  if (tab === 'pipeline') {
    const s = sanitizeLabParams(preset.params)
    init.params = s.params
    init.issues = s.issues
  } else if (tab === 'fcw') {
    const s = sanitizeSweepPreset(preset.params)
    init.params = s.base
    init.grid = s.grid
    init.opts = s.opts
    init.issues = s.issues
  } else if (tab === 'mc') {
    const s = sanitizeMcPreset(preset.params)
    init.params = s.base
    init.runs = s.runs
    init.issues = s.issues
  } else if (tab === 'training') {
    const s = sanitizeTrainingPreset(preset.params)
    init.shared = s.shared
    init.patterns = s.patterns
  } else {
    const s = sanitizeComparePreset(preset.params)
    init.cases = s.cases
    init.issues = s.issues
  }
  return init
}

/** 幾組參數之間「不一樣的欄位」（Compare 分頁的差異表） */
export function diffKeys(cases: LabParams[]): (keyof LabParams)[] {
  if (cases.length < 2) return []
  const keys = Object.keys(cases[0]) as (keyof LabParams)[]
  return keys.filter((k) => k !== 'seed' && cases.some((c) => c[k] !== cases[0][k]))
}

/* ------------------------------------------------------------------ */
/* Pipeline：警告、指標、交叉比對、CSV、報告                           */
/* ------------------------------------------------------------------ */

/** 全部警告（P5 驗收：全部警示可見）：整體警告 + 每一級自己的警告，各自標上所屬的級；去重。 */
export function collectWarnings(r: PipelineResult): { stage: string; text: string }[] {
  const out: { stage: string; text: string }[] = []
  const seen = new Set<string>()
  for (const s of r.stages) {
    for (const w of s.warnings) {
      if (seen.has(w)) continue
      seen.add(w)
      out.push({ stage: STAGE_TITLES[s.id], text: w })
    }
  }
  for (const w of r.warnings) {
    if (seen.has(w)) continue
    seen.add(w)
    out.push({ stage: '整體', text: w })
  }
  return out
}

/** 「資訊性」的 stage 註記（不是失敗）：不放進紅色警告，只留在該級卡片。 */
export function isInformational(w: string): boolean {
  return /noise-like|參考 code|模擬 Welch 的解析度|封閉式不受影響|LSB dither：序列不再週期/.test(w)
}

const toEntry = (c: CheckItem): CheckEntry => ({ status: c.status, note: c.note })

/**
 * 交叉比對三欄的對應（誠實標示）：
 *   Analytic   ＝ 解析預測 vs 模擬：code 統計封閉式、後半段 mean w、fractional spur 封閉式、gain-noise 混頻近似
 *   Monte Carlo＝ 單一 seed 內能做的統計檢驗（σ_w）；樣本不夠就標 n/a，並請使用者改用 Monte Carlo 分頁
 *   Fixed-Point＝ 定點 vs 同 seed 浮點；未開定點為 n/a
 */
export function pipelineCrossCheck(r: PipelineResult): CrossCheck {
  const c = r.checks
  // 迴路本身的解析預測（mean w）不適用時（極性錯誤、不穩定、沒有固定點），整欄標成「不適用」：
  // 不能因為旁支的子檢查（例如 gain-noise 混頻近似）通過，就讓 Analytic 欄亮綠燈。
  const sub = combineChecks([c.code, c.meanW, c.spur, c.noiseMix], '解析 vs 模擬')
  const analytic: CheckItem =
    sub.status === 'ok' && c.meanW.status !== 'ok'
      ? { status: 'n/a', note: `迴路的解析預測不適用：${c.meanW.note}（其餘子項見「交叉比對明細」）` }
      : sub
  return {
    analytic: toEntry(analytic),
    monteCarlo: toEntry(c.sigmaW.status === 'n/a' ? { status: 'n/a', note: `單一 seed：${c.sigmaW.note}` } : { status: c.sigmaW.status, note: `單一 seed 的 $\\sigma_w$ 檢驗：${c.sigmaW.note}` }),
    fixedPoint: toEntry(c.fixedPoint),
  }
}

/**
 * Compare 分頁：把各 case 的三欄合併。任何一個 case 不一致 ⇒ 不一致；全部一致才是一致；
 * 其餘（有 case 不適用）⇒ 不適用，並點名是哪個 case、為什麼。
 */
export function compareCrossCheck(cases: { id: string; cc: CrossCheck }[]): CrossCheck {
  const entry = (v: CrossCheck[keyof CrossCheck]): CheckEntry => (typeof v === 'string' ? { status: v } : v)
  const col = (k: keyof CrossCheck): CheckEntry => {
    if (cases.length === 0) return { status: 'n/a', note: '尚未執行' }
    const es = cases.map((c) => ({ id: c.id, e: entry(c.cc[k]) }))
    const bad = es.filter((x) => x.e.status === 'mismatch')
    if (bad.length > 0) return { status: 'mismatch', note: bad.map((x) => `Case ${x.id}：${x.e.note ?? ''}`).join('；') }
    if (es.every((x) => x.e.status === 'ok')) return { status: 'ok', note: `${es.length} 個 case 都一致` }
    const ni = es.filter((x) => x.e.status === 'not-implemented')
    if (ni.length === es.length) return { status: 'not-implemented', note: ni[0].e.note }
    const rest = es.filter((x) => x.e.status !== 'ok')
    return { status: 'n/a', note: rest.map((x) => `Case ${x.id}：${x.e.note ?? '不適用'}`).join('；') }
  }
  return { analytic: col('analytic'), monteCarlo: col('monteCarlo'), fixedPoint: col('fixedPoint') }
}

/**
 * 「時間常數 τ = −1/ln ρ」那一列（技術審查 R02）。
 * d = 0：平均誤差的大小每個 block 剛好乘上 ρ = |1 − g|，τ 就是 1/e 時間（精確）。
 * d ≥ 1：ρ 是 z^{d+1} − z^d + g = 0 的最大根模，只決定「漸近」的衰減率；有重根或複數根時 ρ^k 不是平均誤差的包絡
 * （例：d = 1、g = 0.25 是重根 0.5，δ_k = 0.75, 0.5, 0.3125, …，而 ρ^k = 0.5, 0.25, 0.125, …），所以標成近似並加註。
 */
export function tauMetricRow(tauBlocks: number, updateDelay: number): MetricRow {
  if (updateDelay <= 0) return { name: '$\\tau=-1/\\ln\\rho$', value: tauBlocks, unit: 'block', claim: 'exact', note: '$d=0$：平均誤差的大小每個 block 剛好乘上 $\\rho$' }
  return {
    name: '$\\tau=-1/\\ln\\rho$（漸近衰減率）',
    value: tauBlocks,
    unit: 'block',
    claim: 'approx',
    note: '$d\\ge1$：$\\rho$ 只決定漸近的衰減率，$\\rho^k$ 不是平均誤差的包絡（重根、複數根）；逐 block 的暫態可能比 $\\tau$ 慢',
  }
}

/** ExperimentShell 的主要指標（含解析值與容差；細項在各級卡片）。 */
export function pipelineMetrics(r: PipelineResult): MetricRow[] {
  const an = r.analytic
  const m = r.metrics
  const c = r.checks
  const o = r.output
  const rows: MetricRow[] = [
    { name: '重播 $G_k$ 最大差（跨級一致性）', value: r.replay ? r.replay.maxAbsDiffG : null, analytic: 0, tolerance: 1e-12, claim: 'exact', note: '獨立重寫的 sample 迴圈 vs runBlockLms；應為 0', formulaId: 'F-LAB.14' },
    { name: '$C=E[x_{\\mathrm{ref}}u_x]$', value: an.Cest, claim: 'approx', formulaId: 'F-LAB.6', note: '$>0$ 才有正確的更新極性' },
    { name: '$g=\\mu K$', value: an.g, claim: 'approx', formulaId: 'F-LAB.7' },
    { name: '$\\rho$（含更新延遲）', value: an.rhoMean, claim: 'exact', formulaId: 'F-LAB.7', note: '$<1$ 才（平均）收斂' },
    tauMetricRow(an.tauBlocks, r.params.updateDelay),
    {
      name: 'mean $w$（後半段）',
      value: m.meanW,
      unit: 'fs',
      claim: 'approx',
      formulaId: 'F-LAB.18',
      ...(c.meanW.analytic !== undefined && c.meanW.tolerance !== undefined ? { analytic: c.meanW.analytic, tolerance: c.meanW.tolerance } : {}),
      note: '解析值 = mean-field 平均軌跡在同一段時間的預測（含未衰減完的 transient 與隨 code 擺動的固定點）',
    },
    { name: 'bias $=\\bar w-a$', value: m.bias, unit: 'fs', claim: 'exact', note: `mean-field 預測 $w^*-a=${texNum(m.biasPred)}\\,\\mathrm{fs}$` },
    {
      name: '$\\sigma_w$（後半段，對預測軌跡的殘差 RMS）',
      value: c.sigmaW.value ?? m.stdW,
      unit: 'fs',
      claim: 'approx',
      formulaId: 'F-LAB.8',
      ...(c.sigmaW.analytic !== undefined ? { analytic: c.sigmaW.analytic, ...(c.sigmaW.tolerance !== undefined ? { tolerance: c.sigmaW.tolerance, toleranceMode: 'rel' as const } : {}) } : {}),
      note: `穩態預測 $\\sigma_{w,\\mathrm{pred}}=${texNum(an.sigmaWPred)}\\,\\mathrm{fs}$`,
    },
    { name: 'settling block', value: m.settlingBlock ?? '未收斂', unit: 'block', note: '定義：之後永遠留在 mean $\\pm4\\sigma$ 內的第一個 block（一次偶發的 $4\\sigma$ 偏移就會把它往後推；收斂速度請看 $\\tau$）' },
  ]
  if (o) {
    rows.push(
      { name: '$\\mathrm{RMS}(t_{\\mathrm{out}})$（全頻段、時域）', value: o.rmsOut, unit: 'fs', claim: 'exact', formulaId: 'F-LAB.10' },
      { name: '　靜態殘差部分 $T\\{(a-\\bar w)x+d(x)\\}$', value: o.rmsStatic, unit: 'fs', claim: 'exact' },
      { name: '　gain-noise 部分 $T\\{-\\delta w\\,x\\}$', value: o.rmsNoise, unit: 'fs', claim: 'approx', formulaId: 'F-LAB.10', analytic: o.rmsNoisePred, tolerance: 0.25, toleranceMode: 'rel' },
      { name: `$[f_L,f_H]$ jitter（模擬 Welch 積分）`, value: o.jitterBandSim, unit: 'fs', claim: 'exact', note: `實際積分頻帶 $[${texNum(o.bandUsed[0] / 1e3)},\\,${texNum(o.bandUsed[1] / 1e3)}]\\,\\mathrm{kHz}$` },
      { name: '$[f_L,f_H]$ jitter（gain noise，解析）', value: o.jitterBandNoise, unit: 'fs', claim: 'approx', formulaId: 'F-LAB.11' },
    )
    if (o.toneClosedForm && o.toneFitSim) {
      rows.push(
        {
          name: 'fractional tone 振幅（toneFit，peak）',
          value: o.toneFitSim.ampFs,
          unit: 'fs',
          claim: 'exact',
          formulaId: 'F-LAB.12',
          analytic: o.toneClosedForm.ampFs,
          ...(c.spur.tolerance !== undefined ? { tolerance: c.spur.tolerance } : {}),
        },
        { name: 'fractional spur（toneFit）', value: o.toneFitSim.dbc, unit: 'dBc', claim: 'approx', formulaId: 'F-LAB.12', note: `封閉式 $${texNum(o.toneClosedForm.dbc, 5)}\\,\\mathrm{dBc}$；$20\\log_{10}(\\beta/2)$（小角）` },
      )
    }
  }
  return rows
}

/** CSV 匯出欄位（完整的抽樣 trace；長度不同的欄位以空白補齊）。 */
export function pipelineExport(r: PipelineResult): CsvColumns {
  const cols: CsvColumns = {
    block_k: r.blocks.k,
    w_fs: r.blocks.w,
    w_phys_fs: r.blocks.wPhys,
    G: r.blocks.G,
    w_mean_model_fs: r.blocks.wMeanModel,
    w_linear_model_fs: r.blocks.wLinearModel,
  }
  if (r.window) {
    cols.sample_n = r.window.n
    cols.x = r.window.x
    cols.x_ref = r.window.xRef
    cols.e_dtc_fs = r.window.eDtc
    cols.u_pd_fs = r.window.uPd
    cols.e_comparator_fs = r.window.e
    cols.q = r.window.q
    cols.t_out_fs = r.window.tOut
  }
  if (r.output) {
    cols.psd_f_hz = r.output.psdSim.f
    cols.psd_t_out_fs2_per_hz = r.output.psdSim.psd
    cols.analytic_f_hz = r.output.psdAnalytic.f
    cols.analytic_gain_noise_fs2_per_hz = r.output.psdAnalytic.noise
    cols.T_mag2 = r.output.psdAnalytic.t2
    cols.Hpd_mag2 = r.output.psdAnalytic.hpd2
  }
  return cols
}

/** NaN / ±Infinity 在 JSON 會變成 null：轉成字串保留資訊。 */
function jsonNum(v: unknown): unknown {
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v)
  return v
}

/**
 * 完整報告（規格 §15.4「來源可追溯性」、§20.6 P5）：全部參數、seed 與 fork 標籤、模擬版本、app 版本、
 * 九級的模型層級 / 假設 / 指標 / 警告、交叉比對、全部警告。不含大型陣列（那些在 CSV）。
 */
export function buildLabReport(
  r: PipelineResult,
  meta: { appVersion: string; gitCommit: string; generatedAt: string; presetId?: string | null },
): Record<string, unknown> {
  const all = collectWarnings(r)
  return {
    report_type: 'unified-calibration-lab',
    experiment_id: EXP.pipeline,
    preset_id: meta.presetId ?? null,
    simulation_version: r.version,
    app_version: meta.appVersion,
    git_commit: meta.gitCommit,
    generated_at: meta.generatedAt,
    model_level: r.modelLevel,
    loop_model_level: r.loopLevel,
    source: 'simulation',
    seed: r.params.seed,
    rng: {
      algorithm: 'xoshiro128** (splitmix32 seeding) + Ziggurat normal',
      root_seed: r.params.seed,
      forks: {
        code: "createRng(seed).fork('code-pattern')",
        dsm_dither: "….fork('code-pattern').fork('dsm-dither')",
        comparator_noise: "createRng(seed).fork('comparator-noise')",
        gain_register_rounding: "createRng(seed).fork('gain-register-rounding')",
      },
    },
    units: { time: 'fs', frequency: 'Hz', gain: 'fs per unit code', psd: 'fs^2/Hz (one-sided)', phase_noise: 'dBc/Hz' },
    input_parameters: { ...r.params },
    block_lms_config: r.config,
    derived: {
      f_out_hz: r.fOutHz,
      pll: { kind: r.pll.kind, description: r.pll.description, f3db_T_hz: jsonNum(r.pll.f3dbTHz), spectral_radius: r.pll.spectralRadius, stable: r.pll.stable, hpd_dc: r.pll.hpdDc },
      analytic: Object.fromEntries(Object.entries(r.analytic).map(([k, v]) => [k, jsonNum(v)])),
      // 交叉比對用的平均模型（mean-field twin：F-LAB.18；或線性時不變模型：F-LAB.7）與後半段準靜態固定點 w*_k 的範圍
      mean_model: r.meanModel,
      fixed_point_swing_fs: r.fixedPointSwing,
    },
    metrics: Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [k, jsonNum(v)])),
    output: r.output
      ? {
          rms_out_fs: r.output.rmsOut,
          rms_static_fs: r.output.rmsStatic,
          rms_gain_noise_fs: r.output.rmsNoise,
          rms_gain_noise_pred_fs: jsonNum(r.output.rmsNoisePred),
          jitter_band_sim_fs: r.output.jitterBandSim,
          jitter_band_gain_noise_analytic_fs: jsonNum(r.output.jitterBandNoise),
          jitter_band_static_fs: r.output.jitterBandStatic,
          band_used_hz: r.output.bandUsed,
          psd: { window: r.output.psdSim.window, nperseg: r.output.psdSim.nperseg, enbw_hz: r.output.psdSim.enbwHz, segments: r.output.psdSim.nSegments, sided: 'one-sided', units: 'fs^2/Hz' },
          fractional_tone_closed_form: r.output.toneClosedForm,
          fractional_tone_fit: r.output.toneFitSim,
          detected_tones: r.output.tones,
          tone_detection: { method: 'Welch (Blackman–Harris) + findTones', min_prominence_db: 15, nperseg: r.output.toneDetect.nperseg, segments: r.output.toneDetect.nSegments, min_above_local_median_db: r.output.toneDetect.significanceDb },
        }
      : null,
    float_twin: r.floatTwin,
    replay: r.replay,
    stages: r.stages.map((s) => ({
      id: s.id,
      title: s.title,
      model_level: s.level,
      assumptions: s.assumptions,
      metrics: s.metrics.map((x) => ({ ...x, value: jsonNum(x.value) })),
      warnings: s.warnings,
    })),
    cross_check: Object.fromEntries(Object.entries(r.checks).map(([k, v]) => [k, { ...v, value: jsonNum(v.value), analytic: jsonNum(v.analytic), tolerance: jsonNum(v.tolerance) }])),
    warnings: all.map((w) => `【${w.stage}】${w.text}`),
    assumptions: r.assumptions,
    timing_ms: r.timingMs,
    notes: ['字串中的 $...$ 是 TeX 原始碼', 'NaN / Infinity 以字串表示', `所有數值由 ${UNIFIED_LAB_VERSION} 計算；register 名稱為示意，不是特定晶片`],
  }
}

/* ------------------------------------------------------------------ */
/* PSD → ℒ(f)                                                          */
/* ------------------------------------------------------------------ */

/**
 * one-sided timing-error PSD S_t^{(1)}(f) [fs²/Hz] → ℒ(f) [dBc/Hz]：
 *   S_φ^{(1)} = (2π f_out)²·S_t^{(1)}（時間換成 s），ℒ = 10 log10(S_φ^{(1)}/2)（E28）。
 */
export function timingPsdToDbc(psdFs2: ArrayLike<number>, fOutHz: number): Float64Array {
  const k = fsToRad(1, fOutHz) // 2π f_out · 1e-15 [rad per fs]
  const out = new Float64Array(psdFs2.length)
  for (let i = 0; i < out.length; i++) out[i] = psdFs2[i] > 0 ? psdToDbcHz(k * k * psdFs2[i]) : NaN
  return out
}

/* ------------------------------------------------------------------ */
/* FCW sweep 摘要                                                      */
/* ------------------------------------------------------------------ */

export interface SweepSummary {
  n: number
  flips: FcwPoint[]
  unstable: FcwPoint[]
  noPe: FcwPoint[]
  slow: FcwPoint[]
  partial: FcwPoint[]
  minC: number
  maxRho: number
  minPe: number
  worstSpurDbc: number
  worstSpurFrac: number
}

/** blockLms 解析估計用的 code 樣本數（ANALYTIC_SAMPLES = 2^17） */
export const SWEEP_BLOCKLMS_WINDOW = 2 ** 17

/** λ_min「幾乎為 0」的門檻（相對於 E[x²]） */
export const PE_ZERO_REL = 1e-6

export function summarizeSweep(points: FcwPoint[], loopBlocks: number): SweepSummary {
  const flips = points.filter((p) => p.signFlip)
  const unstable = points.filter((p) => !p.signFlip && !p.stable)
  const noPe = points.filter((p) => p.peLambdaMin < PE_ZERO_REL * Math.max(p.Ex2, 1e-300))
  const slow = points.filter((p) => p.stable && !p.signFlip && Number.isFinite(p.tauBlocks) && p.tauBlocks > loopBlocks / 6)
  const partial = points.filter((p) => p.splitRel > 0.1)
  let minC = Infinity
  let maxRho = -Infinity
  let minPe = Infinity
  let worst = -Infinity
  let worstF = NaN
  for (const p of points) {
    if (p.C < minC) minC = p.C
    if (p.rho > maxRho) maxRho = p.rho
    if (p.peLambdaMin < minPe) minPe = p.peLambdaMin
    if (Number.isFinite(p.spurDbc) && p.spurDbc > worst) {
      worst = p.spurDbc
      worstF = p.frac
    }
  }
  return { n: points.length, flips, unstable, noPe, slow, partial, minC, maxRho, minPe, worstSpurDbc: worst, worstSpurFrac: worstF }
}

const fracList = (pts: FcwPoint[], max = 6): string => {
  const s = pts.slice(0, max).map((p) => texNum(p.frac, 3))
  return `$\\alpha\\in\\{${s.join(',\\ ')}${pts.length > max ? ',\\dots' : ''}\\}$`
}

/** sweep 的警告：每一種失敗都說明原因與下一步（不只列出數字）。 */
export function sweepWarnings(s: SweepSummary, opts: FcwSweepOptions): string[] {
  const w: string[] = []
  if (s.flips.length > 0)
    w.push(
      `$C\\le0$：${s.flips.length} 個 FCW（${fracList(s.flips)}）更新極性錯誤——正的 $\\mu$ 在這些 FCW 會讓平均誤差發散。減小 $\\mu$ 不會改變符號；要改 GMAC 的 code delay $D$、用 filtered-x，或限制可用的 FCW 範圍。`,
    )
  if (s.unstable.length > 0)
    w.push(`$\\rho\\ge1$：${s.unstable.length} 個 FCW（${fracList(s.unstable)}）雖然 $C>0$，但 $g=\\mu K$ 超過含延遲的臨界值，平均模型不穩定。請減小 $\\mu$ 或更新延遲 $d$。`)
  if (s.noPe.length > 0)
    w.push(
      `$\\lambda_{\\min}\\approx0$：${s.noPe.length} 個 FCW（${fracList(s.noPe)}）至少有一個 GMAC block 幾乎沒有激勵（不可辨識）。原因：$H_{\\mathrm{PD}}$ 把慢速鋸齒濾掉，只剩 reset 瞬間有訊號。加長 $N$、改用 MASH，或換 training sequence（只開 LSB dither 對一階 DSM 沒有用：鋸齒還在）。`,
    )
  if (s.slow.length > 0 && opts.closedLoop)
    w.push(`收斂太慢：${s.slow.length} 個 FCW（${fracList(s.slow)}）的 $\\tau$ 超過閉迴路長度的 $1/6$，該點的 mean $w$ 與 bias 還含 transient，不能當固定點讀。`)
  if (s.partial.length > 0)
    w.push(`部分週期：${s.partial.length} 個 FCW（${fracList(s.partial)}）的 code 準週期比統計 record 還長，$C$ 在 record 前後半差超過 10%，這些點只是估計。`)
  return w
}

/**
 * FCW sweep 的 Fixed-Point 欄：定點（quantize）與同一批 FCW、同 seed 的浮點對照（store 在 sweep 之後用 quantize = false 再跑一次）
 * 逐點比閉迴路後半段的 mean $w$（內部暫存器）。每點的 SE 用 AR(1) 公式（和 Pipeline 分頁同一個做法）：
 * Var(w̄) = ar1MeanVar(σ², ρ, ⌈loopBlocks/2⌉)，σ 取兩邊 stdW 與 LSB/√12 的最大值；容差 1 LSB + 4 SE。
 */
export function sweepFixedPointCheck(points: FcwPoint[], twin: FcwPoint[], opts: FcwSweepOptions, lsbFs: number): CheckEntry {
  const pairs: { p: FcwPoint; d: number; tol: number }[] = []
  const n = Math.min(points.length, twin.length)
  for (let i = 0; i < n; i++) {
    const a = points[i].loop
    const b = twin[i].loop
    if (!a || !b || a.diverged || b.diverged || !Number.isFinite(a.meanW) || !Number.isFinite(b.meanW)) continue
    if (points[i].frac !== twin[i].frac) continue
    const sig = Math.max(Number.isFinite(a.stdW) ? a.stdW : 0, Number.isFinite(b.stdW) ? b.stdW : 0, lsbFs / Math.sqrt(12))
    const rho = points[i].rho < 1 ? points[i].rho : 0
    const se = Math.sqrt(ar1MeanVar(sig * sig, rho, Math.max(2, Math.ceil(opts.loopBlocks / 2))))
    pairs.push({ p: points[i], d: a.meanW - b.meanW, tol: lsbFs + 4 * se })
  }
  if (pairs.length === 0) {
    return { status: 'n/a', note: twin.length < points.length ? `浮點對照尚未算完（${twin.length}/${points.length} 點）` : '沒有可比的閉迴路點（定點或浮點迴路發散）' }
  }
  const bad = pairs.filter((x) => Math.abs(x.d) > x.tol)
  const maxD = Math.max(...pairs.map((x) => Math.abs(x.d)))
  return bad.length === 0
    ? { status: 'ok', note: `${pairs.length} 個閉迴路點：定點 vs 同 seed 浮點的 mean $w$ 差都在 $1\\,\\mathrm{LSB}+4\\,\\mathrm{SE}$ 內（最大 $${texNum(maxD)}\\,\\mathrm{fs}$）` }
    : {
        status: 'mismatch',
        note: `${bad.length}/${pairs.length} 個閉迴路點的定點 mean $w$ 偏離同 seed 浮點超過 $1\\,\\mathrm{LSB}+4\\,\\mathrm{SE}$（${fracList(bad.map((x) => x.p))}）：dead zone／limit cycle／飽和讓定點軌跡偏離，請到 Pipeline 分頁逐點看定點 vs 浮點的明細`,
      }
}

export function sweepCrossCheck(points: FcwPoint[], opts: FcwSweepOptions, quantize: boolean, twin: { points: FcwPoint[]; lsbFs: number } | null = null): CrossCheck {
  if (points.length === 0) {
    const na = (note: string): CheckEntry => ({ status: 'n/a', note })
    return { analytic: na('尚未執行 sweep'), monteCarlo: na('尚未執行 sweep'), fixedPoint: na(quantize ? '尚未執行 sweep' : '未啟用定點暫存器（理想浮點）') }
  }
  // Analytic：本頁整段（整數週期）平均的 C vs blockLms 的解析估計（前 2^17 個樣本、略過暫態）。
  // 兩者的視窗不同，所以只比「blockLms 的視窗內有夠多個鋸齒」的點：一階 DSM 的準週期是 1/min(α, 1 − α) 個樣本，要求 ≥ 64 個；
  // MASH（noise-like）一律可比；一階 DSM 加 LSB dither 仍然是鋸齒（只是沒有嚴格的週期），與無 dither 同樣處理。
  const cycles = (p: FcwPoint): number => (p.sawtooth ? SWEEP_BLOCKLMS_WINDOW * Math.min(p.fracEff, 1 - p.fracEff) : Infinity)
  const comparable = points.filter((p) => p.splitRel <= 0.02 && cycles(p) >= 64)
  let analytic: CheckEntry
  if (comparable.length === 0) analytic = { status: 'n/a', note: '沒有任何點可比：blockLms 的解析視窗（$2^{17}$ 個樣本）內都不到 64 個 code 準週期' }
  else {
    const bad = comparable.filter((p) => Math.abs(p.C - p.CblockLms) > 0.03 * Math.max(Math.abs(p.C), 0.05 * Math.sqrt(p.Ex2)))
    analytic =
      bad.length === 0
        ? { status: 'ok', note: `${comparable.length}/${points.length} 個可比的點：本頁整段平均的 $C$ 與 blockLms 的 $C$（前 $2^{17}$ 個樣本）相差不到 3%；其餘的點太接近整數，blockLms 的視窗內不到 64 個準週期，不比` }
        : { status: 'mismatch', note: `${bad.length}/${comparable.length} 個可比的點，兩種 $C$ 估計相差超過 3%（${fracList(bad)}）` }
  }
  let monteCarlo: CheckEntry
  const withSlope = points.filter((p) => p.slope)
  if (!opts.slopeMc || withSlope.length === 0) monteCarlo = { status: 'n/a', note: '未啟用凍結 $w^*\\pm\\Delta w$ 的 GMAC 斜率量測' }
  else {
    const bad = withSlope.filter((p) => {
      const sl = p.slope as NonNullable<FcwPoint['slope']>
      const half = (sl.hi - sl.lo) / 2
      return Math.abs(sl.S - sl.Smf) > 2 * half + 1e-12
    })
    monteCarlo =
      bad.length === 0
        ? { status: 'ok', note: `${withSlope.length} 個點：MC 斜率 $S=-(G_+-G_-)/(2\\Delta w)$ 與同一段樣本的 mean-field 斜率之差都在 2 倍 95% CI 半寬內` }
        : { status: 'mismatch', note: `${bad.length}/${withSlope.length} 個點的 MC 斜率與 mean-field 斜率差超過 2 倍 95% CI 半寬（${fracList(bad)}）` }
  }
  let fixedPoint: CheckEntry
  if (!quantize) fixedPoint = { status: 'n/a', note: '未啟用定點暫存器（理想浮點）' }
  else if (!opts.closedLoop)
    fixedPoint = { status: 'n/a', note: '定點暫存器只影響閉迴路的 gain register；這個 sweep 沒開閉迴路（$C$、$\\rho$、PE 與線性化 bias 都與定點無關），開「每點再跑閉迴路」才有定點 vs 浮點的對照' }
  else fixedPoint = sweepFixedPointCheck(points, twin?.points ?? [], opts, twin?.lsbFs ?? 0)
  return { analytic, monteCarlo, fixedPoint }
}

export function sweepExport(points: FcwPoint[]): CsvColumns {
  const col = <T>(f: (p: FcwPoint) => T): T[] => points.map(f)
  return {
    frac: col((p) => p.frac),
    frac_eff: col((p) => p.fracEff),
    K_word: col((p) => p.K),
    period_P: col((p) => p.P),
    periods_in_record: col((p) => p.periods),
    f_tone_hz: col((p) => p.fracToneHz),
    C: col((p) => p.C),
    C_blocklms: col((p) => p.CblockLms),
    K_per_fs: col((p) => p.K_),
    g: col((p) => p.g),
    rho: col((p) => p.rho),
    tau_blocks: col((p) => p.tauBlocks),
    pm_deg: col((p) => p.pmDeg),
    sign_flip: col((p) => (p.signFlip ? 1 : 0)),
    pe_lambda_min: col((p) => p.peLambdaMin),
    block_C_min: col((p) => p.blockGainMin),
    block_C_max: col((p) => p.blockGainMax),
    frac_neg_blocks: col((p) => p.fracNegBlocks),
    Ex: col((p) => p.Ex),
    Ex2: col((p) => p.Ex2),
    w_star_lin_fs: col((p) => p.wStarLin),
    bias_lin_fs: col((p) => p.biasLin),
    w_star_mf_fs: col((p) => p.wStarMf),
    sigma_w_pred_fs: col((p) => p.sigmaWPred),
    sens_rms: col((p) => p.sensRms),
    spur_dbc: col((p) => p.spurDbc),
    slope_mc: col((p) => p.slope?.S ?? null),
    slope_mc_lo: col((p) => p.slope?.lo ?? null),
    slope_mc_hi: col((p) => p.slope?.hi ?? null),
    slope_mean_field: col((p) => p.slope?.Smf ?? null),
    loop_mean_w_fs: col((p) => p.loop?.meanW ?? null),
    loop_std_w_fs: col((p) => p.loop?.stdW ?? null),
    loop_converged: col((p) => (p.loop ? (p.loop.converged ? 1 : 0) : null)),
  }
}

/* ------------------------------------------------------------------ */
/* Monte Carlo 摘要                                                    */
/* ------------------------------------------------------------------ */

/**
 * Monte Carlo 分頁的 Fixed-Point 欄：定點（quantize）與同 seed 浮點對照（store 對每一段 seeds 再跑一次 quantize = false）的成對比較。
 * 每個 seed 一對：d_r = 定點內部暫存器 w 的後半段平均 − 浮點 w 的後半段平均（comparator 雜訊、code 與 dither 都相同，只差暫存器量化）。
 * 跨 seeds 的 Student-t 95% CI；判定 |mean d| ≤ 1 LSB + 4 SE（和 Pipeline 分頁的 floatTwin 同一個判準，SE 改由多 seeds 估計）。
 * 發散的 seed、或浮點對照還沒算到的 seed 不計入；有效對數 < 2 ⇒ n/a。
 */
export function mcFixedPointCheck(chunks: McChunk[], twinChunks: McChunk[], lsbFs: number): CheckItem {
  const d: number[] = []
  const n = Math.min(chunks.length, twinChunks.length)
  for (let i = 0; i < n; i++) {
    const a = chunks[i]
    const b = twinChunks[i]
    for (let r = 0; r < a.seeds.length; r++) {
      if (b.seeds[r] !== a.seeds[r]) continue
      if (!Number.isFinite(a.meanW[r]) || !Number.isFinite(b.meanW[r])) continue
      d.push(a.meanW[r] - b.meanW[r])
    }
  }
  const total = chunks.reduce((s, c) => s + c.seeds.length, 0)
  if (d.length < 2) {
    return { status: 'n/a', note: twinChunks.length < chunks.length ? `浮點對照尚未算完（${twinChunks.length}/${chunks.length} 段）` : `有效的成對 seed 只有 ${d.length} 個（發散的 run 不計入），沒有信賴區間` }
  }
  const ci = meanCI(d)
  const tol = lsbFs + 4 * ci.se
  const ok = Math.abs(ci.mean) <= tol
  return {
    status: ok ? 'ok' : 'mismatch',
    value: ci.mean,
    analytic: 0,
    tolerance: tol,
    note:
      `定點 vs 同 seed 浮點（${d.length}/${total} 對）：mean $w$ 的成對差 $\\bar d=${texNum(ci.mean)}\\,\\mathrm{fs}$，95% CI $[${texNum(ci.lo)},\\,${texNum(ci.hi)}]$；容差 $1\\,\\mathrm{LSB}+4\\,\\mathrm{SE}=${texNum(tol)}\\,\\mathrm{fs}$` +
      (ok ? '' : '：定點軌跡系統性偏離浮點（dead zone／limit cycle／飽和或 wrap），到 Pipeline 分頁看同一組參數的定點 vs 浮點明細'),
  }
}

export function mcCrossCheck(checks: { meanW: CheckItem; sigmaW: CheckItem; divergence: CheckItem } | null, quantize: boolean, fixedPoint: CheckItem | null = null): CrossCheck {
  const fp: CheckEntry = !quantize
    ? { status: 'n/a', note: '未啟用定點暫存器（理想浮點）' }
    : fixedPoint
      ? toEntry(fixedPoint)
      : { status: 'n/a', note: checks ? '浮點對照尚未算完（每一段 seeds 都會再跑一次 quantize = false 的對照）' : '尚未執行' }
  if (!checks) return { analytic: { status: 'n/a', note: '尚未執行' }, monteCarlo: { status: 'n/a', note: '尚未執行' }, fixedPoint: fp }
  return {
    analytic: toEntry(combineChecks([checks.meanW, checks.divergence], '平均模型 vs 多 seeds')),
    monteCarlo: toEntry(checks.sigmaW),
    fixedPoint: fp,
  }
}

export function mcMetrics(s: McSummary, lin: { halfMean: number; halfRms: number; halfTrajVar: number; valid: boolean }, aFs: number, sigmaWPred: number): MetricRow[] {
  const pred = lin.valid ? Math.sqrt(lin.halfRms * lin.halfRms + lin.halfTrajVar) : NaN
  return [
    { name: 'runs（有效 / 全部）', value: `${s.valid} / ${s.runs}` },
    {
      name: 'mean $w$（跨 seeds 平均）',
      value: s.meanW.mean,
      unit: 'fs',
      claim: 'approx',
      formulaId: 'F-LAB.9',
      ...(lin.valid && Number.isFinite(s.meanW.halfWidth) ? { analytic: lin.halfMean, tolerance: s.meanW.halfWidth } : {}),
      note: `95% CI $[${texNum(s.meanW.lo, 6)},\\,${texNum(s.meanW.hi, 6)}]$（Student-t，各 seed 獨立）`,
    },
    { name: 'bias $=\\bar w-a$', value: s.bias.mean, unit: 'fs', claim: 'exact', note: `95% CI $[${texNum(s.bias.lo)},\\,${texNum(s.bias.hi)}]$；$a=${texNum(aFs)}$` },
    {
      name: '$\\sigma_w$（pooled：$\\sqrt{\\overline{s_r^2}}$）',
      value: s.sigmaW.pooled,
      unit: 'fs',
      claim: 'approx',
      formulaId: 'F-LAB.8',
      ...(Number.isFinite(pred) ? { analytic: pred, tolerance: 0.15 + (s.sigmaW.pooled > 0 ? (s.sigmaW.hi - s.sigmaW.lo) / (2 * s.sigmaW.pooled) : 0), toleranceMode: 'rel' as const } : {}),
      note: `95% CI $[${texNum(s.sigmaW.lo)},\\,${texNum(s.sigmaW.hi)}]$；穩態預測 $${texNum(sigmaWPred)}\\,\\mathrm{fs}$`,
    },
    { name: 'settling block（平均）', value: s.settling.mean, unit: 'block', note: `95% CI $[${texNum(Math.max(0, s.settling.lo))},\\,${texNum(s.settling.hi)}]$（下限夾在 0；分布右偏，$t$ 區間只是粗估）；${s.settling.neverSettled} 個 run 未收斂` },
    { name: '發散的 runs', value: `${s.diverged} / ${s.runs}`, note: `Wilson 95% CI $[${texNum(100 * s.divergedCI.lo, 3)}\\%,\\,${texNum(100 * s.divergedCI.hi, 3)}\\%]$` },
  ]
}

/* ------------------------------------------------------------------ */
/* Training 摘要                                                       */
/* ------------------------------------------------------------------ */

export function trainingCrossCheck(res: TrainingResult | null): CrossCheck {
  if (!res) {
    return {
      analytic: { status: 'n/a', note: '尚未分析' },
      monteCarlo: { status: 'not-implemented', note: '每組 code 只分析一個實現（一個 seed），沒有跨 seeds 的信賴區間' },
      fixedPoint: { status: 'n/a', note: '序列分析不含定點暫存器' },
    }
  }
  const cf = res.patterns.filter((p) => p.closedForm)
  let analytic: CheckEntry
  if (cf.length === 0) analytic = { status: 'n/a', note: '只有「一階 DSM、無 dither、無隨機化」的 code 有封閉式可比' }
  else {
    const bad = cf.filter((p) => {
      const c = p.closedForm as NonNullable<typeof p.closedForm>
      return Math.abs(c.meanSim - c.mean) > 0.01 || Math.abs(c.meanSquareSim - c.meanSquare) > 0.01 || Math.abs(c.line1Sim / c.line1 - 1) > 0.05
    })
    analytic =
      bad.length === 0
        ? { status: 'ok', note: `${cf.length} 組一階 code：$E[r]$、$E[r^2]$、基頻振幅 $A_1$ 與封閉式一致` }
        : { status: 'mismatch', note: `${bad.length}/${cf.length} 組一階 code 與封閉式不一致（序列可能只涵蓋部分週期，見各組警告）` }
  }
  return {
    analytic,
    monteCarlo: { status: 'not-implemented', note: '每組 code 只分析一個實現（一個 seed），沒有跨 seeds 的信賴區間' },
    fixedPoint: { status: 'n/a', note: '序列分析不含定點暫存器' },
  }
}

/** Training 的 CSV：每組 code 的 PSD、自相關、C_D（欄名帶 case 編號） */
export function trainingExport(res: TrainingResult): CsvColumns {
  const cols: CsvColumns = {}
  res.patterns.forEach((p, i) => {
    const id = 'ABC'[i]
    cols[`${id}_psd_f_hz`] = p.psd.f
    cols[`${id}_code_psd_per_hz`] = p.psd.psd
    cols[`${id}_acf_lag`] = Array.from(p.acf, (_, l) => l)
    cols[`${id}_acf`] = p.acf
    cols[`${id}_D`] = Array.from(p.cd, (_, d) => d)
    cols[`${id}_C_D`] = p.cd
    cols[`${id}_sv_scaled`] = p.svScaled
  })
  return cols
}
