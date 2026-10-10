/**
 * 特殊函數（Special Functions），雙精度等級。
 *
 * - erf / erfc / erfcx：W. J. Cody (1969, 1993) CALERF 有理逼近（rational Chebyshev approximations），
 *   相對誤差約為機器精度；erfc 在尾端（例如 erfc(10) ≈ 2.09e-45）仍保持相對精度。
 * - normCdf：Φ(z)，兩側尾端都以 erfcx × exp(−z²/2)（指數部分精確拆分）計算，避免 1 − Φ 的抵消。
 * - normInv：Acklam 有理逼近 + 一次 Halley 修正（相對誤差 < 1e-12）。
 * - lgamma：Lanczos (g = 7, n = 9)；betaIncReg：Lentz 連分式（Numerical Recipes 風格 + 對稱切換），
 *   前置因子以 Loader saddle-point 形式（bd0 + Stirling 修正項）計算，對大參數仍精確。
 * - binomPmf：Loader (2000) saddle-point 演算法（R dbinom 同款），n·p、n·q 以 double-double 表示，
 *   n = 1e6 時相對誤差仍 ~1e-15（R/SciPy 在相同條件約 1e-13～1e-12）。
 * - binomCdf / binomSf：從 pmf 起點以比值遞推往「遠離眾數」方向加總（每項為正，無抵消），
 *   每 32 步以 Loader 公式重新校正；n = 1e6、k 在平均附近時單次呼叫約 0.1 ms。
 * - studentTCdf / studentTInv：以 betaIncReg 計算 CDF，反函數以安全化 Newton 法求解。
 */

const SQRT1_2 = Math.SQRT1_2
const SQRT2PI = 2.5066282746310007 // √(2π)
const LN_SQRT_2PI = 0.9189385332046728 // ln √(2π)
const LN_2PI = 1.8378770664093456 // ln(2π)
const INV_SQRTPI = 0.5641895835477563 // 1/√π

// ───────────────────────────── erf / erfc / erfcx（Cody CALERF） ─────────────────────────────

const ERF_A = [3.1611237438705655, 113.86415415105016, 377.485237685302, 3209.3775891384694, 0.18577770618460315]
const ERF_B = [23.601290952344122, 244.02463793444417, 1282.6165260773723, 2844.236833439171]
const ERF_C = [
  0.5641884969886701, 8.883149794388377, 66.11919063714163, 298.6351381974001, 881.952221241769, 1712.0476126340707,
  2051.0783778260716, 1230.3393547979972, 2.1531153547440383e-8,
]
const ERF_D = [
  15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666903, 3290.7992357334597, 4362.619090143247,
  3439.3676741437216, 1230.3393548037495,
]
const ERF_P = [0.30532663496123236, 0.36034489994980445, 0.12578172611122926, 0.016083785148742275, 6.587491615298378e-4, 0.016315387137302097]
const ERF_Q = [2.568520192289822, 1.8729528499234673, 0.5279051029514285, 0.06051834131244132, 0.0023352049762686918]

const ERF_THRESH = 0.46875
const ERF_XSMALL = 1.11e-16
const ERF_XBIG = 27.3 // 超過此值 erfc(x) 下溢為 0（26.5 < x < 27.3 為 subnormal，精度遞減）
const ERFCX_XHUGE = 6.71e7
const ERFCX_XMAX = 2.53e307

/** exp(−y²) 的精確版：把 y 拆成 16 分之一的格點 + 餘數，避免 y² 的捨入誤差被指數放大。 */
function expNegSq(y: number): number {
  const ysq = Math.trunc(y * 16) / 16
  const del = (y - ysq) * (y + ysq)
  return Math.exp(-ysq * ysq) * Math.exp(-del)
}

/**
 * Cody CALERF 核心。jint = 0 → erf；1 → erfc；2 → erfcx = exp(x²)·erfc(x)。
 */
