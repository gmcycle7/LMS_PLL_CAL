/**
 * Unified Calibration Lab 的整合分析（規格 §19「Unified Lab」「Training Sequence Lab」、§15.4 輸出、§20.6 P5）。
 * 模型層級：迴路本身 L1 / L2 / L5（由 blockLms.ts 執行），輸出端估計 L4；FCW / DSM 序列分析 L2。
 *
 * ── 整條訊號鏈（每一級的符號，δ = a − w 極性；時間單位 fs）──
 *   FCW = N_int + frac ──DSM──▶ residue r[n] [T_vco] ──正規化──▶ x[n] = (r[n] − o)·s（無因次）
 *   DTC（在 reference 輸入端；全站架構約定見 docs/assumptions.md §2a）：需要補的量是 a·x[n]，DTC 實際的補償量是 w_app,k·x[n]
 *     （從固定的基準延遲 T_0 往回扣），PD 看到兩者之差：
 *     e_DTC[n] = (a − w_app,k)·x[n] + o_DTC + c₂x² + c₃x³                              [fs]
 *     （x 的正負號由 LabParams.regressorSign 決定（wave 5）：'spec' 照 §2a 用 x = s/M = −r ≥ 0；'legacy'（預設與既有 preset）
 *       用正規化後的 residue r：未置中的一階 DSM 為 x ≤ 0，和 §2a 差一個負號。以下這段說明的是 legacy。
 *       照 §2a 的時間寫：feedback edge 早到 a·|r|、τ_DTC = T_0 − w_app·|r|、t_ref′ − t_fb = (a − w_app)·|r|；
 *       本檔用帶正負號的 x 寫成 (a − w_app)·x：gain 項與 regressor 一起變號，q·x 的統計不變，所以 GMAC 與更新式相同。
 *       o_DTC、c₂x²、b 不隨 x 變號，它們的正負號是相對本檔的 e_DTC 定義的。）
 *   PLL error path：e_DTC 在 PD 的 reference 輸入端注入 ⇒ PD 的輸出 u_pd[n] = +H_PD{e_DTC}[n]（有狀態，跨 block 持續）；
 *     輸出 t_out[n] = +T{e_DTC}[n]（T = 1 − H_PD）
 *   Comparator（輸入取自 PD 的輸出，也就是送進 loop filter 的同一個節點）：e[n] = u_pd[n] + b + v[n]，q = sign(e)（e ≥ 0 ⇒ +1，E07）
 *   GMAC：G_k = (1/N)Σ q·x_ref（average）或 Σ（sum）；x_ref ∈ {x, x[n−D], Ĥ{x}[n−D]}
 *   Gain register / update：w_{k+1} = w_k + μG_k，第 k 個 block 實際作用 w_app,k = phys(w_{k−d})
 *
 * ── 本檔做什麼（legacy ∧ gos_only 的迴路交給 runBlockLms / runBlockLmsMonteCarlo；spec 或 pmux8_gos 由本檔的 prepareLab／runLabLoop 執行）──
 *   1. LabParams（扁平、UI 友善）→ BlockLmsConfig 的對應；Type-I / Type-II / none 三種 PLL 誤差路徑（含 T = 1 − H_PD）。
 *   2. 一階 DSM residue 的封閉式（E[r]、E[r²]、週期、基頻譜線振幅 1/(P·sin(π/P))）。
 *   3. replayPipeline：用同一 seed、同一 fork 標籤、同一運算順序重播 runBlockLms 的每個 sample，
 *      逐 block 重算 G_k 與 runBlockLms 的輸出比對（跨級一致性，應逐位元相同），並取出穩態視窗的完整 trace。
 *   3b. mean-field 平均軌跡（meanFieldTwin）：把 comparator 的 ±1 換成它對雜訊的期望值 erf(e_det/(√2σ_v))，其餘逐 sample 照算，
 *      得到「許多 seeds 的平均」的預測；code 的區塊統計隨時間變化（長週期一階 DSM）或 comparator 進入非線性區時，它仍然適用。
 *   4. 輸出端（L4）：e_DTC 分解成「靜態殘差 (a − w̄)x + d(x)」與「gain noise −(w − w̄)x」，經 T 得到 output timing error，
 *      時域 RMS、Welch PSD、ℒ(f)、spur（toneFit / findTones），並與解析近似比對。
 *   5. FCW sweep（每點：C、K、g、ρ、τ、PE、bias、sign flip、spur 靈敏度、凍結 w ± Δ 的 GMAC 斜率 MC、可選閉迴路）。
 *   6. Monte Carlo chunk（多 seeds，給 UI 分段累加顯示進度）。
 *   7. Training Sequence 分析（code PSD、自相關、C_D、多參數 Jacobian 秩、PE、spur）。
 *
 * 所有 worker 可呼叫函式（runPipeline、sweepFcwChunk、runMcChunk、analyzeTraining、analyzeLab）
 * 只收一個 plain object、回傳可 structured clone 的結果；純數值、無 React / DOM；隨機一律來自 createRng(seed)。
 */

import {
  cAbs,
  createRng,
  deriveSeed,
  eigSym,
  eigvals,
  erf,
  matMul,
  matVec,
  meanCI,
  normCdf,
  normPdf,
  polyRoots,
  solve,
  studentTInv,
  svd,
  transpose,
  wilsonCI,
  effectiveSampleSize,
  type Complex,
  type Matrix,
  type Rng,
} from '@/simulation/core'
import { findTones, integratePsd, StreamFilter, toneFit, welch } from '@/simulation/signal'
import {
  analyzeBlockLms,
  createCodeSource,
  createZigguratNormal,
  parseBlockLmsConfig,
  runBlockLms,
  runBlockLmsMonteCarlo,
  type BlockLmsAnalytic,
  type BlockLmsConfig,
  type BlockLmsConfigInput,
  type BlockLmsMetrics,
} from '@/simulation/models/blockLms'
import { designDtLoop, errorPathTransfer, type DtTransfer, type ErrorPathSpec } from '@/simulation/models/pll'
import { DsmStream, detectPeriod, normalizationParams, quantizeFcw, type CodeNormalization } from '@/simulation/models/dsm'
import { delayedMimoCovariance, delayedMimoMeanModel, observableEigen, restrictTo, uniformStepMuMax } from '@/simulation/models/mimo'
import { inversionBands, loopMargins, makeLoop, type SspllLoop } from '@/simulation/models/sspll'
import {
  bw3dbExact,
  bw3dbNegLnP,
  bw3dbOneMinusP,
  enbwOneSided,
  spurBeta,
  spurDbcBessel,
  spurDbcSmallAngle,
} from '@/simulation/models/calNoise'

// ───────────────────────────────────────────────────────────────────────────
// 常數與型別
// ───────────────────────────────────────────────────────────────────────────

/** 本模組的模擬版本（寫進報告） */
export const UNIFIED_LAB_VERSION = 'unifiedLab/1.0.0'
/** √(2/π) */
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
/** 輸出分析視窗的 sample 數上限 */
export const MAX_WINDOW_SAMPLES = 2 ** 19
/** 單次 pipeline 的總 sample 數上限（N × blocks；replay 需要再跑一次） */
export const MAX_PIPELINE_SAMPLES = 2 ** 25
/** 顯示用 trace 點數上限 */
const TRACE_POINTS = 3000
/** 連續 sample 片段的長度上限 */
export const SNIPPET_SAMPLES = 2048

/** 數字 → 純文字（有效位數 d；去尾端 0；NaN / ±∞ 原樣） */
const fmtN = (v: number, d = 4): string => (Number.isFinite(v) ? String(Number(v.toPrecision(d))) : String(v))

/** 數字 → TeX（有效位數 d；很大或很小時寫成 a\times10^{b}；NaN / ±∞ 以符號表示）。用在訊息字串的 `$...$` 內。 */
export function texNum(v: number, d = 4): string {
  if (Number.isNaN(v)) return '\\text{NaN}'
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty'
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = v.toExponential(Math.max(0, d - 1)).split('e')
    const mant = String(Number(m))
    return `${mant === '1' ? '' : mant === '-1' ? '-' : `${mant}\\times`}10^{${Number(e)}}`
  }
  return String(Number(v.toPrecision(d)))
}

export type CodeSourceKind = 'dsm_first_order' | 'mash111' | 'iid_pm_one'
export type PllKind = 'none' | 'type1' | 'type2' | 'cppll3'
/** regressor 的正負號約定（wave 5）：'spec' = docs/assumptions.md §2a 的 x = s/M ≥ 0；'legacy' = 本頁原本的 r = −s/M ≤ 0 */
export type RegressorSign = 'spec' | 'legacy'
/** 校正架構：單一 gain（GOS），或 8 相 PMUX 的 PHOS 8 個權重 + GOS 1 個（9 個權重；案例頁 /case/sspll 的架構） */
export type LabArchitecture = 'gos_only' | 'pmux8_gos'
/** PMUX 相位序列：由 FCW（累加器的整數部分）決定，或再疊上已知的隨機旋轉（研究延伸） */
export type PmuxOrder = 'fcw' | 'random'
export type RegressorMode = 'raw' | 'delayed' | 'filtered'
export type Encoding = 'bipolar_pm_one' | 'unipolar_mapped' | 'unipolar_unmapped_bug'
export type GainRounding = 'nearest' | 'truncate' | 'stochastic'
export type OverflowMode = 'saturate' | 'wrap'
export type GmMode = 'average' | 'sum'

/** 整合實驗的全部參數（扁平；ExperimentShell 的 params、preset JSON、報告都用它）。 */
export interface LabParams {
  /** root seed（comparator noise、DSM dither、stochastic rounding 皆由它 fork） */
  seed: number
  /** f_ref = f_s [Hz]（一個 DSM sample 對應一個 comparator sample） */
  fRefHz: number
  /** FCW 整數部分 N_int（f_out = (N_int + frac_eff)·f_ref） */
  nInt: number
  /** code 來源：一階 DSM、MASH 1-1-1，或參考用 iid ±1（T13 錨點） */
  codeSource: CodeSourceKind
  /** FCW 小數部分 frac ∈ [0, 1) */
  frac: number
  /** DSM 累加器位元數 B */
  dsmBits: number
  /** DSM 第一級 LSB dither */
  dither: boolean
  /** residue → regressor 的正規化 */
  normalization: CodeNormalization
  /** 真實 DTC gain 誤差 a [fs per unit code] */
  aFs: number
  /** 初始 gain w₀ [fs per unit code] */
  w0Fs: number
  /** DTC offset o_DTC [fs] */
  dtcOffsetFs: number
  /** DTC INL 二階、三階係數 c₂、c₃ [fs per unit code^k] */
  c2: number
  c3: number
  /** PLL 誤差路徑：none（H = 1、T = 1）、Type-I DPLL、Type-II DPLL、三階 CPPLL（charge pump + 二階濾波，impulse-invariant） */
  pll: PllKind
  /** PLL closed-loop T 的 −3 dB 頻寬（設計值）[Hz]；Type-II 指 CT 原型 T(s) 的 −3 dB；CPPLL 指實際 DT |T| 的 −3 dB */
  pllBwHz: number
  /** Type-II 阻尼 ζ */
  zeta: number
  /** 額外 loop latency d_L [samples] */
  loopDelay: number
  /** CPPLL（三階）：連續時間 crossover 處的 phase margin 設計值 [deg] */
  pllPmDeg: number
  /** CPPLL（三階）：第三極點與 crossover 的比 r_p = ω_p3/ω_c（零點由 PM 反解） */
  pllP3Ratio: number
  /**
   * regressor 正負號：'spec' 照 §2a（x = s/M ≥ 0，code 越大 feedback edge 越早到）；'legacy' 是本頁原本的 r = −s/M ≤ 0
   * （既有 preset、golden vector 與 blockLms 用它；兩者只差 x → −x，w、G 的收斂與 σ_w 不受影響，見 docs/assumptions.md §4）。
   */
  regressorSign: RegressorSign
  /** 校正架構：'gos_only'（單一 gain）或 'pmux8_gos'（8 相 PMUX 的 PHOS 8 個權重 + GOS 1 個 = 9 個權重） */
  architecture: LabArchitecture
  /** pmux8_gos：PMUX 相位序列由 FCW 決定，或再疊上已知的隨機旋轉 m[n] ∈ {0…7}（DTC 範圍要多 7Δ；研究延伸） */
  pmuxOrder: PmuxOrder
  /** pmux8_gos：PMUX 8 個相位 offset ε_p 的 RMS（去共模；illustrative；圖樣固定為 PHOS_PATTERN）[fs] */
  phosRmsFs: number
  /** pmux8_gos：PHOS 8 個權重的 learning rate μ_p [fs]（average 模式；one-hot regressor 無因次） */
  muPhosFs: number
  /** comparator 前雜訊 σ_v [fs] */
  sigmaV: number
  /** comparator offset b [fs] */
  compOffsetFs: number
  encoding: Encoding
  /** GMAC 每 block 樣本數 N */
  N: number
  gmMode: GmMode
  regressor: RegressorMode
  /** GMAC code delay D [samples]（delayed / filtered） */
  codeDelay: number
  /** filtered-x 模型 Ĥ = g_m·H·z^{−D_x}：g_m */
  fxGain: number
  /** filtered-x 模型多算／少算的 sample 延遲 D_x */
  fxExtraDelay: number
  /** gain register 定點量化（L5） */
  quantize: boolean
  internalBits: number
  physicalBits: number
  /** 實體 gain code LSB [fs per unit code] */
  lsbFs: number
  rounding: GainRounding
  overflow: OverflowMode
  signedReg: boolean
  /** learning rate μ [fs]（average 模式） */
  muFs: number
  /** 更新延遲 d [blocks] */
  updateDelay: number
  /** 模擬 block 數 K */
  blocks: number
  /** 輸出分析視窗（最後 W 個 block） */
  outBlocks: number
  /** jitter 積分頻帶 [f_L, f_H] [Hz] */
  fLHz: number
  fHHz: number
}

export const DEFAULT_LAB_PARAMS: LabParams = {
  seed: 20261010,
  fRefHz: 4e9,
  nInt: 3,
  codeSource: 'mash111',
  frac: 0.3,
  dsmBits: 20,
  dither: false,
  normalization: 'unit_rms',
  aFs: 3,
  w0Fs: 0,
  dtcOffsetFs: 0,
  c2: 0,
  c3: 0,
  pll: 'type2',
  pllBwHz: 2e6,
  zeta: 0.7,
  loopDelay: 0,
  pllPmDeg: 60,
  pllP3Ratio: 4,
  regressorSign: 'legacy',
  architecture: 'gos_only',
  pmuxOrder: 'fcw',
  phosRmsFs: 0,
  muPhosFs: 10,
  sigmaV: 100,
  compOffsetFs: 0,
  encoding: 'bipolar_pm_one',
  N: 4096,
  gmMode: 'average',
  regressor: 'raw',
  codeDelay: 0,
  fxGain: 1,
  fxExtraDelay: 0,
  quantize: false,
  internalBits: 20,
  physicalBits: 6,
  lsbFs: 0.125,
  rounding: 'nearest',
  overflow: 'saturate',
  signedReg: false,
  muFs: 10,
  updateDelay: 0,
  blocks: 2000,
  outBlocks: 64,
  fLHz: 1e3,
  fHHz: 1e8,
}

/** 每個參數的合法範圍與單位（UI 的 ParamControl 與驗證共用；單一事實來源）。 */
export const LAB_RANGES = {
  fRefHz: { min: 1e7, max: 2e10, unit: 'Hz' },
  nInt: { min: 1, max: 1000, unit: '—', integer: true },
  frac: { min: 0, max: 0.999999, unit: '—' },
  dsmBits: { min: 4, max: 24, unit: 'bit', integer: true },
  aFs: { min: -1000, max: 1000, unit: 'fs' },
  w0Fs: { min: -1000, max: 1000, unit: 'fs' },
  dtcOffsetFs: { min: -1000, max: 1000, unit: 'fs' },
  c2: { min: -100, max: 100, unit: 'fs' },
  c3: { min: -100, max: 100, unit: 'fs' },
  pllBwHz: { min: 1e3, max: 1e9, unit: 'Hz' },
  zeta: { min: 0.2, max: 5, unit: '—' },
  loopDelay: { min: 0, max: 16, unit: 'sample', integer: true },
  pllPmDeg: { min: 20, max: 85, unit: 'deg' },
  pllP3Ratio: { min: 1.5, max: 50, unit: '—' },
  phosRmsFs: { min: 0, max: 5000, unit: 'fs' },
  muPhosFs: { min: -1000, max: 10000, unit: 'fs' },
  sigmaV: { min: 0, max: 10000, unit: 'fs' },
  compOffsetFs: { min: -1000, max: 1000, unit: 'fs' },
  N: { min: 16, max: 65536, unit: 'sample', integer: true },
  codeDelay: { min: 0, max: 4096, unit: 'sample', integer: true },
  fxGain: { min: -4, max: 4, unit: '—' },
  fxExtraDelay: { min: 0, max: 4096, unit: 'sample', integer: true },
  internalBits: { min: 2, max: 40, unit: 'bit', integer: true },
  physicalBits: { min: 1, max: 16, unit: 'bit', integer: true },
  lsbFs: { min: 1e-4, max: 100, unit: 'fs' },
  muFs: { min: -1000, max: 10000, unit: 'fs' },
  updateDelay: { min: 0, max: 16, unit: 'block', integer: true },
  blocks: { min: 20, max: 20000, unit: 'block', integer: true },
  outBlocks: { min: 4, max: 4096, unit: 'block', integer: true },
  fLHz: { min: 1, max: 1e9, unit: 'Hz' },
  fHHz: { min: 10, max: 1e10, unit: 'Hz' },
} as const

/**
 * 每個數值參數的顯示名稱（字串內 `$...$` 為 TeX；錯誤訊息、UI 控制項、報告共用同一份）。
 * 括號內是 LabParams 的欄位名（preset JSON / 匯出報告用的 key）。
 */
export const LAB_PARAM_LABEL: Record<keyof typeof LAB_RANGES, string> = {
  fRefHz: '$f_{\\mathrm{ref}}$（fRefHz）',
  nInt: '$N_{\\mathrm{int}}$（nInt）',
  frac: 'FCW 小數部分 $\\alpha$（frac）',
  dsmBits: 'DSM 位元數 $B$（dsmBits）',
  aFs: '真實 gain 誤差 $a$（aFs）',
  w0Fs: '初始 gain $w_0$（w0Fs）',
  dtcOffsetFs: 'DTC offset $o_{\\mathrm{DTC}}$（dtcOffsetFs）',
  c2: 'INL 二階 $c_2$（c2）',
  c3: 'INL 三階 $c_3$（c3）',
  pllBwHz: 'PLL 頻寬 $f_{\\mathrm{BW}}$（pllBwHz）',
  zeta: '阻尼 $\\zeta$（zeta）',
  loopDelay: 'loop latency $d_L$（loopDelay）',
  pllPmDeg: 'CPPLL phase margin $\\mathrm{PM}$（pllPmDeg）',
  pllP3Ratio: 'CPPLL 第三極點比 $r_p=\\omega_{p3}/\\omega_c$（pllP3Ratio）',
  phosRmsFs: 'PHOS offset RMS $\\sigma_\\varepsilon$（phosRmsFs）',
  muPhosFs: 'PHOS learning rate $\\mu_p$（muPhosFs）',
  sigmaV: 'comparator 雜訊 $\\sigma_v$（sigmaV）',
  compOffsetFs: 'comparator offset $b$（compOffsetFs）',
  N: 'GMAC 長度 $N$（N）',
  codeDelay: 'code delay $D$（codeDelay）',
  fxGain: 'filtered-x 增益失配 $g_m$（fxGain）',
  fxExtraDelay: 'filtered-x 延遲失配 $D_x$（fxExtraDelay）',
  internalBits: '內部位元數 $B_{\\mathrm{int}}$（internalBits）',
  physicalBits: '實體位元數 $B_{\\mathrm{phys}}$（physicalBits）',
  lsbFs: 'gain LSB $\\Delta$（lsbFs）',
  muFs: 'learning rate $\\mu$（muFs）',
  updateDelay: '更新延遲 $d$（updateDelay）',
  blocks: 'block 數 $K_B$（blocks）',
  outBlocks: '輸出視窗 $W$（outBlocks）',
  fLHz: '積分下限 $f_L$（fLHz）',
  fHHz: '積分上限 $f_H$（fHHz）',
}

/** 參數檢查：回傳所有錯誤（繁體中文，`$...$` 為 TeX；空陣列 = 合法）。每一條都說明「哪個參數、為什麼不行」。 */
export function labParamErrors(p: LabParams): string[] {
  const err: string[] = []
  for (const [k, r] of Object.entries(LAB_RANGES) as [keyof typeof LAB_RANGES, (typeof LAB_RANGES)[keyof typeof LAB_RANGES]][]) {
    const v = p[k] as number
    const name = LAB_PARAM_LABEL[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      err.push(`${name}：必須為有限數`)
      continue
    }
    if (v < r.min || v > r.max) err.push(`${name} = ${v} 超出合法範圍 [${r.min}, ${r.max}]`)
    if ('integer' in r && r.integer && !Number.isInteger(v)) err.push(`${name} 必須為整數`)
  }
  if (!(Number.isInteger(p.seed) && p.seed >= 0 && p.seed <= 0xffffffff)) err.push('seed 必須是 0–4294967295 的整數')
  if (p.internalBits < p.physicalBits) err.push('internalBits 必須 ≥ physicalBits：實體 code 是內部暫存器的高位元，$B_{\\mathrm{int}}\\ge B_{\\mathrm{phys}}$')
  if (p.pllBwHz >= p.fRefHz / 2) err.push('PLL 頻寬必須小於 $f_{\\mathrm{ref}}/2$（Nyquist）：離散時間迴路無法表示更高的頻率')
  if (p.fHHz <= p.fLHz) err.push('$f_H$ 必須大於 $f_L$（jitter 積分頻帶為空）')
  if (p.N * p.blocks > MAX_PIPELINE_SAMPLES) err.push(`N × blocks = ${p.N * p.blocks} 超過上限 ${MAX_PIPELINE_SAMPLES}（請減少 blocks 或 $N$；每個 sample 要重播一次）`)
  if (p.outBlocks > p.blocks) err.push('輸出分析視窗 outBlocks 不可大於 blocks')
  if (p.pll === 'cppll3' && p.pllPmDeg + (Math.atan(1 / p.pllP3Ratio) * 180) / Math.PI >= 89.5)
    err.push('CPPLL：$\\mathrm{PM}+\\arctan(1/r_p)$ 必須小於 $90^\\circ$，零點才解得出來（PM 太大或第三極點太近 crossover）')
  if (p.architecture === 'pmux8_gos' && p.codeSource === 'iid_pm_one') err.push('8 相 PMUX 架構需要 DSM 的 code（一階或 MASH）：iid $\\pm1$ 沒有相位可以選')
  return err
}

/** 實際輸出頻率 f_out = (N_int + frac_eff)·f_ref [Hz]（iid 參考 code 時用 frac 名目值）。 */
export function outputFrequencyHz(p: Pick<LabParams, 'fRefHz' | 'nInt' | 'frac' | 'dsmBits' | 'dither' | 'codeSource'>): number {
  const fracEff = p.codeSource === 'iid_pm_one' ? p.frac : quantizeFcw(p.frac, p.dsmBits, p.dither).fracEff
  return (p.nInt + fracEff) * p.fRefHz
}

// ───────────────────────────────────────────────────────────────────────────
// PLL 誤差路徑：none / Type-I / Type-II（含 T = 1 − H_PD）
// ───────────────────────────────────────────────────────────────────────────

export interface PllDesign {
  kind: PllKind
  /** 傳給 blockLms 的 pll_error_path（可 structured clone） */
  spec: ErrorPathSpec
  /** DTC 誤差 → PD residual 的 H_PD(z)（z⁻¹ 升冪） */
  H: DtTransfer
  /** DTC 誤差 → PLL output timing error 的 T(z) = 1 − H_PD(z) */
  T: DtTransfer
  description: string
  /** Type-II：ω_nT_s [rad/sample]；其他 null */
  wnTs: number | null
  Kp: number | null
  Ki: number | null
  /** Type-I：迴路增益 k = 1 − ρ；其他 null */
  kType1: number | null
  rho: number | null
  /** closed-loop poles（1 + L = 0 的根） */
  poles: { re: number; im: number }[]
  spectralRadius: number
  stable: boolean
  /** 實際 DT T(e^{jΩ}) 的 −3 dB 頻率（數值求解；none 時 NaN）[Hz] */
  f3dbTHz: number
  /** |H_PD(z = 1)|（type-I / II 為 0：DC 被主迴路抑制，E03 / E04） */
  hpdDc: number
  /** open-loop L(z)（z⁻¹ 升冪；none 時 null）。sspll.ts 的 makeLoop 形式，給 inversionBands / loopMargins 用 */
  loop: SspllLoop | null
  /** 校正迴路看到的反號帶 Re H_PD < 0（案例頁 inversionBands 的做法；none 時空陣列）[Hz] */
  inversionBands: { fLoHz: number; fHiHz: number; minReH: number; fMinHz: number }[]
  /** sampled-data 的 crossover 與 phase margin（loopMargins；none 時 NaN） */
  fcHz: number
  pmDeg: number
  /** 三階 CPPLL 的連續時間設計量（rad/sample 與 Hz）；其他 null */
  cppll: Cppll3Design | null
  warnings: string[]
}

/** 三階 CPPLL（charge pump + R‖C₁ + C₂ 的二階濾波，impulse-invariant 取樣）的設計量 */
export interface Cppll3Design {
  /** 連續時間 crossover ω_c T_s [rad/sample] 與 Hz */
  wc: number
  fcCtHz: number
  /** 零點、第三極點 [rad/sample] 與 Hz */
  wz: number
  wp: number
  fzHz: number
  fpHz: number
  /** L(s) = K(1 + s/ω_z)/(s²(1 + s/ω_p)) 的 K（以 T_s = 1 計） */
  K: number
  /** impulse-invariant 的 B = K(ω_p/ω_z − 1)/ω_p 與 p = e^{−ω_p} */
  B: number
  p: number
  /** 設計輸入：CT phase margin [deg]、第三極點比 r_p */
  pmCtDeg: number
  p3Ratio: number
  /** tan θ_z = ω_c/ω_z，θ_z = PM + arctan(1/r_p) */
  thetaZDeg: number
}

// #region core:type1FromBw
/**
 * Type-I DPLL：L(z) = k·z^{−1}/(1 − z^{−1}) ⇒ T(z) = k/(z − ρ)，ρ = 1 − k。
 * |T|² 降到 DC 的一半：sin(Ω₃/2) = (1 − ρ)/(2√ρ)。給定 f_bw 反解（令 r = √ρ、s = sin(πf_bw/f_s)）：
 *   1 − r² = 2sr ⇒ r = √(1 + s²) − s ⇒ ρ = (√(1 + s²) − s)²。
 */
export function type1PoleFromBw(fBwHz: number, fsHz: number): number {
  const s = Math.sin((Math.PI * fBwHz) / fsHz) // Ω₃/2 = π f_bw / f_s
  const r = Math.sqrt(1 + s * s) - s // 二次方程 r² + 2sr − 1 = 0 的正根
  return r * r // ρ = r²（s ≤ 1 ⇒ ρ ≥ 3 − 2√2，與 E27 的存在範圍一致）
}
// #endregion

/** |B(e^{jΩ})/A(e^{jΩ})|²（z⁻¹ 升冪係數） */
export function dtMag2(tf: DtTransfer, omega: number): number {
  let br = 0
  let bi = 0
  for (let i = 0; i < tf.b.length; i++) {
    br += tf.b[i] * Math.cos(omega * i)
    bi -= tf.b[i] * Math.sin(omega * i)
  }
  let ar = 0
  let ai = 0
  for (let i = 0; i < tf.a.length; i++) {
    ar += tf.a[i] * Math.cos(omega * i)
    ai -= tf.a[i] * Math.sin(omega * i)
  }
  return (br * br + bi * bi) / (ar * ar + ai * ai)
}

/**
 * Low-pass T 的 −3 dB 頻率（數值）：從 DC 往上找第一個 |T|² ≤ ½|T(1)|² 的頻率（越過 peaking 後），再二分。
 * 找不到時（例如 none 或全通）回傳 NaN。
 */
export function lowpass3dbHz(tf: DtTransfer, fsHz: number): number {
  const ref = dtMag2(tf, 0)
  if (!(ref > 0) || !Number.isFinite(ref)) return NaN
  const half = 0.5 * ref
  const n = 2000
  let prev = 1e-9
  for (let i = 1; i <= n; i++) {
    const om = 1e-9 * Math.pow(Math.PI / 1e-9, i / n)
    if (dtMag2(tf, om) <= half) {
      let lo = prev
      let hi = om
      for (let k = 0; k < 80; k++) {
        const mid = Math.sqrt(lo * hi)
        if (dtMag2(tf, mid) <= half) hi = mid
        else lo = mid
      }
      return (Math.sqrt(lo * hi) / (2 * Math.PI)) * fsHz
    }
    prev = om
  }
  return NaN
}

function trimTail(p: number[]): number[] {
  let m = p.length
  while (m > 1 && p[m - 1] === 0) m--
  return p.slice(0, m)
}

function rootsInfo(a: number[]): { poles: { re: number; im: number }[]; rho: number } {
  const t = trimTail(a)
  if (t.length < 2) return { poles: [], rho: 0 }
  const roots = polyRoots(t)
  let rho = 0
  for (const z of roots) rho = Math.max(rho, cAbs(z))
  return { poles: roots.map((z: Complex) => ({ re: z.re, im: z.im })), rho }
}

// #region core:pathNone
function pathNone(): Omit<PllDesign, 'f3dbTHz' | 'hpdDc' | 'inversionBands' | 'fcHz' | 'pmDeg'> {
  return {
    kind: 'none',
    spec: { kind: 'identity', parameters: {} },
    H: { b: [1], a: [1] }, // ← 差異：PD 直接看到 DTC 誤差（沒有主迴路動態）
    T: { b: [1], a: [1] }, // ← 差異：假設輸出端也直接看到（全通，最壞情況的 |T| = 1）
    description: '$H_{\\mathrm{PD}}=1$、$T=1$（教學用：忽略主 PLL 動態）',
    wnTs: null,
    Kp: null,
    Ki: null,
    kType1: null,
    rho: null,
    poles: [],
    spectralRadius: 0,
    stable: true,
    loop: null,
    cppll: null,
    warnings: [],
  }
}
// #endregion

// #region core:pathType1
function pathType1(p: Pick<LabParams, 'pllBwHz' | 'fRefHz' | 'loopDelay'>): Omit<PllDesign, 'f3dbTHz' | 'hpdDc' | 'inversionBands' | 'fcHz' | 'pmDeg'> {
  const rho = type1PoleFromBw(p.pllBwHz, p.fRefHz) // 以 d = 0 的封閉式設計
  const k = 1 - rho
  const d = p.loopDelay
  const den = [1, -1, ...new Array<number>(d).fill(0)] // 1 − z⁻¹
  den[1 + d] += k // ← 差異：1 + L = (1 − z⁻¹ + k z^{−(1+d)})/(1 − z⁻¹)，一個積分器
  const H = { b: [1, -1], a: den } // H_PD = (1 − z⁻¹)/(1 − z⁻¹ + k z^{−(1+d)})
  const T = { b: [...new Array<number>(1 + d).fill(0), k], a: den.slice() } // T = k z^{−(1+d)}/(…)
  const { poles, rho: sr } = rootsInfo(den)
  return {
    kind: 'type1',
    spec: { kind: 'iir', parameters: { b: H.b, a: H.a } },
    H,
    T,
    description: `Type-I DPLL：$k=${k.toPrecision(5)}$（$\\rho_T=${rho.toPrecision(6)}$）、$d_L=${d}$`,
    wnTs: null,
    Kp: null,
    Ki: null,
    kType1: k,
    rho,
    poles,
    spectralRadius: sr,
    stable: sr < 1,
    loop: makeLoop(`lab_type1_d${d}`, T.b, [1, -1], 1, { K: k, lat: 1 + d }), // L = k z^{−(1+d)}/(1 − z⁻¹)
    cppll: null,
    warnings: [],
  }
}
// #endregion

// #region core:pathType2
function pathType2(p: Pick<LabParams, 'pllBwHz' | 'fRefHz' | 'zeta' | 'loopDelay'>): Omit<PllDesign, 'f3dbTHz' | 'hpdDc' | 'inversionBands' | 'fcHz' | 'pmDeg'> {
  const des = designDtLoop({ fbw: p.pllBwHz, fs: p.fRefHz, zeta: p.zeta, loopDelay: p.loopDelay }) // E44 的 DPLL 差分方程
  return {
    kind: 'type2',
    spec: { kind: 'type2_dt', parameters: { wn_ts: des.wnTs, zeta: p.zeta, loop_delay: p.loopDelay, method: 'dpll' } },
    H: des.Hpd, // ← 差異：PI loop filter + 積分器 ⇒ 兩個積分器，H_PD 在 DC 為 0（二階零點）
    T: des.T, // T = L/(1 + L)
    description: `Type-II DPLL：$\\omega_nT_s=${texNum(des.wnTs, 4)}$、$\\zeta=${p.zeta}$、$K_p=${texNum(des.Kp, 4)}$、$K_i=${texNum(des.Ki, 4)}$、$d_L=${p.loopDelay}$`,
    wnTs: des.wnTs,
    Kp: des.Kp,
    Ki: des.Ki,
    kType1: null,
    rho: null,
    poles: des.poles.map((z) => ({ re: z.re, im: z.im })),
    spectralRadius: des.spectralRadius,
    stable: des.stable,
    loop: makeLoop(`lab_type2_d${p.loopDelay}`, des.L.b, des.L.a, 2, { Kp: des.Kp, Ki: des.Ki, lat: 1 + p.loopDelay }),
    cppll: null,
    warnings: des.warnings.slice(),
  }
}
// #endregion

// ── 多項式小工具（z⁻¹ 升冪係數；與 sspll.ts 相同的定義）──
function polyAdd(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length)
  const out = new Array<number>(n).fill(0)
  for (let i = 0; i < a.length; i++) out[i] += a[i]
  for (let i = 0; i < b.length; i++) out[i] += b[i]
  return out
}
function polyMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  return out
}

// #region core:cppll3Loop
/**
 * 三階 CPPLL 的 open loop（連續時間 L(s) = K(1 + s/ω_z)/(s²(1 + s/ω_p))，impulse-invariant 取樣、T_s = 1）：
 *   l(t) = K t + B(1 − e^{−ω_p t})，B = K(ω_p/ω_z − 1)/ω_p，p = e^{−ω_p}
 *   L(z) = Σ_{n≥1} l(n) z^{−n} = K z⁻¹/(1 − z⁻¹)² + B z⁻¹/(1 − z⁻¹) − B p z⁻¹/(1 − p z⁻¹)   （與 sspll.ts makeL3 的 'impulse' 相同）
 * 零點與第三極點的放置：ω_p = r_p ω_c、tan θ_z = ω_c/ω_z，θ_z = PM + arctan(1/r_p)（PM 是 CT crossover 處的 phase margin），
 * K 由 |L(jω_c)| = 1 解出：K = ω_c² √(1 + 1/r_p²) cos θ_z。r_p = √b、PM 取 makeL3 的對稱放置時兩者完全相同。
 * 額外的 loop latency d 以 z^{−d} 乘上去。
 */
export function cppll3Loop(wc: number, pmCtDeg: number, p3Ratio: number, loopDelay: number): { bL: number[]; aL: number[]; design: Cppll3Design } {
  const thetaZ = (pmCtDeg * Math.PI) / 180 + Math.atan(1 / p3Ratio)
  const wz = wc / Math.tan(thetaZ)
  const wp = p3Ratio * wc
  const K = wc * wc * Math.sqrt(1 + 1 / (p3Ratio * p3Ratio)) * Math.cos(thetaZ)
  const B = (K * (wp / wz - 1)) / wp
  const p = Math.exp(-wp)
  const d1 = [1, -1]
  const d2 = [1, -2, 1]
  const dp = [1, -p]
  const n1 = polyMul([0, K], dp) // K z⁻¹/(1 − z⁻¹)²
  const n2 = polyMul(polyMul([0, B], d1), dp) // B z⁻¹/(1 − z⁻¹)
  const n3 = polyMul([0, -B * p], d2) // −B p z⁻¹/(1 − p z⁻¹)
  let bL = polyAdd(polyAdd(n1, n2), n3)
  if (loopDelay > 0) bL = new Array<number>(loopDelay).fill(0).concat(bL)
  const aL = polyMul(d2, dp)
  return { bL, aL, design: { wc, fcCtHz: NaN, wz, wp, fzHz: NaN, fpHz: NaN, K, B, p, pmCtDeg, p3Ratio, thetaZDeg: (thetaZ * 180) / Math.PI } }
}
// #endregion

// #region core:pathCppll3
/** 三階 CPPLL：以二分法調 ω_c 讓實際 DT |T| 的 −3 dB 等於 pllBwHz（形狀由 PM 與 r_p 決定、不變）。 */
function pathCppll3(p: Pick<LabParams, 'pllBwHz' | 'fRefHz' | 'loopDelay' | 'pllPmDeg' | 'pllP3Ratio'>): Omit<PllDesign, 'f3dbTHz' | 'hpdDc' | 'inversionBands' | 'fcHz' | 'pmDeg'> {
  const target = p.pllBwHz / p.fRefHz
  const build = (wc: number) => cppll3Loop(wc, p.pllPmDeg, p.pllP3Ratio, p.loopDelay)
  const f3 = (wc: number): number => {
    const { bL, aL } = build(wc)
    const den = polyAdd(aL, bL)
    return lowpass3dbHz({ b: bL, a: den }, 1) // 正規化頻率（f_s = 1）
  }
  // −3 dB 對 ω_c 單調遞增；在 [1e-6, 1] rad/sample 內二分（找不到 −3 dB 的 ω_c 視為「太大」）
  let lo = 1e-6
  let hi = 1
  for (let it = 0; it < 80; it++) {
    const mid = Math.sqrt(lo * hi)
    const v = f3(mid)
    if (!Number.isFinite(v) || v > target) hi = mid
    else lo = mid
  }
  const wc = Math.sqrt(lo * hi)
  const { bL, aL, design } = build(wc)
  const den = polyAdd(aL, bL)
  const H = { b: aL.slice(), a: den.slice() } // H_PD = 1/(1 + L) = aL/(aL + bL)
  const T = { b: bL.slice(), a: den.slice() } // T = L/(1 + L) = bL/(aL + bL)
  const { poles, rho: sr } = rootsInfo(den)
  const fs = p.fRefHz
  const cp: Cppll3Design = { ...design, fcCtHz: (wc * fs) / (2 * Math.PI), fzHz: (design.wz * fs) / (2 * Math.PI), fpHz: (design.wp * fs) / (2 * Math.PI) }
  return {
    kind: 'cppll3',
    spec: { kind: 'iir', parameters: { b: H.b, a: H.a } }, // ← 差異：三階閉迴路（兩個積分器 + 第三極點），給 blockLms 的是一般 IIR
    H,
    T,
    description: `三階 CPPLL（impulse-invariant）：$\\mathrm{PM}_{\\mathrm{CT}}=${p.pllPmDeg}^\\circ$、$r_p=${p.pllP3Ratio}$、$f_c=${texNum(cp.fcCtHz / 1e6, 4)}\\,\\mathrm{MHz}$、$f_z=${texNum(cp.fzHz / 1e6, 4)}\\,\\mathrm{MHz}$、$f_{p3}=${texNum(cp.fpHz / 1e6, 4)}\\,\\mathrm{MHz}$、$d_L=${p.loopDelay}$`,
    wnTs: null,
    Kp: null,
    Ki: null,
    kType1: null,
    rho: null,
    poles,
    spectralRadius: sr,
    stable: sr < 1,
    loop: makeLoop(`lab_cppll3_pm${p.pllPmDeg}_rp${p.pllP3Ratio}_d${p.loopDelay}`, bL, aL, 2, { K: design.K, wc, wz: design.wz, wp: design.wp, B: design.B, p: design.p, pmCt: p.pllPmDeg, p3Ratio: p.pllP3Ratio, lat: 1 + p.loopDelay }),
    cppll: cp,
    warnings: [],
  }
}
// #endregion

/** pllDesign 的輸入：CPPLL 的兩個設計參數可省略（預設 PM 60°、r_p = 4），其餘頁面（numbers.ts、Training）照舊只給五個欄位。 */
export type PllDesignInput = Pick<LabParams, 'pll' | 'pllBwHz' | 'fRefHz' | 'zeta' | 'loopDelay'> & Partial<Pick<LabParams, 'pllPmDeg' | 'pllP3Ratio'>>

/** 依 LabParams 建立主 PLL 的誤差路徑設計（none / Type-I / Type-II / 三階 CPPLL），含反號帶（案例頁 inversionBands 的做法）。 */
export function pllDesign(p: PllDesignInput): PllDesign {
  const base =
    p.pll === 'none'
      ? pathNone()
      : p.pll === 'type1'
        ? pathType1(p)
        : p.pll === 'cppll3'
          ? pathCppll3({ pllBwHz: p.pllBwHz, fRefHz: p.fRefHz, loopDelay: p.loopDelay, pllPmDeg: p.pllPmDeg ?? DEFAULT_LAB_PARAMS.pllPmDeg, pllP3Ratio: p.pllP3Ratio ?? DEFAULT_LAB_PARAMS.pllP3Ratio })
          : pathType2(p)
  const f3dbTHz = p.pll === 'none' ? NaN : lowpass3dbHz(base.T, p.fRefHz)
  const hpdDc = Math.sqrt(dtMag2(base.H, 0))
  const warnings = base.warnings.slice()
  // 反號帶與 sampled-data 的 crossover / PM：只在迴路穩定時算（不穩定的迴路 Re H_PD 沒有意義）
  let bands: PllDesign['inversionBands'] = []
  let fcHz = NaN
  let pmDeg = NaN
  if (base.loop && base.stable) {
    bands = inversionBands(base.loop).map((b) => ({ fLoHz: b.fLo * p.fRefHz, fHiHz: b.fHi * p.fRefHz, minReH: b.minReH, fMinHz: b.fMin * p.fRefHz }))
    try {
      const m = loopMargins(base.loop)
      fcHz = m.fc * p.fRefHz
      pmDeg = m.pmDeg
    } catch {
      /* 沒有 crossover（例如增益太小）：留 NaN */
    }
  }
  if (bands.length > 0) {
    const b = bands[0]
    warnings.push(
      `這個迴路有反號帶：$f\\in[${texNum(b.fLoHz / 1e6, 4)},\\,${texNum(b.fHiHz / 1e6, 4)}]\\,\\mathrm{MHz}$ 內 $\\mathrm{Re}\\,H_{\\mathrm{PD}}<0$（最負 $${texNum(b.minReH, 3)}$ 在 $${texNum(b.fMinHz / 1e6, 4)}\\,\\mathrm{MHz}$）：regressor 的功率落在這一帶時相關 $C$ 會變負（案例頁 §6–§8；8 相 PMUX 的 mode-1 旋轉頻率 $\\alpha f_{\\mathrm{ref}}$ 落進去就是 PHOS 反號）。`,
    )
  }
  if (!base.stable)
    warnings.push(
      `主 PLL 線性模型不穩定（closed-loop pole 半徑 $${base.spectralRadius.toPrecision(6)}\\ge 1$）：loop latency $d_L$ 太大或頻寬太寬，$1+L(z)=0$ 的根跑到單位圓外，後面所有結果都沒有物理意義。請減小 $d_L$ 或 $f_{\\mathrm{BW}}$。`,
    )
  if (p.pll !== 'none' && Number.isFinite(f3dbTHz) && Math.abs(f3dbTHz / p.pllBwHz - 1) > 0.1) {
    warnings.push(
      `實際 DT 主 PLL 的 $T$ $-3\\,\\mathrm{dB}$ 頻率為 $${(f3dbTHz / 1e6).toPrecision(4)}\\,\\mathrm{MHz}$，與設計值 $${(p.pllBwHz / 1e6).toPrecision(4)}\\,\\mathrm{MHz}$ 差超過 10%：loop latency 或 $\\omega_nT_s$ 不夠小時，CT 原型與 DT 迴路不再對應（E44）。`,
    )
  }
  return { ...base, f3dbTHz, hpdDc, inversionBands: bands, fcHz, pmDeg, warnings }
}

// ───────────────────────────────────────────────────────────────────────────
// LabParams → BlockLmsConfig
// ───────────────────────────────────────────────────────────────────────────

/** 由 LabParams 產生 runBlockLms 的設定（可加覆寫，例如 FCW sweep 的 frac 或較少的 blocks）。 */
export function toBlockLmsConfig(p: LabParams, over: Partial<BlockLmsConfigInput> = {}): BlockLmsConfigInput {
  const des = pllDesign(p)
  const pattern =
    p.codeSource === 'iid_pm_one'
      ? ({ kind: 'iid_pm_one', parameters: { amplitude: 1 } } as const)
      : ({ kind: p.codeSource, parameters: { frac: p.frac, bits: p.dsmBits, dither: p.dither, signal: 'residue' } } as const)
  return {
    model: 'sign_error_block_lms',
    seed: p.seed,
    sample_rate_hz: p.fRefHz,
    output_frequency_hz: outputFrequencyHz(p),
    gm_accum_samples: p.N,
    gain_initial: p.w0Fs,
    gain_true: p.aFs,
    gain_step: p.muFs,
    code_normalization: p.normalization,
    gm_mode: p.gmMode,
    pd_noise_rms_fs: p.sigmaV,
    comparator_offset_fs: p.compOffsetFs,
    comparator_encoding: p.encoding,
    gm_code_delay_samples: p.regressor === 'raw' ? 0 : p.codeDelay,
    cal_update_delay_blocks: p.updateDelay,
    pll_error_path: des.spec as BlockLmsConfigInput['pll_error_path'],
    seeded_pattern: pattern,
    gain_register: {
      internal_bits: p.internalBits,
      physical_bits: p.physicalBits,
      rounding: p.rounding,
      overflow: p.overflow,
      quantize_physical: p.quantize,
      lsb_fs: p.lsbFs,
      signed: p.signedReg,
    },
    mode: 'unified-lab',
    num_blocks: p.blocks,
    regressor_mode: p.regressor,
    filtered_x_model: { path: 'same_as_path', gain_mismatch: p.fxGain, extra_delay_samples: p.fxExtraDelay },
    dtc_nonlinearity: { offset_fs: p.dtcOffsetFs, c2: p.c2, c3: p.c3 },
    record: { sample_trace_blocks: 1, decimate: Math.max(1, Math.ceil(p.N / TRACE_POINTS)) },
    ...over,
  }
}

function resolveConfig(input: BlockLmsConfigInput): BlockLmsConfig {
  const r = parseBlockLmsConfig(input)
  if (!r.ok) throw new Error(`unifiedLab 參數錯誤：\n${r.errors.join('\n')}`)
  return r.config
}

// ───────────────────────────────────────────────────────────────────────────
// 一階 DSM residue 的封閉式
// ───────────────────────────────────────────────────────────────────────────

// #region core:firstOrderResidue
/**
 * 一階 DSM（零初值、無 dither）的 residue r[n] = −{(n+1)K′/P}（T_vco），P = M/gcd(K, M)、K′ = K/gcd。
 * 一個週期內 (n+1)K′ mod P 恰好走遍 0…P−1 各一次，所以：
 *   E[r] = −(P − 1)/(2P)，E[r²] = (P − 1)(2P − 1)/(6P²)，Var(r) = (P² − 1)/(12P²)。
 * 基頻（f = frac_eff·f_s，折回 [0, f_s/2]）譜線的 peak 振幅：A₁ = 1/(P·sin(π/P))（P = 2 時在 Nyquist，為 1/4）。
 */
export function firstOrderResidueStats(frac: number, bits: number): {
  K: number
  M: number
  P: number
  fracEff: number
  mean: number
  meanSquare: number
  variance: number
  line1: number
} {
  const q = quantizeFcw(frac, bits, false)
  const { K, M } = q
  let g = M
  let a = K
  while (a !== 0) {
    const t = g % a
    g = a
    a = t
  }
  const P = K === 0 ? 1 : M / g // 週期（K = 0 ⇒ 整數 FCW，residue ≡ 0）
  const mean = -(P - 1) / (2 * P) // −(1/P)Σ j/P
  const meanSquare = ((P - 1) * (2 * P - 1)) / (6 * P * P) // (1/P)Σ (j/P)²
  const variance = (P * P - 1) / (12 * P * P)
  const line1 = P <= 1 ? 0 : P === 2 ? 0.25 : 1 / (P * Math.sin(Math.PI / P)) // ← Σ j z^j 的封閉式
  return { K, M, P, fracEff: q.fracEff, mean, meanSquare, variance, line1 }
}
// #endregion

/** 把頻率折回 [0, f_s/2]（取樣後的 alias） */
export function foldFrequency(f: number, fs: number): number {
  const r = ((f % fs) + fs) % fs
  return r > fs / 2 ? fs - r : r
}

// ───────────────────────────────────────────────────────────────────────────
// 迴路小工具
// ───────────────────────────────────────────────────────────────────────────

/** δ_{k+1} = δ_k − gδ_{k−d} 的 spectral radius（z^{d+1} − z^d + g = 0 的最大根模） */
export function delayLoopRadius(g: number, d: number): number {
  if (!Number.isFinite(g)) return NaN
  const c = new Array<number>(d + 2).fill(0)
  c[0] = 1
  c[1] = -1
  c[d + 1] += g
  return polyRoots(c).reduce((m, z) => Math.max(m, cAbs(z)), 0)
}

/** 平均 δ 軌跡（線性延遲模型）：δ_{k+1} = δ_k − gδ_{k−d}，δ_j = δ₀（j ≤ 0）。回傳 δ_0…δ_K。 */
export function meanDeltaTrajectory(delta0: number, g: number, d: number, K: number): Float64Array {
  const out = new Float64Array(K + 1)
  out[0] = delta0
  for (let k = 0; k < K; k++) {
    const lag = k - d >= 0 ? out[k - d] : delta0
    out[k + 1] = out[k] - g * lag
  }
  return out
}

/** 一階 cal 迴路的四種頻寬（d = 0；E06 / E10 / E26 / E27）。 */
export function calBandwidths(p: number, fuHz: number): { exact: number; negLnP: number; oneMinusP: number; enbw: number } {
  return { exact: bw3dbExact(p, fuHz), negLnP: bw3dbNegLnP(p, fuHz), oneMinusP: bw3dbOneMinusP(p, fuHz), enbw: enbwOneSided(p, fuHz) }
}

function decimateIdx(n: number, maxPts: number): number[] {
  if (n <= maxPts) return Array.from({ length: n }, (_, i) => i)
  const step = n / maxPts
  const out: number[] = []
  for (let i = 0; i < maxPts; i++) out.push(Math.floor(i * step))
  return out
}

function pick(x: ArrayLike<number>, idx: number[]): Float64Array {
  const out = new Float64Array(idx.length)
  for (let i = 0; i < idx.length; i++) out[i] = x[idx[i]]
  return out
}

function meanOf(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]
  return s / x.length
}

function varOf(x: ArrayLike<number>, m = meanOf(x)): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += (x[i] - m) * (x[i] - m)
  return s / x.length
}

/** 對數頻率格點上取每格最大值（保留譜線），PSD 圖用。 */
export function logDecimateMax(f: ArrayLike<number>, psd: ArrayLike<number>, nBins = 1200): { f: Float64Array; psd: Float64Array } {
  let i0 = 0
  while (i0 < f.length && !(f[i0] > 0)) i0++
  if (i0 >= f.length - 1) return { f: Float64Array.from(f), psd: Float64Array.from(psd) }
  const lo = Math.log(f[i0])
  const hi = Math.log(f[f.length - 1])
  const fo: number[] = []
  const po: number[] = []
  let bin = -1
  let best = -Infinity
  let bestF = 0
  for (let i = i0; i < f.length; i++) {
    const b = Math.min(nBins - 1, Math.floor(((Math.log(f[i]) - lo) / (hi - lo + 1e-300)) * nBins))
    if (b !== bin) {
      if (bin >= 0) {
        fo.push(bestF)
        po.push(best)
      }
      bin = b
      best = psd[i]
      bestF = f[i]
    } else if (psd[i] > best) {
      best = psd[i]
      bestF = f[i]
    }
  }
  fo.push(bestF)
  po.push(best)
  return { f: Float64Array.from(fo), psd: Float64Array.from(po) }
}

// ───────────────────────────────────────────────────────────────────────────
// Mean-field 平均軌跡（對 comparator 雜訊取期望值；code 逐 sample 代入）
// ───────────────────────────────────────────────────────────────────────────

/** 2/√π */
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI)

/**
 * erf 的快速版（mean-field twin 每個 sample 呼叫一次）：|z| < 0.5 用 Maclaurin 級數
 *   erf(z) = (2/√π)·(z − z³/3 + z⁵/10 − z⁷/42 + z⁹/216 − z¹¹/1320 + z¹³/9360 − …)，
 * 截斷誤差 < (2/√π)·0.5¹⁵/75600 ≈ 5×10⁻¹⁰；其餘交給 core 的 erf（雙精度）。
 * 校正迴路的 e_det/(√2σ_v) 通常遠小於 0.5，所以幾乎都走級數這一支。
 */
export function erfFast(z: number): number {
  if (z < 0.5 && z > -0.5) {
    const t = z * z
    return TWO_OVER_SQRT_PI * z * (1 + t * (-1 / 3 + t * (1 / 10 + t * (-1 / 42 + t * (1 / 216 + t * (-1 / 1320 + t * (1 / 9360)))))))
  }
  return erf(z)
}

/** mean-field twin 的結果（block 級）。 */
export interface MeanFieldTwin {
  /** ŵ_0…ŵ_K [fs]：ŵ_{k+1} = ŵ_k + μ·Ĝ_k(ŵ_{k−d})；σ_v = 0 時全為 NaN（erf 退化成 sign，沒有平均模型） */
  w: Float64Array
  /** 每個 block 的相關 C_k = (1/N)Σ x_ref·u_x（只由 code、H_PD、regressor 決定；無因次） */
  C: Float64Array
  /** 每個 block 的偏差項 B_k = (1/N)Σ x_ref·(u_d + b) [fs]（u_d = H_PD{d(x)}；bipolar 的定義） */
  B: Float64Array
}

// #region core:meanFieldTwin
/**
 * mean-field twin：與迴路同一串 code、同一個 H_PD、同一個更新式，只把 comparator 的隨機輸出 q 換成它對雜訊 v 的期望值
 *   E[q | e_det] = erf(e_det/(√2σ_v))（bipolar / 0/1 已映射）；0/1 未映射時 E[q] = Φ(e_det/σ_v) = ½(1 + erf(…))。
 * 每個 block：Ĝ_k = (1/N)Σ_n x_ref[n]·E[q | e_det[n]]，e_det[n] = (a − ŵ_app)·u_x[n] + u_d[n] + b；ŵ_{k+1} = ŵ_k + μĜ_k。
 * 近似只有一個：把 (a − ŵ) 提到 H_PD 外面（ŵ 在 H_PD 的記憶長度內近似不變）。不做小訊號線性化，也不假設 code 的統計是平穩的。
 */
function createMeanFieldTwin(cfg: BlockLmsConfig, K: number): MeanFieldTwin & { block(k: number, xr: Float64Array, ux: Float64Array, ud: Float64Array | null): void } {
  const N = cfg.gm_accum_samples
  const a = cfg.gain_true
  const mu = cfg.gain_step
  const dUp = cfg.cal_update_delay_blocks
  const bOff = cfg.comparator_offset_fs
  const avg = cfg.gm_mode === 'average'
  const bug = cfg.comparator_encoding === 'unipolar_unmapped_bug'
  const inv = cfg.pd_noise_rms_fs > 0 ? 1 / (cfg.pd_noise_rms_fs * Math.SQRT2) : NaN // σ_v = 0 ⇒ 沒有 mean-field（NaN 一路傳下去）
  const w = new Float64Array(K + 1)
  const C = new Float64Array(K)
  const B = new Float64Array(K)
  w[0] = cfg.gain_initial
  return {
    w,
    C,
    B,
    /** 處理第 k 個 block：xr = GMAC regressor、ux = H_PD{x}、ud = H_PD{d(x)}（沒有非線性時為 null），各 N 個樣本 */
    block(k: number, xr: Float64Array, ux: Float64Array, ud: Float64Array | null): void {
      const coef = a - w[k - dUp >= 0 ? k - dUp : 0] // 這個 block 實際作用的是 d 個 block 以前的 ŵ
      let acc = 0
      let c = 0
      let b = 0
      for (let n = 0; n < N; n++) {
        const eDet = coef * ux[n] + (ud === null ? 0 : ud[n]) + bOff // deterministic 的 comparator 輸入
        const m = erfFast(eDet * inv) // ← 差異：q 換成 E[q | e_det] = erf(e_det/(√2σ_v))（沒有抽亂數）
        acc += (bug ? 0.5 * (1 + m) : m) * xr[n] // 0/1 未映射：E[q] = Φ(e_det/σ_v)
        c += xr[n] * ux[n]
        b += xr[n] * (eDet - coef * ux[n])
      }
      w[k + 1] = w[k] + mu * (avg ? acc / N : acc) // 與迴路同一個更新式（浮點，不含暫存器量化）
      C[k] = c / N
      B[k] = b / N
    },
  }
}
// #endregion

/**
 * 獨立版的 mean-field twin（不需要先跑迴路；Monte Carlo 分頁用）：與 replayPipeline 內嵌的版本共用同一個 kernel，
 * code 串流、正規化、Ĥ、H_PD 的處理順序也相同（測試會核對兩者逐位元一致）。worker 可呼叫。
 */
export function meanFieldTwin(p: { config: BlockLmsConfigInput; normalization: { offset: number; scale: number } }): MeanFieldTwin {
  const cfg = resolveConfig(p.config)
  const N = cfg.gm_accum_samples
  const K = cfg.num_blocks
  const D = cfg.regressor_mode === 'raw' ? 0 : cfg.gm_code_delay_samples
  const { offset_fs: nlOff, c2: nlC2, c3: nlC3 } = cfg.dtc_nonlinearity
  const hasNl = nlOff !== 0 || nlC2 !== 0 || nlC3 !== 0
  const { offset: normOff, scale: normSc } = p.normalization
  const doNorm = normOff !== 0 || normSc !== 1
  const identity = cfg.pll_error_path.kind === 'identity'
  const path = errorPathTransfer(cfg.pll_error_path as ErrorPathSpec)
  const hat = hatTransfer(cfg, path)
  const src = createCodeSource(cfg.seeded_pattern, createRng(cfg.seed).fork('code-pattern'))
  const hatF = hat ? new StreamFilter(hat.b, hat.a) : null
  const uxF = identity ? null : new StreamFilter(path.b, path.a)
  const udF = identity || !hasNl ? null : new StreamFilter(path.b, path.a)
  const mf = createMeanFieldTwin(cfg, K)
  const xext = new Float64Array(N + D)
  const rext = hat ? new Float64Array(N + D) : null
  const xr = rext ?? xext
  const uxB = new Float64Array(N)
  const udB = hasNl ? new Float64Array(N) : null
  for (let k = 0; k < K; k++) {
    if (D > 0) {
      xext.copyWithin(0, N, N + D)
      if (rext) rext.copyWithin(0, N, N + D)
    }
    src.fill(xext, D, N)
    if (doNorm) for (let i = D; i < D + N; i++) xext[i] = (xext[i] - normOff) * normSc
    if (hatF && rext) for (let i = D; i < D + N; i++) rext[i] = hatF.step(xext[i])
    for (let n = 0; n < N; n++) {
      const x = xext[D + n]
      uxB[n] = uxF === null ? x : uxF.step(x)
      if (udB) {
        const dx = nlOff + x * x * (nlC2 + nlC3 * x)
        udB[n] = udF === null ? dx : udF.step(dx)
      }
    }
    mf.block(k, xr, uxB, udB)
  }
  return { w: mf.w, C: mf.C, B: mf.B }
}

// ───────────────────────────────────────────────────────────────────────────
// Replay：逐 sample 重播 runBlockLms（跨級一致性）並取出穩態視窗
// ───────────────────────────────────────────────────────────────────────────

/** 與 runBlockLms 相同的 filtered-x 模型 Ĥ（gain_mismatch·H_model·z^{−extra}） */
function hatTransfer(cfg: BlockLmsConfig, path: DtTransfer): DtTransfer | null {
  if (cfg.regressor_mode !== 'filtered') return null
  const fx = cfg.filtered_x_model
  const base = fx.path === 'same_as_path' ? path : errorPathTransfer(fx.path as ErrorPathSpec)
  return { b: new Array<number>(fx.extra_delay_samples).fill(0).concat(base.b.map((v) => v * fx.gain_mismatch)), a: base.a.slice() }
}

export interface ReplayWindow {
  /** 視窗起點 block k₀ 與 block 數 W */
  startBlock: number
  blocks: number
  /** 逐 sample（長度 W·N） */
  x: Float64Array
  /** e_DTC = (a − w_app)x + o + c₂x² + c₃x³ [fs] */
  eDtc: Float64Array
  /** PD residual u_pd = H_PD{e_DTC} [fs] */
  uPd: Float64Array
  /** comparator 輸入 e = u_pd + b + v [fs] */
  e: Float64Array
  q: Float64Array
  xRef: Float64Array
  /** 有效 regressor u_x = H_PD{x}（無因次） */
  ux: Float64Array
  /** output timing error t_out = T{e_DTC} [fs] */
  tOut: Float64Array
  /** 靜態部分 T{(a − w̄)x + d(x)} [fs] */
  tStatic: Float64Array
  /** T{x}（無因次；output 對 gain 誤差的靈敏度） */
  tx: Float64Array
  /** 視窗內每個 block 實際作用的 gain w_app,k [fs] */
  wApp: Float64Array
  /** w̄ = mean(w_app) over 視窗 */
  wBar: number
}

export interface ReplayResult {
  /** 重播 G_k 與 runBlockLms 的最大絕對差（應為 0：同 seed、同運算順序） */
  maxAbsDiffG: number
  /** 比對的 block 數 */
  blocksCompared: number
  window: ReplayWindow
  /** mean-field 平均軌跡與每個 block 的 C_k、B_k（與 meanFieldTwin 相同；重播時順便算，不必再跑一次 code） */
  meanField: MeanFieldTwin
}

// #region core:pipelineReplay
/**
 * 重播：與 runBlockLms 的 inner loop 完全相同的 fork 標籤、亂數抽取順序、濾波器與運算順序；
 * 唯一的差別是 w_app 直接讀 runBlockLms 回傳的 wPhys（所以 gain register 的 rounding 亂數不必重播）。
 * 回傳的 maxAbsDiffG 是「跨級一致性」檢查：DSM → 正規化 → DTC → H_PD → comparator → GMAC 每一級都對齊時應為 0。
 */
export function replayPipeline(p: {
  config: BlockLmsConfig
  wPhys: ArrayLike<number>
  G: ArrayLike<number>
  normalization: { offset: number; scale: number }
  T: DtTransfer
  windowBlocks: number
  /** 只重播到這個 block（發散時用）；預設 num_blocks */
  untilBlock?: number
}): ReplayResult {
  const cfg = p.config
  const N = cfg.gm_accum_samples
  const K = Math.min(cfg.num_blocks, p.untilBlock ?? cfg.num_blocks)
  const D = cfg.regressor_mode === 'raw' ? 0 : cfg.gm_code_delay_samples
  const dUp = cfg.cal_update_delay_blocks
  const a = cfg.gain_true
  const sigma = cfg.pd_noise_rms_fs
  const bOff = cfg.comparator_offset_fs
  const { offset_fs: nlOff, c2: nlC2, c3: nlC3 } = cfg.dtc_nonlinearity
  const hasNl = nlOff !== 0 || nlC2 !== 0 || nlC3 !== 0
  const avg = cfg.gm_mode === 'average'
  const qLo = cfg.comparator_encoding === 'unipolar_unmapped_bug' ? 0 : -1
  const mapped = cfg.comparator_encoding === 'unipolar_mapped'
  const { offset: normOff, scale: normSc } = p.normalization
  const doNorm = normOff !== 0 || normSc !== 1
  const identity = cfg.pll_error_path.kind === 'identity'
  const path = errorPathTransfer(cfg.pll_error_path as ErrorPathSpec)
  const hat = hatTransfer(cfg, path)

  // 與 runBlockLms 相同的亂數流
  const root = createRng(cfg.seed)
  const src = createCodeSource(cfg.seeded_pattern, root.fork('code-pattern'))
  const gauss = createZigguratNormal(root.fork('comparator-noise'))
  const pathF = identity ? null : new StreamFilter(path.b, path.a)
  const hatF = hat ? new StreamFilter(hat.b, hat.a) : null
  // 只供分析用的額外濾波器（不消耗亂數）
  const uxF = identity ? null : new StreamFilter(path.b, path.a)
  const udF = identity || !hasNl ? null : new StreamFilter(path.b, path.a) // u_d = H_PD{d(x)}（mean-field twin 用）
  const mf = createMeanFieldTwin(cfg, K)
  const uxB = new Float64Array(N) // 這個 block 的 u_x、u_d（交給 mean-field twin）
  const udB = hasNl ? new Float64Array(N) : null
  const tF = new StreamFilter(p.T.b, p.T.a)
  const tSF = new StreamFilter(p.T.b, p.T.a)
  const txF = new StreamFilter(p.T.b, p.T.a)

  const W = Math.max(1, Math.min(p.windowBlocks, K))
  const k0 = K - W
  // 視窗內的 w̄（靜態部分用；在重播前就能算）
  const wApp = new Float64Array(W)
  for (let j = 0; j < W; j++) {
    const k = k0 + j
    wApp[j] = p.wPhys[k - dUp >= 0 ? k - dUp : 0]
  }
  const wBar = meanOf(wApp)
  const L = W * N
  const win = {
    x: new Float64Array(L),
    eDtc: new Float64Array(L),
    uPd: new Float64Array(L),
    e: new Float64Array(L),
    q: new Float64Array(L),
    xRef: new Float64Array(L),
    ux: new Float64Array(L),
    tOut: new Float64Array(L),
    tStatic: new Float64Array(L),
    tx: new Float64Array(L),
  }

  const xext = new Float64Array(N + D)
  const rext = hat ? new Float64Array(N + D) : null
  const xr = rext ?? xext
  let maxAbs = 0
  for (let k = 0; k < K; k++) {
    const wAppK = p.wPhys[k - dUp >= 0 ? k - dUp : 0]
    const coef = a - wAppK
    if (D > 0) {
      xext.copyWithin(0, N, N + D)
      if (rext) rext.copyWithin(0, N, N + D)
    }
    src.fill(xext, D, N)
    if (doNorm) for (let i = D; i < D + N; i++) xext[i] = (xext[i] - normOff) * normSc
    if (hatF && rext) for (let i = D; i < D + N; i++) rext[i] = hatF.step(xext[i])
    const rec = k >= k0
    const base = (k - k0) * N
    let acc = 0
    for (let n = 0; n < N; n++) {
      // #region core:replayInnerLoop
      const x = xext[D + n]
      let dt = coef * x // DTC：(a − w_app)·x
      if (hasNl) dt += nlOff + x * x * (nlC2 + nlC3 * x) // + d(x)
      const u = pathF === null ? dt : pathF.step(dt) // PD residual H_PD{e_DTC}（狀態跨 block 持續）
      const e = u + bOff + sigma * gauss() // comparator 輸入
      let q: number
      if (mapped) q = 2 * (e >= 0 ? 1 : 0) - 1 // 硬體 0/1 → ±1
      else q = e >= 0 ? 1 : qLo // tie：e ≥ 0 ⇒ +1（E07）
      const xrn = xr[n]
      acc += q * xrn
      // ── 以下只為分析（不影響 G）──
      const ux = uxF === null ? x : uxF.step(x) // ← 差異：有效 regressor u_x = H_PD{x}（算 C_k、PE 用）
      const tOut = tF.step(dt) // ← 差異：同一個 e_DTC 再走一次 T ⇒ output timing error
      // #endregion
      // ── mean-field twin 要用的 u_x、u_d（整個 block 收齊後一次處理）──
      uxB[n] = ux
      const dx = hasNl ? nlOff + x * x * (nlC2 + nlC3 * x) : 0
      if (udB) udB[n] = udF === null ? dx : udF.step(dx)
      // ── 靜態部分與輸出靈敏度（線性疊加，用來把 t_out 拆成兩項）──
      let eStatic = (a - wBar) * x
      if (hasNl) eStatic += dx
      const tSt = tSF.step(eStatic)
      const tx = txF.step(x)
      if (rec) {
        const i = base + n
        win.x[i] = x
        win.eDtc[i] = dt
        win.uPd[i] = u
        win.e[i] = e
        win.q[i] = q
        win.xRef[i] = xrn
        win.ux[i] = ux
        win.tOut[i] = tOut
        win.tStatic[i] = tSt
        win.tx[i] = tx
      }
    }
    mf.block(k, xr, uxB, udB) // mean-field twin：同一個 block，q 換成 E[q | e_det]（不抽亂數）
    const Gk = avg ? acc / N : acc
    const d = Math.abs(Gk - p.G[k])
    if (d > maxAbs || Number.isNaN(d)) maxAbs = Number.isNaN(d) ? Infinity : d
  }
  // #endregion
  return { maxAbsDiffG: maxAbs, blocksCompared: K, window: { startBlock: k0, blocks: W, wApp, wBar, ...win }, meanField: { w: mf.w, C: mf.C, B: mf.B } }
}

// ───────────────────────────────────────────────────────────────────────────
// 輸出端分析（L4）
// ───────────────────────────────────────────────────────────────────────────

export interface ToneReport {
  fHz: number
  /** output timing tone 的 peak 振幅 [fs] */
  ampFs: number
  /** 單邊 spur：20log10(β/2) [dBc]（β = 2π f_out A；小角近似） */
  dbc: number
  /** 精確 sideband：20log10(J₁(β)/J₀(β)) [dBc] */
  dbcBessel: number
  source: 'closed-form' | 'toneFit' | 'findTones'
}

export interface OutputAnalysis {
  /** 視窗內 w_app 的平均與標準差 [fs]、AR 有效樣本數 */
  wBar: number
  sigmaWWindow: number
  essW: number
  /** code 在視窗內的平均 x̄、x̃ 的變異數、T{x̃} 的變異數 */
  xMean: number
  xVar: number
  txVar: number
  /** 時域 RMS [fs]：總輸出、靜態部分、gain-noise 部分、PD residual（comparator 前、不含 b 與 v） */
  rmsOut: number
  rmsStatic: number
  rmsNoise: number
  rmsPd: number
  rmsEDtc: number
  /** gain-noise 部分的解析近似：σ_w²(x̄² + Var(T{x̃}))（σ_w 用視窗內實測值）[fs] */
  rmsNoisePred: number
  /** 同上但 σ_w 用解析 σ_w,pred */
  rmsNoisePredAnalytic: number
  /** [f_L, f_H] 解析積分 jitter（gain-noise 部分）[fs] 與靜態部分（Welch 積分）[fs] */
  jitterBandNoise: number
  jitterBandStatic: number
  /** 模擬 Welch 的頻率解析度與實際可積分下限 [Hz] */
  welchDf: number
  jitterBandSim: number
  bandUsed: [number, number]
  /** PSD（one-sided、fs²/Hz）：模擬（對數抽樣）與解析曲線；ℒ(f) dBc/Hz */
  psdSim: { f: Float64Array; psd: Float64Array; window: string; nperseg: number; enbwHz: number; nSegments: number }
  psdAnalytic: { f: Float64Array; noise: Float64Array; t2: Float64Array; hpd2: Float64Array }
  /** spur：一階 DSM 基頻的封閉式與 toneFit、findTones 列表 */
  fracToneHz: number
  toneClosedForm: ToneReport | null
  toneFitSim: ToneReport | null
  tones: ToneReport[]
  /** findTones 的偵測條件（Blackman–Harris Welch 的段數、顯著性門檻 dB） */
  toneDetect: { nperseg: number; nSegments: number; significanceDb: number }
  notes: string[]
}

/** δw 的 block-rate PSD（DTFT，含更新延遲 d）：S_w(e^{jΩ}) = σ_η²·|μz^{−1}/(1 − z^{−1} + g z^{−(d+1)})|² */
function swBlockDtft(omega: number, mu: number, g: number, d: number, sEta: number): number {
  // 分母 A(e^{jΩ}) = 1 − e^{−jΩ} + g e^{−j(d+1)Ω}
  const ar = 1 - Math.cos(omega) + g * Math.cos((d + 1) * omega)
  const ai = Math.sin(omega) - g * Math.sin((d + 1) * omega)
  return (mu * mu * sEta) / (ar * ar + ai * ai)
}

/** ZOH 到 sample rate 後的 one-sided per-Hz PSD [fs²/Hz]（E09 / E29） */
function swZohOneSidedDelay(f: number, fs: number, N: number, mu: number, g: number, d: number, sEta: number): number {
  const theta = (2 * Math.PI * Math.abs(f)) / fs
  const s = Math.sin(theta / 2)
  const dir2 = Math.abs(s) < 1e-300 ? N * N : (Math.sin((N * theta) / 2) / s) ** 2
  return (2 / fs) * (dir2 / N) * swBlockDtft(N * theta, mu, g, d, sEta)
}

/** 由 replay 視窗計算輸出端指標（純函式；測試直接呼叫）。 */
export function analyzeOutput(p: {
  win: ReplayWindow
  fs: number
  fOut: number
  N: number
  T: DtTransfer
  H: DtTransfer
  mu: number
  g: number
  d: number
  sigmaEta2: number
  sigmaWPred: number
  fL: number
  fH: number
  /** 真實 gain a [fs per unit code] */
  aFs: number
  /** 一階 DSM 封閉式（非 null 時計算 closed-form spur） */
  firstOrder: { P: number; line1: number; fracEff: number } | null
  /** 正規化 scale s（x = (r − o)·s） */
  normScale: number
  /** 靜態部分是否只有線性項（c₂ = c₃ = 0 且無量化），否則 closed-form 只作參考 */
  staticLinearOnly: boolean
}): OutputAnalysis {
  const { win, fs, fOut, N, T } = p
  const notes: string[] = []
  const L = win.x.length
  const xMean = meanOf(win.x)
  const xVar = varOf(win.x, xMean)
  const txMean = meanOf(win.tx)
  const txVar = varOf(win.tx, txMean)
  const wBar = win.wBar
  const sigmaWWindow = win.wApp.length > 1 ? Math.sqrt(varOf(win.wApp) * (win.wApp.length / (win.wApp.length - 1))) : NaN
  const essW = win.wApp.length >= 4 ? effectiveSampleSize(win.wApp) : win.wApp.length
  const tNoise = new Float64Array(L)
  for (let i = 0; i < L; i++) tNoise[i] = win.tOut[i] - win.tStatic[i]
  const rmsOut = Math.sqrt(varOf(win.tOut))
  const rmsStatic = Math.sqrt(varOf(win.tStatic))
  const rmsNoise = Math.sqrt(varOf(tNoise))
  const rmsPd = Math.sqrt(varOf(win.uPd))
  const rmsEDtc = Math.sqrt(varOf(win.eDtc))

  // #region core:outputDecomposition
  // e_DTC = (a − w̄)x + d(x)  −  (w_app − w̄)·x  ⇒  t_out = T{靜態} + T{gain noise}（線性 ⇒ 兩部分可分開算）
  // gain noise：δw 很慢（cal 頻寬 ≪ PLL 頻寬）⇒ T{δw·x} ≈ x̄·δw + δw·T{x̃}，兩項不相關（T{x̃} 零均值）
  const noiseVarPred = (s2: number) => s2 * (xMean * xMean + txVar) // ← 差異：x̄²σ_w² 直接進到輸出（|T(0)| = 1）
  // #endregion
  const rmsNoisePred = Math.sqrt(noiseVarPred(sigmaWWindow * sigmaWWindow))
  const rmsNoisePredAnalytic = Number.isFinite(p.sigmaWPred) ? Math.sqrt(noiseVarPred(p.sigmaWPred * p.sigmaWPred)) : NaN

  // ── 模擬 PSD：Welch（Hann）──
  const nperseg = Math.min(L, 1 << 16)
  const ws = welch(win.tOut, fs, { window: 'hann', nperseg })
  const fLo = Math.max(p.fL, 2 * ws.df)
  const fHi = Math.min(p.fH, fs / 2)
  const jitterBandSim = fHi > fLo ? Math.sqrt(integratePsd(ws.f, ws.psd, fLo, fHi)) : 0
  if (p.fL < 2 * ws.df) {
    notes.push(
      `模擬 Welch 的解析度 $\\Delta f=${(ws.df / 1e3).toPrecision(4)}\\,\\mathrm{kHz}$（視窗 ${L} samples）：低於 $2\\Delta f$ 的成分（含 $\\bar x\\,\\delta w$ 的低頻 wander）不在模擬 PSD 的積分內，積分下限改為 $${(fLo / 1e3).toPrecision(4)}\\,\\mathrm{kHz}$；全頻段請看時域 RMS。`,
    )
  }
  const sim = logDecimateMax(ws.f, ws.psd, 1200)
  // 靜態部分 [f_L, f_H]（Welch 積分；同樣受解析度限制）
  const wst = welch(win.tStatic, fs, { window: 'hann', nperseg })
  const jitterBandStatic = fHi > fLo ? Math.sqrt(integratePsd(wst.f, wst.psd, fLo, fHi)) : 0

  // ── 解析 gain-noise PSD：|T|²·[x̄²·S_w^{ZOH}(f) + σ_w²·S_x̃(f)] ──
  const wx = welch(win.x, fs, { window: 'hann', nperseg })
  const sw2 = Number.isFinite(p.sigmaWPred) ? p.sigmaWPred * p.sigmaWPred : NaN
  const stable = Number.isFinite(sw2)
  const nA = 400
  const fA = new Float64Array(nA)
  const noiseA = new Float64Array(nA)
  const t2A = new Float64Array(nA)
  const h2A = new Float64Array(nA)
  const fMinA = Math.max(1, Math.min(p.fL, fs / N / 100))
  for (let i = 0; i < nA; i++) {
    const f = fMinA * Math.pow(fs / 2 / fMinA, i / (nA - 1))
    fA[i] = f
    const om = (2 * Math.PI * f) / fs
    const t2 = dtMag2(T, om)
    t2A[i] = t2
    h2A[i] = dtMag2(p.H, om)
    const sx = interpPsd(wx.f, wx.psd, f)
    noiseA[i] = stable ? t2 * (xMean * xMean * swZohOneSidedDelay(f, fs, N, p.mu, p.g, p.d, p.sigmaEta2) + sw2 * sx) : NaN
  }
  let jitterBandNoise = NaN
  if (stable) {
    // x̄²·∫|T|²S_w^{ZOH}：對數格點 trapezoid（cal 頻寬 ≪ f_u 時 k·f_u 附近的 ZOH image 只佔 O((f_3dB/f_u)²)，格點可能略過 → [近似]）
    const lowPart = xMean * xMean * logTrapz((f) => dtMag2(T, (2 * Math.PI * f) / fs) * swZohOneSidedDelay(f, fs, N, p.mu, p.g, p.d, p.sigmaEta2), Math.max(p.fL, 1e-3), Math.min(p.fH, fs / 2), 3000)
    // σ_w²·∫|T|²S_x̃：在 Welch 格點上做 trapezoid（S_x̃ 的線譜由 Welch 主瓣承載）
    const g2 = new Float64Array(wx.f.length)
    for (let i = 0; i < wx.f.length; i++) g2[i] = dtMag2(T, (2 * Math.PI * wx.f[i]) / fs) * wx.psd[i]
    const acPart = sw2 * integratePsd(wx.f, g2, Math.max(p.fL, wx.df), Math.min(p.fH, fs / 2))
    jitterBandNoise = Math.sqrt(lowPart + acPart)
  } else {
    notes.push('cal 迴路不穩定或 $\\sigma_v=0$：$\\sigma_w$ 的線性預測不存在，解析 gain-noise PSD 不畫。')
  }

  // ── spur ──
  const fracToneHz = p.firstOrder ? foldFrequency(p.firstOrder.fracEff * fs, fs) : NaN
  const mkTone = (fHz: number, amp: number, source: ToneReport['source']): ToneReport => makeTone(fHz, amp, fOut, source)
  let toneClosedForm: ToneReport | null = null
  let toneFitSim: ToneReport | null = null
  if (p.firstOrder && p.firstOrder.P >= 2 && fracToneHz > 0) {
    // #region core:fracSpurClosedForm
    // 一階 DSM：x 的基頻 peak = s·A₁（A₁ = 1/(P·sin(π/P))）；靜態 gain 誤差 (a − w̄) 把它變成 DTC timing tone，再乘 |T(f₁)|
    const tMag = Math.sqrt(dtMag2(T, (2 * Math.PI * fracToneHz) / fs)) // |T(e^{jΩ₁})|
    const ampCf = Math.abs(p.aFs - win.wBar) * p.normScale * p.firstOrder.line1 * tMag // peak [fs]
    // #endregion
    toneClosedForm = mkTone(fracToneHz, ampCf, 'closed-form')
    const tf = toneFit(win.tOut, fs, fracToneHz)
    toneFitSim = mkTone(fracToneHz, tf.amplitudePeak, 'toneFit')
    if (!p.staticLinearOnly) notes.push('靜態殘差含 $c_2$ / $c_3$ 或實體量化：基頻的 closed form 只含線性項，僅供參考。')
  }
  // findTones on Blackman–Harris Welch（較好的 sidelobe）
  const npTone = Math.min(L, 1 << 15)
  const wbh = welch(win.tOut, fs, { window: 'blackmanHarris', nperseg: npTone })
  const det = significantTones(wbh.psd, findTones(wbh.f, wbh.psd, { minProminenceDb: 15, maxTones: 24, lobeHalfWidthBins: 4, fMin: 2 * wbh.df }), wbh.nSegments).slice(0, 6)
  const tones = det.map((t) => mkTone(t.fCentroid, Math.sqrt(2 * t.power), 'findTones'))
  return {
    wBar,
    sigmaWWindow,
    essW,
    xMean,
    xVar,
    txVar,
    rmsOut,
    rmsStatic,
    rmsNoise,
    rmsPd,
    rmsEDtc,
    rmsNoisePred,
    rmsNoisePredAnalytic,
    jitterBandNoise,
    jitterBandStatic,
    welchDf: ws.df,
    jitterBandSim,
    bandUsed: [fLo, fHi],
    psdSim: { f: sim.f, psd: sim.psd, window: 'hann', nperseg, enbwHz: ws.enbwHz, nSegments: ws.nSegments },
    psdAnalytic: { f: fA, noise: noiseA, t2: t2A, hpd2: h2A },
    fracToneHz,
    toneClosedForm,
    toneFitSim,
    tones,
    toneDetect: { nperseg: npTone, nSegments: wbh.nSegments, significanceDb: toneSignificanceDb(wbh.nSegments) },
    notes,
  }
}

/** findTones 之後的顯著性門檻 [dB]：峰值要比「鄰近 bin 的中位數」高這麼多才算譜線（依 Welch 的平均段數）。 */
export function toneSignificanceDb(nSegments: number): number {
  return nSegments >= 8 ? 8 : nSegments >= 4 ? 10 : 14
}

/**
 * 把 findTones 的候選過濾成「真的高於雜訊底」的譜線。
 * 為什麼需要：findTones 的 prominence 是地形學定義（峰值 − 兩側谷底較高者）。純雜訊的 PSD 估計，各 bin 是 χ² 分布，
 * 谷底可以很深，所以「整條曲線的最高點」幾乎一定有 15 dB 以上的 prominence——白雜訊也會被報成一根 tone。
 * 這裡加一道檢查：峰值 PSD ≥ 門檻 ×（峰值兩側各 64 個 bin、扣掉主瓣後的中位數）。
 * Welch 平均 n 段時每個 bin 近似 Γ(k ≈ 0.55n) 分布；n ≥ 8 取 8 dB（6.3 倍）時，2¹⁴ 個 bin 內的誤報率遠小於 10⁻⁶。
 */
export function significantTones<T extends { index: number; peakPsd: number; lobe: [number, number] }>(psd: ArrayLike<number>, tones: T[], nSegments: number, halfSpan = 64): T[] {
  const thr = Math.pow(10, toneSignificanceDb(nSegments) / 10)
  return tones.filter((t) => {
    const ref: number[] = []
    for (let i = Math.max(0, t.lobe[0] - halfSpan); i < t.lobe[0]; i++) ref.push(psd[i])
    for (let i = t.lobe[1] + 1; i <= Math.min(psd.length - 1, t.lobe[1] + halfSpan); i++) ref.push(psd[i])
    if (ref.length < 8) return true // 鄰近 bin 太少，無法估雜訊底：照 findTones 的結果
    ref.sort((x, y) => x - y)
    const med = ref[ref.length >> 1]
    return t.peakPsd >= thr * med
  })
}

/** output timing tone（peak 振幅 A fs）→ 單邊 spur dBc（小角與 Bessel 精確兩種；T15）。 */
export function makeTone(fHz: number, ampFs: number, fOutHz: number, source: ToneReport['source']): ToneReport {
  const beta = spurBeta(fOutHz, ampFs)
  return {
    fHz,
    ampFs,
    dbc: ampFs > 0 ? spurDbcSmallAngle(beta) : -Infinity,
    dbcBessel: ampFs > 0 ? spurDbcBessel(beta) : -Infinity,
    source,
  }
}

/** ∫_a^b fn(f) df：對數等距格點上的 trapezoid（被積函數在對數頻率上平滑時夠用）。 */
export function logTrapz(fn: (f: number) => number, a: number, b: number, n: number): number {
  if (!(b > a) || !(a > 0)) return 0
  let acc = 0
  let fPrev = a
  let yPrev = fn(a)
  for (let i = 1; i <= n; i++) {
    const f = a * Math.pow(b / a, i / n)
    const y = fn(f)
    acc += 0.5 * (y + yPrev) * (f - fPrev)
    fPrev = f
    yPrev = y
  }
  return acc
}

function interpPsd(f: ArrayLike<number>, psd: ArrayLike<number>, x: number): number {
  const n = f.length
  if (n === 0) return 0
  if (x <= f[0]) return psd[0]
  if (x >= f[n - 1]) return psd[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (f[m] <= x) lo = m
    else hi = m
  }
  const t = (x - f[lo]) / (f[hi] - f[lo])
  return psd[lo] + t * (psd[hi] - psd[lo])
}

// ───────────────────────────────────────────────────────────────────────────
// Code 級（FCW → DSM → 正規化）的封閉式與摘要
// ───────────────────────────────────────────────────────────────────────────

export interface CodeStage {
  source: CodeSourceKind
  K: number
  M: number
  fracEff: number
  /** 週期 P（一階、無 dither：M/gcd(K, M)；MASH：在 2^17 個樣本內偵測；找不到為 0） */
  period: number
  periodSource: 'closed-form' | 'detected' | 'none'
  /** 基頻 fractional tone 折回後的頻率 [Hz]（iid 時 NaN；pmux8 時是 frac(8α) 鋸齒的基頻） */
  fracToneHz: number
  /** 8 相 PMUX 的旋轉頻率 α f_ref 折回 [0, f_s/2]（mode-1 regressor 的基頻；gos_only 時 NaN）[Hz] */
  pmuxRotHz: number
  /** DSM 實際跑的小數部分（pmux8 時是 frac(8α)） */
  dsmFrac: number
  /** 原始 residue 的封閉式（一階）：E[r]、E[r²]、Var(r) [T_vco^k]；其他 NaN */
  rawMean: number
  rawMeanSquare: number
  rawVar: number
  /** 一階基頻 peak A₁ = 1/(P sin(π/P)) [T_vco] */
  line1Raw: number
  /** 正規化 x = (r − o)·s */
  normOffset: number
  normScale: number
  /** 正規化後 code 的 E[x]、E[x²]：blockLms 的估計（前 2^17 個樣本）與封閉式（一階） */
  xMean: number
  xMeanSquare: number
  xMeanClosed: number
  xMeanSquareClosed: number
  /** residue 範圍 [T_vco]（DTC 需要涵蓋的範圍） */
  rawRange: [number, number]
  notes: string[]
}

function codeStage(p: LabParams, an: BlockLmsAnalytic): CodeStage {
  const notes: string[] = []
  const norm = an.normalization
  const pmux = p.architecture === 'pmux8_gos'
  const frac = codeFrac(p)
  const pmuxRotHz = pmux ? foldFrequency(p.frac * p.fRefHz, p.fRefHz) : NaN
  if (pmux) notes.push(`8 相 PMUX：DSM 跑在 $(8\\alpha\\bmod 1)=${fmtN(frac, 6)}$（單位 $\\Delta=T_{\\mathrm{vco}}/8$），PMUX 每個週期固定前進 $\\lfloor8\\alpha\\rfloor=${pmuxFrac(p.frac).int}$ 相；PMUX 的旋轉頻率 $\\alpha f_{\\mathrm{ref}}$ 折回後是 $${fmtN(pmuxRotHz / 1e6, 5)}\\,\\mathrm{MHz}$（PHOS mode-1 的基頻）`)
  if (p.regressorSign === 'spec') notes.push('regressor 正負號照 §2a：$x=s/M\\ge0$（一階 DSM 時 $x\\in[0,1)$ 的鋸齒），和既有 preset 的 $r\\le0$ 差一個負號')
  if (p.codeSource === 'iid_pm_one') {
    return {
      source: p.codeSource,
      K: NaN,
      M: NaN,
      fracEff: p.frac,
      period: 0,
      periodSource: 'none',
      fracToneHz: NaN,
      pmuxRotHz,
      dsmFrac: frac,
      rawMean: 0,
      rawMeanSquare: 1,
      rawVar: 1,
      line1Raw: NaN,
      normOffset: norm.offset,
      normScale: norm.scale,
      xMean: an.Ex,
      xMeanSquare: an.Ex2,
      xMeanClosed: 0,
      xMeanSquareClosed: 1, // ±1：四種正規化下 E[x²] 都是 1（平均為 0、RMS 為 1）
      rawRange: [-1, 1],
      notes: ['參考 code：iid $\\pm1$（不是 DSM residue；用來重現 T13 的 $\\sigma_w\\approx0.399\\,\\mathrm{fs}$ 錨點）'],
    }
  }
  const q = quantizeFcw(frac, p.dsmBits, p.dither)
  const fracToneHz = foldFrequency(q.fracEff * p.fRefHz, p.fRefHz)
  const sgn = p.regressorSign === 'spec' ? -1 : 1
  if (p.codeSource === 'dsm_first_order' && !p.dither) {
    const st = firstOrderResidueStats(frac, p.dsmBits)
    let xm: number
    let xm2: number
    switch (p.normalization) {
      case 'none':
        xm = sgn * st.mean // ← 'spec' 正負號：x = −r
        xm2 = st.meanSquare
        break
      case 'zero_mean':
        xm = 0
        xm2 = st.variance
        break
      case 'unit_rms':
        xm = (sgn * st.mean) / Math.sqrt(st.meanSquare)
        xm2 = 1
        break
      default:
        xm = 0
        xm2 = 1
    }
    if (st.P > 1 << 17) notes.push(`週期 $P=${st.P}$ 比解析估計用的 $2^{17}$ 個樣本還長：blockLms 的 $C$、$E[x]$ 估計只涵蓋部分週期（下表的封閉式不受影響）。`)
    if (st.P === 1) notes.push('frac 量化後為 0（整數 FCW）：residue $r\\equiv0$，沒有任何激勵（$\\lambda_{\\min}=0$），gain 不可辨識——不是樣本不夠，是 code 根本不動。')
    return {
      source: p.codeSource,
      K: st.K,
      M: st.M,
      fracEff: st.fracEff,
      period: st.P,
      periodSource: 'closed-form',
      fracToneHz,
      pmuxRotHz,
      dsmFrac: frac,
      rawMean: sgn * st.mean,
      rawMeanSquare: st.meanSquare,
      rawVar: st.variance,
      line1Raw: st.line1,
      normOffset: norm.offset,
      normScale: norm.scale,
      xMean: an.Ex,
      xMeanSquare: an.Ex2,
      xMeanClosed: xm,
      xMeanSquareClosed: xm2,
      rawRange: sgn < 0 ? [0, 1 - 1 / st.P] : [-1 + 1 / st.P, 0],
      notes,
    }
  }
  // MASH 或有 dither：週期以 detectPeriod 偵測（2^17 個樣本）
  const s = new DsmStream({ kind: p.codeSource === 'mash111' ? 'mash111' : 'first_order', frac, bits: p.dsmBits, dither: p.dither }, createRng(p.seed).fork('code-pattern').fork('dsm-dither'))
  const L = 1 << 17
  const r = new Float64Array(L)
  for (let i = 0; i < L; i++) {
    s.step()
    r[i] = sgn * s.residue
  }
  const P = p.dither ? 0 : detectPeriod(r, { start: L >> 2 })
  if (p.dither)
    notes.push(
      p.codeSource === 'mash111'
        ? 'DSM 開 LSB dither：序列不再週期，MASH 的 idle tone 被打散（代價：平均頻率 $+\\tfrac12$ LSB、額外的 dither 雜訊）。'
        : 'DSM 開 LSB dither：序列不再週期，但一階 DSM 的 residue 仍然是鋸齒——LSB 大小的 dither 只讓它的相位緩慢隨機漂移，fractional 譜線的振幅幾乎不變（要打散它得換成 MASH，或疊上振幅夠大的已知隨機化）。代價：平均頻率 $+\\tfrac12$ LSB。',
    )
  if (!p.dither && P === 0) notes.push('在 $2^{17}$ 個樣本內沒有偵測到週期（MASH 1-1-1 的週期通常極長）：視為 noise-like。')
  let rmin = Infinity
  let rmax = -Infinity
  for (let i = 0; i < L; i++) {
    if (r[i] < rmin) rmin = r[i]
    if (r[i] > rmax) rmax = r[i]
  }
  return {
    source: p.codeSource,
    K: q.K,
    M: q.M,
    fracEff: q.fracEff,
    period: P,
    periodSource: P > 0 ? 'detected' : 'none',
    fracToneHz,
    pmuxRotHz,
    dsmFrac: frac,
    rawMean: NaN,
    rawMeanSquare: NaN,
    rawVar: NaN,
    line1Raw: NaN,
    normOffset: norm.offset,
    normScale: norm.scale,
    xMean: an.Ex,
    xMeanSquare: an.Ex2,
    xMeanClosed: NaN,
    xMeanSquareClosed: NaN,
    rawRange: [rmin, rmax],
    notes,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Stage 報告（每一級：模型層級、假設、指標、警告）
// ───────────────────────────────────────────────────────────────────────────

export type StageId = 'dsm' | 'code' | 'dtc' | 'pll' | 'comparator' | 'gmac' | 'register' | 'update' | 'output'
export type LevelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'

export interface StageMetric {
  name: string
  value: number | string | null
  unit?: string
  note?: string
  claim?: 'exact' | 'approx' | 'research'
}

export interface StageReport {
  id: StageId
  title: string
  level: LevelId
  assumptions: string[]
  metrics: StageMetric[]
  warnings: string[]
}

export const STAGE_TITLES: Record<StageId, string> = {
  dsm: '① FCW → DSM',
  code: '② residue → code（正規化）',
  dtc: '③ DTC（gain / offset / INL）',
  pll: '④ PLL error path（$H_{\\mathrm{PD}}$、$T$）',
  comparator: '⑤ Comparator（1-bit）',
  gmac: '⑥ GMAC（相關器）',
  register: '⑦ Gain register（定點）',
  update: '⑧ 更新迴路（$\\mu$、延遲）',
  output: '⑨ 輸出端（jitter / spur）',
}

/** 依關鍵字把 blockLms 的警告分配到對應的級（未分類的放在 update）。 */
export function routeWarning(w: string): StageId {
  if (/正規化|RMS（或標準差）|缺乏激勵（Persistent/.test(w)) return 'code'
  if (/pll_error_path|H_PD\(z=1\)|主 PLL|E44|loop latency/.test(w)) return 'pll'
  if (/σ_v = 0|unipolar|comparator_encoding|0\/1/.test(w)) return 'comparator'
  if (/C ≤ 0|C ≈ 0|gm_mode=sum|filtered-x|regressor_mode|gm_code_delay/.test(w)) return 'gmac'
  if (/gain register|LSB|wrap|飽和|量化誤差主導/.test(w)) return 'register'
  return 'update'
}

/**
 * 後半段每個 block 的準靜態（線性化）固定點 w*_k = a + B_k/C_k：把該 block 自己的 C_k、B_k 當成常數時 E[G] = 0 的位置。
 * code 的區塊統計是平穩的時候它幾乎不動；長週期的一階 DSM 加上 offset / INL 時，它會隨 block 週期性擺動（迴路跟著它跑）。
 * 只對 ±1 編碼有意義（0/1 未映射時多一個 E[x_ref]/2 的項）；C_k ≤ 0 或幾乎為 0 的 block 不計。
 */
export function quasiStaticFixedPoint(mf: Pick<MeanFieldTwin, 'C' | 'B'>, p: Pick<LabParams, 'aFs' | 'encoding'>, ex2: number): { min: number; max: number; mean: number } | null {
  if (p.encoding === 'unipolar_unmapped_bug') return null
  const K = mf.C.length
  const floor = 1e-6 * Math.max(ex2, 1e-300)
  let lo = Infinity
  let hi = -Infinity
  let sum = 0
  let n = 0
  for (let k = Math.floor(K / 2); k < K; k++) {
    if (!(mf.C[k] > floor)) continue
    const w = p.aFs + mf.B[k] / mf.C[k]
    if (!Number.isFinite(w)) continue
    if (w < lo) lo = w
    if (w > hi) hi = w
    sum += w
    n++
  }
  return n > 0 ? { min: lo, max: hi, mean: sum / n } : null
}

function buildStages(x: {
  p: LabParams
  cfg?: BlockLmsConfig
  design: PllDesign
  code: CodeStage
  an: BlockLmsAnalytic
  metrics: BlockLmsMetrics | null
  warnings: string[]
  win: ReplayWindow | null
  out: OutputAnalysis | null
  replay: { maxAbsDiffG: number } | null
  fOutHz: number
  loopLevel: 'L1' | 'L2' | 'L5'
  swing: { min: number; max: number; mean: number } | null
  lin: LinearPrediction
  /** pmux8_gos：9 個權重的分析與 PHOS 殘差 */
  mimo?: { analysis: MimoAnalysis; phosRmsFs: number; phosCommonFs: number } | null
}): StageReport[] {
  const { p, design, code, an, metrics, win, out, swing, lin } = x
  const mimo = x.mimo ?? null
  const W: Record<StageId, string[]> = { dsm: [], code: [], dtc: [], pll: [], comparator: [], gmac: [], register: [], update: [], output: [] }
  for (const w of x.warnings) W[routeWarning(w)].push(w)
  for (const w of design.warnings) if (!W.pll.includes(w)) W.pll.push(w)

  // 視窗統計
  let blockGainMin = NaN
  let blockGainMax = NaN
  let blockEnergyMin = NaN
  let fracNeg = NaN
  let linRatio = NaN
  let pPlus = NaN
  if (win) {
    const N = p.N
    const nb = win.blocks
    blockGainMin = Infinity
    blockGainMax = -Infinity
    blockEnergyMin = Infinity
    let neg = 0
    for (let j = 0; j < nb; j++) {
      let c = 0
      let en = 0
      for (let n = 0; n < N; n++) {
        const i = j * N + n
        c += win.xRef[i] * win.ux[i]
        en += win.ux[i] * win.ux[i]
      }
      c /= N
      en /= N
      if (c < blockGainMin) blockGainMin = c
      if (c > blockGainMax) blockGainMax = c
      if (en < blockEnergyMin) blockEnergyMin = en
      if (c <= 0) neg++
    }
    fracNeg = neg / nb
    let maxDet = 0
    let plus = 0
    for (let i = 0; i < win.uPd.length; i++) {
      const det = Math.abs(win.uPd[i] + p.compOffsetFs)
      if (det > maxDet) maxDet = det
      if (win.q[i] > 0) plus++
    }
    linRatio = p.sigmaV > 0 ? maxDet / p.sigmaV : Infinity
    pPlus = plus / win.q.length
  }
  if (Number.isFinite(linRatio) && linRatio > 0.5) {
    W.comparator.push(
      `穩態視窗內 $\\max|e_{\\mathrm{det}}|/\\sigma_v=${texNum(linRatio, 3)}>0.5$：comparator 的小訊號線性化 $E[q]\\approx K_q e_{\\mathrm{det}}$ 不再準確（E01：「小誤差」指整個 deterministic residual 要遠小於 $\\sigma_v$，不只是 $|a-w|$ 小）。`,
    )
  }
  if (Number.isFinite(fracNeg) && fracNeg > 0) {
    W.gmac.push(
      `視窗內有 $${texNum(100 * fracNeg, 3)}\\%$ 的 block 其區塊相關 $C_k=\\tfrac1N\\sum x_{\\mathrm{ref}}u_x\\le 0$：單一 block 的更新方向可能反向（code 週期比 $N$ 長，或近整數 FCW），平均方向仍由整體 $C$ 決定。`,
    )
  }
  if (Number.isFinite(blockEnergyMin) && blockEnergyMin < 1e-6 * Math.max(an.Ex2, 1e-300)) {
    W.gmac.push(
      `$\\lambda_{\\min}=\\min_k\\tfrac1N\\sum u_x^2=${texNum(blockEnergyMin, 3)}\\approx 0$：至少有一個 GMAC block 幾乎沒有激勵（Persistent Excitation 不成立），該 block 的 $G_k$ 只有雜訊，gain 在那段時間不可辨識。`,
    )
  }
  const swingPp = swing ? swing.max - swing.min : NaN
  if (lin.valid && Number.isFinite(swingPp) && Number.isFinite(an.sigmaWPred) && swingPp > Math.max(an.sigmaWPred, 1e-9)) {
    W.update.push(
      `固定點不是常數：後半段每個 block 的準靜態固定點 $w^*_k=a+B_k/C_k$ 在 $[${texNum(swing!.min, 5)},\\,${texNum(swing!.max, 5)}]\\,\\mathrm{fs}$ 之間擺動（幅度 $${texNum(swingPp, 3)}\\,\\mathrm{fs}>\\sigma_{w,\\mathrm{pred}}=${texNum(an.sigmaWPred, 3)}\\,\\mathrm{fs}$）。原因：code 的區塊統計（$E_k[x_{\\mathrm{ref}}]$、$C_k$）隨時間緩慢變化——典型是週期遠長於 $N$ 的一階 DSM，加上 comparator offset 或 INL。迴路會跟著 $w^*_k$ 跑，所以 $w$ 的起伏不全是雜訊；單一個 $w^*$ 與 $\\sigma_w$ 的線性時不變預測不適用，交叉比對改用 mean-field 平均軌跡（F-LAB.18）。`,
    )
  }
  const sumMode = p.gmMode === 'sum'
  const bug = p.encoding === 'unipolar_unmapped_bug'
  const srcName = p.codeSource === 'mash111' ? 'MASH 1-1-1' : '一階'
  const stages: StageReport[] = [
    {
      id: 'dsm',
      title: STAGE_TITLES.dsm,
      level: 'L2',
      assumptions: [
        p.codeSource === 'iid_pm_one'
          ? '參考 code（iid $\\pm1$），不經 DSM'
          : `${srcName} 理想數位 DSM，$B=${p.dsmBits}$ bit，${p.dither ? '含' : '無'} LSB dither，零初值`,
        '$f_s=f_{\\mathrm{ref}}$：一個 DSM sample 對應一個 comparator sample（多速率未建模）',
        'residue $r[n]=\\sum_{m\\le n}(y[m]-K/M)$，單位 $T_{\\mathrm{vco}}$，以整數精確累加',
      ],
      metrics: [
        { name: 'FCW $=N_{\\mathrm{int}}+\\alpha_{\\mathrm{eff}}$', value: `${p.nInt} + ${fmtN(code.fracEff, 8)}`, note: '$\\alpha_{\\mathrm{eff}}=K/M$（量化到 $B$ bit）', claim: 'exact' },
        { name: '$K/M$', value: Number.isFinite(code.K) ? `${code.K} / ${code.M}` : '—', claim: 'exact' },
        { name: '$f_{\\mathrm{out}}$', value: x.fOutHz, unit: 'Hz', note: '$(N_{\\mathrm{int}}+\\alpha_{\\mathrm{eff}})f_{\\mathrm{ref}}$', claim: 'exact' },
        {
          name: '週期 $P$',
          value: code.period > 0 ? code.period : '未偵測到（noise-like）',
          unit: 'sample',
          note: code.periodSource === 'closed-form' ? '$M/\\gcd(K,M)$' : '偵測（$2^{17}$ 個樣本內）',
          claim: code.periodSource === 'closed-form' ? 'exact' : 'approx',
        },
        { name: 'fractional tone $f_1$', value: code.fracToneHz, unit: 'Hz', note: p.architecture === 'pmux8_gos' ? '$(8\\alpha\\bmod 1)_{\\mathrm{eff}}f_{\\mathrm{ref}}$ 折回 $[0,f_s/2]$（GOS 鋸齒的基頻）' : '$\\alpha_{\\mathrm{eff}}f_{\\mathrm{ref}}$ 折回 $[0,f_s/2]$', claim: 'exact' },
        ...(p.architecture === 'pmux8_gos'
          ? [
              { name: 'PMUX 旋轉頻率 $\\alpha f_{\\mathrm{ref}}$（折回）', value: code.pmuxRotHz, unit: 'Hz', note: 'PHOS mode-1 regressor 的基頻；落在反號帶就反號', claim: 'exact' as const },
              { name: '相位走訪比例 $P(p=j)$', value: mimo ? mimo.analysis.occupancy.map((v) => fmtN(v, 3)).join(', ') : '—', note: '8 相各自被選到的比例（解析樣本）', claim: 'exact' as const },
            ]
          : []),
        { name: 'residue 範圍', value: `[${fmtN(code.rawRange[0], 4)}, ${fmtN(code.rawRange[1], 4)}]`, unit: p.architecture === 'pmux8_gos' ? '$\\Delta=T_{\\mathrm{vco}}/8$' : '$T_{\\mathrm{vco}}$', note: 'DTC 必須涵蓋的範圍' },
      ],
      warnings: W.dsm,
    },
    {
      id: 'code',
      title: STAGE_TITLES.code,
      level: 'L2',
      assumptions: [
        `正規化 ${p.normalization}：$x=(r-o)\\,s$，$o$、$s$ 取自整段 record（$${p.N}\\times${p.blocks}$ 個樣本）`,
        'unit_rms 不減平均：保留 $E[x]\\ne 0$ 的效應（offset 假 gain bias、$\\bar x\\,\\delta w$ 低頻項）',
      ],
      metrics: [
        { name: '$o$（offset）', value: code.normOffset, unit: '$T_{\\mathrm{vco}}$', claim: 'exact' },
        { name: '$s$（scale）', value: code.normScale, unit: '$T_{\\mathrm{vco}}^{-1}$', claim: 'exact' },
        { name: '$E[x]$（估計）', value: code.xMean, note: 'blockLms 前 $2^{17}$ 個樣本', claim: 'approx' },
        { name: '$E[x]$（封閉式）', value: Number.isFinite(code.xMeanClosed) ? code.xMeanClosed : '—', note: '一階、unit_rms：$E[r]/\\sqrt{E[r^2]}$', claim: 'exact' },
        { name: '$E[x^2]$（估計）', value: code.xMeanSquare, claim: 'approx' },
        { name: '$E[x^2]$（封閉式）', value: Number.isFinite(code.xMeanSquareClosed) ? code.xMeanSquareClosed : '—', claim: 'exact' },
      ],
      warnings: [...W.code, ...code.notes],
    },
    {
      id: 'dtc',
      title: STAGE_TITLES.dtc,
      level: 'L2',
      assumptions: [
        'DTC 在 reference 輸入端：需要補的量是 $a\\,x$，DTC 實際的補償量是 $w_{\\mathrm{app}}\\,x$（從固定的基準延遲 $T_0$ 往回扣），PD 只看到兩者之差 $(a-w_{\\mathrm{app}})\\,x$',
        '$e_{\\mathrm{DTC}}=(a-w_{\\mathrm{app}})\\,x+o_{\\mathrm{DTC}}+c_2x^2+c_3x^3$（靜態非線性；沒有 code-dependent settling / glitch）',
        '$a$、$w$ 的單位為 fs per unit code；極性 $\\delta=a-w$（E13、E32）',
      ],
      metrics: [
        { name: '$a$（真實 gain 誤差）', value: p.aFs, unit: 'fs', claim: 'exact' },
        { name: '$w_0$', value: p.w0Fs, unit: 'fs' },
        { name: '$o_{\\mathrm{DTC}}$', value: p.dtcOffsetFs, unit: 'fs' },
        { name: '$c_2\\,/\\,c_3$', value: `${p.c2} / ${p.c3}`, unit: 'fs' },
        { name: '線性化固定點 $w^*_{\\mathrm{lin}}$', value: an.wStarLinear, unit: 'fs', note: '$a+(E[x_{\\mathrm{ref}}H\\{d\\}]+b\\,E[x_{\\mathrm{ref}}])/C$', claim: 'approx' },
        ...(mimo
          ? [
              { name: 'PMUX offset $\\varepsilon_p$（去共模 RMS）', value: p.phosRmsFs, unit: 'fs', note: `圖樣 PHOS_PATTERN × RMS：$[${mimo.analysis.target.slice(0, PMUX_PHASES).map((v) => fmtN(v, 3)).join(',\\ ')}]$`, claim: 'exact' as const },
              { name: 'PHOS 殘差 RMS（去共模，後半段）', value: mimo.phosRmsFs, unit: 'fs', note: `共模 $${fmtN(mimo.phosCommonFs, 4)}\\,\\mathrm{fs}$（$H_{\\mathrm{PD}}(1)=0$ 時不可觀測，由初值決定）`, claim: 'exact' as const },
            ]
          : []),
        { name: '$\\mathrm{RMS}(e_{\\mathrm{DTC}})$（穩態視窗）', value: out ? out.rmsEDtc : null, unit: 'fs', claim: 'exact' },
      ],
      warnings: W.dtc,
    },
    {
      id: 'pll',
      title: STAGE_TITLES.pll,
      level: 'L2',
      assumptions: [
        design.kind === 'none'
          ? '$H_{\\mathrm{PD}}=1$、$T=1$（忽略主 PLL；教學基準）'
          : design.kind === 'type1'
            ? 'Type-I DPLL：$L(z)=k\\,z^{-(1+d_L)}/(1-z^{-1})$'
            : 'Type-II DPLL（E44 的直接差分方程）：$L(z)=\\bigl(K_p+\\tfrac{K_i}{1-z^{-1}}\\bigr)\\dfrac{z^{-(1+d_L)}}{1-z^{-1}}$',
        'PLL 與 comparator 同一取樣率；$H_{\\mathrm{PD}}$ 的狀態跨 block 持續（§15.2）',
        design.kind === 'none'
          ? 'DTC 在 reference 輸入端：$e_{\\mathrm{DTC}}$ 在 PD 的 reference 輸入注入；這個教學基準讓 PD 與輸出都直接看到它，$u_{\\mathrm{pd}}=+e_{\\mathrm{DTC}}$、$t_{\\mathrm{out}}=+e_{\\mathrm{DTC}}$（$\\delta w$ 的極性見 E33）'
          : 'DTC 在 reference 輸入端：$e_{\\mathrm{DTC}}$ 在 PD 的 reference 輸入注入，所以 $u_{\\mathrm{pd}}=+H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}$、$t_{\\mathrm{out}}=+T\\{e_{\\mathrm{DTC}}\\}$，$T=1-H_{\\mathrm{PD}}$（$\\delta w$ 的極性見 E33）',
      ],
      metrics: [
        { name: '設計', value: design.description },
        { name: '$T$ 的 $-3\\,\\mathrm{dB}$（實際 DT）', value: design.f3dbTHz, unit: 'Hz', claim: 'exact' },
        { name: '$|H_{\\mathrm{PD}}(1)|$', value: design.hpdDc, note: 'Type-I / II / CPPLL 為 0：DC 被主迴路抑制（E03）', claim: 'exact' },
        { name: 'closed-loop pole 半徑', value: design.spectralRadius, note: '$<1$ 才穩定', claim: 'exact' },
        { name: 'sampled-data crossover / PM', value: Number.isFinite(design.fcHz) ? `${fmtN(design.fcHz / 1e6, 5)} MHz / ${fmtN(design.pmDeg, 4)}°` : '—', note: 'loopMargins（案例頁的定義）', claim: 'exact' },
        {
          name: '反號帶 $\\mathrm{Re}\\,H_{\\mathrm{PD}}<0$',
          value: design.inversionBands.length > 0 ? design.inversionBands.map((b) => `[${fmtN(b.fLoHz / 1e6, 4)}, ${fmtN(b.fHiHz / 1e6, 4)}] MHz（最負 ${fmtN(b.minReH, 3)}）`).join('；') : '沒有',
          note: 'regressor 的功率落在這一帶時 $C$ 變負（案例頁 §6–§8）',
          claim: 'exact',
        },
        { name: '$\\mathrm{RMS}(u_{\\mathrm{pd}})/\\mathrm{RMS}(e_{\\mathrm{DTC}})$', value: out && out.rmsEDtc > 0 ? out.rmsPd / out.rmsEDtc : null, note: 'PD 看到的比例（high-pass）', claim: 'exact' },
      ],
      warnings: W.pll,
    },
    {
      id: 'comparator',
      title: STAGE_TITLES.comparator,
      level: 'L1',
      assumptions: [
        'comparator 取的是 PD 的輸出 $u_{\\mathrm{pd}}$，也就是送進 loop filter 的同一個訊號：$e[n]=u_{\\mathrm{pd}}[n]+b+v[n]$',
        `$v[n]$ 為 iid Gaussian，$\\sigma_v=${p.sigmaV}\\,\\mathrm{fs}$，與 code 獨立`,
        'tie 規則：$e\\ge 0\\Rightarrow q=+1$（E07）',
        `encoding = ${p.encoding}${bug ? '（反面測試：0/1 未映射成 $\\pm1$）' : ''}`,
        '獨立的觀測 comparator：offset $b$ 不會被主迴路吸收（E03 的情境 C；若 $q$ 就是主迴路的 BBPD，$b$ 會變成 static phase offset）',
      ],
      metrics: [
        { name: '$K_q=\\sqrt{2/\\pi}/\\sigma_v$', value: an.Kq, unit: '$\\mathrm{fs}^{-1}$', claim: 'approx' },
        { name: 'offset $b$', value: p.compOffsetFs, unit: 'fs' },
        { name: '$\\max|e_{\\mathrm{det}}|/\\sigma_v$（穩態）', value: linRatio, note: '$\\ll 1$ 時 $K_q$ 線性化成立', claim: 'exact' },
        { name: '$P(q=+1)$（穩態視窗）', value: pPlus, claim: 'exact' },
      ],
      warnings: W.comparator,
    },
    {
      id: 'gmac',
      title: STAGE_TITLES.gmac,
      level: p.regressor === 'raw' && p.pll === 'none' ? 'L1' : 'L2',
      assumptions: [
        `$G_k=${sumMode ? '' : '\\tfrac1N'}\\sum_{n\\in k}q[n]\\,x_{\\mathrm{ref}}[n]$，$N=${p.N}$（${sumMode ? 'sum' : 'average'} 模式）`,
        p.regressor === 'raw'
          ? '$x_{\\mathrm{ref}}=x$（raw）'
          : p.regressor === 'delayed'
            ? `$x_{\\mathrm{ref}}[n]=x[n-${p.codeDelay}]$（delayed）`
            : `$x_{\\mathrm{ref}}[n]=\\hat H\\{x\\}[n-${p.codeDelay}]$，$\\hat H=${p.fxGain}\\,H_{\\mathrm{PD}}\\,z^{-${p.fxExtraDelay}}$（filtered-x）`,
        '$C=E[x_{\\mathrm{ref}}\\,u_x]$，$u_x=H_{\\mathrm{PD}}\\{x\\}$；由 blockLms 以前 $2^{17}$ 個 code 樣本估計',
      ],
      metrics: [
        { name: '$C=E[x_{\\mathrm{ref}}u_x]$', value: an.Cest, claim: 'approx' },
        { name: bug ? '$K=\\tfrac12K_qC$' : '$K=K_qC$', value: an.K, unit: '$\\mathrm{fs}^{-1}$', claim: 'approx' },
        { name: 'block 相關 $C_k$ 範圍（視窗）', value: Number.isFinite(blockGainMin) ? `[${fmtN(blockGainMin)}, ${fmtN(blockGainMax)}]` : '—', claim: 'exact' },
        { name: 'PE：$\\lambda_{\\min}=\\min_k\\tfrac1N\\sum u_x^2$（視窗）', value: blockEnergyMin, note: '§9.1 的有限窗口定義（單參數）', claim: 'exact' },
        ...(mimo
          ? [
              { name: '可觀測子空間的條件數 $\\lambda_{\\max}/\\lambda_{\\min}$', value: mimo.analysis.obs.cond, note: `$R_u=E[\\phi_u\\phi_u^{\\mathsf T}]$ 去掉 ${mimo.analysis.obs.nullDim} 個不可觀測方向（共模）後`, claim: 'approx' as const },
              { name: '$\\min\\mathrm{Re}\\,\\lambda(J_{\\mathrm{obs}})$', value: mimo.analysis.minReEig, unit: '$\\mathrm{fs}^{-1}$', note: '$>0$ 才是所有模式都負回授', claim: 'approx' as const },
              { name: '共用步長的 $\\mu_{\\max}=\\min_i 2\\mathrm{Re}\\lambda_i/|\\lambda_i|^2$', value: mimo.analysis.muMaxUniform, unit: 'fs', claim: 'approx' as const },
            ]
          : []),
        { name: '重播 $G_k$ 最大差', value: x.replay ? x.replay.maxAbsDiffG : null, note: '跨級一致性（應為 0）', claim: 'exact' },
      ],
      warnings: W.gmac,
    },
    {
      id: 'register',
      title: STAGE_TITLES.register,
      level: p.quantize ? 'L5' : 'L1',
      assumptions: p.quantize
        ? [
            `內部 $${p.internalBits}$ bits（小數 $${p.internalBits - p.physicalBits}$ bits）、實體 $${p.physicalBits}$ bits、LSB $\\Delta=${p.lsbFs}\\,\\mathrm{fs}$、${p.signedReg ? 'signed' : 'unsigned'}`,
            `rounding = ${p.rounding}（增量與實體 code 同規則）、overflow = ${p.overflow}`,
            '閉迴路內的量化策略只有 blockLms 的 rounding；$\\Delta\\Sigma$ / toggle 等策略的開迴路比較見第 13 章',
          ]
        : ['quantize = false：$w$ 為理想浮點，internal / physical bits 不生效'],
      metrics: [
        { name: '飽和次數', value: metrics ? metrics.saturationCount : null },
        { name: 'wrap 次數', value: metrics ? metrics.wrapCount : null },
        { name: '實體 code toggle 次數（後半段）', value: metrics ? metrics.limitCycleCount : null },
        { name: 'limit cycle 週期', value: metrics && metrics.limitCyclePeriod > 0 ? metrics.limitCyclePeriod : '—', unit: 'block' },
        { name: '$\\Delta/\\sigma_{w,\\mathrm{pred}}$', value: p.quantize && an.sigmaWPred > 0 ? p.lsbFs / an.sigmaWPred : null, note: '$>2$ 時量化誤差主導' },
      ],
      warnings: W.register,
    },
    {
      id: 'update',
      title: STAGE_TITLES.update,
      level: x.loopLevel,
      assumptions: [
        `$w_{k+1}=w_k+\\mu G_k$，$\\mu=${p.muFs}\\,\\mathrm{fs}$，更新延遲 $d=${p.updateDelay}$ block`,
        `線性化平均模型 $\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}$，$g=\\mu K${sumMode ? 'N' : ''}$`,
        '$\\sigma_w$ 預測：GMAC 雜訊 iid、$\\sigma_\\eta^2\\approx E[x_{\\mathrm{ref}}^2]/N$（近平衡）',
      ],
      metrics: [
        { name: sumMode ? '$g=\\mu KN$' : '$g=\\mu K$', value: an.g, claim: 'approx' },
        { name: 'pole $p=1-g$（$d=0$）', value: an.p, claim: 'approx' },
        { name: '$\\rho$（含延遲 $d$）', value: an.rhoMean, claim: 'exact', note: mimo ? '9 個權重的平均模型 $\\delta_{k+1}=\\delta_k-MJ\\delta_{k-d}$ 的 spectral radius（可觀測子空間）' : '$z^{d+1}-z^d+g=0$ 的最大根模' },
        ...(mimo
          ? [{ name: 'PHOS 步長 $\\mu_p$', value: p.muPhosFs, unit: 'fs', note: `9 個權重的穩態 $\\sigma$ 預測：${mimo.analysis.sigmaPred ? `$[${mimo.analysis.sigmaPred.map((v) => fmtN(v, 3)).join(',\\ ')}]\\,\\mathrm{fs}$` : '未計算（$d$ 太大）'}`, claim: 'approx' as const }]
          : []),
        { name: '$\\mathrm{PM}_{\\mathrm{cal}}$', value: an.pmDeg, unit: 'deg', claim: 'exact', note: '$90^\\circ-(2d+1)\\arcsin(g/2)$' },
        // d = 0：|δ_k| 每個 block 剛好乘上 ρ，τ 是精確的時間常數；d ≥ 1：ρ 只是漸近衰減率（ρ^k 不是包絡），見審查 R02
        p.updateDelay <= 0
          ? { name: '$\\tau=-1/\\ln\\rho$', value: an.tauBlocks, unit: 'block', claim: 'exact' as const }
          : {
              name: '$\\tau=-1/\\ln\\rho$（漸近衰減率）',
              value: an.tauBlocks,
              unit: 'block',
              claim: 'approx' as const,
              note: '$d\\ge1$：$\\rho$ 只決定漸近的衰減率，$\\rho^k$ 不是平均誤差的包絡；逐 block 的暫態可能比 $\\tau$ 慢',
            },
        { name: '$f_u=f_s/N$', value: an.fuHz, unit: 'Hz', claim: 'exact' },
        { name: 'cal $-3\\,\\mathrm{dB}$（exact）', value: an.f3dbHz, unit: 'Hz', claim: 'exact', note: 'E27：$3-2\\sqrt2\\le p<1$ 才存在' },
        { name: 'cal ENBW（one-sided）', value: an.enbwHz, unit: 'Hz', claim: 'exact', note: 'E06：積分雜訊用這個，不是 $-3\\,\\mathrm{dB}$' },
        { name: '$w^*$（mean-field）', value: an.wStarMeanField, unit: 'fs', claim: 'approx', note: 'blockLms：前 $2^{14}$ 個 code 樣本' },
        {
          name: '準靜態固定點 $w^*_k=a+B_k/C_k$（後半段）',
          value: swing ? `[${fmtN(swing.min, 6)}, ${fmtN(swing.max, 6)}]，平均 ${fmtN(swing.mean, 6)}` : '—',
          unit: 'fs',
          note: '每個 block 自己的 $C_k$、$B_k$；範圍很寬表示 code 的區塊統計不平穩',
          claim: 'approx',
        },
        { name: '平均模型（交叉比對用）', value: lin.valid ? (lin.model === 'mean-field' ? 'mean-field 平均軌跡（F-LAB.18）' : '線性時不變模型（F-LAB.7）') : '不適用', note: lin.valid ? '對雜訊取期望值、逐 block 遞迴' : lin.reason },
        { name: 'mean $w$（後半段）', value: metrics ? metrics.meanW : null, unit: 'fs', claim: 'exact' },
        { name: '$\\sigma_w$ 模擬 / 預測', value: metrics ? `${fmtN(metrics.stdW)} / ${fmtN(an.sigmaWPred)}` : null, unit: 'fs' },
        { name: 'settling block', value: metrics ? (metrics.settlingBlock ?? '未收斂') : null, unit: 'block' },
      ],
      warnings: W.update,
    },
    {
      id: 'output',
      title: STAGE_TITLES.output,
      level: 'L4',
      assumptions: [
        '$t_{\\mathrm{out}}=T\\{e_{\\mathrm{DTC}}\\}$（線性 PLL，只含 DTC 殘差這一個來源；VCO / reference noise 未計）',
        '$e_{\\mathrm{DTC}}=$ 靜態殘差 $(a-\\bar w)x+d(x)$ $-$ gain noise $(w_{\\mathrm{app}}-\\bar w)x$；$\\bar w$ 取輸出視窗內的平均',
        'gain noise 的解析近似：$x$ 與 $\\delta w$ 獨立、$\\delta w$ 窄頻（cal 頻寬遠小於 PLL 頻寬）',
        '$\\mathcal L(f)=10\\log_{10}\\bigl(S_\\varphi^{(1)}/2\\bigr)$，$S_\\varphi^{(1)}=(2\\pi f_{\\mathrm{out}})^2S_t^{(1)}$；spur 用 $20\\log_{10}(\\beta/2)$（小角）',
      ],
      metrics: out
        ? [
            { name: '$\\mathrm{RMS}(t_{\\mathrm{out}})$（全頻段、時域）', value: out.rmsOut, unit: 'fs', claim: 'exact' },
            { name: '　靜態部分', value: out.rmsStatic, unit: 'fs', claim: 'exact' },
            { name: '　gain-noise 部分', value: out.rmsNoise, unit: 'fs', claim: 'exact' },
            { name: '　gain-noise 解析近似', value: out.rmsNoisePred, unit: 'fs', note: '$\\sigma_w\\sqrt{\\bar x^2+\\mathrm{Var}(T\\{\\tilde x\\})}$', claim: 'approx' },
            { name: '$[f_L,f_H]$ jitter（gain noise，解析）', value: out.jitterBandNoise, unit: 'fs', claim: 'approx' },
            { name: 'fractional spur（closed form）', value: out.toneClosedForm ? out.toneClosedForm.dbc : '—', unit: 'dBc', claim: 'exact' },
            { name: 'fractional spur（toneFit）', value: out.toneFitSim ? out.toneFitSim.dbc : '—', unit: 'dBc', claim: 'exact' },
          ]
        : [{ name: '輸出分析', value: '未執行（發散或尚未模擬）' }],
      warnings: out ? out.notes : [],
    },
  ]
  return stages
}

// ───────────────────────────────────────────────────────────────────────────
// Pipeline（worker）
// ───────────────────────────────────────────────────────────────────────────

export interface CheckItem {
  status: 'ok' | 'mismatch' | 'not-implemented' | 'n/a'
  value?: number
  analytic?: number
  tolerance?: number
  note: string
}

export interface PipelineChecks {
  replay: CheckItem
  meanW: CheckItem
  sigmaW: CheckItem
  noiseMix: CheckItem
  spur: CheckItem
  code: CheckItem
  fixedPoint: CheckItem
}

export interface PipelineResult {
  version: string
  params: LabParams
  config: BlockLmsConfig
  fOutHz: number
  pll: PllDesign
  code: CodeStage
  analytic: BlockLmsAnalytic
  metrics: BlockLmsMetrics
  loopLevel: 'L1' | 'L2' | 'L5'
  modelLevel: LevelId
  /**
   * block 級（抽樣後）：k、w（內部暫存器）、w_phys、G；
   * wMeanModel = 交叉比對用的平均軌跡（meanModel 指明是 mean-field twin 還是線性時不變模型），
   * wLinearModel = 線性時不變模型 w* − δ_k（對照；不存在時為 NaN）。
   */
  blocks: { k: Float64Array; w: Float64Array; wPhys: Float64Array; G: Float64Array; wMeanModel: Float64Array; wLinearModel: Float64Array }
  /** wMeanModel 用的是哪一個平均模型 */
  meanModel: 'mean-field' | 'linear'
  /** 後半段每個 block 的準靜態固定點 w*_k = a + B_k/C_k 的範圍 [fs]（bipolar；C_k ≤ 0 的 block 不計；算不出來為 null） */
  fixedPointSwing: { min: number; max: number; mean: number } | null
  /** 穩態視窗的逐 sample trace（抽樣後） */
  window: {
    startBlock: number
    blocks: number
    n: Float64Array
    x: Float64Array
    xRef: Float64Array
    eDtc: Float64Array
    uPd: Float64Array
    e: Float64Array
    q: Float64Array
    tOut: Float64Array
  } | null
  /**
   * 連續（不抽樣）的逐 sample 片段：最後一個 block 開頭的 ≤ SNIPPET_SAMPLES 個樣本（這段時間 w_app 固定）。
   * 抽樣後的 window 適合看慢速結構；要看 DSM 鋸齒、每一筆 q 的判斷，要用這個連續片段。
   */
  snippet: {
    startSample: number
    n: Float64Array
    x: Float64Array
    xRef: Float64Array
    eDtc: Float64Array
    uPd: Float64Array
    e: Float64Array
    q: Float64Array
    tOut: Float64Array
    /** 這個 block 實際作用的 gain w_app [fs] */
    wApp: number
  } | null
  replay: { maxAbsDiffG: number; blocksCompared: number } | null
  output: OutputAnalysis | null
  /** quantize 時的浮點對照（同 seed） */
  floatTwin: { meanW: number; stdW: number; bias: number } | null
  stages: StageReport[]
  checks: PipelineChecks
  warnings: string[]
  assumptions: string[]
  timingMs: { loop: number; replay: number; output: number }
  /** 迴路由哪個引擎執行：'blockLms'（legacy、單一 gain）或 'labLoop'（spec 正負號／8 相 PMUX） */
  engine: 'blockLms' | 'labLoop'
  /** pmux8_gos：9 個權重的結果（其餘 null） */
  mimo: PipelineMimo | null
}

/** pmux8_gos 的 9 個權重：軌跡、每個權重的統計、PHOS 殘差、與 mean-field 的交叉比對 */
export interface PipelineMimo {
  analysis: MimoAnalysis
  names: string[]
  target: number[]
  /** block 級（抽樣）：每個權重的 w 與 mean-field 平均軌跡 */
  blocks: { k: Float64Array; w: Float64Array[]; wMeanModel: Float64Array[] }
  /**
   * stdObs：後半段在可觀測子空間的標準差——共模不可觀測時 PHOS 先減掉 8 個的平均（共模沒有恢復力、會隨機漫步，dlyap 的 σ 預測不含它）；
   * 共模可觀測（none 路徑）或 GOS 時等於 stdW
   */
  perWeight: { name: string; target: number; meanW: number; stdW: number; stdObs: number; bias: number; settlingBlock: number | null; sigmaPred: number | null; meanFieldHalf: number }[]
  phosRmsFs: number
  phosCommonFs: number
  /** mean-field 平均軌跡在同一段後半段的 PHOS 殘差 RMS（去共模）[fs] */
  phosRmsMeanFieldFs: number
  checks: { meanW: CheckItem; sigma: CheckItem; stability: CheckItem }
  /** 穩態視窗與連續片段的 PMUX 相位索引（與 window.n / snippet.n 對齊） */
  windowPhase: Float64Array | null
  snippetPhase: Float64Array | null
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// #region core:ar1MeanVar
/**
 * 平穩 AR(1)（變異數 σ²、lag-1 相關 ρ）連續 m 個樣本平均的變異數：
 *   Var(x̄) = (σ²/m²)·[m + 2Σ_{j=1}^{m−1}(m − j)ρ^j]，Σ = ρ[m(1 − ρ) − (1 − ρ^m)]/(1 − ρ)²。
 * m ≫ τ 時 ≈ (σ²/m)(1 + ρ)/(1 − ρ)；m ≪ τ 時 → σ²（整段幾乎只是一個樣本）。
 */
export function ar1MeanVar(sigma2: number, rho: number, m: number): number {
  if (m <= 1) return sigma2
  if (Math.abs(rho) < 1e-15) return sigma2 / m
  const S = (rho * (m * (1 - rho) - (1 - Math.pow(rho, m)))) / ((1 - rho) * (1 - rho))
  return (sigma2 / (m * m)) * (m + 2 * S)
}
// #endregion

export interface LinearPrediction {
  /** 平均模型是否適用（平均模型穩定、g > 0、有預測軌跡、σ_v > 0） */
  valid: boolean
  reason: string
  /**
   * 預測用的是哪一個平均模型：
   *   'mean-field'：meanFieldTwin 的逐 block 軌跡（對雜訊取期望值；不假設 code 統計平穩、不做小訊號線性化）；
   *   'linear'：線性、時不變的平均模型 ŵ_k = w* − δ_k（δ_{k+1} = δ_k − gδ_{k−d}，常數 w* 與 g）。
   */
  model: 'mean-field' | 'linear'
  /** blockLms 的 mean-field 固定點 w*（前 2^14 個 code 樣本；code 的區塊統計隨時間變化時只是其中一段的值） */
  wStar: number
  /** 預測的平均軌跡 ŵ_0…ŵ_K（model 指明是哪一種） */
  traj: Float64Array
  /** 線性時不變模型的軌跡 w* − δ_k（對照用；w* 不存在時為 NaN） */
  trajLinear: Float64Array
  /** 後半段（k ≥ ⌈(K+1)/2⌉）的預測平均與預測 RMS 擾動（σ_ss²(1 − ρ^{2k}) 的平均開根號） */
  halfMean: number
  halfRms: number
  /** 預測軌跡本身在後半段的變異（transient 未衰減完、或固定點隨 code 擺動時，單一 run 的 std 會包含它） */
  halfTrajVar: number
  /** 後半段起點剩下的 transient |δ_{K/2}|（線性模型） */
  transientAtHalf: number
  /** 預測的平均軌跡在後半段移動了多少：ŵ_K − ŵ_{⌈(K+1)/2⌉}（遠大於 σ_w 表示還沒收斂，「後半段平均」不是穩態值） */
  halfDrift: number
}

// #region core:linearPrediction
/**
 * 預測「後半段 w 的平均」與「擾動 RMS」：比較對象不是 w* 本身，而是平均模型在同一段時間的預測值，
 * 所以收斂很慢（τ 與 K 同量級，例如近整數 FCW）時也能公平比較（transient 被算進預測裡）。
 * 有 mean-field twin 的軌跡（meanField，長度 K + 1）時用它；否則退回線性時不變模型（常數 w*、g）。
 */
export function linearPrediction(an: BlockLmsAnalytic, p: Pick<LabParams, 'w0Fs' | 'updateDelay' | 'sigmaV'>, K: number, meanField?: ArrayLike<number> | null): LinearPrediction {
  const wStar = an.wStarMeanField
  const traj = new Float64Array(K + 1)
  const trajLinear = new Float64Array(K + 1).fill(NaN)
  const h0 = Math.ceil((K + 1) / 2)
  const useMf = !!meanField && meanField.length === K + 1 && Number.isFinite(meanField[K])
  const model: LinearPrediction['model'] = useMf ? 'mean-field' : 'linear'
  let reason = ''
  if (!(p.sigmaV > 0)) reason = '$\\sigma_v=0$：$K_q$ 無定義，平均模型不適用'
  else if (!(an.g > 0)) reason = '$g\\le0$：極性錯誤，sign-LMS 的 $G$ 有界，$w$ 是線性漂移而不是指數模型'
  else if (!an.stableMean) reason = '平均模型不穩定（$g$ 超過臨界值 $2\\sin\\frac{\\pi}{4d+2}$）'
  else if (!Number.isFinite(wStar)) reason = 'mean-field 固定點不存在（$E[G](w)=0$ 無解）：$w$ 會一路漂走，沒有穩態可以比'
  if (reason) return { valid: false, reason, model, wStar, traj: traj.fill(NaN), trajLinear, halfMean: NaN, halfRms: NaN, halfTrajVar: NaN, transientAtHalf: NaN, halfDrift: NaN }
  const delta = meanDeltaTrajectory(wStar - p.w0Fs, an.g, p.updateDelay, K) // δ_k（δ = w* − w）：線性時不變模型
  for (let k = 0; k <= K; k++) trajLinear[k] = wStar - delta[k]
  const transientAtHalf = Math.abs(delta[h0])
  let sm = 0
  let sv = 0
  const rho2 = an.rhoMean * an.rhoMean
  const ss2 = Number.isFinite(an.sigmaWPred) ? an.sigmaWPred * an.sigmaWPred : NaN
  for (let k = 0; k <= K; k++) {
    traj[k] = useMf ? (meanField as ArrayLike<number>)[k] : trajLinear[k] // ← 差異：有 mean-field twin 就用它（code 統計不平穩時仍然適用）
    if (k >= h0) {
      sm += traj[k]
      sv += ss2 * (1 - Math.pow(rho2, k)) // ← 變異數從 0 長到 σ_ss²（以 ρ 近似成長速率）
    }
  }
  const m = K + 1 - h0
  const halfMean = sm / m
  let tv = 0
  for (let k = h0; k <= K; k++) tv += (traj[k] - halfMean) * (traj[k] - halfMean)
  return { valid: true, reason: '', model, wStar, traj, trajLinear, halfMean, halfRms: Math.sqrt(sv / m), halfTrajVar: m > 1 ? tv / (m - 1) : 0, transientAtHalf, halfDrift: traj[K] - traj[h0] }
}
// #endregion

// #region core:convergenceBlocks
/**
 * Run-to-Convergence：依線性平均模型建議 block 數 K_B，讓「後半段」真的是穩態。
 *   transient |δ_k| = |δ_0|ρ^k 降到 σ_w/4 需要 n_s = τ·ln(4|δ_0|/σ_w) 個 block（τ = −1/ln ρ）；
 *   後半段還要有 ≥ 10τ 的穩態資料才估得出平均 ⇒ K_B = 2·max(n_s, 10τ)。
 * 不收斂時不給數字，而是回傳原因（極性、g 太大、σ_v = 0、沒有固定點）。
 */
export function convergenceBlocks(an: BlockLmsAnalytic, p: Pick<LabParams, 'w0Fs' | 'N' | 'sigmaV'>): { blocks: number | null; needed: number; reason: string } {
  if (!(p.sigmaV > 0)) return { blocks: null, needed: NaN, reason: '$\\sigma_v=0$：$K_q$ 無定義，沒有線性時間常數可用（純 sign 迴路會進入 limit cycle 或 dead zone）。' }
  if (!(an.g > 0))
    return { blocks: null, needed: NaN, reason: '$g=\\mu K\\le0$（$C\\le0$ 或 $\\mu\\le0$）：平均誤差不會收斂，增加 block 數沒有用。先修正極性：delay alignment、filtered-x，或檢查 $\\mu$ 與 comparator 的符號。' }
  if (!an.stableMean) return { blocks: null, needed: NaN, reason: `$g=${texNum(an.g)}$ 超過臨界值（$\\rho=${texNum(an.rhoMean, 5)}\\ge1$）：平均模型不穩定，請減小 $\\mu$（sum 模式要再除以 $N$）或更新延遲 $d$。` }
  if (!Number.isFinite(an.wStarMeanField)) return { blocks: null, needed: NaN, reason: 'mean-field 固定點不存在：$E[G](w)=0$ 無解（例如 0/1 未映射且 code 有 DC），$w$ 會一路漂走。' }
  const tau = -1 / Math.log(an.rhoMean) // ρ → 0 時 τ → 0（一步到位）
  const d0 = Math.abs(an.wStarMeanField - p.w0Fs)
  const sig = Number.isFinite(an.sigmaWPred) && an.sigmaWPred > 0 ? an.sigmaWPred : Math.max(d0, 1e-12) * 1e-3
  const nSettle = d0 > sig / 4 ? tau * Math.log((4 * d0) / sig) : 0 // ← |δ_0|ρ^n = σ_w/4
  const needed = Math.max(20, Math.ceil(2 * Math.max(nSettle, 10 * tau)))
  const cap = Math.max(20, Math.min(LAB_RANGES.blocks.max, Math.floor(MAX_PIPELINE_SAMPLES / p.N)))
  if (needed > cap)
    return {
      blocks: cap,
      needed,
      reason: `需要約 ${needed} 個 block（$\\tau\\approx${texNum(tau, 4)}$）才能讓後半段是穩態，超過上限 ${cap}：已設為上限，結果仍含 transient。可增大 $\\mu$、減小 $N$，或把 $w_0$ 設在 $w^*$ 附近。`,
    }
  return { blocks: needed, needed, reason: `$\\tau\\approx${texNum(tau, 4)}$ blocks，transient 需 ${Math.ceil(nSettle)} 個 block 降到 $\\sigma_w/4$；取 $K_B=2\\max(n_s,10\\tau)=${needed}$。` }
}
// #endregion

/** Pipeline 的交叉比對（純函式；測試直接呼叫）。 */
export function pipelineChecks(r: {
  params: LabParams
  analytic: BlockLmsAnalytic
  metrics: BlockLmsMetrics
  w: ArrayLike<number>
  replay: { maxAbsDiffG: number } | null
  output: OutputAnalysis | null
  code: CodeStage
  floatTwin: { meanW: number } | null
  /** mean-field twin 的軌跡 ŵ_0…ŵ_K（有的話，mean w 與 σ_w 的比較用它；否則用線性時不變模型） */
  meanField?: ArrayLike<number> | null
}): PipelineChecks {
  const { params: p, analytic: an, metrics: m } = r
  const K = r.w.length - 1
  const h0 = Math.ceil((K + 1) / 2)
  const lin = linearPrediction(an, p, K, r.meanField)
  const modelName = lin.model === 'mean-field' ? 'mean-field 平均軌跡' : '線性平均模型'
  const replay: CheckItem = r.replay
    ? r.replay.maxAbsDiffG === 0
      ? { status: 'ok', value: 0, note: '重播的 $G_k$ 與 runBlockLms 逐位元相同：DSM → 正規化 → DTC → $H_{\\mathrm{PD}}$ → comparator → GMAC 每一級都對齊' }
      : r.replay.maxAbsDiffG <= 1e-12
        ? { status: 'ok', value: r.replay.maxAbsDiffG, note: `重播的 $G_k$ 最大差 $${texNum(r.replay.maxAbsDiffG, 3)}$（浮點捨入等級）` }
        : { status: 'mismatch', value: r.replay.maxAbsDiffG, note: `重播的 $G_k$ 與 runBlockLms 不一致（最大差 $${texNum(r.replay.maxAbsDiffG)}$）：某一級的對齊或亂數流不同` }
    : { status: 'n/a', note: '未重播' }

  // 後半段相對於預測軌跡的殘差；不確定度用「預測的」σ 與 ρ（AR(1)），不用單一 run 的資料估 ESS
  //（τ 與視窗同量級時，資料估的 ESS 會嚴重高估資訊量）
  const resid = new Float64Array(Math.max(0, K + 1 - h0))
  for (let k = h0; k <= K; k++) resid[k - h0] = r.w[k] - (lin.valid ? lin.traj[k] : m.meanW)
  let ms = 0
  for (let i = 0; i < resid.length; i++) ms += resid[i] * resid[i]
  const residRms = resid.length > 0 ? Math.sqrt(ms / resid.length) : NaN
  const mHalf = resid.length
  const rho = Math.min(Math.abs(an.rhoMean), 0.999999)
  const lsbAllow = p.quantize ? p.lsbFs : 0
  let meanW: CheckItem
  if (m.diverged || !lin.valid) {
    meanW = { status: 'n/a', note: m.diverged ? '$w$ 數值發散' : lin.reason }
  } else {
    // 沒有 σ_w 的預測（例如 comparator 飽和、blockLms 回報 0）時，退而用這次模擬對平均軌跡的殘差 RMS 當 σ
    const hasSigma = lin.halfRms > 0
    const sigPred = Math.max(hasSigma ? lin.halfRms : residRms, p.quantize ? p.lsbFs / Math.sqrt(12) : 0)
    const se = Math.sqrt(ar1MeanVar(sigPred * sigPred, rho, mHalf))
    const tol = 4 * se + lsbAllow + 1e-9 * Math.max(1, Math.abs(lin.halfMean))
    const d = Math.abs(m.meanW - lin.halfMean)
    // 平均軌跡自己在後半段還在移動（transient 沒走完，或根本沒有可到達的固定點）：「一致」只表示模擬跟得上平均模型
    const moving =
      Math.abs(lin.halfDrift) > 2 * Math.max(sigPred, 1e-12)
        ? `。注意：平均軌跡在後半段仍移動了 $${texNum(lin.halfDrift, 3)}\\,\\mathrm{fs}$（還沒收斂，或固定點在可到達的範圍之外）；這一項只檢查「模擬與平均模型相符」，不代表已經收斂`
        : ''
    const why =
      d <= tol
        ? moving
        : m.wrapCount > 0
          ? `。暫存器 wrap 了 ${m.wrapCount} 次：平均模型不含暫存器的溢位`
          : m.saturationCount > 0
            ? `。暫存器飽和了 ${m.saturationCount} 次：目標超出可表示的範圍，平均模型（浮點）到得了、定點到不了`
            : moving
    meanW = {
      status: d <= tol ? 'ok' : 'mismatch',
      value: m.meanW,
      analytic: lin.halfMean,
      tolerance: tol,
      note: `後半段 mean $w$ vs「${modelName}」同一段的預測 $${texNum(lin.halfMean, 6)}\\,\\mathrm{fs}$（線性模型在後半段起點的殘餘 transient $${lin.transientAtHalf < 1e-9 ? '\\approx0' : `${texNum(lin.transientAtHalf, 3)}\\,\\mathrm{fs}`}$）：差 $${texNum(d)}\\,\\mathrm{fs}$；容差 $4\\,\\mathrm{SE}${lsbAllow > 0 ? '+1\\,\\mathrm{LSB}' : ''}=${texNum(tol)}\\,\\mathrm{fs}$（SE 由${hasSigma ? '預測' : '這次模擬的殘差'} $\\sigma=${texNum(sigPred)}\\,\\mathrm{fs}$、$\\rho=${texNum(rho, 5)}$ 的 AR(1) 平均變異數算出）${why}`,
    }
  }
  let sigmaW: CheckItem
  const nEff = mHalf * ((1 - rho * rho) / (1 + rho * rho))
  if (m.diverged || !lin.valid || !(lin.halfRms > 0)) {
    sigmaW = { status: 'n/a', note: m.diverged ? '$w$ 數值發散' : lin.valid ? '沒有 $\\sigma_w$ 預測' : lin.reason }
  } else if (p.quantize && p.lsbFs > 2 * an.sigmaWPred) {
    sigmaW = { status: 'n/a', note: '$\\Delta>2\\sigma_{w,\\mathrm{pred}}$：量化主導，線性 $\\sigma_w$ 預測不適用' }
  } else if (nEff < 8) {
    sigmaW = {
      status: 'n/a',
      value: residRms,
      analytic: lin.halfRms,
      note: `單一 run 的後半段只有約 $${texNum(nEff, 3)}$ 個獨立樣本（$\\rho=${texNum(rho, 5)}$）：無法檢驗 $\\sigma_w$，請用 Monte Carlo 分頁（多 seeds）`,
    }
  } else {
    const rel = 4 * Math.sqrt(2 / nEff) + 0.15
    const ratio = residRms / lin.halfRms
    sigmaW = {
      status: Math.abs(ratio - 1) <= rel ? 'ok' : 'mismatch',
      value: residRms,
      analytic: lin.halfRms,
      tolerance: rel,
      note: `後半段 $w$ 對「${modelName}」的殘差 RMS / 預測 $=${texNum(ratio, 4)}$；容差 $\\pm\\bigl(4\\sqrt{2/n_{\\mathrm{eff}}}+15\\%\\bigr)=\\pm${texNum(rel, 3)}$（$n_{\\mathrm{eff}}=m\\frac{1-\\rho^2}{1+\\rho^2}=${texNum(nEff, 3)}$；15% 是模型近似的餘裕）`,
    }
  }
  let noiseMix: CheckItem = { status: 'n/a', note: '未做輸出分析' }
  let spur: CheckItem = { status: 'n/a', note: '只有一階 DSM（無 dither）有 fractional spur 的封閉式' }
  if (r.output) {
    const o = r.output
    if (!(o.rmsNoise > 0) || !Number.isFinite(o.rmsNoisePred)) {
      noiseMix = { status: 'n/a', note: 'gain noise 為 0（$\\sigma_v=0$ 或 $w$ 不動）' }
    } else {
      const ratio = o.rmsNoise / o.rmsNoisePred
      noiseMix = {
        status: Math.abs(ratio - 1) <= 0.25 ? 'ok' : 'mismatch',
        value: o.rmsNoise,
        analytic: o.rmsNoisePred,
        tolerance: 0.25,
        note: `$T\\{-\\delta w\\,x\\}$ 的 RMS 與 $\\sigma_w\\sqrt{\\bar x^2+\\mathrm{Var}(T\\{\\tilde x\\})}$ 的比值 $${texNum(ratio, 4)}$（容差 $\\pm25\\%$；近似：$x$ 與 $\\delta w$ 獨立、$\\delta w$ 窄頻）${
          Math.abs(ratio - 1) <= 0.25
            ? ''
            : '。不一致表示「$\\delta w$ 窄頻」不成立：$\\delta w$ 是每 $N$ 個 sample 才變一次的階梯（ZOH），它的頻譜在 $k\\,f_u$ 附近有 image，會把 code 在那些頻率的功率摺回 PLL 頻寬內（$N$ 很小、code 高頻功率很大時最明顯）。這時要用完整的頻譜卷積 $S_{\\tilde x}\\ast S_w^{\\mathrm{ZOH}}$（E09），本頁沒有實作；請以時域 RMS 為準。'
        }`,
      }
    }
    if (o.toneClosedForm && o.toneFitSim) {
      const fs = p.fRefHz
      const L = Math.min(p.outBlocks, K) * p.N
      const sNoise = interpPsd(o.psdAnalytic.f, o.psdAnalytic.noise, o.fracToneHz)
      const noiseAmp = Number.isFinite(sNoise) ? Math.sqrt(Math.max(0, sNoise) * (fs / L)) : 0.1 * o.toneClosedForm.ampFs
      const tol = 0.03 * o.toneClosedForm.ampFs + 4 * noiseAmp + 1e-6
      const d = Math.abs(o.toneFitSim.ampFs - o.toneClosedForm.ampFs)
      spur = {
        status: d <= tol ? 'ok' : 'mismatch',
        value: o.toneFitSim.ampFs,
        analytic: o.toneClosedForm.ampFs,
        tolerance: tol,
        note: `$f_1=${texNum(o.fracToneHz / 1e6, 5)}\\,\\mathrm{MHz}$ 的 tone：toneFit $${texNum(o.toneFitSim.ampFs)}\\,\\mathrm{fs}$ vs 封閉式 $|a-\\bar w|\\,s\\,A_1|T(f_1)|=${texNum(o.toneClosedForm.ampFs)}\\,\\mathrm{fs}$（容差 3% + 4 倍雜訊估計誤差）`,
      }
    }
  }
  let code: CheckItem = { status: 'n/a', note: '只有一階 DSM（無 dither）有封閉式' }
  if (Number.isFinite(r.code.xMeanClosed) && r.code.source === 'dsm_first_order') {
    const periods = (1 << 17) / Math.max(1, r.code.period)
    const tol = periods >= 16 ? 0.02 : Infinity
    const d1 = Math.abs(r.code.xMean - r.code.xMeanClosed)
    const d2 = Math.abs(r.code.xMeanSquare - r.code.xMeanSquareClosed)
    code =
      tol === Infinity
        ? { status: 'n/a', note: `code 統計的估計只涵蓋 $${texNum(periods, 3)}$ 個週期（少於 16），不做比對` }
        : { status: d1 <= tol && d2 <= tol ? 'ok' : 'mismatch', note: `code 統計 vs 封閉式：$E[x]$ 差 $${texNum(d1)}$、$E[x^2]$ 差 $${texNum(d2)}$（容差 0.02；$${texNum(periods, 3)}$ 個週期）` }
  }
  let fixedPoint: CheckItem
  if (!p.quantize) fixedPoint = { status: 'n/a', note: '未啟用定點暫存器（理想浮點）' }
  else if (!r.floatTwin || !lin.valid || m.diverged) fixedPoint = { status: 'n/a', note: '浮點對照無法比較（不穩定或發散）' }
  else {
    const sigPred = Math.max(lin.halfRms, p.lsbFs / Math.sqrt(12))
    const se = Math.sqrt(ar1MeanVar(sigPred * sigPred, rho, mHalf))
    const tol = p.lsbFs + 4 * se
    const d = Math.abs(m.meanWPhys - r.floatTwin.meanW)
    fixedPoint = {
      status: d <= tol ? 'ok' : 'mismatch',
      value: m.meanWPhys,
      analytic: r.floatTwin.meanW,
      tolerance: tol,
      note: `定點實體 gain 的平均 vs 同 seed 浮點：差 $${texNum(d)}\\,\\mathrm{fs}$（容差 $1\\,\\mathrm{LSB}+4\\,\\mathrm{SE}=${texNum(tol)}\\,\\mathrm{fs}$）${
        d <= tol
          ? ''
          : m.wrapCount > 0
            ? `；暫存器 wrap 了 ${m.wrapCount} 次（溢位後跳到另一端），定點軌跡與浮點完全不同`
            : m.saturationCount > 0
              ? `；暫存器飽和了 ${m.saturationCount} 次：目標超出可表示的範圍，定點卡在端點`
              : '；dead zone / limit cycle 讓定點偏離浮點'
      }`,
    }
  }
  return { replay, meanW, sigmaW, noiseMix, spur, code, fixedPoint }
}

/** 把多個子檢查合併成 ExperimentShell 的一個欄位（有 mismatch 就是 mismatch；全部 n/a 就是 n/a）。 */
export function combineChecks(items: CheckItem[], label: string): CheckItem {
  const bad = items.filter((i) => i.status === 'mismatch')
  const ok = items.filter((i) => i.status === 'ok')
  if (bad.length > 0) return { status: 'mismatch', note: `${label}：${bad.map((b) => b.note).join('；')}` }
  if (ok.length > 0) return { status: 'ok', note: `${label}：${ok.length} 項通過${items.length > ok.length ? `、${items.length - ok.length} 項不適用` : ''}` }
  return { status: 'n/a', note: `${label}：${items.map((i) => i.note).join('；')}` }
}

/**
 * 整條 pipeline（worker 可呼叫）：runBlockLms → replay（跨級一致性 + 穩態視窗）→ 輸出端分析 → stage 報告與交叉比對。
 * 參數不合法時丟出繁體中文 Error。
 */
export function runPipeline(p: LabParams): PipelineResult {
  const errs = labParamErrors(p)
  if (errs.length > 0) throw new Error(`參數不合法：\n${errs.join('\n')}`)
  if (!usesLegacyEngine(p)) return runPipelineLab(p)
  const t0 = now()
  const design = pllDesign(p)
  const cfg = resolveConfig(toBlockLmsConfig(p))
  const res = runBlockLms(cfg)
  const t1 = now()
  const an = res.analytic
  const fOutHz = outputFrequencyHz(p)
  const code = codeStage(p, an)
  const K = cfg.num_blocks
  const warnings = res.warnings.slice()
  for (const w of design.warnings) if (!warnings.includes(w)) warnings.push(w)

  // 浮點對照（定點時）
  let floatTwin: PipelineResult['floatTwin'] = null
  if (p.quantize) {
    const tw = runBlockLms({ ...cfg, gain_register: { ...cfg.gain_register, quantize_physical: false }, record: { sample_trace_blocks: 0, decimate: 1 } })
    floatTwin = { meanW: tw.metrics.meanW, stdW: tw.metrics.stdW, bias: tw.metrics.bias }
  }

  // replay + 輸出分析
  let replay: PipelineResult['replay'] = null
  let window: PipelineResult['window'] = null
  let output: OutputAnalysis | null = null
  let rwin: ReplayWindow | null = null
  const until = res.metrics.divergenceBlock !== null ? Math.max(1, res.metrics.divergenceBlock - 1) : K
  const W = Math.max(1, Math.min(p.outBlocks, until, Math.floor(MAX_WINDOW_SAMPLES / p.N)))
  const rp = replayPipeline({ config: cfg, wPhys: res.blocks.wPhys, G: res.blocks.G, normalization: an.normalization, T: design.T, windowBlocks: W, untilBlock: until })
  const t2 = now()
  replay = { maxAbsDiffG: rp.maxAbsDiffG, blocksCompared: rp.blocksCompared }
  rwin = rp.window
  const idx = decimateIdx(rwin.x.length, TRACE_POINTS)
  window = {
    startBlock: rwin.startBlock,
    blocks: rwin.blocks,
    n: Float64Array.from(idx.map((i) => rwin!.startBlock * p.N + i)),
    x: pick(rwin.x, idx),
    xRef: pick(rwin.xRef, idx),
    eDtc: pick(rwin.eDtc, idx),
    uPd: pick(rwin.uPd, idx),
    e: pick(rwin.e, idx),
    q: pick(rwin.q, idx),
    tOut: pick(rwin.tOut, idx),
  }
  // 連續片段：視窗內最後一個 block 的開頭
  const snipLen = Math.min(p.N, SNIPPET_SAMPLES)
  const snipStart = (rwin.blocks - 1) * p.N
  const cut = (a: Float64Array): Float64Array => a.slice(snipStart, snipStart + snipLen)
  const snippet: PipelineResult['snippet'] = {
    startSample: (rwin.startBlock + rwin.blocks - 1) * p.N,
    n: Float64Array.from({ length: snipLen }, (_, i) => (rwin!.startBlock + rwin!.blocks - 1) * p.N + i),
    x: cut(rwin.x),
    xRef: cut(rwin.xRef),
    eDtc: cut(rwin.eDtc),
    uPd: cut(rwin.uPd),
    e: cut(rwin.e),
    q: cut(rwin.q),
    tOut: cut(rwin.tOut),
    wApp: rwin.wApp[rwin.blocks - 1],
  }
  if (res.metrics.divergenceBlock === null) {
    const firstOrder =
      p.codeSource === 'dsm_first_order' && !p.dither ? (() => {
        const st = firstOrderResidueStats(p.frac, p.dsmBits)
        return { P: st.P, line1: st.line1, fracEff: st.fracEff }
      })() : null
    output = analyzeOutput({
      win: rwin,
      fs: p.fRefHz,
      fOut: fOutHz,
      N: p.N,
      T: design.T,
      H: design.H,
      mu: p.muFs,
      g: an.g,
      d: p.updateDelay,
      sigmaEta2: an.sigmaEta2,
      sigmaWPred: an.sigmaWPred,
      fL: p.fLHz,
      fH: p.fHHz,
      aFs: p.aFs,
      firstOrder,
      normScale: an.normalization.scale,
      staticLinearOnly: p.c2 === 0 && p.c3 === 0 && !p.quantize,
    })
  }
  const t3 = now()

  // block 級（抽樣）+ 平均軌跡（mean-field twin；重播沒有跑完整段時退回線性時不變模型）
  const kIdx = decimateIdx(K + 1, 4000)
  const mfW = until === K ? rp.meanField.w : null
  const lin = linearPrediction(an, p, K, mfW)
  const blocks = {
    k: Float64Array.from(kIdx),
    w: pick(res.blocks.w, kIdx),
    wPhys: pick(res.blocks.wPhys, kIdx),
    G: pick(Float64Array.from([...res.blocks.G, NaN]), kIdx),
    wMeanModel: pick(lin.traj, kIdx),
    wLinearModel: pick(lin.trajLinear, kIdx),
  }
  const fixedPointSwing = until === K ? quasiStaticFixedPoint(rp.meanField, p, an.Ex2) : null
  const loopLevel = res.modelLevel
  const modelLevel: LevelId = p.quantize ? 'L5' : 'L4'
  const checks = pipelineChecks({ params: p, analytic: an, metrics: res.metrics, w: res.blocks.w, replay, output, code, floatTwin, meanField: mfW })
  const stages = buildStages({ p, cfg, design, code, an, metrics: res.metrics, warnings, win: rwin, out: output, replay, fOutHz, loopLevel, swing: fixedPointSwing, lin })
  const assumptions = [
    `時間單位 fs；code 依 ${p.normalization} 正規化後無因次；$a$、$w$ 的單位為 fs per unit code；極性 $\\delta=a-w$`,
    '$f_s=f_{\\mathrm{ref}}$：每個 DSM sample 對應一個 DTC code、一個 comparator sample（多速率未建模）',
    'DTC 在 reference 輸入端，回授路徑只有 divider；comparator 取 PD 的輸出：$e[n]=H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}[n]+b+v[n]$，$e_{\\mathrm{DTC}}=(a-w_{\\mathrm{app}})x+o_{\\mathrm{DTC}}+c_2x^2+c_3x^3$；$H_{\\mathrm{PD}}$ 狀態跨 block 持續（§15.2）',
    `$v[n]$ 為 iid Gaussian（$\\sigma_v=${p.sigmaV}\\,\\mathrm{fs}$），與 code 獨立；$q=\\mathrm{sign}(e)$，tie 規則 $e\\ge0\\Rightarrow q=+1$（E07）`,
    design.kind === 'none'
      ? `主 PLL：${design.description}；PD 與輸出兩條路徑都取全通，所以這個基準不滿足 $H_{\\mathrm{PD}}+T=1$`
      : `主 PLL：${design.description}；$T=1-H_{\\mathrm{PD}}$（線性、時不變）`,
    '$K_q=\\sqrt{2/\\pi}/\\sigma_v$ 是小訊號近似（$|e_{\\mathrm{det}}|\\ll\\sigma_v$）；$\\sigma_w$ 預測假設 GMAC 雜訊 iid 且線性化有效',
    `$C$、固定點由 blockLms 以前 $2^{17}$ 個 code 樣本估計（mean-field 固定點用 $2^{14}$ 個）`,
    `輸出分析：最後 $${W}$ 個 block（$${W * p.N}$ 個 samples）的重播視窗；靜態殘差用該視窗的 $\\bar w$`,
    '輸出端只含 DTC 殘差這一個雜訊來源（VCO / reference / PD 自身雜訊未計）',
    p.quantize
      ? `gain register 定點（L5）：內部 $${p.internalBits}$ bits、實體 $${p.physicalBits}$ bits、$\\Delta=${p.lsbFs}\\,\\mathrm{fs}$、rounding = ${p.rounding}、overflow = ${p.overflow}`
      : 'gain register 未量化：$w$ 為理想浮點',
    `模擬版本 ${UNIFIED_LAB_VERSION}（迴路由 blockLms.ts 的 runBlockLms 執行）`,
  ]
  return {
    version: UNIFIED_LAB_VERSION,
    params: { ...p },
    config: cfg,
    fOutHz,
    pll: design,
    code,
    analytic: an,
    metrics: res.metrics,
    loopLevel,
    modelLevel,
    blocks,
    meanModel: lin.model,
    fixedPointSwing,
    window,
    snippet,
    replay,
    output,
    floatTwin,
    stages,
    checks,
    warnings,
    assumptions,
    timingMs: { loop: t1 - t0, replay: t2 - t1, output: t3 - t2 },
    engine: 'blockLms',
    mimo: null,
  }
}

/** 快速解析（不跑迴路）：給 Compare / 手算段落即時顯示。pmux8_gos 時另附 9 個權重的分析（mimo）。 */
export function analyzeLab(p: LabParams): {
  pll: PllDesign
  code: CodeStage
  analytic: BlockLmsAnalytic
  warnings: string[]
  fOutHz: number
  bandwidths: ReturnType<typeof calBandwidths>
  mimo: MimoAnalysis | null
} {
  const errs = labParamErrors(p)
  if (errs.length > 0) throw new Error(`參數不合法：\n${errs.join('\n')}`)
  const design = pllDesign(p)
  if (!usesLegacyEngine(p)) {
    const pr = prepareLab(p, design)
    const code = codeStage(p, pr.analytic)
    return { pll: design, code, analytic: pr.analytic, warnings: pr.warnings, fOutHz: outputFrequencyHz(p), bandwidths: calBandwidths(pr.analytic.p, pr.analytic.fuHz), mimo: pr.mimo }
  }
  const an = analyzeBlockLms(toBlockLmsConfig(p))
  const code = codeStage(p, an.analytic)
  return {
    pll: design,
    code,
    analytic: an.analytic,
    warnings: [...an.warnings, ...design.warnings.filter((w) => !an.warnings.includes(w))],
    fOutHz: outputFrequencyHz(p),
    bandwidths: calBandwidths(an.analytic.p, an.analytic.fuHz),
    mimo: null,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 序列產生（FCW sweep 與 Training 共用）
// ───────────────────────────────────────────────────────────────────────────

/** 與 runBlockLms 相同的 code 串流（同 seed、同 fork 標籤、同正規化），回傳 [skip, skip + L) 的樣本。 */
function codeSequence(cfg: BlockLmsConfig, norm: { offset: number; scale: number }, skip: number, L: number): Float64Array {
  const src = createCodeSource(cfg.seeded_pattern, createRng(cfg.seed).fork('code-pattern'))
  const total = skip + L
  const buf = new Float64Array(total)
  src.fill(buf, 0, total)
  const out = new Float64Array(L)
  for (let i = 0; i < L; i++) out[i] = (buf[skip + i] - norm.offset) * norm.scale
  return out
}

function filterSeq(tf: DtTransfer, x: ArrayLike<number>): Float64Array {
  const f = new StreamFilter(tf.b, tf.a)
  const y = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = f.step(x[i])
  return y
}

function delaySeq(x: ArrayLike<number>, D: number): Float64Array {
  const y = new Float64Array(x.length)
  for (let i = D; i < x.length; i++) y[i] = x[i - D]
  return y
}

/** GMAC regressor x_ref：raw x、delayed x[n−D]、filtered Ĥ{x}[n−D]（與 blockLms 相同定義） */
function regressorSeq(cfg: BlockLmsConfig, path: DtTransfer, x: Float64Array): Float64Array {
  if (cfg.regressor_mode === 'raw') return x
  const D = cfg.gm_code_delay_samples
  const hat = hatTransfer(cfg, path)
  return delaySeq(hat ? filterSeq(hat, x) : x, D)
}

/** 主 PLL 濾波器的 settling（樣本數）：最大 pole 半徑 ρ 衰減到 e^{−20} 所需的 −20/ln ρ，夾在 [lo, hi]。 */
export function pllSettleSamples(design: Pick<PllDesign, 'spectralRadius'>, lo: number, hi: number): number {
  const r = design.spectralRadius
  if (!(r > 0) || r >= 1) return lo
  return Math.max(lo, Math.min(hi, Math.ceil(-20 / Math.log(r))))
}

// ───────────────────────────────────────────────────────────────────────────
// FCW sweep（worker；UI 分段呼叫以顯示進度）
// ───────────────────────────────────────────────────────────────────────────

export interface FcwSweepOptions {
  /** 每點是否跑閉迴路 runBlockLms */
  closedLoop: boolean
  loopBlocks: number
  /** 凍結 w = w* ± Δ 量測 GMAC 斜率（common random numbers） */
  slopeMc: boolean
  slopeBlocks: number
  deltaFs: number
  /** 假設的殘餘 gain 誤差 Δa [fs per unit code]（算 fractional spur 用） */
  residualGainFs: number
  /** 序列統計的最大長度 */
  maxSeqSamples: number
}

export const DEFAULT_SWEEP_OPTIONS: FcwSweepOptions = {
  closedLoop: false,
  loopBlocks: 600,
  slopeMc: true,
  slopeBlocks: 32,
  deltaFs: 10,
  residualGainFs: 0.1,
  maxSeqSamples: 1 << 19,
}

export interface FcwPoint {
  frac: number
  fracEff: number
  K: number
  /** 一階無 dither 的週期 P（其他 0） */
  P: number
  /** code 是不是一階 DSM 的鋸齒（不論有沒有 LSB dither：dither 只讓相位隨機漂移，準週期 1/min(α, 1 − α) 還在） */
  sawtooth: boolean
  /** 統計 record 涵蓋的嚴格週期數（P 未知時 NaN；20-bit FCW 常是 2^20，準週期 1/frac 才是直覺上的「一個鋸齒」） */
  periods: number
  /** C 的前後半 record 相對差（> 0.1 表示估計未收斂） */
  splitRel: number
  seqSamples: number
  fracToneHz: number
  /** C = E[x_ref·u_x]：整數週期（可行時）平均 */
  C: number
  /** blockLms 的 C 估計（前 2^17 樣本），供對照 */
  CblockLms: number
  K_: number
  g: number
  rho: number
  stable: boolean
  tauBlocks: number
  pmDeg: number
  signFlip: boolean
  /** PE：min_k (1/N)Σu_x²（單參數 λ_min） */
  peLambdaMin: number
  blockGainMin: number
  blockGainMax: number
  fracNegBlocks: number
  Ex: number
  Ex2: number
  /** 線性化固定點與偏差 [fs] */
  wStarLin: number
  biasLin: number
  /** blockLms mean-field（2^14 樣本；長週期時只涵蓋部分週期） */
  wStarMf: number
  sigmaWPred: number
  /** 輸出靈敏度：std(T{x})（每 fs gain 誤差造成的 output RMS）、一階基頻 |T|·s·A₁ */
  sensRms: number
  line1PerFs: number
  tMag1: number
  /** 假設殘餘 gain 誤差 Δa 時的 fractional spur [dBc]（一階封閉式；其他 NaN） */
  spurDbc: number
  slope: { S: number; lo: number; hi: number; Smf: number; Klin: number; blocks: number } | null
  loop: FcwLoop | null
  /** 定點時同 seed 浮點對照的閉迴路（sweepFcwChunk 的 twin 選項；只重跑迴路，不重算序列分析） */
  twinLoop?: FcwLoop | null
  /** pmux8_gos：這個 FCW 的 9 權重分析（PMUX 序列每點重算） */
  mimo: FcwMimo | null
  warnings: string[]
}

export interface FcwLoop {
  meanW: number
  stdW: number
  bias: number
  settlingBlock: number | null
  diverged: boolean
  driftPerBlock: number
  converged: boolean
  /** pmux8_gos：閉迴路後半段的 PHOS 殘差 RMS（去共模）[fs]；其他 null */
  phosRmsFs: number | null
}

/** FCW sweep 每點的 9 權重摘要（pmux8_gos） */
export interface FcwMimo {
  /** 可觀測子空間的條件數與 gauge 方向數 */
  cond: number
  nullDim: number
  lambdaMin: number
  lambdaMax: number
  /** J 限制到可觀測子空間後的最小實部；≤ 0 = 至少一個模式極性錯誤 */
  minReEig: number
  /** 9 權重平均模型（實際的 μ、μ_p、d）的 spectral radius */
  rho: number
  stable: boolean
  tauBlocks: number
  muMaxUniform: number
  /** 8 相走訪比例 */
  occupancy: number[]
  /** PMUX 旋轉頻率 α f_ref 折回 [Hz] 與它是否落在反號帶 */
  pmuxRotHz: number
  rotInInversionBand: boolean
  /** 每個 GMAC block 的資訊矩陣在（全段的）可觀測子空間上的最小特徵值的最小值（9 權重的 PE） */
  peLambdaMin: number
  signFlip: boolean
}

/** FCW 格點（log 或 linear）。 */
export function fcwGrid(min: number, max: number, n: number, scale: 'log' | 'linear' = 'log'): number[] {
  const out: number[] = []
  const m = Math.max(2, Math.floor(n))
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1)
    // 端點直接用 min / max（避免 min + (max − min)·1 的浮點捨入，讓「掃到 0.5」真的是 0.5）
    out.push(i === 0 ? min : i === m - 1 ? max : scale === 'log' ? min * Math.pow(max / min, t) : min + (max - min) * t)
  }
  return out
}

// #region core:fcwPoint
/**
 * FCW sweep 的一個點（§11.4、§16.2 FCW 列）：
 *   C = E[x_ref·H{x}]、K = K_q·C、g = μK、ρ（含更新延遲）、PE（每個 GMAC block 的 u 能量最小值）、
 *   線性化 bias、output 靈敏度，以及凍結 w* ± Δ 的 GMAC 斜率 MC（common random numbers）。
 */
export function fcwPoint(base: LabParams, frac: number, opts: FcwSweepOptions, design: PllDesign, index: number, twin = false): FcwPoint {
  const p: LabParams = { ...base, frac, blocks: opts.loopBlocks, outBlocks: Math.min(base.outBlocks, opts.loopBlocks) }
  const legacy = usesLegacyEngine(p)
  const pmux = p.architecture === 'pmux8_gos'
  const cfg = legacy ? resolveConfig(toBlockLmsConfig(p, { record: { sample_trace_blocks: 0, decimate: 1 } })) : null
  const pr = legacy ? null : prepareLab(p, design)
  const an = cfg ? analyzeBlockLms(cfg).analytic : (pr as LabPrepared).analytic
  const warnings: string[] = []
  const dsmFrac = codeFrac(p)
  const first = p.codeSource === 'dsm_first_order' && !p.dither ? firstOrderResidueStats(dsmFrac, p.dsmBits) : null
  const P = first ? first.P : 0
  // 序列長度：一階取整數個週期（≥ 2^17 且 ≥ 16 個週期，受上限限制）
  const want = Math.max(1 << 17, opts.slopeMc ? opts.slopeBlocks * p.N : 0)
  let L = want
  if (P > 1) {
    const per = Math.max(Math.ceil(want / P), 16)
    L = Math.min(per * P, opts.maxSeqSamples)
    if (L >= P) L = Math.floor(L / P) * P
  }
  L = Math.min(Math.max(L, Math.min(want, opts.maxSeqSamples)), opts.maxSeqSamples)
  const skip = pllSettleSamples(design, Math.min(4096, p.N), 1 << 17)
  const seq = cfg ? { x: codeSequence(cfg, an.normalization, 0, skip + L), ph: null } : labCodeSequence(p, an.normalization, 0, skip + L)
  const x = seq.x
  const ux = filterSeq(design.H, x)
  const xr = cfg ? regressorSeq(cfg, design.H, x) : regressorSeqLab(p, design, x)
  const hasNl = p.dtcOffsetFs !== 0 || p.c2 !== 0 || p.c3 !== 0
  const d = new Float64Array(x.length)
  if (hasNl) for (let i = 0; i < x.length; i++) d[i] = p.dtcOffsetFs + x[i] * x[i] * (p.c2 + p.c3 * x[i])
  const unl = hasNl ? filterSeq(design.H, d) : d
  const tx = filterSeq(design.T, x)
  let C = 0
  let Cnl = 0
  let Exr = 0
  let Ex = 0
  let Ex2 = 0
  let C1 = 0
  const half = skip + Math.floor(L / 2)
  for (let i = skip; i < skip + L; i++) {
    const c = xr[i] * ux[i]
    C += c // ← 整段（一階：整數週期）平均的 C（不受 2^17 截斷影響）
    if (i < half) C1 += c
    Cnl += xr[i] * unl[i]
    Exr += xr[i]
    Ex += x[i]
    Ex2 += x[i] * x[i]
  }
  const C2 = (C - C1) / (L - Math.floor(L / 2))
  C1 /= Math.floor(L / 2)
  C /= L
  Cnl /= L
  Exr /= L
  Ex /= L
  Ex2 /= L
  const bug = p.encoding === 'unipolar_unmapped_bug'
  const Kq = p.sigmaV > 0 ? SQRT_2_OVER_PI / p.sigmaV : NaN
  const K_ = Kq * C * (bug ? 0.5 : 1)
  const g = p.muFs * K_ * (p.gmMode === 'sum' ? p.N : 1)
  const rho = delayLoopRadius(g, p.updateDelay)
  const stable = rho < 1
  const tauBlocks = rho > 0 && rho < 1 ? -1 / Math.log(rho) : NaN
  const pmDeg = g > 0 && g <= 2 ? 90 - (2 * p.updateDelay + 1) * ((Math.asin(g / 2) * 180) / Math.PI) : NaN
  // #endregion
  // 每個 GMAC block 的相關與能量
  const nb = Math.floor(L / p.N)
  let bmin = Infinity
  let bmax = -Infinity
  let emin = Infinity
  let neg = 0
  for (let j = 0; j < nb; j++) {
    let c = 0
    let e = 0
    for (let n = 0; n < p.N; n++) {
      const i = skip + j * p.N + n
      c += xr[i] * ux[i]
      e += ux[i] * ux[i]
    }
    c /= p.N
    e /= p.N
    if (c < bmin) bmin = c
    if (c > bmax) bmax = c
    if (e < emin) emin = e
    if (c <= 0) neg++
  }
  const wStarLin = p.aFs + (Cnl + p.compOffsetFs * Exr) / C
  // 輸出靈敏度
  let sm = 0
  for (let i = skip; i < skip + L; i++) sm += tx[i]
  sm /= L
  let sv = 0
  for (let i = skip; i < skip + L; i++) sv += (tx[i] - sm) * (tx[i] - sm)
  const sensRms = Math.sqrt(sv / L)
  const fracEff = first ? first.fracEff : quantizeFcw(dsmFrac, p.dsmBits, p.dither).fracEff
  const fracToneHz = foldFrequency(fracEff * p.fRefHz, p.fRefHz)
  const tMag1 = Math.sqrt(dtMag2(design.T, (2 * Math.PI * fracToneHz) / p.fRefHz))
  const line1PerFs = first && first.P >= 2 ? an.normalization.scale * first.line1 * tMag1 : NaN
  const fOut = outputFrequencyHz(p)
  const spurAmp = Math.abs(opts.residualGainFs) * line1PerFs
  const spurDbc = Number.isFinite(spurAmp) && spurAmp > 0 ? spurDbcSmallAngle(spurBeta(fOut, spurAmp)) : NaN
  const splitRel = Math.abs(C1 - C2) / Math.max(Math.abs(C), 1e-3 * Math.sqrt(Ex2))
  if (splitRel > 0.1) {
    warnings.push(
      `$C$ 在 record 前、後半的估計差 $${texNum(100 * splitRel, 3)}\\%$（$${texNum(C1)}$ vs $${texNum(C2)}$）：code 的準週期比統計 record（${L} samples）還長，$C$ 與 bias 只是部分週期的估計`,
    )
  }
  if (Math.abs(C) <= 1e-12 * Math.max(Ex2, 1e-300)) warnings.push(`$C = ${texNum(C)}$：code 完全沒有激勵（$x\\equiv$ 常數），gain 不可辨識——不是極性問題`)
  else if (!(C > 0)) warnings.push(`$C = ${texNum(C)}\\le 0$：更新極性錯誤，正 $\\mu$ 會使平均誤差發散（減小 $\\mu$ 不會改變符號）`)
  if (P > 0 && P > 1 << 14) warnings.push('週期 $P>2^{14}$：blockLms 的 mean-field $w^*$（$2^{14}$ 個樣本）只涵蓋部分週期')

  // 8 相 PMUX：這個 FCW 的 9 權重分析（PMUX 序列每點重算）
  let mimo: FcwMimo | null = null
  if (pmux && seq.ph) {
    const ma = mimoFromSequence({ p, design, x, ph: seq.ph, skip, bugEncoding: bug })
    const pmuxRotHz = foldFrequency(p.frac * p.fRefHz, p.fRefHz)
    const rotIn = design.inversionBands.some((b) => pmuxRotHz >= b.fLoHz && pmuxRotHz <= b.fHiHz)
    // 9 權重的 PE：每個 GMAC block 的 R_u,k 限制到全段可觀測子空間後的最小特徵值
    const V = observableEigen(ma.Ru, 1e-9).basis
    let peMin = Infinity
    if (V.length > 0 && V[0].length > 0) {
      const phiU: Float64Array[] = []
      for (let j = 0; j < PMUX_WEIGHTS; j++) {
        if (j === GOS_INDEX) {
          phiU.push(ux)
          continue
        }
        const phi = new Float64Array(x.length)
        for (let n = 0; n < x.length; n++) phi[n] = seq.ph[n] === j ? 1 : 0
        phiU.push(design.kind === 'none' ? phi : filterSeq(design.H, phi))
      }
      for (let jb = 0; jb < nb; jb++) {
        const R: Matrix = Array.from({ length: PMUX_WEIGHTS }, () => new Array<number>(PMUX_WEIGHTS).fill(0))
        for (let n = 0; n < p.N; n++) {
          const i = skip + jb * p.N + n
          for (let r = 0; r < PMUX_WEIGHTS; r++) for (let c = r; c < PMUX_WEIGHTS; c++) R[r][c] += phiU[r][i] * phiU[c][i]
        }
        for (let r = 0; r < PMUX_WEIGHTS; r++)
          for (let c = r; c < PMUX_WEIGHTS; c++) {
            R[r][c] /= p.N
            R[c][r] = R[r][c]
          }
        const ev = eigSym(restrictTo(R, V)).values
        peMin = Math.min(peMin, ev[ev.length - 1])
      }
    }
    mimo = {
      cond: ma.obs.cond,
      nullDim: ma.obs.nullDim,
      lambdaMin: ma.obs.lambdaMin,
      lambdaMax: ma.obs.lambdaMax,
      minReEig: ma.minReEig,
      rho: ma.rho,
      stable: ma.stable,
      tauBlocks: ma.tauBlocks,
      muMaxUniform: ma.muMaxUniform,
      occupancy: ma.occupancy,
      pmuxRotHz,
      rotInInversionBand: rotIn,
      peLambdaMin: peMin,
      signFlip: !(ma.minReEig > 0),
    }
    for (const w of ma.warnings) warnings.push(w)
    if (!(ma.minReEig > 0)) warnings.push(`9 權重的 Jacobian 在可觀測子空間上 $\\min\\mathrm{Re}\\,\\lambda=${texNum(ma.minReEig, 3)}\\le0$：至少一個模式極性錯誤${rotIn ? `（PMUX 旋轉頻率 $${texNum(pmuxRotHz / 1e6, 4)}\\,\\mathrm{MHz}$ 落在反號帶內：PHOS mode-1 反號，案例頁 §8）` : ''}`)
    else if (rotIn) warnings.push(`PMUX 旋轉頻率 $${texNum(pmuxRotHz / 1e6, 4)}\\,\\mathrm{MHz}$ 落在反號帶內，但 one-hot 的高次諧波把平均拉回正值（$\\min\\mathrm{Re}\\,\\lambda=${texNum(ma.minReEig, 3)}$）`)
    if (Number.isFinite(peMin) && peMin < PE_FLOOR_REL * Math.max(ma.obs.lambdaMax, 1e-300)) warnings.push('9 權重的 PE：至少一個 GMAC block 有某個相位幾乎沒被走訪（或共模之外的方向沒有激勵），該 block 的對應權重不可辨識')
  }

  // 凍結 w ± Δ 的 GMAC 斜率（common random numbers）
  let slope: FcwPoint['slope'] = null
  if (opts.slopeMc && p.sigmaV > 0) {
    const B = Math.min(opts.slopeBlocks, Math.floor(L / p.N))
    const wc = Number.isFinite(wStarLin) ? wStarLin : p.aFs
    const dW = opts.deltaFs
    // #region core:gmacSlopeCrn
    const gauss = createZigguratNormal(createRng(deriveSeed(p.seed, 'fcw-slope')).fork(index))
    const dk = new Float64Array(B)
    let smf = 0
    const kDer = (bug ? 1 : 2) / p.sigmaV
    for (let j = 0; j < B; j++) {
      let gp = 0
      let gm = 0
      for (let n = 0; n < p.N; n++) {
        const i = skip + j * p.N + n
        const v = p.sigmaV * gauss()
        const ePlus = (p.aFs - (wc + dW)) * ux[i] + unl[i] + p.compOffsetFs + v
        const eMinus = (p.aFs - (wc - dW)) * ux[i] + unl[i] + p.compOffsetFs + v // ← 同一個 v：common random numbers
        const lo = bug ? 0 : -1
        gp += (ePlus >= 0 ? 1 : lo) * xr[i]
        gm += (eMinus >= 0 ? 1 : lo) * xr[i]
        const eDet = (p.aFs - wc) * ux[i] + unl[i] + p.compOffsetFs
        smf += xr[i] * ux[i] * kDer * normPdf(eDet / p.sigmaV)
      }
      dk[j] = (gp - gm) / p.N
    }
    smf /= B * p.N
    const ci = meanCI(dk) // 各 block 的差值 G₊ − G₋ 互相獨立 ⇒ Student-t 區間
    const S = -ci.mean / (2 * dW) // S = −∂E[G]/∂w ≈ −(G₊ − G₋)/(2Δw)
    // #endregion
    slope = { S, lo: -ci.hi / (2 * dW), hi: -ci.lo / (2 * dW), Smf: smf, Klin: K_, blocks: B }
  }
  // 閉迴路（可選）；定點時 twin 再用 quantize = false 跑一次同 seed 的迴路（只重跑迴路，序列分析不重算）
  let loop: FcwPoint['loop'] = null
  let twinLoop: FcwPoint['twinLoop'] = undefined
  if (opts.closedLoop) {
    const tauRef = pmux && mimo ? mimo.tauBlocks : tauBlocks
    const runLoop = (quantize: boolean): FcwLoop => {
      const Kb = opts.loopBlocks
      const half = Math.floor(Kb / 2)
      let m: BlockLmsMetrics
      let wArr: Float64Array
      let phos: number | null = null
      if (cfg) {
        const r = runBlockLms(quantize ? cfg : { ...cfg, gain_register: { ...cfg.gain_register, quantize_physical: false } })
        m = r.metrics
        wArr = r.blocks.w
      } else {
        const r = runLabLoop(pr as LabPrepared, { quantize })
        m = r.metrics
        wArr = r.w[pmux ? GOS_INDEX : 0]
        phos = pmux ? r.phosRmsFs : null
      }
      const drift = m.diverged ? NaN : (wArr[Kb] - wArr[half]) / Math.max(1, Kb - half)
      const converged = !m.diverged && m.settlingBlock !== null && m.settlingBlock <= half && Number.isFinite(tauRef) && tauRef < Kb / 6
      return { meanW: m.meanW, stdW: m.stdW, bias: m.bias, settlingBlock: m.settlingBlock, diverged: m.diverged, driftPerBlock: drift, converged, phosRmsFs: phos }
    }
    loop = runLoop(p.quantize)
    if (!loop.converged) warnings.push(`閉迴路 ${opts.loopBlocks} 個 block 內未收斂（$\\tau\\approx${texNum(tauRef, 3)}$ blocks）：mean $w$ 不是固定點的估計`)
    if (twin && p.quantize) twinLoop = runLoop(false)
  }
  return {
    frac,
    fracEff,
    K: first ? first.K : quantizeFcw(frac, p.dsmBits, p.dither).K,
    P,
    sawtooth: p.codeSource === 'dsm_first_order',
    periods: P > 0 ? L / P : NaN,
    splitRel,
    seqSamples: L,
    fracToneHz,
    C,
    CblockLms: an.Cest,
    K_,
    g,
    rho,
    stable,
    tauBlocks,
    pmDeg,
    signFlip: !(C > 0),
    peLambdaMin: emin,
    blockGainMin: bmin,
    blockGainMax: bmax,
    fracNegBlocks: nb > 0 ? neg / nb : NaN,
    Ex,
    Ex2,
    wStarLin,
    biasLin: wStarLin - p.aFs,
    wStarMf: an.wStarMeanField,
    sigmaWPred: an.sigmaWPred,
    sensRms,
    line1PerFs,
    tMag1,
    spurDbc,
    slope,
    loop,
    ...(twinLoop !== undefined ? { twinLoop } : {}),
    mimo,
    warnings,
  }
}

/** 9 權重 PE 的「幾乎為 0」門檻（相對於可觀測子空間的 λ_max） */
export const PE_FLOOR_REL = 1e-6

/** GMAC regressor（新引擎）：raw x、delayed x[n−D]、filtered Ĥ{x}[n−D] */
function regressorSeqLab(p: LabParams, design: PllDesign, x: Float64Array): Float64Array {
  if (p.regressor === 'raw') return x
  const hat = p.regressor === 'filtered' ? { b: new Array<number>(p.fxExtraDelay).fill(0).concat(design.H.b.map((v) => v * p.fxGain)), a: design.H.a.slice() } : null
  return delaySeq(hat ? filterSeq(hat, x) : x, p.codeDelay)
}

/**
 * FCW sweep 的一段（worker 可呼叫；UI 分段呼叫以顯示進度、可取消）。
 * twin = true 且定點、開閉迴路時，每點再用 quantize = false 跑一次同 seed 的迴路（只重跑迴路部分；序列統計、斜率 MC 不重算），
 * 回傳 twinPoints（與 points 一一對應，只有 loop 不同）給 Fixed-Point 欄做成對比較。
 */
export function sweepFcwChunk(p: { base: LabParams; fracs: number[]; opts: FcwSweepOptions; offset: number; twin?: boolean }): { points: FcwPoint[]; twinPoints?: FcwPoint[] } {
  const errs = labParamErrors({ ...p.base, blocks: Math.max(p.base.blocks, p.opts.loopBlocks), outBlocks: Math.min(p.base.outBlocks, p.opts.loopBlocks) })
  if (errs.length > 0) throw new Error(`參數不合法：\n${errs.join('\n')}`)
  const design = pllDesign(p.base)
  const twin = !!p.twin && p.base.quantize && p.opts.closedLoop
  const points = p.fracs.map((f, i) => fcwPoint(p.base, f, p.opts, design, p.offset + i, twin))
  if (!twin) return { points }
  const twinPoints = points.map((pt) => {
    const { twinLoop, ...rest } = pt
    return { ...rest, loop: twinLoop ?? null }
  })
  for (const pt of points) delete pt.twinLoop
  return { points, twinPoints }
}

// ───────────────────────────────────────────────────────────────────────────
// Monte Carlo（worker；分段）
// ───────────────────────────────────────────────────────────────────────────

export interface McChunk {
  seeds: number[]
  meanW: Float64Array
  stdW: Float64Array
  bias: Float64Array
  settling: Float64Array
  diverged: number
  /** 每個 block 的 Σw、Σw²（跨本段 runs；發散的 run 不計入，見 nValid） */
  wSum: Float64Array
  wSum2: Float64Array
  nValid: number
  analytic: BlockLmsAnalytic
  warnings: string[]
  /** mean-field 平均軌跡 ŵ_0…ŵ_K（只在 p.meanField 為 true 的那一段計算；其餘為 null） */
  meanField: Float64Array | null
  /** pmux8_gos：9 個權重的 per-run 統計（其餘 null） */
  mimo: McMimo | null
  /** twin = true 且定點時：同一段 seeds 的浮點對照（quantize = false；只重跑迴路） */
  twin?: McChunk
}

/** Monte Carlo 一段裡 9 個權重的統計（flatten：run r、權重 j 在 r·P + j；block k、權重 j 在 k·P + j） */
export interface McMimo {
  P: number
  names: string[]
  target: number[]
  meanW: Float64Array
  stdW: Float64Array
  /** 每個 run 後半段的 PHOS 殘差 RMS（去共模）[fs] */
  phosRms: Float64Array
  wSum: Float64Array
  wSum2: Float64Array
  /** mean-field 平均軌跡（只在第一段；(K+1)·P） */
  meanField: Float64Array | null
  analysis: MimoAnalysis
}

/**
 * 以指定 seeds 跑 runBlockLmsMonteCarlo（worker 可呼叫）；回傳可累加的和。
 * meanField = true 時另外算一次 mean-field twin（用 base.seed 的 code；一階 DSM / MASH 的 code 與 seed 無關，
 * dither / iid 的 code 各 seed 不同但統計相同），供跨 seeds 的平均與之比較。UI 只在第一段要求它。
 */
export function runMcChunk(p: { base: LabParams; seeds: number[]; meanField?: boolean; twin?: boolean }): McChunk {
  const errs = labParamErrors(p.base)
  if (errs.length > 0) throw new Error(`參數不合法：\n${errs.join('\n')}`)
  if (!usesLegacyEngine(p.base)) return runMcChunkLab(p)
  const cfg = toBlockLmsConfig(p.base, { record: { sample_trace_blocks: 0, decimate: 1 } })
  const K = p.base.blocks
  const wSum = new Float64Array(K + 1)
  const wSum2 = new Float64Array(K + 1)
  // 逐 seed 呼叫 runBlockLmsMonteCarlo（seeds 長度 1），才能排除發散的 run 而不讓 NaN 汙染整體
  const meanW = new Float64Array(p.seeds.length)
  const stdW = new Float64Array(p.seeds.length)
  const bias = new Float64Array(p.seeds.length)
  const settling = new Float64Array(p.seeds.length)
  let diverged = 0
  let nValid = 0
  let analytic: BlockLmsAnalytic | null = null
  let warnings: string[] = []
  const twin = !!p.twin && p.base.quantize
  const perSeedAnalytic: BlockLmsAnalytic[] = []
  p.seeds.forEach((s, r) => {
    const mc = runBlockLmsMonteCarlo({ config: cfg, seeds: [s] })
    if (!analytic) {
      analytic = mc.analytic
      warnings = mc.warnings
    }
    if (twin) perSeedAnalytic[r] = mc.analytic
    meanW[r] = mc.perRun.meanW[0]
    stdW[r] = mc.perRun.stdW[0]
    bias[r] = mc.perRun.bias[0]
    settling[r] = mc.perRun.settlingBlock[0]
    if (mc.perRun.diverged > 0) {
      diverged++
      return
    }
    nValid++
    for (let k = 0; k <= K; k++) {
      const w = mc.wMean[k]
      wSum[k] += w
      wSum2[k] += w * w
    }
  })
  const an = analytic as unknown as BlockLmsAnalytic
  const meanField = p.meanField && an ? meanFieldTwin({ config: cfg, normalization: an.normalization }).w : null
  const out: McChunk = { seeds: p.seeds.slice(), meanW, stdW, bias, settling, diverged, wSum, wSum2, nValid, analytic: an, warnings, meanField, mimo: null }
  if (twin) {
    // 同一段 seeds 的浮點對照：只差暫存器量化（comparator 雜訊、code、dither 都相同）。只重跑迴路——每個 seed 的
    // normalization 與解析量沿用上面 runBlockLms 已經算好的（不重掃 code、不重算 C、mean-field 固定點）；
    // 迴路用 runLabLoop（legacy、單一 gain 時與 runBlockLms 逐位元相同，unifiedLab.test.ts 守著）
    const design = pllDesign(p.base)
    const runs = p.seeds.map((seed, r) => runLabLoop(labPreparedFromAnalytic({ ...p.base, seed }, design, perSeedAnalytic[r]), { quantize: false }))
    out.twin = mcChunkFromLabRuns(p.seeds, runs, an, [], null, null)
  }
  return out
}

/**
 * 只為了重跑迴路而建的 LabPrepared（legacy、單一 gain）：normalization 與解析量直接取自同一個 seed 已經跑過的 runBlockLms，
 * 不再掃描 code。給 runMcChunk 的同 seed 浮點對照用。
 */
function labPreparedFromAnalytic(p: LabParams, design: PllDesign, analytic: BlockLmsAnalytic): LabPrepared {
  const hat = p.regressor === 'filtered' ? hatTransfer({ regressor_mode: 'filtered', filtered_x_model: { path: 'same_as_path', gain_mismatch: p.fxGain, extra_delay_samples: p.fxExtraDelay } } as BlockLmsConfig, design.H) : null
  return {
    p,
    design,
    N: p.N,
    K: p.blocks,
    D: p.regressor === 'raw' ? 0 : p.codeDelay,
    dUp: p.updateDelay,
    P: 1,
    target: [p.aFs],
    norm: { offset: analytic.normalization.offset, scale: analytic.normalization.scale },
    hat,
    analytic,
    mimo: null,
    warnings: [],
    assumptions: [],
    modelLevel: p.quantize ? 'L5' : 'L2',
  }
}

/** code 序列與 seed 無關（DSM 無 dither、不是 iid ±1、PMUX 不隨機旋轉）：每個 seed 的 prepareLab 結果相同，只差迴路裡的亂數 */
export function codeIndependentOfSeed(p: Pick<LabParams, 'codeSource' | 'dither' | 'architecture' | 'pmuxOrder'>): boolean {
  return p.codeSource !== 'iid_pm_one' && !p.dither && !(p.architecture === 'pmux8_gos' && p.pmuxOrder === 'random')
}

/** 由每個 seed 的 runLabLoop 結果組成一段 McChunk（runMcChunkLab 的主執行與 twin、legacy 的 twin 共用） */
function mcChunkFromLabRuns(seeds: number[], runs: LabLoopResult[], analytic: BlockLmsAnalytic, warnings: string[], pr0: LabPrepared | null, mf: LabLoopResult['meanField']): McChunk {
  const R = seeds.length
  const P = runs.length > 0 ? runs[0].P : 1
  const K = runs.length > 0 ? runs[0].w[0].length - 1 : 0
  const gIdx = P > 1 ? GOS_INDEX : 0
  const wSum = new Float64Array(K + 1)
  const wSum2 = new Float64Array(K + 1)
  const meanW = new Float64Array(R)
  const stdW = new Float64Array(R)
  const bias = new Float64Array(R)
  const settling = new Float64Array(R)
  const mm = P > 1 ? { meanW: new Float64Array(R * P), stdW: new Float64Array(R * P), phosRms: new Float64Array(R), wSum: new Float64Array((K + 1) * P), wSum2: new Float64Array((K + 1) * P) } : null
  let diverged = 0
  let nValid = 0
  runs.forEach((res, r) => {
    meanW[r] = res.metrics.meanW
    stdW[r] = res.metrics.stdW
    bias[r] = res.metrics.bias
    settling[r] = res.metrics.settlingBlock ?? NaN
    if (mm) {
      for (let j = 0; j < P; j++) {
        mm.meanW[r * P + j] = res.perWeight.meanW[j]
        mm.stdW[r * P + j] = res.perWeight.stdW[j]
      }
      mm.phosRms[r] = res.phosRmsFs
    }
    if (res.divergenceBlock !== null) {
      diverged++
      return
    }
    nValid++
    for (let k = 0; k <= K; k++) {
      const w = res.w[gIdx][k]
      wSum[k] += w
      wSum2[k] += w * w
      if (mm)
        for (let j = 0; j < P; j++) {
          const v = res.w[j][k]
          mm.wSum[k * P + j] += v
          mm.wSum2[k * P + j] += v * v
        }
    }
  })
  let meanField: Float64Array | null = null
  let mfAll: Float64Array | null = null
  if (mf) {
    meanField = mf.w[gIdx]
    if (mm) {
      mfAll = new Float64Array((K + 1) * P)
      for (let k = 0; k <= K; k++) for (let j = 0; j < P; j++) mfAll[k * P + j] = mf.w[j][k]
    }
  }
  return {
    seeds: seeds.slice(),
    meanW,
    stdW,
    bias,
    settling,
    diverged,
    wSum,
    wSum2,
    nValid,
    analytic,
    warnings,
    meanField,
    mimo: mm && pr0 && pr0.mimo ? { P, names: pr0.mimo.names, target: pr0.target, meanW: mm.meanW, stdW: mm.stdW, phosRms: mm.phosRms, wSum: mm.wSum, wSum2: mm.wSum2, meanField: mfAll, analysis: pr0.mimo } : null,
  }
}

/**
 * runMcChunk 的新引擎版本（spec 正負號／8 相 PMUX）：每個 seed 一次 runLabLoop；第一段另跑 mean-field（base.seed 的 code）。
 * prepare（normalization 預掃描、解析量、9 權重分析）每個 seed 只做一次，code 與 seed 無關時直接沿用 base.seed 的那一份（只換 seed）；
 * twin（定點時的同 seed 浮點對照）用同一份 prepare 只重跑迴路。
 */
function runMcChunkLab(p: { base: LabParams; seeds: number[]; meanField?: boolean; twin?: boolean }): McChunk {
  const base = p.base
  const design = pllDesign(base)
  const pr0 = prepareLab(base, design)
  const seedFree = codeIndependentOfSeed(base)
  const prepOf = (seed: number): LabPrepared => (seed === base.seed ? pr0 : seedFree ? { ...pr0, p: { ...pr0.p, seed } } : prepareLab({ ...base, seed }, design))
  const twin = !!p.twin && base.quantize
  const main: LabLoopResult[] = []
  const tw: LabLoopResult[] = []
  for (const seed of p.seeds) {
    const pr = prepOf(seed)
    main.push(runLabLoop(pr, { quantize: base.quantize }))
    if (twin) tw.push(runLabLoop(pr, { quantize: false })) // ← 只重跑迴路：同一份 prepare、同一串亂數，只差暫存器量化
  }
  const mf = p.meanField ? runLabLoop(pr0, { meanField: true }).meanField : null
  const out = mcChunkFromLabRuns(p.seeds, main, pr0.analytic, pr0.warnings, pr0, mf)
  if (twin) out.twin = mcChunkFromLabRuns(p.seeds, tw, pr0.analytic, pr0.warnings, pr0, null)
  return out
}

/** Monte Carlo 多段裡 9 個權重的合併：每個權重跨 seeds 的 mean w 95% CI、pooled σ、PHOS 殘差 RMS 的 CI、ensemble 軌跡 */
export interface McMimoSummary {
  P: number
  names: string[]
  target: number[]
  /**
   * 每個權重：跨 seeds 的 mean w、95% CI、Bonferroni（1 − 0.05/P）CI、pooled σ、bias。
   * 共模不可觀測（commonModeRemoved）時 PHOS 的值是「每個 run 先減掉 8 個 PHOS 的平均」之後的（目標 ε_p 本來就去共模）
   */
  perWeight: { meanW: number; lo: number; hi: number; loB: number; hiB: number; sigmaPooled: number; bias: number }[]
  /** PHOS 的統計是否先去共模（H_PD(1) = 0 ⇒ 共模不可觀測、沒有恢復力，跨 seeds 會散開） */
  commonModeRemoved: boolean
  phosRms: { mean: number; lo: number; hi: number }
  /** (K+1)·P 的跨 seeds 平均與標準差 */
  wMean: Float64Array
  wStd: Float64Array
  meanField: Float64Array | null
  analysis: MimoAnalysis
  valid: number
}

export function combineMcMimo(chunks: McChunk[]): McMimoSummary | null {
  const first = chunks.find((c) => c.mimo)?.mimo
  if (!first) return null
  const P = first.P
  const valid = chunks.reduce((s, c) => s + c.nValid, 0)
  const K1 = first.wSum.length / P
  const wMean = new Float64Array(K1 * P)
  const wStd = new Float64Array(K1 * P)
  for (let i = 0; i < K1 * P; i++) {
    let s = 0
    let s2 = 0
    for (const c of chunks) {
      if (!c.mimo) continue
      s += c.mimo.wSum[i]
      s2 += c.mimo.wSum2[i]
    }
    const m = valid > 0 ? s / valid : NaN
    wMean[i] = m
    wStd[i] = valid > 1 ? Math.sqrt(Math.max(0, (s2 - valid * m * m) / (valid - 1))) : NaN
  }
  const removeCM = P > 1 && !first.analysis.commonModeObservable
  const cmOf = (c: McChunk, r: number): number => {
    if (!removeCM || !c.mimo) return 0
    let cm = 0
    for (let j = 0; j < PMUX_PHASES; j++) cm += c.mimo.meanW[r * P + j]
    return cm / PMUX_PHASES
  }
  const perWeight = Array.from({ length: P }, (_, j) => {
    const mw: number[] = []
    const s2: number[] = []
    for (const c of chunks) {
      if (!c.mimo) continue
      for (let r = 0; r < c.seeds.length; r++) {
        const v = c.mimo.meanW[r * P + j] - (j < PMUX_PHASES ? cmOf(c, r) : 0)
        if (!Number.isFinite(v)) continue
        mw.push(v)
        s2.push(c.mimo.stdW[r * P + j] ** 2)
      }
    }
    const ci = mw.length >= 2 ? meanCI(mw) : { mean: mw[0] ?? NaN, lo: NaN, hi: NaN }
    const cb = mw.length >= 2 ? meanCI(mw, 1 - 0.05 / P) : { lo: NaN, hi: NaN } // 9 個權重同時檢查：Bonferroni
    const pooled = s2.length > 0 ? Math.sqrt(s2.reduce((a, b) => a + b, 0) / s2.length) : NaN
    return { meanW: ci.mean, lo: ci.lo, hi: ci.hi, loB: cb.lo, hiB: cb.hi, sigmaPooled: pooled, bias: ci.mean - first.target[j] }
  })
  const pr: number[] = []
  for (const c of chunks) if (c.mimo) for (let r = 0; r < c.seeds.length; r++) if (Number.isFinite(c.mimo.phosRms[r])) pr.push(c.mimo.phosRms[r])
  const pci = pr.length >= 2 ? meanCI(pr) : { mean: pr[0] ?? NaN, lo: NaN, hi: NaN }
  const mf = chunks.find((c) => c.mimo && c.mimo.meanField)?.mimo?.meanField ?? null
  return { P, names: first.names, target: first.target, perWeight, commonModeRemoved: removeCM, phosRms: { mean: pci.mean, lo: pci.lo, hi: pci.hi }, wMean, wStd, meanField: mf, analysis: first.analysis, valid }
}

/**
 * Monte Carlo 的 9 權重交叉比對：每個權重「mean w 的 95% CI（+1 LSB）」是否涵蓋 mean-field 同段預測；
 * PHOS 殘差 RMS 的 CI 是否涵蓋 mean-field 的預測。
 */
export function mcMimoChecks(s: McMimoSummary, p: LabParams): { meanW: CheckItem; phos: CheckItem } {
  const lsb = p.quantize ? p.lsbFs : 0
  if (!s.meanField || s.valid < 2) return { meanW: { status: 'n/a', note: s.valid < 2 ? '有效 runs 少於 2 個' : '沒有 mean-field 平均軌跡' }, phos: { status: 'n/a', note: '同上' } }
  const K1 = s.wMean.length / s.P
  const h0 = Math.ceil(K1 / 2)
  const half = (j: number): number => {
    let acc = 0
    for (let k = h0; k < K1; k++) acc += (s.meanField as Float64Array)[k * s.P + j]
    return acc / (K1 - h0)
  }
  // 與 combineMcMimo 一致：共模不可觀測時 mean-field 的 PHOS 也先去共模
  let cmMf = 0
  if (s.commonModeRemoved) {
    for (let j = 0; j < PMUX_PHASES; j++) cmMf += half(j)
    cmMf /= PMUX_PHASES
  }
  const bad: string[] = []
  for (let j = 0; j < s.P; j++) {
    const pred = half(j) - (j < PMUX_PHASES ? cmMf : 0)
    const w = s.perWeight[j]
    if (!(Number.isFinite(w.loB) && Number.isFinite(w.hiB))) continue
    if (pred < w.loB - lsb || pred > w.hiB + lsb) bad.push(s.names[j])
  }
  const lvl = `$1-0.05/${s.P}$`
  const cmNote = s.commonModeRemoved ? '；PHOS 先去共模（共模經 $H_{\\mathrm{PD}}(1)=0$ 不可觀測）' : ''
  const meanW: CheckItem = bad.length === 0 ? { status: 'ok', note: `${s.P} 個權重後半段 mean $w$ 的 Bonferroni CI（每個權重 ${lvl}，整體 95%${lsb > 0 ? '；再放寬 $\\pm1$ LSB' : ''}${cmNote}）都涵蓋 mean-field 同段預測` } : { status: 'mismatch', note: `${bad.length} 個權重的 Bonferroni CI（每個權重 ${lvl}）不含 mean-field 同段預測${cmNote}：$${bad.join(',\\ ')}$` }
  // PHOS 殘差 RMS：mean-field 的預測（沒有雜訊的下界）＋後半段平均本身的估計雜訊（上界）。
  // 每個 run 的 PHOS 殘差是「後半段平均 − ε」，平均只取 m 個 block，所以就算平均模型的偏差是 0，殘差 RMS 也有
  // √(mean_j Var(w̄_j)) 的量級；Var(w̄_j) 用 dlyap 的 σ_j 與 9 權重平均模型最慢的 ρ（AR(1)，偏大 ⇒ 上界）。
  const r = Array.from({ length: PMUX_PHASES }, (_, j) => half(j) - s.target[j])
  const cm = r.reduce((a, b) => a + b, 0) / PMUX_PHASES
  const predRms = Math.sqrt(r.reduce((a, v) => a + (v - cm) * (v - cm), 0) / PMUX_PHASES)
  const mHalf = K1 - h0
  const rhoA = Math.min(Math.abs(Number.isFinite(s.analysis.rho) ? s.analysis.rho : 0.999), 0.999999)
  const sp = s.analysis.sigmaPred
  const noiseVar = sp ? sp.slice(0, PMUX_PHASES).reduce((a, v) => a + ar1MeanVar(v * v, rhoA, mHalf), 0) / PMUX_PHASES : NaN
  const predHi = Number.isFinite(noiseVar) ? Math.sqrt(predRms * predRms + noiseVar) : predRms
  const okP = Number.isFinite(s.phosRms.lo) && s.phosRms.hi >= predRms * 0.85 - lsb && s.phosRms.lo <= predHi * 1.15 + lsb
  const phos: CheckItem = {
    status: Number.isFinite(s.phosRms.lo) ? (okP ? 'ok' : 'mismatch') : 'n/a',
    value: s.phosRms.mean,
    analytic: predHi,
    note: `PHOS 殘差 RMS（去共模）跨 seeds 的 95% CI $[${texNum(s.phosRms.lo)},\\,${texNum(s.phosRms.hi)}]\\,\\mathrm{fs}$ 要和預測帶 $[${texNum(predRms)},\\,${texNum(predHi)}]\\,\\mathrm{fs}$ 重疊（下界 = mean-field 同段的偏差、上界再加上後半段平均的估計雜訊 $\\sqrt{\\overline{\\mathrm{Var}(\\bar w_p)}}$；放寬 $\\pm15\\%$${lsb > 0 ? '、1 LSB' : ''}）`,
  }
  return { meanW, phos }
}

/** MC 的 seeds：deriveSeed(seed, i)，與 runBlockLmsMonteCarlo 的預設相同。 */
export function mcSeeds(seed: number, from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => deriveSeed(seed, from + i))
}

export interface McSummary {
  runs: number
  valid: number
  diverged: number
  divergedCI: { lo: number; hi: number }
  meanW: { mean: number; lo: number; hi: number; halfWidth: number }
  bias: { mean: number; lo: number; hi: number }
  /** √(mean σ²_run) 與其 95% CI（per-run 變異數的 t 區間開根號） */
  sigmaW: { pooled: number; lo: number; hi: number }
  settling: { mean: number; lo: number; hi: number; neverSettled: number }
  /** 跨 runs 的每 block 平均與標準差 */
  wMean: Float64Array
  wStd: Float64Array
  perRunMeanW: Float64Array
  perRunStdW: Float64Array
}

/** 合併多段 MC（純函式；主執行緒）。 */
export function combineMc(chunks: McChunk[]): McSummary {
  const runs = chunks.reduce((s, c) => s + c.seeds.length, 0)
  const valid = chunks.reduce((s, c) => s + c.nValid, 0)
  const diverged = chunks.reduce((s, c) => s + c.diverged, 0)
  const K1 = chunks.length > 0 ? chunks[0].wSum.length : 0
  const wMean = new Float64Array(K1)
  const wStd = new Float64Array(K1)
  for (let k = 0; k < K1; k++) {
    let s = 0
    let s2 = 0
    for (const c of chunks) {
      s += c.wSum[k]
      s2 += c.wSum2[k]
    }
    const m = valid > 0 ? s / valid : NaN
    wMean[k] = m
    wStd[k] = valid > 1 ? Math.sqrt(Math.max(0, (s2 - valid * m * m) / (valid - 1))) : NaN
  }
  const mw: number[] = []
  const sw: number[] = []
  const bi: number[] = []
  const st: number[] = []
  let never = 0
  for (const c of chunks) {
    for (let r = 0; r < c.seeds.length; r++) {
      if (!Number.isFinite(c.meanW[r])) continue
      mw.push(c.meanW[r])
      sw.push(c.stdW[r])
      bi.push(c.bias[r])
      if (Number.isFinite(c.settling[r])) st.push(c.settling[r])
      else never++
    }
  }
  const ci = mw.length >= 2 ? meanCI(mw) : { mean: mw[0] ?? NaN, lo: NaN, hi: NaN, halfWidth: NaN }
  const bci = bi.length >= 2 ? meanCI(bi) : { mean: bi[0] ?? NaN, lo: NaN, hi: NaN }
  const v2 = sw.map((s) => s * s)
  const vci = v2.length >= 2 ? meanCI(v2) : { mean: v2[0] ?? NaN, lo: NaN, hi: NaN }
  const sci = st.length >= 2 ? meanCI(st) : { mean: st[0] ?? NaN, lo: NaN, hi: NaN }
  const dci = runs > 0 ? wilsonCI(diverged, runs) : { lo: NaN, hi: NaN }
  return {
    runs,
    valid,
    diverged,
    divergedCI: { lo: dci.lo, hi: dci.hi },
    meanW: { mean: ci.mean, lo: ci.lo, hi: ci.hi, halfWidth: ci.halfWidth },
    bias: { mean: bci.mean, lo: bci.lo, hi: bci.hi },
    sigmaW: { pooled: Math.sqrt(vci.mean), lo: Math.sqrt(Math.max(0, vci.lo)), hi: Math.sqrt(Math.max(0, vci.hi)) },
    settling: { mean: sci.mean, lo: sci.lo, hi: sci.hi, neverSettled: never },
    wMean,
    wStd,
    perRunMeanW: Float64Array.from(mw),
    perRunStdW: Float64Array.from(sw),
  }
}

/**
 * MC 交叉比對（與 pipelineChecks 相同的線性預測；transient 算進預測）：
 *   meanField：mean-field twin 的軌跡（runMcChunk 的 meanField；沒有時退回線性時不變模型）。
 *   mean w：跨 runs 的 95% CI（加 1 LSB 量化容差）是否涵蓋「後半段預測平均」；
 *   σ_w：per-run 後半段 std² 的 CI（放寬 ±15% 模型近似）是否涵蓋 halfRms² + 預測軌跡在後半段的變異；
 *   發散：與平均模型的穩定性預測是否一致。
 */
export function mcChecks(
  s: McSummary,
  an: BlockLmsAnalytic,
  p: LabParams,
  meanField?: ArrayLike<number> | null,
): { meanW: CheckItem; sigmaW: CheckItem; divergence: CheckItem; lin: LinearPrediction } {
  const lsb = p.quantize ? p.lsbFs : 0
  const lin = linearPrediction(an, p, p.blocks, meanField)
  const modelName = lin.model === 'mean-field' ? 'mean-field 平均軌跡' : '線性平均模型'
  let meanW: CheckItem
  if (s.valid < 2 || !lin.valid) {
    meanW = { status: 'n/a', note: s.valid < 2 ? '有效 runs 少於 2 個，沒有信賴區間' : lin.reason }
  } else {
    const ok = lin.halfMean >= s.meanW.lo - lsb && lin.halfMean <= s.meanW.hi + lsb
    meanW = {
      status: ok ? 'ok' : 'mismatch',
      value: s.meanW.mean,
      analytic: lin.halfMean,
      tolerance: s.meanW.halfWidth + lsb,
      note: `後半段 mean $w$ 的 95% CI $[${texNum(s.meanW.lo, 6)},\\,${texNum(s.meanW.hi, 6)}]$${lsb > 0 ? '（再放寬 $\\pm1$ LSB）' : ''} vs「${modelName}」同段預測 $${texNum(lin.halfMean, 6)}\\,\\mathrm{fs}$`,
    }
  }
  let sigmaW: CheckItem
  if (s.valid < 2 || !lin.valid || !(lin.halfRms > 0)) sigmaW = { status: 'n/a', note: lin.valid ? '沒有 $\\sigma_w$ 預測或 runs 不足' : lin.reason }
  else if (p.quantize && p.lsbFs > 2 * an.sigmaWPred) sigmaW = { status: 'n/a', note: '$\\Delta>2\\sigma_{w,\\mathrm{pred}}$：量化主導，線性預測不適用' }
  else {
    const pred = Math.sqrt(lin.halfRms * lin.halfRms + lin.halfTrajVar)
    const lo = s.sigmaW.lo * 0.85
    const hi = s.sigmaW.hi * 1.15
    const ok = pred >= lo && pred <= hi
    sigmaW = {
      status: ok ? 'ok' : 'mismatch',
      value: s.sigmaW.pooled,
      analytic: pred,
      note: `pooled $\\sigma_w$ 的 95% CI $[${texNum(s.sigmaW.lo)},\\,${texNum(s.sigmaW.hi)}]\\,\\mathrm{fs}$（放寬 $\\pm15\\%$）vs 預測 $${texNum(pred)}\\,\\mathrm{fs}$（穩態 $${texNum(an.sigmaWPred)}\\,\\mathrm{fs}$${lin.halfTrajVar > 0.01 * lin.halfRms * lin.halfRms ? '，另含平均軌跡自己在後半段的起伏：未衰減完的 transient 或隨 code 擺動的固定點' : ''}）`,
    }
  }
  const divergence: CheckItem =
    s.diverged === 0
      ? { status: an.stableMean ? 'ok' : 'mismatch', note: an.stableMean ? '沒有 run 發散，與平均模型穩定一致' : '平均模型預測不穩定，但沒有 run 數值發散（sign-LMS 的 $G$ 有界，表現為大振幅 limit cycle）' }
      : { status: an.stableMean ? 'mismatch' : 'ok', note: `${s.diverged}/${s.runs} 個 runs 發散（95% Wilson CI $[${texNum(100 * s.divergedCI.lo, 3)}\\%,\\,${texNum(100 * s.divergedCI.hi, 3)}\\%]$）` }
  return { meanW, sigmaW, divergence, lin }
}

// ───────────────────────────────────────────────────────────────────────────
// Training Sequence Lab
// ───────────────────────────────────────────────────────────────────────────

export type Randomization = 'none' | 'pm1' | 'uniform'

export interface TrainingPatternSpec {
  source: CodeSourceKind
  frac: number
  dsmBits: number
  dither: boolean
  /** 已知的 code randomization overlay r[n]（研究延伸，行為模型；不是特定晶片） */
  randomization: Randomization
  /** overlay 振幅 [T_vco]（DTC 需要額外 ±A 的範圍） */
  randAmp: number
  normalization: CodeNormalization
}

export interface TrainingParams {
  seed: number
  fRefHz: number
  nInt: number
  pll: PllKind
  pllBwHz: number
  zeta: number
  loopDelay: number
  regressor: RegressorMode
  codeDelay: number
  sigmaV: number
  /** 序列長度與 PE 視窗 N₀ */
  length: number
  N0: number
  maxLag: number
  maxDelay: number
  /** 靜態殘差（spur 分析）：gain 誤差 Δa、c₂、c₃ [fs] */
  residualGainFs: number
  c2: number
  c3: number
  basis: { gain: boolean; inl2: boolean; inl3: boolean; offset: boolean }
  patterns: TrainingPatternSpec[]
}

export const DEFAULT_TRAINING_PATTERN: TrainingPatternSpec = {
  source: 'dsm_first_order',
  frac: 1e-3,
  dsmBits: 20,
  dither: false,
  randomization: 'none',
  randAmp: 1,
  normalization: 'standardize',
}

export interface TrainingPatternResult {
  label: string
  spec: TrainingPatternSpec
  /** 原始 overlay 後的 code 統計（T_vco） */
  rawMean: number
  rawStd: number
  rawRange: [number, number]
  period: number
  /** 正規化後 PSD（one-sided，(unit)²/Hz，對數抽樣）與 Welch 設定 */
  psd: { f: Float64Array; psd: Float64Array; nperseg: number; enbwHz: number }
  /** 正規化自相關 R_x[ℓ]/R_x[0]（去平均），ℓ = 0…maxLag */
  acf: Float64Array
  /** C_D = E[x_ref^(D)·u_x]，D = 0…maxDelay（GMAC regressor 依模式） */
  cd: Float64Array
  bestD: number
  /** 多參數 Jacobian：J = K_q·E[ψ φ_uᵀ]（欄、列 = 選取的基底），scaled 版本做 SVD */
  basisNames: string[]
  /** 同上，TeX 版（表格標頭用） */
  basisTex: string[]
  J: number[][]
  svScaled: number[]
  rank: number
  condScaled: number
  eigJ: { re: number; im: number }[]
  minReEig: number
  /** u-domain 資訊矩陣 R_u（scaled）的 λ_min 與滑動視窗最小 λ_min（PE） */
  ruLambdaMin: number
  peWindowLambdaMin: number
  /** 這組 code 的輸出頻率 (N_int + α_eff)·f_ref [Hz]（tones 的 dBc 用它換算） */
  fOutHz: number
  /** 靜態殘差經 T 後的 output：RMS、tones */
  outRms: number
  tones: ToneReport[]
  /** 一階封閉式對照（非 null 時） */
  closedForm: { mean: number; meanSquare: number; line1: number; line1Sim: number; meanSim: number; meanSquareSim: number } | null
  warnings: string[]
}

export interface TrainingResult {
  pll: PllDesign
  fOutHz: number
  patterns: TrainingPatternResult[]
  warnings: string[]
}

const BASIS_LABEL = { gain: 'gain（x）', inl2: 'INL₂（x²）', inl3: 'INL₃（x³）', offset: 'offset（1）' } as const
const BASIS_TEX = { gain: 'x', inl2: 'x^2', inl3: 'x^3', offset: '1' } as const

function patternLabel(s: TrainingPatternSpec): string {
  const src = s.source === 'iid_pm_one' ? 'iid ±1' : s.source === 'mash111' ? `MASH 1-1-1 frac=${s.frac}` : `一階 DSM frac=${s.frac}`
  const di = s.dither ? '+dither' : ''
  const rnd = s.randomization === 'none' ? '' : ` + 隨機化 ${s.randomization === 'pm1' ? '±' : 'U'}${s.randAmp}`
  return `${src}${di}${rnd}`
}

/** 產生 raw code（T_vco）：DSM residue（或 iid ±1）加上已知的隨機化 overlay。 */
function trainingRaw(spec: TrainingPatternSpec, seed: number, L: number): { raw: Float64Array; warnings: string[] } {
  const warnings: string[] = []
  const raw = new Float64Array(L)
  const rng = createRng(seed).fork('training-code')
  if (spec.source === 'iid_pm_one') {
    for (let i = 0; i < L; i++) raw[i] = (rng.uint32() >>> 31) === 1 ? 1 : -1
  } else {
    const s = new DsmStream({ kind: spec.source === 'mash111' ? 'mash111' : 'first_order', frac: spec.frac, bits: spec.dsmBits, dither: spec.dither }, rng.fork('dsm-dither'))
    for (let i = 0; i < L; i++) {
      s.step()
      raw[i] = s.residue
    }
  }
  if (spec.randomization !== 'none' && spec.randAmp > 0) {
    // #region core:codeRandomization
    // 已知的 overlay：DTC code = residue + A·r[n]，r[n] 已知（由 divider / 數位端補償整數個 T_vco）。
    // 對 GMAC 而言它是額外、與 residue 無關的激勵（PE ↑），代價是 DTC 範圍 +2A·T_vco、INL 暴露更多 code。
    const rr = rng.fork('randomization')
    for (let i = 0; i < L; i++) {
      const r = spec.randomization === 'pm1' ? ((rr.uint32() >>> 31) === 1 ? 1 : -1) : 2 * rr.uniform() - 1
      raw[i] += spec.randAmp * r // ← 差異：加上已知亂數（研究延伸，行為模型）
    }
    // #endregion
    warnings.push(
      `code randomization 是行為模型（研究延伸）：假設 overlay 已知且被數位端完整補償；DTC 範圍需要多 $\\pm${spec.randAmp}\\,T_{\\mathrm{vco}}$，INL 暴露的 code 也變多。注意它是「加」在 residue 上：鋸齒本身還在，以 $T_{\\mathrm{vco}}$ 計的 fractional 譜線振幅 $A_1$ 沒有變小；下表的 tone 比較低，是因為正規化的 scale $s$ 變小了（同樣 $\\Delta a$ fs per unit code 對應到較小的實體 gain 誤差），而且 overlay 自己會在輸出多出一層寬頻雜訊。`,
    )
  }
  return { raw, warnings }
}

/** 以 stats 段（skip 之後）的統計決定正規化，套用到整段（含 skip）。 */
function normalizeRaw(raw: Float64Array, skip: number, mode: CodeNormalization): { x: Float64Array; offset: number; scale: number } {
  const seg = raw.subarray(skip)
  const m = meanOf(seg)
  let ms = 0
  for (let i = 0; i < seg.length; i++) ms += seg[i] * seg[i]
  ms /= seg.length
  const np = normalizationParams({ mean: m, rms: Math.sqrt(ms), std: Math.sqrt(Math.max(0, ms - m * m)) }, mode)
  const x = new Float64Array(raw.length)
  for (let i = 0; i < raw.length; i++) x[i] = (raw[i] - np.offset) * np.scale
  return { x, offset: np.offset, scale: np.scale }
}

// #region core:jacobian
/**
 * 多參數線性化：參數 θ_j 透過基底 φ_j(x) 進入 DTC 誤差，PD 看到 φ_{u,j} = H_PD{φ_j}；
 * GMAC 第 i 個相關器用 regressor ψ_i（raw / delayed / filtered）。Gaussian comparator 小訊號下
 *   E[G_i] ≈ K_q·Σ_j E[ψ_i φ_{u,j}]·δθ_j  ⇒  J_ij = K_q·E[ψ_i φ_{u,j}]（δ = a − w ⇒ J 的特徵值實部 > 0 才收斂）。
 * 可辨識性看 scaled J 的奇異值（每個基底先除以自己的 RMS，避免單位造成假的 rank 判斷）。
 */
export function trainingJacobian(phi: Float64Array[], phiU: Float64Array[], psi: Float64Array[], Kq: number, skip: number): { J: Matrix; Js: Matrix; Ru: Matrix } {
  const P = phi.length
  const L = phi[0].length - skip
  const rms = phi.map((v) => {
    let s = 0
    for (let i = skip; i < v.length; i++) s += v[i] * v[i]
    return Math.sqrt(s / L) || 1
  })
  const J: Matrix = []
  const Js: Matrix = []
  const Ru: Matrix = []
  for (let i = 0; i < P; i++) {
    J.push([])
    Js.push([])
    Ru.push([])
    for (let j = 0; j < P; j++) {
      let c = 0
      let r = 0
      for (let n = skip; n < phi[0].length; n++) {
        c += psi[i][n] * phiU[j][n]
        r += phiU[i][n] * phiU[j][n]
      }
      J[i].push((Kq * c) / L)
      Js[i].push(c / L / (rms[i] * rms[j])) // ← scaled：無因次，K_q 不影響秩
      Ru[i].push(r / L / (rms[i] * rms[j]))
    }
  }
  return { J, Js, Ru }
}
// #endregion

/** 滑動（不重疊）視窗的 λ_min(R_u)：§9.1 的有限窗口 PE。 */
function windowLambdaMin(phiU: Float64Array[], rms: number[], skip: number, N0: number): number {
  const P = phiU.length
  const L = phiU[0].length
  let best = Infinity
  for (let s = skip; s + N0 <= L; s += N0) {
    const R: Matrix = Array.from({ length: P }, () => new Array<number>(P).fill(0))
    for (let n = s; n < s + N0; n++) for (let i = 0; i < P; i++) for (let j = i; j < P; j++) R[i][j] += phiU[i][n] * phiU[j][n]
    for (let i = 0; i < P; i++)
      for (let j = i; j < P; j++) {
        R[i][j] /= N0 * rms[i] * rms[j]
        R[j][i] = R[i][j]
      }
    const ev = eigSym(R).values
    best = Math.min(best, ev[ev.length - 1])
  }
  return best
}

/** Training Sequence 分析（worker 可呼叫）。 */
export function analyzeTraining(tp: TrainingParams): TrainingResult {
  if (!(Number.isInteger(tp.length) && tp.length >= 4096 && tp.length <= 1 << 20)) throw new Error('序列長度 length 必須是 4096 … 2^20 的整數')
  if (tp.patterns.length < 1 || tp.patterns.length > 3) throw new Error('patterns 需要 1–3 組')
  if (!(Number.isInteger(tp.N0) && tp.N0 >= 16 && tp.N0 <= tp.length)) throw new Error('PE 視窗 N0 必須是 16 … length 的整數')
  if (!(Number.isInteger(tp.maxLag) && tp.maxLag >= 1 && tp.maxLag <= 4096)) throw new Error('maxLag 必須是 1 … 4096 的整數')
  if (!(Number.isInteger(tp.maxDelay) && tp.maxDelay >= 0 && tp.maxDelay <= 4096)) throw new Error('maxDelay 必須是 0 … 4096 的整數')
  if (tp.pllBwHz >= tp.fRefHz / 2) throw new Error('PLL 頻寬必須小於 f_ref/2（Nyquist）')
  const design = pllDesign({ pll: tp.pll, pllBwHz: tp.pllBwHz, fRefHz: tp.fRefHz, zeta: tp.zeta, loopDelay: tp.loopDelay })
  const Kq = tp.sigmaV > 0 ? SQRT_2_OVER_PI / tp.sigmaV : 1
  // 先讓主 PLL 濾波器的暫態（含 offset 基底的 step response）衰減掉
  const skip = pllSettleSamples(design, Math.min(4096, Math.floor(tp.length / 8)), Math.floor(tp.length / 2))
  const keys = (['gain', 'inl2', 'inl3', 'offset'] as const).filter((k) => tp.basis[k])
  if (keys.length === 0) throw new Error('至少選一個基底')
  const fOutHz = (tp.nInt + tp.patterns[0].frac) * tp.fRefHz
  const out: TrainingPatternResult[] = tp.patterns.map((spec, pi) => {
    const L = skip + tp.length
    // 這組 code 自己的輸出頻率（dBc 換算用）：DSM 用量化後的 α_eff；iid 參考 code 沿用名目 frac
    const patFOut = (tp.nInt + (spec.source === 'iid_pm_one' ? spec.frac : quantizeFcw(spec.frac, spec.dsmBits, spec.dither).fracEff)) * tp.fRefHz
    const { raw, warnings } = trainingRaw(spec, deriveSeed(tp.seed, pi), L)
    const { x: xs } = normalizeRaw(raw, skip, spec.normalization)
    let rmin = Infinity
    let rmax = -Infinity
    for (let i = skip; i < L; i++) {
      if (raw[i] < rmin) rmin = raw[i]
      if (raw[i] > rmax) rmax = raw[i]
    }
    const rawSeg = raw.subarray(skip)
    const rawMean = meanOf(rawSeg)
    const rawStd = Math.sqrt(varOf(rawSeg, rawMean))
    const period = spec.dither || spec.randomization !== 'none' || spec.source === 'iid_pm_one' ? 0 : detectPeriod(rawSeg, { start: rawSeg.length >> 2 })
    // PSD
    const seg = xs.subarray(skip)
    const nper = Math.min(seg.length, 1 << 14)
    const ws = welch(seg, tp.fRefHz, { window: 'hann', nperseg: nper })
    const psd = logDecimateMax(ws.f, ws.psd, 900)
    // 自相關（去平均）
    const xm = meanOf(seg)
    const acf = new Float64Array(tp.maxLag + 1)
    for (let l = 0; l <= tp.maxLag; l++) {
      let s = 0
      for (let i = l; i < seg.length; i++) s += (seg[i] - xm) * (seg[i - l] - xm)
      acf[l] = s / seg.length
    }
    const a0 = acf[0] || 1
    for (let l = 0; l <= tp.maxLag; l++) acf[l] /= a0
    // u_x、regressor、C_D
    const ux = filterSeq(design.H, xs)
    const base = tp.regressor === 'filtered' ? filterSeq(design.H, xs) : xs
    const cd = new Float64Array(tp.maxDelay + 1)
    let bestD = 0
    for (let D = 0; D <= tp.maxDelay; D++) {
      let s = 0
      for (let i = skip; i < L; i++) s += (i - D >= 0 ? base[i - D] : 0) * ux[i]
      cd[D] = s / tp.length
      if (cd[D] > cd[bestD]) bestD = D
    }
    // Jacobian
    const Dm = tp.regressor === 'raw' ? 0 : tp.codeDelay
    const phi: Float64Array[] = keys.map((k) => {
      const v = new Float64Array(L)
      for (let i = 0; i < L; i++) v[i] = k === 'gain' ? xs[i] : k === 'inl2' ? xs[i] * xs[i] : k === 'inl3' ? xs[i] * xs[i] * xs[i] : 1
      return v
    })
    const phiU = phi.map((v) => filterSeq(design.H, v))
    const psi = phi.map((v, j) => {
      if (tp.regressor === 'raw') return v
      const b = tp.regressor === 'filtered' ? phiU[j] : v
      return delaySeq(b, Dm)
    })
    const { J, Js, Ru } = trainingJacobian(phi, phiU, psi, Kq, skip)
    const sv = svd(Js).S
    const smax = sv[0] || 0
    const rank = sv.filter((s) => s > 1e-6 * smax).length
    const condScaled = sv[sv.length - 1] > 0 ? smax / sv[sv.length - 1] : Infinity
    const ev = eigvals(J).map((z) => ({ re: z.re, im: z.im }))
    const minReEig = ev.reduce((m, z) => Math.min(m, z.re), Infinity)
    const ruEv = eigSym(Ru).values
    const rms = phi.map((v) => {
      let s = 0
      for (let i = skip; i < L; i++) s += v[i] * v[i]
      return Math.sqrt(s / tp.length) || 1
    })
    const peWindowLambdaMin = windowLambdaMin(phiU, rms, skip, tp.N0)
    // 靜態殘差 → T → output tones
    const eSt = new Float64Array(L)
    for (let i = 0; i < L; i++) eSt[i] = tp.residualGainFs * xs[i] + xs[i] * xs[i] * (tp.c2 + tp.c3 * xs[i])
    const tOut = filterSeq(design.T, eSt).subarray(skip)
    const outRms = Math.sqrt(varOf(tOut))
    const nt = Math.min(tOut.length, 1 << 15)
    const wbh = welch(tOut, tp.fRefHz, { window: 'blackmanHarris', nperseg: nt })
    const tones: ToneReport[] = significantTones(wbh.psd, findTones(wbh.f, wbh.psd, { minProminenceDb: 15, maxTones: 24, fMin: 2 * wbh.df }), wbh.nSegments)
      .slice(0, 6)
      .map((t) => makeTone(t.fCentroid, Math.sqrt(2 * t.power), patFOut, 'findTones'))
    // 一階封閉式
    let closedForm: TrainingPatternResult['closedForm'] = null
    if (spec.source === 'dsm_first_order' && !spec.dither && spec.randomization === 'none') {
      const st = firstOrderResidueStats(spec.frac, spec.dsmBits)
      if (st.P >= 2) {
        const f1 = foldFrequency(st.fracEff * tp.fRefHz, tp.fRefHz)
        const fit = toneFit(rawSeg, tp.fRefHz, f1)
        let ms = 0
        for (let i = 0; i < rawSeg.length; i++) ms += rawSeg[i] * rawSeg[i]
        closedForm = { mean: st.mean, meanSquare: st.meanSquare, line1: st.line1, line1Sim: fit.amplitudePeak, meanSim: rawMean, meanSquareSim: ms / rawSeg.length }
        if (rawSeg.length / st.P < 16) warnings.push(`序列只涵蓋 $${texNum(rawSeg.length / st.P, 3)}$ 個週期：封閉式對照只供參考`)
      }
    }
    if (design.hpdDc < 1e-9 && tp.basis.offset) {
      warnings.push('$H_{\\mathrm{PD}}(1)=0$：offset 基底經主迴路後在穩態完全看不到（$u_{\\mathrm{offset}}\\to0$），$J$ 少一個秩——這是結構性的不可辨識，不是樣本不夠（E04）。')
    }
    if (rank < keys.length) warnings.push(`scaled $J$ 的數值秩 $${rank}<${keys.length}$（參數個數）：$\\lambda_{\\min}=0$，至少一個方向不可辨識，Preconditioner 也救不回來（§10）。`)
    if (minReEig <= 0) warnings.push(`$J$ 有實部 $\\le0$ 的特徵值（$\\min\\mathrm{Re}\\,\\lambda=${texNum(minReEig)}$）：$M=\\mu I$ 的多參數更新在該方向極性錯誤或沒有恢復力。`)
    return {
      label: patternLabel(spec),
      spec,
      rawMean,
      rawStd,
      rawRange: [rmin, rmax],
      period,
      psd: { f: psd.f, psd: psd.psd, nperseg: nper, enbwHz: ws.enbwHz },
      acf,
      cd,
      bestD,
      basisNames: keys.map((k) => BASIS_LABEL[k]),
      basisTex: keys.map((k) => BASIS_TEX[k]),
      J,
      svScaled: sv,
      rank,
      condScaled,
      eigJ: ev,
      minReEig,
      ruLambdaMin: ruEv[ruEv.length - 1],
      peWindowLambdaMin,
      fOutHz: patFOut,
      outRms,
      tones,
      closedForm,
      warnings,
    }
  })
  const warnings = design.warnings.slice()
  return { pll: design, fOutHz, patterns: out, warnings }
}

/** 單一 t 分位數（供 UI 顯示 CI 寬度用） */
export function tQuantile95(n: number): number {
  return n >= 2 ? studentTInv(0.975, n - 1) : NaN
}

// ───────────────────────────────────────────────────────────────────────────
// 使用者的架構（wave 5）：regressor 正負號、8 相 PMUX + GOS 的 9 個權重、同一份引擎
// ───────────────────────────────────────────────────────────────────────────
//
// 既有的組合（regressorSign = 'legacy' 且 architecture = 'gos_only'）仍由 blockLms.ts 的 runBlockLms 執行（數字一位都不變）。
// 其他組合走本節的 runLabLoop：同一個 inner loop 推廣成 P 個權重（P = 1 或 9）、兩種正負號；P = 1、legacy 時與 runBlockLms 逐位元相同
// （unifiedLab.test.ts 守著），'spec' 時與「a、w₀、c₃ 變號的 legacy」鏡像相同（IEEE 的負號對稱性）。
//
// pmux8_gos 的訊號（docs/assumptions.md §2a 第 6 點、案例頁 §2、analysis/sspll/sim/README.md §1.2）：
//   分數相位以 Δ = T_vco/8 為單位：DSM 跑在 8α 的小數部分，PMUX 總指標 P[n] = ⌊8α⌋(n+1) + Σ_{m≤n} y[m]，相位 p[n] = P[n] mod 8，
//   DTC 只補一個相位步以內的量 c[n] = −r′[n] ∈ [0, 1)（一階）；'spec' 的 x = c、'legacy' 的 x = −c。
//   PD 看到 e_DTC[n] = (a − w_g,app)·x[n] + (ε_{p[n]} − w_{p[n],app}) + d(x)：GOS 的 regressor 是 x_ref，PHOS 的是 one-hot 1{p[n−D] = j}。
//   權重向量 θ = [w_0…w_7（PHOS，fs）, w_g（GOS，fs per Δ）]，目標 [ε_0…ε_7, a]；更新 w_j ← w_j + μ_j G_j（μ_p 給 PHOS、μ 給 GOS）。
//   共模 Σ_j 1_j = 1 經 H_PD(1) = 0 的迴路後不可觀測（E04 的結構性 null）：條件數與 PE 都在可觀測子空間上算（mimo.ts observableEigen）。

/** PMUX 相位數與權重數；GOS 放在最後一個 index */
export const PMUX_PHASES = 8
export const PMUX_WEIGHTS = PMUX_PHASES + 1
export const GOS_INDEX = PMUX_PHASES

/**
 * PHOS 的固定圖樣（illustrative）：analysis/sspll/sim 的 seed-7 offset [+29, +103, −40, −194, −85, −219, +43, +364] fs
 * 去共模後正規化成 RMS = 1；ε_p = phosRmsFs · PHOS_PATTERN[p]。
 */
export const PHOS_PATTERN: readonly number[] = (() => {
  const raw = [29, 103, -40, -194, -85, -219, 43, 364]
  const m = raw.reduce((a, b) => a + b, 0) / raw.length
  const c = raw.map((v) => v - m)
  const rms = Math.sqrt(c.reduce((a, b) => a + b * b, 0) / c.length)
  return c.map((v) => v / rms)
})()

/** 8 個相位的 offset ε_p [fs]（去共模、RMS = phosRmsFs） */
export function phosOffsets(phosRmsFs: number): number[] {
  return PHOS_PATTERN.map((v) => phosRmsFs * v)
}

/** 既有的組合（legacy、單一 gain）仍由 blockLms 的 runBlockLms 執行 */
export function usesLegacyEngine(p: Pick<LabParams, 'regressorSign' | 'architecture'>): boolean {
  return p.regressorSign === 'legacy' && p.architecture === 'gos_only'
}

/** 權重名稱（TeX）：P = 9 時 w_0…w_7 與 w_g；P = 1 時 w */
export function labWeightNames(P: number): string[] {
  if (P === 1) return ['w']
  return [...Array.from({ length: PMUX_PHASES }, (_, j) => `w_{${j}}`), 'w_g']
}

/** 8 相 PMUX 時 DSM 跑的小數部分：frac(8α)；整數部分 ⌊8α⌋ 是每個週期固定前進的相位步數 */
export function pmuxFrac(frac: number): { int: number; frac8: number } {
  const a8 = 8 * frac
  const int = Math.floor(a8 + 1e-12)
  const f8 = a8 - int
  return { int, frac8: f8 < 0 ? 0 : f8 >= 1 ? 0 : f8 }
}

/** DSM 實際跑的小數部分（pmux8_gos 時是 frac(8α)） */
export function codeFrac(p: Pick<LabParams, 'architecture' | 'frac'>): number {
  return p.architecture === 'pmux8_gos' ? pmuxFrac(p.frac).frac8 : p.frac
}

/** 串流版統計（與 blockLms.ts 的 StreamingStats 相同：以第一個樣本為 shift 的平移和、Neumaier 補償），normalization 預掃描用 */
class LabStreamingStats {
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

interface LabCodeSource {
  /** 填入 raw code（已套用正負號、尚未正規化）與相位索引（gos_only 時不寫 ph） */
  fill(x: Float64Array, ph: Int32Array | null, off: number, cnt: number): void
}

// #region core:labCodeSource
/**
 * code 串流：gos_only 與 blockLms 的 createCodeSource 相同（同一個 rng 分流 'code-pattern' → 'dsm-dither'），只多了正負號；
 * pmux8_gos 的 DSM 跑在 frac(8α)，並產生 PMUX 相位索引 p[n]（可再疊上已知的隨機旋轉 m[n]，DTC code 跟著加 m）。
 */
function createLabCodeSource(p: LabParams, codeRng: Rng, rotRng: Rng | null): LabCodeSource {
  const sgn = p.regressorSign === 'spec' ? -1 : 1 // raw residue r ≤ 0：legacy 直接用，spec 用 −r（= s/M ≥ 0）
  if (p.architecture === 'gos_only') {
    if (p.codeSource === 'iid_pm_one') {
      return {
        fill(x, _ph, off, cnt) {
          for (let i = 0; i < cnt; i++) x[off + i] = sgn * ((codeRng.uint32() >>> 31) === 1 ? 1 : -1)
        },
      }
    }
    const s = new DsmStream({ kind: p.codeSource === 'mash111' ? 'mash111' : 'first_order', frac: p.frac, bits: p.dsmBits, dither: p.dither }, codeRng.fork('dsm-dither'))
    return {
      fill(x, _ph, off, cnt) {
        for (let i = 0; i < cnt; i++) {
          s.step()
          x[off + i] = sgn * s.residue
        }
      },
    }
  }
  const { int, frac8 } = pmuxFrac(p.frac)
  const s = new DsmStream({ kind: p.codeSource === 'mash111' ? 'mash111' : 'first_order', frac: frac8, bits: p.dsmBits, dither: p.dither }, codeRng.fork('dsm-dither'))
  let P = 0 // PMUX 總指標（以 Δ 計的整數相位）
  return {
    fill(x, ph, off, cnt) {
      for (let i = 0; i < cnt; i++) {
        const y = s.step()
        P += int + y
        let c = -s.residue // ← 差異：DTC 只補一個相位步以內的量 c = −r′ ∈ [0, 1)（一階）
        let idx = ((P % PMUX_PHASES) + PMUX_PHASES) % PMUX_PHASES
        if (rotRng) {
          const m = rotRng.int(0, PMUX_PHASES - 1) // ← 差異：已知的隨機旋轉：相位多轉 m 步，DTC 多補 m 個 Δ
          idx = (idx + m) % PMUX_PHASES
          c += m
        }
        x[off + i] = -sgn * c // c ≥ 0 已是 §2a 的 s/M：spec 直接用 c，legacy 用 −c（= r ≤ 0）
        if (ph) ph[off + i] = idx
      }
    },
  }
}
// #endregion

/** 與 runLabLoop 相同的 code 串流（同 seed、同分流、同正規化），回傳 [skip, skip + L) 的樣本（給 FCW sweep 用） */
function labCodeSequence(p: LabParams, norm: { offset: number; scale: number }, skip: number, L: number): { x: Float64Array; ph: Int32Array | null } {
  const root = createRng(p.seed)
  const src = createLabCodeSource(p, root.fork('code-pattern'), p.architecture === 'pmux8_gos' && p.pmuxOrder === 'random' ? root.fork('pmux-rotation') : null)
  const total = skip + L
  const buf = new Float64Array(total)
  const pb = p.architecture === 'pmux8_gos' ? new Int32Array(total) : null
  src.fill(buf, pb, 0, total)
  const x = new Float64Array(L)
  for (let i = 0; i < L; i++) x[i] = (buf[skip + i] - norm.offset) * norm.scale
  return { x, ph: pb ? pb.slice(skip) : null }
}

/** 多權重線性化分析（pmux8_gos）：J、R_u、可觀測子空間、poles、穩態 σ、線性化固定點 */
export interface MimoAnalysis {
  P: number
  /** 權重名稱（TeX） */
  names: string[]
  /** 目標 [ε_0…ε_7, a] */
  target: number[]
  /** J_ij = K_q E[ψ_i φ_{u,j}] [fs⁻¹]（ψ = GMAC regressor、φ_u = H_PD{φ}） */
  J: Matrix
  /** u-domain 資訊矩陣 R_u = E[φ_u φ_uᵀ] */
  Ru: Matrix
  /** GMAC regressor 的自相關 R_ψ = E[ψ ψᵀ]（GMAC 雜訊 Cov(η) ≈ R_ψ/N） */
  Rpsi: Matrix
  /** R_u 的可觀測子空間：特徵值、gauge 方向數、條件數 */
  obs: { values: number[]; nullDim: number; lambdaMax: number; lambdaMin: number; cond: number }
  /** J 限制到可觀測子空間後的特徵值；最小實部；所有權重共用步長時的 μ 上限 */
  eigJ: { re: number; im: number }[]
  minReEig: number
  muMaxUniform: number
  /** 實際的 M = diag(μ_p×8, μ_g)、含更新延遲 d 的平均模型：spectral radius、是否穩定、時間常數 */
  rho: number
  stable: boolean
  tauBlocks: number
  /** 每個權重的穩態 σ 預測 [fs]（dlyap；P(d+1) > 40 時 null） */
  sigmaPred: number[] | null
  /** 線性化固定點（可觀測子空間上的最小平方解；共模方向取 0）[fs] */
  wStarLin: number[]
  /** 8 個相位在統計樣本內的走訪比例 */
  occupancy: number[]
  /** 共模是否可觀測（H_PD(1) ≠ 0 的 'none' 路徑才是） */
  commonModeObservable: boolean
  warnings: string[]
}

// #region core:mimoFromSequence
/**
 * 由一段 code 序列（x、相位 p[n]）算 9 個權重的線性化量：
 *   φ = [1{p=0}…1{p=7}, x]、φ_u = H_PD{φ}、ψ = GMAC regressor（raw / delayed / filtered，PHOS 的 one-hot 同樣處理）
 *   J = K_q E[ψ φ_uᵀ]、R_u = E[φ_u φ_uᵀ]、R_ψ = E[ψ ψᵀ]（F-LAB.15 的多參數 Jacobian，基底換成 one-hot + x）。
 * 可觀測子空間由 R_u 決定（共模經 H_PD(1) = 0 後是結構性 null），條件數、J 的特徵值、μ 上限都在那個子空間上算。
 */
function mimoFromSequence(a: {
  p: LabParams
  design: PllDesign
  x: Float64Array
  ph: Int32Array
  skip: number
  bugEncoding: boolean
}): MimoAnalysis {
  const { p, design, x, ph, skip } = a
  const P = PMUX_WEIGHTS
  const L = x.length - skip
  const D = p.regressor === 'raw' ? 0 : p.codeDelay
  const identity = design.kind === 'none'
  const hat = p.regressor === 'filtered' ? { b: new Array<number>(p.fxExtraDelay).fill(0).concat(design.H.b.map((v) => v * p.fxGain)), a: design.H.a.slice() } : null
  // φ_u：H_PD 濾過的基底；ψ：regressor（含延遲）
  const phiU: Float64Array[] = []
  const psi: Float64Array[] = []
  for (let j = 0; j < P; j++) {
    const phi = new Float64Array(x.length)
    if (j === GOS_INDEX) phi.set(x)
    else for (let n = 0; n < x.length; n++) phi[n] = ph[n] === j ? 1 : 0
    phiU.push(identity ? phi : filterSeq(design.H, phi))
    const base = hat ? filterSeq(hat, phi) : phi
    psi.push(D > 0 ? delaySeq(base, D) : base)
  }
  const Kq = p.sigmaV > 0 ? SQRT_2_OVER_PI / p.sigmaV : NaN
  const enc = a.bugEncoding ? 0.5 : 1
  const J: Matrix = []
  const Ru: Matrix = []
  const Rpsi: Matrix = []
  for (let i = 0; i < P; i++) {
    J.push(new Array<number>(P).fill(0))
    Ru.push(new Array<number>(P).fill(0))
    Rpsi.push(new Array<number>(P).fill(0))
  }
  for (let n = skip; n < x.length; n++) {
    for (let i = 0; i < P; i++) {
      const pi = psi[i][n]
      const ui = phiU[i][n]
      for (let j = 0; j < P; j++) {
        J[i][j] += pi * phiU[j][n]
        Ru[i][j] += ui * phiU[j][n]
        Rpsi[i][j] += pi * psi[j][n]
      }
    }
  }
  for (let i = 0; i < P; i++)
    for (let j = 0; j < P; j++) {
      J[i][j] = (Kq * enc * J[i][j]) / L
      Ru[i][j] /= L
      Rpsi[i][j] /= L
    }
  const occupancy = new Array<number>(PMUX_PHASES).fill(0)
  for (let n = skip; n < x.length; n++) occupancy[ph[n]]++
  for (let j = 0; j < PMUX_PHASES; j++) occupancy[j] /= L
  // 可觀測子空間（R_u 的 null 方向 = 共模與沒走訪的相位）
  const obs = observableEigen(Ru, 1e-9)
  const V = obs.basis
  const Jobs = V.length > 0 && V[0].length > 0 ? restrictTo(J, V) : []
  const eigJ = Jobs.length > 0 ? eigvals(Jobs).map((z) => ({ re: z.re, im: z.im })) : []
  const minReEig = eigJ.reduce((m, z) => Math.min(m, z.re), Infinity)
  const muMaxUniform = uniformStepMuMax(eigJ)
  // 實際的步長矩陣與含延遲的平均模型（在可觀測子空間上：δ_{k+1} = δ_k − M J δ_{k−d}）
  const M: Matrix = Array.from({ length: P }, (_, i) => Array.from({ length: P }, (_, j) => (i === j ? (i === GOS_INDEX ? p.muFs : p.muPhosFs) * (p.gmMode === 'sum' ? p.N : 1) : 0)))
  let rho = NaN
  let stable = false
  let tauBlocks = NaN
  let sigmaPred: number[] | null = null
  const warnings: string[] = []
  if (Jobs.length > 0 && Number.isFinite(Kq)) {
    const Mobs = restrictTo(M, V)
    const mm = delayedMimoMeanModel(Jobs, Mobs, p.updateDelay)
    rho = mm.rho
    stable = mm.stable
    tauBlocks = rho > 0 && rho < 1 ? -1 / Math.log(rho) : NaN
    const cov = delayedMimoCovariance(Jobs, Mobs, restrictTo(Rpsi, V), p.N, p.updateDelay, 40)
    if (cov) {
      // 回到權重座標：Cov(δ) = V Cov_obs Vᵀ
      const full = matMul(V, matMul(cov, transpose(V)))
      sigmaPred = Array.from({ length: P }, (_, i) => Math.sqrt(Math.max(0, full[i][i])))
    } else if (mm.stable && P * (p.updateDelay + 1) > 40) warnings.push(`更新延遲 $d=${p.updateDelay}$ 時 9 個權重的增廣系統超過 40 維，沒有算穩態共變異（$\\sigma$ 預測留白）`)
  }
  // 線性化固定點：J δ* = −K_q E[ψ (u_d + b)]（可觀測子空間上最小平方；共模取 0）
  const target = [...phosOffsets(p.phosRmsFs), p.aFs]
  const hasNl = p.dtcOffsetFs !== 0 || p.c2 !== 0 || p.c3 !== 0
  const rhs = new Array<number>(P).fill(0)
  if (hasNl || p.compOffsetFs !== 0) {
    const d = new Float64Array(x.length)
    for (let n = 0; n < x.length; n++) d[n] = p.dtcOffsetFs + x[n] * x[n] * (p.c2 + p.c3 * x[n])
    const ud = identity ? d : filterSeq(design.H, d)
    for (let i = 0; i < P; i++) {
      let s = 0
      for (let n = skip; n < x.length; n++) s += psi[i][n] * (ud[n] + p.compOffsetFs)
      rhs[i] = (-Kq * enc * s) / L
    }
  }
  let wStarLin = target.slice()
  if (Jobs.length > 0 && Number.isFinite(Kq)) {
    try {
      const rObs = matVec(transpose(V), rhs)
      const dObs = solve(Jobs, rObs)
      const dFull = matVec(V, dObs)
      wStarLin = target.map((t, i) => t - dFull[i]) // δ = a − w ⇒ w* = target − δ*
    } catch {
      wStarLin = target.map(() => NaN)
    }
  }
  if (obs.nullDim > 1) warnings.push(`資訊矩陣有 ${obs.nullDim} 個不可觀測方向（共模之外還有沒走訪的相位或線性相依）：對應的權重在這段 code 內不可辨識`)
  if (eigJ.length > 0 && !(minReEig > 0)) warnings.push(`多權重 Jacobian 在可觀測子空間上有實部 $\\le0$ 的特徵值（$\\min\\mathrm{Re}\\,\\lambda=${texNum(minReEig, 3)}$）：至少一個模式極性錯誤（PHOS mode-1 落在反號帶，或 code delay 錯位）`)
  if (Number.isFinite(obs.cond) && obs.cond > 100) warnings.push(`可觀測子空間的條件數 $${texNum(obs.cond, 3)}>100$：最慢的模式比最快的慢兩個數量級以上，單一步長的 sign-LMS 要等很久（第 10 章的 preconditioning）`)
  return {
    P,
    names: labWeightNames(P),
    target,
    J,
    Ru,
    Rpsi,
    obs: { values: obs.values, nullDim: obs.nullDim, lambdaMax: obs.lambdaMax, lambdaMin: obs.lambdaMin, cond: obs.cond },
    eigJ,
    minReEig,
    muMaxUniform,
    rho,
    stable,
    tauBlocks,
    sigmaPred,
    wStarLin,
    occupancy,
    commonModeObservable: obs.nullDim === 0,
    warnings,
  }
}
// #endregion

/** 新引擎的準備工作：normalization 預掃描（整段 record）、GOS 通道的解析量（與 blockLms 的 prepare 同一套定義）、pmux8 的多權重分析 */
export interface LabPrepared {
  p: LabParams
  design: PllDesign
  N: number
  K: number
  D: number
  dUp: number
  P: number
  /** 目標 [ε_0…ε_7, a]（P = 1 時 [a]） */
  target: number[]
  norm: { offset: number; scale: number }
  hat: DtTransfer | null
  analytic: BlockLmsAnalytic
  mimo: MimoAnalysis | null
  warnings: string[]
  assumptions: string[]
  modelLevel: 'L1' | 'L2' | 'L5'
}

/** GOS 通道的 mean-field 固定點：f(w) = mean_n x_ref·m(e_n(w))，m = erf（bipolar）或 Φ（bug）；Illinois 求根（與 blockLms 同一個定義） */
function gosMeanFieldFixedPoint(a: { aFs: number; sigma: number; b: number; bug: boolean; u: Float64Array; unl: Float64Array; xref: Float64Array; guess: number; wScale: number }): { root: number; slope: number } {
  const n = a.u.length
  const f = (w: number): number => {
    let s = 0
    for (let i = 0; i < n; i++) {
      const e = (a.aFs - w) * a.u[i] + a.unl[i] + a.b
      const m = a.sigma > 0 ? (a.bug ? normCdf(e / a.sigma) : erf(e / (Math.SQRT2 * a.sigma))) : e >= 0 ? 1 : a.bug ? 0 : -1
      s += a.xref[i] * m
    }
    return s / n
  }
  const h = Math.max(1e-6 * Math.max(1, Math.abs(a.guess)), 1e-3 * a.wScale)
  let lo = a.guess - 4 * a.wScale
  let hi = a.guess + 4 * a.wScale
  let flo = f(lo)
  let fhi = f(hi)
  let tries = 0
  while (flo * fhi > 0 && tries < 20) {
    lo -= 4 * a.wScale * 2 ** tries
    hi += 4 * a.wScale * 2 ** tries
    flo = f(lo)
    fhi = f(hi)
    tries++
  }
  if (!(flo * fhi <= 0)) return { root: NaN, slope: NaN }
  let side = 0
  let root = NaN
  for (let it = 0; it < 200; it++) {
    const m = (lo * fhi - hi * flo) / (fhi - flo)
    const fm = f(m)
    root = m
    if (Math.abs(fm) < 1e-13 || Math.abs(hi - lo) < 1e-12 * Math.max(1, Math.abs(m))) break
    if (fm * fhi < 0) {
      lo = hi
      flo = fhi
      side = 0
    } else if (side === 1) flo *= 0.5
    hi = m
    fhi = fm
    if (fm * flo < 0) side = 1
  }
  const slope = -(f(root + h) - f(root - h)) / (2 * h)
  return { root, slope }
}

/** δ_{k+1} = δ_k − gδ_{k−d} + η_k 的雜訊增益 Σ h_k²（blockLms.calNoiseGain 的同一個定義；不穩定或不收斂時 NaN） */
function labNoiseGain(g: number, d: number, stable: boolean): number {
  if (!stable) return NaN
  if (d === 0) {
    const p = 1 - g
    return 1 / (1 - p * p)
  }
  const L = d + 1
  const hist = new Float64Array(L)
  let energy = 0
  let yPrev = 0
  let idx = 0
  let small = 0
  for (let k = 0; k < 5_000_000; k++) {
    const yDelayed = hist[idx]
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

/** 平均更新 z^{d+1} − z^d + g = 0 的最大根模（含 g 非有限的保護） */
function meanPoleRadius(g: number, d: number): number {
  if (!Number.isFinite(g)) return NaN
  return delayLoopRadius(g, d)
}

// #region core:prepareLab
/**
 * 新引擎的 prepare：與 blockLms.prepare 同一套定義（normalization 掃整段 record；解析量用前 2^17 個樣本、略過 ⌊S/8⌋ 個暫態；
 * mean-field 固定點用 2^14 個樣本），只是 code 來源換成 createLabCodeSource（正負號、PMUX）。pmux8_gos 另外算 9 個權重的 MimoAnalysis。
 */
export function prepareLab(p: LabParams, design: PllDesign, over: { blocks?: number } = {}): LabPrepared {
  const warnings: string[] = []
  const N = p.N
  const K = over.blocks ?? p.blocks
  const total = N * K
  const D = p.regressor === 'raw' ? 0 : p.codeDelay
  const dUp = p.updateDelay
  const pmux = p.architecture === 'pmux8_gos'
  const P = pmux ? PMUX_WEIGHTS : 1
  const bug = p.encoding === 'unipolar_unmapped_bug'
  const sumMode = p.gmMode === 'sum'
  const identity = design.kind === 'none'
  const hat = p.regressor === 'filtered' ? hatTransfer({ regressor_mode: 'filtered', filtered_x_model: { path: 'same_as_path', gain_mismatch: p.fxGain, extra_delay_samples: p.fxExtraDelay } } as BlockLmsConfig, design.H) : null
  for (const w of design.warnings) warnings.push(w)

  // ── normalization 預掃描（整段 record）＋ 解析樣本 ──
  const S = Math.min(total, 1 << 17)
  const head = new Float64Array(S)
  const headPh = pmux ? new Int32Array(S) : null
  const root = createRng(p.seed)
  const src = createLabCodeSource(p, root.fork('code-pattern'), pmux && p.pmuxOrder === 'random' ? root.fork('pmux-rotation') : null)
  let norm: { offset: number; scale: number }
  if (p.normalization === 'none') {
    src.fill(head, headPh, 0, S)
    norm = { offset: 0, scale: 1 }
  } else {
    const st = new LabStreamingStats()
    const chunk = new Float64Array(Math.min(total, 1 << 16))
    const chunkPh = pmux ? new Int32Array(chunk.length) : null
    let done = 0
    while (done < total) {
      const cnt = Math.min(chunk.length, total - done)
      src.fill(chunk, chunkPh, 0, cnt)
      for (let i = 0; i < cnt; i++) st.push(chunk[i])
      const take = Math.min(cnt, S - done)
      if (take > 0) {
        head.set(chunk.subarray(0, take), done)
        if (headPh && chunkPh) headPh.set(chunkPh.subarray(0, take), done)
      }
      done += cnt
    }
    const np = normalizationParams({ mean: st.mean, rms: st.rms, std: st.std }, p.normalization)
    norm = { offset: np.offset, scale: np.scale }
    warnings.push(...np.warnings)
  }
  const x = new Float64Array(S)
  for (let i = 0; i < S; i++) x[i] = (head[i] - norm.offset) * norm.scale

  // ── GOS 通道的解析量（與 blockLms 相同的定義）──
  const u = identity ? x : filterSeq(design.H, x)
  const hasNl = p.dtcOffsetFs !== 0 || p.c2 !== 0 || p.c3 !== 0
  const nlx = new Float64Array(S)
  if (hasNl) for (let i = 0; i < S; i++) nlx[i] = p.dtcOffsetFs + x[i] * x[i] * (p.c2 + p.c3 * x[i])
  const unl = identity || !hasNl ? nlx : filterSeq(design.H, nlx)
  const base = hat ? filterSeq(hat, x) : x
  const xref = D > 0 ? delaySeq(base, D) : base
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
  const sigma = p.sigmaV
  const mu = p.muFs
  const Kq = sigma > 0 ? SQRT_2_OVER_PI / sigma : NaN
  const Kgm = Kq * C * (bug ? 0.5 : 1)
  const g = mu * Kgm * (sumMode ? N : 1)
  const pole = 1 - g
  let rhoMean = meanPoleRadius(g, dUp)
  let stableMean = rhoMean < 1
  const gCritical = 2 * Math.sin(Math.PI / (4 * dUp + 2))
  const pmDeg = g > 0 && g <= 2 ? 90 - (2 * dUp + 1) * ((Math.asin(g / 2) * 180) / Math.PI) : NaN
  const fuHz = p.fRefHz / N
  let f3dbHz = NaN
  let enbwHz = NaN
  if (dUp === 0 && Number.isFinite(pole)) {
    if (pole >= 3 - 2 * Math.SQRT2 && pole < 1) f3dbHz = (Math.acos(1 - ((1 - pole) * (1 - pole)) / (2 * pole)) / (2 * Math.PI)) * fuHz
    if (Math.abs(pole) < 1) enbwHz = (fuHz * (1 - pole)) / (2 * (1 + pole))
  }
  let tauBlocks = rhoMean > 0 && rhoMean < 1 ? -1 / Math.log(rhoMean) : NaN
  const wStarLinear = p.aFs + (Cnl + p.compOffsetFs * ExRef + (bug && Kq > 0 ? ExRef / Kq : 0)) / C
  const Smf = Math.min(S - s0, 1 << 14)
  let mf = { root: NaN, slope: NaN }
  if (!pmux) {
    mf = gosMeanFieldFixedPoint({
      aFs: p.aFs,
      sigma,
      b: p.compOffsetFs,
      bug,
      u: u.subarray(s0, s0 + Smf),
      unl: unl.subarray(s0, s0 + Smf),
      xref: xref.subarray(s0, s0 + Smf),
      guess: Number.isFinite(wStarLinear) ? wStarLinear : p.aFs,
      wScale: sigma > 0 && Eu2 > 0 ? sigma / Math.sqrt(Eu2) : Math.max(1, Math.abs(p.aFs)),
    })
  }
  let sigEtaSample = ExRef2
  if (bug) {
    const wq = Number.isFinite(mf.root) ? mf.root : p.aFs
    let acc = 0
    let mG = 0
    for (let i = 0; i < Smf; i++) {
      const e = (p.aFs - wq) * u[s0 + i] + unl[s0 + i] + p.compOffsetFs
      const Pr = sigma > 0 ? normCdf(e / sigma) : e >= 0 ? 1 : 0
      acc += xref[s0 + i] * xref[s0 + i] * Pr
      mG += xref[s0 + i] * Pr
    }
    sigEtaSample = acc / Smf - (mG / Smf) * (mG / Smf)
  }
  const sigmaEta2 = sumMode ? sigEtaSample * N : sigEtaSample / N
  // σ_w 預測（GOS 單參數的 noise gain；與 blockLms 的 calNoiseGain 同一個定義）
  let sigmaWPred = Math.abs(mu) * Math.sqrt(sigmaEta2 * labNoiseGain(g, dUp, stableMean))

  // ── pmux8：多權重分析 ──
  let mimo: MimoAnalysis | null = null
  if (pmux && headPh) {
    mimo = mimoFromSequence({ p, design, x, ph: headPh, skip: s0, bugEncoding: bug })
    warnings.push(...mimo.warnings)
    // GOS 通道的 ρ、τ、σ 改由 9 個權重的平均模型決定（耦合後的整體行為）
    rhoMean = mimo.rho
    stableMean = mimo.stable
    tauBlocks = mimo.tauBlocks
    if (mimo.sigmaPred) sigmaWPred = mimo.sigmaPred[GOS_INDEX]
    mf = { root: mimo.wStarLin[GOS_INDEX], slope: NaN }
  }

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
    normalization: { mode: p.normalization, offset: norm.offset, scale: norm.scale, warnings: [] },
  }

  // ── 警告（與 blockLms 相同的句子，texifyShared 認得）──
  const fmt = (v: number, d = 4): string => (Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : String(v))
  const tolC = 1e-3 * Math.sqrt(Math.max(ExRef2 * Eu2, 0))
  if (C < -tolC) warnings.push(`C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（C = ${fmt(C)}；只減小 learning rate 不會改變符號，需 delay alignment 或 filtered-x）`)
  else if (!(C > tolC)) warnings.push(`C ≈ 0：GMAC 沒有平均恢復力（資訊不足／缺乏激勵），w 會隨雜訊漂移（C = ${fmt(C)}）`)
  if (sigma === 0) warnings.push('σ_v = 0：comparator 為純 sign，K_q 無定義（小訊號線性化不適用），可能出現 limit cycle 或 dead zone')
  if (mu <= 0) warnings.push(`gain_step μ = ${fmt(mu)} ≤ 0：除非 C < 0，平均誤差不會收斂`)
  if (!pmux && Number.isFinite(g) && C > tolC && mu > 0) {
    if (dUp === 0 && g >= 2) warnings.push(`g ≥ 2：一階模型不穩定（g = μK = ${fmt(g)}，pole = ${fmt(pole)}）`)
    else if (dUp > 0 && g >= gCritical) warnings.push(`g ≥ 2sin(π/(4d+2)) = ${fmt(gCritical)}：含 d = ${dUp} 個 block 更新延遲的一階模型不穩定（g = ${fmt(g)}）`)
  }
  if (pmux && mimo && !mimo.stable && Number.isFinite(mimo.rho)) warnings.push(`9 個權重的平均模型不穩定（spectral radius ${fmt(mimo.rho)} ≥ 1）：減小 $\\mu$ 或 $\\mu_p$，或檢查極性`)
  if (sumMode) warnings.push(`gm_mode=sum 時有效增益放大 N 倍（N = ${N}：g = ${fmt(g)}；若沿用 average 模式的 μ，需改為 μ/N = ${fmt(mu / N)}）`)
  if (bug) warnings.push('comparator_encoding = unipolar_unmapped_bug：硬體 0/1 未映射為 ±1（q = b），有效增益減半，且 E[x_ref] ≠ 0 時 GMAC 多出 E[x_ref]/2 的偏差項（反面測試）')
  if (!identity && design.hpdDc < 1e-9 && (p.dtcOffsetFs !== 0 || Math.abs(Ex) > 1e-3)) warnings.push('H_PD(z=1) = 0：DTC offset 與 code 的 DC 成分在穩態不會到達 comparator（E03、E04）')
  const biasPred = mf.root - p.aFs
  if (!pmux && Number.isFinite(biasPred) && Number.isFinite(sigmaWPred) && Math.abs(biasPred) > 3 * sigmaWPred && Math.abs(biasPred) > 1e-9)
    warnings.push(`預測固定點偏差 w* − a ≈ ${fmt(biasPred)} fs（offset / DTC 非線性 / code 平均造成；GMAC 歸零 ≠ DTC 誤差為零，§11）`)
  if (p.regressor === 'filtered' && (p.fxGain !== 1 || p.fxExtraDelay !== 0)) warnings.push(`filtered-x 模型 Ĥ ≠ H：有效相關為 E[u·u_f] = ${fmt(C)}（不是 E[u²] = ${fmt(Eu2)}；E45）`)
  if (p.quantize && Number.isFinite(sigmaWPred) && p.lsbFs > 2 * sigmaWPred) warnings.push(`實體 gain LSB = ${fmt(p.lsbFs)} fs 遠大於預測 σ_w = ${fmt(sigmaWPred)} fs：量化誤差主導，可能出現 limit cycle 或 dead zone（§13）`)

  const isDsm = p.codeSource !== 'iid_pm_one'
  const modelLevel: 'L1' | 'L2' | 'L5' = p.quantize ? 'L5' : !identity || p.regressor !== 'raw' || isDsm || hasNl || pmux ? 'L2' : 'L1'
  const assumptions = [
    `時間單位 fs；code 依 ${p.normalization} 正規化後無因次；a、w 的單位為 fs per unit code（δ = a − w 極性）`,
    p.regressorSign === 'spec' ? 'regressor 正負號照 docs/assumptions.md §2a：x = s/M ≥ 0（一階 DSM），code 越大 feedback edge 越早到' : 'regressor 正負號沿用本頁原本的 r = −s/M ≤ 0（與既有 preset、golden vector 相同；只差 x → −x）',
    pmux
      ? `8 相 PMUX：DSM 跑在 frac(8α) = ${fmt(pmuxFrac(p.frac).frac8, 6)}，PMUX 相位 p[n] = P[n] mod 8${p.pmuxOrder === 'random' ? '（再疊上已知的隨機旋轉 m[n] ∈ {0…7}，DTC code 加 m）' : ''}；PD 誤差 e[n] = (a − w_g)·x + (ε_p − w_p) + d(x)，9 個權重各自一個 GMAC（PHOS 用 one-hot regressor）`
      : 'PD 誤差 e[n] = H_PD{δt}[n] + b + v[n]，δt[n] = (a − w_applied)·x[n] + offset + c2·x² + c3·x³；H_PD 狀態跨 block 持續（§15.2）',
    `comparator 前雜訊 v[n] 為 iid Gaussian（σ_v = ${sigma} fs），與 code 獨立`,
    'q = sign(e)，tie 規則 e ≥ 0 ⇒ q = +1（§15.2、E07）',
    `GMAC：G_k = ${sumMode ? 'Σ' : '(1/N)Σ'} q·x_ref（N = ${N}），w_{k+1} = w_k + μG_k${pmux ? `（PHOS：w_p ← w_p + μ_p G_p，μ_p = ${p.muPhosFs} fs）` : ''}，更新延遲 d = ${dUp} block`,
    'f_s = f_ref：每個 code sample 對應一個 comparator sample',
    'K_q = √(2/π)/σ_v 為小訊號近似（|e_det| ≪ σ_v）；σ_w 預測假設 GMAC 雜訊 iid（σ_η² ≈ E[x_ref²]/N）且線性化有效',
    `C 與固定點由前 ${S} 個 code 樣本（略過前 ${s0} 個暫態）估計；mean-field 固定點使用 ${Smf} 個樣本`,
  ]
  if (!p.quantize) assumptions.push('gain_register 未啟用（quantize_physical = false）：w 為理想浮點，internal_bits / physical_bits 不生效')
  else
    assumptions.push(
      `定點暫存器：內部 ${p.internalBits} bits（小數 ${p.internalBits - p.physicalBits} bits）、實體 ${p.physicalBits} bits、LSB ${p.lsbFs} fs、${p.signedReg ? 'signed' : 'unsigned'}、rounding = ${p.rounding}（增量與實體 code 皆用此規則）、overflow = ${p.overflow}${pmux ? '；9 個權重共用同一組暫存器設定' : ''}`,
    )
  return { p, design, N, K, D, dUp, P, target: pmux ? [...phosOffsets(p.phosRmsFs), p.aFs] : [p.aFs], norm, hat, analytic, mimo, warnings, assumptions, modelLevel }
}
// #endregion

/** 新引擎一次執行的結果（P 個權重；trace 時另含穩態視窗與 mean-field 平均軌跡） */
export interface LabLoopResult {
  P: number
  /** 每個權重的 block 級軌跡：w[j][k]、wPhys[j][k]（長度 K + 1）、G[j][k]（長度 K） */
  w: Float64Array[]
  wPhys: Float64Array[]
  G: Float64Array[]
  /** GOS 通道的指標（與 blockLms 的 computeMetrics 相同定義） */
  metrics: BlockLmsMetrics
  /** 每個權重後半段的平均、標準差、bias（= mean − 目標）、settling */
  perWeight: { meanW: number[]; stdW: number[]; bias: number[]; settlingBlock: (number | null)[] }
  /** pmux8：PHOS 殘差（後半段平均 − ε）去共模後的 RMS 與共模值 [fs]；P = 1 時 NaN */
  phosRmsFs: number
  phosCommonFs: number
  /** 穩態視窗（trace 時）；含每個相位的 one-hot 經 T 的響應，tStatic 已算好 */
  window: (ReplayWindow & { phase: Float64Array | null }) | null
  /** mean-field 平均軌跡（每個權重）與 GOS 的 C_k、B_k（meanField 時） */
  meanField: { w: Float64Array[]; C: Float64Array; B: Float64Array } | null
  warnings: string[]
  divergenceBlock: number | null
}

// #region core:runLabLoop
/**
 * 多權重 sign-error block LMS（新引擎）。與 runBlockLms 相同的亂數分流（'code-pattern'、'comparator-noise'、'gain-register-rounding'）、
 * 相同的 inner loop 運算順序，推廣成 P 個權重：
 *   e_DTC[n] = (a − w_g,app)·x[n] [+ (ε_p − w_p,app)] [+ d(x)]，u = H_PD{e_DTC}，e = u + b + v，q = sign(e)，
 *   G_j = (1/N)Σ q·ψ_j（ψ_g = x_ref；ψ_p = one-hot 或其 delayed / filtered 版本），w_j ← phys(w_j + μ_j G_j)。
 * trace 時同時記錄穩態視窗（x、e_DTC、u_pd、e、q、t_out 與 T{x}、T{d}、T{1_p}），
 * meanField 時同時跑 mean-field twin（q 換成 erf(e_det/(√2σ_v))，權重在 block 內凍結）。
 */
export function runLabLoop(pr: LabPrepared, o: { windowBlocks?: number; meanField?: boolean; trace?: boolean; quantize?: boolean; untilBlock?: number } = {}): LabLoopResult {
  const { p, design, N, K, D, dUp, P } = pr
  const pmux = P > 1
  const a = p.aFs
  const target = pr.target
  const eps = pmux ? target.slice(0, PMUX_PHASES) : []
  const sigma = p.sigmaV
  const bOff = p.compOffsetFs
  const hasNl = p.dtcOffsetFs !== 0 || p.c2 !== 0 || p.c3 !== 0
  const nlOff = p.dtcOffsetFs
  const nlC2 = p.c2
  const nlC3 = p.c3
  const avg = p.gmMode === 'average'
  const qLo = p.encoding === 'unipolar_unmapped_bug' ? 0 : -1
  const bug = p.encoding === 'unipolar_unmapped_bug'
  const mapped = p.encoding === 'unipolar_mapped'
  const normOff = pr.norm.offset
  const normSc = pr.norm.scale
  const doNorm = normOff !== 0 || normSc !== 1
  const identity = design.kind === 'none'
  const quantize = o.quantize ?? p.quantize
  const trace = o.trace ?? false
  const wantMf = o.meanField ?? false
  const mus: number[] = Array.from({ length: P }, (_, j) => (pmux && j !== GOS_INDEX ? p.muPhosFs : p.muFs))
  const gIdx = pmux ? GOS_INDEX : 0

  // 亂數流（與 runBlockLms 相同的分流順序）
  const root = createRng(p.seed)
  const src = createLabCodeSource(p, root.fork('code-pattern'), pmux && p.pmuxOrder === 'random' ? root.fork('pmux-rotation') : null)
  const gauss = createZigguratNormal(root.fork('comparator-noise'))
  const roundRng = root.fork('gain-register-rounding')
  const pathF = identity ? null : new StreamFilter(design.H.b, design.H.a)
  const hat = pr.hat
  const hatF = hat ? new StreamFilter(hat.b, hat.a) : null
  const hatP: StreamFilter[] = pmux && hat ? Array.from({ length: PMUX_PHASES }, () => new StreamFilter(hat.b, hat.a)) : []
  // 分析用（不消耗亂數）
  const uxF = identity ? null : new StreamFilter(design.H.b, design.H.a)
  const udF = identity || !hasNl ? null : new StreamFilter(design.H.b, design.H.a)
  const u1F: StreamFilter[] = pmux && !identity && wantMf ? Array.from({ length: PMUX_PHASES }, () => new StreamFilter(design.H.b, design.H.a)) : []
  const tF = trace ? new StreamFilter(design.T.b, design.T.a) : null
  const txF = trace ? new StreamFilter(design.T.b, design.T.a) : null
  const tdF = trace && hasNl ? new StreamFilter(design.T.b, design.T.a) : null
  const t1F: StreamFilter[] = trace && pmux ? Array.from({ length: PMUX_PHASES }, () => new StreamFilter(design.T.b, design.T.a)) : []

  const xext = new Float64Array(N + D)
  // 第一個 block 的前 D 個 p[n−D] 還不存在：填 −1（不累加），和 x_ref 在那裡是 0 一致
  const pext = pmux ? new Int32Array(N + D).fill(-1) : null
  const rext = hat ? new Float64Array(N + D) : null
  const xr = rext ?? xext
  const rP: Float64Array[] = pmux && hat ? Array.from({ length: PMUX_PHASES }, () => new Float64Array(N + D)) : []

  // ── gain register（每個權重一份，共用設定；與 blockLms 相同的規則與亂數順序）──
  const F = p.internalBits - p.physicalBits
  const scaleF = Math.pow(2, F)
  const lsbInt = p.lsbFs / scaleF
  const intLo = p.signedReg ? -Math.pow(2, p.internalBits - 1) : 0
  const intHi = p.signedReg ? Math.pow(2, p.internalBits - 1) - 1 : Math.pow(2, p.internalBits) - 1
  const phyLo = p.signedReg ? -Math.pow(2, p.physicalBits - 1) : 0
  const phyHi = p.signedReg ? Math.pow(2, p.physicalBits - 1) - 1 : Math.pow(2, p.physicalBits) - 1
  let saturationCount = 0
  let wrapCount = 0
  const roundWith = (v: number): number => (p.rounding === 'nearest' ? Math.floor(v + 0.5) : p.rounding === 'truncate' ? Math.floor(v) : Math.floor(v + roundRng.uniform()))
  const clampOrWrap = (v: number, lo: number, hi: number): number => {
    if (v >= lo && v <= hi) return v
    if (p.overflow === 'saturate') {
      saturationCount++
      return v > hi ? hi : lo
    }
    wrapCount++
    const R = hi - lo + 1
    return lo + ((((v - lo) % R) + R) % R)
  }
  const wInt = new Float64Array(P)
  const physOf = (j: number): number => clampOrWrap(roundWith(wInt[j] / scaleF), phyLo, phyHi) * p.lsbFs
  const w: Float64Array[] = Array.from({ length: P }, () => new Float64Array(K + 1))
  const wPhys: Float64Array[] = Array.from({ length: P }, () => new Float64Array(K + 1))
  const G: Float64Array[] = Array.from({ length: P }, () => new Float64Array(K))
  const wCur = new Float64Array(P)
  for (let j = 0; j < P; j++) {
    const w0 = j === gIdx ? p.w0Fs : 0
    if (quantize) {
      wInt[j] = clampOrWrap(roundWith(w0 / lsbInt), intLo, intHi)
      wCur[j] = wInt[j] * lsbInt
      wPhys[j][0] = physOf(j)
    } else {
      wCur[j] = w0
      wPhys[j][0] = w0
    }
    w[j][0] = wCur[j]
  }

  // ── 穩態視窗 ──
  const Kend = Math.min(K, o.untilBlock ?? K)
  const W = trace ? Math.max(1, Math.min(o.windowBlocks ?? 1, Kend)) : 0
  const k0 = Kend - W
  const L = W * N
  const win = trace
    ? {
        x: new Float64Array(L),
        eDtc: new Float64Array(L),
        uPd: new Float64Array(L),
        e: new Float64Array(L),
        q: new Float64Array(L),
        xRef: new Float64Array(L),
        ux: new Float64Array(L),
        tOut: new Float64Array(L),
        tStatic: new Float64Array(L),
        tx: new Float64Array(L),
        tdx: hasNl ? new Float64Array(L) : null,
        t1p: pmux ? Array.from({ length: PMUX_PHASES }, () => new Float64Array(L)) : null,
        phase: pmux ? new Float64Array(L) : null,
      }
    : null

  // ── mean-field twin（權重在 block 內凍結；q → erf）──
  const inv = sigma > 0 ? 1 / (sigma * Math.SQRT2) : NaN
  const mfW: Float64Array[] = wantMf ? Array.from({ length: P }, () => new Float64Array(K + 1)) : []
  const mfC = wantMf ? new Float64Array(K) : null
  const mfB = wantMf ? new Float64Array(K) : null
  if (wantMf) for (let j = 0; j < P; j++) mfW[j][0] = j === gIdx ? p.w0Fs : 0
  const uxB = wantMf ? new Float64Array(N) : null
  const udB = wantMf && hasNl ? new Float64Array(N) : null
  const u1B: Float64Array[] = wantMf && pmux ? Array.from({ length: PMUX_PHASES }, () => new Float64Array(N)) : []
  const mfAcc = new Float64Array(P)

  let divergenceBlock: number | null = null
  const warnings: string[] = []
  const accs = new Float64Array(P)
  for (let k = 0; k < Kend; k++) {
    const kApp = k - dUp >= 0 ? k - dUp : 0
    const coef = a - wPhys[gIdx][kApp]
    if (D > 0) {
      xext.copyWithin(0, N, N + D)
      if (pext) pext.copyWithin(0, N, N + D)
      if (rext) rext.copyWithin(0, N, N + D)
      for (const r of rP) r.copyWithin(0, N, N + D)
    }
    src.fill(xext, pext, D, N)
    if (doNorm) for (let i = D; i < D + N; i++) xext[i] = (xext[i] - normOff) * normSc
    if (hatF && rext) for (let i = D; i < D + N; i++) rext[i] = hatF.step(xext[i])
    if (pext && hat) for (let i = D; i < D + N; i++) for (let j = 0; j < PMUX_PHASES; j++) rP[j][i] = hatP[j].step(pext[i] === j ? 1 : 0)
    const rec = win !== null && k >= k0
    const base = (k - k0) * N
    accs.fill(0)
    for (let n = 0; n < N; n++) {
      const x = xext[D + n]
      let dt = coef * x // DTC：(a − w_g,app)·x（P = 1、legacy 時與 runBlockLms 逐位元相同）
      let ph = -1
      if (pext) {
        ph = pext[D + n]
        dt += eps[ph] - wPhys[ph][kApp] // ← 差異：PMUX 第 p 相的 offset 減去該相的 PHOS 權重
      }
      if (hasNl) dt += nlOff + x * x * (nlC2 + nlC3 * x)
      const u = pathF === null ? dt : pathF.step(dt)
      const e = u + bOff + sigma * gauss()
      let q: number
      if (mapped) q = 2 * (e >= 0 ? 1 : 0) - 1
      else q = e >= 0 ? 1 : qLo
      const xrn = xr[n]
      accs[gIdx] += q * xrn // GOS 的 GMAC
      if (pext) {
        if (hat) for (let j = 0; j < PMUX_PHASES; j++) accs[j] += q * rP[j][n]
        else if (pext[n] >= 0) accs[pext[n]] += q // ← 差異：one-hot regressor（delayed D 時用 p[n−D]）：只有被選的那一相累加
      }
      // ── 分析用（不影響 G）──
      let ux = NaN
      let dx = 0
      if (uxB || rec) ux = uxF === null ? x : uxF.step(x)
      if (hasNl) dx = nlOff + x * x * (nlC2 + nlC3 * x)
      if (uxB) {
        uxB[n] = ux
        if (udB) udB[n] = udF === null ? dx : udF.step(dx)
        if (pext && pmux) for (let j = 0; j < PMUX_PHASES; j++) u1B[j][n] = identity ? (ph === j ? 1 : 0) : u1F[j].step(ph === j ? 1 : 0)
      }
      if (rec && win && tF && txF) {
        const i = base + n
        win.x[i] = x
        win.eDtc[i] = dt
        win.uPd[i] = u
        win.e[i] = e
        win.q[i] = q
        win.xRef[i] = xrn
        win.ux[i] = ux
        win.tOut[i] = tF.step(dt) // ← 差異：同一個 e_DTC 再走一次 T ⇒ output timing error
        win.tx[i] = txF.step(x)
        if (win.tdx && tdF) win.tdx[i] = tdF.step(dx)
        if (win.t1p) for (let j = 0; j < PMUX_PHASES; j++) win.t1p[j][i] = t1F[j].step(ph === j ? 1 : 0)
        if (win.phase) win.phase[i] = ph
      } else if (trace && tF && txF) {
        // 視窗之前也要讓 T 的狀態跟上（濾波器狀態跨 block 持續）
        tF.step(dt)
        txF.step(x)
        if (tdF) tdF.step(dx)
        for (let j = 0; j < t1F.length; j++) t1F[j].step(ph === j ? 1 : 0)
      }
    }
    // ── mean-field twin：這個 block（權重取 d 個 block 前的 ŵ）──
    if (wantMf && uxB && mfC && mfB) {
      const kMf = k - dUp >= 0 ? k - dUp : 0
      const cg = a - mfW[gIdx][kMf]
      mfAcc.fill(0)
      let c = 0
      let bsum = 0
      for (let n = 0; n < N; n++) {
        let eDet = cg * uxB[n] + (udB ? udB[n] : 0) + bOff
        if (pmux) for (let j = 0; j < PMUX_PHASES; j++) eDet += (eps[j] - mfW[j][kMf]) * u1B[j][n]
        const m = erfFast(eDet * inv)
        const mq = bug ? 0.5 * (1 + m) : m
        mfAcc[gIdx] += mq * xr[n]
        if (pext) {
          if (hat) for (let j = 0; j < PMUX_PHASES; j++) mfAcc[j] += mq * rP[j][n]
          else if (pext[n] >= 0) mfAcc[pext[n]] += mq
        }
        c += xr[n] * uxB[n]
        bsum += xr[n] * (eDet - cg * uxB[n])
      }
      for (let j = 0; j < P; j++) mfW[j][k + 1] = mfW[j][k] + mus[j] * (avg ? mfAcc[j] / N : mfAcc[j])
      mfC[k] = c / N
      mfB[k] = bsum / N
    }
    // ── 更新（每個權重；暫存器的亂數依 j 的順序消耗）──
    let bad = false
    for (let j = 0; j < P; j++) {
      const Gk = avg ? accs[j] / N : accs[j]
      G[j][k] = Gk
      if (quantize) {
        const incQ = roundWith((mus[j] * Gk) / lsbInt)
        wInt[j] = clampOrWrap(wInt[j] + incQ, intLo, intHi)
        wCur[j] = wInt[j] * lsbInt
        wPhys[j][k + 1] = physOf(j)
      } else {
        wCur[j] = wCur[j] + mus[j] * Gk
        wPhys[j][k + 1] = wCur[j]
      }
      w[j][k + 1] = wCur[j]
      if (!Number.isFinite(wCur[j]) || Math.abs(wCur[j]) > 1e12) bad = true
    }
    if (bad) {
      divergenceBlock = k + 1
      for (let j = 0; j < P; j++) {
        for (let i = k + 1; i < K; i++) G[j][i] = NaN
        for (let i = k + 2; i <= K; i++) {
          w[j][i] = NaN
          wPhys[j][i] = NaN
        }
      }
      warnings.push(`w 在 block ${k + 1} 發散（|w| > 1e12 fs 或非有限數），模擬停止`)
      break
    }
  }
  // #endregion
  if (saturationCount > 0) warnings.push(`gain register 飽和 ${saturationCount} 次（anti-windup / 調整範圍不足，§13.6）`)
  if (wrapCount > 0) warnings.push(`gain register 溢位 wrap ${wrapCount} 次：數值跳到另一端（RTL overflow bug，§16.1）`)

  // ── 指標 ──
  const metrics = labMetrics({ w: w[gIdx], wPhys: wPhys[gIdx], G: G[gIdx], a, qz: quantize, divergenceBlock, analytic: pr.analytic, lsb: p.lsbFs })
  metrics.saturationCount = saturationCount
  metrics.wrapCount = wrapCount
  const h0 = Math.ceil((K + 1) / 2)
  const perWeight = { meanW: new Array<number>(P).fill(NaN), stdW: new Array<number>(P).fill(NaN), bias: new Array<number>(P).fill(NaN), settlingBlock: new Array<number | null>(P).fill(null) }
  if (divergenceBlock === null) {
    for (let j = 0; j < P; j++) {
      const m = labMetrics({ w: w[j], wPhys: wPhys[j], G: G[j], a: target[j], qz: quantize, divergenceBlock: null, analytic: pr.analytic, lsb: p.lsbFs })
      perWeight.meanW[j] = m.meanW
      perWeight.stdW[j] = m.stdW
      perWeight.bias[j] = m.meanW - target[j]
      perWeight.settlingBlock[j] = m.settlingBlock
    }
  }
  let phosRmsFs = NaN
  let phosCommonFs = NaN
  if (pmux && divergenceBlock === null) {
    const r = eps.map((e, j) => perWeight.meanW[j] - e)
    phosCommonFs = r.reduce((s, v) => s + v, 0) / PMUX_PHASES
    phosRmsFs = Math.sqrt(r.reduce((s, v) => s + (v - phosCommonFs) * (v - phosCommonFs), 0) / PMUX_PHASES)
  }
  if (!pr.analytic.stableMean && divergenceBlock === null && Number.isFinite(pr.analytic.g) && pr.analytic.g > 0)
    warnings.push('線性化平均模型不穩定，但 sign-LMS 的 GMAC 有界（|G| ≤ max|x_ref|，sum 模式再乘 N），因此實際表現為大振幅振盪／limit cycle，而非數值發散')
  void h0

  // ── 視窗：w̄、靜態部分（線性疊加：T{(a − w̄_g)x + Σ(ε_p − w̄_p)1_p + d(x)}）──
  let window: LabLoopResult['window'] = null
  if (win) {
    const wApp = new Float64Array(W)
    const wBarP = new Float64Array(P)
    for (let jw = 0; jw < W; jw++) {
      const kk = k0 + jw
      const kA = kk - dUp >= 0 ? kk - dUp : 0
      for (let j = 0; j < P; j++) wBarP[j] += wPhys[j][kA]
      wApp[jw] = wPhys[gIdx][kA]
    }
    for (let j = 0; j < P; j++) wBarP[j] /= W
    const wBar = wBarP[gIdx]
    for (let i = 0; i < L; i++) {
      let ts = (a - wBar) * win.tx[i]
      if (win.tdx) ts += win.tdx[i]
      if (win.t1p) for (let j = 0; j < PMUX_PHASES; j++) ts += (eps[j] - wBarP[j]) * win.t1p[j][i]
      win.tStatic[i] = ts
    }
    window = {
      startBlock: k0,
      blocks: W,
      x: win.x,
      eDtc: win.eDtc,
      uPd: win.uPd,
      e: win.e,
      q: win.q,
      xRef: win.xRef,
      ux: win.ux,
      tOut: win.tOut,
      tStatic: win.tStatic,
      tx: win.tx,
      wApp,
      wBar,
      phase: win.phase,
    }
  }
  return {
    P,
    w,
    wPhys,
    G,
    metrics,
    perWeight,
    phosRmsFs,
    phosCommonFs,
    window,
    meanField: wantMf && mfC && mfB ? { w: mfW, C: mfC, B: mfB } : null,
    warnings,
    divergenceBlock,
  }
}

/** 與 blockLms 的 computeMetrics 相同的定義（後半段 block ⌈(K+1)/2⌉…K） */
function labMetrics(p: { w: Float64Array; wPhys: Float64Array; G: Float64Array; a: number; qz: boolean; divergenceBlock: number | null; analytic: BlockLmsAnalytic; lsb: number }): BlockLmsMetrics {
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

// #region core:pmuxChecks
/**
 * 9 個權重的交叉比對（pmux8_gos）：
 *   meanW：每個權重後半段的平均 vs mean-field 平均軌跡同一段的預測，容差 4 SE（AR(1)，ρ 取 9 權重平均模型的 spectral radius）+ 1 LSB；
 *   sigma：每個權重對平均軌跡的殘差 RMS vs dlyap 的穩態 σ 預測（±(4√(2/n_eff) + 15%)；沒有預測時 n/a）；
 *   stability：平均模型的 ρ < 1 與模擬要一致——穩定時模擬不發散；不穩定時模擬的可觀測殘差也不會收斂
 *     （sign-LMS 的 G 有界，不穩定表現為大振幅振盪、不是數值發散；這時 meanW / sigma 沒有固定點可比，標 n/a）。
 */
export function pmuxChecks(a: {
  p: LabParams
  analysis: MimoAnalysis
  w: Float64Array[]
  meanField: Float64Array[] | null
  diverged: boolean
}): PipelineMimo['checks'] {
  const { p, analysis } = a
  const P = a.w.length
  const K = a.w[0].length - 1
  const h0 = Math.ceil((K + 1) / 2)
  const m = K + 1 - h0
  const rho = Math.min(Math.abs(Number.isFinite(analysis.rho) ? analysis.rho : 0.999), 0.999999)
  const lsb = p.quantize ? p.lsbFs : 0
  const names = analysis.names
  if (a.diverged) {
    const na: CheckItem = { status: 'n/a', note: '$w$ 數值發散' }
    return { meanW: na, sigma: na, stability: { status: analysis.stable ? 'mismatch' : 'ok', note: analysis.stable ? '平均模型預測穩定，但模擬發散' : '平均模型預測不穩定（$\\rho\\ge1$），模擬也發散' } }
  }
  // 可觀測子空間的殘差大小：PHOS 與目標的差（共模不可觀測時先去共模）、GOS 的差乘上 x 經 H_PD 後的 RMS（換成 fs）
  const removeCMr = P > 1 && !analysis.commonModeObservable
  const gScale = Math.sqrt(Math.max(analysis.Ru[P - 1][P - 1], 0))
  const residNorm = (wv: number[]): number => {
    const rr = wv.map((v, j) => v - analysis.target[j])
    if (removeCMr) {
      const cm = rr.slice(0, PMUX_PHASES).reduce((acc, v) => acc + v, 0) / PMUX_PHASES
      for (let j = 0; j < PMUX_PHASES; j++) rr[j] -= cm
    }
    rr[P - 1] *= gScale
    return Math.sqrt(rr.reduce((acc, v) => acc + v * v, 0))
  }
  const r0 = residNorm(a.w.map((x) => x[0]))
  const rH = residNorm(
    a.w.map((x) => {
      let acc = 0
      for (let k = h0; k <= K; k++) acc += x[k]
      return acc / m
    }),
  )
  const resid = `可觀測子空間的殘差 $${texNum(r0, 4)}\\to${texNum(rH, 4)}\\,\\mathrm{fs}$（初值 → 後半段平均）`
  if (!analysis.stable) {
    const ratio = r0 > 1e-9 ? rH / r0 : NaN
    const stability: CheckItem = !Number.isFinite(ratio)
      ? { status: 'n/a', note: `平均模型預測不穩定（$\\rho=${texNum(analysis.rho, 5)}\\ge1$），但初值就在目標上，看不出收斂與否` }
      : ratio >= 0.1
        ? { status: 'ok', value: ratio, note: `平均模型預測不穩定（$\\rho=${texNum(analysis.rho, 5)}\\ge1$），模擬也沒有收斂：${resid}。sign-LMS 的 $G$ 有界，所以表現為大振幅振盪，不是數值發散` }
        : { status: 'mismatch', value: ratio, note: `平均模型預測不穩定（$\\rho=${texNum(analysis.rho, 5)}\\ge1$），模擬卻收斂了：${resid}。線性化（小訊號 $K_q$）在這個工作點不準` }
    const na: CheckItem = { status: 'n/a', note: '9 權重的平均模型不穩定：沒有固定點可比（同段的 mean-field 軌跡也不收斂）' }
    return { meanW: na, sigma: na, stability }
  }
  const stability: CheckItem = { status: 'ok', note: `9 權重平均模型的 spectral radius $${texNum(analysis.rho, 5)}<1$，模擬沒有發散；${resid}` }
  if (!a.meanField || !(p.sigmaV > 0)) {
    const na: CheckItem = { status: 'n/a', note: !(p.sigmaV > 0) ? '$\\sigma_v=0$：沒有 mean-field（erf 退化成 sign）' : '沒有 mean-field 平均軌跡' }
    return { meanW: na, sigma: na, stability }
  }
  let worst = 0
  let worstName = ''
  let worstD = 0
  let worstTol = 0
  const sigmaItems: { name: string; ratio: number; rel: number }[] = []
  // 共模不可觀測（H_PD(1) = 0）時，8 個 PHOS 權重一起偏同一個常數沒有恢復力（隨機漫步、由暫態決定），
  // dlyap 的 σ 也只涵蓋可觀測子空間 ⇒ PHOS 先各自減掉 8 個的平均（模擬與 mean-field 都減），再比平均與殘差
  const removeCM = P > 1 && !analysis.commonModeObservable
  const dev: Float64Array[] = Array.from({ length: P }, (_, j) => {
    const d = new Float64Array(K + 1)
    for (let k = h0; k <= K; k++) d[k] = a.w[j][k] - (a.meanField as Float64Array[])[j][k]
    return d
  })
  if (removeCM)
    for (let k = h0; k <= K; k++) {
      let cm = 0
      for (let j = 0; j < PMUX_PHASES; j++) cm += dev[j][k]
      cm /= PMUX_PHASES
      for (let j = 0; j < PMUX_PHASES; j++) dev[j][k] -= cm
    }
  for (let j = 0; j < P; j++) {
    let sm = 0
    let ms = 0
    let dm = 0
    for (let k = h0; k <= K; k++) {
      sm += a.meanField[j][k]
      ms += dev[j][k] * dev[j][k]
      dm += dev[j][k]
    }
    const mfHalf = sm / m
    const residRms = Math.sqrt(ms / m)
    const wm = mfHalf + dm / m // 後半段平均（去共模後）= mean-field 同段 + 平均差
    const sigPredJ = analysis.sigmaPred ? analysis.sigmaPred[j] : NaN
    // SE 用「dlyap 預測」與「實測殘差」較大者：9 權重的 σ 預測假設 GMAC 雜訊 iid，MASH code 下會略低估
    const sig = Math.max(Number.isFinite(sigPredJ) && sigPredJ > 0 ? sigPredJ : 0, residRms, lsb / Math.sqrt(12), 1e-12)
    const se = Math.sqrt(ar1MeanVar(sig * sig, rho, m))
    const tol = 4 * se + lsb + 1e-9 * Math.max(1, Math.abs(mfHalf))
    const d = Math.abs(wm - mfHalf)
    if (d / tol > worst) {
      worst = d / tol
      worstName = names[j]
      worstD = d
      worstTol = tol
    }
    if (Number.isFinite(sigPredJ) && sigPredJ > 0) {
      const nEff = m * ((1 - rho * rho) / (1 + rho * rho))
      sigmaItems.push({ name: names[j], ratio: residRms / sigPredJ, rel: 4 * Math.sqrt(2 / Math.max(nEff, 1e-9)) + 0.15 })
    }
  }
  const meanW: CheckItem = {
    status: worst <= 1 ? 'ok' : 'mismatch',
    value: worstD,
    analytic: 0,
    tolerance: worstTol,
    note: `${P} 個權重後半段的平均 vs mean-field 平均軌跡同段預測${removeCM ? '（PHOS 先去共模：共模經 $H_{\\mathrm{PD}}(1)=0$ 不可觀測）' : ''}：最差的是 $${worstName}$，差 $${texNum(worstD)}\\,\\mathrm{fs}$、容差 $4\\,\\mathrm{SE}${lsb > 0 ? '+1\\,\\mathrm{LSB}' : ''}=${texNum(worstTol)}\\,\\mathrm{fs}$（SE 由各權重的 $\\sigma$——dlyap 預測與實測殘差取較大者——與 $\\rho=${texNum(rho, 5)}$ 的 AR(1) 公式算出）`,
  }
  let sigma: CheckItem
  if (sigmaItems.length === 0) sigma = { status: 'n/a', note: analysis.sigmaPred ? '沒有可比的 $\\sigma$ 預測' : '9 個權重的穩態共變異未計算（更新延遲 $d$ 太大）' }
  else {
    const bad = sigmaItems.filter((x) => Math.abs(x.ratio - 1) > x.rel)
    const worstS = sigmaItems.reduce((acc, x) => (Math.abs(x.ratio - 1) > Math.abs(acc.ratio - 1) ? x : acc), sigmaItems[0])
    sigma = {
      status: bad.length === 0 ? 'ok' : 'mismatch',
      value: worstS.ratio,
      analytic: 1,
      tolerance: worstS.rel,
      note: `各權重對平均軌跡的殘差 RMS${removeCM ? '（PHOS 去共模）' : ''} / dlyap 的 $\\sigma$ 預測（可觀測子空間）：最差 $${worstS.name}$ 的比值 $${texNum(worstS.ratio, 4)}$，容差 $\\pm${texNum(worstS.rel, 3)}$（$4\\sqrt{2/n_{\\mathrm{eff}}}+15\\%$）${bad.length > 0 ? `；${bad.length} 個權重超出` : ''}`,
    }
  }
  return { meanW, sigma, stability }
}
// #endregion

/** 新引擎的整條 pipeline（spec 正負號、8 相 PMUX）：與 runPipeline 相同的輸出形狀，多了 engine 與 mimo。 */
function runPipelineLab(p: LabParams): PipelineResult {
  const t0 = now()
  const design = pllDesign(p)
  const pr = prepareLab(p, design)
  const K = pr.K
  const pmux = pr.P > 1
  const gIdx = pmux ? GOS_INDEX : 0
  const W0 = Math.max(1, Math.min(p.outBlocks, Math.floor(MAX_WINDOW_SAMPLES / p.N)))
  let res = runLabLoop(pr, { windowBlocks: W0, trace: true, meanField: true })
  const until = res.divergenceBlock !== null ? Math.max(1, res.divergenceBlock - 1) : K
  if (res.divergenceBlock !== null) {
    // 發散：視窗改取發散前的最後幾個 block（再跑一次到那裡為止；平均軌跡仍用整段的）
    const again = runLabLoop(pr, { windowBlocks: Math.min(W0, until), trace: true, meanField: false, untilBlock: until })
    res = { ...res, window: again.window }
  }
  const t1 = now()
  const an = pr.analytic
  const fOutHz = outputFrequencyHz(p)
  const code = codeStage(p, an)
  const warnings = pr.warnings.slice()
  for (const w of res.warnings) if (!warnings.includes(w)) warnings.push(w)
  const cfg = resolveConfig(toBlockLmsConfig(p))

  // 浮點對照（定點時；同 seed、同 prepare）
  let floatTwin: PipelineResult['floatTwin'] = null
  if (p.quantize) {
    const tw = runLabLoop(pr, { quantize: false })
    floatTwin = { meanW: tw.metrics.meanW, stdW: tw.metrics.stdW, bias: tw.metrics.bias }
  }
  // 跨級一致性：spec 正負號、單一 gain、浮點時與「a、w₀、c₃ 變號的 legacy」blockLms 鏡像逐位元比對；其餘沒有獨立的第二份實作
  let replay: PipelineResult['replay'] = null
  if (!pmux && !p.quantize) {
    const mirror: LabParams = { ...p, regressorSign: 'legacy', aFs: -p.aFs, w0Fs: -p.w0Fs, c3: -p.c3 }
    const ref = runBlockLms(toBlockLmsConfig(mirror, { record: { sample_trace_blocks: 0, decimate: 1 } }))
    let maxAbs = 0
    const kEnd = Math.min(until, ref.metrics.divergenceBlock !== null ? ref.metrics.divergenceBlock - 1 : K)
    for (let k = 0; k < kEnd; k++) {
      const d = Math.abs(res.G[gIdx][k] + ref.blocks.G[k])
      if (d > maxAbs || Number.isNaN(d)) maxAbs = Number.isNaN(d) ? Infinity : d
    }
    replay = { maxAbsDiffG: maxAbs, blocksCompared: kEnd }
  }
  const t2 = now()

  const rwin = res.window as NonNullable<LabLoopResult['window']>
  const idx = decimateIdx(rwin.x.length, TRACE_POINTS)
  const window: PipelineResult['window'] = {
    startBlock: rwin.startBlock,
    blocks: rwin.blocks,
    n: Float64Array.from(idx.map((i) => rwin.startBlock * p.N + i)),
    x: pick(rwin.x, idx),
    xRef: pick(rwin.xRef, idx),
    eDtc: pick(rwin.eDtc, idx),
    uPd: pick(rwin.uPd, idx),
    e: pick(rwin.e, idx),
    q: pick(rwin.q, idx),
    tOut: pick(rwin.tOut, idx),
  }
  const snipLen = Math.min(p.N, SNIPPET_SAMPLES)
  const snipStart = (rwin.blocks - 1) * p.N
  const cut = (a: Float64Array): Float64Array => a.slice(snipStart, snipStart + snipLen)
  const snippet: PipelineResult['snippet'] = {
    startSample: (rwin.startBlock + rwin.blocks - 1) * p.N,
    n: Float64Array.from({ length: snipLen }, (_, i) => (rwin.startBlock + rwin.blocks - 1) * p.N + i),
    x: cut(rwin.x),
    xRef: cut(rwin.xRef),
    eDtc: cut(rwin.eDtc),
    uPd: cut(rwin.uPd),
    e: cut(rwin.e),
    q: cut(rwin.q),
    tOut: cut(rwin.tOut),
    wApp: rwin.wApp[rwin.blocks - 1],
  }
  let output: OutputAnalysis | null = null
  if (res.divergenceBlock === null) {
    const firstOrder =
      !pmux && p.codeSource === 'dsm_first_order' && !p.dither
        ? (() => {
            const st = firstOrderResidueStats(p.frac, p.dsmBits)
            return { P: st.P, line1: st.line1, fracEff: st.fracEff }
          })()
        : null
    output = analyzeOutput({
      win: rwin,
      fs: p.fRefHz,
      fOut: fOutHz,
      N: p.N,
      T: design.T,
      H: design.H,
      mu: p.muFs,
      g: an.g,
      d: p.updateDelay,
      sigmaEta2: an.sigmaEta2,
      sigmaWPred: an.sigmaWPred,
      fL: p.fLHz,
      fH: p.fHHz,
      aFs: p.aFs,
      firstOrder,
      normScale: an.normalization.scale,
      staticLinearOnly: p.c2 === 0 && p.c3 === 0 && !p.quantize && !pmux,
    })
    if (pmux) output.notes.push('8 相 PMUX：靜態殘差含 PHOS 的殘差 $\\sum_p(\\varepsilon_p-\\bar w_p)1_p$；GOS 鋸齒跑在 $(8\\alpha\\bmod 1)$，一階封閉式的 fractional spur 不適用（以 findTones 為準）')
  }
  const t3 = now()

  const kIdx = decimateIdx(K + 1, 4000)
  const mf = res.meanField
  const mfGos = mf && until === K ? mf.w[gIdx] : null
  const lin = linearPrediction(an, p, K, mfGos)
  const blocks = {
    k: Float64Array.from(kIdx),
    w: pick(res.w[gIdx], kIdx),
    wPhys: pick(res.wPhys[gIdx], kIdx),
    G: pick(Float64Array.from([...res.G[gIdx], NaN]), kIdx),
    wMeanModel: pick(lin.traj, kIdx),
    wLinearModel: pick(lin.trajLinear, kIdx),
  }
  const fixedPointSwing = mf && until === K ? quasiStaticFixedPoint({ C: mf.C, B: mf.B }, p, an.Ex2) : null
  const modelLevel: LevelId = p.quantize ? 'L5' : 'L4'
  const checks = pipelineChecks({ params: p, analytic: an, metrics: res.metrics, w: res.w[gIdx], replay, output, code, floatTwin, meanField: mfGos })
  if (pmux) checks.noiseMix = { status: 'n/a', note: '8 相 PMUX：gain noise 含 PHOS 8 個權重的抖動（one-hot 經 $T$），單參數的 $\\sigma_w\\sqrt{\\bar x^2+\\mathrm{Var}(T\\{\\tilde x\\})}$ 近似不適用；以時域 RMS 為準' }
  if (!replay) checks.replay = { status: 'n/a', note: pmux ? '8 相 PMUX 的 9 權重迴路只有一份實作（runLabLoop）：沒有獨立重播；單一 gain、legacy 的逐位元一致性由 unifiedLab.test.ts 守住' : '定點暫存器（unsigned／rounding 不對稱）無法用變號的 blockLms 鏡像比對' }
  else if (replay.maxAbsDiffG === 0) checks.replay = { status: 'ok', value: 0, note: '新引擎（spec 正負號）的 $G_k$ 與「$a$、$w_0$、$c_3$ 變號的 legacy」runBlockLms 逐位元相反（$x\\to-x$ 的鏡像）：code → DTC → $H_{\\mathrm{PD}}$ → comparator → GMAC 每一級都對齊' }

  let mimo: PipelineMimo | null = null
  if (pmux && pr.mimo) {
    const P = pr.P
    const h0 = Math.ceil((K + 1) / 2)
    const mfHalf = (j: number): number => {
      if (!mf) return NaN
      let s = 0
      for (let k = h0; k <= K; k++) s += mf.w[j][k]
      return s / (K + 1 - h0)
    }
    const removeCM = !pr.mimo.commonModeObservable && res.divergenceBlock === null
    const stdObsOf = (j: number): number => {
      if (!removeCM || j >= PMUX_PHASES) return res.perWeight.stdW[j]
      let s1 = 0
      let s2 = 0
      for (let k = h0; k <= K; k++) {
        let cm = 0
        for (let i = 0; i < PMUX_PHASES; i++) cm += res.w[i][k]
        const v = res.w[j][k] - cm / PMUX_PHASES
        s1 += v
        s2 += v * v
      }
      const n = K + 1 - h0
      return n > 1 ? Math.sqrt(Math.max(0, (s2 - (s1 * s1) / n) / (n - 1))) : NaN
    }
    const perWeight = Array.from({ length: P }, (_, j) => ({
      name: pr.mimo!.names[j],
      target: pr.target[j],
      meanW: res.perWeight.meanW[j],
      stdW: res.perWeight.stdW[j],
      stdObs: stdObsOf(j),
      bias: res.perWeight.bias[j],
      settlingBlock: res.perWeight.settlingBlock[j],
      sigmaPred: pr.mimo!.sigmaPred ? pr.mimo!.sigmaPred[j] : null,
      meanFieldHalf: mfHalf(j),
    }))
    let phosRmsMf = NaN
    if (mf) {
      const r = Array.from({ length: PMUX_PHASES }, (_, j) => mfHalf(j) - pr.target[j])
      const cm = r.reduce((s, v) => s + v, 0) / PMUX_PHASES
      phosRmsMf = Math.sqrt(r.reduce((s, v) => s + (v - cm) * (v - cm), 0) / PMUX_PHASES)
    }
    mimo = {
      analysis: pr.mimo,
      names: pr.mimo.names,
      target: pr.target,
      blocks: { k: Float64Array.from(kIdx), w: res.w.map((v) => pick(v, kIdx)), wMeanModel: mf ? mf.w.map((v) => pick(v, kIdx)) : res.w.map(() => new Float64Array(kIdx.length).fill(NaN)) },
      perWeight,
      phosRmsFs: res.phosRmsFs,
      phosCommonFs: res.phosCommonFs,
      phosRmsMeanFieldFs: phosRmsMf,
      checks: pmuxChecks({ p, analysis: pr.mimo, w: res.w, meanField: mf && until === K ? mf.w : null, diverged: res.divergenceBlock !== null }),
      windowPhase: rwin.phase ? pick(rwin.phase, idx) : null,
      snippetPhase: rwin.phase ? cut(rwin.phase) : null,
    }
  }
  const stages = buildStages({ p, cfg, design, code, an, metrics: res.metrics, warnings, win: rwin, out: output, replay, fOutHz, loopLevel: pr.modelLevel, swing: fixedPointSwing, lin, mimo: mimo ? { analysis: mimo.analysis, phosRmsFs: mimo.phosRmsFs, phosCommonFs: mimo.phosCommonFs } : null })
  const sgnText = p.regressorSign === 'spec' ? '$x=s/M\\ge0$（§2a；一階 DSM 時 $x\\in[0,1)$ 的鋸齒，code 越大 feedback edge 越早到）' : '$x=r=-s/M\\le0$（legacy；與既有 preset、golden vector 相同）'
  const assumptions = [
    `時間單位 fs；code 依 ${p.normalization} 正規化後無因次；$a$、$w$ 的單位為 fs per unit code；極性 $\\delta=a-w$；regressor 正負號 ${sgnText}`,
    '$f_s=f_{\\mathrm{ref}}$：每個 DSM sample 對應一個 DTC code、一個 comparator sample（多速率未建模）',
    pmux
      ? `8 相 PMUX 在回授路徑、DTC 在 reference 輸入端：DSM 跑在 $(8\\alpha\\bmod 1)$（單位 $\\Delta=T_{\\mathrm{vco}}/8$），PMUX 相位 $p[n]=P[n]\\bmod 8$${p.pmuxOrder === 'random' ? '（再疊上已知的隨機旋轉 $m[n]$，DTC code 加 $m$）' : ''}；PD 的輸出 $u_{\\mathrm{pd}}=H_{\\mathrm{PD}}\\{(a-w_{g})x+(\\varepsilon_{p}-w_{p})+d(x)\\}$，comparator 取它：$e=u_{\\mathrm{pd}}+b+v$`
      : 'DTC 在 reference 輸入端，回授路徑只有 divider；comparator 取 PD 的輸出：$e[n]=H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}[n]+b+v[n]$，$e_{\\mathrm{DTC}}=(a-w_{\\mathrm{app}})x+o_{\\mathrm{DTC}}+c_2x^2+c_3x^3$；$H_{\\mathrm{PD}}$ 狀態跨 block 持續（§15.2）',
    pmux ? `9 個權重各自一個 GMAC：$G_g=\\tfrac1N\\sum q\\,x_{\\mathrm{ref}}$、$G_p=\\tfrac1N\\sum q\\,1\\{p[n-D]=p\\}$；更新 $w_g\\leftarrow w_g+\\mu G_g$（$\\mu=${p.muFs}\\,\\mathrm{fs}$）、$w_p\\leftarrow w_p+\\mu_pG_p$（$\\mu_p=${p.muPhosFs}\\,\\mathrm{fs}$）；PHOS 的目標 $\\varepsilon_p$ 是固定圖樣 × RMS $${p.phosRmsFs}\\,\\mathrm{fs}$（illustrative），共模經 $H_{\\mathrm{PD}}(1)=0$ 不可觀測` : '',
    `$v[n]$ 為 iid Gaussian（$\\sigma_v=${p.sigmaV}\\,\\mathrm{fs}$），與 code 獨立；$q=\\mathrm{sign}(e)$，tie 規則 $e\\ge0\\Rightarrow q=+1$（E07）`,
    design.kind === 'none' ? `主 PLL：${design.description}；PD 與輸出兩條路徑都取全通，所以這個基準不滿足 $H_{\\mathrm{PD}}+T=1$` : `主 PLL：${design.description}；$T=1-H_{\\mathrm{PD}}$（線性、時不變）`,
    '$K_q=\\sqrt{2/\\pi}/\\sigma_v$ 是小訊號近似（$|e_{\\mathrm{det}}|\\ll\\sigma_v$）；$\\sigma_w$ 預測假設 GMAC 雜訊 iid 且線性化有效' + (pmux ? '（9 權重：$\\mathrm{Cov}(\\delta)$ 由離散 Lyapunov 方程解出，F-LAB.20）' : ''),
    `$C$、固定點由前 $2^{17}$ 個 code 樣本估計（mean-field 固定點用 $2^{14}$ 個）`,
    `輸出分析：最後 $${rwin.blocks}$ 個 block（$${rwin.blocks * p.N}$ 個 samples）的視窗；靜態殘差用該視窗的 $\\bar w$${pmux ? '（9 個權重各自的平均）' : ''}`,
    '輸出端只含 DTC 殘差這一個雜訊來源（VCO / reference / PD 自身雜訊未計）',
    p.quantize ? `gain register 定點（L5）：內部 $${p.internalBits}$ bits、實體 $${p.physicalBits}$ bits、$\\Delta=${p.lsbFs}\\,\\mathrm{fs}$、rounding = ${p.rounding}、overflow = ${p.overflow}${pmux ? '（9 個權重共用同一組設定）' : ''}` : 'gain register 未量化：$w$ 為理想浮點',
    `模擬版本 ${UNIFIED_LAB_VERSION}（迴路由 unifiedLab.ts 的 runLabLoop 執行：與 runBlockLms 相同的 inner loop 推廣成 ${pr.P} 個權重與兩種正負號；單一 gain、legacy 時與 runBlockLms 逐位元相同）`,
  ].filter((x) => x !== '')
  return {
    version: UNIFIED_LAB_VERSION,
    params: { ...p },
    config: cfg,
    fOutHz,
    pll: design,
    code,
    analytic: an,
    metrics: res.metrics,
    loopLevel: pr.modelLevel,
    modelLevel,
    blocks,
    meanModel: lin.model,
    fixedPointSwing,
    window,
    snippet,
    replay,
    output,
    floatTwin,
    stages,
    checks,
    warnings,
    assumptions,
    timingMs: { loop: t1 - t0, replay: t2 - t1, output: t3 - t2 },
    engine: 'labLoop',
    mimo,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 帶入手算用的封閉式（HC-LAB.1、HC-LAB.2）：9 權重資訊矩陣的特徵值與 μ 上限；三階 CPPLL 的反號帶緣
// ───────────────────────────────────────────────────────────────────────────

// #region core:pmuxClosedFormEigen
/**
 * H_PD = 1（none 路徑）、8 相等機率走訪、x 與相位獨立時，9 權重的資訊矩陣 R = E[φφᵀ] 有封閉式：
 *   R_pp' = δ_pp'/8，R_px = E[x]/8，R_xx = E[x²]。
 * 7 個「和為 0」的 PHOS 模式（與 x 無關）各有 λ = 1/8；剩下 2 維（共模方向 1/√8 與 x）是
 *   [[1/8, b],[b, E[x²]]]，b = E[x]/√8 ⇒ λ± = (1/8 + E[x²])/2 ± √(((1/8 − E[x²])/2)² + b²)。
 * 共用步長 μ 時每個模式的 pole 是 1 − μ K_q λ ⇒ μ_max = 2/(K_q λ_max)，最慢的模式 τ = 1/(μ K_q λ_min)。
 */
export function pmuxClosedFormEigen(Ex: number, Ex2: number): { b: number; lambdaPlus: number; lambdaMinus: number; lambdaPhos: number; lambdaMax: number; lambdaMin: number; cond: number; R: Matrix } {
  const a = 1 / PMUX_PHASES
  const b = Ex / Math.sqrt(PMUX_PHASES)
  const half = (a + Ex2) / 2
  const root = Math.sqrt(((a - Ex2) / 2) ** 2 + b * b)
  const lambdaPlus = half + root
  const lambdaMinus = half - root
  const lambdaMax = Math.max(lambdaPlus, a)
  const lambdaMin = Math.min(lambdaMinus, a)
  const R: Matrix = Array.from({ length: PMUX_WEIGHTS }, (_, i) => Array.from({ length: PMUX_WEIGHTS }, (_, j) => (i === GOS_INDEX && j === GOS_INDEX ? Ex2 : i === GOS_INDEX || j === GOS_INDEX ? Ex / PMUX_PHASES : i === j ? a : 0)))
  return { b, lambdaPlus, lambdaMinus, lambdaPhos: a, lambdaMax, lambdaMin, cond: lambdaMax / lambdaMin, R }
}
// #endregion

/** 共用步長的 μ 上限與最慢模式的時間常數（M = μI、H_PD = 1 的 9 權重模型） */
export function pmuxUniformStepLimits(Kq: number, lambdaMax: number, lambdaMin: number, mu: number): { muMax: number; tauSlowBlocks: number; tauFastBlocks: number } {
  return { muMax: 2 / (Kq * lambdaMax), tauSlowBlocks: 1 / (mu * Kq * lambdaMin), tauFastBlocks: 1 / (mu * Kq * lambdaMax) }
}

// #region core:cppll3MinusReL
/**
 * impulse-invariant 三階 CPPLL 的 −Re L(f)（f 以 f_s 正規化；sspll.ts cppllMinusReL 的同一式）：
 *   −Re L = K/(4 sin²(Ω/2)) + B(1 − p²)/(2|1 − p e^{−jΩ}|²)，Ω = 2πf。
 * 反號帶 Re H_PD < 0 ⟺ 1 + Re L < 0 ⟺ −Re L > 1；−Re L 對 f 單調遞減，所以帶緣是 −Re L(f) = 1 的唯一根（loop latency = 1 拍時）。
 */
export function cppll3MinusReL(d: Pick<Cppll3Design, 'K' | 'B' | 'p'>, f: number): { term1: number; term2: number; total: number } {
  const W = 2 * Math.PI * f
  const s = Math.sin(W / 2)
  const den = 1 - 2 * d.p * Math.cos(W) + d.p * d.p
  const term1 = d.K / (4 * s * s)
  const term2 = (d.B * (1 - d.p * d.p)) / (2 * den)
  return { term1, term2, total: term1 + term2 }
}
// #endregion

/** 反號帶上緣（正規化 f）：−Re L(f) = 1 的根（二分法；整段都 > 1 時回傳 0.5） */
export function cppll3InversionEdge(d: Pick<Cppll3Design, 'K' | 'B' | 'p'>): number {
  const g = (f: number) => cppll3MinusReL(d, f).total - 1
  if (g(0.5) >= 0) return 0.5
  let lo = 1e-9
  let hi = 0.5
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi)
    if (mid === lo || mid === hi) break
    if (g(mid) > 0) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}
