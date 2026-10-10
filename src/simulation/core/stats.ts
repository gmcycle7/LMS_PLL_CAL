/**
 * 描述統計與信賴區間（descriptive statistics & confidence intervals）。
 * 輸入一律接受 ArrayLike<number>（number[] 或 Float64Array）。
 * 加總使用 Neumaier 補償加總，變異數使用兩段式（two-pass）修正演算法，對 1e6 點序列仍保持精度。
 */
import { normInv, studentTInv } from '@/simulation/core/special'

/** Neumaier 補償加總 Σx */
export function sum(x: ArrayLike<number>): number {
  let s = 0
  let comp = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const t = s + v
    if (Math.abs(s) >= Math.abs(v)) comp += s - t + v
    else comp += v - t + s
    s = t
  }
  return s + comp
}

/** 平均值；空陣列回傳 NaN */
export function mean(x: ArrayLike<number>): number {
  if (x.length === 0) return NaN
  return sum(x) / x.length
}

/**
 * 變異數 Σ(x − x̄)²/(N − ddof)，預設 ddof = 1（樣本變異數，unbiased）；ddof = 0 為母體變異數。
 * 使用修正兩段式公式 [Σd² − (Σd)²/N]/(N − ddof)。N ≤ ddof 時回傳 NaN。
 */
export function variance(x: ArrayLike<number>, ddof = 1): number {
  const n = x.length
  if (n <= ddof || n === 0) return NaN
  const m = mean(x)
  let s2 = 0
  let s1 = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - m
    s1 += d
    s2 += d * d
  }
  return Math.max(0, (s2 - (s1 * s1) / n) / (n - ddof))
}

/** 標準差 √variance(x, ddof)，預設 ddof = 1 */
export function std(x: ArrayLike<number>, ddof = 1): number {
  return Math.sqrt(variance(x, ddof))
}

/** RMS 值 √(Σx²/N)（不扣平均） */
export function rms(x: ArrayLike<number>): number {
  const n = x.length
  if (n === 0) return NaN
  let scale = 0
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(x[i]))
  if (scale === 0 || !Number.isFinite(scale)) return scale
  let s = 0
  for (let i = 0; i < n; i++) {
    const t = x[i] / scale
    s += t * t
  }
  return scale * Math.sqrt(s / n)
}

/** 最小值與最大值（不使用 Math.min(...x)，避免大陣列 stack overflow）；含 NaN 時回傳 NaN */
export function minMax(x: ArrayLike<number>): { min: number; max: number } {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (Number.isNaN(v)) return { min: NaN, max: NaN }
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return { min: lo, max: hi }
}

function sortedCopy(x: ArrayLike<number>): Float64Array {
  return Float64Array.from(x).sort()
}

function quantileSorted(s: Float64Array, q: number): number {
  const n = s.length
  if (n === 0 || Number.isNaN(q)) return NaN
  if (q < 0 || q > 1) throw new Error(`quantile：q 必須在 [0, 1]，收到 ${q}`)
  // NumPy 預設 'linear'（Hyndman–Fan type 7）
  const h = (n - 1) * q
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, n - 1)
  return s[lo] + (h - lo) * (s[hi] - s[lo])
}

/** 分位數（線性內插，等同 NumPy np.quantile 預設 method='linear'） */
export function quantile(x: ArrayLike<number>, q: number): number {
  return quantileSorted(sortedCopy(x), q)
}

/** 多個分位數（只排序一次） */
export function quantiles(x: ArrayLike<number>, qs: ArrayLike<number>): number[] {
  const s = sortedCopy(x)
  return Array.from(qs, (q) => quantileSorted(s, q))
}

/** 中位數 */
export function median(x: ArrayLike<number>): number {
  return quantile(x, 0.5)
}

export interface Histogram {
  /** bins + 1 個邊界 */
  edges: number[]
  /** 每個 bin 的計數 */
  counts: number[]
  /** bin 中心 */
  centers: number[]
  /** 落在 range 之外（被丟棄）的樣本數 */
  outside: number
}

/**
 * 直方圖（與 NumPy np.histogram 相同慣例）：bins 個等寬 bin，[e_i, e_{i+1})，最後一個 bin 含右端點。
 * range 省略時取 [min, max]；若 min = max 則取 [min − 0.5, max + 0.5]。NaN 樣本會被忽略並計入 outside。
 */
export function histogram(x: ArrayLike<number>, bins: number, range?: [number, number]): Histogram {
  if (!Number.isInteger(bins) || bins < 1) throw new Error(`histogram：bins 必須是正整數，收到 ${bins}`)
  let lo: number
  let hi: number
  if (range) {
    lo = range[0]
    hi = range[1]
    if (!(hi > lo)) throw new Error(`histogram：range 需要 lo < hi，收到 [${lo}, ${hi}]`)
  } else {
    let mn = Infinity
    let mx = -Infinity
    for (let i = 0; i < x.length; i++) {
      const v = x[i]
      if (Number.isNaN(v)) continue
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (mn === Infinity) {
      mn = 0
      mx = 1
    }
    if (mn === mx) {
      mn -= 0.5
      mx += 0.5
    }
    lo = mn
    hi = mx
  }
  const width = (hi - lo) / bins
  const edges = Array.from({ length: bins + 1 }, (_, i) => (i === bins ? hi : lo + i * width))
  const counts = new Array<number>(bins).fill(0)
  let outside = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (!(v >= lo && v <= hi)) {
      outside++
      continue
    }
    let k = Math.floor((v - lo) / width)
    if (k >= bins) k = bins - 1
    // 浮點邊界修正：確保 edges[k] ≤ v < edges[k+1]
    if (k > 0 && v < edges[k]) k--
    else if (k < bins - 1 && v >= edges[k + 1]) k++
    counts[k]++
  }
  const centers = counts.map((_, i) => 0.5 * (edges[i] + edges[i + 1]))
  return { edges, counts, centers, outside }
}

