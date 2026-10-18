import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SettingsProvider } from '@/app/settings'
import { plotMath, texToPlotly } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import Chapter14 from './index'
import { LrOptimizerExperiment } from './experiments/LrOptimizer'

// Plot 圖內文字（Plotly 的圖例、軸標題、annotation 畫在 canvas，不在 DOM 文字節點裡）的 LaTeX 檢查。
// 獨立一個檔案：整章在 Research 模式下渲染、再按 Run 跑 Monte Carlo 很吃記憶體，和 ch14.test.tsx 放在同一個 worker 會超過 heap 上限。

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })) },
}))

// 攔下每次交給 Plot 的 data／layout 裡「會顯示在圖上的字串」（轉成 Plotly pseudo-HTML 之前的原始字串；只留字串，不留資料陣列，避免記憶體暴增），
// 檢查圖內文字的數學都寫成 `$...$`（見檔案最後的 describe）
const PLOT_TEXT = vi.hoisted(() => {
  const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix'])
  const strings = new Set<string>()
  function collect(v: unknown, key: string | null, depth = 0): void {
    if (typeof v === 'string') {
      if (key !== null && TEXT_KEYS.has(key)) strings.add(v)
      return
    }
    if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v) || depth > 6) return
    if (Array.isArray(v)) {
      if (typeof v[0] === 'number') return
      for (const x of v) collect(x, key, depth + 1)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) collect(x, k, depth + 1)
  }
  return { strings, collect }
})
vi.mock('@/components/plotMath', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...orig,
    applyPlotMath: (data: unknown, layout: unknown) => {
      PLOT_TEXT.collect(data, null)
      PLOT_TEXT.collect(layout, null)
      return orig.applyPlotMath(data as never, layout as never)
    },
  }
})

function wrap(node: ReactNode, url = '/ch/14') {
  return (
    <MemoryRouter initialEntries={[url]}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>
  )
}

afterEach(() => {
  localStorage.clear()
  P.react.mockClear() // mock.calls 會留著每次傳給 Plotly 的整包資料陣列
})

/**
 * docs/teaching-style.md §3：圖裡面的數學也要用 LaTeX。Plotly 的圖例、軸標題、annotation 畫在 canvas，不在 DOM 文字節點裡，
 * 所以改成在 Plot 轉換前攔下原始字串（name／text／title／ticktext／hovertemplate…）：
 * `$...$` 以外不可有 Unicode 拼的數學；每段 `$...$` 都要能轉成 Plotly pseudo-HTML（沒有殘留的反斜線、大括號、`$`，也沒有不支援的指令）。
 */
