import { readFileSync, readdirSync } from 'node:fs'
import { wrapPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'
import { join } from 'node:path'
import { render, waitFor } from '@testing-library/react'
import mermaid from 'mermaid'
import { accessibleText, renderTex, stripMathDelimiters, systemMapModel, SYSTEM_BLOCK_LABEL } from '@/components'
import { mermaidMathDelimiters, sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import {
  KQ_FACTOR,
  LIN_RESIDUAL_LIMIT,
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
 *     這種錯誤 parser 抓不到；節點數不超過 14；原始碼本身就用全形「＋」（sanitizeMermaidSource 除了把含公式的標籤合併成單一
 *     `$$…$$` 之外，不需要改動它）；
 *  3. 圖裡面的數學都是 LaTeX（teaching-style §3）：標籤裡的公式都在 `$…$` 內並由 KaTeX 排版（每個含公式的標籤恰好畫成一段 KaTeX），
 *     畫出來的文字沒有殘留的 `$`，公式外沒有 Unicode 拼的數學；
 *  4. 內容：圖上的數字、正負號、延遲與取樣率和 bias.ts 的模型／正文公式一致（節點文字比對的是圖的 TeX 原始碼）。
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
  // 與網站相同的前處理與設定（含公式的標籤合併成 `$$…$$`、KaTeX 用 HTML 輸出），排出來的才是實際的圖
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, forceLegacyMathML: true })
  const { svg } = await mermaid.render(`ch11-layout-${++layoutSeq}`, sanitizeMermaidSource(chart))
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
  // 每條畫出來的連線（class flowchart-link；隱形連線 ~~~ 沒有這個 class）的控制點：path 的 d 屬性裡依序出現的座標。
  // 曲線一定落在控制點連成的折線附近，所以拿折線來數交叉；和節點位置一樣，座標不是實際像素，但「哪兩條線交叉」是可信的
  const edges = Array.from(host.querySelectorAll('path.flowchart-link')).map((p) => {
    const nums = ((p.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number)
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
    return { id: p.getAttribute('id') ?? '', pts }
  })
  return { at, increasing, positions: pos, edges }
}

/** 兩兩比較連線的折線，回傳交叉的那幾對（共用端點的兩條線不算：它們本來就會在節點相遇）。 */
function crossings(edges: { id: string; pts: { x: number; y: number }[] }[]): string[] {
  type Pt = { x: number; y: number }
  const side = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const cross = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => side(p3, p4, p1) * side(p3, p4, p2) < 0 && side(p1, p2, p3) * side(p1, p2, p4) < 0
  const ends = (id: string) => id.replace(/^L[_-]/, '').split(/[_-]/).slice(0, 2)
  const out: string[] = []
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = [edges[i], edges[j]]
      if (ends(a.id).some((n) => ends(b.id).includes(n))) continue
      let hit = false
      for (let s = 0; s + 1 < a.pts.length && !hit; s++)
        for (let t = 0; t + 1 < b.pts.length && !hit; t++) hit = cross(a.pts[s], a.pts[s + 1], b.pts[t], b.pts[t + 1])
      if (hit) out.push(`${a.id} × ${b.id}`)
    }
  return out
}

/** 圖上數字的寫法：負號用 U+2212；signed 時正數帶 '+'；0 不帶號（純文字標籤，例如連線上單獨的「−」） */
function fmt(v: number, digits = 2, signed = false): string {
  const r = Number(v.toFixed(digits))
  if (r === 0) return '0'
  const s = String(Math.abs(r))
  return r < 0 ? `−${s}` : signed ? `+${s}` : s
}

/** `$…$` 裡的數字：同 fmt，但負號是 TeX 的 ASCII '-' */
function tn(v: number, digits = 2, signed = false): string {
  return fmt(v, digits, signed).replace('−', '-')
}

/** 與 mathText／Mermaid 相同的行內公式切分規則 */
const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
/** 圖原始碼裡所有雙引號標籤：節點、連線、subgraph 標題 */
const labelsOf = (chart: string) => Array.from(chart.matchAll(/"([^"\n]*)"/g), (m) => m[1])
const hasMath = (label: string) => new RegExp(INLINE_MATH.source).test(label)
/** 去掉 `$…$` 與換行，剩下 KaTeX 以外的文字 */
const outsideMath = (label: string) => label.replace(INLINE_MATH, ' ').replace(/<br\s*\/?>/g, ' ')
/** 用 Unicode 拼數學時會出現的字元（希臘字母、上下標、關係與運算符號、combining accent） */
const UNICODE_MATH = /[\u0300-\u036fσμκεφρλθωΩΣΔπδηβ√²³⁴⁻¹₀₁₂₃ₖ≤≥≈≠≡∂∈∞·×÷±∓\u0177]/
/** 公式外單獨的拉丁字母（變數）；方塊圖上的編號 (A)(B)(C)、「架構 A」「世界 A」、公式編號 F-11.2、「S 形曲線」不算 */
const LONE_LETTER = /(?<![A-Za-z0-9])[A-Za-z](?![A-Za-z0-9])/

/**
 * Mermaid 實際會畫的 KaTeX 文字：標籤（含 `$…$`）→ mermaidMathDelimiters 合併後的單一 TeX → KaTeX 的 HTML 文字（去掉 MathML 複本）。
 * 用來核對「畫出來的標籤」就是這個標籤的 TeX 排版結果。
 */
