/**
 * 案例頁的資料來源（單一入口）。頁面上的每一個數字都來自：
 *   (1) src/data/sspll/*.json —— analysis/sspll/golden/tools/export_web_data.py 產生；
 *   (2) analysis/sspll/golden/results/*.json —— golden 的其他輸出（手算例、GOS 掃描、sim 的 dither 結果）；
 *   (3) src/simulation/models/sspll.ts —— TS port 的即時計算（sspll.test.ts 與 (1)(2) 交叉比對）。
 * 這個檔案只做型別標註與少量彙整，不手寫任何結果。
 *
 * 載入方式：這裡只同步 import 頁面第一次渲染就要用的檔案（params.json、pred_vs_sim.json、worked_examples 等）。
 * 最大的兩組——hpd_L*.json（H_PD 網格）與 signmap_L*.json（α sign map），合計約 1.3 MB——改由 ./lazyData 按需載入
 * （`useSspllData`），只有實驗 A、實驗 B 與 §15 的 near-grid 區間用到它們；這裡只留下它們的型別（HpdJson、SignMapJson）。
 */
import paramsJson from '@/data/sspll/params.json'
import predJson from '@/data/sspll/pred_vs_sim.json'
import workedJson from '../../../analysis/sspll/golden/results/worked_examples.json'
import gosScanJson from '../../../analysis/sspll/golden/results/gos_dense_scan.json'
import ditherJson from '../../../analysis/sspll/golden/results/sim_dither_extract.json'
import docNumbers from './docNumbers.json'
import {
  F_REF,
  discConstant,
  inversionBands,
  kernelMin,
  loopImpulse,
  loopSummary,
  makePOnlyL2,
  makePOnlyL3,
  mode1SureBand,
  nominalLoops,
  oneDiffMargin,
  type LoopSummary,
  type Mode1SureBand,
  type SspllLoop,
  type SspllSimCfg,
} from '@/simulation/models/sspll'

export type LoopKey = 'L1' | 'L2' | 'L3'
export const LOOP_KEYS: LoopKey[] = ['L1', 'L2', 'L3']

export const LOOP_LABEL: Record<LoopKey, string> = {
  L1: 'L1：SSPLL Type-I',
  L2: 'L2：SSPLL Type-II（P + I）',
  L3: 'L3：CPPLL（3 階 Type-II）',
}

/** [f_lo, f_hi, min Re H, f_min]（頻率為 MHz） */
export type BandRow = [number, number, number, number]

interface LoopJson {
  description: string
  params: Record<string, number | string | null>
  f3dB_MHz: number
  PM_deg: number
  fc_MHz: number
  T_peak_dB: number
  max_ReH: number
  ReH_neg_bands_MHz: BandRow[]
  bL: number[]
  aL: number[]
}

interface SensJson {
  f3dB_MHz: number
  PM_deg: number
  bands: BandRow[]
}

interface TypeIJson {
  K: number
  p?: number
  criterion: number
  PM_deg: number
  bands: BandRow[]
}

interface POnlyJson {
  f3dB_MHz: number
  PM_deg: number
  bands: BandRow[]
  criterion: number
  params: Record<string, number | string | boolean | null>
  kernel_min: number
}

export interface SignMapSummary {
  'phos_inverted_MHz_tau0.001': [number, number][]
  'phos_inverted_MHz_tau0.01': [number, number][]
  'm1_inverted_MHz_tau0.001': [number, number][]
  'm2_inverted_MHz_tau0.001': [number, number][]
  'm3_inverted_MHz_tau0.001': [number, number][]
  'm4_inverted_MHz_tau0.001': [number, number][]
  large_signal_inverted_MHz: [number, number][]
  n_large_signal_inverted: number
  n_large_signal_inverted_ac: number
  n_large_signal_inverted_Ponly_ac: number | null
  worst_kP: number
  worst_kP_at_MHz: number
  min_kG: number
  min_kG_at_MHz: number
  n_inverted_kP_1diff: number
  min_kP_1diff: number
  n_inverted_kG_1diff: number
  n_inverted_kP_fx: number
  min_kP_fx: number
  n_inverted_kP_D1: number
  min_kP_D1: number
  n_inverted_kG_D1: number
  min_kG_D1: number
  n_inverted_kP_2diff: number
  min_kP_2diff: number
  n_inverted_kP_Ponly: number
  min_kP_Ponly: number | null
}

