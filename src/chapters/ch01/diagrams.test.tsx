import { waitFor } from '@testing-library/react'
import katex from 'katex'
import mermaid from 'mermaid'
import { SYSTEM_BLOCK_LABEL, SYSTEM_MAP_BLOCKS, defaultValues, sanitizeMermaidSource, systemMapModel, type SystemBlock } from '@/components'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { mean, normPdf } from '@/simulation/core'
import { STEP, batchOptima, conventionalStep, huberPsi, sgn } from '@/simulation/models/lms'
import {
  batchL2,
  contaminatedMedianApprox,
  lmsSteadyState,
  mseParabola,
  playgroundTrace,
  playgroundVarWStationary,
  populationOptima,
  signErrorJitterApprox,
  signErrorLatticeStationary,
  type LossDataParams,
} from '@/simulation/models/lossCompare'
import Chapter01 from './index'
import { IntroSection } from './sections/Intro'
import * as D from './diagrams'
import { DIAGRAMS, OUTLIER_DEMO, SYSTEM_MAP_CAPTION, SYSTEM_MAP_FOCUS, diagramOf } from './diagrams'
import { HANDCALCS } from './handcalcs'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors, expectTexParses } from '@/test/katex'

/**
 * Ch01 的方塊圖（docs/teaching-style.md §8）。ch01.test.tsx 為了速度把 mermaid mock 掉了；這裡用真正的 mermaid：
 *   1. parser 解析每一張圖（解析的是網站實際交給 mermaid 的原始碼：先經過 sanitizeMermaidSource）；
 *   2. 真的 render 一次（共用的 installMermaidSvgShim 給 jsdom 一個固定大小的 getBBox 墊片；renderMermaidForTest 與網站用同一個前處理）——
 *      parser 抓不到的問題只有 render 才看得到，例如 Mermaid 11 把單獨一個半形「+」當成 Markdown 清單，畫成「Unsupported markdown: list」；
 *      圖內的數學一律是 `$...$`：畫出來的文字沒有殘留的 `$`、含公式的標籤都由 KaTeX 排版（mathCount）、KaTeX 以外沒有 Unicode 拼的數學；
 *   3. 圖上的數字、正負號與 src/simulation 的實際函式逐一核對（比對原始碼裡的 TeX 字串）；
 *   4. 頁面：章首有 <SystemMap>（手排的 SVG，不經過 mermaid；主角用 systemMapModel／is-focus 核對），每張圖都在自己的小節內、
 *      排在對應公式之前，頁面交給 mermaid 的就是登錄的那 22 張原始碼。
 */

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

const HEAVY = 300_000
vi.setConfig({ testTimeout: 120_000 })

/** jsdom 沒有 SVG 排版：共用的墊片給 mermaid 一個「字數 × 固定寬度」的 getBBox，讓 layout（dagre）與標籤處理真的跑完。 */
beforeAll(installMermaidSvgShim)

const CHART_EXPORTS = Object.entries(D).filter(([k]) => k.startsWith('CHART_')) as [string, string][]

/** 原始碼裡所有會顯示在圖上的文字：雙引號內的標籤（節點、連線、subgraph 標題、state 說明）＋ stateDiagram 連線冒號後的說明。 */
function sourceLabels(chart: string): string[] {
  const quoted = Array.from(chart.matchAll(/"([^"]*)"/g), (m) => m[1])
  const transitions = Array.from(chart.matchAll(/-->\s*\w+:\s*(.+)$/gm), (m) => m[1].trim())
  return [...quoted, ...transitions]
}

/** 去掉所有空白（含全形空白、不換行空白與零寬空白），方便比對「圖上的文字」 */
const squash = (t: string) => t.replace(/[\s\u00a0\u200b]+/g, '')

/**
 * 為了讓節點不要太寬，一條長公式會在等號或加號前用 `$…$<br/>$…$` 分成兩行；核對公式內容時先把分行接回來
 * （`$a$<br/>$= b$` → `$a = b$`），所以「公式寫什麼」與「怎麼斷行」是兩件事，斷行不會讓內容檢查失效。
 */
const joined = (chart: string) => chart.replace(/\$<br\/>\$/g, ' ')

/** 配對的 `$$...$$` 或 `$...$`（與 components/mermaidSource.ts 相同的規則） */
const MATH = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 含公式的標籤：Mermaid 會把每個這樣的標籤排版成「一段」KaTeX */
const mathLabels = (chart: string): string[] => sourceLabels(chart).filter((l) => l.includes('$'))

/** 一行標籤裡「不是公式」的文字片段（這些要原封不動出現在圖上）；stateDiagram 連線說明已併成 `$$\text{…}…$$`，取其中的 \text{…} */
function plainPieces(line: string): string[] {
  if (line.includes('$$')) return Array.from(line.matchAll(/\\text\{([^{}]*)\}/g), (m) => m[1])
  return line.split(MATH).filter((_, i) => i % 3 === 0)
}

/** 圖說：拿掉公式後的純文字（`$...$` 以外的部分） */
const captionPlain = (caption: string) => caption.replace(MATH, '')

/**
 * 需要 DOM 節點（量位置、查 class）的測試用：與網站相同的前處理與 KaTeX 設定（renderMermaidForTest），
 * 並拿掉 KaTeX 的 MathML 複本，所以標籤的文字只出現一次。
 */
async function renderChart(_id: string, chart: string): Promise<HTMLElement> {
  const { svg } = await renderMermaidForTest(chart)
  const host = document.createElement('div')
  host.innerHTML = svg
  host.querySelector('style')?.remove()
  host.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  return host
}

/** 不經 sanitizeMermaidSource、也不排版公式：畫出來的就是原始碼本身的樣子（只給「Unsupported markdown」的回歸測試用）。 */
async function renderRaw(id: string, chart: string): Promise<HTMLElement> {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
  const { svg } = await mermaid.render(`t-${id.replace(/\W/g, '')}`, chart)
  const host = document.createElement('div')
  host.innerHTML = svg
  host.querySelector('style')?.remove()
  return host
}

/** 圖說（文字，可含 `$...$`）的檢查：每段 $...$ 可被 KaTeX 嚴格解析、$ 成對、$...$ 之外沒有 Unicode 拼的數學 */
function captionErrors(caption: string): string[] {
  const out: string[] = []
  for (const m of caption.matchAll(MATH)) {
    try {
      katex.renderToString(m[1] ?? m[2], { throwOnError: true, strict: 'ignore' })
    } catch (e) {
      out.push(`${m[1] ?? m[2]} ⇒ ${(e as Error).message}`)
    }
  }
  const rest = captionPlain(caption).replace(/\\\$/g, '')
  if (rest.includes('$')) out.push(`未配對的 $：${caption}`)
  if (UNICODE_MATH.test(rest)) out.push(`$...$ 之外有 Unicode 數學：${rest}`)
  return out
}

/** 與 ch01.test.tsx 相同的規則：KaTeX 以外的純文字裡不可有 Unicode 拼的數學 */
const UNICODE_MATH = /[₀-₉ₐ-ₜ⁰-⁹²³⁴σμδεψρπλτφΔΣΦ≡≤≥≪√±ṽ]|[A-Za-z]_[A-Za-z0-9{(]|[A-Za-z)\]]\^/

