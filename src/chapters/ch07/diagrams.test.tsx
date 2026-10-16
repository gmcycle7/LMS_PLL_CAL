import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { defaultValues, renderTex, systemMapModel } from '@/components'
import { mermaidMathDelimiters, sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { SettingsProvider } from '@/app/settings'
import { analyticCorr, buildHat, HAT_EXACT, pathTransfer, residualPhaseDeg, toneBlockCorr, toneCorrCodeDelay, type FxCodeSpec, type FxPathSpec } from '@/simulation/models/filteredX'
import Chapter07 from './index'
import { CH07_CHARTS, CH07_SYSTEM_FOCUS, type Ch07ChartName } from './diagrams'
import { HANDCALCS } from './handcalcs'
import { kq } from './util'

/**
 * Ch07 的方塊圖（docs/teaching-style.md §8）。ch07.test.tsx 為了速度把 mermaid 整個 mock 掉，所以這裡另外用「真正的」mermaid：
 *   1. parser：每一張圖都能解析、節點數不超過 14；
 *   2. renderer（jsdom + getBBox 墊片；共用的 renderMermaidForTest）：標籤沒有被 Mermaid 11 的 Markdown 解析吃掉（「Unsupported markdown: list」）；
 *      圖內數學一律 LaTeX（docs/teaching-style.md §3）：每個含 `$...$` 的標籤都由 KaTeX 排版（mathCount）、畫出來的文字沒有殘留的 `$`、
 *      KaTeX 以外的文字沒有 Unicode 拼的數學（unicodeMathIn）；
 *   3. 排版：長的圖用上下排列（桌機上不需要橫向捲動，字不會縮到看不清楚）、並排比較的框上下疊且順序正確；
 *   4. 與公式一致：加法點的正負號、δ = a − w、φ ± ΩD、取樣率（n／k），以及圖上的例子數字（由模型重算）；
 *      架構照 docs/assumptions.md §2a：DTC 在 reference 輸入端（不在回授路徑上）、comparator 的輸入從 PD 的輸出拉、Type-II 迴路的減法點就是 PD；
 *   5. 頁面：章首的 SystemMap（手排的 SVG，不經過 Mermaid；用 systemMapModel／is-focus 檢查主角）、全章圖數、每張圖都在對應的公式之前、圖後有一段「先看…再看…」的走圖說明。
 */

// Plotly 在 jsdom 裡跑不起來；頁面測試只關心方塊圖，照 ch07.test.tsx 的方式 mock 掉
const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const RAD = Math.PI / 180
const r = String.raw
const NAMES = Object.keys(CH07_CHARTS) as Ch07ChartName[]
const CASES = NAMES.map((name) => [name, CH07_CHARTS[name]] as const)

interface FlowVertex {
  id: string
  text?: string
  classes?: string[]
}
interface FlowEdge {
  start: string
  end: string
  text?: string
}
interface FlowDb {
  getVertices(): Map<string, FlowVertex>
  getEdges(): FlowEdge[]
  getSubGraphs(): { id: string; title: string }[]
}

/** 真正的 parser 解析出來的節點與邊（不是用正規表示式猜的）。 */
async function parseFlow(chart: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDb
  const vertices = db.getVertices()
  const edges = db.getEdges()
  const text = (id: string) => (vertices.get(id)?.text ?? '').replace(/<br\s*\/?>/g, ' ')
  const edge = (start: string, end: string) => edges.filter((e) => e.start === start && e.end === end).map((e) => e.text ?? '')
  const into = (end: string) => edges.filter((e) => e.end === end)
  const classOf = (id: string) => vertices.get(id)?.classes ?? []
  const subgraphs = db.getSubGraphs()
  return { vertices, edges, subgraphs, text, edge, into, classOf }
}

/**
 * jsdom 沒有版面引擎：給 SVG 的量測函式固定的尺寸，mermaid 才排得出來。
 * 節點的座標沒有意義，但標籤的內容、節點的先後次序（dagre 的 rank／order 與尺寸無關）和瀏覽器裡相同。
 */
function fakeSvgMetrics() {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>
  proto.getBBox = () => ({ x: 0, y: 0, width: 80, height: 24 })
  proto.getComputedTextLength = () => 80
}

/** 連線標籤裡的換行（parser 會把 <br/> 正規化成 <br>）換成一個空格，方便整句比對。 */
const oneLine = (label: string) => label.replace(/<br\s*\/?>/g, ' ')

/** 原始碼中所有雙引號包住的標籤。 */
const labelsOf = (chart: string) => [...chart.matchAll(/"([^"]*)"/g)].map((m) => m[1])
/** 含公式（`$...$`）的標籤：每一個都應該畫成一個 KaTeX 區塊 */
const mathLabels = (chart: string) => labelsOf(chart).filter((l) => l.includes('$'))
const TEX_SEGMENT = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
/** 公式裡不該出現的 Unicode 數學字元（要寫成 \alpha、\cdot、\le、_{…}、^{…}） */
const UNICODE_IN_TEX = /[Ͱ-Ͽ⁰-₟²³¹∑∏√∞≤≥≠≈±∓·×÷∂∇∈∝⌊⌋⌈⌉ℒĤĥŷŵ−]|\u{1d4a9}|̂/u
/** 標籤的文字部分（拿掉 `$...$` 與換行）不該有 Unicode 拼的數學，包括帶帽子的 Ĥ、ĥ */
const textPartOf = (label: string) => label.replace(TEX_SEGMENT, '').replace(/<br\s*\/?>/g, ' ')

/** 去掉空白與零寬空格，方便比對 KaTeX 排出來的文字 */
const compact = (s: string) => s.replace(/[\s\u200b]+/g, '')
/** 一個節點／連線元素在畫面上的文字（拿掉 KaTeX 的 MathML 複本，避免每個公式出現兩次） */
function drawnText(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  return compact(copy.textContent ?? '')
}
/**
 * 標籤在畫面上應有的文字。純文字標籤：原文（去掉 <br/>）；含 `$...$` 的標籤：和網站一樣先合併成單一的 `$$...$$`（mermaidMathDelimiters），
 * 再用 KaTeX 排版（renderTex，與 Mermaid 內部同樣的 htmlAndMathml 輸出），取排出來的文字。
 */
function expectedDrawn(label: string): string {
  const merged = /^"\$\$([\s\S]*)\$\$"$/.exec(mermaidMathDelimiters(`"${label}"`))
  if (!merged) return compact(label.replace(/<br\s*\/?>/g, ''))
  const html = renderTex(merged[1], true)
  expect(html, label).not.toMatch(/katex-error|c-tex-error/)
  const host = document.createElement('div')
  host.innerHTML = html
  return drawnText(host)
}

beforeAll(installMermaidSvgShim)
beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
})

