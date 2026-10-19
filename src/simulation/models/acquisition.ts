import { createRng, erfc, normCdf, type Rng } from '@/simulation/core'
import { dtcCompensation, dtcRangeBudget } from './dtc'

/**
 * Ch14 §14.6b：PLL acquisition 與校正 enable 條件（depth 審查：LOCK 不能只是一個計數器）。
 *
 * 模型（全部 illustrative；架構照 docs/assumptions.md §2a：Reference → DTC → PD → LF → VCO，回授只有 divider）：
 *   1. FLL（頻率鎖定）：一階離散模型，每個 reference 週期 n 更新一次
 *        Δf[n+1] = (1 − K_f) Δf[n] − K_f e_f[n],   K_f = K_vco g_f / (M f_ref)
 *      Δf 是 VCO 端的頻率誤差 [Hz]，e_f 是頻率估計的雜訊（iid Gaussian，RMS σ_f）；
 *      lock detect：|Δf̂| < f_tol 連續 N_ld 個週期才宣告頻率鎖定（Δf̂ = Δf + e_f）。
 *   2. SSPD 的兩層條件：
 *      (a) 倍頻捕獲（為什麼 SSPLL 一定要有 FLL）：SSPD 用 reference edge 取樣 VCO 波形，f_vco = (M + k) f_ref（k 整數）
 *          在取樣點看起來完全一樣——取樣點每個週期移動 ΔT = (Δf/f_ref)·T_vco，整數個 T_vco 看不見，所以 SSPD 只看得到
 *          混疊後的 Δf − k f_ref，會把 VCO 拉到最近的那一根（k = round(Δf/f_ref)）。|Δf| < f_ref/2（k = 0）才是對的第 M 根；
 *          頻率偵測走 divider（數得出 M），由 FLL 先把 f_vco 拉進這個捕獲範圍。
 *      (b) 相位層級：PD 輸出 ∝ sin(2π θ / T_vco)（θ 是 reference edge 對 VCO 波形的時間誤差 [fs]）：
 *          斜率為正（單調）只在 |θ| < T_vco/4，恢復力方向正確（不 cycle slip）只在 |θ| < T_vco/2；
 *          超出 ±T_vco/2 就跳到相鄰的 VCO 週期（cycle slip）。phase lock：|θ| < θ_max 連續 N_pl 個週期。
 *   3. 校正 enable = 頻率鎖定 ∧ 倍頻捕獲（|Δf̂| < f_ref/2）∧ phase lock ∧ 迴路穩態（最近 W 個週期 θ 的 rms < rms_max）
 *      ∧ DTC 工作點在範圍內（Ch04 §5b 的 dtcRangeBudget／dtcCompensation：補償量 w·x 在 code 範圍內、沒有飽和）。
 *   4. 狀態機 ACQ(FLL) → PLOCK → CAL → HOLD／RECAL，含失鎖回退（|Δf̂| > f_unlock 連續 N_ul 個週期 → ACQ；
 *      cycle slip 或 |θ| ≥ θ_max → HOLD → 重新 phase lock 後 RECAL（通知 block 級狀態機先 VERIFY）→ CAL）。
 *
 * 時間單位：reference 週期（每個 reference edge 一次 PD 取樣）；校正的 block = N 個 reference 週期，
 * 所以 Ch14 §14.7 的 LOCK 長度 = ⌈n_enable / N⌉ 個 block。相位誤差一律以時間（fs）表示，和 §14.0 的極性相位 θ（度）不同。
 * 閉迴路的相位迴路用一階（只有比例路徑）的線性化：θ[n+1] = θ[n] − g_p S(θ[n] + v[n]) + ΔT，
 * g_p = 1 − exp(−2π f_BW T_ref)、ΔT = Δf_h/(M f_ref²) 是殘餘頻率誤差造成的每週期相位斜坡；Type-II 迴路的積分器
 * 會把靜態偏移 ΔT/g_p 積掉，這裡保留它（最壞情況）。
 *
 * Python golden：golden/lms_pll_golden/acquisition.py（同一套公式與確定性模擬）；vector golden/vectors/acquisition_timeline.json。
 */

export const ACQ_STATES = ['ACQ', 'PLOCK', 'CAL', 'HOLD', 'RECAL'] as const
export type AcqState = (typeof ACQ_STATES)[number]

export const ACQ_STATE_LABEL: Record<AcqState, string> = {
  ACQ: 'ACQ：FLL 拉頻率（PLL 相位迴路未閉合、校正關閉）',
  PLOCK: 'PLOCK：FLL 凍結、相位迴路閉合，等 phase lock 與穩態',
  CAL: 'CAL：校正 enable（block 級狀態機可以更新）',
  HOLD: 'HOLD：cycle slip 或相位超出門檻，校正暫停、係數保持',
  RECAL: 'RECAL：重新鎖定後的一個週期，通知 block 級狀態機先 VERIFY 再更新',
}

export type PdShape = 'sine' | 'linear'

export interface AcqParams {
  seed: number
  /** 參考頻率 f_ref [Hz] */
  fRefHz: number
  /** 除頻比 M：f_vco = M f_ref */
  divRatio: number
  /** VCO／DCO 增益 K_vco [Hz/LSB] */
  kVcoHzPerLsb: number
  /** FLL 迴路增益 g_f [LSB／週期／單位正規化頻率誤差]；K_f = K_vco g_f/(M f_ref) */
  fllGainLsb: number
  /** 初始頻率誤差 Δf_0 [Hz]（VCO 端） */
  df0Hz: number
  /** 頻率估計每週期的雜訊 RMS σ_f [Hz]（iid Gaussian） */
  sigmaFHz: number
  /** lock detect：|Δf̂| < f_tol 連續 N_ld 個週期 */
  fTolHz: number
  nLd: number
  /** 失鎖判定（hysteresis）：|Δf̂| > f_unlock 連續 N_ul 個週期 */
  fUnlockHz: number
  nUl: number
  /** PLL 閉迴路頻寬 f_BW [Hz] → g_p = 1 − exp(−2π f_BW/f_ref) */
  fBwHz: number
  /** PD 特性：sine（SSPD，|θ| < T_vco/4 單調）或 linear（L1 線性化，只有 ±T_vco/2 的 wrap） */
  pdShape: PdShape
  /** PD 端每週期的雜訊 RMS σ_θ [fs]（就是 Ch14 的 σ_v：同一個 PD 輸出節點） */
  sigmaThetaFs: number
  /** FLL 交棒（進 PLOCK）時的相位誤差 θ_0 [fs]（最壞情況接近 T_vco/2） */
  theta0Fs: number
  /** phase lock：|θ| < θ_max 連續 N_pl 個週期 */
  thetaMaxFs: number
  nPl: number
  /** 迴路穩態：最近 W 個週期 θ 的 rms < rms_max */
  settleWindow: number
  rmsMaxFs: number
  /** DTC 工作點（Ch04 §5b dtcRangeBudget）：位元數、校正範圍比例、INL 峰值 */
  dtcBits: number
  dtcCalRangeFrac: number
  dtcInlPeakFs: number
  /** 要檢查的補償 gain（fs）：通常是初始暫存器 w_0 與真實 a_0；每個都要在 x 的兩端不飽和 */
  dtcGainsFs: number[]
  /** code 的範圍 [x_min, x_max]（Ch14 用 ±1 的雙極 code；§2a 的一般約定是 x = s/M ∈ [0, 1)，這裡是例外，見 docs/assumptions.md §2a 第 8 點） */
  dtcXRange: [number, number]
  /** 模擬長度 [ref 週期] */
  cycles: number
  /** 失鎖事件：在第 lossCycle 個週期 VCO 頻率跳 Δf_loss（< 0 = 無） */
  lossCycle: number
  lossDfHz: number
  /** 校正 block 的長度 N（ref 週期）：LOCK blocks = ⌈n_enable/N⌉ */
  blockN: number
}

