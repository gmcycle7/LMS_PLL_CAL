import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { SYSTEM_BLOCK_LABEL, systemMapChart } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
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
  CHART_JACOBIAN_FSM,
  CHART_K95_FLOW,
  CHART_LYAPUNOV,
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
 *     沒有意外的粗體／斜體，畫出來的節點不超過 14 個；
 *  3. 圖的數量、頁面上的順序與位置（先看圖、再看推導）、章首的 <SystemMap>；
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
vi.mock('plotly.js-dist-min', () => ({ default: P }))

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
const SYSTEM_MAP_CHART = systemMapChart(SYSTEM_MAP_FOCUS)

/** SVG 裡每個標籤（foreignObject）的純文字，<br> 換成「⏎」 */
function labelsOf(svg: string): string[] {
  return [...svg.matchAll(/<foreignObject[^>]*>(.*?)<\/foreignObject>/gs)]
    .map((m) =>
      m[1]
        .replace(/<br\s*\/?>/g, '⏎')
        .replace(/<[^>]+>/g, '')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .trim(),
    )
    .filter(Boolean)
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
    }
  })

  it('SystemMap 標出 GMAC、「÷ N、× μ」與 gain accumulator（本章把它們變成 P 個 GMAC、更新矩陣 M 與向量 w_k）', () => {
    expect(SYSTEM_MAP_FOCUS).toEqual(['gmac', 'scale', 'acc'])
    expect(SYSTEM_MAP_CHART).toContain('class GMAC,SCALE,ACC focus')
  })
})

