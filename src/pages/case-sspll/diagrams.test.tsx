import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { SettingsProvider } from '@/app/settings'
import { SYSTEM_BLOCK_LABEL, extractRegion, sanitizeMermaidSource, stripMathDelimiters, systemMapModel } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { cAbs, cMul, type Complex } from '@/simulation/core/complex'
import { erf } from '@/simulation/core/special'
import {
  W1,
  W_SQUARE,
  blockMeanStable,
  cppllMinusReL,
  eqOffset,
  gosSmallBeta,
  indicatorLineWeight,
  loopH,
  loopL,
  loopStep,
  makeL1,
  makePOnlyL2,
  oneDiffMargin,
  phaseSequence,
  sawtoothLinePower,
  toySignLmsStep,
  typeIIOneDiffG,
  typeIIReL,
  typeILatencyCriterion,
  typeIPoleCriterion,
} from '@/simulation/models/sspll'
import CaseSspllPage from './index'
import { MODEL_SRC } from './common'
import { FORMULAS } from './formulas'
import { DOC_JOINT, LOOPS, LOOP_KEYS, PARAMS, SURE } from './data'
import * as D from './diagrams'
import { DIAGRAMS, DIAGRAM_KIND_LABEL, MAP_FOCUS, diagramById } from './diagrams'
import { PageMap } from './sections/S01Roadmap'
import { SIM_LOOP_CODE } from './sections/S14ClosedLoop'
import { SYMBOLS_ANCHOR } from './sections/S21Symbols'
import { SYMBOLS } from './symbols'

// 整頁渲染會用到 Plotly（jsdom 沒有 canvas）：和 index.test.tsx 相同的替身。mermaid 是「真的」——解析用真正的 parser，
// 只有在渲染元件的那幾題把 mermaid.render 換成替身（jsdom 沒有 getBBox，真的 render 一定失敗）。
const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

const DIR = join(process.cwd(), 'src/pages/case-sspll')
const SECTION_FILES = readdirSync(join(DIR, 'sections')).filter((f) => f.endsWith('.tsx'))
const SECTION_SRC = SECTION_FILES.map((f) => readFileSync(join(DIR, 'sections', f), 'utf8')).join('\n')
const INDEX_SRC = readFileSync(join(DIR, 'index.tsx'), 'utf8')

/** 本章原有的圖（§2 的 SSPLL 架構圖；2026-10 起依 docs/assumptions.md §2a 重畫：PD 的輸出獨立成一個節點）；其餘都是後來新增的 */
const EXISTING_IDS = ['sspll']

interface FlowEdge {
  start: string
  end: string
  text: string
  stroke: string
}
interface FlowVertex {
  id: string
  text?: string
  type?: string
  classes?: string[]
}
interface FlowSubGraph {
  id: string
  title: string
  nodes: string[]
}
interface FlowDb {
  getVertices: () => Map<string, FlowVertex>
  getEdges: () => FlowEdge[]
  getSubGraphs: () => FlowSubGraph[]
}
interface SeqMessage {
  from?: string
  to?: string
  message?: string
}
interface SeqDb {
  getActors: () => Map<string, { description: string }>
  getMessages: () => SeqMessage[]
}

/** 用真正的 mermaid parser 解析，回傳圖種與內部的資料表（節點、連線、subgraph） */
async function parsed(chart: string): Promise<{ type: string; db: unknown }> {
  const r = await mermaid.parse(chart, { suppressErrors: false })
  const type = r && typeof r === 'object' ? r.diagramType : String(r)
  const diag = await mermaid.mermaidAPI.getDiagramFromText(chart)
  return { type, db: diag.db }
}

