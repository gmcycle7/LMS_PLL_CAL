import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ALL_PRESETS } from '@/app/presets'
import { SettingsProvider } from '@/app/settings'
import type { PlotProps } from '@/components'
import { plotMath } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { hasPreviewer, previewPreset } from './previews'
import Inspector from './sections/Inspector'
import { PreviewView } from './sections/PreviewPanel'

/**
 * Gallery 預覽圖裡的數學一律是 LaTeX（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 預覽函式（previews.ts）交給 <Plot> 的字串：標題、軸標題、曲線名稱、水平參考線名稱。檢查三件事：
 *   1. `$...$` 以外沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k 這類底線下標）；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`（代表指令都認得）；
 *   3. PreviewView 把它們原樣交給 <Plot>（換成記下 props 的替身），而且 aria-label 是純文字（沒有 `$`）。
 */
const captured = vi.hoisted(() => ({ plots: [] as unknown[] }))
vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>()
  const Plot = (props: PlotProps) => {
    captured.plots.push(props)
    return null
  }
  return { ...actual, Plot }
})

/** 與 plotMath.ts 相同的行內公式樣式 */
const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

function chartStrings(preset: (typeof ALL_PRESETS)[number]): string[] {
  const o = previewPreset(preset)
  if (o.status !== 'ok' || !o.result.chart) return []
  const c = o.result.chart
  return [c.title, c.xLabel, c.yLabel, ...c.series.map((s) => s.name), ...(c.hLines ?? []).map((h) => h.name)]
}

afterEach(() => {
  captured.plots.length = 0
  localStorage.clear()
})

describe('Gallery 預覽圖的字串：數學一律是 `$...$` LaTeX', () => {
  it('每個可預覽 preset 的標題、軸標題、曲線名稱、參考線名稱：$…$ 以外沒有 Unicode 數學，plotMath 轉完沒有殘留的 TeX', () => {
    let checked = 0
    for (const p of ALL_PRESETS.filter((x) => hasPreviewer(x.experiment))) {
      for (const s of chartStrings(p)) {
        checked++
        expect(unicodeMathIn(s.replace(INLINE, ' ')), `${p.id}：圖內字串「${s}」在 $…$ 以外還有 Unicode 數學`).toEqual([])
        const html = plotMath(s)
        expect(html.replace(/<\/?(?:i|b|sub|sup|br)>/g, ''), `${p.id}：plotMath(「${s}」)`).not.toMatch(/[$\\{}<>]/)
      }
    }
    expect(checked).toBeGreaterThan(60)
  })

  it('各種圖都有公式：軸標題與曲線名稱至少有一半含 `$…$`（變數、希臘字母都排成斜體與上下標）', () => {
    const all = ALL_PRESETS.filter((x) => hasPreviewer(x.experiment)).flatMap(chartStrings)
    const withMath = all.filter((s) => s.includes('$'))
    expect(withMath.length / all.length).toBeGreaterThan(0.5)
    // 幾個代表性的轉換結果（Plotly 上看到的樣子）
    expect(plotMath('$\\delta_k / \\delta_0$')).toBe('<i>δ</i><sub><i>k</i></sub>/<i>δ</i><sub>0</sub>')
    expect(plotMath('$f_u$')).toBe('<i>f</i><sub><i>u</i></sub>')
    expect(plotMath('$\\hat{\\mathbf n}^T\\mathbf w$')).toContain('<sup>')
  })

  it('Preset Inspector 的控制項與指標表：單位、標籤是 KaTeX（「× 捨入半寬」的 × 是 \\times），KaTeX 以外沒有 Unicode 數學', () => {
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter>
          <Inspector selected="lms-playground-hand" onSelect={() => undefined} />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const plain = (el: Element) => {
      const copy = el.cloneNode(true) as Element
      copy.querySelectorAll('.katex').forEach((k) => k.remove())
      return copy.textContent ?? ''
    }
    const units = Array.from(container.querySelectorAll('.c-param-unit'))
    expect(units.length).toBeGreaterThan(0)
    expect(units.some((u) => (u.querySelector('annotation')?.textContent ?? '').includes(String.raw`\times`))).toBe(true)
    for (const el of Array.from(container.querySelectorAll('.c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody td:not(.num)'))) {
      expect(unicodeMathIn(plain(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
      for (const a of Array.from(el.querySelectorAll('annotation'))) expect(a.textContent ?? '', `TeX 原始碼不可含雙反斜線：${a.textContent}`).not.toContain('\\\\')
    }
    // 指標表的單位是 `$…$`（KaTeX），不是先轉成 Unicode 的純文字
    const table = container.querySelector('.c-metric-table')
    expect(table).toBeTruthy()
    expect(container.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
  })

  it('PreviewView 把圖內字串原樣交給 <Plot>；aria-label 與下載檔名是純文字（沒有 $）', () => {
    const presets = ALL_PRESETS.filter((x) => hasPreviewer(x.experiment) && chartStrings(x).length > 0).slice(0, 40)
    expect(presets.length).toBeGreaterThan(10)
    for (const p of presets) {
      const o = previewPreset(p)
      if (o.status !== 'ok' || !o.result.chart) continue
      captured.plots.length = 0
      const { unmount } = render(
        <SettingsProvider>
          <MemoryRouter>
            <PreviewView preset={p} outcome={o} compact />
          </MemoryRouter>
        </SettingsProvider>,
      )
      const props = captured.plots as PlotProps[]
      expect(props.length, p.id).toBe(1)
      const layout = props[0].layout as { xaxis?: { title?: { text?: string } }; yaxis?: { title?: { text?: string } } }
      expect(layout.xaxis?.title?.text, p.id).toBe(o.result.chart.xLabel)
      expect(layout.yaxis?.title?.text, p.id).toBe(o.result.chart.yLabel)
      expect(props[0].title, p.id).toBe(o.result.chart.title)
      expect(props[0].ariaLabel ?? '', p.id).not.toContain('$')
      unmount()
    }
  }, 120000)
})
