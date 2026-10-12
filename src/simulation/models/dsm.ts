/**
 * Delta-Sigma Modulator（DSM）與 DTC phase residue（規格 §4、§11.4、§15.3；模型層級 L2 / L6）。
 *
 * 數位 B-bit 累加器（M = 2^B），分數 FCW 量化為整數 K = round(frac·M)，實際平均頻率 fracEff = K/M。
 *
 * ── 一階累加器 DSM ──
 *   t = s[n−1] + in[n]；c[n] = (t ≥ M)；s[n] = t − M·c[n]；y[n] = c[n] ∈ {0, 1}
 *   ⇒ M·y[n] = in[n] − (s[n] − s[n−1])，即 y − in/M = −(1 − z⁻¹)·s/M（一階 NTF）
 *
 * ── MASH 1-1-1（理想、非 pipelined，三級串接；第 i+1 級輸入為第 i 級的累加器內容 s_i[n]）──
 *   y[n] = c1[n] + (c2[n] − c2[n−1]) + (c3[n] − 2c3[n−1] + c3[n−2]) ∈ {−3, …, 4}
 *   ⇒（零初始狀態）y − in/M = −(1 − z⁻¹)³·s3/M：y − frac 的 PSD 在低頻以 **60 dB/dec** 上升；
 *     phase residue（y − frac 的累加）為 −(1 − z⁻¹)²·s3/M，低頻 **40 dB/dec**。
 *
 * ── DTC phase residue（DTC 必須抵消的量，單位：VCO 週期 T_vco）──
 *   第 n 個 reference cycle divider 數 N_int + y[n] 個 VCO 週期，理想為 N_int + frac；
 *   divider（feedback）edge 相對理想時刻的累積時間誤差（正 = 晚到）：
 *     residue[n] = Σ_{m=0}^{n} (y[m] − in[m]/M)   [T_vco]
 *   架構（docs/assumptions.md §2a）：carry y[n] 控制回授路徑上的 divider；DTC 不在回授路徑上，而在 reference 輸入端。
 *   一階、零初值時 residue = −s[n]/M ≤ 0：feedback edge 早到 x[n] = s[n]/M 個 T_vco，DTC 把 reference edge 也提前 w·x[n] 去對齊
 *   （DTC 只能延遲，所以是從固定的基準延遲 T_0 往回扣：τ_DTC = T_0 − w·x[n]；w·x[n] 叫做補償量）。
 *   以整數 R[n] = Σ (M·y − in) 精確累加後除以 M，所以沒有浮點漂移，且恆有界：
 *   一階 residue = (s[−1] − s[n])/M ∈ (−1, 1)（零初值時 ∈ (−1, 0]）；MASH 1-1-1 |residue| < 2。
 *   開啟 LSB dither 時 in[n] = K + d[n]（d ∈ {0, 1} 等機率），residue 以「含 dither 的瞬時輸入」為基準
 *   （硬體由累加器內容推得），dither 本身的隨機漫步 Σ(d − ½)/M 不計入；平均頻率偏移 +½ LSB
 *   （fracEff = (K + ½)/M）。
 *
 * 假設：一個 DSM sample 對應一個 comparator sample（f_s = f_ref）。
 * 所有隨機性來自 createRng(seed)；同 seed 可重現。純數值、無 React/DOM。
 */

import { createRng, type Rng } from '@/simulation/core'
import { welch, type PsdResult, type WelchOptions } from '@/simulation/signal'

export type DsmKind = 'first_order' | 'mash111'

/**
 * Code 正規化（規格 §15.3 code_normalization，另加 'standardize'）：
 * - 'none'：原值（residue 單位為 T_vco）
 * - 'zero_mean'：減去樣本平均
 * - 'unit_rms'：除以 RMS，使 E[x²] = 1；**不**減平均（保留 E[x] ≠ 0 的效應，例如 §11.1 offset 假 gain bias）
 * - 'standardize'：減平均並除以標準差（E[x] = 0、E[x²] = 1）
 */
export type CodeNormalization = 'none' | 'zero_mean' | 'unit_rms' | 'standardize'

