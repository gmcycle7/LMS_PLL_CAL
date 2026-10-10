/**
 * 有限樣本互相關（cross-correlation）。
 *
 * 定義（lag 為整數，單位 sample）：
 *   R_xy[ℓ] = (1/|V_ℓ|) Σ_{n ∈ V_ℓ} x[n − ℓ] · y[n]，
 *   V_ℓ = { n : 0 ≤ n < len(y) 且 0 ≤ n − ℓ < len(x) }（只用重疊的有效樣本，不補零）。
 *
 * lag 的正負：若 y[n] = x[n − d]（y 比 x 延遲 d 個 sample），R_xy[ℓ] 在 ℓ = d 達到最大。
 * 也就是「正 lag = y 落後 x」。例如 LMS 中 x 為 DSM 激勵、y 為 comparator 輸出，
 * 迴路延遲 D 會在 R_xy[D] 呈現峰值。
 *
 * 'mean' 正規化（預設）除以有效樣本數 |V_ℓ|，對平穩訊號是 E{x[n−ℓ] y[n]} 的不偏估計，
 * 但大 |ℓ| 的樣本數少、變異大。'sum' 不除。注意此函式**不**先減平均；需要共變異數時請自行去平均。
 * 有效樣本數為 0 時回傳 NaN。
 */

import { fft, ifft, nextPow2 } from '@/simulation/signal/fft'

export type XcorrNormalization = 'mean' | 'sum'

function validRange(nx: number, ny: number, lag: number): [number, number] {
  // 0 ≤ n < ny 且 lag ≤ n < nx + lag
  const lo = Math.max(0, lag)
  const hi = Math.min(ny, nx + lag) // 不含
  return [lo, hi]
}

/**
 * 單一 lag 的互相關 R_xy[lag] = mean_n x[n − lag]·y[n]（定義見檔頭）。
 * @param lag 整數 lag [samples]；正值表示 y 落後 x
 */
export function xcorrAtLag(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  lag: number,
  normalization: XcorrNormalization = 'mean',
): number {
  if (!Number.isInteger(lag)) throw new Error(`lag 必須為整數，收到 ${lag}`)
  const [lo, hi] = validRange(x.length, y.length, lag)
  if (hi <= lo) return NaN
  let s = 0
  for (let n = lo; n < hi; n++) s += x[n - lag] * y[n]
  return normalization === 'mean' ? s / (hi - lo) : s
}

export interface XcorrResult {
  /** lag = −maxLag … +maxLag [samples] */
  lags: Int32Array
  /** 對應的 R_xy[lag] */
  values: Float64Array
  /** 每個 lag 的有效樣本數 |V_ℓ| */
  counts: Int32Array
}

/** 直接法與 FFT 法的切換門檻（運算量 ≈ 樣本數 × lag 數） */
const DIRECT_WORK_LIMIT = 4_000_000

/**
 * 互相關 R_xy[ℓ]，ℓ = −maxLag … +maxLag（定義見檔頭）。
 * 運算量大時自動改用 FFT 計算原始和（再除以有效樣本數），兩者結果在 ~1e−12 相對誤差內一致。
 * @param opts.method 'auto'（預設）| 'direct' | 'fft'
 */
export function xcorr(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  maxLag: number,
  opts: { normalization?: XcorrNormalization; method?: 'auto' | 'direct' | 'fft' } = {},
): XcorrResult {
  if (!Number.isInteger(maxLag) || maxLag < 0) throw new Error(`maxLag 必須為非負整數，收到 ${maxLag}`)
  const normalization = opts.normalization ?? 'mean'
  const nL = 2 * maxLag + 1
  const lags = new Int32Array(nL)
  const values = new Float64Array(nL)
  const counts = new Int32Array(nL)
  const nx = x.length
  const ny = y.length
  for (let i = 0; i < nL; i++) {
    const lag = i - maxLag
    lags[i] = lag
    const [lo, hi] = validRange(nx, ny, lag)
    counts[i] = Math.max(0, hi - lo)
  }
  const method = opts.method ?? 'auto'
  const useFft = method === 'fft' || (method === 'auto' && Math.min(nx, ny) * nL > DIRECT_WORK_LIMIT)

  if (!useFft) {
    for (let i = 0; i < nL; i++) values[i] = xcorrAtLag(x, y, lags[i], normalization)
    return { lags, values, counts }
  }

  // FFT 法：S[ℓ] = Σ_n x[n−ℓ] y[n] = Σ_m x[m] y[m+ℓ]，即 IFFT( conj(X) · Y )[ℓ]（循環，長度足夠時無混疊）
  const L = nextPow2(nx + ny - 1)
  const xr = new Float64Array(L)
  const xi = new Float64Array(L)
  const yr = new Float64Array(L)
  const yi = new Float64Array(L)
  for (let n = 0; n < nx; n++) xr[n] = x[n]
  for (let n = 0; n < ny; n++) yr[n] = y[n]
  fft(xr, xi)
  fft(yr, yi)
  for (let k = 0; k < L; k++) {
    // conj(X)·Y
    const r = xr[k] * yr[k] + xi[k] * yi[k]
    const im = xr[k] * yi[k] - xi[k] * yr[k]
    xr[k] = r
    xi[k] = im
  }
  ifft(xr, xi)
  for (let i = 0; i < nL; i++) {
    const lag = lags[i]
    const cnt = counts[i]
    if (cnt === 0) {
      values[i] = NaN
      continue
    }
    const s = xr[((lag % L) + L) % L]
    values[i] = normalization === 'mean' ? s / cnt : s
  }
  return { lags, values, counts }
}