function calerf(x: number, jint: 0 | 1 | 2): number {
  const y = Math.abs(x)
  let result: number
  if (y <= ERF_THRESH) {
    const ysq = y > ERF_XSMALL ? y * y : 0
    let xnum = ERF_A[4] * ysq
    let xden = ysq
    for (let i = 0; i < 3; i++) {
      xnum = (xnum + ERF_A[i]) * ysq
      xden = (xden + ERF_B[i]) * ysq
    }
    result = (x * (xnum + ERF_A[3])) / (xden + ERF_B[3])
    if (jint !== 0) result = 1 - result
    if (jint === 2) result = Math.exp(ysq) * result
    return result
  }
  if (y <= 4) {
    let xnum = ERF_C[8] * y
    let xden = y
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + ERF_C[i]) * y
      xden = (xden + ERF_D[i]) * y
    }
    result = (xnum + ERF_C[7]) / (xden + ERF_D[7])
    if (jint !== 2) result *= expNegSq(y)
  } else {
    result = 0
    let done = false
    if (y >= ERF_XBIG) {
      if (jint !== 2 || y >= ERFCX_XMAX) {
        done = true
      } else if (y >= ERFCX_XHUGE) {
        result = INV_SQRTPI / y
        done = true
      }
    }
    if (!done) {
      const ysq = 1 / (y * y)
      let xnum = ERF_P[5] * ysq
      let xden = ysq
      for (let i = 0; i < 4; i++) {
        xnum = (xnum + ERF_P[i]) * ysq
        xden = (xden + ERF_Q[i]) * ysq
      }
      result = (ysq * (xnum + ERF_P[4])) / (xden + ERF_Q[4])
      result = (INV_SQRTPI - result) / y
      if (jint !== 2) result *= expNegSq(y)
    }
  }
  // 由 |x| 的結果修正為 x 的結果
  if (jint === 0) {
    result = 0.5 - result + 0.5
    if (x < 0) result = -result
  } else if (jint === 1) {
    if (x < 0) result = 2 - result
  } else if (x < 0) {
    if (x < -26.628) {
      result = Infinity // exp(x²) overflow
    } else {
      const ysq = Math.trunc(x * 16) / 16
      const del = (x - ysq) * (x + ysq)
      const e = Math.exp(ysq * ysq) * Math.exp(del)
      result = e + e - result
    }
  }
  return result
}

/** 誤差函數 erf(x) = (2/√π) ∫₀ˣ e^{−t²} dt */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN
  return calerf(x, 0)
}

/** 互補誤差函數 erfc(x) = 1 − erf(x)，在 x → +∞ 尾端保持相對精度 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN
  return calerf(x, 1)
}

/** 縮放互補誤差函數 erfcx(x) = exp(x²)·erfc(x) */
export function erfcx(x: number): number {
  if (Number.isNaN(x)) return NaN
  return calerf(x, 2)
}

// ───────────────────────────── Normal 分布 ─────────────────────────────

/** exp(−a²/2)，把 a 拆成 1/16 格點 + 餘數，使指數的引數幾乎精確（尾端相對誤差 ~1e-16） */
function expHalfNegSq(a: number): number {
  const aa = Math.trunc(a * 16) / 16
  const del = (a - aa) * (a + aa)
  return Math.exp(-0.5 * aa * aa) * Math.exp(-0.5 * del)
}

/** 標準常態 PDF φ(z) = exp(−z²/2)/√(2π) */
export function normPdf(z: number): number {
  return expHalfNegSq(Math.abs(z)) / SQRT2PI
}

/** 下尾機率 Q(|z|) = Φ(−|z|)，以 erfcx(|z|/√2) · exp(−z²/2) / 2 計算（不經過 1 − Φ） */
function lowerTail(absZ: number): number {
  const y = absZ * SQRT1_2
  if (y < ERF_THRESH) return 0.5 * erfc(y)
  return 0.5 * erfcx(y) * expHalfNegSq(absZ)
}

