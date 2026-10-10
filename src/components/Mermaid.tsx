import { useEffect, useState } from 'react'
import { Callout } from './Callout'
import { useOptionalSettings } from './optionalSettings'
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

export function renderMermaid(chart: string, theme: 'light' | 'dark'): Promise<string> {
  const id = `c-mermaid-${++counter}`
  const job = queue.then(async () => {
    const mermaid = await loadMermaid()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: cssVar('--font-sans', 'sans-serif'),
      suppressErrorRendering: true,
    })
    try {
      const { svg } = await mermaid.render(id, chart)
      return svg
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

/** Mermaid 方塊圖：跟隨深淺主題重新渲染；語法錯誤時顯示錯誤訊息 */
export function Mermaid({ chart, caption, ariaLabel }: MermaidProps) {
  const settings = useOptionalSettings()
  const docTheme = useDocumentTheme()
  const theme = settings?.resolvedTheme ?? docTheme
  const [state, setState] = useState<RenderState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    renderMermaid(chart, theme).then(
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
  }, [chart, theme])

  return (
    <figure className="c-mermaid" aria-label={ariaLabel ?? caption}>
      {state.status === 'error' ? (
        <Callout kind="danger" title="Mermaid 圖解析失敗">
          <pre className="c-mermaid-error">{state.message}</pre>
        </Callout>
      ) : state.status === 'ok' ? (
        <div className="c-mermaid-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
      ) : (
        <div className="c-mermaid-loading muted small">圖表載入中…</div>
      )}
      {caption && <figcaption className="c-figcaption">{caption}</figcaption>}
    </figure>
  )
}
