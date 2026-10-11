import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, waitFor } from '@testing-library/react'
import mermaid from 'mermaid'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { renderTex, stripMathDelimiters, systemMapChart, SYSTEM_BLOCK_LABEL } from '@/components'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import {
  KQ_FACTOR,
  SERVO_SHAPE_FRACTION,
  autoMu,
  buildCodeDistribution,
  codeMoments,
  comparatorMean,
  eDet,
  expectation,
  finiteStepBias,
  fixedPoint,
  linearizedFixedPoint,
  meanGmacMse,
  meanGmacSign,
  mseFixedPoint,
  mseWeightedMean,
  nearIntegerSensitivity,
  nearIntegerSweep,
  perCodeGain,
  signSecondOrder,
  signWeightedMedian,
  sigmaAt,
  type ErrorModel,
} from '@/simulation/models/bias'
import * as D from './diagrams'
import { CH11_DIAGRAMS, SYSTEM_MAP_FOCUS, type Ch11Diagram } from './diagrams'
import { Fig, figLabel } from './Fig'
import { LINEAR_OK_RATIO } from './handcalcs'
import { IntroSection } from './sections/IntroSection'

/**
 * Ch11 的方塊圖測試（docs/teaching-style.md §8）。index.test.tsx 為了速度把 mermaid mock 掉了，
 * 這裡用「真正的」mermaid：
 *  1. parser：每一張圖都能解析；
 *  2. renderer：用共用的 renderMermaidForTest 在 jsdom 裡真的畫一次，確認圖上沒有
 *     「Unsupported markdown」——Mermaid 11 把所有標籤當 Markdown，單獨的 "+"、"E[G](w*)" 之類都會壞掉，
 *     這種錯誤 parser 抓不到；節點數不超過 14；原始碼本身就用全形「＋」（sanitizeMermaidSource 不需要改動它）；
 *  3. 內容：圖上的數字、正負號、延遲與取樣率和 bias.ts 的模型／正文公式一致。
 */

vi.setConfig({ testTimeout: 120000 })

interface Vertex {
  id: string
  text?: string
  classes?: string[]
}
interface Edge {
  start: string
  end: string
  text?: string
}
interface FlowDb {
  getVertices: () => Map<string, Vertex>
  getEdges: () => Edge[]
  getSubGraphs: () => { id: string; title: string; nodes: string[] }[]
}

/** 把 mermaid 內部（已 sanitize）的標籤還原成純文字：<br> → 換行、&lt; → < */
function plain(html: string | undefined): string {
  const div = document.createElement('div')
  div.innerHTML = (html ?? '').replace(/<br\s*\/?>/g, '\n')
  return div.textContent ?? ''
}

async function parseFlow(chart: string) {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDb
  const subgraphs = db.getSubGraphs().map((s) => ({ id: s.id, title: plain(s.title), nodes: s.nodes }))
  // 連線接在 subgraph 上時（FAST --> SLOW），mermaid 會替 subgraph 的 id 也登記一個 vertex：那不是圖上的方塊
  const isCluster = new Set(subgraphs.map((s) => s.id))
  const nodes = new Map(
    [...db.getVertices().values()].filter((v) => !isCluster.has(v.id)).map((v) => [v.id, { text: plain(v.text), classes: v.classes ?? [] }]),
  )
  const edges = db.getEdges().map((e) => ({ from: e.start, to: e.end, text: plain(e.text) }))
  const node = (id: string) => {
    const n = nodes.get(id)
    if (!n) throw new Error(`圖上沒有節點 ${id}`)
    return n
  }
  const edge = (from: string, to: string) => {
    const e = edges.find((x) => x.from === from && x.to === to)
    if (!e) throw new Error(`圖上沒有 ${from} → ${to} 的連線`)
    return e
  }
  return { nodes, edges, subgraphs, node, edge, into: (id: string) => edges.filter((e) => e.to === id) }
}

/** 節點在畫出來的 SVG 裡的絕對位置（把一路往上的 translate 加起來） */
function absPos(el: Element): { x: number; y: number } {
  let x = 0
  let y = 0
  for (let cur: Element | null = el; cur && cur.tagName.toLowerCase() !== 'svg'; cur = cur.parentElement) {
    const t = /translate\(\s*([-\d.eE]+)[ ,]+([-\d.eE]+)\s*\)/.exec(cur.getAttribute('transform') ?? '')
    if (t) {
      x += Number(t[1])
      y += Number(t[2])
    }
  }
  return { x, y }
}

let layoutSeq = 0
/**
 * 真的排一次版，回傳每個節點的位置。jsdom 量不到文字大小（每個方塊都當成 80×20），所以座標不是實際像素，
 * 但「誰在誰的左邊／上面」（dagre 的 rank 方向）是可信的 —— 用來核對正文與圖說裡「先看左邊…再看右邊」的說法。
 */
async function layout(chart: string) {
  const { svg } = await mermaid.render(`ch11-layout-${++layoutSeq}`, chart)
  const host = document.createElement('div')
  host.innerHTML = svg
  const pos = new Map<string, { x: number; y: number }>()
  for (const n of Array.from(host.querySelectorAll('g.node'))) pos.set((n.getAttribute('id') ?? '').replace(/^flowchart-/, '').replace(/-\d+$/, ''), absPos(n))
  const at = (id: string) => {
    const q = pos.get(id)
    if (!q) throw new Error(`畫出來的圖上沒有節點 ${id}`)
    return q
  }
  const mean = (ids: string[], k: 'x' | 'y') => ids.reduce((acc, id) => acc + at(id)[k], 0) / ids.length
  /** 由左到右（k = 'x'）或由上到下（k = 'y'）嚴格遞增；每一項可以是一組節點（取平均位置） */
  const increasing = (k: 'x' | 'y', ...groups: (string | string[])[]) => {
    const v = groups.map((g) => mean(Array.isArray(g) ? g : [g], k))
    for (let i = 1; i < v.length; i++) {
      expect(v[i], `${JSON.stringify(groups[i - 1])} 應在 ${JSON.stringify(groups[i])} 的${k === 'x' ? '左邊' : '上面'}`).toBeGreaterThan(v[i - 1])
    }
  }
  return { at, increasing }
}

/** 圖上數字的寫法：負號用 U+2212；signed 時正數帶 '+'；0 不帶號 */
function fmt(v: number, digits = 2, signed = false): string {
  const r = Number(v.toFixed(digits))
  if (r === 0) return '0'
  const s = String(Math.abs(r))
  return r < 0 ? `−${s}` : signed ? `+${s}` : s
}

const CHARTS: Ch11Diagram[] = [...CH11_DIAGRAMS]
const five = buildCodeDistribution({ kind: 'five_level' })
const u4 = buildCodeDistribution({ kind: 'unipolar4' })
const model = (o: Partial<ErrorModel>): ErrorModel => ({ a: 1, b: 0, c2: 0, c3: 0, kappa: 0, sigmaV: 1, ...o })
const CUBIC = model({ c3: 0.1, sigmaV: 0 })

beforeAll(() => {
  // jsdom 沒有 SVG 的版面量測；共用的 shim 給「字數 × 固定寬度」的尺寸，讓 mermaid 的 dagre 版面與 renderer 真的跑完
  installMermaidSvgShim()
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
})

