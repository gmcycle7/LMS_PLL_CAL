import { configure } from '@testing-library/react'
import { systemMapModel } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { normCdf, normInv, binomPmf } from '@/simulation/core'
import {
  blockLoopLinear,
  comparatorTransitions,
  directionExact,
  kq,
  metaProb,
  kqLocal,
  linearizationRelError,
  meanGmacEncoding,
  meanQ,
  minNForTarget,
  pPlus,
  samplesForConfidence,
  samplesSmallSignal,
  signLoopLinearRms,
  signLoopStationary,
  sumMoments,
  sumVarianceAr1,
  tieRuleEquilibrium,
  tieRuleEquilibriumApprox,
  varQ,
} from '@/simulation/models/comparator'
import * as D from './diagrams'
import { CH05_DIAGRAMS, CH05_SYSTEM_FOCUS, diagramOf, type DiagramKey } from './diagrams'
import { HANDCALCS } from './handcalcs'
import Chapter05 from './index'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

/**
 * Ch05 的方塊圖（docs/teaching-style.md §8）：
 *  1. 每一張圖的 Mermaid 原始碼都用「真正的」mermaid parser 解析，並且用共用的測試工具（@/components/mermaidTestUtils）
 *     「真的畫一次」：畫出來的文字不含 Unsupported markdown 與殘留的 `$`，節點數不超過 14（parser 抓不到這類問題），
 *     每個含公式的標籤都排成 KaTeX（mathCount），KaTeX 以外的文字沒有 Unicode 拼的數學（unicodeMathIn）。
 *     圖裡的數學一律是 `$...$` LaTeX（teaching-style §3）：下面比對「圖上寫死的式子」時，比的是原始碼裡的 TeX 字串。
 *  2. 圖的張數、加法點的正負號標示、δ = a − w 的回授極性、sample／block 速率的寫法、迴路是否真的閉合。
 *  3. 圖上寫死的數字與結論，由 src/simulation 的函式重算核對（圖不可以和公式不一致）。
 *  4. 整頁渲染：章首有 <SystemMap>，每張登錄的圖都依序出現、有圖說與導讀，而且排在它對應的公式之前；符號表在頁面最後。
 *
 * 整頁渲染時只把 <Mermaid> 元件換成輕量替身（把原始碼放在 data-chart），因為 jsdom 沒有 SVG 排版；parser 與逐張真實渲染不 mock mermaid。
 */

// 多個 agent／開發者同時跑測試時 CPU 會嚴重超額：放寬的只是等待時間，不是任何數值判準。
configure({ asyncUtilTimeout: 120_000 })
vi.setConfig({ testTimeout: 600_000 })
const SLOW = 600_000

vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  return {
    Mermaid: ({ chart, caption, ariaLabel }: { chart: string; caption?: string; ariaLabel?: string }) =>
      createElement(
        'figure',
        { className: 'c-mermaid', 'data-chart': chart, 'aria-label': ariaLabel ?? caption },
        caption ? createElement('figcaption', { className: 'c-figcaption' }, caption) : null,
      ),
    renderMermaid: async () => '<svg></svg>',
  }
})

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

beforeAll(installMermaidSvgShim)

interface Vertex {
  id: string
  text?: string
  type?: string
  classes?: string[]
}
interface Edge {
  start: string
  end: string
  text?: string
  /** 原始碼裡的標籤（全形＋ 尚未換成半形） */
  raw: string
}
interface FlowDb {
  getVertices(): Map<string, Vertex>
  getEdges(): { start: string; end: string; text?: string }[]
  getClasses(): Map<string, unknown>
  getSubGraphs(): { id: string }[]
}

interface Parsed {
  type: string
  /** 節點（subgraph 的框不算節點：`A ~~~ B` 這種看不見的連線會讓 parser 把 subgraph 的 id 也列成 vertex） */
  vertices: Vertex[]
  edges: Edge[]
  classes: string[]
  /** 所有標籤（節點與邊）的原始文字 */
  rawLabels: string[]
}

/** 圖上的正號寫成全形「＋」（U+FF0B）；比對語意時換回半形，原始碼本身另有 MD_BLOCK 檢查。 */
const shown = (t: string | undefined) => (t ?? '').replace(/\\\+/g, '+').replace(/＋/g, '+')

