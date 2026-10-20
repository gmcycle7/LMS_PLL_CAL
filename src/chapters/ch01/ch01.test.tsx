import { readdirSync, readFileSync } from 'node:fs'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import katex from 'katex'
import { MemoryRouter } from 'react-router-dom'
import { MathText } from '@/components'
import {
  generateLossData,
  lmsSteadyState,
  runVariantOnData,
  signErrorFixedPointRun,
  signErrorLatticeStationary,
  timeAverage,
  type LossDataParams,
} from '@/simulation/models/lossCompare'
import { conventionalStep, signErrorStep } from '@/simulation/models/lms'
import Chapter01 from './index'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { LmsPlayground, playgroundWarnings, PLAYGROUND_DEFAULTS, sanitizePlaygroundParams } from './experiments/LmsPlayground'
import {
  MseMaeLab,
  decimateLattice,
  lmsAnalyticCheck,
  mseMaeWarnings,
  MSE_MAE_DEFAULTS,
  sanitizeMseMaeParams,
  signErrorFixedPointCheck,
  signErrorMcCheck,
  TRY_MU1,
  TRY_MU1_LATTICE_MEAN,
} from './experiments/MseMaeLab'
import { IntroSection } from './sections/Intro'
import { MedianExampleSection } from './sections/MedianExample'
import { ParabolaSection } from './sections/Parabola'
import { WrapupSection } from './sections/Wrapup'
import { SYMBOLS, SymbolsSection } from './symbols'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors, strictTexReport } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

// 記憶體：整章渲染一次約 400 MB 的 DOM，這個檔案會渲染十次以上；Plotly／Mermaid 假物件的呼叫紀錄與 jsdom selector 快取由 src/test/setup.jsdom.ts 在每個測試前後清掉。

function renderAt(node: React.ReactNode, path = '/ch/01', mode: 'beginner' | 'engineer' | 'research' = 'engineer') {
  return renderPage(node, { mode, url: path })
}

// 整章渲染（上千個 KaTeX 公式 + 兩個實驗 + 8 題帶入手算）在 CI 或多個測試行程同時執行時遠超過預設 5 s；
// 這裡只放寬逾時（機器負載高時整章渲染一次可能要一分鐘以上），不放寬任何斷言。
const HEAVY = 300_000
// 沒有另外指定逾時的測試（單一實驗的渲染、警告字串…）
vi.setConfig({ testTimeout: 120_000 })

/**
 * 嚴格檢查頁面上所有 TeX（src/test/katex.ts 的 strictTexReport：未定義的控制序列不會有 .katex-error，要用 throwOnError:true 重新解析），
 * 並確認真的找到了公式（範圍選錯時不會悄悄通過）。
 */
function strictTexErrors(root: HTMLElement): string[] {
  const { errors, seen } = strictTexReport(root)
  expect(seen).toBeGreaterThan(0)
  return errors
}

/** 元素內所有 KaTeX 公式的原始碼（MathML annotation） */
const texOf = (root: Element | null): string[] => Array.from(root?.querySelectorAll('.katex-mathml annotation') ?? []).map((a) => a.textContent ?? '')

/** 去掉 KaTeX 的 MathML 重複文字，只留顯示出來的字 */
const shownText = (el: Element | null): string => {
  if (!el) return ''
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex-mathml').forEach((m) => m.remove())
  return clone.textContent ?? ''
}

/** 審查 R08：畫面上 F-01.16 的公式、標籤、緊接在後的那一段（結論標籤）、§2.3.1 全部的 TeX 與文字、圖 2-6 的導讀 */
function r08Shown() {
  const f16 = document.getElementById('formula-F-01.16')!
  const s231 = document.getElementById('ch01-s231')!
  return {
    formula: texOf(f16.querySelector('.c-texblock-math')),
    label: texOf(f16.querySelector('.c-texblock-label')),
    claim: f16.nextElementSibling?.querySelector('.c-claim')?.className ?? '',
    section: texOf(s231),
    text: shownText(s231),
    read: shownText(document.querySelector('[data-diagram="D-01.18"] .c-chapter-fig-walk-body')),
  }
}

describe('Ch01 頁面（jsdom smoke）', () => {
  it('完整章節可渲染：章末符號表（章首只留一行）、勘誤連結、兩個實驗、程式碼比較、思考題與必記', () => {
    const { container } = renderAt(<Chapter01 />)
    // 符號表在章末（教學規範 §5）：整頁只有一張，包在 id="symbols" 裡，是頁面最後一個區塊，排在「本課必記」之後
    const chapter = container.querySelector('.ch01-chapter') as HTMLElement
    const symbols = document.getElementById('symbols') as HTMLElement
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(within(symbols).getByText('本章符號')).toBeTruthy()
    expect(chapter.lastElementChild).toBe(symbols)
    expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(SYMBOLS.length)
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(40) // 原有 34 列＋方塊圖用到的 Δw、z⁻¹、(m, d, s, ξ)、q、G、κ
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(after(container.querySelector('.c-recap')!, symbols)).toBe(true)
    expect(after(document.getElementById('ch01-s27')!, symbols)).toBe(true)
    // 符號表不再出現在 §1.0 之前，也不在任何小節裡
    expect(after(document.getElementById('ch01-s10')!, container.querySelector('.c-symbols')!)).toBe(true)
    expect(container.querySelector('section.c-section .c-symbols')).toBeNull()
    // 章首骨架（teaching-style §9）：§1.0（問題＋系統地圖）是章節的第一個區塊，「你在這裡」標成 .c-map-note（PageFrame 的本章資訊 strip 接在它後面），
    // 標籤列與勘誤說明框接在它之後、F-01.1 之前；不再有「本章符號表在最後 ↓」那一行（連結在 strip 裡）
    expect(container.querySelectorAll('.ch01-symbols-jump')).toHaveLength(0)
    expect(chapter.firstElementChild).toBe(document.getElementById('ch01-s10'))
    const mapNote = container.querySelector('#ch01-s10 .c-map-note')!
    expect(mapNote.previousElementSibling).toBe(container.querySelector('figure.c-mermaid.c-sysmap'))
    expect(after(mapNote, container.querySelector('.ch01-errata-box')!)).toBe(true)
    expect(after(container.querySelector('.ch01-errata-box')!, document.getElementById('formula-F-01.1')!)).toBe(true)
    // 勘誤標籤都連到驗證頁
    const errata = Array.from(container.querySelectorAll('a.c-erratum-link'))
    const ids = new Set(errata.map((a) => a.getAttribute('data-erratum')))
    for (const id of ['E38', 'E39', 'E40', 'E41', 'E43']) expect(ids.has(id)).toBe(true)
    for (const a of errata) expect(a.getAttribute('href')).toBe(`/verification?e=${a.getAttribute('data-erratum')}`)
    // 兩個實驗
    expect(container.querySelector('[data-experiment="lms-playground"]')).toBeTruthy()
    expect(container.querySelector('[data-experiment="mse-vs-mae"]')).toBeTruthy()
    // 手算表的精確分數（T01）
    expect(screen.getAllByText('57/25').length).toBeGreaterThan(0)
    expect(screen.getAllByText('9/5').length).toBeGreaterThan(0)
    // CodeCompare 的四個分頁
    for (const label of ['Conventional（MSE）', 'Sign-Error（MAE）', 'Huber', 'Sign-Sign']) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    // 桌機一欄太窄：四個版本分成兩個並排的 CodeCompare（Conventional／Sign-Error、Huber／Sign-Sign），四個都還在
    expect(Array.from(container.querySelectorAll('.c-code-compare')).map((c) => c.querySelectorAll('.c-code-compare-item').length)).toEqual([2, 2])
    // 差異行被標出
    expect(container.querySelectorAll('.c-code-mark').length).toBeGreaterThan(0)
    // 思考題與必記
    expect(screen.getAllByText(/思考題/).length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('這一課最重要的公式')).toBeTruthy()
    // 打開所有思考題解析，確認解析中的 TeX 也能解析
    act(() => {
      for (const b of screen.getAllByText('看答案與解析')) fireEvent.click(b)
    })
    expect(container.querySelectorAll('.c-quiz-answer').length).toBeGreaterThanOrEqual(4)
    expectNoTexErrors(container)
    expect(strictTexErrors(container)).toEqual([])
    // Engineer 模式：逐步推導直接展開（StepDerivation）
    expect(container.querySelectorAll('.c-steps').length).toBeGreaterThan(10)
    // §2.3.2：連續雜訊下 Sign-Error 的抖動（F-01.18）與 π/2 的代價
    expect(screen.getAllByText(/2\.3\.2 有連續雜訊時/).length).toBeGreaterThan(0)
    // 公式 ID 都有錨點（F-01.17 只在 Research 模式出現）
    for (const fm of FORMULAS.filter((x) => x.id !== 'F-01.17')) expect(document.getElementById(`formula-${fm.id}`), fm.id).toBeTruthy()
    // 審查 R08：F-01.16 右式是小步長近似。Engineer 模式在公式旁就看得到限制（≈、μ ≪ 10）、被忽略的修正量（4.7e−24）與步長不小的反例（μ = 5：25/13 ≈ 1.923，不是 2.5）
    const r08 = r08Shown()
    expect(r08.formula.some((t) => t.includes(String.raw`\mu\ll10:\ \overline{w}\approx\begin{cases}`))).toBe(true)
    expect(r08.formula.some((t) => t.includes(String.raw`\overline{w}=\begin{cases}`))).toBe(false)
    expect(r08.label).toContain(String.raw`\mu\ll10`)
    expect(r08.section.some((t) => t.includes(String.raw`4.7\times10^{-24}`))).toBe(true)
    expect(r08.section).toContain(String.raw`25/13\approx1.923`)
    expect(r08.section).toContain(String.raw`\mu/2=2.5`)
    expect(r08.section).toContain(String.raw`\{0,5,10\}`)
    expect(r08.text).toMatch(/右式的.{0,20}則是小步長（.{0,10}）的近似/)
    expect(r08.text).toMatch(/步長不小時不能這樣忽略/)
    expect(r08.text).toMatch(/直接解格點鏈/)
    expect(r08.text).not.toMatch(/精確計算|只會改變/)
    // 有限鏈公式留在 Research 模式
    expect(r08.section.some((t) => t.includes(String.raw`3^{1+10/\mu}-1`))).toBe(false)
    // 公式旁的結論標籤與登錄一致：近似
    expect(r08.claim).toMatch(/c-claim-approx/)
    // 圖 2-6 的導讀：圖只畫前幾格、鏈在 w = 10 附近到頭、另外兩種慣例在 w = 10 那一格也會變
    expect(r08.read).toMatch(/圖只畫前幾格.*附近就到頭了.*幾乎走不到那裡/)
    expect(r08.read).toMatch(/圖上這幾格只有.{0,6}的箭頭會變（.{0,3}剛好等於 10\s*的那一格也會變，但幾乎到不了/)
    expect(texOf(document.querySelector('[data-diagram="D-01.18"] .c-chapter-fig-walk-body'))).toEqual(
      expect.arrayContaining([String.raw`3^{-10/\mu}`, String.raw`3^{-50}\approx1.4\times10^{-24}`, String.raw`\overline w\approx\mu/2`]),
    )
    // §2.2 引用同一個結果時也說是小步長的近似
    expect(shownText(document.getElementById('ch01-s22'))).toMatch(/三種慣例的穩態時間平均差了.{0,12}（§2\.3\.1 算出小步長時約為/)
    expect(shownText(document.getElementById('ch01-s22'))).not.toMatch(/精確算出/)
  }, HEAVY)

  it('Research 模式顯示 Markov 鏈與污染資料段落；Beginner 模式收合推導', () => {
    const r1 = renderAt(<Chapter01 />, '/ch/01', 'research')
    expect(screen.getByText(/2\.4 （Research）/)).toBeTruthy()
    for (const fm of FORMULAS) expect(document.getElementById(`formula-${fm.id}`), fm.id).toBeTruthy()
    // 所有 TeX 都能被 KaTeX 正確解析（throwOnError: false 時錯誤會變成 .katex-error）
    expectNoTexErrors(r1.container)
    expect(strictTexErrors(r1.container)).toEqual([])
    expect(screen.getAllByText(/流量平衡/).length).toBeGreaterThan(0)
    // 審查 R08：Research 模式的推導把忽略的上邊界補回來——有限鏈公式、μ = 5 的 π = (9, 3, 1)/13、另外兩種慣例
    const res = r08Shown()
    expect(res.section.some((t) => t.includes(String.raw`\frac{\mu}{2}-\frac{10+\mu}{3^{1+10/\mu}-1}`))).toBe(true)
    expect(res.section.some((t) => t.includes(String.raw`(+1):\quad\overline w&=\mu-\frac{10+\mu}{3^{1+10/\mu}-1}`))).toBe(true)
    expect(res.section.some((t) => t.includes(String.raw`(-1):\quad\overline w&=-\frac{10+\mu}{3^{1+10/\mu}-1}`))).toBe(true)
    expect(res.text).toMatch(/另外兩種慣例.{0,40}（式子左邊括號裡的數字）：tie 發生在.{0,4}等於資料值的每一格/)
    expect(res.section).toContain(String.raw`\pi=\tfrac{1}{13}(9,3,1)`)
    expect(res.section).toContain(String.raw`\overline w=\tfrac{25}{13}\approx1.923`)
    expect(res.section).toContain(String.raw`M=10/\mu`)
    expect(res.section).toContain('M=50')
    expect(res.section.some((t) => t.startsWith(String.raw`\overline w\approx\mu\sum_{k\ge0}k\,\pi_k`))).toBe(true)
    expect(res.text).toMatch(/以下先忽略，最後三步再補回來/)
    expect(res.text).toMatch(/把忽略的上邊界補回來/)
    r1.unmount()
    const r2 = renderAt(<Chapter01 />, '/ch/01', 'beginner')
    expect(strictTexErrors(r2.container)).toEqual([])
    // 審查 R08：Beginner 模式也看得到「≈、μ ≪ 10」與一句白話的限制；反例與有限鏈公式不出現
    const beg = r08Shown()
    expect(beg.formula.some((t) => t.includes(String.raw`\mu\ll10:\ \overline{w}\approx\begin{cases}`))).toBe(true)
    expect(beg.label).toContain(String.raw`\mu\ll10`)
    expect(beg.section.some((t) => t.includes(String.raw`4.7\times10^{-24}`))).toBe(true)
    expect(beg.text).toMatch(/幾乎走不到 10，所以推導時把那一端忽略了/)
    expect(beg.section.some((t) => t.includes('1.923'))).toBe(false)
    expect(beg.section.some((t) => t.includes(String.raw`3^{1+10/\mu}-1`))).toBe(false)
    expect(beg.claim).toMatch(/c-claim-approx/)
    // F-01.18（連續雜訊下的抖動）在所有模式都顯示
    expect(document.getElementById('formula-F-01.18')).toBeTruthy()
    expect(screen.queryByText(/2\.4 （Research）/)).toBeNull()
    expect(r2.container.querySelectorAll('.c-steps').length).toBeLessThan(10)
    r2.unmount()
  }, HEAVY)
})

