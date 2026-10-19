import type { ComponentType } from 'react'
import { waitFor } from '@testing-library/react'
import type { PlotProps } from '@/components'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import { ConventionLab } from './experiments/ConventionLab'
import { D1Noise } from './panels/D1Noise'
import { D2Polarity } from './panels/D2Polarity'
import { D3Delay } from './panels/D3Delay'
import { D4Excitation } from './panels/D4Excitation'
import { D5Quant, D6Dither } from './panels/D5D6Quant'
import { D7Eigen } from './panels/D7Eigen'
import { expectNoTexErrors } from '@/test/katex'
import { renderPage } from '@/test/renderPage'

/**
 * Papers 頁的互動圖表與控制項裡的數學一律是 LaTeX（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 *
 * 做法：把共用的 <Plot> 換成「記下收到的 props」的替身，渲染 Convention Lab 與 D1–D7 的對應推導，
 * 檢查交給 <Plot> 的每一個圖內字串（軸標題、trace 名稱、註記、hover…）：
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

interface Case {
  name: string
  Panel: ComponentType
  /** 這個區塊一定會出現的圖數（0 = 沒有圖，只檢查控制項與指標表） */
  minPlots: number
  /** 一定會出現的圖內字串（原始碼，含 `$...$`） */
  expected: string[]
}

const CASES: Case[] = [
  {
    name: 'Convention Lab（§4）',
    Panel: ConventionLab,
    minPlots: 2,
    expected: [
      String.raw`快模式（$\lambda_{\max}$，$g = `,
      String.raw`$|z|_{\max}^k$`,
      '$d = 0$（無延遲）',
      '$|z| = 1$（穩定邊界）',
      '$k$（step / block）',
      String.raw`$|c_{i,k}|$`,
      String.raw`$g = s\lambda$`,
      String.raw`$|z|_{\max}$`,
    ],
  },
  { name: 'D1 白色 GMAC 雜訊', Panel: D1Noise, minPlots: 0, expected: [] },
  { name: 'D2 極性', Panel: D2Polarity, minPlots: 0, expected: [] },
  { name: 'D3 延遲', Panel: D3Delay, minPlots: 0, expected: [] },
  { name: 'D4 激勵', Panel: D4Excitation, minPlots: 0, expected: [] },
  { name: 'D5 量化與 dither', Panel: D5Quant, minPlots: 0, expected: [] },
  { name: 'D6 subtractive dither', Panel: D6Dither, minPlots: 0, expected: [] },
  { name: 'D7 eigen-mode', Panel: D7Eigen, minPlots: 0, expected: [] },
]

describe('Papers 頁：圖內字串與控制項的數學都是 LaTeX', () => {
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
    async ({ Panel, minPlots, expected }) => {
      const { container } = renderPage(<Panel />)
      await waitFor(() => expect(plots().length).toBeGreaterThanOrEqual(minPlots), { timeout: 60000, interval: 100 })

      // ── 圖內字串 ──
      const text = new Set<string>()
      for (const p of plots()) {
        collect(p.data, null, text)
        collect(p.layout, null, text)
      }
      if (minPlots > 0) expect(text.size).toBeGreaterThan(3)
      for (const s of expected) expect([...text].some((t) => t.includes(s)), `圖內字串缺少 ${s}`).toBe(true)
      for (const s of text) {
        expect(unicodeMathIn(s.replace(INLINE, ' ')), `圖內字串「${s}」在 $…$ 以外還有 Unicode 數學`).toEqual([])
        // 轉成 Plotly 的 pseudo-HTML：只剩 <i> <b> <sub> <sup> <br>，沒有殘留的 TeX（\ { } $）
        const html = plotMath(s)
        expect(html.replace(/<\/?(?:i|b|sub|sup|br)>/g, ''), `plotMath(「${s}」)`).not.toMatch(/[$\\{}<>]/)
      }
      for (const p of plots()) {
        if (typeof p.title === 'string') expect(unicodeMathIn(p.title.replace(INLINE, ' ')), `Plot title「${p.title}」`).toEqual([])
        if (typeof p.caption === 'string') expect(unicodeMathIn(p.caption.replace(INLINE, ' ')), `Plot caption「${p.caption}」`).toEqual([])
      }

      // ── DOM：沒有漏掉轉換的 `$`；控制項與指標表在 KaTeX 以外的文字沒有 Unicode 數學 ──
      expect(dollarContext(container), '畫面上殘留 `$`（程式碼區塊不算）').toBe('')
      for (const el of Array.from(container.querySelectorAll('.c-exp-title, .c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody td'))) {
        if (el.matches('td.num.mono')) continue // 指標表的「數值」欄是格式化後的數字／文字，不是公式
        expect(unicodeMathIn(plainTextOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
        // 單位、標籤裡的 TeX 不可寫成雙反斜線（JSX 屬性字串不處理跳脫：\\times 會變成換行指令加上文字「times」）
        for (const a of Array.from(el.querySelectorAll('annotation'))) expect(a.textContent ?? '', `TeX 原始碼不可含雙反斜線：${a.textContent}`).not.toContain('\\\\')
      }
      expectNoTexErrors(container)
    },
    120000,
  )
})
