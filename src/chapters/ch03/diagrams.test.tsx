import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import mermaid from 'mermaid'
import { SYSTEM_BLOCK_LABEL, SYSTEM_MAP_BLOCKS, systemMapModel } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
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
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))

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

/** 標籤裡的行內公式 `$...$`（圖的原始碼一律用它寫數學；Mermaid 元件再交給 KaTeX 排版） */
const MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
/** 一行標籤去掉公式之後剩下的純文字 */
const stripMath = (line: string) => line.replace(MATH, '')
/** 一行標籤裡公式以外的文字片段（公式把一行切成幾段，每一段都要連續出現在輸出裡） */
const textOf = (line: string) => line.split(MATH).filter((_, i) => i % 2 === 0)
/** 一行標籤裡所有公式（不含 `$`） */
const mathOf = (line: string) => [...line.matchAll(MATH)].map((m) => m[1])
/** 原始碼裡所有雙引號標籤（節點、連線、子圖標題）；第一行是 init directive，不算 */
const quotedLabels = (chart: string) => [...chart.split('\n').slice(1).join('\n').matchAll(/"([^"\n]*)"/g)].map((m) => m[1])
/** 子圖標題：`subgraph ID["標題"]`（不在 flowDb 的 vertices 裡） */
const subgraphTitles = (chart: string) => [...chart.matchAll(/^\s*subgraph\s+\w+\["([^"\n]*)"\]/gm)].map((m) => m[1])
/** 進入加法點的線上寫的正負號：公式開頭的 `$+` / `$-`（或全形「＋」） */
const signOf = (label: string) => (/^\$\+|^＋/.test(label) ? '+' : /^\$-|^−/.test(label) ? '-' : '')

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

  it('章首系統地圖（SystemMap）是手排的 SVG，不經過 mermaid：本章主角是 regressor x[n]、步長 μ（÷N、×μ）、gain accumulator 三格', () => {
    expect(SYSTEM_FOCUS).toEqual(['res', 'scale', 'acc'])
    const model = systemMapModel(SYSTEM_FOCUS)
    expect(model.blocks).toHaveLength(Object.keys(SYSTEM_BLOCK_LABEL).length) // 17 個方塊都在
    const focused = model.blocks.filter((b) => b.focused)
    expect(focused.map((b) => b.id).sort()).toEqual(['acc', 'res', 'scale'])
    // 另外 14 個方塊（comparator、GMAC、PLL 動態、量化…）本章都還沒進來，不能亮藍色
    expect(model.blocks.filter((b) => !b.focused)).toHaveLength(model.blocks.length - 3)
    expect(SYSTEM_FOCUS.every((id) => SYSTEM_MAP_BLOCKS.some((b) => b.id === id))).toBe(true)
    // 方塊上的字就是本章在用的符號：x[n]、÷N 與 ×μ、w_k
    const blockOf = (id: string) => focused.find((b) => b.id === id)!
    expect(blockOf('res').sub).toContain('$x[n]$')
    expect(blockOf('scale').sub).toContain(String.raw`$\div N$`)
    expect(blockOf('scale').sub).toContain(String.raw`$\times\,\mu$`)
    expect(blockOf('acc').sub).toContain('$w_k$')
  })

  it('數學一律寫 `$...$`，其餘文字不會被 mermaid 當成 Markdown／HTML 吃掉：公式裡沒有「<」「>」（改寫 \\lt \\gt）、沒有 `\\\\`、文字裡沒有 Unicode 拼的數學', async () => {
    for (const d of DIAGRAMS) {
      // <br/> 是唯一允許的 HTML；其餘的「<」「>」都不可以出現在含公式的標籤裡（Mermaid 會把它跳脫成 &lt;，KaTeX 讀不懂）
      expect(d.chart.replace(/<br\/>/g, ''), d.name).not.toMatch(/<[A-Za-z/!?]/)
      expect(d.chart, d.name).not.toMatch(/&[a-z]+;|#[a-z0-9]+;/i) // 不用 HTML／mermaid 的字元實體
      // 不留樣板字串的插值痕跡；標籤內不用 `\\`（Mermaid 會把連續兩個反斜線收成一個，換行用 <br/>）
      expect(d.chart, d.name).not.toMatch(/\$\{|undefined|\\\\/)
      const all = [...(await labels(d.chart)), ...subgraphTitles(d.chart).map(decode)]
      expect(all.length, d.name).toBeGreaterThanOrEqual(6)
      // 每個含公式的標籤的 `$` 成對
      for (const full of all) expect(full.replace(/\\\$/g, '').split('$').length % 2, `${d.name}：「${full}」的 $ 不成對`).toBe(1)
      // 解析器看到的標籤就是原始碼裡的雙引號字串（圖上沒有漏掉的標籤）
      expect(all.length, d.name).toBe(quotedLabels(d.chart).length)
      let mathLabels = 0
      for (const full of all) {
        if (full.includes('$')) mathLabels++
        for (const t of full.split('<br/>')) {
          const where = `${d.name}：「${t}」`
          expect(t.trim(), where).not.toBe('')
          expect(t, where).not.toMatch(/^\s*(?:[-+*]|\d+[.)])(?:\s|$)/) // Markdown 清單
          expect(t, where).not.toMatch(/^\s*(?:#{1,6}\s|>)/) // 標題、引言
          // 公式之外的文字：不能有 TeX 記號、底線、「<」「>」，也不能有 Unicode 拼的數學（希臘字母、上下標、× ÷ ≤ …）
          const plain = stripMath(t)
          expect(plain, where).not.toMatch(/[*`~$\\_<>^]/)
          expect(unicodeMathIn(plain), where).toEqual([])
          // 公式本身：TeX 指令只出現在 `$...$` 裡；「<」「>」要寫成 \lt \gt；公式裡不再放 Unicode 的數學符號
          for (const m of mathOf(t)) {
            expect(m, where).not.toMatch(/[<>]/)
            expect(m.replace(/\\text\{[^{}]*\}/g, ''), where).not.toMatch(/[Ͱ-Ͽ⁰-₟²³¹∑∏√∞≤≥≠≈±∓·×÷∂∇∈∝⌊⌋⌈⌉]/u)
          }
        }
      }
      expect(mathLabels, `${d.name} 至少要有一個公式標籤`).toBeGreaterThan(0)
    }
  })
})

describe('Ch03 方塊圖：真的畫出來（jsdom + 共用的 mermaidTestUtils，與網站相同的前處理）', () => {
  beforeAll(installMermaidSvgShim)

  /** 比對用：拿掉換行標籤與所有空白（mermaid 會把標籤拆成數行；KaTeX 的 \text 會把空白排成不換行空白與零寬字元） */
  const squash = (t: string) => decode(t).replace(/<br\/>/g, '').replace(/[\s\u00a0\u200b]+/g, '')

  it.each(DIAGRAMS.map((d) => [d.name, d.chart] as const))(
    '%s：畫得出來、沒有「Unsupported markdown」、數學都由 KaTeX 排版（沒有殘留的 $、沒有 Unicode 拼的數學）、節點數不超過上限、每個標籤的文字都在圖上',
    async (name, chart) => {
      const { svg, text, plainText, nodeCount, mathCount } = await renderMermaidForTest(chart)
      expect(svg).toContain('<svg')
      expect(text).not.toMatch(/Unsupported markdown/)
      expect(text).not.toMatch(/Syntax error/i)
      expect(svg).not.toMatch(/<em>|<strong>|<del>|<code>/) // 沒有被當成 Markdown 的強調／程式碼
      // 數學：畫出來的文字沒有殘留的 `$`，KaTeX 以外的文字沒有 Unicode 拼的數學（希臘字母、上下標、× ÷ ≤ …）
      expect(text, name).not.toContain('$')
      expect(plainText, name).not.toContain('$')
      expect(unicodeMathIn(plainText), name).toEqual([])
      // 每個含公式的標籤（節點、連線、子圖標題）各排版成一段 KaTeX：數量和原始碼裡含 `$` 的標籤一樣多
      expect(mathCount, `${name}：KaTeX 公式數`).toBe(quotedLabels(chart).filter((l) => l.includes('$')).length)
      expect(mathCount).toBeGreaterThan(0)
      // 節點數（子圖標題不算節點）：畫出來的和 parser 看到的一樣多，而且不超過規範 §8 的上限
      expect(nodeCount).toBe((await flowDb(chart)).getVertices().size)
      expect(nodeCount).toBeGreaterThanOrEqual(3)
      expect(nodeCount).toBeLessThanOrEqual(MAX_NODES)
      // 每個節點、每條線、每個子圖標題上的文字（公式以外的部分）都真的出現在輸出裡（沒有被 sanitizer 或 Markdown 處理截掉）
      const drawn = squash(text)
      for (const label of [...(await labels(chart)), ...subgraphTitles(chart).map(decode)]) {
        for (const line of label.split('<br/>')) {
          for (const piece of textOf(line)) {
            const want = squash(piece)
            if (want === '') continue
            expect(drawn.includes(want), `${name}：輸出裡找不到「${want}」`).toBe(true)
          }
        }
      }
    },
    60000,
  )
})

/**
 * 以下的斷言都拿「圖的原始碼」比對（標籤裡的數學就是 `$...$` 的 TeX）；
 * 同樣的內容在上一個 describe 已經由 KaTeX 真的排版過（公式數、文字、沒有殘留的 `$`），這裡檢查的是數字、正負號與結構。
 */
describe('Ch03 方塊圖：內容與本章公式、模型一致', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it('LMS 迴圈的極性：e = y − w·x（y 進加法點為＋、w·x 為−），修正量 μ·e·x 由累加器加到 w 上，延遲一步後回到模型', async () => {
    const plus = await edgeText(CHART_LMS_LOOP, 'SYS', 'CMP')
    const minus = await edgeText(CHART_LMS_LOOP, 'MOD', 'CMP')
    expect(plus).toBe(String.raw`$+\,y = a \cdot x$`)
    expect(minus).toBe(String.raw`$-\,w[n] \cdot x$`)
    expect([signOf(plus), signOf(minus)]).toEqual(['+', '-'])
    expect(await edgeText(CHART_LMS_LOOP, 'CMP', 'GAIN')).toBe(String.raw`$e[n] = y - w[n] \cdot x$`)
    expect(await edgeText(CHART_LMS_LOOP, 'GAIN', 'ACC')).toBe(String.raw`修正量 $\mu \cdot e[n] \cdot x$`)
    expect(await nodeText(CHART_LMS_LOOP, 'ACC')).toBe(String.raw`累加器<br/>$w[n+1] = w[n] + \text{修正量}$`)
    expect(await edgeText(CHART_LMS_LOOP, 'ACC', 'MOD')).toBe(String.raw`延遲一步：$w[n]$`)
    // 修正量 = μ × 誤差 × 輸入：乘上去的 x 和送進系統／模型的是同一個（虛線）
    expect(await nodeText(CHART_LMS_LOOP, 'GAIN')).toBe(String.raw`$\times\, \mu \cdot x$`)
    expect(await edgeText(CHART_LMS_LOOP, 'X', 'GAIN')).toBe('同一個 $x$')
    // 數字驗算（T01 的手算）：a = 3、w0 = 1、x = 2、μ = 0.1 → 照圖走一圈得 w1 = 1.8
    const [a, w0, x, mu] = [3, 1, 2, 0.1]
    const e0 = a * x - w0 * x
    expect(w0 + mu * e0 * x).toBeCloseTo(1.8, 12)
  })

  it('誤差遞迴的迴圈：δ[n] 以＋進加法點、μx²·δ[n] 以−進加法點，合併後增益 p = 1 − μx²', async () => {
    const keep = await edgeText(CHART_ERROR_RECURSION, 'Z1', 'S1')
    const take = await edgeText(CHART_ERROR_RECURSION, 'G1', 'S1')
    expect(keep).toBe(String.raw`$+\,\delta[n]$`)
    expect(take).toBe(String.raw`$-\,\mu x^2 \cdot \delta[n]$`)
    expect([signOf(keep), signOf(take)]).toEqual(['+', '-'])
    expect(await edgeText(CHART_ERROR_RECURSION, 'P2', 'Z2')).toBe(String.raw`$\delta[n+1] = p \cdot \delta[n]$`)
    expect(CHART_ERROR_RECURSION).toContain(String.raw`$p = 1 - \mu x^2$`)
    // 兩個框的標題（子圖標題只寫文字）；「每一步修掉 μx²·δ[n]」的式子就是上面那條減號線，增益 p 在合併之後的方塊裡
    expect(subgraphTitles(CHART_ERROR_RECURSION)).toEqual(['合併之後：繞一圈就乘一次增益', '展開來看：每一步修掉誤差的一部分'])
    expect(await nodeText(CHART_ERROR_RECURSION, 'G1')).toBe(String.raw`$\times\, \mu x^2$`)
    expect(await nodeText(CHART_ERROR_RECURSION, 'P2')).toBe(String.raw`$\times\, p$<br/>$p = 1 - \mu x^2$`)
    // 兩種畫法數值相同：δ − μx²δ = (1 − μx²)δ；x = 2、μ = 0.1 → p = 0.6
    const [delta, x, mu] = [2, 2, 0.1]
    expect(delta - mu * x * x * delta).toBeCloseTo((1 - mu * x * x) * delta, 12)
    expect(1 - mu * x * x).toBeCloseTo(0.6, 12)
  })

  it('p 的決策樹：每個葉子的 μ 範圍與 p 範圍互相對應（以 x = 2 的五個 μ 各走一條分支）', async () => {
    const leaf = (id: string) => nodeText(CHART_POLE_REGIME, id)
    expect(await leaf('MONO')).toContain(String.raw`$0 \lt \mu \lt 1/x^2$`)
    expect(await leaf('DEAD')).toContain(String.raw`$\mu = 1/x^2$`)
    expect(await leaf('OSC')).toContain(String.raw`$1/x^2 \lt \mu \lt 2/x^2$`)
    expect(await leaf('EDGE')).toContain(String.raw`$\mu = 2/x^2$`)
    expect(await leaf('DIV1')).toContain(String.raw`$\mu \gt 2/x^2$`)
    expect(await leaf('DIV2')).toContain(String.raw`$\mu \lt 0$`)
    // 判斷 p 的條件：邊界上的 ＋1 與 −1 要分開（符號放在公式裡）
    expect(await nodeText(CHART_POLE_REGIME, 'BD')).toBe(String.raw`$p$ 是 $+1$<br/>還是 $-1$`)
    expect(await edgeText(CHART_POLE_REGIME, 'BD', 'EDGE')).toBe(String.raw`$p = -1$`)
    expect(await edgeText(CHART_POLE_REGIME, 'BD', 'STUCK')).toBe(String.raw`$p = +1$`)
    expect(await edgeText(CHART_POLE_REGIME, 'SG', 'OSC')).toBe(String.raw`$-1 \lt p \lt 0$`)
    expect(await edgeText(CHART_POLE_REGIME, 'DV', 'DIV1')).toBe(String.raw`$p \lt -1$`)
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
    expect(CHART_THREE_PATHS).toContain(String.raw`$0 \lt \mu \lt 2/P_x$<br/>$\mathcal N(0,1)$：$\mu \lt 2$"`)
    expect(CHART_THREE_PATHS).toContain(String.raw`$0 \lt \mu \lt 2P_x/M_4$<br/>$\mathcal N(0,1)$：$\mu \lt 2/3$"`)
    expect(CHART_THREE_PATHS).toContain(String.raw`$\mathcal N(0,1)$：$\mu \lt 2.4212$"`)
    // μ 軸：區間端點的歸屬（恰在界限上＝不收斂）；✓ = $\checkmark$、✗ = $\times$
    const ok = String.raw`$\checkmark$`
    const no = String.raw`$\times$`
    expect(CHART_MU_REGIONS).toContain(String.raw`$0 \lt \mu \lt 2/3$<br/>mean ${ok}、MS ${ok}、a.s. ${ok}`)
    expect(CHART_MU_REGIONS).toContain(String.raw`$2/3 \le \mu \lt 2$<br/>mean ${ok}、MS ${no}、a.s. ${ok}`)
    expect(CHART_MU_REGIONS).toContain(String.raw`$2 \le \mu \lt 2.4212$<br/>mean ${no}、MS ${no}、a.s. ${ok}`)
    expect(CHART_MU_REGIONS).toContain(String.raw`$\mu \ge 2.4212$<br/>mean ${no}、MS ${no}、a.s. ${no}`)
  })

  it('g 的組成（＋1、−2μP_x、＋μ²M_4）與三種分布的 κ、MS 界和模型一致', async () => {
    const terms = [await edgeText(CHART_G_BUILD, 'ONE', 'S'), await edgeText(CHART_G_BUILD, 'T1', 'S'), await edgeText(CHART_G_BUILD, 'T2', 'S')]
    expect(terms).toEqual([String.raw`$+\,1$`, String.raw`$-\,2\mu P_x$`, String.raw`$+\,\mu^2 M_4$`])
    expect(terms.map(signOf)).toEqual(['+', '-', '+'])
    expect(await edgeText(CHART_G_BUILD, 'S', 'CHK')).toBe(String.raw`$g(\mu) = 1 - 2\mu P_x + \mu^2 M_4$`)
    const rows: [XDist, string, string][] = [
      [PM1, String.raw`$\kappa = 1$`, String.raw`MS 界 $= 2 \div 1 = 2$`],
      [UNIF, String.raw`$\kappa = 9/5$`, String.raw`MS 界 $= 2 \div 1.8 = 10/9$`],
      [GAUSS, String.raw`$\kappa = 3$`, String.raw`MS 界 $= 2 \div 3 = 2/3$`],
    ]
    const frac = (s: string) => {
      const [n, d] = s.replace(/\$/g, '').split('/').map(Number)
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
    const signed = {
      signal: await edgeText(CHART_NOISE_INJECTION, 'M1', 'A'),
      noise: await edgeText(CHART_NOISE_INJECTION, 'V', 'A'),
      correction: await edgeText(CHART_NOISE_INJECTION, 'G', 'S'),
      keep: await edgeText(CHART_NOISE_INJECTION, 'Z', 'S'),
    }
    expect(signed.signal).toBe(String.raw`$+\,\delta[n] \cdot x[n]$`)
    expect(signed.noise).toBe(String.raw`$+\,v[n]$`)
    expect(signed.correction).toBe(String.raw`$-\,\mu \cdot x[n] \cdot e[n]$`)
    expect(signed.keep).toBe(String.raw`$+\,\delta[n]$`)
    expect(Object.values(signed).map(signOf)).toEqual(['+', '+', '-', '+'])
    expect(await edgeText(CHART_NOISE_INJECTION, 'A', 'G')).toBe(String.raw`$e[n] = \delta[n] \cdot x[n] + v[n]$`)
    expect(await nodeText(CHART_NOISE_INJECTION, 'G')).toBe(String.raw`$\times\, \mu \cdot x[n]$`)
    expect(await edgeText(CHART_NOISE_INJECTION, 'X', 'G')).toBe(String.raw`同一個 $x[n]$`)
    // 照圖走一步 = scalarStability.ts 的 pathStep：δ' = (1 − μx²)δ − μ·x·v
    const [delta, x, v, mu] = [0.7, -1.3, 0.25, 0.4]
    const e = delta * x + v
    expect(delta - mu * x * e).toBeCloseTo((1 - mu * x * x) * delta - mu * x * v, 12)
    expect(CHART_MSD_LOOP).toContain(String.raw`\mu^2 \cdot P_x \cdot \sigma_v^2`)
    expect(CHART_MSD_LOOP).toContain(String.raw`穩態 $\mathrm{MSD}_\infty = \text{注入} \div (1 - g)$<br/>$= \mu \cdot P_x \cdot \sigma_v^2 \div (2P_x - \mu M_4)$`)
    expect(CHART_MSD_LOOP).toContain(String.raw`E[e^2] = P_x \cdot \mathrm{MSD}_\infty + \sigma_v^2`)
    expect(await edgeText(CHART_MSD_LOOP, 'G', 'S')).toBe(String.raw`$+\,g \cdot E[\delta[n]^2]$`)
    // 注入 ÷ (1 − g) 與化簡後的式子相等（固定 x = 2、μ = 0.1、σ_v = 1 → 0.0625，思考題 5）
    const [Px, M4, s2] = [4, 16, 1]
    const g = 1 - 2 * 0.1 * Px + 0.01 * M4
    expect((0.01 * Px * s2) / (1 - g)).toBeCloseTo((0.1 * Px * s2) / (2 * Px - 0.1 * M4), 12)
    expect((0.01 * Px * s2) / (1 - g)).toBeCloseTo(0.0625, 12)
  })

  it('推論關係圖的兩個反例區間：稀疏 code 2/9 < μ < 20/9、Gaussian 2 < μ < 2.4212', async () => {
    expect(await edgeText(CHART_IMPLICATIONS, 'MS', 'MEAN')).toContain(String.raw`$g \ge (1 - \mu P_x)^2$`)
    expect(await edgeText(CHART_IMPLICATIONS, 'MS', 'AS')).toContain(String.raw`$\lambda \le \tfrac12 \ln g$`)
    expect(await edgeText(CHART_IMPLICATIONS, 'MEAN', 'AS')).toContain(String.raw`$2/9 \lt \mu \lt 20/9$`)
    expect(await edgeText(CHART_IMPLICATIONS, 'AS', 'MEAN')).toContain(String.raw`$2 \lt \mu \lt 2.4212$`)
    const sp = stabilityBounds(SPARSE)
    expect(sp.meanMax).toBeCloseTo(20 / 9, 12)
    expect(sp.asMax).toBeCloseTo(2 / 9, 9)
  })

  it('CLT 流程圖的常數 1.2816 = Φ⁻¹(0.9)；log 域圖、Monte Carlo 流程圖與 block 圖的關鍵式子', async () => {
    expect(normInv(0.9).toFixed(4)).toBe('1.2816')
    expect(CHART_CLT_FLOW).toContain(String.raw`$z = (\ln \varepsilon - n \cdot \lambda) \div (s \cdot \sqrt{n})$`)
    expect(CHART_CLT_FLOW).toContain(String.raw`$n \cdot \lambda \mp 1.2816 \cdot s \cdot \sqrt{n}$`)
    expect(CHART_CLT_FLOW).toContain(String.raw`$n \gt (1.2816 \cdot s \div \lambda)^2$`)
    expect(CHART_MC_FLOW).toContain(String.raw`$\ln|\delta[n+1]| = \ln|\delta[n]| + \ln|1 - \mu \cdot x[n]^2|$`)
    expect(await edgeText(CHART_LOG_SUM, 'LN', 'ACC')).toBe(String.raw`$Y[k] = \ln|f[k]|$`)
    expect(await edgeText(CHART_LOG_SUM, 'ACC', 'AVG')).toBe(String.raw`$\ln(|\delta[n]| \div |\delta[0]|)$`)
    expect(await nodeText(CHART_LOG_SUM, 'AVG')).toContain(String.raw`得到 $\lambda = E \ln|f|$`)
    expect(CHART_NAIVE_VS_ONESTEP).toContain(String.raw`$\mathrm{SE} = \sqrt{(h - g^2) \div M}$`)
    expect(CHART_NAIVE_VS_ONESTEP).toContain(String.raw`真實 $\mathrm{SE} = \sqrt{(h^n - g^{2n}) \cdot \delta[0]^4 \div M}$`)
    // Lab 的比對圖：每一列左邊是 MC 量到的量、右邊是預測
    expect(await edgeText(CHART_MC_COMPARE, 'A3', 'B3')).toBe('相差 0.05 以內')
    expect(await edgeText(CHART_MC_COMPARE, 'A4', 'B4')).toBe(String.raw`$\pm 4$ SE 以內`)
    expect(await nodeText(CHART_MC_COMPARE, 'B2')).toContain(String.raw`$n \cdot \lambda \mp 1.2816 \cdot s \cdot \sqrt{n}$`)
    expect(await nodeText(CHART_MC_COMPARE, 'B3')).toContain(String.raw`$\Phi((\ln \varepsilon - n \cdot \lambda) \div (s \cdot \sqrt{n}))$`)
    expect(await nodeText(CHART_MC_COMPARE, 'B5')).toContain(String.raw`$E[\delta[n]^2] = g^n \cdot \delta[0]^2$`)
    // block：sample rate 用 i、block rate 用 k；average mode 的增益 1 − μ·S[k]
    expect(await nodeText(CHART_BLOCK_GMAC, 'PROD')).toContain(String.raw`$e[i] \cdot x[i] = \delta[k] \cdot x[i]^2$`)
    expect(await edgeText(CHART_BLOCK_GMAC, 'ACC', 'SCALE')).toBe(String.raw`$\delta[k] \cdot \sum x[i]^2$`)
    expect(await nodeText(CHART_BLOCK_GMAC, 'SCALE')).toContain(String.raw`$S[k] = (1/N) \cdot \sum x[i]^2$`)
    const scaled = await edgeText(CHART_BLOCK_GMAC, 'SCALE', 'SUM')
    const kept = await edgeText(CHART_BLOCK_GMAC, 'Z', 'SUM')
    expect(scaled).toBe(String.raw`$-\,\mu \cdot S[k] \cdot \delta[k]$`)
    expect(kept).toBe(String.raw`$+\,\delta[k]$`)
    expect([signOf(scaled), signOf(kept)]).toEqual(['-', '+'])
    expect(await edgeText(CHART_BLOCK_GMAC, 'SUM', 'Z')).toBe(String.raw`$\delta[k+1] = (1 - \mu \cdot S[k]) \cdot \delta[k]$`)
    expect(CHART_BLOCK_GMAC).toContain(String.raw`等效步長 $N \cdot \mu$`)
    expect(CHART_WHICH_BOUND).toContain(String.raw`$2P_x \div (P_x^2 + (M_4 - P_x^2)/N)$`)
    expect(CHART_RANDOM_GAIN).toContain(String.raw`$f[n] = 1 - \mu \cdot x[n]^2$`)
    expect(CHART_MEAN_PATH).toContain(String.raw`$\times\, (1 - \mu P_x)$`)
    expect(CHART_TAU_FLOW).toContain(String.raw`$\tau = -1 \div \ln|p|$`)
    expect(CHART_TAU_FLOW).toContain(String.raw`$n_\varepsilon = \lceil \ln \varepsilon \div \ln|p| \rceil$`)
  })
})

describe('Ch03 方塊圖：新增的兩張（heavy tail 的機制、畫回 PLL 硬體）與本章公式、模型一致', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it('heavy tail：log 域常態 → lognormal；中位數 e^(nλ)、均方根 g^(n/2)，倍數 e^(n(½ln g − λ)) ≥ 1（Jensen，F-03.10）', async () => {
    expect(await nodeText(CHART_HEAVY_TAIL, 'SUM')).toContain(String.raw`$L[n] = \ln(|\delta[n]| \div |\delta[0]|)$`)
    expect(await edgeText(CHART_HEAVY_TAIL, 'SUM', 'NORM')).toBe('中央極限定理')
    expect(await nodeText(CHART_HEAVY_TAIL, 'NORM')).toContain(String.raw`中心 $n \cdot \lambda$、標準差 $s \cdot \sqrt{n}$`)
    expect(await nodeText(CHART_HEAVY_TAIL, 'MED')).toContain(String.raw`$\approx |\delta[0]| \cdot e^{n \cdot \lambda}$`)
    expect(await nodeText(CHART_HEAVY_TAIL, 'RMS')).toContain(String.raw`$= |\delta[0]| \cdot g^{n/2}$（精確）`)
    expect(await nodeText(CHART_HEAVY_TAIL, 'GAP')).toContain(String.raw`$e^{n \cdot (\tfrac12 \cdot \ln g - \lambda)}$`)
    expect(await nodeText(CHART_HEAVY_TAIL, 'GAP')).toContain(String.raw`$\tfrac12 \cdot \ln g - \lambda \ge 0$`)
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

  it('畫回 PLL 硬體：e = t_ref′ − t_fb = a·x − w·x + v 的極性、block 內 w 不變、accumulator 的更新式；N = 1 時就是第 1 節的 LMS', async () => {
    // 線上的正負號 = 對 e 的貢獻：feedback（divider）edge 早到 a·x → +a·x；reference 端 DTC 讓 reference edge 少延遲 w·x（τ = T₀ − w·x）→ −w·x；雜訊 +v
    const signs = [
      await edgeText(CHART_PLL_MAPPING, 'DIV', 'PD'),
      await edgeText(CHART_PLL_MAPPING, 'DTC', 'PD'),
      await edgeText(CHART_PLL_MAPPING, 'V', 'PD'),
    ]
    expect(signs).toEqual([
      String.raw`$+\,a \cdot x[i]$<br/>feedback edge 早到<br/>（$a$ 未知）`,
      String.raw`$-\,w[k] \cdot x[i]$<br/>補償量：reference edge 少延遲`,
      String.raw`$+\,v[i]$`,
    ])
    expect(signs.map(signOf)).toEqual(['+', '-', '+'])
    // PD 量的是（經過 DTC 的）reference edge 減 feedback edge，結果就是 δ[k]·x[i] + v[i]
    const pd = await nodeText(CHART_PLL_MAPPING, 'PD')
    expect(pd).toContain(String.raw`$e[i] = t'_{\mathrm{ref}}[i] - t_{\mathrm{fb}}[i]$`)
    expect(pd).toContain(String.raw`$= \delta[k] \cdot x[i] + v[i]$`)
    expect(await nodeText(CHART_PLL_MAPPING, 'DTC')).toBe(String.raw`DTC（reference 端）<br/>$\tau_{\mathrm{DTC}} = T_0 - w[k] \cdot x[i]$`)
    // 圖上的物理圖像數值驗算：reference 端的 DTC 只能延遲，τ = T₀ − w·x；feedback edge 早到 a·x。
    // e = t_ref′ − t_fb 與原本的 (a − w)·x + v 完全相同（常數 T₀ 已被當成靜態相位偏移吸收，x = 0 時兩條 edge 剛好對齊）
    for (const [aTrue, wEst, x, noise] of [[3, 1, 0.4, 0], [3, 3, 0.7, 0.1], [2, 5, 0.25, -0.05]]) {
      const T0 = 5
      const tRefDelayed = 0 + (T0 - wEst * x) // reference edge 經過 DTC：從基準延遲 T₀ 往回扣 w·x
      const tFb = T0 - aTrue * x // feedback（divider）edge 比理想時刻（= T₀）早到 a·x
      expect(tRefDelayed - tFb + noise).toBeCloseTo((aTrue - wEst) * x + noise, 12)
    }
    // 補償不足（w < a）→ reference 還是太晚 → e > 0（x > 0、無雜訊）
    expect(5 - 1 * 0.4 - (5 - 3 * 0.4)).toBeGreaterThan(0)
    expect(await edgeText(CHART_PLL_MAPPING, 'IDEAL', 'MUL')).toBe(String.raw`$e[i]$`)
    expect(await nodeText(CHART_PLL_MAPPING, 'X2')).toBe(String.raw`同一個 $x[i]$`)
    expect(await edgeText(CHART_PLL_MAPPING, 'MUL', 'GMAC')).toBe(String.raw`$e[i] \cdot x[i]$`)
    expect(await edgeText(CHART_PLL_MAPPING, 'GMAC', 'SCALE')).toBe(String.raw`每 $N$ 筆一次（block rate）`)
    expect(await nodeText(CHART_PLL_MAPPING, 'SCALE')).toBe(String.raw`$\div N$、$\times\, \mu$`)
    expect(await nodeText(CHART_PLL_MAPPING, 'ACC')).toBe(String.raw`Gain accumulator<br/>$w[k+1] = w[k] + \mu \cdot (1/N) \cdot \sum e[i] \cdot x[i]$`)
    expect(await edgeText(CHART_PLL_MAPPING, 'ACC', 'W')).toBe(String.raw`$w[k]$（block 內不變）`)
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
    expect(await edgeText(CHART_BLOCK_GMAC, 'SUM', 'Z')).toBe(String.raw`$\delta[k+1] = (1 - \mu \cdot S[k]) \cdot \delta[k]$`)
    // N = 1、無雜訊、T01 的數字（a = 3、w0 = 1、x = 2、μ = 0.1）：w1 = 1.8，和 LMS 迴圈圖走一圈相同
    expect(1 + 0.1 * (3 * 2 - 1 * 2) * 2).toBeCloseTo(1.8, 12)
  })
})

describe('Ch03 方塊圖：為了桌機版面（不橫向捲動）重新排過的圖，內容一條都沒少', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  /** 一張圖所有的線，寫成排序過的「起點>終點」清單，方便整份比對 */
  async function edgeList(chart: string): Promise<string[]> {
    return (await flowDb(chart)).getEdges().map((e) => `${e.start}>${e.end}`).sort()
  }
  /** 第一行（init）之後的方向宣告 */
  const direction = (chart: string) => chart.split('\n')[1]
  /** 子圖在原始碼裡的宣告順序（互不相連的子圖，Mermaid 會依相反順序由上往下／由左往右排） */
  const subgraphOrder = (chart: string) => [...chart.matchAll(/^\s*subgraph\s+(\w+)\[/gm)].map((m) => m[1])

  it('圖 3-21（畫回 PLL 硬體）：由上往下；14 個節點、DTC 在 reference 輸入端、回授路徑（VCO → divider → PD）只有 divider、LMS 的輸入取自 PD 的輸出，極性與單位都在', async () => {
    expect(direction(CHART_PLL_MAPPING)).toBe('flowchart TB')
    const vertices = [...(await flowDb(CHART_PLL_MAPPING)).getVertices().keys()].sort()
    expect(vertices).toEqual(['ACC', 'DIV', 'DTC', 'GMAC', 'IDEAL', 'LF', 'MUL', 'PD', 'REF', 'SCALE', 'V', 'W', 'X', 'X2'])
    const edges = await edgeList(CHART_PLL_MAPPING)
    expect(edges).toEqual(
      [
        'ACC>W',
        'DIV>PD',
        'DTC>PD',
        'GMAC>SCALE',
        'IDEAL>MUL',
        'LF>DIV',
        'MUL>GMAC',
        'PD>IDEAL',
        'PD>LF',
        'REF>DTC',
        'SCALE>ACC',
        'V>PD',
        'W>DTC',
        'X2>MUL',
        'X>DIV',
        'X>W',
      ].sort(),
    )
    // 架構（docs/assumptions.md §2a）：Reference → DTC → PD；VCO 回授只經過 divider → PD；DTC 不在回授路徑上
    expect(edges).toContain('REF>DTC')
    expect(edges).toContain('DTC>PD')
    expect(edges).toContain('DIV>PD')
    expect(edges).not.toContain('DIV>DTC') // 不能有 divider → DTC
    expect(edges).not.toContain('DTC>DIV')
    expect(edges.filter((e) => e.startsWith('DIV>'))).toEqual(['DIV>PD']) // divider 只通到 PD
    expect(edges.filter((e) => e.startsWith('DTC>'))).toEqual(['DTC>PD']) // DTC 只通到 PD
    expect(edges.filter((e) => e.startsWith('REF>'))).toEqual(['REF>DTC']) // reference 是先經過 DTC 才進 PD，沒有 REF → PD 的捷徑
    expect(edges.filter((e) => e.endsWith('>DTC')).sort()).toEqual(['REF>DTC', 'W>DTC']) // DTC 只吃 reference 與 gain correction 的 code
    // 主迴路是閉合的：PD → loop filter／VCO → divider → PD；divider 只吃 VCO 的輸出與 DSM 的 carry（回授路徑上沒有 DTC）
    expect(edges.filter((e) => e.endsWith('>DIV')).sort()).toEqual(['LF>DIV', 'X>DIV'])
    expect(edges.filter((e) => e.startsWith('LF>'))).toEqual(['LF>DIV'])
    expect(await nodeText(CHART_PLL_MAPPING, 'LF')).toBe(String.raw`Loop filter → VCO／DCO<br/>（主迴路，本章不展開）`)
    expect(await edgeText(CHART_PLL_MAPPING, 'LF', 'DIV')).toBe(String.raw`VCO 輸出<br/>（回授）`)
    expect(await edgeText(CHART_PLL_MAPPING, 'X', 'DIV')).toBe(String.raw`carry 控制除數<br/>餘數 $x[i]$ 留在<br/>feedback edge 上`)
    // PD 的三個輸入：經過 DTC 的 reference edge、divider 的 feedback edge、雜訊；沒有別的東西直接進 PD
    expect(edges.filter((e) => e.endsWith('>PD')).sort()).toEqual(['DIV>PD', 'DTC>PD', 'V>PD'])
    // PD 的輸出只有兩個去處：loop filter 與 LMS（comparator）
    expect(edges.filter((e) => e.startsWith('PD>')).sort()).toEqual(['PD>IDEAL', 'PD>LF'])
    // LMS 校正迴路的輸入是 PD 的輸出：comparator（IDEAL）只從 PD 接，而 PD 的輸出同時也送進 loop filter
    expect(edges.filter((e) => e.endsWith('>IDEAL'))).toEqual(['PD>IDEAL'])
    expect(edges).toContain('PD>LF')
    expect(await edgeText(CHART_PLL_MAPPING, 'PD', 'LF')).toBe(String.raw`$e[i]$`)
    expect(await edgeText(CHART_PLL_MAPPING, 'PD', 'IDEAL')).toBe(String.raw`$e[i]$：LMS 取 PD 的輸出`)
    // 乘法點的兩個輸入：comparator 之後的 e[i]，以及（虛線）同一個 x[i]；沒有任何一條線把 DTC、divider 或 reference 直接拉到 LMS 的方塊
    expect(edges.filter((e) => e.endsWith('>MUL')).sort()).toEqual(['IDEAL>MUL', 'X2>MUL'])
    for (const e of edges.filter((e) => /^(DTC|DIV|REF)>/.test(e))) expect(e.endsWith('>PD') || e.endsWith('>DTC'), e).toBe(true)
    // 同一個 x 送給 MUL 的是虛線；ACC 回到 W 的是 block 內不變的 w[k]
    expect(CHART_PLL_MAPPING).toMatch(/X2\["同一個 \$x\[i\]\$"\] -\.-> MUL/)
    expect(await nodeText(CHART_PLL_MAPPING, 'X2')).toBe(String.raw`同一個 $x[i]$`)
    expect(await edgeText(CHART_PLL_MAPPING, 'ACC', 'W')).toBe(String.raw`$w[k]$（block 內不變）`)
    // 三個藍色方塊、褐色的理想化、紅色的雜訊，都還在原處
    for (const c of ['class X,SCALE,ACC focus', 'class IDEAL mid', 'class V warn']) expect(CHART_PLL_MAPPING, c).toContain(c)
    expect(await nodeText(CHART_PLL_MAPPING, 'X')).toBe(String.raw`DSM／DTC code<br/>$x[i]$（sample rate）`)
    expect(await nodeText(CHART_PLL_MAPPING, 'DIV')).toBe(String.raw`Divider ／ PMUX<br/>（回授路徑）`)
    expect(await nodeText(CHART_PLL_MAPPING, 'W')).toBe(String.raw`Gain correction<br/>$\times\, w[k]$`)
    expect(await nodeText(CHART_PLL_MAPPING, 'REF')).toBe('Reference clock')
    // 褐色那一格（LMS 這一支上 comparator 的位置）：本章拿掉的三件事
    expect(await nodeText(CHART_PLL_MAPPING, 'IDEAL')).toBe(String.raw`本章的理想化（L0）<br/>error path $= 1$、沒有延遲<br/>comparator 換成<br/>線性（多 bit）`)
    // 圖上不再有「DTC 實際補掉的量」（DTC 不是被動的減數，它是 reference 端的延遲線，只能從 T₀ 往回扣）或 divider 側的 DTC；
    // DTC 不能產生負的延遲，線上寫的是「少延遲」（相對基準延遲 T₀），不是沒有前提的「提前」
    expect(CHART_PLL_MAPPING).not.toContain('DTC 實際補掉')
    expect(CHART_PLL_MAPPING).not.toContain('reference edge 提前')
    expect(CHART_PLL_MAPPING).not.toContain('沒被除掉')
    expect(CHART_PLL_MAPPING).not.toMatch(/DIV\s*--+>\s*DTC/)
  })

  it('圖 3-10（雜訊注入）：改成由上往下，9 條線（含 δ[n] 回授與 x 的虛線）一條不少，紅色的加法點與雜訊還在', async () => {
    expect(direction(CHART_NOISE_INJECTION)).toBe('flowchart TB')
    expect(await edgeList(CHART_NOISE_INJECTION)).toEqual(['A>G', 'G>S', 'M1>A', 'S>Z', 'V>A', 'X>G', 'X>M1', 'Z>M1', 'Z>S'].sort())
    expect(CHART_NOISE_INJECTION).toMatch(/X -\. "同一個 \$x\[n\]\$" \.-> G/)
    expect(CHART_NOISE_INJECTION).toContain('class V,A warn')
    expect(await edgeText(CHART_NOISE_INJECTION, 'S', 'Z')).toBe(String.raw`$\delta[n+1]$`)
    expect(await edgeText(CHART_NOISE_INJECTION, 'Z', 'M1')).toBe(String.raw`$\delta[n]$`)
  })

  it('圖 3-2（LMS 迴圈）：兩條支路都還在；模型先宣告，累加器的回授線才會畫成往上回到模型', async () => {
    expect(await edgeList(CHART_LMS_LOOP)).toEqual(['ACC>MOD', 'CMP>GAIN', 'GAIN>ACC', 'MOD>CMP', 'SYS>CMP', 'X>GAIN', 'X>MOD', 'X>SYS'].sort())
    const toModel = CHART_LMS_LOOP.search(/X\[[^\n]*\] --> MOD\[/)
    const toSystem = CHART_LMS_LOOP.search(/\n {2}X --> SYS\[/)
    expect(toModel).toBeGreaterThan(0)
    expect(toModel).toBeLessThan(toSystem)
  })

  it('互不相連的並排子圖：宣告順序與畫出來的順序相反，這樣圖說與正文「先看…再看…」的順序才和畫面一致', () => {
    // 圖 3-3：上＝展開、下＝合併；圖 3-7：上＝一條路徑、下＝取期望值；圖 3-9：上＝±1、Uniform、下＝Gaussian；圖 3-17：左＝天真、右＝單步
    expect(subgraphOrder(CHART_ERROR_RECURSION)).toEqual(['MERGE', 'EXPAND'])
    expect(subgraphOrder(CHART_MEAN_PATH)).toEqual(['MEAN', 'PATH'])
    expect(subgraphOrder(CHART_KURTOSIS_COMPARE)).toEqual(['GA', 'UN', 'PM'])
    expect(subgraphOrder(CHART_NAIVE_VS_ONESTEP)).toEqual(['ONE', 'NAIVE'])
  })

  it('子圖標題只寫一行文字（Mermaid 只替標題留一行的高度）；標題裡原有的式子與條件改放在框內的節點上，一個都沒少', async () => {
    for (const d of DIAGRAMS) for (const t of subgraphTitles(d.chart)) expect(t, `${d.name}：子圖標題「${t}」`).not.toContain('$')
    // 圖 3-9：三種分布的定義（±1、U(−√3, √3)、N(0, 1)）在每一列的第一格；標題只留分布名稱
    expect(subgraphTitles(CHART_KURTOSIS_COMPARE)).toEqual(['Gaussian 分布', 'Uniform 分布', '正負 1 的 code'])
    expect(await nodeText(CHART_KURTOSIS_COMPARE, 'P1')).toBe(String.raw`$x = \pm 1$<br/>$|x|$ 恆為 1<br/>$x^2$ 完全不起伏`)
    expect(await nodeText(CHART_KURTOSIS_COMPARE, 'U1')).toBe(String.raw`$U(-\sqrt{3}, \sqrt{3})$<br/>$|x| \le \sqrt{3}$<br/>$x^2$ 有上限`)
    expect(await nodeText(CHART_KURTOSIS_COMPARE, 'G1')).toBe(String.raw`$\mathcal N(0, 1)$<br/>$|x|$ 沒有上限<br/>偶爾出現很大的 $x^2$`)
    // 圖 3-7：標題只留「兩邊取期望值」；E[δ[n]]、固定增益 1 − μP_x，以及「x 與 δ 獨立，可以拆開」這個條件都在框內
    expect(subgraphTitles(CHART_MEAN_PATH)).toEqual(['兩邊取期望值：增益變成固定的', '一條路徑：增益是隨機的'])
    expect(await edgeText(CHART_MEAN_PATH, 'Z2', 'G2')).toBe(String.raw`$E[\delta[n]]$`)
    expect(await edgeText(CHART_MEAN_PATH, 'G2', 'Z2')).toBe(String.raw`$E[\delta[n+1]]$`)
    expect(await nodeText(CHART_MEAN_PATH, 'G2')).toBe(String.raw`$\times\, (1 - \mu P_x)$<br/>$P_x = E[x^2]$<br/>（$x[n]$ 與 $\delta[n]$ 獨立，可以拆開）`)
    // 圖 3-17：天真做法走 n 步在第一格；圖 3-22：i = 1…N 在 sample rate 框的第一格、索引 k 在 block rate 框的 S[k]、δ[k] 上
    expect(subgraphTitles(CHART_NAIVE_VS_ONESTEP)).toEqual(['本站做法：只抽一步，再用封閉式', '天真做法：走完全程再平均'])
    expect(await nodeText(CHART_NAIVE_VS_ONESTEP, 'N1')).toBe(String.raw`$M$ 條路徑各走 $n$ 步`)
    expect(subgraphTitles(CHART_BLOCK_GMAC)).toEqual(['sample rate：block 內的每一筆', 'block rate：每 N 筆一次'])
    expect(await nodeText(CHART_BLOCK_GMAC, 'PROD')).toBe(String.raw`每一筆 $x[i]$（$i = 1 \ldots N$）做一次相乘<br/>$e[i] \cdot x[i] = \delta[k] \cdot x[i]^2$`)
    expect(await nodeText(CHART_BLOCK_GMAC, 'SCALE')).toContain(String.raw`$S[k] = (1/N) \cdot \sum x[i]^2$`)
    // 標題只有一行、不長（Mermaid 只替標題留一行的高度；約 200px 就換行）
    for (const d of DIAGRAMS) for (const t of subgraphTitles(d.chart)) expect(t, `${d.name}：子圖標題「${t}」`).not.toContain('<br/>')
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
      // 交給 mermaid 的是登錄的 23 張（系統地圖是手排的 SVG，不經過 mermaid，所以不在這個清單裡）
      const drawn = Array.from(container.querySelectorAll('[data-testid="mermaid-src"]'))
      expect(drawn).toHaveLength(N_DIAGRAMS)
      expect(drawn.some((el) => el.closest('.c-sysmap'))).toBe(false)
      // 第一張：系統地圖，緊接在章首的開場問題之後、第一個小節之前
      const maps = container.querySelectorAll('figure.c-sysmap')
      expect(maps).toHaveLength(1)
      const map = maps[0]
      const lead = container.querySelector('.ch03-lead')!
      const firstSection = container.querySelector('section.c-section')!
      expect(follows(lead, map)).toBe(true)
      expect(follows(map, firstSection)).toBe(true)
      expect(follows(map, drawn[0])).toBe(true) // 系統地圖在第一張編號圖之前
      expect(container.textContent).toMatch(/你在這裡：藍色方塊是本章的主角/)
      // 藍色方塊（is-focus）就是 SYSTEM_FOCUS 這三格，其餘 14 格不亮
      const lit = Array.from(map.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
      expect([...lit].sort()).toEqual(['acc', 'res', 'scale'])
      expect(map.querySelectorAll('g.c-sysmap-block')).toHaveLength(Object.keys(SYSTEM_BLOCK_LABEL).length)
      expect(map.querySelectorAll('g.c-sysmap-block[data-focus="true"]')).toHaveLength(3)
      // 預設圖說列出被標示的方塊名稱
      const mapCaption = map.querySelector('figcaption.c-figcaption')!.textContent!
      expect(mapCaption).toMatch(/^系統地圖：藍色是本章的主角/)
      for (const id of SYSTEM_FOCUS) expect(mapCaption, id).toContain(SYSTEM_BLOCK_LABEL[id].split('$')[0].trim())
      // 系統地圖不經過 mermaid（所以沒有「Unsupported markdown」的問題），方塊與連線上的字是 KaTeX／HTML：
      // 公式都由 KaTeX 排版、沒有殘留的 `$`，KaTeX 以外的文字沒有 Unicode 拼的數學，方塊名稱都在
      const mapSvg = map.querySelector('svg.c-sysmap-svg')!
      expect(mapSvg.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(8)
      expect(mapSvg.textContent).not.toContain('$')
      const bare = mapSvg.cloneNode(true) as Element
      bare.querySelectorAll('.katex').forEach((k) => k.remove())
      expect(unicodeMathIn(bare.textContent ?? '')).toEqual([])
      // KaTeX 的 \text 把空白排成不換行空白（U+00A0），所以先換回一般空白再比對
      expect(mapSvg.textContent!.replace(/\u00a0/g, ' ')).toContain('Gain accumulator')
      // 其餘：與 DIAGRAMS 同順序、各出現一次
      expect(drawn.map((el) => el.textContent)).toEqual(DIAGRAMS.map((d) => d.chart))
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
    // 章首沒有「本章符號表在最後」那一行（連結由 PageFrame 的本章資訊 strip 提供）；也沒有會被 HashRouter 當成路由的 href
    expect(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('本章符號表在最後'))).toBeUndefined()
    expect(container.querySelector('a[href="#symbols"]')).toBeNull()
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const saved = proto.scrollIntoView
    const calls: Element[] = []
    proto.scrollIntoView = function (this: Element) {
      calls.push(this)
    }
    try {
      // 符號表底下可以回到章首
      const back = Array.from(symbols.querySelectorAll('button')).find((b) => b.textContent?.includes('回到本章開頭'))!
      back.click()
      expect(calls).toEqual([container.querySelector('#ch03-top')])
    } finally {
      proto.scrollIntoView = saved
    }
  }, 60000 * SLOW)
})
