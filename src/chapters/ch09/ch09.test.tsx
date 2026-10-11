import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, type LearningMode } from '@/app/settings'
import { presetById, presetsForExperiment } from '@/app/presets'
import { MathText, listRegions, systemMapChart } from '@/components'
import peSrc from '@/simulation/models/pe.ts?raw'
import mimoPy from '../../../golden/lms_pll_golden/mimo.py?raw'
import { gaugeAnalysis, gaugeDriftStd, peAnalytic, simulatePeLab } from '@/simulation/models/pe'
import { designDtLoop } from '@/simulation/models/pll'
import Chapter09 from './index'
import { CH09_DIAGRAMS, SYSTEM_FOCUS } from './diagrams'
import { FORMULAS } from './formulas'
import { PE_DEFAULT, PE_LIMITS, blocksForConvergence, derivedGain, mcModalCheck, sanitizePeState, switchDetector, switchKqMode } from './experiments/peLabState'
import { GAUGE_DEFAULT, gaugeTfTex, gaugeWarningTex, sanitizeGaugeState, toGaugeParams } from './experiments/gaugeLabState'
import { pyFunction } from './pyExcerpt'
import { texNum } from './shared'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: mermaidMock }))

/**
 * 整章渲染＋inline worker 的 Monte Carlo：機器閒置時每個測試 2–10 秒，但多組測試同時跑（load average 上百）時
 * 曾超過原本的 25 秒／60 秒而逾時。條件一成立 waitFor 就返回，所以放寬上限不會讓正常情況變慢。
 */
const WAIT = { timeout: 60000, interval: 200 }
const PAGE_TIMEOUT = 150000

function renderChapter(url = '/ch/09', mode: LearningMode = 'engineer') {
  localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <Chapter09 />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  localStorage.clear()
  // 這個檔案會把整章渲染十次；下面兩件事若不做，每一次的 jsdom 樹（約 400 MB）都會留在 heap 裡，
  // worker 逼近 4 GB 上限後 GC 空轉（waitFor 逾時），最後 OOM：
  // (1) vi.fn 會保留每一次呼叫的引數：Plotly.react(el, data, …) 的 el 是章節 DOM 內的節點，data 是整組 trace。
  for (const fn of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize, mermaidMock.initialize, mermaidMock.render]) fn.mockClear()
  // (2) jsdom 的選擇器引擎會快取每個選擇器字串最後一次查詢的 context 與結果節點。
  clearSelectorCaches()
})

/**
 * 清掉 jsdom 選擇器引擎（nwsapi）的快取。nwsapi 為每一個「選擇器字串」保留最後一次查詢的 context 與結果
 * （node_modules/nwsapi/src/nwsapi.js 的 selectResolvers／matchResolvers），所以 querySelector(All)、screen.getByText、
 * getAllByRole 用過的每個獨特選擇器，都會在 unmount 之後繼續抓著那一次的整棵章節 DOM。
 * nwsapi 的 configure(option, clear = true) 會清空這些快取；實例掛在 Document 的 impl 物件上（jsdom 的內部欄位，
 * 找不到時什麼都不做——只影響記憶體，不影響任何斷言）。
 */
function clearSelectorCaches(): void {
  interface SelectorEngine {
    configure: (option: Record<string, boolean>, clear: boolean) => unknown
  }
  const isEngine = (v: unknown): v is SelectorEngine => typeof v === 'object' && v !== null && typeof (v as SelectorEngine).configure === 'function'
  for (const sym of Object.getOwnPropertySymbols(document)) {
    const impl = (document as unknown as Record<symbol, unknown>)[sym]
    if (typeof impl !== 'object' || impl === null) continue
    for (const key of ['_nwsapi', '_nwsapiDontThrow']) {
      const engine = (impl as Record<string, unknown>)[key]
      if (isEngine(engine)) engine.configure({}, true)
    }
  }
}

function reactWarnings(): string[] {
  return errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => /Warning|Each child|unique "key"/.test(s))
}

