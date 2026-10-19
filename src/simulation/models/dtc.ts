/**
 * DTC（Digital-to-Time Converter）delay mapping（規格 §4、§11.2、§13；模型層級 L2 / L5）。
 *
 * 單位：delay 一律為 **fs**；code 為 DTC 控制碼（LSB）。
 *
 *   delay(code) = gain·code + offset + c2·code² + c3·code³ + INL_LUT(code)     [fs]
 *
 * 這是 DTC 元件本身的特性（實際送進 DTC 的控制碼 → DTC 的延遲 τ_DTC）：控制碼越大，延遲越長。
 * 在系統裡的位置（docs/assumptions.md §2a）：DTC 在 reference 輸入端，回授路徑上只有 divider。DTC 只能延遲、不能提前，
 * 所以數位端送進來的控制碼是 C_0 − w·x[n]（C_0 是固定的中心值，x[n] 是累加器餘數）：τ_DTC[n] = T_0 − w·x[n]，
 * x 越大延遲越短。w·x[n] 叫做「補償量」（reference edge 被提前的時間），不是 DTC 的延遲本身。
 * （控制碼與時間之間差一個 DTC 的 gain：線性的 DTC 是 τ_DTC = gain·(C_0 − w·x) + offset，所以 T_0 = delay(C_0)，
 *   而各章 e = (a − w)·x 裡以時間計的 w 是「gain × 這裡以 LSB 計的 w」；T_0 是常數，被主 PLL 當成靜態相位偏移吸收。）
 *
 * - gainFs：fs/LSB；offsetFs：fs；c2：fs/LSB²；c3：fs/LSB³；inlLutFs：每個整數 code 的額外 INL [fs]
 *   （非整數 code 線性內插；超出表格範圍時取端點值）。
 * - 實體 code 量化（bits 有給時）：先依 rounding 量化成整數，再飽和（saturate）到可用範圍：
 *     unsigned：[0, 2^B − 1]；signed：[−2^{B−1}, 2^{B−1} − 1]
 *   rounding：'nearest' = round-half-up（floor(x + ½)）；'truncate' = 二補數截斷 = floor(x)（朝 −∞）。
 *   bits 省略時為理想 DTC（不量化、不飽和）。
 *
 * blockLms 使用的「正規化 code 上的非線性」dtcNonlinearityFs(x) = offset + c2·x² + c3·x³ 也在此定義
 * （x 為正規化後、無因次的 regressor；c2、c3 的單位為 fs per (normalized code)^k）。
 * 純數值、無 React/DOM；回傳值可 structured clone。
 */

export type DtcRounding = 'nearest' | 'truncate'

export interface DtcParams {
  /** 線性增益 [fs/LSB] */
  gainFs: number
  /** 固定延遲 offset [fs]，預設 0 */
  offsetFs?: number
  /** 二階係數 [fs/LSB²]，預設 0 */
  c2?: number
  /** 三階係數 [fs/LSB³]，預設 0 */
  c3?: number
  /** INL 查表 [fs]：inlLutFs[i] 對應 code = inlLutCodeMin + i */
  inlLutFs?: number[]
  /** inlLutFs[0] 對應的 code；預設為 code 範圍下限（未量化時為 0） */
  inlLutCodeMin?: number
  /** 實體 code 位元數；省略 = 理想（不量化、不飽和） */
  bits?: number
  /** 預設 false（unsigned） */
  signed?: boolean
  /** 預設 'nearest' */
  rounding?: DtcRounding
}

/** 實體 code 範圍 [lo, hi]（含端點）。 */
export function dtcCodeRange(bits: number, signed = false): [number, number] {
  if (!Number.isInteger(bits) || bits < 1 || bits > 31) throw new Error(`DTC 位元數必須為 1…31 的整數，收到 ${bits}`)
  return signed ? [-Math.pow(2, bits - 1), Math.pow(2, bits - 1) - 1] : [0, Math.pow(2, bits) - 1]
}

// #region core:dtcQuantize
/** 依 rounding 量化成整數。 */
export function roundCode(x: number, rounding: DtcRounding = 'nearest'): number {
  return rounding === 'truncate' ? Math.floor(x) : Math.floor(x + 0.5)
}

/** 量化並飽和實體 code；bits 省略時原值通過。 */
export function quantizeDtcCode(code: number, p: Pick<DtcParams, 'bits' | 'signed' | 'rounding'>): { code: number; saturated: boolean } {
  if (p.bits === undefined) return { code, saturated: false }
  const [lo, hi] = dtcCodeRange(p.bits, p.signed ?? false)
  const q = roundCode(code, p.rounding ?? 'nearest')
  if (q > hi) return { code: hi, saturated: true }
  if (q < lo) return { code: lo, saturated: true }
  return { code: q, saturated: false }
}
// #endregion

