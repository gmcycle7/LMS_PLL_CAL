/**
 * MIMO LMS Lab（experiment id 'mimo-lms'）的參數型別、預設值與 preset 解析（純函式，可測試）。
 * 矩陣一律以 3×3 儲存，P = 2 時取左上角 2×2；切換 P 不會遺失第三列的設定。
 */
import {
  DEFAULT_RULE,
  RULES,
  type JhatSource,
  type JhatSpec,
  type Mat,
  type MimoEngine,
  type MimoRule,
  type PlantMode,
  type PlantSpec,
  type RegForm,
  type RegressorDist,
  type RuleAnalysis,
  type RuleConfig,
} from '@/simulation/models/mimo'
import type { MetricRow } from '@/components/types'

export const EXPERIMENT_ID = 'mimo-lms'

export interface LabParams {
  P: 2 | 3
  mode: PlantMode
  /** R-mode 的自相關矩陣（3×3 儲存） */
  R: Mat
  /** J-mode 的正規化 Jacobian J_n = J/K_q（3×3 儲存） */
  Jn: Mat
  /** fs */
  sigmaV: number
  N: number
  dist: RegressorDist
  /** δ₀ = a − w₀（fs），長度 3 */
  delta0: number[]
  blocks: number
  engine: MimoEngine
  jhatSource: JhatSource
  /** 自訂 Ĵ_n（3×3 儲存） */
  jhatCustom: Mat
  perturbRel: number
  fdDeltaFs: number
  fdSamples: number
  /** 同一 seed 下額外畫出全部六種規則 */
  showAllRules: boolean
  mcChains: number
  mcRecord: number
}

export const DEFAULT_R3: Mat = [
  [1, 0.99, 0.3],
  [0.99, 1, 0.3],
  [0.3, 0.3, 1],
]

export const DEFAULT_J3: Mat = [
  [-1, 2, 0],
  [2, -1, 0],
  [0, 0, -1],
]

export const DEFAULT_PARAMS: LabParams = {
  P: 2,
  mode: 'R',
  R: DEFAULT_R3,
  Jn: DEFAULT_J3,
  sigmaV: 100,
  N: 4096,
  dist: 'gaussian',
  delta0: [30, 0, 10],
  blocks: 600,
  engine: 'linear',
  jhatSource: 'exact',
  jhatCustom: [
    [-1, -0.996, -0.3],
    [-0.996, -1, -0.3],
    [-0.3, -0.3, -1],
  ],
  perturbRel: 0.01,
  fdDeltaFs: 30,
  fdSamples: 4096,
  showAllRules: true,
  mcChains: 32,
  mcRecord: 1500,
}

export const DEFAULT_CASES: RuleConfig[] = [
  { ...DEFAULT_RULE, rule: 'scalar', muKq: 0.5 },
  { ...DEFAULT_RULE, rule: 'full', gamma: 0.5 },
  { ...DEFAULT_RULE, rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 },
]

export const DEFAULT_SEED = 20261010

/** 取左上角 P×P */
export function sliceMat(A: Mat, P: number): Mat {
  return A.slice(0, P).map((r) => r.slice(0, P))
}

/** 把 P×P 矩陣嵌回 3×3 底板 */
export function embedMat(base: Mat, A: Mat): Mat {
  const out = base.map((r) => r.slice())
  A.forEach((row, i) => row.forEach((v, j) => (out[i][j] = v)))
  return out
}

export function plantSpecOf(p: LabParams): PlantSpec {
  return p.mode === 'R'
    ? { mode: 'R', R: sliceMat(p.R, p.P), sigmaV: p.sigmaV, N: p.N, dist: p.dist }
    : { mode: 'J', Jn: sliceMat(p.Jn, p.P), sigmaV: p.sigmaV, N: p.N, dist: p.dist }
}

