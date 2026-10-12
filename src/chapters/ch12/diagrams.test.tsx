import { cleanup, render } from '@testing-library/react'
import mermaid from 'mermaid'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { defaultValues, systemMapModel } from '@/components'
import { mermaidMathDelimiters, sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { calLoop, spurBeta, spurDbcSmallAngle } from '@/simulation/models/calNoise'
import Chapter12 from './index'
import { CODE_TABLE_PRM, codeTable } from './common'
import * as D from './diagrams'
import { CH12_CHARTS, CH12_SYSTEM_FOCUS } from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

/**
 * 第 12 章的方塊圖測試（docs/teaching-style.md §8）。
 *  1. 每一張圖都用「真正的」mermaid 畫一次（@/components/mermaidTestUtils；這個檔案沒有 mock mermaid 套件）：
 *     畫出來的文字不含「Unsupported markdown」與殘留的 `$`、KaTeX 以外的文字沒有 Unicode 拼的數學（unicodeMathIn）、
 *     每個含公式的標籤都由 KaTeX 排版（mathCount）、標籤裡的文字部分原封不動出現在圖上、節點數不超過 14。
 *  2. 用 mermaid 自己的 parser 取出節點與連線（原始碼裡的 `$...$` 標籤），逐條核對訊號名稱、箭頭方向、加法點的正負號、
 *     延遲的位置與正文公式一致（斷言直接比對標籤的 TeX 原始碼）。
 *  3. 整章渲染（只渲染一次，之後各個測試查同一份 DOM 快照）：為了不在 jsdom 裡再排版一次 SVG，把 @/components 的
 *     Mermaid／SystemMap 換成只記錄 props 的替身，核對頁面上畫出來的圖與 CH12_CHARTS 完全相同（數量、順序）、
 *     章首有系統地圖、每張圖都放在對應公式之前。Plot 與三個互動實驗和本檔無關，也換成空元件。
 */
vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>()
  return {
    ...actual,
    Mermaid: ({ chart, caption }: { chart: string; caption?: string }) => (
      <figure data-testid="mermaid-stub" data-chart={chart}>
        <figcaption>{caption}</figcaption>
      </figure>
    ),
    SystemMap: ({ focus, caption }: { focus: string[]; caption?: string }) => (
      <figure data-testid="system-map-stub" data-focus={focus.join(',')}>
        <figcaption>{caption}</figcaption>
      </figure>
    ),
    Plot: () => <div data-testid="plot-stub" />,
  }
})
// 三個互動實驗沒有 Mermaid 圖，換成空元件讓整章渲染保持輕量
vi.mock('./experiments/LmsNoiseLab', () => ({ LmsNoiseLab: () => <div data-experiment="lms-noise-lab" /> }))
vi.mock('./experiments/CodeSpectraLab', () => ({ CodeSpectraLab: () => <div data-experiment="code-spectra-lab" /> }))
vi.mock('./experiments/CodeMixingLab', () => ({ CodeMixingLab: () => <div data-experiment="code-mixing-lab" /> }))

const EX = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 })
const N_CHARTS = 27
/** 機器滿載（其他章節的測試平行執行）時 jsdom 裡的排版會慢一個數量級：只放寬逾時，不影響任何斷言 */
const T_SLOW = 900_000

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
interface Flow {
  vertices: Vertex[]
  edges: Edge[]
  subgraphs: { id: string; title: string; nodes: string[] }[]
}

/** 用真正的 mermaid parser 取出 flowchart 的節點、連線與 subgraph（sequenceDiagram 回傳 null）。 */
async function flow(chart: string): Promise<Flow | null> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as {
    getVertices?: () => Map<string, Vertex>
    getEdges?: () => Edge[]
    getSubGraphs?: () => { id: string; title: string; nodes: string[] }[]
  }
  if (typeof db.getVertices !== 'function' || typeof db.getEdges !== 'function') return null
  const subgraphs = (db.getSubGraphs?.() ?? []).map((s) => ({ id: s.id, title: s.title, nodes: [...s.nodes] }))
  const groupIds = new Set(subgraphs.map((s) => s.id))
  // 「框 → 框」的連線會讓 parser 替 subgraph 的 id 也建一個同名節點；它不是真的節點，畫圖時也不會出現
  return { vertices: [...db.getVertices().values()].filter((v) => !groupIds.has(v.id)), edges: db.getEdges(), subgraphs }
}

const chartOf = (name: string): string => {
  const c = CH12_CHARTS.find((x) => x.name === name)
  if (!c) throw new Error(`找不到 ${name}`)
  return c.chart
}

/** 某條連線的標籤（找不到就丟錯，讓測試訊息指出是哪一條）。 */
function edgeText(g: Flow, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條線`)
  return e.text ?? ''
}
const hasEdge = (g: Flow, start: string, end: string) => g.edges.some((e) => e.start === start && e.end === end)
const vertexText = (g: Flow, id: string): string => {
  const v = g.vertices.find((x) => x.id === id)
  if (!v) throw new Error(`沒有節點 ${id}`)
  return v.text ?? ''
}

/** 比對用：拿掉換行標籤與所有空白，並還原 mermaid 對標籤做的 entity 編碼。 */
const squash = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '') // \s 也涵蓋不換行空白

/** Mermaid 11 把標籤當 Markdown：這些寫法會被畫成「Unsupported markdown: …」或被 Markdown／HTML 解析吃掉。 */
function labelHazard(text: string): string | null {
  for (const line of text.split(/<br\s*\/?>/)) {
    const t = line.trim()
    if (t === '+' || t === '-' || t === '*') return `單獨的「${t}」會被當成清單`
    if (/^[+\-*] /.test(t)) return `「${t.slice(0, 8)}」以清單符號開頭`
    if (/^\d+[.)] /.test(t)) return `「${t.slice(0, 8)}」以編號清單開頭`
    if (/^#{1,6} /.test(t)) return `「${t.slice(0, 8)}」以標題符號開頭`
    if (/^> /.test(t)) return `「${t.slice(0, 8)}」以引用符號開頭`
    if (/`/.test(t)) return '反引號會被當成 code span'
  }
  if (/<(?!br\s*\/?>)[A-Za-z/!]/.test(text)) return '「<」後面緊接字母，會被當成 HTML 標籤'
  return null
}

/** 拿掉延遲方塊（$z^{-1}$）之後，圖上還有沒有迴圈；有的話就是「沒有延遲的迴圈」（algebraic loop）。 */
function hasDelayFreeLoop(g: Flow): boolean {
  const delay = new Set(g.vertices.filter((v) => (v.text ?? '').includes('z^{-1}')).map((v) => v.id))
  const next = new Map<string, string[]>()
  for (const e of g.edges) {
    if (delay.has(e.start) || delay.has(e.end)) continue
    next.set(e.start, [...(next.get(e.start) ?? []), e.end])
  }
  const state = new Map<string, 1 | 2>() // 1 = 走訪中，2 = 完成
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true
    if (state.get(id) === 2) return false
    state.set(id, 1)
    for (const n of next.get(id) ?? []) if (visit(n)) return true
    state.set(id, 2)
    return false
  }
  return [...next.keys()].some((id) => visit(id))
}
/** 圖上有沒有任何迴圈（含經過延遲的）。 */
function hasLoop(g: Flow): boolean {
  return hasDelayFreeLoop({ ...g, vertices: g.vertices.map((v) => ({ ...v, text: '' })) })
}

/** 有向圖上最長的簡單路徑有幾個節點（圖很小，直接 DFS）：橫向（LR）的圖就是排成幾欄。 */
function longestPath(g: Flow): number {
  const next = new Map<string, string[]>()
  for (const e of g.edges) next.set(e.start, [...(next.get(e.start) ?? []), e.end])
  const walk = (id: string, seen: Set<string>): number => {
    let best = 1
    for (const n of next.get(id) ?? []) if (!seen.has(n)) best = Math.max(best, 1 + walk(n, new Set([...seen, n])))
    return best
  }
  return Math.max(...g.vertices.map((v) => walk(v.id, new Set([v.id]))))
}

/** 原始碼裡所有雙引號標籤（節點、連線、subgraph 標題）。 */
const labelsOf = (chart: string): string[] => chart.match(/"[^"\n]*"/g)?.map((l) => l.slice(1, -1)) ?? []
/** 含 `$...$` 公式的標籤數：每一個都要由 KaTeX 排版出一個 `.katex`。 */
const mathLabelCount = (chart: string): number => labelsOf(chart).filter((l) => l.includes('$')).length
/** 標籤裡「公式以外」的文字片段（依 `$...$` 與 <br/> 切開）：這些字必須原封不動出現在圖上。 */
const textChunks = (label: string): string[] =>
  label
    .replace(/\$(?:[^$\\]|\\.)+?\$/g, '\uE000')
    .split(/\uE000|<br\s*\/?>/)
    .map(squash)
    .filter((c) => c.length > 0)

