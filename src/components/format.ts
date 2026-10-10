/**
 * 顯示與序列化用的小工具（純函式，無 DOM）。
 * 注意：這裡只做「顯示格式」，不得用來改變參與計算的數值。
 */

/**
 * 以有效位數格式化數字：去除多餘的尾零；極大或極小時使用科學記號。
 * 非有限值顯示 'NaN' / '∞' / '−∞'。
 */
export function fmtNum(x: number, digits = 6): string {
  if (Number.isNaN(x)) return 'NaN'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  if (x === 0) return '0'
  const d = Math.min(Math.max(Math.round(digits), 1), 17)
  const ax = Math.abs(x)
  if (ax >= 1e-5 && ax < 1e9) {
    // toPrecision 後再轉 Number 以移除尾零，例如 0.0000100000 → 0.00001
    return String(Number(x.toPrecision(d)))
  }
  const [mant, exp] = x.toExponential(d - 1).split('e')
  const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant
  return `${m}e${Number(exp)}`
}

/** 將單位接在數值後面（單位為空時只回傳數值） */
export function fmtWithUnit(x: number, unit?: string, digits = 6): string {
  const s = fmtNum(x, digits)
  return unit ? `${s} ${unit}` : s
}

/**
 * 轉成可安全 JSON 序列化的值：
 * - NaN / ±Infinity → 'NaN' / 'Infinity' / '-Infinity'（JSON.stringify 預設會變成 null 而遺失資訊）
 * - typed array → number[]；bigint → string；Map → object；Set → array
 * - 函式與 undefined → 省略；循環參照 → '[Circular]'
 */
export function toJsonSafe(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'string':
    case 'boolean':
      return value
    case 'bigint':
      return value.toString()
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }
  const obj = value as object
  if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    return Array.from(obj as unknown as ArrayLike<number | bigint>, (v) => toJsonSafe(v, seen))
  }
  if (obj instanceof Date) return obj.toISOString()
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)
  try {
    if (Array.isArray(obj)) return obj.map((v) => toJsonSafe(v, seen) ?? null)
    if (obj instanceof Map) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of obj) out[String(k)] = toJsonSafe(v, seen)
      return out
    }
    if (obj instanceof Set) return Array.from(obj, (v) => toJsonSafe(v, seen) ?? null)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      const s = toJsonSafe(v, seen)
      if (s !== undefined) out[k] = s
    }
    return out
  } finally {
    seen.delete(obj)
  }
}

/** JSON 美化輸出（使用 toJsonSafe） */
export function prettyJson(value: unknown): string {
  return JSON.stringify(toJsonSafe(value), null, 2) ?? 'null'
}

/** 產生適合當檔名的時間戳記，例如 20261010-153012 */
export function fileTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 將任意字串轉成安全的檔名片段（保留中英數字、-、_） */
export function safeFileName(s: string): string {
  const cleaned = s
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || 'export'
}
