/**
 * 數值格式化與單位換算。
 *
 * 單位約定（dev-conventions §5）：時間誤差預設 fs；相位用 rad；兩者換算必須明寫 2π f_out，
 * 請用 fsToRad / radToFs，不要在各處手寫 1e-15。
 */

const MAX_DIGITS = 17

function clampDigits(d: number): number {
  if (!Number.isFinite(d)) return 4
  return Math.min(MAX_DIGITS, Math.max(1, Math.round(d)))
}

/** 指數記號：去掉尾端零與 '+'，例如 1.2e6、-3.5e-7 */
function expString(x: number, digits: number): string {
  const s = x.toExponential(digits - 1)
  const [mant, exp] = s.split('e')
  const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant
  const e = exp.startsWith('+') ? exp.slice(1) : exp
  return `${m}e${e}`
}

/**
 * 以 digits 位有效數字格式化（去除尾端零）。
 * |x| ≥ 1e6 或 |x| < 1e-4 時改用指數記號（例如 1.235e6、7.979e-5）。
 * NaN → 'NaN'，±∞ → '∞' / '-∞'，±0 → '0'。
 */
export function fmt(x: number, digits = 4): string {
  if (Number.isNaN(x)) return 'NaN'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '-∞'
  if (x === 0) return '0'
  const d = clampDigits(digits)
  const rounded = Number(x.toPrecision(d))
  const ar = Math.abs(rounded)
  if (ar >= 1e6 || ar < 1e-4) return expString(x, d)
  return String(rounded)
}

const SI_PREFIXES: ReadonlyArray<readonly [number, string]> = [
  [-15, 'f'],
  [-12, 'p'],
  [-9, 'n'],
  [-6, 'µ'],
  [-3, 'm'],
  [0, ''],
  [3, 'k'],
  [6, 'M'],
  [9, 'G'],
  [12, 'T'],
]

/** 會自動加 SI 前綴的單位；其他單位（fs、dB、dBc、dBc/Hz、°、%、LSB、ppm…）一律原樣顯示 */
const SI_UNITS = new Set(['s', 'Hz', 'rad', 'rad/s', 'V', 'A', 'W', 'F', 'H', 'Ω', 'J', 'S', 'C'])

/** 某單位是否會被 fmtSI 加上 SI 前綴 */
export function isSiPrefixable(unit: string): boolean {
  return SI_UNITS.has(unit)
}

/**
 * 帶單位的格式化。unit 屬於 s、Hz、rad、V、A、W、F… 時自動選 SI 前綴（f p n µ m k M G T），
 * 例如 fmtSI(976562.5, 'Hz') = '976.6 kHz'、fmtSI(1.5e-12, 's') = '1.5 ps'；
 * fs、dB、dBc 等已含尺度的單位不加前綴：fmtSI(0.399, 'fs') = '0.399 fs'。
 */
export function fmtSI(x: number, unit: string, digits = 4): string {
  const d = clampDigits(digits)
  const suffix = (prefix: string): string => ((prefix + unit).length > 0 ? ` ${prefix}${unit}` : '')
  if (!SI_UNITS.has(unit) || !Number.isFinite(x) || x === 0) return fmt(x, d) + suffix('')
  const ax = Math.abs(x)
  let idx = SI_PREFIXES.findIndex(([e]) => e === Math.floor(Math.log10(ax) / 3) * 3)
  if (idx < 0) idx = Math.log10(ax) < 0 ? 0 : SI_PREFIXES.length - 1
  let scaled = x / Math.pow(10, SI_PREFIXES[idx][0])
  // 進位後若達 1000（例如 999.96 → 1000），改用下一個前綴
  if (Math.abs(Number(scaled.toPrecision(d))) >= 1000 && idx < SI_PREFIXES.length - 1) {
    idx++
    scaled = x / Math.pow(10, SI_PREFIXES[idx][0])
  }
  return fmt(scaled, d) + suffix(SI_PREFIXES[idx][1])
}

/** 功率比轉 dB：10 log10(x)（x = 0 → −∞；x < 0 → NaN） */
export function db10(x: number): number {
  return 10 * Math.log10(x)
}

/** 振幅比轉 dB：20 log10(|x|) */
export function db20(x: number): number {
  return 20 * Math.log10(Math.abs(x))
}

/** dB → 功率比 10^(dB/10) */
export function fromDb10(db: number): number {
  return Math.pow(10, db / 10)
}

/** dB → 振幅比 10^(dB/20) */
export function fromDb20(db: number): number {
  return Math.pow(10, db / 20)
}

/** 把角度（degree）折返到 (−180, 180]，例如 wrap180(−180) = 180、wrap180(540) = 180 */
export function wrap180(deg: number): number {
  let r = deg % 360
  if (r <= -180) r += 360
  else if (r > 180) r -= 360
  return r + 0 // 把 −0 正規化為 0
}

/** 把相位（rad）折返到 (−π, π] */
export function wrapPi(rad: number): number {
  const twoPi = 2 * Math.PI
  let r = rad % twoPi
  if (r <= -Math.PI) r += twoPi
  else if (r > Math.PI) r -= twoPi
  return r + 0
}

/** 度 → 弧度 */
export function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** 弧度 → 度 */
export function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** 夾在 [lo, hi]；NaN 原樣回傳 */
export function clamp(x: number, lo: number, hi: number): number {
  if (lo > hi) throw new Error(`clamp：需要 lo ≤ hi，收到 [${lo}, ${hi}]`)
  return x < lo ? lo : x > hi ? hi : x
}

/** 時間誤差（fs）→ 相位（rad）：φ = 2π f · t（f 為該節點頻率，例如 f_out，單位 Hz） */
export function fsToRad(tFs: number, fHz: number): number {
  return 2 * Math.PI * fHz * tFs * 1e-15
}

/** 相位（rad）→ 時間誤差（fs）：t = φ / (2π f) */
export function radToFs(phiRad: number, fHz: number): number {
  return (phiRad / (2 * Math.PI * fHz)) * 1e15
}