export interface DsmStreamOptions {
  kind: DsmKind
  /** FCW 小數部分 frac ∈ [0, 1) */
  frac: number
  /** 累加器位元數 B（1…32），預設 20 */
  bits?: number
  /** 第一級輸入加 LSB dither d[n] ∈ {0, 1}（等機率），預設 false */
  dither?: boolean
  /** 各級累加器初始內容（整數，∈ [0, M)）；預設全 0。MASH 需 3 個，一階需 1 個 */
  initialState?: number[]
}

export interface DsmOptions extends DsmStreamOptions {
  /** 產生的 reference cycle 數 */
  length: number
  /** dither 的 seed（只在 dither = true 時使用）；預設 1 */
  seed?: number
  /** `code` 輸出的正規化方式，預設 'none' */
  normalization?: CodeNormalization
}

/** 量化後的 FCW 資訊 */
export interface FcwQuantization {
  bits: number
  M: number
  K: number
  fracNominal: number
  /** 實際平均 frac：K/M（dither 時 (K + ½)/M） */
  fracEff: number
  warnings: string[]
}

/** 把 frac 量化到 B-bit 整數 FCW。 */
export function quantizeFcw(frac: number, bits = 20, dither = false): FcwQuantization {
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) throw new Error(`DSM 位元數 B 必須為 1…32 的整數，收到 ${bits}`)
  if (!(frac >= 0 && frac < 1)) throw new Error(`FCW 小數部分 frac 必須在 [0, 1)，收到 ${frac}`)
  const M = Math.pow(2, bits)
  let K = Math.round(frac * M)
  const warnings: string[] = []
  if (K >= M) {
    K = M - 1
    warnings.push(`frac = ${frac} 量化後等於 1，已改為 K = M − 1 = ${K}`)
  }
  if (dither && K === M - 1) warnings.push('K = M − 1 時加 LSB dither 會使輸入偶爾等於 M（整數 FCW 進位），仍可運作但平均頻率含 dither 偏移')
  if (Math.abs(K / M - frac) > 0.5 / M + 1e-15) warnings.push('FCW 量化誤差超過 ½ LSB（不應發生）')
  return { bits, M, K, fracNominal: frac, fracEff: dither ? (K + 0.5) / M : K / M, warnings }
}

/**
 * 串流 DSM：每呼叫一次 step() 前進一個 reference cycle。
 * 所有累加器以 double 存放整數（< 2^34，精確），不使用 32-bit 位元運算。
 */
export class DsmStream {
  readonly kind: DsmKind
  readonly bits: number
  readonly M: number
  readonly K: number
  readonly fracEff: number
  readonly dither: boolean
  /** 最近一次 step 的 divider modulus offset y[n] */
  y = 0
  /** 最近一次 step 的 phase residue [T_vco] */
  residue = 0
  /** 最近一次 step 的瞬時量化誤差 y[n] − in[n]/M */
  quantError = 0
  /** 最近一次 step 的第一級輸入 in[n]（整數） */
  input = 0
  private s1: number
  private s2: number
  private s3: number
  private c2p = 0
  private c3p = 0
  private c3pp = 0
  private rInt = 0
  private readonly init: number[]
  private readonly rng: Rng | null

  constructor(opts: DsmStreamOptions, rng?: Rng) {
    const q = quantizeFcw(opts.frac, opts.bits ?? 20, opts.dither ?? false)
    this.kind = opts.kind
    this.bits = q.bits
    this.M = q.M
    this.K = q.K
    this.fracEff = q.fracEff
    this.dither = opts.dither ?? false
    const stages = opts.kind === 'mash111' ? 3 : 1
    const init = opts.initialState ?? []
    if (init.length > stages) throw new Error(`initialState 最多 ${stages} 個（${opts.kind}）`)
    for (const v of init) {
      if (!Number.isInteger(v) || v < 0 || v >= this.M) throw new Error(`累加器初值必須為 [0, ${this.M}) 的整數，收到 ${v}`)
    }
    this.init = [init[0] ?? 0, init[1] ?? 0, init[2] ?? 0]
    this.s1 = this.init[0]
    this.s2 = this.init[1]
    this.s3 = this.init[2]
    this.rng = this.dither ? (rng ?? createRng(1)) : null
  }

  /** 回到初始狀態（dither 亂數串流不重設） */
  reset(): void {
    this.s1 = this.init[0]
    this.s2 = this.init[1]
    this.s3 = this.init[2]
    this.c2p = 0
    this.c3p = 0
    this.c3pp = 0
    this.rInt = 0
    this.y = 0
    this.residue = 0
    this.quantError = 0
  }