describe('Ch09 smoke test（jsdom）', () => {
  it.each(['beginner', 'engineer', 'research'] as const)('以 %s 模式渲染整章不拋錯、沒有 React 警告', async (mode) => {
    const { container } = renderChapter('/ch/09', mode)
    expect(screen.getByText('這一課要回答的問題')).toBeTruthy()
    // 符號表移到章末（docs/teaching-style.md §5）：只有一張，是整章最後一個區塊（id="symbols"），在「本課必記」之後；
    // 章首（第一節之前）只留一行「本章符號表在最後」的按鈕
    const root = container.querySelector('.ch09') as HTMLElement
    const symbols = root.lastElementChild as HTMLElement
    expect(symbols.id).toBe('symbols')
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(container.querySelector('.c-recap') as Element, symbols)).toBe(true)
    expect(follows(container.querySelector('#ch09-pll') as Element, symbols)).toBe(true)
    const symbolsLink = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('本章符號表在最後'))
    expect(symbolsLink).toBeTruthy()
    expect(follows(symbolsLink as Element, container.querySelector('#ch09-intro') as Element)).toBe(true)
    // 方塊圖（docs/teaching-style.md §8）：章首系統地圖＋本章清單的每一張，三種模式都顯示（不藏在 ModeGate 裡）
    expect(container.querySelectorAll('figure.c-mermaid')).toHaveLength(CH09_DIAGRAMS.length + 1)
    expect(Array.from(container.querySelectorAll('.ch09-diagram')).map((el) => el.getAttribute('data-diagram'))).toEqual(CH09_DIAGRAMS.map((d) => d.id))
    expect(container.querySelectorAll('.c-quiz').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelector('.c-recap')).toBeTruthy()
    expect(container.querySelectorAll('.c-prereq').length).toBeGreaterThanOrEqual(6)
    expect(container.querySelectorAll('.c-code').length).toBeGreaterThanOrEqual(8)
    // 8 題「帶入手算」在每一種模式都顯示（位置與順序的檢查在 handcalcs.test.tsx）
    expect(Array.from(container.querySelectorAll('section.c-handcalc')).map((el) => el.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((i) => `handcalc-HC-09.${i}`))
    // 兩個實驗都在
    expect(container.querySelectorAll('.c-exp, [data-experiment], section').length).toBeGreaterThan(0)
    expect(screen.getByText(/PE \/ Eigen Lab：correlation ellipse/)).toBeTruthy()
    expect(screen.getByText(/四相 One-Hot ＋ Global Offset：兩組參數、同一個輸出/)).toBeTruthy()
    // 勘誤標記連到 verification
    const errata = Array.from(container.querySelectorAll('a.ch09-erratum')).map((a) => a.textContent ?? '')
    for (const id of ['E04', 'E05', 'E08', 'E22', 'E23']) expect(errata.some((t) => t.includes(id))).toBe(true)
    // 每個勘誤標記都連到驗證頁，並以 ?e=Exx 深連結到該項勘誤卡片
    for (const a of Array.from(container.querySelectorAll('a.ch09-erratum'))) {
      const id = /E\d\d/.exec(a.textContent ?? '')?.[0]
      expect(a.getAttribute('href')).toBe(`#/verification?e=${id}`)
    }
    // MC 與 gauge 計算（inline worker）完成後，不應出現計算失敗
    await waitFor(() => expect(container.textContent).toMatch(/MC：\d+ chains/), WAIT)
    // 圖標題是 `raw-x：$\boldsymbol\theta$ 與 $\boldsymbol\theta'$ 的輸出逐點重合`（符號以 KaTeX 顯示）
    await waitFor(() => expect(container.textContent).toContain('的輸出逐點重合'), WAIT)
    expect(container.textContent).toContain(String.raw`\boldsymbol\theta'`)
    expect(screen.queryByText(/執行失敗|計算失敗/)).toBeNull()
    // 送進 Mermaid 的原始碼：系統地圖（本章的 focus）與清單裡的每一張圖（語法由 diagrams.test.tsx 以真正的 parser 檢查）
    const rendered = (mermaidMock.render.mock.calls as unknown as unknown[][]).map((c) => c[1])
    expect(rendered).toContain(systemMapChart(SYSTEM_FOCUS))
    for (const d of CH09_DIAGRAMS) expect(rendered, d.id).toContain(d.chart)
    expect(container.querySelectorAll('.c-mermaid-error')).toHaveLength(0)
    expect(reactWarnings()).toEqual([])
    // 各模式（含 ModeGate 才顯示的內容）都沒有 KaTeX 解析錯誤
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
  }, PAGE_TIMEOUT)

  it('每個 FORMULAS 的 id 在任何模式（此處用 beginner）都有對應的 TexBlock 錨點；id 唯一且格式為 F-09.x', () => {
    const { container } = renderChapter('/ch/09', 'beginner')
    // 所有 KaTeX 都能正確解析（throwOnError: false 時錯誤會變成 .katex-error 紅字）
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(300)
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-09\.\d+$/)
      expect(f.page).toBe('/ch/09')
      expect(container.querySelector(`[id="formula-${f.id}"]`), f.id).toBeTruthy()
    }
    // 勘誤欄位只用本章負責的條目
    for (const f of FORMULAS) if (f.erratumId) expect(['E04', 'E05', 'E08', 'E22', 'E23']).toContain(f.erratumId)
  }, PAGE_TIMEOUT)

  it('頁面引用的 #region core:* 都存在於 pe.ts（顯示的就是執行的程式碼）', () => {
    const regions = listRegions(peSrc)
    for (const r of [
      'eig2x2',
      'stepsToDecay',
      'eigenModes',
      'meanRecursion',
      'bussgangMeanG',
      'meanSquareMap',
      'regressorGaussian',
      'regressorPm1',
      'gmacLinear',
      'gmacSign',
      'peBlockLms',
      'slidingWindowPe',
      'handSteps',
      'gaugeRegressorsRaw',
      'gaugeRegressorsPd',
      'gaugeLms',
      'gaugeDriftStd',
    ])
      expect(regions).toContain(r)
    // 比較用的 region 都有差異標記
    for (const r of ['eig2x2', 'eigenModes', 'meanRecursion', 'meanSquareMap', 'regressorGaussian', 'regressorPm1', 'gmacLinear', 'gmacSign', 'gaugeRegressorsRaw', 'gaugeRegressorsPd']) {
      const start = peSrc.indexOf(`#region core:${r}`)
      const end = peSrc.indexOf('#endregion', start)
      expect(peSrc.slice(start, end)).toContain('← 差異')
    }
  })

  it('T11: URL preset pe-rho-099（Gallery #6）載入後顯示 k₉₅ = 598 與 MC 交叉比對', async () => {
    const { container } = renderChapter('/ch/09?preset=pe-rho-099', 'engineer')
    const shell = screen.getByText(/PE \/ Eigen Lab：correlation ellipse/).closest('section, article, div') as HTMLElement
    expect(shell).toBeTruthy()
    await waitFor(() => expect(container.textContent).toMatch(/MC：64 chains × 800 blocks/), WAIT)
    const metricText = container.textContent ?? ''
    expect(metricText).toContain('598')
    expect(metricText).toContain('597.647')
    // 交叉比對的說明以 KaTeX 顯示：textContent 內含 MathML annotation 的 TeX 原始碼
    await waitFor(() => expect(container.textContent).toContain(String.raw`|\mathrm{MC}-\text{精確平均遞迴}|/\mathrm{SE}=`), WAIT)
    expect(container.textContent).toMatch(/Monte Carlo✓ 一致/)
  }, PAGE_TIMEOUT)

  it('T10: URL preset pe-rho-1-missing 顯示「λ_min = 0：不可辨識」的解釋性警告', async () => {
    const { container } = renderChapter('/ch/09?preset=pe-rho-1-missing', 'engineer')
    // 警告文字：`$\lambda_{\min}=0$：$\mathbf R$ 奇異（$\rho=1$），沿 … 的方向不可辨識（Persistent Excitation 不成立）。…`
    await waitFor(() => expect(container.textContent).toContain('的方向不可辨識（Persistent Excitation 不成立）'), WAIT)
    const alert = screen.getAllByText(/的方向不可辨識（Persistent Excitation 不成立）/)[0]
    expect(alert.textContent).toMatch(/Persistent Excitation 不成立/)
    expect(alert.textContent).toContain(String.raw`\lambda_{\min}=0`) // λ_min = 0（KaTeX annotation）
    expect(alert.textContent).toContain(String.raw`\mathbf R`)
    expect(alert.textContent).toContain('奇異')
    expect(alert.textContent).toContain(String.raw`\rho=1`)
    expect(alert.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
    // 反面：|p_slow| = 1 是「不可辨識」而不是 g 太大，不可誤報「gλ_max ≥ 2：…平均遞迴發散。需 0 < g < …」（這裡 gλ_max = 1）
    expect(container.textContent).not.toContain('平均遞迴發散。需')
  }, PAGE_TIMEOUT)

  it('E04: URL preset gauge-dc-null 顯示 u-domain 2 個零 eigenvalue 的警告與約束表', async () => {
    const { container } = renderChapter('/ch/09?preset=gauge-dc-null', 'engineer')
    // 用 textContent 判斷（比 getAllByText 走訪整棵大 DOM 便宜很多）
    await waitFor(() => expect(container.textContent).toContain('u-domain 有 2 個零 eigenvalue'), WAIT)
    // 約束表的列名以 KaTeX 顯示（`不更新 $b$ ＋ 固定 $a_0:=0$`）：用第一格的文字找出那一列
    const table = Array.from(container.querySelectorAll('tr')).find((tr) => /^不更新 .+ ＋ 固定 /.test(tr.querySelector('td')?.textContent ?? '')) as HTMLElement
    expect(table).toBeTruthy()
    expect(table.querySelector('td')?.textContent).toContain('a_0:=0')
    const cells = within(table).getAllByRole('cell')
    expect(cells[cells.length - 1].textContent).toBe('0')
    // 5 列約束的名稱都沒有 KaTeX 錯誤
    expect(table.closest('table')?.querySelectorAll('tbody tr')).toHaveLength(5)
    expect(table.closest('table')?.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
  }, PAGE_TIMEOUT)
})

