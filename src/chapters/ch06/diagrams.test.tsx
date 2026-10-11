import { fireEvent, render } from '@testing-library/react'
import { marked, type Token } from 'marked'
import mermaid from 'mermaid'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { defaultValues, renderTex, systemMapChart } from '@/components'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { c, cAdd, cDiv, cMul, type Complex } from '@/simulation/core/complex'
import {
  buildRegressor,
  calPole,
  compareCtDt,
  ctHpd,
  designPolarityLoop,
  impulseMoments,
  kqFromSigma,
  meanFieldGmac,
  sawtoothAutocorr,
  sawtoothMomentApprox,
  simulateSignLmsChain,
  toneCorrelation,
  toneFir,
  toneRippleBound,
} from '@/simulation/models/polarity'
import { freqz, impulseResponse } from '@/simulation/signal'
import * as diagrams from './diagrams'
import { CH06_DIAGRAMS, diagramById } from './diagrams'
import { HANDCALCS } from './handcalcs'
import Chapter06 from './index'
import { CH06_SYMBOLS } from './symbols'

/**
 * 第 06 章的方塊圖與符號表位置（docs/teaching-style.md §5、§8）。
 *
 * - 每張圖都用共用的 renderMermaidForTest（@/components/mermaidTestUtils）「真的畫一次」：真正的 mermaid 套件 + 和網站相同的前處理。
 *   只過 parser 不夠——Mermaid 11 把每個標籤交給 marked，不認得的 token（list、blockquote、link…）會在圖上畫成 "Unsupported markdown: …"，
 *   而 parser 不會報錯。
 * - 再用 mermaid 的 parser 取出節點與連線，逐張核對圖上的訊號名稱、加法點的正負號、延遲的位置與取樣率是否和正文公式一致；
 *   能用數字驗的（pole、L(z)、鋸齒自相關、動差、時序）就拿網站的模型函式（polarity.ts）對一次。
 * - 頁面測試把共用的 <Mermaid> 元件換成替身（把原始碼與圖說放在 data-chart／data-caption），核對「頁面上實際畫了哪些圖、順序為何、放在哪裡」。
 *   真正的 <Mermaid> 元件在整章 smoke test（ch06.test.tsx）裡跑。
 */

const plotlyMock = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: plotlyMock }))

// <Mermaid> 的替身（SystemMap 也透過同一個元件畫圖，所以章首的系統地圖同樣會出現）。mermaid 套件本身沒有被 mock。
vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  const { mathText, stripMathDelimiters } = await import('@/components/Tex')
  return {
    Mermaid: ({ chart, caption, ariaLabel }: { chart: string; caption?: string; ariaLabel?: string }) =>
      createElement(
        'figure',
        { className: 'c-mermaid', 'data-chart': chart, 'data-caption': caption, 'aria-label': stripMathDelimiters(ariaLabel ?? caption ?? '') },
        caption ? createElement('figcaption', { className: 'c-figcaption' }, mathText(caption)) : null,
      ),
    renderMermaid: async () => '<svg></svg>',
  }
})

beforeAll(() => {
  installMermaidSvgShim()
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
})

afterEach(() => localStorage.clear())

const N_DIAGRAMS = 26
const MAX_NODES = 14
const SYSTEM_FOCUS = ['dtc', 'pd', 'lf', 'vco', 'div', 'cmp', 'gmac'] as const

/** flowchart db 中本測試用到的部分 */
interface FlowVertex {
  id: string
  text?: string
  type?: string
  classes?: string[]
}
interface FlowEdge {
  start: string
  end: string
  text?: string
  stroke?: string
}
interface FlowDb {
  getVertices(): Map<string, FlowVertex>
  getEdges(): FlowEdge[]
  getSubGraphs(): { title?: string }[]
  getClasses(): Map<string, unknown>
}
/** sequenceDiagram db 中本測試用到的部分 */
interface SeqMessage {
  from?: string
  to?: string
  message?: string
  type?: number
}
interface SeqDb {
  getActors(): Map<string, { description?: string }>
  getMessages(): SeqMessage[]
  LINETYPE: Record<string, number>
}

async function diagramType(chart: string): Promise<string> {
  const r = await mermaid.parse(chart, { suppressErrors: false })
  return r && typeof r === 'object' ? r.diagramType : ''
}

interface Flow {
  vertices: FlowVertex[]
  edges: FlowEdge[]
  subgraphs: string[]
  classes: string[]
}

async function parseChart(chart: string): Promise<Flow> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as FlowDb
  return {
    vertices: [...db.getVertices().values()],
    edges: db.getEdges(),
    subgraphs: db.getSubGraphs().map((s) => s.title ?? ''),
    classes: [...db.getClasses().keys()],
  }
}

/** 找一條連線（start → end）；找不到就讓測試失敗 */
function edge(edges: FlowEdge[], start: string, end: string): FlowEdge {
  const e = edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`找不到連線 ${start} → ${end}`)
  return e
}

function hasEdge(edges: FlowEdge[], start: string, end: string): boolean {
  return edges.some((x) => x.start === start && x.end === end)
}

function nodeText(g: Flow, id: string): string {
  const v = g.vertices.find((x) => x.id === id)
  if (!v) throw new Error(`找不到節點 ${id}`)
  return v.text ?? ''
}

/** db 的文字已經過 sanitize：< 會變成 &lt;、> 會變成 &gt; */
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** 比對「畫出來的文字」用：拿掉換行標籤與所有空白 */
const squash = (s: string) => decode(s).replace(/<br\s*\/?>/g, '').replace(/\s+/g, '')
/** 進加法點的線：以「−」開頭是減，其餘（以「＋」開頭）是加 */
const signOf = (label: string | undefined): 1 | -1 => ((label ?? '').startsWith('−') ? -1 : 1)

/** marked token 樹攤平成 type 清單 */
function tokenTypes(tokens: Token[], out: string[] = []): string[] {
  for (const t of tokens) {
    out.push(t.type)
    if ('tokens' in t && t.tokens) tokenTypes(t.tokens, out)
  }
  return out
}

/** Mermaid 的 markdownToHTML 只認得這些 token；其他的會顯示成 "Unsupported markdown: …"（strong／em 雖然認得，但本章不該出現） */
const SAFE_TOKENS = new Set(['paragraph', 'text', 'html', 'space'])

/** ch06.test.tsx 對字串屬性禁止的 Unicode 數學符號（圖說裡的數學一律寫成 `$...$`） */
const UNICODE_MATH_DOM = /[α-ωΑ-Ω≤≥≈≪≫√∫Σ∏²³₀-₉·±−⟨⟩∠Ĉ]/
const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

const CHART_EXPORTS: [string, string][] = Object.entries(diagrams as Record<string, unknown>).flatMap(([name, value]) =>
  name.startsWith('CHART_') && typeof value === 'string' ? [[name, value] as [string, string]] : [],
)

const COLOR: Record<string, string> = { focus: '#1f5fa8', warn: '#b42318', ok: '#1d7a46', zero: '#8a5a00' }

describe('第 06 章方塊圖：登錄', () => {
  it(`共 ${N_DIAGRAMS} 張，每張都是具名匯出的 Mermaid 原始碼，並且都登錄在 CH06_DIAGRAMS（依出現順序編號）`, () => {
    expect(CHART_EXPORTS).toHaveLength(N_DIAGRAMS)
    expect(CH06_DIAGRAMS).toHaveLength(N_DIAGRAMS)
    // 匯出的每張圖都登錄一次；登錄的每張圖都是匯出的常數
    const exported = CHART_EXPORTS.map(([, chart]) => chart)
    expect(new Set(exported).size).toBe(N_DIAGRAMS)
    expect([...CH06_DIAGRAMS.map((d) => d.chart)].sort()).toEqual([...exported].sort())
    CH06_DIAGRAMS.forEach((d, i) => {
      expect(d.id).toBe(`D-06.${i + 1}`)
      expect(d.no).toBe(`6.${i + 1}`)
      expect(diagramById(d.id)).toBe(d)
    })
    expect(new Set(CH06_DIAGRAMS.map((d) => d.title)).size).toBe(N_DIAGRAMS)
    expect(() => diagramById('D-06.100')).toThrow(/找不到方塊圖/)
    // 節的順序不會倒退（圖號依出現順序）；八個小節每一節至少一張
    const sections = CH06_DIAGRAMS.map((d) => Number(d.section.replace('ch06-s', '')))
    expect([...sections].sort((a, b) => a - b)).toEqual(sections)
    expect(new Set(sections)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]))
    // teaching-style §8 的圖種都有用到（timing = sequenceDiagram 畫的時序圖）
    expect(new Set(CH06_DIAGRAMS.map((d) => d.kind))).toEqual(new Set(['model', 'loop', 'path', 'compare', 'decision', 'timing', 'handcalc']))
    expect(CH06_DIAGRAMS.filter((d) => d.kind === 'timing').map((d) => d.chart)).toEqual([diagrams.CHART_BLOCK_TIMING])
  })

  it('圖說：有內容、以句號結尾；數學一律寫成 $...$（KaTeX 可渲染），$...$ 以外沒有 Unicode 拼的數學；標題是純文字', () => {
    let withMath = 0
    for (const d of CH06_DIAGRAMS) {
      expect(d.title, d.id).not.toMatch(/\$/)
      expect(d.title, d.id).not.toMatch(UNICODE_MATH_DOM)
      expect(d.title, d.id).not.toMatch(/[。：]$/)
      expect(d.caption.length, d.id).toBeGreaterThan(30)
      expect(d.caption, d.id).toMatch(/。$/)
      const outside = d.caption.replace(INLINE_MATH, '')
      expect(outside, `${d.id}：有落單的 $`).not.toContain('$')
      expect(outside, `${d.id}：圖說裡的數學要寫成 $...$`).not.toMatch(UNICODE_MATH_DOM)
      for (const m of d.caption.matchAll(INLINE_MATH)) {
        withMath++
        expect(renderTex(m[1], false), `${d.id}：${m[1]}`).not.toContain('katex-error')
      }
    }
    expect(withMath).toBeGreaterThan(40)
  })
})

