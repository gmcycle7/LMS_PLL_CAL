import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import katex from 'katex'
import mermaid from 'mermaid'
import { SettingsProvider } from '@/app/settings'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { FR_CHARTS, CHART_FORMULA_LINKS, CHART_RATE_DOMAINS, CHART_UNIT_CHAIN } from './diagrams'
import * as D from './diagrams'
import { refValues, T13_SETUP } from './refValues'
import { ALL_FORMULAS } from './registry'
import { ERRATA } from './errata'
import { RegistrySection } from './sections/RegistrySection'
import { IndexTopic } from './sections/units/IndexTopic'
import { MuUnitsTopic } from './sections/units/GainTopic'
import { TimelineDiagram } from './sections/units/TimelineDiagram'

// 頁面測試用的 Mermaid 元件替身：把原始碼放在 data-chart，方便核對「頁面上到底畫了哪些圖」。
// 真正的 mermaid 套件沒有被 mock，下面照樣用它解析與渲染。
vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  return {
    Mermaid: ({ chart, caption }: { chart: string; caption?: string }) =>
      createElement('figure', { className: 'c-mermaid', 'data-chart': chart }, caption ? createElement('figcaption', { className: 'c-figcaption' }, caption) : null),
    renderMermaid: async () => '<svg></svg>',
  }
})
vi.mock('plotly.js-dist-min', async () => ({ default: (await import('./domTestUtils')).PLOTLY_STUB }))

beforeAll(installMermaidSvgShim)

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

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊 */
async function flow(chart: string): Promise<{ vertices: Vertex[]; edges: Edge[]; subgraphs: { id: string; title: string }[] }> {
  await mermaid.parse(chart)
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[]; getSubGraphs: () => { id: string; title: string }[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges(), subgraphs: db.getSubGraphs() }
}

const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/[\s\u200b]+/g, '')

/** 標籤原始碼（`$...$` 的 TeX）去掉空白；用來比對「哪個 TeX 寫在哪個標籤」，不受排版空白影響 */
const tx = (s: string) => s.replace(/\s+/g, '')

