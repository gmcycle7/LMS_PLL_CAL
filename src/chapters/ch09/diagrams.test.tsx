import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { SettingsProvider } from '@/app/settings'
import { SYSTEM_BLOCK_LABEL, stripMathDelimiters, systemMapChart } from '@/components'
import { mermaidMathDelimiters, sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { eigSym, matVec } from '@/simulation/core'
import { corr2, eigenModes, meanSquareRadius, pm1DegenerateProb, slidingWindowPe, stepsToDecay, stepsToDecayReal } from '@/simulation/models/pe'
import Chapter09 from './index'
import {
  CH09_DIAGRAMS,
  CHART_BLOCK_LOOP,
  CHART_COUPLED_MEAN,
  CHART_DC_NULL,
  CHART_EIGEN_MODES,
  CHART_ERROR_MODEL,
  CHART_GAUGE_LMS_PATH,
  CHART_GAUGE_SHIFT,
  CHART_IDENTIFIABLE_TREE,
  CHART_K95_FLOW,
  CHART_LINEAR_VS_SIGN,
  CHART_MATRIX_MACHINE,
  CHART_MEAN_VS_MS,
  CHART_PE_CONTRACTION,
  CHART_PE_WINDOW,
  CHART_PM1_DEGENERATE,
  CHART_PM1_STAIRCASE,
  CHART_RESTORING_FORCE,
  CHART_SCALAR_GAIN,
  CHART_SYNTHESIS_FLOW,
  CHART_TWO_KNOB,
  SYSTEM_FOCUS,
  ch09Diagram,
} from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

/**
 * Ch09 方塊圖的測試（docs/teaching-style.md §8）。
 *
 * 這個檔案用的是「真正的」mermaid：每張圖都經過真正的 parser；版面測試用真正的 renderer 畫成 SVG
 * （jsdom 沒有文字排版，補上 getBBox／getComputedTextLength 的替身就能跑完 layout）。
 * 唯一的例外是「整章渲染」那個測試：章節 DOM 有幾萬個節點，在 jsdom 裡每畫一張圖要好幾秒（20 張要一兩分鐘），
 * 所以那個測試把 render 換成「真正的 parser 驗語法＋回傳空的 SVG」（fast.on = true），圖的內容與版面由其他測試負責。
 *
 * 圖裡的數學一律是 LaTeX（使用者要求，2026-10-11）：標籤裡的 `$...$` 由共用的 Mermaid 元件用 KaTeX 排版。
 * 所以「particular label」的斷言比對的是圖的原始碼（flow() 取出的標籤就是原始碼裡的字串，含 `$...$`）；
 * 「真的畫一次」的測試另外檢查：畫出來的文字沒有殘留 `$`、每個含公式的標籤都由 KaTeX 排版（mathCount）、
 * KaTeX 以外的文字沒有 Unicode 拼的數學（unicodeMathIn），而且標籤的文字與數字都在圖上。
 */
const fast = vi.hoisted(() => ({ on: false, charts: [] as string[] }))
vi.mock('mermaid', async (importOriginal) => {
  const actual = (await importOriginal<typeof import('mermaid')>()).default
  const render: typeof actual.render = async (id, text, container) => {
    if (!fast.on) return actual.render(id, text, container)
    await actual.parse(text, { suppressErrors: false }) // 語法錯誤照樣會丟出來 ⇒ 頁面顯示「Mermaid 圖解析失敗」
    fast.charts.push(text)
    return { svg: `<svg id="${id}" data-fast-render="1"></svg>`, diagramType: 'flowchart-v2' }
  }
  return { default: { ...actual, render } }
})

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

/** 本章新增的方塊圖張數（不含章首的系統地圖）；頁面上的 Mermaid 圖總數 = 這個數 + 1 */
const DIAGRAM_COUNT = 20

interface FlowVertex {
  id: string
  text?: string
  type?: string
  classes?: string[]
}
interface FlowEdge {
  start: string
  end: string
  text: string
  stroke: string
  style?: string[]
}
interface FlowSubGraph {
  id: string
  title: string
  nodes: string[]
}
interface FlowDb {
  getVertices: () => Map<string, FlowVertex>
  getEdges: () => FlowEdge[]
  getSubGraphs: () => FlowSubGraph[]
  getDirection: () => string
}

/**
 * 用真正的 mermaid parser 解析一張 flowchart，取出節點、邊、subgraph（parse 會先註冊各種圖的 parser）。
 * 只為了版面而加的隱形連線（LIN ~~~ SGN：讓兩個 subgraph 上下並排）另外放在 layout，不算訊號線；
 * 它的兩端是 subgraph 的 id，也不算節點。
 */
async function flow(chart: string): Promise<{ v: Map<string, FlowVertex>; e: FlowEdge[]; sub: FlowSubGraph[]; dir: string; layout: FlowEdge[] }> {
  await mermaid.parse(chart, { suppressErrors: false })
  const d = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = d.db as unknown as FlowDb
  // parser 會把文字裡的 < > 轉成 HTML entity（所以畫面上是文字、不會被當成 tag）；比對前先還原
  const plain = (t: string | undefined) => (t ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const sub = db.getSubGraphs()
  const subIds = new Set(sub.map((s) => s.id))
  const v = new Map([...db.getVertices()].filter(([id]) => !subIds.has(id)).map(([id, x]) => [id, { ...x, text: plain(x.text) }]))
  const all = db.getEdges().map((x) => ({ ...x, text: plain(x.text) }))
  const layout = all.filter((x) => x.stroke === 'invisible')
  for (const x of layout) {
    expect(subIds.has(x.start), `隱形連線只接 subgraph：${x.start}`).toBe(true)
    expect(subIds.has(x.end), `隱形連線只接 subgraph：${x.end}`).toBe(true)
  }
  return { v, e: all.filter((x) => x.stroke !== 'invisible'), sub, dir: db.getDirection(), layout }
}

/** 從 a 到 b 的那一條邊（恰好一條） */
function edge(e: FlowEdge[], a: string, b: string): FlowEdge {
  const hits = e.filter((x) => x.start === a && x.end === b)
  expect(hits, `${a} → ${b}`).toHaveLength(1)
  return hits[0]
}

/** 原始碼裡的公式片段：`$$…$$` 或 `$…$`（與 mermaidSource.ts 的 MATH_SEGMENT 相同） */
const MATH_RE = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
const mathSegments = (src: string): string[] => [...src.matchAll(MATH_RE)].map((m) => m[1] ?? m[2])
/** KaTeX 輸出的文字有零寬空白（下標之後）與換行；連字號也有好幾種寫法：比對前一律正規化 */
const squash = (t: string): string => t.replace(/[\s\u200b]+/g, '').replace(/[\u2010\u2011\u2012\u2013]/g, '-')
/** 公式以外的文字（拿掉公式片段與 <br/>） */
const textOutsideMath = (src: string): string => src.replace(MATH_RE, ' ').replace(/<br\s*\/?>/g, ' ')
/** 標籤裡公式以外的文字片段（公式與 <br/> 是分隔），已正規化空白 */
const textParts = (src: string): string[] =>
  src
    .replace(MATH_RE, '\u0000')
    .replace(/<br\s*\/?>/g, '\u0000')
    .split('\u0000')
    .map((t) => squash(t))
    .filter(Boolean)
/** 有公式的標籤數 = 畫出來的 KaTeX 數：雙引號標籤（節點、連線、subgraph／state 標題）＋ stateDiagram 轉移的 `$$…$$` */
const mathLabelCount = (chart: string): number => (chart.match(/"[^"\n]*\$[^"\n]*"/g) ?? []).length + (chart.match(/: \$\$/g) ?? []).length

const ALL_CHARTS: [string, string][] = [
  ['CHART_TWO_KNOB', CHART_TWO_KNOB],
  ['CHART_MATRIX_MACHINE', CHART_MATRIX_MACHINE],
  ['CHART_ERROR_MODEL', CHART_ERROR_MODEL],
  ['CHART_BLOCK_LOOP', CHART_BLOCK_LOOP],
  ['CHART_COUPLED_MEAN', CHART_COUPLED_MEAN],
  ['CHART_EIGEN_MODES', CHART_EIGEN_MODES],
  ['CHART_K95_FLOW', CHART_K95_FLOW],
  ['CHART_SCALAR_GAIN', CHART_SCALAR_GAIN],
  ['CHART_MEAN_VS_MS', CHART_MEAN_VS_MS],
  ['CHART_PM1_STAIRCASE', CHART_PM1_STAIRCASE],
  ['CHART_LINEAR_VS_SIGN', CHART_LINEAR_VS_SIGN],
  ['CHART_PE_WINDOW', CHART_PE_WINDOW],
  ['CHART_PE_CONTRACTION', CHART_PE_CONTRACTION],
  ['CHART_PM1_DEGENERATE', CHART_PM1_DEGENERATE],
  ['CHART_GAUGE_SHIFT', CHART_GAUGE_SHIFT],
  ['CHART_DC_NULL', CHART_DC_NULL],
  ['CHART_GAUGE_LMS_PATH', CHART_GAUGE_LMS_PATH],
  ['CHART_RESTORING_FORCE', CHART_RESTORING_FORCE],
  ['CHART_IDENTIFIABLE_TREE', CHART_IDENTIFIABLE_TREE],
  ['CHART_SYNTHESIS_FLOW', CHART_SYNTHESIS_FLOW],
]

/** stateDiagram-v2 的圖（沒有 flowchart 的節點／邊資料庫）；其餘全是 flowchart */
const STATE_CHARTS = new Set(['CHART_PM1_STAIRCASE'])
const FLOW_CHARTS = ALL_CHARTS.filter(([name]) => !STATE_CHARTS.has(name))

describe('Ch09 方塊圖：Mermaid 原始碼（真正的 mermaid parser）', () => {
  it(`清單有 ${DIAGRAM_COUNT} 張圖，每個具名匯出的圖都在清單裡恰好一次，代號不重複`, () => {
    expect(CH09_DIAGRAMS).toHaveLength(DIAGRAM_COUNT)
    expect(ALL_CHARTS).toHaveLength(DIAGRAM_COUNT)
    expect(new Set(CH09_DIAGRAMS.map((d) => d.id)).size).toBe(DIAGRAM_COUNT)
    expect(new Set(CH09_DIAGRAMS.map((d) => d.chart)).size).toBe(DIAGRAM_COUNT)
    // 清單的順序就是具名匯出（＝頁面）的順序
    expect(CH09_DIAGRAMS.map((d) => d.chart)).toEqual(ALL_CHARTS.map(([, c]) => c))
    for (const d of CH09_DIAGRAMS) {
      expect(d.alt.length, d.id).toBeGreaterThan(15)
      expect(d.alt, d.id).not.toMatch(/[$\\]/) // aria-label 是純文字
      if (d.formulaId) expect(FORMULAS.some((f) => f.id === d.formulaId), d.id).toBe(true)
    }
    expect(ch09Diagram('two-knob').number).toBe(1)
    expect(ch09Diagram('synthesis-flow').number).toBe(DIAGRAM_COUNT)
    expect(() => ch09Diagram('no-such-diagram')).toThrow(/找不到/)
    // teaching-style §8 的種類至少各有一張（系統地圖在章首另外放）
    for (const kind of ['數學模型', '演算法迴圈', '路徑／轉移函數', '比較', '手算流程', '決策樹', '狀態圖']) expect(CH09_DIAGRAMS.some((d) => d.kind === kind), kind).toBe(true)
  })

  it.each(ALL_CHARTS)('%s 可以解析（flowchart 或 stateDiagram）', async (name, chart) => {
    const r = await mermaid.parse(chart, { suppressErrors: false })
    const type = r && typeof r === 'object' ? r.diagramType : String(r)
    if (STATE_CHARTS.has(name)) expect(type).toMatch(/^stateDiagram/)
    else expect(type).toBe('flowchart-v2')
    // 頁面真正送進 Mermaid 的是前處理之後的字串（含公式的標籤合併成單一 `$$…$$`）：這個也要能解析
    await mermaid.parse(sanitizeMermaidSource(chart), { suppressErrors: false })
  })

  it('章首系統地圖：本章標示的四個方塊可以解析，且真的被標成 focus', async () => {
    const chart = systemMapChart(SYSTEM_FOCUS)
    expect(SYSTEM_FOCUS).toEqual(['res', 'align', 'gmac', 'acc'])
    expect(chart).toContain('class RES,ALIGN,GMAC,ACC focus')
    const { v } = await flow(chart)
    const focused = [...v.values()].filter((x) => x.classes?.includes('focus')).map((x) => x.id)
    expect(focused.sort()).toEqual(['ACC', 'ALIGN', 'GMAC', 'RES'])
  })

  it('每張圖：節點不超過 14 個、強調色只用 focus／warn／ok、每個節點都有連線、原始碼沒有會被吃掉的字元', async () => {
    for (const [name, chart] of ALL_CHARTS) {
      // 所有圖（含 stateDiagram）：「<」只能是 <br/> 或後面跟空白；不用全形空白（eslint no-irregular-whitespace）
      expect(chart.replace(/<br\/>/g, ''), name).not.toMatch(/<\S/)
      expect(chart.includes(String.fromCharCode(0x3000)), name).toBe(false)
      // 圖裡的數學是 LaTeX（`$...$`）：每張圖都有公式，公式以外的文字沒有 Unicode 拼的數學
      expect(mathLabelCount(chart), name).toBeGreaterThan(0)
      expect(unicodeMathIn(textOutsideMath(chart)), `${name}：公式以外的文字還有 Unicode 數學`).toEqual([])
      for (const seg of mathSegments(chart)) {
        // 公式裡只有 ASCII 的 TeX（減號寫 -、乘號寫 \times…；\text{…} 內的中文除外）；大小比較寫 \lt \gt（Mermaid 會把 < > 當成 HTML 改寫）
        expect(unicodeMathIn(seg.replace(/[_^]/g, '')), `${name}：${seg}`).toEqual([])
        expect(seg.replace(/\\text\{[^}]*\}/g, ''), `${name}：${seg}`).not.toMatch(/[<>−＋]/)
        expect(seg, name).not.toMatch(/\\\\/) // 標籤內不用 \\（Mermaid 會把它收成一個反斜線；矩陣換列用 \cr）
      }
    }
    for (const [name, chart] of FLOW_CHARTS) {
      const { v, e } = await flow(chart)
      expect(v.size, name).toBeGreaterThanOrEqual(4)
      expect(v.size, name).toBeLessThanOrEqual(14)
      const used = new Set(e.flatMap((x) => [x.start, x.end]))
      for (const x of v.values()) {
        expect(used.has(x.id), `${name}: 節點 ${x.id} 沒有任何連線`).toBe(true)
        expect((x.text ?? '').trim().length, `${name}: 節點 ${x.id} 沒有文字`).toBeGreaterThan(0)
        for (const c of x.classes ?? []) expect(['focus', 'warn', 'ok'], `${name}: ${x.id}`).toContain(c)
      }
      for (const x of e) {
        expect(v.has(x.start), `${name}: ${x.start}`).toBe(true)
        expect(v.has(x.end), `${name}: ${x.end}`).toBe(true)
      }
    }
  })

  it('標籤不會被當成 Markdown：沒有單獨的 + / -，也沒有任何一行以「+ 」「- 」「* 」「1. 」「# 」開頭（原始碼直接寫對，不靠元件替換）', async () => {
    const hazard = (t: string): string | null => {
      for (const line of t.split(/<br\s*\/?>|\n/)) {
        const x = line.trim()
        if (/^[-+*]$/.test(x) || /^([-+*]|\d+\.|#{1,6}) /.test(x)) return x
      }
      return null
    }
    for (const [name, chart] of FLOW_CHARTS) {
      const { v, e } = await flow(chart)
      for (const x of v.values()) expect(hazard(x.text ?? ''), `${name} 節點 ${x.id}`).toBeNull()
      for (const x of e) expect(hazard(x.text), `${name} 邊 ${x.start}→${x.end}`).toBeNull()
      // 原始碼本身不出現會被元件替換的半形 "+" / "-" 標籤
      expect(chart, name).not.toMatch(/"[+-]"|"[+*-] |\(\(\s*"?[+-]"?\s*\)\)/)
    }
    // 共用元件的前處理（sanitizeMermaidSource）對本章的原始碼只做一件事：把含公式的標籤合併成單一的 `$$…$$`
    // （沒有半形 + / - 標籤需要替換）：頁面送進 Mermaid 的字串＝ mermaidMathDelimiters(diagrams.ts 的字串)
    for (const [name, chart] of ALL_CHARTS) expect(sanitizeMermaidSource(chart), name).toBe(mermaidMathDelimiters(chart))
    // stateDiagram：狀態說明與轉移文字逐行檢查
    for (const [name, chart] of ALL_CHARTS.filter(([n]) => STATE_CHARTS.has(n))) {
      for (const line of chart.split('\n')) expect(hazard(line.split(' : ')[1] ?? ''), `${name}: ${line}`).toBeNull()
    }
  })

  it('加法點：每一條進入 (("＋")) 的線都標了 ＋ 或 −', async () => {
    let junctions = 0
    for (const [name, chart] of FLOW_CHARTS) {
      const { v, e } = await flow(chart)
      for (const x of v.values()) {
        if (x.type !== 'circle') continue
        expect(x.text, `${name}: 圓形節點只用在加法點`).toBe('＋')
        junctions++
        const incoming = e.filter((y) => y.end === x.id)
        expect(incoming.length, `${name}: 加法點 ${x.id} 至少兩個輸入`).toBeGreaterThanOrEqual(2)
        for (const y of incoming) expect(y.text, `${name}: ${y.start} → ${x.id}`).toMatch(/^[＋−]/)
        expect(e.filter((y) => y.start === x.id), `${name}: 加法點 ${x.id} 只有一個輸出`).toHaveLength(1)
      }
    }
    expect(junctions).toBeGreaterThanOrEqual(15)
  })
})

describe('Ch09 方塊圖：正負號、箭頭方向、取樣率與正文公式一致', () => {
  it('圖 9.1 黑盒子：e = y − ŷ（y 標 +、ŷ 標 −），黑盒子裡是 a、旋鈕是 w', async () => {
    const { v, e, sub } = await flow(CHART_TWO_KNOB)
    expect(edge(e, 'SY', 'SE').text).toBe('＋ $y$')
    expect(edge(e, 'SH', 'SE').text).toBe(String.raw`− $\hat y$`)
    expect(v.get('E')?.text).toContain(String.raw`$e = y - \hat y$`)
    expect(v.get('E')?.text).toContain('$= u_1(a_1 - w_1) + u_2(a_2 - w_2)$') // 真值減旋鈕
    expect(sub.find((s) => s.id === 'BOX')?.nodes.sort()).toEqual(['A1', 'A2', 'SY'])
    expect(sub.find((s) => s.id === 'KNOB')?.nodes.sort()).toEqual(['SH', 'W1', 'W2'])
    // 同一個 u_i 同時送進黑盒子與旋鈕
    for (const [u, a, w] of [['U1', 'A1', 'W1'], ['U2', 'A2', 'W2']]) {
      edge(e, u, a)
      edge(e, u, w)
    }
  })

  it('圖 9.2 R 這台機器：三列的數字就是 matVec(R, x)（ρ = 0.99）', () => {
    const R = corr2(0.99)
    const cm = matVec(R, [1, 1])
    const dm = matVec(R, [1, -1])
    const one = matVec(R, [1, 0])
    expect(cm[0]).toBeCloseTo(1.99, 12)
    expect(cm[1]).toBeCloseTo(1.99, 12)
    expect(dm[0]).toBeCloseTo(0.01, 12)
    expect(dm[1]).toBeCloseTo(-0.01, 12)
    expect(one[0]).toBeCloseTo(1, 12)
    expect(one[1]).toBeCloseTo(0.99, 12)
    expect(CHART_MATRIX_MACHINE).toContain(String.raw`$(1.99, 1.99) = 1.99 \times (1, 1)$`)
    expect(CHART_MATRIX_MACHINE).toContain(String.raw`$(0.01, -0.01) = 0.01 \times (1, -1)$`)
    expect(CHART_MATRIX_MACHINE).toContain('$(1, 0.99)$')
    const modes = eigenModes(R, 0.5)
    expect(modes.lambdas[0]).toBeCloseTo(1.99, 12)
    expect(modes.lambdas[1]).toBeCloseTo(0.01, 12)
    expect(CHART_MATRIX_MACHINE).toContain(String.raw`$\lambda = 1.99$`)
    expect(CHART_MATRIX_MACHINE).toContain(String.raw`$\lambda = 0.01$`)
  })

  it('圖 9.3 誤差模型（F-09.1）：δ_i = a_i − w_i、e[n] = uᵀδ_k + v[n]，雜訊以 + 進入同一個加法點', async () => {
    const { v, e } = await flow(CHART_ERROR_MODEL)
    for (const [d, i] of [['D1', '1'], ['D2', '2'], ['DM', 'M']]) {
      expect(v.get(d)?.text).toContain(String.raw`$\delta_${i} = a_${i} - w_${i}$`)
      expect(edge(e, d, 'S').text).toBe('＋')
    }
    expect(edge(e, 'V', 'S').text).toBe('＋')
    expect(v.get('E')?.text).toContain(String.raw`$e[n] = \mathbf u[n]^T \boldsymbol\delta_k + v[n]$`)
    expect(FORMULAS.find((f) => f.id === 'F-09.1')?.tex).toContain(String.raw`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`)
  })

  it('圖 9.4 block LMS（F-09.2／F-09.3）：δ_k = a − w_k、w_(k+1) = w_k + μG_k、G_k 是 block 平均、延遲是一個 block', async () => {
    const { v, e, dir } = await flow(CHART_BLOCK_LOOP)
    expect(dir).toBe('TB')
    // δ = a − w：真值 +、係數 −
    expect(edge(e, 'A', 'SD').text).toBe('＋')
    expect(edge(e, 'Z', 'SD').text).toBe(String.raw`− $\mathbf w_k$`)
    expect(edge(e, 'SD', 'DOT').text).toBe(String.raw`$\boldsymbol\delta_k = \mathbf a - \mathbf w_k$`)
    // e = uᵀδ + v
    expect(edge(e, 'DOT', 'SE').text).toBe('＋')
    expect(edge(e, 'V', 'SE').text).toBe('＋')
    expect(edge(e, 'SE', 'DET').text).toContain('e[n]')
    // 偵測器 → 相關（regressor 同時進內積與相關器）→ GMAC 平均
    edge(e, 'U', 'DOT')
    edge(e, 'U', 'COR')
    edge(e, 'DET', 'COR')
    expect(v.get('DET')?.text).toContain('$t = e$')
    expect(v.get('DET')?.text).toContain(String.raw`$t = \mathrm{sign}(e)$`)
    expect(v.get('AVG')?.text).toContain(String.raw`$\mathbf G_k = (1/N) \sum t[n] \cdot \mathbf u[n]$`) // 平均，不是總和
    expect(edge(e, 'AVG', 'MU').text).toContain('每個 block')
    // 累加器：w_(k+1) = w_k + μG_k，z⁻¹ 是一個 block
    expect(edge(e, 'MU', 'ACC').text).toBe('＋')
    expect(edge(e, 'Z', 'ACC').text).toBe(String.raw`＋ $\mathbf w_k$`)
    expect(edge(e, 'ACC', 'Z').text).toBe(String.raw`$\mathbf w_{k+1}$`)
    expect(v.get('Z')?.text).toMatch(/z\^\{-1\}.*一個 block/)
  })

  it('圖 9.5 耦合的平均遞迴：E[δ₁] ← E[δ₁] − g(E[δ₁] + ρE[δ₂])；紅色的線恰好是兩條係數 ρ 的交叉路徑', async () => {
    const { v, e } = await flow(CHART_COUPLED_MEAN)
    // 進入加法點的係數就是 R = [[1, ρ], [ρ, 1]] 的元素：對角 1、非對角 ρ
    expect(edge(e, 'D1', 'S1').text).toBe(String.raw`＋ $1 \cdot E[\delta_1]$`)
    expect(edge(e, 'D2', 'S2').text).toBe(String.raw`＋ $1 \cdot E[\delta_2]$`)
    expect(edge(e, 'D2', 'S1').text).toBe(String.raw`＋ $\rho \cdot E[\delta_2]$（交叉）`)
    expect(edge(e, 'D1', 'S2').text).toBe(String.raw`＋ $\rho \cdot E[\delta_1]$（交叉）`)
    for (const c of [edge(e, 'D2', 'S1'), edge(e, 'D1', 'S2')]) expect(c.style?.join(';')).toContain('stroke:#d92d20')
    // 只有這兩條被上色
    expect(e.filter((x) => x.style?.some((s) => s.includes('#d92d20')))).toHaveLength(2)
    for (const i of ['1', '2']) {
      expect(edge(e, `S${i}`, `M${i}`).text).toBe(`$E[G_${i}] / K_q$`)
      expect(v.get(`M${i}`)?.text).toContain(String.raw`$g = \mu K_q$`)
      expect(edge(e, `D${i}`, `A${i}`).text).toBe('＋')
      expect(edge(e, `M${i}`, `A${i}`).text).toBe('−') // δ ← δ − g·(Rδ)
      edge(e, `A${i}`, `N${i}`)
      expect(v.get(`D${i}`)?.text).toContain('第 $k$ 個 block')
      expect(v.get(`N${i}`)?.text).toContain('第 $k+1$ 個 block')
      expect(v.get(`N${i}`)?.text).toContain('$z^{-1}$') // 延遲一個 block 之後才是下一輪的輸入
    }
    // 只畫一個 block（展開成 k → k+1）：圖上沒有迴圈，dagre 才會排成「兩列、交叉線在中間」
    expect(e.filter((x) => x.end === 'D1' || x.end === 'D2')).toHaveLength(0)
    // 數值驗算：照圖走一步 = (I − gR)δ（ρ = 0.8、g = 0.5、δ = (0, 1)，正文「先算一次」的例子）
    const rho = 0.8
    const g = 0.5
    const d = [0, 1]
    const byDiagram = [d[0] - g * (1 * d[0] + rho * d[1]), d[1] - g * (rho * d[0] + 1 * d[1])]
    const Rd = matVec(corr2(rho), d)
    expect(byDiagram[0]).toBeCloseTo(d[0] - g * Rd[0], 14)
    expect(byDiagram[1]).toBeCloseTo(d[1] - g * Rd[1], 14)
    expect(byDiagram[0]).toBeCloseTo(-0.4, 14)
    expect(byDiagram[1]).toBeCloseTo(0.5, 14)
  })

  it('圖 9.6 eigen-mode（F-09.4）：旋轉 Qᵀ → 兩條互不相連的一階迴路 p_i = 1 − g·λ_i → 轉回 Q', async () => {
    const { v, e } = await flow(CHART_EIGEN_MODES)
    expect(v.get('QT')?.text).toContain(String.raw`$\mathbf c_k = \mathbf Q^T \cdot E[\boldsymbol\delta_k]$`)
    expect(v.get('Q')?.text).toContain(String.raw`$E[\boldsymbol\delta_{k+1}] = \mathbf Q \cdot \mathbf c_{k+1}$`)
    expect(v.get('P1')?.text).toContain(String.raw`$p_1 = 1 - g \cdot \lambda_1$`)
    expect(v.get('P2')?.text).toContain(String.raw`$p_2 = 1 - g \cdot \lambda_2$`)
    // 兩個模式之間沒有任何交叉連線（decoupled）
    expect(e.filter((x) => (x.start === 'P1' && x.end === 'P2') || (x.start === 'P2' && x.end === 'P1'))).toHaveLength(0)
    expect(edge(e, 'QT', 'P1').text).toContain(String.raw`$\mathbf v_1$`)
    expect(edge(e, 'QT', 'P2').text).toContain(String.raw`$\mathbf v_2$`)
    // 回授是虛線、一個 block 的延遲
    const fb = edge(e, 'Q', 'D')
    expect(fb.stroke).toBe('dotted')
    expect(fb.text).toContain('$z^{-1}$')
    // 慢模式（λ 小）標成 warn
    expect(v.get('P2')?.classes).toContain('warn')
    expect(FORMULAS.find((f) => f.id === 'F-09.4')?.tex).toContain(String.raw`p_i=1-\mu K_q\lambda_i(\mathbf R)`)
  })

  it('T10/T11: 圖 9.7 的數字（1.99、0.01、199、0.005、0.995、597.65、598）都由模型算得出來', () => {
    const modes = eigenModes(corr2(0.99), 0.5)
    expect(modes.lambdas[0]).toBeCloseTo(1.99, 12)
    expect(modes.lambdas[1]).toBeCloseTo(0.01, 12)
    expect(modes.kappa).toBeCloseTo(199, 9)
    expect(modes.poles[0]).toBeCloseTo(0.005, 12)
    expect(modes.poles[1]).toBeCloseTo(0.995, 12)
    expect(modes.k95[1]).toBe(598)
    expect(stepsToDecay(0.995)).toBe(598)
    expect(stepsToDecayReal(0.995).toFixed(2)).toBe('597.65')
    for (const s of [
      String.raw`\rho = 0.99`,
      String.raw`g = \mu K_q = 0.5`,
      String.raw`\lambda_{\max} = 1.99`,
      String.raw`\lambda_{\min} = 0.01`,
      '= 199',
      String.raw`p_1 = 1 - g \cdot \lambda_{\max} = 0.005`,
      String.raw`p_2 = 1 - g \cdot \lambda_{\min} = 0.995`,
      String.raw`= \lceil 597.65 \rceil = 598$ blocks`,
      String.raw`\ln 0.05 \div \ln 0.995`,
    ])
      expect(CHART_K95_FLOW, s).toContain(s)
    // 「否」的兩種情形與正文一致：gλ_max ≥ 2 發散；λ_min = 0 時 p = 1（不動）
    expect(CHART_K95_FLOW).toContain(String.raw`$g \cdot \lambda_{\max} \ge 2$`)
    expect(eigenModes(corr2(0.99), 2 / 1.99 + 1e-9).poles[0]).toBeLessThan(-1)
    expect(eigenModes(corr2(1), 0.5).poles[1]).toBeCloseTo(1, 12)
  })

  it('圖 9.8（F-09.7）：g⋆ = 2/(λ_max + λ_min)、收斂率 (κ − 1)/(κ + 1)；快模式那一格才有 g 的上限 2/λ_max', async () => {
    const { v, e } = await flow(CHART_SCALAR_GAIN)
    expect(v.get('F')?.text).toContain(String.raw`$|1 - g \cdot \lambda_{\max}|$`)
    expect(v.get('F')?.text).toContain(String.raw`$g$ 到 $2 / \lambda_{\max}$ 就不再小於 1`)
    expect(v.get('S')?.text).toContain(String.raw`直到 $g = 1 / \lambda_{\min}$`)
    expect(v.get('S')?.text).toContain(String.raw`$|1 - g \cdot \lambda_{\min}|$`)
    expect(v.get('OPT')?.text).toContain(String.raw`$g^\star = 2 / (\lambda_{\max} + \lambda_{\min})$`)
    expect(v.get('OPT')?.text).toContain(String.raw`$= (\kappa - 1) / (\kappa + 1)$`)
    edge(e, 'F', 'MAX')
    edge(e, 'S', 'MAX')
    // 數值：ρ = 0.99 ⇒ g⋆ = 1、收斂率 0.99，兩個模式的倍數相等
    const [lmax, lmin] = eigenModes(corr2(0.99), 1).lambdas
    const gStar = 2 / (lmax + lmin)
    expect(Math.abs(1 - gStar * lmax)).toBeCloseTo(Math.abs(1 - gStar * lmin), 12)
    expect(Math.abs(1 - gStar * lmin)).toBeCloseTo((lmax / lmin - 1) / (lmax / lmin + 1), 12)
  })

  it('E23: 圖 9.9 的數字：mean 的慢 pole 0.995 → 598；N = 1 Gaussian 的 ρ_MS = 1.98 > 1；N = 2 回到 1 以下', async () => {
    const ms1 = meanSquareRadius('gaussian', 0.99, 0.5, 1)
    const ms2 = meanSquareRadius('gaussian', 0.99, 0.5, 2)
    expect(ms1.toFixed(2)).toBe('1.98')
    expect(ms1).toBeGreaterThan(1)
    expect(ms2).toBeLessThan(1)
    // N 很大時 ρ_MS → max p²
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1e6)).toBeCloseTo(0.995 ** 2, 5)
    const { v } = await flow(CHART_MEAN_VS_MS)
    expect(v.get('MR')?.text).toContain(String.raw`慢 pole 0.995 $\to$ 598 blocks`)
    expect(v.get('MSR')?.text).toContain(String.raw`$N = 1$、Gaussian：$1.98 \gt 1$（發散）`)
    expect(v.get('MSN')?.text).toContain('$N = 2$ 就回到 1 以下')
    expect(v.get('MSN')?.text).toContain(String.raw`$\rho_{\mathrm{MS}} \to$ 最大的 $p^2$`)
    expect(v.get('MSR')?.classes).toContain('warn')
  })

  it('E23: 圖 9.10 ±1 code 的階梯：停在初值的機率 (1+ρ)/2 = 0.995、第一個 flip 的機率 (1−ρ)/2 = 0.005；I − 0.5·uuᵀ 對差模「不動或整個消掉」', () => {
    const rho = 0.99
    expect((1 + rho) / 2).toBeCloseTo(0.995, 12)
    expect((1 - rho) / 2).toBeCloseTo(0.005, 12)
    // 結構：起點 → 平台、平台自環（沒有 flip）、平台 → 歸零（第一個 flip）、歸零自環（之後維持 0）
    const c = CHART_PM1_STAIRCASE
    expect(c).toMatch(/^stateDiagram-v2/)
    expect(c).toContain('[*] --> PLATEAU')
    // 轉移的文字沒有引號，整句寫成單一的 `$$\text{…}…$$`
    expect(c).toContain(String.raw`PLATEAU --> PLATEAU : $$\text{沒有 flip（}s = +1\text{），機率 }(1 + \rho)/2 = 0.995$$`)
    expect(c).toContain(String.raw`PLATEAU --> ZERO : $$\text{出現第一個 flip（}s = -1\text{），機率 }(1 - \rho)/2 = 0.005$$`)
    expect(c).toMatch(/ZERO --> ZERO : /)
    expect(c).not.toMatch(/ZERO --> PLATEAU/) // 歸零之後不會再回到平台
    expect(c).toContain('差模 $c_2$ 還是初值 $c_{2,0}$')
    expect(c).toContain('差模 $c_2 = 0$')
    // 數值：u = (u₁, s·u₁)、u₁ = ±1 ⇒ uuᵀ = [[1, s], [s, 1]]；g = 0.5 時 I − g·uuᵀ 是投影
    const step = (s: number) => [
      [1 - 0.5, -0.5 * s],
      [-0.5 * s, 1 - 0.5],
    ]
    const cm = [1, 1]
    const dm = [1, -1]
    const near = (got: ArrayLike<number>, want: number[]) => want.forEach((x, i) => expect(got[i]).toBeCloseTo(x, 14))
    near(matVec(step(1), dm), [1, -1]) //  s = +1：差模原封不動
    near(matVec(step(1), cm), [0, 0]) //   共模消掉
    near(matVec(step(-1), dm), [0, 0]) //  s = −1：差模消掉（flip）
    near(matVec(step(-1), cm), [1, 1]) //  共模不動
    // 模型：N = 1、g = 0.5 的 ±1 code，均方半徑 = 差模每個 sample 的倍數 = 0.995（Gaussian 同樣參數是 1.98 > 1）
    expect(meanSquareRadius('pm1', rho, 0.5, 1)).toBeCloseTo(0.995, 9)
    expect(meanSquareRadius('gaussian', rho, 0.5, 1)).toBeGreaterThan(1)
  })

  it('圖 9.11（F-09.8 vs. F-09.18）：linear 的 (g²/N)·K(P) 與 1-bit 的 (μ²/N)·R 各在自己的框裡', async () => {
    const { v, sub, layout } = await flow(CHART_LINEAR_VS_SIGN)
    // 兩個框上下並排（linear 在上）：靠一條隱形連線，沒有它 dagre 會把兩個框排成左右並列
    expect(layout.map((x) => `${x.start}>${x.end}`)).toEqual(['LIN>SGN'])
    expect(sub.find((s) => s.id === 'LIN')?.title).toContain('$t = e$')
    expect(sub.find((s) => s.id === 'SGN')?.title).toContain(String.raw`$t = q = \mathrm{sign}(e)$`)
    expect(sub.find((s) => s.id === 'LIN')?.nodes.sort()).toEqual(['L1', 'L2', 'L3'])
    expect(sub.find((s) => s.id === 'SGN')?.nodes.sort()).toEqual(['S1', 'S2', 'S3'])
    expect(v.get('L3')?.text).toContain(String.raw`$(g^2/N) \cdot K(\mathbf P)$`)
    expect(v.get('S1')?.text).toContain('$q^2 = 1$')
    expect(v.get('S3')?.text).toContain(String.raw`$(\mu^2/N) \cdot \mathbf R$`)
    expect(FORMULAS.find((f) => f.id === 'F-09.18')?.tex).toContain(String.raw`\tfrac{\mu^2}{N}\mathbf R`)
    // 同樣 g = 0.5、N = 1：linear 發散、1-bit 的齊次倍數小於 1
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1, 'linear')).toBeGreaterThan(1)
    expect(meanSquareRadius('gaussian', 0.99, 0.5, 1, 'sign')).toBeLessThan(1)
  })

  it('圖 9.12（F-09.9／F-09.10）：u → 外積 → 窗口相加 S_k → ÷N₀ → R_k → eigenvalues → α、β 判斷；每個 k 都要合格', async () => {
    const { v, e } = await flow(CHART_PE_WINDOW)
    const chain = ['U', 'OP', 'WIN', 'NORM', 'EIG', 'CHK']
    for (let i = 0; i + 1 < chain.length; i++) edge(e, chain[i], chain[i + 1])
    expect(v.get('WIN')?.text).toContain(String.raw`$n = k \dots k + N_0 - 1$`)
    expect(v.get('NORM')?.text).toContain(String.raw`$\mathbf R_k = \mathbf S_k / N_0$`)
    expect(v.get('KAP')?.text).toContain(String.raw`$\sigma_i(\mathbf U_k) = \sqrt{N_0 \cdot \lambda_i(\mathbf R_k)}$`)
    // λ(S_k) = N₀·λ(R_k)：判斷式用 N₀·λ 才和 F-09.9（對 S_k 的不等式）一致
    expect(v.get('CHK')?.text).toContain(String.raw`$N_0 \cdot \lambda_{\min}(\mathbf R_k) \ge \alpha$`)
    expect(v.get('CHK')?.text).toContain(String.raw`$N_0 \cdot \lambda_{\max}(\mathbf R_k) \le \beta$`)
    expect(v.get('CHK')?.type).toBe('diamond')
    expect(edge(e, 'CHK', 'NEXT').text).toBe('是')
    expect(edge(e, 'CHK', 'BAD').text).toBe('否')
    const loop = edge(e, 'NEXT', 'WIN')
    expect(loop.stroke).toBe('dotted')
    expect(loop.text).toContain('每一個 $k$')
  })

  it('圖 9.13（F-09.17）：每個窗口的倍數是 1 − μ·λ_min(R_k)，PE 下界 λ_min(R_k) ≥ α/N₀，條件 0 < μ ≤ 1/λ_max', async () => {
    const { v, e } = await flow(CHART_PE_CONTRACTION)
    expect(edge(e, 'D0', 'D1').text).toContain(String.raw`$1 - \mu \cdot \lambda_{\min}(\mathbf R_0)$`)
    expect(edge(e, 'D1', 'D2').text).toContain(String.raw`$1 - \mu \cdot \lambda_{\min}(\mathbf R_1)$`)
    expect(v.get('DK')?.text).toContain(String.raw`(1 - \mu\alpha/N_0)^K`)
    expect(v.get('PE')?.text).toContain(String.raw`$\lambda_{\min}(\mathbf R_k) \ge \alpha / N_0$`)
    expect(v.get('PE')?.text).toContain(String.raw`$0 \lt \mu \le 1 / \lambda_{\max}(\mathbf R_k)$`)
    expect(FORMULAS.find((f) => f.id === 'F-09.17')?.tex).toContain(String.raw`0<\mu\le1/\lambda_{\max}(\mathbf R_k)`)
  })

  it('F-09.11: 圖 9.14 ±1 code 的窗口 S_k = [[N₀, N₊−N₋], [N₊−N₋, N₀]]，λ_min = 2·min(N₊, N₋)，只有 s 全同號才退化，機率 0.606', async () => {
    const { v, e } = await flow(CHART_PM1_DEGENERATE)
    const chain = ['CODE', 'WIN', 'SK', 'ALL']
    for (let i = 0; i + 1 < chain.length; i++) edge(e, chain[i], chain[i + 1])
    expect(v.get('ALL')?.type).toBe('diamond')
    expect(edge(e, 'ALL', 'BAD').text).toBe('是')
    expect(edge(e, 'ALL', 'GOOD').text).toBe('否')
    expect(edge(e, 'BAD', 'NUM').stroke).toBe('dotted')
    expect(v.get('CODE')?.text).toContain(String.raw`$P(s = +1) = (1 + \rho)/2$`)
    expect(v.get('SK')?.text).toContain(String.raw`$\mathbf S_k = \begin{bmatrix} N_0 & N_+ - N_- \cr N_+ - N_- & N_0 \end{bmatrix}$`)
    expect(v.get('SK')?.text).toContain(String.raw`$\lambda(\mathbf S_k) = N_0 \pm |N_+ - N_-|$`)
    expect(v.get('BAD')?.text).toContain(String.raw`$((1 + \rho)/2)^{N_0} + ((1 - \rho)/2)^{N_0}$`) // = F-09.11
    expect(v.get('GOOD')?.text).toContain(String.raw`$\lambda_{\min}(\mathbf S_k) = 2 \cdot \min(N_+, N_-) \ge 2$`)
    expect(v.get('BAD')?.classes).toContain('warn')
    expect(v.get('GOOD')?.classes).toContain('ok')
    // F-09.11 的登錄式與圖上的機率相同；ρ = .99、N₀ = 100 ⇒ 0.606；長期平均 λ_min(R) = 1 − ρ = 0.01
    expect(FORMULAS.find((f) => f.id === 'F-09.11')?.tex).toContain(String.raw`\Big(\tfrac{1+\rho}{2}\Big)^{N_0}+\Big(\tfrac{1-\rho}{2}\Big)^{N_0}`)
    expect(pm1DegenerateProb(0.99, 100).toFixed(3)).toBe('0.606')
    expect(v.get('NUM')?.text).toContain(String.raw`$\approx 0.606$`)
    expect(v.get('NUM')?.text).toContain(String.raw`$\lambda_{\min}(\mathbf R) = 1 - \rho = 0.01 \gt 0$`)
    expect(eigenModes(corr2(0.99), 0.5).lambdas[1]).toBeCloseTo(0.01, 12)
    // 數值驗算：窗口裡 s = +1 有 N₊ 個、s = −1 有 N₋ 個 ⇒ S_k 的 eigenvalues 是 N₀ ± |N₊ − N₋|，λ_min = 2·min(N₊, N₋)
    for (const [a, b] of [[4, 0], [3, 1], [2, 2], [1, 3], [0, 4], [97, 3]]) {
      const N0 = a + b
      const [hi, lo] = eigSym([
        [N0, a - b],
        [a - b, N0],
      ]).values
      expect(hi, `${a},${b}`).toBeCloseTo(N0 + Math.abs(a - b), 12)
      expect(lo, `${a},${b}`).toBeCloseTo(2 * Math.min(a, b), 12)
    }
    // 與正文「先算一次」的兩個窗口（用 slidingWindowPe 算）對得上：A 的 s 全為 +1 ⇒ λ_min = 0；B 有 3 個 +1、1 個 −1 ⇒ λ_min(S_k) = 2、λ_min(R_k) = 2/4
    const A = [[1, 1], [-1, -1], [1, 1], [-1, -1]]
    const B = [[1, 1], [1, -1], [-1, -1], [1, 1]]
    const lmin = (w: number[][]) => slidingWindowPe(w.map((r) => r[0]), w.map((r) => r[1]), w.length).lmin[0]
    expect(lmin(A)).toBeCloseTo(0, 12)
    expect(lmin(B)).toBeCloseTo((2 * 1) / 4, 12)
  })

  it('圖 9.15 gauge（F-09.13）：第二組是 b + c 與 a_i − c；y 標 +、y′ 標 −；結果 c·(Σx_i − 1) = 0', async () => {
    const { v, e, sub } = await flow(CHART_GAUGE_SHIFT)
    expect(v.get('B1')?.text).toBe(String.raw`$b \times 1$`)
    expect(v.get('B2')?.text).toBe(String.raw`$(b + c) \times 1$`)
    expect(v.get('A2')?.text).toContain(String.raw`$\sum (a_i - c) \cdot x_i[n]$`)
    expect(sub.find((s) => s.id === 'T2')?.title).toContain('$b$ 加 $c$、每個 $a_i$ 減 $c$')
    expect(edge(e, 'S1', 'D').text).toBe('＋ $y$')
    expect(edge(e, 'S2', 'D').text).toBe("− $y'$")
    expect(v.get('Z')?.text).toContain(String.raw`$y - y' = c \cdot (\sum x_i - 1) = 0$`)
    for (const t of ['B1', 'A1', 'B2', 'A2']) edge(e, 'X', t) // 同一筆輸入送進兩組參數
    // 數值驗算：四相逐一檢查 y − y′ = 0
    const theta = [1, 2, 3, 4, 5]
    const c = -1.5
    for (let ph = 0; ph < 4; ph++) {
      const y = theta[0] + theta[1 + ph]
      const y2 = theta[0] + c + (theta[1 + ph] - c)
      expect(y - y2).toBeCloseTo(0, 14)
    }
  })

  it('E04: 圖 9.16 DC null（F-09.15）：常數 1 與 one-hot 都經過 H_PD(1) = 0；兩個 null 方向、三個可辨識的相位差', async () => {
    const { v, e } = await flow(CHART_DC_NULL)
    expect(v.get('H1')?.text).toContain(String.raw`$H_{\mathrm{PD}}(z) = 1 / (1 + L(z))$`)
    for (const h of ['H1', 'H2']) expect(v.get(h)?.text).toContain(String.raw`$H_{\mathrm{PD}}(1) = 0$`)
    edge(e, 'ONE', 'H1')
    edge(e, 'XI', 'H2')
    expect(v.get('UB')?.text).toContain(String.raw`$\tilde u_b[n] \to 0$`)
    expect(v.get('UI')?.text).toContain(String.raw`$\tilde u_0 + \tilde u_1 + \tilde u_2 + \tilde u_3 = \tilde u_b \to 0$`)
    expect(v.get('N1')?.text).toContain('$(1, 0, 0, 0, 0)$')
    expect(v.get('N2')?.text).toContain('$(0, 1, 1, 1, 1)$')
    expect(v.get('OKN')?.text).toContain('3 個獨立組合')
    expect([...v.values()].filter((x) => x.classes?.includes('warn')).map((x) => x.id).sort()).toEqual(['N1', 'N2'])
    // 數值驗算（F-09.15，‖h‖² 正規化為 1）：R_u = Cov(x̃) = R_x − m·mᵀ 的 eigenvalues 是 {¼ ×3, 0, 0}，
    // 兩個零方向正是圖上的 (1, 0, 0, 0, 0) 與 (0, 1, 1, 1, 1)
    const m = [1, 0.25, 0.25, 0.25, 0.25]
    const cov = m.map((mi, i) => m.map((mj, j) => (i === 0 && j === 0 ? 1 : i === 0 || j === 0 ? 0.25 : i === j ? 0.25 : 0) - mi * mj))
    const ev = eigSym(cov).values
    expect(ev.filter((x) => Math.abs(x - 0.25) < 1e-12)).toHaveLength(3)
    expect(ev.filter((x) => Math.abs(x) < 1e-12)).toHaveLength(2)
    for (const n of [[1, 0, 0, 0, 0], [0, 1, 1, 1, 1]]) for (const x of matVec(cov, n)) expect(x).toBeCloseTo(0, 14)
  })

  it('圖 9.17（F-09.19）：與 runGaugeLms 相同的訊號流——d = x̃ᵀ(θ − w_k) → H_PD → + v → e_PD → GMAC(r) → w_(k+1) = w_k + μG_k', async () => {
    const { v, e } = await flow(CHART_GAUGE_LMS_PATH)
    expect(v.get('DOT')?.text).toContain(String.raw`$d[n] = \tilde{\mathbf x}[n]^T (\boldsymbol\theta - \mathbf w_k)$`) // 真值減係數
    edge(e, 'X', 'DOT')
    edge(e, 'DOT', 'H')
    expect(edge(e, 'H', 'S').text).toBe('＋')
    expect(edge(e, 'V', 'S').text).toBe('＋')
    expect(edge(e, 'S', 'G').text).toBe(String.raw`$e_{\mathrm{PD}}[n]$`)
    expect(v.get('G')?.text).toContain(String.raw`$\mathbf G_k = (1/N) \sum e_{\mathrm{PD}}[n] \cdot \mathbf r[n]$`)
    // GMAC regressor 的兩種接法
    expect(edge(e, 'X', 'G').text).toContain(String.raw`raw：$\mathbf r = \tilde{\mathbf x}$`)
    expect(edge(e, 'X', 'G').text).toContain('常數 1')
    edge(e, 'X', 'HF')
    expect(edge(e, 'HF', 'G').text).toContain(String.raw`filtered：$\mathbf r = \tilde{\mathbf u}$`)
    expect(v.get('ACC')?.text).toContain(String.raw`$\mathbf w_{k+1} = \mathbf w_k + \mu \cdot \mathbf G_k$`)
    const fb = edge(e, 'ACC', 'DOT')
    expect(fb.stroke).toBe('dotted')
    expect(fb.text).toContain(String.raw`$\mathbf w_k$`)
    expect(fb.text).toContain('每個 block 才更新一次') // register：w_(k+1) 到下一個 block 才生效
  })

  it('圖 9.18：有恢復力的迴圈倍數是 1 − g·λ，null 方向的迴圈倍數是 1（pole = 1）；兩者的回授都以 + 進入加法點', async () => {
    const { v, e, sub, layout } = await flow(CHART_RESTORING_FORCE)
    expect(layout.map((x) => `${x.start}>${x.end}`)).toEqual(['IDF>NUL'])
    expect(sub.find((s) => s.id === 'IDF')?.title).toContain(String.raw`$\lambda \gt 0$`)
    expect(sub.find((s) => s.id === 'NUL')?.title).toContain(String.raw`$\lambda = 0$`)
    expect(v.get('F1')?.text).toContain(String.raw`$\times (1 - g \cdot \lambda)$`)
    expect(v.get('F1')?.text).toContain('絕對值小於 1')
    expect(v.get('F2')?.text).toContain(String.raw`$\times 1$`)
    expect(v.get('F2')?.text).toContain('pole $= 1$')
    for (const i of ['1', '2']) {
      expect(edge(e, `N${i}`, `A${i}`).text).toBe('＋')
      expect(edge(e, `F${i}`, `A${i}`).text).toBe('＋')
      edge(e, `A${i}`, `Z${i}`)
      edge(e, `Z${i}`, `F${i}`)
    }
    expect(v.get('R2')?.text).toContain(String.raw`std $\propto \sqrt{K}$`)
    expect(v.get('N2')?.text).toContain(String.raw`$\mu \cdot \eta_k$`)
  })

  it('圖 9.19 決策樹：三個判斷依序是「有沒有投影 → 每個窗口 → κ」，每個「是／否」都通到正文的結論', async () => {
    const { v, e, dir } = await flow(CHART_IDENTIFIABLE_TREE)
    expect(dir).toBe('TD')
    for (const q of ['Q1', 'Q2', 'Q3']) expect(v.get(q)?.type).toBe('diamond')
    edge(e, 'START', 'Q1')
    expect(edge(e, 'Q1', 'NO').text).toContain(String.raw`$\lambda = 0$`)
    expect(v.get('NO')?.text).toContain('pole $= 1$')
    expect(edge(e, 'Q1', 'Q2').text).toBe('有')
    expect(v.get('Q2')?.text).toContain(String.raw`$\lambda_{\min}(\mathbf S_k) \ge \alpha \gt 0$`)
    expect(edge(e, 'Q2', 'Q3').text).toContain('PE 成立')
    expect(edge(e, 'Q3', 'SLOW').text).toBe('是')
    expect(v.get('SLOW')?.text).toContain(String.raw`$k_{95} \approx \ln 20 / (g \cdot \lambda_{\min})$`)
    expect(edge(e, 'Q3', 'FAST').text).toBe('否')
    expect(v.get('FAST')?.text).toContain(String.raw`$0 \lt g \lt 2 / \lambda_{\max}$`)
    // 每個「有問題」的結論都接到一個對策
    edge(e, 'NO', 'FIX1')
    edge(e, 'STEP', 'FIX2')
    edge(e, 'SLOW', 'FIX3')
    // k₉₅ ≈ ln 20 / (gλ_min) 與精確值 598 的差距（ρ = 0.99、g = 0.5）
    expect(Math.log(20) / (0.5 * 0.01)).toBeCloseTo(599.15, 2)
    expect(stepsToDecay(0.995)).toBe(598)
  })

  it('圖 9.20 綜合手算流程：① → ⑧ 的順序與 HC-09.8 的步驟、公式一致', async () => {
    const { v, e } = await flow(CHART_SYNTHESIS_FLOW)
    const chain = ['IN', 'KQ', 'G', 'LAM', 'STAB', 'PS', 'K95', 'DEG', 'SPR']
    for (let i = 0; i + 1 < chain.length; i++) edge(e, chain[i], chain[i + 1])
    expect(edge(e, 'STAB', 'PS').text).toBe('是')
    expect(edge(e, 'STAB', 'DIV').text).toBe('否')
    const marks = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']
    chain.slice(1).forEach((id, i) => expect(v.get(id)?.text, id).toContain(marks[i]))
    expect(v.get('KQ')?.text).toContain(String.raw`$K_q = \sqrt{2/\pi} / \sigma_v$`)
    expect(v.get('G')?.text).toContain(String.raw`$g = \mu \cdot K_q$`)
    expect(v.get('STAB')?.text).toContain(String.raw`$g \cdot \lambda_{\max} \lt 2$`)
    expect(v.get('PS')?.text).toContain(String.raw`$p_{\mathrm{slow}} = 1 - g \cdot \lambda_{\min}$`)
    expect(v.get('DEG')?.text).toContain(String.raw`$((1 + \rho)/2)^{N_0} + ((1 - \rho)/2)^{N_0}$`)
    expect(v.get('SPR')?.text).toContain(String.raw`$\approx \sqrt{2 / N_0}$`)
    // 與 HC-09.8 的公式列（formulaTex）同一組式子
    const hc = HANDCALCS.find((h) => h.id === 'HC-09.8')
    expect(hc?.formulaTex).toContain(String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`)
    expect(hc?.formulaTex).toContain(String.raw`g=\mu K_q`)
    expect(hc?.formulaTex).toContain(String.raw`p_{\text{slow}}=1-g(1-\rho)`)
    expect(hc?.formulaTex).toContain(String.raw`\sqrt{\frac{2}{N_0}}`)
    // 手算題的預設值照這個順序算：K_q → g → … → k₉₅ = 75,091
    const sol = hc!.solve({ sigmaV: 100, mu: 0.5, rho: 0.99, N0: 100 })
    expect(sol.results.find((r) => r.symbol === 'k_{95}')?.value).toBe(75091)
  })
})

describe('Ch09 方塊圖：真的畫一次（共用的 renderMermaidForTest；parser 抓不到 "Unsupported markdown" 這類問題）', () => {
  beforeAll(installMermaidSvgShim)

  it.each(ALL_CHARTS)('%s：畫得出來、沒有 "Unsupported markdown"、沒有殘留的 "$"、公式都由 KaTeX 排版、KaTeX 以外沒有 Unicode 數學、節點不超過 14 個、每個標籤的文字與數字都在圖上', async (name, chart) => {
    const { svg, text, nodeCount, mathCount, plainText } = await renderMermaidForTest(chart)
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(svg).not.toMatch(/Unsupported markdown|Syntax error/i)
    expect(text, `${name}：圖上不應殘留 $`).not.toContain('$')
    expect(unicodeMathIn(plainText), `${name}：KaTeX 以外的文字不應有 Unicode 拼的數學`).toEqual([])
    expect(nodeCount).toBeGreaterThan(0)
    expect(nodeCount).toBeLessThanOrEqual(14)
    // 每個含公式的標籤（節點、連線、subgraph／state 標題、state 轉移）恰好排成一個 KaTeX
    expect(mathCount, `${name}：KaTeX 數`).toBe(mathLabelCount(chart))
    const flat = squash(text)
    if (STATE_CHARTS.has(name)) {
      // stateDiagram：兩個狀態與三條轉移的文字（數字、正負號、機率都在）
      for (const w of ['平台：差模c2還是初值c2,0', '歸零：差模c2=0，之後不再變', '沒有flip（s=+1），機率(1+ρ)/2=0.995', '出現第一個flip（s=−1），機率(1−ρ)/2=0.005', '之後每個sample都維持0'])
        expect(flat, `${name}: ${w}`).toContain(squash(w))
      return
    }
    const { v, e, sub } = await flow(chart)
    // 標籤 = 文字 + 公式：公式以外的文字原樣畫在圖上；公式裡出現的數字（1.99、598、0.606…）也都在圖上
    const labels = [
      ...[...v.values()].map((x) => ({ where: `節點 ${x.id}`, label: x.text ?? '' })),
      ...e.map((x) => ({ where: `連線 ${x.start}→${x.end}`, label: x.text })),
      ...sub.map((x) => ({ where: `subgraph ${x.id}`, label: x.title })),
    ]
    for (const { where, label } of labels) {
      for (const part of textParts(label)) expect(flat, `${name}: ${where} 的文字「${part}」`).toContain(part)
      for (const seg of mathSegments(label)) for (const num of seg.match(/\d+(?:\.\d+)?/g) ?? []) expect(flat, `${name}: ${where} 的數字 ${num}`).toContain(num)
    }
  }, 120000)
})

describe('Ch09 頁面與版面：系統地圖、方塊圖的位置、章末符號表', () => {
  type SvgMeasure = { getBBox?: () => { x: number; y: number; width: number; height: number }; getComputedTextLength?: () => number }
  const proto = SVGElement.prototype as unknown as SvgMeasure
  const saved: SvgMeasure = { getBBox: proto.getBBox, getComputedTextLength: proto.getComputedTextLength }

  beforeAll(() => {
    // jsdom 沒有文字排版：給 mermaid 的 layout 一個「每個字 8 px」的替身，renderer 才能跑完並產生 SVG
    proto.getBBox = function (this: SVGElement) {
      return { x: 0, y: 0, width: Math.max(20, 8 * (this.textContent ?? '').length), height: 20 }
    }
    proto.getComputedTextLength = function (this: SVGElement) {
      return 8 * (this.textContent ?? '').length
    }
  })
  afterAll(() => {
    proto.getBBox = saved.getBBox
    proto.getComputedTextLength = saved.getComputedTextLength
  })
  afterEach(() => {
    fast.on = false
    fast.charts.length = 0
    localStorage.clear()
    for (const fn of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize]) fn.mockClear()
  })

  it('版面（真正的 renderer）：LR 的圖不超過 6 欄、TB 的圖不超過 11 列，節點一個都沒少', async () => {
    // 守住兩個實際踩過的陷阱：交叉的回授迴圈被 dagre 排成一條 10 欄的長鏈、沒有連線的兩個 subgraph 被排成左右並列——
    // 兩者都會讓圖被縮到看不清楚。jsdom 的文字大小是替身，但「排在第幾欄／第幾列」（rank）與真實瀏覽器相同。
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, forceLegacyMathML: true })
    const position = (g: Element): [number, number] => {
      const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(g.getAttribute('transform') ?? '')
      expect(m, g.id).toBeTruthy()
      return [Math.round(Number(m![1])), Math.round(Number(m![2]))]
    }
    const distinct = (xs: number[]) => new Set(xs).size
    let n = 0
    for (const [name, chart] of FLOW_CHARTS) {
      const { v, dir, sub } = await flow(chart)
      const { svg } = await mermaid.render(`ch09-layout-${n++}`, sanitizeMermaidSource(chart))
      const host = document.createElement('div')
      host.innerHTML = svg
      expect(host.querySelectorAll('g.node'), name).toHaveLength(v.size)
      // 每個 root 是一個獨立的座標系：最外層一個；有自己 direction 的 subgraph 各一個（巢狀 root）
      const roots = Array.from(host.querySelectorAll('g.root')).map((root) => Array.from(root.querySelectorAll(':scope > g.nodes > g.node')).map(position))
      const nested = roots.slice(1).filter((r) => r.length > 0)
      const outer = roots[0]
      if (nested.length === 0) {
        expect(outer, name).toHaveLength(v.size)
        if (dir === 'LR') expect(distinct(outer.map((p) => p[0])), `${name}：欄數`).toBeLessThanOrEqual(6)
        else expect(distinct(outer.map((p) => p[1])), `${name}：列數`).toBeLessThanOrEqual(11)
      } else {
        // 兩個「direction LR」的 subgraph：各自不超過 4 欄，而且上下並排——在 TB 的外層圖裡它們落在不同的 rank，
        // 兩個巢狀 root 的 y 位移不同（左右並列時 y 位移相同、只差 x）
        expect(nested, name).toHaveLength(sub.length)
        for (const r of nested) expect(distinct(r.map((p) => p[0])), `${name}：subgraph 欄數`).toBeLessThanOrEqual(4)
        const offsets = Array.from(host.querySelectorAll('g.root g.root')).map(position)
        expect(offsets, name).toHaveLength(2)
        expect(Math.abs(offsets[0][1] - offsets[1][1]), `${name}：兩個框應上下並排`).toBeGreaterThanOrEqual(40)
      }
    }
    // 章首系統地圖（共用元件）用本章的 focus 也畫得出來：17 個方塊都在，恰好 4 個被標成藍色
    {
      const { svg } = await mermaid.render('ch09-layout-system-map', sanitizeMermaidSource(systemMapChart(SYSTEM_FOCUS)))
      const host = document.createElement('div')
      host.innerHTML = svg
      expect(host.querySelectorAll('g.node')).toHaveLength(Object.keys(SYSTEM_BLOCK_LABEL).length)
      expect(Array.from(host.querySelectorAll('g.node.focus')).map((g) => g.id.replace(/^flowchart-/, '').replace(/-\d+$/, '')).sort()).toEqual(['ACC', 'ALIGN', 'GMAC', 'RES'])
    }
    // 耦合圖：兩個參數各一列、5 欄（輸入 → 加法點 → × g → 加法點 → 輸出）
    const { svg } = await mermaid.render('ch09-layout-coupled', sanitizeMermaidSource(CHART_COUPLED_MEAN))
    const host = document.createElement('div')
    host.innerHTML = svg
    const at = (id: string) => position(host.querySelector(`g.node[id^="flowchart-${id}-"]`) as Element)
    const columns = ['D', 'S', 'M', 'A', 'N'].map((k) => [at(`${k}1`)[0], at(`${k}2`)[0]])
    for (const [x1, x2] of columns) expect(x1).toBe(x2) // 同一欄
    for (let i = 0; i + 1 < columns.length; i++) expect(columns[i][0]).toBeLessThan(columns[i + 1][0]) // 由左到右
  }, 120000)

  it(`整章渲染：<SystemMap> 在開場問題之後；${DIAGRAM_COUNT} 張圖依序出現、都在對應的公式之前、都有圖說與「先看…再看…」；符號表是最後一個區塊`, async () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fast.on = true
    fast.charts.length = 0
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/09']}>
          <Chapter09 />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const at = (sel: string): Element => {
      const el = container.querySelector(sel)
      expect(el, sel).toBeTruthy()
      return el as Element
    }
    /** a 在文件順序上早於 b */
    const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

    // ── 所有 Mermaid 圖都通過真正的 parser 並顯示出來（沒有解析失敗、沒有停在載入中）──
    await waitFor(() => expect(container.querySelectorAll('.c-mermaid-loading')).toHaveLength(0), { timeout: 120000, interval: 200 })
    fast.on = false
    expect(container.querySelectorAll('.c-mermaid-error')).toHaveLength(0)
    expect(container.textContent).not.toContain('Mermaid 圖解析失敗')
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(DIAGRAM_COUNT + 1)
    for (const f of figures) expect(f.querySelector('.c-mermaid-svg svg'), f.getAttribute('aria-label') ?? '').toBeTruthy()
    // 送進 Mermaid 的原始碼（Mermaid 元件先經 sanitizeMermaidSource：含公式的標籤合併成 `$$…$$`），依頁面順序：系統地圖（本章的 focus）→ 清單裡的 20 張
    expect([...new Set(fast.charts)]).toEqual([systemMapChart(SYSTEM_FOCUS), ...CH09_DIAGRAMS.map((d) => d.chart)].map(sanitizeMermaidSource))

    // ── 章首的系統地圖：緊跟在「這一課要回答的問題」之後、第一節之前，後面接一句「你在這裡」──
    const map = figures[0]
    expect(map.closest('.ch09-diagram')).toBeNull() // 它是共用的 <SystemMap>，不是本章清單裡的圖
    expect(map.getAttribute('aria-label')).toContain('DTC-based Fractional-N PLL 與 Sign-LMS 校正迴路的系統方塊圖')
    for (const b of SYSTEM_FOCUS) {
      // 方塊名稱可含 `$…$`：aria-label 是去掉 `$` 的純文字；圖說以 KaTeX 排版（文字部分照原樣，公式的 TeX 原始碼在 annotation 裡）
      expect(map.getAttribute('aria-label')).toContain(stripMathDelimiters(SYSTEM_BLOCK_LABEL[b]))
      const caption = map.querySelector('figcaption')?.textContent ?? ''
      for (const part of SYSTEM_BLOCK_LABEL[b].split(/\$[^$]+\$/)) if (part.trim()) expect(caption).toContain(part.trim())
      for (const tex of mathSegments(SYSTEM_BLOCK_LABEL[b])) expect(caption).toContain(tex)
    }
    const question = Array.from(container.querySelectorAll('.callout')).find((el) => el.textContent?.includes('這一課要回答的問題'))
    expect(question).toBeTruthy()
    expect(question!.nextElementSibling).toBe(map)
    expect(before(map, at('#ch09-intro'))).toBe(true)
    const note = map.nextElementSibling
    expect(note?.classList.contains('ch09-map-note')).toBe(true)
    expect(note?.textContent).toContain('你在這裡')
    expect(note?.textContent).toContain('藍色的四個方塊')

    // ── 本章的 20 張圖：順序＝清單順序、圖號連續、各在自己的小節、在對應公式／推導之前 ──
    const blocks = Array.from(container.querySelectorAll('.ch09-diagram'))
    expect(blocks.map((el) => el.getAttribute('data-diagram'))).toEqual(CH09_DIAGRAMS.map((d) => d.id))
    CH09_DIAGRAMS.forEach((d, i) => {
      const el = blocks[i]
      const label = `圖 9.${i + 1} ${d.id}`
      const fig = el.querySelector('figure.c-mermaid')
      expect(fig?.getAttribute('aria-label'), label).toBe(`圖 9.${i + 1}：${d.alt}`)
      // 圖說：圖號＋種類＋一句「要看什麼」
      const cap = el.querySelector('.ch09-diagram-caption')
      expect(cap?.textContent?.startsWith(`圖 9.${i + 1}（${d.kind}）`), label).toBe(true)
      expect((cap?.textContent ?? '').length, label).toBeGreaterThan(25)
      expect(cap?.textContent, label).toMatch(/看|比較|跟著|從上往下/)
      // 位置：在自己的小節內、在對應的公式／推導／手算題之前
      expect(at(`[id="${d.section}"]`).contains(el), `${label} 應在 #${d.section} 內`).toBe(true)
      expect(before(el, at(`[id="${d.before}"]`)), `${label} 應在 #${d.before} 之前`).toBe(true)
      // 圖的正後方是一段走讀文字：引用同一個圖號、「先看…再看…」、並把圖對到公式（「圖上的 X 就是…」）
      const walk = el.nextElementSibling
      expect(walk?.tagName, label).toBe('P')
      const text = walk?.textContent ?? ''
      expect(text.startsWith(`圖 9.${i + 1} 怎麼`), `${label}：${text.slice(0, 30)}`).toBe(true)
      expect(text, label).toMatch(/先[看問]/)
      expect(text, label).toMatch(/再[看問]/)
      expect(text, label).toMatch(/圖上/)
      expect(text, label).toMatch(/就是/)
    })
    // 先備知識那張圖在所有可展開的框之前（先看圖，再讀細節）
    const prereq = at('#ch09-prereq')
    expect(before(at('[data-diagram="matrix-machine"]'), prereq.querySelector('.c-prereq') as Element)).toBe(true)
    // 耦合圖在框起來的平均遞迴（F-09.3）之後、對角化（F-09.4）之前
    expect(before(at('[id="formula-F-09.3"]'), at('[data-diagram="coupled-mean"]'))).toBe(true)
    // 每張圖都在推導（DerivBox）之外：beginner 模式推導預設收合，圖不可以跟著被收起來
    for (const el of blocks) expect(el.closest('details'), el.getAttribute('data-diagram') ?? '').toBeNull()
    // 由模型算出的圖說數字：圖 9.2 的「差了 199 倍」
    expect(at('[data-diagram="matrix-machine"] .ch09-diagram-caption').textContent).toContain('199')

    // ── 符號表在章末：整章最後一個區塊、在「本課必記」與「連結到 PLL 硬體」之後；章首只有一行連結 ──
    const root = at('.ch09')
    const symbols = at('#symbols')
    expect(root.lastElementChild).toBe(symbols)
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    expect(symbols.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(30)
    expect(before(at('.c-recap'), symbols)).toBe(true)
    expect(before(at('#ch09-pll'), symbols)).toBe(true)
    expect(before(at('#ch09-quiz'), symbols)).toBe(true)
    // 章首（第一節之前）沒有表格，只有一行會捲動的按鈕
    const link = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('本章符號表在最後'))
    expect(link).toBeTruthy()
    expect(before(link!, at('#ch09-intro'))).toBe(true)
    expect(before(link!, map)).toBe(true)
    // HashRouter：不可以用會改變路由的 href
    expect(container.querySelector('a[href="#symbols"], a[href$="#symbols"]')).toBeNull()
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      fireEvent.click(link!)
      expect(scrolled).toEqual([symbols])
      // 目錄的最後一項也捲到同一個地方
      const tocLast = Array.from(container.querySelectorAll('.ch09-toc button')).pop()
      expect(tocLast?.textContent).toContain('本章符號表')
      fireEvent.click(tocLast!)
      expect(scrolled).toEqual([symbols, symbols])
    } finally {
      Element.prototype.scrollIntoView = original
    }

    // 沒有 KaTeX 錯誤、沒有 React 警告
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    const warnings = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => /Warning|Each child|unique "key"/.test(s))
    errorSpy.mockRestore()
    expect(warnings).toEqual([])
  }, 240000)
})