/**
 * 標準常態 CDF Φ(z)。兩側尾端都保持相對精度：Φ(−37) ≈ 5.7e-300 仍正確；
 * Φ(z) 對 z > 0 回傳 1 − Q(z)（其值接近 1 時以絕對誤差 1e-16 為限）。
 */
export function normCdf(z: number): number {
  if (Number.isNaN(z)) return NaN
  if (z === Infinity) return 1
  if (z === -Infinity) return 0
  const q = lowerTail(Math.abs(z))
  return z < 0 ? q : 1 - q
}

/** 常態 survival function 1 − Φ(z) = Φ(−z)，在上尾保持相對精度 */
export function normSf(z: number): number {
  return normCdf(-z)
}

const ACK_A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
const ACK_B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
const ACK_C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
const ACK_D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
const ACK_PLOW = 0.02425

/** Acklam 有理逼近，只處理 0 < p ≤ 0.5（相對誤差 ≈ 1.15e-9） */
function acklamLower(p: number): number {
  if (p < ACK_PLOW) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((ACK_C[0] * q + ACK_C[1]) * q + ACK_C[2]) * q + ACK_C[3]) * q + ACK_C[4]) * q + ACK_C[5]) /
      ((((ACK_D[0] * q + ACK_D[1]) * q + ACK_D[2]) * q + ACK_D[3]) * q + 1)
    )
  }
  const q = p - 0.5
  const r = q * q
  return (
      ((((((ACK_A[0] * r + ACK_A[1]) * r + ACK_A[2]) * r + ACK_A[3]) * r + ACK_A[4]) * r + ACK_A[5]) * q) /
    (((((ACK_B[0] * r + ACK_B[1]) * r + ACK_B[2]) * r + ACK_B[3]) * r + ACK_B[4]) * r + 1)
  )
}

/**
 * 標準常態分位數 Φ⁻¹(p)。p > 0.5 時改算 −Φ⁻¹(1 − p)（1 − p 在此區間是精確的），
 * 因此上下尾皆有相對精度。p = 0 → −∞，p = 1 → +∞，p ∉ [0, 1] → NaN。
 */
export function normInv(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return NaN
  if (p === 0) return -Infinity
  if (p === 1) return Infinity
  if (p === 0.5) return 0
  const upper = p > 0.5
  const q = upper ? 1 - p : p
  let x = acklamLower(q)
  // 一次 Halley 修正：u = (Φ(x) − q)/φ(x)
  const e = normCdf(x) - q
  const half = 0.5 * x * x
  let u: number
  if (half < 700) {
    u = e * SQRT2PI * Math.exp(half)
  } else {
    // 極端尾端（q < ~1e-304）：以對數形式避免 exp overflow
    u = (e / q) * Math.exp(Math.log(q) + half + LN_SQRT_2PI)
  }
  if (Number.isFinite(u)) x = x - u / (1 + 0.5 * x * u)
  return upper ? -x : x
}

// ───────────────────────────── Gamma 相關 ─────────────────────────────

const LANCZOS_G = 7
const LANCZOS_C = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905,
  -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
]

/**
 * ln|Γ(x)|（Lanczos g = 7, n = 9）。x ≤ 0 的整數為極點 → +∞；x < 0.5 用反射公式。
 * 相對誤差約 1e-15（在 x = 1, 2 附近 lgamma → 0，改看絕對誤差 ~1e-15）。
 */
export function lgamma(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x === Infinity) return Infinity
  if (x <= 0 && Number.isInteger(x)) return Infinity
  if (x === 1 || x === 2) return 0
  if (x < 0.5) {
    // 反射：Γ(x)Γ(1−x) = π / sin(πx)
    const s = Math.sin(Math.PI * x)
    return Math.log(Math.PI / Math.abs(s)) - lgamma(1 - x)
  }
  const xm1 = x - 1
  let a = LANCZOS_C[0]
  const t = xm1 + LANCZOS_G + 0.5
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_C[i] / (xm1 + i)
  return LN_SQRT_2PI + (xm1 + 0.5) * Math.log(t) - t + Math.log(a)
}

