import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { SYSTEM_BLOCK_LABEL, accessibleText, systemMapModel } from '@/components'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { DEFAULT_RULE, buildPlant, corrMatrix, propagateLinearMoments } from '@/simulation/models/mimo'
import * as diagramsModule from './diagrams'
import {
  CH10_DIAGRAMS,
  CHART_ACAL_CHECK,
  CHART_CODE_FLOW,
  CHART_COMPARATOR_GAIN,
  CHART_COUPLING_PATHS,
  CHART_FD_TRADEOFF,
  CHART_GMAC_NOISE,
  CHART_GS_SWEEP,
  CHART_HANDCALC_FLOW,
  CHART_HW_MAP,
  CHART_JACOBIAN_FSM,
  CHART_K95_FLOW,
  CHART_LYAPUNOV,
  CHART_MIMO_SYSTEM,
  CHART_MODE_GAIN,
  CHART_M_VARIANTS,
  CHART_NLMS,
  CHART_NOISE_PATH,
  CHART_PINV_SVD,
  CHART_REG_COMPARE,
  CHART_SAMPLE_TO_BLOCK,
  CHART_SEQ_FSM,
  CHART_SEQ_TRAP,
  CHART_T18_COUPLING,
  CHART_T18_MODES,
  CHART_UPDATE_LOOP,
  SYSTEM_MAP_FOCUS,
  diagram,
} from './diagrams'
import Chapter10 from './index'
import { NUM, SIGMA_KQ1 } from './numbers'
import { S0Intro } from './sections/S0Intro'

/**
 * 第 10 章方塊圖的測試（docs/teaching-style.md §8）。
 *  1. 每張圖的 Mermaid 原始碼都用「真正的」mermaid parser 解析；
 *  2. 每張圖都用共用的 renderMermaidForTest（@/components/mermaidTestUtils，與網站相同的前處理）在 jsdom 下「真的 render」一次，
 *     檢查畫面上不會出現 Mermaid 的「Unsupported markdown」（Mermaid 11 把每個標籤當 Markdown：單獨一個半形 + 會被當成清單）、
 *     沒有意外的粗體／斜體，畫出來的節點不超過 14 個；圖裡的數學都是 LaTeX（`$...$` 由 KaTeX 排版）：畫出來的文字沒有殘留的 `$`、
 *     KaTeX 以外沒有 Unicode 拼的數學（unicodeMathIn；原始碼裡 `$...$` 以外的文字也檢查一次，因為含公式的標籤會整個變成 KaTeX）；
 *  3. 圖的數量、頁面上的順序與位置（先看圖、再看推導）、章首的 <SystemMap>（手排的 SVG，不經過 Mermaid：主角用 systemMapModel／is-focus 檢查）；
 *  4. 圖上的數字、正負號與正文公式（numbers.ts／模型函式）一致。
 * mermaid 的 parser 與 render 都是真的：只在 render 外面包一層記錄；唯一的例外是「整章」那個測試（見 seen.stub 的說明）。
 */

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))

// 互動實驗（MIMO LMS Lab）與方塊圖無關，而且很重（worker、Monte Carlo）：這個檔案用空元件代替，它自己的測試在 ch10.test.tsx。
vi.mock('./experiments/MimoLab', () => ({ MimoLab: () => null }))

const seen = vi.hoisted(() => ({ rendered: [] as { chart: string; svg: string }[], stub: false }))
vi.mock('mermaid', async (importOriginal) => {
  const real = (await importOriginal<typeof import('mermaid')>()).default
  return {
    default: {
      ...real,
      // 預設是真正的 render，只是把（原始碼, SVG）記下來。
      // seen.stub = true 時只記錄、不畫：整章的 DOM 在 jsdom 下有數十萬個節點，mermaid 每畫一張圖要 3 秒以上（28 張 ≈ 95 秒）；
      // 所以「整頁」的測試只確認每張圖的原始碼都送進了 mermaid.render，「真的畫出來」則在乾淨的 DOM 上逐張檢查。
      render: async (id: string, text: string) => {
        if (seen.stub) {
          seen.rendered.push({ chart: text, svg: '' })
          return { svg: `<svg id="${id}" data-stub="1"></svg>`, diagramType: 'flowchart-v2' }
        }
        const out = await real.render(id, text)
        seen.rendered.push({ chart: text, svg: out.svg })
        return out
      },
    },
  }
})

type MermaidApi = (typeof import('mermaid'))['default']
let mermaid: MermaidApi

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 })

