import type { PresetEntry } from '@/data/types'
import type { GmMode } from '@/simulation/models/calNoise'
import { T13_SETUP } from './refValues'
import type { UnitsMcEngine } from './unitsModel'

/**
 * 「單位與頻寬換算器」（experiment id：units-calculator）的參數型別、預設值與本頁自帶的 presets。
 *
 * 為什麼 presets 寫在這裡而不是 src/data/presets/*.json：本頁的開發者只擁有 src/pages/formulas/**。
 * 格式與 PresetEntry 相同（之後若搬成 JSON 檔，Gallery 就會自動收錄）；換算器同時支援
 *   - '#/formulas?preset=<id>'（本檔的 id，或日後 src/data/presets 內 experiment = 'units-calculator' 的 JSON）
 *   - ExperimentShell 的 presets 下拉選單。
 * `check` 是機器可讀的期望值：presets.test.ts 會用同一套核心重算並比對，確保 `expected` 文字不是手寫的假數字。
 */

export const UNITS_EXPERIMENT_ID = 'units-calculator'

/** 所有 case 共用的參數 */
export interface UnitsShared {
  /** comparator 取樣率 f_s [Hz] */
  fs: number
  /** comparator 前雜訊 RMS σ_v [fs] */
  sigmaV: number
  /** 有效 code 相關 C = E[xu] */
  C: number
  /** PLL 輸出頻率 f_out [Hz] */
  fOut: number
  /** output timing tone 的 peak A_t [fs] */
  At: number
  /** gain register 的 LSB 尺寸 Δ_LSB [fs/LSB] */
  lsbFs: number
  /** Monte Carlo 引擎 */
  engine: UnitsMcEngine
  /** Monte Carlo chain 數 */
  chains: number
  /** 每條 chain 計入統計的 block 數 */
  blocks: number
}

/** 每個 case（A / B / C）自己的參數 */
export interface UnitsCase {
  /** GMAC block 長度 N [samples] */
  N: number
  /** 學習率 μ [fs]（[w]/[G]） */
  mu: number
  gmMode: GmMode
}

export const DEFAULT_SHARED: UnitsShared = {
  fs: T13_SETUP.fs,
  sigmaV: T13_SETUP.sigmaV,
  C: T13_SETUP.C,
  fOut: 13e9,
  At: 0.5,
  lsbFs: 0.125,
  engine: 'sign',
  chains: 16,
  blocks: 4000,
}

export const DEFAULT_CASE: UnitsCase = { N: T13_SETUP.N, mu: T13_SETUP.mu, gmMode: 'average' }

/** 控制項的合法範圍（UI 與 preset 清理共用） */
export const LIMITS = {
  fs: [1e6, 1e11],
  sigmaV: [0.01, 1e4],
  C: [-2, 2],
  fOut: [1e8, 1e11],
  At: [1e-3, 1e3],
  lsbFs: [1e-3, 10],
  chains: [1, 64],
  blocks: [100, 50_000],
  N: [1, 1_048_576],
  mu: [1e-6, 1e4],
} as const

function num(v: unknown, lo: number, hi: number, fallback: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  const c = Math.min(hi, Math.max(lo, v))
  return integer ? Math.round(c) : c
}

/** 把（可能來自 URL／舊版 JSON 的）共用參數清理成合法值；缺的欄位用預設值 */
export function sanitizeShared(raw: Record<string, unknown> | undefined, base: UnitsShared = DEFAULT_SHARED): UnitsShared {
  const r = raw ?? {}
  return {
    fs: num(r.fs, LIMITS.fs[0], LIMITS.fs[1], base.fs),
    sigmaV: num(r.sigmaV, LIMITS.sigmaV[0], LIMITS.sigmaV[1], base.sigmaV),
    C: num(r.C, LIMITS.C[0], LIMITS.C[1], base.C),
    fOut: num(r.fOut, LIMITS.fOut[0], LIMITS.fOut[1], base.fOut),
    At: num(r.At, LIMITS.At[0], LIMITS.At[1], base.At),
    lsbFs: num(r.lsbFs, LIMITS.lsbFs[0], LIMITS.lsbFs[1], base.lsbFs),
    engine: r.engine === 'linear' || r.engine === 'sign' ? r.engine : base.engine,
    chains: num(r.chains, LIMITS.chains[0], LIMITS.chains[1], base.chains, true),
    blocks: num(r.blocks, LIMITS.blocks[0], LIMITS.blocks[1], base.blocks, true),
  }
}