describe('第 12 章方塊圖：清單', () => {
  it(`共 ${N_CHARTS} 張圖，名稱與內容都不重複；diagrams.ts 匯出的每一張都在清單裡；舊的雜訊傳遞鏈仍是第一張`, () => {
    expect(CH12_CHARTS.length).toBe(N_CHARTS)
    expect(new Set(CH12_CHARTS.map((c) => c.name)).size).toBe(N_CHARTS)
    expect(new Set(CH12_CHARTS.map((c) => c.chart)).size).toBe(N_CHARTS)
    expect(CH12_CHARTS[0].chart).toBe(D.NOISE_CHAIN_CHART)
    // diagrams.ts 匯出的每一個 Mermaid 原始碼都在清單裡（沒有漏掉沒測到、也沒放上頁面的圖）
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(CH12_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(chartOf(k)).toBe(v)
    // 每一小節至少一張；只在 Research 模式顯示的只有 colored η 那一張
    for (const s of ['§12.0', '§12.1', '§12.2', '§12.3', '§12.4', '§12.5', '§12.6', '§12.7', '§12.8', '§12.9']) {
      expect(CH12_CHARTS.some((c) => c.section === s), s).toBe(true)
    }
    expect(CH12_CHARTS.filter((c) => c.mode === 'research').map((c) => c.name)).toEqual(['CHART_COLORED_ETA'])
    // teaching-style §8：重要章節 8 張以上（含章首的系統地圖）
    expect(CH12_CHARTS.length + 1).toBeGreaterThanOrEqual(8)
  })

  it('語法衛生：沒有裸的 <（只允許 <br/>）、沒有分號、沒有未代入的樣板或 NaN；數學一律寫 `$...$`（成對、不用雙反斜線），正負號不寫單獨的半形 +／-，不靠元件替換', () => {
    for (const { name, chart } of CH12_CHARTS) {
      expect(chart.replace(/<br\/>/g, ''), name).not.toMatch(/</)
      expect(chart, name).not.toMatch(/;/)
      expect(chart, name).not.toMatch(/\$\{|NaN|undefined|Infinity/)
      // 只有 flowchart 的標籤支援 KaTeX（sequenceDiagram／stateDiagram 的文字不支援，`$...$` 會原樣顯示）
      expect(chart, name).toMatch(/^flowchart (LR|TB)\n/)
      // Mermaid 會把標籤裡連續兩個反斜線收成一個：TeX 的反斜線只寫一次（String.raw），換行用 <br/>
      expect(chart, name).not.toMatch(/\\\\/)
      // 每個標籤的 `$` 都成對（一個標籤可以有好幾段公式）
      for (const l of labelsOf(chart)) expect((l.match(/\$/g) ?? []).length % 2, `${name}：${l}`).toBe(0)
      expect(mathLabelCount(chart), `${name} 至少有一個公式標籤`).toBeGreaterThan(0)
      // 共用的 Mermaid 元件會把單獨的 +／- 換掉；原始碼本來就寫對的話，元件唯一做的事是把含公式的標籤合併成單一的 `$$...$$`
      expect(sanitizeMermaidSource(chart), name).toBe(mermaidMathDelimiters(chart))
      expect(chart, name).not.toMatch(/\(\(\s*"?[+-]"?\s*\)\)|"[+-]"|"[+\-*] /)
      // 三種標色用同一組深淺主題都看得清楚的顏色（白字配深色底）
      expect(chart, name).toContain('classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff')
      expect(chart, name).toContain('classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff')
      expect(chart, name).toContain('classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff')
      expect(chart, name).toMatch(/\n {2}class [A-Za-z0-9,]+ (focus|warn|ok)/)
    }
  })
})

describe('第 12 章方塊圖：真的畫一次（mermaid.render）', () => {
  const drawn = new Map<string, { text: string; plainText: string; nodeCount: number; mathCount: number }>()
  const flows = new Map<string, Flow | null>()
  beforeAll(async () => {
    installMermaidSvgShim()
    for (const { name, chart } of CH12_CHARTS) {
      try {
        const { text, plainText, nodeCount, mathCount } = await renderMermaidForTest(chart)
        drawn.set(name, { text, plainText, nodeCount, mathCount })
      } catch (err) {
        throw new Error(`${name} render 失敗：${err instanceof Error ? err.message : String(err)}`)
      }
      flows.set(name, await flow(chart))
    }
  }, T_SLOW)

  it('每一張都畫得出來：沒有「Unsupported markdown」、沒有殘留的 `$`、KaTeX 以外的文字沒有 Unicode 拼的數學，節點數不超過 14（subgraph 的標題不算節點）', () => {
    expect(drawn.size).toBe(N_CHARTS)
    for (const { name } of CH12_CHARTS) {
      const { text, plainText, nodeCount } = drawn.get(name) as { text: string; plainText: string; nodeCount: number }
      expect(text, name).not.toMatch(/Unsupported markdown/)
      expect(text, name).not.toMatch(/Syntax error/i)
      // 公式都由 KaTeX 排版：畫出來的文字裡不會有 `$`；KaTeX 以外的文字沒有希臘字母、上下標、運算符號、w_k 這類 Unicode／底線拼的數學
      expect(text, name).not.toContain('$')
      expect(unicodeMathIn(plainText), `${name} 還有 Unicode 拼的數學`).toEqual([])
      expect(nodeCount, `${name}: ${nodeCount} 個節點`).toBeLessThanOrEqual(14)
      const g = flows.get(name)
      if (!g) throw new Error(`${name} 不是 flowchart`)
      // parser 看到幾個節點，圖上就畫出幾個
      expect(nodeCount, `${name}: 畫出 ${nodeCount} 個、parser 有 ${g.vertices.length} 個`).toBe(g.vertices.length)
      expect(g.vertices.length, `${name}: ${g.vertices.length} 個節點`).toBeGreaterThanOrEqual(5)
    }
  })

  it('桌機版面：原本比正文欄寬、要橫向捲動的 8 張圖都改成直向（flowchart TB）；仍是橫向（LR）的圖最多排 6 欄（再長就要折行或改直向，1280px 的桌機放不下）', () => {
    // 這 8 張在 LR 時自然寬度 1356–2061px（scripts/diagram-audit.mjs 的「超出」），改成 TB 之後只有 450–1000px
    for (const name of ['NOISE_CHAIN_CHART', 'CHART_PSD_FILTER', 'CHART_LEVEL_WIDTH', 'CHART_DC_FEEDTHROUGH', 'CHART_BLOCK_TIMING', 'CHART_ZOH_TWO_STEP', 'CHART_PSD_UNITS', 'CHART_HW_KNOBS']) {
      expect(chartOf(name), name).toMatch(/^flowchart TB\n/)
    }
    for (const { name, chart } of CH12_CHARTS) {
      if (!chart.startsWith('flowchart LR')) continue
      const g = flows.get(name) as Flow
      expect(longestPath(g), `${name} 排成 ${longestPath(g)} 欄`).toBeLessThanOrEqual(6)
    }
  })

  it('每個含 `$...$` 的標籤（節點、連線、subgraph 標題）都由 KaTeX 排版成一個公式；標籤裡公式以外的文字原封不動出現在圖上（沒有被 Markdown／HTML 解析吃掉字元）', () => {
    for (const { name, chart } of CH12_CHARTS) {
      const d = drawn.get(name) as { text: string; mathCount: number }
      // 原始碼裡有幾個公式標籤，圖上就有幾個 .katex（少了代表某個標籤沒被排版，`$` 會原樣露出來）
      expect(d.mathCount, `${name} 的 KaTeX 公式數`).toBe(mathLabelCount(chart))
      const text = squash(d.text)
      const g = flows.get(name) as Flow
      const check = (where: string, label: string) => {
        expect(labelHazard(label), `${name} ${where}`).toBeNull()
        for (const c of textChunks(label)) expect(text, `${name} ${where}：「${c}」`).toContain(c)
      }
      for (const v of g.vertices) {
        expect((v.text ?? '').length, `${name} 節點 ${v.id} 沒有文字`).toBeGreaterThan(0)
        check(`節點 ${v.id}`, v.text ?? '')
      }
      for (const e of g.edges) if (e.text) check(`連線 ${e.start}→${e.end}`, e.text)
      for (const s of g.subgraphs) check(`框 ${s.id}`, s.title)
    }
  })

  it('加法點、乘法點與延遲：每條進加法點的線都標了正負號；每個乘號恰有兩個輸入；離散時間的迴圈一定經過 $z^{-1}$', () => {
    const withSum: string[] = []
    const withLoop: string[] = []
    for (const { name } of CH12_CHARTS) {
      const g = flows.get(name)
      if (!g) continue
      // 加法點 = 圓形節點、文字是 `$+$`；每條進來的線都要以 `$+` 或 `$-` 開頭，而且至少兩條
      const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '$+$')
      if (sums.length) withSum.push(name)
      for (const s of sums) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^\$[+-]/)
        expect(g.edges.filter((e) => e.start === s.id).length, `${name} 加法點 ${s.id} 的輸出`).toBeGreaterThanOrEqual(1)
      }
      // 乘法點（$\times$）與卷積（$\ast$）：兩個輸入、至少一個輸出
      for (const m of g.vertices.filter((v) => v.type === 'circle' && (v.text === '$\\times$' || v.text === '$\\ast$'))) {
        expect(g.edges.filter((e) => e.end === m.id).length, `${name} 乘法點 ${m.id}`).toBe(2)
        expect(g.edges.filter((e) => e.start === m.id).length, `${name} 乘法點 ${m.id} 的輸出`).toBeGreaterThanOrEqual(1)
      }
      if (hasLoop(g)) {
        withLoop.push(name)
        if (name === 'NOISE_CHAIN_CHART') {
          // 方塊層級的地圖：PD 的輸出回到 comparator 的那個迴圈（校正迴路）一定經過「LMS 更新」——它是累加器，
          // 展開之後就是 CHART_UPDATE_LOOP 的 z⁻¹；拿掉這一格，圖上就不能再有迴圈
          expect(hasLoop({ ...g, edges: g.edges.filter((e) => e.start !== 'U' && e.end !== 'U') }), `${name} 有不經過 LMS 累加器的迴圈`).toBe(false)
        } else if (name !== 'CHART_PLL_LOOP') {
          // CHART_PLL_LOOP 是連續時間的迴路（L(s) 內含 VCO 的積分），沒有 z⁻¹；其餘迴圈都是 block rate 的遞迴
          expect(hasDelayFreeLoop(g), `${name} 有不經過 z⁻¹ 的迴圈`).toBe(false)
        }
      }
    }
    expect(withSum).toEqual(['CHART_GMAC_LINEAR', 'CHART_UPDATE_LOOP', 'CHART_COEF_LOOP', 'CHART_VAR_LOOP', 'CHART_COLORED_ETA', 'CHART_GAIN_MULT', 'CHART_DC_FEEDTHROUGH', 'CHART_PLL_LOOP'])
    expect(withLoop).toEqual(['NOISE_CHAIN_CHART', 'CHART_UPDATE_LOOP', 'CHART_COEF_LOOP', 'CHART_VAR_LOOP', 'CHART_COLORED_ETA', 'CHART_PLL_LOOP'])
  })

  it('極性與箭頭方向和公式一致（F-12.1、F-12.2、F-12.3、F-12.5、F-12.11、§12.7；極性 δw = w − w*，勘誤 E33）；架構照全站約定：DTC 在 reference 輸入端、回授只有 divider、comparator 的輸入是 PD 的輸出', () => {
    const g = (name: string) => {
      const f = flows.get(name)
      if (!f) throw new Error(`${name} 不是 flowchart`)
      return f
    }
    // F-12.1 的實際電路：e[n] = C·(a − w_k)·x[n] + v[n]，q = sign(e)，G_k = (1/N)·Σ q·x
    const lin = g('CHART_GMAC_LINEAR')
    expect(vertexText(lin, 'A')).toContain('$a - w_k = -\\delta w_k$') // a − w 與 δw 方向相反
    expect(hasEdge(lin, 'A', 'X1') && hasEdge(lin, 'XC', 'X1')).toBe(true)
    expect(vertexText(lin, 'XC')).toContain('$C\\,x[n]$')
    expect(edgeText(lin, 'X1', 'S1')).toBe('$+$')
    expect(edgeText(lin, 'V', 'S1')).toBe('$+$')
    // comparator 的輸入 e[n] 就是 PD 的輸出（送進 loop filter 的同一個節點；docs/assumptions.md §2a 第 3 點）
    expect(edgeText(lin, 'S1', 'SGN')).toBe('$e[n]$：PD 的輸出')
    expect(edgeText(lin, 'SGN', 'X2')).toBe('$q[n]$')
    expect(hasEdge(lin, 'XR', 'X2') && hasEdge(lin, 'X2', 'AVG')).toBe(true)
    // F-12.1 的等效模型：G_k ≈ −K·δw_k + η_k —— K 那一路以負號、η 以正號進入加法點
    expect(vertexText(lin, 'DW')).toBe('$\\delta w_k = w_k - w^*$')
    expect(hasEdge(lin, 'DW', 'KB')).toBe(true)
    expect(vertexText(lin, 'KB')).toContain('$K = K_q C$')
    expect(edgeText(lin, 'KB', 'S2')).toBe('$-$')
    expect(edgeText(lin, 'ETA', 'S2')).toBe('$+$')
    expect(vertexText(lin, 'ETA')).toContain('$\\sigma_\\eta^2 \\approx 1/N$')
    expect(edgeText(lin, 'AVG', 'SAME')).toContain('$G_k$')
    expect(edgeText(lin, 'S2', 'SAME')).toContain('$G_k$')
    // 實際電路在 sample rate（索引 n），等效模型在 block rate（索引 k）
    expect(lin.subgraphs.find((s) => s.id === 'REAL')?.title).toBe('實際電路：每個 sample 做一次（索引 $n$）')
    expect(lin.subgraphs.find((s) => s.id === 'LIN')?.title).toBe('等效模型：每個 block 一個值（索引 $k$）')

    // 更新迴圈：G_k = η_k − K·δw_k；δw_{k+1} = δw_k + μ·G_k；延遲在累加器的輸出
    const upd = g('CHART_UPDATE_LOOP')
    expect(edgeText(upd, 'ETA', 'S1')).toBe('$+$')
    expect(edgeText(upd, 'KB', 'S1')).toMatch(/^\$-K\\,\\delta w_k\$/)
    expect(edgeText(upd, 'S1', 'MU')).toBe('$G_k$')
    expect(vertexText(upd, 'MU')).toBe('$\\times\\,\\mu$')
    expect(edgeText(upd, 'MU', 'S2')).toBe('$+\\mu G_k$')
    expect(edgeText(upd, 'D', 'S2')).toMatch(/^\$\+\\delta w_k\$/)
    expect(edgeText(upd, 'S2', 'D')).toBe('$\\delta w_{k+1}$')
    expect(vertexText(upd, 'D')).toContain('$z^{-1}$')
    expect(edgeText(upd, 'D', 'OUT')).toBe('$\\delta w_k$')
    expect(hasEdge(upd, 'D', 'KB')).toBe(true)

    // F-12.2 / F-12.3：δw_{k+1} = p·δw_k + μ·η_k，H(z) = μ/(z − p)，延遲在迴圈內（前向與回授都經過它）
    const coef = g('CHART_COEF_LOOP')
    expect(hasEdge(coef, 'ETA', 'MU')).toBe(true)
    expect(edgeText(coef, 'MU', 'S')).toBe('$+\\mu\\eta_k$')
    expect(edgeText(coef, 'P', 'S')).toBe('$+p\\,\\delta w_k$')
    expect(edgeText(coef, 'S', 'D')).toBe('$\\delta w_{k+1}$')
    expect(vertexText(coef, 'D')).toBe('$z^{-1}$')
    expect(edgeText(coef, 'D', 'OUT')).toBe('$\\delta w_k$')
    expect(hasEdge(coef, 'D', 'P')).toBe(true)
    expect(vertexText(coef, 'P')).toContain('$p = 1 - \\mu K$')
    expect(squash(vertexText(coef, 'HZ'))).toBe(squash('$H(z) = \\mu/(z - p)$<br/>$= \\mu z^{-1}/(1 - p z^{-1})$'))

    // F-12.4 / F-12.5
    expect(D.CHART_PSD_FILTER).toContain('\\mu^2 / (1 - 2p\\cos\\Omega + p^2)')
    expect(D.CHART_PSD_FILTER).toContain('\\sigma_w^2 = \\mu^2\\sigma_\\eta^2 / (1 - p^2)')
    expect(D.CHART_PSD_FILTER).toContain('\\mu^2/(1 - p)^2') // DC
    expect(D.CHART_PSD_FILTER).toContain('\\mu^2/(1 + p)^2') // Nyquist
    // 變異數迴圈：V_{k+1} = p²·V_k + μ²·σ_η²
    const vl = g('CHART_VAR_LOOP')
    expect(vertexText(vl, 'Q')).toContain('$\\mu^2\\sigma_\\eta^2$')
    expect(edgeText(vl, 'Q', 'S')).toBe('$+$')
    expect(edgeText(vl, 'P2', 'S')).toBe('$+$')
    expect(edgeText(vl, 'S', 'D')).toBe('$V_{k+1}$')
    expect(edgeText(vl, 'D', 'P2')).toBe('$V_k = E[\\delta w_k^2]$')
    expect(vertexText(vl, 'P2')).toContain('$\\times\\,p^2$')
    expect(D.CHART_VAR_LOOP).toContain('V = p^2 V + \\mu^2\\sigma_\\eta^2')
    expect(vertexText(vl, 'R')).toBe('$\\sigma_w^2 = \\mu^2\\sigma_\\eta^2 / (1 - p^2)$')

    // Research：AR(1) 的 η_k = r·η_{k−1} + √(1 − r²)·σ_η·ε_k，結果多一個 (1 + pr)/(1 − pr)
    const col = g('CHART_COLORED_ETA')
    expect(hasEdge(col, 'EPS', 'SC')).toBe(true)
    expect(vertexText(col, 'SC')).toBe('$\\times\\,\\sqrt{1 - r^2}\\,\\sigma_\\eta$')
    expect(edgeText(col, 'SC', 'S1')).toBe('$+$')
    expect(edgeText(col, 'R', 'S1')).toBe('$+r\\,\\eta_{k-1}$')
    expect(edgeText(col, 'S1', 'H')).toBe('$\\eta_k$')
    expect(hasEdge(col, 'S1', 'D1')).toBe(true)
    expect(edgeText(col, 'D1', 'R')).toBe('$\\eta_{k-1}$')
    expect(vertexText(col, 'OUT')).toContain('\\frac{1 + p\\,r}{1 - p\\,r}')

    // F-12.11：w[n] = w* + δw[n]，reference 端 DTC 的補償量 = w[n]·x[n]（實際延遲 T_0 − w[n]·x[n]），δt = x·δw（乘法，不是加法）
    const gm = g('CHART_GAIN_MULT')
    expect(edgeText(gm, 'WS', 'S')).toBe('$+$')
    expect(edgeText(gm, 'DW', 'S')).toBe('$+$')
    expect(edgeText(gm, 'S', 'M')).toBe('$w[n] = w^* + \\delta w[n]$')
    expect(hasEdge(gm, 'X', 'M')).toBe(true)
    expect(vertexText(gm, 'DT')).toContain('$\\delta t[n] = x[n]\\,\\delta w[n]$')
    // w·x 是「補償量」，不是 DTC 插入的延遲：延遲從基準 T_0 往回扣；δt 是多補的量（docs/assumptions.md §2a 第 4 點）
    expect(hasEdge(gm, 'M', 'DLY') && hasEdge(gm, 'DLY', 'ID') && hasEdge(gm, 'DLY', 'DT')).toBe(true)
    expect(vertexText(gm, 'DLY')).toContain('DTC 的補償量 $w[n]\\,x[n]$')
    expect(vertexText(gm, 'DLY')).toContain('$\\tau = T_0 - w[n]\\,x[n]$')
    expect(vertexText(gm, 'ID')).toContain('本來就要補的量')
    expect(vertexText(gm, 'DT')).toContain('多補的量')
    expect(D.CHART_GAIN_MULT).not.toMatch(/DTC 延遲 \$=|多出來的延遲|本來就要的延遲/)
    expect(D.NOISE_CHAIN_CHART).toContain('(("$\\times$"))')
    expect(D.CHART_TF_CHAIN).toContain('$\\delta t[n] = x[n]\\,\\delta w[n]$')
    // 雜訊傳遞鏈：code 進乘號，也（虛線）進 GMAC；乘號之後分成 PD 與 output 兩個出口
    const chain = g('NOISE_CHAIN_CHART')
    for (const [a, b] of [['V', 'Q'], ['Q', 'G'], ['G', 'U'], ['U', 'W'], ['W', 'M'], ['X', 'M'], ['X', 'G'], ['M', 'DT'], ['DT', 'PD'], ['DT', 'T'], ['T', 'OUT']]) expect(hasEdge(chain, a, b), `${a} → ${b}`).toBe(true)
    expect(vertexText(chain, 'PD')).toContain('$H_{\\mathrm{PD}} = 1/(1+L)$')
    expect(vertexText(chain, 'T')).toContain('$T = L/(1+L)$')
    expect(vertexText(chain, 'OUT')).toContain('\\phi_{\\mathrm{out}} = -2\\pi f_{\\mathrm{out}}\\,T\\,\\delta t')
    // δt 是 reference 端的 DTC「多補償的時間」（不是多出來的延遲）
    expect(vertexText(chain, 'DT')).toContain('$\\delta t[n] = x\\,\\delta w$')
    expect(vertexText(chain, 'DT')).toContain('reference 端的 DTC')
    expect(vertexText(chain, 'DT')).toContain('多補償的時間')
    expect(D.NOISE_CHAIN_CHART).not.toContain('延遲')
    // 校正迴路的輸入：comparator 取的是 PD 的輸出 e[n]（虛線由 PD 拉回 comparator）；comparator 只有雜訊與 PD 輸出兩個輸入
    expect(edgeText(chain, 'PD', 'Q')).toContain('PD 的輸出 $e[n]$')
    expect(edgeText(chain, 'PD', 'Q')).toContain('comparator 取它的正負號')
    expect(chain.edges.filter((e) => e.end === 'Q').map((e) => e.start).sort()).toEqual(['PD', 'V'])
    expect(hasEdge(chain, 'DT', 'Q') || hasEdge(chain, 'M', 'Q') || hasEdge(chain, 'T', 'Q')).toBe(false)
    expect(chain.edges.length).toBe(12)

    // F-12.12：和頻與差頻，各 A·B/2
    expect(D.CHART_TONE_MIXER).toContain('f_x - f_w = 90\\ \\mathrm{kHz}')
    expect(D.CHART_TONE_MIXER).toContain('f_x + f_w = 110\\ \\mathrm{kHz}')
    expect(D.CHART_TONE_MIXER.match(/AB\/2 = 0\.5\\ \\mathrm\{fs\}/g)?.length).toBe(2)
    // F-12.13：時域相乘、自相關相乘、頻域卷積再除以 2π
    const dom = g('CHART_MIX_DOMAINS')
    expect(vertexText(dom, 'CV')).toBe('$\\ast$')
    expect(edgeText(dom, 'CV', 'ST')).toBe('$\\div\\,2\\pi$')
    expect(dom.subgraphs.map((s) => s.id).sort()).toEqual(['CORR', 'FREQ', 'TIME'])
    expect(hasEdge(dom, 'TIME', 'CORR') && hasEdge(dom, 'CORR', 'FREQ')).toBe(true)
    // 三種 code：dcTerm、toneTerm、whiteTerm
    for (const s of ['S_{\\delta t} = m^2 S_w(f)', 'S_{\\delta t} = \\frac{A^2}{4}\\left[S_w(f - f_x) + S_w(f + f_x)\\right]', 'S_{\\delta t} = \\sigma_x^2\\,\\sigma_w^2\\,\\frac{2}{f_s}']) expect(D.CHART_THREE_CODES, s).toContain(s)
    // code 的 DC 直通：δt = m·δw + x̃·δw
    const dc = g('CHART_DC_FEEDTHROUGH')
    expect(hasEdge(dc, 'DC', 'M1') && hasEdge(dc, 'DW', 'M1') && hasEdge(dc, 'AC', 'M2') && hasEdge(dc, 'DW', 'M2')).toBe(true)
    expect(edgeText(dc, 'M1', 'S')).toMatch(/^\$\+m\\,\\delta w\$/)
    expect(edgeText(dc, 'M2', 'S')).toMatch(/^\$\+\\tilde x\\,\\delta w\$/)
    expect(edgeText(dc, 'S', 'T')).toBe('$\\delta t[n]$')
    // F-12.14：(1/N)·[sin(Nθ/2)/sin(θ/2)]²·S_w(e^{jNθ})；先插零、再 boxcar
    const zoh = g('CHART_ZOH_TWO_STEP')
    expect(edgeText(zoh, 'UP', 'BOX')).toContain('(1/N)\\,S_w(e^{jN\\theta})')
    expect(edgeText(zoh, 'BOX', 'OUT')).toContain('\\left(\\frac{\\sin(N\\theta/2)}{\\sin(\\theta/2)}\\right)^2')
    expect(hasEdge(zoh, 'A', 'UP') && hasEdge(zoh, 'OUT', 'M') && hasEdge(zoh, 'X', 'M')).toBe(true)
    // block 邊界的時序（原本是 sequenceDiagram，文字不支援 KaTeX，改畫成三條泳道的 flowchart）：
    // GMAC 累加 N 個 sample 得到 G_k → LMS 每個 block 更新一次 w_{k+1} = w_k + μ·G_k → 新係數延遲 n_c 個 sample 後套用、DTC 保持 N 個 sample
    const tim = g('CHART_BLOCK_TIMING')
    expect(tim.subgraphs.map((s) => s.id).sort()).toEqual(['CG', 'DG', 'LA'])
    expect(tim.subgraphs.find((s) => s.id === 'CG')?.title).toBe('Comparator 與 GMAC（每個 sample）')
    expect(tim.subgraphs.find((s) => s.id === 'LA')?.title).toBe('LMS 累加器（每個 block）')
    expect(tim.subgraphs.find((s) => s.id === 'DG')?.title).toBe('DTC 的 gain（每個 sample）')
    // 每條泳道（橫帶）兩個時間點：block k 在左、block k+1 在右（宣告順序就是由左到右的順序）；mermaid 的 nodes 由後往前列，所以排序後比對
    for (const [lane, ids] of [['CG', ['A1', 'A2']], ['LA', ['B1', 'B2']], ['DG', ['D1', 'D2']]] as const) {
      expect([...(tim.subgraphs.find((s) => s.id === lane)?.nodes ?? [])].sort(), lane).toEqual(ids)
    }
    expect(vertexText(tim, 'A1')).toContain('$q[n]\\,x[n]$')
    expect(vertexText(tim, 'B1')).toContain('$w_{k+1} = w_k + \\mu G_k$')
    expect(vertexText(tim, 'D1')).toContain('ZOH')
    expect(edgeText(tim, 'A1', 'B1')).toContain('$G_k$')
    expect(edgeText(tim, 'B1', 'D1')).toContain('$n_c$')
    expect(edgeText(tim, 'A2', 'B2')).toBe('$G_{k+1}$')
    expect(edgeText(tim, 'B2', 'D2')).toBe('再換一次係數')
    expect(tim.edges.length).toBe(4)
    // F-12.10 / F-12.16：× 2/f_r → × (2π·f_out)²·|T|² → ÷ 2 再取 dB
    const units = g('CHART_PSD_UNITS')
    expect(edgeText(units, 'A', 'B')).toBe('$\\times\\,2/f_r$')
    expect(edgeText(units, 'B', 'C')).toContain('\\times\\,(2\\pi f_{\\mathrm{out}})^2|T|^2')
    expect(edgeText(units, 'C', 'D')).toBe('$\\div\\,2$，再取 $10\\log_{10}$')

    // §12.7：DTC 在 reference 輸入端，殘餘誤差在 PD 的 reference 輸入注入：e_PD = φ_dtc − θ_out，θ_out = L·e_PD；H_PD + T = 1
    const pll = g('CHART_PLL_LOOP')
    // 訊號路徑 Reference clock → DTC →（時間換相位）→ PD（加法點）→ L(s) → output；回授 output → divider → PD，路上只有 divider
    expect(hasEdge(pll, 'REF', 'DTC')).toBe(true)
    expect(vertexText(pll, 'REF')).toContain('reference clock')
    expect(vertexText(pll, 'DTC')).toContain('DTC（reference 輸入端）')
    expect(vertexText(pll, 'DTC')).toContain('多補償 $\\delta t$')
    expect(edgeText(pll, 'DTC', 'K')).toBe('時間誤差 $-\\delta t$')
    expect(vertexText(pll, 'K')).toContain('\\times\\,2\\pi f_{\\mathrm{out}}')
    expect(edgeText(pll, 'K', 'S')).toBe('$+\\phi_{\\mathrm{dtc}}$')
    expect(edgeText(pll, 'S', 'L')).toBe('$e_{\\mathrm{PD}}$')
    expect(edgeText(pll, 'L', 'OUT')).toBe('$\\theta_{\\mathrm{out}}$')
    // 回授路徑是一個畫出來的 divider 方塊：output → divider → PD（帶負號），divider 直接進 PD，中間沒有別的方塊
    expect(hasEdge(pll, 'OUT', 'DIV') && hasEdge(pll, 'DIV', 'S')).toBe(true)
    expect(edgeText(pll, 'DIV', 'S')).toBe('$-\\theta_{\\mathrm{out}}$')
    expect(vertexText(pll, 'DIV')).toContain('divider：回授路徑上只有它')
    // 相位以 output 為參考：divider 把 θ_out 原樣送回，除數算在 L(s) 裡（L 那一格的「÷ 除數」就是這個 divider）
    expect(vertexText(pll, 'DIV')).toContain('除數已算進 $L(s)$')
    expect(vertexText(pll, 'L')).toContain('PD 增益 $\\times$ loop filter $\\times$ VCO $\\div$ 除數')
    expect(pll.edges.filter((e) => e.end === 'DIV').map((e) => e.start)).toEqual(['OUT'])
    expect(pll.edges.filter((e) => e.start === 'DIV').map((e) => e.end)).toEqual(['S'])
    expect(hasEdge(pll, 'OUT', 'S')).toBe(false)
    // reference 不直接接 PD（中間一定經過 DTC）；DTC 唯一的輸入是 reference、唯一的輸出往 PD，不在回授路徑上；進 PD 的只有 reference 這一路與 divider
    expect(hasEdge(pll, 'REF', 'S')).toBe(false)
    expect(pll.edges.filter((e) => e.end === 'DTC').map((e) => e.start)).toEqual(['REF'])
    expect(pll.edges.filter((e) => e.start === 'DTC').map((e) => e.end)).toEqual(['K'])
    expect(pll.edges.filter((e) => e.end === 'K').map((e) => e.start)).toEqual(['DTC'])
    expect(pll.edges.filter((e) => e.start === 'K').map((e) => e.end)).toEqual(['S'])
    expect(pll.edges.filter((e) => e.end === 'S').map((e) => e.start).sort()).toEqual(['DIV', 'K'])
    expect(pll.vertices.filter((v) => v.type === 'circle').map((v) => v.id)).toEqual(['S'])
    // 解出來都是正號：θ_out = T·φ_dtc、e_PD = H_PD·φ_dtc
    expect(vertexText(pll, 'OUT')).toContain('\\theta_{\\mathrm{out}} = T\\,\\phi_{\\mathrm{dtc}}')
    expect(vertexText(pll, 'PDN')).toContain('e_{\\mathrm{PD}} = H_{\\mathrm{PD}}\\,\\phi_{\\mathrm{dtc}}')
    expect(vertexText(pll, 'PDN')).toContain('加法點就是 PD')
    // 校正迴路的輸入：comparator 取的是 PD 的輸出 e_PD（送進 L(s)——loop filter——的同一條線）
    expect(vertexText(pll, 'PDN')).toContain('comparator 取的也是 $e_{\\mathrm{PD}}$')
    expect(D.CHART_PLL_LOOP).not.toMatch(/= -T|= -H_|\\theta_\{\\mathrm\{out\}\} \+ \\phi_\{\\mathrm\{dtc\}\}/)
    const exits = g('CHART_TWO_EXITS')
    expect(hasEdge(exits, 'DT', 'PD') && hasEdge(exits, 'DT', 'T') && hasEdge(exits, 'PD', 'EPD') && hasEdge(exits, 'T', 'PO') && hasEdge(exits, 'T', 'J')).toBe(true)
    expect(vertexText(exits, 'PD')).toContain('H_{\\mathrm{PD}} = 1/(1+L)')
    expect(vertexText(exits, 'T')).toContain('T = L/(1+L)')
    expect(vertexText(exits, 'EPD')).toContain('e_{\\mathrm{PD}} = -2\\pi f_{\\mathrm{out}}\\,H_{\\mathrm{PD}}\\,\\delta t')
    expect(vertexText(exits, 'PO')).toContain('\\phi_{\\mathrm{out}} = -2\\pi f_{\\mathrm{out}}\\,T\\,\\delta t')
    expect(vertexText(exits, 'SUM')).toContain('H_{\\mathrm{PD}} + T = 1')
    // 兩格的負號來自 δt 的定義：DTC 多補償 δt，reference edge 早到 δt，進 PD 的時間誤差是 −δt
    expect(vertexText(exits, 'DT')).toContain('reference edge 早到 $\\delta t$')

    // 取樣率：block 量標 k、sample 量標 n
    expect(D.CHART_TF_CHAIN).toContain('block rate $f_u = f_s/N$（索引 $k$）')
    expect(D.CHART_TF_CHAIN.match(/sample rate \$f_s\$（索引 \$n\$）/g)?.length).toBe(2)
    const tf = g('CHART_TF_CHAIN')
    expect(edgeText(tf, 'AVG', 'H')).toContain('$\\eta_k$')
    expect(edgeText(tf, 'H', 'ZOH')).toContain('$\\delta w_k$')
    expect(edgeText(tf, 'ZOH', 'M')).toBe('$\\delta w[n]$')
    // 三個引擎：binomialStep 用 Φ(−C·δw/σ_v)（a − w = −δw），之後的更新相同
    expect(D.CHART_ENGINES).toContain('\\mathrm{Bin}\\big(N, \\Phi(-C\\,\\delta w/\\sigma_v)\\big)')
    expect(D.CHART_ENGINES).toContain('G = -K\\,\\delta w + \\eta')
    expect(D.CHART_ENGINES).toContain('G = (2N_+ - N)/N')
    const eng = g('CHART_ENGINES')
    for (const id of ['A2', 'B2', 'C2']) expect(hasEdge(eng, id, 'U'), id).toBe(true)
    expect(vertexText(eng, 'U')).toContain('\\delta w \\leftarrow \\delta w + \\mu G')
    // 硬體旋鈕：N 動到 η、μ 動到 δw、code 動到 δt、PLL 頻寬動到輸出；σ_v 經由斜率 K 進到 p
    const hw = g('CHART_HW_KNOBS')
    for (const [a, b] of [['V', 'ETA'], ['ETA', 'DW'], ['DW', 'DT'], ['DT', 'OUT'], ['RN', 'ETA'], ['RMU', 'DW'], ['BITS', 'DW'], ['CODE', 'DT'], ['BW', 'OUT'], ['V', 'DW']]) expect(hasEdge(hw, a, b), `${a} → ${b}`).toBe(true)
    expect(edgeText(hw, 'V', 'DW')).toContain('K = \\sqrt{2/\\pi}\\,C/\\sigma_v')
    expect(vertexText(hw, 'ETA')).toContain('\\sigma_\\eta^2 \\approx 1/N')
    // 暫存器名稱用等寬字型的 \mathtt（底線要跳脫），不是裸的 REG_GMAC_N
    expect(vertexText(hw, 'RN')).toContain('\\mathtt{REG\\_GMAC\\_N}')
    expect(vertexText(hw, 'RMU')).toContain('\\mathtt{REG\\_GAIN\\_STEP}')
  })

  it('−3 dB 存在範圍的判斷順序與 bwRegime() 相同（E27）', () => {
    const g = flows.get('CHART_BW_REGIME') as Flow
    // 不穩定 → high-pass → flat → 衰減不足 3 dB → low-pass
    expect(vertexText(g, 'D1')).toContain('|p| \\ge 1')
    expect(edgeText(g, 'D1', 'U')).toBe('是')
    expect(edgeText(g, 'D1', 'D2')).toBe('否')
    expect(vertexText(g, 'D2')).toContain('p \\ge 0')
    expect(edgeText(g, 'D2', 'HP')).toBe('否')
    expect(edgeText(g, 'D2', 'D3')).toBe('是')
    expect(vertexText(g, 'D3')).toContain('p = 0')
    expect(edgeText(g, 'D3', 'FL')).toBe('是')
    expect(edgeText(g, 'D3', 'D4')).toBe('否')
    expect(vertexText(g, 'D4')).toContain('p \\ge 3 - 2\\sqrt{2}')
    expect(edgeText(g, 'D4', 'N3')).toBe('否')
    expect(edgeText(g, 'D4', 'OK')).toBe('是')
    expect(vertexText(g, 'OK')).toContain('\\Omega_{3\\mathrm{dB}} = 2\\arcsin\\frac{1 - p}{2\\sqrt{p}}')
  })

  it('章首的系統地圖（手排的 SVG，不經過 Mermaid；版面本身由 SystemMap.test.tsx 測）：藍色（focused）方塊就是雜訊走的路，其餘方塊本章不碰；方塊上的公式寫成 `$...$`', () => {
    const { blocks } = systemMapModel(CH12_SYSTEM_FOCUS)
    const focused = blocks.filter((b) => b.focused).map((b) => b.id)
    // 雜訊 → comparator → GMAC → ÷N、×μ → accumulator → gain correction → DTC，再到兩個出口：PD 與 VCO 輸出
    expect([...focused].sort()).toEqual([...CH12_SYSTEM_FOCUS].sort())
    expect(focused.length).toBe(CH12_SYSTEM_FOCUS.length)
    expect(blocks.filter((b) => !b.focused).map((b) => b.id).sort()).toEqual(['align', 'div', 'dsm', 'fcw', 'lf', 'qnt', 'ref', 'res'])
    const byId = (id: string) => {
      const b = blocks.find((x) => x.id === id)
      if (!b) throw new Error(`系統地圖沒有方塊 ${id}`)
      return b
    }
    expect(byId('cmp').sub).toBe('$q[n] = \\mathrm{sign}(e[n])$')
    expect(byId('gmac').sub).toContain('\\sum q[n]\\,x[n]')
    expect(byId('noise').title).toContain('$v[n]$')
    // 地圖上的公式要由 KaTeX 排版：全圖至少 8 段 `$...$`（原本畫出來後數 `.katex` 的下限），本章主角的 cmp／gmac／noise／scale／acc 一定在內
    const mathSegments = (b: { title: string; sub?: string }) => `${b.title} ${b.sub ?? ''}`.match(/\$[^$]+\$/g)?.length ?? 0
    expect(blocks.reduce((n, b) => n + mathSegments(b), 0)).toBeGreaterThanOrEqual(8)
    for (const id of ['noise', 'cmp', 'gmac', 'scale', 'acc']) expect(mathSegments(byId(id)), id).toBeGreaterThan(0)
    // 方塊文字裡的數學一律 `$...$`、成對，沒有 Unicode 拼的數學
    for (const b of blocks) {
      for (const t of [b.title, b.sub ?? '']) {
        expect((t.match(/\$/g) ?? []).length % 2, `${b.id}：${t}`).toBe(0)
        expect(unicodeMathIn(t.replace(/\$[^$]*\$/g, '')), `${b.id}：${t}`).toEqual([])
      }
    }
  })

  it('T13/T14/T15: 圖上的範例數字就是模型算出來的數字（不是手打的）', () => {
    expect(D.CHART_TF_CHAIN).toContain(`\\sigma_w = ${EX.sigmaW.toFixed(3)}\\ \\mathrm{fs}`)
    expect(D.CHART_TF_CHAIN).toContain('\\sigma_w = 0.399\\ \\mathrm{fs}')
    expect(D.NOISE_CHAIN_CHART).toContain('\\sigma_v = 100\\ \\mathrm{fs}')
    // 四個頻寬（T14）
    const kHz = (hz: number) => `${(hz / 1e3).toFixed(2)}\\ \\mathrm{kHz}`
    for (const v of [EX.f3dbExact, EX.f3dbNegLnP, EX.f3dbOneMinusP, EX.enbw]) expect(D.CHART_BW_READOUTS).toContain(`= ${kHz(v)}`)
    for (const s of ['= 12.93\\ \\mathrm{kHz}', '= 12.92\\ \\mathrm{kHz}', '= 12.40\\ \\mathrm{kHz}', '= 20.29\\ \\mathrm{kHz}']) expect(D.CHART_BW_READOUTS, s).toContain(s)
    for (const s of ['\\frac{f_u}{\\pi}\\arcsin\\frac{1 - p}{2\\sqrt{p}}', '\\frac{-\\ln p}{2\\pi}f_u', '\\frac{1 - p}{2\\pi}f_u', '\\frac{f_u}{2}\\cdot\\frac{1 - p}{1 + p}', '\\sigma_w^2 = S_w^{(1)}(0)\\cdot\\mathrm{ENBW}']) expect(D.CHART_BW_READOUTS, s).toContain(s)
    // −3 dB 存在範圍（E27）
    expect(D.CHART_BW_REGIME).toContain((3 - 2 * Math.SQRT2).toFixed(4))
    expect(D.CHART_BW_REGIME).toContain((2 * Math.SQRT2 - 2).toFixed(4))
    // 位準 × 寬度
    expect(D.CHART_LEVEL_WIDTH).toContain('\\pi\\sigma_v^2 / (C^2 f_s)')
    expect(D.CHART_LEVEL_WIDTH).toContain('\\frac{f_u}{2}\\cdot\\frac{1 - p}{1 + p}')
    expect(D.CHART_LEVEL_WIDTH).toContain('2\\sigma_v^2 / f_s')
    // spur（T15）：科學記號寫成 m\times10^{e}（負號是 TeX 的 -，不是 Unicode 的 −）
    const sci = (x: number) => {
      const [m, e] = x.toExponential(3).split('e')
      return `${m}\\times10^{${Number(e)}}`
    }
    const beta = spurBeta(13e9, 0.5, 1)
    expect(D.CHART_SPUR_FLOW).toContain(`${sci(beta)}\\ \\mathrm{rad}`)
    expect(D.CHART_SPUR_FLOW).toContain('4.084\\times10^{-5}\\ \\mathrm{rad}')
    expect(D.CHART_SPUR_FLOW).toContain(`${spurDbcSmallAngle(beta).toFixed(2)}\\ \\mathrm{dBc}`)
    expect(D.CHART_SPUR_FLOW).toContain('-93.80\\ \\mathrm{dBc}')
    expect(D.CHART_SPUR_FLOW).toContain(`\\beta/2 = ${sci(beta / 2)}`)
    // 綜合手算的順序與答案（HC-12.8 的範例）
    expect(D.CHART_HAND_FLOW).toContain(`= ${EX.g.toFixed(5)}`)
    expect(D.CHART_HAND_FLOW).toContain(`= ${EX.p.toFixed(5)}`)
    for (const s of ['= 0.3992\\ \\mathrm{fs}', '= 0.399\\ \\mathrm{fs}', '= 0.282\\ \\mathrm{fs}', '= 0.0089\\ \\mathrm{fs}']) expect(D.CHART_HAND_FLOW, s).toContain(s)
    // 同一題的 solve()（預設值）給出同樣的三個 RMS
    const def = HANDCALCS.find((h) => h.id === 'HC-12.8')
    if (!def) throw new Error('找不到 HC-12.8')
    const sol = def.solve(defaultValues(def))
    const answers = sol.results.map((r) => r.value)
    for (const want of [EX.sigmaW, EX.sigmaW / Math.SQRT2, EX.sigmaW * Math.sqrt((2 * CODE_TABLE_PRM.fBw) / CODE_TABLE_PRM.fs)]) {
      expect(answers.some((a) => Math.abs(a - want) <= 1e-9 * want), `HC-12.8 的答案裡要有 ${want}`).toBe(true)
    }
  })

  it('三種 code 的兩個出口：圖上的數字就是 codeSpectraAnalytic() 的三欄，藍色是讀數比較大的那個出口', () => {
    const rows = codeTable().rows
    const row = (kind: string) => {
      const r = rows.find((x) => x.kind === kind)
      if (!r) throw new Error(`三種 code 表缺少 ${kind}`)
      return r
    }
    const g = flows.get('CHART_CODE_EXITS') as Flow
    const cells: [string, string, string, string][] = [
      ['const', 'C1', 'O1', 'P1'],
      ['tone', 'C2', 'O2', 'P2'],
      ['white', 'C3', 'O3', 'P3'],
    ]
    for (const [kind, c, o, p] of cells) {
      const r = row(kind)
      expect(vertexText(g, c), kind).toContain(`總 RMS $${r.totalRms.toFixed(3)}\\ \\mathrm{fs}$`)
      expect(vertexText(g, o), kind).toContain(`$${r.outRms.toFixed(3)}\\ \\mathrm{fs}$`)
      expect(vertexText(g, p), kind).toContain(`$${r.pdRms.toFixed(3)}\\ \\mathrm{fs}$`)
      expect(hasEdge(g, c, o) && hasEdge(g, c, p), kind).toBe(true)
    }
    // 藍色（focus）= 看到比較多的出口：常數與單頻 code 是 output，白色 code 是 PD
    expect(row('const').outRms).toBeGreaterThan(row('const').pdRms)
    expect(row('tone').outRms).toBeGreaterThan(row('tone').pdRms)
    expect(row('white').pdRms).toBeGreaterThan(row('white').outRms)
    expect(D.CHART_CODE_EXITS).toContain('class O1,O2,P3 focus')
    // 總 RMS：常數 σ_w、單頻 σ_w/√2、白色 σ_w（Parseval）
    expect(row('const').totalRms).toBeCloseTo(EX.sigmaW, 9)
    expect(row('tone').totalRms).toBeCloseTo(EX.sigmaW / Math.SQRT2, 9)
    expect(row('white').totalRms).toBeCloseTo(EX.sigmaW, 9)
  })
})