  /** 前進一個 reference cycle，回傳 y[n] */
  step(): number {
    // #region core:dsmStep
    const M = this.M
    const inp = this.rng !== null ? this.K + (this.rng.uint32() >>> 31) : this.K
    let t = this.s1 + inp
    let c1 = 0
    if (t >= M) {
      c1 = 1
      t -= M
    }
    this.s1 = t
    let y: number
    if (this.kind === 'first_order') {
      y = c1
    } else {
      let t2 = this.s2 + this.s1
      let c2 = 0
      if (t2 >= M) {
        c2 = 1
        t2 -= M
      }
      this.s2 = t2
      let t3 = this.s3 + this.s2
      let c3 = 0
      if (t3 >= M) {
        c3 = 1
        t3 -= M
      }
      this.s3 = t3
      y = c1 + (c2 - this.c2p) + (c3 - 2 * this.c3p + this.c3pp)
      this.c2p = c2
      this.c3pp = this.c3p
      this.c3p = c3
    }
    // #region core:dsmResidue
    this.rInt += M * y - inp
    this.y = y
    this.input = inp
    this.residue = this.rInt / M
    this.quantError = y - inp / M
    // #endregion
    return y
    // #endregion
  }
}

export interface CodeStats {
  n: number
  mean: number
  /** E[x²] */
  meanSquare: number
  rms: number
  /** 母體標準差（ddof = 0） */
  std: number
}

/** 樣本統計（Neumaier 補償加總）。 */
export function codeStats(x: ArrayLike<number>): CodeStats {
  const n = x.length
  let s = 0
  let cs = 0
  let s2 = 0
  let cs2 = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]
    let t = s + v
    cs += Math.abs(s) >= Math.abs(v) ? s - t + v : v - t + s
    s = t
    const v2 = v * v
    t = s2 + v2
    cs2 += Math.abs(s2) >= Math.abs(v2) ? s2 - t + v2 : v2 - t + s2
    s2 = t
  }
  const mean = n > 0 ? (s + cs) / n : NaN
  const meanSquare = n > 0 ? (s2 + cs2) / n : NaN
  // 兩遍法求變異數，避免 E[x²] − E[x]² 的抵消
  let v = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean
    v += d * d
  }
  const std = n > 0 ? Math.sqrt(v / n) : NaN
  return { n, mean, meanSquare, rms: Math.sqrt(meanSquare), std }
}

export interface NormalizationParams {
  mode: CodeNormalization
  /** code = (raw − offset)·scale */
  offset: number
  scale: number
  warnings: string[]
}

/** 由統計量決定正規化的 offset / scale（串流模擬與整段陣列共用同一規則）。 */
export function normalizationParams(stats: Pick<CodeStats, 'mean' | 'rms' | 'std'>, mode: CodeNormalization): NormalizationParams {
  const warnings: string[] = []
  let offset = 0
  let scale = 1
  if (mode === 'zero_mean' || mode === 'standardize') offset = stats.mean
  if (mode === 'unit_rms' || mode === 'standardize') {
    const d = mode === 'unit_rms' ? stats.rms : stats.std
    if (d > 0 && Number.isFinite(d)) scale = 1 / d
    else warnings.push('code 的 RMS（或標準差）為 0：缺乏激勵（Persistent Excitation），無法正規化，保留原值')
  }
  return { mode, offset, scale, warnings }
}

/** 對整段序列做正規化（見 CodeNormalization）。 */
export function normalizeCode(
  x: ArrayLike<number>,
  mode: CodeNormalization,
): { code: Float64Array; stats: CodeStats } & NormalizationParams {
  const stats = codeStats(x)
  const p = normalizationParams(stats, mode)
  const code = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) code[i] = (x[i] - p.offset) * p.scale
  return { code, stats, ...p }
}

export interface DsmResult {
  kind: DsmKind
  bits: number
  M: number
  K: number
  fracNominal: number
  fracEff: number
  /** divider modulus offset y[n]（一階 {0,1}；MASH 1-1-1 {−3…4}） */
  y: Float64Array
  /** DTC phase residue [T_vco]（見檔頭） */
  residue: Float64Array
  /** 瞬時量化誤差 y[n] − in[n]/M（NTF 塑形的量） */
  quantError: Float64Array
  /** 依 normalization 正規化後的 residue（給 LMS 當 regressor） */
  code: Float64Array
  normalization: NormalizationParams & { stats: CodeStats }
  /** residue 的最小週期（從 length/4 之後偵測；dither 或週期過長時為 0） */
  period: number
  yRange: [number, number]
  residueRange: [number, number]
  warnings: string[]
}

