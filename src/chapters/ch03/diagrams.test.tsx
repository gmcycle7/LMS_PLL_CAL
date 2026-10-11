import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { systemMapChart } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import { SettingsProvider } from '@/app/settings'
import { normInv } from '@/simulation/core'
import { cltLog10Quantile, logFactorVariance, stabilityBounds, stabilityFactors, xMoments, type XDist } from '@/simulation/models/scalarStability'
import Chapter03 from './index'
import {
  CHART_BLOCK_GMAC,
  CHART_CLT_FLOW,
  CHART_ERROR_RECURSION,
  CHART_G_BUILD,
  CHART_HEAVY_TAIL,
  CHART_IMPLICATIONS,
  CHART_KURTOSIS_COMPARE,
  CHART_LMS_LOOP,
  CHART_LOG_SUM,
  CHART_MC_COMPARE,
  CHART_MC_FLOW,
  CHART_MEAN_PATH,
  CHART_MSD_LOOP,
  CHART_MU_REGIONS,
  CHART_NAIVE_VS_ONESTEP,
  CHART_NOISE_INJECTION,
  CHART_PLL_MAPPING,
  CHART_POLE_REGIME,
  CHART_RANDOM_GAIN,
  CHART_SYNTHESIS_FLOW,
  CHART_TAU_FLOW,
  CHART_THREE_PATHS,
  CHART_WHICH_BOUND,
  DIAGRAMS,
  figNo,
  figRef,
  SYSTEM_FOCUS,
} from './diagrams'

/**
 * 本檔用「真正的」mermaid（parser 與 renderer）檢查本章每一張方塊圖；
 * 只把共用的 <Mermaid> 元件換成「把原始碼印出來」的替身（外框、圖說與真的元件相同：<figure> 裡一個 <figcaption>，`$…$` 以 KaTeX 排版），
 * 才能在 jsdom 裡看到頁面實際送去畫的是哪些圖、順序如何、圖說寫了什麼。
 * （ch03.test.tsx 為了速度把整個 mermaid 套件 mock 掉，所以圖的語法與「真的畫得出來」由這裡負責。）
 */
vi.mock('@/components/Mermaid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/Mermaid')>()
  const { mathText } = await import('@/components/Tex')
  return {
    ...actual,
    Mermaid: ({ chart, caption, ariaLabel }: { chart: string; caption?: string; ariaLabel?: string }) => (
      <figure className="c-mermaid" aria-label={ariaLabel}>
        <pre data-testid="mermaid-src">{chart}</pre>
        {caption && <figcaption className="c-figcaption">{mathText(caption)}</figcaption>}
      </figure>
    ),
  }
})

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

const GAUSS: XDist = { kind: 'gaussian', sigma: 1 }
const UNIF: XDist = { kind: 'uniform', halfWidth: Math.sqrt(3) }
const PM1: XDist = { kind: 'pm_one', amplitude: 1 }
const SPARSE: XDist = { kind: 'list', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] }

/** 本章應該有的方塊圖數量（不含章首的 SystemMap） */
const N_DIAGRAMS = 23
/** 規範 §8：單張不超過約 14 個節點 */
const MAX_NODES = 14
/** 逾時只是保險（整章在 jsdom 渲染上千條 KaTeX；多個測試程序同時跑時會慢很多） */
const SLOW = 6

interface FlowDb {
  getVertices(): Map<string, { text?: string }>
  getEdges(): { start: string; end: string; text?: string }[]
}
async function flowDb(chart: string): Promise<FlowDb> {
  const d = await mermaid.mermaidAPI.getDiagramFromText(chart)
  return d.db as unknown as FlowDb
}
/** mermaid 的 db 會先把文字消毒（`<` → `&lt;`、`<br/>` → `<br>`）；還原成原始碼裡寫的樣子再比對 */
const decode = (t: string) => t.replace(/<br\s*\/?>/g, '<br/>').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
/** 圖上所有看得到的文字（節點與線上的標籤） */
async function labels(chart: string): Promise<string[]> {
  const db = await flowDb(chart)
  return [...[...db.getVertices().values()].map((v) => v.text ?? ''), ...db.getEdges().map((e) => e.text ?? '')].filter((t) => t !== '').map(decode)
}
/** 某個節點的文字 */
async function nodeText(chart: string, id: string): Promise<string> {
  const v = (await flowDb(chart)).getVertices().get(id)
  if (!v) throw new Error(`圖上沒有節點 ${id}`)
  return decode(v.text ?? '')
}
/** 某一條線（start → end）的標籤 */
async function edgeText(chart: string, start: string, end: string): Promise<string> {
  const e = (await flowDb(chart)).getEdges().find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`圖上沒有 ${start} → ${end} 這條線`)
  return decode(e.text ?? '')
}

