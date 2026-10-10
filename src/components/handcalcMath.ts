import type { HandCalcDef, HandCalcInput, HandCalcResult } from '@/data/types'
import { createRng } from '@/simulation/core'

/**
 * 把數字轉成 TeX（手算題把數字代進公式時使用）。
 * - 最多 sig 位有效數字並去掉尾零；|x| ≥ 1e6 或 < 1e-4 時用 a\times10^{b}。
 * - NaN／±∞ 也有對應表示，避免公式裡出現 "NaN"。
 */
export function texNum(x: number, sig = 5): string {
  if (Number.isNaN(x)) return '\\text{NaN}'
  if (x === Infinity) return '\\infty'
  if (x === -Infinity) return '-\\infty'
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 1e6 || ax < 1e-4) {
    const exp = Math.floor(Math.log10(ax))
    let mant = Number((x / 10 ** exp).toPrecision(sig))
    let e = exp
    if (Math.abs(mant) >= 10) {
      mant /= 10
      e += 1
    }
    return mant === 1 ? `10^{${e}}` : mant === -1 ? `-10^{${e}}` : `${trimNumber(mant, sig)}\\times10^{${e}}`
  }
  return trimNumber(x, sig)
}

/** 代入用：負數加括號，例如 w x → 2\times(-3)。 */
export function texNumP(x: number, sig = 5): string {
  const s = texNum(x, sig)
  return x < 0 || s.startsWith('-') ? `(${s})` : s
}

function trimNumber(x: number, sig: number): string {
  const s = Number(x.toPrecision(sig)).toString()
  // Number#toString 對 1e-5 之類仍可能給指數表示；這裡的呼叫端已排除極大極小值
  return s.includes('e') ? Number(x.toPrecision(sig)).toFixed(Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(x))))) : s
}

/** 手算答案是否在容許誤差內（預設相對 1% 或絕對 1e-9）。 */
export function checkAnswer(user: number, r: Pick<HandCalcResult, 'value' | 'tolerance'>): { ok: boolean; relError: number; absError: number } {
  const abs = r.tolerance?.abs ?? 1e-9
  const rel = r.tolerance?.rel ?? 0.01
  const absError = Math.abs(user - r.value)
  const relError = r.value === 0 ? (absError === 0 ? 0 : Infinity) : absError / Math.abs(r.value)
  const ok = Number.isFinite(r.value) ? absError <= abs || relError <= rel : Number.isNaN(user) === Number.isNaN(r.value) && user === r.value
  return { ok, relError, absError }
}

export function defaultValues(def: HandCalcDef): Record<string, number> {
  return Object.fromEntries(def.inputs.map((i) => [i.key, i.default]))
}

function drawInput(i: HandCalcInput, u: number): number {
  const p = i.practice
  if (!p) return i.default
  if (p.choices && p.choices.length) return p.choices[Math.min(p.choices.length - 1, Math.floor(u * p.choices.length))]
  const lo = p.min ?? i.min ?? i.default
  const hi = p.max ?? i.max ?? i.default
  const step = p.step ?? (i.integer ? 1 : (hi - lo) / 20 || 1)
  const n = Math.max(0, Math.round((hi - lo) / step))
  const v = lo + step * Math.min(n, Math.floor(u * (n + 1)))
  // 去掉浮點尾巴（0.30000000000000004 → 0.3）
  return i.integer ? Math.round(v) : Number(v.toPrecision(10))
}

/**
 * 「換一題」：依各輸入的 practice 範圍抽一組手算友善的數字。
 * 以 seed 決定，可重現；若抽到 validate 不通過的組合就換下一組（最多 50 次，仍不行則回預設值）。
 */
export function randomValues(def: HandCalcDef, seed: number): Record<string, number> {
  const rng = createRng(seed).fork(def.id)
  for (let attempt = 0; attempt < 50; attempt++) {
    const v = Object.fromEntries(def.inputs.map((i) => [i.key, drawInput(i, rng.uniform())]))
    if (!def.validate || def.validate(v) === null) {
      try {
        const sol = def.solve(v)
        if (sol.results.every((r) => Number.isFinite(r.value))) return v
      } catch {
        /* 換下一組 */
      }
    }
  }
  return defaultValues(def)
}

/** 檢查單一輸入值是否在合法範圍；回傳錯誤訊息或 null。 */
export function inputError(i: HandCalcInput, v: number): string | null {
  if (!Number.isFinite(v)) return '請輸入數字'
  if (i.integer && !Number.isInteger(v)) return '必須是整數'
  if (i.min !== undefined && v < i.min) return `不可小於 ${i.min}`
  if (i.max !== undefined && v > i.max) return `不可大於 ${i.max}`
  return null
}