export function jhatSpecOf(p: LabParams): JhatSpec {
  return {
    source: p.jhatSource,
    custom: sliceMat(p.jhatCustom, p.P),
    perturbRel: p.perturbRel,
    fdDeltaFs: p.fdDeltaFs,
    fdSamples: p.fdSamples,
  }
}

export function delta0Of(p: LabParams): number[] {
  return p.delta0.slice(0, p.P)
}

/** 依 active case 的超參數產生六種規則（「全部規則同 seed」圖與 trade-off 表用） */
export function allRulesFrom(base: RuleConfig): RuleConfig[] {
  return RULES.map((rule) => ({ ...base, rule }))
}

// ───────────────────────────── preset 解析 ─────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseMat(v: unknown): Mat | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 3) return null
  const n = v.length
  if (!v.every((r) => Array.isArray(r) && r.length === n && r.every(isNum))) return null
  return (v as number[][]).map((r) => r.slice())
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  return isNum(v) && v >= lo && v <= hi ? v : fallback
}

export function parseRule(v: unknown, fallback: RuleConfig = DEFAULT_RULE): RuleConfig {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    rule: pick<MimoRule>(o.rule, RULES, fallback.rule),
    muKq: num(o.muKq, fallback.muKq, 0, 10),
    gamma: num(o.gamma, fallback.gamma, 0, 4),
    lambdaReg: num(o.lambdaReg, fallback.lambdaReg, 0, 1e6),
    regForm: pick<RegForm>(o.regForm, ['R', 'J'] as const, fallback.regForm),
    seqBlocksPerPhase: Math.round(num(o.seqBlocksPerPhase, fallback.seqBlocksPerPhase, 1, 100000)),
    seqSweeps: Math.round(num(o.seqSweeps, fallback.seqSweeps, 1, 10000)),
  }
}

export interface ParsedPreset {
  params: LabParams
  cases: RuleConfig[]
  seed: number
}

/** 把 preset 的 params（JSON）合併到預設值上；未知或不合法欄位一律退回預設。 */
export function parsePresetParams(raw: Record<string, unknown>, base: LabParams = DEFAULT_PARAMS): ParsedPreset {
  const P = raw.P === 3 ? 3 : raw.P === 2 ? 2 : base.P
  const R = parseMat(raw.R)
  const Jn = parseMat(raw.Jn)
  const custom = parseMat(raw.jhatCustom)
  const d0 = Array.isArray(raw.delta0) && raw.delta0.every(isNum) ? (raw.delta0 as number[]) : null
  const params: LabParams = {
    P,
    mode: pick<PlantMode>(raw.mode, ['R', 'J'] as const, base.mode),
    R: R ? embedMat(DEFAULT_R3, R) : base.R,
    Jn: Jn ? embedMat(DEFAULT_J3, Jn) : base.Jn,
    sigmaV: num(raw.sigmaV, base.sigmaV, 1e-6, 1e6),
    N: Math.round(num(raw.N, base.N, 1, 1 << 22)),
    dist: pick<RegressorDist>(raw.dist, ['gaussian', 'pm1'] as const, base.dist),
    delta0: d0 ? [0, 1, 2].map((i) => d0[i] ?? base.delta0[i]) : base.delta0,
    blocks: Math.round(num(raw.blocks, base.blocks, 1, 50000)),
    engine: pick<MimoEngine>(raw.engine, ['linear', 'sample'] as const, base.engine),
    jhatSource: pick<JhatSource>(raw.jhatSource, ['exact', 'custom', 'perturbed', 'finiteDiff'] as const, base.jhatSource),
    jhatCustom: custom ? embedMat(base.jhatCustom, custom) : base.jhatCustom,
    perturbRel: num(raw.perturbRel, base.perturbRel, 0, 10),
    fdDeltaFs: num(raw.fdDeltaFs, base.fdDeltaFs, 1e-6, 1e6),
    fdSamples: Math.round(num(raw.fdSamples, base.fdSamples, 1, 4e6)),
    showAllRules: typeof raw.showAllRules === 'boolean' ? raw.showAllRules : base.showAllRules,
    mcChains: Math.round(num(raw.mcChains, base.mcChains, 2, 4096)),
    mcRecord: Math.round(num(raw.mcRecord, base.mcRecord, 1, 1e6)),
  }
  const cases =
    Array.isArray(raw.cases) && raw.cases.length > 0
      ? raw.cases.slice(0, 3).map((c, i) => parseRule(c, DEFAULT_CASES[i] ?? DEFAULT_RULE))
      : DEFAULT_CASES.map((c) => ({ ...c }))
  const seed = isNum(raw.seed) ? Math.floor(raw.seed) >>> 0 : DEFAULT_SEED
  return { params, cases, seed }
}

