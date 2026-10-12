// @vitest-environment jsdom
import mermaid from 'mermaid'
import { SYSTEM_BLOCK_LABEL, systemMapModel } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import * as D from './diagrams'
import { CIRC, CONDITION_MAP_CHART, CONDITION_MAP_LEGEND, CONDITION_MAP_NAMES, DASH_CHARTS, DASH_SYSTEM_FOCUS } from './diagrams'
import { SIX_CONDITIONS } from './data'
import { CONDITION_ORDER } from './thesisModel'
import { hasMath, mathLabelCount, quotedLabels, renderProblems, unicodeMathInSource } from '../lab/diagramTestUtils'

/** 圖原始碼的 TeX 反斜線只寫一次（與 diagrams.ts 的 String.raw 相同） */
const R = String.raw

// index.test.tsx 為了速度把 mermaid mock 掉了，所以圖的語法、極性與「真的畫得出來」都在這裡用真正的 mermaid 檢查。

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

/**
 * 標籤裡每一行（以 <br/> 分隔）去掉 `$...$` 之後的寬度估計：中文字算 1、其他字元算 0.55。
 * 太長的行會把節點（尤其是菱形）撐寬，整張圖就放不進桌機的正文欄（約 900px）；含數學的標籤不會自動換行，所以要自己用 <br/> 斷行。
 */
function overlongLines(chart: string, maxUnits = 16): string[] {
  const hits: string[] = []
  for (const label of chart.match(/"[^"\n]*"/g) ?? []) {
    for (const line of label.slice(1, -1).split(/<br\s*\/?>/)) {
      const text = line.replace(/\$[^$]*\$/g, '')
      let units = 0
      for (const ch of text) units += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55
      if (units > maxUnits) hits.push(line.trim())
    }
  }
  return hits
}

