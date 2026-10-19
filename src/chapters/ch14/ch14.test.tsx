import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import Chapter14 from './index'
import { LrOptimizerExperiment } from './experiments/LrOptimizer'
import { CornerIntervalExperiment } from './experiments/CornerInterval'
import { CalStateMachineExperiment, stateSegments, trackRmsPrediction } from './experiments/CalStateMachine'
import { DEFAULT_CAL_SM } from '@/simulation/models/optimizer'
import { SYMBOLS } from './sections/S10Symbols'
import { wrapPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())
function wrap(node: ReactNode, url = '/ch/14') {
  return wrapPage(node, { url })
}

afterEach(() => {
  localStorage.clear()
})

describe('Ch14 頁面（jsdom smoke）', () => {
  it('完整章節可以渲染：各節標題、勘誤 E16／E48 連到驗證頁、三個實驗、章末符號表', async () => {
    const { container } = render(wrap(<Chapter14 />))
    expect(screen.getByText('本章符號')).toBeTruthy()
    // 標題內含 KaTeX（MathML）時 jsdom 計算 accessible name 會碰到 CSSOM 限制，改用 h2 的 textContent 比對
    const h2 = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent ?? '')
    for (const t of ['14.0 一個問題', '14.1 一步一步推導', '14.2 優化目標不同', '14.3 固定總預算', '14.4 重現第 10 課的設計計算器', '14.5 Corner-based 可行區間', '14.6 步長排程', '14.7 Calibration State Machine：把步長排程做成硬體', '14.8 策略比較']) {
      expect(h2.some((x) => x.includes(t))).toBe(true)
    }
    // 標題裡的數學是 KaTeX，不是 Unicode 拼湊（docs/teaching-style.md §3）
    expect(Array.from(container.querySelectorAll('h2')).filter((h) => h.querySelector('.katex')).length).toBeGreaterThanOrEqual(5)
    const errata = Array.from(container.querySelectorAll('a.ch14-erratum-tag'))
    expect(errata.map((a) => a.textContent)).toEqual(expect.arrayContaining(['勘誤 E16', '勘誤 E48']))
    for (const a of errata) expect(a.getAttribute('href')).toBe('/verification')
    for (const id of ['lr-optimizer', 'corner-interval', 'cal-state-machine']) expect(container.querySelector(`[data-experiment="${id}"]`)).toBeTruthy()
    // 公式錨點（與 formulas.ts 同 ID）
    for (const id of ['F-14.3', 'F-14.15', 'F-14.16', 'F-14.18']) expect(container.querySelector(`[id="formula-${id}"]`)).toBeTruthy()
    // E48 驗證表（worker 在 jsdom 為 inline）
    await waitFor(() => expect(screen.getAllByText(/^-?\d+\.\d%$/).length).toBeGreaterThan(3), { timeout: 60000 })
  }, 150000)

  it('第 10 課計算器表格：精確最佳 μ* = 10.66 fs、α = 11.20 時 RMS 0.4488 fs', () => {
    render(wrap(<Chapter14 />))
    const table = screen.getByText('第 10 課宣稱').closest('table') as HTMLElement
    expect(within(table).getByText('10.664')).toBeTruthy()
    expect(within(table).getByText('0.4488')).toBeTruthy()
    expect(within(table).getByText('0.4474')).toBeTruthy()
  }, 150000)
})

