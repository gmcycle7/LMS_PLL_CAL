import katex from 'katex'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { plotMath, texToPlotly } from '@/components/plotMath'
import Chapter01 from './index'
import { LmsPlayground } from './experiments/LmsPlayground'
import { MseMaeLab } from './experiments/MseMaeLab'

/**
 * Ch01 互動圖表（Plotly）的圖內數學（docs/teaching-style.md §3：圖裡面的數學也要用 LaTeX）。
 * 軸標題、圖例名稱（trace name）、annotation 的數學都寫 `$...$`；共用的 <Plot> 以 applyPlotMath 轉成斜體符號與真正的上下標。
 * 單獨一個檔案：整章（Research 模式）再渲染一次很吃記憶體，和 ch01.test.tsx 放在同一個 worker 會超過 Node 的 heap 上限。
 */

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
// <Plot> 把圖內文字交給 applyPlotMath 轉成斜體符號與上下標：這裡記下轉換前的 data／layout，檢查作者寫的是 `$...$` LaTeX。
// 只在 PM.on 時記錄，而且每渲染完一個目標就取出字串、清空陣列（data 裡有幾千點的陣列，不要一直留著）。
const PM = vi.hoisted(() => ({ on: false, calls: [] as [unknown, unknown][] }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...orig,
    applyPlotMath: (data: never, layout: never) => {
      if (PM.on) PM.calls.push([data, layout])
      return orig.applyPlotMath(data, layout)
    },
  }
})

const HEAVY = 300_000
vi.setConfig({ testTimeout: 120_000 })

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

/** 元素內所有 KaTeX 公式的原始碼（MathML annotation） */
const texOf = (root: Element | null): string[] => Array.from(root?.querySelectorAll('.katex-mathml annotation') ?? []).map((a) => a.textContent ?? '')

/** 配對的 $...$（與 components/Tex.tsx 的 mathText 相同的規則） */
const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
/** 純文字裡不該出現的「Unicode 拼公式」（與 ch01.test.tsx 相同的規則） */
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


/** Plotly 圖內會顯示的文字欄位（與 components/plotMath.ts 的 TEXT_KEYS 相同） */
const PLOT_TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])

/** 從 Plotly 的 data／layout 取出所有會顯示在圖上的字串 */
function plotStrings(value: unknown, key: string | null = null, depth = 0, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (key !== null && PLOT_TEXT_KEYS.has(key) && value !== '') out.push(value)
    return out
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return out
  if (Array.isArray(value)) {
    for (const v of value.length > 5000 ? [] : value) plotStrings(v, key, depth + 1, out)
    return out
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) plotStrings(v, k, depth + 1, out)
  return out
}

/** 名稱與轉換結果相同的 TeX 指令（plotMath 不認得的指令會原樣顯示名稱）裡，其實是正體函數名稱的 */
const PLOT_SAME_NAME = new Set(['min', 'max', 'log', 'ln', 'sin', 'cos', 'tan', 'exp', 'lim', 'sup', 'inf', 'arg', 'det', 'erf'])

/** 圖內文字的檢查：$...$ 可嚴格解析、之外沒有 Unicode 數學；轉成 Plotly 文字後沒有 TeX 殘留，也沒有 plotMath 不認得的指令 */
function plotStringErrors(text: string): string[] {
  const out = stringPropErrors(text)
  const shown = plotMath(text)
  if (/[\\{}$]/.test(shown)) out.push(`轉換後仍有 TeX 殘留：${shown}`)
  for (const m of text.matchAll(INLINE_MATH)) {
    for (const cmd of new Set(Array.from(m[1].matchAll(/\\([A-Za-z]+)/g), (c) => c[1]))) {
      if (!PLOT_SAME_NAME.has(cmd) && texToPlotly(`\\${cmd}`) === cmd) out.push(`plotMath 不認得 \\${cmd}：${text}`)
    }
  }
  return out
}

