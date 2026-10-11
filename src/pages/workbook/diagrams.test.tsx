import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { ALL_HANDCALCS, handcalcById } from '@/app/handcalcs'
import { SettingsProvider } from '@/app/settings'
import { checkAnswer, defaultValues } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { conventionalStep } from '@/simulation/models/lms'
import * as D from './diagrams'
import { CHART_BANK, CHART_DEMO_ORDER, CHART_HOWTO, WORKBOOK_CHARTS } from './diagrams'
import WorkbookPage from './index'
import { EMPTY_FILTERS, filtersToParams } from './logic'

// 方塊圖在整頁測試裡用只放原始碼與圖說的替身（真正的 mermaid 套件沒有被 mock：上面的測試照樣用它解析與渲染每一張圖）
vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  return {
    Mermaid: ({ chart, caption }: { chart: string; caption?: string }) =>
      createElement('figure', { className: 'c-mermaid', 'data-chart': chart }, caption ? createElement('figcaption', { className: 'c-figcaption' }, caption) : null),
    renderMermaid: async () => '<svg></svg>',
  }
})

const root = process.cwd()
const handCalcSrc = readFileSync(join(root, 'src/components/HandCalc.tsx'), 'utf8')
const worksheetSrc = readFileSync(join(root, 'src/pages/workbook/sections/Worksheet.tsx'), 'utf8')

afterEach(() => {
  cleanup()
  localStorage.clear()
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
  stroke?: string
}
type Graph = { vertices: Vertex[]; edges: Edge[] }

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊。 */
async function flow(chart: string): Promise<Graph> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

/** mermaid 的 parser 會把含 HTML 的標籤裡的 > < & 編成 entity；瀏覽器顯示時會還原，所以這裡也還原再比對。 */
const decode = (s: string) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')

function edgeOf(g: Graph, start: string, end: string): Edge {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e
}
const edgeText = (g: Graph, start: string, end: string): string => decode(edgeOf(g, start, end).text ?? '')
const nodeText = (g: Graph, id: string): string => decode(g.vertices.find((v) => v.id === id)?.text ?? '')
const hasEdge = (g: Graph, start: string, end: string) => g.edges.some((e) => e.start === start && e.end === end)

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
const plain = (s: string) => decode(s.replace(/<br\s*\/?>/g, '')).replace(/\s+/g, '')

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

/** 從 from 出發沿著邊走得到的所有節點（可指定不准經過的節點）。 */
function reachable(g: Graph, from: string, avoid?: string): Set<string> {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of g.edges) {
      if (e.start === cur && e.end !== avoid && !seen.has(e.end)) {
        seen.add(e.end)
        stack.push(e.end)
      }
    }
  }
  return seen
}