describe('Ch01 符號表在章末（教學規範 §5）', () => {
  it('章末的「回到章首」是按鈕（不是會改 HashRouter 路由的 href）：捲回 §1.0；章首沒有「本章符號表在最後」那一行（連結由 PageFrame 的 strip 提供）', () => {
    const scrolled: Element[] = []
    const proto = Element.prototype as unknown as { scrollIntoView?: (arg?: unknown) => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const { container } = renderAt(
        <>
          <div id="ch01-s10" />
          <SymbolsSection />
        </>,
      )
      const hashBefore = window.location.hash
      expect(container.textContent).not.toContain('本章符號表在最後')
      expect(container.querySelector('a[href="#symbols"], a[href$="#symbols"]')).toBeNull()
      const symbols = document.getElementById('symbols') as HTMLElement
      act(() => {
        fireEvent.click(within(symbols).getByRole('button', { name: /回到章首/ }))
      })
      expect(scrolled).toEqual([document.getElementById('ch01-s10')])
      expect(window.location.hash).toBe(hashBefore)
      // 表的內容不變：每列都有符號（KaTeX）與意義，沒有 KaTeX 錯誤
      expect(symbols.querySelectorAll('tbody tr')).toHaveLength(SYMBOLS.length)
      expect(new Set(SYMBOLS.map((r) => r.symbol)).size).toBe(SYMBOLS.length)
      expectNoTexErrors(symbols)
      expect(strictTexErrors(symbols)).toEqual([])
    } finally {
      proto.scrollIntoView = original
    }
  })

  it('沒有 scrollIntoView 的環境（jsdom、很舊的瀏覽器）點了也不會丟錯', () => {
    renderAt(
      <>
        <SymbolsSection />
      </>,
    )
    expect(() => {
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /回到章首/ }))
      })
    }).not.toThrow()
  })

  it('符號表移到最後之後，每個符號第一次出現的小節正文裡都有一句就地說明（Beginner 模式也看得到：不在收合的推導或先備知識框裡）', () => {
    const { container } = renderAt(<Chapter01 />, '/ch/01', 'beginner')
    /** 小節的正文：去掉可收合的推導、先備知識框、手算題、實驗與程式碼 */
    const bodyText = (id: string): string => {
      const clone = document.getElementById(id)!.cloneNode(true) as HTMLElement
      for (const el of Array.from(clone.querySelectorAll('.c-derivation, .c-prereq, .c-handcalc, .c-code, pre, .katex-mathml, [data-experiment]'))) el.remove()
      return clone.textContent ?? ''
    }
    const FIRST_USE: [string, string, RegExp][] = [
      ['a、x、y', 'ch01-s10', /黑盒子裡真正的係數（未知）/],
      ['v', 'ch01-s10', /量測雜訊/],
      ['w', 'ch01-s10', /我們可以調的參數/],
      ['ŷ', 'ch01-s10', /做的預測/],
      ['e', 'ch01-s10', /誤差（error）＝量測減預測/],
      ['n', 'ch01-s10', /sample 索引/],
      ['μ', 'ch01-s10', /學習率（step size）/],
      ['N', 'ch01-s10', /是資料筆數/],
      ['N（平均）', 'ch01-s11', /拿來平均的資料筆數/],
      ['Δw', 'ch01-s10', /修正量/],
      ['z⁻¹', 'ch01-s13', /表示延遲一筆/],
      ['E[·]', 'ch01-s11', /期望值/],
      ['argmin', 'ch01-s11', /最小的那個/],
      ['J', 'ch01-s11', /成本（cost）/],
      ['w*', 'ch01-s11', /最佳解/],
      ['P_x', 'ch01-s13', /輸入功率/],
      ['q_n', 'ch01-s121', /1-bit comparator／BBPD/],
      ['j_n', 'ch01-s13', /單筆成本/],
      ['δ_n', 'ch01-s14', /剩餘參數誤差/],
      ['p', 'ch01-s14', /pole/],
      ['σ_v', 'ch01-s141', /標準差/],
      ['ρ', 'ch01-s21', /損失函數（loss）/],
      ['ψ', 'ch01-s21', /influence function/],
      ['δ_H', 'ch01-s21', /Huber 的門檻/],
      ['sign', 'ch01-s21', /只留正負號/],
      ['clip', 'ch01-s21', /截在/],
      ['∂|e|', 'ch01-s22', /次梯度（subgradient）/],
      ['J_MSE…', 'ch01-s23', /平均成本分別記作/],
      ['#{·}', 'ch01-s23', /滿足括號內條件的資料筆數/],
      ['P(·)', 'ch01-s231', /事件的機率/],
      ['w̄', 'ch01-s231', /時間平均/],
      ['f、m、d_n', 'ch01-s232', /機率密度在中位數的值/],
      ['s_n、ξ_n', 'ch01-s232', /扣掉平均後剩下的零均值部分/],
      ['K_q', 'ch01-s232', /等效小訊號增益/],
      ['ṽ', 'ch01-s232', /總雜訊/],
      ['ε', 'ch01-s232', /outlier 出現的機率/],
      ['κ', 'ch01-s232', /比精確值小約/],
      ['G', 'ch01-s26', /是 GMAC 的輸出/],
    ]
    for (const [sym, id, re] of FIRST_USE) expect(bodyText(id), `${sym}（${id}）`).toMatch(re)
    // 章首的勘誤框（系統地圖之後）用到 δ、sign(0)、J₂：框內也各有一句說明
    const errataBox = container.querySelector('.ch01-errata-box') as HTMLElement
    expect(errataBox.textContent).toMatch(/剩餘參數誤差採/)
    expect(errataBox.textContent).toMatch(/誤差剛好是 0 時的「正負號」/)
    expect(errataBox.textContent).toMatch(/沒有.*的平方誤差平均/)
  }, HEAVY)
})

