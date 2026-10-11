import type { ReactNode } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { SettingsProvider, type LearningMode } from '@/app/settings'
import { systemMapChart } from '@/components'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { eigvals } from '@/simulation/core'
import {
  analyzeDualLoop,
  analyzeGeneral,
  calLoopGain,
  calLoopGainGeneral,
  combinedMatrix,
  comparatorKq,
  delayCriticalGain,
  delayCriticalOmega,
  delayNoOvershootGain,
  delayStable,
  dualLoopFullMuRange,
  dualLoopSimplifiedMuRange,
  observationTransfer,
  pmFirstOrder,
  pmWithDelay,
  polarityMarginArcsin,
  polarityMarginMod180Bug,
  polarityMarginWrap,
  simulateDelayRecursion,
  simulateFullModel,
  simulateGeneral,
  simulateQuasiStatic,
  stableIntervalsNumeric,
  wrap180Spec,
  type ObservationSystem,
} from '@/simulation/models/stability'
import Chapter08 from './index'
import * as DIAGRAMS from './diagrams'
import {
  CH08_CHARTS,
  DELAY_LOOP_CHART,
  DUAL_LOOP_CHART,
  DUAL_REGIMES_CHART,
  DUAL_SIGNAL_FLOW_CHART,
  FIRST_ORDER_CHART,
  LATENCY_SPLIT_CHART,
  LOOP_CUT_CHART,
  PHASE_BUDGET_CHART,
  PIPELINE_SEQ_CHART,
  PM_FLOW_CHART,
  POLARITY_PATH_CHART,
  POLARITY_WRAP_CHART,
  ROADMAP_CHART,
  ROOT_STATES_CHART,
  STABILITY_CHECK_CHART,
  STATE_SPACE_CHART,
  SYNTHESIS_FLOW_CHART,
  SYSTEM_MAP_FOCUS,
  TWO_MARGINS_CHART,
  UNIFIED_LOOP_CHART,
  type Ch08ChartName,
} from './diagrams'
import { SYMBOLS, SYMBOLS_ID, SYMBOLS_LINK_ID } from './sections/Symbols'

// 整章渲染會用到 Plotly（jsdom 沒有 canvas／WebGL）：和 ch08.test.tsx 相同的替身。mermaid 則是「真的」——只在整章渲染那幾題把 render 換掉。
const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

// 整章渲染（數百個 KaTeX、8 題手算）與真正的 mermaid render 在多個測試行程同時跑時會慢很多：test 與 hook（RTL 自動 cleanup）都給足時間
const SLOW = 240_000
vi.setConfig({ testTimeout: SLOW, hookTimeout: SLOW })
const CHARTS = Object.entries(CH08_CHARTS) as [Ch08ChartName, string][]
/** 每張圖所在的小節（Section 的 id），依頁面出現的順序；頁面測試用它核對「每一節有幾張圖」 */
const SECTION_OF: Record<Ch08ChartName, string> = {
  ROADMAP_CHART: 'ch08-intro',
  POLARITY_PATH_CHART: 'ch08-polarity',
  POLARITY_WRAP_CHART: 'ch08-polarity',
  TWO_MARGINS_CHART: 'ch08-polarity',
  FIRST_ORDER_CHART: 'ch08-first-order',
  LOOP_CUT_CHART: 'ch08-first-order',
  PM_FLOW_CHART: 'ch08-first-order',
  PIPELINE_SEQ_CHART: 'ch08-delay',
  DELAY_LOOP_CHART: 'ch08-delay',
  ROOT_STATES_CHART: 'ch08-delay',
  PHASE_BUDGET_CHART: 'ch08-delay',
  DUAL_LOOP_CHART: 'ch08-dual-loop',
  DUAL_SIGNAL_FLOW_CHART: 'ch08-dual-loop',
  LATENCY_SPLIT_CHART: 'ch08-dual-loop',
  DUAL_REGIMES_CHART: 'ch08-dual-loop',
  STATE_SPACE_CHART: 'ch08-dual-loop',
  STABILITY_CHECK_CHART: 'ch08-dual-loop',
  UNIFIED_LOOP_CHART: 'ch08-compare',
  SYNTHESIS_FLOW_CHART: 'ch08-handcalc-synthesis',
}
/** 規格原有的三張（改寫過）；其餘 16 張是依 teaching-style §8 新增的 */
const ORIGINAL_CHARTS: Ch08ChartName[] = ['ROADMAP_CHART', 'FIRST_ORDER_CHART', 'DUAL_LOOP_CHART']
const posMod = (x: number, m: number) => ((x % m) + m) % m
const deg = (rad: number) => (rad * 180) / Math.PI

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
}
interface SeqMessage {
  from?: string
  to?: string
  message?: string
}
interface ParsedDb {
  getVertices?: () => Map<string, FlowVertex>
  getEdges?: () => FlowEdge[]
  getActors?: () => Map<string, unknown>
  getMessages?: () => SeqMessage[]
}

/** 用真正的 mermaid parser 取得圖的結構（節點、連線、標籤），不靠 regex 猜 */
async function parsed(chart: string): Promise<{ type: string; db: ParsedDb }> {
  const d = await mermaid.mermaidAPI.getDiagramFromText(chart)
  return { type: d.type, db: d.db as unknown as ParsedDb }
}
async function flow(chart: string) {
  const { db } = await parsed(chart)
  const vertices = db.getVertices!()
  const edges = db.getEdges!()
  const text = (id: string) => vertices.get(id)?.text ?? ''
  const into = (id: string) => edges.filter((e) => e.end === id)
  const edge = (a: string, b: string) => {
    const e = edges.find((x) => x.start === a && x.end === b)
    if (!e) throw new Error(`圖上沒有 ${a} → ${b} 這條線`)
    return e
  }
  const classesOf = (id: string) => vertices.get(id)?.classes ?? []
  return { vertices, edges, text, into, edge, classesOf }
}

/** 所有會顯示出來的標籤文字（節點、連線、sequence 訊息），依 <br/> 拆成一行一行 */
async function labelLines(chart: string): Promise<string[]> {
  const { db } = await parsed(chart)
  const raw: string[] = []
  if (db.getVertices) for (const v of db.getVertices().values()) raw.push(v.text ?? '')
  if (db.getEdges) for (const e of db.getEdges()) raw.push(e.text ?? '')
  if (db.getMessages) for (const m of db.getMessages()) raw.push(m.message ?? '')
  return raw
    .flatMap((t) => t.split(/<br\s*\/?>/))
    .map((t) => t.trim())
    .filter(Boolean)
}

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
})

