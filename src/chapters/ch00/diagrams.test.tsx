import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, waitFor } from '@testing-library/react'
import katex from 'katex'
import mermaid from 'mermaid'
import { systemMapModel } from '@/components'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { classifyPole, fixedXPole, type PoleBehaviour } from '@/simulation/models/lms'
import * as diagramModule from './diagrams'
import { DIAGRAMS, DIAGRAM_KIND_LABEL, SYSTEM_MAP_FOCUS, diagramByName, figureLabel, type DiagramName } from './diagrams'
import { num } from './format'
import { ChapterDiagram } from './common'
import Chapter00 from './index'
import { averagedStd, biasedFixedPoint, handCalcRows, steadyStateVarW, stepsToFraction } from './model'
import { HANDCALCS } from './handcalcs'
import { LABEL_WRAP_PX, installMermaidLayoutStubs, katexTextWidth, svgNaturalSize, textWidth } from './mermaidTestLayout'
import { HAND_CALC_PARAMS } from './sections/HandCalc'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors, expectTexParses } from '@/test/katex'

/*
 * 本章方塊圖的測試（docs/teaching-style.md §8）。這裡用的是「真正的」mermaid：
 *   1. parser：每一張圖都要能解析；
 *   2. renderer：每一張圖真的畫成 SVG（標籤裡的 `$...$` 由 KaTeX 排版），再把畫出來的文字和原始碼逐一比對——Mermaid 11 會把沒有公式的標籤當 Markdown 處理，
 *      只有一個「+」的相加點會被畫成「Unsupported markdown: list」，成對的 * 或 _ 會被吃掉，這些 parse 階段都不會報錯；
 *      同時粗估畫出來的尺寸，太寬的圖在頁面上會被縮小到看不清楚；
 *   3. 內容：訊號名稱、相加點的正負號、δ = a − w 的極性、n／k 兩種速率、圖上的數字，逐一和本章的公式與模型函式核對
 *      （標籤原始碼就是 LaTeX，所以直接拿 `$...$` 的寫法比對）；
 *   4. 頁面：整章渲染後確實有系統地圖 + 全部方塊圖，而且每張圖都在它要說明的公式／推導之前。
 * （index.test.tsx 為了速度把 mermaid 換成假物件；這個檔案不 mock mermaid。）
 *
 * 圖上的數學一律寫 `$...$`：測試要確認（a）畫出來的文字沒有殘留的 `$`，（b）KaTeX 以外沒有 Unicode 拼的數學，
 * 包括包在 `$...$` 以外的文字（renderMermaidForTest 的 plainText 看不到那一部分：含公式的標籤整個交給 KaTeX），
 * （c）每個含 `$...$` 的標籤都真的排成一個 .katex。
 */

// Plotly 與本檔無關：整章渲染時以假物件取代
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

/** 本章方塊圖的張數（不含章首的系統地圖）。改動張數時這裡要一起改——這是刻意的。 */
const EXPECTED_DIAGRAMS = 19
/** 單張圖的節點上限（teaching-style §8：太大就拆成兩張） */
const MAX_NODES = 14
/** 相加點的標籤：KaTeX 排版的 +（ASCII 的 + 若不放進 `$...$` 會被 Mermaid 當成 Markdown 清單） */
const SUM = '$+$'
/** 乘法器的標籤 */
const MULT = String.raw`$\times$`
/**
 * 圖的自然尺寸上限（px，估計值，見 mermaidTestLayout.ts）。內文欄最寬約 1060 px；超過的圖會被等比例縮小，
 * 純文字標籤（16 px）的圖寬 1250 px 大約縮到 85%（字仍有 13 px 以上）。高度超過一個畫面（約 29 行字）就不容易一眼看完。
 * 含公式的標籤由 KaTeX 排版，字體是外層的 1.21 倍（每一列的列距也是 1.21 倍），所以上限同比例放大：
 * 這樣「縮小後字有多大」「一張圖最多幾行字」和純文字時相同，限制的嚴格程度沒有改變。
 */
const KATEX_FONT_SCALE = 1.21
const MAX_WIDTH_PX = Math.round(1250 * KATEX_FONT_SCALE)
const MAX_HEIGHT_PX = Math.round(700 * KATEX_FONT_SCALE)

interface Node {
  id: string
  text: string
  type: string
  classes: string[]
}
interface Edge {
  from: string
  to: string
  label: string
}
interface Structure {
  nodes: Node[]
  edges: Edge[]
  subgraphs: { id: string; title: string; nodes: string[] }[]
}

interface FlowDbLike {
  getVertices(): Map<string, { id: string; text?: string; type?: string; classes?: string[] }>
  getEdges(): { start: string; end: string; text?: string }[]
  getSubGraphs(): { id: string; title?: string; nodes: string[] }[]
}

/** 標籤裡的 <br/> 換成一個空白（方便比對文字）。 */
const flat = (s: string) => s.replace(/\s*<br\s*\/?>\s*/g, ' ').trim()
/** 比對文字時完全不計空白、換行與零寬空白（KaTeX 的上下標會夾帶零寬空白）。 */
const squash = (s: string) => s.replace(/<br\s*\/?>/g, '').replace(/[\s\u200b]+/g, '')

/** 標籤原始碼裡的 `$...$`（與共用元件 mermaidMathDelimiters 相同的切法） */
const MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 一段 TeX 排版後的文字（只取 KaTeX 的 HTML 輸出，不含 MathML 複本）。 */
function katexText(tex: string): string {
  const host = document.createElement('div')
  host.innerHTML = katex.renderToString(tex, { throwOnError: true, output: 'html' })
  return host.textContent ?? ''
}

/**
 * 標籤原始碼 → 畫出來的各行文字：`$...$` 換成 KaTeX 排版後的文字，`<br/>` 分行；
 * math = 這個標籤由 KaTeX 排版（只要有一行含公式，整個標籤——包括純文字的行——都在 KaTeX 裡，字體放大 1.21 倍且不折行）。
 */
function drawnLines(label: string): { text: string; math: boolean }[] {
  const math = label.includes('$')
  return label.split(/<br\s*\/?>/i).map((line) => ({ text: line.replace(MATH, (_, tex: string) => katexText(tex)), math }))
}
/** 標籤原始碼 → 畫出來的文字（不計空白）。 */
const shown = (label: string) => squash(drawnLines(label).map((l) => l.text).join(''))

/** 圖的原始碼裡所有雙引號標籤（節點、連線、子圖標題）。 */
const labelsIn = (chart: string) => [...chart.matchAll(/"([^"\n]*)"/g)].map((m) => m[1])
/** 標籤裡 `$...$` 以外的文字（用來檢查沒有 Unicode 拼的數學）。 */
const textOutsideMath = (label: string) => label.replace(MATH, ' ').replace(/<br\s*\/?>/gi, ' ')

/** 用真正的 parser 取出圖的結構（節點、線、子圖）；標籤是原始碼（含 `$...$`），其中的 <br/> 已換成空白。 */
async function structure(chart: string): Promise<Structure> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDbLike
  const subgraphs = db.getSubGraphs().map((s) => ({ id: s.id, title: flat(s.title ?? ''), nodes: [...s.nodes] }))
  const isSubgraph = (id: string) => subgraphs.some((g) => g.id === id)
  return {
    // 線接到子圖本身（D --> BATCH）時，parser 會把子圖 id 也記成一個 vertex；那不是畫出來的方塊，這裡濾掉
    nodes: [...db.getVertices().values()]
      .filter((v) => !isSubgraph(v.id))
      .map((v) => ({ id: v.id, text: flat(v.text ?? ''), type: v.type ?? 'square', classes: [...(v.classes ?? [])] })),
    edges: db.getEdges().map((e) => ({ from: e.start, to: e.end, label: flat(e.text ?? '') })),
    subgraphs,
  }
}

/** 原始標籤（保留 <br/>），用來檢查每一行的寬度。 */
async function rawLabels(chart: string): Promise<string[]> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDbLike
  return [...[...db.getVertices().values()].map((v) => v.text ?? ''), ...db.getEdges().map((e) => e.text ?? ''), ...db.getSubGraphs().map((g) => g.title ?? '')].filter(Boolean)
}

const chartOf = (name: DiagramName) => diagramByName(name).chart
const edgeLabel = (s: Structure, from: string, to: string) => {
  const hits = s.edges.filter((e) => e.from === from && e.to === to)
  expect(hits, `${from} → ${to}`).toHaveLength(1)
  return hits[0].label
}
const node = (s: Structure, id: string) => {
  const n = s.nodes.find((x) => x.id === id)
  expect(n, id).toBeTruthy()
  return n!
}
const nodeText = (s: Structure, id: string) => node(s, id).text
const box = (s: Structure, id: string) => {
  const g = s.subgraphs.find((x) => x.id === id)
  expect(g, id).toBeTruthy()
  return g!
}
const isSum = (n: Node) => n.type === 'circle' && n.text === SUM
const isMultiplier = (n: Node) => n.type === 'circle' && n.text === MULT

/** 測試期間 KaTeX 印出的警告（strict 模式：不認得的 Unicode 字元、缺字型度量…）；最後一個測試確認只有步驟編號 ①②③④ 這一種。 */
const katexWarnings: string[] = []

beforeAll(() => {
  // jsdom 沒有版面引擎：裝上估計用的量測函式，mermaid 的 renderer（含 dagre 排版）就能完整跑完
  installMermaidLayoutStubs()
  Element.prototype.scrollIntoView = vi.fn()
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
  const warn = console.warn.bind(console)
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const msg = args.map(String).join(' ')
    if (/LaTeX-incompatible|No character metrics|KaTeX/.test(msg)) katexWarnings.push(msg)
    else warn(...args)
  })
})
afterAll(() => {
  vi.restoreAllMocks()
})

/** `$` 成對；奇數段是 LaTeX（必須能被 KaTeX 排版），偶數段是純文字（不夾 Unicode 數學符號） */
function expectMathText(label: string, text: string) {
  const parts = text.split('$')
  expect(parts.length % 2, `${label}：$ 要成對`).toBe(1)
  parts.forEach((part, i) => {
    if (i % 2 === 1) expectTexParses(part, `${label}：$${part}$`)
    else expect(part, `${label}：數學要寫成 $…$`).not.toMatch(/[α-ωΑ-Ω²³⁻₀-₉√Σ≤≥]|[a-z]_[a-z0-9]/)
  })
}