describe('Ch11 方塊圖：登錄表', () => {
  it('共 25 張圖（章首另有共用的系統地圖），登錄表涵蓋 diagrams.ts 匯出的每一個 CHART_*', () => {
    expect(CHARTS).toHaveLength(25)
    const exported = Object.entries(D).filter(([k]) => k.startsWith('CHART_'))
    expect(exported).toHaveLength(25)
    for (const [name, chart] of exported) {
      const entry = CHARTS.find((d) => d.name === name)
      expect(entry, name).toBeTruthy()
      expect(entry?.chart, name).toBe(chart)
    }
    expect(new Set(CHARTS.map((d) => d.id)).size).toBe(25)
    expect(new Set(CHARTS.map((d) => d.chart)).size).toBe(25)
    expect(figLabel('gmac-zero')).toBe('圖 11-1')
    expect(figLabel('handcalc-flow')).toBe('圖 11-25')
  })

  it('圖名與圖說：每張都有、說明要看什麼，其中的數學都在 $…$ 內且能被 KaTeX 解析', () => {
    const bad: string[] = []
    for (const d of CHARTS) {
      for (const [what, text] of [['title', d.title], ['caption', d.caption]] as const) {
        const parts = text.split('$')
        if (parts.length % 2 === 0) bad.push(`${d.id} ${what}：$ 不成對`)
        parts.forEach((p, i) => {
          if (i % 2 === 1 && /katex-error|c-tex-error/.test(renderTex(p, false))) bad.push(`${d.id} ${what}：KaTeX 無法解析 ${p}`)
          // 公式外不用 Unicode 拼數學（teaching-style §3）；「→」「≠」等一般符號與方塊圖上的 ①–⑦ 不算
          if (i % 2 === 0 && /[σμκεφρλθωΩΣΔπ√²³⁴⁻¹₀₁₂₃ₖ≤≥≈∂∈∞]/.test(p)) bad.push(`${d.id} ${what}：公式外有 Unicode 數學字元 —— ${p}`)
        })
      }
      expect(d.title.length, d.id).toBeGreaterThan(5)
      expect(d.caption.length, d.id).toBeGreaterThan(25)
      expect(stripMathDelimiters(d.title), d.id).not.toMatch(/\$/)
    }
    expect(bad).toEqual([])
  })

  it('每張圖在頁面原始碼中恰好用一次（<Fig id="…" />），而且放在登錄表記載的那個 Section 檔案裡', () => {
    const dir = join(process.cwd(), 'src/chapters/ch11/sections')
    const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
    const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]))
    const sectionFile: Record<string, string> = {
      'ch11-hand': 'IntroSection.tsx',
      'ch11-diagram': 'IntroSection.tsx',
      'ch11-model': 'ModelSection.tsx',
      'ch11-fixed-point': 'FixedPointSection.tsx',
      'ch11-offset': 'OffsetSection.tsx',
      'ch11-inl': 'InlSection.tsx',
      'ch11-correlated': 'CorrelatedSection.tsx',
      'ch11-near-integer': 'NearIntegerSection.tsx',
      'ch11-lab': 'LabSection.tsx',
      'ch11-levels': 'WrapSection.tsx',
      'ch11-synthesis': 'WrapSection.tsx',
    }
    const all = Object.values(src).join('\n')
    for (const d of CHARTS) {
      const uses = all.split(`<Fig id="${d.id}" />`).length - 1
      expect(uses, d.id).toBe(1)
      expect(src[sectionFile[d.section]], `${d.id} 應在 ${sectionFile[d.section]}`).toContain(`<Fig id="${d.id}" />`)
      // 正文有引用圖號，帶讀者看圖（「先看…再看…」）
      expect(all, `${d.id} 的正文導讀`).toContain(`<FigRef id="${d.id}" />`)
    }
    // 不再有沒登錄的 Mermaid 圖；章首的系統地圖在開場段落
    expect(all).not.toMatch(/<Mermaid\b/)
    expect(src['IntroSection.tsx'].split('<SystemMap ').length - 1).toBe(1)
    expect(all.split('<SystemMap ').length - 1).toBe(1)
  })
})

