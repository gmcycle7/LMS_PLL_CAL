import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import mermaid from 'mermaid'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { SYSTEM_BLOCK_LABEL, systemMapChart } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { conventionalStep, signErrorStep, signSignStep, type TieRule } from '@/simulation/models/lms'
import {
  GEAR_FLOOR_RATIO,
  gradientDescent,
  meanFieldAnalysis,
  meanFieldDrift,
  miniBatchStep,
  nlmsStep,
  noiseOps,
  noisePdfAt,
  signErrorLimitCycle,
  stepSize,
  xMoments,
  type MeanFieldInput,
  type NoiseDist,
} from '@/simulation/models/sgd'
import * as diagramModule from './diagrams'
import { DIAGRAMS, DIAGRAM_BY_ID, type Ch02Diagram, type DiagramKind } from './diagrams'
import { HANDCALCS } from './handcalcs'
import Chapter02 from './index'
import { SYSTEM_FOCUS } from './sections/Intro'

/**
 * Ch02 的方塊圖測試（docs/teaching-style.md §8）。
 *  1. 每一張圖的 Mermaid 原始碼都用「真正的 parser」解析（ch02.test.tsx 為了速度把整個 mermaid mock 掉了）。
 *  2. 每一張圖都用共用的 renderMermaidForTest 「真的畫一次」：parser 抓不到「Unsupported markdown」這類問題。
 *  3. 圖的張數、登錄表與頁面一致；章首有 SystemMap，符號表在章末。
 *  4. 圖和公式／模型一致：加法點的正負號、δ = a − w 的極性、每張圖上的式子用 src/simulation 的實際函式驗算。
 * 這裡沒有 mock 真正的 mermaid 套件；整章頁面測試只把 <Mermaid> 元件換成替身（不然 25 張圖要在整頁渲染裡各畫一次），
 * 替身把原始碼放在 data-chart，方便核對頁面上到底畫了哪些圖。
 */
const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  return {
    Mermaid: ({ chart, caption, ariaLabel }: { chart: string; caption?: string; ariaLabel?: string }) =>
      createElement(
        'figure',
        { className: 'c-mermaid', 'data-chart': chart, 'aria-label': ariaLabel ?? caption },
        caption ? createElement('figcaption', { className: 'c-figcaption' }, caption) : null,
      ),
    renderMermaid: async () => '<svg></svg>',
  }
})

/** 整章渲染在空機上只要幾秒；多個 agent 同時跑測試時會慢很多，逾時只是保險（同 ch02.test.tsx）。 */
const T_PAGE = 600_000

const EXPECTED_TYPE: Record<DiagramKind, string> = { flowchart: 'flowchart-v2', state: 'stateDiagram', sequence: 'sequence' }
/** 本章共 25 張 Mermaid 圖：這次新增 23 張 + 原有 2 張（硬體資料路徑、PLL 校正迴圈，後者已改成含加法點的完整版）；另加章首的 SystemMap。 */
const N_DIAGRAMS = 25
const N_ADDED = 23

const list: readonly Ch02Diagram[] = DIAGRAMS
const chartOf = (id: keyof typeof DIAGRAM_BY_ID) => DIAGRAM_BY_ID[id].chart

interface Vertex {
  id: string
  text: string
  type: string
  classes: string[]
}
interface Edge {
  start: string
  end: string
  text: string
}
interface FlowDb {
  getVertices: () => Map<string, Vertex>
  getEdges: () => Edge[]
  getClasses: () => Map<string, unknown>
  getSubGraphs: () => { id: string }[]
}

/** 用真正的 parser 把 flowchart 解析成節點與連線（檢查結構用）。 */
async function flow(chart: string) {
  await mermaid.parse(chart, { suppressErrors: false }) // 也確保各種圖的 parser 已註冊（單獨跑一個測試時）
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDb
  // subgraph 的 id 出現在隱形連線（A ~~~ B，用來把並排的 subgraph 疊成上下排）時，也會被登錄成 vertex；它們是外框，不是方塊
  const frames = new Set(db.getSubGraphs().map((sg) => sg.id))
  const vertices = [...db.getVertices().values()].filter((v) => !frames.has(v.id))
  const edges = db
    .getEdges()
    .filter((e) => !frames.has(e.start) && !frames.has(e.end))
    .map((e) => ({ start: e.start, end: e.end, text: e.text ?? '' }))
  const node = (id: string) => {
    const v = vertices.find((x) => x.id === id)
    if (!v) throw new Error(`找不到節點 ${id}`)
    return v
  }
  const into = (id: string) => edges.filter((e) => e.end === id)
  const edge = (from: string, to: string) => {
    const e = edges.find((x) => x.start === from && x.end === to)
    if (!e) throw new Error(`找不到連線 ${from} → ${to}`)
    return e
  }
  return { vertices, edges, node, into, edge, classes: [...db.getClasses().keys()] }
}

interface StateDb {
  getRootDocV2: () => unknown
  extract: (doc: unknown) => void
  getStates: () => Map<string, { descriptions: string[]; classes: string[] }>
  getRelations: () => { id1: string; id2: string; relationTitle?: string }[]
}

/** 用真正的 parser 把 stateDiagram-v2 解析成狀態與轉移（狀態表要先 extract 才會填入）。 */
async function stateMachine(chart: string) {
  await mermaid.parse(chart, { suppressErrors: false })
  const db = (await mermaid.mermaidAPI.getDiagramFromText(chart)).db as unknown as StateDb
  db.extract(db.getRootDocV2())
  const states = [...db.getStates().entries()].filter(([id]) => id !== 'root_start').map(([id, s]) => ({ id, descriptions: s.descriptions, classes: s.classes }))
  const relations = db.getRelations().map((r) => ({ from: r.id1, to: r.id2, label: r.relationTitle ?? '' }))
  const label = (from: string, to: string) => {
    const r = relations.find((x) => x.from === from && x.to === to)
    if (!r) throw new Error(`找不到轉移 ${from} → ${to}`)
    return r.label
  }
  return { states, relations, label }
}

const close = (actual: number, expected: number, rel = 1e-9) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)))