function inlLookup(code: number, p: DtcParams): number {
  const lut = p.inlLutFs
  if (!lut || lut.length === 0) return 0
  const base = p.inlLutCodeMin ?? (p.bits !== undefined ? dtcCodeRange(p.bits, p.signed ?? false)[0] : 0)
  const t = code - base
  if (t <= 0) return lut[0]
  if (t >= lut.length - 1) return lut[lut.length - 1]
  const i = Math.floor(t)
  const fr = t - i
  return lut[i] + fr * (lut[i + 1] - lut[i])
}

// #region core:dtcMapping
/** 不經量化的 delay mapping [fs]。 */
export function dtcMapping(code: number, p: DtcParams): number {
  const c2 = p.c2 ?? 0
  const c3 = p.c3 ?? 0
  return p.gainFs * code + (p.offsetFs ?? 0) + c2 * code * code + c3 * code * code * code + inlLookup(code, p)
}

/** delay(code) [fs]：先量化／飽和（若 bits 有給），再套 mapping。 */
export function dtcDelayFs(code: number, p: DtcParams): number {
  return dtcMapping(quantizeDtcCode(code, p).code, p)
}
// #endregion

/** 整段 code 的 delay 與量化結果（worker 可呼叫的形式請用 dtcTransferRun）。 */
export function dtcTransfer(
  codes: ArrayLike<number>,
  p: DtcParams,
): { delayFs: Float64Array; codes: Float64Array; saturationCount: number } {
  const n = codes.length
  const delayFs = new Float64Array(n)
  const out = new Float64Array(n)
  let sat = 0
  for (let i = 0; i < n; i++) {
    const q = quantizeDtcCode(codes[i], p)
    if (q.saturated) sat++
    out[i] = q.code
    delayFs[i] = dtcMapping(q.code, p)
  }
  return { delayFs, codes: out, saturationCount: sat }
}

/** Worker 可呼叫版本：dtcTransferRun({ codes, params }) */
export function dtcTransferRun(args: { codes: ArrayLike<number>; params: DtcParams }): ReturnType<typeof dtcTransfer> {
  return dtcTransfer(args.codes, args.params)
}

/** 線性反函數：達到目標 delay 的理想（未量化）code = (delay − offset)/gain。 */
export function dtcIdealCode(delayFs: number, p: Pick<DtcParams, 'gainFs' | 'offsetFs'>): number {
  if (p.gainFs === 0) throw new Error('DTC gain 為 0，無法反推 code')
  return (delayFs - (p.offsetFs ?? 0)) / p.gainFs
}

export interface DtcNonlinearity {
  offset_fs: number
  c2: number
  c3: number
}

/**
 * blockLms 的 DTC 非線性（作用在正規化 code x 上）：offset_fs + c2·x² + c3·x³ [fs]。
 * 規格 §11.2 的例子 e = (a − w)x + c·x³ 對應 c3 = c、其餘為 0。
 */
export function dtcNonlinearityFs(x: number, nl: DtcNonlinearity): number {
  return nl.offset_fs + nl.c2 * x * x + nl.c3 * x * x * x
}

/**
 * Endpoint-fit INL / DNL（需 bits，對整個實體 code 範圍掃描）：
 *   LSB_eff = (delay(hi) − delay(lo))/(hi − lo)、INL[k] = delay(k) − [delay(lo) + LSB_eff·(k − lo)]
 *   DNL[k] = (delay(k) − delay(k−1))/LSB_eff − 1（k > lo；DNL[lo] = 0）
 */
export function dtcInlDnl(p: DtcParams): {
  codes: Float64Array
  delayFs: Float64Array
  lsbFs: number
  inlFs: Float64Array
  inlLsb: Float64Array
  dnlLsb: Float64Array
  maxAbsInlLsb: number
} {
  if (p.bits === undefined) throw new Error('dtcInlDnl 需要 bits（實體 code 範圍）')
  const [lo, hi] = dtcCodeRange(p.bits, p.signed ?? false)
  const n = hi - lo + 1
  const codes = new Float64Array(n)
  const delayFs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    codes[i] = lo + i
    delayFs[i] = dtcMapping(lo + i, p)
  }
  const lsbFs = n > 1 ? (delayFs[n - 1] - delayFs[0]) / (n - 1) : NaN
  const inlFs = new Float64Array(n)
  const inlLsb = new Float64Array(n)
  const dnlLsb = new Float64Array(n)
  let maxAbs = 0
  for (let i = 0; i < n; i++) {
    inlFs[i] = delayFs[i] - (delayFs[0] + lsbFs * i)
    inlLsb[i] = inlFs[i] / lsbFs
    if (i > 0) dnlLsb[i] = (delayFs[i] - delayFs[i - 1]) / lsbFs - 1
    maxAbs = Math.max(maxAbs, Math.abs(inlLsb[i]))
  }
  return { codes, delayFs, lsbFs, inlFs, inlLsb, dnlLsb, maxAbsInlLsb: maxAbs }
}

