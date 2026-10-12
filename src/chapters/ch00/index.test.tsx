import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { conventionalStep } from '@/simulation/models/lms'
import { num } from './format'
import Chapter00 from './index'
import { HAND_CALC_PARAMS, HandCalcSection, HandCalcTable } from './sections/HandCalc'
import { SYMBOLS } from './sections/Symbols'
import { IntroPlayground } from './experiments/IntroPlayground'
import { NoiseAverageLab } from './experiments/NoiseAverageLab'

// 重量級外部函式庫：jsdom 中以假物件取代
vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn(async () => undefined),
    purge: vi.fn(),
    toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    downloadImage: vi.fn(async () => ''),
    Plots: { resize: vi.fn() },
    Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
  },
}))
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  },
}))
// 包一層 spy：證明手算表的數字真的來自 lms.ts 的 conventionalStep
vi.mock('@/simulation/models/lms', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/simulation/models/lms')>()
  return { ...orig, conventionalStep: vi.fn(orig.conventionalStep) }
})

function wrap(ui: React.ReactNode, path = '/ch/00') {
  return (
    <SettingsProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </SettingsProvider>
  )
}

/** 元素的文字；其中的 KaTeX 以 `$TeX 原始碼$` 表示（KaTeX 的 textContent 會重複 MathML 與 HTML 兩份，不適合直接比對）。 */
function texText(el: Element | null | undefined): string {
  if (!el) return ''
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.replaceWith(`$${k.querySelector('annotation')?.textContent ?? ''}$`))
  return c.textContent ?? ''
}

function headingTexts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4')).map((h) => texText(h).trim())
}

/**
 * 符號表移到章末之後（teaching-style §5），正文裡每個符號第一次出現的段落都要有一句白話說明。
 * [段落, 這一段必須出現的說明]；符號以 KaTeX 的 TeX 原始碼比對（見 texText）。
 */
const EXPLAINED_AT_FIRST_USE: [string, string][] = [
  ['ch00-blackbox', '餵它一個輸入 $x$'], // x、y
  ['ch00-blackbox', '乘上一個固定的數 $a$'], // a
  ['ch00-blackbox', '把這個雜訊記為 $v$（時正時負、平均是 0）'], // v
  ['ch00-blackbox', '一個可以調的數 $w$，代表「目前猜 $a$ 是多少」'], // w
  ['ch00-blackbox', String.raw`$\hat y=wx$ 叫預測`], // ŷ
  ['ch00-blackbox', String.raw`$e=y-\hat y$ 叫誤差`], // e
  ['ch00-blackbox', '讀作「a hat」，下標 LS 是 least squares'], // â_LS
  ['ch00-loop', '下標 $n$ 表示「第 $n$ 筆資料」'], // n
  ['ch00-loop', String.raw`這一小步記為 $\Delta w_n$（更新量）`], // Δw
  ['ch00-loop', String.raw`一個我們自己選的小正數 $\mu$ 控制，稱為學習率`], // μ
  ['ch00-hand', String.raw`參數誤差 $\delta_n=a-w_n$，也就是「猜測離真正的 $a$ 還差多少」`], // δ
  ['ch00-hand', '把這個倍數記為 $p$，稱為 pole（極點）'], // p
  ['ch00-playground', String.raw`它的標準差（RMS，抖動的典型大小）記為 $\sigma_v$`], // σ_v
  ['ch00-why-ex', String.raw`穩定上限 $\mu_{\max}=2/x^2$`], // μ_max
  ['ch00-why-ex', String.raw`定義「這筆資料讓我們多不滿意」的分數 $j_n(w)=\tfrac12e_n^2$`], // j_n
  ['ch00-why-ex', '$J(w)$ 是平均成本'], // J(w)
  ['ch00-why-ex', String.raw`$E[\cdot]$ 讀作「期望值」`], // E[·]
  ['ch00-noise', '變異數（variance）'], // Var
  ['ch00-noise', String.raw`記為 $\bar G_N$（$G$ 上面一橫表示平均）`], // Ḡ_N
  ['ch00-noise', String.raw`單獨一筆 $e\,x$ 的標準差記為 $s_1$`], // s_1
  ['ch00-noise', String.raw`累積分布函數（CDF）記為 $\Phi(z)=P(Z\le z)`], // Φ
  ['ch00-noise', '重複 $M$ 次獨立試驗'], // M
  ['ch00-why-matters', String.raw`比較器只留下正負號，記為 $q_n=\mathrm{sign}(e_n)$`], // q
  ['ch00-why-matters', '取平均，記為 $G_k$'], // G_k
  ['ch00-why-matters', '是每 $N$ 筆組成的一個 block'], // k
  ['ch00-why-matters', String.raw`它從一個固定的基準延遲 $T_0$ 往回扣`], // T_0
  ['ch00-why-matters', String.raw`$\tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]$`], // τ_DTC
  ['ch00-why-matters', String.raw`$e[n]=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]$`], // t_ref′、t_fb
  ['ch00-sign', String.raw`$q$ 的平均不是 0，而是一個很小的正數，記為 $m_q=E[q]$`], // m_q
  ['ch00-sign', '加起來的總和記為 $S_N$'], // S_N
  ['ch00-assumptions', String.raw`記為 $\varepsilon_{cc}=\kappa\,x$`], // κ、ε_cc
  ['ch00-assumptions', "其中 $v'$ 才是和 $x$ 無關的雜訊"], // v'
  ['ch00-assumptions', '記為 $w^*$'], // w*
  ['ch00-assumptions', String.raw`誤差降到 1% 所需的步數 $n_{1\%}$`], // n_{1%}
]

