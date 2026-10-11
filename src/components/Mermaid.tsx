import { useEffect, useRef, useState } from 'react'
import { Callout } from './Callout'
import { sanitizeMermaidSource, withReadableMinWidth } from './mermaidSource'
import { useOptionalSettings } from './optionalSettings'
import { mathText, stripMathDelimiters } from './Tex'
import { cssVar, useDocumentTheme } from './theme'

type MermaidApi = (typeof import('mermaid'))['default']

let mermaidPromise: Promise<MermaidApi> | null = null
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default).catch((err: unknown) => {
      mermaidPromise = null // 允許下次重試（例如網路暫時失敗）
      throw err
    })
  }
  return mermaidPromise
}

/**
 * mermaid.initialize() 是全域設定；為避免兩張圖在不同主題下交錯 initialize/render，
 * 所有 render 依序排入同一個 queue。
 */
let queue: Promise<unknown> = Promise.resolve()
let counter = 0

/** 排隊中的圖若已不需要（元件已卸載或主題已換），輪到它時直接跳過，不佔用後面的圖 */
export class MermaidCancelled extends Error {
  constructor() {
    super('mermaid render cancelled')
  }
}

export function renderMermaid(chart: string, theme: 'light' | 'dark', isCancelled?: () => boolean): Promise<string> {
  const id = `c-mermaid-${++counter}`
  const job = queue.then(async () => {
    if (isCancelled?.()) throw new MermaidCancelled()
    const mermaid = await loadMermaid()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: cssVar('--font-sans', 'sans-serif'),
      suppressErrorRendering: true,
      // 節點／連線標籤裡的 `$$...$$` 用 KaTeX 的 HTML 輸出排版（和正文同一套樣式；KaTeX CSS 已全站載入）
      forceLegacyMathML: true,
    })
    // KaTeX 字型還沒載入就量尺寸會讓節點太窄；等字型就緒（不支援 document.fonts 的環境直接略過）
    try {
      await document.fonts?.ready
    } catch {
      /* ignore */
    }
    try {
      const { svg } = await mermaid.render(id, sanitizeMermaidSource(chart))
      return withReadableMinWidth(svg)
    } finally {
      // 失敗時 mermaid 可能留下暫存節點
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
    }
  })
  queue = job.catch(() => undefined)
  return job
}

export interface MermaidProps {
  /** Mermaid 原始碼 */
  chart: string
  caption?: string
  /** 圖的文字替代說明（螢幕閱讀器） */
  ariaLabel?: string
}

type RenderState = { status: 'loading' } | { status: 'ok'; svg: string } | { status: 'error'; message: string }

/**
 * Mermaid 方塊圖：跟隨深淺主題重新渲染；語法錯誤時顯示錯誤訊息。
 * 一章可能有二十幾張圖，所以圖接近可視範圍時才 render（IntersectionObserver）；
 * 沒有 IntersectionObserver 的環境（jsdom、舊瀏覽器）直接 render。圖說支援 `$...$` 行內公式。
 */
export function Mermaid({ chart, caption, ariaLabel }: MermaidProps) {
  const settings = useOptionalSettings()
  const docTheme = useDocumentTheme()
  const theme = settings?.resolvedTheme ?? docTheme
  const [state, setState] = useState<RenderState>({ status: 'loading' })
  const ref = useRef<HTMLElement | null>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (near || !ref.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '800px 0px' },
    )
    io.observe(ref.current)
    // 列印整頁時，還沒捲到的圖也要畫出來（否則印出「圖表載入中…」）
    const onPrint = () => setNear(true)
    window.addEventListener('beforeprint', onPrint)
    return () => {
      io.disconnect()
      window.removeEventListener('beforeprint', onPrint)
    }
  }, [near])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    renderMermaid(chart, theme, () => cancelled).then(
      (svg) => {
        if (!cancelled) setState({ status: 'ok', svg })
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [chart, theme, near])

  const label = ariaLabel ?? caption
  return (
    <figure className="c-mermaid" aria-label={label ? stripMathDelimiters(label) : undefined} ref={ref}>
      {state.status === 'error' ? (
        <Callout kind="danger" title="Mermaid 圖解析失敗">
          <pre className="c-mermaid-error">{state.message}</pre>
        </Callout>
      ) : state.status === 'ok' ? (
        <div className="c-mermaid-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
      ) : (
        <div className="c-mermaid-loading muted small">圖表載入中…</div>
      )}
      {caption && <figcaption className="c-figcaption">{mathText(caption)}</figcaption>}
    </figure>
  )
}