export interface AcqEvent {
  n: number
  kind: 'state' | 'lock' | 'slip' | 'unlock' | 'enable' | 'hold'
  msg: string
}

export interface AcqSegment {
  state: AcqState
  from: number
  /** 結束週期（不含）；最後一段 = cycles */
  to: number
  /** 進入這一段的條件（給時間表用，支援 $…$） */
  reason: string
}

export interface AcqSummary {
  /** 宣告頻率鎖定的週期（第一次）；−1 = 沒有 */
  freqLockCycle: number
  /** 宣告 phase lock 的週期；−1 = 沒有 */
  phaseLockCycle: number
  /** rms 視窗首次低於門檻的週期；−1 = 沒有 */
  settleCycle: number
  /** 校正首次 enable（進 CAL）的週期；−1 = 沒有 */
  enableCycle: number
  /** LOCK 的 block 數 ⌈(enableCycle + 1)/N⌉；沒有 enable 時為 Infinity */
  lockBlocks: number
  slips: number
  unlocks: number
  holds: number
  /** DTC 工作點檢查 */
  dtcOk: boolean
  dtcReason: string
  /** 失鎖事件後重新 enable 所需的週期數（從 lossCycle 算起）；沒有事件或沒有重新 enable 時為 −1 */
  relockCycles: number
  relockBlocks: number
  /** FLL 交棒時的殘餘頻率誤差 [Hz] */
  dfHandoffHz: number
}

export interface AcqResult {
  /** 逐週期：頻率誤差 Δf[n]（真值）、相位誤差 θ[n]（ACQ 期間為 NaN）、狀態索引 */
  df: Float64Array
  theta: Float64Array
  state: Uint8Array
  events: AcqEvent[]
  segments: AcqSegment[]
  summary: AcqSummary
}

// ───────────────────────────── 基本量 ─────────────────────────────

// #region core:fllGain
/** FLL 每週期增益 K_f = K_vco g_f/(M f_ref)：DAC 一個 LSB 改 K_vco Hz，FLL 每週期依正規化誤差 Δf/(M f_ref) 改 g_f 個 LSB。 */
export function fllGain(p: Pick<AcqParams, 'kVcoHzPerLsb' | 'fllGainLsb' | 'divRatio' | 'fRefHz'>): number {
  return (p.kVcoHzPerLsb * p.fllGainLsb) / (p.divRatio * p.fRefHz)
}

/** 由想要的 K_f 反推 FLL 增益 g_f（實驗的 K_f 控制項用）。 */
export function fllGainLsbFor(kF: number, p: Pick<AcqParams, 'kVcoHzPerLsb' | 'divRatio' | 'fRefHz'>): number {
  return (kF * p.divRatio * p.fRefHz) / p.kVcoHzPerLsb
}
// #endregion

/** VCO 週期 T_vco [fs] = 1/(M f_ref)。 */
export function tVcoFs(p: Pick<AcqParams, 'divRatio' | 'fRefHz'>): number {
  return 1e15 / (p.divRatio * p.fRefHz)
}

/** 相位迴路每週期增益 g_p = 1 − exp(−2π f_BW T_ref)（一階閉迴路在一個 reference 週期內的衰減）。 */
export function phaseLoopGain(p: Pick<AcqParams, 'fBwHz' | 'fRefHz'>): number {
  return 1 - Math.exp((-2 * Math.PI * p.fBwHz) / p.fRefHz)
}

/** 殘餘頻率誤差 Δf 造成的每週期相位斜坡 ΔT = Δf/(M f_ref²) [fs]（divider 輸出週期與 T_ref 的差）。 */
export function rampFsPerCycle(dfHz: number, p: Pick<AcqParams, 'divRatio' | 'fRefHz'>): number {
  return (dfHz / (p.divRatio * p.fRefHz * p.fRefHz)) * 1e15
}

export interface HarmonicCapture {
  /** SSPD 的倍頻捕獲範圍 f_ref/2 [Hz] */
  captureHz: number
  /** SSPD 會把 VCO 拉到的倍頻：f_vco → (M + k) f_ref，k = round(Δf/f_ref)（.5 往上取） */
  k: number
  /** SSPD 實際看得到的（混疊後的）頻率誤差 Δf − k f_ref [Hz] */
  aliasHz: number
  /** |Δf| < f_ref/2：最近的那一根就是對的第 M 根 */
  ok: boolean
}

// #region core:harmonicCapture
/**
 * SSPD 的倍頻模糊：每個 reference 週期 VCO 走 f_vco/f_ref = M + Δf/f_ref 個週期，取樣點在 VCO 波形上移動 ΔT = (Δf/f_ref)·T_vco；
 * 整數個 T_vco 看不見，所以 Δf 與 Δf − k f_ref 給出完全相同的取樣序列，SSPD 只會把 VCO 拉到最近的 (M + k) f_ref。
 * |Δf| < f_ref/2（k = 0）才是對的第 M 根——這是 SSPLL 需要 FLL（divider 路徑的頻率偵測，數得出 M）的第一個理由。
 */
export function harmonicCapture(dfHz: number, p: Pick<AcqParams, 'fRefHz'>): HarmonicCapture {
  const k = Math.floor(dfHz / p.fRefHz + 0.5)
  return { captureHz: p.fRefHz / 2, k, aliasHz: dfHz - k * p.fRefHz, ok: Math.abs(dfHz) < p.fRefHz / 2 }
}
// #endregion

