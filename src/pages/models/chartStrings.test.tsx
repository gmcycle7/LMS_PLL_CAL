import { fireEvent, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { PlotProps } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import { chartStringProblems, plotlyLeftovers, allChartStrings } from '../lab/chartStringsTestUtils'
import { BlockLmsJsonLab } from './experiments/BlockLmsJsonLab'
import { FftPitfallsLab } from './experiments/FftPitfallsLab'
import { GmacSizingLab } from './experiments/GmacSizingLab'
import { S4Systems } from './sections/S4Systems'
import { renderPage } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

/**
 * Models 頁互動圖表（Plotly）與控制項裡的數學一律是 LaTeX（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 做法：把共用的 <Plot> 換成「記下收到的 props」的替身，渲染四個有圖的地方（JSON Lab、§9.2 GMAC 位元數、FFT 陷阱、§4.1 DT 主 PLL），
 * 檢查交給 <Plot> 的每個圖內字串（軸標題、trace 名稱、註記、刻度文字）：
 *   1. `$...$` 以外沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k 這類底線下標）；公式裡也沒有 Unicode 數學；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`（代表指令都認得）。
 * DOM 這一側：控制項的 label／hint／unit 與指標表的名稱／單位／備註，KaTeX 以外的文字也沒有 Unicode 數學。
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

const WAIT = { timeout: 90000, interval: 200 }
const INLINE = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** KaTeX 以外的文字（拿掉 .katex 子樹，MathML 的 TeX 原始碼也一併拿掉） */
function plainTextOf(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex').forEach((k) => k.remove())
  // JSON 欄位名稱（gm_accum_samples、pd_noise_rms_fs…）是識別字，不是 Unicode 拼的數學
  return (copy.textContent ?? '').replace(/\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b/g, ' ')
}

const strings = () => allChartStrings(captured.plots)
const hasString = (sub: string) => strings().some((s) => s.includes(sub))

function mount(ui: ReactElement, url = '/', mode: 'engineer' | 'research' = 'engineer') {
  return renderPage(ui, { mode, url })
}

/** 圖內字串、Plot 的 title／caption、DOM 的控制項與指標表，一次檢查 */
function checkAll(container: HTMLElement, expected: string[], minStrings = 5) {
  const all = strings()
  expect(all.length).toBeGreaterThanOrEqual(minStrings)
  for (const s of expected) expect(all.some((t) => t.includes(s)), `圖內字串缺少 ${s}`).toBe(true)
  expect(chartStringProblems(captured.plots)).toEqual([])
  expect(plotlyLeftovers(all, plotMath)).toEqual([])
  for (const p of captured.plots) {
    if (typeof p.title === 'string') expect(unicodeMathIn(p.title.replace(INLINE, ' ')), `Plot title「${p.title}」`).toEqual([])
    if (typeof p.caption === 'string') expect(unicodeMathIn(p.caption.replace(INLINE, ' ')), `Plot caption「${p.caption}」`).toEqual([])
  }
  // 驗證徽章的提示（.c-tip）是測試名稱原文，可能含反引號包起來的 `$...$`；其餘畫面不可殘留 `$`
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.c-tip').forEach((t) => t.remove())
  const text = clone.textContent ?? ''
  const at = text.indexOf('$')
  expect(at < 0 ? '' : text.slice(Math.max(0, at - 50), at + 50), '畫面上殘留 `$`').toBe('')
  // 控制項的 label／unit／hint 與指標表（名稱、單位、備註）：KaTeX 以外沒有 Unicode 數學
  for (const el of Array.from(container.querySelectorAll('.c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody th, .c-metric-table tbody td'))) {
    expect(unicodeMathIn(plainTextOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
  }
  expectNoTexErrors(container)
}

describe('Models 頁互動圖表：圖內字串與控制項的數學都是 LaTeX', () => {
  beforeEach(() => {
    captured.plots.length = 0
  })
  afterEach(() => {
    localStorage.clear()
    captured.plots.length = 0
  })

  it('Block Sign-LMS JSON Lab：w_k、w_phys、a、w*、±2σ_w 帶、G_k、e[n]、直方圖與 N(w*, σ_w²)；釘選曲線的標籤也是 LaTeX', async () => {
    const { container } = mount(<BlockLmsJsonLab />, '/?preset=block-lms-json-sum-mode')
    const lab = container.querySelector('[data-experiment="block-lms-json"]') as HTMLElement
    await waitFor(() => expect(hasString(String.raw`$G_k$`) && hasString('block $k$')).toBe(true), WAIT)
    // 釘選目前的曲線：標籤含 shortLabelTex（$\mu=…$、$N=…$）
    const pin = Array.from(lab.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('釘選目前的 gain 曲線')) as HTMLButtonElement
    fireEvent.click(pin)
    await waitFor(() => expect(hasString('釘選 1：')).toBe(true), WAIT)
    expect(strings().some((s) => /^釘選 1：\$\\mu=[^$]+\$ \/ \$N=\d+\$/.test(s))).toBe(true)
    checkAll(container, [
      String.raw`$w_k$（內部暫存器）`,
      String.raw`$a$（gain_true）`,
      String.raw`$w^*$（mean-field）`,
      String.raw`$G_k$`,
      String.raw`$S$（sum，無因次）`, // sum-mode preset
      String.raw`$w$ [fs/unit code]`,
      'block $k$',
    ])
  }, 180000)

  it('Block Sign-LMS JSON Lab（預設 average）：sample trace 的 e[n]、(a − w0)·u[n] + b，與後半段 w 的直方圖', async () => {
    // sample trace 在 Engineer 以上、直方圖在 Research 才顯示
    const { container } = mount(<BlockLmsJsonLab />, '/', 'research')
    await waitFor(() => expect(hasString(String.raw`$e[n]$`) && hasString(String.raw`$\mathcal{N}(w^*, \sigma_w^2)$`)).toBe(true), WAIT)
    checkAll(container, [
      String.raw`$w^* \pm 2\sigma_w$（預測）`,
      String.raw`$e[n]$（含雜訊）`,
      String.raw`$(a - w_0)\cdot u[n] + b$（block 0 的確定性部分）`,
      String.raw`模擬：後半段 $w$ 直方圖`,
      String.raw`$G$（average，無因次）`,
      'sample $n$',
      String.raw`$e$ [fs]`,
    ])
  }, 180000)

  it('§9.2 GMAC 位元數計算器：E[G]、Kδ、E[Ĝ] 的截斷曲線', async () => {
    const { container } = mount(<GmacSizingLab />)
    await waitFor(() => expect(hasString('floor 右移')).toBe(true), WAIT)
    checkAll(container, [
      String.raw`無截斷 $E[G] = x_n(2\Phi - 1)$`,
      String.raw`線性化 $K\delta$`,
      String.raw`floor 右移 $E[\hat G]$`,
      String.raw`round half up $E[\hat G]$`,
      String.raw`$\delta = a - w$ [fs]`,
      String.raw`$E[\hat G]$（正規化）`,
    ])
  }, 120000)

  it('§15.5 FFT 陷阱：頻率軸 f·N/f_s 與 A₁²/2；控制項單位 log₂', async () => {
    const { container } = mount(<FftPitfallsLab />)
    await waitFor(() => expect(hasString('periodogram')).toBe(true), WAIT)
    checkAll(container, [String.raw`頻率 [bin $= f\cdot N/f_s$]`, String.raw`dBc per bin（相對 $A_1^2/2$）`])
    // 兩個控制項（紀錄長度、Welch segment）的單位 log₂ samples 是 `$\log_2$`（KaTeX 的 annotation 帶 TeX 原始碼）
    const tex = Array.from(container.querySelectorAll('.c-param-unit annotation')).map((a) => a.textContent ?? '')
    expect(tex.filter((t) => t === String.raw`\log_2`)).toHaveLength(2)
  }, 120000)

  it('§4.1 DT 主 PLL：|H_PD|、∠H_PD、Ω', async () => {
    const { container } = mount(<S4Systems />)
    await waitFor(() => expect(hasString('rad/sample')).toBe(true), WAIT)
    checkAll(container, [String.raw`$|H_{\mathrm{PD}}|$ [dB]`, String.raw`$\angle H_{\mathrm{PD}}$ [deg]`, String.raw`$\Omega$ [rad/sample]`], 4)
  }, 120000)
})