afterEach(() => {
  localStorage.clear()
  vi.mocked(conventionalStep).mockClear()
})

describe('Ch00 手算表（T01 render-level）', () => {
  it('T01: 表格的每一格都由 lms.ts 的 conventionalStep 算出，且與 golden T01 一致（w1 = 1.8、w2 = 2.28）', () => {
    const golden = JSON.parse(readFileSync(join(process.cwd(), 'golden/vectors/T01.json'), 'utf8')) as {
      expected: { w_trace: number[]; e_trace: number[] }
    }
    render(wrap(<HandCalcTable />))
    const spy = vi.mocked(conventionalStep)
    expect(spy).toHaveBeenCalledTimes(HAND_CALC_PARAMS.steps)
    expect(spy.mock.calls[0][0]).toMatchObject({ w: 1, x: 2, y: 6, mu: 0.1 })
    const table = screen.getByTestId('ch00-hand-calc')
    for (let n = 0; n < 5; n++) {
      const row = within(table).getByTestId(`ch00-hand-row-${n}`)
      const cell = (col: string) => row.querySelector(`[data-col="${col}"]`)?.textContent
      // 顯示值 = conventionalStep 的回傳值（格式化後），並等於 golden 軌跡
      expect(cell('w')).toBe(num(golden.expected.w_trace[n]))
      expect(cell('wNext')).toBe(num(golden.expected.w_trace[n + 1]))
      expect(cell('e')).toBe(num(golden.expected.e_trace[n]))
      expect(cell('wNext')).toBe(num((spy.mock.results[n].value as { w: number }).w))
    }
    expect(within(table).getByTestId('ch00-hand-row-0').querySelector('[data-col="wNext"]')?.textContent).toBe('1.8')
    expect(within(table).getByTestId('ch00-hand-row-1').querySelector('[data-col="wNext"]')?.textContent).toBe('2.28')
    // δ = a − w（勘誤 E39）：+2、+1.2、+0.72
    expect(within(table).getByTestId('ch00-hand-row-0').querySelector('[data-col="delta"]')?.textContent).toBe('+2')
    expect(within(table).getByTestId('ch00-hand-row-2').querySelector('[data-col="delta"]')?.textContent).toBe('+0.72')
  })
})