describe('第 12 章方塊圖：頁面上的位置', () => {
  /** 整章只渲染一次：把渲染結果複製成一份靜態 DOM（之後 RTL 的自動 cleanup 不會影響它）。 */
  let container: HTMLElement
  /** 圖的替身（依頁面順序）與公式錨點：各查一次就好（jsdom 在含上千個 KaTeX 節點的 DOM 上查詢並不便宜） */
  let stubs: HTMLElement[] = []
  const stubByChart = new Map<string, HTMLElement>()
  const anchorById = new Map<string, HTMLElement>()
  beforeAll(() => {
    localStorage.setItem('lmspll.mode', 'research') // Research 模式才看得到全部的圖（ModeGate 內有 1 張）
    const view = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/12']}>
          <Chapter12 />
        </MemoryRouter>
      </SettingsProvider>,
    )
    container = document.createElement('div')
    container.innerHTML = view.container.innerHTML
    cleanup()
    localStorage.clear()
    stubs = Array.from(container.querySelectorAll('[data-testid="mermaid-stub"]')) as HTMLElement[]
    for (const el of stubs) stubByChart.set(el.getAttribute('data-chart') ?? '', el)
    for (const el of Array.from(container.querySelectorAll('[id^="formula-"], [id^="handcalc-"]')) as HTMLElement[]) anchorById.set(el.id, el)
  }, T_SLOW)
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 // b 在 a 之後
  const stub = (name: string) => {
    const el = stubByChart.get(chartOf(name))
    if (!el) throw new Error(`頁面上找不到 ${name}`)
    return el
  }
  const formula = (id: string) => {
    const el = anchorById.get(`formula-${id}`)
    if (!el) throw new Error(`頁面上找不到 ${id}`)
    return el
  }
  const need = (selector: string) => {
    const el = container.querySelector(selector)
    if (!el) throw new Error(`頁面上找不到 ${selector}`)
    return el
  }

  it('章首（開場問題之後）有 <SystemMap>，藍色方塊是雜訊走的路徑；後面接一句說明', () => {
    const maps = container.querySelectorAll('[data-testid="system-map-stub"]')
    expect(maps.length).toBe(1)
    expect(maps[0].getAttribute('data-focus')).toBe(CH12_SYSTEM_FOCUS.join(','))
    // 雜訊 → comparator → GMAC → ÷N、×μ → accumulator → gain correction → DTC，再到兩個出口：PD 與 VCO 輸出
    expect(CH12_SYSTEM_FOCUS).toEqual(['noise', 'cmp', 'gmac', 'scale', 'acc', 'gc', 'dtc', 'pd', 'vco'])
    const question = need('.ch12-question') as HTMLElement
    expect(question.nextElementSibling).toBe(maps[0])
    expect(maps[0].nextElementSibling?.textContent ?? '').toMatch(/藍色方塊.*本章新增/)
    expect(maps[0].querySelector('figcaption')?.textContent ?? '').toMatch(/系統地圖.*phase detector.*VCO 輸出/)
    // 全站架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端；comparator 取 PD 的輸出（送進 loop filter 的同一個訊號）
    expect(maps[0].querySelector('figcaption')?.textContent ?? '').toMatch(/reference 輸入端的 DTC/)
    expect(maps[0].querySelector('figcaption')?.textContent ?? '').toMatch(/comparator 取的是 phase detector 的輸出.*loop filter 的同一個訊號/)
    expect(maps[0].nextElementSibling?.textContent ?? '').toMatch(/reference 輸入端的 DTC.*補償量/)
    // 系統地圖在第一個小節裡，而且在所有其他圖與第一個公式之前
    expect(need('#ch12-start').contains(maps[0])).toBe(true)
    expect(follows(maps[0], stubs[0])).toBe(true)
    expect(follows(maps[0], formula('F-12.1'))).toBe(true)
  })

  it('架構敘述（docs/assumptions.md §2a）：DTC 在 reference 輸入端、w·x 是補償量、PD 量的是 reference edge 減 feedback edge；§12.7 的推導由 e_PD = φ_dtc − θ_out 出發，解出來 θ_out = T·φ_dtc、e_PD = H_PD·φ_dtc', () => {
    const page = container.textContent ?? ''
    // 舊的說法（DTC 在回授路徑上「插入／多施加延遲」、誤差在 feedback 側注入）整頁都不能再出現
    for (const old of ['多施加', '多出來的延遲', 'DTC 多出的延遲', '本來就要的延遲', 'DTC 實際延遲', 'feedback 的比較路徑', 'feedback 比較路徑', 'feedback 側）加上相位']) {
      expect(page, old).not.toContain(old)
    }
    // DTC 不能產生負的延遲：不能在沒有基準延遲 T_0 的說明下寫「reference edge 被（多／少）提前」
    expect(page).not.toMatch(/被多提前|少提前了/)
    expect(need('[data-testid="system-map-stub"]').nextElementSibling?.textContent ?? '').toMatch(/DTC 的延遲比該有的短了一點或長了一點，reference edge 因此早到或晚到一點/)
    // 公式（KaTeX 的 TeX 原始碼）：推導的八行
    const tex = Array.from(container.querySelectorAll('#ch12-paths annotation')).map((a) => a.textContent ?? '')
    const has = (t: string) => tex.some((x) => x.includes(t))
    expect(has(String.raw`e_{\mathrm{PD}}=\phi_{\mathrm{dtc}}-\theta_{\mathrm{out}}`)).toBe(true)
    expect(has(String.raw`\theta_{\mathrm{out}}=L(s)\,e_{\mathrm{PD}}`)).toBe(true)
    expect(has(String.raw`\theta_{\mathrm{out}}=L\phi_{\mathrm{dtc}}-L\theta_{\mathrm{out}}\ \Rightarrow\ \theta_{\mathrm{out}}=\frac{L}{1+L}\phi_{\mathrm{dtc}}=T\phi_{\mathrm{dtc}}`)).toBe(true)
    expect(has(String.raw`e_{\mathrm{PD}}=(1-T)\phi_{\mathrm{dtc}}=\frac{1}{1+L}\phi_{\mathrm{dtc}}=H_{\mathrm{PD}}\phi_{\mathrm{dtc}}`)).toBe(true)
    expect(has(String.raw`H_{\mathrm{PD}}(s)+T(s)=1`)).toBe(true)
    expect(has(String.raw`\phi_{\mathrm{dtc}}=-2\pi f_{\mathrm{out}}\,\delta t`)).toBe(true)
    expect(has(String.raw`\phi_{\mathrm{out}}=\theta_{\mathrm{out}}=T\phi_{\mathrm{dtc}}=-2\pi f_{\mathrm{out}}\,T(s)\,\delta t(s)`)).toBe(true)
    expect(has(String.raw`e_{\mathrm{PD}}=H_{\mathrm{PD}}\phi_{\mathrm{dtc}}=-2\pi f_{\mathrm{out}}\,H_{\mathrm{PD}}(s)\,\delta t(s)`)).toBe(true)
    // 舊的 feedback 側注入：−(θ_out + φ_dtc)、−T·φ_dtc、−H_PD·φ_dtc 都不能留下
    for (const t of tex) {
      expect(t).not.toMatch(/-\\big\(\\theta_\{\\mathrm\{out\}\}\+\\phi_\{\\mathrm\{dtc\}\}/)
      expect(t).not.toMatch(/-\(\\theta_\{\\mathrm\{out\}\}\+\\phi_\{\\mathrm\{dtc\}\}\)/)
      expect(t).not.toMatch(/-T\\?,?\\phi_\{\\mathrm\{dtc\}\}|-H_\{\\mathrm\{PD\}\}\\?,?\\phi_\{\\mathrm\{dtc\}\}/)
    }
    // F-12.16 的負號不變（δt = x·δw 是多補償的時間：reference edge 早到 δt，進 PD 的是 −δt）
    expect((formula('F-12.16').querySelector('annotation')?.textContent ?? '')).toContain(String.raw`\phi_{\mathrm{out}}(s)=-2\pi f_{\mathrm{out}}T(s)\,\delta t(s)`)
    // 導讀：PLL 迴路圖從 reference 這一路講起，加法點就是 PD，feedback 只經過 divider；PD 的輸出就是 comparator 取的節點
    const readPll = stub('CHART_PLL_LOOP').closest('.ch12-diagram')?.querySelector('.ch12-diagram-read')?.textContent ?? ''
    expect(readPll).toMatch(/reference clock 先經過 DTC 才到 PD/)
    expect(readPll).toMatch(/feedback 那條線只經過 divider/)
    // divider 方塊與 L(s) 裡的「÷ 除數」是同一個 divider：以 output 為參考時 divider 把 θ_out 原樣送回，除數只算在 L(s) 裡
    expect(readPll).toMatch(/輸出的 edge 晚多少時間，divider 送回 PD 的 edge 就晚多少時間/)
    expect(readPll).toMatch(/除數只出現在開迴路增益.*和這個 divider 是同一個/)
    expect(readPll).toMatch(/loop filter.*comparator/)
    expect(stub('CHART_PLL_LOOP').querySelector('figcaption')?.textContent ?? '').toMatch(/路上只有 divider，沒有 DTC/)
    expect(stub('CHART_PLL_LOOP').querySelector('figcaption')?.textContent ?? '').toMatch(/DTC 在 reference 輸入端.*PD 的 reference 輸入/)
    const readChain = stub('NOISE_CHAIN_CHART').closest('.ch12-diagram')?.querySelector('.ch12-diagram-read')?.textContent ?? ''
    expect(readChain).toMatch(/comparator 取的是 PD 的輸出.*loop filter 的同一個訊號/)
    expect(readChain).toMatch(/reference 端的 DTC 多補償的時間/)
    // 數學模型那張圖只畫雜訊往前走的路：導讀交代 comparator 的輸入仍是 PD 的輸出，回授那一圈收在 H(z) 的 pole 裡
    const readTf = stub('CHART_TF_CHAIN').closest('.ch12-diagram')?.querySelector('.ch12-diagram-read')?.textContent ?? ''
    expect(readTf).toMatch(/comparator 的輸入仍然是 PD 的輸出/)
    expect(readTf).toMatch(/已經收在.*LMS 閉迴路/)
    const readGain = stub('CHART_GAIN_MULT').closest('.ch12-diagram')?.querySelector('.ch12-diagram-read')?.textContent ?? ''
    expect(readGain).toMatch(/補償量.*reference edge 被提前/)
    expect(readGain).toMatch(/本來就要補的量/)
    // §12.1 推導第一行：PD 量的是 reference edge 減 feedback edge；§12.6：DTC 只能延遲，從基準延遲往回扣
    expect(need('#ch12-linearize').textContent ?? '').toMatch(/PD 量的是「DTC 延遲後的 reference edge 減 feedback edge」/)
    expect(Array.from(container.querySelectorAll('#ch12-linearize annotation')).some((a) => (a.textContent ?? '').includes(String.raw`e[n]=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]`))).toBe(true)
    // §12.1 第一次講補償就交代 T_0（DTC 只能延遲）：feedback edge 早到 a·x，DTC 的延遲 τ = T_0 − w_k·x；補償不足時 e 為正
    const lin1 = need('#ch12-linearize').textContent ?? ''
    expect(lin1).toMatch(/feedback（divider）edge 早到/)
    expect(lin1).toMatch(/只能延遲、不能提前.*從固定的基準.*縮短/)
    expect(lin1).toMatch(/補償不足.*reference edge 還是太晚.*為正/)
    expect(Array.from(container.querySelectorAll('#ch12-linearize annotation')).some((a) => (a.textContent ?? '').includes(String.raw`\tau_{\mathrm{DTC}}=T_0-w_k\,x[n]`))).toBe(true)
    expect(need('#ch12-mixing').textContent ?? '').toMatch(/DTC 只能延遲、不能提前/)
    expect(Array.from(container.querySelectorAll('#ch12-mixing annotation')).some((a) => (a.textContent ?? '').includes(String.raw`\tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`))).toBe(true)
    // 公式登錄與符號表也用同一個說法
    const f15 = FORMULAS.find((f) => f.id === 'F-12.15')
    const f16 = FORMULAS.find((f) => f.id === 'F-12.16')
    expect(f15?.conditions).toContain('reference 輸入')
    expect(f15?.conditions).toContain(String.raw`e_{\mathrm{PD}}=\phi_{\mathrm{dtc}}-\theta_{\mathrm{out}}`)
    expect(f16?.conditions).toContain(String.raw`\phi_{\mathrm{dtc}}=-2\pi f_{\mathrm{out}}\delta t`)
    expect(f16?.tex).toContain(String.raw`\phi_{\mathrm{out}}(s)=-2\pi f_{\mathrm{out}}T(s)\,\delta t(s)`)
    for (const f of FORMULAS) expect(`${f.title} ${f.conditions ?? ''}`, f.id).not.toMatch(/feedback/)
    const symbols = need('#symbols').textContent ?? ''
    expect(symbols).toMatch(/reference 端的 DTC 多補償的時間/)
    expect(symbols).toMatch(/固定的基準延遲/)
    expect(symbols).toMatch(/PD 的輸出，送進 loop filter 的同一個訊號/)
  })

  it(`頁面上畫出的 Mermaid 圖與 CH12_CHARTS 完全相同（${N_CHARTS} 張、同樣的順序），加上系統地圖共 ${N_CHARTS + 1} 張；每張都有圖說與「先看…再看…」的導讀`, () => {
    expect(stubs.map((s) => s.getAttribute('data-chart'))).toEqual(CH12_CHARTS.map((c) => c.chart))
    expect(stubs.length + container.querySelectorAll('[data-testid="system-map-stub"]').length).toBe(N_CHARTS + 1)
    const blocks = Array.from(container.querySelectorAll('.ch12-diagram')) as HTMLElement[]
    expect(blocks.length).toBe(N_CHARTS)
    blocks.forEach((b, i) => {
      const name = CH12_CHARTS[i].name
      const caption = b.querySelector('figcaption')?.textContent ?? ''
      expect(caption.length, name).toBeGreaterThan(12)
      // 圖說裡的數學一律寫成 $...$（由 Mermaid 元件以 KaTeX 顯示）：拿掉 $...$ 之後不得殘留 Unicode 拼的公式
      expect((caption.match(/\$/g) ?? []).length % 2, `${name} 圖說的 $ 要成對`).toBe(0)
      expect(caption.replace(/\$[^$]*\$/g, ''), `${name} 圖說`).not.toMatch(/[A-Za-z]_[a-z0-9{(]|\^|[σμηδτβθΩℒφΦ√∫Σπ≈∝ρ·×²⁻]/)
      const read = b.querySelector('.ch12-diagram-read')?.textContent ?? ''
      expect(read.length, name).toBeGreaterThan(40)
      expect(read, name).toMatch(/先/)
      expect(read, name).toMatch(/再|最後|接著/)
      // 圖與公式的對照（「圖上的 X 就是公式裡的 x」）
      expect(read, name).toMatch(/圖上|圖中|對照|對應/)
    })
  })

  it('每張圖都放在它對應的公式（推導）之前', () => {
    const before: [string, string[]][] = [
      ['NOISE_CHAIN_CHART', ['F-12.1']],
      ['CHART_TF_CHAIN', ['F-12.1']],
      ['CHART_GMAC_LINEAR', ['F-12.1']],
      ['CHART_UPDATE_LOOP', ['F-12.2']],
      ['CHART_COEF_LOOP', ['F-12.3']],
      ['CHART_PSD_FILTER', ['F-12.4']],
      ['CHART_VAR_LOOP', ['F-12.5', 'F-12.6']],
      ['CHART_COLORED_ETA', ['F-12.7']],
      ['CHART_BW_READOUTS', ['F-12.7', 'F-12.8', 'F-12.9']],
      ['CHART_LEVEL_WIDTH', ['F-12.9', 'F-12.19']],
      ['CHART_GAIN_MULT', ['F-12.11']],
      ['CHART_TONE_MIXER', ['F-12.12']],
      ['CHART_MIX_DOMAINS', ['F-12.13']],
      ['CHART_THREE_CODES', ['F-12.14']],
      ['CHART_DC_FEEDTHROUGH', ['F-12.14']],
      ['CHART_BLOCK_TIMING', ['F-12.14']],
      ['CHART_ZOH_TWO_STEP', ['F-12.14']],
      ['CHART_PSD_UNITS', ['F-12.10']],
      ['CHART_TWO_EXITS', ['F-12.15', 'F-12.16', 'F-12.17']],
      ['CHART_PLL_LOOP', ['F-12.15', 'F-12.16', 'F-12.17']],
      ['CHART_CODE_EXITS', ['F-12.18']],
      ['CHART_SPUR_FLOW', ['F-12.18']],
    ]
    for (const [name, ids] of before) for (const id of ids) expect(follows(stub(name), formula(id)), `${name} → ${id}`).toBe(true)
    // 本章 19 個公式（F-12.1 … F-12.19）前面都有圖：每個公式之前至少有一張 Mermaid 圖在同一個二級小節裡
    for (let i = 1; i <= 19; i++) {
      const f = formula(`F-12.${i}`)
      const section = f.closest('section[id^="ch12-"]')
      expect(section, `F-12.${i}`).toBeTruthy()
      expect(stubs.some((s) => follows(s, f)), `F-12.${i} 之前沒有圖`).toBe(true)
    }
    // 判斷型態的圖緊跟在 F-12.7（它的存在範圍）之後、ENBW 之前
    expect(follows(formula('F-12.7'), stub('CHART_BW_REGIME'))).toBe(true)
    expect(follows(stub('CHART_BW_REGIME'), formula('F-12.8'))).toBe(true)
    // 三種 code 與 DC 直通：在 F-12.13（卷積）之後——它們是 F-12.13 的特例——程式碼 dtPsdOneSided 的前後
    expect(follows(formula('F-12.13'), stub('CHART_THREE_CODES'))).toBe(true)
    expect(follows(stub('CHART_THREE_CODES'), stub('CHART_DC_FEEDTHROUGH'))).toBe(true)
    // 三種 code 的兩個出口：在 F-12.17 之後、同一小節的表格之前
    expect(follows(formula('F-12.17'), stub('CHART_CODE_EXITS'))).toBe(true)
    expect(follows(stub('CHART_CODE_EXITS'), need('#ch12-three-codes table'))).toBe(true)
    // skirt 還是 spur：在 F-12.18 之後（用哪個公式的分類）
    expect(follows(formula('F-12.18'), stub('CHART_SKIRT_OR_SPUR'))).toBe(true)
    // 綜合手算的流程圖在 HC-12.8 之前；三個引擎的圖在比較表之前
    expect(follows(stub('CHART_HAND_FLOW'), anchorById.get('handcalc-HC-12.8') as HTMLElement)).toBe(true)
    expect(follows(stub('CHART_ENGINES'), need('#ch12-engines table'))).toBe(true)
    expect(D.CHART_ENGINES).toContain('(a) 線性遞迴')
    // 硬體旋鈕的圖在「連結到硬體」小節、四個說明框之前；符號表在它之後（整頁最後）
    expect(need('#ch12-hardware').contains(stub('CHART_HW_KNOBS'))).toBe(true)
    expect(follows(stub('CHART_HW_KNOBS'), need('.ch12-hw'))).toBe(true)
    expect(follows(stub('CHART_HW_KNOBS'), need('#symbols'))).toBe(true)
    expect(stubs.every((s) => follows(s, need('#symbols')))).toBe(true)
  })
})
