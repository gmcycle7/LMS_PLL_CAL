import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { listRegions, renderTex } from '@/components'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import type { PresetEntry } from '@/data/types'
import { berryEsseenBound, directionOutcomeExact, pPlus, runComparatorMC } from '@/simulation/models/comparator'
import { allChartStrings, chartStringProblems } from './chartStrings.testutil'
import { sigOrZero, texInt, texNum } from './common'
import { CH05_DIAGRAMS } from './diagrams'
import { DEFAULT_CASE, analyzeCase, labWarnings, mcConsistency, parsePresetParams, sweepNs } from './experiments/labModel'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import Chapter05 from './index'
import { IntroSection } from './sections/Intro'
import { CH05_SYMBOLS, ChapterSymbols } from './symbols'

// 多個 agent／開發者同時跑測試時 CPU 會嚴重超額（load average 曾達數百），jsdom 渲染與 Monte Carlo 比平常慢一到兩個數量級：
// 放寬的只是「等待時間」（waitFor 與每個測試的上限），不是任何數值判準。
configure({ asyncUtilTimeout: 120_000 })
vi.setConfig({ testTimeout: 600_000 })
const SLOW = 600_000

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
// 圖內文字的數學一律寫 `$...$`（teaching-style §3）：<Plot> 先套用 applyPlotMath 再交給 Plotly，
// 所以在轉換前記下作者寫的字串（chartStrings.testutil.ts），整章所有 Plotly 圖一次檢查
const plotCalls = vi.hoisted(() => [] as { data: unknown; layout: unknown }[])
vi.mock('@/components/plotMath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...actual,
    applyPlotMath: (data: unknown, layout: unknown) => {
      plotCalls.push({ data, layout })
      return actual.applyPlotMath(data, layout)
    },
  }
})
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })), parse: vi.fn(async () => true) },
}))

/** 以 textContent 找標題（標題內含 KaTeX 時，jsdom 計算 accessible name 會在 getComputedStyle 崩潰，所以不用 getByRole）。 */
function heading(container: HTMLElement, re: RegExp): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4')).find((h) => re.test(h.textContent ?? ''))
}

function renderChapter(url = '/ch/05', mode: 'beginner' | 'engineer' | 'research' = 'engineer') {
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* ignore */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <Chapter05 />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

const presetDir = resolve(process.cwd(), 'src/data/presets')
const presets: PresetEntry[] = readdirSync(presetDir)
  .filter((f) => f.startsWith('comparator') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(presetDir, f), 'utf8')) as PresetEntry)

