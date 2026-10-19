import type { ReactElement } from 'react'
import { waitFor } from '@testing-library/react'
import type { PlotProps } from '@/components'
import { plotMath } from '@/components/plotMath'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { GaugeOneHotLab } from './experiments/GaugeOneHotLab'
import { PeEigenLab } from './experiments/PeEigenLab'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

/**
 * 互動圖表（Plotly）與控制項裡的數學一律是 LaTeX（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 做法：把共用的 <Plot> 換成「記下收到的 props」的替身，渲染兩個實驗（等 Monte Carlo／gauge 計算完成，所有圖都出現），
 * 然後檢查實驗交給 <Plot> 的每一個圖內字串（軸標題、trace 名稱、註記、刻度文字、hover…）：
 *   1. `$...$` 以外沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k 這類底線下標）；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`（代表指令都認得）。
 * DOM 這一側：控制項的 label／hint／unit 與指標表的名稱／單位，KaTeX 以外的文字也沒有 Unicode 數學。
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

const WAIT = { timeout: 90000, interval: 200 }

/** 與 plotMath.ts 相同的行內公式樣式 */
const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
/** 與 plotMath.ts 的 TEXT_KEYS 相同：會顯示在圖上的字串欄位 */
const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])

function collect(value: unknown, key: string | null, text: Set<string>, categories: Set<string>, depth = 0): void {
  if (typeof value === 'string') {
    if (key !== null && TEXT_KEYS.has(key)) text.add(value)
    else if (key === 'x' || key === 'y') categories.add(value) // 分類軸的字串（不會經過 plotMath，所以不可含數學）
    return
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 5000)) collect(v, key, text, categories, depth + 1)
    return
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) collect(v, k, text, categories, depth + 1)
}

const plots = () => captured.plots as PlotProps[]
const names = () => {
  const text = new Set<string>()
  const cats = new Set<string>()
  for (const p of plots()) {
    collect(p.data, null, text, cats)
    collect(p.layout, null, text, cats)
  }
  return { text, cats }
}
const hasTrace = (sub: string) => [...names().text].some((s) => s.includes(sub))
const hasTitle = (sub: string) => plots().some((p) => typeof p.title === 'string' && p.title.includes(sub))

/** KaTeX 以外的文字（拿掉 .katex 子樹，MathML 的 TeX 原始碼也一併拿掉） */
function plainTextOf(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex').forEach((k) => k.remove())
  return copy.textContent ?? ''
}

interface LabCase {
  name: string
  url: string
  lab: ReactElement
  /** 所有圖都已出現（含 Monte Carlo／gauge 計算的結果）、而且 preset 已套用 */
  ready: () => boolean
  /** 這個設定下一定會出現的圖內字串（原始碼，含 `$...$`） */
  expected: string[]
}

