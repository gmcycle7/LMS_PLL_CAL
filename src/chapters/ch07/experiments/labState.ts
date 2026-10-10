/**
 * Delay / Filtered-x Lab 的狀態型別、預設值與 preset 解析（純函式，可單元測試）。
 * 場景（誤差路徑、code、閉迴路參數）由 Case 共用；regressor 設定（模式、D、μ、Ĥ 誤差）每個 Case 各一組。
 */
import type {
  FxCaseSpec,
  FxCodeSpec,
  FxHatSpec,
  FxPathSpec,
  FxScenario,
  HatBase,
  RegressorMode,
} from '@/simulation/models/filteredX'

export const EXPERIMENT_ID = 'delay-fx-lab'

export type PathKind = 'single_tone' | 'type2_dt' | 'identity'
export type CodeKind = 'sinusoid' | 'ar1' | 'white_pm_one' | 'mash111' | 'dsm1'

export interface LabScenario {
  pathKind: PathKind
  /** single_tone：|H|、φ [deg]（在 Ω 處） */
  mag: number
  phiDeg: number
  /** type2_dt：ω_nT_s [rad/sample]、ζ、loop latency d [samples] */
  wnTs: number
  zeta: number
  loopDelay: number
  codeKind: CodeKind
  /** sinusoid 的 Ω，也是 single_tone 2-tap FIR 的設計頻率 [rad/sample] */
  omega: number
  /** AR(1) 係數 */
  rho: number
  /** DSM code（MASH 1-1-1 或一階）的 FCW 小數部分 */
  frac: number
  /** 閉迴路：a、w_0 [fs per unit code]，σ_v [fs]，N，blocks */
  a: number
  w0: number
  sigmaV: number
  N: number
  blocks: number
  /** C vs D 掃描上限 */
  Dmax: number
}

export interface LabCase {
  mode: RegressorMode
  D: number
  /** gain_step μ [fs] */
  mu: number
  hatBase: HatBase
  bwErrPct: number
  loopDelayErr: number
  extraDelay: number
  phaseErrDeg: number
  gainErrPct: number
}

export const DEFAULT_SCENARIO: LabScenario = {
  pathKind: 'single_tone',
  mag: 1,
  phiDeg: -120,
  wnTs: 0.1,
  zeta: 0.7,
  loopDelay: 0,
  codeKind: 'sinusoid',
  omega: Math.PI / 6,
  rho: 0.9,
  frac: 0.3,
  a: 3,
  w0: 0,
  sigmaV: 100,
  N: 1024,
  blocks: 300,
  Dmax: 24,
}

const CASE_BASE: LabCase = {
  mode: 'raw',
  D: 0,
  mu: 10,
  hatBase: 'same',
  bwErrPct: 0,
  loopDelayErr: 0,
  extraDelay: 0,
  phaseErrDeg: 0,
  gainErrPct: 0,
}

/** 預設 A/B/C：raw-x、delayed-x（D = 4）、filtered-x（Ĥ = H）——規格 §19.2 #4 的設定 */
export const DEFAULT_CASES: LabCase[] = [
  { ...CASE_BASE, mode: 'raw', D: 0 },
  { ...CASE_BASE, mode: 'delayed', D: 4 },
  { ...CASE_BASE, mode: 'filtered', D: 0 },
]

export const DEFAULT_SEED = 20261010

export const MODE_LABEL: Record<RegressorMode, string> = {
  raw: 'raw-x',
  delayed: 'delayed-x',
  filtered: 'filtered-x',
}

export function toPathSpec(s: LabScenario): FxPathSpec {
  switch (s.pathKind) {
    case 'identity':
      return { kind: 'identity' }
    case 'single_tone':
      return { kind: 'single_tone', magnitude: s.mag, phaseDeg: s.phiDeg, omega: s.omega }
    case 'type2_dt':
      return { kind: 'type2_dt', wnTs: s.wnTs, zeta: s.zeta, loopDelay: s.loopDelay }
  }
}

export function toCodeSpec(s: LabScenario): FxCodeSpec {
  switch (s.codeKind) {
    case 'sinusoid':
      return { kind: 'sinusoid', omega: s.omega }
    case 'ar1':
      return { kind: 'ar1', rho: s.rho }
    case 'white_pm_one':
      return { kind: 'white_pm_one' }
    case 'mash111':
      return { kind: 'mash111', frac: s.frac }
    case 'dsm1':
      return { kind: 'dsm1', frac: s.frac }
  }
}