interface MapJ4096 {
  worst_kP: number
  worst_at_MHz: number
  n_gos_neg: number
  min_kG: number
  min_kG_at_MHz: number
  'bands_tau0.001': [number, number][]
  'bands_m1_tau0.001': [number, number][]
  'bands_tau0.01': [number, number][]
}

export interface OffsetPoint {
  twelveC: number
  rho_mean: number
  Eq: number
  Kq_ratio: number
  gos_bias_raw_fs: number
  gos_bias_ac_fs: number
}

interface ParamsJson {
  generated: { by: string; golden_version: string; date: string }
  assumptions: {
    f_ref_Hz: number
    T_ref_ps: number
    closed_loop_3dB_Hz: number
    f_vco_Hz_illustrative: number
    Delta_ps_illustrative: number
    sim_physics: { a_gos: number; eps_ps: number[]; eps_seed: number }
    not_modelled: string[]
  }
  loops: Record<LoopKey, LoopJson>
  closed_forms: Record<string, number | string>
  P_only: Record<'L2_Ponly' | 'L3_Ponly_C1>>C2' | 'L3_Ponly_exactRC2', POnlyJson>
  typeI_criteria: Record<string, TypeIJson>
  sensitivity: Record<string, SensJson>
  mode1_sure: Record<'L2' | 'L3', { threshold_ReH: number; max_ReH: number; min_ReH: number; sure_MHz: [number, number]; impossible_above_MHz: number }>
  map_j4096: Record<LoopKey, MapJ4096>
  signmap_summary: Record<LoopKey, SignMapSummary>
  remedy_kernels: {
    L1: Record<string, number>
    L2: Record<string, number>
    L3: Record<string, number>
    typeII_closed: { Kp_minus_Ki_over_2: number; Kp_plus_Ki_over_2: number; D1_min_closed: number }
    fx_typeI_model: { K_hat_critical: number } & Record<string, { min: number; neg_up_to_MHz: number | null } | number>
    fx_typeII_model_min_cos: Record<string, number>
    finite_mu: Record<string, { n: number; examples: [number, [number, number]][] }>
  }
  gos_small_beta: Record<LoopKey, { P: number; beta: number; C_D0: number; asym_D0: number; C_D1: number; asym_D1: number }[]>
  gos_rational_scan: Record<LoopKey, { b_max: number; n_beta: number; n_negative: number; min_12C: number; at_beta: [number, number] }>
  offset: {
    points: Record<string, OffsetPoint | { raw_median_fs: number; raw_frac_gt_1ps: number; ac_median_fs: number }>
    illustrative: Record<string, { u_fs: number; Eq: number; Kq_ratio: number }>
  }
}

export interface HpdJson {
  loop: LoopKey
  f_MHz: number[]
  ReH: number[]
  ImH: number[]
  absH: number[]
  absT: number[]
  ReL: number[]
  ReGamma_1diff: number[]
  ReGamma_2diff: number[]
  ReGamma_D1: number[]
  ReGamma_fx_exact: number[]
  ReH_Ponly?: number[]
}

export interface SignMapJson {
  loop: LoopKey
  grid: string
  f_MHz: number[]
  kG: number[]
  kP: number[]
  km1_re: number[]
  km1_im: number[]
  km2_re: number[]
  km2_im: number[]
  km3_re: number[]
  km3_im: number[]
  km4_re: number[]
  LSinf: number[]
  LSinf_ac: number[]
  kP_1diff: number[]
  kG_1diff: number[]
  kP_fx: number[]
  kG_fx: number[]
  kP_D1: number[]
  kG_D1: number[]
  kP_2diff: number[]
  kP_Ponly: number[] | null
  kG_Ponly: number[] | null
  LSinf_Ponly_ac: number[] | null
  summary: SignMapSummary
}

