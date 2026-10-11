import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import katex from 'katex'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
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
} from './experiments/MseMaeLab'
import { MedianExampleSection } from './sections/MedianExample'
import { WrapupSection } from './sections/Wrapup'
import { SYMBOLS, SymbolsJump, SymbolsSection } from './symbols'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) } }))

function renderAt(node: React.ReactNode, path = '/ch/01', mode: 'beginner' | 'engineer' | 'research' = 'engineer') {
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* ignore */
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>,
  )
}

// 整章渲染（上千個 KaTeX 公式 + 兩個實驗 + 8 題帶入手算）在 CI 或多個測試行程同時執行時遠超過預設 5 s；
// 這裡只放寬逾時（機器負載高時整章渲染一次可能要一分鐘以上），不放寬任何斷言。
const HEAVY = 300_000
// 沒有另外指定逾時的測試（單一實驗的渲染、警告字串…）
vi.setConfig({ testTimeout: 120_000 })

/**
 * 嚴格檢查頁面上所有 TeX：共用的 <Tex> 以 throwOnError:false 渲染，「未定義的控制序列」（例如把 \\mu 和 e 黏成 \\mue）
 * 只會變成紅字、不會有 .katex-error class，所以要把每個公式的原始碼（MathML annotation）用 throwOnError:true 重新解析一次。
 */
function strictTexErrors(root: HTMLElement): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const ann of Array.from(root.querySelectorAll('.katex-mathml annotation'))) {
    const src = ann.textContent ?? ''
    if (seen.has(src)) continue
    seen.add(src)
    try {
      katex.renderToString(src, { throwOnError: true, strict: 'ignore' })
    } catch (e) {
      out.push(`${src} ⇒ ${(e as Error).message}`)
    }
  }
  // KaTeX 把未定義指令畫成 #cc0000 的紅字
  for (const el of Array.from(root.querySelectorAll('.katex [mathcolor="#cc0000"]'))) out.push(`紅字：${el.textContent}`)
  expect(seen.size).toBeGreaterThan(0)
  return out
}

/** 元素內所有 KaTeX 公式的原始碼（MathML annotation） */
const texOf = (root: Element | null): string[] => Array.from(root?.querySelectorAll('.katex-mathml annotation') ?? []).map((a) => a.textContent ?? '')

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
    // 章首只留一行「本章符號表在最後 ↓」，排在 §1.0 之前
    // （整章的 DOM 很大：這裡用 selector，不用 getByRole——後者會對每個按鈕跑 getComputedStyle；按鈕的 role／行為在下面的小測試檢查）
    const jumps = container.querySelectorAll('.ch01-symbols-jump')
    expect(jumps).toHaveLength(1)
    expect(jumps[0].textContent?.trim()).toBe('本章符號表在最後 ↓')
    expect(jumps[0].querySelector('button')).toBeTruthy()
    expect(after(jumps[0], document.getElementById('ch01-s10')!)).toBe(true)
    expect(after(jumps[0], container.querySelector('.ch01-chapter > .callout')!)).toBe(true)
    // 勘誤標籤都連到驗證頁
    const errata = Array.from(container.querySelectorAll('a.ch01-erratum'))
    const ids = new Set(errata.map((a) => a.getAttribute('data-erratum')))
    for (const id of ['E38', 'E39', 'E40', 'E41', 'E43']) expect(ids.has(id)).toBe(true)
    for (const a of errata) expect(a.getAttribute('href')).toBe('#/verification')
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
    expect(Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)).toEqual([])
    expect(strictTexErrors(container)).toEqual([])
    // Engineer 模式：逐步推導直接展開（StepDerivation）
    expect(container.querySelectorAll('.c-steps').length).toBeGreaterThan(10)
    // §2.3.2：連續雜訊下 Sign-Error 的抖動（F-01.18）與 π/2 的代價
    expect(screen.getAllByText(/2\.3\.2 有連續雜訊時/).length).toBeGreaterThan(0)
    // 公式 ID 都有錨點（F-01.17 只在 Research 模式出現）
    for (const fm of FORMULAS.filter((x) => x.id !== 'F-01.17')) expect(document.getElementById(`formula-${fm.id}`), fm.id).toBeTruthy()
  }, HEAVY)

  it('Research 模式顯示 Markov 鏈與污染資料段落；Beginner 模式收合推導', () => {
    const r1 = renderAt(<Chapter01 />, '/ch/01', 'research')
    expect(screen.getByText(/2\.4 （Research）/)).toBeTruthy()
    for (const fm of FORMULAS) expect(document.getElementById(`formula-${fm.id}`), fm.id).toBeTruthy()
    // 所有 TeX 都能被 KaTeX 正確解析（throwOnError: false 時錯誤會變成 .katex-error）
    const bad = Array.from(r1.container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.getAttribute('title') ?? e.textContent)
    expect(bad).toEqual([])
    expect(strictTexErrors(r1.container)).toEqual([])
    expect(screen.getAllByText(/流量平衡/).length).toBeGreaterThan(0)
    r1.unmount()
    const r2 = renderAt(<Chapter01 />, '/ch/01', 'beginner')
    expect(strictTexErrors(r2.container)).toEqual([])
    // F-01.18（連續雜訊下的抖動）在所有模式都顯示
    expect(document.getElementById('formula-F-01.18')).toBeTruthy()
    expect(screen.queryByText(/2\.4 （Research）/)).toBeNull()
    expect(r2.container.querySelectorAll('.c-steps').length).toBeLessThan(10)
    r2.unmount()
  }, HEAVY)
})

