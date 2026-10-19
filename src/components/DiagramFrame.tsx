import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { DIRECTION_TEXT, LINE_TEXT, endpointText, parseDiagramText, type DiagramEdge, type DiagramText } from './diagramText'
import { accessibleText, mathText } from './Tex'
import './figureAlt.css'

/**
 * 所有方塊圖共用的外框（Mermaid 圖與手繪的系統地圖都用它）：
 *   - 圖放在一張有細點格線的「圖紙」上，和正文區隔開
 *   - 圖比版面寬時可以左右捲動，邊緣出現漸層提示「這邊還有」
 *   - 右上角「放大」：開一個全螢幕檢視，可縮放、拖曳，Esc 關閉
 */
export interface DiagramSize {
  width: number
  height: number
}

export interface DiagramFrameProps {
  caption?: string
  /** 圖的文字替代說明（螢幕閱讀器）；預設用 caption */
  ariaLabel?: string
  /** 加在 <figure> 上的額外 class */
  className?: string
  /** 圖已經畫好（才顯示「放大」鈕） */
  ready?: boolean
  /** 圖的自然尺寸（px，＝ SVG viewBox）；放大檢視的 100% 以此為準 */
  naturalSize?: DiagramSize | null
  /** 圖的內容是一段 SVG 字串（Mermaid） */
  html?: string
  /** 放大檢視用的 SVG 字串（id 需與 html 不同，避免同一頁出現重複 id）；預設同 html */
  zoomHtml?: string
  /** 圖的內容是 React 節點（系統地圖）；與 html 擇一 */
  children?: ReactNode
  /** 圖還沒畫好時顯示的內容（載入中／錯誤訊息）；此時不會有 .c-mermaid-svg */
  placeholder?: ReactNode
  /** 放大檢視用的 React 節點；預設同 children */
  zoomChildren?: ReactNode
  figureRef?: Ref<HTMLElement>
  /** Mermaid 原始碼：圖下方的「文字版」從它解析出節點與連線（只在使用者展開時才解析） */
  chart?: string
  /** 已經有結構的圖（系統地圖）直接給文字版的內容；可傳函式，展開時才呼叫 */
  textModel?: DiagramText | (() => DiagramText)
}

const ZOOM_MIN = 0.4
const ZOOM_MAX = 4
const ZOOM_STEP = 1.25
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