describe('LMS Playground', () => {
  it('T01: 預設（Gallery #1）顯示 w₁ = 1.8、w₂ = 2.28，交叉比對解析 ok', () => {
    const { container } = renderAt(<LmsPlayground />)
    const shell = container.querySelector('[data-experiment="lms-playground"]') as HTMLElement
    // 指標名稱是 LaTeX（$w_1$、$w_2$），不是 Unicode 下標
    const names = texOf(shell.querySelector('.c-metric-table'))
    expect(names).toContain('w_1')
    expect(names).toContain('w_2')
    expect(shell.querySelector('.c-metric-table')?.textContent).not.toMatch(/w[₁₂]/)
    expect(shell.textContent).toContain('1.8')
    expect(shell.textContent).toContain('2.28')
    expect(shell.querySelector('.c-check-ok')).toBeTruthy()
  })

  it('T02: 網址 preset μ = 0.6 ⇒ 顯示「超過穩定上限 2/x² = 0.5」的解釋性警告', () => {
    const { container } = renderAt(<LmsPlayground />, '/ch/01?preset=lms-playground-divergent')
    const warn = container.querySelector('.c-exp-warnings') as HTMLElement
    expect(warn.textContent).toMatch(/超過固定.*的穩定上限/)
    // 警告字串裡的數學是 $...$（KaTeX），不是 Unicode 拼的 2/x²
    expect(texOf(warn)).toContain('2/x^2=0.5')
    expect(texOf(warn).some((t) => t.startsWith('|p|=|1-\\mu x^2|=1.4'))).toBe(true)
    expect(warn.textContent).not.toMatch(/x²|δₙ/)
    expect(strictTexErrors(warn)).toEqual([])
  })

  it('單步、凍結、重設', () => {
    const { container } = renderAt(<LmsPlayground />)
    const label = () => container.querySelector('label[for="ch01-pg-cursor"]')?.textContent ?? ''
    expect(label()).toContain('= 2')
    act(() => {
      fireEvent.click(screen.getByText('單步 Step'))
    })
    expect(label()).toContain('= 3')
    act(() => {
      fireEvent.click(screen.getByText('凍結 Freeze'))
    })
    expect(screen.getByText(/已從 n = 3 凍結/)).toBeTruthy()
    // 凍結狀態的資料流（μ_eff）與一般狀態一樣，TeX 都必須能嚴格解析
    expect(strictTexErrors(container)).toEqual([])
    // Freeze 後解析交叉比對改用 w_n = a − (a − w₀)p^{min(n, 3)}，仍然是 ok（不是 n/a）
    const shell = container.querySelector('[data-experiment="lms-playground"]') as HTMLElement
    expect(shell.querySelector('.c-check-ok')?.getAttribute('title')).toContain('Freeze 自 n 等於 3') // title 是 accessibleText 之後的可念文字（沒有 $ 與反斜線）
    expect(texOf(shell.querySelector('.c-check-ok'))).toContain('n=3')
    act(() => {
      fireEvent.click(screen.getByText('重設 Reset'))
    })
    expect(label()).toContain('= 0')
  })

  it('動畫（runKind=animate）：Run 鈕顯示「n/N 步」進度；「跳到結尾」把游標直接放到最後一步並停用自己；重設後恢復', () => {
    const { container } = renderAt(<LmsPlayground />)
    const label = () => container.querySelector('label[for="ch01-pg-cursor"]')?.textContent ?? ''
    const N = PLAYGROUND_DEFAULTS.steps
    expect(screen.getByText('執行 Run').textContent).toContain(`（2/${N} 步）`)
    const skip = screen.getByText('跳到結尾') as HTMLButtonElement
    expect(skip.disabled).toBe(false)
    act(() => {
      fireEvent.click(skip)
    })
    expect(label()).toContain(`= ${N}`)
    expect(screen.getByText('執行 Run').textContent).toContain(`（${N}/${N} 步）`)
    expect((screen.getByText('跳到結尾') as HTMLButtonElement).disabled).toBe(true)
    act(() => {
      fireEvent.click(screen.getByText('重設 Reset'))
    })
    expect(label()).toContain('= 0')
    expect((screen.getByText('跳到結尾') as HTMLButtonElement).disabled).toBe(false)
  })

  it('警告：x = 0 不可辨識、μ < 0 極性錯誤、μ = 0.5 邊界', () => {
    expect(playgroundWarnings({ ...PLAYGROUND_DEFAULTS, x: 0 }, null)[0]).toMatch(/不可辨識/)
    expect(playgroundWarnings({ ...PLAYGROUND_DEFAULTS, mu: -0.01 }, null)[0]).toMatch(/極性錯誤/)
    expect(playgroundWarnings({ ...PLAYGROUND_DEFAULTS, mu: 0.5 }, null)[0]).toMatch(/邊界/)
    expect(playgroundWarnings(PLAYGROUND_DEFAULTS, null)).toHaveLength(0)
    expect(sanitizePlaygroundParams({ mu: 0.3, steps: 1e6, junk: 'x', a: Number.NaN })).toEqual({ mu: 0.3, steps: 400 })
  })
})

describe('MSE vs MAE Lab', () => {
  it('預設 four_point：同一組資料、三條軌跡；Analytic / Monte Carlo / Fixed-Point 皆實際比對', () => {
    const { container } = renderAt(<MseMaeLab />)
    const shell = container.querySelector('[data-experiment="mse-vs-mae"]') as HTMLElement
    expect(shell.textContent).toContain('批次最佳解 L2')
    expect(shell.textContent).toContain('單步步長')
    expect(texOf(shell.querySelector('.c-metric-table'))).toContain('\\mu|x|')
    // 三個交叉比對都不是 Not implemented
    expect(shell.querySelectorAll('.c-check-not-implemented').length).toBe(0)
    expect(shell.querySelectorAll('.c-check-ok').length).toBeGreaterThanOrEqual(2)
  })

  it('網址 preset：DC + outlier 顯示母體中位數 3.1397…；Gaussian x 時 lattice 交叉比對為 n/a', () => {
    const r = renderAt(<MseMaeLab />, '/ch/01?preset=mse-mae-outliers-dc')
    expect(r.container.textContent).toMatch(/3\.1397/)
    r.unmount()
    const r2 = renderAt(<MseMaeLab />, '/ch/01?preset=mse-mae-outliers-regression')
    expect(r2.container.querySelectorAll('.c-check-n\\/a').length + r2.container.querySelectorAll('[class*="c-check-n"]').length).toBeGreaterThan(0)
    expect(r2.container.textContent).toContain('Gaussian x')
  })

  it('警告：ε ≥ 0.5 breakdown、LMS 均方發散、A = 0 不可辨識', () => {
    const base = { ...MSE_MAE_DEFAULTS, model: 'contaminated' as const }
    expect(mseMaeWarnings({ ...base, outlierProb: 0.55 }, true, null).join('')).toMatch(/breakdown/)
    expect(mseMaeWarnings({ ...base, xDist: 'gaussian', mu: 1 }, false, null).join('')).toMatch(/均方發散/)
    expect(mseMaeWarnings({ ...base, xScale: 0 }, true, null).join('')).toMatch(/不可辨識/)
    expect(sanitizeMseMaeParams({ model: 'bogus', tie: 'plus', n: 50 })).toEqual({ tie: 'plus', n: 100 })
  })
})

/**
 * 教學規範 §3：內文不得用純文字拼湊公式。掃描「正文」文字節點（排除 KaTeX、程式碼、控制項的單位／暫存器名稱、
 * metric 表的數值欄），找 w_n、x²、x^2、±μ、μ|x| 這類純文字數學。警告、假設、交叉比對附註、圖標題等字串屬性現在以
 * $...$ 寫成 LaTeX，所以不再排除；metric 表的名稱／附註欄與控制項標籤另外用 unicodeMathLeaks 檢查。
 */
function plainMathLeaks(root: HTMLElement): string[] {
  const SKIP = [
    '.katex',
    'pre',
    'code',
    '.c-code',
    '.c-code-compare-note',
    '.c-exp-controls',
    '.c-exp-summary',
    '.c-exp-presets',
    '.c-exp-export',
    '.c-metric-wrap',
    '.c-mermaid',
    '.c-cases',
    '.c-tip-item',
    '.c-param',
    'select',
    'option',
  ].join(', ')
  const re = /[A-Za-zα-ωΑ-Ω]_[A-Za-z0-9{(]|[A-Za-zα-ω)\]]\^|[a-zα-ω)\]][²³⁴]|±μ|μ\|x\||w\(n\+1\)|μ\s*[*·]\s*e/
  const out: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || el.closest(SKIP)) continue
    const t = n.textContent ?? ''
    if (re.test(t)) out.push(t.trim().slice(0, 100))
  }
  return out
}

describe('Ch01 教學規範與審查修正', () => {
  it('正文沒有純文字公式（w_n、x²、±μ、μ|x| 等都必須是 LaTeX）；渲染時沒有 React 錯誤（key、hooks、無限迴圈）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { container } = renderAt(<Chapter01 />, '/ch/01', 'research')
      expect(plainMathLeaks(container)).toEqual([])
      // Plot 的 lazy-load 在 jsdom 會產生「not wrapped in act(...)」提示（共用元件、非錯誤），其餘 console.error 一律不允許
      const errors = spy.mock.calls.map((c) => String(c[0])).filter((m) => !m.includes('not wrapped in act'))
      expect(errors).toEqual([])
    } finally {
      spy.mockRestore()
    }
  }, HEAVY)

  it('思考題 3（{1,2,3,100}）：解析以 lattice 精確解說明「整段 [2,3] 遊走、std 不隨 μ 縮小」', () => {
    const { container } = renderAt(<WrapupSection />)
    const quiz = Array.from(container.querySelectorAll('.c-quiz')).find((q) => q.textContent?.includes('思考題 3')) as HTMLElement
    act(() => {
      fireEvent.click(within(quiz).getByText('看答案與解析'))
    })
    const ans = quiz.querySelector('.c-quiz-answer') as HTMLElement
    // 兩個 μ 的 std 都約 0.29–0.32（≈ 1/√12），不是 O(μ)
    const stds = Array.from(ans.querySelectorAll('.katex-mathml annotation'))
      .map((a) => a.textContent ?? '')
      .flatMap((t) => Array.from(t.matchAll(/operatorname\{std\}=([0-9.]+)/g), (m) => Number(m[1])))
    expect(stds).toHaveLength(2)
    for (const sd of stds) {
      expect(sd).toBeGreaterThan(0.28)
      expect(sd).toBeLessThan(0.33)
    }
    // 正確選項不再宣稱「抖動 O(μ)」收斂到一點
    const opts = Array.from(quiz.querySelectorAll('.c-quiz-opt')).map((o) => o.textContent ?? '')
    expect(opts.some((o) => o.includes('來回遊走'))).toBe(true)
  })

  it('Wrapup 在 SettingsProvider 之外也能渲染（useChapterMode 有預設值）', () => {
    expect(() =>
      render(
        <MemoryRouter>
          <WrapupSection />
        </MemoryRouter>,
      ),
    ).not.toThrow()
  })

  it('Playground：「載入入門課範例」即使已先手動新增 B / C，也會得到 A/B/C = 0.02 / 0.1 / 0.65（useCases 狀態競爭的回歸測試）', () => {
    renderAt(<LmsPlayground />)
    const addBtn = () => screen.queryByLabelText('新增比較組（複製目前參數）')
    // 先手動新增兩組（複製 A 的 μ = 0.02），重現原本 reset + addCase 被覆蓋的情境
    act(() => {
      fireEvent.click(addBtn()!)
    })
    act(() => {
      fireEvent.click(addBtn()!)
    })
    act(() => {
      fireEvent.click(screen.getByText(/載入入門課範例/))
    })
    const muOf = (id: 'A' | 'B' | 'C') => {
      act(() => {
        fireEvent.click(screen.getByRole('tab', { name: new RegExp(`Case ${id}`) }))
      })
      return Number((screen.getByLabelText(`Case ${id} 的 μ`) as HTMLInputElement).value)
    }
    expect(muOf('A')).toBe(0.02)
    expect(muOf('B')).toBe(0.1)
    expect(muOf('C')).toBe(0.65)
  })

  it('Playground：同步資料流顯示目前這一步的 ①預測 ②比較 ③修正（數字來自軌跡）', () => {
    const { container } = renderAt(<LmsPlayground />)
    const flow = container.querySelector('.ch01-flow') as HTMLElement
    const tex = Array.from(flow.querySelectorAll('.katex-mathml annotation'))
      .map((a) => a.textContent)
      .join(' ')
    // 回歸測試：「\\mu」與「e_{n}」之間必須有分隔，否則 KaTeX 會把它讀成未定義的 \\mue（紅字）
    expect(tex).not.toContain('\\mue')
    expect(strictTexErrors(container)).toEqual([])
    // 預設 cursor = 2：w₂ = 2.28 ⇒ ŷ₂ = 4.56、e₂ = 1.44、Δw = 0.288、w₃ = 2.568
    expect(tex).toContain('4.56')
    expect(tex).toContain('1.44')
    expect(tex).toContain('0.288')
    expect(tex).toContain('2.568')
  })

  it('Playground 有雜訊 preset：Monte Carlo（400 條路徑）與精確 Var(w_N) 交叉比對為 ok', () => {
    const { container } = renderAt(<LmsPlayground />, '/ch/01?preset=lms-playground-noisy')
    const shell = container.querySelector('[data-experiment="lms-playground"]') as HTMLElement
    expect(shell.textContent).toContain('MC，400 條路徑')
    expect(shell.querySelectorAll('.c-check-ok').length).toBeGreaterThanOrEqual(2) // analytic + monteCarlo
    expect(shell.querySelectorAll('.c-check-mismatch').length).toBe(0)
  })

  it('T02: 發散 preset 按「執行至收斂」直接走到最後一步（不會誤停在 n = 0）', () => {
    const { container } = renderAt(<LmsPlayground />, '/ch/01?preset=lms-playground-divergent')
    act(() => {
      fireEvent.click(screen.getByText('執行至收斂 Run-to-Convergence'))
    })
    expect(container.querySelector('label[for="ch01-pg-cursor"]')?.textContent).toContain('= 30')
  })

  it('MSE vs MAE 警告：±A 與 const 一樣是確定性發散（不提 almost-sure）；Gaussian x 依 a.s. 界分兩種說法（E14）', () => {
    const base = { ...MSE_MAE_DEFAULTS, model: 'contaminated' as const }
    const pm = mseMaeWarnings({ ...base, xDist: 'pm1', xScale: 1, mu: 2.5 }, false, null).join('')
    expect(pm).toMatch(/\$\|x\|\$ 固定/)
    expect(pm).not.toMatch(/almost-sure/)
    const g1 = mseMaeWarnings({ ...base, xDist: 'gaussian', xScale: 1, mu: 1 }, false, null).join('')
    expect(g1).toMatch(/均方發散/)
    expect(g1).toMatch(/單一路徑仍幾乎必然收斂/)
    expect(g1).not.toMatch(/連平均/)
    const g3 = mseMaeWarnings({ ...base, xDist: 'gaussian', xScale: 1, mu: 3 }, false, null).join('')
    expect(g3).toMatch(/連平均 \$E\[\\delta\]\$ 也發散/)
    expect(g3).toMatch(/連單一路徑也幾乎必然發散/)
  })
})