describe('Ch07 Mermaid 圖：真正的 parser', () => {
  it('一共 22 張（含原有的 RTL 位置圖），名稱不重複、原始碼不重複', () => {
    expect(NAMES).toHaveLength(22)
    expect(new Set(Object.values(CH07_CHARTS)).size).toBe(22)
    expect(NAMES).toContain('CHART_RTL_REGRESSORS')
  })

  it.each(CASES)('%s：語法正確（flowchart），節點數 ≤ 14，有圖要看的重點色', async (_name, chart) => {
    const r = await mermaid.parse(chart)
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
    const { vertices } = await parseFlow(chart)
    expect(vertices.size).toBeGreaterThanOrEqual(4)
    expect(vertices.size).toBeLessThanOrEqual(14)
    // 至少一個節點用 classDef 標色（focus／ok／warn），而且用到的 class 都有定義
    const used = [...vertices.values()].flatMap((v) => v.classes ?? [])
    expect(used.length).toBeGreaterThan(0)
    for (const c of used) expect(['focus', 'ok', 'warn']).toContain(c)
  })

  it.each(CASES)('%s：標籤沒有裸的 < >（只允許 <br/>）、沒有會被當成 Markdown 清單／標題／引用的開頭', (_name, chart) => {
    for (const label of labelsOf(chart)) {
      expect(label.replace(/<br\/>/g, ''), label).not.toMatch(/[<>]/)
      // Mermaid 11 把標籤交給 marked：以 "+ "、"- "、"* "、"1. "、"# "、"> " 開頭（或只有一個 + - *）會變成「Unsupported markdown」
      for (const line of label.split('<br/>')) expect(line, label).not.toMatch(/^\s*(?:[-+*](?:\s|$)|\d+[.)]\s|#{1,6}\s|>|`)/)
    }
  })

  it.each(CASES)('%s：圖內數學一律 LaTeX——每個標籤的文字部分沒有 Unicode 拼的數學、`$...$` 成對且裡面沒有 Unicode 數學、KaTeX 可解析', (_name, chart) => {
    expect(mathLabels(chart).length).toBeGreaterThan(0)
    for (const label of labelsOf(chart)) {
      expect((label.match(/(?<!\\)\$/g) ?? []).length % 2, label).toBe(0)
      expect(unicodeMathIn(textPartOf(label)), `文字部分：${label}`).toEqual([])
      expect(textPartOf(label), `文字部分：${label}`).not.toMatch(UNICODE_IN_TEX)
      // 公式裡一律用 LaTeX 指令；標籤內不用兩個連續的反斜線（Mermaid 會收成一個）
      expect(label, label).not.toContain('\\\\')
      for (const m of label.matchAll(TEX_SEGMENT)) {
        expect(m[1], `公式：${label}`).not.toMatch(UNICODE_IN_TEX)
        expect(renderTex(m[1], true), `公式：${m[1]}`).not.toMatch(/katex-error|c-tex-error/)
      }
    }
  })

  it('章首的系統地圖：本章主角是 RES、ALIGN、GMAC（systemMapModel），其餘方塊不上色', () => {
    const model = systemMapModel(CH07_SYSTEM_FOCUS)
    expect(CH07_SYSTEM_FOCUS).toEqual(['res', 'align', 'gmac'])
    expect(model.blocks.filter((b) => b.focused).map((b) => b.id).sort()).toEqual(['align', 'gmac', 'res'])
    // 沒有被標成主角的方塊裡，不會有 RES、ALIGN、GMAC
    expect(model.blocks.filter((b) => !b.focused && CH07_SYSTEM_FOCUS.includes(b.id)).map((b) => b.id)).toEqual([])
    expect(model.blocks.filter((b) => !b.focused).length).toBe(model.blocks.length - 3)
  })
})

describe('Ch07 Mermaid 圖：用共用工具真的畫一次', () => {
  it.each(CASES)('%s：畫得出來，沒有「Unsupported markdown」，節點數 ≤ 14；公式全由 KaTeX 排版，畫面上沒有殘留的 $，也沒有 Unicode 拼的數學', async (_name, chart) => {
    installMermaidSvgShim()
    const { text, plainText, nodeCount, mathCount } = await renderMermaidForTest(chart)
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(text).not.toContain('$')
    // KaTeX 以外的文字（單位、方塊名稱、中文說明）沒有 Unicode 拼的數學
    expect(unicodeMathIn(plainText)).toEqual([])
    expect(nodeCount).toBeGreaterThanOrEqual(4)
    expect(nodeCount).toBeLessThanOrEqual(14)
    // 每個含 `$...$` 的標籤（節點、連線、subgraph 標題）都畫成一個 KaTeX 區塊：沒有漏網的 Unicode 公式，也沒有被當成純文字的 `$`
    expect(mathCount).toBe(mathLabels(chart).length)
    // 原始碼本身就寫成 ＋／−（不靠 sanitize 換字）：sanitizeMermaidSource 只做「`$...$` 合併成 `$$...$$`」這一步
    expect(sanitizeMermaidSource(chart)).toBe(mermaidMathDelimiters(chart))
  })
})

describe('Ch07 Mermaid 圖：真正的 renderer（jsdom）', () => {
  it('每張圖都畫得出來；每個節點、每條線、每個 subgraph 標題的文字（公式經 KaTeX 排版後）都原樣出現，沒有「Unsupported markdown」，也沒有被 Markdown 變成粗體／斜體', async () => {
    fakeSvgMetrics()
    for (const [name, chart] of CASES) {
      const { svg, text } = await renderMermaidForTest(chart)
      expect(svg, name).not.toMatch(/Unsupported markdown/)
      expect(svg, name).not.toMatch(/<(?:em|strong)>/)
      expect(svg, name).not.toMatch(/Syntax error/i)
      expect(text, name).not.toContain('$')
      const host = document.createElement('div')
      host.innerHTML = svg
      const shown = Array.from(host.querySelectorAll('.nodeLabel')).map(drawnText)
      const shownEdges = Array.from(host.querySelectorAll('span.edgeLabel')).map(drawnText)
      const { vertices, edges, subgraphs } = await parseFlow(chart)
      // 每個節點、每條線上的文字都原樣出現在畫出來的圖上（含 `$...$` 的標籤：和 KaTeX 單獨排版的結果相同）
      for (const v of vertices.values()) expect(shown, `${name}: ${v.id}`).toContain(expectedDrawn(v.text ?? ''))
      for (const g of subgraphs) expect(shown, `${name}: subgraph ${g.id}`).toContain(expectedDrawn(g.title))
      for (const e of edges) {
        const want = expectedDrawn(e.text ?? '')
        if (want) expect(shownEdges, `${name}: ${e.start} → ${e.end}`).toContain(want)
      }
    }
  })
})

/** 上下排列（TB）的圖：流程類、兩路相乘、含回授迴圈、或是橫向會超過 1260 px 的圖。其餘維持左右排列（硬體結構圖的慣例）。 */
const TB_CHARTS: Ch07ChartName[] = [
  'CHART_SIGNAL_MODEL',
  'CHART_PHASE_BOOKKEEPING',
  'CHART_MEAN_LOOP',
  'CHART_MIXER_AVERAGE',
  'CHART_BLOCK_AVERAGE',
  'CHART_TWO_TONES',
  'CHART_VOTING',
  'CHART_GRADIENT',
  'CHART_FX_LOOP',
  'CHART_MISMATCH',
  'CHART_LATENCY_MISMATCH',
  'CHART_RTL_REGRESSORS',
  'CHART_DECISION',
  'CHART_HANDCALC_FLOW',
  'CHART_BRINGUP',
]

/**
 * 用 Mermaid（dagre）真的排一次，估計圖的形狀。jsdom 沒有字型量測，節點大小都是墊片給的固定值，所以座標本身沒有意義，
 * 但「分成幾層（rank）、每一層有幾個節點」只取決於連線與宣告順序，和瀏覽器裡相同。
 * TB：層 ＝ 同一個 y 的節點（層數 ＝ 高度，最寬那一層的節點數 ＝ 寬度）；LR：層 ＝ 同一個 x（層數 ＝ 寬度）。
 */
async function layoutOf(name: Ch07ChartName) {
  fakeSvgMetrics()
  const { svg } = await renderMermaidForTest(CH07_CHARTS[name])
  const host = document.createElement('div')
  host.innerHTML = svg
  // 節點在巢狀的 g.root（subgraph）裡時，座標要把每一層的 translate 加起來
  const position = (el: Element) => {
    let x = 0
    let y = 0
    for (let e: Element | null = el; e && e !== host; e = e.parentElement) {
      const t = /translate\(([-\d.]+)[,\s]+([-\d.]+)\)/.exec(e.getAttribute('transform') ?? '')
      if (t) {
        x += Number(t[1])
        y += Number(t[2])
      }
    }
    return { x: Math.round(x), y: Math.round(y) }
  }
  return { host, position }
}

async function layerShape(name: Ch07ChartName) {
  const { host, position } = await layoutOf(name)
  const nodes = Array.from(host.querySelectorAll('g.node')).map(position)
  const tb = CH07_CHARTS[name].startsWith('flowchart TB')
  const layers = new Map<number, number>()
  for (const p of nodes) layers.set(tb ? p.y : p.x, (layers.get(tb ? p.y : p.x) ?? 0) + 1)
  return { tb, nodes: nodes.length, layerCount: layers.size, widest: Math.max(...layers.values()) }
}

describe('Ch07 Mermaid 圖：排版（寬度）', () => {
  it('流程類、含回授迴圈與「兩路相乘」的圖用上下排列（TB），硬體結構圖維持左右排列（LR）；全章沒有菱形判斷節點', () => {
    for (const name of NAMES) expect(CH07_CHARTS[name].split('\n')[0], name).toBe(TB_CHARTS.includes(name) ? 'flowchart TB' : 'flowchart LR')
    // 判斷用六角形（比菱形省空間）：全章沒有菱形節點
    for (const chart of Object.values(CH07_CHARTS)) expect(chart).not.toMatch(/[A-Za-z0-9]\{"/)
  })

  it('桌機上不需要橫向捲動：估計寬度不超過約 5 個節點並排（TB 看最寬的一層）、約 7 層（LR 看層數）；高度不超過約 10 層', async () => {
    // 自然寬度要在約 1260 px 以內：一個節點加間距約 200–250 px，所以 TB 一層最多 5 個、LR 最多 7 層。
    // 第 7.6 節 RTL 位置圖原本是 LR（8 層以上，自然寬度 1776 px，桌機要橫向捲動），改成 TB 之後最寬的一層是 5 個並排的支路。
    const noGroups = NAMES.filter((n) => !/\bsubgraph\b/.test(CH07_CHARTS[n]))
    for (const name of noGroups) {
      const s = await layerShape(name)
      if (s.tb) {
        expect(s.widest, `${name} 最寬的一層`).toBeLessThanOrEqual(5)
        expect(s.layerCount, `${name} 層數`).toBeLessThanOrEqual(10)
      } else {
        expect(s.layerCount, `${name} 層數`).toBeLessThanOrEqual(7)
        expect(s.widest, `${name} 最高的一欄`).toBeLessThanOrEqual(4)
      }
    }
    // RTL 位置圖：code 一次分出五條支路（DTC 一條、四種 regressor 四條）並排，再收進 REG_GMAC_XSEL 與 GMAC
    const rtl = await layerShape('CHART_RTL_REGRESSORS')
    expect(rtl.tb).toBe(true)
    expect(rtl.widest).toBe(5)
  })

  it('宣告順序決定左右次序（diagrams.ts 的註解）：梯度圖的 u 在左、x 在右，e_PD 的兩條線不交叉；filtered-x 迴圈的模型那一支在左、w_k 回授線走最右側', async () => {
    // 節點的 DOM id 是 flowchart-<id>-<序號>
    const xOf = async (name: Ch07ChartName) => {
      const { host, position } = await layoutOf(name)
      return (id: string) => {
        const el = host.querySelector(`g.node[id^="flowchart-${id}-"]`)
        expect(el, `${name} 的 ${id}`).toBeTruthy()
        return position(el as Element).x
      }
    }
    const g = await xOf('CHART_GRADIENT')
    // 乘 u 的乘法器與結果（綠）在左，乘 x 的（紅）在右；(a − w) 與雜訊那一串夾在 H → MU 與 X → MX 兩條長線之間
    expect(g('MU')).toBeLessThan(g('MX'))
    expect(g('RU')).toBeLessThan(g('RX'))
    expect(g('MU')).toBeLessThanOrEqual(g('S'))
    expect(g('S')).toBeLessThanOrEqual(g('MX'))
    const f = await xOf('CHART_FX_LOOP')
    // 模型 Ĥ 與 z⁻ᴰ 在左，真實路徑 P、comparator 在右：回授線（ACC → P）從右側繞回 P，不穿過模型那一支
    expect(f('HAT')).toBeLessThan(f('P'))
    expect(f('DL')).toBeLessThan(f('CMP'))
  })

  it('並排比較的框上下疊、由上到下是 A → B（→ C），框內由左到右', async () => {
    fakeSvgMetrics()
    const stack = async (name: Ch07ChartName) => {
      const { svg } = await renderMermaidForTest(CH07_CHARTS[name])
      const host = document.createElement('div')
      host.innerHTML = svg
      // 每個獨立的框是一個巢狀的 g.root，transform 是它在整張圖裡的位置
      return Array.from(host.querySelectorAll('g.root'))
        .map((g) => {
          const cluster = g.querySelector(':scope > g.clusters > g.cluster')?.id
          const t = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '')
          const xs = Array.from(g.querySelectorAll(':scope > g.nodes > g.node')).map((n) => Number(/translate\(([-\d.]+)/.exec(n.getAttribute('transform') ?? '')?.[1]))
          return cluster && t ? { cluster, x: Number(t[1]), y: Number(t[2]), columns: new Set(xs).size } : null
        })
        .filter((v): v is { cluster: string; x: number; y: number; columns: number } => v !== null)
        .sort((a, b) => a.y - b.y)
    }
    const side = await stack('CHART_DELAY_SIDE')
    expect(side.map((c) => c.cluster)).toEqual(['SIDE_CODE', 'SIDE_ERR'])
    const three = await stack('CHART_THREE_REGRESSORS')
    expect(three.map((c) => c.cluster)).toEqual(['ARCH_RAW', 'ARCH_DLY', 'ARCH_FX'])
    for (const c of [...side, ...three]) {
      expect(c.x, c.cluster).toBe(0) // 同一欄：上下疊，不是左右排
      expect(c.columns, c.cluster).toBeGreaterThanOrEqual(3) // 框內由左到右（至少 3 欄）
    }
    expect(new Set(side.map((c) => c.y)).size).toBe(2)
    expect(new Set(three.map((c) => c.y)).size).toBe(3)
  })
})

describe('Ch07 Mermaid 圖：與本章公式一致', () => {
  // 標籤直接比對圖的原始碼（`$...$` 的 LaTeX 寫法）；畫出來的樣子由上面的 renderer 測試保證與 KaTeX 單獨排版的結果相同
  it('加法點的每一條輸入線都標了正負號（＋／−），而且和公式的符號相同', async () => {
    const sums: Partial<Record<Ch07ChartName, Record<string, string | RegExp>>> = {
      // e_PD = δ·u + v
      CHART_SIGNAL_MODEL: { GE: r`$+\delta\cdot u[n]$`, V: r`$+v[n]$` },
      // δ_k = a − w_k
      CHART_MEAN_LOOP: { A: '$+a$', ACC: '$-w_k$' },
      // e_PD = (a − w)·u + v
      CHART_GRADIENT: { GE: '＋', V: '＋' },
      // x_ref = K₂·(x[n] − 2x[n−1] + x[n−2])
      CHART_SECOND_DIFF: { X: '$+x[n]$', SH: '$-2x[n-1]$', R2: '$+x[n-2]$' },
      // PD 的輸出 = reference 輸入（DTC 留下的誤差，＋）− 回授（L·PD 的輸出）⇒ H_PD = 1/(1 + L)，正號
      CHART_TYPE2_LOOP: { E: '＋', DL: /-\$$/ },
    }
    // 有圓形加法點的圖就是這五張（其餘的圖把「相加」寫在方塊的公式裡）；Type-II 迴路的減法點就是 PD，圓圈裡寫「PD」
    expect(NAMES.filter((n) => /\(\("(?:＋|PD)"\)\)/.test(CH07_CHARTS[n])).sort()).toEqual(Object.keys(sums).sort())
    expect(NAMES.filter((n) => /\(\("PD"\)\)/.test(CH07_CHARTS[n]))).toEqual(['CHART_TYPE2_LOOP'])
    for (const [name, want] of Object.entries(sums) as [Ch07ChartName, Record<string, string | RegExp>][]) {
      const f = await parseFlow(CH07_CHARTS[name])
      expect(f.text('S'), name).toBe(name === 'CHART_TYPE2_LOOP' ? 'PD' : '＋')
      const inputs = f.into('S')
      expect(inputs.map((e) => e.start).sort(), name).toEqual(Object.keys(want).sort())
      for (const e of inputs) {
        const w = want[e.start]
        if (typeof w === 'string') expect(e.text ?? '', `${name}: ${e.start} → S`).toBe(w)
        else expect(e.text ?? '', `${name}: ${e.start} → S`).toMatch(w)
      }
    }
  })

  it('訊號模型：e_PD = δ·u + v、δ = a − w、q = sign(e_PD)，GMAC 乘的是 x[n−D]', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_SIGNAL_MODEL)
    expect(f.edge('X', 'H')).toHaveLength(1)
    expect(f.edge('H', 'GE')).toEqual(['$u[n]$'])
    expect(f.text('GE')).toContain(r`$\delta = a - w$`)
    expect(f.edge('GE', 'S')).toEqual([r`$+\delta\cdot u[n]$`])
    expect(f.text('V')).toContain('$v[n]$')
    expect(f.text('V')).toContain(r`$\sigma_v$`)
    expect(f.edge('V', 'S')).toEqual([r`$+v[n]$`])
    // comparator 的輸入線標「PD 的輸出」：e_PD 就是送進 loop filter 的同一個訊號（docs/assumptions.md §2a 第 3 點）
    expect(f.edge('S', 'CMP').map(oneLine)).toEqual([r`PD 的輸出 $e_{\mathrm{PD}}[n] = \delta\cdot u[n] + v[n]$`])
    expect(f.into('CMP').map((e) => e.start)).toEqual(['S'])
    expect(f.text('CMP')).toContain(r`$q = \mathrm{sign}(e_{\mathrm{PD}})$`)
    expect(f.edge('CMP', 'M')).toEqual(['$q[n]$'])
    expect(f.edge('X', 'DLY')).toHaveLength(1)
    expect(f.edge('DLY', 'M')).toEqual(['$x[n-D]$'])
    expect(f.text('AVG')).toContain(r`$G_k = \tfrac{1}{N}\sum q[n]\cdot x[n-D]$`)
    // 紅色＝造成問題的誤差路徑；藍色＝本章加上的延遲
    expect(f.classOf('H')).toEqual(['warn'])
    expect(f.classOf('DLY')).toEqual(['focus'])
    // 全章沒有任何一張圖把極性寫成 δ = w − a（Unicode 或 LaTeX 的寫法都不行）
    for (const chart of Object.values(CH07_CHARTS)) expect(chart).not.toMatch(/w − a|w_k − a|\bw(?:_k)? - a\b|\\delta\s*=\s*w\b/)
  })

  it('延遲放哪一側：code 側是 φ + ΩD、comparator 側是 φ − ΩD（與模型的 residualPhaseDeg 同一個約定）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_DELAY_SIDE)
    expect(f.edge('XA', 'DA')).toHaveLength(1)
    expect(f.edge('DA', 'MA')).toEqual(['$x[n-D]$'])
    expect(f.edge('QA', 'MA')).toHaveLength(1)
    expect(f.text('RA')).toContain(r`$\phi + \Omega D$`)
    expect(f.text('RA')).toContain(r`$\phi \lt 0$`)
    expect(f.text('RA')).toContain('落後')
    expect(f.edge('QB', 'DB')).toHaveLength(1)
    expect(f.edge('DB', 'MB')).toEqual(['$q[n-D]$'])
    expect(f.edge('XB', 'MB')).toHaveLength(1)
    expect(f.text('RB')).toContain(r`$\phi - \Omega D$`)
    expect(f.text('RB')).toContain(r`$\phi \gt 0$`)
    expect(f.text('RB')).toContain('超前')
    // 兩個 subgraph 的標題：做法 A 延遲 code（標題裡的 D 也是公式）、做法 B 延遲 comparator 輸出
    expect(f.subgraphs.map((g) => g.title).sort()).toEqual(['做法 A：延遲 code（本站的 $D$）', '做法 B：延遲 comparator 輸出'])
    // 模型：φ = −120°、Ω = 30°、D = 1 ⇒ code 側 −90°、error 側 −150°
    expect(residualPhaseDeg(-120 * RAD, 30 * RAD, 1, 'code')).toBeCloseTo(-90, 9)
    expect(residualPhaseDeg(-120 * RAD, 30 * RAD, 1, 'error')).toBeCloseTo(-150, 9)
  })

  it('相位記帳與兩個 tone 的例子數字由模型重算：θ = 0°（T07）、θ₂ = +120°、cos θ₂ = −0.5', async () => {
    const theta1 = residualPhaseDeg(-120 * RAD, 30 * RAD, 4)
    const theta2 = residualPhaseDeg(-120 * RAD, 60 * RAD, 4)
    expect(theta1).toBeCloseTo(0, 9)
    expect(theta2).toBeCloseTo(120, 9)
    expect(Math.cos(theta2 * RAD)).toBeCloseTo(-0.5, 12)
    const book = await parseFlow(CH07_CHARTS.CHART_PHASE_BOOKKEEPING)
    expect(book.text('H')).toContain(r`相位加 $\phi$`)
    expect(book.text('H')).toContain(r`$\phi = -120^\circ$`)
    expect(book.text('D')).toContain(r`相位減 $\Omega D$`)
    expect(book.text('D')).toContain(r`$D = 4$，$\Omega D = ${30 * 4}^\circ$`)
    expect(book.edge('H', 'M')).toEqual([r`$u$：$\Omega n + \phi$`])
    expect(book.edge('D', 'M')).toEqual([r`$x[n-D]$：$\Omega n - \Omega D$`])
    expect(book.text('M')).toContain(r`$\theta = \phi + \Omega D$`)
    expect(book.text('M')).toContain(r`$-120^\circ + ${30 * 4}^\circ = ${Math.round(theta1)}^\circ$`)
    expect(book.text('Q')).toBe(r`$|\theta| \lt 90^\circ$？`)
    expect(book.classOf('POS')).toEqual(['ok'])
    expect(book.classOf('NEG')).toEqual(['warn'])
    expect(book.text('POS')).toContain(r`$C_D \gt 0$`)
    expect(book.text('NEG')).toContain(r`$C_D \le 0$`)
    const two = await parseFlow(CH07_CHARTS.CHART_TWO_TONES)
    expect(two.text('A1')).toContain(r`$\phi_1 = -120^\circ$`)
    expect(two.text('B1')).toContain(r`$\Omega_1 D = ${30 * 4}^\circ$`)
    expect(two.text('B2')).toContain(r`$\Omega_2 D = ${60 * 4}^\circ$`)
    expect(two.text('C1')).toContain(r`$\theta_1 = \phi_1 + \Omega_1 D = ${Math.round(theta1)}^\circ$`)
    expect(two.text('C2')).toContain(r`$\theta_2 = \phi_2 + \Omega_2 D = +${Math.round(theta2)}^\circ$`)
    expect(two.text('C1')).toContain(r`$\cos\theta_1 = +1$`)
    expect(two.text('C2')).toContain(r`$\cos\theta_2 = -0.5$`)
    expect(two.text('SUM')).toContain(r`$C_D = \sum_i \tfrac{A_i^2}{2}\cdot|H_i|\cdot\cos\theta_i$`)
    expect(two.subgraphs.map((g) => g.title).sort()).toEqual([r`tone 1：$\Omega_1 = 30^\circ$/sample（對準的頻率）`, r`tone 2：$\Omega_2 = 60^\circ$/sample`])
    expect(two.classOf('C1')).toEqual(['ok'])
    expect(two.classOf('C2')).toEqual(['warn'])
  })

  it('乘法器 + 平均器：常數項 cos(φ + ΩD) 留下、兩倍頻項 cos(2Ωn + φ − ΩD) 被平均掉（F-07.2 的推導）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_MIXER_AVERAGE)
    expect(f.text('XD')).toBe(r`$x[n-D] = A\cdot\cos(\Omega n - \Omega D)$`)
    expect(f.text('U')).toBe(r`$u[n] = A\cdot|H|\cdot\cos(\Omega n + \phi)$`)
    expect(f.text('M')).toBe(r`$\times$`)
    expect(f.text('DC')).toContain(r`$\tfrac{A^2|H|}{2}\cdot\cos(\phi + \Omega D)$`)
    expect(f.text('HF')).toContain(r`$\tfrac{A^2|H|}{2}\cdot\cos(2\Omega n + \phi - \Omega D)$`)
    expect(f.text('C')).toBe(r`$C_D = \tfrac{A^2}{2}\cdot|H|\cdot\cos(\phi + \Omega D)$`)
    // 數值驗算積化和差：cos(α)cos(β) = ½[cos(α − β) + cos(α + β)]，α = Ωn + φ、β = Ωn − ΩD
    const [om, phi, D, n] = [0.37, -2.1, 3, 5]
    expect(Math.cos(om * n - om * D) * Math.cos(om * n + phi)).toBeCloseTo(0.5 * (Math.cos(phi + om * D) + Math.cos(2 * om * n + phi - om * D)), 12)
  })

  it('delay line：第 D 個 tap 的相位是 −DΩ（線性相位），MUX 輸出 x[n−D]', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_DELAY_LINE)
    expect(f.edge('X', 'MUX')).toEqual([r`相位 $0$`])
    for (const [i, id] of ['R1', 'R2', 'R3', 'R4'].entries()) {
      expect(f.text(id)).toBe('$z^{-1}$')
      // 第 i+1 級之後的 tap：相位 −(i+1)Ω
      expect(f.edge(id, 'MUX')).toEqual([`$-${i === 0 ? '' : i + 1}\\Omega$`])
    }
    expect(f.edge('X', 'R1')).toHaveLength(1)
    expect(['R1>R2', 'R2>R3', 'R3>R4'].every((k) => f.edges.some((e) => `${e.start}>${e.end}` === k))).toBe(true)
    expect(f.text('MUX')).toContain(r`$\mathtt{REG\_GMAC\_DLY} = D$`)
    expect(f.edge('MUX', 'GMAC')).toEqual(['$x[n-D]$'])
  })

  it('平均迴路：δ_k = a − w_k（a 進正端、w_k 進負端）、E[G_k] ≈ K_q·C·δ_k、w_{k+1} = w_k + μ·G_k ⇒ pole = 1 − μ·K_q·C（用遞迴重算）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_MEAN_LOOP)
    expect(f.edge('A', 'S')).toEqual(['$+a$'])
    expect(f.edge('ACC', 'S')).toEqual(['$-w_k$'])
    expect(f.edge('S', 'KC')).toEqual([r`$\delta_k = a - w_k$`])
    expect(f.text('KC')).toContain(r`$K_q\cdot C$`)
    // 平均 GMAC 是小訊號線性化的近似：連線寫 ≈（和走圖文字、F-07.11、Ch04／Ch06 的平均迴路圖一致），不寫等號
    expect(f.edge('KC', 'MU')).toEqual([r`$E[G_k] \approx K_q\cdot C\cdot\delta_k$`])
    expect(f.edge('MU', 'ACC')).toEqual([r`$\mu\cdot G_k$`])
    expect(f.text('ACC')).toContain(r`$\tfrac{1}{z-1}$`)
    expect(f.text('ACC')).toContain(r`$w_{k+1} = w_k + \mu\cdot G_k$`)
    expect(f.classOf('KC')).toEqual(['focus'])
    // 一圈一圈走：T07 的 D = 0（C = −0.25，反向）與 D = 4（C = +0.5）；μ = 10 fs、σ_v = 100 fs、A = |H| = 1
    const tone = { A: 1, mag: 1, phiRad: -120 * RAD, omega: 30 * RAD }
    for (const D of [0, 4]) {
      const C = toneCorrCodeDelay(tone, D)
      const [a, mu, Kq] = [3, 10, kq(100)]
      let w = 0
      for (let k = 1; k <= 25; k++) {
        const delta = a - w
        w += mu * (Kq * C * delta) // w_{k+1} = w_k + μ·E[G_k]
        expect(a - w, `D = ${D}, k = ${k}`).toBeCloseTo((1 - mu * Kq * C) ** k * a, 9)
      }
    }
    expect(1 - 10 * kq(100) * toneCorrCodeDelay(tone, 0)).toBeGreaterThan(1)
    expect(1 - 10 * kq(100) * toneCorrCodeDelay(tone, 4)).toBeLessThan(1)
  })

  it('有限 N 的 block 平均：只有兩倍頻那一路改變，乘上 sin(NΩ)/(N·sin Ω)、n 換成 block 的中點（逐點加總重算 F-07.6）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_BLOCK_AVERAGE)
    expect(f.text('P')).toContain(r`$x[n-D]\cdot u[n]$`)
    expect(f.text('P')).toContain(r`$n = n_0, \ldots, n_0 + N - 1$`)
    expect(f.text('DC')).toContain(r`$\tfrac{A^2|H|}{2}\cdot\cos(\phi + \Omega D)$`)
    expect(f.text('HF')).toContain(r`$\tfrac{A^2|H|}{2}\cdot\cos(2\Omega n + \phi - \Omega D)$`)
    expect(f.edge('DC', 'AVG')).toEqual(['原封不動'])
    expect(f.edge('HF', 'AVG')[0]).toContain(r`$n_0 + \tfrac{N-1}{2}$`)
    expect(f.edge('HF', 'AVG')[0]).toContain(r`$\tfrac{\sin(N\Omega)}{N\cdot\sin\Omega}$`)
    expect(f.classOf('DC')).toEqual(['focus'])
    expect(f.classOf('HF')).toEqual(['warn'])
    // 逐點加總 (1/N)Σ x[n−D]·u[n]（A = |H| = 1），對照圖上的兩項
    for (const [omega, N, D, n0] of [[0.37, 16, 3, 5], [Math.PI / 6, 64, 4, 0], [Math.PI - 0.05, 32, 2, 7]]) {
      const phi = -120 * RAD
      let sum = 0
      for (let n = n0; n < n0 + N; n++) sum += Math.cos(omega * (n - D)) * Math.cos(omega * n + phi)
      const brute = sum / N
      const nc = n0 + (N - 1) / 2
      const dc = 0.5 * Math.cos(phi + omega * D)
      const ripple = 0.5 * Math.cos(2 * omega * nc + phi - omega * D) * (Math.sin(N * omega) / (N * Math.sin(omega)))
      expect(brute).toBeCloseTo(dc + ripple, 12)
      expect(toneBlockCorr({ A: 1, mag: 1, phiRad: phi, omega, D, N, n0 }).exact).toBeCloseTo(brute, 12)
    }
  })

  it('bring-up 量極性：S = (G₊ − G₋)/(2Δw) = −K_q·C；S ＜ 0 ⇔ C ＞ 0（T07：D = 0 反向、D = 4 正確）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_BRINGUP)
    expect(f.text('W1')).toContain(r`$w_0 + \Delta w$`)
    expect(f.text('W2')).toContain(r`$w_0 - \Delta w$`)
    expect(f.text('GP')).toContain('$G_+ = E[G_k]$')
    expect(f.text('GM')).toContain('$G_- = E[G_k]$')
    expect(f.text('SL')).toContain(r`$S = \tfrac{G_+ - G_-}{2\Delta w}$`)
    expect(f.text('SL')).toContain(r`$\approx -K_q\cdot C$`)
    expect(f.into('SL').map((e) => e.start).sort()).toEqual(['GM', 'GP'])
    expect(f.text('Q')).toBe(r`$S \lt 0$？`)
    expect(f.edge('Q', 'OK')).toEqual(['是'])
    expect(f.edge('Q', 'BAD')).toEqual(['否'])
    expect(f.text('OK')).toContain(r`$C \gt 0$`)
    expect(f.text('BAD')).toContain(r`$C \le 0$`)
    expect(f.classOf('OK')).toEqual(['ok'])
    expect(f.classOf('BAD')).toEqual(['warn'])
    const tone = { A: 1, mag: 1, phiRad: -120 * RAD, omega: 30 * RAD }
    const [a, w0, dw, Kq] = [3, 1, 0.25, kq(100)]
    for (const [D, ok] of [[0, false], [4, true]] as const) {
      const C = toneCorrCodeDelay(tone, D)
      const G = (w: number) => Kq * C * (a - w) // E[G_k] ≈ K_q·C·(a − w)
      const S = (G(w0 + dw) - G(w0 - dw)) / (2 * dw)
      expect(S).toBeCloseTo(-Kq * C, 12)
      expect(S < 0, `D = ${D}`).toBe(ok)
    }
  })

  it('filtered-x 迴圈：乘法在 sample rate（n）、平均之後是 block rate（k），w_{k+1} = w_k + μ·G_k 回授到真實路徑', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_FX_LOOP)
    // 這張圖的 w_k 每個 block 都在更新：(a − w_k) 提到 h 的卷積外面只是近似（F-06.1），所以寫 ≈，不是 =
    expect(f.text('P')).toContain(r`$e_{\mathrm{PD}}[n] \approx (a - w_k)\cdot(h * x)[n] + v[n]$`)
    // 真實路徑是「reference 端的 DTC → PD」，它的輸出就是 PD 的輸出；comparator 的輸入只從這裡拉
    expect(f.text('P')).toContain('reference 端的 DTC 到 PD')
    expect(f.text('P')).toContain('PD 的輸出')
    expect(f.edge('P', 'CMP')).toEqual([r`PD 的輸出 $e_{\mathrm{PD}}[n]$`])
    expect(f.into('CMP').map((e) => e.start)).toEqual(['P'])
    expect(f.text('CMP')).toContain(r`$q = \mathrm{sign}(e_{\mathrm{PD}})$`)
    expect(f.edge('CMP', 'M')).toEqual(['$q[n]$'])
    expect(f.text('HAT')).toContain(r`$u_f = \hat h * x$`)
    expect(f.edge('HAT', 'DL')).toHaveLength(1)
    expect(f.edge('DL', 'M')).toEqual(['$u_f[n-D]$'])
    expect(f.edge('M', 'AVG')).toEqual(['每個 sample $n$'])
    expect(f.text('AVG')).toContain(r`$G_k = \tfrac{1}{N}\sum q[n]\cdot u_f[n-D]$`)
    expect(f.edge('AVG', 'ACC')).toEqual(['每個 block $k$'])
    expect(f.text('ACC')).toContain(r`$w_{k+1} = w_k + \mu\cdot G_k$`)
    expect(f.text('ACC')).toContain(r`$\tfrac{1}{z-1}$`)
    // 校正迴路的回授：w_k 送回 reference 端的 DTC（負回授 a − w_k）
    expect(f.edge('ACC', 'P')).toEqual([r`$w_k$ 送回 DTC（負回授：$a - w_k$）`])
  })

  it('凍結 w 的前提（R06b）：只有 w_k 在更新的閉迴路圖把 e_PD 寫成 ≈；w 凍結的圖（訊號模型、梯度、Type-II 迴路）維持等號，RTL 圖照真實順序先乘後濾', async () => {
    // 原始碼層級：「e_PD[n] ≈」只出現在 CHART_FX_LOOP
    for (const name of NAMES) {
      expect(/e_\{\\mathrm\{PD\}\}\[n\] \\approx/.test(CH07_CHARTS[name]), name).toBe(name === 'CHART_FX_LOOP')
    }
    const loop = await parseFlow(CH07_CHARTS.CHART_FX_LOOP)
    expect(loop.text('P')).not.toContain(r`$e_{\mathrm{PD}}[n] = (a - w_k)`)
    // 對照：w 凍結的三張圖
    const model = await parseFlow(CH07_CHARTS.CHART_SIGNAL_MODEL)
    expect(model.edge('S', 'CMP').map(oneLine)).toEqual([r`PD 的輸出 $e_{\mathrm{PD}}[n] = \delta\cdot u[n] + v[n]$`])
    const grad = await parseFlow(CH07_CHARTS.CHART_GRADIENT)
    expect(grad.text('GE')).toContain('$(a - w)$')
    const t2 = await parseFlow(CH07_CHARTS.CHART_TYPE2_LOOP)
    expect(t2.edge('S', 'PI')).toEqual([r`$(a - w)\cdot u[n]$`])
    // RTL 位置圖：DTC 先乘 (a − w_k)，再進 H_PD（真實電路的順序，不需要近似）
    const rtl = await parseFlow(CH07_CHARTS.CHART_RTL_REGRESSORS)
    expect(rtl.edge('DTC', 'H')).toEqual([r`$(a - w_k)\cdot x[n]$`])
    // 兩拍的反例（7.4 節的 Engineer 框）：h = [1, −1]、x ≡ 1、a = 1，w 由 0 跳到 1
    const [h, x, a, w] = [[1, -1], [1, 1], 1, [0, 1]]
    const filterOfProduct = h[0] * (a - w[1]) * x[1] + h[1] * (a - w[0]) * x[0] // 先乘後濾（真實電路）
    const productOfFilter = (a - w[1]) * (h[0] * x[1] + h[1] * x[0]) // 先濾後乘（F-07.1 的寫法）
    expect(filterOfProduct).toBe(-1)
    expect(productOfFilter).toBe(0)
    // 差 = Σ_{m≥1} h[m]·(w[n] − w[n−m])·x[n−m]
    expect(filterOfProduct - productOfFilter).toBe(h[1] * (w[1] - w[0]) * x[0])
    // w 不動（0 → 0 或 1 → 1）時兩者相等
    for (const w0 of [0, 1]) expect(h[0] * (a - w0) * x[1] + h[1] * (a - w0) * x[0]).toBe((a - w0) * (h[0] * x[1] + h[1] * x[0]))
  })

  it('三種 regressor 並排：x_ref 分別是 x[n]、x[n−D]、u_f[n]；藍色是多出來的 z⁻ᴰ 與 Ĥ', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_THREE_REGRESSORS)
    expect(f.edge('XA', 'MA')).toEqual([r`$x_{\mathrm{ref}} = x[n]$`])
    expect(f.edge('DB', 'MB')).toEqual([r`$x_{\mathrm{ref}} = x[n-D]$`])
    expect(f.edge('HC', 'MC')).toEqual([r`$x_{\mathrm{ref}} = u_f[n]$`])
    expect(f.text('GA')).toContain(r`$C = E[x\cdot u]$`)
    expect(f.text('GB')).toContain(r`$C_D = E[x[n-D]\cdot u]$`)
    expect(f.text('GC')).toContain(r`$E[u\cdot u_f]$`)
    expect(f.text('DB')).toContain('$z^{-D}$')
    expect(f.text('HC')).toContain(r`$u_f = \hat h * x$`)
    expect([...f.vertices.values()].filter((v) => v.classes?.includes('focus')).map((v) => v.id).sort()).toEqual(['DB', 'HC'])
  })

  it('梯度：乘 u 得到 (a − w)·E[u²]（綠）、乘 x 得到 (a − w)·C（紅）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_GRADIENT)
    expect(f.edge('H', 'MU')).toEqual(['$u[n]$'])
    expect(f.edge('X', 'MX')).toEqual(['$x[n]$'])
    expect(f.edge('S', 'MU')).toEqual([r`$e_{\mathrm{PD}}[n]$`])
    expect(f.edge('S', 'MX')).toEqual([r`$e_{\mathrm{PD}}[n]$`])
    // dJ/dw = −E[e_PD·u]：乘 u 的那一路是負梯度（下降方向）
    expect(f.edge('MU', 'RU')).toEqual(['$-dJ/dw$：真正的梯度'])
    expect(f.edge('MX', 'RX')).toEqual(['乘的是 $x$：raw-x'])
    // 數值驗算（T07 的單頻、不含雜訊）：一個週期的平均 E[e·u] = (a − w)·E[u²]、E[e·x] = (a − w)·C_0
    const [om, phi, del] = [Math.PI / 6, -120 * RAD, 0.7]
    const pts = Array.from({ length: 12 }, (_, n) => ({ x: Math.cos(om * n), u: Math.cos(om * n + phi) }))
    const mean = (g: (p: { x: number; u: number }) => number) => pts.reduce((a, p) => a + g(p), 0) / pts.length
    expect(mean((p) => del * p.u * p.u)).toBeCloseTo(del * mean((p) => p.u * p.u), 12)
    expect(mean((p) => del * p.u * p.x)).toBeCloseTo(del * toneCorrCodeDelay({ A: 1, mag: 1, phiRad: phi, omega: om }, 0), 12)
    expect(f.text('GE')).toContain('$(a - w)$')
    expect(f.text('RU')).toContain(r`$(a - w)\cdot E[u^2]$`)
    expect(f.text('RU')).toContain(r`$E[u^2] \ge 0$`)
    expect(f.text('RX')).toContain(r`$(a - w)\cdot C$，$C = E[x\cdot u]$`)
    expect(f.classOf('RU')).toEqual(['ok'])
    expect(f.classOf('RX')).toEqual(['warn'])
  })

  it('模型誤差：每個頻率的票是 S_xx·|H|·|Ĥ|·cos(∠H − ∠Ĥ)；latency 例子的 −0.5 由模型重算（Ĥ = H·z⁻⁴）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_MISMATCH)
    expect(f.text('COR')).toContain(r`$E[u\cdot u_f]$`)
    expect(f.text('COR')).toContain(r`$S_{xx}\cdot|H|\cdot|\hat H|\cdot\cos(\angle H - \angle\hat H)$`)
    expect(f.edge('H', 'COR')[0]).toContain('$u[n]$')
    expect(f.edge('HAT', 'COR')).toEqual(['$u_f[n]$'])
    expect(f.text('Q')).toContain(r`$|\angle H - \angle\hat H| \lt 90^\circ$`)
    expect(f.text('POS')).toContain(r`$E[u\cdot u_f] \gt 0$`)
    expect(f.classOf('HAT')).toEqual(['focus'])
    const lat = await parseFlow(CH07_CHARTS.CHART_LATENCY_MISMATCH)
    expect(lat.edge('H', 'COR')).toEqual([r`$u$：$\Omega n + \phi$`])
    expect(lat.edge('DL', 'COR')).toEqual([r`$u_f$：$\Omega n + \phi - \Omega\Delta$`])
    expect(lat.text('DL')).toContain(r`$z^{-\Delta}$`)
    expect(lat.text('COR')).toContain(r`$\angle H - \angle\hat H = \Omega\Delta$`)
    expect(lat.text('R')).toContain(r`$E[u\cdot u_f] = |H|^2\cdot\cos(\Omega\Delta)$`)
    expect(lat.text('R')).toContain(r`$\Omega = 30^\circ$、$\Delta = 4$`)
    expect(lat.text('R')).toContain(r`$\cos ${30 * 4}^\circ = -0.5$`)
    const path: FxPathSpec = { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: Math.PI / 6 }
    const code: FxCodeSpec = { kind: 'sinusoid', omega: Math.PI / 6 }
    const hat = buildHat(path, { ...HAT_EXACT, extraDelay: 4 }, code)
    expect(analyticCorr({ code, h: pathTransfer(path), g: hat.full, D: 0 }) as number).toBeCloseTo(-0.5, 9)
  })

  it('投票圖：票的重量是 S_xx·|H|、票的正負是 cos(φ + ΩD)，相乘後對所有頻率加總（F-07.7／F-07.8）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_VOTING)
    expect(f.text('WGT')).toContain(r`$S_{xx}(\Omega)$`)
    expect(f.text('WGT')).toContain(r`$|H(\Omega)|$`)
    expect(f.text('SGN')).toContain(r`$\cos(\phi(\Omega) + \Omega D)$`)
    expect(f.into('PROD').map((e) => e.start).sort()).toEqual(['SGN', 'WGT'])
    expect(f.text('SUM')).toContain(r`$C_D = \sum_i$ 或 $\tfrac{1}{2\pi}\int d\Omega$`)
    expect(f.text('P1')).toContain(r`$p = 1 - \mu\cdot K_q\cdot C_D \lt 1$`)
    expect(f.text('P2')).toContain(r`$p \ge 1$`)
    expect(f.classOf('SGN')).toEqual(['focus'])
  })

  it('Type-II 迴路：L(z) = (K_p + K_i/(1 − z⁻¹))·1/(1 − z⁻¹)·z^−(1+d)，負回授；圓圈是 PD（reference 輸入為正、回授為負），PD 的輸出同時送進 loop filter 與 comparator', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_TYPE2_LOOP)
    expect(f.text('PI')).toContain(r`$K_p + \tfrac{K_i}{1 - z^{-1}}$`)
    expect(f.text('DCO')).toContain(r`$\tfrac{1}{1 - z^{-1}}$`)
    expect(f.text('DL')).toContain(r`$z^{-(1+d)}$`)
    expect(f.edges.map((e) => `${e.start}>${e.end}`)).toEqual(expect.arrayContaining(['S>PI', 'PI>DCO', 'DCO>DL', 'DL>S', 'S>OUT']))
    // 輸入是 (a − w)·x、PD 的輸出是 (a − w)·u（u = h_PD * x）；雜訊 v 在迴路外、comparator 前才加進來
    expect(f.text('E')).toContain(r`$(a - w)\cdot x[n]$`)
    expect(f.edge('S', 'PI')).toEqual([r`$(a - w)\cdot u[n]$`])
    expect(f.edge('S', 'OUT')).toEqual([r`$(a - w)\cdot u[n]$`])
    expect(f.text('OUT')).toContain('雜訊 $v[n]$')
    // 架構（docs/assumptions.md §2a 第 1、3、5 點）：圓圈是 PD；DTC 留下的誤差從 reference 端（正端）進來，回授從負端進來
    expect(f.text('S')).toBe('PD')
    expect(f.text('E')).toContain('reference 端')
    expect(f.text('E')).toContain('DTC')
    expect(f.edge('E', 'S')).toEqual(['＋'])
    // 回授線標明走的是 divider（回授路徑上只有 divider；以時間為單位時增益是 1，所以不另外畫方塊），進 PD 的負端
    expect(f.edge('DL', 'S')).toEqual([r`divider 的回授，$-$`])
    expect(f.into('S').map((e) => e.start).sort()).toEqual(['DL', 'E'])
    // DTC 不在回授路徑上：DTC 那個節點是純粹的來源（沒有任何線進去），迴圈 PD → PI → DCO → 延遲 → PD 上沒有 DTC
    expect(f.into('E')).toEqual([])
    for (const id of ['PI', 'DCO', 'DL']) expect(f.text(id), id).not.toContain('DTC')
    // comparator 取的是 PD 的輸出——和送進 loop filter 的是同一個節點：PD 只有兩條輸出線，標籤相同
    expect(f.edges.filter((e) => e.start === 'S').map((e) => e.end).sort()).toEqual(['OUT', 'PI'])
    expect(f.edge('S', 'OUT')).toEqual(f.edge('S', 'PI'))
    expect(f.text('OUT')).toContain('同一個 PD 輸出')
    expect(f.text('OUT')).toContain('comparator')
    expect(f.into('OUT').map((e) => e.start)).toEqual(['S'])
  })

  it('二次差分與 RTL 位置圖：x_ref = K₂·(x[n] − 2x[n−1] + x[n−2])、G_k = (1/N)Σ q·x_ref、w_{k+1} = w_k + μ·G_k', async () => {
    const sd = await parseFlow(CH07_CHARTS.CHART_SECOND_DIFF)
    expect(sd.text('O')).toBe(r`$x_{\mathrm{ref}}[n] = K_2\cdot(x[n] - 2x[n-1] + x[n-2])$`)
    expect(sd.edge('R1', 'R2')).toEqual(['$x[n-1]$'])
    expect(sd.edge('R1', 'SH')).toEqual(['$x[n-1]$'])
    const rtl = await parseFlow(CH07_CHARTS.CHART_RTL_REGRESSORS)
    expect(rtl.edge('DTC', 'H')).toEqual([r`$(a - w_k)\cdot x[n]$`])
    // 架構：DTC 在 reference 輸入端；comparator 的輸入只從 PD 的輸出拉；進 DTC 的只有 code 與校正係數 w_k（沒有 divider → DTC）
    expect(rtl.text('DTC')).toContain('reference 端的 DTC')
    expect(rtl.edge('H', 'CMP').map(oneLine)).toEqual([r`PD 的輸出 $e_{\mathrm{PD}}[n]$`])
    expect(rtl.into('CMP').map((e) => e.start)).toEqual(['H'])
    expect(rtl.into('DTC').map((e) => e.start).sort()).toEqual(['UPD', 'X'])
    expect(rtl.edges.filter((e) => e.start === 'DTC').map((e) => e.end)).toEqual(['H'])
    expect(rtl.text('MUX')).toContain(r`$\mathtt{REG\_GMAC\_DLY} = D$`)
    expect(rtl.text('SEL')).toContain(r`$\mathtt{REG\_GMAC\_XSEL}$`)
    expect(rtl.text('SD')).toContain(r`$K_2\cdot(x[n] - 2x[n-1] + x[n-2])$`)
    expect(rtl.edge('SEL', 'GMAC')).toEqual([r`$x_{\mathrm{ref}}[n]$`])
    expect(rtl.text('GMAC')).toContain(r`$G_k = \tfrac{1}{N}\sum q[n]\cdot x_{\mathrm{ref}}[n]$`)
    expect(rtl.edge('GMAC', 'UPD')).toEqual(['每個 block $k$'])
    expect(rtl.text('UPD')).toContain(r`$w_{k+1} = w_k + \mu\cdot G_k$`)
    expect(rtl.edge('UPD', 'DTC')).toEqual(['$w_k$'])
    const rho = await parseFlow(CH07_CHARTS.CHART_RHO_READING)
    expect(rho.text('N1')).toContain(r`$E[x_{\mathrm{ref}}\cdot u]$`)
    expect(rho.text('N2')).toContain(r`$\sqrt{E[x_{\mathrm{ref}}^2]\cdot E[u^2]}$`)
    expect(rho.text('SG')).toContain(r`$\rho \gt 0$`)
    expect(rho.text('SG')).toContain(r`$\rho \lt 0$`)
    expect(rho.text('MG')).toContain(r`$\sigma_w \propto \tfrac{1}{\sqrt{N}\cdot|\rho|}$`)
  })

  it('架構約定（docs/assumptions.md §2a）：沒有任何一張圖的回授路徑上有 DTC，也沒有 divider → DTC 的線；畫到 comparator 的圖，comparator 的輸入都標成 PD 的輸出', async () => {
    for (const name of NAMES) {
      const chart = CH07_CHARTS[name]
      // 舊接法的字眼不會出現在任何標籤裡（下面是「不可以出現」的樣式）
      expect(chart, name).not.toMatch(/DTC 插入|插入延遲|推回|divider 之後|回授路徑上的 DTC|feedback 側|回授側注入/)
      const f = await parseFlow(chart)
      const isDtc = (id: string) => /DTC/.test(f.text(id))
      const isDivider = (id: string) => /divider|除頻|PMUX/i.test(f.text(id))
      // 沒有 divider／PMUX → DTC 的線；DTC 的輸出也不會接回 divider
      for (const e of f.edges) {
        expect(isDivider(e.start) && isDtc(e.end), `${name}: ${e.start} → ${e.end}`).toBe(false)
        expect(isDtc(e.start) && isDivider(e.end), `${name}: ${e.start} → ${e.end}`).toBe(false)
      }
    }
    // comparator 方塊（q = sign(e_PD)）只出現在這三張圖；它唯一的輸入線標著「PD 的輸出」與 e_PD[n]
    const taps: Partial<Record<Ch07ChartName, string>> = { CHART_SIGNAL_MODEL: 'S', CHART_FX_LOOP: 'P', CHART_RTL_REGRESSORS: 'H' }
    const withCmp: Ch07ChartName[] = []
    for (const name of NAMES) {
      const f = await parseFlow(CH07_CHARTS[name])
      if (!f.text('CMP').includes(r`\mathrm{sign}(e_{\mathrm{PD}})`)) continue
      withCmp.push(name)
      const inputs = f.into('CMP')
      expect(inputs.map((e) => e.start), name).toEqual([taps[name]])
      expect(inputs[0].text ?? '', name).toContain('PD 的輸出')
      expect(inputs[0].text ?? '', name).toContain(r`$e_{\mathrm{PD}}[n]`)
    }
    expect(withCmp.sort()).toEqual(Object.keys(taps).sort())
    // 第四張是 Type-II 迴路：comparator 從標著 PD 的圓圈拉線（上一個測試逐項檢查）
    const t2 = await parseFlow(CH07_CHARTS.CHART_TYPE2_LOOP)
    expect(t2.text('S')).toBe('PD')
    expect(t2.edge('S', 'OUT')).toHaveLength(1)
  })

  it('手算流程圖的 ①…⑨ 依序出現，且與 HC-07.8 的步驟順序相同（12 步：圖上一格對應一到兩步）', async () => {
    const chart = CH07_CHARTS.CHART_HANDCALC_FLOW
    const marks = '①②③④⑤⑥⑦⑧⑨'.split('')
    const pos = marks.map((m) => chart.indexOf(m))
    expect(pos.every((p) => p > 0)).toBe(true)
    const f = await parseFlow(chart)
    const want: [string, string][] = [
      ['A1', r`$C_{\mathrm{raw}} = |H|\cdot\cos\phi$`],
      ['B1', r`$\theta = \mathrm{wrap}(\phi + \Omega D)$`],
      ['B2', r`$C_D = |H|\cdot\cos\theta$`],
      ['C1', r`$E[u^2] = |H|^2$`],
      ['K1', r`$K_q = \tfrac{\sqrt{2/\pi}}{\sigma_v}$`],
      ['K2', r`$\mu\cdot K_q$`],
      ['P1', r`$p_{\mathrm{raw}} = 1 - \mu\cdot K_q\cdot C_{\mathrm{raw}}$`],
      ['P2', r`$p_D = 1 - \mu\cdot K_q\cdot C_D$`],
      ['P3', r`$p_f = 1 - \mu\cdot K_q\cdot E[u^2]$`],
    ]
    want.forEach(([id, tex], i) => {
      expect(f.text(id)).toContain(marks[i])
      expect(f.text(id)).toContain(tex)
    })
    expect(f.text('IN')).toContain(r`$A^2/2 = 1$`)
    expect(f.text('J')).toContain(r`$|p| \lt 1$`)
    const def = HANDCALCS.find((h) => h.id === 'HC-07.8')
    expect(def).toBeTruthy()
    const sol = def!.solve(defaultValues(def!))
    expect(sol.steps).toHaveLength(12)
    // 手算題的結果順序：三個相關、三個 pole（與圖上 ①③④、⑦⑧⑨ 相同）
    expect(sol.results.map((x) => x.symbol)).toEqual([String.raw`C_{\mathrm{raw}}`, 'C_D', 'E[u^2]', String.raw`p_{\mathrm{raw}}`, 'p_D', 'p_f'])
    // 預設值（Gallery #4）：C_raw = −0.5、C_4 = +1、E[u²] = 1
    expect(sol.results.slice(0, 3).map((x) => x.value)).toEqual([-0.5, 1, 1])
  })

  it('決策流程與成本階梯：四種做法都出現，filtered-x 之後一定檢查 E[u·u_f] 的符號', async () => {
    const d = await parseFlow(CH07_CHARTS.CHART_DECISION)
    expect(d.text('A')).toContain(r`$S \approx -K_q\cdot C$`)
    for (const [id, word] of [['RAW', 'raw-x'], ['SD', '二次差分'], ['DX', 'delayed-x'], ['FX', 'filtered-x']] as const) expect(d.text(id)).toContain(word)
    expect(d.edge('FX', 'Q4')).toHaveLength(1)
    expect(d.text('Q4')).toContain(r`$E[u\cdot u_f] \gt 0$`)
    expect(d.edge('Q4', 'FIX')).toEqual(['否'])
    expect(d.edge('FIX', 'FX')).toHaveLength(1)
    expect(d.text('DX')).toContain(r`$D \approx \tfrac{(-\phi) \bmod 2\pi}{\Omega}$`)
    expect(d.text('SD')).toContain(r`$K_2\cdot(1 - z^{-1})^2$`)
    const ladder = await parseFlow(CH07_CHARTS.CHART_COST_LADDER)
    expect(['L0', 'L1', 'L2', 'L3'].map((id) => ladder.text(id).split(' ')[0] + ladder.text(id).split(' ')[1])).toEqual(['第0', '第1', '第2', '第3'])
    expect(ladder.edges.map((e) => `${e.start}>${e.end}`)).toEqual(['L0>L1', 'L1>L2', 'L2>L3'])
    expect(ladder.text('L1')).toContain(r`$2\times B$ 個 flip-flop`)
    expect(ladder.text('L2')).toContain(r`$D_{\max}\times B$ 個 flip-flop`)
    expect(ladder.text('L3')).toContain(r`$L_{\mathrm{FIR}}$ 個乘法器`)
  })
})

