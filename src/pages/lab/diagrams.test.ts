/** @vitest-environment jsdom */
import mermaid from 'mermaid'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import * as D from './diagrams'
import { LAB_CHARTS } from './diagrams'
import { hasMath, mathLabelCount, quotedLabels, renderProblems, unicodeMathInSource } from './diagramTestUtils'

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

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊。 */
async function flow(chart: string): Promise<{ vertices: Vertex[]; edges: Edge[] }> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

/** 某條邊的標籤（找不到就丟錯，讓測試訊息指出是哪一條）。 */
function edgeText(g: { edges: Edge[] }, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e.text ?? ''
}
/** 連線標籤開頭的正負號（可能寫成 `$-$`、`$+$`）：統一成全形「＋」與減號「−」（U+2212） */
function leadingSign(text: string): string {
  const c = text.trim().replace(/^\$/, '').charAt(0)
  return c === '+' ? '＋' : c === '-' ? '−' : c
}
const node = (g: { vertices: Vertex[] }, id: string): string => {
  const v = g.vertices.find((x) => x.id === id)
  if (!v) throw new Error(`沒有節點 ${id}`)
  return v.text ?? ''
}

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')

/** 一個公式為了讓圖窄一點被 `<br/>` 拆成兩行（`$A =$<br/>$B$`）時，接回同一個 `$A = B$` 再比對（公式本身沒有變）。 */
const joined = (s: string) => s.replace(/\$<br\s*\/?>\$/g, ' ')

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

