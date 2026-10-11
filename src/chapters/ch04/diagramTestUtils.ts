/**
 * Ch04 方塊圖測試的輔助工具（只給 diagrams.test.tsx 用，頁面不會匯入）。
 *
 * 為什麼需要「真的畫出來」：mermaid.parse() 只檢查語法。Mermaid 11 會把每個標籤當成 Markdown 處理，
 * 以 ASCII「+ 」「- 」「1. 」開頭的標籤語法完全合法，畫面上卻變成「Unsupported markdown: list」；
 * 成對的 * 或 _ 會被當成斜體而吃掉符號。這些只有實際渲染才看得到。
 *
 * jsdom 沒有版面引擎（getBBox / getBoundingClientRect 都回傳 0），所以這裡用「估計的字寬」補上量測函式：
 * 版面不是像素級精確，但節點大小、欄數、整張圖的寬高都在正確的量級，足以檢查
 *  (1) 每個標籤的文字原封不動出現在 SVG 裡；(2) classDef 的顏色有套到節點；(3) 圖的自然寬度沒有超過正文欄太多。
 *
 * 標籤裡的數學寫成 `$...$`（共用 Mermaid 元件以 KaTeX 排版）：這裡的量測函式會略過 KaTeX 的 MathML 複本、
 * 把 `\cr` 分行的公式當成多行來估計尺寸；另外提供「圖原始碼裡 `$...$` 以外還有沒有 Unicode 拼的數學」的檢查。
 */
import { unicodeMathIn } from '@/components/mermaidTestUtils'

/** 一個字元在 16 px 無襯線字型下的估計寬度（px）。CJK／全形字固定 16 px。 */
export function charWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  if (c === 0x0304 || c === 0x200b) return 0 // 組合用上橫線（x̄、ε̄）、KaTeX 在上下標之間放的零寬空白
  if (c >= 0x2e80 || (c >= 0x2460 && c <= 0x24ff)) return 16 // CJK、全形符號、①②
  if (" ijltfr.,;:|!'()[]{}·/".includes(ch)) return 4.8
  if (ch >= '0' && ch <= '9') return 9
  if (ch >= 'A' && ch <= 'Z') return 10.6
  if (ch >= 'a' && ch <= 'z') return 8.7
  if ('₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹⁻'.includes(ch)) return 6
  return 9.5 // 希臘字母、數學符號
}

export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charWidth(ch)
  return w
}

/** Mermaid flowchart 標籤的自動換行寬度（flowchart.wrappingWidth 的預設值）。 */
export const WRAP_WIDTH = 200