describe('Ch01 測試工具自我檢查', () => {
  it('strictTexErrors 抓得到「未定義控制序列」（\\mue 這類不會產生 .katex-error 的紅字）', () => {
    const host = document.createElement('div')
    host.innerHTML = katex.renderToString(String.raw`\Delta w=\mue_{2}x`, { throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' })
    expectNoTexErrors(host) // 這就是原本的測試漏掉它的原因
    const errs = strictTexErrors(host)
    expect(errs.some((e) => e.includes('Undefined control sequence'))).toBe(true)
    expect(errs.some((e) => e.startsWith('紅字'))).toBe(true)
    const ok = document.createElement('div')
    ok.innerHTML = katex.renderToString(String.raw`\Delta w=\mu\,e_{2}\,x`, { throwOnError: false, output: 'htmlAndMathml' })
    expect(strictTexErrors(ok)).toEqual([])
  })
})

describe('Ch01 交叉比對的誠實性（規格 §17：模型公式有錯，UI 不可顯示成功）', () => {
  const FOUR: LossDataParams = { model: 'four_point', a: 0, xDist: 'const', xScale: 1, sigma: 0, outlierProb: 0, outlierSize: 0, outlierSign: 'positive', n: 4000, seed: 7 }
  const opts = { w0: 1, mu: 0.2, tie: 'zero' as const, huberDelta: 1 }
  const data = generateLossData(FOUR)

  it('LMS analytic：正確公式 ⇒ ok；若把變異數公式寫錯（用沒有 ½ 的 J₂ 曲率 ⇒ μVar/(1 − μ)…）或把平均換成中位數 ⇒ mismatch', () => {
    const ta = timeAverage(runVariantOnData('conventional', data, opts).w)
    const ss = lmsSteadyState(FOUR, opts.mu)
    expect(lmsAnalyticCheck(ta, ss, 0).status).toBe('ok')
    // 錯誤公式 1：平均寫成中位數 0
    expect(lmsAnalyticCheck(ta, { ...ss, mean: 0 }, 0).status).toBe('mismatch')
    // 錯誤公式 2：穩態變異數少了 /(2 − μ) 的 2（等於把 J₂ 的曲率 2P_x 當成 LMS 的曲率，勘誤 E41）：μVar(y)/(1 − μ)
    expect(lmsAnalyticCheck(ta, { ...ss, variance: (opts.mu * 18.75) / (1 - opts.mu) }, 0).status).toBe('mismatch')
    // 不穩定、樣本太短、暫態未結束：誠實回報 n/a，而不是 ok
    expect(lmsAnalyticCheck(ta, lmsSteadyState(FOUR, 2.5), 0).status).toBe('n/a')
    expect(lmsAnalyticCheck({ ...ta, n: 100 }, ss, 0).status).toBe('n/a')
    expect(lmsAnalyticCheck(ta, ss, 1).status).toBe('n/a')
    // 無雜訊（變異數 0）：必須精確收斂
    const clean: LossDataParams = { ...FOUR, model: 'contaminated', a: 3 }
    const tc = timeAverage(runVariantOnData('conventional', generateLossData(clean), opts).w)
    expect(lmsAnalyticCheck(tc, lmsSteadyState(clean, opts.mu), 0).status).toBe('ok')
    expect(lmsAnalyticCheck({ ...tc, mean: 3.001 }, lmsSteadyState(clean, opts.mu), 0).status).toBe('mismatch')
  })

  it('Sign-Error fixed-point：正確的 tie 慣例 ⇒ ok；拿錯 tie 慣例的 lattice（μ 而不是 μ/2）比 ⇒ mismatch（沒有 μ|x| 的寬限）', () => {
    const fx = timeAverage(signErrorFixedPointRun(data, opts)!.w)
    const right = signErrorLatticeStationary(FOUR, opts)!
    const wrong = signErrorLatticeStationary(FOUR, { ...opts, tie: 'plus' })!
    expect(right.mean).toBeCloseTo(0.1, 12)
    expect(wrong.mean).toBeCloseTo(0.2, 12)
    expect(signErrorFixedPointCheck(fx, right, opts.w0).status).toBe('ok')
    expect(signErrorFixedPointCheck(fx, wrong, opts.w0).status).toBe('mismatch')
    expect(signErrorFixedPointCheck(null, right, opts.w0).status).toBe('n/a')
    expect(signErrorFixedPointCheck(fx, { ...right, truncated: true }, opts.w0).status).toBe('n/a')
    // IEEE 版本：容忍 μ|x| + 5σ（E40）——tie 失效造成的偏移在帶內 ⇒ ok；若宣稱的精確值差了 3μ ⇒ mismatch
    const ieee = timeAverage(runVariantOnData('sign_error', data, opts).w)
    expect(signErrorMcCheck(ieee, right, opts.mu, opts.w0).status).toBe('ok')
    expect(signErrorMcCheck(ieee, { ...right, mean: right.mean + 3 * opts.mu }, opts.mu, opts.w0).status).toBe('mismatch')
    expect(signErrorMcCheck(ieee, null, opts.mu, opts.w0).status).toBe('n/a')
    // 起點離中位數太遠（暫態未結束）：n/a
    expect(signErrorMcCheck(ieee, right, opts.mu, 500).status).toBe('n/a')
  })

  it('預設實驗的三個交叉比對對 60 個不同 seed 都不會誤報 mismatch（門檻 5σ + 理論標準誤）', () => {
    const ss = lmsSteadyState(FOUR, opts.mu)
    const lat = signErrorLatticeStationary(FOUR, opts)!
    for (let seed = 100; seed < 160; seed++) {
      const d = generateLossData({ ...FOUR, seed })
      expect(lmsAnalyticCheck(timeAverage(runVariantOnData('conventional', d, opts).w), ss, 0).status, `LMS seed ${seed}`).toBe('ok')
      expect(signErrorMcCheck(timeAverage(runVariantOnData('sign_error', d, opts).w), lat, opts.mu, opts.w0).status, `IEEE seed ${seed}`).toBe('ok')
      expect(signErrorFixedPointCheck(timeAverage(signErrorFixedPointRun(d, opts)!.w), lat, opts.w0).status, `fixed seed ${seed}`).toBe('ok')
    }
  })

  it('lattice 圖的抽點：數十萬個格點也只畫 ≤ 600 點（不會把整個陣列展開成函式引數）', () => {
    const p: LossDataParams = { ...FOUR, model: 'contaminated', a: 0, sigma: 5 }
    const lat = signErrorLatticeStationary(p, { w0: 0, mu: 1e-4, tie: 'zero' })!
    expect(lat.grid.length).toBeGreaterThan(2000)
    const d = decimateLattice(lat)
    expect(d.x.length).toBeLessThanOrEqual(600)
    expect(d.stride).toBeGreaterThan(1)
    expect(lat.piMax).toBeGreaterThan(0)
    const small = signErrorLatticeStationary(FOUR, { w0: 0, mu: 0.2, tie: 'zero' })!
    expect(decimateLattice(small).stride).toBe(1)
  })

  it('MSE vs MAE Lab：contaminated preset 顯示「擴散近似」指標與正確的帶說明（時間平均的容忍帶，不是軌跡範圍）', () => {
    const r = renderAt(<MseMaeLab />, '/ch/01?preset=mse-mae-outliers-dc')
    const text = r.container.textContent ?? ''
    expect(text).toContain('擴散近似')
    expect(text).toContain('時間平均的容忍帶')
    expect(text).not.toMatch(/Sign-Error 的穩態只會落在/)
    // 三個交叉比對都實際算出結果（ok），而且沒有 mismatch
    expect(r.container.querySelectorAll('.c-check-ok').length).toBe(3)
    expect(r.container.querySelectorAll('.c-check-mismatch').length).toBe(0)
    expect(strictTexErrors(r.container)).toEqual([])
  })

  it('MSE vs MAE Lab：無雜訊 tie preset（E40）三個交叉比對皆為 ok——LMS 精確收斂、IEEE 在 μ|x| 內、定點與 lattice 完全一致', () => {
    const r = renderAt(<MseMaeLab />, '/ch/01?preset=mse-mae-noise-free-tie')
    expect(r.container.querySelectorAll('.c-check-ok').length).toBe(3)
    expect(r.container.querySelectorAll('.c-check-mismatch').length).toBe(0)
    expect(r.container.textContent).toContain('無雜訊：LMS 應精確收斂到 3')
  })

  it('§2.2 的 E40 數值表：精確算術凍結在 {3}、IEEE double 出現 3.0000000000000004', () => {
    const { container } = renderAt(<Chapter01 />, '/ch/01', 'beginner')
    const cells = Array.from(container.querySelectorAll('td.mono')).map((td) => td.textContent ?? '')
    expect(cells).toContain('{3}')
    expect(cells.some((c) => c.includes('3.0000000000000004'))).toBe(true)
  }, HEAVY)

  it('MSE vs MAE Lab：按「執行 Run」跑長時間 tie 研究（useWorkerTask；jsdom 下 inline 執行）⇒ 表格列出 3 種慣例 × 2 種算術與 lattice 精確值', async () => {
    const r = renderAt(<MseMaeLab />)
    const shell = r.container.querySelector('[data-experiment="mse-vs-mae"]') as HTMLElement
    act(() => {
      fireEvent.click(within(shell).getByText('執行 Run'))
    })
    await waitFor(() => expect(within(shell).getAllByText('定點整數 code').length).toBe(3), { timeout: 120_000 })
    expect(within(shell).getAllByText('IEEE double（lms.ts）').length).toBe(3)
    // 儲存格裡的 KaTeX 只出 HTML、原始碼放在隱藏的 .katex-mathml：數值要讀看得到的文字
    const shown = (td: Element) => {
      const c = td.cloneNode(true) as HTMLElement
      c.querySelectorAll('.katex-mathml').forEach((m) => m.remove())
      return c.textContent ?? ''
    }
    const rows = Array.from(shell.querySelectorAll('.callout table tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map(shown))
    expect(rows).toHaveLength(6)
    // 定點、sign(0) = 0：時間平均 ≈ lattice 精確值 0.1（4×10⁵ 步）；e = 0 的次數遠多於 IEEE
    // tie 慣例欄是 KaTeX（\operatorname{sign}(0)=0），所以比對不含空白的「=0」
    const fixedZero = rows.find((c) => c[0].includes('=0') && c[1].includes('定點'))!
    const ieeeZero = rows.find((c) => c[0].includes('=0') && c[1].includes('IEEE'))!
    expect(Number(fixedZero[2].split('±')[0])).toBeCloseTo(0.1, 2)
    expect(Number(fixedZero[3])).toBeCloseTo(0.1, 6)
    expect(Number(fixedZero[5])).toBeGreaterThan(100 * Math.max(1, Number(ieeeZero[5])))
    expect(strictTexErrors(shell)).toEqual([])
  }, HEAVY)

  it('§2.4（Research）估計量效率 Monte Carlo 按鈕（Worker 任務，jsdom 下 inline）：乾淨 Gaussian 的 Var(median)/Var(mean) 落在 π/2 附近', async () => {
    const r = renderAt(<MedianExampleSection />, '/ch/01', 'research')
    act(() => {
      fireEvent.click(screen.getByText('執行估計量效率 Monte Carlo'))
    })
    await waitFor(() => expect(r.container.textContent).toContain('乾淨 Gaussian'), { timeout: 200_000 })
    const tex = Array.from(r.container.querySelectorAll('.katex-mathml annotation')).map((a) => a.textContent ?? '')
    const ratio = tex.map((t) => /operatorname\{Var\}\(\\text\{median\}\)\/\\operatorname\{Var\}\(\\text\{mean\}\)=([0-9.]+)/.exec(t)).find(Boolean)
    expect(ratio).toBeTruthy()
    expect(Number(ratio![1])).toBeGreaterThan(1.3)
    expect(Number(ratio![1])).toBeLessThan(1.9)
    expect(strictTexErrors(r.container)).toEqual([])
  }, HEAVY)

  it('MSE vs MAE 警告：μA² = 2 是邊界（沒有穩態、變異數線性成長），> 2 才說指數發散', () => {
    const base = { ...MSE_MAE_DEFAULTS }
    const edge = mseMaeWarnings({ ...base, mu: 2 }, false, null).join('')
    expect(edge).toMatch(/穩定邊界/)
    expect(edge).toMatch(/線性成長/)
    const over = mseMaeWarnings({ ...base, model: 'contaminated', xScale: 2, mu: 0.6 }, false, null).join('')
    expect(over).toMatch(/指數發散/)
    expect(over).toMatch(/\$\|x\|\$ 固定/)
  })
})

// ───────────────────────── 帶入手算的位置、字串屬性的 LaTeX（教學規範 §3、§7） ─────────────────────────

/** 配對的 $...$（與 components/Tex.tsx 的 mathText 相同的規則） */
const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
/** 純文字裡不該出現的「Unicode 拼公式」：下標／上標字元、希臘字母與數學運算符號、w_n / x^2 這種寫法 */
const UNICODE_MATH = /[₀-₉ₐ-ₜ⁰-⁹²³⁴σμδεψρπλτφΔΣΦ≡≤≥≪√±ṽ]|[A-Za-z]_[A-Za-z0-9{(]|[A-Za-z)\]]\^/

/** 字串屬性（支援 $...$）的檢查：每段 $...$ 可被 KaTeX 嚴格解析、$ 成對、$...$ 之外沒有 Unicode 數學 */
function stringPropErrors(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(INLINE_MATH)) {
    try {
      katex.renderToString(m[1], { throwOnError: true, strict: 'ignore' })
    } catch (e) {
      out.push(`${m[1]} ⇒ ${(e as Error).message}`)
    }
  }
  const rest = text.replace(INLINE_MATH, '').replace(/\\\$/g, '')
  if (rest.includes('$')) out.push(`未配對的 $：${text}`)
  if (UNICODE_MATH.test(rest)) out.push(`$...$ 之外有 Unicode 數學：${rest}`)
  return out
}

/** DOM 版：指定容器內、KaTeX 與程式碼之外的文字節點不可有 Unicode 數學 */
function unicodeMathLeaks(root: HTMLElement, selector: string): string[] {
  const out: string[] = []
  for (const box of Array.from(root.querySelectorAll(selector))) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest('.katex, code, pre, select, option')) continue
      const t = n.textContent ?? ''
      if (UNICODE_MATH.test(t)) out.push(`${selector}：${t.trim().slice(0, 80)}`)
    }
  }
  return out
}

