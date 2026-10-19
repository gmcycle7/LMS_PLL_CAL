import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mermaid from 'mermaid'
import { SYSTEM_BLOCK_LABEL, defaultValues, systemMapModel } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import type { PresetEntry } from '@/data/types'
import {
  DEFAULT_CAL_SM,
  calPhaseMarginDeg,
  finalCostDerivative,
  gMaxForPm,
  msdAfterBlocks,
  optimizeMu,
  runCalStateMachine,
  type CalSmParams,
} from '@/simulation/models/optimizer'
import Chapter14 from './index'
import * as D from './diagrams'
import { CH14_CHARTS, CH14_SYSTEM_FOCUS } from './diagrams'
import { HANDCALCS } from './handcalcs'
import { LESSON_MODEL } from './sections/S3Objectives'
import { renderPage } from '@/test/renderPage'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
// 頁面測試用的 Mermaid 元件替身：把原始碼放在 data-chart，方便核對「頁面上到底畫了哪些圖、順序為何」。
// （章首的 SystemMap 是手排的 SVG、不經過 Mermaid 元件，所以它不是替身畫的，而是真的元件：figure.c-sysmap，沒有 data-chart。
//  真正的 mermaid 套件沒有被 mock，下面照樣用它解析與渲染。）
vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  return {
    Mermaid: ({ chart, caption }: { chart: string; caption?: string }) =>
      createElement('figure', { className: 'c-mermaid', 'data-chart': chart }, caption ? createElement('figcaption', { className: 'c-figcaption' }, caption) : null),
    renderMermaid: async () => '<svg></svg>',
  }
})

beforeAll(installMermaidSvgShim)
afterEach(() => localStorage.clear())

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

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊（stateDiagram 回傳 null）。 */
async function flow(chart: string): Promise<{ vertices: Vertex[]; edges: Edge[] } | null> {
  await mermaid.parse(chart) // 先讓 mermaid 載入圖種類（單獨跑一個測試時，getDiagramFromText 才認得 flowchart／stateDiagram）
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices?: () => Map<string, Vertex>; getEdges?: () => Edge[] }
  if (typeof db.getVertices !== 'function' || typeof db.getEdges !== 'function') return null
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

const chartOf = (name: string): string => {
  const c = CH14_CHARTS.find((x) => x.name === name)
  if (!c) throw new Error(`找不到 ${name}`)
  return c.chart
}

/** 某條邊的標籤（找不到就丟錯，讓測試訊息指出是哪一條）。 */
function edgeText(g: { edges: Edge[] }, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e.text ?? ''
}

/** 子圖（subgraph）裡有哪些節點：{ 子圖 id: 排序後的節點 id }。 */
async function subgraphNodes(chart: string): Promise<Record<string, string[]>> {
  await mermaid.parse(chart)
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getSubGraphs?: () => { id: string; nodes: string[] }[] }
  const out: Record<string, string[]> = {}
  for (const sg of db.getSubGraphs?.() ?? []) out[sg.id] = [...sg.nodes].sort()
  return out
}

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼（&gt; 等）。 */
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

