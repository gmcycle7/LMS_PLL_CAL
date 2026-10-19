import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { useMediaQuery } from '@/app/useMediaQuery'
import { accessibleText, mathText, stripMathDelimiters } from './Tex'
import { revealAnchor, routeWithParam } from './links/anchor'
import { BackToTop } from './BackToTop'
import { badgeClass } from './Tags'
import './PageOutline.css'

/**
 * 本頁目錄（PageFrame 在每一頁掛一個）：從頁面裡的 h2 自動產生，不用各章維護。
 *
 *   - 視窗夠寬（OUTLINE_COLUMN_QUERY）：右側 200px 的 sticky 欄，含 scroll-spy 高亮與「目前這一節讀了幾 %」。
 *     只有在內容欄維持 1080px 的情況下才會出現：側欄 288 + 內容欄左右 padding 64 + 內容欄 1080 + 間距 24 + 右欄 200 + 傳統捲軸 16 = 1672px。
 *     再窄就不擠內容欄（擁有者規則：內容欄不可低於 1080px），改用下面的按鈕。
 *   - 其他寬度：右下角的「目錄」鈕打開底部抽屜（桌機上是右下角的面板），抽屜裡是同一份目錄。
 *   - 最上面固定四個捷徑：實驗（N）／手算（N）／思考題／符號表，從 .c-exp／.c-handcalc／.c-quiz／#symbols 數出來；
 *     按一下跳到「目前位置之後的第一個」，到底了就回到第一個。
 *   - 點目錄項目用 links/anchor.ts 的 revealAnchor：捲過去、展開祖先 <details>、把 ?a=<id> 用 replaceState 寫進網址
 *     （AnchorDeepLink 載入時會還原），href 本身是真的路由網址（'#/ch/05?a=…'），中鍵、複製連結都能用。
 *   - h2 沒有 id：先用最近的祖先 section[id]；再沒有就依標題文字產生穩定的 slug 並寫到 h2 上。
 *     scroll-spy 看的是「id 所在的元素」（target），不是 h2：Section 的 kicker 在 h2 上方約 30px，點了目錄捲到 section 頂端時
 *     h2 還在判定線下面，若 spy 看 h2 就會把上一節標成目前節（98%）。target 與捲動目標一致，點了哪一項就是哪一項。
 *   - 章節是 lazy 載入、圖表延後渲染、學習模式會增減段落：用 MutationObserver 監看容器，h2 的集合變了就重新掃描。
 *   - 浮動的「回到頂端」（BackToTop）放在同一個右下角浮動列；/workbook 右下角已經有「手算工具」鈕，浮動列疊在它上面。
 */

/** 右欄本身的寬度與和內容欄的間距（px；PageOutline.css 的 padding-right = 兩者之和） */
export const OUTLINE_COLUMN_WIDTH = 200
export const OUTLINE_COLUMN_GAP = 24
/** 右欄出現的最小視窗寬度：側欄 + 內容欄 padding + 內容欄 + 間距 + 右欄 + 傳統捲軸（PageOutline.test 會對照 global.css 的 token） */
export const OUTLINE_COLUMN_MIN_WIDTH = 288 + 32 * 2 + 1080 + OUTLINE_COLUMN_GAP + OUTLINE_COLUMN_WIDTH + 16
export const OUTLINE_COLUMN_QUERY = `(min-width: ${OUTLINE_COLUMN_MIN_WIDTH}px)`
/** 少於這麼多節的頁面不顯示目錄（沒有用途） */
export const OUTLINE_MIN_ENTRIES = 3
/** DOM 變動後多久重新掃描一次（Plotly 畫圖時 mutation 很多，合併處理） */
export const OUTLINE_RESCAN_MS = 150
/** 「目前這一節」的判定線：topbar 底下再往下這麼多 px（和 scroll-margin-top 的 16px 相差 8px，捲到之後剛好算作目前節） */
export const OUTLINE_LINE_OFFSET = 24

