import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'

/**
 * 測試共用小工具（不是測試檔；只被 *.test.ts(x) 匯入）。
 */

/** 以 throwOnError 嚴格解析 TeX；回傳錯誤訊息（null = 沒問題） */
export function texError(tex: string, displayMode = false): string | null {
  try {
    katex.renderToString(tex, { displayMode, throwOnError: true, strict: 'ignore', trust: false })
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** 取出 '說明 $TeX$ 說明' 裡所有的 TeX 片段 */
export function richTexParts(text: string): string[] {
  const out: string[] = []
  const parts = text.split(/\$([^$]+)\$/g)
  for (let i = 1; i < parts.length; i += 2) out.push(parts[i])
  return out
}

/**
 * 「掉了反斜線」的偵測：一般字串（不是 String.raw）裡寫 '\approx' 會變成 'approx'，KaTeX 仍能解析（當成一串字母），
 * 所以要另外檢查：TeX 片段裡不應該出現沒有反斜線的指令名稱。
 */
const LOST_BACKSLASH =
  /(?<![\\a-zA-Z])(approx|mathbf|mathrm|mathcal|mathsf|boldsymbol|operatorname|varepsilon|epsilon|varphi|kappa|lambda|sigma|delta|omega|theta|alpha|gamma|frac|sqrt|cdot|infty|qquad|quad|ldots|times|equiv|propto|preceq|succeq|Rightarrow|rightarrow|leftrightarrow|arcsin|arccos|lfloor|rfloor|triangleq|boxed|underbrace|mathsf|bmod|circ|partial)(?![a-zA-Z])/

export function lostBackslash(tex: string): string | null {
  // \text{…}、\mathrm{…}、\operatorname{…} 裡的字是一般文字，先拿掉再檢查
  const stripped = tex.replace(/\\(?:text|mathrm|operatorname|textbf|mathsf)\s*\{[^{}]*\}/g, ' ')
  const m = LOST_BACKSLASH.exec(stripped)
  return m ? m[1] : null
}

/** 單一 TeX 字串的問題（解析失敗或掉了反斜線）；null = 沒問題 */
export function texIssue(tex: string, displayMode = false): string | null {
  const err = texError(tex, displayMode)
  if (err) return err
  const lost = lostBackslash(tex)
  return lost ? `TeX 指令 ${lost} 少了反斜線` : null
}

/** rich 字串的問題清單：$ 不成對、或其中的 TeX 解析失敗、或 TeX 指令掉了反斜線 */
export function richProblems(text: string): string[] {
  const problems: string[] = []
  const dollars = (text.match(/\$/g) ?? []).length
  if (dollars % 2 !== 0) problems.push(`$ 不成對（${dollars} 個）：${text.slice(0, 60)}`)
  for (const t of richTexParts(text)) {
    const err = texError(t)
    if (err) problems.push(`${err} ← ${t}`)
    const lost = lostBackslash(t)
    if (lost) problems.push(`TeX 指令 ${lost} 少了反斜線 ← ${t}`)
  }
  // 純文字部分不應該留下 TeX 指令（代表漏了 $）
  const plain = text.replace(/\$[^$]+\$/g, ' ')
  const stray = /\\[a-zA-Z]{2,}/.exec(plain)
  if (stray) problems.push(`$…$ 之外出現 TeX 指令 ${stray[0]}：${text.slice(0, 60)}`)
  return problems
}

export interface GoldenVector {
  id: string
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
  tolerance: { abs?: number; rel?: number }
  tolerance_overrides?: Record<string, { abs?: number; rel?: number }>
}

/** 讀 golden/vectors/<name>.json（Python 獨立計算的參考值） */
export function readGolden(name: string): GoldenVector {
  return JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as GoldenVector
}

/** golden 的容差規則：|actual − expected| ≤ abs + rel·|expected|（key 有 override 時用它自己的） */
export function goldenTol(v: GoldenVector, key: string, expected: number): number {
  const t = v.tolerance_overrides?.[key] ?? v.tolerance
  return (t.abs ?? 0) + (t.rel ?? 0) * Math.abs(expected)
}

/** 取 golden 的數值欄位並回傳 [expected, tol] */
export function goldenNum(v: GoldenVector, key: string): [number, number] {
  const e = v.expected[key]
  if (typeof e !== 'number') throw new Error(`golden ${v.id}.${key} 不是數字`)
  return [e, goldenTol(v, key, e)]
}

export function goldenList(v: GoldenVector, key: string): number[] {
  const e = v.expected[key]
  if (!Array.isArray(e)) throw new Error(`golden ${v.id}.${key} 不是陣列`)
  return e as number[]
}

/** expect(actual) 與 golden 比對（在測試檔內呼叫，回傳誤差是否在容差內與細節字串） */
export function withinGolden(v: GoldenVector, key: string, actual: number): { ok: boolean; detail: string } {
  const [e, tol] = goldenNum(v, key)
  const err = Math.abs(actual - e)
  // 容差為 0 的整數欄位要求完全相等；其餘加上一個極小的浮點安全邊界
  const ok = tol === 0 ? actual === e : err <= tol + 4 * Number.EPSILON * Math.max(1, Math.abs(e))
  return { ok, detail: `${v.id}.${key}: actual=${actual} expected=${e} |Δ|=${err} tol=${tol}` }
}