describe('Ch14 Mermaid 圖：清單', () => {
  it('共 24 張圖（22 張新圖 + 規格原圖 + 本站實作圖），加上章首 SystemMap 共 25 張', () => {
    expect(CH14_CHARTS.length).toBe(24)
    expect(new Set(CH14_CHARTS.map((c) => c.name)).size).toBe(24)
    expect(new Set(CH14_CHARTS.map((c) => c.chart)).size).toBe(24)
    expect(CH14_CHARTS.filter((c) => c.name.startsWith('CHART_')).length).toBe(22)
    // diagrams.ts 匯出的每一個 Mermaid 原始碼都在清單裡（沒有漏掉沒測到的圖）
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(CH14_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(chartOf(k)).toBe(v)
    // 每一小節至少一張
    for (const s of ['§14.0', '§14.1', '§14.2', '§14.3', '§14.4', '§14.5', '§14.6', '§14.7', '綜合手算']) {
      expect(CH14_CHARTS.some((c) => c.section.startsWith(s)), s).toBe(true)
    }
    // 圖的種類：數學模型、演算法迴圈、路徑／取樣率、比較、流程、手算流程、狀態機都有
    for (const kind of ['數學模型', '演算法迴圈', '路徑／取樣率', '比較', '流程', '手算流程', '狀態機']) {
      expect(CH14_CHARTS.some((c) => c.kind === kind), kind).toBe(true)
    }
  })

  it('實作圖涵蓋所有狀態', () => {
    for (const s of ['RESET', 'LOCK', 'COARSE', 'VERIFY', 'FINE', 'TRACK', 'FREEZE', 'RESTART', 'FAULT']) expect(D.IMPL_CHART).toContain(s)
  })
})

describe('Ch14 Mermaid 圖（真正的 mermaid parser）', () => {
  it('每一張都能解析（章首系統地圖是手排的 SVG，不經過 Mermaid，見下面的頁面測試）', async () => {
    for (const c of CH14_CHARTS) {
      const r = await mermaid.parse(c.chart)
      const type = r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : ''
      expect(type, c.name).toMatch(c.name === 'CHART_ALARM_HYSTERESIS' ? /^stateDiagram/ : /^flowchart/)
    }
  }, 60000)

  it('每張 flowchart 不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法；加法點的每條輸入都標了正負號', async () => {
    for (const c of CH14_CHARTS) {
      const g = await flow(c.chart)
      if (!g) {
        expect(c.name).toBe('CHART_ALARM_HYSTERESIS')
        // stateDiagram：3 個狀態（外加起點／終點）
        expect((c.chart.match(/^\s*state "/gm) ?? []).length).toBe(3)
        for (const line of c.chart.split('\n')) expect(labelHazard(line.split(' : ')[1] ?? ''), line).toBeNull()
        continue
      }
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(g.vertices.length, `${c.name} 節點數`).toBeGreaterThanOrEqual(4)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
      // 加法點 = 圓形節點、文字是全形「＋」；每條進來的邊都要以「＋」或「−」開頭（純正負號照舊用全形字元；和文字、公式混在一起時寫 `$+$`、`$-$`）
      const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')
      for (const s of sums) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^(?:[＋−]|\$[+-]\$)/)
      }
    }
  }, 60000)

  it('桌機版面（teaching-style §8）：橫向（LR）的圖最多 5 個 rank，由上往下的圖每一排最多 5 個方塊；太長的橫向流程已改成直向或折成列', async () => {
    // jsdom 量不到真正的像素寬度，但「最長路徑有幾個 rank」「同一個 rank 有幾個方塊」不受字體影響（長邊先分層，回授邊略過）。
    // 實際的像素寬度以 `node scripts/diagram-audit.mjs --routes /ch/14` 為準（1280px 桌機上每張圖的「超出」都要是 0）。
    const layers = (g: { vertices: Vertex[]; edges: Edge[] }) => {
      const out = new Map<string, string[]>()
      for (const e of g.edges) out.set(e.start, [...(out.get(e.start) ?? []), e.end])
      const rank = new Map<string, number>()
      const onPath = new Set<string>()
      const visit = (v: string): number => {
        if (rank.has(v)) return rank.get(v)!
        onPath.add(v)
        let best = 0
        for (const w of out.get(v) ?? []) if (!onPath.has(w)) best = Math.max(best, 1 + visit(w))
        onPath.delete(v)
        rank.set(v, best) // 離終點最遠的距離（回授邊跳過，所以不會無窮遞迴）
        return best
      }
      for (const v of g.vertices) visit(v.id)
      const widest = new Map<number, number>()
      for (const r of rank.values()) widest.set(r, (widest.get(r) ?? 0) + 1)
      return { ranks: Math.max(...rank.values()) + 1, widest: Math.max(...widest.values()) }
    }
    const bad: string[] = []
    for (const c of CH14_CHARTS) {
      const g = await flow(c.chart)
      if (!g) continue // stateDiagram：只有 3 個狀態，另行檢查方向
      const { ranks, widest } = layers(g)
      if (/^flowchart LR/.test(c.chart) && ranks > 5) bad.push(`${c.name}：LR 有 ${ranks} 個 rank，桌機放不下，請改成 TB 或折成列`)
      if (/^flowchart T[BD]/.test(c.chart) && widest > 5) bad.push(`${c.name}：同一排有 ${widest} 個方塊，桌機放不下，請拆成兩排`)
    }
    expect(bad).toEqual([])
    // 這次改成直向（或折成列）的圖：方向寫在原始碼第一行，圖說與導讀的「由上到下」要跟著對
    for (const name of ['CHART_CAL_LOOP', 'CHART_MSD_SPLIT', 'CHART_POLE_REGIMES', 'CHART_SCHEDULE_TIMELINE', 'SPEC_CHART']) expect(chartOf(name), name).toMatch(/^flowchart TB/)
    expect(D.CHART_ALARM_HYSTERESIS).toMatch(/^stateDiagram-v2\s+direction TB/)
    // 折成兩排的 pole 圖：兩個列子圖各自是 LR（而且列內的節點沒有和列外的節點直接連線，否則 direction 會被忽略）
    expect((D.CHART_POLE_REGIMES.match(/^\s+direction LR$/gm) ?? []).length).toBe(2)
  }, 60000)

  it('訊號極性與公式一致：δ = a − w、δ_B = p^B·δ₀ − μΣp^(B−1−k)η_k、H(z) = μ/(z − p)、1/P 累加、K̂ 的差分方向（標籤是 `$...$` 的 LaTeX 原始碼）', async () => {
    // §14.0：a 進加法點為正、回授 w_k 為負；G_k = K·δ_k + η_k；累加器 w_(k+1) = w_k + μ·G_k
    const loop = (await flow(D.CHART_CAL_LOOP))!
    expect(edgeText(loop, 'A', 'S1')).toBe('＋')
    expect(edgeText(loop, 'ACC', 'S1')).toMatch(/^\$-\$.*\$w_k\$/)
    expect(edgeText(loop, 'S1', 'KB')).toBe(String.raw`$\delta_k = a - w_k$`)
    expect(edgeText(loop, 'KB', 'S2')).toBe('＋')
    expect(edgeText(loop, 'ETA', 'S2')).toBe('＋')
    expect(edgeText(loop, 'S2', 'MU')).toBe(String.raw`$G_k = K\,\delta_k + \eta_k$`)
    expect(edgeText(loop, 'MU', 'ACC')).toBe(String.raw`$\mu\,G_k$`)
    const acc = loop.vertices.find((v) => v.id === 'ACC')?.text ?? ''
    expect(acc).toContain('$1/(z-1)$')
    expect(acc).toContain(String.raw`$w_{k+1} = w_k + \mu\,G_k$`)

    // 先備知識：e = δ + v（兩條輸入都是正號）→ sign → 取平均 E[q] = erf(δ/(√2σ_v)) = 2Φ(δ/σ_v) − 1；線性區斜率 K_q = √(2/π)/σ_v
    const cg = (await flow(D.CHART_COMPARATOR_GAIN))!
    expect(edgeText(cg, 'D', 'S')).toBe('＋')
    expect(edgeText(cg, 'V', 'S')).toBe('＋')
    expect(edgeText(cg, 'S', 'Q')).toBe(String.raw`$e = \delta + v$`)
    expect(cg.vertices.find((v) => v.id === 'Q')?.text).toContain(String.raw`$q = \mathrm{sign}(e) = \pm 1$`)
    expect(cg.vertices.find((v) => v.id === 'M')?.text).toContain(String.raw`$E[q] = \mathrm{erf}(\delta/(\sqrt{2}\,\sigma_v)) = 2\Phi(\delta/\sigma_v) - 1$`)
    expect(cg.vertices.find((v) => v.id === 'LIN')?.text).toContain(String.raw`$K_q = \sqrt{2/\pi}/\sigma_v$`)
    expect(cg.vertices.find((v) => v.id === 'LIN')?.text).toContain(String.raw`$E[q] \approx K_q\,\delta$`)
    expect(cg.edges.some((e) => e.start === 'M' && e.end === 'LIN')).toBe(true)
    expect(cg.edges.some((e) => e.start === 'M' && e.end === 'SAT')).toBe(true)

    // §14.1：sample rate 做 e[n] ≈ δ_k·u[n] + v[n]（兩條輸入都是正號；w 逐 block 更新、誤差路徑有記憶，所以是 ≈，技術審查 R06b）、
    // sign 與乘 code，block rate 才平均與更新；虛線回授 δ_k = a − w_k
    const s2b = (await flow(D.CHART_SAMPLE_TO_BLOCK))!
    expect(edgeText(s2b, 'PROD', 'SUMV')).toBe('＋')
    expect(edgeText(s2b, 'VN', 'SUMV')).toBe('＋')
    expect(edgeText(s2b, 'SUMV', 'CMP')).toBe(String.raw`PD 輸出 $e[n] \approx \delta_k\,u[n] + v[n]$`)
    expect(edgeText(s2b, 'PATH', 'PROD')).toBe('$u[n]$')
    expect(s2b.edges.some((e) => e.start === 'XC' && e.end === 'PATH')).toBe(true)
    expect(s2b.edges.some((e) => e.start === 'XC' && e.end === 'MUL')).toBe(true)
    expect(s2b.vertices.find((v) => v.id === 'PATH')?.text).toContain(String.raw`$u[n] = c\,x[n] + s\,x[n-1]$`)
    expect(s2b.vertices.find((v) => v.id === 'MUL')?.text).toBe(String.raw`$\times$`) // 乘法點
    expect(D.CHART_SAMPLE_TO_BLOCK).toContain(String.raw`$q[n] = \mathrm{sign}(e[n])$`)
    expect(D.CHART_SAMPLE_TO_BLOCK).toContain(String.raw`$G_k = (1/N)\sum q[n]\,x[n]$`)
    expect(edgeText(s2b, 'AVG', 'UPD')).toBe(String.raw`$G_k \approx K\,\delta_k + \eta_k$`)
    expect(edgeText(s2b, 'UPD', 'PROD')).toContain(String.raw`$\delta_k = a - w_k$`)
    expect(D.CHART_SAMPLE_TO_BLOCK).toMatch(/subgraph FS\["sample rate[^\n]*索引 \$n\$[^\n]*\n(?:.*\n)*?\s*end\n\s*subgraph FU\["block rate[^\n]*索引 \$k\$[^\n]*\$f_u = f_s\/N\$/)
    // 取樣率：e、q 在 sample rate 子圖；G_k 與 w 的更新在 block rate 子圖
    const inSub = (name: string) => {
      const m = D.CHART_SAMPLE_TO_BLOCK.match(new RegExp(`subgraph ${name}\\[[^\\n]*\\n([\\s\\S]*?)\\n  end`))
      return m ? m[1] : ''
    }
    for (const id of ['XC', 'PATH', 'PROD', 'SUMV', 'VN', 'CMP', 'MUL', 'LF']) expect(inSub('FS'), id).toMatch(new RegExp(`\\b${id}\\b`))
    for (const id of ['AVG', 'UPD']) expect(inSub('FU'), id).toMatch(new RegExp(`\\b${id}\\b`))

    // §14.1：bias 那條路為正，雜訊那條路以負號併入（δ_{k+1} = pδ_k − μη_k）
    const msd = (await flow(D.CHART_MSD_SPLIT))!
    expect(edgeText(msd, 'PB', 'SUM')).toBe('＋')
    expect(edgeText(msd, 'WGT', 'SUM')).toBe('−')
    expect(D.CHART_MSD_SPLIT).toContain(String.raw`$\text{bias}^2 = \delta_0^2\,p^{2B}$`)
    expect(D.CHART_MSD_SPLIT).toContain(String.raw`$\text{variance} = \mu^2\sigma_\eta^2\,(1 - p^{2B})/(1 - p^2)$`)
    expect(D.CHART_MSD_SPLIT).toContain(String.raw`$\times\,\mu\,p^{B-1-k}$`)
    expect(D.CHART_MSD_SPLIT).toContain(String.raw`$\eta_0, \ldots, \eta_{B-1}$`)

    // §14.2 (d)：前饋 × μ、回授 z⁻¹ → × p → 加法點，兩條輸入都是正的
    const ns = (await flow(D.CHART_NOISE_SHAPING))!
    expect(edgeText(ns, 'MU', 'SUM')).toBe('＋')
    expect(edgeText(ns, 'PP', 'SUM')).toBe('＋')
    expect(ns.edges.some((e) => e.start === 'SUM' && e.end === 'ZD')).toBe(true)
    expect(ns.edges.some((e) => e.start === 'ZD' && e.end === 'PP')).toBe(true)
    expect(edgeText(ns, 'ZD', 'PSD')).toContain('$w_k - a$')
    expect(ns.vertices.find((v) => v.id === 'ZD')?.text).toContain('$z^{-1}$')
    expect(D.CHART_NOISE_SHAPING).toContain(String.raw`$H(z) = \mu/(z - p)$`)

    // §14.2 (a)、(e)：成本是兩項相加
    for (const chart of [D.CHART_DESIGN_FLOW, D.CHART_TRACKING_TRADEOFF]) {
      const g = (await flow(chart))!
      expect(g.edges.filter((e) => e.end === 'JS').map((e) => e.text)).toEqual(['＋', '＋'])
    }
    expect(D.CHART_TRACKING_TRADEOFF).toContain(String.raw`$(r/(\mu K))^2$`)
    expect(D.CHART_TRACKING_TRADEOFF).toContain(String.raw`$\sigma_\zeta^2/(2\mu K)$`)
    expect(D.CHART_TRACKING_TRADEOFF).toContain(String.raw`$\mu\,\sigma_\eta^2/(2K)$`)

    // §14.1：g = μK 從 0 往上加，p = 1 − g 依序經過 1、(0,1)、0、(−1,0)、−1、< −1；每個方塊的 PM = 90° − arcsin(g/2)
    const pole = (await flow(D.CHART_POLE_REGIMES))!
    // 六個區段折成兩排（上排 R0→R1→R2、下排 R3→R4→R5）；排與排之間用子圖層級的箭頭（ROW1 → ROW2）相接，等於 R2 → R3，每一步都標「g 增加」
    const rows = await subgraphNodes(D.CHART_POLE_REGIMES)
    expect(rows.ROW1, '上排').toEqual(['R0', 'R1', 'R2'])
    expect(rows.ROW2, '下排').toEqual(['R3', 'R4', 'R5'])
    for (const [a, b] of [['R0', 'R1'], ['R1', 'R2'], ['ROW1', 'ROW2'], ['R3', 'R4'], ['R4', 'R5']]) expect(edgeText(pole, a, b), `${a}→${b}`).toBe('$g$ 增加')
    expect(pole.edges.length, '只有這五條箭頭（沒有跨排的節點對節點連線，否則子圖的 direction LR 會失效）').toBe(5)
    const poleTxt = (id: string) => pole.vertices.find((v) => v.id === id)?.text ?? ''
    expect(poleTxt('R0')).toContain(String.raw`$g = 0 \Rightarrow p = 1$`)
    expect(poleTxt('R2')).toContain(String.raw`$g = 1 \Rightarrow p = 0$`)
    expect(poleTxt('R2')).toContain(`$PM = ${calPhaseMarginDeg(1).toFixed(0)}^\\circ$`)
    expect(poleTxt('R2')).toContain('$\\mu = 1/K$')
    expect(poleTxt('R4')).toContain(String.raw`$g = 2 \Rightarrow p = -1$`)
    expect(poleTxt('R4')).toContain(`$PM = ${(90 - Math.asin(1) * (180 / Math.PI)).toFixed(0)}^\\circ$`)
    expect(poleTxt('R5')).toContain(String.raw`$g$ 大於 $2 \Rightarrow$ $p$ 小於 $-1$`)
    expect(calPhaseMarginDeg(1)).toBeCloseTo(60, 10)
    expect(calPhaseMarginDeg(0.5)).toBeGreaterThan(60) // R1：g 在 0 與 1 之間 ⇒ PM 大於 60°
    expect(calPhaseMarginDeg(1.5)).toBeLessThan(60) // R3：g 在 1 與 2 之間 ⇒ PM 小於 60°
    expect(calPhaseMarginDeg(1.5)).toBeGreaterThan(0)
    expect(poleTxt('R1')).toContain(String.raw`$PM$ 大於 $60^\circ$`)
    expect(poleTxt('R3')).toContain(String.raw`$PM$ 小於 $60^\circ$`)
    expect(poleTxt('R1')).toContain('$g$ 在 $0$ 與 $1$ 之間')
    expect(poleTxt('R3')).toContain('$g$ 在 $1$ 與 $2$ 之間')
    expect(poleTxt('R3')).toContain('$p$ 在 $-1$ 與 $0$ 之間')

    // §14.2 (f)：回授為負、開迴路 L(z) = g/(z−1)、|L| = 1 ⇒ sin(ω_c/2) = g/2、PM = 90° − arcsin(g/2) ≥ PM_t ⇔ g ≤ 2cos PM_t
    const pm = (await flow(D.CHART_PM_LOOP))!
    expect(edgeText(pm, 'A', 'S')).toBe('＋')
    expect(edgeText(pm, 'INT', 'S')).toMatch(/^\$-\$.*\$w_k\$/)
    expect(edgeText(pm, 'S', 'GK')).toBe(String.raw`$\delta_k = a - w_k$`)
    expect(pm.edges.some((e) => e.start === 'GK' && e.end === 'INT')).toBe(true)
    const pmTxt = (id: string) => pm.vertices.find((v) => v.id === id)?.text ?? ''
    expect(pmTxt('GK')).toContain(String.raw`$g = \mu K$`)
    expect(pmTxt('INT')).toContain('$1/(z-1)$')
    expect(pmTxt('LZ')).toContain('$L(z) = g/(z-1)$')
    expect(pmTxt('WC')).toContain(String.raw`$\Rightarrow \sin(\omega_c/2) = g/2$`)
    expect(pmTxt('PMN')).toContain(String.raw`$PM = 180^\circ + \angle L = 90^\circ - \arcsin(g/2)$`)
    expect(pmTxt('LIM')).toContain(String.raw`$\Leftrightarrow g \le g_{\max} = 2\cos PM_t$`)
    expect(pmTxt('MAXMU')).toContain(String.raw`$PM_t = 60^\circ \Rightarrow g_{\max} = 1$`)
    expect(pmTxt('MAXMU')).toContain(String.raw`$\Leftrightarrow \mu \le 1/K$`)
    // 數值：g_max = 2cos PM_t 時 PM 剛好等於 PM_t（PM_t = 60° ⇒ g_max = 1）
    for (const t of [45, 60, 75]) {
      const gmax = gMaxForPm(t)
      expect(gmax).toBeCloseTo(2 * Math.cos((t * Math.PI) / 180), 12)
      expect(calPhaseMarginDeg(gmax)).toBeCloseTo(t, 8)
    }
    expect(gMaxForPm(60)).toBe(1)
    expect(calPhaseMarginDeg(2)).toBeCloseTo(0, 10)
    expect(pmTxt('EDGE')).toContain(String.raw`$g = 2$：$PM = 0^\circ$`)

    // §14.6：資訊累加器 1/P_(k+1) = 1/P_k + K²/σ_η²
    const kal = (await flow(D.CHART_KALMAN_INFO))!
    expect(edgeText(kal, 'INF', 'SUM')).toBe('＋')
    expect(edgeText(kal, 'ZD', 'SUM')).toMatch(/^\$\+\$.*\$1\/P_k\$/)
    expect(edgeText(kal, 'SUM', 'ZD')).toBe(String.raw`$1/P_{k+1} = 1/P_k + K^2/\sigma_\eta^2$`)

    // §14.5、§14.7：w↑ ⇒ δ↓ ⇒ G↓，所以 K̂ = (Ḡ(−Δ) − Ḡ(+Δ))/(2Δ)
    for (const chart of [D.CHART_SLOPE_MEASURE, D.CHART_VERIFY_DECISION]) expect(chart).toContain(String.raw`$\hat K = (\bar G(-\Delta) - \bar G(+\Delta))/(2\Delta)$`)
    expect(D.CHART_VERIFY_DECISION).toContain(String.raw`$\hat\delta = \tfrac{1}{2}(\bar G(+\Delta) + \bar G(-\Delta))/\hat K$`)
    // 量測的兩步：先 w̄ + Δ 得 Ḡ(+Δ)，再 w̄ − Δ 得 Ḡ(−Δ)
    const slope = (await flow(D.CHART_SLOPE_MEASURE))!
    const slopeTxt = (id: string) => slope.vertices.find((v) => v.id === id)?.text ?? ''
    expect(slopeTxt('M2')).toContain(String.raw`$\bar w + \Delta$`)
    expect(slopeTxt('M2')).toContain(String.raw`$\bar G(+\Delta)$`)
    expect(slopeTxt('M3')).toContain(String.raw`$\bar w - \Delta$`)
    expect(slopeTxt('M3')).toContain(String.raw`$\bar G(-\Delta)$`)
    expect(slopeTxt('M4')).toContain(String.raw`$\mathrm{se} = \sigma_\eta/(\Delta\sqrt{2M})$`)
    expect(slopeTxt('M6')).toContain(String.raw`$K_{\min} = \min(\hat K_i - z\,\mathrm{se}_i)$`)
    expect(slopeTxt('M6')).toContain(String.raw`$K_{\max} = \max(\hat K_i + z\,\mathrm{se}_i)$`)

    // §14.5：下限由 K_min、上限由 K_max
    const corner = (await flow(D.CHART_CORNER_FLOW))!
    expect(corner.edges.some((e) => e.start === 'KMIN' && e.end === 'LO')).toBe(true)
    expect(corner.edges.some((e) => e.start === 'KMAX' && e.end === 'HI')).toBe(true)
    expect(corner.vertices.find((v) => v.id === 'POL')?.text).toContain(String.raw`$K_i \gt 0$`)
    expect(corner.vertices.find((v) => v.id === 'LO')?.text).toContain(String.raw`$\mu_{\min} = (1 - \epsilon^{1/B})/K_{\min}$`)
    expect(corner.vertices.find((v) => v.id === 'HI')?.text).toContain(String.raw`$\mu_{\max} = 1/K_{\max}$`)
    expect(corner.vertices.find((v) => v.id === 'CMP')?.text).toContain(String.raw`$B \ge \ln\epsilon / \ln(1 - K_{\min}/K_{\max})$`)
    expect(corner.vertices.find((v) => v.id === 'CMP')?.text).toContain(String.raw`$\mu_{\min} \le \mu_{\max}$`)

    // §14.7：stateDiagram 的標籤也是 LaTeX：計數 = 0、計數 ≥ 1、連續 n 個 block
    expect(D.CHART_ALARM_HYSTERESIS).toContain(String.raw`state "安靜（計數 $= 0$）" as QUIET`)
    expect(D.CHART_ALARM_HYSTERESIS).toContain(String.raw`state "累計中（計數 $\ge 1$）" as COUNTING`)
    expect(D.CHART_ALARM_HYSTERESIS).toContain(String.raw`COUNTING --> RESTART : $$\text{計數達到 }n\text{ 個 block}$$`)
  }, 60000)

  it('本站實作圖的每條箭頭都是 calStep 真的會走的轉移；所有 optimizer-sm-* 情境走過的轉移都畫在圖上', async () => {
    const g = (await flow(D.IMPL_CHART))!
    const drawn = new Set(g.edges.map((e) => `${e.start} → ${e.end}`))
    // 圖上的 15 條箭頭（實線 11 條、虛線 4 條）
    expect([...drawn].sort()).toEqual(
      [
        'RESET → LOCK',
        'LOCK → COARSE',
        'COARSE → VERIFY',
        'VERIFY → FINE',
        'VERIFY → COARSE',
        'VERIFY → FAULT',
        'FINE → TRACK',
        'TRACK → FREEZE',
        'FREEZE → TRACK',
        'TRACK → RESTART',
        'RESTART → COARSE',
        'TRACK → LOCK',
        'LOCK → VERIFY',
        'COARSE → RESTART',
        'COARSE → FAULT',
      ].sort(),
    )
    // 兩條為了排版而改過標籤的邊：clip 的虛線（註解「以 COARSE 為例」改放圖說）仍標明條件；暫停 guard 的條件在「是」那條邊上
    expect(edgeText(g, 'COARSE', 'RESTART')).toMatch(/clip.*連續 \$n\$ 個 block 卡在邊界.*LKG/)
    const guard = (await flow(D.CHART_GUARD_ORDER))!
    expect(edgeText(guard, 'G2', 'FZ')).toMatch(/^是：低雜訊模式，或.*bad-FCW 且 policy = freeze$/)
    expect(guard.vertices.find((v) => v.id === 'G2')?.text).toContain('有人要求暫停嗎')
    // 程式實際走過的轉移（state 事件的訊息是「A → B」）：預設情境與每個 optimizer-sm-* preset
    const dir = resolve(process.cwd(), 'src/data/presets')
    const presets = readdirSync(dir)
      .filter((f) => f.startsWith('optimizer-sm-') && f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as PresetEntry)
    expect(presets.length).toBeGreaterThanOrEqual(7)
    const walked = new Set<string>()
    const kinds = new Set<string>()
    for (const cfg of [{}, ...presets.map((pr) => pr.params as Partial<CalSmParams>)]) {
      const res = runCalStateMachine({ ...DEFAULT_CAL_SM, ...cfg })
      for (const e of res.events) {
        kinds.add(e.kind)
        if (e.kind === 'state') walked.add(e.msg)
      }
    }
    for (const t of walked) expect(drawn.has(t), `程式走了「${t}」，但圖上沒有這條箭頭`).toBe(true)
    // 主線與主要例外路徑都被某個情境真的走過（圖不是畫好看的）。guard 觸發的「任何狀態 → LOCK／FREEZE」不寫 state 事件，改看 lock／freeze 事件。
    for (const t of ['RESET → LOCK', 'LOCK → COARSE', 'COARSE → VERIFY', 'VERIFY → FINE', 'FINE → TRACK', 'FREEZE → TRACK', 'TRACK → RESTART', 'RESTART → COARSE', 'COARSE → FAULT']) {
      expect(walked.has(t), `沒有任何 preset 走過「${t}」`).toBe(true)
    }
    for (const kind of ['lock', 'freeze', 'alarm', 'clip', 'fault']) expect(kinds.has(kind), `沒有任何 preset 觸發「${kind}」事件`).toBe(true)
  }, 60000)

  it('圖上寫死的數字與模型一致（第 10 課條件；HC-14.8 的預設答案）', () => {
    const m = LESSON_MODEL
    // CHART_CALC_VERIFY：B = 32；α = 11.20 時 RMS 0.449、pole 0.9106、PM 87.4°；該點 dJ/dμ > 0，真正的 μ* 略小於 11.20
    expect(m.B).toBe(131072 / 4096)
    expect(D.CHART_CALC_VERIFY).toContain(`B = T/N = ${m.B}`)
    const g = 11.2 * m.K
    expect(D.CHART_CALC_VERIFY).toContain(`${Math.sqrt(msdAfterBlocks(m.delta0, 1 - g, 11.2, m.sigmaEta2, m.B)).toFixed(3)}\\,\\mathrm{fs}`)
    expect(D.CHART_CALC_VERIFY).toContain((1 - g).toFixed(4))
    expect(D.CHART_CALC_VERIFY).toContain(`${calPhaseMarginDeg(g).toFixed(1)}^\\circ`)
    expect(D.CHART_CALC_VERIFY).toContain(String.raw`$\alpha = 11.20\,\mathrm{fs}$`)
    expect(finalCostDerivative(11.2, m)).toBeGreaterThan(0)
    const best = optimizeMu('final', m).mu
    expect(best).toBeLessThan(11.2)
    expect(best).toBeGreaterThan(0.9 * 11.2)

    // CHART_HAND_FLOW：預設值的五個答案就是 HC-14.8 的 solve() 結果
    const def = HANDCALCS.find((h) => h.id === 'HC-14.8')!
    const sol = def.solve(defaultValues(def))
    const val = (symbol: string) => {
      const r = sol.results.find((x) => x.symbol === symbol)
      if (!r) throw new Error(`HC-14.8 沒有 ${symbol}`)
      return r.value
    }
    expect(D.CHART_HAND_FLOW).toContain(`\\mu = ${val(String.raw`\mu`).toFixed(2)}\\,\\mathrm{fs}`)
    expect(D.CHART_HAND_FLOW).toContain(`p = ${val('p').toFixed(4)}`)
    expect(D.CHART_HAND_FLOW).toContain(`PM = ${val('PM').toFixed(1)}^\\circ`)
    expect(D.CHART_HAND_FLOW).toContain(`\\tau = ${val(String.raw`\tau`).toFixed(2)}$ blocks`)
    expect(D.CHART_HAND_FLOW).toContain(`\\mathrm{RMS} = ${val(String.raw`\sqrt{E[\delta_B^2]}`).toFixed(3)}\\,\\mathrm{fs}`)
  })

  it('原始碼：標籤裡的數學都寫成 `$...$`，`$` 以外的文字沒有 Unicode 拼的數學（希臘字母、上下標、≤ ⇒ ° ∠ …）', () => {
    for (const c of CH14_CHARTS) {
      // 拿掉 `$$...$$`／`$...$` 公式與 classDef／class 行，剩下的是純文字（含節點 id）
      const rest = c.chart
        .split('\n')
        .filter((l) => !/^\s*(classDef|class)\s/.test(l))
        .join('\n')
        .replace(/\$\$.*?\$\$/g, '')
        .replace(/\$[^$\n]*\$/g, '')
      expect(unicodeMathIn(rest), `${c.name}：公式以外還有 Unicode 拼的數學`).toEqual([])
      expect(rest.match(/[⇒⇔≪≫≲≳∠°′″ˆ]|[\u0300-\u036f]/g) ?? [], `${c.name}：公式以外還有數學符號`).toEqual([])
      // `$` 要成對
      expect((c.chart.replace(/\\\$/g, '').match(/\$/g) ?? []).length % 2, `${c.name} 的 $ 要成對`).toBe(0)
      // 公式裡不直接寫 < >（Mermaid 會把標籤裡的 < > 轉成 &lt; &gt;，KaTeX 讀到會出錯）；大小於用 \lt \gt \le \ge
      const mathSegments = c.chart.match(/\$\$.*?\$\$|\$[^$\n]*\$/g) ?? []
      expect(mathSegments.filter((m) => /[<>]/.test(m)), `${c.name}：公式裡有 < 或 >`).toEqual([])
    }
  })

  it('實際渲染（共用的 renderMermaidForTest）：沒有「Unsupported markdown」、畫面沒有殘留的 $、KaTeX 以外沒有 Unicode 數學、節點數不超過 14；含公式的標籤都由 KaTeX 排版，其餘標籤原樣出現', async () => {
    type SubGraph = { id: string; title?: string }
    // 含公式的標籤中，公式以外的文字片段（以 <br> 與公式切開）
    const words = (label: string) => label.split(/<br\s*\/?>/).flatMap((line) => line.split(/\$[^$]*\$/)).map(plain).filter(Boolean)
    for (const c of CH14_CHARTS) {
      const { svg, text, plainText, nodeCount, mathCount } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(text, `${c.name}：畫出來的文字不可殘留「$」（TeX 沒有被排版）`).not.toContain('$')
      expect(unicodeMathIn(plainText), `${c.name}：KaTeX 以外還有 Unicode 拼的數學`).toEqual([])
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeGreaterThan(0)
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeLessThanOrEqual(14)
      const host = document.createElement('div')
      host.innerHTML = svg
      host.querySelectorAll('.katex-mathml').forEach((e) => e.remove()) // KaTeX 的 MathML 複本裡有 TeX 原始碼，不算「畫出來的字」
      const shownList = Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel, .cluster-label, .label')).map((e) => plain(e.textContent ?? ''))
      const shown = new Set(shownList)
      const g = await flow(c.chart)
      if (!g) {
        // stateDiagram：兩個 state 標籤（`state "…" as X`）＋一個手寫 `$$…$$` 的轉移 = 3 個 KaTeX 標籤
        expect(c.name).toBe('CHART_ALARM_HYSTERESIS')
        expect(mathCount, c.name).toBe(3)
        continue
      }
      const db = (await mermaid.mermaidAPI.getDiagramFromText(c.chart)).db as unknown as { getSubGraphs?: () => SubGraph[] }
      const subgraphs = db.getSubGraphs?.() ?? []
      const titles = subgraphs.map((sg) => sg.title ?? '')
      // 被箭頭連到的子圖（例如 ROW1 --> ROW2）在 parser 裡也算一個 vertex，但它畫成群組框、標籤是子圖標題，不是節點文字
      const subIds = new Set(subgraphs.map((sg) => sg.id))
      const labels = [...g.vertices.filter((v) => !subIds.has(v.id)).map((v) => v.text ?? ''), ...g.edges.map((e) => e.text ?? ''), ...titles].filter(Boolean)
      const mathLabels = labels.filter((t) => t.includes('$'))
      expect(mathCount, `${c.name}：含公式的標籤數與 KaTeX 排版出來的公式數不同`).toBe(mathLabels.length)
      for (const t of labels) {
        if (t.includes('$')) {
          for (const w of words(t)) expect(shownList.some((sh) => sh.includes(w)), `${c.name}：公式標籤「${t}」裡的文字「${w}」沒有出現在圖上`).toBe(true)
        } else if (!titles.includes(t)) {
          expect(shown.has(plain(t)), `${c.name}：標籤「${t}」沒有原樣出現在圖上`).toBe(true)
        }
      }
    }
    // 規格原圖沒有公式；其餘 23 張都有
    expect((await renderMermaidForTest(D.SPEC_CHART)).mathCount).toBe(0)
    for (const c of CH14_CHARTS.filter((x) => x.name !== 'SPEC_CHART')) expect((await renderMermaidForTest(c.chart)).mathCount, c.name).toBeGreaterThan(0)
  }, 300000)
})

describe('Ch14 架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端、LMS 的輸入是 PD 的輸出', () => {
  it('章首系統地圖：reference → DTC → PD、VCO → divider → PD，DTC 不在回授路徑上；comparator 的輸入是 PD 輸出（從 PD → loop filter 那條線分接）', () => {
    const { wires } = systemMapModel(CH14_SYSTEM_FOCUS)
    const has = (a: string, b: string) => wires.some((w) => w.from === a && w.to === b)
    for (const [a, b] of [['ref', 'dtc'], ['dtc', 'pd'], ['pd', 'lf'], ['lf', 'vco'], ['vco', 'div'], ['div', 'pd'], ['dsm', 'div'], ['gc', 'dtc']]) expect(has(a, b), `${a} → ${b}`).toBe(true)
    for (const [a, b] of [['div', 'dtc'], ['dtc', 'div'], ['ref', 'pd'], ['dtc', 'cmp'], ['div', 'cmp'], ['lf', 'cmp']]) expect(has(a, b), `不該有 ${a} → ${b}`).toBe(false)
    const tap = wires.find((w) => w.from === 'pd' && w.to === 'cmp')
    expect(tap?.tag?.tapOn, 'LMS 的輸入從 PD → loop filter 那條線分接').toEqual(['pd', 'lf'])
    expect(tap?.tag?.source.text).toContain('PD 輸出')
    expect(wires.filter((w) => w.to === 'cmp').map((w) => w.from).sort(), 'comparator 的輸入只有 PD 輸出與雜訊').toEqual(['noise', 'pd'])
  })

  it('CHART_SAMPLE_TO_BLOCK：e[n] 是 PD 的輸出（加法點），comparator 與 loop filter 從同一個節點分接；comparator 沒有別的輸入；誤差路徑從 DTC 的 code 走到 PD 輸出', async () => {
    const g = (await flow(D.CHART_SAMPLE_TO_BLOCK))!
    expect(edgeText(g, 'SUMV', 'CMP')).toContain('PD 輸出')
    expect(edgeText(g, 'SUMV', 'CMP')).toContain(String.raw`$e[n] \approx \delta_k\,u[n] + v[n]$`)
    expect(g.edges.some((e) => e.start === 'SUMV' && e.end === 'LF'), '同一個節點也送進 loop filter').toBe(true)
    expect(g.vertices.find((v) => v.id === 'LF')?.text).toContain('Loop filter')
    expect(g.edges.filter((e) => e.end === 'CMP').map((e) => e.start), 'comparator 唯一的輸入是 PD 輸出').toEqual(['SUMV'])
    expect(g.edges.filter((e) => e.end === 'LF').map((e) => e.start), 'loop filter 的輸入同樣是這個節點').toEqual(['SUMV'])
    expect(g.vertices.find((v) => v.id === 'XC')?.text).toContain('DTC code')
    expect(g.vertices.find((v) => v.id === 'PATH')?.text).toContain('DTC 到 PD 輸出')
    expect(g.vertices.find((v) => v.id === 'PROD')?.text).toContain('PD 輸出')
  })

  it('沒有任何一張圖把 divider 接到 DTC（DTC 不在回授路徑上），也沒有把 comparator 的輸入畫成從 DTC 或 divider 來', async () => {
    for (const c of CH14_CHARTS) {
      const g = await flow(c.chart)
      if (!g) continue // stateDiagram
      const text = (id: string) => g.vertices.find((v) => v.id === id)?.text ?? ''
      const isDiv = (id: string) => /divider|除頻|PMUX|MMD/i.test(text(id))
      const isDtc = (id: string) => /DTC/.test(text(id))
      const isCmp = (id: string) => /comparator/i.test(text(id))
      for (const e of g.edges) {
        expect(isDiv(e.start) && isDtc(e.end), `${c.name}：${e.start} → ${e.end} 是 divider → DTC`).toBe(false)
        expect(isDtc(e.start) && isCmp(e.end), `${c.name}：${e.start} → ${e.end} 是 DTC → comparator`).toBe(false)
        expect(isDiv(e.start) && isCmp(e.end), `${c.name}：${e.start} → ${e.end} 是 divider → comparator`).toBe(false)
      }
    }
  }, 60000)
})

describe('Ch14 頁面上的方塊圖（teaching-style §8）', () => {
  it('章首是 SystemMap（藍色：GMAC、÷N × μ、gain accumulator）；24 張圖各出現一次、順序與清單相同；每張都有圖說與「先看…」導讀，並放在對應公式之前', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = renderPage(<Chapter14 />, { url: '/ch/14' })
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    // ① 系統地圖：第一張圖、在 14.0 之前，是手排的 SVG（figure.c-sysmap，不經過 Mermaid，所以沒有 data-chart）；藍色（is-focus）的是本章的三個方塊
    expect(CH14_SYSTEM_FOCUS).toEqual(['gmac', 'scale', 'acc'])
    expect(figs[0].classList.contains('c-sysmap')).toBe(true)
    expect(figs[0].hasAttribute('data-chart')).toBe(false)
    expect(container.querySelectorAll('figure.c-sysmap').length).toBe(1)
    const domFocus = Array.from(figs[0].querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
    expect(domFocus.sort()).toEqual([...CH14_SYSTEM_FOCUS].sort())
    expect(figs[0].querySelectorAll('g.c-sysmap-block[data-focus="true"]').length).toBe(CH14_SYSTEM_FOCUS.length)
    expect(figs[0].querySelectorAll('g.c-sysmap-block').length).toBeGreaterThan(CH14_SYSTEM_FOCUS.length) // 其餘方塊照畫，只是沒有標藍
    // 同一組主角用純資料的 systemMapModel 核對：每個主角都是地圖上有名稱、有接線的方塊
    const model = systemMapModel(CH14_SYSTEM_FOCUS)
    expect(model.blocks.filter((b) => b.focused).map((b) => b.id).sort()).toEqual([...CH14_SYSTEM_FOCUS].sort())
    for (const b of CH14_SYSTEM_FOCUS) {
      expect(SYSTEM_BLOCK_LABEL[b], b).toBeTruthy()
      expect(model.wires.some((w) => w.from === b || w.to === b), `${b} 沒有接線`).toBe(true)
    }
    const before = (a: Element | null, b: Element | null, msg: string) => {
      expect(a, msg).toBeTruthy()
      expect(b, msg).toBeTruthy()
      expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING, msg).toBeTruthy()
    }
    before(container.querySelector('.ch14-lead'), figs[0], '系統地圖在開場問題之後')
    before(figs[0], container.querySelector('#ch14-question'), '系統地圖在 14.0 之前')
    expect(figs[0].nextElementSibling?.textContent).toContain('藍色的三塊是本章的主角')
    expect(figs[0].nextElementSibling?.textContent).toContain('本章新增的是')

    // ② 其餘 24 張：與清單同序、各一次（Beginner 模式也全部看得到）
    const charts = figs.slice(1).map((f) => f.getAttribute('data-chart'))
    expect(charts.length).toBe(CH14_CHARTS.length)
    expect(charts).toEqual(CH14_CHARTS.map((c) => c.chart))

    // ③ 圖說（數學一律用 $...$ 的 LaTeX、不用 Unicode 拼湊）＋導讀（先看…；除規格原圖外都有「圖上的 X 就是…」的對照，且含 KaTeX）
    const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓]/
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, f.getAttribute('data-chart')?.slice(0, 40)).toBeGreaterThan(15)
      expect((cap.match(/\$/g) ?? []).length % 2, `圖說的 $ 要成對：${cap}`).toBe(0)
      const outsideMath = cap.split('$').filter((_, i) => i % 2 === 0).join('')
      expect(BAD.test(outsideMath), `圖說有 Unicode 拼湊的數學（請改寫成 $...$）：${cap}`).toBe(false)
    }
    expect(figs[1 + CH14_CHARTS.findIndex((c) => c.name === 'CHART_SAMPLE_TO_BLOCK')].querySelector('figcaption')?.textContent).toContain('$N$')
    const el = (name: string) => figs[1 + CH14_CHARTS.findIndex((c) => c.name === name)]
    for (const c of CH14_CHARTS) {
      const wrap = el(c.name).closest('.ch14-diagram')
      expect(wrap, c.name).toBeTruthy()
      const walk = wrap!.querySelector('.ch14-diagram-walk')
      expect(walk?.textContent, c.name).toContain('先看')
      if (c.name !== 'SPEC_CHART') {
        expect(walk?.textContent, c.name).toContain('圖上')
        expect(walk?.querySelector('.katex'), c.name).toBeTruthy()
      }
    }

    // 架構約定（docs/assumptions.md §2a）：導讀與圖說都說明 e[n] 是 PD 的輸出、comparator 與 loop filter 取同一個節點（不是從 DTC 或 divider 取）
    const s2bDiagram = el('CHART_SAMPLE_TO_BLOCK').closest('.ch14-diagram')!
    const s2bWalk = s2bDiagram.querySelector('.ch14-diagram-walk')?.textContent ?? ''
    expect(s2bWalk).toContain('PD 的輸出')
    expect(s2bWalk).toContain('loop filter')
    expect(s2bWalk).toMatch(/comparator 從同一個節點分接[^。]*不是 DTC 或 divider/)
    expect(el('CHART_SAMPLE_TO_BLOCK').querySelector('figcaption')?.textContent).toMatch(/comparator 與 loop filter 取同一個 PD 輸出/)
    // 章首（先認識本章反覆出現的量之後、14.0 之前）說明一次物理圖像：reference 先經過 DTC 才進 PD、divider 的回授 edge 早到、DTC 只能從 T_0 往回扣（補償量）、PD 量 t_ref′ − t_fb
    const phys = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes('這些量在晶片上是什麼'))
    expect(phys, '章首的物理圖像段落').toBeTruthy()
    for (const w of ['reference clock 先經過 DTC 才進 PD', '回授路徑上只有 divider', 'feedback edge 比理想時刻早到', '只能延遲、不能提前', '補償量', 'reference edge 減 feedback edge']) expect(phys!.textContent, w).toContain(w)
    const physTex = Array.from(phys!.querySelectorAll('annotation[encoding="application/x-tex"]')).map((a) => a.textContent)
    expect(physTex).toContain(String.raw`\tau_\mathrm{DTC}[n]=T_0-w_k\,x[n]`)
    expect(physTex).toContain(String.raw`e[n]=t_\mathrm{ref}^{\prime}[n]-t_\mathrm{fb}[n]=(a-w_k)\,x[n]+v[n]=\delta_k\,x[n]+v[n]`)
    // 「提前」只是少延遲（DTC 不能產生負的延遲）；補償不足時誤差和 x[n] 同號；本章的 x[n] = ±1 是零均值的 code，x[n] < 0 時是晚到、DTC 的延遲比 T_0 長
    for (const w of ['reference edge 被提前——也就是少延遲——的時間', '誤差和', '同號', '零均值', '也就是晚到', '一樣被 PLL 吸收']) expect(phys!.textContent, w).toContain(w)
    expect(physTex).toContain('w_k<a')
    expect(physTex).toContain(String.raw`x[n]=\pm1`)
    expect(container.querySelector('.ch14-symbols-jump')).toBeNull() // 符號表連結改由 PageFrame 的 strip 提供
    before(phys!, container.querySelector('[id="ch14-question"]'), '物理圖像在 14.0 之前')
    // 「你在這裡」的那一段也說 comparator 取的是 PD 輸出
    expect(figs[0].nextElementSibling?.textContent).toContain('comparator 取的是 PD 的輸出')
    expect(figs[0].nextElementSibling?.textContent).toContain('送進 loop filter 的同一個訊號')

    // 方向字眼要跟著圖的方向走：由上到下的圖（flowchart TB／TD、stateDiagram TB）的圖說與導讀不說「由左到右」，橫向（LR）的圖不說「由上到下」。
    // pole 圖是折成兩排的 TB 圖，圖說明寫「上排由左到右，再接到下排」。
    for (const c of CH14_CHARTS) {
      const txt = el(c.name).closest('.ch14-diagram')?.textContent ?? ''
      if (c.name === 'CHART_POLE_REGIMES') {
        expect(txt, c.name).toMatch(/上排[^。]*下排/)
        continue
      }
      if (/^(flowchart T[BD]|stateDiagram-v2\s+direction TB)/.test(c.chart)) expect(txt, `${c.name} 是由上到下的圖，圖說與導讀不該說「由左到右」`).not.toMatch(/[由從]左到右/)
      else expect(txt, `${c.name} 是橫向的圖，圖說與導讀不該說「由上到下」`).not.toMatch(/[由從]上到下/)
    }
    // 為了排版從圖上挪走的字，要還留在頁面上（圖說或導讀）：clip 虛線「以 COARSE 為例，任何更新中的狀態都適用」；
    // 暫停 guard 的條件（低雜訊模式、bad-FCW 且 policy = freeze）現在寫在「是」那條邊上，導讀也有說明。
    expect(el('IMPL_CHART').closest('.ch14-diagram')?.textContent, 'clip 虛線的註解').toMatch(/clip[^。]*以 COARSE 為例，任何更新中的狀態都適用/)
    expect(el('CHART_GUARD_ORDER').closest('.ch14-diagram')?.querySelector('.ch14-diagram-walk')?.textContent, '暫停 guard 的條件').toMatch(/低雜訊模式[^。]*bad-FCW[^。]*freeze/)

    // ④ 位置：文字說明 → 圖 → 推導／公式
    const id = (x: string) => container.querySelector(`[id="${x}"]`)
    const order: [string, string][] = [
      ['CHART_COMPARATOR_GAIN', 'ch14-question'],
      ['CHART_CAL_LOOP', 'ch14-hand'],
      ['CHART_SAMPLE_TO_BLOCK', 'formula-F-14.1'],
      ['CHART_MSD_SPLIT', 'formula-F-14.3'],
      ['CHART_POLE_REGIMES', 'formula-F-14.4'],
      ['CHART_E48_REGIMES', 'formula-F-14.5'],
      ['CHART_OBJECTIVE_FLOW', 'formula-F-14.7'],
      ['CHART_DESIGN_FLOW', 'formula-F-14.7'],
      ['CHART_NOISE_SHAPING', 'formula-F-14.11'],
      ['CHART_TRACKING_TRADEOFF', 'formula-F-14.12'],
      ['CHART_PM_LOOP', 'formula-F-14.14'],
      ['CHART_BUDGET_SPLIT', 'formula-F-14.17'],
      ['CHART_CORNER_FLOW', 'formula-F-14.15'],
      ['CHART_SLOPE_MEASURE', 'formula-F-14.21'],
      ['CHART_SCHEDULE_COMPARE', 'formula-F-14.20'],
      ['CHART_SCHEDULE_TIMELINE', 'formula-F-14.20'],
      ['CHART_KALMAN_INFO', 'formula-F-14.18'],
      ['CHART_HAND_FLOW', 'handcalc-HC-14.8'],
    ]
    for (const [name, target] of order) before(el(name), id(target), `${name} 應在 ${target} 之前`)
    const inside: [string, string][] = [
      ['CHART_CAL_LOOP', 'ch14-question'],
      ['CHART_MSD_SPLIT', 'ch14-msd'],
      ['CHART_POLE_REGIMES', 'ch14-msd'],
      ['CHART_E48_REGIMES', 'ch14-msd'],
      ['CHART_OBJECTIVE_FLOW', 'ch14-objectives'],
      ['CHART_PM_LOOP', 'ch14-objectives'],
      ['CHART_BUDGET_SPLIT', 'ch14-budget'],
      ['CHART_CALC_VERIFY', 'ch14-calculator'],
      ['CHART_CORNER_FLOW', 'ch14-corner'],
      ['CHART_KALMAN_INFO', 'ch14-schedule'],
      ['CHART_GUARD_ORDER', 'ch14-state-machine'],
      ['CHART_VERIFY_DECISION', 'ch14-state-machine'],
      ['CHART_ALARM_HYSTERESIS', 'ch14-state-machine'],
      ['CHART_HAND_FLOW', 'ch14-synthesis'],
    ]
    for (const [name, section] of inside) expect(el(name).closest(`#${section}`), `${name} 應在 #${section} 內`).toBeTruthy()
    expect(el('CHART_COMPARATOR_GAIN').closest('.c-prereq'), '比較器增益圖放在對應的先備知識框裡').toBeTruthy()
    // 符號表是頁面最後一個區塊（見 ch14.test.tsx），第一個圖在符號表之前
    before(figs[figs.length - 1], container.querySelector('[id="symbols"]'), '最後一張圖在章末符號表之前')
  }, 240000)
})
