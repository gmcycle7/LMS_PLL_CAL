/**
 * 測試用：檢查「字串屬性裡的數學」是否照 docs/teaching-style.md §3 寫成 `$…$` LaTeX。
 * （只被 *.test.ts(x) 匯入；放在一般檔案是為了讓多個測試共用同一套規則。）
 */
import { renderTex } from '@/components'

/** 配對的 `$…$`（與共用元件 mathText 相同的切法；`\$` 是字面金額符號） */
const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 字串內所有 `$…$` 片段的 TeX 原始碼 */
export const inlineMath = (text: string): string[] => Array.from(text.matchAll(INLINE_MATH), (m) => m[1])

/** 拿掉 `$…$` 之後剩下的純文字 */
export const outsideMath = (text: string): string => text.replace(INLINE_MATH, ' ')

/**
 * 不該出現在 `$…$` 之外的字元：希臘字母、Unicode 上下標、組合用波浪號，以及 ≤ ≥ ≪ ≫ ≈ ≠ ∝ √ ∞ ∑ ∫ ∂ ± ⇒ ⇔。
 * （「×」「→」「·」在一般敘述中也會用到，例如「gain-equivalent × code」「預測 → 比較 → 修正」，不列入。）
 */
export const UNICODE_MATH = /[Ͱ-Ͽ⁰-₟²³¹ᵀ≤≥≪≫≈≠∝√∞∑∫∂±⇒⇔]|̃/

/** 一段說明文字的問題清單（空陣列 = 合格）：`$` 成對、每段 TeX 可由 KaTeX 解析、`$…$` 之外沒有 Unicode 拼的公式、沒有 NaN / undefined */
export function mathTextProblems(text: string): string[] {
  const out: string[] = []
  if ((text.match(/(?<!\\)\$/g) ?? []).length % 2 !== 0) out.push('$ 不成對')
  for (const tex of inlineMath(text)) {
    if (/katex-error|c-tex-error/.test(renderTex(tex, false))) out.push(`KaTeX 無法解析：${tex}`)
    if (/NaN|undefined/.test(tex)) out.push(`TeX 內含 NaN / undefined：${tex}`)
    if (/(^|[^\\])\\\\[a-zA-Z]/.test(tex)) out.push(`兩個反斜線接字母：${tex}`)
  }
  const plain = outsideMath(text)
  const bad = UNICODE_MATH.exec(plain)
  if (bad) out.push(`$…$ 之外出現 Unicode 數學字元「${bad[0]}」：${plain.slice(Math.max(0, bad.index - 12), bad.index + 12)}`)
  if (/NaN|undefined/.test(plain)) out.push('文字內含 NaN / undefined')
  return out
}
