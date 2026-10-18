import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import katex from 'katex'
import mermaid from 'mermaid'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { SettingsProvider } from '@/app/settings'
import { CONDITIONS, ITEMS, ITEM_STATUS_LABEL, PHASES, SUB_STATUS_LABEL, itemStatus, type ItemStatus, type RoadmapItem } from './data'
import * as D from './diagrams'
import { CHART_R1_LOOP, CHART_SIX_CONDITIONS, CHART_STATUS_FLOW, CONDITION_CHECK, DEPENDENCY_CHART, PHASE_CHART, ROADMAP_CHARTS, conditionsChart, statusFlowChart } from './diagrams'
import RoadmapPage from './index'
import { sigmaW2Colored, sigmaW2Lyapunov } from './model'
import { ROADMAP_SYMBOLS } from './symbols'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
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
  vi.clearAllMocks()
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
type Graph = { vertices: Vertex[]; edges: Edge[] }

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊。 */
async function flow(chart: string): Promise<Graph> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

function edgeText(g: Graph, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e.text ?? ''
}

/** mermaid 的 parser 會把含 HTML 的標籤裡的 > < & 編成 entity；瀏覽器顯示時會還原，所以這裡也還原再比對。 */
const decode = (s: string) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
const nodeText = (g: Graph, id: string): string => decode(g.vertices.find((v) => v.id === id)?.text ?? '')
const hasEdge = (g: Graph, start: string, end: string) => g.edges.some((e) => e.start === start && e.end === end)

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
    if (/`/.test(t)) return '反引號會被當成 code span'
  }
  if (/<(?!br\s*\/?>)[A-Za-z/!]/.test(text)) return '「<」後面緊接字母，會被當成 HTML 標籤'
  return null
}

/** 從 from 出發沿著邊走得到的所有節點（不含自己，除非有環）。 */
function reachable(g: Graph, from: string): Set<string> {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of g.edges) {
      if (e.start === cur && !seen.has(e.end)) {
        seen.add(e.end)
        stack.push(e.end)
      }
    }
  }
  return seen
}

describe('Roadmap 的 Mermaid 圖：清單', () => {
  it('共 5 張（3 張新圖 + 研究依賴 + 階段依賴）；diagrams.ts 匯出的每一張都在清單裡', () => {
    expect(ROADMAP_CHARTS.map((c) => c.name)).toEqual(['CHART_SIX_CONDITIONS', 'CHART_R1_LOOP', 'CHART_STATUS_FLOW', 'DEPENDENCY_CHART', 'PHASE_CHART'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(ROADMAP_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(ROADMAP_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    // 由資料產生的兩張：常數就是產生函式的輸出
    expect(CHART_SIX_CONDITIONS).toBe(conditionsChart())
    expect(CHART_STATUS_FLOW).toBe(statusFlowChart())
  })
})

describe('Roadmap 的 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    installMermaidSvgShim()
  })

  it('每一張都能解析成 flowchart；不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法；加法點的每條輸入都標了正負號', async () => {
    for (const c of ROADMAP_CHARTS) {
      const r = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(r && typeof r === 'object' ? r.diagramType : r, c.name).toBe('flowchart-v2')
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(g.vertices.length, `${c.name} 節點數`).toBeGreaterThanOrEqual(4)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
      const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')
      for (const s of sums) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        // 正負號：純符號的邊寫全形「＋」「−」；標籤裡還有公式的邊把正負號放進數學（`$+\,...$`、`$-\,...$`）
        for (const e of incoming) expect(e.text ?? '', `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^([＋−]|\$[+-])/)
      }
    }
  }, 60000)

  it('版面：兩個迴路／依賴圖都是直向（TB），橫向（LR）的圖都很淺（最長一條路 ≤ 6 個節點），桌機的正文欄放得下（teaching-style §8「版面寬度」）', async () => {
    expect(CHART_R1_LOOP).toMatch(/^flowchart TB\n/)
    expect(DEPENDENCY_CHART).toMatch(/^flowchart TB\n/)
    for (const c of ROADMAP_CHARTS.filter((x) => /^flowchart LR\n/.test(x.chart))) {
      const g = await flow(c.chart)
      // 沒有環的圖：最長一條路上的節點數
      const depth = new Map<string, number>()
      const longest = (id: string): number => {
        const known = depth.get(id)
        if (known !== undefined) return known
        const d = 1 + Math.max(0, ...g.edges.filter((e) => e.start === id).map((e) => longest(e.end)))
        depth.set(id, d)
        return d
      }
      expect(Math.max(...g.vertices.map((v) => longest(v.id))), `${c.name} 最長一條路的節點數`).toBeLessThanOrEqual(6)
    }
  })

  it('六個條件：每個方塊的名稱、判斷式與「延伸研究」清單都和 data.ts 一致；六個都接到同一個結果', async () => {
    const g = await flow(CHART_SIX_CONDITIONS)
    expect(Object.keys(CONDITION_CHECK).sort()).toEqual(CONDITIONS.map((c) => c.id).sort())
    expect(g.vertices.map((v) => v.id).sort()).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'OK'])
    CONDITIONS.forEach((c, i) => {
      const lines = nodeText(g, `C${i + 1}`).split(/<br\s*\/?>/)
      expect(lines).toHaveLength(3)
      expect(lines[0], c.id).toContain(c.label)
      expect(lines[1], c.id).toBe(CONDITION_CHECK[c.id])
      const want = ITEMS.filter((it) => it.conditions.includes(c.id)).map((it) => it.id)
      expect(want.length, c.id).toBeGreaterThan(0)
      expect(lines[2], c.id).toBe(`延伸研究：${want.join('、')}`)
      expect(hasEdge(g, `C${i + 1}`, 'OK'), c.id).toBe(true)
    })
    expect(g.edges).toHaveLength(6)
    // 判斷式與 data.ts 的 KaTeX 版問題是同一件事
    const q = (id: string) => CONDITIONS.find((c) => c.id === id)!.question
    expect(q('identifiability')).toContain('\\lambda_{\\min}>0')
    expect(CONDITION_CHECK.identifiability).toBe(String.raw`$\lambda_{\min} \gt 0$`) // 圖上的標籤是 LaTeX（不用 ASCII 的 >）
    expect(q('polarity')).toContain('$C>0$')
    expect(CONDITION_CHECK.polarity).toBe(String.raw`$C \gt 0$`)
    expect(q('stability')).toContain('單位圓內')
    expect(CONDITION_CHECK.stability).toContain('單位圓內')
    expect(q('variance')).toContain('\\sigma_w')
    expect(CONDITION_CHECK.variance).toContain(String.raw`$\sigma_w$`)
    expect(q('bias')).toContain('w^*')
    expect(CONDITION_CHECK.bias).toContain(String.raw`$w^*$`)
    expect(q('system')).toMatch(/jitter.*spur/)
    expect(CONDITION_CHECK.system).toMatch(/jitter.*spur/)
  })

  it('R1 的迴路：兩個加法點的極性與 F-R1.2 的狀態空間一致；照著圖推變異數，得到的 σ_w² 就是 sigmaW2Colored 與 sigmaW2Lyapunov', async () => {
    const g = await flow(CHART_R1_LOOP)
    // 上半部：η_(k+1) = ρ·η_k + √(1 − ρ²)·σ_η·ξ_k
    expect(hasEdge(g, 'XI', 'DRV')).toBe(true)
    // （標籤原始碼就是 LaTeX；正負號放在進入加法點的那條線的數學裡）
    expect(nodeText(g, 'DRV')).toBe(String.raw`$\times\,\sqrt{1 - \rho^2}\,\sigma_\eta$`)
    expect(edgeText(g, 'DRV', 'S1')).toBe('＋')
    expect(edgeText(g, 'RHO', 'S1')).toBe(String.raw`$+\,\rho\,\eta_k$`)
    expect(edgeText(g, 'S1', 'Z1')).toBe(String.raw`$\eta_{k+1}$`)
    expect(edgeText(g, 'Z1', 'RHO')).toBe(String.raw`$\eta_k$`)
    // 下半部：δw_(k+1) = p·δw_k + μ·η_k
    expect(edgeText(g, 'Z1', 'MU')).toBe(String.raw`$\eta_k$`)
    expect(edgeText(g, 'MU', 'S2')).toBe(String.raw`$+\,\mu\,\eta_k$`)
    expect(edgeText(g, 'PP', 'S2')).toBe(String.raw`$+\,p\,\delta w_k$`)
    expect(edgeText(g, 'S2', 'Z2')).toBe(String.raw`$\delta w_{k+1}$`)
    expect(edgeText(g, 'Z2', 'PP')).toBe(String.raw`$\delta w_k$`)
    expect(edgeText(g, 'Z2', 'OUT')).toBe(String.raw`$\delta w_k$`)
    expect(nodeText(g, 'PP')).toContain(String.raw`$p = 1 - \mu K$`)
    for (const id of ['Z1', 'Z2']) expect(nodeText(g, id)).toBe('$z^{-1}$')
    expect(nodeText(g, 'OUT')).toContain(String.raw`$\sigma_w^2 = E[\delta w_k^2]$`)
    expect(g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')).toHaveLength(2)
    expect(CHART_R1_LOOP).toContain('class RHO focus')

    // 照著圖推二階動差（「先算一次」的條件：σ_v = 100 fs、C = 1、μ = 10 fs、N = 4096）
    const K = Math.sqrt(2 / Math.PI) / 100
    const mu = 10
    const p = 1 - mu * K
    const sigmaEta2 = 1 / 4096
    for (const rho of [0, 0.5, -0.5, 0.9]) {
      const drive2 = (1 - rho * rho) * sigmaEta2 // (× √(1 − ρ²)·σ_η)²，ξ_k 的變異數是 1
      let [pww, pwe, pee] = [0, 0, 0] // E[δw²]、E[δw·η]、E[η²]
      for (let k = 0; k < 4000; k++) {
        const nww = p * p * pww + 2 * p * mu * pwe + mu * mu * pee // S2：＋ p·δw_k、＋ μ·η_k
        const nwe = p * rho * pwe + mu * rho * pee // δw_(k+1)·η_(k+1)：ξ_k 與兩者都無關
        const nee = rho * rho * pee + drive2 // S1：＋ ρ·η_k、＋ 驅動
        ;[pww, pwe, pee] = [nww, nwe, nee]
      }
      expect(pee).toBeCloseTo(sigmaEta2, 14) // 上半部輸出的變異數維持 σ_η²
      const closed = sigmaW2Colored({ p, mu, sigmaEta2, rho })
      expect(pww / closed, `ρ = ${rho}`).toBeCloseTo(1, 9)
      expect(sigmaW2Lyapunov({ p, mu, sigmaEta2, rho }) / closed, `ρ = ${rho}`).toBeCloseTo(1, 9)
    }
    // ρ = 0 時退回第 12 章的白雜訊結果；ρ > 0 放大、ρ < 0 縮小
    const white = (mu * mu * sigmaEta2) / (1 - p * p)
    expect(sigmaW2Colored({ p, mu, sigmaEta2, rho: 0 })).toBeCloseTo(white, 15)
    expect(Math.sqrt(white)).toBeCloseTo(0.399, 3) // T13 的 σ_w
    expect(sigmaW2Colored({ p, mu, sigmaEta2, rho: 0.5 })).toBeGreaterThan(white)
    expect(sigmaW2Colored({ p, mu, sigmaEta2, rho: -0.5 })).toBeLessThan(white)
  })

  it('狀態判定流程：照著圖的三個菱形走，11 個研究項目都得到 itemStatus() 的結果；四種結果都通到「不是 verified」', async () => {
    const g = await flow(CHART_STATUS_FLOW)
    const explicit = ITEMS.filter((it) => it.status !== undefined)
    expect(explicit.map((it) => it.id)).toEqual(['SSPLL'])
    expect(explicit.every((it) => it.status === 'in-analysis')).toBe(true)
    expect(edgeText(g, 'Q0', 'INA')).toBe('是：目前只有 SSPLL')
    const NODE: Record<ItemStatus, string> = { 'in-analysis': 'INA', partial: 'PART', pending: 'PEND', 'not-started': 'NS' }
    for (const [status, id] of Object.entries(NODE)) {
      expect(nodeText(g, id), status).toBe(ITEM_STATUS_LABEL[status as ItemStatus])
      expect(hasEdge(g, id, 'NOV'), status).toBe(true)
    }
    expect(nodeText(g, 'NOV')).toContain('都不是 verified')
    expect(nodeText(g, 'Q1')).toContain(`「${SUB_STATUS_LABEL['on-site']}」`)
    expect(nodeText(g, 'Q2')).toContain(`「${SUB_STATUS_LABEL.preview}」`)
    expect(nodeText(g, 'Q2')).toContain(`「${SUB_STATUS_LABEL.pending}」`)
    // 圖的走向
    const next = (from: string, answer: RegExp) => g.edges.find((e) => e.start === from && answer.test(e.text ?? ''))!.end
    const walk = (it: Pick<RoadmapItem, 'status' | 'subgoals'>): string => {
      if (next('START', /^$/) !== 'Q0') throw new Error('起點應接到 Q0')
      const a = next('Q0', it.status !== undefined ? /^是/ : /^否/)
      if (a !== 'Q1') return a
      const b = next('Q1', it.subgoals.some((s) => s.status === 'on-site') ? /^有/ : /^沒有/)
      if (b !== 'Q2') return b
      return next('Q2', it.subgoals.some((s) => s.status === 'preview' || s.status === 'pending') ? /^有/ : /^沒有/)
    }
    for (const it of ITEMS) expect(walk(it), it.id).toBe(NODE[itemStatus(it)])
    // 資料裡沒有出現的分支也照同一條規則：只有未開始的子目標 ⇒ 未開始；只有預覽 ⇒ 待辦
    const fake = (statuses: RoadmapItem['subgoals'][number]['status'][]) => ({ ...ITEMS[0], status: undefined, subgoals: statuses.map((status) => ({ text: 'x', status })) })
    for (const item of [fake(['not-started']), fake(['preview', 'not-started']), fake(['pending']), fake(['on-site', 'pending']), fake(['in-analysis'])]) {
      expect(walk(item)).toBe(NODE[itemStatus(item)])
    }
  })

  it('研究依賴圖：11 個項目各一個節點、沒有環、R10（規格反推）是終點；階段依賴圖的每條邊都在 PHASES 的 deps 裡，且每個 dep 都走得到', async () => {
    const dep = await flow(DEPENDENCY_CHART)
    expect(dep.vertices.map((v) => v.id).sort()).toEqual(ITEMS.map((it) => (it.id === 'SSPLL' ? 'SS' : it.id)).sort())
    for (const v of dep.vertices) {
      expect(v.text, v.id).toContain(v.id === 'SS' ? 'SSPLL' : v.id)
      expect(reachable(dep, v.id).has(v.id), `${v.id} 不應在環上`).toBe(false)
    }
    expect(dep.edges.some((e) => e.start === 'R10')).toBe(false)
    for (const v of dep.vertices) if (v.id !== 'R10') expect(reachable(dep, v.id).has('R10'), `${v.id} 最後要通到 R10`).toBe(true)

    const ph = await flow(PHASE_CHART)
    expect(ph.vertices.map((v) => v.id).sort()).toEqual(PHASES.map((p) => p.id).sort())
    for (const p of PHASES) expect(nodeText(ph, p.id)).toBe(`${p.id} ${p.title}`)
    for (const e of ph.edges) expect(PHASES.find((p) => p.id === e.end)!.deps, `${e.start} → ${e.end}`).toContain(e.start)
    for (const p of PHASES) for (const d of p.deps) expect(reachable(ph, d).has(p.id), `${d} 應走得到 ${p.id}`).toBe(true)
  })

  it('圖內的數學一律是 `$...$` LaTeX：$ 成對、每段 TeX 可被 KaTeX 嚴格解析、不用雙反斜線（Mermaid 會收成一個）、`$...$` 以外沒有 Unicode 拼的數學', () => {
    for (const c of ROADMAP_CHARTS) {
      expect(c.chart, c.name).not.toContain('\\\\')
      for (const label of quotedLabels(c.chart)) {
        const dollars = label.replace(/\\\$/g, '').split('$').length - 1
        expect(dollars % 2, `${c.name}：${label}`).toBe(0)
        for (const m of label.matchAll(MATH)) {
          expect(() => katex.renderToString(m[1] ?? m[2], { throwOnError: true, strict: 'ignore' }), `${c.name}：${m[0]}`).not.toThrow()
        }
        expect(unicodeMathIn(textPieces(label).join(' ')), `${c.name}：${label}`).toEqual([])
      }
    }
    // 數學模型圖（R1 迴路）與六個條件圖有公式；其餘三張是文字流程圖／依賴圖
    expect(mathLabelCount(CHART_R1_LOOP)).toBeGreaterThanOrEqual(12)
    expect(mathLabelCount(CHART_SIX_CONDITIONS)).toBeGreaterThanOrEqual(4)
    for (const c of [CHART_STATUS_FLOW, DEPENDENCY_CHART, PHASE_CHART]) expect(mathLabelCount(c)).toBe(0)
  })

  it('實際渲染（共用的 renderMermaidForTest）：每張圖都畫得出來，沒有「Unsupported markdown」、畫面上沒有殘留的 $、KaTeX 以外沒有 Unicode 數學、節點數 ≤ 14，每個標籤都畫出來', async () => {
    for (const c of ROADMAP_CHARTS) {
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

describe('Roadmap 頁面上的方塊圖與符號表（teaching-style §5、§8）', () => {
  it('5 張圖各出現一次、順序與清單相同、都有圖說；新的三張有「先看…再看…」導讀並放在對應的表格／手算之前；符號表在頁尾（id="symbols"），頁首只留一行按鈕', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/roadmap']}>
          <RoadmapPage />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const before = (a: Element | null, b: Element | null, msg: string) => {
      expect(a, msg).toBeTruthy()
      expect(b, msg).toBeTruthy()
      expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING, msg).toBeTruthy()
    }

    // ① 圖：與清單同序、各一次（Beginner 模式也全部看得到）
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual(ROADMAP_CHARTS.map((c) => c.chart))
    const el = (name: string) => figs[ROADMAP_CHARTS.findIndex((c) => c.name === name)]
    // ② 圖說是純文字（不用 Unicode 拼數學、不留 $）
    const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓$]/
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, f.getAttribute('data-chart')?.slice(0, 40)).toBeGreaterThan(8)
      expect(BAD.test(cap), cap).toBe(false)
    }
    // ③ 新的三張：導讀「先看…再看…」，並對照圖上的方塊；數學模型圖與條件圖的導讀含 KaTeX
    for (const name of ['CHART_SIX_CONDITIONS', 'CHART_R1_LOOP', 'CHART_STATUS_FLOW']) {
      const walk = el(name).closest('.rm-diagram')?.querySelector('.rm-diagram-walk')
      expect(walk?.textContent, name).toContain('先看')
      expect(walk?.textContent, name).toContain('再看')
      expect(walk?.textContent, name).toContain('圖上')
      expect(walk?.textContent, name).not.toContain('$')
      if (name !== 'CHART_STATUS_FLOW') expect(walk?.querySelectorAll('.katex').length, name).toBeGreaterThanOrEqual(4)
    }
    // ④ 位置：三張新圖都在 §0；六個條件 → 條件表；R1 迴路 → 手算三步；狀態流程 → 四張說明卡
    const start = container.querySelector('#rm-start') as HTMLElement
    for (const name of ['CHART_SIX_CONDITIONS', 'CHART_R1_LOOP', 'CHART_STATUS_FLOW']) expect(start.contains(el(name)), name).toBe(true)
    before(el('CHART_SIX_CONDITIONS'), start.querySelector('table'), '六個條件的圖在條件表之前')
    before(start.querySelector('table'), el('CHART_R1_LOOP'), 'R1 迴路圖在條件表之後')
    before(el('CHART_R1_LOOP'), start.querySelector('ol'), 'R1 迴路圖在手算三步之前')
    before(start.querySelector('ol'), el('CHART_STATUS_FLOW'), '狀態流程圖在手算之後')
    before(el('CHART_STATUS_FLOW'), start.querySelector('.rm-legend'), '狀態流程圖在四張說明卡之前')
    expect(container.querySelector('#rm-overview')!.contains(el('DEPENDENCY_CHART'))).toBe(true)
    expect(container.querySelector('#rm-phases')!.contains(el('PHASE_CHART'))).toBe(true)

    // ⑤ 符號表：全頁只有一張，在 #symbols 裡；#symbols 是整頁最後一個區塊（思考題、必記與公式登錄之後）
    const page = container.querySelector('article.rm')!
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(page.lastElementChild).toBe(symbols)
    expect(symbols.querySelector('h2')?.textContent).toBe('8. 本頁符號表')
    before(container.querySelector('#rm-wrap'), symbols, '符號表在思考題與必記之後')
    before(container.querySelector('.c-recap'), symbols, '符號表在 Recap 之後')
    before(container.querySelector('#rm-formulas'), symbols, '符號表在公式登錄之後')
    const tables = Array.from(container.querySelectorAll('.c-symbols'))
    expect(tables).toHaveLength(1)
    expect(symbols.contains(tables[0])).toBe(true)
    expect(tables[0].querySelectorAll('tbody tr').length).toBe(ROADMAP_SYMBOLS.length)
    // ⑥ 頁首只留一行：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），在 §0 之前
    const link = Array.from(container.querySelectorAll('.rm-symbols-link button')).find((b) => b.textContent === '本頁符號表在最後 ↓') as HTMLButtonElement
    expect(link).toBeTruthy()
    before(link, start, '連結在 §0 之前')
    expect(container.querySelectorAll('a[href="#symbols"], a[href$="#symbols"]')).toHaveLength(0)
    expect((container.textContent ?? '').split('本頁符號表在最後').length).toBe(2)
    // 按下去捲到 #symbols（jsdom 沒有 scrollIntoView，這裡裝一個替身）；符號表旁的「回到頁首」捲回 §0
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
      expect(scrolled[1]).toBe(start)
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  }, 120000)
})
