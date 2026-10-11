import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { SettingsProvider } from '@/app/settings'
import { conventionalStep, fixedXPole } from '@/simulation/models/lms'
import * as D from './diagrams'
import { CHART_LMS_LOOP, CHART_MATCH_DECISION, CHART_UNIFIED_LOOP, GALLERY_CHARTS, PRESET_FLOW, THREE_QUESTIONS } from './diagrams'
import { GALLERY_SLOTS } from './data'
import { acceptHalfWidth, EXACT_REL, extractNumbers, findExpectedMatch, PRECISE_REL } from './format'
import GalleryPage from './index'
import { CHECK_SYMBOLS, MODEL_SYMBOLS } from './symbols'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
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

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊。 */
async function flow(chart: string): Promise<{ vertices: Vertex[]; edges: Edge[] }> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

function edgeText(g: { edges: Edge[] }, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e.text ?? ''
}

const nodeText = (g: { vertices: Vertex[] }, id: string): string => g.vertices.find((v) => v.id === id)?.text ?? ''

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
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

describe('Gallery 的 Mermaid 圖：清單', () => {
  it('共 5 張；diagrams.ts 匯出的每一張都在清單裡（沒有漏掉沒測到的圖）', () => {
    expect(GALLERY_CHARTS.map((c) => c.name)).toEqual(['PRESET_FLOW', 'CHART_LMS_LOOP', 'CHART_MATCH_DECISION', 'CHART_UNIFIED_LOOP', 'THREE_QUESTIONS'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(GALLERY_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(GALLERY_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    expect(new Set(GALLERY_CHARTS.map((c) => c.chart)).size).toBe(GALLERY_CHARTS.length)
  })
})

describe('Gallery 的 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    installMermaidSvgShim()
  })

  it.each([
    ['preset 的兩條路', PRESET_FLOW],
    ['三個問題', THREE_QUESTIONS],
    ['#1 的 LMS 迴路', CHART_LMS_LOOP],
    ['相符判據的判定流程', CHART_MATCH_DECISION],
    ['統一觀點的迴路', CHART_UNIFIED_LOOP],
  ])('%s 可以解析成 flowchart', async (_name, chart) => {
    const r = await mermaid.parse(chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })

  it('流程圖的關鍵節點：useUrlPreset、previewPreset、checkExpected、同一組模型函式', () => {
    for (const s of ['useUrlPreset(experiment)', 'previewPreset(preset)', 'checkExpected', 'src/simulation/models 的同一組函式', '?preset=id']) expect(PRESET_FLOW).toContain(s)
  })

  it('三個問題的分組與 GALLERY_SLOTS.questions 一致（每個 preset 至少出現在它的第一個問題下）', () => {
    const line = (q: string) => new RegExp(`${q}[^\\n]*--> S\\d\\["preset ([\\d, ]+)"\\]`).exec(THREE_QUESTIONS)?.[1].split(',').map((x) => Number(x.trim())) ?? []
    const groups = { converge: line('Q1\\["問題一'), where: line('Q2\\["問題二'), noise: line('Q3\\["問題三') }
    expect(groups.converge.length + groups.where.length + groups.noise.length).toBe(12)
    for (const s of GALLERY_SLOTS) {
      const listed = (Object.keys(groups) as (keyof typeof groups)[]).filter((q) => groups[q].includes(s.index))
      expect(listed, `#${s.index}`).toHaveLength(1)
      expect(s.questions, `#${s.index}`).toContain(listed[0])
    }
  })

  it('每張圖不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法；加法點的每條輸入都標了正負號', async () => {
    for (const c of GALLERY_CHARTS) {
      const g = await flow(c.chart)
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
    // 兩張迴路圖各有兩個加法點
    for (const chart of [CHART_LMS_LOOP, CHART_UNIFIED_LOOP]) expect((await flow(chart)).vertices.filter((v) => v.type === 'circle' && v.text === '＋')).toHaveLength(2)
  }, 60000)

  it('#1 的 LMS 迴路：極性與公式一致（e_n = y_n − w_n·x、w_(n+1) = w_n + μ·e_n·x），照著圖算的結果就是 conventionalStep', async () => {
    const g = await flow(CHART_LMS_LOOP)
    expect(edgeText(g, 'BOX', 'S1')).toBe('＋ y_n = a·x') // 量測為正
    expect(edgeText(g, 'PRED', 'S1')).toBe('− w_n·x') // 預測為負
    expect(edgeText(g, 'S1', 'GAIN')).toBe('e_n = y_n − w_n·x')
    expect(edgeText(g, 'GAIN', 'S2')).toBe('＋ μ·e_n·x')
    expect(edgeText(g, 'Z', 'S2')).toBe('＋ w_n')
    expect(edgeText(g, 'S2', 'Z')).toBe('w_(n+1) = w_n + μ·e_n·x')
    expect(nodeText(g, 'Z')).toContain('z⁻¹')
    expect(nodeText(g, 'GAIN')).toContain('× μ·x')
    // 回授：z⁻¹ 的輸出（w_n）回到預測方塊
    expect(g.edges.some((e) => e.start === 'Z' && e.end === 'PRED')).toBe(true)
    // 照著圖上的方塊做一遍（T01 的輸入），每一步都和模型函式相同
    const [a, x, mu] = [3, 2, 0.1]
    let w = 1
    for (let n = 0; n < 3; n++) {
      const y = a * x // 黑盒子：× a
      const e = y - w * x // 加法點：＋ y_n、− w_n·x
      const next = w + mu * e * x // 修正量 × μ·x，加回 w_n
      const step = conventionalStep({ w, x, y, mu })
      expect(e).toBe(step.e)
      expect(next).toBe(step.w)
      expect(a - next).toBeCloseTo(fixedXPole(mu, x) * (a - w), 12)
      w = next
    }
    expect(w).toBeCloseTo(2.568, 12)
  })

  it('相符判據的判定流程：三條分支就是 acceptHalfWidth／findExpectedMatch 的三種結果；圖上的 0.01 與 10⁻⁹ 就是程式的常數', async () => {
    const g = await flow(CHART_MATCH_DECISION)
    expect(PRECISE_REL).toBe(0.01)
    expect(EXACT_REL).toBe(1e-9)
    expect(nodeText(g, 'H')).toContain('Δ_t = ½·10^(e − n_d)')
    expect(nodeText(g, 'Q1')).toContain('Δ_t ≤ 0.01·|y_t|')
    expect(nodeText(g, 'W1')).toContain('W = k_tol·Δ_t')
    expect(nodeText(g, 'W2')).toContain('W = 10⁻⁹·max(1, |y_t|)')
    expect(nodeText(g, 'CMP')).toContain('|ŷ − y_t| ≤ W')
    // 圖的走向：H → Q1 →（是）W1 → CMP；Q1 →（否）Q2 →（是）W2 → CMP；Q2 →（否）SKIP；CMP → OK / BAD
    expect(edgeText(g, 'Q1', 'W1')).toMatch(/^是/)
    expect(edgeText(g, 'Q1', 'Q2')).toMatch(/^否/)
    expect(edgeText(g, 'Q2', 'W2')).toBe('是')
    expect(edgeText(g, 'Q2', 'SKIP')).toBe('否')
    expect(edgeText(g, 'CMP', 'OK')).toBe('是')
    expect(edgeText(g, 'CMP', 'BAD')).toMatch(/^否/)
    for (const from of ['W1', 'W2', 'Y']) expect(g.edges.some((e) => e.start === from && e.end === 'CMP'), from).toBe(true)
    // 節點 T 的例子：2.28 ⇒ n_d = 2、e = 0 ⇒ Δ_t = 0.005，夠精確 ⇒ W = k·Δ_t
    const [n228] = extractNumbers('2.28')
    expect(n228.tol).toBeCloseTo(0.005, 15)
    expect(n228.tol <= PRECISE_REL * Math.abs(n228.value)).toBe(true)
    expect(acceptHalfWidth(n228, 1, true)).toBe(n228.tol)
    expect(acceptHalfWidth(n228, 1, false)).toBe(n228.tol)
    // 短數字 1.8：必備 ⇒ 只接受相等；非必備 ⇒ 不拿來當證據（半寬 −1，永遠對不上）
    const [n18] = extractNumbers('1.8')
    expect(n18.tol <= PRECISE_REL * Math.abs(n18.value)).toBe(false)
    expect(acceptHalfWidth(n18, 1, true)).toBe(EXACT_REL * Math.max(1, 1.8))
    expect(acceptHalfWidth(n18, 1, false)).toBe(-1)
    expect(findExpectedMatch(1.8, [n18], 1.001, true)).toBe(n18)
    expect(findExpectedMatch(1.8, [n18], 1.001, false)).toBeNull()
    expect(findExpectedMatch(1.84, [n18], 1.001, true)).toBeNull() // 四捨五入後是 1.8，但不相等
    // 夠精確的數字：落在捨入半寬內才相符
    expect(findExpectedMatch(2.2849, [n228], 1.001, true)).toBe(n228)
    expect(findExpectedMatch(2.2851, [n228], 1.001, true)).toBeNull()
  })

  it('統一觀點的迴路：δ_k = a − w_k、G_k = K·δ_k + B + η_k、w_(k+1) = w_k + μ·G_k；照著圖迭代會停在 w* = a + B/K，pole 是 1 − μK', async () => {
    const g = await flow(CHART_UNIFIED_LOOP)
    expect(edgeText(g, 'A', 'S1')).toBe('＋') // 真值為正
    expect(edgeText(g, 'ACC', 'S1')).toMatch(/^−.*w_k/) // 回授的 w_k 為負
    expect(edgeText(g, 'S1', 'KB')).toBe('δ_k = a − w_k')
    expect(edgeText(g, 'KB', 'S2')).toMatch(/^＋/)
    expect(edgeText(g, 'B', 'S2')).toBe('＋')
    expect(edgeText(g, 'ETA', 'S2')).toBe('＋')
    expect(edgeText(g, 'S2', 'MU')).toBe('G_k = K·δ_k + B + η_k')
    expect(nodeText(g, 'ACC')).toContain('1/(z−1)')
    expect(nodeText(g, 'ACC')).toContain('w_(k+1) = w_k + μ·G_k')
    // 三個問題各一種顏色
    expect(CHART_UNIFIED_LOOP).toContain('class KB focus')
    expect(CHART_UNIFIED_LOOP).toContain('class B alt')
    expect(CHART_UNIFIED_LOOP).toContain('class ETA third')
    // 照著圖迭代（η = 0）：誤差每步乘 p = 1 − μK，停在 w* = a + B/K（#7 的數字：a = 1、B/K = 0.34）
    const [a, K, B, mu] = [1, 0.5, 0.17, 0.4]
    const p = 1 - mu * K
    const wStar = a + B / K
    let w = 0
    for (let k = 0; k < 200; k++) {
      const delta = a - w
      const G = K * delta + B
      const next = w + mu * G
      expect(next - wStar).toBeCloseTo(p * (w - wStar), 12)
      w = next
    }
    expect(w).toBeCloseTo(1.34, 12)
  })

  it('實際渲染（共用的 renderMermaidForTest）：每張圖都畫得出來，沒有「Unsupported markdown」、節點數 ≤ 14，畫面上的每個標籤都和原始碼相同', async () => {
    for (const c of GALLERY_CHARTS) {
      const { svg, text, nodeCount } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(nodeCount, c.name).toBeLessThanOrEqual(14)
      expect(nodeCount, c.name).toBeGreaterThanOrEqual(4)
      const host = document.createElement('div')
      host.innerHTML = svg
      const shown = new Set(Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel')).map((e) => plain(e.textContent ?? '')))
      const g = await flow(c.chart)
      expect(nodeCount, `${c.name}：畫出來的節點數 = 解析出來的節點數`).toBe(g.vertices.length)
      for (const v of g.vertices) expect(shown.has(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text) expect(shown.has(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
    }
  }, 120000)
})

describe('Gallery 頁面上的方塊圖與符號表（teaching-style §5、§8）', () => {
  it('5 張圖各出現一次、順序與清單相同、都有圖說；新的三張有「先看…」導讀並放在對應公式之前；符號表在頁尾（id="symbols"），頁首只留一行按鈕', async () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/gallery']}>
          <GalleryPage />
        </MemoryRouter>
      </SettingsProvider>,
    )
    await waitFor(
      () => {
        expect(container.querySelector('[data-experiment="gallery-inspector"]')).toBeTruthy()
        expect(container.querySelector('.c-code-compare')).toBeTruthy()
      },
      { timeout: 20000 },
    )
    const before = (a: Element | null, b: Element | null, msg: string) => {
      expect(a, msg).toBeTruthy()
      expect(b, msg).toBeTruthy()
      expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING, msg).toBeTruthy()
    }

    // ① 圖：與清單同序、各一次（Beginner 模式也全部看得到）
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual(GALLERY_CHARTS.map((c) => c.chart))
    const el = (name: string) => figs[GALLERY_CHARTS.findIndex((c) => c.name === name)]
    // ② 圖說是純文字（不用 Unicode 拼數學、不留 $）
    const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓$]/
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, f.getAttribute('data-chart')?.slice(0, 40)).toBeGreaterThan(15)
      expect(BAD.test(cap), cap).toBe(false)
    }
    // ③ 新的三張：導讀「先看…再看…」含 KaTeX，並對照圖上的方塊
    for (const name of ['CHART_LMS_LOOP', 'CHART_MATCH_DECISION', 'CHART_UNIFIED_LOOP']) {
      const walk = el(name).closest('.gal-diagram')?.querySelector('.gal-diagram-walk')
      expect(walk?.textContent, name).toContain('先看')
      expect(walk?.textContent, name).toContain('再看')
      expect(walk?.textContent, name).toContain('圖上')
      expect(walk?.querySelector('.katex'), name).toBeTruthy()
    }
    // ④ 位置：文字說明 → 圖 → 公式／推導
    const s2 = container.querySelector('#gal-s2')!.closest('section')!
    expect(el('PRESET_FLOW').closest('section')).toBe(container.querySelector('#gal-s1')!.closest('section'))
    expect(el('CHART_LMS_LOOP').closest('section')).toBe(s2)
    expect(el('CHART_MATCH_DECISION').closest('section')).toBe(s2)
    before(el('CHART_LMS_LOOP'), s2.querySelector('.gal-num-table'), '#1 的迴路圖在手算表之前')
    before(el('CHART_LMS_LOOP'), s2.querySelector('.katex-display'), '#1 的迴路圖在更新式之前')
    before(el('CHART_MATCH_DECISION'), container.querySelector('[id="formula-F-GA.1"]'), '判定流程圖在 F-GA.1 之前')
    before(s2.querySelector('.gal-num-table'), el('CHART_MATCH_DECISION'), '判定流程圖在 §2.1 的手算表之後')
    const s4 = container.querySelector('#gal-s4')!.closest('section')!
    expect(el('CHART_UNIFIED_LOOP').closest('section')).toBe(s4)
    before(el('CHART_UNIFIED_LOOP'), container.querySelector('[id="formula-F-GA.4"]'), '統一觀點的迴路圖在 F-GA.4 之前')
    before(container.querySelector('[id="formula-F-GA.4"]'), el('THREE_QUESTIONS'), '三個問題的分組圖在 F-GA.4 之後')

    // ⑤ 符號表：全頁兩張都在 #symbols 裡，而 #symbols 是整頁最後一個區塊（§10 之後）
    const page = container.querySelector('.gal-page')!
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(page.lastElementChild).toBe(symbols)
    before(container.querySelector('#gal-s10'), symbols, '符號表在 §10 之後')
    before(container.querySelector('.c-recap'), symbols, '符號表在「必記」之後')
    const tables = Array.from(container.querySelectorAll('.c-symbols'))
    expect(tables).toHaveLength(2)
    for (const t of tables) expect(symbols.contains(t)).toBe(true)
    expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBe(CHECK_SYMBOLS.length + MODEL_SYMBOLS.length)
    expect(container.querySelector('#gal-s1')!.closest('section')!.querySelector('.c-symbols')).toBeNull()
    // ⑥ 頁首只留一行：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），在 §1 之前
    const link = Array.from(container.querySelectorAll('.gal-symbols-link button')).find((b) => b.textContent === '本頁符號表在最後 ↓') as HTMLButtonElement
    expect(link).toBeTruthy()
    before(link, container.querySelector('#gal-s1'), '連結在 §1 之前')
    expect(container.querySelectorAll('a[href="#symbols"], a[href$="#symbols"]')).toHaveLength(0)
    expect((container.textContent ?? '').split('本頁符號表在最後').length).toBe(2)
    // 按下去捲到 #symbols（jsdom 沒有 scrollIntoView，這裡裝一個替身）；符號表旁的「回到頁首」捲回 §1
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
      expect(scrolled[1]).toBe(container.querySelector('#gal-s1'))
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  }, 120000)
})