function ExpandIcon() {
  return (
    <svg className="c-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M9.5 2H14v4.5M14 2 9 7M6.5 14H2V9.5M2 14l5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * 圖下方的可收合說明（方塊圖的「文字版」、Plot 的「看數據」共用）。
 * 預設收合；內容是函式，只在使用者展開後才呼叫，所以收合時每張圖只多 <details><summary> 兩個元素。
 * 螢幕閱讀器用 <figure aria-describedby={id}> 指到這個 details。
 */
export function FigureDetails({ id, summary, className, children }: { id: string; summary: ReactNode; className?: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <details id={id} className={`c-figalt${className ? ` ${className}` : ''}`} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && <div className="c-figalt-body">{children()}</div>}
    </details>
  )
}

const EDGE_WORD: Record<DiagramText['kind'], string> = { flowchart: '連線', state: '轉移', sequence: '訊息', other: '連線' }

/** 文字版的內容：群組、節點（每個一行）、連線（「A → B（標籤）」）；時序圖另有註記 */
export function DiagramTextBody({ model }: { model: DiagramText }) {
  const label = (id: string, raw = true) => endpointText(model, id, raw)
  const edgeNote = (e: DiagramEdge) => [LINE_TEXT[e.line], e.raw].filter((x): x is string => !!x)
  const edgeWord = EDGE_WORD[model.kind]
  if (model.nodes.length === 0) return <p className="c-figalt-note">沒有偵測到可以列出的節點；請看圖說。</p>
  return (
    <>
      {!model.parsed && <p className="c-figalt-note">這張圖的語法沒有完整解析，只列出偵測到的節點名稱，沒有連線與群組。</p>}
      {model.direction && <p className="c-figalt-note">排列方向：{DIRECTION_TEXT[model.direction] ?? model.direction}。</p>}
      {model.groups.length > 0 && (
        <>
          <p className="c-figalt-h">群組（{model.groups.length}）</p>
          <ul className="c-figalt-list">
            {model.groups.map((g) => (
              <li key={g.id}>
                {mathText(g.raw)}：
                {g.nodes.length > 0
                  ? g.nodes.map((id, i) => (
                      <span key={id}>
                        {i > 0 && '、'}
                        {mathText(label(id))}
                      </span>
                    ))
                  : '（沒有直接屬於它的節點）'}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="c-figalt-h">節點（{model.nodes.length}）</p>
      <ul className="c-figalt-list">
        {model.nodes.map((n) => (
          <li key={n.id}>
            {mathText(n.raw)}
            {n.focus ? '（本章主角）' : ''}
            {n.group ? <span className="c-figalt-meta">〔{mathText(model.groups.find((g) => g.id === n.group)?.raw ?? n.group)}〕</span> : null}
          </li>
        ))}
      </ul>
      {model.edges.length > 0 && (
        <>
          <p className="c-figalt-h">
            {edgeWord}（{model.edges.length}）
          </p>
          <ul className="c-figalt-list">
            {model.edges.map((e, i) => {
              const notes = edgeNote(e)
              return (
                <li key={i}>
                  {mathText(label(e.from))} {e.arrow === 'forward' ? '→' : e.arrow === 'both' ? '↔' : '—'} {mathText(label(e.to))}
                  {notes.length > 0 && (
                    <span>
                      （
                      {notes.map((t, k) => (
                        <span key={k}>
                          {k > 0 && '；'}
                          {mathText(t)}
                        </span>
                      ))}
                      ）
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {model.notes && model.notes.length > 0 && (
        <>
          <p className="c-figalt-h">註記（{model.notes.length}）</p>
          <ul className="c-figalt-list">
            {model.notes.map((n, i) => (
              <li key={i}>
                {mathText(n.raw)}
                <span className="c-figalt-meta">
                  （跨過{' '}
                  {n.over.map((id, k) => (
                    <span key={id}>
                      {k > 0 && '、'}
                      {mathText(label(id))}
                    </span>
                  ))}
                  ；在第 {n.after} 則訊息之後）
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

export function DiagramFrame({ caption, ariaLabel, className, ready = true, naturalSize, html, zoomHtml, children, zoomChildren, placeholder, figureRef, chart, textModel }: DiagramFrameProps) {
  const altId = `figalt-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hasText = ready && (chart !== undefined || textModel !== undefined)
  const scroller = useRef<HTMLDivElement | null>(null)
  const zoomButton = useRef<HTMLButtonElement | null>(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const [open, setOpen] = useState(false)

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdge((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  // 圖畫好、換內容或欄寬改變時，重新判斷「左右還有沒有」
  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [measure, html, children, ready])

  const close = useCallback(() => {
    setOpen(false)
    zoomButton.current?.focus()
  }, [])

  const label = ariaLabel ?? caption
  const scrollable = edge.left || edge.right
  const frameClass = `c-mermaid-frame${edge.left ? ' can-left' : ''}${edge.right ? ' can-right' : ''}${scrollable ? ' is-scrollable' : ''}`
  const scrollerProps = {
    className: 'c-mermaid-svg',
    ref: scroller,
    onScroll: measure,
    // 可捲動時讓鍵盤也能捲（方向鍵）
    tabIndex: scrollable ? 0 : undefined,
  }

  return (
    <figure
      className={`c-mermaid${className ? ` ${className}` : ''}`}
      aria-label={label ? accessibleText(label) : undefined}
      aria-describedby={hasText ? altId : undefined}
      ref={figureRef}
    >
      <div className={frameClass}>
        {html !== undefined ? (
          <div {...scrollerProps} dangerouslySetInnerHTML={{ __html: html }} />
        ) : children !== undefined ? (
          <div {...scrollerProps}>{children}</div>
        ) : (
          <div className="c-mermaid-pending">{placeholder}</div>
        )}
        {ready && (
          <button type="button" className="c-mermaid-zoom" ref={zoomButton} onClick={() => setOpen(true)} aria-label="放大檢視這張圖" title="放大檢視">
            <ExpandIcon />
            <span className="c-mermaid-zoom-text">放大</span>
          </button>
        )}
      </div>
      {caption && <figcaption className="c-figcaption">{mathText(caption)}</figcaption>}
      {hasText && (
        <FigureDetails id={altId} className="c-diagram-alt" summary="文字版（節點與連線清單）">
          {() => <DiagramTextBody model={resolveModel(chart, textModel)} />}
        </FigureDetails>
      )}
      {open && (
        <DiagramZoom caption={caption} label={label} naturalSize={naturalSize ?? null} onClose={close} html={zoomHtml ?? html}>
          {zoomChildren ?? children}
        </DiagramZoom>
      )}
    </figure>
  )
}

function resolveModel(chart: string | undefined, textModel: DiagramFrameProps['textModel']): DiagramText {
  if (typeof textModel === 'function') return textModel()
  if (textModel) return textModel
  return parseDiagramText(chart ?? '')
}

interface DiagramZoomProps {
  caption?: string
  label?: string
  naturalSize: DiagramSize | null
  html?: string
  children?: ReactNode
  onClose: () => void
}

/** 全螢幕放大檢視（portal 到 <body>）。 */
function DiagramZoom({ caption, label, naturalSize, html, children, onClose }: DiagramZoomProps) {
  const dialog = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLDivElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const [size, setSize] = useState<DiagramSize | null>(naturalSize)
  const [zoom, setZoom] = useState(1)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const fitZoom = useCallback((s: DiagramSize | null): number => {
    const el = canvas.current
    if (!el || !s || !el.clientWidth) return 1
    const pad = 48
    const byWidth = (el.clientWidth - pad) / s.width
    const byHeight = el.clientHeight > pad ? (el.clientHeight - pad) / s.height : byWidth
    return clampZoom(Math.min(byWidth, byHeight))
  }, [])

  // 開啟時：鎖住背景捲動、把焦點移進來、決定初始倍率（至少 100%，小圖最多放大到 1.75 倍）
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    let s = naturalSize
    if (!s) {
      const vb = canvas.current?.querySelector('svg')?.viewBox?.baseVal
      if (vb && vb.width > 0 && vb.height > 0) s = { width: vb.width, height: vb.height }
    }
    setSize(s)
    const el = canvas.current
    if (s && el?.clientWidth) setZoom(clampZoom(Math.min(1.75, Math.max(1, (el.clientWidth - 48) / s.width))))
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [naturalSize])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === '+' || e.key === '=') {
      setZoom((z) => clampZoom(z * ZOOM_STEP))
    } else if (e.key === '-' || e.key === '_') {
      setZoom((z) => clampZoom(z / ZOOM_STEP))
    } else if (e.key === '0') {
      setZoom(1)
    } else if (e.key === 'Tab') {
      // 焦點留在對話框裡
      const items = dialog.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]')
      if (!items || items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  // 滑鼠拖曳平移（觸控裝置直接用手指捲動）
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = canvas.current
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = canvas.current
    if (!el || !drag.current) return
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    canvas.current?.releasePointerCapture?.(e.pointerId)
  }

  const innerStyle = (size ? { '--c-zoom-width': `${Math.round(size.width * zoom)}px` } : {}) as CSSProperties
  const name = label ? accessibleText(label) : '方塊圖'

  return createPortal(
    <div className="c-zoom" role="dialog" aria-modal="true" aria-label={`放大檢視：${name}`} ref={dialog} onKeyDown={onKeyDown}>
      <div className="c-zoom-bar">
        <div className="c-zoom-title">{caption ? mathText(caption) : '方塊圖'}</div>
        <div className="c-zoom-tools">
          <button type="button" className="c-zoom-btn" onClick={() => setZoom((z) => clampZoom(z / ZOOM_STEP))} disabled={zoom <= ZOOM_MIN} aria-label="縮小">
            −
          </button>
          <button type="button" className="c-zoom-btn c-zoom-pct mono" onClick={() => setZoom(1)} aria-label={`目前 ${Math.round(zoom * 100)}%，按一下回到 100%`}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="c-zoom-btn" onClick={() => setZoom((z) => clampZoom(z * ZOOM_STEP))} disabled={zoom >= ZOOM_MAX} aria-label="放大">
            ＋
          </button>
          <button type="button" className="c-zoom-btn" onClick={() => setZoom(fitZoom(size))}>
            符合視窗
          </button>
          <button type="button" className="c-zoom-btn c-zoom-close" onClick={onClose} ref={closeButton}>
            關閉
          </button>
        </div>
      </div>
      <div
        className="c-zoom-canvas"
        ref={canvas}
        tabIndex={0}
        aria-label="圖的內容（可捲動；滑鼠可拖曳）"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {html !== undefined ? (
          <div className="c-zoom-inner" style={innerStyle} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="c-zoom-inner" style={innerStyle}>
            {children}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
