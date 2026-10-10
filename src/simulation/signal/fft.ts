/**
 * 離散傅立葉轉換（DFT）。
 *
 * 約定（與 NumPy `np.fft.fft` 相同）：
 *   X[k] = Σ_{n=0}^{N-1} x[n] · e^{-j2πnk/N}，        k = 0 … N-1（正轉換，不做縮放）
 *   x[n] = (1/N) Σ_{k=0}^{N-1} X[k] · e^{+j2πnk/N}    （反轉換，含 1/N）
 *
 * 實作：
 * - N 為 2 的冪：iterative radix-2 Cooley–Tukey（bit-reversal + butterfly）。
 * - 其他長度：Bluestein chirp-z，把 DFT 改寫成長度 M = nextPow2(2N-1) 的循環摺積再用 radix-2 計算。
 * - twiddle 與 chirp 直接用 cos/sin 計算（不用遞迴乘法），因此誤差約 O(ε log N)。
 * - 依長度快取 twiddle 表與 Bluestein chirp 頻譜（同一長度重複呼叫時，例如 Welch 的每個 segment，可重用）。
 */

/** 大於等於 n 的最小 2 的冪（n ≤ 1 時回傳 1）。 */
export function nextPow2(n: number): number {
  if (!(n > 1)) return 1
  let p = 1
  while (p < n) p *= 2
  return p
}

/** n 是否為 2 的冪（n ≥ 1）。 */
export function isPow2(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0
}

// ---------------------------------------------------------------------------
// 快取（以長度為 key；超過上限時清空，避免長時間執行時記憶體無限成長）
// ---------------------------------------------------------------------------

const CACHE_LIMIT = 32

interface Radix2Plan {
  cos: Float64Array // cos(2πk/N), k < N/2
  sin: Float64Array // sin(2πk/N), k < N/2
  rev: Uint32Array // bit-reversal permutation
}

interface BluesteinPlan {
  m: number // 摺積長度（2 的冪）
  wRe: Float64Array // chirp c[n] = e^{-jπ n²/N}
  wIm: Float64Array
  bRe: Float64Array // FFT{ conj(c) 的循環延伸 }，長度 m
  bIm: Float64Array
  aRe: Float64Array // 工作緩衝（重用以避免配置）
  aIm: Float64Array
}

const radix2Cache = new Map<number, Radix2Plan>()
const bluesteinCache = new Map<number, BluesteinPlan>()

function cacheSet<T>(cache: Map<number, T>, key: number, value: T): void {
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, value)
}

function getRadix2Plan(n: number): Radix2Plan {
  const cached = radix2Cache.get(n)
  if (cached) return cached
  const half = n >> 1
  const cos = new Float64Array(half)
  const sin = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    const t = (2 * Math.PI * k) / n
    cos[k] = Math.cos(t)
    sin[k] = Math.sin(t)
  }
  const rev = new Uint32Array(n)
  let bits = 0
  while (1 << bits < n) bits++
  for (let i = 0; i < n; i++) {
    let r = 0
    let v = i
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (v & 1)
      v >>= 1
    }
    rev[i] = r
  }
  const plan = { cos, sin, rev }
  cacheSet(radix2Cache, n, plan)
  return plan
}

/** 原地 radix-2 正轉換（n 必須為 2 的冪）。 */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n <= 1) return
  const { cos, sin, rev } = getRadix2Plan(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < halfSize; k++) {
        const wr = cos[k * step]
        const wi = -sin[k * step] // e^{-j2πk/size}
        const i1 = start + k
        const i2 = i1 + halfSize
        const tr = re[i2] * wr - im[i2] * wi
        const ti = re[i2] * wi + im[i2] * wr
        re[i2] = re[i1] - tr
        im[i2] = im[i1] - ti
        re[i1] += tr
        im[i1] += ti
      }
    }
  }
}

function getBluesteinPlan(n: number): BluesteinPlan {
  const cached = bluesteinCache.get(n)
  if (cached) return cached
  const m = nextPow2(2 * n - 1)
  const wRe = new Float64Array(n)
  const wIm = new Float64Array(n)
  const twoN = 2 * n
  for (let k = 0; k < n; k++) {
    // e^{-jπ k²/N}：k² 對 2N 取餘數以保持角度精確（k < 9e7 時 k² 為精確整數）
    const kk = (k * k) % twoN
    const t = (Math.PI * kk) / n
    wRe[k] = Math.cos(t)
    wIm[k] = -Math.sin(t)
  }
  const bRe = new Float64Array(m)
  const bIm = new Float64Array(m)
  bRe[0] = wRe[0]
  bIm[0] = -wIm[0]
  for (let k = 1; k < n; k++) {
    // conj(c[k])，並放到 m-k 形成循環延伸（c 為偶函數：c[-k] = c[k]）
    bRe[k] = bRe[m - k] = wRe[k]
    bIm[k] = bIm[m - k] = -wIm[k]
  }
  fftRadix2(bRe, bIm)
  const plan = { m, wRe, wIm, bRe, bIm, aRe: new Float64Array(m), aIm: new Float64Array(m) }
  cacheSet(bluesteinCache, n, plan)
  return plan
}

