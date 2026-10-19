import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { presetById, presetsForExperiment } from '@/app/presets'
import { MathText, extractRegion, listRegions, plotMath, sanitizeMermaidSource } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { analyseAlpha, eqOffset, inversionBands, kappaInfWorst, kappaRational, kernelMin, largeSignalPeriodic, loopF3dB, loopMargins, makeL1, oneDiffMargin, runSspllLms } from '@/simulation/models/sspll'
import CaseSspllPage from './index'
import { FORMULAS } from './formulas'
import { SYMBOLS } from './symbols'
import { DIAGRAMS, MAP_FOCUS } from './diagrams'
import { FREF_MHZ, LMS_NOTE_ZH, LOOPS, PRED, SIM_CFG, mapIndex, mapIntervalsBelow, type HpdJson, type LoopKey, type SignMapJson } from './data'
import { loadAllSspllData } from './lazyData'
import { MODEL_SRC, PY_SOURCES, fp, fs, fx, intervalsText, signClass, tx, txs } from './common'
import { HANDCALCS } from './handcalcs'
import { LMS_WORST_RATE, hpdMemorySamples } from './sections/S04MeanUpdate'
import { nearGridIntervals } from './sections/S15Checklist'
import { HPD_DEFAULTS, HPD_EXPERIMENT_ID, buildHpdLoop, closedFormEdgeMHz, mergeHpdParams } from './experiments/HpdExplorer'
import { SIGNMAP_EXPERIMENT_ID, SIGN_DEFAULTS, classify, gosExactNote, mergeSignParams, modeSetup } from './experiments/SignMapExplorer'
import {
  GOLDEN_LMS_COND,
  LMS_CASE_LABEL,
  LMS_CASE_TEX,
  LMS_DEFAULTS,
  LMS_EXPERIMENT_ID,
  LMS_MC_RATIO_TOL,
  compareWithGolden,
  goldenTrace,
  gosRegressorHasDc,
  lmsCaseSetup,
  lmsCaseTag,
  mergeLmsParams,
  phosRegressorSum,
  predictCmDrift,
  predictPhosVerdict,
  type LmsCaseKind,
} from './experiments/ClosedLoopLms'

// hpd_L*.json 與 signmap_L*.json 是按需載入的（./lazyData）：這個檔案的測試先把它們全部載進快取，
// 頁面第一次渲染就拿得到 golden 資料，與靜態 import 時的行為相同。
let HPD: Record<LoopKey, HpdJson>
let SIGNMAP: Record<LoopKey, SignMapJson>
beforeAll(async () => {
  ;({ HPD, SIGNMAP } = await loadAllSspllData())
}, 60_000)

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))

const M = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"><g></g></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: M }))

function renderPage(url = '/case/sspll', mode?: 'beginner' | 'engineer' | 'research') {
  if (mode) localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <CaseSspllPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

/** 去掉程式碼區塊後的頁面文字（原始碼裡本來就有 NaN、Infinity 等字樣） */
function proseText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.c-code, .c-code-compare, annotation').forEach((el) => el.remove())
  return clone.textContent ?? ''
}