export interface SelectedRow {
  alpha: number
  f_MHz: number
  Q: number
  side: string
  kP_sim: number
  kP_sim_lin: number
  kP_replica: number
  kP_exact_simnorm: number
  kP_8lam_rational: number
  kP_8lam_ergodic: number
  kP_m1_ergodic: number
  kP_single_line: number
  kG_sim: number
  kG_replica: number
  kG_12C_ergodic: number
  LS_kinf_worst: number
}

export interface CountRow {
  sim_phos_inv: number
  th_phos_inv: number
  sim_gos_inv: number
  th_gos_inv: number
  sim_phos_min: number
  th_phos_min: number
  max_abs_diff_phos: number
  'class_disagree_tau0.001': number
  'class_disagree_tau0.01': number
  sim_lin_phos_inv?: number
  'class_disagree_lin_tau0.001'?: number
  'sim_intervals_tau0.01'?: [number, number][]
  'th_intervals_tau0.01'?: [number, number][]
  gos_ratio_12C_over_sim_median?: number
  gos_ratio_5_95?: [number, number]
}

export interface LsCount {
  'A=1ps'?: { periodic: number; sim: number }
  'A=5ps'?: { periodic: number; sim: number }
  'A=inf': { periodic: number; worst: number; intervals: [number, number][] }
}

export interface LmsTrace {
  init_phos_rms_fs: number
  final_phos_rms_fs: number
  max_phos_rms_fs: number
  final_gos_fs: number
  blocks: number[]
  phos_rms_med_fs: number[]
  gos_med_fs: number[]
}

interface PredJson {
  selected: Record<LoopKey, SelectedRow[]>
  fine: { alpha: number[] } & Record<LoopKey, Record<'kP_sim' | 'kP_sim_lin' | 'kP_theory' | 'kG_sim' | 'kG_theory' | 'kP_sim_1diff' | 'kP_theory_1diff' | 'LSinf_theory' | 'LS_sim_A1ps' | 'LS_sim_A5ps', number[]>>
  counts: Record<LoopKey, Record<string, CountRow>>
  large_signal_counts: Record<LoopKey, Record<string, LsCount> & { L1_raw_inf_dirs?: { n: number; all_gos: boolean; alphas: number[] } }>
  lms: Record<string, LmsTrace>
  lms_note: string
  offset_lms: Record<string, { phos_rms_fs: number; phos_rms_max_fs: number; phos_cm_fs: number; gos_fs: number }>
  offset_neargrid_u100: Record<string, number[]>
}

interface WorkedJson {
  a_Omega: number
  a_sin2: number
  a_ReL_closed: number
  a_L_complex: [number, number]
  a_abs_1plusL_sq: number
  a_ReH: number
  b_ratio: number
  b_sqrt: number
  b_asin: number
  b_f_inv_MHz: number
  c_ReH_84MHz: number
  c_W1_ReH: number
  c_8Relam1: number
  c_rest: number
  c_lines: { l: number; f_MHz: number; w: number; ReH: number }[]
  c_8lam_all: number[]
  d_beta: number
  d_terms: { m: number; f_MHz: number; w: number; ReH: number; contrib: number }[]
  d_partial5_12C: number
  d_12C: number
  'e_H=+1': number[]
  'e_H=-0.2': number[]
  f_corr_x_d1: number
  f_corr_x_d2c: number
  f_ReH_L2_20MHz: number
  f_minusW2_over_Ki: number
  f_ReH_L1_20MHz: number
  f_typeI_lowf: number
  g_Kq_per_fs: number
  i_rho_0137: number[]
  i_p_0137: number[]
}

export interface GosScanRow {
  b_max: number
  n_beta: number
  n_negative: number
  min_12C: number
  at: [number, number]
  ReH_neg_band_MHz: number[][]
}

interface DitherJson {
  dither: Record<string, Record<string, { kP: number; kG: number; phases_visited: number }>>
  lms: Record<string, Record<string, { final_phos_rms_fs: number; max_phos_rms_fs: number; final_gos_fs: number }>>
  freeze: Record<string, Record<string, { phos_initial_fs: number; phos_final_fs: number; gos_final_fs: number }>>
}