// #region core:pdCharacteristic
/** PD 特性 S(θ)：linear 就是 θ；sine 是 SSPD 的 (T_vco/2π) sin(2π θ/T_vco)（在 0 附近斜率 1，|θ| = T_vco/4 時斜率 0）。 */
export function pdCharacteristic(thetaFs: number, tVco: number, shape: PdShape): number {
  if (shape === 'linear') return thetaFs
  return (tVco / (2 * Math.PI)) * Math.sin((2 * Math.PI * thetaFs) / tVco)
}

/** 把相位誤差折回 (−T_vco/2, T_vco/2]：超出就是 cycle slip（跳到相鄰的 VCO 週期）。 */
export function wrapTheta(thetaFs: number, tVco: number): { theta: number; slipped: boolean } {
  if (thetaFs > tVco / 2 || thetaFs <= -tVco / 2) {
    const k = Math.round(thetaFs / tVco)
    return { theta: thetaFs - k * tVco, slipped: true }
  }
  return { theta: thetaFs, slipped: false }
}
// #endregion

// ───────────────────────────── 封閉式 ─────────────────────────────

// #region core:fllClosedForm
/** 無雜訊 FLL：|Δf[n]| = (1 − K_f)^n |Δf_0| 首次 < f_tol 的週期 n_c = ⌈ln(f_tol/|Δf_0|)/ln(1 − K_f)⌉（已在門檻內為 0）。 */
export function fllCyclesToTol(df0Hz: number, fTolHz: number, kF: number): number {
  if (!(kF > 0 && kF < 1) || !(fTolHz > 0)) return Infinity
  if (Math.abs(df0Hz) < fTolHz) return 0
  return Math.ceil(Math.log(fTolHz / Math.abs(df0Hz)) / Math.log(1 - kF) - 1e-9)
}

/** 無雜訊時宣告頻率鎖定的週期：從 n_c 起連續 N_ld 個週期都在視窗內 ⇒ n_FL = n_c + N_ld − 1。 */
export function fllLockCycle(df0Hz: number, fTolHz: number, kF: number, nLd: number): number {
  const nc = fllCyclesToTol(df0Hz, fTolHz, kF)
  return Number.isFinite(nc) ? nc + Math.max(1, nLd) - 1 : Infinity
}
// #endregion

// #region core:lockDetectStats
/** 單一週期的頻率估計落在 ±f_tol 內的機率（真實誤差 Δf、估計雜訊 σ_f 的 Gaussian）：Φ((f_tol − Δf)/σ_f) − Φ((−f_tol − Δf)/σ_f)。 */
export function lockDetectInWindowProb(dfHz: number, fTolHz: number, sigmaFHz: number): number {
  if (!(sigmaFHz > 0)) return Math.abs(dfHz) < fTolHz ? 1 : 0
  return normCdf((fTolHz - dfHz) / sigmaFHz) - normCdf((-fTolHz - dfHz) / sigmaFHz)
}

/** 誤報：真實誤差 Δf_x（> f_tol）時，N_ld 個連續樣本全部落在視窗內而被宣告鎖定的機率 p_in(Δf_x)^{N_ld}（樣本獨立）。 */
export function lockDetectFalseAlarm(dfXHz: number, fTolHz: number, sigmaFHz: number, nLd: number): number {
  return Math.pow(lockDetectInWindowProb(dfXHz, fTolHz, sigmaFHz), nLd)
}

/** 漏報：真實誤差為 0 時，一個 N_ld 的視窗沒有全部落在門檻內（這次沒宣告）的機率 1 − p_in(0)^{N_ld}；以 erfc／log1p 算避免相消。 */
export function lockDetectMiss(fTolHz: number, sigmaFHz: number, nLd: number): number {
  if (!(sigmaFHz > 0)) return 0
  const q = erfc(fTolHz / sigmaFHz / Math.SQRT2) // 1 − p_in(0) = 2(1 − Φ(z))
  return -Math.expm1(nLd * Math.log1p(-q))
}

/** 每個樣本成功機率 p 時，第一次出現連續 N 個成功所需的期望樣本數 E[T_N] = (1 − p^N)/((1 − p) p^N)（p = 1 時為 N）。 */
export function expectedRunLength(p: number, N: number): number {
  if (!(p > 0)) return Infinity
  if (p >= 1) return N
  const pN = Math.pow(p, N)
  return (1 - pN) / ((1 - p) * pN)
}

/**
 * 有雜訊時宣告頻率鎖定的平均週期（quasi-static renewal 近似）：|Δf[n]| = (1 − K_f)^n |Δf_0| 的變化比 N_ld 個週期慢得多時，
 * 每個週期「完成一段連續 N_ld 個在窗內」的機率約為 λ(n) = 1/E[T_N](p_n) = (1 − p_n) p_n^N/(1 − p_n^N)，p_n = p_in(Δf[n])；
 * 存活機率 S(n) = exp(−Σ_{m≤n} λ(m))，平均宣告週期 E[n_FL] ≈ Σ_{n≥0} S(n)。
 * 忽略 FLL 本身被雜訊推動的量（穩態 RMS ≈ σ_f √(K_f/2) ≪ σ_f）與 run 從頭數的記憶；和 Monte Carlo 差 1% 左右（acquisition.test.ts）。
 * 單一視窗要 p_in^N ≈ ½（真實誤差約 f_tol − 2σ_f）才有一半機會通過，但每個週期都是新的嘗試，所以平均宣告比那個點早。
 */
export function lockDetectMeanCycle(df0Hz: number, fTolHz: number, kF: number, sigmaFHz: number, nLd: number, maxCycles = 1 << 24): number {
  if (!(kF > 0 && kF < 1) || !(fTolHz > 0)) return Infinity
  let df = Math.abs(df0Hz)
  let hazard = 0
  let mean = 0
  for (let n = 0; n < maxCycles; n++) {
    const p = lockDetectInWindowProb(df, fTolHz, sigmaFHz)
    const lam = p > 0 ? 1 / expectedRunLength(p, nLd) : 0
    hazard += lam
    const surv = Math.exp(-hazard)
    mean += surv
    if (surv < 1e-12) return mean
    df *= 1 - kF
  }
  return Infinity
}
// #endregion

export interface SlipBoundary {
  /** 單調（斜率 > 0）的範圍 ±monotonicFs：sine 為 T_vco/4，linear 為 ∞（只有 wrap） */
  monotonicFs: number
  /** 不 cycle slip 的吸引區 ±T_vco/2 */
  basinFs: number
  /** 相位迴路每週期最多能拉回的量 g_p·max S：sine 為 g_p T_vco/(2π)，linear 為 g_p T_vco/2 */
  rampLimitFsPerCycle: number
  /** 對應的殘餘頻率誤差上限 [Hz]：ΔT < rampLimit */
  dfLimitHz: number
}

