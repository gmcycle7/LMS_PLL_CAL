import { fireEvent } from '@testing-library/react'
import mermaid from 'mermaid'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { kq } from '@/simulation/models/comparator'
import { blockSignGmacStep, gainScale, type ConventionInput } from './bridge'
import * as D from './diagrams'
import { CHART_CONVENTION_BRIDGE, CHART_NUMBER_SOURCES, CHART_PAPER_MAP, PAPER_MAP, PAPERS_CHARTS } from './diagrams'
import PapersPage, { SYMBOLS } from './index'
import { PAPERS, READING_PATH_CHART } from './references'
import { renderPage } from '@/test/renderPage'
import { expectTexParses } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
// 頁面測試用的 Mermaid 元件替身：把原始碼放在 data-chart，方便核對「頁面上畫了哪些圖、順序為何」。
// 真正的 mermaid 套件沒有被 mock，下面照樣用它解析與渲染每一張圖。
vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  return {
    Mermaid: ({ chart, caption }: { chart: string; caption?: string }) =>
      createElement('figure', { className: 'c-mermaid', 'data-chart': chart }, caption ? createElement('figcaption', { className: 'c-figcaption' }, caption) : null),
    renderMermaid: async () => '<svg></svg>',
  }
})

afterEach(() => {
  localStorage.clear()
})

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

const nodeText = (g: { vertices: Vertex[] }, id: string): string => g.vertices.find((v) => v.id === id)?.text ?? ''
const hasEdge = (g: { edges: Edge[] }, start: string, end: string) => g.edges.some((e) => e.start === start && e.end === end)

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')

/** 與共用 Mermaid 前處理（mermaidSource.ts）相同的行內公式規則：`$...$` 或 `$$...$$`，`\$` 是字面的美元符號。 */
const MATH = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 圖原始碼裡所有雙引號標籤（節點、連線）。 */
const quotedLabels = (chart: string): string[] => Array.from(chart.matchAll(/"([^"\n]*)"/g), (m) => m[1])

const hasMath = (label: string): boolean => {
  MATH.lastIndex = 0
  const found = MATH.test(label)
  MATH.lastIndex = 0
  return found
}

/** 含 `$...$` 的標籤個數：共用 Mermaid 把每個這樣的標籤排版成一個 KaTeX 區塊，所以畫出來的 .katex 數必須剛好等於它。 */
const mathLabelCount = (chart: string): number => quotedLabels(chart).filter(hasMath).length

