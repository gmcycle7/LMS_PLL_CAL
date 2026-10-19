import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent } from '@testing-library/react'
import mermaid from 'mermaid'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { computeErrataEvidence, diffNumeric, toleranceBound } from '@/simulation/models/acceptance'
import verifyMjs from '../../../scripts/verify.mjs?raw'
import { computeAcceptanceState } from './common'
import * as D from './diagrams'
import { CHART_ERRATA_FLOW, CHART_PIPELINE, CHART_STATUS, CHART_TOLERANCE, VERIFICATION_CHARTS } from './diagrams'
import { ERRATA, erratumHref } from './errata'
import { extractJsFunctions } from './format'
import { GOLDEN_INDEX } from './golden'
import VerificationPage from './index'
import { settleLazy } from './indexTestUtils'
import { SYMBOLS } from './sections/Symbols'
import { renderPage } from '@/test/renderPage'
import { expectTexParses } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
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

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
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

function edgeText(g: Graph, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return decode(e.text ?? '')
}

const nodeText = (g: Graph, id: string): string => decode(g.vertices.find((v) => v.id === id)?.text ?? '')
const hasEdge = (g: Graph, start: string, end: string) => g.edges.some((e) => e.start === start && e.end === end)

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
const plain = (s: string) => decode(s.replace(/<br\s*\/?>/g, '')).replace(/\s+/g, '')

/** 與共用 Mermaid 前處理（mermaidSource.ts）相同的行內公式規則：`$...$` 或 `$$...$$`，`\$` 是字面的美元符號。 */
const MATH = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 圖原始碼裡所有雙引號標籤（節點、連線）。 */
const quotedLabels = (chart: string): string[] => Array.from(chart.matchAll(/"([^"\n]*)"/g), (m) => m[1])

const hasMath = (label: string): boolean => {
  MATH.lastIndex = 0
  const found = MATH.test(label)
  MATH.lastIndex = 0
  return found
}

/** 含 `$...$` 的標籤個數：共用 Mermaid 把每個這樣的標籤排版成一個 KaTeX 區塊，所以畫出來的 .katex 數必須剛好等於它。 */
const mathLabelCount = (chart: string): number => quotedLabels(chart).filter(hasMath).length