// #region core:slipBoundary
/** SSPD 的單調範圍、吸引區與「每週期相位斜坡不能超過迴路拉得回來的量」的 cycle slip 條件。 */
export function slipBoundary(p: Pick<AcqParams, 'divRatio' | 'fRefHz' | 'fBwHz' | 'pdShape'>): SlipBoundary {
  const T = tVcoFs(p)
  const gp = phaseLoopGain(p)
  const rampLimit = p.pdShape === 'sine' ? (gp * T) / (2 * Math.PI) : (gp * T) / 2
  return {
    monotonicFs: p.pdShape === 'sine' ? T / 4 : Infinity,
    basinFs: T / 2,
    rampLimitFsPerCycle: rampLimit,
    dfLimitHz: (rampLimit / 1e15) * p.divRatio * p.fRefHz * p.fRefHz,
  }
}

/** 穩態下每週期 cycle slip 的機率（Gaussian 近似）：相位 rms σ_ss、靜態偏移 θ_ss，超出 ±T_vco/2 的雙尾機率。 */
export function slipProbPerCycle(thetaSsFs: number, sigmaSsFs: number, tVco: number): number {
  if (!(sigmaSsFs > 0)) return Math.abs(thetaSsFs) >= tVco / 2 ? 1 : 0
  return normCdf(-(tVco / 2 - Math.abs(thetaSsFs)) / sigmaSsFs) + normCdf(-(tVco / 2 + Math.abs(thetaSsFs)) / sigmaSsFs)
}
// #endregion

/**
 * 一階相位迴路在斜坡 ΔT 下的平衡點（無雜訊）：g_p S(θ*) = ΔT。linear：θ* = ΔT/g_p；
 * sine：θ* = (T_vco/2π) arcsin(2π ΔT/(g_p T_vco))（|ΔT| < g_p T_vco/(2π) 才存在，否則一路 slip，回傳 NaN）。
 */
export function staticOffsetFs(rampFs: number, p: Pick<AcqParams, 'divRatio' | 'fRefHz' | 'fBwHz' | 'pdShape'>): number {
  const T = tVcoFs(p)
  const gp = phaseLoopGain(p)
  if (p.pdShape === 'linear') return Math.abs(rampFs / gp) < T / 2 ? rampFs / gp : NaN
  const s = (2 * Math.PI * rampFs) / (gp * T)
  return Math.abs(s) < 1 ? (T / (2 * Math.PI)) * Math.asin(s) : NaN
}

/** 靜態偏移剛好等於 θ 的殘餘頻率誤差 [Hz]：ΔT = g_p S(θ)、Δf = ΔT·M f_ref²（θ 超出單調範圍時取單調範圍的邊界）。 */
export function dfForStaticOffsetHz(thetaFs: number, p: Pick<AcqParams, 'divRatio' | 'fRefHz' | 'fBwHz' | 'pdShape'>): number {
  const T = tVcoFs(p)
  const edge = p.pdShape === 'sine' ? T / 4 : T / 2
  const ramp = phaseLoopGain(p) * pdCharacteristic(Math.min(Math.abs(thetaFs), edge), T, p.pdShape)
  return (ramp / 1e15) * p.divRatio * p.fRefHz * p.fRefHz
}

export type NoFllBinding = 'harmonic' | 'slip' | 'phaseLock' | 'settle' | 'none'

export interface NoFllCheck {
  /** 不用 FLL、直接在 Δf_0 閉 SSPD 相位迴路：第一層（倍頻） */
  harmonic: HarmonicCapture
  /** 第二層（相位）：SSPD 看到的斜坡（混疊後）、會不會 slip、靜態偏移（線性 ΔT/g_p 與 PD 形狀的平衡點） */
  rampFsPerCycle: number
  slipOk: boolean
  thetaSsFs: number
  thetaSsPdFs: number
  /** 平衡點在 phase-lock 門檻內（|θ*| < θ_max）、在穩態門檻內（|θ*| < rms_max） */
  phaseLockOk: boolean
  settleOk: boolean
  /** 四個尺度（Hz）：倍頻捕獲 f_ref/2、slip 上限、θ_ss = θ_max 與 θ_ss = rms_max 時的殘餘頻率誤差 */
  dfThetaMaxHz: number
  dfRmsMaxHz: number
  /** 依「倍頻 → slip → phase lock → 穩態」的順序，第一個不成立的條件（全部成立為 'none'） */
  binding: NoFllBinding
}

// #region core:noFllCheck
/**
 * 「不用 FLL 行不行」：把 SSPD 直接在 Δf_0 閉合，依序檢查兩層條件——倍頻捕獲 |Δf_0| < f_ref/2，
 * 再用混疊後的斜坡檢查相位層級：不 slip（|ΔT| < g_p max S）、靜態偏移小於 θ_max 與 rms_max。
 */
export function noFllCheck(p: AcqParams, df0Hz = p.df0Hz): NoFllCheck {
  const harmonic = harmonicCapture(df0Hz, p)
  const ramp = rampFsPerCycle(harmonic.aliasHz, p)
  const slip = slipBoundary(p)
  const slipOk = Math.abs(ramp) < slip.rampLimitFsPerCycle
  const thetaSsPdFs = slipOk ? staticOffsetFs(ramp, p) : NaN
  const phaseLockOk = slipOk && Math.abs(thetaSsPdFs) < p.thetaMaxFs
  const settleOk = slipOk && Math.abs(thetaSsPdFs) < p.rmsMaxFs
  const binding: NoFllBinding = !harmonic.ok ? 'harmonic' : !slipOk ? 'slip' : !phaseLockOk ? 'phaseLock' : !settleOk ? 'settle' : 'none'
  return {
    harmonic,
    rampFsPerCycle: ramp,
    slipOk,
    thetaSsFs: ramp / phaseLoopGain(p),
    thetaSsPdFs,
    phaseLockOk,
    settleOk,
    dfThetaMaxHz: dfForStaticOffsetHz(p.thetaMaxFs, p),
    dfRmsMaxHz: dfForStaticOffsetHz(p.rmsMaxFs, p),
    binding,
  }
}
// #endregion

/**
 * 「FLL 關掉」的模擬設定：K_f = 0（FLL 不動）、lock detect 的門檻放到 |Δf_0| 之外，所以第 N_ld − 1 個週期就交棒，
 * 相位迴路從 Δf_0 開始（f_unlock 再放寬一倍，不會失鎖回 ACQ）。用來和 noFllCheck 逐項對照。
 */
export function noFllConfig(p: AcqParams, df0Hz = p.df0Hz): AcqParams {
  const fTolHz = 2 * Math.abs(df0Hz) + p.fRefHz
  return { ...p, df0Hz, fllGainLsb: 0, fTolHz, fUnlockHz: 2 * fTolHz }
}