describe('Lab 頁的方塊圖（真正的 mermaid parser）', () => {
  beforeAll(() => {
    installMermaidSvgShim()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', suppressErrorRendering: true })
  })

  it('清單：五張圖（九級訊號鏈、兩條路、更新迴路、輸出端的兩個成分、五個分頁），diagrams.ts 匯出的每張圖都在清單裡', () => {
    expect(LAB_CHARTS.map((c) => c.name)).toEqual(['PIPELINE_CHART', 'CHART_TWO_PATHS', 'CHART_UPDATE_LOOP', 'CHART_OUTPUT_SPLIT', 'CHART_TAB_MAP'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(LAB_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(LAB_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    expect(new Set(LAB_CHARTS.map((c) => c.chart)).size).toBe(LAB_CHARTS.length)
  })

  it('每一張都能解析成 flowchart；不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法；加法點的每條輸入都標了正負號', async () => {
    for (const c of LAB_CHARTS) {
      const r = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(r && typeof r === 'object' ? r.diagramType : r, c.name).toBe('flowchart-v2')
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(g.vertices.length, `${c.name} 節點數`).toBeGreaterThanOrEqual(5)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
      // 加法點 = 圓形節點、文字是全形「＋」；每條進來的邊都要以「＋」或「−」開頭（後面還有說明時，負號寫成 `$-$`）
      for (const s of g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(leadingSign(e.text ?? ''), `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
      }
    }
  }, 60_000)

  it('九級訊號鏈：圖上有九級與兩條路徑（H_PD 到 PD 的輸出再到 comparator、T 到輸出），回授由 gain register 回到 reference 端的 DTC', async () => {
    const { PIPELINE_CHART } = D
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(PIPELINE_CHART).toMatch(new RegExp(`"${n} `))
    expect(PIPELINE_CHART).toContain(R`DTC -->|"$e_{\mathrm{DTC}}[n]$"| HPD`)
    expect(PIPELINE_CHART).toContain(R`DTC -->|"$e_{\mathrm{DTC}}[n]$"| TOUT`)
    expect(PIPELINE_CHART).toContain(R`REG -->|"$w_{\mathrm{app}}$"| DTC`)
    expect(PIPELINE_CHART).toContain(R`$H_{\mathrm{PD}} = \frac{1}{1+L}$`)
    expect(PIPELINE_CHART).toContain(R`$T = \frac{L}{1+L}$`)
    const g = await flow(PIPELINE_CHART)
    // 一圈：DSM → 正規化 → DTC → H_PD → comparator → GMAC → 更新 → gain register → DTC
    const loop = ['DSM', 'NORM', 'DTC', 'HPD', 'CMP', 'GMAC', 'UPD', 'REG', 'DTC']
    for (let i = 0; i + 1 < loop.length; i++) expect(g.edges.some((e) => e.start === loop[i] && e.end === loop[i + 1]), `${loop[i]} → ${loop[i + 1]}`).toBe(true)
    // 取樣率寫在訊號名稱上：sample（[n]）與 block（_k）
    expect(edgeText(g, 'NORM', 'DTC')).toBe(R`$x[n]$`)
    // 架構（docs/assumptions.md §2a）：DTC 在 reference 輸入端；comparator 的輸入是 PD 的輸出 u_pd（第 4 級的輸出），而且只有這一條
    expect(node(g, 'DTC')).toContain('在 reference 輸入端')
    expect(node(g, 'HPD')).toContain('到 PD 的輸出')
    expect(edgeText(g, 'HPD', 'CMP')).toBe(R`PD 輸出 $u_{\mathrm{pd}}[n]$`)
    expect(g.edges.filter((e) => e.end === 'CMP').map((e) => e.start)).toEqual(['HPD'])
    expect(g.edges.some((e) => e.start === 'DTC' && (e.end === 'CMP' || e.end === 'GMAC'))).toBe(false)
    // DTC 的輸入只有 code 與校正係數（沒有任何一條線從 divider 或 PD 接進 DTC）
    expect(g.edges.filter((e) => e.end === 'DTC').map((e) => e.start).sort()).toEqual(['NORM', 'REG'])
    expect(edgeText(g, 'CMP', 'GMAC')).toBe(R`$q[n]$`)
    expect(edgeText(g, 'GMAC', 'UPD')).toBe(R`$G_k$`)
    expect(node(g, 'UPD')).toContain(R`$w_{k+1} = w_k + \mu\cdot G_k$`)
    expect(node(g, 'REG')).toContain(R`$w_{\mathrm{app}} = \mathrm{phys}(w_{k-d})$`)
    expect(node(g, 'NORM')).toContain(R`$x = (r - o)\cdot s$`)
    // regressor 走另一條線進 GMAC；輸出端不在校正迴路裡
    expect(edgeText(g, 'NORM', 'GMAC')).toContain(R`$x_{\mathrm{ref}}$`)
    expect(g.edges.some((e) => e.start === 'TOUT' && e.end !== 'OUT')).toBe(false)
    expect(PIPELINE_CHART).toMatch(/class HPD focus/)
    expect(PIPELINE_CHART).toMatch(/class TOUT alt/)
  })

  it('訊號極性與公式一致：u_pd = e_DTC − θ_fb（DTC 殘差從 PD 的 reference 輸入進來，comparator 取 PD 的輸出）、δ = a − w、G_k = K·δ_(k−d) + η_k、e_DTC = (a − w̄)·x + d(x) − δw·x', async () => {
    // §4.4（架構照 docs/assumptions.md §2a），照電路的接法畫：Reference clock → DTC → PD（＋）；VCO → divider → PD（−），回授路徑上只有 divider。
    // 加法點就是 phase detector（包在「Phase detector」的框裡）。PD 的輸出 u_pd 是一個節點：loop filter 與 comparator 都從它拉線，
    // 也就是校正迴路的輸入取自 PD 的輸出（送進 loop filter 的同一個訊號）；回授量（θ_fb）就是輸出端
    const two = await flow(D.CHART_TWO_PATHS)
    const into = (id: string) => two.edges.filter((e) => e.end === id).map((e) => e.start).sort()
    const outOf = (id: string) => two.edges.filter((e) => e.start === id).map((e) => e.end).sort()
    expect(node(two, 'E')).toContain('Reference clock → DTC')
    expect(node(two, 'E')).toContain(R`$e_{\mathrm{DTC}}[n]$`)
    expect(node(two, 'DIV')).toContain('Divider')
    expect(node(two, 'DIV')).toContain('回授路徑上只有它')
    // PD 的兩個輸入：reference 側（Reference clock → DTC，＋）與 feedback 側（divider，−）；divider 直接接進 PD
    expect(edgeText(two, 'E', 'S')).toBe('＋')
    expect(edgeText(two, 'DIV', 'S')).toBe('−')
    expect(into('S')).toEqual(['DIV', 'E'])
    expect(D.CHART_TWO_PATHS).toMatch(/subgraph PD\["Phase detector"\]\s+S\(\("＋"\)\)\s+end/)
    // 回授路徑：L（loop filter + VCO）→ divider → PD，中間沒有別的方塊；DTC 不在回授路徑上（沒有任何邊進到 E，divider 的輸出只接 PD）
    expect(edgeText(two, 'L', 'DIV')).toBe(R`$\theta_{\mathrm{fb}} = L\cdot u_{\mathrm{pd}}$`)
    expect(into('DIV')).toEqual(['L'])
    expect(outOf('DIV')).toEqual(['S'])
    expect(outOf('E')).toEqual(['S'])
    expect(into('E')).toEqual([])
    expect(node(two, 'L')).toContain('loop filter + VCO')
    expect(node(two, 'L')).not.toMatch(/DTC|[Dd]ivider/)
    // PD 唯一的輸出是 U（u_pd = e_DTC − θ_fb）；U 分給主迴路（L）與校正迴路（CMP）
    expect(node(two, 'U')).toContain('PD 的輸出')
    expect(joined(node(two, 'U'))).toContain(R`$u_{\mathrm{pd}}[n] = e_{\mathrm{DTC}} - \theta_{\mathrm{fb}}$`)
    expect(outOf('S')).toEqual(['U'])
    expect(outOf('U')).toEqual(['CMP', 'L'])
    // comparator 與 loop filter 的輸入都只來自 PD 的輸出；VCO 的輸出分給輸出端與 divider
    expect(into('CMP')).toEqual(['U'])
    expect(into('L')).toEqual(['U'])
    expect(outOf('L')).toEqual(['DIV', 'OUT'])
    expect(outOf('CMP')).toEqual([])
    // 排版靠宣告順序：前向路徑（E → S → U → L）先宣告，回授（L → DIV → S）最後，divider 才會畫在前向路徑下方接回 PD
    const order = two.edges.map((e) => `${e.start}>${e.end}`)
    expect(order.indexOf('E>S')).toBe(0)
    expect(order.slice(-2)).toEqual(['L>DIV', 'DIV>S'])
    expect(node(two, 'CMP')).toContain('comparator 取 PD 的輸出')
    // 兩條路都是正號：u_pd = +H_PD·e_DTC、t_out = +T·e_DTC（reference 側注入）
    expect(node(two, 'CMP')).toContain(R`$u_{\mathrm{pd}} = H_{\mathrm{PD}}\cdot e_{\mathrm{DTC}}$`)
    expect(D.CHART_TWO_PATHS).not.toMatch(/=\s*-\s*(H_\{\\mathrm\{PD\}\}|T)\\cdot/)
    expect(edgeText(two, 'L', 'OUT')).toBe(R`$\theta_{\mathrm{fb}}[n]$`)
    expect(node(two, 'CMP')).toContain(R`$H_{\mathrm{PD}} = \frac{1}{1+L}$`)
    expect(node(two, 'CMP')).toContain('high-pass')
    expect(node(two, 'OUT')).toContain(R`$t_{\mathrm{out}} = \theta_{\mathrm{fb}} = T\cdot e_{\mathrm{DTC}}$`)
    expect(node(two, 'OUT')).toContain(R`$T = \frac{L}{1+L}$`)
    expect(node(two, 'OUT')).toContain('low-pass')

    // §4.7：a 為正、延遲後的 w 為負；GMAC 斜率與雜訊相加；累加器之後才是延遲
    const loop = await flow(D.CHART_UPDATE_LOOP)
    expect(edgeText(loop, 'A', 'S1')).toBe('＋')
    expect(leadingSign(edgeText(loop, 'DLY', 'S1'))).toBe('−')
    expect(edgeText(loop, 'DLY', 'S1')).toContain(R`$w_{\mathrm{app}} = w_{k-d}$`)
    expect(edgeText(loop, 'S1', 'KB')).toBe(R`$\delta_{k-d} = a - w_{k-d}$`)
    expect(edgeText(loop, 'KB', 'S2')).toBe('＋')
    expect(edgeText(loop, 'ETA', 'S2')).toBe('＋')
    expect(edgeText(loop, 'S2', 'MU')).toBe(R`$G_k = K\cdot\delta_{k-d} + \eta_k$`)
    expect(edgeText(loop, 'MU', 'ACC')).toBe(R`$\mu\cdot G_k$`)
    expect(node(loop, 'ACC')).toContain(R`$\frac{1}{z-1}$`)
    expect(node(loop, 'ACC')).toContain(R`$w_{k+1} = w_k + \mu\cdot G_k$`)
    expect(edgeText(loop, 'ACC', 'DLY')).toBe(R`$w_k$`)
    expect(node(loop, 'DLY')).toContain(R`$z^{-d}$`)
    expect(node(loop, 'KB')).toContain(R`$K = K_q\cdot C$`)
    // 整圈只有一個累加器、一個延遲：sample-rate 的訊號（[n]）不出現在這張 block-rate 的圖上
    expect(D.CHART_UPDATE_LOOP).not.toMatch(/\[n\]/)

    // §4.9：靜態殘差與 d(x) 為正、gain 抖動為負；三項相加後才經過 T
    const out = await flow(D.CHART_OUTPUT_SPLIT)
    expect(edgeText(out, 'M1', 'S')).toBe('＋')
    expect(edgeText(out, 'DX', 'S')).toBe('＋')
    expect(edgeText(out, 'M2', 'S')).toBe('−')
    expect(edgeText(out, 'S', 'T')).toBe(R`$e_{\mathrm{DTC}}[n]$`)
    for (const id of ['M1', 'DX', 'M2']) expect(out.edges.some((e) => e.start === 'X' && e.end === id), `x → ${id}`).toBe(true)
    expect(node(out, 'M1')).toContain(R`$\times (a - \bar w)$`)
    expect(node(out, 'M2')).toContain(R`$\times \delta w_k$`)
    expect(node(out, 'T')).toContain(R`$T(z) = \frac{L}{1+L}$`)
    expect(joined(node(out, 'SPUR'))).toContain(R`$A_{\mathrm{spur}} = \lvert a - \bar w\rvert\cdot s\cdot A_1\cdot\lvert T(f_1)\rvert$`)
    expect(joined(node(out, 'JIT'))).toContain(R`$\mathrm{Var} \approx \sigma_w^2\cdot(\bar x^2 + \mathrm{Var}(T\{\tilde x\}))$`)
    // 輸出端不經過 H_PD
    expect(D.CHART_OUTPUT_SPLIT).not.toContain('H_{\\mathrm{PD}}')
  })

  it('五個分頁：Pipeline／FCW sweep／Monte Carlo 共用基準參數，Training 與 Compare 各有設定；五個都接到同一份核心', async () => {
    const g = await flow(D.CHART_TAB_MAP)
    for (const id of ['PIPE', 'SWEEP', 'MC']) expect(g.edges.some((e) => e.start === 'BASE' && e.end === id), id).toBe(true)
    expect(g.edges.some((e) => e.start === 'BASE' && (e.end === 'TRAIN' || e.end === 'CMPR'))).toBe(false)
    expect(g.edges.some((e) => e.start === 'OWN1' && e.end === 'TRAIN')).toBe(true)
    expect(g.edges.some((e) => e.start === 'OWN2' && e.end === 'CMPR')).toBe(true)
    const tabs = ['PIPE', 'SWEEP', 'MC', 'TRAIN', 'CMPR']
    for (const id of tabs) expect(g.edges.some((e) => e.start === id && e.end === 'CORE'), `${id} → CORE`).toBe(true)
    expect(node(g, 'CORE')).toContain('unifiedLab.ts')
    expect(node(g, 'TRAIN')).toContain('不跑迴路')
  })

  it('實際渲染（共用的 renderMermaidForTest）：沒有「Unsupported markdown」、畫出來的文字沒有 $、公式都由 KaTeX 排版、KaTeX 以外沒有 Unicode 拼的數學、節點數不超過 14', async () => {
    for (const c of LAB_CHARTS) {
      const r = await renderMermaidForTest(c.chart)
      expect(r.text, c.name).not.toMatch(/Unsupported markdown/)
      expect(r.text, c.name).not.toContain('$')
      expect(unicodeMathIn(r.plainText), `${c.name} 畫面上 KaTeX 以外的 Unicode 數學`).toEqual([])
      expect(unicodeMathInSource(c.chart), `${c.name} 原始碼 $...$ 以外的 Unicode 數學`).toEqual([])
      expect(r.mathCount, `${c.name} KaTeX 公式數`).toBe(mathLabelCount(c.chart))
      expect(r.mathCount, c.name).toBeGreaterThanOrEqual(3)
      expect(renderProblems(c.chart, r), c.name).toEqual([])
      expect(r.nodeCount, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(r.nodeCount, `${c.name} 節點數`).toBeGreaterThanOrEqual(5)
      // 每個節點與連線的標籤：含公式的就是 KaTeX，不含公式的文字原樣畫出來
      const g = await flow(c.chart)
      for (const v of g.vertices) if (!hasMath(v.text ?? '')) expect(plain(r.text).includes(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text && !hasMath(e.text)) expect(plain(r.text).includes(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
    }
  }, 120_000)

  it('圖內的數學都是 LaTeX：每張圖的每個變數標籤都含 `$...$`，且成對', () => {
    for (const c of LAB_CHARTS) {
      expect(quotedLabels(c.chart).some(hasMath), c.name).toBe(true)
      for (const label of quotedLabels(c.chart)) expect((label.match(/(?<!\\)\$/g) ?? []).length % 2, `${c.name}：「${label}」的 $ 要成對`).toBe(0)
    }
  })
})