/** ExperimentShell 中會以 mathText 渲染的字串屬性所在的容器，加上本章改成 <Tex> 的控制項標籤 */
const STRING_PROP_BOXES = [
  '.c-exp-title',
  '.c-exp-desc',
  '.c-exp-warnings',
  '.c-exp-assumptions',
  '.c-check-note',
  '.c-plot-title',
  '.c-figcaption',
  '.c-callout-title',
  '.c-code-title',
  '.c-code-caption',
  '.c-metric-table tbody td:first-child',
  '.c-param-label',
  '.c-param-unit',
  '.c-param-meta',
].join(', ')

describe('Ch01 帶入手算：放在對應推導之後', () => {
  const SECTION_OF: Record<string, string> = {
    'HC-01.1': 'ch01-s12',
    'HC-01.2': 'ch01-s121',
    'HC-01.3': 'ch01-s13',
    'HC-01.4': 'ch01-s141',
    'HC-01.5': 'ch01-s221',
    'HC-01.6': 'ch01-s23',
    'HC-01.7': 'ch01-s232',
    'HC-01.8': 'ch01-s261',
  }

  it('8 題依序出現在各自的小節內、每題前有「換你算」引言；綜合題（HC-01.8）所在的 §2.6.1 緊接在 §2.7 思考題之前', () => {
    const { container } = renderAt(<Chapter01 />, '/ch/01', 'engineer')
    const boxes = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(boxes.map((el) => el.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    for (const h of HANDCALCS) {
      const el = document.getElementById(`handcalc-${h.id}`)!
      expect(el.closest('section.c-section')?.id, h.id).toBe(SECTION_OF[h.id])
      const wrap = el.closest('.c-chapter-hand')!
      expect(wrap.getAttribute('data-handcalc')).toBe(h.id)
      expect(wrap.querySelector('.c-chapter-hand-lead')?.textContent, h.id).toMatch(/^換你算/)
      // 每題的帶入過程都已渲染（預設「看帶入過程」）且有答案框
      expect(el.querySelectorAll('.c-step').length, h.id).toBeGreaterThanOrEqual(5)
      expect(el.querySelectorAll('.c-handcalc-results .c-texblock').length, h.id).toBeGreaterThanOrEqual(4)
    }
    const s261 = document.getElementById('ch01-s261')!
    const s27 = document.getElementById('ch01-s27')!
    expect(s261.nextElementSibling).toBe(s27)
    expect(s27.querySelectorAll('.c-quiz').length).toBeGreaterThanOrEqual(2)
    // 手算題的預設答案與同一頁的章節數字一致：w* = 3.07619（§1.2 也顯示 6 位）、E[w₂] = 2.28、中位數 3.1397
    expect(document.getElementById('handcalc-HC-01.1')!.querySelector('.c-handcalc-results')!.textContent).toContain('3.07619')
    expect(document.getElementById('ch01-s12')!.textContent).toContain('3.07619')
    expect(document.getElementById('handcalc-HC-01.4')!.textContent).toContain('2.28')
    expect(document.getElementById('handcalc-HC-01.8')!.textContent).toContain('3.1397')
    expect(Array.from(container.querySelectorAll('.c-handcalc .katex-error, .c-handcalc .c-tex-error'))).toEqual([])
    expect(strictTexErrors(container)).toEqual([])
  }, HEAVY)

  it('Beginner 模式也看得到全部 8 題（手算題不被模式收起來）；§1.2.1 的 mseParabola 程式碼只在 Engineer 以上顯示', () => {
    const r = renderAt(<Chapter01 />, '/ch/01', 'beginner')
    expect(r.container.querySelectorAll('.c-handcalc').length).toBe(8)
    expect(r.container.textContent).not.toContain('拋物線只需要三個數')
    r.unmount()
    const r2 = renderAt(<Chapter01 />, '/ch/01', 'engineer')
    expect(r2.container.textContent).toContain('拋物線只需要三個數')
    expect(r2.container.querySelector('.callout-danger')).toBeNull() // 沒有「程式碼載入錯誤」（region 存在）
  }, HEAVY)
})

describe('Ch01 字串屬性的數學一律是 $...$ LaTeX（教學規範 §3）', () => {
  it('兩個實驗的標題、警告、假設、交叉比對附註、圖標題、指標名稱／附註、控制項標籤：KaTeX 之外沒有 Unicode 數學，且沒有 KaTeX 錯誤', () => {
    const cases: [React.ReactNode, string][] = [
      [<LmsPlayground key="a" />, '/ch/01'],
      [<LmsPlayground key="b" />, '/ch/01?preset=lms-playground-divergent'],
      [<LmsPlayground key="c" />, '/ch/01?preset=lms-playground-noisy'],
      [<LmsPlayground key="d" />, '/ch/01?preset=lms-playground-boundary'],
      [<MseMaeLab key="e" />, '/ch/01'],
      [<MseMaeLab key="f" />, '/ch/01?preset=mse-mae-outliers-dc'],
      [<MseMaeLab key="g" />, '/ch/01?preset=mse-mae-outliers-regression'],
      [<MseMaeLab key="h" />, '/ch/01?preset=mse-mae-noise-free-tie'],
      [<MseMaeLab key="i" />, '/ch/01?preset=mse-mae-pm1-codes'],
    ]
    for (const [node, path] of cases) {
      const r = renderAt(node, path)
      expect(unicodeMathLeaks(r.container, STRING_PROP_BOXES), path).toEqual([])
      expectNoTexErrors(r.container, path)
      expect(strictTexErrors(r.container), path).toEqual([])
      // 這些容器確實存在而且有 KaTeX（不是因為選不到元素才「沒有漏網」）
      expect(texOf(r.container.querySelector('.c-exp-assumptions')).length, path).toBeGreaterThan(3)
      expect(texOf(r.container.querySelector('.c-metric-table')).length, path).toBeGreaterThan(3)
      expect(r.container.querySelectorAll('.c-plot-title .katex').length, path).toBeGreaterThan(1)
      expect(r.container.querySelectorAll('.c-param-label .katex').length, path).toBeGreaterThan(3)
      r.unmount()
    }
  }, HEAVY)

  it('整章（Research 模式）：Section／Prereq／Derivation／Quiz／Recap 標題、CodeBlock／Plot 的標題與圖說都沒有 Unicode 數學', () => {
    const { container } = renderAt(<Chapter01 />, '/ch/01', 'research')
    const boxes = `${STRING_PROP_BOXES}, .c-section-title, .c-prereq > summary, .c-derivation-title, .c-quiz-title, .c-recap-title, .c-recap-label, .c-steps-title, .c-texblock-label, .c-code-compare-label`
    expect(unicodeMathLeaks(container, boxes)).toEqual([])
    // 改寫過的幾個標題真的變成 KaTeX 了
    const titleTex = texOf(container.querySelector('#ch01-s111 .c-section-title'))
    expect(titleTex).toEqual(['\\pm10', '\\pm1'])
    expect(Array.from(container.querySelectorAll('.c-prereq > summary')).filter((el) => el.querySelector('.katex')).length).toBeGreaterThanOrEqual(5)
  }, HEAVY)

  it('警告字串的每個分支：$ 成對、可嚴格解析、$...$ 之外沒有 Unicode 數學；渲染後沒有 .katex-error', () => {
    const lab = { ...MSE_MAE_DEFAULTS, model: 'contaminated' as const }
    const all: string[] = [
      ...playgroundWarnings({ ...PLAYGROUND_DEFAULTS, x: 0 }, null),
      ...playgroundWarnings({ ...PLAYGROUND_DEFAULTS, mu: -0.01 }, null),
      ...playgroundWarnings({ ...PLAYGROUND_DEFAULTS, mu: 0 }, null),
      ...playgroundWarnings({ ...PLAYGROUND_DEFAULTS, mu: 0.5 }, null),
      ...playgroundWarnings({ ...PLAYGROUND_DEFAULTS, mu: 0.6 }, 37),
      ...playgroundWarnings({ ...PLAYGROUND_DEFAULTS, mu: 1e-7, x: 3e4 }, null),
      ...mseMaeWarnings({ ...lab, xScale: 0 }, true, null),
      ...mseMaeWarnings({ ...lab, mu: 0 }, true, null),
      ...mseMaeWarnings({ ...MSE_MAE_DEFAULTS, mu: 2 }, false, null),
      ...mseMaeWarnings({ ...lab, xScale: 2, mu: 0.6 }, false, 12),
      ...mseMaeWarnings({ ...lab, xDist: 'pm1', xScale: 1, mu: 2.5 }, false, null),
      ...mseMaeWarnings({ ...lab, xDist: 'gaussian', xScale: 1, mu: 1 }, false, null),
      ...mseMaeWarnings({ ...lab, xDist: 'gaussian', xScale: 1, mu: 3 }, false, null),
      ...mseMaeWarnings({ ...lab, outlierProb: 0.55 }, true, null),
    ]
    expect(all.length).toBeGreaterThanOrEqual(15)
    for (const w of all) {
      expect(stringPropErrors(w), w).toEqual([])
      const { container, unmount } = render(<MathText>{w}</MathText>)
      expectNoTexErrors(container, w)
      expect(container.querySelectorAll('.katex').length, w).toBeGreaterThan(0)
      unmount()
    }
  })

  it('交叉比對附註的每個分支（ok／mismatch／n/a）也都是合法的 $...$ 字串', () => {
    const FOUR: LossDataParams = { model: 'four_point', a: 0, xDist: 'const', xScale: 1, sigma: 0, outlierProb: 0, outlierSize: 0, outlierSign: 'positive', n: 4000, seed: 7 }
    const opts = { w0: 1, mu: 0.2, tie: 'zero' as const, huberDelta: 1 }
    const data = generateLossData(FOUR)
    const ta = timeAverage(runVariantOnData('conventional', data, opts).w)
    const ss = lmsSteadyState(FOUR, opts.mu)
    const lat = signErrorLatticeStationary(FOUR, opts)!
    const fx = timeAverage(signErrorFixedPointRun(data, opts)!.w)
    const ieee = timeAverage(runVariantOnData('sign_error', data, opts).w)
    const clean: LossDataParams = { ...FOUR, model: 'contaminated', a: 3 }
    const notes = [
      lmsAnalyticCheck(ta, ss, 0),
      lmsAnalyticCheck(ta, ss, 0, true),
      lmsAnalyticCheck(ta, { ...ss, mean: 0 }, 0),
      lmsAnalyticCheck(ta, lmsSteadyState(FOUR, 2.5), 0),
      lmsAnalyticCheck({ ...ta, n: 100 }, ss, 0),
      lmsAnalyticCheck(ta, ss, 1),
      lmsAnalyticCheck(ta, { ...ss, seExact: false }, 0),
      lmsAnalyticCheck(timeAverage(runVariantOnData('conventional', generateLossData(clean), opts).w), lmsSteadyState(clean, opts.mu), 0),
      signErrorMcCheck(ieee, lat, opts.mu, opts.w0),
      signErrorMcCheck(ieee, null, opts.mu, opts.w0),
      signErrorMcCheck(ieee, { ...lat, truncated: true }, opts.mu, opts.w0),
      signErrorMcCheck(ieee, lat, opts.mu, 500),
      signErrorFixedPointCheck(fx, lat, opts.w0),
      signErrorFixedPointCheck(fx, { ...lat, mean: lat.mean + 1 }, opts.w0),
      signErrorFixedPointCheck(null, lat, opts.w0),
      signErrorFixedPointCheck(fx, { ...lat, truncated: true }, opts.w0),
      signErrorFixedPointCheck(fx, lat, 500),
    ].map((c) => c.note ?? '')
    expect(new Set(notes).size).toBeGreaterThanOrEqual(14)
    for (const n of notes) expect(stringPropErrors(n), n).toEqual([])
  })

  it('公式登錄（formulas.ts）的 title／conditions：$...$ 可嚴格解析、之外沒有 Unicode 數學', () => {
    for (const fm of FORMULAS) {
      expect(stringPropErrors(fm.title), fm.id).toEqual([])
      expect(stringPropErrors(fm.conditions), fm.id).toEqual([])
    }
    // 至少大部分條目的使用條件含有公式
    expect(FORMULAS.filter((fm) => fm.conditions.includes('$')).length).toBeGreaterThanOrEqual(14)
  })
})


// ───────────────────────── 全站架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端、LMS 的輸入是 PD 的輸出 ─────────────────────────

describe('Ch01 架構約定（docs/assumptions.md §2a）', () => {
  /** 去掉 KaTeX 的 MathML 重複文字，只留顯示出來的字 */
  const shown = (el: Element): string => {
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.katex-mathml').forEach((m) => m.remove())
    return clone.textContent ?? ''
  }

  it('系統地圖的說明、圖 1-2 的 PLL 對應、§1.2.1／§2.6 的提示框、圖 2-9 的導讀：reference 先經過 DTC 才進 PD、回授路徑只有 divider、comparator 取的是 PD 的輸出', async () => {
    // 只渲染有 PLL 敘述的三個區段（整章渲染的記憶體已經很吃緊）
    renderAt(
      <>
        <IntroSection />
        <ParabolaSection />
        <WrapupSection />
      </>,
      '/ch/01',
      'research',
    )
    // 這幾段裡的 <Plot> 載入 Plotly 之後會再更新一次狀態：先讓它跑完，免得更新落在 act 之外
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const sys = document.querySelector('figure.c-sysmap')!
    const t = shown(sys.nextElementSibling!)
    expect(t).toMatch(/reference clock 先經過 DTC、再進 phase detector（PD）/)
    expect(t).toMatch(/回授路徑上只有 divider（或 PMUX）/)
    expect(t).toMatch(/LMS 校正迴路的輸入是 PD 的輸出——送進 loop filter 的同一個訊號，1-bit comparator 取的就是它的正負號/)
    // 圖 1-2 的「連結到 PLL」：物理圖像在這裡第一次給出——feedback edge 早到 a·x、reference 端 DTC 從 T_0 往回扣 w·x（補償量）、PD 量 t_ref' − t_fb
    const pll = document.querySelector('#ch01-s101 .ch01-pll')!
    const p = shown(pll)
    expect(p).toMatch(/feedback（divider）edge 比理想時刻早到/)
    expect(p).toMatch(/reference 端的 DTC 只能延遲、不能提前/)
    expect(p).toMatch(/補償量/)
    expect(p).toMatch(/reference edge 減 feedback edge/)
    expect(p).toMatch(/LMS 看到的就是 PD 的輸出/)
    expect(texOf(pll)).toContain(String.raw`e_n=t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w_n)\,x_n+v_n`) // 與 e_n = y_n − ŷ_n = (a − w_n)x_n + v_n 同一個式子
    // x 是累加器餘數（DTC code），先乘上 w 才去控制 DTC——送進 DTC 的不是 x 本身（約定第 2、4 點：實際的數位字是 C_0 − w·x）
    expect(p).toMatch(/是 DTC 的 code：小數除頻累加器的餘數/)
    expect(p).toMatch(/它先乘上 .{0,6}（gain correction），才去控制 reference 端的 DTC/)
    expect(p).not.toMatch(/送進 DTC 的 code/)
    // a 同時是「feedback edge 早到多少」與「w 該等於多少」
    expect(p).toMatch(/是 DTC 的真實 gain：要把這段時間完全補掉，.{0,4}必須等於它/)
    // DTC 只能延遲：τ_DTC = T_0 − w·x（code 越大延遲越短）；「提前」一定跟著 T_0 的說明出現
    expect(texOf(pll)).toContain(String.raw`\tau_{\mathrm{DTC}}=T_0-w_nx_n`)
    expect(p).toMatch(/基準延遲.{0,6}往回扣/)
    expect(p).toMatch(/code 越大延遲越短，reference edge 等於被提前（少延遲）了/)
    // 兩條 edge 相對於理想時刻的位置：feedback 早到 a·x、reference 早到 w·x，兩式相減才是 (a − w)·x（正負號逐項對得起來）
    expect(texOf(pll)).toContain(String.raw`t_{\mathrm{fb}}=-ax_n`)
    expect(texOf(pll)).toContain(String.raw`t_{\mathrm{ref}}'=-w_nx_n`)
    expect(p).toMatch(/補償不足（.{0,8}）時 reference 還是太晚，扣掉雜訊後誤差為正/)
    // §1.2.1、§2.6 的 PLL 提示框與圖 2-9 的導讀：comparator／LMS 的輸入都明講是 PD 的輸出
    expect(shown(document.querySelector('#ch01-s121 .ch01-pll')!)).toMatch(/它取的是 PD 的輸出.{0,6}（送進 loop filter 的同一個訊號）的正負號/)
    const s26 = shown(document.querySelector('#ch01-s26 .ch01-pll')!)
    expect(s26).toMatch(/校正迴路的輸入是 PD 的輸出 e（送進 loop filter 的同一個訊號），1-bit comparator（BBPD）只取它的正負號/)
    // 係數抖動經 reference 端 DTC 的補償量變成 jitter／spur，不是「DTC 插入的延遲」
    expect(s26).toMatch(/reference 端 DTC 的補償量.{0,4}跟著抖/)
    expect(shown(document.querySelector('[data-diagram="D-01.21"] .c-chapter-fig-walk-body')!)).toMatch(/comparator 取 PD 輸出 e 的正負號/)
  })

  it('符號表：e 是 PD 的輸出、q 是 comparator 取 PD 輸出的正負號、w·x 是 reference 端 DTC 的補償量', () => {
    const { container } = renderAt(<SymbolsSection />)
    const rows = Array.from(container.querySelectorAll('tbody tr')).map(shown)
    expect(rows.find((r) => r.includes('誤差（error）＝量測 − 預測'))).toMatch(/PLL 中是 PD 的輸出（送進 loop filter 的同一個訊號）/)
    expect(rows.find((r) => r.includes('正負號；硬體上'))).toMatch(/comparator 取 PD 輸出 e 的正負號/)
    expect(rows.find((r) => r.includes('我們可以調的參數'))).toMatch(/reference 端 DTC 的補償量是 wx/)
    expect(rows.find((r) => r.includes('黑盒子裡真正的係數'))).toMatch(/DTC 的真實 gain（fs \/ code）：feedback edge 比理想時刻早到 ax/)
    // 「連結到 PLL」用到的 T_0、τ_DTC、t_ref′、t_fb 也收進符號表（教學規範 §5：正文出現的符號都要查得到）
    const t0 = SYMBOLS.find((r) => r.symbol.includes('T_0'))!
    expect(t0.symbol).toBe(String.raw`T_0,\ \tau_{\mathrm{DTC}}`)
    expect(t0.firstSeen).toBe('§1.0.1')
    const t0Row = Array.from(container.querySelectorAll('tbody tr')).find((r) => shown(r).includes('固定基準延遲'))!
    expect(texOf(t0Row)).toContain(String.raw`\tau_{\mathrm{DTC}}=T_0-w_nx_n`)
    expect(shown(t0Row)).toMatch(/DTC 只能延遲，所以從.{0,6}往回扣補償量.*code 越大延遲越短/)
    expect(shown(t0Row)).toMatch(/被 PLL 當成靜態相位偏移吸收/)
    const edgeRow = Array.from(container.querySelectorAll('tbody tr')).find((r) => shown(r).includes('PD 比較的兩條 edge'))!
    expect(texOf(edgeRow)).toEqual(expect.arrayContaining([String.raw`t_{\mathrm{ref}}'=-w_nx_n`, String.raw`t_{\mathrm{fb}}=-ax_n`, String.raw`e_n=t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w_n)\,x_n+v_n`]))
    expect(shown(edgeRow)).toMatch(/經過 DTC 的 reference edge.*divider 回授來的 feedback edge/)
  })

  it('物理圖像與模型的正負號一致：feedback edge 早到 a·x、reference 端 DTC 延遲 T_0 − w·x，PD 量到的 t_ref′ − t_fb 就是 lms.ts 的 e = y − w·x；補償不足時誤差為正、w 往上修', () => {
    const a = 3 // 真實 gain
    const T0 = 10 // 基準延遲：只要 ≥ w·x 的最大值，DTC 的延遲就不會是負的
    for (const w of [1, 2.5, 3, 3.5, 5]) {
      for (const x of [0, 0.125, 0.5, 0.875]) {
        const tFb = -a * x // feedback（divider）edge 比理想時刻早到 a·x
        const tau = T0 - w * x // reference 端 DTC 的延遲：從 T_0 往回扣補償量 w·x
        expect(tau).toBeGreaterThanOrEqual(0) // DTC 只能延遲
        const tRef = tau - T0 // 以理想時刻為零點（T_0 被 PLL 吸收）
        const ePd = tRef - tFb // PD：reference edge 減 feedback edge
        const lms = conventionalStep({ w, x, y: a * x, mu: 0.1 })
        expect(ePd).toBeCloseTo(lms.e, 12)
        expect(ePd).toBeCloseTo((a - w) * x, 12)
        // 補償不足（w < a）→ 誤差為正；過度補償 → 為負；x = 0 或 w = a → 0
        expect(Math.sign(ePd)).toBe(x === 0 ? 0 : Math.sign(a - w))
        // 更新式不變：w ← w + μ·e·x（LMS）與 w ← w + μ·sign(e)·x（Sign-Error）都把 w 往 a 修
        expect(Math.sign(lms.w - w)).toBe(x === 0 ? 0 : Math.sign(a - w))
        const se = signErrorStep({ w, x, y: a * x, mu: 0.1 })
        expect(se.dw).toBeCloseTo(0.1 * Math.sign(ePd) * x, 12)
      }
    }
  })

  it('本章的原始檔裡沒有舊接法的說法：DTC 在回授路徑／divider 之後、DTC 插入延遲、把 edge 推回、DTC 延遲 feedback、PD 後面的 comparator，也沒有 feedback 側注入的極性', () => {
    const dir = `${process.cwd()}/src/chapters/ch01/`
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = `${d}${e.name}`
        if (e.isDirectory()) walk(`${full}/`)
        else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(full)
      }
    }
    walk(dir)
    expect(files.length).toBeGreaterThanOrEqual(15)
    const bad = [/DTC 在回授/, /回授路徑上的 DTC/, /divider[^。]{0,12}(之後|經過 DTC)/, /DTC 插入/, /插入延遲/, /推回/, /DTC 延遲/, /PD 後面/, /DTC gain 所在/, /feedback 側/, /回授側/]
    const oldPolarity = [/e_\{?\\?(mathrm\{)?PD/, /\\theta_\{?\\?(mathrm\{)?out/, /phi_\{?\\?(mathrm\{)?dtc/]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const re of [...bad, ...oldPolarity]) expect(src, `${f} ${re}`).not.toMatch(re)
    }
  })
})

// ───────────────────────── 外部審查（docs/reviews/2026-10-12-codex-review.md）R08、C09 ─────────────────────────

describe('審查 R08：F-01.16 右式（μ/2、μ、0）是小步長近似，不是精確式', () => {
  const FOUR: LossDataParams = { model: 'four_point', a: 0, xDist: 'const', xScale: 1, sigma: 0, outlierProb: 0, outlierSize: 0, outlierSign: 'positive', n: 4000, seed: 7 }

  it('公式登錄與反例一致：claim 是 approx、公式用 ≈ 並寫出 μ ≪ 10、條件列出修正量 (10 + μ)/(3^{1+10/μ} − 1) 與 μ = 5 的 25/13；登錄引用的每個數字都由格點鏈重算', () => {
    const f16 = FORMULAS.find((fm) => fm.id === 'F-01.16')!
    expect(f16.claim).toBe('approx')
    expect(f16.tex).toContain(String.raw`\approx`)
    expect(f16.tex).toContain(String.raw`\mu\ll10`)
    expect(f16.tex).not.toContain(String.raw`\overline{w}=\tfrac{\mu}{2}`)
    expect(f16.tex).toContain(String.raw`\big|\,\overline{w}-w_{L1}\big|=O(\mu|x|)`) // 左式（E40 的容忍帶）不變
    expect(f16.conditions).toContain(String.raw`\mu\ll10`)
    expect(f16.conditions).toContain(String.raw`3^{1+10/\mu}-1`)
    expect(f16.conditions).toContain(String.raw`$10/\mu$ 為正整數時`) // 單一修正量的適用條件跟著公式走
    expect(f16.conditions).toContain(String.raw`量級 $3^{-10/\mu}$`) // 「小於」只對 sign(0) = 0 成立，登錄裡只說量級
    expect(f16.conditions).toMatch(/小步長近似/)
    expect(f16.conditions).toMatch(/直接解格點鏈/)
    expect(f16.conditions).toMatch(/見 F-01\.18/)
    expect(f16.erratumId).toBe('E40')
    // 條件裡寫的數字：μ = 0.2 約 4.7e−24、μ = 1 約 6.2e−5、μ = 5 是 25/13 ≈ 1.923 而非 2.5
    const corr = (mu: number) => (10 + mu) / (3 ** (1 + 10 / mu) - 1)
    expect(f16.conditions).toContain(String.raw`$\mu=0.2$ 約 $4.7\times10^{-24}$`)
    expect(corr(0.2).toExponential(1)).toBe('4.7e-24')
    expect(f16.conditions).toContain(String.raw`$\mu=1$ 約 $6.2\times10^{-5}$`)
    expect(corr(1).toExponential(1)).toBe('6.2e-5')
    expect(f16.conditions).toContain(String.raw`$25/13\approx1.923$ 而非 $2.5$`)
    const big = signErrorLatticeStationary(FOUR, { w0: 0, mu: 5, tie: 'zero' })!
    expect(big.mean).toBeCloseTo(25 / 13, 12)
    expect(big.mean.toFixed(3)).toBe('1.923')
    expect(big.mean).toBeCloseTo(5 / 2 - corr(5), 12)
    // 三種慣例在 μ = 1（10/μ 是整數）都少同一個修正量
    const at1 = (['zero', 'plus', 'minus'] as const).map((tie) => signErrorLatticeStationary(FOUR, { w0: 0, mu: 1, tie })!.mean)
    expect(at1[0]).toBeCloseTo(0.5 - corr(1), 12)
    expect(at1[1]).toBeCloseTo(1 - corr(1), 12)
    expect(at1[2]).toBeCloseTo(-corr(1), 12)
    // F-01.15（精確）與 F-01.18（近似）不受影響
    expect(FORMULAS.find((fm) => fm.id === 'F-01.15')!.claim).toBe('exact')
    expect(FORMULAS.find((fm) => fm.id === 'F-01.18')!.claim).toBe('approx')
  })

  it('MSE vs MAE Lab：Sign-Error 兩列的解析值是格點鏈的解（標籤仍是精確），附註說明它不是 F-01.16 右式；Gaussian x 沒有格點鏈時不出現這句話', () => {
    const r = renderAt(<MseMaeLab />)
    const rows = Array.from(r.container.querySelectorAll('.c-metric-table tbody tr'))
    const pick = (re: RegExp) => rows.find((tr) => re.test(shownText(tr.querySelector('td'))))!
    for (const re of [/Sign-Error 時間平均（IEEE double/, /Sign-Error 定點（整數 code）時間平均/]) {
      const row = pick(re)
      expect(shownText(row.querySelector('td')), String(re)).toContain('analytic = 格點鏈數值解（不是 F-01.16 右式的小步長近似）；容忍度')
      expect(row.querySelector('.c-claim')?.className, String(re)).toMatch(/c-claim-exact/)
      expect(row.querySelector('a[data-formula-link="F-01.16"]'), String(re)).toBeTruthy()
      // 預設 μ = 0.2、w0 = 1：解析值 0.1（= μ/2，差 4.7e−24）
      expect(row.querySelector('td[data-label="解析值"]')?.textContent, String(re)).toBe('0.1')
    }
    r.unmount()
    const g = renderAt(<MseMaeLab />, '/ch/01?preset=mse-mae-outliers-regression')
    expect(g.container.textContent).not.toContain('格點鏈數值解')
    const gRow = Array.from(g.container.querySelectorAll('.c-metric-table tbody tr')).find((tr) => /Sign-Error 時間平均（IEEE double/.test(shownText(tr.querySelector('td'))))!
    expect(gRow.querySelector('td[data-label="解析值"]')?.textContent).toBe('')
    expect(shownText(gRow.querySelector('td'))).toMatch(/^Sign-Error 時間平均（IEEE double.*容忍度/)
    g.unmount()
  })

  it('MSE vs MAE Lab「試試看 (2)」：把 μ 調到 1（預設 w0 = 1、sign(0) = 0）⇒ 指標表的解析值真的顯示 0.499938，不是 μ/2 = 0.5；文字引用的數字由同一個格點鏈函式算出', async () => {
    expect(TRY_MU1).toBe(1)
    expect(MSE_MAE_DEFAULTS.w0).toBe(1)
    expect(MSE_MAE_DEFAULTS.tie).toBe('zero')
    expect(TRY_MU1_LATTICE_MEAN).toBeCloseTo(44281 / 88573, 12)
    expect(TRY_MU1_LATTICE_MEAN).toBe(signErrorLatticeStationary(FOUR, { w0: MSE_MAE_DEFAULTS.w0, mu: TRY_MU1, tie: 'zero' })!.mean)
    const r = renderAt(<MseMaeLab />)
    const tryTex = texOf(r.container.querySelector('.ch01-try'))
    expect(tryTex).toContain('0.499938')
    expect(tryTex).toContain(String.raw`\mu/2=0.5`)
    expect(tryTex).toContain(String.raw`\mu\ll10`)
    expect(shownText(r.container.querySelector('.ch01-try'))).toMatch(/看定點時間平均變成約.*的近似.*指標表的解析值（格點鏈）是.*被忽略的上邊界開始看得見/)
    // 真的照做一次：在 μ 的輸入框打 1
    const muInput = r.container.querySelector('input[aria-label="μ（學習率）"]:not([type="range"])') as HTMLInputElement
    expect(muInput).toBeTruthy()
    act(() => {
      fireEvent.change(muInput, { target: { value: '1' } })
    })
    const analytic = () => {
      const row = Array.from(r.container.querySelectorAll('.c-metric-table tbody tr')).find((tr) => /Sign-Error 定點（整數 code）時間平均/.test(shownText(tr.querySelector('td'))))!
      return row.querySelector('td[data-label="解析值"]')?.textContent
    }
    await waitFor(() => expect(analytic()).toBe('0.499938'), { timeout: 60_000 })
    expect(strictTexErrors(r.container)).toEqual([])
  })

  it('同一類的另一句（思考題 3，{1,2,3,100}）：「時間平均落在區間中點」也是忽略格點鏈遠端的小步長近似——標籤是近似；μ = 0.05、0.01 只差不到 1e−10，μ = 0.2 已是 2.50053', () => {
    const Q3: LossDataParams = { ...FOUR, values: [1, 2, 3, 100] }
    const meanAt = (p: LossDataParams, mu: number) => signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })!.mean
    // 期望值由獨立的有理數計算得到（Python Fraction，格點 1…100 整條鏈、不截斷）：
    // μ = 1/5 → 2.5005292561011467；μ = 1/20 → 2.5 + 1.0266e−11；μ = 1/100 → 2.5 + 1.4e−50
    expect(meanAt(Q3, 0.2)).toBeCloseTo(2.5005292561011467, 12)
    expect(meanAt(Q3, 0.2) - 2.5).toBeGreaterThan(5e-4) // 步長不小時看得出來：不是中點
    expect(meanAt(Q3, 0.05) - 2.5).toBeGreaterThan(0.9e-11)
    expect(meanAt(Q3, 0.05) - 2.5).toBeLessThan(1.2e-11)
    for (const mu of [0.05, 0.01]) expect(Math.abs(meanAt(Q3, mu) - 2.5)).toBeLessThan(1e-10) // 文字說的「只差不到 10^{-10}」
    // 正常對照：兩端離區間一樣遠的資料 {1,2,3,4}（格點對 2.5 對稱）⇒ 任何步長的時間平均都是中點（只剩 double 的捨入）
    const SYM: LossDataParams = { ...FOUR, values: [1, 2, 3, 4] }
    for (const mu of [1, 0.5, 0.2, 0.05]) expect(Math.abs(meanAt(SYM, mu) - 2.5), `μ=${mu}`).toBeLessThan(1e-13)
    // 畫面：解析最後的附註
    const { container } = renderAt(<WrapupSection />)
    const quiz = Array.from(container.querySelectorAll('.c-quiz')).find((q) => q.textContent?.includes('思考題 3')) as HTMLElement
    act(() => {
      fireEvent.click(within(quiz).getByText('看答案與解析'))
    })
    const note = Array.from(quiz.querySelectorAll('.c-quiz-answer p')).find((el) => (el.textContent ?? '').includes('區間中點')) as HTMLElement
    expect(note).toBeTruthy()
    expect(note.querySelector('.c-claim')?.className).toMatch(/c-claim-approx/)
    const txt = shownText(note)
    expect(txt).toMatch(/時間平均落在區間中點，只是因為這組資料在區間兩側對稱/)
    expect(txt).toMatch(/而且步長很小——和 F-01\.16\s*的右式一樣，這是忽略格點鏈遠端的近似/)
    expect(txt).toMatch(/上面兩個步長與中點只差不到.{0,8}，但.{0,8}時時間平均已是/)
    expect(txt).toMatch(/偶數筆資料時，MAE 本身並不偏好區間內的任何一點/)
    expect(txt).not.toMatch(/剛好是區間中點/)
    expect(texOf(note)).toEqual(expect.arrayContaining([String.raw`P(y<2)=P(y>3)`, '10^{-10}', String.raw`\mu=0.2`, '2.50053']))
    // 解析裡兩個步長顯示的時間平均仍是 2.5（4 位有效數字）
    const means = texOf(quiz.querySelector('.c-quiz-answer')).flatMap((t) => Array.from(t.matchAll(/overline w=([0-9.]+)/g), (m) => Number(m[1])))
    expect(means).toEqual([2.5, 2.5])
    expect(strictTexErrors(container)).toEqual([])
  })
})

describe('審查 C09：normal equation E[e*x] = 0 是「正交」；等於「不相關」還需要 E[x] = 0 或 E[e*] = 0', () => {
  it.each(['engineer', 'beginner'] as const)('§1.2／§1.2.1（%s 模式）：標題與正文以正交為主詞，公式旁有名稱、成立條件與三筆資料的數字；先備知識與 w* = a 的條件同步', async (mode) => {
    const { container } = renderAt(<ParabolaSection />, '/ch/01', mode)
    // <Plot> 載入 Plotly 之後會再更新一次狀態：先讓它跑完
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const s121 = document.getElementById('ch01-s121')!
    const title = s121.querySelector('.c-section-title')!.textContent ?? ''
    expect(title).toBe('1.2.1 Normal equation：最佳解處「誤差與輸入正交」')
    expect(title).not.toContain('不相關')
    // 名稱與成立條件就在 F-01.5 的正下方，所有模式都看得到（不是收在推導或先備知識裡）
    const note = document.getElementById('formula-F-01.5')!.nextElementSibling as HTMLElement
    expect(note.closest('details')).toBeNull()
    const noteText = shownText(note)
    expect(noteText).toMatch(/名稱與成立條件/)
    expect(noteText).toMatch(/叫做誤差與輸入正交（orthogonal）/)
    expect(noteText).toMatch(/不需要對雜訊做任何假設/)
    expect(noteText).toMatch(/不是同一句話：兩者只有在.{0,12}或.{0,12}時才相同/)
    expect(noteText).toMatch(/相關器累加的是.{0,6}本身，不會先扣掉平均，所以它檢查的是正交/)
    // GMAC 累加的是誤差的正負號乘上輸入（下面的「連結到 PLL」）：同樣不扣平均，但不能說它累加的是 e·x 本身
    expect(noteText).toMatch(/（PLL 的 GMAC 也一樣不扣平均，只是誤差先取了正負號，見下面的「連結到 PLL」）/)
    expect(noteText).not.toMatch(/相關器（以及 PLL 的 GMAC）累加的是/)
    expect(noteText).toMatch(/零均值且與.{0,4}獨立，則/)
    expect(shownText(document.querySelector('#ch01-s121 .ch01-pll'))).toMatch(/^連結到 PLL/)
    expect(note.querySelector('.c-claim')?.className).toMatch(/c-claim-exact/)
    const tex = texOf(note)
    expect(tex).toEqual(expect.arrayContaining(['E[e^*x]=0', 'E[x^2]>0', String.raw`E[e^*x]=E[e^*]\,E[x]`, 'E[x]=0', 'E[e^*]=0']))
    // 三筆資料 x = (1, 2, 4)、y = (3.2, 5.7, 12.5)：E[e*] = −2/45、E[x] = 7/3、E[e*]E[x] = −14/135（即時計算）
    expect(tex).toContain('E[e^*]=-0.04444')
    expect(tex).toContain('E[x]=2.333')
    expect(tex).toContain(String.raw`E[e^*]\,E[x]=-0.1037\ne0`)
    // 舊說法不再出現
    expect(shownText(container)).not.toMatch(/誤差與輸入不相關/)
    expect(shownText(container)).not.toMatch(/本章稱為不相關|本章的雜訊.{0,6}零均值，所以不區分/)
    // §1.2 的先備知識：E[xy] = 0 叫正交；不相關是 E[xy] = E[x]E[y]；零均值時才是同一件事
    const pre = shownText(document.querySelector('#ch01-s12 .c-prereq'))
    expect(pre).toMatch(/稱為正交（orthogonal）/)
    expect(pre).toMatch(/不相關（uncorrelated）是指/)
    expect(pre).toMatch(/雜訊.{0,4}零均值時，.{0,10}說成正交或不相關都可以/)
    expect(pre).toMatch(/最佳誤差.{0,6}平均不一定是 0（輸入.{0,4}的平均也不一定是 0），那裡要說「正交」/)
    // w* = a 的條件是 E[xv] = 0（正交）；v 零均值、與 x 不相關就足夠
    const s12 = shownText(document.getElementById('ch01-s12'))
    expect(s12).toMatch(/只有在雜訊與輸入正交（.{0,10}：相乘再平均等於 0）時，最小平方解才等於真值/)
    expect(s12).toMatch(/零均值、與.{0,4}不相關（Ch00 §0\.7\s*的定義）就足夠/)
    // F-01.5 本身不變；相關器的說法（相關 E[e x]、相關歸零就停）保留
    expect(texOf(document.getElementById('formula-F-01.5')!.querySelector('.c-texblock-math'))).toEqual([String.raw`\boxed{E[e^*x]=0}`])
    expect(shownText(document.getElementById('formula-F-01.5')!.querySelector('.c-texblock-label'))).toBe('Normal equation（正交原理）')
    expect(shownText(s121)).toMatch(/相關歸零就停/)
    expectNoTexErrors(container)
    expect(strictTexErrors(container)).toEqual([])
  })

  it('公式登錄 F-01.5／F-01.4 與「本課必記」：公式與標籤不變，條件改以正交為主詞並寫出何時等於不相關', () => {
    const f5 = FORMULAS.find((fm) => fm.id === 'F-01.5')!
    expect(f5.claim).toBe('exact')
    expect(f5.title).toBe('Normal equation（正交原理）')
    expect(f5.tex).toBe(String.raw`E[e^*x]=E\big[(y-w^*x)\,x\big]=0`)
    expect(f5.conditions).toMatch(/正交/)
    expect(f5.conditions).toMatch(/E\[x\]=0/)
    expect(f5.conditions).toMatch(/E\[e\^\*\]=0/)
    expect(f5.conditions).toMatch(/只需 \$E\[x\^2\]>0\$/)
    expect(f5.conditions).not.toMatch(/誤差與輸入不相關/)
    const f4 = FORMULAS.find((fm) => fm.id === 'F-01.4')!
    expect(f4.claim).toBe('exact')
    expect(f4.tex).toBe(String.raw`w^*=\frac{E[xy]}{E[x^2]}=a+\frac{E[xv]}{E[x^2]}`)
    expect(f4.conditions).toMatch(/E\[xv\]=0/)
    expect(f4.conditions).toMatch(/正交/)
    const { container } = renderAt(<WrapupSection />)
    const label = Array.from(container.querySelectorAll('.c-recap-label')).find((el) => (el.textContent ?? '').includes('Normal equation'))!
    expect(label.textContent).toBe('Normal equation：最佳解處誤差與輸入正交')
    expect(label.textContent).not.toContain('不相關')
    expect(texOf(label.parentElement)).toContain(String.raw`\boxed{E[e^*x]=0}`)
  })
})