/** 把標籤依 <br/> 拆成視覺上的一行一行（去掉其他 HTML 標籤）。 */
export function labelLines(label: string): string[] {
  return label
    .split(/<br\s*\/?>/i)
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter((l) => l.length > 0)
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

const num = (el: Element, attr: string): number => parseFloat(el.getAttribute(attr) ?? '0') || 0

function translateOf(el: Element): [number, number] {
  const t = el.getAttribute('transform')
  const m = t ? /translate\(\s*(-?[\d.eE+-]+)(?:[ ,]+(-?[\d.eE+-]+))?\s*\)/.exec(t) : null
  return m ? [parseFloat(m[1]) || 0, parseFloat(m[2] ?? '0') || 0] : [0, 0]
}

function fromPoints(pts: number[][]): Box | null {
  if (!pts.length) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** SVG 元素在自己座標系內的 bounding box（由屬性與子元素遞迴估計；空的群組回傳 null）。 */
function bboxOf(el: Element): Box | null {
  const tag = el.tagName.toLowerCase()
  if (tag === 'rect' || tag === 'foreignobject') return { x: num(el, 'x'), y: num(el, 'y'), width: num(el, 'width'), height: num(el, 'height') }
  if (tag === 'circle') {
    const r = num(el, 'r')
    return { x: num(el, 'cx') - r, y: num(el, 'cy') - r, width: 2 * r, height: 2 * r }
  }
  if (tag === 'polygon') {
    const pts = (el.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p.split(',').map(Number))
    return fromPoints(pts)
  }
  if (tag === 'line') {
    return fromPoints([
      [num(el, 'x1'), num(el, 'y1')],
      [num(el, 'x2'), num(el, 'y2')],
    ])
  }
  if (tag === 'path') {
    const nums = (el.getAttribute('d') ?? '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
    const pts: number[][] = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
    return fromPoints(pts)
  }
  if (tag === 'text') {
    const spans = Array.from(el.querySelectorAll('tspan'))
    const rows = spans.length ? Math.max(1, new Set(spans.map((s) => `${s.getAttribute('dy')}|${s.getAttribute('y')}`)).size) : 1
    const width = spans.length ? Math.max(...spans.map((s) => textWidth(s.textContent ?? ''))) : textWidth(el.textContent ?? '')
    const height = rows * 19
    const middle = (el.getAttribute('text-anchor') ?? el.getAttribute('style') ?? '').includes('middle')
    return { x: num(el, 'x') - (middle ? width / 2 : 0), y: num(el, 'y') - height * 0.8, width, height }
  }
  if (tag === 'tspan') return { x: 0, y: 0, width: textWidth(el.textContent ?? ''), height: 19 }
  if (tag === 'style' || tag === 'defs' || tag === 'marker') return null
  let out: Box | null = null
  for (const child of Array.from(el.children)) {
    const b = bboxOf(child)
    if (!b) continue
    const [tx, ty] = translateOf(child)
    const x0 = b.x + tx
    const y0 = b.y + ty
    if (!out) {
      out = { x: x0, y: y0, width: b.width, height: b.height }
      continue
    }
    const left = Math.min(out.x, x0)
    const top = Math.min(out.y, y0)
    const right = Math.max(out.x + out.width, x0 + b.width)
    const bottom = Math.max(out.y + out.height, y0 + b.height)
    out = { x: left, y: top, width: right - left, height: bottom - top }
  }
  return out
}

/**
 * KaTeX 標籤的各行文字（拿掉 MathML 複本；`\\cr` 分行的 gathered 環境每一列算一行）。不含公式的元素回傳 null。
 */
function katexRows(el: Element): string[] | null {
  if (!el.querySelector('.katex')) return null
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  const rows = Array.from(copy.querySelectorAll('.mtable > .col-align-c > .vlist-t > .vlist-r > .vlist > span'))
  return rows.length ? rows.map((r) => r.textContent ?? '') : [copy.textContent ?? '']
}

/** HTML 標籤（foreignObject 內的 div）的估計大小：依 <br> 分行，超過 WRAP_WIDTH 的行再自動折行；KaTeX 公式不會自動折行。 */
function htmlLabelSize(el: Element): { width: number; height: number } {
  const math = katexRows(el)
  if (math) {
    const widths = math.map((t) => textWidth(t))
    return { width: Math.max(0, ...widths), height: Math.max(1, math.length) * 24 }
  }
  const lines = labelLines(el.innerHTML.replace(/&[a-z]+;/g, 'x'))
  if (!lines.length) return { width: 0, height: 0 }
  let width = 0
  let rows = 0
  for (const line of lines) {
    const w = textWidth(line)
    if (w > WRAP_WIDTH) {
      rows += Math.ceil(w / WRAP_WIDTH)
      width = WRAP_WIDTH
    } else {
      rows += 1
      width = Math.max(width, w)
    }
  }
  return { width, height: rows * 24 }
}

type Measurable = Record<string, unknown>

/**
 * 在 jsdom 補上 Mermaid 排版需要的量測函式（getBBox、getComputedTextLength、getBoundingClientRect）。
 * 回傳還原函式。只在測試檔內呼叫。
 */
export function installSvgMeasurePolyfill(): () => void {
  const g = globalThis as unknown as { SVGElement: { prototype: Measurable }; HTMLElement: { prototype: Measurable } }
  const svg = g.SVGElement.prototype
  const html = g.HTMLElement.prototype
  const saved = { getBBox: svg.getBBox, getComputedTextLength: svg.getComputedTextLength, getBoundingClientRect: html.getBoundingClientRect }
  svg.getBBox = function (this: Element): Box {
    return bboxOf(this) ?? { x: 0, y: 0, width: 0, height: 0 }
  }
  svg.getComputedTextLength = function (this: Element): number {
    return textWidth(this.textContent ?? '')
  }
  html.getBoundingClientRect = function (this: Element) {
    const { width, height } = htmlLabelSize(this)
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }
  }
  return () => {
    svg.getBBox = saved.getBBox
    svg.getComputedTextLength = saved.getComputedTextLength
    html.getBoundingClientRect = saved.getBoundingClientRect
  }
}

/** 由渲染出來的 SVG 字串取出自然大小（viewBox 的寬高，px）。 */
export function svgNaturalSize(svg: string): { width: number; height: number } {
  const m = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(svg)
  if (!m) throw new Error('SVG 沒有 viewBox')
  return { width: Number(m[3]), height: Number(m[4]) }
}

/** SVG 內所有節點／邊／subgraph 標籤的純文字（一個標籤一個字串，<br> 換成換行）。 */
export function renderedLabels(svg: string): string[] {
  const doc = new DOMParser().parseFromString(`<div>${svg}</div>`, 'text/html')
  const out: string[] = []
  doc.querySelectorAll('span.nodeLabel, span.edgeLabel, text.messageText, text.noteText, text.actor').forEach((el) => {
    const copy = el.cloneNode(true) as Element
    copy.querySelectorAll('.katex-mathml').forEach((m) => m.remove())
    copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
    const t = (copy.textContent ?? '').trim()
    if (t) out.push(t)
  })
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// 圖原始碼裡的 `$...$`（LaTeX）
// ───────────────────────────────────────────────────────────────────────────

/** 與共用 Mermaid 前處理（mermaidSource.ts）相同的行內公式規則：`$...$` 或 `$$...$$`，`\$` 是字面的美元符號。 */
const MATH_SEGMENT = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 圖原始碼裡所有雙引號標籤（節點、連線、subgraph 標題）。 */
export function quotedLabels(chart: string): string[] {
  return Array.from(chart.matchAll(/"([^"\n]*)"/g), (m) => m[1])
}

/** 標籤裡有沒有 `$...$`。 */
export function hasMath(label: string): boolean {
  MATH_SEGMENT.lastIndex = 0
  const found = MATH_SEGMENT.test(label)
  MATH_SEGMENT.lastIndex = 0
  return found
}

/**
 * 含 `$...$` 的標籤個數。共用 Mermaid 會把每個含公式的標籤合併成一個 KaTeX 區塊，
 * 所以 renderMermaidForTest 回傳的 mathCount 必須剛好等於它（少了就是有公式沒排成功，多了就是別處多出公式）。
 */
export function mathLabelCount(chart: string): number {
  return quotedLabels(chart).filter(hasMath).length
}

/** 標籤去掉 `$...$` 之後留下的文字片段（依出現順序；<br/> 當成分隔）。 */
export function textFragments(label: string): string[] {
  return label
    .replace(MATH_SEGMENT, '\uE000')
    .split(/<br\s*\/?>|\uE000/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/**
 * 圖原始碼裡「`$...$` 以外」的文字若還有 Unicode 拼的數學（μ、≤、×、w_k、z⁻¹ …），回傳找到的片段。
 * 和 unicodeMathIn(plainText) 互補：含公式的標籤整個交給 KaTeX（文字變成 \text{}），畫出來的 plainText 看不到它的文字部分，所以要在原始碼層級檢查。
 */
export function unicodeMathInSource(chart: string): string[] {
  const hits = quotedLabels(chart).flatMap((label) => unicodeMathIn(textFragments(label).join(' ')))
  return [...new Set(hits)]
}

/** 一行標籤排版後大約的樣子（量寬度用）：`$...$` 內的 TeX 指令當成一個字元、不佔寬度的指令與括號拿掉。 */
export function displayText(line: string): string {
  return line
    .replace(MATH_SEGMENT, (_all, a: string | undefined, b: string | undefined) =>
      (a ?? b ?? '')
        .replace(/\\(?:mathrm|mathbf|text|textcircled|left|right|displaystyle|frac|tfrac|dfrac|hat|bar|tilde|overline)\b|\\[,;!]/g, '')
        .replace(/\\[a-zA-Z]+/g, '\u2588')
        .replace(/[{}_^\s]/g, ''),
    )
    .replace(/<[^>]+>/g, '')
}