describe('Ch02 方塊圖：原始碼（真正的 mermaid parser）', () => {
  it(`共 ${N_DIAGRAMS} 張（新增 ${N_ADDED} 張 + 原有 2 張），每一張都能解析，種類與登錄表一致`, async () => {
    expect(list).toHaveLength(N_DIAGRAMS)
    expect(list.filter((d) => d.added)).toHaveLength(N_ADDED)
    expect(list.filter((d) => !d.added).map((d) => d.id)).toEqual(['datapath', 'pll-loop'])
    for (const d of list) {
      const r = await mermaid.parse(d.chart, { suppressErrors: false })
      expect(r && typeof r === 'object' ? r.diagramType : r, d.id).toBe(EXPECTED_TYPE[d.kind])
    }
    // 三種圖都有用到：flowchart（模型／迴圈／比較／流程）、狀態機、時序
    expect(new Set(list.map((d) => d.kind))).toEqual(new Set(['flowchart', 'state', 'sequence']))
  }, 120_000)

  it('每個 CHART_* 匯出都在登錄表裡、ID 唯一；章內沒有登錄表以外的 Mermaid 原始碼', () => {
    const exported = Object.entries(diagramModule).filter(([k]) => k.startsWith('CHART_'))
    expect(exported).toHaveLength(N_DIAGRAMS)
    const registered = new Set(list.map((d) => d.chart))
    expect(registered.size).toBe(N_DIAGRAMS)
    for (const [name, chart] of exported) expect(registered.has(chart as string), name).toBe(true)
    expect(new Set(list.map((d) => d.id)).size).toBe(N_DIAGRAMS)

    // 其他檔案不可以再藏一份沒被解析過的 Mermaid 原始碼；<Mermaid> 只經由 common.tsx 的 <Diagram> 使用
    const dir = join(process.cwd(), 'src/chapters/ch02')
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
    const sources = walk(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('diagrams.ts'))
    expect(sources.length).toBeGreaterThan(10)
    for (const f of sources) {
      const src = readFileSync(f, 'utf8')
      expect(/`\s*(flowchart|graph|stateDiagram|sequenceDiagram)\b/.test(src), f).toBe(false)
      if (!f.endsWith('common.tsx')) expect(src.includes('<Mermaid'), f).toBe(false)
    }
  })

  it('圖說：一句白話說明要看什麼；數學只能寫成 $...$（Unicode 拼的公式不行）', () => {
    const captions = list.map((d) => d.caption)
    expect(new Set(captions).size).toBe(N_DIAGRAMS)
    for (const d of list) {
      expect(d.caption.length, d.id).toBeGreaterThan(20)
      expect(d.caption.endsWith('。'), d.id).toBe(true)
      expect(/[μσδψεηλτρ²³⁴₀₁₂ₙ″≤≥≈∝]|E\[/.test(d.caption), d.id).toBe(false) // 圖說裡的數學一律寫成 $...$（KaTeX）
      expect((d.caption.match(/\$/g) ?? []).length % 2, `${d.id} 的 $ 沒有成對`).toBe(0)
    }
  })

  it('flowchart 結構：不超過 14 個節點；每條進入加法點的線都標了 ＋ 或 −；用到的 class 都有 classDef', async () => {
    let summing = 0
    for (const d of list.filter((x) => x.kind === 'flowchart')) {
      const g = await flow(d.chart)
      expect(g.vertices.length, `${d.id} 節點數`).toBeLessThanOrEqual(14)
      expect(g.vertices.length, `${d.id} 節點數`).toBeGreaterThanOrEqual(4)
      for (const v of g.vertices) {
        expect(v.text.trim().length, `${d.id}/${v.id} 沒有文字`).toBeGreaterThan(0)
        for (const c of v.classes) expect(g.classes, `${d.id}/${v.id} 用了未定義的 class ${c}`).toContain(c)
      }
      for (const v of g.vertices.filter((x) => x.type === 'circle' && x.text === '＋')) {
        summing++
        const ins = g.into(v.id)
        expect(ins.length, `${d.id}/${v.id} 加法點至少要有兩個輸入`).toBeGreaterThanOrEqual(2)
        for (const e of ins) expect(e.text, `${d.id}：${e.start} → ${v.id} 沒有標正負號`).toMatch(/^[＋−]/)
        expect(g.edges.filter((e) => e.start === v.id).length, `${d.id}/${v.id} 加法點要有輸出`).toBeGreaterThanOrEqual(1)
      }
      // 每張圖都有上色的重點方塊
      expect(g.vertices.some((v) => v.classes.length > 0), `${d.id} 沒有上色的方塊`).toBe(true)
    }
    expect(summing).toBe(21) // 每個加法點都是 ＋ 圓形，進入它的線都標了正負號
  }, 120_000)

  it('狀態圖與時序圖也不過大（狀態 ≤ 6、參與者 ≤ 4），而且不是空圖', async () => {
    for (const d of list.filter((x) => x.kind === 'state')) {
      const m = await stateMachine(d.chart)
      expect(m.states.length, d.id).toBeGreaterThanOrEqual(3)
      expect(m.states.length, d.id).toBeLessThanOrEqual(6)
      expect(m.relations.length, d.id).toBeGreaterThanOrEqual(4)
      for (const s of m.states) expect(s.descriptions.length, `${d.id}/${s.id} 沒有說明文字`).toBeGreaterThanOrEqual(2)
      expect(m.states.some((s) => s.classes.length > 0), `${d.id} 沒有上色的狀態`).toBe(true)
    }
    for (const d of list.filter((x) => x.kind === 'sequence')) {
      await mermaid.parse(d.chart, { suppressErrors: false })
      const db = (await mermaid.mermaidAPI.getDiagramFromText(d.chart)).db as unknown as { getActors: () => Map<string, unknown>; getMessages: () => unknown[] }
      expect(db.getActors().size, d.id).toBe(3)
      expect(db.getMessages().length, d.id).toBeGreaterThanOrEqual(5)
    }
  }, 120_000)

  it('SystemMap：本章標示 regressor、comparator、GMAC、÷N×μ、accumulator 五格，原始碼可解析', async () => {
    expect(SYSTEM_FOCUS).toEqual(['res', 'cmp', 'gmac', 'scale', 'acc'])
    const chart = systemMapChart(SYSTEM_FOCUS)
    expect(chart).toContain('class RES,CMP,GMAC,SCALE,ACC focus')
    const r = await mermaid.parse(chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })
})

describe('Ch02 方塊圖：真的畫一次（共用的 renderMermaidForTest）', () => {
  beforeAll(installMermaidSvgShim)

  it('原始碼規範：不用單獨的半形 + / - 當標籤（Mermaid 11 會畫出 Unsupported markdown）；classDef 只用三種深淺主題都看得清楚的配色', () => {
    const approved = new Set([
      'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff',
      'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff',
      'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff',
    ])
    for (const d of list) {
      expect(/"[+\-*]( |")/.test(d.chart), `${d.id} 有以半形 + - * 開頭的標籤`).toBe(false)
      expect(/\(\(\s*"?[+-]"?\s*\)\)/.test(d.chart), `${d.id} 有半形 +/- 的圓形節點`).toBe(false)
      expect(/\|\s*"?[+-]"?\s*\|/.test(d.chart), `${d.id} 有半形 +/- 的連線標籤`).toBe(false)
      for (const line of d.chart.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('classDef'))) expect(approved.has(line), `${d.id}：${line}`).toBe(true)
    }
  })

  for (const d of list) {
    it(
      `${d.id}：真的畫得出來——沒有 Unsupported markdown、節點數 ≤ 14、加法點的 ＋ 與減號都畫在圖上`,
      async () => {
        const { text, nodeCount } = await renderMermaidForTest(d.chart)
        expect(text).not.toMatch(/Unsupported markdown/)
        expect(nodeCount).toBeLessThanOrEqual(14)
        expect(text.length).toBeGreaterThan(20)
        if (d.chart.includes('(("＋"))')) expect(text).toContain('＋')
        if (/-- "− /.test(d.chart)) expect(text).toContain('−')
      },
      120_000,
    )
  }

  it('章首的 SystemMap（共用元件）也能畫出來，沒有 Unsupported markdown（它有 17 個方塊，不受本章 14 個節點的限制）', async () => {
    const { text, nodeCount } = await renderMermaidForTest(systemMapChart(SYSTEM_FOCUS))
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(nodeCount).toBeGreaterThan(14)
  }, 120_000)
})

describe('Ch02 方塊圖：和公式、模型一致（正負號、極性、圖上的式子）', () => {
  it('Gradient Descent 迴圈（F-02.1）：Δw = −μ·J′，w[n] 與 Δw 都以「+」進加法點，經 z⁻¹ 繞回', async () => {
    const g = await flow(chartOf('gd-loop'))
    expect(g.edge('NEG', 'S').text).toBe("＋ Δw[n] = −μ·J'(w[n])")
    expect(g.edge('W', 'S').text).toBe('＋')
    expect(g.edge('S', 'D').text).toBe('w[n+1]')
    expect(g.node('D').text).toContain('z⁻¹')
    expect(g.edges.some((e) => e.start === 'D' && e.end === 'W')).toBe(true)
  })

  it('T01: 「量坡度」展開圖：e = y − ŷ（+y、−ŷ）、e·x = −J′、Δw = μ·e·x；照圖走兩步得到 1.8、2.28', async () => {
    const g = await flow(chartOf('gd-model'))
    expect(g.edge('BB', 'S1').text).toMatch(/^＋ y\[n\]/)
    expect(g.edge('PR', 'S1').text).toMatch(/^− ŷ\[n\]/)
    expect(g.edge('S1', 'MX').text).toBe('e[n] = y[n] − ŷ[n]')
    expect(g.edge('MX', 'MU').text).toBe("e[n]·x[n] = −J'(w[n])")
    expect(g.edge('MU', 'S2').text).toBe('＋ Δw[n] = μ·e[n]·x[n]')
    expect(g.edge('D', 'S2').text).toMatch(/^＋ w\[n\]/)
    expect(g.into('MX').map((e) => e.start).sort()).toEqual(['S1', 'X'])
    // 照圖上的訊號流手算（a = 3、x = 2、w₀ = 1、μ = 0.1），和 gradientDescent()／conventionalStep() 逐位元相同
    const [a, x, mu] = [3, 2, 0.1]
    const t = gradientDescent({ a, x, w0: 1, mu, steps: 2, cost: 'half' })
    let w = 1
    for (let n = 0; n < 2; n++) {
      const y = a * x // 黑盒子
      const yhat = w * x // 我們的預測
      const e = y - yhat // 第一個加法點
      expect(e * x).toBe(-t.dJ[n]) // 「× x」的輸出就是 −J'(w[n])
      const dw = mu * e * x // 「× μ」
      expect(dw).toBe(t.dw[n])
      expect(w + dw).toBe(conventionalStep({ w, x, y, mu }).w)
      w = w + dw // 第二個加法點 + z⁻¹
      expect(w).toBe(t.w[n + 1])
    }
    close(t.w[1], 1.8, 1e-12)
    close(t.w[2], 2.28, 1e-12)
  })

  it('參數誤差迴圈（F-02.2）：δ = a − w，回授帶負號，δ[n+1] = (1 − μJ″)·δ[n]；和模擬逐步相符', async () => {
    const g = await flow(chartOf('gd-error-loop'))
    expect(g.node('D0').text).toContain('δ[n] = a − w[n]')
    expect(g.edge('MU', 'S').text).toBe("− μ·J''·δ[n]")
    expect(g.edge('D0', 'S').text).toBe('＋')
    expect(g.edge('S', 'Z').text).toBe("δ[n+1] = (1 − μ·J'')·δ[n]")
    const [a, x, mu] = [3, 2, 0.1]
    const t = gradientDescent({ a, x, w0: 1, mu, steps: 5, cost: 'half' })
    const curvature = x * x // J''
    for (let n = 0; n < 5; n++) {
      const delta = a - t.w[n]
      close(a - t.w[n + 1], delta - mu * curvature * delta, 1e-12)
      close(a - t.w[n + 1], (1 - mu * curvature) * delta, 1e-12)
    }
  })

  it('平均坡度（F-02.3）：e = (a − w)x + v，取平均後 −J′ = (a − w)P_x + E[xv]', async () => {
    const g = await flow(chartOf('cost-gradient'))
    expect(g.edge('SY', 'SE').text).toBe('＋ y[n] = a·x[n] + v[n]')
    expect(g.edge('PR', 'SE').text).toBe('− w·x[n]')
    expect(g.edge('SE', 'MX').text).toBe('e[n] = (a − w)·x[n] + v[n]')
    expect(g.node('OUT').text).toContain("−J'(w) = E[e·x]")
    expect(g.node('OUT').text).toContain('(a − w)·P_x + E[x·v]')
    expect(g.node('AVG').classes).toContain('focus')
    // 模型的 ψ_LMS(w) = E[e·x]：x 為 U[0.5, 1.5]（E[x] ≠ 0）、雜訊零均值 ⇒ (a − w)·P_x
    const inp: MeanFieldInput = { a: 3, x: { kind: 'uniformPos', amp: 1 }, noise: { kind: 'gaussian', sigma: 1, outlierProb: 0, outlierSize: 0 }, huberDelta: 1, nlmsEps: 0 }
    close(meanFieldDrift('lms', 2.5, inp), (3 - 2.5) * xMoments(inp.x).m2, 1e-9)
  })

  it('Batch／Mini-batch／SGD：前兩排有「累加、÷」，SGD 沒有；B = 1 的 mini-batch 就是 LMS', async () => {
    const g = await flow(chartOf('batch-vs-sgd'))
    expect(g.node('B3').text).toBe('÷ N')
    expect(g.node('M3').text).toBe('÷ B')
    expect(g.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id).sort()).toEqual(['B2', 'B3', 'M2', 'M3'])
    expect(g.into('G4').map((e) => e.start)).toEqual(['G1']) // SGD：e·x 直接乘 μ
    const [w, x, y, mu] = [1, 2, 6.5, 0.1]
    expect(miniBatchStep(w, [x], [y], [0], mu)).toBe(conventionalStep({ w, x, y, mu }).w)
    // B = 2：累加兩筆的 e·x、除以 2、乘 μ
    const xs = [2, -1]
    const ys = [6.5, -2]
    const acc = (ys[0] - w * xs[0]) * xs[0] + (ys[1] - w * xs[1]) * xs[1]
    close(miniBatchStep(w, xs, ys, [0, 1], mu), w + (mu * acc) / 2, 1e-12)
  })

  it('單筆坡度（F-02.4／F-02.5）：ĝ = J′ + 梯度雜訊，乘 −μ 後更新量是 +μ·e·x', async () => {
    const g = await flow(chartOf('sgd-noise'))
    expect(g.edge('TRUE', 'S1').text).toBe('＋')
    expect(g.edge('GN', 'S1').text).toBe('＋')
    expect(g.edge('S1', 'NEG').text).toContain('ĝ[n] = −e[n]·x[n]')
    expect(g.node('NEG').text).toBe('× (−μ)')
    expect(g.edge('NEG', 'S2').text).toBe('＋ μ·e[n]·x[n]')
    expect(g.node('GN').classes).toContain('warn')
  })

  it('時間軸：q、x 逐 sample，G_k 與 w 逐 block；G_k = (1/N)Σq·x、新的 w = w_k + μ·G_k', () => {
    const c = chartOf('block-timing')
    expect(c).toContain('每個 sample（索引 n）')
    expect(c).toContain('每個 block（索引 k）')
    expect(c).toContain('G_k = (1/N)·Σ q[n]·x[n]')
    expect(c).toContain('係數更新：w_{k+1} = w_k + μ·G_k')
    expect(c.indexOf('loop 共 N 個 sample')).toBeLessThan(c.indexOf('G->>W'))
    // PLL 迴圈圖用同一組式子（逐個 sample 的量用方括號索引 n，逐個 block 的量用下標 k）
    expect(chartOf('pll-loop')).toContain('G_k = (1/N)·Σ q[n]·x[n]')
    expect(chartOf('pll-loop')).toContain('w_{k+1}')
  })

  it('路線圖：每個箭頭丟掉一種資訊；每一格的 Δw 和 stepper 的更新量相同', async () => {
    const g = await flow(chartOf('roadmap'))
    expect(g.edge('GD', 'LMS').text).toBe('平均換成一筆資料')
    expect(g.edge('LMS', 'SE').text).toBe('e 換成 sign(e)')
    expect(g.edge('SE', 'SS').text).toBe('x 換成 sign(x)')
    expect(g.edge('LMS', 'NL').text).toContain('ε + x²')
    expect(g.node('GD').text).toContain("Δw = −μ·J'(w)")
    expect(g.node('LMS').text).toContain('Δw = μ·e·x')
    expect(g.node('SE').text).toContain('Δw = μ·sign(e)·x')
    expect(g.node('SS').text).toContain('Δw = μ·sign(e)·sign(x)')
    expect(g.node('NL').text).toContain('Δw = μ̃·e·x / (ε + x²)')
    expect(g.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id)).toEqual(['SE'])
    const [w, x, y, mu] = [1, -2, 7, 0.1]
    const e = y - w * x
    close(conventionalStep({ w, x, y, mu }).dw, mu * e * x, 1e-12)
    close(signErrorStep({ w, x, y, mu, tie: 'plus' }).dw, mu * Math.sign(e) * x, 1e-12)
    close(signSignStep({ w, x, y, mu, tie: 'plus' }).dw, mu * Math.sign(e) * Math.sign(x), 1e-12)
    close(nlmsStep({ w, x, y, mu, eps: 0.1 }).w - w, (mu * e * x) / (0.1 + x * x), 1e-12)
  })

  it('LMS 迴圈（F-02.5）：e = y − ŷ（＋y、−ŷ）、e·x = −ĝ、Δw = μ·e·x；和 Sign-Error 迴圈只差 sign(·) 這一格', async () => {
    const l = await flow(chartOf('lms-loop'))
    expect(l.edge('SY', 'SUM').text).toBe('＋ y[n]')
    expect(l.edge('PR', 'SUM').text).toBe('− ŷ[n]')
    expect(l.edge('SUM', 'MX').text).toBe('e[n]')
    expect(l.edge('MX', 'MU').text).toBe('e[n]·x[n] = −ĝ[n]')
    expect(l.edge('MU', 'ACC').text).toBe('＋ Δw[n]')
    expect(l.edge('D', 'ACC').text).toBe('＋ w[n]')
    expect(l.edge('D', 'PR').text).toBe('w[n]')
    expect(l.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id)).toEqual(['MX'])
    // 比較圖只在演算法真的不同的地方不同：Sign-Error = LMS ＋ 一顆 sign(·)，其他方塊與連線一模一樣
    const s = await flow(chartOf('sign-error-loop'))
    const ids = (g: { vertices: Vertex[] }) => g.vertices.map((v) => v.id).sort()
    expect(ids(s)).toEqual([...ids(l), 'SGN'].sort())
    for (const v of l.vertices.filter((x) => x.id !== 'MX')) expect(s.node(v.id).text, v.id).toBe(v.text)
    const key = (e: Edge) => `${e.start}->${e.end}:${e.text}`
    const le = l.edges.map(key)
    const se = s.edges.map(key)
    expect(le.filter((k) => !se.includes(k)).sort()).toEqual(['MX->MU:e[n]·x[n] = −ĝ[n]', 'SUM->MX:e[n]'])
    expect(se.filter((k) => !le.includes(k)).sort()).toEqual(['MX->MU:sign(e[n])·x[n]', 'SGN->MX:q[n] = sign(e[n])', 'SUM->SGN:e[n]'])
    // 照圖走一步（y = a·x + v、ŷ = w·x、e = y − ŷ）：Δw = μ·e·x，和 conventionalStep() 相同；梯度是 ĝ = −e·x
    for (const [a, w, x, v] of [
      [3, 1, 2, 0.4],
      [3, 4.5, -1.5, -0.7],
    ]) {
      const y = a * x + v
      const e = y - w * x
      const step = conventionalStep({ w, x, y, mu: 0.1 })
      close(step.e, e, 1e-12)
      close(step.dw, 0.1 * e * x, 1e-12)
      const ghat = -e * x // 單筆梯度
      close(w + step.dw, w - 0.1 * ghat, 1e-12) // 沿 −ĝ 走一步
    }
  })

  it('PLL 校正迴圈（§6）：e = y − ŷ（y = a·x + v、ŷ = w_k·x）；G_k = (1/N)Σq·x、w_{k+1} = w_k + μ·G_k；照圖走一個 block 和逐 sample 的 signErrorStep() 加總相同', async () => {
    const g = await flow(chartOf('pll-loop'))
    // 加法點的正負號與極性（沿用 e = y − ŷ）
    expect(g.edge('TRUE', 'S').text).toBe('＋ y[n]')
    expect(g.edge('GC', 'S').text).toBe('− ŷ[n]')
    expect(g.edge('V', 'S').text).toBe('＋')
    expect(g.edge('S', 'CMP').text).toBe('e[n] = (a − w_k)·x[n] + v[n]')
    expect(g.node('CMP').text).toContain('q[n] = sign(e[n])')
    // 同一個 code x[n]：真實誤差、DTC 補償、GMAC 的輸入
    expect(g.edges.filter((e) => e.start === 'X').map((e) => e.end).sort()).toEqual(['GC', 'GMAC', 'TRUE'])
    expect(g.into('GMAC').map((e) => e.start).sort()).toEqual(['CMP', 'X'])
    expect(g.node('GMAC').text).toContain('G_k = (1/N)·Σ q[n]·x[n]')
    // block 速率：G_k → ×μ → 加法點（另一個輸入是 z⁻¹ 送回來的 w_k）→ w_{k+1} → z⁻¹ → w_k 送回 DTC
    expect(g.edge('GMAC', 'MU').text).toBe('G_k')
    expect(g.edge('MU', 'ACC').text).toBe('＋ μ·G_k')
    expect(g.edge('Z', 'ACC').text).toBe('＋ w_k')
    expect(g.edge('ACC', 'Z').text).toBe('w_{k+1}')
    expect(g.edge('Z', 'GC').text).toBe('w_k')
    expect(g.node('Z').text).toContain('每個 block 一次')
    expect(g.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id).sort()).toEqual(['CMP', 'GMAC'])
    expect(g.node('V').classes).toEqual(['warn'])

    // 照圖走一個 block（N 個 sample，整個 block 的 w 都固定在 w_k）
    const [a, wk, mu, N] = [3, 2.5, 0.3, 16]
    let u = 1234567
    const rand = () => {
      u = (u * 48271) % 2147483647
      return u / 2147483647
    }
    const xs = Array.from({ length: N }, () => [-2, -1, 1, 2][Math.floor(rand() * 4)])
    const vs = Array.from({ length: N }, () => 2 * rand() - 1)
    let G = 0
    let dwSum = 0
    for (let n = 0; n < N; n++) {
      const y = a * xs[n] + vs[n] // 真實的時間誤差 + 雜訊
      const yhat = wk * xs[n] // DTC 補償
      const e = y - yhat // 圖上的加法點
      close(e, (a - wk) * xs[n] + vs[n], 1e-12)
      G += (Math.sign(e) * xs[n]) / N
      dwSum += signErrorStep({ w: wk, x: xs[n], y, mu: mu / N, tie: 'plus' }).dw // 每個 sample 的更新量（步長 μ/N）
    }
    close(wk + mu * G, wk + dwSum, 1e-12) // w_{k+1} = w_k + μ·G_k
    expect(G).toBeGreaterThan(0) // a > w_k ⇒ G_k > 0 ⇒ w 往 a 走（極性正確）
    expect(wk + mu * G).toBeGreaterThan(wk)
    expect(wk + mu * G).toBeLessThan(a + 0.5)
  })

  it('Sign-Error 迴圈（F-02.6）：和 LMS 只差 sign(·)；照圖走一步和 signErrorStep() 相同', async () => {
    const g = await flow(chartOf('sign-error-loop'))
    expect(g.edge('SY', 'SUM').text).toBe('＋ y[n]')
    expect(g.edge('PR', 'SUM').text).toBe('− ŷ[n]')
    expect(g.edge('SGN', 'MX').text).toBe('q[n] = sign(e[n])')
    expect(g.edge('MX', 'MU').text).toBe('sign(e[n])·x[n]')
    expect(g.edge('MU', 'ACC').text).toBe('＋ Δw[n]')
    expect(g.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id)).toEqual(['SGN'])
    for (const [w, x, y] of [
      [1, 1, 3],
      [2, -3, -9],
      [3.4, 2, 6],
    ]) {
      const e = y - w * x
      const q = e > 0 ? 1 : -1
      expect(w + 0.2 * q * x).toBe(signErrorStep({ w, x, y, mu: 0.2, tie: 'plus' }).w)
    }
  })

  it('Limit cycle 狀態圖（F-02.10）：兩個狀態的 w 值與每步距離 h，用 signErrorLimitCycle() 驗算', async () => {
    const m = await stateMachine(chartOf('limit-cycle'))
    expect(m.states.map((s) => s.id).sort()).toEqual(['FAR', 'P1', 'P2'])
    expect(m.label('FAR', 'FAR')).toBe('每步靠近 h = μ·|x|')
    expect(m.label('FAR', 'P1')).toBe('走完 n_c 步')
    expect(m.states.find((s) => s.id === 'P1')!.descriptions).toContain('w = a − sgn(δ₀)·ρ')
    expect(m.states.find((s) => s.id === 'P2')!.descriptions).toContain('w = a + sgn(δ₀)·(h − ρ)')
    // 週期 2：P1 ⇄ P2 互相轉移，而且只有這兩個狀態上色（紅）
    expect(m.label('P1', 'P2')).toContain('越過 a')
    expect(m.label('P2', 'P1')).toContain('往回走')
    expect(m.states.filter((s) => s.classes.includes('warn')).map((s) => s.id).sort()).toEqual(['P1', 'P2'])
    expect(m.relations.some((r) => r.from === 'P1' && r.to === 'FAR')).toBe(false) // 進了週期就出不來
    for (const [a, x, w0, mu] of [
      [3, 1, 0, 0.4], // 章內的例子：{2.8, 3.2}
      [3, 2, 1, 0.15],
      [3, -2, 4.3, 0.2], // 起點在 a 的另一邊（δ₀ < 0）、x 為負
      [-1, 0.5, 2, 0.35],
    ]) {
      const lc = signErrorLimitCycle(a, x, w0, mu, 'plus')
      expect(lc.exactLanding).toBe(false)
      const h = mu * Math.abs(x)
      const d0 = a - w0 // δ₀ = a − w₀
      const nc = Math.floor(Math.abs(d0) / h)
      const rho = Math.abs(d0) - nc * h
      const p1 = a - Math.sign(d0) * rho // 「還沒越過 a」
      const p2 = a + Math.sign(d0) * (h - rho) // 「剛越過 a」
      close(lc.h, h, 1e-12)
      expect(lc.entryStep).toBe(nc)
      close(lc.lo, Math.min(p1, p2), 1e-12)
      close(lc.hi, Math.max(p1, p2), 1e-12)
      close(p2 - p1, Math.sign(d0) * h, 1e-12) // 兩個狀態相距一步 h
    }
  })

  it('sign(0) 分支圖（E40）：0 ⇒ 凍結在 a；±1 ⇒ 在 a 與 a ± μx 之間跳', async () => {
    const g = await flow(chartOf('tie-rule'))
    expect(g.node('Q').type).toBe('diamond')
    expect(g.node('F').text).toContain('凍結在 a')
    expect(g.node('P').text).toContain('a 與 a + μ·x')
    expect(g.node('M').text).toContain('a 與 a − μ·x')
    const [a, x, w0, mu] = [3, 2, 1, 0.125] // |δ₀|/h = 8：剛好踩到 a
    const expected: Record<TieRule, [number, number]> = { zero: [a, a], plus: [a, a + mu * x], minus: [a - mu * x, a] }
    for (const tie of ['zero', 'plus', 'minus'] as TieRule[]) {
      const lc = signErrorLimitCycle(a, x, w0, mu, tie)
      expect(lc.exactLanding).toBe(true)
      expect(lc.frozen).toBe(tie === 'zero')
      expect([lc.lo, lc.hi]).toEqual(expected[tie])
    }
  })

  it('Mean-field 等效圖（F-02.12）：K_q = 2f_v(0)、K_SE = K_q·E[x²]，和 meanFieldAnalysis() 相符', async () => {
    const g = await flow(chartOf('mean-field'))
    expect(g.edge('X1', 'S1').text).toBe('＋ d·x')
    expect(g.edge('V1', 'S1').text).toBe('＋')
    // 兩個「× x」用的是同一筆 x：同一個來源接到兩個乘法器；而且這個來源在 subgraph 內（subgraph 之間不連線，內部的 direction 才有效）
    expect(g.vertices.filter((v) => v.id === 'XS')).toHaveLength(1)
    expect(g.edges.filter((e) => e.start === 'XS').map((e) => e.end).sort()).toEqual(['X1', 'X2'])
    expect(g.into('X2').map((e) => e.start).sort()).toEqual(['SG', 'XS'])
    expect(g.node('D1').text).toBe('d = a − w')
    expect(g.node('KQ').text).toContain('K_q')
    expect(g.node('KQ').text).toContain('2·f_v(0)')
    expect(g.node('PX').text).toBe('× E[x²]')
    expect(g.node('P2').text).toBe('ψ_SE(w) ≈ K_SE·d')
    for (const kind of ['gaussian', 'laplacian'] as const) {
      const noise: NoiseDist = { kind, sigma: 0.5, outlierProb: 0, outlierSize: 0 }
      const inp: MeanFieldInput = { a: 3, x: { kind: 'bpsk', amp: 2 }, noise, huberDelta: 1, nlmsEps: 0 }
      const Kq = 2 * noisePdfAt(noise, 0)
      const Kse = Kq * xMoments(inp.x).m2
      close(meanFieldAnalysis('sign_error', inp).K, Kse, 1e-6)
      if (kind === 'gaussian') close(Kq, Math.sqrt(2 / Math.PI) / 0.5, 1e-12)
      // 小誤差：ψ_SE(w) ≈ K_SE·d（d = a − w；|d·x| = 0.002 ≪ σ_v = 0.5）
      const d = 0.001
      close(meanFieldDrift('sign_error', 3 - d, inp), Kse * d, 1e-4)
    }
  })

  it('步長排程圖（F-02.11）與 gear-shift 狀態圖：和 stepSize() 相符', async () => {
    const g = await flow(chartOf('step-schedule'))
    expect(g.node('SCH').text).toContain('μ[n] = μ₀ / (1 + n/n₀)')
    expect(g.node('B1').text).toContain('μ[n]·|x|')
    expect(g.node('B1').text).toContain('無限大')
    expect(g.node('B2').text).toContain('μ[n]²·σ_η²')
    expect(g.node('B2').text).toContain('有限')
    const [mu0, n0] = [0.4, 20]
    for (const n of [0, 7, 20, 400]) close(stepSize(mu0, n, { kind: 'harmonic', n0 }), mu0 / (1 + n / n0), 1e-12)
    expect(stepSize(mu0, n0, { kind: 'harmonic', n0 })).toBe(mu0 / 2) // 內文：「走到第 n₀ 步時步長剛好減半」
    // gear：粗調（前 n₀ 步是 μ₀）→ 每 n₀ 步右移一位 → 下限 μ₀/64（右移 6 位）
    const gear = await stateMachine(chartOf('gear-shift'))
    expect(gear.states.map((s) => s.id)).toEqual(['COARSE', 'SHIFT', 'TRACK'])
    expect(gear.label('COARSE', 'SHIFT')).toBe('過了 n₀ 步')
    expect(gear.label('SHIFT', 'SHIFT')).toBe('每 n₀ 步再右移一位')
    expect(gear.label('SHIFT', 'TRACK')).toBe('降到下限 μ_min')
    expect(gear.relations.some((r) => r.from === 'TRACK' && r.to !== 'TRACK')).toBe(false) // 到了下限就不再變
    expect(GEAR_FLOOR_RATIO).toBe(1 / 64)
    expect(stepSize(mu0, 0, { kind: 'gear', n0 })).toBe(mu0)
    expect(stepSize(mu0, n0 - 1, { kind: 'gear', n0 })).toBe(mu0)
    expect(stepSize(mu0, n0, { kind: 'gear', n0 })).toBe(mu0 / 2)
    expect(stepSize(mu0, 2 * n0, { kind: 'gear', n0 })).toBe(mu0 / 4)
    expect(stepSize(mu0, 6 * n0, { kind: 'gear', n0 })).toBe(mu0 / 64)
    expect(stepSize(mu0, 50 * n0, { kind: 'gear', n0 })).toBe(mu0 / 64)
  })

  it('Sign-Sign 迴圈（F-02.7）：比 Sign-Error 多一格 sign(x)；計數器每步 ±μ，和 signSignStep() 相同', async () => {
    const g = await flow(chartOf('sign-sign-loop'))
    expect(g.edge('SY', 'SUM').text).toBe('＋ y[n]')
    expect(g.edge('PR', 'SUM').text).toBe('− ŷ[n]')
    expect(g.edge('SGE', 'XOR').text).toBe('sign(e[n])')
    expect(g.edge('SGX', 'XOR').text).toBe('sign(x[n])')
    expect(g.node('CNT').text).toContain('w[n+1] = w[n] ± μ')
    expect(g.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id)).toEqual(['SGX'])
    for (const [w, x, y] of [
      [2, -3, -9],
      [1, 4, 10],
      [5, 2, 7],
    ]) {
      const e = y - w * x
      const s = Math.sign(e) * Math.sign(x)
      expect(w + 0.1 * s).toBe(signSignStep({ w, x, y, mu: 0.1, tie: 'plus' }).w)
    }
  })

  it('比值圖（F-02.9）、相關器圖（F-02.8）、判斷流程（F-02.18）：圖上的條件與公式相同', async () => {
    const r = await flow(chartOf('ratio-view'))
    expect(r.node('R').text).toContain('r[i] = y[i] / x[i]')
    expect(r.node('R').text).toContain('a + v[i] / x[i]')
    expect(r.node('A1').text).toMatch(/LMS.*x² 加權的平均/)
    expect(r.node('A2').text).toMatch(/Sign-Error.*\|x\| 加權的中位數/)
    expect(r.node('A3').text).toMatch(/Sign-Sign.*不加權的中位數/)
    expect(r.node('A4').text).toMatch(/NLMS.*不加權的平均/)
    // 平均類同色、中位數類同色
    expect([r.node('A1').classes, r.node('A4').classes]).toEqual([['focus'], ['focus']])
    expect([r.node('A2').classes, r.node('A3').classes]).toEqual([['ok'], ['ok']])

    const f = await flow(chartOf('fixed-points'))
    expect(f.into('M1').map((e) => e.start).sort()).toEqual(['E', 'X']) // LMS：e × x
    expect(f.into('M2').map((e) => e.start).sort()).toEqual(['SE', 'X']) // Sign-Error：sign(e) × x
    expect(f.into('M3').map((e) => e.start).sort()).toEqual(['SE', 'SX']) // Sign-Sign：sign(e) × sign(x)
    expect(f.into('SE').map((e) => e.start)).toEqual(['E'])
    expect(f.into('SX').map((e) => e.start)).toEqual(['X'])
    expect(f.node('Z1').text).toContain('E[e·x] = 0')
    expect(f.node('Z2').text).toContain('E[sign(e)·x] = 0')
    expect(f.node('Z3').text).toContain('E[sign(e)·sign(x)] = 0')

    const p = await flow(chartOf('psi-at-a'))
    expect(p.node('Q1').text).toContain('E[x] = 0 而且 E[sign x] = 0')
    expect(p.node('Q2').text).toContain('E[v] = 0 而且 E[sign v] = 0')
    expect(p.edge('Q1', 'OK1').text).toBe('是')
    expect(p.edge('Q2', 'OK2').text).toBe('是')
    expect(p.edge('Q2', 'CHK').text).toBe('否')
    for (const t of ['LMS：E[v]·E[x]', 'Sign-Error：E[sign v]·E[x]', 'Sign-Sign：E[sign v]·E[sign x]']) expect(p.node('CHK').text).toContain(t)
    // 用模型驗算流程圖的三個結論（偏斜雜訊：E[v] = 0 但 E[sign v] ≠ 0）
    const skew: NoiseDist = { kind: 'skewed', sigma: 1, outlierProb: 0, outlierSize: 0 }
    const signV = noiseOps(skew).signMean(0)
    expect(Math.abs(signV)).toBeGreaterThan(0.2)
    const mk = (kind: 'bpsk' | 'uniformPos', noise: NoiseDist): MeanFieldInput => ({ a: 3, x: { kind, amp: 1 }, noise, huberDelta: 1, nlmsEps: 0 })
    // 第一關：code 對稱 ⇒ 不論雜訊形狀，ψ(a) = 0
    for (const algo of ['lms', 'sign_error', 'sign_sign'] as const) close(meanFieldDrift(algo, 3, mk('bpsk', skew)), 0, 1e-9)
    // 第二關：雜訊的平均與中位數都是 0 ⇒ 不論 code，ψ(a) = 0
    const gauss: NoiseDist = { kind: 'gaussian', sigma: 1, outlierProb: 0, outlierSize: 0 }
    for (const algo of ['lms', 'sign_error', 'sign_sign'] as const) close(meanFieldDrift(algo, 3, mk('uniformPos', gauss)), 0, 1e-9)
    // 兩關都沒過：逐一檢查三個乘積
    const bad = mk('uniformPos', skew)
    const m = xMoments(bad.x)
    close(meanFieldDrift('lms', 3, bad), 0 * m.m1, 1e-9) // E[v]·E[x] = 0：LMS 仍在 a
    close(meanFieldDrift('sign_error', 3, bad), signV * m.m1, 1e-6) // E[sign v]·E[x] ≠ 0
    close(meanFieldDrift('sign_sign', 3, bad), signV * 1, 1e-6) // E[sign v]·E[sign x]，x > 0 ⇒ E[sign x] = 1
  })

  it('資訊量地圖與硬體資料路徑：丟掉資訊的順序、上色的那一格', async () => {
    const m = await flow(chartOf('info-map'))
    expect(m.edge('A', 'C').text).toBe('丟掉 e 的大小')
    expect(m.edge('C', 'D').text).toBe('再丟掉 x 的大小')
    expect(m.node('A').text).toMatch(/LMS.*error 多位元、regressor 多位元/)
    expect(m.node('C').text).toMatch(/Sign-Error.*error 1 bit、regressor 多位元/)
    expect(m.node('D').text).toMatch(/Sign-Sign.*error 1 bit、regressor 1 bit/)
    expect(m.node('B').text).toContain('本章不討論')

    const d = await flow(chartOf('datapath'))
    expect(d.node('M1').classes).toEqual(['warn']) // 乘法器
    expect(d.node('N2').classes).toEqual(['focus']) // 條件取負
    expect(d.node('X3').classes).toEqual(['ok']) // XOR
    expect(d.node('N2').text).toBe('MUX：q ? x : −x')
  })

  it('穩態抖動迴圈（F-02.13）與 NLMS 資料路徑（F-02.15）', async () => {
    const g = await flow(chartOf('noise-loop'))
    expect(g.edge('MU', 'S').text).toBe('＋ μ·η[n]')
    expect(g.edge('P', 'S').text).toBe('＋ (1 − μ·K)·δ[n]')
    expect(g.node('P').text).toContain('× (1 − μ·K)')
    expect(g.edge('S', 'Z').text).toBe('δ[n+1]')
    // 照圖疊代變異：V ← (1 − μK)²·V + μ²·σ_η²，收斂到 F-02.13 的 μσ_η²/(K(2 − μK))
    const [mu, K, s2] = [0.02, 1.6, 1]
    let V = 0
    for (let n = 0; n < 5000; n++) V = (1 - mu * K) ** 2 * V + mu * mu * s2
    close(V, (mu * s2) / (K * (2 - mu * K)), 1e-9)

    const n = await flow(chartOf('nlms-datapath'))
    expect(n.node('DV').text).toContain('÷ (ε + x[n]²)')
    expect(n.into('DV').map((e) => e.start).sort()).toEqual(['M2', 'SQ'])
    expect(n.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id).sort()).toEqual(['DV', 'SQ'])
    const [w, x, y, mut, eps] = [1, 2, 7, 0.5, 0.1]
    const e = y - w * x
    close(nlmsStep({ w, x, y, mu: mut, eps }).w, w + (mut * (e * x)) / (eps + x * x), 1e-12)
    // 「輸入變大十倍，更新量會自動縮回來」：ε = 0 時 a posteriori 誤差的收縮比例與 x 的大小無關
    for (const k of [1, 10]) {
      const out = nlmsStep({ w, x: k * x, y: k * y, mu: mut, eps: 0 })
      close((k * y - out.w * k * x) / (k * y - w * k * x), 1 - mut, 1e-12)
    }
  })

  it('綜合手算流程圖：圖上每一格的式子照著算，和 HC-02.8 的答案相同', async () => {
    const g = await flow(chartOf('design-flow'))
    for (const [id, text] of [
      ['KQ', 'K_q = √(2/π) / σ_v'],
      ['PX', 'E[x²] = A²、E[x⁴] = A⁴'],
      ['KSE', 'K_SE = K_q · E[x²]'],
      ['G', 'g = μ · K_SE'],
      ['P', 'p = 1 − g'],
      ['TAU', 'τ = −1 / ln|p|'],
      ['SN', 'σ_η² = E[x²]'],
      ['VAR', 'Var_SE ≈ μ·σ_η² / (K_SE·(2 − g))'],
      ['SW', 'σ_w = √Var_SE'],
      ['MUL', 'μ_L = g / E[x²]'],
      ['VL', 'μ_L·σ_v²·E[x²] / (2·E[x²] − μ_L·E[x⁴])'],
      ['R', 'Var_SE / Var_LMS = π/2'],
    ]) {
      expect(g.node(id).text, id).toContain(text)
    }
    // 每一格只用到它上游已經算好的數（圖是 DAG，而且每個輸出都能追溯到「已知」）
    expect(g.into('KSE').map((e) => e.start).sort()).toEqual(['KQ', 'PX'])
    expect(g.into('VAR').map((e) => e.start).sort()).toEqual(['G', 'SN'])
    expect(g.into('R').map((e) => e.start).sort()).toEqual(['VAR', 'VL'])

    const hc = HANDCALCS.find((h) => h.id === 'HC-02.8')!
    for (const [sigma, A, mu] of [
      [0.5, 1, 0.02], // 預設值
      [2, 2, 0.05],
      [1, 0.5, 0.1],
    ]) {
      const Kq = Math.sqrt(2 / Math.PI) / sigma
      const Ex2 = A * A
      const Ex4 = A ** 4
      const Kse = Kq * Ex2
      const gain = mu * Kse
      const p = 1 - gain
      const tau = -1 / Math.log(Math.abs(p))
      const sEta2 = Ex2
      const varSe = (mu * sEta2) / (Kse * (2 - gain))
      const sw = Math.sqrt(varSe)
      const muL = gain / Ex2
      const varLms = (muL * sigma * sigma * Ex2) / (2 * Ex2 - muL * Ex4)
      const results = Object.fromEntries(hc.solve({ sigma, A, mu }).results.map((r) => [r.symbol, r.value]))
      close(results[String.raw`K_{\rm SE}`], Kse, 1e-6)
      close(results.p, p, 1e-6)
      close(results[String.raw`\tau`], tau, 1e-5)
      close(results[String.raw`\sigma_w`], sw, 1e-6)
      close(results[String.raw`\operatorname{Var}_{\rm SE}/\operatorname{Var}_{\rm LMS}`], varSe / varLms, 1e-6)
      close(varSe / varLms, Math.PI / 2, 1e-9)
    }
  })
})

describe('Ch02 方塊圖：頁面（SystemMap、位置、看圖說明）', () => {
  afterEach(cleanup)

  function renderChapter() {
    try {
      localStorage.setItem('lmspll.mode', 'engineer')
    } catch {
      /* ignore */
    }
    return render(
      <MemoryRouter initialEntries={['/ch/02']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SettingsProvider>
          <Chapter02 />
        </SettingsProvider>
      </MemoryRouter>,
    )
  }
  const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)

  it(
    `章首有 SystemMap；全章 ${N_DIAGRAMS} 張圖依登錄順序各出現一次，每張都有圖說與「先看…再看…」的說明，並放在對應公式之前`,
    () => {
      const { container } = renderChapter()

      // ── SystemMap：緊跟在開場問題後面、在 §1 之前，後面有一句說明藍色方塊與本章新增的內容 ──
      const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
      expect(figures).toHaveLength(N_DIAGRAMS + 1)
      const map = container.querySelector('figure.c-mermaid[aria-label^="DTC-based Fractional-N PLL"]')!
      expect(map).toBeTruthy()
      expect(figures[0]).toBe(map)
      for (const b of SYSTEM_FOCUS) expect(map.getAttribute('aria-label')).toContain(SYSTEM_BLOCK_LABEL[b])
      const question = container.querySelector('.ch02-question')!
      expect(question.nextElementSibling).toBe(map)
      const note = container.querySelector('[data-system-map-note]')!
      expect(map.nextElementSibling).toBe(note)
      expect(note.textContent).toMatch(/藍色的方塊.*這一章加上的是.*更新式/)
      expect(follows(map, container.querySelector('#ch02-s1')!)).toBe(true)

      // ── 每一張圖：順序、圖說、說明、對應公式 ──
      const slots = Array.from(container.querySelectorAll('[data-diagram]'))
      expect(slots.map((s) => s.getAttribute('data-diagram'))).toEqual(list.map((d) => d.id))
      for (const d of list) {
        const slot = container.querySelector(`[data-diagram="${d.id}"]`)!
        expect(slot.querySelectorAll('figure.c-mermaid'), d.id).toHaveLength(1)
        expect(slot.querySelector('figcaption')?.textContent, d.id).toBe(d.caption)
        const walk = slot.querySelector('.ch02-diagram-walk')!
        expect(walk, `${d.id} 沒有看圖說明`).toBeTruthy()
        expect(walk.textContent, d.id).toMatch(/先[\s\S]*看[\s\S]*再[\s\S]*看/)
        expect(walk.querySelectorAll('.katex').length, `${d.id} 的說明裡沒有數學`).toBeGreaterThan(0)
        expect(walk.textContent, `${d.id} 沒有「圖上的 X 就是公式裡的 x」`).toMatch(/圖上/)
        for (const fid of d.formulas ?? []) {
          const anchor = document.getElementById(`formula-${fid}`)!
          expect(anchor, `${d.id} → ${fid}`).toBeTruthy()
          expect(follows(slot, anchor), `${d.id} 應在 ${fid} 之前`).toBe(true)
          expect(walk.textContent, `${d.id} 的說明要提到 ${fid}`).toContain(fid)
        }
        if (d.beforeHandCalc) expect(follows(slot, container.querySelector(`[id="handcalc-${d.beforeHandCalc}"]`)!), d.id).toBe(true)
      }

      // ── 每個 boxed 公式之前都有一張說明它的圖 ──
      const covered = new Set(list.flatMap((d) => d.formulas ?? []))
      const boxed = Array.from(container.querySelectorAll('[id^="formula-F-02."]'))
        .filter((el) => (el.querySelector('annotation')?.textContent ?? '').includes(String.raw`\boxed`))
        .map((el) => el.id.replace('formula-', ''))
      expect(boxed.length).toBeGreaterThanOrEqual(15)
      for (const fid of boxed) expect(covered.has(fid), `boxed 公式 ${fid} 沒有對應的方塊圖`).toBe(true)

      // ── 每一節（§1–§6）至少兩張圖 ──
      const heads = ['ch02-s1', 'ch02-s2', 'ch02-s3', 'ch02-s4', 'ch02-s5', 'ch02-s6'].map((id) => container.querySelector(`#${id}`)!)
      heads.forEach((h, i) => {
        const inSection = slots.filter((s) => follows(h, s) && (i === heads.length - 1 || follows(s, heads[i + 1])))
        expect(inSection.length, h.id).toBeGreaterThanOrEqual(2)
      })

      // 看圖說明裡的數學都是可解析的 KaTeX
      expect(Array.from(container.querySelectorAll('.ch02-diagram .katex-error, .ch02-diagram .c-tex-error'))).toEqual([])
    },
    T_PAGE,
  )
})
