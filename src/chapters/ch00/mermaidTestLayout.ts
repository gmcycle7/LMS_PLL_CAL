/**
 * 測試用：讓 mermaid 的 renderer 在 jsdom 裡也能完整跑完，並粗估圖畫出來的尺寸（只給 diagrams.test.tsx 用，不進網站）。
 *
 * jsdom 沒有版面引擎：SVG 的 getBBox() 不存在、getBoundingClientRect() 一律回傳 0。mermaid 需要這兩個量測函式
 * 才能算出每個方塊的大小、交給 dagre 排版。這裡用「每個字大約多寬」的簡單字寬模型代替真正的字型量測：
 *   - 中日韓文字、全形標點、圈號數字：16 px；大寫拉丁字母：10.5 px；空白：4.5 px；其餘（小寫、數字、希臘字母、符號）：8.8 px；
 *   - 一行 24 px 高；超過 200 px 的標籤會被 mermaid 折行（和瀏覽器裡的行為相同：max-width 200 px）。
 * 含公式（`$...$`）的標籤由 KaTeX 排版：KaTeX 不折行（white-space: nowrap），字體是外層的 1.21 倍，
 * `<br/>` 分行的標籤是 gathered 環境的逐列排列；所以這裡把 KaTeX 的 HTML 輸出（去掉 MathML 複本）逐列量，字寬乘 1.21、
 * 運算符號兩側再加間距，且不套用 200 px 的折行上限——超過 200 px 的列要由測試明確擋下來（否則在瀏覽器裡會被裁掉）。
 * 這是估計值（實際字型通常再窄一點），足以分辨「一張 900 px 的圖」和「一張 1800 px、在頁面上被縮到六成的圖」。
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** mermaid 的 HTML 標籤在這個寬度折行。 */
export const LABEL_WRAP_PX = 200
const LINE_HEIGHT_PX = 24

function charWidth(ch: string): number {
  if (/[\u2E80-\u9FFF\uFF00-\uFFEF\u3000-\u303F\u2460-\u2473]/.test(ch)) return 16
  if (/[A-Z]/.test(ch)) return 10.5
  if (ch === ' ') return 4.5
  return 8.8
}

/** 一段文字（不含換行）的估計寬度（px）。 */
export function textWidth(text: string): number {
  return [...text].reduce((s, c) => s + charWidth(c), 0)
}

const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** 標籤（含 <br/>）各行的估計寬度。 */
export function lineWidths(labelHtml: string): number[] {
  return labelHtml.split(/<br\s*\/?>/i).map((l) => textWidth(plain(l)))
}

/** KaTeX 的字體是外層字體的 1.21 倍（`.katex { font-size: 1.21em }`）。 */
const KATEX_SCALE = 1.21
/** KaTeX 一列（gathered 的一行）的估計高度：行高 1.2 × 1.21 × 16 px 再加列距。 */
const KATEX_ROW_HEIGHT_PX = 28
/** 二元運算子與關係符號：KaTeX 在兩側各加約 0.22–0.28em 的間距。 */
const SPACED_OPERATOR = /[=+−×÷±≤≥≠≈∝→←⇒⇐↔·]/g

/** KaTeX 排版的一列文字（HTML 輸出的文字內容，不含 MathML 複本）的估計寬度（px）。 */
export function katexTextWidth(text: string): number {
  const t = text.replace(/\u200b/g, '').replace(/\u00a0/g, ' ')
  const operators = (t.match(SPACED_OPERATOR) ?? []).length
  return (textWidth(t) + operators * 0.5 * 8.8) * KATEX_SCALE
}

/** KaTeX HTML 輸出的每一列文字：`gathered`（<br/> 分行）有幾列就回傳幾項，否則整個公式是一列。 */
function katexRows(html: Element): string[] {
  const column = html.querySelector('.mtable > .col-align-c > .vlist-t > .vlist-r > .vlist')
  const rows = column ? [...column.children].map((r) => r.textContent ?? '') : []
  return rows.length > 0 ? rows : [html.textContent ?? '']
}