describe('Ch11 方塊圖：真正的 mermaid parser 與 renderer', () => {
  it.each(CHARTS.map((d, i) => [`圖 11-${i + 1}`, d.name, d] as const))('%s %s：可解析、不超過 14 個節點、每個節點與連線都有定義', async (_label, _name, d) => {
    const r = await mermaid.parse(d.chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
    const g = await parseFlow(d.chart)
    expect(g.nodes.size).toBeGreaterThanOrEqual(5)
    expect(g.nodes.size).toBeLessThanOrEqual(14)
    // 每個節點都有文字（沒有因為打錯 id 而多出一個只顯示 id 的節點）
    for (const [id, n] of g.nodes) expect(n.text.trim().length, `${d.name} 節點 ${id}`).toBeGreaterThan(0)
    for (const [id, n] of g.nodes) expect(n.text === id && id.length > 2, `${d.name} 節點 ${id} 沒有標籤`).toBe(false)
    // 沒有孤立節點
    for (const id of g.nodes.keys()) expect(g.edges.some((e) => e.from === id || e.to === id), `${d.name} 節點 ${id} 沒有連線`).toBe(true)
    // 標色只用三種共用 class
    for (const n of g.nodes.values()) for (const c of n.classes) expect(['focus', 'warn', 'ok', 'default']).toContain(c)
    // δ 的極性：gain 誤差一律寫成 (a − w)，不寫 (w − a)
    expect(d.chart).not.toMatch(/\(w(_k)? − a\)/)
    // 不用 ASCII 的 '-' 當減號（會和 Markdown list 混淆，也和正文的 − 不一致）
    for (const n of g.nodes.values()) expect(n.text.replace(/圖 \d+-\d+|F-\d+\.\d+/g, ''), d.name).not.toMatch(/\d\s*-\s*\d|[a-z)]\s-\s[a-z(]/)
    // 原始碼本身就寫全形「＋」與「−」（U+2212）：共用的 sanitizeMermaidSource 不需要幫它改任何字
    expect(sanitizeMermaidSource(d.chart), `${d.name} 含有會被當成 Markdown list 的標籤`).toBe(d.chart)
  })

  it.each(CHARTS.map((d, i) => [`圖 11-${i + 1}`, d.name, d] as const))('%s %s：真的畫得出來，標籤沒有被 Markdown 吃掉', async (_label, name, d) => {
    const g = await parseFlow(d.chart)
    const { svg, text, nodeCount } = await renderMermaidForTest(d.chart)
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(svg).not.toContain('Unsupported markdown')
    expect(nodeCount).toBeLessThanOrEqual(14) // subgraph 的標題不算節點
    expect(nodeCount).toBe(g.nodes.size)
    const host = document.createElement('div')
    host.innerHTML = svg
    expect(host.querySelectorAll('em, strong, a, ul, ol, h1, h2, blockquote, code, del').length).toBe(0)
    const norm = (t: string) => t.replace(/\s+/g, '')
    const drawn = new Set(Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel'), (el) => norm(plain(el.innerHTML))))
    // 每個節點、每條有標籤的連線、每個 subgraph 標題，畫出來的文字和原始碼一字不差
    for (const [id, n] of g.nodes) expect(drawn.has(norm(n.text)), `${name} 節點 ${id}：${n.text}`).toBe(true)
    for (const e of g.edges) if (e.text) expect(drawn.has(norm(e.text)), `${name} 連線 ${e.from}→${e.to}：${e.text}`).toBe(true)
    for (const sg of g.subgraphs) expect(drawn.has(norm(sg.title)), `${name} subgraph ${sg.id}`).toBe(true)
    // classDef 真的套到節點上
    const classed = [...g.nodes.values()].filter((n) => n.classes.some((c) => ['focus', 'warn', 'ok'].includes(c))).length
    expect(host.querySelectorAll('g.node.focus, g.node.warn, g.node.ok').length).toBe(classed)
  })

  it('classDef 的顏色在淺色與深色主題都讀得到：白字配深色底，對比 ≥ 4.5，而且每張圖都有標色的方塊', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    for (const d of CHARTS) {
      const defs = [...d.chart.matchAll(/classDef (\w+) fill:(#[0-9a-f]{6}),stroke:(#[0-9a-f]{6}),color:(#[0-9a-f]{6})/g)]
      expect(defs.map((x) => x[1]).sort(), d.name).toEqual(['focus', 'ok', 'warn'])
      for (const [, cls, fill, , text] of defs) expect(contrast(fill, text), `${d.name} ${cls}`).toBeGreaterThanOrEqual(4.5)
      expect(d.chart, d.name).toMatch(/\n {2}class [A-Z0-9,]+ (focus|warn|ok)/)
    }
  })

  it('章首系統地圖：本章標示的方塊可解析、可畫出，藍色的就是 SYSTEM_MAP_FOCUS', async () => {
    expect(SYSTEM_MAP_FOCUS).toEqual(['dtc', 'pd', 'noise', 'cmp', 'gmac', 'acc'])
    const chart = systemMapChart(SYSTEM_MAP_FOCUS)
    expect(chart).toContain('class DTC,PD,NOISE,CMP,GMAC,ACC focus')
    await mermaid.parse(chart, { suppressErrors: false })
    const { svg, text } = await renderMermaidForTest(chart)
    expect(text).not.toMatch(/Unsupported markdown/)
    const host = document.createElement('div')
    host.innerHTML = svg
    expect(host.querySelectorAll('g.node.focus').length).toBe(SYSTEM_MAP_FOCUS.length)
  })
})

describe('Ch11 方塊圖：和模型／公式一致', () => {
  it('gmac-zero（手算流程）：w = 1.34 時五個 code 的 e 與 x·e 來自 eDet，平均為 0', async () => {
    const g = await parseFlow(D.CHART_GMAC_ZERO)
    const ids: Record<number, string> = { [-2]: 'M2', [-1]: 'M1', 0: 'Z0', 1: 'P1', 2: 'P2' }
    for (const x of five.values) {
      const e = eDet(x, 1.34, CUBIC)
      expect(g.node(ids[x]).text).toBe(`x = ${fmt(x, 0, true)}：e = ${fmt(e, 2, true)}\nx·e = ${fmt(x * e, 2, true)}`)
      expect(g.edge('W', ids[x])).toBeTruthy()
      expect(g.edge(ids[x], 'AVG')).toBeTruthy()
    }
    expect(g.node('W').text).toContain(`= ${fmt(1 - 1.34)}·x + ${fmt(CUBIC.c3, 1)}·x³`)
    expect(g.node('AVG').text).toContain('( 0.24 − 0.24 + 0 − 0.24 + 0.24 ) / 5')
    expect(Math.abs(meanGmacMse(1.34, CUBIC, five))).toBeLessThan(1e-12)
    expect(mseFixedPoint(CUBIC, five)).toBeCloseTo(1.34, 12)
    // 「四個 code 的 e 都不是 0」
    expect(five.values.filter((x) => Math.abs(eDet(x, 1.34, CUBIC)) > 0.1)).toHaveLength(4)
    // 圖說「由左到右」：w → 五個 code → 平均 → 結論
    const lay = await layout(D.CHART_GMAC_ZERO)
    lay.increasing('x', 'W', ['M2', 'M1', 'Z0', 'P1', 'P2'], 'AVG', ['ZERO', 'LEFT'])
  })

  it('error-sources（硬體視角）：DTC 的 delay 以「＋」、補償 w·x 以「−」進加法點；主迴路以虛線回到加法點；w ← w + μ·G', async () => {
    const g = await parseFlow(D.CHART_ERROR_SOURCES)
    expect(g.node('COMP').text).toBe('校正電路的補償量\nw·x')
    expect(g.node('DTC').text).toContain('delay = a·x + d(x)')
    expect(g.into('COMP').map((e) => e.from).sort()).toEqual(['DSM', 'W']) // 補償量 = w × x
    // 加法點：DTC 的真實 delay ＋、補償量 −、其餘（b、ε_cc、v、主迴路的 φ）都是 ＋
    const into = Object.fromEntries(g.into('SUM').map((e) => [e.from, e.text]))
    expect(into).toEqual({ DTC: '＋', COMP: '−', B: '＋', ECC: '＋', V: '＋', LF: '＋ φ（static phase offset）' })
    expect(g.edge('SUM', 'Q').text).toBe('e[n]')
    expect(g.node('Q').text).toContain('q = sign(e)')
    // 主迴路：comparator 若就是 BBPD，q 進 loop filter（虛線），積分後的 φ 以虛線回到加法點
    expect(g.edge('Q', 'LF').text).toContain('BBPD')
    expect(g.into('LF').map((e) => e.from)).toEqual(['Q'])
    // GMAC：q 與 x（regressor）相關，G 去改 w（每 N 個 sample 一次）
    expect(g.into('GMAC').map((e) => e.from).sort()).toEqual(['DSM', 'Q'])
    expect(g.node('GMAC').text).toContain('G = (1/N)·Σ q·x')
    expect(g.edge('GMAC', 'UPD').text).toBe('G')
    expect(g.node('UPD').text).toContain('w ← w + μ·G')
    expect(g.node('UPD').text).toContain('每 N 個 sample')
    expect(g.edge('UPD', 'W')).toBeTruthy()
    // 模型：DTC(a·x + d) − w·x + b + ε_cc + v 就是 F-11.1 的 e = e_det + v
    const m = model({ b: 0.3, c2: 0.05, c3: 0.1, kappa: 0.02 })
    const x = 1.7
    const w = 0.8
    const dtcDelay = m.a * x + (m.c2 * x * x + m.c3 * x ** 3)
    expect(dtcDelay - w * x + m.b + m.kappa * x).toBeCloseTo(eDet(x, w, m), 14)
    // 版面：(DSM、w) → (DTC、補償) → 加法點 → comparator → GMAC → 更新。
    // 迴圈 UPD → W → COMP → SUM → Q → GMAC → UPD 要由 w 開頭宣告，Mermaid 才會把「UPD → W」當成回授線；
    // 否則 dagre 會把 COMP → SUM 反轉，補償量跑到圖的最右邊
    const lay = await layout(D.CHART_ERROR_SOURCES)
    lay.increasing('x', ['W', 'DSM'], ['DTC', 'COMP'], 'SUM', 'Q', 'GMAC', 'UPD')
  })

  it('error-budget（誤差預算）：五項都以「＋」進加法點，和 F-11.1 的五項一一對應', async () => {
    const g = await parseFlow(D.CHART_ERROR_BUDGET)
    const into = g.into('SUM')
    expect(into.map((e) => e.from).sort()).toEqual(['ECC', 'GAIN', 'INL', 'OFF', 'V'])
    for (const e of into) expect(e.text, e.from).toBe('＋')
    expect(g.node('GAIN').text).toContain('(a − w)·x[n]')
    expect(g.node('INL').text).toContain('d(x) = c₂·x² + c₃·x³')
    expect(g.node('ECC').text).toContain('ε_cc[n] = κ·x[n]')
    expect(g.edge('SUM', 'CMP').text).toBe('e[n]')
    expect(g.node('CMP').text).toContain('q[n] = sign(e[n])')
    expect(g.node('GMAC').text).toContain('G_k = (1/N)·Σ q[n]·x[n]')
    // 與 x 相關的三項都由 code 分出來；offset 與雜訊不是
    for (const id of ['GAIN', 'INL', 'ECC', 'GMAC']) expect(g.edge('X', id)).toBeTruthy()
    for (const id of ['OFF', 'V']) expect(g.into(id)).toHaveLength(0)
    // 模型：五項相加就是 eDet + v
    const m = model({ b: 0.3, c2: 0.05, c3: 0.1, kappa: 0.02 })
    const x = 2
    const w = 0.9
    expect((m.a - w) * x + m.b + (m.c2 * x * x + m.c3 * x ** 3) + m.kappa * x).toBeCloseTo(eDet(x, w, m), 14)
    // 標色：gain 誤差是主角；與 code 相關的確定性誤差是紅色；雜訊是綠色；offset 不上色
    expect(g.node('GAIN').classes).toContain('focus')
    expect(g.node('INL').classes).toContain('warn')
    expect(g.node('ECC').classes).toContain('warn')
    expect(g.node('V').classes).toContain('ok')
    expect(g.node('OFF').classes.filter((c) => c !== 'default')).toEqual([])
    // 正文「先看左邊…再看中間的加法點」
    const lay = await layout(D.CHART_ERROR_BUDGET)
    lay.increasing('x', 'X', ['GAIN', 'OFF', 'INL', 'ECC', 'V'], 'SUM', 'CMP', 'GMAC')
  })

  it('lms-loop（LMS 迴圈）：w_(k+1) = w_k + μ·G_k，延遲在 w 的回授上；sample（n）一列、block（k）一列', async () => {
    const g = await parseFlow(D.CHART_LMS_LOOP)
    const into = g.into('ADD')
    expect(into.map((e) => `${e.from}:${e.text}`).sort()).toEqual(['DLY:＋ w_k', 'MU:＋ μ·G_k'])
    expect(g.edge('ADD', 'DLY').text).toBe('w_(k+1)')
    expect(g.node('DLY').text).toContain('z⁻¹')
    expect(g.node('ERR').text).toContain('(a − w_k)·x[n]')
    expect(g.node('ERR').text).toContain(`（${figLabel('error-budget')}）`) // 圖上引用的圖號沒有過期
    expect(g.edge('ERR', 'CMP').text).toBe('e[n]')
    expect(g.edge('AVG', 'MU').text).toBe('G_k')
    // 相關器：q 與 x 相乘（sample rate），N 個一組送到 block rate 取平均
    expect(g.into('MUL').map((e) => e.from).sort()).toEqual(['CMP', 'X'])
    expect(g.node('AVG').text).toContain('G_k = (1/N)·Σ q[n]·x[n]')
    // 兩種速率各自一個 subgraph；跨速率的兩條線：乘積往下、w_k 往上回授
    const fast = g.subgraphs.find((x) => x.id === 'FAST')
    const slow = g.subgraphs.find((x) => x.id === 'SLOW')
    expect(fast?.title).toContain('每個 sample n')
    expect(slow?.title).toContain('每個 block k')
    expect([...(fast?.nodes ?? [])].sort()).toEqual(['CMP', 'ERR', 'MUL', 'X'])
    expect([...(slow?.nodes ?? [])].sort()).toEqual(['ADD', 'AVG', 'DLY', 'MU'])
    expect(g.edge('FAST', 'SLOW').text).toContain('q[n]·x[n]')
    expect(g.edge('SLOW', 'FAST').text).toMatch(/^w_k 回授/)
    // 版面：sample 那一列在上、block 那一列在下；每一列都是由左到右
    const lay = await layout(D.CHART_LMS_LOOP)
    lay.increasing('y', ['X', 'ERR', 'CMP', 'MUL'], ['AVG', 'MU', 'ADD', 'DLY'])
    lay.increasing('x', 'X', 'ERR', 'CMP', 'MUL')
    lay.increasing('x', 'AVG', 'MU', 'ADD', 'DLY')
  })

  it('mse-vs-sign（MSE vs Sign）：大雜訊的出口回到 MSE 的封閉解，σ_v = 0 的出口是 |x| 加權中位數', async () => {
    const g = await parseFlow(D.CHART_MSE_VS_SIGN)
    expect(g.edge('GS', 'FM').text).toContain('erf ≈ K_q·e_det')
    expect(g.edge('GS', 'FMED').text).toContain('σ_v = 0')
    expect(g.node('ERF').text).toContain('E[q | x] = erf( e_det / (√2·σ_v) )')
    expect(g.node('FM').text).toContain('w* = a + ( b·E[x] + E[x·d] + E[x·ε_cc] ) / E[x²]')
    // 模型：σ_v 很大 → MSE 解；σ_v = 0 → 1.4；中間介於兩者
    const mse = mseFixedPoint(CUBIC, five)
    const big = fixedPoint('sign', { ...CUBIC, sigmaV: 100 }, five).w
    const mid = fixedPoint('sign', { ...CUBIC, sigmaV: 0.1 }, five).w
    const zero = fixedPoint('sign', CUBIC, five).w
    expect(Math.abs(big - mse)).toBeLessThan(1e-6)
    expect(zero).toBeCloseTo(1.4, 9)
    expect(mid).toBeGreaterThan(mse + 1e-3)
    expect(mid).toBeLessThan(zero - 1e-3)
    expect(g.node('FMED').text).toContain('1.4')
    expect(g.node('FR').text).toContain(`${fmt(mse)} 與 ${fmt(zero, 1)} 之間`)
    // 圖說「最下面三個出口」
    const lay = await layout(D.CHART_MSE_VS_SIGN)
    lay.increasing('y', 'E', 'SGN', 'ERF', 'GS', ['FM', 'FR', 'FMED'])
    lay.increasing('y', 'MSE', 'GM', 'FM')
  })

  it('comparator-model：三排只有 comparator 那一塊不同；erf 與 K_q 的式子和 bias.ts 一致', async () => {
    const g = await parseFlow(D.CHART_COMPARATOR_MODEL)
    expect(g.subgraphs.map((x) => x.id).sort()).toEqual(['LIN', 'MEAN', 'REAL'])
    // ① 實際電路：e_det 與 v 都以「＋」進加法點 → sign → q = ±1 → 乘 x 取平均
    expect(g.into('R1').map((e) => `${e.from}:${e.text}`).sort()).toEqual(['R0:＋', 'R2:＋'])
    expect(g.edge('R1', 'R3').text).toBe('e[n]')
    expect(g.node('R3').text).toContain('sign(·)')
    expect(g.edge('R3', 'R4').text).toBe('q[n] = ±1')
    expect(g.node('R4').text).toContain('G_k')
    // ② 對 v 平均 → erf（F-11.2，精確）
    expect(g.node('M1').text).toContain('erf( e_det / (√2·σ_v) )')
    expect(g.edge('M1', 'M2').text).toBe('E[q | x]')
    expect(g.node('M3').text).toContain('E[G] = E[ x·erf( e_det / (√2·σ_v) ) ]')
    // ③ 線性化 → K_q（F-11.3，近似）
    expect(g.node('L1').text).toContain('K_q = √(2/π) / σ_v')
    expect(g.edge('L1', 'L2').text).toBe('K_q·e_det')
    expect(g.node('L3').text).toContain('E[G] ≈ K_q·E[x·e]')
    expect(g.edge('MEAN', 'LIN').text).toContain('|e_det| 都遠小於 σ_v')
    // 藍色只有三個 comparator 方塊（三排的差別）
    const blue = [...g.nodes.entries()].filter(([, n]) => n.classes.includes('focus')).map(([id]) => id).sort()
    expect(blue).toEqual(['L1', 'M1', 'R3'])
    // 模型：E[q | x] 就是 erf；小訊號斜率是 K_q；|e|/σ_v = 0.3（Lab 的門檻）時線性化約高估 1.5%
    expect(comparatorMean(1e-6, 1) / 1e-6).toBeCloseTo(KQ_FACTOR, 6)
    expect(comparatorMean(LINEAR_OK_RATIO, 1) / (KQ_FACTOR * LINEAR_OK_RATIO)).toBeCloseTo(1 - LINEAR_OK_RATIO ** 2 / 6, 3)
    // ③ 的結論：σ_v 遠大於殘差時 E[G] ≈ K_q·E[x·e]（即 K_q × MSE 的 GMAC）
    const wide = { ...CUBIC, sigmaV: 50 }
    const gSign = meanGmacSign(1.2, wide, five)
    const gLin = (KQ_FACTOR / 50) * meanGmacMse(1.2, wide, five)
    expect(Math.abs(gSign - gLin) / Math.abs(gLin)).toBeLessThan(1e-3)
    // 版面：實際電路在上、對雜訊平均在中間、線性化在下；每一排由左到右
    const lay = await layout(D.CHART_COMPARATOR_MODEL)
    lay.increasing('y', ['R0', 'R2', 'R1', 'R3', 'R4'], ['M0', 'M1', 'M2', 'M3'], ['L0', 'L1', 'L2', 'L3'])
    lay.increasing('x', 'R0', 'R1', 'R3', 'R4')
    lay.increasing('x', 'M0', 'M1', 'M2', 'M3')
    lay.increasing('x', 'L0', 'L1', 'L2', 'L3')
  })

  it('bias-correlators（五個相關器）：右欄五項相加為 0 解出的 w* 就是 F-11.4（以模型數值驗證）', async () => {
    const g = await parseFlow(D.CHART_BIAS_CORRELATORS)
    for (const i of [1, 2, 3, 4, 5]) {
      expect(g.edge(`T${i}`, `C${i}`)).toBeTruthy()
      expect(g.edge(`C${i}`, 'S').text).toBe('＋')
    }
    expect(g.node('C1').text).toBe('(a − w)·E[x²]')
    expect(g.node('C2').text).toBe('b·E[x]')
    expect(g.node('C5').text).toBe('E[x·v] = 0')
    expect(g.subgraphs.map((s) => s.title)).toEqual(expect.arrayContaining(['e[n] 的五項', '各自乘上 x 再取平均']))
    // 非對稱 code（E[x] ≠ 0、E[x³] ≠ 0）+ 全部的 bias 項
    const m = model({ b: 0.5, c2: 0.05, c3: 0.1, kappa: 0.02 })
    const mo = codeMoments(u4)
    const c2to4 = m.b * mo.Ex + expectation(u4, (x) => x * (m.c2 * x * x + m.c3 * x ** 3)) + expectation(u4, (x) => x * m.kappa * x)
    const wStar = m.a + c2to4 / mo.Ex2 // 圖上 FP 節點的式子
    expect(wStar).toBeCloseTo(mseFixedPoint(m, u4), 12)
    expect((m.a - wStar) * mo.Ex2 + c2to4).toBeCloseTo(0, 12) // C1 + C2 + C3 + C4 + C5 = 0
    expect(meanGmacMse(wStar, m, u4)).toBeCloseTo(0, 12)
    // 正文「左欄 → 右欄 → 加法點」
    const lay = await layout(D.CHART_BIAS_CORRELATORS)
    lay.increasing('x', ['T1', 'T2', 'T3', 'T4', 'T5'], ['C1', 'C2', 'C3', 'C4', 'C5'], 'S', 'FP')
    lay.increasing('y', 'T1', 'T2', 'T3', 'T4', 'T5')
  })

  it('offset-path（offset 路徑）：uniform [0, 1) code、b = 0.1 ⇒ b·E[x] = 0.05、w* − a = 0.15', async () => {
    const g = await parseFlow(D.CHART_OFFSET_PATH)
    const u = buildCodeDistribution({ kind: 'uniform_residue' })
    const mo = codeMoments(u)
    const b = 0.1
    expect(mo.Ex).toBeCloseTo(1 / 2, 9)
    expect(mo.Ex2).toBeCloseTo(1 / 3, 9)
    expect(g.node('X').text).toContain('E[x] = 1/2，E[x²] = 1/3')
    expect(g.node('OFF').text).toContain(`b = ${fmt(b, 1)}`)
    expect(g.node('AVG').text).toContain(`b·E[x] = ${fmt(b * mo.Ex)}`)
    expect(g.node('BIAS').text).toContain(`多調 ${fmt(b * mo.Ex)} ÷ (1/3) = ${fmt(mseFixedPoint(model({ b }), u) - 1)}`)
    expect(g.node('BIAS').text).toContain('w* − a = b·E[x] / E[x²]')
    // 置中後 offset 項為 0
    expect(mseFixedPoint(model({ b }), five)).toBeCloseTo(1, 12)
    expect(g.edge('AVG', 'ZERO').text).toBe('若 code 置中')
    const lay = await layout(D.CHART_OFFSET_PATH)
    lay.increasing('x', ['OFF', 'X'], 'MUL', 'AVG', ['BIAS', 'ZERO'])
  })

  it('dc-null（三種架構）：積分路徑的極性與輸入、三個固定點公式都和模型一致', async () => {
    const g = await parseFlow(D.CHART_DC_NULL)
    expect(g.subgraphs).toHaveLength(3)
    // 版面：三種架構由上到下依序是 (A)(B)(C)，每個框內由左到右
    const lay = await layout(D.CHART_DC_NULL)
    lay.increasing('y', ['A0', 'A1', 'A2'], ['B0', 'B1', 'B2', 'B3', 'B4'], ['C0', 'C1', 'C2', 'C3', 'C4'])
    lay.increasing('x', 'A0', 'A1', 'A2')
    lay.increasing('x', 'B0', 'B1', 'B2', ['B3', 'B4'])
    lay.increasing('x', 'C0', 'C1', ['C2', 'C4'], 'C3')
    // (A) 沒有回授
    expect(g.into('A0')).toHaveLength(0)
    // (B) φ ← φ − k_φ·q，以「＋ φ」加回 comparator 輸入
    expect(g.node('B4').text).toContain('φ ← φ − k_φ·q')
    expect(g.edge('B2', 'B4').text).toBe('q')
    expect(g.edge('B4', 'B1').text).toBe('＋ φ')
    expect(g.node('B2').text).toContain('q = sign(e_det + φ + v)')
    // (C) 線性 PD 看不到 comparator 的 b；積分的是 e_PD；comparator 再加上自己的 b
    expect(g.node('C0').text).toBe('e_det − b')
    expect(g.node('C4').text).toContain('φ ← φ − k_φ·e_PD')
    expect(g.edge('C1', 'C4').text).toBe('e_PD')
    expect(g.edge('C4', 'C1').text).toBe('＋ φ')
    expect(g.node('C2').text).toContain('q = sign(e_PD + b + v)')
    // 三個節點上的公式（照圖上的式子重算）= bias.ts 的 linearizedFixedPoint
    const m = model({ b: 0.5, c2: 0.05, c3: 0.1, kappa: 0.02 })
    const mo = codeMoments(u4)
    const f = (x: number) => m.c2 * x * x + m.c3 * x ** 3 + m.kappa * x // d + ε_cc
    const Exf = expectation(u4, (x) => x * f(x))
    const cov = Exf - mo.Ex * expectation(u4, f)
    expect(g.node('A2').text).toContain('w* − a = ( b·E[x] + E[x·d] + E[x·ε_cc] ) / E[x²]')
    expect(g.node('B3').text).toContain('w* − a ≈ Cov(x, d + ε_cc) / Var(x)')
    expect(g.node('C3').text).toContain('w* − a ≈ ( b·E[x] + Cov(x, d + ε_cc) ) / Var(x)')
    expect(m.a + (m.b * mo.Ex + Exf) / mo.Ex2).toBeCloseTo(linearizedFixedPoint(m, u4, 'none', false).w, 12)
    expect(m.a + cov / mo.varX).toBeCloseTo(linearizedFixedPoint(m, u4, 'shared_bbpd', false).w, 12)
    expect(m.a + (m.b * mo.Ex + cov) / mo.varX).toBeCloseTo(linearizedFixedPoint(m, u4, 'linear_pd', false).w, 12)
    // 勘誤 E03 的例子（b = 0.5、x ∈ {0,1,2,3}）：(B) offset 消失、(C) 比 (A) 大
    const off = model({ b: 0.5 })
    const [wa, wb, wc] = (['none', 'shared_bbpd', 'linear_pd'] as const).map((mode) => linearizedFixedPoint(off, u4, mode, false).w)
    expect(wb).toBeCloseTo(1, 12)
    expect(wc).toBeGreaterThan(wa)
    expect(wa).toBeGreaterThan(1)
  })

  it('servo-dither（servo 抖動）：實際有三個「＋」輸入、等效只剩兩個，變異數相加', async () => {
    const g = await parseFlow(D.CHART_SERVO_DITHER)
    expect(g.into('R3').map((e) => e.text)).toEqual(['＋', '＋', '＋'])
    expect(g.into('Q2').map((e) => e.text)).toEqual(['＋', '＋'])
    expect(g.node('R1').text).toContain('σ_φ²')
    expect(g.node('R2').text).toContain('σ_v²')
    expect(g.node('Q1').text).toContain('σ_eff² = σ_v² + σ_φ²')
    expect(g.node('Q3').text).toMatch(/erf\( \(e_det \+ φ̄\) \/ \(√2·σ_eff\) \)/)
    expect(g.edge('REAL', 'EQUIV').text).toContain('變異數相加')
    const lay = await layout(D.CHART_SERVO_DITHER)
    lay.increasing('y', ['R0', 'R1', 'R2', 'R3', 'R4'], ['Q0', 'Q1', 'Q2', 'Q3'])
  })

  it('centering-tree（centering 判斷樹）：四個問題、三個紅色出口，和模型的行為一致', async () => {
    const g = await parseFlow(D.CHART_CENTERING_TREE)
    expect(g.edge('Q1', 'N1').text).toBe('否')
    expect(g.edge('Q2', 'N2').text).toContain('σ_v = 0')
    expect(g.edge('Q4', 'Y1').text).toBe('沒有')
    for (const id of ['N1', 'N2', 'N3']) expect(g.node(id).classes).toContain('warn')
    expect(g.node('Y1').classes).toContain('ok')
    const lay = await layout(D.CHART_CENTERING_TREE)
    lay.increasing('y', 'Q1', 'Q2', 'Q3', 'Q4', ['Y1', 'Y2'])
    // Y1：置中 + 常數 σ_v > 0 + 只有 offset ⇒ w* = a（任意 b）
    for (const b of [0.2, 0.7, 2]) expect(fixedPoint('sign', model({ b, sigmaV: 0.4 }), five).w).toBeCloseTo(1, 9)
    // N1：沒置中 ⇒ b·E[x]/E[x²]
    const mo = codeMoments(u4)
    expect(mseFixedPoint(model({ b: 0.5 }), u4) - 1).toBeCloseTo((0.5 * mo.Ex) / mo.Ex2, 12)
    // N2：σ_v = 0 ⇒ dead zone (a − b/2, a + b/2) 包含 a
    const dz = signWeightedMedian(model({ b: 0.1, sigmaV: 0 }), five.values, five.probs)
    expect(dz.lo).toBeCloseTo(0.95, 12)
    expect(dz.hi).toBeCloseTo(1.05, 12)
    // N3：σ_v 隨 code ⇒ 置中也有 bias（勘誤 E17：0.9601）；MSE 不受影響
    const jit = model({ b: 0.2, jitterSlope: 0.25, jitterRef: -2 })
    expect(Math.abs(fixedPoint('sign', jit, five).w - 1)).toBeGreaterThan(0.03)
    expect(mseFixedPoint(jit, five)).toBeCloseTo(1, 12)
    // Y2：有 INL 時，offset 經 erf 改變 INL 的 bias（|b| 與 σ_v 同量級）
    const w0 = fixedPoint('sign', model({ c3: 0.1, sigmaV: 0.5 }), five).w
    const w1 = fixedPoint('sign', model({ b: 1, c3: 0.1, sigmaV: 0.5 }), five).w
    expect(Math.abs(w1 - w0)).toBeGreaterThan(1e-3)
  })

  it('jitter-weight：σ_v(x)、權重 1/σ_v、b·E[x/σ_v] = −0.0578、E[x²/σ_v] = 1.4476、w* = 0.9601 都來自 bias.ts', async () => {
    const g = await parseFlow(D.CHART_JITTER_WEIGHT)
    const jit = model({ b: 0.2, jitterSlope: 0.25, jitterRef: -2 })
    expect(five.values.map((x) => fmt(sigmaAt(x, jit), 3))).toEqual(['1', '1.118', '1.414', '1.803', '2.236'])
    expect(g.node('OFF').text).toContain(`b = ${fmt(jit.b, 1)}`)
    expect(g.node('OFF').text).toContain(`x·b：${five.values.map((x) => fmt(x * jit.b, 1, true)).join('、')}`)
    expect(g.node('KV').text).toContain(`權重 1/σ_v(x)：${five.values.map((x) => fmt(1 / sigmaAt(x, jit), 3)).join('、')}`)
    // 常數 σ_v：b·E[x] = 0；σ_v(x)：b·E[x/σ_v] ≠ 0
    expect(codeMoments(five).Ex).toBeCloseTo(0, 14)
    const bExw = expectation(five, (x) => (jit.b * x) / sigmaAt(x, jit))
    const Ex2w = expectation(five, (x) => (x * x) / sigmaAt(x, jit))
    expect(g.node('SC').text).toContain('b·E[x] = 0')
    expect(g.node('SV').text).toContain(`b·E[x / σ_v(x)] = ${fmt(bExw, 4)}`)
    const wLin = linearizedFixedPoint(jit, five, 'none', true).w
    expect(g.node('WV').text).toContain(`( ${fmt(bExw, 4)} ) / E[x² / σ_v(x)]`)
    expect(g.node('WV').text).toContain(`= 1 − ${fmt(Math.abs(bExw), 4)} / ${fmt(Ex2w, 4)} = ${fmt(wLin, 4)}`)
    expect(1 + bExw / Ex2w).toBeCloseTo(wLin, 12)
    // 勘誤 E17：Sign-LMS 的 mean-field 根也是 0.9601；σ_v 為常數或改用 MSE-LMS 都回到 w = a
    expect(fixedPoint('sign', jit, five).w).toBeCloseTo(0.9601, 3)
    expect(fixedPoint('sign', { ...jit, jitterSlope: 0 }, five).w).toBeCloseTo(1, 9)
    expect(mseFixedPoint(jit, five)).toBeCloseTo(1, 12)
    // 結構：同一個起點 b，兩條路只差權重那一塊（藍色）
    expect(g.edge('OFF', 'KC')).toBeTruthy()
    expect(g.edge('OFF', 'KV')).toBeTruthy()
    expect(g.edge('KC', 'SC')).toBeTruthy()
    expect(g.edge('KV', 'SV')).toBeTruthy()
    expect(g.edge('SV', 'WV')).toBeTruthy()
    expect(g.node('KV').classes).toContain('focus')
    expect(g.node('WC').classes).toContain('ok')
    expect(g.node('WV').classes).toContain('warn')
    const lay = await layout(D.CHART_JITTER_WEIGHT)
    lay.increasing('x', 'OFF', ['KC', 'KV'], ['SC', 'SV'], ['WC', 'WV'])
  })

  it('dead-zone（dead zone）：邊界 1.3333／1.5 與三個區域的 E[G] 來自模型', async () => {
    const g = await parseFlow(D.CHART_DEAD_ZONE)
    const m = model({ b: 1, sigmaV: 0 })
    const z = signWeightedMedian(m, u4.values, u4.probs)
    expect(g.node('LO').text).toContain(`小於 ${z.lo.toFixed(4)}`)
    expect(g.node('DZ').text).toContain(`w 在 ${z.lo.toFixed(4)} 與 ${fmt(z.hi, 4)} 之間`)
    expect(g.node('HI').text).toContain(`大於 ${fmt(z.hi, 4)}`)
    expect(g.node('LO').text).toContain(`E[G] = ${fmt(meanGmacSign(1.2, m, u4), 2, true)}`)
    expect(meanGmacSign(1.4, m, u4)).toBe(0)
    expect(g.node('DZ').text).toContain('E[G] = 0')
    expect(g.node('HI').text).toContain(`E[G] = ${fmt(meanGmacSign(1.7, m, u4))} 或 ${fmt(meanGmacSign(2.5, m, u4))}`)
    // 加入雜訊後零交越唯一，且落在原本的 dead zone 內
    const w = fixedPoint('sign', { ...m, sigmaV: 0.05 }, u4).w
    expect(w).toBeGreaterThan(z.lo)
    expect(w).toBeLessThan(z.hi)
    // 圖說「左邊兩個方塊…推進 dead zone」
    const lay = await layout(D.CHART_DEAD_ZONE)
    lay.increasing('x', ['LO', 'HI'], 'DZ', ['STOP', 'UNI'])
  })

  it('best-fit（最佳直線）：0.68／2／0.34／1.34 與殘差 ∓0.24、±0.12 來自模型，殘差與 x 正交', async () => {
    const g = await parseFlow(D.CHART_BEST_FIT)
    const mo = codeMoments(five)
    const Exd = CUBIC.c3 * mo.Ex4
    const slope = Exd / mo.Ex2
    expect(g.node('PAR').text).toContain(`= ( ${fmt(Exd)} / ${fmt(mo.Ex2)} )·x = ${fmt(slope)}·x`)
    expect(g.node('ABS').text).toContain(`w* = a + ${fmt(slope)} = ${fmt(mseFixedPoint(CUBIC, five))}`)
    expect(g.node('ORT').text).toContain(`e₀(x) = ${fmt(CUBIC.c3, 1)}·x³ − ${fmt(slope)}·x`)
    const e1 = eDet(1, 1.34, CUBIC)
    const e2 = eDet(2, 1.34, CUBIC)
    expect(e1).toBeLessThan(0) // x = +1 的殘差是負的 ⇒ 圖上寫「x = ±1：∓0.24」
    expect(e2).toBeGreaterThan(0)
    expect(g.node('RES').text).toContain(`x = ±1：∓${fmt(Math.abs(e1))}；x = ±2：±${fmt(e2)}`)
    expect(expectation(five, (x) => x * eDet(x, 1.34, CUBIC))).toBeCloseTo(0, 12)
    const lay = await layout(D.CHART_BEST_FIT)
    lay.increasing('x', 'D', 'SPLIT', ['PAR', 'ORT'], ['ABS', 'RES'])
  })

  it('mean-vs-median（平均 vs 中位數）：權重、票重與三個答案來自模型', async () => {
    const g = await parseFlow(D.CHART_MEAN_VS_MEDIAN)
    const t1 = perCodeGain(1, CUBIC)
    const t2 = perCodeGain(2, CUBIC)
    expect(g.node('T').text).toContain(`t(±1) = ${fmt(t1)}；t(±2) = ${fmt(t2)}`)
    const wt = (pow: number, ax: number) => five.values.reduce((s, x, i) => s + (Math.abs(x) === ax ? five.probs[i] * Math.abs(x) ** pow : 0), 0)
    expect(g.node('M1').text).toContain(`權重 p·x²：${fmt(wt(2, 1))} 與 ${fmt(wt(2, 2))}`)
    expect(g.node('M3').text).toContain(`票重 p·|x|：${fmt(wt(1, 1))} 與 ${fmt(wt(1, 2))}`)
    const mean = mseWeightedMean(CUBIC, five.values, five.probs)
    expect(g.node('R1').text).toContain(`( ${fmt(wt(2, 1))}·${fmt(t1)} + ${fmt(wt(2, 2))}·${fmt(t2)} ) / ${fmt(wt(2, 1) + wt(2, 2))} = ${fmt(mean)}`)
    const med = signWeightedMedian(CUBIC, five.values, five.probs)
    expect(med.lo).toBeCloseTo(1.4, 12)
    expect(med.hi).toBeCloseTo(1.4, 12)
    expect(g.node('R3').text).toContain(`${fmt(t2)} 的票重 ${fmt(wt(1, 2))} 超過總重 ${fmt(wt(1, 1) + wt(1, 2))} 的一半`)
    expect(wt(1, 2)).toBeGreaterThan((wt(1, 1) + wt(1, 2)) / 2)
    // 二階修正的係數 3.456×10⁻⁴（σ_v = 1 時的修正量）
    const coef = signSecondOrder({ ...CUBIC, sigmaV: 1 }, five) - mean
    expect(coef).toBeCloseTo(3.456e-4, 9)
    expect(g.node('R2').text).toContain('1.34 + 3.456×10⁻⁴ / σ_v²')
    // 圖說「最上面／中間／最下面」
    const lay = await layout(D.CHART_MEAN_VS_MEDIAN)
    lay.increasing('y', 'T', ['M1', 'M2', 'M3'], ['R1', 'R2', 'R3'])
  })

  it('identifiability／coupling-node（不可辨識）：兩條路以「＋」並聯，兩個世界的 GMAC 完全相同', async () => {
    const g = await parseFlow(D.CHART_IDENTIFIABILITY)
    expect(g.into('S').map((e) => `${e.from}:${e.text}`).sort()).toEqual(['GA:＋', 'GK:＋', 'V:＋'])
    expect(g.node('GA').text).toContain('× (a − w)')
    expect(g.node('GK').text).toContain('× κ')
    expect(g.node('CMP').text).toContain('e[n] = ( (a + κ) − w )·x[n] + v[n]')
    expect(g.edge('S', 'CMP')).toBeTruthy()
    const A = model({ kappa: 0.1, sigmaV: 0.5 })
    const B = model({ a: 1.1, sigmaV: 0.5 })
    expect(g.node('WA').text).toContain(`a = ${A.a}，κ = ${A.kappa}`)
    expect(g.node('WB').text).toContain(`a = ${B.a}，κ = ${B.kappa}`)
    for (const w of [0.6, 0.9, 1.1, 1.3, 1.6]) expect(Math.abs(meanGmacSign(w, A, five) - meanGmacSign(w, B, five))).toBeLessThan(1e-14)
    expect(fixedPoint('sign', A, five).w).toBeCloseTo(1.1, 9)
    expect(g.node('OBS').text).toContain('w* = a + κ = 1.1')
    expect(g.into('OBS').map((e) => e.from).sort()).toEqual(['CMP', 'WA', 'WB'])
    const lay = await layout(D.CHART_IDENTIFIABILITY)
    lay.increasing('x', 'X', ['GA', 'GK'], 'S', 'CMP', 'OBS')
    const c = await parseFlow(D.CHART_COUPLING_NODE)
    expect(c.node('A2').classes).toContain('ok')
    expect(c.node('B2').classes).toContain('warn')
    expect(c.node('B2').text).toContain('κ·x')
  })

  it('near-integer-path／near-integer-why：gain 誤差經過 H_PD、β 不經過；w* = a + B/C、S = K_q·C', async () => {
    const g = await parseFlow(D.CHART_NEAR_INTEGER_PATH)
    expect(g.edge('X', 'G')).toBeTruthy()
    expect(g.edge('G', 'H')).toBeTruthy()
    expect(g.edge('H', 'S').text).toBe('＋ (a − w)·(h ∗ x)[n]')
    expect(g.edge('BETA', 'S').text).toBe('＋')
    expect(g.into('H').map((e) => e.from)).toEqual(['G']) // β 不經過 H_PD
    expect(g.edge('PATH', 'CORR').text).toBe('e_PD[n]')
    expect(g.node('CMP').text).toContain('q[n] = sign(e_PD[n])')
    expect(g.into('M').map((e) => e.from).sort()).toEqual(['CMP', 'XR'])
    expect(g.node('XR').text).toContain('x[n]')
    expect(g.node('AVG').text).toContain('E[G] ≈ K_q·( (a − w)·C + B )')
    // 版面：誤差路徑在上、GMAC 在下
    const lay = await layout(D.CHART_NEAR_INTEGER_PATH)
    lay.increasing('y', ['X', 'G', 'H', 'S', 'BETA', 'V'], ['CMP', 'XR', 'M', 'AVG', 'FP'])
    lay.increasing('x', 'X', 'G', 'H', 'S')
    lay.increasing('x', 'CMP', 'M', 'AVG', 'FP')
    expect(g.node('FP').text).toContain('w* = a + B / C')
    const s = nearIntegerSensitivity(0.01, 0.01, 1)
    expect(s.bias).toBeCloseTo(1, 12)
    expect(s.slope).toBeCloseTo(KQ_FACTOR * 0.01, 14)
    expect(nearIntegerSensitivity(0.01, -0.01, 1).attracting).toBe(false)
    const y = await parseFlow(D.CHART_NEAR_INTEGER_WHY)
    expect(y.into('CS').map((e) => e.from).sort()).toEqual(['IN', 'OUT'])
    expect(y.node('IN').text).toMatch(/Ω_k 小於 Ω_n[\s\S]*Re H_PD 為負/)
    expect(y.node('OUT').text).toMatch(/Ω_k 不小於 Ω_n[\s\S]*Re H_PD 為正/)
    expect(y.node('SL').text).toContain('S = K_q·C')
    expect(y.node('NG').text).toContain('C ≤ 0')
    const layY = await layout(D.CHART_NEAR_INTEGER_WHY)
    layY.increasing('y', 'F', 'SAW', ['IN', 'OUT'], 'CS', ['SL', 'BI', 'NG'])
  })

  it('near-integer-check：兩支都從標準化的 residue 出發，頻域式就是 nearIntegerC 的算法；時域與頻域的 C 一致', async () => {
    const g = await parseFlow(D.CHART_NEAR_INTEGER_CHECK)
    expect(g.edge('FRAC', 'DSM')).toBeTruthy()
    expect(g.edge('DSM', 'NORM')).toBeTruthy()
    expect(g.into('T1').map((e) => e.from)).toEqual(['NORM'])
    expect(g.into('F1').map((e) => e.from)).toEqual(['NORM'])
    expect(g.node('DSM').text).toContain('P = 2¹⁶ / gcd(K, 2¹⁶)')
    expect(g.node('NORM').text).toContain('E[x] = 0，E[x²] = 1')
    expect(g.node('T1').text).toContain('u[n] = (h ∗ x)[n]')
    expect(g.node('F2').text).toContain('C = Σ_k |X_k|²·Re H_PD(e^{jΩ_k})')
    expect(g.node('F2').text).toContain('Ω_k = 2πk / P')
    expect(g.into('CHK').map((e) => e.from).sort()).toEqual(['F2', 'T2'])
    expect(g.edge('CHK', 'OUT').text).toBe('是')
    expect(g.edge('CHK', 'BAD').text).toBe('否')
    expect(g.node('OUT').text).toContain('w* − a = B / C')
    // 模型：16-bit first-order DSM 的週期 P = 2¹⁶/gcd(K, 2¹⁶)；兩條路的 C 相對差小於 10⁻⁶（圖上六角形的門檻）
    const r = nearIntegerSweep({ fracs: [0.0625, 0.25], wnTs: 0.05, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1, length: 2048 })
    expect(r.period).toEqual([2 ** 16 / 4096, 2 ** 16 / 16384]) // K = 4096、16384
    expect(r.maxRelDiff).toBeLessThan(1e-6)
    expect(r.bias[0]).toBeCloseTo(0.01 / r.Cfreq[0], 12) // w* − a = B/C
    const lay = await layout(D.CHART_NEAR_INTEGER_CHECK)
    lay.increasing('x', 'FRAC', 'DSM', 'NORM', ['T1', 'F1'], ['T2', 'F2'], 'CHK', ['OUT', 'BAD'])
  })

  it('slope-measure：Ŝ = (G₋ − G₊)/(2Δ) 就是 bias.ts 的 slopeProbe；Ŝ ≤ 0 極性錯誤、Ŝ 很小 bias 被放大', async () => {
    const g = await parseFlow(D.CHART_SLOPE_MEASURE)
    expect(g.node('F1').text).toContain('w + Δ')
    expect(g.node('F1').text).toContain('G₊')
    expect(g.node('F2').text).toContain('w − Δ')
    expect(g.node('F2').text).toContain('G₋')
    expect(g.node('F3').text).toContain('Ŝ = ( G₋ − G₊ ) / (2·Δ)')
    expect(g.into('F3').map((e) => e.from).sort()).toEqual(['F1', 'F2'])
    expect(g.edge('Q1', 'BAD').text).toBe('否')
    expect(g.edge('Q1', 'Q2').text).toBe('是')
    expect(g.edge('Q2', 'SMALL').text).toBe('是')
    expect(g.edge('Q2', 'GOOD').text).toBe('否')
    expect(g.into('NEXT').map((e) => e.from).sort()).toEqual(['BAD', 'GOOD', 'SMALL'])
    expect(g.node('Q2').text).toContain('K_q·E[x²]')
    expect(g.node('BAD').text).toContain('C ≤ 0')
    expect(g.node('SMALL').text).toContain('bias = B / C 被放大')
    // 模型：靜態路徑 a = 1、5-level code、σ_v = 1。G(w) 對 w 遞減，所以 Ŝ = (G(w−Δ) − G(w+Δ))/(2Δ) 為正，且 ≈ K_q·E[x²]
    const stat = model({ sigmaV: 1 })
    const delta = 0.05
    const sHat = (meanGmacSign(1 - delta, stat, five) - meanGmacSign(1 + delta, stat, five)) / (2 * delta)
    expect(sHat).toBeGreaterThan(0)
    expect(Math.abs(sHat - KQ_FACTOR * codeMoments(five).Ex2) / sHat).toBeLessThan(5e-3)
    // C 很小時 Ŝ = K_q·C 遠小於靜態值；C < 0 時 Ŝ < 0 且固定點是 repelling
    expect(nearIntegerSensitivity(0.01, 0.01, 1).slope).toBeLessThan(0.1 * KQ_FACTOR)
    expect(nearIntegerSensitivity(0.01, -0.01, 1).slope).toBeLessThan(0)
    expect(nearIntegerSensitivity(0.01, -0.01, 1).attracting).toBe(false)
    const src = readFileSync(join(process.cwd(), 'src/simulation/models/bias.ts'), 'utf8')
    expect(src).toContain('slope: (lo.mean - hi.mean) / (2 * delta)') // lo = w−Δ、hi = w+Δ
    const lay = await layout(D.CHART_SLOPE_MEASURE)
    lay.increasing('y', 'F0', ['F1', 'F2'], 'F3', 'Q1', ['BAD', 'Q2'], ['SMALL', 'GOOD'], 'NEXT')
  })

  it('mc-gaps（MC 的三個差距）：判定式的 4·SE 與 0.25 和 mcAgreement 相同', async () => {
    const g = await parseFlow(D.CHART_MC_GAPS)
    expect(g.into('S').map((e) => e.from).sort()).toEqual(['G1', 'G2', 'G3', 'MF'])
    for (const e of g.into('S')) expect(e.text).toBe('＋')
    expect(g.node('G1').text).toContain("G''(w*)·Var(w) / (2·S)")
    expect(g.node('CHK').text).toContain(`4·SE + ①③ 的估計 + ${SERVO_SHAPE_FRACTION}·②`)
    const src = readFileSync(join(process.cwd(), 'src/simulation/models/bias.ts'), 'utf8')
    expect(src).toContain('stat: 4 * mc.se')
    const lay = await layout(D.CHART_MC_GAPS)
    lay.increasing('x', ['MF', 'G1', 'G2', 'G3'], 'S', 'MC', 'CHK', ['OKN', 'BAD'])
  })

  it('finite-step-loop：G_k = η − S·δw + ½G″·δw²、δw_(k+1) = δw_k + μ·G_k；pole 1 − g 與 Var(w) 和 finiteStepBias 一致', async () => {
    const g = await parseFlow(D.CHART_FINITE_STEP_LOOP)
    // 加法點 SG 的三個輸入：抽樣雜訊 ＋、恢復力 −、曲率 ＋
    expect(Object.fromEntries(g.into('SG').map((e) => [e.from, e.text]))).toEqual({ ETA: '＋', REST: '−', CURV: '＋' })
    expect(g.edge('SG', 'MU').text).toBe('G_k')
    // 累加器：δw_(k+1) = δw_k + μ·G_k，延遲 z⁻¹ 在 δw 的回授上
    expect(Object.fromEntries(g.into('ADD').map((e) => [e.from, e.text]))).toEqual({ MU: '＋ μ·G_k', DLY: '＋ δw_k' })
    expect(g.edge('ADD', 'DLY').text).toBe('δw_(k+1)')
    expect(g.node('DLY').text).toContain('z⁻¹')
    expect(g.edge('DLY', 'REST').text).toBe('δw_k')
    expect(g.edge('DLY', 'CURV').text).toBe('δw_k')
    expect(g.node('REST').text).toContain('× S')
    expect(g.node('CURV').text).toContain("½·G''(w*)·δw_k²")
    expect(g.node('POLE').text).toContain('δw_(k+1) = (1 − g)·δw_k + μ·η_k')
    expect(g.node('POLE').text).toContain('g = μ·S，pole = 1 − g')
    expect(g.node('SHIFT').text).toContain("E[δw] ≈ G''(w*)·Var(w) / (2·S)")
    expect(g.node('ETA').text).toContain('E[x²] / N')
    expect(g.node('REST').classes).toContain('focus')
    expect(g.node('CURV').classes).toContain('warn')
    // 模型（Sign-LMS、5-level、a = 1、c₃ = 0.1、σ_v = 1、μ = 0.0125、N = 64）：只留藍色那條負回授時 Var(w) = μ²E[x²]/(N·g·(2 − g))
    const fp = { model: { ...CUBIC, sigmaV: 1 }, code: { kind: 'five_level' as const }, algorithm: 'sign' as const, dcMode: 'none' as const, mu: 0.0125, N: 64 }
    const est = finiteStepBias(fp)
    expect(est.g).toBeCloseTo(fp.mu * est.slope, 12)
    const ex2 = codeMoments(five).Ex2
    let v = 0
    for (let k = 0; k < 20000; k++) v = (1 - est.g) ** 2 * v + (fp.mu * fp.mu * ex2) / fp.N // δw_(k+1) = (1 − g)δw_k + μη_k 的變異數遞迴
    expect(est.sdW ** 2).toBeCloseTo(v, 12)
    // 紅色那條：E[δw] = G″(w*)·Var(w)/(2S)；MSE-LMS 的 G 是直線，沒有曲率項
    const wStar = fixedPoint('sign', fp.model, five).w
    const h = 1e-3 * (1 + Math.abs(wStar))
    const curv = (meanGmacSign(wStar + h, fp.model, five) - 2 * meanGmacSign(wStar, fp.model, five) + meanGmacSign(wStar - h, fp.model, five)) / (h * h)
    expect(est.bias).toBeCloseTo((curv * v) / (2 * est.slope), 10)
    expect(finiteStepBias({ ...fp, algorithm: 'mse' }).bias).toBe(0)
    // 版面：全部是 block rate，由左到右：雜訊 → 加法點 → ×μ → 累加器 → 延遲
    const lay = await layout(D.CHART_FINITE_STEP_LOOP)
    lay.increasing('x', 'ETA', 'SG', 'MU', 'ADD', 'DLY')
  })

  it('verdict-tree／handcalc-flow（判斷樹與手算流程）：門檻 0.3、g = 0.02 與手算題、Lab 相同', async () => {
    const g = await parseFlow(D.CHART_VERDICT_TREE)
    expect(g.node('Q4').text).toContain(`≤ ${LINEAR_OK_RATIO}`)
    expect(g.node('Q1').text).toContain('S = K_q·C > 0')
    expect(g.edge('Q1', 'N1').text).toBe('否')
    expect(g.edge('Q2', 'OKN').text).toBe('是')
    expect(g.into('Q4').map((e) => e.from).sort()).toEqual(['B1', 'B2', 'B3'])
    expect(g.node('B1').text).toContain('b·E[x] / E[x²]')
    expect(g.node('B2').text).toContain('E[x·d] / E[x²]')
    expect(g.node('B3').text).toContain('w* = a + κ')
    const h = await parseFlow(D.CHART_HANDCALC_FLOW)
    expect(h.node('S5').text).toContain(`≤ ${LINEAR_OK_RATIO}`)
    // ①→②→③→④→⑤ 與 ①→⑥→⑦
    for (const [a, b] of [['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4'], ['S4', 'S5'], ['S1', 'S8'], ['S8', 'S9']]) expect(h.edge(a, b)).toBeTruthy()
    expect(h.into('S8').map((e) => e.from)).toEqual(['S1']) // S ≈ K_q·E[x²] 只用 ① 的動差與 σ_v，不需要 w*（HC-11.8）
    expect(h.edge('S1', 'S8').text).toBe('只用 E[x²]')
    const S = KQ_FACTOR * codeMoments(five).Ex2 // σ_v = 1
    expect(1 - autoMu(S) * S).toBeCloseTo(0.98, 12)
    expect(h.node('S9').text).toContain('g = 0.02 時平均 pole = 0.98')
    expect(h.node('S8').text).toContain('K_q = √(2/π) / σ_v')
    const layG = await layout(D.CHART_VERDICT_TREE)
    layG.increasing('y', 'R', 'Q1', 'Q2', 'Q3', ['B1', 'B2', 'B3'], 'Q4', ['L1', 'L2'])
    const layH = await layout(D.CHART_HANDCALC_FLOW)
    layH.increasing('y', 'S1', 'S2', 'S3', 'S4', 'S5', ['S6', 'S7'])
    layH.increasing('y', 'S1', 'S8', 'S9')
  })
})

describe('Ch11 方塊圖：頁面元件（真正的 mermaid）', () => {
  const wrap = (node: React.ReactNode) => (
    <SettingsProvider>
      <MemoryRouter initialEntries={['/ch/11']}>{node}</MemoryRouter>
    </SettingsProvider>
  )

  it('<Fig> 畫出 SVG、圖號與 KaTeX 圖說；aria-label 是純文字', async () => {
    const { container } = render(wrap(<Fig id="dc-null" />))
    const box = container.querySelector('#ch11-fig-dc-null') as HTMLElement
    expect(box).toBeTruthy()
    await waitFor(() => expect(box.querySelector('.c-mermaid-svg svg')).toBeTruthy())
    expect(box.querySelector('.c-callout')).toBeNull() // 沒有「Mermaid 圖解析失敗」
    expect(box.querySelector('figure')?.getAttribute('aria-label')).toBe(`${figLabel('dc-null')}：三種主迴路架構：\\varphi 由誰決定`)
    const cap = box.querySelector('.ch11-figcap') as HTMLElement
    expect(cap.textContent).toContain(figLabel('dc-null'))
    expect(cap.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
    expect(cap.textContent).not.toMatch(/\$/)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
  })

  it('開場段落：「這一課要回答的問題」之後緊接系統地圖（<SystemMap>），再來才是直覺與手算', async () => {
    const { container } = render(wrap(<IntroSection />))
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    // 系統地圖 + 圖 11-1 + 圖 11-2
    expect(figures).toHaveLength(3)
    const map = figures[0]
    expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
    for (const b of SYSTEM_MAP_FOCUS) expect(map.getAttribute('aria-label')).toContain(SYSTEM_BLOCK_LABEL[b])
    const question = container.querySelector('.c-callout') as HTMLElement
    expect(question.textContent).toContain('這一課要回答的問題')
    expect(question.nextElementSibling).toBe(map)
    const intuition = container.querySelector('#ch11-intuition') as HTMLElement
    expect(map.compareDocumentPosition(intuition) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 地圖後面有一句話說明藍色方塊與本章新增的內容
    expect(map.nextElementSibling?.textContent).toMatch(/藍色[\s\S]*這一課/)
    // 真的畫出來，而且藍色方塊數 = 本章標示的方塊數
    await waitFor(() => expect(map.querySelectorAll('g.node.focus').length).toBe(SYSTEM_MAP_FOCUS.length), { timeout: 60000 })
    await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg').length).toBe(3), { timeout: 60000 })
    expect(container.textContent).not.toContain('Mermaid 圖解析失敗')
    // 「誤差從哪裡進來」的導讀：先看加法點、再看右邊的 comparator／GMAC，並交代圖上的虛線（主 PLL 的 DC null）
    const diagramText = container.querySelector('#ch11-diagram')?.textContent ?? ''
    expect(diagramText).toMatch(/先看[\s\S]*中間的加法點[\s\S]*再看右邊/)
    expect(diagramText).toMatch(/虛線是主 PLL[\s\S]*BBPD[\s\S]*DC\s*null/)
    expect(container.querySelector('#ch11-fig-gmac-zero')?.closest('section')?.id).toBe('ch11-hand')
    expect(container.querySelector('#ch11-fig-error-sources')?.closest('section')?.id).toBe('ch11-diagram')
  })
})
