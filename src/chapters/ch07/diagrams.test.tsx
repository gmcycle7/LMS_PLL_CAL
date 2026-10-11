import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { defaultValues, systemMapChart } from '@/components'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { SettingsProvider } from '@/app/settings'
import { analyticCorr, buildHat, HAT_EXACT, pathTransfer, residualPhaseDeg, toneBlockCorr, toneCorrCodeDelay, type FxCodeSpec, type FxPathSpec } from '@/simulation/models/filteredX'
import Chapter07 from './index'
import { CH07_CHARTS, CH07_SYSTEM_FOCUS, type Ch07ChartName } from './diagrams'
import { HANDCALCS } from './handcalcs'
import { kq } from './util'

/**
 * Ch07 的方塊圖（docs/teaching-style.md §8）。ch07.test.tsx 為了速度把 mermaid 整個 mock 掉，所以這裡另外用「真正的」mermaid：
 *   1. parser：每一張圖都能解析、節點數不超過 14；
 *   2. renderer（jsdom + getBBox 墊片；共用的 renderMermaidForTest）：標籤沒有被 Mermaid 11 的 Markdown 解析吃掉（「Unsupported markdown: list」）；
 *   3. 排版：長的圖用上下排列（不會縮到看不清楚）、並排比較的框上下疊且順序正確；
 *   4. 與公式一致：加法點的正負號、δ = a − w、φ ± ΩD、取樣率（n／k），以及圖上的例子數字（由模型重算）；
 *   5. 頁面：章首有 SystemMap、全章圖數、每張圖都在對應的公式之前、圖後有一段「先看…再看…」的走圖說明。
 */

// Plotly 在 jsdom 裡跑不起來；頁面測試只關心方塊圖，照 ch07.test.tsx 的方式 mock 掉
const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const RAD = Math.PI / 180
const NAMES = Object.keys(CH07_CHARTS) as Ch07ChartName[]
const CASES = NAMES.map((name) => [name, CH07_CHARTS[name]] as const)

interface FlowVertex {
  id: string
  text?: string
  classes?: string[]
}
interface FlowEdge {
  start: string
  end: string
  text?: string
}
interface FlowDb {
  getVertices(): Map<string, FlowVertex>
  getEdges(): FlowEdge[]
}

/** 真正的 parser 解析出來的節點與邊（不是用正規表示式猜的）。 */
async function parseFlow(chart: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDb
  const vertices = db.getVertices()
  const edges = db.getEdges()
  const text = (id: string) => (vertices.get(id)?.text ?? '').replace(/<br\s*\/?>/g, ' ')
  const edge = (start: string, end: string) => edges.filter((e) => e.start === start && e.end === end).map((e) => e.text ?? '')
  const into = (end: string) => edges.filter((e) => e.end === end)
  const classOf = (id: string) => vertices.get(id)?.classes ?? []
  return { vertices, edges, text, edge, into, classOf }
}

/**
 * jsdom 沒有版面引擎：給 SVG 的量測函式固定的尺寸，mermaid 才排得出來。
 * 節點的座標沒有意義，但標籤的內容、節點的先後次序（dagre 的 rank／order 與尺寸無關）和瀏覽器裡相同。
 */
function fakeSvgMetrics() {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>
  proto.getBBox = () => ({ x: 0, y: 0, width: 80, height: 24 })
  proto.getComputedTextLength = () => 80
}

/** 原始碼中所有雙引號包住的標籤。 */
const labelsOf = (chart: string) => [...chart.matchAll(/"([^"]*)"/g)].map((m) => m[1])

beforeAll(installMermaidSvgShim)
beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
})

