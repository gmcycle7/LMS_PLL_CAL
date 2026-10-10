/** 最小複數運算。所有 simulation 模組共用此型別。 */
export interface Complex {
  re: number
  im: number
}

export const c = (re: number, im = 0): Complex => ({ re, im })
export const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
export const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })
export const cMul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
export function cDiv(a: Complex, b: Complex): Complex {
  // Smith's algorithm：避免 |b| 很大或很小時 overflow/underflow
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re
    const d = b.re + b.im * r
    return { re: (a.re + a.im * r) / d, im: (a.im - a.re * r) / d }
  }
  const r = b.re / b.im
  const d = b.re * r + b.im
  return { re: (a.re * r + a.im) / d, im: (a.im * r - a.re) / d }
}
export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im)
export const cArg = (a: Complex): number => Math.atan2(a.im, a.re)
export const cConj = (a: Complex): Complex => ({ re: a.re, im: -a.im })
export const cScale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s })
export const cExpj = (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) })
export const cPolar = (r: number, theta: number): Complex => ({ re: r * Math.cos(theta), im: r * Math.sin(theta) })
export const cNeg = (a: Complex): Complex => ({ re: -a.re, im: -a.im })
export const cInv = (a: Complex): Complex => cDiv(c(1), a)

// ───── 以下為擴充 helper（不更動上方既有 export） ─────

/** |z|² */
export const cAbs2 = (a: Complex): number => a.re * a.re + a.im * a.im

/** 主值平方根 √z（branch cut 在負實軸；結果實部 ≥ 0），以穩定公式避免抵消 */
export function cSqrt(a: Complex): Complex {
  if (a.re === 0 && a.im === 0) return { re: 0, im: a.im }
  const r = Math.hypot(a.re, a.im)
  if (a.re >= 0) {
    const t = Math.sqrt(0.5 * (r + a.re))
    return { re: t, im: a.im / (2 * t) }
  }
  const t = Math.sqrt(0.5 * (r - a.re))
  return { re: Math.abs(a.im) / (2 * t), im: a.im >= 0 ? t : -t }
}

/** e^z */
export function cExp(a: Complex): Complex {
  const m = Math.exp(a.re)
  return { re: m * Math.cos(a.im), im: m * Math.sin(a.im) }
}

/** 主值對數 ln z = ln|z| + j·arg z（arg ∈ (−π, π]） */
export const cLog = (a: Complex): Complex => ({ re: Math.log(Math.hypot(a.re, a.im)), im: Math.atan2(a.im, a.re) })

/** 兩複數是否在 |a − b| ≤ atol + rtol·|b| 內相等 */
export const cIsClose = (a: Complex, b: Complex, rtol = 1e-12, atol = 0): boolean =>
  Math.hypot(a.re - b.re, a.im - b.im) <= atol + rtol * Math.hypot(b.re, b.im)

/** 文字表示，例如 '0.9 + j0.4796'、'0.9 - j0.4796'、'-0.618'（digits 為有效位數；負號一律用 ASCII '-'，與 fmt 一致） */
export function cToString(a: Complex, digits = 4): string {
  const f = (x: number): string => {
    if (x === 0) return '0'
    return String(Number(x.toPrecision(digits)))
  }
  if (a.im === 0) return f(a.re)
  const sign = a.im < 0 ? '-' : '+'
  if (a.re === 0) return `${a.im < 0 ? '-' : ''}j${f(Math.abs(a.im))}`
  return `${f(a.re)} ${sign} j${f(Math.abs(a.im))}`
}