export type OutlineLayout = 'column' | 'dock'

export interface OutlineEntry {
  /** 捲動目標的 id（h2 自己的、祖先 section 的，或產生的 slug） */
  id: string
  /** 標題文字；KaTeX 的部分還原成 $…$（顯示時再交給 mathText） */
  label: string
  /** 目錄文字來源的 h2 */
  heading: HTMLElement
  /** 捲動與 scroll-spy 的目標：id 所在的元素（h2 自己，或 h2 沒有 id 時最近的祖先 section[id]） */
  target: HTMLElement
}

export interface OutlineShortcuts {
  exp: string[]
  handcalc: string[]
  quiz: string[]
  symbols: string | null
}

export interface OutlineModel {
  entries: OutlineEntry[]
  shortcuts: OutlineShortcuts
  /** 右下角已經有別的浮動鈕（/workbook 的手算工具）：浮動列要往上疊 */
  aboveTool: boolean
}

/* ───────────── 純函式（測試用） ───────────── */

/** 標題裡不算進目錄文字的東西：提示氣泡、按鈕、圖示 */
const LABEL_SKIP = 'button, .c-tip, .c-sr-only, script, style, svg'

/** h2 的文字：KaTeX 還原成 `$tex$`（從 annotation 拿 TeX 原始碼），略過按鈕與提示氣泡，空白合併 */
export function headingLabel(heading: Element): string {
  const parts: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '')
      return
    }
    if (!(node instanceof Element)) return
    if (node.matches(LABEL_SKIP)) return
    if (node.classList.contains('katex')) {
      const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
      parts.push(tex ? `$${tex}$` : (node.querySelector('.katex-html')?.textContent ?? node.textContent ?? ''))
      return
    }
    node.childNodes.forEach(walk)
  }
  walk(heading)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/** 標題文字 → 穩定的 id 片段：NFKC、小寫、字母與數字以外全部換成 '-'，最長 48 字元 */
export function slugify(text: string): string {
  const s = stripMathDelimiters(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 48).replace(/-+$/, '') || 'section'
}

/** el 沒有 id 時給它一個（base、base-2、base-3…，不和頁面上既有的 id 撞） */
function ensureId(el: HTMLElement, base: string): string {
  if (el.id) return el.id
  let id = base
  for (let n = 2; document.getElementById(id) && document.getElementById(id) !== el; n++) id = `${base}-${n}`
  el.id = id
  return id
}

/** 從容器掃出目錄：h2（略過模式選擇器、目錄自己、放大檢視）與四種捷徑的目標 id */
export function collectOutline(root: ParentNode): OutlineModel {
  const used = new Set<string>()
  const entries: OutlineEntry[] = []
  for (const h of Array.from(root.querySelectorAll<HTMLElement>('h2'))) {
    if (h.closest('.c-modepicker, .c-outline, .c-zoom')) continue
    const label = headingLabel(h)
    let id = h.id
    let target: HTMLElement = h
    if (!id) {
      const section = h.closest<HTMLElement>('section[id]')
      if (section && !used.has(section.id)) {
        id = section.id
        target = section
      } else {
        const base = `h-${slugify(label)}`
        id = base
        for (let n = 2; used.has(id) || (document.getElementById(id) && document.getElementById(id) !== h); n++) id = `${base}-${n}`
        h.id = id
      }
    }
    // h2 自己的 id 和前面的項目重複（不合法的 HTML）：不改章節自己的 id，兩項都指向同一個目標
    used.add(id)
    entries.push({ id, label, heading: h, target })
  }
  const ids = (selector: string, base: string) => Array.from(root.querySelectorAll<HTMLElement>(selector)).map((el, i) => ensureId(el, `${base}-${i + 1}`))
  const symbols = root.querySelector<HTMLElement>('#symbols')
  return {
    entries,
    shortcuts: { exp: ids('.c-exp', 'exp'), handcalc: ids('.c-handcalc', 'handcalc'), quiz: ids('.c-quiz', 'quiz'), symbols: symbols ? symbols.id : null },
    aboveTool: !!root.querySelector('.wb-dock'),
  }
}

