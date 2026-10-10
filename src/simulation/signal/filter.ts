/**
 * 線性非時變（LTI）濾波器工具。
 *
 * 係數約定（與 SciPy 相同）：
 * - **離散時間**（lfilter / StreamFilter / freqz / impulseResponse）：b、a 為 z⁻¹ 的升冪係數，
 *     H(z) = B(z)/A(z) = (b[0] + b[1] z⁻¹ + … + b[M] z⁻ᴹ) / (a[0] + a[1] z⁻¹ + … + a[N] z⁻ᴺ)，
 *   差分方程 a[0] y[n] = Σ b[k] x[n−k] − Σ_{k≥1} a[k] y[n−k]。
 *   注意這與 `core/poly.ts`（降冪多項式）的約定不同。
 * - **連續時間**（freqs / bilinear 的輸入）：b、a 為 s 的降冪係數，H(s) = (b[0] sᴹ + … + b[M]) / (a[0] sᴺ + … + a[N])。
 * - bilinear 的輸出為離散時間係數（z⁻¹ 升冪，等同 z 降冪），a[0] = 1。
 */

import { c, cAdd, cDiv, cMul, type Complex } from '@/simulation/core/complex'

interface Normalized {
  b: Float64Array
  a: Float64Array
  /** 狀態長度 = max(len(a), len(b)) − 1 */
  order: number
}

/** 補齊長度並以 a[0] 正規化。 */
function normalizeBA(b: ArrayLike<number>, a: ArrayLike<number>): Normalized {
  if (a.length === 0 || b.length === 0) throw new Error('濾波器係數 b、a 不可為空')
  const a0 = a[0]
  if (a0 === 0 || !Number.isFinite(a0)) throw new Error(`a[0] 必須為非零有限數，收到 ${a0}`)
  const n = Math.max(a.length, b.length)
  const bn = new Float64Array(n)
  const an = new Float64Array(n)
  for (let i = 0; i < b.length; i++) bn[i] = b[i] / a0
  for (let i = 0; i < a.length; i++) an[i] = a[i] / a0
  return { b: bn, a: an, order: n - 1 }
}

/**
 * IIR/FIR 濾波，Direct-Form II Transposed（同 `scipy.signal.lfilter(b, a, x, zi=zi)`）：
 *   y[n]      = b[0] x[n] + z₀[n−1]
 *   z_i[n]    = b[i+1] x[n] + z_{i+1}[n−1] − a[i+1] y[n]，i = 0 … K−2
 *   z_{K−1}[n] = b[K] x[n] − a[K] y[n]
 * （係數已除以 a[0]；K = max(len(a), len(b)) − 1）
 * @param zi 初始狀態，長度 K；省略時為 0（initial rest）。與 SciPy 的 zi 定義相同。
 * @returns y（與 x 同長）與最終狀態 zf（可作為下一段的 zi，達成分段連續濾波）
 */
export function lfilter(
  b: ArrayLike<number>,
  a: ArrayLike<number>,
  x: ArrayLike<number>,
  zi?: ArrayLike<number>,
): { y: Float64Array; zf: Float64Array } {
  const { b: bn, a: an, order: K } = normalizeBA(b, a)
  const z = new Float64Array(K)
  if (zi) {
    if (zi.length !== K) throw new Error(`zi 長度必須為 ${K}，收到 ${zi.length}`)
    for (let i = 0; i < K; i++) z[i] = zi[i]
  }
  const N = x.length
  const y = new Float64Array(N)
  if (K === 0) {
    for (let n = 0; n < N; n++) y[n] = bn[0] * x[n]
    return { y, zf: z }
  }
  for (let n = 0; n < N; n++) {
    const xn = x[n]
    const yn = bn[0] * xn + z[0]
    for (let i = 0; i < K - 1; i++) z[i] = bn[i + 1] * xn + z[i + 1] - an[i + 1] * yn
    z[K - 1] = bn[K] * xn - an[K] * yn
    y[n] = yn
  }
  return { y, zf: z }
}

/**
 * 單位步階穩態初始狀態（同 `scipy.signal.lfilter_zi(b, a)`）：輸入恆為 1 時輸出恆為 H(1) = Σb/Σa 的 DF-II-T 狀態。
 * 用 `lfilter(b, a, x, lfilterZi(b, a).map(v => v * x[0]))` 可避免起始暫態。
 * A(1) = Σa = 0（z = 1 有極點，無穩態）時丟出錯誤。
 */
export function lfilterZi(b: ArrayLike<number>, a: ArrayLike<number>): Float64Array {
  const { b: bn, a: an, order: K } = normalizeBA(b, a)
  let sb = 0
  let sa = 0
  for (let i = 0; i <= K; i++) {
    sb += bn[i]
    sa += an[i]
  }
  if (sa === 0) throw new Error('lfilterZi：A(1) = 0（z = 1 有極點），不存在步階穩態')
  const yss = sb / sa
  const z = new Float64Array(K)
  // 穩態：z_{K−1} = b[K] − a[K] y；z_i = b[i+1] − a[i+1] y + z_{i+1}
  let acc = 0
  for (let i = K - 1; i >= 0; i--) {
    acc += bn[i + 1] - an[i + 1] * yss
    z[i] = acc
  }
  return z
}