/** 原始碼裡所有雙引號標籤（節點、連線、subgraph 標題） */
const sourceLabels = (chart: string) => (chart.match(/"[^"\n]*"/g) ?? []).map((l) => l.slice(1, -1))
/** 標籤裡 `$...$` 以外的文字：不得再有 Unicode 拼的數學（這些字會被包進 KaTeX 的 \text{}，畫出來的文字檢查看不到） */
const outsideMath = (chart: string) => sourceLabels(chart).map((l) => l.replace(/\$[^$]*\$/g, ' ')).join('\n')
const mathLabelCount = (chart: string) => sourceLabels(chart).filter((l) => /\$[^$]+\$/.test(l)).length

/** 一段 TeX 用 KaTeX 排版後的文字（不含 MathML 複本、零寬空白與空白）；和 Mermaid 畫出來的同一段公式逐字相同 */
function katexText(tex: string): string {
  const host = document.createElement('div')
  host.innerHTML = katex.renderToString(tex, { displayMode: true, throwOnError: true, output: 'htmlAndMathml' })
  host.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  return plain(host.textContent ?? '')
}

/** 標籤原始碼（文字夾 `$...$`，`<br/>` 換行）→ 畫面上應該出現的文字 */
function expectedDrawn(label: string): string {
  return label
    .split(/<br\s*\/?>/i)
    .map((line) => {
      let out = ''
      let last = 0
      for (const m of line.matchAll(/\$([^$]+)\$/g)) {
        out += plain(line.slice(last, m.index)) + katexText(m[1])
        last = (m.index ?? 0) + m[0].length
      }
      return out + plain(line.slice(last))
    })
    .join('')
}

const text = (g: { vertices: Vertex[] }, id: string) => g.vertices.find((v) => v.id === id)?.text ?? ''
const edge = (g: { edges: Edge[] }, start: string, end: string): Edge => {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e
}

describe('Formula & Unit Reference 的 Mermaid 圖：清單與解析', () => {
  it('共 3 張；名稱、原始碼都不重複；diagrams.ts 匯出的每個 Mermaid 原始碼都在清單裡', () => {
    expect(FR_CHARTS.length).toBe(3)
    expect(new Set(FR_CHARTS.map((c) => c.name)).size).toBe(3)
    expect(new Set(FR_CHARTS.map((c) => c.chart)).size).toBe(3)
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(FR_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(FR_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
  })

  it('版面：三張都是直向（flowchart TB）；時間軸圖的 sample 軸先宣告 u[n]，這樣 dagre 把「δ_k 虛線回到 e[n]」當成回授邊，主流程才會由上往下讀（teaching-style §8「版面寬度」）', () => {
    for (const c of FR_CHARTS) expect(c.chart, c.name).toMatch(/^flowchart TB\n/)
    const fs = CHART_RATE_DOMAINS.match(/subgraph FS\[[^\n]*\n([\s\S]*?)\n {2}end/)![1]
    const order = Array.from(fs.matchAll(/^\s*(\w+)\[/gm), (m) => m[1])
    expect(order).toEqual(['U', 'E', 'Q', 'P', 'X'])
  })

  it('每一張都能被真正的 mermaid parser 解析成 flowchart', async () => {
    for (const c of FR_CHARTS) {
      const r = await mermaid.parse(c.chart)
      expect(r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : '', c.name).toMatch(/^flowchart/)
    }
  }, 60000)

  it('實際渲染（共用的 renderMermaidForTest）：沒有「Unsupported markdown」、畫面上沒有殘留的 $、沒有 Unicode 拼的數學、節點數不超過 14', async () => {
    for (const c of FR_CHARTS) {
      const { text: shownText, plainText, nodeCount, mathCount } = await renderMermaidForTest(c.chart)
      expect(shownText, c.name).not.toMatch(/Unsupported markdown/)
      expect(shownText, `${c.name}：圖上殘留 $`).not.toContain('$')
      // KaTeX 以外的文字不得有 Unicode 拼的數學（畫出來的文字）；標籤裡 `$...$` 以外的文字也一樣（原始碼）
      expect(unicodeMathIn(plainText), `${c.name}：圖上（KaTeX 以外）的 Unicode 數學`).toEqual([])
      expect(unicodeMathIn(outsideMath(c.chart)), `${c.name}：標籤裡 $…$ 以外的 Unicode 數學`).toEqual([])
      // 每個含 `$...$` 的標籤（節點、連線、subgraph 標題）都真的由 KaTeX 排版
      expect(mathCount, `${c.name} 的 KaTeX 公式數`).toBe(mathLabelCount(c.chart))
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeGreaterThan(0)
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeLessThanOrEqual(14)
    }
  }, 120000)

  it('畫面上的每個標籤（節點、連線、subgraph 標題）都是原始碼標籤的排版結果：文字照原樣，每段 $…$ 是同一段 TeX 的 KaTeX', async () => {
    for (const c of FR_CHARTS) {
      const { svg } = await renderMermaidForTest(c.chart)
      const host = document.createElement('div')
      host.innerHTML = svg
      // 圖上每個標籤的文字：拿掉 KaTeX 的 MathML 複本、零寬空白與空白
      const shown = new Set(
        Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel')).map((e) => {
          const copy = e.cloneNode(true) as Element
          copy.querySelectorAll('.katex-mathml').forEach((m) => m.remove())
          return plain(copy.textContent ?? '')
        }),
      )
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      const labels: [string, string][] = [
        ...g.vertices.map((v): [string, string] => [`節點 ${v.id}`, v.text ?? '']),
        ...g.edges.filter((e) => e.text).map((e): [string, string] => [`邊 ${e.start}→${e.end}`, e.text ?? '']),
        ...g.subgraphs.map((s): [string, string] => [`subgraph ${s.id}`, s.title]),
      ]
      for (const [where, label] of labels) expect(shown.has(expectedDrawn(label)), `${c.name} ${where}：「${label}」沒有照原始碼排版出現在圖上`).toBe(true)
      // 圖上的標籤數沒有多出原始碼沒有的東西（連線標籤與 subgraph 標題各出現一次）
      expect(sourceLabels(c.chart).length, c.name).toBe(labels.length)
    }
  }, 120000)
})

describe('圖和本頁公式、數字一致', () => {
  it('單位鏈：K = K_q·C → g = μK（sum mode 多乘 N）→ p = 1 − g → f_3dB、ENBW 都靠 f_u = f_s/N；數字與 refValues 一致', async () => {
    const g = await flow(CHART_UNIT_CHAIN)
    // 箭頭方向：σ_v → K_q → K ← C；K、μ → g → p → 兩種頻寬；f_u → 兩種頻寬
    for (const [a, b] of [['SV', 'KQ'], ['KQ', 'K'], ['CC', 'K'], ['K', 'G'], ['MU', 'G'], ['G', 'P'], ['P', 'F3'], ['P', 'EN'], ['FU', 'F3'], ['FU', 'EN']]) edge(g, a, b)
    expect(g.edges.some((e) => e.start === 'G' && e.end === 'K')).toBe(false) // 不能反向
    // 公式與單位（標籤是 `$...$` 的 LaTeX；空白不計）
    const has = (id: string, tex: string) => expect(tx(text(g, id)), `${id} 標籤裡的 ${tex}`).toContain(tx(tex))
    has('KQ', String.raw`$K_q = \sqrt{2/\pi} / \sigma_v$`)
    has('KQ', String.raw`[$\mathrm{fs^{-1}}$]`) // [fs⁻¹]
    has('SV', String.raw`$\sigma_v$`)
    has('SV', '[fs]')
    has('K', String.raw`$K = K_q \cdot C$`)
    has('K', String.raw`[$\mathrm{fs^{-1}}$]`)
    has('CC', String.raw`$C = E[x \cdot u]$`)
    has('MU', String.raw`$\mu$`)
    has('MU', '[fs]')
    has('G', String.raw`$g = \mu \cdot K$`)
    has('G', '[1]')
    has('P', String.raw`$p = 1 - g$`)
    has('FU', String.raw`$f_u = f_s / N$`)
    has('F3', String.raw`$f_{3\mathrm{dB}} = \frac{f_u}{\pi} \cdot \arcsin\frac{1-p}{2\sqrt{p}}$`)
    has('F3', String.raw`$p \ge 3 - 2\sqrt{2}$`)
    has('EN', String.raw`$\mathrm{ENBW} = \frac{f_u}{2} \cdot \frac{1-p}{1+p}$`)
    // sum mode 的 N 是虛線，接到 g（不是 p）
    has('NN', String.raw`$\times N$`)
    expect(tx(edge(g, 'NN', 'G').text ?? '')).toBe(tx(String.raw`$g = \mu \cdot K \cdot N$`))
    expect(edge(g, 'NN', 'G').stroke).toBe('dotted')
    expect(g.edges.some((e) => e.start === 'NN' && e.end !== 'G')).toBe(false)

    // 數字：同一組 T13 條件，圖上的關係式在 refValues 裡成立
    const lp = refValues().loop
    const N = T13_SETUP.N
    expect(lp.g).toBeCloseTo(T13_SETUP.mu * lp.K, 12) // g = μK（μ 的單位 fs、K 的單位 fs⁻¹）
    expect(lp.p).toBeCloseTo(1 - lp.g, 12)
    expect(lp.gSum).toBeCloseTo(N * lp.g, 10) // sum mode：g = μ K N
    expect(lp.fu).toBeCloseTo(T13_SETUP.fs / N, 3)
    expect(lp.enbw).toBeCloseTo((lp.fu / 2) * ((1 - lp.p) / (1 + lp.p)), 6)
    expect(lp.f3dbExact).toBeCloseTo((lp.fu / Math.PI) * Math.asin((1 - lp.p) / (2 * Math.sqrt(lp.p))), 6)
    expect(lp.p).toBeGreaterThanOrEqual(3 - 2 * Math.SQRT2) // 本例有 −3 dB 點
  })

  it('兩條時間軸：e、q 在 sample rate，G_k、w_k、δ_k 在 block rate；累加是 sample → block，ZOH 是 block → sample', async () => {
    const g = await flow(CHART_RATE_DOMAINS)
    const inSub = (name: string) => {
      const m = CHART_RATE_DOMAINS.match(new RegExp(`subgraph ${name}\\[[^\\n]*\\n([\\s\\S]*?)\\n  end`))
      return m ? m[1] : ''
    }
    // subgraph 標題的數學也是 `$...$`（索引 n、k；速率 f_s、f_u = f_s/N）
    expect(g.subgraphs.map((s) => [s.id, tx(s.title)])).toEqual([
      ['FS', tx(String.raw`sample rate：索引 $n$，速率 $f_s$`)],
      ['FU', tx(String.raw`block rate：索引 $k$，速率 $f_u = f_s / N$`)],
    ])
    for (const id of ['X', 'U', 'E', 'Q', 'P']) expect(inSub('FS'), id).toMatch(new RegExp(`\\b${id}\\[`))
    for (const id of ['G', 'W', 'D']) expect(inSub('FU'), id).toMatch(new RegExp(`\\b${id}\\[`))
    expect(inSub('FS')).not.toMatch(/\bZ\[/)
    expect(inSub('FU')).not.toMatch(/\bZ\[/)
    // 公式：e[n] ≈ δ_k·u[n] + v[n]、q[n] = sign(e[n])、G_k = (1/N)Σ q[n]x[n]、w_(k+1) = w_k + μG_k、δ_k = a − w_k、w[n] = w_⌊n/N⌋
    expect(tx(text(g, 'X'))).toBe(tx(String.raw`$x[n]$：原始 code`))
    expect(tx(text(g, 'U'))).toBe(tx(String.raw`$u[n]$：經 PD 路徑的 code`))
    // 架構（docs/assumptions.md §2a）：comparator 的輸入是 PD 的輸出 e[n]，圖上要寫明這個節點是什麼
    // 技術審查 R06b：w_k 在迴路裡逐 block 更新，δ_k 提到 PD 路徑外面只是近似（F-06.1），節點寫 \approx 不寫等號
    expect(tx(text(g, 'E'))).toBe(tx(String.raw`PD 的輸出<br>$e[n] \approx \delta_k \cdot u[n] + v[n]$`))
    expect(CHART_RATE_DOMAINS).not.toContain(String.raw`$e[n] = \delta_k \cdot u[n] + v[n]$`)
    expect(tx(text(g, 'Q'))).toBe(tx(String.raw`1-bit comparator<br>$q[n] = \operatorname{sign}(e[n])$`))
    expect(g.edges.filter((e) => e.end === 'Q').map((e) => e.start)).toEqual(['E'])
    expect(tx(text(g, 'P'))).toBe(tx(String.raw`$q[n] \cdot x[n]$`))
    expect(tx(text(g, 'G'))).toContain(tx(String.raw`$G_k = \frac{1}{N} \sum q[n] \cdot x[n]$`))
    expect(tx(text(g, 'G'))).toContain(tx(String.raw`$n$ 屬於 block $k$`))
    expect(tx(text(g, 'W'))).toBe(tx(String.raw`$w_{k+1} = w_k + \mu \cdot G_k$`))
    expect(tx(text(g, 'D'))).toBe(tx(String.raw`$\delta_k = a - w_k$`))
    expect(tx(text(g, 'Z'))).toContain(tx(String.raw`$w[n] = w_{\lfloor n/N \rfloor}$`))
    expect(tx(text(g, 'Z'))).toContain(tx(String.raw`每個 $w_k$ 重複 $N$ 次`))
    // 箭頭方向：u → e → q → q·x → G → w → δ；δ 以虛線回到 e（block 內保持不變）；w → ZOH
    for (const [a, b] of [['U', 'E'], ['E', 'Q'], ['Q', 'P'], ['X', 'P'], ['P', 'G'], ['G', 'W'], ['W', 'D'], ['D', 'E'], ['W', 'Z']]) edge(g, a, b)
    expect(edge(g, 'D', 'E').stroke).toBe('dotted')
    expect(tx(edge(g, 'P', 'G').text ?? '')).toBe(tx(String.raw`累加 $N$ 筆`))
    expect(tx(edge(g, 'D', 'E').text ?? '')).toBe(tx(String.raw`block $k$ 內保持不變`))
    expect(tx(edge(g, 'W', 'Z').text ?? '')).toBe(tx(String.raw`$w_k$`))
    // 累加是 sample → block：只有 P 連到 G；ZOH 是 block → sample：Z 沒有往回連到 block 軸的邊
    expect(g.edges.filter((e) => e.end === 'G').map((e) => e.start)).toEqual(['P'])
    expect(g.edges.filter((e) => e.start === 'Z')).toEqual([])
  })

  it('公式登錄流程圖：章節 formulas.ts → registry → ALL_FORMULAS → 本頁一列 → 前往 → 章節錨點；勘誤 → tooltip 與驗證頁', async () => {
    const g = await flow(CHART_FORMULA_LINKS)
    for (const [a, b] of [['CH', 'GLOB'], ['GLOB', 'ALL'], ['ALL', 'ROW'], ['ROW', 'JMP'], ['JMP', 'ANC'], ['CH', 'ANC'], ['ERR', 'ROW'], ['ROW', 'VER'], ['ERR', 'VER']]) edge(g, a, b)
    expect(g.edges.length).toBe(9)
    expect(edge(g, 'CH', 'ANC').stroke).toBe('dotted')
    // 圖上寫的欄位名稱就是 FormulaEntry 真正有的欄位（用登錄裡的實際資料核對）
    const sample = ALL_FORMULAS[0]
    for (const field of ['id', 'title', 'tex', 'conditions', 'claim', 'level', 'page']) expect(Object.keys(sample), field).toContain(field)
    expect(text(g, 'CH')).toContain('export const FORMULAS')
    for (const field of ['id', 'title', 'tex', 'conditions', 'claim', 'level', 'page', 'erratumId']) expect(text(g, 'CH'), field).toContain(field)
    expect(ALL_FORMULAS.some((f) => f.erratumId)).toBe(true)
    // 勘誤 ID 的格式與 errata.json 一致
    expect(text(g, 'ERR')).toContain('Exx')
    expect(ERRATA.every((e) => /^E\d{2}$/.test(e.eid))).toBe(true)
    expect(text(g, 'VER')).toContain('#/verification?e=Exx')
    expect(text(g, 'JMP')).toContain('jumpToFormula(id)')
    expect(text(g, 'ANC')).toContain('#formula-ID')
    expect(text(g, 'GLOB')).toContain('import.meta.glob')
    // 程式碼識別字 ALL_FORMULAS 的底線不能裸寫（會被當成 Unicode 拼的下標）：用等寬字體的 KaTeX 排版，且確實是 registry 的匯出名稱
    expect(text(g, 'ALL')).toContain(String.raw`$\mathtt{ALL\_FORMULAS}$`)
    expect(Object.keys(await import('./registry'))).toContain('ALL_FORMULAS')
  })
})

describe('頁面上的方塊圖（teaching-style §8）：位置與圖說', () => {
  const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓]/

  function checkCaption(fig: Element) {
    const cap = fig.querySelector('figcaption')?.textContent ?? ''
    expect(cap.length).toBeGreaterThan(15)
    expect((cap.match(/\$/g) ?? []).length % 2, `圖說的 $ 要成對：${cap}`).toBe(0)
    const outsideMath = cap.split('$').filter((_, i) => i % 2 === 0).join('')
    expect(BAD.test(outsideMath), `圖說有 Unicode 拼湊的數學（請改寫成 $...$）：${cap}`).toBe(false)
    expect(unicodeMathIn(outsideMath), `圖說有 Unicode 拼湊的數學（請改寫成 $...$）：${cap}`).toEqual([])
  }

  it('§2.1 的兩條時間軸圖在索引表之後、角頻率先備知識框之前；圖說的數學是 $...$', () => {
    const { container } = render(
      <MemoryRouter>
        <SettingsProvider>
          <IndexTopic />
        </SettingsProvider>
      </MemoryRouter>,
    )
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual([CHART_RATE_DOMAINS])
    checkCaption(figs[0])
    expect(figs[0].previousElementSibling?.textContent).toContain('先看圖')
    const table = container.querySelector('table.fr-index-table')!
    const prereq = container.querySelector('.c-prereq')!
    expect(table.compareDocumentPosition(figs[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(figs[0].compareDocumentPosition(prereq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('§2.3 的單位鏈圖在因次分析先備知識框之後、一步一步推導之前', () => {
    const { container } = render(
      <MemoryRouter>
        <SettingsProvider>
          <MuUnitsTopic />
        </SettingsProvider>
      </MemoryRouter>,
    )
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual([CHART_UNIT_CHAIN])
    checkCaption(figs[0])
    const prereq = container.querySelector('.c-prereq')!
    const steps = container.querySelector('.c-steps')!
    expect(prereq.compareDocumentPosition(figs[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(figs[0].compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('§4 公式登錄：沒有搜尋時圖在篩選器之前；搜尋時不顯示', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <SettingsProvider>
          <RegistrySection rows={[...ALL_FORMULAS]} searching={false} focusId={null} />
        </SettingsProvider>
      </MemoryRouter>,
    )
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual([CHART_FORMULA_LINKS])
    checkCaption(figs[0])
    expect(figs[0].compareDocumentPosition(container.querySelector('.fr-filters')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    rerender(
      <MemoryRouter>
        <SettingsProvider>
          <RegistrySection rows={[...ALL_FORMULAS]} searching focusId={null} />
        </SettingsProvider>
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(0)
  })
})

describe('時間軸示意圖（§2.1 的 SVG）：圖裡的符號與公式也是 KaTeX', () => {
  it('每個標籤是 foreignObject 裡的 KaTeX，SVG 沒有留下 <text>；KaTeX 以外沒有 Unicode 拼的數學、沒有殘留的 $、沒有 KaTeX 錯誤', () => {
    const { container } = render(<TimelineDiagram />)
    const svg = container.querySelector('svg.fr-timeline')!
    expect(svg.querySelectorAll('text').length).toBe(0)
    expect(svg.querySelectorAll('foreignObject').length).toBe(18)
    // foreignObject 裡面是 HTML 命名空間的 div（KaTeX 才排得出來），foreignObject 本身在 SVG 命名空間
    for (const f of Array.from(svg.querySelectorAll('foreignObject'))) {
      expect(f.namespaceURI).toBe('http://www.w3.org/2000/svg')
      expect(f.firstElementChild?.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
    }
    expect(svg.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    // KaTeX 以外的文字（拿掉 KaTeX 與它的 MathML 複本）
    const copy = svg.cloneNode(true) as Element
    copy.querySelectorAll('.katex').forEach((e) => e.remove())
    const outside = copy.textContent ?? ''
    expect(unicodeMathIn(outside), outside).toEqual([])
    expect(outside).not.toContain('$')
    expect(outside).not.toContain('−')
    // 每個 KaTeX 的原始 TeX（KaTeX 的 MathML 複本裡留有 annotation）
    const tex = Array.from(svg.querySelectorAll('annotation[encoding="application/x-tex"]')).map((a) => a.textContent ?? '')
    for (const want of [
      '(k-1)N', 'kN', '(k+1)N', '(k+2)N', // block 邊界在 sample 軸上的位置
      'n', 'f_s', 'k', 'f_u', 'm', // 三條軸的索引與速率
      String.raw`G_k = \frac{1}{N}\sum q\cdot x`, 'k-1', 'k+1',
      'w[n]', 'w_{k-1}', 'w_k', 'w_{k+1}', 'n_c',
      'N', 'N=4096', String.raw`n=kN,\ \ldots,\ kN+N-1`,
    ])
      expect(tex, want).toContain(want)
    expect(tex.length).toBeGreaterThanOrEqual(24)
  })

  it('版面不變：4 個 block 邊界刻度、3 個 block 方塊（第 k 個高亮）＋ PVT 方塊、2 個 n_c；w_{k-1}、w_k、w_{k+1} 由左到右', () => {
    const { container } = render(<TimelineDiagram />)
    const svg = container.querySelector('svg.fr-timeline')!
    expect(svg.querySelectorAll('line.fr-tl-tick-major').length).toBe(4)
    expect(svg.querySelectorAll('line.fr-tl-tick').length).toBe(21)
    expect(svg.querySelectorAll('rect.fr-tl-block').length).toBe(4)
    expect(svg.querySelectorAll('rect.fr-tl-block-on').length).toBe(1)
    const fo = (tex: string) => {
      const found = Array.from(svg.querySelectorAll('foreignObject')).filter((f) => Array.from(f.querySelectorAll('annotation')).some((a) => a.textContent === tex))
      return found.map((f) => Number(f.getAttribute('x')))
    }
    // n_c：兩個 block 邊界各一個標籤（寬 40），另外在最下面的說明文字裡再出現一次
    expect(fo('n_c').length).toBe(3)
    expect(Array.from(svg.querySelectorAll('foreignObject[width="40"]')).length).toBe(2)
    const [a] = fo('w_{k-1}')
    const [b] = fo('w_k')
    const [c] = fo('w_{k+1}')
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    // block 邊界標籤由左到右：(k−1)N、kN、(k+1)N、(k+2)N
    const xs = ['(k-1)N', 'kN', '(k+1)N', '(k+2)N'].map((t) => fo(t)[0])
    expect([...xs].sort((p, q2) => p - q2)).toEqual(xs)
    // figure 的無障礙名稱與 <title> 是純文字（不放公式）
    expect(container.querySelector('figure')?.getAttribute('aria-label')).not.toContain('$')
    expect(svg.querySelector('title')?.textContent).not.toContain('$')
  })
})