/**
 * 產生 DSM 序列（worker 可呼叫；回傳可 structured clone）。
 * 例：runDsm({ kind: 'first_order', frac: 0.25, bits: 8, length: 8 }).y = [0,0,0,1,0,0,0,1]
 */
export function runDsm(opts: DsmOptions): DsmResult {
  const L = opts.length
  if (!Number.isInteger(L) || L < 1) throw new Error(`length 必須為正整數，收到 ${L}`)
  const q = quantizeFcw(opts.frac, opts.bits ?? 20, opts.dither ?? false)
  const rng = opts.dither ? createRng(opts.seed ?? 1).fork('dsm-dither') : undefined
  const s = new DsmStream(opts, rng)
  const y = new Float64Array(L)
  const residue = new Float64Array(L)
  const quantError = new Float64Array(L)
  let ymin = Infinity
  let ymax = -Infinity
  let rmin = Infinity
  let rmax = -Infinity
  for (let n = 0; n < L; n++) {
    const yn = s.step()
    y[n] = yn
    residue[n] = s.residue
    quantError[n] = s.quantError
    if (yn < ymin) ymin = yn
    if (yn > ymax) ymax = yn
    if (s.residue < rmin) rmin = s.residue
    if (s.residue > rmax) rmax = s.residue
  }
  const norm = normalizeCode(residue, opts.normalization ?? 'none')
  const start = Math.floor(L / 4)
  const period = opts.dither ? 0 : detectPeriod(residue, { start })
  return {
    kind: opts.kind,
    bits: q.bits,
    M: q.M,
    K: q.K,
    fracNominal: q.fracNominal,
    fracEff: q.fracEff,
    y,
    residue,
    quantError,
    code: norm.code,
    normalization: { mode: norm.mode, offset: norm.offset, scale: norm.scale, warnings: norm.warnings, stats: norm.stats },
    period,
    yRange: [ymin, ymax],
    residueRange: [rmin, rmax],
    warnings: [...q.warnings, ...norm.warnings],
  }
}

/** 一階 DSM（零初值、無 dither）的理論週期 M/gcd(K, M)。 */
export function firstOrderPeriod(K: number, bits: number): number {
  const M = Math.pow(2, bits)
  if (K === 0) return 1
  let a = K
  let b = M
  while (b !== 0) {
    const t = a % b
    a = b
    b = t
  }
  return M / a
}

/**
 * 序列的最小週期 P：對所有 start ≤ i < n − P，seq[i] 與 seq[i + P] 相等（tol = 0 時完全相等）。
 * 要求至少重複 minRepeats 次（(n − start) ≥ minRepeats·P，預設 2）；找不到回傳 0。
 * - tol = 0：KMP failure function，O(n)，可偵測任意長的週期（DSM 為整數運算，完全相等可靠）。
 * - tol > 0：逐一檢查 P = 1 … maxPeriod（預設 4096），O(n·maxPeriod)。
 */
export function detectPeriod(
  seq: ArrayLike<number>,
  opts: { start?: number; maxPeriod?: number; tol?: number; minRepeats?: number } = {},
): number {
  const start = opts.start ?? 0
  const tol = opts.tol ?? 0
  const minRepeats = opts.minRepeats ?? 2
  const n = seq.length - start
  if (n < 2) return 0
  const maxP = Math.min(opts.maxPeriod ?? (tol > 0 ? 4096 : Infinity), Math.floor(n / minRepeats))
  if (maxP < 1) return 0
  if (tol === 0) {
    const pi = new Int32Array(n)
    let k = 0
    for (let i = 1; i < n; i++) {
      const v = seq[start + i]
      while (k > 0 && seq[start + k] !== v) k = pi[k - 1]
      if (seq[start + k] === v) k++
      pi[i] = k
    }
    const p = n - pi[n - 1]
    return p <= maxP ? p : 0
  }
  outer: for (let p = 1; p <= maxP; p++) {
    for (let i = 0; i + p < n; i++) {
      if (Math.abs(seq[start + i] - seq[start + i + p]) > tol) continue outer
    }
    return p
  }
  return 0
}