// #region core:phaseLockClosedForm
/**
 * 相位迴路的有效增益：linear 就是 g_p；sine 的 S(θ)/θ 在 |θ| 變大時變小（弦斜率 sin(x)/x，x = 2πθ_0/T_vco），
 * 從 θ_0 回到 0 的路上斜率都不低於它，所以用 g_p·sin(x)/x 算出來的週期數是 sine 的上界（|θ_0| < T_vco/2）。
 */
export function effectivePhaseGain(theta0Fs: number, gp: number, shape: PdShape, tVco: number): number {
  if (shape === 'linear' || theta0Fs === 0) return gp
  const x = (2 * Math.PI * Math.abs(theta0Fs)) / tVco
  return gp * (Math.sin(x) / x)
}

/** 穩態相位 rms：θ[n+1] = (1 − g_p)θ[n] − g_p v[n] ⇒ σ_ss² = g_p σ_θ²/(2 − g_p)。 */
export function steadyStateThetaRms(sigmaThetaFs: number, gp: number): number {
  return sigmaThetaFs * Math.sqrt(gp / (2 - gp))
}

/**
 * 線性相位迴路從 θ_0 進到 |θ| < θ_max 所需的週期（上界：|θ[n]| ≤ |θ_ss| + (1 − g_p)^n |θ_0 − θ_ss|），
 * 再加上連續 N_pl 個週期：n_PL = n_tr + N_pl − 1（相對於宣告頻率鎖定的週期 n_FL：θ_0 是那個週期的值）。
 * 相位迴路閉合後第一個被計數的樣本是 n_FL + 1（θ_0 本身不計），所以 n_tr ≥ 1：已在門檻內時 n_tr = 1。
 */
export function phaseLockCycles(theta0Fs: number, thetaSsFs: number, thetaMaxFs: number, gp: number, nPl: number): number {
  const margin = thetaMaxFs - Math.abs(thetaSsFs)
  if (!(margin > 0) || !(gp > 0 && gp < 2)) return Infinity
  const dev = Math.abs(theta0Fs - thetaSsFs)
  const nTr = dev < margin ? 1 : Math.max(1, Math.ceil(Math.log(margin / dev) / Math.log(Math.abs(1 - gp)) - 1e-9))
  return nTr + Math.max(1, nPl) - 1
}

/**
 * 迴路穩態（rms 視窗）：W 個週期的視窗要把暫態的前 n_tr 個樣本滑出去，剩下的暫態能量 (θ_0 − θ_ss)²(1 − g_p)^{2n_tr}/(1 − (1 − g_p)²)
 * 低於 (rms_max² − θ_ss²)·W ⇒ n_settle = W + n_tr − 1（相對於宣告頻率鎖定的週期 n_FL，無雜訊）。
 * 視窗的第一個樣本是 n_FL + 1（θ_0 不進視窗），所以 n_tr ≥ 1：整段暫態一開始就放得進額度時 n_tr = 1、n_settle = W。
 */
export function settleCycles(theta0Fs: number, thetaSsFs: number, rmsMaxFs: number, gp: number, W: number): number {
  const budget = (rmsMaxFs * rmsMaxFs - thetaSsFs * thetaSsFs) * W
  if (!(budget > 0) || !(gp > 0 && gp < 2)) return Infinity
  const dev2 = (theta0Fs - thetaSsFs) ** 2
  const r2 = (1 - gp) ** 2
  const energy0 = dev2 / (1 - r2)
  const nTr = energy0 < budget ? 1 : Math.max(1, Math.ceil(Math.log(budget / energy0) / Math.log(r2) - 1e-9))
  return W + nTr - 1
}
// #endregion

export interface DtcCheck {
  ok: boolean
  reason: string
  t0Fs: number
  rangeFs: number
  lsbFs: number
  /** 每個檢查的 gain 在 x 兩端的補償結果 */
  rows: { gainFs: number; xMin: { code: number; saturated: boolean }; xMax: { code: number; saturated: boolean } }[]
}

// #region core:dtcWorkingPoint
/** DTC 工作點：T_0 − w·x 的 code 在 x 的兩端都不能飽和（飽和時 ∂e/∂w = 0，LMS 沒有梯度可跟，Ch04 §5b）。 */
export function dtcWorkingPoint(p: Pick<AcqParams, 'divRatio' | 'fRefHz' | 'dtcBits' | 'dtcCalRangeFrac' | 'dtcInlPeakFs' | 'dtcGainsFs' | 'dtcXRange'>): DtcCheck {
  const T = tVcoFs(p)
  const b = dtcRangeBudget({ tVcoFs: T, calRangeFrac: p.dtcCalRangeFrac, inlPeakFs: p.dtcInlPeakFs, bits: p.dtcBits })
  const rows = p.dtcGainsFs.map((w) => {
    const at = (x: number) => {
      const c = dtcCompensation({ w, x, t0Fs: b.t0Fs, lsbFs: b.lsbFs, bits: p.dtcBits })
      return { code: c.code, saturated: c.saturated }
    }
    return { gainFs: w, xMin: at(p.dtcXRange[0]), xMax: at(p.dtcXRange[1]) }
  })
  const bad = rows.filter((r) => r.xMin.saturated || r.xMax.saturated)
  return {
    ok: bad.length === 0,
    reason:
      bad.length === 0
        ? `補償量在 code 範圍內（$T_0=${b.t0Fs.toFixed(0)}$ fs、$R=${b.rangeFs.toFixed(0)}$ fs）`
        : `DTC 工作點超出範圍：gain ${bad.map((r) => `${r.gainFs} fs`).join('、')} 的 code 在 $x$ 的端點飽和（$T_0=${b.t0Fs.toFixed(0)}$ fs、$R=${b.rangeFs.toFixed(0)}$ fs），$\\partial e/\\partial w=0$，不能 enable`,
    t0Fs: b.t0Fs,
    rangeFs: b.rangeFs,
    lsbFs: b.lsbFs,
    rows,
  }
}
// #endregion

// ───────────────────────────── 確定性時間表（封閉式）─────────────────────────────

export interface AcqAnalytic {
  kF: number
  tVcoFs: number
  gp: number
  /** FLL 進門檻、宣告鎖定的週期；交棒時的殘餘頻率誤差與相位斜坡 */
  nC: number
  nFL: number
  dfHandoffHz: number
  rampFsPerCycle: number
  thetaSsFs: number
  sigmaSsFs: number
  /** 相對於宣告頻率鎖定的週期 n_FL：phase lock、穩態（線性相位迴路）；絕對：enable */
  nPlRel: number
  nSettleRel: number
  nEnable: number
  lockBlocks: number
  /** sine PD 的上界（弦斜率的有效增益 g_eff）：模擬值落在 [線性值, 上界] 之間 */
  gEff: number
  nPlRelBound: number
  nSettleRelBound: number
  nEnableBound: number
  /** lock detect 的統計 */
  pIn0: number
  pMiss: number
  expectedDetectCycles: number
  /** 誤報：真實誤差 Δf_x = f_tol + σ_f（剛好在視窗外一個 σ） */
  dfFalseAlarmHz: number
  pFalseAlarm: number
  /** 有雜訊時宣告頻率鎖定的平均週期（renewal 近似，lockDetectMeanCycle） */
  noisyLockMeanCycle: number
  slip: SlipBoundary
  slipProbPerCycle: number
  dtc: DtcCheck
  /** 交棒時的倍頻捕獲（|Δf_h| < f_ref/2 才 enable）；不用 FLL 時的兩層條件 */
  harmonic: HarmonicCapture
  noFll: NoFllCheck
}