/** δ(n) 在整數 n = 1…14 的精確值（mpmath 40 位數計算後取最接近的 double） */
const STIRLERR_INT = [
  NaN, 0.08106146679532726, 0.0413406959554093, 0.02767792568499834, 0.020790672103765093, 0.016644691189821193,
  0.013876128823070748, 0.01189670994589177, 0.010411265261972096, 0.009255462182712733, 0.00833056343336287,
  0.007573675487951841, 0.00694284010720953, 0.006408994188004207, 0.0059513701127588475,
]

/**
 * Stirling 修正項 δ(z) = lnΓ(z) − [(z − ½) ln z − z + ½ ln(2π)]（z > 0），亦即 Loader 的 stirlerr(z)。
 * z ≥ 15 用漸近級數（截斷誤差 < 4e-18）；1…14 的整數查表；其他以遞推
 * δ(z) = δ(z+1) + (z + ½) ln(1 + 1/z) − 1 往上推到 15（絕對誤差 ~1e-15）。
 */
function lgammaCorrection(z: number): number {
  if (z >= 15) {
    const zi = 1 / z
    const z2 = zi * zi
    return zi * (1 / 12 - z2 * (1 / 360 - z2 * (1 / 1260 - z2 * (1 / 1680 - z2 * (1 / 1188 - (z2 * 691) / 360360)))))
  }
  if (Number.isInteger(z) && z >= 1) return STIRLERR_INT[z]
  let acc = 0
  let w = z
  while (w < 15) {
    acc += (w + 0.5) * Math.log1p(1 / w) - 1
    w += 1
  }
  return acc + lgammaCorrection(w)
}

/** Veltkamp 分割常數 2^27 + 1 */
const SPLITTER = 134217729

/** Dekker TwoProduct：a·b = hi + lo（lo 為精確的捨入誤差；|a·b| < 2^996 時成立） */
function twoProd(a: number, b: number): [number, number] {
  const hi = a * b
  let t = SPLITTER * a
  const ah = t - (t - a)
  const al = a - ah
  t = SPLITTER * b
  const bh = t - (t - b)
  const bl = b - bh
  return [hi, ah * bh - hi + ah * bl + al * bh + al * bl]
}

/**
 * Loader 的 bd0(x, m) = x ln(x/m) + m − x ≥ 0，其中 m = mHi + mLo（double-double，保留 n·p 的捨入誤差）。
 * x ≈ m 時以級數 Σ 2x v^{2j+1}/(2j+1)、v = (x−m)/(x+m) 計算，避免抵消。
 */
function bd0(x: number, mHi: number, mLo = 0): number {
  const d = x - mHi - mLo // x − mHi 在 x ≈ mHi 時精確（Sterbenz）
  if (Math.abs(d) < 0.1 * (x + mHi)) {
    let v = d / (x + mHi + mLo)
    let s = d * v
    if (Math.abs(s) < Number.MIN_VALUE) return s
    let ej = 2 * x * v
    v = v * v
    for (let j = 1; j < 1000; j++) {
      ej *= v
      const s1 = s + ej / (2 * j + 1)
      if (s1 === s) return s1
      s = s1
    }
    return s
  }
  const m = mHi + mLo
  return x * Math.log(x / m) + m - x
}

/**
 * 二項分布 pmf 的核心（Loader 2000 saddle-point）：
 * ln pmf = δ(n) − δ(x) − δ(n−x) − bd0(x, np) − bd0(n−x, nq) − ½ ln(2π x (n−x)/n)。
 * q = 1 − p 與 n·p、n·q 都以 double-double 表示，因此 n = 1e6 時仍有 ~1e-15 相對精度。
 */
