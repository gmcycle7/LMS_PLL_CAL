import mermaid from 'mermaid'
import { extractRegion } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import blockLmsSrc from '@/simulation/models/blockLms.ts?raw'
import * as D from './diagrams'
import { MODEL_CHARTS } from './diagrams'
import { accBitsExact } from './experiments/gmacMath'
import { LEVEL_ROWS } from './sections/S2Levels'
import { hasMath, mathLabelCount, quotedLabels, renderProblems, unicodeMathInSource } from '../lab/diagramTestUtils'

/** 圖原始碼的 TeX 反斜線只寫一次（與 diagrams.ts 的 String.raw 相同） */
const R = String.raw

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
interface Subgraph {
  id: string
  title: string
  nodes: string[]
  dir?: string
}

/**
 * 用真正的 mermaid parser 取出 flowchart 的節點、邊與 subgraph。
 * 連線可以接在 subgraph 上（`R1 --> R2`），Mermaid 會同時把 R1、R2 登錄成「節點」；它們是群組不是方塊，所以從 vertices 裡拿掉，另外放進 subgraphs。
 */
async function flow(chart: string): Promise<{ vertices: Vertex[]; edges: Edge[]; subgraphs: Subgraph[] }> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[]; getSubGraphs: () => Subgraph[] }
  const subgraphs = db.getSubGraphs()
  const groupIds = new Set(subgraphs.map((s) => s.id))
  return { vertices: [...db.getVertices().values()].filter((v) => !groupIds.has(v.id)), edges: db.getEdges(), subgraphs }
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
/** 連線標籤開頭的正負號（可能寫成 `$-$`、`$+$`）：統一成全形「＋」與減號「−」（U+2212） */
function leadingSign(text: string): string {
  const c = text.trim().replace(/^\$/, '').charAt(0)
  return c === '+' ? '＋' : c === '-' ? '−' : c
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

/**
 * 標籤裡每一行（以 <br/> 分隔）去掉 `$...$` 之後的寬度估計：中文字算 1、其他字元算 0.55。
 * 太長的行會把節點撐寬，整張圖就放不進桌機的正文欄（約 900px）；含數學的標籤不會自動換行，所以要自己用 <br/> 斷行。
 */
function overlongLines(chart: string, maxUnits = 16): string[] {
  const hits: string[] = []
  // subgraph 的標題不算：群組永遠比它的標題寬
  for (const label of chart.replace(/^\s*subgraph .*$/gm, '').match(/"[^"\n]*"/g) ?? []) {
    for (const line of label.slice(1, -1).split(/<br\s*\/?>/)) {
      const text = line.replace(/\$[^$]*\$/g, '')
      let units = 0
      for (const ch of text) units += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55
      if (units > maxUnits) hits.push(line.trim())
    }
  }
  return hits
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
        for (const e of incoming) expect(leadingSign(e.text ?? ''), `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
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
    // 標籤為了放進桌機正文欄而用 <br/> 斷行，但文字本身一個符號都不能少（曾經把「L6 進階 PLL / DSM / FCW」的斜線吃掉）
    const labels: Record<string, string> = {
      L0: 'L0純量LMS每sample',
      L1: 'L1BlockGMAC＋Gaussiancomparator',
      L4: 'L4NoisePSD→outputjitter/spur',
      L5: 'L5定點/RTL-like',
      L6: 'L6進階PLL/DSM/FCW',
    }
    for (const [id, text] of Object.entries(labels)) expect(plain(node(g, id)), id).toBe(text)
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
    expect(edgeText(g, 'S', 'CMP')).toBe(R`$e[n]$`)
    expect(edgeText(g, 'CMP', 'MUL')).toBe(R`$q[n]$`)
    expect(edgeText(g, 'X', 'MUL')).toContain(R`$x_{\mathrm{ref}}[n]$`)
    expect(edgeText(g, 'AVG', 'UPD')).toBe(R`$G_k$`)
    expect(edgeText(g, 'REG', 'DTC')).toContain(R`$w_{\mathrm{app}}$`)
    // 極性 δ = a − w：DTC 誤差是 (a − w_app)·x；tie 規則 e ≥ 0 ⇒ q = +1（E07）
    expect(node(g, 'DTC')).toContain(R`$(a - w_{\mathrm{app}})\cdot x$`)
    expect(node(g, 'DTC')).toContain(R`$+ c_2\cdot x^2 + c_3\cdot x^3 + o$`)
    expect(node(g, 'CMP')).toContain(R`$e \ge 0$ 時 $q = +1$，否則 $q = -1$`)
    expect(node(g, 'AVG')).toContain(R`$G_k = \frac{1}{N}\sum q[n]\cdot x_{\mathrm{ref}}[n]$`)
    expect(node(g, 'UPD')).toContain(R`$w_{k+1} = w_k + \mu\cdot G_k$`)
    expect(node(g, 'REG')).toContain(R`$w_{\mathrm{app}} = \mathrm{phys}(w_{k-d})$`)
    expect(node(g, 'HPD')).toContain('狀態跨 block 持續')
    // 兩個取樣率各自一個 subgraph：內層索引 n、外層索引 k；sample-rate 的方塊在內層、block-rate 的在外層
    const sub = /subgraph FS\["([^"]*)"\]([\s\S]*?)\n {2}end\n {2}subgraph FU\["([^"]*)"\]([\s\S]*?)\n {2}end/.exec(chart)
    expect(sub).toBeTruthy()
    expect(sub![1]).toContain(R`索引 $n$`)
    expect(sub![3]).toContain(R`索引 $k$`)
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
    // 同一列之內的箭頭：b → 映射、x → 對齊、兩條都進「條件取負」；累加 → 右移；× μ → gain register → DTC
    for (const [a, b] of [['B', 'MAP'], ['X', 'DLY'], ['MAP', 'NEG'], ['DLY', 'NEG'], ['ACC', 'SHIFT'], ['MU', 'REG'], ['REG', 'DTC']]) {
      expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    }
    // 版面：折成三列（桌機放不下一整排）。Mermaid 只要 subgraph 裡有節點連到外面就會忽略它的 direction，所以列與列之間的箭頭畫在 subgraph 之間：
    // 「條件取負 → 累加」變成 R1 → R2、「右移 → × μ」變成 R2 → R3。下面確認這兩個箭頭真的等於原來的節點對節點：
    // 每一列的出口方塊（NEG、SHIFT）沒有列內的輸出箭頭，入口方塊（ACC、MU）沒有列內的輸入箭頭
    expect(g.subgraphs.map((s) => s.id)).toEqual(['R1', 'R2', 'R3'])
    const rows = Object.fromEntries(g.subgraphs.map((s) => [s.id, [...s.nodes].sort()]))
    expect(rows).toEqual({ R1: ['B', 'DLY', 'MAP', 'NEG', 'X'], R2: ['ACC', 'SHIFT'], R3: ['DTC', 'MU', 'REG'] })
    for (const s of g.subgraphs) expect(s.dir, s.id).toBe('LR')
    for (const out of ['NEG', 'SHIFT']) expect(g.edges.filter((e) => e.start === out), `${out} 是這一列的出口`).toHaveLength(0)
    for (const inn of ['ACC', 'MU']) expect(g.edges.filter((e) => e.end === inn), `${inn} 是這一列的入口`).toHaveLength(0)
    expect(edgeText(g, 'R1', 'R2')).toBe(R`$q\cdot x_{\mathrm{int}}$`) // NEG 的輸出
    expect(edgeText(g, 'R2', 'R3')).toBe(R`$\hat G_k$`) // SHIFT 的輸出，也就是 × μ 的輸入
    expect(g.edges).toHaveLength(9)
    expect(node(g, 'MAP')).toContain(R`$q = 2b - 1$`)
    expect(node(g, 'DLY')).toContain(R`$z^{-D}$`)
    expect(edgeText(g, 'DLY', 'NEG')).toBe(R`$x_{\mathrm{int}}[n-D]$`)
    expect(edgeText(g, 'ACC', 'SHIFT')).toBe(R`$S_k$`)
    expect(edgeText(g, 'MU', 'REG')).toBe(R`$\mu\cdot\hat G_k$`)
    expect(node(g, 'ACC')).toContain(R`$S_k = \sum q\cdot x_{\mathrm{int}}$`)
    expect(node(g, 'ACC')).toContain(R`$B_{\mathrm{acc}} = 1 + \lceil \log_2(N\cdot M_x + 1)\rceil$`)
    expect(node(g, 'SHIFT')).toContain(R`$\ell = \log_2 N - F_G$`)
    expect(node(g, 'SHIFT')).toContain(R`$\hat G_k = \Delta_G\cdot\lfloor S_k / 2^{\ell}\rfloor$`)
    expect(node(g, 'MU')).toContain(R`$\mu = 2^{-m}$`)
    expect(node(g, 'REG')).toContain(R`$w_{k+1} = w_k + \mu\cdot\hat G_k$`)
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

  it('實際渲染（共用的 renderMermaidForTest）：沒有「Unsupported markdown」、畫出來的文字沒有 $、公式都由 KaTeX 排版、KaTeX 以外沒有 Unicode 拼的數學、節點數不超過 14', async () => {
    for (const c of MODEL_CHARTS) {
      const r = await renderMermaidForTest(c.chart)
      expect(r.text, c.name).not.toMatch(/Unsupported markdown/)
      expect(r.text, c.name).not.toContain('$')
      expect(unicodeMathIn(r.plainText), `${c.name} 畫面上 KaTeX 以外的 Unicode 數學`).toEqual([])
      expect(unicodeMathInSource(c.chart), `${c.name} 原始碼 $...$ 以外的 Unicode 數學`).toEqual([])
      expect(r.mathCount, `${c.name} KaTeX 公式數`).toBe(mathLabelCount(c.chart))
      expect(r.mathCount, c.name).toBeGreaterThanOrEqual(1)
      expect(renderProblems(c.chart, r), c.name).toEqual([])
      expect(r.nodeCount, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(r.nodeCount, `${c.name} 節點數`).toBeGreaterThanOrEqual(5)
      const g = await flow(c.chart)
      for (const v of g.vertices) if (!hasMath(v.text ?? '')) expect(plain(r.text).includes(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text && !hasMath(e.text)) expect(plain(r.text).includes(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
      // subgraph（列、迴圈）的標題也要畫出來：不含公式的原樣出現
      for (const sg of g.subgraphs) if (!hasMath(sg.title)) expect(plain(r.text).includes(plain(sg.title)), `${c.name} 群組 ${sg.id}：「${sg.title}」沒有原樣出現在圖上`).toBe(true)
    }
  }, 120_000)

  it('版面：桌機正文欄（約 900px）放得下、不用橫向捲動——兩層迴圈由上到下、datapath 折成三列、階梯圖的長標籤換行；沒有過長的單行（實際尺寸由 scripts/diagram-audit.mjs 量）', async () => {
    expect(D.LEVEL_CHART).toMatch(/^flowchart LR/)
    expect(D.CHART_BLOCK_SIGN_LMS).toMatch(/^flowchart TB/)
    expect(D.CHART_GMAC_DATAPATH).toMatch(/^flowchart TB/)
    // 兩層迴圈：內層（FS）在上、外層（FU）在下，兩個 subgraph 並列，沒有巢狀
    const loop = await flow(D.CHART_BLOCK_SIGN_LMS)
    expect(loop.subgraphs.map((s) => s.id)).toEqual(['FS', 'FU'])
    for (const c of MODEL_CHARTS) expect(overlongLines(c.chart), c.name).toEqual([])
  }, 60_000)

  it('圖內的數學都是 LaTeX：兩層迴圈與 datapath 的變數標籤都含 `$...$`，且成對；subgraph 標題的公式也由 KaTeX 排版', async () => {
    for (const c of MODEL_CHARTS) {
      expect(quotedLabels(c.chart).some(hasMath), c.name).toBe(true)
      for (const label of quotedLabels(c.chart)) expect((label.match(/(?<!\\)\$/g) ?? []).length % 2, `${c.name}：「${label}」的 $ 要成對`).toBe(0)
    }
    // subgraph 標題含 $n$、$k$、$N$：標題裡沒有殘留 `$`，公式個數也計入 mathCount
    const r = await renderMermaidForTest(D.CHART_BLOCK_SIGN_LMS)
    expect(r.text).toContain('內層迴圈')
    expect(r.text).toContain('外層迴圈')
    expect(r.text).not.toContain('$')
  }, 60_000)
})
