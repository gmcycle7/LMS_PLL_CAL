import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { extractRegion, plotMath } from '@/components'
import type { PresetEntry } from '@/data/types'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import { calLoop, codeSpectraAnalytic, mixingCrossCheck, runNoiseLab, simulateMixing } from '@/simulation/models/calNoise'
import Chapter12 from './index'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { CH12_CHARTS, CH12_SYSTEM_FOCUS } from './diagrams'
import { CH12_SYMBOLS } from './symbols'
import { CODE_SPECTRA_DEFAULTS } from './experiments/CodeSpectraLab'
import { MIX_DEFAULTS } from './experiments/CodeMixingLab'
import { NOISE_LAB_DEFAULTS } from './experiments/LmsNoiseLab'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
/** 每個 <Plot> 在轉成 Plotly 之前的原始 data / layout（含 `$...$`）：用來檢查圖內文字的數學都寫成 LaTeX */
const PM = vi.hoisted(() => ({ calls: [] as { data: unknown; layout: unknown }[] }))
vi.mock('@/components/plotMath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/plotMath')>()
  return {
    ...actual,
    applyPlotMath: (data: unknown, layout: unknown) => {
      PM.calls.push({ data, layout })
      return actual.applyPlotMath(data, layout)
    },
  }
})
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  },
}))

const CH_DIR = resolve(process.cwd(), 'src/chapters/ch12')
const PRESET_DIR = resolve(process.cwd(), 'src/data/presets')

function chapterSources(): string {
  const files = ['index.tsx', ...readdirSync(resolve(CH_DIR, 'sections')).map((f) => `sections/${f}`), ...readdirSync(resolve(CH_DIR, 'experiments')).map((f) => `experiments/${f}`)]
  return files.map((f) => readFileSync(resolve(CH_DIR, f), 'utf8')).join('\n')
}

function renderChapter(path = '/ch/12') {
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[path]}>
        <Chapter12 />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

/**
 * 整章渲染 + 三個實驗的自動計算平常只要幾秒；和其他測試平行跑、機器滿載時可能慢一個數量級，
 * 所以等待上限留很大的餘裕（只影響逾時，不影響任何斷言）。
 */
const T_TEST = 300000
const T_WAIT = 120000
/**
 * 每個測試結束時 testing-library 的自動 cleanup（afterEach hook）要卸載整章；機器滿載時 10 s 的預設 hook 逾時不夠
 *（曾出現「Hook timed out in 10000ms」）。hook 的逾時在註冊當下決定，所以要在 import 之前設定（vi.hoisted）。
 */
vi.hoisted(() => vi.setConfig({ hookTimeout: 120000 }))

afterEach(() => localStorage.clear())