describe('Ch03 方塊圖：Mermaid 原始碼（真正的 mermaid parser）', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it(`共 ${N_DIAGRAMS} 張，登錄不重複，圖號依登錄順序`, () => {
    expect(DIAGRAMS).toHaveLength(N_DIAGRAMS)
    expect(new Set(DIAGRAMS.map((d) => d.name)).size).toBe(N_DIAGRAMS)
    expect(new Set(DIAGRAMS.map((d) => d.chart)).size).toBe(N_DIAGRAMS)
    expect(figNo(CHART_THREE_PATHS)).toBe(1)
    expect(figRef(CHART_SYNTHESIS_FLOW)).toBe(`圖 3-${N_DIAGRAMS}`)
    expect(() => figNo('flowchart LR\n  A --> B')).toThrow(/沒有登錄/)
    for (const d of DIAGRAMS) {
      expect(d.shows.length, d.name).toBeGreaterThan(5)
      // 第一行是共用的版面設定（init directive），第二行才是圖的種類與方向
      const [first, second] = d.chart.split('\n')
      expect(first, d.name).toBe('%%{init: {"flowchart": {"nodeSpacing": 34, "rankSpacing": 38}}}%%')
      expect(second, d.name).toMatch(/^flowchart (LR|TB|TD)$/)
    }
  })

  it.each(DIAGRAMS.map((d) => [d.name, d.chart] as const))('%s 可以解析，節點數不超過上限', async (_name, chart) => {
    const r = await mermaid.parse(chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
    const n = (await flowDb(chart)).getVertices().size
    expect(n).toBeGreaterThanOrEqual(3)
    expect(n).toBeLessThanOrEqual(MAX_NODES)
  })

  it('章首系統地圖（SystemMap）的原始碼可以解析，並標出本章的三個方塊', async () => {
    const chart = systemMapChart(SYSTEM_FOCUS)
    await mermaid.parse(chart, { suppressErrors: false })
    expect(SYSTEM_FOCUS).toEqual(['res', 'scale', 'acc'])
    expect(chart).toContain('class RES,SCALE,ACC focus')
  })

  it('文字不會被 mermaid 當成 Markdown／HTML 吃掉：沒有單獨的半形「+」、不以清單／標題記號開頭、「<」後面不直接接字母', async () => {
    for (const d of DIAGRAMS) {
      // <br/> 是唯一允許的 HTML；其餘的「<」都必須是數學的小於（後面不可直接接字母，否則會被當成標籤整段吃掉）
      expect(d.chart.replace(/<br\/>/g, ''), d.name).not.toMatch(/<[A-Za-z/!?]/)
      expect(d.chart, d.name).not.toMatch(/&[a-z]+;|#[a-z0-9]+;/i) // 不用 HTML／mermaid 的字元實體
      const all = await labels(d.chart)
      expect(all.length, d.name).toBeGreaterThanOrEqual(6)
      for (const full of all) {
        const lines = full.split('<br/>')
        for (const t of lines) {
          const where = `${d.name}：「${t}」`
          expect(t.trim(), where).not.toBe('')
          expect(t, where).not.toMatch(/^\s*(?:[-+*]|\d+[.)])(?:\s|$)/) // Markdown 清單
          expect(t, where).not.toMatch(/^\s*(?:#{1,6}\s|>)/) // 標題、引言
          expect(t, where).not.toMatch(/[*`~$\\]/) // 強調、程式碼、刪除線、TeX 記號
          expect(t, where).not.toMatch(/(^|\s)_|_(\s|$)/) // 底線只用在 P_x、M_4、μ_MS 這種「字_字」（不會變成斜體）
        }
      }
      // 圖裡不寫 TeX／KaTeX（Mermaid 不渲染），也不留樣板字串的插值痕跡
      expect(d.chart, d.name).not.toMatch(/\$\{|undefined|\\[a-z]+/)
    }
  })
})

describe('Ch03 方塊圖：真的畫出來（jsdom + 共用的 mermaidTestUtils，與網站相同的前處理）', () => {
  beforeAll(installMermaidSvgShim)

  /** 比對用：拿掉換行標籤與所有空白（mermaid 會把標籤拆成數行） */
  const squash = (t: string) => decode(t).replace(/<br\/>/g, '').replace(/\s+/g, '')

  it.each(DIAGRAMS.map((d) => [d.name, d.chart] as const))(
    '%s：畫得出來、沒有「Unsupported markdown」、節點數不超過上限、每個標籤都在圖上',
    async (name, chart) => {
      const { svg, text, nodeCount } = await renderMermaidForTest(chart)
      expect(svg).toContain('<svg')
      expect(text).not.toMatch(/Unsupported markdown/)
      expect(text).not.toMatch(/Syntax error/i)
      expect(svg).not.toMatch(/<em>|<strong>|<del>|<code>/) // 沒有被當成 Markdown 的強調／程式碼
      // 節點數（子圖標題不算節點）：畫出來的和 parser 看到的一樣多，而且不超過規範 §8 的上限
      expect(nodeCount).toBe((await flowDb(chart)).getVertices().size)
      expect(nodeCount).toBeGreaterThanOrEqual(3)
      expect(nodeCount).toBeLessThanOrEqual(MAX_NODES)
      // 每個節點、每條線上的文字都真的出現在輸出裡（沒有被 sanitizer 或 Markdown 處理截掉）
      const drawn = squash(text)
      for (const label of await labels(chart)) {
        const want = squash(label)
        expect(drawn.includes(want), `${name}：輸出裡找不到「${want}」`).toBe(true)
      }
    },
    60000,
  )

  it('章首系統地圖（全站共用，節點數由 SystemMap.test.tsx 負責）也畫得出來、沒有「Unsupported markdown」', async () => {
    const { svg, text } = await renderMermaidForTest(systemMapChart(SYSTEM_FOCUS))
    expect(svg).toContain('<svg')
    expect(text).not.toMatch(/Unsupported markdown/)
    expect(text).toContain('Gain accumulator')
  }, 60000)
})

describe('Ch03 方塊圖：內容與本章公式、模型一致', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it('LMS 迴圈的極性：e = y − w·x（y 進加法點為＋、w·x 為−），修正量 μ·e·x 由累加器加到 w 上，延遲一步後回到模型', async () => {
    expect(await edgeText(CHART_LMS_LOOP, 'SYS', 'CMP')).toBe('＋ y = a·x')
    expect(await edgeText(CHART_LMS_LOOP, 'MOD', 'CMP')).toBe('− w[n]·x')
    expect(await edgeText(CHART_LMS_LOOP, 'CMP', 'GAIN')).toBe('e[n] = y − w[n]·x')
    expect(await edgeText(CHART_LMS_LOOP, 'GAIN', 'ACC')).toBe('修正量 μ·e[n]·x')
    expect(await nodeText(CHART_LMS_LOOP, 'ACC')).toBe('累加器<br/>w[n+1] = w[n] + 修正量')
    expect(await edgeText(CHART_LMS_LOOP, 'ACC', 'MOD')).toBe('延遲一步：w[n]')
    // 修正量 = μ × 誤差 × 輸入：乘上去的 x 和送進系統／模型的是同一個（虛線）
    expect(await nodeText(CHART_LMS_LOOP, 'GAIN')).toBe('× μ·x')
    expect(await edgeText(CHART_LMS_LOOP, 'X', 'GAIN')).toBe('同一個 x')
    // 數字驗算（T01 的手算）：a = 3、w0 = 1、x = 2、μ = 0.1 → 照圖走一圈得 w1 = 1.8
    const [a, w0, x, mu] = [3, 1, 2, 0.1]
    const e0 = a * x - w0 * x
    expect(w0 + mu * e0 * x).toBeCloseTo(1.8, 12)
  })

  it('誤差遞迴的迴圈：δ[n] 以＋進加法點、μx²·δ[n] 以−進加法點，合併後增益 p = 1 − μx²', async () => {
    expect(await edgeText(CHART_ERROR_RECURSION, 'Z1', 'S1')).toBe('＋ δ[n]')
    expect(await edgeText(CHART_ERROR_RECURSION, 'G1', 'S1')).toBe('− μx²·δ[n]')
    expect(await edgeText(CHART_ERROR_RECURSION, 'P2', 'Z2')).toBe('δ[n+1] = p·δ[n]')
    expect(CHART_ERROR_RECURSION).toContain('p = 1 − μx²')
    // 兩種畫法數值相同：δ − μx²δ = (1 − μx²)δ；x = 2、μ = 0.1 → p = 0.6
    const [delta, x, mu] = [2, 2, 0.1]
    expect(delta - mu * x * x * delta).toBeCloseTo((1 - mu * x * x) * delta, 12)
    expect(1 - mu * x * x).toBeCloseTo(0.6, 12)
  })

  it('p 的決策樹：每個葉子的 μ 範圍與 p 範圍互相對應（以 x = 2 的五個 μ 各走一條分支）', async () => {
    const leaf = (id: string) => nodeText(CHART_POLE_REGIME, id)
    expect(await leaf('MONO')).toContain('0 < μ < 1/x²')
    expect(await leaf('DEAD')).toContain('μ = 1/x²')
    expect(await leaf('OSC')).toContain('1/x² < μ < 2/x²')
    expect(await leaf('EDGE')).toContain('μ = 2/x²')
    expect(await leaf('DIV1')).toContain('μ > 2/x²')
    expect(await leaf('DIV2')).toContain('μ < 0')
    const x = 2
    const branch = (mu: number) => {
      const p = 1 - mu * x * x
      const abs = Math.abs(p)
      if (Math.abs(abs - 1) < 1e-12) return p < 0 ? 'EDGE' : 'STUCK'
      if (abs < 1) return Math.abs(p) < 1e-12 ? 'DEAD' : p > 0 ? 'MONO' : 'OSC'
      return p < 0 ? 'DIV1' : 'DIV2'
    }
    expect([0.1, 0.25, 0.4, 0.5, 0.6, 0, -0.01].map(branch)).toEqual(['MONO', 'DEAD', 'OSC', 'EDGE', 'DIV1', 'STUCK', 'DIV2'])
    // 葉子上的 μ 邊界：1/x² = 0.25、2/x² = 0.5
    expect([1 / (x * x), 2 / (x * x)]).toEqual([0.25, 0.5])
  })

  it('地圖與 μ 軸上的 Gaussian 界限（2、2/3、2.4212）就是 stabilityBounds 算出來的數字', () => {
    const b = stabilityBounds(GAUSS)
    expect(b.meanMax).toBeCloseTo(2, 12)
    expect(b.msMax).toBeCloseTo(2 / 3, 12)
    expect(b.asMax.toPrecision(5)).toBe('2.4212')
    for (const c of [CHART_THREE_PATHS, CHART_MU_REGIONS, CHART_IMPLICATIONS, CHART_SYNTHESIS_FLOW]) expect(c).toContain('2.4212')
    expect(CHART_THREE_PATHS).toContain('0 < μ < 2/P_x<br/>N(0,1)：μ < 2"')
    expect(CHART_THREE_PATHS).toContain('0 < μ < 2P_x/M_4<br/>N(0,1)：μ < 2/3"')
    expect(CHART_THREE_PATHS).toContain('N(0,1)：μ < 2.4212"')
    // μ 軸：區間端點的歸屬（恰在界限上＝不收斂）
    expect(CHART_MU_REGIONS).toContain('0 < μ < 2/3<br/>mean ✓、MS ✓、a.s. ✓')
    expect(CHART_MU_REGIONS).toContain('2/3 ≤ μ < 2<br/>mean ✓、MS ✗、a.s. ✓')
    expect(CHART_MU_REGIONS).toContain('2 ≤ μ < 2.4212<br/>mean ✗、MS ✗、a.s. ✓')
    expect(CHART_MU_REGIONS).toContain('μ ≥ 2.4212<br/>mean ✗、MS ✗、a.s. ✗')
  })

  it('g 的組成（＋1、−2μP_x、＋μ²M_4）與三種分布的 κ、MS 界和模型一致', async () => {
    expect(await edgeText(CHART_G_BUILD, 'ONE', 'S')).toBe('＋ 1')
    expect(await edgeText(CHART_G_BUILD, 'T1', 'S')).toBe('− 2μP_x')
    expect(await edgeText(CHART_G_BUILD, 'T2', 'S')).toBe('＋ μ²M_4')
    expect(await edgeText(CHART_G_BUILD, 'S', 'CHK')).toBe('g(μ) = 1 − 2μP_x + μ²M_4')
    const rows: [XDist, string, string][] = [
      [PM1, 'κ = 1', 'MS 界 = 2 ÷ 1 = 2'],
      [UNIF, 'κ = 9/5', 'MS 界 = 2 ÷ 1.8 = 10/9'],
      [GAUSS, 'κ = 3', 'MS 界 = 2 ÷ 3 = 2/3'],
    ]
    const frac = (s: string) => {
      const [n, d] = s.split('/').map(Number)
      return d === undefined ? n : n / d
    }
    for (const [dist, kTxt, bTxt] of rows) {
      const m = xMoments(dist)
      const b = stabilityBounds(dist)
      expect(CHART_KURTOSIS_COMPARE).toContain(kTxt)
      expect(CHART_KURTOSIS_COMPARE).toContain(bTxt)
      expect(m.Px).toBeCloseTo(1, 12) // 三者功率相同 → mean 界都是 2
      expect(b.meanMax).toBeCloseTo(2, 12)
      expect(m.kurtosis).toBeCloseTo(frac(kTxt.split('= ')[1]), 12)
      expect(b.msMax).toBeCloseTo(frac(bTxt.split('= ').pop()!), 12)
      expect(b.msMax).toBeCloseTo(b.meanMax / m.kurtosis, 12)
    }
  })

  it('雜訊注入：v 以＋加在誤差上、修正量以−進入 δ；MSD 迴圈的注入量與不動點公式', async () => {
    expect(await edgeText(CHART_NOISE_INJECTION, 'M1', 'A')).toBe('＋ δ[n]·x[n]')
    expect(await edgeText(CHART_NOISE_INJECTION, 'V', 'A')).toBe('＋ v[n]')
    expect(await edgeText(CHART_NOISE_INJECTION, 'A', 'G')).toBe('e[n] = δ[n]·x[n] + v[n]')
    expect(await edgeText(CHART_NOISE_INJECTION, 'G', 'S')).toBe('− μ·x[n]·e[n]')
    expect(await edgeText(CHART_NOISE_INJECTION, 'Z', 'S')).toBe('＋ δ[n]')
    expect(await nodeText(CHART_NOISE_INJECTION, 'G')).toBe('× μ·x[n]')
    expect(await edgeText(CHART_NOISE_INJECTION, 'X', 'G')).toBe('同一個 x[n]')
    // 照圖走一步 = scalarStability.ts 的 pathStep：δ' = (1 − μx²)δ − μ·x·v
    const [delta, x, v, mu] = [0.7, -1.3, 0.25, 0.4]
    const e = delta * x + v
    expect(delta - mu * x * e).toBeCloseTo((1 - mu * x * x) * delta - mu * x * v, 12)
    expect(CHART_MSD_LOOP).toContain('μ²·P_x·σ_v²')
    expect(CHART_MSD_LOOP).toContain('穩態 MSD∞ = 注入 ÷ (1 − g)<br/>= μ·P_x·σ_v² ÷ (2P_x − μM_4)')
    expect(CHART_MSD_LOOP).toContain('E[e²] = P_x·MSD∞ + σ_v²')
    // 注入 ÷ (1 − g) 與化簡後的式子相等（固定 x = 2、μ = 0.1、σ_v = 1 → 0.0625，思考題 5）
    const [Px, M4, s2] = [4, 16, 1]
    const g = 1 - 2 * 0.1 * Px + 0.01 * M4
    expect((0.01 * Px * s2) / (1 - g)).toBeCloseTo((0.1 * Px * s2) / (2 * Px - 0.1 * M4), 12)
    expect((0.01 * Px * s2) / (1 - g)).toBeCloseTo(0.0625, 12)
  })

  it('推論關係圖的兩個反例區間：稀疏 code 2/9 < μ < 20/9、Gaussian 2 < μ < 2.4212', async () => {
    expect(await edgeText(CHART_IMPLICATIONS, 'MS', 'MEAN')).toContain('g ≥ (1 − μP_x)²')
    expect(await edgeText(CHART_IMPLICATIONS, 'MS', 'AS')).toContain('λ ≤ ½·ln g')
    expect(await edgeText(CHART_IMPLICATIONS, 'MEAN', 'AS')).toContain('2/9 < μ < 20/9')
    expect(await edgeText(CHART_IMPLICATIONS, 'AS', 'MEAN')).toContain('2 < μ < 2.4212')
    const sp = stabilityBounds(SPARSE)
    expect(sp.meanMax).toBeCloseTo(20 / 9, 12)
    expect(sp.asMax).toBeCloseTo(2 / 9, 9)
  })

  it('CLT 流程圖的常數 1.2816 = Φ⁻¹(0.9)；log 域圖、Monte Carlo 流程圖與 block 圖的關鍵式子', async () => {
    expect(normInv(0.9).toFixed(4)).toBe('1.2816')
    expect(CHART_CLT_FLOW).toContain('z = (ln ε − n·λ) ÷ (s·√n)')
    expect(CHART_CLT_FLOW).toContain('n·λ ∓ 1.2816·s·√n')
    expect(CHART_CLT_FLOW).toContain('n > (1.2816·s ÷ λ)²')
    expect(CHART_MC_FLOW).toContain('ln|δ[n+1]| = ln|δ[n]| + ln|1 − μ·x[n]²|')
    expect(await edgeText(CHART_LOG_SUM, 'LN', 'ACC')).toBe('Y[k] = ln|f[k]|')
    expect(await edgeText(CHART_LOG_SUM, 'ACC', 'AVG')).toBe('ln(|δ[n]| ÷ |δ[0]|)')
    expect(await nodeText(CHART_LOG_SUM, 'AVG')).toContain('得到 λ = E ln|f|')
    expect(CHART_NAIVE_VS_ONESTEP).toContain('SE = √((h − g²) ÷ M)')
    expect(CHART_NAIVE_VS_ONESTEP).toContain('真實 SE = √((hⁿ − g²ⁿ)·δ[0]⁴ ÷ M)')
    // Lab 的比對圖：每一列左邊是 MC 量到的量、右邊是預測
    expect(await edgeText(CHART_MC_COMPARE, 'A3', 'B3')).toBe('相差 0.05 以內')
    expect(await edgeText(CHART_MC_COMPARE, 'A4', 'B4')).toBe('±4 SE 以內')
    expect(await nodeText(CHART_MC_COMPARE, 'B2')).toContain('n·λ ∓ 1.2816·s·√n')
    expect(await nodeText(CHART_MC_COMPARE, 'B3')).toContain('Φ((ln ε − n·λ) ÷ (s·√n))')
    expect(await nodeText(CHART_MC_COMPARE, 'B5')).toContain('E[δ[n]²] = gⁿ·δ[0]²')
    // block：sample rate 用 i、block rate 用 k；average mode 的增益 1 − μ·S[k]
    expect(await nodeText(CHART_BLOCK_GMAC, 'PROD')).toContain('e[i]·x[i] = δ[k]·x[i]²')
    expect(await edgeText(CHART_BLOCK_GMAC, 'ACC', 'SCALE')).toBe('δ[k]·Σ x[i]²')
    expect(await nodeText(CHART_BLOCK_GMAC, 'SCALE')).toContain('S[k] = (1/N)·Σ x[i]²')
    expect(await edgeText(CHART_BLOCK_GMAC, 'SCALE', 'SUM')).toBe('− μ·S[k]·δ[k]')
    expect(await edgeText(CHART_BLOCK_GMAC, 'Z', 'SUM')).toBe('＋ δ[k]')
    expect(await edgeText(CHART_BLOCK_GMAC, 'SUM', 'Z')).toBe('δ[k+1] = (1 − μ·S[k])·δ[k]')
    expect(CHART_BLOCK_GMAC).toContain('等效步長 N·μ')
    expect(CHART_WHICH_BOUND).toContain('2P_x ÷ (P_x² + (M_4 − P_x²)/N)')
    expect(CHART_RANDOM_GAIN).toContain('f[n] = 1 − μ·x[n]²')
    expect(CHART_MEAN_PATH).toContain('× (1 − μP_x)')
    expect(CHART_TAU_FLOW).toContain('τ = −1 ÷ ln|p|')
    expect(CHART_TAU_FLOW).toContain('n_ε = ⌈ ln ε ÷ ln|p| ⌉')
  })
})

describe('Ch03 方塊圖：新增的兩張（heavy tail 的機制、畫回 PLL 硬體）與本章公式、模型一致', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it('heavy tail：log 域常態 → lognormal；中位數 e^(nλ)、均方根 g^(n/2)，倍數 e^(n(½ln g − λ)) ≥ 1（Jensen，F-03.10）', async () => {
    expect(await nodeText(CHART_HEAVY_TAIL, 'SUM')).toContain('L[n] = ln(|δ[n]| ÷ |δ[0]|)')
    expect(await edgeText(CHART_HEAVY_TAIL, 'SUM', 'NORM')).toBe('中央極限定理')
    expect(await nodeText(CHART_HEAVY_TAIL, 'NORM')).toContain('中心 n·λ、標準差 s·√n')
    expect(await nodeText(CHART_HEAVY_TAIL, 'MED')).toContain('≈ |δ[0]|·e^(n·λ)')
    expect(await nodeText(CHART_HEAVY_TAIL, 'RMS')).toContain('= |δ[0]|·g^(n/2)（精確）')
    expect(await nodeText(CHART_HEAVY_TAIL, 'GAP')).toContain('e^(n·(½·ln g − λ))')
    expect(await nodeText(CHART_HEAVY_TAIL, 'GAP')).toContain('½·ln g − λ ≥ 0')
    // 「中位數 ≈ e^(nλ)」就是 CLT 預測的 50% 分位（cltLog10Quantile，Stability Lab 畫的那條線）
    const n = 200
    const f08 = stabilityFactors(0.8, GAUSS)
    const sd = Math.sqrt(logFactorVariance(0.8, GAUSS))
    expect(cltLog10Quantile(f08.lambda, sd, n, 0.5)).toBeCloseTo((n * f08.lambda) / Math.LN10, 9)
    // μ = 0.8：均方根往上（g > 1）、中位數往下（λ < 0）——第 4 節開頭的「矛盾」
    expect(f08.g).toBeCloseTo(1.32, 12)
    expect(f08.lambda).toBeLessThan(0)
    const gapLog10 = (n * (0.5 * Math.log(f08.g) - f08.lambda)) / Math.LN10
    expect((n / 2) * Math.log10(f08.g) - (n * f08.lambda) / Math.LN10).toBeCloseTo(gapLog10, 9)
    expect(gapLog10).toBeGreaterThan(40) // 200 步之後 RMS 與典型路徑差了四十幾個 decade
    // 每步的差距 ½·ln g − λ ≥ 0 對任何分布、任何 μ 都成立；|x| 為常數（±1 code）時恰為 0（lognormal 退化成一個點）
    for (const dist of [GAUSS, UNIF, SPARSE]) {
      for (const mu of [0.05, 0.3, 0.8, 1.5, 2.3]) {
        const f = stabilityFactors(mu, dist)
        expect(0.5 * Math.log(f.g) - f.lambda, `${dist.kind} μ=${mu}`).toBeGreaterThan(0)
      }
    }
    const pm = stabilityFactors(0.3, PM1)
    expect(0.5 * Math.log(pm.g) - pm.lambda).toBeCloseTo(0, 12)
  })

  it('畫回 PLL 硬體：e = a·x − w·x + v 的極性、block 內 w 不變、accumulator 的更新式；N = 1 時就是第 1 節的 LMS', async () => {
    expect(await edgeText(CHART_PLL_MAPPING, 'A', 'PD')).toBe('＋ a·x[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'W', 'PD')).toBe('− w[k]·x[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'V', 'PD')).toBe('＋ v[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'PD', 'IDEAL')).toBe('e[i] = δ[k]·x[i] + v[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'IDEAL', 'MUL')).toBe('e[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'X', 'MUL')).toBe('同一個 x[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'MUL', 'GMAC')).toBe('e[i]·x[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'GMAC', 'SCALE')).toBe('每 N 筆一次（block rate）')
    expect(await nodeText(CHART_PLL_MAPPING, 'SCALE')).toBe('÷ N、× μ')
    expect(await nodeText(CHART_PLL_MAPPING, 'ACC')).toBe('Gain accumulator<br/>w[k+1] = w[k] + μ·(1/N)·Σ e[i]·x[i]')
    expect(await edgeText(CHART_PLL_MAPPING, 'ACC', 'W')).toBe('w[k]（block 內不變）')
    // 藍色方塊 = 章首系統地圖的主角（res、scale、acc）
    expect(SYSTEM_FOCUS).toEqual(['res', 'scale', 'acc'])
    expect(CHART_PLL_MAPPING).toContain('class X,SCALE,ACC focus')
    // 照圖走一個 block（N = 4，含雜訊）：w 域的更新 ⇔ δ 域的 (1 − μ·S)·δ − μ·(1/N)·Σ x·v（δ = a − w）
    const [a, w, mu] = [3, 1, 0.1]
    const xs = [2, -1, 0.5, 1.5]
    const vs = [0.2, -0.1, 0.05, 0]
    const N = xs.length
    const e = xs.map((x, i) => a * x - w * x + vs[i])
    const wNext = w + (mu / N) * e.reduce((acc, ei, i) => acc + ei * xs[i], 0)
    const S = xs.reduce((acc, x) => acc + x * x, 0) / N
    const xv = xs.reduce((acc, x, i) => acc + x * vs[i], 0) / N
    expect(a - wNext).toBeCloseTo((1 - mu * S) * (a - w) - mu * xv, 12)
    // 無雜訊時就是 block 圖的迴圈增益 1 − μ·S[k]
    const wNoiseless = w + (mu / N) * xs.reduce((acc, x) => acc + (a - w) * x * x, 0)
    expect(a - wNoiseless).toBeCloseTo((1 - mu * S) * (a - w), 12)
    expect(await edgeText(CHART_BLOCK_GMAC, 'SUM', 'Z')).toBe('δ[k+1] = (1 − μ·S[k])·δ[k]')
    // N = 1、無雜訊、T01 的數字（a = 3、w0 = 1、x = 2、μ = 0.1）：w1 = 1.8，和 LMS 迴圈圖走一圈相同
    expect(1 + 0.1 * (3 * 2 - 1 * 2) * 2).toBeCloseTo(1.8, 12)
  })
})

describe('Ch03 頁面上的方塊圖與符號表位置', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  function renderChapter(mode: 'beginner' | 'engineer' | 'research') {
    localStorage.setItem('lmspll.mode', mode)
    return render(
      <MemoryRouter initialEntries={['/ch/03']}>
        <SettingsProvider>
          <Chapter03 />
        </SettingsProvider>
      </MemoryRouter>,
    )
  }
  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  it.each(['beginner', 'research'] as const)(
    '%s 模式：章首是 <SystemMap>，之後依登錄順序畫出全部方塊圖；每張都有圖號與圖說，並排在對應公式之前',
    (mode) => {
      const { container } = renderChapter(mode)
      const drawn = Array.from(container.querySelectorAll('[data-testid="mermaid-src"]'))
      expect(drawn).toHaveLength(N_DIAGRAMS + 1)
      // 第一張：系統地圖，緊接在章首的開場問題之後、第一個小節之前
      expect(drawn[0].textContent).toBe(systemMapChart(SYSTEM_FOCUS))
      const lead = container.querySelector('.ch03-lead')!
      const firstSection = container.querySelector('section.c-section')!
      expect(follows(lead, drawn[0])).toBe(true)
      expect(follows(drawn[0], firstSection)).toBe(true)
      expect(container.textContent).toMatch(/你在這裡：藍色方塊是本章的主角/)
      // 其餘：與 DIAGRAMS 同順序、各出現一次
      expect(drawn.slice(1).map((el) => el.textContent)).toEqual(DIAGRAMS.map((d) => d.chart))
      const figs = Array.from(container.querySelectorAll('.ch03-fig'))
      expect(figs.map((f) => f.getAttribute('data-fig'))).toEqual(DIAGRAMS.map((_, i) => String(i + 1)))
      for (const [i, f] of figs.entries()) {
        // 圖說是共用 Mermaid 元件的 <figcaption>（在 <figure> 裡），以圖號開頭
        const caps = f.querySelectorAll('figure.c-mermaid > figcaption.c-figcaption')
        expect(caps, `圖 3-${i + 1} 的圖說`).toHaveLength(1)
        const cap = caps[0]
        expect(cap.textContent!.startsWith(`圖 3-${i + 1}｜`), `圖 3-${i + 1} 的圖號`).toBe(true)
        expect(cap.textContent!.length, `圖 3-${i + 1} 的圖說`).toBeGreaterThan(25)
        expect(f.querySelector('figure.c-mermaid')!.getAttribute('aria-label'), `圖 3-${i + 1} 的替代文字`).toBeTruthy()
        expect(cap.textContent).not.toMatch(/\$/) // 圖說裡的數學已轉成 KaTeX
      }
      // 至少一半的圖說含有 KaTeX 排版的數學（不是用 Unicode 拼的）
      expect(figs.filter((f) => f.querySelector('figcaption .katex')).length).toBeGreaterThan(N_DIAGRAMS / 2)
      // 「先看圖、再看數學」：圖在對應公式（或手算題、實驗）之前
      const fig = (chart: string) => figs[figNo(chart) - 1]
      const at = (sel: string) => {
        const el = container.querySelector(sel)
        if (!el) throw new Error(`找不到 ${sel}`)
        return el
      }
      const before: [string, string][] = [
        [CHART_THREE_PATHS, '#fixed-x'],
        [CHART_LMS_LOOP, '[id="formula-F-03.1"]'],
        [CHART_ERROR_RECURSION, '[id="formula-F-03.1"]'],
        [CHART_POLE_REGIME, '[id="formula-F-03.4"]'],
        [CHART_TAU_FLOW, '[id="formula-F-03.4"]'],
        [CHART_RANDOM_GAIN, '[id="formula-F-03.5"]'],
        [CHART_MEAN_PATH, '[id="formula-F-03.5"]'],
        [CHART_G_BUILD, '[id="formula-F-03.6"]'],
        [CHART_KURTOSIS_COMPARE, '[id="formula-F-03.13"]'],
        [CHART_NOISE_INJECTION, '[id="formula-F-03.11"]'],
        [CHART_MSD_LOOP, '[id="formula-F-03.11"]'],
        [CHART_LOG_SUM, '[id="formula-F-03.9"]'],
        [CHART_IMPLICATIONS, '[id="formula-F-03.10"]'],
        [CHART_MU_REGIONS, '#heavy-tail'],
        [CHART_HEAVY_TAIL, '[id="formula-F-03.18"]'],
        [CHART_CLT_FLOW, '[id="formula-F-03.18"]'],
        [CHART_NAIVE_VS_ONESTEP, '[id="formula-F-03.16"]'],
        [CHART_MC_FLOW, '#exp-stability-lab'],
        [CHART_MC_COMPARE, '#exp-stability-lab'],
        [CHART_WHICH_BOUND, '#pll'],
        [CHART_PLL_MAPPING, '[id="formula-F-03.14"]'],
        [CHART_BLOCK_GMAC, '[id="formula-F-03.14"]'],
        [CHART_SYNTHESIS_FLOW, '[id="handcalc-HC-03.8"]'],
      ]
      expect(before).toHaveLength(N_DIAGRAMS)
      for (const [chart, sel] of before) expect(follows(fig(chart), at(sel)), `${figRef(chart)} 應在 ${sel} 之前`).toBe(true)
      // 圖也不會跑到前一節去
      const after: [string, string][] = [
        [CHART_LMS_LOOP, '#fixed-x'],
        [CHART_RANDOM_GAIN, '#random-mean'],
        [CHART_G_BUILD, '#mean-square'],
        [CHART_LOG_SUM, '#almost-sure'],
        [CHART_HEAVY_TAIL, '#heavy-tail'],
        [CHART_CLT_FLOW, '#heavy-tail'],
        [CHART_MC_FLOW, '#lab'],
        [CHART_MC_COMPARE, '#lab'],
        [CHART_WHICH_BOUND, '#compare'],
        [CHART_PLL_MAPPING, '#pll'],
        [CHART_BLOCK_GMAC, '#pll'],
        [CHART_SYNTHESIS_FLOW, '#synthesis'],
      ]
      for (const [chart, sel] of after) expect(follows(at(sel), fig(chart)), `${figRef(chart)} 應在 ${sel} 之後`).toBe(true)
      expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    },
    90000 * SLOW,
  )

  it('符號表在章末（#symbols，本課必記之後、頁面最後一塊）；章首只留一行連結，按下會捲到符號表', () => {
    const { container } = renderChapter('engineer')
    const root = container.querySelector('.ch03')!
    const symbols = container.querySelector('#symbols')!
    expect(symbols).not.toBeNull()
    expect(root.lastElementChild).toBe(symbols)
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols tbody tr')).not.toBeNull()
    const recap = container.querySelector('.c-recap')!
    expect(follows(recap, symbols)).toBe(true)
    expect(follows(container.querySelector('#quiz')!, symbols)).toBe(true)
    // 章首：只有一行按鈕（不是 href，HashRouter 下 href="#symbols" 會被當成路由）
    const link = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('本章符號表在最後'))!
    expect(link).toBeTruthy()
    expect(follows(link, container.querySelector('section.c-section')!)).toBe(true)
    expect(container.querySelector('a[href="#symbols"]')).toBeNull()
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const saved = proto.scrollIntoView
    const calls: Element[] = []
    proto.scrollIntoView = function (this: Element) {
      calls.push(this)
    }
    try {
      link.click()
      expect(calls).toEqual([symbols])
      // 符號表底下可以回到章首
      const back = Array.from(symbols.querySelectorAll('button')).find((b) => b.textContent?.includes('回到本章開頭'))!
      back.click()
      expect(calls[1]).toBe(container.querySelector('#ch03-top'))
    } finally {
      proto.scrollIntoView = saved
    }
  }, 60000 * SLOW)
})
