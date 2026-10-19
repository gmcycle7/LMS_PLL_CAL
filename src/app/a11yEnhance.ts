import { texToSpeech } from '@/components/speech'

/**
 * 表格的無障礙補強（安全網）：共用元件（MetricTable、SymbolTable、公式速查頁的 TableWrap）自己會給 <caption> 與 scope，
 * 但各章／各頁有上百張手寫的 <table>。這裡在 Layout 的 <main> 上掃一遍，補上：
 *
 * 1. 沒有 <caption> 的表格：插入一個視覺隱藏（c-sr-only）的 <caption>，內容是「表格：<最近的上一個標題>」
 *    （表格在 <figure> 裡時用 <figcaption>）；同一個標題底下有好幾張就加「（第 n 張）」。
 *    這種自動產生的 caption 帶 `data-auto-caption`，之後標題或表格數量變了會重新計算；作者自己寫的 caption 一律不動。
 * 2. 沒有 scope 的 <th>：在 <thead> 裡、或整列都是 <th> 的 → `col`；在 <tbody> 且是該列第一格、同列還有 <td> → `row`。
 *
 * 只改屬性與插入 <caption>（React 管理子節點時用 insertBefore／appendChild，不依賴位置，所以不會衝突）。
 * 重複執行不會再有變動（idempotent）。純 DOM 函式，沒有 React，jsdom 可測。
 */

export const AUTO_CAPTION_ATTR = 'data-auto-caption'
const MAX_CONTEXT = 60

/** 一個元素的「可念文字」：KaTeX 換成 texToSpeech、略過 tooltip／按鈕／sr-only，空白收斂 */
export function spokenText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('button, .c-tip, .c-sr-only, script, style, svg').forEach((n) => n.remove())
  clone.querySelectorAll('.katex').forEach((k) => {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? ''
    k.replaceWith(clone.ownerDocument.createTextNode(tex ? ` ${texToSpeech(tex)} ` : ' '))
  })
  const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT - 1)}…` : text
}

function contextOf(table: Element, headings: Element[]): string {
  const fig = table.closest('figure')
  const figcap = fig?.querySelector('figcaption')
  if (figcap) {
    const t = spokenText(figcap)
    if (t) return t
  }
  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const t = spokenText(headings[i])
      if (t) return t
    }
  }
  return ''
}

function autoCaption(table: HTMLTableElement): HTMLTableCaptionElement | null {
  const cap = table.querySelector(':scope > caption')
  return cap && cap.hasAttribute(AUTO_CAPTION_ATTR) ? (cap as HTMLTableCaptionElement) : null
}

/** 補 caption 與 scope。回傳這次實際改了幾處（測試用；0 表示已經是完整的） */
export function enhanceTables(root: ParentNode): number {
  let changes = 0
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>('table')).filter((t) => {
    const role = t.getAttribute('role')
    return role !== 'presentation' && role !== 'none'
  })
  const headings = tables.length ? Array.from(root.querySelectorAll('h1, h2, h3, h4, h5')) : []
  const seen = new Map<string, number>()
  const totals = new Map<string, number>()
  const wanted: { table: HTMLTableElement; ctx: string }[] = []

  for (const table of tables) {
    const own = table.querySelector(':scope > caption')
    if (own && !own.hasAttribute(AUTO_CAPTION_ATTR)) continue // 作者自己寫的 caption
    const ctx = contextOf(table, headings)
    wanted.push({ table, ctx })
    totals.set(ctx, (totals.get(ctx) ?? 0) + 1)
  }
  for (const { table, ctx } of wanted) {
    const n = (seen.get(ctx) ?? 0) + 1
    seen.set(ctx, n)
    const base = ctx ? `表格：${ctx}` : '資料表格'
    const text = (totals.get(ctx) ?? 1) > 1 ? `${base}（第 ${n} 張）` : base
    let cap = autoCaption(table)
    if (!cap) {
      cap = table.ownerDocument.createElement('caption')
      cap.className = 'c-sr-only'
      cap.setAttribute(AUTO_CAPTION_ATTR, '')
      table.insertBefore(cap, table.firstChild)
      cap.textContent = text
      changes++
    } else if (cap.textContent !== text) {
      cap.textContent = text
      changes++
    }
  }

  for (const table of tables) {
    for (const th of Array.from(table.querySelectorAll('th'))) {
      if (th.closest('table') !== table || th.hasAttribute('scope')) continue
      const row = th.parentElement
      let scope: 'col' | 'row' = 'col'
      if (row && !th.closest('thead') && row.firstElementChild === th && row.querySelector(':scope > td')) scope = 'row'
      th.setAttribute('scope', scope)
      changes++
    }
  }
  return changes
}

/** 橫向只超出這麼多 px 以內的 `.table-wrap` 不算「可捲動」（同 ScrollRegion 的 TINY_OVERFLOW_PX） */
export const TINY_SCROLL_PX = 6

/**
 * 各章手寫的 `<div className="table-wrap">`（不是 ScrollRegion）也一樣：橫向只超出 1–6px（padding、四捨五入）時標 `data-tiny="true"`，
 * components.css 對它設 `overflow-x: hidden`——一條只能捲幾 px 的捲軸沒有用途。超出更多、或直向超出就移除標記。
 * ScrollRegion（`.c-scroll`）自己會標，這裡略過。回傳這次實際改了幾處。
 */
export function markTinyScroll(root: ParentNode): number {
  let changes = 0
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.table-wrap:not(.c-scroll)'))) {
    const dx = el.scrollWidth - el.clientWidth
    const dy = el.scrollHeight - el.clientHeight
    const tiny = dx > 0 && dx <= TINY_SCROLL_PX && dy <= 2
    if (tiny && el.getAttribute('data-tiny') !== 'true') {
      el.setAttribute('data-tiny', 'true')
      changes++
    } else if (!tiny && el.hasAttribute('data-tiny')) {
      el.removeAttribute('data-tiny')
      changes++
    }
  }
  return changes
}

/**
 * 在 root 底下監看 DOM：內容載入、換頁、展開 details 後補強新出現的表格。
 * 至多每 200ms 掃一次（圖表、方塊圖、KaTeX 渲染時 DOM 變動很頻繁）；視窗大小改變時也重量一次 `data-tiny`。回傳停止函式。
 */
export function watchA11y(root: HTMLElement, delayMs = 200): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    timer = null
    enhanceTables(root)
    markTinyScroll(root)
  }
  const schedule = () => {
    if (timer === null) timer = setTimeout(run, delayMs)
  }
  enhanceTables(root)
  markTinyScroll(root)
  if (typeof MutationObserver === 'undefined') return () => {}
  const mo = new MutationObserver(schedule)
  mo.observe(root, { childList: true, subtree: true })
  window.addEventListener('resize', schedule)
  return () => {
    mo.disconnect()
    window.removeEventListener('resize', schedule)
    if (timer !== null) clearTimeout(timer)
  }
}
