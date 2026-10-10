import { fmt } from '@/simulation/core'

/**
 * 數字 → TeX 字串（給 '$…$' 夾雜的說明文字與 TexBlock 用）。
 * 例：7.978845608e-3 → '7.979\times10^{-3}'、-325.81 → '-325.8'、∞ → '\infty'、NaN → '\text{n/a}'。
 */
export function texNum(x: number, digits = 4): string {
  if (Number.isNaN(x)) return String.raw`\text{n/a}`
  const s = fmt(x, digits)
  if (s === '∞') return String.raw`\infty`
  if (s === '-∞') return String.raw`-\infty`
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(s)
  if (m) return `${m[1]}\\times10^{${m[2]}}`
  return s
}

/** 百分比（TeX）：0.0526 → '5.26\%' */
export function texPct(x: number, digits = 3): string {
  return `${texNum(100 * x, digits)}\\%`
}

/** 純文字數字（ExperimentShell 的警告、assumptions 等只吃字串的地方） */
export function plainNum(x: number, digits = 4): string {
  return fmt(x, digits)
}

/** Hz → 帶 SI 前綴的 TeX：12931 → '12.93\,\mathrm{kHz}' */
export function texHz(hz: number, digits = 4): string {
  if (!Number.isFinite(hz)) return String.raw`\text{n/a}`
  const a = Math.abs(hz)
  const [scale, unit] = a >= 1e9 ? [1e9, 'GHz'] : a >= 1e6 ? [1e6, 'MHz'] : a >= 1e3 ? [1e3, 'kHz'] : [1, 'Hz']
  return `${texNum(hz / scale, digits)}\\,\\mathrm{${unit}}`
}
