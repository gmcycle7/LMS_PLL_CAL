/**
 * 功率頻譜密度（PSD）估計與 tone 量測。
 *
 * 約定（與 `scipy.signal.periodogram` / `scipy.signal.welch` 預設一致）：
 * - 輸入 x 為實數序列，取樣率 fs [Hz]；x 的單位記為「x」，PSD 單位為 x²/Hz（scaling='density'）。
 * - 每個 segment：先 detrend（預設 'constant'＝減去該 segment 的平均），再乘 window w，做 nfft 點 DFT。
 * - density scaling：P[k] = |X[k]|² / (fs · Σw²)；spectrum scaling：P[k] = |X[k]|² / (Σw)²（單位 x²）。
 * - Welch：segment 起點 0, step, 2·step, …（step = nperseg − noverlap），共 ⌊(N − noverlap)/step⌋ 段，取平均。
 * - one-sided（預設）：只回傳 f = k·fs/nfft，k = 0…⌊nfft/2⌋，並把 DC 與 Nyquist（nfft 為偶數時才存在）
 *   以外的 bin 乘 2。因此 Σ_k P[k]·Δf（Δf = fs/nfft）＝ 兩邊頻譜總功率。
 * - two-sided：回傳全部 nfft 個 bin，順序為 fftfreq 順序（0, 正頻率, 負頻率），與 SciPy 相同。
 *
 * 相位雜訊：對相位 φ [rad] 的 one-sided PSD S_φ^(1)(f) [rad²/Hz]，ℒ(f) = 10·log10(S_φ^(1)(f)/2) [dBc/Hz]
 * （小角近似；見規格 §12.3 與 dev-conventions §5），用 `psdToDbcHz` 換算。
 */

import { fft, fftfreq, rfftfreq } from '@/simulation/signal/fft'
import { getWindow, type WindowName } from '@/simulation/signal/window'

export type Detrend = 'constant' | 'mean' | 'linear' | 'none'
export type PsdScaling = 'density' | 'spectrum'

export interface PeriodogramOptions {
  /** 視窗名稱或自訂窗係數；periodogram 預設 'rectangular'（SciPy 'boxcar'），welch 預設 'hann'（periodic）。 */
  window?: WindowName | ArrayLike<number>
  /** DFT 長度；預設 = segment 長度。大於 segment 長度時補零（只增加頻率格點密度，不增加解析度）。 */
  nfft?: number
  /** 每段的 detrend；預設 'constant'（減平均）。'mean' 為 'constant' 的別名。 */
  detrend?: Detrend | false
  /** 預設 true（one-sided，DC/Nyquist 以外乘 2）。 */
  onesided?: boolean
  /** 預設 'density'（x²/Hz）；'spectrum' 為功率頻譜（x²，coherent tone 讀數 = A²/2）。 */
  scaling?: PsdScaling
}

export interface WelchOptions extends PeriodogramOptions {
  /** segment 長度；預設 256（若 x 較短則用 x.length，同 SciPy）。window 為陣列時預設為其長度。 */
  nperseg?: number
  /** 相鄰 segment 重疊點數；預設 ⌊nperseg/2⌋，必須 < nperseg。 */
  noverlap?: number
}

