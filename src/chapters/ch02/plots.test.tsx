import { render, waitFor, fireEvent, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { plotMath } from '@/components/plotMath'
import { BatchVsSgd } from './experiments/BatchVsSgd'
import { FixedPointExplorer } from './experiments/FixedPointExplorer'
import { GdExplorer } from './experiments/GdExplorer'
import { LimitCycleBand } from './experiments/LimitCycleBand'
import { SignLmsCompare } from './experiments/SignLmsCompare'
import { S4SignSign } from './sections/S4SignSign'

/**
 * Ch02 互動圖表裡的數學（docs/teaching-style.md §3：「圖裡面的數學也要用 LaTeX」）。
 * Plotly 的 SVG 文字放不了 KaTeX：`Plot` 元件先用 plotMath.ts 把圖內字串（軸標題、圖例名稱、tick 文字、annotation、hover）裡的
 * `$...$` 轉成斜體符號與真正的上下標。這裡攔截 `applyPlotMath` 的輸入（作者寫的原始字串），逐一檢查：
 *  - 圖內字串裡的數學都寫成 `$...$`，`$...$` 以外沒有 Unicode 拼的數學（希臘字母、上下標、運算符號），也沒有單獨一個沒包 `$` 的變數名；
 *  - 每個字串都能被 plotMath 完整轉換：結果不殘留反斜線、大括號、`$`（不支援的 TeX 指令會原樣顯示指令名稱）；
 *  - 轉換後的字串真的送到 Plotly.react。
 */
const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) } }))

const RAW = vi.hoisted(() => ({ calls: [] as { data: unknown; layout: unknown }[] }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...m,
    applyPlotMath: <D, L>(data: D, layout: L) => {
      RAW.calls.push({ data, layout })
      return m.applyPlotMath(data, layout)
    },
  }
})

/** 逾時只是「不要卡死」的保險（多個 agent 同時跑測試時會慢很多），不是效能斷言。 */
const T_EXP = 240_000
const T_WAIT = 120_000
vi.setConfig({ testTimeout: 120_000 })

function renderAt(node: ReactNode, path = '/ch/02') {
  try {
    localStorage.setItem('lmspll.mode', 'engineer')
  } catch {
    /* ignore */
  }
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>,
  )
}

/** 會顯示在圖上的字串欄位（同 plotMath.ts 的 TEXT_KEYS） */
const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])

function collect(value: unknown, key: string | null, out: Set<string>, depth = 0) {
  if (typeof value === 'string') {
    if (key !== null && TEXT_KEYS.has(key)) out.add(value)
    return
  }
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === 'number') return
    for (const v of value) collect(v, key, out, depth + 1)
    return
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) collect(v, k, out, depth + 1)
}

/** 自 `from` 之後送進 applyPlotMath 的所有圖內字串（作者寫的原始字串） */
function plotStrings(from = 0): string[] {
  const out = new Set<string>()
  for (const c of RAW.calls.slice(from)) {
    collect(c.data, null, out)
    collect(c.layout, null, out)
  }
  return [...out]
}

/**
 * KaTeX 以外的 Unicode 數學：希臘字母、上下標、運算符號、combining accent、w_k／x^2 這類 ASCII 拼法
 * （同 mermaidTestUtils.unicodeMathIn，再加上 ½ ′ ″ 與 accent）。前後有空白的「 · 」是圖例裡的分隔號，不算乘號。
 */