describe('Ch08 Mermaid 圖：語法、大小與標籤（真正的 mermaid parser）', () => {
  it('本章共有 19 張 Mermaid 原始碼（16 張新增 + 3 張原有），內容不重複；diagrams.ts 匯出的每一張都在清單裡', () => {
    expect(CHARTS).toHaveLength(19)
    expect(new Set(CHARTS.map(([, c]) => c)).size).toBe(19)
    expect(CHARTS.filter(([name]) => !ORIGINAL_CHARTS.includes(name))).toHaveLength(16)
    // 沒有「寫了卻沒登錄、所以沒被測到也沒放上頁面」的圖
    const exported = Object.entries(DIAGRAMS).filter(([, v]) => typeof v === 'string' && /^(flowchart|sequenceDiagram|stateDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(CHARTS.map(([k]) => k).sort())
    for (const [k, v] of exported) expect(CH08_CHARTS[k as Ch08ChartName]).toBe(v)
    // 每張圖都指定了所在小節，順序與頁面相同；每個主要小節至少一張，§8.1–§8.4 各三張以上
    expect(Object.keys(SECTION_OF)).toEqual(CHARTS.map(([k]) => k))
    const perSection = (id: string) => CHARTS.filter(([k]) => SECTION_OF[k] === id).length
    expect(['ch08-intro', 'ch08-polarity', 'ch08-first-order', 'ch08-delay', 'ch08-dual-loop', 'ch08-compare', 'ch08-handcalc-synthesis'].map(perSection)).toEqual([1, 3, 3, 4, 6, 1, 1])
    expect(SYSTEM_MAP_FOCUS).toEqual(['gmac', 'scale', 'acc'])
  })

  it.each(CHARTS)('%s 可被解析，且不超過 14 個節點', async (name, chart) => {
    const res = await mermaid.parse(chart)
    const type = res && typeof res === 'object' ? res.diagramType : String(res)
    expect(type).toBe(name === 'PIPELINE_SEQ_CHART' ? 'sequence' : 'flowchart-v2')
    const { db } = await parsed(chart)
    const nodes = db.getVertices ? db.getVertices().size : db.getActors!().size
    expect(nodes, name).toBeGreaterThanOrEqual(3)
    expect(nodes, name).toBeLessThanOrEqual(14)
    // 標籤內沒有裸的 '<'（只允許 <br/> 與箭頭）、沒有 ';'、沒有 TeX 的 '$'
    expect(chart).not.toMatch(/[^-]<[^b/]/)
    expect(chart).not.toContain(';')
    expect(chart).not.toContain('$')
    // 原始碼直接寫全形「＋」與減號「−」：共用元件的前處理（sanitizeMermaidSource）不需要改任何字
    expect(sanitizeMermaidSource(chart)).toBe(chart)
    expect(chart).not.toMatch(/（\+）|（-）/)
  })

  it.each(CHARTS)('%s 的標籤不會被 Mermaid 11 當成 markdown（清單、標題、引用）', async (_name, chart) => {
    // Mermaid 11 會把一般標籤也送進 markdown 解析：單獨一個 "+"、"-"、"*" 或 "1." 開頭會被畫成「Unsupported markdown: list」。
    // 加法點的正號因此一律寫全形「＋」或「訊號名（＋）」。
    const lines = await labelLines(chart)
    expect(lines.length).toBeGreaterThan(3)
    for (const line of lines) {
      expect(line, line).not.toMatch(/^(?:[-+*]|\d+[.)])(?:\s|$)/)
      expect(line, line).not.toMatch(/^[#>]/)
      expect(line, line).not.toContain('`')
    }
  })

  it('加法點 Σ：每一個都至少兩條輸入，每條輸入都標了正負號；回授進暫存器或 Σ 的那一條是負號（負回授）', async () => {
    const found: string[] = []
    for (const [name, chart] of CHARTS) {
      if (name === 'PIPELINE_SEQ_CHART') continue
      const g = await flow(chart)
      for (const v of g.vertices.values()) {
        if (v.text !== 'Σ') continue
        expect(v.type, `${name}.${v.id}`).toBe('circle')
        const incoming = g.into(v.id)
        expect(incoming.length, `${name}.${v.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${name}：${e.start} → ${v.id} 要標正負號`).toMatch(/^＋$|（＋）$|（−）$/)
        const minus = incoming.filter((e) => /（−）$/.test(e.text ?? '')).length
        found.push(`${name}.${v.id}:${incoming.length - minus}+${minus}-`)
      }
    }
    // δ = a − w（＋a、−w）與 δ_{k+1} = δ_k − μ·G_k（＋δ_k、−μ·G_k）各一個負號；觀測狀態 s 與輸出 G 的加法點全是正號
    expect(found).toEqual([
      'FIRST_ORDER_CHART.S:1+1-',
      'DELAY_LOOP_CHART.S:1+1-',
      'DUAL_SIGNAL_FLOW_CHART.FS:2+0-',
      'DUAL_SIGNAL_FLOW_CHART.FI:1+1-',
      'DUAL_SIGNAL_FLOW_CHART.QI:1+1-',
      'STATE_SPACE_CHART.SS:2+0-',
      'STATE_SPACE_CHART.SG:2+0-',
      'STATE_SPACE_CHART.SD:1+1-',
      'UNIFIED_LOOP_CHART.S:1+1-',
    ])
  })

  it('標色（classDef）在深淺主題都讀得清楚：白字配深色底，對比度 ≥ 4.5；每張圖只用 focus／warn／ok 三種', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const defs = new Map<string, string>()
    for (const [name, chart] of CHARTS) {
      for (const m of chart.matchAll(/classDef (\w+) fill:(#[0-9a-f]{6}),stroke:(#[0-9a-f]{6}),color:(#[0-9a-f]{6})/g)) {
        expect(['focus', 'warn', 'ok'], name).toContain(m[1])
        expect(m[4]).toBe('#ffffff')
        defs.set(m[1], m[2])
        const contrast = (1.0 + 0.05) / (luminance(m[2]) + 0.05)
        expect(contrast, `${name} ${m[1]}`).toBeGreaterThanOrEqual(4.5)
      }
      // 用到 class 的圖一定有對應的 classDef
      for (const m of chart.matchAll(/^\s*class [\w,]+ (\w+)$/gm)) expect(chart, name).toContain(`classDef ${m[1]} `)
    }
    expect([...defs.keys()].sort()).toEqual(['focus', 'ok', 'warn'])
  })
})

describe('Ch08 Mermaid 圖：真的畫一次（@/components/mermaidTestUtils；parser 抓不到的問題在這裡抓）', () => {
  beforeAll(installMermaidSvgShim)

  it.each([...CHARTS, ['SystemMap', systemMapChart(SYSTEM_MAP_FOCUS)] as [string, string]])(
    '%s 畫得出來：沒有「Unsupported markdown」、標籤一字不漏、節點數不超過上限',
    async (name, chart) => {
      const lines = await labelLines(chart)
      const { svg, text, nodeCount } = await renderMermaidForTest(chart)
      expect(svg).toContain('<svg')
      expect(text).not.toMatch(/Unsupported markdown/)
      expect(text).not.toMatch(/Syntax error/)
      // 全站共用的系統地圖（方塊比較多）不受本章「單張 14 個節點」的限制，但同樣要畫得出來
      if (name !== 'SystemMap') expect(nodeCount).toBeLessThanOrEqual(14)
      // 畫出來的節點數與 parser 看到的相同（subgraph 的標題不算節點；sequence 圖沒有 flowchart 節點）
      const { db } = await parsed(chart)
      expect(nodeCount).toBe(db.getVertices ? db.getVertices().size : 0)
      expect(nodeCount > 0).toBe(name !== 'PIPELINE_SEQ_CHART')
      // 每一行標籤文字都真的出現在畫出來的圖上（沒有被 markdown／HTML 解析吃掉）
      const shown = text.replace(/\xa0/g, ' ')
      for (const line of lines) expect(shown, `${name} 少了標籤「${line}」`).toContain(line)
    },
  )
})

describe('Ch08 Mermaid 圖：訊號名稱、正負號與箭頭方向和公式一致', () => {
  it('FIRST_ORDER：Σ 的兩個輸入一正一負、輸出 δ_k = a − w_k，繞一圈是 K 與 μ/(z−1)', async () => {
    const g = await flow(FIRST_ORDER_CHART)
    expect(g.into('S').map((e) => [e.start, e.text])).toEqual([
      ['A', '＋'],
      ['I', 'w_k（−）'],
    ])
    expect(g.edge('S', 'K').text).toBe('δ_k = a − w_k')
    expect(g.edge('K', 'I').text).toBe('G_k = K·δ_k')
    expect(g.text('K')).toContain('K = K_q·C')
    expect(g.text('I')).toContain('μ/(z−1)')
    expect(g.classesOf('I')).toContain('focus')
  }, SLOW)

  it('DELAY_LOOP：延遲 z⁻ᵈ 在暫存器輸出到 Σ 的那條線上（紅色），Σ 輸出的是舊的 δ_{k−d}', async () => {
    const g = await flow(DELAY_LOOP_CHART)
    expect(g.edge('I', 'D').text).toBe('w_k')
    expect(g.edge('D', 'S').text).toBe('w_{k−d}（−）')
    expect(g.edge('A', 'S').text).toBe('＋')
    expect(g.edge('S', 'K').text).toBe('δ_{k−d} = a − w_{k−d}')
    expect(g.edge('K', 'I').text).toBe('G_k = K·δ_{k−d}')
    expect(g.text('D')).toContain('z⁻ᵈ')
    expect(g.classesOf('D')).toContain('warn')
    // 和無延遲的圖只差這一格：其餘節點文字相同
    const g0 = await flow(FIRST_ORDER_CHART)
    for (const id of ['A', 'S', 'K', 'I']) expect(g.text(id)).toBe(g0.text(id))
  }, SLOW)

  it('T08: 照 FIRST_ORDER／DELAY_LOOP 的圖逐格計算，與 simulateDelayRecursion 逐點相同（d = 0…3）', () => {
    // 圖：Σ = (+a) + (−w_{k−d}) → × K → 積分器 μ/(z−1)（w_{k+1} = w_k + μ·G_k）→ z⁻ᵈ → 回到 Σ 的負端
    const asDrawn = (a: number, w0: number, mu: number, K: number, d: number, steps: number) => {
      const w = [w0]
      for (let k = 0; k < steps; k++) {
        const applied = w[Math.max(0, k - d)] // z⁻ᵈ：DTC 實際使用的係數
        const sigma = a - applied // Σ：＋a、−w_{k−d}
        const G = K * sigma // GMAC 平均斜率
        w.push(w[k] + mu * G) // 積分器 μ/(z−1)
      }
      return w.map((wk) => a - wk) // δ_k = a − w_k
    }
    for (const d of [0, 1, 2, 3]) {
      for (const [mu, K] of [
        [10, 0.0079788],
        [0.5, 1],
        [1.2, 1],
        [4, 0.15],
      ]) {
        const a = 3
        const w0 = 1
        const mine = asDrawn(a, w0, mu, K, d, 40)
        const ref = simulateDelayRecursion(mu * K, d, 40, a - w0).delta
        for (let k = 0; k <= 40; k++) expect(mine[k]).toBeCloseTo(ref[k], 9)
      }
    }
    // 極性：誤差為正（w 太小）時，第一步的修正讓 w 變大（往 a 靠近）：δ 由 2 變成 1
    expect(asDrawn(3, 1, 0.5, 1, 0, 1)[1]).toBeCloseTo(1, 12)
  })

  it('PIPELINE_SEQ：d = 1 的時序與正文的表相同（block k 的 DTC 用 w_{k−1}，G_k = K·δ_{k−1}，再更新 w_{k+1}）', async () => {
    const { db } = await parsed(PIPELINE_SEQ_CHART)
    expect(db.getActors!().size).toBe(3)
    const msgs = db.getMessages!().map((m) => m.message ?? '')
    const order = [
      'block k 開始',
      'w_{k−1}（晚 d = 1 個 block）',
      'δ_{k−1} = a − w_{k−1}',
      'G_k = K·δ_{k−1}',
      'w_{k+1} = w_k + μ·G_k',
      'block k+1 開始',
      'DTC 拿到 w_k',
      'δ_k = a − w_k',
      'G_{k+1} = K·δ_k',
      'w_{k+2} = w_{k+1} + μ·G_{k+1}',
    ]
    let at = -1
    for (const piece of order) {
      const i = msgs.findIndex((m, j) => j > at && m.includes(piece))
      expect(i, piece).toBeGreaterThan(at)
      at = i
    }
    // 數值：g = 0.5、d = 1、δ_0 = 1 就是正文「先算一次」的 0.5、0、−0.25
    expect(Array.from(simulateDelayRecursion(0.5, 1, 3).delta)).toEqual([1, 0.5, 0, -0.25])
  }, SLOW)

  it('LOOP_CUT：三個方塊相乘是 g/(z−1)；回到 Σ 的負端所以 δ_out = −L·δ_in，L = −1 時自己振盪', async () => {
    const g = await flow(LOOP_CUT_CHART)
    expect([g.text('K'), g.text('MU'), g.text('INT')].map((t) => t.split(/<br\s*\/?>/)[0])).toEqual(['× K', '× μ', '1/(z−1)'])
    expect(g.edge('IN', 'K')).toBeTruthy()
    expect(g.edge('K', 'MU').text).toBe('G')
    expect(g.edge('INT', 'OUT').text).toBe('w')
    expect(g.text('OUT')).toContain('δ_out = −L_cal(z)·δ_in')
    // K·μ·1/(e^{jω} − 1) 與 calLoopGain 相同
    const K = 0.4
    const mu = 3
    for (const w of [0.3, 1, 2.5]) {
      const den = { re: Math.cos(w) - 1, im: Math.sin(w) }
      const n2 = den.re ** 2 + den.im ** 2
      const mine = { re: (K * mu * den.re) / n2, im: (-K * mu * den.im) / n2 }
      const L = calLoopGain(K * mu, 0, w)
      expect(mine.re).toBeCloseTo(L.re, 12)
      expect(mine.im).toBeCloseTo(L.im, 12)
    }
    // g = 2、ω = π：L = −1 ⇒ δ_out = −L·δ_in = δ_in（臨界）
    const crit = calLoopGain(2, 0, Math.PI)
    expect(-crit.re).toBeCloseTo(1, 12)
    expect(crit.im).toBeCloseTo(0, 12)
  }, SLOW)

  it('T08: PM_FLOW 的每一格照著算，與 pmFirstOrder／calLoopGain 一致', async () => {
    const g = await flow(PM_FLOW_CHART)
    expect(g.edges.map((e) => `${e.start}>${e.end}`).sort()).toEqual(['ANG>PM', 'G>GM', 'G>P', 'G>WC', 'PM>DM', 'WC>ANG', 'WC>DM'])
    expect(g.text('WC')).toContain('ω_c = 2·arcsin(g/2)')
    expect(g.text('ANG')).toBe('∠L(ω_c) = −90° − ω_c/2')
    expect(g.text('PM')).toContain('= 90° − arcsin(g/2)')
    expect(g.text('GM')).toContain('GM = 2/g')
    for (const gain of [0.079788, 0.3, 1, 1.2, 1.5]) {
      const ref = pmFirstOrder(gain)
      const pole = 1 - gain
      const wc = 2 * Math.asin(gain / 2)
      const angDeg = -90 - ((wc / 2) * 180) / Math.PI
      const pm = 180 + angDeg
      const dm = ((pm * Math.PI) / 180) / wc
      expect(pole).toBeCloseTo(ref.pole, 12)
      expect(wc).toBeCloseTo(ref.omegaC, 12)
      expect(pm).toBeCloseTo(ref.pmDeg, 9)
      expect(pm).toBeCloseTo(90 - (Math.asin(gain / 2) * 180) / Math.PI, 9)
      expect(dm).toBeCloseTo(ref.delayMarginBlocks, 9)
      expect(20 * Math.log10(2 / gain)).toBeCloseTo(ref.gmDb, 9)
      // 圖上的 ∠L 與「ω = π 處 |L| = g/2」直接用開迴路頻率響應驗證
      const L = calLoopGain(gain, 0, wc)
      expect(Math.hypot(L.re, L.im)).toBeCloseTo(1, 9)
      expect((Math.atan2(L.im, L.re) * 180) / Math.PI).toBeCloseTo(angDeg, 9)
      const Lpi = calLoopGain(gain, 0, Math.PI)
      expect(Math.hypot(Lpi.re, Lpi.im)).toBeCloseTo(gain / 2, 12)
    }
    expect(pmFirstOrder(1).pmDeg).toBeCloseTo(60, 12)
  }, SLOW)

  it('ROOT_STATES：五個階段的敘述與 delayStable 的根一致（d = 1、2；d = 0 是負實根）', async () => {
    const g = await flow(ROOT_STATES_CHART)
    expect(g.edges.map((e) => [e.start, e.end, e.text])).toEqual([
      ['S0', 'S1', 'g 變大'],
      ['S1', 'S2', '過 overshoot 門檻'],
      ['S2', 'S3', 'g = g*(d)'],
      ['S3', 'S4', 'g ＞ g*(d)'],
    ])
    expect(g.text('S3')).toContain('ω* = π/(2d+1)')
    const signChanges = (x: ArrayLike<number>) => Array.from(x).filter((v, i, arr) => i > 0 && v * arr[i - 1] < 0).length
    expect([0, 1, 2].map(delayNoOvershootGain)).toEqual([1, 1 / 4, 4 / 27])
    for (const d of [1, 2]) {
      const thr = delayNoOvershootGain(d)
      const gStar = delayCriticalGain(d)
      // S0：g → 0⁺，慢根 ≈ 1 − g
      const tiny = delayStable(1e-3, d)
      expect(tiny.roots[0].re).toBeCloseTo(1 - 1e-3, 5)
      expect(Math.abs(tiny.roots[0].im)).toBeLessThan(1e-9)
      // S1：門檻以下，主導根是正實根，δ_k 不變號
      const below = delayStable(0.9 * thr, d)
      expect(Math.abs(below.roots[0].im)).toBeLessThan(1e-9)
      expect(below.roots[0].re).toBeGreaterThan(0)
      expect(signChanges(simulateDelayRecursion(0.9 * thr, d, 200).delta)).toBe(0)
      // S2：門檻與 g* 之間，主導根是共軛複數對，會 overshoot 但 ρ < 1
      const mid = delayStable(0.5 * (thr + gStar), d)
      expect(Math.abs(mid.roots[0].im)).toBeGreaterThan(0.05)
      expect(mid.roots[0].re).toBeCloseTo(mid.roots[1].re, 9)
      expect(mid.rho).toBeLessThan(1)
      expect(signChanges(simulateDelayRecursion(0.5 * (thr + gStar), d, 200).delta)).toBeGreaterThan(0)
      // S3：g = g*，根在單位圓上、角度 π/(2d+1)，PM_d = 0
      const crit = delayStable(gStar, d)
      expect(crit.rho).toBeCloseTo(1, 9)
      expect(Math.abs(Math.atan2(crit.roots[0].im, crit.roots[0].re))).toBeCloseTo(Math.PI / (2 * d + 1), 6)
      expect(delayCriticalOmega(d)).toBeCloseTo(Math.PI / (2 * d + 1), 12)
      expect(pmWithDelay(gStar, d).pmDeg).toBeCloseTo(0, 6)
      // S4：超過 g*，ρ > 1
      expect(delayStable(1.05 * gStar, d).rho).toBeGreaterThan(1)
    }
    // d = 0：過了門檻 g = 1 之後是負實根（正負交替但收斂），g* = 2
    expect(delayStable(1.5, 0).roots[0].re).toBeCloseTo(-0.5, 12)
    expect(delayCriticalGain(0)).toBeCloseTo(2, 12)
  }, SLOW)

  it('POLARITY_PATH：兩條路徑相乘取平均 = (A²/2)|H|cos(φ + ΩD)，M = arcsin(cos θ) 的正負與相關的正負相同', async () => {
    const g = await flow(POLARITY_PATH_CHART)
    expect(g.edge('H', 'M').text).toBe('u[n]')
    expect(g.edge('DLY', 'M').text).toBe('x[n−D]')
    expect(g.edge('M', 'C').text).toBe('取平均')
    expect(g.text('C')).toContain('C = (A²/2)·|H|·cos θ')
    expect(g.text('C')).toContain('θ = φ + ΩD')
    expect([g.edge('Q', 'POS').text, g.edge('Q', 'ZERO').text, g.edge('Q', 'NEG').text]).toEqual(['＞ 0', '= 0', '＜ 0'])
    expect(g.classesOf('POS')).toContain('ok')
    expect(g.classesOf('NEG')).toContain('warn')
    // 時域直接算：x[n] = A cos(Ωn)，u[n] = A|H| cos(Ωn + φ)，參考 code 延遲 D 個 sample
    const A = 2
    const H = 0.5
    const period = 16
    const Omega = (2 * Math.PI) / period
    for (const [phiDeg, D] of [
      [0, 0],
      [40, 3],
      [-65, 2],
      [20, 5],
      [155.2, 1],
      [-30, 11],
    ]) {
      const phi = (phiDeg * Math.PI) / 180
      let acc = 0
      const N = period * 8
      for (let n = 0; n < N; n++) acc += A * Math.cos(Omega * (n - D)) * (A * H * Math.cos(Omega * n + phi))
      const C = acc / N
      const theta = phi + Omega * D // ← 圖上的 θ = φ + ΩD（不是 φ − ΩD）
      expect(C).toBeCloseTo(((A * A) / 2) * H * Math.cos(theta), 10)
      const M = polarityMarginArcsin((theta * 180) / Math.PI)
      expect(Math.sign(M)).toBe(Math.sign(C))
    }
  }, SLOW)

  it('TWO_MARGINS：兩關依序、失敗的兩格是紅色、通過是綠色', async () => {
    const g = await flow(TWO_MARGINS_CHART)
    expect(g.edges.map((e) => [e.start, e.end, e.text ?? ''])).toEqual([
      ['START', 'C1', ''],
      ['C1', 'Q1', ''],
      ['Q1', 'F1', '否'],
      ['Q1', 'C2', '是'],
      ['C2', 'Q2', ''],
      ['Q2', 'F2', '否'],
      ['Q2', 'PASS', '是'],
    ])
    expect(g.text('C1')).toContain('Ω（rad/sample）')
    expect(g.text('C2')).toContain('ω（rad/block）')
    expect(g.text('F1')).toContain('調小 μ 沒有用')
    expect(g.text('F2')).toContain('調小 μ 有用')
    for (const id of ['F1', 'F2']) expect(g.classesOf(id)).toContain('warn')
    expect(g.classesOf('PASS')).toContain('ok')
  }, SLOW)

  it('DUAL_LOOP 與 ROADMAP：記號依勘誤 E31（r_s、b_s、c_s），極性是 δ ← δ − μ·G', async () => {
    const g = await flow(DUAL_LOOP_CHART)
    expect(g.text('O')).toContain('s_{k+1} = r_s·s_k + b_s·δ_k')
    expect(g.text('C')).toContain('G_k = c_s·s_k')
    expect(g.text('U')).toContain('δ_{k+1} = δ_k − μ·G_k')
    expect(g.edges.map((e) => `${e.start}>${e.end}`)).toEqual(['D>O', 'O>C', 'C>U', 'U>D'])
    expect(g.classesOf('O')).toContain('focus')
    // 路線圖的四格：遞迴式與穩定條件和 F-08.2／F-08.3、F-08.7／F-08.8、F-08.10／F-08.11、F-08.13／F-08.14 相同
    const r = await flow(ROADMAP_CHART)
    expect(r.edges.map((e) => [e.start, e.end, e.text])).toEqual([
      ['A', 'B', '加上更新延遲 d'],
      ['B', 'C', '加上觀測狀態 s'],
      ['C', 'D', 's 變成向量'],
    ])
    const rows = (id: string) => r.text(id).split(/<br\s*\/?>/)
    expect(rows('A')).toEqual(['§8.2 一階', 'δ_{k+1} = (1−g)·δ_k', '0 ＜ g ＜ 2'])
    expect(rows('B')).toEqual(['§8.3 更新延遲', 'δ_{k+1} = δ_k − g·δ_{k−d}', '0 ＜ g ＜ 2·sin(π/(4d+2))'])
    expect(rows('C')).toEqual(['§8.4 雙迴路', 's_{k+1} = r_s·s_k + b_s·δ_k', 'δ_{k+1} = δ_k − μ·c_s·s_k', '0 ＜ μ·b_s·c_s ＜ 1 − r_s'])
    expect(rows('D')).toEqual(['一般化', 'ρ(A_comb) ＜ 1', 'L_cal = μ·F(z)/(z−1)'])
    expect(ROADMAP_CHART).not.toMatch(/μbc|r·s/)
    // 四格的條件照著算：g 剛好在上界內／外時，對應的模型穩定／不穩定
    for (const d of [0, 1, 2, 3]) {
      const bound = 2 * Math.sin(Math.PI / (4 * d + 2))
      expect(bound).toBeCloseTo(delayCriticalGain(d), 12)
      expect(delayStable(0.999 * bound, d).stable).toBe(true)
      expect(delayStable(1.001 * bound, d).stable).toBe(false)
    }
    expect(delayCriticalGain(0)).toBeCloseTo(2, 12) // 第一格是第二格的 d = 0
    for (const rs of [0, 0.5, 0.8]) {
      const hi = (1 - rs) / 0.2 // μ·b_s·c_s ＜ 1 − r_s，b_s·c_s = 0.2
      expect(analyzeDualLoop({ r: rs, b: 0.2, c: 1, mu: 0.999 * hi }).stable).toBe(true)
      expect(analyzeDualLoop({ r: rs, b: 0.2, c: 1, mu: 1.001 * hi }).stable).toBe(false)
      expect(analyzeGeneral({ A: [[rs]], b: [0.2], c: [1], d: 0 }, 0.999 * hi).rho).toBeLessThan(1)
      expect(analyzeGeneral({ A: [[rs]], b: [0.2], c: [1], d: 0 }, 1.001 * hi).rho).toBeGreaterThan(1)
    }
  }, SLOW)

  it('T09: 照 DUAL_SIGNAL_FLOW 的兩個框逐格計算，分別等於 simulateFullModel 與 simulateQuasiStatic', async () => {
    const g = await flow(DUAL_SIGNAL_FLOW_CHART)
    // 完整模型：Σ_s 的兩個輸入都是正的；Σ_δ 是 δ_k（＋）與 μ·G_k（−）
    expect(g.into('FS').map((e) => [e.start, e.text])).toEqual([
      ['FB', '＋'],
      ['FR', '＋'],
    ])
    expect(g.into('FI').map((e) => [e.start, e.text])).toEqual([
      ['FM', 'μ·G_k（−）'],
      ['FZD', 'δ_k（＋）'],
    ])
    expect(g.edge('FS', 'FZ').text).toBe('s_{k+1}')
    expect(g.edge('FZ', 'FC').text).toBe('s_k')
    expect(g.edge('FI', 'FZD').text).toBe('δ_{k+1}')
    expect(g.into('QI').map((e) => [e.start, e.text])).toEqual([
      ['QM', 'μ·G_k（−）'],
      ['QZD', 'δ_k（＋）'],
    ])
    expect(g.text('QF')).toBe('× F(1) = b_s·c_s/(1−r_s)')
    for (const id of ['FB', 'FS', 'FZ', 'FR']) expect(g.classesOf(id)).toContain('focus')
    expect(g.classesOf('QF')).toContain('warn')

    const full = (r: number, b: number, c: number, mu: number, steps: number) => {
      let s = 0 // z⁻¹（FZ）的輸出 s_k
      let delta = 1 // z⁻¹（FZD）的輸出 δ_k
      const out = [delta]
      for (let k = 0; k < steps; k++) {
        const sNext = b * delta + r * s // Σ_s：＋b_s·δ_k、＋r_s·s_k
        const G = c * s // × c_s 讀的是 s_k（不含 δ_k）
        const dNext = delta - mu * G // Σ_δ：δ_k（＋）、μ·G_k（−）
        s = sNext
        delta = dNext
        out.push(delta)
      }
      return out
    }
    const quasi = (r: number, b: number, c: number, mu: number, steps: number) => {
      let delta = 1
      const out = [delta]
      for (let k = 0; k < steps; k++) {
        const G = ((b * c) / (1 - r)) * delta // × F(1)
        delta = delta - mu * G
        out.push(delta)
      }
      return out
    }
    for (const p of [
      { r: 0.8, b: 0.2, c: 1, mu: 1.2 },
      { r: 0.8, b: 0.2, c: 1, mu: 0.5 },
      { r: 0, b: 1, c: 1, mu: 0.6 },
      { r: -0.5, b: 0.3, c: 2, mu: 0.9 },
    ]) {
      const a = full(p.r, p.b, p.c, p.mu, 60)
      const refFull = simulateFullModel(p, 60).delta
      const q = quasi(p.r, p.b, p.c, p.mu, 60)
      const refQuasi = simulateQuasiStatic(p, 60)
      for (let k = 0; k <= 60; k++) {
        expect(a[k]).toBeCloseTo(refFull[k], 9)
        expect(q[k]).toBeCloseTo(refQuasi[k], 9)
      }
    }
    // Gallery #5（μ = 1.2）：完整模型發散、quasi-static 以為收斂——兩個框的差別就是這個
    expect(Math.abs(full(0.8, 0.2, 1, 1.2, 300)[300])).toBeGreaterThan(100)
    expect(Math.abs(quasi(0.8, 0.2, 1, 1.2, 300)[300])).toBeLessThan(1e-12)
  }, SLOW)

  it('T09: LATENCY_SPLIT 的三個上界與數值掃描一致；F(z) = z⁻¹ × 低通', async () => {
    const g = await flow(LATENCY_SPLIT_CHART)
    expect(g.text('A2')).toContain('μ·b_s·c_s ＜ 2(1−r_s)')
    expect(g.text('B2')).toContain('μ·b_s·c_s ＜ 2(1+r_s)')
    expect(g.text('C2')).toContain('μ·b_s·c_s ＜ 1−r_s')
    expect(g.text('CZ')).toContain('z⁻¹')
    expect(g.text('B1')).toContain('b_s·c_s/(1 − r_s·z⁻¹)')
    expect(g.text('C1')).toContain('b_s·c_s/(1 − r_s·z⁻¹)')
    expect(g.edges.map((e) => `${e.start}>${e.end}`)).toEqual(['D>A1', 'A1>A2', 'D>B1', 'B1>B2', 'D>CZ', 'CZ>C1', 'C1>C2'])
    const b = 0.2
    const c = 1
    for (const r of [0, 0.5, 0.8, 0.95]) {
      const fullSys: ObservationSystem = { A: [[r]], b: [b], c: [c], d: 0 } // (c) F(z) = bc/(z − r)
      const lowpass: ObservationSystem = { A: [[r]], b: [b], c: [c * r], d: c * b } // (b) F(z) = bc/(1 − r z⁻¹)
      // (a) quasi-static：|1 − μF(1)| < 1
      expect(dualLoopSimplifiedMuRange(r, b, c).hi * b * c).toBeCloseTo(2 * (1 - r), 12)
      expect(analyzeGeneral(fullSys, 1).dcGain).toBeCloseTo((b * c) / (1 - r), 12)
      // (b) 只有低通
      const scanB = stableIntervalsNumeric((mu) => analyzeGeneral(lowpass, mu).rho, 0, (2 * (1 + r)) / (b * c) + 5, 801)
      expect(scanB[0].hi * b * c).toBeCloseTo(2 * (1 + r), 6)
      // (c) 完整模型
      expect(dualLoopFullMuRange(r, b, c).hi * b * c).toBeCloseTo(1 - r, 12)
      const scanC = stableIntervalsNumeric((mu) => analyzeGeneral(fullSys, mu).rho, 0, (3 * (1 - r)) / (b * c), 801)
      expect(scanC[0].hi * b * c).toBeCloseTo(1 - r, 6)
      // (c) = z⁻¹ × (b)，兩者 DC 增益相同
      for (const w of [0.2, 1.1, 2.7]) {
        const z = { re: Math.cos(w), im: Math.sin(w) }
        const Fc = observationTransfer(fullSys, z)
        const Fb = observationTransfer(lowpass, z)
        expect(Fc.re).toBeCloseTo(Fb.re * Math.cos(w) + Fb.im * Math.sin(w), 12) // × e^{−jω}
        expect(Fc.im).toBeCloseTo(Fb.im * Math.cos(w) - Fb.re * Math.sin(w), 12)
      }
      expect(analyzeGeneral(lowpass, 1).dcGain).toBeCloseTo(analyzeGeneral(fullSys, 1).dcGain, 12)
    }
  }, SLOW)

  it('STATE_SPACE：照圖逐格計算（含直通 d_s）等於 simulateGeneral；四個藍色方塊是 A_s、b_s、c_sᵀ、d_s', async () => {
    const g = await flow(STATE_SPACE_CHART)
    expect(g.into('SS').map((e) => [e.start, e.text])).toEqual([
      ['BS', '＋'],
      ['AS', '＋'],
    ])
    expect(g.into('SG').map((e) => [e.start, e.text])).toEqual([
      ['CT', '＋'],
      ['DS', '＋'],
    ])
    expect(g.into('SD').map((e) => [e.start, e.text])).toEqual([
      ['MU', 'μ·G_k（−）'],
      ['ZD', 'δ_k（＋）'],
    ])
    expect(g.edge('SG', 'MU').text).toBe('G_k')
    expect(g.edge('SD', 'ZD').text).toBe('δ_{k+1}')
    expect(g.edge('ZD', 'DK')).toBeTruthy()
    expect(g.edges.filter((e) => e.start === 'DK').map((e) => e.end)).toEqual(['BS', 'DS'])
    for (const id of ['AS', 'BS', 'CT', 'DS']) expect(g.classesOf(id)).toContain('focus')

    const asDrawn = (sys: ObservationSystem, mu: number, steps: number) => {
      const n = sys.A.length
      let s = new Array<number>(n).fill(0)
      let delta = 1
      const out = [delta]
      for (let k = 0; k < steps; k++) {
        const sNext = s.map((_, i) => sys.b[i] * delta + sys.A[i].reduce((acc, a, j) => acc + a * s[j], 0)) // Σ_s：＋b_s·δ_k、＋A_s·s_k
        const G = sys.c.reduce((acc, ci, i) => acc + ci * s[i], 0) + sys.d * delta // Σ_G：＋c_sᵀ·s_k、＋d_s·δ_k
        const dNext = delta - mu * G // Σ_δ：δ_k（＋）、μ·G_k（−）
        s = sNext
        delta = dNext
        out.push(delta)
      }
      return out
    }
    const systems: [ObservationSystem, number][] = [
      [{ A: [[0.8]], b: [0.2], c: [1], d: 0 }, 1.2],
      [{ A: [[0.8]], b: [0.2], c: [0.8], d: 0.2 }, 4],
      [{ A: [[1.6, -0.68], [1, 0]], b: [1, 0], c: [0.04, 0.04], d: 0 }, 0.2],
      [{ A: [[0.5, 0.1], [-0.2, 0.3]], b: [0.4, 0.1], c: [0.7, -0.3], d: 0.25 }, 0.6],
    ]
    for (const [sys, mu] of systems) {
      const mine = asDrawn(sys, mu, 50)
      const ref = simulateGeneral(sys, mu, 50).delta
      for (let k = 0; k <= 50; k++) expect(mine[k]).toBeCloseTo(ref[k], 9)
    }
  }, SLOW)

  it('STABILITY_CHECK：流程圖的步驟（組 A_comb → eigenvalue → ρ → 和 1 比）與 combinedMatrix／analyzeGeneral 相同', async () => {
    const g = await flow(STABILITY_CHECK_CHART)
    expect(g.edges.map((e) => [e.start, e.end, e.text ?? ''])).toEqual([
      ['IN', 'BUILD', ''],
      ['BUILD', 'EIG', ''],
      ['EIG', 'RHO', ''],
      ['RHO', 'Q', ''],
      ['Q', 'PASS', 'ρ ＜ 1'],
      ['Q', 'MARG', 'ρ = 1'],
      ['Q', 'FAIL', 'ρ ＞ 1'],
      ['PASS', 'TD', ''],
    ])
    expect(g.text('BUILD')).toContain('上列：A_s、b_s')
    expect(g.text('BUILD')).toContain('下列：−μ·c_sᵀ、1 − μ·d_s')
    expect(g.classesOf('PASS')).toContain('ok')
    for (const id of ['MARG', 'FAIL']) expect(g.classesOf(id)).toContain('warn')

    const sys: ObservationSystem = { A: [[0.5, 0.1], [-0.2, 0.3]], b: [0.4, 0.1], c: [0.7, -0.3], d: 0.25 }
    const mu = 0.6
    // 照圖組矩陣：上列 [A_s, b_s]，下列 [−μ·c_sᵀ, 1 − μ·d_s]
    const built = [...sys.A.map((row, i) => [...row, sys.b[i]]), [...sys.c.map((v) => -mu * v), 1 - mu * sys.d]]
    expect(built).toEqual(combinedMatrix(sys, mu))
    const rho = Math.max(...eigvals(built).map((z) => Math.hypot(z.re, z.im)))
    expect(rho).toBeCloseTo(analyzeGeneral(sys, mu).rho, 12)
    // 三個出口：Gallery #5 的二狀態例子，μ = 0.5（穩定）、1（臨界）、1.2（不穩定）
    const two = (m: number) => analyzeGeneral({ A: [[0.8]], b: [0.2], c: [1], d: 0 }, m)
    expect(two(0.5).rho).toBeLessThan(1)
    expect(two(0.5).stable).toBe(true)
    expect(two(1).rho).toBeCloseTo(1, 12)
    expect(two(1).marginal).toBe(true)
    expect(two(1).stable).toBe(false)
    expect(two(1.2).rho).toBeCloseTo(Math.sqrt(1.04), 12)
    expect(two(1.2).stable).toBe(false)
  }, SLOW)

  it('POLARITY_WRAP：照圖上那一排逐步計算 = F-08.1 的 M = 90° − |wrap₁₈₀(θ)| = arcsin(cos θ)；紅色那條 = mod-180 的錯誤寫法（E20）', async () => {
    const g = await flow(POLARITY_WRAP_CHART)
    expect(g.edges.map((e) => [e.start, e.end, e.text ?? ''])).toEqual([
      ['T', 'A1', ''],
      ['A1', 'A2', ''],
      ['A2', 'A3', ''],
      ['A3', 'A4', ''],
      ['A4', 'M', ''],
      ['T', 'S', '免折回的捷徑'],
      ['S', 'M', '結果相同'],
      ['T', 'B1', '錯誤寫法（E20）'],
      ['B1', 'B2', ''],
    ])
    expect(g.text('A1')).toBe('加 180°')
    expect(g.text('A2')).toContain('除以 360°')
    expect(g.text('A2')).toContain('取非負餘數')
    expect(g.text('A3')).toContain('減 180°')
    expect(g.text('A3')).toContain('ψ = wrap₁₈₀(θ)')
    expect(g.text('A3')).toContain('−180° ≤ ψ ＜ 180°')
    expect(g.text('M')).toContain('M = 90° − |ψ|')
    expect(g.text('S')).toBe('arcsin(cos θ)')
    expect(g.text('B1')).toContain('θ 除以 180° 取餘數')
    expect(g.text('B2')).toContain('θ = −150° 得到 +60°')
    expect(g.text('B2')).toContain('正確是 −60°')
    expect(g.classesOf('M')).toContain('focus')
    expect(g.classesOf('S')).toContain('ok')
    for (const id of ['B1', 'B2']) expect(g.classesOf(id)).toContain('warn')

    const thetas = [0, 45, 60, 89, 90, 120, 150, 180, 200, -150, 270, -300, -180, 359.5, -720.25, 1234.5, -89.999]
    for (const theta of thetas) {
      // 上面那一排：加 180° → 除以 360° 取非負餘數 → 減 180° → 取絕對值 → 90° − |ψ|
      const a1 = theta + 180
      const a2 = posMod(a1, 360)
      const psi = a2 - 180
      const M = 90 - Math.abs(psi)
      expect(a2).toBeGreaterThanOrEqual(0)
      expect(a2).toBeLessThan(360)
      expect(psi).toBeGreaterThanOrEqual(-180)
      expect(psi).toBeLessThan(180)
      expect(psi).toBeCloseTo(wrap180Spec(theta), 9)
      expect(M).toBeCloseTo(polarityMarginWrap(theta), 9)
      // 綠色的捷徑：arcsin(cos θ)，結果相同
      expect(deg(Math.asin(Math.cos((theta * Math.PI) / 180)))).toBeCloseTo(M, 6)
      expect(polarityMarginArcsin(theta)).toBeCloseTo(M, 6)
      // M 的正負 = cos θ 的正負（POLARITY_PATH 的三個分支）
      if (Math.abs(M) > 1e-6) expect(Math.sign(M)).toBe(Math.sign(Math.cos((theta * Math.PI) / 180)))
      // 紅色那條：θ 除以 180° 取餘數 → 90° − 餘數（網站的反面教材函式就是這樣寫的）
      expect(90 - posMod(theta, 180)).toBeCloseTo(polarityMarginMod180Bug(theta), 9)
    }
    // 圖上紅色方塊寫的數字：θ = −150° 錯誤寫法得到 +60°，正確是 −60°
    expect(90 - posMod(-150, 180)).toBe(60)
    expect(polarityMarginWrap(-150)).toBe(-60)
    expect(polarityMarginArcsin(-150)).toBeCloseTo(-60, 9)
  }, SLOW)

  it('T08: PHASE_BUDGET 的相位預算一格一格扣，剩下的就是 F-08.9 的 PM_d；每一格扣的量 = 該方塊頻率響應的相位', async () => {
    const g = await flow(PHASE_BUDGET_CHART)
    expect(g.edges.map((e) => [e.start, e.end, e.text ?? ''])).toEqual([
      ['B0', 'KK', ''],
      ['KK', 'INT', '剩 180°'],
      ['INT', 'DLY', '剩 90° − ω_c/2'],
      ['DLY', 'PM', '剩 90° − ω_c/2 − d·ω_c'],
      ['WC', 'INT', ''],
      ['WC', 'DLY', ''],
      ['PM', 'CR', 'PM_d = 0 時的 g'],
    ])
    expect(g.text('B0')).toContain('PM = 180° + ∠L(ω_c)')
    expect(g.text('KK')).toContain('K ＞ 0')
    expect(g.text('INT')).toContain('μ/(z−1)')
    expect(g.text('INT')).toContain('落後 90° + ω_c/2')
    expect(g.text('DLY')).toContain('z⁻ᵈ')
    expect(g.text('DLY')).toContain('落後 d·ω_c')
    expect(g.text('PM')).toBe('PM_d = 90° − (2d+1)·arcsin(g/2)')
    expect(g.text('WC')).toContain('ω_c = 2·arcsin(g/2)')
    expect(g.text('CR')).toContain('g*(d) = 2·sin(π/(4d+2))')
    expect(g.text('CR')).toContain('GM_d = g*(d)/g')
    expect(g.classesOf('PM')).toContain('focus')
    for (const id of ['DLY', 'CR']) expect(g.classesOf(id)).toContain('warn')
    // 方塊的順序與 DELAY_LOOP 繞一圈的順序相同：K → 積分器 → 延遲
    const loop = await flow(DELAY_LOOP_CHART)
    expect(['K', 'I', 'D'].map((id) => loop.text(id).split(/<br\s*\/?>/)[1])).toEqual(['K = K_q·C', 'μ/(z−1)', 'shadow register → commit → DTC'])

    const K = 0.4
    for (const d of [0, 1, 2, 3]) {
      for (const gain of [0.079788, 0.3, 0.5, 1, 1.5]) {
        const mu = gain / K
        const wc = 2 * Math.asin(gain / 2) // 虛線連上來的那一格：與 d 無關
        // 每個方塊在 ω_c 的相位落後（度），直接由它自己的頻率響應算
        const lagK = -deg(Math.atan2(0, K)) // K > 0：0°
        const lagInt = deg(Math.atan2(Math.sin(wc), Math.cos(wc) - 1)) // μ/(e^{jω} − 1)：落後 = ∠(e^{jω} − 1)
        const lagDelay = deg(d * wc) // e^{−jdω}
        expect(lagK).toBeCloseTo(0, 12)
        expect(lagInt).toBeCloseTo(90 + deg(wc) / 2, 9)
        // 線上寫的「還剩多少」
        const afterK = 180 - lagK
        const afterInt = afterK - lagInt
        const afterDelay = afterInt - lagDelay
        expect(afterK).toBeCloseTo(180, 12)
        expect(afterInt).toBeCloseTo(90 - deg(wc) / 2, 9)
        expect(afterDelay).toBeCloseTo(90 - deg(wc) / 2 - d * deg(wc), 9)
        // 藍色方塊：PM_d = 90° − (2d+1)·arcsin(g/2) = pmWithDelay
        const ref = pmWithDelay(gain, d)
        expect(afterDelay).toBeCloseTo(90 - (2 * d + 1) * deg(Math.asin(gain / 2)), 9)
        expect(afterDelay).toBeCloseTo(ref.pmDeg, 9)
        expect(wc).toBeCloseTo(ref.omegaC, 12)
        // 三個方塊相乘就是 L(e^{jω_c})：大小是 1（延遲不改大小），相位是 −(180° − PM_d)
        const L = calLoopGain(mu * K, d, wc)
        expect(Math.hypot(L.re, L.im)).toBeCloseTo(1, 9)
        const diff = ((deg(Math.atan2(L.im, L.re)) - (afterDelay - 180)) * Math.PI) / 180
        expect(Math.cos(diff)).toBeCloseTo(1, 9)
        expect(Math.sin(diff)).toBeCloseTo(0, 9)
        // 紅色方塊：GM_d = g*(d)/g
        expect(20 * Math.log10((2 * Math.sin(Math.PI / (4 * d + 2))) / gain)).toBeCloseTo(ref.gmDb, 9)
      }
      // PM_d 剛好扣到 0 的 g 就是臨界增益；此時 ω_c = ω* = π/(2d+1)
      const gStar = delayCriticalGain(d)
      expect(pmWithDelay(gStar, d).pmDeg).toBeCloseTo(0, 9)
      expect(2 * Math.asin(gStar / 2)).toBeCloseTo(delayCriticalOmega(d), 12)
      expect(pmWithDelay(0.99 * gStar, d).pmDeg).toBeGreaterThan(0)
      expect(delayStable(0.99 * gStar, d).stable).toBe(true)
      if (d > 0) {
        expect(pmWithDelay(1.01 * gStar, d).pmDeg).toBeLessThan(0)
        expect(delayStable(1.01 * gStar, d).stable).toBe(false)
      }
    }
  }, SLOW)

  it('T09: DUAL_REGIMES 的四個區間與三個門檻（F-08.11、F-08.12）和 analyzeDualLoop 一致；「本例」的 μ = 0.05、1、2', async () => {
    const g = await flow(DUAL_REGIMES_CHART)
    expect(g.edges.map((e) => [e.start, e.end])).toEqual([
      ['R1', 'R2'],
      ['R2', 'R3'],
      ['R3', 'R4'],
    ])
    const label = (a: string, b: string) => (g.edge(a, b).text ?? '').split(/<br\s*\/?>/)
    expect(label('R1', 'R2')).toEqual(['μ·b_s·c_s 超過 (1−r_s)²/4', '本例 μ = 0.05'])
    expect(label('R2', 'R3')).toEqual(['超過 1 − r_s', '本例 μ = 1'])
    expect(label('R3', 'R4')).toEqual(['超過 2(1 − r_s)', '本例 μ = 2'])
    expect(g.text('R1')).toContain('兩個實根')
    expect(g.text('R1')).toContain('pole = 1 − g_eff')
    expect(g.text('R2')).toContain('共軛複數根')
    expect(g.text('R2')).toContain('|z| = √(r_s + μ·b_s·c_s)')
    expect(g.text('R3')).toContain('|z| ＞ 1')
    expect(g.text('R3')).toContain('pole 在 −1 與 0 之間')
    expect(g.text('R4')).toBe('兩個模型都不穩定')
    expect(g.classesOf('R1')).toContain('ok')
    expect(g.classesOf('R2')).toContain('focus')
    for (const id of ['R3', 'R4']) expect(g.classesOf(id)).toContain('warn')

    const base = { r: 0.8, b: 0.2, c: 1 }
    const at = (mu: number) => analyzeDualLoop({ ...base, mu })
    const isReal = (z: { im: number }) => Math.abs(z.im) < 1e-9
    // 三個門檻（本例）：(1−r_s)²/(4·b_s·c_s) = 0.05、(1−r_s)/(b_s·c_s) = 1、2(1−r_s)/(b_s·c_s) = 2
    expect(at(1.2).muComplex).toBeCloseTo(0.05, 12)
    expect(at(1.2).fullRange.hi).toBeCloseTo(1, 12)
    expect(at(1.2).simplifiedRange.hi).toBeCloseTo(2, 12)
    for (const r of [0, 0.5, 0.95]) {
      const a = analyzeDualLoop({ r, b: 0.2, c: 1, mu: 0.1 })
      expect(a.muComplex * 0.2).toBeCloseTo((1 - r) ** 2 / 4, 12)
      expect(a.fullRange.hi * 0.2).toBeCloseTo(1 - r, 12)
      expect(a.simplifiedRange.hi * 0.2).toBeCloseTo(2 * (1 - r), 12)
    }
    // R1（綠）：兩個實根，都在 r_s 與 1 之間；μ 遠小於門檻時慢根 ≈ quasi-static 的 1 − g_eff
    for (const mu of [0.001, 0.01, 0.04]) {
      const a = at(mu)
      expect(a.discriminant).toBeGreaterThan(0)
      expect(a.poles.every(isReal)).toBe(true)
      for (const z of a.poles) {
        expect(z.re).toBeGreaterThan(0.8)
        expect(z.re).toBeLessThan(1)
      }
      expect(a.stable).toBe(true)
      expect(a.simplifiedStable).toBe(true)
    }
    const slow = (mu: number) => Math.max(...at(mu).poles.map((z) => z.re))
    expect(slow(0.001)).toBeCloseTo(at(0.001).simplifiedPole, 4) // 差 (μ·b_s·c_s)²/(1−r_s)³ ≈ 5e-6
    expect(Math.abs(slow(0.04) - at(0.04).simplifiedPole)).toBeGreaterThan(0.01) // 接近門檻就已經不準了
    // 門檻 μ = 0.05：判別式為 0，重根在 (1 + r_s)/2 = 0.9
    expect(at(0.05).discriminant).toBeCloseTo(0, 12)
    expect(at(0.05).rho).toBeCloseTo(0.9, 6)
    // R2（藍）：共軛複數根，|z| = √(r_s + μ·b_s·c_s) 隨 μ 變大（越來越慢）；quasi-static 的 pole 在 (0, 1) 且越來越小（以為越來越快）
    let prevRho = 0.9
    let prevSimple = at(0.05).simplifiedPole
    for (const mu of [0.1, 0.3, 0.6, 0.9]) {
      const a = at(mu)
      expect(a.discriminant).toBeLessThan(0)
      expect(a.poles.some(isReal)).toBe(false)
      expect(a.rho).toBeCloseTo(Math.sqrt(0.8 + 0.2 * mu), 9)
      expect(a.rho).toBeGreaterThan(prevRho)
      expect(a.rho).toBeLessThan(1)
      expect(a.stable).toBe(true)
      expect(a.simplifiedPole).toBeGreaterThan(0)
      expect(a.simplifiedPole).toBeLessThan(prevSimple)
      expect(a.simplifiedStable).toBe(true)
      prevRho = a.rho
      prevSimple = a.simplifiedPole
    }
    // 門檻 μ = 1：臨界（|z| = 1），不算穩定
    expect(at(1).rho).toBeCloseTo(1, 12)
    expect(at(1).marginal).toBe(true)
    // R3（紅）：完整模型 |z| > 1；quasi-static 的 pole 在 −1 與 0 之間，還以為穩定（Gallery #5 的 μ = 1.2 在這一格）
    for (const mu of [1.05, 1.2, 1.9]) {
      const a = at(mu)
      expect(a.rho).toBeGreaterThan(1)
      expect(a.stable).toBe(false)
      expect(a.simplifiedPole).toBeGreaterThan(-1)
      expect(a.simplifiedPole).toBeLessThan(0)
      expect(a.simplifiedStable).toBe(true)
    }
    // R4（紅）：兩個模型都不穩定
    for (const mu of [2.05, 3]) {
      expect(at(mu).stable).toBe(false)
      expect(at(mu).simplifiedStable).toBe(false)
      expect(at(mu).simplifiedPole).toBeLessThan(-1)
    }
  }, SLOW)

  it('T08, T09: UNIFIED_LOOP 同一個迴路換四種 F(z)，照圖逐格計算分別等於 §8.2、§8.3、§8.4 與 quasi-static 的模型；繞一圈 = μ·F(z)/(z−1)', async () => {
    const g = await flow(UNIFIED_LOOP_CHART)
    expect(g.into('S').map((e) => [e.start, e.text])).toEqual([
      ['A', '＋'],
      ['I', 'w_k（−）'],
    ])
    expect(g.edge('S', 'F').text).toBe('δ_k = a − w_k')
    expect(g.edge('F', 'I').text).toBe('G_k')
    expect(g.text('I')).toContain('μ/(z−1)')
    expect(g.into('F').map((e) => e.start)).toEqual(['S', 'M1', 'M2', 'M3', 'M4'])
    expect(g.text('M1').split(/<br\s*\/?>/)).toEqual(['§8.2 一階', 'F(z) = K'])
    expect(g.text('M2').split(/<br\s*\/?>/)).toEqual(['§8.3 更新延遲 d', 'F(z) = K·z⁻ᵈ'])
    expect(g.text('M3').split(/<br\s*\/?>/)).toEqual(['§8.4 雙迴路', 'F(z) = b_s·c_s/(z − r_s)'])
    expect(g.text('M4')).toContain('F(1)')
    expect(UNIFIED_LOOP_CHART).toContain('L_cal(z) = μ·F(z)/(z−1)')
    expect(g.classesOf('F')).toContain('focus')
    expect(g.classesOf('M4')).toContain('warn')
    // 實線那一圈和 §8.2 的圖是同一個：目標、加法點、暫存器的文字相同，只有 K 換成 F(z)
    const g0 = await flow(FIRST_ORDER_CHART)
    for (const id of ['A', 'S', 'I']) expect(g.text(id)).toBe(g0.text(id))
    expect(g.edge('S', 'F').text).toBe(g0.edge('S', 'K').text)
    expect(g.edge('I', 'S').text).toBe(g0.edge('I', 'S').text)

    // 照圖計算：Σ（＋a、−w_k）→ F（由 δ_0…δ_k 算出 G_k）→ 積分器 μ/(z−1)（w_{k+1} = w_k + μ·G_k）→ 回到 Σ 的負端
    const asDrawn = (a: number, w0: number, mu: number, F: (delta: number[]) => number, steps: number) => {
      const w = [w0]
      const delta: number[] = []
      for (let k = 0; k < steps; k++) {
        delta.push(a - w[k])
        w.push(w[k] + mu * F(delta))
      }
      delta.push(a - w[steps])
      return delta
    }
    const last = (x: number[], back = 0) => x[Math.max(0, x.length - 1 - back)] // δ_{k−back}；k < back 時沿用 δ_0（與 simulateDelayRecursion 的歷史約定相同）
    const a = 3
    const w0 = 1
    const steps = 60
    // M1：F(z) = K
    for (const [mu, K] of [
      [10, 0.0079788],
      [1.2, 1],
    ]) {
      const mine = asDrawn(a, w0, mu, (dl) => K * last(dl), steps)
      const ref = simulateDelayRecursion(mu * K, 0, steps, a - w0).delta
      for (let k = 0; k <= steps; k++) expect(mine[k]).toBeCloseTo(ref[k], 9)
    }
    // M2：F(z) = K·z⁻ᵈ（G_k = K·δ_{k−d}）——延遲併進 F(z)，和 DELAY_LOOP 把 z⁻ᵈ 畫在暫存器輸出是同一條遞迴式
    for (const d of [1, 2, 3]) {
      const K = 0.5
      const mu = 0.8
      const mine = asDrawn(a, w0, mu, (dl) => K * last(dl, d), 40)
      const ref = simulateDelayRecursion(mu * K, d, 40, a - w0).delta
      for (let k = 0; k <= 40; k++) expect(mine[k]).toBeCloseTo(ref[k], 9)
    }
    // M3：F(z) = b_s·c_s/(z − r_s)，脈衝響應 b_s·c_s·r_s^(n−1)（n ≥ 1）：G_k = b_s·c_s·Σ_{j<k} r_s^(k−1−j)·δ_j，不含 δ_k
    // M4：quasi-static 把它換成常數 F(1) = b_s·c_s/(1 − r_s)
    for (const p of [
      { r: 0.8, b: 0.2, c: 1, mu: 1.2 },
      { r: 0.8, b: 0.2, c: 1, mu: 0.5 },
      { r: 0, b: 1, c: 1, mu: 0.6 },
      { r: -0.5, b: 0.3, c: 2, mu: 0.9 },
    ]) {
      const conv = (dl: number[]) => {
        const k = dl.length - 1
        let acc = 0
        for (let j = 0; j < k; j++) acc += p.r ** (k - 1 - j) * dl[j]
        return p.b * p.c * acc
      }
      const full = asDrawn(a, w0, p.mu, conv, steps)
      const refFull = simulateFullModel(p, steps, a - w0).delta
      const quasi = asDrawn(a, w0, p.mu, (dl) => ((p.b * p.c) / (1 - p.r)) * last(dl), steps)
      const refQuasi = simulateQuasiStatic(p, steps, a - w0)
      for (let k = 0; k <= steps; k++) {
        expect(full[k]).toBeCloseTo(refFull[k], 8)
        expect(quasi[k]).toBeCloseTo(refQuasi[k], 8)
      }
    }
    // 頻域：框起來的兩格相乘 μ·F(e^{jω})/(e^{jω} − 1) 就是各節的開迴路增益
    const div = (x: { re: number; im: number }, y: { re: number; im: number }) => {
      const n = y.re * y.re + y.im * y.im
      return { re: (x.re * y.re + x.im * y.im) / n, im: (x.im * y.re - x.re * y.im) / n }
    }
    for (const w of [0.2, 1.1, 2.7]) {
      const z = { re: Math.cos(w), im: Math.sin(w) }
      const integ = (mu: number) => div({ re: mu, im: 0 }, { re: z.re - 1, im: z.im }) // μ/(z − 1)
      const mul = (x: { re: number; im: number }, y: { re: number; im: number }) => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re })
      for (const d of [0, 1, 2]) {
        const K = 0.4
        const mu = 1.5
        const F = { re: K * Math.cos(d * w), im: -K * Math.sin(d * w) } // K·z⁻ᵈ
        const mine = mul(F, integ(mu))
        const ref = calLoopGain(mu * K, d, w) // F-08.2（d = 0）、F-08.7
        expect(mine.re).toBeCloseTo(ref.re, 12)
        expect(mine.im).toBeCloseTo(ref.im, 12)
      }
      const p = { r: 0.8, b: 0.2, c: 1, mu: 0.5 }
      const F = div({ re: p.b * p.c, im: 0 }, { re: z.re - p.r, im: z.im }) // b_s·c_s/(z − r_s)
      const mine = mul(F, integ(p.mu))
      const ref = calLoopGainGeneral({ A: [[p.r]], b: [p.b], c: [p.c], d: 0 }, p.mu, w) // F-08.14、F-08.16
      expect(mine.re).toBeCloseTo(ref.re, 12)
      expect(mine.im).toBeCloseTo(ref.im, 12)
    }
  }, SLOW)

  it('T08: SYNTHESIS_FLOW 的計算順序照著算，得到入門課的數字（μ_max = 125.33 fs、PM_1 = 83.14°）', async () => {
    const g = await flow(SYNTHESIS_FLOW_CHART)
    expect(g.edges.map((e) => `${e.start}>${e.end}`).sort()).toEqual(
      ['SV>KQ', 'KQ>KK', 'CC>KK', 'KK>G', 'MU>G', 'G>P', 'DD>GS', 'GS>MM', 'KK>MM', 'GS>GM', 'G>GM', 'G>PM', 'DD>PM'].sort(),
    )
    expect(g.text('KQ')).toContain('K_q = √(2/π) / σ_v')
    expect(g.text('GS')).toBe('g*(d) = 2·sin(π/(4d+2))')
    expect(g.text('PM')).toBe('PM_d = 90° − (2d+1)·arcsin(g/2)')
    const sigmaV = 100
    const mu = 10
    const C = 1
    const d = 1
    const Kq = Math.sqrt(2 / Math.PI) / sigmaV
    expect(Kq).toBeCloseTo(comparatorKq(sigmaV), 15)
    const K = Kq * C
    const gain = mu * K
    expect(gain).toBeCloseTo(0.079788, 6)
    expect(1 - gain).toBeCloseTo(pmFirstOrder(gain).pole, 12)
    const gStar = 2 * Math.sin(Math.PI / (4 * d + 2))
    expect(gStar).toBeCloseTo(delayCriticalGain(d), 12)
    expect(gStar / K).toBeCloseTo(125.33, 2)
    const ref = pmWithDelay(gain, d)
    expect(20 * Math.log10(gStar / gain)).toBeCloseTo(ref.gmDb, 9)
    const pmD = 90 - (2 * d + 1) * ((Math.asin(gain / 2) * 180) / Math.PI)
    expect(pmD).toBeCloseTo(ref.pmDeg, 9)
    expect(pmD).toBeCloseTo(83.14, 2)
  }, SLOW)
})

describe('Ch08 頁面：系統地圖、所有方塊圖與章末符號表', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  /** 頁面送去 mermaid.render 的每一張圖的原始碼（依呼叫順序） */
  let sent: string[] = []
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sent = []
    // 版面由真正的瀏覽器負責（每張圖的真實 render 在上面逐張測過）；這裡只記下原始碼，回一個空的 SVG
    vi.spyOn(mermaid, 'render').mockImplementation(async (id: string, text: string) => {
      sent.push(text)
      return { svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' }
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  function renderChapter(mode: LearningMode) {
    localStorage.setItem('lmspll.mode', mode)
    const ui: ReactNode = <Chapter08 />
    return render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/08']}>{ui}</MemoryRouter>
      </SettingsProvider>,
    )
  }
  const sentCharts = () => sent

  /** 章首系統地圖 + 19 張方塊圖：出現順序、圖說、「讀圖」導讀、各節張數，以及「圖在推導之前」 */
  async function checkFigures(container: HTMLElement) {
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(CHARTS.length + 1)
    expect(figures).toHaveLength(20)
    await waitFor(() => expect(new Set(sentCharts()).size).toBe(CHARTS.length + 1), { timeout: 120_000 })
    // 第一張就是系統地圖（藍色：GMAC、÷N × μ、gain accumulator），其餘依 CH08_CHARTS 的順序出現
    const map = systemMapChart(SYSTEM_MAP_FOCUS)
    expect(map).toContain('class GMAC,SCALE,ACC focus')
    const firstSeen = [...new Set(sentCharts())]
    expect(firstSeen[0]).toBe(sanitizeMermaidSource(map))
    expect(firstSeen.slice(1)).toEqual(CHARTS.map(([, c]) => c))
    // 頁面送去 render 的每一張圖都能被真正的 parser 解析
    for (const chart of firstSeen) await mermaid.parse(chart)

    const text = container.textContent ?? ''
    // 系統地圖在開場問題之後、第一個小節之前，前面有一句說明藍色方塊與本章新增的觀點
    const mapFigure = figures[0]
    expect(mapFigure.getAttribute('aria-label') ?? '').toContain('系統方塊圖')
    expect(mapFigure.querySelector('figcaption')?.textContent ?? '').toContain('GMAC')
    expect(mapFigure.previousElementSibling?.textContent ?? '').toMatch(/系統地圖.*藍色的三個方塊.*回授迴路/)
    expect(text.indexOf('這一章要回答的問題')).toBeLessThan(text.indexOf('先看系統地圖'))
    expect(text.indexOf('先看系統地圖')).toBeLessThan(text.indexOf('先用一個生活例子'))
    expect(mapFigure.closest('section.c-section')).toBeNull()

    // 其餘 19 張：圖說夠長（說明要看什麼）；圖說裡的數學是 KaTeX（沒有殘留的 `$`、沒有用 Unicode 拼的公式）；
    // 圖的正後方是一段「讀圖：先看…再…」，把圖上的東西對到公式
    const captions = new Set<string>()
    /** 去掉 KaTeX 之後剩下的純文字（用來檢查「數學有沒有寫在 `$…$` 裡」） */
    const withoutMath = (el: Element | null | undefined) => {
      const clone = el?.cloneNode(true) as HTMLElement | undefined
      clone?.querySelectorAll('.katex').forEach((k) => k.remove())
      return clone?.textContent ?? ''
    }
    /** KaTeX 的 TeX 原始碼（annotation）：String.raw 裡多打一條反斜線（`\\mu`）會被 KaTeX 當成換行 + 文字，不會報錯 */
    const texSources = (el: Element | null | undefined) => Array.from(el?.querySelectorAll('annotation') ?? [], (x) => x.textContent ?? '')
    for (const fig of figures.slice(1)) {
      const figcaption = fig.querySelector('figcaption')
      const caption = figcaption?.textContent ?? ''
      expect(caption.length, caption).toBeGreaterThanOrEqual(20)
      expect(caption).not.toContain('$')
      expect(withoutMath(figcaption), caption).not.toMatch(/[μδΣωθφρσψΩ∠√π≤≥⁻ᵈ]|[A-Za-z]_[A-Za-z{]/)
      for (const tex of texSources(figcaption)) expect(tex, caption).not.toContain('\\\\')
      expect(fig.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
      captions.add(caption)
      const next = fig.nextElementSibling
      expect(next?.tagName, caption).toBe('P')
      const walk = next?.textContent ?? ''
      expect(walk, caption).toMatch(/^讀圖/)
      expect(walk, caption).toContain('先')
      expect(walk, caption).toMatch(/再[看往比順]|最後/)
      expect(walk, caption).not.toContain('$')
      for (const tex of texSources(next)) expect(tex, caption).not.toContain('\\\\')
      expect(next?.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
    }
    expect(captions.size).toBe(CHARTS.length)
    // 「讀圖」導讀把圖對到公式：除了路線圖、兩關流程圖、時序圖、根的五個階段與綜合手算（它們對到的是小節、表格或手算題），其餘都點名至少一條 F-08.x
    const walkOf = (name: Ch08ChartName) => figures[1 + CHARTS.findIndex(([k]) => k === name)].nextElementSibling?.textContent ?? ''
    const cites: Partial<Record<Ch08ChartName, string[]>> = {
      POLARITY_WRAP_CHART: ['F-08.1'],
      FIRST_ORDER_CHART: [],
      LOOP_CUT_CHART: ['F-08.2'],
      PM_FLOW_CHART: ['F-08.3', 'F-08.4', 'F-08.5', 'F-08.6'],
      DELAY_LOOP_CHART: ['F-08.7'],
      ROOT_STATES_CHART: ['F-08.8', 'F-08.9'],
      PHASE_BUDGET_CHART: ['F-08.8', 'F-08.9'],
      DUAL_LOOP_CHART: ['F-08.10'],
      DUAL_SIGNAL_FLOW_CHART: ['F-08.10'],
      LATENCY_SPLIT_CHART: ['F-08.11'],
      DUAL_REGIMES_CHART: ['F-08.11', 'F-08.12'],
      STATE_SPACE_CHART: ['F-08.13', 'F-08.14'],
      STABILITY_CHECK_CHART: ['F-08.13', 'F-08.14'],
      UNIFIED_LOOP_CHART: ['F-08.2', 'F-08.7', 'F-08.14', 'F-08.16'],
    }
    for (const [name, ids] of Object.entries(cites) as [Ch08ChartName, string[]][]) for (const id of ids) expect(walkOf(name), `${name} 的導讀要提到 ${id}`).toContain(id)
    // 每個主要小節都有圖：開場一張、§8.1 三張、§8.2 三張、§8.3 四張、§8.4 六張、比較表一張、綜合手算一張
    const figs = (id: string) => Array.from(container.querySelectorAll(`[id="${id}"] figure.c-mermaid`))
    expect(figs('ch08-intro')).toHaveLength(1)
    expect(figs('ch08-polarity')).toHaveLength(3)
    expect(figs('ch08-first-order')).toHaveLength(3)
    expect(figs('ch08-delay')).toHaveLength(4)
    expect(figs('ch08-dual-loop')).toHaveLength(6)
    expect(figs('ch08-compare')).toHaveLength(1)
    expect(figs('ch08-handcalc-synthesis')).toHaveLength(1)
    CHARTS.forEach(([name], i) => expect(figures[i + 1].closest('section.c-section')?.id, name).toBe(SECTION_OF[name]))
    // 圖在推導之前：各節的圖都排在對應公式錨點之前
    const before = (a: Element | null | undefined, b: Element | null | undefined) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const anchor = (f: string) => container.querySelector(`[id="formula-${f}"]`)
    expect(before(figs('ch08-polarity')[0], anchor('F-08.1'))).toBe(true) // 兩條路徑 → polarity margin 之前
    expect(before(figs('ch08-polarity')[1], anchor('F-08.1'))).toBe(true) // wrap 的手算順序 → F-08.1 之前
    expect(before(anchor('F-08.1'), figs('ch08-polarity')[2])).toBe(true) // 兩關流程圖是 §8.1 → §8.2 的過場
    expect(before(figs('ch08-first-order')[0], anchor('F-08.2'))).toBe(true)
    expect(before(figs('ch08-first-order')[1], anchor('F-08.2'))).toBe(true) // 剪開迴路 → L_cal 之前
    expect(before(figs('ch08-first-order')[2], anchor('F-08.4'))).toBe(true) // PM 手算流程 → crossover 之前
    expect(before(figs('ch08-delay')[0], anchor('F-08.7'))).toBe(true) // 時序圖 → 遞迴式之前
    expect(before(figs('ch08-delay')[1], anchor('F-08.7'))).toBe(true) // 延遲迴路 → 特徵式之前
    expect(before(figs('ch08-delay')[2], anchor('F-08.8'))).toBe(true) // 根的移動 → 臨界增益之前
    expect(before(anchor('F-08.8'), figs('ch08-delay')[3])).toBe(true) // 相位預算：在根軌跡（F-08.8）之後…
    expect(before(figs('ch08-delay')[3], anchor('F-08.9'))).toBe(true) // …含延遲的 PM（F-08.9）之前
    expect(before(figs('ch08-dual-loop')[0], anchor('F-08.10'))).toBe(true) // 方程式版 → 二狀態矩陣之前
    expect(before(figs('ch08-dual-loop')[1], anchor('F-08.10'))).toBe(true) // 訊號流對照 → 二狀態矩陣之前
    expect(before(figs('ch08-dual-loop')[2], anchor('F-08.16'))).toBe(true) // 三種觀測並排 → 頻域證明之前
    expect(before(figs('ch08-dual-loop')[3], anchor('F-08.12'))).toBe(true) // μ 的四個區間 → 複數 pole 門檻之前
    expect(before(figs('ch08-dual-loop')[4], anchor('F-08.13'))).toBe(true) // state-space 訊號流 → 合併矩陣之前
    expect(before(figs('ch08-dual-loop')[5], anchor('F-08.13'))).toBe(true) // 檢查流程 → 合併矩陣之前
    const compareTables = container.querySelectorAll('[id="ch08-compare"] table')
    expect(compareTables).toHaveLength(2)
    expect(before(compareTables[0], figs('ch08-compare')[0])).toBe(true) // 同一個迴路 → 在兩種 margin 的表之後…
    expect(before(figs('ch08-compare')[0], compareTables[1])).toBe(true) // …六種模型的比較表之前
    expect(before(figs('ch08-handcalc-synthesis')[0], container.querySelector('[id="handcalc-HC-08.8"]'))).toBe(true)
    // 每一條登錄的公式（F-08.1 … F-08.16）前面、同一個小節裡都至少有一張圖
    for (let n = 1; n <= 16; n++) {
      const f = anchor(`F-08.${n}`)
      const section = f?.closest('section.c-section')
      expect(section, `F-08.${n}`).toBeTruthy()
      const inSection = Array.from(section!.querySelectorAll('figure.c-mermaid'))
      expect(inSection.some((fig) => before(fig, f)), `F-08.${n} 之前沒有圖`).toBe(true)
    }
  }

  it('beginner 模式：章首有 <SystemMap>、19 張方塊圖全部出現（不藏在進階模式裡）；不展開任何推導，每個符號第一次出現時正文都有一句就地說明', async () => {
    const { container } = renderChapter('beginner')
    await checkFigures(container)
    // 只看「正文」：排除章末符號表、收合的推導／先備知識、程式碼、互動實驗、手算題、思考題與 KaTeX 的 annotation
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll(`[id="${SYMBOLS_ID}"], details, .c-code, .c-experiment, .c-handcalc, .c-quiz, annotation`).forEach((el) => el.remove())
    const text = (prose.textContent ?? '').replace(/\s+/g, ' ')
    for (const phrase of [
      // §8.1
      '兩條路徑的總相位差', // θ
      '把角度折回', // wrap180
      'polarity margin，記成', // M_polarity
      '折回後的角度記成', // ψ
      '離散頻率，單位 rad/sample', // Ω
      '只被延遲', // D（code delay）
      // §8.2
      '還沒修掉的剩餘誤差', // δ_k
      '吐出一個平均相關', // G_k
      'comparator 統計增益', // K = K_q C
      '是學習率（每次修正的步長，單位 fs）', // μ
      '叫正規化 loop gain', // g
      '代表延遲一個 block', // z
      '叫開迴路增益（loop gain），記成', // L_cal
      'block rate 上的離散頻率', // ω
      '（gain crossover）是開迴路增益大小剛好等於', // ω_c
      '（phase margin）是在', // PM
      '（gain margin）是 loop gain 還能再放大幾倍', // GM
      '（delay margin）是迴路還能再多塞幾個 block', // DM
      // §8.3
      '叫更新延遲（update delay，單位：block）', // d
      '叫臨界增益，記成', // g*(d)
      '所有根的絕對值裡最大的那一個', // ρ
      '是閉迴路的特徵多項式', // P(z)
      '臨界時那個根在單位圓上的角度', // ω*
      '延遲時的 phase margin 記成', // PM_d
      'gain margin 記成', // GM_d
      // §8.4
      '是「觀察到第幾個 block 為止」', // N_blk
      '主 PLL 對過去誤差的記憶', // s_k
      '每個 block 保留下來的比例', // r_s
      '灌進', // b_s
      '讀出', // c_s
      '觀測轉移函數', // F(z)
      '是等效 loop gain', // g_eff
      '是 phase crossover：開迴路相位剛好到', // ω_180
      '狀態矩陣：', // A_s
      '直通項：', // d_s
      '把觀測狀態和', // A_comb
      // 綜合手算
      '是學習率上限', // μ_max
    ]) {
      expect(text, `正文少了就地說明：「${phrase}」`).toContain(phrase)
    }
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)

  it('engineer 模式：同樣的 20 張圖；符號表在頁面最後（id="symbols"），章首只留一行按鈕，按下去捲到符號表、再按「回到章首」捲回來', async () => {
    const { container } = renderChapter('engineer')
    await checkFigures(container)

    const root = container.querySelector('.ch08') as HTMLElement
    const symbols = container.querySelector(`[id="${SYMBOLS_ID}"]`) as HTMLElement
    expect(SYMBOLS_ID).toBe('symbols')
    expect(symbols).toBeTruthy()
    // 最後一個區塊：.ch08 的最後一個子元素，而且排在「本課必記」（Recap）之後
    expect(root.lastElementChild).toBe(symbols)
    const recap = container.querySelector('.c-recap')
    expect(recap).toBeTruthy()
    expect(recap!.compareDocumentPosition(symbols) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 符號表後面沒有任何方塊圖或小節；頁面上也只有這一個 id="symbols"
    expect(container.querySelectorAll('[id="symbols"]')).toHaveLength(1)
    for (const el of Array.from(container.querySelectorAll('figure.c-mermaid, section.c-section, .c-recap'))) {
      expect(el.compareDocumentPosition(symbols) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // 全頁只有一張符號表，內容完整（每個符號一列）；圖上出現的符號（ψ、ω*、PM_d／GM_d、μ_max）也都列了
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(SYMBOLS.length)
    expect(SYMBOLS.length).toBe(29)
    expect(new Set(SYMBOLS.map((r) => r.symbol)).size).toBe(SYMBOLS.length)
    for (const sym of [String.raw`\psi`, String.raw`\omega^{*}`, String.raw`PM_d,\;GM_d`, String.raw`\mu_{\max}`, String.raw`\delta_k=a-w_k`]) {
      expect(SYMBOLS.map((r) => r.symbol), sym).toContain(sym)
    }
    for (const row of SYMBOLS) {
      expect(row.firstSeen, row.symbol).toMatch(/^(§8\.[1-4]|實驗 1|綜合手算)$/)
      expect(row.unit, row.symbol).toBeTruthy()
    }
    // 依第一次出現的順序：§8.1 → §8.2 → §8.3 → 實驗 1 → §8.4 → 綜合手算
    const order = ['§8.1', '§8.2', '§8.3', '實驗 1', '§8.4', '綜合手算']
    const ranks = SYMBOLS.map((r) => order.indexOf(r.firstSeen ?? ''))
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
    expect(symbols.textContent).toContain('本章符號表')
    expect(symbols.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
    // 章首：一行連結，在系統地圖之後、第一個小節之前；不是會改變路由的 <a href="#…">
    const link = container.querySelector(`[id="${SYMBOLS_LINK_ID}"]`) as HTMLElement
    expect(link.tagName).toBe('P')
    const button = link.querySelector('button') as HTMLButtonElement
    expect(button.textContent).toBe('本章符號表在最後 ↓')
    expect(button.type).toBe('button')
    expect(container.querySelectorAll('a[href*="#symbols"]')).toHaveLength(0)
    expect(link.querySelectorAll('a')).toHaveLength(0)
    const text = container.textContent ?? ''
    expect(text.split('本章符號表在最後')).toHaveLength(2) // 只有章首那一行
    expect(text.indexOf('本章符號表在最後')).toBeGreaterThan(text.indexOf('先看系統地圖'))
    expect(text.indexOf('本章符號表在最後')).toBeLessThan(text.indexOf('先用一個生活例子'))
    expect(text.indexOf('本章符號表（依第一次出現的順序）')).toBeGreaterThan(text.indexOf('應該記住的'))

    // jsdom 沒有 scrollIntoView：裝一個替身，確認是對 #symbols 呼叫的，而且路由（hash）沒有被改掉
    const calls: string[] = []
    const proto = window.HTMLElement.prototype as unknown as { scrollIntoView?: () => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: HTMLElement) {
      calls.push(this.id)
    }
    try {
      const hashBefore = window.location.hash
      act(() => {
        fireEvent.click(button)
      })
      expect(calls).toEqual(['symbols'])
      expect(document.activeElement).toBe(symbols)
      const back = symbols.querySelector('button') as HTMLButtonElement
      expect(back.textContent).toBe('↑ 回到章首')
      act(() => {
        fireEvent.click(back)
      })
      expect(calls).toEqual(['symbols', SYMBOLS_LINK_ID])
      expect(document.activeElement).toBe(link)
      expect(window.location.hash).toBe(hashBefore)
    } finally {
      proto.scrollIntoView = original
    }
    // 沒有 scrollIntoView 的環境（舊瀏覽器、jsdom）按了也不會拋錯
    act(() => {
      fireEvent.click(button)
    })
    expect(errorSpy).not.toHaveBeenCalled()
  }, SLOW)
})
