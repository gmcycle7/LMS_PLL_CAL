import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import katex from 'katex'
import { SettingsProvider } from '@/app/settings'
import { presetsForExperiment } from '@/app/presets'
import { extractRegion, listRegions, systemMapModel } from '@/components'
import { plotMath } from '@/components/plotMath'
import { sanitizeMermaidSource } from '@/components/mermaidSource'
import quantSrc from '@/simulation/models/quantizer.ts?raw'
import { STRATEGIES, runQuantCriteria, runQuantLab } from '@/simulation/models/quantizer'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { DEFAULT_LAB_PARAMS } from './common'
import { DIAGRAMS, SYSTEM_MAP_FOCUS } from './diagrams'
import Chapter13 from './index'
import { EXPERIMENT_ID } from './experiments/QuantizedGainLab'
import { bernoulliVarSe, crossChecks, metricRows } from './experiments/labChecks'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))

// 記下每個 <Plot> 交給 applyPlotMath 的 data／layout（轉換前的字串），檢查圖內文字的數學都寫成 `$...$`
const PM = vi.hoisted(() => ({ inputs: [] as { data: unknown; layout: unknown }[] }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...mod,
    applyPlotMath: (data: unknown, layout: unknown) => {
      PM.inputs.push({ data, layout })
      return mod.applyPlotMath(data, layout)
    },
  }
})

const M = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, _chart: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: M }))

function renderChapter(mode: 'beginner' | 'engineer' | 'research' = 'engineer', route = '/ch/13') {
  localStorage.setItem('lmspll.mode', mode)
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SettingsProvider>
        <Chapter13 />
      </SettingsProvider>
    </MemoryRouter>,
  )
}

afterEach(() => localStorage.clear())

/** Plotly 圖內會顯示的文字欄位（與 src/components/plotMath.ts 的 TEXT_KEYS 相同）。 */
const PLOT_TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])

/** 取出 data／layout 裡所有會顯示在圖上的字串（轉換前，也就是原始碼裡寫的樣子）。 */
function plotTextStrings(value: unknown, key: string | null = null, depth = 0, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (key !== null && PLOT_TEXT_KEYS.has(key)) out.push(value)
    return out
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return out
  if (Array.isArray(value)) {
    if (typeof value[0] !== 'number') for (const v of value) plotTextStrings(v, key, depth + 1, out)
    return out
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) plotTextStrings(v, k, depth + 1, out)
  return out
}

/** 圖內文字在 `$...$` 以外不可再有 Unicode 拼的數學：希臘字母、上下標、運算符號、w_k 底線下標、x^2、w* 這類寫法。 */
const PLOT_UNICODE_MATH = /[\u0370-\u03ff\u2070-\u209f\u00b2\u00b3\u00b9∑∏√∞≤≥≠≈±∓·×÷∂∇∈∝⌊⌋⌈⌉−]|\b[A-Za-z]{1,3}_[A-Za-z0-9{]|\^|[A-Za-z0-9)\]]\*|\|[A-Za-z]/
const PLOT_INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/**
 * 時間上限：單獨執行時整章渲染約十幾秒；多個測試程序同時跑、CPU 嚴重超額時（load average 曾超過 600）會慢數十倍，
 * 所以把上限放寬——逾時只代表機器太忙，不該蓋掉真正的斷言。
 */
const WAIT_MS = 240_000
const TEST_MS = 300_000

