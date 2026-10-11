import mermaid from 'mermaid'
import { extractRegion } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import blockLmsSrc from '@/simulation/models/blockLms.ts?raw'
import * as D from './diagrams'
import { MODEL_CHARTS } from './diagrams'
import { accBitsExact } from './experiments/gmacMath'
import { LEVEL_ROWS } from './sections/S2Levels'

interface Vertex {
  id: string
  text?: string
  type?: string
}
interface Edge {
  start: string
  end: string
  text?: string
}

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊。 */
async function flow(chart: string): Promise<{ vertices: Vertex[]; edges: Edge[] }> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

function edgeText(g: { edges: Edge[] }, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e.text ?? ''
}
const node = (g: { vertices: Vertex[] }, id: string): string => {
  const v = g.vertices.find((x) => x.id === id)
  if (!v) throw new Error(`沒有節點 ${id}`)
  return v.text ?? ''
}
const hasEdge = (g: { edges: Edge[] }, start: string, end: string) => g.edges.some((e) => e.start === start && e.end === end)

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')

/** Mermaid 11 把標籤當 Markdown：這些寫法會被畫成「Unsupported markdown: …」或被 HTML 解析吃掉。 */
function labelHazard(text: string): string | null {
  for (const line of text.split(/<br\s*\/?>/)) {
    const t = line.trim()
    if (t === '+' || t === '-' || t === '*') return `單獨的「${t}」會被當成清單`
    if (/^[+\-*] /.test(t)) return `「${t.slice(0, 8)}」以清單符號開頭`
    if (/^\d+[.)] /.test(t)) return `「${t.slice(0, 8)}」以編號清單開頭`
    if (/^#{1,6} /.test(t)) return `「${t.slice(0, 8)}」以標題符號開頭`
    if (/`/.test(t)) return '反引號會被當成 code span'
  }
  if (/<(?!br\s*\/?>)[A-Za-z/!]/.test(text)) return '「<」後面緊接字母，會被當成 HTML 標籤'
  return null
}

describe('Models 頁的方塊圖（真正的 mermaid parser）', () => {
  beforeAll(() => {
    installMermaidSvgShim()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', suppressErrorRendering: true })
  })

  it('清單：三張圖（模型層級階梯、Block Sign-LMS 兩層迴圈、GMAC datapath），diagrams.ts 匯出的每張圖都在清單裡', () => {
    expect(MODEL_CHARTS.map((c) => c.name)).toEqual(['LEVEL_CHART', 'CHART_BLOCK_SIGN_LMS', 'CHART_GMAC_DATAPATH'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(MODEL_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(MODEL_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
  })

  it('每一張都能解析成 flowchart；不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法；加法點的每條輸入都標了正負號', async () => {
    for (const c of MODEL_CHARTS) {
      const r = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(r && typeof r === 'object' ? r.diagramType : r, c.name).toBe('flowchart-v2')
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(g.vertices.length, `${c.name} 節點數`).toBeGreaterThanOrEqual(5)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
      for (const s of g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
      }
    }
  }, 60_000)

  it('模型層級階梯：七個層級都在；L0 → L1 → L2 是主線，L2 分成 L3／L4／L5，再匯到 L6；顏色與表格的實作程度一致', async () => {
    const g = await flow(D.LEVEL_CHART)
    const levels = LEVEL_ROWS.map((r) => r.level)
    expect(levels).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'])
    expect(g.vertices.map((v) => v.id).sort()).toEqual([...levels].sort())
    for (const id of levels) expect(node(g, id).startsWith(id), id).toBe(true)
    for (const [a, b] of [['L0', 'L1'], ['L1', 'L2'], ['L2', 'L3'], ['L2', 'L4'], ['L2', 'L5'], ['L3', 'L6'], ['L4', 'L6'], ['L5', 'L6']]) expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    expect(g.edges).toHaveLength(8)
    // 綠 = 已實作、紅 = Not implemented；簡化版（partial）不上色
    const cls = (name: string) => (new RegExp(`class ([A-Z0-9,]+) ${name}\\b`).exec(D.LEVEL_CHART)?.[1] ?? '').split(',').filter(Boolean).sort()
    expect(cls('ok')).toEqual(LEVEL_ROWS.filter((r) => r.status === 'full').map((r) => r.level).sort())
    expect(cls('warn')).toEqual(LEVEL_ROWS.filter((r) => r.status === 'none').map((r) => r.level).sort())
    expect(LEVEL_ROWS.filter((r) => r.status === 'partial').length).toBe(4)
  })

  it('Block Sign-LMS 兩層迴圈：方塊的順序、極性與取樣率和 F-15.1／F-15.2、以及 blockLms.ts 實際執行的程式一致', async () => {
    const chart = D.CHART_BLOCK_SIGN_LMS
    const g = await flow(chart)
    // 內層（sample rate）：x → DTC 誤差 → H_PD → ＋（offset、雜訊）→ comparator → × x_ref
    for (const [a, b] of [['X', 'DTC'], ['DTC', 'HPD'], ['HPD', 'S'], ['BV', 'S'], ['S', 'CMP'], ['CMP', 'MUL'], ['X', 'MUL'], ['MUL', 'AVG'], ['AVG', 'UPD'], ['UPD', 'REG'], ['REG', 'DTC']]) {
      expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    }
    expect(edgeText(g, 'HPD', 'S')).toBe('＋')
    expect(edgeText(g, 'BV', 'S')).toBe('＋')
    expect(edgeText(g, 'S', 'CMP')).toBe('e[n]')
    expect(edgeText(g, 'CMP', 'MUL')).toBe('q[n]')
    expect(edgeText(g, 'X', 'MUL')).toContain('x_ref[n]')
    expect(edgeText(g, 'AVG', 'UPD')).toBe('G_k')
    expect(edgeText(g, 'REG', 'DTC')).toContain('w_app')
    // 極性 δ = a − w：DTC 誤差是 (a − w_app)·x；tie 規則 e ≥ 0 ⇒ q = +1（E07）
    expect(node(g, 'DTC')).toContain('(a − w_app)·x')
    expect(node(g, 'DTC')).toContain('c₂·x² + c₃·x³ + o')
    expect(node(g, 'CMP')).toContain('e ≥ 0 時 q = +1')
    expect(node(g, 'AVG')).toContain('G_k = (1/N)·Σ q[n]·x_ref[n]')
    expect(node(g, 'UPD')).toContain('w_(k+1) = w_k + μ·G_k')
    expect(node(g, 'REG')).toContain('w_app = phys(w_(k−d))')
    expect(node(g, 'HPD')).toContain('狀態跨 block 持續')
    // 兩個取樣率各自一個 subgraph：內層索引 n、外層索引 k；sample-rate 的方塊在內層、block-rate 的在外層
    const sub = /subgraph FS\["([^"]*)"\]([\s\S]*?)\n {2}end\n {2}subgraph FU\["([^"]*)"\]([\s\S]*?)\n {2}end/.exec(chart)
    expect(sub).toBeTruthy()
    expect(sub![1]).toContain('索引 n')
    expect(sub![3]).toContain('索引 k')
    for (const id of ['DTC', 'HPD', 'CMP', 'MUL']) expect(sub![2], id).toMatch(new RegExp(`\\b${id}[\\[(]`))
    for (const id of ['AVG', 'UPD', 'REG']) expect(sub![4], id).toMatch(new RegExp(`\\b${id}\\[`))
    // 與實際執行的程式逐行對照（core region；頁面的 CodeCompare 顯示的就是這幾段）
    const inner = extractRegion(blockLmsSrc, 'blockLmsInnerLoop')
    const order = ['let dt = coef * x', 'pathF.step(dt)', 'const e = u + bOff', 'e >= 0 ? 1 : qLo', 'acc += q * xrn']
    const at = order.map((line) => inner.indexOf(line))
    for (let i = 0; i < at.length; i++) expect(at[i], order[i]).toBeGreaterThanOrEqual(0)
    expect([...at].sort((x, y) => x - y)).toEqual(at) // 程式的順序 = 圖上的順序
    expect(extractRegion(blockLmsSrc, 'blockLmsGmacUpdate')).toMatch(/^const Gk = avg \? acc \/ N : acc/)
    expect(extractRegion(blockLmsSrc, 'blockLmsBlockSetup')).toContain('const wApp = wPhys[k - dUp >= 0 ? k - dUp : 0]')
  })

  it('GMAC datapath：b → q = 2b − 1、對齊 D、條件取負、累加、右移、× μ、gain register；位元數公式與 accBitsExact 相同', async () => {
    const g = await flow(D.CHART_GMAC_DATAPATH)
    for (const [a, b] of [['B', 'MAP'], ['X', 'DLY'], ['MAP', 'NEG'], ['DLY', 'NEG'], ['NEG', 'ACC'], ['ACC', 'SHIFT'], ['SHIFT', 'MU'], ['MU', 'REG'], ['REG', 'DTC']]) {
      expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    }
    expect(g.edges).toHaveLength(9)
    expect(node(g, 'MAP')).toContain('q = 2b − 1')
    expect(node(g, 'DLY')).toContain('z^(−D)')
    expect(edgeText(g, 'DLY', 'NEG')).toBe('x_int[n−D]')
    expect(edgeText(g, 'ACC', 'SHIFT')).toBe('S_k')
    expect(edgeText(g, 'SHIFT', 'MU')).toBe('Ĝ_k')
    expect(node(g, 'ACC')).toContain('S_k = Σ q·x_int')
    expect(node(g, 'ACC')).toContain('B_acc = 1 + ⌈log₂(N·M_x + 1)⌉ bits')
    expect(node(g, 'SHIFT')).toContain('ℓ = log₂N − F_G')
    expect(node(g, 'SHIFT')).toContain('Ĝ_k = Δ_G·⌊S_k / 2^ℓ⌋')
    expect(node(g, 'MU')).toContain('μ = 2^(−m)')
    expect(node(g, 'REG')).toContain('w_(k+1) = w_k + μ·Ĝ_k')
    // 檢查 1–8 都標在圖上，各出現一次
    const marks = D.CHART_GMAC_DATAPATH.match(/檢查 [\d、]+/g) ?? []
    expect(marks.flatMap((m) => m.replace('檢查 ', '').split('、').map(Number)).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // 圖上的位元數公式（F-16.1）就是頁面計算器用的 accBitsExact：1 + ⌈log₂(N·M_x + 1)⌉
    const formula = (N: number, Mx: number) => 1 + Math.ceil(Math.log2(N * Mx + 1))
    for (const [bx, N] of [[6, 4096], [6, 33], [8, 1000], [4, 2]] as const) {
      expect(accBitsExact(bx, N, 'symmetric'), `symmetric ${bx} ${N}`).toBe(formula(N, 2 ** (bx - 1) - 1))
      expect(accBitsExact(bx, N, 'full'), `full ${bx} ${N}`).toBe(formula(N, 2 ** (bx - 1)))
    }
    expect(accBitsExact(6, 4096, 'symmetric')).toBe(18)
  })

  it('實際渲染（共用的 renderMermaidForTest）：沒有「Unsupported markdown」、節點數不超過 14，畫面上的每個標籤都和原始碼相同', async () => {
    for (const c of MODEL_CHARTS) {
      const { svg, text, nodeCount } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(nodeCount, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(nodeCount, `${c.name} 節點數`).toBeGreaterThanOrEqual(5)
      const host = document.createElement('div')
      host.innerHTML = svg
      const shown = new Set(Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel, .cluster-label')).map((e) => plain(e.textContent ?? '')))
      const g = await flow(c.chart)
      for (const v of g.vertices) expect(shown.has(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text) expect(shown.has(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
    }
  }, 120_000)
})