describe('第 06 章方塊圖：真的畫出來（共用的 renderMermaidForTest）', () => {
  it('對照組：半形 + 的加法點、`E[G](δ)`、以 > 開頭的標籤，畫出來真的會變成 "Unsupported markdown"；共用的前處理只救得了前者（所以本章都不用）', async () => {
    const source = 'flowchart LR\n  A["a"] -- "+" --> S(("+"))\n  B["E[G](δ)"] --> S\n  C["> 0"] --> S'
    const raw = await mermaid.render('ch06-ctl', source)
    expect([...raw.svg.matchAll(/Unsupported markdown: \w+/g)].map((m) => m[0]).sort()).toEqual([
      'Unsupported markdown: blockquote',
      'Unsupported markdown: link',
      'Unsupported markdown: list',
      'Unsupported markdown: list',
    ])
    const fixed = await renderMermaidForTest(source)
    expect([...fixed.svg.matchAll(/Unsupported markdown: \w+/g)].map((m) => m[0]).sort()).toEqual(['Unsupported markdown: blockquote', 'Unsupported markdown: link'])
  })

  it.each(CH06_DIAGRAMS.map((d) => [d.id, d.title, d] as const))(
    `%s %s：畫得出來、沒有 Unsupported markdown、不超過 ${MAX_NODES} 個節點、標籤文字都在`,
    async (_id, _title, d) => {
      // 原始碼不依賴共用的前處理：加法點與正負號直接寫全形「＋」與「−」（U+2212）
      expect(sanitizeMermaidSource(d.chart), d.id).toBe(d.chart)
      const type = await diagramType(d.chart)
      expect(type).toBe(d.kind === 'timing' ? 'sequence' : 'flowchart-v2')

      const { svg, text, nodeCount } = await renderMermaidForTest(d.chart)
      expect(text).not.toMatch(/Unsupported markdown/)
      expect(text).not.toMatch(/Syntax error/)
      expect(nodeCount).toBeLessThanOrEqual(MAX_NODES)
      const drawn = squash(text)

      if (d.kind === 'timing') {
        // sequenceDiagram：participant ≤ 14，每一則訊息與註解都畫出來；訊息文字不可含 ";" 與 "#"
        const diagram = await mermaid.mermaidAPI.getDiagramFromText(d.chart)
        const db = diagram.db as unknown as SeqDb
        const actors = [...db.getActors().values()].map((a) => a.description ?? '')
        expect(actors.length).toBeGreaterThanOrEqual(3)
        expect(actors.length).toBeLessThanOrEqual(MAX_NODES)
        for (const a of actors) expect(drawn, `${d.id} 的 participant ${a}`).toContain(squash(a))
        const messages = db.getMessages().map((m) => m.message ?? '').filter((m) => m !== '')
        expect(messages.length).toBeGreaterThanOrEqual(6)
        for (const m of messages) {
          expect(m, d.id).not.toMatch(/[;#]/)
          expect(drawn, `${d.id} 的訊息 ${m}`).toContain(squash(m))
        }
        return
      }

      const { vertices, edges, subgraphs, classes } = await parseChart(d.chart)
      expect(vertices.length).toBeGreaterThanOrEqual(4)
      expect(vertices.length).toBeLessThanOrEqual(MAX_NODES)
      // 畫出來的節點數就是 parser 看到的節點數（subgraph 的標題不算節點）
      expect(nodeCount).toBe(vertices.length)
      expect(edges.length).toBeGreaterThanOrEqual(3)
      const labels = [...vertices.map((v) => v.text ?? ''), ...edges.map((e) => e.text ?? ''), ...subgraphs].filter((t) => t !== '')
      expect(labels.length).toBeGreaterThan(vertices.length - 1)
      for (const label of labels) {
        const types = tokenTypes(marked.lexer(label))
        expect(types.filter((t) => !SAFE_TOKENS.has(t)), `標籤「${label}」會顯示成 Unsupported markdown`).toEqual([])
        // 半形 + 單獨當標籤會變成 markdown 清單；本章加法點與正號一律用全形「＋」，卷積用「∗」（U+2217）
        expect(label.trim(), `標籤「${label}」`).not.toBe('+')
        expect(label.trim(), `標籤「${label}」`).not.toBe('-')
        expect(label, `標籤「${label}」`).not.toMatch(/\*/)
        // 每個標籤的每一行都真的畫在圖上
        for (const line of label.split(/<br\s*\/?>/)) expect(drawn, `${d.id} 的標籤「${line}」`).toContain(squash(line))
      }
      // 原始碼裡的 "<"：除了 <br/> 之外，後面一定要有空白（否則會被當成 HTML tag 而被 DOMPurify 移除）
      for (const m of d.chart.matchAll(/"([^"]*)"/g)) expect(m[1].replace(/<br\/>/g, ''), d.id).not.toMatch(/<\S/)
      // 用到的 class 都有 classDef（focus／warn／ok／zero），而且顏色真的畫出來
      const used = new Set(vertices.flatMap((v) => v.classes ?? []))
      for (const cls of used) {
        expect(classes, `${d.id} 的 class ${cls}`).toContain(cls)
        expect(svg.toLowerCase(), `${d.id} 的 ${cls} 顏色`).toContain(COLOR[cls])
      }
      expect(used.size, `${d.id} 至少標出一個重點方塊`).toBeGreaterThan(0)
      // 加法點 = 圓形節點、文字是全形「＋」：至少兩條輸入，而且每一條都以「＋」或「−」開頭（正負號不靠猜）
      for (const s of vertices.filter((v) => v.type === 'circle' && v.text === '＋')) {
        const incoming = edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${d.id} 的加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${d.id}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
      }
    },
  )

  it('系統地圖（本章的 focus）也畫得出來：17 個方塊、7 個標成藍色', async () => {
    const chart = systemMapChart([...SYSTEM_FOCUS])
    expect(await diagramType(chart)).toBe('flowchart-v2')
    const { text, nodeCount, svg } = await renderMermaidForTest(chart)
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(nodeCount).toBe(17)
    const { vertices } = await parseChart(chart)
    expect(vertices.filter((v) => (v.classes ?? []).includes('focus')).map((v) => v.id).sort()).toEqual(['CMP', 'DIV', 'DTC', 'GMAC', 'LF', 'PD', 'VCO'])
    expect(svg.toLowerCase()).toContain(COLOR.focus)
  })
})

/* ───────────────────────── 與正文公式一致 ───────────────────────── */

/** §1 的例子（T06）：x[n] = cos(πn/6) 經過 |H| = 1、φ = 120° 的 2-tap 濾波器；一個週期 12 個 sample */
function toneExample() {
  const omega = Math.PI / 6
  const h = toneFir(1, (2 * Math.PI) / 3, omega)
  const x = (n: number) => Math.cos(omega * n)
  const u = (n: number) => h[0] * x(n) + h[1] * x(n - 1)
  const mean = (fn: (n: number) => number) => Array.from({ length: 12 }, (_, n) => fn(n)).reduce((s, v) => s + v, 0) / 12
  return { omega, h, x, u, mean }
}

const expj = (theta: number): Complex => c(Math.cos(theta), Math.sin(theta))
const cInv = (z: Complex): Complex => cDiv(c(1), z)

describe('第 06 章方塊圖：與正文公式一致（極性、取樣率、延遲的位置）', () => {
  it('圖 6.1（兩條路）：x 一份直通、一份經過主 PLL 才到乘法器；T06 的例子平均是負的', async () => {
    const g = await parseChart(diagrams.CHART_TWO_PATHS)
    expect(hasEdge(g.edges, 'X', 'H')).toBe(true)
    expect(edge(g.edges, 'H', 'M').text).toContain('u[n]')
    expect(edge(g.edges, 'X', 'M').text).toContain('x[n]')
    expect(nodeText(g, 'M')).toBe('×')
    expect(edge(g.edges, 'M', 'AVG').text).toBe('x[n]·u[n]')
    expect(g.vertices.find((v) => v.id === 'OK')?.classes).toContain('ok')
    expect(g.vertices.find((v) => v.id === 'BAD')?.classes).toContain('warn')
    // 圖下方對照的手算表：C = (1/12) Σ x[n]·u[n] = −0.25 ⇒ 走「負」那個出口
    const t = toneExample()
    expect(t.mean((n) => t.x(n) * t.u(n))).toBeCloseTo(-0.25, 12)
    expect(decode(edge(g.edges, 'C', 'BAD').text ?? '')).toMatch(/^負/)
    expect(decode(edge(g.edges, 'C', 'OK').text ?? '')).toMatch(/^正/)
  })

  it('圖 6.2（tapped delay line）：x[n−k] 乘 h[k] 再全部以＋相加；套上 §1 的 h = [1, −√3] 就是手算表的 u[n]', async () => {
    const g = await parseChart(diagrams.CHART_TAPPED_DELAY)
    expect(nodeText(g, 'Z1')).toBe('z⁻¹')
    expect(nodeText(g, 'Z2')).toBe('z⁻¹')
    expect(hasEdge(g.edges, 'X', 'G0')).toBe(true)
    expect(edge(g.edges, 'Z1', 'G1').text).toBe('x[n−1]')
    expect(edge(g.edges, 'Z2', 'G2').text).toBe('x[n−2]')
    expect(hasEdge(g.edges, 'X', 'Z1') && hasEdge(g.edges, 'Z1', 'Z2')).toBe(true)
    for (const id of ['G0', 'G1', 'G2']) expect(edge(g.edges, id, 'S').text).toBe('＋')
    expect(nodeText(g, 'U')).toContain('u[n] = h[0]·x[n] + h[1]·x[n−1] + h[2]·x[n−2]')
    const t = toneExample()
    expect(t.h[0]).toBeCloseTo(1, 12)
    expect(t.h[1]).toBeCloseTo(-Math.sqrt(3), 12)
  })

  it('圖 6.3（注入點）：ε 以＋、回授 φ_fb 以−進入加法點；兩個輸出 H_PD 與 T 相加為 1', async () => {
    const { edges } = await parseChart(diagrams.CHART_PLL_INJECTION)
    expect(edge(edges, 'EPS', 'SUM').text).toBe('＋')
    expect(edge(edges, 'L', 'SUM').text).toBe('−（回授 φ_fb = L·e_PD）')
    expect(edge(edges, 'SUM', 'L').text).toBe('e_PD = ε − φ_fb')
    expect(diagrams.CHART_PLL_INJECTION).toContain('e_PD = ε / (1 + L) = H_PD·ε')
    expect(diagrams.CHART_PLL_INJECTION).toContain('φ_fb = ε·L / (1 + L) = T·ε')
    expect(diagrams.CHART_PLL_INJECTION).toContain('H_PD + T = 1')
    // 依圖上的正負號解迴路：e = (＋1)·ε + (−1)·L·e ⇒ e/ε = 1/(1 + L)；拿任意一個複數 L 驗 H_PD + T = 1
    const sFb = signOf(edge(edges, 'L', 'SUM').text)
    const sIn = signOf(edge(edges, 'EPS', 'SUM').text)
    expect([sIn, sFb]).toEqual([1, -1])
    const L = c(3.2, -1.7)
    const H = cDiv(c(sIn), cAdd(c(1), cMul(c(-sFb), L)))
    const T = cMul(L, H)
    expect(H.re).toBeCloseTo(cInv(cAdd(c(1), L)).re, 14)
    expect(H.im).toBeCloseTo(cInv(cAdd(c(1), L)).im, 14)
    expect(H.re + T.re).toBeCloseTo(1, 14)
    expect(H.im + T.im).toBeCloseTo(0, 14)
  })

  it('圖 6.4（誤差路徑）：δ = a − w、e_PD 含雜訊、GMAC 乘只延遲過的原始 x[n−D]、w_(k+1) = w_k + μ·G_k 下一個 block 才生效', async () => {
    const g = await parseChart(diagrams.CHART_ERROR_PATH)
    const { edges } = g
    expect(edge(edges, 'A', 'DS').text).toBe('＋')
    expect(edge(edges, 'W', 'DS').text).toBe('−')
    expect(edge(edges, 'DS', 'MUL').text).toBe('δ_k = a − w_k')
    expect(nodeText(g, 'MUL')).toBe('×')
    expect(hasEdge(edges, 'X', 'MUL')).toBe(true)
    expect(edge(edges, 'MUL', 'HPD').text).toContain('ε[n] = δ_k·x[n]')
    expect(nodeText(g, 'HPD')).toContain('H_PD = 1 / (1 + L)')
    // H_PD 的輸出加上雜訊才是 comparator 的輸入；q = sign(e_PD)
    expect(edge(edges, 'HPD', 'ADD').text).toMatch(/^＋.*δ_k·u\[n\].*u = h∗x/)
    expect(edge(edges, 'V', 'ADD').text).toBe('＋')
    expect(edge(edges, 'ADD', 'CMP').text).toBe('e_PD[n]')
    expect(nodeText(g, 'CMP')).toContain('q[n] = sign(e_PD[n])')
    // GMAC 的 regressor 直接從 code 來：只經過 z^−D，沒經過 H_PD
    expect(hasEdge(edges, 'X', 'DLY')).toBe(true)
    expect(nodeText(g, 'DLY')).toContain('z^−D')
    expect(edge(edges, 'DLY', 'COR').text).toContain('x[n−D]')
    expect(hasEdge(edges, 'HPD', 'COR')).toBe(false)
    expect(hasEdge(edges, 'X', 'COR')).toBe(false)
    expect(edge(edges, 'CMP', 'COR').text).toContain('q[n]')
    expect(nodeText(g, 'COR')).toBe('×')
    // sample rate（n）到 block rate（k）的交界在 GMAC 的平均；更新在下一個 block 才生效
    expect(nodeText(g, 'AVG')).toContain('G_k = (1/N) Σ q[n]·x[n−D]')
    expect(edge(edges, 'AVG', 'UPD').text).toBe('G_k')
    expect(nodeText(g, 'UPD')).toContain('w_(k+1) = w_k + μ·G_k')
    expect(edge(edges, 'UPD', 'W').text).toBe('下一個 block 才生效')
    expect(nodeText(g, 'W')).toContain('w_k')
    // 主角標色：H_PD 是 focus，GMAC 的乘法器是 warn
    expect(g.vertices.find((v) => v.id === 'HPD')?.classes).toContain('focus')
    expect(g.vertices.find((v) => v.id === 'COR')?.classes).toContain('warn')
  })

  it('圖 6.5（GMAC 平均）：erf → 乘 x[n−D] → block 平均就是 F-06.19；小訊號是 K_q·δ·C_D，大誤差飽和成只剩正負號', async () => {
    const g = await parseChart(diagrams.CHART_GMAC_MEAN)
    expect(nodeText(g, 'ED')).toContain('e_det[n] = δ_k·u[n]')
    expect(nodeText(g, 'ERF')).toContain('E[q] = erf( e_det / (√2·σ_v) )')
    expect(edge(g.edges, 'ERF', 'M').text).toContain('K_q·e_det[n]')
    expect(nodeText(g, 'XD')).toContain('x[n−D]')
    expect(hasEdge(g.edges, 'XD', 'M') && hasEdge(g.edges, 'M', 'AVG') && hasEdge(g.edges, 'AVG', 'EG')).toBe(true)
    expect(nodeText(g, 'EG')).toContain('E[G_k] ≈ K_q·δ_k·C_D')
    expect(edge(g.edges, 'ERF', 'SAT').stroke).toBe('dotted')
    // 用網站的 mean-field 函式（圖上的三個方塊：erf、× x、平均）驗兩個極限：T06 的單頻，C = −0.25
    const t = toneExample()
    const n = Array.from({ length: 1200 }, (_, i) => i)
    const x = n.map(t.x)
    const u = n.map(t.u)
    const sigmaV = 100
    const Kq = kqFromSigma(sigmaV)
    const small = meanFieldGmac(x, u, 1, sigmaV)
    expect(small / (Kq * 1 * -0.25)).toBeCloseTo(1, 4)
    // 大誤差：再放大 10 倍，輸出不變（不再和 δ 成正比），等於 sign(δ)·E[x·sign(u)] = −(2 + √3)/12
    const big = meanFieldGmac(x, u, 1e6, sigmaV)
    expect(meanFieldGmac(x, u, 1e7, sigmaV)).toBeCloseTo(big, 6)
    expect(big).toBeCloseTo(-(2 + Math.sqrt(3)) / 12, 6)
  })

  it('圖 6.6（pole 迴圈）：E[δ] 以＋、μ·K_q·C·E[δ] 以−進入加法點，延遲在迴圈上；繞一圈的倍數就是 calPole()', async () => {
    const g = await parseChart(diagrams.CHART_POLE_LOOP)
    const { edges } = g
    expect(edge(edges, 'D', 'S').text).toBe('＋')
    expect(edge(edges, 'MU', 'S').text).toBe('−')
    expect(hasEdge(edges, 'D', 'KC')).toBe(true)
    expect(nodeText(g, 'KC')).toBe('× K_q·C')
    expect(edge(edges, 'KC', 'MU').text).toBe('E[G_k]')
    expect(nodeText(g, 'MU')).toBe('× μ')
    expect(nodeText(g, 'Z')).toContain('z⁻¹')
    expect(edge(edges, 'S', 'Z').text).toBe('E[δ_(k+1)]')
    expect(hasEdge(edges, 'Z', 'D')).toBe(true)
    // 依圖上的正負號算一圈：p = (＋1) + (−1)·μ·K_q·C；T06（μ = 10 fs、σ_v = 100 fs、C = −0.25）的 golden 值 1.0199471
    const mu = 10
    const Kq = kqFromSigma(100)
    for (const C of [-0.25, 0, 0.5]) {
      const p = signOf(edge(edges, 'D', 'S').text) + signOf(edge(edges, 'MU', 'S').text) * mu * Kq * C
      expect(p).toBeCloseTo(calPole(mu, Kq, C), 14)
    }
    expect(calPole(mu, Kq, toneCorrelation({ A: 1, mag: 1, phiRad: (2 * Math.PI) / 3, omega: Math.PI / 6 }))).toBeCloseTo(1.0199471, 7)
  })

  it('圖 6.7（決策樹）：C > 0／= 0／< 0 三個分支與對應的 pole', async () => {
    const g = await parseChart(diagrams.CHART_C_DECISION)
    const { edges, vertices } = g
    expect(decode(edge(edges, 'Q', 'P1').text ?? '')).toBe('C > 0')
    expect(decode(edge(edges, 'Q', 'P2').text ?? '')).toBe('C = 0')
    expect(decode(edge(edges, 'Q', 'P3').text ?? '')).toBe('C < 0')
    expect(nodeText(g, 'P1')).toContain('p = 1 − μ·K_q·C')
    expect(nodeText(g, 'P2')).toBe('p = 1')
    expect(nodeText(g, 'P3')).toContain('p = 1 + μ·K_q·|C|')
    expect(decode(nodeText(g, 'R1'))).toContain('0 < μ < 2 / (K_q·C)')
    expect(vertices.find((v) => v.id === 'R1')?.classes).toContain('ok')
    expect(vertices.find((v) => v.id === 'R2')?.classes).toContain('zero')
    expect(vertices.find((v) => v.id === 'R3')?.classes).toContain('warn')
    // 三個分支的 pole 與 μ 的上限，用 calPole() 驗
    const Kq = kqFromSigma(100)
    expect(calPole(10, Kq, 0.5)).toBeLessThan(1)
    expect(calPole(10, Kq, 0)).toBe(1)
    expect(calPole(10, Kq, -0.5)).toBeCloseTo(1 + 10 * Kq * 0.5, 14)
    expect(calPole(2 / (Kq * 0.5), Kq, 0.5)).toBeCloseTo(-1, 12)
    for (const mu of [10, 1, 0.1, 1e-6]) expect(calPole(mu, Kq, -0.25)).toBeGreaterThan(1)
  })

  it('圖 6.8（單頻）：兩條支路的相位是 +φ 與 −ΩD，結果是 cos(φ + ΩD)', async () => {
    const chart = diagrams.CHART_TONE_FLOW
    expect(chart).toContain('u[n] = A·|H|·cos(Ωn + φ)')
    expect(chart).toContain('x[n−D] = A·cos(Ωn − Ω·D)')
    expect(chart).toContain('(A²/2)·|H|·cos(2Ωn + φ − Ω·D)')
    expect(chart).toContain('C_D = (A²/2)·|H|·cos(φ + Ω·D)')
    const g = await parseChart(chart)
    expect(nodeText(g, 'H')).toContain('相位 + φ')
    expect(nodeText(g, 'DL')).toContain('相位 − Ω·D')
    expect(hasEdge(g.edges, 'X', 'H') && hasEdge(g.edges, 'X', 'DL') && hasEdge(g.edges, 'H', 'M') && hasEdge(g.edges, 'DL', 'M')).toBe(true)
    // 兩條支路的相位差 (+φ) − (−ΩD) 取 cos：T06（φ = 120°、Ω = π/6）D = 0 是 −0.25，D = 8 剛好轉回 360°
    const phi = (2 * Math.PI) / 3
    const omega = Math.PI / 6
    for (const D of [0, 3, 8]) {
      expect(toneCorrelation({ A: 1, mag: 1, phiRad: phi, omega, delay: D })).toBeCloseTo(0.5 * Math.cos(phi - -omega * D), 12)
    }
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: phi, omega })).toBeCloseTo(-0.25, 12)
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: phi, omega, delay: 8 })).toBeCloseTo(0.5, 12)
  })

  it('圖 6.9（單頻的邊界，E46）：Ω = 0 或 π 是一般式的 2 倍；有限 N 的 ripple 上界', async () => {
    const g = await parseChart(diagrams.CHART_TONE_EDGES)
    expect(nodeText(g, 'P')).toContain('x[n−D]·u[n] = (A²·|H|/2)·( cos(φ + Ω·D) + cos(2Ωn + φ − Ω·D) )')
    expect(nodeText(g, 'A1')).toContain('C_D = (A²/2)·|H|·cos(φ + Ω·D)')
    expect(nodeText(g, 'A2')).toContain('C_D = A²·H·cos(Ω·D)：一般式的 2 倍')
    expect(nodeText(g, 'A3')).toContain('(A²·|H|/2)·min(1, 1/(N·|sin Ω|))')
    // 交替碼（Ω = π）、H(e^jπ) = −1：C = A²·H = −1，是 (A²/2)·|H|·cos φ = −0.5 的 2 倍
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: Math.PI, omega: Math.PI })).toBeCloseTo(-1, 12)
    expect(toneCorrelation({ A: 1, mag: 1, phiRad: Math.PI, omega: Math.PI, delay: 1 })).toBeCloseTo(1, 12)
    // ripple 上界（E46 的數值：N = 1024、Ω = π − 0.01 ⇒ 0.04883；N = 64、Ω = 0.01 時 min 取 1）
    expect(toneRippleBound({ A: 1, mag: 1, omega: Math.PI - 0.01, N: 1024 })).toBeCloseTo(0.5 * Math.min(1, 1 / (1024 * Math.sin(0.01))), 12)
    expect(toneRippleBound({ A: 1, mag: 1, omega: Math.PI - 0.01, N: 1024 })).toBeCloseTo(0.04883, 5)
    expect(toneRippleBound({ A: 1, mag: 1, omega: 0.01, N: 64 })).toBeCloseTo(0.5, 12)
  })

  it('圖 6.10／6.11（Type-I vs Type-II）：回授都以−進入加法點；一個積分器 Re H 恆正，兩個積分器在 ω < ω_n 為負', async () => {
    const types = await parseChart(diagrams.CHART_LOOP_TYPES)
    expect(types.subgraphs).toHaveLength(2)
    expect(edge(types.edges, 'I1', 'S1').text).toMatch(/^− φ_fb/)
    expect(edge(types.edges, 'I2', 'S2').text).toMatch(/^− φ_fb/)
    expect(edge(types.edges, 'E1', 'S1').text).toBe('＋')
    expect(edge(types.edges, 'E2', 'S2').text).toBe('＋')
    // H_PD 是「從 e_PD（加法點的輸出）看」的轉移函數，所以結果那一格接在加法點上，不是接在 DCO 的輸出（那裡看到的是 T）
    expect(edge(types.edges, 'S1', 'R1').text).toBe('從 e_PD 看')
    expect(edge(types.edges, 'S2', 'R2').text).toBe('從 e_PD 看')
    expect(edge(types.edges, 'S1', 'R1').stroke).toBe('dotted')
    expect(hasEdge(types.edges, 'I1', 'R1') || hasEdge(types.edges, 'I2', 'R2')).toBe(false)
    expect(edge(types.edges, 'S1', 'K1').text).toBe('e_PD')
    expect(edge(types.edges, 'S2', 'PI').text).toBe('e_PD')
    // 比較圖：兩個迴路只在「迴路濾波器」那一格（與結果）不同，其餘的方塊與連線文字一模一樣
    expect(nodeText(types, 'E1')).toBe(nodeText(types, 'E2'))
    expect(nodeText(types, 'I1')).toBe(nodeText(types, 'I2'))
    expect(edge(types.edges, 'I1', 'S1').text).toBe(edge(types.edges, 'I2', 'S2').text)
    expect(nodeText(types, 'K1')).not.toBe(nodeText(types, 'PI'))
    expect(types.vertices.filter((v) => (v.classes ?? []).includes('focus')).map((v) => v.id)).toEqual(['PI'])
    expect(nodeText(types, 'K1')).toContain('ω_c')
    expect(nodeText(types, 'I1')).toContain('1/s')
    expect(nodeText(types, 'PI')).toContain('2ζ·ω_n + ω_n²/s')
    expect(nodeText(types, 'I2')).toContain('1/s')
    expect(diagrams.CHART_LOOP_TYPES).toContain('H_PD = s / (s + ω_c)')
    expect(diagrams.CHART_LOOP_TYPES).toContain('H_PD = s² / (s² + 2ζ·ω_n·s + ω_n²)')
    // 沿著圖上的方塊把開迴路乘起來（s = jν，頻率以迴路頻率正規化），1/(1 + L) 要等於封閉式 ctHpd()
    const zeta = 0.7
    for (const nu of [0.01, 0.3, 1, 2, 30]) {
      const s = c(0, nu)
      const L1 = cDiv(c(1), s) // ω_c · 1/s
      const L2 = cMul(cAdd(c(2 * zeta), cInv(s)), cInv(s)) // (2ζ·ω_n + ω_n²/s) · 1/s
      const H1 = cInv(cAdd(c(1), L1))
      const H2 = cInv(cAdd(c(1), L2))
      expect(H1.re).toBeCloseTo(ctHpd('typeI', nu).re, 12)
      expect(H1.im).toBeCloseTo(ctHpd('typeI', nu).im, 12)
      expect(H2.re).toBeCloseTo(ctHpd('typeII', nu, zeta).re, 12)
      expect(H2.im).toBeCloseTo(ctHpd('typeII', nu, zeta).im, 12)
      expect(H1.re).toBeGreaterThan(0)
      if (nu === 1) expect(Math.abs(H2.re)).toBeLessThan(1e-12)
      else expect(Math.sign(H2.re), `ν=${nu}`).toBe(nu < 1 ? -1 : 1)
    }
    // 規格 §6.1 的例子（T06）：ν = 0.3、ζ = 0.7 ⇒ −0.0815 + j0.0376
    expect(ctHpd('typeII', 0.3, 0.7).re).toBeCloseTo(-0.0815, 4)
    expect(ctHpd('typeII', 0.3, 0.7).im).toBeCloseTo(0.0376, 4)

    // 圖 6.11：低頻時 Type-II 是二次微分（H ≈ s²/ω_n² ⇒ 單頻 Re H ≈ −ν²），Type-I 是一次微分（H ≈ s/ω_c ⇒ 實部只剩二階的 +ν²）
    const dd = await parseChart(diagrams.CHART_DOUBLE_DIFF)
    expect(nodeText(dd, 'D1')).toContain('d/dt')
    expect(nodeText(dd, 'D2')).toContain('d/dt')
    expect(edge(dd.edges, 'D1', 'D2').text).toBe('x′')
    expect(edge(dd.edges, 'D2', 'G').text).toBe('x″')
    expect(nodeText(dd, 'G')).toBe('× 1/ω_n²')
    expect(edge(dd.edges, 'X', 'M').text).toContain('原始 x')
    expect(nodeText(dd, 'C')).toContain('C ≈ E[x·x″]/ω_n² = −E[(x′)²]/ω_n²')
    expect(edge(dd.edges, 'D1', 'T1').stroke).toBe('dotted')
    expect(nodeText(dd, 'T1')).toContain('E[x·x′] = 0')
    const nu = 0.01
    expect(ctHpd('typeII', nu, 0.7).re / -(nu * nu)).toBeCloseTo(1, 3)
    expect(ctHpd('typeI', nu).im / nu).toBeCloseTo(1, 3)
    expect(ctHpd('typeI', nu).re / (nu * nu)).toBeCloseTo(1, 3)
  })

  it('圖 6.12（DT 迴路）：沿著方塊乘起來就是 F-06.10，1/(1 + L) 等於網站模型 designPolarityLoop() 的頻率響應', async () => {
    const dt = await parseChart(diagrams.CHART_DT_LOOP)
    expect(edge(dt.edges, 'E', 'S').text).toBe('＋')
    expect(edge(dt.edges, 'DCO', 'S').text).toMatch(/^− φ_fb\[n\]/)
    // 迴路的順序：PI（K_p ∥ K_i/(1 − z⁻¹)）→ z^−d → DCO
    expect(edge(dt.edges, 'S', 'KP').text).toBe('e_PD[n]')
    expect(edge(dt.edges, 'S', 'KI').text).toBe('e_PD[n]')
    expect(edge(dt.edges, 'KP', 'S2').text).toBe('＋')
    expect(edge(dt.edges, 'KI', 'S2').text).toBe('＋')
    expect(hasEdge(dt.edges, 'S2', 'ZD') && hasEdge(dt.edges, 'ZD', 'DCO')).toBe(true)
    expect(nodeText(dt, 'KP')).toContain('K_p')
    expect(nodeText(dt, 'KI')).toContain('K_i / (1 − z⁻¹)')
    expect(nodeText(dt, 'ZD')).toContain('z^−d')
    expect(nodeText(dt, 'DCO')).toContain('z⁻¹ / (1 − z⁻¹)')
    for (const d of [0, 1, 2]) {
      const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, wLTs: 0.1, loopDelay: d })
      expect(des.Kp).toBeCloseTo(2 * 0.7 * 0.1, 14)
      expect(des.Ki).toBeCloseTo(0.1 * 0.1, 14)
      const omegas = [0.003, 0.03, 0.1, 0.5, 2]
      const ref = freqz(des.b, des.a, omegas)
      omegas.forEach((omega, i) => {
        const zi = expj(-omega) // z⁻¹
        const acc = cInv(cAdd(c(1), cMul(c(-1), zi))) // 1/(1 − z⁻¹)
        const pi = cAdd(c(des.Kp), cMul(c(des.Ki), acc)) // K_p ＋ K_i/(1 − z⁻¹)
        const L = cMul(cMul(pi, expj(-omega * d)), cMul(zi, acc)) // · z^−d · z⁻¹/(1 − z⁻¹)
        // 加法點：e = (＋1)·ε + (−1)·φ_fb，φ_fb = L·e
        const H = cInv(cAdd(c(1), L))
        expect(H.re, `d=${d} Ω=${omega}`).toBeCloseTo(ref[i].re, 10)
        expect(H.im, `d=${d} Ω=${omega}`).toBeCloseTo(ref[i].im, 10)
      })
      // DCO 自帶一拍延遲 ⇒ 嚴格因果：h[0] = 1；再加 d 拍 latency ⇒ h[1..d] = 0（圖 6.16、6.23 的「尖峰 h[0] = 1」）
      const h = impulseResponse(des.b, des.a, d + 3)
      expect(h[0]).toBeCloseTo(1, 14)
      for (let k = 1; k <= d; k++) expect(Math.abs(h[k]), `d=${d} h[${k}]`).toBeLessThan(1e-14)
      expect(Math.abs(h[d + 1])).toBeGreaterThan(0.1)
    }
  })

  it('圖 6.13（CT ↔ DT）：寫在圖上的邊界範圍「1.00 到 1.49 倍」就是 compareCtDt() 算出來的', () => {
    const nu = [0, 1].flatMap((d) => [0.01, 0.1, 0.3].map((w) => compareCtDt({ type: 'typeII', zeta: 0.7, wLTs: w, loopDelay: d }).dtBoundaryNu))
    expect(nu.every((v) => v !== null && Number.isFinite(v))).toBe(true)
    const values = nu as number[]
    expect(diagrams.CHART_CT_DT_MAP).toContain(`約 ${Math.min(...values).toFixed(2)} 到 ${Math.max(...values).toFixed(2)} 倍 ω_n`)
    expect(diagrams.CHART_CT_DT_MAP).toContain('K_p = 2ζ·ω_n·T_s，K_i = (ω_n·T_s)²')
    expect(diagrams.CHART_CT_DT_MAP).toContain('1 − z⁻¹ ≈ s·T_s')
    expect(diagrams.CHART_CT_DT_MAP).toContain('Ω = ω·T_s')
    expect(diagrams.CHART_CT_DT_MAP).toContain('z^−(1+d)')
    // 1 − z⁻¹ ≈ s·T_s：Ω = 0.01 時相對誤差約 Ω/2
    const omega = 0.01
    const diff = cAdd(c(1), cMul(c(-1), expj(-omega)))
    expect(Math.hypot(diff.re - 0, diff.im - omega) / omega).toBeLessThan(0.006)
  })

  it('圖 6.14（頻寬 → 迴路係數的手算流程）：圈號 ①–⑨ 各出現一次，等於 HC-06.6 的步驟數；圖上的每一格用網站的模型驗一次', async () => {
    const def = HANDCALCS.find((h) => h.id === 'HC-06.6')
    expect(def).toBeTruthy()
    const values = defaultValues(def!)
    const steps = def!.solve(values).steps
    const circled = '①②③④⑤⑥⑦⑧⑨'
    expect(steps).toHaveLength(circled.length)
    const g = await parseChart(diagrams.CHART_BW_FLOW)
    const all = g.vertices.map((v) => v.text ?? '').join('<br>')
    for (const ch of circled) expect(all.split(ch).length - 1, ch).toBe(1)
    // 先後順序：④ 與 ① 都算完才有 ⑤；K_p、K_i、ν 都要用 ω_n·T_s；ν 還要用 Ω
    for (const [a, b] of [['IN', 'R'], ['IN', 'B'], ['B', 'C3'], ['R', 'WN'], ['C3', 'WN'], ['WN', 'KP'], ['WN', 'KI'], ['IN', 'OM'], ['WN', 'NU'], ['OM', 'NU'], ['NU', 'Q']]) {
      expect(hasEdge(g.edges, a, b), `${a} → ${b}`).toBe(true)
    }
    expect(nodeText(g, 'B')).toContain('β = 1 + 2ζ²')
    expect(nodeText(g, 'C3')).toContain('c_3dB = ω_3dB / ω_n = √(β + √(β² + 1))')
    expect(nodeText(g, 'WN')).toContain('ω_n·T_s = 2π·(BW / f_ref) / c_3dB')
    expect(nodeText(g, 'KP')).toContain('K_p = 2ζ·ω_n·T_s')
    expect(nodeText(g, 'KI')).toContain('K_i = (ω_n·T_s)²')
    expect(nodeText(g, 'OM')).toContain('Ω = 2π·f / f_s')
    expect(nodeText(g, 'NU')).toContain('ν = Ω / (ω_n·T_s)')
    expect(edge(g.edges, 'Q', 'NEG').text).toBe('ν 小於 1')
    expect(edge(g.edges, 'Q', 'POS').text).toBe('ν 大於 1')
    expect(g.vertices.find((v) => v.id === 'NEG')?.classes).toContain('warn')
    expect(g.vertices.find((v) => v.id === 'POS')?.classes).toContain('ok')
    // 圈號對應的式子與手算題的步驟一致（步驟 1、2、4、5、6、7、8、9）
    expect(steps[0].tex).toContain('\\frac{\\mathrm{BW}}{f_{\\mathrm{ref}}}')
    expect(steps[1].tex).toContain('\\beta=1+2\\zeta^2')
    expect(steps[3].tex).toContain('\\sqrt{\\beta+\\sqrt{\\beta^2+1}}')
    expect(steps[4].tex).toContain('\\omega_nT_s=\\frac{2\\pi\\,(\\mathrm{BW}/f_{\\mathrm{ref}})}{c_{3\\mathrm{dB}}}')
    expect(steps[5].tex).toContain('K_p=2\\zeta\\,\\omega_nT_s')
    expect(steps[6].tex).toContain('K_i=(\\omega_nT_s)^2')
    expect(steps[7].tex).toContain('\\Omega=\\frac{2\\pi f}{f_s}')
    expect(steps[8].tex).toContain('\\nu=\\frac{\\Omega}{\\omega_nT_s}')
    // 照圖上的順序算一次（預設 f_ref = 100 MHz、BW = 1 MHz、ζ = 0.7、f = 0.2 MHz），和網站的 DT 迴路設計與手算題的答案比
    const { fref, bw, zeta, f } = values
    const r = bw / fref // ①
    const beta = 1 + 2 * zeta * zeta // ②
    const c3 = Math.sqrt(beta + Math.sqrt(beta * beta + 1)) // ③④
    const wn = (2 * Math.PI * r) / c3 // ⑤
    const Kp = 2 * zeta * wn // ⑥
    const Ki = wn * wn // ⑦
    const Omega = (2 * Math.PI * f) / fref // ⑧
    const nu = Omega / wn // ⑨
    const des = designPolarityLoop({ type: 'typeII', zeta, bwRatio: r, loopDelay: 0 })
    expect(wn).toBeCloseTo(des.wLTs, 12)
    expect(Kp).toBeCloseTo(des.Kp, 12)
    expect(Ki).toBeCloseTo(des.Ki, 12)
    expect(wn).toBeCloseTo(0.0306654, 7)
    expect(nu).toBeCloseTo(0.41, 2)
    const results = def!.solve(values).results
    const result = (symbol: string) => results.find((x) => x.symbol === symbol)!.value
    expect(result('\\omega_nT_s')).toBeCloseTo(wn, 12)
    expect(result('K_p')).toBeCloseTo(Kp, 12)
    expect(result('K_i')).toBeCloseTo(Ki, 12)
    expect(result('\\Omega')).toBeCloseTo(Omega, 12)
    expect(result('\\nu')).toBeCloseTo(nu, 12)
    // 菱形的兩個出口：ν < 1 時 CT 原型的 Re H 為負，ν > 1 為正；c_3dB 真的是 |T| = 1/√2 的頻率比
    expect(ctHpd('typeII', nu, zeta).re).toBeLessThan(0)
    expect(ctHpd('typeII', 1.5, zeta).re).toBeGreaterThan(0)
    const H = ctHpd('typeII', c3, zeta)
    expect(Math.hypot(1 - H.re, -H.im)).toBeCloseTo(Math.SQRT1_2, 12)
  })

  it('圖 6.15（頻譜加權）：三條譜線都以＋相加；預設 Type-II 迴路的 Re H 在低頻為負、ω_n·T_s 附近接近 0、高頻接近 +1', async () => {
    const g = await parseChart(diagrams.CHART_SPECTRAL_WEIGHT)
    for (const [l, m] of [['L1', 'M1'], ['L2', 'M2'], ['L3', 'M3']] as const) {
      expect(hasEdge(g.edges, l, m)).toBe(true)
      expect(edge(g.edges, m, 'S').text).toMatch(/^＋/)
    }
    expect(nodeText(g, 'C')).toContain('C = P₁·Re H(Ω₁) + P₂·Re H(Ω₂) + P₃·Re H(Ω₃)')
    expect(nodeText(g, 'C')).toContain('C = (1/2π) ∫ S_xx·Re H dΩ')
    expect(g.vertices.find((v) => v.id === 'M1')?.classes).toContain('warn')
    expect(g.vertices.find((v) => v.id === 'M3')?.classes).toContain('ok')
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
    const [lo, mid, hi] = freqz(des.b, des.a, [0.3 * des.wLTs, des.wLTs, 30 * des.wLTs]).map((z) => z.re)
    expect(lo).toBeLessThan(-0.05)
    expect(Math.abs(mid)).toBeLessThan(0.05)
    expect(hi).toBeGreaterThan(0.9)
    expect(hi).toBeLessThan(1.1)
    // C 的正負看誰的功率大：低頻為主 ⇒ 負；高頻為主 ⇒ 正
    const C = (P: number[]) => P[0] * lo + P[1] * mid + P[2] * hi
    expect(C([1, 0.2, 0.01])).toBeLessThan(0)
    expect(C([0.01, 0.2, 1])).toBeGreaterThan(0)
  })

  it('圖 6.16／6.17（一般式、兩個特例、兩條路線）：白色 code 只剩 h[D]，單頻回到 §4；時域與頻域路線通到同一個 C_D', async () => {
    const sp = await parseChart(diagrams.CHART_SPECIAL_CASES)
    expect(nodeText(sp, 'G')).toContain('C_D = Σ_k h[k]·R_x[k−D] = (1/2π) ∫ S_xx·Re( H·e^jΩD ) dΩ')
    expect(nodeText(sp, 'W')).toContain('C_D = h[D]·σ_x²')
    expect(nodeText(sp, 'W0')).toContain('h[0] = 1')
    expect(nodeText(sp, 'T')).toContain('C_D = (A²/2)·|H|·cos(φ + Ω₀·D)')
    // 單頻的 R_x[ℓ] = (A²/2)·cos(Ω₀ℓ) 代入時域路線 Σ_k h[k]·R_x[k−D]，要等於單頻公式（T06：D = 0 是 −0.25）
    const t = toneExample()
    for (const D of [0, 1, 5]) {
      const timeRoute = t.h.reduce((s, hk, k) => s + hk * 0.5 * Math.cos(t.omega * (k - D)), 0)
      expect(timeRoute).toBeCloseTo(toneCorrelation({ A: 1, mag: 1, phiRad: (2 * Math.PI) / 3, omega: t.omega, delay: D }), 12)
    }
    const routes = await parseChart(diagrams.CHART_TWO_ROUTES)
    for (const [a, b] of [['X', 'RX'], ['X', 'SXX'], ['P', 'HK'], ['P', 'HW'], ['RX', 'TD'], ['HK', 'TD'], ['SXX', 'FD'], ['HW', 'FD'], ['TD', 'C'], ['FD', 'C']]) {
      expect(hasEdge(routes.edges, a, b), `${a} → ${b}`).toBe(true)
    }
    expect(edge(routes.edges, 'RX', 'SXX').text).toBe('Wiener–Khinchin')
    expect(edge(routes.edges, 'HK', 'HW').text).toBe('DTFT')
    expect(nodeText(routes, 'TD')).toContain('Σ_k h[k]·R_x[k−D]')
    expect(nodeText(routes, 'FD')).toContain('(1/2π) ∫ S_xx·Re( H·e^jΩD ) dΩ')
  })

  it('圖 6.18／6.19／6.21／6.23（近整數）：圖上的係數就是 F-06.14／F-06.18（−12·frac·D + 12·frac²/K_i，且 12·frac²/K_i = (3/π²)·Δ²）', async () => {
    expect(diagrams.CHART_NEAR_INTEGER).toContain('C/σ_x² ≈ (3/π²)·Δ²')
    expect(diagrams.CHART_NEAR_INTEGER).toContain('Ω₀ = 2π·frac')
    expect(diagrams.CHART_NEAR_INTEGER).toContain('Δ = Ω₀ / (ω_n·T_s)')
    expect(diagrams.CHART_MOMENTS).toContain('C/σ_x² ≈ 12·frac² / K_i = (3/π²)·Δ²')
    expect(diagrams.CHART_NEAR_INTEGER_TREE).toContain('C_D/σ_x² ≈ −12·frac·D + 12·frac² / K_i')
    expect(diagrams.CHART_DELAY_MISALIGN).toContain('+12·frac² / K_i')
    expect(diagrams.CHART_DELAY_MISALIGN).toContain('−12·frac·D')
    // 圖 6.21：自相關的三項各乘一個動差，全部以＋進加法點（正負號寫在各項裡）
    const mo = await parseChart(diagrams.CHART_MOMENTS)
    expect(nodeText(mo, 'R')).toContain('R_x[k]/σ_x² ≈ 1 − 6·frac·k + 6·frac²·k²')
    expect(nodeText(mo, 'T1')).toContain('−6·frac·k')
    expect(nodeText(mo, 'T2')).toContain('+6·frac²·k²')
    expect(edge(mo.edges, 'T0', 'S').text).toMatch(/^＋.*m₀ = 0/)
    expect(edge(mo.edges, 'T1', 'S').text).toMatch(/^＋.*m₁ = 0/)
    expect(edge(mo.edges, 'T2', 'S').text).toMatch(/^＋.*m₂ = 2 \/ K_i/)
    // 用網站的模型驗算圖上的動差與兩項式（預設 Type-II 迴路）
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
    const h = impulseResponse(des.b, des.a, 8192)
    const [m0, m1, m2] = impulseMoments(h)
    expect(Math.abs(m0)).toBeLessThan(1e-10)
    expect(Math.abs(m1)).toBeLessThan(1e-8)
    expect(m2 / (2 / des.Ki)).toBeCloseTo(1, 9)
    // 圖 6.23：尖峰 h[0] = 1、之後的尾巴面積 −1；圖 6.22：步階響應 s[k] 全部加起來等於 0（正瓣面積 = 負瓣面積）
    expect(h[0]).toBeCloseTo(1, 14)
    let step = 0
    let stepSum = 0
    let stepAbs = 0
    let tail = 0
    for (let k = 0; k < h.length; k++) {
      step += h[k]
      stepSum += step
      stepAbs += Math.abs(step)
      if (k >= 1) tail += h[k]
    }
    expect(tail).toBeCloseTo(-1, 10)
    expect(Math.abs(stepSum) / stepAbs).toBeLessThan(1e-9)
    for (const frac of [5e-4, 2e-3]) {
      const delta = (2 * Math.PI * frac) / des.wLTs
      const second = (12 * frac * frac) / des.Ki
      expect(second).toBeCloseTo((3 / Math.PI ** 2) * delta ** 2, 12)
      expect(m0 - 6 * frac * m1 + 6 * frac * frac * m2).toBeCloseTo(second, 9)
      for (const D of [0, 1]) {
        const two = -12 * frac * D + second
        expect(Math.abs(sawtoothMomentApprox(h, frac, D) - two)).toBeLessThan(1e-6)
        // 圖 6.19 的分支：D 大於門檻 frac/K_i 才變號（D = 0 永遠是正的）
        expect(two < 0).toBe(D > frac / des.Ki)
      }
    }
    // 兩個例子各落在門檻的一邊（§6.4 表格）：frac = 5e-4 時 D = 1 已超過門檻 0.532；frac = 0.002 時門檻 2.13，D = 1 還沒翻
    expect(5e-4 / des.Ki).toBeCloseTo(0.532, 3)
    expect(2e-3 / des.Ki).toBeCloseTo(2.127, 3)
    // 圖 6.19 的結構：先問 D，再問 |δ| 或門檻；三個有公式的格子
    const tree = await parseChart(diagrams.CHART_NEAR_INTEGER_TREE)
    expect(decode(edge(tree.edges, 'Q1', 'Q2').text ?? '')).toMatch(/^D = 0/)
    expect(decode(edge(tree.edges, 'Q1', 'Q3').text ?? '')).toMatch(/^1 ≤ D ≤ d\+1/)
    expect(nodeText(tree, 'A1')).toContain('C/σ_x² ≈ 12·frac² / K_i')
    expect(tree.vertices.filter((v) => (v.classes ?? []).includes('warn')).map((v) => v.id).sort()).toEqual(['A2', 'A3'])
  })

  it('圖 6.20（鋸齒自相關）：菱形的兩個出口（機率 1 − t 與 t）對 θ 平均，就是 F-06.17 的 1 − 6t(1 − t)', async () => {
    const g = await parseChart(diagrams.CHART_SAW_AUTOCORR)
    expect(nodeText(g, 'TH')).toContain('x[n] = θ − 1/2')
    expect(edge(g.edges, 'Q', 'NW').text).toContain('機率 1 − t')
    expect(edge(g.edges, 'Q', 'WR').text).toContain('機率 t')
    expect(nodeText(g, 'NW')).toContain('x[n+ℓ] = θ + t − 1/2')
    expect(nodeText(g, 'WR')).toContain('x[n+ℓ] = θ + t − 3/2')
    expect(nodeText(g, 'R')).toContain('R_x[ℓ]/σ_x² = 1 − 6·t·(1 − t)')
    // 照圖做：θ 在 [0, 1) 均勻；θ + t < 1 用沒折返那一格，否則用折返那一格；中點法積分
    const M = 200000
    for (const [frac, lag] of [[0.1, 3], [0.002, 40], [0.25, 3]] as const) {
      const t = (lag * frac) % 1
      let acc = 0
      let wrapped = 0
      for (let i = 0; i < M; i++) {
        const theta = (i + 0.5) / M
        const wrap = theta + t >= 1
        if (wrap) wrapped++
        acc += (theta - 0.5) * (wrap ? theta + t - 1.5 : theta + t - 0.5)
      }
      const R = acc / M / (1 / 12)
      expect(wrapped / M).toBeCloseTo(t, 4)
      expect(R).toBeCloseTo(1 - 6 * t * (1 - t), 6)
      expect(R).toBeCloseTo(sawtoothAutocorr(frac)(lag), 6)
    }
  })

  it('圖 6.22（步階響應的兩瓣）：正的貢獻與負的貢獻都以＋進加法點；|δ| 小於 δ_c 同號、大於 δ_c 反號', async () => {
    const g = await parseChart(diagrams.CHART_STEP_LOBES)
    expect(nodeText(g, 'SR')).toContain('所有 s[k] 加起來等於 0')
    expect(nodeText(g, 'POS')).toContain('s[0] = 1')
    expect(edge(g.edges, 'E1', 'S').text).toBe('＋（值為正）')
    expect(edge(g.edges, 'E2', 'S').text).toBe('＋（值為負）')
    expect(edge(g.edges, 'R', 'A').text).toMatch(/小於 δ_c：同號/)
    expect(edge(g.edges, 'R', 'B').text).toMatch(/大於 δ_c：反號/)
    expect(g.vertices.find((v) => v.id === 'A')?.classes).toContain('ok')
    expect(g.vertices.find((v) => v.id === 'B')?.classes).toContain('warn')
  })

  it('圖 6.24（一個 GMAC block 的時序）：loop 框內是 sample rate、框外是 block rate；照圖上的箭頭逐步算，和 simulateSignLmsChain() 一模一樣', async () => {
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(diagrams.CHART_BLOCK_TIMING)
    const db = diagram.db as unknown as SeqDb
    expect([...db.getActors().keys()]).toEqual(['DTC', 'PLL', 'CMP', 'GMAC', 'W'])
    const T = db.LINETYPE
    const msgs = db.getMessages()
    expect(msgs.map((m) => m.type)).toEqual([T.NOTE, T.LOOP_START, T.SOLID, T.SOLID, T.SOLID, T.NOTE, T.LOOP_END, T.SOLID, T.NOTE, T.DOTTED])
    const route = (m: SeqMessage) => `${m.from}>${m.to}`
    // 框內（每個 sample n）：DTC → PLL → comparator → GMAC，最後累加
    expect(msgs[1].message).toMatch(/sample rate.*每個 sample n.*共 N 次/)
    expect(msgs.slice(2, 6).map(route)).toEqual(['DTC>PLL', 'PLL>CMP', 'CMP>GMAC', 'GMAC>GMAC'])
    expect(msgs[2].message).toBe('DTC 誤差 ε[n] = (a − w_k)·x[n]')
    expect(msgs[3].message).toBe('e_PD[n] = (h∗ε)[n] + v[n]')
    expect(msgs[4].message).toBe('q[n] = sign(e_PD[n])')
    expect(msgs[5].message).toBe('acc ← acc + q[n]·x[n−D]')
    // 框外（每個 block k）：平均成 G_k、更新 w、下一個 block 才改用新的 w
    expect(msgs.slice(7).map(route)).toEqual(['GMAC>W', 'W>W', 'W>DTC'])
    expect(msgs[7].message).toMatch(/block rate.*G_k = acc \/ N/)
    expect(msgs[8].message).toBe('w_(k+1) = w_k + μ·G_k')
    expect(msgs[9].message).toBe('block k+1 改用 w_(k+1)')
    expect(msgs[0].message).toMatch(/w_k 固定.*acc 歸零/)

    // 照圖做一次（FIR 路徑 h = [1, −√3]、D = 2、決定性的「雜訊」），和核心程式逐 block 比較
    const N = 12
    const blocks = 6
    const D = 2
    const a = 3
    const w0 = 0.5
    const mu = 10
    const sigmaV = 100
    const { h, x: xOf } = toneExample()
    const x = Float64Array.from({ length: N * blocks }, (_, n) => xOf(n))
    const noise = Float64Array.from({ length: N * blocks }, (_, n) => Math.sin(12.9898 * (n + 1)) * 0.9)
    let w = w0
    let n = 0
    let prevEps = 0 // 主 PLL 濾波器的狀態：跨 block 保留
    const deltaByDiagram: number[] = [a - w]
    const gByDiagram: number[] = []
    for (let k = 0; k < blocks; k++) {
      let acc = 0 // block k 開始：acc 歸零，w_k 固定
      for (let i = 0; i < N; i++, n++) {
        const eps = (a - w) * x[n] // DTC → PLL：ε[n] = (a − w_k)·x[n]
        const e = h[0] * eps + h[1] * prevEps + sigmaV * noise[n] // PLL → comparator：e_PD[n] = (h∗ε)[n] + v[n]
        prevEps = eps
        const q = e >= 0 ? 1 : -1 // comparator → GMAC：q[n] = sign(e_PD[n])
        acc += q * (n >= D ? x[n - D] : 0) // acc ← acc + q[n]·x[n−D]
      }
      const G = acc / N // GMAC → w：G_k = acc / N
      w = w + mu * G // w_(k+1) = w_k + μ·G_k
      gByDiagram.push(G)
      deltaByDiagram.push(a - w)
    }
    const path = { b: [h[0], h[1]], a: [1] }
    let i = 0
    const core = simulateSignLmsChain({ x, ref: buildRegressor(x, path, 'x', D), path, a, w0, mu, sigmaV, N, blocks, noise: () => noise[i++] })
    expect(i).toBe(N * blocks)
    expect(Array.from(core.G)).toHaveLength(blocks)
    core.G.forEach((G, k) => expect(G, `G_${k}`).toBeCloseTo(gByDiagram[k], 12))
    core.delta.forEach((d, k) => expect(d, `δ_${k}`).toBeCloseTo(deltaByDiagram[k], 10))
    // 這段模擬真的有在動（不是全零的巧合）
    expect(new Set(gByDiagram.map((G) => G.toFixed(6))).size).toBeGreaterThan(1)
  })

  it('圖 6.25（三種 regressor）：三個乘法器都接同一個 q[n]，差別只在另一個輸入；T06 的例子 raw-x 為負、delayed-x（D = 8）與 filtered-x 為正', async () => {
    const g = await parseChart(diagrams.CHART_REGRESSORS)
    for (const m of ['M1', 'M2', 'M3']) {
      expect(nodeText(g, m)).toBe('×')
      expect(hasEdge(g.edges, 'Q', m)).toBe(true)
    }
    expect(hasEdge(g.edges, 'X', 'M1')).toBe(true)
    expect(hasEdge(g.edges, 'X', 'DL') && hasEdge(g.edges, 'X', 'HH')).toBe(true)
    expect(nodeText(g, 'DL')).toContain('z^−D')
    expect(edge(g.edges, 'DL', 'M2').text).toBe('x[n−D]')
    expect(edge(g.edges, 'HH', 'M3').text).toBe('u_f = ĥ∗x')
    for (const [m, r] of [['M1', 'C1'], ['M2', 'C2'], ['M3', 'C3']] as const) expect(edge(g.edges, m, r).text).toBe('block 平均')
    expect(nodeText(g, 'C1')).toContain('相關 C = x·u 的平均')
    expect(nodeText(g, 'C2')).toContain('相關 C_D = x[n−D]·u[n] 的平均')
    expect(nodeText(g, 'C3')).toContain('相關 = u·u_f 的平均')
    expect(g.vertices.filter((v) => (v.classes ?? []).includes('focus')).map((v) => v.id).sort()).toEqual(['DL', 'HH'])
    const t = toneExample()
    expect(t.mean((n) => t.x(n) * t.u(n))).toBeCloseTo(-0.25, 12) // raw-x
    expect(t.mean((n) => t.x(n - 8) * t.u(n))).toBeCloseTo(0.5, 12) // delayed-x，D = 8：φ + ΩD = 360°
    expect(t.mean((n) => t.u(n) * t.u(n))).toBeCloseTo(0.5, 12) // filtered-x，ĥ = h：u² 的平均，不會是負的
  })

  it('圖 6.26（手算流程）：圈號 ①–⑪ 各出現在一個方塊，數量等於 HC-06.8 的步驟數', async () => {
    const def = HANDCALCS.find((h) => h.id === 'HC-06.8')
    expect(def).toBeTruthy()
    const steps = def!.solve(defaultValues(def!)).steps
    const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪'
    expect(steps).toHaveLength(circled.length)
    const { vertices, edges } = await parseChart(diagrams.CHART_HANDCALC_FLOW)
    for (const ch of circled) expect(vertices.filter((v) => (v.text ?? '').startsWith(ch) || (v.text ?? '').includes(`<br>${ch}`)).length, ch).toBe(1)
    // 一階項與二階項相加得到 C_D；D* 只是判斷用的旁支（虛線）
    expect(edge(edges, 'T1', 'S').text).toBe('＋')
    expect(edge(edges, 'T2', 'S').text).toBe('＋')
    expect(edge(edges, 'DS', 'CD').stroke).toBe('dotted')
    expect(edge(edges, 'DS', 'CD').text).toBe('D 大於 D⋆ 時 ⑧ 是負的')
    // 先後順序：K_i 要先算（門檻與二階項都用到它）；C_D 與 K_q 都算完才有 g，再有 p
    for (const [a, b] of [['KI', 'DS'], ['KI', 'T2'], ['S', 'CD'], ['CD', 'G'], ['KQ', 'G'], ['G', 'P']]) expect(hasEdge(edges, a, b), `${a} → ${b}`).toBe(true)
    // 圈號對應的式子與手算題的步驟一致（步驟 1、5、6、7、9、11）
    expect(steps[0].tex).toContain('K_i=(\\omega_nT_s)^2')
    expect(steps[4].tex).toContain('D^*=\\frac{\\mathrm{frac}}{K_i}')
    expect(steps[5].tex).toContain('-12\\,\\mathrm{frac}\\,D')
    expect(steps[6].tex).toContain('\\frac{12\\,\\mathrm{frac}^2}{K_i}')
    expect(steps[8].tex).toContain('K_q=')
    expect(steps[10].tex).toContain('p=1-g')
  })
})