describe('Chapter 13（jsdom smoke）', () => {
  // 每種學習模式各一個測試（各有自己的時間上限）：整章渲染一次要跑 8 題手算與所有章內模擬，
  // 多個測試程序同時執行、CPU 超額時，三種模式串在同一個測試裡會先撞到逾時而不是真正的斷言。
  it.each(['beginner', 'engineer', 'research'] as const)(
    '%s 模式能渲染不丟錯，包含章首系統地圖、全部方塊圖、章末符號表、五策略段落、勘誤標記、帶入手算與實驗',
    async (mode) => {
      const errSpy = vi.spyOn(console, 'error')
      try {
        const { unmount, container } = renderChapter(mode)
        // 符號表在章末（docs/teaching-style.md §5）：整頁最後一塊、外層 id="symbols"，排在思考題、本課必記與「連結到 PLL」之後
        const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
        expect(screen.getByText('本章符號')).toBeTruthy()
        const page = container.querySelector('.ch13') as HTMLElement
        const symbols = container.querySelector('#symbols') as HTMLElement
        expect(page.lastElementChild).toBe(symbols)
        expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
        expect(symbols.querySelector('.c-symbols')).not.toBeNull()
        expect(symbols.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(30)
        for (const sel of ['#ch13-quiz', '.c-recap', '#ch13-pll'])
          expect((container.querySelector(sel) as HTMLElement).compareDocumentPosition(symbols) & FOLLOWING, `${mode}: ${sel}`).toBeTruthy()
        // 章首只留一行按鈕（不是會改掉 HashRouter 路由的 href）：在開場問題與系統地圖之後、§13.1 之前；按下去捲到符號表
        const symLink = container.querySelector('[data-testid="ch13-symbols-link"]') as HTMLButtonElement
        expect(symLink.tagName).toBe('BUTTON')
        expect(symLink.textContent).toContain('本章符號表在最後')
        expect((container.querySelector('#ch13-question') as HTMLElement).compareDocumentPosition(symLink) & FOLLOWING).toBeTruthy()
        expect(symLink.compareDocumentPosition(container.querySelector('#ch13-freeze') as HTMLElement) & FOLLOWING).toBeTruthy()
        const scrolled: Element[] = []
        const proto = Element.prototype as unknown as { scrollIntoView?: (this: Element) => void }
        const savedScroll = proto.scrollIntoView
        proto.scrollIntoView = function (this: Element) {
          scrolled.push(this)
        }
        try {
          fireEvent.click(symLink)
          expect(scrolled).toEqual([symbols])
          expect(document.activeElement).toBe(symbols)
          fireEvent.click(container.querySelector('[data-testid="ch13-symbols-top"]') as HTMLButtonElement)
          expect(scrolled[1]).toBe(container.querySelector('#ch13-question'))
        } finally {
          proto.scrollIntoView = savedScroll
        }
        // 方塊圖：章首的系統地圖 + diagrams.ts 的每一張，三種學習模式都一樣多（不藏在 ModeGate 或等待模擬結果的區塊裡）
        const figs = Array.from(container.querySelectorAll('figure.c-mermaid'))
        expect(figs).toHaveLength(DIAGRAMS.length + 1)
        expect(figs[0].getAttribute('aria-label')).toContain('系統方塊圖')
        // 章首的系統地圖是手排的 SVG（不經 Mermaid）：藍色（is-focus）的方塊就是本章的主角，其餘的圖都是 Mermaid
        expect(figs[0].classList.contains('c-sysmap')).toBe(true)
        expect(container.querySelectorAll('figure.c-sysmap')).toHaveLength(1)
        const focusedIds = Array.from(figs[0].querySelectorAll('.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
        expect(focusedIds.sort(), mode).toEqual(systemMapModel(SYSTEM_MAP_FOCUS).blocks.filter((b) => b.focused).map((b) => b.id).sort())
        expect(focusedIds.sort(), mode).toEqual([...SYSTEM_MAP_FOCUS].sort())
        expect((container.querySelector('#ch13-question') as HTMLElement).compareDocumentPosition(figs[0]) & FOLLOWING).toBeTruthy()
        expect(figs[0].compareDocumentPosition(symLink) & FOLLOWING).toBeTruthy()
        for (const f of figs) expect(f.querySelector('figcaption')?.textContent?.length ?? 0, mode).toBeGreaterThan(10)
        expect(screen.getAllByText(/方法 A：Freeze/).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/方法 D：高解析 accumulator/).length).toBeGreaterThan(0)
        expect(container.querySelectorAll('.ch13-erratum').length).toBeGreaterThan(5)
        for (const id of ['E13', 'E15', 'E47', 'E49']) expect(screen.getAllByText(`勘誤 ${id}`).length).toBeGreaterThan(0)
        // 勘誤連到驗證頁
        const link = container.querySelector('a.ch13-erratum') as HTMLAnchorElement
        expect(link.getAttribute('href')).toBe('#/verification')
        expect(screen.getByText('Quantized Gain Lab：6-bit code、limit cycle、dither、ΔΣ')).toBeTruthy()
        // CodeCompare 顯示真實程式碼（不是 region 載入錯誤）
        expect(screen.queryByText(/程式碼載入錯誤/)).toBeNull()
        // 所有 LaTeX 都能被 KaTeX 解析（throwOnError:false 時錯誤會變成 .katex-error）
        const texErrors = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.getAttribute('title') ?? e.textContent)
        expect(texErrors).toEqual([])
        // §13.4 的共變異數由完整週期計算：Cov(r[n−1], r[n]) = −0.0400（舊版用 499 對相鄰樣本，顯示成 −0.0401）
        expect(container.textContent).toContain(String.raw`\mathrm{Cov}(r[n-1],r[n])=-0.0400`)
        expect(container.textContent).not.toContain('-0.0401')
        // 架構（docs/assumptions.md §2a）：DTC 在 reference 輸入端、回授路徑只有 divider；校正迴路取 PD 的輸出；DTC 的是「補償量」不是插入的延遲
        const pllSec = (container.querySelector('#ch13-pll') as HTMLElement).textContent ?? ''
        for (const phrase of ['Reference clock', '回授路徑上只有 divider', '校正迴路的輸入是 PD 的輸出', '和送進 loop filter 的是同一個訊號', 'DTC 補償量的誤差']) expect(pllSec, `${mode}: #ch13-pll「${phrase}」`).toContain(phrase)
        const walkSec = (container.querySelector('#ch13-diagram') as HTMLElement).textContent ?? ''
        expect(walkSec, mode).toContain('comparator 取的是 PD 的輸出')
        expect(walkSec, mode).toContain('補償量')
        expect(container.textContent, mode).not.toMatch(/DTC 延遲|DTC delay|插入延遲|推回|DTC 注入/)
        // δt 的正負號寫清楚（多補償為正；PD 量 reference 減 feedback，所以看到 −δt）：整頁沒有不帶方向的「reference edge 上殘留的 timing error」
        expect(container.textContent, mode).not.toMatch(/殘留的 timing error/)
        expect(pllSec, mode).toContain('多補償為正')
        expect((container.querySelector('#ch13-freeze') as HTMLElement).textContent, mode).toContain('以多補償為正')
        expect(symbols.textContent, mode).toContain(String.raw`(a-w)\,x+v=-\delta t+v`)
        expect(symbols.textContent, mode).toContain(String.raw`\phi_\mathrm{dtc}=-2\pi f_\mathrm{out}\,\delta t`)
        // 符號表有 PD 輸出 e_PD 與 DTC 的基準延遲 T_0 / 中心 code C_0
        expect(symbols.textContent, mode).toContain(String.raw`e_\mathrm{PD}[n]`)
        expect(symbols.textContent, mode).toContain(String.raw`T_0,\;C_0`)
        // §13.6 的 wrap 示範：40% 的更新被繞回 0（硬體丟掉進位，r 不會多出 64）
        expect(container.querySelector('#ch13-nonideal')?.textContent).toContain('40.0%')
        // §13.6 第 4 點（審查 R04）：gray 碼的手算（31 → 34 翻 3 個 bit、可能讀到 28 到 35）與表格的 gray 欄在每種模式都看得到
        const nonIdeal = container.querySelector('#ch13-nonideal')?.textContent ?? ''
        for (const s of ['462 / 2777', '403 / 2777', '110011_2', String.raw`\{28,29,30,31,32,33,34,35\}`, String.raw`010011_2:\ b_5b_4b_3b_2b_1b_0=0,\ 0\oplus1,\ 1\oplus0,\ 1\oplus0,\ 1\oplus1,\ 0\oplus1=011101_2=29`, '這個保證只對相鄰的 code', 'asynchronous FIFO', '本站沒有模擬非同步 ZOH'])
          expect(nonIdeal, `${mode}: #ch13-nonideal「${s}」`).toContain(s)
        // 讀表文字的數字來自同一次模擬：D 有 3 次跳 2 LSB 以上，E 的 2777 次切換裡 462 次
        expect(nonIdeal, mode).toContain('D 有 3 次跳 2 LSB 以上（最多一次跳 2 LSB）')
        expect(nonIdeal, mode).toMatch(/E 的 2777 次切換裡有 462 次跳 2 LSB 以上，改用 gray 碼後仍有 462 次是多 bit 翻轉（二進位那一欄是 403 次）/)
        // §13.4 的 telescoping（審查 C02）：常數 1 的條件與反例不可藏在 ModeGate 後面
        const dsSec = container.querySelector('#ch13-deltasigma')?.textContent ?? ''
        expect(dsSec, mode).toContain('常數要小心')
        for (const s of ['u=31.41', 'r[0]=1.4', String.raw`-1.4\,\mathrm{LSB}`, '大小卻超過', '(1+A)/N=3']) expect(dsSec, `${mode}: #ch13-deltasigma「${s}」`).toContain(s)
        // (1 + A)/N 這個上界也帶著自己的條件（沒有 overload、r[−1] 在變寬後的範圍內），不是只寫在方法 D 那一句
        expect(dsSec, mode).toMatch(/上界變成 .*（一樣要沒有 overload，而且 .* 也在這個範圍內）/)
        expect(dsSec, mode).not.toContain('永遠追得上')
        // §13.4E 的工程取捨（Engineer 以上）：dither 讓平均追蹤的常數由 1 變成 1 + A，並連回 §13.6 的 CDC 條件
        const ditherSec = container.querySelector('#ch13-dither')?.textContent ?? ''
        if (mode === 'beginner') expect(ditherSec).not.toContain('平均追蹤的常數變大')
        else for (const s of ['平均追蹤的常數變大', '(1+A)/N', '§13.6 第 4 點']) expect(ditherSec, `${mode}: #ch13-dither「${s}」`).toContain(s)
        // 符號表：Δy 與 gray(n)
        expect(symbols.textContent, mode).toContain(String.raw`\Delta y[n]=y[n]-y[n-1]`)
        expect(symbols.textContent, mode).toContain(String.raw`\mathrm{gray}(n)=n\oplus\lfloor n/2\rfloor`)
        // 每個登錄的公式 ID 在每種模式都恰好有一個 TexBlock 錨點（Formula & Unit Reference 頁會連過來）
        for (const f of FORMULAS) expect(container.querySelectorAll(`[id="formula-${f.id}"]`).length, `${mode}: ${f.id}`).toBe(1)
        // 「帶入手算」：HC-13.1 … HC-13.8 在每種模式都各出現一次（不藏在收合的推導框裡），順序與章節一致
        expect(Array.from(container.querySelectorAll('.c-handcalc')).map((el) => el.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
        for (const el of Array.from(container.querySelectorAll('.c-handcalc'))) {
          expect(el.closest('details'), `${mode}: ${el.id} 不應放在可收合的區塊內`).toBeNull()
          expect(el.querySelectorAll('.c-step').length, `${mode}: ${el.id}`).toBeGreaterThan(0)
        }
        // 綜合題放在「思考題」之前（docs/teaching-style.md §7）
        const syn = container.querySelector('#ch13-synthesis') as HTMLElement
        const quiz = container.querySelector('#ch13-quiz') as HTMLElement
        expect(syn.querySelector('[id="handcalc-HC-13.8"]')).not.toBeNull()
        expect(syn.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        unmount()
        // React 的 key / hooks / DOM 巢狀警告都走 console.error：smoke render 不允許任何一則
        expect(errSpy.mock.calls.map((c) => String(c[0]))).toEqual([])
      } finally {
        errSpy.mockRestore()
      }
    },
    TEST_MS,
  )

  it('實驗在 jsdom 以 inline 模式跑完，顯示週期偵測（常數 32.4 的 Toggle：週期 5）與五策略總表', async () => {
    const { container } = renderChapter('engineer')
    await waitFor(() => expect(container.querySelector('.ch13-period')).not.toBeNull(), { timeout: WAIT_MS, interval: 250 })
    const period = container.querySelector('.ch13-period') as HTMLElement
    expect(period.textContent).toContain('Limit-cycle period detector')
    expect(period.querySelector('.ch13-period-detected')?.textContent).toBe('5')
    const summaries = Array.from(container.querySelectorAll('summary')).map((s) => s.textContent ?? '')
    expect(summaries.some((t) => t.includes('五策略總表'))).toBe(true)
    // 勘誤 E15 的 acceptance check 直接顯示在五策略總表上方（由模擬結果判定，不是寫死的文字）
    const accept = container.querySelector('[data-testid="ch13-accept-db"]') as HTMLElement
    expect(accept.textContent).toContain('✓ D ≡ B')
    expect(accept.textContent).toContain('[32, 33, 32, 33, 32]')
    // Freeze/Track 切換按鈕存在（規格 §13.6）
    expect(Array.from(container.querySelectorAll('button')).some((b) => /凍結 Freeze/.test(b.textContent ?? ''))).toBe(true)
    // 六準則表（runQuantCriteria，inline worker）
    await waitFor(() => expect(container.querySelector('#ch13-criteria table')).not.toBeNull(), { timeout: WAIT_MS, interval: 250 })
    const crit = container.querySelector('#ch13-criteria') as HTMLElement
    // 「FCW 陷阱」示範與解析度說明都由模擬結果產生（混頻週期 640 與 2621440 個 cycle）
    expect(crit.textContent).toContain('FCW 陷阱')
    expect(crit.textContent).toContain('2621440')
    expect(crit.textContent).toContain(String.raw`\mathrm{lcm}(5,128)=640`)
    // 準則 3 的排序由數字推得：本例 Freeze 最小、limit cycle（B、D）最大
    expect(crit.textContent).toMatch(/由小到大：\s*A（/)
    expect(crit.textContent).toContain('本例最差的是週期性的 limit cycle')
    // 非同步結果出現後，整頁仍然沒有 KaTeX 解析錯誤
    expect(Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)).toEqual([])
    // diagrams.ts 的每一張圖的原始碼都真的交給 mermaid.render，沒有任何一張顯示成解析失敗
    // （Mermaid 元件先經 sanitizeMermaidSource 把 `$...$` 標籤合併成 KaTeX 的 `$$...$$`，所以比對前處理後的原始碼）；
    // 章首的系統地圖是手排的 SVG，不會交給 Mermaid
    const wanted = DIAGRAMS.map((d) => d.chart).map(sanitizeMermaidSource)
    await waitFor(
      () => {
        const sent = new Set(M.render.mock.calls.map((c) => c[1]))
        for (const chart of wanted) expect(sent.has(chart), chart.slice(0, 60)).toBe(true)
      },
      { timeout: WAIT_MS, interval: 250 },
    )
    await waitFor(() => expect(container.querySelectorAll('figure.c-mermaid:not(.c-sysmap) .c-mermaid-svg > svg')).toHaveLength(wanted.length), { timeout: WAIT_MS, interval: 250 })
    expect(container.querySelectorAll('figure.c-sysmap .c-mermaid-svg svg.c-sysmap-svg')).toHaveLength(1)
    expect(screen.queryByText('Mermaid 圖解析失敗')).toBeNull()
    // 互動圖表（Plotly）圖內的文字：軸標題、圖例名稱、tick 文字、hover 文字裡的數學都寫成 `$...$`，
    // 而且每一段 `$...$` 經 plotMath 轉換後不殘留反斜線、大括號或 `$`（不支援的 TeX 指令會原樣顯示指令名稱）
    const strings = [...new Set(PM.inputs.flatMap((i) => [...plotTextStrings(i.data), ...plotTextStrings(i.layout)]))]
    expect(strings.length).toBeGreaterThan(40)
    let withMath = 0
    for (const s of strings) {
      const plain = s.replace(PLOT_INLINE_MATH, (whole: string) => {
        withMath++
        const shown = plotMath(whole)
        expect(shown, `Plot 文字 ${s}`).not.toMatch(/[\\{}$]/)
        expect(shown.length, `Plot 文字 ${s}`).toBeGreaterThan(0)
        return ''
      })
      expect(plain, `Plot 文字裡的數學請寫成 $...$ —— ${s}`).not.toMatch(PLOT_UNICODE_MATH)
    }
    expect(withMath).toBeGreaterThan(40)
    // 幾個代表性的字串真的轉成斜體符號與上下標（不是原樣顯示 TeX）
    const shown = strings.map(plotMath)
    expect(shown).toContain('<i>y</i>[<i>n</i>]（6-bit code）')
    expect(shown.some((x) => x.includes('<i>f</i>') && x.includes('<sub><i>u</i></sub>'))).toBe(true)
    expect(shown.some((x) => x.includes('LSB<sup>2</sup>'))).toBe(true)
  }, TEST_MS)

  it('?preset=quant-fixed-point-period-512 會套用 preset（偵測週期 512、定點格點）', async () => {
    const { container } = renderChapter('engineer', '/ch/13?preset=quant-fixed-point-period-512')
    await waitFor(
      () => {
        const el = container.querySelector('.ch13-period') as HTMLElement | null
        expect(el?.textContent ?? '').toContain('fixed')
        expect(el?.querySelector('.ch13-period-detected')?.textContent).toBe('512')
      },
      { timeout: WAIT_MS, interval: 250 },
    )
  }, TEST_MS)
})

describe('Chapter 13：網址 preset 的 Case 清單', () => {
  it('?preset=quant-lms-noise-time-varying：三個 Case（B / C / D，皆含 LMS 雜訊）全部套用，不殘留預設的 ΔΣ + dither（舊版只更新 Case A）', async () => {
    const { container } = renderChapter('engineer', '/ch/13?preset=quant-lms-noise-time-varying')
    await waitFor(
      () => {
        const text = container.querySelector('#ch13-lab')?.textContent ?? ''
        expect(text).toContain('Case A：(B) Deterministic Toggle（LMS 雜訊）')
        expect(text).toContain('Case B：(C) Stochastic Rounding（LMS 雜訊）')
        expect(text).toContain('Case C：(D) 1st-order ΔΣ（EFB）（LMS 雜訊）')
      },
      { timeout: WAIT_MS, interval: 250 },
    )
    expect(container.querySelector('#ch13-lab')?.textContent ?? '').not.toContain('Case C：(E)')
    // 時變情境：沒有解析期望值 ⇒ 不顯示 D ≡ B 的 acceptance 判定
    expect(container.querySelector('[data-testid="ch13-accept-db"]')).toBeNull()
  }, TEST_MS)

  it('?preset=quant-overload-wrap：兩個 Case（ΔΣ 與 Freeze）；wrap 的 ΔΣ 偵測到週期 5 並顯示 overload 警告', async () => {
    const { container } = renderChapter('engineer', '/ch/13?preset=quant-overload-wrap')
    await waitFor(
      () => {
        const el = container.querySelector('.ch13-period') as HTMLElement | null
        expect(el?.querySelector('.ch13-period-detected')?.textContent).toBe('5')
        // 偵測窗口從 n = L/4 = 1024 起（1024 mod 5 = 4）⇒ 顯示的一個週期是 [63, 0, 63, 0, 63] 的循環移位
        expect(el?.textContent ?? '').toContain('[63, 63, 0, 63, 0]')
      },
      { timeout: WAIT_MS, interval: 250 },
    )
    const lab = container.querySelector('#ch13-lab')?.textContent ?? ''
    expect(lab).toContain('超出 6-bit code 範圍')
    expect(lab).toMatch(/Case A：Overflow \d+ 次且使用 wrap/)
    // 警告裡的數學（w*、[0, 63]、→）先經 warnTex 換成 `$...$`，再由 KaTeX 顯示：沒有解析錯誤，也沒有殘留的 Unicode 拼字
    const warnBox = container.querySelector('#ch13-lab .c-exp-warnings') as HTMLElement
    expect(warnBox.querySelectorAll('.katex').length).toBeGreaterThan(1)
    expect(warnBox.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    expect(warnBox.textContent).toContain('w^*')
    // KaTeX 以外的純文字（把 .katex 節點拿掉再看）不再有 w*、→ 或落單的 $
    const plain = warnBox.cloneNode(true) as HTMLElement
    plain.querySelectorAll('.katex').forEach((el) => el.remove())
    expect(plain.textContent).toContain('超出 6-bit code 範圍')
    expect(plain.textContent).not.toMatch(/w\*|→|\$/)
  }, TEST_MS)
})

describe('Chapter 13：Lab 的交叉比對必須誠實（labChecks）', () => {
  const shared = (() => {
    const { lmsNoise: _a, nUpd: _b, ...rest } = { ...DEFAULT_LAB_PARAMS, mixing: false }
    return rest
  })()
  const runOne = (over: Partial<typeof DEFAULT_LAB_PARAMS>, strategy: (typeof STRATEGIES)[number], lmsNoise = false) =>
    runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, mixing: false, ...over }, cases: [{ id: 'A', strategy, lmsNoise, nUpd: 1 }], compareAll: false }).runs[0]

  it('T17: stochastic 的 Analytic 檢查真的比對樣本變異與 p(1−p)（±4SE），Monte Carlo 比對平均', () => {
    const run = runOne({}, 'stochastic')
    const cc = crossChecks(run, shared, DEFAULT_LAB_PARAMS.length)
    expect(cc.analytic.status).toBe('ok')
    expect(cc.analytic.note).toMatch(/樣本變異/)
    expect(cc.monteCarlo.status).toBe('ok')
    // 故意把解析值改錯 → 必須報 mismatch（不可無條件 ok）
    const bad = { ...run, theory: { ...run.theory!, variance: 0.2, errPower: 0.2 } }
    expect(crossChecks(bad, shared, DEFAULT_LAB_PARAMS.length).analytic.status).toBe('mismatch')
  })

  it('Freeze/Track：LMS 凍結後的定點常數 w_H，Fixed-Point 檢查比對偵測週期與 D/gcd（ok）；Analytic 仍為 n/a（沒有封閉解）', () => {
    const over = { arithmetic: 'fixed' as const, fracBits: 8, length: 8192, lmsFreezeAt: 2048, lmsNoise: true }
    const r = runOne(over, 'deltaSigma', true)
    const cc = crossChecks(r, { ...shared, ...over }, over.length)
    expect(cc.analytic.status).toBe('n/a')
    expect(cc.fixedPoint.status).toBe('ok')
    expect(cc.fixedPoint.note).toMatch(/LMS 凍結後/)
  })

  it('沒做的就不標 ok：E 的 Monte Carlo 為 not-implemented；時變情境 Analytic 為 n/a；Freeze 的 Monte Carlo 為 n/a', () => {
    expect(crossChecks(runOne({}, 'deltaSigmaDither'), shared, DEFAULT_LAB_PARAMS.length).monteCarlo.status).toBe('not-implemented')
    const tv = crossChecks(runOne({ lmsNoise: true }, 'deltaSigma', true), shared, DEFAULT_LAB_PARAMS.length)
    expect(tv.analytic.status).toBe('n/a')
    expect(tv.fixedPoint.status).toBe('n/a')
    expect(crossChecks(runOne({}, 'freeze'), shared, DEFAULT_LAB_PARAMS.length).monteCarlo.status).toBe('n/a')
    expect(crossChecks(undefined, shared, 100).analytic.status).toBe('not-implemented')
  })

  it('T16: Fixed-Point 檢查——F = 10 時偵測週期 = 2^F/gcd = 512（ok）；float 32.3 的 tie 翻轉報 mismatch', () => {
    const fixed = { ...shared, arithmetic: 'fixed' as const, fracBits: 10 }
    const r = runOne({ arithmetic: 'fixed', fracBits: 10 }, 'deltaSigma')
    const cc = crossChecks(r, fixed, DEFAULT_LAB_PARAMS.length)
    expect(cc.fixedPoint.status).toBe('ok')
    expect(cc.fixedPoint.note).toMatch(/512/)
    expect(cc.analytic.status).toBe('ok')
    const fl = runOne({ target: 32.3, arithmetic: 'float', length: 1000 }, 'deltaSigma')
    expect(crossChecks(fl, { ...shared, target: 32.3, arithmetic: 'float', length: 1000 }, 1000).fixedPoint.status).toBe('mismatch')
    // 記錄太短：解析週期 > 可偵測上限 ⇒ n/a（不可假裝 ok）
    const short = runOne({ arithmetic: 'fixed', fracBits: 16, length: 4096 }, 'deltaSigma')
    expect(crossChecks(short, { ...shared, arithmetic: 'fixed', fracBits: 16, length: 4096 }, 4096).fixedPoint.status).toBe('n/a')
  })

  it('metricRows：stochastic 的總功率容差由 p(1−p) 推得（不是寫死 0.0096），頻帶內列標示精確 / 近似', () => {
    const r = runOne({ target: 32.25 }, 'stochastic')
    const rows = metricRows(r, { ...shared, target: 32.25 })
    const pow = rows.find((x) => x.name.startsWith('總誤差功率'))!
    expect(pow.analytic).toBeCloseTo(0.1875, 12)
    expect(pow.tolerance).toBeCloseTo(4 * bernoulliVarSe(0.1875, DEFAULT_LAB_PARAMS.length) + 1e-9, 12)
    expect(Math.abs((pow.value as number) - 0.1875)).toBeLessThanOrEqual(pow.tolerance!)
    const lf = rows.find((x) => x.name.startsWith('頻帶內誤差'))!
    expect(lf.claim).toBe('approx')
    const rb = metricRows(runOne({}, 'toggle'), shared)
    expect(rb.find((x) => x.name.startsWith('頻帶內誤差'))!.claim).toBe('exact')
    // 指標的單位也寫成 `$...$`（MetricRow.unit 支援）：不再有 Unicode 上標的 LSB²
    expect(pow.unit).toBe(String.raw`$\mathrm{LSB}^2$`)
    for (const row of [...rows, ...rb]) expect(row.unit ?? '', row.name).not.toMatch(/[²³⁻]/)
    expect(rb.filter((x) => x.unit === String.raw`$\mathrm{LSB}^2$`).length).toBeGreaterThanOrEqual(5)
  })

  it('§13.5b 相位檢查：floor 版 D 與 B 逐點相同 ⇒ σ_out 完全相同；解析得出來的 FCW 下 round-half-up 版（循環移位）也幾乎相同；FCW 陷阱下「靜態偏移」跟著相位變', () => {
    const res = runQuantCriteria({ params: { ...DEFAULT_LAB_PARAMS, length: 4000, mixSamples: 1 << 15, nperseg: 1024 }, driftPerK: 0.2, nUpdSlow: 256, trapFrac: 0.1 })
    expect(res.phase.dsFloor).toBe(res.phase.toggle)
    expect(res.phaseMean.dsFloor).toBe(res.phaseMean.toggle)
    expect(res.rows).toHaveLength(5)
    // 預設 FCW = 13/128：混頻週期 640 個 cycle，全部解析得出來 ⇒ B 與 D 的 σ_out 只差在數值誤差的量級
    expect(Math.abs(res.phase.dsNearest! - res.phase.toggle!) / res.phase.toggle!).toBeLessThan(1e-3)
    // 本例最差的是 limit cycle（B、D），Freeze 最小：與 E15「D ≡ B」及 §13.5「dither 不一定勝過 Freeze」一致
    const out = (s: string) => res.rows.find((r) => r.strategy === s)!.constant.sigmaOutFs!
    expect(out('toggle')).toBeGreaterThan(out('stochastic'))
    expect(out('deltaSigma')).toBeGreaterThan(out('deltaSigmaDither'))
    expect(out('freeze')).toBeLessThan(out('deltaSigmaDither'))
    // FCW 陷阱（frac = 0.1）：短紀錄的 σ_out 嚴重低估，B 與 D 的「靜態偏移」不同；完整週期的慢階梯才是真正的 in-band 成分
    const trap = res.trap!
    expect(trap.productPeriod).toBe(5 * 2 ** 19)
    expect(trap.complete).toBe(true)
    expect(Math.abs(trap.short.meanToggle - trap.short.meanDs)).toBeGreaterThan(0.005)
    expect(trap.slowRmsFs).toBeGreaterThan(3 * trap.short.sigmaOutToggle)
    expect(trap.slowRmsFs / out('toggle')).toBeGreaterThan(0.8)
    expect(trap.slowRmsFs / out('toggle')).toBeLessThan(1.25)
    // 有 mixing 的情境使用相同數目的 reference cycle ⇒ 相同的積分下限 f_L（快 / 慢更新率才是同一個量的比較）
    for (const r of res.rows) {
      expect(r.constant.fLowHz).toBe(r.slow.fLowHz)
      expect(r.constant.fLowHz).toBe(r.noise.fLowHz)
      expect(r.drift.sigmaOutFs).toBeNull() // drift 情境不算 mixing
    }
  })
})

describe('Chapter 13：資料與程式碼一致性', () => {
  it('頁面引用的 core region 都存在於 quantizer.ts', () => {
    const regions = listRegions(quantSrc)
    for (const r of ['quantize', 'residual', 'freezeStep', 'toggleStep', 'stochasticStep', 'deltaSigmaStep', 'deltaSigmaDitherStep', 'prbs', 'dither', 'lmsTarget', 'lineSpectrum', 'zohWeight', 'efbPeriod', 'whiteApprox', 'mixing', 'slowProduct', 'runQuantLab'])
      expect(regions).toContain(r)
    // 五個策略的差異行都有標記
    for (const r of ['freezeStep', 'toggleStep', 'stochasticStep', 'deltaSigmaStep', 'deltaSigmaDitherStep']) expect(extractRegion(quantSrc, r)).toContain('← 差異')
  })

  it('公式登錄：ID 唯一、格式 F-13.x、勘誤 id 正確', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-13\.\d+$/)
      expect(f.page).toBe('/ch/13')
      if (f.erratumId) expect(['E13', 'E15', 'E47', 'E49']).toContain(f.erratumId)
    }
  })

  it('F-13.12（審查 C02）：等式仍是 exact；上界寫成 (1 + A)/N，使用條件帶著 dither、overload、r[−1] 的範圍與單位', () => {
    const f = FORMULAS.find((x) => x.id === 'F-13.12')!
    expect(f.claim).toBe('exact')
    expect(f.title).toBe('ΔΣ 的平均追蹤（telescoping）')
    expect(f.specSection).toBe('13.4')
    expect(f.tex).toContain(String.raw`\frac{r[-1]-r[N-1]}{N}`)
    expect(f.tex).toContain(String.raw`\frac{1+A}{N}`)
    // A = 0（方法 D）時的 1/N 仍看得到；不再是沒有條件的「≤ 1/N」
    expect(f.tex).toContain(String.raw`\big(A=0:\ \tfrac1N\big)`)
    expect(f.tex).not.toMatch(/\\le\\frac1N$/)
    for (const s of ['dither', 'overload', 'r[-1]', 'LSB', String.raw`$|r|\le\tfrac12+\tfrac A2$`, String.raw`$-\tfrac A2\le r\le1+\tfrac A2$`, '常數不一定是 1']) expect(f.conditions, s).toContain(s)
    expect(f.conditions).not.toBe(String.raw`$r$ 有界（無 overload）；對任意時變 $w_H$ 都成立`)
    expect(f.units).toEqual({ y: 'LSB', w_H: 'LSB', r: 'LSB', A: 'LSB（峰對峰）' })
    // 使用條件裡的數學都寫成 $...$，而且每一段都能被 KaTeX 解析
    const parts = f.conditions.split('$')
    expect(parts.length % 2).toBe(1)
    for (const tex of parts.filter((_, i) => i % 2 === 1)) expect(() => katex.renderToString(tex, { throwOnError: true }), tex).not.toThrow()
    expect(parts.filter((_, i) => i % 2 === 0).join(' ')).not.toMatch(/[≤≥±−∑]|[A-Za-z]_[A-Za-z0-9{]|\\/)
  })

  it('presets：Gallery #10 存在、屬於本實驗，且每個 preset 的參數都能跑', () => {
    const ps = presetsForExperiment(EXPERIMENT_ID)
    expect(ps.length).toBeGreaterThanOrEqual(6)
    const g10 = ps.find((p) => p.galleryIndex === 10)
    expect(g10).toBeTruthy()
    expect(g10!.page).toBe('/ch/13')
    for (const p of ps) {
      expect(p.id.startsWith('quant')).toBe(true)
      const { cases, ...rest } = p.params as Record<string, unknown> & { cases: { strategy: (typeof STRATEGIES)[number]; lmsNoise: boolean; nUpd: number }[] }
      const params = { ...DEFAULT_LAB_PARAMS, ...rest, mixing: false, length: Math.min(Number(rest.length ?? 4096), 4096) }
      const r = runQuantLab({ params, cases: cases.map((c, i) => ({ id: String(i), ...c })), compareAll: false })
      expect(r.runs.length).toBe(cases.length)
    }
  })

  it('Gallery #10 的期望值：A −0.4 / 0.16、B ≡ D 週期 5、0.24、C ≈ 0.24、E ≈ 0.32 無譜線', () => {
    const r = runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 1 << 15 }, cases: [], compareAll: true, compareScenario: { lmsNoise: false, nUpd: 1 } })
    const get = (s: string) => r.compare.find((x) => x.strategy === s)!
    expect(get('freeze').metrics.dcError).toBeCloseTo(-0.4, 12)
    expect(get('freeze').metrics.errPower).toBeCloseTo(0.16, 12)
    expect(get('toggle').metrics.period).toBe(5)
    expect(get('deltaSigma').metrics.period).toBe(5)
    expect(get('toggle').lines[0].power).toBeCloseTo(0.2094427191, 9)
    expect(get('deltaSigma').lines[0].power).toBeCloseTo(0.2094427191, 9)
    expect(Math.abs(get('stochastic').metrics.errPower - 0.24)).toBeLessThan(0.01)
    expect(get('deltaSigmaDither').metrics.errPower).toBeGreaterThan(0.3)
    expect(get('deltaSigmaDither').metrics.maxSpur).toBeNull()
  })
})