export interface MeanCI {
  mean: number
  /** 下界 */
  lo: number
  /** 上界 */
  hi: number
  /** 半寬 t_{ν, (1+level)/2} · s/√N */
  halfWidth: number
  /** 標準誤 s/√N */
  se: number
  n: number
  level: number
}

/**
 * 平均值的 Student-t 信賴區間（假設樣本 iid、近似常態；有自相關時請先算有效樣本數）。
 * N < 2 時區間無法估計：halfWidth = se = NaN，lo/hi = NaN。
 */
export function meanCI(x: ArrayLike<number>, level = 0.95): MeanCI {
  if (!(level > 0 && level < 1)) throw new Error(`meanCI：level 必須在 (0, 1)，收到 ${level}`)
  const n = x.length
  const m = mean(x)
  if (n < 2) return { mean: m, lo: NaN, hi: NaN, halfWidth: NaN, se: NaN, n, level }
  const se = std(x, 1) / Math.sqrt(n)
  const tq = studentTInv(0.5 + level / 2, n - 1)
  const halfWidth = tq * se
  return { mean: m, lo: m - halfWidth, hi: m + halfWidth, halfWidth, se, n, level }
}

export interface ProportionCI {
  /** 點估計 k/n */
  p: number
  lo: number
  hi: number
  /** Wilson 區間中心 */
  center: number
  level: number
}

/**
 * 比例的 Wilson score 信賴區間（k 次成功 / n 次試驗）。比 Wald 區間在 p 接近 0、1 或 n 小時可靠。
 */
export function wilsonCI(k: number, n: number, level = 0.95): ProportionCI {
  if (!(n > 0)) throw new Error(`wilsonCI：n 必須 > 0，收到 ${n}`)
  if (!(k >= 0 && k <= n)) throw new Error(`wilsonCI：需要 0 ≤ k ≤ n，收到 k=${k}, n=${n}`)
  if (!(level > 0 && level < 1)) throw new Error(`wilsonCI：level 必須在 (0, 1)，收到 ${level}`)
  const z = normInv(0.5 + level / 2)
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half), center, level }
}

/**
 * 正規化自相關 ρ[k] = Σ_{n=0}^{N−1−k}(x_n − x̄)(x_{n+k} − x̄) / Σ(x_n − x̄)²，k = 0…maxLag
 * （biased estimator，與 statsmodels acf(adjusted=False) 相同；ρ[0] = 1）。
 * 常數序列（變異為 0）回傳全 NaN。
 */
export function autocorr(x: ArrayLike<number>, maxLag: number): number[] {
  const n = x.length
  const L = Math.max(0, Math.min(Math.floor(maxLag), n - 1))
  if (n === 0) return []
  const m = mean(x)
  const d = new Float64Array(n)
  for (let i = 0; i < n; i++) d[i] = x[i] - m
  let c0 = 0
  for (let i = 0; i < n; i++) c0 += d[i] * d[i]
  const out = new Array<number>(L + 1)
  if (c0 === 0) return out.fill(NaN)
  for (let k = 0; k <= L; k++) {
    let s = 0
    for (let i = 0; i + k < n; i++) s += d[i] * d[i + k]
    out[k] = s / c0
  }
  return out
}

/**
 * 有效樣本數（effective sample size）N_eff = N/τ，τ = 1 + 2Σρ_k（Geyer initial positive sequence 截斷）。
 * 用於自相關雜訊下的 Monte Carlo 信賴區間。
 */
export function effectiveSampleSize(x: ArrayLike<number>, maxLag?: number): number {
  const n = x.length
  if (n < 4) return n
  const L = maxLag ?? Math.min(n - 1, 1000)
  const rho = autocorr(x, L)
  if (Number.isNaN(rho[0])) return NaN
  // Geyer：Γ_m = ρ_{2m} + ρ_{2m+1}，在第一個 Γ_m ≤ 0 時停止
  let tau = -1
  for (let m = 0; 2 * m + 1 < rho.length; m++) {
    const g = rho[2 * m] + rho[2 * m + 1]
    if (g <= 0) break
    tau += 2 * g
  }
  tau = Math.max(tau, 1 / n)
  return Math.min(n / tau, n * Math.log10(n))
}

/** 樣本共變異數 cov(x, y)（ddof 預設 1） */
export function covariance(x: ArrayLike<number>, y: ArrayLike<number>, ddof = 1): number {
  const n = x.length
  if (y.length !== n) throw new Error(`covariance：長度不一致 ${n} vs ${y.length}`)
  if (n <= ddof) return NaN
  const mx = mean(x)
  const my = mean(y)
  let s = 0
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my)
  return s / (n - ddof)
}

/** Pearson 相關係數 */
export function correlation(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const sxy = covariance(x, y, 1)
  return sxy / Math.sqrt(variance(x, 1) * variance(y, 1))
}