/* ───────────────────────── 頁面：位置 ───────────────────────── */

function renderChapter() {
  return render(
    <MemoryRouter initialEntries={['/ch/06']}>
      <SettingsProvider>
        <Chapter06 />
      </SettingsProvider>
    </MemoryRouter>,
  )
}

/** KaTeX 的 MathML annotation 保留 TeX 原始碼 */
function texSources(el: Element): string[] {
  return Array.from(el.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
}

function follows(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

/** 圖放在「對應的公式（推導）之前」：[圖, 公式錨點] */
const BEFORE_FORMULA: [string, string][] = [
  ['D-06.2', 'F-06.6'],
  ['D-06.3', 'F-06.6'],
  ['D-06.4', 'F-06.1'],
  ['D-06.5', 'F-06.2'],
  ['D-06.6', 'F-06.3'],
  ['D-06.8', 'F-06.4'],
  ['D-06.9', 'F-06.5'],
  ['D-06.10', 'F-06.7'],
  ['D-06.10', 'F-06.8'],
  ['D-06.11', 'F-06.9'],
  ['D-06.12', 'F-06.10'],
  ['D-06.15', 'F-06.11'],
  ['D-06.15', 'F-06.12'],
  ['D-06.16', 'F-06.13'],
  ['D-06.18', 'F-06.17'],
  ['D-06.19', 'F-06.17'],
  ['D-06.20', 'F-06.17'],
  ['D-06.21', 'F-06.14'],
  ['D-06.22', 'F-06.18'],
  ['D-06.23', 'F-06.18'],
]

/** 符號表移到章末之後，正文要在符號第一次出現的那一節就地解釋：[節, 那一節出現的 TeX, 就地解釋的關鍵字] */
const FIRST_USE: [string, string, RegExp][] = [
  ['ch06-s1', 'C=E[x\\,u]', /逐拍相乘再平均就是相關/],
  ['ch06-s1', '\\mu', /learning rate/],
  ['ch06-s1', 'u=h*x', /脈衝響應[\s\S]*卷積/],
  ['ch06-s1', '\\delta=a-w', /參數誤差（真實 gain/],
  ['ch06-s1', '\\sigma_v', /comparator 前雜訊的 RMS/],
  ['ch06-s1', 'K_q=\\sqrt{2/\\pi}/\\sigma_v', /comparator 小訊號增益/],
  ['ch06-s1', 'p=1-\\mu K_qC', /被乘上的倍數（pole）/],
  ['ch06-s2', 'L', /開迴路增益（訊號沿迴路繞一圈被乘上的倍數）/],
  ['ch06-s2', '\\varepsilon', /時間誤差，記作/],
  ['ch06-s2', '\\varphi_{\\mathrm{fb}}', /記作回授修正/],
  ['ch06-s2', 'T=L/(1+L)', /closed-loop 轉移函數/],
  ['ch06-s2', 'D', /把 code 延遲的 sample 數/],
  ['ch06-s3', 'G_k', /個 block 的 GMAC 平均輸出/],
  ['ch06-s3', 'N', /每個 block 的 sample 數/],
  ['ch06-s3', 'g=\\mu K_qC', /normalized loop gain/],
  ['ch06-s4', 'A', /是 code 的振幅/],
  ['ch06-s4', '\\Omega', /離散角頻率（每個 sample 相位前進多少/],
  ['ch06-s4', '\\phi', /是它加上的相位/],
  ['ch06-s5', '\\omega_c', /開迴路交越頻率/],
  ['ch06-s5', '\\zeta', /是阻尼比/],
  ['ch06-s5', '\\nu=\\omega/\\omega_L', /迴路頻率[\s\S]*正規化的頻率/],
  ['ch06-s5', 'K=\\omega_cT_s', /Type-I DPLL 的迴路增益/],
  ['ch06-s5', 'T_s', /取樣週期/],
  ['ch06-s5', 'K_p', /是比例增益/],
  ['ch06-s5', '\\mathrm{BW}', /closed-loop\s+頻寬/],
  ['ch06-s5', 'c_{3\\mathrm{dB}}=\\omega_{3\\mathrm{dB}}/\\omega_n', /頻寬是自然頻率的幾倍，記作/],
  ['ch06-s6', 'S_{xx}(e^{j\\Omega})', /功率分布在哪些頻率/],
  ['ch06-s6', 'R_x[\\ell]=E\\big[x[n]\\,x[n+\\ell]\\big]', /自己平移/],
  ['ch06-s6', '\\sigma_x^2=E[x^2]', /code 的總功率/],
  ['ch06-s6', '\\mathrm{frac}', /FCW（frequency control word）是 PLL 的除頻比/],
  ['ch06-s6', '\\Delta=\\Omega_0/(\\omega_nT_s)', /鋸齒基頻相對於迴路自然頻率的比值/],
  ['ch06-s6', 'm_j=\\sum_kk^j\\,h[k]', /動差/],
  ['ch06-s6', 'E[G](\\delta)', /把參數誤差固定在[\s\S]*時 GMAC\s*的平均輸出/],
  ['ch06-s6', 's[k]=\\sum_{j\\le k}h[j]', /步階響應/],
]

describe('第 06 章頁面：系統地圖、方塊圖的位置、符號表在章末', () => {
  it(`頁面畫出 <SystemMap> 與 ${N_DIAGRAMS} 張方塊圖（Engineer 模式）；每張圖在登錄的那一節、在對應公式之前，下方有「怎麼看圖」與公式對照`, () => {
    const { container } = renderChapter()
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(N_DIAGRAMS + 1)

    // 系統地圖：在開場白之後、目錄與 §1 之前；圖說沒有 Unicode 拼的數學；旁邊有一句「你在這裡」
    const map = figures[0]
    expect(map.getAttribute('aria-label')).toMatch(/^DTC-based Fractional-N PLL 與 Sign-LMS 校正迴路的系統方塊圖/)
    expect(map.getAttribute('aria-label')).toMatch(/本章重點：DTC、Phase detector/)
    const lead = container.querySelector('.ch06-lead')!
    const toc = container.querySelector('.ch06-toc')!
    const s1 = container.querySelector('#ch06-s1')!
    expect(follows(lead, map)).toBe(true)
    expect(follows(map, toc)).toBe(true)
    expect(follows(map, s1)).toBe(true)
    expect(map.querySelector('figcaption')!.textContent).toMatch(/^系統地圖：藍色是本章的主角/)
    expect(map.querySelector('figcaption')!.textContent).not.toMatch(UNICODE_MATH_DOM)
    const note = container.querySelector('.ch06-map-note')!
    expect(follows(map, note)).toBe(true)
    expect(follows(note, toc)).toBe(true)
    expect(note.textContent).toMatch(/你在這裡：[\s\S]*主 PLL 迴路[\s\S]*這一章補上/)
    expect(texSources(note)).toContain('H_{\\mathrm{PD}}=1/(1+L)')

    // 頁面上的 Mermaid 原始碼 = 系統地圖 + 登錄的每一張（各恰好一次，順序就是圖號）：頁面上沒有未經測試的圖
    const rendered = figures.map((f) => f.getAttribute('data-chart'))
    expect(rendered[0]).toBe(systemMapChart([...SYSTEM_FOCUS]))
    expect(rendered[0]).toContain('class DTC,PD,LF,VCO,DIV,CMP,GMAC focus')
    expect(rendered.slice(1)).toEqual(CH06_DIAGRAMS.map((d) => d.chart))

    for (const d of CH06_DIAGRAMS) {
      const el = container.querySelector(`[id="diagram-${d.id}"]`)
      expect(el, d.id).not.toBeNull()
      expect(el!.closest('section.ch06-section')!.id, d.id).toBe(d.section)
      expect(el!.getAttribute('data-diagram-kind')).toBe(d.kind)
      // 圖說：圖號 + 標題 + 要看什麼；`$...$` 交給 KaTeX，沒有落單的 $、沒有 Unicode 拼的數學
      const fig = el!.querySelector('figure.c-mermaid')!
      expect(fig.getAttribute('data-caption'), d.id).toBe(`圖 ${d.no}：${d.title}。${d.caption}`)
      const cap = fig.querySelector('figcaption')!
      expect(cap.querySelectorAll('.katex').length, d.id).toBe([...d.caption.matchAll(INLINE_MATH)].length)
      expect(cap.querySelectorAll('.katex-error'), d.id).toHaveLength(0)
      const capText = cap.cloneNode(true) as Element
      capText.querySelectorAll('.katex').forEach((n) => n.remove())
      expect(capText.textContent, d.id).toMatch(new RegExp(`^圖 ${d.no.replace('.', '\\.')}：`))
      expect(capText.textContent, d.id).not.toMatch(/\$/)
      expect(capText.textContent, d.id).not.toMatch(UNICODE_MATH_DOM)
      // 圖下方的說明：先看…再看…，以及「圖上的 X 就是公式裡的 x」（數學用 KaTeX）
      const read = el!.querySelector('.ch06-diagram-read')
      expect(read, d.id).not.toBeNull()
      expect(read!.querySelector('.ch06-diagram-badge')!.textContent).toBe(`怎麼看圖 ${d.no}`)
      expect(read!.querySelectorAll('p').length, d.id).toBeGreaterThanOrEqual(2)
      expect(read!.textContent, d.id).toMatch(/先看|先問|先算|先找|先比較|先沿|從上往下|從最上面|逐列對照|跟著圈號|三個乘法器/)
      expect(read!.textContent, d.id).toMatch(/就是/)
      expect(read!.querySelectorAll('.katex').length, d.id).toBeGreaterThan(0)
      // 圖不放在可收合的推導框或先備知識框裡（Beginner 模式也看得到）
      expect(el!.closest('details'), d.id).toBeNull()
    }
    for (const [diagramId, formulaId] of BEFORE_FORMULA) {
      const dEl = container.querySelector(`[id="diagram-${diagramId}"]`)!
      const fEl = container.querySelector(`[id="formula-${formulaId}"]`)
      expect(fEl, formulaId).not.toBeNull()
      expect(follows(dEl, fEl!), `${diagramId} 應在 ${formulaId} 之前`).toBe(true)
    }
    // 頻寬的手算流程圖在它的推導與手算題 HC-06.6 之前（同在 §5）
    expect(follows(container.querySelector('[id="diagram-D-06.14"]')!, container.querySelector('#ch06-s5 [id="handcalc-HC-06.6"]')!)).toBe(true)
    expect(follows(container.querySelector('[id="formula-F-06.10"]')!, container.querySelector('[id="diagram-D-06.14"]')!)).toBe(true)
    // 時序圖在 §7 的實驗之前；三種 regressor 的圖在比較表之前；綜合手算的流程圖在手算題之前
    const s7 = container.querySelector('#ch06-s7')!
    expect(follows(container.querySelector('[id="diagram-D-06.24"]')!, s7.querySelector('[id="exp-polarity-explorer"]')!)).toBe(true)
    const s8 = container.querySelector('#ch06-s8')!
    expect(follows(container.querySelector('[id="diagram-D-06.25"]')!, s8.querySelector('table')!)).toBe(true)
    expect(follows(container.querySelector('[id="diagram-D-06.26"]')!, s8.querySelector('[id="handcalc-HC-06.8"]')!)).toBe(true)
    // 正文提到的圖號都存在（「圖 6.n」）
    const mentioned = new Set([...(container.textContent ?? '').matchAll(/圖 6\.(\d+)/g)].map((m) => Number(m[1])))
    for (const n of mentioned) expect(n, `正文提到圖 6.${n}`).toBeLessThanOrEqual(N_DIAGRAMS)
    expect(mentioned.size).toBe(N_DIAGRAMS)
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
  }, 240000)

  it('符號表在章末（#symbols 是頁面最後一個區塊，在本課必記之後）；章首只有一行會捲到它的連結；符號第一次出現時正文就地說明', () => {
    const scrollSpy = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollSpy
    try {
      const { container } = renderChapter()
      const root = container.querySelector('.ch06')!
      const symbols = container.querySelector('#symbols')!
      expect(symbols).not.toBeNull()
      // 最後一個區塊
      expect(root.lastElementChild).toBe(symbols)
      expect(container.querySelectorAll('[id="symbols"]')).toHaveLength(1)
      expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
      expect(symbols.querySelector('.c-symbols')).not.toBeNull()
      expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(CH06_SYMBOLS.length)
      expect(CH06_SYMBOLS.length).toBeGreaterThanOrEqual(30)
      // 在 §8（含「本課必記」Recap、硬體對應）之後；符號表之後沒有任何方塊圖或小節
      const s8 = container.querySelector('#ch06-s8')!
      expect(follows(s8, symbols)).toBe(true)
      expect(follows(container.querySelector('.c-recap')!, symbols)).toBe(true)
      expect(s8.contains(symbols)).toBe(false)
      for (const el of Array.from(container.querySelectorAll('figure.c-mermaid, section.ch06-section'))) expect(follows(el, symbols)).toBe(true)
      // 章首（§1 之前）沒有符號表，只有一行連結
      const s1 = container.querySelector('#ch06-s1')!
      const link = container.querySelector('.ch06-symbols-link')!
      expect(follows(link, s1)).toBe(true)
      expect(link.textContent).toMatch(/^本章符號表在最後 ↓/)
      const button = link.querySelector('button')!
      expect(button.textContent).toBe('本章符號表在最後 ↓')
      // HashRouter 下不能用 href="#symbols"（會被當成路由）：整頁沒有這種連結，改用 scrollIntoView
      expect(container.querySelectorAll('a[href="#symbols"], a[href$="#symbols"]')).toHaveLength(0)
      expect(link.querySelectorAll('a')).toHaveLength(0)
      fireEvent.click(button)
      expect(scrollSpy).toHaveBeenCalledTimes(1)
      expect(scrollSpy.mock.instances[0]).toBe(symbols)
      // 目錄最後一項也捲到符號表
      const tocButtons = Array.from(container.querySelectorAll('.ch06-toc button'))
      expect(tocButtons[tocButtons.length - 1].textContent).toBe('本章符號表（章末）')
      fireEvent.click(tocButtons[tocButtons.length - 1])
      expect(scrollSpy.mock.instances[1]).toBe(symbols)
      // 符號表的極性與定義和圖一致：δ = a − w、q = sign(e_PD)（e_PD 已含雜訊）
      const tex = texSources(symbols)
      expect(tex).toEqual(expect.arrayContaining(['\\delta_k=a-w_k', '\\operatorname{sign}(e_{\\mathrm{PD}}[n])', 'e_{\\mathrm{PD}}\\approx(a-w_k)\\,u+v']))
      expect(tex).not.toContain('\\operatorname{sign}(e_{\\mathrm{PD}}+v)')
      expect(symbols.querySelectorAll('.katex-error')).toHaveLength(0)

      // 符號表移到最後之後：每個符號第一次出現的那一節，正文要就地用一句話說明
      const sectionCache = new Map<string, { tex: Set<string>; text: string }>()
      const sectionInfo = (id: string) => {
        let info = sectionCache.get(id)
        if (!info) {
          const section = container.querySelector(`#${id}`)!
          // 扣掉 KaTeX 之後的文字（公式不算在說明裡）
          const clone = section.cloneNode(true) as Element
          clone.querySelectorAll('.katex').forEach((n) => n.remove())
          info = { tex: new Set(texSources(section)), text: clone.textContent ?? '' }
          sectionCache.set(id, info)
        }
        return info
      }
      for (const [sectionId, texNeedle, explanation] of FIRST_USE) {
        const info = sectionInfo(sectionId)
        expect(info.tex.has(texNeedle), `${sectionId} 應出現 ${texNeedle}`).toBe(true)
        expect(explanation.test(info.text), `${sectionId} 應就地說明 ${texNeedle}（${explanation}）`).toBe(true)
      }
      // 符號表每一列都有「首次出現」的小節，而且指向存在的節
      for (const row of CH06_SYMBOLS) {
        expect(row.firstSeen, row.symbol).toMatch(/^§[1-8]/)
        const n = /^§(\d)/.exec(row.firstSeen ?? '')![1]
        expect(container.querySelector(`#ch06-s${n}`), row.symbol).not.toBeNull()
      }
    } finally {
      Element.prototype.scrollIntoView = original
    }
  }, 240000)
})