describe('ch00 方塊圖：登錄清單', () => {
  it(`共有 ${EXPECTED_DIAGRAMS} 張（不含系統地圖），其中新增的至少 6 張；每個匯出的 CHART_* 都登記了一次`, () => {
    expect(DIAGRAMS).toHaveLength(EXPECTED_DIAGRAMS)
    expect(DIAGRAMS.filter((d) => d.isNew).length).toBeGreaterThanOrEqual(6)
    expect(DIAGRAMS.filter((d) => !d.isNew).map((d) => d.name)).toEqual(['CHART_LOOP', 'CHART_ADAPTIVE_LOOP', 'CHART_PLL_LOOP'])
    const exported = Object.entries(diagramModule).filter(([k]) => k.startsWith('CHART_'))
    expect(exported.map(([k]) => k).sort()).toEqual(DIAGRAMS.map((d) => d.name).sort())
    for (const [name, chart] of exported) expect(diagramByName(name as DiagramName).chart, name).toBe(chart)
    expect(new Set(DIAGRAMS.map((d) => d.chart)).size).toBe(DIAGRAMS.length)
    // 圖號依頁面順序連號：D-00.1 … D-00.N ↔ 圖 0.1 … 圖 0.N
    DIAGRAMS.forEach((d, i) => {
      expect(d.id).toBe(`D-00.${i + 1}`)
      expect(figureLabel(d.name as DiagramName)).toBe(`圖 0.${i + 1}`)
    })
  })

  it('每張圖都有圖說（告訴讀者要看什麼）、替代文字與種類；圖說與「這張圖在說什麼」的數學寫成 $…$（KaTeX），不用 Unicode 拼公式，也沒有未替換的 {CHART_…}', () => {
    for (const d of DIAGRAMS) {
      expect(d.caption.length, d.name).toBeGreaterThan(20)
      expect(d.caption, d.name).not.toMatch(/\{CHART_|undefined|圖 0\.0/)
      expectMathText(`${d.name} 圖說`, d.caption)
      expectMathText(`${d.name} shows`, d.shows)
      expect(d.ariaLabel.length, d.name).toBeGreaterThan(15)
      expect(d.shows.length, d.name).toBeGreaterThan(8)
      expect(DIAGRAM_KIND_LABEL[d.kind], d.name).toBeTruthy()
    }
    // teaching-style §8 的五種圖都用到了
    expect(new Set(DIAGRAMS.map((d) => d.kind)).size).toBe(Object.keys(DIAGRAM_KIND_LABEL).length)
    // 圖說裡引用別張圖時，圖號由名稱自動換算
    expect(diagramByName('CHART_STEADY_STATE_NOISE').caption).toContain(`和${figureLabel('CHART_ERROR_RECURSION')}是同一個迴圈`)
    expect(diagramByName('CHART_BLACKBOX_TO_PLL').caption).toContain(`和${figureLabel('CHART_BLACKBOX_MODEL')}是同一個模型`)
  })
})

describe('ch00 方塊圖：真正的 mermaid parser 與 renderer', () => {
  it.each(DIAGRAMS.map((d) => [d.id, d.name, d] as const))('%s %s：可解析；節點不超過上限；相加點的每條輸入都標了正負號', async (_id, _name, d) => {
    const r = await mermaid.parse(d.chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
    const s = await structure(d.chart)
    expect(s.nodes.length).toBeGreaterThanOrEqual(4)
    expect(s.nodes.length).toBeLessThanOrEqual(MAX_NODES)
    for (const n of s.nodes) {
      expect(n.text.length, n.id).toBeGreaterThan(0)
      // 只用 diagrams.ts 定義的四種顏色
      for (const c of n.classes) expect(['focus', 'warn', 'ok', 'box'], `${n.id}.${c}`).toContain(c)
    }
    // 每張圖至少標出一個重點方塊
    expect(s.nodes.some((n) => n.classes.length > 0)).toBe(true)
    // 相加點：至少兩條輸入，每條都以 $(+)$ 或 $(-)$ 開頭；其他地方不使用這個前綴
    const SIGN = /^\$\((\+|-)\)\$ \S/
    const sums = new Set(s.nodes.filter(isSum).map((n) => n.id))
    for (const id of sums) {
      const inputs = s.edges.filter((e) => e.to === id)
      expect(inputs.length, id).toBeGreaterThanOrEqual(2)
      for (const e of inputs) expect(e.label, `${e.from} → ${id}`).toMatch(SIGN)
    }
    for (const e of s.edges) if (!sums.has(e.to)) expect(e.label, `${e.from} → ${e.to}`).not.toMatch(/^\$\((\+|-)\)\$/)
    // 不留孤立的節點（子圖裡的節點可以靠接到子圖本身的線連出去）
    for (const n of s.nodes) {
      const linked = s.edges.some((e) => e.from === n.id || e.to === n.id)
      const viaSubgraph = s.subgraphs.some((g) => g.nodes.includes(n.id) && s.edges.some((e) => e.from === g.id || e.to === g.id))
      expect(linked || viaSubgraph, n.id).toBe(true)
    }
    // 標籤裡不放會被當成 HTML／敘述分隔／Markdown 的字元：
    //   整個標籤不含 < > ; ` #（公式裡的不等式寫 \lt \gt，Mermaid 會把 < > 轉成 HTML 實體，KaTeX 就讀不懂）；
    //   `$...$` 以外不含落單的 $、Markdown 強調用的 * _ 與反斜線；公式裡不含 &
    for (const t of [...s.nodes.map((n) => n.text), ...s.edges.map((e) => e.label), ...s.subgraphs.map((g) => g.title)]) {
      expect(t, t).not.toMatch(/[<>;`#]/)
      expect(t.replace(MATH, ''), t).not.toMatch(/[$*_\\]/)
      for (const m of t.matchAll(MATH)) expect(m[1], t).not.toMatch(/&/)
      expect(t, t).not.toMatch(/^\s*([+\-*]|\d+\.)(\s|$)/) // Markdown 清單
    }
    // 每一行畫出來都不超過 200 px：Mermaid 的標籤框最寬 200 px，KaTeX 的公式又不會折行，超過會被裁掉（要換行就明確寫 <br/>）
    for (const label of await rawLabels(d.chart))
      for (const line of drawnLines(label)) {
        const w = line.math ? katexTextWidth(line.text) : textWidth(line.text)
        expect(w, `${d.name}：「${label}」的這一行「${line.text}」`).toBeLessThanOrEqual(LABEL_WRAP_PX)
      }
  })

  it.each(DIAGRAMS.map((d) => [d.id, d.name, d] as const))('%s %s：真的畫成 SVG（公式由 KaTeX 排版）之後，圖上的文字和原始碼一字不差；尺寸不會大到在頁面上被縮得看不清楚', async (_id, _name, d) => {
    const s = await structure(d.chart)
    // 與網站相同的前處理（sanitizeMermaidSource：含公式的標籤合併成單一的 $$…$$）與 forceLegacyMathML
    const r = await renderMermaidForTest(d.chart)
    const { svg } = r
    expect(svg).not.toContain('Unsupported markdown')
    expect(svg).not.toContain('Syntax error')
    expect(r.text).not.toContain('$') // 所有公式都排版成功，沒有把 $…$ 原樣畫出來
    expect(r.mathCount, '含 $…$ 的標籤個數 = 畫出來的 .katex 個數').toBe(labelsIn(d.chart).filter((l) => l.includes('$')).length)
    const doc = new DOMParser().parseFromString(svg, 'text/html')
    doc.querySelectorAll('.katex-mathml').forEach((e) => e.remove()) // KaTeX 的 MathML 複本
    const drawn = (sel: string) => [...doc.querySelectorAll(sel)].map((g) => squash(g.textContent ?? '')).filter(Boolean).sort()
    // 節點：數量與文字（Markdown 若把 *…*、_…_ 當成強調，符號會消失，這裡就會不相等）
    expect(doc.querySelectorAll('g.node')).toHaveLength(s.nodes.length)
    expect(drawn('g.node')).toEqual(s.nodes.map((n) => shown(n.text)).sort())
    // 線上的訊號名稱與正負號
    expect(drawn('g.edgeLabel')).toEqual(s.edges.map((e) => shown(e.label)).filter(Boolean).sort())
    // 子圖標題
    expect(drawn('g.cluster')).toEqual(s.subgraphs.map((g) => shown(g.title)).sort())
    // 上色的方塊真的帶著 class
    for (const n of s.nodes) for (const c of n.classes) expect(doc.querySelector(`g.node.${c}[id*="-${n.id}-"]`), `${n.id}.${c}`).not.toBeNull()
    // 自然尺寸（估計）
    const size = svgNaturalSize(svg)
    expect(size.width, `${d.name} 寬 ${Math.round(size.width)} px`).toBeGreaterThan(300)
    expect(size.width, `${d.name} 寬 ${Math.round(size.width)} px`).toBeLessThanOrEqual(MAX_WIDTH_PX)
    expect(size.height, `${d.name} 高 ${Math.round(size.height)} px`).toBeLessThanOrEqual(MAX_HEIGHT_PX)
  })

  it('反面測試：沒有放進 $…$ 的 ASCII「+」相加點會被 Mermaid 畫成「Unsupported markdown」——所以本章的 + 都寫成 $+$（KaTeX）', async () => {
    const bad = 'flowchart LR\n  A["a"] -- "+" --> S(("+"))\n  B["b"] -- "−" --> S'
    await expect(mermaid.parse(bad, { suppressErrors: false })).resolves.toBeTruthy() // parser 不會抱怨
    const { svg } = await mermaid.render('ch00testbad', bad)
    expect(svg).toContain('Unsupported markdown: list')
    for (const d of DIAGRAMS) {
      expect(d.chart, d.name).not.toMatch(/\(\(\s*"?[+-]"?\s*\)\)|-- "[+-]" -->/)
      expect(d.chart, d.name).not.toMatch(/\(\("[＋−×]"\)\)/) // 相加點、乘法器的標籤也不用 Unicode 符號
    }
  })

  it('章首的系統地圖：本章標示的六個方塊（LMS 校正迴路本身）都在圖上，其餘方塊不是主角', () => {
    // 系統地圖是手排的 SVG，不經過 Mermaid：用純資料的 systemMapModel 檢查哪些方塊被標成主角
    // （圖上的版面與連線拓樸由 src/components/SystemMap.test.tsx 負責；頁面實際畫出來的 is-focus 在下面的整章渲染測試核對）
    expect(SYSTEM_MAP_FOCUS).toEqual(['res', 'gc', 'cmp', 'gmac', 'scale', 'acc'])
    const { blocks } = systemMapModel(SYSTEM_MAP_FOCUS)
    const focused = blocks.filter((b) => b.focused)
    expect(focused.map((b) => b.id).sort()).toEqual([...SYSTEM_MAP_FOCUS].sort())
    expect(focused).toHaveLength(SYSTEM_MAP_FOCUS.length)
    // 六個主角全是「小數補償」與「LMS 校正迴路」兩條泳道的方塊；主 PLL 迴路（快）的方塊沒有一個被標成主角
    expect(focused.every((b) => b.lane === 'frac' || b.lane === 'lms')).toBe(true)
    expect(blocks.filter((b) => b.lane === 'pll').some((b) => b.focused)).toBe(false)
    expect(blocks.filter((b) => !b.focused)).toHaveLength(blocks.length - SYSTEM_MAP_FOCUS.length)
  })
})

describe('ch00 方塊圖：共用的 render 測試工具（@/components/mermaidTestUtils）', () => {
  // 共用工具只給 getBBox 一個「字數 × 7 px」的估計；這個 describe 結束後把本檔的版面估計還原，其他測試的尺寸斷言才不受影響
  beforeAll(installMermaidSvgShim)
  afterAll(installMermaidLayoutStubs)

  it.each(DIAGRAMS.map((d) => [d.id, d.name, d.chart] as const))(
    '%s %s：真的 render 之後沒有「Unsupported markdown」、沒有殘留的 $、KaTeX 以外沒有 Unicode 拼的數學；節點數不超過 14',
    async (_id, _name, chart) => {
      const { text, plainText, nodeCount, mathCount } = await renderMermaidForTest(chart)
      expect(text).not.toMatch(/Unsupported markdown/)
      expect(text).not.toContain('$')
      expect(unicodeMathIn(plainText)).toEqual([])
      expect(mathCount).toBeGreaterThan(0)
      // 含公式的標籤整個交給 KaTeX（文字包成 \text{}），plainText 看不到那一部分——所以另外檢查原始碼：
      // 標籤在 `$...$` 以外的文字不可有 Unicode 拼的數學，也不可有沒放進公式的運算符號（= + − × ÷ ＋ ＜ ＞）
      const outside = labelsIn(chart).map(textOutsideMath).join('\n')
      expect(unicodeMathIn(outside), '標籤 $…$ 以外的文字').toEqual([])
      expect(outside, '標籤 $…$ 以外的文字').not.toMatch(/[=+−×÷＋＜＞]/)
      expect(nodeCount).toBeGreaterThanOrEqual(4)
      expect(nodeCount).toBeLessThanOrEqual(MAX_NODES)
    },
  )

  it('章首的系統地圖（<SystemMap focus={SYSTEM_MAP_FOCUS} />）的方塊文字：沒有 Unicode 拼的數學，公式都放在 $…$ 裡', () => {
    // 系統地圖不經過 Mermaid，方塊文字（標題、第二行）由 SystemMap 自己用 KaTeX 排版
    const focused = systemMapModel(SYSTEM_MAP_FOCUS).blocks.filter((b) => b.focused)
    const text = focused.map((b) => `${b.title} ${b.sub ?? ''}`).join('\n')
    expect(squash(text)).toContain('Gainaccumulator')
    expect(squash(text)).toContain('Fractionalresidue')
    expect(squash(text)).toContain('1-bitcomparator')
    expect(squash(text)).toContain('GMAC')
    const outside = text.split('$').filter((_, i) => i % 2 === 0).join(' ')
    expect(unicodeMathIn(outside), '方塊文字 $…$ 以外').toEqual([])
    expect(text).toContain(String.raw`q[n] = \mathrm{sign}(e[n])`)
  })
})

describe('ch00 方塊圖：和本章公式一致', () => {
  /** 圖的原始碼裡有沒有這條式子（不計空白與 <br/>）。 */
  const has = (name: DiagramName, formula: string) => squash(chartOf(name)).includes(squash(formula))

  it('極性：誤差一律是 e = y − ŷ，參數誤差一律是 δ = a − w（勘誤 E39），沒有任何一張圖寫反', () => {
    for (const d of DIAGRAMS) {
      const t = squash(d.chart)
      expect(t, d.name).not.toMatch(/\\haty(\[\w+\])?-y/) // ŷ − y
      expect(t, d.name).not.toMatch(/w(\[\w+\])?-a/) // w − a
      expect(t, d.name).not.toMatch(/\\delta(\[\w+\])?=w/) // δ = w …
      expect(t, d.name).not.toMatch(/\(w-a\)/)
    }
    expect(has('CHART_BLACKBOX_MODEL', String.raw`e = y - \hat y`)).toBe(true)
    expect(has('CHART_LOOP', String.raw`e[n] = y[n] - \hat y[n]`)).toBe(true)
    expect(has('CHART_ADAPTIVE_LOOP', String.raw`誤差 $e = y - \hat y$`)).toBe(true)
    for (const name of ['CHART_ERROR_RECURSION', 'CHART_STEADY_STATE_NOISE'] as const) expect(has(name, String.raw`\delta[n] = a - w[n]`), name).toBe(true)
    // e = (a − w)·x + v：訊號／雜訊拆解、PLL 模型、PLL 迴圈三張圖寫法一致
    expect(has('CHART_SIGNAL_VS_NOISE', String.raw`e = (a - w)\,x + v`)).toBe(true)
    expect(has('CHART_BLACKBOX_TO_PLL', String.raw`$= (a - w)\,x[n] + v[n]`)).toBe(true)
    expect(has('CHART_PLL_LOOP', String.raw`e[n] =$<br/>$(a - w)\,x[n] + v[n]`)).toBe(true)
  })

  it('F-00.1 黑盒子模型：a·x 與 v 相加成 y；y 以 (+)、ŷ = w·x 以 (−) 進入誤差的相加點', async () => {
    const s = await structure(chartOf('CHART_BLACKBOX_MODEL'))
    expect(edgeLabel(s, 'A', 'SV')).toBe(String.raw`$(+)$ $a\,x$`)
    expect(edgeLabel(s, 'V', 'SV')).toBe(String.raw`$(+)$ $v$`)
    expect(edgeLabel(s, 'SV', 'SE')).toBe(String.raw`$(+)$ $y = a\,x + v$`)
    expect(edgeLabel(s, 'W', 'SE')).toBe(String.raw`$(-)$ $\hat y = w\,x$`)
    expect(edgeLabel(s, 'SE', 'E')).toBe(String.raw`$e = y - \hat y$`)
    // 同一個 x 同時送進黑盒子與我們的模型
    expect(s.edges.filter((e) => e.from === 'X').map((e) => e.to).sort()).toEqual(['A', 'W'])
    expect(node(s, 'A').classes).toEqual(['box'])
    expect(node(s, 'W').classes).toEqual(['focus'])
    expect(node(s, 'V').classes).toEqual(['warn'])
  })

  it('F-00.10 批次 vs 線上：批次有記憶體、分子／分母兩個總和與除法器；線上只有一個暫存器的迴圈', async () => {
    const s = await structure(chartOf('CHART_BATCH_VS_ONLINE'))
    expect([...box(s, 'BATCH').nodes].sort()).toEqual(['DIV', 'LS', 'M', 'SXX', 'SXY'])
    expect([...box(s, 'ONLINE').nodes].sort()).toEqual(['R', 'U'])
    expect(nodeText(s, 'SXY')).toBe(String.raw`分子 $\sum x[i]\,y[i]$`) // Σ x·y 在分子
    expect(nodeText(s, 'SXX')).toBe(String.raw`分母 $\sum x[i]^2$`) // Σ x² 在分母
    expect(s.edges.filter((e) => e.to === 'DIV').map((e) => e.from).sort()).toEqual(['SXX', 'SXY'])
    expect(s.edges.some((e) => e.from === 'U' && e.to === 'R') && s.edges.some((e) => e.from === 'R' && e.to === 'U')).toBe(true)
    // 同一串資料同時餵給兩個框
    expect(s.edges.filter((e) => e.from === 'D').map((e) => e.to).sort()).toEqual(['BATCH', 'ONLINE'])
  })

  it('§0.2 迴圈：x[n] 同時送到「預測」與「修正」；w[n+1] 回授到「預測」；每一條線都有訊號名稱', async () => {
    const s = await structure(chartOf('CHART_LOOP'))
    // 與宣告順序無關（版面要把迴圈畫成沒有交叉的一圈，所以兩條 x[n] 的先後可以換）：恰好兩條，分別送到「預測」與「修正」，標籤都是 x[n]
    expect(s.edges.filter((e) => e.from === 'X').map((e) => [e.to, e.label]).sort()).toEqual([
      ['P', '$x[n]$'],
      ['U', '$x[n]$'],
    ])
    expect(edgeLabel(s, 'Y', 'C')).toBe('$y[n]$')
    expect(edgeLabel(s, 'P', 'C')).toBe(String.raw`$\hat y[n]$`)
    expect(edgeLabel(s, 'C', 'U')).toBe('$e[n]$')
    expect(edgeLabel(s, 'U', 'P')).toContain('$w[n+1]$')
    expect(nodeText(s, 'U')).toBe(String.raw`③ 修正 $w[n+1] =$ $w[n] + \mu\,e[n]\,x[n]$`)
    expect(nodeText(s, 'P')).toBe(String.raw`① 預測 $\hat y[n] = w[n]\,x[n]$`)
    expect(nodeText(s, 'C')).toBe(String.raw`② 比較 $e[n] = y[n] - \hat y[n]$`)
    for (const e of s.edges) expect(e.label.length, `${e.from} → ${e.to}`).toBeGreaterThan(0)
  })

  it('F-00.2 累加器：w[n+1] = w[n] + μ·e[n]·x[n]，延遲 z⁻¹ 在回授迴圈上', async () => {
    const s = await structure(chartOf('CHART_LMS_ACCUMULATOR'))
    expect(isMultiplier(node(s, 'M'))).toBe(true)
    expect(s.edges.filter((e) => e.to === 'M').map((e) => e.from).sort()).toEqual(['E', 'X'])
    expect(edgeLabel(s, 'M', 'G')).toBe(String.raw`$e[n]\,x[n]$`)
    expect(nodeText(s, 'G')).toBe(String.raw`$\times\,\mu$`)
    expect(edgeLabel(s, 'G', 'S')).toBe(String.raw`$(+)$ $\mu\,e[n]\,x[n]$`)
    expect(edgeLabel(s, 'R', 'S')).toBe('$(+)$ $w[n]$')
    expect(edgeLabel(s, 'S', 'R')).toBe('$w[n+1]$')
    expect(nodeText(s, 'R')).toContain('$z^{-1}$')
    expect(node(s, 'R').classes).toEqual(['focus'])
  })

  it('T01: §0.4 手算流程圖上的每一個數字，都等於 handCalcRows（lms.ts 的 conventionalStep）算出來的值', async () => {
    const p = HAND_CALC_PARAMS
    const [r0, r1] = handCalcRows({ ...p, steps: 2 })
    const y = p.a * p.x
    const s = await structure(chartOf('CHART_HANDCALC_STEP'))
    expect(nodeText(s, 'IN')).toBe(String.raw`已知 $w[0] = ${num(p.w0)}$、$x = ${num(p.x)}$ $y = ${num(y)}$、$\mu = ${num(p.mu)}$`)
    expect(nodeText(s, 'P')).toBe(String.raw`① 預測（乘） $\hat y[0] = w[0]\,x$ $= ${num(p.w0)} \times ${num(p.x)} = ${num(r0.yhat)}$`)
    expect(nodeText(s, 'C')).toBe(String.raw`② 比較（減） $e[0] = y - \hat y[0]$ $= ${num(y)} - ${num(r0.yhat)} = ${num(r0.e)}$`)
    expect(nodeText(s, 'D')).toBe(
      String.raw`③ 修正量（連乘） $\Delta w[0] = \mu\,e[0]\,x$ $= ${num(p.mu)} \times ${num(r0.e)} \times ${num(p.x)} = ${num(r0.dw)}$`,
    )
    expect(nodeText(s, 'U')).toBe(String.raw`④ 更新（加） $w[1] = w[0] + \Delta w[0]$ $= ${num(p.w0)} + ${num(r0.dw)} = ${num(r0.wNext)}$`)
    // 回授線上帶回 ① 的是 w[1]（④ 的輸出）；第二圈算完才是 w[2]
    expect(edgeLabel(s, 'U', 'P')).toBe(String.raw`$w[1]$ 帶回 ① 下一圈得 $w[2] = ${num(r1.wNext)}$`)
    expect(r1.w).toBeCloseTo(r0.wNext, 12)
    // 計算順序：已知 → ① → ② → ③ → ④ → 回到 ①
    expect(s.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['IN>P', 'P>C', 'C>D', 'D>U', 'U>P'])
    // 規格 T01 的參考值
    expect(num(r0.wNext)).toBe('1.8')
    expect(num(r1.wNext)).toBe('2.28')
  })

  it('T02: F-00.5 學習率地圖的五個區段，和 lms.ts 的 fixedXPole／classifyPole、golden T02 逐點一致', async () => {
    const s = await structure(chartOf('CHART_MU_REGIONS'))
    expect(nodeText(s, 'P')).toContain(String.raw`$p = 1 - \mu\,x^2$`)
    // 線上的範圍（第一行是 μ，第二行是 p）→ 目的節點、p 的範圍、模型的分類
    const regions: { label: string; to: string; p: (p: number) => boolean; mu: (g: number) => boolean; kinds: PoleBehaviour[] }[] = [
      { label: String.raw`$\mu \le 0$ $p \ge 1$`, to: 'F', p: (p) => p >= 1, mu: (g) => g <= 0, kinds: ['frozen', 'divergent'] },
      { label: String.raw`$0 \lt \mu \lt 1/x^2$ $0 \lt p \lt 1$`, to: 'A', p: (p) => p > 0 && p < 1, mu: (g) => g > 0 && g < 1, kinds: ['monotone'] },
      { label: String.raw`$\mu = 1/x^2$ $p = 0$`, to: 'B', p: (p) => p === 0, mu: (g) => g === 1, kinds: ['deadbeat'] },
      { label: String.raw`$1/x^2 \lt \mu \lt 2/x^2$ $-1 \lt p \lt 0$`, to: 'C', p: (p) => p > -1 && p < 0, mu: (g) => g > 1 && g < 2, kinds: ['oscillating'] },
      { label: String.raw`$\mu \ge 2/x^2$ $p \le -1$`, to: 'DV', p: (p) => p <= -1, mu: (g) => g >= 2, kinds: ['boundary', 'divergent'] },
    ]
    expect(s.edges.filter((e) => e.from === 'Q').map((e) => [e.label, e.to])).toEqual(regions.map((r) => [r.label, r.to]))
    for (const x of [2, 0.5, -1]) {
      // 2 的冪次，μ·x² 與 p 都沒有捨入誤差
      for (const g of [-1, -0.25, 0, 0.125, 0.5, 0.875, 1, 1.25, 1.5, 1.875, 2, 2.5, 4]) {
        const mu = g / (x * x)
        const p = fixedXPole(mu, x)
        const hit = regions.filter((r) => r.mu(g))
        expect(hit, `μx² = ${g}`).toHaveLength(1) // 五段不重疊、沒有漏
        expect(hit[0].p(p), `μx² = ${g}, p = ${p}`).toBe(true) // 線上寫的 p 範圍是對的
        expect(hit[0].kinds, `μx² = ${g}`).toContain(classifyPole(p)) // 和模型的分類一致
      }
    }
    // golden T02（x = 2）：圖上「會收斂」的三格（綠色）正好就是 golden 判定收斂的那些 μ
    const golden = JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors/T02.json'), 'utf8')) as {
      inputs: { x: number; mu_list: number[] }
      expected: { mu_max: number; mu_one_step: number; converges_list: (boolean | number)[] }
    }
    const gx2 = golden.inputs.x * golden.inputs.x
    expect(2 / gx2).toBe(golden.expected.mu_max) // 圖上的 2/x²
    expect(1 / gx2).toBe(golden.expected.mu_one_step) // 圖上的 1/x²
    golden.inputs.mu_list.forEach((mu, i) => {
      const region = regions.find((r) => r.mu(mu * gx2))!
      expect(['A', 'B', 'C'].includes(region.to), `μ = ${mu}`).toBe(Boolean(golden.expected.converges_list[i]))
    })
    // 目的格子的說法與顏色：收斂的三格是綠色，不收斂的兩格是紅色
    expect(nodeText(s, 'F')).toBe(String.raw`學不到 $\mu = 0$ 不更新 $\mu \lt 0$ 越修越遠`)
    expect(nodeText(s, 'A')).toContain('單調收斂')
    expect(nodeText(s, 'B')).toContain('一步到位')
    expect(nodeText(s, 'C')).toContain('仍然收斂')
    expect(nodeText(s, 'DV')).toBe(String.raw`不收斂 $\mu = 2/x^2$ 在邊界 再大就發散`)
    for (const id of ['A', 'B', 'C']) expect(node(s, id).classes).toEqual(['ok'])
    for (const id of ['F', 'DV']) expect(node(s, id).classes).toEqual(['warn'])
  })

  it('F-00.3 下坡法：斜率 dj/dw = −e·x，步伐 Δw = −μ·(dj/dw) = μ·e·x，和 w[n] 相加得到新的 w', async () => {
    const s = await structure(chartOf('CHART_GRADIENT_DESCENT'))
    expect(nodeText(s, 'SL')).toBe(String.raw`量單筆成本的斜率 $j = \tfrac12\,e^2$ $dj/dw = -e\,x$`)
    expect(nodeText(s, 'ST')).toBe(String.raw`往反方向走一步 $\Delta w = -\mu\,(dj/dw)$ $= \mu\,e\,x$`)
    expect(edgeLabel(s, 'ST', 'S')).toBe(String.raw`$(+)$ $\Delta w$`)
    expect(edgeLabel(s, 'W', 'S')).toBe('$(+)$ $w[n]$')
    // 斜率要用到目前的 w 與這一筆資料 x[n]、y[n]（e = y − w·x）
    expect(nodeText(s, 'DATA')).toBe(String.raw`這一筆資料 $x[n]$、$y[n]$ （$e = y - w\,x$）`)
    expect(s.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['W>SL', 'DATA>SL', 'SL>ST', 'ST>S', 'W>S', 'S>WN', 'WN>W'])
    // 數值核對：照圖走一步（斜率 → 乘 −μ → 加回 w），等於 conventionalStep 的結果
    const p = HAND_CALC_PARAMS
    const [r0] = handCalcRows({ ...p, steps: 1 })
    const slope = -r0.e * p.x
    expect(p.w0 + -p.mu * slope).toBeCloseTo(r0.wNext, 12)
  })

  it('F-00.4 參數誤差的迴圈：δ[n] 以 (+)、修正量 μ·x²·δ[n] 以 (−) 相加，繞一圈乘上 (1 − μ·x²)', async () => {
    const s = await structure(chartOf('CHART_ERROR_RECURSION'))
    expect(edgeLabel(s, 'R', 'MX')).toBe(String.raw`$\delta[n]$`)
    expect(edgeLabel(s, 'MX', 'MG')).toBe(String.raw`$e[n] = \delta[n]\,x$`)
    expect(edgeLabel(s, 'MG', 'S')).toBe(String.raw`$(-)$ $\mu\,x^2\,\delta[n]$`)
    expect(edgeLabel(s, 'R', 'S')).toBe(String.raw`$(+)$ $\delta[n]$`)
    expect(edgeLabel(s, 'S', 'R')).toBe(String.raw`$\delta[n+1] =$ $(1 - \mu\,x^2)\,\delta[n]$ $= p\,\delta[n]$`)
    expect(nodeText(s, 'R')).toBe(String.raw`$z^{-1}$ 記住 $\delta[n] = a - w[n]$`)
    // 數值核對：圖上的遞迴 δ ← δ − μ·x²·δ 和 handCalcRows 的 δ 一步一步相同
    const p = HAND_CALC_PARAMS
    let delta = p.a - p.w0
    for (const row of handCalcRows(p)) {
      expect(row.delta).toBeCloseTo(delta, 12)
      delta = delta - p.mu * p.x * p.x * delta
      expect(row.deltaNext).toBeCloseTo(delta, 12)
    }
  })

  it('F-00.7／F-00.8／F-00.9：訊號與雜訊的拆解、平均器、有雜訊的 δ 迴圈', async () => {
    const sv = await structure(chartOf('CHART_SIGNAL_VS_NOISE'))
    expect(nodeText(sv, 'E')).toBe(String.raw`有雜訊的誤差 $e = (a - w)\,x + v$`)
    expect(sv.edges.filter((e) => e.to === 'M').map((e) => e.from).sort()).toEqual(['E', 'X']) // e 再乘一次 x
    expect(isMultiplier(node(sv, 'M'))).toBe(true)
    // e·x = (a − w)·x² + v·x：乘法器的輸出拆成兩項，第一項是訊號、第二項是雜訊
    expect(edgeLabel(sv, 'M', 'SIG')).toBe(String.raw`$e\,x$ 的第一項`)
    expect(edgeLabel(sv, 'M', 'NOI')).toBe(String.raw`$e\,x$ 的第二項`)
    expect(nodeText(sv, 'SIG')).toContain(String.raw`訊號部分 $(a - w)\,x^2$`)
    expect(nodeText(sv, 'NOI')).toContain(String.raw`雜訊部分 $v\,x$`)
    expect(edgeLabel(sv, 'SIG', 'OUT')).toBe(String.raw`平均 $(a - w)\,E[x^2]$`)
    expect(edgeLabel(sv, 'NOI', 'OUT')).toBe('平均 $0$ $v$ 平均 $0$、和 $x$ 無關') // E[v·x] = 0 的條件寫在線上
    expect(nodeText(sv, 'OUT')).toBe(String.raw`取平均 $E[\cdot]$ $E[e\,x] =$ $(a - w)\,E[x^2] + 0$`)
    expect(node(sv, 'SIG').classes).toEqual(['ok'])
    expect(node(sv, 'NOI').classes).toEqual(['warn'])

    const avg = await structure(chartOf('CHART_NOISE_AVERAGING'))
    expect(avg.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['Z>SUM', 'SUM>DIV', 'DIV>G', 'G>MEAN', 'G>STD']) // 先累加、再 ÷ N
    expect(nodeText(avg, 'Z')).toBe(String.raw`$N$ 筆 $e[i]\,x[i]$ 單筆平均 $(a - w)\,E[x^2]$ 單筆標準差 $s_1$`)
    expect(edgeLabel(avg, 'SUM', 'DIV')).toBe(String.raw`訊號 $\propto N$ 雜訊 $\propto \sqrt{N}$`)
    expect(nodeText(avg, 'MEAN')).toBe(String.raw`中心不動 平均 $= (a - w)\,E[x^2]$`)
    expect(nodeText(avg, 'STD')).toBe(String.raw`抖動變小 標準差 $= s_1 / \sqrt{N}$`)

    const ss = await structure(chartOf('CHART_STEADY_STATE_NOISE'))
    expect(edgeLabel(ss, 'G', 'S')).toBe(String.raw`$(-)$ $\mu\,x\,v[n]$`)
    expect(edgeLabel(ss, 'P', 'S')).toBe(String.raw`$(+)$ $p\,\delta[n]$`)
    expect(edgeLabel(ss, 'S', 'R')).toBe(String.raw`$\delta[n+1]$`)
    expect(nodeText(ss, 'G')).toBe(String.raw`$\times\,\mu\,x$`)
    expect(nodeText(ss, 'P')).toBe(String.raw`$\times\,p$ $p = 1 - \mu\,x^2$`)
    expect(nodeText(ss, 'OUT')).toBe(String.raw`收斂後 $w$ 的抖動 變異數 $=$ $\mu\,\sigma_v^2 / (2 - \mu\,x^2)$`)
    // 數值核對：照圖上的迴圈 V ← p²·V + (μ·x)²·σ_v² 疊代到穩態，等於圖上寫的 μ·σ_v²/(2 − μ·x²)，也等於模型函式
    const [mu, x, sigma] = [0.05, 2, 0.5]
    const pole = fixedXPole(mu, x)
    let v = 0
    for (let i = 0; i < 2000; i++) v = pole * pole * v + (mu * x) ** 2 * sigma ** 2
    expect(v).toBeCloseTo((mu * sigma ** 2) / (2 - mu * x * x), 12)
    expect(v).toBeCloseTo(steadyStateVarW(mu, x, sigma), 12)
  })

  it('§0.8 一般化迴圈：預測以 (−)、y 以 (+) 進入相加點；誤差與 x 相乘後累加，回去修正 w', async () => {
    const s = await structure(chartOf('CHART_ADAPTIVE_LOOP'))
    expect(edgeLabel(s, 'F', 'S')).toBe(String.raw`$(-)$ 預測 $\hat y$`)
    expect(edgeLabel(s, 'D', 'S')).toBe('$(+)$ $y$')
    expect(edgeLabel(s, 'S', 'M')).toBe(String.raw`誤差 $e = y - \hat y$`)
    expect(s.edges.filter((e) => e.to === 'M').map((e) => e.from).sort()).toEqual(['S', 'X'])
    expect(edgeLabel(s, 'M', 'A')).toBe(String.raw`相關 $e\,x$`)
    expect(s.edges.some((e) => e.from === 'A' && e.to === 'F')).toBe(true) // 修正回授到可調係數
  })

  it('§0.8 黑盒子 → PLL：和圖 0.1 同一個模型（a 與 w 兩條路相減再加雜訊），方塊換成 PLL 的名字與單位', async () => {
    const s = await structure(chartOf('CHART_BLACKBOX_TO_PLL'))
    const toy = await structure(chartOf('CHART_BLACKBOX_MODEL'))
    expect(s.edges.filter((e) => e.from === 'X').map((e) => e.to).sort()).toEqual(['A', 'W'])
    expect(edgeLabel(s, 'A', 'S')).toBe(String.raw`$(+)$ $a\,x[n]$`) // 該抵消的時間誤差
    expect(edgeLabel(s, 'W', 'S')).toBe(String.raw`$(-)$ $w\,x[n]$`) // DTC 補償掉的
    expect(edgeLabel(s, 'V', 'S')).toBe('$(+)$ $v[n]$')
    expect(s.edges.filter((e) => e.from === 'S').map((e) => e.to)).toEqual(['E'])
    expect(nodeText(s, 'X')).toBe('DSM 量化殘差 DTC code $x[n]$')
    expect(nodeText(s, 'A')).toBe(String.raw`$\times\,a$ 正確的 DTC gain 未知，單位 fs/code`)
    expect(nodeText(s, 'W')).toBe(String.raw`$\times\,w$ gain register 的值 DTC 實際補償的量`)
    expect(nodeText(s, 'V')).toContain('雜訊 $v[n]$')
    // PD 量的是（經過 DTC 的）reference edge 減 feedback edge（docs/assumptions.md §2a）：e = t_ref′ − t_fb = (a − w)·x + v
    expect(nodeText(s, 'E')).toBe(String.raw`PD 量到的殘留誤差 $e[n] =$ $t_{\mathrm{ref}}'[n] - t_{\mathrm{fb}}[n]$ $= (a - w)\,x[n] + v[n]$`)
    // 對應的方塊用同一個顏色（未知的 a 深灰、我們的 w 藍、雜訊紅）
    for (const id of ['A', 'W', 'V']) expect(node(s, id).classes, id).toEqual(node(toy, id).classes)
    // PLL 裡只有一個相加點（y 與 ŷ 不會單獨出現）；黑盒子模型有兩個
    expect(s.nodes.filter(isSum)).toHaveLength(1)
    expect(toy.nodes.filter(isSum)).toHaveLength(2)
  })

  it('§0.8 PLL 校正迴圈：DTC 在 reference 輸入端、回授路徑只有 divider、校正迴路的輸入是 PD 的輸出；兩框互相連接；n／k 的寫法正確', async () => {
    const s = await structure(chartOf('CHART_PLL_LOOP'))
    const into = (to: string) => s.edges.filter((e) => e.to === to).map((e) => e.from).sort()
    const outOf = (from: string) => s.edges.filter((e) => e.from === from).map((e) => e.to).sort()
    const pair = (a: string, b: string) => s.edges.some((e) => e.from === a && e.to === b)
    expect([...box(s, 'MAIN').nodes].sort()).toEqual(['CT', 'DIV', 'DSM', 'DTC', 'LF', 'PD', 'REF'])
    expect([...box(s, 'CAL').nodes].sort()).toEqual(['CMP', 'G', 'U', 'XT'])

    // ① 訊號路徑（assumptions §2a 第 1 點）：Reference → DTC → PD → Loop filter；回授是 Loop filter（VCO）→ Divider → PD
    expect(pair('REF', 'DTC')).toBe(true)
    expect(pair('DTC', 'PD')).toBe(true)
    expect(pair('PD', 'LF')).toBe(true)
    expect(pair('LF', 'DIV')).toBe(true)
    expect(pair('DIV', 'PD')).toBe(true)
    // DTC 的輸入只有 reference、DSM 餘數 x[n] 與 gain register 的 w；PD 的輸入只有 DTC（reference 側）與 divider（回授側）
    expect(into('DTC')).toEqual(['DSM', 'REF', 'U'])
    expect(into('PD')).toEqual(['DIV', 'DTC'])
    // 回授路徑上沒有 DTC：divider 的輸入是 VCO 與 DSM 的 carry，輸出只去 PD；沒有 divider → DTC，也沒有 REF → PD 的直連線
    expect(into('DIV')).toEqual(['CT', 'LF'])
    expect(outOf('DIV')).toEqual(['PD'])
    expect(pair('DIV', 'DTC')).toBe(false)
    expect(pair('REF', 'PD')).toBe(false)
    expect(outOf('REF')).toEqual(['DTC'])
    // ② 小數除頻（§2a 第 2 點）：DSM 的 carry 控制 divider（標籤節點 CT），餘數 x[n] 控制 DTC
    expect(nodeText(s, 'CT')).toBe('carry （來自 DSM）')
    expect(outOf('DSM')).toEqual(['DTC'])
    expect(nodeText(s, 'DSM')).toBe('DSM 累加器 餘數 $x[n]$')
    expect(nodeText(s, 'DTC')).toBe(String.raw`DTC 補償 $w\,x[n]$`)
    // ③ LMS 校正迴路的輸入是 PD 的輸出 e[n]（§2a 第 3 點）：比較器只有一個輸入，來自 PD；PD → loop filter 與 PD → 比較器是同一個訊號 e[n]
    expect(into('CMP')).toEqual(['PD'])
    expect(edgeLabel(s, 'PD', 'CMP')).toBe('$e[n]$')
    expect(edgeLabel(s, 'PD', 'LF')).toBe('$e[n]$')
    expect(outOf('PD').sort()).toEqual(['CMP', 'LF'])
    for (const id of ['DTC', 'DIV', 'REF', 'DSM', 'CT']) expect(pair(id, 'CMP'), `${id} → CMP`).toBe(false) // 不從 DTC、divider 或其他地方分接
    expect(nodeText(s, 'PD')).toBe(String.raw`PD $e[n] =$ $(a - w)\,x[n] + v[n]$`)
    expect(nodeText(s, 'CMP')).toBe(String.raw`1-bit 比較器 $q[n] =$ $\mathrm{sign}(e[n])$`)
    expect(nodeText(s, 'G')).toBe(String.raw`GMAC：平均 $N$ 筆 $G[k] =$ $(1/N)\sum q[n]\,x[n]$`)
    expect(nodeText(s, 'U')).toBe(String.raw`更新 gain register $w[k+1] =$ $w[k] + \mu\,G[k]$`)
    expect(edgeLabel(s, 'CMP', 'G')).toBe('$q[n]$')
    expect(edgeLabel(s, 'G', 'U')).toBe('$G[k]$')
    expect(into('G')).toEqual(['CMP', 'XT']) // GMAC 的另一個輸入是同一個 code x[n]
    expect(nodeText(s, 'XT')).toBe('$x[n]$ （同一個 code）')
    // 校正迴路把 w 交回 DTC（迴圈閉合）；w 是 block 速率（k）才換一次
    expect(edgeLabel(s, 'U', 'DTC')).toBe('$w$ 給 DTC 每 $N$ 筆才更新一次')
    // 主路徑的訊號都是 sample 速率；[k] 只出現在 GMAC 的輸出與更新
    for (const id of box(s, 'MAIN').nodes) expect(nodeText(s, id), id).not.toMatch(/\[k/)
    expect(nodeText(s, 'CMP')).not.toMatch(/\[k/)
    for (const id of ['CMP', 'G', 'U']) expect(node(s, id).classes).toEqual(['focus'])
    // 每一條線都只出現一次（不是靠重複的線湊出來的）
    expect(new Set(s.edges.map((e) => `${e.from}>${e.to}`)).size).toBe(s.edges.length)
  })

  it('§0.9 LMS vs Sign-Error：只有 Conventional 那一框有乘法器；Sign-Error 那一框是比較器 + 條件變號；之後的路徑相同', async () => {
    const s = await structure(chartOf('CHART_LMS_VS_SIGN'))
    const inBox = (id: string) => s.nodes.filter((n) => box(s, id).nodes.includes(n.id))
    const lms = inBox('LMS')
    const sgn = inBox('SGN')
    expect(lms.filter(isMultiplier)).toHaveLength(1)
    expect(sgn.filter((n) => n.type === 'circle')).toHaveLength(0)
    expect(nodeText(s, 'C2')).toBe(String.raw`1-bit 比較器 $q[n] = \mathrm{sign}(e[n])$`)
    expect(nodeText(s, 'N2')).toBe(String.raw`條件變號 $+1$ 送 $x[n]$ $-1$ 送 $-x[n]$`)
    expect(lms.some((n) => n.text.includes('sign'))).toBe(false)
    expect(edgeLabel(s, 'C2', 'N2')).toBe('$q[n]$')
    expect(edgeLabel(s, 'M1', 'G1')).toBe(String.raw`$e[n]\,x[n]$`)
    expect(edgeLabel(s, 'N2', 'G2')).toBe(String.raw`$q[n]\,x[n]$`)
    expect(nodeText(s, 'G1')).toBe(String.raw`$\times\,\mu$ 再累加到 $w$`)
    expect(nodeText(s, 'G2')).toBe(nodeText(s, 'G1'))
    // 差異的方塊有上色；兩框之間沒有線（是兩種各自獨立的做法）
    for (const id of ['M1', 'C2', 'N2']) expect(node(s, id).classes.length, id).toBe(1)
    for (const e of s.edges) expect(box(s, 'LMS').nodes.includes(e.from)).toBe(box(s, 'LMS').nodes.includes(e.to))
  })

  /** 畫出來的節點中心（dagre 排版的結果；jsdom 用估計的字寬，但誰在誰的上面／左邊只由排版規則決定）。 */
  async function positions(chart: string): Promise<Record<string, { x: number; y: number }>> {
    const { svg } = await renderMermaidForTest(chart)
    const doc = new DOMParser().parseFromString(svg, 'text/html')
    const out: Record<string, { x: number; y: number }> = {}
    doc.querySelectorAll('g.node').forEach((g) => {
      const id = /^flowchart-(.+)-\d+$/.exec(g.id)?.[1]
      const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(g.getAttribute('transform') ?? '')
      if (id && m) out[id] = { x: Number(m[1]), y: Number(m[2]) }
    })
    return out
  }

  it('版面和說明文字一致（圖 0.3、0.12、0.14、0.15：宣告順序與連線方向決定畫在哪裡，被改掉時這裡會提醒）', async () => {
    // 圖 0.3：「① 預測」在上、「② 比較」在右、「③ 修正」在左下——順時針一圈，說明文字就是這樣寫的（x[n] 輸入在最左）
    const loop = await positions(chartOf('CHART_LOOP'))
    expect(loop.P.y, '① 預測在上').toBeLessThan(loop.C.y)
    expect(loop.P.x, '② 比較在 ① 預測的右邊').toBeLessThan(loop.C.x)
    expect(loop.U.x, '③ 修正在 ① 預測的左邊').toBeLessThan(loop.P.x)
    expect(loop.U.y, '③ 修正在 ① 預測的下面').toBeGreaterThan(loop.P.y)
    expect(loop.X.x, '輸入 x[n] 在最左').toBeLessThan(loop.U.x)
    // 圖 0.12：y（+）從上方、預測 ŷ（−）從下方進相加點，兩條輸入線不交纏
    const adaptive = await positions(chartOf('CHART_ADAPTIVE_LOOP'))
    expect(adaptive.D.y, 'y（+）在相加點上方').toBeLessThan(adaptive.S.y)
    expect(adaptive.F.y, '預測（−）來自相加點下方的 w').toBeGreaterThan(adaptive.S.y)
    // 圖 0.15：Mermaid 把後宣告的子圖畫在前面（上面）。說明文字：Conventional LMS 在上、Sign-Error LMS 在下
    expect((await structure(chartOf('CHART_LMS_VS_SIGN'))).subgraphs.map((g) => g.id)).toEqual(['SGN', 'LMS'])
    // 圖 0.14：訊號由左向右流（reference → DTC → PD），divider 在 PD 的右邊（回授），LMS 校正迴路在 PD 的右上方，比較器 → GMAC → 更新由左向右
    const pll = await positions(chartOf('CHART_PLL_LOOP'))
    expect(pll.REF.x, 'reference 在 DTC 的左邊').toBeLessThan(pll.DTC.x)
    expect(pll.DTC.x, 'DTC 在 PD 的左邊（reference 側）').toBeLessThan(pll.PD.x)
    expect(pll.PD.x, 'divider（回授）在 PD 的右邊').toBeLessThan(pll.DIV.x)
    expect(pll.PD.x, '比較器取自 PD 的輸出，在 PD 的右邊').toBeLessThan(pll.CMP.x)
    expect(pll.CMP.y, 'LMS 校正迴路在主路徑的上方').toBeLessThan(pll.PD.y)
    // 「x[n]（同一個 code）」標籤和比較器在同一直排：標籤要在比較器的上方（遠離 PD 的那一側）。
    // 反過來的話，PD → 比較器的 e[n] 線會從標籤後面穿過去，箭頭變成從 x[n] 標籤冒出來接到比較器——看起來像比較器的輸入是 x[n]
    expect(Math.abs(pll.XT.x - pll.CMP.x), 'x[n] 標籤和比較器在同一直排').toBeLessThan(40)
    expect(pll.XT.y, 'x[n] 標籤在比較器的上方，不擋住 PD → 比較器的 e[n] 線').toBeLessThan(pll.CMP.y)
    const src = chartOf('CHART_PLL_LOOP')
    expect(src.indexOf('XT(['), 'XT 要比 CMP 先宣告（決定上下順序）').toBeLessThan(src.indexOf('CMP['))
    expect(pll.CMP.x).toBeLessThan(pll.G.x)
    expect(pll.G.x).toBeLessThan(pll.U.x)
    expect(chartOf('CHART_PLL_LOOP')).toMatch(/^%%\{init: \{"flowchart": \{"nodeSpacing": \d+, "rankSpacing": \d+\}\}\}%%\nflowchart LR\n/) // 兩個框以橫向流程並排（縮小間距，自然寬度才放得進正文欄）
  })

  it('§0.9 比較器 + 累加：統計量的寫法和推導一致（總和 S_N，不是平均；勘誤 E18）', async () => {
    const s = await structure(chartOf('CHART_COMPARATOR_AVERAGE'))
    expect([...box(s, 'ONE').nodes].sort()).toEqual(['ADD', 'CMP', 'S0', 'V'])
    expect([...box(s, 'MANY').nodes].sort()).toEqual(['OK', 'SUM'])
    expect(nodeText(s, 'S0')).toBe(String.raw`真正的誤差 $s$ 很小（設 $s \gt 0$）`) // m_q ＞ 0 與「判對」都是對 s ＞ 0 說的
    expect(edgeLabel(s, 'S0', 'ADD')).toBe('$(+)$ $s$')
    expect(edgeLabel(s, 'V', 'ADD')).toBe('$(+)$ $v$')
    expect(edgeLabel(s, 'ADD', 'CMP')).toBe('$e = s + v$')
    expect(nodeText(s, 'CMP')).toBe(String.raw`1-bit 比較器 $q = \mathrm{sign}(e)$ $+1$ 的機率 $\Phi(s/\sigma_v)$`) // 推導第 1 步
    expect(edgeLabel(s, 'ONE', 'MANY')).toBe('$q[i]$：平均 $m_q$ 比 $0$ 大一點點') // 第 2 步
    expect(nodeText(s, 'SUM')).toBe(String.raw`$\sum$ 累加 $N$ 筆：總和 $S_N$ 平均 $N\,m_q$ 標準差 $\sqrt{N\,(1 - m_q^2)}$`) // 第 4 步
    expect(edgeLabel(s, 'SUM', 'OK')).toBe('$S_N$')
    expect(nodeText(s, 'OK')).toBe(String.raw`看 $S_N$ 的正負號 判對的機率約 $\Phi(m_q \sqrt{N} / \sqrt{1 - m_q^2})$`) // 第 5 步
    expect(chartOf('CHART_COMPARATOR_AVERAGE')).not.toContain('G_N')
  })

  it('§0.9 GMAC：sample 框裡的訊號只有 [n]，block 框裡只有 [k]；G[k] 是除以 N 之後的平均；累加器的延遲是一個 block', async () => {
    const s = await structure(chartOf('CHART_GMAC_BLOCK'))
    const fast = box(s, 'FAST')
    const slow = box(s, 'SLOW')
    expect(fast.title).toContain('索引 $n$')
    expect(slow.title).toContain('索引 $k$')
    const texts = (ids: string[]) => [
      ...s.nodes.filter((n) => ids.includes(n.id)).map((n) => n.text),
      ...s.edges.filter((e) => ids.includes(e.from) && ids.includes(e.to)).map((e) => e.label),
    ]
    for (const t of texts(fast.nodes)) expect(t, t).not.toMatch(/\[k(\+1)?\]/)
    for (const t of texts(slow.nodes)) expect(t, t).not.toMatch(/\[n(\+1)?\]/)
    expect([...fast.nodes].sort()).toEqual(['CMP', 'E', 'M', 'SUM', 'X'])
    expect([...slow.nodes].sort()).toEqual(['DIV', 'MU', 'R', 'S'])
    expect(edgeLabel(s, 'CMP', 'M')).toBe('$q[n]$')
    expect(edgeLabel(s, 'M', 'SUM')).toBe(String.raw`$q[n]\,x[n]$`)
    expect(edgeLabel(s, 'FAST', 'SLOW')).toBe('每 $N$ 筆（1 個 block） 交出一次總和') // 兩種速率只在這裡相接（<br/> 在 parser 輸出裡是一個空白）
    expect(s.edges.filter((e) => fast.nodes.includes(e.from) !== fast.nodes.includes(e.to) && e.from !== 'FAST')).toHaveLength(0)
    expect(nodeText(s, 'DIV')).toBe(String.raw`總和 $\div N$`)
    expect(edgeLabel(s, 'DIV', 'MU')).toBe('$G[k]$') // 先 ÷ N 才叫 G[k]（平均，不是總和）
    expect(edgeLabel(s, 'MU', 'S')).toBe(String.raw`$(+)$ $\mu\,G[k]$`)
    expect(edgeLabel(s, 'R', 'S')).toBe('$(+)$ $w[k]$')
    expect(edgeLabel(s, 'S', 'R')).toBe('$w[k+1]$')
    expect(nodeText(s, 'R')).toBe('$z^{-1}$：延遲一個 block gain register $w[k]$')
  })

  it('F-00.11 反例：a·x、κ·x、v′ 三條都以 (+) 相加，所以 y = (a + κ)·x + v′、w* = a + κ', async () => {
    const s = await structure(chartOf('CHART_CORRELATED_NOISE'))
    expect(s.edges.filter((e) => e.from === 'X').map((e) => e.to).sort()).toEqual(['A', 'K', 'L'])
    expect(edgeLabel(s, 'A', 'S')).toBe(String.raw`$(+)$ $a\,x$`)
    expect(edgeLabel(s, 'K', 'S')).toBe(String.raw`$(+)$ $\kappa\,x$`)
    expect(edgeLabel(s, 'VP', 'S')).toBe("$(+)$ $v'$")
    expect(edgeLabel(s, 'S', 'L')).toBe(String.raw`$y = (a + \kappa)\,x + v'$`)
    expect(nodeText(s, 'WS')).toBe(String.raw`平均停在 $w^* = a + \kappa$ 不是 $a$`)
    // 模型函式：E[vx] = κ·E[x²] ⇒ w* = a + κ
    expect(biasedFixedPoint(3, 0.2 * 1, 1)).toBeCloseTo(3 + 0.2, 12)
  })

  it('HC-00.8 綜合手算流程圖：四條支線的公式代入預設值，等於手算題 solve() 的五個答案', async () => {
    const s = await structure(chartOf('CHART_SYNTHESIS_ORDER'))
    // 四條支線都從「已知」出發
    expect(s.edges.filter((e) => e.from === 'IN').map((e) => e.to)).toEqual(['A1', 'B1', 'C1', 'D1'])
    expect(nodeText(s, 'A1')).toBe(String.raw`① 停在哪 $E[v\,x] = \kappa\,E[x^2]$`)
    expect(nodeText(s, 'A2')).toBe(String.raw`$w^* = a +$ $E[v\,x] / E[x^2]$`)
    expect(nodeText(s, 'B1')).toBe(String.raw`② 多久到 $p = 1 - \mu\,x^2$`)
    expect(nodeText(s, 'B2')).toBe(String.raw`降到 $1\%$ 的步數 $\lceil \ln 0.01 \div \ln |p| \rceil$`)
    expect(nodeText(s, 'C1')).toBe(String.raw`③ 抖多大 $\operatorname{Var}(w_\infty) =$ $\mu\,\sigma_{v'}^2 / (2 - \mu\,x^2)$`)
    expect(nodeText(s, 'C2')).toBe(String.raw`$\operatorname{std}(w_\infty) =$ $\sqrt{\operatorname{Var}(w_\infty)}$`)
    expect(nodeText(s, 'D1')).toBe(String.raw`④ 平均後多準 時間平均的標準差 $\approx \sigma_{v'} / \sqrt{n}$`)
    expect(s.edges.filter((e) => e.to === 'END').map((e) => e.from).sort()).toEqual(['A2', 'D1'])

    const def = HANDCALCS.find((h) => h.id === 'HC-00.8')!
    const v = Object.fromEntries(def.inputs.map((i) => [i.key, i.default])) as Record<'a' | 'kappa' | 'mu' | 'sv' | 'n', number>
    const sol = def.solve(v)
    const answer = (symbol: string) => sol.results.find((r) => r.symbol === symbol)!.value as number
    const [x2, ex2] = [1, 1] // x = ±1
    // ① 圖上的兩格
    const evx = v.kappa * ex2
    const wStar = v.a + evx / ex2
    expect(answer('w^*')).toBeCloseTo(wStar, 12)
    expect(biasedFixedPoint(v.a, evx, ex2)).toBeCloseTo(wStar, 12)
    // ②
    const p = 1 - v.mu * x2
    expect(answer('p')).toBeCloseTo(p, 12)
    expect(answer('n_{1\\%}')).toBe(Math.ceil(Math.log(0.01) / Math.log(Math.abs(p))))
    expect(stepsToFraction(p)).toBe(Math.ceil(Math.log(0.01) / Math.log(Math.abs(p))))
    // ③
    const varW = (v.mu * v.sv ** 2) / (2 - v.mu * x2)
    expect(steadyStateVarW(v.mu, 1, v.sv)).toBeCloseTo(varW, 14)
    expect(answer(String.raw`\operatorname{std}(w_\infty)`)).toBeCloseTo(Math.sqrt(varW), 12)
    // ④
    expect(answer(String.raw`\operatorname{std}(\bar w)`)).toBeCloseTo(v.sv / Math.sqrt(v.n), 12)
    expect(averagedStd(v.sv, v.n)).toBeCloseTo(v.sv / Math.sqrt(v.n), 14)
    // 最後一格要比的兩個量：偏移是標準差的好幾倍（所以平均救不了 bias）
    expect(Math.abs(wStar - v.a) / (v.sv / Math.sqrt(v.n))).toBeGreaterThan(10)
  })
})

describe('ch00 方塊圖：頁面上的位置', () => {
  it('<ChapterDiagram> 接上真正的 mermaid：畫出 SVG（不是錯誤框），圖說帶圖號，下面有導讀', async () => {
    const { container } = renderPage(
      <ChapterDiagram name="CHART_LMS_ACCUMULATOR">
        <p>先看乘法器，再看累加器。</p>
      </ChapterDiagram>,
    )
    await waitFor(() => expect(container.querySelector('.c-mermaid-svg svg')).not.toBeNull(), { timeout: 30_000 })
    // 圖上的文字（去掉 KaTeX 的 MathML 複本）：公式已排版，沒有殘留的 $
    const svgRoot = container.querySelector('.c-mermaid-svg')!.cloneNode(true) as Element
    svgRoot.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
    const svgText = squash(svgRoot.textContent ?? '')
    for (const t of ['暫存器', '(+)w[n]', '(+)μe[n]x[n]', 'w[n+1]']) expect(svgText, t).toContain(t)
    expect(svgText).not.toContain('Unsupported')
    expect(svgText).not.toContain('$')
    expect(container.querySelectorAll('.c-mermaid-svg .katex').length).toBeGreaterThanOrEqual(8)
    expect(container.querySelector('.c-mermaid-error')).toBeNull()
    expect(container.querySelector('figcaption')?.textContent).toMatch(/^圖 0\.4｜更新式畫成硬體/)
    expect(container.querySelector('.c-chapter-fig-walk')?.textContent).toBe('怎麼看圖 0.4先看乘法器，再看累加器。')
    await act(async () => {})
  })

  it(
    '整章渲染（beginner 模式）：章首有系統地圖，接著是全部方塊圖；每張圖都有圖號與導讀，而且在它要說明的公式／推導之前',
    async () => {
      localStorage.setItem('lmspll.mode', 'beginner')
      // 每張圖「真的畫得出來」已在上面逐張測過；整章的 DOM 很大，jsdom 裡真的排版 20 張圖要半分鐘，
      // 所以這裡只攔下頁面送給 mermaid 的原始碼（核對送出去的就是登錄清單裡那些），回傳一個小 SVG。
      const renderSpy = vi
        .spyOn(mermaid, 'render')
        .mockImplementation(async (id: string) => ({ svg: `<svg id="${id}" data-fake="1"></svg>`, diagramType: 'flowchart-v2' }))
      const { container } = renderPage(<Chapter00 />, { url: '/ch/00' })
      const total = DIAGRAMS.length + 1 // + 章首的系統地圖
      const figures = () => Array.from(container.querySelectorAll('figure.c-mermaid'))
      expect(figures()).toHaveLength(total)
      // 每一張都走完 Mermaid 元件的流程（不是停在「圖表載入中」，也不是解析失敗的警告框）
      await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg svg')).toHaveLength(total), { timeout: 60_000 })
      expect(container.querySelector('.c-mermaid-error')).toBeNull()
      expect(container.textContent).not.toContain('Mermaid 圖解析失敗')

      // 頁面實際送給 mermaid 的原始碼 = 登錄清單（每張圖都有 parser／renderer 測試，沒有漏網的圖）；
      // 章首的系統地圖是手排的 SVG，不經過 mermaid；
      // Mermaid 元件送出的是 sanitizeMermaidSource 處理過的版本（含公式的標籤已合併成 $$…$$）
      const rendered = renderSpy.mock.calls.map((c) => c[1])
      expect([...new Set(rendered)].sort()).toEqual(DIAGRAMS.map((d) => sanitizeMermaidSource(d.chart)).sort())

      // ── 系統地圖：緊接在「這一課要回答的問題」之後、§0.1 之前，後面有一句說明藍色方塊與本章範圍 ──
      const first = figures()[0]
      const question = container.querySelector('.ch00-question')!
      expect(question.nextElementSibling).toBe(first)
      expect(first.getAttribute('aria-label')).toContain('DTC-based Fractional-N PLL 與 Sign-LMS 校正迴路的系統方塊圖')
      for (const name of ['Fractional residue x[n]', 'Gain correction', '1-bit comparator', 'GMAC', 'Normalize + learning rate', 'Gain accumulator'])
        expect(first.getAttribute('aria-label'), name).toContain(name)
      // 手排的 SVG（不是 Mermaid 畫的）：本章標示的六個方塊就是 is-focus 的那六個，其餘方塊都不是主角
      expect(first.classList.contains('c-sysmap')).toBe(true)
      expect(first.querySelector('.c-mermaid-svg > svg.c-sysmap-svg')).not.toBeNull()
      const drawnBlocks = Array.from(first.querySelectorAll('g.c-sysmap-block'))
      expect(drawnBlocks).toHaveLength(systemMapModel(SYSTEM_MAP_FOCUS).blocks.length)
      const drawnFocus = drawnBlocks.filter((g) => g.classList.contains('is-focus'))
      expect(drawnFocus.map((g) => g.getAttribute('data-block')).sort()).toEqual([...SYSTEM_MAP_FOCUS].sort())
      expect(drawnFocus.every((g) => g.getAttribute('data-focus') === 'true')).toBe(true)
      expect(drawnBlocks.filter((g) => !g.classList.contains('is-focus')).every((g) => !g.hasAttribute('data-focus'))).toBe(true)
      expectNoTexErrors(first)
      expect(squash(drawnFocus.map((g) => g.textContent).join(''))).toContain('Gainaccumulator')
      const note = first.nextElementSibling!
      expect(note.className).toBe('ch00-map-note c-map-note') // c-map-note：PageFrame 的章首 strip 排在它後面（teaching-style §9）
      expect(note.textContent).toContain('藍色的六個方塊就是 LMS 校正迴路本身')
      expect(note.textContent).toContain('黑盒子')
      expect(note.textContent).toContain('預測 → 比較 → 修正')
      const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      expect(before(first, container.querySelector('#ch00-blackbox')!)).toBe(true)
      // 圖例說明圖上的寫法（方括號、相加點、z⁻¹、顏色）：圖上的符號在圖例裡也用 KaTeX 排版
      const legend = container.querySelector('.ch00-legend')!
      expect(before(legend, container.querySelector('#ch00-blackbox')!)).toBe(true)
      for (const t of ['方括號是時間索引', '相加點', '暫存器', '顏色']) expect(legend.textContent, t).toContain(t)
      for (const tex of ['x[n]', 'w[n+1]', 'w[k]', '(+)', '(-)', String.raw`\times`, 'z^{-1}']) {
        const hit = Array.from(legend.querySelectorAll('annotation[encoding="application/x-tex"]')).some((a) => a.textContent === tex)
        expect(hit, `圖例的 ${tex}`).toBe(true)
      }
      expectNoTexErrors(legend)
      expect(legend.querySelectorAll('.ch00-swatch')).toHaveLength(4)

      // ── 本章的方塊圖：順序、段落、圖號、導讀、位置 ──
      const blocks = Array.from(container.querySelectorAll('.c-chapter-fig'))
      expect(blocks.map((b) => b.getAttribute('data-diagram'))).toEqual(DIAGRAMS.map((d) => d.name))
      for (const d of DIAGRAMS) {
        const el = container.querySelector(`[data-diagram="${d.name}"]`)!
        const label = figureLabel(d.name as DiagramName)
        expect(el.id, d.name).toBe(`fig-${d.id}`)
        expect(el.closest('section[id]')?.id, d.name).toBe(d.section)
        // 圖說：圖號 + 要看什麼
        // （Mermaid 的圖說把 `$…$` 交給 KaTeX：純文字的部分原樣保留，每一段 LaTeX 變成一個 .katex）
        const cap = el.querySelector('figcaption')!
        expect(cap.textContent?.startsWith(`${label}｜`), d.name).toBe(true)
        const capParts = d.caption.split('$')
        capParts.forEach((part, i) => {
          if (i % 2 === 0 && part) expect(cap.textContent, d.name).toContain(part)
        })
        expect(cap.querySelectorAll('.katex'), d.name).toHaveLength((capParts.length - 1) / 2)
        expectNoTexErrors(cap, d.name)
        expect(el.querySelector('figure')?.getAttribute('aria-label'), d.name).toBe(`${label}：${d.ariaLabel}`)
        // 導讀：「先看…再看…」＋「圖上的 X 就是公式裡的 x」
        const walk = el.querySelector('.c-chapter-fig-walk')!
        expect(walk.querySelector('.c-chapter-fig-walk-label')?.textContent, d.name).toBe(`怎麼看${label}`)
        const text = walk.textContent ?? ''
        expect(text.length, d.name).toBeGreaterThan(80)
        expect(text, d.name).toMatch(/先(看|由|從)/)
        expect(text, d.name).toMatch(/再看|最後看/)
        expect(text, d.name).toMatch(/圖上/)
        expect(walk.querySelectorAll('.katex').length, d.name).toBeGreaterThan(0) // 用 KaTeX 把圖上的名字接回公式
        expectNoTexErrors(walk, d.name)
        // 導讀裡不再用 <code> 拼圖上的公式（數學一律 KaTeX）
        expect(walk.querySelector('code'), `${d.name} 導讀裡不放 <code> 拼的公式`).toBeNull()
        // 在它要說明的公式／推導／手算題之前
        const target = d.before.startsWith('CHART_') ? container.querySelector(`[data-diagram="${d.before}"]`) : container.querySelector(`[id="${d.before}"]`)
        expect(target, `${d.name} → ${d.before}`).not.toBeNull()
        expect(before(el, target!), `${d.name} 應在 ${d.before} 之前`).toBe(true)
        // …而且在同一個段落裡（先看圖，馬上接數學）
        expect(target!.closest('section[id^="ch00-"]')?.id, d.name).toBe(d.section)
      }
      // 每個講概念的段落（§0.1–§0.10）至少一張圖
      for (const id of ['ch00-blackbox', 'ch00-loop', 'ch00-update', 'ch00-hand', 'ch00-playground', 'ch00-why-ex', 'ch00-noise', 'ch00-why-matters', 'ch00-sign', 'ch00-assumptions'])
        expect(container.querySelectorAll(`#${id} .c-chapter-fig`).length, id).toBeGreaterThanOrEqual(1)
      // 有編號的公式 F-00.1 … F-00.11：同一個段落裡、公式之前，都找得到一張圖（先看圖、再看數學）
      for (let k = 1; k <= 11; k++) {
        const f = container.querySelector(`[id="formula-F-00.${k}"]`)!
        expect(f, `F-00.${k}`).not.toBeNull()
        const sec = f.closest('section[id^="ch00-"]')!
        const earlier = Array.from(sec.querySelectorAll('.c-chapter-fig')).filter((b) => before(b, f))
        expect(earlier.length, `F-00.${k}`).toBeGreaterThanOrEqual(1)
      }
      // 內文裡的「圖 0.n」是按鈕：點了捲到那張圖（不是會改變路由的 href）
      const ref = Array.from(container.querySelectorAll('button.c-figref')).find((b) => b.textContent === figureLabel('CHART_ERROR_RECURSION'))!
      const scroll = vi.mocked(Element.prototype.scrollIntoView)
      scroll.mockClear()
      fireEvent.click(ref)
      expect(scroll).toHaveBeenCalledTimes(1)
      expect((scroll.mock.contexts[0] as Element).id).toBe(`fig-${diagramByName('CHART_ERROR_RECURSION').id}`)
      expect(container.querySelector('a[href^="#fig-"], a[href="#symbols"]')).toBeNull()

      await act(async () => {})
      renderSpy.mockRestore()
      localStorage.clear()
    },
    120_000,
  )
})

describe('ch00 方塊圖：KaTeX 警告', () => {
  it('標籤的 TeX 沒有觸發 KaTeX 的 strict 警告；唯一的例外是步驟編號 ①②③④（文字模式，只是缺字型度量，瀏覽器用後備字型顯示）', () => {
    const other = katexWarnings.filter((m) => !/[①②③④]/.test(m))
    expect(other).toEqual([])
    // 確實有攔到（①②③④ 在 §0.2、§0.4、§0.10 的圖裡）
    expect(katexWarnings.length).toBeGreaterThan(0)
  })
})
