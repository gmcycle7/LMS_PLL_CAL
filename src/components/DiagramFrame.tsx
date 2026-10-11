import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { mathText, stripMathDelimiters } from './Tex'

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

export function DiagramFrame({ caption, ariaLabel, className, ready = true, naturalSize, html, zoomHtml, children, zoomChildren, placeholder, figureRef }: DiagramFrameProps) {
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
    <figure className={`c-mermaid${className ? ` ${className}` : ''}`} aria-label={label ? stripMathDelimiters(label) : undefined} ref={figureRef}>
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
      {open && (
        <DiagramZoom caption={caption} label={label} naturalSize={naturalSize ?? null} onClose={close} html={zoomHtml ?? html}>
          {zoomChildren ?? children}
        </DiagramZoom>
      )}
    </figure>
  )
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
  const name = label ? stripMathDelimiters(label) : '方塊圖'

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