function katexText(label: string): string {
  const merged = mermaidMathDelimiters(`"${label}"`)
  const tex = /^"\$\$([\s\S]*)\$\$"$/.exec(merged)?.[1]
  if (tex === undefined) throw new Error(`標籤沒有被合併成 $$…$$：${label}`)
  const host = document.createElement('div')
  host.innerHTML = renderTex(tex, true)
  expectNoTexErrors(host, `KaTeX 無法解析：${label}`)
  host.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  return host.textContent ?? ''
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

  it('圖上的標籤（節點、連線、subgraph 標題）：數學都在 $…$ 內且能被 KaTeX 解析，公式外沒有 Unicode 拼的數學或單獨的變數字母', () => {
    const bad: string[] = []
    let mathLabels = 0
    for (const d of CHARTS) {
      const labels = labelsOf(d.chart)
      expect(labels.length, d.name).toBeGreaterThanOrEqual(5)
      for (const label of labels) {
        const where = `${d.name} 「${label}」`
        if ((label.replace(/\\\$/g, '').match(/\$/g) ?? []).length % 2) bad.push(`${where}：$ 不成對`)
        if (hasMath(label)) mathLabels++
        for (const mm of label.matchAll(INLINE_MATH)) {
          if (/katex-error|c-tex-error/.test(renderTex(mm[1], false))) bad.push(`${where}：KaTeX 無法解析 ${mm[1]}`)
          if (mm[1].includes('−')) bad.push(`${where}：公式內的減號要寫 ASCII '-'，不是 U+2212 —— ${mm[1]}`)
          if (/[<&]/.test(mm[1])) bad.push(`${where}：公式內的 < 或 & 會被當成 HTML —— ${mm[1]}`)
          if (UNICODE_MATH.test(mm[1])) bad.push(`${where}：公式內也不用 Unicode 符號，寫成 TeX 指令 —— ${mm[1]}`)
        }
        const rest = outsideMath(label)
        const uni = unicodeMathIn(rest)
        if (uni.length || UNICODE_MATH.test(rest)) bad.push(`${where}：公式外有 Unicode 拼的數學 —— ${[...uni, rest.match(UNICODE_MATH)?.[0] ?? ''].join(' ')}`)
        if (/[_^]/.test(rest)) bad.push(`${where}：公式外有 _ 或 ^`)
        // 純粹的正負號標籤（連線上的「−」「＋」）以外，U+2212 只出現在 $…$ 之外是不對的
        if (rest.includes('−') && rest.trim() !== '−') bad.push(`${where}：公式外的減號要放進 $…$`)
        const words = rest.replace(/\([ABC]\)|架構 [ABC]|世界 [AB]|F-\d+\.\d+|S 形/g, ' ')
        if (LONE_LETTER.test(words)) bad.push(`${where}：公式外有單獨的變數字母 ${words.match(LONE_LETTER)?.[0]}`)
      }
    }
    expect(bad).toEqual([])
    expect(mathLabels).toBeGreaterThan(250) // 25 張圖幾乎每個標籤都含公式
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
    // δ 的極性：gain 誤差一律寫成 (a - w)，不寫 (w - a)
    expect(d.chart).not.toMatch(/\(w(_k)?\s*[-−]\s*a\)/)
    // 公式外不用 ASCII 的 '-' 當減號（會和 Markdown list 混淆，也和正文的 − 不一致）；公式內照 TeX 寫 '-'
    for (const n of g.nodes.values()) expect(outsideMath(n.text).replace(/圖 \d+-\d+|F-\d+\.\d+/g, ''), d.name).not.toMatch(/\d\s*-\s*\d|[a-z)]\s-\s[a-z(]/)
    // 原始碼的純文字標籤本來就寫全形「＋」與「−」（U+2212）：共用的 sanitizeMermaidSource 除了把含公式的標籤合併成單一 `$$…$$`，不需要幫它改任何字
    expect(sanitizeMermaidSource(d.chart), `${d.name} 含有會被當成 Markdown list 的標籤`).toBe(mermaidMathDelimiters(d.chart))
  })

  it.each(CHARTS.map((d, i) => [`圖 11-${i + 1}`, d.name, d] as const))('%s %s：真的畫得出來，標籤沒有被 Markdown 吃掉，公式都由 KaTeX 排版', async (_label, name, d) => {
    const g = await parseFlow(d.chart)
    const { svg, text, nodeCount, mathCount, plainText } = await renderMermaidForTest(d.chart)
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(svg).not.toContain('Unsupported markdown')
    // 畫出來的文字沒有殘留 `$`，KaTeX 以外的文字也沒有 Unicode 拼的數學
    expect(text, `${name} 畫出來的文字殘留了 $`).not.toContain('$')
    expect(unicodeMathIn(plainText), `${name} KaTeX 以外還有 Unicode 拼的數學`).toEqual([])
    expect(nodeCount).toBeLessThanOrEqual(14) // subgraph 的標題不算節點
    expect(nodeCount).toBe(g.nodes.size)
    // 每個含 `$…$` 的標籤（節點、連線、subgraph 標題）恰好畫成一段 KaTeX
    const labels = labelsOf(d.chart)
    expect(mathCount, `${name} 含公式的標籤數`).toBe(labels.filter(hasMath).length)
    expect(mathCount).toBeGreaterThanOrEqual(4)
    const host = document.createElement('div')
    host.innerHTML = svg
    expectNoTexErrors(host)
    expect(host.querySelectorAll('em, strong, a, ul, ol, h1, h2, blockquote, code, del').length).toBe(0)
    host.querySelectorAll('.katex-mathml').forEach((e) => e.remove()) // 只比對 HTML 排版的那一份文字
    const norm = (t: string) => t.replace(/\s+/g, '')
    const drawn = new Set(Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel'), (el) => norm(el.textContent ?? '')))
    // 每個節點、每條有標籤的連線、每個 subgraph 標題：純文字標籤畫出來的文字和原始碼一字不差；
    // 含公式的標籤畫出來的就是它的 TeX 排版結果（文字部分在 \text{…} 裡，公式在 KaTeX 裡）
    for (const label of labels) {
      const expected = hasMath(label) ? katexText(label) : plain(label)
      expect(drawn.has(norm(expected)), `${name} 標籤：${label}`).toBe(true)
    }
    // classDef 真的套到節點上
    const classed = [...g.nodes.values()].filter((n) => n.classes.some((c) => ['focus', 'warn', 'ok'].includes(c))).length
    expect(host.querySelectorAll('g.node.focus, g.node.warn, g.node.ok').length).toBe(classed)
  })

  it('桌機版面：橫向（LR）的圖最多 5 個 rank，由上往下的圖每一排最多 5 個方塊 —— 太長的橫向流程要改成直向或折成列（teaching-style §8）', async () => {
    // jsdom 量不到真正的像素寬度，但 dagre 的 rank 數與「同一排有幾個方塊」不受字體影響；
    // 以 diagram-audit 的結果為準：7 個 rank 以上的橫向流程在 1280px 桌機上會超出正文欄（error-sources、jitter-weight、near-integer-check、mc-gaps、finite-step-loop 就是這樣被改成直向的）
    const cluster = (values: number[], tol = 1.5) => {
      const groups: number[][] = []
      for (const v of [...values].sort((a, b) => a - b)) {
        const g = groups.find((x) => Math.abs(x[0] - v) <= tol)
        if (g) g.push(v)
        else groups.push([v])
      }
      return groups
    }
    const bad: string[] = []
    for (const d of CHARTS) {
      const lay = await layout(d.chart)
      const pts = [...lay.positions.values()]
      if (/^flowchart LR/.test(d.chart)) {
        const ranks = cluster(pts.map((p) => p.x)).length
        if (ranks > 5) bad.push(`${d.name}：LR 有 ${ranks} 個 rank，桌機放不下，請改成 TB 或折成列`)
      } else {
        const widest = Math.max(...cluster(pts.map((p) => p.y)).map((g) => g.length))
        if (widest > 5) bad.push(`${d.name}：同一排有 ${widest} 個方塊，桌機放不下，請拆成兩排`)
      }
    }
    expect(bad).toEqual([])
    // 這次改成直向的圖：頁面上每一張的流程方向都寫在原始碼第一行
    for (const id of ['gmac-zero', 'error-sources', 'best-fit', 'identifiability', 'jitter-weight', 'near-integer-check', 'mc-gaps', 'finite-step-loop'] as const) {
      expect(CHARTS.find((d) => d.id === id)?.chart, id).toMatch(/^flowchart TB/)
    }
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

  it('章首系統地圖：本章標示的藍色方塊（systemMapModel 的 focused）就是 SYSTEM_MAP_FOCUS，每個都是地圖上有名稱、有接線的方塊', () => {
    // 系統地圖是手排的 SVG（不經過 Mermaid），所以用 pure-data 的 systemMapModel 核對主角
    expect(SYSTEM_MAP_FOCUS).toEqual(['dtc', 'pd', 'noise', 'cmp', 'gmac', 'acc'])
    const model = systemMapModel(SYSTEM_MAP_FOCUS)
    expect(model.blocks.filter((b) => b.focused).map((b) => b.id).sort()).toEqual([...SYSTEM_MAP_FOCUS].sort())
    expect(model.blocks.filter((b) => !b.focused).length).toBe(model.blocks.length - SYSTEM_MAP_FOCUS.length)
    for (const id of SYSTEM_MAP_FOCUS) {
      expect(SYSTEM_BLOCK_LABEL[id], id).toBeTruthy()
      expect(model.wires.some((w) => w.from === id || w.to === id), `${id} 沒有接線`).toBe(true)
    }
  })
})

describe('Ch11 方塊圖：和模型／公式一致', () => {
  // 節點與連線的文字比對的是圖的 TeX 原始碼（`$…$`）；數字用 tn()（TeX 的 ASCII 負號）寫出來
  it('gmac-zero（手算流程）：w = 1.34 時五個 code 的 e 與 x·e 來自 eDet，平均為 0', async () => {
    const g = await parseFlow(D.CHART_GMAC_ZERO)
    const ids: Record<number, string> = { [-2]: 'M2', [-1]: 'M1', 0: 'Z0', 1: 'P1', 2: 'P2' }
    for (const x of five.values) {
      const e = eDet(x, 1.34, CUBIC)
      expect(g.node(ids[x]).text).toBe(
        [String.raw`$x = ${tn(x, 0, true)}$：$e = ${tn(e, 2, true)}$`, String.raw`$x \cdot e = ${tn(x * e, 2, true)}$`].join('\n'),
      )
      expect(g.edge('W', ids[x])).toBeTruthy()
      expect(g.edge(ids[x], 'AVG')).toBeTruthy()
    }
    expect(g.node('W').text).toContain(String.raw`$= ${tn(1 - 1.34)} \cdot x + ${tn(CUBIC.c3, 1)} \cdot x^3$`)
    expect(g.node('AVG').text).toContain(String.raw`$E[x \cdot e] = (0.24 - 0.24 + 0 - 0.24 + 0.24) / 5$`)
    expect(Math.abs(meanGmacMse(1.34, CUBIC, five))).toBeLessThan(1e-12)
    expect(mseFixedPoint(CUBIC, five)).toBeCloseTo(1.34, 12)
    // 「四個 code 的 e 都不是 0」
    expect(five.values.filter((x) => Math.abs(eDet(x, 1.34, CUBIC)) > 0.1)).toHaveLength(4)
    expect(g.node('LEFT').text).toContain(String.raw`$\pm 0.24$ 與 $\pm 0.12$`)
    // 審查 C04：第五個 code（x = 0）的殘差是 0，而且不論 w 是多少都是 0 —— 正文不能寫「沒有一個是 0」
    for (const w of [-3, 0, 1, 1.34, 1.4, 7]) expect(Math.abs(eDet(0, w, CUBIC))).toBe(0)
    expect(five.values.filter((x) => eDet(x, mseFixedPoint(CUBIC, five), CUBIC) === 0)).toEqual([0])
    expect(g.node('Z0').text).toContain('$e = 0$')
    expect(g.node('LEFT').text).toContain('四個 code')
    // 圖說「由上到下」：w → 五個 code → 平均 → 結論；中間那一排的五個 code 由左到右依 x = −2 … +2 排列
    const lay = await layout(D.CHART_GMAC_ZERO)
    lay.increasing('y', 'W', ['M2', 'M1', 'Z0', 'P1', 'P2'], 'AVG', ['ZERO', 'LEFT'])
    lay.increasing('x', 'M2', 'M1', 'Z0', 'P1', 'P2')
  })

  it('error-sources（硬體視角）：Reference → DTC → PD → loop filter／VCO → divider → PD；PD 的輸出 e[n] 同時給 loop filter 與 comparator；w ← w + μ·G', async () => {
    const g = await parseFlow(D.CHART_ERROR_SOURCES)
    // 隱形連線（~~~）只用來排版，不是訊號：下面所有接線的檢查都不看它
    const INVISIBLE = /^\s*E ~~~ DSM$/m
    expect(D.CHART_ERROR_SOURCES).toMatch(INVISIBLE)
    expect(D.CHART_ERROR_SOURCES.match(/~~~/g)).toHaveLength(1)
    const wires = g.edges.filter((e) => !(e.from === 'E' && e.to === 'DSM'))
    expect(wires).toHaveLength(g.edges.length - 1)
    const has = (from: string, to: string) => wires.some((e) => e.from === from && e.to === to)
    const into = (id: string) => wires.filter((e) => e.to === id)
    const outOf = (id: string) => wires.filter((e) => e.from === id)
    // ── 全站約定（docs/assumptions.md §2a）：DTC 在 reference 的輸入端，回授路徑上只有 divider ──
    expect(g.node('REF').text).toBe('Reference clock')
    expect(has('REF', 'DTC')).toBe(true)
    expect(has('DTC', 'PD')).toBe(true)
    expect(has('DIV', 'PD')).toBe(true)
    expect(has('DIV', 'DTC')).toBe(false) // 沒有 divider → DTC 這條線
    expect(has('REF', 'PD')).toBe(false) // reference 不會繞過 DTC 直接進 PD
    expect(into('DTC').map((e) => e.from).sort()).toEqual(['GC', 'REF']) // DTC 的輸入只有 reference 與 gain correction
    expect(outOf('DTC').map((e) => e.to)).toEqual(['PD']) // DTC 的輸出只進 PD
    expect(outOf('REF').map((e) => e.to)).toEqual(['DTC'])
    // 主迴路：PD 的輸出 → loop filter／VCO → divider → PD。loop filter 的輸出只進 divider（不會繞過 divider 直接回 PD），divider 的輸出只進 PD
    expect(g.node('LF').text).toBe('主 PLL loop filter 與 VCO\n（積分路徑：DC null）')
    expect(outOf('LF').map((e) => e.to)).toEqual(['DIV'])
    expect(has('LF', 'PD')).toBe(false)
    expect(outOf('DIV').map((e) => e.to)).toEqual(['PD'])
    // divider 的輸入：VCO 的輸出（主迴路）與 DSM 的 carry（小數除頻）
    expect(Object.fromEntries(into('DIV').map((e) => [e.from, e.text]))).toEqual({
      LF: String.raw`VCO 輸出：feedback edge 再早到 $\varphi$`,
      DSM: 'carry',
    })
    // DSM：carry → divider、餘數 x → gain correction、同一個 x 當 GMAC 的 regressor
    expect(Object.fromEntries(outOf('DSM').map((e) => [e.to, e.text]))).toEqual({ DIV: 'carry', GC: '餘數 $x[n]$', GMAC: '當 regressor' })
    expect(into('DSM')).toEqual([])
    expect(into('GC').map((e) => e.from).sort()).toEqual(['DSM', 'UPD']) // 補償量 = w × 餘數
    expect(g.node('GC').text).toBe('gain correction\n補償量 $w \\cdot x$')
    // reference 端的 DTC 只能延遲：從基準延遲 T_0 往回扣補償量 w·x，INL d(x) 是延遲偏離直線的量；feedback edge 早到 a·x
    expect(g.node('DTC').text).toBe('reference 端的 DTC\n' + String.raw`$t_\mathrm{ref}' = T_0 - w \cdot x + d(x)$`)
    expect(g.node('DIV').text).toBe('Divider\nfeedback edge 早到\n' + String.raw`$t_\mathrm{fb} = -a \cdot x$`)
    expect(D.CHART_ERROR_SOURCES).not.toMatch(/DTC 的 delay|校正電路的/)
    // PD 是減法點（reference 減 feedback），其餘來源（b、ε_cc、v）都是 ＋；主迴路的修正 φ 走 divider 那條線（feedback edge 再早到 φ ⇒ e 多一項 ＋φ）
    expect(Object.fromEntries(into('PD').map((e) => [e.from, e.text]))).toEqual({
      DTC: String.raw`＋ $t_\mathrm{ref}'$`,
      DIV: String.raw`$-\ t_\mathrm{fb}$`, // 減號寫在公式裡（U+2212 放在 \text 裡 KaTeX 會警告）
      B: '＋',
      ECC: '＋',
      V: '＋',
    })
    expect(g.node('PD').text).toBe('PD')
    // ── LMS 校正迴路的輸入是 PD 的輸出 e[n]：同一個節點 E 分給 loop filter 與 1-bit comparator ──
    expect(g.node('E').text).toBe('PD 的輸出 $e[n]$')
    expect(into('E').map((e) => e.from)).toEqual(['PD'])
    expect(outOf('PD').map((e) => e.to)).toEqual(['E'])
    expect(into('Q').map((e) => `${e.from}:${e.text}`)).toEqual(['E:給 LMS 校正迴路']) // comparator 的輸入只來自 PD 的輸出
    expect(into('LF').map((e) => `${e.from}:${e.text}`)).toEqual(['E:給主迴路'])
    expect(outOf('E').map((e) => e.to).sort()).toEqual(['LF', 'Q'])
    expect(g.node('Q').text).toContain(String.raw`$q = \operatorname{sign}(e)$`)
    expect(has('DTC', 'Q') || has('DIV', 'Q') || has('DTC', 'GMAC') || has('DIV', 'GMAC')).toBe(false)
    // GMAC：q 與 x（regressor）相關，G 去改 w（每 N 個 sample 一次），w 回到 gain correction
    expect(into('GMAC').map((e) => e.from).sort()).toEqual(['DSM', 'Q'])
    expect(g.edge('Q', 'GMAC').text).toBe('$q[n]$')
    expect(g.node('GMAC').text).toContain(String.raw`$G = (1/N) \cdot \sum q \cdot x$`)
    expect(g.edge('GMAC', 'UPD').text).toBe('$G$')
    expect(g.node('UPD').text).toContain(String.raw`$w \leftarrow w + \mu \cdot G$`)
    expect(g.node('UPD').text).toContain('每 $N$ 個 sample')
    expect(g.edge('UPD', 'GC').text).toBe('$w$')
    // 模型：PD 量的是 t_ref′ − t_fb = (T_0 − w·x + d(x)) − (−a·x)；去掉常數 T_0、加上 b 與 ε_cc 就是 F-11.1 的 e_det
    const m = model({ b: 0.3, c2: 0.05, c3: 0.1, kappa: 0.02 })
    const x = 1.7
    const w = 0.8
    const T0 = 37 // 任意的基準延遲：不影響誤差
    const tRef = T0 - w * x + (m.c2 * x * x + m.c3 * x ** 3)
    const tFb = -m.a * x
    expect(tRef - tFb - T0 + m.b + m.kappa * x).toBeCloseTo(eDet(x, w, m), 12)
    expect(tRef - tFb - T0).toBeCloseTo((m.a - w) * x + m.c2 * x * x + m.c3 * x ** 3, 12) // 補償不足（w < a）時誤差為正
    expect(tRef - tFb - T0).toBeGreaterThan(0)
    // 主迴路的修正：feedback edge 再早到 φ（t_fb = −a·x − φ）⇒ e 多一項 ＋φ，就是 §11.1 的 q = sign(e_det + φ + v)
    const phi = -0.21
    expect(tRef - (tFb - phi) - T0 + m.b + m.kappa * x).toBeCloseTo(eDet(x, w, m) + phi, 12)
    // 版面（由上往下）：(reference、gain correction) → (DTC 與其他來源) → PD → PD 的輸出 → (comparator、loop filter／VCO、DSM) → divider → GMAC → 更新。
    // 迴圈 GC → DTC → PD → E → Q → GMAC → UPD → GC 要由 GC 開頭宣告，Mermaid 才會把「UPD → GC」當成回授線；
    // 主迴路 PD → E → LF → DIV → PD 的回授線是 DIV → PD：divider 排在 loop filter 的下面
    expect(D.CHART_ERROR_SOURCES).toMatch(/^flowchart TB\n {2}GC\[/)
    expect(D.CHART_ERROR_SOURCES).toMatch(/^\s*Q -- "\$q\[n\]\$" ---> GMAC$/m) // 多佔一排：GMAC 排在 divider 下面
    const lay = await layout(D.CHART_ERROR_SOURCES)
    const above = (upper: string, lower: string) => expect(lay.at(lower).y, `${upper} 應在 ${lower} 的上面`).toBeGreaterThan(lay.at(upper).y)
    above('REF', 'DTC')
    above('GC', 'DTC')
    for (const id of ['DTC', 'B', 'ECC', 'V']) above(id, 'PD')
    above('PD', 'E')
    above('E', 'Q')
    above('E', 'LF')
    above('E', 'DSM')
    above('LF', 'DIV')
    above('DSM', 'DIV')
    above('DIV', 'GMAC')
    above('Q', 'GMAC')
    above('GMAC', 'UPD')
    // 由左到右：其他來源（b、ε_cc、v）→ DTC；comparator → loop filter → DSM；GMAC → divider。照這個順序排，所有連線都不交叉
    lay.increasing('x', 'B', 'ECC', 'V', 'DTC')
    lay.increasing('x', 'REF', 'GC')
    lay.increasing('x', 'Q', 'LF', 'DSM')
    lay.increasing('x', 'GMAC', 'DIV')
    expect(lay.edges).toHaveLength(wires.length) // 17 條畫出來的線都量到了（隱形連線不在內）
    expect(crossings(lay.edges), 'error-sources 的連線不應交叉').toEqual([])
    // 兩個排版用的寫法缺一不可（也順便確認上面的「不交叉」不是因為量不到）：拿掉隱形連線，或把 Q → GMAC 改回一般長度，連線就會交叉
    const noHint = await layout(D.CHART_ERROR_SOURCES.replace(/^\s*E ~~~ DSM\n/m, ''))
    expect(crossings(noHint.edges).length).toBeGreaterThan(0)
    const shortLink = await layout(D.CHART_ERROR_SOURCES.replace('---> GMAC', '--> GMAC'))
    expect(crossings(shortLink.edges).length).toBeGreaterThan(0)
  })

  it('error-budget（誤差預算）：五項都以「＋」進加法點，和 F-11.1 的五項一一對應', async () => {
    const g = await parseFlow(D.CHART_ERROR_BUDGET)
    const into = g.into('SUM')
    expect(into.map((e) => e.from).sort()).toEqual(['ECC', 'GAIN', 'INL', 'OFF', 'V'])
    for (const e of into) expect(e.text, e.from).toBe('＋')
    expect(g.node('GAIN').text).toContain(String.raw`$(a - w) \cdot x[n]$`)
    expect(g.node('INL').text).toContain(String.raw`$d(x) = c_2 \cdot x^2 + c_3 \cdot x^3$`)
    expect(g.node('ECC').text).toContain(String.raw`$\varepsilon_{cc}[n] = \kappa \cdot x[n]$`)
    expect(g.edge('SUM', 'CMP').text).toBe('$e[n]$')
    expect(g.node('CMP').text).toContain(String.raw`$q[n] = \operatorname{sign}(e[n])$`)
    expect(g.node('GMAC').text).toContain(String.raw`$G_k = (1/N) \cdot \sum q[n] \cdot x[n]$`)
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
    expect(into.map((e) => `${e.from}:${e.text}`).sort()).toEqual([String.raw`DLY:＋ $w_k$`, String.raw`MU:＋ $\mu \cdot G_k$`])
    expect(g.edge('ADD', 'DLY').text).toBe('$w_{k+1}$')
    expect(g.node('MU').text).toBe(String.raw`$\times \mu$`)
    expect(g.node('DLY').text).toContain('$z^{-1}$')
    expect(g.node('ERR').text).toContain(String.raw`(a - w_k) \cdot x[n]`)
    expect(g.node('ERR').text).toContain(`（${figLabel('error-budget')}）`) // 圖上引用的圖號沒有過期
    expect(g.edge('ERR', 'CMP').text).toBe('$e[n]$')
    expect(g.edge('AVG', 'MU').text).toBe('$G_k$')
    // 相關器：q 與 x 相乘（sample rate），N 個一組送到 block rate 取平均
    expect(g.into('MUL').map((e) => e.from).sort()).toEqual(['CMP', 'X'])
    expect(g.node('MUL').text).toBe(String.raw`$\times$`)
    expect(g.node('AVG').text).toContain(String.raw`$G_k = (1/N) \cdot \sum q[n] \cdot x[n]$`)
    // 兩種速率各自一個 subgraph；跨速率的兩條線：乘積往下、w_k 往上回授
    const fast = g.subgraphs.find((x) => x.id === 'FAST')
    const slow = g.subgraphs.find((x) => x.id === 'SLOW')
    expect(fast?.title).toContain('每個 sample $n$')
    expect(slow?.title).toContain('每個 block $k$')
    expect([...(fast?.nodes ?? [])].sort()).toEqual(['CMP', 'ERR', 'MUL', 'X'])
    expect([...(slow?.nodes ?? [])].sort()).toEqual(['ADD', 'AVG', 'DLY', 'MU'])
    expect(g.edge('FAST', 'SLOW').text).toContain(String.raw`$q[n] \cdot x[n]$`)
    expect(g.edge('SLOW', 'FAST').text).toMatch(/^\$w_k\$ 回授/)
    // 版面：sample 那一列在上、block 那一列在下；每一列都是由左到右
    const lay = await layout(D.CHART_LMS_LOOP)
    lay.increasing('y', ['X', 'ERR', 'CMP', 'MUL'], ['AVG', 'MU', 'ADD', 'DLY'])
    lay.increasing('x', 'X', 'ERR', 'CMP', 'MUL')
    lay.increasing('x', 'AVG', 'MU', 'ADD', 'DLY')
  })

  it('mse-vs-sign（MSE vs Sign）：大雜訊的出口回到 MSE 的封閉解，σ_v = 0 的出口是 |x| 加權中位數', async () => {
    const g = await parseFlow(D.CHART_MSE_VS_SIGN)
    expect(g.edge('GS', 'FM').text).toContain(String.raw`$\operatorname{erf} \approx K_q \cdot e_\mathrm{det}$`)
    expect(g.edge('GS', 'FMED').text).toContain(String.raw`$\sigma_v = 0$`)
    expect(g.node('ERF').text).toContain(String.raw`$E[q \mid x] = \operatorname{erf}(e_\mathrm{det} / (\sqrt{2} \cdot \sigma_v))$`)
    expect(g.node('FM').text).toContain(String.raw`$w^* = a + (b \cdot E[x] + E[x \cdot d] + E[x \cdot \varepsilon_{cc}]) / E[x^2]$`)
    expect(g.node('FMED').text).toContain('$|x|$ 加權中位數')
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
    expect(g.edge('R1', 'R3').text).toBe('$e[n]$')
    expect(g.node('R3').text).toContain(String.raw`$\operatorname{sign}(\cdot)$`)
    expect(g.edge('R3', 'R4').text).toBe(String.raw`$q[n] = \pm 1$`)
    expect(g.node('R4').text).toContain('$G_k$')
    // ② 對 v 平均 → erf（F-11.2，精確）
    expect(g.node('M1').text).toContain(String.raw`$\operatorname{erf}(e_\mathrm{det} / (\sqrt{2} \cdot \sigma_v))$`)
    expect(g.edge('M1', 'M2').text).toBe(String.raw`$E[q \mid x]$`)
    expect(g.node('M3').text).toContain(String.raw`$E[G] = E[x \cdot \operatorname{erf}(e_\mathrm{det} / (\sqrt{2} \cdot \sigma_v))]$`)
    // ③ 線性化 → K_q（F-11.3，近似）
    expect(g.node('L1').text).toContain(String.raw`$K_q = \sqrt{2/\pi} / \sigma_v$`)
    expect(g.edge('L1', 'L2').text).toBe(String.raw`$K_q \cdot e_\mathrm{det}$`)
    expect(g.node('L3').text).toContain(String.raw`$E[G] \approx K_q \cdot E[x \cdot e]$`)
    expect(g.edge('MEAN', 'LIN').text).toContain(String.raw`$|e_\mathrm{det}|$ 都遠小於 $\sigma_v$`)
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
    expect(g.node('C1').text).toBe(String.raw`$(a - w) \cdot E[x^2]$`)
    expect(g.node('C2').text).toBe(String.raw`$b \cdot E[x]$`)
    expect(g.node('C5').text).toBe(String.raw`$E[x \cdot v] = 0$`)
    expect(g.node('FP').text).toContain(String.raw`$w^* = a + (b \cdot E[x] + E[x \cdot d] + E[x \cdot \varepsilon_{cc}]) / E[x^2]$`)
    expect(g.subgraphs.map((s) => s.title)).toEqual(expect.arrayContaining(['$e[n]$ 的五項', '各自乘上 $x$ 再取平均']))
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
    expect(g.node('X').text).toContain(String.raw`$E[x] = 1/2$，$E[x^2] = 1/3$`)
    expect(g.node('OFF').text).toContain(`$b = ${fmt(b, 1)}$`)
    expect(g.node('AVG').text).toContain(String.raw`$b \cdot E[x] = ${fmt(b * mo.Ex)}$`)
    expect(g.node('BIAS').text).toContain(String.raw`多調 $${fmt(b * mo.Ex)} \div (1/3) = ${fmt(mseFixedPoint(model({ b }), u) - 1)}$`)
    expect(g.node('BIAS').text).toContain(String.raw`$w^* - a = b \cdot E[x] / E[x^2]$`)
    // 置中後 offset 項為 0
    expect(mseFixedPoint(model({ b }), five)).toBeCloseTo(1, 12)
    expect(g.edge('AVG', 'ZERO').text).toBe('若 code 置中')
    expect(g.node('ZERO').text).toContain(String.raw`$E[x] = 0$，所以 $b \cdot E[x] = 0$`)
    const lay = await layout(D.CHART_OFFSET_PATH)
    lay.increasing('x', ['OFF', 'X'], 'MUL', 'AVG', ['BIAS', 'ZERO'])
  })

  it('dc-null（三種架構）：積分路徑的極性與輸入、三個固定點公式都和模型一致', async () => {
    const g = await parseFlow(D.CHART_DC_NULL)
    expect(g.subgraphs).toHaveLength(3)
    expect(g.subgraphs.map((s) => s.title)).toEqual(
      expect.arrayContaining([String.raw`(A) none：主迴路不碰 comparator 的 DC，$\varphi = 0$`, String.raw`(B) shared BBPD：積分路徑強制 $E[q] = 0$`]),
    )
    // 版面：三種架構由上到下依序是 (A)(B)(C)，每個框內由左到右
    const lay = await layout(D.CHART_DC_NULL)
    lay.increasing('y', ['A0', 'A1', 'A2'], ['B0', 'B1', 'B2', 'B3', 'B4'], ['C0', 'C1', 'C2', 'C3', 'C4'])
    lay.increasing('x', 'A0', 'A1', 'A2')
    lay.increasing('x', 'B0', 'B1', 'B2', ['B3', 'B4'])
    lay.increasing('x', 'C0', 'C1', ['C2', 'C4'], 'C3')
    // (A) 沒有回授
    expect(g.into('A0')).toHaveLength(0)
    // (B) φ ← φ − k_φ·q，以「＋ φ」加回 comparator 輸入
    expect(g.node('B4').text).toContain(String.raw`$\varphi \leftarrow \varphi - k_\varphi \cdot q$`)
    expect(g.edge('B2', 'B4').text).toBe('$q$')
    expect(g.edge('B4', 'B1').text).toBe(String.raw`＋ $\varphi$`)
    expect(g.node('B2').text).toContain(String.raw`$q = \operatorname{sign}(e_\mathrm{det} + \varphi + v)$`)
    // (C) 線性 PD 看不到 comparator 的 b；積分的是 e_PD；comparator 再加上自己的 b
    expect(g.node('C0').text).toBe(String.raw`$e_\mathrm{det} - b$`)
    expect(g.node('C4').text).toContain(String.raw`$\varphi \leftarrow \varphi - k_\varphi \cdot e_\mathrm{PD}$`)
    expect(g.edge('C1', 'C4').text).toBe(String.raw`$e_\mathrm{PD}$`)
    expect(g.edge('C4', 'C1').text).toBe(String.raw`＋ $\varphi$`)
    expect(g.node('C2').text).toContain(String.raw`$q = \operatorname{sign}(e_\mathrm{PD} + b + v)$`)
    // 三個節點上的公式（照圖上的式子重算）= bias.ts 的 linearizedFixedPoint
    const m = model({ b: 0.5, c2: 0.05, c3: 0.1, kappa: 0.02 })
    const mo = codeMoments(u4)
    const f = (x: number) => m.c2 * x * x + m.c3 * x ** 3 + m.kappa * x // d + ε_cc
    const Exf = expectation(u4, (x) => x * f(x))
    const cov = Exf - mo.Ex * expectation(u4, f)
    expect(g.node('A2').text).toContain(String.raw`$w^* - a = (b \cdot E[x] + E[x \cdot d] + E[x \cdot \varepsilon_{cc}]) / E[x^2]$`)
    expect(g.node('B3').text).toContain(String.raw`$w^* - a \approx \operatorname{Cov}(x, d + \varepsilon_{cc}) / \operatorname{Var}(x)$`)
    expect(g.node('C3').text).toContain(String.raw`$w^* - a \approx (b \cdot E[x] + \operatorname{Cov}(x, d + \varepsilon_{cc})) / \operatorname{Var}(x)$`)
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
    expect(g.node('R0').text).toContain(String.raw`$e_\mathrm{det}(x; w) + \bar\varphi$`)
    expect(g.node('R1').text).toContain(String.raw`$\tilde\varphi[n]$`)
    expect(g.node('R1').text).toContain(String.raw`$\sigma_\varphi^2$`)
    expect(g.node('R2').text).toContain(String.raw`$\sigma_v^2$`)
    expect(g.node('Q1').text).toContain(String.raw`$\sigma_\mathrm{eff}^2 = \sigma_v^2 + \sigma_\varphi^2$`)
    expect(g.node('Q3').text).toContain(String.raw`$E[q \mid x] \approx \operatorname{erf}((e_\mathrm{det} + \bar\varphi) / (\sqrt{2} \cdot \sigma_\mathrm{eff}))$`)
    expect(g.edge('REAL', 'EQUIV').text).toContain('變異數相加')
    const lay = await layout(D.CHART_SERVO_DITHER)
    lay.increasing('y', ['R0', 'R1', 'R2', 'R3', 'R4'], ['Q0', 'Q1', 'Q2', 'Q3'])
  })

  it('centering-tree（centering 判斷樹）：四個問題、三個紅色出口，和模型的行為一致', async () => {
    const g = await parseFlow(D.CHART_CENTERING_TREE)
    expect(g.edge('Q1', 'N1').text).toBe('否')
    expect(g.node('Q1').text).toContain('$E[x] = 0$')
    expect(g.edge('Q2', 'N2').text).toContain(String.raw`$\sigma_v = 0$`)
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
    expect(g.node('OFF').text).toContain(`$b = ${fmt(jit.b, 1)}$`)
    expect(g.node('OFF').text).toContain(String.raw`$x \cdot b$：$${five.values.map((x) => tn(x * jit.b, 1, true)).join(',\\ ')}$`)
    expect(g.node('KV').text).toContain(String.raw`權重 $1/\sigma_v(x)$：$${five.values.map((x) => fmt(1 / sigmaAt(x, jit), 3)).join(',\\ ')}$`)
    // 常數 σ_v：b·E[x] = 0；σ_v(x)：b·E[x/σ_v] ≠ 0
    expect(codeMoments(five).Ex).toBeCloseTo(0, 14)
    const bExw = expectation(five, (x) => (jit.b * x) / sigmaAt(x, jit))
    const Ex2w = expectation(five, (x) => (x * x) / sigmaAt(x, jit))
    expect(g.node('SC').text).toContain(String.raw`$b \cdot E[x] = 0$`)
    expect(g.node('SV').text).toContain(String.raw`$b \cdot E[x / \sigma_v(x)] = ${tn(bExw, 4)}$`)
    const wLin = linearizedFixedPoint(jit, five, 'none', true).w
    expect(g.node('WV').text).toContain(String.raw`(${tn(bExw, 4)}) / E[x^2 / \sigma_v(x)]`)
    expect(g.node('WV').text).toContain(String.raw`$= 1 - ${fmt(Math.abs(bExw), 4)} / ${fmt(Ex2w, 4)} = ${fmt(wLin, 4)}$`)
    expect(1 + bExw / Ex2w).toBeCloseTo(wLin, 12)
    // 勘誤 E17：Sign-LMS 的 mean-field 根也是 0.9601；σ_v 為常數或改用 MSE-LMS 都回到 w = a
    expect(fixedPoint('sign', jit, five).w).toBeCloseTo(0.9601, 3)
    expect(fixedPoint('sign', { ...jit, jitterSlope: 0 }, five).w).toBeCloseTo(1, 9)
    expect(mseFixedPoint(jit, five)).toBeCloseTo(1, 12)
    // §11.1「方向的提醒」：reference 端的 DTC 是 code 越大延遲越短，jitter 最小的 code 換到最大的那一個（x_j = +2）時，
    // 權重左右對調、b·E[x/σ_v] 變號，固定點左右鏡射（偏移大小相同、方向相反）
    const mirror = { ...jit, jitterRef: 2 }
    expect(five.values.map((x) => fmt(sigmaAt(x, mirror), 3))).toEqual(['2.236', '1.803', '1.414', '1.118', '1'])
    expect(expectation(five, (x) => (mirror.b * x) / sigmaAt(x, mirror))).toBeCloseTo(-bExw, 14)
    expect(linearizedFixedPoint(mirror, five, 'none', true).w - 1).toBeCloseTo(-(wLin - 1), 12)
    expect(fixedPoint('sign', mirror, five).w - 1).toBeCloseTo(-(fixedPoint('sign', jit, five).w - 1), 9)
    expect(fixedPoint('sign', mirror, five).w).toBeCloseTo(1.0399, 3)
    // 結構：同一個起點 b，兩條路只差權重那一塊（藍色）
    expect(g.edge('OFF', 'KC')).toBeTruthy()
    expect(g.edge('OFF', 'KV')).toBeTruthy()
    expect(g.edge('KC', 'SC')).toBeTruthy()
    expect(g.edge('KV', 'SV')).toBeTruthy()
    expect(g.edge('SV', 'WV')).toBeTruthy()
    expect(g.node('KV').classes).toContain('focus')
    expect(g.node('WC').classes).toContain('ok')
    expect(g.node('WV').classes).toContain('warn')
    // 由上往下：同一個起點 → 分叉 → 加權平均 → 結論；左邊是常數 σ_v 的路、右邊是 σ_v(x) 的路
    const lay = await layout(D.CHART_JITTER_WEIGHT)
    lay.increasing('y', 'OFF', ['KC', 'KV'], ['SC', 'SV'], ['WC', 'WV'])
    for (const [constant, varying] of [['KC', 'KV'], ['SC', 'SV'], ['WC', 'WV']]) lay.increasing('x', constant, varying)
  })

  it('dead-zone（dead zone）：邊界 1.3333／1.5 與三個區域的 E[G] 來自模型', async () => {
    const g = await parseFlow(D.CHART_DEAD_ZONE)
    const m = model({ b: 1, sigmaV: 0 })
    const z = signWeightedMedian(m, u4.values, u4.probs)
    expect(g.node('LO').text).toContain(`小於 ${z.lo.toFixed(4)}`)
    expect(g.node('DZ').text).toContain(`在 ${z.lo.toFixed(4)} 與 ${fmt(z.hi, 4)} 之間`)
    expect(g.node('HI').text).toContain(`大於 ${fmt(z.hi, 4)}`)
    expect(g.node('LO').text).toContain(String.raw`$E[G] = ${tn(meanGmacSign(1.2, m, u4), 2, true)}$`)
    expect(meanGmacSign(1.4, m, u4)).toBe(0)
    expect(g.node('DZ').text).toContain(String.raw`$E[G] = 0$`)
    expect(g.node('HI').text).toContain(String.raw`$E[G] = ${tn(meanGmacSign(1.7, m, u4))}$ 或 $${tn(meanGmacSign(2.5, m, u4))}$`)
    expect(g.edge('DZ', 'UNI').text).toBe(String.raw`加入雜訊 $\sigma_v > 0$，等於 dither`)
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
    expect(g.node('PAR').text).toContain(String.raw`$= (${fmt(Exd)} / ${fmt(mo.Ex2)}) \cdot x = ${fmt(slope)} \cdot x$`)
    expect(g.node('ABS').text).toContain(String.raw`$w^* = a + ${fmt(slope)} = ${fmt(mseFixedPoint(CUBIC, five))}$`)
    expect(g.node('ORT').text).toContain(String.raw`$e_0(x) = ${fmt(CUBIC.c3, 1)} \cdot x^3 - ${fmt(slope)} \cdot x$`)
    const e1 = eDet(1, 1.34, CUBIC)
    const e2 = eDet(2, 1.34, CUBIC)
    expect(e1).toBeLessThan(0) // x = +1 的殘差是負的 ⇒ 圖上寫「x = ±1：∓0.24」
    expect(e2).toBeGreaterThan(0)
    expect(g.node('RES').text).toContain(String.raw`$x = \pm 1$：$\mp ${fmt(Math.abs(e1))}$；$x = \pm 2$：$\pm ${fmt(e2)}$`)
    expect(g.node('ORT').text).toContain(String.raw`$E[x \cdot e_0] = 0$`)
    expect(expectation(five, (x) => x * eDet(x, 1.34, CUBIC))).toBeCloseTo(0, 12)
    // 審查 C04：殘差留在「四個非零 code」上（x = 0 的殘差是 0），圖與圖說都不寫「每個 code」
    expect(g.node('RES').text).toContain('四個非零 code')
    expect(g.node('RES').text).not.toContain('每個 code')
    expect(CHARTS.find((d) => d.id === 'best-fit')?.caption).toContain('四個非零 code')
    expect(CHARTS.find((d) => d.id === 'best-fit')?.caption).not.toContain('每個 code')
    // 由上往下：INL → 投影 → 共線／正交兩支（左藍右紅）→ 各自的結論
    const lay = await layout(D.CHART_BEST_FIT)
    lay.increasing('y', 'D', 'SPLIT', ['PAR', 'ORT'], ['ABS', 'RES'])
    lay.increasing('x', 'PAR', 'ORT')
    lay.increasing('x', 'ABS', 'RES')
  })

  it('mean-vs-median（平均 vs 中位數）：權重、票重與三個答案來自模型', async () => {
    const g = await parseFlow(D.CHART_MEAN_VS_MEDIAN)
    const t1 = perCodeGain(1, CUBIC)
    const t2 = perCodeGain(2, CUBIC)
    expect(g.node('T').text).toContain(String.raw`$t(\pm 1) = ${fmt(t1)}$；$t(\pm 2) = ${fmt(t2)}$`)
    const wt = (pow: number, ax: number) => five.values.reduce((s, x, i) => s + (Math.abs(x) === ax ? five.probs[i] * Math.abs(x) ** pow : 0), 0)
    expect(g.node('M1').text).toContain(String.raw`權重 $p \cdot x^2$：${fmt(wt(2, 1))} 與 ${fmt(wt(2, 2))}`)
    expect(g.node('M3').text).toContain(String.raw`票重 $p \cdot |x|$：${fmt(wt(1, 1))} 與 ${fmt(wt(1, 2))}`)
    const mean = mseWeightedMean(CUBIC, five.values, five.probs)
    expect(g.node('R1').text).toContain(String.raw`$(${fmt(wt(2, 1))} \cdot ${fmt(t1)} + ${fmt(wt(2, 2))} \cdot ${fmt(t2)}) / ${fmt(wt(2, 1) + wt(2, 2))} = ${fmt(mean)}$`)
    const med = signWeightedMedian(CUBIC, five.values, five.probs)
    expect(med.lo).toBeCloseTo(1.4, 12)
    expect(med.hi).toBeCloseTo(1.4, 12)
    expect(g.node('R3').text).toContain(`${fmt(t2)} 的票重 ${fmt(wt(1, 2))} 超過總重 ${fmt(wt(1, 1) + wt(1, 2))} 的一半`)
    expect(wt(1, 2)).toBeGreaterThan((wt(1, 1) + wt(1, 2)) / 2)
    // 二階修正的係數 3.456×10⁻⁴（σ_v = 1 時的修正量）
    const coef = signSecondOrder({ ...CUBIC, sigmaV: 1 }, five) - mean
    expect(coef).toBeCloseTo(3.456e-4, 9)
    expect(g.node('R2').text).toContain(String.raw`$1.34 + 3.456 \times 10^{-4} / \sigma_v^2$`)
    // 圖說「最上面／中間／最下面」
    const lay = await layout(D.CHART_MEAN_VS_MEDIAN)
    lay.increasing('y', 'T', ['M1', 'M2', 'M3'], ['R1', 'R2', 'R3'])
  })

  it('identifiability／coupling-node（不可辨識）：兩條路以「＋」並聯，兩個世界的 GMAC 完全相同', async () => {
    const g = await parseFlow(D.CHART_IDENTIFIABILITY)
    expect(g.into('S').map((e) => `${e.from}:${e.text}`).sort()).toEqual(['GA:＋', 'GK:＋', 'V:＋'])
    expect(g.node('GA').text).toContain(String.raw`$\times (a - w)$`)
    expect(g.node('GK').text).toContain(String.raw`$\times \kappa$`)
    expect(g.node('CMP').text).toContain(String.raw`$e[n] = ((a + \kappa) - w) \cdot x[n] + v[n]$`)
    expect(g.edge('S', 'CMP')).toBeTruthy()
    const A = model({ kappa: 0.1, sigmaV: 0.5 })
    const B = model({ a: 1.1, sigmaV: 0.5 })
    expect(g.node('WA').text).toContain(String.raw`$a = ${A.a}$，$\kappa = ${A.kappa}$`)
    expect(g.node('WB').text).toContain(String.raw`$a = ${B.a}$，$\kappa = ${B.kappa}$`)
    for (const w of [0.6, 0.9, 1.1, 1.3, 1.6]) expect(Math.abs(meanGmacSign(w, A, five) - meanGmacSign(w, B, five))).toBeLessThan(1e-14)
    expect(fixedPoint('sign', A, five).w).toBeCloseTo(1.1, 9)
    expect(g.node('OBS').text).toContain(String.raw`$w^* = a + \kappa = 1.1$`)
    expect(g.into('OBS').map((e) => e.from).sort()).toEqual(['CMP', 'WA', 'WB'])
    // 由上往下：code → 兩條並聯的乘法路徑（＋雜訊）→ 加法點 → comparator → 觀測資料
    const lay = await layout(D.CHART_IDENTIFIABILITY)
    lay.increasing('y', 'X', ['GA', 'GK', 'V'], 'S', 'CMP', 'OBS')
    const c = await parseFlow(D.CHART_COUPLING_NODE)
    expect(c.node('A2').classes).toContain('ok')
    expect(c.node('B2').classes).toContain('warn')
    expect(c.node('B2').text).toContain(String.raw`$\kappa \cdot x$`)
    expect(c.node('A1').text).toContain(String.raw`$w = a + \kappa$`)
  })

  it('near-integer-path／near-integer-why：gain 誤差經過 H_PD、β 不經過；w* = a + B/C、S = K_q·C', async () => {
    const g = await parseFlow(D.CHART_NEAR_INTEGER_PATH)
    expect(g.edge('X', 'G')).toBeTruthy()
    expect(g.edge('G', 'H')).toBeTruthy()
    expect(g.edge('H', 'S').text).toBe(String.raw`＋ $(a - w) \cdot (h * x)[n]$`)
    expect(g.edge('BETA', 'S').text).toBe('＋')
    expect(g.into('H').map((e) => e.from)).toEqual(['G']) // β 不經過 H_PD
    expect(g.node('H').text).toContain(String.raw`$H_\mathrm{PD}(z)$`)
    expect(g.node('BETA').text).toContain(String.raw`$\beta[n]$`)
    // 全站約定：DTC 的殘餘誤差在 PD 的 reference 輸入端注入（e_PD = +H_PD·φ_dtc，正號）；comparator 取的是 PD 的輸出
    expect(g.node('G').text).toBe(String.raw`DTC gain 誤差 $\times (a - w)$` + '\n從 PD 的 reference 輸入注入')
    expect(g.subgraphs.find((sg) => sg.id === 'PATH')?.title).toBe('誤差怎麼到達 PD 的輸出')
    expect(g.edge('PATH', 'CORR').text).toBe(String.raw`PD 的輸出 $e_\mathrm{PD}[n]$`)
    expect(D.CHART_NEAR_INTEGER_PATH).not.toMatch(/[-−]\s*\$?\(a - w\) \\cdot \(h \* x\)/) // 不是負號
    expect(g.node('CMP').text).toContain(String.raw`$q[n] = \operatorname{sign}(e_\mathrm{PD}[n])$`)
    expect(g.into('M').map((e) => e.from).sort()).toEqual(['CMP', 'XR'])
    expect(g.node('XR').text).toContain('$x[n]$')
    expect(g.node('AVG').text).toContain(String.raw`$E[G] \approx K_q \cdot ((a - w) \cdot C + B)$`)
    // 版面：誤差路徑在上、GMAC 在下
    const lay = await layout(D.CHART_NEAR_INTEGER_PATH)
    lay.increasing('y', ['X', 'G', 'H', 'S', 'BETA', 'V'], ['CMP', 'XR', 'M', 'AVG', 'FP'])
    lay.increasing('x', 'X', 'G', 'H', 'S')
    lay.increasing('x', 'CMP', 'M', 'AVG', 'FP')
    expect(g.node('FP').text).toContain(String.raw`$w^* = a + B / C$`)
    const s = nearIntegerSensitivity(0.01, 0.01, 1)
    expect(s.bias).toBeCloseTo(1, 12)
    expect(s.slope).toBeCloseTo(KQ_FACTOR * 0.01, 14)
    expect(nearIntegerSensitivity(0.01, -0.01, 1).attracting).toBe(false)
    const y = await parseFlow(D.CHART_NEAR_INTEGER_WHY)
    expect(y.into('CS').map((e) => e.from).sort()).toEqual(['IN', 'OUT'])
    expect(y.node('IN').text).toContain(String.raw`$\Omega_k$ 小於 $\Omega_n$` + '\n' + String.raw`$\mathrm{Re}\,H_\mathrm{PD}$ 為負`)
    expect(y.node('OUT').text).toContain(String.raw`$\Omega_k$ 不小於 $\Omega_n$` + '\n' + String.raw`$\mathrm{Re}\,H_\mathrm{PD}$ 為正`)
    expect(y.node('SAW').text).toContain(String.raw`$\Omega_1 = 2\pi \cdot \mathrm{frac}$`)
    expect(y.node('CS').text).toContain(String.raw`$C \propto \mathrm{frac}^2$`)
    expect(y.node('SL').text).toContain(String.raw`$S = K_q \cdot C$`)
    // 審查 R01：「bias 被放大」是線性化的說法，放大到超出線性範圍就不再是固定點
    expect(y.node('BI').text).toContain(String.raw`線性化的 bias $= B / C$ 被放大`)
    expect(y.node('BI').text).toContain('不再是固定點')
    expect(y.node('NG').text).toContain(String.raw`$C \le 0$`)
    const layY = await layout(D.CHART_NEAR_INTEGER_WHY)
    layY.increasing('y', 'F', 'SAW', ['IN', 'OUT'], 'CS', ['SL', 'BI', 'NG'])
  })

  it('near-integer-check：兩支都從標準化的 residue 出發，頻域式就是 nearIntegerC 的算法；時域與頻域的 C 一致', async () => {
    const g = await parseFlow(D.CHART_NEAR_INTEGER_CHECK)
    expect(g.edge('FRAC', 'DSM')).toBeTruthy()
    expect(g.edge('DSM', 'NORM')).toBeTruthy()
    expect(g.into('T1').map((e) => e.from)).toEqual(['NORM'])
    expect(g.into('F1').map((e) => e.from)).toEqual(['NORM'])
    expect(g.node('FRAC').text).toContain(String.raw`$K = \mathrm{frac} \cdot 2^{16}$`)
    expect(g.node('DSM').text).toContain(String.raw`$P = 2^{16} / \gcd(K, 2^{16})$`)
    expect(g.node('NORM').text).toContain(String.raw`$E[x] = 0$，$E[x^2] = 1$`)
    expect(g.node('T1').text).toContain(String.raw`$u[n] = (h * x)[n]$`)
    expect(g.node('T2').text).toContain(String.raw`$C = \text{平均}(x[n] \cdot u[n])$`)
    expect(g.node('F2').text).toContain(String.raw`$C = \sum_k |X_k|^2 \cdot \mathrm{Re}\,H_\mathrm{PD}(e^{j\Omega_k})$`)
    expect(g.node('F2').text).toContain(String.raw`$\Omega_k = 2\pi k / P$`)
    expect(g.into('CHK').map((e) => e.from).sort()).toEqual(['F2', 'T2'])
    expect(g.node('CHK').text).toContain(String.raw`小於 $10^{-6}$`)
    expect(g.edge('CHK', 'OUT').text).toBe('是')
    expect(g.edge('CHK', 'BAD').text).toBe('否')
    expect(g.node('OUT').text).toContain(String.raw`$w^* - a = B / C$`)
    // 審查 R01：C 通過交叉檢查之後，B/C 還只是「線性候選」；第二個六角形把它代回完整的 erf 平均，門檻與手算、Lab 相同
    expect(g.node('OUT').text).toContain('線性候選')
    expect(g.edge('OUT', 'LIN')).toBeTruthy()
    expect(g.node('LIN').text).toContain(String.raw`\le ${LINEAR_OK_RATIO}$`)
    expect(g.node('LIN').text).toContain(String.raw`$|\gamma_\mathrm{lin}| \le ${LIN_RESIDUAL_LIMIT}$`)
    expect(g.edge('LIN', 'FPOK').text).toBe('是')
    expect(g.edge('LIN', 'FPEX').text).toBe('否')
    expect(g.node('FPEX').text).toContain('線性外推')
    expect(g.node('FPOK').classes).toContain('ok')
    expect(g.node('FPEX').classes).toContain('warn')
    expect(g.node('OUT').classes).not.toContain('ok') // 採用 C ≠ 固定點已驗證
    expect(D.CHART_NEAR_INTEGER_CHECK).toMatch(/^flowchart TB/)
    // 模型：實驗的預設第一點走「否」那一支，frac ≈ 0.05 走「是」那一支
    expect(nearIntegerSweep({ fracs: [3e-4, 0.05], wnTs: 0.02, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 }).linValid).toEqual([false, true])
    // 模型：16-bit first-order DSM 的週期 P = 2¹⁶/gcd(K, 2¹⁶)；兩條路的 C 相對差小於 10⁻⁶（圖上六角形的門檻）
    const r = nearIntegerSweep({ fracs: [0.0625, 0.25], wnTs: 0.05, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1, length: 2048 })
    expect(r.period).toEqual([2 ** 16 / 4096, 2 ** 16 / 16384]) // K = 4096、16384
    expect(r.maxRelDiff).toBeLessThan(1e-6)
    expect(r.bias[0]).toBeCloseTo(0.01 / r.Cfreq[0], 12) // w* − a = B/C
    // 由上往下：frac → residue → 標準化 → 時域／頻域兩支（時域在左）→ 兩個 C 的比對 → 結論
    const lay = await layout(D.CHART_NEAR_INTEGER_CHECK)
    lay.increasing('y', 'FRAC', 'DSM', 'NORM', ['T1', 'F1'], ['T2', 'F2'], 'CHK', ['OUT', 'BAD'], 'LIN', ['FPOK', 'FPEX'])
    lay.increasing('x', 'T1', 'F1')
    lay.increasing('x', 'T2', 'F2')
  })

  it('slope-measure：Ŝ = (G₋ − G₊)/(2Δ) 就是 bias.ts 的 slopeProbe；Ŝ ≤ 0 極性錯誤、Ŝ 很小 bias 被放大', async () => {
    const g = await parseFlow(D.CHART_SLOPE_MEASURE)
    expect(g.node('F1').text).toContain(String.raw`$w + \Delta$`)
    expect(g.node('F1').text).toContain('$G_+$')
    expect(g.node('F2').text).toContain(String.raw`$w - \Delta$`)
    expect(g.node('F2').text).toContain('$G_-$')
    expect(g.node('F3').text).toContain(String.raw`$\hat S = (G_- - G_+) / (2 \cdot \Delta)$`)
    expect(g.into('F3').map((e) => e.from).sort()).toEqual(['F1', 'F2'])
    expect(g.edge('Q1', 'BAD').text).toBe('否')
    expect(g.edge('Q1', 'Q2').text).toBe('是')
    expect(g.edge('Q2', 'SMALL').text).toBe('是')
    expect(g.edge('Q2', 'GOOD').text).toBe('否')
    expect(g.into('NEXT').map((e) => e.from).sort()).toEqual(['BAD', 'GOOD', 'SMALL'])
    expect(g.node('Q1').text).toContain(String.raw`$\hat S$ 大於 0`)
    expect(g.node('Q2').text).toContain(String.raw`$K_q \cdot E[x^2]$`)
    expect(g.node('BAD').text).toContain(String.raw`$C \le 0$`)
    expect(g.node('SMALL').text).toContain(String.raw`bias $= B / C$ 被放大`)
    // 審查 R01：和敏感度鏈（near-integer-why 的 BI）用同一句話——B/C 是線性化的 bias，不是無條件的固定點
    expect(g.node('SMALL').text).toContain(String.raw`線性化的 bias $= B / C$ 被放大`)
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
    expect(g.node('G1').text).toContain(String.raw`$G''(w^*) \cdot \operatorname{Var}(w) / (2 \cdot S)$`)
    expect(g.node('CHK').text).toContain(String.raw`$\le 4 \cdot \mathrm{SE} + \text{①③ 的估計} + ${SERVO_SHAPE_FRACTION} \cdot \text{②}$`)
    const src = readFileSync(join(process.cwd(), 'src/simulation/models/bias.ts'), 'utf8')
    expect(src).toContain('stat: 4 * mc.se')
    // 由上往下：mean-field 與三個差距（同一排）→ 加法點 → Monte Carlo 的平均 → 判定式 → 結論
    const lay = await layout(D.CHART_MC_GAPS)
    lay.increasing('y', ['MF', 'G1', 'G2', 'G3'], 'S', 'MC', 'CHK', ['OKN', 'BAD'])
    lay.increasing('x', 'MF', 'G1', 'G2', 'G3')
  })

  it('finite-step-loop：G_k = η − S·δw + ½G″·δw²、δw_(k+1) = δw_k + μ·G_k；pole 1 − g 與 Var(w) 和 finiteStepBias 一致', async () => {
    const g = await parseFlow(D.CHART_FINITE_STEP_LOOP)
    // 加法點 SG 的三個輸入：抽樣雜訊 ＋、恢復力 −、曲率 ＋
    expect(Object.fromEntries(g.into('SG').map((e) => [e.from, e.text]))).toEqual({ ETA: '＋', REST: '−', CURV: '＋' })
    expect(g.edge('SG', 'MU').text).toBe('$G_k$')
    // 累加器：δw_(k+1) = δw_k + μ·G_k，延遲 z⁻¹ 在 δw 的回授上
    expect(Object.fromEntries(g.into('ADD').map((e) => [e.from, e.text]))).toEqual({ MU: String.raw`＋ $\mu \cdot G_k$`, DLY: String.raw`＋ $\delta w_k$` })
    expect(g.edge('ADD', 'DLY').text).toBe(String.raw`$\delta w_{k+1}$`)
    expect(g.node('DLY').text).toContain('$z^{-1}$')
    expect(g.edge('DLY', 'REST').text).toBe(String.raw`$\delta w_k$`)
    expect(g.edge('DLY', 'CURV').text).toBe(String.raw`$\delta w_k$`)
    expect(g.node('REST').text).toContain(String.raw`$\times S$`)
    expect(g.node('CURV').text).toContain(String.raw`$\tfrac{1}{2} \cdot G''(w^*) \cdot \delta w_k^2$`)
    expect(g.node('POLE').text).toContain(String.raw`$\delta w_{k+1} = (1 - g) \cdot \delta w_k + \mu \cdot \eta_k$`)
    expect(g.node('POLE').text).toContain(String.raw`$g = \mu \cdot S$，pole $= 1 - g$`)
    expect(g.node('SHIFT').text).toContain(String.raw`$E[\delta w] \approx G''(w^*) \cdot \operatorname{Var}(w) / (2 \cdot S)$`)
    expect(g.node('ETA').text).toContain(String.raw`$E[x^2] / N$`)
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
    // 版面：全部是 block rate，由上往下：雜訊 → 加法點 → ×μ → 累加器 → 延遲 → 恢復力／曲率 → 各自的結論
    const lay = await layout(D.CHART_FINITE_STEP_LOOP)
    lay.increasing('y', 'ETA', 'SG', 'MU', 'ADD', 'DLY', ['REST', 'CURV'], ['POLE', 'SHIFT'])
    lay.increasing('x', 'REST', 'CURV')
  })

  it('verdict-tree／handcalc-flow（判斷樹與手算流程）：門檻 0.3、g = 0.02 與手算題、Lab 相同', async () => {
    const g = await parseFlow(D.CHART_VERDICT_TREE)
    expect(g.node('Q4').text).toContain(String.raw`\le ${LINEAR_OK_RATIO}$`)
    expect(g.node('Q1').text).toContain(String.raw`$S = K_q \cdot C > 0$`)
    expect(g.edge('Q1', 'N1').text).toBe('否')
    expect(g.edge('Q2', 'OKN').text).toBe('是')
    expect(g.into('Q4').map((e) => e.from).sort()).toEqual(['B1', 'B2', 'B3'])
    expect(g.node('B1').text).toContain(String.raw`bias $= b \cdot E[x] / E[x^2]$`)
    expect(g.node('B1').text).toContain(String.raw`$E[x] \ne 0$`)
    expect(g.node('B2').text).toContain(String.raw`bias $= E[x \cdot d] / E[x^2]$`)
    expect(g.node('B2').text).not.toContain('每個 code') // 審查 C04：x = 0 的 code 沒有殘差
    expect(g.node('B2').text).toContain('仍留下殘差')
    expect(g.node('B3').text).toContain(String.raw`$w^* = a + \kappa$`)
    const h = await parseFlow(D.CHART_HANDCALC_FLOW)
    expect(h.node('S5').text).toContain(String.raw`\le ${LINEAR_OK_RATIO}$`)
    // ①→②→③→④→⑤ 與 ①→⑥→⑦
    for (const [a, b] of [['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4'], ['S4', 'S5'], ['S1', 'S8'], ['S8', 'S9']]) expect(h.edge(a, b)).toBeTruthy()
    expect(h.into('S8').map((e) => e.from)).toEqual(['S1']) // S ≈ K_q·E[x²] 只用 ① 的動差與 σ_v，不需要 w*（HC-11.8）
    expect(h.edge('S1', 'S8').text).toBe(String.raw`只用 $E[x^2]$`)
    expect(h.node('S3').text).toContain(String.raw`$w^* = a + \text{offset} + \text{INL} + \kappa$`)
    const S = KQ_FACTOR * codeMoments(five).Ex2 // σ_v = 1
    expect(1 - autoMu(S) * S).toBeCloseTo(0.98, 12)
    expect(h.node('S9').text).toContain(String.raw`$g = 0.02$ 時平均 pole $= 0.98$`)
    expect(h.node('S8').text).toContain(String.raw`$K_q = \sqrt{2/\pi} / \sigma_v$`)
    const layG = await layout(D.CHART_VERDICT_TREE)
    layG.increasing('y', 'R', 'Q1', 'Q2', 'Q3', ['B1', 'B2', 'B3'], 'Q4', ['L1', 'L2'])
    const layH = await layout(D.CHART_HANDCALC_FLOW)
    layH.increasing('y', 'S1', 'S2', 'S3', 'S4', 'S5', ['S6', 'S7'])
    layH.increasing('y', 'S1', 'S8', 'S9')
  })
})

describe('Ch11 方塊圖：頁面元件（真正的 mermaid）', () => {
  const wrap = (node: React.ReactNode) => wrapPage(node, { url: '/ch/11' })

  it('<Fig> 畫出 SVG、圖號與 KaTeX 圖說；aria-label 是純文字', async () => {
    const { container } = render(wrap(<Fig id="dc-null" />))
    const box = container.querySelector('#ch11-fig-dc-null') as HTMLElement
    expect(box).toBeTruthy()
    await waitFor(() => expect(box.querySelector('.c-mermaid-svg svg')).toBeTruthy())
    expect(box.querySelector('.c-callout')).toBeNull() // 沒有「Mermaid 圖解析失敗」
    // 圖裡面的標籤也是 KaTeX（不是 `$…$` 原文）
    expect(box.querySelectorAll('.c-mermaid-svg .katex').length).toBeGreaterThanOrEqual(15)
    expect(box.querySelector('.c-mermaid-svg')?.textContent ?? '').not.toContain('$')
    expect(box.querySelector('figure')?.getAttribute('aria-label')).toBe(`${figLabel('dc-null')}：三種主迴路架構：phi 由誰決定`) // aria-label 是 accessibleText 之後的可念文字（\varphi → phi）
    const cap = box.querySelector('figcaption') as HTMLElement
    expect(cap.textContent).toContain(figLabel('dc-null'))
    expect(cap.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
    expect(cap.textContent).not.toMatch(/\$/)
    expectNoTexErrors(container)
  })

  it('開場段落：「這一課要回答的問題」之後緊接系統地圖（<SystemMap>），再來才是直覺與手算', async () => {
    const { container } = render(wrap(<IntroSection />))
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    // 系統地圖 + 圖 11-1 + 圖 11-2
    expect(figures).toHaveLength(3)
    const map = figures[0]
    expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
    // aria-label 是純文字：方塊名稱裡的 `$…$` 只去掉分隔符號
    for (const b of SYSTEM_MAP_FOCUS) expect(map.getAttribute('aria-label')).toContain(accessibleText(SYSTEM_BLOCK_LABEL[b]))
    const question = container.querySelector('.c-callout') as HTMLElement
    expect(question.textContent).toContain('這一課要回答的問題')
    expect(question.nextElementSibling).toBe(map)
    const intuition = container.querySelector('#ch11-intuition') as HTMLElement
    expect(map.compareDocumentPosition(intuition) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 地圖後面有一句話說明藍色方塊與本章新增的內容
    expect(map.nextElementSibling?.textContent).toMatch(/藍色[\s\S]*這一課/)
    // 系統地圖是手排的 SVG（不經過 Mermaid）：藍色方塊（is-focus）就是本章標示的方塊，不多也不少
    expect(map.classList.contains('c-sysmap')).toBe(true)
    const focused = Array.from(map.querySelectorAll('g.c-sysmap-block.is-focus'), (g) => g.getAttribute('data-block'))
    expect([...focused].sort()).toEqual([...SYSTEM_MAP_FOCUS].sort())
    expect(map.querySelectorAll('g.c-sysmap-block[data-focus="true"]')).toHaveLength(SYSTEM_MAP_FOCUS.length)
    expect(map.querySelectorAll('g.c-sysmap-block:not(.is-focus)').length).toBe(systemMapModel(SYSTEM_MAP_FOCUS).blocks.length - SYSTEM_MAP_FOCUS.length)
    // 系統地圖 + 兩張 Mermaid 圖都畫好了
    await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg').length).toBe(3), { timeout: 60000 })
    expect(container.textContent).not.toContain('Mermaid 圖解析失敗')
    // 「誤差從哪裡進來」的導讀：先看 PD（reference 經 DTC 進來、回授路徑上只有 divider），再看 PD 下面的 comparator／GMAC，並交代圖上的虛線（主 PLL 的 DC null）
    const diagramText = container.querySelector('#ch11-diagram')?.textContent ?? ''
    expect(diagramText).toMatch(/先看[\s\S]*上半部的 PD[\s\S]*再看 PD 下面/)
    expect(diagramText).toMatch(/Reference clock 先經過 DTC 才進 PD[\s\S]*回授路徑上只有 divider，它的 edge 早到/)
    expect(diagramText).toContain('comparator 取的是 PD 的輸出')
    expect(diagramText).toContain('也就是送進 loop filter 的同一個訊號')
    expect(diagramText).toMatch(/虛線是主 PLL[\s\S]*VCO 的輸出經 divider 回到 PD[\s\S]*feedback edge 再早到[\s\S]*DC\s*null[\s\S]*BBPD/)
    expect(diagramText).toMatch(/DSM\s*同時做三件事：carry 控制 divider、餘數[\s\S]*gain correction[\s\S]*regressor/)
    // 物理圖像（全站約定，docs/assumptions.md §2a）在「直覺」第一次交代：DTC 在 reference 輸入端、PD 量 reference 減 feedback、w·x 叫補償量
    const intuitionText = intuition.textContent ?? ''
    expect(intuitionText).toContain('DTC 在 reference 的輸入端，回授路徑上只有 divider')
    expect(intuitionText).toMatch(/feedback（divider）edge 比理想時刻早到/)
    expect(intuitionText).toMatch(/只能延遲、不能提前[\s\S]*基準延遲[\s\S]*往回扣/)
    expect(intuitionText).toContain('補償量')
    expect(intuitionText).toContain('DTC 延遲後的 reference edge 減')
    // 舊的說法（DTC 的 delay 是 a·x、用 w·x 去抵消 delay）不再出現
    expect(container.textContent).not.toMatch(/真實的 delay|真實 delay|抵消 delay|DTC 的 delay/)
    expect(container.querySelector('#ch11-fig-gmac-zero')?.closest('section')?.id).toBe('ch11-hand')
    expect(container.querySelector('#ch11-fig-error-sources')?.closest('section')?.id).toBe('ch11-diagram')
  })
})
