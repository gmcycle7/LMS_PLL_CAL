import type { ComponentType } from 'react'
import { waitFor } from '@testing-library/react'
import type { PlotProps } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import R10Preview from './previews/R10Inverse'
import R1Preview from './previews/R1Colored'
import R2Preview from './previews/R2Cyclo'
import R3Preview from './previews/R3Quant'
import R4Preview from './previews/R4Precond'
import R5Preview from './previews/R5Design'
import R6Preview from './previews/R6Comparator'
import R7Preview from './previews/R7Multirate'
import R8Preview from './previews/R8Tracking'
import R9Preview from './previews/R9Accumulator'
import SspllPreview from './previews/SspllPolarity'
import { expectNoTexErrors } from '@/test/katex'
import { renderPage } from '@/test/renderPage'

/**
 * Roadmap 預覽圖與控制項裡的數學一律是 LaTeX（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 做法：把共用的 <Plot> 換成「記下收到的 props」的替身，逐一渲染 R1–R10 與 SSPLL 的預覽，
 * 然後檢查預覽交給 <Plot> 的每一個圖內字串（軸標題、trace 名稱、註記、hover…）：
 *   1. `$...$` 以外沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k 這類底線下標）；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`（代表指令都認得）。
 * DOM 這一側：控制項的 label／hint／unit 與指標表的名稱／單位／說明，KaTeX 以外的文字也沒有 Unicode 數學。
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
/** 與 plotMath.ts 的 TEXT_KEYS 相同：會顯示在圖上的字串欄位 */
const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])

function collect(value: unknown, key: string | null, text: Set<string>, depth = 0): void {
  if (typeof value === 'string') {
    if (key !== null && TEXT_KEYS.has(key)) text.add(value)
    return
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 5000)) collect(v, key, text, depth + 1)
    return
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) collect(v, k, text, depth + 1)
}

const plots = () => captured.plots as PlotProps[]

/** KaTeX 以外的文字（拿掉 .katex 子樹，MathML 的 TeX 原始碼也一併拿掉） */
function plainTextOf(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex').forEach((k) => k.remove())
  return copy.textContent ?? ''
}

/** 畫面上殘留的 `$`（程式碼區塊 <pre>／<code> 的原始碼、測試徽章 tooltip 裡的測試名稱不算）；回傳 `$` 前後的文字，沒有則回傳空字串。 */
function dollarContext(root: Element): string {
  const copy = root.cloneNode(true) as Element
  copy.querySelectorAll('pre, code, .c-tip').forEach((e) => e.remove())
  const t = copy.textContent ?? ''
  const i = t.indexOf('$')
  return i < 0 ? '' : t.slice(Math.max(0, i - 40), i + 40)
}

interface PreviewCase {
  name: string
  Preview: ComponentType
  /** 這個預覽一定會出現的圖數 */
  minPlots: number
  /** 一定會出現的圖內字串（原始碼，含 `$...$`） */
  expected: string[]
}

const CASES: PreviewCase[] = [
  { name: 'R1 有色 GMAC 雜訊', Preview: R1Preview, minPlots: 2, expected: [String.raw`$\sigma_w(\rho)$ 封閉式`, String.raw`$\mathrm{fs}^2/\mathrm{Hz}$`, '$f$ [Hz]（block rate $f_u$）'] },
  { name: 'R2 Cyclostationary', Preview: R2Preview, minPlots: 2, expected: [String.raw`$\bar R[m] / \sigma_w^2$`, String.raw`$E[\delta t[n]^2]/\sigma_w^2 = x[n]^2$`] },
  { name: 'R3 量化 / limit cycle', Preview: R3Preview, minPlots: 2, expected: ['$f / f_u$', '$w_H$', '$|Y_k|/P$'] },
  { name: 'R4 MIMO 更新矩陣', Preview: R4Preview, minPlots: 2, expected: [String.raw`$E\|\delta\mathbf w\|^2$`, String.raw`$\varepsilon$`, '$p_i$'] },
  { name: 'R5 Training sequence', Preview: R5Preview, minPlots: 2, expected: [String.raw`$\lambda_{\min}$`, String.raw`$\alpha$（FCW 小數，離整數的距離）`] },
  { name: 'R6 Comparator 非理想', Preview: R6Preview, minPlots: 2, expected: [String.raw`$s / \sigma_v$`, String.raw`$E[q \mid s]$`, '記憶因子 $\\nu$'] },
  { name: 'R7 事件級 PLL', Preview: R7Preview, minPlots: 2, expected: [String.raw`$\mu_{\max}$`, String.raw`$\delta_k / \delta_0$`, '$(\\mu, N)$'] },
  { name: 'R8 NLMS / RLS / Kalman', Preview: R8Preview, minPlots: 1, expected: [String.raw`$\mu$ [fs]`, String.raw`$\mu^*$（= 穩態 Kalman）`] },
  { name: 'R9 RTL bit-true', Preview: R9Preview, minPlots: 1, expected: ['$n$（已累加筆數）'] },
  { name: 'R10 規格反推', Preview: R10Preview, minPlots: 2, expected: [String.raw`$\sigma_w$ [fs]`, String.raw`$\mu$ 下界（時間 / slew）`, String.raw`$\sigma_{w,\max}$（規格）`] },
  { name: 'SSPLL 極性', Preview: SspllPreview, minPlots: 2, expected: [String.raw`$\mathrm{Re}\,H_{\mathrm{PD}}$`, String.raw`$\alpha f_{\mathrm{ref}}$ [Hz]（PMUX 旋轉頻率）`, '$\\kappa_1$'] },
]