describe('Ch01 符號表在章末（教學規範 §5）', () => {
  it('章首那一行是按鈕（不是會改 HashRouter 路由的 href）：點了以後捲到 #symbols 並把焦點帶過去；章末的「回到章首」捲回 §1.0', () => {
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
          <SymbolsJump />
          <SymbolsSection />
        </>,
      )
      const hashBefore = window.location.hash
      const jump = screen.getByRole('button', { name: /本章符號表在最後/ })
      expect(jump.tagName).toBe('BUTTON')
      expect(jump.getAttribute('type')).toBe('button')
      expect(container.querySelector('a[href="#symbols"], a[href$="#symbols"]')).toBeNull()
      const symbols = document.getElementById('symbols') as HTMLElement
      expect(jump.getAttribute('aria-controls')).toBe('symbols')
      act(() => {
        fireEvent.click(jump)
      })
      expect(scrolled).toEqual([symbols])
      expect(document.activeElement).toBe(symbols)
      expect(window.location.hash).toBe(hashBefore)
      act(() => {
        fireEvent.click(within(symbols).getByRole('button', { name: /回到章首/ }))
      })
      expect(scrolled).toEqual([symbols, document.getElementById('ch01-s10')])
      expect(window.location.hash).toBe(hashBefore)
      // 表的內容不變：每列都有符號（KaTeX）與意義，沒有 KaTeX 錯誤
      expect(symbols.querySelectorAll('tbody tr')).toHaveLength(SYMBOLS.length)
      expect(new Set(SYMBOLS.map((r) => r.symbol)).size).toBe(SYMBOLS.length)
      expect(symbols.querySelector('.katex-error, .c-tex-error')).toBeNull()
      expect(strictTexErrors(symbols)).toEqual([])
    } finally {
      proto.scrollIntoView = original
    }
  })

  it('沒有 scrollIntoView 的環境（jsdom、很舊的瀏覽器）點了也不會丟錯', () => {
    renderAt(
      <>
        <SymbolsJump />
        <SymbolsSection />
      </>,
    )
    expect(() => {
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /本章符號表在最後/ }))
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
    // 章首的勘誤框在 §1.0 之前就用到 δ、sign(0)、J₂：框內也各有一句說明
    const errataBox = container.querySelector('.ch01-chapter > .callout') as HTMLElement
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
    expect(shell.querySelector('.c-check-ok')?.getAttribute('title')).toMatch(/Freeze 自 \$n=3\$/)
    expect(texOf(shell.querySelector('.c-check-ok'))).toContain('n=3')
    act(() => {
      fireEvent.click(screen.getByText('重設 Reset'))
    })
    expect(label()).toContain('= 0')
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
    expect(host.querySelector('.katex-error')).toBeNull() // 這就是原本的測試漏掉它的原因
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
    const rows = Array.from(shell.querySelectorAll('.callout table tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''))
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
      const wrap = el.closest('.ch01-handcalc')!
      expect(wrap.getAttribute('data-handcalc')).toBe(h.id)
      expect(wrap.querySelector('.ch01-handcalc-invite')?.textContent, h.id).toMatch(/^換你算/)
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
      expect(Array.from(r.container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent), path).toEqual([])
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
      expect(container.querySelector('.katex-error, .c-tex-error'), w).toBeNull()
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