function sameModel(a: OutlineModel | null, b: OutlineModel): boolean {
  if (!a || a.aboveTool !== b.aboveTool || a.entries.length !== b.entries.length) return false
  for (let i = 0; i < a.entries.length; i++) {
    const x = a.entries[i]
    const y = b.entries[i]
    if (x.id !== y.id || x.label !== y.label || x.heading !== y.heading || x.target !== y.target) return false
  }
  const s = a.shortcuts
  const t = b.shortcuts
  return s.symbols === t.symbols && s.exp.join() === t.exp.join() && s.handcalc.join() === t.handcalc.join() && s.quiz.join() === t.quiz.join()
}

/** 目前這一節 = 文件順序裡最後一個「頂端在判定線之上」的標題；沒有（還在章首）就是 -1。NaN 的 top（沒有版面）略過。 */
export function currentIndex(tops: readonly number[], line: number): number {
  let idx = -1
  for (let i = 0; i < tops.length; i++) if (Number.isFinite(tops[i]) && tops[i] <= line) idx = i
  return idx
}

/** 目前這一節讀了幾 %：判定線在 [top, nextTop] 之間的位置，夾在 0–100 */
export function sectionProgress(top: number, nextTop: number, line: number): number {
  const span = nextTop - top
  if (!(span > 0)) return 0
  return Math.max(0, Math.min(100, Math.round(((line - top) / span) * 100)))
}

/** 固定 topbar 的高度（global.css 的 --topbar-h；jsdom 讀不到時 52） */
function topbarHeight(): number {
  try {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'))
    return Number.isFinite(v) ? v : 52
  } catch {
    return 52
  }
}

function readingLine(): number {
  return topbarHeight() + OUTLINE_LINE_OFFSET
}

/** 元素有版面時回傳它的 top；沒有（display:none、jsdom）回傳 fallback */
function topOf(el: Element, fallback: number): number {
  const r = el.getBoundingClientRect()
  return r.width === 0 && r.height === 0 ? fallback : r.top
}

