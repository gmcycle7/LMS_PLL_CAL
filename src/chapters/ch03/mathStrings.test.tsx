import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { plotMath } from '@/components/plotMath'
import Chapter03 from './index'
import { distSummaryTex } from './experiments/DistControls'
import { EXAMPLE_DISTS } from './sections/RandomMean'
import { plotlyMock } from '@/test/mocks/plotly'
import { renderPage } from '@/test/renderPage'

/**
 * 圖內與控制項的數學（使用者要求：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）。
 * 方塊圖（Mermaid）的檢查在 diagrams.test.tsx；這裡檢查互動圖表（Plotly）的軸標題／圖例／註記，
 * 以及 ParamControl 的標籤與單位、MetricRow 的名稱與單位。
 * 獨立成一個檔案：整章在 jsdom 渲染很吃記憶體，和 ch03.test.tsx 放在同一個 worker 會超過 heap 上限。
 */

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

function renderChapter(mode: 'beginner' | 'engineer' | 'research') {
  return renderPage(<Chapter03 />, { mode, url: '/ch/03' })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** 把元素內的 KaTeX 還原成 `$原始 TeX$`（取 MathML 的 annotation），其餘文字保留。 */
function srcText(root: Element): string {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex').forEach((k) => k.replaceWith(`$${k.querySelector('annotation')?.textContent ?? ''}$`))
  return clone.textContent ?? ''
}

/** 單步 MC 交叉比對的附註（三項都通過才會符合；見 ch03.test.tsx） */
const MC_OK = /單步 MC（200000 樣本）： ✓、 ✓、 ✓（ SE）/
/** 逾時只是「測試卡死」時的保險（整章在 jsdom 渲染很慢，多個測試程序同時跑時更慢）；正確性由斷言負責 */
const SLOW = 6
const WAIT = 45000 * SLOW

describe('Chapter 03：圖內文字與控制項的數學', () => {
  it('圖內文字與控制項的數學都是 LaTeX：Plotly 的軸標題／圖例／註記是斜體符號與上下標，ParamControl 的標籤與單位、MetricRow 的名稱與單位由 KaTeX 排版，沒有 Unicode 拼的數學', async () => {
    plotlyMock.react.mockClear()
    const { container } = renderChapter('research')
    // 兩個實驗各加一組 Case B，讓「Case 比較」圖與 z 平面上的多組 pole 也畫出來（圖例名稱都含數學）
    for (const id of ['#exp-stability-fixed-x', '#exp-stability-lab']) fireEvent.click(container.querySelector(`${id} button[aria-label="新增比較組（複製目前參數）"]`) as HTMLButtonElement)
    // 等 Stability Lab 與 Heavy-tail 示範的 Monte Carlo 結果出來（那兩個實驗的分位帶、圖例、真值線才有資料）
    await within(container.querySelector('#exp-stability-lab') as HTMLElement).findAllByText(MC_OK, {}, { timeout: WAIT })
    const heavy = container.querySelector('#exp-stability-heavytail') as HTMLElement
    await within(heavy).findAllByText(/覆蓋率 [\d.]+%（宣稱 95%）/, {}, { timeout: WAIT })

    // ── Plotly：收集 plotlyMock.react 收到的所有文字欄位（Plot 已把 `$…$` 轉成 Plotly 的 pseudo-HTML）
    const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label'])
    const walk = (value: unknown, key: string | null, out: Set<string>, depth = 0): void => {
      if (typeof value === 'string') {
        if (key !== null && TEXT_KEYS.has(key)) out.add(value)
        return
      }
      if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return
      if (Array.isArray(value)) {
        if (typeof value[0] === 'number') return
        for (const v of value) walk(v, key, out, depth + 1)
        return
      }
      for (const [k, v] of Object.entries(value)) walk(v, k, out, depth + 1)
    }
    const collect = () => {
      const found = new Set<string>()
      for (const call of plotlyMock.react.mock.calls as unknown as [unknown, unknown, unknown][]) {
        walk(call[1], null, found)
        walk(call[2], null, found)
      }
      return [...found]
    }
    // 結果出現後，Plot 要等 Plotly 載入完才會把資料交給 Plotly.react：等到三張依賴 MC 結果的圖都畫過
    await waitFor(
      () => {
        const all = collect()
        expect(all.some((x) => x.startsWith('MC 中位數'))).toBe(true) // Stability Lab 主圖的圖例
        expect(all.some((x) => x.includes('遠在圖的右邊'))).toBe(true) // 直方圖的註記
        expect(all.some((x) => x.startsWith('真值 '))).toBe(true) // Heavy-tail 示範的真值線
      },
      { timeout: WAIT },
    )
    const strings = collect()
    expect(strings.length).toBeGreaterThan(60)
    for (const s of strings) {
      // 轉換後不可殘留 `$` 或 TeX 指令；斜體符號（<i>…</i>）以外沒有 Unicode 拼的希臘字母、上下標、底線、根號
      expect(s, s).not.toMatch(/[$\\]/)
      const upright = s.replace(/<i>[^<]*<\/i>/g, '')
      expect(upright.replace(/<\/?(?:sub|sup|b|br)>/g, ''), s).not.toMatch(/[α-ω⁰-₟²³¹_^½]/u)
      // \sqrt 轉出來的根號、\infty 轉出來的 ∞ 只會出現在轉換結果裡；∞ 一定在上下標內（例如 MSD 的下標 ∞），不在上下標外
      expect(upright.replace(/<su[bp]>[^<]*<\/su[bp]>/g, ''), s).not.toMatch(/∞/)
    }
    // 抽幾個確定有轉換的字串：和 plotMath 對原始的 `$…$` 寫法轉出來的結果一致
    for (const src of [
      String.raw`$\delta_n = a - w_n$`,
      String.raw`$|\delta_n|$（log）`,
      String.raw`$|p| = |1 - \mu x^2|$`,
      String.raw`$\mathrm{Re}\,z$`,
      String.raw`MC 中位數 $\log_{10}|\delta_n|$`,
      String.raw`$\log_{10}$ of $|\delta_n|$、$\sqrt{E[\delta_n^2]}$、$|E[\delta_n]|$`,
      String.raw`mean-square：$g(\mu)$`,
      String.raw`almost-sure：$e^{\lambda(\mu)}$`,
      String.raw`$\lambda(\mu) = E\ln|1 - \mu x^2|$`,
      String.raw`$g(\mu) = E[(1 - \mu x^2)^2]$`,
      String.raw`$\sqrt{\text{MSD}_\infty}$（$\sigma_v = 0.1$）`,
      String.raw`$\mu_{\mathrm{MS}} \cdot P_x$（正規化 MS 界）`,
      String.raw`最小值 $\mu^\ast = P_x/M_4$`,
      ...EXAMPLE_DISTS.map((d) => String.raw`$g(\mu)$：${d.label}`).slice(0, 3),
      ...EXAMPLE_DISTS.map((d) => d.label),
    ]) {
      expect(strings, src).toContain(plotMath(src))
    }
    // 直方圖的註記（預設 μ = 0.8：解析的均方根遠在圖的右邊，只能用文字交代它的 log10 值）
    expect(strings.some((x) => /^解析 √\(.+\) = 10<sup>[^<]+<\/sup>，遠在圖的右邊$/.test(x) && x.includes('<i>δ</i><sub><i>N</i></sub><sup>2</sup>'))).toBe(true)
    // 圖例裡的數字例：Case A 預設 μ = 0.1、x = 2（p = 0.6）；Heavy-tail 的真值線
    expect(strings).toContain(plotMath(String.raw`Case A：$\mu=0.1$, $x=2$（$p=0.6$）`))
    expect(strings).toContain(plotMath(String.raw`Case A MC（$\mu=0.8$，Gaussian $\sigma = 1$）`))
    expect(strings).toContain(plotMath(String.raw`Case B 解析 $\sqrt{\text{MSD}}$`))
    expect(strings).toContain(plotMath(String.raw`Case B：$p = 0.6$`))
    expect(strings.some((s) => /^真值 <i>g<\/i><sup><i>n<\/i><\/sup><i>δ<\/i><sub>0<\/sub><sup>2<\/sup> = [\d.e+-]+$/.test(s))).toBe(true)
    // 分布摘要的圖例版本：每一種分布的 `$…$` 轉出來都沒有反斜線與 `$`（集合括號的 { } 是要顯示的字元）
    for (const f of [
      { dist: 'fixed', xValue: -2.5 },
      { dist: 'gaussian', sigma: 0.25 },
      { dist: 'uniform', halfWidth: Math.sqrt(3) },
      { dist: 'pm_one', amplitude: 1 },
      { dist: 'list', listText: '0, 0, 0, 0, 0, 0, 0, 0, 0, 3' },
      { dist: 'list', listText: '1, 2, 3' },
    ] as const) {
      const full = { xValue: 2, sigma: 1, halfWidth: 1, amplitude: 1, listText: '1', ...f } as Parameters<typeof distSummaryTex>[0]
      const out = plotMath(distSummaryTex(full))
      expect(out, JSON.stringify(f)).not.toMatch(/[$\\]/)
      expect(out.replace(/<i>[^<]*<\/i>/g, '').replace(/<\/?(?:sub|sup)>/g, ''), JSON.stringify(f)).not.toMatch(/[_^]|\\|[α-ω]/u)
    }

    // ── 控制項與指標表：標籤、單位、提示、指標名稱與單位在 KaTeX 以外的文字沒有 Unicode 拼的數學
    const outside = (el: Element) => {
      const c = el.cloneNode(true) as HTMLElement
      c.querySelectorAll('.katex').forEach((k) => k.remove())
      return c.textContent ?? ''
    }
    const parts = Array.from(container.querySelectorAll('.c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody td:first-child, .c-metric-table tbody td:nth-child(3)'))
    expect(parts.length).toBeGreaterThan(80)
    for (const el of parts) expect(unicodeMathIn(outside(el)), el.textContent ?? '').toEqual([])
    // 這些元件裡的數學確實由 KaTeX 排版：μ 的控制項標籤與單位 1/[x]² 都是 .katex
    const labels = Array.from(container.querySelectorAll('label.c-param-label')).map((l) => srcText(l))
    for (const want of [
      String.raw`$\mu$（Case B）`, // 加了 Case B 之後，作用中的是 Case B
      String.raw`$x$（固定輸入）`,
      String.raw`$a$（真實參數）`,
      String.raw`$w_0$（初始估計）`,
      String.raw`步數 $N$`,
      String.raw`$\delta_0 = a - w_0$`,
      String.raw`$\sigma_v$（量測雜訊）`,
      String.raw`$\mu$（學習率）`,
      String.raw`$n$（看第 $n$ 步）`,
      String.raw`每批路徑數 $M$`,
      String.raw`批數 $B$`,
      String.raw`$x$ 的分布`,
    ]) {
      expect(labels, want).toContain(want)
    }
    const units = Array.from(container.querySelectorAll('.c-param-unit')).map((u) => srcText(u))
    expect(units).toContain(String.raw`$1/[x]^2$`)
    expect(units).toContain(String.raw`$[x]$`)
    expect(units).toContain(String.raw`$[y]$`)
    expect(units.some((u) => /[²⁻¹]|\[x\]²/.test(u))).toBe(false)
  }, 150000 * SLOW)
})
