import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import * as plotMathModule from '@/components/plotMath'
import { plotMath } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import Chapter00 from './index'

/*
 * 互動圖表（Plotly）與控制項裡的數學都要用 LaTeX（docs/teaching-style.md §3）。
 * Plotly 的 SVG 文字不能放 KaTeX，所以 <Plot> 把圖內字串裡的 `$...$` 轉成斜體符號與真正的上下標（plotMath.ts）。
 * 這裡 spy 在轉換函式 applyPlotMath 上，攔下本章每一張圖「轉換之前」的 data／layout，逐一檢查：
 *   1. 圖內文字（trace name、軸標題、annotation、ticktext、hovertemplate…）的 `$` 成對；
 *   2. `$...$` 以外的文字沒有 Unicode 拼的數學（希臘字母、上下標、√、≤、·、× … 與 w_n 這類底線下標）；
 *   3. 每一段 `$...$` 轉出來之後沒有殘留的 `\`、`{`、`}`、`$`（也就是只用了 plotMath 支援的指令）。
 * 另外檢查 ParamControl 的 label／hint／unit：KaTeX 以外的文字也沒有 Unicode 拼的數學。
 */

vi.mock('plotly.js-cartesian-dist-min', () => ({
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
vi.mock('@/components/plotMath', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/plotMath')>()
  return { ...orig, applyPlotMath: vi.fn(orig.applyPlotMath) }
})

/** 會顯示在圖上的字串欄位（同 plotMath.ts 的 TEXT_KEYS） */
const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])
const MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 走訪 data／layout，收集所有會顯示在圖上的字串（欄位名稱 + 內容）。 */
function chartStrings(value: unknown, key: string | null = null, depth = 0, out: { key: string; text: string }[] = []) {
  if (typeof value === 'string') {
    if (key !== null && TEXT_KEYS.has(key)) out.push({ key, text: value })
  } else if (Array.isArray(value)) {
    for (const v of value) chartStrings(v, key, depth + 1, out)
  } else if (value && typeof value === 'object' && depth < 7 && !ArrayBuffer.isView(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) chartStrings(v, k, depth + 1, out)
  }
  return out
}

/** 去掉 KaTeX 的內容後剩下的文字（KaTeX 以外的文字） */
function textOutsideKatex(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}