// ─────────────────────────────────────────────────────────────────────────────
// DTC 範圍、LSB、量化抖動、飽和與 T_0 預算（Ch04 Part 2 §5b；2026-10-19，審查 depth：全站只有 gain register 的飽和，
// DTC code 本身的範圍、LSB 與量化抖動沒有數字也沒有模型）。單位：時間 fs、code LSB；純函式、無 React/DOM。
//
//   reference 端的 DTC：τ_DTC[n] = T_0 − w·x[n]（docs/assumptions.md §2a）；實體 DTC 的延遲範圍 [τ_min, τ_min + R]，R = (2^B − 1)·Δ，
//   Δ = R/(2^B − 1) 是 1 LSB 的時間。補償量 w·x 落在 [0, a·x_max]（x ∈ [0, 1)：最多一個 T_vco），所以 T_0 必須 ≥ 補償量的最大值 + 校正餘裕，
//   而且 T_0 本身不能超過 τ_min + R：R ≥ T_vco(1 + ε_cal) + INL 餘裕 + 兩端的 headroom（rangeBudget）。
//   量化：補償量取整到 Δ 的格點，誤差 e_q ∈ (−Δ/2, Δ/2]（nearest）、均勻 ⇒ σ_q = Δ/√12；它和 comparator 雜訊 v 一樣進入 e[n]，
//   σ_v,eff² = σ_v² + Δ²/12，K_q 跟著變小（effectiveSigmaV）。
//   飽和：code 夾在 [0, 2^B − 1] 時 ∂e/∂w = 0（e 不再隨 w 變），sign-LMS 的 q·x 仍會累加 ⇒ 要 freeze（dtcCompensation 回傳 dEdw）。
// ─────────────────────────────────────────────────────────────────────────────

export interface DtcRangeBudgetInput {
  /** VCO 週期 [fs]：x ∈ [0, 1) 的補償量最多一個 T_vco */
  tVcoFs: number
  /** DTC gain 的校正範圍（相對）：w 要能到 a(1 ± ε)；預設 0.2 */
  calRangeFrac?: number
  /** INL 的最壞偏離 [fs]（Ch11：d(x) 的峰值），預設 0 */
  inlPeakFs?: number
  /** 兩端各留的 headroom（相對 T_vco），預設 0.05 */
  headroomFrac?: number
  /** 位元數 B（給了就算 Δ 與量化抖動） */
  bits?: number
}

export interface DtcRangeBudget {
  /** 補償量的最大值 a·x_max·(1 + ε) [fs] */
  maxCompFs: number
  /** 需要的延遲範圍 R [fs] */
  rangeFs: number
  /** 基準延遲 T_0（相對 τ_min）[fs]：補償量從這裡往回扣，上面留 headroom */
  t0Fs: number
  /** 1 LSB [fs]（bits 有給時） */
  lsbFs: number
  /** 量化抖動 RMS Δ/√12 [fs] */
  jitterRmsFs: number
  /** 可用的 code 數 2^B */
  codes: number
  /** 要讓 Δ ≤ 目標時需要的位元數（bitsFor 用） */
  bits: number
}

// #region core:dtcRangeBudget
/** T_0 與範圍預算：R ≥ T_vco(1 + ε_cal) + INL 峰值 + 2·headroom；Δ = R/(2^B − 1)；σ_q = Δ/√12 */
export function dtcRangeBudget(o: DtcRangeBudgetInput): DtcRangeBudget {
  const eps = o.calRangeFrac ?? 0.2
  const inl = o.inlPeakFs ?? 0
  const head = (o.headroomFrac ?? 0.05) * o.tVcoFs
  const maxCompFs = o.tVcoFs * (1 + eps) // 最大補償量：x → 1 且 w 到 a(1 + ε)
  const rangeFs = maxCompFs + inl + 2 * head // 兩端各一個 headroom
  const t0Fs = head + inl + maxCompFs // 從 τ_min 往上：headroom + INL 餘裕 + 補償量 ⇒ 補償量為 0 時 τ = T_0，為最大時 τ = T_0 − maxComp
  const lsbFs = o.bits !== undefined ? dtcLsbFs(rangeFs, o.bits) : NaN
  return { maxCompFs, rangeFs, t0Fs, lsbFs, jitterRmsFs: o.bits !== undefined ? dtcQuantizationJitterRms(lsbFs) : NaN, codes: o.bits !== undefined ? 2 ** o.bits : NaN, bits: o.bits ?? NaN }
}
// #endregion

