import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderTex } from '@/components'
import { plotMath } from '@/components/plotMath'
import type { PresetEntry } from '@/data/types'
import {
  analyzePllPolarity,
  compareCtDt,
  DEFAULT_POLARITY_PARAMS,
  designPolarityLoop,
  linearMomentCheck,
  reSignBands,
  runPolarityClosedLoop,
  sweepFcwPolarity,
  type FcwSweepParams,
  type PolarityParams,
} from '@/simulation/models/polarity'
import Chapter06 from './index'
import { fcwZoomAsymptoteName } from './experiments/FcwSweepExperiment'
import { CH06_DIAGRAMS } from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { analyzeTone, modelTextTex, polarityWarnings, verdict, withDefaults } from './experiments/explorerModel'
import { mountPageOnce, renderPage, type SharedMount } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

// 記錄 <Plot> 交給 applyPlotMath 的原始 data／layout（還是 `$...$` 的 LaTeX，尚未轉成 Plotly 的 pseudo-HTML）：用來檢查圖內字串都是 LaTeX
const plotCalls = vi.hoisted(() => ({ list: [] as { data: unknown; layout: unknown }[] }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/plotMath')>()
  const applyPlotMath = ((data: unknown, layout: unknown) => {
    plotCalls.list.push({ data, layout })
    return mod.applyPlotMath(data, layout)
  }) as typeof mod.applyPlotMath
  return { ...mod, applyPlotMath }
})

vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

function renderChapter(url = '/ch/06') {
  return renderPage(<Chapter06 />, { url })
}

afterEach(() => {
  localStorage.clear()
})

const EXPERIMENTS = ['polarity-explorer', 'polarity-ct-dt', 'polarity-fcw-sweep']

/**
 * 逾時設定：整章渲染會在 jsdom 內 inline 執行 worker 的閉迴路 Monte Carlo 與 FCW 掃描；
 * 多個測試行程同時跑時（load average 曾超過 500）會慢上數倍，所以逾時放寬——只影響「失敗時多久才放棄」，不影響任何斷言。
 */
const WAIT = { timeout: 180000 }
const RENDER_TIMEOUT = 240000
const FULL_TIMEOUT = 600000

/** ExperimentShell 的警告段落（mathText 之後）：回傳「自身文字符合 pattern」的那些 <p> */
function warningsMatching(exp: HTMLElement, pattern: RegExp): HTMLElement[] {
  return Array.from(exp.querySelectorAll<HTMLElement>('.c-exp-warnings p')).filter((p) => pattern.test(p.textContent ?? ''))
}