/** 標籤去掉 `$...$` 之後留下的文字片段（<br/> 與公式都當成分隔）。 */
const textPieces = (label: string): string[] =>
  label
    .replace(MATH, '\uE000')
    .split(/<br\s*\/?>|\uE000/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

/** 去掉所有空白（含不換行空白與零寬空白） */
const squash = (t: string) => t.replace(/[\s\u00a0\u200b]+/g, '')

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

describe('Verification 的 Mermaid 圖：清單', () => {
  it('共 4 張（容忍度判定、驗證管線、四種狀態、勘誤流程）；diagrams.ts 匯出的每一張都在清單裡，沒有漏掉沒測到的圖', () => {
    expect(VERIFICATION_CHARTS.map((c) => c.name)).toEqual(['CHART_TOLERANCE', 'CHART_PIPELINE', 'CHART_STATUS', 'CHART_ERRATA_FLOW'])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(VERIFICATION_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(VERIFICATION_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    expect(new Set(VERIFICATION_CHARTS.map((c) => c.chart)).size).toBe(VERIFICATION_CHARTS.length)
  })
})

describe('Verification 的 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    installMermaidSvgShim()
  })

  it('每一張都能解析成 flowchart；不超過 14 個節點；標籤沒有會被 Markdown／HTML 吃掉的寫法；加法點的每條輸入都標了正負號', async () => {
    for (const c of VERIFICATION_CHARTS) {
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
        // 正負號：純符號的邊寫全形「＋」「−」；標籤裡還有公式的邊把正負號放進數學（`$+\,...$`、`$-\,...$`）
        for (const e of incoming) expect(e.text ?? '', `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^([＋−]|\$[+-])/)
      }
    }
    // 只有容忍度判定圖有加法點：誤差的加法點（＋a_k、−e_k）與容許量的加法點（＋、＋）
    expect((await flow(CHART_TOLERANCE)).vertices.filter((v) => v.type === 'circle' && v.text === '＋')).toHaveLength(2)
  }, 60000)

  it('版面：桌機正文欄（約 900px）放得下、不用橫向捲動——四張圖都由上到下（TB／TD），長標籤用 <br/> 換行；沒有過長的單行（實際尺寸由 scripts/diagram-audit.mjs 量）', () => {
    for (const c of VERIFICATION_CHARTS) {
      expect(c.chart, c.name).toMatch(/^flowchart (TB|TD)\b/)
      expect(c.chart, c.name).not.toMatch(/subgraph/)
      // 每行（去掉 $...$ 後）的寬度估計：中文字算 1、其他字元算 0.55；超過 16 會把節點撐寬
      for (const label of quotedLabels(c.chart)) {
        for (const line of label.split(/<br\s*\/?>/)) {
          let units = 0
          for (const ch of line.replace(MATH, '')) units += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55
          expect(units, `${c.name}：「${line.trim()}」這一行太長`).toBeLessThanOrEqual(16)
        }
      }
    }
  })

  it('容忍度判定：極性與 F-VF.1 一致（Δ = a_k − e_k、b_k = ε_abs + ε_rel·|e_k|、通過 ⇔ |Δ| ≤ b_k）；照著圖算，結果就是 toleranceBound／diffNumeric，也就是頁面上每個 key 的判定', async () => {
    const g = await flow(CHART_TOLERANCE)
    // 誤差這條路：網站為正、golden 為負
    expect(edgeText(g, 'A', 'D')).toBe('＋')
    expect(edgeText(g, 'E', 'D')).toBe('−')
    // （標籤原始碼就是 LaTeX）
    expect(edgeText(g, 'D', 'ABS')).toBe(String.raw`$a_k - e_k$`)
    expect(nodeText(g, 'ABS')).toContain(String.raw`$|\Delta| = |a_k - e_k|$`)
    expect(hasEdge(g, 'ABS', 'CMP')).toBe(true)
    // 容許量這條路：e_k → |e_k| → × ε_rel → ＋ ← ε_abs
    expect(hasEdge(g, 'E', 'AE')).toBe(true)
    expect(nodeText(g, 'AE')).toBe('$|e_k|$')
    expect(hasEdge(g, 'AE', 'REL')).toBe(true)
    expect(nodeText(g, 'REL')).toContain(String.raw`$\times\,\varepsilon_{\mathrm{rel}}$`)
    expect(edgeText(g, 'REL', 'B')).toBe(String.raw`$+\,\varepsilon_{\mathrm{rel}}\,|e_k|$`)
    expect(edgeText(g, 'EA', 'B')).toBe('＋')
    expect(nodeText(g, 'EA')).toContain(String.raw`$\varepsilon_{\mathrm{abs}}$`)
    expect(edgeText(g, 'B', 'CMP')).toBe(String.raw`$b_k = \varepsilon_{\mathrm{abs}} + \varepsilon_{\mathrm{rel}}\,|e_k|$`)
    expect(nodeText(g, 'CMP')).toContain(String.raw`$|\Delta| \le b_k$`)
    expect(edgeText(g, 'CMP', 'OK')).toBe('是')
    expect(edgeText(g, 'CMP', 'BAD')).toBe('否')
    expect(CHART_TOLERANCE).toContain('class B focus')

    // 照著圖上的方塊算一次
    const walk = (a: number, e: number, tol: { abs?: number; rel?: number }) => {
      const delta = a - e // 加法點：＋a_k、−e_k
      const absDelta = Math.abs(delta) // 取絕對值
      const b = (tol.abs ?? 0) + (tol.rel ?? 0) * Math.abs(e) // |e_k| → × ε_rel → ＋ ε_abs
      return { absDelta, b, pass: absDelta <= b } // 菱形：|Δ| ≤ b_k
    }
    // 幾個手算的例子：接近 0 的量靠絕對項，很大的量靠相對項，整數門檻 abs = rel = 0 時必須完全相等
    expect(walk(2.2800000000000002, 2.28, { abs: 1e-12, rel: 1e-12 }).pass).toBe(true)
    expect(walk(2.2801, 2.28, { abs: 1e-12, rel: 1e-12 }).pass).toBe(false)
    expect(walk(6.1e-17, 0, { abs: 1e-12 }).pass).toBe(true) // e_k = 0：b_k = ε_abs
    expect(walk(12930.5, 12930, { rel: 1e-4 }).b).toBeCloseTo(1.293, 12) // 相對項主導
    expect(walk(598, 598, { abs: 0, rel: 0 }).pass).toBe(true)
    expect(walk(599, 598, { abs: 0, rel: 0 }).pass).toBe(false)

    // 對頁面上每個「純量」key：圖算出的 b_k、|Δ|、通過與否，和 toleranceBound／diffNumeric／compareToGolden 完全相同
    const st = computeAcceptanceState()
    let checked = 0
    let overridden = 0
    for (const row of st.rows) {
      for (const k of row.cmp?.keys ?? []) {
        if (typeof k.expected !== 'number' || typeof k.actual !== 'number') continue
        const w = walk(k.actual, k.expected, k.tol)
        expect(w.b, `${row.meta.id}.${k.key}`).toBe(toleranceBound(k.expected, k.tol))
        expect(w.absDelta, `${row.meta.id}.${k.key}`).toBe(diffNumeric(k.actual, k.expected, k.tol).maxAbsDiff)
        expect(w.pass, `${row.meta.id}.${k.key}`).toBe(k.pass)
        checked++
        if (k.overridden) overridden++
      }
    }
    expect(checked).toBeGreaterThan(40) // 18 個 T-id 的純量 key 至少這麼多
    expect(overridden).toBeGreaterThan(0) // 含 tolerance_overrides 的整數門檻
  })

  it('驗證管線：勘誤數寫在第二個方塊；Python 產生 vector 與 pytest，TS 的 Vitest 讀同一份 vector；徽章只讀 verify 彙整出來的狀態檔，「本頁即時重算」不通到徽章；圖上提到的檔案都存在', async () => {
    const g = await flow(CHART_PIPELINE)
    expect(g.vertices.map((v) => v.id).sort()).toEqual(['B', 'J', 'M', 'PG', 'PT', 'PY', 'S', 'SJ', 'TS', 'V', 'VR'])
    expect(nodeText(g, 'V')).toContain(`${ERRATA.length} 項勘誤`)
    expect(nodeText(g, 'V')).toContain('docs/validation.md')
    for (const [a, b] of [['S', 'V'], ['V', 'PY'], ['PY', 'J'], ['PY', 'PT'], ['J', 'TS'], ['M', 'TS'], ['M', 'PG'], ['J', 'PG'], ['TS', 'VR'], ['PT', 'VR'], ['VR', 'SJ'], ['SJ', 'B']]) {
      expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    }
    expect(g.edges).toHaveLength(12)
    // 徽章只能經過 verify.mjs 到達；TS 與 Python 兩邊都要經過它
    expect(reachable(g, 'S').has('B')).toBe(true)
    expect(reachable(g, 'S', 'VR').has('B')).toBe(false)
    expect(reachable(g, 'TS').has('B')).toBe(true)
    expect(reachable(g, 'PT').has('B')).toBe(true)
    // 本頁即時重算（acceptance.ts）是死胡同：不產生狀態檔、不接到徽章（對照頁面上的「誠實聲明」）
    expect(g.edges.some((e) => e.start === 'PG')).toBe(false)
    expect(reachable(g, 'PG').size).toBe(0)
    // 圖上寫的檔案真的存在
    const root = process.cwd()
    expect(nodeText(g, 'VR')).toBe('scripts/verify.mjs')
    expect(existsSync(resolve(root, 'scripts/verify.mjs'))).toBe(true)
    expect(nodeText(g, 'SJ')).toBe('verification-status.json')
    expect(existsSync(resolve(root, 'src/data/verification-status.json'))).toBe(true)
    expect(nodeText(g, 'J')).toContain('golden/vectors')
    expect(existsSync(resolve(root, 'golden/vectors/T01.json'))).toBe(true)
    expect(GOLDEN_INDEX.vectors.length).toBeGreaterThanOrEqual(18)
    expect(nodeText(g, 'PG')).toContain('acceptance.ts')
    expect(existsSync(resolve(root, 'src/simulation/models/acceptance.ts'))).toBe(true)
    expect(existsSync(resolve(root, 'docs/validation.md'))).toBe(true)
    // 節點 TS 寫的 it('Txx: …') 與 verify.mjs 的規則一致：title 要以「Txx:」開頭
    expect(nodeText(g, 'TS')).toContain("it('Txx: …')")
    expect(verifyMjs).toContain('const TS_PREFIX')
    expect(verifyMjs).toContain('const PY_PREFIX = /^test_(T\\d{2})')
  })

  it('四種狀態：照著圖的三個菱形走，結果就是 scripts/verify.mjs 的 statusOf（直接執行那個函式，走遍所有組合）', async () => {
    const g = await flow(CHART_STATUS)
    expect(g.vertices.map((v) => v.id).sort()).toEqual(['F', 'MI', 'P', 'PA', 'PY', 'Q1', 'Q2', 'Q3', 'TS'])
    // 圖的走向
    expect(hasEdge(g, 'TS', 'Q1')).toBe(true)
    expect(hasEdge(g, 'PY', 'Q1')).toBe(true)
    expect(edgeText(g, 'Q1', 'F')).toBe('有')
    expect(edgeText(g, 'Q1', 'Q2')).toBe('沒有')
    expect(edgeText(g, 'Q2', 'P')).toBe('是')
    expect(edgeText(g, 'Q2', 'Q3')).toBe('否')
    expect(edgeText(g, 'Q3', 'PA')).toBe('是')
    expect(edgeText(g, 'Q3', 'MI')).toBe('否')
    expect(nodeText(g, 'Q1')).toContain('任何一邊')
    expect(nodeText(g, 'Q1')).toContain('失敗')
    expect(nodeText(g, 'Q2')).toContain('兩邊都有')
    expect(nodeText(g, 'Q3')).toContain('至少一邊')
    expect(nodeText(g, 'P')).toContain('才顯示 verified')
    expect(nodeText(g, 'F')).toContain('結束碼 1')
    const NAME: Record<string, string> = { F: 'fail', P: 'pass', PA: 'partial', MI: 'missing' }
    for (const [id, status] of Object.entries(NAME)) expect(nodeText(g, id)).toContain(status)
    expect(CHART_STATUS).toContain('class P pass')
    expect(CHART_STATUS).toContain('class F warn')

    // verify.mjs 的 statusOf：從原始檔切出來真的執行（不是複製一份）
    const src = extractJsFunctions(verifyMjs, ['statusOf'])
    const statusOf = new Function(`${src}\nreturn statusOf`)() as (ts: { passed: number; failed: number }, py: { passed: number; failed: number }) => string
    type Side = { passed: number; failed: number }
    const sides: Side[] = []
    for (const failed of [0, 1, 3]) for (const passed of [0, 1, 7]) sides.push({ passed, failed })
    const next = (from: string, answer: string) => g.edges.find((e) => e.start === from && e.text === answer)!.end
    const walk = (ts: Side, py: Side): string => {
      const anyFailed = ts.failed > 0 || py.failed > 0 // Q1
      let at = next('Q1', anyFailed ? '有' : '沒有')
      if (at === 'Q2') {
        at = next('Q2', ts.passed > 0 && py.passed > 0 ? '是' : '否') // Q2
        if (at === 'Q3') at = next('Q3', ts.passed > 0 || py.passed > 0 ? '是' : '否') // Q3
      }
      return NAME[at]
    }
    const seen = new Set<string>()
    for (const ts of sides) {
      for (const py of sides) {
        const want = statusOf(ts, py)
        expect(walk(ts, py), `ts ${JSON.stringify(ts)} / py ${JSON.stringify(py)}`).toBe(want)
        seen.add(want)
      }
    }
    expect([...seen].sort()).toEqual(['fail', 'missing', 'partial', 'pass']) // 四種結果都真的走到過
    // 失敗優先：一邊全過、另一邊有一個失敗 ⇒ fail，不是 partial
    expect(statusOf({ passed: 9, failed: 0 }, { passed: 9, failed: 1 })).toBe('fail')
  })

  it('勘誤流程：先稽核再反駁，只有「反駁失敗」才成為勘誤；勘誤進 errata.json，網站採用修正版並連到本頁，部分勘誤另有即時重算；連結格式與頁面一致', async () => {
    const g = await flow(CHART_ERRATA_FLOW)
    expect(g.vertices.map((v) => v.id).sort()).toEqual(['AUD', 'CARD', 'E', 'EV', 'J', 'OK', 'Q1', 'REF', 'SITE', 'SK', 'SPEC'])
    expect(hasEdge(g, 'SPEC', 'AUD')).toBe(true)
    expect(hasEdge(g, 'AUD', 'Q1')).toBe(true)
    expect(edgeText(g, 'Q1', 'OK')).toBe('一致')
    expect(edgeText(g, 'Q1', 'SK')).toBe('不一致')
    expect(edgeText(g, 'SK', 'REF')).toBe('能反駁')
    expect(edgeText(g, 'SK', 'E')).toBe('反駁失敗')
    expect(hasEdge(g, 'E', 'J')).toBe(true)
    expect(hasEdge(g, 'J', 'SITE')).toBe(true)
    expect(hasEdge(g, 'J', 'EV')).toBe(true)
    expect(hasEdge(g, 'EV', 'CARD')).toBe(true)
    expect(hasEdge(g, 'SITE', 'CARD')).toBe(true)
    // 勘誤只有一個入口：反駁失敗；被反駁與一致的都走不到勘誤卡片
    expect(g.edges.filter((e) => e.end === 'E').map((e) => e.start)).toEqual(['SK'])
    expect(reachable(g, 'REF').size).toBe(0)
    expect(reachable(g, 'OK').size).toBe(0)
    expect(reachable(g, 'SPEC').has('CARD')).toBe(true)
    expect(reachable(g, 'SPEC', 'SK').has('CARD')).toBe(false)
    // 圖上的名稱就是程式裡的名稱
    expect(typeof computeErrataEvidence).toBe('function')
    expect(nodeText(g, 'EV')).toContain('computeErrataEvidence()')
    expect(nodeText(g, 'J')).toBe('src/data/errata.json')
    expect(existsSync(resolve(process.cwd(), 'src/data/errata.json'))).toBe(true)
    expect(nodeText(g, 'E')).toContain('docs/validation.md')
    expect(nodeText(g, 'CARD')).toContain(erratumHref('E05').replace('E05', 'Exx'))
    expect(erratumHref('E05')).toBe('#/verification?e=E05')
    expect(ERRATA.length).toBeGreaterThan(0)
    expect(CHART_ERRATA_FLOW).toContain('class E focus')
  })

  it('圖內的數學一律是 `$...$` LaTeX：$ 成對、每段 TeX 可被 KaTeX 嚴格解析、不用雙反斜線（Mermaid 會收成一個）、`$...$` 以外沒有 Unicode 拼的數學', () => {
    for (const c of VERIFICATION_CHARTS) {
      expect(c.chart, c.name).not.toContain('\\\\')
      for (const label of quotedLabels(c.chart)) {
        const dollars = label.replace(/\\\$/g, '').split('$').length - 1
        expect(dollars % 2, `${c.name}：${label}`).toBe(0)
        for (const m of label.matchAll(MATH)) {
          expectTexParses(m[1] ?? m[2], `${c.name}：${m[0]}`, { strict: 'ignore' })
        }
        expect(unicodeMathIn(textPieces(label).join(' ')), `${c.name}：${label}`).toEqual([])
      }
    }
    // 容忍度判定圖是唯一的數學模型圖；其餘三張是流程圖，標籤只有文字與程式碼名稱
    expect(mathLabelCount(CHART_TOLERANCE)).toBeGreaterThanOrEqual(9)
    for (const c of [CHART_PIPELINE, CHART_STATUS, CHART_ERRATA_FLOW]) expect(mathLabelCount(c)).toBe(0)
  })

  it('實際渲染（共用的 renderMermaidForTest）：每張圖都畫得出來，沒有「Unsupported markdown」、畫面上沒有殘留的 $、KaTeX 以外沒有 Unicode 數學、節點數 ≤ 14，每個標籤都畫出來', async () => {
    for (const c of VERIFICATION_CHARTS) {
      const { svg, text, nodeCount, mathCount, plainText } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(text, `${c.name}：畫面上不可殘留 $`).not.toContain('$')
      expect(unicodeMathIn(plainText), `${c.name}：KaTeX 以外不可有 Unicode 拼的數學`).toEqual([])
      expect(nodeCount, c.name).toBeLessThanOrEqual(14)
      expect(nodeCount, c.name).toBeGreaterThanOrEqual(5)
      expect(mathCount, `${c.name}：每個含 $...$ 的標籤都排成一個 KaTeX 區塊`).toBe(mathLabelCount(c.chart))
      const host = document.createElement('div')
      host.innerHTML = svg
      host.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
      const shown = Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel')).map((e) => squash(e.textContent ?? ''))
      const g = await flow(c.chart)
      expect(nodeCount, `${c.name}：畫出來的節點數 = 解析出來的節點數`).toBe(g.vertices.length)
      // 沒有公式的標籤原樣出現在圖上；含公式的標籤，公式以外的文字片段都在同一個標籤裡
      const appears = (label: string): boolean => {
        const decoded = decode(label)
        if (!hasMath(decoded)) return shown.includes(plain(decoded))
        return shown.some((t) => textPieces(decoded).every((piece) => t.includes(squash(piece))))
      }
      for (const v of g.vertices) expect(appears(v.text ?? ''), `${c.name} 節點 ${v.id}：「${v.text}」沒有出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text) expect(appears(e.text), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有出現在圖上`).toBe(true)
    }
  }, 120000)
})

describe('Verification 頁面上的方塊圖與符號表（teaching-style §5、§8）', () => {
  it('4 張圖各出現一次、順序與清單相同、都有圖說與「先看…再看…」導讀並放在對應的推導／說明卡之前；符號表在頁尾（id="symbols"），頁首只留一行按鈕', async () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = renderPage(<VerificationPage />, { url: '/verification' })
    await settleLazy(container) // §V.3–§V.6 的圖在延後載入的區塊裡
    const before = (a: Element | null, b: Element | null, msg: string) => {
      expect(a, msg).toBeTruthy()
      expect(b, msg).toBeTruthy()
      expect(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING, msg).toBeTruthy()
    }

    // ① 圖：與清單同序、各一次（Beginner 模式也全部看得到）
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs.map((f) => f.getAttribute('data-chart'))).toEqual(VERIFICATION_CHARTS.map((c) => c.chart))
    const el = (name: string) => figs[VERIFICATION_CHARTS.findIndex((c) => c.name === name)]
    // ② 圖說：數學一律 LaTeX（$…$ 成對），不用 Unicode 拼數學
    const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓]/
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, f.getAttribute('data-chart')?.slice(0, 40)).toBeGreaterThan(15)
      expect(BAD.test(cap), cap).toBe(false)
      expect(cap.split('$').length % 2, cap).toBe(1)
    }
    // ③ 導讀：「先看…再看…」，容忍度的導讀含 KaTeX（頁面上沒有殘留的 $）
    for (const c of VERIFICATION_CHARTS) {
      const walk = el(c.name).closest('.ver-diagram')?.querySelector('.ver-diagram-walk')
      expect(walk?.textContent, c.name).toContain('先看')
      expect(walk?.textContent, c.name).toContain('再看')
      expect(walk?.textContent, c.name).not.toContain('$')
    }
    expect(el('CHART_TOLERANCE').closest('.ver-diagram')?.querySelectorAll('.ver-diagram-walk .katex').length).toBeGreaterThanOrEqual(6)
    // ④ 位置：說明 → 圖 → 推導／說明卡
    const hand = container.querySelector('#ver-handcalc') as HTMLElement
    expect(hand.contains(el('CHART_TOLERANCE'))).toBe(true)
    before(hand.querySelector('table.ver-handcalc'), el('CHART_TOLERANCE'), '容忍度判定圖在 T01 的手算表之後')
    const steps = Array.from(hand.querySelectorAll('.c-steps')).filter((n) => n.querySelector('.c-steps-title')?.textContent?.includes('容忍度規則'))
    expect(steps.length).toBeGreaterThan(0)
    before(el('CHART_TOLERANCE'), steps[0], '容忍度判定圖在「容忍度規則」推導之前')
    const pipe = container.querySelector('#ver-pipeline') as HTMLElement
    expect(pipe.contains(el('CHART_PIPELINE'))).toBe(true)
    expect(pipe.contains(el('CHART_STATUS'))).toBe(true)
    before(el('CHART_PIPELINE'), el('CHART_STATUS'), '驗證管線圖在四種狀態圖之前')
    before(el('CHART_STATUS'), pipe.querySelector('.ver-status-grid'), '四種狀態圖在四張說明卡之前')
    const errata = container.querySelector('#ver-errata') as HTMLElement
    expect(errata.contains(el('CHART_ERRATA_FLOW'))).toBe(true)
    before(el('CHART_ERRATA_FLOW'), errata.querySelector('.ver-filters'), '勘誤流程圖在篩選列之前')
    before(el('CHART_ERRATA_FLOW'), errata.querySelector('ol'), '勘誤流程圖在「每張卡片由上而下」之前')

    // ⑤ 符號表：全頁只有一張，在 #symbols 裡；#symbols 是整頁最後一個區塊（思考題、必記之後）
    const page = container.querySelector('.ver')!
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(page.lastElementChild).toBe(symbols)
    expect(symbols.querySelector('h2')?.textContent).toBe('§V.8 本頁符號表')
    before(container.querySelector('#ver-wrapup'), symbols, '符號表在 §V.7 之後')
    before(container.querySelector('.c-recap'), symbols, '符號表在「必記」之後')
    before(container.querySelector('#ver-errata'), symbols, '符號表在勘誤瀏覽器之後')
    const tables = Array.from(container.querySelectorAll('.c-symbols'))
    expect(tables).toHaveLength(1)
    expect(symbols.contains(tables[0])).toBe(true)
    expect(tables[0].querySelectorAll('tbody tr').length).toBe(SYMBOLS.length)
    expect(container.querySelector('#ver-intro .c-symbols')).toBeNull()
    // ⑥ 頁首只留一行：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），在第一個段落之前
    const link = Array.from(container.querySelectorAll('.ver-symbols-link button')).find((b) => b.textContent === '本頁符號表在最後 ↓') as HTMLButtonElement
    expect(link).toBeTruthy()
    before(link, container.querySelector('#ver-intro'), '連結在頁首的第一個段落之前')
    expect(container.querySelectorAll('a[href="#symbols"], a[href$="#symbols"]')).toHaveLength(0)
    expect((container.textContent ?? '').split('本頁符號表在最後').length).toBe(2)
    // 按下去捲到 #symbols（jsdom 沒有 scrollIntoView，這裡裝一個替身）；符號表旁的「回到頁首」捲回頁首的第一個段落
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
      expect(scrolled[1]).toBe(container.querySelector('#ver-intro'))
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  }, 120000)
})
