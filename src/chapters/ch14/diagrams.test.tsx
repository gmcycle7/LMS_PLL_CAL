import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { SettingsProvider } from '@/app/settings'
import { defaultValues, systemMapChart } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
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

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
// 頁面測試用的 Mermaid 元件替身：把原始碼放在 data-chart，方便核對「頁面上到底畫了哪些圖、順序為何」。
// （SystemMap 也是透過同一個元件畫圖，所以章首的系統地圖同樣會出現在清單裡。真正的 mermaid 套件沒有被 mock，下面照樣用它解析與渲染。）
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
  it('每一張都能解析；章首系統地圖也能解析', async () => {
    for (const c of CH14_CHARTS) {
      const r = await mermaid.parse(c.chart)
      const type = r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : ''
      expect(type, c.name).toMatch(c.name === 'CHART_ALARM_HYSTERESIS' ? /^stateDiagram/ : /^flowchart/)
    }
    const map = await mermaid.parse(systemMapChart(CH14_SYSTEM_FOCUS))
    expect(map && typeof map === 'object' ? (map as { diagramType: string }).diagramType : '').toMatch(/^flowchart/)
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
      // 加法點 = 圓形節點、文字是全形「＋」；每條進來的邊都要以「＋」或「−」開頭
      const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')
      for (const s of sums) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
      }
    }
  }, 60000)

  it('訊號極性與公式一致：δ = a − w、δ_B = p^B·δ₀ − μΣp^(B−1−k)η_k、H(z) = μ/(z − p)、1/P 累加、K̂ 的差分方向', async () => {
    // §14.0：a 進加法點為正、回授 w_k 為負；G_k = K·δ_k + η_k；累加器 w_(k+1) = w_k + μ·G_k
    const loop = (await flow(D.CHART_CAL_LOOP))!
    expect(edgeText(loop, 'A', 'S1')).toBe('＋')
    expect(edgeText(loop, 'ACC', 'S1')).toMatch(/^−.*w_k/)
    expect(edgeText(loop, 'S1', 'KB')).toBe('δ_k = a − w_k')
    expect(edgeText(loop, 'KB', 'S2')).toBe('＋')
    expect(edgeText(loop, 'ETA', 'S2')).toBe('＋')
    expect(edgeText(loop, 'S2', 'MU')).toBe('G_k = K·δ_k + η_k')
    const acc = loop.vertices.find((v) => v.id === 'ACC')?.text ?? ''
    expect(acc).toContain('1/(z−1)')
    expect(acc).toContain('w_(k+1) = w_k + μ·G_k')

    // 先備知識：e = δ + v（兩條輸入都是正號）→ sign → 取平均 E[q] = erf(δ/(√2σ_v)) = 2Φ(δ/σ_v) − 1；線性區斜率 K_q = √(2/π)/σ_v
    const cg = (await flow(D.CHART_COMPARATOR_GAIN))!
    expect(edgeText(cg, 'D', 'S')).toBe('＋')
    expect(edgeText(cg, 'V', 'S')).toBe('＋')
    expect(edgeText(cg, 'S', 'Q')).toBe('e = δ + v')
    expect(cg.vertices.find((v) => v.id === 'Q')?.text).toContain('q = sign(e) = ±1')
    expect(cg.vertices.find((v) => v.id === 'M')?.text).toContain('E[q] = erf(δ/(√2·σ_v)) = 2Φ(δ/σ_v) − 1')
    expect(cg.vertices.find((v) => v.id === 'LIN')?.text).toContain('K_q = √(2/π)/σ_v')
    expect(cg.edges.some((e) => e.start === 'M' && e.end === 'LIN')).toBe(true)
    expect(cg.edges.some((e) => e.start === 'M' && e.end === 'SAT')).toBe(true)

    // §14.1：sample rate 做 e[n] = δ_k·u[n] + v[n]（兩條輸入都是正號）、sign 與乘 code，block rate 才平均與更新；虛線回授 δ_k = a − w_k
    const s2b = (await flow(D.CHART_SAMPLE_TO_BLOCK))!
    expect(edgeText(s2b, 'PROD', 'SUMV')).toBe('＋')
    expect(edgeText(s2b, 'VN', 'SUMV')).toBe('＋')
    expect(edgeText(s2b, 'SUMV', 'CMP')).toBe('e[n] = δ_k·u[n] + v[n]')
    expect(edgeText(s2b, 'PATH', 'PROD')).toBe('u[n]')
    expect(s2b.edges.some((e) => e.start === 'XC' && e.end === 'PATH')).toBe(true)
    expect(s2b.edges.some((e) => e.start === 'XC' && e.end === 'MUL')).toBe(true)
    expect(s2b.vertices.find((v) => v.id === 'PATH')?.text).toContain('u[n] = c·x[n] + s·x[n−1]')
    expect(D.CHART_SAMPLE_TO_BLOCK).toContain('q[n] = sign(e[n])')
    expect(D.CHART_SAMPLE_TO_BLOCK).toContain('G_k = (1/N)·Σ q[n]·x[n]')
    expect(edgeText(s2b, 'AVG', 'UPD')).toBe('G_k ≈ K·δ_k + η_k')
    expect(edgeText(s2b, 'UPD', 'PROD')).toContain('δ_k = a − w_k')
    expect(D.CHART_SAMPLE_TO_BLOCK).toMatch(/subgraph FS\["sample rate[^\n]*索引 n[^\n]*\n(?:.*\n)*?\s*end\n\s*subgraph FU\["block rate[^\n]*索引 k[^\n]*f_u = f_s\/N/)
    // 取樣率：e、q 在 sample rate 子圖；G_k 與 w 的更新在 block rate 子圖
    const inSub = (name: string) => {
      const m = D.CHART_SAMPLE_TO_BLOCK.match(new RegExp(`subgraph ${name}\\[[^\\n]*\\n([\\s\\S]*?)\\n  end`))
      return m ? m[1] : ''
    }
    for (const id of ['XC', 'PATH', 'PROD', 'SUMV', 'VN', 'CMP', 'MUL']) expect(inSub('FS'), id).toMatch(new RegExp(`\\b${id}\\b`))
    for (const id of ['AVG', 'UPD']) expect(inSub('FU'), id).toMatch(new RegExp(`\\b${id}\\b`))

    // §14.1：bias 那條路為正，雜訊那條路以負號併入（δ_{k+1} = pδ_k − μη_k）
    const msd = (await flow(D.CHART_MSD_SPLIT))!
    expect(edgeText(msd, 'PB', 'SUM')).toBe('＋')
    expect(edgeText(msd, 'WGT', 'SUM')).toBe('−')
    expect(D.CHART_MSD_SPLIT).toContain('bias² = δ₀²·p^(2B)')
    expect(D.CHART_MSD_SPLIT).toContain('variance = μ²·σ_η²·(1 − p^(2B))/(1 − p²)')
    expect(D.CHART_MSD_SPLIT).toContain('× μ·p^(B−1−k)')

    // §14.2 (d)：前饋 × μ、回授 z⁻¹ → × p → 加法點，兩條輸入都是正的
    const ns = (await flow(D.CHART_NOISE_SHAPING))!
    expect(edgeText(ns, 'MU', 'SUM')).toBe('＋')
    expect(edgeText(ns, 'PP', 'SUM')).toBe('＋')
    expect(ns.edges.some((e) => e.start === 'SUM' && e.end === 'ZD')).toBe(true)
    expect(ns.edges.some((e) => e.start === 'ZD' && e.end === 'PP')).toBe(true)
    expect(edgeText(ns, 'ZD', 'PSD')).toContain('w_k − a')
    expect(D.CHART_NOISE_SHAPING).toContain('H(z) = μ/(z − p)')

    // §14.2 (a)、(e)：成本是兩項相加
    for (const chart of [D.CHART_DESIGN_FLOW, D.CHART_TRACKING_TRADEOFF]) {
      const g = (await flow(chart))!
      expect(g.edges.filter((e) => e.end === 'JS').map((e) => e.text)).toEqual(['＋', '＋'])
    }
    expect(D.CHART_TRACKING_TRADEOFF).toContain('(r/(μ·K))²')
    expect(D.CHART_TRACKING_TRADEOFF).toContain('σ_ζ²/(2·μ·K)')
    expect(D.CHART_TRACKING_TRADEOFF).toContain('μ·σ_η²/(2·K)')

    // §14.1：g = μK 從 0 往上加，p = 1 − g 依序經過 1、(0,1)、0、(−1,0)、−1、< −1；每個方塊的 PM = 90° − arcsin(g/2)
    const pole = (await flow(D.CHART_POLE_REGIMES))!
    const chain = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5']
    for (let i = 0; i + 1 < chain.length; i++) expect(edgeText(pole, chain[i], chain[i + 1]), `${chain[i]}→${chain[i + 1]}`).toBe('g 增加')
    const poleTxt = (id: string) => pole.vertices.find((v) => v.id === id)?.text ?? ''
    expect(poleTxt('R0')).toContain('g = 0 ⇒ p = 1')
    expect(poleTxt('R2')).toContain('g = 1 ⇒ p = 0')
    expect(poleTxt('R2')).toContain(`PM = ${calPhaseMarginDeg(1).toFixed(0)}°`)
    expect(poleTxt('R2')).toContain('μ = 1/K')
    expect(poleTxt('R4')).toContain('g = 2 ⇒ p = −1')
    expect(poleTxt('R4')).toContain(`PM = ${(90 - Math.asin(1) * (180 / Math.PI)).toFixed(0)}°`)
    expect(calPhaseMarginDeg(1)).toBeCloseTo(60, 10)
    expect(calPhaseMarginDeg(0.5)).toBeGreaterThan(60) // R1：g 在 0 與 1 之間 ⇒ PM 大於 60°
    expect(calPhaseMarginDeg(1.5)).toBeLessThan(60) // R3：g 在 1 與 2 之間 ⇒ PM 小於 60°
    expect(calPhaseMarginDeg(1.5)).toBeGreaterThan(0)
    expect(poleTxt('R1')).toContain('PM 大於 60°')
    expect(poleTxt('R3')).toContain('PM 小於 60°')

    // §14.2 (f)：回授為負、開迴路 L(z) = g/(z−1)、|L| = 1 ⇒ sin(ω_c/2) = g/2、PM = 90° − arcsin(g/2) ≥ PM_t ⇔ g ≤ 2cos PM_t
    const pm = (await flow(D.CHART_PM_LOOP))!
    expect(edgeText(pm, 'A', 'S')).toBe('＋')
    expect(edgeText(pm, 'INT', 'S')).toMatch(/^−.*w_k/)
    expect(edgeText(pm, 'S', 'GK')).toBe('δ_k = a − w_k')
    expect(pm.edges.some((e) => e.start === 'GK' && e.end === 'INT')).toBe(true)
    const pmTxt = (id: string) => pm.vertices.find((v) => v.id === id)?.text ?? ''
    expect(pmTxt('GK')).toContain('g = μ·K')
    expect(pmTxt('INT')).toContain('1/(z−1)')
    expect(pmTxt('LZ')).toContain('L(z) = g/(z−1)')
    expect(pmTxt('WC')).toContain('sin(ω_c/2) = g/2')
    expect(pmTxt('PMN')).toContain('PM = 180° + ∠L = 90° − arcsin(g/2)')
    expect(pmTxt('LIM')).toContain('g ≤ g_max = 2·cos PM_t')
    expect(pmTxt('MAXMU')).toContain('g_max = 1')
    expect(pmTxt('MAXMU')).toContain('μ ≤ 1/K')
    // 數值：g_max = 2cos PM_t 時 PM 剛好等於 PM_t（PM_t = 60° ⇒ g_max = 1）
    for (const t of [45, 60, 75]) {
      const gmax = gMaxForPm(t)
      expect(gmax).toBeCloseTo(2 * Math.cos((t * Math.PI) / 180), 12)
      expect(calPhaseMarginDeg(gmax)).toBeCloseTo(t, 8)
    }
    expect(gMaxForPm(60)).toBe(1)
    expect(calPhaseMarginDeg(2)).toBeCloseTo(0, 10)
    expect(pmTxt('EDGE')).toContain('g = 2：PM = 0°')

    // §14.6：資訊累加器 1/P_(k+1) = 1/P_k + K²/σ_η²
    const kal = (await flow(D.CHART_KALMAN_INFO))!
    expect(edgeText(kal, 'INF', 'SUM')).toBe('＋')
    expect(edgeText(kal, 'ZD', 'SUM')).toMatch(/^＋.*1\/P_k/)
    expect(edgeText(kal, 'SUM', 'ZD')).toBe('1/P_(k+1) = 1/P_k + K²/σ_η²')

    // §14.5、§14.7：w↑ ⇒ δ↓ ⇒ G↓，所以 K̂ = (Ḡ(−Δ) − Ḡ(+Δ))/(2Δ)
    for (const chart of [D.CHART_SLOPE_MEASURE, D.CHART_VERIFY_DECISION]) expect(chart).toContain('K̂ = (Ḡ(−Δ) − Ḡ(+Δ))/(2Δ)')
    expect(D.CHART_VERIFY_DECISION).toContain('δ̂ = ½·(Ḡ(+Δ) + Ḡ(−Δ))/K̂')

    // §14.5：下限由 K_min、上限由 K_max
    const corner = (await flow(D.CHART_CORNER_FLOW))!
    expect(corner.edges.some((e) => e.start === 'KMIN' && e.end === 'LO')).toBe(true)
    expect(corner.edges.some((e) => e.start === 'KMAX' && e.end === 'HI')).toBe(true)
    expect(corner.vertices.find((v) => v.id === 'LO')?.text).toContain('μ_min = (1 − ε^(1/B))/K_min')
    expect(corner.vertices.find((v) => v.id === 'HI')?.text).toContain('μ_max = 1/K_max')
    expect(corner.vertices.find((v) => v.id === 'CMP')?.text).toContain('B ≥ ln ε / ln(1 − K_min/K_max)')
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
    expect(D.CHART_CALC_VERIFY).toContain(`${Math.sqrt(msdAfterBlocks(m.delta0, 1 - g, 11.2, m.sigmaEta2, m.B)).toFixed(3)} fs`)
    expect(D.CHART_CALC_VERIFY).toContain((1 - g).toFixed(4))
    expect(D.CHART_CALC_VERIFY).toContain(`${calPhaseMarginDeg(g).toFixed(1)}°`)
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
    expect(D.CHART_HAND_FLOW).toContain(`μ = ${val(String.raw`\mu`).toFixed(2)} fs`)
    expect(D.CHART_HAND_FLOW).toContain(`p = ${val('p').toFixed(4)}`)
    expect(D.CHART_HAND_FLOW).toContain(`PM = ${val('PM').toFixed(1)}°`)
    expect(D.CHART_HAND_FLOW).toContain(`τ = ${val(String.raw`\tau`).toFixed(2)} blocks`)
    expect(D.CHART_HAND_FLOW).toContain(`RMS = ${val(String.raw`\sqrt{E[\delta_B^2]}`).toFixed(3)} fs`)
  })

  it('實際渲染（共用的 renderMermaidForTest）：每張都沒有「Unsupported markdown」、節點數不超過 14，畫面上的每個標籤都和原始碼相同', async () => {
    for (const c of CH14_CHARTS) {
      const { svg, text, nodeCount } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeGreaterThan(0)
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeLessThanOrEqual(14)
      const host = document.createElement('div')
      host.innerHTML = svg
      const shown = new Set(Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel')).map((e) => plain(e.textContent ?? '')))
      const g = await flow(c.chart)
      if (!g) continue
      for (const v of g.vertices) expect(shown.has(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text) expect(shown.has(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
    }
    // 章首的共用系統地圖（節點比單張章內圖多，所以不套 14 個節點的上限，只確認畫得出來）
    const map = await renderMermaidForTest(systemMapChart(CH14_SYSTEM_FOCUS))
    expect(map.text).not.toMatch(/Unsupported markdown/)
    expect(map.nodeCount).toBeGreaterThan(0)
  }, 300000)
})

describe('Ch14 頁面上的方塊圖（teaching-style §8）', () => {
  it('章首是 SystemMap（藍色：GMAC、÷N × μ、gain accumulator）；24 張圖各出現一次、順序與清單相同；每張都有圖說與「先看…」導讀，並放在對應公式之前', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = render(
      <MemoryRouter initialEntries={['/ch/14']}>
        <SettingsProvider>
          <Chapter14 />
        </SettingsProvider>
      </MemoryRouter>,
    )
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    const charts = figs.map((f) => f.getAttribute('data-chart'))
    // ① 系統地圖：第一張圖、在 14.0 之前、焦點是本章的三個方塊
    const mapChart = systemMapChart(CH14_SYSTEM_FOCUS)
    expect(CH14_SYSTEM_FOCUS).toEqual(['gmac', 'scale', 'acc'])
    expect(mapChart).toContain('class GMAC,SCALE,ACC focus')
    expect(charts[0]).toBe(mapChart)
    expect(charts.filter((c) => c === mapChart).length).toBe(1)
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
    expect(charts.length).toBe(1 + CH14_CHARTS.length)
    expect(charts.slice(1)).toEqual(CH14_CHARTS.map((c) => c.chart))

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