/** 原地 Bluestein 正轉換（任意長度 n）。 */
function fftBluestein(re: Float64Array, im: Float64Array): void {
  const n = re.length
  const { m, wRe, wIm, bRe, bIm, aRe, aIm } = getBluesteinPlan(n)
  aRe.fill(0)
  aIm.fill(0)
  for (let k = 0; k < n; k++) {
    // a[k] = x[k] · c[k]
    aRe[k] = re[k] * wRe[k] - im[k] * wIm[k]
    aIm[k] = re[k] * wIm[k] + im[k] * wRe[k]
  }
  fftRadix2(aRe, aIm)
  for (let k = 0; k < m; k++) {
    const r = aRe[k] * bRe[k] - aIm[k] * bIm[k]
    const i = aRe[k] * bIm[k] + aIm[k] * bRe[k]
    // 為了用正轉換做反轉換：IFFT(Y) = conj(FFT(conj(Y)))/m，先取共軛
    aRe[k] = r
    aIm[k] = -i
  }
  fftRadix2(aRe, aIm)
  const inv = 1 / m
  for (let k = 0; k < n; k++) {
    // conv[k] = conj(FFT(conj(Y)))[k] / m；X[k] = c[k] · conv[k]
    const cr = aRe[k] * inv
    const ci = -aIm[k] * inv
    re[k] = cr * wRe[k] - ci * wIm[k]
    im[k] = cr * wIm[k] + ci * wRe[k]
  }
}

/**
 * 原地正轉換 X[k] = Σ x[n] e^{-j2πnk/N}（無縮放），任意長度。
 * @param re 實部（輸入 x，輸出 X），長度 N
 * @param im 虛部，長度必須等於 re
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (im.length !== n) throw new Error(`fft：re 與 im 長度不同（${n} vs ${im.length}）`)
  if (n <= 1) return
  if (isPow2(n)) fftRadix2(re, im)
  else fftBluestein(re, im)
}

/**
 * 原地反轉換 x[n] = (1/N) Σ X[k] e^{+j2πnk/N}（含 1/N 縮放），任意長度。
 * 以 ifft(X) = conj(fft(conj(X)))/N 實作。
 */
export function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (im.length !== n) throw new Error(`ifft：re 與 im 長度不同（${n} vs ${im.length}）`)
  if (n === 0) return
  for (let k = 0; k < n; k++) im[k] = -im[k]
  fft(re, im)
  const inv = 1 / n
  for (let k = 0; k < n; k++) {
    re[k] *= inv
    im[k] = -im[k] * inv
  }
}

/**
 * 實數序列的 DFT（非原地）。回傳完整 N 點複數頻譜（含負頻率，fftfreq 順序）。
 * @param x 實數輸入
 * @param nfft 轉換長度；> x.length 時尾端補零，< x.length 時截斷（同 NumPy `n` 參數）
 */
export function fftReal(x: ArrayLike<number>, nfft = x.length): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  const L = Math.min(nfft, x.length)
  for (let i = 0; i < L; i++) re[i] = x[i]
  fft(re, im)
  return { re, im }
}

/**
 * DFT bin 頻率（同 `np.fft.fftfreq(n, 1/fs)`）：[0, 1, …, ⌈n/2⌉-1, -⌊n/2⌋, …, -1] · fs/n。
 * @param fs 取樣率 [Hz]；預設 1 → 單位 cycles/sample
 */
export function fftfreq(n: number, fs = 1): Float64Array {
  const f = new Float64Array(n)
  const half = Math.ceil(n / 2)
  for (let k = 0; k < n; k++) f[k] = ((k < half ? k : k - n) * fs) / n
  return f
}

/** 單邊 bin 頻率（同 `np.fft.rfftfreq(n, 1/fs)`）：k · fs/n，k = 0 … ⌊n/2⌋。 */
export function rfftfreq(n: number, fs = 1): Float64Array {
  const m = Math.floor(n / 2) + 1
  const f = new Float64Array(m)
  for (let k = 0; k < m; k++) f[k] = (k * fs) / n
  return f
}

/** 把 fftfreq 順序的陣列平移成由負到正（同 `np.fft.fftshift`），回傳新陣列。 */
export function fftshift(x: ArrayLike<number>): Float64Array {
  const n = x.length
  const out = new Float64Array(n)
  const shift = Math.floor(n / 2)
  for (let k = 0; k < n; k++) out[(k + shift) % n] = x[k]
  return out
}