export function toHatSpec(c: LabCase): FxHatSpec {
  return {
    base: c.hatBase,
    bwErrPct: c.bwErrPct,
    loopDelayErr: c.loopDelayErr,
    extraDelay: c.extraDelay,
    phaseErrDeg: c.phaseErrDeg,
    gainErrPct: c.gainErrPct,
  }
}

export function toCaseSpec(c: LabCase): FxCaseSpec {
  return { mode: c.mode, D: c.mode === 'raw' ? 0 : c.D, mu: c.mu, hat: toHatSpec(c) }
}

export function toFxScenario(s: LabScenario, seed: number): FxScenario {
  return { path: toPathSpec(s), code: toCodeSpec(s), a: s.a, w0: s.w0, sigmaV: s.sigmaV, N: s.N, blocks: s.blocks, seed }
}

// ── Run-to-Convergence ──

/** block 數的合法上限（與 LabControls 的 ParamControl 相同） */
export const MAX_BLOCKS = 4000
/** Run-to-Convergence：把 block 數加長到最慢的收斂 Case 的 12τ（交叉比對需要 ≥ 10τ） */
export const CONVERGENCE_TAUS = 12

/**
 * Run-to-Convergence 需要的 block 數（純函式，可單元測試）：取所有「預測收斂」Case 中最大的 τ，回傳 ⌈12τ⌉（上限 4000）。
 * 沒有任何預測收斂的 Case（C ≤ 0 或 C ≈ 0）時回傳 null——加長模擬也不會收斂。
 */
export function blocksToConverge(cases: { analytic: { stableMean: boolean; g: number; tauBlocks: number } }[]): { blocks: number; capped: boolean } | null {
  const taus = cases.filter((c) => c.analytic.stableMean && c.analytic.g > 1e-3 && Number.isFinite(c.analytic.tauBlocks)).map((c) => c.analytic.tauBlocks)
  if (taus.length === 0) return null
  const need = Math.ceil(CONVERGENCE_TAUS * Math.max(...taus))
  return { blocks: Math.min(MAX_BLOCKS, Math.max(10, need)), capped: need > MAX_BLOCKS }
}

// ── preset 解析（JSON 來自 src/data/presets/*.json 或 URL）──

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function mergeNumbers<T extends object>(base: T, patch: unknown): T {
  if (!isObj(patch)) return { ...base }
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(base)) {
    const p = patch[k]
    if (p === undefined) continue
    if (typeof v === 'number' && typeof p === 'number' && Number.isFinite(p)) out[k] = p
    else if (typeof v === 'string' && typeof p === 'string') out[k] = p
  }
  return out as T
}

const PATH_KINDS: PathKind[] = ['single_tone', 'type2_dt', 'identity']
const CODE_KINDS: CodeKind[] = ['sinusoid', 'ar1', 'white_pm_one', 'mash111', 'dsm1']
const MODES: RegressorMode[] = ['raw', 'delayed', 'filtered']
const BASES: HatBase[] = ['same', 'second_diff']

/**
 * 解析 preset 的 params：{ scenario?: Partial<LabScenario>, cases?: Partial<LabCase>[]（1–3 個）, seed?: number }。
 * 未知或型別錯誤的欄位以預設值取代；列舉值不合法時回傳 null（不套用）。
 */
export function parseLabPreset(params: unknown): { scenario: LabScenario; cases: LabCase[]; seed?: number } | null {
  if (!isObj(params)) return null
  const scenario = mergeNumbers(DEFAULT_SCENARIO, params.scenario)
  if (!PATH_KINDS.includes(scenario.pathKind) || !CODE_KINDS.includes(scenario.codeKind)) return null
  const rawCases = Array.isArray(params.cases) ? params.cases.slice(0, 3) : []
  const cases = rawCases.length > 0 ? rawCases.map((c) => mergeNumbers(CASE_BASE, c)) : DEFAULT_CASES.map((c) => ({ ...c }))
  if (cases.some((c) => !MODES.includes(c.mode) || !BASES.includes(c.hatBase))) return null
  const seed = typeof params.seed === 'number' && Number.isInteger(params.seed) && params.seed >= 0 ? params.seed : undefined
  return { scenario, cases, seed }
}