describe('Ch09 教學內容（數字都由模型算出）', () => {
  it('Python golden 對照：pyFunction 以函式名稱擷取真實原始碼（不含下一個函式），找不到時回傳說明而不是空白', () => {
    const steps = pyFunction(mimoPy, 'steps_to_decay')
    expect(steps.startsWith('def steps_to_decay(p: float, fraction: float) -> int:')).toBe(true)
    expect(steps).toContain('math.ceil(math.log(fraction) / math.log(abs(p)))')
    expect(steps).not.toContain('steps_to_decay_real')
    expect(mimoPy).toContain(steps) // 逐字來自原始檔
    const win = pyFunction(mimoPy, 'windowed_pe')
    expect(win).toContain('seg.T @ seg / n0')
    expect(win).not.toContain('# ---') // 區段註解不屬於函式
    expect(win.endsWith('n0')).toBe(true)
    for (const name of ['simulate_mean_lms', 'onehot_with_global_regressors', 'eig_sorted']) {
      const body = pyFunction(mimoPy, name)
      expect(body.startsWith(`def ${name}(`)).toBe(true)
      expect(body.split('\n').filter((l) => l.startsWith('def '))).toHaveLength(1)
    }
    // 多行簽名也要完整擷取
    const multi = pyFunction(mimoPy, 'simulate_preconditioned_lms')
    expect(multi).toContain('return')
    expect(pyFunction(mimoPy, 'no_such_function')).toContain('找不到')
  })

  it('研究模式顯示 TS vs Python 並排（steps_to_decay、simulate_mean_lms、windowed_pe），不再整檔傾印', () => {
    const { container } = renderChapter('/ch/09', 'research')
    const text = container.textContent ?? ''
    expect(text).toContain('Python：steps_to_decay')
    expect(text).toContain('Python：windowed_pe')
    expect(text).not.toContain('def preconditioner_ideal') // §10 的函式不屬於本章
    expect(text).not.toContain('程式碼載入錯誤')
  }, PAGE_TIMEOUT)

  it('入門例子的數字：ρ = 0.8 時 E[G₁] = 0.8K_qδ₂（第 11 課）、兩個 N₀ = 4 窗口、gauge 四相表、√κ = 14.1', () => {
    const { container } = renderChapter('/ch/09', 'beginner')
    const text = container.textContent ?? ''
    expect(text).toContain('先算一次：兩個 LMS loop 會互相干擾')
    expect(text).toContain('被拉離真值')
    expect(text).toContain('先算一次：兩個') // PE 窗口
    expect(text).toContain('先算一次：兩組不同的參數，四個 phase 的輸出一模一樣')
    // gauge 四相表：兩組參數的輸出相同 ⇒ 差的那一列全部是 ch09-ok 的 0
    const row = screen.getAllByText((_, el) => el?.tagName === 'TD' && el.classList.contains('ch09-ok') && el.textContent === '0')
    expect(row.length).toBeGreaterThanOrEqual(4)
    expect(text).toContain('14.11') // √199
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
  }, PAGE_TIMEOUT)

  it('T11: 「執行至收斂」把 blocks 拉到 ⌈1.25·k₉₅⌉ = 748（看得到 598），MC 以新長度重跑', async () => {
    const { container } = renderChapter('/ch/09?preset=pe-rho-099', 'engineer')
    await waitFor(() => expect(container.textContent).toMatch(/MC：64 chains × 800 blocks/), WAIT)
    const shellTitle = screen.getByText(/PE \/ Eigen Lab：correlation ellipse/)
    let shell: HTMLElement | null = shellTitle as HTMLElement
    let btn: HTMLElement | null = null
    while (shell && !btn) {
      btn = within(shell).queryByRole('button', { name: /Run-to-Convergence/ })
      shell = shell.parentElement
    }
    expect(btn).toBeTruthy()
    fireEvent.click(btn as HTMLElement)
    await waitFor(() => expect(container.textContent).toMatch(/MC：64 chains × 748 blocks/), WAIT)
  }, PAGE_TIMEOUT)
})

