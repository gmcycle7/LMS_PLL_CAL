import { texNum as sharedTexNum } from '@/components/handcalcMath'
import { fmt } from '@/simulation/core'

/**
 * 數字 → TeX 字串（給 '$…$' 夾雜的說明文字與 TexBlock 用）。規則由共用的 `texNum`（components/handcalcMath.ts）決定，
 * 本頁只改兩件事：預設 4 位有效數字、NaN 寫 `\text{n/a}`（這一頁的 NaN 都是「此條件下沒有定義」，不是計算錯誤）。
 * 例：7.978845608e-3 → '7.979\times10^{-3}'、-325.81 → '-325.8'、∞ → '\infty'、NaN → '\text{n/a}'。
 */
export function texNum(x: number, digits = 4): string {
  if (Number.isNaN(x)) return String.raw`\text{n/a}`
  return sharedTexNum(x, digits)
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

/**
 * calNoise 的 REGIME_LABEL 是純文字（給下拉選單等不渲染 KaTeX 的地方）；顯示在會經 mathText／Rich 渲染的地方時，
 * 把其中的「−3 dB」（Unicode 負號）改成 `$-3\,\mathrm{dB}$`。
 */
export function regimeLabelTex(label: string): string {
  return label.replace(/−3 dB/g, String.raw`$-3\,\mathrm{dB}$`)
}