describe('Ch01 互動圖表（Plotly）的圖內數學一律是 $...$ LaTeX（軸標題、圖例、標題）', () => {
  it('plotStringErrors 抓得到錯誤：Unicode 數學、不認得的指令、未配對的 $', () => {
    expect(plotStringErrors('學習率 $\\mu$（fs）')).toEqual([])
    expect(plotStringErrors('$w_{n+1}$ 與 $\\operatorname{sign}(e)$、$J_{\\mathrm{MSE}}(w)$')).toEqual([])
    expect(plotStringErrors('wₙ（模擬）').length).toBeGreaterThan(0)
    expect(plotStringErrors('μ = 0.1').length).toBeGreaterThan(0)
    expect(plotStringErrors('$\\foo x$').length).toBeGreaterThan(0)
    expect(plotStringErrors('價格 $5').length).toBeGreaterThan(0)
  })

  it('整章（Research 模式）與兩個實驗的每個 preset：Plot 的軸標題、trace 名稱、註記都是 `$...$`，沒有 Unicode 拼的數學', () => {
    const strings = new Set<string>()
    const harvest = () => {
      for (const [data, layout] of PM.calls) for (const t of [...plotStrings(data), ...plotStrings(layout)]) strings.add(t)
      PM.calls.length = 0
    }
    const targets: [React.ReactNode, string, 'engineer' | 'research'][] = [
      [<Chapter01 key="ch" />, '/ch/01', 'research'],
      [<LmsPlayground key="a" />, '/ch/01?preset=lms-playground-divergent', 'engineer'],
      [<LmsPlayground key="b" />, '/ch/01?preset=lms-playground-noisy', 'engineer'],
      [<MseMaeLab key="c" />, '/ch/01?preset=mse-mae-outliers-regression', 'engineer'],
      [<MseMaeLab key="d" />, '/ch/01?preset=mse-mae-noise-free-tie', 'engineer'],
      [<MseMaeLab key="e" />, '/ch/01?preset=mse-mae-pm1-codes', 'engineer'],
    ]
    PM.on = true
    try {
      for (const [node, path, mode] of targets) {
        const r = renderAt(node, path, mode)
        harvest()
        r.unmount()
      }
    } finally {
      PM.on = false
      PM.calls.length = 0
    }
    expect(strings.size).toBeGreaterThan(60)
    const bad: string[] = []
    for (const t of strings) bad.push(...plotStringErrors(t).map((e) => `「${t}」：${e}`))
    expect(bad).toEqual([])
    // 變數與公式確實寫成 LaTeX（不是因為取不到字串而「沒有漏網」）
    const withMath = [...strings].filter((t) => t.includes('$'))
    expect(withMath.length).toBeGreaterThan(50)
    for (const t of ['$w_n$', '$e_n$', '$J(w)$', '$|\\delta_n|$', '$w_n$（模擬）']) expect(strings.has(t), t).toBe(true)
    // 每個 Plot 的軸標題（x、y）都是變數：全部是 `$...$`（有文字的 y 軸例外：「筆數」）
    const axisTitles = [...strings].filter((t) => /^\$[^$]+\$$/.test(t))
    expect(axisTitles.length).toBeGreaterThan(15)
  }, HEAVY)

  it('控制項與指標的單位也是 LaTeX：ParamControl 的 unit 在 KaTeX 裡，畫面上的單位文字沒有 Unicode 上標', () => {
    const r = renderAt(<MseMaeLab />, '/ch/01')
    const units = Array.from(r.container.querySelectorAll('.c-param-unit'))
    expect(units.length).toBeGreaterThanOrEqual(8)
    const withTex = units.filter((u) => u.querySelector('.katex'))
    expect(withTex.length).toBeGreaterThanOrEqual(7) // 除了 samples、機率 兩個文字單位
    expect(units.map((u) => u.textContent ?? '').join('')).not.toMatch(/[²³]/)
    expect(texOf(r.container.querySelector('.c-exp-controls'))).toEqual(expect.arrayContaining(['1/[x]^2', '[y]/[x]', '[x]', '[y]']))
    r.unmount()
  })
})
