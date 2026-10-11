import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import type { PlotProps } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import { allChartStrings, chartStringProblems, plotlyLeftovers } from '../lab/chartStringsTestUtils'
import DashboardPage from './index'

/**
 * Dashboard「六條件一分鐘體檢」的圖與控制項：數學一律是 LaTeX（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 把共用的 <Plot> 換成「記下收到的 props」的替身，渲染整頁、按下 Monte Carlo 的「執行」（用小的 N 讓測試快），
 * 檢查交給 <Plot> 的每個圖內字串（軸標題、trace 名稱）：
 *   1. `$...$` 以外沒有 Unicode 拼的數學；公式裡也沒有 Unicode 數學；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`。
 * DOM 這一側：體檢區的控制項（label／unit／hint）與指標表（名稱／單位／備註），KaTeX 以外的文字也沒有 Unicode 數學。
 */
const captured = vi.hoisted(() => ({ plots: [] as { data: unknown; layout: unknown; title?: unknown; caption?: unknown }[] }))
vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>()
  const Plot = (props: PlotProps) => {
    captured.plots.push({ data: props.data, layout: props.layout, title: props.title, caption: props.caption })
    return null
  }
  return { ...actual, Plot }
})
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) } }))
vi.setConfig({ testTimeout: 120_000 })

const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** KaTeX 以外的文字（拿掉 .katex 子樹，MathML 的 TeX 原始碼也一併拿掉）；JSON 欄位名稱是識別字 */
function plainTextOf(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex').forEach((k) => k.remove())
  return (copy.textContent ?? '').replace(/\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b/g, ' ')
}

describe('Dashboard 體檢區的圖與控制項：數學都是 LaTeX', () => {
  afterEach(() => {
    localStorage.clear()
    captured.plots.length = 0
  })

  it('軌跡圖（Case ±1σ、E[w_k − a]、Δw = B/C）、Monte Carlo 圖與座標軸、指標表的單位都是 LaTeX', async () => {
    localStorage.setItem('lmspll.mode', 'engineer')
    localStorage.removeItem('lmspll.dashboard.done')
    const { container } = render(
      <SettingsProvider>
        <MemoryRouter initialEntries={['/']}>
          <DashboardPage />
        </MemoryRouter>
      </SettingsProvider>,
    )
    const check = container.querySelector('#dash-check') as HTMLElement
    fireEvent.change(check.querySelector('input[aria-label="N（每個 GMAC block 的樣本數）"]') as HTMLInputElement, { target: { value: '128' } })
    await waitFor(() => expect(check.querySelector('.dash-mc-bar button')).toBeTruthy())
    fireEvent.click(check.querySelector('.dash-mc-bar button') as HTMLButtonElement)
    await waitFor(() => expect(check.querySelector('.dash-mc-verdict')).toBeTruthy(), { timeout: 60_000 })
    await waitFor(() => expect(allChartStrings(captured.plots).some((s) => s.includes('Monte Carlo：'))).toBe(true))

    const all = allChartStrings(captured.plots)
    const has = (s: string) => expect(all, s).toContain(s)
    has('GMAC block $k$')
    has('$w_k - a$ [fs]')
    has(String.raw`Case A $\pm1\sigma$`)
    has(String.raw`Case A：$E[w_k - a]$`)
    has(String.raw`解析：$E[w_k - a]$（陰影 $\pm1\sigma$）`)
    has(String.raw`Monte Carlo：平均 $\pm$ 跨 seed 標準差`)
    expect(chartStringProblems(captured.plots)).toEqual([])
    expect(plotlyLeftovers(all, plotMath)).toEqual([])
    expect(plotMath('Case A $\\pm1\\sigma$')).toBe('Case A ±1<i>σ</i>')
    for (const p of captured.plots) {
      if (typeof p.title === 'string') expect(unicodeMathIn(p.title.replace(INLINE, ' ')), `Plot title「${p.title}」`).toEqual([])
      if (typeof p.caption === 'string') expect(unicodeMathIn(p.caption.replace(INLINE, ' ')), `Plot caption「${p.caption}」`).toEqual([])
    }

    // DOM：體檢區的控制項與指標表，KaTeX 以外的文字沒有 Unicode 數學；KaTeX 沒有錯誤
    for (const el of Array.from(check.querySelectorAll('.c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody th, .c-metric-table tbody td'))) {
      expect(unicodeMathIn(plainTextOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
    }
    expect(check.querySelectorAll('.katex-error, .c-tex-error')).toHaveLength(0)
    // 指標表裡 gain-equivalent × code 的 × 是 `$\times$`
    expect(Array.from(check.querySelectorAll('.c-metric-table annotation')).some((a) => a.textContent === String.raw`\times`)).toBe(true)
  })
})
