import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { SettingsProvider } from '@/app/settings'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { FR_CHARTS, CHART_FORMULA_LINKS, CHART_RATE_DOMAINS, CHART_UNIT_CHAIN } from './diagrams'
import * as D from './diagrams'
import { refValues, T13_SETUP } from './refValues'
import { ALL_FORMULAS } from './registry'
import { ERRATA } from './errata'
import { RegistrySection } from './sections/RegistrySection'
import { IndexTopic } from './sections/units/IndexTopic'
import { MuUnitsTopic } from './sections/units/GainTopic'

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
async function flow(chart: string): Promise<{ vertices: Vertex[]; edges: Edge[] }> {
  await mermaid.parse(chart)
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')

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

  it('每一張都能被真正的 mermaid parser 解析成 flowchart', async () => {
    for (const c of FR_CHARTS) {
      const r = await mermaid.parse(c.chart)
      expect(r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : '', c.name).toMatch(/^flowchart/)
    }
  }, 60000)

  it('實際渲染（共用的 renderMermaidForTest）：沒有「Unsupported markdown」、節點數不超過 14，畫面上的每個標籤都和原始碼相同', async () => {
    for (const c of FR_CHARTS) {
      const { svg, text: shownText, nodeCount } = await renderMermaidForTest(c.chart)
      expect(shownText, c.name).not.toMatch(/Unsupported markdown/)
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeGreaterThan(0)
      expect(nodeCount, `${c.name} 畫出來的節點數`).toBeLessThanOrEqual(14)
      const host = document.createElement('div')
      host.innerHTML = svg
      const shown = new Set(Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel')).map((e) => plain(e.textContent ?? '')))
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      for (const v of g.vertices) expect(shown.has(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text) expect(shown.has(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
    }
  }, 120000)
})

describe('圖和本頁公式、數字一致', () => {
  it('單位鏈：K = K_q·C → g = μK（sum mode 多乘 N）→ p = 1 − g → f_3dB、ENBW 都靠 f_u = f_s/N；數字與 refValues 一致', async () => {
    const g = await flow(CHART_UNIT_CHAIN)
    // 箭頭方向：σ_v → K_q → K ← C；K、μ → g → p → 兩種頻寬；f_u → 兩種頻寬
    for (const [a, b] of [['SV', 'KQ'], ['KQ', 'K'], ['CC', 'K'], ['K', 'G'], ['MU', 'G'], ['G', 'P'], ['P', 'F3'], ['P', 'EN'], ['FU', 'F3'], ['FU', 'EN']]) edge(g, a, b)
    expect(g.edges.some((e) => e.start === 'G' && e.end === 'K')).toBe(false) // 不能反向
    // 公式與單位
    expect(text(g, 'KQ')).toContain('K_q = √(2/π)/σ_v')
    expect(text(g, 'KQ')).toContain('[fs⁻¹]')
    expect(text(g, 'SV')).toContain('[fs]')
    expect(text(g, 'K')).toContain('K = K_q·C')
    expect(text(g, 'MU')).toContain('[fs]')
    expect(text(g, 'G')).toContain('g = μ·K')
    expect(text(g, 'G')).toContain('[1]')
    expect(text(g, 'P')).toContain('p = 1 − g')
    expect(text(g, 'FU')).toContain('f_u = f_s/N')
    expect(text(g, 'F3')).toContain('f_3dB = (f_u/π)·arcsin((1−p)/(2√p))')
    expect(text(g, 'F3')).toContain('p ≥ 3 − 2√2')
    expect(text(g, 'EN')).toContain('ENBW = (f_u/2)·(1−p)/(1+p)')
    // sum mode 的 N 是虛線，接到 g（不是 p）
    expect(edge(g, 'NN', 'G').text).toBe('g = μ·K·N')
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
    expect(CHART_RATE_DOMAINS).toMatch(/subgraph FS\["sample rate：索引 n，速率 f_s"\]/)
    expect(CHART_RATE_DOMAINS).toMatch(/subgraph FU\["block rate：索引 k，速率 f_u = f_s\/N"\]/)
    for (const id of ['X', 'U', 'E', 'Q', 'P']) expect(inSub('FS'), id).toMatch(new RegExp(`\\b${id}\\[`))
    for (const id of ['G', 'W', 'D']) expect(inSub('FU'), id).toMatch(new RegExp(`\\b${id}\\[`))
    expect(inSub('FS')).not.toMatch(/\bZ\[/)
    expect(inSub('FU')).not.toMatch(/\bZ\[/)
    // 公式：e[n] = δ_k·u[n] + v[n]、q[n] = sign(e[n])、G_k = (1/N)Σ q[n]x[n]、w_(k+1) = w_k + μG_k、δ_k = a − w_k、w[n] = w_⌊n/N⌋
    expect(text(g, 'E')).toBe('e[n] = δ_k·u[n] + v[n]')
    expect(text(g, 'Q')).toBe('q[n] = sign(e[n])')
    expect(text(g, 'G')).toContain('G_k = (1/N)·Σ q[n]·x[n]')
    expect(text(g, 'W')).toBe('w_(k+1) = w_k + μ·G_k')
    expect(text(g, 'D')).toBe('δ_k = a − w_k')
    expect(text(g, 'Z')).toContain('w[n] = w_⌊n/N⌋')
    // 箭頭方向：u → e → q → q·x → G → w → δ；δ 以虛線回到 e（block 內保持不變）；w → ZOH
    for (const [a, b] of [['U', 'E'], ['E', 'Q'], ['Q', 'P'], ['X', 'P'], ['P', 'G'], ['G', 'W'], ['W', 'D'], ['D', 'E'], ['W', 'Z']]) edge(g, a, b)
    expect(edge(g, 'D', 'E').stroke).toBe('dotted')
    expect(edge(g, 'P', 'G').text).toBe('累加 N 筆')
    expect(edge(g, 'W', 'Z').text).toBe('w_k')
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
