/**
 * 「頁面上沒有 KaTeX 錯誤」的共用斷言。
 *
 * 共用的 <Tex> 以 `throwOnError:false` 渲染，錯誤有兩種長相：
 *   1. 語法錯誤 ⇒ `.katex-error`（<Tex> 自己的 fallback 是 `.c-tex-error`）。`texErrors`／`expectNoTexErrors` 抓這種。
 *   2. 「未定義的控制序列」（例如把 `\mu` 和 `e` 黏成 `\mue`）⇒ 沒有 class，只是 #cc0000 的紅字。
 *      `strictTexErrors`／`expectNoStrictTexErrors` 把每個公式的原始碼（MathML annotation）用 `throwOnError:true` 重新解析，並找紅字。
 *      比較慢（每個不同的公式解析一次），整章只做一次。
 *
 *   expectNoTexErrors(container)                       // 只看 class
 *   expectNoStrictTexErrors(container, '整章')         // 再加嚴格重新解析；至少要找到一個公式，否則視為選錯範圍
 */
import katex from 'katex'

const ERROR_SELECTOR = '.katex-error, .c-tex-error'

/** root 底下所有 `.katex-error`／`.c-tex-error` 的訊息（title，沒有就用文字）。空陣列 = 沒有錯誤。 */
export function texErrors(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll(ERROR_SELECTOR)).map((e) => e.getAttribute('title') ?? e.textContent ?? '')
}

/** 嚴格重新解析 root 底下的每個公式，回傳錯誤描述（含紅字）。`seen` 回傳實際檢查了幾個不同的公式。 */
export function strictTexReport(root: ParentNode): { errors: string[]; seen: number } {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const ann of Array.from(root.querySelectorAll('.katex-mathml annotation'))) {
    const src = ann.textContent ?? ''
    if (seen.has(src)) continue
    seen.add(src)
    try {
      katex.renderToString(src, { throwOnError: true, strict: 'ignore' })
    } catch (e) {
      errors.push(`${src} ⇒ ${(e as Error).message}`)
    }
  }
  for (const el of Array.from(root.querySelectorAll('.katex [mathcolor="#cc0000"]'))) errors.push(`紅字：${el.textContent}`)
  return { errors, seen: seen.size }
}

/** 同 `strictTexReport(root).errors`。 */
export function strictTexErrors(root: ParentNode): string[] {
  return strictTexReport(root).errors
}

/** 斷言 root 底下沒有 `.katex-error`／`.c-tex-error`。`label` 會出現在失敗訊息。 */
export function expectNoTexErrors(root: ParentNode, label?: string): void {
  expect(texErrors(root), label).toEqual([])
}

/** 斷言 root 底下每個公式都能嚴格解析、沒有紅字，而且至少有一個公式（`requireFormulas: false` 可關掉最後這條）。 */
export function expectNoStrictTexErrors(root: ParentNode, label?: string, opts: { requireFormulas?: boolean } = {}): void {
  const { errors, seen } = strictTexReport(root)
  expect(errors, label).toEqual([])
  if (opts.requireFormulas ?? true) expect(seen, `${label ?? ''}（沒有找到任何公式：範圍選錯了？）`).toBeGreaterThan(0)
}

export interface TexParseOptions {
  displayMode?: boolean
  /** KaTeX 的 strict 模式；沒給就用 KaTeX 預設（'warn'：不丟錯）。教學站的公式多半用 'ignore'。 */
  strict?: 'ignore' | 'warn' | 'error'
}

/** 斷言單一 TeX 字串能以 `throwOnError: true` 解析（不渲染到頁面）。`label` 通常放出處（公式 ID、哪一步）。 */
export function expectTexParses(tex: string, label?: string, opts: TexParseOptions = {}): void {
  const options: katex.KatexOptions = { throwOnError: true }
  if (opts.displayMode !== undefined) options.displayMode = opts.displayMode
  if (opts.strict !== undefined) options.strict = opts.strict
  expect(() => katex.renderToString(tex, options), label ?? tex).not.toThrow()
}
