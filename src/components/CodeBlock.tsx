import { useMemo, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import { diffLines, extractRegion } from './codeRegion'
import './code.css'
import { ScrollRegion } from './ScrollRegion'
import { mathText } from './Tex'

hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)

export type CodeLang = 'typescript' | 'python'

/** 不超過這麼多行的程式碼不限制高度（超過才收進 520px 的可捲動框） */
export const CODE_FULL_LINES = 32

export interface CodeBlockProps {
  /** 原始檔內容（以 `?raw` 匯入） */
  source: string
  /** 只顯示 `#region core:<region>` 段落；省略則顯示整個檔案 */
  region?: string
  lang?: CodeLang
  /** 標題，例如檔名或演算法名稱 */
  title?: string
  /** 來源路徑（顯示用），例如 'src/simulation/models/lms.ts' */
  path?: string
  /** 額外要高亮的行（1-based）；含「← 差異」的行會自動高亮 */
  highlight?: number[]
  /** 說明文字（顯示在程式碼下方） */
  caption?: string
}

function highlightToLines(code: string, lang: CodeLang): string[] {
  const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  // hljs 的 span 可能跨行：逐行重新開／關 span，讓每行都是完整 HTML
  const lines: string[] = []
  const open: string[] = []
  let current = ''
  const tokenRe = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html))) {
    if (m[1]) {
      open.push(m[1])
      current += m[1]
    } else if (m[2]) {
      open.pop()
      current += m[2]
    } else if (m[3]) {
      current += '</span>'.repeat(open.length)
      lines.push(current)
      current = open.join('')
    } else {
      current += m[4]
    }
  }
  lines.push(current + '</span>'.repeat(open.length))
  return lines
}

/** 顯示網站實際執行的程式碼（含語法高亮、行號、差異行標示、複製按鈕）。 */
export function CodeBlock({ source, region, lang = 'typescript', title, path, highlight, caption }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const { code, error } = useMemo(() => {
    try {
      return { code: region ? extractRegion(source, region) : source.trimEnd(), error: null as string | null }
    } catch (e) {
      return { code: '', error: (e as Error).message }
    }
  }, [source, region])
  const lines = useMemo(() => (code ? highlightToLines(code, lang) : []), [code, lang])
  const marked = useMemo(() => new Set([...(highlight ?? []), ...diffLines(code)]), [code, highlight])

  if (error) {
    return (
      <div className="callout callout-danger" role="alert">
        <strong>程式碼載入錯誤：</strong>
        {error}
      </div>
    )
  }

  const copy = () => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }

  return (
    <figure className="c-code">
      <figcaption className="c-code-head">
        <span className="c-code-title">{mathText(title ?? (region ? `core:${region}` : '程式碼'))}</span>
        {path && <span className="c-code-path">{path}</span>}
        <span className="c-code-lang">{lang === 'python' ? 'Python' : 'TypeScript'}</span>
        <button type="button" className="btn c-code-copy" onClick={copy} aria-label="複製程式碼">
          {copied ? '已複製' : '複製'}
        </button>
      </figcaption>
      {/* 高度上限約 25 行。只多出幾行的程式碼直接整段顯示：為了一兩行放一條捲軸沒有用途。
          會捲動（長或寬）時可用鍵盤聚焦（ScrollRegion）。 */}
      <ScrollRegion as="pre" label="程式碼（可捲動）" className={`c-code-pre${lines.length <= CODE_FULL_LINES ? ' is-full' : ''}`}>
        <code className={`hljs language-${lang}`}>
          {lines.map((html, i) => (
            <span key={i} className={`c-code-line${marked.has(i + 1) ? ' c-code-mark' : ''}`}>
              <span className="c-code-ln" aria-hidden="true">
                {i + 1}
              </span>
              <span dangerouslySetInnerHTML={{ __html: html || ' ' }} />
              {'\n'}
            </span>
          ))}
        </code>
      </ScrollRegion>
      {caption && <div className="c-code-caption">{mathText(caption)}</div>}
    </figure>
  )
}

export interface CodeCompareItem extends Omit<CodeBlockProps, 'caption'> {
  /** 分頁／欄位標籤，例如 'Conventional LMS' */
  label: string
  /** 這個版本與其他版本的差異說明（一句話） */
  note?: string
}

export interface CodeCompareProps {
  items: CodeCompareItem[]
  /** columns：寬螢幕並排（窄螢幕自動改為分頁）；tabs：永遠分頁 */
  layout?: 'columns' | 'tabs'
  caption?: string
}

/**
 * 演算法程式碼比較：同一段 region 的不同版本並排。
 * 在程式碼中用行內註解 `// ← 差異：…` 標出關鍵差異行，會被自動高亮。
 */
export function CodeCompare({ items, layout = 'columns', caption }: CodeCompareProps) {
  const [active, setActive] = useState(0)
  return (
    <div className={`c-code-compare c-code-compare-${layout}`}>
      <div className="c-code-tabs" role="tablist" aria-label="程式碼比較">
        {items.map((it, i) => (
          <button
            key={it.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`c-code-tab${i === active ? ' active' : ''}`}
            onClick={() => setActive(i)}
          >
            {it.label}
          </button>
        ))}
      </div>
      <div className="c-code-compare-body">
        {items.map((it, i) => (
          <div key={it.label} className={`c-code-compare-item${i === active ? ' active' : ''}`} role="tabpanel">
            <div className="c-code-compare-label">{mathText(it.label)}</div>
            {it.note && <div className="c-code-compare-note">{mathText(it.note)}</div>}
            <CodeBlock {...it} title={it.title ?? it.label} />
          </div>
        ))}
      </div>
      {caption && <div className="c-code-caption">{mathText(caption)}</div>}
    </div>
  )
}