/** 1 LSB 的時間：Δ = R/(2^B − 1)（B 個 bit 有 2^B 個 code、2^B − 1 個間隔） */
export function dtcLsbFs(rangeFs: number, bits: number): number {
  if (!Number.isInteger(bits) || bits < 1 || bits > 31) throw new Error(`DTC 位元數必須為 1…31 的整數，收到 ${bits}`)
  return rangeFs / (2 ** bits - 1)
}

/** 讓 Δ ≤ lsbTargetFs 所需的最少位元數：2^B − 1 ≥ R/Δ_target */
export function dtcBitsFor(rangeFs: number, lsbTargetFs: number): number {
  if (!(lsbTargetFs > 0) || !(rangeFs > 0)) throw new Error('範圍與目標 LSB 都要是正數')
  return Math.max(1, Math.ceil(Math.log2(rangeFs / lsbTargetFs + 1)))
}

// #region core:dtcQuantizationJitter
/** 量化誤差均勻分布在一個 LSB 內：σ_q = Δ/√12（nearest 或 truncate 都一樣，truncate 另有 −Δ/2 的平均偏移） */
export function dtcQuantizationJitterRms(lsbFs: number): number {
  return lsbFs / Math.sqrt(12)
}

/** 量化抖動與 comparator 雜訊相加（獨立、都在 e[n] 這個節點）：σ_v,eff = √(σ_v² + Δ²/12) */
export function dtcEffectiveSigmaV(sigmaVFs: number, lsbFs: number): number {
  const q = dtcQuantizationJitterRms(lsbFs)
  return Math.sqrt(sigmaVFs * sigmaVFs + q * q)
}

/** K_q 因量化抖動縮小的倍率 K_q,eff/K_q = σ_v/σ_v,eff */
export function dtcKqRatio(sigmaVFs: number, lsbFs: number): number {
  return sigmaVFs / dtcEffectiveSigmaV(sigmaVFs, lsbFs)
}
// #endregion

export interface DtcCompensationInput {
  /** 目前的 gain w [fs per unit code] */
  w: number
  /** 正規化 code x ∈ [0, 1) */
  x: number
  /** 基準延遲 T_0（相對 τ_min）[fs] */
  t0Fs: number
  /** 1 LSB [fs] */
  lsbFs: number
  bits: number
  rounding?: DtcRounding
}

export interface DtcCompensation {
  /** 想要的延遲 T_0 − w·x [fs]（量化前） */
  wantFs: number
  /** 想要的 code（量化前） */
  wantCode: number
  /** 實際送出的 code（量化 + 飽和） */
  code: number
  /** 實際延遲 code·Δ [fs] */
  delayFs: number
  /** 量化誤差（實際 − 想要）[fs]，飽和時含夾住的部分 */
  errorFs: number
  saturated: boolean
  /** ∂e/∂w：沒飽和時 −x（e = t_ref′ − t_fb = (a − w)x + …），飽和時 0——sign-LMS 的 q·x 更新沒有梯度可跟，要 freeze */
  dEdw: number
}

// #region core:dtcCompensation
/** reference 端 DTC 的一拍：τ = T_0 − w·x 取整到 Δ 的格點、夾在 [0, 2^B − 1]；回傳實際延遲、量化誤差與 ∂e/∂w */
export function dtcCompensation(o: DtcCompensationInput): DtcCompensation {
  const wantFs = o.t0Fs - o.w * o.x // 補償量 w·x 從基準延遲往回扣
  const wantCode = wantFs / o.lsbFs
  const { code, saturated } = quantizeDtcCode(wantCode, { bits: o.bits, rounding: o.rounding ?? 'nearest' })
  const delayFs = code * o.lsbFs
  return { wantFs, wantCode, code, delayFs, errorFs: delayFs - wantFs, saturated, dEdw: saturated ? 0 : -o.x } // ← 飽和：code 不再隨 w 變，梯度為 0
}
// #endregion

/** 一段 code 序列的飽和比例（補償量超出範圍的拍數 / 總拍數）與量化誤差的 RMS（量化抖動的直接量測，和 Δ/√12 比） */
export function dtcCompensationStats(xs: ArrayLike<number>, o: Omit<DtcCompensationInput, 'x'>): { saturatedFraction: number; errorRmsFs: number; errorMeanFs: number; n: number } {
  const n = xs.length
  let sat = 0
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const c = dtcCompensation({ ...o, x: xs[i] })
    if (c.saturated) sat++
    s1 += c.errorFs
    s2 += c.errorFs * c.errorFs
  }
  return { saturatedFraction: n ? sat / n : 0, errorRmsFs: n ? Math.sqrt(s2 / n) : 0, errorMeanFs: n ? s1 / n : 0, n }
}