// #region core:acquisitionAnalytic
/** 封閉式的 acquisition 時間表（無雜訊、線性相位迴路）；每一項都有 F-14.22–F-14.25 對應。 */
export function acquisitionAnalytic(p: AcqParams): AcqAnalytic {
  const kF = fllGain(p)
  const T = tVcoFs(p)
  const gp = phaseLoopGain(p)
  const nC = fllCyclesToTol(p.df0Hz, p.fTolHz, kF)
  const nFL = fllLockCycle(p.df0Hz, p.fTolHz, kF, p.nLd)
  // 宣告鎖定的那個週期 FLL 還更新了一次，所以相位迴路看到的殘餘誤差是 (1 − K_f)^{n_FL + 1} Δf_0
  const dfHandoffHz = Number.isFinite(nFL) ? Math.pow(1 - kF, nFL + 1) * p.df0Hz : NaN
  const ramp = Number.isFinite(dfHandoffHz) ? rampFsPerCycle(dfHandoffHz, p) : NaN
  const thetaSs = ramp / gp
  const sigmaSs = steadyStateThetaRms(p.sigmaThetaFs, gp)
  const nPlRel = phaseLockCycles(p.theta0Fs, thetaSs, p.thetaMaxFs, gp, p.nPl)
  const nSettleRel = settleCycles(p.theta0Fs, thetaSs, p.rmsMaxFs, gp, p.settleWindow)
  const gEff = effectivePhaseGain(p.theta0Fs, gp, p.pdShape, T)
  const nPlRelBound = phaseLockCycles(p.theta0Fs, thetaSs, p.thetaMaxFs, gEff, p.nPl)
  const nSettleRelBound = settleCycles(p.theta0Fs, thetaSs, p.rmsMaxFs, gEff, p.settleWindow)
  const dtc = dtcWorkingPoint(p)
  // 倍頻捕獲：交棒時的殘餘誤差要在 ±f_ref/2 內，SSPD 才鎖在對的第 M 根（FLL 的門檻 f_tol ≪ f_ref/2 時自動成立）
  const harmonic = harmonicCapture(dfHandoffHz, p)
  // θ_0 是宣告頻率鎖定那個週期（n_FL）的值，之後每個週期相位迴路更新一次；enable 是三個條件都成立的第一個週期（DTC 與倍頻的檢查是靜態的）
  const nEnable = dtc.ok && harmonic.ok && Number.isFinite(nFL) ? nFL + Math.max(nPlRel, nSettleRel) : Infinity
  const pIn0 = lockDetectInWindowProb(0, p.fTolHz, p.sigmaFHz)
  const dfX = p.fTolHz + p.sigmaFHz
  return {
    kF,
    tVcoFs: T,
    gp,
    nC,
    nFL,
    dfHandoffHz,
    rampFsPerCycle: ramp,
    thetaSsFs: thetaSs,
    sigmaSsFs: sigmaSs,
    nPlRel,
    nSettleRel,
    nEnable,
    lockBlocks: Number.isFinite(nEnable) ? Math.ceil((nEnable + 1) / p.blockN) : Infinity,
    gEff,
    nPlRelBound,
    nSettleRelBound,
    nEnableBound: dtc.ok && harmonic.ok && Number.isFinite(nFL) ? nFL + Math.max(nPlRelBound, nSettleRelBound) : Infinity,
    pIn0,
    pMiss: lockDetectMiss(p.fTolHz, p.sigmaFHz, p.nLd),
    expectedDetectCycles: expectedRunLength(pIn0, p.nLd),
    dfFalseAlarmHz: dfX,
    pFalseAlarm: lockDetectFalseAlarm(dfX, p.fTolHz, p.sigmaFHz, p.nLd),
    noisyLockMeanCycle: lockDetectMeanCycle(p.df0Hz, p.fTolHz, kF, p.sigmaFHz, p.nLd),
    slip: slipBoundary(p),
    slipProbPerCycle: slipProbPerCycle(thetaSs, sigmaSs, T),
    dtc,
    harmonic,
    noFll: noFllCheck(p),
  }
}
// #endregion

// ───────────────────────────── 逐週期模擬（狀態機）─────────────────────────────

interface AcqCtx {
  state: AcqState
  df: number
  theta: number
  ldCount: number
  ulCount: number
  plCount: number
  /** rms 視窗（環形緩衝）的平方和與樣本數 */
  win: Float64Array
  winSum: number
  winCount: number
  winPos: number
}

// #region core:acqStep
/**
 * 狀態機的一個 reference 週期：① 量頻率誤差（加雜訊）、更新 lock／unlock 計數 → ② 依狀態更新 FLL 或相位迴路
 * （SSPD 只看得到混疊後的頻率誤差；含 wrap＝cycle slip）→ ③ phase-lock 計數與 rms 視窗 → ④ 轉移（失鎖回 ACQ、slip 進 HOLD、
 * 條件齊了進 CAL；倍頻捕獲 |Δf̂| < f_ref/2 是 enable 的條件之一）。
 */