function dbinomRaw(x: number, n: number, p: number): number {
  if (x < 0 || x > n) return 0
  if (p === 0) return x === 0 ? 1 : 0
  if (p === 1) return x === n ? 1 : 0
  if (x === 0) return Math.exp(n * Math.log1p(-p))
  if (x === n) return Math.exp(n * Math.log(p))
  // q = qHi + qLo 精確：p ≤ ½ 時 1 − qHi 與 (1 − qHi) − p 皆為精確運算（Sterbenz）
  const qHi = 1 - p
  const qLo = p <= 0.5 ? 1 - qHi - p : 0
  const [npHi, npLo] = twoProd(n, p)
  const [nqHi, nqLo0] = twoProd(n, qHi)
  const nqLo = nqLo0 + n * qLo
  const lc =
    lgammaCorrection(n) -
    lgammaCorrection(x) -
    lgammaCorrection(n - x) -
    bd0(x, npHi, npLo) -
    bd0(n - x, nqHi, nqLo)
  // ln(2π x (n−x)/n)；用 (n − x)/n（整數相減精確）而非 log1p(−x/n)，避免 x/n → 1 時的抵消
  const lf = LN_2PI + Math.log(x) + Math.log((n - x) / n)
  return Math.exp(lc - 0.5 * lf)
}

