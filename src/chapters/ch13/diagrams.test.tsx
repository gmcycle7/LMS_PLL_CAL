import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import katex from 'katex'
import mermaid from 'mermaid'
import { SettingsProvider } from '@/app/settings'
import { SYSTEM_BLOCK_LABEL, defaultValues, stripMathDelimiters, systemMapChart } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { firstOrderPeriod, quantizeFcw, runDsm } from '@/simulation/models/dsm'
import {
  DSM_BITS,
  bernoulliMoments,
  ditherVariance,
  efbConstant,
  efbInbandWhite,
  efbPeriod,
  efbResidualVar,
  efbWhitePower,
  gcd,
  lcm,
  lineSpectrum,
  makeCtx,
  makeGrid,
  mixWithResidue,
  mod,
  quantize,
  runQuantLab,
  simulateStrategy,
  stochasticQuantVarApprox,
  toggleCycle,
} from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, LSB_FS_EXAMPLE } from './common'
import * as D from './diagrams'
import { DIAGRAMS, SYSTEM_MAP_FOCUS } from './diagrams'
import { HANDCALCS } from './handcalcs'
import { Intro } from './sections/Intro'

const DIR = join(process.cwd(), 'src/chapters/ch13')
const read = (rel: string) => readFileSync(join(DIR, rel), 'utf8')
const byName = (name: string) => DIAGRAMS.find((d) => d.name === name)!.chart

/** 數字在圖上的寫法：公式在 `$...$` 裡，負號就是 TeX 的 ASCII `-`。 */
const t = (x: number, digits: number) => x.toFixed(digits)

/** 一張圖裡所有用雙引號包住的標籤（節點文字與連線文字）。 */
const quoted = (chart: string) => [...chart.matchAll(/"([^"]*)"/g)].map((m) => m[1])

/** 標籤裡的公式（`$...$` 的內容）。 */
const mathOf = (label: string) => [...label.matchAll(/\$([^$]+)\$/g)].map((m) => m[1])

/** 標籤裡公式以外的文字（逐行、逐段）：畫出來的文字裡必須原樣出現。 */
const plainSegments = (label: string) =>
  label
    .split(/<br\s*\/?>/i)
    .flatMap((line) => line.split(/\$[^$]*\$/))
    .map((s) => s.trim())
    .filter(Boolean)

// jsdom 沒有 SVG 排版：共用的 shim 讓 mermaid.render() 能真的跑完（本檔所有 describe 都用得到，包含 <Intro /> 裡的 <SystemMap>）
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
}

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊。 */
async function flow(chart: string): Promise<{ vertices: Map<string, Vertex>; edges: Edge[] }> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: db.getVertices(), edges: db.getEdges() }
}