export function sanitizeCase(raw: unknown, base: UnitsCase = DEFAULT_CASE): UnitsCase {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    N: num(r.N, LIMITS.N[0], LIMITS.N[1], base.N, true),
    mu: num(r.mu, LIMITS.mu[0], LIMITS.mu[1], base.mu),
    gmMode: r.gmMode === 'sum' || r.gmMode === 'average' ? r.gmMode : base.gmMode,
  }
}

/** preset.params → { shared, cases, seed }（最多 3 個 case；沒有 cases 時用一個預設 case） */
export function parsePresetParams(params: Record<string, unknown>): { shared: UnitsShared; cases: UnitsCase[]; seed: number | null } {
  const { cases: rawCases, seed, ...rest } = params
  const list = Array.isArray(rawCases) ? rawCases.slice(0, 3).map((c) => sanitizeCase(c)) : []
  return {
    shared: sanitizeShared(rest),
    cases: list.length > 0 ? list : [{ ...DEFAULT_CASE }],
    seed: typeof seed === 'number' && Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) >>> 0 : null,
  }
}

/** 機器可讀的期望值：第 caseIndex 個 case 的某個量應該等於 value（相對容差 rel；'nan' 表示應為 NaN） */
export interface PresetCheck {
  caseIndex: number
  quantity: 'g' | 'p' | 'sigmaW' | 'f3dbExact' | 'enbw' | 'fu' | 'tauBlocks' | 'f3dbOneMinusP'
  value: number | 'nan'
  rel?: number
}

export interface UnitsPreset extends PresetEntry {
  check: PresetCheck[]
}

/** μ 使 g = target（average mode、C = 1、σ_v = 100 fs）：μ = g/K_q = g·σ_v·√(π/2) */
const muForG = (g: number, sigmaV = 100) => g * sigmaV * Math.sqrt(Math.PI / 2)