export function acqStep(
  ctx: AcqCtx,
  p: AcqParams,
  d: { kF: number; tVco: number; gp: number; dtcOk: boolean },
  noise: { ef: number; ev: number },
  log: (kind: AcqEvent['kind'], msg: string) => void,
): AcqState {
  const acted = ctx.state
  // ① 頻率估計與 lock／unlock 計數
  const dfHat = ctx.df + noise.ef
  ctx.ldCount = Math.abs(dfHat) < p.fTolHz ? ctx.ldCount + 1 : 0
  ctx.ulCount = Math.abs(dfHat) > p.fUnlockHz ? ctx.ulCount + 1 : 0
  // 倍頻捕獲：頻率偵測（divider 路徑）的讀值在 ±f_ref/2 內，SSPD 鎖的才是第 M 根
  const harmonicOk = Math.abs(dfHat) < p.fRefHz / 2
  let next: AcqState | null = null
  if (ctx.state === 'ACQ') {
    // ② FLL：Δf ← Δf − K_f Δf̂
    ctx.df -= d.kF * dfHat
    ctx.theta = NaN
    if (ctx.ldCount >= p.nLd) {
      next = 'PLOCK'
      ctx.theta = p.theta0Fs // 交棒：相位迴路從 θ_0 開始
      ctx.plCount = 0
      ctx.winSum = 0
      ctx.winCount = 0
      ctx.winPos = 0
      log('lock', `頻率鎖定：$|\\hat{\\Delta f}|<f_\\text{tol}$ 連續 ${p.nLd} 個週期（殘餘 $\\Delta f=${(ctx.df / 1e6).toFixed(3)}$ MHz）`)
    }
  } else {
    // ② 相位迴路（FLL 凍結）：θ ← θ − g_p S(θ + v) + ΔT；SSPD 只看得到混疊後的 Δf − k f_ref（整數個 T_vco 看不見）；超出 ±T_vco/2 就是 cycle slip
    const ramp = rampFsPerCycle(harmonicCapture(ctx.df, p).aliasHz, p)
    const raw = ctx.theta - d.gp * pdCharacteristic(ctx.theta + noise.ev, d.tVco, p.pdShape) + ramp
    const w = wrapTheta(raw, d.tVco)
    ctx.theta = w.theta
    // ③ phase-lock 計數與 rms 視窗
    ctx.plCount = Math.abs(ctx.theta) < p.thetaMaxFs ? ctx.plCount + 1 : 0
    const sq = ctx.theta * ctx.theta
    if (ctx.winCount < p.settleWindow) ctx.winCount++
    else ctx.winSum -= ctx.win[ctx.winPos]
    ctx.win[ctx.winPos] = sq
    ctx.winSum += sq
    ctx.winPos = (ctx.winPos + 1) % p.settleWindow
    const settled = ctx.winCount >= p.settleWindow && ctx.winSum / p.settleWindow < p.rmsMaxFs * p.rmsMaxFs
    // ④ 轉移：失鎖優先，其次 slip，最後是條件齊了
    if (ctx.ulCount >= p.nUl) {
      next = 'ACQ'
      log('unlock', `失鎖：$|\\hat{\\Delta f}|>f_\\text{unlock}$ 連續 ${p.nUl} 個週期，回到 ACQ 重新拉頻率`)
    } else if (w.slipped) {
      log('slip', `cycle slip：相位超出 $\\pm T_\\text{vco}/2$，折回 ${ctx.theta.toFixed(0)} fs`)
      if (ctx.state === 'CAL' || ctx.state === 'RECAL') next = 'HOLD'
    } else if (ctx.state === 'PLOCK') {
      if (ctx.plCount >= p.nPl && settled && d.dtcOk && harmonicOk) {
        next = 'CAL'
        log('enable', `校正 enable：phase lock（連續 ${p.nPl}）$\\wedge$ rms 視窗 $<$ 門檻 $\\wedge$ 倍頻捕獲 $|\\hat{\\Delta f}|<f_\\text{ref}/2$ $\\wedge$ DTC 工作點在範圍內`)
      }
    } else if (ctx.state === 'CAL') {
      if (ctx.plCount === 0) {
        next = 'HOLD'
        log('hold', `$|\\theta|\\ge\\theta_{\\max}$：校正暫停（HOLD）`)
      }
    } else if (ctx.state === 'HOLD') {
      if (ctx.plCount >= p.nPl && settled && harmonicOk) next = 'RECAL'
    } else if (ctx.state === 'RECAL') {
      next = 'CAL'
    }
  }
  if (next !== null && next !== ctx.state) {
    log('state', `${ctx.state} → ${next}`)
    ctx.state = next
  }
  return acted
}
// #endregion

/** worker 可呼叫：單一 seed 的 acquisition 模擬（σ_f = σ_θ = 0 時是確定性的時間表）。 */
export function runAcquisition(p: AcqParams): AcqResult {
  const cycles = Math.max(1, Math.floor(p.cycles))
  const kF = fllGain(p)
  const tVco = tVcoFs(p)
  const gp = phaseLoopGain(p)
  const dtc = dtcWorkingPoint(p)
  const rng: Rng | null = p.sigmaFHz > 0 || p.sigmaThetaFs > 0 ? createRng(p.seed).fork('acquisition') : null
  const out: AcqResult = {
    df: new Float64Array(cycles),
    theta: new Float64Array(cycles),
    state: new Uint8Array(cycles),
    events: [],
    segments: [],
    summary: {
      freqLockCycle: -1,
      phaseLockCycle: -1,
      settleCycle: -1,
      enableCycle: -1,
      lockBlocks: Infinity,
      slips: 0,
      unlocks: 0,
      holds: 0,
      dtcOk: dtc.ok,
      dtcReason: dtc.reason,
      relockCycles: -1,
      relockBlocks: -1,
      dfHandoffHz: NaN,
    },
  }
  const ctx: AcqCtx = {
    state: 'ACQ',
    df: p.df0Hz,
    theta: NaN,
    ldCount: 0,
    ulCount: 0,
    plCount: 0,
    win: new Float64Array(Math.max(1, p.settleWindow)),
    winSum: 0,
    winCount: 0,
    winPos: 0,
  }
  if (!dtc.ok) out.events.push({ n: 0, kind: 'hold', msg: dtc.reason })
  let segStart = 0
  let segState: AcqState = 'ACQ'
  let segReason = '上電：FLL 開始拉頻率'
  let lastReason = ''
  const d = { kF, tVco, gp, dtcOk: dtc.ok }
  let lossSeen = false
  for (let n = 0; n < cycles; n++) {
    if (p.lossCycle >= 0 && n === p.lossCycle) {
      ctx.df += p.lossDfHz
      lossSeen = true
      out.events.push({ n, kind: 'unlock', msg: `事件：VCO 頻率跳 $${(p.lossDfHz / 1e6).toFixed(1)}$ MHz` })
    }
    out.df[n] = ctx.df
    const noise = rng ? { ef: p.sigmaFHz * rng.normal(), ev: p.sigmaThetaFs * rng.normal() } : { ef: 0, ev: 0 }
    const acted = acqStep(ctx, p, d, noise, (kind, msg) => {
      out.events.push({ n, kind, msg })
      if (kind !== 'state') lastReason = msg
      if (kind === 'slip') out.summary.slips++
      if (kind === 'unlock' && msg.startsWith('失鎖')) out.summary.unlocks++
      if (kind === 'hold') out.summary.holds++
      if (kind === 'lock' && out.summary.freqLockCycle < 0) {
        out.summary.freqLockCycle = n
        out.summary.dfHandoffHz = ctx.df
      }
      if (kind === 'enable') {
        if (out.summary.enableCycle < 0) out.summary.enableCycle = n
        else if (lossSeen && out.summary.relockCycles < 0) out.summary.relockCycles = n - p.lossCycle
      }
    })
    out.state[n] = ACQ_STATES.indexOf(acted)
    out.theta[n] = ctx.theta
    if (acted === 'PLOCK' || acted === 'HOLD') {
      if (out.summary.phaseLockCycle < 0 && ctx.plCount >= p.nPl) out.summary.phaseLockCycle = n
      if (out.summary.settleCycle < 0 && ctx.winCount >= p.settleWindow && ctx.winSum / p.settleWindow < p.rmsMaxFs * p.rmsMaxFs) out.summary.settleCycle = n
    }
    if (ctx.state !== segState) {
      out.segments.push({ state: segState, from: segStart, to: n + 1, reason: segReason })
      segStart = n + 1
      segState = ctx.state
      segReason = lastReason || `${acted} → ${ctx.state}`
      lastReason = ''
    }
  }
  out.segments.push({ state: segState, from: segStart, to: cycles, reason: segReason })
  const en = out.summary.enableCycle
  out.summary.lockBlocks = en >= 0 ? Math.ceil((en + 1) / p.blockN) : Infinity
  out.summary.relockBlocks = out.summary.relockCycles >= 0 ? Math.ceil(out.summary.relockCycles / p.blockN) : -1
  return out
}