describe('Ch00 手算表的交叉比對（反面測試）', () => {
  it('T01: 反面測試——把 conventionalStep 的更新極性弄反時，「遞迴 vs 封閉解」必須顯示 ✗，不可顯示成功', () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    const spy = vi.mocked(conventionalStep)
    const original = spy.getMockImplementation()
    try {
      // 正確版本：三列（w1、w2、w5）都通過
      const good = render(wrap(<HandCalcSection />))
      expect(good.container.querySelectorAll('tr[data-pass="true"]')).toHaveLength(3)
      expect(good.container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
      good.unmount()
      // 錯誤版本：w ← w − μ·e·x（極性反了）
      spy.mockImplementation(({ w, x, y, mu }) => {
        const e = y - w * x
        const dw = -mu * e * x
        return { e, dw, w: w + dw }
      })
      const bad = render(wrap(<HandCalcSection />))
      expect(bad.container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(3)
      expect(bad.container.querySelectorAll('tr[data-pass="true"]')).toHaveLength(0)
      // 手算表也如實顯示錯的結果（w1 = 0.2 而不是 1.8），不會被「修飾」成正確答案
      expect(bad.container.querySelector('[data-testid="ch00-hand-row-0"] [data-col="wNext"]')?.textContent).toBe('0.2')
    } finally {
      if (original) spy.mockImplementation(original)
    }
  }, 60_000)
})

describe('Ch00 整頁 smoke test', () => {
  it.each(['beginner', 'engineer', 'research'])('%s 模式可完整渲染所有段落而不拋錯', async (mode) => {
    localStorage.setItem('lmspll.mode', mode)
    // 渲染過程不得有 console.error（React 的 key / hooks / DOM 巢狀警告都走 console.error）
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(wrap(<Chapter00 />))
    for (const t of [
      '§0.1 一個黑盒子問題',
      '§0.2 三個動作：預測 → 比較 → 修正',
      '§0.3 LMS 更新公式',
      '§0.4 先算一次：用數字手算兩步',
      '§0.5 動手玩：$\\mu$ 太小、剛好、太大',
      '§0.6 為什麼是 $e\\,x$？——只用微積分推導',
      '§0.7 有雜訊時為什麼還學得會？——雜訊會被平均掉',
      '§0.8 為什麼 LMS 這麼重要？',
      '§0.9 預告：只知道誤差的「正負號」也能學嗎？',
      '§0.10 注意假設：這一課的結論什麼時候成立？',
      '§0.11 思考題',
      '§0.12 本課必記',
      '§0.13 學習地圖：15 個問題在哪裡回答',
      '§0.14 本章符號表',
    ]) {
      // 標題內含 KaTeX（MathML）時，jsdom 的 accessible-name 計算會出錯，所以直接比對標題文字
      expect(headingTexts(container)).toContain(t)
    }
    // 符號表在章末（teaching-style §5）：#symbols 是整章最後一個區塊（排在本課必記、學習地圖之後），SymbolTable 是它裡面最後一個元素
    const following = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const root = container.querySelector('.ch00')!
    const symbols = container.querySelector('#symbols')!
    expect(root.lastElementChild).toBe(symbols)
    expect(symbols.previousElementSibling?.id).toBe('ch00-map')
    expect(following(container.querySelector('#ch00-recap')!, symbols)).toBe(true)
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    const table = symbols.querySelector('.c-symbols')!
    expect(screen.getByText('本章符號')).toBe(table.querySelector('.c-symbols-title'))
    expect(symbols.querySelector('.c-section-body')!.lastElementChild).toBe(table)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(SYMBOLS.length)
    // 章首只留一行「本章符號表在最後」：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），而且在 §0.1 之前
    const jump = screen.getByText('本章符號表在最後 ↓')
    expect(jump.tagName).toBe('BUTTON')
    expect(jump.parentElement?.textContent).toBe('本章符號表在最後 ↓')
    expect(following(jump, container.querySelector('#ch00-blackbox')!)).toBe(true)
    expect(following(container.querySelector('.ch00-question')!, jump)).toBe(true)
    expect(container.querySelector('a[href="#symbols"], a[href$="#symbols"]')).toBeNull()
    // 按下去會捲到章末的 #symbols；符號表旁的「回到章首」捲回章首（jsdom 沒有 scrollIntoView，這裡裝一個假的）
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      fireEvent.click(jump)
      expect(scroll.mock.contexts).toEqual([symbols])
      fireEvent.click(within(symbols as HTMLElement).getByText('↑ 回到章首'))
      expect(scroll.mock.contexts).toEqual([symbols, root])
      expect(root.id).toBe('ch00-top')
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
    // 符號表不在章首了：每個符號第一次出現的段落都有一句白話說明（三種模式都看得到），「首次出現」欄也不留白
    for (const [id, phrase] of EXPLAINED_AT_FIRST_USE)
      expect(texText(container.querySelector(`#${id}`)).replace(/\s+/g, ' '), `${id}：${phrase}`).toContain(phrase)
    for (const row of SYMBOLS) expect(row.firstSeen, row.symbol).toMatch(/^(§0\.\d+|章首圖例)$/)
    // 全站架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端、feedback edge 早到、DTC 只能從基準延遲往回扣（補償量）、
    // PD 量 reference edge 減 feedback edge、回授路徑只有 divider、LMS 校正迴路的輸入是 PD 的輸出
    const walk = (name: string) => texText(container.querySelector(`[data-diagram="${name}"] .ch00-diagram-walk`)).replace(/\s+/g, ' ')
    const physical = walk('CHART_BLACKBOX_TO_PLL')
    for (const phrase of [
      'feedback（divider）edge 會比理想時刻早到',
      '是 DTC 的補償量',
      'DTC 放在 reference 的輸入端，只能延遲、不能提前',
      '把 reference edge 提前（少延遲）',
      'PD 量的是（經過 DTC 的）reference edge 減 feedback edge',
      '補償不足（$w<a$）時，reference 還是太晚，誤差為正',
    ])
      expect(physical, phrase).toContain(phrase)
    expect(physical).not.toMatch(/插入|推回|回授路徑上的 DTC|DTC 在回授|divider 之後/)
    const pllWalk = walk('CHART_PLL_LOOP')
    for (const phrase of [
      '參考時脈先進 DTC',
      'DTC 不在回授路徑上，回授路徑上只有 divider',
      'DSM 的 carry 控制 divider',
      '比較器的輸入是 PD 的輸出 $e[n]$',
      '送進 loop filter 的同一個訊號',
    ])
      expect(pllWalk, phrase).toContain(phrase)
    expect(pllWalk).not.toMatch(/經過 DTC 再|DTC 之後|divider 的 edge/)
    // 圖上的兩個圓角標籤（carry、x[n]）是接線標籤，不是新的方塊：說明文字要講清楚它們接到哪裡
    expect(pllWalk).toContain('「carry（來自 DSM）」就是左下角 DSM 累加器的進位輸出，接到 divider')
    expect(pllWalk).toContain('同時接到 GMAC')
    // feedback edge 為什麼早到：divider 只能數整數個 VCO 週期（不是「因為 carry」就早到）
    expect(physical).toContain('divider 一次只能數整數個 VCO 週期（要不要多數一個，由 DSM 的 carry 決定），所以 feedback（divider）edge 會比理想時刻早到 $a\\,x[n]$')
    // 「預測」那一句：DTC 不能產生負的延遲，所以「提前」一定要連著基準延遲 T_0 一起講
    const threeActions = texText(container.querySelector('#ch00-pll-walk')).replace(/\s+/g, ' ')
    expect(threeActions).toContain('比較器取 PD 的輸出')
    expect(threeActions).toContain('少延遲 reference edge（補償量 $w\\,x$，相對於基準延遲 $T_0$ 等於把 edge 提前這麼多）')
    expect(threeActions).not.toMatch(/產生補償延遲|插入|推回/)
    // 每一句「提前」都在同一句話裡提到基準延遲 T_0 或「少延遲」（三段說明文字都檢查）
    for (const text of [physical, pllWalk, threeActions])
      for (const sentence of text.split(/[。；]/).filter((t) => t.includes('提前'))) expect(sentence, sentence).toMatch(/T_0|少延遲|不能提前/)
    // §0.10「path」那一列：比較器取的是 PD 的輸出，那裡的殘差正比於被迴路濾波過的 u = h*x（不是「殘差變成 u」）
    const assumptions = texText(container.querySelector('#ch00-assumptions')).replace(/\s+/g, ' ')
    expect(assumptions).toContain('PLL 裡比較器取的是 PD 的輸出，那裡的殘差不再正比於原始的 $x$，而是正比於被 PLL 迴路濾波過的版本 $u=h*x$')
    // 章首的說明：比較器的輸入是 PD 的輸出；gain correction 的輸出去控制 reference 端的 DTC
    const mapNote = texText(container.querySelector('.ch00-map-note'))
    expect(mapNote).toContain('輸入取自 PD 輸出 $e[n]$ 的 1-bit comparator')
    expect(mapNote).toContain('控制 reference 端的 DTC')
    // 符號表：新增的 PLL 符號（T_0、τ_DTC、t_ref′、t_fb）與 e 的 PLL 意義（PD 的輸出）
    const symbolRows = texText(container.querySelector('#symbols'))
    expect(symbolRows).toContain(String.raw`$T_0,\ \tau_{\mathrm{DTC}}[n]$`)
    expect(symbolRows).toContain(String.raw`$t_{\mathrm{ref}}',\ t_{\mathrm{fb}}$`)
    expect(symbolRows).toContain('PLL 中 $w\\,x$ 是 DTC 的補償量')
    expect(symbolRows).toContain('PLL 中是 PD 的輸出，也是 LMS 校正迴路（比較器）的輸入')
    // 勘誤標記（連到驗證頁）、程式碼區塊
    const errata = Array.from(container.querySelectorAll('.ch00-erratum-badge')).map((a) => a.textContent)
    expect(errata).toEqual(expect.arrayContaining(['勘誤 E39', '勘誤 E40', '勘誤 E41']))
    // 本章沿用全站更正後的符號：總和 S_N / m_q（E18）、code-correlated 干擾 κ（E12）
    expect(errata).toEqual(expect.arrayContaining(['勘誤 E18', '勘誤 E12']))
    const signSection = texText(container.querySelector('#ch00-sign'))
    expect(signSection).toContain('P(S_N>0)')
    expect(signSection).not.toContain('P(G_N>0)')
    expect(texText(container.querySelector('#ch00-assumptions'))).toContain(String.raw`w^*=a+\kappa`)
    container.querySelectorAll('.ch00-erratum-badge').forEach((a) => expect(a.getAttribute('href')).toBe('#/verification'))
    expect(container.querySelectorAll('.c-code').length).toBeGreaterThan(2)
    // CodeBlock / CodeCompare 的 region 名稱都必須存在（找不到時會渲染錯誤框）
    expect(container.textContent).not.toContain('找不到程式碼 region')
    expect(container.textContent).not.toContain('缺少 #endregion')
    // 勘誤 E40 的說明文字由模擬結果產生（不是手打）：μ = 0.125 的跳動值與 μ = 0.1 的浮點值
    const e40 = Array.from(container.querySelectorAll('.ch00-erratum')).find((el) => el.textContent?.includes('勘誤 E40'))
    expect(e40?.textContent).toContain('3.25')
    expect(e40?.textContent).toContain('2.75')
    expect(e40?.textContent).toContain('3.0000000000000004')
    // sign(0) 慣例表：每一格仍然是模擬算出來的四個數字（逗號隔開）；很長的那一欄（17 位數的 double）在桌面／平板可以在逗號後換行，
    // 才不必為了一長串數字橫向捲動（手機寬度維持不換行）。數字本身沒有空白，不會被拆開
    const tieTable = Array.from(container.querySelectorAll('#ch00-sign table.ch00-num-table')).find((t) => t.textContent?.includes('慣例')) as HTMLTableElement
    expect(tieTable.tBodies[0].rows).toHaveLength(3)
    for (const row of Array.from(tieTable.tBodies[0].rows)) {
      expect(row.cells[1].className).toBe('num')
      expect(row.cells[2].className).toBe('num ch00-num-list')
      for (const cell of [row.cells[1], row.cells[2]]) expect(cell.textContent, cell.textContent ?? '').toMatch(/^-?[\d.]+(, -?[\d.]+){3}$/)
    }
    expect(Array.from(tieTable.tBodies[0].rows).map((r) => r.cells[1].textContent)).toEqual(['3, 3, 3, 3', '3.25, 3, 3.25, 3', '2.75, 3, 2.75, 3'])
    expect(tieTable.tBodies[0].rows[0].cells[2].textContent).toBe('2.8000000000000003, 3.0000000000000004, 2.8000000000000003, 3.0000000000000004')
    const css = readFileSync(join(process.cwd(), 'src/chapters/ch00/chapter.css'), 'utf8')
    expect(css).toMatch(/@media \(min-width: 561px\) \{\s*\.ch00-num-table td\.num\.ch00-num-list \{\s*white-space: normal;/)
    // §0.4 的程式碼區塊（core:handCalc）：每一行都不超過 115 個字，桌面寬度不需要橫向捲軸
    const handCode = Array.from(container.querySelectorAll('#ch00-hand figure.c-code pre')).find((pre) => pre.textContent?.includes('handCalcRows'))
    const handLines = Array.from(handCode!.querySelectorAll('.c-code-line')).map((l) => l.textContent ?? '')
    expect(handLines.length).toBeGreaterThan(10)
    for (const line of handLines) expect(line.replace(/\n/g, '').length, line).toBeLessThanOrEqual(115)
    expect(container.querySelector('.c-tex-error')).toBeNull()
    // KaTeX throwOnError:false 時的語法錯誤會以 .katex-error 呈現：全章不得出現
    const texErrors = Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title') ?? e.textContent)
    expect(texErrors).toEqual([])
    // 字串屬性裡的 `$…$` 都必須被排版成 KaTeX：頁面文字（程式碼區塊除外）不得殘留字面的 `$`
    const prose = container.cloneNode(true) as HTMLElement
    prose.querySelectorAll('pre, .katex').forEach((e) => e.remove())
    expect(prose.textContent).not.toContain('$')
    // 學習地圖 15 列；問題中的數學（Q2 的 e·x）以 KaTeX 排版而不是純文字
    const map = container.querySelector('table.ch00-map') as HTMLTableElement
    expect(map.tBodies[0].rows).toHaveLength(15)
    expect(map.tBodies[0].rows[1].cells[1].querySelector('.katex')).not.toBeNull()
    expect(map.tBodies[0].rows[1].cells[1].textContent).not.toContain('$')
    // §0.10 注意假設：段落類型為「注意假設」，反例表四列都與理論 w* = a + c 一致（由模擬判定）
    expect(container.querySelector('#ch00-assumptions')?.getAttribute('data-kind')).toBe('assumptions')
    const biasRows = Array.from(container.querySelectorAll('[data-testid^="ch00-bias-row-"]'))
    expect(biasRows).toHaveLength(4)
    biasRows.forEach((r) => expect(r.getAttribute('data-ok')).toBe('true'))
    // 預設參數下，全章所有指標表都不應出現「超出容許誤差」
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
    // 八題「帶入手算」在三種模式都看得到（不被 ModeGate 藏起來），而且預設就顯示帶入過程
    const handcalcs = Array.from(container.querySelectorAll('.c-handcalc'))
    expect(handcalcs.map((h) => h.id).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((k) => `handcalc-HC-00.${k}`))
    handcalcs.forEach((h) => expect(h.querySelectorAll('.c-step').length, h.id).toBeGreaterThan(0))
    // 等效平均長度表只在 Engineer 以上顯示（μ = 0.01 ⇒ N_eq = 49；一步到位 ⇒ 1）
    const neq = container.querySelector('[data-testid="ch00-neq-table"]') as HTMLTableElement | null
    if (mode === 'beginner') expect(neq).toBeNull()
    else {
      expect(neq!.tBodies[0].rows[0].cells[2].textContent).toBe('49')
      expect(neq!.tBodies[0].rows[3].cells[2].textContent).toBe('1')
    }
    if (mode === 'research') {
      // 展開所有思考題解析，確認其中的 TeX 也都能正確排版
      screen.getAllByText('看答案與解析').forEach((b) => fireEvent.click(b))
      expect(screen.getAllByText('收起解析')).toHaveLength(4)
      expect(Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title'))).toEqual([])
      expect(headingTexts(container)).toContain('（Research）精確有理數驗算')
      expect(container.textContent).toContain('57/25')
      // 精確差距（BigInt 相減）與 1 ulp 的說明
      expect(container.textContent).toContain('距離則是 2.487×10')
    }
    await act(async () => {})
    const errors = errSpy.mock.calls.map((c) => String(c[0]))
    errSpy.mockRestore()
    expect(errors).toEqual([])
  }, 90_000) // 整章渲染（含 KaTeX、research 的數值積分）；多個 agent 同時跑測試時機器負載很高，逾時放寬

  it('思考題 1：選 2.9 判定正確，答案解析由 conventionalStep 算出', async () => {
    render(wrap(<Chapter00 />))
    const quiz = screen.getByText('思考題 1（必做）').closest('.c-quiz') as HTMLElement
    fireEvent.click(within(quiz).getByText(/^B\. 2\.9$/))
    expect(within(quiz).getByText('答對了！')).toBeTruthy()
    fireEvent.click(within(quiz).getByText('看答案與解析'))
    // 誘答選項的說明與檢查數字都由 conventionalStep 算出（x 以 KaTeX 排版，所以用 regex 比對）
    expect(quiz.textContent).toMatch(/1\.1 是忘了 x+ 的負號/)
    expect(quiz.textContent).toContain('−8.7')
    await act(async () => {})
  }, 90_000)
})

describe('Ch00 內文連結 → preset', () => {
  it('§0.7 的「載入這組參數」連結會把 intro-noisy 套用到 Playground；重設後再點同一個連結也會重新套用', async () => {
    const { container } = render(wrap(<Chapter00 />))
    const playground = container.querySelector('#exp-intro-playground') as HTMLElement
    expect(texText(playground)).toContain(String.raw`$\sigma_v=0$：沒有隨機性`)
    const link = screen.getByText('在 §0.5 的 Playground 載入這組參數')
    expect(link.getAttribute('href')).toBe('/ch/00?preset=intro-noisy')
    fireEvent.click(link)
    await waitFor(() => expect(texText(playground)).toContain('Case C: $z='))
    // 內文的三個數字（0.03571 / 0.08333 / 0.2041）與 Playground 指標表的理論穩態 std 是同一組
    const theory = Array.from(playground.querySelectorAll('tr'))
      .filter((r) => r.textContent?.includes('理論穩態'))
      .map((r) => r.cells[1].textContent)
    expect(theory).toEqual(['0.0357143', '0.0833333', '0.204124'])
    // 重設 → 回到無雜訊的預設；再點同一個連結（網址不變）仍要重新套用
    fireEvent.click(within(playground).getByText('重設 Reset'))
    await waitFor(() => expect(texText(playground)).toContain(String.raw`$\sigma_v=0$：沒有隨機性`))
    fireEvent.click(link)
    await waitFor(() => expect(texText(playground)).toContain('Case C: $z='))
    await act(async () => {})
  }, 90_000)
})

// 每個測試只渲染一個實驗（通常 < 1 s）；多個 agent 同時跑測試、機器負載高時放寬逾時
describe('Ch00 互動實驗', { timeout: 60_000 }, () => {
  it('預設三個 Case（0.02 / 0.10 / 0.65）：Case C 發散並解釋原因；e_n 圖與代入數字的更新公式都在', async () => {
    const { container } = render(wrap(<IntroPlayground />))
    expect(texText(container)).toContain('$e_n$：每一步的預測誤差')
    // Case A（μ = 0.02）第 0 步：e0 = 6 − 1×2 = 4，w1 = 1 + 0.02×4×2 = 1.16
    const live = container.querySelector('.ch00-live')?.textContent ?? ''
    expect(live).toContain('=4')
    expect(live).toContain('=1.16')
    await waitFor(() => expect(screen.getAllByText(/Case C/).length).toBeGreaterThan(0))
    const alerts = await screen.findAllByRole('alert')
    // 警告裡的數學以 KaTeX 排版（字串中的 $…$），不是 Unicode 拼湊
    const text = alerts.map((a) => texText(a)).join('\n')
    expect(text).toContain(String.raw`Case C：$\mu=0.65$ 超過穩定上限 $2/x^2=0.5$`)
    expect(text).toContain('修正過頭')
    expect(alerts.some((a) => a.querySelector('.katex'))).toBe(true)
    expect(alerts.map((a) => a.textContent).join('')).not.toContain('$')
  })

  it('x = 0：指標表顯示「不可辨識」，原因以 KaTeX 排版在說明裡（不是 Unicode 拼的 x = 0）', async () => {
    const { container } = render(wrap(<IntroPlayground />))
    fireEvent.change(screen.getByLabelText('x（固定輸入）'), { target: { value: '0' } })
    await waitFor(() => expect(container.textContent).toContain('不可辨識'))
    const row = Array.from(container.querySelectorAll('tr')).find((r) => texText(r).includes(String.raw`穩定上限 $\mu_{\max}=2/x^2$`))!
    expect(row.cells[1].textContent).toBe('不可辨識')
    expect(texText(row)).toContain(String.raw`$x=0$：更新量永遠是 0，任何 $\mu$ 都學不到 $a$`)
    expect(row.textContent).not.toContain('$')
    expect(container.querySelector('.katex-error')).toBeNull()
    await act(async () => {})
  })

  it('?preset=intro-pole-regions 會套用 μ = 0.25 / 0.4 / 0.5，並警告邊界', async () => {
    render(wrap(<IntroPlayground />, '/ch/00?preset=intro-pole-regions'))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join('\n')).toContain('剛好在邊界')
  })

  it('單步 Step 進入單步模式；Freeze 後顯示凍結說明', async () => {
    render(wrap(<IntroPlayground />))
    fireEvent.click(screen.getByText('單步 Step'))
    expect(await screen.findByText(/單步模式：目前顯示到第 1 步/)).toBeTruthy()
    fireEvent.click(screen.getByText('凍結 Freeze'))
    expect(await screen.findByText(/已在第 1 步 Freeze/)).toBeTruthy()
  })

  it('反面測試：雜訊平均實驗在 s₁ = 0 的退化情況（±1 碼、σ_v = 0）不可把「0 對 0」顯示成不通過', async () => {
    const { container } = render(wrap(<NoiseAverageLab />))
    fireEvent.change(screen.getByLabelText('sigma_v（量測雜訊 RMS）'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('x 的分布'), { target: { value: '1' } }) // 第 2 個選項：±1 碼
    await waitFor(() => expect(container.textContent).toContain('每一筆都一樣'))
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
    expect(container.querySelectorAll('tr[data-pass="true"]').length).toBeGreaterThanOrEqual(3)
    // Monte Carlo 欄誠實標示 n/a 並說明原因，而不是 ok / mismatch
    expect(texText(container)).toContain(String.raw`$s_1=0$：每一筆 $e\,x$ 都相同，沒有隨機性`)
    expect(texText(container)).toContain('$0/0$ 無定義')
    // 再把 w 改成非整數差（a − w = 0.7）：累加的浮點捨入也不可造成不通過
    fireEvent.change(screen.getByLabelText('w（目前的猜測，固定）'), { target: { value: '2.3' } })
    await waitFor(() => expect(container.textContent).toContain('=0.7'))
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
  })

  it('?preset=intro-noise-pm-one 會把 x 的分布切成 ±1 碼', async () => {
    render(wrap(<NoiseAverageLab />, '/ch/00?preset=intro-noise-pm-one'))
    expect((screen.getByLabelText('x 的分布') as HTMLSelectElement).value).toBe('1')
    await act(async () => {})
  })

  it('有雜訊的 preset（intro-noisy）：三個 Case 的 Monte Carlo 穩態比對都通過，來源標示為 simulation', async () => {
    const { container } = render(wrap(<IntroPlayground />, '/ch/00?preset=intro-noisy'))
    await waitFor(() => expect(texText(container)).toContain('Case C: $z='))
    expect(container.querySelectorAll('tr[data-pass="false"]')).toHaveLength(0)
    // 每個 Case 一列「模擬的穩態 std(w)」都有 ✓
    expect(container.querySelectorAll('tr[data-pass="true"]').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelector('#exp-intro-playground')?.textContent).toContain('simulation')
  })

  it('雜訊平均實驗可渲染，Monte Carlo 交叉比對為 ok', async () => {
    render(wrap(<NoiseAverageLab />))
    // 標題含 KaTeX（jsdom 對含 MathML 的標題計算 accessible name 會出錯），所以直接取標題元素比對
    expect(texText(document.getElementById('exp-intro-noise-average-title'))).toBe(String.raw`雜訊為什麼會被平均掉？（$1/\sqrt N$ 小型 Monte Carlo）`)
    await act(async () => {})
    expect(texText(document.body)).toContain('最大 $|z|=')
    expect(texText(document.body)).toContain('$|z|<4$ 視為一致')
  })
})
