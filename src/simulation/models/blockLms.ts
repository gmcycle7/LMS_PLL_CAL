/**
 * 參考 Block Sign-Error LMS 模擬器（規格 §15.2–§15.4；模型層級 L1 / L2 / L5）。
 *
 * ── 每個 comparator sample n（block k 內）的誤差模型 ──
 *   x[n]      ：seeded pattern 產生、依 code_normalization 正規化後的 code（無因次）
 *   δt[n]     = (a − w_applied,k)·x[n] + offset_fs + c2·x[n]² + c3·x[n]³          [fs]   （δ = a − w 極性）
 *   e[n]      = H_PD{δt}[n] + b + v[n]，v ~ N(0, σ_v²) iid                         [fs]
 *               H_PD 為有狀態 LTI 濾波器，**狀態跨 block 持續**（§15.2：不可每個 block 重置主 PLL）
 *               架構（docs/assumptions.md §2a）：DTC 在 reference 輸入端，a·x 是需要補的量、w_applied·x 是 DTC 的補償量；
 *               殘差 δt 在 PD 的 reference 輸入端注入（PD 輸出 = +H_PD{δt}），comparator 取的就是 PD 的輸出（送進 loop filter 的同一個節點）
 *   b[n]      = (e[n] ≥ 0)；tie 規則：e = 0 時 q = +1（§15.2「q = +1 if e >= 0」，E07）
 *               comparator.hysteresis_fs = h > 0 時門檻依上一個輸出而定（θ_a = −q[n−1]·h，Ch05 §5b）；
 *               comparator.meta_window_fs = ε > 0 時 |e − θ_a| < ε 的 sample 解不出來（metastable），依 meta_policy：
 *               drop（不累加、除數仍為 N）、hold（沿用上一個輸出）、late（正確的正負號晚一拍進 GMAC、乘到 x_ref[n+1]）。
 *               預設 h = ε = 0：與原本的無記憶 sign 逐位元相同。
 *   q[n]      = 2b − 1 ∈ {±1}（bipolar_pm_one / unipolar_mapped）；unipolar_unmapped_bug 時 q = b ∈ {0, 1}（反面測試）
 *   x_ref[n]  = x[n]（raw）、x[n − D]（delayed）、u_f[n − D] = (Ĥ * x)[n − D]（filtered），D = gm_code_delay_samples
 *   G_k       = (1/N)Σ q·x_ref（average）或 Σ q·x_ref（sum）
 *   w_{k+1}   = w_k + μ·G_k（μ = gain_step [fs]）；新值在 cal_update_delay_blocks = d 個 block 後才作用：
 *               w_applied,k = phys(w_{k−d})（k − d < 0 時用 w_0）⇒ 平均模型 δ_{k+1} = δ_k − gδ_{k−d}（§8.3）
 *   gain_register.quantize_physical = true 時：內部暫存器以 2^−F LSB 量化（F = internal_bits − physical_bits），
 *               DTC 實際使用 physical_bits 的 code（× lsb_fs）；rounding / overflow 依設定。false 時為理想浮點。
 *
 * ── 單位 ── 時間 fs；x 無因次；a、w 為 fs per unit code；μ 的單位為 [w]/[G]（average 模式為 fs）；
 *   K_q = √(2/π)/σ_v [fs⁻¹]；C = E[x_ref·u]（無因次）；g = μK_qC（average）或 μK_qCN（sum），無因次。
 *
 * ── 隨機性 ── root = createRng(seed)；code pattern 用 root.fork('code-pattern')（DSM dither 再 fork('dsm-dither')），
 *   comparator noise 用 root.fork('comparator-noise')，stochastic rounding 用 root.fork('gain-register-rounding')。
 *   comparator noise 一律抽樣（σ_v = 0 時也抽），所以只改 σ_v 的 paired simulation 使用同一組 z[n]。
 *
 * runBlockLms / analyzeBlockLms / runBlockLmsMonteCarlo / generateCodePattern 可由 Web Worker 呼叫
 * （參數為一個 plain object，回傳可 structured clone）。純數值、無 React/DOM。
 */

import { z } from 'zod'
import { createRng, deriveSeed, meanCI, normCdf, normPdf, polyRoots, cAbs, type Rng } from '@/simulation/core'
import { freqz, StreamFilter } from '@/simulation/signal'
import { errorPathTransfer, type DtTransfer, type ErrorPathSpec } from '@/simulation/models/pll'
import { nonidealSummary } from '@/simulation/models/comparator'
import {
  DsmStream,
  detectPeriod,
  normalizationParams,
  type CodeNormalization,
  type NormalizationParams,
} from '@/simulation/models/dsm'

// ───────────────────────────────────────────────────────────────────────────
// 常數
// ───────────────────────────────────────────────────────────────────────────

/** 單次模擬的總 sample 數上限（N × num_blocks） */
export const MAX_TOTAL_SAMPLES = 2 ** 28
/** trace 最多點數 */
export const MAX_TRACE_POINTS = 2 ** 21
/** 解析估計（C、固定點）使用的 code 樣本數上限 */
export const ANALYTIC_SAMPLES = 2 ** 17
/** mean-field 固定點求根使用的樣本數上限 */
export const MEAN_FIELD_SAMPLES = 2 ** 14
/** |w| 超過此值（fs）或非有限數即判定發散並停止 */
export const DIVERGENCE_LIMIT_FS = 1e12

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)

// ───────────────────────────────────────────────────────────────────────────
// Zod schema（規格 §15.3 JSON；snake_case key 保持原樣）
// ───────────────────────────────────────────────────────────────────────────

const finite = () => z.number().finite()

const ErrorPathSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('identity'), parameters: z.object({}).strict().default({}) }).strict(),
  z
    .object({
      kind: z.literal('single_tone'),
      parameters: z
        .object({
          magnitude: finite().min(0).default(1),
          phase_deg: finite().min(-360).max(360).default(0),
          /** Ω [rad/sample] */
          omega: z.number().min(0).max(Math.PI).default(Math.PI / 6),
        })
        .strict()
        .default({}),
    })
    .strict(),
  z.object({ kind: z.literal('fir'), parameters: z.object({ taps: z.array(finite()).min(1).max(1024) }).strict() }).strict(),
  z
    .object({
      kind: z.literal('first_order_hp'),
      parameters: z.object({ pole: z.number().gt(-1).lt(1).default(0.9) }).strict().default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('type2_dt'),
      parameters: z
        .object({
          /** ω_n T_s [rad/sample] */
          wn_ts: z.number().positive().max(2).default(0.05),
          zeta: z.number().positive().max(10).default(0.7),
          loop_delay: z.number().int().min(0).max(64).default(0),
          method: z.enum(['dpll', 'bilinear']).default('dpll'),
        })
        .strict()
        .default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('iir'),
      parameters: z.object({ b: z.array(finite()).min(1).max(64), a: z.array(finite()).min(1).max(64) }).strict(),
    })
    .strict(),
])

const DsmPatternParams = z
  .object({
    frac: z.number().min(0).lt(1).default(0.3),
    bits: z.number().int().min(1).max(32).default(20),
    dither: z.boolean().default(false),
    /** regressor 用 DTC phase residue（預設）或瞬時量化誤差 y − in/M */
    signal: z.enum(['residue', 'quant_error']).default('residue'),
    initial_state: z.array(z.number().int().min(0)).max(3).optional(),
  })
  .strict()
  .default({})

const PatternSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('iid_pm_one'), parameters: z.object({ amplitude: finite().positive().default(1) }).strict().default({}) })
    .strict(),
  z
    .object({
      kind: z.literal('gaussian'),
      parameters: z
        .object({
          mean: finite().default(0),
          sigma: finite().min(0).default(1),
          /** AR(1) 係數 ρ：y[n] = ρ y[n−1] + σ√(1−ρ²) w[n]（ρ = 0 為白色） */
          ar1: z.number().gt(-1).lt(1).default(0),
        })
        .strict()
        .default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('uniform'),
      parameters: z
        .object({ low: finite().default(-Math.sqrt(3)), high: finite().default(Math.sqrt(3)) })
        .strict()
        .refine((p) => p.high > p.low, { message: 'uniform 需要 high > low' })
        .default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('sinusoid'),
      parameters: z
        .object({
          amplitude: finite().positive().default(1),
          /** Ω [rad/sample] */
          omega: z.number().min(0).max(Math.PI).default(Math.PI / 6),
          phase_deg: finite().default(0),
          random_phase: z.boolean().default(false),
        })
        .strict()
        .default({}),
    })
    .strict(),
  z.object({ kind: z.literal('dsm_first_order'), parameters: DsmPatternParams }).strict(),
  z.object({ kind: z.literal('mash111'), parameters: DsmPatternParams }).strict(),
])