describe('Ch13 方塊圖：真正的 mermaid parser 與 render', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
  })

  it('清單與匯出一致：27 張 Mermaid 圖（25 張新增 + 2 張原有），名稱不重複，而且每個 CHART_ 匯出都在清單裡', () => {
    expect(DIAGRAMS).toHaveLength(27)
    expect(DIAGRAMS.filter((d) => d.added)).toHaveLength(25)
    expect(DIAGRAMS.filter((d) => !d.added).map((d) => d.name)).toEqual(['CHART_SIGNAL_FLOW', 'CHART_HARDWARE_MAP'])
    expect(new Set(DIAGRAMS.map((d) => d.name)).size).toBe(DIAGRAMS.length)
    const exported = Object.entries(D).filter(([k, v]) => k.startsWith('CHART_') && typeof v === 'string')
    expect(exported.map(([k]) => k).sort()).toEqual(DIAGRAMS.map((d) => d.name).sort())
    for (const [k, v] of exported) expect(byName(k), k).toBe(v)
    // 狀態圖一張（limit cycle），其餘是 flowchart
    expect(DIAGRAMS.filter((d) => d.kind === 'state').map((d) => d.name)).toEqual(['CHART_LIMIT_CYCLE'])
  })

  it.each(DIAGRAMS.map((d) => [d.name, d] as const))('%s 可以被 mermaid 解析，且不超過 14 個節點', async (_name, d) => {
    const r = await mermaid.parse(d.chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe(d.kind === 'state' ? 'stateDiagram' : 'flowchart-v2')
    // 節點數：flowchart 由 parser 的結果數（subgraph 不算節點）；狀態圖數 state 宣告
    const nodes = d.kind === 'state' ? (d.chart.match(/^\s*state "/gm) ?? []).length : (await flow(d.chart)).vertices.size
    expect(nodes, `${d.name} 的節點數`).toBeGreaterThanOrEqual(5)
    expect(nodes, `${d.name} 的節點數`).toBeLessThanOrEqual(14)
  })

  it.each(DIAGRAMS.map((d) => [d.name, d] as const))(
    '%s 真的 render 一次（與網站相同的前處理）：沒有 Unsupported markdown、畫出來的文字沒有殘留 `$`、KaTeX 以外沒有 Unicode 拼的數學、節點數不超過 14',
    async (name, d) => {
      const { svg, text: rawText, nodeCount, mathCount, plainText } = await renderMermaidForTest(d.chart)
      // KaTeX 的 \text{…} 會把空白換成不換行空白（U+00A0）
      const text = rawText.replace(/\u00a0/g, ' ')
      expect(svg).toContain('<svg')
      expect(text).not.toMatch(/Unsupported markdown/)
      // 公式都由 KaTeX 排版（TeX 寫錯時 render 會直接丟例外）：畫出來的文字裡不可殘留 `$` 分隔符號
      expect(text, `${name}: 畫出來的文字殘留 $`).not.toContain('$')
      expect(mathCount, `${name}: KaTeX 排版的標籤數`).toBeGreaterThanOrEqual(1)
      // KaTeX 以外的文字（把 .katex 拿掉再看）不可再有 Greek、上下標、運算符號或 w_k 這類 Unicode／底線拼的數學
      expect(unicodeMathIn(plainText), `${name}: KaTeX 以外還有 Unicode 拼的數學`).toEqual([])
      expect(nodeCount, `${name} 畫出來的節點數`).toBeLessThanOrEqual(14)
      expect(nodeCount, `${name} 畫出來的節點數`).toBeGreaterThan(0)
      // 每個用雙引號包住的標籤都出現在畫出來的文字裡：沒有公式的標籤取第一行比對；含公式的標籤，公式以外的每一段文字都要出現
      // （含 < > & 的略過，HTML 會轉義）
      for (const label of quoted(d.chart)) {
        const segs = label.includes('$') ? plainSegments(label) : [label.split('<br/>')[0].trim()]
        for (const seg of segs) {
          if (!seg || /[<>&]/.test(seg)) continue
          expect(text, `${name}: 「${seg}」`).toContain(seg)
        }
      }
    },
  )

  it('標籤的寫法：不以半形 + - * 或「1.」開頭（Mermaid 11 會當成 Markdown 清單），加法點用全形＋、負號用 U+2212', () => {
    for (const d of DIAGRAMS) {
      for (const label of quoted(d.chart)) {
        for (const line of label.split('<br/>')) {
          expect(line, `${d.name}: 「${label}」`).not.toMatch(/^\s*(?:[-+*]|\d+[.)])(?:\s|$)/)
          expect(line, `${d.name}: 「${label}」`).not.toMatch(/^\s*[#>]/)
        }
        expect(label, d.name).not.toMatch(/\]\(|~~|`/)
      }
      // 加法點一律是 (("＋"))，乘法點是 (("$\times$"))（乘號是 KaTeX 的 \times，不是 Unicode 的 ×）
      for (const m of d.chart.matchAll(/\(\("([^"]*)"\)\)/g)) expect(['＋', String.raw`$\times$`], `${d.name}: ((${m[1]}))`).toContain(m[1])
      expect(d.chart, d.name).not.toMatch(/\(\(\s*\+\s*\)\)|"\+"/)
    }
  })

  it('公式的寫法：`$` 成對；公式裡只有 ASCII 的 TeX（不放 Unicode 符號）；含公式的標籤，公式以外的文字不放 U+2212 或「→」（KaTeX 的 \\text 不認得，改寫成 `$-$`、`$\\to$`）', () => {
    let total = 0
    for (const d of DIAGRAMS) {
      for (const label of quoted(d.chart)) {
        if (!label.includes('$')) continue
        expect(label.split('$').length % 2, `${d.name}: $ 要成對 —— ${label}`).toBe(1)
        for (const tex of mathOf(label)) {
          expect(tex, `${d.name}: 公式只用 ASCII 的 TeX —— $${tex}$`).toMatch(/^[\x20-\x7e]+$/)
          expect(() => katex.renderToString(tex, { throwOnError: true }), `${d.name}: $${tex}$`).not.toThrow()
          total++
        }
        const prose = plainSegments(label).join(' ')
        expect(prose, `${d.name}: 公式以外的文字不放 U+2212／→ —— ${label}`).not.toMatch(/[\u2212\u2192]/)
      }
    }
    expect(total).toBeGreaterThan(200)
    // 狀態圖的轉移文字沒有雙引號（前處理不會轉換），所以直接寫單一段 `$$...$$`
    for (const m of D.CHART_LIMIT_CYCLE.matchAll(/ : (.*)$/gm)) {
      expect(m[1], m[0]).toMatch(/^\$\$[^$]+\$\$$/)
      expect(() => katex.renderToString(m[1].slice(2, -2), { throwOnError: true }), m[0]).not.toThrow()
    }
  })

  it('每張圖都接在頁面上恰好一次；章內沒有寫在別處的 Mermaid 原始碼', () => {
    const files = ['index.tsx', ...readdirSync(join(DIR, 'sections')).map((f) => `sections/${f}`)].filter((f) => f.endsWith('.tsx'))
    const src = Object.fromEntries(files.map((f) => [f, read(f)]))
    for (const d of DIAGRAMS) {
      const uses = files.flatMap((f) => [...src[f].matchAll(new RegExp(`chart=\\{${d.name}\\}`, 'g'))].map(() => f))
      expect(uses, d.name).toEqual([d.file])
    }
    const all = Object.values(src).join('\n')
    expect(all.match(/<Mermaid\b/g) ?? []).toHaveLength(DIAGRAMS.length)
    expect(all).not.toMatch(/flowchart (LR|TB|TD)|stateDiagram|sequenceDiagram/)
    // 每張圖都有圖說
    expect(all.match(/<Mermaid\s+chart=\{CHART_[A-Z_]+\}\s+caption=/g) ?? []).toHaveLength(DIAGRAMS.length)
    // 每張圖後面都有「圖 ↔ 公式」的對照段落（ch13-figwalk）；硬體路徑圖（章末）以緊接的一段說明代替
    expect(all.match(/className="small ch13-figwalk"/g) ?? []).toHaveLength(DIAGRAMS.length - 1)
  })

  it('圖說只用 $...$ 寫數學（Mermaid 圖說會用 KaTeX 渲染）：不含 Unicode 拼湊的下標 / 上標 / 希臘字母，而且每段 LaTeX 都能被 KaTeX 解析', () => {
    const files = ['index.tsx', ...readdirSync(join(DIR, 'sections')).map((f) => `sections/${f}`)].filter((f) => f.endsWith('.tsx'))
    const caps: { chart: string; caption: string }[] = []
    for (const f of files)
      for (const m of read(f).matchAll(/<Mermaid\s+chart=\{(CHART_[A-Z_]+)\}\s+caption=(?:"([^"]*)"|\{String\.raw`([^`]*)`\})/g)) caps.push({ chart: m[1], caption: m[2] ?? m[3] })
    expect(caps.map((c) => c.chart).sort()).toEqual(DIAGRAMS.map((d) => d.name).sort())
    let withMath = 0
    for (const { chart, caption } of caps) {
      const parts = caption.split('$')
      expect(parts.length % 2, `${chart}: $ 要成對`).toBe(1)
      const prose = parts.filter((_, i) => i % 2 === 0).join(' ').replace(/ΔΣ/g, '')
      expect(prose, `${chart}: 圖說裡的數學要寫成 $...$`).not.toMatch(/[A-Za-z]_[A-Za-z0-9{]|[α-ωΑ-Ω]|[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]|\^|\\|\bw\*/)
      for (const tex of parts.filter((_, i) => i % 2 === 1)) {
        expect(() => katex.renderToString(tex, { throwOnError: true }), `${chart}: $${tex}$`).not.toThrow()
        withMath++
      }
    }
    expect(withMath).toBeGreaterThan(40)
  })
})

/** 加法點的每一條輸入：[來源節點, 正負號（null = 不是相加項，而是某個分支的取值）, 標籤裡應有的訊號名稱]。 */
type Term = [from: string, sign: '＋' | '−' | null, signal?: string]

/**
 * 逐式核對：每個加法點 (("＋")) 的輸入、正負號與正文公式一對一。
 * 標籤裡的訊號名稱用原始碼裡的 TeX 比對（例如 `r[n-1]`、`\\delta w[n]`）；正負號是標籤開頭的「＋」／「−」，
 * 標籤裡還有公式時負號寫成 `$-$`（見 signOf）。
 *   F-13.1  e = δw = y − w*，δ = a − w = w* − y（ERROR_PATH 兩個加法點）
 *   F-13.2  e = y − w*（FREEZE、MIXING_PATH）
 *   F-13.3  y = ⌊w*⌋ + s[n]（TOGGLE）；F-13.6  y = ⌊w*⌋ + X（STOCHASTIC）
 *   F-13.4  Σ P_k = Parseval（TOGGLE_SPECTRUM）
 *   F-13.7  v = w_H + r[n−1]、r = v − y、Y = W_H − (1 − z⁻¹)R（EFB_LOOP、NTF_PATHS、ANTIWINDUP）
 *   F-13.10 u = v + d，r = v − y 不含 d（DITHER_LOOP）
 *   F-13.12 r[n] = r[n−1] + (w_H − y)（TELESCOPING 的相減點 w_H − y）
 *   §13.5a  w_H = w* + δw、ε = y − w_H、e = ε + δw（TIME_VARYING）
 */
const SUM_JUNCTIONS: Record<string, Record<string, Term[]>> = {
  CHART_ERROR_PATH: {
    S1: [['Y', '＋'], ['WS', '−']],
    S2: [['WS', '＋'], ['Y', '−']],
  },
  CHART_FREEZE: { S: [['Y', '＋'], ['WS', '−']] },
  CHART_TOGGLE: { ADD: [['SP', '＋', String.raw`\lfloor w_H \rfloor = 32`], ['PAT', '＋', 's[n]']] },
  CHART_TOGGLE_SPECTRUM: { SUM: [['P1', '＋'], ['P2', '＋']] },
  CHART_STOCHASTIC: { ADD: [['CMP', null, 'X = 1'], ['CMP', null, 'X = 0'], ['SP', '＋', String.raw`\lfloor w_H \rfloor = 32`]] },
  CHART_EFB_LOOP: {
    A1: [['WH', '＋'], ['Z', '＋', 'r[n-1]']],
    A2: [['A1', '＋', 'v[n]'], ['Q', '−', 'y[n]']],
  },
  CHART_NTF_PATHS: { S: [['WH', '＋'], ['NTF', '−']] },
  CHART_TELESCOPING: { D0: [['WH', '＋'], ['Y', '−']] },
  CHART_DITHER_LOOP: {
    A1: [['WH', '＋'], ['Z', '＋', 'r[n-1]']],
    A3: [['A1', '＋', 'v[n]'], ['DI', '＋']],
    A2: [['A1', '＋', 'v[n]'], ['Q', '−', 'y[n]']],
  },
  CHART_TIME_VARYING: {
    S1: [['AR', '＋', String.raw`\delta w[n]`], ['WS', '＋']],
    S2: [['QS', '＋', 'y[n]'], ['S1', '−', 'w_H[n]']],
    S3: [['S2', '＋', String.raw`\epsilon[n]`], ['AR', '＋', String.raw`\delta w[n]`]],
  },
  CHART_MIXING_PATH: { S: [['Y', '＋'], ['WS', '−']] },
  CHART_ANTIWINDUP: {
    A1: [['WH', '＋'], ['Z', '＋', 'r[n-1]']],
    A2: [['A1', '＋', 'v[n]'], ['Q', '−', 'y[n]']],
  },
}

/** 乘法點 (("×")) 的兩個輸入：gain 誤差 × DSM residue（§12.2：乘號不是加號）。 */
const MUL_JUNCTIONS: Record<string, Record<string, string[]>> = {
  CHART_ERROR_PATH: { M: ['K', 'X'] },
  CHART_MIXING_PATH: { M: ['ZOH', 'X'] },
  CHART_TONE_MIXING: { M: ['E', 'X'] },
}

const junctionIds = (vertices: Map<string, Vertex>, symbol: string) => [...vertices.values()].filter((v) => v.text === symbol).map((v) => v.id)

/** 乘法點的標籤：KaTeX 的 \times。 */
const TIMES = String.raw`$\times$`

/** 連到加法點的線，它的正負號：標籤開頭是「＋」或 `$+$`（正）、「−」或 `$-$`（負）；否則不是相加項。 */
const signOf = (label: string): '＋' | '−' | null => (/^(?:＋|\$\+\$)/.test(label) ? '＋' : /^(?:−|\$-\$)/.test(label) ? '−' : null)

describe('Ch13 方塊圖與公式一致：加法點 / 乘法點 / 延遲', () => {
  it.each(DIAGRAMS.filter((d) => d.kind === 'flowchart').map((d) => [d.name, d] as const))('%s：每個加法點的輸入與正負號 = 公式，每個乘法點恰有兩個輸入', async (name, d) => {
    const { vertices, edges } = await flow(d.chart)
    const expected = SUM_JUNCTIONS[name] ?? {}
    // 沒有登錄的加法點不能存在（新增加法點時必須同時寫下它對應的公式）
    expect(junctionIds(vertices, '＋').sort(), `${name} 的加法點`).toEqual(Object.keys(expected).sort())
    for (const [id, terms] of Object.entries(expected)) {
      const got = edges
        .filter((e) => e.end === id)
        .map((e) => {
          const label = e.text ?? ''
          return { from: e.start, sign: signOf(label), label }
        })
      expect(got, `${name}.${id} 的輸入數`).toHaveLength(terms.length)
      const rest = [...got]
      for (const [from, sign, signal] of terms) {
        const i = rest.findIndex((g) => g.from === from && g.sign === sign && (signal === undefined || g.label.includes(signal)))
        expect(i, `${name}.${id}：缺少 ${from} 以 ${sign ?? '（無正負號）'}${signal ? `、${signal}` : ''} 進入`).toBeGreaterThanOrEqual(0)
        rest.splice(i, 1)
      }
      expect(rest, `${name}.${id}：多出來的輸入`).toEqual([])
      expect(edges.filter((e) => e.start === id).length, `${name}.${id} 的輸出數`).toBeGreaterThanOrEqual(1)
    }
    const mul = MUL_JUNCTIONS[name] ?? {}
    expect(junctionIds(vertices, TIMES).sort(), `${name} 的乘法點`).toEqual(Object.keys(mul).sort())
    for (const [id, from] of Object.entries(mul)) {
      expect(edges.filter((e) => e.end === id).map((e) => e.start).sort(), `${name}.${id} 的輸入`).toEqual([...from].sort())
    }
  })

  it('ΔΣ 類迴圈（EFB、dither、anti-windup）：z⁻¹ 暫存器收 r、把 r[n−1] 以正號送回輸入加法點 A1，而且是唯一的回授路徑', async () => {
    for (const name of ['CHART_EFB_LOOP', 'CHART_DITHER_LOOP', 'CHART_ANTIWINDUP']) {
      const { edges } = await flow(byName(name))
      const into = edges.filter((e) => e.end === 'Z')
      const out = edges.filter((e) => e.start === 'Z')
      expect(into, name).toHaveLength(1)
      // 相減點的輸出 r = v − y 直接進暫存器（anti-windup 圖是先經過夾住的方塊 CL，下面另外核對）
      expect(into[0].start, name).toBe(name === 'CHART_ANTIWINDUP' ? 'CL' : 'A2')
      if (name !== 'CHART_ANTIWINDUP') expect(into[0].text, name).toBe('$r[n] = v[n] - y[n]$')
      expect(out, name).toHaveLength(1)
      expect([out[0].end, out[0].text], name).toEqual(['A1', '＋ $r[n-1]$'])
      // 除了 Z → A1 之外，沒有任何邊回到 A1（沒有第二條回授）
      expect(edges.filter((e) => e.end === 'A1').map((e) => e.start).sort(), name).toEqual(['WH', 'Z'])
    }
    // anti-windup 圖：相減點的輸出 r = v − y 先進 clamp，再進暫存器
    const aw = await flow(D.CHART_ANTIWINDUP)
    const toClamp = aw.edges.filter((e) => e.end === 'CL')
    expect(toClamp.map((e) => e.start)).toEqual(['A2'])
    expect(toClamp[0].text).toContain('r = v - y')
  })

  it('量化器只收一個輸入（v 或 u），而且在 y 與相減點之間分叉：y 同時送到輸出與相減點（負號）', async () => {
    const cases: [string, string][] = [
      ['CHART_EFB_LOOP', 'A1'],
      ['CHART_DITHER_LOOP', 'A3'],
      ['CHART_ANTIWINDUP', 'A1'],
    ]
    for (const [name, src] of cases) {
      const { edges } = await flow(byName(name))
      expect(edges.filter((e) => e.end === 'Q').map((e) => e.start), name).toEqual([src])
      expect(edges.filter((e) => e.start === 'Q').map((e) => e.end).sort(), name).toEqual(['A2', 'OUT'])
    }
  })
})

describe('Ch13 章首的系統地圖', () => {
  it('focus = Gain accumulator、Quantizer、Gain correction；Mermaid 原始碼可解析', async () => {
    expect(SYSTEM_MAP_FOCUS).toEqual(['acc', 'qnt', 'gc'])
    const chart = systemMapChart(SYSTEM_MAP_FOCUS)
    expect(chart).toContain('class ACC,QNT,GC focus')
    const r = await mermaid.parse(chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })

  it('系統地圖也真的 render 一次：公式都由 KaTeX 排版，沒有殘留的 `$`、Unsupported markdown 或 Unicode 拼的數學', async () => {
    const r = await renderMermaidForTest(systemMapChart(SYSTEM_MAP_FOCUS))
    expect(r.text).not.toMatch(/Unsupported markdown/)
    expect(r.text).not.toContain('$')
    expect(r.mathCount).toBeGreaterThanOrEqual(8)
    expect(unicodeMathIn(r.plainText)).toEqual([])
  })

  it('頁面開頭真的 render <SystemMap>：在「這次我們要回答的問題」之後、第一張本章方塊圖之前', () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    const { container, unmount } = render(
      <MemoryRouter>
        <SettingsProvider>
          <Intro />
        </SettingsProvider>
      </MemoryRouter>,
    )
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid'))
    // Intro：系統地圖 + 訊號流 + 誤差路徑
    expect(figs).toHaveLength(1 + DIAGRAMS.filter((d) => d.file === 'sections/Intro.tsx').length)
    const map = figs[0]
    expect(map.getAttribute('aria-label')).toContain('系統方塊圖')
    // aria-label 是純文字：方塊名稱裡的 `$...$` 只留 TeX 原始碼、拿掉分隔符號
    for (const b of SYSTEM_MAP_FOCUS) expect(map.getAttribute('aria-label')).toContain(stripMathDelimiters(SYSTEM_BLOCK_LABEL[b]))
    const question = container.querySelector('#ch13-question') as HTMLElement
    expect(question.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(map.compareDocumentPosition(figs[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 章首只留一行連到章末符號表的按鈕（不是會改掉 HashRouter 路由的 href）
    const link = container.querySelector('[data-testid="ch13-symbols-link"]') as HTMLButtonElement
    expect(link.tagName).toBe('BUTTON')
    expect(link.textContent).toContain('本章符號表在最後')
    expect(container.querySelector('.c-symbols')).toBeNull()
    unmount()
    localStorage.clear()
  })
})

describe('Ch13 方塊圖上的數字與模型一致（quantizer.ts）', () => {
  it('ΔΣ 迴圈圖的三條方程式 = efbConstant()；limit cycle 狀態圖的 v、y、r 逐格相同', () => {
    const o = efbConstant({ target: 32.4, steps: 20 })
    // 照圖上的方程式自己跑一次：v = w_H + r[n−1]、y = ⌊v + ½⌋、r = v − y（用 1/10 LSB 的整數避免浮點 tie）
    let r10 = 0
    for (let n = 0; n < 20; n++) {
      const v10 = 324 + r10
      const y = Math.floor((v10 + 5) / 10)
      r10 = v10 - 10 * y
      expect(y, `y[${n}]`).toBe(o.y[n])
      expect(r10 / 10, `r[${n}]`).toBeCloseTo(o.r[n], 12)
      expect(v10 / 10, `v[${n}]`).toBeCloseTo(o.v[n], 12)
    }
    for (const eq of ['v[n] = w_H[n] + r[n-1]', 'r[n] = v[n] - y[n]', String.raw`\lfloor v + \tfrac12 \rfloor`]) expect(D.CHART_EFB_LOOP).toContain(eq)
    // 極性：v 以正號、y 以負號進相減點；r[n−1] 以正號回到輸入加法點
    expect(D.CHART_EFB_LOOP).toContain('A1 -- "＋ $v[n]$" --> A2')
    expect(D.CHART_EFB_LOOP).toContain('Q -- "$-$ $y[n]$" --> A2')
    expect(D.CHART_EFB_LOOP).toContain('Z -- "＋ $r[n-1]$" --> A1')
    // 狀態圖：R0 → R1 → … → R4 → R0
    expect(o.y.slice(0, 5)).toEqual([32, 33, 32, 33, 32])
    const states = ['R0', 'R1', 'R2', 'R3', 'R4']
    for (let n = 0; n < 5; n++) {
      const from = states[n]
      const to = states[(n + 1) % 5]
      expect(D.CHART_LIMIT_CYCLE).toContain(String.raw`${from} --> ${to} : $$v = ${t(o.v[n], 1)} \to y = ${o.y[n]}$$`)
      const rTxt = Math.abs(o.r[n]) < 1e-12 ? '0' : t(o.r[n], 1)
      expect(D.CHART_LIMIT_CYCLE).toContain(`state "$r = ${rTxt}$" as ${to}`)
    }
  })

  it('dither 迴圈圖：r 以未加 dither 的 v 為基準（r = v − y，不是 u − y）', () => {
    expect(D.CHART_DITHER_LOOP).toContain('A3 -- "$u[n] = v[n] + d[n]$" --> Q')
    expect(D.CHART_DITHER_LOOP).toContain('A1 -- "＋ $v[n]$，不含 $d$" --> A2')
    expect(D.CHART_DITHER_LOOP).toContain('Q -- "$-$ $y[n]$" --> A2')
    expect(D.CHART_DITHER_LOOP).not.toMatch(/A3 --[^\n]*--> A2/)
  })

  it('誤差路徑圖：e = δw = y − w*（y 為正、w* 為負），δ = a − w 反號；Δ_LSB 示例值與 common.tsx 相同', () => {
    expect(D.CHART_ERROR_PATH).toContain('Y["$y[n]$<br/>6-bit code（LSB）"] -- "＋" --> S1')
    expect(D.CHART_ERROR_PATH).toMatch(/WS\[[^\n]*\] -- "−" --> S1/)
    expect(D.CHART_ERROR_PATH).toContain('WS -- "＋" --> S2')
    expect(D.CHART_ERROR_PATH).toContain('Y -- "−" --> S2')
    expect(D.CHART_ERROR_PATH).toContain(String.raw`$e = \delta w = y - w^*$`)
    expect(D.CHART_ERROR_PATH).toContain(String.raw`$\delta = a - w = w^* - y = -\delta w$`)
    expect(D.CHART_ERROR_PATH).toContain(`示例 ${LSB_FS_EXAMPLE}`)
  })

  it('Freeze 圖：Q(32.4) = 32、e = −0.4、平方平均 0.16', () => {
    const grid = makeGrid(32.4, 'rational', 0)
    const y = quantize(grid.W0, { n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 }, makeCtx(DEFAULT_LAB_PARAMS, grid, 'freeze', 1))
    expect(D.CHART_FREEZE).toContain(`y[n] = ${y}`)
    expect(D.CHART_FREEZE).toContain(`e[n] = y - w^* = ${t(y - 32.4, 1)}$ LSB`)
    expect(D.CHART_FREEZE).toContain(String.raw`平方平均 $${t((y - 32.4) ** 2, 2)}\,\mathrm{LSB}^2$`)
  })

  it('Toggle 圖與譜線圖：pattern、|c_k|、線功率與 Parseval 總和', () => {
    const cyc = toggleCycle(32.4, 5, 'spread')
    expect(D.CHART_TOGGLE).toContain(`y[n] = ${cyc.join(', ')}`)
    expect(D.CHART_TOGGLE).toContain(`s[n] = ${cyc.map((y) => y - 32).join(', ')}`)
    const e = cyc.map((y) => y - 32.4)
    expect(D.CHART_TOGGLE_SPECTRUM).toContain(e.map((x) => t(x, 1)).join(', '))
    const ls = lineSpectrum(e)
    expect(ls[0].mag).toBeCloseTo(0, 12)
    expect(D.CHART_TOGGLE_SPECTRUM).toContain(`= ${ls[1].mag.toFixed(4)}`)
    expect(D.CHART_TOGGLE_SPECTRUM).toContain(`= ${ls[2].mag.toFixed(4)}`)
    expect(D.CHART_TOGGLE_SPECTRUM).toContain(String.raw`P_1 = 2|c_1|^2 = ${ls[1].power.toFixed(5)}\,\mathrm{LSB}^2`)
    expect(D.CHART_TOGGLE_SPECTRUM).toContain(String.raw`P_2 = 2|c_2|^2 = ${ls[2].power.toFixed(5)}\,\mathrm{LSB}^2`)
    expect(ls[1].power + ls[2].power).toBeCloseTo(0.24, 12)
    expect(ls[2].power).toBeGreaterThan(ls[1].power) // 主 spur 在 2f_u/5（勘誤 E47）
    // 功率分布圖用同一組數字
    for (const s of [ls[1].power.toFixed(5), ls[2].power.toFixed(5), String.raw`0.24\,\mathrm{LSB}^2`, String.raw`0.16\,\mathrm{LSB}^2`]) expect(D.CHART_POWER_SPLIT).toContain(s)
  })

  it('Stochastic 圖：E[y] = 32.4、Var = p(1 − p) = 0.24', () => {
    const m = bernoulliMoments(32, 0.4)
    expect(D.CHART_STOCHASTIC).toContain(`E[y] = ${m.mean.toFixed(1)}`)
    expect(D.CHART_STOCHASTIC).toContain(String.raw`\mathrm{Var}(y) = p(1 - p) = ${m.variance.toFixed(2)}`)
  })

  it('週期流程圖：32.4 = 162/5 → 5；F = 10 → K = 33178、410、gcd 2、週期 512', () => {
    const rat = makeGrid(32.4, 'rational', 0)
    expect(efbPeriod(rat.W0, rat.D)).toBe(5)
    const g = makeGrid(32.4, 'fixed', 10)
    const f = mod(g.W0, g.D)
    expect(D.CHART_PERIOD_FLOW).toContain(`K = ${g.W0}`)
    expect(D.CHART_PERIOD_FLOW).toContain(String.raw`K \bmod 2^F = ${f}`)
    expect(D.CHART_PERIOD_FLOW).toContain(String.raw`g = \gcd(${f}, ${g.D}) = ${gcd(f, g.D)}`)
    expect(D.CHART_PERIOD_FLOW).toContain(String.raw`週期 $= 2^F / g = ${efbPeriod(g.W0, g.D)}$`)
    expect(efbPeriod(g.W0, g.D)).toBe(512)
  })

  it('功率分布圖的 E：A = 1 LSB 時 code 用到 31–34、總功率 > 0.3、白色近似 1/3、沒有譜線', () => {
    expect(efbWhitePower(efbResidualVar(ditherVariance(1, 'uniform')))).toBeCloseTo(1 / 3, 12)
    const r = runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 1 << 14 }, cases: [{ id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 }], compareAll: false }).runs[0]
    expect([r.metrics.codeMin, r.metrics.codeMax]).toEqual([31, 34])
    expect(r.metrics.errPower).toBeGreaterThan(0.3)
    expect(r.metrics.errPower).toBeLessThan(0.36)
    expect(r.metrics.maxSpur).toBeNull()
    expect(D.CHART_POWER_SPLIT).toContain('用到 31 到 34')
  })

  it('頻帶內圖與綜合手算流程圖：數字來自 HC-13.8 的預設解與白色近似的閉式', () => {
    const fB = 1 / 64
    const pinD = efbInbandWhite(efbResidualVar(0), fB).lowFreq
    expect(pinD).toBeCloseTo(8.3666e-6, 9)
    const pinC = 2 * stochasticQuantVarApprox(0.4, 0.2) * fB
    expect(pinC).toBeCloseTo(6.25e-3, 12)
    expect(D.CHART_INBAND).toContain(String.raw`約 $6\times10^{-3}$ 對 $8\times10^{-6}\,\mathrm{LSB}^2$`)
    expect(D.CHART_SYNTHESIS_FLOW).toContain(String.raw`6.25\times10^{-3}\,\mathrm{LSB}^2`)
    expect(D.CHART_SYNTHESIS_FLOW).toContain(String.raw`8.37\times10^{-6}\,\mathrm{LSB}^2`)
    expect(((8 * Math.PI ** 2) / 3 / 12).toFixed(3)).toBe('2.193')
    const def = HANDCALCS.find((h) => h.id === 'HC-13.8')!
    const v = defaultValues(def)
    expect(v).toMatchObject({ w: 32.4, lsb: 0.125, xr: 1, sw: 0.2, R: 64 })
    const [dtA, dtSw, fsC, fsD] = def.solve(v).results.map((x) => x.value as number)
    expect(dtA).toBeCloseTo(0.05, 12)
    expect(D.CHART_SYNTHESIS_FLOW).toContain(String.raw`= 0.05\,\mathrm{fs}`)
    expect(D.CHART_SYNTHESIS_FLOW).toContain(String.raw`= ${dtSw.toFixed(4)}\,\mathrm{fs}`)
    expect(D.CHART_SYNTHESIS_FLOW).toContain(String.raw`= ${fsC.toFixed(5)}\,\mathrm{fs}`)
    expect((fsD * 1e4).toFixed(2)).toBe('3.62')
    expect(D.CHART_SYNTHESIS_FLOW).toContain(String.raw`= 3.62\times10^{-4}\,\mathrm{fs}`)
    expect(D.CHART_SYNTHESIS_FLOW).toContain(String.raw`= ${bernoulliMoments(32, 0.4).rms.toFixed(3)}\,\mathrm{LSB}`)
    // 兩種比法的排序相反：總 RMS 是 Freeze 小，頻帶內是 ΔΣ 小
    expect(dtA).toBeLessThan(dtSw)
    expect(fsD).toBeLessThan(fsC)
    expect(fsC).toBeLessThan(dtA)
  })

  it('混頻圖：預設參數下 2f_s/5 的 code tone 與 DSM residue 第 51 次諧波的差頻是 f_s/640 = 156.25 kHz，而且真的存在', () => {
    const p = DEFAULT_LAB_PARAMS
    expect([p.fs, p.pllBwHz, p.togglePeriod, p.dsmFrac, p.nUpd]).toEqual([100e6, 1e6, 5, 13 / 128, 1])
    const K = quantizeFcw(p.dsmFrac, DSM_BITS).K
    const pDsm = firstOrderPeriod(K, DSM_BITS)
    expect(pDsm).toBe(128)
    const pMix = lcm(p.togglePeriod, pDsm)
    expect(pMix).toBe(640)
    expect(2 / 5 - 51 / 128).toBeCloseTo(1 / 640, 15)
    expect(p.fs / pMix).toBe(156250)
    expect(p.fs / pMix).toBeLessThan(p.pllBwHz)
    expect(((51 * p.fs) / 128 / 1e6).toFixed(2)).toBe('39.84')
    for (const s of [String.raw`2f_s/5 = 40\,\mathrm{MHz}`, String.raw`51 \cdot f_s/128 = 39.84\,\mathrm{MHz}`, String.raw`f_s/640 = 156\,\mathrm{kHz}`, String.raw`79.84\,\mathrm{MHz}`, String.raw`20.16\,\mathrm{MHz}`, String.raw`f_{\mathrm{BW}} = 1\,\mathrm{MHz}`])
      expect(D.CHART_TONE_MIXING).toContain(s)
    // 用模型的 DSM residue 與 mixWithResidue 實際相乘：x 的第 51 次諧波不為 0，乘積在 f_s/640（k = 1）有譜線
    const x = runDsm({ kind: 'first_order', frac: p.dsmFrac, bits: DSM_BITS, length: pMix, normalization: 'standardize' }).code
    const lx = lineSpectrum(Array.from(x.subarray(0, pDsm)))
    expect(lx[51].power).toBeGreaterThan(1e-6)
    const e = toggleCycle(32.4, 5).map((y) => y - 32.4)
    const eLong = Array.from({ length: pMix }, (_, n) => e[n % 5])
    const dt = mixWithResidue(eLong, 1, x, 1)
    const ldt = lineSpectrum(Array.from(dt))
    expect(ldt[1].power).toBeGreaterThan(1e-6)
    // 路徑圖的方程式就是 mixWithResidue 的定義
    expect(D.CHART_MIXING_PATH).toContain(String.raw`e_s[n] = e[\lfloor n/N_{\mathrm{upd}} \rfloor]`)
    expect(D.CHART_MIXING_PATH).toContain(String.raw`\delta t[n] = \Delta_{\mathrm{LSB}} \cdot e_s[n] \cdot x[n]`)
    expect(mixWithResidue([2, -3], 2, [1, 10, 100, 1000], 0.5)).toEqual(Float64Array.from([1, 10, -150, -1500]))
  })

  it('紀錄長度檢查圖：frac = 13/128 → 640；frac = 0.1 → 5·2¹⁹ = 2621440', () => {
    const trap = firstOrderPeriod(quantizeFcw(0.1, DSM_BITS).K, DSM_BITS)
    expect(trap).toBe(2 ** 19)
    expect(lcm(5, trap)).toBe(2621440)
    expect(D.CHART_RECORD_CHECK).toContain(String.raw`P_{\mathrm{mix}} = 640`)
    expect(D.CHART_RECORD_CHECK).toContain(String.raw`P_{\mathrm{mix}} = 2621440`)
    expect(D.CHART_RECORD_CHECK).toContain(String.raw`2^{${DSM_BITS}} / \gcd(K,\, 2^{${DSM_BITS}})`)
  })

  it('saturate / wrap 圖與 anti-windup 圖：63.4 的 wrap 有 40% 輸出 0、平均 37.8；saturate 卡在 63、r 每次多 0.4（63.3 時 0.3）', () => {
    const go = (overflow: 'wrap' | 'saturate') =>
      runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, target: 63.4, overflow, length: 500, mixing: false }, cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }], compareAll: false }).runs[0].metrics
    const w = go('wrap')
    expect(w.overflow / 500).toBeCloseTo(0.4, 12)
    expect(w.meanCode).toBeCloseTo(0.6 * 63, 9)
    expect([w.codeMin, w.codeMax]).toEqual([0, 63])
    const s = go('saturate')
    expect([s.codeMin, s.codeMax]).toEqual([63, 63])
    const windup = (target: number, antiWindup: boolean) => {
      const grid = makeGrid(target, 'fixed', 16)
      const ctx = makeCtx({ ...DEFAULT_LAB_PARAMS, antiWindup }, grid, 'deltaSigma', 1)
      return simulateStrategy('deltaSigma', new Float64Array(200).fill(grid.W0), ctx, { freezeW: grid.W0, integer: true })
    }
    const r634 = windup(63.4, false).r
    expect(r634[150] - r634[149]).toBeCloseTo(0.4, 4)
    const r633 = windup(63.3, false).r
    expect(r633[150] - r633[149]).toBeCloseTo(0.3, 4)
    // anti-windup：r 被夾在 [−½, ½]
    expect(Math.max(...Array.from(windup(63.3, true).r, Math.abs))).toBeLessThanOrEqual(0.5)
    for (const s of [String.raw`y = 64 \bmod 64 = 0`, '40% 的更新輸出 0', String.raw`0.6 \times 63 = 37.8`, '每次多 0.4']) expect(D.CHART_SAT_WRAP).toContain(s)
    expect(D.CHART_ANTIWINDUP).toContain('每次多 0.3')
    expect(D.CHART_ANTIWINDUP).toContain('A2 -- "$r = v - y$，overload 時每次多 0.3" --> CL')
    expect(D.CHART_ANTIWINDUP).toContain('CL --> Z')
  })

  it('CDC 圖：31 → 32 的二進位差 6 個 bit，gray 碼只差 1 個 bit', () => {
    const bin = (x: number) => x.toString(2).padStart(6, '0')
    const gray = (x: number) => x ^ (x >> 1)
    const ham = (a: number, b: number) => bin(a ^ b).split('1').length - 1
    expect(ham(31, 32)).toBe(6)
    expect(ham(gray(31), gray(32))).toBe(1)
    expect(D.CHART_CDC).toContain(`二進位 ${bin(31)} → ${bin(32)}`)
    expect(D.CHART_CDC).toContain(`gray 碼 ${bin(gray(31))} → ${bin(gray(32))}`)
  })

  it('時變圖：e = ε + δw 的拆法與正負號', () => {
    expect(D.CHART_TIME_VARYING).toContain(String.raw`S1 -- "$w_H[n] = w^* + \delta w[n]$" --> QS`)
    expect(D.CHART_TIME_VARYING).toContain('QS -- "＋ $y[n]$" --> S2')
    expect(D.CHART_TIME_VARYING).toContain('S1 -- "$-$ $w_H[n]$" --> S2')
    expect(D.CHART_TIME_VARYING).toContain(String.raw`e[n] = y[n] - w^* = \epsilon[n] + \delta w[n]`)
    expect(D.CHART_TELESCOPING).toContain('r[n] = r[n-1] + (w_H[n] - y[n])')
    expect(D.CHART_TELESCOPING).toContain(String.raw`\sum (y - w_H) = r[-1] - r[N-1]`)
    // telescoping：Σ(y − w_H) = r[−1] − r[N−1]（用模型驗一次，r[−1] = 0.25）
    const o = efbConstant({ target: 32.4, steps: 37, rInit: 0.25 })
    const sum = o.y.reduce((a, y) => a + (y - 32.4), 0)
    expect(sum).toBeCloseTo(0.25 - o.r[36], 9)
  })
})