const CASES: LabCase[] = [
  {
    name: 'PE Lab：1-bit comparator、物理單位 K_q（mean-field 與線性化均方）',
    url: '/?preset=pe-physical-kq',
    lab: <PeEigenLab />,
    ready: () => hasTitle('滑動窗口') && hasTrace('mean-field'),
    expected: [
      '$u_1$',
      String.raw`$\delta_2$`,
      String.raw`$\lambda_{\min}(\mathbf R_k)$`,
      String.raw`$\kappa(\mathbf R_k)$`,
      String.raw`$\sigma_{\max}(\mathbf U_k)$`,
      String.raw`$|p_{\mathrm{slow}}|^k$（log）`,
      String.raw`模態座標絕對值 $|c_i|$（log）`,
      String.raw`$|c_{\mathrm{slow}}|$ mean-field（Bussgang）`,
      String.raw`$E\|\boldsymbol{\delta}_k\|^2$（mean-square，線性化近似）`,
      String.raw`$1\sigma$ 等高線 $\mathbf u^T\mathbf R^{-1}\mathbf u=1$`,
      String.raw`$\mathbf v_2$（$\lambda_{\min}=0.01$）`,
      String.raw`$\pm\sqrt{2/N_0}$ 預測帶`,
      String.raw`Case A：$\rho=0.99$、$g=0.5\to k_{95}=598$`,
      'block $k$',
    ],
  },
  {
    name: 'PE Lab：±1 sparse-flip code（每個點的樣本數標在圖上）',
    url: '/?preset=pe-pm1-staircase',
    lab: <PeEigenLab />,
    ready: () => hasTitle('滑動窗口') && hasTrace('$n='),
    expected: [String.raw`$\pm1$ code 的 4 個點`, String.raw`$E\|\boldsymbol{\delta}_k\|^2$（mean-square，解析）`, String.raw`$k_{95}=`],
  },
  {
    name: 'Gauge Lab：u-domain（filtered-x），PLL 抑制 DC',
    url: '/?preset=gauge-dc-null',
    lab: <GaugeOneHotLab />,
    ready: () => hasTitle('u-domain（經') && hasTitle('LMS：') && hasTrace('filtered'),
    expected: [
      'sample $n$',
      String.raw`sample $n-\text{skip}$`,
      String.raw`$e_{\mathrm{PD}}[n]$（fs）`,
      String.raw`$y_{\theta}$`,
      String.raw`$y_{\theta'}$（$\boldsymbol{\theta}+c\,\mathbf n$）`,
      String.raw`$e_{\theta''}$（只動 $b$）`,
      String.raw`$\lambda_1$`, // 長條圖的刻度文字（ticktext）
      String.raw`$\lambda$`,
      String.raw`u-domain（樣本 $\mathbf R_u$）`,
      String.raw`$\mathrm{RMS}(e)$（fs）`,
      String.raw`$w_b$（fs）`,
      String.raw`$\hat{\mathbf n}^T\mathbf w$ A：raw-x，初值 $\mathbf w_0^A$`,
      String.raw`$w_b$ C：u-domain（filtered $\tilde{\mathbf u}$ GMAC），初值 $\mathbf w_0^A$`,
      String.raw`$a_i$ 共模 $(1/4)\sum_ia_i$ C：u-domain（filtered $\tilde{\mathbf u}$ GMAC），初值 $\mathbf w_0^A$`,
      '真值 $b$',
    ],
  },
  {
    name: 'Gauge Lab：u-domain（raw x̃ 當 GMAC regressor）',
    url: '/?preset=gauge-raw-gmac-drift',
    lab: <GaugeOneHotLab />,
    ready: () => hasTitle('u-domain（經') && hasTitle('LMS：') && hasTrace('raw $'),
    expected: [String.raw`$w_b$ C：u-domain（raw $\tilde{\mathbf x}$ GMAC），初值 $\mathbf w_0^A$`, String.raw`raw-x 解析 $\lambda=5/4,\ 1/4,\ 1/4,\ 1/4,\ 0$`],
  },
]

describe('Ch09 互動圖表：圖內字串與控制項的數學都是 LaTeX', () => {
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
    async ({ url, lab, ready, expected }) => {
      const { container } = renderPage(lab, { url })
      await waitFor(() => expect(ready()).toBe(true), WAIT)

      // ── 圖內字串 ──
      const { text, cats } = names()
      expect(text.size).toBeGreaterThan(20)
      for (const s of expected) expect([...text].some((t) => t.includes(s)), `圖內字串缺少 ${s}`).toBe(true)
      for (const s of text) {
        expect(unicodeMathIn(s.replace(INLINE, ' ')), `圖內字串「${s}」在 $…$ 以外還有 Unicode 數學`).toEqual([])
        // 轉成 Plotly 的 pseudo-HTML：只剩 <i> <b> <sub> <sup> <br>，沒有殘留的 TeX（\ { } $）
        const html = plotMath(s)
        expect(html.replace(/<\/?(?:i|b|sub|sup|br)>/g, ''), `plotMath(「${s}」)`).not.toMatch(/[$\\{}<>]/)
      }
      for (const s of cats) expect(unicodeMathIn(s), `分類軸字串「${s}」`).toEqual([])
      // Plot 的 title／caption 屬性（字串形式）：以 KaTeX 排版，同樣不可用 Unicode 拼數學
      for (const p of plots()) {
        if (typeof p.title === 'string') expect(unicodeMathIn(p.title.replace(INLINE, ' ')), `Plot title「${p.title}」`).toEqual([])
        if (typeof p.caption === 'string') expect(unicodeMathIn(p.caption.replace(INLINE, ' ')), `Plot caption「${p.caption}」`).toEqual([])
      }

      // ── DOM：沒有漏掉轉換的 `$`；控制項與指標表在 KaTeX 以外的文字沒有 Unicode 數學 ──
      expect(container.textContent ?? '').not.toContain('$')
      for (const el of Array.from(container.querySelectorAll('.c-param-label, .c-param-unit, .c-param-hint, .c-param-meta, .c-metric-table tbody td'))) {
        expect(unicodeMathIn(plainTextOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
      }
      expectNoTexErrors(container)
      // K_q 的單位 fs⁻¹ 在指標表裡是 `$\mathrm{fs}^{-1}$`（KaTeX 的 annotation 帶有 TeX 原始碼）
      if (url.includes('pe-physical-kq')) {
        const table = container.querySelector('.c-metric-table')
        expect(table?.textContent).toContain(String.raw`\mathrm{fs}^{-1}`)
        expect(table?.textContent).not.toContain('fs⁻¹')
      }
    },
    120000,
  )
})