const GainRegisterSchema = z
  .object({
    /** 內部高解析暫存器總位元數（含 physical_bits 的整數部分）；小數位元 F = internal_bits − physical_bits */
    internal_bits: z.number().int().min(1).max(48).default(20),
    physical_bits: z.number().int().min(1).max(24).default(6),
    rounding: z.enum(['nearest', 'truncate', 'stochastic']).default('nearest'),
    overflow: z.enum(['saturate', 'wrap']).default('saturate'),
    /** 是否啟用定點／實體 code 量化（規格 §15.3：physical_bits 只在量化實驗開啟時生效） */
    quantize_physical: z.boolean().default(false),
    /** 實體 gain code 的 LSB [fs per unit code]（E13 建議的 gain_lsb_fs） */
    lsb_fs: finite().positive().default(0.125),
    /** 實體 code 是否為二補數有號 */
    signed: z.boolean().default(false),
  })
  .strict()
  .refine((g) => g.internal_bits >= g.physical_bits, { message: 'internal_bits 必須 ≥ physical_bits', path: ['internal_bits'] })
  .default({})

/** Ch05 §5b：非理想 comparator（hysteresis ±h、metastability 決策窗 ε）。預設全部關閉。 */
const ComparatorSchema = z
  .object({
    /** hysteresis 半寬 h [fs]：有效門檻 θ_a = −q[n−1]·h（上一個輸出 +1 時門檻降到 −h）；0 = 無記憶的 sign */
    hysteresis_fs: finite().min(0).default(0),
    /** metastability 決策窗 ε [fs]：|e − θ_a| < ε 的 sample 在取樣週期內解不出來；0 = 關閉 */
    meta_window_fs: finite().min(0).default(0),
    /** metastable 的 sample 怎麼進 GMAC：drop（不累加）、hold（沿用上一個輸出）、late（正確的正負號晚一拍、乘到下一個 regressor） */
    meta_policy: z.enum(['drop', 'hold', 'late']).default('drop'),
  })
  .strict()
  .default({})

const FilteredXSchema = z
  .object({
    /** Ĥ 的基礎模型：'same_as_path'（預設，Ĥ = H）或另一個 error path */
    path: z.union([z.literal('same_as_path'), ErrorPathSchema]).default('same_as_path'),
    /** Ĥ = gain_mismatch · H_model · z^{−extra_delay_samples} */
    gain_mismatch: finite().default(1),
    extra_delay_samples: z.number().int().min(0).max(4096).default(0),
  })
  .strict()
  .default({})

const BaseSchema = z
  .object({
    model: z.literal('sign_error_block_lms').default('sign_error_block_lms'),
    seed: z.number().int().min(0).max(4294967295).default(20261010),
    units: z.object({ time: z.literal('fs').default('fs'), frequency: z.literal('Hz').default('Hz') }).strict().default({}),
    sample_rate_hz: finite().positive().default(4e9),
    output_frequency_hz: finite().positive().default(13e9),
    gm_accum_samples: z.number().int().min(1).max(1 << 20).default(4096),
    gain_initial: finite().default(0),
    gain_true: finite().default(3),
    gain_step: finite().default(10),
    code_normalization: z.enum(['none', 'zero_mean', 'unit_rms', 'standardize']).default('unit_rms'),
    gm_mode: z.enum(['average', 'sum']).default('average'),
    pd_noise_rms_fs: finite().min(0).default(100),
    comparator_offset_fs: finite().default(0),
    comparator_encoding: z.enum(['bipolar_pm_one', 'unipolar_mapped', 'unipolar_unmapped_bug']).default('bipolar_pm_one'),
    gm_code_delay_samples: z.number().int().min(0).max(65536).default(0),
    cal_update_delay_blocks: z.number().int().min(0).max(64).default(0),
    pll_error_path: ErrorPathSchema.default({ kind: 'identity', parameters: {} }),
    seeded_pattern: PatternSchema.default({ kind: 'iid_pm_one', parameters: {} }),
    gain_register: GainRegisterSchema,
    mode: z.string().max(64).default('exploratory'),
    // ── 以下為本站擴充 ──
    num_blocks: z.number().int().min(1).max(1_000_000).default(2000),
    regressor_mode: z.enum(['raw', 'delayed', 'filtered']).default('raw'),
    filtered_x_model: FilteredXSchema,
    dtc_nonlinearity: z
      .object({ offset_fs: finite().default(0), c2: finite().default(0), c3: finite().default(0) })
      .strict()
      .default({}),
    comparator: ComparatorSchema,
    record: z
      .object({
        sample_trace_blocks: z.number().int().min(0).default(2),
        decimate: z.number().int().min(1).default(1),
      })
      .strict()
      .default({}),
  })
  .strict()

function checkPath(spec: z.infer<typeof ErrorPathSchema>, path: (string | number)[], ctx: z.RefinementCtx): void {
  try {
    errorPathTransfer(spec as ErrorPathSpec)
  } catch (err) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err instanceof Error ? err.message : String(err), path })
  }
}

export const BlockLmsConfigSchema = BaseSchema.superRefine((cfg, ctx) => {
  const total = cfg.gm_accum_samples * cfg.num_blocks
  if (total > MAX_TOTAL_SAMPLES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `總樣本數 N × num_blocks = ${total} 超過上限 ${MAX_TOTAL_SAMPLES}（請減少 block 數或 N）`,
      path: ['num_blocks'],
    })
  }
  if (cfg.record.sample_trace_blocks > cfg.num_blocks) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sample_trace_blocks 不可大於 num_blocks', path: ['record', 'sample_trace_blocks'] })
  }
  const tracePts = Math.ceil((cfg.record.sample_trace_blocks * cfg.gm_accum_samples) / cfg.record.decimate)
  if (tracePts > MAX_TRACE_POINTS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `trace 點數 ${tracePts} 超過上限 ${MAX_TRACE_POINTS}（請減少 sample_trace_blocks 或加大 decimate）`,
      path: ['record'],
    })
  }
  checkPath(cfg.pll_error_path, ['pll_error_path'], ctx)
  if (cfg.filtered_x_model.path !== 'same_as_path') checkPath(cfg.filtered_x_model.path, ['filtered_x_model', 'path'], ctx)
  const p = cfg.seeded_pattern
  if ((p.kind === 'dsm_first_order' || p.kind === 'mash111') && p.parameters.initial_state) {
    const M = 2 ** p.parameters.bits
    const stages = p.kind === 'mash111' ? 3 : 1
    if (p.parameters.initial_state.length > stages || p.parameters.initial_state.some((v) => v >= M)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `initial_state 最多 ${stages} 個、每個 ∈ [0, 2^bits)`,
        path: ['seeded_pattern', 'parameters', 'initial_state'],
      })
    }
  }
})

export type BlockLmsConfig = z.output<typeof BlockLmsConfigSchema>
export type BlockLmsConfigInput = z.input<typeof BlockLmsConfigSchema>
export type SeededPattern = BlockLmsConfig['seeded_pattern']
export type BlockLmsErrorPath = BlockLmsConfig['pll_error_path']

/** 繁體中文錯誤訊息 */
const zhErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: '必填欄位' }
      if (issue.expected === 'integer') return { message: '必須為整數' }
      return { message: `型別錯誤：預期 ${issue.expected}，收到 ${issue.received}` }
    case z.ZodIssueCode.invalid_literal:
      return { message: `必須為 ${JSON.stringify(issue.expected)}` }
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `未知的欄位：${issue.keys.join(', ')}` }
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `kind 必須為 ${issue.options.map((o) => `'${String(o)}'`).join(' | ')}` }
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `必須為 ${issue.options.map((o) => `'${String(o)}'`).join(' | ')}，收到 '${String(issue.received)}'` }
    case z.ZodIssueCode.invalid_union:
      return { message: '不符合任何允許的格式' }
    case z.ZodIssueCode.too_small:
      if (issue.type === 'array') return { message: `至少需要 ${String(issue.minimum)} 個元素` }
      if (issue.type === 'string') return { message: `長度至少 ${String(issue.minimum)}` }
      return { message: `必須 ${issue.inclusive ? '≥' : '>'} ${String(issue.minimum)}` }
    case z.ZodIssueCode.too_big:
      if (issue.type === 'array') return { message: `最多 ${String(issue.maximum)} 個元素` }
      if (issue.type === 'string') return { message: `長度最多 ${String(issue.maximum)}` }
      return { message: `必須 ${issue.inclusive ? '≤' : '<'} ${String(issue.maximum)}` }
    case z.ZodIssueCode.not_finite:
      return { message: '必須為有限數' }
    case z.ZodIssueCode.custom:
      return { message: issue.message ?? ctx.defaultError }
    default:
      return { message: ctx.defaultError }
  }
}

export type ParseResult =
  | { ok: true; config: BlockLmsConfig; errors: string[] }
  | { ok: false; config: null; errors: string[] }

/**
 * 驗證並補齊預設值（JSON 物件或 JSON 字串）。錯誤訊息為繁體中文，格式「欄位路徑：訊息」。
 */