describe('Ch07 頁面上的方塊圖', () => {
  it('章首有 SystemMap（手排的 SVG，標出 RES、ALIGN、GMAC）；全章 23 張圖（系統地圖 + 22 張）裡，22 張 Mermaid 圖都送進 mermaid.render；每張圖在對應公式之前，圖說用 LaTeX，圖後緊接「先看…再看…」的走圖說明', async () => {
    const byChart = new Map<string, string>(NAMES.map((n) => [sanitizeMermaidSource(CH07_CHARTS[n]), n]))
    const seen: string[] = []
    const spy = vi.spyOn(mermaid, 'render').mockImplementation(async (id: string, text: string) => {
      seen.push(text)
      return { svg: `<svg id="${id}" data-chart="${byChart.get(text) ?? 'UNKNOWN'}"><g></g></svg>`, diagramType: 'flowchart-v2' }
    })
    try {
      localStorage.setItem('lmspll.mode', 'engineer') // 第一次造訪預設 Beginner；這個測試數的是 Engineer 模式的 23 張圖
      const { container } = render(
        <SettingsProvider>
          <MemoryRouter initialEntries={['/ch/07']}>
            <Chapter07 />
          </MemoryRouter>
        </SettingsProvider>,
      )
      const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
      expect(figures).toHaveLength(23)
      // 等 22 張 Mermaid 圖都渲染完（render 依序排隊）；系統地圖不經過 Mermaid，一開始就是完整的 SVG
      await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg[data-chart]')).toHaveLength(22), { timeout: 60_000, interval: 50 })
      // 頁面實際送去畫的原始碼＝diagrams.ts 的 22 張（系統地圖是手排的 SVG，不送進 mermaid.render），沒有漏網的手寫圖
      expect(container.querySelector('svg[data-chart="UNKNOWN"]')).toBeNull()
      expect([...new Set(seen)].sort()).toEqual(Object.values(CH07_CHARTS).map(sanitizeMermaidSource).sort())
      expect(seen).toHaveLength(22)

      const fig = (name: string) => {
        const el = container.querySelector(`svg[data-chart="${name}"]`)?.closest('figure')
        expect(el, name).toBeTruthy()
        return el as HTMLElement
      }
      const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

      // 系統地圖：全章第一張圖（手排的 SVG：figure.c-sysmap > svg.c-sysmap-svg，沒有 data-chart），在 7.1 節之前，
      // 標出本章的三個方塊（is-focus）；後面一句話說明藍色方塊與本章新增的東西
      const map = container.querySelector('figure.c-sysmap') as HTMLElement
      expect(map).toBeTruthy()
      expect(figures[0]).toBe(map)
      expect(map.querySelector('.c-mermaid-svg svg.c-sysmap-svg')).toBeTruthy()
      expect(map.querySelector('svg[data-chart]')).toBeNull()
      expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
      // 畫面上被標成主角的方塊（g.c-sysmap-block.is-focus）＝ systemMapModel(CH07_SYSTEM_FOCUS) 的主角＝ RES、ALIGN、GMAC，其餘方塊沒有 is-focus
      const focusedInDom = Array.from(map.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
      const focusedInModel = systemMapModel(CH07_SYSTEM_FOCUS).blocks.filter((b) => b.focused).map((b) => b.id)
      expect(focusedInDom.sort()).toEqual(['align', 'gmac', 'res'])
      expect(focusedInDom).toEqual([...focusedInModel].sort())
      expect(map.querySelectorAll('g.c-sysmap-block[data-focus="true"]')).toHaveLength(3)
      expect(map.querySelectorAll('g.c-sysmap-block').length).toBe(systemMapModel(CH07_SYSTEM_FOCUS).blocks.length)
      for (const block of ['Fractional residue x[n]', 'Code alignment / delay / filtered-x', 'GMAC']) expect(map.querySelector('figcaption')?.textContent).toContain(block)
      expect(follows(map, container.querySelector('#ch07-problem') as Element)).toBe(true)
      expect(map.nextElementSibling?.tagName).toBe('P')
      expect(map.nextElementSibling?.textContent).toMatch(/藍色的三塊是本章的主角/)
      expect(map.nextElementSibling?.textContent).toMatch(/本章新增的只有/)

      // [圖, 所在的節, 它必須出現在哪個元素之前]
      const placement: [Ch07ChartName, string, string][] = [
        ['CHART_SIGNAL_MODEL', '#ch07-problem', '[id="handcalc-HC-07.1"]'],
        ['CHART_PHASE_BOOKKEEPING', '#ch07-problem', '[id="handcalc-HC-07.1"]'],
        ['CHART_MEAN_LOOP', '#ch07-problem', '#ch07-derivation'],
        ['CHART_MIXER_AVERAGE', '#ch07-derivation', '[id="formula-F-07.2"]'],
        ['CHART_DELAY_SIDE', '#ch07-derivation', '[id="formula-F-07.3"]'],
        ['CHART_BLOCK_AVERAGE', '#ch07-derivation', '[id="formula-F-07.6"]'],
        ['CHART_DELAY_LINE', '#ch07-linear-phase', '[id="formula-F-07.4"]'],
        ['CHART_TWO_TONES', '#ch07-linear-phase', '[id="formula-F-07.4"]'],
        ['CHART_VOTING', '#ch07-linear-phase', '[id="formula-F-07.7"]'],
        ['CHART_GRADIENT', '#ch07-gradient', '[id="formula-F-07.9"]'],
        ['CHART_THREE_REGRESSORS', '#ch07-gradient', '[id="formula-F-07.11"]'],
        ['CHART_FX_LOOP', '#ch07-gradient', '[id="formula-F-07.10"]'],
        ['CHART_RHO_READING', '#ch07-gradient', '[id="formula-F-07.13"]'],
        ['CHART_MISMATCH', '#ch07-mismatch', '[id="formula-F-07.12"]'],
        ['CHART_LATENCY_MISMATCH', '#ch07-mismatch', '[id="handcalc-HC-07.6"]'],
        ['CHART_SECOND_DIFF', '#ch07-mismatch', '[id="formula-F-07.14"]'],
        ['CHART_TYPE2_LOOP', '#ch07-mismatch', '[id="formula-F-07.15"]'],
        ['CHART_RTL_REGRESSORS', '#ch07-hardware', '#ch07-lab'],
        ['CHART_COST_LADDER', '#ch07-hardware', '#ch07-lab'],
        ['CHART_DECISION', '#ch07-hardware', '#ch07-lab'],
        ['CHART_HANDCALC_FLOW', '#ch07-lab', '[id="handcalc-HC-07.8"]'],
        ['CHART_BRINGUP', '#ch07-pll', '#symbols'],
      ]
      expect(placement.map((p) => p[0]).sort()).toEqual([...NAMES].sort())
      for (const [name, section, before] of placement) {
        const el = fig(name)
        expect(el.closest(section), `${name} 應在 ${section}`).toBeTruthy()
        const target = container.querySelector(before)
        expect(target, before).toBeTruthy()
        expect(follows(el, target as Element), `${name} 應在 ${before} 之前`).toBe(true)
        // 圖說：一句話說明要看什麼；圖說裡的數學一律是 KaTeX（$...$），不是 Unicode 拼的公式
        const cap = el.querySelector('figcaption')
        expect((cap?.textContent ?? '').length, name).toBeGreaterThanOrEqual(20)
        const own = Array.from(cap?.childNodes ?? []).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
        expect(own, `${name} 的圖說含 Unicode 拼的數學：${own}`).not.toMatch(/[θΩωζφσμτρδ∠Ĥĥ√²≤≥≈±]|\b[A-Za-z]_([A-Za-z0-9]|ref|PD|raw)\b/)
        // 圖後緊接一段走圖說明（先看…再看…），而且裡面有 KaTeX（把圖和公式對起來）
        const walk = el.nextElementSibling
        expect(walk?.tagName, name).toBe('P')
        expect(walk?.textContent ?? '', name).toMatch(/先看/)
        expect(walk?.textContent ?? '', name).toMatch(/再看/)
        expect(walk?.querySelectorAll('.katex').length ?? 0, name).toBeGreaterThan(0)
      }
      // 圖在頁面上的先後順序與 diagrams.ts 的排列一致（跟著章節走）：章首的系統地圖，再來是 22 張 Mermaid 圖
      const order = figures.map((f) => f.querySelector('svg[data-chart]')?.getAttribute('data-chart') ?? (f.classList.contains('c-sysmap') ? 'SYSTEM_MAP' : null))
      expect(order).toEqual(['SYSTEM_MAP', ...NAMES])
      // 幾個「圖在後、公式在前」的關係：延遲方向的圖在 F-07.2 之後；latency 失效例子在 F-07.12 之後；手算流程圖在 Lab 之後
      expect(follows(container.querySelector('[id="formula-F-07.2"]') as Element, fig('CHART_DELAY_SIDE'))).toBe(true)
      expect(follows(container.querySelector('[id="formula-F-07.12"]') as Element, fig('CHART_LATENCY_MISMATCH'))).toBe(true)
      expect(follows(container.querySelector('[id="exp-delay-fx-lab"]') as Element, fig('CHART_HANDCALC_FLOW'))).toBe(true)
      // 平均迴路在相位記帳之後、算 pole 的公式之前；block 平均在兩倍頻推導之後；bring-up 流程在「本課必記」之後（7.10）
      expect(follows(fig('CHART_PHASE_BOOKKEEPING'), fig('CHART_MEAN_LOOP'))).toBe(true)
      expect(follows(fig('CHART_MIXER_AVERAGE'), fig('CHART_BLOCK_AVERAGE'))).toBe(true)
      expect(follows(container.querySelector('#ch07-recap') as Element, fig('CHART_BRINGUP'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  }, 240_000)
})