beforeAll(async () => {
  // jsdom 沒有 SVG 的幾何量測：共用的墊片給每個標籤「字數 × 固定寬度」的大小，讓 mermaid 走完整個 render 流程（絕對座標不在這裡驗）。
  installMermaidSvgShim()
  mermaid = (await import('mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
})

const NEW_DIAGRAMS = CH10_DIAGRAMS.filter((d) => d.id !== 'system')
/** 章首系統地圖裡被標成主角的方塊 id（排序後）：由純資料模型 systemMapModel 取得，不經過 Mermaid */
const FOCUSED_BLOCKS = systemMapModel(SYSTEM_MAP_FOCUS)
  .blocks.filter((b) => b.focused)
  .map((b) => b.id)
  .sort()

/**
 * SVG 裡每個標籤（foreignObject）畫出來的純文字。KaTeX 排版的標籤：拿掉 MathML 複本、零寬空白（\text 裡的空格是 nbsp，換回一般空格）後，
 * 就是公式的可見字元（變數、運算符號、數字依序相連，例如 `δk=a−wk`；多行公式的各行直接相連）。
 */
function labelsOf(svg: string): string[] {
  const host = document.createElement('div')
  host.innerHTML = svg
  host.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  return Array.from(host.querySelectorAll('foreignObject'))
    .map((f) => (f.textContent ?? '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim())
    .filter(Boolean)
}

/** 原始碼裡 `$...$`／`$$...$$` 以外的文字（含 `\text{}` 以外的標籤文字）：這裡不可以還有 Unicode 拼的數學 */
function outsideMath(chart: string): string {
  return chart.replace(/\$\$(?:[^$\\]|\\.)+?\$\$|(?<!\\)\$(?:[^$\\]|\\.)+?(?<!\\)\$/g, '').replace(/^\s*(?:classDef|class) .*$/gm, '')
}

/** parts 依序出現在 chart 裡（用來鎖住「A 接 B 接 C」的訊號順序） */
function expectInOrder(chart: string, parts: string[], what: string) {
  let at = -1
  for (const part of parts) {
    const i = chart.indexOf(part, at + 1)
    expect(i, `${what}：找不到（或順序不對）${part}`).toBeGreaterThan(at)
    at = i
  }
}

type Rendered = Awaited<ReturnType<typeof renderMermaidForTest>>
const renderCache = new Map<string, Promise<Rendered>>()
/** 用共用的測試工具真的畫一次（每張圖只畫一次，之後的測試重複使用同一份 SVG） */
function rendered(chart: string): Promise<Rendered> {
  let hit = renderCache.get(chart)
  if (!hit) {
    hit = renderMermaidForTest(chart)
    renderCache.set(chart, hit)
  }
  return hit
}
async function renderChart(chart: string): Promise<string> {
  return (await rendered(chart)).svg
}

interface Layout {
  /** 節點中心（flowchart 的節點 id → 座標）；同一個 subgraph 內才可互相比較 */
  node: Record<string, { x: number; y: number }>
  /** 沒有對外連線的 subgraph 會各自排版，再由外層圖擺放：subgraph id → 外層的位移 */
  frame: Record<string, { x: number; y: number }>
}

/**
 * 由 mermaid（dagre）實際排出來的版面讀出節點的相對位置。jsdom 沒有文字量測，所以每個標籤都當成一樣大：
 * 絕對座標沒有意義，但「誰在誰的左邊／上面」只由圖的結構與宣告順序決定，和瀏覽器裡一樣。
 */
async function layoutOf(chart: string): Promise<Layout> {
  const host = document.createElement('div')
  host.innerHTML = await renderChart(chart)
  const xy = (t: string | null) => {
    const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(t ?? '')
    return { x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN }
  }
  const node: Layout['node'] = {}
  for (const g of Array.from(host.querySelectorAll('g.node'))) node[g.id.replace(/^.*?flowchart-/, '').replace(/-\d+$/, '')] = xy(g.getAttribute('transform'))
  const frame: Layout['frame'] = {}
  for (const g of Array.from(host.querySelectorAll('g.root'))) {
    const t = g.getAttribute('transform')
    if (!t) continue
    for (const c of Array.from(g.querySelectorAll(':scope > g.clusters > g.cluster'))) frame[c.id] = xy(t)
  }
  return { node, frame }
}

/** 由左到右（或由上到下）嚴格遞增 */
function expectIncreasing(values: number[], what: string) {
  for (const v of values) expect(Number.isFinite(v), what).toBe(true)
  for (let i = 1; i < values.length; i++) expect(values[i], `${what}：第 ${i + 1} 個應該在第 ${i} 個之後`).toBeGreaterThan(values[i - 1])
}

describe('Ch10 方塊圖：登錄表', () => {
  it('27 張圖（1 張原有 + 26 張新增，遠多於要求的 6 張）；加上章首的 SystemMap，頁面共有 28 張 Mermaid 圖', () => {
    expect(CH10_DIAGRAMS.length).toBe(27)
    expect(NEW_DIAGRAMS.length).toBe(26)
    expect(NEW_DIAGRAMS.length).toBeGreaterThanOrEqual(6)
  })

  it('每個匯出的 CHART_* 常數都登錄了一次，名稱與內容對得上（沒有畫了卻沒放上頁面的圖）', () => {
    const exported = Object.entries(diagramsModule).filter(([k]) => k.startsWith('CHART_')) as [string, string][]
    expect(exported.length).toBe(CH10_DIAGRAMS.length)
    for (const [name, chart] of exported) {
      const hits = CH10_DIAGRAMS.filter((d) => d.name === name)
      expect(hits.length, name).toBe(1)
      expect(hits[0].chart, name).toBe(chart)
    }
    expect(new Set(CH10_DIAGRAMS.map((d) => d.id)).size).toBe(CH10_DIAGRAMS.length)
    expect(new Set(CH10_DIAGRAMS.map((d) => d.chart)).size).toBe(CH10_DIAGRAMS.length)
  })

  it('圖號依頁面順序 10-1 … 10-27；找不到的 id 會丟錯（頁面不會默默少一張圖）', () => {
    CH10_DIAGRAMS.forEach((d, i) => expect(diagram(d.id).no).toBe(`10-${i + 1}`))
    expect(diagram(CH10_DIAGRAMS[CH10_DIAGRAMS.length - 1].id).no).toBe('10-27')
    expect(() => diagram('no-such-diagram')).toThrow(/找不到圖/)
  })

  it('圖的種類涵蓋規範 §8 列的七種；每張圖都有圖說（一句話說明要看什麼）與純文字替代說明', () => {
    const kinds = new Set(CH10_DIAGRAMS.map((d) => d.kind))
    for (const k of ['系統圖', '數學模型', '演算法迴圈', '路徑圖', '比較圖', '手算流程', '狀態機']) expect(kinds.has(k as never), k).toBe(true)
    for (const d of CH10_DIAGRAMS) {
      expect(d.caption.length, d.id).toBeGreaterThan(20)
      expect(d.alt.length, d.id).toBeGreaterThan(10)
      expect(d.alt, `${d.id}：替代說明是純文字`).not.toContain('$')
      // 圖說裡的 $ 成對（mathText 才能渲染）
      expect((d.caption.match(/\$/g) ?? []).length % 2, d.id).toBe(0)
      // 圖說的數學也是 LaTeX：`$...$` 以外沒有 Unicode 拼的數學
      expect(unicodeMathIn(outsideMath(d.caption)), `${d.id} 的圖說`).toEqual([])
    }
  })

  it('SystemMap 標出 GMAC、「÷ N、× μ」與 gain accumulator（本章把它們變成 P 個 GMAC、更新矩陣 M 與向量 w_k）', () => {
    expect(SYSTEM_MAP_FOCUS).toEqual(['gmac', 'scale', 'acc'])
    // 系統地圖是手排的 SVG：被標成藍色的方塊由 systemMapModel（純資料）決定，其餘方塊不是主角
    const model = systemMapModel(SYSTEM_MAP_FOCUS)
    expect(FOCUSED_BLOCKS).toEqual(['acc', 'gmac', 'scale'])
    expect(model.blocks.filter((b) => !b.focused).length).toBe(model.blocks.length - 3)
  })
})

describe('Ch10 方塊圖：真正的 mermaid parser 與 render', () => {
  it('每張圖都能被 mermaid.parse 解析：25 張 flowchart、2 張 stateDiagram-v2', async () => {
    const types: string[] = []
    for (const d of CH10_DIAGRAMS) {
      const r = await mermaid.parse(d.chart)
      const type = r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : ''
      expect(type, d.name).toMatch(/^(flowchart-v2|stateDiagram)$/)
      types.push(type)
    }
    expect(types.filter((t) => t === 'stateDiagram').length).toBe(2)
    expect(types.filter((t) => t === 'flowchart-v2').length).toBe(25)
  })

  it('負面：parser 真的在檢查——把一張圖的引號拿掉就解析失敗', async () => {
    const broken = CHART_COUPLING_PATHS.replace(String.raw`D1["$\delta_1 = a_1 - w_1$<br/>`, () => String.raw`D1[$\delta_1 = a_1 - w_1$ (<br/>`)
    expect(broken).not.toBe(CHART_COUPLING_PATHS)
    await expect(mermaid.parse(broken)).rejects.toThrow()
  })

  it('每張圖不超過 14 個節點（規範 §8：太大就拆）', async () => {
    for (const d of CH10_DIAGRAMS) {
      const dg = await mermaid.mermaidAPI.getDiagramFromText(d.chart)
      const db = dg.db as { getVertices?: () => Map<string, unknown> }
      // flowchart：parser 資料庫裡的節點數；stateDiagram-v2：狀態要到 render 才展開，改數原始碼裡宣告的狀態（本章的狀態都用 state "…" as ID 宣告）
      const nodes = db.getVertices ? db.getVertices().size : (d.chart.match(/^\s*state "/gm) ?? []).length
      expect(nodes, d.name).toBeGreaterThanOrEqual(3)
      expect(nodes, d.name).toBeLessThanOrEqual(14)
    }
  })

  it('每張圖都用 renderMermaidForTest 在 jsdom 下真的 render：沒有「Unsupported markdown」、沒有被當成 Markdown 的粗體／斜體／刪除線，畫出來的節點不超過 14 個', async () => {
    for (const d of CH10_DIAGRAMS) {
      const { svg, text, nodeCount } = await rendered(d.chart)
      expect(svg, d.name).toContain('<svg')
      expect(text, d.name).not.toMatch(/Unsupported markdown/)
      expect(svg, d.name).not.toMatch(/Unsupported markdown/)
      expect(svg, d.name).not.toMatch(/<(em|strong|del|code|h[1-6]|ul|ol|li|blockquote)[\s>]/)
      expect(labelsOf(svg).length, d.name).toBeGreaterThanOrEqual(4)
      expect(nodeCount, d.name).toBeGreaterThanOrEqual(3)
      // 本章自己的圖一律 ≤ 14 個節點（subgraph 的標題不算節點）；全站共用的 SystemMap 不經過 Mermaid，版面由 SystemMap.test.tsx 管
      expect(nodeCount, d.name).toBeLessThanOrEqual(14)
    }
    // 畫出來的標籤就是原始碼裡寫的訊號名稱（抽查幾張：迴路、比較、狀態機）；公式是 KaTeX 排版後的可見字元
    expect(labelsOf(await renderChart(CHART_UPDATE_LOOP))).toEqual(expect.arrayContaining(['δk=a−wk', 'Gk', 'wk+1', '−wk', '×M更新矩陣']))
    expect(labelsOf(await renderChart(CHART_T18_MODES))).toEqual(expect.arrayContaining(['p=1+0.2×(+1)=1.2每個 block 放大 1.2 倍']))
    expect(labelsOf(await renderChart(CHART_JACOBIAN_FSM))).toEqual(expect.arrayContaining(['FREEZE：所有係數停止更新', 'P 欄都量完']))
    // 含「|」「′」「∝」的標籤也原樣畫出來（沒有被 Mermaid 的語法或 Markdown 吃掉）
    expect(labelsOf(await renderChart(CHART_COMPARATOR_GAIN))).toEqual(expect.arrayContaining(['e=s+v', '∣s∣ 遠小於 σv', '∣s∣ 遠大於 σv', '1-bit comparatorq=sign(e)，只有 ±1']))
    expect(labelsOf(await renderChart(CHART_GS_SWEEP))).toEqual(expect.arrayContaining(['δ1′=−ρδ2', 'δ2′=−ρδ1′=ρ2δ2', '下一輪：再乘一次 ρ2']))
    expect(labelsOf(await renderChart(CHART_GMAC_NOISE))).toEqual(expect.arrayContaining(['Gk=KqRδk+ηkηk 的平均是 0，Cov(ηk)≈R/N']))
  })

  it('圖裡的數學都是 LaTeX：每張圖都有 KaTeX 排版的公式，畫出來的文字沒有殘留的 `$`，KaTeX 以外（畫出來的文字與原始碼）沒有 Unicode 拼的數學', async () => {
    for (const d of CH10_DIAGRAMS) {
      const { text, plainText, mathCount } = await rendered(d.chart)
      expect(mathCount, `${d.name}：KaTeX 公式數`).toBeGreaterThanOrEqual(3)
      expect(text, `${d.name}：畫出來的文字不可殘留 $`).not.toContain('$')
      expect(unicodeMathIn(plainText), `${d.name}：畫出來、KaTeX 以外的文字`).toEqual([])
      // 含公式的標籤整個變成 KaTeX（文字進 \text{}），所以 plainText 看不到它們：原始碼裡 `$...$` 以外的文字再查一次
      expect(unicodeMathIn(outsideMath(d.chart)), `${d.name}：原始碼 $...$ 以外的文字`).toEqual([])
    }
    // 每個含公式的標籤，原始碼的 `$` 都成對（奇數個 `$` 會讓 KaTeX 少排一段）
    for (const d of CH10_DIAGRAMS) {
      for (const label of d.chart.match(/"[^"\n]*"/g) ?? []) {
        expect((label.match(/(?<!\\)\$/g) ?? []).length % 2, `${d.name}：${label}`).toBe(0)
      }
    }
  })

  it('負面：LaTeX 檢查真的抓得到——TeX 寫錯會讓 render 丟出例外；標籤裡還留著 Unicode 拼的數學，兩個檢查都會報', async () => {
    await expect(renderMermaidForTest(String.raw`flowchart LR
  A["$\frac{1}{$"] --> B["y"]`)).rejects.toThrow()
    // 完全沒有公式的標籤：畫出來的文字就抓得到 μ、·、²、w_k
    const plain = await renderMermaidForTest('flowchart LR\n  A["步長 μ·e²"] --> B["w_k"]')
    expect(unicodeMathIn(plain.plainText)).toEqual(expect.arrayContaining(['μ', '·', '²', 'w_k']))
    // 有公式的標籤：文字部分被包進 \text{}，畫出來的文字看不到，原始碼的檢查才抓得到
    const mixed = String.raw`flowchart LR
  A["誤差 $e[n]$，步長 μ"] --> B["$w_k$"]`
    const m = await renderMermaidForTest(mixed)
    expect(m.mathCount).toBe(2)
    expect(unicodeMathIn(m.plainText)).toEqual([])
    expect(unicodeMathIn(outsideMath(mixed))).toEqual(['μ'])
  })

  it('負面：render 檢查真的抓得到——半形「+」的加法點會變成「Unsupported markdown: list」，所以本章一律用全形「＋」', async () => {
    // 直接呼叫 mermaid.render（不經共用工具的 sanitizeMermaidSource），才看得到半形 + 原本會變成什麼
    const bad = (await mermaid.render('ch10-neg-plus', 'flowchart LR\n  A["x"] -- "+" --> S((+))\n  S --> B["y"]')).svg
    expect(bad).toMatch(/Unsupported markdown: list/)
    const good = (await mermaid.render('ch10-neg-fullwidth', 'flowchart LR\n  A["x"] -- "＋" --> S(("＋"))\n  S --> B["y"]')).svg
    expect(good).not.toMatch(/Unsupported markdown/)
    // 同一張「壞」圖經過共用工具（= 網站的前處理）就畫得出來；本章的原始碼不依賴這個補救
    expect((await renderMermaidForTest('flowchart LR\n  A["x"] -- "+" --> S((+))\n  S --> B["y"]')).text).not.toMatch(/Unsupported markdown/)
    for (const d of CH10_DIAGRAMS) {
      // 原始碼裡不可以有單獨一個半形 + / - / * 的標籤
      expect(d.chart, d.name).not.toMatch(/"[+\-*]"/)
      expect(d.chart, d.name).not.toMatch(/\(\([+\-*]\)\)/)
      // 有標色的圖都帶著三個 classDef，而且只用這三個 class
      for (const m of d.chart.matchAll(/^\s*class [\w,]+ (\w+)\s*$/gm)) {
        expect(['focus', 'warn', 'ok'], d.name).toContain(m[1])
        expect(d.chart, d.name).toContain(`classDef ${m[1]} fill:`)
      }
    }
  })
})

describe('Ch10 方塊圖：導讀與圖說裡的方位詞（左／右／上／下、哪一框在前）與實際排出來的版面一致', () => {
  it('訊號由左到右（flowchart LR）：耦合、更新迴路、eigen 分解、雜訊路徑、Lyapunov、NLMS', async () => {
    for (const chart of [CHART_COUPLING_PATHS, CHART_UPDATE_LOOP, diagram('eigen-modes').chart, CHART_NOISE_PATH, CHART_LYAPUNOV, CHART_NLMS]) expect(chart).toMatch(/^flowchart LR\n/)
    let L = await layoutOf(CHART_COUPLING_PATHS)
    expectIncreasing([L.node.D1.x, L.node.R11.x, L.node.S1.x, L.node.K1.x, L.node.G1.x], '耦合圖：δ → ×R → 加法點 → ×K_q → G')
    expect(L.node.S1.y, '耦合圖：GMAC₁ 的加法點在上面').toBeLessThan(L.node.S2.y)
    expect(L.node.G1.y).toBeLessThan(L.node.G2.y)
    L = await layoutOf(CHART_UPDATE_LOOP)
    expectIncreasing([L.node.A.x, L.node.SD.x, L.node.KR.x, L.node.SG.x, L.node.M.x, L.node.SW.x, L.node.Z.x], '更新迴路：左邊的加法點 … 右邊的累加器')
    L = await layoutOf(diagram('eigen-modes').chart)
    expectIncreasing([L.node.D.x, L.node.VT.x, L.node.L1.x, L.node.V.x, L.node.DN.x], 'eigen 分解：左邊 ×Vᵀ、中間各自的 pole、右邊 ×V')
    L = await layoutOf(CHART_NOISE_PATH)
    expectIncreasing([L.node.S.x, L.node.SUM.x, L.node.M.x], '雜訊路徑：雜訊從中間的加法點進來，只經過後面的 M')
    L = await layoutOf(CHART_LYAPUNOV)
    expectIncreasing([L.node.Q.x, L.node.MQ.x, L.node.S.x, L.node.Z.x, L.node.AX.x], 'Lyapunov：左邊進來的新雜訊、右邊繞圈的 A·X·Aᵀ')
    L = await layoutOf(CHART_NLMS)
    expectIncreasing([L.node.X.x, L.node.EN.x, L.node.DIV.x, L.node.RES.x], 'NLMS：code → 能量估計 → 正規化 → 更新')
    expect(L.node.G.x).toBeLessThan(L.node.DIV.x)
  })

  it('太寬的橫向流程改成由上往下（flowchart TB，桌機不必橫向捲動）：系統圖、取樣率、comparator 增益、GMAC 雜訊、SVD、Gauss–Seidel、程式碼資料流、硬體對應', async () => {
    for (const chart of [CHART_MIMO_SYSTEM, CHART_SAMPLE_TO_BLOCK, CHART_COMPARATOR_GAIN, CHART_GMAC_NOISE, CHART_PINV_SVD, CHART_GS_SWEEP, CHART_CODE_FLOW, CHART_HW_MAP]) expect(chart).toMatch(/^flowchart TB\n/)
    let L = await layoutOf(CHART_MIMO_SYSTEM)
    expectIncreasing([L.node.E.y, L.node.Q.y, L.node.G1.y, L.node.M.y, L.node.W.y], '系統圖：e[n] 在最上面、comparator 與 GMAC 在中間、M 與 w 在最下面')
    expectIncreasing([L.node.G1.x, L.node.G2.x, L.node.G3.x], '系統圖：三個 GMAC 並排，GMAC₁ 在最左')
    L = await layoutOf(CHART_SAMPLE_TO_BLOCK)
    expectIncreasing([L.node.U2.y, L.node.SE.y, L.node.CMP.y, L.node.X1.y, L.node.A1.y, L.node.G1.y], '取樣率圖：上框（sample）→ 下框（block）')
    expectIncreasing([L.node.U1.x, L.node.U2.x, L.node.V.x], '取樣率圖：u₁δ₁、u₂δ₂、雜訊由左到右')
    expectIncreasing([L.node.X1.x, L.node.X2.x], '取樣率圖：兩個 GMAC 並排，第 1 個在左')
    expect(L.node.A1.y).toBe(L.node.A2.y)
    L = await layoutOf(CHART_COMPARATOR_GAIN)
    expectIncreasing([L.node.S.y, L.node.ADD.y, L.node.CMP.y, L.node.AVG.y, L.node.LIN.y], 'comparator 增益：上面的加法點 → comparator → 取平均 → 下面分出兩條路')
    expect(L.node.SAT.y, '飽和那一路與線性那一路同一層').toBe(L.node.LIN.y)
    expect(L.node.LIN.x, '線性（藍）在左、飽和（紅）在右').toBeLessThan(L.node.SAT.x)
    expectIncreasing([L.node.S.x, L.node.V.x], 'comparator 增益：訊號 s 在左、雜訊 v 在右，兩路都進同一個加法點')
    // GMAC 雜訊：兩個框用「框對框」的連線（框 → 框，不是節點 → 節點），這樣箭頭停在框的邊緣、不會穿過框的標題；框內各自由上往下
    L = await layoutOf(CHART_GMAC_NOISE)
    expect(CHART_GMAC_NOISE).toContain('FAST --> SLOW')
    expect(L.frame.FAST.y, 'sample 速率的框在上面').toBeLessThan(L.frame.SLOW.y)
    expect(Math.max(L.node.Q.y, L.node.X.y), '框內：q 與 code 先進乘積').toBeLessThan(L.node.P.y)
    expectIncreasing([L.node.Q.x, L.node.X.x], 'GMAC 雜訊：q 在左、code 在右')
    expectIncreasing([L.node.AVG.y, L.node.G.y, L.node.EX.y], 'GMAC 雜訊：block 框內 平均 → G_k → 例子')
    // SVD：兩個框並排，框內各自由上往下；① 晶片在左、② 更新矩陣在右（後宣告的框排在前面）
    L = await layoutOf(CHART_PINV_SVD)
    expectIncreasing([L.node.E.y, L.node.VT.y, L.node.SG.y, L.node.U.y, L.node.EG.y], 'SVD ①（晶片）：ε → ×Vᵀ → ×σ → ×U → E[G]')
    expectIncreasing([L.node.GK.y, L.node.UT.y, L.node.INV.y, L.node.V.y, L.node.GM.y, L.node.OUT.y], 'SVD ②（更新矩陣）：G → ×Uᵀ → 除法 → ×V → ×(−γ) → 更新')
    L = await layoutOf(CHART_GS_SWEEP)
    expectIncreasing([L.node.S0.y, L.node.P1.y, L.node.P2.y, L.node.E.y], 'Gauss–Seidel：階段 1 → 階段 2 → 最下面是一輪的結果')
    L = await layoutOf(CHART_CODE_FLOW)
    expectIncreasing([L.node.JH.y, L.node.RULE.y, L.node.BU.y, L.node.NX.y], '程式碼資料流：Ĵ_n → 規則 → blockUpdate → 下一個 block')
    expectIncreasing([L.node.D.y, L.node.GM.y, L.node.BU.y], '程式碼資料流：δ_k → GMAC → blockUpdate')
    expectIncreasing([L.node.RULE.x, L.node.GM.x], '程式碼資料流：左邊一路是規則（M_n），右邊一路是 GMAC（G_k），兩路在 blockUpdate 會合')
    L = await layoutOf(CHART_HW_MAP)
    expectIncreasing([L.node.CMP.y, L.node.G1.y, L.node.MIX.y, L.node.ACC.y, L.node.DTC.y], '硬體對應：comparator → GMAC → 混合矩陣 → 係數暫存器 → reference 端的 DTC')
    expectIncreasing([L.node.G1.x, L.node.G2.x, L.node.G3.x], '硬體對應：三個 GMAC accumulator 並排')
    expect(L.node.G1.y).toBe(L.node.G3.y)
  })

  it('並排比較由上到下：五種更新矩陣（scalar 在最上面）、598 的兩條路、regularized 三選一、Δ 的三種大小、T18 的訊號流', async () => {
    let L = await layoutOf(CHART_M_VARIANTS)
    expectIncreasing([L.node.M1.y, L.node.M2.y, L.node.M3.y, L.node.M4.y, L.node.M5.y], '五種更新矩陣：scalar 在最上面一列')
    expectIncreasing([L.node.G.x, L.node.M1.x, L.node.P1.x], '五種更新矩陣：G → M → 結果')
    L = await layoutOf(CHART_K95_FLOW)
    expect(L.node.P.y, '598 的流程：一般 LMS 在上面一路').toBeLessThan(L.node.PF.y)
    expect(L.node.K.y).toBeLessThan(L.node.KF.y)
    expectIncreasing([L.node.R.x, L.node.L.x, L.node.P.x, L.node.K.x], '598 的流程：ρ → λ → p → k₉₅')
    L = await layoutOf(CHART_REG_COMPARE)
    expectIncreasing([L.node.IN.x, L.node.A.x, L.node.A2.x], '三種增益：中間一欄是 m、右邊一欄是結果')
    expectIncreasing([L.node.A.y, L.node.B.y, L.node.C.y], '三種增益：一般 LMS、完整反矩陣、Regularized')
    L = await layoutOf(CHART_FD_TRADEOFF)
    expectIncreasing([L.node.S.y, L.node.M.y, L.node.L.y], 'Δ 的兩難：太小在上、折衷在中、太大在下')
    L = await layoutOf(CHART_T18_COUPLING)
    expect(L.node.S1.y, 'T18：G₁ 的加法點在上面').toBeLessThan(L.node.S2.y)
    expectIncreasing([L.node.E1.x, L.node.J11.x, L.node.S1.x, L.node.M1.x, L.node.W1.x], 'T18：ε → ×J → 加法點 → ×μ → 更新（由左到右是一個 block）')
  })

  it('兩框的比較圖：先出現的是基準——Scalar 框在 Full inverse 框之前、「只開一個 loop」在「一起更新」之前', async () => {
    let L = await layoutOf(CHART_MODE_GAIN)
    expect(L.frame.SC.y, 'Scalar 框在上').toBeLessThan(L.frame.FU.y)
    expect(L.node.A1.y, '框內：快模式在上、慢模式在下').toBeLessThan(L.node.A2.y)
    expect(L.node.A3.y).toBeLessThan(L.node.A4.y)
    L = await layoutOf(CHART_T18_MODES)
    expect(L.frame.ONE.y, '「只開一個 loop」框在上').toBeLessThan(L.frame.BOTH.y)
    expect(L.node.B1.y, '框內：共模在上、差模在下').toBeLessThan(L.node.C1.y)
    L = await layoutOf(CHART_PINV_SVD)
    expect(L.frame.PLANT.x, '① 晶片 在 ② 更新矩陣 之前（兩框並排，左邊是 ①）').toBeLessThan(L.frame.UPD.x)
    // 框的標題自己帶 ①／②：就算版面不同，閱讀順序也不會錯
    for (const [chart, first, second] of [
      [CHART_MODE_GAIN, 'SC["① Scalar', 'FU["② Full inverse'],
      [CHART_T18_MODES, 'ONE["① 只開一個 loop', 'BOTH["② 兩個 loop 一起更新'],
      [CHART_PINV_SVD, 'PLANT["① 晶片', 'UPD["② 更新矩陣'],
    ]) {
      expect(chart).toContain(`subgraph ${first}`)
      expect(chart).toContain(`subgraph ${second}`)
    }
  })

  it('由上往下的流程圖：sequential 陷阱、選擇流程、綜合手算（k₉₅ 在左、變異在右）', async () => {
    let L = await layoutOf(CHART_SEQ_TRAP)
    expectIncreasing([L.node.E.y, L.node.P1.y, L.node.R1.y, L.node.P2.y, L.node.R2.y, L.node.OUT.y, L.node.FCW.y], 'sequential 陷阱：由上往下')
    L = await layoutOf(diagram('choose-m').chart)
    expectIncreasing([L.node.Q1.y, L.node.Q2.y, L.node.Q3.y, L.node.N4.y, L.node.N5.y], '選擇流程：三個問題由上往下')
    L = await layoutOf(CHART_HANDCALC_FLOW)
    expectIncreasing([L.node.A.y, L.node.B.y, L.node.C.y, L.node.M.y, L.node.P.y, L.node.Q.y, L.node.V.y], '綜合手算：由上往下')
    expect(L.node.K.x, '綜合手算：左邊一路算 k₉₅，右邊一路算變異').toBeLessThan(L.node.Q.x)
    L = await layoutOf(CHART_ACAL_CHECK)
    expectIncreasing([L.node.JH.y, L.node.BM.y, L.node.AC.y, L.node.EIG.y, L.node.Q.y, L.node.OK.y], '穩定性檢查：由上往下')
    expect(L.node.JT.y).toBeLessThan(L.node.AC.y)
  })

  it('兩張狀態機由上往下排（橫排太寬）：起點 → 各狀態 → 終點', () => {
    for (const chart of [CHART_JACOBIAN_FSM, CHART_SEQ_FSM]) {
      expect(chart).toMatch(/^stateDiagram-v2\n {2}direction TB\n/)
    }
  })
})

describe('Ch10 方塊圖：訊號名稱、正負號、取樣率與數字和正文公式一致', () => {
  // 圖的原始碼是 LaTeX：下面的字串都是原始碼裡的 `$...$`（String.raw，反斜線只寫一次）；數字照舊由 numbers.ts／模型函式算出再比對
  it('δ = a − w 的極性：更新迴路的 w_k 以負號回到誤差的加法點；G_k 經 M 以正號累加（w_(k+1) = w_k + M·G_k）', () => {
    expect(CHART_UPDATE_LOOP).toContain(String.raw`SD -- "$\boldsymbol\delta_k = \mathbf a - \mathbf w_k$" --> KR`)
    expect(CHART_UPDATE_LOOP).toContain(String.raw`A["$\mathbf a$<br/>真實參數"] -- "＋" --> SD`)
    expect(CHART_UPDATE_LOOP).toContain(String.raw`Z -- "$-\mathbf w_k$" --> SD`)
    expect(CHART_UPDATE_LOOP).toContain('M -- "＋" --> SW')
    expect(CHART_UPDATE_LOOP).toContain('Z -- "＋" --> SW')
    expect(CHART_UPDATE_LOOP).toContain(String.raw`SW -- "$\mathbf w_{k+1}$" --> Z`)
    // × K_q·R 就是 −J（J = ∂E[G]/∂w = −K_q R）
    expect(CHART_UPDATE_LOOP).toContain(String.raw`$\times K_q\mathbf R$<br/>comparator 與相關<br/>（$= -\mathbf J$）`)
    // 雜訊在 G 之前加進來（G_k = K_q R δ_k + η_k）
    expect(CHART_UPDATE_LOOP).toMatch(/ETA\(\[.*\\boldsymbol\\eta_k.*\]\) -- "＋" --> SG/)
    expect(CHART_UPDATE_LOOP).toContain(String.raw`SG -- "$\mathbf G_k$" --> M`)
  })

  it('取樣率：e[n]、q[n]、x[n] 在 sample 框內；G 在 block 框內；兩個 GMAC 共用同一個 comparator', () => {
    const [fast, slow] = CHART_SAMPLE_TO_BLOCK.split('subgraph SLOW')
    expect(fast).toContain('subgraph FAST["sample 速率')
    for (const sig of [String.raw`u_1[n]`, String.raw`u_2[n]`, String.raw`v[n]`, String.raw`e[n]`, String.raw`q[n] = \operatorname{sign}(e[n])`, String.raw`x_1[n]`, String.raw`x_2[n]`]) expect(fast, sig).toContain(sig)
    expect(slow).toContain('block 速率')
    expect(slow).toContain(String.raw`累加 $N$ 次再 $\div N$`)
    expect(slow).not.toMatch(/\[n\]/)
    expect((CHART_SAMPLE_TO_BLOCK.match(/CMP -- "\$q\[n\]\$" --> X[12]/g) ?? []).length).toBe(2)
    expect((CHART_SAMPLE_TO_BLOCK.match(/1-bit comparator/g) ?? []).length).toBe(1)
  })

  it('耦合圖的數字 = §10.1 的例子（gmac 線性模型）：G₁ = 0.8·K_q·10 = 0.06383、G₂ = 0.07979；交叉路徑是 R₁₂ = R₂₁ = 0.8', () => {
    expect(NUM.coupling.G1lin).toBeCloseTo(0.8 * NUM.Kq * 10, 12)
    expect(CHART_COUPLING_PATHS).toContain(String.raw`$0.8 \times K_q \times 10 = 0.06383$`)
    expect(CHART_COUPLING_PATHS).toContain(String.raw`$1 \times K_q \times 10 = 0.07979$`)
    expect(CHART_COUPLING_PATHS).toContain(String.raw`$\times R_{12} = 0.8$`)
    expect(CHART_COUPLING_PATHS).toContain(String.raw`$\times R_{21} = 0.8$`)
    expect(CHART_COUPLING_PATHS).toContain(String.raw`$\times R_{11} = 1$`)
    expect(CHART_COUPLING_PATHS).toContain(String.raw`$\times R_{22} = 1$`)
    expect(CHART_COUPLING_PATHS).toContain('class R12,R21 warn')
    // δ₂ 經 R₁₂ 到 GMAC₁、δ₁ 經 R₂₁ 到 GMAC₂
    expect(CHART_COUPLING_PATHS).toContain('D2 --> R12')
    expect(CHART_COUPLING_PATHS).toContain('R12 -- "＋" --> S1')
    expect(CHART_COUPLING_PATHS).toContain('D1 --> R21')
    expect(CHART_COUPLING_PATHS).toContain('R21 -- "＋" --> S2')
  })

  it('T11：模式增益圖與 598 / 5 / 65——loop gain = m·λ = 1 − p；圖上的 0.995 / 0.005 / 50 / 0.2513 / 598 / 5 / 65 都等於 numbers.ts', () => {
    const r = NUM.rho099
    expect(r.blocksScalar).toBe(598)
    expect(r.blocksFull).toBe(5)
    expect(r.blocksReg).toBe(65)
    expect(0.5 * r.eig[1]).toBeCloseTo(1 - r.slow, 12)
    expect(r.eigMn[0] * r.eig[1]).toBeCloseTo(0.5, 9)
    expect(r.eigMn[1] * r.eig[0]).toBeCloseTo(0.5, 9)
    for (const t of [
      String.raw`$\lambda_1 = 1.99$`,
      String.raw`$\lambda_2 = 0.01$`,
      String.raw`loop gain $0.995$<br/>$p_1 = 0.005$`,
      String.raw`loop gain $0.005$<br/>$p_2 = 0.995$`,
      String.raw`$\times m_1 = \gamma / \lambda_1 = 0.2513$`,
      String.raw`$\times m_2 = \gamma / \lambda_2 = 50$`,
      String.raw`loop gain $0.5$<br/>$p_2 = 0.5$`,
      String.raw`$\mathbf M_n = \mu K_q\,\mathbf I$（$\mu K_q = 0.5$）`,
      String.raw`$\mathbf M_n = \gamma\,\mathbf R^{-1}$（$\gamma = 0.5$）`,
    ]) {
      expect(CHART_MODE_GAIN, t).toContain(t)
    }
    for (const t of [
      String.raw`= 1 - 0.5 \times 0.01 = 0.995$`,
      String.raw`\lceil -2.9957 \div -0.0050125 \rceil`,
      String.raw`= \lceil 597.6 \rceil = 598$`,
      String.raw`= \lceil 4.322 \rceil = 5$`,
      String.raw`$k_{95} = \lceil \ln 0.05 \div \ln |p| \rceil$`,
      String.raw`\mathbf R = \begin{bmatrix} 1 & \rho \cr \rho & 1 \end{bmatrix}`,
    ])
      expect(CHART_K95_FLOW, t).toContain(t)
    expect(Math.log(0.05) / Math.log(r.slow)).toBeCloseTo(597.6, 1)
    for (const t of [
      String.raw`$m = \mu K_q = 0.5$`,
      String.raw`$m = \gamma / \lambda_{\min} = 50$`,
      String.raw`$m = \gamma / (\lambda_{\min} + \lambda_{\mathrm{reg}}) = 4.545$`,
      String.raw`$p = 0.995$，$k_{95} = 598$`,
      String.raw`$p = 0.5$，$k_{95} = 5$`,
      String.raw`$p = 0.9545$，$k_{95} = 65$`,
    ]) {
      expect(CHART_REG_COMPARE, t).toContain(t)
    }
    // 每參數 RMS = √(Lyapunov 的每參數變異)，與 §10.4 的表格同一個來源
    const z = NUM.noise
    expect(Math.sqrt(z.scalarPerParam[0])).toBeCloseTo(1.198, 3)
    expect(Math.sqrt(z.perParam[0])).toBeCloseTo(8.015, 3)
    expect(Math.sqrt(z.regPerParam[0])).toBeCloseTo(2.182, 3)
    for (const v of ['1.198', '8.015', '2.182']) expect(CHART_REG_COMPARE, v).toContain(String.raw`$\mathrm{RMS}(\delta_j) = ${v}\ \mathrm{fs}$`)
    expect(CHART_HANDCALC_FLOW).toContain('預設數字：598 / 5 / 65')
    expect(CHART_HANDCALC_FLOW).toContain(String.raw`預設數字：$0.9611$ / $127.8$ / $8.918\ \mathrm{fs}^2$`)
    expect(z.scalarModeVar[1]).toBeCloseTo(0.9611, 4)
    expect(z.modeVar[1]).toBeCloseTo(127.83, 2)
    expect(z.regModeVar[1]).toBeCloseTo(8.918, 3)
  })

  it('雜訊路徑圖 = F-10.6 的推導第 6 步：訊號乘 K_q·λ_i 再乘 γ/(K_q·λ_i)，以負號回到 ξ；雜訊只經過後面那一塊', () => {
    expect(CHART_NOISE_PATH).toContain(String.raw`Z -- "$\xi_i$（第 $k$ 個 block）" --> S["$\times K_q\lambda_i$`)
    expect(CHART_NOISE_PATH).toContain(String.raw`N(["GMAC 雜訊 $\zeta_i$<br/>$\operatorname{Var} = \lambda_i / N$"]) -- "＋" --> SUM`)
    expect(CHART_NOISE_PATH).toContain(String.raw`SUM --> M["$\times \gamma / (K_q\lambda_i)$`)
    expect(CHART_NOISE_PATH).toContain('M -- "−" --> ACC')
    expect(CHART_NOISE_PATH).toContain('Z -- "＋" --> ACC')
    expect(CHART_NOISE_PATH).toContain(String.raw`$\gamma = 0.5$ 時：<br/>慢模式 $50 / K_q$、<br/>快模式 $0.2513 / K_q$`)
    // Lyapunov：X ← A X Aᵀ + M (R_x/N) Mᵀ
    expect(CHART_LYAPUNOV).toContain(String.raw`$\mathbf A\,\mathbf X_k\,\mathbf A^T$`)
    expect(CHART_LYAPUNOV).toContain(String.raw`$\mathbf M\,(\mathbf R_x / N)\,\mathbf M^T$`)
    expect((CHART_LYAPUNOV.match(/-- "＋" --> S\b/g) ?? []).length).toBe(2)
  })

  it('五種更新矩陣圖的公式 = F-10.3 / F-10.4 / F-10.8；Regularized 與 pinv 的分母都加 λ_reg', () => {
    for (const t of [
      String.raw`Scalar：$\mathbf M = \mu\mathbf I$`,
      String.raw`Diagonal：$\mathbf M = \operatorname{diag}(\mu_1, \ldots, \mu_P)$`,
      String.raw`Full inverse：$\mathbf M = \gamma\,(K_q\mathbf R)^{-1}$`,
      String.raw`Regularized：$\mathbf M = \gamma\,\big(K_q(\mathbf R + \lambda_{\mathrm{reg}}\mathbf I)\big)^{-1}$`,
      String.raw`Sequential：$\mathbf M$ 只留一個 $M_{ii}$`,
      String.raw`$p_i = 1 - \mu K_q\lambda_i$`,
      String.raw`$p_i = 1 - \gamma$，每個模式一樣快`,
      String.raw`$p_i = 1 - \gamma\lambda_i / (\lambda_i + \lambda_{\mathrm{reg}})$`,
    ]) {
      expect(CHART_M_VARIANTS, t).toContain(t)
    }
    expect(CHART_M_VARIANTS).toContain('class M2,M3,M4,M5 focus')
    expect(CHART_PINV_SVD).toContain(String.raw`\mathbf M = -\gamma\,(\mathbf J^T\mathbf J + \lambda_{\mathrm{reg}}\mathbf I)^{-1}\mathbf J^T`)
    expect(CHART_PINV_SVD).toContain(String.raw`$\times \sigma_i / (\sigma_i^2 + \lambda_{\mathrm{reg}})$`)
    expect(CHART_PINV_SVD).toContain(String.raw`模式 $i$ 乘上 $1 - \gamma\sigma_i^2 / (\sigma_i^2 + \lambda_{\mathrm{reg}})$`)
    // 訊號順序：① Vᵀ → σ → U → E[G]（晶片）；② G → Uᵀ → 除法 → V → −γ（更新矩陣）；① 的輸出與 ② 的輸入標成同一個顏色
    expectInOrder(CHART_PINV_SVD, ['E["', '--> VT["', '--> SG["', '--> U["', String.raw`--> EG["$E[\mathbf G_k] = \mathbf J\,\boldsymbol\epsilon_k$"]`], '晶片 ①')
    expectInOrder(CHART_PINV_SVD, ['GK["', '--> UT["', '--> INV["', '--> V["', String.raw`--> GM["$\times (-\gamma)$"]`, '--> OUT["'], '更新矩陣 ②')
    expect(CHART_PINV_SVD).toContain('class EG,GK ok')
    expect(CHART_NLMS).toContain(String.raw`$\times \tilde\mu \div (K_q \operatorname{tr}\mathbf R)$`)
    expect(CHART_NLMS).toContain(String.raw`$p_i = 1 - \tilde\mu\lambda_i / \operatorname{tr}\mathbf R$`)
  })

  it('T18：訊號流圖用 J 的四個元素（−1、+2、+2、−1）與 μ = 0.2；模式圖的斜率 +1 / −3 與 pole 0.8 / 1.2 / 0.4 等於 numbers.ts', () => {
    const t = NUM.t18
    expect(t.J).toEqual([
      [-1, 2],
      [2, -1],
    ])
    expect(t.eigJ[0]).toBeCloseTo(1, 12)
    expect(t.eigJ[1]).toBeCloseTo(-3, 12)
    expect(t.poles[0]).toBeCloseTo(1.2, 12)
    expect(t.poles[1]).toBeCloseTo(0.4, 12)
    for (const s of [
      String.raw`$\times J_{11} = -1$`,
      String.raw`$\times J_{12} = +2$`,
      String.raw`$\times J_{21} = +2$`,
      String.raw`$\times J_{22} = -1$`,
      String.raw`$\times \mu = 0.2$`,
      String.raw`$\epsilon_1 = w_1 - w_1^*$`,
      String.raw`$w_1 \leftarrow w_1 + 0.2\,G_1$`,
      String.raw`$w_2 \leftarrow w_2 + 0.2\,G_2$`,
    ])
      expect(CHART_T18_COUPLING, s).toContain(s)
    expect(CHART_T18_COUPLING).toContain(String.raw`S1 -- "$G_1$" --> M1`)
    expect(CHART_T18_COUPLING).toContain(String.raw`S2 -- "$G_2$" --> M2`)
    // ε₂ 經 J₁₂ 進 G₁（第 1 列第 2 行），ε₁ 經 J₂₁ 進 G₂
    expect(CHART_T18_COUPLING).toMatch(/E2\[.*\] --> J12\[/)
    expect(CHART_T18_COUPLING).toContain('J12 -- "＋" --> S1')
    expect(CHART_T18_COUPLING).toMatch(/E1 --> J21\[/)
    expect(CHART_T18_COUPLING).toContain('J21 -- "＋" --> S2')
    expect(CHART_T18_COUPLING).toContain('class J12,J21 warn')
    for (const s of [
      String.raw`$p = 1 + 0.2 \times (-1) = 0.8$`,
      String.raw`斜率 $J_{11} + J_{12} = -1 + 2 = +1$`,
      String.raw`$p = 1 + 0.2 \times (+1) = 1.2$`,
      String.raw`斜率 $J_{11} - J_{12} = -1 - 2 = -3$`,
      String.raw`$p = 1 + 0.2 \times (-3) = 0.4$`,
    ]) {
      expect(CHART_T18_MODES, s).toContain(s)
    }
    expect(CHART_T18_MODES).toContain('class B2 warn')
  })

  it('Jacobian 量測：狀態機依序 FREEZE → PLUS → MINUS → SLOPE，對每個參數重複；Δ 的兩難用表格同一列的數字', () => {
    for (const s of ['[*] --> FREEZE', 'FREEZE --> PLUS', 'PLUS --> MINUS', 'MINUS --> SLOPE', 'SLOPE --> PLUS', 'SLOPE --> BUILD', 'BUILD --> [*]']) expect(CHART_JACOBIAN_FSM, s).toContain(s)
    // 轉移的文字不在雙引號裡：整句寫成單一 `$$\text{…}…$$`（共用的前處理只認得雙引號標籤）
    expect(CHART_JACOBIAN_FSM).toContain(String.raw`FREEZE --> PLUS : $$\text{從 }j = 1\text{ 開始}$$`)
    expect(CHART_JACOBIAN_FSM).toContain(String.raw`SLOPE --> PLUS : $$\text{換下一個參數 }j$$`)
    expect(CHART_JACOBIAN_FSM).toContain(String.raw`SLOPE --> BUILD : $$P\text{ 欄都量完}$$`)
    expect(CHART_JACOBIAN_FSM).toContain(String.raw`$= (G^+ - G^-) \div (2\Delta_j)$`)
    expect(CHART_JACOBIAN_FSM).toContain(String.raw`把 $w_j$ 加上 $\Delta_j$`)
    expect(CHART_JACOBIAN_FSM).toContain(String.raw`把 $w_j$ 減去 $\Delta_j$`)
    const row = (r: number) => NUM.fd.rows.find((x) => x.r === r)!
    expect(row(0.3).pm1).toBeCloseTo(0.9852, 4)
    expect(row(1).pm1).toBeCloseTo(0.8556, 4)
    expect(row(0.3).stdNj4096).toBeCloseTo(0.0462, 4)
    expect(row(0.1).stdNj4096).toBeCloseTo(0.138, 3)
    for (const s of [
      String.raw`截斷係數 $0.9852$（$\pm1$ 碼）`,
      String.raw`截斷係數 $0.8556$（$\pm1$ 碼）`,
      String.raw`\operatorname{std}(\hat{\mathbf J} / K_q) = 0.0462$`,
      String.raw`\operatorname{std}(\hat{\mathbf J} / K_q) = 0.138$`,
    ])
      expect(CHART_FD_TRADEOFF, s).toContain(s)
    // E24：M 用 Ĵ 建構、迴路乘真正的 J
    expect(CHART_ACAL_CHECK).toContain(String.raw`$\mathbf A_{\mathrm{cal}} = \mathbf I + \mathbf M(\hat{\mathbf J})\,\mathbf J$`)
    expect(CHART_ACAL_CHECK).toMatch(/JH\[.*\] --> BM\[/)
    expect(CHART_ACAL_CHECK).toMatch(/JT\[.*\] --> AC\[/)
    expect(CHART_ACAL_CHECK).toContain('BM --> AC')
  })

  it('Sequential：狀態機與 mSequential 一致（一次只開一個 loop、輪數用完全部凍結）；陷阱圖的 4 / 0 / (−1, +1) 來自 a = (3, 1)', () => {
    for (const s of ['[*] --> CAL1', 'CAL1 --> CAL2', 'CAL2 --> CAL1', 'CAL2 --> DONE', 'DONE --> [*]', String.raw`只更新 $w_1$，$w_2$ 凍結`, String.raw`只更新 $w_2$，$w_1$ 凍結`, String.raw`全部凍結：$\mathbf M = \mathbf 0$`]) expect(CHART_SEQ_FSM, s).toContain(s)
    expect(NUM.seq.a).toEqual([3, 1])
    const last = NUM.seq.rows[NUM.seq.rows.length - 1]
    expect(last.w1).toBeCloseTo(4, 9)
    expect(last.w2).toBeCloseTo(0, 9)
    expect(last.sum).toBeCloseTo(0, 9)
    for (const s of [
      String.raw`$e[n] = u[n]\,(\delta_1 + \delta_2) + v[n]$`,
      String.raw`$w_1 = a_1 + a_2 = 4$`,
      String.raw`正確值是 $a_1 = 3$`,
      String.raw`$w_2 = 0$`,
      String.raw`正確值是 $a_2 = 1$`,
      String.raw`\boldsymbol\delta = (-1, +1)`,
    ])
      expect(CHART_SEQ_TRAP, s).toContain(s)
    expect(CHART_CODE_FLOW).toContain(String.raw`\boldsymbol\delta_{k+1} = \boldsymbol\delta_k - (\mathbf M_n / K_q)\,\mathbf G_k`)
    expect(CHART_CODE_FLOW).toContain(String.raw`\mathbf G_k = K_q\mathbf C\boldsymbol\delta_k + \boldsymbol\eta_k`)
    expect(CHART_CODE_FLOW).toContain(String.raw`RULE -- "$\mathbf M_n = K_q\mathbf M$（無因次）" --> BU`)
    expect(CHART_CODE_FLOW).toContain(String.raw`GM -- "$\mathbf G_k$" --> BU`)
  })
})

describe('Ch10 方塊圖：新增的三張圖（comparator 增益、GMAC 雜訊、Gauss–Seidel）與公式逐項核對', () => {
  it('comparator 增益圖 = F-10.1 推導第 5–7 步：s + v → sign → 對雜訊取平均是 erf(s/(√2σ_v)) → 小訊號時是 K_q·s；例子的數字由測試內的泰勒級數重算', () => {
    const sig = 10
    const sigma = 100
    expect(NUM.sigmaV).toBe(sigma)
    expect(NUM.coupling.delta).toEqual([0, sig])
    // erf(x) = (2/√π)(x − x³/3 + x⁵/10 − x⁷/42 + …)：x = 0.0707 時前四項已經準到 1e-12
    const x = sig / (Math.SQRT2 * sigma)
    const erfSeries = (2 / Math.sqrt(Math.PI)) * (x - x ** 3 / 3 + x ** 5 / 10 - x ** 7 / 42)
    expect(NUM.coupling.erfOne).toBeCloseTo(erfSeries, 7)
    expect(erfSeries).toBeCloseTo(0.0796557, 6)
    const Kq = Math.sqrt(2 / Math.PI) / sigma
    expect(NUM.Kq).toBeCloseTo(Kq, 15)
    expect(NUM.coupling.G2lin).toBeCloseTo(Kq * sig, 15)
    expect(Kq * sig).toBeCloseTo(0.0797885, 6)
    // 線性近似比 erf 大 x²/3 ≈ 0.17%（正文的「只比 erf 的值大 0.17%」）
    expect((Kq * sig) / erfSeries - 1).toBeCloseTo(x ** 2 / 3, 5)
    expect(100 * ((Kq * sig) / erfSeries - 1)).toBeCloseTo(0.17, 2)
    // 訊號流：s 與 v 以正號相加成 e，comparator 取 sign，平均後分成「線性」與「飽和」兩條路
    expect(CHART_COMPARATOR_GAIN).toContain(String.raw`$s = u_1\,\delta_1 + u_2\,\delta_2$<br/>例：$\delta_1 = 0$、$\delta_2 = 10\ \mathrm{fs}$、$u_2 = +1$，$s = 10\ \mathrm{fs}$"] -- "＋" --> ADD(("＋"))`)
    expect(CHART_COMPARATOR_GAIN).toContain(String.raw`V(["雜訊 $v$<br/>Gaussian，RMS $\sigma_v = 100\ \mathrm{fs}$"]) -- "＋" --> ADD`)
    expect(CHART_COMPARATOR_GAIN).toContain(String.raw`ADD -- "$e = s + v$" --> CMP["1-bit comparator<br/>$q = \operatorname{sign}(e)$，只有 $\pm1$"]`)
    expect(CHART_COMPARATOR_GAIN).toContain(String.raw`CMP -- "$q$" --> AVG[`)
    expect(CHART_COMPARATOR_GAIN).toContain(String.raw`$E[q \mid u] = \operatorname{erf}\big(s \div (\sqrt2\,\sigma_v)\big)$<br/>例：$0.07966$"]`)
    expect(CHART_COMPARATOR_GAIN).toContain(String.raw`AVG -- "$|s|$ 遠小於 $\sigma_v$" --> LIN["$\approx K_q \times s$<br/>$K_q = \sqrt{2/\pi} \div \sigma_v = 0.007979\ \mathrm{fs}^{-1}$<br/>例：$0.07979$"]`)
    expect(CHART_COMPARATOR_GAIN).toContain(String.raw`AVG -- "$|s|$ 遠大於 $\sigma_v$" --> SAT["飽和在 $\pm1$<br/>等效增益比 $K_q$ 小"]`)
    expect(CHART_COMPARATOR_GAIN).toContain('class LIN focus')
    expect(CHART_COMPARATOR_GAIN).toContain('class SAT warn')
    // 「飽和時等效增益比 K_q 小」：erf(s/(√2σ))/s 隨 |s| 遞減（F-10.14 的 ±1 碼截斷係數就是這個比值除以 K_q）
    const row = (r: number) => NUM.fd.rows.find((q) => q.r === r)!
    expect(row(1).pm1).toBeLessThan(row(0.3).pm1)
    expect(row(0.3).pm1).toBeLessThan(1)
  })

  it('GMAC 雜訊圖 = §10.2 的 Cov(η) ≈ R / N：乘積 q·x 在 sample 框（共變異 ≈ R），G_k 與 η_k 在 block 框（÷ N）；1/64 與 4.1 倍等於 numbers.ts', () => {
    expect(NUM.noise.N).toBe(4096)
    const rms = Math.sqrt(1 / NUM.noise.N)
    expect(rms).toBe(1 / 64)
    expect(NUM.coupling.G1lin / rms).toBeCloseTo(4.0852, 3)
    const [fast, slow] = CHART_GMAC_NOISE.split('subgraph SLOW')
    expect(fast).toContain('subgraph FAST["sample 速率')
    for (const sig of [
      String.raw`$q[n] = \pm1$`,
      String.raw`$v[n]$`,
      String.raw`乘積 $q[n]\,\mathbf x[n]$`,
      String.raw`code $\mathbf x[n]$`,
      String.raw`$E[\mathbf x\mathbf x^T] = \mathbf R$`,
      String.raw`共變異 $\approx \mathbf R$（因為 $q^2 = 1$）`,
      String.raw`平均 $\approx K_q\mathbf R\boldsymbol\delta_k$`,
    ])
      expect(fast, sig).toContain(sig)
    expect(slow).toContain(String.raw`block 速率：每 $N$ 個 sample 一個 $\mathbf G_k$`)
    expect(slow).toContain(String.raw`平均 $N$ 個獨立的乘積<br/>平均不變，共變異 $\div N$`)
    expect(slow).toContain(String.raw`$\mathbf G_k = K_q\mathbf R\boldsymbol\delta_k + \boldsymbol\eta_k$<br/>$\boldsymbol\eta_k$ 的平均是 $0$，$\operatorname{Cov}(\boldsymbol\eta_k) \approx \mathbf R / N$`)
    expect(slow).toContain(String.raw`例：$N = 4096$、$R_{ii} = 1$<br/>每個 GMAC 的雜訊 RMS $= 1 \div 64 = 0.0156$<br/>§10.1 的訊號 $G_1 = 0.0638$，只有它的 $4.1$ 倍`)
    expect(slow, 'block 框裡沒有 sample 速率的訊號').not.toMatch(/\[n\]/)
    // 兩個輸入（q 與 code）都進乘積，乘積才進平均
    expect(CHART_GMAC_NOISE).toMatch(/Q\[.*\] --> P\[/)
    expect(CHART_GMAC_NOISE).toMatch(/X\[.*\] --> P\n/)
    // 乘積 P（sample 框）進平均 AVG（block 框）：兩個框各只有一個出口／入口，所以用框對框的一條連線
    expect(CHART_GMAC_NOISE).toContain('FAST --> SLOW')
    // 與更新迴路圖、Lyapunov 圖用的是同一個雜訊模型
    expect(CHART_UPDATE_LOOP).toContain(String.raw`GMAC 雜訊 $\boldsymbol\eta_k$<br/>$\operatorname{Cov} \approx \mathbf R / N$`)
    expect(CHART_LYAPUNOV).toContain(String.raw`\operatorname{Cov}(\boldsymbol\eta_k) \approx \mathbf R_x / N`)
  })

  it('Gauss–Seidel 圖 = §10.6 的推導：δ₁′ = −ρ·δ₂、δ₂′ = ρ²·δ₂；用模型的 propagateLinearMoments（sequential、γ = 1、每階段 1 block）走兩個 block 核對', () => {
    const rho = 0.99
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, rho), sigmaV: SIGMA_KQ1, N: 4096 })
    const cfg = { ...DEFAULT_RULE, rule: 'sequential' as const, gamma: 1, seqBlocksPerPhase: 1, seqSweeps: 5 }
    const d0 = [0.3, 1]
    const run = propagateLinearMoments(plant, cfg, plant.Jn, d0, 4)!
    // 階段 1 之後：δ₁′ = −ρ·δ₂（與原來的 δ₁ 無關），δ₂ 不動
    expect(run.mean[0][1]).toBeCloseTo(-rho * d0[1], 12)
    expect(run.mean[1][1]).toBeCloseTo(d0[1], 12)
    // 階段 2 之後：δ₂′ = −ρ·δ₁′ = ρ²·δ₂
    expect(run.mean[1][2]).toBeCloseTo(rho * rho * d0[1], 12)
    expect(run.mean[0][2]).toBeCloseTo(-rho * d0[1], 12)
    // 第二輪再乘一次 ρ²
    expect(run.mean[1][4]).toBeCloseTo(rho ** 4 * d0[1], 12)
    expect(NUM.seq.gsSweep).toBeCloseTo(rho * rho, 9)
    expect(NUM.seq.gsPerBlock).toBeCloseTo(rho, 9)
    for (const t of [
      String.raw`階段 1：只動 $w_1$（$\gamma = 1$）<br/>一步把 $G_1 \propto \delta_1 + \rho\,\delta_2$ 推到 $0$`,
      String.raw`P1 -- "$\delta_1' = -\rho\,\delta_2$" --> P2`,
      String.raw`階段 2：只動 $w_2$（$\gamma = 1$）<br/>一步把 $G_2 \propto \rho\,\delta_1' + \delta_2$ 推到 $0$`,
      String.raw`P2 -- "$\delta_2' = -\rho\,\delta_1' = \rho^2\delta_2$" --> E`,
      String.raw`$\rho = 0.99$：$\rho^2 = 0.9801$`,
      String.raw`E -. "下一輪：再乘一次 $\rho^2$" .-> P1`,
      'class E warn',
    ]) {
      expect(CHART_GS_SWEEP, t).toContain(t)
    }
  })
})

describe('Ch10 方塊圖：全站架構約定（docs/assumptions.md §2a）——DTC 在 reference 輸入端、LMS 的輸入是 PD 的輸出', () => {
  /** parser 資料庫裡的連線，寫成 `起點->終點` */
  async function edgesOf(chart: string): Promise<string[]> {
    const dg = await mermaid.mermaidAPI.getDiagramFromText(chart)
    const db = dg.db as { getEdges: () => { start: string; end: string }[] }
    return db.getEdges().map((e) => `${e.start}->${e.end}`)
  }

  it('圖 10-1（系統圖）：comparator 的輸入取自 PD 的輸出 e[n]（同一個 e[n] 也進 loop filter）；補償經 DTC 回到 PD，不是回到 comparator', async () => {
    const edges = await edgesOf(CHART_MIMO_SYSTEM)
    expect(edges).toEqual(expect.arrayContaining(['E->Q', 'E->LF', 'W->E']))
    // e[n] 的節點就是 Phase detector 的輸出；loop filter 與 comparator 吃的是同一個節點（兩條線都從 E 出發）
    expect(CHART_MIMO_SYSTEM).toContain('subgraph PLL["PLL 主迴路：Phase detector 的輸出端（每個 sample $n$）"]')
    expect(CHART_MIMO_SYSTEM).toMatch(/E\["Phase detector 的輸出<br\/>\$e\[n\] = u_1\[n\]/)
    expect(CHART_MIMO_SYSTEM).toContain('LF["Loop filter → VCO / DCO')
    // comparator 的上游只有 E（沒有從 DTC、divider 或別的地方拉進來）；系統圖也沒有 divider → DTC 這種接法
    expect(edges.filter((e) => e.endsWith('->Q'))).toEqual(['E->Q'])
    expect(edges.filter((e) => /DIV|DTC/.test(e))).toEqual([])
    // 回到 PD 的那條線說清楚是「reference 端」DTC 的補償；圖上沒有任何「DTC 在回授／feedback 路徑」的字眼，也不說 DTC「插入延遲」
    expect(CHART_MIMO_SYSTEM).toContain('（經 reference 端的 DTC<br/>補償，回到 PD）')
    expect(CHART_MIMO_SYSTEM).not.toMatch(/PLL \+ DTC|回授|feedback|插入|推回/)
    // e[n] 的式子與極性不變：δ = a − w，e[n] = Σ u_i δ_i + v[n]
    expect(CHART_MIMO_SYSTEM).toContain(String.raw`$e[n] = u_1[n]\,\delta_1 + u_2[n]\,\delta_2 + u_3[n]\,\delta_3 + v[n]$`)
    expect(CHART_MIMO_SYSTEM).toContain(String.raw`$\boldsymbol\delta = \mathbf a - \mathbf w$`)
    // 版面：同一個 e[n] 的兩個去處（loop filter、comparator）在 e[n] 的下面，comparator 在 loop filter 的右邊
    const L = await layoutOf(CHART_MIMO_SYSTEM)
    expect(L.node.LF.y).toBeGreaterThan(L.node.E.y)
    expect(L.node.Q.y).toBeGreaterThan(L.node.E.y)
    expect(L.node.LF.x, 'loop filter 在 comparator 的左邊').toBeLessThan(L.node.Q.x)
    expect(CH10_DIAGRAMS[0].caption).toMatch(/PD 的輸出 \$e\[n\]\$/)
    expect(CH10_DIAGRAMS[0].alt).toMatch(/PD 的輸出 e\[n\].*loop filter.*comparator.*reference 端 DTC 的補償.*δ = a − w 回到 PD/)
  })

  it('圖 10-27（硬體對應）：Reference clock → DTC → PD；主迴路（loop filter → VCO → divider／PMUX）的 feedback edge 直接回到 PD；comparator 取 PD 的輸出；係數 → gain correction → reference 端的 DTC', async () => {
    const edges = await edgesOf(CHART_HW_MAP)
    expect(edges).toEqual(expect.arrayContaining(['REF->DTC', 'DTC->PD', 'PD->LF', 'LF->PD', 'PD->CMP', 'CMP->G1', 'CMP->G2', 'CMP->G3', 'MIX->ACC', 'ACC->DTC']))
    // PD 只有兩個輸入：延遲後的 reference edge（來自 DTC）與 feedback edge（來自主迴路那一格，裡面是 loop filter → VCO → divider／PMUX）
    expect(edges.filter((e) => e.endsWith('->PD')).sort()).toEqual(['DTC->PD', 'LF->PD'])
    // comparator 的上游只有 PD 的輸出；loop filter 吃的是同一個 e[n]
    expect(edges.filter((e) => e.endsWith('->CMP'))).toEqual(['PD->CMP'])
    expect(edges.filter((e) => e.startsWith('PD->')).sort()).toEqual(['PD->CMP', 'PD->LF'])
    // DTC 在 reference 路徑上：上游只有 reference clock 與係數（gain correction），下游只有 PD；回授那一格不經過 DTC
    expect(edges.filter((e) => e.endsWith('->DTC')).sort()).toEqual(['ACC->DTC', 'REF->DTC'])
    expect(edges.filter((e) => e.startsWith('DTC->'))).toEqual(['DTC->PD'])
    expect(edges.filter((e) => e.startsWith('LF->'))).toEqual(['LF->PD'])
    expect(edges.filter((e) => e.startsWith('REF->'))).toEqual(['REF->DTC'])
    expect(CHART_HW_MAP).toContain('REF["Reference clock"] --> DTC')
    expect(CHART_HW_MAP).toContain('DTC -- "延遲後的 reference edge" --> PD')
    expect(CHART_HW_MAP).toContain('LF -- "feedback edge" --> PD')
    expect(CHART_HW_MAP).toContain('LF["Loop filter → VCO / DCO<br/>→ Divider / PMUX（回授）"]')
    expect(CHART_HW_MAP).toContain('PD["Phase detector<br/>輸出 $e[n]$（reference edge 減 feedback edge）"]')
    expect(CHART_HW_MAP).toContain(String.raw`PD -- "$e[n]$" --> CMP`)
    expect(CHART_HW_MAP).toContain(String.raw`PD -- "$e[n]$" --> LF`)
    // DTC 只能延遲：方塊上寫的是它的延遲 T_0 − Σ w_i x_i[n]（從基準延遲往回扣補償量），不是「提前」，也不是「插入的延遲 = w·x」
    expect(CHART_HW_MAP).toContain(String.raw`DTC["Gain correction → DTC（reference 端）<br/>延遲 $= T_0 - \sum_i w_i\,x_i[n]$"]`)
    expect(CHART_HW_MAP).not.toMatch(/提前|插入|推回|PLL error path|DTC \/ PMUX 補償|DTC -\. |進 PD 的 reference 輸入/)
    // 實線 = 每個 sample／block 都在跑的資料路徑：DTC → PD、feedback edge 都是實線（虛線只留給韌體的慢速路徑）
    expect((CHART_HW_MAP.match(/-\.[^\n]*\.->/g) ?? []).length).toBe(2)
    expect((CHART_HW_MAP.match(/^ {2}FW\b.*-\./gm) ?? []).length).toBe(2)
    const L = await layoutOf(CHART_HW_MAP)
    expect(L.node.PD.y, 'PD 在最上面').toBeLessThan(L.node.CMP.y)
    expect(L.node.PD.y).toBeLessThan(L.node.LF.y)
    expect(L.node.LF.y, '主迴路那一格與 comparator 同一層（同一個 e[n] 的兩個去處）').toBe(L.node.CMP.y)
    expect(L.node.CMP.x, 'comparator 在左、主迴路在右（導讀照這個方向說）').toBeLessThan(L.node.LF.x)
    expect(L.node.DTC.y, 'DTC 在最下面（延遲後的 reference edge 沿右邊回到 PD）').toBeGreaterThan(L.node.ACC.y)
    expect(L.node.REF.y, 'reference clock 在 DTC 的上一層，往下進 DTC').toBeLessThan(L.node.DTC.y)
    expect(L.node.DTC.x, 'DTC 在右下角').toBeGreaterThan(L.node.ACC.x)
    const cap = diagram('hw-map')
    expect(cap.caption).toMatch(/comparator 取的是 PD 的輸出 \$e\[n\]\$，DTC 在 reference 輸入端（回授路徑上只有 divider／PMUX）/)
    expect(cap.alt).toMatch(/PD 的輸出 e\[n\].*loop filter.*comparator.*reference 端的 DTC.*reference clock 經 DTC 延遲後進 PD.*divider／PMUX 的 feedback edge 直接回到 PD/)
  })

  it('純數學的圖（e → sign → 相加、comparator 增益、GMAC 雜訊）不畫 PLL，沒有 DTC、divider 或 PD', () => {
    for (const chart of [CHART_SAMPLE_TO_BLOCK, CHART_COMPARATOR_GAIN, CHART_GMAC_NOISE]) expect(chart).not.toMatch(/DTC|divider|Divider|PMUX|Phase detector|Loop filter/)
  })
})

describe('Ch10 方塊圖：頁面', () => {
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    cleanup()
    seen.stub = false
    localStorage.clear()
  })

  it('整章渲染 <SystemMap>（緊接在開場問題之後）與 27 張圖：順序、所在段落、圖說、導讀、「先看圖再看公式」，27 張圖的原始碼都送進 mermaid.render（系統地圖是手排的 SVG，不經過 mermaid）', async () => {
    seen.rendered.length = 0
    seen.stub = true
    localStorage.setItem('lmspll.mode', 'engineer')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <Chapter10 />
        </MemoryRouter>
      </SettingsProvider>,
    )
    // 頁面上的 figure.c-mermaid：27 張 Mermaid 圖 + 章首那張手排的系統地圖
    const total = CH10_DIAGRAMS.length + 1
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(total)

    // ── 章首的 SystemMap：開場問題之後、第一張章內圖之前，標出本章的三個方塊，後面跟著一句說明 ──
    const maps = Array.from(container.querySelectorAll('figure.c-mermaid')).filter((f) => /系統方塊圖/.test(f.getAttribute('aria-label') ?? ''))
    expect(maps.length).toBe(1)
    const map = maps[0]
    // aria-label 是純文字：方塊名稱裡的 `$...$` 只拿掉分隔符號
    for (const b of SYSTEM_MAP_FOCUS) expect(map.getAttribute('aria-label')).toContain(accessibleText(SYSTEM_BLOCK_LABEL[b]))
    // 系統地圖是手排的 SVG（figure.c-sysmap）：藍色的方塊 = g.c-sysmap-block.is-focus，恰好是本章的三個方塊（GMAC、÷N×μ、gain accumulator），其他方塊都不是主角
    expect(map.classList.contains('c-sysmap')).toBe(true)
    expect(map.querySelector('svg.c-sysmap-svg')).toBeTruthy()
    const focusedBlocks = (root: Element) => Array.from(root.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
    expect(focusedBlocks(map).sort()).toEqual(FOCUSED_BLOCKS)
    expect(Array.from(map.querySelectorAll('g.c-sysmap-block[data-focus="true"]')).length).toBe(FOCUSED_BLOCKS.length)
    expect(map.querySelectorAll('g.c-sysmap-block').length).toBeGreaterThan(FOCUSED_BLOCKS.length)
    const question = container.querySelector('#ch10-question') as HTMLElement
    const figs = Array.from(container.querySelectorAll<HTMLElement>('.ch10-fig'))
    expect(question.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(map.compareDocumentPosition(figs[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(question.nextElementSibling).toBe(map)
    const note = map.nextElementSibling as HTMLElement
    expect(note.className).toContain('ch10-map-note')
    expect(note.textContent).toMatch(/藍色的三塊.*本章的主角.*這一章把 GMAC 變成/)

    // ── 27 張圖：依登錄表的順序出現在各自的段落裡 ──
    expect(figs.map((f) => f.dataset.diagram)).toEqual(CH10_DIAGRAMS.map((d) => d.id))
    figs.forEach((f, i) => {
      const d = CH10_DIAGRAMS[i]
      expect(f.closest('section.c-section')?.id, d.id).toBe(d.section)
      expect(f.querySelectorAll('figure.c-mermaid').length, d.id).toBe(1)
      expect(f.querySelector('figure.c-mermaid')?.getAttribute('aria-label'), d.id).toBe(`圖 10-${i + 1}：${d.alt}`)
      // 圖說：圖號 + 種類 + 一句話；圖說裡的 $...$ 已渲染成 KaTeX，沒有落單的 $
      const cap = f.querySelector('.ch10-fig-caption') as HTMLElement
      expect(cap.textContent, d.id).toMatch(new RegExp(`^圖 10-${i + 1}（${d.kind}）`))
      expect(cap.textContent, d.id).not.toContain('$')
      if (d.caption.includes('$')) expect(cap.querySelector('.katex'), d.id).toBeTruthy()
      // 導讀：先看哪裡、再看哪裡，以及「圖上的 X 就是公式裡的 x」
      const walk = f.querySelector('.ch10-fig-walk') as HTMLElement
      expect(walk.textContent, d.id).toMatch(/^怎麼看這張圖/)
      expect((walk.textContent ?? '').length, d.id).toBeGreaterThan(120)
      expect(walk.textContent, d.id).toMatch(/先[\s\S]*再|由上往下/)
      expect(walk.textContent, d.id).toMatch(/圖上/)
      expect(walk.querySelectorAll('.katex').length, d.id).toBeGreaterThanOrEqual(2)
      // 先看圖、再看推導與 boxed 結果
      if (d.before) {
        const target = document.getElementById(d.before)
        expect(target, `${d.id} → #${d.before}`).toBeTruthy()
        expect(f.compareDocumentPosition(target!) & Node.DOCUMENT_POSITION_FOLLOWING, `${d.id} 應該在 #${d.before} 之前`).toBeTruthy()
      }
    })
    // 每個 boxed 公式之前至少有一張圖（F-10.13 是 Research 的精確式，沿用 coupling／sample-to-block／comparator-gain 三張圖的訊號流）
    for (const id of ['F-10.1', 'F-10.2', 'F-10.3', 'F-10.4', 'F-10.5', 'F-10.6', 'F-10.8', 'F-10.9', 'F-10.10', 'F-10.11', 'F-10.12', 'F-10.14', 'F-10.15']) {
      expect(CH10_DIAGRAMS.some((d) => d.before === `formula-${id}`), id).toBe(true)
    }
    // F-10.7（一般的模式變異公式）用的是 noise-path 那張圖的同一條迴路：圖在它前面
    const f107 = document.getElementById('formula-F-10.7') as HTMLElement
    const fig = (id: string) => figs[CH10_DIAGRAMS.findIndex((d) => d.id === id)]
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(fig('noise-path'), f107)).toBe(true)
    // 沒有登錄公式編號的兩張新圖：GMAC 雜訊圖在 F-10.1 之後（它講的是平均以外的抖動）、Cov(η) ≈ R/N 的式子之前；
    // Gauss–Seidel 圖在 sequential 陷阱之後、選擇流程（下一節）之前
    expect(follows(document.getElementById('formula-F-10.1') as HTMLElement, fig('gmac-noise'))).toBe(true)
    const covEta = Array.from(container.querySelectorAll('#ch10-derive-G annotation')).find((a) => /^\\operatorname\{Cov\}\(\\boldsymbol\\eta_k\)\\approx\\frac\{\\mathbf R\}\{N\}/.test(a.textContent ?? ''))
    expect(covEta).toBeTruthy()
    expect(follows(fig('gmac-noise'), covEta as Element)).toBe(true)
    expect(follows(fig('seq-trap'), fig('gs-sweep'))).toBe(true)
    expect(follows(fig('gs-sweep'), fig('choose-m'))).toBe(true)

    // ── 全站架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端、LMS 的輸入是 PD 的輸出；導讀照這個說 ──
    const walkOf = (id: string) => (fig(id).querySelector('.ch10-fig-walk') as HTMLElement).textContent ?? ''
    expect(walkOf('system')).toMatch(/e\[n\] 是 PD 的輸出.*loop filter.*comparator/)
    expect(walkOf('system')).toMatch(/經 reference 端 DTC 的補償.*回到最上面 PD 的輸出/)
    expect(walkOf('system')).toMatch(/comparator 前（也就是 PD 輸出端）的雜訊/)
    expect(walkOf('hw-map')).toMatch(/最上面是 phase detector，PD 的輸出 e\[n\].*分成兩路——往右進主迴路（loop filter → VCO／DCO → divider／PMUX，feedback edge 從那一格直接回到 PD），往左進 comparator。comparator 取它的正負號/)
    expect(walkOf('hw-map')).toMatch(/reference 端的 DTC（reference clock 先經過它才進 PD）。DTC 只能延遲、不能提前.*固定的基準延遲.*往回扣補償量.*越大，reference edge 越早/)
    expect(walkOf('hw-map')).toMatch(/延遲後的 reference edge 沿右邊那條線回到 PD，與 feedback（divider／PMUX）edge 比較（PD 量的是前者減後者），補償得不夠的部分又出現在 PD 的輸出/)
    expect(walkOf('hw-map')).toMatch(/DTC 只在 reference 輸入端，不在回授路徑上/)
    // 導讀裡 DTC 的延遲是 T_0 − Σ w_i x_i[n]（LaTeX），補償量是 Σ w_i x_i[n]；不再說「DTC 把 reference edge 提前」而不交代基準延遲
    const hwTex = Array.from(fig('hw-map').querySelectorAll('.ch10-fig-walk annotation')).map((a) => a.textContent ?? '')
    expect(hwTex).toEqual(expect.arrayContaining(['T_0', String.raw`T_0-\sum_iw_ix_i[n]`, String.raw`\sum_iw_ix_i[n]`]))
    expect(walkOf('hw-map')).not.toMatch(/reference edge 提前補償量/)
    // 物理圖像在第一次給出的地方說清楚：PD 量 reference edge 減 feedback edge；DTC 只能延遲，從基準延遲 T₀ 往回扣；用「補償量」
    const sys = container.querySelector('#ch10-system') as HTMLElement
    expect(sys.textContent).toMatch(/校正迴路的輸入是 PD 的輸出 e\[n\].*送進 loop filter 的同一個訊號.*只取它的正負號/)
    expect(sys.textContent).toMatch(/reference edge 減 feedback edge.*feedback（divider／PMUX）edge 比理想時刻早到.*只能延遲、不能提前.*基準延遲.*往回扣.*補償量/)
    // 極性：w_i 太小（δ_i > 0）⇒ reference edge 還是太晚 ⇒ 誤差為正；單一 DTC gain 時就是 e[n] = (a − w)·x[n] + v[n]
    expect(sys.textContent).toMatch(/太小（.*）時 reference edge 還是太晚.*補償不足時誤差為正.*DTC 不在回授路徑上，回授路徑上只有 divider／PMUX/)
    const sysTex = Array.from(sys.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    expect(sysTex).toEqual(expect.arrayContaining([String.raw`e[n]=(a-w)\,x[n]+v[n]`, String.raw`x[n]\ge0`, String.raw`\delta_i>0`, 'T_0']))
    // 符號表：e[n] 是 PD 的輸出（comparator 的輸入），u_i 是到 PD 輸出的權重
    const symText = (container.querySelector('#symbols') as HTMLElement).textContent ?? ''
    expect(symText).toMatch(/PD 的輸出（comparator 的輸入）/)
    expect(symText).toMatch(/PLL 路徑到 PD 輸出/)
    expect(symText).toMatch(/reference 端 DTC 的固定基準延遲.*往回扣/)
    const symTex = Array.from((container.querySelector('#symbols') as HTMLElement).querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    expect(symTex).toEqual(expect.arrayContaining(['T_0', String.raw`=T_0-\sum_i w_i\,x_i[n]`]))
    // 舊接法的說法不可以再出現（DTC 在回授路徑／插入延遲／推回理想時刻／經 PLL 的 error path 回到 comparator）
    expect(container.textContent).not.toMatch(/DTC 在回授|DTC 插入|插入延遲|推回|回授側|feedback 側|經 PLL 的 error path 回到 comparator|PLL \+ DTC/)

    // ── 正文提到別張圖時一律用 <FigRef>：圖號等於登錄表的順序，頁面上沒有手寫的「圖 10-N」 ──
    const refs = Array.from(container.querySelectorAll<HTMLElement>('.ch10-figref'))
    expect(refs.length).toBeGreaterThanOrEqual(3)
    for (const r of refs) expect(r.textContent, r.dataset.figref).toBe(`圖 ${diagram(r.dataset.figref ?? '').no}`)
    expect(refs.map((r) => r.dataset.figref)).toEqual(expect.arrayContaining(['coupling', 'eigen-modes', 'nlms']))
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll('.ch10-fig-caption, .ch10-figref').forEach((el) => el.remove())
    expect(prose.textContent).not.toMatch(/圖\s*10-\d/)
    // sample／block 兩個框改成上下堆疊之後，正文與導讀不能再說「左框／右框」；唯一並排的兩框（SVD）寫成「左邊的框 ①／右邊的框 ②」
    expect(container.textContent).not.toMatch(/[左右]框/)

    // ── 每張圖的原始碼都送進了 mermaid.render，而且每個 <Mermaid> 都離開「載入中」（沒有解析失敗的提示） ──
    await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg svg').length).toBe(total), { timeout: 60_000 })
    expect(container.textContent).not.toMatch(/Mermaid 圖解析失敗/)
    expect(container.querySelectorAll('.c-mermaid-error').length).toBe(0)
    // 送進 mermaid.render 的恰好是 27 張章內圖（系統地圖不經過 mermaid），而且是前處理（sanitizeMermaidSource：每個含 `$...$` 的標籤合併成單一 `$$...$$`）之後的原始碼
    const charts = seen.rendered.map((r) => r.chart)
    expect(charts.length).toBe(CH10_DIAGRAMS.length)
    for (const d of CH10_DIAGRAMS) expect(charts, d.name).toContain(sanitizeMermaidSource(d.chart))

    // 圖與導讀沒有引入 KaTeX 錯誤或 React 警告
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    const warnings = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => /Warning|Each child|unique "key"/.test(s))
    expect(warnings).toEqual([])
    errorSpy.mockRestore()
  })

  it('章首（S0Intro）：手排的 SystemMap（藍色方塊是 gmac / scale / acc）與用真正的 mermaid 畫出的圖 10-1：<Mermaid> 元件拿到的是可以顯示的 SVG', async () => {
    seen.rendered.length = 0
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/10']}>
          <S0Intro />
        </MemoryRouter>
      </SettingsProvider>,
    )
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(2)
    await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg svg').length).toBe(2), { timeout: 60_000 })
    expect(container.textContent).not.toMatch(/Mermaid 圖解析失敗|Unsupported markdown/)
    // 只有圖 10-1 送進 mermaid.render；系統地圖是手排的 SVG
    expect(seen.rendered.map((r) => r.chart)).toEqual([sanitizeMermaidSource(CH10_DIAGRAMS[0].chart)])
    const [mapHost, chartHost] = Array.from(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg'))
    expect(mapHost.closest('figure')?.classList.contains('c-sysmap')).toBe(true)
    expect(chartHost.closest('figure')?.classList.contains('c-sysmap')).toBe(false)
    // 兩張圖的公式都由 KaTeX 排版（圖 10-1 有 $e[n]$、$q[n]$、$\mathbf M$…；系統地圖的方塊也有 $x[n]$、$w_k$…），畫面上沒有殘留的 `$`
    expect(chartHost.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(8)
    expect(mapHost.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1)
    for (const svgHost of [mapHost, chartHost]) expect(svgHost.textContent).not.toContain('$')
    // 藍色方塊是 gmac / scale / acc
    const focused = Array.from(mapHost.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
    expect(focused.sort()).toEqual(['acc', 'gmac', 'scale'])
    expect(focused.sort()).toEqual(FOCUSED_BLOCKS)
    // 章首沒有符號表本身，也沒有「本章符號表在最後」那一行（連結由 PageFrame 的本章資訊 strip 提供）
    expect(container.querySelector('.c-symbols')).toBeNull()
    expect(container.querySelector('.ch10-symbols-link')).toBeNull()
  })
})