describe('ch00 互動圖表與控制項：數學一律 LaTeX', () => {
  it(
    '每張 Plotly 圖的圖內文字：$…$ 成對、KaTeX 以外沒有 Unicode 拼的數學、轉出來的字串沒有殘留的 TeX 指令；控制項的 label／hint／unit 也一樣',
    async () => {
      localStorage.setItem('lmspll.mode', 'research') // 研究模式：所有圖（含 engineer 以上才出現的）都畫出來
      Element.prototype.scrollIntoView = vi.fn()
      const spy = vi.mocked(plotMathModule.applyPlotMath)
      spy.mockClear()
      const { container } = render(
        <SettingsProvider>
          <MemoryRouter initialEntries={['/ch/00']}>
            <Chapter00 />
          </MemoryRouter>
        </SettingsProvider>,
      )
      // 本章的 Plotly 圖：§0.5 四張（w_n、e_n、|δ_n|、J(w)）、§0.6 一張、§0.7 三張、§0.9 一張、§0.10 一張
      await waitFor(() => expect(container.querySelectorAll('.c-plot').length).toBeGreaterThanOrEqual(10), { timeout: 30_000 })
      const plots = container.querySelectorAll('.c-plot').length
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(plots)

      const seen = new Map<string, { key: string; text: string }>()
      for (const [data, layout] of spy.mock.calls) for (const s of [...chartStrings(data), ...chartStrings(layout)]) seen.set(`${s.key}|${s.text}`, s)
      const all = [...seen.values()]
      const withMath = all.filter((s) => s.text.includes('$'))
      // 軸標題、圖例名稱都有公式（下限：本章至少 40 個不同的含公式字串）
      expect(withMath.length).toBeGreaterThanOrEqual(40)
      expect(withMath.some((s) => s.key === 'text' && /^\$[^$]+\$/.test(s.text)), '軸標題').toBe(true)
      expect(withMath.some((s) => s.key === 'name'), '圖例名稱').toBe(true)

      for (const { key, text } of all) {
        const label = `${key}：${text}`
        // 1. `$` 成對（每個 `$` 都屬於某一段 $…$）
        expect(text.replace(MATH, '').includes('$'), `${label}：$ 要成對`).toBe(false)
        // 2. `$…$` 以外的文字：不夾 Unicode 拼的數學，也沒有底線下標／脫字號上標
        const outside = text.replace(MATH, ' ')
        expect(unicodeMathIn(outside), `${label}：數學要寫成 $…$`).toEqual([])
        expect(outside, `${label}：數學要寫成 $…$`).not.toMatch(/[=<>^½−→]|\d\/\d|[A-Za-z]_[A-Za-z0-9]/)
        // 3. 每一段 $…$ 轉出來：只用到 plotMath 支援的指令（不留反斜線、大括號、$）
        for (const m of text.matchAll(MATH)) {
          const converted = plotMath(`$${m[1]}$`)
          expect(converted, `${label}：「${m[1]}」轉換後`).not.toMatch(/[\\{}$]/)
          expect(converted.length, `${label}：「${m[1]}」轉換後不可為空`).toBeGreaterThan(0)
        }
      }

      // 幾個代表性的圖內文字：確實轉成斜體符號與真正的上下標
      const names = (re: RegExp) => all.filter((s) => re.test(plotMath(s.text))).map((s) => plotMath(s.text))
      expect(names(/^<i>w<\/i><sub><i>n<\/i><\/sub>$/).length, '縱軸 w_n').toBeGreaterThan(0)
      expect(names(/^\|<i>δ<\/i><sub><i>n<\/i><\/sub>\|$/).length, '縱軸 |δ_n|').toBeGreaterThan(0)
      expect(names(/^<i>e<\/i><sub><i>n<\/i><\/sub> = <i>y<\/i><sub><i>n<\/i><\/sub>[−-]<i>w<\/i><sub><i>n<\/i><\/sub>\s<i>x<\/i>$/).length, '縱軸 e_n = y_n − w_n x').toBeGreaterThan(0)
      expect(names(/<i>κ<\/i> = .*<i>w<\/i><sub><i>n<\/i><\/sub>/).length, '反例的圖例 κ = …：w_n').toBeGreaterThan(0)
      expect(names(/<i>w<\/i><sup>∗<\/sup> = <i>a<\/i>\+<i>κ<\/i> = /).length, '反例的圖例 w* = a + κ').toBeGreaterThan(0)
      expect(names(/std\(<i>G\u0304<\/i><sub><i>N<\/i><\/sub>\)/).length, 'std(Ḡ_N)').toBeGreaterThan(0)
      expect(names(/<i>s<\/i><sub>1<\/sub>\/√<i>N<\/i>/).length, '理論 s₁/√N').toBeGreaterThan(0)
      expect(names(/Case [A-C] 的 <i>w<\/i><sub><i>n<\/i><\/sub> 路徑/).length, 'Case 的 w_n 路徑').toBeGreaterThan(0)

      // ── 控制項：label／hint／unit 的 KaTeX 以外沒有 Unicode 拼的數學 ──
      const controlParts = Array.from(container.querySelectorAll('.c-param-label, .c-param-hint, .c-param-unit, .c-param-meta'))
      expect(controlParts.length).toBeGreaterThanOrEqual(20)
      for (const el of controlParts) expect(unicodeMathIn(textOutsideKatex(el)), el.textContent ?? '').toEqual([])
      // 單位「同 y」的 y 是 KaTeX（σ_v 的單位與 y 同一個單位）
      const units = Array.from(container.querySelectorAll('.c-param-unit'))
      expect(units.some((u) => u.querySelector('.katex annotation')?.textContent === 'y')).toBe(true)
      expect(container.textContent).not.toContain('$')

      localStorage.clear()
    },
    120_000,
  )
})