/** KaTeX 的 MathML annotation 保留 TeX 原始碼，可用來確認字串屬性裡的數學真的交給了 KaTeX */
function texSources(el: Element): string[] {
  return Array.from(el.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
}

/** 字串屬性裡的 `$...$` 沒有被當成純文字漏出來（落單的 $ 代表沒有經過 mathText） */
function expectNoRawDollar(el: Element, where: string): void {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('.katex, pre, code, input, textarea, select, script, style').forEach((n) => n.remove())
  expect(clone.textContent ?? '', where).not.toMatch(/\$/)
}

/** 顯示出來的文字（扣掉 KaTeX 之後）不再用 Unicode 拼數學（希臘字母、上下標、≤ ≈ ≪ … 或 1e-5 這種記號） */
const UNICODE_MATH = /[α-ωΑ-Ω≤≥≈≪≫√∫Σ∏²³₀-₉·±−⟨⟩⇒Ĉ]|[A-Za-z]_[A-Za-z{]|\d(?:\.\d+)?e[+-]\d/
function expectNoUnicodeMath(el: Element, where: string, pattern: RegExp = UNICODE_MATH): void {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('.katex').forEach((n) => n.remove())
  expect(clone.textContent ?? '', where).not.toMatch(pattern)
}

/** Plotly 圖內會顯示的字串欄位（與 plotMath.ts 的 TEXT_KEYS 相同）；其餘欄位（資料陣列、顏色、id）不碰 */
const PLOT_TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])
function plotStrings(value: unknown, key: string | null = null, out: string[] = [], depth = 0): string[] {
  if (typeof value === 'string') {
    if (key !== null && PLOT_TEXT_KEYS.has(key)) out.push(value)
    return out
  }
  if (depth > 8 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return out
  if (Array.isArray(value)) {
    for (const v of value) plotStrings(v, key, out, depth + 1)
    return out
  }
  for (const [k, v] of Object.entries(value)) plotStrings(v, k, out, depth + 1)
  return out
}
/** 到目前為止 <Plot> 收到的圖內字串（去重） */
function plotStringsSince(start = 0): string[] {
  return [...new Set(plotStrings(plotCalls.list.slice(start).map((c) => [c.data, c.layout])))]
}

/**
 * 共用元件裡「由字串屬性渲染」的元素（docs/teaching-style.md §3 列出的那些屬性）。
 * 這些元素的文字可能含程式識別字（REG_GMAC_N、gain_step …），所以整頁掃描時不檢查底線，只檢查希臘字母、上下標與數學運算符號。
 */
const STRING_PROP_SELECTORS = [
  '.c-exp-title',
  '.c-exp-desc',
  '.c-exp-warnings p',
  '.c-assumption-list li',
  '.c-check-note',
  '.c-metric-table caption',
  '.c-metric-table tbody td:first-child',
  '.c-plot-title',
  '.c-figcaption',
  '.c-section-title',
  '.c-derivation-title',
  '.c-callout-title',
  '.c-quiz-title',
  '.c-recap-title',
  '.c-recap-label',
  '.c-code-title',
  '.c-code-caption',
  '.c-code-compare-label',
  '.c-code-compare-note',
  '.c-handcalc-title',
  '.c-handcalc-label',
  '.c-step-why',
  '.c-handcalc-notes li',
  '.c-handcalc-tips li',
  '.c-chapter-hand-lead',
  '.ch06-handcalc-index li',
  '.ch06-stepbox > summary',
  // 控制項的 label／hint／unit（ParamControl、SelectControl）與指標表的單位欄（第 3 欄）
  '.c-param-label',
  '.c-param-hint',
  '.c-param-unit',
  '.c-metric-table tbody td:nth-child(3)',
]
const UNICODE_MATH_DOM = /[α-ωΑ-Ω≤≥≈≪≫√∫Σ∏²³₀-₉·±−⟨⟩∠Ĉ]/
/** 掃描 root 內所有由字串屬性渲染的元素；回傳掃描的元素個數 */
function scanStringProps(root: Element): number {
  let scanned = 0
  for (const sel of STRING_PROP_SELECTORS) {
    root.querySelectorAll(sel).forEach((el) => {
      scanned++
      expectNoUnicodeMath(el, `${sel}：${(el.textContent ?? '').slice(0, 60)}`, UNICODE_MATH_DOM)
    })
  }
  return scanned
}

describe('第 06 章頁面（jsdom smoke test）', () => {
  // Research 模式的整章只渲染一次，下面的 it 共用同一棵 DOM（mountPageOnce；原本是一個 150 行、約 80 s 的 it）。
  // 只讀的斷言排在前面；等 worker（inline）算完的 it 各自 waitFor；會改動 DOM 的操作（改 GMAC code delay）放在最後。
  describe('Research 模式整章（共用一次渲染）', () => {
    let page: SharedMount
    let container: HTMLElement
    let errorSpy: ReturnType<typeof vi.spyOn>
    let plotStart = 0
    // 收集 console.error（React key / prop 警告等）；共用 Mermaid 元件的 act() 提示與本章無關，略過
    const errors: string[] = []

    beforeAll(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const msg = args.map(String).join(' ')
        if (!/not wrapped in act/.test(msg)) errors.push(msg)
      })
      plotStart = plotCalls.list.length
      page = mountPageOnce(<Chapter06 />, { url: '/ch/06', mode: 'research' })
      container = page.container
      // 展開所有思考題的解析（解析裡也有 LaTeX），後面「所有 LaTeX 都能被 KaTeX 解析」的檢查才涵蓋到它們
      const answerButtons = screen.getAllByText('看答案與解析')
      expect(answerButtons.length).toBeGreaterThanOrEqual(5)
      answerButtons.forEach((b) => fireEvent.click(b))
    }, FULL_TIMEOUT)

    afterAll(() => {
      errorSpy.mockRestore()
      page.unmount()
    })

    it('骨架：8 節、3 個 ExperimentShell、所有公式錨點、程式碼 region；符號表在章末；章首骨架的順序', () => {
      expect(screen.getByText('本章目錄')).toBeTruthy()
      for (let i = 1; i <= 8; i++) expect(container.querySelector(`#ch06-s${i}`), `§${i}`).not.toBeNull()
      for (const id of EXPERIMENTS) expect(container.querySelector(`#exp-${id}`), id).not.toBeNull()
      // 每個登錄的公式都在頁面上有錨點
      for (const fm of FORMULAS) expect(container.querySelector(`[id="formula-${fm.id}"]`), fm.id).not.toBeNull()
      // 所有 CodeBlock 的 region 都存在（找不到會顯示「程式碼載入錯誤」）
      expect(container.textContent).not.toMatch(/程式碼載入錯誤/)
      expect(container.querySelectorAll('.c-code').length).toBeGreaterThan(10)
      // 符號表：放在章末（#symbols 是頁面最後一個區塊，在 §8 之後；docs/teaching-style.md §5），章首只留一行連結
      const symbols = container.querySelector('#symbols') as HTMLElement
      expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBeGreaterThanOrEqual(20)
      expect(container.querySelectorAll('.c-symbols').length).toBe(1)
      expect(container.querySelector('.ch06')!.lastElementChild).toBe(symbols)
      expect(container.querySelector('#ch06-s8')!.compareDocumentPosition(symbols) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(container.querySelector('.ch06-symbols-link')).toBeNull() // 章首的符號表連結改由 PageFrame 的本章資訊 strip 提供
      // 章首骨架（teaching-style §9）：導言 → 系統地圖 → 「你在這裡」（.c-map-note）→ 標籤列 → 本章目錄 → §1
      const lead = container.querySelector('.ch06-lead')!
      expect(container.querySelector('.ch06')!.firstElementChild).toBe(lead)
      expect(lead.nextElementSibling).toBe(container.querySelector('figure.c-mermaid.c-sysmap'))
      expect(lead.nextElementSibling!.nextElementSibling).toBe(container.querySelector('.ch06-map-note.c-map-note'))
      expect(container.querySelector('.ch06-map-note')!.compareDocumentPosition(container.querySelector('.ch06-tags')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(container.querySelector('.ch06-tags')!.compareDocumentPosition(container.querySelector('.ch06-toc')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('方塊圖：章首的系統地圖 + 登錄的每一張，各有「怎麼看圖」', () => {
      // Research 模式；圖都不在模式限定的段落裡，三種模式張數相同
      expect(container.querySelectorAll('figure.c-mermaid').length).toBe(CH06_DIAGRAMS.length + 1)
      for (const d of CH06_DIAGRAMS) expect(container.querySelector(`[id="diagram-${d.id}"] .c-chapter-fig-walk`), d.id).not.toBeNull()
    })

    it('帶入手算：8 題各自在對應推導之後、綜合題在思考題之前；預設值的答案就是文中的數字', () => {
      // 手算表：12 列 + C = −0.25
      expect(container.textContent).toMatch(/-0\.2500/)
      // 帶入手算：8 題都放進頁面（各自在對應推導之後），章首有索引；綜合題 HC-06.8 在 §8 的思考題之前
      for (const h of HANDCALCS) expect(container.querySelector(`[id="handcalc-${h.id}"]`), h.id).not.toBeNull()
      expect(container.querySelectorAll('.c-handcalc').length).toBe(HANDCALCS.length)
      expect(container.querySelectorAll('.c-chapter-hand-lead').length).toBe(HANDCALCS.length)
      // 章首只剩手算的說明段落（保護位數等），清單式索引改由 strip 的「手算 N 題」取代
      expect(container.querySelectorAll('.ch06-handcalc-index li').length).toBe(0)
      expect(container.querySelector('.ch06-handcalc-index')!.textContent).toContain(`帶入手算（${HANDCALCS.length} 題）`)
      const sectionOf = (id: string) => container.querySelector(`[id="handcalc-${id}"]`)!.closest('section.ch06-section')!.id
      expect(HANDCALCS.map((h) => sectionOf(h.id))).toEqual(['ch06-s3', 'ch06-s4', 'ch06-s4', 'ch06-s5', 'ch06-s5', 'ch06-s5', 'ch06-s6', 'ch06-s8'])
      const s8 = container.querySelector('#ch06-s8') as HTMLElement
      const synth = s8.querySelector('[id="handcalc-HC-06.8"]')!
      const firstQuiz = s8.querySelector('.c-quiz')!
      expect(synth.compareDocumentPosition(firstQuiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // 手算題預設值的答案就是文中的數字（§1 的 T06 pole、§5.2 的 −0.0815、§6.4 表格的 −0.00281）
      expect(container.querySelector('[id="handcalc-HC-06.2"]')!.textContent).toContain('1.0199471')
      expect(container.querySelector('[id="handcalc-HC-06.5"]')!.textContent).toContain('-0.081533')
      expect(container.querySelector('[id="handcalc-HC-06.8"]')!.textContent).toContain('-0.0028098')
    })

    it('T06: Polarity Explorer：預設 φ = 120° ⇒ 極性錯誤警告（解釋原因），閉迴路（jsdom 下 inline worker）判定為「遠離 a」', async () => {
      const exp = container.querySelector('#exp-polarity-explorer') as HTMLElement
      const polWarn = warningsMatching(exp, /更新極性錯誤/)
      expect(polWarn.length).toBeGreaterThan(0)
      // 警告裡的數學已是 KaTeX：C ≤ 0、C_D = −0.25、p = 1 + μK_q|C| = 1.01995 > 1
      expect(texSources(polWarn[0])).toEqual(expect.arrayContaining(['C\\le0', 'C_D=-0.25', 'p=1+\\mu K_q|C|=1.01995>1']))
      expect(polWarn[0].textContent).toMatch(/只減小 .* 不會改變符號/)
      await waitFor(() => expect(exp.querySelectorAll('td[data-loop-state="diverging"]').length).toBeGreaterThan(0), WAIT)
      expect(exp.querySelector('td[data-loop-state="diverging"]')!.textContent).toMatch(/^遠離/)
      expect(within(exp).getByText(/極性錯誤：任何/)).toBeTruthy()
      // Explorer 的指標表列出 mean-field 變號點（單頻 φ = 120°：不變號）
      expect(within(exp).getAllByText(/mean-field 變號點/).length).toBeGreaterThan(0)
    }, RENDER_TIMEOUT)

    it('FCW sweep 完成後顯示抵消定理的指標；三個實驗的交叉比對都沒有 mismatch', async () => {
      const sweep = container.querySelector('#exp-polarity-fcw-sweep') as HTMLElement
      await waitFor(() => expect(within(sweep).getAllByText(/鋸齒一階係數/).length).toBeGreaterThan(0), WAIT)
      // 交叉比對：DSM vs 精確鋸齒理論、解析 vs 時域、MC vs 線性 pole、自寫 DT 係數 vs pll.ts
      await waitFor(() => expect(within(sweep).getAllByText(/二階動差/).length).toBeGreaterThan(0), WAIT)
      for (const id of EXPERIMENTS) {
        const el = container.querySelector(`#exp-${id}`) as HTMLElement
        expect(el.querySelectorAll('.c-check-mismatch').length, id).toBe(0)
      }
      expect(sweep.querySelectorAll('.c-check-ok').length).toBeGreaterThan(0)
    }, RENDER_TIMEOUT)

    it('§6.3 大誤差區與 §6.4 的符號：Ω = π/6、φ = 120° 的離散平均是 −0.3110；精確鋸齒理論為正、截斷譜線為負；R01 的線性外推說明', () => {
      // 大誤差區：Ω = π/6、φ = 120° 的離散平均是 −(2+√3)/12 = −0.3110（不是浮點捨入造成的 −0.19）
      const s3 = container.querySelector('#ch06-s3') as HTMLElement
      expect(s3.textContent).toMatch(/-0\.3110/)
      expect(s3.textContent).not.toMatch(/-0\.19\d/)
      // §6.4：精確鋸齒理論為正、截斷譜線為負（反面示範）、GMAC code delay 的變號表含負值
      const s6 = container.querySelector('#ch06-s6') as HTMLElement
      expect(s6.querySelectorAll('td.neg').length).toBeGreaterThan(3)
      expect(s6.querySelectorAll('td.pos').length).toBeGreaterThan(3)
      // R01：C → 0⁺ 的後果寫成「線性化的固定點 w* ≈ a + B/C」，並說明超出線性範圍時只是線性外推（Ch11 §11.4）；不再有無條件的「固定點 w* = a + B/C」
      expect(s6.textContent).toMatch(/而線性化的固定點.*對任何 bias.*極度敏感——.*大到超出線性範圍時，.*只是線性外推，不再是固定點（第 11 章 §11\.4 的代回檢查）/)
      const s6Tex = Array.from(s6.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
      expect(s6Tex).toContain(String.raw`w^*\approx a+B/C`)
      expect(s6Tex).not.toContain('w^*=a+B/C')
    })

    it('§6.4 但書 1：basin 表由 worker 算出（4 個 frac；前 3 個有 δ_c，數值與 Python 參考 0.456、0.766 σ_v 相符）', async () => {
      const s6 = container.querySelector('#ch06-s6') as HTMLElement
      const basin = await waitFor(
        () => {
          const el = s6.querySelector('[data-testid="ch06-basin-table"]')
          expect(el).not.toBeNull()
          return el as HTMLElement
        },
        WAIT,
      )
      const rows = Array.from(basin.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''))
      expect(rows).toHaveLength(4)
      expect(Math.abs(Number(rows[1][3]) - 0.456)).toBeLessThan(0.01)
      expect(Math.abs(Number(rows[2][3]) - 0.766)).toBeLessThan(0.01)
    }, RENDER_TIMEOUT)

    it('字串屬性的 LaTeX：指標名稱、假設、圖標題／圖說、警告、手算題裡的 $…$ 全部交給 KaTeX，沒有落單的 $；扣掉 KaTeX 後沒有 Unicode 拼的數學', () => {
      for (const id of EXPERIMENTS) {
        const el = container.querySelector(`#exp-${id}`) as HTMLElement
        expectNoRawDollar(el, id)
        expect(el.querySelectorAll('.c-exp-assumptions .katex').length, `${id} assumptions`).toBeGreaterThan(0)
        expect(el.querySelectorAll('.c-figcaption .katex').length, `${id} captions`).toBeGreaterThan(0)
        expect(el.querySelectorAll('.c-plot-title .katex').length, `${id} plot titles`).toBeGreaterThan(0)
        // 圖的 aria-label 維持純文字（不含 TeX 原始碼）
        el.querySelectorAll('figure.c-plot').forEach((fig) => expect(fig.getAttribute('aria-label') ?? '').not.toMatch(/[$\\]/))
      }
      expectNoRawDollar(container, '整章')
      // 字串屬性渲染出來的元素：扣掉 KaTeX 後不再有 Unicode 拼的數學
      expect(scanStringProps(container)).toBeGreaterThan(200)
    })

    it('Plotly 圖內的字串（軸標題、圖例名稱…）：數學都在 $…$ 裡，每段都能被 KaTeX 解析，plotMath 轉出來沒有殘留的 TeX', () => {
      const plotted = plotStringsSince(plotStart)
      expect(plotted.length).toBeGreaterThan(40)
      expectPlotStringsLatex(plotted, '整章的圖')
      expect(plotted).toEqual(
        expect.arrayContaining([
          String.raw`$\nu = \omega/\omega_L$`, // §5 的 CT 原型圖
          String.raw`Type-II $\zeta = 0.7$`,
          String.raw`$\nu = \Omega/(\omega_L T_s)$`, // CT ↔ DT 對照
          String.raw`DT 模型 $\operatorname{Re}\,H(e^{j\Omega})$（$d = 1$）`,
          String.raw`$\operatorname{Re}\,H_{\mathrm{PD}}$`,
          String.raw`$C_D/\sigma_x^2$`, // FCW 掃描
          String.raw`$\Delta = \Omega_0/(\omega_L T_s)$`,
          String.raw`$x[n]$（原始 code）`, // Polarity Explorer
          String.raw`$\phi$ [deg]`,
          String.raw`$\mu$ [fs]`,
          String.raw`block $k$`,
          String.raw`$\delta_k$ [fs]`,
          String.raw`$|\delta|$ [fs]`,
        ]),
      )
    })

    // 會改動 DOM 的操作與整章的收尾檢查放在最後（it 依宣告順序執行）
    it('改 GMAC code delay 與 regressor：波形上的 x[n−D] 與 filtered-x 的圖例名稱也是 LaTeX', async () => {
      const exp = container.querySelector('#exp-polarity-explorer') as HTMLElement
      const before = plotCalls.list.length
      fireEvent.change(within(exp).getByLabelText('GMAC code delay D', { selector: 'input[type="text"]' }), { target: { value: '3' } })
      fireEvent.change(within(exp).getByLabelText('GMAC regressor'), { target: { value: '1' } })
      await waitFor(() => expect(plotStringsSince(before)).toEqual(expect.arrayContaining([String.raw`$x[n-3]$（GMAC 用）`, String.raw`A：filtered-x $E[u_D\,u]$`, String.raw`A：目前 $D$`])), WAIT)
      expectPlotStringsLatex(plotStringsSince(before), 'D = 3、filtered-x')
    }, RENDER_TIMEOUT)

    it('整章（含展開的思考題解析與上面的互動之後）沒有 KaTeX 錯誤、沒有 React console error', () => {
      expectNoTexErrors(container)
      expect(errors).toEqual([])
    })
  })

  it('Beginner 模式也能渲染（推導框預設收合，Research 專屬段落隱藏）', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = renderChapter()
    const boxes = Array.from(container.querySelectorAll('details.ch06-stepbox')) as HTMLDetailsElement[]
    expect(boxes.length).toBeGreaterThan(5)
    expect(boxes.every((b) => !b.open)).toBe(true)
    expect(container.querySelector('[id="formula-F-06.16"]')).toBeNull() // research 專屬
    // 方塊圖不放在收合的推導框裡：Beginner 模式也看得到全部的圖（系統地圖 + 登錄的每一張），符號表仍在章末
    const figures = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figures.length).toBe(CH06_DIAGRAMS.length + 1)
    expect(figures.every((fig) => fig.closest('details') === null)).toBe(true)
    expect(container.querySelector('.ch06')!.lastElementChild!.id).toBe('symbols')
  }, RENDER_TIMEOUT)

  it('URL preset ?preset=polarity-omega-pi-edge 套用到 Polarity Explorer，並顯示 E46 警告', async () => {
    const { container } = renderChapter('/ch/06?preset=polarity-omega-pi-edge')
    const exp = container.querySelector('#exp-polarity-explorer') as HTMLElement
    // 參數經 250 ms debounce 後才重算
    await waitFor(
      () => {
        const w = warningsMatching(exp, /更新極性錯誤/)
        expect(w.length).toBeGreaterThan(0)
        expect(texSources(w[0])).toContain('C_D=-1')
      },
      WAIT,
    )
    const snapped = warningsMatching(exp, /已吸附為/)
    expect(snapped.length).toBeGreaterThan(0)
    expect(texSources(snapped[0])).toEqual(expect.arrayContaining(['\\Omega=\\pi', '180^\\circ']))
    expectNoTexErrors(exp)
  }, RENDER_TIMEOUT)

  it('URL preset ?preset=polarity-near-integer-basin：C > 0、線性 pole 穩定，但閉迴路離開 basin；警告解釋原因', async () => {
    const plotStart = plotCalls.list.length
    const { container } = renderChapter('/ch/06?preset=polarity-near-integer-basin')
    const exp = container.querySelector('#exp-polarity-explorer') as HTMLElement
    await waitFor(() => expect(exp.querySelectorAll('td[data-loop-state="left-basin"]').length).toBeGreaterThan(0), WAIT)
    expect(exp.querySelector('td[data-loop-state="left-basin"]')!.textContent).toMatch(/線性 pole 穩定，但離開了 basin/)
    // 模型的純文字警告（C > 0 只保證小訊號（|δ|·u_max ≪ σ_v）…已超過 δ_c）經 modelTextTex 後，數學都是 KaTeX
    const basinWarn = warningsMatching(exp, /只保證小訊號.*的極性正確.*已超過/)
    expect(basinWarn.length).toBeGreaterThan(0)
    expect(texSources(basinWarn[0])).toEqual(expect.arrayContaining(['C>0', '|\\delta|\\,u_{\\max}\\ll\\sigma_v', '\\delta_c', '\\delta=0']))
    expect(texSources(basinWarn[0]).some((t) => /^\\max\(\|\\delta_0\|,\\,3\\sigma_w\)=.+\\,\\mathrm\{fs\}$/.test(t))).toBe(true)
    expectNoUnicodeMath(basinWarn[0], 'basin 警告')
    expect(within(exp).getByText(/極性正確：平均收斂/)).toBeTruthy() // 小訊號判定仍是「極性正確」
    // 起始誤差在線性區外 ⇒ Monte Carlo 欄誠實地顯示 n/a 而不是 ok（說明裡的 |δ₀|、0.3σ_v/u_max 也已是 KaTeX）
    const outside = within(exp).getAllByText(/線性區不足 2 個 block/)
    expect(outside.length).toBeGreaterThan(0)
    for (const el of outside) {
      expect(texSources(el).some((t) => t.startsWith('|\\delta_0|='))).toBe(true)
      expectNoUnicodeMath(el, 'Monte Carlo 說明')
    }
    expect(exp.querySelectorAll('.c-check-mismatch').length).toBe(0)
    // PLL 模式的 Re{H} + PSD 與 Bode 圖：圖例與軸標題都是 LaTeX
    await waitFor(
      () =>
        expect(plotStringsSince(plotStart)).toEqual(
          expect.arrayContaining([
            String.raw`$\operatorname{Re}\,H_{\mathrm{PD}}(e^{j\Omega})$（DT）`,
            String.raw`$|H_{\mathrm{PD}}|$ [dB]`,
            String.raw`$\angle H_{\mathrm{PD}}$ [deg]`,
            String.raw`$\angle H$ CT 原型`,
            String.raw`$\Omega/(\omega_L T_s)$`,
            String.raw`A：線性 $\delta_0p^k$`,
            String.raw`A：mean-field $E[G](\delta)$`,
            String.raw`A：線性 $K_qC\,\delta$`,
          ]),
        ),
      WAIT,
    )
    expectPlotStringsLatex(plotStringsSince(plotStart), 'PLL 模式的圖')
    // PLL 模式的指標表（封閉式標籤、Monte Carlo 說明…）、警告、圖說：都沒有 Unicode 拼的數學
    expect(scanStringProps(exp)).toBeGreaterThan(30)
    expect(texSources(exp)).toEqual(expect.arrayContaining(['\\sigma_x^2\\sum_kh[k]\\,\\big(1-6t(1-t)\\big)']))
    expectNoRawDollar(exp, 'near-integer basin')
    expectNoTexErrors(exp)
  }, RENDER_TIMEOUT)

  it('URL preset ?preset=polarity-fcw-delay1 套用到 FCW sweep：顯示 F-06.18 的變號門檻與 C ≤ 0 的原因', async () => {
    const { container } = renderChapter('/ch/06?preset=polarity-fcw-delay1')
    const sweep = container.querySelector('#exp-polarity-fcw-sweep') as HTMLElement
    await waitFor(() => expect(within(sweep).getAllByText(/近整數變號門檻/).length).toBeGreaterThan(0), WAIT)
    const lag = warningsMatching(sweep, /GMAC regressor 落後/)
    expect(lag.length).toBeGreaterThan(0)
    expect(texSources(lag[0])).toEqual(expect.arrayContaining(['C\\le0', 'D=1']))
    expect(lag[0].textContent).toMatch(/個 sample——鋸齒自相關的一次項不再被 Type-II 消掉/)
    expect(warningsMatching(sweep, /MASH 1-1-1 residue 的/).length).toBeGreaterThan(0)
    expectNoRawDollar(sweep, 'fcw sweep D = 1')
    expectNoTexErrors(sweep)
    expect(sweep.querySelectorAll('.c-check-mismatch').length).toBe(0)
  }, RENDER_TIMEOUT)
})

/** 字串屬性裡每一段 `$...$` 都能被 KaTeX 解析，而且 `$` 成對 */
const INLINE_MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
function expectMathString(text: string, where: string): void {
  expect(text.replace(INLINE_MATH, ''), `${where}：有落單的 $`).not.toContain('$')
  for (const m of text.matchAll(INLINE_MATH)) expect(renderTex(m[1], false), `${where}：${m[1]}`).not.toContain('katex-error')
}

describe('字串屬性的 LaTeX（docs/teaching-style.md §3）', () => {
  it('FORMULAS 的 title／conditions：數學寫成 $...$ 且全部可渲染，不再用 Unicode 拼公式', () => {
    for (const f of FORMULAS) {
      expectMathString(f.title, `${f.id} title`)
      expectMathString(f.conditions, `${f.id} conditions`)
      // 拿掉 $...$ 之後不應殘留希臘字母、上下標或數學運算符號
      const plain = `${f.title} ${f.conditions}`.replace(INLINE_MATH, '')
      expect(plain, f.id).not.toMatch(/[α-ωΑ-Ω≤≥≈≪≫√∫Σ²³₀-₉·]|_[a-zA-Z{]/)
    }
    expect(FORMULAS.filter((f) => f.conditions.includes('$')).length).toBeGreaterThan(12)
  })

  it('F-06.6 的適用條件寫明全站的架構約定：DTC 在 reference 輸入端，誤差從 PD 的 reference 輸入端進來，e_PD = ε − φ_fb = +H_PD·ε', () => {
    const f = FORMULAS.find((x) => x.id === 'F-06.6')!
    expect(f.tex).toBe(String.raw`H_{\mathrm{PD}}=\frac{1}{1+L}`)
    expect(f.conditions).toMatch(/DTC 在 reference 輸入端/)
    expect(f.conditions).toMatch(/從 PD 的 reference 輸入端進來/)
    expect(f.conditions).toContain(String.raw`$e_{\mathrm{PD}}=\varepsilon-\varphi_{\mathrm{fb}}=H_{\mathrm{PD}}\,\varepsilon$`)
    expect(f.conditions).toMatch(/正號/)
    // 全章的公式登錄都沒有把誤差算在 feedback 那一邊的寫法（−H_PD·ε、−T·ε）
    for (const x of FORMULAS) expect(`${x.tex} ${x.conditions}`, x.id).not.toMatch(/=\s*-\s*H_\{\\mathrm\{PD\}\}\\,\\varepsilon|=\s*-\s*T\\,\\varepsilon/)
  })

  it('polarityWarnings／verdict：三種情況都解釋原因，數字用 TeX 記號（不會出現 1e-5 這種字樣）', () => {
    const neg = polarityWarnings('Case A — ', -0.25, 'negative', 0.0079788456, 10)
    expect(neg).toHaveLength(1)
    expect(neg[0].startsWith('Case A — $C\\le0$：更新極性錯誤')).toBe(true)
    expect(neg[0]).toContain('$C_D=-0.25$')
    expect(neg[0]).toContain('=1.01995>1$')
    expect(neg[0]).toMatch(/只減小 \$\\mu\$ 不會改變符號/)
    const tiny = polarityWarnings('', -2.5e-6, 'negative', 0.008, 10)[0]
    expect(tiny).toContain('-2.5\\times10^{-6}')
    expect(tiny).not.toMatch(/\de-\d/)
    const zero = polarityWarnings('', 3e-17, 'zero', 0.008, 10)[0]
    expect(zero).toMatch(/沒有平均恢復力/)
    const osc = polarityWarnings('', 0.5, 'positive', 0.008, 600)[0]
    expect(osc).toContain('\\ge2')
    expect(polarityWarnings('', 0.5, 'positive', 0.008, 10)).toEqual([])
    for (const w of [neg[0], tiny, zero, osc]) expectMathString(w, w.slice(0, 20))
    const texts = [verdict('negative', 1.02), verdict('zero', 1), verdict('positive', -1.2), verdict('positive', 0.9)]
    expect(texts.map((v) => v.tone)).toEqual(['neg', 'zero', 'neg', 'pos'])
    for (const v of texts) expectMathString(v.text, v.text)
    expect(texts[0].text).toContain('$\\mu>0$')
  })
})

describe('modelTextTex：polarity.ts 的純文字警告／說明／標籤 → `$...$`', () => {
  /** 轉換後：`$` 成對且每段都能渲染、`$...$` 以外沒有 Unicode 數學、重複套用不變 */
  const convert = (raw: string): string => {
    const tex = modelTextTex(raw)
    expectMathString(tex, raw)
    expect(tex.replace(INLINE_MATH, ''), `還有沒轉成 LaTeX 的數學：${raw}`).not.toMatch(UNICODE_MATH)
    expect(modelTextTex(tex), `重複套用應不變：${raw}`).toBe(tex)
    return tex
  }
  const P: PolarityParams = { ...DEFAULT_POLARITY_PARAMS, mode: 'pll' }

  it('designPolarityLoop：主 PLL 不穩定（Type-I／Type-II）、ω_LT_s 不夠小（E44）', () => {
    const typeII = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.4, loopDelay: 0 })
    expect(typeII.stable).toBe(false)
    const [unstable, coarse] = typeII.warnings.map(convert)
    expect(unstable).toMatch(/半徑 \$[\d.]+\\ge1\$（\$\\omega_LT_s=[\d.]+\$、\$d=0\$）/)
    expect(unstable).toContain('不穩定時 $H_{\\mathrm{PD}}$ 沒有意義，$C$ 與極性結論都不成立。')
    expect(coarse).toContain('（$K_p=2\\zeta\\omega_nT_s$、$K_i=(\\omega_nT_s)^2$）')
    const typeI = designPolarityLoop({ type: 'typeI', zeta: 0.7, wLTs: 1.5, loopDelay: 2 })
    expect(typeI.stable).toBe(false)
    expect(convert(typeI.warnings[0])).toContain('Type-I 需 $K=\\omega_cT_s<2\\sin\\!\\big(\\pi/(4d+2)\\big)=0.6180$。')
    // 穩定、ω_LT_s 小：沒有警告
    expect(designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 }).warnings).toEqual([])
  })

  it('analyzePllPolarity：各種 code 的封閉式標籤與警告（C ≤ 0、C ≈ 0、Ω = π、frac ≈ p/q、週期太長）', () => {
    const wL = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 }).wLTs
    const run = (patch: Partial<PolarityParams>) => analyzePllPolarity({ ...P, ...patch, seed: 20261010 })
    const tone = run({ code: 'tone' })
    expect(convert(tone.C.theoryLabel)).toBe('$\\sigma_x^2\\operatorname{Re}\\{H(e^{j\\Omega_0})e^{j\\Omega_0D}\\}$（單頻封閉式）')
    const neg = tone.warnings.find((w) => w.startsWith('C ≤ 0'))!
    expect(convert(neg)).toMatch(/^\$C\\le0\$：更新極性錯誤（\$C_D=-0\.0\d+\$，以 \$\\sigma_x\^2=[\d.]+\$ 正規化）.*只減小 \$\\mu\$ 不會改變符號/)
    expect(convert(run({ code: 'iid' }).C.theoryLabel)).toBe('$h[D]\\,\\sigma_x^2$（白色 code；$D=0$ 時 $h[0]=1\\Rightarrow C=\\sigma_x^2$，E44）')
    // MASH 沒有封閉式：標籤沒有數學，原樣保留
    const mash = run({ code: 'mash' }).C.theoryLabel
    expect(convert(mash)).toBe(mash)
    expect(convert(run({ code: 'dsm1', frac: 0.25 }).C.theoryLabel)).toContain('$\\sigma_x^2\\sum_kh[k]\\,\\big(1-6c\\,t(1-t)\\big)$，$c=P^2/(P^2-1)$、$P=4$（')
    expect(convert(run({ code: 'dsm1', frac: 0.002 }).C.theoryLabel)).toContain('；$t=\\operatorname{frac}(|k-D|\\cdot\\mathrm{frac})$）')
    const clustered = run({ code: 'dsm1', frac: 0.33333 })
    expect(convert(clustered.C.theoryLabel)).toMatch(/，\$c=[\d.]+\$（\$\\mathrm\{frac\}\\approx p\/3\$：/)
    const near = clustered.warnings.map(convert).find((w) => w.includes('很接近'))!
    expect(near).toMatch(/^\$\\mathrm\{frac\}=0\.33333\d*\$ 很接近 \$p\/3\$：DSM 的真實週期 \$\d+\$ 大於分析長度 \$\d+\$，/)
    // frac = 5e−6：code 週期 2×10⁵ samples 超過分析長度上限的 1/4，C_D = 2.40e-7（toPrecision 的 e 記號）也要轉成 ×10^{-7}
    const tiny = run({ code: 'dsm1', frac: 5e-6 }).warnings.map(convert)
    // R01：C ≈ 0 時 a + B/C 只是線性化的值——顯示成「線性化的 a + B/C … 只是線性外推、不是固定點（Ch11 §11.4 的代回檢查）」，不再寫無條件的「固定點 w* = a + B/C」
    const NEAR_ZERO = /^\$C\\approx0\$：GMAC 沒有平均恢復力（\$C_D=\d\.\d+\\times10\^\{-7\}\$），\$w\$ 會隨雜訊漂移；線性化的 \$a\+B\/C\$ 對任何 bias \$B\$ 都極度敏感，\$C\\approx0\$ 時 \$B\/C\$ 通常已經超出線性範圍，\$a\+B\/C\$ 只是線性外推、不是固定點（Ch11 §11\.4 的代回檢查）。$/
    expect(tiny.some((w) => NEAR_ZERO.test(w))).toBe(true)
    expect(tiny.join('\n')).not.toMatch(/固定點 \$w\^\*=a\+B\/C\$/)
    // 模型字串本身（polarity.ts）也已經寫成「線性化的固定點 w* ≈ a + B/C …（§11.4 的代回檢查：…）」
    const rawTiny = run({ code: 'dsm1', frac: 5e-6 }).warnings.find((w) => w.startsWith('C ≈ 0')) as string
    expect(rawTiny).toContain('線性化的固定點 w* ≈ a + B/C 對任何 bias B 都極度敏感（§11.4')
    expect(rawTiny).not.toContain('；固定點 w* = a + B/C')
    // 同一條規則接得住模型現在的寫法、舊的寫法與較短的寫法，輸出同一句
    for (const model of [
      'C ≈ 0：GMAC 沒有平均恢復力（C_D = 2.40e-7），w 會隨雜訊漂移；線性化的固定點 w* ≈ a + B/C 對任何 bias B 都極度敏感（§11.4 的代回檢查：B/C 大到超出線性範圍時只是線性外推，不再是固定點）。',
      'C ≈ 0：GMAC 沒有平均恢復力（C_D = 2.40e-7），w 會隨雜訊漂移；固定點 w* = a + B/C 對任何 bias B 都極度敏感（§11.4）。',
      'C ≈ 0：GMAC 沒有平均恢復力（C_D = 2.40e-7），w 會隨雜訊漂移；線性化的固定點 w* ≈ a + B/C 對任何 bias B 都極度敏感（§11.4 的代回檢查）。',
      'C ≈ 0：GMAC 沒有平均恢復力（C_D = 2.40e-7），w 會隨雜訊漂移；線性化的 w* ≈ a + B/C 對任何 bias B 都極度敏感（§11.4）。',
    ]) expect(convert(model), model).toMatch(NEAR_ZERO)
    expect(tiny.some((w) => w.includes('個週期：$C$ 的時間平均尚未收斂'))).toBe(true)
    const nyq = run({ code: 'tone', toneRatio: Math.PI / wL }).warnings.map(convert)
    expect(nyq).toContain('tone 的 $\\Omega$ 落在 $\\pi$（Nyquist）：此時 $x$ 為 $\\pm1$ 交替序列，E46 的 2 倍公式以 $\\sigma_x^2$ 表示仍為 $C=\\sigma_x^2\\,H(e^{j\\pi})$。')
  }, RENDER_TIMEOUT)

  it('runPolarityClosedLoop：時間尺度分離、有限 N、basin、起始誤差過大的警告，以及 Monte Carlo 說明', () => {
    const loop = (patch: Partial<PolarityParams>) => runPolarityClosedLoop({ cases: [{ ...P, ...patch, id: 'A' }], seed: 20261010, chains: 4, reference: false }).results[0]
    // N = 64 遠小於主 PLL 的記憶長度，也不到一個 code 週期（frac = 0.002 ⇒ 500 samples）
    const short = loop({ code: 'dsm1', frac: 0.002, N: 64, blocks: 60 })
    const sw = short.warnings.map(convert)
    expect(sw.some((w) => /^GMAC block 長度 \$N=64\$ 不到主 PLL 記憶長度（\$\\approx1\/\(1-\|\\mathrm\{pole\}\|\)=\d+\$ samples）的 3 倍：\$w\$ 在 \$H_\{\\mathrm\{PD\}\}\$ 的記憶內不是常數，\$e\\approx\\delta\\,u\$（/.test(w))).toBe(true)
    expect(sw.some((w) => w.startsWith('一個 GMAC block（$N=64$）不到一個 code 週期（$\\approx500$ samples）：逐 block 的 $\\hat C_k$ 會') && w.endsWith('（E46 的有限 $N$ ripple），多個 block 平均後才回到長時間平均的 $C$。'))).toBe(true)
    expect(convert(short.check.note)).toMatch(/^\$k\^\*=\d+\$：MC 平均 \$\\delta=-?[\d.]+\\,\\mathrm\{fs\}\$ vs 線性 \$\\delta_0\\prod_kp_k=-?[\d.]+\\pm[\d.]+\$（\$4\\sigma\/\\sqrt R\$，4 chains）/)
    expect(convert(short.check.note)).toMatch(/\$\\langle\\delta\^2\\rangle\/\(m\^2\+v\)=[\d.]+\$（容許 \$[\d.]+\$–\$[\d.]+\$）/)
    // 起始誤差在 basin 之外（preset polarity-near-integer-basin 的精簡版）
    const basin = loop({ code: 'dsm1', frac: 0.002, mu: 50, w0: -150, blocks: 60 })
    const bw = basin.warnings.map(convert)
    expect(bw.some((w) => w.startsWith('$C>0$ 只保證小訊號（$|\\delta|\\,u_{\\max}\\ll\\sigma_v$）的極性正確：mean-field 特性 $E[G](\\delta)$ 在 $|\\delta|>\\delta_c=') && w.includes('已超過 $\\delta_c$：') && w.includes('（降低 $\\mu$ 可縮小 $\\sigma_w$，但救不了 $|\\delta_0|>\\delta_c$ 的起始誤差）'))).toBe(true)
    expect(bw.some((w) => /^初始誤差 \$\|\\delta_0\|\\,u_\{\\mathrm\{rms\}\}=[\d.]+\\,\\mathrm\{fs\}\$ 已接近 \$\\sigma_v\$：\$K_q\$ 小訊號線性化不準/.test(w))).toBe(true)
    expect(basin.check.status).toBe('n/a')
    expect(convert(basin.check.note)).toMatch(/^線性區不足 2 個 block（\$\|\\delta_0\|=153\\,\\mathrm\{fs\}\$，線性區上限 \$0\.3\\sigma_v\/u_\{\\max\}=[\d.]+\\,\\mathrm\{fs\}\$）：\$K_q\$ 小訊號模型不適用/)
  }, RENDER_TIMEOUT)

  it('linearMomentCheck 的兩種說明（δ₀p^k／含 ✗ 與負數）、sweepFcwPolarity 的警告；toPrecision 的 e 記號轉成 ×10^n', () => {
    const R = 8
    const K = 40
    const pole = 0.98
    const mu = 10
    const noiseVar = 0.5 / 1024
    const m = Float64Array.from({ length: K + 1 }, (_, k) => 10 * pole ** k)
    const v = new Float64Array(K + 1)
    for (let k = 1; k <= K; k++) v[k] = pole * pole * v[k - 1] + mu * mu * noiseVar
    const input = { d0: 10, pole, mu, noiseVar, linearLimit: 30, chains: R }
    const ok = linearMomentCheck({ ...input, sum: m.map((x) => R * x), sumSq: m.map((x, k) => R * (x * x + v[k])) })
    expect(ok.status).toBe('ok')
    expect(convert(ok.note)).toMatch(/^\$k\^\*=40\$：MC 平均 \$\\delta=[\d.]+\\,\\mathrm\{fs\}\$ vs 線性 \$\\delta_0p\^k=[\d.]+\\pm[\d.]+\$（\$4\\sigma\/\\sqrt R\$，8 chains）；/)
    // 平均值反號、均方大 100 倍 ⇒ 兩項都標 ✗；負數與 ✗ 都保留
    const bad = linearMomentCheck({ ...input, sum: m.map((x) => -R * x), sumSq: m.map((x, k) => 100 * R * (x * x + v[k])) })
    expect(bad.status).toBe('mismatch')
    const badTex = convert(bad.note)
    expect(badTex).toMatch(/MC 平均 \$\\delta=-[\d.]+\\,\\mathrm\{fs\}\$/)
    expect(badTex.match(/✗/g)).toHaveLength(2)
    // FCW 掃描：分析長度不足的掃描點（frac 的門檻以 toExponential 輸出，例如 6.10e-5）
    const sw = sweepFcwPolarity({ loopType: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0, delay: 0, fracMin: 1e-5, fracMax: 0.5, points: 6 } as unknown as FcwSweepParams)
    const short = sw.warnings.find((w) => w.includes('分析長度不足'))!
    expect(short).toMatch(/frac < \d\.\d\de-\d/)
    expect(convert(short)).toMatch(/（\$\\mathrm\{frac\}<\d\.\d\d\\times10\^\{-\d\}\$）/)
    // 大數：max(|δ₀|, 3σ_w) = 2.67e+3 fs（toPrecision(3)）
    expect(convert('目前 max(|δ₀|, 3σ_w) = 2.67e+3 fs 已超過 δ_c：')).toBe('目前 $\\max(|\\delta_0|,\\,3\\sigma_w)=2.67\\times10^{3}\\,\\mathrm{fs}$ 已超過 $\\delta_c$：')
  }, RENDER_TIMEOUT)

  it('不認得的文字、已經是 LaTeX 的字串、`$...$` 內的片段都原樣保留', () => {
    expect(modelTextTex('blockLms 參考模型無法執行：某個錯誤訊息')).toBe('blockLms 參考模型無法執行：某個錯誤訊息')
    expect(modelTextTex('')).toBe('')
    // 本章自己寫的 LaTeX 警告／判定不會被動到
    for (const w of [...polarityWarnings('Case A — ', -0.25, 'negative', 0.008, 10), ...polarityWarnings('', 3e-17, 'zero', 0.008, 10), ...polarityWarnings('', 0.5, 'positive', 0.008, 600), verdict('negative', 1.02).text]) {
      expect(modelTextTex(w)).toBe(w)
    }
    // `$...$` 裡出現的 H_PD、N = 64 不會被二次改寫；外面的才換
    expect(modelTextTex('$H_PD$ 與 H_PD、$N = 64$ 與 N = 64')).toBe('$H_PD$ 與 $H_{\\mathrm{PD}}$、$N = 64$ 與 $N=64$')
    // 變數名稱結尾剛好是 N 的識別字不算（例如 REG_GMAC_N = 4）
    expect(modelTextTex('REG_GMAC_N = 4')).toBe('REG_GMAC_N = 4')
  })
})

