import mermaid from 'mermaid'
import { SYSTEM_BLOCK_LABEL, renderTex, systemMapModel } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4, foldedPsdDc, foldedPsdDcLinearProcess, lutClosedForm, segmentClosedForm } from '@/simulation/models/dtcInl'
import * as D from './diagrams'
import { CH11B_DIAGRAMS, NUM, SYSTEM_MAP_FOCUS } from './diagrams'
import { figLabel } from './Fig'

/**
 * Ch11b 的方塊圖測試（docs/teaching-style.md §8）：真正的 mermaid parser + renderer（jsdom）。
 *  1. 每張圖可解析、可畫出、沒有「Unsupported markdown」、節點數 ≤ 14；
 *  2. 圖裡的數學都是 LaTeX：畫出來的文字沒有殘留的 `$`、KaTeX 以外沒有 Unicode 拼的數學、每段 `$…$` 都能被 KaTeX 解析；
 *  3. 連線與正負號照 docs/assumptions.md §2a：REF → DTC → PD，DIV → PD，comparator 的輸入是 PD 的輸出 e[n]；
 *  4. 圖上的數字由 dtcInl.ts 算出（NUM），與模型一致。
 */

vi.setConfig({ testTimeout: 120000 })

interface Vertex {
  id: string
  text?: string
}
interface Edge {
  start: string
  end: string
  text?: string
}
interface FlowDb {
  getVertices: () => Map<string, Vertex>
  getEdges: () => Edge[]
  getSubGraphs: () => { id: string; title: string; nodes: string[] }[]
}

function plain(html: string | undefined): string {
  const div = document.createElement('div')
  div.innerHTML = (html ?? '').replace(/<br\s*\/?>/g, '\n')
  return div.textContent ?? ''
}

async function parseFlow(chart: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDb
  const subgraphs = db.getSubGraphs().map((s) => ({ id: s.id, title: plain(s.title), nodes: s.nodes }))
  const isCluster = new Set(subgraphs.map((s) => s.id))
  const nodes = new Map([...db.getVertices().values()].filter((v) => !isCluster.has(v.id)).map((v) => [v.id, plain(v.text)]))
  const edges = db.getEdges().map((e) => ({ from: e.start, to: e.end, text: plain(e.text) }))
  return { nodes, edges, subgraphs, has: (a: string, b: string) => edges.some((e) => e.from === a && e.to === b), into: (id: string) => edges.filter((e) => e.to === id).map((e) => e.from).sort() }
}

/** 圖的原始碼裡 `$…$` 以外的文字（去掉 Mermaid 語法）：不可有 Unicode 拼的數學 */
function outsideMath(chart: string): string {
  return chart
    .replace(/\$[^$]*\$/g, '')
    .replace(/classDef[^\n]*/g, '')
    .replace(/class [^\n]*/g, '')
    .replace(/^\s*(flowchart|direction)[^\n]*/gm, '')
}

beforeAll(installMermaidSvgShim)

describe('Ch11b 方塊圖：登錄表與圖號', () => {
  it('6 張圖，id 唯一、每張都有 section、title 與 caption；圖號依順序；匯出的常數名稱存在', () => {
    expect(CH11B_DIAGRAMS).toHaveLength(6)
    expect(new Set(CH11B_DIAGRAMS.map((d) => d.id)).size).toBe(6)
    CH11B_DIAGRAMS.forEach((d, i) => {
      expect(figLabel(d.id)).toBe(`圖 11b-${i + 1}`)
      expect(d.section.startsWith('ch11b-')).toBe(true)
      expect(d.title.length).toBeGreaterThan(5)
      expect(d.caption.length).toBeGreaterThan(20)
      expect((D as Record<string, unknown>)[d.name]).toBe(d.chart)
    })
    expect(CH11B_DIAGRAMS.map((d) => d.section)).toEqual(['ch11b-model', 'ch11b-folding', 'ch11b-structures', 'ch11b-structures', 'ch11b-identifiability', 'ch11b-synthesis'])
  })

  it('系統地圖的主角：DTC、PD、DSM、餘數、comparator、GMAC、accumulator 都是存在的方塊', () => {
    const model = systemMapModel(SYSTEM_MAP_FOCUS)
    const focused = model.blocks.filter((b) => b.focused).map((b) => b.id)
    expect(focused.sort()).toEqual([...SYSTEM_MAP_FOCUS].sort())
    for (const id of SYSTEM_MAP_FOCUS) expect(SYSTEM_BLOCK_LABEL[id]).toBeTruthy()
  })

  it('圖名與圖說：`$` 成對、每段都能被 KaTeX 解析、公式外沒有 Unicode 數學', () => {
    for (const d of CH11B_DIAGRAMS) {
      for (const text of [d.title, d.caption]) {
        const parts = text.split('$')
        expect(parts.length % 2, `${d.id}: ${text}`).toBe(1)
        parts.forEach((p, i) => {
          if (i % 2 === 1) expect(renderTex(p, false), `${d.id}: ${p}`).not.toMatch(/katex-error|c-tex-error/)
          else expect(unicodeMathIn(p), `${d.id}: ${p}`).toEqual([])
        })
        expect(text).not.toMatch(/NaN|undefined|Infinity/)
      }
    }
  })
})

