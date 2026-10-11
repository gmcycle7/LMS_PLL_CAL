import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import Chapter11 from './index'
import { CH11_DIAGRAMS } from './diagrams'
import { BiasInlLab } from './experiments/BiasInlLab'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  },
}))

function wrap(node: React.ReactNode, url = '/ch/11') {
  return (
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
    </SettingsProvider>
  )
}

afterEach(() => {
  localStorage.clear()
})

/**
 * 整章 render（8 題手算、3 個實驗、十幾段程式碼）在多個測試行程同時執行的機器上可能超過一分鐘：
 * 時間上限只防止卡死，不是效能規格。
 */
const SMOKE_TIMEOUT = 600000
const LAB_TIMEOUT = 300000
const WAIT = 120000

describe('Ch11 smoke tests（jsdom）', () => {
  it('整章可以 render，不會丟出錯誤，且包含主要段落與實驗', async () => {
    const errSpy = vi.spyOn(console, 'error')
    const { container } = render(wrap(<Chapter11 />))
    expect(screen.getByText('這一課要回答的問題')).toBeTruthy()
    expect(container.querySelector('#ch11-inl')).toBeTruthy()
    expect(container.querySelector('#ch11-lab')).toBeTruthy()
    expect(document.getElementById('formula-F-11.4')).toBeTruthy()
    expect(document.getElementById('formula-F-11.8')).toBeTruthy()
    // 公式登錄的每個 ID 在頁面上都有唯一錨點（MetricTable 的 formulaId 會連過去）
    for (const f of FORMULAS) expect(document.querySelectorAll(`[id="formula-${f.id}"]`).length, f.id).toBe(1)
    // 三個 ExperimentShell
    expect(screen.getAllByText(/Bias & INL Lab/).length).toBeGreaterThan(0)
    expect(screen.getByText(/主迴路 DC null 對 offset bias 的影響/)).toBeTruthy()
    // 標題裡的 C(FCW) → 0 以 KaTeX 顯示（字串屬性的 $…$），所以只比對前後的文字
    expect(screen.getByText(/Near-integer：\s*時 bias 被放大/)).toBeTruthy()
    // 程式碼區塊由真實原始碼擷取（region 存在才不會顯示錯誤）
    expect(container.querySelectorAll('.c-code').length).toBeGreaterThan(12)
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    expect(screen.queryByText(/程式碼載入錯誤/)).toBeNull()
    // 三種 DC null 架構的程式碼對照（dcOffset / linearizedFixedPoint）與差異行標示
    expect(container.textContent).toContain('(B) 共用 BBPD')
    expect(container.textContent).toContain('← 差異：(C) 分母 Var(x)')
    // 先備知識框：期望值、Var/Cov、Gaussian/erf、條件期望、加權中位數、特徵值、Ch06 頻率響應
    const pageText = container.textContent ?? ''
    for (const t of ['「很多次的平均」', '變異數、共變異數', 'comparator 的機率', '條件期望', '加權平均與加權中位數', '特徵值（eigenvalue）', '回顧 Ch06']) expect(pageText, t).toContain(t)
    // behavioral 測試清單的預期值由模型即時計算（T12b 的 1.3403458、dead zone 區間、E03 三種模式）
    expect(pageText).toContain('本章的 behavioral 測試清單')
    for (const t of ['1.340346', '(1.3333, 1.5)', '1.2141 ／ 1 ／ 1.5897']) expect(pageText, t).toContain(t)
    // 帶入手算：8 題依序出現在頁面上（各自放在對應的推導後面），綜合題在思考題之前
    expect(Array.from(container.querySelectorAll('.c-handcalc')).map((el) => el.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    const sectionOf = (id: string) => document.getElementById(`handcalc-${id}`)?.closest('section.c-section')?.id
    expect(['HC-11.1', 'HC-11.2', 'HC-11.3', 'HC-11.4', 'HC-11.5', 'HC-11.6', 'HC-11.7', 'HC-11.8'].map(sectionOf)).toEqual([
      'ch11-hand',
      'ch11-fixed-point',
      'ch11-offset',
      'ch11-inl',
      'ch11-inl',
      'ch11-inl',
      'ch11-near-integer',
      'ch11-synthesis',
    ])
    const synthesis = container.querySelector('#ch11-synthesis') as HTMLElement
    const quiz = container.querySelector('#ch11-quiz') as HTMLElement
    expect(synthesis.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(synthesis.nextElementSibling).toBe(quiz)
    expect(container.querySelectorAll('.ch11-hand-lead').length).toBe(HANDCALCS.length)
    // 思考題 3 題、本課必記
    expect(container.querySelectorAll('.c-quiz').length).toBe(3)
    expect(container.querySelectorAll('.c-recap').length).toBe(1)
    // ── 方塊圖（teaching-style §8）：章首系統地圖 + 25 張圖，依登錄表的順序出現在各自的段落裡 ──
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures).toHaveLength(CH11_DIAGRAMS.length + 1)
    expect(CH11_DIAGRAMS).toHaveLength(25)
    const systemMap = figures[0]
    expect(systemMap.getAttribute('aria-label')).toContain('系統方塊圖')
    expect(systemMap.closest('.ch11-fig')).toBeNull()
    const question = screen.getByText('這一課要回答的問題').closest('.c-callout') as HTMLElement
    expect(question.nextElementSibling).toBe(systemMap) // 開場問題之後緊接系統地圖
    expect(question.textContent).toContain('完整的符號表在本章最後') // 開場就先用一句話說明 x、e、q、w
    const figs = Array.from(container.querySelectorAll('.ch11-fig'))
    expect(figs.map((el) => el.id)).toEqual(CH11_DIAGRAMS.map((d) => `ch11-fig-${d.id}`))
    expect(figs.map((el) => el.closest('section.c-section')?.id)).toEqual(CH11_DIAGRAMS.map((d) => d.section))
    figs.forEach((el, i) => {
      expect(el.querySelector('.ch11-figcap')?.textContent, el.id).toContain(`圖 11-${i + 1}：`)
      expect(el.querySelector('figure.c-mermaid')?.getAttribute('aria-label'), el.id).toMatch(new RegExp(`^圖 11-${i + 1}：`))
    })
    // 正文引用的圖號（FigRef）都在圖的前面：先讀導讀再看圖
    for (const el of figs) {
      const label = el.querySelector('.ch11-figcap strong')?.textContent?.split('：')[0] ?? ''
      const refs = Array.from(container.querySelectorAll('.ch11-figref')).filter((r) => r.textContent === label)
      expect(refs.length, label).toBeGreaterThanOrEqual(1)
      expect(refs[0].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy()
    }
    // 每個主要段落至少一張圖
    for (const id of ['ch11-hand', 'ch11-diagram', 'ch11-model', 'ch11-fixed-point', 'ch11-offset', 'ch11-inl', 'ch11-correlated', 'ch11-near-integer', 'ch11-lab', 'ch11-levels', 'ch11-synthesis'])
      expect(container.querySelectorAll(`#${id} .ch11-fig`).length, id).toBeGreaterThanOrEqual(1)
    // 圖放在推導之前：誤差模型的圖在 F-11.1 之前、三種架構的圖在 F-11.6 之前、near-integer 的路徑圖在 F-11.14 之前
    const before = (a: Element | null, b: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(document.getElementById('ch11-fig-error-budget'), document.getElementById('formula-F-11.1'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-bias-correlators'), document.getElementById('formula-F-11.4'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-offset-path'), document.getElementById('formula-F-11.5'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-dc-null'), document.getElementById('formula-F-11.6'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-servo-dither'), document.getElementById('formula-F-11.17'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-best-fit'), document.getElementById('formula-F-11.8'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-mean-vs-median'), document.getElementById('formula-F-11.10'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-identifiability'), document.getElementById('formula-F-11.13'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-near-integer-path'), document.getElementById('formula-F-11.14'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-mc-gaps'), document.getElementById('formula-F-11.16'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-comparator-model'), document.getElementById('formula-F-11.2'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-jitter-weight'), document.getElementById('formula-F-11.12'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-near-integer-why'), document.getElementById('ch11-fig-near-integer-check'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-slope-measure'), document.getElementById('ch11-fig-mc-gaps'))).toBe(true)
    expect(before(document.getElementById('ch11-fig-finite-step-loop'), document.getElementById('formula-F-11.16'))).toBe(true)
    // ── 符號表（teaching-style §5）：只有一份，在頁面最後（#symbols，本課必記之後）；章首只留一行跳轉 ──
    const root = container.querySelector('.ch11') as HTMLElement
    const symbols = document.getElementById('symbols') as HTMLElement
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    expect(root.lastElementChild).toBe(symbols)
    expect(before(container.querySelector('.c-recap'), symbols)).toBe(true)
    expect(before(quiz, symbols)).toBe(true)
    expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBeGreaterThanOrEqual(25)
    expect(symbols.textContent).toContain('本章符號表')
    const jump = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('本章符號表在最後')) as HTMLButtonElement
    expect(jump).toBeTruthy()
    expect(jump.closest('.ch11-symbols-link')?.textContent?.trim()).toBe('本章符號表在最後 ↓') // 章首只有這一行
    expect(before(jump, question)).toBe(true)
    expect(container.querySelector('a[href="#symbols"]')).toBeNull() // HashRouter：不能用會改變路由的 href
    // 按下去會捲到章末的符號表（jsdom 沒有 scrollIntoView：先確認沒有也不會丟錯，再補上替身確認目標）
    expect(() => fireEvent.click(jump)).not.toThrow()
    const proto = Element.prototype as unknown as { scrollIntoView?: (arg?: unknown) => void }
    const original = proto.scrollIntoView
    const scrolled: Element[] = []
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      fireEvent.click(jump)
      expect(scrolled).toEqual([symbols])
      expect(document.activeElement).toBe(symbols)
      const back = Array.from(symbols.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('回到章首')) as HTMLButtonElement
      fireEvent.click(back)
      expect(scrolled).toEqual([symbols, root])
      expect(document.activeElement).toBe(jump) // 回到章首後，焦點回到章首的那一行
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
    // Lab：Case 並列比較表與 Run to Convergence
    expect(screen.getByText(/Case 並列比較（共用誤差模型、code 與 seed）/)).toBeTruthy()
    // （getAllByRole 在整章的大 DOM 上很慢，直接比對按鈕文字）
    expect(Array.from(container.querySelectorAll('button')).some((b) => /Run-to-Convergence/.test(b.textContent ?? ''))).toBe(true)
    // 勘誤小標連到驗證頁
    const errata = container.querySelectorAll('a.ch11-erratum')
    expect(errata.length).toBeGreaterThan(5)
    // 必須套用的勘誤都有小標（E13：本章 S 與規格 §11.4 的 S_GMAC 正負號相反）
    const eids = new Set(Array.from(errata).map((e) => (e.textContent ?? '').replace('勘誤 ', '').trim()))
    for (const id of ['E01', 'E03', 'E11', 'E12', 'E13', 'E17']) expect(eids.has(id), id).toBe(true)
    expect((errata[0] as HTMLAnchorElement).getAttribute('href')).toBe('#/verification')
    await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: WAIT })
    // σ_v = 0.05 的說明由模型計算：x = ±2 停在 E[q|x] ≈ ±0.5（不是全部飽和）
    expect(container.querySelector('#ch11-fixed-point')?.textContent ?? '').toContain('0.5')
    // near-integer sweep（inline 模式在主執行緒跑）完成後，時域／頻域交叉比對與「你會發現」段落出現
    await waitFor(() => expect(screen.getAllByText(/時域 vs 頻域最大相對差/).length).toBeGreaterThan(0), { timeout: WAIT })
    await waitFor(() => expect(screen.getByText(/頻寬內諧波貢獻/)).toBeTruthy(), { timeout: WAIT })
    // 全章所有 TeX 都能被 KaTeX 解析（含 m() 的 $…$ 行內數學與非同步出現的段落）
    const bad = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)
    expect(bad).toEqual([])
    // 行內數學分隔符成對：渲染後的文字不應殘留 '$'
    expect(container.textContent ?? '').not.toMatch(/\$/)
    // 不可把 NaN / undefined 印到頁面上（程式碼區塊本身含 Number.NaN，先移除再檢查）
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.c-code, pre, code').forEach((el) => el.remove())
    expect(clone.textContent ?? '').not.toMatch(/NaN|undefined/)
    // smoke render 期間沒有 console.error（React key 警告、act 警告、render 例外…）
    expect(errSpy.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([])
    errSpy.mockRestore()
  }, SMOKE_TIMEOUT)

  it.each(['beginner', 'research'])('%s 模式也能完整 render（ModeGate 內容）且沒有 TeX 錯誤', async (mode) => {
    localStorage.setItem('lmspll.mode', mode)
    const { container } = render(wrap(<Chapter11 />))
    expect(container.querySelector('#ch11-offset')).toBeTruthy()
    if (mode === 'research') {
      expect(screen.getByText('Research：mean-field 的嚴格意義')).toBeTruthy()
      expect(screen.getByText(/ρ_j（σ_v\(x\) 斜率）/)).toBeTruthy()
    } else {
      expect(screen.queryByText('Research：mean-field 的嚴格意義')).toBeNull()
    }
    const bad = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)
    expect(bad).toEqual([])
    await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: WAIT })
  }, SMOKE_TIMEOUT)

  it('Lab：預設（Gallery #7）顯示 Sign mean-field 1.34035；?preset= 載入 shared BBPD ⇒ w* = 1', async () => {
    const { container, unmount } = render(wrap(<BiasInlLab />))
    await waitFor(() => expect(container.textContent).toContain('1.34035'), { timeout: WAIT })
    unmount()
    const r2 = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-offset-shared-bbpd'))
    await waitFor(() => {
      const kpi = r2.container.querySelector('.ch11-kpi-value')
      expect(kpi?.textContent).toBe('1')
    }, { timeout: WAIT })
  }, LAB_TIMEOUT)

  it('Lab：inline 模式按 Run 會跑 Monte Carlo 並更新 KPI、交叉比對與 Case 比較表', async () => {
    const { container } = render(wrap(<BiasInlLab />))
    const run = screen.getAllByRole('button', { name: /執行 Run/ })[0]
    fireEvent.click(run)
    await waitFor(
      () => {
        const kpis = container.querySelectorAll('.ch11-kpi')
        const mc = within(kpis[2] as HTMLElement).getByText(/^1\.3/)
        expect(mc).toBeTruthy()
        // KPI 註記：與解析值一致（4·SE + 有限步長）
        expect((kpis[2] as HTMLElement).textContent).toContain('✓ 與解析值一致')
      },
      { timeout: WAIT },
    )
    // 比較表的 Case A 列有 MC 結果與 ✓
    const row = Array.from(container.querySelectorAll('tr.ch11-hl')).find((tr) => tr.textContent?.startsWith('A'))
    expect(row?.textContent).toMatch(/1\.3\d+ ± /)
    expect(row?.textContent).toContain('✓')
    expect(container.textContent).toContain('有限步長偏移估計')
  }, LAB_TIMEOUT)

  it('Lab：dead zone preset 的 w* 顯示區間（不是任意一點），Run 後 MC 落在區間內', async () => {
    const { container } = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-deadzone-noisefree'))
    await waitFor(() => expect(container.querySelector('.ch11-kpi-value')?.textContent).toBe('(1.3333, 1.5)'), { timeout: WAIT })
    expect(screen.getAllByText(/dead zone/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: /執行 Run/ })[0])
    await waitFor(() => expect(container.textContent).toContain('落在 dead zone 內'), { timeout: WAIT })
    expect((container.querySelectorAll('.ch11-kpi')[2] as HTMLElement).textContent).toContain('✓')
    // 模型（bias.ts）的警告以 $…$ 表示數學：σ_v = 0 與 dead zone 區間都經 KaTeX 渲染，沒有殘留的 $ 或 KaTeX 錯誤
    const warns = Array.from(container.querySelectorAll('.c-exp-warnings p'))
    const dz = warns.find((w) => (w.textContent ?? '').includes('一整段區間')) as HTMLElement
    expect(dz).toBeTruthy()
    expect(dz.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5)
    expect(dz.textContent).toContain('1.33333')
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
    expect(container.textContent ?? '').not.toMatch(/\$/)
    // Case 比較表的「設定」欄：σ_v 以 KaTeX 顯示
    const caseRow = Array.from(container.querySelectorAll('tr.ch11-hl')).find((tr) => /^[A-C]Sign/.test(tr.textContent ?? ''))
    expect(caseRow?.querySelector('td:nth-child(2) .katex')).toBeTruthy()
  }, LAB_TIMEOUT)

  it('Lab：σ_v = 0.1 時出現「線性化失效」警告（解釋原因而非只顯示錯誤）', async () => {
    const { container } = render(wrap(<BiasInlLab />, '/ch/11?preset=bias-inl-cubic-sigma01'))
    await waitFor(() => expect(screen.getAllByText(/線性化失效風險/).length).toBeGreaterThan(0), { timeout: WAIT })
    // 警告裡的指標 max|e_det|/σ_v = 2.66577 > 0.3 以 KaTeX 顯示（字串屬性的 $…$），不是 Unicode 拼的公式
    const warn = Array.from(container.querySelectorAll('.c-exp-warnings p')).find((w) => (w.textContent ?? '').includes('線性化失效風險')) as HTMLElement
    expect(warn.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
    expect(warn.textContent).toContain('2.66577')
    expect(warn.textContent).not.toMatch(/σ_v|\$/)
    expect(container.querySelector('.katex-error, .c-tex-error')).toBeNull()
  }, LAB_TIMEOUT)
})