describe('第 12 章（jsdom smoke）', () => {
  it('整章可渲染：章末的符號表、三個實驗、勘誤連結、T13–T15 badge；沒有 React console error（act() 提示除外）', async () => {
    const errSpy = vi.spyOn(console, 'error')
    const { container } = renderChapter()
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 // b 在 a 之後
    // 符號表在章末（docs/teaching-style.md §5）：整頁最後一個區塊、id="symbols"，在「本課必記」與所有小節、實驗之後；全頁只有一張
    expect(screen.getByText('本章符號表')).toBeTruthy()
    const article = container.querySelector('article.ch12') as HTMLElement
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols).toBeTruthy()
    expect(article.lastElementChild).toBe(symbols)
    expect(container.querySelectorAll('.c-symbols').length).toBe(1)
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    expect(symbols.querySelectorAll('.c-symbols tbody tr').length).toBe(CH12_SYMBOLS.length)
    expect(follows(container.querySelector('.c-recap') as HTMLElement, symbols)).toBe(true)
    for (const el of Array.from(container.querySelectorAll('section.c-section, [data-experiment], .c-quiz, section.c-handcalc'))) expect(follows(el, symbols)).toBe(true)
    // 章首只留一行「本章符號表在最後」的按鈕（HashRouter：不用 href，改用 scrollIntoView），位在第一個小節之前
    const jumps = Array.from(container.querySelectorAll('button.ch12-jump')) as HTMLButtonElement[]
    expect(jumps.length).toBe(1)
    expect(jumps[0].textContent).toMatch(/^本章符號表在最後/)
    expect(follows(jumps[0], container.querySelector('#ch12-start') as HTMLElement)).toBe(true)
    expect(container.querySelector('a[href="#symbols"]')).toBeNull()
    // 方塊圖（docs/teaching-style.md §8）：章首的系統地圖 + 本章的 Mermaid 圖（預設 Engineer 模式看不到 Research 專屬的那一張）
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(1 + CH12_CHARTS.filter((c) => !c.mode).length)
    expect(container.querySelectorAll('.ch12-diagram').length).toBe(CH12_CHARTS.filter((c) => !c.mode).length)
    // 章首的系統地圖是手排的 SVG（figure.c-sysmap，不經過 Mermaid）：被標成藍色（is-focus）的方塊就是本章追蹤的雜訊路徑
    const sysmaps = container.querySelectorAll('figure.c-mermaid.c-sysmap')
    expect(sysmaps.length).toBe(1)
    expect(container.querySelector('figure.c-mermaid')).toBe(sysmaps[0])
    const focused = Array.from(sysmaps[0].querySelectorAll('g.c-sysmap-block.is-focus')).map((g) => g.getAttribute('data-block'))
    expect([...focused].sort()).toEqual([...CH12_SYSTEM_FOCUS].sort())
    expect(sysmaps[0].querySelectorAll('g.c-sysmap-block[data-focus="true"]').length).toBe(CH12_SYSTEM_FOCUS.length)
    // 標題現在含 `$...$`（KaTeX 的 MathML 節點）：getAllByRole(…, { name }) 計算 accessible name 時 jsdom 的 getComputedStyle
    // 會對 MathML 元素丟例外，所以直接比對標題元素的文字（Section 標題 + ExperimentShell 標題，各實驗至少兩個）
    const headings = Array.from(container.querySelectorAll('h2, h3, h4')).map((h) => h.textContent ?? '')
    for (const name of [/LMS Noise Lab/, /Code Spectra Lab/, /Code Mixing Lab/]) expect(headings.filter((t) => name.test(t)).length, String(name)).toBeGreaterThanOrEqual(2)
    // 含公式的標題確實被 KaTeX 渲染（沒有殘留的 $）
    expect(container.querySelectorAll('h2 .katex, h3 .katex').length).toBeGreaterThanOrEqual(4) // 12.6、§12.8、單頻 × 單頻、隨機 × 隨機
    expect(headings.some((t) => t.includes('$'))).toBe(false)
    const links = Array.from(container.querySelectorAll('a.ch12-erratum')) as HTMLAnchorElement[]
    const ids = new Set(links.map((a) => a.textContent?.replace('勘誤 ', '').trim()))
    for (const e of ['E06', 'E09', 'E10', 'E26', 'E27', 'E28', 'E29', 'E30', 'E33']) expect(ids.has(e)).toBe(true)
    expect(links.every((a) => a.getAttribute('href') === '#/verification')).toBe(true)
    const badges = container.querySelector('.c-tag-row')?.textContent ?? ''
    for (const t of ['T13', 'T14', 'T15']) expect(badges).toContain(t)
    // 公式錨點
    for (const f of FORMULAS) expect(container.querySelector(`#formula-${f.id.replace('.', '\\.')}`), f.id).toBeTruthy()
    // 帶入手算（docs/teaching-style.md §7）：8 題依頁面順序出現，每題前面有一句邀請讀者先自己算的話
    const hands = Array.from(container.querySelectorAll('section.c-handcalc')) as HTMLElement[]
    expect(hands.map((e) => e.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    expect(container.querySelectorAll('.ch12-hand > .ch12-hand-invite').length).toBe(HANDCALCS.length)
    // 每一題都放在它對應的公式（推導）之後；HC-12.1 例外：它緊接章首的「先算一次」表格（遞迴式在下一節才推導）
    for (const h of HANDCALCS) {
      if (!h.formulaId || h.id === 'HC-12.1') continue
      expect(follows(document.getElementById(`formula-${h.formulaId}`) as HTMLElement, document.getElementById(`handcalc-${h.id}`) as HTMLElement), h.id).toBe(true)
    }
    expect(follows(hands[0], document.getElementById('formula-F-12.1') as HTMLElement)).toBe(true)
    // 綜合題（最後一題）緊接在第一個思考題之前，中間沒有別的手算題或實驗
    const quizzes = Array.from(container.querySelectorAll('.c-quiz'))
    expect(quizzes.length).toBe(4)
    const last = hands[hands.length - 1]
    expect(follows(last, quizzes[0])).toBe(true)
    expect(follows(hands[hands.length - 2], last)).toBe(true)
    expect(Array.from(container.querySelectorAll('[data-experiment]')).every((e) => follows(e, last))).toBe(true)
    expect(container.querySelectorAll('.c-handcalc .katex-error, .c-handcalc .c-tex-error').length).toBe(0)
    // 不得把 f_3dB 標成「Noise BW」（E06）：所有表頭與 KPI 標籤都不使用這個字樣（內文只在「反面例子」中引用）
    const labels = Array.from(container.querySelectorAll('th, .ch12-kpi-label')).map((e) => e.textContent ?? '')
    expect(labels.some((t) => /Noise BW/i.test(t))).toBe(false)
    // LMS Noise Lab 的 Monte Carlo（inline 模式）會在 mount 後自動跑完
    await waitFor(() => expect(container.textContent).toMatch(/（Monte Carlo，Binomial）/), { timeout: T_WAIT })
    // Code Mixing Lab（T15 預設，純確定性）：Monte Carlo 欄誠實顯示 n/a，而不是 ok
    expect(container.textContent).toContain('純確定性訊號（沒有亂數，不需 Monte Carlo）')
    // Plot / Mermaid 的 lazy load 會觸發 act() 提示（共用元件、測試環境特有）；其他 console.error（key、DOM 巢狀…）一律不允許
    const errs = errSpy.mock.calls.map((c) => String(c[0])).filter((m) => !/not wrapped in act/.test(m))
    errSpy.mockRestore()
    expect(errs).toEqual([])
  }, T_TEST)

  it('符號表：章首的按鈕捲到章末的 #symbols，之後可以回到原本的位置；表格依首次出現的小節排列', () => {
    const scrolled: string[] = []
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    Object.defineProperty(window, 'scrollY', { value: 321, configurable: true })
    try {
      const { container } = renderChapter()
      expect(container.querySelector('.ch12-symbols-back')).toBeNull()
      fireEvent.click(container.querySelector('button.ch12-jump') as HTMLElement)
      expect(scrolled).toEqual(['symbols'])
      // 跳過去之後，符號表旁出現「回到剛才閱讀的位置」
      const back = container.querySelector('#symbols .ch12-symbols-back button') as HTMLButtonElement
      expect(back.textContent).toMatch(/回到剛才閱讀的位置/)
      fireEvent.click(back)
      expect(scrollTo).toHaveBeenCalledWith({ top: 321, behavior: 'smooth' })
      expect(container.querySelector('.ch12-symbols-back')).toBeNull()
      // 「首次出現」欄由小到大（§12.0 … §12.9；「§12.0 → §12.7」這種寫法以箭頭前的小節排序），而且每一列都有標示
      const seen = Array.from(container.querySelectorAll('#symbols .c-symbols tbody tr')).map((tr) => /§12\.(\d+)/.exec(tr.textContent ?? '')?.[1])
      expect(seen.every((x) => x !== undefined)).toBe(true)
      const order = CH12_SYMBOLS.map((r) => Number(/§12\.(\d+)/.exec(r.firstSeen ?? '')?.[1]))
      expect(order).toEqual([...order].sort((a, b) => a - b))
      expect(new Set(CH12_SYMBOLS.map((r) => r.symbol)).size).toBe(CH12_SYMBOLS.length)
    } finally {
      scrollTo.mockRestore()
      Reflect.deleteProperty(window, 'scrollY')
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  }, T_TEST)

  it('LMS Noise Lab：新增 Case B 後兩個 case 一起（paired）跑 Monte Carlo，表格顯示各自的 σ_w 與 CI', async () => {
    const { container } = renderChapter()
    const lab = container.querySelector('[data-experiment="lms-noise-lab"]') as HTMLElement
    await waitFor(() => expect(lab.textContent).toMatch(/（Monte Carlo，Binomial）/), { timeout: T_WAIT })
    fireEvent.click(lab.querySelector('button[aria-label="新增比較組（複製目前參數）"]') as HTMLElement)
    await waitFor(
      () => {
        const rows = Array.from(lab.querySelectorAll('table.ch12-table tbody tr'))
        expect(rows.length).toBe(2)
        // 每列最後一欄是「模擬 σ_w [CI] ✓」：兩個 case 都要有結果
        for (const r of rows) expect(r.lastElementChild?.textContent ?? '').toMatch(/^0\.\d+ \[0\.\d+, 0\.\d+\] ✓$/)
      },
      { timeout: T_WAIT },
    )
  }, T_TEST)

  it('教學規範：KaTeX 以外的任何可見文字（內文、表格、圖說、指標名稱、警告、假設、交叉比對說明、提示…）都不得用 Unicode / 純文字拼公式，也不得殘留未渲染的 $', async () => {
    localStorage.setItem('lmspll.mode', 'research')
    const { container } = renderChapter()
    // 等三個實驗的自動計算完成，再手動執行 Code Spectra Lab 的逐 sample 驗證（它的指標說明也要檢查）
    await waitFor(() => expect(container.textContent).toMatch(/（Monte Carlo，Binomial）/), { timeout: T_WAIT })
    const spectra = container.querySelector('[data-experiment="code-spectra-lab"]') as HTMLElement
    await waitFor(() => expect(spectra.querySelectorAll('table.ch12-table tbody tr').length).toBe(3), { timeout: T_WAIT })
    const runBtn = Array.from(spectra.querySelectorAll('button')).find((b) => /執行/.test(b.textContent ?? ''))
    expect(runBtn).toBeTruthy()
    fireEvent.click(runBtn as HTMLElement)
    await waitFor(() => expect(spectra.textContent).toMatch(/RMS（模擬）/), { timeout: T_WAIT })
    // 例外（docs/teaching-style.md §3）：程式碼、Plotly 圖內文字、下拉選單、暫存器 / behavioral 參數名稱、檔案路徑、共用徽章的 tooltip
    const skip = '.katex, code, pre, option, script, style, svg, .c-param-reg, .c-code-path, .c-tip, .c-tip-item'
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const offenders: string[] = []
    let total = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest(skip)) continue
      total++
      const t = (n.textContent ?? '').replace(/μs/g, '') // μs 是單位（micro-second），不是公式
      // 小寫下標（f_3dB、σ_w）、上標 ^、希臘字母 / 根號 / 積分等符號、或未渲染的 $ ⇒ 純文字公式；REG_GMAC_N 這類大寫暫存器名稱不算
      if (/(?<![A-Z_])[A-Za-z]_[a-z0-9{(]|\^|[σμηδτβθΩℒφΦ√∫Σπ≈∝ρ]|\$/.test(t)) offenders.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${t.trim().slice(0, 80)}`)
    }
    expect(total).toBeGreaterThan(1500)
    expect(offenders).toEqual([])
    // 字串屬性裡的 $...$ 都要成功渲染
    expect(container.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
    expect(container.querySelectorAll('.c-metric-table .katex').length).toBeGreaterThan(40)
    expect(container.querySelectorAll('.c-exp-assumptions .katex').length).toBeGreaterThan(10)
  }, T_TEST)

  it('Plotly 圖內文字（軸標題、圖例名稱、hover 名稱）的數學都寫成 $...$：沒有 Unicode 拼的數學，轉換後沒有殘留的反斜線、大括號或 $', async () => {
    localStorage.setItem('lmspll.mode', 'research')
    PM.calls.length = 0
    const { container } = renderChapter()
    // 等 LMS Noise Lab 的 Monte Carlo 跑完（trace／PSD 兩張圖的資料都齊了）
    await waitFor(() => expect(container.textContent).toMatch(/（Monte Carlo，Binomial）/), { timeout: T_WAIT })
    // 會顯示在圖上的字串欄位（與 plotMath.ts 的 TEXT_KEYS 相同）
    const TEXT_KEYS = new Set(['name', 'text', 'title', 'ticktext', 'hovertemplate', 'texttemplate', 'hovertext', 'label', 'ticksuffix', 'tickprefix', 'legendgrouptitle'])
    const strings = new Set<string>()
    const walk = (value: unknown, key: string | null, depth: number) => {
      if (typeof value === 'string') {
        if (key !== null && TEXT_KEYS.has(key)) strings.add(value)
        return
      }
      if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return
      if (Array.isArray(value)) {
        for (const v of value.slice(0, 5000)) walk(v, key, depth + 1)
        return
      }
      for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1)
    }
    for (const c of PM.calls) {
      walk(c.data, null, 0)
      walk(c.layout, null, 0)
    }
    const all = [...strings]
    const withMath = all.filter((t) => t.includes('$'))
    // 本章 10 張互動圖（變異數累積、acf、頻率響應、ZOH PSD、noise trace、noise PSD、mixing 時域／頻譜、code PSD、code ℒ(f)）的軸標題與圖例都有公式
    expect(withMath.length).toBeGreaterThan(30)
    // 這些字串轉成 Plotly 的 pseudo-HTML 之後：不得殘留 TeX 的反斜線、大括號、$（不認得的指令會原樣露出指令名稱）
    for (const t of withMath) expect(plotMath(t), t).not.toMatch(/[\\{}$]/)
    // `$...$` 以外的文字不得有 Unicode／底線拼的數學（希臘字母、上下標、運算符號、w_k、f^2…）；單位 μs 也寫成 $\mathrm{\mu s}$
    const UNICODE_MATH = /[\u0370-\u03ff\u2070-\u209f\u00b2\u00b3\u00b9\u2212∑∏√∞≤≥≠≈±∓·×÷∂∇∈∝⌊⌋⌈⌉ℒ𝒩]|(?<![A-Za-z0-9])[A-Za-z]{1,3}_[A-Za-z0-9{(]|\^[-0-9{(]/u
    const offenders = all.filter((t) => UNICODE_MATH.test(t.replace(/(?<!\\)\$(?:[^$\\]|\\.)+?(?<!\\)\$/g, '')))
    expect(offenders).toEqual([])
    // 幾個代表性的字串確實寫成 LaTeX（而不是被改成別的）
    for (const want of [
      '$\\delta w_k = w_k - w^*$ [fs]',
      '$V_k$ [$\\mathrm{fs}^2$]',
      '$R_w[\\ell]$',
      '$|H(f)|^2/|H(0)|^2$ [dB]',
      '$S_w^{(1)}$ [$\\mathrm{fs}^2/\\mathrm{Hz}$]（one-sided）',
      '$S_{\\delta t}^{(1)}$ [$\\mathrm{fs}^2/\\mathrm{Hz}$]',
      '$\\mathcal{L}(f)$ [dBc/Hz]',
      '$10\\log_{10}(P_{\\phi,\\mathrm{bin}}/2)$ [dBc]',
      '$t$ [$\\mathrm{\\mu s}$]',
    ]) expect(all, want).toContain(want)
    expect(plotMath('$S_w^{(1)}$ [$\\mathrm{fs}^2/\\mathrm{Hz}$]')).toBe('<i>S</i><sub><i>w</i></sub><sup>(1)</sup> [fs<sup>2</sup>/Hz]')
  }, T_TEST)

  it('URL preset（?preset=noise-sum-mode-bug）套用到 LMS Noise Lab 並顯示 sum-mode 警告', async () => {
    const { container } = renderChapter('/ch/12?preset=noise-sum-mode-bug')
    await waitFor(() => expect(container.textContent).toMatch(/gm_mode=sum 時有效增益放大 N 倍/), { timeout: T_WAIT })
  }, T_TEST)

  it('Research 模式：所有 LaTeX（含 ModeGate 內容與 Steps）都能被 KaTeX 解析', () => {
    localStorage.setItem('lmspll.mode', 'research')
    const { container } = renderChapter()
    const bad = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.getAttribute('title') ?? e.textContent)
    expect(bad).toEqual([])
    // Research 模式：全部的方塊圖（含 colored η 那一張）+ 系統地圖
    expect(container.querySelectorAll('figure.c-mermaid').length).toBe(1 + CH12_CHARTS.length)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(300)
  }, T_TEST)

  it('Beginner 模式：逐步推導預設收合，可一鍵展開', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = renderChapter()
    const folds = container.querySelectorAll('details.ch12-fold')
    expect(folds.length).toBeGreaterThan(5)
    // 方塊圖不收進推導的折疊框：Beginner 模式也直接看得到（系統地圖 + 非 Research 的圖）
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid'))
    expect(figs.length).toBe(1 + CH12_CHARTS.filter((c) => !c.mode).length)
    expect(figs.every((f) => !f.closest('details'))).toBe(true)
    const first = folds[0] as HTMLDetailsElement
    expect(first.open).toBe(false)
    fireEvent.click(first.querySelector('summary') as HTMLElement)
  }, T_TEST)
})

describe('第 12 章：資料與程式碼一致性', () => {
  it('formulas.ts：ID 唯一、格式 F-12.n，且每個 ID 都在章內 TexBlock 出現', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    const src = chapterSources()
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-12\.\d+$/)
      expect(f.page).toBe('/ch/12')
      expect(src.includes(`id="${f.id}"`), f.id).toBe(true)
    }
  })

  it('頁面引用的 core region 都存在於 calNoise.ts', () => {
    const src = chapterSources()
    const regions = Array.from(src.matchAll(/region[=:]\s*['"]([\w.-]+)['"]/g)).map((m) => m[1])
    expect(regions.length).toBeGreaterThan(8)
    for (const r of regions) expect(() => extractRegion(calNoiseSrc, r)).not.toThrow()
    // CodeCompare 的差異行有標記
    for (const r of ['bwExact', 'bwOneMinusP', 'bwNegLnP', 'enbw', 'linearStep', 'binomialStep']) {
      expect(extractRegion(calNoiseSrc, r)).toContain('← 差異')
    }
  })

  it('本章 presets：experiment 正確、參數鍵皆為該實驗的合法欄位、Gallery #8 / #9 存在', () => {
    const files = readdirSync(PRESET_DIR).filter((f) => /^(noise|mixing|spur).*\.json$/.test(f))
    expect(files.length).toBeGreaterThanOrEqual(16)
    const keysOf: Record<string, string[]> = {
      'lms-noise-lab': Object.keys(NOISE_LAB_DEFAULTS),
      'code-mixing-lab': Object.keys(MIX_DEFAULTS),
      'code-spectra-lab': Object.keys(CODE_SPECTRA_DEFAULTS),
    }
    const gallery = new Map<number, string>()
    for (const f of files) {
      const p = JSON.parse(readFileSync(resolve(PRESET_DIR, f), 'utf8')) as PresetEntry
      expect(`${p.id}.json`).toBe(f)
      expect(p.page).toBe('/ch/12')
      expect(Object.keys(keysOf)).toContain(p.experiment)
      for (const k of Object.keys(p.params)) expect(keysOf[p.experiment], `${f}: ${k}`).toContain(k)
      expect(p.expected.length).toBeGreaterThan(10)
      if (p.galleryIndex) gallery.set(p.galleryIndex, p.experiment)
    }
    expect(gallery.get(8)).toBe('lms-noise-lab')
    expect(gallery.get(9)).toBe('code-mixing-lab')
  })

  it('T13/T15: 每個 preset 以預設 seed 實際執行後，行為與它宣稱的 expected 一致（型態、交叉比對狀態、關鍵數值）', () => {
    const load = (id: string) => JSON.parse(readFileSync(resolve(PRESET_DIR, `${id}.json`), 'utf8')) as PresetEntry
    const SEED = 20261010 // 三個實驗的預設 seed
    // ── LMS Noise Lab：型態 + Monte Carlo 是否涵蓋解析值 ──
    const noise: Record<string, { regime: string; covers: boolean | null }> = {
      'noise-t13-example': { regime: 'lowpass', covers: true },
      'noise-colored-eta': { regime: 'lowpass', covers: true },
      'noise-no-3db': { regime: 'no3db', covers: true },
      'noise-highpass': { regime: 'highpass', covers: true },
      'noise-unstable': { regime: 'unstable', covers: null },
      'noise-polarity-flip': { regime: 'polarity', covers: null },
      'noise-sum-mode-bug': { regime: 'unstable', covers: null },
    }
    for (const [id, want] of Object.entries(noise)) {
      const prm = { ...NOISE_LAB_DEFAULTS, ...(load(id).params as Partial<typeof NOISE_LAB_DEFAULTS>) }
      const r = runNoiseLab({ ...prm, seed: SEED, nperseg: Math.min(512, prm.blocks) })
      expect(r.loop.regime, id).toBe(want.regime)
      if (want.covers === null) expect(Number.isNaN(r.loop.sigmaW), id).toBe(true)
      else expect(r.sigmaWLo <= r.loop.sigmaW && r.loop.sigmaW <= r.sigmaWHi, `${id}: [${r.sigmaWLo}, ${r.sigmaWHi}] vs ${r.loop.sigmaW}`).toBe(want.covers)
    }
    const t13 = calLoop({ ...NOISE_LAB_DEFAULTS, ...(load('noise-t13-example').params as Partial<typeof NOISE_LAB_DEFAULTS>) })
    expect(t13.sigmaW).toBeCloseTo(0.39919, 5)
    expect(t13.f3dbExact / 1e3).toBeCloseTo(12.931, 3)
    expect(t13.enbw / 1e3).toBeCloseTo(20.289, 3)
    expect(calLoop({ ...NOISE_LAB_DEFAULTS, ...(load('noise-colored-eta').params as Partial<typeof NOISE_LAB_DEFAULTS>) }).sigmaW).toBeCloseTo(0.65647, 5)
    // ── Code Mixing Lab：交叉比對狀態 + spur 讀數 ──
    const mixing: Record<string, { analytic: string; mc: string; dbc?: number; tones: number }> = {
      'mixing-t15-spur': { analytic: 'ok', mc: 'n/a', dbc: -93.799, tones: 2 },
      'mixing-dc-offset': { analytic: 'ok', mc: 'n/a', dbc: -93.799, tones: 3 },
      'mixing-zoh-hold': { analytic: 'ok', mc: 'n/a', dbc: -93.82, tones: 2 },
      'spur-pll-filtered': { analytic: 'ok', mc: 'n/a', dbc: -113.799, tones: 2 },
      'spur-aliasing': { analytic: 'mismatch', mc: 'n/a', tones: 1 },
      'mixing-random-skirt': { analytic: 'n/a', mc: 'ok', tones: 0 },
      'mixing-white-code': { analytic: 'n/a', mc: 'ok', tones: 0 },
    }
    for (const [id, want] of Object.entries(mixing)) {
      const prm = { ...MIX_DEFAULTS, ...(load(id).params as Partial<typeof MIX_DEFAULTS>) }
      const r = simulateMixing({ ...prm, seed: SEED })
      const cc = mixingCrossCheck(prm, r)
      expect(cc.analytic.status, id).toBe(want.analytic)
      expect(cc.monteCarlo.status, id).toBe(want.mc)
      expect(r.tones.length, id).toBe(want.tones)
      if (want.dbc !== undefined) for (const t of r.tones) expect(t.dbcSmall, id).toBeCloseTo(want.dbc, 2)
    }
    // ── Code Spectra Lab：解析 in-band RMS ──
    const cs = { ...CODE_SPECTRA_DEFAULTS, ...(load('noise-code-spectra').params as Partial<typeof CODE_SPECTRA_DEFAULTS>) }
    const an = codeSpectraAnalytic({ ...cs, pll: { f3dbT: cs.f3dbT, zeta: cs.zeta } })
    expect(an.rows.map((x) => Number(x.inbandRms.toPrecision(3)))).toEqual([0.398, 0.281, 0.00893])
  }, 60000)
})