/**
 * 指標列「Case X 95% 收斂 blocks k₉₅」：公式連結、claim 與說明跟著 blocks95 的來源走（審查 R02）。
 *  - 'pole'：A 正規，F-10.5 精確 ⇒ 連到 F-10.5、exact、不加說明。
 *  - 'norm'：逐 block 算範數得到的精確值，但不是 F-10.5 的數字 ⇒ 不連公式，說明裡列出 F-10.5 的下界。
 *  - 'lower-bound'：沒算完，只能列 F-10.5 的下界 ⇒ approx，名稱加上「下界」。
 */
export function k95Metric(caseId: string, a: RuleAnalysis): MetricRow {
  const row: MetricRow = {
    name: String.raw`Case ${caseId} 95% 收斂 blocks $k_{95}$`,
    value: a.blocks95 ?? (a.stable ? '—' : '不收斂'),
    claim: 'exact',
  }
  if (a.blocks95Basis === 'norm') {
    if (a.rule === 'sequential') return { ...row, note: String.raw`最壞初始方向：$\|\boldsymbol\Phi_j\|_2\le0.05$ 且之後不再超過` }
    const same = a.blocks95 === a.blocks95Asymptotic
    return {
      ...row,
      note:
        String.raw`$\mathbf A$ 非正規：逐 block 算 $\|\mathbf A^j\|_2\le0.05$（最壞初始方向，且之後不再超過）；只看 $\rho(\mathbf A)$ 的 F-10.5 給 $${a.blocks95Asymptotic}$，` +
        (same ? '只是下界（這組數字剛好相同）' : '只是下界'),
    }
  }
  if (a.blocks95Basis === 'lower-bound') {
    return {
      ...row,
      name: String.raw`Case ${caseId} 95% 收斂 blocks $k_{95}$（下界）`,
      formulaId: 'F-10.5',
      claim: 'approx',
      note: String.raw`$\mathbf A$ 非正規且衰減極慢：這是 F-10.5 的下界，實際更久（見警告）`,
    }
  }
  return { ...row, formulaId: 'F-10.5' }
}

/** 95% 等機率橢圓（χ²₂ 0.95 分位 = 5.991）：回傳 (x, y) 點列 */
export function ellipsePoints(cov2: Mat, scale = Math.sqrt(5.991464547107979), n = 120): { x: number[]; y: number[] } {
  const a = cov2[0][0]
  const b = cov2[0][1]
  const d = cov2[1][1]
  const tr = a + d
  const det = a * d - b * b
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = Math.max(tr / 2 + disc, 0)
  const l2 = Math.max(tr / 2 - disc, 0)
  // l1 的 eigenvector
  let vx = b
  let vy = l1 - a
  if (Math.abs(vx) + Math.abs(vy) < 1e-300) {
    vx = a >= d ? 1 : 0
    vy = a >= d ? 0 : 1
  }
  const nv = Math.hypot(vx, vy)
  vx /= nv
  vy /= nv
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n
    const c1 = scale * Math.sqrt(l1) * Math.cos(t)
    const c2 = scale * Math.sqrt(l2) * Math.sin(t)
    x.push(c1 * vx - c2 * vy)
    y.push(c1 * vy + c2 * vx)
  }
  return { x, y }
}