/** 無雜訊版本（σ_f = σ_θ = 0）：確定性的時間表，和封閉式逐項對照。 */
export function acquisitionTimeline(p: AcqParams): AcqResult {
  return runAcquisition({ ...p, sigmaFHz: 0, sigmaThetaFs: 0 })
}

export interface AcqMonteCarloResult {
  runs: number
  /** enable 週期的平均與 95% CI（只算有 enable 的 runs）、沒有 enable 的 runs 數 */
  enable: { mean: number; lo: number; hi: number; n: number; failed: number }
  freqLock: { mean: number; lo: number; hi: number; n: number }
  meanSlips: number
  /** 每個 run 的 LOCK blocks（Infinity = 沒有 enable） */
  lockBlocks: number[]
  /** E[Δf[n]] 的 Monte Carlo 平均（前 nTrace 個週期）與線性模型 (1 − K_f)^n Δf_0 的最大相對差（以 4·se 判定） */
  fllTrace: { n: number[]; mean: number[]; se: number[]; model: number[]; maxZ: number }
}

/** worker 可呼叫：多 seed 的 acquisition 統計（enable 週期的 CI、FLL 平均軌跡 vs 線性模型）。 */
export function acquisitionMonteCarlo(p: { config: AcqParams; runs: number; nTrace?: number }): AcqMonteCarloResult {
  const runs = Math.max(2, Math.floor(p.runs))
  const kF = fllGain(p.config)
  const nTrace = Math.min(p.config.cycles, p.nTrace ?? 64)
  const step = Math.max(1, Math.floor(nTrace / 16))
  const traceIdx = Array.from({ length: Math.floor(nTrace / step) }, (_, i) => i * step)
  const sum = new Float64Array(traceIdx.length)
  const sum2 = new Float64Array(traceIdx.length)
  const enables: number[] = []
  const locks: number[] = []
  const lockBlocks: number[] = []
  let slips = 0
  let failed = 0
  for (let r = 0; r < runs; r++) {
    const res = runAcquisition({ ...p.config, seed: createRng(p.config.seed).fork(`acq-mc-${r}`).seed })
    traceIdx.forEach((n, i) => {
      sum[i] += res.df[n]
      sum2[i] += res.df[n] * res.df[n]
    })
    if (res.summary.enableCycle >= 0) enables.push(res.summary.enableCycle)
    else failed++
    if (res.summary.freqLockCycle >= 0) locks.push(res.summary.freqLockCycle)
    lockBlocks.push(res.summary.lockBlocks)
    slips += res.summary.slips
  }
  const stat = (xs: number[]) => {
    const n = xs.length
    if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 }
    const mean = xs.reduce((a, b) => a + b, 0) / n
    const v = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
    const se = Math.sqrt(v / n)
    return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, n }
  }
  const mean = Array.from(sum, (s) => s / runs)
  const se = Array.from(sum2, (s2, i) => Math.sqrt(Math.max(0, s2 / runs - mean[i] * mean[i]) / Math.max(1, runs - 1)))
  const model = traceIdx.map((n) => Math.pow(1 - kF, n) * p.config.df0Hz)
  let maxZ = 0
  model.forEach((m, i) => {
    const z = se[i] > 0 ? Math.abs(mean[i] - m) / se[i] : Math.abs(mean[i] - m) > 1e-6 * Math.abs(m) ? Infinity : 0
    if (z > maxZ) maxZ = z
  })
  return { runs, enable: { ...stat(enables), failed }, freqLock: stat(locks), meanSlips: slips / runs, lockBlocks, fllTrace: { n: traceIdx, mean, se, model, maxZ } }
}

/**
 * 預設情境（illustrative）：4 GHz reference、M = 4（16 GHz VCO、T_vco = 62.5 ps）、320 MHz 迴路頻寬（g_p ≈ 0.395）、
 * K_vco = 2.5 MHz/LSB、g_f = 3.2 ⇒ K_f = 5×10⁻⁴；Δf_0 = 80 MHz、f_tol = 1 MHz、σ_f = 0.1 MHz（z = 10：lock 時間由 FLL 決定，
 * 不由雜訊決定；σ_f = 0.4 MHz 時宣告鎖定會晚一千多個週期）、N_ld = 32；θ_0 = 25 ps（0.4 T_vco）、θ_max = 2 ps、N_pl = 32、
 * W = 512、rms_max = 100 fs、σ_θ = 100 fs（= Ch14 的 σ_v）。
 * 無雜訊時間表（週期從 0 起算）：n_c = 8762、n_FL = 8793、enable 9310（線性 PD；sine 9313）⇒ N = 1024 時 LOCK = ⌈9311/1024⌉ = 10 個 block
 * （和 §14.7 預設的 lockBlocks 相同）。
 */
export const DEFAULT_ACQ: AcqParams = {
  seed: 20261034,
  fRefHz: 4e9,
  divRatio: 4,
  kVcoHzPerLsb: 2.5e6,
  fllGainLsb: 3.2,
  df0Hz: 8e7,
  sigmaFHz: 1e5,
  fTolHz: 1e6,
  nLd: 32,
  fUnlockHz: 4e6,
  nUl: 16,
  fBwHz: 3.2e8,
  pdShape: 'sine',
  sigmaThetaFs: 100,
  theta0Fs: 25000,
  thetaMaxFs: 2000,
  nPl: 32,
  settleWindow: 512,
  rmsMaxFs: 100,
  dtcBits: 10,
  dtcCalRangeFrac: 0.2,
  dtcInlPeakFs: 0,
  dtcGainsFs: [0, 100],
  dtcXRange: [-1, 1],
  cycles: 16384,
  lossCycle: -1,
  lossDfHz: 5e7,
  blockN: 1024,
}