export const UNITS_PRESETS: UnitsPreset[] = [
  {
    id: 'units-t13-reference',
    title: 'T13 / T14 參考條件：一個 μ = 10 fs 走完整條單位鏈',
    page: '/formulas',
    experiment: UNITS_EXPERIMENT_ID,
    description: '規格 §12.1 的示例（勘誤 E30 補齊前提：unit-RMS code、identity path C = 1、average mode）。看 μ[fs] × K[fs⁻¹] 如何變成無因次的 g，以及四個「頻寬」數字。',
    params: { ...DEFAULT_SHARED, seed: 20261010, cases: [{ ...DEFAULT_CASE }] },
    expected: 'g = 0.07979、p = 0.9202、τ = 12.03 blocks、σ_w = 0.3992 fs；exact −3 dB 12.93 kHz、(1−p) 近似 12.40 kHz、ENBW 20.29 kHz；1-bit Monte Carlo 的 σ̂_w 與 0.3992 fs 一致（|z| ≤ 4）',
    tests: ['T13', 'T14'],
    source: 'simulation',
    check: [
      { caseIndex: 0, quantity: 'g', value: 0.07978845608028654, rel: 1e-12 },
      { caseIndex: 0, quantity: 'p', value: 0.9202115439197135, rel: 1e-12 },
      { caseIndex: 0, quantity: 'tauBlocks', value: 12.026, rel: 1e-3 },
      { caseIndex: 0, quantity: 'sigmaW', value: 0.3991861429909288, rel: 1e-10 },
      { caseIndex: 0, quantity: 'f3dbExact', value: 12931.284485590351, rel: 1e-9 },
      { caseIndex: 0, quantity: 'f3dbOneMinusP', value: 12401.100768406435, rel: 1e-9 },
      { caseIndex: 0, quantity: 'enbw', value: 20289.018256251733, rel: 1e-9 },
    ],
  },
  {
    id: 'units-sum-vs-average',
    title: 'Sum vs Average：忘了除以 N 會怎樣（勘誤 E18）',
    page: '/formulas',
    experiment: UNITS_EXPERIMENT_ID,
    description: 'Case A：average mode、μ = 10 fs。Case B：硬體直接輸出總和、沿用同一個 μ（g 放大 4096 倍）。Case C：sum mode、把 μ 改成 10/4096 fs（與 A 完全等價）。',
    params: {
      ...DEFAULT_SHARED,
      seed: 20261010,
      cases: [
        { N: 4096, mu: 10, gmMode: 'average' },
        { N: 4096, mu: 10, gmMode: 'sum' },
        { N: 4096, mu: 10 / 4096, gmMode: 'sum' },
      ],
    },
    expected: 'A：g = 0.0798、σ_w = 0.3992 fs。B：g = 326.8、pole −325.8（線性模型發散；1-bit 迴路變成數萬 fs 的 limit cycle），沒有 σ_w 與頻寬。C：g、p、σ_w、ENBW 與 A 完全相同',
    tests: ['T13'],
    source: 'simulation',
    check: [
      { caseIndex: 0, quantity: 'g', value: 0.07978845608028654, rel: 1e-12 },
      { caseIndex: 1, quantity: 'g', value: 326.81351610485365, rel: 1e-12 },
      { caseIndex: 1, quantity: 'p', value: -325.81351610485365, rel: 1e-12 },
      { caseIndex: 1, quantity: 'sigmaW', value: 'nan' },
      { caseIndex: 1, quantity: 'f3dbExact', value: 'nan' },
      { caseIndex: 2, quantity: 'g', value: 0.07978845608028654, rel: 1e-12 },
      { caseIndex: 2, quantity: 'sigmaW', value: 0.3991861429909288, rel: 1e-10 },
      { caseIndex: 2, quantity: 'enbw', value: 20289.018256251733, rel: 1e-9 },
    ],
  },
  {
    id: 'units-bandwidth-regimes',
    title: '−3 dB 點什麼時候不存在？（勘誤 E27）',
    page: '/formulas',
    experiment: UNITS_EXPERIMENT_ID,
    description: '同一組 N、σ_v，只改 μ：g = 0.0798（low-pass）、g = 0.9（p = 0.1 < 3 − 2√2，Nyquist 處衰減不到 3 dB）、g = 1.5（p = −0.5，high-pass）。ENBW 三者都有定義。',
    params: {
      ...DEFAULT_SHARED,
      seed: 20261010,
      engine: 'linear',
      cases: [
        { N: 4096, mu: 10, gmMode: 'average' },
        { N: 4096, mu: muForG(0.9), gmMode: 'average' },
        { N: 4096, mu: muForG(1.5), gmMode: 'average' },
      ],
    },
    expected: 'A：f_3dB = 12.93 kHz、ENBW = 20.29 kHz。B：p = 0.1，exact −3 dB 不存在（NaN），ENBW = 399.5 kHz。C：p = −0.5，high-pass，沒有 low-pass 頻寬，ENBW = 1.465 MHz（大於 f_u/2 = 488.3 kHz）',
    tests: ['T14'],
    source: 'simulation',
    check: [
      { caseIndex: 0, quantity: 'f3dbExact', value: 12931.284485590351, rel: 1e-9 },
      { caseIndex: 1, quantity: 'p', value: 0.1, rel: 1e-9 },
      { caseIndex: 1, quantity: 'f3dbExact', value: 'nan' },
      { caseIndex: 1, quantity: 'enbw', value: (976562.5 / 2) * (0.9 / 1.1), rel: 1e-9 },
      { caseIndex: 2, quantity: 'p', value: -0.5, rel: 1e-9 },
      { caseIndex: 2, quantity: 'f3dbExact', value: 'nan' },
      { caseIndex: 2, quantity: 'enbw', value: (976562.5 / 2) * 3, rel: 1e-9 },
    ],
  },
  {
    id: 'units-same-p-different-hz',
    title: '同一個 pole，不同的 Hz：N 改變時什麼會變？',
    page: '/formulas',
    experiment: UNITS_EXPERIMENT_ID,
    description: 'average mode、μ 固定 10 fs，N = 1024 / 4096 / 16384。g 與 p 完全不變（average mode 的 K 與 N 無關），但 f_u = f_s/N 變了，所以以 Hz 表示的頻寬差 4 倍；σ_w 則以 1/√N 改變。',
    params: {
      ...DEFAULT_SHARED,
      seed: 20261010,
      cases: [
        { N: 1024, mu: 10, gmMode: 'average' },
        { N: 4096, mu: 10, gmMode: 'average' },
        { N: 16384, mu: 10, gmMode: 'average' },
      ],
    },
    expected: '三個 case 的 g = 0.0798、p = 0.9202 相同；f_3dB = 51.73 / 12.93 / 3.233 kHz（∝ 1/N）；σ_w = 0.7984 / 0.3992 / 0.1996 fs（∝ 1/√N）；以 rad/block 表示的 Ω_3dB 三者相同',
    tests: ['T13', 'T14'],
    source: 'simulation',
    check: [
      { caseIndex: 0, quantity: 'p', value: 0.9202115439197135, rel: 1e-12 },
      { caseIndex: 2, quantity: 'p', value: 0.9202115439197135, rel: 1e-12 },
      { caseIndex: 0, quantity: 'f3dbExact', value: 4 * 12931.284485590351, rel: 1e-9 },
      { caseIndex: 2, quantity: 'f3dbExact', value: 12931.284485590351 / 4, rel: 1e-9 },
      { caseIndex: 0, quantity: 'sigmaW', value: 2 * 0.3991861429909288, rel: 1e-10 },
      { caseIndex: 2, quantity: 'sigmaW', value: 0.3991861429909288 / 2, rel: 1e-10 },
      { caseIndex: 0, quantity: 'fu', value: 3906250, rel: 1e-12 },
    ],
  },
  {
    id: 'units-polarity-negative-c',
    title: 'C < 0：單位都對，極性錯了',
    page: '/formulas',
    experiment: UNITS_EXPERIMENT_ID,
    description: '把有效 code 相關改成 C = −0.5（例如 Type-II 迴路的低頻 code，第 6 章）。K = K_q·C 變成負的，g < 0、p > 1：沒有穩態、沒有頻寬可言。',
    params: { ...DEFAULT_SHARED, C: -0.5, seed: 20261010, engine: 'linear', cases: [{ ...DEFAULT_CASE }] },
    expected: 'K = −0.003989 fs⁻¹、g = −0.03989、p = 1.0399 > 1：警告「C ≤ 0：更新極性錯誤」，σ_w、f_3dB、ENBW 都沒有定義；Monte Carlo 回報發散',
    tests: ['T06'],
    source: 'simulation',
    check: [
      { caseIndex: 0, quantity: 'g', value: -0.03989422804014327, rel: 1e-12 },
      { caseIndex: 0, quantity: 'p', value: 1.0398942280401433, rel: 1e-12 },
      { caseIndex: 0, quantity: 'sigmaW', value: 'nan' },
      { caseIndex: 0, quantity: 'enbw', value: 'nan' },
    ],
  },
]

export function unitsPresetById(id: string | null | undefined): UnitsPreset | undefined {
  if (!id) return undefined
  return UNITS_PRESETS.find((p) => p.id === id)
}