/** 修飾鍵／非左鍵的點擊交給瀏覽器（新分頁、另存…），不攔截 */
function isPlainLeftClick(e: ReactMouseEvent): boolean {
  return !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/* ───────────── 元件 ───────────── */

export interface PageOutlineProps {
  /** 要掃描的容器（PageFrame 的 <article>）：h2 與捷徑都從它裡面找 */
  root: RefObject<HTMLElement>
  /** 換頁時重新掃描 */
  pageKey: string
  /** 目前的版面（右欄／按鈕）或 null（本頁太短，不顯示）：PageFrame 用它設定 article 的 data-outline */
  onLayout?: (layout: OutlineLayout | null) => void
}

export function PageOutline({ root, pageKey, onLayout }: PageOutlineProps) {
  const [model, setModel] = useState<OutlineModel | null>(null)
  const [current, setCurrent] = useState(-1)
  const [pct, setPct] = useState(0)
  const [open, setOpen] = useState(false)
  const column = useMediaQuery(OUTLINE_COLUMN_QUERY)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const { pathname, search } = useLocation()
  const route = `${pathname}${search}`

  // 還沒掃描（model 是 null）時先當作本頁有目錄：寬螢幕一開始就把右欄的位置讓出來。掃描在 passive effect 裡，
  // 大章節第一次畫出來之後才會跑；若等掃完才讓位，內容欄會先置中畫一次、0.3 s 後整個往左跳 112px（實測 1700px：454 → 342）。
  // 掃完發現不到 OUTLINE_MIN_ENTRIES 節才收回（目前每一頁都 ≥ 7 節，所以實際上不會收回）。
  const shown = model ? model.entries.length >= OUTLINE_MIN_ENTRIES : true
  const layout: OutlineLayout | null = shown ? (column ? 'column' : 'dock') : null

  // layout effect：PageFrame 的 setState 在瀏覽器畫之前就同步處理，data-outline 和章節同一個 frame 出現
  useLayoutEffect(() => {
    onLayout?.(layout)
  }, [layout, onLayout])

  // 掃描 h2 與捷徑；DOM 變了（章節載入、模式切換、延後渲染）就重掃，集合沒變就不重畫
  useEffect(() => {
    const el = root.current
    if (!el) return
    let timer: number | null = null
    const scan = () => {
      timer = null
      const next = collectOutline(el)
      setModel((prev) => (sameModel(prev, next) ? prev : next))
    }
    scan()
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      if (timer === null) timer = window.setTimeout(scan, OUTLINE_RESCAN_MS)
    })
    mo?.observe(el, { childList: true, subtree: true })
    return () => {
      mo?.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [root, pageKey])

  // 換頁：抽屜關掉、目前節歸零
  useEffect(() => {
    setOpen(false)
    setCurrent(-1)
    setPct(0)
  }, [pageKey])

  // scroll-spy：IntersectionObserver 看每一項的目標（h2 或祖先 section，和點擊捲到的是同一個元素）何時越過判定線
  // （延後渲染的圖把它推開時也會觸發），捲動時（每個 frame 最多一次）重新量；沒有版面的目標（收合的 <details>、jsdom）用 IO 回報的位置
  useEffect(() => {
    if (!shown || !model) return
    const targets = model.entries.map((e) => e.target)
    const reported = new Map<Element, number>()
    let raf: number | null = null
    const compute = () => {
      raf = null
      const line = readingLine()
      const tops = targets.map((t) => topOf(t, reported.get(t) ?? NaN))
      const idx = currentIndex(tops, line)
      setCurrent(idx)
      if (idx < 0) {
        setPct(0)
        return
      }
      let next = NaN
      for (let i = idx + 1; i < tops.length && !Number.isFinite(next); i++) next = tops[i]
      if (!Number.isFinite(next)) next = root.current ? topOf(root.current, NaN) + (root.current.getBoundingClientRect().height || 0) : NaN
      setPct(sectionProgress(tops[idx], next, line))
    }
    const schedule = () => {
      if (raf !== null) return
      raf = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(compute) : window.setTimeout(compute, 16)
    }
    let io: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      const line = readingLine()
      io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const r = en.boundingClientRect
            if (r.width === 0 && r.height === 0) reported.delete(en.target)
            else reported.set(en.target, r.top)
          }
          compute()
        },
        // 根區域 = 視窗頂端到判定線：目標進出這個區域（也就是越過判定線）時回報
        { rootMargin: `0px 0px -${Math.max(0, window.innerHeight - line)}px 0px`, threshold: 0 },
      )
      for (const t of targets) io.observe(t)
    }
    compute()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      io?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf !== null) {
        if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(raf)
        window.clearTimeout(raf)
      }
    }
  }, [shown, model, root])

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) toggleRef.current?.focus()
  }, [])

  // 抽屜打開：焦點移到第一個捷徑（不是「關閉」鈕）；Esc 關閉並把焦點還給「目錄」鈕
  useEffect(() => {
    if (!open) return
    sheetRef.current?.querySelector('.c-outline-body')?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  // 抽屜是 modal：Tab 在裡面循環
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !sheetRef.current) return
    const items = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
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

  /** 捷徑：跳到目前位置之後的第一個，到底了就回到第一個 */
  const jumpNext = useCallback(
    (ids: string[]) => {
      const line = readingLine()
      let target = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = topOf(el, NaN)
        if (Number.isFinite(top) && top > line + 2) {
          target = id
          break
        }
      }
      if (target && revealAnchor(target, { param: 'a', value: target })) setOpen(false)
    },
    [],
  )

  const onEntryClick = useCallback((e: ReactMouseEvent<HTMLAnchorElement>, id: string) => {
    if (!isPlainLeftClick(e)) return
    if (revealAnchor(id, { param: 'a', value: id })) {
      e.preventDefault()
      setOpen(false)
    }
  }, [])

  // 標題裡的 KaTeX 只排版一次（捲動時百分比每變 1% 就重畫一次清單）
  const labels = useMemo(() => (model ? model.entries.map((e) => mathText(e.label)) : []), [model])

  if (!shown || !model) return null
  const { entries, shortcuts } = model
  const symbolsId = shortcuts.symbols
  const cur = current < entries.length ? current : -1

  const counter = cur >= 0 ? `${cur + 1}／${entries.length} 節` : `${entries.length} 節`
  /** 右欄與抽屜共用的內容；抽屜自己有標題列（含節數），所以不再放一次表頭 */
  const renderBody = (withHead: boolean) => (
    <div className="c-outline-body">
      {withHead && (
        <div className="c-outline-head">
          <span>本頁目錄</span>
          <span>{counter}</span>
        </div>
      )}
      <div className="c-outline-shortcuts" role="group" aria-label="捷徑">
        {shortcuts.exp.length > 0 && (
          <button type="button" className={badgeClass('neutral', 'c-outline-chip')} onClick={() => jumpNext(shortcuts.exp)}>
            實驗（{shortcuts.exp.length}）
          </button>
        )}
        {shortcuts.handcalc.length > 0 && (
          <button type="button" className={badgeClass('neutral', 'c-outline-chip')} onClick={() => jumpNext(shortcuts.handcalc)}>
            手算（{shortcuts.handcalc.length}）
          </button>
        )}
        {shortcuts.quiz.length > 0 && (
          <button type="button" className={badgeClass('neutral', 'c-outline-chip')} onClick={() => jumpNext(shortcuts.quiz)}>
            思考題
          </button>
        )}
        {symbolsId && (
          <button type="button" className={badgeClass('neutral', 'c-outline-chip')} onClick={() => jumpNext([symbolsId])}>
            符號表
          </button>
        )}
      </div>
      <ol className="c-outline-list">
        {entries.map((e, i) => (
          <li key={`${i}:${e.id}`}>
            <a
              href={routeWithParam(route, 'a', e.id)}
              aria-current={i === cur ? 'location' : undefined}
              title={accessibleText(e.label)}
              onClick={(ev) => onEntryClick(ev, e.id)}
            >
              <span className="c-outline-label">{labels[i]}</span>
              {i === cur && (
                <span className="c-outline-pct" aria-hidden="true">
                  {pct}%
                </span>
              )}
            </a>
          </li>
        ))}
      </ol>
    </div>
  )

  return (
    <>
      {layout === 'column' && (
        <nav className="c-outline c-outline-col" aria-label="本頁目錄">
          {renderBody(true)}
        </nav>
      )}
      <div className={`c-outline-dock${model.aboveTool ? ' c-outline-dock-raised' : ''}`}>
        <BackToTop />
        {layout === 'dock' && (
          <button
            type="button"
            className="btn c-outline-open"
            ref={toggleRef}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? 'c-outline-sheet' : undefined}
            onClick={() => (open ? close(true) : setOpen(true))}
          >
            目錄
          </button>
        )}
      </div>
      {layout === 'dock' && open && (
        <>
          <div className="c-outline-scrim" onClick={() => close(true)} aria-hidden="true" />
          <div
            className="c-outline c-outline-sheet"
            id="c-outline-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="c-outline-sheet-title"
            ref={sheetRef}
            onKeyDown={trapTab}
          >
            <div className="c-outline-sheet-head">
              <span className="c-outline-sheet-title" id="c-outline-sheet-title">
                本頁目錄 <span className="c-outline-sheet-count">{counter}</span>
              </span>
              <button type="button" className="btn" onClick={() => close(true)}>
                關閉
              </button>
            </div>
            {renderBody(false)}
          </div>
        </>
      )}
    </>
  )
}