describe('Dashboard 的方塊圖（真正的 mermaid）', () => {
  beforeAll(() => {
    installMermaidSvgShim()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', suppressErrorRendering: true })
  })

  it('清單：三張自己的圖 + 共用的系統地圖；diagrams.ts 匯出的每張圖都在清單裡', () => {
    expect(DASH_CHARTS.map((c) => c.name)).toEqual(['CONDITION_FLOW_CHART', 'CONDITION_MAP_CHART', 'BLOCK_EQUATION_CHART'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(DASH_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(DASH_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    expect(new Set(DASH_CHARTS.map((c) => c.chart)).size).toBe(DASH_CHARTS.length)
    // 首頁談整個系統：系統地圖把所有方塊都標成藍色
    expect(DASH_SYSTEM_FOCUS.length).toBeGreaterThanOrEqual(17)
    expect(new Set(DASH_SYSTEM_FOCUS).size).toBe(DASH_SYSTEM_FOCUS.length)
  })

  it('每一張都能真的畫出來：沒有「Unsupported markdown」、畫出來的文字沒有 $、公式都由 KaTeX 排版、KaTeX 以外沒有 Unicode 拼的數學、節點不超過 14 個、原始碼的文字都出現在圖上', async () => {
    for (const c of DASH_CHARTS) {
      const parsed = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(parsed && typeof parsed === 'object' ? parsed.diagramType : parsed, c.name).toBe('flowchart-v2')
      const r = await renderMermaidForTest(c.chart)
      const { text, nodeCount } = r
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(text, c.name).not.toContain('$')
      expect(unicodeMathIn(r.plainText), `${c.name} 畫面上 KaTeX 以外的 Unicode 數學`).toEqual([])
      expect(unicodeMathInSource(c.chart), `${c.name} 原始碼 $...$ 以外的 Unicode 數學`).toEqual([])
      expect(r.mathCount, `${c.name} KaTeX 公式數`).toBe(mathLabelCount(c.chart))
      expect(r.mathCount, c.name).toBeGreaterThanOrEqual(8)
      expect(renderProblems(c.chart, r), c.name).toEqual([])
      expect(nodeCount, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(nodeCount, `${c.name} 節點數`).toBeGreaterThanOrEqual(7)
      const shown = plain(text)
      const g = await flow(c.chart)
      // 不含公式的標籤原樣畫出來；含公式的標籤由 KaTeX 排版（renderProblems 已逐一核對它的文字部分）
      for (const v of g.vertices) if (!hasMath(v.text ?? '')) expect(shown.includes(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text && !hasMath(e.text)) expect(shown.includes(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
      // 圖中沒有裸的 ASCII 「<」（只允許 <br/>）與分號；單獨的 + / - 標籤會被 Mermaid 11 當成清單
      expect(c.chart.replace(/<br\/>/g, ''), c.name).not.toMatch(/[<;]/)
      for (const e of g.edges) expect((e.text ?? '').trim(), `${c.name} 邊 ${e.start}→${e.end}`).not.toMatch(/^[+\-*]$/)
      // 圖內的數學都是成對的 `$...$`
      expect(quotedLabels(c.chart).some(hasMath), c.name).toBe(true)
      for (const label of quotedLabels(c.chart)) expect((label.match(/(?<!\\)\$/g) ?? []).length % 2, `${c.name}：「${label}」的 $ 要成對`).toBe(0)
    }
  }, 120_000)

  it('首頁的系統地圖（共用的手排 SVG，不經過 Mermaid）：全部 17 個方塊都標成主角；標的是 DASH_SYSTEM_FOCUS，不多不少', () => {
    // 系統地圖不再由 Mermaid 畫（拓撲與版面由 src/components/SystemMap.test.tsx 檢查）；這裡只確認「首頁要標哪些方塊」
    const { blocks } = systemMapModel(DASH_SYSTEM_FOCUS)
    expect(blocks.length).toBeGreaterThanOrEqual(17)
    expect(blocks.filter((b) => b.focused).map((b) => b.id).sort()).toEqual([...DASH_SYSTEM_FOCUS].sort())
    expect(blocks.every((b) => b.focused)).toBe(true)
    expect([...DASH_SYSTEM_FOCUS].sort()).toEqual(Object.keys(SYSTEM_BLOCK_LABEL).sort())
  })

  it('版面：桌機正文欄（約 900px）放得下、不用橫向捲動——三張圖都由上到下，長標籤與菱形裡的字用 <br/> 換行；沒有過長的單行（實際尺寸由 scripts/diagram-audit.mjs 量）', async () => {
    for (const c of DASH_CHARTS) {
      expect(c.chart, c.name).toMatch(/^flowchart TB/)
      expect(overlongLines(c.chart), c.name).toEqual([])
    }
    // 條件地圖：⑥ 的膠囊接在「PLL 輸出」的下面（OUT -.- C6），不和回授的 w 交叉；其餘五個膠囊在各自方塊的上方或旁邊
    expect(CONDITION_MAP_CHART).toMatch(/OUT -\.- C6\(/)
    for (const [c, block] of [['C1', 'DSM'], ['C2', 'PLL'], ['C3', 'UPD'], ['C4', 'CMP'], ['C5', 'DTC']]) expect(CONDITION_MAP_CHART, c).toMatch(new RegExp(`${c}\\(.*\\) -\\.- ${block}`))
    // 沒有 subgraph（直向的鏈不需要折列），所以不會有「subgraph 的 direction 被忽略」的問題
    for (const c of DASH_CHARTS) expect(c.chart, c.name).not.toMatch(/subgraph/)
  })

  it('六個條件都標在圖上，圖例與 SIX_CONDITIONS 一一對應；訊號流一圈回到 DTC，GMAC 用延遲後的 code', () => {
    // 圈圈數字在含公式的標籤裡寫成 \textcircled（KaTeX 的文字模式沒有 U+2460…）
    const marks = CIRC
    expect(marks).toHaveLength(6)
    expect(marks[0]).toBe(R`$\text{\textcircled{1}}$`)
    SIX_CONDITIONS.forEach((c, i) => {
      expect(c.zh, c.id).toContain(CONDITION_MAP_NAMES[i]) // 圖上的短名稱取自條件名稱
      expect(CONDITION_MAP_CHART, c.id).toContain(`${marks[i]} ${CONDITION_MAP_NAMES[i]}`)
      expect(D.CONDITION_FLOW_CHART, c.id).toContain(`${marks[i]} ${CONDITION_MAP_NAMES[i]}`)
      expect(CONDITION_MAP_LEGEND[i].n).toBe(c.n)
    })
    expect(CONDITION_MAP_LEGEND).toHaveLength(6)
    // 圖例文字的 $…$ 成對
    for (const row of CONDITION_MAP_LEGEND) expect((row.knobs.split('$').length - 1) % 2).toBe(0)
    expect(CONDITION_MAP_CHART).toMatch(/DSM --> DTC --> PLL\n/)
    expect(CONDITION_MAP_CHART).toMatch(/CMP --> GMAC --> UPD\n/)
    expect(CONDITION_MAP_CHART).toMatch(/UPD -- ".*" --> DTC/)
    expect(CONDITION_MAP_CHART).toContain(R`$x[n-D]$`)
    expect(CONDITION_MAP_CHART).toContain(R`$G = \frac{1}{N}\sum q\cdot x[n-D]$`)
  })

  it('架構（docs/assumptions.md §2a）：DTC 在 reference 端、給的是補償量 w·x；comparator 的輸入只從 PD 的輸出（PLL error path 的輸出）拉', async () => {
    const g = await flow(CONDITION_MAP_CHART)
    // 訊號流一圈：DSM → DTC → PLL error path → comparator → GMAC → 係數更新 → 回到 DTC
    for (const [a, b] of [['DSM', 'DTC'], ['DTC', 'PLL'], ['PLL', 'CMP'], ['CMP', 'GMAC'], ['GMAC', 'UPD'], ['UPD', 'DTC']]) expect(g.edges.some((e) => e.start === a && e.end === b), `${a} → ${b}`).toBe(true)
    // DTC：標明在 reference 端；它給的是「補償量」，不再寫成插入的延遲
    expect(node(g, 'DTC')).toContain('DTC（reference 端）')
    expect(node(g, 'DTC')).toContain(R`補償量 $= w\cdot x$`)
    expect(node(g, 'DTC')).not.toContain('延遲')
    // 同一格也代表 PMUX（PHOS）；它在回授路徑上，不在 reference 端——標籤要分開註明，不能讓人讀成「reference 端的 PMUX」
    expect(node(g, 'DTC')).toContain('或 PMUX（回授端）')
    expect(node(g, 'DTC')).not.toMatch(/reference 端）\s*\/\s*PMUX/)
    // LMS 的輸入是 PD 的輸出 e[n]：comparator 的訊號輸入只有 PLL error path 那一條，而且線上標了「PD 輸出」
    expect(edgeText(g, 'PLL', 'CMP')).toBe(R`PD 輸出 $e[n]$`)
    const intoCmp = g.edges.filter((e) => e.end === 'CMP').map((e) => e.start).sort()
    expect(intoCmp).toEqual(['C4', 'PLL']) // C4 是條件 ④ 的膠囊（虛線），不是訊號
    for (const from of ['DTC', 'DSM', 'UPD', 'GMAC']) expect(g.edges.some((e) => e.start === from && e.end === 'CMP'), `${from} → CMP`).toBe(false)
    // DTC 的輸入只有 code（DSM）與係數 w（係數更新），沒有任何「經過 divider 再進 DTC」的畫法
    expect(g.edges.filter((e) => e.end === 'DTC').map((e) => e.start).sort()).toEqual(['C5', 'DSM', 'UPD'])
    expect(CONDITION_MAP_CHART).not.toMatch(/divider|Divider|DIV/)
  })

  it('檢查流程：順序就是 thesisModel 的 CONDITION_ORDER（資訊足夠 → 極性 → 穩定 → 變異 → bias → 輸出），任何一個「否」停在該格', async () => {
    expect(CONDITION_ORDER).toEqual(['identifiability', 'polarity', 'stability', 'variance', 'bias', 'system'])
    const g = await flow(D.CONDITION_FLOW_CHART)
    const q = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']
    for (let i = 0; i < 6; i++) {
      // 菱形（判斷）節點，文字含編號與條件名稱
      expect(g.vertices.find((v) => v.id === q[i])?.type, q[i]).toBe('diamond')
      expect(node(g, q[i]), q[i]).toContain(`${CIRC[i]} ${CONDITION_MAP_NAMES[i]}`)
      // 「是」往下一格（最後一格到 OK）；「否」到各自的紅色方塊
      const next = i < 5 ? q[i + 1] : 'OK'
      expect(edgeText(g, q[i], next), `${q[i]} → ${next}`).toMatch(/^是/)
      expect(edgeText(g, q[i], `F${i + 1}`), `${q[i]} → F${i + 1}`).toBe('否')
    }
    // 判據：C 先於 g（g = μ·K_q·C）、g 先於 σ_w 與 B/C、兩者先於輸出
    expect(node(g, 'Q2')).toContain(R`$C = E[x\cdot u] \gt 0$`)
    expect(node(g, 'Q3')).toContain(R`$g = \mu\cdot K_q\cdot C$`)
    expect(node(g, 'Q3')).toContain(R`$0 \lt g \lt g^*(d)$`)
    expect(node(g, 'Q5')).toContain(R`$w^* - a = B/C$`)
    expect(D.CONDITION_FLOW_CHART).toMatch(/class F1,F2,F3,F4,F5,F6 warn/)
    expect(D.CONDITION_FLOW_CHART).toMatch(/class OK ok/)
  })

  it('block 方程式：δ_k = a − w_k（a 為＋、回授的 w_k 為−）、G_k = K_q·(C·δ_k + B) + η_k、w_(k+1) = w_k + μ·G_k', async () => {
    const g = await flow(D.BLOCK_EQUATION_CHART)
    // 加法點 = 圓形節點；每條進來的邊都標了正負號
    const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')
    expect(sums.map((s) => s.id).sort()).toEqual(['S1', 'S2', 'S3'])
    for (const s of sums) {
      const incoming = g.edges.filter((e) => e.end === s.id)
      expect(incoming.length, s.id).toBe(2)
      for (const e of incoming) expect(leadingSign(e.text ?? ''), `${e.start} → ${s.id}`).toMatch(/^[＋−]/)
    }
    expect(edgeText(g, 'A', 'S1')).toBe('＋')
    expect(edgeText(g, 'ACC', 'S1')).toMatch(/^\$-\$.*\$w_k\$/)
    expect(edgeText(g, 'S1', 'CC')).toBe(R`$\delta_k = a - w_k$`)
    expect(edgeText(g, 'CC', 'S2')).toBe('＋')
    expect(edgeText(g, 'BB', 'S2')).toBe('＋')
    expect(edgeText(g, 'S2', 'KQ')).toBe(R`$C\cdot\delta_k + B$`)
    expect(edgeText(g, 'KQ', 'S3')).toBe('＋')
    expect(edgeText(g, 'ETA', 'S3')).toBe('＋')
    expect(edgeText(g, 'S3', 'MU')).toBe(R`$G_k = K_q\cdot(C\cdot\delta_k + B) + \eta_k$`)
    expect(edgeText(g, 'MU', 'ACC')).toBe(R`$\mu\cdot G_k$`)
    expect(node(g, 'ACC')).toContain(R`$\frac{1}{z-1}$`)
    expect(node(g, 'ACC')).toContain(R`$w_{k+1} = w_k + \mu\cdot G_k$`)
    expect(node(g, 'KQ')).toContain(R`$K_q = \sqrt{2/\pi}/\sigma_v$`)
    // block rate：圖上只有 k，沒有 sample 的 [n]
    expect(D.BLOCK_EQUATION_CHART).not.toMatch(/\[n\]/)
    // 三個藍色方塊相乘 = loop gain g = μ·K_q·C；棕色的 B 是 bias 的來源
    expect(D.BLOCK_EQUATION_CHART).toMatch(/class CC,KQ,MU focus/)
    expect(D.BLOCK_EQUATION_CHART).toMatch(/class BB alt/)
  })
})