describe('Ch07 Mermaid 圖：真正的 parser', () => {
  it('一共 22 張（含原有的 RTL 位置圖），名稱不重複、原始碼不重複', () => {
    expect(NAMES).toHaveLength(22)
    expect(new Set(Object.values(CH07_CHARTS)).size).toBe(22)
    expect(NAMES).toContain('CHART_RTL_REGRESSORS')
  })

  it.each(CASES)('%s：語法正確（flowchart），節點數 ≤ 14，有圖要看的重點色', async (_name, chart) => {
    const r = await mermaid.parse(chart)
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
    const { vertices } = await parseFlow(chart)
    expect(vertices.size).toBeGreaterThanOrEqual(4)
    expect(vertices.size).toBeLessThanOrEqual(14)
    // 至少一個節點用 classDef 標色（focus／ok／warn），而且用到的 class 都有定義
    const used = [...vertices.values()].flatMap((v) => v.classes ?? [])
    expect(used.length).toBeGreaterThan(0)
    for (const c of used) expect(['focus', 'ok', 'warn']).toContain(c)
  })

  it.each(CASES)('%s：標籤沒有裸的 < >（只允許 <br/>）、沒有會被當成 Markdown 清單／標題／引用的開頭', (_name, chart) => {
    for (const label of labelsOf(chart)) {
      expect(label.replace(/<br\/>/g, ''), label).not.toMatch(/[<>]/)
      // Mermaid 11 把標籤交給 marked：以 "+ "、"- "、"* "、"1. "、"# "、"> " 開頭（或只有一個 + - *）會變成「Unsupported markdown」
      for (const line of label.split('<br/>')) expect(line, label).not.toMatch(/^\s*(?:[-+*](?:\s|$)|\d+[.)]\s|#{1,6}\s|>|`)/)
    }
  })

  it('章首的系統地圖：藍色標出 RES、ALIGN、GMAC，也能解析', async () => {
    const chart = systemMapChart(CH07_SYSTEM_FOCUS)
    expect(chart).toContain('class RES,ALIGN,GMAC focus')
    const r = await mermaid.parse(chart)
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })
})

describe('Ch07 Mermaid 圖：用共用工具真的畫一次', () => {
  it.each(CASES)('%s：畫得出來，沒有「Unsupported markdown」，節點數 ≤ 14；原始碼本身就寫成 ＋／−（不靠 sanitize）', async (_name, chart) => {
    installMermaidSvgShim()
    const { text, nodeCount } = await renderMermaidForTest(chart)
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(nodeCount).toBeGreaterThanOrEqual(4)
    expect(nodeCount).toBeLessThanOrEqual(14)
    expect(sanitizeMermaidSource(chart)).toBe(chart)
  })

  it('章首的系統地圖也畫得出來', async () => {
    installMermaidSvgShim()
    const { text } = await renderMermaidForTest(systemMapChart(CH07_SYSTEM_FOCUS))
    expect(text).not.toMatch(/Unsupported markdown/)
  })
})

describe('Ch07 Mermaid 圖：真正的 renderer（jsdom）', () => {
  it('每張圖都畫得出來；標籤文字原樣出現，沒有「Unsupported markdown」，也沒有被 Markdown 變成粗體／斜體', async () => {
    fakeSvgMetrics()
    let i = 0
    for (const [name, chart] of [...CASES, ['SYSTEM_MAP', systemMapChart(CH07_SYSTEM_FOCUS)] as const]) {
      const { svg } = await mermaid.render(`ch07-diagram-${i++}`, chart)
      expect(svg, name).not.toMatch(/Unsupported markdown/)
      expect(svg, name).not.toMatch(/<(?:em|strong)>/)
      expect(svg, name).not.toMatch(/Syntax error/i)
      const host = document.createElement('div')
      host.innerHTML = svg
      const shown = Array.from(host.querySelectorAll('.nodeLabel')).map((e) => (e.textContent ?? '').replace(/\s+/g, ''))
      const shownEdges = Array.from(host.querySelectorAll('span.edgeLabel')).map((e) => (e.textContent ?? '').replace(/\s+/g, ''))
      const { vertices, edges } = await parseFlow(chart)
      // 每個節點、每條線上的文字都原樣出現在畫出來的圖上
      for (const v of vertices.values()) {
        const want = (v.text ?? '').replace(/<br\s*\/?>/g, '').replace(/\s+/g, '')
        expect(shown, `${name}: ${v.id}`).toContain(want)
      }
      for (const e of edges) {
        const want = (e.text ?? '').replace(/<br\s*\/?>/g, '').replace(/\s+/g, '')
        if (want) expect(shownEdges, `${name}: ${e.start} → ${e.end}`).toContain(want)
      }
    }
  })
})

describe('Ch07 Mermaid 圖：排版（寬度）', () => {
  it('「兩路相乘」與流程類的圖用上下排列（TB）：左右排列時估計超過 1400 px 寬，縮進約 1000 px 的內文欄位後字太小', () => {
    const tb: Ch07ChartName[] = [
      'CHART_SIGNAL_MODEL',
      'CHART_PHASE_BOOKKEEPING',
      'CHART_MIXER_AVERAGE',
      'CHART_BLOCK_AVERAGE',
      'CHART_TWO_TONES',
      'CHART_VOTING',
      'CHART_FX_LOOP',
      'CHART_MISMATCH',
      'CHART_LATENCY_MISMATCH',
      'CHART_DECISION',
      'CHART_HANDCALC_FLOW',
      'CHART_BRINGUP',
    ]
    for (const name of NAMES) expect(CH07_CHARTS[name].split('\n')[0], name).toBe(tb.includes(name) ? 'flowchart TB' : 'flowchart LR')
    // 判斷用六角形（比菱形省空間）：全章沒有菱形節點
    for (const chart of Object.values(CH07_CHARTS)) expect(chart).not.toMatch(/[A-Za-z0-9]\{"/)
  })

  it('並排比較的框上下疊、由上到下是 A → B（→ C），框內由左到右', async () => {
    fakeSvgMetrics()
    const stack = async (name: Ch07ChartName, id: string) => {
      const { svg } = await mermaid.render(`ch07-stack-${id}`, CH07_CHARTS[name])
      const host = document.createElement('div')
      host.innerHTML = svg
      // 每個獨立的框是一個巢狀的 g.root，transform 是它在整張圖裡的位置
      return Array.from(host.querySelectorAll('g.root'))
        .map((g) => {
          const cluster = g.querySelector(':scope > g.clusters > g.cluster')?.id
          const t = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '')
          const xs = Array.from(g.querySelectorAll(':scope > g.nodes > g.node')).map((n) => Number(/translate\(([-\d.]+)/.exec(n.getAttribute('transform') ?? '')?.[1]))
          return cluster && t ? { cluster, x: Number(t[1]), y: Number(t[2]), columns: new Set(xs).size } : null
        })
        .filter((v): v is { cluster: string; x: number; y: number; columns: number } => v !== null)
        .sort((a, b) => a.y - b.y)
    }
    const side = await stack('CHART_DELAY_SIDE', 'side')
    expect(side.map((c) => c.cluster)).toEqual(['SIDE_CODE', 'SIDE_ERR'])
    const three = await stack('CHART_THREE_REGRESSORS', 'three')
    expect(three.map((c) => c.cluster)).toEqual(['ARCH_RAW', 'ARCH_DLY', 'ARCH_FX'])
    for (const c of [...side, ...three]) {
      expect(c.x, c.cluster).toBe(0) // 同一欄：上下疊，不是左右排
      expect(c.columns, c.cluster).toBeGreaterThanOrEqual(3) // 框內由左到右（至少 3 欄）
    }
    expect(new Set(side.map((c) => c.y)).size).toBe(2)
    expect(new Set(three.map((c) => c.y)).size).toBe(3)
  })
})

describe('Ch07 Mermaid 圖：與本章公式一致', () => {
  it('加法點的每一條輸入線都標了正負號（＋／−），而且和公式的符號相同', async () => {
    const sums: Partial<Record<Ch07ChartName, Record<string, RegExp>>> = {
      // e_PD = δ·u + v
      CHART_SIGNAL_MODEL: { GE: /^＋ δ·u\[n\]$/, V: /^＋ v\[n\]$/ },
      // δ_k = a − w_k
      CHART_MEAN_LOOP: { A: /^＋ a$/, ACC: /^− w_k$/ },
      // e_PD = (a − w)·u + v
      CHART_GRADIENT: { GE: /^＋$/, V: /^＋$/ },
      // x_ref = K₂·(x[n] − 2x[n−1] + x[n−2])
      CHART_SECOND_DIFF: { X: /^＋ x\[n\]$/, SH: /^− 2x\[n−1\]$/, R2: /^＋ x\[n−2\]$/ },
      // E_PD = 輸入 − L·E_PD ⇒ H_PD = 1/(1 + L)
      CHART_TYPE2_LOOP: { E: /^＋$/, DL: /−$/ },
    }
    // 有圓形加法點的圖就是這五張（其餘的圖把「相加」寫在方塊的公式裡）
    expect(NAMES.filter((n) => /\(\("＋"\)\)/.test(CH07_CHARTS[n])).sort()).toEqual(Object.keys(sums).sort())
    for (const [name, want] of Object.entries(sums) as [Ch07ChartName, Record<string, RegExp>][]) {
      const f = await parseFlow(CH07_CHARTS[name])
      expect(f.text('S'), name).toBe('＋')
      const inputs = f.into('S')
      expect(inputs.map((e) => e.start).sort(), name).toEqual(Object.keys(want).sort())
      for (const e of inputs) expect(e.text ?? '', `${name}: ${e.start} → S`).toMatch(want[e.start])
    }
  })

  it('訊號模型：e_PD = δ·u + v、δ = a − w、q = sign(e_PD)，GMAC 乘的是 x[n−D]', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_SIGNAL_MODEL)
    expect(f.edge('X', 'H')).toHaveLength(1)
    expect(f.edge('H', 'GE')).toEqual(['u[n]'])
    expect(f.text('GE')).toContain('δ = a − w')
    expect(f.edge('GE', 'S')).toEqual(['＋ δ·u[n]'])
    expect(f.text('V')).toContain('v[n]')
    expect(f.text('V')).toContain('σ_v')
    expect(f.edge('V', 'S')).toEqual(['＋ v[n]'])
    expect(f.edge('S', 'CMP')).toEqual(['e_PD[n] = δ·u[n] + v[n]'])
    expect(f.text('CMP')).toContain('q = sign(e_PD)')
    expect(f.edge('CMP', 'M')).toEqual(['q[n]'])
    expect(f.edge('X', 'DLY')).toHaveLength(1)
    expect(f.edge('DLY', 'M')).toEqual(['x[n−D]'])
    expect(f.text('AVG')).toContain('G_k = (1/N) Σ q[n]·x[n−D]')
    // 紅色＝造成問題的誤差路徑；藍色＝本章加上的延遲
    expect(f.classOf('H')).toEqual(['warn'])
    expect(f.classOf('DLY')).toEqual(['focus'])
    // 全章沒有任何一張圖把極性寫成 δ = w − a
    for (const chart of Object.values(CH07_CHARTS)) expect(chart).not.toMatch(/w − a|w_k − a/)
  })

  it('延遲放哪一側：code 側是 φ + ΩD、comparator 側是 φ − ΩD（與模型的 residualPhaseDeg 同一個約定）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_DELAY_SIDE)
    expect(f.edge('XA', 'DA')).toHaveLength(1)
    expect(f.edge('DA', 'MA')).toEqual(['x[n−D]'])
    expect(f.edge('QA', 'MA')).toHaveLength(1)
    expect(f.text('RA')).toContain('φ + ΩD')
    expect(f.text('RA')).toContain('落後')
    expect(f.edge('QB', 'DB')).toHaveLength(1)
    expect(f.edge('DB', 'MB')).toEqual(['q[n−D]'])
    expect(f.edge('XB', 'MB')).toHaveLength(1)
    expect(f.text('RB')).toContain('φ − ΩD')
    expect(f.text('RB')).toContain('超前')
    // 模型：φ = −120°、Ω = 30°、D = 1 ⇒ code 側 −90°、error 側 −150°
    expect(residualPhaseDeg(-120 * RAD, 30 * RAD, 1, 'code')).toBeCloseTo(-90, 9)
    expect(residualPhaseDeg(-120 * RAD, 30 * RAD, 1, 'error')).toBeCloseTo(-150, 9)
  })

  it('相位記帳與兩個 tone 的例子數字由模型重算：θ = 0°（T07）、θ₂ = +120°、cos θ₂ = −0.5', async () => {
    const theta1 = residualPhaseDeg(-120 * RAD, 30 * RAD, 4)
    const theta2 = residualPhaseDeg(-120 * RAD, 60 * RAD, 4)
    expect(theta1).toBeCloseTo(0, 9)
    expect(theta2).toBeCloseTo(120, 9)
    expect(Math.cos(theta2 * RAD)).toBeCloseTo(-0.5, 12)
    const book = await parseFlow(CH07_CHARTS.CHART_PHASE_BOOKKEEPING)
    expect(book.text('H')).toContain('相位加 φ')
    expect(book.text('D')).toContain('相位減 ΩD')
    expect(book.text('D')).toContain(`D = 4，ΩD = ${30 * 4}°`)
    expect(book.edge('H', 'M')).toEqual(['u：Ωn + φ'])
    expect(book.edge('D', 'M')).toEqual(['x[n−D]：Ωn − ΩD'])
    expect(book.text('M')).toContain('θ = φ + ΩD')
    expect(book.text('M')).toContain(`−120° + ${30 * 4}° = ${Math.round(theta1)}°`)
    expect(book.text('Q')).toBe('|θ| ＜ 90°？')
    expect(book.classOf('POS')).toEqual(['ok'])
    expect(book.classOf('NEG')).toEqual(['warn'])
    const two = await parseFlow(CH07_CHARTS.CHART_TWO_TONES)
    expect(two.text('B1')).toContain(`Ω₁D = ${30 * 4}°`)
    expect(two.text('B2')).toContain(`Ω₂D = ${60 * 4}°`)
    expect(two.text('C1')).toContain(`θ₁ = φ₁ + Ω₁D = ${Math.round(theta1)}°`)
    expect(two.text('C2')).toContain(`θ₂ = φ₂ + Ω₂D = +${Math.round(theta2)}°`)
    expect(two.text('C2')).toContain('cos θ₂ = −0.5')
    expect(two.classOf('C1')).toEqual(['ok'])
    expect(two.classOf('C2')).toEqual(['warn'])
  })

  it('乘法器 + 平均器：常數項 cos(φ + ΩD) 留下、兩倍頻項 cos(2Ωn + φ − ΩD) 被平均掉（F-07.2 的推導）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_MIXER_AVERAGE)
    expect(f.text('XD')).toBe('x[n−D] = A·cos(Ωn − ΩD)')
    expect(f.text('U')).toBe('u[n] = A·|H|·cos(Ωn + φ)')
    expect(f.text('DC')).toContain('(A²|H|/2)·cos(φ + ΩD)')
    expect(f.text('HF')).toContain('(A²|H|/2)·cos(2Ωn + φ − ΩD)')
    expect(f.text('C')).toBe('C_D = (A²/2)·|H|·cos(φ + ΩD)')
    // 數值驗算積化和差：cos(α)cos(β) = ½[cos(α − β) + cos(α + β)]，α = Ωn + φ、β = Ωn − ΩD
    const [om, phi, D, n] = [0.37, -2.1, 3, 5]
    expect(Math.cos(om * n - om * D) * Math.cos(om * n + phi)).toBeCloseTo(0.5 * (Math.cos(phi + om * D) + Math.cos(2 * om * n + phi - om * D)), 12)
  })

  it('delay line：第 D 個 tap 的相位是 −DΩ（線性相位），MUX 輸出 x[n−D]', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_DELAY_LINE)
    expect(f.edge('X', 'MUX')).toEqual(['相位 0'])
    for (const [i, id] of ['R1', 'R2', 'R3', 'R4'].entries()) {
      expect(f.text(id)).toBe('z⁻¹')
      // 第 i+1 級之後的 tap：相位 −(i+1)Ω
      expect(f.edge(id, 'MUX')).toEqual([`−${i === 0 ? '' : i + 1}Ω`])
    }
    expect(f.edge('X', 'R1')).toHaveLength(1)
    expect(['R1>R2', 'R2>R3', 'R3>R4'].every((k) => f.edges.some((e) => `${e.start}>${e.end}` === k))).toBe(true)
    expect(f.text('MUX')).toContain('REG_GMAC_DLY = D')
    expect(f.edge('MUX', 'GMAC')).toEqual(['x[n−D]'])
  })

  it('平均迴路：δ_k = a − w_k（a 進正端、w_k 進負端）、E[G_k] = K_q·C·δ_k、w_{k+1} = w_k + μ·G_k ⇒ pole = 1 − μ·K_q·C（用遞迴重算）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_MEAN_LOOP)
    expect(f.edge('A', 'S')).toEqual(['＋ a'])
    expect(f.edge('ACC', 'S')).toEqual(['− w_k'])
    expect(f.edge('S', 'KC')).toEqual(['δ_k = a − w_k'])
    expect(f.text('KC')).toContain('K_q·C')
    expect(f.edge('KC', 'MU')).toEqual(['E[G_k] = K_q·C·δ_k'])
    expect(f.edge('MU', 'ACC')).toEqual(['μ·G_k'])
    expect(f.text('ACC')).toContain('1/(z−1)')
    expect(f.text('ACC')).toContain('w_{k+1} = w_k + μ·G_k')
    expect(f.classOf('KC')).toEqual(['focus'])
    // 一圈一圈走：T07 的 D = 0（C = −0.25，反向）與 D = 4（C = +0.5）；μ = 10 fs、σ_v = 100 fs、A = |H| = 1
    const tone = { A: 1, mag: 1, phiRad: -120 * RAD, omega: 30 * RAD }
    for (const D of [0, 4]) {
      const C = toneCorrCodeDelay(tone, D)
      const [a, mu, Kq] = [3, 10, kq(100)]
      let w = 0
      for (let k = 1; k <= 25; k++) {
        const delta = a - w
        w += mu * (Kq * C * delta) // w_{k+1} = w_k + μ·E[G_k]
        expect(a - w, `D = ${D}, k = ${k}`).toBeCloseTo((1 - mu * Kq * C) ** k * a, 9)
      }
    }
    expect(1 - 10 * kq(100) * toneCorrCodeDelay(tone, 0)).toBeGreaterThan(1)
    expect(1 - 10 * kq(100) * toneCorrCodeDelay(tone, 4)).toBeLessThan(1)
  })

  it('有限 N 的 block 平均：只有兩倍頻那一路改變，乘上 sin(NΩ)/(N·sin Ω)、n 換成 block 的中點（逐點加總重算 F-07.6）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_BLOCK_AVERAGE)
    expect(f.text('P')).toContain('x[n−D]·u[n]')
    expect(f.text('DC')).toContain('(A²|H|/2)·cos(φ + ΩD)')
    expect(f.text('HF')).toContain('(A²|H|/2)·cos(2Ωn + φ − ΩD)')
    expect(f.edge('DC', 'AVG')).toEqual(['原封不動'])
    expect(f.edge('HF', 'AVG')[0]).toContain('n₀ + (N−1)/2')
    expect(f.edge('HF', 'AVG')[0]).toContain('sin(NΩ) / (N·sin Ω)')
    expect(f.classOf('DC')).toEqual(['focus'])
    expect(f.classOf('HF')).toEqual(['warn'])
    // 逐點加總 (1/N)Σ x[n−D]·u[n]（A = |H| = 1），對照圖上的兩項
    for (const [omega, N, D, n0] of [[0.37, 16, 3, 5], [Math.PI / 6, 64, 4, 0], [Math.PI - 0.05, 32, 2, 7]]) {
      const phi = -120 * RAD
      let sum = 0
      for (let n = n0; n < n0 + N; n++) sum += Math.cos(omega * (n - D)) * Math.cos(omega * n + phi)
      const brute = sum / N
      const nc = n0 + (N - 1) / 2
      const dc = 0.5 * Math.cos(phi + omega * D)
      const ripple = 0.5 * Math.cos(2 * omega * nc + phi - omega * D) * (Math.sin(N * omega) / (N * Math.sin(omega)))
      expect(brute).toBeCloseTo(dc + ripple, 12)
      expect(toneBlockCorr({ A: 1, mag: 1, phiRad: phi, omega, D, N, n0 }).exact).toBeCloseTo(brute, 12)
    }
  })

  it('bring-up 量極性：S = (G₊ − G₋)/(2Δw) = −K_q·C；S ＜ 0 ⇔ C ＞ 0（T07：D = 0 反向、D = 4 正確）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_BRINGUP)
    expect(f.text('W1')).toContain('w₀ + Δw')
    expect(f.text('W2')).toContain('w₀ − Δw')
    expect(f.text('GP')).toContain('G₊')
    expect(f.text('GM')).toContain('G₋')
    expect(f.text('SL')).toContain('S = (G₊ − G₋) / (2Δw)')
    expect(f.text('SL')).toContain('≈ −K_q·C')
    expect(f.into('SL').map((e) => e.start).sort()).toEqual(['GM', 'GP'])
    expect(f.text('Q')).toBe('S ＜ 0？')
    expect(f.edge('Q', 'OK')).toEqual(['是'])
    expect(f.edge('Q', 'BAD')).toEqual(['否'])
    expect(f.text('OK')).toContain('C ＞ 0')
    expect(f.text('BAD')).toContain('C ≤ 0')
    expect(f.classOf('OK')).toEqual(['ok'])
    expect(f.classOf('BAD')).toEqual(['warn'])
    const tone = { A: 1, mag: 1, phiRad: -120 * RAD, omega: 30 * RAD }
    const [a, w0, dw, Kq] = [3, 1, 0.25, kq(100)]
    for (const [D, ok] of [[0, false], [4, true]] as const) {
      const C = toneCorrCodeDelay(tone, D)
      const G = (w: number) => Kq * C * (a - w) // E[G_k] ≈ K_q·C·(a − w)
      const S = (G(w0 + dw) - G(w0 - dw)) / (2 * dw)
      expect(S).toBeCloseTo(-Kq * C, 12)
      expect(S < 0, `D = ${D}`).toBe(ok)
    }
  })

  it('filtered-x 迴圈：乘法在 sample rate（n）、平均之後是 block rate（k），w_{k+1} = w_k + μ·G_k 回授到真實路徑', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_FX_LOOP)
    expect(f.text('P')).toContain('e_PD[n] = (a − w_k)·(h * x)[n] + v[n]')
    expect(f.edge('P', 'CMP')).toEqual(['e_PD[n]'])
    expect(f.text('CMP')).toContain('q = sign(e_PD)')
    expect(f.edge('CMP', 'M')).toEqual(['q[n]'])
    expect(f.text('HAT')).toContain('u_f = ĥ * x')
    expect(f.edge('HAT', 'DL')).toHaveLength(1)
    expect(f.edge('DL', 'M')).toEqual(['u_f[n−D]'])
    expect(f.edge('M', 'AVG')).toEqual(['每個 sample n'])
    expect(f.text('AVG')).toContain('G_k = (1/N) Σ q[n]·u_f[n−D]')
    expect(f.edge('AVG', 'ACC')).toEqual(['每個 block k'])
    expect(f.text('ACC')).toContain('w_{k+1} = w_k + μ·G_k')
    expect(f.text('ACC')).toContain('1/(z−1)')
    expect(f.edge('ACC', 'P')).toEqual(['w_k 回授（負回授：a − w_k）'])
  })

  it('三種 regressor 並排：x_ref 分別是 x[n]、x[n−D]、u_f[n]；藍色是多出來的 z⁻ᴰ 與 Ĥ', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_THREE_REGRESSORS)
    expect(f.edge('XA', 'MA')).toEqual(['x_ref = x[n]'])
    expect(f.edge('DB', 'MB')).toEqual(['x_ref = x[n−D]'])
    expect(f.edge('HC', 'MC')).toEqual(['x_ref = u_f[n]'])
    expect(f.text('GA')).toContain('C = E[x·u]')
    expect(f.text('GB')).toContain('C_D = E[x[n−D]·u]')
    expect(f.text('GC')).toContain('E[u·u_f]')
    expect([...f.vertices.values()].filter((v) => v.classes?.includes('focus')).map((v) => v.id).sort()).toEqual(['DB', 'HC'])
  })

  it('梯度：乘 u 得到 (a − w)·E[u²]（綠）、乘 x 得到 (a − w)·C（紅）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_GRADIENT)
    expect(f.edge('H', 'MU')).toEqual(['u[n]'])
    expect(f.edge('X', 'MX')).toEqual(['x[n]'])
    expect(f.edge('S', 'MU')).toEqual(['e_PD[n]'])
    expect(f.edge('S', 'MX')).toEqual(['e_PD[n]'])
    // dJ/dw = −E[e_PD·u]：乘 u 的那一路是負梯度（下降方向）
    expect(f.edge('MU', 'RU')).toEqual(['−dJ/dw：真正的梯度'])
    expect(f.edge('MX', 'RX')).toEqual(['乘的是 x：raw-x'])
    // 數值驗算（T07 的單頻、不含雜訊）：一個週期的平均 E[e·u] = (a − w)·E[u²]、E[e·x] = (a − w)·C_0
    const [om, phi, del] = [Math.PI / 6, -120 * RAD, 0.7]
    const pts = Array.from({ length: 12 }, (_, n) => ({ x: Math.cos(om * n), u: Math.cos(om * n + phi) }))
    const mean = (g: (p: { x: number; u: number }) => number) => pts.reduce((a, p) => a + g(p), 0) / pts.length
    expect(mean((p) => del * p.u * p.u)).toBeCloseTo(del * mean((p) => p.u * p.u), 12)
    expect(mean((p) => del * p.u * p.x)).toBeCloseTo(del * toneCorrCodeDelay({ A: 1, mag: 1, phiRad: phi, omega: om }, 0), 12)
    expect(f.text('RU')).toContain('(a − w)·E[u²]')
    expect(f.text('RX')).toContain('(a − w)·C，C = E[x·u]')
    expect(f.classOf('RU')).toEqual(['ok'])
    expect(f.classOf('RX')).toEqual(['warn'])
  })

  it('模型誤差：每個頻率的票是 S_xx·|H|·|Ĥ|·cos(∠H − ∠Ĥ)；latency 例子的 −0.5 由模型重算（Ĥ = H·z⁻⁴）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_MISMATCH)
    expect(f.text('COR')).toContain('E[u·u_f]')
    expect(f.text('COR')).toContain('S_xx·|H|·|Ĥ|·cos(∠H − ∠Ĥ)')
    expect(f.edge('H', 'COR')[0]).toContain('u[n]')
    expect(f.edge('HAT', 'COR')).toEqual(['u_f[n]'])
    expect(f.text('Q')).toContain('|∠H − ∠Ĥ| ＜ 90°')
    expect(f.classOf('HAT')).toEqual(['focus'])
    const lat = await parseFlow(CH07_CHARTS.CHART_LATENCY_MISMATCH)
    expect(lat.edge('H', 'COR')).toEqual(['u：Ωn + φ'])
    expect(lat.edge('DL', 'COR')).toEqual(['u_f：Ωn + φ − ΩΔ'])
    expect(lat.text('DL')).toContain('z^−Δ')
    expect(lat.text('COR')).toContain('∠H − ∠Ĥ = ΩΔ')
    expect(lat.text('R')).toContain('E[u·u_f] = |H|²·cos(ΩΔ)')
    expect(lat.text('R')).toContain('Ω = 30°、Δ = 4')
    expect(lat.text('R')).toContain(`cos ${30 * 4}° = −0.5`)
    const path: FxPathSpec = { kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: Math.PI / 6 }
    const code: FxCodeSpec = { kind: 'sinusoid', omega: Math.PI / 6 }
    const hat = buildHat(path, { ...HAT_EXACT, extraDelay: 4 }, code)
    expect(analyticCorr({ code, h: pathTransfer(path), g: hat.full, D: 0 }) as number).toBeCloseTo(-0.5, 9)
  })

  it('投票圖：票的重量是 S_xx·|H|、票的正負是 cos(φ + ΩD)，相乘後對所有頻率加總（F-07.7／F-07.8）', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_VOTING)
    expect(f.text('WGT')).toContain('S_xx(Ω)')
    expect(f.text('WGT')).toContain('|H(Ω)|')
    expect(f.text('SGN')).toContain('cos(φ(Ω) + ΩD)')
    expect(f.into('PROD').map((e) => e.start).sort()).toEqual(['SGN', 'WGT'])
    expect(f.text('SUM')).toContain('Σᵢ 或 (1/2π)∫ dΩ')
    expect(f.text('P1')).toContain('p = 1 − μ·K_q·C_D ＜ 1')
    expect(f.text('P2')).toContain('p ≥ 1')
    expect(f.classOf('SGN')).toEqual(['focus'])
  })

  it('Type-II 迴路：L(z) = (K_p + K_i/(1 − z⁻¹))·1/(1 − z⁻¹)·z^−(1+d)，負回授', async () => {
    const f = await parseFlow(CH07_CHARTS.CHART_TYPE2_LOOP)
    expect(f.text('PI')).toContain('K_p + K_i/(1 − z⁻¹)')
    expect(f.text('DCO')).toContain('1/(1 − z⁻¹)')
    expect(f.text('DL')).toContain('z^−(1+d)')
    expect(f.edges.map((e) => `${e.start}>${e.end}`)).toEqual(expect.arrayContaining(['S>PI', 'PI>DCO', 'DCO>DL', 'DL>S', 'S>OUT']))
    // 輸入是 (a − w)·x、加法點的輸出是 (a − w)·u（u = h_PD * x）；雜訊 v 在迴路外、comparator 前才加進來
    expect(f.text('E')).toContain('(a − w)·x[n]')
    expect(f.edge('S', 'PI')).toEqual(['(a − w)·u[n]'])
    expect(f.edge('S', 'OUT')).toEqual(['(a − w)·u[n]'])
    expect(f.text('OUT')).toContain('雜訊 v[n]')
  })

  it('手算流程圖的 ①…⑨ 依序出現，且與 HC-07.8 的步驟順序相同（12 步：圖上一格對應一到兩步）', async () => {
    const chart = CH07_CHARTS.CHART_HANDCALC_FLOW
    const marks = '①②③④⑤⑥⑦⑧⑨'.split('')
    const pos = marks.map((m) => chart.indexOf(m))
    expect(pos.every((p) => p > 0)).toBe(true)
    const f = await parseFlow(chart)
    const want: [string, string][] = [
      ['A1', 'C_raw = |H|·cos φ'],
      ['B1', 'θ = wrap(φ + ΩD)'],
      ['B2', 'C_D = |H|·cos θ'],
      ['C1', 'E[u²] = |H|²'],
      ['K1', 'K_q = √(2/π) / σ_v'],
      ['K2', 'μ·K_q'],
      ['P1', 'p_raw = 1 − μ·K_q·C_raw'],
      ['P2', 'p_D = 1 − μ·K_q·C_D'],
      ['P3', 'p_f = 1 − μ·K_q·E[u²]'],
    ]
    want.forEach(([id, tex], i) => {
      expect(f.text(id)).toContain(marks[i])
      expect(f.text(id)).toContain(tex)
    })
    const def = HANDCALCS.find((h) => h.id === 'HC-07.8')
    expect(def).toBeTruthy()
    const sol = def!.solve(defaultValues(def!))
    expect(sol.steps).toHaveLength(12)
    // 手算題的結果順序：三個相關、三個 pole（與圖上 ①③④、⑦⑧⑨ 相同）
    expect(sol.results.map((x) => x.symbol)).toEqual([String.raw`C_{\mathrm{raw}}`, 'C_D', 'E[u^2]', String.raw`p_{\mathrm{raw}}`, 'p_D', 'p_f'])
    // 預設值（Gallery #4）：C_raw = −0.5、C_4 = +1、E[u²] = 1
    expect(sol.results.slice(0, 3).map((x) => x.value)).toEqual([-0.5, 1, 1])
  })

  it('決策流程與成本階梯：四種做法都出現，filtered-x 之後一定檢查 E[u·u_f] 的符號', async () => {
    const d = await parseFlow(CH07_CHARTS.CHART_DECISION)
    expect(d.text('A')).toContain('S ≈ −K_q·C')
    for (const [id, word] of [['RAW', 'raw-x'], ['SD', '二次差分'], ['DX', 'delayed-x'], ['FX', 'filtered-x']] as const) expect(d.text(id)).toContain(word)
    expect(d.edge('FX', 'Q4')).toHaveLength(1)
    expect(d.text('Q4')).toContain('E[u·u_f] ＞ 0')
    expect(d.edge('Q4', 'FIX')).toEqual(['否'])
    expect(d.edge('FIX', 'FX')).toHaveLength(1)
    expect(d.text('DX')).toContain('D ≈ ((−φ) mod 2π) / Ω')
    const ladder = await parseFlow(CH07_CHARTS.CHART_COST_LADDER)
    expect(['L0', 'L1', 'L2', 'L3'].map((id) => ladder.text(id).split(' ')[0] + ladder.text(id).split(' ')[1])).toEqual(['第0', '第1', '第2', '第3'])
    expect(ladder.edges.map((e) => `${e.start}>${e.end}`)).toEqual(['L0>L1', 'L1>L2', 'L2>L3'])
    expect(ladder.text('L1')).toContain('2×B 個 flip-flop')
    expect(ladder.text('L2')).toContain('D_max×B 個 flip-flop')
  })
})

