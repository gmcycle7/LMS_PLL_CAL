import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SettingsProvider } from '@/app/settings'
import Chapter14 from './index'
import { LrOptimizerExperiment } from './experiments/LrOptimizer'
import { CornerIntervalExperiment } from './experiments/CornerInterval'
import { CalStateMachineExperiment, stateSegments, trackRmsPrediction } from './experiments/CalStateMachine'
import { DEFAULT_CAL_SM } from '@/simulation/models/optimizer'

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
  default: { initialize: vi.fn(), render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })) },
}))

function wrap(node: ReactNode, url = '/ch/14') {
  return (
    <MemoryRouter initialEntries={[url]}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>
  )
}

afterEach(() => localStorage.clear())

describe('Ch14 頁面（jsdom smoke）', () => {
  it('完整章節可以渲染：符號表、各節標題、勘誤 E16／E48 連到驗證頁、三個實驗', async () => {
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
    await waitFor(() => expect(screen.getAllByText(/^-?\d+\.\d%$/).length).toBeGreaterThan(3), { timeout: 15000 })
  }, 30000)

  it('第 10 課計算器表格：精確最佳 μ* = 10.66 fs、α = 11.20 時 RMS 0.4488 fs', () => {
    render(wrap(<Chapter14 />))
    const table = screen.getByText('第 10 課宣稱').closest('table') as HTMLElement
    expect(within(table).getByText('10.664')).toBeTruthy()
    expect(within(table).getByText('0.4488')).toBeTruthy()
    expect(within(table).getByText('0.4474')).toBeTruthy()
  }, 30000)
})

describe('Ch14 Research 模式：所有內容（含 Research-only 推導與程式碼）', () => {
  it('KaTeX 全部可解析（沒有 .katex-error）、所有 CodeBlock region 都找得到、沒有 console.error', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { container } = render(wrap(<Chapter14 />))
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(300)
    const bad = Array.from(container.querySelectorAll('.katex-error')).map((e) => e.getAttribute('title') ?? e.textContent)
    expect(bad).toEqual([])
    expect(container.textContent).not.toContain('程式碼載入錯誤')
    // Research 模式才出現的內容
    expect(container.textContent).toContain('core:calStep（完整的一個 block）')
    expect(container.textContent).toContain('stochastic approximation 的經典結果')
    // 散文裡不可出現 TeX 原始碼（例如把 'p^{2B}' 寫在一般字串裡）：檢查 KaTeX 與程式碼區塊以外的文字節點
    const leaks: string[] = []
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest('.katex, pre, code, script, style')) continue
      const t = n.textContent ?? ''
      if (/\^\{|_\{|\\[a-zA-Z]+/.test(t)) leaks.push(t.trim().slice(0, 80))
    }
    expect(leaks).toEqual([])
    // 只容許共用 Plot/Mermaid 非同步載入的 act() 警告（React 測試環境的已知雜訊）
    const real = errSpy.mock.calls.map((c) => String(c[0])).filter((m) => !m.includes('not wrapped in act'))
    expect(real).toEqual([])
    errSpy.mockRestore()
  }, 60000)
})

/**
 * docs/teaching-style.md §3：內文不得用 Unicode 拼湊公式。掃描 KaTeX／程式碼以外的文字節點，
 * 不可出現希臘字母、上下標數字、帽號，或 ≤ ≥ ≈ ⇒ √ ± 等數學運算符號。
 * 例外（只能是純文字的地方）：<option>、ParamControl 的 reg／unit、參數摘要與 JSON、共用元件自己的固定文字、
 * 單位欄（fs⁻¹、fs²）、規格要求逐字顯示的警告詞「C ≤ 0：更新極性錯誤…」。Plotly 的圖例與軸標題畫在 canvas 內，不在 DOM 文字節點中。
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
    if (/^(fs⁻¹|fs²|µs)$/.test(t)) continue
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
    await waitFor(() => expect(container.textContent).toContain('MC 評估 RMS：狀態機'), { timeout: 20000 })
    expect(unicodeMathLeaks(container)).toEqual([])
  }, 60000)

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
  }, 60000)
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
  }, 60000)
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