const UNICODE_MATH = /[\u0370-\u03ff\u2070-\u209f\u00b2\u00b3\u00b9\u0177\u011d\u0134∑∏√∞≤≥≠≈±∓×÷∂∇∈∝⌊⌋⌈⌉ℒ𝒩½″′]|[\u0300-\u036f]|(?<=\S)·(?=\S)|\b[A-Za-z]{1,3}_[A-Za-z0-9{]|\^[-0-9{]/u

/** 每個圖內字串都要排版得了：`$...$` 以外沒有 Unicode 數學、沒有單獨的變數名、plotMath 轉完沒有殘留的 TeX。 */
function expectTypeset(strings: string[]) {
  expect(strings.length).toBeGreaterThan(5)
  for (const s of strings) {
    expect((s.match(/\$/g) ?? []).length % 2, `「${s}」的 $ 沒有成對`).toBe(0)
    const outside = s.replace(/\$[^$]*\$/g, '')
    expect(UNICODE_MATH.test(outside), `「${s}」在 $...$ 以外還有 Unicode 拼的數學`).toBe(false)
    expect(/^[A-Za-z]$/.test(s.trim()), `「${s}」是單獨的變數名，要寫成 $${s.trim()}$`).toBe(false)
    const out = plotMath(s)
    expect(out, `「${s}」轉成 Plotly 文字後還殘留 TeX`).not.toMatch(/[\\{}$]/)
  }
}

/** 轉換後的字串真的送到 Plotly.react（名稱、軸標題都已轉成 pseudo-HTML，沒有 `$`） */
function sentToPlotly(): string[] {
  const out = new Set<string>()
  for (const call of P.react.mock.calls as unknown as [unknown, unknown, unknown][]) {
    collect(call[1], null, out)
    collect(call[2], null, out)
  }
  return [...out]
}

/** plotMath 把 `\,` 轉成細空白 U+2009、`\hat J` 轉成 J + combining circumflex U+0302 */
const THIN = '\u2009'
const HAT = '\u0302'

describe('Ch02 互動圖表：圖內字串的數學都是 LaTeX', () => {
  beforeEach(() => {
    RAW.calls.length = 0
    P.react.mockClear()
  })

  it(
    'GdExplorer：J(w)、切線、二次項、w_n、封閉解、a 與軸標題',
    async () => {
      const { container } = renderAt(<GdExplorer />)
      await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: T_WAIT })
      const strings = plotStrings()
      expectTypeset(strings)
      expect(strings).toEqual(
        expect.arrayContaining([
          String.raw`$J(w)=\tfrac{1}{2}\,(y-wx)^2$`,
          String.raw`二次項 $\tfrac{1}{2}\,J''\,\Delta^2$（預測 vs 真實）`,
          '$w_n$',
          '$w_{0}$',
          '$w_{1}$',
          '$w_n$（遞迴）',
          String.raw`封閉解 $a-(a-w_0)\,p^n$`,
          '$a$',
          '$w$',
          '$J(w)$',
          '$n$',
        ]),
      )
      expect(strings.filter((s) => s.includes('$')).length).toBeGreaterThanOrEqual(11)
      // 轉換後送到 Plotly 的字串：沒有 $、沒有反斜線，而且是斜體符號與真正的上下標
      const sent = sentToPlotly()
      expect(sent.some((s) => s.includes('$'))).toBe(false)
      expect(sent).toEqual(
        expect.arrayContaining([
          `<i>J</i>(<i>w</i>) = 1/2${THIN}(<i>y</i>−<i>wx</i>)<sup>2</sup>`,
          `二次項 1/2${THIN}<i>J</i>′′${THIN}Δ<sup>2</sup>（預測 vs 真實）`,
          '<i>w</i><sub><i>n</i></sub>（遞迴）',
          `封閉解 <i>a</i>−(<i>a</i>−<i>w</i><sub>0</sub>)${THIN}<i>p</i><sup><i>n</i></sup>`,
        ]),
      )
      // 切到沒有 ½ 的成本 J₂：圖例名稱也是 LaTeX
      const from = RAW.calls.length
      const select = container.querySelector('.c-exp-controls select') as HTMLSelectElement // SelectControl 的 option value 是索引：0 = ½J、1 = J₂
      act(() => {
        fireEvent.change(select, { target: { value: '1' } })
      })
      const full = plotStrings(from)
      expectTypeset(full)
      expect(full).toContain(String.raw`$J_2(w)=(y-wx)^2$`)
      expect(plotMath(String.raw`$J_2(w)=(y-wx)^2$`)).toBe('<i>J</i><sub>2</sub>(<i>w</i>) = (<i>y</i>−<i>wx</i>)<sup>2</sup>')
    },
    T_EXP,
  )

  it(
    'BatchVsSgd：Batch／mini-batch／SGD 圖例、w_LS、a 與軸標題 Ĵ(w) − Ĵ_min',
    async () => {
      renderAt(<BatchVsSgd />)
      await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: T_WAIT })
      const strings = plotStrings()
      expectTypeset(strings)
      expect(strings).toEqual(
        expect.arrayContaining([
          'Batch GD（$B=N$）',
          'Mini-batch',
          'SGD / LMS（$B=1$）',
          String.raw`$w_{LS}=\sum x_iy_i/\sum x_i^2$`,
          '$a$',
          '$w$',
          String.raw`$\hat J(w)-\hat J_{\min}$`,
        ]),
      )
      expect(plotMath(String.raw`$\hat J(w)-\hat J_{\min}$`)).toBe(`<i>J${HAT}</i>(<i>w</i>)−<i>J${HAT}</i><sub>min</sub>`)
      expect(plotMath('Batch GD（$B=N$）')).toBe('Batch GD（<i>B</i> = <i>N</i>）')
      expect(sentToPlotly().some((s) => s.includes('$'))).toBe(false)
    },
    T_EXP,
  )

  it(
    'LimitCycleBand：跳動帶 a ± μ_n|x|、LMS 與 Sign-Error 的更新式、|δ_n|',
    async () => {
      renderAt(<LimitCycleBand />)
      await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: T_WAIT })
      const strings = plotStrings()
      expectTypeset(strings)
      expect(strings).toEqual(
        expect.arrayContaining([
          String.raw`$a\pm\mu_n|x|$（跳動帶）`,
          String.raw`$a-\mu_n|x|$`,
          '$a$',
          String.raw`LMS（$\mu\,e\,x$）`,
          String.raw`Sign-Error（$\mu\,\operatorname{sign}(e)\,x$）`,
          String.raw`$|\delta_n|$ LMS`,
          String.raw`$|\delta_n|$ Sign-Error`,
          String.raw`$\mu_n|x|$`,
          '$n$',
          '$w_n$',
          String.raw`$|\delta_n|$`,
        ]),
      )
      expect(plotMath(String.raw`Sign-Error（$\mu\,\operatorname{sign}(e)\,x$）`)).toBe(`Sign-Error（<i>μ</i>${THIN}sign(<i>e</i>)${THIN}<i>x</i>）`)
      expect(plotMath(String.raw`$a\pm\mu_n|x|$（跳動帶）`)).toBe('<i>a</i>±<i>μ</i><sub><i>n</i></sub>|<i>x</i>|（跳動帶）')
      expect(sentToPlotly().some((s) => s.includes('$'))).toBe(false)
    },
    T_EXP,
  )

  it(
    'FixedPointExplorer：ψ/K 曲線、ψ = 0、各演算法的 w*（含數值）與軸標題',
    async () => {
      renderAt(<FixedPointExplorer />)
      await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: T_WAIT })
      const strings = plotStrings()
      expectTypeset(strings)
      expect(strings).toEqual(
        expect.arrayContaining([
          String.raw`$\psi/K$：LMS`,
          String.raw`$\psi/K$：Sign-Error`,
          String.raw`$\psi/K$：Sign-Sign`,
          String.raw`$\psi=0$`,
          '$w$',
          String.raw`$\psi(w)/K$（正 → $w$ 往上走）`,
        ]),
      )
      // 預設是偏斜雜訊 + 正值 code：三個固定點各自一個標記，名稱是 $w^*$（演算法）$=數值$
      const marks = strings.filter((s) => s.startsWith(String.raw`$w^*$（`))
      expect(marks.length).toBe(3)
      for (const m of marks) expect(m).toMatch(/^\$w\^\*\$（[A-Za-z-]+）\$=-?[\d.]+\$$/)
      expect(plotMath(marks[0])).toMatch(/^<i>w<\/i><sup>∗<\/sup>（[A-Za-z-]+）= −?[\d.]+$/)
      expect(sentToPlotly().some((s) => s.includes('$'))).toBe(false)
    },
    T_EXP,
  )

  it(
    'SignLmsCompare：預設的 $a$、$w_n$、|a − w_n| 與「偏斜雜訊」preset 的 w*、|w* − w_n|',
    async () => {
      const first = renderAt(<SignLmsCompare />)
      await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: T_WAIT })
      const strings = plotStrings()
      expectTypeset(strings)
      expect(strings).toEqual(expect.arrayContaining(['$a$', '$n$（sample）', '$w_n$', '$n$', String.raw`$|a-w_n|$`, '$n$（log）']))
      expect(strings).not.toContain(String.raw`$|w^*-w_n|$`)
      first.unmount()

      // 偏斜雜訊 preset：deltaRef = w*，Case A（x ≡ 1）的固定點各不相同 ⇒ 圖上多了 $w^*$（演算法）虛線與 |w* − w_n| 軸標題
      // （preset 載入完後作用中的是最後加入的 Case C：對稱的 ±A code 讓三個固定點都等於 a，所以先切到 Case A）
      const from = RAW.calls.length
      const second = renderAt(<SignLmsCompare />, '/ch/02?preset=sign-lms-skewed')
      await waitFor(() => expect(plotStrings(from)).toContain(String.raw`$|w^*-w_n|$`), { timeout: T_WAIT })
      const tabA = Array.from(second.container.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.includes('A')) as HTMLElement
      act(() => {
        fireEvent.click(tabA)
      })
      await waitFor(() => expect(plotStrings(from).some((s) => s.startsWith(String.raw`$w^*$（`))).toBe(true), { timeout: T_WAIT })
      const skew = plotStrings(from)
      expectTypeset(skew)
      expect(skew.filter((s) => s.startsWith(String.raw`$w^*$（`)).length).toBeGreaterThanOrEqual(2)
      expect(plotMath(String.raw`$|w^*-w_n|$`)).toBe('|<i>w</i><sup>∗</sup>−<i>w</i><sub><i>n</i></sub>|')
      expect(sentToPlotly().some((s) => s.includes('$'))).toBe(false)
    },
    T_EXP,
  )

  it(
    '§4 三種批次成本圖：Σ½(y − wx)²、Σ|y − wx|、Σ|y/x − w| 與 w',
    async () => {
      renderAt(<S4SignSign />)
      await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: T_WAIT })
      const strings = plotStrings()
      expectTypeset(strings)
      expect(strings).toEqual(
        expect.arrayContaining([
          String.raw`LMS：$\sum\tfrac{1}{2}\,(y-wx)^2$`,
          String.raw`Sign-Error：$\sum|y-wx|$`,
          String.raw`Sign-Sign：$\sum|y/x-w|$`,
          '$w$',
        ]),
      )
      expect(plotMath(String.raw`LMS：$\sum\tfrac{1}{2}\,(y-wx)^2$`)).toBe(`LMS：Σ1/2${THIN}(<i>y</i>−<i>wx</i>)<sup>2</sup>`)
      expect(plotMath(String.raw`Sign-Sign：$\sum|y/x-w|$`)).toBe('Sign-Sign：Σ|<i>y</i>/<i>x</i>−<i>w</i>|')
    },
    T_EXP,
  )
})