describe('Ch14 符號表放在章末（docs/teaching-style.md §5）', () => {
  it('符號表只有一份、在 id="symbols" 內、是頁面最後一個區塊（Recap 與「連結到 PLL 硬體」之後）；章首只留一行', () => {
    const { container } = render(wrap(<Chapter14 />))
    const root = container.querySelector('.ch14') as HTMLElement
    const sym = container.querySelector('[id="symbols"]') as HTMLElement
    expect(sym).toBeTruthy()
    expect(container.querySelectorAll('[id="symbols"]').length).toBe(1)
    expect(container.querySelectorAll('.c-symbols').length).toBe(1)
    expect(sym.querySelector('.c-symbols')).toBeTruthy()
    expect(within(sym).getByText('本章符號')).toBeTruthy()
    expect(sym.querySelectorAll('.c-symbols tbody tr').length).toBe(SYMBOLS.length)
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(30)
    // 最後一個區塊
    expect(root.lastElementChild).toBe(sym)
    // 架構約定（docs/assumptions.md §2a）：符號表說明 T_0、e[n]（PD 的輸出）與 w_k 的「補償量」
    const symRows = (sym: HTMLElement, name: string) => Array.from(sym.querySelectorAll('.c-symbols tbody tr')).find((tr) => tr.querySelector('annotation')?.textContent === name)
    expect(symRows(sym, 'T_0')?.textContent).toContain('reference 端 DTC 的固定基準延遲')
    expect(symRows(sym, 'e[n]')?.textContent).toContain('PD 的輸出')
    expect(symRows(sym, 'e[n]')?.textContent).toContain('送進 loop filter 的同一個節點')
    expect(symRows(sym, 'w_k')?.textContent).toContain('補償量')
    expect(symRows(sym, 'a')?.textContent).toContain('feedback edge 早到')
    const follows = (a: Element | null, b: Element) => {
      expect(a).toBeTruthy()
      expect(a!.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    follows(container.querySelector('.c-recap'), sym)
    follows(container.querySelector('[id="ch14-pll"]'), sym)
    follows(container.querySelector('[id="ch14-quiz"]'), sym)
    // 章首骨架（teaching-style §9）：導言 → 系統地圖 → 「你在這裡」（.c-map-note）→ 標籤列與本章目錄 → 先備知識框 → 14.0；
    // 不再有「本章符號表在最後」那一行（連結在 PageFrame 的 strip 裡），也沒有會改到 HashRouter 路由的 href
    // （不用 getByRole：整章有上千個 KaTeX 節點，jsdom 計算 accessible name 要數分鐘）
    expect(container.querySelectorAll('.ch14-symbols-jump').length).toBe(0)
    const lead = container.querySelector('.ch14-lead') as Element
    expect(container.querySelector('.ch14')!.firstElementChild).toBe(lead)
    expect(lead.nextElementSibling).toBe(container.querySelector('figure.c-mermaid.c-sysmap'))
    expect(lead.nextElementSibling!.nextElementSibling).toBe(container.querySelector('.c-map-note'))
    const toc = container.querySelector('nav[aria-label="本章目錄"]') as Element
    follows(container.querySelector('.c-map-note'), toc)
    follows(toc, container.querySelector('.c-prereq') as Element)
    follows(container.querySelector('.c-prereq'), container.querySelector('[id="ch14-question"]') as Element)
    expect(container.querySelector('a[href="#symbols"]')).toBeNull()
    // 第一節之前不再有符號表
    const firstSection = container.querySelector('[id="ch14-question"]') as Element
    expect(container.querySelector('.c-symbols')!.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  }, 150000)

  it('目錄的「符號表（章末）」是真的連結（?a=symbols），按下去捲到 #symbols；章末可以回到章首', () => {
    const scrolled: string[] = []
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const saved = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    try {
      const { container } = render(wrap(<Chapter14 />))
      const toc = container.querySelector('nav[aria-label="本章目錄"]') as HTMLElement
      const tocSym = within(toc).getByText('符號表（章末）') as HTMLAnchorElement
      expect(tocSym.tagName).toBe('A')
      expect(tocSym.getAttribute('href')).toMatch(/\?a=symbols$/)
      expect(fireEvent.click(tocSym)).toBe(false)
      expect(scrolled).toEqual(['symbols'])
      const back = within(container.querySelector('[id="symbols"]') as HTMLElement).getByText(/回到章首/)
      expect(back.tagName).toBe('BUTTON')
      fireEvent.click(back)
      expect(scrolled).toEqual(['symbols', 'ch14-top'])
      expect(container.querySelector('[id="ch14-top"]')).toBe(container.querySelector('.ch14'))
      // 目錄的小節連結是真的連結（href = 目前路由 + ?a=id，中鍵／複製連結都能用），不是會被 HashRouter 當成路由的 #ch14-…
      const tocLink = within(toc).getByText('14.8 策略比較') as HTMLAnchorElement
      expect(tocLink.getAttribute('href')).toMatch(/\?a=ch14-compare$/)
      expect(fireEvent.click(tocLink)).toBe(false)
      expect(scrolled.at(-1)).toBe('ch14-compare')
      expect(container.querySelector('nav[aria-label="本章目錄"] a[href^="#ch14-"]')).toBeNull()
    } finally {
      proto.scrollIntoView = saved
    }
  }, 150000)

  it('符號表每一列都有「首次出現」；表中沒有重複的符號', () => {
    expect(new Set(SYMBOLS.map((r) => r.symbol)).size).toBe(SYMBOLS.length)
    for (const r of SYMBOLS) expect(r.firstSeen, r.symbol).toMatch(/^(章首|先備知識|§14\.\d)/)
  })
})

describe('Ch14 Research 模式：所有內容（含 Research-only 推導與程式碼）', () => {
  it('KaTeX 全部可解析（沒有 .katex-error）、所有 CodeBlock region 都找得到、沒有 console.error', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(wrap(<Chapter14 />))
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(300)
    expectNoTexErrors(container)
    expect(container.textContent).not.toContain('程式碼載入錯誤')
    // Research 模式才出現的內容
    expect(container.textContent).toContain('core:calStep（完整的一個 block）')
    expect(container.textContent).toContain('stochastic approximation 的經典結果')
    // 散文裡不可出現 TeX 原始碼（例如把 'p^{2B}' 寫在一般字串裡）：檢查 KaTeX 與程式碼區塊以外的文字節點
    // （.c-tip：TestBadge 的 tooltip 逐字列出 src/data/verification-status.json 裡各頁測試的名稱，例如「δ_{k+1} = δ_k − gδ_{k−d}」；
    //   那是共用資料，不是本章的散文，所以和下面的 unicodeMathLeaks 一樣略過。）
    const leaks: string[] = []
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest('.katex, pre, code, script, style, .c-tip')) continue
      const t = n.textContent ?? ''
      if (/\^\{|_\{|\\[a-zA-Z]+/.test(t)) leaks.push(t.trim().slice(0, 80))
    }
    expect(leaks).toEqual([])
    // 全站架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端；w·x 叫「補償量」，不再說 DTC 插入延遲、把 feedback edge 推回去，也沒有回授側注入的說法
    const pageText = container.textContent ?? ''
    // （DTC 不能產生負的延遲：不說它把 reference edge「多提前／少提前」，一律寫成延遲 T_0 − w·x[n] 少扣或多扣）
    for (const old of ['插入延遲', '推回', 'DTC 在回授', 'DTC 延遲 feedback', '回授側注入', 'feedback 側', 'divider 之後', 'divider 的 edge 經過 DTC', '多提前', '少提前']) expect(pageText, old).not.toContain(old)
    expect(pageText).toContain('補償量')
    expect(pageText).toContain('comparator 取的是 PD 的輸出')
    // 硬體對照表：e[n] 取自 PD 輸出；數位端送進 DTC 的 code 是 C_0 − w_k·x[n]（從固定中心值往回扣），對應的延遲是 T_0 − w_k·x[n]
    const hw = container.querySelector('[id="ch14-pll"]')!
    expect(hw.textContent).toContain('PD 的輸出，也就是送進 loop filter 的同一個節點')
    expect(hw.textContent).toContain('不從 DTC 或 divider 取')
    expect(hw.textContent).toContain('數位端送進 reference 端 DTC 的 code')
    const hwTex = Array.from(hw.querySelectorAll('annotation')).map((a) => a.textContent)
    expect(hwTex).toContain(String.raw`C_0-w_k\,x[n]`)
    expect(hwTex).toContain(String.raw`T_0-w_k\,x[n]`)
    // §14.5「連結到 PLL」：±Δ 的擾動寫成 reference 端 DTC 延遲 T_0 − (w̄ ± Δ)·x[n] 的變化；PD 量到的誤差是 (a − w̄ ∓ Δ)·x[n] + v[n]，多了 ∓Δ·x[n]
    const slope = Array.from(container.querySelectorAll('.c-callout')).find((c) => c.textContent?.includes('量測時 DTC 的 gain 被刻意偏移'))
    expect(slope, '§14.5 的「連結到 PLL」').toBeTruthy()
    expect(slope!.textContent).toContain('補償量')
    expect(slope!.textContent).toContain('reference 端 DTC 的延遲')
    const slopeTex = Array.from(slope!.querySelectorAll('annotation')).map((a) => a.textContent)
    expect(slopeTex).toContain(String.raw`T_0-(\bar w\pm\Delta)\,x[n]`)
    expect(slopeTex).toContain(String.raw`e[n]=(a-\bar w\mp\Delta)\,x[n]+v[n]`)
    expect(slopeTex).toContain(String.raw`\mp\Delta\cdot x[n]`)
    // 只容許共用 Plot/Mermaid 非同步載入的 act() 警告（React 測試環境的已知雜訊）
    const real = errSpy.mock.calls.map((c) => String(c[0])).filter((m) => !m.includes('not wrapped in act'))
    expect(real).toEqual([])
    errSpy.mockRestore()
  }, 150000)
})

/**
 * docs/teaching-style.md §3：內文不得用 Unicode 拼湊公式。掃描 KaTeX／程式碼以外的文字節點，
 * 不可出現希臘字母、上下標數字、帽號，或 ≤ ≥ ≈ ⇒ √ ± 等數學運算符號。
 * 例外（只能是純文字的地方）：<option>、ParamControl 的 reg／unit、參數摘要與 JSON、共用元件自己的固定文字、
 * 規格要求逐字顯示的警告詞「C ≤ 0：更新極性錯誤…」（單位欄 fs⁻¹、fs²、µs 已改成 `$\mathrm{fs}^{-1}$` 等 KaTeX）。Plotly 的圖例與軸標題畫在 canvas 內，不在 DOM 文字節點中，另由下方的「Plot 圖內文字」測試攔截原始字串檢查。
 */
function unicodeMathLeaks(container: HTMLElement): string[] {
  const BAD = /[\u0370-\u03FF\u00B2\u00B3\u00B9\u2070-\u209F\u1D2C-\u1D6A≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓]|\u0302|\u0304/
  const SKIP = '.katex, pre, code, script, style, option, .c-param-reg, .c-param-unit, .c-exp-summary, .c-exp-json, .c-plot-note, .c-metric-table th, .c-tip'
  const leaks: string[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || el.closest(SKIP)) continue
    const t = (n.textContent ?? '').trim().replace('C ≤ 0：更新極性錯誤', '')
    // '$'：字串屬性裡的 $…$ 沒有被 mathText 轉換（傳到不支援的 prop）時會原樣漏出來
    if (BAD.test(t) || t.includes('$')) leaks.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${t.slice(0, 70)}`)
  }
  return leaks
}

describe('Ch14 數學一律 LaTeX（不以 Unicode 拼湊）', () => {
  it('整章（Research 模式、含三個實驗的標題／圖說／指標／假設／警告／事件紀錄）沒有 Unicode 拼湊的公式', async () => {
    localStorage.setItem('lmspll.mode', 'research')
    const { container } = render(wrap(<Chapter14 />))
    // 等 worker（jsdom 為 inline）跑完 E48 表與狀態機 MC，把執行後才出現的指標也掃進去
    await waitFor(() => expect(container.textContent).toContain('MC 評估 RMS：狀態機'), { timeout: 60000 })
    expect(unicodeMathLeaks(container)).toEqual([])
  }, 150000)

  it('失敗情境的警告（極性、空區間、dead zone、E48）也都用 KaTeX', async () => {
    for (const [node, url] of [
      [<LrOptimizerExperiment key="a" />, '/ch/14?preset=optimizer-polarity'],
      [<LrOptimizerExperiment key="b" />, '/ch/14?preset=optimizer-e48-large-delta0'],
      [<LrOptimizerExperiment key="c" />, '/ch/14?preset=optimizer-c-near-zero'],
      [<CornerIntervalExperiment key="d" />, '/ch/14?preset=optimizer-corner-empty'],
      [<CornerIntervalExperiment key="e" />, '/ch/14?preset=optimizer-corner-measured'],
      [<CalStateMachineExperiment key="f" />, '/ch/14?preset=optimizer-sm-register-lsb'],
      [<CalStateMachineExperiment key="g" />, '/ch/14?preset=optimizer-sm-polarity'],
      [<CalStateMachineExperiment key="h" />, '/ch/14?preset=optimizer-sm-bad-fcw-ignore'],
    ] as const) {
      const { container, unmount } = render(wrap(node, url))
      await waitFor(() => expect(container.querySelector('.c-exp-warnings')).toBeTruthy())
      expect(unicodeMathLeaks(container)).toEqual([])
      expect(container.querySelector('.c-exp-warnings .katex')).toBeTruthy()
      unmount()
    }
  }, 150000)
})

describe('Ch14 學習模式（同一計算核心、不同呈現）', () => {
  it('Beginner：逐步推導預設收合；Engineer：直接展開', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container, unmount } = render(wrap(<Chapter14 />))
    const collapsed = Array.from(container.querySelectorAll('details.ch14-details > summary')).filter((s) => s.textContent?.includes('Beginner 模式預設收合'))
    expect(collapsed.length).toBeGreaterThan(5)
    unmount()
    localStorage.setItem('lmspll.mode', 'engineer')
    const r2 = render(wrap(<Chapter14 />))
    expect(Array.from(r2.container.querySelectorAll('summary')).some((s) => s.textContent?.includes('Beginner 模式預設收合'))).toBe(false)
    expect(r2.container.querySelectorAll('.c-steps').length).toBeGreaterThan(5)
  }, 150000)
})

describe('Ch14 實驗：preset 與解釋型警告', () => {
  it('lr-optimizer：?preset=optimizer-polarity ⇒ 「C ≤ 0：更新極性錯誤」並移除 Run', async () => {
    render(wrap(<LrOptimizerExperiment />, '/ch/14?preset=optimizer-polarity'))
    await waitFor(() => expect(screen.getAllByText(/C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散/).length).toBeGreaterThan(0))
    // 警告裡的數學由 mathText 轉成 KaTeX（textContent 含 MathML annotation 的 TeX 原始碼）
    const warn = document.querySelector('.c-exp-warnings')
    expect(warn?.textContent).toMatch(/C=\\cos\\theta=-0\.500/)
    expect(warn?.querySelector('.katex')).toBeTruthy()
    expect(screen.queryByText('執行 Run')).toBeNull()
  })

  it('lr-optimizer：?preset=optimizer-e48-large-delta0 ⇒ E48 slew-limited 警告', async () => {
    render(wrap(<LrOptimizerExperiment />, '/ch/14?preset=optimizer-e48-large-delta0'))
    await waitFor(() => expect(screen.getByText(/1-bit comparator 飽和（slew-limited）/)).toBeTruthy())
  })

  it('lr-optimizer：預設條件交叉比對 analytic = ok（dJ/dμ(μ*) ≈ 0），MC 尚未執行為 n/a', () => {
    const { container } = render(wrap(<LrOptimizerExperiment />))
    expect(container.querySelector('.c-check-ok')?.textContent).toMatch(/dJ\/d\\mu\(\\mu\^\*\)/)
    expect(screen.getByText(/尚未執行：按「執行 Run」/)).toBeTruthy()
  })

  it('corner-interval：?preset=optimizer-corner-empty ⇒ 「區間為空」並給 B_min = 12', async () => {
    render(wrap(<CornerIntervalExperiment />, '/ch/14?preset=optimizer-corner-empty'))
    await waitFor(() => expect(screen.getByText(/區間為空：最慢的 corner/)).toBeTruthy())
    expect(document.querySelector('.c-exp-warnings')?.textContent).toMatch(/B_\{\\min\}=12/)
    // analytic 交叉比對：端點比較（空）與 F-14.16（B = 11 < 12）兩個判據一致 ⇒ ok
    const ok = Array.from(document.querySelectorAll('.c-check-ok')).map((e) => e.textContent ?? '')
    expect(ok.some((t) => t.includes('兩個判據一致'))).toBe(true)
  })

  it('corner-interval：?preset=optimizer-corner-polarity ⇒ 極性錯誤的解釋', async () => {
    render(wrap(<CornerIntervalExperiment />, '/ch/14?preset=optimizer-corner-polarity'))
    await waitFor(() => expect(document.querySelector('.c-exp-warnings')?.textContent).toMatch(/C ≤ 0：至少一個 corner 的 .*K_i\\le0.*更新極性錯誤/))
  })

  it('cal-state-machine：?preset=optimizer-sm-polarity ⇒ 極性警告與 FAULT 說明', async () => {
    render(wrap(<CalStateMachineExperiment />, '/ch/14?preset=optimizer-sm-polarity'))
    await waitFor(() => expect(screen.getByText(/FAULT：狀態機判定無法安全校正/)).toBeTruthy())
    expect(screen.getByText(/C ≤ 0：更新極性錯誤/)).toBeTruthy()
  })

  it('cal-state-machine：?preset=optimizer-sm-register-lsb ⇒ L5 與 dead zone 警告', async () => {
    const { container } = render(wrap(<CalStateMachineExperiment />, '/ch/14?preset=optimizer-sm-register-lsb'))
    await waitFor(() => expect(screen.getByText(/定點 dead zone/)).toBeTruthy())
    expect(container.textContent).toContain('L5')
  })

  it('corner-interval：?preset=optimizer-corner-e16（直接輸入 K_i）⇒ 區間非空 [79.677, 83.333] fs', async () => {
    render(wrap(<CornerIntervalExperiment />, '/ch/14?preset=optimizer-corner-e16'))
    await waitFor(() => expect(screen.getByText('區間非空')).toBeTruthy())
    expect(document.querySelector('[data-experiment="corner-interval"]')?.textContent).toMatch(/79\.677/)
  })

  it('stateSegments／trackRmsPrediction 工具', () => {
    expect(stateSegments(Uint8Array.from([0, 1, 1, 2, 2, 2]))).toEqual([
      { s: 'RESET', k0: 0, k1: 1 },
      { s: 'LOCK', k0: 1, k1: 3 },
      { s: 'COARSE', k0: 3, k1: 6 },
    ])
    // σ_w(μ_t = 2 fs) = 0.351 fs、lag r/g = 0.002/0.01596 = 0.125 fs ⇒ 0.373 fs
    expect(trackRmsPrediction(DEFAULT_CAL_SM)).toBeCloseTo(0.3727, 3)
    expect(Number.isNaN(trackRmsPrediction({ ...DEFAULT_CAL_SM, thetaDeg: 120 }))).toBe(true)
  })
})