/**
 * White-uniform 近似下的理論 one-sided PSD [1/Hz]（在 [0, f_s/2]，乘 (2/f_s)）：
 *   quant_error：(2/f_s)·(1/12)·|2 sin(πf/f_s)|^{2L}
 *   residue：    (2/f_s)·(1/12)·|2 sin(πf/f_s)|^{2(L−1)}
 * L = 1（一階）或 3（MASH 1-1-1）。一階 DSM 對常數輸入是 tonal（週期性），此近似很差，只供參考。
 * residue 的單位是 T_vco² /Hz（未正規化時）。
 */
export function dsmNoiseTheory(kind: DsmKind, f: ArrayLike<number>, fs: number, what: 'quant_error' | 'residue'): Float64Array {
  const L = kind === 'mash111' ? 3 : 1
  const pow = what === 'quant_error' ? 2 * L : 2 * (L - 1)
  const out = new Float64Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const m = Math.abs(2 * Math.sin((Math.PI * f[i]) / fs))
    out[i] = (2 / fs) * (1 / 12) * Math.pow(m, pow)
  }
  return out
}

/**
 * DSM 的 Welch PSD（one-sided density，預設 hann、nperseg 4096）與白-均勻近似理論曲線。
 * 每張圖須標示 window、nperseg、ENBW、one-sided 與單位（PsdResult 內皆有欄位）。
 */
export function dsmSpectra(
  res: Pick<DsmResult, 'quantError' | 'residue' | 'kind'>,
  fs: number,
  opts: WelchOptions = {},
): { quantError: PsdResult; residue: PsdResult; theoryQuantError: Float64Array; theoryResidue: Float64Array } {
  const o: WelchOptions = { window: 'hann', nperseg: 4096, ...opts }
  const qe = welch(res.quantError, fs, o)
  const re = welch(res.residue, fs, o)
  return {
    quantError: qe,
    residue: re,
    theoryQuantError: dsmNoiseTheory(res.kind, qe.f, fs, 'quant_error'),
    theoryResidue: dsmNoiseTheory(res.kind, re.f, fs, 'residue'),
  }
}

/**
 * PSD 在 [fLo, fHi] 內的對數斜率 [dB/decade]：以最小平方擬合 10·log10(psd) 對 log10(f)。
 * 只使用 psd > 0 的點；點數不足 2 時回傳 NaN。
 */
export function psdSlopeDbPerDecade(f: ArrayLike<number>, psd: ArrayLike<number>, fLo: number, fHi: number): number {
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < f.length; i++) {
    if (f[i] < fLo || f[i] > fHi || !(f[i] > 0) || !(psd[i] > 0)) continue
    const lx = Math.log10(f[i])
    const ly = 10 * Math.log10(psd[i])
    n++
    sx += lx
    sy += ly
    sxx += lx * lx
    sxy += lx * ly
  }
  if (n < 2) return NaN
  const den = n * sxx - sx * sx
  return den === 0 ? NaN : (n * sxy - sx * sy) / den
}

/**
 * Worker 可呼叫的一站式分析：產生 DSM 序列、Welch PSD（含白-均勻理論曲線）與低頻斜率。
 * @param slopeBand 斜率擬合頻帶 [Hz]，預設 [f_s/400, f_s/40]
 */
export function analyzeDsm(p: {
  options: DsmOptions
  fs: number
  welch?: WelchOptions
  slopeBand?: [number, number]
}): {
  result: DsmResult
  spectra: ReturnType<typeof dsmSpectra>
  slopeQuantErrorDbPerDec: number
  slopeResidueDbPerDec: number
} {
  if (!(p.fs > 0) || !Number.isFinite(p.fs)) throw new Error(`f_s 必須為正有限數，收到 ${p.fs}`)
  const result = runDsm(p.options)
  const spectra = dsmSpectra(result, p.fs, p.welch)
  const [lo, hi] = p.slopeBand ?? [p.fs / 400, p.fs / 40]
  return {
    result,
    spectra,
    slopeQuantErrorDbPerDec: psdSlopeDbPerDecade(spectra.quantError.f, spectra.quantError.psd, lo, hi),
    slopeResidueDbPerDec: psdSlopeDbPerDecade(spectra.residue.f, spectra.residue.psd, lo, hi),
  }
}