describe('Ch05 頁面（jsdom smoke）', () => {
  it('T04/T05: 整章可渲染：章末的符號表、修正後的奇數 N 表格、tie 對照框（49.20% / 7.93% / 42.86%）與 Comparator Lab', async () => {
    const errSpy = vi.spyOn(console, 'error')
    plotCalls.length = 0
    const { container } = renderChapter()
    expect(screen.getByText('這次我們要回答的問題')).toBeTruthy()
    // 符號表在章末（teaching-style §5）：只有一份，包在 id="symbols" 裡，是整頁最後一個區塊，排在「本課必記」（Recap）之後
    expect(container.querySelectorAll('.c-symbols').length).toBe(1)
    const symbolsEnd = container.querySelector('#symbols') as HTMLElement
    expect(symbolsEnd).toBeTruthy()
    expect(symbolsEnd.querySelector('.c-symbols')).toBeTruthy()
    expect(symbolsEnd).toBe(container.querySelector('.ch05')!.lastElementChild)
    expect(symbolsEnd.querySelectorAll('.c-symbols tbody tr').length).toBe(CH05_SYMBOLS.length)
    const recap = container.querySelector('.c-recap') as HTMLElement
    expect(recap.compareDocumentPosition(symbolsEnd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const lastQuiz = Array.from(container.querySelectorAll<HTMLElement>('.c-quiz')).pop()!
    expect(lastQuiz.compareDocumentPosition(symbolsEnd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 章首只留一行連結（按鈕），排在第一個章節標題之前；章首不再有符號表
    const firstHeading = container.querySelector('h2') as HTMLElement
    const link = container.querySelector('.ch05-symbols-link button') as HTMLButtonElement
    expect(link.textContent).toContain('本章符號表在最後')
    expect(link.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(firstHeading.compareDocumentPosition(symbolsEnd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 方塊圖（teaching-style §8）：章首的系統地圖 + 本章登錄的圖（Engineer 模式看不到 Research 才有的那一張）
    const expectedFigs = 1 + CH05_DIAGRAMS.filter((d) => d.minMode !== 'research').length
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(expectedFigs)
    expect(container.querySelector('figure.c-mermaid')!.getAttribute('aria-label')).toContain('系統方塊圖')
    await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg').length).toBe(expectedFigs))
    expect(container.textContent).not.toContain('Mermaid 圖解析失敗')
    // 固定節奏：直覺（偏一點點的硬幣）與「注意假設」段落在所有模式都顯示
    expect(heading(container, /一枚只偏一點點的硬幣/)).toBeTruthy()
    expect(heading(container, /注意假設：本章的數字什麼時候不能直接用/)).toBeTruthy()
    expect(container.textContent).toContain('一個固定非零偏移之符號')
    // 公式 ID 錨點
    for (const id of ['F-05.1', 'F-05.2', 'F-05.4', 'F-05.7', 'F-05.9', 'F-05.10', 'F-05.20']) {
      expect(container.querySelector(`[id="formula-${id}"]`)).toBeTruthy()
    }
    // tie 對照框（E02）
    const text = container.textContent ?? ''
    expect(text).toContain('49.20%')
    expect(text).toContain('7.93%')
    expect(text).toContain('42.86%')
    expect(text).toContain('57.14%')
    // 奇數 N 修正表：42,499 與 85,011
    expect(text).toContain('42,499')
    expect(text).toContain('85,011')
    // 勘誤連結
    const errata = Array.from(container.querySelectorAll('.ch05-erratum a')).map((a) => a.textContent)
    expect(errata).toEqual(expect.arrayContaining(['勘誤 E02', '勘誤 E07', '勘誤 E18']))
    expect((container.querySelector('.ch05-erratum a') as HTMLAnchorElement).getAttribute('href')).toBe('#/verification')
    // 實驗外框
    expect(heading(container, /Comparator Lab：1-bit/)).toBeTruthy()
    expect(heading(container, /Dither 實驗/)).toBeTruthy()
    // Monte Carlo（jsdom 下 worker 走 inline）完成後：Comparator Lab 與 Dither 實驗的 MC 交叉比對都應為 ok
    await waitFor(() => expect(container.textContent).toMatch(/MC 計數 vs 精確 Binomial：判對 \d+\/4000（接受域 \[\d+, \d+\]）/))
    await waitFor(() => expect(container.textContent).toContain('MC 時間平均落在解析值的容差內'))
    expect(container.textContent).not.toContain('Monte Carlo 與精確值不一致')
    expect(container.textContent).not.toContain('，超出）')
    // 極端例子 N = 2：strict 只有 p² ≈ 25.4%（E02 的鋸齒）
    expect(container.textContent).toContain('25.4%')
    // Analytic 交叉比對：CLT 與精確值的差落在 Berry–Esseen 上界內（附註中的數字以 KaTeX 顯示：差 \le 上界）
    expect(container.textContent).toContain('（Berry–Esseen 上界）')
    const beNote = Array.from(container.querySelectorAll('.c-check-note')).find((n) => n.textContent?.includes('Berry–Esseen'))
    expect(beNote).toBeTruthy()
    expect(Array.from(beNote!.querySelectorAll('annotation')).some((a) => /\\le/.test(a.textContent ?? ''))).toBe(true)
    // 帶入手算：8 題依序出現在各自的推導之後，最後一題（綜合題）在第一個思考題之前；字串屬性裡的 $...$ 都已轉成 KaTeX
    const hc = Array.from(container.querySelectorAll<HTMLElement>('.c-handcalc'))
    expect(hc.map((h) => h.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(container.querySelectorAll('.ch05-handcalc-invite').length).toBe(HANDCALCS.length)
    // HC-05.5 的兩個推導分別在 Engineer／Research 模式才顯示：邀請文字會說明去哪裡看（Engineer：§3.4 看得到、§3.5 要切模式）
    const invite5 = container.querySelector('#handcalc-HC-05\\.5')!.parentElement!.querySelector('.ch05-handcalc-invite')!.textContent ?? ''
    expect(invite5).toContain('平衡點偏移的推導在上面的 §3.4')
    expect(invite5).toContain('切到 Research 模式才顯示')
    const firstQuiz = container.querySelector('.c-quiz') as HTMLElement
    expect(hc[hc.length - 1].compareDocumentPosition(firstQuiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hc[hc.length - 2].compareDocumentPosition(heading(container, /^.*9\. 連結到 PLL/)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 綜合題排在它代的那條公式（F-05.20，§9 的 block 迴路推導）之後
    expect(container.querySelector('[id="formula-F-05.20"]')!.compareDocumentPosition(hc[hc.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    // 程式碼區塊裡的 `${...}` 是原始碼本身；其餘文字不應留下未轉換的 $ 分隔符
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll('pre, code').forEach((e) => e.remove())
    expect(prose.textContent).not.toContain('$')
    // 字串屬性裡的數學（實驗標題、假設、指標名稱、圖標題）以 KaTeX 顯示
    for (const sel of ['.c-exp-title', '.c-exp-assumptions li', '.c-metric-table td:first-child', '.c-plot-title']) {
      expect(container.querySelectorAll(`${sel} .katex`).length, sel).toBeGreaterThanOrEqual(2)
    }
    // 控制項名稱裡的符號（s、σ_v、θ、N、μ、w₀…）也以 KaTeX 顯示；aria-label 保留純文字，輔助工具與測試仍可用原名稱查找
    expect(container.querySelectorAll('.c-param-label .katex').length).toBeGreaterThanOrEqual(10)
    expect(container.querySelector('input[aria-label="σ_v（雜訊 RMS）— Case A"]')).toBeTruthy()
    expect(container.querySelector('input[aria-label="w₀（初值）"]')).toBeTruthy()
    // Dither 實驗預設建立 Case A/B/C（σ_v = 0 / 1 / 30）
    const dither = heading(container, /Dither 實驗/)?.closest('section, .c-exp, div') as HTMLElement
    expect(dither).toBeTruthy()
    await waitFor(() => expect(container.textContent).toContain('Case C'))
    // 圖內數學：整章所有 Plotly 圖（§1 的標準化 PDF、§3 的訊號／雜訊線、§5 的 S 曲線、Comparator Lab、Dither）的軸標題、圖例名稱、註記，
    // 數學都在成對的 $...$ LaTeX 裡，公式以外沒有 Unicode 拼的數學（σ_v、E[q]、√、²、· 之類）
    expect(chartStringProblems(plotCalls)).toEqual([])
    const chartTexts = allChartStrings(plotCalls)
    expect(chartTexts.length).toBeGreaterThan(40)
    for (const t of [String.raw`$z = v/\sigma_v$`, String.raw`$\varphi(z)$`, '$S_N$ 的尺度', String.raw`$r = (s - \theta)/\sigma_v$`, '$E[q]$　/　斜率比', String.raw`$\sigma_v$（fs）`]) {
      expect(chartTexts, t).toContain(t)
    }
    expect(chartTexts.some((t) => t.includes(String.raw`$\mathrm{SD}(S_N) = \sqrt{N(1-m^2)}$`))).toBe(true)
    expect(chartTexts.some((t) => t.includes(String.raw`$\theta$ 與 $s$ 之間`))).toBe(true)
    // 除了 Plotly mock 非同步載入造成的 act() 提示之外，不應有任何 console.error（key 重複、DOM 巢狀錯誤、render 例外…）
    const real = errSpy.mock.calls.map((c) => String(c[0])).filter((m) => !/not wrapped in act/.test(m))
    expect(real).toEqual([])
    errSpy.mockRestore()
  }, SLOW)

  it('符號表移到章末：章首的「本章符號表在最後」是按鈕（HashRouter 下不改路由），按下去把 #symbols 捲進畫面並移動焦點', async () => {
    const scrollSpy = vi.fn()
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown }
    const original = proto.scrollIntoView
    proto.scrollIntoView = scrollSpy // jsdom 沒有 scrollIntoView
    try {
      const { container } = render(
        <SettingsProvider>
          <MemoryRouter initialEntries={['/ch/05']}>
            <IntroSection />
            <ChapterSymbols />
          </MemoryRouter>
        </SettingsProvider>,
      )
      // 開場有 4 張圖（系統地圖 + 路線圖 + L1 模型 + 先算一次的流程）：等它們（mock 的 mermaid）畫完再操作
      await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg').length).toBe(4))
      const link = container.querySelector('.ch05-symbols-link button') as HTMLButtonElement
      expect(link.getAttribute('type')).toBe('button')
      // 不是 <a href="#symbols">：那在 HashRouter 下會被當成路由「/symbols」
      expect(container.querySelector('a[href="#symbols"], a[href$="#symbols"]')).toBeNull()
      const target = container.querySelector('#symbols') as HTMLElement
      expect(target.querySelector('.c-symbols')).toBeTruthy()
      // 開場（IntroSection）裡沒有符號表，只有這一行連結
      expect(link.closest('#symbols')).toBeNull()
      expect(container.querySelectorAll('.c-symbols').length).toBe(1)
      vi.useFakeTimers()
      fireEvent.click(link)
      expect(scrollSpy).toHaveBeenCalledTimes(1)
      expect(scrollSpy.mock.contexts[0]).toBe(target)
      expect(document.activeElement).toBe(target)
      // 上方的圖是延遲載入的（載入後版面會被推開）：稍後再對齊兩次
      vi.advanceTimersByTime(2000)
      expect(scrollSpy).toHaveBeenCalledTimes(3)
      expect(scrollSpy.mock.contexts.every((c) => c === target)).toBe(true)
      // 使用者一旦自己捲動（或點擊、按鍵），就不再把畫面拉回去
      fireEvent.click(link)
      expect(scrollSpy).toHaveBeenCalledTimes(4)
      fireEvent.wheel(window)
      vi.advanceTimersByTime(2000)
      expect(scrollSpy).toHaveBeenCalledTimes(4)
      // 符號表內容不變的欄位：符號、意義、單位、首次出現、備註
      const head = Array.from(target.querySelectorAll('.c-symbols thead th')).map((th) => th.textContent)
      expect(head).toEqual(['符號', '意義', '單位', '首次出現', '備註'])
      // 極性註記仍在表內：δ = a − w（不是 w − a）
      const rows = Array.from(target.querySelectorAll('.c-symbols tbody tr')).map((tr) => tr.textContent ?? '')
      expect(rows.some((r) => r.includes('剩餘參數誤差') && r.includes('全站約定'))).toBe(true)
    } finally {
      vi.useRealTimers()
      proto.scrollIntoView = original
    }
  })

  it('符號不在章首列表了：開場與 §0 就地用一句話說明每個符號（s、v、σ_v、e、θ、q、b、x、a、w、δ、S_N、N、n、k）', async () => {
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/ch/05']}>
          <IntroSection />
        </MemoryRouter>
      </SettingsProvider>,
    )
    await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg').length).toBe(4))
    const model = heading(container, /^0\. 模型/)!.closest('section') as HTMLElement
    const items = Array.from(model.querySelectorAll('li'))
    const tex = (el: Element) => Array.from(el.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    /** 找出以某個符號開頭的那一條說明。 */
    const itemOf = (symbol: string) => items.find((li) => tex(li)[0] === symbol)
    // 每個符號一條：開頭是符號，後面是一句白話說明
    expect(itemOf('s')!.textContent).toContain('要辨識正負號的固定誤差')
    expect(tex(itemOf('s')!)).toEqual(expect.arrayContaining(['x\\equiv1', '\\delta=a-w', 'a', 'w']))
    expect(itemOf('s')!.textContent).toContain('理想係數')
    expect(itemOf('s')!.textContent).toContain('目前的校正係數')
    expect(itemOf('v')!.textContent).toContain('comparator 前的雜訊')
    expect(tex(itemOf('v')!)).toEqual(expect.arrayContaining(['\\sigma_v', 'v\\sim\\mathcal N(0,\\sigma_v^2)']))
    expect(itemOf('e=s+v')!.textContent).toContain('comparator 的輸入')
    expect(tex(itemOf('e=s+v')!)).toContain('\\theta')
    expect(itemOf('e=s+v')!.textContent).toContain('threshold')
    expect(itemOf('q=\\pm1')!.textContent).toContain('comparator 的輸出')
    expect(tex(itemOf('q=\\pm1')!)).toEqual(expect.arrayContaining(['b', 'q=2b-1']))
    expect(itemOf('S_N=\\sum_{i=1}^{N}q_i')!.textContent).toContain('累加的樣本數')
    const idx = items.find((li) => li.textContent?.startsWith('時間索引'))!
    expect(tex(idx)).toEqual(expect.arrayContaining(['n', 'k']))
    expect(idx.textContent).toContain('GMAC 的 block')
    // regressor x 在 §0 第一段就說明
    expect(model.textContent).toContain('乘在誤差上的已知訊號')
    // 不再叫讀者去看「章首的符號表」
    expect(container.textContent).not.toContain('章首的符號表')
  })

  it('URL preset ?preset=comparator-even-n100-tie 會套用 N = 100、strict，並顯示偶數 N 的說明', async () => {
    const { container } = renderChapter('/ch/05?preset=comparator-even-n100-tie')
    const evenNote = () => Array.from(container.querySelectorAll('.ch05-note')).find((e) => e.textContent?.includes('是偶數'))
    await waitFor(() => expect(evenNote()).toBeTruthy())
    expect(evenNote()!.textContent).toMatch(/N=100/)
    expect(evenNote()!.textContent).toMatch(/N=101/)
    const kpis = container.querySelectorAll('.ch05-kpi')
    const strictKpi = Array.from(kpis).find((k) => k.textContent?.includes('P(判對) 精確（strict）'))
    expect(strictKpi).toBeTruthy()
    expect(within(strictKpi as HTMLElement).getByText('49.205%')).toBeTruthy()
    await waitFor(() => expect(container.textContent).toContain('Monte Carlo 完成'))
  }, SLOW)

  it('Research 模式顯示精確恆等式、Berry–Esseen 與 Python golden 程式碼；所有 TeX 都能解析；Beginner 模式隱藏', async () => {
    const r = renderChapter('/ch/05', 'research')
    // Research 模式下，公式登錄表中的每一個 ID 都要在頁面上有 <TexBlock id> 錨點
    for (const f of FORMULAS) expect(r.container.querySelector(`[id="formula-${f.id}"]`), f.id).toBeTruthy()
    // 延伸：arcsine law 的逐步推導與 Stirling 估計 tie 機率
    expect(r.container.textContent).toContain('Arcsine law')
    expect(r.container.textContent).toContain('Stirling')
    // T05 三個精確門檻（odd 42,499 / even-split 42,500 / even-strict 42,750）都出現在 Research 段落
    expect(r.container.textContent).toContain('42,750')
    // 「42,500 = 42,499 + 1」以 KaTeX 顯示（原始碼 42{,}500=42{,}499+1）
    expect(Array.from(r.container.querySelectorAll('.katex annotation')).some((a) => a.textContent === '42{,}500=42{,}499+1')).toBe(true)
    expect(r.container.textContent).toContain('golden/lms_pll_golden/comparator.py')
    // KaTeX 語法錯誤會產生 .katex-error（throwOnError: false），程式碼 region 錯誤會產生 role=alert 的「找不到」
    const bad = Array.from(r.container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.getAttribute('title') ?? e.textContent)
    expect(bad).toEqual([])
    // 公式裡不可以出現程式語言的科學記號（6.65e-8 會被 KaTeX 排成變數 e）：一律寫成 a×10^b
    const sci = Array.from(r.container.querySelectorAll('.katex annotation'))
      .map((e) => e.textContent ?? '')
      .filter((t) => /\d(\.\d+)?e[-+]?\d/.test(t))
    expect(sci).toEqual([])
    // 千分位在數學模式要寫成 42{,}499；直接寫「42,499」會被排成「42, 499」
    const commas = Array.from(r.container.querySelectorAll('.katex annotation'))
      .map((e) => e.textContent ?? '')
      .filter((t) => /\d,\d{3}(?!\d)/.test(t))
    expect(commas).toEqual([])
    expect(r.container.textContent).not.toMatch(/找不到程式碼 region/)
    expect(r.container.querySelector('#handcalc-HC-05\\.5')!.parentElement!.textContent).toContain('兩個公式的推導就在上面')
    await waitFor(() => expect(r.container.textContent).toContain('Monte Carlo 完成'))
    r.unmount()
    const b = renderChapter('/ch/05', 'beginner')
    expect(b.container.querySelector('[id="formula-F-05.13"]')).toBeNull()
    // Beginner：手算題照樣顯示（8 題），HC-05.5 的邀請文字指出推導在哪個模式
    expect(b.container.querySelectorAll('.c-handcalc').length).toBe(HANDCALCS.length)
    expect(b.container.querySelector('[id="formula-F-05.19"]')).toBeNull()
    expect(b.container.querySelector('#handcalc-HC-05\\.5')!.parentElement!.textContent).toContain('在 Engineer／Research 模式才顯示')
    // Beginner：逐步推導預設收合（只有先備知識框內明確指定 open 的 Φ–erf 推導例外）
    const steps = Array.from(b.container.querySelectorAll('details.ch05-steps')) as HTMLDetailsElement[]
    expect(steps.length).toBeGreaterThan(8)
    expect(steps.filter((d) => !d.open).length).toBeGreaterThanOrEqual(steps.length - 1)
    await waitFor(() => expect(b.container.textContent).toContain('Monte Carlo 完成'))
  }, SLOW)
})

describe('Ch05 實驗輔助（labModel）', () => {
  it('preset 參數解析：合法欄位套用、非法欄位略過', () => {
    const { c, sh } = parsePresetParams({ s: 2, sigma: -1, theta: 'x', tieRule: 'plus', N: 101.4, trials: 5, method: 'binomial', axis: 'average' })
    expect(c).toEqual({ s: 2, tieRule: 'plus' })
    expect(sh).toEqual({ N: 101, method: 'binomial', axis: 'average' })
  })

  it('失敗模式的警告會解釋原因：σ_v = 0、offset 蓋過誤差、s = 0、大誤差線性化、偶數 N 的 tie 偏差', () => {
    const w0 = labWarnings({ ...DEFAULT_CASE, sigma: 0 }, analyzeCase({ ...DEFAULT_CASE, sigma: 0 }, 11), 11)
    expect(w0.join('\n')).toMatch(/hard limiter/)
    const off = { ...DEFAULT_CASE, theta: 2 }
    expect(labWarnings(off, analyzeCase(off, 10001), 10001).join('\n')).toMatch(/Offset 蓋過誤差/)
    const z = { ...DEFAULT_CASE, s: 0 }
    expect(labWarnings(z, analyzeCase(z, 101), 101).join('\n')).toMatch(/沒有「正確方向」/)
    const big = { ...DEFAULT_CASE, s: 60 }
    expect(labWarnings(big, analyzeCase(big, 101), 101).join('\n')).toMatch(/線性化高估/)
    const tie = { ...DEFAULT_CASE, tieRule: 'plus' as const }
    expect(labWarnings(tie, analyzeCase(tie, 100), 100).join('\n')).toMatch(/平衡點會偏移約 \$-1\.2\d\d\\,\\mathrm\{fs\}\$/)
    // strict 在警告中標明「硬體上即 sign(0) = −1」，偏移為正
    const st = { ...DEFAULT_CASE, tieRule: 'strict' as const }
    expect(labWarnings(st, analyzeCase(st, 100), 100).join('\n')).toMatch(/\\operatorname\{sign\}\(0\)=-1\$）.*偏移約 \$1\.2\d\d\\,\\mathrm\{fs\}\$/)
    // 警告字串裡的數學一律是 `$...$` LaTeX（ExperimentShell 以 KaTeX 顯示），而且每一段都能解析、不含 e 記號
    const all = [w0, labWarnings(off, analyzeCase(off, 10001), 10001), labWarnings(z, analyzeCase(z, 101), 101), labWarnings(big, analyzeCase(big, 101), 101), labWarnings(tie, analyzeCase(tie, 100), 100)].flat()
    for (const msg of all) {
      expect(msg).not.toMatch(/[σθμ≥≤≈∓±]/)
      const segs = [...msg.matchAll(/\$([^$]+)\$/g)].map((m) => m[1])
      expect(segs.length, msg).toBeGreaterThan(0)
      for (const t of segs) {
        expect(renderTex(t, false), t).not.toContain('katex-error')
        expect(t).not.toMatch(/\d(\.\d+)?e[-+]?\d/)
      }
    }
    expect(labWarnings(DEFAULT_CASE, analyzeCase(DEFAULT_CASE, 10001), 10001)).toEqual([])
  })

  it('MC 掃描的 N 同時包含奇偶（顯示鋸齒），且不超過上限', () => {
    const ns = sweepNs(1000)
    expect(ns.some((n) => n % 2 === 0)).toBe(true)
    expect(ns.some((n) => n % 2 === 1)).toBe(true)
    expect(Math.max(...ns)).toBeLessThanOrEqual(1001)
  })
})

describe('Ch05 Analytic ↔ Monte Carlo 交叉比對（labModel.mcConsistency）', () => {
  it('T05: 預設參數（N = 10001、T = 4000、half）：三個 MC 計數都落在精確 Binomial 的接受域內', () => {
    const N = 10001
    const a = analyzeCase(DEFAULT_CASE, N)
    const mc = runComparatorMC({ s: 1, sigma: 100, theta: 0, N, trials: 4000, seed: 20261010, tieRule: 'half', method: 'auto' })
    const chk = mcConsistency(a, N, mc)
    expect(chk.ok).toBe(true)
    expect(chk.correct.n).toBe(4000)
    expect(chk.plus.n).toBe(N * 4000)
    expect(chk.tie.k).toBe(0) // 奇數 N 不可能 tie
    expect(chk.tie.kHi).toBe(0)
    // 容差（機率單位）大約是 4 個標準誤
    const se = Math.sqrt((a.outcome.correct * (1 - a.outcome.correct)) / 4000)
    expect(chk.correct.tol / se).toBeGreaterThan(3.5)
    expect(chk.correct.tol / se).toBeLessThan(4.5)
    expect(chk.detail).toMatch(/判對 \d+\/4000（接受域 \[\d+, \d+\]）/)
  })

  it('T05: 反面測試——MC 與解析用不同的 tie rule（E02 的錯誤）時必須判成 mismatch', () => {
    const N = 100
    const strict = analyzeCase({ ...DEFAULT_CASE, tieRule: 'strict' }, N) // 解析：49.2%
    const mcHalf = runComparatorMC({ s: 1, sigma: 100, theta: 0, N, trials: 40000, seed: 20261010, tieRule: 'half', method: 'auto' }) // MC：53.2%
    const bad = mcConsistency(strict, N, mcHalf)
    expect(bad.ok).toBe(false)
    expect(bad.correct.ok).toBe(false)
    expect(bad.plus.ok).toBe(true) // 單一樣本的統計不受 tie rule 影響
    expect(bad.tie.ok).toBe(true)
    expect(bad.detail).toContain('，超出）')
    // 用同一條 rule 就一致
    const mcStrict = runComparatorMC({ s: 1, sigma: 100, theta: 0, N, trials: 40000, seed: 20261010, tieRule: 'strict', method: 'auto' })
    expect(mcConsistency(strict, N, mcStrict).ok).toBe(true)
  })

  it('稀有事件不誤報：飽和 preset（P(判錯) ≈ 7.5e-7）與 σ_v = 0（完全確定）在多個 seed 下都一致', () => {
    const sat = { ...DEFAULT_CASE, s: 60 }
    const aSat = analyzeCase(sat, 101)
    for (const seed of [1, 2, 3, 20261010]) {
      const mc = runComparatorMC({ s: 60, sigma: 100, theta: 0, N: 101, trials: 4000, seed, tieRule: 'half', method: 'auto' })
      expect(mcConsistency(aSat, 101, mc).ok, `seed ${seed}`).toBe(true)
    }
    // 即使剛好有 1 次判錯也在接受域內（舊的 4·SE 判準會誤報）
    expect(mcConsistency(aSat, 101, { outcome: { correct: 3999, wrong: 1, hold: 0 }, counts: { pos: 3999, tie: 0, neg: 1 }, plusCount: Math.round(aSat.p * 101 * 4000), trialsUsed: 4000, methodUsed: 'sample' }).ok).toBe(true)
    const hl = { ...DEFAULT_CASE, sigma: 0 }
    const aHl = analyzeCase(hl, 11)
    const mcHl = runComparatorMC({ s: 1, sigma: 0, theta: 0, N: 11, trials: 1000, seed: 5, tieRule: 'half', method: 'auto' })
    const chk = mcConsistency(aHl, 11, mcHl)
    expect(chk.ok).toBe(true)
    expect([chk.correct.kLo, chk.correct.kHi]).toEqual([1000, 1000])
  })
})

describe('Ch05 數字格式（公式內不出現 e 記號）', () => {
  it('texNum：很小或很大的數寫成 a\\times10^{b}；一般大小保留有效位數', () => {
    expect(texNum(6.649e-8, 3)).toBe('6.65\\times10^{-8}')
    expect(texNum(-7.017e-6, 2)).toBe('-7\\times10^{-6}')
    expect(texNum(1e-10, 2)).toBe('10^{-10}')
    expect(texNum(2.5e9, 2)).toBe('2.5\\times10^{9}')
    expect(texNum(0.0000166668, 4)).toBe('1.667\\times10^{-5}')
    expect(texNum(0.15, 3)).toBe('0.15')
    expect(texNum(79.787, 5)).toBe('79.787')
    expect(texNum(0)).toBe('0')
    expect(texNum(Infinity)).toBe('\\infty')
    expect(texNum(NaN)).toBe('\\text{—}')
    expect(texInt(42498.58)).toBe('42{,}499')
    expect(texInt(1234567)).toBe('1{,}234{,}567')
    expect(texInt(30.4)).toBe('30')
  })

  it('sigOrZero：低於捨入誤差下限的量顯示「≈ 0」，不把捨入雜訊當有效數字', () => {
    expect(sigOrZero(7.988e-12, 4, 1e-9)).toMatch(/^≈ 0/)
    expect(sigOrZero(-1.98e-10, 4, 1e-9)).toMatch(/^≈ 0/)
    expect(sigOrZero(0.15, 4, 1e-9)).toBe('0.15')
    expect(sigOrZero(-7.017e-6, 4, 1e-9)).toBe('-7.017e-6')
  })
})

describe('Ch05 程式碼區塊（teaching-style §4：頁面顯示的就是實際執行的程式碼）', () => {
  it('章節中每個 CodeBlock / CodeCompare 的 region 都存在於 comparator.ts，且比較用的 region 都有「← 差異」標記', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/simulation/models/comparator.ts'), 'utf8')
    const have = new Set(listRegions(src))
    const dir = resolve(process.cwd(), 'src/chapters/ch05')
    const files = [
      ...readdirSync(resolve(dir, 'sections')).map((f) => resolve(dir, 'sections', f)),
      ...readdirSync(resolve(dir, 'experiments')).map((f) => resolve(dir, 'experiments', f)),
    ].filter((f) => f.endsWith('.tsx'))
    const used = new Set<string>()
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/region[=:]\s*["']([\w.-]+)["']/g)) used.add(m[1])
    expect(used.size).toBeGreaterThan(10)
    for (const r of used) expect(have.has(r), `region core:${r}`).toBe(true)
    // CodeCompare 的每一邊都要標出差異行
    for (const r of ['directionExact', 'directionClt', 'mcSampleLevel', 'mcBinomial', 'applyTieRule', 'classify']) {
      const body = src.split(`// #region core:${r}`)[1].split('// #endregion')[0]
      expect(body, r).toContain('← 差異')
    }
  })
})

describe('Ch05 presets 與公式登錄', () => {
  it('Gallery #2 preset 存在，且每個 comparator preset 都屬於本章實驗', () => {
    const g = presets.find((p) => p.galleryIndex === 2)
    expect(g?.id).toBe('comparator-1fs-100fs')
    expect(g?.page).toBe('/ch/05')
    for (const p of presets) {
      expect(['comparator-lab', 'comparator-dither']).toContain(p.experiment)
      expect(p.source).toBe('illustrative')
    }
  })

  it('T05: preset 文字中的數字由模型重算一致（不是手寫的假數字）', () => {
    const p = pPlus(1, 100)
    const gal = presets.find((x) => x.id === 'comparator-1fs-100fs')!
    expect(gal.expected).toContain('78.75%')
    expect(directionOutcomeExact(p, 10001, 'half').correct).toBeCloseTo(0.7875, 4)
    const tie = presets.find((x) => x.id === 'comparator-even-n100-tie')!
    expect(tie.expected).toContain('49.20%')
    expect(directionOutcomeExact(p, 100, 'strict').correct).toBeCloseTo(0.492, 4)
    expect(tie.expected).toContain('57.14%')
    expect(directionOutcomeExact(p, 100, 'plus').correct).toBeCloseTo(0.5714, 4)
    expect(tie.expected).toContain('53.17%')
    expect(directionOutcomeExact(p, 100, 'half').correct).toBeCloseTo(0.5317, 4)
    const off = presets.find((x) => x.id === 'comparator-offset-beats-error')!
    expect(off.expected).toContain('21.2%')
    expect(directionOutcomeExact(pPlus(1, 100, 2), 10001, 'half', 1).correct).toBeCloseTo(0.2125, 3)
  })

  it('T05: 每個 comparator-lab preset：解析交叉比對成立（|CLT − 精確| ≤ Berry–Esseen 上界），且 expected 文字的關鍵數字由模型重算', () => {
    for (const pr of presets.filter((x) => x.experiment === 'comparator-lab')) {
      const { c, sh } = parsePresetParams(pr.params)
      const cs = { ...DEFAULT_CASE, ...c }
      const N = sh.N ?? 10001
      const a = analyzeCase(cs, N)
      const exactStrict = a.t > 0 ? a.split.pos : a.split.neg
      expect(Math.abs(a.cltPlain - exactStrict), pr.id).toBeLessThanOrEqual(berryEsseenBound(a.m, N) + 1e-12)
      expect(a.split.pos + a.split.tie + a.split.neg, pr.id).toBeCloseTo(1, 12)
    }
    const n95 = presets.find((x) => x.id === 'comparator-n42499-95pct')!
    expect(n95.params.N).toBe(42499)
    expect(directionOutcomeExact(pPlus(1, 100), 42499, 'strict').correct).toBeGreaterThanOrEqual(0.95)
    expect(directionOutcomeExact(pPlus(1, 100), 42497, 'strict').correct).toBeLessThan(0.95)
    const sat = presets.find((x) => x.id === 'comparator-saturation')!
    expect(sat.expected).toContain('6.0%')
    expect(analyzeCase({ ...DEFAULT_CASE, s: 60 }, 101).linErr).toBeCloseTo(0.0603, 3)
    const hl = presets.find((x) => x.id === 'comparator-hard-limiter')!
    const ahl = analyzeCase({ ...DEFAULT_CASE, ...parsePresetParams(hl.params).c }, 11)
    expect(ahl.p).toBe(1)
    expect(ahl.Kq).toBe(Infinity)
  })

  it('公式 ID 唯一、格式 F-05.x，勘誤欄位只用本章負責的條目', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id) => expect(id).toMatch(/^F-05\.\d+$/))
    FORMULAS.filter((f) => f.erratumId).forEach((f) => expect(['E02', 'E07', 'E18']).toContain(f.erratumId))
    FORMULAS.forEach((f) => expect(f.page).toBe('/ch/05'))
  })

  it('公式登錄表的每一條 TeX 都能被 KaTeX 解析（Formula & Unit Reference 頁會直接顯示這些字串）', () => {
    for (const f of FORMULAS) {
      const html = renderTex(f.tex, true)
      expect(html, f.id).toContain('katex')
      expect(html, f.id).not.toContain('katex-error')
      expect(f.conditions.length, f.id).toBeGreaterThan(0)
    }
    // title／conditions 也會顯示在公式總表（mathText）：數學一律是 `$...$` LaTeX，不用 Unicode 拼公式，而且每一段都能解析
    let mathInText = 0
    for (const f of FORMULAS) {
      for (const text of [f.title, f.conditions]) {
        const plain = text.replace(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g, '')
        expect(plain, `${f.id}：數學要寫在 $...$ 裡`).not.toMatch(/[σμδθΦφπρη≤≥≈≡≪≠∝√²±←∈]|[A-Za-z]_[A-Za-z]/)
        expect((text.match(/(?<!\\)\$/g) ?? []).length % 2, `${f.id}：$ 要成對`).toBe(0)
        for (const m of text.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)) {
          mathInText++
          expect(renderTex(m[1], false), `${f.id}: ${m[1]}`).not.toContain('katex-error')
        }
      }
    }
    expect(mathInText).toBeGreaterThan(40)
    expect(FORMULAS.find((f) => f.id === 'F-05.15')!.conditions).toContain(String.raw`$\delta=a-w$`) // 全站極性 δ = a − w
    // F-05.20（block 版，綜合手算 HC-05.8 代的就是它）：同樣寫明 δ = a − w 與 average 模式（勘誤 E18），頁面上有錨點
    const f20 = FORMULAS.find((f) => f.id === 'F-05.20')!
    expect(f20.conditions).toContain(String.raw`$\delta=a-w$`)
    expect(f20.conditions).toContain('$G_k=S_N/N$')
    expect(f20.erratumId).toBe('E18')
    expect(f20.tex).toContain(String.raw`\sigma_w=\frac{\mu}{\sqrt{N\,(1-p_{\mathrm{cal}}^2)}}`)
    expect(HANDCALCS.find((h) => h.id === 'HC-05.8')!.formulaId).toBe('F-05.20')
    // F-05.2 與頁面一致：含 threshold θ，並註明 m ≡ m_q（勘誤 E34 的全站符號）
    const f2 = FORMULAS.find((f) => f.id === 'F-05.2')!
    expect(f2.tex).toContain('m_q')
    expect(f2.tex).toContain(String.raw`\frac{s-\theta}{\sqrt2\,\sigma_v}`)
  })
})
