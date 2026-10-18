import { Children, isValidElement, memo, useMemo, type ReactNode } from 'react'
import katex from 'katex'
import { INLINE_MATH, accessibleText, hasInlineMath, texToSpeech } from './speech'

// 無障礙名稱用的可念形式（aria-label / title / aria-valuetext / <option>）；細節與規則見 speech.ts
export { accessibleText, hasInlineMath, texToSpeech }

/**
 * KaTeX 轉成 HTML 字串。throwOnError:false → 語法錯誤時顯示紅字原始碼而不是讓頁面崩潰。
 * trust:false 禁止 \href / \url 等可能注入連結的指令。
 */
export function renderTex(src: string, displayMode: boolean): string {
  try {
    return katex.renderToString(src, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
    })
  } catch (err) {
    // throwOnError:false 仍可能因非 ParseError 的錯誤丟出；以純文字退回
    const msg = err instanceof Error ? err.message : String(err)
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    return `<span class="c-tex-error" title="${esc(msg)}">${esc(src)}</span>`
  }
}

/** 行內 KaTeX：<Tex>{'\\mu e_n x_n'}</Tex> */
export const Tex = memo(function Tex({ children }: { children: string }) {
  const html = useMemo(() => renderTex(children, false), [children])
  return <span className="c-tex" dangerouslySetInnerHTML={{ __html: html }} />
})

export interface TexBlockProps {
  /** TeX 原始碼 */
  children: string
  /** 公式 ID（例如 'F-3.1'）；會顯示在右側並作為錨點 id="formula-F-3.1" */
  id?: string
  /** 公式名稱 / 說明（顯示在公式下方） */
  label?: ReactNode
}

/** 獨立公式（display mode）；寬公式在手機上可於自身容器內水平捲動 */
export const TexBlock = memo(function TexBlock({ children, id, label }: TexBlockProps) {
  const html = useMemo(() => renderTex(children, true), [children])
  return (
    <figure className="c-texblock" id={id ? `formula-${id}` : undefined}>
      <div className="c-texblock-row">
        <div className="c-texblock-math" dangerouslySetInnerHTML={{ __html: html }} />
        {id && (
          <span className="c-formula-id" title={`公式 ${id}`}>
            ({id})
          </span>
        )}
      </div>
      {label && <figcaption className="c-texblock-label">{label}</figcaption>}
    </figure>
  )
})

/**
 * 讓「字串屬性」也能放 LaTeX：字串中的 `$...$` 以行內 KaTeX 顯示，其餘原樣輸出；非字串（ReactNode）原樣回傳。
 * 用於標題、指標名稱、警告、假設、圖說等只能傳字串的地方（docs/teaching-style.md §3：數學一律 LaTeX）。
 * 例：mathText('C ≤ 0：$p = 1 - \\mu K_q C > 1$，更新極性錯誤')
 */
export function mathText(node: ReactNode): ReactNode {
  if (typeof node !== 'string' || !node.includes('$')) return node
  const parts: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of node.matchAll(INLINE_MATH)) {
    const start = m.index ?? 0
    if (start > last) parts.push(node.slice(last, start).replace(/\\\$/g, '$'))
    parts.push(<Tex key={`m${i++}`}>{m[1]}</Tex>)
    last = start + m[0].length
  }
  if (parts.length === 0) return node.replace(/\\\$/g, '$')
  if (last < node.length) parts.push(node.slice(last).replace(/\\\$/g, '$'))
  return <>{parts}</>
}

/**
 * 純文字情境（報告、程式碼、id、匯出標題）用：拿掉 `$` 分隔符，保留 TeX 原始碼。
 * 給螢幕閱讀器念的名稱（aria-label / title / aria-valuetext / <option>）不要用這個，改用 `accessibleText`（會把 TeX 轉成可念的文字）。
 */
export function stripMathDelimiters(text: string): string {
  return text.replace(INLINE_MATH, (_, tex: string) => tex).replace(/\\\$/g, '$')
}

/** 元件版：<MathText>{'σ_w：$\\sigma_w$'}</MathText> */
export function MathText({ children }: { children: ReactNode }) {
  return <>{mathText(children)}</>
}

/** 把相鄰的兩段文字接起來；兩邊都是西文字母／數字時補一個空白（避免 "Case" + "alpha" 黏在一起） */
function glue(a: string, b: string): string {
  return /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b
}

function speakNode(node: ReactNode): { text: string; math: boolean } {
  if (node === null || node === undefined || typeof node === 'boolean') return { text: '', math: false }
  if (typeof node === 'string') return { text: accessibleText(node), math: hasInlineMath(node) }
  if (typeof node === 'number') return { text: String(node), math: false }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; 'aria-hidden'?: boolean | 'true' | 'false' }
    if (props['aria-hidden'] === true || props['aria-hidden'] === 'true') return { text: '', math: false }
    if (node.type === Tex || node.type === TexBlock) {
      return { text: typeof props.children === 'string' ? texToSpeech(props.children) : '', math: true }
    }
    return speakNode(props.children)
  }
  let text = ''
  let math = false
  for (const child of Children.toArray(node)) {
    const r = speakNode(child)
    text = glue(text, r.text)
    math ||= r.math
  }
  return { text, math }
}

/**
 * ReactNode（字串、<Tex>、<MathText>、一般元素與陣列）→ 螢幕閱讀器念的純文字。
 * 為什麼不能只靠畫面上的標籤：KaTeX 的 HTML 部分是 aria-hidden，MathML 部分在 Chrome 的「由內容算名稱」裡不會被算進去，
 * 所以 `<label>$\mu$（Case A）</label>` 的名稱只剩「（Case A）」，`<label>$\delta_0$</label>` 則是空字串。
 * 控制項（輸入框、滑桿、單選鈕、<summary>）的標籤含數學時，要另外給 aria-label，內容用這個函式產生。
 */
export function nodeToAccessibleText(node: ReactNode): string {
  return speakNode(node).text.replace(/\s+/g, ' ').trim()
}

/** 這個 ReactNode 裡有沒有數學（字串中的 `$...$` 或 <Tex>）：有的話名稱不能只靠畫面上的標籤 */
export function nodeHasMath(node: ReactNode): boolean {
  return speakNode(node).math
}
