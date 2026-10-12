import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, waitFor } from '@testing-library/react'
import mermaid from 'mermaid'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { SYSTEM_BLOCK_LABEL, SYSTEM_MAP_BLOCKS, stripMathDelimiters, systemMapModel } from '@/components'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import {
  accumulatorSizing,
  blockUpdate,
  incrementMeanError,
  negateExtended,
  negateInplace,
  roundingMeanError,
  saturateTwos,
  shiftRound,
  sumAverageTable,
  wrapTwos,
  xorCarryAccumulate,
  type Bit,
} from '@/simulation/models/gmac'
import * as diagramModule from './diagrams'
import {
  ACCUMULATOR_SIZING,
  ANTI_WINDUP,
  APPLY_MODES,
  AVERAGE_LOOP,
  BIAS_LOOP,
  BIT_MAPPING,
  CH04_DIAGRAMS,
  CLEAR_BUG,
  CONCEPT_FAST_LOOP,
  CONCEPT_LMS_LOOP,
  FIXED_DATAPATH,
  GAIN_ERROR_MODEL,
  GMAC_MEAN_MODEL,
  HANDCALC_FLOW,
  LATENCY_TIMELINE,
  NEGATE_BUG,
  NEGATE_DATAPATH,
  NOISE_FEEDBACK,
  RESIDUE_ACCUMULATOR,
  ROUNDING_MODES,
  RTL_DATAFLOW,
  SHIFT_BITS,
  SUM_VS_AVERAGE,
  TP1,
  TP2,
  diagramNumber,
} from './diagrams'
import {
  WRAP_WIDTH,
  displayText,
  hasMath,
  installSvgMeasurePolyfill,
  labelLines,
  mathLabelCount,
  renderedLabels,
  svgNaturalSize,
  textFragments,
  textWidth,
  unicodeMathInSource,
} from './diagramTestUtils'
import { HANDCALCS } from './handcalcs'
import Chapter04 from './index'
import { criticalGain, criticalGainInfo, delayCharPoly, latencyCalc } from './latency'
import { firstOrderAccumulator, residueSignals } from './residue'
import { defaultBiasNumbers, negateBugNumbers, wTruncNumbers } from './sections/FixedPoint'
import { handGmac, HAND_GMAC } from './sections/GmacMath'
import { clearVsNoClear } from './sections/HardwareNotes'
import { CH04_SYSTEM_CAPTION, CH04_SYSTEM_FOCUS } from './sections/Intro'

/**
 * Ch04 的方塊圖（docs/teaching-style.md §8）。這個檔案用「真正的 mermaid」做四件事：
 *  1. parser：每一張圖的語法；
 *  2. 實際渲染（jsdom + 估計字寬）：標籤文字沒有被 Markdown 吃掉（「Unsupported markdown」）、顏色有套上、圖沒有寬到看不清楚；
 *  3. 內容：加法點的正負號、δ = a − w 的極性、延遲與積分器的位置、圖上寫死的數字，逐一和本章公式與 gmac.ts / latency.ts / residue.ts 比對；
 *  4. 頁面：章首有 SystemMap（手排的 SVG，不經過 mermaid）、全部的圖依登錄表的順序出現、每一張都真的畫成了 SVG。
 * （ch04.test.tsx 為了速度把 mermaid mock 掉了；這裡沒有。）
 *
 * 圖上的數學都寫成 `$...$`（LaTeX，由共用 Mermaid 以 KaTeX 排版；docs/teaching-style.md §3、§8），所以這裡的內容斷言比對的是「圖原始碼的標籤」（用 String.raw 的 R`...` 寫，反斜線只寫一次）；
 * 畫出來的文字另外檢查：沒有殘留的 `$`、`mathCount` 等於含公式的標籤數、KaTeX 以外沒有 Unicode 拼的數學（unicodeMathIn），原始碼層級也沒有（unicodeMathInSource）。
 *
 * 想用眼睛看版面時：`CH04_DUMP_SVG=/tmp/ch04-svg npx vitest run src/chapters/ch04/diagrams.test.tsx` 會把每張圖的 SVG 寫到該目錄
 * （版面由估計字寬排出來，和瀏覽器不會逐像素相同，但欄數、方向、節點順序是對的）。
 */
const R = String.raw

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

/**
 * 這次改版之前就有的四張圖（保留、依勘誤修正標籤、改成較窄的版面）；
 * 其中整體架構圖 CONCEPT_SYSTEM 有 17 個方塊，超過單張 14 個節點的上限，所以拆成「快」（CONCEPT_FAST_LOOP）與「慢」（CONCEPT_LMS_LOOP）兩張。
 */
const ORIGINAL = ['CONCEPT_FAST_LOOP', 'CONCEPT_LMS_LOOP', 'RTL_DATAFLOW', 'NOISE_FEEDBACK', 'LATENCY_TIMELINE']
/** 單張圖的節點數上限（subgraph 標題不算；docs/teaching-style.md §8） */
const MAX_NODES = 14
const FLOWCHARTS = CH04_DIAGRAMS.filter((d) => d.type === 'flowchart-v2')

interface FlowVertex {
  id: string
  text?: string
  type?: string
  classes: string[]
}
interface FlowEdge {
  start: string
  end: string
  text?: string
  stroke?: string
}
interface FlowSubGraph {
  id: string
  title: string
  nodes: string[]
  dir?: string
}
interface FlowInfo {
  vertices: FlowVertex[]
  edges: FlowEdge[]
  subGraphs: FlowSubGraph[]
  /** 不含 subgraph 本身的節點 */
  nodes: FlowVertex[]
  node: (id: string) => FlowVertex
  into: (id: string) => FlowEdge[]
  edge: (start: string, end: string) => FlowEdge
}

/** 用 mermaid 自己的 parser 取出 flowchart 的節點與連線（db 是共用物件，所以立刻複製出來）。 */
async function flow(chart: string): Promise<FlowInfo> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, FlowVertex>; getEdges: () => FlowEdge[]; getSubGraphs: () => FlowSubGraph[] }
  const vertices = [...db.getVertices().values()].map((v) => ({ id: v.id, text: v.text, type: v.type, classes: [...v.classes] }))
  const edges = db.getEdges().map((e) => ({ start: e.start, end: e.end, text: e.text ?? '', stroke: e.stroke }))
  const subGraphs = db.getSubGraphs().map((s) => ({ id: s.id, title: s.title, nodes: [...s.nodes], dir: s.dir }))
  const groupIds = new Set(subGraphs.map((s) => s.id))
  const nodes = vertices.filter((v) => !groupIds.has(v.id))
  const node = (id: string) => {
    const v = vertices.find((x) => x.id === id)
    if (!v) throw new Error(`圖上沒有節點 ${id}`)
    return v
  }
  const edge = (start: string, end: string) => {
    const e = edges.find((x) => x.start === start && x.end === end)
    if (!e) throw new Error(`圖上沒有 ${start} → ${end} 這條線`)
    return e
  }
  return { vertices, edges, subGraphs, nodes, node, edge, into: (id) => edges.filter((e) => e.end === id) }
}

/** 一張 flowchart 的全部標籤（節點、連線、subgraph 標題） */
function allLabels(f: FlowInfo): string[] {
  return [...f.nodes.map((v) => v.text ?? ''), ...f.edges.map((e) => e.text ?? ''), ...f.subGraphs.map((s) => s.title)].filter((t) => t.trim().length > 0)
}
/** subgraph 標題以外的標籤（節點、連線）：會在約 200 px 自動換行，所以每一行要自己控制寬度 */
function wrappedLabels(f: FlowInfo): string[] {
  return [...f.nodes.map((v) => v.text ?? ''), ...f.edges.map((e) => e.text ?? '')].filter((t) => t.trim().length > 0)
}

const oneLine = (label: string | undefined): string => labelLines(label ?? '').join(' ')

let restoreMeasure: () => void
const rendered = new Map<string, string>()
let renderSeq = 0

/** 以頁面相同的設定（securityLevel: strict、HTML 標籤）實際渲染；結果快取。 */
async function renderSvg(name: string, chart: string): Promise<string> {
  const hit = rendered.get(name)
  if (hit) return hit
  // 與網站相同的前處理（sanitizeMermaidSource 會把含公式的標籤合併成 KaTeX 的 `$$...$$`）
  const { svg } = await mermaid.render(`ch04-test-${++renderSeq}`, sanitizeMermaidSource(chart))
  rendered.set(name, svg)
  const dump = process.env.CH04_DUMP_SVG
  if (dump) {
    mkdirSync(dump, { recursive: true })
    writeFileSync(join(dump, `${name}.svg`), svg)
  }
  return svg
}

beforeAll(() => {
  restoreMeasure = installSvgMeasurePolyfill()
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, fontFamily: 'sans-serif', forceLegacyMathML: true })
})
afterAll(() => restoreMeasure())

describe('Ch04 方塊圖：登錄表', () => {
  it('共 22 張（原有 4 張，其中整體架構圖拆成 2 張 = 5 張；新增 17 張），名稱不重複；模組匯出的每一張圖都有登錄', () => {
    expect(CH04_DIAGRAMS).toHaveLength(22)
    const names = CH04_DIAGRAMS.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of ORIGINAL) expect(names).toContain(n)
    expect(names.filter((n) => !ORIGINAL.includes(n)).length).toBe(17)
    const exported = Object.entries(diagramModule)
      .filter(([, v]) => typeof v === 'string' && /^(flowchart|sequenceDiagram|stateDiagram)/.test(v as string))
      .map(([k]) => k)
    expect(exported.sort()).toEqual([...names].sort())
    for (const d of CH04_DIAGRAMS) expect((diagramModule as Record<string, unknown>)[d.name], d.name).toBe(d.chart)
  })

  it('圖號依頁面順序 1…22；沒有登錄的圖會丟錯（頁面上不會出現沒經過測試的圖）', () => {
    CH04_DIAGRAMS.forEach((d, i) => expect(diagramNumber(d.chart)).toBe(i + 1))
    expect(() => diagramNumber('flowchart LR\n  A --> B')).toThrow(/沒有登錄/)
  })

  it('每個段落、每條有圖的公式都對得到：§1–§7 都有圖，重要章節至少 8 張（規範 §8）', () => {
    const sections = new Set(CH04_DIAGRAMS.map((d) => d.section))
    expect([...sections].sort()).toEqual(['§1', '§2', '§3', '§4', '§5', '§6', '§7'])
    expect(CH04_DIAGRAMS.length + 1).toBeGreaterThanOrEqual(8) // + 章首的系統地圖
    const formulas = CH04_DIAGRAMS.map((d) => d.formula).filter(Boolean)
    for (const id of ['F-04.1', 'F-04.2', 'F-04.4', 'F-04.5', 'F-04.7', 'F-04.8', 'F-04.9', 'F-04.11', 'F-04.12', 'F-04.13', 'F-04.14', 'F-04.15', 'F-04.17', 'F-04.18']) expect(formulas).toContain(id)
  })
})