/** 標籤裡的 `$...$`（一段公式；標籤內不放 `\$`）。 */
const MATH = /\$[^$]+\$/g
/** 拿掉 `$` 分隔符，只剩 TeX 內容（比對正負號開頭用）。 */
const unTex = (t: string | undefined) => (t ?? '').replace(/\$/g, '')
/** 標籤中不在 `$...$` 裡的文字（逐行、逐段，去掉空白）：這些字會原樣畫在圖上。 */
const proseOf = (label: string) =>
  label
    .split(/<br\s*\/?>/)
    .flatMap((line) => line.split(MATH))
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
/** 原始碼中所有雙引號標籤的內容（節點、連線、subgraph 標題）。 */
const labelsOf = (chart: string) => (chart.match(/"[^"\n]*"/g) ?? []).map((l) => l.slice(1, -1))
/** 原始碼中含公式的雙引號標籤（節點、連線、subgraph 標題）：Mermaid 會把每一個合併成一個 KaTeX 區塊。 */
const mathLabelsOf = (chart: string) => chart.match(/"[^"\n]*\$[^"\n]*"/g) ?? []
/** 原始碼裡所有 `$...$` 的 TeX 內容。 */
const texSegmentsOf = (chart: string) => [...chart.matchAll(/\$([^$"\n]+)\$/g)].map((m) => m[1])
/** KaTeX 畫出來的文字：不換行空白與零寬空白換成一般空白，才能和原始碼的文字比對。 */
const flat = (t: string) => t.replace(/[\u00a0\u200b]/g, ' ').replace(/\s+/g, ' ')

async function parse(chart: string): Promise<Parsed> {
  const mermaid = (await import('mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
  const res = await mermaid.parse(chart)
  const type = res && typeof res === 'object' ? (res as { diagramType: string }).diagramType : ''
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDb
  const subgraphIds = new Set(db.getSubGraphs().map((sg) => sg.id))
  const rawV = [...db.getVertices().values()].filter((v) => !subgraphIds.has(v.id))
  const rawE = db.getEdges().filter((e) => !subgraphIds.has(e.start) && !subgraphIds.has(e.end))
  return {
    type,
    vertices: rawV.map((v) => ({ ...v, text: shown(v.text) })),
    edges: rawE.map((e) => ({ start: e.start, end: e.end, text: shown(e.text), raw: e.text ?? '' })),
    classes: [...db.getClasses().keys()],
    rawLabels: [...rawV.map((v) => v.text ?? ''), ...rawE.map((e) => e.text ?? '')].filter((t) => t.length > 0),
  }
}

type Rendered = Awaited<ReturnType<typeof renderMermaidForTest>>
const renderCache = new Map<string, Promise<Rendered>>()
/** 每張圖只真的渲染一次（逐張檢查與版面檢查共用）。 */
function renderOnce(key: string, chart: string): Promise<Rendered> {
  let r = renderCache.get(key)
  if (!r) {
    r = renderMermaidForTest(chart)
    renderCache.set(key, r)
  }
  return r
}

/**
 * Mermaid 11 把每個標籤當 markdown 解析：某一行以清單／標題／引用符號開頭時，畫面上會變成「Unsupported markdown: …」。
 * （例如單獨的 "+"、"+ a"、"- w"、"1. …"、"# …"、"> …"。）所以正號一律寫全形「＋」，負號寫「−」（U+2212）。
 */
const MD_BLOCK = /^\s*([-+*]|#{1,6}|>|\d+[.)])(\s|$)/

const chartOf = (key: DiagramKey) => diagramOf(key).chart
/** 進入某個節點的所有邊的標籤。 */
const into = (edges: Edge[], id: string) => edges.filter((e) => e.end === id).map((e) => e.text ?? '')
const edgeOf = (edges: Edge[], start: string, end: string) => {
  const e = edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`找不到連線 ${start} → ${end}`)
  return e
}
/** 沿著箭頭（至少走一步）能不能從 from 走到 to。 */
function reaches(edges: Edge[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const queue = edges.filter((e) => e.start === from).map((e) => e.end)
  while (queue.length) {
    const id = queue.shift()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) if (e.start === id) queue.push(e.end)
  }
  return false
}

describe('Ch05 方塊圖：登錄表與張數', () => {
  it('共 28 張（原有 1 張 + 新增 27 張，含 §5b 的非理想 comparator），圖號連續，key 不重複；加上章首的系統地圖共 29 張', () => {
    expect(CH05_DIAGRAMS).toHaveLength(28)
    expect(CH05_DIAGRAMS.filter((d) => d.isNew)).toHaveLength(27)
    expect(CH05_DIAGRAMS.filter((d) => !d.isNew).map((d) => d.key)).toEqual(['l1Model'])
    expect(CH05_DIAGRAMS.map((d) => d.no)).toEqual(CH05_DIAGRAMS.map((_, i) => i + 1))
    expect(new Set(CH05_DIAGRAMS.map((d) => d.key)).size).toBe(CH05_DIAGRAMS.length)
    // teaching-style §8：每章至少 5 張、重要章節 8 張以上（含系統地圖）
    expect(CH05_DIAGRAMS.length + 1).toBeGreaterThanOrEqual(8)
  })

  it('diagrams.ts 匯出的每一個 CHART_* 字串都登錄在表內（沒有孤兒，也沒有重複使用同一張）', () => {
    const exported = Object.entries(D).filter(([name]) => name.startsWith('CHART_'))
    expect(exported.length).toBe(CH05_DIAGRAMS.length)
    for (const [name, chart] of exported) {
      expect(typeof chart, name).toBe('string')
      expect(CH05_DIAGRAMS.filter((d) => d.chart === chart).length, name).toBe(1)
    }
  })

  it('每張圖都有一句圖說與文字替代說明；圖說與圖裡的數學都用成對的 $...$ LaTeX（圖說不用 Unicode 拼數學）；替代說明（純文字）不含 $', () => {
    const unicodeMath = /[Α-Ωα-ω√≈≤≥≠∝∑∫²³⁻]/
    // 圖的原始碼裡 `$...$` 內只能是 TeX 指令與 ASCII：不能把 σ、≤、√、²、· 等 Unicode 數學符號直接寫進公式
    const unicodeInTex = /[\u0370-\u03ff\u2070-\u209f\u00b2\u00b3\u00b9∑∏√∞≤≥≠≈±∓·×÷∂∇∈∝⌊⌋⌈⌉ℒ𝒩−½]/u
    for (const d of CH05_DIAGRAMS) {
      expect(d.caption.length, d.key).toBeGreaterThanOrEqual(15)
      expect(d.alt.length, d.key).toBeGreaterThanOrEqual(15)
      expect(d.alt, d.key).not.toContain('$')
      expect((d.caption.match(/(?<!\\)\$/g) ?? []).length % 2, `${d.key} 圖說的 $ 沒有成對`).toBe(0)
      expect(d.caption, `${d.key} 圖說裡有 Unicode 拼的數學`).not.toMatch(unicodeMath)
      // 圖裡的數學：有公式、每個標籤的 $ 成對、公式是 TeX（沒有 Unicode 拼的數學，也沒有 Mermaid 會吃掉的雙反斜線）
      expect(d.chart, d.key).toContain('$')
      for (const label of mathLabelsOf(d.chart)) expect((label.match(/\$/g) ?? []).length % 2, `${d.key}：${label} 的 $ 沒有成對`).toBe(0)
      for (const tex of texSegmentsOf(d.chart)) expect(tex, `${d.key} 的公式「${tex}」`).not.toMatch(unicodeInTex)
      expect(d.chart, `${d.key}：標籤內不能用雙反斜線（Mermaid 會收成一個）`).not.toContain('\\\\')
    }
  })

  it('系統地圖標出本章的主角：雜訊、1-bit comparator、GMAC（系統地圖是手排的 SVG，不經過 Mermaid；以 systemMapModel 核對）', () => {
    expect(CH05_SYSTEM_FOCUS).toEqual(['noise', 'cmp', 'gmac'])
    const focused = systemMapModel(CH05_SYSTEM_FOCUS).blocks.filter((b) => b.focused)
    expect(focused.map((b) => b.id).sort()).toEqual([...CH05_SYSTEM_FOCUS].sort())
    // 三個主角的方塊文字：comparator 前的雜訊 v[n]、1-bit comparator、GMAC
    const text = (id: string) => {
      const b = focused.find((x) => x.id === id)!
      return flat(`${b.title} ${b.sub ?? ''}`)
    }
    expect(text('cmp')).toContain('1-bit comparator')
    expect(text('gmac')).toContain('GMAC')
    expect(text('noise')).toContain('v[n]')
    // 主角方塊上的數學一律是 LaTeX（不用 Unicode 拼的 ∑、下標、希臘字母），也沒有沒配對的 $
    for (const id of CH05_SYSTEM_FOCUS) {
      expect(unicodeMathIn(text(id)), `系統地圖的 ${id} 方塊`).toEqual([])
      expect((text(id).match(/(?<!\\)\$/g) ?? []).length % 2, `系統地圖的 ${id} 方塊的 $ 要成對`).toBe(0)
    }
    // 其餘的方塊都不是主角
    const others = systemMapModel(CH05_SYSTEM_FOCUS).blocks.filter((b) => !b.focused).map((b) => b.id)
    expect(others.length).toBeGreaterThan(0)
    for (const id of CH05_SYSTEM_FOCUS) expect(others).not.toContain(id)
  })
})

describe('Ch05 方塊圖：真正的 mermaid parser 與真實渲染', () => {
  it.each(CH05_DIAGRAMS.map((d) => [`圖 5-${d.no} ${d.key}`, d] as const))(
    '%s：語法正確、節點不超過 14 個、加法點的每條輸入都標了正負號、公式都排成 KaTeX、真的畫得出來',
    async (_name, d) => {
      const g = await parse(d.chart)
      expect(g.type).toBe('flowchart-v2')
      // 大小限制（teaching-style §8）：單張不超過約 14 個節點
      expect(g.vertices.length).toBeGreaterThanOrEqual(4)
      expect(g.vertices.length).toBeLessThanOrEqual(14)
      // 每個節點都有文字；每個節點至少連到一條邊
      for (const v of g.vertices) {
        expect((v.text ?? '').trim().length, `${d.key}:${v.id}`).toBeGreaterThan(0)
        expect(g.edges.some((e) => e.start === v.id || e.end === v.id), `${d.key}:${v.id} 沒有連線`).toBe(true)
      }
      // 加法點（圓形、文字是 ＋）：至少兩條輸入，而且每條輸入的標籤都以 + 或 − 開頭（正負號寫在公式裡：`$+ s$`、`$- \\theta$`）
      const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '+')
      for (const s of sums) {
        const labels = into(g.edges, s.id)
        expect(labels.length, `${d.key}:${s.id}`).toBeGreaterThanOrEqual(2)
        for (const l of labels) expect(unTex(l), `${d.key}:${s.id} 的輸入「${l}」沒有標正負號`).toMatch(/^[+−-]/)
      }
      // 加法點的圓圈裡一律是全形「＋」（半形的單獨 + 會被當成 markdown 清單）
      for (const v of g.vertices.filter((x) => x.type === 'circle')) expect(v.text, `${d.key}:${v.id}`).toBe('+')
      // 原始碼裡每個標籤的每一行都不以 markdown 區塊符號開頭（正號寫全形＋、負號寫 U+2212）
      for (const label of g.rawLabels) {
        for (const line of label.split(/<br\s*\/?>/)) expect(line, `${d.key}：「${label}」會被當成 markdown 區塊`).not.toMatch(MD_BLOCK)
      }
      // 用到的 class 都有 classDef；顏色只用規範的三種
      for (const v of g.vertices) for (const c of v.classes ?? []) expect(g.classes, `${d.key}:${v.id}`).toContain(c)
      for (const c of g.classes) expect(['focus', 'warn', 'ok']).toContain(c)
      // 標籤內沒有裸的 '<'（只允許 <br/>）：strict 模式下會被當成 HTML tag
      expect(d.chart.replace(/<br\/>/g, '')).not.toContain('<')
      // 公式以外的文字不用連字號當負號（「a - w」「- w_k」要寫進 `$...$`，由 TeX 排成真正的減號），
      // 也沒有 Unicode 拼的數學（含混在公式標籤裡的文字：Mermaid 會把它們包進 \text{}、畫在 KaTeX 區塊內，畫出來後無法再分辨）
      for (const l of labelsOf(d.chart)) {
        expect(l.replace(MATH, ''), `${d.key}：「${l}」`).not.toMatch(/(^|\s)-\s?[a-zA-Zμθδ]/)
        for (const part of proseOf(l)) expect(unicodeMathIn(part), `${d.key}：「${l}」公式以外的文字「${part}」`).toEqual([])
      }

      // 真的畫一次（與網站相同的前處理）：沒有 Unsupported markdown、節點數 ≤ 14、每個節點都畫出來
      const { text, nodeCount, mathCount, plainText } = await renderOnce(d.key, d.chart)
      expect(text, d.key).not.toMatch(/Unsupported markdown/)
      expect(text, d.key).not.toMatch(/Syntax error/)
      expect(nodeCount, d.key).toBeLessThanOrEqual(14)
      expect(nodeCount, `${d.key}：畫出來的節點數應等於原始碼的節點數`).toBe(g.vertices.length)
      // 圖上的數學：畫出來的文字沒有殘留的 `$`；KaTeX 以外的文字沒有 Unicode 拼的數學；
      // 每個含公式的標籤（節點、連線、subgraph 標題）都排成一個 KaTeX 區塊
      expect(text, `${d.key}：圖上不應殘留 $`).not.toContain('$')
      expect(unicodeMathIn(plainText), `${d.key}：KaTeX 以外還有 Unicode 拼的數學`).toEqual([])
      expect(mathCount, d.key).toBeGreaterThan(0)
      expect(mathCount, `${d.key}：含公式的標籤數`).toBe(mathLabelsOf(d.chart).length)
      // 圖上看得到的文字 = 原始碼的標籤：加法點畫成 ＋，每個標籤裡公式以外的文字（逐行、逐段）都出現
      expect((text.match(/＋/g) ?? []).length, `${d.key} 的加法點`).toBeGreaterThanOrEqual(sums.length)
      for (const label of labelsOf(d.chart)) {
        for (const part of proseOf(label)) expect(flat(text), `${d.key} 的標籤「${label}」`).toContain(part)
      }
    },
    SLOW,
  )
})

describe('Ch05 方塊圖：版面（上下／左右的位置用語要和實際排版一致；太寬的橫排改成直式）', () => {
  it('圖說與導讀裡的「上框／下框」「左框／右框」「從左到右」「最上面的菱形」「由上往下」由實際排版核對', async () => {
    // 節點大小是 jsdom 的替身，但 dagre 的上下／左右順序只由圖的結構決定
    const keys = [
      'exactVsClt', 'analogVs1bit', 'smallSignal', 'l1Model', 'singleCompare', 'sampleLoop', 'linearizedLoop', 'blockLoop', 'lastSample',
      'hwMap', 'tieRules', 'sCurveRegions', 'ditherRegimes', 'methodChoice', 'signBlockLoop', 'ar1',
      'roadmap', 'firstCalc', 'qStats', 'bitMapping', 'signalVsNoise', 'sumVsAvg', 'decision', 'designFlow', 'mcCheck', 'nonidealCmp',
    ] as const
    const svgs = new Map<string, string>()
    for (const key of keys) svgs.set(key, (await renderOnce(key, chartOf(key))).svg)
    const shift = (el: Element | null) => {
      let x = 0
      let y = 0
      for (let e = el; e && e.tagName.toLowerCase() !== 'svg'; e = e.parentElement) {
        const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(e.getAttribute('transform') ?? '')
        if (m) {
          x += Number(m[1])
          y += Number(m[2])
        }
      }
      return { x, y }
    }
    const dom = (key: string) => {
      const host = document.createElement('div')
      host.innerHTML = svgs.get(key)!
      return host
    }
    const node = (host: Element, id: string) => shift(Array.from(host.querySelectorAll('g.node')).find((g) => new RegExp(`^flowchart-${id}-\\d+$`).test(g.id)) ?? null)
    /** 節點所在的子圖（subgraph）在整張圖裡的位置：每個 subgraph 是一個獨立排版的 g.root，位置由它的 translate 決定。 */
    const rootOf = (host: Element, id: string) => {
      const n = Array.from(host.querySelectorAll('g.node')).find((g) => new RegExp(`^flowchart-${id}-\\d+$`).test(g.id))
      return shift(n?.closest('g.root') ?? null)
    }
    // 「上框／下框」：兩個 subgraph 上下排（上框的排版位置在下框上面），不是左右並排；
    // 對照組：拿掉那條看不見的連線（A ~~~ B）兩個框就會同一高度、左右並排，所以那條連線是必要的
    for (const [key, topNode, bottomNode] of [
      ['exactVsClt', 'E1', 'C1'],
      ['smallSignal', 'S1', 'S2'],
    ] as const) {
      const host = dom(key)
      expect(rootOf(host, topNode).y, `${key}：上框應在下框上面`).toBeLessThan(rootOf(host, bottomNode).y)
      expect(chartOf(key), key).toMatch(/^ {2}\w+ ~~~ \w+$/m)
      const control = document.createElement('div')
      control.innerHTML = (await renderMermaidForTest(chartOf(key).replace(/^ {2}\w+ ~~~ \w+$/m, ''))).svg
      expect(rootOf(control, topNode).y, `${key}（沒有看不見的連線）：兩個框會並排在同一高度`).toBe(rootOf(control, bottomNode).y)
    }
    // 「左框／右框」（類比 vs 1-bit）：兩個直式的框左右並排，理想（類比）在左、實際硬體（1-bit）在右；框內是由上往下
    {
      const host = dom('analogVs1bit')
      expect(rootOf(host, 'A1').x, '類比（左框）應在 1-bit（右框）左邊').toBeLessThan(rootOf(host, 'B1').x)
      expect(chartOf('analogVs1bit')).toMatch(/^ {2}AN ~~~ OB$/m)
      // 對照組：拿掉那條看不見的連線，兩個框的左右順序就不受控制（類比框不再在 1-bit 框左邊），所以那條連線是必要的
      const control = document.createElement('div')
      control.innerHTML = (await renderMermaidForTest(chartOf('analogVs1bit').replace(/^ {2}AN ~~~ OB$/m, ''))).svg
      expect(rootOf(control, 'A1').x, 'analogVs1bit（沒有看不見的連線）：類比框不再在 1-bit 框左邊').toBeGreaterThanOrEqual(rootOf(control, 'B1').x)
      for (const [first, last] of [['A1', 'A4'], ['B1', 'B5']] as const) {
        expect(node(host, first).y, `analogVs1bit：${first} 應在 ${last} 上面`).toBeLessThan(node(host, last).y)
      }
      // 框內的方塊是直式排列（同一直行），不是橫排
      expect(node(host, 'B1').x).toBeCloseTo(node(host, 'B5').x, 0)
    }
    // subgraph 內仍是由左到右（direction LR 沒有被看不見的連線取消）
    const ex = dom('exactVsClt')
    expect(node(ex, 'E1').x).toBeLessThan(node(ex, 'E2').x)
    expect(node(ex, 'C1').x).toBeLessThan(node(ex, 'C2').x)
    expect(node(ex, 'C2').x).toBeLessThan(node(ex, 'C3').x)
    // LR 的鏈：起點在左、終點在右（「先看左邊…最後看右邊」「從左邊的 a 出發」）；長的迴路與流程改成直式（下一組）
    for (const [key, first, last] of [
      ['l1Model', 'S', 'DEC'],
      ['singleCompare', 'S', 'SGN'],
      ['sampleLoop', 'A', 'D'],
      ['linearizedLoop', 'A', 'D'],
      ['blockLoop', 'A', 'INT'],
      ['lastSample', 'A3', 'DP'],
    ] as const) {
      const host = dom(key)
      expect(node(host, first).x, `${key}：${first} 應在 ${last} 左邊`).toBeLessThan(node(host, last).x)
    }
    // TB 的決策樹與流程：根在最上面（「先看最上面的菱形」「由上往下」）
    for (const [key, root, leaf] of [
      ['tieRules', 'T0', 'B3'],
      ['sCurveRegions', 'R0', 'SAT'],
      ['ditherRegimes', 'Q0', 'B2'],
      ['methodChoice', 'Q1', 'CC'],
      ['hwMap', 'DTC', 'ACC'], // 階段多，橫排會寬到字縮得太小，所以硬體路徑圖是直式：由上往下是訊號的流向（reference → DTC → PD 在最上面，累加器在最下面）
      ['ar1', 'ZI', 'VAR'],
      ['signBlockLoop', 'A', 'INT'], // 八個方塊的迴路橫排會寬到 1,500 px，改成直式：由上往下是訊號的流向，回授線走旁邊
      ['decision', 'QS', 'TIE'], // 「先看上面三格」
      ['roadmap', 'Q0', 'P9'],
      ['firstCalc', 'IN', 'SNR'],
      ['qStats', 'Q', 'VAR'],
      ['bitMapping', 'CMP', 'GOOD'],
      ['signalVsNoise', 'Q', 'SNR'],
      ['sumVsAvg', 'QS', 'SNR'],
      ['designFlow', 'PT', 'TT'],
      ['mcCheck', 'M1', 'PASS'],
      ['nonidealCmp', 'PD', 'GM'], // §5b：PD 輸出在最上面，GMAC 在最下面；門檻的回授線走旁邊
    ] as const) {
      const host = dom(key)
      expect(node(host, root).y, `${key}：${root} 應在 ${leaf} 上面`).toBeLessThan(node(host, leaf).y)
    }
    // 直式的流程圖不是橫排：起點與終點大致在同一直行附近，而且終點比起點低很多（排版是細長的直式，不是寬扁的橫排）
    for (const [key, first, last] of [['signalVsNoise', 'Q', 'SNR'], ['designFlow', 'NN', 'TT'], ['decision', 'QS', 'SN']] as const) {
      const host = dom(key)
      const a = node(host, first)
      const b = node(host, last)
      expect(b.y - a.y, `${key}：${first} → ${last} 應主要是往下`).toBeGreaterThan(Math.abs(b.x - a.x))
    }
    // §5b 的導讀：「是（往左）走 metastable、不是（往右）解出 q[n]」「三條出口由左到右 drop、hold、late」「右邊的回授、右下角的有效門檻」
    {
      const host = dom('nonidealCmp')
      const x = (id: string) => node(host, id).x
      expect(x('META'), 'metastable 方塊在左、latch 解出在右').toBeLessThan(x('SGN'))
      expect(x('ZERO'), 'drop 在 hold 左邊').toBeLessThan(x('HOLD'))
      expect(x('HOLD'), 'hold 在 late 左邊').toBeLessThan(x('LATE'))
      expect(x('TH'), '有效門檻在 latch 的右邊（回授走右側）').toBeGreaterThan(x('SGN'))
      expect(node(host, 'TH').y, '有效門檻在 z⁻¹ 下面（右下角）').toBeGreaterThan(node(host, 'DLY').y)
    }
  }, SLOW)
})

describe('Ch05 方塊圖：與正文公式一致', () => {
  it('極性 δ = a − w：四張迴路圖的第一個加法點都是「＋ a、− w」，回授是負的，迴路真的閉合；沒有任何一張寫成 w − a', async () => {
    for (const [key, idx, back] of [
      ['signBlockLoop', 'k', 'INT'],
      ['sampleLoop', 'n', 'D'],
      ['linearizedLoop', 'n', 'D'],
      ['blockLoop', 'k', 'INT'],
    ] as const) {
      const g = await parse(chartOf(key))
      const labels = into(g.edges, 'S1').sort()
      expect(labels, key).toEqual(['$+ a$', `$- w_${idx}$`].sort())
      // S1 的輸出就是誤差 a − w（判號式迴路叫 s，其餘叫 δ）
      const out = g.edges.filter((e) => e.start === 'S1').map((e) => e.text ?? '')
      expect(out).toHaveLength(1)
      expect(out[0], key).toContain(`a - w_${idx}`)
      // 回授：累加器（或延遲）的輸出以負號回到 S1，所以 S1 在一個環上
      expect(edgeOf(g.edges, back, 'S1').text, key).toBe(`$- w_${idx}$`)
      expect(reaches(g.edges, 'S1', 'S1'), `${key}：迴路沒有閉合`).toBe(true)
    }
    // 沒有任何一張把極性寫反成 w − a（TeX 的減號是 `-`）
    for (const d of CH05_DIAGRAMS) expect(d.chart, d.key).not.toMatch(/w(_\w+|_\{\w[+-]1\})? - a\b/)
  }, SLOW)

  it('取樣率：逐 sample 的迴路只用下標 n，block 迴路只用下標 k；延遲與累加器的位置和更新式一致', async () => {
    for (const key of ['sampleLoop', 'linearizedLoop'] as const) {
      const c = chartOf(key)
      expect(c).toContain('w_{n+1}')
      expect(c).toContain('z^{-1}')
      expect(c).not.toMatch(/_k\b|_\{k/)
      // w_{n+1} = w_n + μ·q_n：累加的加法點 S3 收到 ＋ μ·q_n 與 ＋ w_n，輸出經 z^{-1} 才變回 w_n
      const g = await parse(c)
      expect(into(g.edges, 'S3').sort()).toEqual(['$+ w_n$', '$+ \\mu \\cdot q_n$'].sort())
      expect(g.edges.find((e) => e.start === 'S3')).toMatchObject({ end: 'D', text: '$w_{n+1}$' })
      // 延遲的輸出（w_n）同時回到累加點 S3（＋）與誤差點 S1（−）
      expect(g.edges.filter((e) => e.start === 'D').map((e) => `${e.end}:${e.text}`).sort()).toEqual(['S1:$- w_n$', 'S3:$+ w_n$'])
    }
    const blk = chartOf('blockLoop')
    for (const t of ['\\delta_k = a - w_k', 'G_k \\approx K_q \\cdot \\delta_k$<br/>$+ \\eta_k', 'w_{k+1} = w_k + \\mu \\cdot G_k', '1/(z-1)', '\\operatorname{Var} \\approx 1/N']) expect(blk).toContain(t)
    expect(blk).not.toMatch(/_n\b|\[n\]/)
    // block 迴路：S2 收到 ＋ K_q·δ_k 與 ＋ η_k，輸出 G_k 乘 μ 再進累加器
    const gb = await parse(blk)
    expect(into(gb.edges, 'S2').sort()).toEqual(['$+ K_q \\cdot \\delta_k$', '$+ \\eta_k$'].sort())
    expect(edgeOf(gb.edges, 'MU', 'INT').text).toBe('$\\mu \\cdot G_k$')
    // 判號式 block 迴路與硬體路徑圖：comparator 在 sample 速率（[n]），更新在 block 速率（k）
    for (const key of ['signBlockLoop', 'hwMap'] as const) {
      const c = chartOf(key)
      expect(c, key).toContain('每個 sample $n$')
      expect(c, key).toContain('每個 block $k$')
      expect(c, key).toMatch(/w_\{k\+1\}/)
    }
    expect(chartOf('hwMap')).toContain('w_{k+1} = w_k + \\mu \\cdot G_k')
    expect(chartOf('hwMap')).toContain('q = 2b - 1')
    // 判號式 block 迴路：e[n] = s + v[n]（S2），sign 之後每個 sample 一次、累加 N 次後每個 block 取一次正負號、再乘 μ 進累加器
    const gs = await parse(chartOf('signBlockLoop'))
    expect(into(gs.edges, 'S2').sort()).toEqual(['$+ (s = a - w_k)$', '$+ v[n]$'].sort())
    expect(gs.vertices.find((v) => v.id === 'CMP')?.text).toContain('每個 sample $n$')
    expect(gs.vertices.find((v) => v.id === 'ACC')?.text).toContain('累加 $N$ 次')
    expect(gs.vertices.find((v) => v.id === 'SGN')?.text).toContain('每個 block $k$')
    expect(edgeOf(gs.edges, 'S2', 'CMP').raw).toBe('$e[n]$')
    expect(edgeOf(gs.edges, 'CMP', 'ACC')).toBeTruthy()
    expect(edgeOf(gs.edges, 'ACC', 'SGN')).toBeTruthy()
    expect(edgeOf(gs.edges, 'SGN', 'INT').raw).toContain('d_k \\in \\{+1, -1, 0\\}')
    expect(chartOf('signBlockLoop')).toContain('\\mu/(z-1)')
  }, SLOW)

  it('硬體路徑圖（全站架構約定 §2a）：Reference → DTC → PD、VCO → divider → PD，DTC 不在回授路徑上；PD 的輸出（一個節點）同時進 loop filter 與 comparator；comparator → 映射 → GMAC（每個 sample）→ ÷N×μ → 累加器（每個 block）回到 DTC', async () => {
    const g = await parse(chartOf('hwMap'))
    const has = (a: string, b: string) => g.edges.some((e) => e.start === a && e.end === b)
    const outs = (id: string) => g.edges.filter((e) => e.start === id).map((e) => e.end).sort()
    const ins = (id: string) => g.edges.filter((e) => e.end === id).map((e) => e.start).sort()
    // 訊號路徑：Reference clock → DTC → PD → PD 輸出 e[n] → loop filter；回授：loop filter / VCO → divider → PD
    expect(has('REF', 'DTC')).toBe(true)
    expect(has('DTC', 'PD')).toBe(true)
    expect(has('PD', 'EO')).toBe(true)
    expect(has('EO', 'LF')).toBe(true)
    expect(has('LF', 'DIV')).toBe(true)
    expect(has('DIV', 'PD')).toBe(true)
    // Reference clock 只進 DTC：沒有繞過 DTC 直接進 PD 的 reference
    expect(outs('REF')).toEqual(['DTC'])
    // DTC 不在回授路徑上：divider 只送進 PD，沒有 DIV → DTC，DTC 也不送進 divider
    expect(outs('DIV')).toEqual(['PD'])
    expect(has('DIV', 'DTC')).toBe(false)
    expect(has('DTC', 'DIV')).toBe(false)
    expect(ins('DIV')).toEqual(['LF'])
    // DTC 的輸入：reference clock、regressor 的 code（乘 w_k）、gain accumulator 的 w_k；輸出只有 PD
    expect(ins('DTC')).toEqual(['ACC', 'REF', 'X'])
    expect(outs('DTC')).toEqual(['PD'])
    // PD 的三個輸入各寫它在 e[n] 裡的那一項（正負號在公式裡、寫在最前面，說明放在括號裡）：
    // DTC 的補償量 −w_k·x（reference 少延遲）、feedback edge 早到 ＋a·x、jitter ＋v[n]；三項相加 = (a − w_k)·x + v = s + v
    expect(ins('PD')).toEqual(['DIV', 'DTC', 'JIT'])
    expect(edgeOf(g.edges, 'DTC', 'PD').raw).toMatch(/^\$- w_k \\cdot x\[n\]\$/)
    expect(edgeOf(g.edges, 'DTC', 'PD').raw).toContain('（DTC 補償量：reference 少延遲）')
    expect(edgeOf(g.edges, 'DIV', 'PD').raw).toMatch(/^\$\+ a \\cdot x\[n\]\$/)
    expect(edgeOf(g.edges, 'DIV', 'PD').raw).toContain('（feedback edge 早到）')
    expect(edgeOf(g.edges, 'JIT', 'PD').raw).toBe('$+ v[n]$')
    expect(chartOf('hwMap')).toContain('DTC -- "$- w_k \\cdot x[n]$<br/>（DTC 補償量：reference 少延遲）" --> PD')
    expect(chartOf('hwMap')).toContain('DIV -- "$+ a \\cdot x[n]$<br/>（feedback edge 早到）" --> PD')
    // 不會被讀成「提前了 −w_k·x[n]」「DTC 延遲 feedback edge」：圖上沒有「提前」「晚到」「推回」這些字
    for (const word of ['提前', '晚到', '推回', '插入']) expect(chartOf('hwMap'), word).not.toContain(word)
    // PD 節點與 DTC 節點的文字：e = t_ref′ − t_fb = s + v、s = (a − w_k)·x（極性 δ = a − w）；τ_DTC = T_0 − w_k·x（code 越大延遲越短）
    const text = (id: string) => g.vertices.find((v) => v.id === id)?.text ?? ''
    expect(text('PD')).toContain("e[n] = t_{\\mathrm{ref}}' - t_{\\mathrm{fb}} = s + v[n]")
    expect(text('PD')).toContain('s = (a - w_k) \\cdot x[n]')
    expect(text('DTC')).toContain('reference 端 DTC')
    expect(text('DTC')).toContain('\\tau_{\\mathrm{DTC}} = T_0 - w_k \\cdot x[n]')
    expect(text('DIV')).toContain('回授路徑')
    // LMS 校正迴路的輸入是 PD 的輸出：PD 只有一個輸出（節點 EO「PD 輸出 e[n]」），loop filter 與 comparator 都接在這個節點上；
    // comparator 唯一的輸入就是它（虛線分接），不是 DTC、divider、loop filter 或 jitter
    expect(outs('PD')).toEqual(['EO'])
    expect(ins('EO')).toEqual(['PD'])
    expect(text('EO')).toBe('PD 輸出 $e[n]$')
    expect(outs('EO')).toEqual(['BB', 'LF'])
    expect(ins('BB')).toEqual(['EO'])
    expect(ins('LF')).toEqual(['EO'])
    expect(edgeOf(g.edges, 'EO', 'BB').raw).toContain('同一個 $e[n]$')
    expect(edgeOf(g.edges, 'EO', 'BB').raw).toContain('LMS 校正迴路')
    expect(edgeOf(g.edges, 'EO', 'LF').raw).toContain('loop filter')
    expect(chartOf('hwMap')).toMatch(/^ {2}EO -\. "[^"]*" \.-> BB$/m) // 分接是虛線（觀測），送進 loop filter 是實線
    expect(chartOf('hwMap')).toMatch(/^ {2}EO -- "[^"]*" --> LF$/m)
    expect(text('BB')).toContain('取 $e[n]$ 的正負號')
    // comparator → 映射 → GMAC（每個 sample）→ ÷N、×μ（每個 block）→ 累加器 → w_k 回到 DTC
    const chain = ['BB', 'MAP', 'GM', 'SCL', 'ACC', 'DTC']
    for (let i = 0; i + 1 < chain.length; i++) expect(edgeOf(g.edges, chain[i], chain[i + 1]), `${chain[i]} → ${chain[i + 1]}`).toBeTruthy()
    expect(edgeOf(g.edges, 'BB', 'MAP').raw).toContain('\\{0, 1\\}')
    expect(edgeOf(g.edges, 'MAP', 'GM').raw).toContain('每個 sample $n$')
    expect(edgeOf(g.edges, 'GM', 'SCL').raw).toContain('每個 block $k$')
    expect(edgeOf(g.edges, 'SCL', 'ACC').raw).toBe('$\\mu \\cdot G_k$')
    expect(edgeOf(g.edges, 'ACC', 'DTC').raw).toContain('w_k')
    // LMS 的更新式不變：w_{k+1} = w_k + μ·G_k（加號），G_k = S_N / N，S_N = Σ q·x
    expect(text('ACC')).toContain('w_{k+1} = w_k + \\mu \\cdot G_k')
    expect(text('SCL')).toContain('G_k = S_N / N')
    expect(text('GM')).toContain('S_N = \\sum q[n] \\cdot x[n]')
    // regressor 虛線：X 乘上 w_k 後控制 DTC，XG（同一個訊號）乘在 q[n] 上進 GMAC；兩個都是虛線來源，只有一條出口
    expect(text('X')).toContain('x[n]')
    expect(text('XG')).toContain('x[n]')
    expect(outs('X')).toEqual(['DTC'])
    expect(outs('XG')).toEqual(['GM'])
    expect(edgeOf(g.edges, 'X', 'DTC').raw).toContain('w_k')
    expect(edgeOf(g.edges, 'XG', 'GM').raw).toContain('$q[n]$')
    // 整張圖是一個環：DTC → PD → comparator → … → 累加器 → DTC；主 PLL 的小迴圈 PD → loop filter → divider → PD 也閉合
    expect(reaches(g.edges, 'DTC', 'DTC'), '硬體路徑圖要形成一個環').toBe(true)
    expect(reaches(g.edges, 'PD', 'PD'), '主 PLL 迴路要閉合').toBe(true)
    // 主 PLL 的小迴圈不經過 DTC（拿掉 comparator 那一支之後，從 PD 出發回不到 DTC）
    const mainLoop = g.edges.filter((e) => e.start !== 'ACC')
    expect(reaches(mainLoop, 'PD', 'DTC'), '回授路徑不應經過 DTC').toBe(false)
    // 沒有舊的寫法：「DTC 加進誤差」的加法點（ADD）與 BBPD 取自 DTC 的節點
    expect(g.vertices.some((v) => v.id === 'ADD')).toBe(false)
    expect(chartOf('hwMap')).not.toMatch(/DIV\s*(--|-\.)[^\n]*>\s*DTC/)
    // 圖說：虛線有三條（兩條 regressor、一條分接給校正迴路的 e[n]），不是只有 regressor
    expect(diagramOf('hwMap').caption).toContain('虛線是 regressor $x[n]$ 與分接給校正迴路的 $e[n]$')
    expect(diagramOf('hwMap').caption).toContain('注意哪些線每個 sample $n$ 動一次')
  }, SLOW)

  it('照圖上的線性化 block 迴路逐步遞迴：誤差每個 block 乘上 p_cal = 1 − μ·K_q（blockLoopLinear 的 pole）', () => {
    const mu = 10
    const sigma = 100
    const a = 300
    const L = blockLoopLinear(mu, sigma, 4096)
    // 圖上的訊號流：δ_k = a − w_k → × K_q → （η_k = 0）→ × μ → 累加器 w_(k+1) = w_k + μ·G_k
    let w = 290
    const deltas: number[] = []
    for (let k = 0; k < 5; k++) {
      const delta = a - w
      deltas.push(delta)
      const G = kq(sigma) * delta
      w = w + mu * G
    }
    for (let k = 1; k < deltas.length; k++) expect(deltas[k] / deltas[k - 1]).toBeCloseTo(L.pole, 12)
    expect(L.pole).toBeCloseTo(1 - mu * kq(sigma), 15)
    expect(L.pole).toBeGreaterThan(0)
    expect(L.pole).toBeLessThan(1) // 負回授：誤差單調縮小（極性畫反的話會大於 1）
    expect(chartOf('roadmap')).toContain('p_{\\mathrm{cal}} = 1 - \\mu \\cdot K_q')
    expect(chartOf('sCurveRegions')).toContain('\\mathrm{pole} = 1 - \\mu \\cdot K_q')
  })

  it('逐 sample 的線性化迴路：誤差每個 sample 乘 1 − μ·K_q；穩態 RMS 與 σ_v 的關係（τ ∝ σ_v、RMS ∝ √(μσ_v)）', () => {
    const mu = 0.5
    const sigma = 30
    // 圖：δ_n → × K_q → ＋ η_n → × μ → w_(n+1) = w_n + μ·q_n，負回授；η_n = 0 時 δ_(n+1) = (1 − μ·K_q)·δ_n
    let w = 0
    const a = 1
    const deltas: number[] = []
    for (let n = 0; n < 4; n++) {
      const delta = a - w
      deltas.push(delta)
      w = w + mu * (kq(sigma) * delta)
    }
    for (let n = 1; n < deltas.length; n++) expect(deltas[n] / deltas[n - 1]).toBeCloseTo(1 - mu * kq(sigma), 12)
    // σ_v 變 4 倍：τ ≈ 1/(μ·K_q) 變 4 倍、RMS ≈ √(μ/(2K_q)) 變 2 倍（μK_q ≪ 1）
    expect(1 / (mu * kq(4 * sigma)) / (1 / (mu * kq(sigma)))).toBeCloseTo(4, 12)
    expect(signLoopLinearRms(mu, 4 * sigma) / signLoopLinearRms(mu, sigma)).toBeCloseTo(2, 1)
    const c = chartOf('ditherRegimes')
    for (const t of ['\\tau \\approx 1/(\\mu \\cdot K_q) \\propto \\sigma_v', '\\mathrm{RMS} \\propto \\sqrt{\\mu \\cdot \\sigma_v}', 'period-2 limit cycle', '時間平均偏差最多 $\\mu/2$']) expect(c).toContain(t)
    // σ_v = 0 的 hard limiter：w 在 a 兩側的兩個格點之間來回跳，時間平均偏差不超過 μ/2（用本站的精確穩態解算）
    const zero = signLoopStationary({ a: 1.1, w0: 0, mu: 0.5, sigma: 0 })
    expect(Math.abs(zero.bias)).toBeLessThanOrEqual(0.5 / 2 + 1e-12)
    expect(Math.abs(zero.bias)).toBeGreaterThan(0)
  })

  it('birth–death 圖：往上的機率 u_k = Φ((a − θ − w_k)/σ_v) 就是 comparator 在 s = a − w_k 時輸出 +1 的機率', async () => {
    const a = 1.1
    const theta = 0.2
    const sigma = 0.5
    for (const wk of [0, 0.5, 1, 1.5]) {
      const u = pPlus(a - wk, sigma, theta)
      expect(u).toBeCloseTo(normCdf((a - theta - wk) / sigma), 15)
      expect(1 - u).toBeCloseTo(normCdf(-(a - theta - wk) / sigma), 14)
    }
    // 平衡點在 w = a − θ：往上與往下的機率都是 ½
    expect(pPlus(theta, sigma, theta)).toBeCloseTo(0.5, 15)
    const c = chartOf('birthDeath')
    for (const t of ['u_k = \\Phi((a - \\theta - w_k)/\\sigma_v)', '\\bar u_k = 1 - u_k', '\\pi_k \\cdot u_k = \\pi_{k+1} \\cdot \\bar u_{k+1}', 'w_{k-1}$<br/>$= w_k - \\mu', 'w_0 + k \\cdot \\mu']) expect(c).toContain(t)
    const g = await parse(c)
    expect(edgeOf(g.edges, 'W0', 'WP').raw).toContain('往上')
    expect(edgeOf(g.edges, 'W0', 'WM').raw).toContain('往下')
    expect(edgeOf(g.edges, 'WP', 'W0').raw).toContain('往下')
    expect(edgeOf(g.edges, 'WM', 'W0').raw).toContain('往上')
  }, SLOW)

  it('「先算一次」流程圖上的數字 = 模擬核心算出來的數字（s = 1 fs、σ_v = 100 fs）', () => {
    const c = chartOf('firstCalc')
    const p = pPlus(1, 100)
    const m = meanQ(1, 100)
    expect(c).toContain(`\\approx ${p.toFixed(5)}`) // 0.50399
    expect(c).toContain(`1 - p \\approx ${(1 - p).toFixed(5)}`) // 0.49601
    expect(c).toContain(`\\approx ${m.toFixed(5)}`) // 0.00798
    expect(c).toContain(`\\approx ${varQ(m).toFixed(5)}`) // 0.99994
    expect(c).toContain('r = s/\\sigma_v = 0.01')
    // 圖上的訊號／雜訊式子就是 sumMoments()
    const mo = sumMoments(10001, m)
    expect(mo.meanSum).toBeCloseTo(10001 * m, 12)
    expect(mo.sdSum).toBeCloseTo(Math.sqrt(10001 * (1 - m * m)), 12)
    expect(mo.snr).toBeCloseTo(mo.meanSum / mo.sdSum, 12)
    expect(c).toContain('E[S_N] = N \\cdot m')
    expect(c).toContain('\\mathrm{SD}(S_N) = \\sqrt{N \\cdot (1 - m^2)}')
  })

  it('單一次比較圖與 q 的統計圖：e − θ ≥ 0 的機率是 Φ((s − θ)/σ_v)；＋p 與 −(1 − p) 相加得 2p − 1，q² = 1 得 Var(q) = 1 − m²', async () => {
    const g = await parse(chartOf('singleCompare'))
    // e = s + v（第一個加法點），再減掉門檻 θ（第二個加法點）
    expect(into(g.edges, 'ADD').sort()).toEqual(['$+ s$', '$+ v$'].sort())
    expect(into(g.edges, 'SUB').sort()).toEqual(['$+ (e = s + v)$', '$- \\theta$'].sort())
    expect(edgeOf(g.edges, 'SUB', 'SGN').raw).toBe('$e - \\theta$')
    expect(edgeOf(g.edges, 'SGN', 'QP').raw).toContain('p = \\Phi((s - \\theta)/\\sigma_v)')
    expect(edgeOf(g.edges, 'SGN', 'QM').raw).toContain('1 - p')
    // 門檻讓機率左右移動：θ = s 時剛好 ½；θ 比 s 大 σ_v 時是 Φ(−1)
    expect(pPlus(3, 100, 3)).toBeCloseTo(0.5, 15)
    expect(pPlus(0, 100, 100)).toBeCloseTo(normCdf(-1), 15)
    // q 的統計圖
    const q = await parse(chartOf('qStats'))
    expect(into(q.edges, 'E').sort()).toEqual(['$+ p$', '$- (1 - p)$'].sort())
    for (const [s, sigma] of [[1, 100], [30, 100], [-50, 100]] as const) {
      const p = pPlus(s, sigma)
      expect(p - (1 - p)).toBeCloseTo(meanQ(s, sigma), 12) // 加法點 = 2p − 1 = erf(…)
      expect(1 - meanQ(s, sigma) ** 2).toBeCloseTo(p * 1 ** 2 + (1 - p) * (-1) ** 2 - meanQ(s, sigma) ** 2, 12) // E[q²] = 1
      expect(varQ(meanQ(s, sigma))).toBeCloseTo(4 * p * (1 - p), 12) // 1 − (2p − 1)² = 4p(1 − p)
    }
    expect(chartOf('qStats')).toContain('m = E[q] = 2p - 1')
    expect(chartOf('qStats')).toContain('\\operatorname{Var}(q) = E[q^2] - m^2 = 1 - m^2')
  }, SLOW)

  it('訊號 ∝ N、雜訊 ∝ √N：N 變 100 倍時訊號 ×100、雜訊 ×10、SNR ×10；sum 與 average 的 SNR 相同', () => {
    const m = meanQ(1, 100)
    const a = sumMoments(100, m)
    const b = sumMoments(10000, m)
    expect(b.meanSum / a.meanSum).toBeCloseTo(100, 10)
    expect(b.sdSum / a.sdSum).toBeCloseTo(10, 10)
    expect(b.snr / a.snr).toBeCloseTo(10, 10)
    expect(b.meanAvg / b.sdAvg).toBeCloseTo(b.meanSum / b.sdSum, 10)
    expect(b.meanAvg).toBeCloseTo(m, 14)
    expect(b.sdAvg).toBeCloseTo(Math.sqrt((1 - m * m) / 10000), 14)
    const c = chartOf('signalVsNoise')
    for (const t of ['q_i = m + \\eta_i', 'N \\cdot m$（$\\propto N$）', '\\sqrt{N \\cdot (1 - m^2)}$（$\\propto \\sqrt{N}$）', '\\mathrm{SNR}_{\\mathrm{stat}} = m \\cdot \\sqrt{N} / \\sqrt{1 - m^2}']) expect(c).toContain(t)
    const s = chartOf('sumVsAvg')
    for (const t of ['E = N \\cdot m', '\\mathrm{SD} = \\sqrt{N \\cdot (1 - m^2)}', 'E = m', '\\mathrm{SD} = \\sqrt{(1 - m^2)/N}', '(\\mu/N) \\cdot S_N', 'w + \\mu \\cdot G']) expect(s).toContain(t)
    // 硬體用 sum 時的更新量 (μ/N)·S_N 與演算法用 average 的 μ·G 是同一個數
    const N = 4096
    const S = 37
    expect((10 / N) * S).toBeCloseTo(10 * (S / N), 15)
  })

  it('決策圖與精確／CLT 圖：S_N = 2K − N，tie 只在偶數 N；偶數 N 的連續性修正把切點移到 1', () => {
    const p = pPlus(1, 100)
    expect(directionExact(p, 101).tie).toBe(0)
    expect(directionExact(p, 100).tie).toBeGreaterThan(0.07)
    expect(chartOf('decision')).toContain('= 2K - N')
    expect(chartOf('decision')).toContain('只有偶數 $N$')
    const c = chartOf('exactVsClt')
    for (const t of ['\\sigma_S = \\sqrt{N \\cdot (1 - m^2)}', '\\Phi(N \\cdot m/\\sigma_S)', '\\Phi((N \\cdot m - 1)/\\sigma_S)']) expect(c).toContain(t)
  })

  it('tie rule 決策樹的結論：half／skip 無偏，sign(0) = +1 偏向負、strict（硬體 sign(0) = −1）偏向正，大小約 1/(N·K_q)', () => {
    const N = 100
    const sigma = 100
    const shift = 1 / (N * kq(sigma))
    expect(Math.abs(tieRuleEquilibrium(N, sigma, 'half'))).toBeLessThan(1e-6)
    expect(Math.abs(tieRuleEquilibrium(N, sigma, 'skip'))).toBeLessThan(1e-6)
    const plus = tieRuleEquilibrium(N, sigma, 'plus')
    const strict = tieRuleEquilibrium(N, sigma, 'strict')
    expect(plus).toBeLessThan(0)
    expect(strict).toBeGreaterThan(0)
    expect(Math.abs(plus + shift) / shift).toBeLessThan(0.05)
    expect(Math.abs(strict - shift) / shift).toBeLessThan(0.05)
    expect(tieRuleEquilibriumApprox(N, sigma, 'plus')).toBeCloseTo(-shift, 14)
    // 奇數 N 沒有 tie：四種 rule 都無偏
    expect(Math.abs(tieRuleEquilibrium(101, sigma, 'plus'))).toBeLessThan(1e-6)
    const c = chartOf('tieRules')
    // 平衡點偏移的方向與大小：sign(0) = +1 偏向負、strict（硬體 sign(0) = −1）偏向正，大小 1/(N·K_q)
    expect(c).toContain(String.raw`R3 --> B3["判號式迴路偏移<br/>$s^* \approx -1/(N \cdot K_q)$"]`)
    expect(c).toContain(String.raw`R1 --> B1["$s > 0$ 時等同硬體 $\operatorname{sign}(0) = -1$<br/>判號式迴路偏移 $s^* \approx +1/(N \cdot K_q)$"]`)
    expect(c).toContain('class R2,R4,U0 ok')
    expect(c).toContain('只有偶數 $N$ 會發生')
  })

  it('最後一個樣本圖（F-05.13）：進 tie 的兩條流量相等，tie 平分後 P(S_N>0) + ½P(S_N=0) = P(S_(N−1)>0)', () => {
    for (const [p, N] of [[pPlus(1, 100), 100], [0.6, 10], [0.55, 40]] as const) {
      const d = directionExact(p, N)
      const dPrev = directionExact(p, N - 1)
      expect(d.pos + d.tie / 2).toBeCloseTo(dPrev.pos, 12)
      // 圖上藍色格子：(1 − p)·P(S_(N−1) = +1) = p·P(S_(N−1) = −1)；S = 2K − (N − 1)，S = ±1 對應 K = N/2、N/2 − 1
      const pPlus1 = binomPmf(N / 2, N - 1, p)
      const pMinus1 = binomPmf(N / 2 - 1, N - 1, p)
      expect((1 - p) * pPlus1).toBeCloseTo(p * pMinus1, 14)
      // tie 的機率 = 兩條進入 tie 的流量之和
      expect(d.tie).toBeCloseTo((1 - p) * pPlus1 + p * pMinus1, 14)
    }
    const c = chartOf('lastSample')
    expect(c).toContain('(1 - p) \\cdot P(S_{N-1} = +1) = p \\cdot P(S_{N-1} = -1)')
    for (const t of ['q_N = +1$：機率 $p$', 'q_N = -1$：機率 $1 - p$', '擲硬幣：機率 $\\tfrac{1}{2}$']) expect(c).toContain(t)
  })

  it('位元映射圖：w = a 時正確路徑的平均更新是 0，忘了映射時是 ½·E[x]', () => {
    const xs = [-1, -0.5, 0, 0.5, 1, 1.5]
    const ps = xs.map(() => 1 / 6)
    const Ex = xs.reduce((s, x, i) => s + ps[i] * x, 0)
    expect(meanGmacEncoding(300, 300, xs, ps, 100, 'bipolar')).toBeCloseTo(0, 14)
    expect(meanGmacEncoding(300, 300, xs, ps, 100, 'unipolar')).toBeCloseTo(Ex / 2, 14)
    expect(Ex).not.toBe(0)
    const c = chartOf('bitMapping')
    expect(c).toContain('q = 2b - 1')
    expect(c).toContain('E[b \\cdot x] = \\tfrac{1}{2} \\cdot E[x]')
    expect(c).toContain('E[q \\cdot x] = 0')
  })

  it('設計流程圖上的數字：z = 1.645、m = 0.00798、N 約 42,500、精確最小奇數 42,499；1-bit 比類比多 π/2 倍', () => {
    const c = chartOf('designFlow')
    const z = normInv(0.95)
    const m = meanQ(1, 100)
    expect(c).toContain(`\\approx ${z.toFixed(3)}`) // 1.645
    expect(c).toContain(`\\approx ${m.toFixed(5)}`) // 0.00798
    const clt = samplesForConfidence(m, 0.95)
    const small = samplesSmallSignal(0.01, 0.95)
    expect(Math.abs(clt - 42500)).toBeLessThan(10)
    expect(Math.abs(small - 42500)).toBeLessThan(10)
    expect(c).toContain('\\approx 42{,}500')
    expect(minNForTarget(pPlus(1, 100), 0.95, 'odd')).toBe(42499)
    expect(c).toContain('精確最小奇數 $N = 42{,}499$')
    // 類比路徑 N = (z·σ_v/s)²，1-bit 路徑多乘 π/2
    const analog = (z * 100) ** 2
    expect(small / analog).toBeCloseTo(Math.PI / 2, 12)
    const a = chartOf('analogVs1bit')
    for (const t of ['\\mathrm{SNR} = s \\cdot \\sqrt{N} / \\sigma_v', 'N = (z \\cdot \\sigma_v/s)^2$"', '\\mathrm{SNR} \\approx \\sqrt{2/\\pi} \\cdot s \\cdot \\sqrt{N} / \\sigma_v', 'N \\approx (z \\cdot \\sigma_v/s)^2 \\cdot \\pi/2']) expect(a).toContain(t)
    // 小訊號下 SNR_stat ≈ √(2/π)·(s/σ_v)·√N
    const N = 10001
    expect(sumMoments(N, m).snr / (Math.sqrt(2 / Math.PI) * 0.01 * Math.sqrt(N))).toBeCloseTo(1, 3)
  })

  it('小訊號等效模型與 S 曲線分區圖：K_q = √(2/π)/σ_v；r = 0.25 高估約 1%、r = 0.55 約 5%、r = 1.5 斜率不到 0.33·K_q', () => {
    expect(kq(100)).toBeCloseTo(Math.sqrt(2 / Math.PI) / 100, 16)
    const ss = chartOf('smallSignal')
    for (const t of ['K_q = \\sqrt{2/\\pi}/\\sigma_v', '$+ K_q \\cdot s \\approx E[q]$', '\\operatorname{Var}(\\eta) = 1 - m^2 \\approx 1', 'q \\approx K_q \\cdot s + \\eta']) expect(ss).toContain(t)
    // 等效模型的兩個量：平均 ≈ K_q·s、雜訊功率 = 1 − m²
    expect(meanQ(1, 100) / (kq(100) * 1)).toBeCloseTo(1, 4)
    expect(varQ(meanQ(1, 100))).toBeGreaterThan(0.9999)
    const c = chartOf('sCurveRegions')
    expect(c).toContain('r \\le 0.25')
    expect(c).toContain('r \\le 1.5')
    expect(linearizationRelError(0.25)).toBeGreaterThan(0.009)
    expect(linearizationRelError(0.25)).toBeLessThan(0.011) // 「高估最多約 1%」
    expect(linearizationRelError(0.55)).toBeGreaterThan(0.045)
    expect(linearizationRelError(0.55)).toBeLessThan(0.055) // 「r ≈ 0.55 時約 5%」
    const slope15 = kqLocal(1.5, 1) / kq(1)
    expect(slope15).toBeCloseTo(Math.exp(-1.125), 12) // 局部斜率 = K_q·exp(−r²/2)
    expect(slope15).toBeLessThan(0.33) // 「斜率不到 0.33·K_q」
    expect(slope15).toBeGreaterThan(0.32)
    expect(meanQ(1.5, 1)).toBeGreaterThan(0.86) // 「E[q] 貼近 ±1」
    expect(c).toContain('K_q \\cdot \\exp(-r^2/2)')
  })

  it('小訊號等效模型圖：K_q·s 的加法點與 η 相加得 q ≈ K_q·s + η；兩個框都有 ＋ 的加法點', async () => {
    const g = await parse(chartOf('smallSignal'))
    expect(into(g.edges, 'AD1').sort()).toEqual(['$+ s$', '$+ v$'].sort())
    expect(into(g.edges, 'AD2').sort()).toEqual(['$+ K_q \\cdot s \\approx E[q]$', '$+ \\eta$'].sort())
    // 平均 E[q] 與 K_q·s 的差：|s| ≪ σ_v 時是三次項（r³ 級），相對誤差 ≈ r²/6
    const r = 0.01
    expect(linearizationRelError(r)).toBeCloseTo((r * r) / 6, 7)
  }, SLOW)

  it('綜合手算流程圖 ①–⑧ 的式子 = blockLoopLinear()，而且就是 HC-05.8 的計算順序', () => {
    const sigma = 100
    const mu = 10
    const N = 4096
    const fs = 4e9
    const L = blockLoopLinear(mu, sigma, N, fs)
    const K = Math.sqrt(2 / Math.PI) / sigma // ①
    const muMax = 2 / K // ②
    const g = mu * K // ③
    const pole = 1 - g // ④
    const tau = -1 / Math.log(Math.abs(pole)) // ⑤
    const tBlk = N / fs // ⑥
    const tTau = tau * tBlk // ⑦
    const sw = mu / Math.sqrt(N * (1 - pole * pole)) // ⑧
    expect(L.kq).toBeCloseTo(K, 16)
    expect(L.muMax).toBeCloseTo(muMax, 10)
    expect(L.g).toBeCloseTo(g, 15)
    expect(L.pole).toBeCloseTo(pole, 15)
    expect(L.tau).toBeCloseTo(tau, 10)
    expect(L.blockSeconds).toBeCloseTo(tBlk, 18)
    expect(L.tauSeconds).toBeCloseTo(tTau, 15)
    expect(L.sigmaW).toBeCloseTo(sw, 12)
    expect(L.sigmaW).toBeCloseTo(0.399, 3) // T13 的 σ_w
    const c = chartOf('handcalcFlow')
    const order = ['① $K_q = \\sqrt{2/\\pi}/\\sigma_v$', '② 穩定上限 $\\mu_{\\max} = 2/K_q$', '③ loop gain $g = \\mu \\cdot K_q$', '④ pole $p_{\\mathrm{cal}} = 1 - g$', '⑤ $\\tau = -1/\\ln|p_{\\mathrm{cal}}|$', '⑥', '⑦', '⑧']
    // 八個步驟都在圖上，而且原始碼裡的順序就是計算順序
    const pos = order.map((t) => c.indexOf(t))
    pos.forEach((i, n) => expect(i, order[n]).toBeGreaterThan(-1))
    expect([...pos].sort((x, y) => x - y)).toEqual(pos)
    expect(c).toContain('T_{\\mathrm{blk}} = N/f_s')
    expect(c).toContain('t_\\tau = \\tau \\cdot T_{\\mathrm{blk}}')
    expect(c).toContain('\\sigma_w = \\mu/\\sqrt{N \\cdot (1 - p_{\\mathrm{cal}}^2)}')
    // 手算題 HC-05.8 的輸入就是圖上的四個已知量
    const hc = HANDCALCS.find((h) => h.id === 'HC-05.8')!
    expect(hc.inputs.map((i) => i.key).sort()).toEqual(['N', 'fs', 'mu', 'sigma'].sort())
  })

  it('綜合手算流程圖的相依關係：每一格只用箭頭指進來的量（沒有跳過的相依）', async () => {
    const g = await parse(chartOf('handcalcFlow'))
    const deps = (id: string) => g.edges.filter((e) => e.end === id).map((e) => e.start).sort()
    expect(deps('KQ')).toEqual(['SV'])
    expect(deps('MMAX')).toEqual(['KQ'])
    expect(deps('G')).toEqual(['KQ', 'MUIN'])
    expect(deps('P')).toEqual(['G'])
    expect(deps('TAU')).toEqual(['P'])
    expect(deps('TBLK')).toEqual(['NF'])
    expect(deps('TT')).toEqual(['TAU', 'TBLK'])
    expect(deps('SW')).toEqual(['MUIN', 'NF', 'P']) // σ_w = μ/√(N(1 − p²))：μ、N、pole
  }, SLOW)

  it('路線圖：§2 → §3 → §4 一條線、§2 → §5 → §7 → §9 另一條線，與正文導讀一致', async () => {
    const g = await parse(chartOf('roadmap'))
    for (const [a, b] of [['Q0', 'P2'], ['P2', 'P3'], ['P3', 'P4'], ['P2', 'P5'], ['P5', 'P7'], ['P7', 'P9'], ['P5', 'P9'], ['P3', 'P9']] as const) {
      expect(edgeOf(g.edges, a, b), `${a} → ${b}`).toBeTruthy()
    }
  }, SLOW)

  it('方法選擇圖：五個葉子（= §8.1 表格的五列），每個葉子都只能由問題一路走到', async () => {
    const g = await parse(chartOf('methodChoice'))
    const leaves = g.vertices.filter((v) => !g.edges.some((e) => e.start === v.id)).map((v) => v.id).sort()
    expect(leaves).toEqual(['CC', 'CLT', 'EX', 'MCB', 'MCS'])
    for (const l of leaves) expect(reaches(g.edges, 'Q1', l), l).toBe(true)
  }, SLOW)

  it('Monte Carlo 交叉比對圖：接受域每側尾機率低於 Φ(−4) ≈ 3.2e-5（與 Comparator Lab 同一個判準）', () => {
    const c = chartOf('mcCheck')
    expect(c).toContain('每側尾機率低於 $\\Phi(-4)$')
    expect(normCdf(-4)).toBeGreaterThan(3.1e-5)
    expect(normCdf(-4)).toBeLessThan(3.2e-5)
    expect(c).toContain('k \\sim \\mathrm{Bin}(T, P)')
    expect(c).toContain('Wilson 95% 區間')
  })

  it('§5b 非理想 comparator 圖：加法點是「＋ e[n]、− θ_a」，門檻由 q[n−1] 經 z⁻¹ 回授選（θ ∓ h），菱形是決策窗，三種政策各自進 GMAC；圖上的式子 = 模型', async () => {
    const g = await parse(chartOf('nonidealCmp'))
    expect(into(g.edges, 'SUB').sort()).toEqual(['$+ e[n]$', '$- \\theta_a$'].sort())
    expect(edgeOf(g.edges, 'SUB', 'WIN').raw).toBe('$d = e[n] - \\theta_a$')
    expect(g.vertices.find((v) => v.id === 'TH')?.text).toContain('\\theta_a = \\theta - q[n-1] \\cdot h')
    // 回授：SGN → z⁻¹ → TH，所以 TH 在一個環上（遲滯 = 門檻有記憶）
    expect(edgeOf(g.edges, 'SGN', 'DLY').raw).toBe('$q[n]$')
    expect(edgeOf(g.edges, 'DLY', 'TH').raw).toContain('\\theta \\mp h')
    expect(reaches(g.edges, 'TH', 'TH'), '門檻的回授要形成一個環').toBe(true)
    // 決策窗的兩個出口與三種政策
    expect(g.edges.filter((e) => e.start === 'WIN').map((e) => e.end).sort()).toEqual(['META', 'SGN'])
    expect(g.edges.filter((e) => e.start === 'META').map((e) => e.text).sort()).toEqual(['drop', 'hold', 'late'])
    for (const id of ['SGN', 'ZERO', 'HOLD', 'LATE']) expect(edgeOf(g.edges, id, 'GM'), `${id} → GM`).toBeTruthy()
    expect(g.vertices.find((v) => v.id === 'GM')?.text).toContain('S_N = \\sum y[n] \\cdot x[n]')
    expect(g.vertices.find((v) => v.id === 'LATE')?.text).toContain('x[n+1]')
    // 圖上的機率 P_meta 與模型：s = θ、ε = 5 fs、σ_v = 100 fs ⇒ 2Φ(0.05) − 1 = 0.03988 ≈ K_q·ε
    expect(metaProb(0, 100, 5)).toBeCloseTo(2 * normCdf(0.05) - 1, 15)
    expect(metaProb(0, 100, 5) / (kq(100) * 5)).toBeCloseTo(1, 3)
    // 門檻依上一個輸出而定：q_prev = +1 時門檻在 θ − h，P(+1 | +1) > P(+1 | −1)
    const plus = comparatorTransitions(1, 100, 30, 0, 1)
    const minus = comparatorTransitions(1, 100, 30, 0, -1)
    expect(plus.plus).toBeCloseTo(normCdf((1 + 30) / 100), 14)
    expect(minus.plus).toBeCloseTo(normCdf((1 - 30) / 100), 14)
    expect(plus.plus).toBeGreaterThan(minus.plus)
    // h = ε = 0：門檻永遠是 θ、沒有 metastable，回到 §2 的圖（P(+1) = Φ((s − θ)/σ_v)）
    const ideal = comparatorTransitions(1, 100, 0, 0, -1)
    expect(ideal.plus).toBe(pPlus(1, 100))
    expect(ideal.meta).toBe(0)
  }, SLOW)

  it('AR(1) 圖：正相關讓 Var(S_N) 大於 N、N_eff 小於 N；ρ = 0 時回到獨立的情況；相鄰 sign 的相關是 (2/π)·arcsin(ρ)', async () => {
    const N = 4096
    const iid = sumVarianceAr1(N, 0)
    expect(iid.varSum).toBeCloseTo(N, 8)
    expect(iid.nEff).toBeCloseTo(N, 6)
    const cor = sumVarianceAr1(N, 0.9)
    expect(cor.varSum).toBeGreaterThan(N)
    expect(cor.nEff).toBeLessThan(N)
    expect(cor.nEff).toBeCloseTo((N * N) / cor.varSum, 8)
    // N = 2：Var(S_2) = 2 + 2·(2/π)·arcsin(ρ)（對角線兩項各為 1，相鄰一對出現兩次）
    for (const rho of [0.3, 0.9]) expect(sumVarianceAr1(2, rho).varSum).toBeCloseTo(2 + 2 * (2 / Math.PI) * Math.asin(rho), 12)
    // 產生器 v_(i+1) = ρ·v_i + √(1 − ρ²)·z_i：變異數保持 1（ρ² + (1 − ρ²) = 1）
    for (const rho of [0, 0.5, 0.99]) expect(rho ** 2 + Math.sqrt(1 - rho ** 2) ** 2).toBeCloseTo(1, 15)
    const c = chartOf('ar1')
    for (const t of ['\\times \\sqrt{1 - \\rho^2}', '\\times \\rho', '(2/\\pi) \\cdot \\arcsin(\\rho)', 'N_{\\mathrm{eff}} = N^2 / \\operatorname{Var}(S_N)']) expect(c).toContain(t)
    const g = await parse(c)
    expect(into(g.edges, 'SUM').sort()).toEqual(['$+ \\rho \\cdot v_i$', '$+ \\sqrt{1 - \\rho^2} \\cdot z_i$'].sort())
    expect(edgeOf(g.edges, 'SUM', 'D').raw).toBe('$v_{i+1}$')
    expect(edgeOf(g.edges, 'D', 'RHO').raw).toBe('$v_i$')
    expect(reaches(g.edges, 'SUM', 'SUM'), 'AR(1) 的 ×ρ 回授要形成一個環').toBe(true)
  }, SLOW)
})

describe('Ch05 方塊圖：整頁渲染', () => {
  function renderChapter(mode: 'beginner' | 'engineer' | 'research') {
    return renderPage(<Chapter05 />, { mode, url: '/ch/05' })
  }
  const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  /** 系統地圖是手排的 SVG（figure.c-mermaid.c-sysmap），被標成主角的方塊帶有 is-focus；不經過 Mermaid，所以沒有 data-chart。 */
  const focusedBlocks = (map: Element) => Array.from(map.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))

  it('Research 模式：章首有 <SystemMap>，28 張圖依登錄順序全部出現，各有圖說與「先看…再看…」的導讀，並排在對應公式之前；符號表是最後一個區塊', () => {
    const { container, unmount } = renderChapter('research')
    const figs = Array.from(container.querySelectorAll<HTMLElement>('figure.c-mermaid'))
    // 第一張是章首的系統地圖：緊接在開場問題之後、第一個章節標題之前
    const map = figs[0]
    expect(map.classList.contains('c-sysmap')).toBe(true)
    expect(map.dataset.chart, '系統地圖不經過 Mermaid').toBeUndefined()
    expect(container.querySelectorAll('figure.c-sysmap')).toHaveLength(1)
    // 標出的主角就是本章的三個方塊（雜訊、1-bit comparator、GMAC）
    expect(focusedBlocks(map).sort()).toEqual([...CH05_SYSTEM_FOCUS].sort())
    expect(focusedBlocks(map).sort()).toEqual(systemMapModel(CH05_SYSTEM_FOCUS).blocks.filter((b) => b.focused).map((b) => b.id).sort())
    expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
    expect(map.querySelector('figcaption')?.textContent).toContain('系統地圖：藍色是本章的主角')
    expect(map.closest('.ch05-fig')).toBeNull()
    const question = container.querySelector('.ch05-question') as HTMLElement
    const firstH2 = container.querySelector('h2') as HTMLElement
    expect(follows(question, map)).toBe(true)
    expect(map.previousElementSibling?.querySelector('.ch05-question'), '系統地圖緊接在開場問題之後').toBeTruthy()
    expect(follows(map, firstH2)).toBe(true)
    // 系統地圖後面有一句話說明藍色方塊與本章新增的內容
    const note = container.querySelector('.ch05-system-map-note') as HTMLElement
    expect(follows(map, note)).toBe(true)
    expect(follows(note, firstH2)).toBe(true)
    expect(note.textContent).toContain('藍色的三個方塊')
    expect(note.textContent).toContain('這一章補上')
    // 章首不再有符號表連結：那一行改由 PageFrame 的本章資訊 strip 提供（teaching-style §9）
    expect(container.querySelector('.ch05-symbols-link')).toBeNull()
    expect(container.textContent).not.toContain('本章符號表在最後')
    // 其餘 27 張依登錄表的順序出現（圖號 = 頁面順序）
    expect(figs.length).toBe(1 + CH05_DIAGRAMS.length)
    const wrappers = Array.from(container.querySelectorAll<HTMLElement>('.ch05-fig'))
    expect(wrappers.map((w) => w.dataset.diagram)).toEqual(CH05_DIAGRAMS.map((d) => d.key))
    wrappers.forEach((w, i) => {
      const d = CH05_DIAGRAMS[i]
      const fig = w.querySelector('figure.c-mermaid') as HTMLElement
      expect(fig.dataset.chart, d.key).toBe(d.chart)
      expect(fig.querySelector('figcaption')?.textContent, d.key).toBe(`圖 5-${d.no}｜${d.caption}`)
      // 導讀：一兩句話帶著讀者看圖（先看…再看…／順著箭頭…），並用 KaTeX 把圖上的名稱接到公式的符號
      const walk = w.querySelector('.c-chapter-fig-walk') as HTMLElement
      expect(walk, d.key).toBeTruthy()
      const text = walk.textContent ?? ''
      expect(text.length, d.key).toBeGreaterThanOrEqual(60)
      expect(text, d.key).toMatch(/先|順著|從|照/)
      expect(walk.querySelectorAll('.katex').length, d.key).toBeGreaterThanOrEqual(2)
    })
    // 圖放在白話說明之後、推導（對應的 boxed 公式／手算題）之前
    const before: [DiagramKey, string][] = [
      ['singleCompare', '[id="formula-F-05.1"]'],
      ['qStats', '[id="formula-F-05.2"]'],
      ['bitMapping', '[id="formula-F-05.16"]'],
      ['signalVsNoise', '[id="formula-F-05.4"]'],
      ['sumVsAvg', '[id="formula-F-05.5"]'],
      ['decision', '[id="formula-F-05.6"]'],
      ['exactVsClt', '[id="formula-F-05.7"]'],
      ['signBlockLoop', '[id="formula-F-05.19"]'],
      ['lastSample', '[id="formula-F-05.13"]'],
      ['designFlow', '[id="formula-F-05.9"]'],
      ['smallSignal', '[id="formula-F-05.10"]'],
      ['sCurveRegions', '[id="formula-F-05.11"]'],
      ['nonidealCmp', '[id="formula-F-05.21"]'],
      ['mcCheck', '[id="formula-F-05.14"]'],
      ['sampleLoop', '[id="formula-F-05.15"]'],
      ['linearizedLoop', '[id="formula-F-05.15"]'],
      ['blockLoop', '[id="formula-F-05.20"]'],
      ['handcalcFlow', '[id="handcalc-HC-05.8"]'],
      ['ar1', '[id="formula-F-05.17"]'],
    ]
    for (const [key, sel] of before) {
      const w = container.querySelector(`.ch05-fig[data-diagram="${key}"]`) as HTMLElement
      const target = container.querySelector(sel) as HTMLElement
      expect(target, sel).toBeTruthy()
      expect(follows(w, target), `${key} 應在 ${sel} 之前`).toBe(true)
    }
    // 兩張依序出現的迴路圖：先是實際的（sign），再是線性化的（K_q）；正文用圖號互相引用
    const lin = container.querySelector('.ch05-fig[data-diagram="linearizedLoop"] .c-chapter-fig-walk') as HTMLElement
    expect(lin.textContent).toContain(`圖 5-${diagramOf('sampleLoop').no}`)
    const blk = container.querySelector('.ch05-fig[data-diagram="blockLoop"] .c-chapter-fig-walk') as HTMLElement
    expect(blk.textContent).toContain(`圖 5-${diagramOf('hwMap').no}`)
    // 全站架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端、回授路徑只有 divider、LMS 校正迴路的輸入是 PD 的輸出；PD 量 t_ref′ − t_fb
    const hwWalk = container.querySelector('.ch05-fig[data-diagram="hwMap"] .c-chapter-fig-walk') as HTMLElement
    const hwText = hwWalk.textContent ?? ''
    const hwTex = Array.from(hwWalk.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    expect(hwText).toContain('reference clock 先經過 DTC 才進 PD')
    expect(hwText).toContain('只能延遲、不能提前')
    expect(hwText).toContain('補償量')
    expect(hwText).toContain('回授路徑上只有 divider、不經過 DTC')
    expect(hwText).toContain('PD 量的是 reference edge 減 feedback edge')
    expect(hwText).toContain('LMS 校正迴路的輸入是 PD 的輸出，也就是送進 loop filter 的同一個訊號')
    expect(hwTex).toEqual(
      expect.arrayContaining([String.raw`\tau_{\mathrm{DTC}}=T_0-w_k\,x[n]`, String.raw`e[n]=t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w_k)\,x[n]+v[n]=s+v[n]`, 'T_0']),
    )
    // 導讀和圖一致：進 PD 的三條線就是 e[n] 的三項；T_0 在 DTC 方塊裡（圖上有寫），只是 e[n] 的式子裡沒有它；
    // 補償不足時為正的是 s（e[n] 單看一次仍被 v[n] 蓋過——本章的主題），不是每一個 e[n]
    expect(hwTex).toEqual(expect.arrayContaining(['-w_k\\,x[n]', '+a\\,x[n]', '+v[n]', 'w_k<a']))
    expect(hwText).toContain('的式子裡沒有它')
    expect(hwText).not.toContain('圖上不寫')
    expect(hwText).toContain('為正（')
    expect(hwText).toContain('平均偏正')
    expect(hwText).toContain('reference edge 少延遲這麼多')
    expect(hwText).toContain('PD 下面的圓角方塊「PD 輸出')
    expect(hwText).toContain('PLL error path')
    const page = container.textContent ?? ''
    // §9 的表：s 那一列用「補償量」而且交代 T_0（DTC 不能產生負的延遲），q 那一列說 comparator 取的是 PD 的輸出
    expect(page).toContain('reference 端 DTC 的補償量是')
    expect(page).toContain('少延遲這麼多）；補償不足（')
    expect(page).not.toContain('只把 reference edge 提前')
    expect(page).toContain('取 PD 輸出')
    expect(page).toContain('bang-bang PLL 的 PD 本身就是這個 comparator')
    expect(container.querySelector('.ch05-question')?.textContent).toContain('reference 端的 DTC')
    expect(container.querySelector('.ch05-question')?.textContent).toContain('PD 的輸出')
    // §0 的 L1 模型圖：那個加法點放進 PLL 就是 PD，e 是 PD 的輸出（comparator 取的就是它）
    const l1Walk = container.querySelector('.ch05-fig[data-diagram="l1Model"] .c-chapter-fig-walk') as HTMLElement
    expect(l1Walk.textContent).toContain('這個加法點就是 PD')
    expect(l1Walk.textContent).toContain('就是 PD 的輸出')
    // 整章沒有舊的說法（DTC 在 divider 之後、DTC 插入延遲把 divider 的 edge 推回去、回授側注入），
    // 也沒有「DTC 把 reference 提前」卻不交代基準延遲 T_0 的句子（DTC 不能產生負的延遲）
    for (const old of ['DTC 插入', '插入延遲', '推回', 'DTC 在回授', '回授路徑上的 DTC', 'DTC 延遲', 'divider 之後', '回授側', 'feedback 側', 'edge 提前', 'reference 提前']) {
      expect(page, old).not.toContain(old)
    }
    // 符號表在頁面最後（id="symbols"），所有的圖都在它前面
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols).toBe(container.querySelector('.ch05')!.lastElementChild)
    expect(follows(wrappers[wrappers.length - 1], symbols)).toBe(true)
    expectNoTexErrors(container)
    unmount()
  }, SLOW)

  it('Engineer／Beginner 模式：跟著段落 ModeGate 隱藏的圖與登錄表的 minMode 一致，系統地圖永遠在', () => {
    for (const mode of ['engineer', 'beginner'] as const) {
      const { container, unmount } = renderChapter(mode)
      const expected = CH05_DIAGRAMS.filter((d) => !d.minMode || (mode === 'engineer' && d.minMode === 'engineer')).map((d) => d.key)
      const shown = Array.from(container.querySelectorAll<HTMLElement>('.ch05-fig')).map((w) => w.dataset.diagram)
      expect(shown, mode).toEqual(expected)
      // 系統地圖永遠是第一張，而且標出同樣的三個主角
      const map = container.querySelector<HTMLElement>('figure.c-mermaid')!
      expect(map.classList.contains('c-sysmap'), mode).toBe(true)
      expect(focusedBlocks(map).sort(), mode).toEqual([...CH05_SYSTEM_FOCUS].sort())
      unmount()
    }
    expect(CH05_DIAGRAMS.filter((d) => d.minMode === 'engineer').map((d) => d.key)).toEqual(['signBlockLoop', 'birthDeath'])
    expect(CH05_DIAGRAMS.filter((d) => d.minMode === 'research').map((d) => d.key)).toEqual(['lastSample', 'ar1'])
  }, SLOW)
})