describe('Ch02 控制項的標籤與單位：數學都是 KaTeX', () => {
  /** 沒有數學的單位／標籤只可能是這些純文字 */
  const PLAIN_UNIT = /^(samples|seeds|epochs|機率|無因次|依演算法)$/

  const experiments: [string, ReactNode][] = [
    ['gd-tangent', <GdExplorer key="gd" />],
    ['gd-batch-vs-sgd', <BatchVsSgd key="batch" />],
    ['sign-lms-band', <LimitCycleBand key="band" />],
    ['sign-lms-fixed-points', <FixedPointExplorer key="fp" />],
    ['sign-lms-compare', <SignLmsCompare key="cmp" />],
  ]

  it.each(experiments)(
    '%s：單位含 $...$ 的都畫成 KaTeX（沒有殘留 $、沒有 y/x、[x]^2 這種純文字拼法），標籤也沒有 Unicode 或單獨的變數名',
    async (id, node) => {
      const { container, unmount } = renderAt(node)
      const exp = container.querySelector(`[data-experiment="${id}"]`) as HTMLElement
      const units = Array.from(exp.querySelectorAll('.c-param-unit'))
      expect(units.length).toBeGreaterThan(3)
      let typeset = 0
      for (const u of units) {
        const text = u.textContent ?? ''
        expect(text, '單位裡殘留 $（公式沒有排版）').not.toContain('$')
        if (u.querySelector('.katex')) typeset++
        else expect(text.trim(), `單位「${text}」含數學但沒有用 $...$`).toMatch(PLAIN_UNIT)
      }
      expect(typeset, `${id} 至少有一個單位是 KaTeX`).toBeGreaterThanOrEqual(2)
      for (const l of Array.from(exp.querySelectorAll('.c-param-label'))) {
        expect(l.textContent ?? '', '標籤裡殘留 $').not.toContain('$')
        if (l.querySelector('.katex')) continue
        const text = l.textContent ?? ''
        expect(UNICODE_MATH.test(text), `標籤「${text}」有 Unicode 拼的數學`).toBe(false)
        expect(/(?<![A-Za-z])[A-Za-z](?![A-Za-z])/.test(text), `標籤「${text}」有單獨的變數名，要用 $...$`).toBe(false)
      }
      unmount()
    },
    T_EXP,
  )

  it('單位的 TeX 本身：1/[x]^2、同 y/x 都是 KaTeX 看得懂的 $...$', async () => {
    const { container } = renderAt(<GdExplorer />)
    await waitFor(() => expect(P.react).toHaveBeenCalled(), { timeout: T_WAIT })
    const mu = Array.from(container.querySelectorAll('.c-param')).find((p) => p.querySelector('.c-param-label')?.textContent?.includes('步長'))!
    const tex = Array.from(mu.querySelectorAll('.c-param-unit annotation[encoding="application/x-tex"]')).map((a) => a.textContent)
    expect(tex).toEqual(['1/[x]^2'])
    const a = Array.from(container.querySelectorAll('.c-param')).find((p) => p.querySelector('.c-param-label')?.textContent?.includes('真實係數'))!
    expect(Array.from(a.querySelectorAll('.c-param-unit annotation[encoding="application/x-tex"]')).map((n) => n.textContent)).toEqual(['y/x'])
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
  })
})