/** securityLevel: 'strict' 會把文字裡的 < > & 轉成 HTML entity（畫面上仍顯示原字元）；比對前先還原 */
const decode = (t: string | undefined): string => (t ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

async function flow(id: string): Promise<{ nodes: FlowVertex[]; edges: FlowEdge[]; subs: FlowSubGraph[]; node: (k: string) => FlowVertex; edge: (a: string, b: string) => FlowEdge }> {
  const { type, db } = await parsed(diagramById(id).def.chart)
  expect(type, id).toBe('flowchart-v2')
  const f = db as FlowDb
  const subs = f.getSubGraphs().map((s) => ({ ...s, title: decode(s.title) }))
  const subIds = new Set(subs.map((s) => s.id))
  const all = new Map([...f.getVertices().entries()].map(([k, v]) => [k, { ...v, text: decode(v.text) }]))
  const nodes = [...all.values()].filter((v) => !subIds.has(v.id))
  const edges = f.getEdges().map((e) => ({ ...e, text: decode(e.text) }))
  return {
    nodes,
    edges,
    subs,
    node: (k) => {
      const v = all.get(k)
      if (!v) throw new Error(`${id}：找不到節點 ${k}`)
      return v
    },
    edge: (a, b) => {
      const e = edges.find((x) => x.start === a && x.end === b)
      if (!e) throw new Error(`${id}：找不到連線 ${a} → ${b}`)
      return e
    },
  }
}

/** 連線標籤開頭的正負號（可能寫在 `$+\,x$`、`$-\,y$` 裡）：統一成全形「＋」與減號「−」（U+2212） */
function leadingSign(text: string): string {
  const c = text.trim().replace(/^\$/, '').charAt(0)
  return c === '+' ? '＋' : c === '-' ? '−' : c
}

/** 加法點的輸入必須標正負號：回傳「來源 → 符號」 */
function signsInto(edges: FlowEdge[], sum: string): Record<string, string> {
  return Object.fromEntries(edges.filter((e) => e.end === sum).map((e) => [e.start, leadingSign(e.text)]))
}

/** 雙引號標籤裡含 `$` 的個數（sequenceDiagram 則數 `$$...$$` 的段數）＝ KaTeX 應該排出幾個公式 */
function mathLabelCount(chart: string): number {
  return chart.startsWith('sequenceDiagram') ? (chart.match(/\$\$/g) ?? []).length / 2 : (chart.match(/"[^"\n]*\$[^"\n]*"/g) ?? []).length
}

const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

describe('案例頁 /case/sspll 的方塊圖：語法、數量與位置（真正的 mermaid parser）', () => {
  it('SSPLL: 每一張圖都能被 mermaid 解析；36 張新圖 + 1 張原有的架構圖 = 37 張（另加章首的系統地圖）', async () => {
    expect(DIAGRAMS).toHaveLength(37)
    expect(DIAGRAMS.filter((d) => !EXISTING_IDS.includes(d.id))).toHaveLength(36)
    expect(DIAGRAMS.filter((d) => !EXISTING_IDS.includes(d.id)).length).toBeGreaterThanOrEqual(6)
    for (const d of DIAGRAMS) {
      const { type } = await parsed(d.chart)
      expect(type, d.id).toBe(d.id === 'align' ? 'sequence' : 'flowchart-v2')
    }
    // 章首的系統地圖是全站共用的手排 SVG（不經過 Mermaid）：本章標示的 10 個方塊都真的在地圖的資料模型裡，而且恰好就是被標成主角的那幾個
    expect(new Set(MAP_FOCUS).size).toBe(MAP_FOCUS.length)
    const focused = systemMapModel(MAP_FOCUS).blocks.filter((b) => b.focused)
    expect(focused.map((b) => b.id).sort()).toEqual([...MAP_FOCUS].sort())
  })

  it('SSPLL: 登錄表——id 唯一、圖說是一句完整的話、數學一律用成對的 `$...$`（不用 Unicode 拼數學）、種類合法；每張圖都是具名匯出的 Mermaid 原始碼', () => {
    expect(new Set(DIAGRAMS.map((d) => d.id)).size).toBe(DIAGRAMS.length)
    expect(new Set(DIAGRAMS.map((d) => d.chart)).size).toBe(DIAGRAMS.length)
    for (const d of DIAGRAMS) {
      expect(d.caption.length, d.id).toBeGreaterThan(20)
      expect(d.caption, d.id).toMatch(/。$/)
      expect(d.caption, d.id).not.toMatch(/NaN|undefined/)
      // 圖說裡的數學是成對的 $...$（<Mermaid caption> 用 KaTeX 渲染）；$...$ 之外不可以有底線下標或希臘字母——那是 Unicode 拼出來的數學
      expect((d.caption.match(/\$/g) ?? []).length % 2, `${d.id}：$ 要成對`).toBe(0)
      expect(d.caption.replace(/\$[^$]*\$/g, ''), d.id).not.toMatch(/_|[Α-Ωα-ωΔΣ]|\\/)
      expect(Object.keys(DIAGRAM_KIND_LABEL), d.id).toContain(d.kind)
      expect(d.section, d.id).toMatch(/^§\d+(\.\d+)?$/)
    }
    // 具名匯出（CHART_* 與 SSPLL_CHART）與登錄表一一對應
    const exported = Object.entries(D as Record<string, unknown>).filter(([k, v]) => typeof v === 'string' && (k.startsWith('CHART_') || k === 'SSPLL_CHART')) as [string, string][]
    expect(exported).toHaveLength(DIAGRAMS.length)
    expect(new Set(exported.map(([, v]) => v))).toEqual(new Set(DIAGRAMS.map((d) => d.chart)))
    // 涵蓋 teaching-style §8 的各種圖：架構、數學模型、演算法迴圈、路徑、比較、流程、時序
    for (const kind of ['architecture', 'model', 'loop', 'path', 'compare', 'flow', 'timing'] as const) expect(DIAGRAMS.some((d) => d.kind === kind), kind).toBe(true)
    expect(() => diagramById('no-such-diagram')).toThrow(/未登錄的方塊圖/)
    expect(diagramById('answer').label).toBe('圖 CS-1')
    expect(diagramById('hardware').label).toBe(`圖 CS-${DIAGRAMS.length}`)
  })

  it('SSPLL: 圖不過大——每張流程圖不超過 14 個節點；有上色的圖都定義了 focus／ok／warn', async () => {
    for (const d of DIAGRAMS) {
      if (d.id === 'align') continue
      const f = await flow(d.id)
      expect(f.nodes.length, d.id).toBeLessThanOrEqual(14)
      expect(f.nodes.length, d.id).toBeGreaterThanOrEqual(5)
      const used = new Set(f.nodes.flatMap((v) => v.classes ?? []))
      for (const c of used) {
        expect(['focus', 'ok', 'warn'], `${d.id}：${c}`).toContain(c)
        expect(d.chart, `${d.id}：classDef ${c}`).toContain(`classDef ${c} `)
      }
    }
  })

  it('SSPLL: 每張圖在頁面原始碼中恰好出現一次（<Diagram id="…" />），內文引用的圖號（<FigRef>）都存在', () => {
    const used = [...SECTION_SRC.matchAll(/<Diagram id="([^"]+)" \/>/g)].map((m) => m[1])
    expect([...used].sort()).toEqual(DIAGRAMS.map((d) => d.id).sort())
    const refs = [...(SECTION_SRC + INDEX_SRC).matchAll(/<FigRef id="([^"]+)" \/>/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThanOrEqual(8)
    for (const id of refs) expect(DIAGRAMS.map((d) => d.id), id).toContain(id)
    // 每一節裡，圖放在推導（StepDerivation）之前：有圖也有推導的檔案中，第一張圖的位置在第一個推導之前
    for (const f of SECTION_FILES) {
      const src = readFileSync(join(DIR, 'sections', f), 'utf8')
      const body = src.slice(src.indexOf('return ('))
      const iDiagram = body.indexOf('<Diagram id=')
      const iDeriv = body.indexOf('<StepDerivation')
      if (iDiagram >= 0 && iDeriv >= 0) expect(iDiagram, f).toBeLessThan(iDeriv)
    }
    // 每個登錄的公式（F-CS.1–20）在同一個檔案裡都先有一張對應的圖
    const PICTURE_FOR_FORMULA: Record<string, string> = {
      'F-CS.1': 'answer',
      'F-CS.2': 'mean-loop',
      'F-CS.3': 'spectral',
      'F-CS.4': 'identity',
      'F-CS.5': 'lowfreq',
      'F-CS.6': 'lowfreq',
      'F-CS.7': 'three-loops',
      'F-CS.8': 're-l2',
      'F-CS.9': 're-l3',
      'F-CS.10': 'type1-variants',
      'F-CS.11': 'gos',
      'F-CS.12': 'near-grid',
      'F-CS.13': 'phos-modes',
      'F-CS.14': 'mode1-bounds',
      'F-CS.15': 'psd',
      'F-CS.16': 'onediff',
      'F-CS.17': 'fx',
      'F-CS.18': 'finite-step',
      'F-CS.19': 'offset',
      'F-CS.20': 'large-signal',
    }
    expect(Object.keys(PICTURE_FOR_FORMULA).sort()).toEqual(FORMULAS.map((f) => f.id).sort())
    for (const [fid, pic] of Object.entries(PICTURE_FOR_FORMULA)) {
      const file = SECTION_FILES.find((f) => readFileSync(join(DIR, 'sections', f), 'utf8').includes(`<Formula id="${fid}" />`))
      expect(file, fid).toBeTruthy()
      const src = readFileSync(join(DIR, 'sections', file!), 'utf8')
      const iPic = src.indexOf(`<Diagram id="${pic}" />`)
      expect(iPic, `${fid} ← ${pic}`).toBeGreaterThan(0)
      expect(iPic, `${fid} ← ${pic}`).toBeLessThan(src.indexOf(`<Formula id="${fid}" />`))
    }
    // 章首：系統地圖緊接在開場問題之後、「本頁設定」與目錄之前
    expect(INDEX_SRC).toMatch(/<\/blockquote>\s*<PageMap \/>\s*<p className="cs-lead">/)
    expect(SECTION_SRC).toMatch(/<SystemMap\s+focus=\{MAP_FOCUS\}/)
  })
})

describe('案例頁 /case/sspll 的方塊圖：訊號名稱、正負號、取樣率與正文公式／模型一致', () => {
  it('SSPLL: 極性——δ = 真值 − 估計；加法點的正負號與 e_PD = u − y、δ[k+1] = δ[k] − μ·K_q·C·δ[k] 相符', async () => {
    // §2 注入點：δ_g = a − w_g、δ_k = ε_k − w_k；兩個誤差都以「+」進入比較點（極性約定已吸收）
    const inj = await flow('injection')
    expect(inj.node('DG').text).toContain(String.raw`\delta_g\cdot\Delta = (a - w_g)\cdot\Delta`)
    expect(inj.node('DK').text).toContain(String.raw`\delta_k = \varepsilon_k - w_k`)
    expect(signsInto(inj.edges, 'SU')).toEqual({ MG: '＋', MP: '＋' })
    expect(inj.edge('MG', 'SU').text).toContain('reference 端')
    expect(inj.edge('MP', 'SU').text).toContain('feedback 端')
    expect(inj.edge('SU', 'H').text).toContain('u[n]')
    expect(inj.edge('H', 'OUT').text).toContain(String.raw`e_{PD}[n] = (h_{PD} * u)[n]`)
    // 比較點就是 PD 的輸入端；H_PD 的輸出是 PD 的輸出，同時給 loop filter 與比較器
    expect(inj.edge('SU', 'H').text).toContain('PD 輸入端')
    expect(inj.node('OUT').text).toContain('PD 輸出')
    expect(inj.node('OUT').text).toContain('loop filter 與 1-bit 比較器')
    // §3 主迴路：u 以「+」、y 以「−」進入加法點；加法點的輸出（e_PD）同時送往迴路與比較器
    const hpd = await flow('hpd-loop')
    expect(signsInto(hpd.edges, 'S')).toEqual({ U: '＋', VCO: '−' })
    expect(hpd.edge('VCO', 'S').text).toContain('y[n]')
    expect(hpd.edge('S', 'LF').text).toBe('$e_{PD}[n]$')
    expect(hpd.edge('S', 'CMP').text).toBe('$e_{PD}[n]$')
    // 藍色的圓就是 PD：它的輸出只有兩個去處——loop filter 與比較器；比較器沒有別的輸入
    expect(hpd.node('S').text).toBe('PD')
    expect(hpd.node('S').classes ?? []).toContain('focus')
    expect(hpd.edges.filter((e) => e.start === 'S').map((e) => e.end).sort()).toEqual(['CMP', 'LF'])
    expect(hpd.edges.filter((e) => e.end === 'CMP').map((e) => e.start)).toEqual(['S'])
    expect(hpd.node('CMP').text).toContain('取的是 PD 的輸出')
    // 圖上也寫明兩個輸入端：u 折算到 PD 的 reference 輸入（＋），y 回到 feedback 輸入（−）
    expect((hpd.node('U').text ?? '').replace(/<br\s*\/?>/g, '')).toContain('折算到 PD 的reference 輸入')
    expect(hpd.edge('VCO', 'S').text.replace(/<br\s*\/?>/g, '')).toContain('回到 feedback 輸入')
    expect(hpd.subs[0].title).toContain('$L(z)$')
    expect([...hpd.subs[0].nodes].sort()).toEqual(['LF', 'VCO'])
    // §4 平均迴路：δ[k] 以「+」、μ·K_q·C·δ[k] 以「−」
    const mean = await flow('mean-loop')
    expect(signsInto(mean.edges, 'S')).toEqual({ Z: '＋', MU: '−' })
    expect(mean.edge('S', 'Z').text).toBe(String.raw`$\delta[k+1]$`)
    expect(mean.edge('KQ', 'MU').text).toContain(String.raw`K_q\cdot C\cdot\delta[k]`)
    // §12 有限步長：θ[k+1] = θ[k] − (κ/N_τ)·θ[k]
    const fin = await flow('finite-step')
    expect(signsInto(fin.edges, 'S')).toEqual({ Z: '＋', K: '−' })
    // §13 offset：殘差、雜訊、offset 三者都以「+」進比較器；forcing 與恢復項分開
    const off = await flow('offset')
    expect(signsInto(off.edges, 'A')).toEqual({ E: '＋', V: '＋', OS: '＋' })
    expect(off.node('F').text).toContain(String.raw`E[q]\cdot\langle r_i\rangle`)
    expect(off.node('RS').text).toContain(String.raw`K_q(u_{os})\cdot(C\cdot\delta)_i`)
    expect(off.edge('ZM', 'F').stroke).toBe('dotted')
    // §14 模擬迴圈：u = (ρΔ + ε_p) − (1 − a)(1 + w_g)(ρΔ + w_p)
    const sim = await flow('sim-loop')
    expect(signsInto(sim.edges, 'S')).toEqual({ ID: '＋', DT: '−' })
    expect(sim.node('ID').text).toContain(String.raw`\rho\cdot\Delta + \varepsilon_p`)
    expect(sim.node('DT').text).toContain(String.raw`(1 - a)(1 + w_g)\cdot(\rho\cdot\Delta + w_p)`)
    expect(sim.node('CMP').text).toContain(String.raw`\mathrm{sign}(e_{PD} + v + u_{os})`)
  })

  it('SSPLL: 架構照 docs/assumptions.md §2a——DTC 在 reference 輸入端、回授路徑上只有 PMUX、校正迴路取 PD 的輸出；DTC 的延遲是 T_0 減補償量', async () => {
    const sp = await flow('sspll')
    const has = (a: string, b: string) => sp.edges.some((e) => e.start === a && e.end === b)
    const into = (k: string) => sp.edges.filter((e) => e.end === k).map((e) => e.start).sort()
    const outOf = (k: string) => sp.edges.filter((e) => e.start === k).map((e) => e.end).sort()
    // 訊號路徑：REF → DTC → PD → （PD 輸出）→ loop filter → VCO；回授：VCO → PMUX → PD
    for (const [a, b] of [['REF', 'DTC'], ['DTC', 'PD'], ['PD', 'E'], ['E', 'LF'], ['LF', 'VCO'], ['VCO', 'PMUX'], ['PMUX', 'PD']]) expect(has(a, b), `${a} → ${b}`).toBe(true)
    // DTC 不在回授路徑上；reference 不會繞過 DTC 直接進 PD
    expect(has('PMUX', 'DTC')).toBe(false)
    expect(has('VCO', 'DTC')).toBe(false)
    expect(has('REF', 'PD')).toBe(false)
    expect(outOf('PMUX')).toEqual(['PD'])
    expect(outOf('REF')).toEqual(['DTC'])
    expect(into('DTC')).toEqual(['ACC', 'LMS', 'REF']) // reference、累加器的 code、LMS 的權重
    expect(into('PD')).toEqual(['DTC', 'PMUX'])
    expect(into('PMUX')).toEqual(['ACC', 'VCO']) // carry／相位索引控制 PMUX
    // PD 量的是 t_ref′ − t_fb：兩條進來的線分別標 reference edge 與 feedback edge
    expect(sp.edge('DTC', 'PD').text.replace(/<br\s*\/?>/g, ' ')).toBe("reference edge $t_{ref}'$")
    expect(sp.edge('PMUX', 'PD').text.replace(/<br\s*\/?>/g, ' ')).toBe('feedback edge $t_{fb}$')
    expect(sp.node('PD').text).toContain('SSPD（phase detector）')
    expect(sp.node('PD').text).toContain("$t_{ref}' - t_{fb}$")
    // 校正迴路的輸入是 PD 的輸出：PD 只接到「PD 輸出」這個節點，它再分給 loop filter 與 1-bit 比較器；比較器沒有別的輸入
    expect(outOf('PD')).toEqual(['E'])
    expect(sp.node('E').text).toBe('PD 輸出 $e_{PD} = h_{PD} * u$')
    expect(sp.node('E').classes ?? []).toContain('focus')
    expect(outOf('E')).toEqual(['CMP', 'LF'])
    expect(into('CMP')).toEqual(['E'])
    expect(into('LF')).toEqual(['E'])
    expect(sp.edge('E', 'CMP').text).toBe('同一個 $e_{PD}$')
    expect(sp.node('CMP').text).toContain(String.raw`q = \mathrm{sign}(e_{PD} + v)`)
    // GMAC：比較器輸出 × regressor；LMS 的 9 個權重回到 reference 端的 DTC
    expect(into('GMAC')).toEqual(['CMP', 'XR'])
    expect(sp.node('XR').text).toContain('regressor $x_i[n]$')
    expect(sp.node('XR').text).toContain('累加器的') // regressor 沒有從累加器拉線過來（會和別的線交叉），所以節點上寫明來源
    expect(outOf('LMS')).toEqual(['DTC'])
    // DTC 只能延遲：延遲 = T_0 − 補償量；補償量的式子（模型）沒有變。PMUX 的偏差以「早到」為正
    expect(sp.node('DTC').text).toContain('input DTC（reference 端）')
    expect(sp.node('DTC').text).toContain('延遲 $= T_0 -$ 補償量')
    expect(sp.node('DTC').text).toContain(String.raw`補償量 $= (1 - a)(1 + w_g)\cdot\rho\Delta$`)
    expect(sp.node('DTC').text).not.toMatch(/延遲 \$= \(1 - a\)/)
    expect(sp.node('PMUX').text).toContain('8 相 PMUX（feedback 端）')
    expect(sp.node('PMUX').text).toContain(String.raw`早到 $\varepsilon_k$`)
    expect(diagramById('sspll').def.caption).toContain('和送進 loop filter 的是同一個訊號')
    expect(diagramById('sspll').def.alt).toContain('回授路徑上沒有 DTC')
    // 這個接法給出的就是模型的注入式：t_ref′ = T_0 − 補償量、t_fb = −(ρΔ + ε_p)（早到）⇒ t_ref′ − t_fb − T_0 = u
    expect(SIM_LOOP_CODE.inject).toBe('u = c * Dl + eps[p] - gain * (c * Dl + W[l][p])')
    for (const [rho, eps, a, wg, wp, T0] of [[0.3, 0.2, 0.05, 0.02, 0.1, 40], [0.9, -0.3, 0.05, 0.08, -0.25, 12.5], [0, 0.1, 0, 0, 0, 7.8125]]) {
      const Dl = 7.8125
      const gain = (1 - a) * (1 + wg)
      const comp = gain * (rho * Dl + wp) // DTC 的補償量
      const tRef = T0 - comp // DTC 之後的 reference edge
      const tFb = -(rho * Dl + eps) // feedback edge：早到 ρΔ + ε_p
      const u = rho * Dl + eps - gain * (rho * Dl + wp) // SIM_LOOP_CODE.inject
      expect(tRef - tFb - T0).toBeCloseTo(u, 12)
      // 這幾組數字裡，補得不夠（w_g < a、0 < w_p < ε_p）的那一組 reference 還是太晚，誤差為正
      if (wg < a && wp < eps) expect(u).toBeGreaterThan(0)
    }
    // 全站的系統地圖是同一種接法：ref → dtc → pd、div → pd、沒有 div → dtc；LMS 的輸入分接在 PD → loop filter 那條線上
    const wires = systemMapModel(MAP_FOCUS).wires
    const wire = (a: string, b: string) => wires.find((w) => w.from === a && w.to === b)
    for (const [a, b] of [['ref', 'dtc'], ['dtc', 'pd'], ['pd', 'lf'], ['div', 'pd'], ['gc', 'dtc']]) expect(wire(a, b), `${a} → ${b}`).toBeTruthy()
    expect(wire('div', 'dtc')).toBeUndefined()
    expect(wire('ref', 'pd')).toBeUndefined()
    expect(wire('pd', 'cmp')?.tag?.tapOn).toEqual(['pd', 'lf'])
    // 其他畫到硬體的圖：比較器接 SSPD 的 hold 節點（PD 輸出）；權重修正的是 DTC 的補償量；P-only 的 y 回到 PD 的 feedback 輸入
    const hw = await flow('hardware')
    expect(hw.node('SSPD').text).toContain('PD 輸出 $e_{PD}$')
    expect(hw.edges.filter((e) => e.end === 'CMP').map((e) => e.start)).toEqual(['SSPD'])
    expect(hw.node('COR').text).toContain('修正 DTC 的補償量')
    expect((await flow('p-only')).node('O').text).toContain('feedback 輸入（−）')
    // 沒有任何一張圖把 DTC 畫在 PMUX／divider 之後，也沒有圖說 DTC「插入延遲」
    for (const d of DIAGRAMS) {
      expect(d.chart, d.id).not.toMatch(/PMUX\s*-->\s*DTC|DIV\s*-->\s*DTC|修正 DTC 的延遲/)
      expect(d.caption + (d.alt ?? ''), d.id).not.toMatch(/divider 之後|插入延遲/)
    }
    // 正文：§2 寫出哪一條 edge 被延遲（T_0、補償量、t_ref′ − t_fb）；章首不再說地圖把 DTC 畫在 divider 之後；§3 的 u 在 reference 輸入端、y 從 feedback 輸入端回來
    const src = (f: string) => readFileSync(join(DIR, 'sections', f), 'utf8')
    const s2 = src('S02Architecture.tsx')
    expect(s2).toContain(String.raw`\tau_{DTC}[n]=T_0-\underbrace{\rho[n]\,\Delta}_{\text{補償量}}`)
    expect(s2).toContain(String.raw`t_{ref}'[n]-t_{fb}[n]`)
    expect(s2).toContain('只能延遲、不能提前')
    expect(s2).toContain('reference edge')
    expect(s2).toContain('也就是送進 loop filter 的同一個訊號')
    expect(s2).toContain(String.raw`e_{GOS}[n]=(a-w_g)\,\rho[n]\,\Delta`)
    expect(s2).toContain(String.raw`e_{PHOS}[n]=\sum_k(\varepsilon_k-w_k)\,\mathbf 1\{p[n]=k\}`)
    expect(s2).not.toMatch(/理想的延遲|實際的延遲|修正延遲|從同一個比較點取出/)
    const s1 = src('S01Roadmap.tsx')
    expect(s1).not.toMatch(/divider 之後|只差正負號/)
    expect(s1).toContain('回授路徑上只有地圖的「Divider / PMUX」')
    const s3 = src('S03Hpd.tsx')
    expect(s3).toContain('reference 輸入端')
    expect(s3).toContain('feedback 輸入端')
    expect(s3).toContain('e_{PD}[n]=u[n]-y[n]')
    expect(s3).toContain(String.raw`E_{PD}=\frac{1}{1+L}\,U`) // 正號：e_PD = +H_PD·u
    expect(s3).toContain(String.raw`Y=L\,E_{PD}=T\,U`) // 正號：迴路的修正（輸出）= +T·u
    expect(s3).not.toMatch(/-\s*T\\,U|-H_\{PD\}\\,U/)
    expect(SECTION_SRC).not.toMatch(/DTC 在回授|回授路徑上的 DTC|divider 的 edge 經過 DTC|推回理想時刻/)
    // §2 的因果要寫對：DTC 在 reference 輸入端所以動不到 feedback edge（不是「因為只能延遲所以不去動它」）；ρ 越大延遲越短；T_0 至少要有補償量的最大值
    expect(s2).toContain('動不到 feedback edge')
    expect(s2).toContain('越大，DTC 的延遲越短')
    expect(s2).toContain('延遲不能是負的')
    expect(s2).toContain('被提前（少延遲）的時間')
    expect(s2).not.toMatch(/code 越大|不去動 feedback edge/)
    // 極性約定：本章的更新式是 w ← w + μ·q·r；「ε_k 記成晚到為正」的實作註記才出現減號的版本
    expect(s2).toContain(String.raw`w\leftarrow w+\mu\,q\,r`)
    expect(s2).toContain(String.raw`w_k\leftarrow w_k-\mu\,q\,r`)
    expect(s2.indexOf('晚到為正')).toBeGreaterThan(0)
    expect(s2.indexOf(String.raw`w_k\leftarrow w_k-\mu\,q\,r`)).toBeGreaterThan(s2.indexOf('晚到為正'))
    // 那個註記照算一次：ε′ = 晚到為正、w′ 加在 DTC 的延遲上 ⇒ t_ref′ − t_fb − T_0 = w′ − ε′；w′ ← w′ − μ·q·r 才往 ε′ 靠近，用加號會越走越遠
    for (const [epsLate, wLate] of [[0.3, 0.1], [0.3, 0.5], [-0.2, 0.05]]) {
      const T0 = 40
      const rhoD = 0.4 * 7.8125
      const tRef = T0 - rhoD + wLate // DTC 的延遲 = T_0 − ρΔ + w′
      const tFb = -rhoD + epsLate // feedback edge：早到 ρΔ、再晚到 ε′
      const e = tRef - tFb - T0
      expect(e).toBeCloseTo(wLate - epsLate, 12)
      const q = Math.sign(e)
      expect(Math.abs(wLate - 0.01 * q - epsLate)).toBeLessThan(Math.abs(wLate - epsLate))
      expect(Math.abs(wLate + 0.01 * q - epsLate)).toBeGreaterThan(Math.abs(wLate - epsLate))
    }
    // 其他提到接法的段落：§0.1、§14、§18、F-CS.1 的條件、實驗 A 的假設
    expect(src('S00Conclusion.tsx')).toContain('PD 的輸出（1-bit 比較器取的就是它，和送進 loop filter 的是同一個訊號）')
    expect(src('S14ClosedLoop.tsx')).toMatch(/DTC 的延遲是 <Tex>\{'T_0'\}<\/Tex> 減掉補償量/)
    expect(src('S16Wrapup.tsx')).toContain('那就是 PD 的輸出')
    expect(src('S16Wrapup.tsx')).toContain('再併進 DTC 的補償量')
    const f1 = FORMULAS.find((f) => f.id === 'F-CS.1')!
    expect(f1.tex).toContain(String.raw`e_{PD}=h_{PD}*u`)
    expect(f1.conditions).toContain('折算到 PD 的 reference 輸入端')
    expect(f1.conditions).toContain('$e_{PD}=u-y$')
    expect(readFileSync(join(DIR, 'experiments', 'HpdExplorer.tsx'), 'utf8')).toContain('折算到 PD 的 reference 輸入端')
    // 整個資料夾（測試以外的每一個檔案）都沒有舊接法的說法：和 src/data/architectureConvention.test.tsx 同一組規則
    const OLD_ARCHITECTURE: RegExp[] = [
      /DTC\s*(?:畫)?在\s*(?:divider|除頻器|回授|feedback)[^。；\n]{0,6}(?:之後|後面|路徑)|(?:divider|除頻器)\s*(?:之後|後面)的\s*DTC/,
      /(?:divider|除頻器|feedback|回授)[^。；\n]{0,10}edge[^。；\n]{0,6}(?:經過|送進|進入)\s*DTC/,
      /DTC[^。；\n]{0,8}(?:插入|施加|多施加)[^。；\n]{0,6}(?:的)?\s*(?:延遲|delay)/,
      /推回(?:理想|正確)/,
      /(?:feedback|回授)\s*(?:側|端|比較路徑)[^。；\n]{0,8}(?:注入|加進)/,
      /注入點在\s*PD\s*比較端/,
      /e_\{?\\?(?:mathrm\{)?PD\}?\}?\s*=\s*-\s*\(|e_PD\s*=\s*[−-]\s*\(/,
      /(?:θ_out|\\theta_\{?\\?(?:mathrm\{)?out\}?\}?)\s*=\s*[−-]\s*T/,
      /(?:e_PD|e_\{\\mathrm\{PD\}\})\s*=\s*[−-]\s*H/,
    ]
    const sourceFiles = [
      ...readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => join(DIR, f)),
      ...SECTION_FILES.map((f) => join(DIR, 'sections', f)),
      ...readdirSync(join(DIR, 'experiments')).filter((f) => f.endsWith('.tsx')).map((f) => join(DIR, 'experiments', f)),
    ]
    expect(sourceFiles.length).toBeGreaterThan(25)
    for (const file of sourceFiles) {
      const text = readFileSync(file, 'utf8')
      for (const re of OLD_ARCHITECTURE) expect(re.test(text), `${file}：${re.source}`).toBe(false)
    }
    // 符號表收了這次新出現的符號
    expect(SYMBOLS.some((x) => x.symbol.includes('T_0') && x.symbol.includes(String.raw`\tau_{DTC}`))).toBe(true)
    expect(SYMBOLS.some((x) => x.symbol.includes("t_{ref}'") && x.symbol.includes('t_{fb}'))).toBe(true)
    // ε_k 以「早到」為正、u 與 e_PD 的說明照新的接法寫
    const symbolsSrc = readFileSync(join(DIR, 'symbols.tsx'), 'utf8')
    expect(symbolsSrc).toContain('以 feedback edge「早到」為正')
    expect(symbolsSrc).toContain('注入在相位比較點（PD 的輸入端）的時間誤差：該補的量減掉 DTC 實際補上的量')
    expect(symbolsSrc).toContain('PD 的輸出：送進 loop filter、也送進比較器的殘差')
    expect(symbolsSrc).not.toMatch(/PD／比較器輸入的殘差/)
  })

  it('SSPLL: 取樣率——校正迴路的圖把 sample rate（n）與 block rate（k）分在兩個框；LMS 更新式的符號是「+」', async () => {
    const lms = await flow('lms-loop')
    const fast = lms.subs.find((s) => s.id === 'FAST')!
    const slow = lms.subs.find((s) => s.id === 'SLOW')!
    expect(fast.title).toContain('每個 sample $n$')
    expect(slow.title).toContain('每個 block $k$（$N$ 個 sample）')
    expect([...fast.nodes].sort()).toEqual(['AD', 'GZ', 'H', 'M1', 'M2', 'SG'])
    expect([...slow.nodes].sort()).toEqual(['ACC', 'AVG', 'MU'])
    expect(lms.node('ACC').text).toContain(String.raw`w_i[k+1] = w_i[k] + \mu\cdot G_i[k]`)
    expect(lms.node('DEL').text).toContain(String.raw`$\delta_j[k]$ = 真值 $- w_j[k]$`)
    expect(lms.edge('M1', 'H').text).toContain(String.raw`u[n] = \textstyle\sum_j \delta_j\cdot x_j[n]`)
    expect(lms.edge('SG', 'M2').text).toContain('q[n]')
    expect(lms.edge('GZ', 'M2').text).toBe('$r_i[n]$')
    expect(lms.edge('AVG', 'MU').text).toBe('$G_i[k]$')
    expect(signsInto(lms.edges, 'AD')).toEqual({ H: '＋', V: '＋' })
    // 迴圈是封閉的：累加器 → δ → 乘法點 → H_PD → … → 累加器
    for (const [a, b] of [['ACC', 'DEL'], ['DEL', 'M1'], ['M1', 'H'], ['H', 'AD'], ['AD', 'SG'], ['SG', 'M2'], ['M2', 'AVG'], ['AVG', 'MU'], ['MU', 'ACC']]) expect(lms.edge(a, b)).toBeTruthy()
    // 時序圖：D = 0 才是同一拍
    const { type, db } = await parsed(diagramById('align').def.chart)
    expect(type).toBe('sequence')
    const seq = db as SeqDb
    expect([...seq.getActors().values()].map((a) => a.description)).toEqual(['分數累加器', 'DTC／PMUX 與 SSPD', '1-bit 比較器', 'regressor 暫存器', 'GMAC'])
    const msgs = seq.getMessages().map((m) => m.message ?? '')
    // sequenceDiagram 用 Mermaid 原生的 `$$...$$`（每行一段公式，文字包在 \text{} 裡）
    expect(msgs).toContain('$$r[n] = x[n - D]$$')
    expect(msgs).toContain(String.raw`$$q[n] = \mathrm{sign}(e_{PD}[n] + v[n])$$`)
    // 兩則註解各折成兩行（單一個 `$$...$$`，用 gathered 換行），讓 5 個 actor 的時序圖放得進正文欄
    expect(msgs.some((m) => m === String.raw`$$\begin{gathered}D = 0\text{ 時 }q[n]\text{ 乘上同一拍的}\cr x[n]\text{（正確）}\end{gathered}$$`)).toBe(true)
    expect(msgs.some((m) => m === String.raw`$$\begin{gathered}D = +1\text{ 時 }q[n]\text{ 乘上前一拍的}\cr x[n - 1]\text{（有害）}\end{gathered}$$`)).toBe(true)
  })

  it('SSPLL: 小數相位的拆法——圖上的運算（frac → ×8 → floor、相減）重現 sspll.ts 的 phaseSequence', async () => {
    const ps = await flow('phase-split')
    expect(signsInto(ps.edges, 'S')).toEqual({ A: '＋', Z: '＋' })
    expect(signsInto(ps.edges, 'D')).toEqual({ X8: '＋', FL: '−' })
    expect(ps.edge('F', 'X8').text).toBe(String.raw`$\varphi[n] = \mathrm{frac}(n\alpha)$`)
    expect(ps.edge('FL', 'PM').text).toContain('p[n]')
    expect(ps.edge('D', 'DTC').text).toContain(String.raw`\rho[n] = 8\varphi[n] - p[n]`)
    expect(ps.node('OH').text).toContain(String.raw`\mathbf{1}\{p[n] = k\}`)
    expect(ps.node('X0').text).toContain(String.raw`x_0[n] = \rho[n]`)
    // 粗調在 PMUX（feedback 端，挪 p·Δ）；細調是 reference 端 DTC 的補償量 ρ·Δ（不是「DTC 的延遲」）
    expect(ps.node('PM').text).toContain(String.raw`粗調：$p[n]\cdot\Delta$`)
    expect(ps.node('DTC').text).toContain(String.raw`細調：補償量 $\rho[n]\cdot\Delta$`)
    // 照圖做一次（α = P/Q，用整數運算避免浮點累加誤差）：φ[n] = frac(φ[n−1] + α)，p = floor(8φ)，ρ = 8φ − p
    for (const [P, Q] of [[137, 1000], [21, 1000], [3, 10], [1, 50]] as const) {
      const ref = phaseSequence(P / Q, 60, 'right')
      let acc = 0 // φ[n] = acc/Q
      for (let n = 0; n < 60; n++) {
        if (n > 0) acc = (acc + P) % Q // 加法點 + frac(·) + z⁻¹
        const p = Math.floor((8 * acc) / Q) // × 8 → floor
        const rho = (8 * acc - p * Q) / Q // 8φ − p
        expect(p, `α=${P}/${Q} n=${n}`).toBe(ref.p[n])
        expect(rho, `α=${P}/${Q} n=${n}`).toBeCloseTo(ref.rho[n], 12)
        expect(rho).toBeGreaterThanOrEqual(0)
        expect(rho).toBeLessThan(1)
        expect(p).toBeLessThanOrEqual(7)
      }
    }
  })

  it('SSPLL: 迴路結構——積分器個數、Re L₂ 的兩條路徑、Re L₃ 的三條路徑、低頻近似 1/L、P-only 與一階差分的式子，數值上等於 sspll.ts 的模型', async () => {
    // §6 三個迴路：藍色方塊數 = 積分器個數 = 迴路的 type
    const tl = await flow('three-loops')
    const blue = (sub: string) => tl.subs.find((s) => s.id === sub)!.nodes.filter((n) => (tl.node(n).classes ?? []).includes('focus')).length
    expect(blue('LOOP1')).toBe(LOOPS.L1.type)
    expect(blue('LOOP2')).toBe(LOOPS.L2.type)
    expect(blue('LOOP3')).toBe(LOOPS.L3.type)
    expect(tl.subs.map((s) => s.title)).toEqual(['$L_1$：SSPLL Type-I（1 個積分器）', '$L_2$：SSPLL Type-II（2 個積分器）', '$L_3$：傳統 CPPLL（2 個積分器 + 1 個極點）'])
    const Kp = Number(LOOPS.L2.params.Kp)
    const Ki = Number(LOOPS.L2.params.Ki)
    const K = Number(LOOPS.L1.params.K)
    for (const f of [0.003, 0.021, 0.08, 0.25, 0.47]) {
      const W = 2 * Math.PI * f
      const z1: Complex = { re: Math.cos(W), im: -Math.sin(W) } // z⁻¹
      const one: Complex = { re: 1, im: 0 }
      const integ = cdiv(z1, { re: 1 - z1.re, im: -z1.im }) // z⁻¹/(1 − z⁻¹) = 1/(z − 1)
      const zm1: Complex = { re: Math.cos(W) - 1, im: Math.sin(W) } // z − 1
      expect(cAbs({ re: integ.re - cdiv(one, zm1).re, im: integ.im - cdiv(one, zm1).im })).toBeLessThan(1e-12)
      // L1 那一列：K · 1/(z−1)
      const L1 = loopL(LOOPS.L1, f)
      expect(cAbs({ re: L1.re - K * integ.re, im: L1.im - K * integ.im })).toBeLessThan(1e-9)
      // L2 那一列：(K_p + K_i/(1 − z⁻¹)) · 1/(z−1)
      const pi = cdiv(one, { re: 1 - z1.re, im: -z1.im })
      const L2 = loopL(LOOPS.L2, f)
      const L2fig = cMul({ re: Kp + Ki * pi.re, im: Ki * pi.im }, integ)
      expect(cAbs({ re: L2.re - L2fig.re, im: L2.im - L2fig.im })).toBeLessThan(1e-9 * (1 + cAbs(L2)))
      // 圖 re-l2：比例路徑的實部 −K_p/2、積分路徑的實部 −K_i/(4 sin²(Ω/2))
      const reP = -Kp / 2
      const reI = -Ki / (4 * Math.sin(W / 2) ** 2)
      expect(Kp * integ.re).toBeCloseTo(reP, 10)
      expect(cMul(integ, pi).re * Ki).toBeCloseTo(reI, 8)
      expect(reP + reI).toBeCloseTo(typeIIReL(Kp, Ki, f), 9)
      expect(L2.re).toBeCloseTo(reP + reI, 7)
      // 圖 onediff：(1 − z⁻¹)·L₂ = K_p·z⁻¹ + K_i·z⁻¹/(1 − z⁻¹)；g(Ω) = 1 − K_i/2 − (1 − K_p)·cos Ω
      const lhs = cMul({ re: 1 - z1.re, im: -z1.im }, L2)
      const rhs: Complex = { re: Kp * z1.re + Ki * integ.re, im: Kp * z1.im + Ki * integ.im }
      expect(cAbs({ re: lhs.re - rhs.re, im: lhs.im - rhs.im })).toBeLessThan(1e-9)
      expect(1 - Math.cos(W) + lhs.re).toBeCloseTo(typeIIOneDiffG(Kp, Ki, f), 9)
      expect(1 - Ki / 2 - (1 - Kp) * Math.cos(W)).toBeCloseTo(typeIIOneDiffG(Kp, Ki, f), 12)
      // 圖 p-only：校準期間 L = K_p/(z − 1)
      const Lp = loopL(makePOnlyL2(LOOPS.L2), f)
      expect(cAbs({ re: Lp.re - Kp * integ.re, im: Lp.im - Kp * integ.im })).toBeLessThan(1e-9)
    }
    // 圖 type1-variants：三個框標題裡的下限就是 F-CS.10 的判據；數值上 Re L 確實不低於它，而且在低頻逼近它
    const tv = await flow('type1-variants')
    expect(tv.subs.map((s) => s.title)).toEqual([
      String.raw`標稱 $L_1$（$d = 1$）：$\mathrm{Re}\,L = -K/2$，不會低於 $-1$（$K \lt 2$）`,
      String.raw`迴路共延遲 $d$ 拍：$\mathrm{Re}\,L$ 最低到 $-K\cdot(d - 1/2)$`,
      String.raw`多一個寄生極點 $p$：$\mathrm{Re}\,L$ 最低到 $-K\cdot(1/2 + p/(1 - p))$`,
    ])
    expect(tv.nodes.filter((v) => (v.classes ?? []).includes('warn')).map((v) => v.id).sort()).toEqual(['A4', 'B4'])
    for (const f of [1e-4, 0.01, 0.1, 0.3, 0.5]) {
      expect(loopL(LOOPS.L1, f).re).toBeCloseTo(-K / 2, 9)
      for (const d of [2, 4, 5]) {
        const lp = makeL1({ lat: d })
        expect(loopL(lp, f).re).toBeGreaterThanOrEqual(-typeILatencyCriterion(Number(lp.params.K), d) - 1e-9)
      }
      const lpP = makeL1({ fPoleHz: 250e6 })
      expect(loopL(lpP, f).re).toBeGreaterThanOrEqual(-typeIPoleCriterion(Number(lpP.params.K), Number(lpP.params.p)) - 1e-9)
    }
    {
      const lp = makeL1({ lat: 4 })
      expect(loopL(lp, 1e-4).re).toBeCloseTo(-typeILatencyCriterion(Number(lp.params.K), 4), 4)
      const lpP = makeL1({ fPoleHz: 250e6 })
      expect(loopL(lpP, 1e-4).re).toBeCloseTo(-typeIPoleCriterion(Number(lpP.params.K), Number(lpP.params.p)), 4)
    }
    const re = await flow('re-l2')
    expect(re.edge('P', 'S').text).toContain('-K_p/2')
    expect(re.edge('I', 'S').text).toContain(String.raw`-K_i/(4\sin^2(\Omega/2))`)
    expect(re.node('Q').text).toContain(String.raw`\mathrm{Re}\,L_2 \lt -1`)
    const od = await flow('onediff')
    // (1 − z⁻¹)·L₂ = K_p·z⁻¹ + K_i·z⁻¹/(1 − z⁻¹)：等號右邊的兩項分成兩行（第二行以 +  開頭），讓這一列放得進正文欄
    expect(od.node('B1').text).toContain(String.raw`$(1 - z^{-1})\cdot L_2 = K_p\cdot z^{-1}$`)
    expect(od.node('B1').text).toContain(String.raw`$+\,K_i\cdot z^{-1}/(1 - z^{-1})$`)
    expect(od.node('B2').text).toContain(String.raw`g(\Omega) = 1 - K_i/2 - (1 - K_p)\cdot\cos\Omega`)
    expect(od.node('B3').text).toContain(String.raw`K_i \le 2K_p$ 且 $K_p + K_i/2 \le 2`)
    const po = await flow('p-only')
    expect(po.node('N').text).toContain('L = K_p/(z-1)')
    expect(signsInto(po.edges, 'S')).toEqual({ KP: '＋', KI: '＋' })
    // 低頻的差分次數：Type-II 兩次、Type-I 一次
    const lf = await flow('lowfreq')
    const diffs = (sub: string) => lf.subs.find((s) => s.id === sub)!.nodes.filter((n) => (lf.node(n).text ?? '').includes('1 - z^{-1}')).length
    expect(diffs('TYPE2')).toBe(2)
    expect(diffs('TYPE1')).toBe(1)
    // 圖 lowfreq 的最後一格除法含迴路的 1 拍延遲：1/L₂ ≈ (1 − z⁻¹)²/(K_i·z⁻¹)、1/L₁ = (1 − z⁻¹)/(K·z⁻¹)
    expect(lf.node('C2').text).toContain(String.raw`\div\,(K_i\cdot z^{-1})`)
    expect(lf.node('C1').text).toContain(String.raw`\div\,(K\cdot z^{-1})`)
    expect(lf.node('E2').text).toContain('中心二次差分')
    for (const f of [1e-4, 3e-4]) {
      const W = 2 * Math.PI * f
      const z1: Complex = { re: Math.cos(W), im: -Math.sin(W) }
      const d: Complex = { re: 1 - z1.re, im: -z1.im } // 1 − z⁻¹
      // Type-II：照圖串起來 (1 − z⁻¹)·(1 − z⁻¹) ÷ (K_i·z⁻¹)；它是純實數 −4 sin²(Ω/2)/K_i（中心二次差分），而且就是低頻的 H_PD
      const fig2 = cdiv(cMul(d, d), { re: Ki * z1.re, im: Ki * z1.im })
      expect(fig2.re).toBeCloseTo((-4 * Math.sin(W / 2) ** 2) / Ki, 12)
      expect(Math.abs(fig2.im)).toBeLessThan(1e-12)
      expect(fig2.re).toBeLessThan(0)
      const r2 = cdiv(loopH(LOOPS.L2, f), fig2)
      expect(Math.hypot(r2.re - 1, r2.im), `L2 f=${f}`).toBeLessThan(0.02)
      // Type-I：(1 − z⁻¹) ÷ (K·z⁻¹)，主要是純虛數（與 u 差 90°）
      const fig1 = cdiv(d, { re: K * z1.re, im: K * z1.im })
      expect(Math.abs(fig1.re)).toBeLessThan(0.01 * Math.abs(fig1.im))
      const r1 = cdiv(loopH(LOOPS.L1, f), fig1)
      expect(Math.hypot(r1.re - 1, r1.im), `L1 f=${f}`).toBeLessThan(0.02)
    }
    // 圖 re-l3：l(t) = K·t + B·(1 − e^(−ω_p·t)) 每拍讀一次 ⇒ 三條路徑；實部相加取負號 = F-CS.9 的 −Re L₃（sspll.ts 的 cppllMinusReL）
    const r3 = await flow('re-l3')
    expect(r3.node('LT').text).toContain(String.raw`l(t) = K\cdot t + B\cdot(1 - e^{-\omega_p t})`)
    expect(r3.node('R').text).toContain(String.raw`K\cdot z^{-1}/(1 - z^{-1})^2`)
    expect(r3.node('ST').text).toContain(String.raw`B\cdot z^{-1}/(1 - z^{-1})`)
    expect(r3.node('EX').text).toContain(String.raw`-B\cdot p\cdot z^{-1}/(1 - p\cdot z^{-1})`)
    expect(r3.edge('R', 'S').text).toContain(String.raw`-K/(4\sin^2(\Omega/2))`)
    expect(r3.edge('ST', 'S').text).toContain('-B/2')
    expect(r3.edge('EX', 'S').text).toContain(String.raw`-B\cdot p\cdot(\cos\Omega - p)/(1 - 2p\cdot\cos\Omega + p^2)`)
    expect(r3.node('Q').text).toContain(String.raw`\mathrm{Re}\,L_3 \lt -1`)
    expect((r3.node('R').classes ?? []).includes('focus')).toBe(true)
    const p3 = LOOPS.L3.params
    const K3 = Number(p3.K)
    const B3 = Number(p3.B)
    const pp = Number(p3.p)
    expect(pp).toBeCloseTo(Math.exp(-Number(p3.wp)), 14)
    // L₃(z) = Σ_{n≥1} l(n)·z⁻ⁿ：bL/aL 的長除法（脈衝響應）就是 l(n) = K·n + B·(1 − pⁿ)，l(0) = 0
    {
      const { bL, aL } = LOOPS.L3
      const l: number[] = []
      for (let n = 0; n <= 12; n++) {
        let v = bL[n] ?? 0
        for (let k = 1; k <= n; k++) v -= (aL[k] ?? 0) * l[n - k]
        l.push(v / aL[0])
      }
      expect(Math.abs(l[0])).toBeLessThan(1e-14)
      for (let n = 1; n <= 12; n++) expect(l[n], `l(${n})`).toBeCloseTo(K3 * n + B3 * (1 - pp ** n), 10)
    }
    for (const f of [0.003, 0.021, 0.08, 0.25, 0.47]) {
      const W = 2 * Math.PI * f
      const z1: Complex = { re: Math.cos(W), im: -Math.sin(W) }
      const integ = cdiv(z1, { re: 1 - z1.re, im: -z1.im }) // z⁻¹/(1 − z⁻¹)
      const dbl = cdiv(integ, { re: 1 - z1.re, im: -z1.im }) // z⁻¹/(1 − z⁻¹)²
      const pole = cdiv({ re: pp * z1.re, im: pp * z1.im }, { re: 1 - pp * z1.re, im: -pp * z1.im }) // p·z⁻¹/(1 − p·z⁻¹)
      const L3 = loopL(LOOPS.L3, f)
      const L3fig: Complex = { re: K3 * dbl.re + B3 * integ.re - B3 * pole.re, im: K3 * dbl.im + B3 * integ.im - B3 * pole.im }
      expect(cAbs({ re: L3.re - L3fig.re, im: L3.im - L3fig.im }), `L3 f=${f}`).toBeLessThan(1e-9 * (1 + cAbs(L3)))
      // 三條連線上寫的實部
      const reR = -K3 / (4 * Math.sin(W / 2) ** 2)
      const reS = -B3 / 2
      const reE = (-B3 * pp * (Math.cos(W) - pp)) / (1 - 2 * pp * Math.cos(W) + pp * pp)
      expect(K3 * dbl.re).toBeCloseTo(reR, 7)
      expect(B3 * integ.re).toBeCloseTo(reS, 10)
      expect(-B3 * pole.re).toBeCloseTo(reE, 10)
      expect(reR + reS + reE).toBeCloseTo(-cppllMinusReL(p3, f), 9)
      expect(L3.re).toBeCloseTo(reR + reS + reE, 7)
    }
  })

  it('SSPLL: 圖上的數字——PHOS 各模態的基波權重、鋸齒的諧波功率、玩具模型的 g、alias 的慢方波、offset 的 E[q]，都由 sspll.ts 重現', async () => {
    const pm = await flow('phos-modes')
    expect(pm.node('M1').text).toContain(String.raw`權重 $W_1 \approx ${W1.toFixed(2)}$`)
    expect(pm.node('M2').text).toContain(String.raw`權重 $\approx ${(64 * indicatorLineWeight(2)).toFixed(2)}$`)
    expect(pm.node('M3').text).toContain(String.raw`權重 $\approx ${(64 * indicatorLineWeight(3)).toFixed(2)}$`)
    expect(pm.node('M4').text).toContain(String.raw`權重 $\approx ${(64 * (indicatorLineWeight(4) + indicatorLineWeight(-4))).toFixed(2)}$`)
    expect(64 * (indicatorLineWeight(4) + indicatorLineWeight(-4))).toBeCloseTo(W_SQUARE, 12)
    expect(64 * indicatorLineWeight(1)).toBeCloseTo(W1, 12)
    expect(pm.node('M0').text).toContain(String.raw`\lambda_0 = 0`)
    expect(pm.edges.filter((e) => e.start === 'F')).toHaveLength(5) // 共模 + mode 1…4（5、6、7 是 3、2、1 的共軛）
    // 鋸齒：第 m 次諧波（±mβ 兩條線合計）的功率 1/(2π²m²)；全部加起來是 var(ρ) = 1/12 ⇒ κ_GOS = 12·C_GOS
    const gos = await flow('gos')
    expect(gos.node('M1').text).toContain(String.raw`功率 $1/(2\pi^2)$`)
    expect(gos.node('M2').text).toContain(String.raw`功率 $1/(8\pi^2)$`)
    expect(sawtoothLinePower(1)).toBeCloseTo(1 / (2 * Math.PI ** 2), 15)
    expect(sawtoothLinePower(2)).toBeCloseTo(1 / (8 * Math.PI ** 2), 15)
    let sum = 0
    for (let m = 1; m <= 200000; m++) sum += sawtoothLinePower(m)
    expect(12 * sum).toBeCloseTo(1, 4)
    expect(gos.node('C').text).toContain(String.raw`\kappa_{GOS} = 12\cdot C_{GOS}`)
    expect(gos.edge('D0', 'S').text).toContain(String.raw`\Gamma_{\rm eff}(0) = 0`)
    // 玩具模型：g = +1 往 a 走，g = −0.2 每一步都遠離 a
    const toy = await flow('toy')
    expect(toy.node('A2').text).toContain('g = +1')
    expect(toy.node('B2').text).toContain('g = -0.2')
    const a = 1
    expect(Math.abs(a - toySignLmsStep(0, a, 1, 0.1, +1).w)).toBeLessThan(Math.abs(a - 0))
    expect(Math.abs(a - toySignLmsStep(0, a, 1, 0.1, -0.2).w)).toBeGreaterThan(Math.abs(a - 0))
    // 圖上寫的是 e = g·δ·x：q 與 δ·x 同號（g > 0）或反號（g < 0），x 是正是負都一樣；更新 μ·q·x 的方向只看 g 的符號
    for (const row of ['A', 'B']) {
      expect(toy.node(`${row}1`).text).toContain(String.raw`\delta = a - w`)
      expect(toy.node(`${row}3`).text).toContain(String.raw`e = g\cdot\delta\cdot x`)
      expect(toy.node(`${row}4`).text).toContain(String.raw`w \leftarrow w + \mu\cdot q\cdot x`)
    }
    expect(toy.node('A3').text).toContain(String.raw`與 $\delta\cdot x$ 同號`)
    expect(toy.node('B3').text).toContain(String.raw`與 $\delta\cdot x$ 反號`)
    for (const x of [1, -1, 2]) {
      for (const g of [1, -0.2]) {
        const s = toySignLmsStep(0, a, x, 0.1, g)
        expect(s.e).toBeCloseTo(g * (a - 0) * x, 15)
        expect(s.q, `x=${x} g=${g}`).toBe(Math.sign(g) * Math.sign((a - 0) * x))
        expect(Math.abs(a - s.w) < Math.abs(a - 0), `x=${x} g=${g}`).toBe(g > 0)
      }
    }
    // 圖 alias：α 靠近 1/4 時，mode 4 的 regressor (−1)^p[n] 是 frac(4φ[n]) 的方波，而 frac(4φ[n]) = frac(4·(α − 1/4)·n)——頻率 4·|α − 1/4|
    const al = await flow('alias')
    expect(al.node('M4').text).toContain(String.raw`(-1)^{p[n]}`)
    expect(al.node('M4').text).toContain(String.raw`\mathrm{frac}(4\varphi[n]) \lt 1/2$ 時是 $+1$，否則 $-1`)
    expect(al.node('SQ').text).toContain(String.raw`基波權重 $8/\pi^2 \approx ${W_SQUARE.toFixed(2)}$`)
    expect(al.node('SQ').text).toContain(String.raw`4\cdot\lvert\alpha - 1/4\rvert\cdot f_{ref}`)
    expect(al.node('Q').text).toContain(String.raw`\lvert\alpha - 1/4\rvert\cdot f_{ref} \lt f_{inv}/4`)
    expect(al.node('DZ').text).toContain(String.raw`${W_SQUARE.toFixed(2)}\cdot\min\mathrm{Re}\,H_{PD} + ${(1 - W_SQUARE).toFixed(2)}\cdot\max\mathrm{Re}\,H_{PD} \gt 0`)
    expect((al.node('DZ').classes ?? []).includes('warn')).toBe(true)
    for (const [P, Q] of [[101, 400], [99, 400], [251, 1000], [63, 256]] as const) {
      const ref = phaseSequence(P / Q, Q, 'right')
      let cr = 0
      let ci = 0
      for (let n = 0; n < Q; n++) {
        const a4 = (4 * P * n) % Q // frac(4φ[n]) = a4/Q
        expect((((4 * P - Q) * n) % Q + Q) % Q, `α=${P}/${Q} n=${n}`).toBe(a4) // 整數的 1 看不到，只剩偏移 4·(α − 1/4)
        const sq = 2 * a4 < Q ? 1 : -1
        expect(ref.p[n] % 2 === 0 ? 1 : -1, `α=${P}/${Q} n=${n}`).toBe(sq)
        const th = (-2 * Math.PI * (4 * P - Q) * n) / Q // 基波頻率 4·(α − 1/4)
        cr += sq * Math.cos(th)
        ci += sq * Math.sin(th)
      }
      // ±基波兩條線的功率合計 ≈ 8/π²（方波的總功率是 1）
      expect((2 * (cr * cr + ci * ci)) / (Q * Q), `α=${P}/${Q}`).toBeCloseTo(W_SQUARE, 2)
    }
    // α 靠近 1/2：mode 2 的 regressor (−j)^p[n] 只看 p mod 4 = floor(4·frac(2φ))，frac(2φ[n]) = frac(2·(α − 1/2)·n)——頻率 2·|α − 1/2|
    expect(al.node('HALF').text).toContain(String.raw`2\cdot\lvert\alpha - 1/2\rvert\cdot f_{ref}`)
    expect(al.node('HALF').text).toContain(String.raw`4\cdot\lvert\alpha - 1/2\rvert\cdot f_{ref}`)
    for (const [P, Q] of [[201, 400], [199, 400]] as const) {
      const ref = phaseSequence(P / Q, Q, 'right')
      for (let n = 0; n < Q; n++) {
        const a2 = (((2 * P - Q) * n) % Q + Q) % Q
        expect(ref.p[n] % 4, `α=${P}/${Q} n=${n}`).toBe(Math.floor((4 * a2) / Q))
        expect(ref.p[n] % 2 === 0, `α=${P}/${Q} n=${n}`).toBe(2 * ((((4 * P - 2 * Q) * n) % Q + Q) % Q) < Q)
      }
    }
    // 紅色那一格的不等式：就算基波在 Re H_PD 最負的頻率，上界仍為正（L2、L3 都成立）
    for (const k of ['L2', 'L3'] as const) {
      expect(SURE[k].minReH).toBeLessThan(0)
      expect(W_SQUARE * SURE[k].minReH + (1 - W_SQUARE) * SURE[k].maxReH, k).toBeGreaterThan(0)
    }
    // offset：E[q] = erf(u_os/(√2·σ_v))
    const off = await flow('offset')
    expect(off.edge('SG', 'M').text).toContain(String.raw`E[q] = \mathrm{erf}(u_{os}/(\sqrt{2}\cdot\sigma_v))`)
    expect(eqOffset(25, 200)).toBeCloseTo(erf(25 / (Math.SQRT2 * 200)), 12)
    // 有限步長：|1 − κ/N_τ| < 1 ⟺ Re κ > |κ|²/(2 N_τ)（圖上菱形的兩種寫法是同一件事）
    for (const [kr, ki, tau] of [[0.02, 0.9, 25], [0.02, 0.9, 5], [0.3, 0.2, 5], [-0.1, 0, 25], [1.9, 0, 1]] as const) {
      const lhs = Math.hypot(1 - kr / tau, ki / tau) < 1
      expect(lhs, `κ=${kr}+${ki}j τ=${tau}`).toBe(kr > (kr * kr + ki * ki) / (2 * tau))
      expect(blockMeanStable([{ re: kr, im: ki }], tau)).toBe(lhs)
    }
    // §14 內文引用的程式片段確實在網站執行的原始碼裡（signLmsBlock region）
    const region = extractRegion(MODEL_SRC, 'signLmsBlock')
    for (const [k, code] of Object.entries(SIM_LOOP_CODE)) expect(region, k).toContain(code)
  })

  it('SSPLL: near-grid 的慢鋸齒（斜坡 + wrap）與延遲 d 拍的一階差分——圖上的式子由 sspll.ts 的步階響應、gosSmallBeta、oneDiffMargin 重現', async () => {
    const K = Number(LOOPS.L1.params.K)
    const Ki = Number(LOOPS.L2.params.Ki)
    // 圖 near-grid：兩條路都以「＋」進加法點，相加就是 F-CS.12
    const ng = await flow('near-grid')
    expect(signsInto(ng.edges, 'S')).toEqual({ T1: '＋', T2: '＋' })
    expect(ng.edge('RAMP', 'T1').text).toContain(String.raw`\beta\cdot S_\infty`)
    expect(ng.edge('WRAP', 'T2').text).toContain('-s[m]')
    expect(ng.edge('T1', 'S').text).toContain(String.raw`\beta\cdot S_\infty/2`)
    expect(ng.edge('T2', 'S').text).toContain(String.raw`-\beta\cdot S_D - \beta^2\cdot\textstyle\sum m\cdot s[m]`)
    expect(ng.node('T2').text).toContain('x[n - D]')
    expect(ng.node('C').text).toContain(String.raw`C_{GOS} \approx (\beta/2)\cdot(S_\infty - 2\cdot S_D) - \beta^2\cdot\textstyle\sum m\cdot s[m]`)
    expect(ng.node('I1').text).toContain(String.raw`S_\infty = 1/K`)
    expect(ng.node('I1').text).toContain(String.raw`+\beta/(2K)`)
    expect(ng.node('I2').text).toContain(String.raw`+\beta^2/K_i`)
    expect(ng.node('I3').text).toContain('S_D = s[0] = 1')
    expect(ng.node('I3').text).toContain(String.raw`-\beta`)
    expect((ng.node('I3').classes ?? []).includes('warn')).toBe(true)
    // 步階響應 s[n] 的三個總和：Type-I 的 S∞ = 1/K；Type-II 的 S∞ = 0、Σ m·s[m] = −1/K_i；s[0] = h_PD[0] = 1
    const sum = (v: Float64Array, w: (m: number) => number = () => 1) => v.reduce((acc, x, m) => acc + w(m) * x, 0)
    const s1 = loopStep(LOOPS.L1, 4000)
    const s2 = loopStep(LOOPS.L2, 4000)
    expect(s1[0]).toBe(1)
    expect(s2[0]).toBe(1)
    expect(sum(s1)).toBeCloseTo(1 / K, 9)
    expect(Math.abs(sum(s2))).toBeLessThan(1e-9)
    expect(sum(s2, (m) => m)).toBeCloseTo(-1 / Ki, 6)
    for (const P of [256, 1024]) {
      const beta = 1 / P
      // 照圖相加：(β/2)·(S∞ − 2·S_D) − β²·Σ m·s[m]
      const fig = (s: Float64Array, D: number) => (beta / 2) * (sum(s) - 2 * sum(s.subarray(0, D))) - beta * beta * sum(s, (m) => m)
      // 圖上最下面三格是它的首項：Type-I β/(2K)；Type-II、D = 0 β²/K_i；Type-II、D = 1 −β（β² 項是修正：1 − β/K_i 倍）
      expect(fig(s1, 0) / (beta / (2 * K)), `L1 β=1/${P}`).toBeGreaterThan(0.97)
      expect(fig(s1, 0) / (beta / (2 * K)), `L1 β=1/${P}`).toBeLessThan(1)
      expect(fig(s2, 0)).toBeCloseTo((beta * beta) / Ki, 12)
      expect(fig(s2, 1)).toBeLessThan(0)
      expect(fig(s2, 1) / -beta).toBeCloseTo(1 - beta / Ki, 8)
      expect(gosSmallBeta(LOOPS.L1, beta, 0)).toBeCloseTo(beta / (2 * K), 9)
      expect(gosSmallBeta(LOOPS.L2, beta, 0)).toBeCloseTo((beta * beta) / Ki, 15)
      expect(gosSmallBeta(LOOPS.L2, beta, 1)).toBeCloseTo(-beta, 9)
      // 與 golden 的精確週期解（params.json 的 gos_small_beta）相比：Type-II 兩種延遲都對到 6 位以上，Type-I 在 1% 內
      const e1 = PARAMS.gos_small_beta.L1.find((g) => g.P === P)!
      const e2 = PARAMS.gos_small_beta.L2.find((g) => g.P === P)!
      expect(e1.beta).toBe(beta)
      expect(Math.abs(fig(s1, 0) / e1.C_D0 - 1), `L1 β=1/${P}`).toBeLessThan(0.01)
      expect(Math.abs(fig(s2, 0) / e2.C_D0 - 1), `L2 D=0 β=1/${P}`).toBeLessThan(1e-6)
      expect(Math.abs(fig(s2, 1) / e2.C_D1 - 1), `L2 D=1 β=1/${P}`).toBeLessThan(1e-6)
      expect(e1.C_D0).toBeGreaterThan(0)
      expect(e2.C_D0).toBeGreaterThan(0)
      expect(e2.C_D1).toBeLessThan(0)
    }

    // 圖 onediff-delay：(1 − z⁻¹)·L = K·z^(−d) ⇒ g(Ω) = 1 − cos Ω + K·cos(d·Ω)
    const odd = await flow('onediff-delay')
    expect(odd.subs.map((s) => s.title)).toEqual(['Type-I、延遲 1 拍（標稱 $L_1$）', String.raw`Type-I、延遲 $d$ 拍（$d \ge 2$）`])
    expect(odd.node('P1').text).toContain(String.raw`(1 - z^{-1})\cdot L = K\cdot z^{-1}`)
    expect(odd.node('G1').text).toContain(String.raw`1 - (1 - K)\cdot\cos\Omega`)
    expect(odd.node('R1').text).toContain(String.raw`\min(K, 2 - K) \gt 0`)
    expect(odd.node('P2').text).toContain(String.raw`(1 - z^{-1})\cdot L = K\cdot z^{-d}`)
    expect(odd.node('G2').text).toContain(String.raw`g(\Omega) = 1 - \cos\Omega + K\cdot\cos(d\cdot\Omega)`)
    expect(odd.node('R2').text).toContain(String.raw`g = 1 - \cos(\pi/d) - K`)
    expect(odd.nodes.filter((v) => (v.classes ?? []).includes('warn')).map((v) => v.id).sort()).toEqual(['P2', 'R2'])
    for (const d of [1, 2, 3, 4, 5]) {
      const lp = makeL1({ lat: d })
      const Kd = Number(lp.params.K)
      let gMin = Infinity
      for (let i = 1; i <= 2000; i++) {
        const f = (0.5 * i) / 2000
        const W = 2 * Math.PI * f
        const L = loopL(lp, f)
        const gNum = 1 - Math.cos(W) + ((1 - Math.cos(W)) * L.re - Math.sin(W) * L.im) // 1 − cos Ω + Re{(1 − e^{−jΩ})·L}
        const gFig = 1 - Math.cos(W) + Kd * Math.cos(d * W)
        expect(gNum, `d=${d} f=${f}`).toBeCloseTo(gFig, 8)
        gMin = Math.min(gMin, gFig)
      }
      const margin = oneDiffMargin(lp).min
      expect(Math.abs(gMin - margin), `d=${d}`).toBeLessThan(2e-3)
      if (d === 1) {
        expect(gMin).toBeCloseTo(Math.min(Kd, 2 - Kd), 4)
        expect(margin).toBeGreaterThan(0)
      } else {
        const gPi = 1 - Math.cos(Math.PI / d) - Kd // 圖上寫的那一點
        expect(gMin).toBeLessThanOrEqual(gPi + 1e-4)
        if (Kd > 1 - Math.cos(Math.PI / d)) expect(margin, `d=${d}`).toBeLessThan(0)
      }
    }
    // 內文表格：延遲 5 拍時 margin 為負
    expect(oneDiffMargin(makeL1({ lat: 5 })).min).toBeLessThan(0)
  })

  it('SSPLL: 對策並排的圖——六個 G 的寫法與 sspll.ts 的 regressor 變體一致；綠＝推薦、紅＝有害', async () => {
    const rg = await flow('remedy-g')
    const cls = (id: string) => (rg.node(id).classes ?? []).join(',')
    expect(rg.node('RAW').text).toContain('G = 1')
    expect(rg.node('D1').text).toContain(String.raw`G = 1 - z^{-1}`)
    expect(rg.node('D1').text).toContain('r[n] = x[n] - x[n-1]')
    expect(rg.node('FX').text).toContain(String.raw`G = \hat H_{PD}(z)`)
    expect(rg.node('DK').text).toContain('r[n] = x[n - D]')
    expect(rg.node('D2').text).toContain(String.raw`G = (1 - z^{-1})^2`)
    expect([cls('RAW'), cls('ZM'), cls('D1'), cls('FX'), cls('DK'), cls('D2')]).toEqual(['', 'focus', 'ok', 'ok', 'warn', 'warn'])
    // 六個變體共用同一個輸入與同一個 GMAC
    expect(rg.edges.filter((e) => e.start === 'X').map((e) => e.end).sort()).toEqual(['D1', 'D2', 'DK', 'FX', 'RAW', 'ZM'])
    expect(rg.edges.filter((e) => e.end === 'R').map((e) => e.start).sort()).toEqual(['D1', 'D2', 'DK', 'FX', 'RAW', 'ZM'])
    // 與 sspll.ts 的註解（網站實際執行的函式）對得上
    for (const s of ['r[n] = x[n]（G = 1）', 'r[n] = x[n] − x[n−1]（G = 1 − z⁻¹）', 'r[n] = x[n − D]（G = z^-D）', 'G = (1 − z⁻¹)²', 'r = ĥ_PD * x（G = Ĥ_PD）']) expect(MODEL_SRC, s).toContain(s)
    // 圖 joint 上寫的「沒有只在 joint 出現的反號」就是 golden 掃描的結果
    for (const k of LOOP_KEYS) expect(DOC_JOINT.joint_scan[k].n_joint_only, k).toBe(0)
    // keep-out 流程：三個檢查都通往「列入 keep-out」，用 1diff／fx 則直接結束
    const ko = await flow('keepout')
    expect(ko.edges.filter((e) => e.end === 'KO').map((e) => e.start).sort()).toEqual(['B', 'C', 'D'])
    expect(ko.edge('R', 'FREE').text).toBe('是')
    expect(ko.edge('D', 'SAFE').text).toBe('否')
  })
})

describe('案例頁 /case/sspll 的方塊圖：不只 parser——mermaid 真的把每一張圖畫成 SVG', () => {
  // jsdom 沒有文字量測：用共用的 installMermaidSvgShim 補上，讓整條 render 流程（parser → 版面 → SVG）跑完，
  // 再用共用的 renderMermaidForTest 逐張畫出來。版面的實際長相要在瀏覽器看，這裡確認畫得出來、文字沒有被跳脫壞、沒有 Unsupported markdown。
  beforeAll(installMermaidSvgShim)

  it('SSPLL: 37 張圖都畫得出 SVG；沒有 Unsupported markdown、沒有殘留的 `$`、KaTeX 以外沒有 Unicode 拼的數學、節點數 ≤ 14；每個節點的文字都在圖上，「<」沒有被重複跳脫', async () => {
    // 系統地圖是手排的 SVG，不經過 Mermaid，所以這裡只畫本章登錄的 37 張圖
    const all = DIAGRAMS
    for (const d of all) {
      const { svg, text, nodeCount, mathCount, plainText } = await renderMermaidForTest(d.chart)
      expect(svg, d.id).toMatch(/^<svg/)
      expect(svg, d.id).not.toMatch(/Syntax error|&amp;lt;|&amp;gt;/)
      // Mermaid 11 把標籤當 Markdown：以「+ 」「- 」「1. 」開頭會變成「Unsupported markdown: list」；底線、星號不可被當成強調
      expect(text, d.id).not.toMatch(/Unsupported markdown/)
      expect(svg, d.id).not.toMatch(/<em>|<strong>|<code>/)
      // 圖內的數學都由 KaTeX 排版：畫出來的文字沒有殘留 `$`、TeX 指令名稱或 HTML entity（`<` 要寫 \lt，否則 strict 模式的跳脫會讓 KaTeX 讀到 &lt;）
      expect(text, d.id).not.toContain('$')
      expect(text, d.id).not.toMatch(/\\[A-Za-z]|&lt;|&gt;|&amp;/)
      // 每個含 `$` 的標籤（節點、連線、subgraph 標題）都排成一個 KaTeX 公式——標題與連線標籤也不例外
      expect(mathCount, `${d.id}：含公式的標籤數 = KaTeX 公式數`).toBe(mathLabelCount(d.chart))
      expect(mathCount, d.id).toBeGreaterThan(0)
      // KaTeX 以外的文字沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k 這類底線下標）
      expect(unicodeMathIn(plainText), `${d.id}：KaTeX 以外的 Unicode 數學`).toEqual([])
      if (d.id === 'align') continue
      expect(nodeCount, d.id).toBeLessThanOrEqual(14)
      expect(nodeCount, d.id).toBeGreaterThanOrEqual(5)
      const drawn = text.replace(/\s+/g, '')
      // 每個節點、每條有標籤的連線、每個 subgraph 標題的文字都出現在 SVG 上；含公式的標籤檢查 `$...$` 以外的文字部分
      const f = await flow(d.id)
      expect(nodeCount, `${d.id}：畫出來的節點數 = 解析出來的節點數`).toBe(f.nodes.length)
      for (const t of [...f.nodes.map((v) => v.text ?? ''), ...f.edges.map((e) => e.text), ...f.subs.map((s) => s.title)]) {
        for (const piece of t.split(/\$[^$]*\$/)) {
          const want = piece.replace(/<br\s*\/?>/gi, '').replace(/\s+/g, '')
          if (want) expect(drawn, `${d.id}：${t}`).toContain(want)
        }
      }
    }
  }, 600000)
})

describe('案例頁 /case/sspll：頁面真的把圖畫出來，符號表在最後', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('SSPLL: <PageMap> 渲染全站共用的 <SystemMap>（手排 SVG、不經過 Mermaid），藍色標出本章的方塊', async () => {
    const spy = vi.spyOn(mermaid, 'render').mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"><g></g></svg>`, diagramType: 'flowchart-v2' }))
    const { container } = render(<PageMap />)
    const fig = container.querySelector('figure.c-mermaid.c-sysmap') as HTMLElement
    expect(fig).not.toBeNull()
    expect(fig.getAttribute('aria-label')).toMatch(/系統方塊圖/)
    // aria-label 是純文字：方塊名稱裡的 `$...$` 只拿掉分隔符號
    for (const b of MAP_FOCUS) expect(fig.getAttribute('aria-label'), b).toContain(stripMathDelimiters(SYSTEM_BLOCK_LABEL[b]))
    // 資料模型：被標成主角的方塊恰好是本章的 MAP_FOCUS（reference 輸入端的 DTC + 整個主 PLL 迴路 + 小數累加器與 regressor + 比較器、對齊、GMAC）
    const model = systemMapModel(MAP_FOCUS)
    expect(model.blocks.filter((b) => b.focused).map((b) => b.id).sort()).toEqual([...MAP_FOCUS].sort())
    // DOM：手排的 SVG 立刻就在，主角方塊帶 is-focus／data-focus，其餘方塊沒有
    expect(container.querySelector('.c-mermaid-svg svg.c-sysmap-svg')).not.toBeNull()
    const focusDom = Array.from(container.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
    expect([...focusDom].sort()).toEqual([...MAP_FOCUS].sort())
    for (const g of Array.from(container.querySelectorAll('g.c-sysmap-block.is-focus'))) expect(g.getAttribute('data-focus')).toBe('true')
    expect(container.querySelectorAll('g.c-sysmap-block:not(.is-focus)')).toHaveLength(model.blocks.length - MAP_FOCUS.length)
    expect(container.textContent).toMatch(/藍色方塊是本章的主角/)
    expect(container.textContent).toMatch(/input DTC/)
    // 地圖和本章的晶片是同一種接法：章首的說明講 PD 的輸出，不再說「DTC 畫在 divider 之後」
    expect(container.textContent).toMatch(/LMS 校正迴路的輸入取自 PD 的輸出/)
    expect(container.textContent).not.toMatch(/divider 之後/)
    expect(fig.getAttribute('aria-label')).toMatch(/DTC 在 reference 輸入端；LMS 的輸入取自 PD 的輸出/)
    // 系統地圖不再交給 Mermaid 畫
    await new Promise((r) => setTimeout(r, 50))
    expect(spy).not.toHaveBeenCalled()
  })

  it('SSPLL: 整頁——系統地圖在開場問題之後；37 張圖依登錄順序出現、各有圖號與圖說；符號表是最後一塊，章首只留一行連結', async () => {
    const spy = vi.spyOn(mermaid, 'render').mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"><g></g></svg>`, diagramType: 'flowchart-v2' }))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    localStorage.setItem('lmspll.mode', 'engineer')
    const { container, unmount } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/case/sspll']}>
          <CaseSspllPage />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const page = container.querySelector('.case-sspll') as HTMLElement
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) // b 在 a 之後

    // ── 系統地圖：緊接在開場問題之後，在「本頁設定」、目錄與 §0 之前
    const figures = Array.from(page.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(DIAGRAMS.length + 1)
    const map = figures[0]
    expect(map.getAttribute('aria-label')).toMatch(/系統方塊圖/)
    expect(map.closest('.cs-map')).not.toBeNull()
    expect(page.querySelector('.cs-question')!.nextElementSibling).toBe(map.closest('.cs-map'))
    expect(after(map, page.querySelector('.cs-lead')!)).toBe(true)
    expect(after(map, page.querySelector('nav')!)).toBe(true)
    expect(after(map, page.querySelector('#cs-0')!)).toBe(true)

    // ── 37 張圖：DOM 順序 = 登錄順序；圖說帶圖號；所在段落與登錄的 section 相符
    const boxes = Array.from(page.querySelectorAll('[data-diagram]'))
    expect(boxes.map((b) => b.getAttribute('data-diagram'))).toEqual(DIAGRAMS.map((d) => d.id))
    DIAGRAMS.forEach((d, i) => {
      const figcap = boxes[i].querySelector('figcaption')!
      const cap = figcap.textContent ?? ''
      expect(cap.startsWith(`圖 CS-${i + 1}｜`), d.id).toBe(true)
      // 圖說裡的 $...$ 被 KaTeX 渲染（.katex）；$...$ 以外的文字原樣出現
      const pieces = d.caption.split('$')
      expect(figcap.querySelectorAll('.katex').length, d.id).toBe(Math.floor(pieces.length / 2))
      pieces.forEach((t, j) => {
        if (j % 2 === 0) expect(cap, d.id).toContain(t)
      })
      const sec = boxes[i].closest('section[id]')!.id
      expect(sec, d.id).toBe(`cs-${d.section.replace('§', '').split('.')[0]}`)
    })
    // 每個 H2 段落（§0–§18，除了純清單的 §16、§17）至少有一張圖
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18]) expect(page.querySelectorAll(`#cs-${n} [data-diagram]`).length, `§${n}`).toBeGreaterThanOrEqual(1)
    // 系統地圖是手排的 SVG（不經過 Mermaid）：本章標示的 10 個方塊都帶 is-focus
    expect(Array.from(map.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block')).sort()).toEqual([...MAP_FOCUS].sort())
    // mermaid 真的被要求畫出每一張登錄的圖（不含系統地圖），順序與頁面一致
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(DIAGRAMS.length), { timeout: 30000 })
    const drawn = spy.mock.calls.map((c) => c[1])
    expect(drawn.filter((c, i) => drawn.indexOf(c) === i)).toEqual(DIAGRAMS.map((d) => d.chart).map(sanitizeMermaidSource))
    // 內文的圖號按鈕會捲到那張圖
    const ref = Array.from(page.querySelectorAll('button.cs-figref')).find((b) => b.textContent === diagramById('remedy-g').label) as HTMLButtonElement
    expect(ref).toBeTruthy()
    fireEvent.click(ref)
    expect(scroll.mock.contexts[scroll.mock.contexts.length - 1]).toBe(page.querySelector('#fig-remedy-g'))

    // ── 符號表：整頁只有一張，在頁面最後（Recap §17 與 §18–§20 之後），外層 id="symbols"
    const tables = page.querySelectorAll('.c-symbols')
    expect(tables).toHaveLength(1)
    const sym = page.querySelector(`#${SYMBOLS_ANCHOR}`) as HTMLElement
    expect(SYMBOLS_ANCHOR).toBe('symbols')
    expect(sym.contains(tables[0])).toBe(true)
    expect(sym.querySelectorAll('tbody tr')).toHaveLength(SYMBOLS.length)
    expect(page.lastElementChild).toBe(sym)
    for (const id of ['cs-0', 'cs-1', 'cs-17', 'cs-20']) expect(after(page.querySelector(`#${id}`)!, sym), id).toBe(true)
    expect(page.querySelector('#cs-1 .c-symbols')).toBeNull()
    expect(sym.querySelector('h2')!.textContent).toBe('21. 本章符號表')
    // 章首只留一行：按鈕（不是會改路由的 href），在目錄與 §0 之前；按下去捲到符號表
    const link = Array.from(page.querySelectorAll('button')).find((b) => /^本章符號表在最後/.test(b.textContent ?? '')) as HTMLButtonElement
    expect(link).toBeTruthy()
    expect(link.closest('.cs-symbols-link')!.querySelectorAll('button')).toHaveLength(1)
    expect(after(link, page.querySelector('nav')!)).toBe(true)
    expect(after(link, page.querySelector('#cs-0')!)).toBe(true)
    expect(after(link, sym)).toBe(true)
    expect(page.querySelector(`a[href="#${SYMBOLS_ANCHOR}"]`)).toBeNull()
    expect(page.querySelectorAll('a[href^="#cs-"]')).toHaveLength(0)
    // 圖號與手算題的頁內連結也都是按鈕（HashRouter 下 href="#…" 會被當成路由）
    expect(page.querySelectorAll('a[href^="#fig-"], a[href^="#handcalc-"]')).toHaveLength(0)
    const handLink = Array.from(page.querySelectorAll('button.cs-linkbtn')).find((b) => b.textContent === 'HC-CS.3') as HTMLButtonElement
    expect(handLink).toBeTruthy()
    scroll.mockClear()
    fireEvent.click(handLink)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('handcalc-HC-CS.3'))
    expect(page.contains(document.getElementById('handcalc-HC-CS.3'))).toBe(true)
    scroll.mockClear()
    fireEvent.click(link)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.contexts[0]).toBe(sym)
    // 目錄的最後一項也指到符號表
    const toc = Array.from(page.querySelectorAll('.cs-toc li'))
    expect(toc).toHaveLength(22)
    expect(toc[toc.length - 1].textContent).toBe('本章符號表')
    scroll.mockClear()
    fireEvent.click(toc[toc.length - 1].querySelector('button')!)
    expect(scroll.mock.contexts[0]).toBe(sym)
    // 沒有 KaTeX 錯誤
    expect(page.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    unmount()
  }, 600000)
})