/** 圖內字串與控制項字串的 LaTeX（2026-10-11）：整份原始碼掃描，不依賴畫面上剛好走到哪個分支 */
function expectPlotStringsLatex(strings: string[], where: string): void {
  for (const text of strings) {
    expectMathString(text, `${where}：${text}`)
    expect(text.replace(INLINE_MATH, ''), `${where}：還有沒轉成 LaTeX 的數學：${text}`).not.toMatch(UNICODE_MATH)
    expect(plotMath(text), `${where}：plotMath 沒轉乾淨：${text}`).not.toMatch(/[\\${}]/)
  }
}

describe('圖內與控制項字串的 LaTeX（原始碼掃描）', () => {
  const FILES = [
    'experiments/ExplorerPlots.tsx',
    'experiments/CtDtExperiment.tsx',
    'experiments/FcwSweepExperiment.tsx',
    'experiments/PolarityExplorer.tsx',
    'sections/S5LoopTypes.tsx',
  ]
  // Plot 的 trace name、軸標題 title.text、annotation text、ticktext…，MetricRow 的 name／unit，ExperimentShell／Plot 的 title，ParamControl 的 unit
  const LITERAL = /\b(name|text|title|unit|ticktext|hovertemplate|texttemplate|hovertext)\s*[:=]\s*\{?\s*(?:String\.raw)?(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g

  it('Plot 與指標的 name／text／title／unit 字串：原始碼裡的數學都寫成 $...$（沒有 Unicode 拼的 σ_v、δ²、Re{H}、fs⁻¹、x[n − D] …）', () => {
    let scanned = 0
    let withMath = 0
    for (const file of FILES) {
      const src = readFileSync(resolve(process.cwd(), 'src/chapters/ch06', file), 'utf8')
      for (const m of src.matchAll(LITERAL)) {
        // 樣板字串裡的 ${…}（case id、D、loopDelay 等）換成一個數字
        const text = m[2].slice(1, -1).replace(/\$\{[^}]*\}/g, '1')
        scanned++
        if (text.includes('$')) withMath++
        const where = `${file}：${m[1]}`
        expectMathString(text, `${where}：${text}`)
        expect(text.replace(INLINE_MATH, ''), `${where}：還有沒轉成 LaTeX 的數學：${text}`).not.toMatch(UNICODE_MATH)
        expect(text.replace(INLINE_MATH, ''), `${where}：還有沒轉成 LaTeX 的數學：${text}`).not.toMatch(/[ℓĥ∞∠⇒]/)
      }
    }
    expect(scanned).toBeGreaterThan(100)
    expect(withMath).toBeGreaterThan(60)
  })

  it('動態產生的圖例名稱（FCW 放大圖的漸近線）也是 LaTeX，而且 plotMath 轉得乾淨', () => {
    const names = [fcwZoomAsymptoteName(0, true), fcwZoomAsymptoteName(0, false), fcwZoomAsymptoteName(2, true)]
    expect(new Set(names).size).toBe(3)
    expectPlotStringsLatex(names, 'fcwZoomAsymptoteName')
    expect(plotMath(names[0])).toBe('動差展開 = 3/<i>π</i><sup>2</sup>Δ<sup>2</sup>')
  })
})

describe('公式登錄與 presets', () => {
  it('FORMULAS：ID 唯一、格式 F-06.n、頁面 /ch/06、TeX 非空', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-06\.\d+$/)
      expect(f.page).toBe('/ch/06')
      expect(f.tex.length).toBeGreaterThan(10)
      expect(['exact', 'approx', 'research']).toContain(f.claim)
    }
    expect(FORMULAS.filter((f) => f.erratumId === 'E44').length).toBeGreaterThan(0)
    expect(FORMULAS.filter((f) => f.erratumId === 'E46').length).toBeGreaterThan(0)
  })

  it('polarity*.json：欄位完整、實驗 id 正確、Gallery #3 存在；explorer 參數可完整還原', () => {
    const dir = resolve(process.cwd(), 'src/data/presets')
    const files = readdirSync(dir).filter((f) => f.startsWith('polarity') && f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(8)
    const all = files.map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as PresetEntry)
    for (const p of all) {
      expect(`${p.id}.json`).toBe(files.find((f) => f === `${p.id}.json`))
      expect(p.page).toBe('/ch/06')
      expect(EXPERIMENTS).toContain(p.experiment)
      expect(p.title.length).toBeGreaterThan(4)
      expect(p.expected.length).toBeGreaterThan(10)
      if (p.experiment === 'polarity-explorer') {
        const full = withDefaults(p.params)
        for (const v of Object.values(full)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
        // preset 中的每個 key 都是合法參數（不會被默默丟掉）
        for (const k of Object.keys(p.params)) expect(full).toHaveProperty(k, p.params[k])
      }
    }
    const g3 = all.find((p) => p.galleryIndex === 3)
    expect(g3?.experiment).toBe('polarity-explorer')
    expect(g3?.tests).toContain('T06')
    expect((g3?.params as { phiDeg: number }).phiDeg).toBe(120)
  })

  it('§7「試試看」：regressor 選 filtered-x u 時 Lab 算的是 E[u_D·u]——D 留在 8 會得到 −0.25（反向更新），D 調回 0 才是 E[u²] = 0.5', () => {
    // 文字照順序做：先把 D 調到 8（delay alignment），再把 regressor 換成 filtered-x。Ĥ = H 但 D ≠ 0 時相關是 (A|H|)²/2·cos(ΩD)
    const base = { mode: 'tone', phiDeg: 120, omega: Math.PI / 6, regressor: 'u' }
    const d8 = analyzeTone(withDefaults({ ...base, D: 8 }))
    expect(d8.Cfx).toBeCloseTo(-0.25, 12)
    expect(d8.Cfx).toBeCloseTo(0.5 * Math.cos((8 * Math.PI) / 6), 12)
    expect(d8.Ceff).toBe(d8.Cfx)
    expect(d8.pole).toBeCloseTo(1.019947, 6)
    expect(d8.Cfx.toFixed(3)).toBe('-0.250') // 頁面上印出來的字樣
    // 對照：D = 0 ⇒ E[u²] = A²|H|²/2 = 0.5 ≥ 0，pole < 1
    const d0 = analyzeTone(withDefaults({ ...base, D: 0 }))
    expect(d0.Cfx).toBeCloseTo(0.5, 12)
    expect(d0.pole).toBeCloseTo(0.960106, 6)
    expect(d0.pole).toBeLessThan(1)
  })

  it('T06: preset 的 expected 文字裡的數字就是模擬算出來的（不是手打的假數字）', () => {
    const dir = resolve(process.cwd(), 'src/data/presets')
    const load = (id: string): PresetEntry => JSON.parse(readFileSync(resolve(dir, `${id}.json`), 'utf8')) as PresetEntry
    /** 文字必須包含這個數值（指定小數位或有效位數的格式） */
    const quoted = (id: string, text: string, value: number, fmt: (v: number) => string): void => {
      expect(text, `${id}：expected 應包含 ${fmt(value)}`).toContain(fmt(value))
    }
    const fixed = (d: number) => (v: number) => v.toFixed(d)
    const loop = (id: string) => {
      const p = load(id)
      const r = runPolarityClosedLoop({ cases: [{ ...withDefaults(p.params), id: 'A' }], seed: 20261010, chains: 8, reference: false }).results[0]
      return { p, r, end: r.deltaMean[r.deltaMean.length - 1] }
    }
    // Gallery #3
    {
      const { p, r, end } = loop('polarity-phase120')
      quoted(p.id, p.expected, r.pole, fixed(7)) // 1.0199471
      quoted(p.id, p.expected, end, (v) => `+${Math.round(v)} fs`) // +715 fs
      quoted(p.id, p.expected, r.deltaChains[0][400], (v) => `${Math.round(v)} fs`) // 733 fs
      quoted(p.id, p.expected, 10 * Math.abs(r.largeErrorGain), fixed(2)) // 3.11 fs/block
      expect(Math.abs(r.driftSlope - r.driftPred)).toBeLessThan(r.driftTol)
    }
    {
      const { p, r, end } = loop('polarity-phase90-zero')
      quoted(p.id, p.expected, end, fixed(1)) // 2.9 fs
      expect(Math.abs(r.pole - 1)).toBeLessThan(1e-12)
    }
    {
      const { p, r, end } = loop('polarity-delay-d8')
      quoted(p.id, p.expected, r.pole, fixed(6)) // 0.960106
      quoted(p.id, p.expected, end, fixed(2)) // 0.64 fs
      quoted(p.id, p.expected, r.sigmaWPred, fixed(2)) // 0.79 fs
    }
    {
      const { p, r } = loop('polarity-omega-pi-edge')
      expect(r.C).toBeCloseTo(-1, 12)
      quoted(p.id, p.expected, r.pole, fixed(7)) // 1.0797885
      expect(r.diverging).toBe(true)
    }
    {
      const { p, r } = loop('polarity-type2-low-tone')
      quoted(p.id, p.expected, r.C, (v) => `−${Math.abs(v).toFixed(4)}`) // −0.0814
      quoted(p.id, p.expected, r.pole, fixed(3)) // 1.065
      expect(r.diverging).toBe(true)
    }
    {
      const { p, r } = loop('polarity-type1-low-tone')
      quoted(p.id, p.expected, r.C, (v) => `+${v.toFixed(4)}`) // +0.0804
      quoted(p.id, p.expected, r.pole, fixed(3)) // 0.936
      expect(r.diverging).toBe(false)
    }
    {
      const { p, r } = loop('polarity-white-iid')
      quoted(p.id, p.expected, r.C, fixed(3)) // 1.000
      quoted(p.id, p.expected, r.pole, fixed(4)) // 0.9202
    }
    {
      const p = load('polarity-near-integer-dsm')
      const a = analyzePllPolarity({ ...(withDefaults(p.params) as ReturnType<typeof withDefaults>), seed: 20261010 })
      quoted(p.id, p.expected, a.C.empirical, fixed(4)) // 0.0505（時域；Explorer 指標表顯示的值）
      quoted(p.id, p.expected, a.C.theory!, fixed(4)) // 0.0510（封閉式）
      quoted(p.id, p.expected, a.C.sigma2, fixed(3)) // σ_x² ≈ 0.999
      const { r } = loop(p.id)
      quoted(p.id, p.expected, r.pole, fixed(4)) // 0.9959
      quoted(p.id, p.expected, r.sCurve.cross!, fixed(1)) // 76.7 fs
      expect(r.diverging).toBe(false)
    }
    {
      const { p, r } = loop('polarity-near-integer-delay')
      const a = analyzePllPolarity({ ...withDefaults(p.params), seed: 20261010 })
      quoted(p.id, p.expected, a.C.empirical, (v) => `−${Math.abs(v).toFixed(3)}`) // −0.018
      quoted(p.id, p.expected, a.C.theory!, (v) => `−${Math.abs(v).toFixed(4)}`) // −0.0178
      quoted(p.id, p.expected, 0.002 / a.design.Ki, fixed(2)) // 2.13
      quoted(p.id, p.expected, r.pole, fixed(3)) // 1.021
      quoted(p.id, p.expected, r.driftSlope, fixed(1)) // 24.0
      quoted(p.id, p.expected, r.driftPred, fixed(1)) // 24.1
      quoted(p.id, p.expected, 150 * Math.abs(r.largeErrorGain), fixed(1)) // 2.4
      expect(r.diverging).toBe(true)
    }
    {
      const { p, r, end } = loop('polarity-near-integer-basin')
      quoted(p.id, p.expected, r.pole, fixed(4)) // 0.9796
      quoted(p.id, p.expected, r.sCurve.cross!, fixed(1)) // 76.7
      quoted(p.id, p.expected, end, (v) => `${Math.round(v)} fs`) // 2672 fs
      quoted(p.id, p.expected, r.driftSlope, fixed(2)) // 6.94
      quoted(p.id, p.expected, r.driftPred, fixed(2)) // 7.07
      quoted(p.id, p.expected, r.sigmaWPred, fixed(1)) // 7.8
      expect(r.diverging).toBe(true)
      const inn = runPolarityClosedLoop({ cases: [{ ...withDefaults(p.params), w0: 0, id: 'B' }], seed: 20261010, chains: 8, reference: false }).results[0]
      expect(inn.diverging).toBe(false)
    }
    // CT ↔ DT
    {
      const p = load('polarity-ctdt-e44')
      const c = compareCtDt({ type: 'typeII', zeta: 0.7, wLTs: 0.3, loopDelay: 1 })
      quoted(p.id, p.expected, c.dtBoundaryNu!, fixed(4)) // 1.4926
      quoted(p.id, p.expected, c.dtPhaseAt03, fixed(2)) // 161.28
      quoted(p.id, p.expected, c.whiteNaiveCt, fixed(4)) // 0.7988
    }
    {
      const p = load('polarity-ctdt-typeI-latency')
      const c = compareCtDt({ type: 'typeI', zeta: 0.7, wLTs: 0.8, loopDelay: 1 })
      expect(c.design.stable).toBe(true)
      quoted(p.id, p.expected, c.design.lowFreqCoef, (v) => `−${Math.abs(v).toFixed(1)}`) // −0.2
      const sb = reSignBands(c.design, { lo: 1e-4, hi: Math.PI, points: 3000, log: true })
      quoted(p.id, p.expected, sb.negative[0][1] / 0.8, fixed(3)) // 0.903
    }
    // FCW sweep（D = 0 與 D = 1）
    {
      const p = load('polarity-fcw-near-integer')
      const sw = sweepFcwPolarity(p.params as unknown as FcwSweepParams)
      quoted(p.id, p.expected, sw.dsm1[0], fixed(5)) // 0.00115
      expect(sw.sawTheory[0].toFixed(5)).toBe(sw.dsm1[0].toFixed(5))
      quoted(p.id, p.expected, sw.moments[2], fixed(2)) // 2126.83
      quoted(p.id, p.expected, Math.min(...sw.triangle), (v) => `−${Math.abs(v).toFixed(3)}`) // −0.198
      quoted(p.id, p.expected, Math.min(...sw.mash), fixed(3)) // 1.022
      quoted(p.id, p.expected, sw.basin[0], fixed(2)) // 0.23
      const lastBasin = Array.from(sw.basin).filter((v) => Number.isFinite(v)).pop()!
      quoted(p.id, p.expected, lastBasin, fixed(1)) // 3.2
    }
    {
      const p = load('polarity-fcw-delay1')
      const sw = sweepFcwPolarity(p.params as unknown as FcwSweepParams)
      quoted(p.id, p.expected, sw.fracFlip, (v) => v.toExponential(2).replace('e-', 'e−')) // 9.40e−4
      quoted(p.id, p.expected, sw.dsm1[0], (v) => `−${Math.abs(v).toFixed(5)}`) // −0.00245
      quoted(p.id, p.expected, Math.min(...sw.dsm1), (v) => `−${Math.abs(v).toFixed(2)}`) // −0.51
      quoted(p.id, p.expected, Math.min(...sw.mash), (v) => `−${Math.abs(v).toFixed(2)}`) // −0.70
      quoted(p.id, p.expected, Math.min(...sw.triangle), (v) => `−${Math.abs(v).toFixed(2)}`) // −0.96
    }
  }, FULL_TIMEOUT)
})