describe('Ch04 方塊圖：真正的 mermaid parser', () => {
  it.each(CH04_DIAGRAMS.map((d) => [d.name, d] as const))('%s 可以解析', async (_name, d) => {
    const r = await mermaid.parse(d.chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe(d.type)
  })

  it('章首的系統地圖（SystemMap 是手排的 SVG，不經過 mermaid）：本章的 12 個方塊標成主角，其餘 5 個（reference、loop filter、VCO、quantizer、雜訊源）不亮', () => {
    expect(new Set(CH04_SYSTEM_FOCUS).size).toBe(CH04_SYSTEM_FOCUS.length)
    expect(CH04_SYSTEM_FOCUS).toEqual(['fcw', 'dsm', 'div', 'res', 'gc', 'dtc', 'pd', 'cmp', 'align', 'gmac', 'scale', 'acc'])
    const model = systemMapModel(CH04_SYSTEM_FOCUS)
    expect(model.blocks).toHaveLength(Object.keys(SYSTEM_BLOCK_LABEL).length) // 全站 17 個方塊都在
    const focused = model.blocks.filter((b) => b.focused).map((b) => b.id)
    expect([...focused].sort()).toEqual([...CH04_SYSTEM_FOCUS].sort())
    expect(focused).toHaveLength(12)
    expect(model.blocks.filter((b) => !b.focused).map((b) => b.id).sort()).toEqual(['lf', 'noise', 'qnt', 'ref', 'vco'])
    expect(CH04_SYSTEM_FOCUS.every((id) => SYSTEM_MAP_BLOCKS.some((b) => b.id === id))).toBe(true)
  })
})

describe('Ch04 方塊圖：寫法規則（逐張檢查）', () => {
  it.each(FLOWCHARTS.map((d) => [d.name, d] as const))('%s：節點數、標籤寫法、數學都寫成 $...$、加法點的正負號', async (name, d) => {
    const f = await flow(d.chart)
    // 單張不超過 14 個節點（整體架構圖已拆成 CONCEPT_FAST_LOOP 與 CONCEPT_LMS_LOOP 兩張）
    expect(f.nodes.length, `${name} 的節點數`).toBeLessThanOrEqual(MAX_NODES)
    expect(f.nodes.length).toBeGreaterThanOrEqual(5)
    // 裸的 < 只允許出現在 <br/>；不使用 HTML entity
    expect(d.chart.replace(/<br\/>/g, '')).not.toMatch(/[<&]/)
    // 不用 ASCII 拼希臘字母（要寫成 LaTeX 的 \mu、\delta、\sigma；前面有反斜線的不算）
    expect(d.chart).not.toMatch(/(?<!\\)\b(mu|delta|sigma|eps|sum of)\b/)
    // 數學一律在 $...$ 裡：標籤其餘的文字沒有 Unicode 拼的數學（希臘字母、上下標、≤、×、·、w_k、z⁻¹ …）
    expect(unicodeMathInSource(d.chart), `${name}：還有沒改成 $...$ 的 Unicode 數學`).toEqual([])
    const wrapped = new Set(wrappedLabels(f))
    // subgraph 標題：只寫文字（共用主題把 cluster 標題縮成節點文字的 0.86 倍，而 KaTeX 的每一層 span 又各縮一次，含公式的標題會小到看不見）、
    // 只有一行（Mermaid 只替標題留一行的高度）、不要長到比框還寬
    for (const g of f.subGraphs) {
      expect(g.title, `${name} 的 subgraph「${g.id}」標題只寫文字`).not.toContain('$')
      expect(g.title, `${name} 的 subgraph「${g.id}」標題只有一行`).not.toContain('<br/>')
      // 估計寬度上限 240：瀏覽器實際量到，估計 238 的「block 結束之後：每個 block 一次」還在一行內，估計 246 的「一個 block 之內：每個 sample 一次」
      // 與 278 的「LMS 校正迴路（每個 block 更新一次）」都被折成兩行（第二行貼在、甚至壓在第一個方塊後面）——這兩個標題已經改短
      expect(textWidth(displayText(g.title)), `${name} 的 subgraph「${g.id}」標題太長，會被折成兩行`).toBeLessThanOrEqual(240)
    }
    for (const label of allLabels(f)) {
      // `$` 成對（跳脫的 \$ 不算）
      expect((label.match(/(?<!\\)\$/g) ?? []).length % 2, `「${label}」的 $ 沒有成對`).toBe(0)
      for (const line of labelLines(label)) {
        // Mermaid 11 把純文字標籤當 Markdown：行首的 +、-、*、#、>、「1.」會變成清單／標題／引用
        expect(line, `「${line}」不可以用 Markdown 區塊符號開頭`).not.toMatch(/^([+\-*#>]|\d+[.)]\s)/)
        // 每一行不超過自動換行寬度，換行位置才會是我們自己選的（公式以排版後的大致寬度估計）；subgraph 標題不換行，下面另外檢查
        if (wrapped.has(label)) expect(textWidth(displayText(line)), `「${line}」太長，請用 <br/> 斷行`).toBeLessThanOrEqual(WRAP_WIDTH)
      }
      // 純文字標籤裡成對的 * 或獨立的 _…_ 會被當成斜體（含公式的標籤整個交給 KaTeX，不經 Markdown）
      if (!hasMath(label)) {
        expect((label.match(/\*/g) ?? []).length, label).toBeLessThanOrEqual(1)
        expect(label, label).not.toMatch(/(^|[\s（(])_[^_]+_($|[\s）)])/)
      }
    }
    // 加法點：圓形節點、文字是全形「＋」；每條進入的線都標 ＋ 或 −（負號寫在公式裡 `$-w$`，KaTeX 的文字模式沒有 U+2212）
    const junctions = f.nodes.filter((v) => v.type === 'circle' && v.text === '＋')
    for (const j of junctions) {
      const incoming = f.into(j.id)
      expect(incoming.length, `${j.id} 至少兩個輸入`).toBeGreaterThanOrEqual(2)
      for (const e of incoming) expect(e.text, `${e.start} → ${j.id} 要標正負號`).toMatch(/^(＋|−|\$-)/)
    }
    // 圓形節點只有加法點（＋）與乘法點（$\times$）
    for (const v of f.nodes.filter((x) => x.type === 'circle')) expect([R`＋`, R`$\times$`], `${v.id}`).toContain(v.text)
    expect(f.nodes.filter((v) => v.text === '+' || v.text === '-')).toEqual([])
  })

  it('時序圖（Mermaid 的 sequenceDiagram 不支援標籤裡的公式，改畫成 flowchart）：六個參與者，箭頭依「取樣 → 累加 → 交出 S_k → commit → apply」編號 (1)–(5)；左欄 (1)(2)、中間 (3)、右欄 (4)(5)', async () => {
    const f = await flow(LATENCY_TIMELINE)
    expect(['S', 'C', 'G', 'U', 'R', 'D'].map((id) => oneLine(f.node(id).text))).toEqual([
      R`Sample clock $f_s$`,
      'Comparator',
      R`GMAC（block $k$） sample $n = kN \ldots kN+N-1$`,
      'Update logic',
      'Gain register',
      'DTC control',
    ])
    // 實線箭頭依時間順序：(1)(2) 在左欄（每個 sample 一次）、(3) 是左右兩欄之間（block 結束時一次）、(4)(5) 在右欄；虛線只接最後一格的註解
    // （Mermaid 的限制：subgraph 內的節點只要連到外面，subgraph 自己的 direction 就失效，所以 (3) 畫在 subgraph 與 subgraph 之間，不是 G → U）
    // （(3) 是最後宣告的線，所以先依標籤上的編號排序再逐一比對）
    const number = (e: FlowEdge) => Number(/^\((\d)\) /.exec(e.text ?? '')?.[1])
    const arrows = f.edges.filter((e) => e.stroke !== 'dotted').sort((a, b) => number(a) - number(b))
    expect(arrows.map((e) => `${e.start}>${e.end}`)).toEqual(['S>C', 'C>G', 'BLK>NEXT', 'U>R', 'R>D'])
    arrows.forEach((e, i) => expect(number(e), `${e.start} → ${e.end}`).toBe(i + 1))
    // 兩欄各是一個 subgraph（標題只寫文字，含公式的標題會被縮得看不見）；block k 涵蓋的 sample 寫在 GMAC 方塊上；兩欄都是由上往下
    expect(f.subGraphs.map((s) => [s.id, s.title, [...s.nodes].sort(), s.dir])).toEqual([
      ['BLK', 'block 之內：每個 sample 一次', ['C', 'G', 'S'], 'TB'],
      ['NEXT', 'block 結束之後：每個 block 一次', ['D', 'NOTE', 'R', 'U'], 'TB'],
    ])
    expect(LATENCY_TIMELINE.split('\n')[0]).toBe('flowchart LR')
    const text = oneLine(f.edges.map((e) => e.text).join('<br/>'))
    for (const s of [
      R`code $x[n-D]$ 已對齊`,
      R`累加 $S \leftarrow S + q\,x_\mathrm{ref}$`,
      R`sample $kN+N-1$ 之後， 總和 $S_k$ 完成`,
      R`交出 $S_k$，然後清除 $S$`,
      R`$w_{k+1} = w_k + \mu\,G_k$`,
      R`pipeline $P_c$ 個 sample`,
      R`在 block $k+1+d$ 的開頭 apply`,
    ]) {
      expect(text).toContain(s)
    }
    expect(oneLine(f.node('NOTE').text)).toBe(R`PD 要到 block $k+1+d$ 才看到新的 gain`)
    expect(f.edge('D', 'NOTE').stroke).toBe('dotted')
  })
})

describe('Ch04 方塊圖：實際渲染（jsdom + 估計字寬）', () => {
  it.each(CH04_DIAGRAMS.map((d) => [d.name, d.chart] as const))(
    '%s：畫得出來，標籤文字原封不動（沒有 Unsupported markdown、沒有殘留的 $），公式都由 KaTeX 排版',
    async (name, chart) => {
      const svg = await renderSvg(name, chart)
      expect(svg).toMatch(/^<svg/)
      expect(svg).not.toContain('Unsupported markdown')
      expect(svg).not.toContain('Syntax error')
      const labels = renderedLabels(svg)
      expect(labels.join('\n'), '畫出來的文字不可殘留 $').not.toContain('$')
      const f = await flow(chart)
      const squash = (t: string) => t.replace(/[\s\u200b\u00a0]+/g, '')
      for (const label of allLabels(f)) {
        if (!hasMath(label)) {
          expect(labels, `SVG 裡找不到標籤「${oneLine(label)}」`).toContain(labelLines(label).join('\n'))
        } else {
          // 含公式的標籤整個交給 KaTeX：公式以外的文字（\text{}）要完整出現在同一個標籤裡
          const frags = textFragments(label).map(squash)
          expect(
            labels.some((l) => frags.every((fr) => squash(l).includes(fr))),
            `SVG 裡找不到標籤「${oneLine(label)}」的文字`,
          ).toBe(true)
        }
      }
      // classDef 的顏色有套到節點上；每個含公式的標籤剛好排成一個 KaTeX 區塊
      const doc = new DOMParser().parseFromString(`<div>${svg}</div>`, 'text/html')
      expect(doc.querySelectorAll('.katex').length, `${name} 的 KaTeX 區塊數`).toBe(mathLabelCount(chart))
      for (const cls of ['focus', 'warn', 'ok']) {
        const expected = f.nodes.filter((v) => v.classes.includes(cls)).length
        expect(doc.querySelectorAll(`g.node.${cls}`).length, `${name} 的 ${cls}`).toBe(expected)
      }
    },
    30_000,
  )

  it('圖不會寬到要橫向捲動或縮得看不清楚：自然寬度 ≤ 1260 px、高度 ≤ 1500 px（桌機正文欄約 890 px，docs/teaching-style.md §8 的版面寬度規則）', async () => {
    const sizes: Record<string, number> = {}
    for (const d of CH04_DIAGRAMS) {
      const { width, height } = svgNaturalSize(await renderSvg(d.name, d.chart))
      sizes[d.name] = Math.round(width)
      expect(width, `${d.name} 寬度`).toBeLessThanOrEqual(1260)
      // （jsdom 的估計值比瀏覽器高一些：含公式的方塊估得比較高；真實瀏覽器量到的最高是 CONCEPT_LMS_LOOP 的 1265 px 與 CONCEPT_FAST_LOOP 的 1256 px，見 scripts/diagram-audit.mjs，規範的目標是 1400 px）
      expect(height, `${d.name} 高度`).toBeLessThanOrEqual(1500)
      expect(width).toBeGreaterThan(200)
    }
    // 兩欄版面的圖（subgraph 內 direction TB、圖本身 LR）真的排成左右兩欄：寬度明顯大於單欄（公式的估計寬度比純文字窄一點，單欄約 300–400 px）
    for (const name of ['RTL_DATAFLOW', 'GMAC_MEAN_MODEL', 'NEGATE_DATAPATH', 'FIXED_DATAPATH', 'CLEAR_BUG', 'LATENCY_TIMELINE']) expect(sizes[name], name).toBeGreaterThan(600)
  }, 60_000)

  it('反面測試：以 ASCII「+」當加法點或標籤開頭時，畫面上會變成 Unsupported markdown（所以本章一律用全形「＋」）', async () => {
    const bad = 'flowchart LR\n  A["a"] -- "+" --> S((+))\n  B["w"] -- "− w" --> S\n  S --> C["1. 第一步"]'
    await mermaid.parse(bad, { suppressErrors: false }) // parser 不會報錯
    const { svg } = await mermaid.render('ch04-test-bad', bad)
    expect((svg.match(/Unsupported markdown: list/g) ?? []).length).toBe(3) // 邊標籤 +、節點 +、節點「1. 第一步」
    const good = bad.replace('"+"', '"＋"').replace('((+))', '(("＋"))').replace('1. 第一步', '第 1 步')
    expect((await mermaid.render('ch04-test-good', good)).svg).not.toContain('Unsupported markdown')
  })
})

describe('Ch04 方塊圖：內容與公式、模型一致', () => {
  it('δ = a − w 的極性：每一張有回授的圖，a 那條線標「＋」、w 那條線標「−」', async () => {
    const noise = await flow(NOISE_FEEDBACK)
    expect(noise.edge('A', 'SUB').text).toBe('＋')
    expect(noise.edge('INTG', 'SUB').text).toMatch(/^\$-w_k\$/)
    expect(noise.edge('SUB', 'MUL').text).toBe(R`$\delta_k = a - w_k$`)
    const avg = await flow(AVERAGE_LOOP)
    expect(avg.edge('A', 'SUB').text).toBe('＋')
    expect(avg.edge('INT', 'SUB').text).toBe(R`$-w_k$`)
    expect(avg.edge('SUB', 'K').text).toBe(R`$\delta_k = a - w_k$`)
    const bias = await flow(BIAS_LOOP)
    expect(bias.edge('A', 'SUB').text).toBe('＋')
    expect(bias.edge('INT', 'SUB').text).toBe(R`$-w$`)
    expect(bias.edge('SUB', 'K').text).toBe(R`$\delta = a - w$`)
    const gain = await flow(GAIN_ERROR_MODEL)
    expect(gain.edge('A', 'SUB').text).toMatch(/^＋ \$a\\,x\[n\]\$/)
    expect(gain.edge('W', 'SUB').text).toMatch(/^\$-w\\,x\[n\]\$/)
    expect(oneLine(gain.edge('SUB', 'PD').text)).toBe(R`$e_\mathrm{det}[n] = (a - w)\,x[n]$ $= \delta\,x[n]$`)
    // 兩條線就是 PD 的兩個輸入（DTC 在 reference 輸入端）：＋ 是 feedback edge 早到的時間，− 是 DTC 把 reference edge 提前的補償量
    expect(oneLine(gain.edge('A', 'SUB').text)).toBe(R`＋ $a\,x[n]$ feedback edge 早到的時間`)
    expect(oneLine(gain.edge('W', 'SUB').text)).toBe(R`$-w\,x[n]$ DTC 的補償量： reference edge 提前`)
    expect(oneLine(gain.node('PD').text)).toBe('PD 輸出 comparator 只看得到 這個殘差')
    expect(GMAC_MEAN_MODEL).toContain(R`$\delta_k = a - w_k$`)
  })

  it('CONCEPT_FAST_LOOP / CONCEPT_LMS_LOOP：標籤依勘誤修正——S_k 與 G_k 分開、q = 2b − 1、code 延遲用 D、有雜訊注入點；兩張圖在 PD、x[n]、w_k 接起來', async () => {
    // INL 的正負號照 Ch11／bias.ts：d(x) 是「這個 code 的延遲偏離直線的量」，多延遲為正 ⇒ delay = T_0 − w_k x + d(x)、e = (a − w)x + d(x)
    const DTC_LABEL = R`reference 端 DTC 的 delay $= T_0 - w_k\,x[n] + d(x)$`
    for (const chart of [CONCEPT_FAST_LOOP, CONCEPT_LMS_LOOP]) expect(chart).not.toMatch(/T_0 - \(w_k/)
    // 快的部分：DSM 的 carry 去 divider、餘數變成 code x[n]；LMS 校正迴路收成一個藍色方塊，只和快迴路有三條線
    const fast = await flow(CONCEPT_FAST_LOOP)
    expect(fast.edge('DSM', 'DIVCTL').text).toBe(R`carry $y[n]$`)
    expect(fast.edge('DSM', 'RES').text).toBe(R`residue $s[n] / M$`)
    expect(oneLine(fast.node('DTC').text)).toBe(DTC_LABEL)
    expect(oneLine(fast.node('GC').text)).toBe(R`Gain code correction $w_k\,x[n]$`)
    expect(oneLine(fast.node('FCW').text)).toBe(R`FCW $= N_\mathrm{int} + \mathrm{frac}$`)
    expect(fast.edge('RES', 'LMS').text).toBe(R`code $x[n]$`)
    expect(fast.edge('LMS', 'GC').text).toBe(R`gain $w_k$`)
    expect(fast.node('LMS').classes).toEqual(['focus'])
    for (const [a, b] of [['RES', 'GC'], ['GC', 'DTC'], ['REF', 'DTC'], ['DTC', 'PD'], ['PD', 'EOUT'], ['EOUT', 'PLLF'], ['PLLF', 'VCO'], ['VCO', 'DIV'], ['DIV', 'PD'], ['DIVCTL', 'DIV'], ['FCW', 'DSM']]) expect(() => fast.edge(a, b), `${a} → ${b}`).not.toThrow()
    expect(fast.subGraphs.map((s) => s.title)).toEqual(['主 PLL 迴路（每拍）'])
    // 框裡只有主 PLL 迴路的七個方塊；divider control 是 DSM 那一側的數位邏輯，放在框外（carry 那條長線才不必穿過框裡的 feedback edge）
    expect([...fast.subGraphs[0].nodes].sort()).toEqual(['DIV', 'DTC', 'EOUT', 'PD', 'PLLF', 'REF', 'VCO'])
    expect(fast.into('DIVCTL').map((e) => e.start)).toEqual(['DSM'])
    expect(fast.edges.filter((e) => e.start === 'DIVCTL').map((e) => e.end)).toEqual(['DIV'])
    // 架構（全站約定，docs/assumptions.md §2a）：DTC 在 reference 的輸入端——Reference clock → DTC → PD；
    // DTC 的輸入只有 reference 與 gain correction，回授路徑上只有 divider（VCO → divider → PD），沒有「divider → DTC」也沒有「reference 直接進 PD」
    expect(fast.into('DTC').map((e) => e.start).sort()).toEqual(['GC', 'REF'])
    expect(fast.into('PD').map((e) => e.start).sort()).toEqual(['DIV', 'DTC'])
    expect(fast.into('DIV').map((e) => e.start).sort()).toEqual(['DIVCTL', 'VCO'])
    expect(oneLine(fast.edge('DTC', 'PD').text)).toBe('延遲後的 reference edge')
    expect(fast.edge('DIV', 'PD').text).toBe('feedback edge')
    for (const [a, b] of [['DIV', 'DTC'], ['REF', 'PD'], ['DTC', 'DIV']]) expect(fast.edges.some((e) => e.start === a && e.end === b), `不可以有 ${a} → ${b}`).toBe(false)
    // LMS 校正迴路的輸入是 PD 的輸出 e[n]（§2a 第 3 點）：PD 輸出是一個膠囊形節點，同一個節點實線去 loop filter、虛線分接給 LMS
    expect(fast.node('EOUT').type).toBe('stadium')
    expect(oneLine(fast.node('EOUT').text)).toBe(R`PD 輸出 $e[n]$（fs）`)
    expect(fast.into('EOUT').map((e) => e.start)).toEqual(['PD'])
    expect(fast.edge('EOUT', 'PLLF').stroke).toBe('normal')
    expect(fast.edge('EOUT', 'LMS')).toMatchObject({ text: R`同一個 $e[n]$`, stroke: 'dotted' })
    expect(fast.into('LMS').map((e) => e.start).sort()).toEqual(['EOUT', 'RES'])
    expect(fast.edges.filter((e) => e.stroke === 'dotted').map((e) => `${e.start}>${e.end}`)).toEqual(['EOUT>LMS'])

    // 慢的部分（由上往下走一圈）：reference 端的 DTC → PD → 加法點（PD 量到的時間誤差 ＋ 雜訊 = PD 輸出 e[n]）→ comparator → GMAC（q × x_ref）→ ÷N → ×μ → accumulator → w_k → gain correction → 回到 DTC
    const f = await flow(CONCEPT_LMS_LOOP)
    expect(oneLine(f.node('GMAC').text)).toBe(R`GMAC $S_k = \sum q[n]\,x_\mathrm{ref}[n]$`)
    expect(oneLine(f.node('SCALE').text)).toBe(R`Normalize $G_k = S_k / N$ step $\mu$`)
    expect(oneLine(f.node('CMP').text)).toBe(R`1-bit comparator $b[n] = 1$ 若 $e[n] \ge 0$ $q[n] = 2b[n] - 1$`)
    expect(oneLine(f.node('ALIGN').text)).toContain(R`$x[n-D]$`)
    expect(oneLine(f.node('NOISE').text)).toBe(R`comparator 前雜訊 $v[n]$ RMS $\sigma_v$`)
    expect(oneLine(f.node('ACC').text)).toBe(R`Gain accumulator $w_{k+1} = w_k + \mu\,G_k$`)
    expect(oneLine(f.node('DTC').text)).toBe(DTC_LABEL)
    // 雜訊注入點：PD 後面的加法點，兩個輸入是「PD 量到的時間誤差」與 v[n]，輸出就是 PD 輸出 e[n]
    expect(f.node('SUM').type).toBe('circle')
    expect(f.edge('NOISE', 'SUM').text).toBe(R`＋ $v[n]$`)
    expect(f.edge('PD', 'SUM').text).toBe('＋ PD 量到的時間誤差')
    expect(f.into('SUM').map((e) => e.start).sort()).toEqual(['NOISE', 'PD'])
    // LMS 校正迴路的輸入是 PD 的輸出 e[n]：comparator 只有一個輸入，從加法點（PD 輸出）分接，線上註明同一個節點也送進 loop filter；
    // 不是從 DTC、divider 或沒有標示的地方拉
    expect(f.into('CMP').map((e) => e.start)).toEqual(['SUM'])
    expect(f.edge('SUM', 'CMP').stroke).toBe('dotted')
    expect(oneLine(f.edge('SUM', 'CMP').text)).toBe(R`PD 輸出 $e[n]$（fs） 也送進 loop filter`)
    expect(f.edge('ALIGN', 'GMAC').text).toBe(R`$x_\mathrm{ref}[n]$`)
    expect(f.edge('CMP', 'GMAC').text).toBe(R`$q[n]$`)
    expect(f.edge('GMAC', 'SCALE').text).toBe(R`$S_k$`)
    expect(f.edge('SCALE', 'ACC').text).toBe(R`$\mu\,G_k$`)
    expect(f.edge('ACC', 'GC').text).toBe(R`gain $w_k$`)
    expect(f.edge('RES', 'ALIGN').text).toBe(R`code $x[n]$`)
    for (const [a, b] of [['RES', 'GC'], ['RES', 'ALIGN'], ['GC', 'DTC'], ['DTC', 'PD'], ['PD', 'SUM']]) expect(() => f.edge(a, b), `${a} → ${b}`).not.toThrow()
    // DTC 在 reference 路徑上：它的輸出是「延遲後的 reference edge」，直接進 PD（實線）；DTC 的輸入只有 gain correction（Reference clock 的方塊畫在上一張圖）；
    // PD 的輸入在這張圖只有 DTC；整張圖只有分接給 comparator 的那一條是虛線
    expect(oneLine(f.edge('DTC', 'PD').text)).toBe('延遲後的 reference edge')
    expect(f.edge('DTC', 'PD').stroke).toBe('normal')
    expect(f.into('DTC').map((e) => e.start)).toEqual(['GC'])
    expect(f.into('PD').map((e) => e.start)).toEqual(['DTC'])
    // PD 的另一個輸入（divider 的 feedback edge）畫在上一張圖：這張圖的 PD 方塊上要寫明，才不會看起來像只有一個輸入的 PD；
    // 這張圖沒有 divider 方塊，所以也不可能有「divider → DTC」
    expect(oneLine(f.node('PD').text)).toBe('Phase detector / BBPD 另一輸入：feedback edge')
    expect(oneLine(fast.node('PD').text)).toBe('Phase detector / BBPD')
    expect(f.nodes.map((v) => v.id)).not.toContain('DIV')
    expect(f.edges.filter((e) => e.stroke === 'dotted').map((e) => `${e.start}>${e.end}`)).toEqual(['SUM>CMP'])
    // subgraph 標題只有一行（原本的「LMS 校正迴路（每個 block 更新一次）」太長，被折成兩行、第二行壓在方塊後面）
    expect(f.subGraphs.map((s) => s.title)).toEqual(['LMS 校正迴路（block rate）'])
    expect([...f.subGraphs[0].nodes].sort()).toEqual(['ACC', 'ALIGN', 'CMP', 'GMAC', 'SCALE'])
    expect([...f.nodes.filter((v) => v.classes.includes('focus')).map((v) => v.id)].sort()).toEqual(['ACC', 'GMAC', 'SCALE'])
    // 兩張圖共用的方塊：快迴路圖的 PD、RES、GC、DTC 在慢迴路圖裡再出現一次，名稱相同
    for (const id of ['PD', 'RES', 'GC', 'DTC']) expect(() => fast.node(id) && f.node(id), id).not.toThrow()
    expect(oneLine(f.node('GC').text)).toBe(oneLine(fast.node('GC').text))
    expect(oneLine(f.node('DTC').text)).toBe(oneLine(fast.node('DTC').text))
    // 17 個方塊（和系統地圖一樣多）：兩張圖合起來涵蓋全部，沒有任何一張超過 14 個節點
    expect(fast.nodes.length).toBeLessThanOrEqual(MAX_NODES)
    expect(f.nodes.length).toBeLessThanOrEqual(MAX_NODES)
    // 版面靠宣告順序（Mermaid／dagre 從第一個節點開始決定哪些線往回走）：圖 4-1 從 RES 開始（往回走的才會是 divider → PD 與 LMS → gain correction）、
    // carry 那條線寫在 residue 之前（carry 才會排在最左邊）、divider control 在框外；圖 4-2 從 DTC 開始。
    // 這樣排兩張圖都沒有任何交叉（瀏覽器裡逐條連線量過，見 diagrams.ts 的說明）；順序一換，DTC 會被排到最下面，或 carry 和 feedback edge 交叉，所以釘住
    expect(fast.nodes[0].id).toBe('RES')
    expect(CONCEPT_FAST_LOOP.split('\n')[1].trim()).toMatch(/^RES\[/)
    expect(fast.edges.findIndex((e) => e.start === 'DSM' && e.end === 'DIVCTL')).toBeLessThan(fast.edges.findIndex((e) => e.start === 'DSM' && e.end === 'RES'))
    expect(fast.edges.findIndex((e) => e.start === 'GC' && e.end === 'DTC')).toBeLessThan(fast.edges.findIndex((e) => e.start === 'REF' && e.end === 'DTC'))
    expect(fast.edges.findIndex((e) => e.start === 'DIVCTL' && e.end === 'DIV')).toBeLessThan(fast.edges.findIndex((e) => e.start === 'VCO' && e.end === 'DIV'))
    expect(f.nodes[0].id).toBe('DTC')
  })

  it('RESIDUE_ACCUMULATOR：照圖上的式子走一遍，和 residue.ts（F-04.1、F-04.2）逐拍相同', async () => {
    const f = await flow(RESIDUE_ACCUMULATOR)
    expect(f.edge('ADD', 'WRAP').text).toBe(R`$t[n] = s[n-1] + K_\mathrm{F}$`)
    expect(oneLine(f.node('WRAP').text)).toBe(R`溢位判斷（mod $M$） $t[n] \ge M$ 時 $y[n] = 1$ 否則 $y[n] = 0$ $s[n] = t[n] - M\,y[n]$`)
    expect(f.edge('REG', 'ADD').text).toBe(R`＋ $s[n-1]$`)
    expect(f.edge('WRAP', 'DIV').text).toBe(R`carry $y[n]$`)
    expect(oneLine(f.node('NORM').text)).toBe(R`$\div M$ $x[n] = s[n] / M$`)
    // 下半部（全站約定，docs/assumptions.md §2a）：兩條 edge 在 PD 相遇。divider 的 feedback edge 早到 s/M 個 T_vco，直接進 PD、不經過 DTC；
    // DTC 在 reference 路徑上（輸入是 reference clock 與 code），從基準延遲 T_0 往回扣，把 reference edge 也提前 x·T_vco
    expect(oneLine(f.edge('DIV', 'PD').text)).toBe(R`feedback edge 早到 $s[n]/M$ 個 $T_\mathrm{vco}$ $r[n] = -s[n]/M$`)
    expect(oneLine(f.node('DIV').text)).toBe(R`Divider（回授路徑） 這一拍除 $N_\mathrm{int} + y[n]$`)
    expect(oneLine(f.node('DTC').text)).toBe(R`DTC（reference 路徑） $\tau_\mathrm{DTC}[n] = T_0 - x[n]\,T_\mathrm{vco}$`)
    expect(oneLine(f.edge('DTC', 'PD').text)).toBe(R`reference edge 也提前 $x[n]\,T_\mathrm{vco}$`)
    expect(oneLine(f.node('PD').text)).toBe(R`PD：量 $t_\mathrm{ref}' - t_\mathrm{fb}$ 兩條 edge 對齊`)
    expect(f.into('DTC').map((e) => e.start).sort()).toEqual(['NORM', 'REFCLK'])
    expect(f.into('PD').map((e) => e.start).sort()).toEqual(['DIV', 'DTC'])
    expect(f.edges.some((e) => e.start === 'DIV' && e.end === 'DTC'), '不可以有 divider → DTC').toBe(false)
    expect(RESIDUE_ACCUMULATOR).not.toContain('插入' + '延遲')
    expect(oneLine(f.node('KF').text)).toBe(R`FCW 小數字 $K_\mathrm{F}$ $\mathrm{frac} = K_\mathrm{F} / M$`)
    expect(oneLine(f.node('REG').text)).toBe(R`$z^{-1}$ 暫存器 $B_\mathrm{dsm}$ bits $M = 2^{B_\mathrm{dsm}}$`)
    expect(f.edge('NORM', 'DTC').text).toBe(R`code $x[n] \in [0, 1)$`)
    // 圖上的遞迴：t = s_prev + K_F；y = (t ≥ M)；s = t − M·y；r = −s/M；x = s/M；需要的補償量 τ_need = x·T_vco（DTC 的延遲是 T_0 − x·T_vco）
    const KF = 5
    const bits = 4
    const M = 2 ** bits
    const rows = firstOrderAccumulator(KF, bits, 40)
    const sig = residueSignals({ kind: 'first_order', frac: KF / M, bits, length: 40, gainErrPct: 1, fvcoGHz: 13 })
    let s = 0
    rows.forEach((row, n) => {
      const t = s + KF
      const y = t >= M ? 1 : 0
      s = t - M * y
      expect([row.t, row.y, row.s]).toEqual([t, y, s])
      expect(row.residue).toBeCloseTo(-s / M, 15)
      expect(row.cumErr).toBeCloseTo(-s / M, 12)
      const x = s / M
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      expect(sig.dtcNeedFs[n]).toBeCloseTo(x * sig.tvcoFs, 6)
      // GAIN_ERROR_MODEL：a·x − w·x = (a − w)·x，其中 a = T_vco、w = (1 − ε)·a
      const a = sig.tvcoFs
      const w = (1 - 0.01) * a
      expect(sig.residualFs[n]).toBeCloseTo(a * x - w * x, 6)
      // 同一個數字用「兩條 edge」再算一次（以鎖定後的理想時刻為 0）：feedback edge 早到 a·x ⇒ t_fb = −a·x；
      // reference 端的 DTC 延遲 T_0 − w·x，T_0 被 PLL 吸收 ⇒ t_ref′ = −w·x；PD 量 t_ref′ − t_fb = (a − w)·x，補償不足（w < a）時為正
      const tFb = -a * x
      const tRef = -w * x
      expect(tRef - tFb).toBeCloseTo(sig.residualFs[n], 6)
      expect(tRef - tFb).toBeGreaterThanOrEqual(0)
      // DTC 只能延遲：基準延遲 T_0 取一個 T_vco 就夠（x < 1），code 越大延遲越短，而且永遠不為負
      expect(a - w * x).toBeGreaterThan(0)
    })
  })

  it('RTL_DATAFLOW / NEGATE_DATAPATH：條件取負、位元寬度與兩種速率', async () => {
    const rtl = await flow(RTL_DATAFLOW)
    expect(rtl.subGraphs.map((s) => [s.title, s.dir])).toEqual([
      ['sample rate（每個 sample 一次）', 'TB'],
      ['block rate（每個 block 一次）', 'TB'],
    ])
    expect(rtl.subGraphs[0].nodes.sort()).toEqual(['CLR', 'NEG', 'Q', 'SUM', 'X'])
    expect(rtl.subGraphs[1].nodes.sort()).toEqual(['ADD', 'APPLY', 'AVG', 'SAT', 'STEP', 'W'])
    expect(oneLine(rtl.edge('FAST', 'SLOW').text)).toBe(R`總和 $S_k$ 每 $N$ 個 sample 一次`)
    expect(rtl.edge('CLR', 'SUM').stroke).toBe('dotted')
    // 看不見的連線 X ~~~ Q 只負責把兩個輸入上下錯開（左欄才不會太寬，圖不必縮小）；其餘的線都看得見，沒有多出任何箭頭
    expect(rtl.edges.filter((e) => e.stroke === 'invisible').map((e) => `${e.start}~${e.end}`)).toEqual(['X~Q'])
    expect(rtl.edges.filter((e) => e.stroke !== 'invisible')).toHaveLength(10)
    expect(oneLine(rtl.node('NEG').text)).toBe(R`條件取負 $b = 1$：$x$ 原樣 $b = 0$：$\overline{x} + 1$`)
    expect(oneLine(rtl.node('SUM').text)).toContain(R`$1 + \lceil \log_2 (N M_x + 1) \rceil$`)
    expect(oneLine(rtl.node('AVG').text)).toContain(R`$\log_2 N - F_G$ bits`)
    // 最後一格是「套用」不是「commit」：commit 要 P_c 個 sample，DTC 在 block k+1+d 才用到（和 LATENCY_TIMELINE 同一個說法）
    expect(oneLine(rtl.node('APPLY').text)).toBe(R`實體 DTC code 映射 commit（$P_c$ 個 sample）後 block $k+1+d$ 才套用`)
    expect(LATENCY_TIMELINE).toContain(R`在 block $k+1+d$<br/>的開頭 apply`)
    for (const [a, b] of [['X', 'NEG'], ['Q', 'NEG'], ['NEG', 'SUM'], ['AVG', 'STEP'], ['STEP', 'ADD'], ['ADD', 'SAT'], ['SAT', 'W'], ['W', 'APPLY']]) expect(() => rtl.edge(a, b)).not.toThrow()

    const neg = await flow(NEGATE_DATAPATH)
    expect(oneLine(neg.node('SE').text)).toBe(R`符號延伸 $B_x \to B_\mathrm{acc}$ bits`)
    expect(() => neg.edge('X', 'SE')).not.toThrow() // 先延伸……
    expect(() => neg.edge('SE', 'XOR')).not.toThrow() // ……再取負
    expect(oneLine(neg.node('CTL').text)).toBe(R`$\mathrm{neg} = \mathrm{NOT}\,b$ $b = 1$ 時 $\mathrm{neg} = 0$ $b = 0$ 時 $\mathrm{neg} = 1$ （$\mathrm{neg} = 1$ 即 $q = -1$）`)
    expect(oneLine(neg.node('XOR').text)).toBe(R`逐位元 XOR $\mathrm{neg} = 0$：$x$ 原樣 $\mathrm{neg} = 1$：反相 $\overline{x} = -x - 1$`)
    expect(oneLine(neg.edge('CTL', 'ADD').text)).toBe(R`＋ carry-in $c_\mathrm{in} = \mathrm{neg}$`)
    expect(neg.edge('ADD', 'REG').text).toBe(R`$S + q\,x_\mathrm{int}$`)
    expect(oneLine(neg.node('SH').text)).toContain(R`$\ell = \log_2 N - F_G$`)
    // 圖上的做法（neg = NOT b；~x = −x − 1；carry-in = neg）對 6-bit 的每個 code 都等於 S + q·x，也等於 gmac.ts 的 xorCarryAccumulate
    for (let x = -32; x <= 31; x++) {
      for (const b of [0, 1] as Bit[]) {
        const negBit = b === 1 ? 0 : 1
        const xorOut = negBit === 1 ? -x - 1 : x
        const q = 2 * b - 1
        expect(100 + xorOut + negBit).toBe(100 + q * x)
        expect(xorCarryAccumulate(100, x, b, 18, 'wrap')).toBe(100 + q * x)
      }
    }
  })

  it('NOISE_FEEDBACK / GMAC_MEAN_MODEL：訊號沿迴路的順序，兩個乘法點各乘 x[n] 與 x_ref[n]', async () => {
    const f = await flow(NOISE_FEEDBACK)
    const chain: [string, string][] = [['SUB', 'MUL'], ['XC', 'MUL'], ['MUL', 'HPD'], ['HPD', 'ADDN'], ['VN', 'ADDN'], ['BOFF', 'ADDN'], ['ADDN', 'SGN'], ['SGN', 'CORR'], ['XREF', 'CORR'], ['CORR', 'AVGB'], ['AVGB', 'MUN'], ['MUN', 'INTG'], ['INTG', 'SUB']]
    for (const [a, b] of chain) expect(() => f.edge(a, b)).not.toThrow()
    expect(f.edges.length).toBe(chain.length + 1) // + 「a → 加法點」
    expect(f.edge('MUL', 'HPD').text).toBe(R`$\delta_k\,x[n]$（fs）`)
    expect(f.edge('HPD', 'ADDN').text).toBe(R`＋ $\delta_k\,u[n]$`)
    expect(f.edge('ADDN', 'SGN').text).toBe(R`$e[n]$`)
    expect(f.edge('AVGB', 'MUN').text).toBe(R`$G_k$`)
    // e[n] = H_PD{δx}[n] + b_off + v[n]（本章的式子）：加法點的三個輸入就是這三項，INL 不在這條式子裡（它在 DTC 方塊內，Ch11）
    expect(f.into('ADDN').map((e) => e.start).sort()).toEqual(['BOFF', 'HPD', 'VN'])
    expect(oneLine(f.node('BOFF').text)).toBe(R`comparator offset $b_\mathrm{off}$`)
    expect(oneLine(f.node('VN').text)).toBe(R`雜訊 $v[n]$`)
    // 全站約定（§2a 第 5 點）：DTC 的殘餘誤差從 PD 的 reference 輸入端進來，H_PD 是它到 PD 輸出的轉移函數；進加法點是正號
    expect(oneLine(f.node('HPD').text)).toBe(R`$H_\mathrm{PD}(z)$：PLL 誤差路徑 PD 的 reference 輸入 到 PD 輸出`)
    expect(f.edge('HPD', 'ADDN').text).toMatch(/^＋ /)
    expect(f.edge('SGN', 'CORR').text).toBe(R`$q[n]$`)
    expect(oneLine(f.node('INTG').text)).toBe(R`$1/(z-1)$ gain accumulator $w_{k+1} = w_k + \mu\,G_k$`)
    expect(oneLine(f.edge('INTG', 'SUB').text)).toBe(R`$-w_k$ 再晚 $d$ 個 block 生效`)
    expect(f.node('MUL').type).toBe('circle')
    expect(f.node('CORR').type).toBe('circle')
    expect(f.node('MUL').text).toBe(R`$\times$`)
    expect(f.node('CORR').text).toBe(R`$\times$`)

    const g = await flow(GMAC_MEAN_MODEL)
    expect(g.subGraphs.map((s) => s.title)).toEqual(['實際訊號（sample rate）', '平均後的等效（小訊號）'])
    for (const [a, b] of [['D1', 'M1'], ['M1', 'S1'], ['V1', 'S1'], ['S1', 'SG'], ['SG', 'M2'], ['M2', 'AV'], ['AV', 'G1'], ['D2', 'KQ'], ['KQ', 'CC'], ['CC', 'G2'], ['REAL', 'MEAN']]) expect(() => g.edge(a, b)).not.toThrow()
    expect(oneLine(g.node('KQ').text)).toContain(R`$\times K_q = \sqrt{2/\pi}/\sigma_v$`)
    expect(oneLine(g.node('CC').text)).toContain(R`$\times C = E[x_\mathrm{ref}\,u]$`)
    expect(oneLine(g.node('G2').text)).toBe(R`$E[G_k] \approx K_q C\,\delta_k$ $= K\,\delta_k$`)
    // 圖上的 K = K_q·C 與 g = μ·K：和 sumAverageTable（lesson 4 的表、T13）相同
    const row = sumAverageTable({ mu: 10, sigmaV: 100, C: 1, Ex2: 1, Ns: [4096] })[0]
    const Kq = Math.sqrt(2 / Math.PI) / 100
    expect(row.gAvg).toBeCloseTo(10 * Kq * 1, 14)
  })

  it('AVERAGE_LOOP：圖上的方塊串起來就是 z^(d+1) − z^d + g = 0（F-04.14），d = 0 時 pole = 1 − g', async () => {
    const f = await flow(AVERAGE_LOOP)
    const order = ['SUB', 'K', 'MU', 'DLY', 'INT', 'SUB']
    for (let i = 0; i + 1 < order.length; i++) expect(() => f.edge(order[i], order[i + 1])).not.toThrow()
    expect(oneLine(f.node('DLY').text)).toBe(R`$z^{-d}$ 更新延遲 $d$ 個 block`)
    expect(oneLine(f.node('INT').text)).toBe(R`$1/(z-1)$ gain accumulator`)
    expect(f.node('DLY').classes).toEqual(['focus'])
    expect(f.edge('K', 'MU').text).toBe(R`$E[G_k] \approx K\,\delta_k$`)
    // 迴路增益 L(z) = g·z^(−d)/(z−1)；1 + L(z) = 0 兩邊乘 z^d·(z−1) ⇒ 與 latency.ts 的特徵多項式逐點相同
    const polyval = (p: number[], z: number) => p.reduce((acc, c) => acc * z + c, 0)
    for (const g of [0.1, 0.7, 1.3]) {
      for (const d of [0, 1, 2, 5]) {
        for (const z of [-1.7, -0.4, 0.3, 0.95, 1.6]) {
          const fromDiagram = z ** d * (z - 1) * (1 + (g * z ** -d) / (z - 1))
          expect(fromDiagram).toBeCloseTo(polyval(delayCharPoly(g, d), z), 9)
        }
      }
      expect(polyval(delayCharPoly(g, 0), 1 - g)).toBeCloseTo(0, 12) // d = 0：pole p = 1 − g
    }
  })

  it('APPLY_MODES：三種做法的延遲與臨界增益和 latency.ts 相同', async () => {
    const f = await flow(APPLY_MODES)
    expect(oneLine(f.node('A2').text)).toBe(R`整數延遲 $d = \lceil P_c / N \rceil = 1$ $\delta_{k+1} = \delta_k - g\,\delta_{k-1}$ $g_\mathrm{crit} = 2\sin(\pi/6) = 1$`)
    expect(oneLine(f.node('B2').text)).toBe(R`分數延遲 $d_f = P_c / N$ $G_{k+1} \approx K\,[d_f\,\delta_k +$ $(1 - d_f)\,\delta_{k+1}]$ $g_\mathrm{crit}$ 見 F-04.17`)
    expect(oneLine(f.node('C2').text)).toBe(R`延遲 $d = 0$ $\delta_{k+1} = (1 - g)\,\delta_k$ $g_\mathrm{crit} = 2$ 雜訊 $\times \sqrt{N/(N - P_c)}$`)
    expect(f.node('A1').classes).toEqual(['focus'])
    expect(f.node('B1').classes).toEqual(['warn'])
    const base = { fsGHz: 4, N: 4096, D: 0, Pc: 8, dCfg: 0 }
    const a = latencyCalc({ ...base, apply: 'boundary' })
    expect([a.dEff, a.dFrac]).toEqual([1, 0])
    expect(a.gCrit).toBeCloseTo(1, 12)
    expect(2 * Math.sin(Math.PI / 6)).toBeCloseTo(criticalGain(1), 12)
    const b = latencyCalc({ ...base, apply: 'immediate' })
    expect([b.dEff, b.dFrac]).toEqual([0, 8 / 4096])
    expect(criticalGainInfo(0, b.dFrac).method).toBe('jury') // F-04.17
    expect(criticalGain(0)).toBe(2) // 做法 C：d = 0
  })

  it('SUM_VS_AVERAGE / BIT_MAPPING：圖上的關係式用手算例子（N = 4）與 gmac.ts 驗算', async () => {
    const f = await flow(SUM_VS_AVERAGE)
    expect(oneLine(f.node('RA').text)).toBe(R`average $g = \mu K$ 穩定：$\mu \in (0, 2/K)$`)
    expect(oneLine(f.node('RS').text)).toBe(R`sum $g = N \mu K$ 穩定：$\mu \in (0, 2/(N K))$`)
    expect(f.edge('SH', 'MA').text).toBe(R`$G_k = S_k / N$`)
    expect(f.edge('MS', 'RS').text).toBe(R`$\Delta w = \mu\,S_k = N \mu\,G_k$`)
    expect(f.edge('MC', 'RC').text).toBe(R`$\Delta w = (\mu/N)\,S_k = \mu\,G_k$`)
    expect(f.node('RS').classes).toEqual(['warn'])
    expect(f.node('RA').classes).toEqual(['ok'])
    const h = handGmac()
    const { w, mu, x } = HAND_GMAC
    const N = x.length
    expect(h.wAvg - w).toBe(mu * h.G) // Δw = μ·G_k
    expect(h.wSum - w).toBe(N * mu * h.G) // Δw = μ·S_k = N·μ·G_k
    expect(blockUpdate(w, h.q, x, mu / N, 'sum')).toBe(h.wAvg) // × μ/N：和 average 逐位元相同
    const t13 = sumAverageTable({ mu: 10, sigmaV: 100, C: 1, Ex2: 1, Ns: [4096] })[0]
    expect(t13.gSum).toBeCloseTo(4096 * t13.gAvg, 9)
    expect(t13.gSum).toBeCloseTo(326.8, 1) // 規格 T13 的反面測試

    const m = await flow(BIT_MAPPING)
    // comparator 的輸入是 PD 的輸出 e[n]（全站約定：LMS 校正迴路的輸入在 PD 的輸出）
    expect(oneLine(m.node('E').text)).toBe(R`PD 輸出 $e[n]$`)
    expect(m.into('CMP').map((e) => e.start)).toEqual(['E'])
    expect(oneLine(m.node('MAP').text)).toBe(R`映射 $q = 2b - 1$ $0 \to -1$，$1 \to +1$`)
    expect(oneLine(m.node('R2').text)).toContain(R`$G_\mathrm{bug} = \tfrac12 G + \tfrac12 \bar x_\mathrm{ref}$`)
    expect(oneLine(m.node('R3').text)).toBe(R`固定點 $w^* \approx$ $a + E[x_\mathrm{ref}] / (K_q C)$`)
    expect(oneLine(m.node('R1').text)).toBe(R`$E[G] \approx K\,\delta$ 固定點 $w^* = a$`)
    expect(m.edge('CMP', 'MAP').text).toBe(R`$b[n] \in \{0, 1\}$`)
    expect(m.edge('MAP', 'G1').text).toBe(R`$q[n] \in \{-1, +1\}$`)
    expect(h.Gbug).toBe(0.5 * h.G + 0.5 * h.xbar) // G_bug = ½·G + ½·x̄_ref（恆等式）
    for (const b of [0, 1]) expect([-1, 1]).toContain(2 * b - 1)
  })

  it('ACCUMULATOR_SIZING：圖上的數字（31、126976、18 bits、−4096、65535）全部由 gmac.ts 算出', async () => {
    const f = await flow(ACCUMULATOR_SIZING)
    const sizing = accumulatorSizing(6, 4096, 'symmetric')
    expect(oneLine(f.node('A').text)).toContain(R`$M_x = ${sizing.maxAbsProduct}$`)
    expect(oneLine(f.node('B').text)).toContain(R`$|S_k| \le N M_x$ $= 4096 \times ${sizing.maxAbsProduct} = ${sizing.maxPosSum}$`)
    expect(oneLine(f.node('C').text)).toContain(R`$\lceil \log_2 (N M_x + 1) \rceil$ $= ${sizing.bitsExact}$ bits`)
    expect(oneLine(f.node('C').text)).toContain(R`$B_\mathrm{acc} = 1 +$`)
    expect(sizing.bitsExact).toBe(1 + Math.ceil(Math.log2(sizing.maxPosSum + 1)))
    expect(2 ** (sizing.bitsExact - 1) - 1).toBeGreaterThanOrEqual(sizing.maxPosSum)
    expect(2 ** (17 - 1) - 1).toBeLessThan(sizing.maxPosSum) // 17 bits 不夠
    expect(oneLine(f.node('D').text)).toContain(R`$2^{16} - 1$ $= ${2 ** 16 - 1}$`)
    const wrapped = wrapTwos(sizing.maxPosSum, 17)
    expect(wrapped).toBe(sizing.maxPosSum - 2 ** 17)
    expect(oneLine(f.node('E').text)).toContain(R`$${sizing.maxPosSum} - 2^{17} = -${Math.abs(wrapped)}$`)
    expect(wrapped).toBeLessThan(0) // 變號
    expect(oneLine(f.node('F').text)).toContain(R`$+${saturateTwos(sizing.maxPosSum, 17)}$`)
    expect(f.edge('D', 'E').text).toBe('wrap')
    expect(f.edge('D', 'F').text).toBe('saturate')
  })

  it('ROUNDING_MODES：例子 S = −300、ℓ = 8 的 j、ρ、四種結果與平均誤差全部由 gmac.ts 算出（F-04.10）', async () => {
    const f = await flow(ROUNDING_MODES)
    const S = -300
    const ell = 8
    const j = Math.floor(S / 2 ** ell)
    const rho = S - 2 ** ell * j // 被丟掉的低 ℓ bits
    expect([j, rho]).toEqual([-2, 212])
    expect(oneLine(f.node('S').text)).toContain(R`$S = -300$，$\ell = 8$`)
    expect(oneLine(f.node('S').text)).toContain(R`$S / 2^\ell = ${(S / 2 ** ell).toFixed(2)}$`)
    expect(oneLine(f.node('SPLIT').text)).toContain(R`$S = 2^\ell\,j + \rho$`)
    expect(oneLine(f.node('SPLIT').text)).toContain(R`$j = -2$，$\rho = ${rho}$`)
    // 四種做法的例子結果：和 shiftRound 相同
    const shown = (mode: Parameters<typeof shiftRound>[2]) => String(shiftRound(S, ell, mode))
    expect(oneLine(f.node('FL').text)).toContain(R`例：$${shown('floor')}$`)
    expect(oneLine(f.node('HU').text)).toContain(R`$${rho} \ge ${2 ** (ell - 1)}$，得 $${shown('half_up')}$`)
    expect(oneLine(f.node('HE').text)).toContain(R`例：$${shown('half_even')}$`)
    expect(oneLine(f.node('TZ').text)).toContain(R`例：$${shown('toward_zero')}$`)
    for (const id of ['FL', 'HU', 'HE', 'TZ']) expect(() => f.edge('SPLIT', id), id).not.toThrow()
    for (const [a, b] of [['FL', 'EF'], ['HU', 'EH'], ['HE', 'EE'], ['TZ', 'ET']]) expect(() => f.edge(a, b), `${a} → ${b}`).not.toThrow()
    // 平均誤差：圖上的封閉式 = gmac.ts 的 roundingMeanError，也等於「對一整圈餘數 ρ = 0 … 2^ℓ − 1 平均」的數值結果
    expect(oneLine(f.node('EF').text)).toContain(R`$-(1 - 2^{-\ell}) / 2$`)
    expect(oneLine(f.node('EH').text)).toContain(R`$\bar\varepsilon = 2^{-\ell-1}$`)
    expect(oneLine(f.node('EE').text)).toBe(R`$\bar\varepsilon = 0$`)
    expect(roundingMeanError(ell, 'floor')).toBeCloseTo(-(1 - 2 ** -ell) / 2, 15)
    expect(roundingMeanError(ell, 'half_up')).toBeCloseTo(2 ** (-ell - 1), 15)
    expect(roundingMeanError(ell, 'half_even')).toBe(0)
    // 平均兩圈（j 為偶數、奇數各一圈）：half-even 在恰好一半時偶數、奇數的 j 各進位一次，兩圈才抵消
    const mean = (mode: Parameters<typeof shiftRound>[2], base: number, l: number) => {
      let acc = 0
      for (let r = 0; r < 2 ** (l + 1); r++) acc += shiftRound(base + r, l, mode) - (base + r) / 2 ** l
      return acc / 2 ** (l + 1)
    }
    for (const l of [1, 3, 5]) {
      for (const mode of ['floor', 'half_up', 'half_even'] as const) expect(mean(mode, 8 * 2 ** l, l), `${mode} ℓ=${l}`).toBeCloseTo(roundingMeanError(l, mode), 12)
      // toward-0：S 為正像 floor；S 為負（餘數在 −2^ℓ … −1 之間均勻）正負號相反
      expect(mean('toward_zero', 8 * 2 ** l, l)).toBeCloseTo(roundingMeanError(l, 'toward_zero', 1), 12)
      expect(mean('toward_zero', -8 * 2 ** l, l)).toBeCloseTo(roundingMeanError(l, 'toward_zero', -1), 12)
    }
    expect(f.node('FL').classes).toEqual(['warn'])
    expect(f.node('EF').classes).toEqual(['warn'])
    expect(f.node('HE').classes).toEqual(['ok'])
    expect(f.node('EE').classes).toEqual(['ok'])
  })

  it('SHIFT_BITS：B_acc = B_x + log₂N，丟掉 ℓ = log₂N − F_G bits、留下 B_x + F_G bits，Δ_G = 2^(−F_G)/2^(B_x−1)（例：6、1024、4 → 16、6、10、1/512）', async () => {
    const f = await flow(SHIFT_BITS)
    const bx = 6
    const log2N = 10
    const FG = 4
    const sizing = accumulatorSizing(bx, 2 ** log2N, 'symmetric')
    const ell = log2N - FG
    const d = defaultBiasNumbers(FG)
    expect([d.bx, d.ell]).toEqual([bx, ell])
    expect(sizing.bitsExact).toBe(bx + log2N) // 對稱 code、N = 2^m：B_acc = B_x + m
    expect(oneLine(f.node('S').text)).toContain(R`例：$${bx} + ${log2N} = ${sizing.bitsExact}$ bits`)
    expect(oneLine(f.node('HI').text)).toContain(`例：${sizing.bitsExact - ell} bits`)
    expect(oneLine(f.node('HI').text)).toContain(R`$B_\mathrm{acc} - \ell$ $= B_x + F_G$ bits`)
    expect(sizing.bitsExact - ell).toBe(bx + FG) // 留下 B_acc − ℓ = B_x + F_G bits
    expect(oneLine(f.node('LO').text)).toContain(R`例：$\ell = ${ell}$`)
    expect(oneLine(f.node('DG').text)).toContain(R`例：$1/${2 ** (FG + bx - 1)}$`)
    expect(oneLine(f.node('DG').text)).toContain(R`$\Delta_G = 2^{-F_G}$ $\div 2^{B_x-1}$`)
    expect(d.deltaG).toBe(1 / 2 ** (FG + bx - 1)) // Δ_G = 2^(−F_G) / 2^(B_x−1)
    // 圖上的切法：S = 2^ℓ·j + ρ，高位元 j 留下、低位元 ρ 丟掉（和 ROUNDING_MODES 同一個記號）；S = −300、ℓ = 8 時 j = −2、ρ = 212
    for (const [a, b] of [['S', 'HI'], ['S', 'LO'], ['LO', 'RND'], ['HI', 'Q'], ['RND', 'Q'], ['Q', 'DG']]) expect(() => f.edge(a, b), `${a} → ${b}`).not.toThrow()
    expect(f.edge('RND', 'Q').text).toBe('進位 0 或 1')
    expect(f.node('LO').classes).toEqual(['warn'])
    expect(f.node('HI').classes).toEqual(['ok'])
    expect(shiftRound(-300, 8, 'floor')).toBe(Math.floor(-300 / 2 ** 8))
  })

  it('NEGATE_BUG：6-bit 的 −32 取負，先延伸得 +32、原寬度內取負 wrap 成 −32，差 64 LSB = 正規化 −2；固定點 −p_min/K（F-04.15）', async () => {
    const f = await flow(NEGATE_BUG)
    const x = -32
    const good = negateExtended(x, 0)
    const bad = negateInplace(x, 0, 6)
    expect([good, bad]).toEqual([32, -32])
    expect(oneLine(f.node('X').text)).toContain(R`6-bit 的 $-32$`)
    expect(oneLine(f.node('X').text)).toContain(R`$p_\mathrm{min} = 1/64$`)
    expect(oneLine(f.node('X').text)).toContain(R`$x_\mathrm{int} = -2^{B_x-1}$`)
    expect(oneLine(f.node('Q').text)).toContain(R`$-x_\mathrm{int} = +${good}$`)
    expect(oneLine(f.node('OK').text)).toContain(R`$+${good}$ 放得下`)
    expect(oneLine(f.node('BUG').text)).toContain(R`$+${good}$ 超出 6-bit 範圍`)
    expect(oneLine(f.node('BUG').text)).toContain(R`wrap 回 $-${Math.abs(bad)}$`)
    expect(oneLine(f.node('OKR').text)).toContain(R`$+${good}$`)
    expect(oneLine(f.node('ERR').text)).toContain(R`加進累加器的是 $-${Math.abs(bad)}$`)
    expect(oneLine(f.node('ERR').text)).toContain(R`每次差 $-${good - bad}$ LSB`)
    expect((good - bad) / 2 ** (6 - 1)).toBe(2) // 除以 full scale 2^(B_x−1) = 32：正規化差 2（方向為負）
    expect(oneLine(f.node('ERR').text)).toContain(R`正規化 $-2$`)
    expect(oneLine(f.node('INJ').text)).toContain(R`$-2\,p_\mathrm{min}\,\Phi(\delta/\sigma_v)$`)
    expect(oneLine(f.node('INJ').text)).toContain(`注入截斷點 ${TP1} 的加法點`)
    expect(oneLine(f.node('FIX').text)).toContain(R`$K\,\delta^* + \bar\varepsilon\,\Delta_G$ $- 2\,p_\mathrm{min}\,\Phi(\delta^*/\sigma_v) = 0$ $w^* - a \approx -p_\mathrm{min} / K$`)
    for (const [a, b] of [['X', 'Q'], ['Q', 'OK'], ['Q', 'BUG'], ['OK', 'OKR'], ['BUG', 'ERR'], ['ERR', 'INJ'], ['INJ', 'FIX']]) expect(() => f.edge(a, b), `${a} → ${b}`).not.toThrow()
    expect(f.node('OK').classes).toEqual(['ok'])
    expect(f.node('BUG').classes).toEqual(['warn'])
    // 圖上的固定點和 negateBugNumbers（F-04.15 的數值解）一致：近似 −p_min/K，Φ ≈ 1/2、ε̄ = 0 時 w* − a = −p_min/K
    const nb = negateBugNumbers()
    expect(nb.pMin).toBe(1 / 64)
    expect(-nb.approx).toBeCloseTo(-nb.pMin / nb.K, 12)
    expect(-nb.deltaStar).toBeLessThan(0) // w 停在 a 的下方
    expect(Math.abs(-nb.deltaStar - -nb.approx) / nb.approx).toBeLessThan(0.05)
  })

  it('FIXED_DATAPATH / BIAS_LOOP：兩個截斷點的位置（① 在 ×μ 之前、② 在 ×μ 之後）重現 F-04.11、F-04.18 與模型的偏差預測', async () => {
    const dp = await flow(FIXED_DATAPATH)
    expect(dp.subGraphs.map((s) => s.title)).toEqual(['GMAC：一個 block 的平均', '更新 gain accumulator'])
    for (const [a, b] of [['P', 'ACC'], ['ACC', 'SH'], ['GM', 'UP'], ['MU', 'QW'], ['QW', 'ADD'], ['W', 'ADD'], ['ADD', 'SAT'], ['SAT', 'W'], ['W', 'DTC']]) expect(() => dp.edge(a, b)).not.toThrow()
    expect(dp.node('SH').classes).toEqual(['warn'])
    expect(dp.node('QW').classes).toEqual(['warn'])
    expect(oneLine(dp.node('SH').text)).toContain(`截斷點 ${TP1}：右移 ${R`$\ell = \log_2 N - F_G$`} bits`)
    expect(oneLine(dp.node('QW').text)).toContain(`截斷點 ${TP2}：對齊 ${R`$W$ 的 LSB $\Delta_W$`}`)
    for (const [id, sec] of [['P', '5.4'], ['ACC', '5.1'], ['SH', '5.2'], ['SH', '5.3'], ['QW', '5.6'], ['SAT', '5.5']]) expect(oneLine(dp.node(id).text), id).toContain(`$\\S ${sec}$`)

    const f = await flow(BIAS_LOOP)
    // 順向路徑：SUB → ×K → (＋①) → ×μ → (＋②) → 1/(z−1) → 回授
    for (const [a, b] of [['SUB', 'K'], ['K', 'S1'], ['E1', 'S1'], ['S1', 'MU'], ['MU', 'S2'], ['E2', 'S2'], ['S2', 'INT'], ['INT', 'SUB']]) expect(() => f.edge(a, b)).not.toThrow()
    expect(oneLine(f.node('E1').text)).toBe(`截斷點 ${TP1} ${R`$\div N$ 的右移 平均誤差 $\bar\varepsilon\,\Delta_G$`}`)
    expect(oneLine(f.node('E2').text)).toBe(`截斷點 ${TP2} ${R`對齊 $\Delta_W$ 平均誤差 $\bar\varepsilon_W\,\Delta_W$`}`)
    expect(oneLine(f.edge('S2', 'INT').text)).toBe(R`$E[\Delta W]$ 固定點時為 0`)
    // 照圖求固定點：μ·(K·δ* + ε̄·Δ_G) + ε̄_W·Δ_W = 0（各項的數字獨立由 gmac.ts 取得）
    const d = defaultBiasNumbers(4) // F_G = 4：ℓ = 6
    const wt = wTruncNumbers() // ℓ_W = 3：Δ_W = 8·μ·Δ_G
    const inj1 = roundingMeanError(d.ell, 'floor') * d.deltaG
    const inj2 = incrementMeanError(wt.R, 'floor') * wt.wLsb
    const solve = (i1: number, i2: number) => -(d.mu * i1 + i2) / (d.mu * d.K) // δ*
    expect(-solve(inj1, 0)).toBeCloseTo(-d.deltaStar, 12) // 只有 ①：w* − a = ε̄·Δ_G/K（F-04.11），與 μ 無關
    expect(-solve(0, inj2)).toBeCloseTo(wt.bias, 12) // 只有 ②：w* − a = ε̄_W·Δ_W/g（F-04.18）
    expect(-solve(0, inj2)).toBeCloseTo((incrementMeanError(wt.R, 'floor') * wt.wLsb) / d.g, 12)
    // 兩個都有：與綜合手算 HC-04.8（datapath 的 analytic.biasPred）相同
    const hc = HANDCALCS.find((h) => h.id === 'HC-04.8')!
    const defaults = Object.fromEntries(hc.inputs.map((i) => [i.key, i.default]))
    const total = hc.solve(defaults).results.find((r) => r.symbol === 'w^*-a')!.value as number
    expect(-solve(inj1, inj2)).toBeCloseTo(total, 9)
    // ① 與 μ 無關、② 隨 1/μ 變大（思考題 6）
    const solveMu = (mu: number, i1: number, i2: number) => -(mu * i1 + i2) / (mu * d.K)
    expect(solveMu(d.mu / 2, inj1, 0)).toBeCloseTo(solveMu(d.mu, inj1, 0), 12)
    expect(solveMu(d.mu / 2, 0, inj2)).toBeCloseTo(2 * solveMu(d.mu, 0, inj2), 12)
  })

  it('ANTI_WINDUP：三條路徑與輸出 clamp 的畫法', async () => {
    const f = await flow(ANTI_WINDUP)
    expect(f.node('MODE').type).toBe('diamond')
    expect(f.into('MODE').map((e) => e.start)).toEqual(['ADD'])
    expect([f.edge('MODE', 'AW').text, f.edge('MODE', 'WU').text, f.edge('MODE', 'WR').text]).toEqual(['anti-windup', '只 clamp 輸出', 'wrap'])
    for (const id of ['AW', 'WU', 'WR']) expect(f.edge(id, 'W').text).toBe(R`$W_{k+1}$`)
    expect(f.edge('W', 'ADD').text).toBe(R`＋ $W_k$`) // 積分器：W_{k+1} = W_k + ΔW
    expect(f.edge('ADD', 'MODE').text).toBe(R`$W_k + \Delta W$`)
    expect(oneLine(f.node('CL').text)).toBe(R`輸出 clamp $w_\mathrm{applied} = \min(w_\mathrm{max},$ $\max(w_\mathrm{min}, W_k))$`)
    expect(() => f.edge('W', 'CL')).not.toThrow()
    expect(() => f.edge('CL', 'DTC')).not.toThrow()
    expect(f.node('AW').classes).toEqual(['ok'])
    expect(oneLine(f.node('AW').text)).toContain(R`$T_\mathrm{unwind} = 0$`)
  })

  it('CLEAR_BUG：多串一個 1/(1 − z⁻¹) 就是 z² − (2 − g)z + 1 = 0（F-04.13），和 clearVsNoClear 的遞迴相同', async () => {
    const f = await flow(CLEAR_BUG)
    expect(f.subGraphs.map((s) => s.title)).toEqual(['正確：每個 block 清除累加器', '忘了清除：多一個積分器'])
    for (const [a, b] of [['D1', 'K1'], ['K1', 'MU1'], ['MU1', 'I1'], ['I1', 'W1'], ['D2', 'K2'], ['K2', 'I0'], ['I0', 'MU2'], ['MU2', 'I2'], ['I2', 'W2'], ['GOOD', 'BAD']]) expect(() => f.edge(a, b)).not.toThrow()
    expect(oneLine(f.node('I0').text)).toBe(R`$1/(1 - z^{-1})$ 沒清除的 $S$ $S_0 + S_1 + \dots + S_k$`)
    expect(oneLine(f.node('W1').text)).toBe(R`$w_k$ $\delta_{k+1} = (1 - g)\,\delta_k$`)
    expect(oneLine(f.node('W2').text)).toBe(R`$w_k$ $\delta_{k+1} - (2 - g)\,\delta_k +$ $\delta_{k-1} = 0$`)
    expect(f.edge('GOOD', 'BAD')).toMatchObject({ text: '少了 clear', stroke: 'dotted' })
    for (const g of [0.2, 1, 3.5]) {
      for (const z of [-1.3, 0.4, 0.9, 2.1]) {
        // 1 + g·[1/(1 − z⁻¹)]·[1/(z − 1)] = 0，兩邊乘 z·(1 − z⁻¹)·(z − 1)
        const fromDiagram = z * (1 - 1 / z) * (z - 1) * (1 + g / ((1 - 1 / z) * (z - 1)))
        expect(fromDiagram).toBeCloseTo(z * z - (2 - g) * z + 1, 9)
        // 正確的一欄：1 + g/(z − 1) = 0 ⇒ z = 1 − g
        expect((z - 1) * (1 + g / (z - 1))).toBeCloseTo(z - (1 - g), 12)
      }
      const r = clearVsNoClear(g, 30)
      for (let k = 1; k < 29; k++) expect(r.noClear[k + 1] - (2 - g) * r.noClear[k] + r.noClear[k - 1]).toBeCloseTo(0, 6)
      expect(r.clear[1]).toBeCloseTo(1 - g, 12)
    }
  })

  it('HANDCALC_FLOW：圖上每一格的式子，代入預設值都等於綜合手算 HC-04.8 的結果', async () => {
    const f = await flow(HANDCALC_FLOW)
    expect(oneLine(f.node('IN').text)).toBe(R`七個輸入 $\sigma_v$、$\mu$、$B_x$、$\log_2 N$ $F_G$、$\ell_W$、$d$`)
    expect(oneLine(f.node('T').text)).toBe(`$w^* - a =$ 偏差 ${TP1} $+$ 偏差 ${TP2}`)
    expect(oneLine(f.node('KQ').text)).toBe(R`$K_q = \sqrt{2/\pi}/\sigma_v$`)
    expect(oneLine(f.node('EX').text)).toBe(R`$M_x = 2^{B_x-1} - 1$ $E[x^2] = M_x (M_x + 1)$ $\div (3 \cdot 4^{B_x-1})$`)
    expect(oneLine(f.node('GC').text)).toBe(R`穩定檢查：$g$ 小於 $g_\mathrm{crit} = 2\sin(\pi/(4d + 2))$`)
    expect(oneLine(f.node('B1').text)).toContain(R`$\bar\varepsilon = -(1 - 2^{-\ell}) / 2$`)
    expect(oneLine(f.node('B2').text)).toContain(R`$\bar\varepsilon_W = -(1 - 1/R) / 2$`)
    expect(f.into('T').map((e) => e.start).sort()).toEqual(['B1', 'B2'])
    expect(f.into('B1').map((e) => e.start).sort()).toEqual(['K', 'L']) // 偏差 ① 除以 K
    expect(f.into('B2').map((e) => e.start).sort()).toEqual(['DW', 'G']) // 偏差 ② 除以 g
    expect(f.into('K').map((e) => e.start).sort()).toEqual(['EX', 'KQ'])
    // 其餘輸入用虛線接到用到它們的方塊：μ → g；d → 穩定檢查；μ、ℓ_W → Δ_W
    expect(f.edge('IN', 'G')).toMatchObject({ text: R`$\mu$`, stroke: 'dotted' })
    expect(f.edge('IN', 'GC')).toMatchObject({ text: R`$d$`, stroke: 'dotted' })
    expect(f.edge('IN', 'DW')).toMatchObject({ text: R`$\mu$、$\ell_W$`, stroke: 'dotted' })
    const hc = HANDCALCS.find((h) => h.id === 'HC-04.8')!
    expect(hc.inputs.map((i) => i.key)).toHaveLength(7)
    const v = Object.fromEntries(hc.inputs.map((i) => [i.key, i.default])) as Record<string, number>
    const res = Object.fromEntries(hc.solve(v).results.map((r) => [r.symbol, r.value as number]))
    // 照圖由上往下算
    const Kq = Math.sqrt(2 / Math.PI) / v.sigmaV
    const Mx = 2 ** (v.bx - 1) - 1
    const Ex2 = (Mx * (Mx + 1)) / (3 * 4 ** (v.bx - 1))
    const K = Kq * Ex2
    const g = v.mu * K
    const gCrit = 2 * Math.sin(Math.PI / (4 * v.d + 2))
    const Bacc = v.bx + v.m
    const ell = v.m - v.FG
    const deltaG = 2 ** -v.FG / 2 ** (v.bx - 1)
    const bias1 = ((-(1 - 2 ** -ell) / 2) * deltaG) / K
    const R_ = 2 ** v.lW
    const deltaW = R_ * v.mu * deltaG
    const bias2 = ((-(1 - 1 / R_) / 2) * deltaW) / g
    expect(K).toBeCloseTo(res.K, 12)
    expect(g).toBeCloseTo(res.g, 12)
    expect(gCrit).toBeCloseTo(res[String.raw`g_\mathrm{crit}`], 12)
    expect(Bacc).toBe(res[String.raw`B_\mathrm{acc}`])
    expect(bias1).toBeCloseTo(res[String.raw`(w^*-a)_{\div N}`], 10)
    expect(bias2).toBeCloseTo(res['(w^*-a)_W'], 10)
    expect(bias1 + bias2).toBeCloseTo(res['w^*-a'], 10)
    expect(Ex2).toBeCloseTo(defaultBiasNumbers(4).Ex2, 14)
    expect(deltaG).toBe(defaultBiasNumbers(4).deltaG)
  })
})

describe('Ch04 頁面上的方塊圖（整頁渲染）', () => {
  // 斷言失敗時也要還原 mermaid.render 的 spy，免得後面的真實渲染測試拿到假的 SVG
  afterEach(() => vi.restoreAllMocks())

  it('章首有 SystemMap（手排的 SVG，藍色 = 本章的訊號路徑，不經過 mermaid），接著 22 張圖依登錄表的順序出現，每一張都交給 mermaid 畫、圖說說明要看什麼', async () => {
    // 整頁約 10 萬個 DOM 節點，在 jsdom 裡對這麼大的文件做真正的 mermaid 排版要一分多鐘；
    // 每一張圖的實際渲染已經在上面逐張測過，這裡只確認「頁面送給 mermaid 的原始碼就是登錄表裡的那 22 張」（系統地圖不在其中）。
    const renderSpy = vi.spyOn(mermaid, 'render').mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' }))
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/04']}>
          <Chapter04 />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const total = CH04_DIAGRAMS.length + 1 // 22 張編號的圖 + 章首的系統地圖
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(total)
    await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg > svg').length).toBe(total), { timeout: 120_000 })
    expect(container.textContent).not.toContain('Mermaid 圖解析失敗')

    // 1) 系統地圖：在「這一課要回答的問題」裡、§1 之前；藍色（is-focus）的方塊就是 CH04_SYSTEM_FOCUS
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    const maps = container.querySelectorAll('figure.c-sysmap')
    expect(maps).toHaveLength(1)
    const map = maps[0]
    expect(figures[0]).toBe(map) // 頁面上的第一張圖
    const question = container.querySelector('#ch04-question')!
    const system = container.querySelector('#ch04-system')!
    expect(question.contains(map)).toBe(true)
    expect(map.compareDocumentPosition(system) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(map.getAttribute('aria-label')).toContain('DTC-based Fractional-N PLL 與 Sign-LMS 校正迴路的系統方塊圖')
    // （aria-label 是純文字：方塊名稱裡的 `$...$` 已拿掉分隔符號）
    for (const b of CH04_SYSTEM_FOCUS) expect(map.getAttribute('aria-label'), b).toContain(stripMathDelimiters(SYSTEM_BLOCK_LABEL[b]))
    expect(map.querySelector('figcaption')!.textContent).toMatch(/藍色是這一課從頭走到尾的訊號路徑/)
    // 手排的 SVG：17 個方塊都在，亮藍色（is-focus、data-focus）的剛好是本章的 12 個，其餘 5 個不亮
    const blocks = Array.from(map.querySelectorAll('g.c-sysmap-block'))
    expect(blocks).toHaveLength(Object.keys(SYSTEM_BLOCK_LABEL).length)
    const lit = Array.from(map.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
    expect([...lit].sort()).toEqual([...CH04_SYSTEM_FOCUS].sort())
    expect(map.querySelectorAll('g.c-sysmap-block[data-focus="true"]')).toHaveLength(CH04_SYSTEM_FOCUS.length)
    expect(blocks.filter((g) => !g.classList.contains('is-focus')).map((g) => g.getAttribute('data-block')).sort()).toEqual(['lf', 'noise', 'qnt', 'ref', 'vco'])
    // 方塊與連線上的字是 KaTeX／HTML：公式由 KaTeX 排版、沒有殘留的 `$`
    const mapSvg = map.querySelector('svg.c-sysmap-svg')!
    expect(mapSvg.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(8)
    expect(mapSvg.textContent).not.toContain('$')
    // 系統地圖前面有一句話說明藍色方塊是什麼、這一課新增什麼
    const lead = map.previousElementSibling!
    expect(lead.tagName).toBe('P')
    expect(lead.textContent).toMatch(/藍色方塊/)
    expect(lead.textContent).toMatch(/這一課新增的是/)
    // 架構（全站約定，docs/assumptions.md §2a）：圖說與地圖後面那一段都寫明 DTC 在 reference 輸入端、LMS 的輸入是 PD 的輸出
    expect(CH04_SYSTEM_CAPTION).toContain('reference 輸入端的 DTC → PD')
    expect(CH04_SYSTEM_CAPTION).toContain(R`PD 的輸出 $e[n]$（就是送進 loop filter 的那個節點）`)
    expect(CH04_SYSTEM_CAPTION).not.toContain('沿虛線')
    const afterMap = map.nextElementSibling!
    expect(afterMap.tagName).toBe('P')
    expect(afterMap.textContent).toContain('DTC 在 reference 的輸入端')
    expect(afterMap.textContent).toContain('回授路徑上只有 divider')
    expect(afterMap.textContent).toContain('LMS 校正迴路的輸入是 PD 的輸出')
    // §1 的讀圖說明：comparator 取的是 PD 的輸出，也就是送進 loop filter 的同一個訊號；DTC 在 reference 這一側
    expect(system.textContent).toContain('也就是送進 loop filter 的同一個訊號')
    expect(system.textContent).toContain('DTC 在 reference 這一側')
    // 讀圖說明裡的位置要和圖一致（圖 4-1：數位的小數除頻在左、主 PLL 迴路的框在右；carry 在最左邊、feedback edge 在框裡最右邊，兩條線不交叉；
    // 版面由 CONCEPT_FAST_LOOP 的宣告順序決定，上面的測試已釘住）。圖 4-2 沒有 divider 方塊，所以文字與 PD 方塊都要說明 PD 的另一個輸入
    for (const t of ['左半邊是數位的小數除頻與補償，右邊的框是主 PLL 迴路', '沿最左邊那條長線往下到 divider control', '框裡最右邊那條往上的線', 'PD 的另一個輸入是 divider 的 feedback edge']) expect(system.textContent, t).toContain(t)
    for (const t of ['最左邊那條往上的線', '沿最右邊往下']) expect(system.textContent, t).not.toContain(t)
    expect(system.textContent).toContain('只能延遲、不能提前')
    expect(system.textContent).toContain('原圖的 DTC 接在 divider 的輸出與 PD 之間。本站依全站約定把 DTC 畫在 reference 的輸入端')
    // §2 的物理圖像：feedback edge 早到、reference 端的 DTC 從基準延遲往回扣（補償量）、PD 量 reference edge 減 feedback edge；
    // 舊接法的說法（DTC 把 divider 的 edge 往後延、對回理想時刻）整頁都不能再出現；下面的字串拆開寫，這個測試檔本身才不會含有那些句子
    const residue = container.querySelector('#ch04-residue')!
    for (const t of ['它直接進 PD，不經過 DTC', 'reference 的輸入端', '基準延遲', '補償量', '只能延遲、不能提前', 'DTC 延遲後的 reference edge」減「feedback edge」']) expect(residue.textContent, t).toContain(t)
    for (const t of ['插入' + '延遲', '推回' + '理想時刻', 'DTC ' + '補回', '需' + '插入的延遲']) expect(container.textContent, t).not.toContain(t)
    // 兩條 edge 的時刻（t_ref′、t_fb）寫成三行對齊的式子，正負號就是全站約定：reference edge 提前 w·x、feedback edge 早到 a·x、差是 (a − w)·x。
    // 三行只放式子（說明在前一段文字）：旁邊再加中文註解，手機上這一塊就比欄寬多出兩百多 px、多一條沒有用途的橫向捲軸
    const timing = Array.from(residue.querySelectorAll('annotation')).map((el) => el.textContent ?? '').filter((t) => t.includes('aligned') && t.includes(R`t_\mathrm{id}[n]`))
    expect(timing).toEqual([R`\begin{aligned}t_\mathrm{ref}'[n]&=t_\mathrm{id}[n]-w\,x[n]\\t_\mathrm{fb}[n]&=t_\mathrm{id}[n]-a\,x[n]\\t_\mathrm{ref}'[n]-t_\mathrm{fb}[n]&=(a-w)\,x[n]\end{aligned}`])
    for (const t of ['第一行是 reference edge（被 DTC 提前', '第二行是 feedback edge（早到', '補償不足（', '時 reference edge 還是太晚，誤差為正']) expect(residue.textContent, t).toContain(t)

    // 2) 22 張圖：順序 = 登錄表；每張都有圖號與圖說
    const figs = Array.from(container.querySelectorAll('.ch04-mermaid-fig'))
    expect(figs.map((el) => el.id)).toEqual(CH04_DIAGRAMS.map((_, i) => `ch04-fig-${i + 1}`))
    figs.forEach((el, i) => {
      const cap = el.querySelector('.ch04-mermaid-caption')!
      expect(cap.querySelector('.ch04-fig-no')!.textContent).toBe(`圖 4-${i + 1}`)
      expect((cap.textContent ?? '').length, CH04_DIAGRAMS[i].name).toBeGreaterThan(30)
      expect(cap.textContent, `${CH04_DIAGRAMS[i].name} 的圖說要說明看什麼`).toMatch(/看/)
      expect(el.querySelector('figure.c-mermaid')!.getAttribute('aria-label')!.length).toBeGreaterThan(8)
      expect(el.querySelector('.c-mermaid-svg svg')).not.toBeNull()
    })
    // 送進 mermaid.render 的原始碼就是登錄表裡的字串（依序 22 張；系統地圖是手排的 SVG，不經過 mermaid）
    // （共用 Mermaid 先過 sanitizeMermaidSource：含公式的標籤合併成 KaTeX 的 `$$...$$`）
    expect(renderSpy.mock.calls.map((c) => c[1])).toEqual(CH04_DIAGRAMS.map((d) => d.chart).map(sanitizeMermaidSource))

    // 3) 圖放在推導之前：每張圖後面最近的推導摺疊框或公式都在它之後、且同一個 section 內有「先看」的讀圖說明
    for (const el of figs) {
      const section = el.closest('section.c-section')!
      expect(section.textContent, el.id).toMatch(/先看|怎麼讀這張圖|由上往下讀/)
    }
    // 各段的圖都在該段第一個推導摺疊框之前（§1 沒有推導）
    for (const id of ['ch04-residue', 'ch04-gmac', 'ch04-fixed', 'ch04-notes']) {
      const sec = container.querySelector(`#${id}`)!
      const firstFig = sec.querySelector('.ch04-mermaid-fig')!
      const firstFold = sec.querySelector('details.ch04-fold')!
      expect(firstFig.compareDocumentPosition(firstFold) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
    }
    // 正文引用圖號（FigRef）時，號碼對得上
    const refs = Array.from(container.querySelectorAll('.ch04-figref')).map((r) => r.textContent)
    expect(refs.length).toBeGreaterThanOrEqual(6)
    for (const r of refs) expect(r).toMatch(/^圖 4-(2[0-2]|1[0-9]|[1-9])$/)
    renderSpy.mockRestore()
  }, 240_000)
})

/**
 * 共用的真實渲染檢查（docs/teaching-style.md §8）：登錄表的每一張圖（章首的系統地圖是手排的 SVG，不經過 mermaid）都用 `@/components/mermaidTestUtils`
 * 以與網站相同的前處理真的畫一次——畫出來的文字不能含「Unsupported markdown」、不能殘留 `$`，KaTeX 以外沒有 Unicode 拼的數學，
 * 每個含公式的標籤都排成一個 KaTeX 區塊（mathCount），節點數不超過 14。
 * 放在檔案最後：renderMermaidForTest 會重設 mermaid 設定、installMermaidSvgShim 會換掉量測函式，
 * 所以先記下上面各組測試用的量測函式，這一組結束後還原。
 */
describe('Ch04 方塊圖：共用的真實渲染檢查（renderMermaidForTest）', () => {
  let restore: () => void
  beforeAll(() => {
    const proto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype
    const saved = { getBBox: proto.getBBox, getComputedTextLength: proto.getComputedTextLength }
    installMermaidSvgShim()
    restore = () => Object.assign(proto, saved)
  })
  afterAll(() => restore())

  // 章首的系統地圖是全站共用、手排的 SVG（不經過 mermaid，版面與節點數由 src/components/SystemMap.test.tsx 負責），不在這份清單裡
  const ALL: (readonly [string, string])[] = CH04_DIAGRAMS.map((d) => [d.name, d.chart] as const)

  it('登錄表的 22 張全部都會被檢查', () => {
    expect(ALL).toHaveLength(22)
    expect(new Set(ALL.map(([name]) => name)).size).toBe(22)
  })

  it.each(ALL)('%s：畫得出來，沒有 Unsupported markdown、沒有殘留的 $、KaTeX 以外沒有 Unicode 數學，節點數不超過 14', async (name, chart) => {
    // KaTeX 的警告（文字模式沒有的字元、只能在文字模式用的指令……）不算錯誤，但代表那個字元量不到寬度、字型也可能不對：不容許
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let warnings: string[]
    let rendered: Awaited<ReturnType<typeof renderMermaidForTest>>
    try {
      rendered = await renderMermaidForTest(chart)
    } finally {
      warnings = warn.mock.calls.map((c) => String(c[0]))
      warn.mockRestore()
    }
    expect(warnings.filter((w) => /LaTeX-incompatible|No character metrics|KaTeX/.test(w)), `${name} 的 KaTeX 警告`).toEqual([])
    const { svg, text, plainText, nodeCount, mathCount } = rendered
    expect(svg).toMatch(/^<svg/)
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(text).not.toMatch(/Syntax error/)
    expect(text, '畫出來的文字不可殘留 $').not.toContain('$')
    // 不含公式的標籤（KaTeX 以外的文字）沒有 Unicode 拼的數學；含公式標籤的文字部分在原始碼層級檢查
    expect(unicodeMathIn(plainText), `${name}：畫出來的純文字裡還有 Unicode 數學`).toEqual([])
    expect(unicodeMathInSource(chart), `${name}：原始碼的純文字裡還有 Unicode 數學`).toEqual([])
    // 每個含 `$...$` 的標籤剛好排成一個 KaTeX 區塊
    expect(mathCount, `${name} 的 KaTeX 區塊數`).toBe(mathLabelCount(chart))
    expect(mathCount, `${name} 至少有一個公式`).toBeGreaterThan(0)
    expect(nodeCount, `${name} 的節點數`).toBeLessThanOrEqual(MAX_NODES)
  }, 30_000)

  it('TeX 寫錯會讓圖畫不出來（拿來確認上面的檢查不是空轉）', async () => {
    await expect(renderMermaidForTest(CLEAR_BUG.replace(R`$\delta_k$`, R`$\delta_{k$`))).rejects.toThrow()
  })
})
