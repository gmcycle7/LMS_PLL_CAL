/**
 * 視窗函數（window）與其頻譜統計量。
 *
 * 週期（periodic）vs. 對稱（symmetric）：
 * - **periodic**（預設，`sym = false`）：分母用 N，即 w[n] = f(2πn/N)。這是長度 N+1 對稱窗去掉最後一點，
 *   對 DFT 而言窗的週期延伸是連續的，是頻譜分析（PSD、Welch）的正確選擇；
 *   與 `scipy.signal.get_window(name, N)`（fftbins=True）以及 `scipy.signal.welch` 使用的窗相同。
 * - **symmetric**（`sym = true`）：分母用 N-1，w[0] = w[N-1]，用於 FIR 濾波器設計；
 *   與 `scipy.signal.windows.hann(N)`（預設 sym=True）相同。
 */

export type WindowName = 'rectangular' | 'hann' | 'blackmanHarris'

/** 一般 cosine-sum 窗：w[n] = Σ_k (-1)^k a_k cos(2πkn/L)，L = N（periodic）或 N-1（symmetric）。 */
function cosineSum(n: number, coeffs: readonly number[], sym: boolean): Float64Array {
  if (!Number.isInteger(n) || n < 0) throw new Error(`window 長度必須為非負整數，收到 ${n}`)
  const w = new Float64Array(n)
  if (n === 1) {
    w[0] = 1
    return w
  }
  const L = sym ? n - 1 : n
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / L
    let v = 0
    for (let k = 0; k < coeffs.length; k++) v += (k % 2 === 0 ? 1 : -1) * coeffs[k] * Math.cos(k * t)
    w[i] = v
  }
  return w
}

/**
 * Hann window：w[n] = 0.5 − 0.5 cos(2πn/L)。
 * @param n 長度
 * @param sym false（預設）= periodic，L = n，用於頻譜分析；true = symmetric，L = n−1。
 * periodic Hann：coherent gain = 0.5，ENBW = 1.5 bins（n ≥ 2 時為精確值）。
 */
export function hann(n: number, sym = false): Float64Array {
  return cosineSum(n, [0.5, 0.5], sym)
}

/** 矩形窗（boxcar）：w[n] = 1。coherent gain = 1，ENBW = 1 bin。 */
export function rectangular(n: number): Float64Array {
  if (!Number.isInteger(n) || n < 0) throw new Error(`window 長度必須為非負整數，收到 ${n}`)
  return new Float64Array(n).fill(1)
}

/** 4-term Blackman–Harris 係數（−92 dB sidelobe；Harris 1978），與 `scipy.signal.windows.blackmanharris` 相同。 */
export const BLACKMAN_HARRIS_4 = [0.35875, 0.48829, 0.14128, 0.01168] as const

/**
 * 4-term Blackman–Harris window：
 * w[n] = a0 − a1 cos(2πn/L) + a2 cos(4πn/L) − a3 cos(6πn/L)。
 * @param sym false（預設）= periodic（L = n）；true = symmetric（L = n−1）。
 * periodic 時 coherent gain = a0 = 0.35875，ENBW ≈ 2.0044 bins。
 */
export function blackmanHarris(n: number, sym = false): Float64Array {
  return cosineSum(n, BLACKMAN_HARRIS_4, sym)
}

/** 依名稱產生視窗（預設 periodic）。 */
export function getWindow(name: WindowName, n: number, sym = false): Float64Array {
  switch (name) {
    case 'rectangular':
      return rectangular(n)
    case 'hann':
      return hann(n, sym)
    case 'blackmanHarris':
      return blackmanHarris(n, sym)
  }
}

export interface WindowStats {
  /** 長度 N */
  n: number
  /** Σ w[n] */
  sumW: number
  /** Σ w[n]² */
  sumW2: number
  /** coherent gain = Σw / N（單一 tone 經窗後的幅度縮放；矩形窗 = 1） */
  coherentGain: number
  /** 等效雜訊頻寬（ENBW），單位 bin：N Σw² / (Σw)²。乘上 fs/N 即為 Hz。 */
  enbwBins: number
}

/** 計算視窗的 coherent gain 與 ENBW（bins）。 */
export function windowStats(w: ArrayLike<number>): WindowStats {
  const n = w.length
  let sumW = 0
  let sumW2 = 0
  for (let i = 0; i < n; i++) {
    sumW += w[i]
    sumW2 += w[i] * w[i]
  }
  return {
    n,
    sumW,
    sumW2,
    coherentGain: n > 0 ? sumW / n : NaN,
    enbwBins: sumW !== 0 ? (n * sumW2) / (sumW * sumW) : NaN,
  }
}