/**
 * 逐點串流濾波器（DF-II-T），狀態在呼叫之間保留；適合迴路模擬中每個 sample 呼叫一次。
 * 與 `lfilter` 對同一序列給出完全相同的輸出。
 */
export class StreamFilter {
  private readonly bn: Float64Array
  private readonly an: Float64Array
  private readonly z: Float64Array
  /** 狀態長度 K = max(len(a), len(b)) − 1 */
  readonly order: number

  constructor(b: ArrayLike<number>, a: ArrayLike<number> = [1], zi?: ArrayLike<number>) {
    const { b: bn, a: an, order } = normalizeBA(b, a)
    this.bn = bn
    this.an = an
    this.order = order
    this.z = new Float64Array(order)
    if (zi) this.setState(zi)
  }

  /** 輸入一個 sample，回傳一個輸出 sample。 */
  step(x: number): number {
    const K = this.order
    const { bn, an, z } = this
    const y = bn[0] * x + (K > 0 ? z[0] : 0)
    for (let i = 0; i < K - 1; i++) z[i] = bn[i + 1] * x + z[i + 1] - an[i + 1] * y
    if (K > 0) z[K - 1] = bn[K] * x - an[K] * y
    return y
  }

  /** 連續處理一段輸入（狀態延續）。 */
  process(x: ArrayLike<number>): Float64Array {
    const y = new Float64Array(x.length)
    for (let n = 0; n < x.length; n++) y[n] = this.step(x[n])
    return y
  }

  /** 狀態歸零（initial rest）。 */
  reset(): void {
    this.z.fill(0)
  }

  /** 目前狀態的複本（與 lfilter 的 zf 定義相同，可存檔／還原）。 */
  getState(): Float64Array {
    return Float64Array.from(this.z)
  }

  /** 設定狀態（長度必須為 order）。 */
  setState(z: ArrayLike<number>): void {
    if (z.length !== this.order) throw new Error(`狀態長度必須為 ${this.order}，收到 ${z.length}`)
    for (let i = 0; i < this.order; i++) this.z[i] = z[i]
  }
}

/** 以 Horner 法計算 Σ_k p[k] u^k（p 為 u 的升冪係數）。 */
function hornerAscending(p: ArrayLike<number>, u: Complex): Complex {
  let acc = c(0)
  for (let k = p.length - 1; k >= 0; k--) acc = cAdd(cMul(acc, u), c(p[k]))
  return acc
}

/** 以 Horner 法計算 Σ_k p[k] s^{M−k}（p 為 s 的降冪係數）。 */
function hornerDescending(p: ArrayLike<number>, s: Complex): Complex {
  let acc = c(0)
  for (let k = 0; k < p.length; k++) acc = cAdd(cMul(acc, s), c(p[k]))
  return acc
}

/**
 * 離散時間頻率響應 H(e^{jΩ}) = B(e^{−jΩ}) / A(e^{−jΩ})，其中 B(u) = Σ b[k] u^k。
 * （同 `scipy.signal.freqz(b, a, worN=omegas)`，fs 預設 2π）
 * @param omegas 數位角頻率 Ω [rad/sample]；Ω = 2π f / fs，Nyquist 為 π
 */
export function freqz(b: ArrayLike<number>, a: ArrayLike<number>, omegas: ArrayLike<number>): Complex[] {
  const out: Complex[] = new Array<Complex>(omegas.length)
  for (let i = 0; i < omegas.length; i++) {
    const u = c(Math.cos(omegas[i]), -Math.sin(omegas[i])) // e^{−jΩ}
    out[i] = cDiv(hornerAscending(b, u), hornerAscending(a, u))
  }
  return out
}

/**
 * 以 Hz 指定頻率的 freqz：Ω = 2π f / fs。
 * @param fHz 頻率 [Hz]
 * @param fs 取樣率 [Hz]（b、a 所對應的取樣率；block-rate 濾波器請用 f_u）
 */
export function freqzHz(b: ArrayLike<number>, a: ArrayLike<number>, fHz: ArrayLike<number>, fs: number): Complex[] {
  const om = new Float64Array(fHz.length)
  for (let i = 0; i < fHz.length; i++) om[i] = (2 * Math.PI * fHz[i]) / fs
  return freqz(b, a, om)
}

/**
 * 連續時間頻率響應 H(jω) = B(jω) / A(jω)，b、a 為 s 的降冪係數（同 `scipy.signal.freqs(b, a, worN=w)`）。
 * @param w 角頻率 ω [rad/s]（= 2π f）
 */