export interface PsdResult {
  /** 頻率 [Hz] */
  f: Float64Array
  /** PSD [x²/Hz]（scaling='density'）或功率頻譜 [x²]（scaling='spectrum'） */
  psd: Float64Array
  onesided: boolean
  scaling: PsdScaling
  units: 'x^2/Hz' | 'x^2'
  /** 取樣率 [Hz] */
  fs: number
  /** bin 間距 Δf = fs/nfft [Hz] */
  df: number
  /** 視窗的等效雜訊頻寬 ENBW = fs·Σw²/(Σw)² [Hz]（與 nfft 補零無關） */
  enbwHz: number
  /** ENBW 以「nperseg 解析度 bin（fs/nperseg）」為單位 = N Σw²/(Σw)² */
  enbwBins: number
  nperseg: number
  noverlap: number
  nfft: number
  /** 平均的 segment 數 */
  nSegments: number
  window: WindowName | 'custom'
  detrend: 'constant' | 'linear' | 'none'
  /** 最後一段之後未被任何 segment 使用的樣本數 = N − ((nSegments−1)·step + nperseg) */
  unusedSamples: number
  /** 參數被自動調整時的說明（例如 nperseg > N 時改用 N），UI 應顯示 */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// 內部工具
// ---------------------------------------------------------------------------

function normDetrend(d: Detrend | false | undefined): 'constant' | 'linear' | 'none' {
  if (d === undefined || d === 'constant' || d === 'mean') return 'constant'
  if (d === false || d === 'none') return 'none'
  return 'linear'
}

/** 原地 detrend 一段資料 seg[0…L-1]。'linear' 為最小平方直線（同 scipy.signal.detrend type='linear'）。 */
function detrendInPlace(seg: Float64Array, L: number, mode: 'constant' | 'linear' | 'none'): void {
  if (mode === 'none' || L === 0) return
  let mean = 0
  for (let i = 0; i < L; i++) mean += seg[i]
  mean /= L
  if (mode === 'constant' || L === 1) {
    for (let i = 0; i < L; i++) seg[i] -= mean
    return
  }
  // 以中心化的時間軸 t = i − (L−1)/2 做直線擬合，數值較穩定
  const tc = (L - 1) / 2
  let stt = 0
  let sty = 0
  for (let i = 0; i < L; i++) {
    const t = i - tc
    stt += t * t
    sty += t * (seg[i] - mean)
  }
  const slope = sty / stt
  for (let i = 0; i < L; i++) seg[i] -= mean + slope * (i - tc)
}

function resolveWindow(
  window: WindowName | ArrayLike<number>,
  nperseg: number,
): { w: Float64Array; name: WindowName | 'custom' } {
  if (typeof window === 'string') return { w: getWindow(window, nperseg), name: window }
  if (window.length !== nperseg) throw new Error(`自訂 window 長度 ${window.length} 與 nperseg ${nperseg} 不同`)
  return { w: Float64Array.from(window), name: 'custom' }
}

function checkFs(fs: number): void {
  if (!(fs > 0) || !Number.isFinite(fs)) throw new Error(`fs 必須為正有限數，收到 ${fs}`)
}

/**
 * Welch 核心：x 已確定長度 ≥ nperseg。兩個實數 segment 合併成一次複數 FFT 以減半運算量：
 * Z = FFT(s1 + j s2)，X1[k] = (Z[k] + Z*[−k])/2，X2[k] = (Z[k] − Z*[−k])/(2j)，
 * 因此 |X1[k]|² + |X2[k]|² = (|Z[k]|² + |Z[−k]|²)/2（恆等式，無相減抵銷誤差）。
 */
function welchCore(
  x: ArrayLike<number>,
  fs: number,
  w: Float64Array,
  windowName: WindowName | 'custom',
  nperseg: number,
  noverlap: number,
  nfft: number,
  detrend: 'constant' | 'linear' | 'none',
  onesided: boolean,
  scaling: PsdScaling,
  warnings: string[],
): PsdResult {
  const N = x.length
  const step = nperseg - noverlap
  const K = Math.floor((N - noverlap) / step)
  let sumW = 0
  let sumW2 = 0
  for (let i = 0; i < nperseg; i++) {
    sumW += w[i]
    sumW2 += w[i] * w[i]
  }
  const scale = scaling === 'density' ? 1 / (fs * sumW2) : 1 / (sumW * sumW)
  const nOut = onesided ? Math.floor(nfft / 2) + 1 : nfft
  const acc = new Float64Array(nOut)
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  const seg = new Float64Array(nperseg)

  const loadSegment = (s: number, dst: Float64Array): void => {
    const start = s * step
    for (let i = 0; i < nperseg; i++) seg[i] = x[start + i]
    detrendInPlace(seg, nperseg, detrend)
    for (let i = 0; i < nperseg; i++) dst[i] = seg[i] * w[i]
    for (let i = nperseg; i < nfft; i++) dst[i] = 0
  }

  let s = 0
  for (; s + 1 < K; s += 2) {
    loadSegment(s, re)
    loadSegment(s + 1, im)
    fft(re, im)
    for (let k = 0; k < nOut; k++) {
      const nk = k === 0 ? 0 : nfft - k
      acc[k] += (re[k] * re[k] + im[k] * im[k] + re[nk] * re[nk] + im[nk] * im[nk]) / 2
    }
  }
  if (s < K) {
    loadSegment(s, re)
    im.fill(0)
    fft(re, im)
    for (let k = 0; k < nOut; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
  }

  const psd = new Float64Array(nOut)
  const norm = scale / K
  for (let k = 0; k < nOut; k++) psd[k] = acc[k] * norm
  if (onesided) {
    const last = nfft % 2 === 0 ? nOut - 1 : nOut // 偶數 nfft：Nyquist bin 不加倍
    for (let k = 1; k < last; k++) psd[k] *= 2
  }

  return {
    f: onesided ? rfftfreq(nfft, fs) : fftfreq(nfft, fs),
    psd,
    onesided,
    scaling,
    units: scaling === 'density' ? 'x^2/Hz' : 'x^2',
    fs,
    df: fs / nfft,
    enbwHz: (fs * sumW2) / (sumW * sumW),
    enbwBins: (nperseg * sumW2) / (sumW * sumW),
    nperseg,
    noverlap,
    nfft,
    nSegments: K,
    window: windowName,
    detrend,
    unusedSamples: N - ((K - 1) * step + nperseg),
    warnings,
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * Welch 平均 periodogram（同 `scipy.signal.welch(x, fs, window='hann', nperseg=256, noverlap=nperseg//2,
 * detrend='constant', return_onesided=True, scaling='density', average='mean')`）。
 * @param x 實數訊號（單位 x）
 * @param fs 取樣率 [Hz]
 * @returns PSD [x²/Hz]，與 ENBW、segment 數等量測條件（PSD 圖必須標示）
 */
export function welch(x: ArrayLike<number>, fs: number, opts: WelchOptions = {}): PsdResult {
  checkFs(fs)
  const N = x.length
  if (N === 0) throw new Error('welch：輸入長度為 0')
  const window = opts.window ?? 'hann'
  const warnings: string[] = []
  let nperseg: number
  if (typeof window === 'string') {
    nperseg = opts.nperseg ?? 256
    if (!Number.isInteger(nperseg) || nperseg < 1) throw new Error(`nperseg 必須為正整數，收到 ${nperseg}`)
    if (nperseg > N) {
      // 同 SciPy：nperseg > len(x) 時改用 len(x)
      warnings.push(`nperseg（${nperseg}）大於訊號長度（${N}），改用 nperseg = ${N}`)
      nperseg = N
    }
  } else {
    nperseg = opts.nperseg ?? window.length
    if (nperseg > N) throw new Error(`自訂 window 長度 ${nperseg} 大於訊號長度 ${N}`)
  }
  const { w, name } = resolveWindow(window, nperseg)
  const nfft = opts.nfft ?? nperseg
  if (!Number.isInteger(nfft) || nfft < nperseg) throw new Error(`nfft（${nfft}）必須為整數且 ≥ nperseg（${nperseg}）`)
  const noverlap = opts.noverlap ?? Math.floor(nperseg / 2)
  if (!Number.isInteger(noverlap) || noverlap < 0 || noverlap >= nperseg) {
    throw new Error(`noverlap（${noverlap}）必須為整數且 0 ≤ noverlap < nperseg（${nperseg}）`)
  }
  return welchCore(
    x,
    fs,
    w,
    name,
    nperseg,
    noverlap,
    nfft,
    normDetrend(opts.detrend),
    opts.onesided ?? true,
    opts.scaling ?? 'density',
    warnings,
  )
}

/**
 * Whole-record periodogram（同 `scipy.signal.periodogram(x, fs, window='boxcar', nfft=None,
 * detrend='constant', return_onesided=True, scaling='density')`）。
 * nfft < x.length 時只使用前 nfft 點（同 SciPy）；nfft > x.length 時補零。
 */
export function periodogram(x: ArrayLike<number>, fs: number, opts: PeriodogramOptions = {}): PsdResult {
  checkFs(fs)
  if (x.length === 0) throw new Error('periodogram：輸入長度為 0')
  let data: ArrayLike<number> = x
  let nperseg = x.length
  const nfft = opts.nfft ?? x.length
  if (!Number.isInteger(nfft) || nfft < 1) throw new Error(`nfft 必須為正整數，收到 ${nfft}`)
  if (nfft < x.length) {
    // 同 SciPy：只取前 nfft 點
    const head = new Float64Array(nfft)
    for (let i = 0; i < nfft; i++) head[i] = x[i]
    data = head
    nperseg = nfft
  }
  return welch(data, fs, {
    window: opts.window ?? 'rectangular',
    nperseg,
    noverlap: 0,
    nfft,
    detrend: opts.detrend,
    onesided: opts.onesided,
    scaling: opts.scaling,
  })
}

/**
 * 把相位的 one-sided PSD S_φ^(1) [rad²/Hz] 換成單邊相位雜訊 ℒ(f) = 10·log10(S_φ^(1)/2) [dBc/Hz]。
 * S = 0 時回傳 −Infinity。
 */
export function psdToDbcHz(sPhi: number): number
export function psdToDbcHz(sPhi: ArrayLike<number>): Float64Array
export function psdToDbcHz(sPhi: number | ArrayLike<number>): number | Float64Array {
  if (typeof sPhi === 'number') return 10 * Math.log10(sPhi / 2)
  const out = new Float64Array(sPhi.length)
  for (let i = 0; i < sPhi.length; i++) out[i] = 10 * Math.log10(sPhi[i] / 2)
  return out
}

/**
 * DTFT 形式 PSD → one-sided 連續頻率 PSD（validation.md E28）：
 *   若 σ² = (1/2π) ∫_{−π}^{π} S(e^{jΩ}) dΩ（單位 x²/(rad/sample)），則
 *   S^(1)(f) = (2/fs) · S(e^{j2πf/fs})，0 < f < fs/2（單位 x²/Hz），使 ∫_0^{fs/2} S^(1) df = σ²。
 * block-rate 量（例如 S_w）請把 fs 換成 block 更新率 f_u。
 * 忘記這個換算會讓 ℒ(f) 偏移 10·log10(fs/2)（fs = 4 GHz 時約 93 dB）。
 */
export function dtftPsdToOnesided(sDtft: number, fs: number): number
export function dtftPsdToOnesided(sDtft: ArrayLike<number>, fs: number): Float64Array
export function dtftPsdToOnesided(sDtft: number | ArrayLike<number>, fs: number): number | Float64Array {
  checkFs(fs)
  if (typeof sDtft === 'number') return (2 * sDtft) / fs
  const out = new Float64Array(sDtft.length)
  for (let i = 0; i < sDtft.length; i++) out[i] = (2 * sDtft[i]) / fs
  return out
}

// ---------------------------------------------------------------------------
// 積分
// ---------------------------------------------------------------------------

/** 在遞增格點 f 上線性內插 y(f0)（f0 必須落在 [f[0], f[n-1]]）。 */
function interpAt(f: ArrayLike<number>, y: ArrayLike<number>, f0: number): number {
  let lo = 0
  let hi = f.length - 1
  if (f0 <= f[lo]) return y[lo]
  if (f0 >= f[hi]) return y[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (f[mid] <= f0) lo = mid
    else hi = mid
  }
  const t = (f0 - f[lo]) / (f[hi] - f[lo])
  return y[lo] + t * (y[hi] - y[lo])
}

/**
 * ∫_{fL}^{fH} psd(f) df，梯形法；邊界 fL、fH 落在格點之間時以線性內插取值。
 * - f 必須嚴格遞增（one-sided PSD 的 f 符合；two-sided 結果請先 fftshift）。
 * - fL、fH 會被夾在 [f[0], f[n-1]]；夾完後 fH ≤ fL 回傳 0。
 * - 對 one-sided density PSD，∫_0^{fs/2} 約等於訊號（detrend 後）的變異數；
 *   梯形法與 Σ P[k]·Δf 的差異只在兩端各半個 bin。
 * @returns 功率 [x²]（例如 S_δt [s²/Hz] 積分得 σ_t² [s²]）
 */
export function integratePsd(f: ArrayLike<number>, psd: ArrayLike<number>, fL: number, fH: number): number {
  const n = f.length
  if (psd.length !== n) throw new Error('integratePsd：f 與 psd 長度不同')
  if (n < 2) return 0
  const a = Math.max(fL, f[0])
  const b = Math.min(fH, f[n - 1])
  if (!(b > a)) return 0
  let prevF = a
  let prevP = interpAt(f, psd, a)
  let area = 0
  // 第一個 f[i] > a
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (f[mid] <= a) lo = mid
    else hi = mid
  }
  let i = f[lo] > a ? lo : hi
  for (; i < n && f[i] < b; i++) {
    area += ((f[i] - prevF) * (psd[i] + prevP)) / 2
    prevF = f[i]
    prevP = psd[i]
  }
  area += ((b - prevF) * (interpAt(f, psd, b) + prevP)) / 2
  return area
}

// ---------------------------------------------------------------------------
// Coherent tone 量測（規格 §15.5）
// ---------------------------------------------------------------------------

export interface ToneFitComponent {
  /** tone 頻率 [Hz] */
  f: number
  /** cos 係數 a 與 sin 係數 b：a·cos(2πf n/fs) + b·sin(2πf n/fs) */
  a: number
  b: number
  /** peak 振幅 A = √(a² + b²)（單位同 x） */
  amplitudePeak: number
  /** RMS 振幅 A/√2 */
  amplitudeRms: number
  /** 相位 φ [rad]，使得分量 = A·cos(2πf·n/fs + φ)，時間原點為 n = 0 */
  phase: number
}

export interface ToneFitMultiResult {
  tones: ToneFitComponent[]
  /** 擬合的 DC 值（includeDc = false 時為 0） */
  dc: number
  /** 殘差 RMS = √(mean(r²))，r = x − 擬合 */
  rmsResidual: number
  /** 樣本數 */
  n: number
  /** 因秩不足（例如 f = 0 或 f = fs/2 的 sin 欄全為 0）被捨棄、係數設為 0 的欄位數 */
  droppedColumns: number
}

export interface ToneFitResult extends ToneFitComponent {
  dc: number
  rmsResidual: number
  n: number
  droppedColumns: number
}

/**
 * 小型最小平方：min ||y − A c||₂，A 以欄向量給定。Modified Gram–Schmidt（兩次正交化）QR；
 * 與前面欄位線性相依的欄位會被捨棄（係數 = 0）。**會原地覆寫 cols**（變成 Q）以節省記憶體。
 */
function leastSquaresColumns(cols: Float64Array[], y: ArrayLike<number>): { coef: Float64Array; dropped: number } {
  const p = cols.length
  const n = y.length
  const Q: (Float64Array | null)[] = []
  const R: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  const tol = 1e-9 * Math.sqrt(Math.max(n, 1))
  let dropped = 0
  for (let j = 0; j < p; j++) {
    const v = cols[j]
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < j; i++) {
        const q = Q[i]
        if (!q) continue
        let r = 0
        for (let t = 0; t < n; t++) r += q[t] * v[t]
        R[i][j] += r
        for (let t = 0; t < n; t++) v[t] -= r * q[t]
      }
    }
    let norm = 0
    for (let t = 0; t < n; t++) norm += v[t] * v[t]
    norm = Math.sqrt(norm)
    if (norm <= tol) {
      Q.push(null)
      dropped++
      continue
    }
    for (let t = 0; t < n; t++) v[t] /= norm
    R[j][j] = norm
    Q.push(v)
  }
  const qty = new Float64Array(p)
  for (let j = 0; j < p; j++) {
    const q = Q[j]
    if (!q) continue
    let s = 0
    for (let t = 0; t < n; t++) s += q[t] * y[t]
    qty[j] = s
  }
  const coef = new Float64Array(p)
  for (let j = p - 1; j >= 0; j--) {
    if (!Q[j]) continue
    let s = qty[j]
    for (let k = j + 1; k < p; k++) s -= R[j][k] * coef[k]
    coef[j] = s / R[j][j]
  }
  return { coef, dropped }
}

/**
 * 多個已知頻率 tone 的 coherent 最小平方擬合：
 *   x[n] ≈ dc + Σ_i [a_i cos(2π f_i n/fs) + b_i sin(2π f_i n/fs)]，n = 0 … N−1。
 * 不需要整數週期（non-coherent sampling 也正確），也不受 window leakage 影響；
 * 但頻率必須已知且準確（頻率誤差 Δf 會讓長紀錄的振幅估計下降，約 sinc(Δf·N/fs)）。
 * @param freqs tone 頻率 [Hz]，應位於 [0, fs/2]
 * @param opts.includeDc 是否同時擬合 DC（預設 true）
 */
export function toneFitMulti(
  x: ArrayLike<number>,
  fs: number,
  freqs: readonly number[],
  opts: { includeDc?: boolean } = {},
): ToneFitMultiResult {
  checkFs(fs)
  const n = x.length
  if (n === 0) throw new Error('toneFit：輸入長度為 0')
  const includeDc = opts.includeDc ?? true
  const cols: Float64Array[] = []
  if (includeDc) cols.push(new Float64Array(n).fill(1))
  for (const f of freqs) {
    const w = (2 * Math.PI * f) / fs
    const cc = new Float64Array(n)
    const ss = new Float64Array(n)
    for (let t = 0; t < n; t++) {
      cc[t] = Math.cos(w * t)
      ss[t] = Math.sin(w * t)
    }
    cols.push(cc, ss)
  }
  const { coef, dropped } = leastSquaresColumns(cols, x) // cols 已被覆寫
  const off = includeDc ? 1 : 0
  // 殘差以原始模型重新計算（不依賴 Q），r = x − 擬合
  const ws = freqs.map((f) => (2 * Math.PI * f) / fs)
  let sse = 0
  for (let t = 0; t < n; t++) {
    let fit = includeDc ? coef[0] : 0
    for (let i = 0; i < ws.length; i++) fit += coef[off + 2 * i] * Math.cos(ws[i] * t) + coef[off + 2 * i + 1] * Math.sin(ws[i] * t)
    const r = x[t] - fit
    sse += r * r
  }
  const tones: ToneFitComponent[] = freqs.map((f, i) => {
    const a = coef[off + 2 * i]
    const b = coef[off + 2 * i + 1]
    const A = Math.hypot(a, b)
    return { f, a, b, amplitudePeak: A, amplitudeRms: A / Math.SQRT2, phase: Math.atan2(-b, a) }
  })
  return { tones, dc: includeDc ? coef[0] : 0, rmsResidual: Math.sqrt(sse / n), n, droppedColumns: dropped }
}

/**
 * 單一已知頻率 f0 的 coherent tone 量測（規格 §15.5「coherent tone measurement」）：
 * 最小平方擬合 x[n] ≈ dc + a·cos(2πf0 n/fs) + b·sin(2πf0 n/fs)。
 * @returns amplitudePeak = √(a²+b²)（peak，不是 RMS）、phase φ（x ≈ A cos(2πf0 n/fs + φ)，rad）、
 *          rmsResidual（殘差 RMS，單位同 x）
 */
export function toneFit(x: ArrayLike<number>, fs: number, f0: number, opts: { includeDc?: boolean } = {}): ToneFitResult {
  const r = toneFitMulti(x, fs, [f0], opts)
  return { ...r.tones[0], dc: r.dc, rmsResidual: r.rmsResidual, n: r.n, droppedColumns: r.droppedColumns }
}

// ---------------------------------------------------------------------------
// Tone / spur 偵測
// ---------------------------------------------------------------------------

export interface FindTonesOptions {
  /** 最小 prominence [dB]（SciPy `peak_prominences` 定義，套用在 10log10(PSD) 上）；預設 10 dB */
  minProminenceDb?: number
  /** 最多回傳幾個 tone（依估計功率由大到小）；預設 10 */
  maxTones?: number
  /** main lobe 單邊最大寬度 [bins]；預設 4（涵蓋 Blackman–Harris 的 ±4 bin 主瓣；Hann 為 ±2）。補零時要放大。 */
  lobeHalfWidthBins?: number
  /** 只在 [fMin, fMax] 內找峰值 [Hz] */
  fMin?: number
  fMax?: number
}

export interface DetectedTone {
  /** 峰值 bin 的頻率 [Hz] */
  f: number
  /** 主瓣內以功率加權的頻率重心 [Hz]（non-coherent 時比 bin 頻率更接近真實頻率） */
  fCentroid: number
  /** 峰值 bin index */
  index: number
  /** 峰值 bin 的 PSD 值（單位同輸入） */
  peakPsd: number
  /** prominence [dB] */
  prominenceDb: number
  /** 主瓣範圍 [lo, hi]（含） */
  lobe: [number, number]
  /** 估計 tone 功率 = Σ_{主瓣} PSD[k]·Δf（density PSD → x²；peak 振幅 A 的 tone 約 A²/2） */
  power: number
  /** 10·log10(power) */
  powerDb: number
}

/**
 * 在 PSD 上找離散 tone（spur）並估計其功率。
 *
 * **近似、且與 window 有關**：功率 = 主瓣內 bin 的 PSD 和 × Δf。主瓣由峰值向兩側延伸，直到 PSD 不再單調下降
 * 或達到 `lobeHalfWidthBins`。主瓣外的 sidelobe 能量（矩形窗 non-coherent 時可達數 %）不計入；
 * 主瓣內的雜訊會被計入（約 雜訊密度 × 主瓣寬度）。精確量測請用 `toneFit`（已知頻率的 coherent 擬合）。
 * 原始 periodogram 的雜訊 bin 起伏很大（每 bin 為 χ²₂ 分佈），可能產生 10–20 dB prominence 的假峰；
 * 建議使用 Welch 平均並提高 `minProminenceDb`。
 *
 * - f 必須為等間距遞增（Δf = f[1] − f[0]）。陣列兩端點不視為峰值。
 * @returns 依 power 由大到小排序
 */
export function findTones(f: ArrayLike<number>, psd: ArrayLike<number>, opts: FindTonesOptions = {}): DetectedTone[] {
  const n = f.length
  if (psd.length !== n) throw new Error('findTones：f 與 psd 長度不同')
  if (n < 3) return []
  const minProm = opts.minProminenceDb ?? 10
  const maxTones = opts.maxTones ?? 10
  const cap = Math.max(0, Math.floor(opts.lobeHalfWidthBins ?? 4))
  const fMin = opts.fMin ?? -Infinity
  const fMax = opts.fMax ?? Infinity
  const df = f[1] - f[0]
  const db = new Float64Array(n)
  for (let i = 0; i < n; i++) db[i] = 10 * Math.log10(Math.max(psd[i], 1e-300))

  const found: DetectedTone[] = []
  for (let i = 1; i < n - 1; i++) {
    if (f[i] < fMin || f[i] > fMax) continue
    // 局部最大（plateau 取第一點）
    if (!(psd[i] > psd[i - 1] && psd[i] >= psd[i + 1])) continue
    // prominence：向兩側找到更高點（或邊界）為止，取兩側最小值中較高者為基準
    let leftMin = db[i]
    for (let j = i - 1; j >= 0 && db[j] <= db[i]; j--) if (db[j] < leftMin) leftMin = db[j]
    let rightMin = db[i]
    for (let j = i + 1; j < n && db[j] <= db[i]; j++) if (db[j] < rightMin) rightMin = db[j]
    const prom = db[i] - Math.max(leftMin, rightMin)
    if (prom < minProm) continue
    let lo = i
    while (lo > 0 && i - lo < cap && psd[lo - 1] < psd[lo]) lo--
    let hi = i
    while (hi < n - 1 && hi - i < cap && psd[hi + 1] < psd[hi]) hi++
    let sumP = 0
    let sumFP = 0
    for (let k = lo; k <= hi; k++) {
      sumP += psd[k]
      sumFP += f[k] * psd[k]
    }
    const power = sumP * df
    found.push({
      f: f[i],
      fCentroid: sumP > 0 ? sumFP / sumP : f[i],
      index: i,
      peakPsd: psd[i],
      prominenceDb: prom,
      lobe: [lo, hi],
      power,
      powerDb: 10 * Math.log10(power),
    })
  }
  found.sort((p, q) => q.power - p.power)
  return found.slice(0, maxTones)
}