interface DocJoint {
  decoupling_L2: Record<string, { eight_div_Q: boolean; max_cross: number }>
  joint_scan: Record<LoopKey, { Q_max: number; n_rationals: number; n_joint_inverted: number; n_joint_only: number }>
  theorem_random_kernel_min_re_eig: number
  fvco: Record<string, { joint_min: number; C00: number }[]>
}

interface DocPhos {
  points: Record<string, { kP_occnorm: number; eightlam_min: number; kG: number; twelveC: number; ergodic_min: number; single_line: number; occupancy: number[] }>
  circulant_check: Record<'L2' | 'L3', { circulant_err: number; ergodic_vs_periodic_err: number; lambda0_abs: number }>
  alias_rationals: Record<'L2' | 'L3', { n_hits: number; n_far: number; worst: [number, number, number, number][] }>
  pe_failure: Record<string, { phases_visited: number; var_rho: number }>
}

export const PARAMS = paramsJson as unknown as ParamsJson
export const PRED = predJson as unknown as PredJson
export const WORKED = workedJson as unknown as WorkedJson
export const GOS_SCAN = gosScanJson as unknown as Record<string, GosScanRow>
export const DITHER = ditherJson as unknown as DitherJson
/**
 * analysis/sspll/golden/results/doc_numbers.json 裡本頁用到的兩段（joint、phos；S08、S09）。
 * 整個 doc_numbers.json 有 283 KB，Vite 對這種大 JSON 的具名 import 不做 tree-shaking（連沒用到的段落都會打進 chunk，實測多出約 180 KB），
 * 所以頁面讀的是 ./docNumbers.json——只含這兩段；docNumbers.test.ts 逐位比對它與 doc_numbers.json 一致。
 */
export const DOC_JOINT = docNumbers.joint as unknown as DocJoint
export const DOC_PHOS = docNumbers.phos as unknown as DocPhos

/** f_ref [MHz] */
export const FREF_MHZ = F_REF / 1e6

/** sim 的物理設定（單位 ps）：σ_v = 200 fs、Δ = T_vco/8（f_vco = 16 GHz，插圖值）、a = 0.03、ε 取 seed 7 */
export const SIM_CFG: SspllSimCfg = {
  sigmaPs: 0.2,
  deltaPs: PARAMS.assumptions.Delta_ps_illustrative,
  a: PARAMS.assumptions.sim_physics.a_gos,
  epsPs: PARAMS.assumptions.sim_physics.eps_ps,
}

// ── TS port 的即時計算（模組載入時算一次；純函式、決定性） ─────────────────────────────
export const LOOPS: Record<LoopKey, SspllLoop> = nominalLoops()
export const SUMMARY: Record<LoopKey, LoopSummary> = { L1: loopSummary(LOOPS.L1), L2: loopSummary(LOOPS.L2), L3: loopSummary(LOOPS.L3) }
export const P_ONLY: { L2: SspllLoop; L3: SspllLoop; L3exact: SspllLoop } = {
  L2: makePOnlyL2(LOOPS.L2),
  L3: makePOnlyL3(LOOPS.L3),
  L3exact: makePOnlyL3(LOOPS.L3, true),
}
export const SURE: Record<LoopKey, Mode1SureBand> = { L1: mode1SureBand(LOOPS.L1), L2: mode1SureBand(LOOPS.L2), L3: mode1SureBand(LOOPS.L3) }
/** h_PD[0..5] */
export const H_IMPULSE: Record<LoopKey, number[]> = {
  L1: Array.from(loopImpulse(LOOPS.L1, 6)),
  L2: Array.from(loopImpulse(LOOPS.L2, 6)),
  L3: Array.from(loopImpulse(LOOPS.L3, 6)),
}

export interface RemedyNumbers {
  /** min_f Re Γ_eff */
  raw: number
  diff1: number
  diff2: number
  d1: number
  fxExact: number
  /** 1diff 的 margin min g(Ω) 與 disc constant */
  margin: number
  disc: number
}