function checkBinomArgs(n: number, p: number, fn: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${fn}：n 必須是非負整數，收到 ${n}`)
  if (!(p >= 0 && p <= 1)) throw new Error(`${fn}：p 必須在 [0, 1]，收到 ${p}`)
}

/** 二項分布機率質量 P(X = k)，X ~ Bin(n, p)。k 非整數時回傳 0。 */
export function binomPmf(k: number, n: number, p: number): number {
  checkBinomArgs(n, p, 'binomPmf')
  if (!Number.isInteger(k) || k < 0 || k > n) return 0
  return dbinomRaw(k, n, p)
}

/**
 * 從 pmf(start) 沿 dir（−1 往下、+1 往上）以比值遞推加總，直到項次可忽略（< 1e-20 × 總和）。
 * 每 32 步以 Loader 公式重新計算一次 pmf，避免比值 p/q 的捨入誤差系統性累積。
 */
function binomTailSum(start: number, n: number, p: number, dir: 1 | -1): number {
  const q = 1 - p
  let term = dbinomRaw(start, n, p)
  // 起點已下溢：起點必在遠離眾數的一側，整段尾巴更小 → 0
  if (term === 0) return 0
  // Neumaier 補償加總（所有項皆為正）
  let sum = term
  let comp = 0
  const add = (v: number): void => {
    const t = sum + v
    comp += sum >= v ? sum - t + v : v - t + sum
    sum = t
  }
  const pq = p / q
  if (dir === -1) {
    // pmf(j−1) = pmf(j) · j q / ((n − j + 1) p)；j ≤ start ≤ np 時比值 < 1，項次單調遞減
    for (let j = start; j > 0; j--) {
      term = (start - j + 1) % 32 === 0 ? dbinomRaw(j - 1, n, p) : (term * (j / (n - j + 1))) / pq
      add(term)
      if (term <= sum * 1e-20) break
    }
  } else {
    // pmf(j+1) = pmf(j) · (n − j) p / ((j + 1) q)；j ≥ start ≥ np 時比值 < 1
    for (let j = start; j < n; j++) {
      term = (j - start + 1) % 32 === 0 ? dbinomRaw(j + 1, n, p) : term * ((n - j) / (j + 1)) * pq
      add(term)
      if (term <= sum * 1e-20) break
    }
  }
  return sum + comp
}

/**
 * 二項分布 CDF P(X ≤ k)。k ≤ 平均值時直接加總下尾；否則以 1 − P(X > k) 計算（此時結果 ≥ ~0.5，無相對精度問題）。
 * 每次呼叫最多 O(σ·10) 次乘法（σ = √(npq)），n = 1e6 也只需數千步。
 */
export function binomCdf(k: number, n: number, p: number): number {
  checkBinomArgs(n, p, 'binomCdf')
  if (Number.isNaN(k)) return NaN
  const kk = Math.floor(k)
  if (kk < 0) return 0
  if (kk >= n) return 1
  if (p === 0) return 1
  if (p === 1) return 0
  if (kk <= n * p) return Math.min(1, binomTailSum(kk, n, p, -1))
  return Math.max(0, 1 - binomTailSum(kk + 1, n, p, 1))
}

/** 二項分布 survival function P(X > k)，上尾保持相對精度 */
export function binomSf(k: number, n: number, p: number): number {
  checkBinomArgs(n, p, 'binomSf')
  if (Number.isNaN(k)) return NaN
  const kk = Math.floor(k)
  if (kk < 0) return 1
  if (kk >= n) return 0
  if (p === 0) return 0
  if (p === 1) return 1
  if (kk + 1 >= n * p) return Math.min(1, binomTailSum(kk + 1, n, p, 1))
  return Math.max(0, 1 - binomTailSum(kk, n, p, -1))
}

// ───────────────────────────── Incomplete Beta ─────────────────────────────

/**
 * ln[ x^a y^b / B(a, b) ]（y = 1 − x）。以 Loader saddle-point 形式計算：
 * ln = −bd0(a, x s) − bd0(b, y s) + ½ ln(ab/s) − ln√(2π) + δ(s) − δ(a) − δ(b)，s = a + b。
 * 兩個 bd0 皆 ≥ 0 不會互相抵消，因此 a、b 很大（例如 1e6）時仍有相對精度。
 */
function logBetaPowerTerm(a: number, b: number, x: number, y: number): number {
  const s = a + b
  const [xsHi, xsLo] = twoProd(x, s)
  const [ysHi, ysLo] = twoProd(y, s)
  return (
    -bd0(a, xsHi, xsLo) -
    bd0(b, ysHi, ysLo) +
    0.5 * Math.log((a / s) * b) -
    LN_SQRT_2PI +
    lgammaCorrection(s) -
    lgammaCorrection(a) -
    lgammaCorrection(b)
  )
}

/** NR betacf：I_x(a,b) 的連分式（modified Lentz） */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const FPMIN = 1e-300
  const maxIter = 1000 + Math.ceil(20 * Math.sqrt(Math.max(a, b)))
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) <= 1e-16) return h
  }
  return h // 未完全收斂：回傳目前最佳估計（實務上 maxIter 足夠）
}

/**
 * 正規化不完全 Beta 函數 I_x(a, b)，並可另外提供 y = 1 − x 以保留精度。
 * 回傳 [I_x(a,b), 1 − I_x(a,b)]，兩者皆有相對精度。
 */
export function betaIncRegPair(a: number, b: number, x: number, y = 1 - x): [number, number] {
  if (!(a > 0) || !(b > 0)) throw new Error(`betaIncReg：需要 a > 0、b > 0，收到 a=${a}, b=${b}`)
  if (Number.isNaN(x) || x < 0 || x > 1) return [NaN, NaN]
  if (x === 0) return [0, 1]
  if (y === 0 || x === 1) return [1, 0]
  const front = Math.exp(logBetaPowerTerm(a, b, x, y))
  if (x < (a + 1) / (a + b + 2)) {
    const v = (front * betaContinuedFraction(a, b, x)) / a
    return [v, 1 - v]
  }
  const w = (front * betaContinuedFraction(b, a, y)) / b
  return [1 - w, w]
}

/** 正規化不完全 Beta 函數 I_x(a, b) = B(x; a, b)/B(a, b) */
export function betaIncReg(a: number, b: number, x: number): number {
  return betaIncRegPair(a, b, x)[0]
}

// ───────────────────────────── Student-t ─────────────────────────────

/** Student-t 機率密度（自由度 ν > 0，可為非整數） */
export function studentTPdf(t: number, nu: number): number {
  if (!(nu > 0)) return NaN
  if (nu === Infinity) return normPdf(t)
  const lc = lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI)
  return Math.exp(lc - ((nu + 1) / 2) * Math.log1p((t * t) / nu))
}

/** Student-t CDF：P(T ≤ t) = 1 − ½ I_{ν/(ν+t²)}(ν/2, ½)（t > 0） */
export function studentTCdf(t: number, nu: number): number {
  if (!(nu > 0) || Number.isNaN(t)) return NaN
  if (nu === Infinity) return normCdf(t)
  if (t === Infinity) return 1
  if (t === -Infinity) return 0
  if (t === 0) return 0.5
  const t2 = t * t
  // x = ν/(ν+t²)、y = t²/(ν+t²)，分別計算以保留精度
  const x = nu / (nu + t2)
  const y = t2 / (nu + t2)
  const [ix] = betaIncRegPair(nu / 2, 0.5, x, y)
  const tail = 0.5 * ix
  return t > 0 ? 1 - tail : tail
}

/**
 * Student-t 分位數 t_ν⁻¹(p)。ν = 1、2 用封閉式；其他以 Cornish–Fisher 初值 + 有界 Newton 法，
 * 精度約 1e-12（相對；受 studentTCdf 精度限制）。
 */
export function studentTInv(p: number, nu: number): number {
  if (!(nu > 0) || Number.isNaN(p) || p < 0 || p > 1) return NaN
  if (p === 0) return -Infinity
  if (p === 1) return Infinity
  if (p === 0.5) return 0
  if (nu === Infinity) return normInv(p)
  // 只解下尾 (q < 0.5)，上尾用對稱性；1 − p 在 p > 0.5 時精確
  const upper = p > 0.5
  const q = upper ? 1 - p : p
  if (nu === 1) {
    // Cauchy：tan(π(q − ½)) = −cot(πq)，避免 q − ½ 的抵消
    const t1 = -1 / Math.tan(Math.PI * q)
    return upper ? -t1 : t1
  }
  if (nu === 2) {
    const t2 = (2 * q - 1) * Math.sqrt(2 / (4 * q * (1 - q)))
    return upper ? -t2 : t2
  }
  const z = normInv(q)
  const z2 = z * z
  // Cornish–Fisher 展開
  let t =
    z +
    (z * (z2 + 1)) / (4 * nu) +
    (z * ((5 * z2 + 16) * z2 + 3)) / (96 * nu * nu) +
    (z * (((3 * z2 + 19) * z2 + 17) * z2 - 15)) / (384 * nu * nu * nu)
  if (!(t < 0) || !Number.isFinite(t)) t = z
  // 建立括區 [lo, hi]（皆為負值）
  let lo = Math.min(t, z) * 2
  let hi = 0
  let it = 0
  while (studentTCdf(lo, nu) > q && it < 200) {
    hi = lo
    lo *= 2
    it++
  }
  for (let i = 0; i < 200; i++) {
    if (!(t > lo && t < hi)) t = 0.5 * (lo + hi)
    const f = studentTCdf(t, nu) - q
    if (f === 0) break
    if (f > 0) hi = t
    else lo = t
    const d = studentTPdf(t, nu)
    let tn = d > 0 ? t - f / d : 0.5 * (lo + hi)
    if (!(tn > lo && tn < hi)) tn = 0.5 * (lo + hi)
    if (Math.abs(tn - t) <= 1e-14 * Math.abs(tn) || hi - lo <= 1e-15 * Math.abs(lo)) {
      t = tn
      break
    }
    t = tn
  }
  return upper ? -t : t
}