describe('Ch10 方塊圖：真正的 mermaid parser 與 render', () => {
  it('每張圖（含章首的 SystemMap）都能被 mermaid.parse 解析：25 張 flowchart、2 張 stateDiagram-v2', async () => {
    const types: string[] = []
    for (const d of CH10_DIAGRAMS) {
      const r = await mermaid.parse(d.chart)
      const type = r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : ''
      expect(type, d.name).toMatch(/^(flowchart-v2|stateDiagram)$/)
      types.push(type)
    }
    expect(types.filter((t) => t === 'stateDiagram').length).toBe(2)
    expect(types.filter((t) => t === 'flowchart-v2').length).toBe(25)
    const r = await mermaid.parse(SYSTEM_MAP_CHART)
    expect(r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : '').toBe('flowchart-v2')
  })

  it('負面：parser 真的在檢查——把一張圖的引號拿掉就解析失敗', async () => {
    const broken = CHART_COUPLING_PATHS.replace('D1["δ₁ = a₁ − w₁<br/>', 'D1[δ₁ = a₁ − w₁ (<br/>')
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
    for (const d of [...CH10_DIAGRAMS.map((x) => ({ name: x.name, chart: x.chart })), { name: 'SystemMap', chart: SYSTEM_MAP_CHART }]) {
      const { svg, text, nodeCount } = await rendered(d.chart)
      expect(svg, d.name).toContain('<svg')
      expect(text, d.name).not.toMatch(/Unsupported markdown/)
      expect(svg, d.name).not.toMatch(/Unsupported markdown/)
      expect(svg, d.name).not.toMatch(/<(em|strong|del|code|h[1-6]|ul|ol|li|blockquote)[\s>]/)
      expect(labelsOf(svg).length, d.name).toBeGreaterThanOrEqual(4)
      expect(nodeCount, d.name).toBeGreaterThanOrEqual(3)
      // 全站共用的 SystemMap 有 17 個方塊（不屬於本章，上限由 SystemMap.test.tsx 管）；本章自己的圖一律 ≤ 14（subgraph 的標題不算節點）
      if (d.name !== 'SystemMap') expect(nodeCount, d.name).toBeLessThanOrEqual(14)
    }
    // 畫出來的標籤就是原始碼裡寫的訊號名稱（抽查三張：迴路、比較、狀態機）
    expect(labelsOf(await renderChart(CHART_UPDATE_LOOP))).toEqual(expect.arrayContaining(['δ_k = a − w_k', 'G_k', 'w_(k+1)', '−（w_k）', '× M⏎更新矩陣']))
    expect(labelsOf(await renderChart(CHART_T18_MODES))).toEqual(expect.arrayContaining(['p = 1 + 0.2 × (+1) = 1.2⏎每個 block 放大 1.2 倍']))
    expect(labelsOf(await renderChart(CHART_JACOBIAN_FSM))).toEqual(expect.arrayContaining(['FREEZE：所有係數停止更新', 'P 欄都量完']))
    // 含「|」「′」「∝」的標籤也原樣畫出來（沒有被 Mermaid 的語法或 Markdown 吃掉）
    expect(labelsOf(await renderChart(CHART_COMPARATOR_GAIN))).toEqual(expect.arrayContaining(['e = s + v', '|s| 遠小於 σ_v', '|s| 遠大於 σ_v', '1-bit comparator⏎q = sign(e)，只有 ±1']))
    expect(labelsOf(await renderChart(CHART_GS_SWEEP))).toEqual(expect.arrayContaining(['δ₁′ = −ρ·δ₂', 'δ₂′ = −ρ·δ₁′ = ρ²·δ₂', '下一輪：再乘一次 ρ²']))
    expect(labelsOf(await renderChart(CHART_GMAC_NOISE))).toEqual(expect.arrayContaining(['G_k = K_q·R·δ_k + η_k⏎η_k 的平均是 0，Cov(η_k) ≈ R / N']))
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
  it('訊號由左到右：系統圖、耦合、取樣率、更新迴路、eigen 分解、雜訊路徑、Lyapunov、SVD、程式碼資料流', async () => {
    let L = await layoutOf(diagram('system').chart)
    expectIncreasing([L.node.E.x, L.node.Q.x, L.node.G1.x, L.node.M.x, L.node.W.x], '系統圖：e[n] 在最左、comparator 與 GMAC 在中間、M 與 w 在右邊')
    L = await layoutOf(CHART_COUPLING_PATHS)
    expectIncreasing([L.node.D1.x, L.node.R11.x, L.node.S1.x, L.node.K1.x, L.node.G1.x], '耦合圖：δ → ×R → 加法點 → ×K_q → G')
    expect(L.node.S1.y, '耦合圖：GMAC₁ 的加法點在上面').toBeLessThan(L.node.S2.y)
    expect(L.node.G1.y).toBeLessThan(L.node.G2.y)
    L = await layoutOf(CHART_SAMPLE_TO_BLOCK)
    expectIncreasing([L.node.U1.x, L.node.SE.x, L.node.CMP.x, L.node.X1.x, L.node.A1.x, L.node.G1.x], '取樣率圖：左框（sample）→ 右框（block）')
    L = await layoutOf(CHART_UPDATE_LOOP)
    expectIncreasing([L.node.A.x, L.node.SD.x, L.node.KR.x, L.node.SG.x, L.node.M.x, L.node.SW.x, L.node.Z.x], '更新迴路：左邊的加法點 … 右邊的累加器')
    L = await layoutOf(diagram('eigen-modes').chart)
    expectIncreasing([L.node.D.x, L.node.VT.x, L.node.L1.x, L.node.V.x, L.node.DN.x], 'eigen 分解：左邊 ×Vᵀ、中間各自的 pole、右邊 ×V')
    L = await layoutOf(CHART_NOISE_PATH)
    expectIncreasing([L.node.S.x, L.node.SUM.x, L.node.M.x], '雜訊路徑：雜訊從中間的加法點進來，只經過後面的 M')
    L = await layoutOf(CHART_LYAPUNOV)
    expectIncreasing([L.node.Q.x, L.node.MQ.x, L.node.S.x, L.node.Z.x, L.node.AX.x], 'Lyapunov：左邊進來的新雜訊、右邊繞圈的 A·X·Aᵀ')
    L = await layoutOf(CHART_PINV_SVD)
    expectIncreasing([L.node.E.x, L.node.VT.x, L.node.SG.x, L.node.U.x, L.node.EG.x], 'SVD ①（晶片）：ε → ×Vᵀ → ×σ → ×U → E[G]')
    expectIncreasing([L.node.GK.x, L.node.UT.x, L.node.INV.x, L.node.V.x, L.node.GM.x, L.node.OUT.x], 'SVD ②（更新矩陣）：G → ×Uᵀ → 除法 → ×V → ×(−γ) → 更新')
    L = await layoutOf(CHART_CODE_FLOW)
    expectIncreasing([L.node.JH.x, L.node.RULE.x, L.node.BU.x, L.node.NX.x], '程式碼資料流：Ĵ_n → 規則 → blockUpdate → 下一個 block')
    expectIncreasing([L.node.D.x, L.node.GM.x, L.node.BU.x], '程式碼資料流：δ_k → GMAC → blockUpdate')
    L = await layoutOf(CHART_NLMS)
    expectIncreasing([L.node.X.x, L.node.EN.x, L.node.DIV.x, L.node.RES.x], 'NLMS：code → 能量估計 → 正規化 → 更新')
    expect(L.node.G.x).toBeLessThan(L.node.DIV.x)
    L = await layoutOf(CHART_COMPARATOR_GAIN)
    expectIncreasing([L.node.S.x, L.node.ADD.x, L.node.CMP.x, L.node.AVG.x, L.node.LIN.x], 'comparator 增益：左邊的加法點 → comparator → 取平均 → 右邊分出兩條路')
    expect(L.node.SAT.x).toBeGreaterThan(L.node.AVG.x)
    L = await layoutOf(CHART_GMAC_NOISE)
    expectIncreasing([L.node.Q.x, L.node.P.x, L.node.AVG.x, L.node.G.x, L.node.EX.x], 'GMAC 雜訊：左框（sample）→ 右框（block）')
    expect(L.node.X.x).toBeLessThan(L.node.P.x)
    L = await layoutOf(CHART_GS_SWEEP)
    expectIncreasing([L.node.S0.x, L.node.P1.x, L.node.P2.x, L.node.E.x], 'Gauss–Seidel：階段 1 → 階段 2 → 最右邊是一輪的結果')
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
    expect(L.frame.PLANT.y, '① 晶片 在 ② 更新矩陣 之前').toBeLessThan(L.frame.UPD.y)
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
  it('δ = a − w 的極性：更新迴路的 w_k 以負號回到誤差的加法點；G_k 經 M 以正號累加（w_(k+1) = w_k + M·G_k）', () => {
    expect(CHART_UPDATE_LOOP).toContain('SD -- "δ_k = a − w_k" --> KR')
    expect(CHART_UPDATE_LOOP).toContain('A["a<br/>真實參數"] -- "＋" --> SD')
    expect(CHART_UPDATE_LOOP).toContain('Z -- "−（w_k）" --> SD')
    expect(CHART_UPDATE_LOOP).toContain('M -- "＋" --> SW')
    expect(CHART_UPDATE_LOOP).toContain('Z -- "＋" --> SW')
    // × K_q·R 就是 −J（J = ∂E[G]/∂w = −K_q R）
    expect(CHART_UPDATE_LOOP).toMatch(/× K_q·R<br\/>.*（= −J）/)
    // 雜訊在 G 之前加進來（G_k = K_q R δ_k + η_k）
    expect(CHART_UPDATE_LOOP).toMatch(/ETA\(\[.*η_k.*\]\) -- "＋" --> SG/)
  })

  it('取樣率：e[n]、q[n]、x[n] 在 sample 框內；G 在 block 框內；兩個 GMAC 共用同一個 comparator', () => {
    const [fast, slow] = CHART_SAMPLE_TO_BLOCK.split('subgraph SLOW')
    expect(fast).toContain('subgraph FAST["sample 速率')
    for (const sig of ['u₁[n]', 'u₂[n]', 'v[n]', 'e[n]', 'q[n] = sign(e[n])', 'x₁[n]', 'x₂[n]']) expect(fast, sig).toContain(sig)
    expect(slow).toContain('block 速率')
    expect(slow).toContain('累加 N 次再 ÷ N')
    expect(slow).not.toMatch(/\[n\]"\]/)
    expect((CHART_SAMPLE_TO_BLOCK.match(/CMP -- "q\[n\]" --> X[12]/g) ?? []).length).toBe(2)
    expect((CHART_SAMPLE_TO_BLOCK.match(/1-bit comparator/g) ?? []).length).toBe(1)
  })

  it('耦合圖的數字 = §10.1 的例子（gmac 線性模型）：G₁ = 0.8·K_q·10 = 0.06383、G₂ = 0.07979；交叉路徑是 R₁₂ = R₂₁ = 0.8', () => {
    expect(NUM.coupling.G1lin).toBeCloseTo(0.8 * NUM.Kq * 10, 12)
    expect(CHART_COUPLING_PATHS).toContain('0.8 × K_q × 10 = 0.06383')
    expect(CHART_COUPLING_PATHS).toContain('1 × K_q × 10 = 0.07979')
    expect(CHART_COUPLING_PATHS).toContain('× R₁₂ = 0.8')
    expect(CHART_COUPLING_PATHS).toContain('× R₂₁ = 0.8')
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
    for (const t of ['λ₁ = 1.99', 'λ₂ = 0.01', 'loop gain 0.995<br/>p₁ = 0.005', 'loop gain 0.005<br/>p₂ = 0.995', '× m₁ = γ / λ₁ = 0.2513', '× m₂ = γ / λ₂ = 50', 'loop gain 0.5<br/>p₂ = 0.5']) {
      expect(CHART_MODE_GAIN, t).toContain(t)
    }
    for (const t of ['= 1 − 0.5 × 0.01 = 0.995', '⌈−2.9957 ÷ −0.0050125⌉', '= ⌈597.6⌉ = 598', '= ⌈4.322⌉ = 5', 'k₉₅ = ⌈ln 0.05 ÷ ln |p|⌉']) expect(CHART_K95_FLOW, t).toContain(t)
    expect(Math.log(0.05) / Math.log(r.slow)).toBeCloseTo(597.6, 1)
    for (const t of ['m = μK_q = 0.5', 'm = γ / λ_min = 50', 'm = γ / (λ_min + λ_reg) = 4.545', 'p = 0.995，k₉₅ = 598', 'p = 0.5，k₉₅ = 5', 'p = 0.9545，k₉₅ = 65']) {
      expect(CHART_REG_COMPARE, t).toContain(t)
    }
    // 每參數 RMS = √(Lyapunov 的每參數變異)，與 §10.4 的表格同一個來源
    const z = NUM.noise
    expect(Math.sqrt(z.scalarPerParam[0])).toBeCloseTo(1.198, 3)
    expect(Math.sqrt(z.perParam[0])).toBeCloseTo(8.015, 3)
    expect(Math.sqrt(z.regPerParam[0])).toBeCloseTo(2.182, 3)
    for (const t of ['RMS(δ_j) = 1.198 fs', 'RMS(δ_j) = 8.015 fs', 'RMS(δ_j) = 2.182 fs']) expect(CHART_REG_COMPARE, t).toContain(t)
    expect(CHART_HANDCALC_FLOW).toContain('預設數字：598 / 5 / 65')
    expect(CHART_HANDCALC_FLOW).toContain('預設數字：0.9611 / 127.8 / 8.918 fs²')
    expect(z.scalarModeVar[1]).toBeCloseTo(0.9611, 4)
    expect(z.modeVar[1]).toBeCloseTo(127.83, 2)
    expect(z.regModeVar[1]).toBeCloseTo(8.918, 3)
  })

  it('雜訊路徑圖 = F-10.6 的推導第 6 步：訊號乘 K_q·λ_i 再乘 γ/(K_q·λ_i)，以負號回到 ξ；雜訊只經過後面那一塊', () => {
    expect(CHART_NOISE_PATH).toMatch(/Z -- "ξ_i（第 k 個 block）" --> S\["× K_q·λ_i/)
    expect(CHART_NOISE_PATH).toMatch(/N\(\["GMAC 雜訊 ζ_i<br\/>Var = λ_i \/ N"\]\) -- "＋" --> SUM/)
    expect(CHART_NOISE_PATH).toMatch(/SUM --> M\["× γ \/ \(K_q·λ_i\)/)
    expect(CHART_NOISE_PATH).toContain('M -- "−" --> ACC')
    expect(CHART_NOISE_PATH).toContain('Z -- "＋" --> ACC')
    expect(CHART_NOISE_PATH).toContain('慢模式 50 / K_q、快模式 0.2513 / K_q')
    // Lyapunov：X ← A X Aᵀ + M (R_x/N) Mᵀ
    expect(CHART_LYAPUNOV).toContain('A·X_k·Aᵀ')
    expect(CHART_LYAPUNOV).toContain('M·(R_x / N)·Mᵀ')
    expect((CHART_LYAPUNOV.match(/-- "＋" --> S\b/g) ?? []).length).toBe(2)
  })

  it('五種更新矩陣圖的公式 = F-10.3 / F-10.4 / F-10.8；Regularized 與 pinv 的分母都加 λ_reg', () => {
    for (const t of [
      'Scalar：M = μ·I',
      'Diagonal：M = diag(μ₁ … μ_P)',
      'Full inverse：M = γ·(K_q·R)⁻¹',
      'Regularized：M = γ·(K_q·(R + λ_reg·I))⁻¹',
      'Sequential：M 只留一個 M_ii',
      'p_i = 1 − μ·K_q·λ_i',
      'p_i = 1 − γ，每個模式一樣快',
      'p_i = 1 − γ·λ_i / (λ_i + λ_reg)',
    ]) {
      expect(CHART_M_VARIANTS, t).toContain(t)
    }
    expect(CHART_M_VARIANTS).toContain('class M2,M3,M4,M5 focus')
    expect(CHART_PINV_SVD).toContain('M = −γ·(JᵀJ + λ_reg·I)⁻¹·Jᵀ')
    expect(CHART_PINV_SVD).toContain('× σ_i / (σ_i² + λ_reg)')
    expect(CHART_PINV_SVD).toContain('模式 i 乘上 1 − γ·σ_i² / (σ_i² + λ_reg)')
    // 訊號順序：① Vᵀ → σ → U → E[G]（晶片）；② G → Uᵀ → 除法 → V → −γ（更新矩陣）；① 的輸出與 ② 的輸入標成同一個顏色
    expect(CHART_PINV_SVD).toMatch(/E\[.*\] --> VT\[.*\] --> SG\[.*\] --> U\[.*\] --> EG\["E\[G_k\] = J·ε_k"\]/)
    expect(CHART_PINV_SVD).toMatch(/GK\[.*G_k"\] --> UT\[.*\] --> INV\[.*\] --> V\[.*\] --> GM\["× \(−γ\)"\] --> OUT\[/)
    expect(CHART_PINV_SVD).toContain('class EG,GK ok')
    expect(CHART_NLMS).toContain('× μ̃ ÷ (K_q·tr R)')
    expect(CHART_NLMS).toContain('p_i = 1 − μ̃·λ_i / tr R')
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
    for (const s of ['× J₁₁ = −1', '× J₁₂ = +2', '× J₂₁ = +2', '× J₂₂ = −1', '× μ = 0.2', 'ε₁ = w₁ − w₁*', 'w₁ ← w₁ + 0.2·G₁', 'w₂ ← w₂ + 0.2·G₂']) expect(CHART_T18_COUPLING, s).toContain(s)
    expect(CHART_T18_COUPLING).toContain('S1 -- "G₁" --> M1')
    expect(CHART_T18_COUPLING).toContain('S2 -- "G₂" --> M2')
    // ε₂ 經 J₁₂ 進 G₁（第 1 列第 2 行），ε₁ 經 J₂₁ 進 G₂
    expect(CHART_T18_COUPLING).toMatch(/E2\[.*\] --> J12\[/)
    expect(CHART_T18_COUPLING).toContain('J12 -- "＋" --> S1')
    expect(CHART_T18_COUPLING).toMatch(/E1 --> J21\[/)
    expect(CHART_T18_COUPLING).toContain('J21 -- "＋" --> S2')
    expect(CHART_T18_COUPLING).toContain('class J12,J21 warn')
    for (const s of ['p = 1 + 0.2 × (−1) = 0.8', '斜率 J₁₁ + J₁₂ = −1 + 2 = +1', 'p = 1 + 0.2 × (+1) = 1.2', '斜率 J₁₁ − J₁₂ = −1 − 2 = −3', 'p = 1 + 0.2 × (−3) = 0.4']) {
      expect(CHART_T18_MODES, s).toContain(s)
    }
    expect(CHART_T18_MODES).toContain('class B2 warn')
  })

  it('Jacobian 量測：狀態機依序 FREEZE → PLUS → MINUS → SLOPE，對每個參數重複；Δ 的兩難用表格同一列的數字', () => {
    for (const s of ['[*] --> FREEZE', 'FREEZE --> PLUS', 'PLUS --> MINUS', 'MINUS --> SLOPE', 'SLOPE --> PLUS', 'SLOPE --> BUILD', 'BUILD --> [*]']) expect(CHART_JACOBIAN_FSM, s).toContain(s)
    expect(CHART_JACOBIAN_FSM).toContain('(G⁺ − G⁻) ÷ (2Δ_j)')
    const row = (r: number) => NUM.fd.rows.find((x) => x.r === r)!
    expect(row(0.3).pm1).toBeCloseTo(0.9852, 4)
    expect(row(1).pm1).toBeCloseTo(0.8556, 4)
    expect(row(0.3).stdNj4096).toBeCloseTo(0.0462, 4)
    expect(row(0.1).stdNj4096).toBeCloseTo(0.138, 3)
    for (const s of ['截斷係數 0.9852（±1 碼）', '截斷係數 0.8556（±1 碼）', 'std(Ĵ / K_q) = 0.0462', 'std(Ĵ / K_q) = 0.138']) expect(CHART_FD_TRADEOFF, s).toContain(s)
    // E24：M 用 Ĵ 建構、迴路乘真正的 J
    expect(CHART_ACAL_CHECK).toContain('A_cal = I + M(Ĵ)·J')
    expect(CHART_ACAL_CHECK).toMatch(/JH\[.*\] --> BM\[/)
    expect(CHART_ACAL_CHECK).toMatch(/JT\[.*\] --> AC\[/)
    expect(CHART_ACAL_CHECK).toContain('BM --> AC')
  })

  it('Sequential：狀態機與 mSequential 一致（一次只開一個 loop、輪數用完全部凍結）；陷阱圖的 4 / 0 / (−1, +1) 來自 a = (3, 1)', () => {
    for (const s of ['[*] --> CAL1', 'CAL1 --> CAL2', 'CAL2 --> CAL1', 'CAL2 --> DONE', 'DONE --> [*]', '只更新 w₁，w₂ 凍結', '只更新 w₂，w₁ 凍結', '全部凍結：M = 0']) expect(CHART_SEQ_FSM, s).toContain(s)
    expect(NUM.seq.a).toEqual([3, 1])
    const last = NUM.seq.rows[NUM.seq.rows.length - 1]
    expect(last.w1).toBeCloseTo(4, 9)
    expect(last.w2).toBeCloseTo(0, 9)
    expect(last.sum).toBeCloseTo(0, 9)
    for (const s of ['e[n] = u[n]·(δ₁ + δ₂) + v[n]', 'w₁ = a₁ + a₂ = 4', '正確值是 a₁ = 3', 'w₂ = 0', '正確值是 a₂ = 1', 'δ = (−1, +1)']) expect(CHART_SEQ_TRAP, s).toContain(s)
    expect(CHART_CODE_FLOW).toContain('δ_(k+1) = δ_k − (M_n / K_q)·G_k')
    expect(CHART_CODE_FLOW).toContain('G_k = K_q·C·δ_k + η_k')
    expect(CHART_CODE_FLOW).toContain('RULE -- "M_n = K_q·M（無因次）" --> BU')
    expect(CHART_CODE_FLOW).toContain('GM -- "G_k" --> BU')
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
    expect(CHART_COMPARATOR_GAIN).toContain('s = u₁·δ₁ + u₂·δ₂<br/>例：δ₁ = 0、δ₂ = 10 fs、u₂ = +1，s = 10 fs"] -- "＋" --> ADD(("＋"))')
    expect(CHART_COMPARATOR_GAIN).toContain('V(["雜訊 v<br/>Gaussian，RMS σ_v = 100 fs"]) -- "＋" --> ADD')
    expect(CHART_COMPARATOR_GAIN).toContain('ADD -- "e = s + v" --> CMP["1-bit comparator<br/>q = sign(e)，只有 ±1"]')
    expect(CHART_COMPARATOR_GAIN).toContain('CMP -- "q" --> AVG[')
    expect(CHART_COMPARATOR_GAIN).toContain('E[q | u] = erf(s ÷ (√2·σ_v))<br/>例：0.07966"]')
    expect(CHART_COMPARATOR_GAIN).toContain('AVG -- "|s| 遠小於 σ_v" --> LIN["≈ K_q × s<br/>K_q = √(2/π) ÷ σ_v = 0.007979 fs⁻¹<br/>例：0.07979"]')
    expect(CHART_COMPARATOR_GAIN).toContain('AVG -- "|s| 遠大於 σ_v" --> SAT["飽和在 ±1<br/>等效增益比 K_q 小"]')
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
    for (const sig of ['q[n] = ±1', 'v[n]', '乘積 q[n]·x[n]', 'code x[n]', 'E[x·xᵀ] = R', '共變異 ≈ R（因為 q² = 1）', '平均 ≈ K_q·R·δ_k']) expect(fast, sig).toContain(sig)
    expect(slow).toContain('block 速率：每 N 個 sample 一個 G_k')
    expect(slow).toContain('平均 N 個獨立的乘積<br/>平均不變，共變異 ÷ N')
    expect(slow).toContain('G_k = K_q·R·δ_k + η_k<br/>η_k 的平均是 0，Cov(η_k) ≈ R / N')
    expect(slow).toContain('例：N = 4096、R_ii = 1<br/>每個 GMAC 的雜訊 RMS = 1 ÷ 64 = 0.0156<br/>§10.1 的訊號 G₁ = 0.0638，只有它的 4.1 倍')
    expect(slow, 'block 框裡沒有 sample 速率的訊號').not.toMatch(/\[n\]/)
    // 兩個輸入（q 與 code）都進乘積，乘積才進平均
    expect(CHART_GMAC_NOISE).toMatch(/Q\[.*\] --> P\[/)
    expect(CHART_GMAC_NOISE).toMatch(/X\[.*\] --> P\n/)
    expect(CHART_GMAC_NOISE).toContain('P --> AVG')
    // 與更新迴路圖、Lyapunov 圖用的是同一個雜訊模型
    expect(CHART_UPDATE_LOOP).toContain('GMAC 雜訊 η_k<br/>Cov ≈ R / N')
    expect(CHART_LYAPUNOV).toContain('Cov(η_k) ≈ R_x / N')
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
      '階段 1：只動 w₁（γ = 1）<br/>一步把 G₁ ∝ δ₁ + ρ·δ₂ 推到 0',
      'P1 -- "δ₁′ = −ρ·δ₂" --> P2',
      '階段 2：只動 w₂（γ = 1）<br/>一步把 G₂ ∝ ρ·δ₁′ + δ₂ 推到 0',
      'P2 -- "δ₂′ = −ρ·δ₁′ = ρ²·δ₂" --> E',
      'ρ = 0.99：ρ² = 0.9801',
      'E -. "下一輪：再乘一次 ρ²" .-> P1',
      'class E warn',
    ]) {
      expect(CHART_GS_SWEEP, t).toContain(t)
    }
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

  it('整章渲染 <SystemMap>（緊接在開場問題之後）與 27 張圖：順序、所在段落、圖說、導讀、「先看圖再看公式」，每張圖的原始碼都送進 mermaid.render', async () => {
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
    const total = CH10_DIAGRAMS.length + 1
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(total)

    // ── 章首的 SystemMap：開場問題之後、第一張章內圖之前，標出本章的三個方塊，後面跟著一句說明 ──
    const maps = Array.from(container.querySelectorAll('figure.c-mermaid')).filter((f) => /系統方塊圖/.test(f.getAttribute('aria-label') ?? ''))
    expect(maps.length).toBe(1)
    const map = maps[0]
    for (const b of SYSTEM_MAP_FOCUS) expect(map.getAttribute('aria-label')).toContain(SYSTEM_BLOCK_LABEL[b])
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

    // ── 正文提到別張圖時一律用 <FigRef>：圖號等於登錄表的順序，頁面上沒有手寫的「圖 10-N」 ──
    const refs = Array.from(container.querySelectorAll<HTMLElement>('.ch10-figref'))
    expect(refs.length).toBeGreaterThanOrEqual(3)
    for (const r of refs) expect(r.textContent, r.dataset.figref).toBe(`圖 ${diagram(r.dataset.figref ?? '').no}`)
    expect(refs.map((r) => r.dataset.figref)).toEqual(expect.arrayContaining(['coupling', 'eigen-modes', 'nlms']))
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll('.ch10-fig-caption, .ch10-figref').forEach((el) => el.remove())
    expect(prose.textContent).not.toMatch(/圖\s*10-\d/)

    // ── 每張圖的原始碼都送進了 mermaid.render，而且每個 <Mermaid> 都離開「載入中」（沒有解析失敗的提示） ──
    await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg svg').length).toBe(total), { timeout: 60_000 })
    expect(container.textContent).not.toMatch(/Mermaid 圖解析失敗/)
    expect(container.querySelectorAll('.c-mermaid-error').length).toBe(0)
    const charts = seen.rendered.map((r) => r.chart)
    expect(charts.length).toBe(total)
    expect(charts).toContain(SYSTEM_MAP_CHART)
    for (const d of CH10_DIAGRAMS) expect(charts, d.name).toContain(d.chart)

    // 圖與導讀沒有引入 KaTeX 錯誤或 React 警告
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    const warnings = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => /Warning|Each child|unique "key"/.test(s))
    expect(warnings).toEqual([])
    errorSpy.mockRestore()
  })

  it('章首（S0Intro）以真正的 mermaid 畫出 SystemMap 與圖 10-1：<Mermaid> 元件拿到的是可以顯示的 SVG，藍色方塊是 GMAC / SCALE / ACC', async () => {
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
    expect(seen.rendered.map((r) => r.chart)).toEqual([SYSTEM_MAP_CHART, CH10_DIAGRAMS[0].chart])
    const mapSvg = container.querySelector('figure.c-mermaid .c-mermaid-svg svg') as SVGElement
    const focused = Array.from(mapSvg.querySelectorAll('g.node.focus')).map((g) => g.id.replace(/^.*flowchart-/, '').replace(/-\d+$/, ''))
    expect(focused.sort()).toEqual(['ACC', 'GMAC', 'SCALE'])
    // 章首只有一行符號表連結，沒有符號表本身
    expect(container.querySelector('.c-symbols')).toBeNull()
    expect(container.querySelector('.ch10-symbols-link button')?.textContent).toMatch(/本章符號表在最後/)
  })
})
