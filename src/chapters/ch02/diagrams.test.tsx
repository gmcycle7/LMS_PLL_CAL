import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup } from '@testing-library/react'
import mermaid from 'mermaid'
import { SYSTEM_BLOCK_LABEL, accessibleText, systemMapModel } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
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
import { SYMBOLS } from './sections/Symbols'
import { renderPage } from '@/test/renderPage'

/**
 * Ch02 的方塊圖測試（docs/teaching-style.md §8）。
 *  1. 每一張圖的 Mermaid 原始碼都用「真正的 parser」解析（ch02.test.tsx 為了速度把整個 mermaid mock 掉了）。
 *  2. 每一張圖都用共用的 renderMermaidForTest 「真的畫一次」：parser 抓不到「Unsupported markdown」這類問題；
 *     圖內的數學一律是 `$...$`（KaTeX 排版）：畫出來的文字沒有殘留的 `$`、KaTeX 以外沒有 Unicode 拼的數學、每個含公式的標籤都真的排版成功。
 *  3. 圖的張數、登錄表與頁面一致；章首有 SystemMap，符號表在章末。
 *  4. 圖和公式／模型一致：加法點的正負號、δ = a − w 的極性、每張圖上的式子用 src/simulation 的實際函式驗算。
 * 這裡沒有 mock 真正的 mermaid 套件；整章頁面測試只把 <Mermaid> 元件換成替身（不然 25 張圖要在整頁渲染裡各畫一次），
 * 替身把原始碼放在 data-chart，方便核對頁面上到底畫了哪些圖。
 */
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
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

  it('圖內數學：`$` 成對；`$...$` 以外沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k）；標籤內不用雙反斜線', () => {
    for (const d of list) {
      // mermaid 語法行（classDef、class、direction）不含標籤；拿掉所有 $$...$$ 與 $...$ 之後，剩下的只有文字與 Mermaid 語法
      const outside = d.chart.replace(/\$\$[^$]*\$\$/g, '').replace(/\$[^$\n]*\$/g, '')
      expect(outside.includes('$'), `${d.id} 的 $ 沒有成對`).toBe(false)
      expect(unicodeMathIn(outside), `${d.id} 在 $...$ 以外還有 Unicode 拼的數學`).toEqual([])
      expect(d.chart.includes('\\\\'), `${d.id} 標籤內不可以用雙反斜線（Mermaid 會把它收成一個）`).toBe(false)
      // flowchart 的標籤用 $...$（由 mermaidMathDelimiters 合併）；state／sequence 直接寫 Mermaid 原生的單一 $$...$$
      if (d.kind === 'flowchart') expect(d.chart.includes('$$'), `${d.id} 的 flowchart 標籤用 $...$，不要手寫 $$`).toBe(false)
      else for (const line of d.chart.split('\n').filter((l) => l.includes('$$'))) expect((line.match(/\$\$/g) ?? []).length, `${d.id}：一個標籤只能有一段 $$...$$：${line.trim()}`).toBe(2)
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
      // 加法點是 ＋ 圓形；PLL 校正迴圈的 PD 也是一個減法器（reference 減 feedback），畫成寫著 PD 的圓形，進入它的線同樣要標正負號
      for (const v of g.vertices.filter((x) => x.type === 'circle' && (x.text === '＋' || x.text === 'PD'))) {
        summing++
        const ins = g.into(v.id)
        expect(ins.length, `${d.id}/${v.id} 加法點至少要有兩個輸入`).toBeGreaterThanOrEqual(2)
        for (const e of ins) expect(e.text, `${d.id}：${e.start} → ${v.id} 沒有標正負號`).toMatch(/^(?:＋|\$-\$)/) // 加號寫全形「＋」；含公式的減號寫成 $-$
        expect(g.edges.filter((e) => e.start === v.id).length, `${d.id}/${v.id} 加法點要有輸出`).toBeGreaterThanOrEqual(1)
      }
      // 每張圖都有上色的重點方塊
      expect(g.vertices.some((v) => v.classes.length > 0), `${d.id} 沒有上色的方塊`).toBe(true)
    }
    expect(summing).toBe(21) // 每個加法點（含 PLL 校正迴圈的 PD 圓形）進入它的線都標了正負號
  }, 120_000)

  it('狀態圖與時序圖也不過大（狀態 ≤ 6、參與者 ≤ 4），而且不是空圖', async () => {
    for (const d of list.filter((x) => x.kind === 'state')) {
      const m = await stateMachine(d.chart)
      expect(m.states.length, d.id).toBeGreaterThanOrEqual(3)
      expect(m.states.length, d.id).toBeLessThanOrEqual(6)
      // 起點 → 第一個狀態，加上每個狀態之間的轉移：limit-cycle 是 4 條（含 P1 ⇄ P2），gear-shift 是 3 條（粗調 → 換檔 → 追蹤）
      expect(m.relations.length, d.id).toBe(d.id === 'limit-cycle' ? 4 : 3)
      // 沒有自己指向自己的轉移：Mermaid 會把它畫成一條又長又尖的怪迴圈，「每步做什麼」寫在狀態的說明裡
      expect(m.relations.filter((r) => r.from === r.to), d.id).toEqual([])
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

  it('SystemMap：本章標示 regressor、comparator、GMAC、÷N×μ、accumulator 五格（手排 SVG，不經過 Mermaid；用 systemMapModel 核對主角）', () => {
    expect(SYSTEM_FOCUS).toEqual(['res', 'cmp', 'gmac', 'scale', 'acc'])
    const model = systemMapModel(SYSTEM_FOCUS)
    // 被標成主角的剛好是這五格（依地圖上的方塊順序），其餘方塊都不是
    expect(model.blocks.filter((b) => b.focused).map((b) => b.id).sort()).toEqual([...SYSTEM_FOCUS].sort())
    expect(model.blocks.filter((b) => !b.focused)).toHaveLength(model.blocks.length - SYSTEM_FOCUS.length)
    // 五格的標題就是正文講的東西：regressor x[n]、1-bit comparator、GMAC Σq·x、÷N×μ、w_k
    const byId = Object.fromEntries(model.blocks.map((b) => [b.id, b]))
    expect(byId.res.sub).toContain('x[n]')
    expect(byId.cmp.title).toBe('1-bit comparator')
    expect(byId.gmac.sub).toContain(String.raw`\sum q[n]\,x[n]`)
    expect(byId.scale.sub).toContain(String.raw`\div N`)
    expect(byId.scale.sub).toContain(String.raw`\times\,\mu`)
    expect(byId.acc.sub).toContain('w_k')
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

  /** 圖上應該有幾段 KaTeX：flowchart 是含 `$` 的雙引號標籤；state／sequence 是含 `$$` 的行。 */
  const mathLabels = (d: Ch02Diagram) =>
    d.kind === 'flowchart' ? (d.chart.match(/"[^"\n]*\$[^"\n]*"/g) ?? []).length : d.chart.split('\n').filter((l) => l.includes('$$')).length

  for (const d of list) {
    it(
      `${d.id}：真的畫得出來——沒有 Unsupported markdown、圖上沒有殘留的 $、KaTeX 以外沒有 Unicode 數學、每個含公式的標籤都排版成功、節點數 ≤ 14`,
      async () => {
        const { text, plainText, nodeCount, mathCount } = await renderMermaidForTest(d.chart)
        expect(text).not.toMatch(/Unsupported markdown/)
        expect(text, `${d.id} 圖上殘留 $（公式沒有排版）`).not.toContain('$')
        expect(unicodeMathIn(plainText), `${d.id} 在 KaTeX 以外還有 Unicode 拼的數學`).toEqual([])
        expect(mathCount, `${d.id} 的公式標籤沒有全部排版成 KaTeX`).toBe(mathLabels(d))
        expect(mathCount).toBeGreaterThan(0)
        expect(nodeCount).toBeLessThanOrEqual(14)
        expect(text.length).toBeGreaterThan(20)
        if (d.chart.includes('(("＋"))')) expect(text).toContain('＋')
        if (/-- "\$-\$ /.test(d.chart)) expect(text).toContain('−') // 含公式的減號 $-$ 畫成 KaTeX 的減號 U+2212
      },
      120_000,
    )
  }
})

describe('Ch02 方塊圖：和公式、模型一致（正負號、極性、圖上的式子）', () => {
  it('Gradient Descent 迴圈（F-02.1）：Δw = −μ·J′，w[n] 與 Δw 都以「+」進加法點，經 z⁻¹ 繞回', async () => {
    const g = await flow(chartOf('gd-loop'))
    expect(g.edge('NEG', 'S').text).toBe(String.raw`＋ $\Delta w[n] = -\mu J'(w[n])$`)
    expect(g.edge('W', 'S').text).toBe('＋')
    expect(g.edge('S', 'D').text).toBe('$w[n+1]$')
    expect(g.node('D').text).toContain('$z^{-1}$')
    expect(g.edges.some((e) => e.start === 'D' && e.end === 'W')).toBe(true)
    // 畫出來的 KaTeX 文字（MathML 複本已去掉）：Δw[n] = −μJ′(w[n])、z⁻¹
    const { text } = await renderMermaidForTest(chartOf('gd-loop'))
    expect(text).toContain('Δw[n]=−μJ′(w[n])')
    expect(text).toContain('z−1')
  })

  it('T01: 「量坡度」展開圖：e = y − ŷ（+y、−ŷ）、e·x = −J′、Δw = μ·e·x；照圖走兩步得到 1.8、2.28', async () => {
    const g = await flow(chartOf('gd-model'))
    expect(g.edge('BB', 'S1').text).toMatch(/^＋ \$y\[n\]/)
    expect(g.edge('PR', 'S1').text).toMatch(/^\$-\$ \$\\hat y\[n\]/)
    expect(g.edge('S1', 'MX').text).toBe(String.raw`$e[n] = y[n] - \hat y[n]$`)
    expect(g.edge('MX', 'MU').text).toBe(String.raw`$e[n]\,x[n] = -J'(w[n])$`)
    expect(g.edge('MU', 'S2').text).toBe(String.raw`＋ $\Delta w[n] = \mu\,e[n]\,x[n]$`)
    expect(g.edge('D', 'S2').text).toMatch(/^＋ \$w\[n\]/)
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
    expect(g.node('D0').text).toContain(String.raw`$\delta[n] = a - w[n]$`)
    expect(g.edge('MU', 'S').text).toBe(String.raw`$-$ $\mu\,J''\,\delta[n]$`)
    expect(g.edge('D0', 'S').text).toBe('＋')
    expect(g.edge('S', 'Z').text).toBe(String.raw`$\delta[n+1] = (1 - \mu J'')\,\delta[n]$`)
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
    expect(g.edge('SY', 'SE').text).toBe(String.raw`＋ $y[n] = a\,x[n] + v[n]$`)
    expect(g.edge('PR', 'SE').text).toBe(String.raw`$-$ $w\,x[n]$`)
    expect(g.edge('SE', 'MX').text).toBe(String.raw`$e[n] = (a - w)\,x[n] + v[n]$`)
    expect(g.node('OUT').text).toContain(String.raw`$-J'(w) = E[e\,x]$`)
    expect(g.node('OUT').text).toContain(String.raw`$= (a - w)\,P_x + E[x\,v]$`)
    expect(g.node('AVG').classes).toContain('focus')
    // 模型的 ψ_LMS(w) = E[e·x]：x 為 U[0.5, 1.5]（E[x] ≠ 0）、雜訊零均值 ⇒ (a − w)·P_x
    const inp: MeanFieldInput = { a: 3, x: { kind: 'uniformPos', amp: 1 }, noise: { kind: 'gaussian', sigma: 1, outlierProb: 0, outlierSize: 0 }, huberDelta: 1, nlmsEps: 0 }
    close(meanFieldDrift('lms', 2.5, inp), (3 - 2.5) * xMoments(inp.x).m2, 1e-9)
  })

  it('Batch／Mini-batch／SGD：前兩排有「累加、÷」，SGD 沒有；B = 1 的 mini-batch 就是 LMS', async () => {
    const g = await flow(chartOf('batch-vs-sgd'))
    expect(g.node('B3').text).toBe(String.raw`$\div N$`)
    expect(g.node('M3').text).toBe(String.raw`$\div B$`)
    // subgraph 標題不放數學（共用主題會把標題裡的 KaTeX 縮到 5–8px）：N、B 與 GMAC 都還在方塊上
    expect(g.node('B2').text).toBe(String.raw`累加 $N$ 筆`)
    expect(g.node('B5').text).toContain(String.raw`每 $N$ 筆一次`)
    expect(g.node('M2').text).toContain(String.raw`累加 $B$ 筆`)
    expect(g.node('M2').text).toContain('GMAC')
    expect(g.node('M5').text).toContain(String.raw`每 $B$ 筆一次`)
    expect(g.node('G5').text).toContain('每筆一次')
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
    expect(g.edge('S1', 'NEG').text).toContain(String.raw`$\hat g[n] = -e[n]\,x[n]$`)
    expect(g.node('NEG').text).toBe(String.raw`$\times (-\mu)$`)
    expect(g.edge('NEG', 'S2').text).toBe(String.raw`＋ $\mu\,e[n]\,x[n]$`)
    expect(g.node('GN').classes).toContain('warn')
  })

  it('時間軸：q、x 逐 sample，G_k 與 w 逐 block；G_k = (1/N)Σq·x、新的 w = w_k + μ·G_k', () => {
    const c = chartOf('block-timing')
    expect(c).toContain('每個 sample 動一次') // participant 名稱放不了公式：速率用文字，索引 n、k 寫在訊息的公式裡
    expect(c).toContain('每個 block 才更新一次')
    expect(c).toContain(String.raw`$$q[n]\text{，乘上 }x[n]\text{ 後加進累加器}$$`)
    expect(c).toContain(String.raw`$$G_k = \frac{1}{N}\sum q[n]\,x[n]$$`)
    expect(c).toContain(String.raw`$$\text{係數更新：}w_{k+1} = w_k + \mu\,G_k$$`)
    expect(c.indexOf('loop 這個 block 裡的每一個 sample')).toBeLessThan(c.indexOf('G->>W'))
    expect(c.indexOf('C->>G')).toBeLessThan(c.indexOf('G->>W')) // 逐 sample 累加在前，block 結束才交給係數
    // PLL 迴圈圖用同一組式子（逐個 sample 的量用方括號索引 n，逐個 block 的量用下標 k）
    expect(chartOf('pll-loop')).toContain(String.raw`$G_k = \frac{1}{N}\sum q[n]\,x[n]$`)
    expect(chartOf('pll-loop')).toContain('$w_{k+1}$')
  })

  it('路線圖：每個箭頭丟掉一種資訊；每一格的 Δw 和 stepper 的更新量相同', async () => {
    const g = await flow(chartOf('roadmap'))
    // 由上往下畫（橫排會寬到約 1250px、字縮到 0.72 倍）：圖說與看圖說明也寫「由上」，不是「由左到右」
    expect(chartOf('roadmap')).toMatch(/^flowchart TB\n/)
    expect(DIAGRAM_BY_ID.roadmap.caption).toContain('由上到下')
    expect(DIAGRAM_BY_ID.roadmap.caption).not.toContain('左')
    expect(g.edge('SE', 'PLL').text).toBe('硬體實作')
    expect(g.node('PLL').text).toContain('comparator 與 GMAC')
    expect(g.vertices).toHaveLength(6)
    expect(g.edge('GD', 'LMS').text).toBe('平均換成一筆資料')
    expect(g.edge('LMS', 'SE').text).toBe(String.raw`$e$ 換成 $\operatorname{sign}(e)$`)
    expect(g.edge('SE', 'SS').text).toBe(String.raw`$x$ 換成 $\operatorname{sign}(x)$`)
    expect(g.edge('LMS', 'NL').text).toContain(String.raw`$\varepsilon + x^2$`)
    expect(g.node('GD').text).toContain(String.raw`$\Delta w = -\mu J'(w)$`)
    expect(g.node('LMS').text).toContain(String.raw`$\Delta w = \mu\,e\,x$`)
    expect(g.node('SE').text).toContain(String.raw`$\Delta w = \mu\operatorname{sign}(e)\,x$`)
    expect(g.node('SS').text).toContain(String.raw`$\Delta w = \mu\operatorname{sign}(e)\operatorname{sign}(x)$`)
    expect(g.node('NL').text).toContain(String.raw`$\Delta w = \tilde\mu\,e\,x / (\varepsilon + x^2)$`)
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
    expect(l.edge('SY', 'SUM').text).toBe('＋ $y[n]$')
    expect(l.edge('PR', 'SUM').text).toBe(String.raw`$-$ $\hat y[n]$`)
    expect(l.edge('SUM', 'MX').text).toBe('$e[n]$')
    expect(l.edge('MX', 'MU').text).toBe(String.raw`$e[n]\,x[n] = -\hat g[n]$`)
    expect(l.edge('MU', 'ACC').text).toBe(String.raw`＋ $\Delta w[n]$`)
    expect(l.edge('D', 'ACC').text).toBe('＋ $w[n]$')
    expect(l.edge('D', 'PR').text).toBe('$w[n]$')
    expect(l.vertices.filter((v) => v.classes.includes('focus')).map((v) => v.id)).toEqual(['MX'])
    // 比較圖只在演算法真的不同的地方不同：Sign-Error = LMS ＋ 一顆 sign(·)，其他方塊與連線一模一樣
    const s = await flow(chartOf('sign-error-loop'))
    const ids = (g: { vertices: Vertex[] }) => g.vertices.map((v) => v.id).sort()
    expect(ids(s)).toEqual([...ids(l), 'SGN'].sort())
    for (const v of l.vertices.filter((x) => x.id !== 'MX')) expect(s.node(v.id).text, v.id).toBe(v.text)
    const key = (e: Edge) => `${e.start}->${e.end}:${e.text}`
    const le = l.edges.map(key)
    const se = s.edges.map(key)
    expect(le.filter((k) => !se.includes(k)).sort()).toEqual([String.raw`MX->MU:$e[n]\,x[n] = -\hat g[n]$`, 'SUM->MX:$e[n]$'])
    expect(se.filter((k) => !le.includes(k)).sort()).toEqual([
      String.raw`MX->MU:$\operatorname{sign}(e[n])\,x[n]$`,
      String.raw`SGN->MX:$q[n] = \operatorname{sign}(e[n])$`,
      'SUM->SGN:$e[n]$',
    ])
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

  it('PLL 校正迴圈（§6）：DTC 在 reference 端（Reference clock → DTC → PD），回授只有 divider → PD；LMS 的輸入取自 PD 的輸出 e[n]；e = y − ŷ（y = a·x + v、ŷ = w_k·x）；G_k = (1/N)Σq·x、w_{k+1} = w_k + μ·G_k；照圖走一個 block 和逐 sample 的 signErrorStep() 加總相同', async () => {
    const g = await flow(chartOf('pll-loop'))
    // ── 架構（docs/assumptions.md §2a）：Reference clock → DTC → PD；VCO 的回授 divider → PD；DTC 不在回授路徑上 ──
    expect(g.node('REF').text).toBe('Reference clock')
    // DTC 只能延遲、不能提前：方塊上寫的是它的延遲 τ_DTC = T_0 − w_k·x（從基準延遲往回扣，code 越大延遲越短）與補償量 ŷ = w_k·x；
    // 不寫沒有 T_0 的「提前」，也不寫「插入延遲」，更不會提到 feedback／divider
    expect(g.node('DTC').text).toContain('reference 端的 DTC')
    expect(g.node('DTC').text).toContain(String.raw`延遲 $\tau_{\mathrm{DTC}} = T_0 - w_k\,x[n]$`)
    expect(g.node('DTC').text).toContain(String.raw`補償量 $\hat y = w_k\,x[n]$`)
    expect(g.node('DTC').text).not.toMatch(/提前|插入|推回|feedback|divider/)
    expect(g.node('FB').text).toContain('divider')
    expect(g.node('FB').text).toContain('feedback edge')
    expect(g.node('FB').text).toContain('早到')
    expect(g.node('S').type).toBe('circle')
    expect(g.node('S').text).toBe('PD')
    expect(g.edge('REF', 'DTC')).toBeTruthy() // REF → DTC
    expect(g.into('DTC').map((e) => e.start).sort()).toEqual(['REF', 'X', 'Z']) // DTC 的輸入：reference edge、code、校正後的 w_k
    expect(g.edge('DTC', 'S')).toBeTruthy() // DTC → PD
    expect(g.edge('FB', 'S')).toBeTruthy() // divider（feedback）→ PD
    expect(g.into('S').map((e) => e.start).sort()).toEqual(['DTC', 'FB', 'V']) // PD 只有 reference（經 DTC）、feedback 與雜訊三路輸入
    expect(g.edges.some((e) => e.start === 'FB' && e.end === 'DTC')).toBe(false) // 沒有 divider → DTC
    expect(g.edges.some((e) => e.start === 'REF' && e.end === 'S')).toBe(false) // reference 不繞過 DTC 直接進 PD
    expect(g.edges.filter((e) => e.start === 'FB').map((e) => e.end)).toEqual(['S']) // 回授路徑上只有 divider，下一站就是 PD
    // ── LMS 校正迴路的輸入是 PD 的輸出：comparator 的唯一來源是 PD，而且 PD 的另一條出線是送進 loop filter 的同一個 e[n] ──
    expect(g.into('CMP').map((e) => e.start)).toEqual(['S'])
    expect(g.edges.filter((e) => e.start === 'S').map((e) => e.end).sort()).toEqual(['CMP', 'LF'])
    expect(g.edge('S', 'LF').text).toBe('$e[n]$')
    expect(g.node('LF').text).toContain('loop filter → VCO')
    // VCO → divider → PD 那一段回授沒有畫成線（畫了會讓 DTC 或 divider 被排到 PD 下面），在主迴路方塊上用文字註明；主迴路方塊沒有出線
    expect(g.node('LF').text).toMatch(/主迴路：VCO 再經[\s\S]*divider 回到 PD/)
    expect(g.edges.filter((e) => e.start === 'LF')).toEqual([])
    // 圖上沒有任何節點把 DTC 寫在回授路徑上，也沒有「插入延遲／推回」的說法
    for (const v of g.vertices) expect(v.text, v.id).not.toMatch(/DTC 在回授|divider 之後|插入|推回/)
    // 加法點（PD）的正負號與極性（沿用 e = y − ŷ：feedback 早到 y 以 ＋ 進來，DTC 補償 ŷ 以 − 進來）
    expect(g.edge('FB', 'S').text).toBe('＋ $y[n]$')
    expect(g.edge('DTC', 'S').text).toBe(String.raw`$-$ $\hat y[n]$`)
    expect(g.edge('V', 'S').text).toBe('＋')
    expect(g.edge('S', 'CMP').text).toBe(String.raw`$e[n] = (a - w_k)\,x[n] + v[n]$`)
    expect(g.node('CMP').text).toContain(String.raw`$q[n] = \operatorname{sign}(e[n])$`)
    // 同一個 code x[n]：feedback 的早到量、DTC 補償、GMAC 的輸入
    expect(g.edges.filter((e) => e.start === 'X').map((e) => e.end).sort()).toEqual(['DTC', 'FB', 'GMAC'])
    expect(g.into('GMAC').map((e) => e.start).sort()).toEqual(['CMP', 'X'])
    expect(g.node('GMAC').text).toContain(String.raw`$G_k = \frac{1}{N}\sum q[n]\,x[n]$`)
    // block 速率：G_k → ×μ → 加法點（另一個輸入是 z⁻¹ 送回來的 w_k）→ w_{k+1} → z⁻¹ → w_k 送回 DTC
    expect(g.edge('GMAC', 'MU').text).toBe('$G_k$')
    expect(g.edge('MU', 'ACC').text).toBe(String.raw`＋ $\mu\,G_k$`)
    expect(g.edge('Z', 'ACC').text).toBe('＋ $w_k$')
    expect(g.edge('ACC', 'Z').text).toBe('$w_{k+1}$')
    expect(g.edge('Z', 'DTC').text).toBe('$w_k$')
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
      const y = a * xs[n] + vs[n] // feedback（divider）edge 的早到量 a·x + 雜訊
      const yhat = wk * xs[n] // DTC 的補償量：reference edge 被提前（少延遲）的時間
      const e = y - yhat // 圖上的 PD
      close(e, (a - wk) * xs[n] + vs[n], 1e-12)
      // 時間軸版本（docs/assumptions.md §2a）：reference 端的 DTC 只能延遲，τ_DTC = T_0 − w_k·x；feedback edge 比理想時刻早 a·x。
      // PD 量 t_ref′ − t_fb，T_0 是常數（靜態相位偏移）：結果和 e = (a − w_k)·x 完全相同，和 T_0 無關
      for (const T0 of [0, 7.5, 1234]) {
        const tRefPrime = 100 * n + T0 - wk * xs[n] // 經過 DTC 之後的 reference edge
        const tFb = 100 * n + T0 - a * xs[n] // 比理想時刻（100n + T_0）早到 a·x 的 feedback edge
        close(tRefPrime - tFb, (a - wk) * xs[n], 1e-9)
      }
      G += (Math.sign(e) * xs[n]) / N
      dwSum += signErrorStep({ w: wk, x: xs[n], y, mu: mu / N, tie: 'plus' }).dw // 每個 sample 的更新量（步長 μ/N）
    }
    close(wk + mu * G, wk + dwSum, 1e-12) // w_{k+1} = w_k + μ·G_k
    expect(G).toBeGreaterThan(0) // a > w_k ⇒ G_k > 0 ⇒ w 往 a 走（極性正確）
    expect(wk + mu * G).toBeGreaterThan(wk)
    expect(wk + mu * G).toBeLessThan(a + 0.5)

    // 看圖說明的「把兩條 edge 寫成相對同一個理想時刻 t_id」：t_fb = t_id − y、t_ref′ = t_id − ŷ ⇒ t_ref′ − t_fb = y − ŷ。
    // 所以進 PD 的兩條線標的是「早到的時間對 e 的貢獻」（y：＋、ŷ：−），PD 本身仍然是 reference 減 feedback；
    // 補償不足（w_k < a）而且 x > 0 時 reference 比 feedback 晚（e > 0），x < 0 時反過來
    for (const x of [-2, -1, 1, 2]) {
      const tId = 5000
      const [yEarly, yhatEarly] = [a * x, wk * x]
      const tFb = tId - yEarly
      const tRefPrime = tId - yhatEarly
      close(tRefPrime - tFb, yEarly - yhatEarly, 1e-9)
      expect(Math.sign(tRefPrime - tFb)).toBe(Math.sign(x)) // a > w_k
    }

    // 看圖說明最後一句：校正迴路的極性接反 ⇒ pole 由 1 − μK 變成 1 + μK（w 離開 a）。兩種接反的方式（無雜訊、整個 block 的平均）：
    const blockG = (err: (x: number) => number, q: (e: number) => number) => [-2, -1, 1, 2].reduce((acc, x) => acc + (q(err(x)) * x) / 4, 0)
    for (const w of [2.5, 3.5]) {
      const right = blockG((x) => (a - w) * x, Math.sign) // 正確的接法：τ_DTC = T_0 − w·x、q = sign(e)
      expect(Math.sign(right)).toBe(Math.sign(a - w)) // w 往 a 走
      // (i) comparator 的輸出接反：q = −sign(e) ⇒ G_k 變號，w 離開 a
      const flippedQ = blockG((x) => (a - w) * x, (e) => -Math.sign(e))
      close(flippedQ, -right, 1e-12)
      expect(Math.sign(flippedQ)).toBe(-Math.sign(a - w))
      // (ii) 送進 DTC 的 code 方向反了：τ_DTC = T_0 + w·x ⇒ t_ref′ − t_fb = (a + w)·x，w 越大誤差越大；
      // 不論 w 在 a 的哪一邊，G_k 都 > 0（w 一直往上跑，離開 a）
      const tId = 5000
      for (const x of [-2, -1, 1, 2]) close(tId + w * x - (tId - a * x), (a + w) * x, 1e-9)
      const flippedCode = blockG((x) => (a + w) * x, Math.sign)
      expect(flippedCode).toBeGreaterThan(0)
      expect(Math.abs(a + (w + 1))).toBeGreaterThan(Math.abs(a + w))
    }
  })

  it('Sign-Error 迴圈（F-02.6）：和 LMS 只差 sign(·)；照圖走一步和 signErrorStep() 相同', async () => {
    const g = await flow(chartOf('sign-error-loop'))
    expect(g.edge('SY', 'SUM').text).toBe('＋ $y[n]$')
    expect(g.edge('PR', 'SUM').text).toBe(String.raw`$-$ $\hat y[n]$`)
    expect(g.edge('SGN', 'MX').text).toBe(String.raw`$q[n] = \operatorname{sign}(e[n])$`)
    expect(g.edge('MX', 'MU').text).toBe(String.raw`$\operatorname{sign}(e[n])\,x[n]$`)
    expect(g.edge('MU', 'ACC').text).toBe(String.raw`＋ $\Delta w[n]$`)
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
    // state 圖的文字不經 mermaidMathDelimiters：直接寫 Mermaid 原生的單一 $$...$$（用 \text{} 包文字）
    // 「等速接近」每步靠近 h = μ|x| 寫在狀態的說明裡（Mermaid 把自己指向自己的轉移畫成一條又長又尖的怪迴圈，所以不畫成 FAR → FAR）
    expect(m.relations.some((r) => r.from === 'FAR' && r.to === 'FAR')).toBe(false)
    expect(m.states.find((s) => s.id === 'FAR')!.descriptions.join('\n')).toContain(String.raw`\text{每步靠近 }h = \mu\,|x|`)
    expect(m.states.find((s) => s.id === 'FAR')!.descriptions.join('\n')).toContain(String.raw`\text{離 }a\text{ 還有一步以上}`)
    expect(m.label('FAR', 'P1')).toBe(String.raw`$$\text{走完 }n_c\text{ 步}$$`)
    expect(m.states.find((s) => s.id === 'P1')!.descriptions).toContain(String.raw`$$w = a - \operatorname{sgn}(\delta_0)\,\rho$$`)
    expect(m.states.find((s) => s.id === 'P2')!.descriptions).toContain(String.raw`$$w = a + \operatorname{sgn}(\delta_0)\,(h - \rho)$$`)
    // 週期 2：P1 ⇄ P2 互相轉移，而且只有這兩個狀態上色（紅）
    expect(m.label('P1', 'P2')).toContain('越過 ')
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
    expect(g.node('F').text).toContain('凍結在 $a$')
    expect(g.node('P').text).toContain(String.raw`$a + \mu\,x$`)
    expect(g.node('M').text).toContain(String.raw`$a - \mu\,x$`)
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
    expect(g.edge('X1', 'S1').text).toBe(String.raw`＋ $d\,x$`)
    expect(g.edge('V1', 'S1').text).toBe('＋')
    // 兩個「× x」用的是同一筆 x：同一個來源接到兩個乘法器；而且這個來源在 subgraph 內（subgraph 之間不連線，內部的 direction 才有效）
    expect(g.vertices.filter((v) => v.id === 'XS')).toHaveLength(1)
    expect(g.edges.filter((e) => e.start === 'XS').map((e) => e.end).sort()).toEqual(['X1', 'X2'])
    expect(g.into('X2').map((e) => e.start).sort()).toEqual(['SG', 'XS'])
    expect(g.node('D1').text).toBe('$d = a - w$')
    expect(g.node('KQ').text).toContain(String.raw`$\times K_q$`)
    expect(g.node('KQ').text).toContain(String.raw`$= 2\,f_v(0)$`)
    expect(g.node('PX').text).toBe(String.raw`$\times E[x^2]$`)
    expect(g.node('P2').text).toBe(String.raw`$\psi_{\mathrm{SE}}(w) \approx K_{\mathrm{SE}}\,d$`)
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
    expect(g.node('SCH').text).toContain(String.raw`$\mu[n] = \mu_0 / (1 + n/n_0)$`)
    expect(g.node('B1').text).toContain(String.raw`$\mu[n]\,|x|$`)
    expect(g.node('B1').text).toContain('無限大')
    expect(g.node('B2').text).toContain(String.raw`$\mu[n]^2\,\sigma_\eta^2$`)
    expect(g.node('B2').text).toContain('有限')
    const [mu0, n0] = [0.4, 20]
    for (const n of [0, 7, 20, 400]) close(stepSize(mu0, n, { kind: 'harmonic', n0 }), mu0 / (1 + n / n0), 1e-12)
    expect(stepSize(mu0, n0, { kind: 'harmonic', n0 })).toBe(mu0 / 2) // 內文：「走到第 n₀ 步時步長剛好減半」
    // gear：粗調（前 n₀ 步是 μ₀）→ 每 n₀ 步右移一位 → 下限 μ₀/64（右移 6 位）
    const gear = await stateMachine(chartOf('gear-shift'))
    expect(gear.states.map((s) => s.id)).toEqual(['COARSE', 'SHIFT', 'TRACK'])
    expect(gear.label('COARSE', 'SHIFT')).toBe(String.raw`$$\text{過了 }n_0\text{ 步}$$`)
    // 「每 n₀ 步再右移一位」寫在「換檔」的說明裡，不畫成 SHIFT → SHIFT 的自我轉移
    expect(gear.relations.some((r) => r.from === 'SHIFT' && r.to === 'SHIFT')).toBe(false)
    expect(gear.states.find((s) => s.id === 'SHIFT')!.descriptions.join('\n')).toContain(String.raw`\text{每 }n_0\text{ 步再右移一位}`)
    expect(gear.states.find((s) => s.id === 'SHIFT')!.descriptions.join('\n')).toContain('步長右移一位（減半）')
    expect(gear.label('SHIFT', 'TRACK')).toBe(String.raw`$$\text{降到下限 }\mu_{\min}$$`)
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
    expect(g.edge('SY', 'SUM').text).toBe('＋ $y[n]$')
    expect(g.edge('PR', 'SUM').text).toBe(String.raw`$-$ $\hat y[n]$`)
    expect(g.edge('SGE', 'XOR').text).toBe(String.raw`$\operatorname{sign}(e[n])$`)
    expect(g.edge('SGX', 'XOR').text).toBe(String.raw`$\operatorname{sign}(x[n])$`)
    expect(g.node('CNT').text).toContain(String.raw`$w[n+1] = w[n] \pm \mu$`)
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
    expect(r.node('R').text).toContain('$r[i] = y[i] / x[i]$')
    expect(r.node('R').text).toContain('$= a + v[i] / x[i]$')
    expect(r.node('A1').text).toMatch(/LMS.*\$x\^2\$ 加權的平均/)
    expect(r.node('A2').text).toMatch(/Sign-Error.*\$\|x\|\$ 加權的中位數/)
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
    expect(f.node('Z1').text).toContain(String.raw`$E[e\,x] = 0$`)
    expect(f.node('Z2').text).toContain(String.raw`$E[\operatorname{sign}(e)\,x] = 0$`)
    expect(f.node('Z3').text).toContain(String.raw`$E[\operatorname{sign}(e)\operatorname{sign}(x)] = 0$`)
    // 三個相關器的圖上有三顆 × 圓形節點（KaTeX 的 \times）
    expect(f.vertices.filter((v) => v.type === 'circle' && v.text === String.raw`$\times$`).map((v) => v.id).sort()).toEqual(['M1', 'M2', 'M3'])

    const p = await flow(chartOf('psi-at-a'))
    expect(p.node('Q1').text).toContain(String.raw`$E[x] = 0$ 而且 $E[\operatorname{sign} x] = 0$`)
    expect(p.node('Q2').text).toContain(String.raw`$E[v] = 0$ 而且 $E[\operatorname{sign} v] = 0$`)
    expect(p.edge('Q1', 'OK1').text).toBe('是')
    expect(p.edge('Q2', 'OK2').text).toBe('是')
    expect(p.edge('Q2', 'CHK').text).toBe('否')
    for (const t of [
      String.raw`LMS：$E[v]\,E[x]$`,
      String.raw`Sign-Error：$E[\operatorname{sign} v]\,E[x]$`,
      String.raw`Sign-Sign：$E[\operatorname{sign} v]\,E[\operatorname{sign} x]$`,
    ])
      expect(p.node('CHK').text).toContain(t)
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
    expect(m.edge('A', 'C').text).toBe('丟掉 $e$ 的大小')
    expect(m.edge('C', 'D').text).toBe('再丟掉 $x$ 的大小')
    // 每個方塊的長句用 <br/> 斷在「、」之後（單行超過約 200px 會被 Mermaid 從字中間折行）
    expect(m.node('A').text).toMatch(/LMS.*error 多位元、<br\/?>regressor 多位元/)
    expect(m.node('A').text).toContain('NLMS、Huber 也在這一格')
    expect(m.node('C').text).toMatch(/Sign-Error.*error 1 bit、<br\/?>regressor 多位元/)
    expect(m.node('D').text).toMatch(/Sign-Sign.*error 1 bit、<br\/?>regressor 1 bit/)
    expect(m.node('B').text).toContain('本章不討論')
    expect(m.node('B').text).toMatch(/Signed-regressor LMS.*error 多位元、<br\/?>regressor 1 bit/)
    // 斷行只是換行：每一格最後一行的「硬體成本」與虛線那一條路都還在
    expect(m.node('A').text).toContain('TDC 或 ADC，加上乘法器')
    expect(m.node('C').text).toContain('comparator，加上條件取負')
    expect(m.node('D').text).toMatch(/XOR，加上<br\/?>up \/ down counter/)
    expect(m.edge('A', 'B').text).toBe('丟掉 $x$ 的大小')
    expect(m.edge('B', 'D').text).toBe('再丟掉 $e$ 的大小')
    expect(m.vertices).toHaveLength(4)
    expect(m.edges).toHaveLength(4)
    expect(m.node('A').classes).toEqual(['warn']) // 最貴：多位元乘法器
    expect(m.node('C').classes).toEqual(['focus']) // 本章走的路
    expect(m.node('D').classes).toEqual(['ok']) // 最省

    const d = await flow(chartOf('datapath'))
    expect(d.node('M1').classes).toEqual(['warn']) // 乘法器
    expect(d.node('N2').classes).toEqual(['focus']) // 條件取負
    expect(d.node('X3').classes).toEqual(['ok']) // XOR
    expect(d.node('N2').text).toBe(String.raw`MUX：$q\,?\,x : -x$`)
  })

  it('穩態抖動迴圈（F-02.13）與 NLMS 資料路徑（F-02.15）', async () => {
    const g = await flow(chartOf('noise-loop'))
    expect(g.edge('MU', 'S').text).toBe(String.raw`＋ $\mu\,\eta[n]$`)
    expect(g.edge('P', 'S').text).toBe(String.raw`＋ $(1 - \mu K)\,\delta[n]$`)
    expect(g.node('P').text).toContain(String.raw`$\times (1 - \mu K)$`)
    expect(g.edge('S', 'Z').text).toBe(String.raw`$\delta[n+1]$`)
    // 照圖疊代變異：V ← (1 − μK)²·V + μ²·σ_η²，收斂到 F-02.13 的 μσ_η²/(K(2 − μK))
    const [mu, K, s2] = [0.02, 1.6, 1]
    let V = 0
    for (let n = 0; n < 5000; n++) V = (1 - mu * K) ** 2 * V + mu * mu * s2
    close(V, (mu * s2) / (K * (2 - mu * K)), 1e-9)

    const n = await flow(chartOf('nlms-datapath'))
    expect(n.node('DV').text).toContain(String.raw`$\div (\varepsilon + x[n]^2)$`)
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
      ['KQ', String.raw`$K_q = \sqrt{2/\pi}\,/\,\sigma_v$`],
      ['PX', String.raw`$E[x^2] = A^2$、$E[x^4] = A^4$`],
      ['KSE', String.raw`$K_{\mathrm{SE}} = K_q\,E[x^2]$`],
      ['G', String.raw`$g = \mu\,K_{\mathrm{SE}}$`],
      ['P', String.raw`$p = 1 - g$`],
      ['TAU', String.raw`$\tau = -1 / \ln|p|$`],
      ['SN', String.raw`$\sigma_\eta^2 = E[x^2]$`],
      ['VAR', String.raw`$\operatorname{Var}_{\mathrm{SE}} \approx \mu\,\sigma_\eta^2 / (K_{\mathrm{SE}}\,(2 - g))$`],
      ['SW', String.raw`$\sigma_w = \sqrt{\operatorname{Var}_{\mathrm{SE}}}$`],
      ['MUL', String.raw`$\mu_L = g / E[x^2]$`],
      ['VL', String.raw`$\mu_L\,\sigma_v^2\,E[x^2] / (2\,E[x^2] - \mu_L\,E[x^4])$`],
      ['R', String.raw`$\operatorname{Var}_{\mathrm{SE}} / \operatorname{Var}_{\mathrm{LMS}} = \pi/2$`],
    ]) {
      expect(g.node(id).text, id).toContain(text)
    }
    // 畫出來的 KaTeX 文字（MathML 複本已去掉）也是這幾個式子：pole p = 1 − g、τ = −1/ln|p|、Var_SE/Var_LMS = π/2
    const { text: drawn } = await renderMermaidForTest(chartOf('design-flow'))
    for (const t of ['p=1−g', 'τ=−1/ln∣p∣', '=π/2']) expect(drawn, t).toContain(t)
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
    return renderPage(<Chapter02 />, { mode: 'engineer', url: '/ch/02', future: true })
  }
  const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)

  it(
    `章首有 SystemMap；全章 ${N_DIAGRAMS} 張圖依登錄順序各出現一次，每張都有圖說與「先看…再看…」的說明，並放在對應公式之前`,
    () => {
      const { container } = renderChapter()

      // ── SystemMap：手排的 SVG（不經過 Mermaid，所以不是 [data-chart] 替身），緊跟在開場問題後面、在 §1 之前，
      //    後面有一句說明藍色方塊與本章新增的內容 ──
      const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
      expect(figures).toHaveLength(N_DIAGRAMS + 1)
      const map = container.querySelector('figure.c-mermaid.c-sysmap')!
      expect(map).toBeTruthy()
      expect(map.getAttribute('aria-label')).toMatch(/^DTC-based Fractional-N PLL/)
      expect(figures[0]).toBe(map)
      expect(map.hasAttribute('data-chart')).toBe(false)
      expect(container.querySelectorAll('figure.c-sysmap')).toHaveLength(1)
      // 圖說與替代文字都列出本章的五個主角（數學的 $ 去掉後的文字）
      const caption = map.querySelector('figcaption')!.textContent!
      for (const b of SYSTEM_FOCUS) expect(map.getAttribute('aria-label')).toContain(accessibleText(SYSTEM_BLOCK_LABEL[b]))
      expect(caption).toContain('藍色是本章的主角')
      // 圖上被標成藍色的方塊（g.c-sysmap-block.is-focus）剛好就是 systemMapModel(SYSTEM_FOCUS) 的主角，其餘方塊都沒有標
      const focusedInDom = Array.from(map.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
      const focusedInModel = systemMapModel(SYSTEM_FOCUS).blocks.filter((b) => b.focused).map((b) => b.id)
      expect(focusedInDom.sort()).toEqual([...focusedInModel].sort())
      expect(focusedInDom.sort()).toEqual([...SYSTEM_FOCUS].sort())
      expect(map.querySelectorAll('g.c-sysmap-block')).toHaveLength(systemMapModel(SYSTEM_FOCUS).blocks.length)
      expect(map.querySelectorAll('g.c-sysmap-block[data-focus="true"]')).toHaveLength(SYSTEM_FOCUS.length)
      const question = container.querySelector('.ch02-question')!
      expect(question.nextElementSibling).toBe(map)
      const note = container.querySelector('[data-system-map-note]')!
      expect(map.nextElementSibling).toBe(note)
      expect(note.textContent).toMatch(/藍色的方塊.*這一章加上的是.*更新式/)
      // comparator 的輸入取自 PD 的輸出，不是 DTC 或 divider。地圖用成對的同名標籤畫這條線：分接點在 PD → loop filter 那條線上，
      // 一個標籤在分接點旁（「PD 輸出 e[n] …」），另一個在 comparator 的輸入旁（「e[n]（PD 輸出）」）——正文照這個畫法描述
      expect(note.textContent).toMatch(/comparator 的輸入是從 PD 的輸出分接出來的.*送進 loop filter 的同一個誤差.*不是從 DTC 或 divider/)
      expect(note.textContent).toMatch(/PD 與 loop filter 之間那條線上有一個分接點.*同名的標籤.*就是同一條線/)
      const tapWire = systemMapModel(SYSTEM_FOCUS).wires.find((w) => w.from === 'pd' && w.to === 'cmp')!
      expect(tapWire.tag?.tapOn).toEqual(['pd', 'lf'])
      expect(tapWire.tag?.source.text).toContain(String.raw`PD 輸出 $e[n]$`)
      expect(tapWire.tag?.dest.text).toBe(String.raw`$e[n]$（PD 輸出）`)
      // 地圖本身就是約定的接法：Reference clock → DTC → PD，divider → PD，沒有 divider → DTC
      const wires = systemMapModel(SYSTEM_FOCUS).wires.map((w) => `${w.from}>${w.to}`)
      for (const w of ['ref>dtc', 'dtc>pd', 'pd>lf', 'vco>div', 'div>pd']) expect(wires).toContain(w)
      expect(wires).not.toContain('div>dtc')
      expect(wires).not.toContain('ref>pd')
      expect(follows(map, container.querySelector('#ch02-s1')!)).toBe(true)

      // ── 每一張圖：順序、圖說、說明、對應公式 ──
      const slots = Array.from(container.querySelectorAll('[data-diagram]'))
      expect(slots.map((s) => s.getAttribute('data-diagram'))).toEqual(list.map((d) => d.id))
      for (const d of list) {
        const slot = container.querySelector(`[data-diagram="${d.id}"]`)!
        expect(slot.querySelectorAll('figure.c-mermaid'), d.id).toHaveLength(1)
        expect(slot.querySelector('figcaption')?.textContent, d.id).toBe(d.caption)
        const walk = slot.querySelector('.c-chapter-fig-walk')!
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

      // ── §6 的 PLL 校正迴圈：文字照全站的 DTC 在 reference 端的約定（docs/assumptions.md §2a） ──
      const pllWalk = container.querySelector('[data-diagram="pll-loop"] .c-chapter-fig-walk')!
      const pllText = pllWalk.textContent!
      const pllTex = Array.from(pllWalk.querySelectorAll('annotation')).map((x) => x.textContent ?? '')
      const pllCaption = DIAGRAM_BY_ID['pll-loop'].caption
      expect(pllCaption).toContain('DTC 在 reference 端')
      expect(pllCaption).toContain('回授路徑只有 divider')
      expect(pllCaption).toContain('comparator 取的是 PD 的輸出')
      expect(pllText).toContain('Reference clock') // 圖的起點
      expect(pllText).toContain('reference 端的 DTC')
      expect(pllText).toContain('feedback edge 比理想時刻早到') // divider 的 feedback edge 早到 y = a·x
      expect(pllText).toContain('reference edge 提前') // DTC 把 reference edge 提前（補償量），不是延遲 feedback
      expect(pllText).toContain('補償量')
      expect(pllText).toContain('reference 還是太晚') // 補償不足（w < a）→ e 為正
      expect(pllText).toContain('PD 的輸出') // LMS 的輸入是 PD 的輸出
      expect(pllText).toContain('loop filter')
      expect(pllText).toContain('不是從 DTC 或 divider 拉出來的')
      expect(pllText).toContain('reference 減 feedback') // 極性約定：PD 量 reference 減 feedback
      expect(pllTex).toContain(String.raw`\tau_{\rm DTC}[n]=T_0-w_k\,x[n]`) // 從基準延遲 T_0 往回扣
      expect(pllTex).toContain(String.raw`e[n]=t'_{\rm ref}[n]-t_{\rm fb}[n]`) // PD 量（延遲後的）reference edge 減 feedback edge
      expect(pllTex).toContain(String.raw`e[n]=(a-w_k)\,x[n]+v[n]`) // 數學不變
      expect(pllText).toContain('回授路徑上只有 divider') // feedback edge 直接進 PD，不經過 DTC
      expect(pllText).toContain('不經過 DTC')
      expect(pllText).toContain('DTC 只能延遲、不能提前') // 「提前」一定跟著 T_0 的說明
      expect(pllText).toContain('code 越大，延遲越短')
      // 為什麼 reference 那條線標 −、feedback 那條線標 ＋：兩條 edge 都寫成相對同一個理想時刻，再相減
      expect(pllTex).toContain(String.raw`t_{\rm fb}=t_{\rm id}-y`)
      expect(pllTex).toContain(String.raw`t'_{\rm ref}=t_{\rm id}-\hat y`)
      expect(pllTex).toContain(String.raw`t'_{\rm ref}-t_{\rm fb}=y-\hat y`)
      expect(pllText).toContain('不是 PD 兩個輸入端的極性')
      expect(pllTex).toContain('x[n]>0') // 補償不足時 e 為正的前提：本章的 code 可以是 ±A
      expect(pllText).toContain('VCO 再經 divider 回到 PD') // 圖上沒畫的那一段回授
      // 極性接反的例子：comparator 輸出接反、DTC 的 code 方向反了（不是「PD 的兩個輸入接反」——那樣主迴路自己就鎖不住）
      expect(pllTex).toContain(String.raw`q=-\operatorname{sign}(e)`)
      expect(pllTex).toContain(String.raw`T_0+w_k\,x[n]`)
      expect(pllTex).toContain(String.raw`1+\mu K`)
      // 舊的說法不見了：DTC 在回授路徑、DTC 延遲 feedback、DTC 插入延遲
      expect(pllText).not.toMatch(/DTC 實際補償|插入延遲|推回|DTC 在回授|divider 之後|兩個輸入接反/)
      // 章末符號表：ŷ 是 reference 端 DTC 的補償量（從 T_0 往回扣），a·x 是 feedback edge 早到的時間，e 是 PD 的輸出
      const symRows = Array.from(container.querySelectorAll('.ch02-symbols .c-symbols tbody tr'))
      expect(symRows).toHaveLength(SYMBOLS.length)
      const symText = (sym: string) => symRows.find((tr) => tr.querySelector('annotation')?.textContent === sym)!.textContent!
      expect(symText(String.raw`\hat y_n=w_nx_n`)).toMatch(/reference 端 DTC 的補償量.*往回扣.*reference edge 少延遲的時間/)
      expect(symText(String.raw`x_n,\;y_n`)).toMatch(/divider 的 feedback edge 比理想時刻早到的時間/)
      expect(symText('e_n=y_n-w_nx_n')).toContain('PD 的輸出')
      for (const tr of symRows) expect(tr.textContent, tr.querySelector('annotation')?.textContent ?? '').not.toMatch(/插入延遲|推回|DTC 在回授|divider 之後/)
      // 本章符號對照表：e[n] 是 PD 的輸出，comparator 取的就是送進 loop filter 的同一個 e[n]
      const sixTable = container.querySelector('#ch02-s6')!.querySelector('.ch02-table')!
      expect(sixTable.textContent).toContain('PD 的輸出')
      expect(sixTable.textContent).toContain('送進 loop filter 的同一個')

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
      expect(Array.from(container.querySelectorAll('.c-chapter-fig .katex-error, .c-chapter-fig .c-tex-error'))).toEqual([])
    },
    T_PAGE,
  )
})