function measureHtml(el: Element): { width: number; height: number } {
  const katex = el.querySelector('.katex-html')
  if (katex) {
    const rows = katexRows(katex)
    return { width: Math.max(0, ...rows.map(katexTextWidth)), height: rows.length * KATEX_ROW_HEIGHT_PX }
  }
  const widths = lineWidths(el.innerHTML)
  // mermaid 先以 nowrap + max-width 量一次；量到剛好等於 max-width 時，改成固定寬度並允許折行，再量一次
  const wrapped = new RegExp(`(?<![-\\w])width:\\s*${LABEL_WRAP_PX}px`).test(el.getAttribute('style') ?? '')
  if (!wrapped) return { width: Math.min(Math.max(0, ...widths), LABEL_WRAP_PX), height: widths.length * LINE_HEIGHT_PX }
  return { width: LABEL_WRAP_PX, height: widths.reduce((s, w) => s + Math.max(1, Math.ceil(w / LABEL_WRAP_PX)), 0) * LINE_HEIGHT_PX }
}

const attr = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0) || 0

function translateOf(el: Element): [number, number] {
  const m = /translate\(\s*([-\d.e]+)[ ,]*([-\d.e]+)?\s*\)/.exec(el.getAttribute('transform') ?? '')
  return m ? [Number(m[1]) || 0, Number(m[2] ?? 0) || 0] : [0, 0]
}

function union(boxes: Box[]): Box {
  const b = boxes.filter((v) => v.width > 0 || v.height > 0)
  if (!b.length) return { x: 0, y: 0, width: 0, height: 0 }
  const x0 = Math.min(...b.map((v) => v.x))
  const y0 = Math.min(...b.map((v) => v.y))
  const x1 = Math.max(...b.map((v) => v.x + v.width))
  const y1 = Math.max(...b.map((v) => v.y + v.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

const EMPTY: Box = { x: 0, y: 0, width: 0, height: 0 }

/** SVG 元素的 bounding box：基本形狀看屬性，群組取子元素（套用各自的 translate）的聯集。 */
function bboxOf(el: Element): Box {
  const tag = el.tagName.toLowerCase()
  if (tag === 'rect' || tag === 'foreignobject' || tag === 'image') return { x: attr(el, 'x'), y: attr(el, 'y'), width: attr(el, 'width'), height: attr(el, 'height') }
  if (tag === 'circle') return { x: attr(el, 'cx') - attr(el, 'r'), y: attr(el, 'cy') - attr(el, 'r'), width: 2 * attr(el, 'r'), height: 2 * attr(el, 'r') }
  if (tag === 'ellipse') return { x: attr(el, 'cx') - attr(el, 'rx'), y: attr(el, 'cy') - attr(el, 'ry'), width: 2 * attr(el, 'rx'), height: 2 * attr(el, 'ry') }
  if (tag === 'polygon' || tag === 'polyline' || tag === 'path' || tag === 'line') {
    const src = tag === 'line' ? `${attr(el, 'x1')} ${attr(el, 'y1')} ${attr(el, 'x2')} ${attr(el, 'y2')}` : (el.getAttribute(tag === 'path' ? 'd' : 'points') ?? '')
    const n = (src.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    const xs = n.filter((_, i) => i % 2 === 0)
    const ys = n.filter((_, i) => i % 2 === 1)
    if (!xs.length || !ys.length) return EMPTY
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  if (tag === 'text' || tag === 'tspan') return { x: 0, y: -16, width: textWidth(el.textContent ?? ''), height: 20 }
  if (tag === 'defs' || tag === 'style' || tag === 'marker' || tag === 'title' || tag === 'desc') return EMPTY
  return union(
    [...el.children].map((c) => {
      const b = bboxOf(c)
      const [tx, ty] = translateOf(c)
      return { x: b.x + tx, y: b.y + ty, width: b.width, height: b.height }
    }),
  )
}

/** 把估計用的量測函式裝到 jsdom 的原型上（在 beforeAll 呼叫一次）。 */
export function installMermaidLayoutStubs(): void {
  const svgProto = SVGElement.prototype as unknown as Record<string, unknown>
  svgProto.getBBox = function getBBox(this: Element): Box {
    return bboxOf(this)
  }
  svgProto.getComputedTextLength = function getComputedTextLength(this: Element): number {
    return bboxOf(this).width
  }
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
    const m = measureHtml(this)
    return { x: 0, y: 0, top: 0, left: 0, right: m.width, bottom: m.height, width: m.width, height: m.height, toJSON: () => ({}) } as DOMRect
  }
}

/** mermaid 畫出來的 SVG 的自然尺寸（viewBox 的寬、高，px）。 */
export function svgNaturalSize(svg: string): { width: number; height: number } {
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number) ?? []
  return { width: vb[2] ?? Number.NaN, height: vb[3] ?? Number.NaN }
}