describe('手算練習簿的 Mermaid 圖：清單', () => {
  it('共 3 張（練習流程、HC-00.1 的計算順序、題庫的結構）；diagrams.ts 匯出的每一張都在清單裡，沒有漏掉沒測到的圖', () => {
    expect(WORKBOOK_CHARTS.map((c) => c.name)).toEqual(['CHART_HOWTO', 'CHART_DEMO_ORDER', 'CHART_BANK'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(WORKBOOK_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(WORKBOOK_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    expect(new Set(WORKBOOK_CHARTS.map((c) => c.chart)).size).toBe(WORKBOOK_CHARTS.length)
  })
})

describe('手算練習簿的 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    installMermaidSvgShim()
  })

  it('每一張都能解析成 flowchart；不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法；加法點的每條輸入都標了正負號', async () => {
    for (const c of WORKBOOK_CHARTS) {
      const r = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(r && typeof r === 'object' ? r.diagramType : r, c.name).toBe('flowchart-v2')
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(g.vertices.length, `${c.name} 節點數`).toBeGreaterThanOrEqual(5)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
      const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')
      for (const s of sums) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
      }
    }
    // 只有 LMS 更新那張有加法點：比較（＋y、−ŷ）與更新（＋Δw、＋w）
    expect((await flow(CHART_DEMO_ORDER)).vertices.filter((v) => v.type === 'circle' && v.text === '＋')).toHaveLength(2)
    expect((await flow(CHART_HOWTO)).vertices.filter((v) => v.type === 'circle')).toHaveLength(0)
  }, 60000)

  it('練習流程：圖上的按鈕名稱就是 HandCalc 的按鈕；菱形的判定（相對 1%、絕對 10⁻⁹）就是 checkAnswer；答對換一題、答錯看詳解再改正重填', async () => {
    const g = await flow(CHART_HOWTO)
    expect(g.vertices.map((v) => v.id).sort()).toEqual(['CHK', 'FILL', 'FIND', 'HAND', 'OK', 'PICK', 'REV', 'SUB'])
    // 主線 ① → ② → ③ → ④ → 判定
    for (const [a, b] of [['PICK', 'SUB'], ['SUB', 'HAND'], ['HAND', 'FILL'], ['FILL', 'CHK'], ['REV', 'FIND']]) expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    expect(edgeText(g, 'CHK', 'OK')).toBe('是')
    expect(edgeText(g, 'CHK', 'REV')).toMatch(/^否/)
    expect(edgeText(g, 'OK', 'HAND')).toBe('換一題（隨機數字）')
    expect(edgeText(g, 'FIND', 'FILL')).toBe('改正後重填')
    expect(edgeText(g, 'HAND', 'REV')).toBe('卡住了')
    expect(edgeOf(g, 'HAND', 'REV').stroke).toBe('dotted') // 「卡住了」是旁路，不是主線
    // 圓圈數字依序是 ①②③④⑤
    const circled = ['PICK', 'SUB', 'HAND', 'FILL', 'REV'].map((id) => nodeText(g, id)[0])
    expect(circled).toEqual(['①', '②', '③', '④', '⑤'])
    // 圖上的名稱就是畫面上的按鈕（HandCalc.tsx 的原始碼）
    for (const label of ['自己算算看', '對答案', '看詳解', '換一題（隨機數字）']) expect(handCalcSrc, label).toContain(label)
    expect(nodeText(g, 'HAND')).toContain('自己算算看')
    expect(nodeText(g, 'FILL')).toContain('對答案')
    expect(nodeText(g, 'REV')).toContain('看詳解')
    expect(edgeText(g, 'OK', 'HAND')).toContain('換一題（隨機數字）')
    expect(nodeText(g, 'REV')).toContain('符號式 = 代入數字 = 結果')
    expect(nodeText(g, 'CHK')).toContain('相對誤差 ≤ 1%')
    expect(nodeText(g, 'CHK')).toContain('絕對誤差 ≤ 10⁻⁹')
    expect(CHART_HOWTO).toContain('class CHK focus')

    // 菱形：照著圖走一次（以 HC-00.1 的詳解為準），結果和 checkAnswer 一致，邊界也一致
    const demo = handcalcById('HC-00.1')!
    const sol = demo.solve(defaultValues(demo))
    expect(sol.results).toHaveLength(2)
    const decide = (user: number, r: { value: number; tolerance?: { abs?: number; rel?: number } }) => {
      const abs = Math.abs(user - r.value)
      const inside = abs <= 1e-9 || (r.value !== 0 && abs / Math.abs(r.value) <= 0.01) // 圖上的菱形
      return g.edges.find((e) => e.start === 'CHK' && (inside ? e.text === '是' : /^否/.test(e.text ?? '')))!.end // 是 → 正確；否 → 詳解
    }
    for (const r of sol.results) {
      expect(r.tolerance, '預設容許誤差（相對 1%、絕對 1e-9）').toBeUndefined()
      for (const factor of [1, 1.0099, 0.9901, 1.0101, 0.99, 1.5, -1]) {
        const user = r.value * factor
        const want = checkAnswer(user, r).ok ? 'OK' : 'REV'
        expect(decide(user, r), `${r.symbol} × ${factor}`).toBe(want)
      }
    }
    // 答案剛好是 0 時只剩絕對項
    expect(decide(5e-10, { value: 0 })).toBe('OK')
    expect(decide(2e-9, { value: 0 })).toBe('REV')
    expect(checkAnswer(5e-10, { value: 0 }).ok).toBe(true)
    expect(checkAnswer(2e-9, { value: 0 }).ok).toBe(false)
  })

  it('HC-00.1 的計算順序：e_n = y − ŷ_n（量測為正、預測為負）、Δw_n = μ·e_n·x、w_(n+1) = w_n + Δw_n；照著圖算兩圈，就是詳解的 w₁、w₂ 與 conventionalStep', async () => {
    const g = await flow(CHART_DEMO_ORDER)
    expect(g.vertices.map((v) => v.id).sort()).toEqual(['FIX', 'NEXT', 'PRED', 'S1', 'S2', 'W', 'X', 'Y'])
    // ① 預測
    expect(nodeText(g, 'PRED').split(/<br\s*\/?>/)).toEqual(['① 預測', 'ŷ_n = w_n·x'])
    expect(hasEdge(g, 'W', 'PRED')).toBe(true)
    expect(hasEdge(g, 'X', 'PRED')).toBe(true)
    // ② 比較：量測為正、預測為負
    expect(edgeText(g, 'Y', 'S1')).toBe('＋ y')
    expect(edgeText(g, 'PRED', 'S1')).toBe('− ŷ_n')
    expect(edgeText(g, 'S1', 'FIX')).toBe('② e_n = y − ŷ_n')
    // ③ 修正量要乘上 x，④ 加回 w_n
    expect(hasEdge(g, 'X', 'FIX')).toBe(true)
    expect(nodeText(g, 'FIX')).toContain('Δw_n = μ·e_n·x')
    expect(edgeText(g, 'FIX', 'S2')).toBe('＋ Δw_n')
    expect(edgeText(g, 'W', 'S2')).toBe('＋ w_n')
    expect(edgeText(g, 'S2', 'NEXT')).toBe('④ w_(n+1) = w_n + Δw_n')
    expect(nodeText(g, 'NEXT')).toContain('回到 ① 再做一次')
    expect(nodeText(g, 'NEXT')).toContain('同一組 x、y')
    expect(CHART_DEMO_ORDER).toContain('class FIX focus')
    // 圓圈數字依序出現在 ①②③④ 的方塊或連線上
    expect([nodeText(g, 'PRED'), edgeText(g, 'S1', 'FIX'), nodeText(g, 'FIX'), edgeText(g, 'S2', 'NEXT')].map((t) => t[0])).toEqual(['①', '②', '③', '④'])

    // 詳解的前四步就是 ①②③④，後兩步是第二圈
    const demo = handcalcById('HC-00.1')!
    const inputs = defaultValues(demo)
    expect(inputs).toEqual({ w0: 1, x: 2, y: 6, mu: 0.1 })
    const sol = demo.solve(inputs)
    const lead = sol.steps.map((s) => s.tex.split('=')[0].trim())
    expect(lead.slice(0, 4)).toEqual(['\\hat y_0', 'e_0', '\\Delta w_0', 'w_1'])
    expect(sol.steps).toHaveLength(6)
    expect(lead[4]).toBe('e_1')
    expect(lead[5]).toBe('w_2')
    // 照著圖算兩圈（每個方塊一行）
    const { x, y, mu } = inputs
    let w = inputs.w0
    const wAfter: number[] = []
    for (let n = 0; n < 2; n++) {
      const yhat = w * x // ① 預測
      const e = y - yhat // ② 加法點：＋y、−ŷ_n
      const dw = mu * e * x // ③ 修正量
      const next = w + dw // ④ 加法點：＋Δw_n、＋w_n
      const step = conventionalStep({ w, x, y, mu })
      expect(e).toBeCloseTo(step.e, 12)
      expect(next).toBeCloseTo(step.w, 12)
      w = next
      wAfter.push(w)
    }
    expect(wAfter[0]).toBeCloseTo(sol.results[0].value, 12)
    expect(wAfter[1]).toBeCloseTo(sol.results[1].value, 12)
    expect(sol.results.map((r) => r.symbol)).toEqual(['w_1', 'w_2'])
    expect(wAfter[1]).toBeCloseTo(2.28, 12) // 規格 T01
    // 極性：預測太小（e_n > 0）時 w 變大；預測太大時 w 變小
    expect(conventionalStep({ w: 1, x: 2, y: 6, mu: 0.1 }).w).toBeGreaterThan(1)
    expect(conventionalStep({ w: 5, x: 2, y: 6, mu: 0.1 }).w).toBeLessThan(5)
  })

  it('題庫的結構：三種用法共用同一批題目；篩選的三個網址參數就是 filtersToParams；詳解都經過 solve()；列印只在練習卷；每一題的 solve() 真的跑得出來', async () => {
    const g = await flow(CHART_BANK)
    expect(g.vertices.map((v) => v.id).sort()).toEqual(['BR', 'FIL', 'PR', 'RP', 'SH', 'SIM', 'SRC', 'SV'])
    for (const [a, b] of [['SRC', 'FIL'], ['FIL', 'BR'], ['FIL', 'RP'], ['SRC', 'SH'], ['SH', 'PR'], ['BR', 'SV'], ['RP', 'SV'], ['SH', 'SV'], ['SIM', 'SV']]) expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    // 瀏覽與隨機練習吃篩選；練習卷不直接吃篩選（虛線 = 只沿用起點）
    expect(g.edges.filter((e) => e.start === 'FIL').map((e) => e.end).sort()).toEqual(['BR', 'RP', 'SH'])
    expect(edgeOf(g, 'FIL', 'SH').stroke).toBe('dotted')
    expect(edgeText(g, 'FIL', 'SH')).toContain('沿用')
    // 列印只在練習卷這條路上；三條路的詳解都來自 solve()，它又吃模擬函式
    expect(g.edges.filter((e) => e.end === 'PR').map((e) => e.start)).toEqual(['SH'])
    expect(reachable(g, 'BR').has('PR')).toBe(false)
    expect(reachable(g, 'RP').has('PR')).toBe(false)
    for (const id of ['BR', 'RP', 'SH']) expect(reachable(g, id).has('SV'), id).toBe(true)
    expect(g.edges.filter((e) => e.end === 'SV').map((e) => e.start).sort()).toEqual(['BR', 'RP', 'SH', 'SIM'])
    expect(nodeText(g, 'SV')).toContain('def.solve()')
    expect(nodeText(g, 'SIM')).toContain('src/simulation')
    expect(CHART_BANK).toContain('class SV focus')
    // 篩選的網址參數 = filtersToParams 寫出來的參數
    const sp = filtersToParams({ ...EMPTY_FILTERS, chapter: 'ch00', level: 'beginner', q: 'LMS' })
    for (const key of [...sp.keys()]) expect(nodeText(g, 'FIL'), key).toContain(`?${key}`)
    expect([...sp.keys()].sort()).toEqual(['ch', 'level', 'q'])
    // 圖上的名稱：題庫來源、列印按鈕
    expect(nodeText(g, 'SRC')).toContain('handcalcs.ts')
    expect(nodeText(g, 'SRC')).toContain('ALL_HANDCALCS')
    expect(ALL_HANDCALCS.length).toBeGreaterThan(100)
    expect(nodeText(g, 'PR')).toContain('列印 / 存成 PDF')
    expect(worksheetSrc).toContain('列印 / 存成 PDF')
    // 每一題的詳解都由 def.solve() 當場算出（預設數字下不丟錯、有步驟、有答案）
    for (const def of ALL_HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      expect(sol.steps.length, def.id).toBeGreaterThan(0)
      expect(sol.results.length, def.id).toBeGreaterThan(0)
    }
  })

  it('實際渲染（共用的 renderMermaidForTest）：每張圖都畫得出來，沒有「Unsupported markdown」、節點數 ≤ 14，畫面上的每個標籤都和原始碼相同', async () => {
    for (const c of WORKBOOK_CHARTS) {
      const { svg, text, nodeCount } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(nodeCount, c.name).toBeLessThanOrEqual(14)
      expect(nodeCount, c.name).toBeGreaterThanOrEqual(5)
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

describe('手算練習簿頁面上的方塊圖（teaching-style §8）；本頁沒有逐頁符號表（§5 不適用）', () => {
  it('3 張圖各出現一次、順序與清單相同、都有圖說與「先看…再看…」導讀並放在對應的說明／題目之前；圖說的數學用 LaTeX；頁面上沒有符號表', () => {
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/workbook']}>
          <WorkbookPage />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const before = (a: Element | null, b: Element | null, msg: string) => {
      expect(a, msg).toBeTruthy()
      expect(b, msg).toBeTruthy()
      expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING, msg).toBeTruthy()
    }
    // ① 圖：與清單同序、各一次
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual(WORKBOOK_CHARTS.map((c) => c.chart))
    const el = (name: string) => figs[WORKBOOK_CHARTS.findIndex((c) => c.name === name)]
    // ② 圖說：數學一律 LaTeX（$…$ 成對），不用 Unicode 拼數學
    const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓]/
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, f.getAttribute('data-chart')?.slice(0, 40)).toBeGreaterThan(15)
      expect(BAD.test(cap), cap).toBe(false)
      expect(cap.split('$').length % 2, cap).toBe(1)
    }
    // ③ 導讀：「先看…再看…」；前兩張的導讀含 KaTeX，且沒有殘留的 $
    for (const c of WORKBOOK_CHARTS) {
      const walk = el(c.name).closest('.wb-diagram')?.querySelector('.wb-diagram-walk')
      expect(walk?.textContent, c.name).toContain('先看')
      expect(walk?.textContent, c.name).toContain('再看')
      expect(walk?.textContent, c.name).not.toContain('$')
    }
    expect(el('CHART_HOWTO').closest('.wb-diagram')?.querySelectorAll('.wb-diagram-walk .katex').length).toBeGreaterThanOrEqual(2)
    expect(el('CHART_DEMO_ORDER').closest('.wb-diagram')?.querySelectorAll('.wb-diagram-walk .katex').length).toBeGreaterThanOrEqual(8)
    // ④ 位置：練習流程在 §2 的步驟清單之後、示範題之前；計算順序在示範題的 HandCalc 之前；題庫結構在 §4 的分頁之前
    const s2 = container.querySelector('#wb-s2')!.closest('section') as HTMLElement
    expect(s2.contains(el('CHART_HOWTO'))).toBe(true)
    before(s2.querySelector('ol.wb-how'), el('CHART_HOWTO'), '練習流程圖在「怎麼用」的步驟清單之後')
    const demo = container.querySelector('.wb-demo') as HTMLElement
    expect(demo.contains(el('CHART_DEMO_ORDER'))).toBe(true)
    expect(demo.contains(el('CHART_HOWTO'))).toBe(false)
    before(el('CHART_HOWTO'), demo, '練習流程圖在示範題之前')
    before(el('CHART_DEMO_ORDER'), demo.querySelector('.c-handcalc'), '計算順序圖在示範題的 HandCalc 之前')
    const s4 = container.querySelector('#wb-s4')!.closest('section') as HTMLElement
    expect(s4.contains(el('CHART_BANK'))).toBe(true)
    before(container.querySelector('#wb-s4'), el('CHART_BANK'), '題庫結構圖在 §4 標題之後')
    before(el('CHART_BANK'), s4.querySelector('.wb-tabs'), '題庫結構圖在分頁之前')
    // 圖上的三種用法名稱 = 畫面上的三個分頁
    const tabs = Array.from(s4.querySelectorAll('.wb-tabs button')).map((b) => b.textContent ?? '')
    expect(tabs).toEqual(['題庫瀏覽', '隨機練習', '練習卷（可列印）'])
    expect(CHART_BANK).toContain('題庫瀏覽')
    expect(CHART_BANK).toContain('隨機練習')
    expect(CHART_BANK).toContain('練習卷')
    // 圖上的按鈕名稱 = 示範題的按鈕：切到「自己算算看」後有「對答案」「看詳解」「換一題（隨機數字）」
    const btn = (root: ParentNode, text: string) => Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined
    fireEvent.click(btn(demo, '自己算算看')!)
    for (const t of ['對答案', '看詳解', '換一題（隨機數字）']) expect(btn(demo, t), t).toBeTruthy()
    // ⑤ 這一頁本來就沒有逐頁符號表（全站符號總表在 Formulas 頁）：沒有 #symbols、沒有 SymbolTable、也沒有指向它的連結
    expect(container.querySelector('#symbols')).toBeNull()
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(0)
    expect(container.querySelectorAll('a[href="#symbols"], a[href$="#symbols"]')).toHaveLength(0)
  }, 120000)
})