export const REMEDY: Record<LoopKey, RemedyNumbers> = Object.fromEntries(
  LOOP_KEYS.map((k) => [
    k,
    {
      raw: kernelMin(LOOPS[k], 'raw').min,
      diff1: kernelMin(LOOPS[k], '1diff').min,
      diff2: kernelMin(LOOPS[k], '2diff').min,
      d1: kernelMin(LOOPS[k], 'D:1').min,
      fxExact: kernelMin(LOOPS[k], 'fx:exact', { exact: LOOPS[k] }).min,
      margin: oneDiffMargin(LOOPS[k]).min,
      disc: discConstant(LOOPS[k], '1diff'),
    },
  ]),
) as Record<LoopKey, RemedyNumbers>

/** 標稱迴路的反號帶（TS 掃描）：[上緣 MHz, 最低 Re H, 最低處 MHz]；沒有時為 null */
export const BAND: Record<LoopKey, { hi: number; min: number; fMin: number } | null> = Object.fromEntries(
  LOOP_KEYS.map((k) => {
    const b = inversionBands(LOOPS[k])
    return [k, b.length ? { hi: b[0].fHi * FREF_MHZ, min: b[0].minReH, fMin: b[0].fMin * FREF_MHZ } : null]
  }),
) as Record<LoopKey, { hi: number; min: number; fMin: number } | null>

/**
 * hpd_L*.json 的精確頻率格點 [MHz]：500 個 log 點 0.1–100 MHz（不含終點）+ 1000 個線性點 100–2000 MHz。
 * JSON 的 f_MHz 欄只存 6 位有效數字，但數值是在未捨入的格點上算的；比較 TS port 與 golden 時要用這個格點。
 */
export const HPD_GRID_MHZ: Float64Array = Float64Array.from({ length: 1500 }, (_, i) => (i < 500 ? 0.1 * 1000 ** (i / 500) : 100 + (1900 * (i - 500)) / 999))

/**
 * mode-1「一定反號」區間的 golden 值 [MHz]（params.json；golden 以 0.004 MHz 的格點回報區間內最外側的格點）。
 * TS port 的 mode1SureBand 以二分法求根，兩者相差 < 0.005 MHz（例如 L3 上緣：golden 105.092、TS 105.096）。
 */
export const SURE_GOLDEN = PARAMS.mode1_sure

export function offsetPoint(key: string): OffsetPoint {
  return PARAMS.offset.points[key] as OffsetPoint
}

/** 在 signmap 格點（α·f_ref = j − 0.5 MHz）上找最近的索引；f 先折到 [0, f_ref/2] */
export function mapIndex(fMHz: number): number {
  const f = Math.min(fMHz, FREF_MHZ - fMHz)
  return Math.max(0, Math.min(1999, Math.round(f + 0.5) - 1))
}

/**
 * signmap 的某一欄低於門檻（預設 κ < −10⁻³）的連續區間 [MHz]；fLo／fHi 可限制只看某一段頻率。
 * 用來從 signmap_L*.json 的 LSinf、LSinf_ac 欄列出大訊號的 keep-out（格點為 α·f_ref = j − 0.5 MHz）。
 */
export function mapIntervalsBelow(col: number[] | null | undefined, fMHz: number[], thr = -1e-3, fLo = -Infinity, fHi = Infinity): [number, number][] {
  const out: [number, number][] = []
  if (!col) return out
  let open = false
  for (let i = 0; i < col.length; i++) {
    const hit = fMHz[i] >= fLo && fMHz[i] <= fHi && col[i] < thr
    if (hit) {
      if (open) out[out.length - 1][1] = fMHz[i]
      else out.push([fMHz[i], fMHz[i]])
    }
    open = hit
  }
  return out
}

/** pred_vs_sim.json 的 lms_note（英文）的中文說明：golden 閉迴路 LMS 的執行條件（含 `$...$` 行內公式，顯示時要經過 mathText） */
export const LMS_NOTE_ZH =
  'golden（Python）的閉迴路 sign-error block LMS：真 1-bit 比較器、$\\sigma_v=200$ fs（插圖值）、$N=512$、6000 blocks、2 條雜訊 lane、開迴路名義時間常數 25 blocks。fs 值來自無界的線性模型：超過約 $T_{vco}/8=7.8$ ps（16 GHz，插圖值）就代表硬體上的 DTC 飽和或失鎖。'