describe('Ch07 頁面上的方塊圖', () => {
  it('章首有 SystemMap；全章 23 張圖（系統地圖 + 22 張）都送進 mermaid.render；每張圖在對應公式之前，圖說用 LaTeX，圖後緊接「先看…再看…」的走圖說明', async () => {
    const byChart = new Map<string, string>(NAMES.map((n) => [sanitizeMermaidSource(CH07_CHARTS[n]), n]))
    const systemChart = sanitizeMermaidSource(systemMapChart(CH07_SYSTEM_FOCUS))
    byChart.set(systemChart, 'SYSTEM_MAP')
    const seen: string[] = []
    const spy = vi.spyOn(mermaid, 'render').mockImplementation(async (id: string, text: string) => {
      seen.push(text)
      return { svg: `<svg id="${id}" data-chart="${byChart.get(text) ?? 'UNKNOWN'}"><g></g></svg>`, diagramType: 'flowchart-v2' }
    })
    try {
      const { container } = render(
        <SettingsProvider>
          <MemoryRouter initialEntries={['/ch/07']}>
            <Chapter07 />
          </MemoryRouter>
        </SettingsProvider>,
      )
      const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
      expect(figures).toHaveLength(23)
      // 等所有圖都渲染完（render 依序排隊）
      await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg[data-chart]')).toHaveLength(23), { timeout: 60_000, interval: 50 })
      // 頁面實際送去畫的原始碼＝系統地圖 + diagrams.ts 的 22 張，沒有漏網的手寫圖
      expect(container.querySelector('svg[data-chart="UNKNOWN"]')).toBeNull()
      expect([...new Set(seen)].sort()).toEqual([systemChart, ...Object.values(CH07_CHARTS).map(sanitizeMermaidSource)].sort())

      const fig = (name: string) => {
        const el = container.querySelector(`svg[data-chart="${name}"]`)?.closest('figure')
        expect(el, name).toBeTruthy()
        return el as HTMLElement
      }
      const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

      // 系統地圖：全章第一張圖，在 7.1 節之前，標出本章的三個方塊；後面一句話說明藍色方塊與本章新增的東西
      const map = fig('SYSTEM_MAP')
      expect(figures[0]).toBe(map)
      expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
      for (const block of ['Fractional residue x[n]', 'Code alignment / delay / filtered-x', 'GMAC']) expect(map.querySelector('figcaption')?.textContent).toContain(block)
      expect(follows(map, container.querySelector('#ch07-problem') as Element)).toBe(true)
      expect(map.nextElementSibling?.tagName).toBe('P')
      expect(map.nextElementSibling?.textContent).toMatch(/藍色的三塊是本章的主角/)
      expect(map.nextElementSibling?.textContent).toMatch(/本章新增的只有/)

      // [圖, 所在的節, 它必須出現在哪個元素之前]
      const placement: [Ch07ChartName, string, string][] = [
        ['CHART_SIGNAL_MODEL', '#ch07-problem', '[id="handcalc-HC-07.1"]'],
        ['CHART_PHASE_BOOKKEEPING', '#ch07-problem', '[id="handcalc-HC-07.1"]'],
        ['CHART_MEAN_LOOP', '#ch07-problem', '#ch07-derivation'],
        ['CHART_MIXER_AVERAGE', '#ch07-derivation', '[id="formula-F-07.2"]'],
        ['CHART_DELAY_SIDE', '#ch07-derivation', '[id="formula-F-07.3"]'],
        ['CHART_BLOCK_AVERAGE', '#ch07-derivation', '[id="formula-F-07.6"]'],
        ['CHART_DELAY_LINE', '#ch07-linear-phase', '[id="formula-F-07.4"]'],
        ['CHART_TWO_TONES', '#ch07-linear-phase', '[id="formula-F-07.4"]'],
        ['CHART_VOTING', '#ch07-linear-phase', '[id="formula-F-07.7"]'],
        ['CHART_GRADIENT', '#ch07-gradient', '[id="formula-F-07.9"]'],
        ['CHART_THREE_REGRESSORS', '#ch07-gradient', '[id="formula-F-07.11"]'],
        ['CHART_FX_LOOP', '#ch07-gradient', '[id="formula-F-07.10"]'],
        ['CHART_RHO_READING', '#ch07-gradient', '[id="formula-F-07.13"]'],
        ['CHART_MISMATCH', '#ch07-mismatch', '[id="formula-F-07.12"]'],
        ['CHART_LATENCY_MISMATCH', '#ch07-mismatch', '[id="handcalc-HC-07.6"]'],
        ['CHART_SECOND_DIFF', '#ch07-mismatch', '[id="formula-F-07.14"]'],
        ['CHART_TYPE2_LOOP', '#ch07-mismatch', '[id="formula-F-07.15"]'],
        ['CHART_RTL_REGRESSORS', '#ch07-hardware', '#ch07-lab'],
        ['CHART_COST_LADDER', '#ch07-hardware', '#ch07-lab'],
        ['CHART_DECISION', '#ch07-hardware', '#ch07-lab'],
        ['CHART_HANDCALC_FLOW', '#ch07-lab', '[id="handcalc-HC-07.8"]'],
        ['CHART_BRINGUP', '#ch07-pll', '#symbols'],
      ]
      expect(placement.map((p) => p[0]).sort()).toEqual([...NAMES].sort())
      for (const [name, section, before] of placement) {
        const el = fig(name)
        expect(el.closest(section), `${name} 應在 ${section}`).toBeTruthy()
        const target = container.querySelector(before)
        expect(target, before).toBeTruthy()
        expect(follows(el, target as Element), `${name} 應在 ${before} 之前`).toBe(true)
        // 圖說：一句話說明要看什麼；圖說裡的數學一律是 KaTeX（$...$），不是 Unicode 拼的公式
        const cap = el.querySelector('figcaption')
        expect((cap?.textContent ?? '').length, name).toBeGreaterThanOrEqual(20)
        const own = Array.from(cap?.childNodes ?? []).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
        expect(own, `${name} 的圖說含 Unicode 拼的數學：${own}`).not.toMatch(/[θΩωζφσμτρδ∠Ĥĥ√²≤≥≈±]|\b[A-Za-z]_([A-Za-z0-9]|ref|PD|raw)\b/)
        // 圖後緊接一段走圖說明（先看…再看…），而且裡面有 KaTeX（把圖和公式對起來）
        const walk = el.nextElementSibling
        expect(walk?.tagName, name).toBe('P')
        expect(walk?.textContent ?? '', name).toMatch(/先看/)
        expect(walk?.textContent ?? '', name).toMatch(/再看/)
        expect(walk?.querySelectorAll('.katex').length ?? 0, name).toBeGreaterThan(0)
      }
      // 圖在頁面上的先後順序與 diagrams.ts 的排列一致（跟著章節走）
      const order = Array.from(container.querySelectorAll('svg[data-chart]')).map((s) => s.getAttribute('data-chart'))
      expect(order).toEqual(['SYSTEM_MAP', ...NAMES])
      // 幾個「圖在後、公式在前」的關係：延遲方向的圖在 F-07.2 之後；latency 失效例子在 F-07.12 之後；手算流程圖在 Lab 之後
      expect(follows(container.querySelector('[id="formula-F-07.2"]') as Element, fig('CHART_DELAY_SIDE'))).toBe(true)
      expect(follows(container.querySelector('[id="formula-F-07.12"]') as Element, fig('CHART_LATENCY_MISMATCH'))).toBe(true)
      expect(follows(container.querySelector('[id="exp-delay-fx-lab"]') as Element, fig('CHART_HANDCALC_FLOW'))).toBe(true)
      // 平均迴路在相位記帳之後、算 pole 的公式之前；block 平均在兩倍頻推導之後；bring-up 流程在「本課必記」之後（7.10）
      expect(follows(fig('CHART_PHASE_BOOKKEEPING'), fig('CHART_MEAN_LOOP'))).toBe(true)
      expect(follows(fig('CHART_MIXER_AVERAGE'), fig('CHART_BLOCK_AVERAGE'))).toBe(true)
      expect(follows(container.querySelector('#ch07-recap') as Element, fig('CHART_BRINGUP'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  }, 240_000)
})