export function freqs(b: ArrayLike<number>, a: ArrayLike<number>, w: ArrayLike<number>): Complex[] {
  const out: Complex[] = new Array<Complex>(w.length)
  for (let i = 0; i < w.length; i++) {
    const s = c(0, w[i])
    out[i] = cDiv(hornerDescending(b, s), hornerDescending(a, s))
  }
  return out
}

/** 升冪多項式相乘。 */
function polyMulAsc(p: number[], q: number[]): number[] {
  const out = new Array<number>(p.length + q.length - 1).fill(0)
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) out[i + j] += p[i] * q[j]
  return out
}

function polyPowAsc(p: number[], n: number): number[] {
  let out = [1]
  for (let i = 0; i < n; i++) out = polyMulAsc(out, p)
  return out
}

function trimLeadingZeros(p: ArrayLike<number>): number[] {
  let i = 0
  while (i < p.length - 1 && p[i] === 0) i++
  return Array.prototype.slice.call(p, i) as number[]
}

/**
 * 雙線性轉換（Tustin）：s = K·(1 − z⁻¹)/(1 + z⁻¹)。
 * - 未給 prewarpHz：K = 2·fs（同 `scipy.signal.bilinear(b, a, fs)`）。
 * - 給 prewarpHz = f_p：K = 2π f_p / tan(π f_p / fs)，使數位響應在 f_p 處與類比響應完全相等
 *   （等同 `scipy.signal.bilinear(b, a, fs=K/2)`）；需 0 < f_p < fs/2。
 * @param b 類比分子，s 的降冪係數
 * @param a 類比分母，s 的降冪係數
 * @param fs 取樣率 [Hz]
 * @returns 數位 { b, a }（z⁻¹ 升冪，a[0] = 1，長度皆為 max(len(a), len(b))）
 *
 * 與 SciPy 的差異：SciPy 的 normalize 會把 |b_d[0]| ≤ 1e-14 的前導分子係數刪除（並警告），
 * 這在 z⁻¹ 表示下等於把濾波器提前一個 sample；本實作保留完整長度（數學上正確）。
 * 只有類比分子恰在 s = K 有零點時才會出現此差異。
 */
export function bilinear(
  b: ArrayLike<number>,
  a: ArrayLike<number>,
  fs: number,
  prewarpHz?: number,
): { b: number[]; a: number[] } {
  if (!(fs > 0) || !Number.isFinite(fs)) throw new Error(`fs 必須為正有限數，收到 ${fs}`)
  let K = 2 * fs
  if (prewarpHz !== undefined) {
    if (!(prewarpHz > 0 && prewarpHz < fs / 2)) throw new Error(`prewarpHz 必須在 (0, fs/2) 內，收到 ${prewarpHz}`)
    K = (2 * Math.PI * prewarpHz) / Math.tan((Math.PI * prewarpHz) / fs)
  }
  const bt = trimLeadingZeros(b)
  const at = trimLeadingZeros(a)
  if (at.every((v) => v === 0)) throw new Error('bilinear：分母全為 0')
  const N = Math.max(bt.length, at.length) - 1
  // 與 SciPy 相同，把 K 拆成 √K 分給 (z+1) 與 (z−1) 以降低高階時 overflow 的機會：
  // s^q (z+1)^N → K^q (z−1)^q (z+1)^{N−q} ∝ [(z−1)√K]^q [(z+1)/√K]^{N−q}
  const fac = Math.sqrt(K)
  const zp1 = [1 / fac, 1 / fac] // (z + 1)/√K，z 的升冪
  const zm1 = [-fac, fac] // (z − 1)·√K
  const mapPoly = (p: number[]): number[] => {
    const out = new Array<number>(N + 1).fill(0)
    const M = p.length - 1
    for (let q = 0; q <= M; q++) {
      const coef = p[M - q] // s^q 的係數
      if (coef === 0) continue
      const term = polyMulAsc(polyPowAsc(zp1, N - q), polyPowAsc(zm1, q))
      for (let i = 0; i <= N; i++) out[i] += coef * term[i]
    }
    // z 升冪 → z 降冪（= z⁻¹ 升冪）
    return out.reverse()
  }
  const num = mapPoly(bt)
  const den = mapPoly(at)
  const d0 = den[0]
  if (d0 === 0) throw new Error('bilinear：轉換後 a[0] = 0（類比分母在 s = K 有根），無法正規化')
  return { b: num.map((v) => v / d0), a: den.map((v) => v / d0) }
}

/**
 * 脈衝響應 h[n]，n = 0 … len−1（initial rest，x = δ[n]）。
 */
export function impulseResponse(b: ArrayLike<number>, a: ArrayLike<number>, len: number): Float64Array {
  const x = new Float64Array(len)
  if (len > 0) x[0] = 1
  return lfilter(b, a, x).y
}