describe('Ch01 方塊圖：清單與原始碼規則', () => {
  it('共 22 張（21 張新圖＋原有的 LMS 訊號流），依頁面順序編號；每個 CHART_* 匯出恰好登錄一次', () => {
    expect(DIAGRAMS).toHaveLength(22)
    expect(DIAGRAMS.map((d) => d.id)).toEqual(Array.from({ length: 22 }, (_, i) => `D-01.${i + 1}`))
    expect(new Set(DIAGRAMS.map((d) => d.label)).size).toBe(22)
    expect(DIAGRAMS.filter((d) => d.label.startsWith('圖 1-'))).toHaveLength(12)
    expect(DIAGRAMS.filter((d) => d.label.startsWith('圖 2-'))).toHaveLength(10)
    expect(CHART_EXPORTS).toHaveLength(22)
    for (const [name, chart] of CHART_EXPORTS) expect(DIAGRAMS.filter((d) => d.chart === chart), name).toHaveLength(1)
    // 只有 §2.4 那一張在 Research 模式才顯示
    expect(DIAGRAMS.filter((d) => d.researchOnly).map((d) => d.id)).toEqual(['D-01.20'])
    // 教學規範 §8 的圖種都用到了
    expect(new Set(DIAGRAMS.map((d) => d.kind))).toEqual(new Set(['數學模型', '演算法迴圈', '比較圖', '手算流程', '判斷流程', '狀態機']))
    expect(() => diagramOf('D-01.99')).toThrow(/找不到方塊圖/)
  })

  it('每張圖都能被真正的 mermaid parser 解析（解析網站實際交給 mermaid 的原始碼）', async () => {
    for (const d of DIAGRAMS) {
      const r = await mermaid.parse(sanitizeMermaidSource(d.chart))
      const type = r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : ''
      expect(type, d.id).toMatch(d.kind === '狀態機' ? /^stateDiagram/ : /^flowchart/)
    }
  })

  it('章首的系統地圖是手排的 SVG（不經過 mermaid）：本章主角 = comparator、GMAC、步長、累加器，共 4 個藍色方塊', () => {
    expect([...SYSTEM_MAP_FOCUS].sort()).toEqual(['acc', 'cmp', 'gmac', 'scale'])
    const model = systemMapModel(SYSTEM_MAP_FOCUS)
    expect(model.blocks).toHaveLength(Object.keys(SYSTEM_BLOCK_LABEL).length) // 17 個方塊都在
    expect(model.blocks.filter((b) => b.focused).map((b) => b.id).sort()).toEqual(['acc', 'cmp', 'gmac', 'scale'])
    // 主角在「LMS 校正迴路」那條泳道（慢迴路），不是主 PLL 迴路
    for (const b of model.blocks.filter((x) => x.focused)) expect(b.lane, b.id).toBe('lms')
    expect(SYSTEM_MAP_FOCUS.every((id: SystemBlock) => SYSTEM_MAP_BLOCKS.some((b) => b.id === id))).toBe(true)
  })

  it('圖上的文字：沒有會被 Markdown／HTML 處理吃掉的寫法（單獨的半形 +、小於大於符號、以清單符號開頭）', () => {
    for (const d of DIAGRAMS) {
      const labels = sourceLabels(d.chart)
      expect(labels.length, d.id).toBeGreaterThan(4)
      for (const label of labels) {
        for (const line of label.split('<br/>')) {
          expect(line.trim(), `${d.id}：${label}`).not.toBe('+')
          expect(line, `${d.id}：${label}`).not.toMatch(/^\s*([-*+#]\s|\d+\.\s)/)
          expect(line, `${d.id}：${label}`).not.toMatch(/[<>]/)
        }
      }
    }
  })

  it('圖內的數學一律是 `$...$` LaTeX：每個標籤的 $ 成對、每段 TeX 可被 KaTeX 嚴格解析、不用雙反斜線（Mermaid 會收成一個）、沒有 Unicode 拼的數學', () => {
    for (const d of DIAGRAMS) {
      expect(d.chart, d.id).not.toContain('\\\\')
      expect(mathLabels(d.chart).length, d.id).toBeGreaterThanOrEqual(5)
      for (const label of sourceLabels(d.chart)) {
        // 標籤文字（不含 <br/>）：$ 成對
        const dollars = label.replace(/\\\$/g, '').split('$').length - 1
        expect(dollars % 2, `${d.id}：${label}`).toBe(0)
        // 每段 TeX 都能被 KaTeX 嚴格解析（stateDiagram 的連線說明已是併好的 `$$...$$`）
        for (const m of label.matchAll(MATH)) {
          expectTexParses(m[1] ?? m[2], `${d.id}：${m[0]}`, { strict: 'ignore' })
        }
        // 標籤裡不是公式的文字：沒有 Unicode 拼的數學（圈號 ①–⑭、全形的「＋」「−」是文字與符號本身，不算）
        for (const piece of label.split('<br/>').flatMap(plainPieces)) expect(unicodeMathIn(piece), `${d.id}：${piece}`).toEqual([])
      }
    }
  })

  it('加法點 (("＋"))：每一條進入的線都標了「＋」或「−」', () => {
    let junctions = 0
    for (const d of DIAGRAMS) {
      const ids = Array.from(d.chart.matchAll(/(\w+)\(\("＋"\)\)/g), (m) => m[1])
      junctions += ids.length
      for (const id of ids) {
        const incoming = d.chart.split('\n').filter((line) => new RegExp(`-->\\s*(\\|[^|]*\\|\\s*)?${id}\\b`).test(line))
        expect(incoming.length, `${d.id} ${id}`).toBeGreaterThanOrEqual(2)
        for (const line of incoming) expect(line, `${d.id} ${id}`).toMatch(new RegExp(`-- "(＋|−)" --> ${id}\\b`))
      }
    }
    expect(junctions).toBeGreaterThanOrEqual(15)
  })

  it('極性與公式一致：e = y − ŷ（量測進＋、預測進−）、δ = a − w（真值進＋、w 進−，勘誤 E39）', () => {
    // 圖 1-2：y_n 進「＋」、ŷ_n 進「−」
    expect(D.CHART_LMS_LOOP).toMatch(/Y -- "＋" --> SUB/)
    expect(D.CHART_LMS_LOOP).toMatch(/YH -- "−" --> SUB/)
    expect(D.CHART_LMS_LOOP).toContain(String.raw`$e_n = y_n - \hat y_n$`)
    expect(joined(D.CHART_LMS_LOOP)).toContain(String.raw`$w_{n+1} = w_n + \mu\, e_n\, x_n$`)
    // 圖 1-3：y 進「＋」、預測進「−」
    expect(D.CHART_DATA_TO_COST).toMatch(/Y\["量測 \$y\$"\] -- "＋" --> S/)
    expect(D.CHART_DATA_TO_COST).toMatch(/P -- "−" --> S/)
    expect(D.CHART_DATA_TO_COST).toContain(String.raw`$e = y - w\, x$`)
    // 圖 1-11：a 進「＋」、暫存器輸出 w_n 進「−」；累加器是 w_n + Δw_n
    expect(D.CHART_DELTA_LOOP).toMatch(/A\["真值 \$a\$"\] -- "＋" --> D/)
    expect(D.CHART_DELTA_LOOP).toMatch(/Z -- "−" --> D/)
    expect(D.CHART_DELTA_LOOP).toMatch(/Z -- "＋" --> ACC/)
    expect(D.CHART_DELTA_LOOP).toContain(String.raw`$\delta_n = a - w_n$`)
    expect(D.CHART_DELTA_LOOP).not.toMatch(/w_n - a/)
    // 圖 1-9：目標 w* 進「＋」、目前的 w 進「−」
    expect(D.CHART_MEAN_UPDATE).toMatch(/WS\["目標 \$w\^\*\$"\] -- "＋" --> D/)
    expect(D.CHART_MEAN_UPDATE).toMatch(/W -- "−" --> D/)
    // 圖 2-5：兩個迴路都是 y_n 進「＋」、w_n 進「−」
    for (const [y, s, z] of [
      ['LY', 'LS', 'LZ'],
      ['SY', 'SS', 'SZ'],
    ]) {
      expect(D.CHART_ONLINE_LOOPS).toMatch(new RegExp(`${y}\\["\\$y_n\\$"\\] -- "＋" --> ${s}`))
      expect(D.CHART_ONLINE_LOOPS).toMatch(new RegExp(`${z} -- "−" --> ${s}`))
    }
    // 本章沒有 block rate（k）的訊號：圖上不出現 w_k、G_k 這類標記
    for (const d of DIAGRAMS) expect(d.chart, d.id).not.toMatch(/[wG\\]\w*_k\b|[wG]_\{k/)
    // 架構約定（docs/assumptions.md §2a）：本章 22 張圖都是 L0 的數學圖，沒有 PLL 方塊；PLL 的接法（REF → DTC → PD、DIV → PD、
    // comparator 取 PD 的輸出）只在系統地圖與文字說明。要把 DTC／divider 畫進來，請連同這條斷言一起改成檢查新的接法。
    for (const d of DIAGRAMS) expect(d.chart, d.id).not.toMatch(/DTC|divider|Divider|PMUX|MMD|除頻|回授路徑/)
  })

  it('為了排版（換行、分組、改方向）調整過的圖，內容仍在：圖 1-2 的 DSM code、圖 1-4 兩個模型都進三種計分、圖 1-6 的是／否分支、圖 1-11 的每一條連線', () => {
    // 圖 1-2：輸入節點仍寫明「輸入」與「DSM code」（圖說也提到它）
    expect(D.CHART_LMS_LOOP).toContain(String.raw`X["$x_n$<br/>（輸入 /<br/>DSM code）"]`)
    expect(diagramOf('D-01.2').caption).toContain('DSM code')
    // 架構約定（docs/assumptions.md §2a）：相減的是 PD，它的輸出 e_n 就是 LMS 的輸入；DTC 的 gain 是 a（不再說「DTC gain 所在的誤差路徑」）
    expect(diagramOf('D-01.2').caption).toContain('相減的是 PD（輸出 $e_n$ 即 LMS 的輸入）')
    expect(diagramOf('D-01.2').caption).toContain('$a$ 是 DTC 的真實 gain')
    expect(diagramOf('D-01.2').caption).not.toMatch(/PD／comparator|所在的誤差路徑/)
    // 圖 1-4：A、B 同在一個 subgraph 裡，三條線從這一組出發（每種計分都吃到兩個模型），結果各接一格
    const group = /subgraph ERRS\[[^\n]*\n([\s\S]*?)\n {2}end/.exec(D.CHART_SCORE_COMPARE)?.[1] ?? ''
    expect(group).toMatch(/^\s+A\["模型 A 的誤差/m)
    expect(group).toMatch(/^\s+B\["模型 B 的誤差/m)
    for (const k of ['1', '2', '3']) {
      expect(D.CHART_SCORE_COMPARE).toMatch(new RegExp(`ERRS --> M${k}\\["`))
      expect(D.CHART_SCORE_COMPARE).toMatch(new RegExp(`M${k} --> R${k}\\["`))
    }
    // 圖 1-6：相關是 0 → 到達最佳解；不是 0 → 再調 w（誤差還跟著 x 動），新的誤差再繞回去
    expect(D.CHART_NORMAL_EQ).toMatch(/Q -- "是" --> DONE\[/)
    expect(D.CHART_NORMAL_EQ).toMatch(/Q -- "否" --> ADJ\["再調 \$w\$（誤差還跟著 \$x\$ 動）<br\/>/)
    expect(D.CHART_NORMAL_EQ).toMatch(/ADJ -->\|"新的誤差"\| E\b/)
    // 圖 1-11：改成由上往下之後，九個節點與十條連線（含兩條回授線）一條都沒少，符號沒換
    const edges = [
      /A\["真值 \$a\$"\] -- "＋" --> D\(\("＋"\)\)/,
      /D --> DL\[/,
      /DL --> X1\[/,
      /X1 --> E\[/,
      /E --> X2\[/,
      /X2 --> DW\[/,
      /DW -- "＋" --> ACC\(\("＋"\)\)/,
      /ACC --> Z\[/,
      /Z -- "＋" --> ACC\b/,
      /Z -- "−" --> D\b/,
    ]
    for (const re of edges) expect(D.CHART_DELTA_LOOP).toMatch(re)
    expect(D.CHART_DELTA_LOOP).toContain(String.raw`$\times\, x$`)
    expect(D.CHART_DELTA_LOOP).toContain(String.raw`$\times\, \mu\, x$`)
    expect(D.CHART_DELTA_LOOP).toContain(String.raw`$e_n = \delta_n\, x$`)
    expect(D.CHART_DELTA_LOOP).toContain(String.raw`$\Delta w_n = \mu\, x^2\, \delta_n$`)
    expect(D.CHART_DELTA_LOOP).toMatch(/class X1,X2 focus/)
  })

  it('圖說：一句話說明要看什麼；文字加上 `$...$` 變數，KaTeX 以外沒有 Unicode 拼的數學', () => {
    for (const d of DIAGRAMS) {
      const plain = d.caption.replace(/\$/g, '') // 長度以顯示的字數計（拿掉 $ 分隔符）
      expect(plain.length, d.id).toBeGreaterThanOrEqual(25)
      expect(plain.length, d.id).toBeLessThanOrEqual(110)
      expect(d.caption.endsWith('。'), d.id).toBe(true)
      expect(UNICODE_MATH.test(d.label), `${d.id}：${d.label}`).toBe(false)
      expect(captionErrors(d.caption), `${d.id}：${d.caption}`).toEqual([])
    }
    // 圖說裡的變數 $w$ 真的寫成 LaTeX（至少 6 張圖有）
    expect(DIAGRAMS.filter((d) => d.caption.includes('$w$')).map((d) => d.id)).toEqual(['D-01.1', 'D-01.3', 'D-01.6', 'D-01.7', 'D-01.9', 'D-01.12'])
    expect(captionErrors(SYSTEM_MAP_CAPTION)).toEqual([])
    expect(SYSTEM_MAP_CAPTION).toContain('藍色')
  })
})

describe('Ch01 方塊圖：真的 render 一次（parser 抓不到的問題）', () => {
  it('每張圖都畫得出來：沒有「Unsupported markdown」、沒有殘留的 $、含公式的標籤都由 KaTeX 排版、KaTeX 以外沒有 Unicode 數學、文字片段都在圖上、單張不超過 14 個節點', async () => {
    for (const d of DIAGRAMS) {
      const { text: raw, plainText, nodeCount, mathCount } = await renderMermaidForTest(d.chart)
      expect(raw, d.id).not.toMatch(/Unsupported markdown/)
      expect(raw, d.id).not.toContain('$')
      // 圖上「KaTeX 以外」的文字沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k 這類寫法）
      expect(unicodeMathIn(plainText), d.id).toEqual([])
      // 每個含公式的標籤（節點、連線、subgraph 標題、state 說明）恰好排版成一段 KaTeX
      expect(mathCount, d.id).toBe(mathLabels(d.chart).length)
      // 標籤裡不是公式的文字，原封不動出現在圖上
      const text = squash(raw)
      for (const label of sourceLabels(d.chart)) {
        for (const line of label.split('<br/>')) {
          for (const piece of plainPieces(line)) expect(text, `${d.id}：${piece}`).toContain(squash(piece))
        }
      }
      expect(nodeCount, d.id).toBeGreaterThanOrEqual(4)
      expect(nodeCount, d.id).toBeLessThanOrEqual(14)
    }
  }, HEAVY)

  it('TeX 寫錯會讓圖畫不出來（不是默默顯示原始碼）；stateDiagram 的連線說明不用 stateText() 就不會排版', async () => {
    await expect(renderMermaidForTest('flowchart LR\n  A["$\\frac{1}{$"] --> B')).rejects.toThrow()
    const raw = await renderMermaidForTest('stateDiagram-v2\n  S0 --> S1: 抽到 $e = 0$\n  state "$w = 0$" as S0')
    expect(raw.text).toContain('$e = 0$') // 連線說明沒有雙引號、前處理不會轉換
    expect(raw.mathCount).toBe(1) // 只有 state 的說明排版成 KaTeX
    const fixed = await renderMermaidForTest(D.CHART_LATTICE_CHAIN)
    expect(fixed.text).not.toContain('$')
    expect(fixed.mathCount).toBe(4 + 7) // 4 個 state + 7 條連線
  })

  it('回歸：單獨一個半形「+」的標籤會被 Mermaid 11 畫成「Unsupported markdown: list」——所以本章一律用全形「＋」', async () => {
    const bad = await renderRaw('bad', 'flowchart LR\n  A["a"] -- "+" --> S(("+"))\n  B["b"] -- "−" --> S')
    expect(squash(bad.textContent ?? '')).toContain('Unsupportedmarkdown')
    const good = await renderRaw('good', 'flowchart LR\n  A["a"] -- "＋" --> S(("＋"))\n  B["b"] -- "−" --> S')
    expect(squash(good.textContent ?? '')).not.toContain('Unsupportedmarkdown')
    expect(good.textContent).toContain('＋')
    // 網站的 <Mermaid> 會先套 sanitizeMermaidSource：即使照舊寫半形「+」也畫得出來（這是保險，本章的原始碼仍直接寫全形）
    const fixed = await renderMermaidForTest('flowchart LR\n  A["a"] -- "+" --> S(("+"))\n  B["b"] -- "-" --> S')
    expect(fixed.text).not.toMatch(/Unsupported markdown/)
  })

  it('標色：每張圖都有重點色，classDef 用深淺主題都看得清楚的實心底色＋白字', async () => {
    for (const d of DIAGRAMS) {
      expect(d.chart, d.id).toMatch(/classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff/)
      const host = await renderChart(`c-${d.id}`, d.chart)
      expect(host.querySelectorAll('.focus, .warn, .ok').length, d.id).toBeGreaterThan(0)
    }
  }, HEAVY)
})

describe('Ch01 方塊圖：排版與導讀一致（導讀說的上／下／左／右、第幾列，都以實際排版結果核對）', () => {
  // 節點的先後順序由 dagre 依圖的結構決定，與文字實際多寬無關，所以 jsdom（固定大小的 getBBox）排出來的順序與瀏覽器相同。
  type Pt = { x: number; y: number }
  const xy = (el: Element): Pt => {
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(el.getAttribute('transform') ?? '')
    if (!m) throw new Error(`沒有 translate：${el.getAttribute('id')}`)
    return { x: Number(m[1]), y: Number(m[2]) }
  }
  async function layout(id: string): Promise<{ at: (node: string) => Pt; rows: string[] }> {
    const host = await renderChart(`l-${id}`, diagramOf(id).chart)
    const nodes = new Map<string, Pt>()
    for (const el of Array.from(host.querySelectorAll('g.node'))) nodes.set((el.getAttribute('id') ?? '').replace(/^(flowchart|state)-|-\d+$/g, ''), xy(el))
    const rows = Array.from(host.querySelectorAll('g.root'))
      .filter((r) => r.getAttribute('transform'))
      .map((r) => ({ y: xy(r).y, label: r.querySelector(':scope > g.clusters .cluster-label')?.textContent?.trim() ?? '' }))
      .sort((p, q) => p.y - q.y)
      .map((r) => r.label)
    return {
      rows,
      at: (node) => {
        const p = nodes.get(node)
        if (!p) throw new Error(`${id} 沒有節點 ${node}（有：${[...nodes.keys()].join(', ')}）`)
        return p
      },
    }
  }
  /** 由左到右（x 嚴格遞增） */
  const leftToRight = (L: { at: (n: string) => Pt }, ...ids: string[]) => {
    for (let i = 1; i < ids.length; i++) expect(L.at(ids[i - 1]).x, `${ids[i - 1]} 應在 ${ids[i]} 左邊`).toBeLessThan(L.at(ids[i]).x)
  }
  /** 由上到下（y 嚴格遞增） */
  const topToBottom = (L: { at: (n: string) => Pt }, ...ids: string[]) => {
    for (let i = 1; i < ids.length; i++) expect(L.at(ids[i - 1]).y, `${ids[i - 1]} 應在 ${ids[i]} 上面`).toBeLessThan(L.at(ids[i]).y)
  }

  it('並排比較圖：各列由上到下的順序 = DIAGRAMS 的 rows（Mermaid 會把不相連的 subgraph 依宣告的相反順序排）', async () => {
    const withRows = DIAGRAMS.filter((d) => d.rows)
    expect(withRows.map((d) => d.id)).toEqual(['D-01.1', 'D-01.3', 'D-01.8', 'D-01.10', 'D-01.13', 'D-01.17', 'D-01.22'])
    // 有 subgraph 的圖：這七張並排比較圖（一列一個 subgraph），加上圖 1-4（兩個模型的誤差框成一組、三條線從這一組分出去，免得 2×3 條線交叉）
    expect(new Set(DIAGRAMS.filter((d) => d.chart.includes('subgraph')).map((d) => d.id))).toEqual(new Set([...withRows.map((d) => d.id), 'D-01.4']))
    for (const d of withRows) {
      const L = await layout(d.id)
      expect(L.rows, d.id).toHaveLength(d.rows!.length)
      // 標題可含公式（例如「第 0 筆（$n = 0$）」）：KaTeX 排版後的空白不同，所以去掉空白再比
      d.rows!.forEach((title, i) => expect(squash(L.rows[i]).startsWith(squash(title)), `${d.id} 第 ${i + 1} 列應是「${title}」，實際是「${L.rows[i]}」`).toBe(true))
    }
  }, HEAVY)

  it('列內由左往右：圖 1-1、1-3、1-8、1-10、2-1、2-5、2-10 每一列的方塊依計算順序排列', async () => {
    const chains: [string, string[][]][] = [
      ['D-01.1', [['B1', 'B2', 'B3', 'B4'], ['O1', 'O2', 'O3', 'O4']]],
      ['D-01.3', [['X', 'P', 'S', 'E'], ['E2', 'SQ', 'AV', 'J', 'MIN', 'WS']]],
      ['D-01.8', [['A1', 'A2', 'A3', 'A4'], ['B1', 'B2', 'B3', 'B4'], ['C1', 'C2', 'C3', 'C4']]],
      ['D-01.10', [['A0', 'B0', 'C0', 'D0', 'N0'], ['A1', 'B1', 'C1', 'D1', 'N1']]],
      ['D-01.13', [['M1', 'M2', 'M3', 'M4'], ['A1', 'A2', 'A3', 'A4'], ['H1', 'H2', 'H3', 'H4']]],
      ['D-01.17', [['LY', 'LS', 'LE', 'LP', 'LA', 'LZ'], ['SY', 'SS', 'SE', 'SP', 'SA', 'SZ']]],
      ['D-01.22', [['L1', 'L2', 'L3'], ['S1', 'S2', 'S3', 'S4']]],
    ]
    for (const [id, rows] of chains) {
      const L = await layout(id)
      for (const row of rows) {
        leftToRight(L, ...row)
        // 一列最多 6 個方塊：再長的一列在桌機放不進正文欄（方塊裡的字要斷成兩三行，節點才窄得下）
        expect(row.length, `${id} 的一列有 ${row.length} 個方塊`).toBeLessThanOrEqual(6)
      }
    }
  }, HEAVY)

  it('迴路圖：順向路徑由左往右，回授線才往回畫', async () => {
    // 圖 1-2：黑盒子那條路在上、預測那條路在下，兩者在加法點相遇；更新方塊在最右邊，「下一筆」往回送到乘法器
    const lms = await layout('D-01.2')
    leftToRight(lms, 'X', 'BOX', 'ADD', 'Y', 'SUB', 'E', 'UPD')
    leftToRight(lms, 'X', 'MUL', 'YH', 'SUB')
    topToBottom(lms, 'BOX', 'MUL')
    topToBottom(lms, 'Y', 'YH')
    // 圖 1-6：誤差與輸入在左邊進乘法器，「否」那條路在下面繞回去
    const ne = await layout('D-01.6')
    leftToRight(ne, 'E', 'M', 'AV', 'C', 'Q', 'ADJ')
    leftToRight(ne, 'X', 'M')
    expect(ne.at('DONE').x).toBe(ne.at('ADJ').x)
    topToBottom(ne, 'DONE', 'ADJ')
    // 圖 1-9、1-12、2-7：加法點在左、暫存器（z⁻¹）在右
    leftToRight(await layout('D-01.9'), 'WS', 'D', 'G', 'DW', 'ACC', 'Z', 'W')
    leftToRight(await layout('D-01.12'), 'V', 'G', 'S', 'Z', 'WT', 'P')
    leftToRight(await layout('D-01.19'), 'K', 'S', 'SN', 'MU', 'ACC', 'Z')
    // 圖 1-11：九格串成一長條橫的會比版面寬，所以改成由上往下——真值與第一個加法點在最上面，暫存器（z⁻¹）在最下面，回授線沿著旁邊往回畫
    topToBottom(await layout('D-01.11'), 'A', 'D', 'DL', 'X1', 'E', 'X2', 'DW', 'ACC', 'Z')
  }, HEAVY)

  it('其餘圖的位置敘述：左邊／右邊／上面／下面與排版相符', async () => {
    // 圖 1-4：兩個模型的誤差（同一組）在左邊、上下疊起來；三種計分方式由上到下，各自接一格結果
    const score = await layout('D-01.4')
    leftToRight(score, 'A', 'M1', 'R1')
    leftToRight(score, 'B', 'M3', 'R3')
    topToBottom(score, 'A', 'B')
    topToBottom(score, 'M1', 'M2', 'M3')
    topToBottom(score, 'R1', 'R2', 'R3')
    expect(score.at('A').x).toBeCloseTo(score.at('B').x, 6)
    for (const k of ['1', '2', '3']) expect(score.at(`M${k}`).y).toBeCloseTo(score.at(`R${k}`).y, 6)
    const calc = await layout('D-01.5')
    leftToRight(calc, 'T', 'C1', 'S1', 'DIV', 'WS')
    topToBottom(calc, 'S2', 'S1') // 分子（Σxy）畫在分母（Σx²）上面
    // 圖 1-7：含 w 的那條路在上，雜訊底在下
    const split = await layout('D-01.7')
    leftToRight(split, 'W', 'D', 'SQ', 'K', 'S', 'J')
    topToBottom(split, 'K', 'F')
    // 圖 2-2：+1、−1、tie 由左到右；三種 tie 慣例在最下面
    const tie = await layout('D-01.14')
    leftToRight(tie, 'P', 'N', 'T')
    topToBottom(tie, 'E', 'Q', 'T', 'T0')
    expect(new Set(['T0', 'T1', 'T2'].map((n) => tie.at(n).y)).size).toBe(1)
    leftToRight(await layout('D-01.15'), 'O', 'E', 'P2', 'D2')
    // 圖 2-4：MSE 在左、MAE 在右
    const mm = await layout('D-01.16')
    leftToRight(mm, 'S1', 'S2')
    leftToRight(mm, 'R1', 'Q')
    topToBottom(mm, 'D', 'C', 'S2', 'Q', 'R2')
    // 圖 2-6：中位數那一格在最左邊，越往右離中位數越遠
    leftToRight(await layout('D-01.18'), 'S0', 'S1', 'S2', 'S3')
    // 圖 2-8：三個來源在左、兩種目標在右
    const cm = await layout('D-01.20')
    leftToRight(cm, 'A', 'S', 'Y', 'ME')
    expect(cm.at('ME').x).toBe(cm.at('MD').x)
    // 圖 2-9：多位元在左、1 bit 在右
    const ac = await layout('D-01.21')
    leftToRight(ac, 'Q2', 'Q3')
    leftToRight(ac, 'A1', 'A2', 'A3', 'A4')
    topToBottom(ac, 'Q1', 'Q2', 'A1')
  }, HEAVY)
})

describe('Ch01 方塊圖：版面預算（桌機的正文欄約 900px，圖不能要橫向捲動）', () => {
  // 沿主方向串了幾格：LR 看不同的 x、TB 看不同的 y（同一層的方塊中心在同一條線上）；層數與字多寬無關，所以 jsdom 排出來的層數與瀏覽器相同。
  // 一條橫向流程每多一層，圖就多 100–200px：九層以上的 LR（圖 1-11 原本是 9 層、1362px 寬）一定比欄寬，要改成 TB 或折成列。
  const LR_LAYERS_MAX = 8
  const TB_LAYERS_MAX = 10

  it('沒有分列的流程圖：LR 最多 8 層、TB 最多 10 層', async () => {
    const seen: Record<string, number> = {}
    for (const d of DIAGRAMS.filter((x) => x.kind !== '狀態機' && !x.chart.includes('subgraph'))) {
      const host = await renderChart(`b-${d.id}`, d.chart)
      const horizontal = /^flowchart LR/.test(d.chart)
      const coords = new Set(
        Array.from(host.querySelectorAll('g.node')).map((el) => {
          const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(el.getAttribute('transform') ?? '')
          return Math.round(Number(m?.[horizontal ? 1 : 2]))
        }),
      )
      seen[d.id] = coords.size
      expect(coords.size, `${d.id}（${horizontal ? 'LR' : 'TB'}）有 ${coords.size} 層`).toBeLessThanOrEqual(horizontal ? LR_LAYERS_MAX : TB_LAYERS_MAX)
    }
    // 圖 1-2 是最長的橫向流程（7 層）；圖 1-11 是九格的迴路，改成 TB
    expect(seen['D-01.2']).toBe(7)
    expect(D.CHART_DELTA_LOOP).toMatch(/^flowchart TB/)
    expect(seen['D-01.11']).toBe(9)
  }, HEAVY)
})

describe('Ch01 方塊圖：圖上的數字與模型一致（錯的圖比沒有圖更糟）', () => {
  const X3 = [1, 2, 4]
  const Y3 = [3.2, 5.7, 12.5]
  const FOUR: LossDataParams = { model: 'four_point', a: 0, xDist: 'const', xScale: 1, sigma: 0, outlierProb: 0, outlierSize: 0, outlierSign: 'positive', n: 0, seed: 0 }
  /** 去尾零的固定有效位數（與頁面的 texNum 顯示相同） */
  const sig = (v: number, digits = 6) => String(Number(v.toPrecision(digits)))

  it('圖 1-4：模型 A（±10）與 B（±1）的三種平均', () => {
    const A = [10, -10, 10, -10]
    const B = [1, -1, 1, -1]
    const score = (e: number[]) => [mean(e), mean(e.map(Math.abs)), mean(e.map((v) => v * v))]
    expect(score(A)).toEqual([0, 10, 100])
    expect(score(B)).toEqual([0, 1, 1])
    for (const t of ['A = 0、B = 0', 'A = 10、B = 1', 'A = 100、B = 1']) expect(D.CHART_SCORE_COMPARE).toContain(t)
    // 兩組誤差本身（正負號是公式的一部分，寫在 $...$ 裡）
    expect(D.CHART_SCORE_COMPARE).toContain(String.raw`$+10$、$-10$、$+10$、$-10$`)
    expect(D.CHART_SCORE_COMPARE).toContain(String.raw`$+1$、$-1$、$+1$、$-1$`)
  })

  it('圖 1-1／圖 1-5：批次解 w* = Σxy/Σx²；圖上的 21、64.6、7、21.5333、3.07619 都來自三筆資料', () => {
    const xx = X3.map((x) => x * x)
    const xy = X3.map((x, i) => x * Y3[i])
    const sxx = xx.reduce((s, v) => s + v, 0)
    const sxy = xy.reduce((s, v) => s + v, 0)
    const wStar = batchL2(X3, Y3)
    expect(wStar).toBeCloseTo(sxy / sxx, 12)
    const c = D.CHART_WSTAR_CALC
    expect(c).toContain(`$x$：${X3.join('、')}`)
    expect(c).toContain(`$y$：${Y3.join('、')}`)
    expect(c).toContain(xx.join('、'))
    expect(c).toContain(xy.map((v) => sig(v)).join('、'))
    expect(c).toContain(String.raw`\sum x_i^2 = ${sig(sxx)}`)
    expect(c).toContain(String.raw`E[x^2] = ${sig(sxx / 3)}`)
    expect(c).toContain(String.raw`\sum x_i y_i = ${sig(sxy)}`)
    expect(c).toContain(String.raw`E[xy] = ${sig(sxy / 3)}`)
    expect(c).toContain(String.raw`w^* = ${sig(sxy)} / ${sig(sxx)} = ${sig(wStar)}`)
    expect(D.CHART_BATCH_VS_ONLINE).toContain(String.raw`w^* = \sum x_i y_i / \sum x_i^2`)
  })

  it('圖 1-6／圖 1-7：在 w* 處 Σe*·x = 0（normal equation），且 J(w) = J(w*) + ½E[x²](w − w*)²', () => {
    const wStar = batchL2(X3, Y3)
    const corr = (w: number) => mean(X3.map((x, i) => (Y3[i] - w * x) * x)) // E[e·x]
    expect(Math.abs(corr(wStar))).toBeLessThan(1e-12)
    expect(corr(2.5)).toBeGreaterThan(0) // w 太小：誤差還跟著 x 動（正相關）⇒ 往上調
    expect(corr(3.5)).toBeLessThan(0)
    const Ex2 = mean(X3.map((x) => x * x))
    const Exy = mean(X3.map((x, i) => x * Y3[i]))
    const Ey2 = mean(Y3.map((y) => y * y))
    for (const w of [1.5, 2.5, wStar, 4]) {
      const par = mseParabola(Ex2, Exy, Ey2, w)
      expect(par.J).toBeCloseTo(par.jMin + 0.5 * Ex2 * (w - wStar) ** 2, 12) // 圖 1-7 的兩條路相加
      expect(par.slope).toBeCloseTo(-corr(w), 12) // dJ/dw = −E[e·x]（圖 1-6 的相關器）
    }
    expect(D.CHART_COST_SPLIT).toContain(String.raw`$\times\, \tfrac12\, E[x^2]$`)
    expect(D.CHART_NORMAL_EQ).toContain(String.raw`平均更新量 $= \mu\, E[e\, x]$`)
  })

  it('圖 1-8：½·e² 的斜率是 −e·x、e² 的斜率是 −2·e·x；LMS 的 Δw = μ·e·x 等於「對 ½·e² 走步長 μ」或「對 e² 走步長 μ/2」', () => {
    const s = { w: 1, x: 2, y: 6, mu: 0.1 }
    const e = (w: number) => s.y - w * s.x
    const h = 1e-6
    const slopeHalf = (0.5 * e(s.w + h) ** 2 - 0.5 * e(s.w - h) ** 2) / (2 * h)
    const slopeFull = (e(s.w + h) ** 2 - e(s.w - h) ** 2) / (2 * h)
    expect(slopeHalf).toBeCloseTo(-e(s.w) * s.x, 6)
    expect(slopeFull).toBeCloseTo(-2 * e(s.w) * s.x, 6)
    const dw = conventionalStep(s).dw
    expect(-s.mu * slopeHalf).toBeCloseTo(dw, 6) // 第一列
    expect(-(s.mu / 2) * slopeFull).toBeCloseTo(dw, 6) // 第二列
    expect(-s.mu * slopeFull).toBeCloseTo(2 * dw, 6) // 第三列：步伐大 2 倍
    const c = D.CHART_HALF_FACTOR
    const count = (hay: string, needle: string) => hay.split(needle).length - 1
    expect(count(c, String.raw`$\Delta w = \mu\, e\, x$"`)).toBe(2)
    expect(c).toContain(String.raw`\Delta w = 2\mu\, e\, x`)
    // 微分：e² 的斜率是 −2 e x（第二、三列），½e² 的斜率是 −e x（第一列）
    expect(count(c, String.raw`$-2\, e\, x$"`)).toBe(2)
    expect(count(c, String.raw`$-e\, x$"`)).toBe(1)
    expect(c).toMatch(/class A4,B4 ok/)
    expect(c).toMatch(/class C4 warn/)
  })

  it('圖 1-9：照圖上的迴路迭代（w ← w + μ·E[x²]·(w* − w)）會收斂到 w*，每步的 pole 是 1 − μ·E[x²]', () => {
    const Ex2 = mean(X3.map((x) => x * x))
    const wStar = batchL2(X3, Y3)
    const mu = 0.1
    let w = 0
    const err: number[] = []
    for (let n = 0; n < 30; n++) {
      err.push(wStar - w)
      w += mu * Ex2 * (wStar - w)
    }
    expect(err[1] / err[0]).toBeCloseTo(1 - mu * Ex2, 12)
    expect(w).toBeCloseTo(wStar, 10)
    expect(D.CHART_MEAN_UPDATE).toContain(String.raw`E[\Delta w] = \mu\, E[x^2]\, (w^* - w)`)
  })

  it('圖 1-10 的每個數字都等於 playgroundTrace（lms.ts 的 conventionalStep）：ŷ、e、Δw、w₁ = 1.8、w₂ = 2.28', () => {
    const hand = { a: 3, w0: 1, x: 2, mu: 0.1 }
    const tr = playgroundTrace({ ...hand, steps: 3, noiseSigma: 0, seed: 1 })
    const y = hand.a * hand.x
    const c = joined(D.CHART_HAND_FLOW) // 方塊裡的長公式分成兩三行，內容照舊逐字核對
    for (const n of [0, 1]) {
      expect(c).toContain(String.raw`\hat y_${n} = ${sig(tr.w[n])} \times ${hand.x} = ${sig(tr.w[n] * hand.x)}`)
      expect(c).toContain(String.raw`e_${n} = ${y} - ${sig(tr.w[n] * hand.x)} = ${sig(tr.e[n])}`)
      expect(c).toContain(String.raw`\Delta w_${n} = ${hand.mu} \times ${sig(tr.e[n])} \times ${hand.x} = ${sig(tr.dw[n])}`)
      expect(c).toContain(String.raw`w_${n + 1} = ${sig(tr.w[n])} + ${sig(tr.dw[n])} = ${sig(tr.w[n + 1])}`)
    }
    expect(tr.w[1]).toBeCloseTo(1.8, 12)
    expect(tr.w[2]).toBeCloseTo(2.28, 12)
  })

  it('圖 1-11 的迴路：繞一圈的增益是 μ·x²，所以 δₙ₊₁ = (1 − μ·x²)·δₙ（與模擬的 δ 逐步相同）', () => {
    const hand = { a: 3, w0: 1, x: 2, mu: 0.1 }
    const tr = playgroundTrace({ ...hand, steps: 8, noiseSigma: 0, seed: 1 })
    let w = hand.w0
    for (let n = 0; n < 8; n++) {
      const delta = hand.a - w // 加法點：a 進＋、wₙ 進−
      const e = delta * hand.x // × x
      const dw = hand.mu * hand.x * e // × μ·x
      expect(delta).toBeCloseTo(tr.delta[n], 12)
      expect(e).toBeCloseTo(tr.e[n], 12)
      expect(dw).toBeCloseTo(hand.mu * hand.x ** 2 * delta, 12) // 圖上的 Δwₙ = μ·x²·δₙ
      w += dw // 累加器 + z⁻¹
    }
    expect(tr.delta[1] / tr.delta[0]).toBeCloseTo(1 - hand.mu * hand.x ** 2, 12)
  })

  it('圖 1-12 的迴路：s² ← p²·s² + (μ·x·σ)² 的固定點就是 F-01.9 的 μσ²/(2 − μx²)', () => {
    const [mu, x, sigma] = [0.1, 2, 1]
    const p = 1 - mu * x * x
    let s2 = 0
    for (let n = 0; n < 500; n++) s2 = p * p * s2 + (mu * x * sigma) ** 2
    expect(s2).toBeCloseTo(playgroundVarWStationary(mu, x, sigma), 12)
    expect(s2).toBeCloseTo((mu * sigma ** 2) / (2 - mu * x * x), 12)
    expect(D.CHART_NOISE_LOOP).toContain(String.raw`p = 1 - \mu\, x^2`)
  })

  it('圖 2-1／圖 2-2：三個 ψ 方塊就是 lms.ts 的 e／sgn／huberPsi；tie 慣例 zero／plus／minus 給 0／+1／−1', () => {
    expect([sgn(2.5), sgn(-0.1)]).toEqual([1, -1])
    expect([sgn(0, 'zero'), sgn(0, 'plus'), sgn(0, 'minus')]).toEqual([0, 1, -1])
    expect([huberPsi(0.4, 1), huberPsi(20, 1), huberPsi(-7, 1)]).toEqual([0.4, 1, -1])
    const c = D.CHART_SIGN_TIE
    const tieTex = ['0', '+1', '-1'].map((v) => String.raw`\operatorname{sign}(0) = ${v}$`)
    for (const t of ['zero：數學次梯度', 'plus：comparator', 'minus：comparator', ...tieTex]) expect(c).toContain(t)
    for (const t of [
      String.raw`\psi = e$`,
      String.raw`\psi = \operatorname{sign}(e)$`,
      String.raw`\psi = \operatorname{clip}(e, -\delta_H, \delta_H)$`,
      String.raw`\Delta w = \mu\, e\, x$`,
      String.raw`\Delta w = \mu\, \operatorname{sign}(e)\, x$`,
      String.raw`\Delta w = \mu\, \operatorname{clip}(e)\, x$`,
    ])
      expect(D.CHART_PSI_PIPELINES).toContain(t)
    expect(D.CHART_PSI_PIPELINES).toMatch(/class M2,A2,H2 focus/)
  })

  it('圖 2-3：一筆 outlier（y = 21）流過三條管線的數字 = lms.ts 的 step 函數', () => {
    const o = OUTLIER_DEMO
    const run = (v: 'conventional' | 'sign_error' | 'huber') => STEP[v]({ w: o.w, x: o.x, y: o.y, mu: o.mu, tie: 'zero', huberDelta: o.huberDelta })
    const [lms, se, hub] = [run('conventional'), run('sign_error'), run('huber')]
    const c = D.CHART_OUTLIER_FLOW
    expect(c).toContain(String.raw`$y = ${o.y}$（正常是 ${o.yNormal}）`)
    expect(c).toContain(String.raw`e = ${o.y} - ${o.w} \times ${o.x} = ${sig(lms.e)}`)
    expect(c).toContain(String.raw`\psi_2 = e = ${sig(lms.e)}`)
    expect(c).toContain(String.raw`\psi_1 = \operatorname{sign}(e) = +1`)
    expect(c).toContain(String.raw`\psi_H = \operatorname{clip}(e, -${o.huberDelta}, ${o.huberDelta}) = +1`)
    expect(c).toContain(String.raw`\Delta w = ${o.mu} \times ${sig(lms.e)} \times ${o.x} = ${sig(lms.dw)}$<br/>$w$ 從 ${o.w} 跳到 ${sig(lms.w)}`)
    for (const r of [se, hub]) expect(c).toContain(String.raw`\Delta w = ${o.mu} \times 1 \times ${o.x} = ${sig(r.dw)}$<br/>$w$ 從 ${o.w} 到 ${sig(r.w)}`)
    expect([sgn(lms.e), huberPsi(lms.e, o.huberDelta)]).toEqual([1, 1]) // 圖上兩個「+1」
    expect(lms.dw / se.dw).toBeCloseTo(20, 12)
  })

  it('圖 2-4：{0, 0, 0, 10} 的平均 2.5、中位數 0；MAE 的斜率 =（下面的筆數 − 上面的筆數）/ 4', () => {
    const y = [0, 0, 0, 10]
    const bo = batchOptima(y)
    expect([bo.mse, bo.maeLow, bo.maeHigh]).toEqual([2.5, 0, 0])
    const c = D.CHART_MEAN_VS_MEDIAN
    expect(c).toContain(String.raw`w^* = \text{平均} = ${bo.mse}`)
    expect(c).toContain(String.raw`w^* = \text{中位數} = ${bo.maeLow}`)
    expect(c).toContain(String.raw`= w - ${bo.mse}`)
    expect(c).toContain(String.raw`\text{斜率} = (\text{下面的筆數} - \text{上面的筆數}) / ${y.length}`)
    const jMae = (w: number) => mean(y.map((v) => Math.abs(v - w)))
    const slope = (w: number) => (y.filter((v) => v < w).length - y.filter((v) => v > w).length) / y.length
    for (const w of [-1, 5, 11]) expect((jMae(w + 1e-6) - jMae(w - 1e-6)) / 2e-6).toBeCloseTo(slope(w), 6)
    expect(slope(-1)).toBeLessThan(0) // 上面多：斜率為負 ⇒ w 往上移
    expect(slope(5)).toBeGreaterThan(0) // 下面多：斜率為正 ⇒ w 往下移
  })

  it('圖 2-5／圖 2-6：LMS 停在平均 2.5；Sign-Error 的格點鏈每往右一格機率乘 1/3（= ¼ ÷ ¾）、π₀ = ⅔、時間平均 ≈ μ/2（μ ≪ 10）', () => {
    const mu = 0.2
    expect(lmsSteadyState(FOUR, mu).mean).toBeCloseTo(2.5, 12)
    const lat = signErrorLatticeStationary(FOUR, { w0: 0, mu, tie: 'zero' })!
    expect(lat.grid[0]).toBeCloseTo(0, 12)
    expect(lat.grid[1]).toBeCloseTo(mu, 12)
    expect(lat.pi[0]).toBeCloseTo(2 / 3, 10)
    for (let k = 0; k < 5; k++) expect(lat.pi[k + 1] / lat.pi[k]).toBeCloseTo((1 / 4) / (3 / 4), 9)
    expect(lat.mean).toBeCloseTo(mu / 2, 10)
    // 連線說明在原始碼裡是併好的 `$$\text{…}…$$`（見 diagrams.ts 檔頭）：把 \text{…} 還原成文字來讀
    const c = D.CHART_LATTICE_CHAIN.replace(/\$\$/g, '').replace(/\\text\{([^{}]*)\}/g, '$1')
    expect(c).toMatch(/S0 --> S0: 抽到 0（機率 3\/4），e = 0，不動/)
    expect(c).toMatch(/S0 --> S1: 抽到 10（機率 1\/4），往上/)
    expect(c).toMatch(/S1 --> S0: 抽到 0（3\/4），往下/)
    expect(c.match(/3\/4/g)).toHaveLength(4)
    expect(c.match(/1\/4/g)).toHaveLength(3)
    // 另外兩種 tie 慣例：圖上畫出的格點只有 w = 0 的箭頭會變（w = 10 那一格也會變，但幾乎到不了）；
    // μ = 0.2 時時間平均是 μ 與 0，誤差約 5e-24（F-01.16，近似）
    expect(signErrorLatticeStationary(FOUR, { w0: 0, mu, tie: 'plus' })!.mean).toBeCloseTo(mu, 10)
    expect(signErrorLatticeStationary(FOUR, { w0: 0, mu, tie: 'minus' })!.mean).toBeCloseTo(0, 10)
  })

  it('圖 2-7 的線性化迴路：d ← (1 − μK_q)·d + μ·ξ（E[ξ²] = 1）的穩態變異數 ≈ F-01.18 的 μ/(2K_q)，也接近格點鏈精確值', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', sigma: 1 }
    for (const mu of [0.05, 0.0125]) {
      const ap = signErrorJitterApprox(p, mu)
      const kq = 2 * ap.density
      expect(kq).toBeCloseTo(Math.sqrt(2 / Math.PI), 10) // Gaussian：K_q = √(2/π)/σ
      const pole = 1 - mu * kq
      let v = 0
      for (let n = 0; n < 20000; n++) v = pole * pole * v + mu * mu
      expect(v / ap.variance - 1).toBeGreaterThan(0)
      expect(v / ap.variance - 1).toBeLessThan(0.03) // 差在 μK_q/2 的高階項
      const lat = signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!
      expect(Math.sqrt(v) / lat.std - 1).toBeGreaterThan(-0.03)
      expect(Math.sqrt(v) / lat.std - 1).toBeLessThan(0.03)
    }
    expect(D.CHART_SIGN_LINEARIZED).toContain(String.raw`$\times\, (-K_q)$，$K_q = 2\, f(m)$`)
    expect(D.CHART_SIGN_LINEARIZED).toMatch(/D -- "＋" --> ACC/)
  })

  it('圖 2-8：平均被拉走 ε·s（s 加倍就加倍），中位數的偏移 m 幾乎與 s 無關', () => {
    const base: LossDataParams = { ...FOUR, model: 'contaminated', a: 3, sigma: 1, outlierProb: 0.1, outlierSize: 20 }
    const o1 = populationOptima(base, 1)
    const o2 = populationOptima({ ...base, outlierSize: 40 }, 1)
    expect(o1.l2 - base.a).toBeCloseTo(0.1 * 20, 12)
    expect(o2.l2 - base.a).toBeCloseTo(0.1 * 40, 12)
    expect(o1.l1.lo - base.a).toBeCloseTo(contaminatedMedianApprox(1, 0.1), 9)
    expect(o2.l1.lo).toBeCloseTo(o1.l1.lo, 9)
    expect(D.CHART_CONTAM_MODEL).toContain(String.raw`量測 $y = a + v + o$`)
  })

  it('圖 2-9：四個方塊裡的更新式 = lms.ts 的四個 step 函數', () => {
    const s = { w: 1, x: -2, y: 5, mu: 0.1, tie: 'zero' as const, huberDelta: 1 }
    const e = s.y - s.w * s.x
    expect(STEP.conventional(s).dw).toBeCloseTo(s.mu * e * s.x, 12)
    expect(STEP.huber(s).dw).toBeCloseTo(s.mu * huberPsi(e, 1) * s.x, 12)
    expect(STEP.sign_error(s).dw).toBeCloseTo(s.mu * sgn(e) * s.x, 12)
    expect(STEP.sign_sign(s).dw).toBeCloseTo(s.mu * sgn(e) * sgn(s.x), 12)
    for (const t of [
      String.raw`\Delta w = \mu\, e\, x$`,
      String.raw`\Delta w = \mu\, \operatorname{clip}(e)\, x$`,
      String.raw`\Delta w = \mu\, \operatorname{sign}(e)\, x$`,
      String.raw`\Delta w = \mu\, \operatorname{sign}(e)\, \operatorname{sign}(x)$`,
    ])
      expect(D.CHART_ALGO_CHOICE).toContain(t)
    expect(D.CHART_ALGO_CHOICE).toMatch(/class A3 focus/) // PLL 校正迴路＝Sign-Error
  })

  it('圖 2-10：綜合手算（HC-01.8）共 14 步；每一步顯示的答案都出現在圖上，圈號 ①–⑭ 齊全', () => {
    const hc = HANDCALCS.find((h) => h.id === 'HC-01.8')!
    const v = defaultValues(hc)
    expect(v).toEqual({ a: 3, sigma: 1, eps: 0.1, s: 20, mu: 0.05 })
    const sol = hc.solve(v)
    expect(sol.steps).toHaveLength(14)
    const c = D.CHART_HC8_FLOW
    const cj = joined(c) // 長公式在方塊裡分成兩三行（`$…$<br/>$= …$`）：用接回來的版本核對公式
    for (const ch of '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭') expect(c).toContain(ch)
    // 每一步 TeX 最後一個等號後面的數字（題目上顯示的答案）
    const answers = sol.steps.map((st) => st.tex.slice(st.tex.lastIndexOf('=') + 1).trim())
    for (const a of answers) {
      expect(a).toMatch(/^[0-9.]+$/)
      expect(cj, `步驟答案 ${a}`).toMatch(new RegExp(`= ${a.replace('.', '\\.')}(?![0-9])`))
    }
    // 與模型直接比對（不只比字串）
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: v.a, sigma: v.sigma, outlierProb: v.eps, outlierSize: v.s }
    const ss = lmsSteadyState(p, v.mu)
    const jit = signErrorJitterApprox(p, v.mu)
    const z = contaminatedMedianApprox(1, v.eps)
    expect(c).toContain(String.raw`E[w_\infty] = a + \varepsilon\, s = ${sig(ss.mean, 5)}`)
    expect(c).toContain(String.raw`= ${sig(ss.variance, 5)}$<br/>$\operatorname{std} = ${sig(Math.sqrt(ss.variance), 5)}`)
    expect(cj).toContain(String.raw`q = 1 / (2 (1 - \varepsilon)) = ${sig(1 / (2 * (1 - v.eps)), 5)}`)
    expect(cj).toContain(String.raw`z = \Phi^{-1}(q) = ${sig(z, 5)}`)
    expect(cj).toContain(String.raw`\varphi(z) = ${sig(normPdf(z), 5)}`)
    expect(cj).toContain(String.raw`\sigma_v = ${sig(jit.density, 5)}`)
    expect(c).toContain(String.raw`= ${sig(jit.variance, 5)}$<br/>$\operatorname{std} = ${sig(Math.sqrt(jit.variance), 5)}`)
    expect(cj).toContain(String.raw`a + m = ${sig(populationOptima(p, 1).l1.lo, 5)}`)
  })
})

describe('Ch01 頁面上的方塊圖', () => {
  function renderAt(node: React.ReactNode, mode: 'beginner' | 'engineer' | 'research') {
    return renderPage(node, { mode, url: '/ch/01' })
  }
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

  it('§1.0–§1.1 用真正的 <Mermaid> 元件與真正的 mermaid 畫出來（系統地圖是手排的 SVG，立刻就有）：系統地圖有 4 個藍色方塊，沒有解析失敗', async () => {
    const { container } = renderAt(<IntroSection />, 'engineer')
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(5) // 系統地圖 + 圖 1-1 ～ 1-4
    // 畫好的圖在 .c-mermaid-svg > svg（KaTeX 的根號等內嵌 svg 不算）；畫好之前沒有 .c-mermaid-svg，只有載入中的佔位
    await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg > svg').length).toBe(5), { timeout: 120_000, interval: 250 })
    expect(container.querySelector('.c-mermaid-error')).toBeNull()
    expect(container.textContent).not.toContain('Mermaid 圖解析失敗')
    expect(squash(container.textContent ?? '')).not.toContain('Unsupportedmarkdown')
    // 圖內的數學由 KaTeX 排版：每張圖都有公式，畫出來的文字沒有殘留的 `$`
    for (const fig of figures) {
      const drawn = fig.querySelector('.c-mermaid-svg')!
      expect(drawn.textContent).not.toContain('$')
      expect(drawn.querySelectorAll('.katex').length).toBeGreaterThan(0)
    }
    const sys = figures[0]
    expect(sys.getAttribute('aria-label')).toContain('DTC-based Fractional-N PLL')
    expect(sys.classList.contains('c-sysmap')).toBe(true)
    expect(sys.querySelector('svg.c-sysmap-svg')).not.toBeNull()
    expect(sys.querySelector('svg g.node')).toBeNull() // 手排的 SVG，不是 mermaid 畫的
    // 4 個藍色方塊：is-focus（與 data-focus）標在 comparator、GMAC、步長、累加器上，其餘 13 個不是
    const blocks = Array.from(sys.querySelectorAll('g.c-sysmap-block'))
    expect(blocks.length).toBeGreaterThan(14) // 全站共用的大圖（不受單張 14 個節點的限制）
    expect(blocks).toHaveLength(SYSTEM_MAP_BLOCKS.length)
    const focused = blocks.filter((g) => g.classList.contains('is-focus'))
    expect(focused.map((g) => g.getAttribute('data-block')).sort()).toEqual([...SYSTEM_MAP_FOCUS].sort())
    expect(focused).toHaveLength(SYSTEM_MAP_FOCUS.length)
    for (const g of blocks) expect(g.getAttribute('data-focus') === 'true', g.getAttribute('data-block') ?? '').toBe(g.classList.contains('is-focus'))
    for (const box of Array.from(container.querySelectorAll('[data-diagram]'))) expect(box.querySelectorAll('svg g.node').length).toBeGreaterThanOrEqual(8)
  }, HEAVY)

  describe('整頁（mermaid.render 換成「真 parser＋空白 SVG」：整章掛在 jsdom 上時，真的排版 23 張圖要一分鐘）', () => {
    /** 頁面實際交給 mermaid 的原始碼，依呼叫順序 */
    const rendered: string[] = []
    beforeAll(() => {
      vi.spyOn(mermaid, 'render').mockImplementation(async (_id: string, chart: string) => {
        await mermaid.parse(chart) // 解析失敗就丟錯 ⇒ <Mermaid> 顯示「Mermaid 圖解析失敗」
        rendered.push(chart)
        return { svg: '<svg data-parsed="1"></svg>', diagramType: 'flowchart-v2' }
      })
    })
    beforeEach(() => {
      rendered.length = 0
    })
    afterAll(() => {
      vi.restoreAllMocks()
    })

    it('Research 模式：章首有 <SystemMap>，22 張圖依序出現在各自的小節、排在對應公式之前，全部通過 parser', async () => {
      const { container } = renderAt(<Chapter01 />, 'research')
      const figures = () => Array.from(container.querySelectorAll('figure.c-mermaid'))
      expect(figures()).toHaveLength(23) // 系統地圖 + 22
      // 22 張交給 mermaid（上面的 mock 回傳 <svg data-parsed>）；系統地圖是手排的 SVG，不經過 mermaid，所以 23 張都有 svg、其中 22 張是 mermaid 的
      await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg > svg').length).toBe(23), { timeout: 120_000, interval: 250 })
      expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg > svg[data-parsed]')).toHaveLength(22)
      expect(container.textContent).not.toContain('Mermaid 圖解析失敗')
      expect(container.querySelector('.c-mermaid-error')).toBeNull()
      // 頁面交給 mermaid 的就是登錄的那 22 張（依頁面順序），沒有多也沒有少；系統地圖不在其中
      // （<Mermaid> 先經過 sanitizeMermaidSource 才交給 mermaid：圖內的 `$...$` 在這裡已併成 `$$...$$`）
      expect(rendered).toEqual(DIAGRAMS.map((d) => d.chart).map(sanitizeMermaidSource))

      // 系統地圖：在 §1.0 開場問題之後、黑盒子模型（F-01.1）之前；下一段說明藍色方塊是什麼、本章加了什麼
      const s10 = document.getElementById('ch01-s10')!
      const sys = figures()[0]
      expect(s10.contains(sys)).toBe(true)
      expect(sys.getAttribute('aria-label')).toContain('DTC-based Fractional-N PLL')
      expect(sys.querySelector('figcaption')?.textContent).toBe(SYSTEM_MAP_CAPTION)
      expect(sys.closest('[data-diagram]')).toBeNull()
      expect(sys.classList.contains('c-sysmap')).toBe(true)
      // 本章的主角：被標成 is-focus 的方塊正好是 SYSTEM_MAP_FOCUS（comparator、GMAC、步長、累加器）
      expect(Array.from(sys.querySelectorAll('g.c-sysmap-block.is-focus'), (g) => g.getAttribute('data-block')).sort()).toEqual([...SYSTEM_MAP_FOCUS].sort())
      expect(follows(s10.querySelector('.ch01-lead')!, sys)).toBe(true)
      expect(follows(sys, document.getElementById('formula-F-01.1')!)).toBe(true)
      expect(sys.nextElementSibling?.textContent).toMatch(/你在這裡.*藍色方塊是本章的主角.*這條修正規則到底在最小化什麼/)
      // 架構約定：reference 先經過 DTC 才進 PD；回授路徑只有 divider；LMS（comparator）的輸入取自 PD 的輸出
      expect(sys.nextElementSibling?.textContent).toMatch(/reference clock 先經過 DTC、再進 phase detector（PD）.*回授路徑上只有 divider（或 PMUX）.*LMS 校正迴路的輸入是 PD 的輸出.*送進 loop filter 的同一個訊號.*comparator 取的就是它的正負號/)

      // 22 張圖：順序、所在小節、圖說、導讀
      const boxes = Array.from(container.querySelectorAll('[data-diagram]'))
      expect(boxes.map((b) => b.getAttribute('data-diagram'))).toEqual(DIAGRAMS.map((d) => d.id))
      for (const d of DIAGRAMS) {
        const box = container.querySelector(`[data-diagram="${d.id}"]`)!
        expect(box.closest('section.c-section')?.id, d.id).toBe(d.section)
        expect(box.getAttribute('data-diagram-kind'), d.id).toBe(d.kind)
        // 圖說：文字原樣顯示，變數（$...$）由 KaTeX 排版
        const cap = box.querySelector('figcaption')!.cloneNode(true) as HTMLElement
        const capMath = cap.querySelectorAll('.katex').length
        cap.querySelectorAll('.katex').forEach((e) => e.remove())
        expect(cap.textContent, d.id).toBe(captionPlain(`${d.label}｜${d.caption}`))
        expect(capMath, d.id).toBe(Array.from(d.caption.matchAll(MATH)).length)
        // 導讀：圖的正下方，帶讀者走一遍（先看…再看…），並把圖接回公式（「圖上…就是…」），數學用 KaTeX
        const read = box.querySelector('.c-chapter-fig-walk')!
        expect(read.previousElementSibling?.matches('figure.c-mermaid'), d.id).toBe(true)
        expect(read.textContent ?? '', d.id).toMatch(/^怎麼看這張圖/)
        expect(read.textContent ?? '', d.id).toMatch(/先看|只要看|出發|由左到右/)
        expect(read.textContent ?? '', d.id).toMatch(/圖上[^。]*(就是|對應|是)/)
        expect((read.textContent ?? '').length, d.id).toBeGreaterThan(80)
        expect(read.querySelectorAll('.katex').length, d.id).toBeGreaterThanOrEqual(2)
        expectNoTexErrors(read, d.id)
        // 先看圖、再看數學
        if (d.formula) {
          const formula = document.getElementById(`formula-${d.formula}`)
          expect(formula, `${d.id} → ${d.formula}`).toBeTruthy()
          expect(follows(box, formula!), `${d.id} 應排在 ${d.formula} 之前`).toBe(true)
        }
      }
      // 頁面上沒有未登錄的 Mermaid 圖
      expect(figures().filter((f) => !f.closest('[data-diagram]'))).toEqual([sys])
      // 每個講概念的小節都有圖（§1.5、§2.5 是互動實驗，§2.7 是思考題）
      const withDiagram = new Set(DIAGRAMS.map((d) => d.section))
      const conceptSections = Array.from(container.querySelectorAll('section.c-section[id^="ch01-s"]'))
        .map((el) => el.id)
        .filter((id) => !['ch01-s15', 'ch01-s25', 'ch01-s27'].includes(id))
      expect(conceptSections).toHaveLength(18)
      for (const id of conceptSections) expect(withDiagram.has(id), id).toBe(true)
      // 每個 boxed 結果（F-01.4、.5、.7、.8、.9、.11、.18）都有一張排在它前面的圖
      const boxedFormulas = Array.from(container.querySelectorAll('[id^="formula-F-01."]'))
        .filter((el) => (el.querySelector('.katex-mathml annotation')?.textContent ?? '').includes('\\boxed'))
        .map((el) => el.id.replace('formula-', ''))
      expect(boxedFormulas).toEqual(['F-01.4', 'F-01.5', 'F-01.7', 'F-01.8', 'F-01.9', 'F-01.11', 'F-01.18'])
      for (const fid of boxedFormulas) expect(DIAGRAMS.some((d) => d.formula === fid), fid).toBe(true)
    }, HEAVY)

    it('Beginner 模式：21 張圖＋系統地圖都看得到（圖不被模式收起來），而且都排在收合的推導之前', async () => {
      const { container } = renderAt(<Chapter01 />, 'beginner')
      const shown = DIAGRAMS.filter((d) => !d.researchOnly)
      expect(Array.from(container.querySelectorAll('[data-diagram]')).map((b) => b.getAttribute('data-diagram'))).toEqual(shown.map((d) => d.id))
      expect(container.querySelectorAll('figure.c-mermaid')).toHaveLength(22) // 系統地圖 + 21
      expect(container.querySelector('[data-diagram="D-01.20"]')).toBeNull()
      await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg > svg').length).toBe(22), { timeout: 120_000, interval: 250 })
      expect(container.querySelectorAll('figure.c-mermaid .c-mermaid-svg > svg[data-parsed]')).toHaveLength(21) // 系統地圖不經過 mermaid
      expect(container.querySelectorAll('g.c-sysmap-block.is-focus')).toHaveLength(SYSTEM_MAP_FOCUS.length) // 系統地圖在 Beginner 模式也看得到
      expect(rendered).toEqual(shown.map((d) => d.chart).map(sanitizeMermaidSource))
      // 沒有任何一張圖被包在可收合的推導或先備知識框裡
      for (const box of Array.from(container.querySelectorAll('[data-diagram]'))) expect(box.closest('.c-derivation, .c-prereq, details')).toBeNull()
      // 先看圖、再看推導：圖排在它的公式之前；同一小節裡排在圖前面的推導，都屬於更前面的另一條公式（中間隔著那條公式）
      let checkedDerivations = 0
      for (const d of shown.filter((x) => x.formula)) {
        const box = container.querySelector(`[data-diagram="${d.id}"]`)!
        const section = box.closest('section.c-section')!
        const formula = document.getElementById(`formula-${d.formula}`)!
        expect(follows(box, formula), d.id).toBe(true)
        const formulas = Array.from(section.querySelectorAll('[id^="formula-F-01."]'))
        const derivations = Array.from(section.querySelectorAll('.c-derivation'))
        for (const der of derivations.filter((el) => follows(el, box))) {
          expect(formulas.some((fm) => follows(der, fm) && follows(fm, box)), `${d.id}：前面的推導不屬於這張圖`).toBe(true)
        }
        // 圖與公式之間的推導：確實在圖之後
        checkedDerivations += derivations.filter((el) => follows(box, el) && follows(el, formula)).length
      }
      expect(checkedDerivations).toBeGreaterThanOrEqual(10)
    }, HEAVY)
  })
})