/** 標籤去掉 `$...$` 之後留下的文字片段（<br/> 與公式都當成分隔）。 */
const textPieces = (label: string): string[] =>
  label
    .replace(MATH, '\uE000')
    .split(/<br\s*\/?>|\uE000/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

/** 去掉所有空白（含不換行空白與零寬空白） */
const squash = (t: string) => t.replace(/[\s\u00a0\u200b]+/g, '')

/** Mermaid 11 把標籤當 Markdown：這些寫法會被畫成「Unsupported markdown: …」或被 HTML 解析吃掉。 */
function labelHazard(text: string): string | null {
  for (const line of text.split(/<br\s*\/?>/)) {
    const t = line.trim()
    if (t === '+' || t === '-' || t === '*') return `單獨的「${t}」會被當成清單`
    if (/^[+\-*] /.test(t)) return `「${t.slice(0, 8)}」以清單符號開頭`
    if (/^\d+[.)] /.test(t)) return `「${t.slice(0, 8)}」以編號清單開頭`
    if (/^#{1,6} /.test(t)) return `「${t.slice(0, 8)}」以標題符號開頭`
    if (/[`*]/.test(t)) return '反引號／星號會被當成 code span 或強調'
  }
  if (/<(?!br\s*\/?>)[A-Za-z/!]/.test(text)) return '「<」後面緊接字母，會被當成 HTML 標籤'
  return null
}

describe('Papers 的 Mermaid 圖：清單', () => {
  it('共 4 張（閱讀路線圖 + 3 張新圖）；diagrams.ts 匯出的每一張都在清單裡', () => {
    expect(PAPERS_CHARTS.map((c) => c.name)).toEqual(['CHART_NUMBER_SOURCES', 'READING_PATH_CHART', 'CHART_PAPER_MAP', 'CHART_CONVENTION_BRIDGE'])
    expect(PAPERS_CHARTS.map((c) => c.section)).toEqual(['§1', '§2', '§3', '§4'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(['CHART_CONVENTION_BRIDGE', 'CHART_NUMBER_SOURCES', 'CHART_PAPER_MAP'])
    for (const [k, v] of exported) expect(PAPERS_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    expect(PAPERS_CHARTS.find((c) => c.name === 'READING_PATH_CHART')?.chart).toBe(READING_PATH_CHART)
  })
})

describe('Papers 的 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    installMermaidSvgShim()
  })

  it('每一張都能解析成 flowchart；不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法', async () => {
    for (const c of PAPERS_CHARTS) {
      const r = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(r && typeof r === 'object' ? r.diagramType : r, c.name).toBe('flowchart-v2')
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(g.vertices.length, `${c.name} 節點數`).toBeGreaterThanOrEqual(4)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
    }
  }, 60000)

  it('版面：四張都是直向（TB／TD）。文獻對照圖是一圈迴路、換算圖有四條並排的輸入，橫向（LR）會寬到 1800–1900 px 而要橫向捲動（teaching-style §8「版面寬度」）', () => {
    for (const c of PAPERS_CHARTS) expect(c.chart, c.name).toMatch(/^flowchart (TB|TD)\n/)
  })

  it('數字來源圖：三種來源各一條路；只有「已發表主張」與「本站推導」會走到「能不能比」；例子與文獻資料一致', async () => {
    const g = await flow(CHART_NUMBER_SOURCES)
    expect(g.edges.filter((e) => e.start === 'Q').map((e) => e.end)).toEqual(['LIT', 'SPEC', 'DER'])
    expect(hasEdge(g, 'LIT', 'X')).toBe(true)
    expect(hasEdge(g, 'DER', 'X')).toBe(true)
    expect(g.edges.some((e) => e.start === 'SPEC')).toBe(false) // 規格書的描述不當作數值證據：沒有往下的邊
    expect(nodeText(g, 'SPEC')).toContain('未經本站核對')
    expect(g.edges.filter((e) => e.start === 'X').map((e) => e.end)).toEqual(['OKC', 'NO'])
    expect(edgeText(g, 'X', 'OKC')).toBe('物理量、模型、條件都相同')
    // 例子：D4 的題名確實寫了 74 fs jitter（題名層級的主張）
    const d4 = PAPERS.find((p) => p.id === 'D4')!
    expect(d4.title).toMatch(/74\s?fs-Jitter/)
    expect(d4.titleClaim).toContain('74 fs jitter')
    expect(nodeText(g, 'LIT')).toContain('D4 題名的 74 fs jitter')
    expect(nodeText(g, 'DER')).toContain(String.raw`$\sigma_w$`)
    expect(CHART_NUMBER_SOURCES).toContain('class DER focus')
    expect(CHART_NUMBER_SOURCES).toContain('class NO warn')
  })

  it('文獻對照圖：D1–D7 各出現一次；每個方塊標的章節都在該文獻的「本站相關頁面」裡；迴路首尾相接', async () => {
    const g = await flow(CHART_PAPER_MAP)
    // 每份文獻恰好掛在一個方塊上
    expect(PAPER_MAP.flatMap((m) => m.papers).sort()).toEqual(PAPERS.map((p) => p.id).sort())
    for (const p of PAPERS) expect((CHART_PAPER_MAP.match(new RegExp(`\\b${p.id}\\b`, 'g')) ?? []).length, p.id).toBe(1)
    for (const m of PAPER_MAP) {
      const text = nodeText(g, m.node)
      expect(text, m.node).not.toBe('')
      for (const id of m.papers) {
        expect(text, `${m.node} 應標出 ${id}`).toContain(id)
        const paper = PAPERS.find((p) => p.id === id)!
        for (const page of m.pages) expect(paper.pages_, `${id} 的相關頁面應含 ${page}`).toContain(page)
      }
      for (const page of m.pages) expect(text, `${m.node} 應標出 ${page}`).toContain(`Ch${page.slice(2)}`)
    }
    // 沒有文獻的方塊（殘差、comparator）不標 D 編號
    for (const id of ['RES', 'CMP']) expect(nodeText(g, id)).not.toMatch(/D\d/)
    // 迴路：code → 殘差 → H_PD → comparator → GMAC → 累加 → 延遲 → 量化 → 回到殘差；regressor 另有一條到 GMAC
    const loop = ['X', 'RES', 'HPD', 'CMP', 'GMAC', 'UPD', 'DLY', 'QNT', 'RES']
    for (let i = 0; i + 1 < loop.length; i++) expect(hasEdge(g, loop[i], loop[i + 1]), `${loop[i]} → ${loop[i + 1]}`).toBe(true)
    expect(edgeText(g, 'X', 'GMAC')).toBe('regressor $x[n]$')
    // comparator 的輸入是 PD 的輸出 e[n]（docs/assumptions.md §2a），不是 DTC 或 divider
    expect(edgeText(g, 'HPD', 'CMP')).toBe('PD 輸出 $e[n]$')
    expect(g.edges.filter((e) => e.end === 'CMP').map((e) => e.start)).toEqual(['HPD'])
    // DTC 補償的是 reference 端；圖上沒有 divider／feedback 路徑上的 DTC
    expect(nodeText(g, 'RES')).toContain('reference 端 DTC')
    expect(CHART_PAPER_MAP).not.toMatch(/divider|DIV|除頻|回授路徑/)
    expect(edgeText(g, 'CMP', 'GMAC')).toBe('$q[n]$')
    expect(edgeText(g, 'GMAC', 'UPD')).toBe('$G_k$')
    expect(edgeText(g, 'QNT', 'RES')).toBe('$w$')
    // 公式與極性（標籤原始碼就是 LaTeX）：殘差 (a − w)·x[n]（δ = a − w）、q = sign(e)、G_k 是平均、w_(k+1) = w_k + μ·G_k
    expect(nodeText(g, 'RES')).toContain(String.raw`$(a - w)\,x[n]$`)
    expect(nodeText(g, 'HPD')).toContain(String.raw`$H_{\mathrm{PD}}$`)
    expect(nodeText(g, 'CMP')).toContain(String.raw`$q[n] = \operatorname{sign}(e[n])$`)
    expect(nodeText(g, 'GMAC')).toContain(String.raw`$G_k = \frac{1}{N}\sum q[n]\,x[n]$`)
    expect(nodeText(g, 'UPD')).toContain(String.raw`$w_{k+1} = w_k + \mu\,G_k$`)
  })

  it('文獻對照圖上的運算就是 bridge.ts 的 blockSignGmacStep：照著圖算一個 block，G 與新的 w 完全相同', () => {
    const xs = [1, -1, 1, 1, -1, 1, -1, -1]
    const vs = [0.3, -0.2, 0.1, -0.4, 0.2, 0.05, -0.1, 0.25]
    const [a, w, mu] = [3, 2.5, 0.2]
    let acc = 0
    for (let n = 0; n < xs.length; n++) {
      const e = (a - w) * xs[n] + vs[n] // 殘差 (a − w)·x[n]，加上 comparator 前的雜訊
      const q = e >= 0 ? 1 : -1 // q[n] = sign(e[n])
      acc += q * xs[n] // Σ q[n]·x[n]
    }
    const G = acc / xs.length // G_k = (1/N)·Σ
    const step = blockSignGmacStep({ w, a, xs, vs, mu })
    expect(step.G).toBe(G)
    expect(step.w).toBe(w + mu * G) // w_(k+1) = w_k + μ·G_k
    expect(G).toBeGreaterThan(0) // w 比 a 小（δ > 0）時 G 為正，w 往上修
  })

  it('步長換算圖：四條箭頭上的換算式就是 gainScale 算的 s；右半邊是 g_i = s·λ_i、p_i = 1 − g_i', async () => {
    const g = await flow(CHART_CONVENTION_BRIDGE)
    expect(edgeText(g, 'H', 'S')).toBe(String.raw`$s = \mu$`)
    expect(edgeText(g, 'W', 'S')).toBe(String.raw`$s = 2\mu_W$`)
    expect(edgeText(g, 'N', 'S')).toBe(String.raw`$s \approx \tilde\mu/(\varepsilon_{\mathrm{reg}} + \operatorname{tr}R)$`)
    expect(edgeText(g, 'G', 'S')).toBe(String.raw`$s = \mu K_q$（誤用 sum 模式再 $\times N$）`)
    expect(nodeText(g, 'H')).toContain(String.raw`$w \leftarrow w + \mu\,e\,x$`)
    expect(nodeText(g, 'W')).toContain(String.raw`$w \leftarrow w + 2\mu_W\,\varepsilon\,x$`)
    expect(nodeText(g, 'N')).toContain(String.raw`$w \leftarrow w + \tilde\mu\,e\,x/(\varepsilon_{\mathrm{reg}} + \lVert x\rVert^2)$`)
    expect(nodeText(g, 'G')).toContain(String.raw`$w \leftarrow w + \mu\,\frac{1}{N}\sum q\,x$`)
    expect(nodeText(g, 'GI')).toContain(String.raw`$g_i = s\,\lambda_i$`)
    expect(nodeText(g, 'P')).toContain(String.raw`$p_i = 1 - g_i$`)
    for (const [a, b] of [['S', 'GI'], ['GI', 'P'], ['P', 'Q'], ['Q', 'OK'], ['Q', 'BAD']]) expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    expect(edgeText(g, 'Q', 'OK')).toBe('是')
    expect(edgeText(g, 'Q', 'BAD')).toBe('否')
    // 與 bridge.ts 的 gainScale 逐一比對
    const base: Omit<ConventionInput, 'convention'> = { mu: 0.1, traceR: 4, epsReg: 0.5, sigmaV: 100, N: 4096, sumMode: false, polarity: 1 }
    expect(gainScale({ ...base, convention: 'half' })).toBe(0.1) // s = μ
    expect(gainScale({ ...base, convention: 'widrow' })).toBe(2 * 0.1) // s = 2·μ_W
    expect(gainScale({ ...base, convention: 'nlms' })).toBe(0.1 / (0.5 + 4)) // s ≈ μ̃/(ε_reg + tr R)
    expect(gainScale({ ...base, convention: 'signBlock' })).toBeCloseTo(0.1 * kq(100), 15) // s = μ·K_q
    expect(gainScale({ ...base, convention: 'signBlock', sumMode: true })).toBeCloseTo(0.1 * kq(100) * 4096, 12) // 誤用 sum 模式再 ×N
    // 判定：|p_i| = |1 − s·λ_i| < 1 ⇔ 0 < s·λ_i < 2
    const stable = (s: number, lambdas: number[]) => lambdas.every((l) => Math.abs(1 - s * l) < 1)
    expect(stable(0.1, [1.9, 0.1])).toBe(true)
    expect(stable(1.2, [1.9, 0.1])).toBe(false) // s·λ_max = 2.28 > 2
    expect(stable(-0.1, [1.9, 0.1])).toBe(false) // 極性接反
  })

  it('圖內的數學一律是 `$...$` LaTeX：$ 成對、每段 TeX 可被 KaTeX 嚴格解析、不用雙反斜線（Mermaid 會收成一個）、`$...$` 以外沒有 Unicode 拼的數學', () => {
    for (const c of PAPERS_CHARTS) {
      expect(c.chart, c.name).not.toContain('\\\\')
      for (const label of quotedLabels(c.chart)) {
        const dollars = label.replace(/\\\$/g, '').split('$').length - 1
        expect(dollars % 2, `${c.name}：${label}`).toBe(0)
        for (const m of label.matchAll(MATH)) {
          expectTexParses(m[1] ?? m[2], `${c.name}：${m[0]}`, { strict: 'ignore' })
        }
        expect(unicodeMathIn(textPieces(label).join(' ')), `${c.name}：${label}`).toEqual([])
      }
    }
    // 三張新圖都真的有公式（閱讀路線圖 READING_PATH_CHART 是文獻名稱的流程圖，沒有公式）
    for (const c of [CHART_NUMBER_SOURCES, CHART_PAPER_MAP, CHART_CONVENTION_BRIDGE]) expect(mathLabelCount(c)).toBeGreaterThanOrEqual(1)
    expect(mathLabelCount(CHART_PAPER_MAP)).toBeGreaterThanOrEqual(10)
    expect(mathLabelCount(CHART_CONVENTION_BRIDGE)).toBeGreaterThanOrEqual(12)
  })

  it('實際渲染（共用的 renderMermaidForTest）：每張圖都畫得出來，沒有「Unsupported markdown」、畫面上沒有殘留的 $、KaTeX 以外沒有 Unicode 數學、節點數 ≤ 14，每個標籤都畫出來', async () => {
    for (const c of PAPERS_CHARTS) {
      const { svg, text, nodeCount, mathCount, plainText } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(text, `${c.name}：畫面上不可殘留 $`).not.toContain('$')
      expect(unicodeMathIn(plainText), `${c.name}：KaTeX 以外不可有 Unicode 拼的數學`).toEqual([])
      expect(nodeCount, c.name).toBeLessThanOrEqual(14)
      expect(nodeCount, c.name).toBeGreaterThanOrEqual(4)
      expect(mathCount, `${c.name}：每個含 $...$ 的標籤都排成一個 KaTeX 區塊`).toBe(mathLabelCount(c.chart))
      const host = document.createElement('div')
      host.innerHTML = svg
      host.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
      const shown = Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel')).map((e) => squash(e.textContent ?? ''))
      const g = await flow(c.chart)
      expect(nodeCount, `${c.name}：畫出來的節點數 = 解析出來的節點數`).toBe(g.vertices.length)
      // 沒有公式的標籤原樣出現在圖上；含公式的標籤，公式以外的文字片段都在同一個標籤裡
      const appears = (label: string): boolean => {
        const decoded = label.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
        if (!hasMath(decoded)) return shown.includes(plain(decoded))
        return shown.some((t) => textPieces(decoded).every((piece) => t.includes(squash(piece))))
      }
      for (const v of g.vertices) expect(appears(v.text ?? ''), `${c.name} 節點 ${v.id}：「${v.text}」沒有出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text) expect(appears(e.text), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有出現在圖上`).toBe(true)
    }
  }, 120000)
})

describe('Papers 頁面上的方塊圖與符號表（teaching-style §5、§8）', () => {
  it('4 張圖各出現一次、順序與清單相同、都有圖說；新的三張有「先看…再看…」導讀並放在對應的表格／推導之前；符號表在頁尾（id="symbols"），頁首只留一行按鈕', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = renderPage(<PapersPage />, { url: '/papers' })
    const before = (a: Element | null, b: Element | null, msg: string) => {
      expect(a, msg).toBeTruthy()
      expect(b, msg).toBeTruthy()
      expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING, msg).toBeTruthy()
    }

    // ① 圖：與清單同序、各一次（Beginner 模式也全部看得到）
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual(PAPERS_CHARTS.map((c) => c.chart))
    const el = (name: string) => figs[PAPERS_CHARTS.findIndex((c) => c.name === name)]
    // ② 圖說是純文字（不用 Unicode 拼數學、不留 $）
    const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓$]/
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, f.getAttribute('data-chart')?.slice(0, 40)).toBeGreaterThan(15)
      expect(BAD.test(cap), cap).toBe(false)
    }
    // ③ 新的三張：導讀「先看…再看…」含 KaTeX，並對照圖上的方塊
    for (const name of ['CHART_NUMBER_SOURCES', 'CHART_PAPER_MAP', 'CHART_CONVENTION_BRIDGE']) {
      const walk = el(name).closest('.papers-diagram')?.querySelector('.papers-diagram-walk')
      expect(walk?.textContent, name).toContain('先看')
      expect(walk?.textContent, name).toContain('再看')
      expect(walk?.textContent, name).toContain('圖上')
      expect(walk?.querySelector('.katex'), name).toBeTruthy()
    }
    // 文獻對照圖的導讀（docs/assumptions.md §2a）：reference 端的 DTC 從基準延遲往回扣，PD 量 reference 減 feedback；comparator 取 PD 的輸出
    const mapWalk = el('CHART_PAPER_MAP').closest('.papers-diagram')?.querySelector('.papers-diagram-walk')?.textContent ?? ''
    expect(mapWalk).toContain('reference 端 DTC')
    expect(mapWalk).toContain('基準延遲')
    expect(mapWalk).toContain('feedback（divider）edge 比理想時刻早到')
    expect(mapWalk).toContain('只能延遲、不能提前')
    const mapWalkTex = Array.from(el('CHART_PAPER_MAP').closest('.papers-diagram')?.querySelectorAll('.papers-diagram-walk annotation') ?? []).map((a) => a.textContent ?? '')
    expect(mapWalkTex).toContain(String.raw`\tau_{\mathrm{DTC}}=T_0-w\,x[n]`) // 延遲 = 基準延遲 − 補償量
    expect(mapWalkTex).toContain(String.raw`e[n]=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]`)
    expect(mapWalk).toContain('reference edge 減 feedback edge')
    expect(mapWalk).toContain('comparator 取的就是 PD 的輸出')
    expect(mapWalk).toContain('送進 loop filter 的同一個訊號')
    // ④ 位置：各在自己的段落內；文字說明 → 圖 → 表格／卡片／推導
    const inside: [string, string][] = [
      ['CHART_NUMBER_SOURCES', 'papers-policy'],
      ['READING_PATH_CHART', 'papers-path'],
      ['CHART_PAPER_MAP', 'papers-list'],
      ['CHART_CONVENTION_BRIDGE', 'papers-conventions'],
    ]
    for (const [name, section] of inside) expect(el(name).closest(`#${section}`), `${name} 應在 #${section} 內`).toBeTruthy()
    before(el('CHART_NUMBER_SOURCES'), container.querySelector('#papers-policy table'), '數字來源圖在三種類別的表格之前')
    before(el('CHART_PAPER_MAP'), container.querySelector('#papers-D1'), '文獻對照圖在第一張文獻卡之前')
    before(el('CHART_CONVENTION_BRIDGE'), container.querySelector('[id="formula-F-PR.1"]'), '步長換算圖在「差 2 倍」的推導之前')
    before(container.querySelector('#papers-conventions table'), el('CHART_CONVENTION_BRIDGE'), '步長換算圖在手算例的表格之後')

    // ⑤ 符號表：全頁只有一張，在 #symbols 裡；#symbols 是整頁最後一個區塊（§9 本頁必記之後）
    const page = container.querySelector('.papers')!
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(page.lastElementChild).toBe(symbols)
    expect(symbols.querySelector('h2')?.textContent).toBe('10. 本頁符號表')
    before(container.querySelector('#papers-recap'), symbols, '符號表在「本頁必記」之後')
    before(container.querySelector('.c-recap'), symbols, '符號表在 Recap 之後')
    const tables = Array.from(container.querySelectorAll('.c-symbols'))
    expect(tables).toHaveLength(1)
    expect(symbols.contains(tables[0])).toBe(true)
    expect(tables[0].querySelectorAll('tbody tr').length).toBe(SYMBOLS.length)
    // ⑥ 頁首只留一行：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），在 §1 之前
    const link = Array.from(container.querySelectorAll('.papers-symbols-link button')).find((b) => b.textContent === '本頁符號表在最後 ↓') as HTMLButtonElement
    expect(link).toBeTruthy()
    before(link, container.querySelector('#papers-policy'), '連結在 §1 之前')
    before(container.querySelector('.papers-lead'), link, '連結在導言之後')
    expect(container.querySelectorAll('a[href="#symbols"], a[href$="#symbols"]')).toHaveLength(0)
    expect((container.textContent ?? '').split('本頁符號表在最後').length).toBe(2)
    // 按下去捲到 #symbols（jsdom 沒有 scrollIntoView，這裡裝一個替身）；符號表旁的「回到頁首」捲回導言
    const scrolled: Element[] = []
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      fireEvent.click(link)
      expect(scrolled).toEqual([symbols])
      const back = Array.from(symbols.querySelectorAll('button')).find((b) => b.textContent?.includes('回到頁首')) as HTMLButtonElement
      fireEvent.click(back)
      expect(scrolled[1]).toBe(container.querySelector('.papers-lead'))
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  }, 120000)
})