describe('Roadmap 預覽：圖內字串與控制項的數學都是 LaTeX', () => {
  beforeEach(() => {
    captured.plots.length = 0
    localStorage.setItem('lmspll.mode', 'engineer')
  })
  afterEach(() => {
    localStorage.clear()
    captured.plots.length = 0
  })

  it.each(CASES)(
    '$name',
    async ({ Preview, minPlots, expected }) => {
      // 預覽內有 <ExperimentShell>，內含 Plot 替身；不需要等 Plotly
      const { container } = renderPage(<Preview />)
      await waitFor(() => expect(plots().length).toBeGreaterThanOrEqual(minPlots), { timeout: 60000, interval: 100 })

      // ── 圖內字串 ──
      const text = new Set<string>()
      for (const p of plots()) {
        collect(p.data, null, text)
        collect(p.layout, null, text)
      }
      expect(text.size).toBeGreaterThan(3)
      for (const s of expected) expect([...text].some((t) => t.includes(s)), `圖內字串缺少 ${s}`).toBe(true)
      for (const s of text) {
        expect(unicodeMathIn(s.replace(INLINE, ' ')), `圖內字串「${s}」在 $…$ 以外還有 Unicode 數學`).toEqual([])
        // 轉成 Plotly 的 pseudo-HTML：只剩 <i> <b> <sub> <sup> <br>，沒有殘留的 TeX（\ { } $）
        const html = plotMath(s)
        expect(html.replace(/<\/?(?:i|b|sub|sup|br)>/g, ''), `plotMath(「${s}」)`).not.toMatch(/[$\\{}<>]/)
      }
      // Plot 的 title／caption 屬性（字串形式）：以 KaTeX 排版，同樣不可用 Unicode 拼數學
      for (const p of plots()) {
        if (typeof p.title === 'string') expect(unicodeMathIn(p.title.replace(INLINE, ' ')), `Plot title「${p.title}」`).toEqual([])
        if (typeof p.caption === 'string') expect(unicodeMathIn(p.caption.replace(INLINE, ' ')), `Plot caption「${p.caption}」`).toEqual([])
      }

      // ── DOM：沒有漏掉轉換的 `$`；控制項與指標表在 KaTeX 以外的文字沒有 Unicode 數學 ──
      expect(dollarContext(container), '畫面上殘留 `$`（程式碼區塊不算）').toBe('')
      for (const el of Array.from(container.querySelectorAll('.c-exp-title, .c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody td'))) {
        // 指標表的「數值」欄是格式化後的文字（例如複數 eigenvalue 的 a ± jb），不是公式
        if (el.matches('td.num.mono')) continue
        expect(unicodeMathIn(plainTextOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
        // 單位、標籤裡的 TeX 不可寫成雙反斜線（JSX 屬性字串不處理跳脫：\\times 會變成換行指令加上文字「times」）
        for (const a of Array.from(el.querySelectorAll('annotation'))) expect(a.textContent ?? '', `TeX 原始碼不可含雙反斜線：${a.textContent}`).not.toContain('\\\\')
      }
      expectNoTexErrors(container)
    },
    120000,
  )

  it('單位 fs⁻¹、fs²、LSB² 在指標表裡是 `$\\mathrm{…}$`（KaTeX 的 annotation 帶有 TeX 原始碼），不再是 Unicode 上標', async () => {
    const { container } = renderPage(<R1Preview />)
    await waitFor(() => expect(container.querySelector('.c-metric-table')).toBeTruthy(), { timeout: 60000 })
    const table = container.querySelector('.c-metric-table')
    expect(table?.textContent).toContain(String.raw`\mathrm{fs}^{-1}`)
    expect(table?.textContent).toContain(String.raw`\mathrm{fs}^2`)
    expect(table?.textContent).not.toContain('fs⁻¹')
    expect(table?.textContent).not.toContain('fs²')
  }, 120000)
})