/** 元素裡每一段 KaTeX 的 TeX 原始碼（<annotation>） */
function texIn(el: Element): string[] {
  return Array.from(el.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
}

/** 實驗 C 的警告「Case C（filtered-x（Ĥ = H））不收斂」：Ĥ = H 以 KaTeX 顯示，textContent 是 MathML＋HTML 的文字，所以括號內不逐字比對 */
const CASE_C_FX_DIVERGED = /Case C（filtered-x（[^）]*））不收斂/

/**
 * 字串屬性裡不該再出現的 Unicode 數學（希臘字母、上下標、不等號、根號…）與純文字下標（K_p、f_ref 這種「單一字母_下標」；
 * 檔名 pred_vs_sim.json 之類不算）；數學一律寫成 `$...$` 的 LaTeX。
 */
const UNICODE_MATH = /[α-ωΑ-Ω²³⁻¹⁰√≤≥≈≠≡≪≫∞∑∫∂⟺⇒∣∤⟨⟩ℓ₀-₉ᵀĤĥ]|\u0302|(?<![A-Za-z0-9_])[A-Za-z]_[A-Za-z{]/

/**
 * 會經過 mathText 的字串屬性在頁面上對應的元素（標題、警告、假設、指標名稱與註記、圖標題與圖說、程式碼標題、手算題的說明…）。
 * 不含：Plotly 圖內文字、下拉選單的 <option>、Mermaid 圖說、ParamControl 的 reg（這些不渲染 KaTeX，保留 Unicode）。
 */
const STRING_PROP_SELECTORS = [
  '.c-section-title',
  '.c-exp-title',
  '.c-exp-desc',
  '.c-exp-warnings p',
  '.c-assumption-list li',
  '.c-check-note',
  '.c-metric-table tbody td:first-child',
  '.c-plot-title',
  '.c-plot .c-figcaption',
  '.c-callout-title',
  '.c-prereq > summary',
  '.c-quiz-title',
  '.c-recap-title',
  '.c-recap-label',
  '.c-code-title',
  '.c-code-caption',
  '.c-code-compare-label',
  '.c-code-compare-note',
  '.c-steps-title',
  '.c-texblock-label',
  '.c-handcalc-title',
  '.c-handcalc-label',
  '.c-step-why',
  '.c-handcalc-notes li',
  '.c-handcalc-tips li',
  '.cs-hand-invite',
  '.cs-table caption',
  '.cs-table th',
  '.cs-table td',
]

/** 元素的文字，去掉 KaTeX 的輸出（裡面本來就有希臘字母）與程式碼 */
function textWithoutMath(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex, code, .c-code').forEach((x) => x.remove())
  return clone.textContent ?? ''
}

function traceNames(): string[] {
  return P.react.mock.calls.flatMap((c) => ((c as unknown as [unknown, { name?: string }[]])[1] ?? []).map((d) => d.name ?? ''))
}

type PlotlyCall = [unknown, { name?: string; type?: string; y?: unknown[] }[], { title?: string | { text?: string }; xaxis?: { title?: string | { text?: string } }; yaxis?: { title?: string | { text?: string } } }?]

/** 送進 Plotly 的圖內文字：trace 名稱、圖標題、軸標題（Plot 已把 `$...$` 轉成斜體符號與上下標） */
function plotTexts(): { names: string[]; axisTitles: string[] } {
  const title = (t: string | { text?: string } | undefined) => (typeof t === 'string' ? t : (t?.text ?? ''))
  const calls = P.react.mock.calls as unknown as PlotlyCall[]
  return {
    names: calls.flatMap((c) => (c[1] ?? []).map((d) => d.name ?? '')).filter(Boolean),
    axisTitles: calls.flatMap((c) => [title(c[2]?.xaxis?.title), title(c[2]?.yaxis?.title)]).filter(Boolean),
  }
}

/** 圖內文字裡不該有的東西：沒轉換的 TeX（`$`、反斜線、大括號）與純文字拼的上下標（K_p、f_ref、x^2） */
const PLOT_TEXT_LEFTOVER = /[$\\{}]|(?<![A-Za-z0-9_])[A-Za-z]{1,3}_[A-Za-z0-9]|\^[-0-9]/

/**
 * 清掉 plotly／mermaid mock 的呼叫紀錄。Plot 在 unmount 時呼叫 purge(gd)（react／Plots.resize 也收到 gd）：
 * mock 的呼叫紀錄會一直抓著 gd，也就是整棵已卸載的頁面 DOM——jsdom 的一頁約 10 萬個節點、實測約 390 MB。
 * 不清掉的話，整頁渲染 9 次左右 worker 就會 heap out of memory（加入 8 題帶入手算之後頁面變大，原本的測試因此在第 7 個測試當掉）。
 */
function clearMockCalls() {
  for (const m of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize, M.initialize, M.render]) m.mockClear()
}

// 放在 beforeEach：此時上一個測試的 RTL cleanup（unmount → purge）已經跑完，紀錄才清得乾淨
beforeEach(clearMockCalls)

let selectorFlushCount = 0

/**
 * 釋放這個測試渲染過的整頁 DOM。jsdom 的 selector 引擎（nwsapi 2.2.x）有一個 1000 筆的 LRU 快取，每一種 selector 字串都記著
 * 「上一次查詢它的 context 節點與查到的結果」：用 querySelector(All) 查過的 container（整頁）與 cloneNode 出來的副本因此一直被抓著，
 * 直到同一個 selector 字串再被別的節點用到。實測每個測試會留下一整頁（約 0.5 GB）加上每一份整頁副本（約 0.45 GB），
 * live heap 在第 8 個測試達到 4.2 GB——正好在 Node 的 heap 上限邊緣，頁面內容稍微增加就 heap out of memory。
 * 做法：先卸載頁面、清掉 mock 的呼叫紀錄，再用 1000 個沒用過的 selector 查一個空元素，把舊的紀錄全部擠出快取（約 10 ms）；
 * 之後每個測試開始時的 live heap 是 0.1–1.1 GB，整個檔案的尖峰約 2.6 GB。
 */
function releasePages() {
  cleanup()
  clearMockCalls()
  const dummy = document.createElement('i')
  for (let i = 0; i < 1000; i++) dummy.querySelectorAll(`.selector-cache-flush-${selectorFlushCount++}`)
}

afterEach(() => {
  localStorage.clear()
  releasePages()
})

describe('案例頁 /case/sspll（jsdom smoke）', () => {
  it('SSPLL: 完整渲染不丟錯——22 個段落、章末的符號表、方塊圖、公式錨點、三個實驗、程式碼並排；沒有 KaTeX 錯誤或非有限數字', async () => {
    const { container } = renderPage('/case/sspll', 'engineer')
    // 符號表：整頁一張，放在章末（§21，外層 id="symbols"，在「本課必記」§17 之後、頁面最後）；章首只留一行連結
    expect(container.querySelectorAll('.c-symbols').length).toBe(1)
    expect(container.querySelectorAll('.c-symbols tbody tr').length).toBe(SYMBOLS.length)
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(30)
    expect(new Set(SYMBOLS.map((s) => s.symbol)).size).toBe(SYMBOLS.length)
    const page = container.querySelector('.case-sspll') as HTMLElement
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols.querySelector('.c-symbols')).not.toBeNull()
    expect(page.lastElementChild).toBe(symbols)
    expect((container.querySelector('#cs-17') as HTMLElement).compareDocumentPosition(symbols) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('#cs-1 .c-symbols')).toBeNull()
    // 章首骨架（teaching-style §9）：問題（blockquote）是第一個區塊、系統地圖（PageMap）緊接在後；不再有「本章符號表在最後」的按鈕（連結在 PageFrame 的 strip 裡）
    expect(Array.from(container.querySelectorAll('button')).find((b) => /^本章符號表在最後/.test(b.textContent ?? ''))).toBeUndefined()
    const question = container.querySelector('.cs-question') as HTMLElement
    expect(page.firstElementChild).toBe(question)
    expect(question.nextElementSibling).toBe(container.querySelector('.cs-map'))
    expect(question.compareDocumentPosition(container.querySelector('#cs-0') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 「首次出現」欄只會是章首或 §n；每個符號都有意義欄
    for (const sym of SYMBOLS) {
      expect(sym.firstSeen ?? '', sym.symbol).toMatch(/^(章首|§\d+)$/)
      expect(sym.meaning, sym.symbol).toBeTruthy()
    }
    // 方塊圖：章首的系統地圖 + 登錄表的每一張圖，各出現一次、依登錄順序
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(DIAGRAMS.length + 1)
    expect(Array.from(container.querySelectorAll('[data-diagram]')).map((e) => e.getAttribute('data-diagram'))).toEqual(DIAGRAMS.map((d) => d.id))
    expect(DIAGRAMS.length).toBeGreaterThanOrEqual(8)
    // 段落標題（H2）：0–21
    const h2 = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent ?? '')
    expect(h2).toHaveLength(22)
    for (const t of [
      '0. 先講結論',
      '1. 本章路線圖',
      '2. 架構',
      '3. 從比較點到 PD',
      '4. LMS 的平均更新',
      '5. 為什麼',
      '6. 三個迴路',
      '7. GOS',
      '8. PHOS',
      '9. GOS 與 PHOS 一起看',
      '10. 模擬證據',
      '11. 對策',
      '12. 有限步長',
      '13. 比較器 DC offset',
      '14. 動手',
      '15. 設計 checklist',
      '16. 思考題',
      '17. 本課必記',
      '18. 連結到 PLL 硬體',
      '19. 仍未驗證的部分',
      '20. 檔案與重現方式',
      '21. 本章符號表',
    ]) {
      expect(h2.filter((x) => x.startsWith(t)).length, t).toBe(1)
    }
    expect(h2[h2.length - 1]).toBe('21. 本章符號表')
    // 每個登錄的公式都有唯一的 TexBlock 錨點
    const ids = Array.from(container.querySelectorAll('[id^="formula-F-CS"]')).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) expect(ids, f.id).toContain(`formula-${f.id}`)
    // KaTeX 都渲染成功
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(600)
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    // 三個實驗
    for (const id of [HPD_EXPERIMENT_ID, SIGNMAP_EXPERIMENT_ID, LMS_EXPERIMENT_ID]) expect(container.querySelector(`#exp-${id}`), id).not.toBeNull()
    // 帶入手算：HANDCALCS 的每一題都在頁面上各出現一次（依頁面順序），預設顯示帶入過程；綜合題（最後一題）排在思考題之前
    const hand = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(hand.map((e) => e.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(HANDCALCS.length).toBeGreaterThanOrEqual(5)
    for (const e of hand) expect(e.querySelectorAll('.c-step').length, e.id).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('.cs-hand-invite').length).toBe(HANDCALCS.length)
    const quiz = container.querySelector('#cs-16') as HTMLElement
    expect(hand[hand.length - 1].compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hand[hand.length - 2].compareDocumentPosition(hand[hand.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 字串屬性裡的數學都寫成 `$...$`：這些元素去掉 KaTeX 之後，不該再有 Unicode 拼的公式（希臘字母、上下標、不等號…）
    let checkedProps = 0
    for (const sel of STRING_PROP_SELECTORS) {
      const els = Array.from(container.querySelectorAll(sel))
      expect(els.length, sel).toBeGreaterThan(0)
      for (const el of els) {
        expect(textWithoutMath(el), `${sel}：${(el.textContent ?? '').slice(0, 60)}`).not.toMatch(UNICODE_MATH)
        checkedProps++
      }
    }
    expect(checkedProps).toBeGreaterThan(400)
    // 控制項的 label／hint／unit 與指標的 unit（第 3 欄）：同樣不留 Unicode 拼的數學（含 ×、÷、±、·）；reg 與 <option> 是純文字，不在此列
    let checkedControls = 0
    for (const sel of ['.c-param-label', '.c-param-hint', '.c-param-unit', '.c-metric-table tbody td:nth-child(3)']) {
      const els = Array.from(container.querySelectorAll(sel))
      expect(els.length, sel).toBeGreaterThan(0)
      for (const el of els) {
        expect(unicodeMathIn(textWithoutMath(el)), `${sel}：${(el.textContent ?? '').slice(0, 60)}`).toEqual([])
        checkedControls++
      }
    }
    expect(checkedControls).toBeGreaterThan(40)
    expect(container.querySelectorAll('.c-param-unit .katex').length).toBeGreaterThan(0) // 增益倍率的單位 × 以 KaTeX 顯示
    // 實驗的標題、圖標題與公式標籤確實有 KaTeX（不是把 `$` 原樣印出來）
    for (const sel of ['.c-exp-title', '.c-plot-title', '.c-assumption-list li', '.c-texblock-label', '.c-handcalc-title', '.cs-hand-invite']) {
      expect(container.querySelectorAll(`${sel} .katex`).length, sel).toBeGreaterThan(0)
    }
    expect(proseText(container)).not.toMatch(/\$[^$\n]{1,80}\$/) // 沒有漏掉沒渲染的 `$...$`
    // §15 的 near-grid 區間來自按需載入的 signmap_L2.json（beforeAll 已載入）：頁面上是數字，不是「載入中」
    expect(proseText(container)).toContain('L2 raw 的大訊號 map：466.5–508.5、1468.5–1499.5 MHz；ac 時為 490.5–513.5、1487.5–1512.5 MHz')
    expect(container.querySelector('.cs-data-pending')).toBeNull()
    // 程式碼：region 都擷取成功、有差異行高亮、TS 與 Python 都出現
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    expect(screen.queryByText(/程式碼載入錯誤/)).toBeNull()
    expect(container.querySelectorAll('.c-code-mark').length).toBeGreaterThanOrEqual(12)
    expect(container.querySelectorAll('code.language-python').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('code.language-typescript').length).toBeGreaterThanOrEqual(10)
    // 三層結論標籤都有用到
    const text = proseText(container)
    expect(text).toMatch(/精確｜指定模型/)
    expect(text).toMatch(/近似｜需驗證/)
    expect(text).toMatch(/研究假說/)
    // 頁面上不得出現 NaN / undefined / Infinity
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
    // 關鍵數字（由資料與 TS port 產生）
    expect(text).toContain('134.820')
    expect(text).toContain('117.278')
    expect(text).toContain('32.68–125.33 MHz')
    expect(text).toContain('27.72–105.09 MHz')
    expect(text).toContain('0.388836')
    // ── 審查修正（R06b／R09／R10／C07／C08）：成立條件在 Engineer 模式就寫在公式旁邊 ──
    const sec = (id: string) => container.querySelector(`#${id}`) as HTMLElement
    const allTex = texIn(container)
    // C08（§2）：理想模型＝只留一階；精確零點 a/(1 − a) = 0.03093；停在 w_g = a 時還剩 a²Δ = 7.03 fs（起始 aΔ = 234.4 fs）
    const s2 = sec('cs-2').textContent ?? ''
    for (const frag of ['只留一階', '0.03093', '7.03', '234.4', '斜率多乘']) expect(s2, frag).toContain(frag)
    expect(texIn(sec('cs-2')).some((t) => t === String.raw`\rho\Delta-(1-a)(1+w_g)\,\rho\Delta=(a-w_g+a\,w_g)\,\rho\Delta`)).toBe(true)
    expect((SIM_CFG.a / (1 - SIM_CFG.a)).toFixed(5)).toBe('0.03093')
    expect((SIM_CFG.a ** 2 * SIM_CFG.deltaPs * 1000).toFixed(2)).toBe('7.03')
    expect((SIM_CFG.a * SIM_CFG.deltaPs * 1000).toFixed(1)).toBe('234.4')
    // R06b（§4.2）：把 δ_j 提到卷積外面的前提（權重在 h_PD 的記憶長度內幾乎不變）寫在那一步
    const s4 = proseText(sec('cs-4'))
    for (const frag of ['記憶長度內幾乎不變', '權重慢變', '14、40、49 拍', '慢 200 倍以上', '只剩 128 拍']) expect(s4, frag).toContain(frag)
    // 「Re κ 不超過 max Re H_PD」只對 raw regressor、8 個相位出現次數相同成立；其他情況（Engineer 以上才列）最極端是每個 block 修掉 8/25，仍慢 30 倍以上
    for (const frag of ['用 raw regressor、而且 PMUX 的 8 個相位被選到的次數一樣多時', '慢 30 倍以上']) expect(s4, frag).toContain(frag)
    expect(texIn(sec('cs-4'))).toContain('8/25')
    expect(Math.floor((512 * 25) / LMS_WORST_RATE / Math.max(...(['L1', 'L2', 'L3'] as const).map((k) => hpdMemorySamples(LOOPS[k]))) / 10) * 10).toBe(30)
    expect(texIn(sec('cs-4')).some((t) => t.includes(String.raw`\overset{\delta_j\ \text{固定}}{=}`))).toBe(true)
    expect(sec('cs-4').querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    // R09（§7.1）：κ_GOS = C_GOS/var(ρ)；「乘 12」只在 var(ρ) = 1/12；開迴路基準是去掉平均值的 ρ
    const s7 = proseText(sec('cs-7'))
    for (const frag of ['去掉平均值之後', '折到 DC', '只差一個正的倍數', '約差 4 倍']) expect(s7, frag).toContain(frag)
    const tex7 = texIn(sec('cs-7'))
    for (const t of [String.raw`\kappa_{GOS}=C_{GOS}/\mathrm{var}(\rho)`, String.raw`\mathrm{var}(\rho)=\frac{b^2-1}{12b^2}`, String.raw`\kappa_{GOS}=\frac{b^2}{b^2-1}\cdot12C_{GOS}`, '12C=0.8859', String.raw`\kappa_{GOS}=1.1812`, String.raw`C=E[\rho^2]=\tfrac14+\tfrac1{12}=\tfrac13`])
      expect(tex7, t).toContain(t)
    expect(tex7.some((t) => t.includes(String.raw`\xlongequal{\;\mathrm{var}(\rho)=1/12\;}\ 12\,C_{GOS}`))).toBe(true)
    // R10：κ_m 是複數；排序、正負、上下界都寫 Re κ；dead zone 的量是 κ_PHOS
    for (const t of [String.raw`\mathrm{Re}\,\kappa_1=8\,\mathrm{Re}\,\lambda_1`, String.raw`\kappa_1=-0.1395+0.3116j`, String.raw`\kappa_{PHOS}=\min_m\mathrm{Re}\,\kappa_m`]) expect(allTex, t).toContain(t)
    expect(allTex.some((t) => t.includes(String.raw`\mathrm{Re}\,\kappa_1\approx0.9496`))).toBe(true)
    expect(allTex.some((t) => t.includes(String.raw`\;\le\;\mathrm{Re}\,\kappa_1\;\le\;`))).toBe(true)
    expect(allTex.some((t) => t.includes(String.raw`\ \le\ \mathrm{Re}\,\kappa_1\ \le\ `))).toBe(true) // F-CS.14
    expect(allTex.filter((t) => t === String.raw`\lvert\kappa_{PHOS}\rvert\lesssim5\times10^{-3}`).length).toBeGreaterThanOrEqual(4)
    expect(allTex.some((t) => t.includes(String.raw`\lvert\kappa\rvert\lesssim`))).toBe(false)
    // 整頁沒有「複數 κ_1 ≈／≤ 實數」的寫法：把 Re κ_1 拿掉之後，不該再有 κ_1 後面接 ≈ 或 ≤
    for (const t of allTex) {
      const stripped = t.replace(/\\mathrm\{Re\}\s*\\,\s*\\kappa_\{?1\}?/g, 'ReK1')
      expect(stripped, t).not.toMatch(/\\kappa_\{?1\}?\s*(?:\\[;, ]\s*)*\\(?:approx|le)(?![a-z])/)
    }
    // R10 + C07 + R06b（§12）：有限步長要代整個複數；N_τ 是名義時間常數（精確的 e-folding 是 24.50／4.48 blocks）
    const s12 = proseText(sec('cs-12'))
    for (const frag of ['誤判成穩定', '§4.2 的推導就用到的兩個前提', '名義時間常數', '24.50', '4.48']) expect(s12, frag).toContain(frag)
    expect((-1 / Math.log(1 - 1 / 25)).toFixed(2)).toBe('24.50')
    expect((-1 / Math.log(1 - 1 / 5)).toFixed(2)).toBe('4.48')
    const tex12 = texIn(sec('cs-12'))
    for (const t of [String.raw`\lvert\kappa\rvert^2/(2N_\tau)=0.0086`, String.raw`\mathrm{Re}\,\kappa=0.0059`, String.raw`(\mathrm{Re}\,\kappa)^2/(2N_\tau)\approx7.0\times10^{-7}`, String.raw`0.8^5=0.328<1/e=0.368`, String.raw`-1/\ln\lvert1-1/N_\tau\rvert`])
      expect(tex12, t).toContain(t)
    // C07（§8.5 的「試試看」）：「每個 block 修掉 1/N_τ」除了沒有迴路，還要 8 個相位被選到的次數一樣多（κ = 1）
    expect(proseText(sec('cs-8'))).toContain('沒有迴路、8 個相位被選到的次數一樣多')
    expect(proseText(sec('cs-8'))).not.toContain('沒有迴路時 LMS 每個 block')
    // 實驗 B（預設 83.5 MHz = 167/8000，b = 1000）：精確週期的 GOS 列註明它除以實際的 var(ρ)，這裡兩列只差 1e-6
    const expBTex = texIn(container.querySelector(`#exp-${SIGNMAP_EXPERIMENT_ID}`) as HTMLElement)
    expect(expBTex).toContain(String.raw`\mathrm{var}(\rho)=0.083333`)
    expect(expBTex).toContain(String.raw`\tfrac{1}{12\,\mathrm{var}(\rho)}=1.0000`)
    expect(expBTex).toContain(String.raw`\mathrm{Re}\,\kappa_1`)
    expect(expBTex).not.toContain(String.raw`\kappa_1`)
    // 實驗 B 的說明：長條圖最右邊的 GOS 是固定乘 12 的 12·C_GOS（var(ρ) = 1/12 時才等於 κ_GOS），不再寫成沒有前提的「κ_GOS = 12C」
    const descB = container.querySelector(`#exp-${SIGNMAP_EXPERIMENT_ID} .c-exp-desc`) as HTMLElement
    expect(texIn(descB)).toEqual(expect.arrayContaining([String.raw`12\,C_{GOS}`, String.raw`\mathrm{var}(\rho)=\tfrac{1}{12}`, String.raw`\kappa_{GOS}`]))
    expect(texIn(descB)).not.toContain(String.raw`\kappa_{GOS}=12C`)
    // 系統地圖是手排的 SVG（不經過 Mermaid）：本章標成藍色的方塊恰好是 MAP_FOCUS
    const mapFigure = container.querySelector('figure.c-mermaid.c-sysmap') as HTMLElement
    expect(mapFigure).not.toBeNull()
    expect(Array.from(mapFigure.querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block')).sort()).toEqual([...MAP_FOCUS].sort())
    // 方塊圖（mermaid：每一張登錄的圖都送去畫，系統地圖除外）與圖表（plotly）
    await waitFor(() => expect(M.render.mock.calls.length).toBeGreaterThanOrEqual(DIAGRAMS.length))
    // 元件送進 mermaid 的是前處理過的原始碼（`$...$` 標籤合併成 Mermaid 的 `$$...$$`）
    const drawn = (M.render.mock.calls as unknown as [string, string][]).map((c) => c[1])
    expect(drawn[0]).toBe(sanitizeMermaidSource(DIAGRAMS[0].chart))
    for (const d of DIAGRAMS) expect(drawn, d.id).toContain(sanitizeMermaidSource(d.chart))
    await waitFor(() => {
      const names = traceNames()
      // 圖例名稱裡的公式已轉成 Plotly 的 pseudo-HTML：斜體符號與真正的上下標
      expect(names).toContain(plotMath('$\\mathrm{Re}\\,H_{\\mathrm{PD}}$（TS port，即時）'))
      expect(names.some((n) => /<i>H<\/i><sub>PD<\/sub>（TS port，即時）$/.test(n))).toBe(true)
      expect(names.some((n) => n.includes('golden JSON'))).toBe(true)
      expect(names.some((n) => n.startsWith('反號帶'))).toBe(true)
      expect(names).toContain(plotMath('$\\mathrm{Re}\\,\\kappa$（ergodic 諧波和）'))
      expect(names.some((n) => n.includes('<i>κ</i>（ergodic 諧波和）'))).toBe(true)
    })
    // 圖內數學：trace 名稱與軸標題都沒有殘留的 `$`、反斜線、大括號或純文字的上下標；公式確實轉成斜體符號與上下標
    const { names: plotNames, axisTitles } = plotTexts()
    expect(plotNames.length).toBeGreaterThan(10)
    for (const t of [...plotNames, ...axisTitles]) expect(t, t).not.toMatch(PLOT_TEXT_LEFTOVER)
    for (const t of [
      '$\\kappa$（$>0$ restoring；$<0$ 反號）',
      '$\\min(\\alpha,\\,1-\\alpha)\\cdot f_{\\mathrm{ref}}$ [MHz]',
      '$\\alpha\\cdot f_{\\mathrm{ref}}$ [MHz]',
      '$\\mathrm{Re}\\,H_{\\mathrm{PD}}$、$\\mathrm{Re}\\,\\Gamma_{\\mathrm{eff}}$',
      'block $k$（每 block $N$ 個 sample）',
    ])
      expect(axisTitles, t).toContain(plotMath(t))
    expect(axisTitles.some((t) => t.includes('<i>α</i>·<i>f</i><sub>ref</sub> [MHz]'))).toBe(true)
    for (const t of ['$|H_{\\mathrm{PD}}|$', '$\\Delta=T_{\\mathrm{vco}}/8$（DTC 範圍；之上為飽和／失鎖）', 'Case C：filtered-x（$\\hat H=H$）（golden 存檔）', '目前的 $\\alpha$：$\\kappa_{\\mathrm{PHOS}}$（TS port）'])
      expect(plotNames, t).toContain(plotMath(t))
    // 熱圖的類別名稱（y 軸）不經 applyPlotMath，元件自己用 plotMath 轉好
    const heat = (P.react.mock.calls as unknown as PlotlyCall[]).flatMap((c) => c[1] ?? []).find((d) => d.type === 'heatmap')
    expect(heat?.y).toContain(plotMath('大訊號 $\\kappa_\\infty$：ac'))
    expect(heat?.y).toContain(plotMath('GOS：$D=+1$'))
    expect(heat?.y?.length).toBeGreaterThanOrEqual(10)
    for (const label of heat?.y ?? []) expect(String(label), String(label)).not.toMatch(PLOT_TEXT_LEFTOVER)
    // 預設的實驗 B（L2、83.5 MHz、raw）顯示反號警告；實驗 C 在參數穩定後自動執行（inline worker）
    expect(screen.getAllByText(/PHOS 反號/).length).toBeGreaterThan(0)
    const expC = container.querySelector(`#exp-${LMS_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expC.textContent).toMatch(/Case A（raw）不收斂/), { timeout: 60000 })
    expect(expC.textContent).not.toMatch(/Case B（一階差分）不收斂/)
    // C07：實驗 C 的假設——開迴路每個 block 乘上 1 − 1/N_τ 的前提是 H ≡ 1 且 κ = 1（8 個相位被選到的次數一樣多）
    const assumeC = expC.querySelector('.c-assumption-list') as HTMLElement
    expect(assumeC.textContent).toContain('PMUX 的 8 個相位被選到的次數一樣多')
    expect(texIn(assumeC)).toEqual(expect.arrayContaining([String.raw`H\equiv1`, String.raw`\kappa=1`, String.raw`1-1/N_\tau`]))
    // R06b：小訊號預測的兩個前提（Bussgang、時間尺度分離）也列在實驗 C 的假設裡，並印出目前的 N·N_τ 對 h_PD 記憶長度的倍數（預設 512 × 25 ÷ 40 = 320）
    for (const frag of ['用到 §4.2 的兩個前提', '時間尺度分離', 'L2 的', '記憶長度（40 拍）', '照實際順序計算（先乘、再通過迴路）']) expect(assumeC.textContent, frag).toContain(frag)
    expect(texIn(assumeC)).toEqual(expect.arrayContaining([String.raw`N\cdot N_\tau=12800`, '320', String.raw`\lvert e_{PD}\rvert\ll\sigma_v`]))
    expect((LMS_DEFAULTS.nBlk * LMS_DEFAULTS.tauBlocks) / hpdMemorySamples(LOOPS[LMS_DEFAULTS.loop])).toBe(320)
    // 實驗 B 的 N_τ 控制項：前提寫在 hint（KaTeX），不是用 Unicode 塞在 reg 裡
    const hintsB = Array.from(container.querySelectorAll(`#exp-${SIGNMAP_EXPERIMENT_ID} .c-param-hint`))
    const nTauHint = hintsB.find((el) => (el.textContent ?? '').includes('每個 block 修掉誤差的')) as HTMLElement
    expect(nTauHint).toBeTruthy()
    expect(texIn(nTauHint)).toEqual([String.raw`H\equiv1`, String.raw`\kappa=1`, String.raw`1/N_\tau`])
  }, 120000)

  it('SSPLL: §15.4 殘餘誤差 → 輸出 spur／jitter——§10.5 的橋接句、圖、三條公式、單線表（−65 dBc）、PVT 角落表、F-CS.23 的數字、HC-CS.9、reference spur 的一句話', () => {
    const { container } = renderPage('/case/sspll', 'engineer')
    const s15 = container.querySelector('#cs-15') as HTMLElement
    const h3 = Array.from(s15.querySelectorAll('h3')).map((h) => h.textContent ?? '')
    expect(h3.some((t) => t.startsWith('15.4 校準完之後'))).toBe(true)
    expect(container.querySelector('#cs-15-4')).not.toBeNull()
    // §10.5 的橋接句（按鈕捲到 §15.4）
    const s10 = proseText(container.querySelector('#cs-10') as HTMLElement)
    expect(s10).toContain('校準完之後這些殘差在 PLL 輸出長什麼樣')
    expect(s10).toContain('§15.4 殘餘誤差 → 輸出 spur／jitter')
    // 圖在三條公式之前；公式錨點存在
    const fig = s15.querySelector('[data-diagram="output-spur"]') as HTMLElement
    expect(fig).not.toBeNull()
    for (const id of ['F-CS.21', 'F-CS.22', 'F-CS.23']) {
      const el = s15.querySelector(`[id="formula-${id}"]`) as HTMLElement
      expect(el, id).not.toBeNull()
      expect(fig.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBeTruthy()
    }
    const text = proseText(s15)
    const tex = texIn(s15)
    // 單線表：80 MHz 的 mode-1 基波約 −65.5 dBc（HC-CS.9 的預設）；|T(80 MHz)| = 1.2402；積分 jitter 註記
    expect(text).toContain('PHOS mode 1，')
    expect(text).toContain('1.2402')
    expect(text).toMatch(/−65\.[45]/)
    expect(text).toContain('單線公式（F-CS.21／F-CS.22）的前 7 條')
    // raw 的 28 ps 發散值代進單線公式：Φ ≈ 4.9 rad（不是 ≈ 1），而且 28 ps > Δ = 7.81 ps
    expect(tex).toContain('\\Phi\\approx4.9')
    expect(tex).toContain('\\Delta=7.81')
    expect(text).toContain('28 ps 已經超過 DTC 的範圍')
    // PVT 角落表：×0.6…×1.5，548 MHz 在 ×1.5 多 3.7 dB
    for (const g of ['0.6', '0.8', '1.25', '1.5']) expect(tex, g).toContain(`\\times${g}`)
    expect(text).toContain('+3.68')
    expect(text).toContain('在 gain ×1.5 時被多放進來 3.7 dB')
    // F-CS.23 的數字：每個模態 1.57 fs（小步長閉合式）、7 個合計 4.2 fs；1diff 的雜訊比例
    expect(tex.some((t) => t.includes('=1.57'))).toBe(true)
    expect(text).toContain('7 個合計 4.2 fs')
    expect(text).toContain('variance 條件的用法')
    expect(text).toContain('reference spur')
    expect(text).toContain('不在本頁範圍')
    // HC-CS.9 在 §15.4 裡、在思考題之前
    const hc9 = container.querySelector('#handcalc-HC-CS\\.9') as HTMLElement
    expect(hc9).not.toBeNull()
    expect(s15.contains(hc9)).toBe(true)
    expect(hc9.compareDocumentPosition(container.querySelector('#cs-16') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hc9.querySelectorAll('.c-step').length).toBeGreaterThanOrEqual(8)
    // Ch12 的公式連結（F-12.16、F-12.4）用 FormulaLink（不是 href="#…"）
    expect(s15.querySelector('[data-formula-link="F-12.16"]')).not.toBeNull()
    expect(s15.querySelector('[data-formula-link="F-12.4"]')).not.toBeNull()
    // 符號表多了 δ̂_m、Φ、S_m、σ_θ,m
    const symText = texIn(container.querySelector('#symbols') as HTMLElement).join('\n')
    for (const t of ['\\hat\\delta_m', '\\Phi', 'c[d],\\ S_m', '\\sigma_{\\theta,m}']) expect(symText, t).toContain(t)
    expect(s15.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    expect(text).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('SSPLL: Beginner 模式顯示入門四句話並收起程式碼；Research 模式顯示研究註記', () => {
    const a = renderPage('/case/sspll', 'beginner')
    expect(screen.getByText('入門模式：先抓住四句話')).toBeTruthy()
    // regressor 的核心程式碼並排在任何模式都顯示（使用者明確要求看核心程式碼）
    expect(a.container.querySelectorAll('.c-code-mark').length).toBeGreaterThanOrEqual(6)
    // 審查修正：Beginner 也看得到簡短的前提；細節（因式分解、有理數 β 的 var(ρ)）留給 Engineer
    const text = (id: string) => (a.container.querySelector(`#${id}`) as HTMLElement).textContent ?? ''
    for (const frag of ['只留一階', '0.03093']) expect(text('cs-2'), frag).toContain(frag)
    expect(text('cs-2')).not.toContain('斜率多乘')
    expect(text('cs-4')).toContain('記憶長度內幾乎不變')
    expect(text('cs-4')).toContain('次數一樣多時')
    expect(text('cs-4')).not.toContain('慢 30 倍以上')
    expect(text('cs-7')).toContain('去掉平均值之後')
    expect(text('cs-7')).not.toContain('折到 DC')
    expect(text('cs-8')).toContain('是複數；談正負時看實部')
    // §15.4：reference spur 與 fractional spur 的那一句話在主文（Beginner 也看得到），成立條件的細節留給 Engineer
    expect(text('cs-15')).toContain('reference spur')
    expect(text('cs-15')).toContain('不在本頁範圍')
    expect(text('cs-15')).not.toContain('成立條件（Engineer）')
    expect(text('cs-12')).toContain('名義時間常數')
    a.unmount()
    clearMockCalls()
    renderPage('/case/sspll', 'research')
    expect(screen.queryByText('入門模式：先抓住四句話')).toBeNull()
    expect(screen.getByText(/Research 註記/)).toBeTruthy()
  }, 120000)

  it('SSPLL: ?preset=sspll-l2-inband 載入實驗 B：84 MHz、raw ⇒ PHOS 反號；改 sspll-l2-1diff ⇒ 沒有反號警告', async () => {
    const a = renderPage('/case/sspll?preset=sspll-l2-inband')
    const expB = () => a.container.querySelector(`#exp-${SIGNMAP_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expB().textContent).toContain('=21/1000'))
    expect(expB().textContent).toMatch(/PHOS 反號：mode 1/)
    expect(expB().textContent).toMatch(/0\.13953/)
    // mode-1 的列寫成 Re κ_1，虛部另外標出（有限步長判據才用到）；沒有單獨的「κ_1」
    const texA = texIn(expB())
    expect(texA).toContain(String.raw`\mathrm{Re}\,\kappa_1`)
    expect(texA).toContain(String.raw`\mathrm{Im}\,\kappa_1=0.3116`)
    expect(texA).not.toContain(String.raw`\kappa_1`)
    expect(texA.some((t) => t.startsWith(String.raw`\mathrm{Re}\,\kappa=8\,\mathrm{Re}\,\lambda=-0.1395`))).toBe(true)
    expect(expB().textContent).toContain('−0.2053, −0.1355')
    a.unmount()
    clearMockCalls()
    const b = renderPage('/case/sspll?preset=sspll-l2-1diff')
    const expB2 = () => b.container.querySelector(`#exp-${SIGNMAP_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expB2().textContent).toContain('=21/1000'))
    expect(expB2().textContent).not.toMatch(/PHOS 反號/)
    expect(expB2().textContent).toContain('0.09836')
  }, 120000)

  it('SSPLL: ?preset=sspll-l1-nominal 載入實驗 A：L1 沒有反號帶，TS port 與 golden JSON 一致', async () => {
    const { container } = renderPage('/case/sspll?preset=sspll-l1-nominal')
    const expA = () => container.querySelector(`#exp-${HPD_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expA().textContent).toContain('無（整個頻帶的實部都不是負的）'))
    expect(expA().textContent).toContain('0.388836')
    expect(expA().querySelector('.c-check-ok')).not.toBeNull()
    expect(expA().querySelector('.c-check-mismatch')).toBeNull()
  }, 120000)

  it('SSPLL: 三個實驗的每一個 preset 都能載入——沒有 KaTeX 錯誤，也沒有非有限數字', async () => {
    const { container } = renderPage('/case/sspll', 'research')
    // 實驗 B 載入各個 preset 時出現過的 dead-zone 警告（TeX 原始碼）
    const deadZoneTex = new Set<string>()
    for (const id of [HPD_EXPERIMENT_ID, SIGNMAP_EXPERIMENT_ID, LMS_EXPERIMENT_ID]) {
      const exp = container.querySelector(`#exp-${id}`) as HTMLElement
      const select = exp.querySelector('.c-exp-presets select') as HTMLSelectElement
      const n = select.options.length - 1
      expect(n, id).toBeGreaterThanOrEqual(8)
      for (let i = 0; i < n; i++) {
        fireEvent.change(select, { target: { value: String(i) } })
        await waitFor(() => {
          expect(exp.querySelectorAll('.katex-error, .c-tex-error').length, `${id} preset ${i}`).toBe(0)
          expect(proseText(exp), `${id} preset ${i}`).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
        })
        const warn = id === SIGNMAP_EXPERIMENT_ID ? exp.querySelector('.c-exp-warnings') : null
        if (warn) for (const t of texIn(warn)) if (t.includes(String.raw`\le\tau`)) deadZoneTex.add(t)
      }
    }
    // dead zone 的警告寫的是 κ_PHOS（最差模態的實部），不是某個複數 κ 的模：sspll-l3-near-integer（L3、8 MHz）顯示 |κ_PHOS| = 2.06×10⁻⁵ ≤ τ
    expect([...deadZoneTex]).toContain(String.raw`\lvert\kappa_{PHOS}\rvert=2.06\times10^{-5}\le\tau`)
    for (const t of deadZoneTex) expect(t.startsWith(String.raw`\lvert\kappa_{PHOS}\rvert=`), t).toBe(true)
    // 載入過「L1 延遲 5 拍」：Type-I 也出現反號帶（實驗 A 最後停在 L3 ZOH）
    expect((container.querySelector(`#exp-${HPD_EXPERIMENT_ID}`) as HTMLElement).textContent).toMatch(/反號帶/)
  }, 180000)

  it('SSPLL: 實驗 C（inline worker）：自動執行後 raw 不收斂、1diff 與 filtered-x 收斂；再按「執行 Run」可重跑', async () => {
    const { container } = renderPage('/case/sspll?preset=sspll-cl-l2-inband')
    const expC = () => container.querySelector(`#exp-${LMS_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expC().textContent).toMatch(/Case A（raw）不收斂/), { timeout: 60000 })
    expect(expC().textContent).not.toMatch(/Case B（一階差分）不收斂/)
    expect(expC().textContent).not.toMatch(CASE_C_FX_DIVERGED)
    expect(expC().textContent).not.toMatch(/即時模擬尚未完成|即時模擬執行中/)
    // 小訊號預測（κ_PHOS 的符號）與閉迴路結果一致 → Analytic 為 ok；即時模擬與 golden 存檔在同一個 block 的 PHOS rms 相差不到 4 倍 → Monte Carlo 為 ok
    const cc = expC().querySelector('.c-exp-crosscheck') as HTMLElement
    expect(cc.querySelectorAll('.c-check-ok').length).toBe(2)
    expect(cc.querySelector('.c-check-mismatch')).toBeNull()
    expect(cc.textContent).toMatch(/3 個比對、0 個不一致/)
    expect(cc.textContent).toMatch(/3 個 case、0 個超出 4 倍/)
    // Fixed-Point 沒有實作：必須明確顯示
    expect(cc.textContent).toMatch(/Not implemented/)
    expect(expC().textContent).toMatch(/第 1400 block 的 PHOS rms，即時／golden 存檔的比值/)
    // §15.4：凍結後的 spur 表——閉合式 vs toneFit 在 0.2 dB 內（分析交叉比對的註記）；穩態 PHOS rms vs F-CS.23（1diff、fx 適用；raw 發散不比）；spur 表與線譜圖出現
    expect(cc.textContent).toMatch(/凍結後的 spur 表：\d+ 條線的閉合式 vs toneFit 最大差 0\.0\d* dB（門檻 0\.2；0 個 case 超出）/)
    expect(cc.textContent).toMatch(/穩態 PHOS rms vs F-CS\.23：2 個比對、0 個不一致/)
    const textC = expC().textContent ?? ''
    expect(textC).toContain('凍結後最強的 fractional spur（閉合式）')
    expect(textC).toContain('凍結後的輸出積分 jitter（時域 rms）')
    expect(textC).toContain('穩態 PHOS rms（block 750–1500')
    expect(textC).toContain('凍結後的 spur 表')
    // raw 發散（28 ps）：已有「不收斂」的警告，不再多一條 Φ ≥ 0.3 rad 的警告；spur 表裡 A 的 dBc 欄改印 Φ（小角 PM 不成立）
    expect(textC).toMatch(/Case A（raw）不收斂/)
    expect(textC).not.toMatch(/Case A（raw）凍結後最強的輸出 tone/)
    const spurTable = Array.from(expC().querySelectorAll('.cs-table caption')).find((c) => (c.textContent ?? '').includes('凍結後的 spur 表'))
    expect(spurTable).toBeTruthy()
    const spurRows = Array.from((spurTable!.parentElement as HTMLTableElement).querySelectorAll('tbody tr'))
    expect(spurRows.length).toBe(18) // 3 個 case × 6 條
    expect(spurRows[0].textContent).toMatch(/^A/)
    expect(texIn(spurRows[0] as HTMLElement).some((t) => /^\\Phi=\d/.test(t))).toBe(true)
    // 1diff（B）與 filtered-x（C）收斂：dBc 欄是「閉合式／toneFit」兩個數字，而且 toneFit 與閉合式在 0.2 dB 內；7 欄（A 欄是「單線／注入點」）
    for (const row of [spurRows[6], spurRows[12]]) {
      const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? '')
      expect(cells.length).toBe(7)
      const [closedS, fitS] = cells[6].split('／')
      const closed = Number(closedS.replace('−', '-'))
      const fit = Number(fitS.replace('−', '-'))
      expect(Number.isFinite(closed), cells.join('|')).toBe(true)
      expect(Number.isFinite(fit), cells.join('|')).toBe(true)
      expect(Math.abs(closed - fit)).toBeLessThanOrEqual(0.2)
      expect(closed).toBeLessThan(-40)
      const [aOutS, aFitS] = cells[5].split('／')
      expect(Math.abs(Number(aOutS) / Number(aFitS) - 1)).toBeLessThan(0.03)
      const [singleS, mergedS] = cells[3].split('／')
      expect(Number.isFinite(Number(singleS)) && Number.isFinite(Number(mergedS)), cells[3]).toBe(true)
      // A_out = |T| × 注入點 A（3 位小數的捨入）
      expect(Math.abs(Number(aOutS) - Number(cells[4]) * Number(mergedS)), cells.join('|')).toBeLessThan(2e-3 + 2e-3 * Number(aOutS))
    }
    // raw（A）發散：指標改報峰值相位 Φ（rad），不報 dBc
    expect(textC).toContain('凍結後最強的線的峰值相位')
    expect(textC).toContain('mode 1，')
    expect(proseText(expC())).not.toMatch(/NaN|undefined|Infinity/)
    // R09：指標註記裡 GOS 的小訊號預測是固定乘 12 的 12·C_GOS（ergodic），不標成 κ_GOS（= C_GOS/var(ρ)，小 Q 時兩者不同）
    const texC = texIn(expC())
    for (const t of [String.raw`12\,C_{GOS}=1.109`, String.raw`12\,C_{GOS}=1.158`, String.raw`12\,C_{GOS}=1.357`]) expect(texC, t).toContain(t)
    expect(texC.some((t) => t.startsWith(String.raw`\kappa_{GOS}=`))).toBe(false)
    expect(expC().textContent).toContain('ergodic，固定乘 12')
    await waitFor(() => {
      const names = traceNames()
      expect(names.some((n) => n.startsWith('Case A：raw（TS，即時）'))).toBe(true)
      expect(names.some((n) => n.startsWith('Case A：raw（golden 存檔）'))).toBe(true)
    })
    // 手動重跑
    const runBtn = await waitFor(() => {
      const b = Array.from(expC().querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('執行 Run'))
      expect(b).toBeTruthy()
      return b as HTMLElement
    })
    fireEvent.click(runBtn)
    await waitFor(() => expect(expC().textContent).toMatch(/Case A（raw）不收斂/), { timeout: 60000 })
  }, 180000)

  it('SSPLL: 實驗 C 加比較器 offset（?preset=sspll-cl-l2-offset）：raw 的共模漂移符合 forcing 公式；與 golden 存檔條件不同 ⇒ Monte Carlo 為 n/a', async () => {
    const { container } = renderPage('/case/sspll?preset=sspll-cl-l2-offset')
    const expC = () => container.querySelector(`#exp-${LMS_EXPERIMENT_ID}`) as HTMLElement
    await waitFor(() => expect(expC().textContent).toMatch(/Case A（raw）的 PHOS 共模漂移到/), { timeout: 60000 })
    const text = expC().textContent ?? ''
    // offset 的 forcing 要有解釋；zero-mean 的 case 不漂
    expect(text).toMatch(/與誤差無關的 forcing 項/)
    expect(text).not.toMatch(/Case B（zm（GOS、PHOS 都去平均））的 PHOS 共模漂移到/)
    expect(text).not.toMatch(/Case C（一階差分）的 PHOS 共模漂移到/)
    expect(text).toMatch(/Case A（raw）的 GOS 被比較器 offset 推偏/)
    // Analytic：共模漂移 vs B·μ_p·E[q]/8（三個 case 都比對）；Monte Carlo：條件與 golden 不同 ⇒ n/a，不疊 golden 軌跡
    const cc = expC().querySelector('.c-exp-crosscheck') as HTMLElement
    expect(cc.textContent).toMatch(/PHOS 共模漂移 vs forcing 公式/)
    expect(cc.textContent).toMatch(/3 個比對、0 個不一致/)
    expect(cc.querySelectorAll('.c-check-ok').length).toBe(1)
    expect(cc.querySelector('.c-check-mismatch')).toBeNull()
    expect(cc.textContent).toMatch(/沒有可比的參考/)
    expect(traceNames().some((n) => n.includes('golden 存檔'))).toBe(false)
    expect(proseText(expC())).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
  }, 180000)

  it('SSPLL: 內文引用的「試試看」數字與敘述一致——491.5 MHz 的大訊號、filtered-x 的 Type-I 模型、帶緣 127 MHz 的有限步長', async () => {
    // 491.5 MHz（α = 983/8000，1/8 正下方）：raw 的 κ∞ 明顯為負；L2 換 ac 仍略為負；1diff 為正；L1 換 ac 為正
    const ls = (loop: 'L1' | 'L2', v: string) => kappaInfWorst(largeSignalPeriodic(LOOPS[loop], 983, 8000, SIM_CFG, v))
    expect(ls('L2', 'raw')).toBeLessThan(-0.3)
    expect(ls('L2', 'ac')).toBeLessThan(-1e-3)
    expect(ls('L2', 'ac')).toBeGreaterThan(-0.1)
    expect(ls('L2', '1diff')).toBeGreaterThan(1e-3)
    expect(ls('L1', 'ac')).toBeGreaterThan(1e-3)
    expect(ls('L2', 'raw')).toBeCloseTo(SIGNMAP.L2.LSinf[mapIndex(491.5)], 3)
    expect(ls('L2', 'ac')).toBeCloseTo(SIGNMAP.L2.LSinf_ac[mapIndex(491.5)], 3)
    // filtered-x 的 Type-I 模型（L2、71.5 MHz）：K̂ = 0.1 已低於臨界值 0.1247——kernel 有負值，但 κ_PHOS 仍為正；K̂ = 0.05 才反號
    const fxI = (k: number) => analyseAlpha(LOOPS.L2, 71.5 / FREF_MHZ, 'fx:typeI', { typeI: makeL1({ K: k }) }).kappaPhos
    expect(fxI(0.2)).toBeGreaterThan(0.05)
    expect(fxI(0.1)).toBeGreaterThan(1e-3)
    expect(fxI(0.05)).toBeLessThan(-1e-2)
    expect(kernelMin(LOOPS.L2, 'fx:typeI', { typeI: makeL1({ K: 0.1 }) }).min).toBeLessThan(-1e-3)
    expect(kernelMin(LOOPS.L2, 'fx:typeI', { typeI: makeL1({ K: 0.13 }) }).min).toBeGreaterThan(-1e-12)
    // 帶緣 127 MHz：Re κ > 0，N_τ = 25 不穩定、50 穩定
    const e = analyseAlpha(LOOPS.L2, 127 / FREF_MHZ)
    const w = e.kappaM[e.worstMode - 1]
    expect(w.re).toBeGreaterThan(0)
    expect(w.re).toBeLessThan((w.re ** 2 + w.im ** 2) / 50)
    expect(w.re).toBeGreaterThan((w.re ** 2 + w.im ** 2) / 100)
    // 頁面上對應的文字
    const { container } = renderPage('/case/sspll', 'engineer')
    const text = proseText(container)
    expect(text).toMatch(/臨界值是「保證」的界線/)
    expect(text).toMatch(/Type-II 的 near-grid 只去平均還不夠/)
    // §11.2 的掃描表：K̂ = 0.12、0.1 沒有反號，0.05 在 54.5–87.5 MHz 反號
    const rows = Array.from(container.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''))
    const scanRow = (k: string) => rows.find((c) => c.length === 3 && c[0] === k && /@ [\d.]+ MHz$/.test(c[1]))
    expect(scanRow('0.12')?.[2]).toBe('無（全為正）')
    expect(scanRow('0.1')?.[2]).toBe('無（全為正）')
    expect(scanRow('0.05')?.[2]).toBe('54.5–87.5')
    expect(scanRow('0.05')?.[1]).toMatch(/^−0\.0153 @ 71\.5 MHz$/)
    // §11.1 的補充：L1 延遲 5 拍的 1diff margin 為負
    expect(text).toMatch(/1diff 也會反號/)
    // 內文與表格不出現 1e−5 這種寫法（一律 LaTeX）；共用 MetricTable 的數值欄（fmtNum）不在此限
    const noMetrics = container.cloneNode(true) as HTMLElement
    noMetrics.querySelectorAll('.c-code, .c-code-compare, annotation, .c-metric-table, .c-exp-metrics').forEach((el) => el.remove())
    expect(noMetrics.textContent ?? '').not.toMatch(/\de[−-]\d/)
  }, 120000)
})

describe('SSPLL 案例頁的公式登錄、presets 與實驗輔助函式', () => {
  it('SSPLL: FORMULAS——ID 唯一、格式 F-CS.n、頁面 /case/sspll、claim 合法', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(18)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-CS\.\d+$/)
      expect(f.page).toBe('/case/sspll')
      expect(['exact', 'approx', 'research']).toContain(f.claim)
      expect(f.tex.length).toBeGreaterThan(10)
      expect(f.conditions.length).toBeGreaterThan(5)
    }
  })

  it('SSPLL: FORMULAS 的 title／conditions——數學一律寫成 `$...$`（沒有 Unicode 拼的公式），以 mathText 渲染沒有 KaTeX 錯誤', () => {
    let withMath = 0
    for (const f of FORMULAS) {
      for (const [key, text] of [
        ['title', f.title],
        ['conditions', f.conditions],
      ] as const) {
        // `$...$` 以外的文字不含 Unicode 數學；`$` 成對
        const outside = text.replace(/\$[^$]*\$/g, '')
        expect(outside, `${f.id}.${key}`).not.toMatch(UNICODE_MATH)
        expect(outside, `${f.id}.${key}`).not.toContain('$')
        expect(text, `${f.id}.${key}`).not.toMatch(/[α-ωΑ-Ω²³⁻¹√≤≥≈≠∞]/)
        const n = (text.match(/\$[^$]*\$/g) ?? []).length
        withMath += n
        const { container, unmount } = render(<MathText>{text}</MathText>)
        expect(container.querySelectorAll('.katex').length, `${f.id}.${key}`).toBe(n)
        expect(container.querySelectorAll('.katex-error, .c-tex-error').length, `${f.id}.${key}`).toBe(0)
        unmount()
      }
    }
    expect(withMath).toBeGreaterThanOrEqual(50)
    // 幾個代表：條件裡的公式確實是 LaTeX
    const by = (id: string) => FORMULAS.find((f) => f.id === id)!
    expect(by('F-CS.2').conditions).toContain('$\\lvert e_{PD}\\rvert\\ll\\sigma_v$')
    expect(by('F-CS.6').conditions).toContain('$\\iff K(d-\\tfrac12)>1$')
    expect(by('F-CS.7').title).toContain('$\\mathrm{Re}\\,H_{PD}$')
    expect(by('F-CS.13').title).toContain('$8\\times8$')
  })

  it('SSPLL: 審查修正的公式登錄——F-CS.2／.11／.13／.14／.18 的式子與條件（frozen weight、var(ρ)、Re κ、名義時間常數）', () => {
    const by = (id: string) => FORMULAS.find((f) => f.id === id)!
    // R06b + C08：F-CS.2 的條件補上權重慢變與理想注入模型（原有的小訊號條件保留）
    const f2 = by('F-CS.2')
    for (const frag of ['記憶長度', '時間尺度分離', '$\\lvert e_{PD}\\rvert\\ll\\sigma_v$', '理想模型', '只留一階', '$a\\,w_g$']) expect(f2.conditions, frag).toContain(frag)
    // R09：κ_GOS = C_GOS/var(ρ)；「= 12 C_GOS」只在 var(ρ) = 1/12
    const f11 = by('F-CS.11')
    expect(f11.claim).toBe('exact')
    expect(f11.tex).not.toContain(String.raw`\frac{C_{GOS}}{\mathrm{var}(\rho)}=12\,C_{GOS}`)
    // 「= 12 C_GOS」這個等號帶著條件 var(ρ) = 1/12：用加長的等號（\xlongequal）把條件寫在上面，不和等號黏在一起
    expect(f11.tex).toContain(String.raw`\frac{C_{GOS}}{\mathrm{var}(\rho)}\ \xlongequal{\;\mathrm{var}(\rho)=1/12\;}\ 12\,C_{GOS}`)
    expect(f11.tex).not.toContain(String.raw`\overset`)
    for (const frag of [String.raw`\frac{b^2-1}{12b^2}`, String.raw`\frac{b^2}{b^2-1}\cdot12\,C_{GOS}`, '去掉平均值', String.raw`$\Gamma_{\rm eff}(0)=0$`, String.raw`$E[\rho^2]=\tfrac13$`, '4 個長週期']) expect(f11.conditions, frag).toContain(frag)
    // R10：κ_m 是複數；界限夾實部；有限步長用整個複數
    const f13 = by('F-CS.13')
    expect(f13.tex).toContain(String.raw`\kappa_m=8\lambda_m`)
    expect(f13.conditions).toContain(String.raw`\lambda_{8-m}=\overline{\lambda_m}`)
    expect(f13.conditions).toContain(String.raw`\mathrm{Re}\,\kappa_m`)
    const f14 = by('F-CS.14')
    expect(f14.claim).toBe('exact')
    expect(f14.tex).toContain(String.raw`\le\ \mathrm{Re}\,\kappa_1\ \le`)
    expect(f14.tex).not.toContain(String.raw`\le\ \kappa_1\ \le`)
    expect(f14.conditions).toContain(String.raw`\mathrm{Re}\,\kappa_1<0`)
    // C07 + R10：遞迴與不等式不變（對任何 N_τ > 0 精確）；N_τ 是名義時間常數。A7a：整條式子建立在 F-CS.2 的線性化平均模型上，所以標成近似
    const f18 = by('F-CS.18')
    expect(f18.claim).toBe('approx')
    expect(f18.tex).toBe(String.raw`\theta_{k+1}=\Big(1-\frac{\kappa}{N_\tau}\Big)\theta_k,\qquad\Big\lvert1-\frac{\kappa}{N_\tau}\Big\rvert<1\iff\mathrm{Re}\,\kappa>\frac{\lvert\kappa\rvert^2}{2N_\tau}`)
    for (const frag of ['名義時間常數', '$-1/\\ln\\lvert1-1/N_\\tau\\rvert$', '24.50', '4.48', String.raw`\mathrm{Im}\,\kappa`, String.raw`$N_\tau\equiv8/(\mu K_q)$`, '對任何 $N_\\tau>0$ 都精確']) expect(f18.conditions, frag).toContain(frag)
    expect(LMS_NOTE_ZH).toContain('名義時間常數')
    expect(LMS_NOTE_ZH).toContain('25 blocks')
    // 用語：SSPLL 頁（與顯示給讀者的 sspll.ts 註解）裡的「時間常數」只以「名義時間常數」出現——N_τ 是步長的倒數，不是精確的 e-folding 時間
    const dir = join(process.cwd(), 'src/pages/case-sspll')
    for (const f of ['formulas.ts', 'symbols.tsx', 'data.ts', 'sections/S04MeanUpdate.tsx', 'sections/S08Phos.tsx', 'sections/S11Remedies.tsx', 'sections/S12S13.tsx', 'sections/S14ClosedLoop.tsx', 'experiments/SignMapExplorer.tsx'])
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/(?<!名義)時間常數/)
    // sspll.ts：N_τ 只叫「名義時間常數」；§15.4 的 phosSteadyState 另外回傳最慢模態的「實際時間常數」−1/ln|p_m|（和 N_τ 對照，名字裡一定帶「實際」）
    expect(MODEL_SRC).not.toMatch(/(?<!名義|實際)時間常數/)
    expect(MODEL_SRC).toContain('最慢模態的實際時間常數')
    // 實驗 C 另外用到「模態的實際時間常數」（−1/ln ρ），所以只檢查 N_τ 的稱呼
    const cl = readFileSync(join(dir, 'experiments/ClosedLoopLms.tsx'), 'utf8')
    expect(cl).toContain('開迴路名義時間常數')
    expect(cl).not.toContain('開迴路時間常數')
    expect(cl).not.toMatch(/）時間常數/)
  })

  it('SSPLL: 比欄位寬的登錄公式拆成兩行（F-CS.12／.16／.17；1280px 的欄位放得下，不必橫向捲動）——內容與拆行前相同', () => {
    const by = (id: string) => FORMULAS.find((f) => f.id === id)!
    // [拆行處原本的分隔, 拆行前的整條式子]：兩行接回去必須一字不差
    const oneLine: Record<string, [string, string]> = {
      'F-CS.12': [String.raw`\ `, String.raw`C_{GOS}\approx\frac{\beta}{2}\big(S_\infty-2S_D\big)-\beta^2\sum_m m\,s[m]\ \Rightarrow\ \text{Type-I: }\frac{\beta}{2K};\quad \text{Type-II},\,D=0:\ \frac{\beta^2}{K_i};\quad \text{Type-II},\,D=1:\ -\beta`],
      'F-CS.16': [String.raw`\qquad `, String.raw`\mathrm{Re}\,\Gamma_{1d}=\frac{1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}}{\lvert1+L\rvert^2};\qquad \text{Type-II：}\ g(\Omega)=1-\frac{K_i}{2}-(1-K_p)\cos\Omega\ge0\iff K_i\le2K_p\ \text{且}\ K_p+\frac{K_i}{2}\le2`],
      'F-CS.17': [String.raw`\qquad `, String.raw`\Gamma_{fx}=H_{PD}\,\overline{\hat H_{PD}},\qquad \mathrm{Re}\,\Gamma_{fx}\ge0\iff\lvert\angle H_{PD}-\angle\hat H_{PD}\rvert\le90^\circ;\qquad \hat K>\frac{1}{K_p/K_i+\frac12}\ \ (\text{Type-I 模型配 Type-II 迴路})`],
    }
    for (const [id, [sep, want]] of Object.entries(oneLine)) {
      const f = by(id)
      const m = /^\\begin\{gathered\}([\s\S]*)\\end\{gathered\}$/.exec(f.tex)
      expect(m, id).not.toBeNull()
      const rows = m![1].split(String.raw`\\[4pt]`)
      expect(rows, id).toHaveLength(2)
      expect(rows.join(sep), id).toBe(want)
      expect(f.claim, id).toBe(id === 'F-CS.12' ? 'approx' : 'exact') // F-CS.12 是 β→0 的漸近式（A7a：標成近似）
      expect(f.conditions, id).not.toMatch(/右邊|左邊/) // 拆成上下兩行之後，條件裡不能再用「右邊的式子」指第二行
      const { container, unmount } = render(<MathText>{`$${f.tex}$`}</MathText>)
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length, id).toBe(0)
      unmount()
    }
    expect(by('F-CS.16').conditions).toContain('第二行（標著 Type-II）的 closed form 只適用 1 拍延遲的 Type-II（P + I）迴路')
  })

  it('SSPLL: 實驗 C 的 GOS 預測值標成 12·C_GOS（固定乘 12），不標成 κ_GOS；「每個 block 乘上 1 − 1/N_τ」都帶著 κ = 1 的前提', () => {
    const dir = join(process.cwd(), 'src/pages/case-sspll')
    const cl = readFileSync(join(dir, 'experiments/ClosedLoopLms.tsx'), 'utf8')
    // R09：analyseAlpha().kappaGos 是 12·C_GOS（ergodic）。指標註記與兩個 GOS 警告都照這個名字印，沒有「κ_GOS = 數字」
    expect(cl).not.toMatch(/\\\\kappa_\{GOS\}=\$\{/)
    expect((cl.match(/12\\\\,C_\{GOS\}=\$\{/g) ?? []).length).toBe(3)
    expect(cl).toContain('gosOffsetBias(c.pred.kappaGos / 12, 0.5, P.uOsFs, sigmaFs)') // offset 偏差用的 C_GOS = 12C/12：精確，不受標籤影響
    // 審查的反例（L2、250 MHz、raw：α = 1/16、β = 1/2）：實驗 C 印 12C = 0.886，而定義上的 κ_GOS = C_GOS/var(ρ) = 1.1812（4/3 倍）
    const erg = analyseAlpha(LOOPS.L2, 1 / 16, 'raw', undefined, 2048).kappaGos // 實驗 C 的諧波和取 2048 項
    expect(txs(erg, 4)).toBe('0.886')
    const ex = kappaRational(LOOPS.L2, 1, 16)
    expect(ex.kG.toPrecision(5)).toBe('1.1812')
    expect(ex.kG / erg).toBeCloseTo(4 / 3, 3)
    expect(12 * ex.kG * ex.varRho).toBeCloseTo(erg, 3) // 同一個 C_GOS，只差正規化
    // 預設的 80 MHz（α = 1/50，β = 4/25，b = 25）：12C = 1.109、κ_GOS = 1.110，只差 b²/(b² − 1) = 1.0016
    const erg80 = analyseAlpha(LOOPS.L2, 0.02, 'raw', undefined, 2048).kappaGos
    expect(txs(erg80, 4)).toBe('1.109')
    expect(kappaRational(LOOPS.L2, 1, 50).kG / erg80).toBeCloseTo(625 / 624, 3)
    // C07：N_τ 的「每個 block 乘上 1 − 1/N_τ」只在 H ≡ 1 且 κ = 1（8 個相位被選到的次數相同）時成立——頁面上每一處都寫出這個前提
    expect(cl).toContain('開迴路（$H\\\\equiv1$、$\\\\kappa=1$，也就是 PMUX 的 8 個相位被選到的次數一樣多）每個 block 把 PHOS 誤差乘上 $1-1/N_\\\\tau$')
    expect(cl).not.toContain('開迴路（$H\\\\equiv1$）每個 block')
    const s8 = readFileSync(join(dir, 'sections/S08Phos.tsx'), 'utf8')
    expect(s8).toContain('沒有迴路、8 個相位被選到的次數一樣多（<Tex>{r`H\\equiv1`}</Tex>、<Tex>{r`\\kappa=1`}</Tex>）時 LMS 每個 block 修掉誤差的')
    // 實驗 B 的 N_τ 控制項：說明放在 hint（LaTeX），reg 只留硬體名稱——不再把 H ≡ 1、1/N_τ 這些數學用 Unicode 塞在 reg 裡
    const sm = readFileSync(join(dir, 'experiments/SignMapExplorer.tsx'), 'utf8')
    expect(sm).toContain("hint={mathText('$H\\\\equiv1$、$\\\\kappa=1$（8 個相位被選到的次數一樣多）時，每個 block 修掉誤差的 $1/N_\\\\tau$（§12）')}")
    expect(sm).not.toMatch(/reg="[^"]*[≡τκ][^"]*"/)
    expect(extractRegion(MODEL_SRC, 'blockMeanStable')).toContain('H ≡ 1、κ = 1（8 相被選到的次數相同）時每個 block 誤差乘上 1 − 1/N_τ')
    expect(FORMULAS.find((f) => f.id === 'F-CS.18')!.conditions).toContain(String.raw`開迴路（$H\equiv1$、$\kappa=1$）時每個 block 把誤差乘上 $1-1/N_\tau$`)
  })

  it('SSPLL: 分析文件與頁面用同一套 κ 記號——逐模態的列表寫成 Re κ_m、最差值寫成 κ_PHOS（文件 §0.4、§8.4(a)、§15）', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/analysis/sspll-gos-phos-polarity.md'), 'utf8')
    // 「κ_{1..4} = …」「κ_{2..4} …」這種逐模態的列表都是實部（κ_m 是複數）：前面一定有 \mathrm{Re}\,
    const listed = [...doc.matchAll(/(\\mathrm\{Re\}\\,)?\\kappa_\{\d\.\.\d\}/g)]
    expect(listed.length).toBeGreaterThanOrEqual(3)
    for (const m of listed) expect(m[1], doc.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 40)).toBe(String.raw`\mathrm{Re}\,`)
    // §8.4(a)：L2、15.6 MHz（α = 1/256）的四個數字是 kappaRational 的實部；m1–m3 的虛部不是 0，所以不能寫成「κ = 實數」
    expect(doc).toContain(String.raw`$\mathrm{Re}\,\kappa_{1..4}=+0.00043,\ +0.00001,\ -0.00253,\ -0.0042$`)
    const km = kappaRational(LOOPS.L2, 1, 256).km
    const want = [0.00043, 0.00001, -0.00253, -0.0042]
    want.forEach((v, i) => expect(Math.abs(km[i].re - v), `m${i + 1}`).toBeLessThan(1e-5))
    for (const i of [0, 1, 2]) expect(Math.abs(km[i].im), `m${i + 1}`).toBeGreaterThan(3e-4) // −0.00043j、−0.00209j、−0.00254j
    expect(Math.abs(km[3].im)).toBeLessThan(1e-12) // mode 4 是實數
    // 頁面 §8.4(a) 的同一句（S08Phos.tsx）也是 Re κ_{1..4}
    expect(readFileSync(join(process.cwd(), 'src/pages/case-sspll/sections/S08Phos.tsx'), 'utf8')).toContain('\\\\mathrm{Re}\\\\,\\\\kappa_{1..4}=')
    // §0.4 的總表與 §15 的檢查清單：最差模態的實部記作 κ_PHOS（和頁面 §0 的表相同），不寫成沒有下標的 κ
    expect(doc).toContain(String.raw`最差 $\kappa_{PHOS}=-0.1397$ @ 83.0 MHz`)
    expect(doc).toContain(String.raw`$\kappa_{PHOS}=+1.06$`)
    expect(doc).not.toMatch(/最差 \$\\kappa=/)
    expect(kappaRational(LOOPS.L2, 85, 4096).kP.toFixed(4)).toBe('-0.1397') // 85/4096 × 4000 = 83.0 MHz
    expect(((85 / 4096) * FREF_MHZ).toFixed(1)).toBe('83.0')
    expect(analyseAlpha(LOOPS.L2, 0.137).kappaPhos.toFixed(2)).toBe('1.06') // = Re κ_1（κ_1 = 1.0647 + 0.4169j）
    expect(readFileSync(join(process.cwd(), 'src/pages/case-sspll/sections/S00Conclusion.tsx'), 'utf8')).toContain('\\\\kappa_{PHOS}=')
  })

  it('SSPLL: 內文引用的審查修正數字由 TS port 重現——h_PD 的記憶長度 14／40／49 拍、實驗 B 的 GOS 註記', () => {
    // §4.2：Σ|h_PD| 的 99.9% 落在前 14／40／49 拍；預設的 LMS（512 × 25 拍，除以 Re κ ≤ max Re H_PD）慢 200 倍以上
    expect((['L1', 'L2', 'L3'] as const).map((k) => hpdMemorySamples(LOOPS[k]))).toEqual([14, 40, 49])
    expect(hpdMemorySamples(makeL1({ K: 1 }))).toBe(2) // h_PD = [1, −1]：兩拍
    // 實驗 B 的「精確週期」GOS 列：α = 1/16（250 MHz，β = 1/2）⇒ var(ρ) = 1/16，κ_GOS = 1.1812 是 12C = 0.88592 的 4/3 倍
    const r16 = kappaRational(LOOPS.L2, 1, 16)
    const n16 = gosExactNote(r16.varRho, r16.kG)
    for (const frag of [String.raw`$\mathrm{var}(\rho)=0.062500$`, '$0.88592$', String.raw`$\tfrac{1}{12\,\mathrm{var}(\rho)}=1.3333$`]) expect(n16, frag).toContain(frag)
    expect(r16.kG.toPrecision(5)).toBe('1.1812')
    expect(analyseAlpha(LOOPS.L2, 1 / 16).kappaGos.toPrecision(5)).toBe('0.88595') // ergodic 列（級數截在 8192 項：與 0.88592 差 3e-5）
    // α = 1/64（62.5 MHz，b = 8）：多 1.6%
    const r64 = kappaRational(LOOPS.L2, 1, 64)
    const n64 = gosExactNote(r64.varRho, r64.kG)
    for (const frag of ['0.082031', '$1.08090$', '=1.0159$']) expect(n64, frag).toContain(frag)
    // 預設 83.5 MHz（b = 1000）：兩列只差 1e-6
    const r835 = kappaRational(LOOPS.L2, 167, 8000)
    for (const frag of ['0.083333$', '$1.10511$', '=1.0000$']) expect(gosExactNote(r835.varRho, r835.kG), frag).toContain(frag)
    const { container, unmount } = render(<MathText>{n16}</MathText>)
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    expect(container.querySelectorAll('.katex').length).toBe((n16.match(/\$[^$]*\$/g) ?? []).length) // 每一段 `$...$` 都渲染成 KaTeX
    expect((n16.match(/\$[^$]*\$/g) ?? []).length).toBe(6)
    unmount()
  })

  it('SSPLL: 實驗 C 的 case 標籤——警告／指標／表格用 `$...$` 版（KaTeX），下拉選單與 Plotly 圖例用純文字版', () => {
    const kinds = Object.keys(LMS_CASE_LABEL) as LmsCaseKind[]
    expect(Object.keys(LMS_CASE_TEX)).toEqual(kinds)
    for (const k of kinds) {
      expect(LMS_CASE_LABEL[k], k).not.toContain('$') // <option> 與圖例不渲染 KaTeX
      if (k !== 'fx' && k !== 'D1') expect(LMS_CASE_TEX[k], k).toBe(LMS_CASE_LABEL[k])
      expect(LMS_CASE_TEX[k].replace(/\$[^$]*\$/g, ''), k).not.toMatch(UNICODE_MATH)
      const { container, unmount } = render(<MathText>{lmsCaseTag('A', k)}</MathText>)
      expect(container.querySelectorAll('.katex-error, .c-tex-error').length, k).toBe(0)
      unmount()
    }
    expect(lmsCaseTag('C', 'fx')).toBe('Case C（filtered-x（$\\hat H=H$））')
    expect(lmsCaseTag('B', 'D1')).toBe('Case B（$D=+1$（有害））')
    expect(lmsCaseTag('B', '1diff')).toBe('Case B（一階差分）')
    // 頁面測試用來確認「Case C 沒有發散」的 regex，真的對得上這個警告渲染之後的文字
    const { container } = render(<MathText>{`${lmsCaseTag('C', 'fx')}不收斂：PHOS 誤差 rms 由 1 fs 變成 2 fs。`}</MathText>)
    expect(container.querySelectorAll('.katex').length).toBe(1)
    expect(container.textContent).toMatch(CASE_C_FX_DIVERGED)
    expect(`${lmsCaseTag('B', '1diff')}不收斂`).not.toMatch(CASE_C_FX_DIVERGED)
  })

  it('SSPLL: presets——四個指定的 preset 存在、指向本頁的實驗，expected 的數字由 TS port 重現', () => {
    const want: Record<string, string> = {
      'sspll-l2-inband': SIGNMAP_EXPERIMENT_ID,
      'sspll-l2-1diff': SIGNMAP_EXPERIMENT_ID,
      'sspll-l1-nominal': HPD_EXPERIMENT_ID,
      'sspll-l3-near-integer': SIGNMAP_EXPERIMENT_ID,
      'sspll-cl-l2-inband': LMS_EXPERIMENT_ID,
      'sspll-cl-l2-offset': LMS_EXPERIMENT_ID,
    }
    for (const [id, exp] of Object.entries(want)) {
      const p = presetById(id)
      expect(p, id).toBeTruthy()
      expect(p!.page).toBe('/case/sspll')
      expect(p!.experiment).toBe(exp)
      expect(p!.source).toBe('simulation')
    }
    expect(presetsForExperiment(SIGNMAP_EXPERIMENT_ID).length).toBe(3)
    // sspll-l2-inband：α·f_ref = 84 MHz、raw ⇒ 反號
    const inband = mergeSignParams(SIGN_DEFAULTS, presetById('sspll-l2-inband')!.params)
    expect(inband).toMatchObject({ loop: 'L2', fMHz: 84, mode: 'raw' })
    const sa = modeSetup(inband.loop, inband.mode, inband.kHat)
    const a = analyseAlpha(sa.loop, inband.fMHz / FREF_MHZ, sa.variant, sa.models)
    expect(a.kappaPhos).toBeCloseTo(-0.13953, 5)
    expect(a.kappaM[0].im).toBeCloseTo(0.3116, 4) // preset 的 expected 寫的 κ_1 = −0.1395 + 0.3116j
    expect(presetById('sspll-l2-inband')!.expected).toContain('Re κ_1 = 8Re λ_1 = −0.13953')
    expect(presetById('sspll-l2-inband')!.expected).toContain('κ_1 = −0.1395 + 0.3116j')
    expect(a.worstMode).toBe(1)
    expect(a.kappaM[1].re).toBeCloseTo(0.4006, 4)
    expect(a.kappaM[2].re).toBeCloseTo(0.83, 3)
    expect(a.kappaM[3].re).toBeCloseTo(0.9439, 4)
    expect(a.singleLine).toBeCloseTo(-0.19495, 5)
    expect(a.m1Upper).toBeCloseTo(-0.1355, 4)
    expect(a.kappaGos).toBeCloseTo(1.105, 4)
    expect(classify(a.kappaPhos, 1e-3)).toBe('inverted')
    expect(kappaInfWorst(largeSignalPeriodic(sa.loop, 21, 1000, SIM_CFG, 'raw'))).toBeCloseTo(-0.5656, 4)
    // sspll-l2-1diff：同一個 α、一階差分 ⇒ 安全
    const d1 = mergeSignParams(SIGN_DEFAULTS, presetById('sspll-l2-1diff')!.params)
    expect(d1).toMatchObject({ loop: 'L2', fMHz: 84, mode: '1diff' })
    const sb = modeSetup(d1.loop, d1.mode, d1.kHat)
    const b = analyseAlpha(sb.loop, d1.fMHz / FREF_MHZ, sb.variant, sb.models)
    expect(b.kappaPhos).toBeCloseTo(0.09836, 5)
    expect(b.kappaM[1].re).toBeCloseTo(0.3936, 4)
    expect(b.kappaGos).toBeCloseTo(1.1867, 4)
    expect(b.m1Lower).toBeCloseTo(0.0399, 4)
    expect(classify(b.kappaPhos, 1e-3)).toBe('restoring')
    expect(kappaRational(sb.loop, 21, 1000, '1diff').kJ).toBeCloseTo(0.09836, 5)
    expect(kappaInfWorst(largeSignalPeriodic(sb.loop, 21, 1000, SIM_CFG, '1diff'))).toBeCloseTo(0.139, 3)
    expect(oneDiffMargin(LOOPS.L2).min).toBeCloseTo(0.2686, 4)
    // sspll-l1-nominal
    const l1 = mergeHpdParams(HPD_DEFAULTS, presetById('sspll-l1-nominal')!.params)
    const lp = buildHpdLoop(l1)
    expect(Number(lp.params.K)).toBeCloseTo(0.388836, 6)
    expect(loopMargins(lp).pmDeg).toBeCloseTo(78.79, 2)
    expect(loopF3dB(lp) * FREF_MHZ).toBeCloseTo(320, 6)
    expect(inversionBands(lp)).toEqual([])
    expect(0.5 * Number(lp.params.K)).toBeCloseTo(0.1944, 4)
    expect(oneDiffMargin(lp).min).toBeCloseTo(0.3888, 4)
    // sspll-l3-near-integer
    const l3 = mergeSignParams(SIGN_DEFAULTS, presetById('sspll-l3-near-integer')!.params)
    expect(l3).toMatchObject({ loop: 'L3', fMHz: 8, mode: 'raw' })
    const c = analyseAlpha(LOOPS.L3, l3.fMHz / FREF_MHZ)
    expect(c.kappaPhos * 1e5).toBeCloseTo(-2.06, 2)
    expect(classify(c.kappaPhos, 1e-3)).toBe('dead')
    expect(c.singleLine).toBeCloseTo(-0.00596, 5)
    expect(c.kappaGos).toBeCloseTo(0.1235, 4)
    expect(kappaRational(LOOPS.L3, 1, 500).kP * 1e5).toBeCloseTo(-2.07, 2)
    expect(kappaInfWorst(largeSignalPeriodic(LOOPS.L3, 1, 500, SIM_CFG, 'raw'))).toBeCloseTo(-0.841, 3)
    expect(analyseAlpha(LOOPS.L3, l3.fMHz / FREF_MHZ, '1diff').kappaPhos).toBeCloseTo(0.0094, 4)
    expect(PRED.lms['L3|0.002|raw'].final_phos_rms_fs / 1000).toBeCloseTo(11.6, 1)
    expect(PRED.lms['L3|0.002|1diff'].final_phos_rms_fs).toBeCloseTo(22, 0)
    // sspll-cl-l2-inband：golden 存檔與小訊號預測
    const cl = mergeLmsParams(LMS_DEFAULTS, presetById('sspll-cl-l2-inband')!.params)
    expect(cl).toMatchObject({ loop: 'L2', fMHz: 80, caseA: 'raw', caseB: '1diff', caseC: 'fx', nBlocks: 1500 })
    expect(PRED.lms['L2|0.02|raw'].final_phos_rms_fs / 1000).toBeCloseTo(28.4, 1)
    expect(PRED.lms['L2|0.02|raw'].phos_rms_med_fs[3] / 1000).toBeCloseTo(1.83, 2)
    expect(PRED.lms['L2|0.02|1diff'].final_phos_rms_fs).toBeCloseTo(6.2, 1)
    expect(PRED.lms['L2|0.02|fx:exact'].final_phos_rms_fs).toBeCloseTo(4.4, 1)
    expect(analyseAlpha(LOOPS.L2, 0.02).kappaPhos).toBeCloseTo(-0.138, 3)
    expect(analyseAlpha(LOOPS.L2, 0.02, '1diff').kappaPhos).toBeCloseTo(0.091, 3)
    // sspll-cl-l2-offset
    const off = mergeLmsParams(LMS_DEFAULTS, presetById('sspll-cl-l2-offset')!.params)
    expect(off).toMatchObject({ fMHz: 548, uOsFs: 25, caseB: 'zm', caseC: '1diff' })
    expect(PRED.offset_lms['L2|0.137|u=25|raw'].gos_fs).toBeCloseTo(133, 0)
    expect(PRED.offset_lms['L2|0.137|u=25|raw'].phos_cm_fs / 1000).toBeCloseTo(3.9, 1)
    expect(PRED.offset_lms['L2|0.137|u=25|zm'].gos_fs).toBeCloseTo(2.8, 1)
    expect(PRED.offset_lms['L2|0.137|u=25|1diff'].gos_fs).toBeCloseTo(7.4, 1)
    // 本頁的即時模擬（1500 blocks、seed 3）：raw 的共模約 1.4–1.5 ps（公式 1.50 ps）、GOS 偏差約 0.13–0.15 ps；zm 的共模為 0
    const offRaw = runSspllLms({ loop: LOOPS.L2, alpha: 548 / FREF_MHZ, variant: 'raw', cfg: SIM_CFG, nBlocks: off.nBlocks, nBlk: off.nBlk, tauBlocks: off.tauBlocks, seed: 3, recEvery: 10, lanes: off.lanes, uOsPs: off.uOsFs / 1000 })
    const dOff = predictCmDrift('raw', offRaw.muP, off.uOsFs, 200, off.nBlocks, off.nBlk)
    expect(dOff.predFs / 1000).toBeCloseTo(1.5, 2)
    expect(offRaw.finalPhosCmFs / 1000).toBeGreaterThan(1.4)
    expect(offRaw.finalPhosCmFs / 1000).toBeLessThan(1.5)
    expect(Math.abs(offRaw.finalPhosCmFs - dOff.predFs)).toBeLessThan(dOff.tolFs)
    expect(offRaw.finalGosFs).toBeGreaterThan(130)
    expect(offRaw.finalGosFs).toBeLessThan(150)
    const offZm = runSspllLms({ loop: LOOPS.L2, alpha: 548 / FREF_MHZ, variant: 'zm', cfg: SIM_CFG, nBlocks: off.nBlocks, nBlk: off.nBlk, tauBlocks: off.tauBlocks, seed: 3, recEvery: 10, lanes: off.lanes, uOsPs: off.uOsFs / 1000 })
    expect(offZm.finalPhosCmFs).toBeLessThan(1e-6)
    expect(offZm.finalGosFs).toBeLessThan(20)
    // sspll-cl-l2-inband：第 1400 block 即時模擬與 golden 軌跡相差不到 10%
    const inRaw = runSspllLms({ loop: LOOPS.L2, alpha: 0.02, variant: 'raw', cfg: SIM_CFG, nBlocks: cl.nBlocks, nBlk: cl.nBlk, tauBlocks: cl.tauBlocks, seed: 3, recEvery: 10, lanes: cl.lanes })
    const cmpIn = compareWithGolden(inRaw, PRED.lms['L2|0.02|raw'])!
    expect(cmpIn.block).toBe(1400)
    expect(Math.abs(cmpIn.ratio - 1)).toBeLessThan(0.1)
  })

  it('SSPLL: 實驗 A 的輔助函式——參數合併、迴路建立、closed form 帶緣', () => {
    expect(mergeHpdParams(HPD_DEFAULTS, null)).toBe(HPD_DEFAULTS)
    expect(mergeHpdParams(HPD_DEFAULTS, { loop: 'L9', bwMHz: 1e9, lat: 2.4, mapping: 'bogus' })).toMatchObject({ loop: 'L2', bwMHz: 320, lat: 2, mapping: 'impulse' })
    const l2 = buildHpdLoop(HPD_DEFAULTS)
    expect(closedFormEdgeMHz(HPD_DEFAULTS, l2)).toBeCloseTo(134.82, 2)
    expect(closedFormEdgeMHz(HPD_DEFAULTS, l2)).toBeCloseTo(inversionBands(l2)[0].fHi * FREF_MHZ, 6)
    const p3 = { ...HPD_DEFAULTS, loop: 'L3' as const }
    const l3 = buildHpdLoop(p3)
    expect(closedFormEdgeMHz(p3, l3)).toBeCloseTo(117.278, 3)
    expect(closedFormEdgeMHz({ ...p3, mapping: 'zoh' }, buildHpdLoop({ ...p3, mapping: 'zoh' }))).toBeNull()
    expect(closedFormEdgeMHz({ ...HPD_DEFAULTS, loop: 'L1' }, buildHpdLoop({ ...HPD_DEFAULTS, loop: 'L1' }))).toBeNull()
    // PVT：gain ×1.5 不重新設計
    const g = buildHpdLoop({ ...HPD_DEFAULTS, gainScale: 1.5 })
    expect(inversionBands(g)[0].fHi * FREF_MHZ).toBeCloseTo(172.73, 2)
    // L1 延遲 5 拍：出現反號帶
    expect(inversionBands(buildHpdLoop({ ...HPD_DEFAULTS, loop: 'L1', lat: 5 })).length).toBe(1)
    // 手動 Kp、Ki
    const man = buildHpdLoop({ ...HPD_DEFAULTS, manual: true, Kp: 0.3, Ki: 0.05 })
    expect(man.params).toMatchObject({ Kp: 0.3, Ki: 0.05 })
    // golden 格點與 TS port 的格點一致
    expect(HPD.L2.f_MHz.length).toBe(1500)
    expect(HPD.L2.f_MHz[HPD.L2.f_MHz.length - 1]).toBe(2000)
  })

  it('SSPLL: 實驗 B／C 的輔助函式——模式對應、分類、signmap 索引、golden 軌跡', () => {
    expect(classify(-0.01, 1e-3)).toBe('inverted')
    expect(classify(5e-4, 1e-3)).toBe('dead')
    expect(classify(0.2, 1e-3)).toBe('restoring')
    expect(modeSetup('L2', 'ponly', 0.1).loop.type).toBe(1)
    expect(modeSetup('L2', 'ponly', 0.1).colP).toBe('kP_Ponly')
    expect(modeSetup('L1', 'ponly', 0.1).colP).toBe('kP')
    expect(modeSetup('L2', 'fxTypeI', 0.2).models?.typeI.params.K).toBe(0.2)
    expect(modeSetup('L3', 'D1', 0.1).variant).toBe('D:1')
    expect(mergeSignParams(SIGN_DEFAULTS, { alpha: 0.25, mode: 'nope', tau: 0.5 })).toMatchObject({ fMHz: 1000, mode: 'raw', tau: 1e-3 })
    expect(mapIndex(83.5)).toBe(83)
    expect(mapIndex(4000 - 83.5)).toBe(83)
    expect(SIGNMAP.L2.f_MHz[mapIndex(83.5)]).toBe(83.5)
    expect(SIGNMAP.L1.kP_Ponly).toBeNull()
    // 閉迴路
    expect(lmsCaseSetup('L2', 'off')).toBeNull()
    expect(lmsCaseSetup('L2', 'ponly-raw')?.loop.type).toBe(1)
    expect(lmsCaseSetup('L3', 'fx')?.variant).toBe('fx:exact')
    expect(goldenTrace('L2', 0.02, 'raw')?.key).toBe('L2|0.02|raw')
    expect(goldenTrace('L2', 0.02, 'raw|Ponly')?.key).toBe('L2|0.02|raw|Ponly')
    expect(goldenTrace('L2', 0.021, 'raw')).toBeNull()
    expect(goldenTrace('L2', 0.02, null)).toBeNull()
    expect(mergeLmsParams(LMS_DEFAULTS, { nBlocks: 1e9, lanes: 2.2, caseB: 'zm', uOsFs: 9999 })).toMatchObject({ nBlocks: 1500, lanes: 2, caseB: 'zm', uOsFs: 0 })
  })

  it('SSPLL: 實驗 C 的交叉比對輔助函式——與 golden 軌跡在同一個 block 比較；offset 的共模漂移公式；signmap 區間', () => {
    // compareWithGolden：取 golden 有記錄、且不超過即時模擬長度的最後一個 block
    const trace = PRED.lms['L2|0.02|raw']
    const live = { block: Float64Array.from([0, 7, 14, 196, 203, 399, 406, 500]), phosRmsFs: Float64Array.from([173, 180, 190, 500, 520, 1000, 1010, 1300]) }
    const c = compareWithGolden(live, trace)!
    expect(c.block).toBe(400)
    expect(c.liveFs).toBe(1000) // 最接近 400 的記錄點是 399
    expect(c.goldenFs).toBe(trace.phos_rms_med_fs[trace.blocks.indexOf(400)])
    expect(c.ratio).toBeCloseTo(1000 / c.goldenFs, 12)
    expect(compareWithGolden({ block: Float64Array.from([0, 50, 100]), phosRmsFs: Float64Array.from([173, 170, 160]) }, trace)).toBeNull() // 不到 200 blocks
    expect(GOLDEN_LMS_COND).toEqual({ nBlk: 512, tauBlocks: 25, uOsFs: 0 })
    // 真的跑一次 TS 的閉迴路 LMS：與 golden 存檔在第 400 block 的 PHOS rms 相差不到容許倍率（raw 發散的成長率是決定性的，其實在 10% 以內）
    const r = runSspllLms({ loop: LOOPS.L2, alpha: 0.02, variant: 'raw', cfg: SIM_CFG, nBlocks: 400, nBlk: 512, tauBlocks: 25, seed: 5, recEvery: 10, lanes: 2 })
    const cmp = compareWithGolden(r, trace)!
    expect(cmp.block).toBe(400)
    expect(cmp.ratio).toBeGreaterThan(1 / LMS_MC_RATIO_TOL)
    expect(cmp.ratio).toBeLessThan(LMS_MC_RATIO_TOL)
    expect(Math.abs(Math.log(cmp.ratio))).toBeLessThan(0.15)
    // regressor 的 DC：決定 offset 的 forcing
    expect(['raw', 'ac', 'D:1'].map(phosRegressorSum)).toEqual([1, 1, 1])
    expect(['zm', '1diff', '2diff', 'fx:exact'].map(phosRegressorSum)).toEqual([0, 0, 0, 0])
    expect(['raw', 'D:1'].map(gosRegressorHasDc)).toEqual([true, true])
    expect(['ac', 'zm', '1diff', 'fx:exact'].map(gosRegressorHasDc)).toEqual([false, false, false, false])
    // 共模漂移公式 B·μ_p·E[q]/8：golden 的 4000 blocks、u_os = 25 fs、raw（μ_p = 8/(N_τ·K_q)）⇒ 約 3.99 ps；golden 的閉迴路 LMS 量到 3.885 ps
    const muP = 8 / (25 * (Math.sqrt(2 / Math.PI) / SIM_CFG.sigmaPs))
    const d = predictCmDrift('raw', muP, 25, 200, 4000, 512)
    expect(d.predFs).toBeCloseTo((4000 * muP * 1000 * eqOffset(25, 200)) / 8, 9)
    expect(Math.abs(PRED.offset_lms['L2|0.137|u=25|raw'].phos_cm_fs - d.predFs)).toBeLessThan(d.tolFs)
    expect(d.valid).toBe(true)
    // u_os = 100 fs 已經不是小 offset：公式（15.4 ps）是上限，golden 量到 10.5 ps ⇒ 標成不適用，不拿來比對
    const d100 = predictCmDrift('raw', muP, 100, 200, 4000, 512)
    expect(d100.valid).toBe(false)
    expect(d100.predFs).toBeGreaterThan(PRED.offset_lms['L2|0.137|u=100|raw'].phos_cm_fs)
    expect(PRED.offset_lms['L2|0.137|u=100|raw'].phos_cm_fs / 1000).toBeCloseTo(10.5, 1)
    expect(predictCmDrift('zm', muP, 25, 200, 4000, 512).predFs).toBe(0)
    expect(PRED.offset_lms['L2|0.137|u=25|zm'].phos_cm_fs).toBeLessThan(predictCmDrift('zm', muP, 25, 200, 4000, 512).tolFs)
    // 有限步長的平均模型：N_τ,eff = 8/(μ_p K_q)；raw 的 μ_p 對應 N_τ = 25
    const band = analyseAlpha(LOOPS.L2, 0.02).kappaM
    const vBand = predictPhosVerdict(band, muP, SIM_CFG.sigmaPs, 1500)
    expect(vBand.tauEff).toBeCloseTo(25, 9)
    expect(vBand.verdict).toBe('diverge') // 帶內：κ_1 < 0
    expect(predictPhosVerdict(analyseAlpha(LOOPS.L2, 0.137).kappaM, muP, SIM_CFG.sigmaPs, 1500).verdict).toBe('converge')
    // 帶緣 132 MHz：N_τ = 25 時 ρ < 1（時間常數約 870 blocks：1500 blocks 的模擬算邊際，6000 blocks 才判為收斂）；
    // 步長放大 5 倍（N_τ = 5）時 ρ > 1（同樣要夠長的模擬才判為發散）
    const edge = analyseAlpha(LOOPS.L2, 132 / FREF_MHZ).kappaM
    const e25 = predictPhosVerdict(edge, muP, SIM_CFG.sigmaPs, 1500)
    expect(e25.rho).toBeLessThan(1)
    expect(e25.verdict).toBe('marginal')
    expect(predictPhosVerdict(edge, muP, SIM_CFG.sigmaPs, 6000).verdict).toBe('converge')
    const e5 = predictPhosVerdict(edge, 5 * muP, SIM_CFG.sigmaPs, 1500)
    expect(e5.tauEff).toBeCloseTo(5, 9)
    expect(e5.rho).toBeGreaterThan(1)
    expect(e5.verdict).toBe('marginal')
    expect(predictPhosVerdict(edge, 5 * muP, SIM_CFG.sigmaPs, 20000).verdict).toBe('diverge')
    // 閉迴路也是如此：132 MHz、raw，N_τ = 25 收斂、N_τ = 5 變大
    const run132 = (tau: number) => runSspllLms({ loop: LOOPS.L2, alpha: 132 / FREF_MHZ, variant: 'raw', cfg: SIM_CFG, nBlocks: 1500, nBlk: 512, tauBlocks: tau, seed: 3, recEvery: 100, lanes: 2 })
    const r25 = run132(25)
    const r5 = run132(5)
    expect(r25.finalPhosRmsFs).toBeLessThan(0.5 * r25.initPhosRmsFs)
    expect(r5.finalPhosRmsFs).toBeGreaterThan(2 * r5.initPhosRmsFs)
    // dead zone（近整數 α = 0.002）：ρ ≈ 1 ⇒ 邊際
    expect(predictPhosVerdict(analyseAlpha(LOOPS.L2, 0.002).kappaM, muP, SIM_CFG.sigmaPs, 1500).verdict).toBe('marginal')
    // signmap 區間：L2 的 near-grid 大訊號 keep-out（文件 §15.2 步驟 5）
    expect(nearGridIntervals(SIGNMAP.L2, 'LSinf')).toEqual([
      [466.5, 508.5],
      [1468.5, 1499.5],
    ])
    expect(nearGridIntervals(SIGNMAP.L2, 'LSinf_ac')).toEqual([
      [490.5, 513.5],
      [1487.5, 1512.5],
    ])
    expect(mapIntervalsBelow(null, [])).toEqual([])
    expect(mapIntervalsBelow([0, -1, -1, 0, -1], [1, 2, 3, 4, 5], -0.5)).toEqual([
      [2, 3],
      [5, 5],
    ])
    // 頁面上用中文轉述的 golden 執行條件與 JSON 的 lms_note 一致
    for (const frag of ['sigma_v = 200 fs', 'N = 512', '6000 blocks', '2 noise lanes', 'time constant 25 blocks']) expect(PRED.lms_note).toContain(frag)
    for (const frag of ['$\\sigma_v=200$ fs', '$N=512$', '6000 blocks', '2 條雜訊 lane', '25 blocks']) expect(LMS_NOTE_ZH).toContain(frag)
    expect(PRED.lms['L2|0.02|raw'].blocks[PRED.lms['L2|0.02|raw'].blocks.length - 1]).toBe(6000)
  }, 60000)

  it('SSPLL: 顯示工具與程式碼 region——格式化函式；頁面引用的 region 在 sspll.ts 與 golden Python 都存在', () => {
    expect(fx(-0.20529, 4)).toBe('−0.2053')
    expect(fx(-0.00001, 3)).toBe('0.000')
    expect(fx(NaN)).toBe('—')
    expect(fs(0.0984, 4)).toBe('+0.0984')
    expect(fs(-0.1395, 4)).toBe('−0.1395')
    expect(fp(2.06e-5, 3)).toBe('2.06e−5')
    expect(tx(-0.5, 2)).toBe('-0.50')
    expect(txs(3.989e-3, 4)).toBe('0.003989')
    expect(txs(2.5e-8, 2)).toBe('2.5\\times10^{-8}')
    expect(intervalsText([])).toBe('無')
    expect(intervalsText([[0.5, 124.5], [953.5, 953.5]])).toBe('0.5–124.5、953.5')
    expect(signClass(-0.1)).toBe('cs-neg')
    expect(signClass(1e-4)).toBe('cs-dead')
    expect(signClass(0.3)).toBe('cs-pos')
    const ts = listRegions(MODEL_SRC)
    for (const reg of ['hpd', 'inversionBands', 'typeIK', 'bandEdge', 'variantG', 'gammaEff', 'gosHarmonic', 'gosRational', 'phosLambda', 'oneDiffMargin', 'blockMeanStable', 'cPeriodic', 'largeSignal', 'regRaw', 'regZeroMean', 'regDelay', 'regDiff1', 'regDiff2', 'regFx', 'signLmsBlock'])
      expect(ts, reg).toContain(reg)
    // 差異行標記
    for (const reg of ['regDiff1', 'regDiff2', 'regDelay', 'regFx', 'regZeroMean', 'variantG']) expect(extractRegion(MODEL_SRC, reg)).toContain('← 差異')
    expect(listRegions(PY_SOURCES.regressors.source)).toEqual(expect.arrayContaining(['variant_G', 'gmac_variants']))
    expect(listRegions(PY_SOURCES.predictions.source)).toEqual(expect.arrayContaining(['gamma_eff', 'C_periodic']))
    expect(listRegions(PY_SOURCES.simulator.source)).toContain('sign_lms_block')
    expect(extractRegion(PY_SOURCES.regressors.source, 'gmac_variants')).toContain('← 差異')
  })
})
