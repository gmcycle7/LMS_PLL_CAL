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