describe('Ch14 Plot 圖內文字：數學寫成 $...$（plotMath）', () => {
  /** plotMath 沒有專屬符號、直接以名稱顯示的函數名稱（正體）；其他「原樣顯示名稱」的指令代表尚未支援 */
  const FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'ln', 'log', 'exp', 'min', 'max', 'erf', 'sgn'])
  const EXTRA_MATH = /[⇒⇔≪≫≲≳∠∑√]|\u0302|\u0304/

  const allStrings = () => PLOT_TEXT.strings
  function problems(strings: Set<string>): string[] {
    const bad: string[] = []
    for (const str of strings) {
      const outside = str.replace(/\\\$/g, '').replace(/\$[^$]*\$/g, '')
      if (unicodeMathIn(outside).length > 0 || EXTRA_MATH.test(outside)) bad.push(`$ 以外有 Unicode 數學：${str}`)
      if ((str.replace(/\\\$/g, '').match(/\$/g) ?? []).length % 2 !== 0) bad.push(`$ 沒有成對：${str}`)
      const html = plotMath(str)
      if (/[\\{}$]/.test(html.replace(/<\/?(i|b|sub|sup|br)>/g, ''))) bad.push(`轉換後殘留 \\ { } $：${str} → ${html}`)
      for (const seg of str.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)) {
        for (const cmd of seg[1].matchAll(/\\([A-Za-z]+)/g)) {
          if (texToPlotly(`\\${cmd[1]}`) === cmd[1] && !FUNCTION_NAMES.has(cmd[1])) bad.push(`plotMath 不支援 \\${cmd[1]}：${str}`)
        }
      }
    }
    return bad
  }

  it('三個實驗與 §14.1–§14.7 的圖（含執行 Monte Carlo 之後才出現的圖例）：軸標題、圖例名稱都沒有 Unicode 拼的數學，每段 $...$ 都轉得出來', async () => {
    localStorage.setItem('lmspll.mode', 'research')
    PLOT_TEXT.strings.clear()
    const { container } = render(wrap(<Chapter14 />))
    // 狀態機實驗掛載時自動跑 Monte Carlo；等它跑完，MC 的圖例與軸標題才進來
    await waitFor(() => expect(container.textContent).toContain('MC 評估 RMS：狀態機'), { timeout: 60000 })
    // lr-optimizer 與 §14.6 排程圖的 Monte Carlo 要按 Run 才會有
    const lr = container.querySelector('[data-experiment="lr-optimizer"]') as HTMLElement
    fireEvent.click(within(lr).getByText('執行 Run'))
    const sched = screen.getByText(/^執行 Monte Carlo（/)
    fireEvent.click(sched)
    await waitFor(
      () => {
        const names = [...allStrings()]
        expect(names.some((t) => t.includes('MC exact-binomial'))).toBe(true)
        expect(names.some((t) => t.startsWith('MC 固定'))).toBe(true)
      },
      { timeout: 120000 },
    )
    const strings = allStrings()
    // 不是空轉：整章有幾十個含公式的圖內文字，且各圖的代表性字串都在
    const withMath = [...strings].filter((t) => t.includes('$'))
    expect(withMath.length).toBeGreaterThan(40)
    for (const want of [String.raw`$\mu$（fs，log）`, String.raw`$E[\delta_B^2]$（線性 F-14.3）`, String.raw`$\mu_k$ (fs)`, String.raw`block $k$`, String.raw`$|\delta|$ (fs，log)`, String.raw`$J(\mu)/J(\mu^*)$`, String.raw`$r = K_{\min}/K_{\max}$`]) {
      expect(strings.has(want), `圖內文字少了 ${want}`).toBe(true)
    }
    expect(problems(strings)).toEqual([])
  }, 240000)

  it('目前目標不是「終點 RMS」時多一張成本圖：圖例 $J(\\mu)$ 與縱軸 $J$（單位）也是 LaTeX', async () => {
    PLOT_TEXT.strings.clear()
    const { container } = render(wrap(<LrOptimizerExperiment />, '/ch/14?preset=optimizer-tracking-ramp'))
    await waitFor(() => expect(container.querySelector('[data-experiment="lr-optimizer"]')).toBeTruthy())
    await waitFor(() => expect(allStrings().has(String.raw`$J(\mu)$`)).toBe(true))
    const strings = allStrings()
    expect(strings.has(String.raw`$J$（$\mathrm{fs}^2$）`)).toBe(true)
    expect(problems(strings)).toEqual([])
  })

  it('單位與軸標題的轉換結果：上下標、斜體符號、度數', () => {
    expect(plotMath(String.raw`$\mathrm{fs}^2$`)).toBe('fs<sup>2</sup>')
    expect(plotMath(String.raw`$\mu_k$ (fs)`)).toBe('<i>μ</i><sub><i>k</i></sub> (fs)')
    expect(plotMath(String.raw`$B_{\min}(r)$，$\epsilon = 0.05$、$PM \ge 60^\circ$`)).toBe('<i>B</i><sub>min</sub>(<i>r</i>)，<i>ε</i> = 0.05、<i>PM</i> ≥ 60°')
    expect(plotMath(String.raw`$|a - w_\text{applied}|$`)).toBe('|<i>a</i>−<i>w</i><sub>applied</sub>|')
  })
})