describe('Ch11b 方塊圖：真的用 mermaid 畫出來', () => {
  it.each(CH11B_DIAGRAMS.map((d) => [d.id, d] as const))('%s：可畫出、沒有 Unsupported markdown、≤ 14 個節點、數學都是 KaTeX', async (_id, d) => {
    const r = await renderMermaidForTest(d.chart)
    expect(r.text).not.toMatch(/Unsupported markdown/)
    expect(r.text).not.toContain('$')
    expect(r.nodeCount).toBeGreaterThan(0)
    expect(r.nodeCount).toBeLessThanOrEqual(14)
    expect(r.mathCount).toBeGreaterThan(0)
    expect(unicodeMathIn(r.plainText)).toEqual([])
    expect(unicodeMathIn(outsideMath(d.chart))).toEqual([])
    expect(d.chart).not.toMatch(/NaN|undefined/)
    // 原始碼裡沒有單獨的半形 +／- 標籤（Mermaid 11 會當成 Markdown 清單）
    expect(d.chart).not.toMatch(/"\s*[+-]\s*"/)
  })
})

describe('Ch11b 方塊圖：連線與數字和模型一致', () => {
  it('INL 模型（圖 11b-1）：REF → DTC → PD，DIV → PD（−），PD → e[n] → comparator 與 loop filter；regressor 產生器與向量 GMAC；回授路徑沒有 DTC', async () => {
    const f = await parseFlow(D.CHART_INL_MODEL)
    expect(f.has('REF', 'DTC')).toBe(true)
    expect(f.has('GC', 'DTC')).toBe(true)
    expect(f.has('IC', 'DTC')).toBe(true)
    expect(f.has('DTC', 'PD')).toBe(true)
    expect(f.has('DIV', 'PD')).toBe(true)
    expect(f.into('PD')).toEqual(['DIV', 'DTC'])
    expect(f.has('PD', 'E')).toBe(true)
    expect(f.has('E', 'Q')).toBe(true)
    expect(f.has('E', 'LF')).toBe(true)
    expect(f.has('Q', 'GMAC')).toBe(true)
    expect(f.has('REG', 'GMAC')).toBe(true)
    expect(f.has('GMAC', 'UPD')).toBe(true)
    expect(f.has('UPD', 'IC')).toBe(true)
    expect(f.has('DSM', 'DIV')).toBe(true)
    expect(f.has('DIV', 'DTC')).toBe(false)
    expect(f.has('VCO', 'DTC')).toBe(false)
    expect(f.edges.find((e) => e.from === 'DIV' && e.to === 'PD')?.text).toContain('−')
    expect(f.edges.find((e) => e.from === 'DTC' && e.to === 'PD')?.text).toContain('＋')
    expect(f.nodes.get('DTC')).toContain('T_0 - w \\cdot x - c(x) + d(x)')
    expect(f.nodes.get('E')).toContain('(a - w) x + d(x) - c(x) + b + v')
  })

  it('折返路徑（圖 11b-2）：u → 整形 → x → 線性／二次分岔；二次項的數字 = 2ΣR²、精確式', async () => {
    const f = await parseFlow(D.CHART_FOLDING_PATH)
    expect(f.has('U', 'NTF')).toBe(true)
    expect(f.has('NTF', 'X')).toBe(true)
    expect(f.has('X', 'LIN')).toBe(true)
    expect(f.has('X', 'SQ')).toBe(true)
    expect(f.has('SQ', 'SY')).toBe(true)
    expect(f.has('SY', 'IN')).toBe(true)
    expect(f.has('IN', 'T')).toBe(true)
    const sy = f.nodes.get('SY') ?? ''
    expect(sy).toContain(NUM.s2Gauss.toPrecision(4).replace(/0+$/, ''))
    expect(sy).toContain(NUM.s2Exact.toPrecision(4).replace(/0+$/, ''))
    expect(NUM.s2Gauss).toBeCloseTo(foldedPsdDc(MASH_CODE_AUTOCORR, 2), 15)
    expect(NUM.s2Exact).toBeCloseTo(foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), 15)
    expect(f.nodes.get('X')).toContain('[6, -4, 1]')
    expect(f.nodes.get('NTF')).toContain('[-\\tfrac12, 1, -\\tfrac12]')
  })

  it('分段迴路（圖 11b-3，直向）：x → 選段 → regressor → GMAC → 累加 → mux → DTC → e → comparator → GMAC（迴路閉合）', async () => {
    const f = await parseFlow(D.CHART_PIECEWISE_LOOP)
    for (const [a, b] of [
      ['X', 'SEG'],
      ['SEG', 'REG'],
      ['REG', 'G'],
      ['E', 'Q'],
      ['Q', 'G'],
      ['G', 'ACC'],
      ['ACC', 'MUX'],
      ['SEG', 'MUX'],
      ['MUX', 'DTC'],
      ['DTC', 'E'],
    ])
      expect(f.has(a, b), `${a} → ${b}`).toBe(true)
    expect(f.edges.find((e) => e.from === 'DTC' && e.to === 'E')?.text).toContain('(a + d(x)/x - w_k) \\cdot x + v')
    expect(f.nodes.get('DTC')).toContain('T_0 - w_k \\cdot x + d(x)')
  })

  it('三種結構（圖 11b-4）：三條互不相連的直向鏈（三欄）各 3 個節點，沒有 subgraph；λ 與 τ 的數字 = 模型', async () => {
    const f = await parseFlow(D.CHART_STRUCTURES)
    expect(f.subgraphs).toEqual([])
    expect(f.nodes.size).toBe(9)
    for (const [a, b] of [
      ['PW1', 'PW2'],
      ['PW2', 'PW3'],
      ['L1', 'L2'],
      ['L2', 'L3'],
      ['P1', 'P2'],
      ['P2', 'P3'],
    ])
      expect(f.has(a, b), `${a} → ${b}`).toBe(true)
    expect(f.edges.length).toBe(6)
    const outer = segmentClosedForm(7, 8, 2, 10, 64).lambda
    const inner = segmentClosedForm(4, 8, 2, 10, 64).lambda
    expect(NUM.outer.lambda).toBeCloseTo(outer, 15)
    expect(NUM.inner.lambda).toBeCloseTo(inner, 15)
    expect(f.nodes.get('PW2')).toContain(outer.toPrecision(4).replace(/0+$/, ''))
    expect(f.nodes.get('L2')).toContain(lutClosedForm(64, 2, 10, 64).tau.toPrecision(4).replace(/\.?0+$/, ''))
    expect(f.nodes.get('P2')).toContain(NUM.condMono.toPrecision(4).replace(/0+$/, ''))
    expect(NUM.condMono).toBeGreaterThan(67)
    expect(NUM.condMono).toBeLessThan(68)
  })

  it('Gauge（圖 11b-5）：三個 subgraph 都從 E 出發、都收到 FIX；修法是綠色', async () => {
    const f = await parseFlow(D.CHART_GAUGE)
    expect(f.subgraphs.map((s) => s.id)).toEqual(['G1', 'G2', 'G3'])
    for (const g of ['G1', 'G2', 'G3']) {
      expect(f.has('E', g)).toBe(true)
      expect(f.has(g, 'FIX')).toBe(true)
    }
    expect(D.CHART_GAUGE).toContain('class FIX ok')
    expect(D.CHART_GAUGE).toContain('class A2,B2,C2 warn')
    expect(f.nodes.get('A2')).toContain('\\lambda_{\\min} = 0')
  })

  it('手算流程（圖 11b-6）：① → ②／③ → ④ → ⑤ → ⑥，與 HC-11B.5 的步驟順序一致', async () => {
    const f = await parseFlow(D.CHART_HANDCALC_FLOW)
    for (const [a, b] of [
      ['S1', 'S2'],
      ['S1', 'S3'],
      ['S3', 'S4'],
      ['S2', 'S5'],
      ['S4', 'S5'],
      ['S5', 'S6'],
    ])
      expect(f.has(a, b), `${a} → ${b}`).toBe(true)
    expect(f.nodes.get('S1')).toContain('\\tfrac{4 d_2^2}{45}')
  })
})
