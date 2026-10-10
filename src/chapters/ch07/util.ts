/** Ch07 內部的小工具（格式化、符號 class）。純函式。 */

/** 固定小數位數；−0 顯示為 0；非有限數顯示 '—' */
export function fx(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return v === Infinity ? '∞' : v === -Infinity ? '−∞' : '—'
  const s = v.toFixed(digits)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace('-', '−')
}

/** 有效位數；非有限數顯示 '—' */
export function fp(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return v.toExponential(sig - 1).replace('-', '−')
  return Number(v.toPrecision(sig)).toString().replace('-', '−')
}

/** TeX 內使用的數字（負號用 TeX 的 -） */
export function tx(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '\\text{—}'
  const s = v.toFixed(digits)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s
}

/** TeX 內使用的有效位數；|v| < 1e-3 或 ≥ 1e5 時寫成 a\times10^{b}（小數值不會被四捨五入成 0） */
export function txs(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return '\\text{—}'
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) {
    const [m, e] = v.toExponential(sig - 1).split('e')
    return `${m}\\times10^{${Number(e)}}`
  }
  return String(Number(v.toPrecision(sig)))
}

/** 依正負號回傳 CSS class（|v| ≤ tol 視為 0） */
export function signClass(v: number, tol = 1e-9): string {
  if (!Number.isFinite(v)) return ''
  return v > tol ? 'ch07-pos' : v < -tol ? 'ch07-neg' : 'ch07-zero'
}

export const DEG = 180 / Math.PI
export const RAD = Math.PI / 180

/** K_q = √(2/π)/σ_v [fs⁻¹] */
export function kq(sigmaV: number): number {
  return Math.sqrt(2 / Math.PI) / sigmaV
}