export function parseBlockLmsConfig(json: unknown): ParseResult {
  let input = json
  if (typeof json === 'string') {
    try {
      input = JSON.parse(json) as unknown
    } catch (err) {
      return { ok: false, config: null, errors: [`JSON 格式錯誤：${err instanceof Error ? err.message : String(err)}`] }
    }
  }
  const r = BlockLmsConfigSchema.safeParse(input ?? {}, { errorMap: zhErrorMap })
  if (r.success) return { ok: true, config: r.data, errors: [] }
  return {
    ok: false,
    config: null,
    errors: r.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '（根）'}：${i.message}`),
  }
}

/** 規格 §15.3 的範例 JSON（原文） */
export const SPEC_15_3_EXAMPLE = {
  model: 'sign_error_block_lms',
  seed: 20261010,
  units: { time: 'fs', frequency: 'Hz' },
  sample_rate_hz: 4000000000,
  output_frequency_hz: 13000000000,
  gm_accum_samples: 4096,
  gain_initial: 0,
  gain_true: 3,
  gain_step: 10,
  code_normalization: 'unit_rms',
  gm_mode: 'average',
  pd_noise_rms_fs: 100,
  comparator_offset_fs: 0,
  comparator_encoding: 'bipolar_pm_one',
  gm_code_delay_samples: 0,
  cal_update_delay_blocks: 0,
  pll_error_path: { kind: 'identity', parameters: {} },
  seeded_pattern: { kind: 'iid_pm_one', parameters: {} },
  gain_register: { internal_bits: 20, physical_bits: 6, rounding: 'nearest', overflow: 'saturate' },
  mode: 'exploratory',
} as const

/** 規格 §15.3 範例補齊擴充欄位預設值後的完整設定（請勿直接修改；用展開或 structuredClone 產生變體）。 */
export const DEFAULT_BLOCK_LMS_CONFIG: BlockLmsConfig = BlockLmsConfigSchema.parse(SPEC_15_3_EXAMPLE)

// ───────────────────────────────────────────────────────────────────────────
// 快速 Gaussian（Ziggurat）
// ───────────────────────────────────────────────────────────────────────────

const ZIG_KN = new Float64Array(128)
const ZIG_WN = new Float64Array(128)
const ZIG_FN = new Float64Array(128)
const ZIG_R = 3.442619855899
;(() => {
  // Marsaglia & Tsang (2000) RNOR 表格（128 層）
  const m1 = 2147483648
  let dn = ZIG_R
  let tn = dn
  const vn = 9.91256303526217e-3
  const q = vn / Math.exp(-0.5 * dn * dn)
  ZIG_KN[0] = (dn / q) * m1
  ZIG_KN[1] = 0
  ZIG_WN[0] = q / m1
  ZIG_WN[127] = dn / m1
  ZIG_FN[0] = 1
  ZIG_FN[127] = Math.exp(-0.5 * dn * dn)
  for (let i = 126; i >= 1; i--) {
    dn = Math.sqrt(-2 * Math.log(vn / dn + Math.exp(-0.5 * dn * dn)))
    ZIG_KN[i + 1] = (dn / tn) * m1
    tn = dn
    ZIG_FN[i] = Math.exp(-0.5 * dn * dn)
    ZIG_WN[i] = dn / m1
  }
})()

/**
 * 以 rng 的 32-bit 輸出產生 N(0, 1)：Marsaglia–Tsang Ziggurat（128 層），比 Box–Muller 快約 3–4 倍。
 * 層索引與數值使用**不同**的 32-bit 字（避免 Doornik 2005 指出的同位元相依問題）。
 * 仍完全由 createRng(seed) 決定、可重現；分布正確性由 KS 檢定與尾端機率測試驗證。
 * （建議上移到 core/rng.ts 作為 Rng 的 fastNormal。）
 */
export function createZigguratNormal(rng: Rng): () => number {
  const uni = (): number => 1 - rng.uniform() // (0, 1]
  return (): number => {
    let iz = rng.uint32() & 127
    let hz = rng.uint32() | 0
    if (Math.abs(hz) < ZIG_KN[iz]) return hz * ZIG_WN[iz]
    for (;;) {
      const x = hz * ZIG_WN[iz]
      if (iz === 0) {
        let xt: number
        let yt: number
        do {
          xt = -Math.log(uni()) / ZIG_R
          yt = -Math.log(uni())
        } while (yt + yt < xt * xt)
        return hz > 0 ? ZIG_R + xt : -ZIG_R - xt
      }
      if (ZIG_FN[iz] + rng.uniform() * (ZIG_FN[iz - 1] - ZIG_FN[iz]) < Math.exp(-0.5 * x * x)) return x
      iz = rng.uint32() & 127
      hz = rng.uint32() | 0
      if (Math.abs(hz) < ZIG_KN[iz]) return hz * ZIG_WN[iz]
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Code pattern
// ───────────────────────────────────────────────────────────────────────────

/** 串流 code 產生器：fill(buf, offset, count) 依序寫入原始（未正規化）code。 */
export interface CodeSource {
  fill(buf: Float64Array, offset: number, count: number): void
}

/** 建立 code 產生器（同 pattern + 同 seed 的 rng ⇒ 完全相同的序列）。 */
export function createCodeSource(pattern: SeededPattern, rng: Rng): CodeSource {
  switch (pattern.kind) {
    case 'iid_pm_one': {
      const A = pattern.parameters.amplitude
      return {
        fill(buf, off, cnt) {
          for (let i = 0; i < cnt; i++) buf[off + i] = (rng.uint32() >>> 31) === 1 ? A : -A
        },
      }
    }
    case 'gaussian': {
      const { mean, sigma, ar1 } = pattern.parameters
      const g = sigma * Math.sqrt(1 - ar1 * ar1)
      let y = 0
      let first = true
      return {
        fill(buf, off, cnt) {
          for (let i = 0; i < cnt; i++) {
            if (first) {
              y = sigma * rng.normal() // 平穩分布起點
              first = false
            } else {
              y = ar1 * y + g * rng.normal()
            }
            buf[off + i] = mean + y
          }
        },
      }
    }
    case 'uniform': {
      const { low, high } = pattern.parameters
      const span = high - low
      return {
        fill(buf, off, cnt) {
          for (let i = 0; i < cnt; i++) buf[off + i] = low + span * rng.uniform()
        },
      }
    }
    case 'sinusoid': {
      const { amplitude, omega, phase_deg, random_phase } = pattern.parameters
      const phi0 = random_phase ? 2 * Math.PI * rng.uniform() : (phase_deg * Math.PI) / 180
      let n = 0
      return {
        fill(buf, off, cnt) {
          for (let i = 0; i < cnt; i++, n++) buf[off + i] = amplitude * Math.cos(omega * n + phi0)
        },
      }
    }
    case 'dsm_first_order':
    case 'mash111': {
      const p = pattern.parameters
      const s = new DsmStream(
        {
          kind: pattern.kind === 'mash111' ? 'mash111' : 'first_order',
          frac: p.frac,
          bits: p.bits,
          dither: p.dither,
          initialState: p.initial_state,
        },
        rng.fork('dsm-dither'),
      )
      const useResidue = p.signal === 'residue'
      return {
        fill(buf, off, cnt) {
          for (let i = 0; i < cnt; i++) {
            s.step()
            buf[off + i] = useResidue ? s.residue : s.quantError
          }
        },
      }
    }
  }
}

/**
 * 產生一段（正規化後的）code pattern，與 runBlockLms 內部使用的序列完全相同
 * （同 seed、同 pattern、同 normalization；統計量取自整段 length）。worker 可呼叫。
 */
export function generateCodePattern(p: {
  pattern: SeededPattern | z.input<typeof PatternSchema>
  length: number
  seed: number
  normalization?: CodeNormalization
}): { code: Float64Array; raw: Float64Array; normalization: NormalizationParams & { mean: number; rms: number; std: number } } {
  const pattern = PatternSchema.parse(p.pattern, { errorMap: zhErrorMap })
  if (!Number.isInteger(p.length) || p.length < 1) throw new Error(`length 必須為正整數，收到 ${p.length}`)
  const src = createCodeSource(pattern, createRng(p.seed).fork('code-pattern'))
  const raw = new Float64Array(p.length)
  src.fill(raw, 0, p.length)
  const st = rawStats(raw, raw.length)
  const np = normalizationParams(st, p.normalization ?? 'none')
  const code = new Float64Array(p.length)
  for (let i = 0; i < p.length; i++) code[i] = (raw[i] - np.offset) * np.scale
  return { code, raw, normalization: { ...np, mean: st.mean, rms: st.rms, std: st.std } }
}

function rawStats(x: ArrayLike<number>, n: number): { mean: number; rms: number; std: number } {
  let s = 0
  let c = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]
    const t = s + v
    c += Math.abs(s) >= Math.abs(v) ? s - t + v : v - t + s
    s = t
  }
  const mean = (s + c) / n
  let v2 = 0
  let ms = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean
    v2 += d * d
    ms += x[i] * x[i]
  }
  return { mean, rms: Math.sqrt(ms / n), std: Math.sqrt(v2 / n) }
}

/** 串流版統計（以第一個樣本為 shift 的平移和；Neumaier 補償一次和），供長序列的 normalization 預掃描 */
class StreamingStats {
  n = 0
  private shift = 0
  private s1 = 0
  private c1 = 0
  private s2 = 0
  push(v: number): void {
    if (this.n === 0) this.shift = v
    const d = v - this.shift
    const t = this.s1 + d
    this.c1 += Math.abs(this.s1) >= Math.abs(d) ? this.s1 - t + d : d - t + this.s1
    this.s1 = t
    this.s2 += d * d
    this.n++
  }
  get mean(): number {
    return this.shift + (this.s1 + this.c1) / this.n
  }
  get std(): number {
    const m = (this.s1 + this.c1) / this.n
    return Math.sqrt(Math.max(0, this.s2 / this.n - m * m))
  }
  get rms(): number {
    const mu = this.mean
    const sd = this.std
    return Math.sqrt(sd * sd + mu * mu)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 結果型別
// ───────────────────────────────────────────────────────────────────────────

export type BlockLmsModelLevel = 'L1' | 'L2' | 'L5'

export interface BlockLmsAnalytic {
  /** K_q = √(2/π)/σ_v [fs⁻¹]（小訊號；σ_v = 0 時 NaN） */
  Kq: number
  /** C = E[x_ref·u]，u = H_PD{x}（由前 statsSamples 個 code 估計） */
  Cest: number
  /** 有效 GMAC 斜率 K = K_q·C·(bug 時 ½) [fs⁻¹，per-sample average G] */
  K: number
  /** 無因次迴路增益 g = μK（sum 模式再乘 N） */
  g: number
  /** 平均更新 pole p = 1 − g（d = 0 的一階模型） */
  p: number
  /** 平均模型 δ_{k+1} = δ_k − gδ_{k−d} 是否穩定（所有根 |z| < 1） */
  stableMean: boolean
  /** 該特徵方程的 spectral radius */
  rhoMean: number
  /** 臨界增益 2 sin(π/(4d+2))（d = 0 時為 2） */
  gCritical: number
  /** 預測 σ_w [fs]（GMAC 雜訊 iid、線性化；不穩定時 NaN） */
  sigmaWPred: number
  /** 每 block 的 GMAC 雜訊變異數 σ_η²（G 的單位²） */
  sigmaEta2: number
  /** Calibration PM [deg] = 90° − (2d+1)·asin(g/2)（0 < g ≤ 2；否則 NaN） */
  pmDeg: number
  /** Block update rate f_u = f_s/N [Hz] */
  fuHz: number
  /** d = 0 時的 exact −3 dB 頻率 [Hz]（不存在時 NaN；E27） */
  f3dbHz: number
  /** d = 0 時 one-sided ENBW = f_u(1−p)/(2(1+p)) [Hz]（E06） */
  enbwHz: number
  /** 收斂時間常數 −1/ln ρ [blocks] */
  tauBlocks: number
  /** 線性化固定點 w* = a + (E[x_ref·H{nl}] + b·E[x_ref])/C（bug 時再加 E[x_ref]/(K_q C)）[fs] */
  wStarLinear: number
  /** Mean-field 固定點：E_v[G(w)] = 0 的根（Gaussian v、凍結 w、此 code 序列）[fs]；找不到時 NaN */
  wStarMeanField: number
  /** Mean-field 斜率 S = −∂E[G]/∂w 在 w* 的值 [fs⁻¹]（> 0 才有恢復力） */
  slopeMeanField: number
  /** μ·S（sum 模式乘 N） */
  gMeanField: number
  /** 正規化後 code 的 E[x]、E[x²]，以及 x_ref 的 E[x_ref]、E[x_ref²] */
  Ex: number
  Ex2: number
  ExRef: number
  ExRef2: number
  /** 解析估計所用樣本數 */
  statsSamples: number
  /** code 正規化參數（code = (raw − offset)·scale） */
  normalization: NormalizationParams
  /**
   * Ch05 §5b：comparator.hysteresis_fs 或 meta_window_fs > 0 時才有。以 x ≡ 1 的 chain 在工作點 e = 0 的平穩統計估計：
   * slopeRatio = dE[y]/ds ÷ K_q（遲滯讓它 > 1）、noiseFactor = lim Var(S_N)/N（iid 為 1）、nu = 記憶因子、pMeta = 漏掉的比例、
   * kqEffRatio = slopeRatio/√noiseFactor（資訊等效增益；所需樣本數是它平方的倒數）。drop 以外的政策只有模擬，這些量仍以 drop 的 chain 估計。
   */
  comparatorModel?: { h: number; eps: number; policy: 'drop' | 'hold' | 'late'; slopeRatio: number; noiseFactor: number; nu: number; pMeta: number; kqEffRatio: number }
}

export interface BlockLmsMetrics {
  /** 後半段（block ⌈(K+1)/2⌉…K）的內部暫存器 w 平均 [fs] */
  meanW: number
  /** 後半段 w 標準差（ddof = 1）[fs] */
  stdW: number
  /** 後半段實際作用的 gain 平均 [fs] */
  meanWPhys: number
  /** meanW − a [fs] */
  bias: number
  /** 後半段 mean((w − a)²) [fs²] */
  mse: number
  /** 第一個之後永遠落在 |w − meanW| ≤ max(4·stdW, …) 的 block；未收斂為 null */
  settlingBlock: number | null
  /** 暫存器飽和事件數（內部或實體 code，saturate 模式） */
  saturationCount: number
  /** 暫存器 wrap 事件數（wrap 模式） */
  wrapCount: number
  /** 後半段實體 code 改變的次數（toggle；只在 quantize_physical 時計算） */
  limitCycleCount: number
  /** 後半段實體 code 的最小週期（0 = 無週期；只在 quantize_physical 時計算） */
  limitCyclePeriod: number
  /** stdW / sigmaWPred */
  sigmaWRatio: number
  /** analytic.wStarMeanField − a */
  biasPred: number
  diverged: boolean
  /** 判定發散的 block（未發散為 null）；之後的 w、G 為 NaN */
  divergenceBlock: number | null
  meanG: number
}

export interface BlockLmsResult {
  config: BlockLmsConfig
  blocks: {
    /** w[k]：第 k 次更新後的內部暫存器值，w[0] = w_0；長度 num_blocks + 1 [fs] */
    w: Float64Array
    /** wPhys[k]：w[k] 對應實際作用於 DTC 的 gain（未量化時 = w）[fs]；block k 使用 wPhys[max(0, k−d)] */
    wPhys: Float64Array
    /** G[k]：block k 的 GMAC 輸出（average 無因次；sum 為總和） */
    G: Float64Array
  }
  /** 前 sample_trace_blocks 個 block 的逐 sample 紀錄（每 decimate 取 1） */
  trace: {
    n: Float64Array
    x: Float64Array
    /** u = H_PD{x}（有效 regressor，與 x 同單位） */
    u: Float64Array
    /** comparator 前的誤差 e [fs] */
    e: Float64Array
    /** GMAC 使用的 comparator 輸出（bug 模式為 0/1） */
    q: Float64Array
    xRef: Float64Array
  }
  metrics: BlockLmsMetrics
  analytic: BlockLmsAnalytic
  warnings: string[]
  assumptions: string[]
  modelLevel: BlockLmsModelLevel
  units: Record<string, string>
}

// ───────────────────────────────────────────────────────────────────────────
// 準備：normalization 預掃描、路徑、解析量
// ───────────────────────────────────────────────────────────────────────────

interface Prepared {
  cfg: BlockLmsConfig
  N: number
  K: number
  D: number
  dUp: number
  path: DtTransfer & { identity: boolean }
  hat: DtTransfer | null
  norm: NormalizationParams
  analytic: BlockLmsAnalytic
  warnings: string[]
  assumptions: string[]
  modelLevel: BlockLmsModelLevel
}

function pathTransfer(spec: BlockLmsErrorPath): DtTransfer & { identity: boolean } {
  const tf = errorPathTransfer(spec as ErrorPathSpec)
  return { b: tf.b, a: tf.a, identity: spec.kind === 'identity' }
}

function filterInPlace(tf: DtTransfer, x: Float64Array): Float64Array {
  const f = new StreamFilter(tf.b, tf.a)
  const y = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = f.step(x[i])
  return y
}

/** δ_{k+1} = δ_k − gδ_{k−d} + η_k 的雜訊增益 Σ h_k²（不穩定或不收斂時 NaN） */
function calNoiseGain(g: number, d: number, stable: boolean): number {
  if (!stable) return NaN
  if (d === 0) {
    const p = 1 - g
    return 1 / (1 - p * p)
  }
  const L = d + 1
  const hist = new Float64Array(L) // ring：y[k−1] … y[k−d−1]
  let energy = 0
  let yPrev = 0
  let idx = 0
  const maxIter = 5_000_000
  let small = 0
  for (let k = 0; k < maxIter; k++) {
    const yDelayed = hist[idx] // y[k − d − 1]
    const y = yPrev - g * yDelayed + (k === 0 ? 1 : 0)
    hist[idx] = y
    idx = (idx + 1) % L
    yPrev = y
    const y2 = y * y
    energy += y2
    if (k > 10 * L && y2 < 1e-18 * energy) {
      if (++small > 4 * L) return energy
    } else small = 0
  }
  return NaN
}

// #region core:roundWith
function roundWith(v: number, mode: 'nearest' | 'truncate' | 'stochastic', rng: Rng): number {
  if (mode === 'nearest') return Math.floor(v + 0.5)
  if (mode === 'truncate') return Math.floor(v)
  return Math.floor(v + rng.uniform())
}
// #endregion

function prepare(cfg: BlockLmsConfig): Prepared {
  const warnings: string[] = []
  const N = cfg.gm_accum_samples
  const K = cfg.num_blocks
  const total = N * K
  const mode = cfg.regressor_mode
  let D = cfg.gm_code_delay_samples
  if (mode === 'raw' && D !== 0) {
    warnings.push(`regressor_mode = raw 時忽略 gm_code_delay_samples = ${D}（請改用 delayed 或 filtered）`)
    D = 0
  }
  const dUp = cfg.cal_update_delay_blocks
  const a = cfg.gain_true
  const mu = cfg.gain_step
  const sigma = cfg.pd_noise_rms_fs
  const b = cfg.comparator_offset_fs
  const nl = cfg.dtc_nonlinearity
  const bug = cfg.comparator_encoding === 'unipolar_unmapped_bug'
  const sumMode = cfg.gm_mode === 'sum'

  // ── 路徑 ──
  const path = pathTransfer(cfg.pll_error_path)
  let hat: DtTransfer | null = null
  if (mode === 'filtered') {
    const fx = cfg.filtered_x_model
    const base = fx.path === 'same_as_path' ? path : pathTransfer(fx.path)
    hat = {
      b: new Array<number>(fx.extra_delay_samples).fill(0).concat(base.b.map((v) => v * fx.gain_mismatch)),
      a: base.a.slice(),
    }
  }
  // IIR 路徑穩定性
  const checkStable = (tf: DtTransfer, name: string): void => {
    if (tf.a.length <= 1) return
    let m = tf.a.length
    while (m > 1 && tf.a[m - 1] === 0) m--
    const roots = polyRoots(tf.a.slice(0, m))
    const r = roots.reduce((acc, z0) => Math.max(acc, cAbs(z0)), 0)
    if (r >= 1) warnings.push(`${name} 不穩定（pole 半徑 ${r.toPrecision(6)} ≥ 1）：模擬結果無物理意義`)
  }
  checkStable(path, 'pll_error_path')
  if (hat) checkStable(hat, 'filtered-x 模型 Ĥ')

  // ── normalization 預掃描（整段 record）＋ 解析樣本 ──
  const S = Math.min(total, ANALYTIC_SAMPLES)
  const head = new Float64Array(S)
  const src = createCodeSource(cfg.seeded_pattern, createRng(cfg.seed).fork('code-pattern'))
  let norm: NormalizationParams
  if (cfg.code_normalization === 'none') {
    src.fill(head, 0, S)
    norm = { mode: 'none', offset: 0, scale: 1, warnings: [] }
  } else {
    const st = new StreamingStats()
    const chunk = new Float64Array(Math.min(total, 1 << 16))
    let done = 0
    while (done < total) {
      const cnt = Math.min(chunk.length, total - done)
      src.fill(chunk, 0, cnt)
      for (let i = 0; i < cnt; i++) st.push(chunk[i])
      const take = Math.min(cnt, S - done)
      if (take > 0) head.set(chunk.subarray(0, take), done)
      done += cnt
    }
    norm = normalizationParams({ mean: st.mean, rms: st.rms, std: st.std }, cfg.code_normalization)
    warnings.push(...norm.warnings)
  }
  const x = new Float64Array(S)
  for (let i = 0; i < S; i++) x[i] = (head[i] - norm.offset) * norm.scale

  // ── 解析量 ──
  const u = path.identity ? x : filterInPlace(path, x)
  const nlx = new Float64Array(S)
  const hasNl = nl.offset_fs !== 0 || nl.c2 !== 0 || nl.c3 !== 0
  if (hasNl) for (let i = 0; i < S; i++) nlx[i] = nl.offset_fs + x[i] * x[i] * (nl.c2 + nl.c3 * x[i])
  const unl = path.identity || !hasNl ? nlx : filterInPlace(path, nlx)
  const base = hat ? filterInPlace(hat, x) : x
  const xref = new Float64Array(S)
  for (let i = 0; i < S; i++) xref[i] = i - D >= 0 ? base[i - D] : 0
  const s0 = Math.min(Math.floor(S / 8), 4096)
  const cnt = S - s0
  let Ex = 0
  let Ex2 = 0
  let ExRef = 0
  let ExRef2 = 0
  let C = 0
  let Cnl = 0
  let Eu2 = 0
  for (let i = s0; i < S; i++) {
    Ex += x[i]
    Ex2 += x[i] * x[i]
    ExRef += xref[i]
    ExRef2 += xref[i] * xref[i]
    C += xref[i] * u[i]
    Cnl += xref[i] * unl[i]
    Eu2 += u[i] * u[i]
  }
  Ex /= cnt
  Ex2 /= cnt
  ExRef /= cnt
  ExRef2 /= cnt
  C /= cnt
  Cnl /= cnt
  Eu2 /= cnt

  // #region core:blockLmsAnalyticGain
  const Kq = sigma > 0 ? SQRT_2_OVER_PI / sigma : NaN
  const encFactor = bug ? 0.5 : 1
  const Kgm = Kq * C * encFactor
  const g = mu * Kgm * (sumMode ? N : 1)
  const pole = 1 - g
  // 平均模型 z^{d+1} − z^d + g = 0
  const charPoly = new Array<number>(dUp + 2).fill(0)
  charPoly[0] = 1
  charPoly[1] = -1
  charPoly[dUp + 1] += g
  let rhoMean = NaN
  if (Number.isFinite(g)) rhoMean = polyRoots(charPoly).reduce((acc, z0) => Math.max(acc, cAbs(z0)), 0)
  const stableMean = rhoMean < 1
  const gCritical = 2 * Math.sin(Math.PI / (4 * dUp + 2))
  const pmDeg = g > 0 && g <= 2 ? 90 - (2 * dUp + 1) * ((Math.asin(g / 2) * 180) / Math.PI) : NaN
  const fuHz = cfg.sample_rate_hz / N
  let f3dbHz = NaN
  let enbwHz = NaN
  if (dUp === 0 && Number.isFinite(pole)) {
    if (pole >= 3 - 2 * Math.SQRT2 && pole < 1) f3dbHz = (Math.acos(1 - ((1 - pole) * (1 - pole)) / (2 * pole)) / (2 * Math.PI)) * fuHz
    if (Math.abs(pole) < 1) enbwHz = (fuHz * (1 - pole)) / (2 * (1 + pole))
  }
  const tauBlocks = rhoMean > 0 && rhoMean < 1 ? -1 / Math.log(rhoMean) : NaN
  // #endregion

  // ── 固定點 ──
  const wStarLinear = a + (Cnl + b * ExRef + (bug && Kq > 0 ? ExRef / Kq : 0)) / C
  const Smf = Math.min(S - s0, MEAN_FIELD_SAMPLES)
  const mf = meanFieldFixedPoint({
    a,
    sigma,
    b,
    bug,
    u: u.subarray(s0, s0 + Smf),
    unl: unl.subarray(s0, s0 + Smf),
    xref: xref.subarray(s0, s0 + Smf),
    guess: Number.isFinite(wStarLinear) ? wStarLinear : a,
    wScale: sigma > 0 && Eu2 > 0 ? sigma / Math.sqrt(Eu2) : Math.max(1, Math.abs(a)),
  })
  // GMAC 雜訊（每 sample 的 Var(q·x_ref)，在固定點附近；iid 近似）
  let sigEtaSample = ExRef2
  if (bug) {
    const wq = Number.isFinite(mf.root) ? mf.root : a
    let acc = 0
    for (let i = 0; i < Smf; i++) {
      const e = (a - wq) * u[s0 + i] + unl[s0 + i] + b
      const P = sigma > 0 ? normCdf(e / sigma) : e >= 0 ? 1 : 0
      acc += xref[s0 + i] * xref[s0 + i] * P
    }
    sigEtaSample = acc / Smf - (Number.isFinite(mf.value) ? mf.value * mf.value : 0)
  }
  const sigmaEta2 = sumMode ? sigEtaSample * N : sigEtaSample / N
  const noiseGain = calNoiseGain(g, dUp, stableMean)
  const sigmaWPred = Math.abs(mu) * Math.sqrt(sigmaEta2 * noiseGain)

  const analytic: BlockLmsAnalytic = {
    Kq,
    Cest: C,
    K: Kgm,
    g,
    p: pole,
    stableMean,
    rhoMean,
    gCritical,
    sigmaWPred,
    sigmaEta2,
    pmDeg,
    fuHz,
    f3dbHz,
    enbwHz,
    tauBlocks,
    wStarLinear,
    wStarMeanField: mf.root,
    slopeMeanField: mf.slope,
    gMeanField: mu * mf.slope * (sumMode ? N : 1),
    Ex,
    Ex2,
    ExRef,
    ExRef2,
    statsSamples: cnt,
    normalization: norm,
  }
  const cm = cfg.comparator
  if ((cm.hysteresis_fs > 0 || cm.meta_window_fs > 0) && sigma > 0) {
    const ns = nonidealSummary(sigma, cm.hysteresis_fs, cm.meta_window_fs)
    analytic.comparatorModel = { h: cm.hysteresis_fs, eps: cm.meta_window_fs, policy: cm.meta_policy, slopeRatio: ns.slopeRatio, noiseFactor: ns.noiseFactor, nu: ns.nu, pMeta: ns.pMeta, kqEffRatio: ns.kqEffRatio }
  }

  // ── 警告 ──
  const fmt = (v: number, d = 4): string => (Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : String(v))
  const tolC = 1e-3 * Math.sqrt(Math.max(ExRef2 * Eu2, 0))
  if (C < -tolC) {
    warnings.push(
      `C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（C = ${fmt(C)}；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）`,
    )
  } else if (!(C > tolC)) {
    warnings.push(`C ≈ 0：GMAC 沒有平均恢復力（資訊不足／缺乏激勵），w 會隨雜訊漂移（C = ${fmt(C)}）`)
  }
  if (sigma === 0) warnings.push('σ_v = 0：comparator 為純 sign，K_q 無定義（小訊號線性化不適用），可能出現 limit cycle 或 dead zone')
  if (mu <= 0) warnings.push(`gain_step μ = ${fmt(mu)} ≤ 0：除非 C < 0，平均誤差不會收斂`)
  if (Number.isFinite(g) && C > tolC && mu > 0) {
    if (dUp === 0 && g >= 2) warnings.push(`g ≥ 2：一階模型不穩定（g = μK = ${fmt(g)}，pole = ${fmt(pole)}）`)
    else if (dUp > 0 && g >= gCritical)
      warnings.push(`g ≥ 2sin(π/(4d+2)) = ${fmt(gCritical)}：含 d = ${dUp} 個 block 更新延遲的一階模型不穩定（g = ${fmt(g)}）`)
  }
  if (sumMode) {
    warnings.push(
      `gm_mode=sum 時有效增益放大 N 倍（N = ${N}：g = ${fmt(g)}；若沿用 average 模式的 μ，需改為 μ/N = ${fmt(mu / N)}）`,
    )
  }
  if (bug) {
    warnings.push(
      'comparator_encoding = unipolar_unmapped_bug：硬體 0/1 未映射為 ±1（q = b），有效增益減半，且 E[x_ref] ≠ 0 時 GMAC 多出 E[x_ref]/2 的偏差項（反面測試）',
    )
  }
  if (!path.identity) {
    const H1 = freqz(path.b, path.a, [0])[0]
    if (cAbs(H1) < 1e-9 && (nl.offset_fs !== 0 || Math.abs(Ex) > 1e-3)) {
      warnings.push('H_PD(z=1) = 0：DTC offset 與 code 的 DC 成分在穩態不會到達 comparator（E03、E04）')
    }
  }
  const biasPred = mf.root - a
  if (Number.isFinite(biasPred) && Number.isFinite(sigmaWPred) && Math.abs(biasPred) > 3 * sigmaWPred && Math.abs(biasPred) > 1e-9) {
    warnings.push(`預測固定點偏差 w* − a ≈ ${fmt(biasPred)} fs（offset / DTC 非線性 / code 平均造成；GMAC 歸零 ≠ DTC 誤差為零，§11）`)
  }
  if (mode === 'filtered' && hat) {
    const fx = cfg.filtered_x_model
    if (fx.path !== 'same_as_path' || fx.gain_mismatch !== 1 || fx.extra_delay_samples !== 0) {
      warnings.push(`filtered-x 模型 Ĥ ≠ H：有效相關為 E[u·u_f] = ${fmt(C)}（不是 E[u²] = ${fmt(Eu2)}；E45）`)
    }
  }
  if (analytic.comparatorModel) {
    const c = analytic.comparatorModel
    if (c.h > 0) {
      warnings.push(
        `comparator hysteresis h = ${fmt(c.h)} fs：相鄰決策相關（ν = ${fmt(c.nu)}），工作點的平均斜率是 K_q 的 ${fmt(c.slopeRatio)} 倍（同 μ 下 pole 更快），但 GMAC 雜訊是 iid 的 ${fmt(c.noiseFactor)} 倍；上面的 g、p、σ_w 仍以理想 K_q 與 iid 雜訊計算（Ch05 §5b）`,
      )
    }
    if (c.eps > 0) {
      warnings.push(
        `comparator metastability 窗 ε = ${fmt(c.eps)} fs（${c.policy}）：每個 block 約 ${fmt(N * c.pMeta)} 個 sample 解不出來（P_meta = ${fmt(c.pMeta)}）；drop 時平均斜率只少 ${fmt(100 * (1 - Math.exp((-c.eps * c.eps) / (2 * sigma * sigma))), 3)}%${c.policy === 'late' ? '，late 讓那些 sample 的 q 乘到下一個 regressor（等效多一拍 code delay，Ch07）' : c.policy === 'hold' ? '，hold 讓那些 sample 重複上一個輸出（多一點相關）' : ''}`,
      )
    }
  }
  const gr = cfg.gain_register
  if (gr.quantize_physical && Number.isFinite(sigmaWPred) && gr.lsb_fs > 2 * sigmaWPred) {
    warnings.push(`實體 gain LSB = ${fmt(gr.lsb_fs)} fs 遠大於預測 σ_w = ${fmt(sigmaWPred)} fs：量化誤差主導，可能出現 limit cycle 或 dead zone（§13）`)
  }

  // ── 模型層級與假設 ──
  const isDsm = cfg.seeded_pattern.kind === 'dsm_first_order' || cfg.seeded_pattern.kind === 'mash111'
  const modelLevel: BlockLmsModelLevel = gr.quantize_physical
    ? 'L5'
    : !path.identity || mode !== 'raw' || isDsm || hasNl
      ? 'L2'
      : 'L1'
  const assumptions = [
    `時間單位 fs；code 依 ${cfg.code_normalization} 正規化後無因次；a、w 的單位為 fs per unit code（δ = a − w 極性）`,
    'PD 誤差 e[n] = H_PD{δt}[n] + b + v[n]，δt[n] = (a − w_applied)·x[n] + offset + c2·x² + c3·x³；H_PD 狀態跨 block 持續（§15.2）',
    `comparator 前雜訊 v[n] 為 iid Gaussian（σ_v = ${cfg.pd_noise_rms_fs} fs），與 code 獨立`,
    'q = sign(e)，tie 規則 e ≥ 0 ⇒ q = +1（§15.2、E07）',
    `GMAC：G_k = ${sumMode ? 'Σ' : '(1/N)Σ'} q·x_ref（N = ${N}），w_{k+1} = w_k + μG_k，更新延遲 d = ${dUp} block`,
    'f_s = f_ref：每個 code sample 對應一個 comparator sample',
    'K_q = √(2/π)/σ_v 為小訊號近似（|e_det| ≪ σ_v）；σ_w 預測假設 GMAC 雜訊 iid（σ_η² ≈ E[x_ref²]/N）且線性化有效',
    `C 與固定點由前 ${S} 個 code 樣本（略過前 ${s0} 個暫態）估計；mean-field 固定點使用 ${Smf} 個樣本`,
  ]
  if (analytic.comparatorModel) {
    assumptions.push(
      `comparator：hysteresis h = ${cm.hysteresis_fs} fs（有效門檻 −q[n−1]·h）、metastability 窗 ε = ${cm.meta_window_fs} fs、政策 ${cm.meta_policy}（drop 的除數仍是 N）；K_q、σ_w 的解析式未納入這兩個效應`,
    )
  }
  if (!gr.quantize_physical) {
    assumptions.push('gain_register 未啟用（quantize_physical = false）：w 為理想浮點，internal_bits / physical_bits 不生效')
  } else {
    assumptions.push(
      `定點暫存器：內部 ${gr.internal_bits} bits（小數 ${gr.internal_bits - gr.physical_bits} bits）、實體 ${gr.physical_bits} bits、LSB ${gr.lsb_fs} fs、${gr.signed ? 'signed' : 'unsigned'}、rounding = ${gr.rounding}（增量與實體 code 皆用此規則）、overflow = ${gr.overflow}`,
    )
  }
  return { cfg, N, K, D, dUp, path, hat, norm, analytic, warnings, assumptions, modelLevel }
}

/**
 * Mean-field 固定點：f(w) = mean_n x_ref[n]·m(e_n(w))，e_n(w) = (a − w)u[n] + unl[n] + b，
 * m(e) = 2Φ(e/σ) − 1（bipolar）或 Φ(e/σ)（bug）。以 Illinois（regula falsi）求根。
 */
function meanFieldFixedPoint(p: {
  a: number
  sigma: number
  b: number
  bug: boolean
  u: Float64Array
  unl: Float64Array
  xref: Float64Array
  guess: number
  wScale: number
}): { root: number; slope: number; value: number } {
  const { a, sigma, b, bug, u, unl, xref } = p
  const n = u.length
  if (n === 0) return { root: NaN, slope: NaN, value: NaN }
  const f = (w: number): number => {
    let s = 0
    const c0 = a - w
    for (let i = 0; i < n; i++) {
      const e = c0 * u[i] + unl[i] + b
      let m: number
      if (sigma > 0) m = bug ? normCdf(e / sigma) : 2 * normCdf(e / sigma) - 1
      else m = e >= 0 ? 1 : bug ? 0 : -1
      s += xref[i] * m
    }
    return s / n
  }
  const c = p.guess
  let h = Math.max(1e-6, 0.05 * p.wScale)
  let lo = c - h
  let hi = c + h
  let flo = f(lo)
  let fhi = f(hi)
  let iter = 0
  while (flo * fhi > 0 && iter < 60) {
    h *= 2
    lo = c - h
    hi = c + h
    flo = f(lo)
    fhi = f(hi)
    iter++
    if (h > 1e9) break
  }
  if (!(flo * fhi <= 0)) return { root: NaN, slope: NaN, value: NaN }
  let root: number
  if (flo === 0) root = lo
  else if (fhi === 0) root = hi
  else {
    // Illinois
    let side = 0
    root = lo
    for (let k = 0; k < 200; k++) {
      root = (lo * fhi - hi * flo) / (fhi - flo)
      if (!(root > Math.min(lo, hi) && root < Math.max(lo, hi))) root = 0.5 * (lo + hi)
      const fr = f(root)
      if (fr === 0 || Math.abs(hi - lo) < 1e-12 * Math.max(1, Math.abs(root))) break
      if (fr * fhi > 0) {
        hi = root
        fhi = fr
        if (side === -1) flo /= 2
        side = -1
      } else {
        lo = root
        flo = fr
        if (side === 1) fhi /= 2
        side = 1
      }
    }
  }
  // 解析斜率 S = −df/dw = mean(x_ref·u·m'(e))
  let slope = NaN
  if (sigma > 0) {
    let s = 0
    const c0 = a - root
    const k = (bug ? 1 : 2) / sigma
    for (let i = 0; i < n; i++) {
      const e = c0 * u[i] + unl[i] + b
      s += xref[i] * u[i] * k * normPdf(e / sigma)
    }
    slope = s / n
  }
  return { root, slope, value: f(root) }
}

// ───────────────────────────────────────────────────────────────────────────
// 模擬
// ───────────────────────────────────────────────────────────────────────────

function resolveConfig(input: unknown): BlockLmsConfig {
  const parsed = parseBlockLmsConfig(input)
  if (!parsed.ok) throw new Error(`blockLms 參數錯誤：\n${parsed.errors.join('\n')}`)
  return parsed.config
}

/** 只計算解析量、警告與假設（不跑 Monte Carlo；UI 即時更新用）。worker 可呼叫。 */
export function analyzeBlockLms(input: BlockLmsConfigInput): {
  config: BlockLmsConfig
  analytic: BlockLmsAnalytic
  warnings: string[]
  assumptions: string[]
  modelLevel: BlockLmsModelLevel
} {
  const pr = prepare(resolveConfig(input))
  return { config: pr.cfg, analytic: pr.analytic, warnings: pr.warnings, assumptions: pr.assumptions, modelLevel: pr.modelLevel }
}

/**
 * 參考 Block Sign-Error LMS 模擬（見檔頭）。輸入可為部分設定（缺省欄位以 §15.3 預設補齊）；
 * 參數不合法時丟出含繁體中文說明的 Error。N = 4096 × 2000 blocks 在 Node 約 0.1–0.3 s。
 */
export function runBlockLms(input: BlockLmsConfigInput): BlockLmsResult {
  const cfg = resolveConfig(input)
  const pr = prepare(cfg)
  const { N, K, D, dUp, path, hat, norm } = pr
  const warnings = pr.warnings.slice()
  const a = cfg.gain_true
  const mu = cfg.gain_step
  const sigma = cfg.pd_noise_rms_fs
  const bOff = cfg.comparator_offset_fs
  const { offset_fs: nlOff, c2: nlC2, c3: nlC3 } = cfg.dtc_nonlinearity
  const hasNl = nlOff !== 0 || nlC2 !== 0 || nlC3 !== 0
  const avg = cfg.gm_mode === 'average'
  const qLo = cfg.comparator_encoding === 'unipolar_unmapped_bug' ? 0 : -1
  const mapped = cfg.comparator_encoding === 'unipolar_mapped'
  const normOff = norm.offset
  const normSc = norm.scale
  const doNorm = normOff !== 0 || normSc !== 1

  const root = createRng(cfg.seed)
  const src = createCodeSource(cfg.seeded_pattern, root.fork('code-pattern'))
  const gauss = createZigguratNormal(root.fork('comparator-noise'))
  const roundRng = root.fork('gain-register-rounding')
  const pathF = path.identity ? null : new StreamFilter(path.b, path.a)
  const hatF = hat ? new StreamFilter(hat.b, hat.a) : null
  const traceUF = path.identity ? null : new StreamFilter(path.b, path.a)

  const xext = new Float64Array(N + D)
  const rext = hat ? new Float64Array(N + D) : null
  const xr = rext ?? xext

  // #region core:blockLmsGainRegister
  // ── gain register ──
  const gr = cfg.gain_register
  const qz = gr.quantize_physical
  const F = gr.internal_bits - gr.physical_bits
  const scaleF = Math.pow(2, F)
  const lsbInt = gr.lsb_fs / scaleF
  const intLo = gr.signed ? -Math.pow(2, gr.internal_bits - 1) : 0
  const intHi = gr.signed ? Math.pow(2, gr.internal_bits - 1) - 1 : Math.pow(2, gr.internal_bits) - 1
  const phyLo = gr.signed ? -Math.pow(2, gr.physical_bits - 1) : 0
  const phyHi = gr.signed ? Math.pow(2, gr.physical_bits - 1) - 1 : Math.pow(2, gr.physical_bits) - 1
  let saturationCount = 0
  let wrapCount = 0
  const clampOrWrap = (v: number, lo: number, hi: number): number => {
    if (v >= lo && v <= hi) return v
    if (gr.overflow === 'saturate') {
      saturationCount++
      return v > hi ? hi : lo
    }
    wrapCount++
    const R = hi - lo + 1
    return lo + ((((v - lo) % R) + R) % R)
  }
  let wInt = 0 // 內部暫存器（LSB 計數）
  const physOf = (): number => clampOrWrap(roundWith(wInt / scaleF, gr.rounding, roundRng), phyLo, phyHi) * gr.lsb_fs

  const w = new Float64Array(K + 1)
  const wPhys = new Float64Array(K + 1)
  const G = new Float64Array(K)
  let wCur: number
  if (qz) {
    wInt = clampOrWrap(roundWith(cfg.gain_initial / lsbInt, gr.rounding, roundRng), intLo, intHi)
    wCur = wInt * lsbInt
    wPhys[0] = physOf()
  } else {
    wCur = cfg.gain_initial
    wPhys[0] = wCur
  }
  w[0] = wCur
  // #endregion

  // #region core:blockLmsComparatorModel
  // ── 非理想 comparator（Ch05 §5b；h = ε = 0 時整段不生效，決策與原本逐位元相同）──
  const cmp = cfg.comparator
  const cmpH = cmp.hysteresis_fs
  const cmpEps = cmp.meta_window_fs
  const cmpPolicy = cmp.meta_policy
  const cmpNonideal = cmpH > 0 || cmpEps > 0
  let latch: 1 | -1 = 1 // latch 狀態 = 上一個解出來的輸出
  let lateQ = 0 // late 政策：上一拍解出來、這一拍才進 GMAC 的 ±1
  let cmpCnt = 0 // 這一拍進 GMAC 的 ±1 個數（late 時可能是 2；bug 編碼要用它把 −1 映射成 0）
  /** 回傳這一拍送進累加器的雙極性總和（±1 的和；0 = 漏掉）。 */
  const nonidealOut = (e: number): number => {
    const d = e + latch * cmpH // 離有效門檻 −latch·h 的距離（latch = +1 時門檻在 −h）
    const carry = lateQ
    lateQ = 0
    cmpCnt = carry === 0 ? 0 : 1
    if (Math.abs(d) < cmpEps) {
      if (cmpPolicy === 'hold') {
        cmpCnt++
        return carry + latch // 沿用上一個輸出
      }
      if (cmpPolicy === 'late') {
        latch = d >= 0 ? 1 : -1 // latch 最後還是解到正確的一側，只是晚一拍
        lateQ = latch
      }
      return carry // drop：這一拍沒有貢獻
    }
    latch = d >= 0 ? 1 : -1
    cmpCnt++
    return carry + latch
  }
  // #endregion

  // ── trace ──
  const traceBlocks = cfg.record.sample_trace_blocks
  const dec = cfg.record.decimate
  const nTrace = Math.ceil((traceBlocks * N) / dec)
  const tn = new Float64Array(nTrace)
  const tx = new Float64Array(nTrace)
  const tu = new Float64Array(nTrace)
  const te = new Float64Array(nTrace)
  const tq = new Float64Array(nTrace)
  const txr = new Float64Array(nTrace)
  let ti = 0

  let divergenceBlock: number | null = null
  // #region core:blockLmsBlockLoop
  for (let k = 0; k < K; k++) {
    // #region core:blockLmsBlockSetup
    const wApp = wPhys[k - dUp >= 0 ? k - dUp : 0]
    const coef = a - wApp
    if (D > 0) {
      xext.copyWithin(0, N, N + D)
      if (rext) rext.copyWithin(0, N, N + D)
    }
    src.fill(xext, D, N)
    if (doNorm) for (let i = D; i < D + N; i++) xext[i] = (xext[i] - normOff) * normSc
    if (hatF && rext) for (let i = D; i < D + N; i++) rext[i] = hatF.step(xext[i])
    // #endregion
    const rec = k < traceBlocks
    // #region core:blockLmsInnerLoop
    let acc = 0
    for (let n = 0; n < N; n++) {
      const x = xext[D + n]
      let dt = coef * x
      if (hasNl) dt += nlOff + x * x * (nlC2 + nlC3 * x)
      const u = pathF === null ? dt : pathF.step(dt)
      const e = u + bOff + sigma * gauss()
      // tie 規則：e ≥ 0 ⇒ +1
      let q: number
      if (mapped) {
        const bit = e >= 0 ? 1 : 0
        q = 2 * bit - 1 // 硬體 0/1 → ±1
      } else q = e >= 0 ? 1 : qLo
      if (cmpNonideal) {
        const y = nonidealOut(e) // ← 差異：有記憶的門檻與決策窗
        q = qLo === -1 ? y : (y + cmpCnt) / 2 // bug 編碼：每個 −1 算 0、每個 +1 算 1
      }
      const xrn = xr[n]
      acc += q * xrn
      if (rec) {
        const uTrace = traceUF === null ? x : traceUF.step(x)
        const gi = k * N + n
        if (gi % dec === 0) {
          tn[ti] = gi
          tx[ti] = x
          tu[ti] = uTrace
          te[ti] = e
          tq[ti] = q
          txr[ti] = xrn
          ti++
        }
      }
    }
    // #endregion
    // #region core:blockLmsGmacUpdate
    const Gk = avg ? acc / N : acc
    G[k] = Gk
    if (qz) {
      const incQ = roundWith((mu * Gk) / lsbInt, gr.rounding, roundRng)
      wInt = clampOrWrap(wInt + incQ, intLo, intHi)
      wCur = wInt * lsbInt
      wPhys[k + 1] = physOf()
    } else {
      wCur = wCur + mu * Gk
      wPhys[k + 1] = wCur
    }
    w[k + 1] = wCur
    // #endregion
    if (!Number.isFinite(wCur) || Math.abs(wCur) > DIVERGENCE_LIMIT_FS) {
      divergenceBlock = k + 1
      for (let j = k + 1; j < K; j++) G[j] = NaN
      for (let j = k + 2; j <= K; j++) {
        w[j] = NaN
        wPhys[j] = NaN
      }
      warnings.push(`w 在 block ${k + 1} 發散（|w| > ${DIVERGENCE_LIMIT_FS} fs 或非有限數），模擬停止`)
      break
    }
  }
  // #endregion

  const metrics = computeMetrics({ w, wPhys, G, a, qz, divergenceBlock, analytic: pr.analytic, lsb: gr.lsb_fs })
  if (saturationCount > 0) warnings.push(`gain register 飽和 ${saturationCount} 次（anti-windup / 調整範圍不足，§13.6）`)
  if (wrapCount > 0) warnings.push(`gain register 溢位 wrap ${wrapCount} 次：數值跳到另一端（RTL overflow bug，§16.1）`)
  metrics.saturationCount = saturationCount
  metrics.wrapCount = wrapCount
  if (!pr.analytic.stableMean && divergenceBlock === null && Number.isFinite(pr.analytic.g) && pr.analytic.g > 0) {
    warnings.push(
      '線性化平均模型不穩定，但 sign-LMS 的 GMAC 有界（|G| ≤ max|x_ref|，sum 模式再乘 N），因此實際表現為大振幅振盪／limit cycle，而非數值發散',
    )
  }

  return {
    config: cfg,
    blocks: { w, wPhys, G },
    trace: { n: tn, x: tx, u: tu, e: te, q: tq, xRef: txr },
    metrics,
    analytic: pr.analytic,
    warnings,
    assumptions: pr.assumptions,
    modelLevel: pr.modelLevel,
    units: {
      w: 'fs per unit code',
      wPhys: 'fs per unit code',
      G: cfg.gm_mode === 'average' ? 'dimensionless (average)' : 'dimensionless (sum)',
      e: 'fs',
      x: 'normalized code',
      gain_step: 'fs（per unit G）',
      Kq: 'fs^-1',
      fuHz: 'Hz',
      pmDeg: 'deg',
    },
  }
}

function computeMetrics(p: {
  w: Float64Array
  wPhys: Float64Array
  G: Float64Array
  a: number
  qz: boolean
  divergenceBlock: number | null
  analytic: BlockLmsAnalytic
  lsb: number
}): BlockLmsMetrics {
  const { w, wPhys, G, a } = p
  const K = G.length
  const h0 = Math.ceil((K + 1) / 2)
  const diverged = p.divergenceBlock !== null
  let meanW = NaN
  let stdW = NaN
  let meanWPhys = NaN
  let mse = NaN
  let settlingBlock: number | null = null
  let limitCycleCount = 0
  let limitCyclePeriod = 0
  let meanG = NaN
  if (!diverged) {
    const m = K + 1 - h0
    let s = 0
    let sp = 0
    let se = 0
    for (let i = h0; i <= K; i++) {
      s += w[i]
      sp += wPhys[i]
      se += (w[i] - a) * (w[i] - a)
    }
    meanW = s / m
    meanWPhys = sp / m
    mse = se / m
    let v = 0
    for (let i = h0; i <= K; i++) v += (w[i] - meanW) * (w[i] - meanW)
    stdW = m > 1 ? Math.sqrt(v / (m - 1)) : NaN
    const band = Math.max(4 * (Number.isFinite(stdW) ? stdW : 0), 1e-9 * Math.max(1, Math.abs(meanW)), p.qz ? p.lsb : 0)
    let last = -1
    for (let i = 0; i <= K; i++) if (Math.abs(w[i] - meanW) > band) last = i
    settlingBlock = last < K ? last + 1 : null
    let sg = 0
    for (let i = 0; i < K; i++) sg += G[i]
    meanG = sg / K
    if (p.qz) {
      for (let i = h0 + 1; i <= K; i++) if (wPhys[i] !== wPhys[i - 1]) limitCycleCount++
      limitCyclePeriod = detectPeriod(wPhys.subarray(h0))
    }
  }
  const pred = p.analytic.sigmaWPred
  return {
    meanW,
    stdW,
    meanWPhys,
    bias: meanW - a,
    mse,
    settlingBlock,
    saturationCount: 0,
    wrapCount: 0,
    limitCycleCount,
    limitCyclePeriod,
    sigmaWRatio: Number.isFinite(pred) && pred > 0 ? stdW / pred : NaN,
    biasPred: p.analytic.wStarMeanField - a,
    diverged,
    divergenceBlock: p.divergenceBlock,
    meanG,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Monte Carlo（多 seeds）
// ───────────────────────────────────────────────────────────────────────────

export interface BlockLmsMonteCarloResult {
  seeds: number[]
  perRun: { meanW: Float64Array; stdW: Float64Array; bias: Float64Array; settlingBlock: Float64Array; diverged: number }
  /** 各 run 的 meanW 之平均與 95% Student-t CI（runs 彼此獨立） */
  meanW: { mean: number; lo: number; hi: number }
  /** √(mean(stdW²))：合併的穩態標準差 [fs] */
  pooledStdW: number
  /** 各 block 的 w 平均與標準差（跨 runs） */
  wMean: Float64Array
  wStd: Float64Array
  analytic: BlockLmsAnalytic
  warnings: string[]
}

/**
 * 以多個 seeds 重複 runBlockLms（seeds 預設為 deriveSeed(config.seed, i)，i = 0…runs−1）。worker 可呼叫。
 * 回傳不含逐 sample trace（節省記憶體）。
 */
export function runBlockLmsMonteCarlo(p: { config: BlockLmsConfigInput; runs?: number; seeds?: number[] }): BlockLmsMonteCarloResult {
  const base = resolveConfig(p.config)
  const seeds = p.seeds ?? Array.from({ length: p.runs ?? 8 }, (_, i) => deriveSeed(base.seed, i))
  if (seeds.length < 1) throw new Error('Monte Carlo 至少需要 1 個 seed')
  const R = seeds.length
  const K = base.num_blocks
  const meanW = new Float64Array(R)
  const stdW = new Float64Array(R)
  const bias = new Float64Array(R)
  const settling = new Float64Array(R)
  const wSum = new Float64Array(K + 1)
  const wSum2 = new Float64Array(K + 1)
  let diverged = 0
  let analytic: BlockLmsAnalytic | undefined
  let warnings: string[] = []
  for (let r = 0; r < R; r++) {
    const res = runBlockLms({ ...base, seed: seeds[r], record: { sample_trace_blocks: 0, decimate: 1 } })
    meanW[r] = res.metrics.meanW
    stdW[r] = res.metrics.stdW
    bias[r] = res.metrics.bias
    settling[r] = res.metrics.settlingBlock ?? NaN
    if (res.metrics.diverged) diverged++
    for (let k = 0; k <= K; k++) {
      wSum[k] += res.blocks.w[k]
      wSum2[k] += res.blocks.w[k] * res.blocks.w[k]
    }
    if (r === 0) {
      analytic = res.analytic
      warnings = res.warnings
    }
  }
  const wMean = wSum.map((s) => s / R)
  const wStd = wSum2.map((s2, k) => (R > 1 ? Math.sqrt(Math.max(0, (s2 - R * wMean[k] * wMean[k]) / (R - 1))) : NaN))
  const ci = meanCI(meanW)
  let s2 = 0
  for (const v of stdW) s2 += v * v
  return {
    seeds,
    perRun: { meanW, stdW, bias, settlingBlock: settling, diverged },
    meanW: { mean: ci.mean, lo: ci.lo, hi: ci.hi },
    pooledStdW: Math.sqrt(s2 / R),
    wMean,
    wStd,
    analytic: analytic as BlockLmsAnalytic,
    warnings,
  }
}
