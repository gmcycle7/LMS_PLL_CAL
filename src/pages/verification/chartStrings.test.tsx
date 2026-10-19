import { act, fireEvent, waitFor, within } from '@testing-library/react'
import type { PlotProps } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import { MC_PLAN } from '@/simulation/models/acceptance'
import { AcceptanceProvider } from './common'
import { McSweepLab } from './sections/McSweepLab'
import { MonteCarloLabBody } from './sections/MonteCarloLabBody'
import { expectNoTexErrors } from '@/test/katex'
import { renderPage } from '@/test/renderPage'

/**
 * Verification 頁的 Monte Carlo 實驗：圖內字串與控制項的數學一律是 LaTeX
 * （使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 做法：把共用的 <Plot> 換成「記下收到的 props」的替身，按「執行 Run」（jsdom 沒有 Worker ⇒ 在主執行緒跑）等圖出現，
 * 檢查交給 <Plot> 的每一個圖內字串（軸標題、trace 名稱、hover…）：
 *   1. `$...$` 以外沒有 Unicode 拼的數學（希臘字母、上下標、運算符號、w_k 這類底線下標）；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`（代表指令都認得）。
 * DOM 這一側：控制項的 label／hint／unit，KaTeX 以外的文字也沒有 Unicode 數學。
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
/** 圖上的程式碼名稱（常數）不是數學：unicodeMathIn 的底線下標規則會誤判 MC_PLAN 這類識別字，檢查前先拿掉 */
const CODE_NAMES = /\bMC_PLAN\b/g
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
const allText = (): Set<string> => {
  const text = new Set<string>()
  for (const p of plots()) {
    collect(p.data, null, text)
    collect(p.layout, null, text)
  }
  return text
}

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

function checkStrings(expected: string[]) {
  const text = allText()
  expect(text.size).toBeGreaterThan(3)
  for (const s of expected) expect([...text].some((t) => t.includes(s)), `圖內字串缺少 ${s}`).toBe(true)
  for (const s of text) {
    expect(unicodeMathIn(s.replace(INLINE, ' ').replace(CODE_NAMES, '')), `圖內字串「${s}」在 $…$ 以外還有 Unicode 數學`).toEqual([])
    // 轉成 Plotly 的 pseudo-HTML：只剩 <i> <b> <sub> <sup> <br>，沒有殘留的 TeX（\ { } $）
    expect(plotMath(s).replace(/<\/?(?:i|b|sub|sup|br)>/g, ''), `plotMath(「${s}」)`).not.toMatch(/[$\\{}<>]/)
  }
  for (const p of plots()) {
    if (typeof p.title === 'string') expect(unicodeMathIn(p.title.replace(INLINE, ' ')), `Plot title「${p.title}」`).toEqual([])
    if (typeof p.caption === 'string') expect(unicodeMathIn(p.caption.replace(INLINE, ' ')), `Plot caption「${p.caption}」`).toEqual([])
  }
}

function checkDom(container: HTMLElement) {
  expect(dollarContext(container), '畫面上殘留 `$`（程式碼區塊不算）').toBe('')
  for (const el of Array.from(container.querySelectorAll('.c-exp-title, .c-param-label, .c-param-unit, .c-param-hint'))) {
    expect(unicodeMathIn(plainTextOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
    // 單位、標籤裡的 TeX 不可寫成雙反斜線（JSX 屬性字串不處理跳脫：\\times 會變成換行指令加上文字「times」）
    for (const a of Array.from(el.querySelectorAll('annotation'))) expect(a.textContent ?? '', `TeX 原始碼不可含雙反斜線：${a.textContent}`).not.toContain('\\\\')
  }
  expectNoTexErrors(container)
}

const mount = (ui: React.ReactElement) =>
  renderPage(<AcceptanceProvider>{ui}</AcceptanceProvider>)

describe('Verification 的 Monte Carlo 實驗：圖內字串與控制項的數學都是 LaTeX', () => {
  beforeEach(() => {
    captured.plots.length = 0
    localStorage.setItem('lmspll.mode', 'engineer')
  })
  afterEach(() => {
    localStorage.clear()
    captured.plots.length = 0
  })

  it('單次 Monte Carlo（z 分數長條圖）：軸標題、門檻線名稱、hover 都是 `$…$`；「×」單位是 `$\\times$`', async () => {
    const { container } = mount(<MonteCarloLabBody />)
    const view = within(container)
    const subset = container.querySelector('select.c-select-input') as HTMLSelectElement
    const only = Array.from(subset.options).find((o) => o.textContent === '只跑 T17')!
    fireEvent.change(subset, { target: { value: only.value } })
    await act(async () => {
      fireEvent.click(view.getAllByRole('button', { name: /執行 Run/ })[0])
    })
    await waitFor(() => expect(plots().length).toBeGreaterThanOrEqual(1), { timeout: 60000, interval: 100 })
    checkStrings([String.raw`$+z_{\mathrm{crit}}$`, String.raw`$-z_{\mathrm{crit}}$`, '$z$（標準誤）', String.raw`$z = (\text{估計} - \text{期望})/\mathrm{SE}$`, '$z = '])
    checkDom(container)
    // 「樣本數倍率」的單位 × 是 KaTeX 的 \times（annotation 帶有 TeX 原始碼）
    const units = Array.from(container.querySelectorAll('.c-param-unit')).map((u) => u.textContent ?? '')
    expect(units.some((u) => u.includes(String.raw`\times`))).toBe(true)
  }, 120000)

  it('z 分數長條圖的 hover 文字用每個檢查項目的標籤（含 `$…$`）：全部 MC_PLAN 的標籤經 plotMath 轉完都沒有殘留的 TeX', () => {
    expect(MC_PLAN.length).toBeGreaterThan(10)
    for (const c of MC_PLAN) {
      const html = plotMath(`${c.label}<br>$z = -1.234$`)
      expect(html.replace(/<\/?(?:i|b|sub|sup|br)>/g, ''), `${c.key} 的標籤`).not.toMatch(/[$\\{}<>]/)
    }
  })

  it('多 seed 校準（Q–Q 圖與直方圖）：軸標題、曲線名稱都是 `$…$`', async () => {
    const { container } = mount(<McSweepLab />)
    const view = within(container)
    const kInput = container.querySelector('input[aria-label="seed 個數 K"]') as HTMLInputElement
    fireEvent.change(kInput, { target: { value: '12' } })
    fireEvent.blur(kInput)
    await act(async () => {
      fireEvent.click(view.getAllByRole('button', { name: /執行 Run/ })[0])
    })
    await waitFor(() => expect(plots().length).toBeGreaterThanOrEqual(2), { timeout: 90000, interval: 200 })
    checkStrings([
      String.raw`理論分位數 $\Phi^{-1}((i + \tfrac{1}{2})/n)$`,
      '排序後的 $z$',
      '$y = x$（完美校準）',
      String.raw`$\mathcal N(0, 1)$ 的密度 $\varphi(z)$`,
      '$z$ 的直方圖（密度）',
    ])
    checkDom(container)
  }, 180000)
})