describe('Ch09 presets 與狀態', () => {
  it('blocksForConvergence：598 → 748；75,091 超過上限 ⇒ 停在上限且 reachable = false；k₉₅ = ∞ ⇒ 不可達', () => {
    expect(blocksForConvergence(598)).toEqual({ blocks: 748, reachable: true })
    expect(blocksForConvergence(1)).toEqual({ blocks: PE_LIMITS.blocks[0], reachable: true })
    expect(blocksForConvergence(75091)).toEqual({ blocks: PE_LIMITS.blocks[1], reachable: false })
    expect(blocksForConvergence(Infinity)).toEqual({ blocks: PE_LIMITS.blocks[1], reachable: false })
  })

  it('F-09.19 的例子：μ = .2、σ_v = .1、N = 16、K = 1000 ⇒ type-II 0.158 fs；type-I（r = .95）阻尼 1/(1 + 1.25·0.2·20/16) = 0.762', () => {
    const base = { mu: 0.2, sigmaV: 0.1, N: 16, blocks: 1000, P: 4 }
    const t2 = gaugeDriftStd({ ...base, stepSum: 0 })
    expect(t2.damping).toBe(1)
    expect(t2.std).toBeCloseTo(0.2 * 0.1 * Math.sqrt(1000 / 16), 12)
    expect(t2.std).toBeCloseTo(0.1581, 4)
    const t1 = gaugeDriftStd({ ...base, stepSum: 20 })
    expect(t1.damping).toBeCloseTo(1 / 1.3125, 12)
    expect(t1.std).toBeCloseTo(0.1205, 4)
    // preset 的 expected 文字（type-II）與模型一致
    const pr = presetById('gauge-raw-gmac-drift')!
    const g = gaugeAnalysis(toGaugeParams(sanitizeGaugeState(pr.params), 20261010))
    expect(g.lms.driftStdPred).toBeCloseTo(0.158, 3)
    expect(g.lms.driftDamping).toBeCloseTo(1, 6)
  })

  it('模型回傳的純文字警告／error path 說明，顯示前轉成 `$…$`（以模型實際產生的字串檢查樣式仍對得上）', () => {
    const UNICODE_MATH = /[≠≥≤→·ũωζ⁻¹²]|H_PD/
    const renders = (text: string) => {
      const { container, unmount } = render(<MathText>{text}</MathText>)
      expect(container.querySelectorAll('.katex').length, text).toBeGreaterThan(0)
      expect(container.querySelectorAll('.katex-error, .c-tex-error'), text).toHaveLength(0)
      const prose = container.cloneNode(true) as HTMLElement
      prose.querySelectorAll('.katex').forEach((k) => k.remove())
      expect(prose.textContent, text).not.toContain('$')
      unmount()
    }
    // (1) 暖機不足＋LMS 長度上限：type-I、pole 很靠近 1、skip = 0、blocks·N 超過上限
    const g = gaugeAnalysis(toGaugeParams({ ...GAUGE_DEFAULT, dcNull: true, pathType: 'type1', hpPole: 0.999, skip: 0, T: 2000, N: 1024, blocks: 2000 }, 3))
    expect(g.warnings.some((w) => w.startsWith('暖機不足'))).toBe(true)
    expect(g.warnings.some((w) => w.startsWith('LMS demo 長度上限'))).toBe(true)
    for (const w of g.warnings) {
      const tex = gaugeWarningTex(w)
      expect(tex, w).not.toBe(w) // 樣式對得上（pe.ts 的句子若改了，這裡會提醒同步更新 gaugeWarningTex）
      expect(tex, w).not.toMatch(UNICODE_MATH)
      renders(tex)
    }
    expect(gaugeWarningTex(g.warnings.find((w) => w.startsWith('暖機不足')) ?? '')).toContain(String.raw`$H_{\mathrm{PD}}$ 的 step response $\tilde u_b$`)
    // (2) designDtLoop 的警告（ω_nT_s 太大／不穩定）
    const loopWarnings = [
      ...designDtLoop({ wnTs: 0.3, zeta: 0.7, loopDelay: 0, method: 'dpll' }).warnings,
      ...designDtLoop({ wnTs: 0.3, zeta: 0.7, loopDelay: 6, method: 'dpll' }).warnings,
    ]
    expect(loopWarnings.length).toBeGreaterThan(0)
    for (const w of loopWarnings) {
      const tex = gaugeWarningTex(w)
      expect(tex, w).not.toBe(w)
      expect(tex, w).toContain(String.raw`\omega_nT_s=`)
      renders(tex)
    }
    // (3) H(1) ≠ 0 的句子（type-I／II 的設計不會產生；樣式與 pe.ts 的模板一致），科學記號改成 ×10^{k}
    expect(gaugeWarningTex('H(1) = 1.234e-5 ≠ 0：此 error path 沒有完全抑制 DC，b 仍部分可觀察。')).toBe(
      String.raw`$H_{\mathrm{PD}}(1)=1.234\times10^{-5}\ne0$：此 error path 沒有完全抑制 DC，$b$ 仍部分可觀察。`,
    )
    // 認不出來的句子原樣回傳
    expect(gaugeWarningTex('其他訊息')).toBe('其他訊息')
    // (4) error path 的說明：三種 path 都轉成含 KaTeX 的版本
    const descs = [
      gaugeAnalysis(toGaugeParams({ ...GAUGE_DEFAULT, dcNull: false, T: 2000, blocks: 10 }, 1)).tf.description,
      gaugeAnalysis(toGaugeParams({ ...GAUGE_DEFAULT, dcNull: true, pathType: 'type1', T: 2000, blocks: 10 }, 1)).tf.description,
      gaugeAnalysis(toGaugeParams({ ...GAUGE_DEFAULT, dcNull: true, pathType: 'type2', T: 2000, blocks: 10 }, 1)).tf.description,
    ]
    const texs = descs.map(gaugeTfTex)
    expect(texs[0].startsWith('$H=1$（')).toBe(true)
    expect(texs[1]).toContain(String.raw`\dfrac{1-z^{-1}}{1-0.95\,z^{-1}}`)
    expect(texs[2]).toContain(String.raw`$H_{\mathrm{PD}}$（$\omega_nT_s=0.05$、$\zeta=0.7$、`)
    texs.forEach((t, i) => {
      expect(t, descs[i]).not.toMatch(UNICODE_MATH)
      renders(t)
    })
  }, PAGE_TIMEOUT)

  it('Gallery #6 與 #11 存在、指向本章實驗，參數經 sanitize 後不變', () => {
    const p6 = presetById('pe-rho-099')
    const p11 = presetById('gauge-one-hot')
    expect(p6?.galleryIndex).toBe(6)
    expect(p11?.galleryIndex).toBe(11)
    expect(p6?.experiment).toBe('pe-eigen-lab')
    expect(p11?.experiment).toBe('gauge-one-hot')
    for (const p of presetsForExperiment('pe-eigen-lab')) {
      const { seed: _seed, ...rest } = p.params
      expect(sanitizePeState(p.params)).toEqual(rest)
      expect(p.page).toBe('/ch/09')
    }
    for (const p of presetsForExperiment('gauge-one-hot')) {
      const { seed: _seed, ...rest } = p.params
      expect(sanitizeGaugeState(p.params)).toEqual(rest)
    }
  })

  it('preset 的 expected 文字與模型計算一致（598、75,091、ρ_MS 1.9801、2 個零 eigenvalue）', () => {
    const p6 = sanitizePeState(presetById('pe-rho-099')!.params)
    const a6 = peAnalytic({ rho: p6.rho, dist: p6.dist, g: derivedGain(p6).g, N: p6.N, N0: p6.N0 })
    expect(a6.k95Slow).toBe(598)
    const pk = sanitizePeState(presetById('pe-physical-kq')!.params)
    const ak = peAnalytic({ rho: pk.rho, dist: pk.dist, g: derivedGain(pk).g, N: pk.N, N0: pk.N0 })
    expect(ak.k95Slow).toBe(75091)
    const pn = sanitizePeState(presetById('pe-n1-ms-divergent')!.params)
    expect(peAnalytic({ rho: pn.rho, dist: pn.dist, g: derivedGain(pn).g, N: pn.N, N0: pn.N0 }).msRadius).toBeCloseTo(1.9801, 4)
    const pp = sanitizePeState(presetById('pe-pm1-staircase')!.params)
    const ap = peAnalytic({ rho: pp.rho, dist: pp.dist, g: derivedGain(pp).g, N: pp.N, N0: pp.N0, detector: pp.detector })
    expect(ap.degenerateProb).toBeCloseTo(0.6058, 4)
    expect(ap.windowLminMean).toBeCloseTo(0.0254, 4)
    expect(ap.msRadius).toBeCloseTo(0.995, 12)
    const g = gaugeAnalysis(toGaugeParams(sanitizeGaugeState(presetById('gauge-dc-null')!.params), 20261010))
    expect(g.eigRu.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(2)
    const g11 = gaugeAnalysis(toGaugeParams(sanitizeGaugeState(presetById('gauge-one-hot')!.params), 20261010))
    expect(g11.eigRx.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(1)
    expect(g11.maxDiffRawGauge).toBeLessThan(1e-14)
  })

  it('T11: 每個 pe-eigen-lab preset 的 MC 交叉比對（頁面同一個 mcModalCheck）都通過，含 ±1 code 快模式被精確投影成 0 的浮點地板情形', () => {
    for (const pr of presetsForExperiment('pe-eigen-lab')) {
      const st = sanitizePeState(pr.params)
      const dg = derivedGain(st)
      const params = {
        rho: st.rho,
        dist: st.dist,
        detector: st.detector,
        sigmaV: st.sigmaV,
        mu: dg.mu,
        N: st.N,
        delta0: [st.d10, st.d20] as [number, number],
        blocks: st.blocks,
        N0: st.N0,
        chains: st.chains,
        nPaths: 3,
        scatterCount: 10,
        peLength: 2000,
        seed: typeof pr.params.seed === 'number' ? pr.params.seed : 1,
      }
      const chk = mcModalCheck(simulatePeLab(params), params)
      expect(chk.ok, `${pr.id}: z = ${chk.z.join(', ')}`).toBe(true)
    }
  }, PAGE_TIMEOUT)

  it('K_q 正規化切換保持 g 不變；切到 1-bit 時 σ_v = 0 自動改為 100 fs；回到 linear 時 σ_v 歸零', () => {
    const sign = switchDetector(PE_DEFAULT, 'sign')
    expect(sign.sigmaV).toBe(100)
    expect(derivedGain(sign).g).toBeCloseTo(0.5, 12)
    const phys = switchKqMode(sign, 'physical')
    expect(phys.muInput).toBeCloseTo(62.665706865775, 8)
    expect(derivedGain(phys).g).toBeCloseTo(0.5, 12)
    const back = switchKqMode(phys, 'normalized')
    expect(back.muInput).toBeCloseTo(0.5, 12)
    const lin = switchDetector(phys, 'linear')
    expect(lin.sigmaV).toBe(0)
    expect(derivedGain(lin).g).toBeCloseTo(0.5, 10)
  })

  it('T11: 同樣 g = 0.5、N = 1：linear 均方發散（1.9801），1-bit 的小訊號均方半徑 0.99（實驗室依 detector 計算 ρ_MS）', () => {
    const base = { ...PE_DEFAULT, N: 1 }
    const lin = peAnalytic({ rho: base.rho, dist: base.dist, g: derivedGain(base).g, N: 1, N0: base.N0, detector: base.detector })
    expect(lin.msRadius).toBeCloseTo(1.9801, 4)
    const sign = switchDetector(base, 'sign')
    const as = peAnalytic({ rho: sign.rho, dist: sign.dist, g: derivedGain(sign).g, N: 1, N0: sign.N0, detector: sign.detector })
    expect(as.msRadius).toBeCloseTo(0.99, 10)
    expect(as.meanRadius).toBeCloseTo(lin.meanRadius, 12)
  })

  it('texNum：TeX 內的數字不用 e 記號（7.979e-5 → 7.979×10^{-5}），∞ → TeX 的 infty', () => {
    expect(texNum(0.5 * 0.0079788456 * 0.01, 4)).toBe(String.raw`3.989\times10^{-5}`)
    expect(texNum(1.2e-17, 2)).toBe(String.raw`1.2\times10^{-17}`)
    expect(texNum(-2.5e7, 3)).toBe(String.raw`-2.5\times10^{7}`)
    expect(texNum(0.995, 4)).toBe('0.995')
    expect(texNum(Infinity)).toBe(String.raw`\infty`)
  })

  it('sanitize 會夾住非法值並忽略未知欄位', () => {
    const s = sanitizePeState({ rho: 3, N: 0.4, dist: 'weird', muInput: -1, extra: 1 })
    expect(s.rho).toBe(1)
    expect(s.N).toBe(1)
    expect(s.dist).toBe(PE_DEFAULT.dist)
    expect(s.muInput).toBeGreaterThan(0)
    const gsan = sanitizeGaugeState({ T: 1e9, dcNull: 'yes' })
    expect(gsan.T).toBe(400000)
    expect(gsan.dcNull).toBe(GAUGE_DEFAULT.dcNull)
  })
})
