/**
 * ParamControl 使用的純數值工具：輸入字串解析、有效位數、log 刻度對應。
 */

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/**
 * 解析使用者輸入的數字。接受 '0.00001'、'1e-5'、'-3'、'.5'、全形數字與 '−'（U+2212）。
 * 拒絕空字串、'-'、'1e'、十六進位、'Infinity'、含千分位逗號等格式 → 回傳 null。
 */
export function parseNumberInput(raw: string): number | null {
  const s = raw
    .trim()
    // 全形數字與符號 → 半形（中文輸入法常見）
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[−－]/g, '-')
    .replace(/＋/g, '+')
    .replace(/[ｅＥ]/g, 'e')
  if (!NUMBER_RE.test(s)) return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

/** 四捨五入到 sig 位有效數字（顯示 / 滑桿取值用） */
export function roundSig(x: number, sig: number): number {
  if (x === 0 || !Number.isFinite(x)) return x
  return Number(x.toPrecision(Math.min(Math.max(Math.round(sig), 1), 17)))
}

/** 將數值格式化為輸入框文字：最多 digits 位有效數字，去掉尾零 */
export function formatInput(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return String(x)
  const r = roundSig(x, digits)
  // String() 對 |x| < 1e-6 會輸出 '1e-7' 這類科學記號，parseNumberInput 可讀回
  return String(r)
}

/** 取 1 / 2 / 5 × 10^k 中不大於 x 的最大「好看」步長 */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  const m = x / p
  const base = m >= 5 ? 5 : m >= 2 ? 2 : 1
  return base * p
}

/** log 滑桿：數值 → log10 位置（≤0 時夾到下限） */
export function toLogPosition(v: number, min: number, max: number): number {
  const lo = Math.log10(min)
  const hi = Math.log10(max)
  if (!(v > 0)) return lo
  return Math.min(Math.max(Math.log10(v), lo), hi)
}

/** log 滑桿：log10 位置 → 數值（取 sig 位有效數字並夾在 [min, max]） */
export function fromLogPosition(t: number, min: number, max: number, sig = 3): number {
  const v = roundSig(Math.pow(10, t), sig)
  return Math.min(Math.max(v, min), max)
}

export interface RangeCheck {
  ok: boolean
  /** 'range' = 超出範圍；'integer' = 需為整數；'parse' = 無法解析 */
  problem?: 'range' | 'integer' | 'parse'
}

/** 檢查數值是否合法（在 [min, max] 且若要求整數則為整數） */
export function checkValue(v: number | null, min: number, max: number, integer = false): RangeCheck {
  if (v === null) return { ok: false, problem: 'parse' }
  if (v < min || v > max) return { ok: false, problem: 'range' }
  if (integer && !Number.isInteger(v)) return { ok: false, problem: 'integer' }
  return { ok: true }
}

/** 夾到合法範圍（整數模式會先四捨五入，再夾到 [ceil(min), floor(max)]） */
export function clampValue(v: number, min: number, max: number, integer = false): number {
  if (integer) {
    const r = Math.round(v)
    return Math.min(Math.max(r, Math.ceil(min)), Math.floor(max))
  }
  return Math.min(Math.max(v, min), max)
}
