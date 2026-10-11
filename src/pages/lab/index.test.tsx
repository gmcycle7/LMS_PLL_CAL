import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { extractRegion, listRegions } from '@/components'
import blockSrc from '@/simulation/models/blockLms.ts?raw'
import labSrc from '@/simulation/models/unifiedLab.ts?raw'
import { LAB_CHARTS } from './diagrams'
import { FORMULAS } from './formulas'
import LabPage from './index'
import { EXP, TAB_LABEL, TAB_ORDER } from './logic'
import { LAB_SYMBOLS } from './symbols'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })), parse: vi.fn(async () => true) },
}))

type Mode = 'beginner' | 'engineer' | 'research'

// 每個測試都要 render 一整頁（jsdom 約 1–3 秒）；與其他測試檔同時跑時，預設的 5 秒不夠穩定
vi.setConfig({ testTimeout: 30_000 })

/*
 * 記憶體防線。整頁在 jsdom 裡約 6 萬個節點，每次 render 約 250 MB；卸載後有兩個地方會把整棵（已經拔掉的）DOM 樹留住：
 *   1. jsdom 的 selector 引擎（nwsapi）對「每一個 selector 字串」快取最後一次查詢的 context 元素。
 *      測試裡每用一個新的 selector 查一次 container，那棵樹就被留到「同一個 selector 再被別的元素查詢」為止。
 *   2. vi.fn() 會記下每次呼叫的參數：Plotly.react(el, …) 的 el 是 DOM 元素。
 * 20 個測試累積起來會超過 4 GB 的 heap 上限，worker 直接當掉（不是測試失敗，而是整個檔案沒有結果）。
 * 做法：記下用過的 selector，每個測試結束後拿一個空的 <div> 把它們各查一次（把快取的 context 換掉）、清掉 mock 的呼叫紀錄，
 * 再讓出一次 macrotask（React 卸載後的收尾工作要等 event loop 轉一圈）。
 */
const usedSelectors = new Set<string>()
{
  const proto = window.Element.prototype as unknown as Record<string, (this: Element, sel: string) => unknown>
  for (const name of ['querySelector', 'querySelectorAll', 'closest', 'matches']) {
    const orig = proto[name]
    proto[name] = function (this: Element, sel: string) {
      usedSelectors.add(sel)
      return orig.call(this, sel)
    }
  }
}
afterEach(async () => {
  cleanup()
  const dummy = document.createElement('div')
  for (const s of usedSelectors) {
    try {
      dummy.querySelectorAll(s)
      dummy.querySelector(s)
      dummy.matches(s)
    } catch {
      /* 不合法的 selector：略過 */
    }
  }
  for (const f of [P.react, P.purge, P.toImage, P.downloadImage, P.Plots.resize]) f.mockClear()
  await new Promise((r) => setTimeout(r, 0))
})

function renderPage(url = '/lab', mode: Mode = 'engineer', autorun = false) {
  localStorage.setItem('lmspll.mode', mode)
  localStorage.setItem('lmspll.lab.autorun', JSON.stringify(autorun))
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <LabPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

// 整頁 DOM 很大（KaTeX）：一律用 querySelector，避免 getByRole 掃描整份文件。
const shell = (c: HTMLElement, id: string) => c.querySelector(`[data-experiment="${id}"]`) as HTMLElement | null
const tabButton = (c: HTMLElement, t: (typeof TAB_ORDER)[number]) => c.querySelector(`#lab-tab-${t}`) as HTMLButtonElement
const buttonByText = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text)) as HTMLButtonElement | undefined
/** 把 KaTeX 的輸出拿掉後的可見文字（檢查有沒有漏網的 `$...$` 或 Unicode 公式） */
function visibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  // .c-tip：TestBadge 的 tooltip 逐字列出測試名稱（src/data/verification-status.json），名稱裡可以有字面的 `$...$`；它不是本頁的內文
  clone.querySelectorAll('.katex, pre, code, option, .c-param-reg, .c-code, figure.c-code-block, .c-tip').forEach((n) => n.remove())
  return clone.textContent ?? ''
}

const PAGE_DIR = resolve(process.cwd(), 'src/pages/lab')
function sourceFiles(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const dir of ['', 'sections', 'tabs']) {
    for (const f of readdirSync(resolve(PAGE_DIR, dir))) {
      if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue
      out.push({ file: `${dir}/${f}`, text: readFileSync(resolve(PAGE_DIR, dir, f), 'utf8') })
    }
  }
  return out
}

describe('Lab 頁：三種學習模式都能渲染', () => {
  for (const mode of ['beginner', 'engineer', 'research'] as Mode[]) {
    it(`${mode} 模式：不丟例外、沒有 KaTeX 錯誤、沒有程式碼 region 錯誤、沒有漏網的 $...$`, () => {
      const { container } = renderPage('/lab', mode)
      expect(container.querySelector('.lab-page')).not.toBeNull()
      expect(container.querySelectorAll('.c-tex-error, .katex-error')).toHaveLength(0)
      expect(container.textContent).not.toContain('程式碼載入錯誤')
      expect(container.textContent).not.toContain('找不到程式碼 region')
      const text = visibleText(container)
      expect(text).not.toMatch(/\$[^$\n]{1,80}\$/)
      // 章節骨架
      for (const id of ['lab-s1', 'lab-s2', 'lab-s3', 'lab-s4', 'lab-s5', 'lab-s6', 'lab-s7', 'lab-s8', 'lab-s9']) expect(container.querySelector(`#${id}`), id).not.toBeNull()
      expect(shell(container, EXP.pipeline)).not.toBeNull()
    })
  }

  it('每個登錄的公式 ID 在頁面上恰好有一個 TexBlock 錨點（三種模式都在）；公式的 TeX 可被 KaTeX 解析', async () => {
    const katex = (await import('katex')).default
    expect(FORMULAS.map((f) => f.id)).toEqual(Array.from({ length: 18 }, (_, i) => `F-LAB.${i + 1}`))
    for (const f of FORMULAS) {
      expect(f.page).toBe('/lab')
      expect(() => katex.renderToString(f.tex, { throwOnError: true, strict: 'ignore' }), f.id).not.toThrow()
      expect(f.title).not.toContain('$')
      expect(f.conditions).not.toContain('$')
    }
    for (const mode of ['beginner', 'research'] as Mode[]) {
      const { container, unmount } = renderPage('/lab', mode)
      for (const f of FORMULAS) expect(container.querySelectorAll(`[id="formula-${f.id}"]`), `${f.id}（${mode}）`).toHaveLength(1)
      unmount()
    }
  })

  it('先備知識框：微積分以外的概念第一次出現時都有（期望值／變異數、傅立葉係數、Z transform、Gaussian／erf、相關、pole、PSD、共變異數、信賴區間、矩陣）', () => {
    const { container } = renderPage('/lab', 'beginner')
    const titles = Array.from(container.querySelectorAll('details.c-prereq > summary')).map((s) => s.textContent ?? '')
    for (const need of ['期望值、均方與變異數', '傅立葉係數', 'Z transform', 'Gaussian', '相關（correlation）', 'pole 與單位圓', 'PSD', '共變異數', '信賴區間', '特徵值']) {
      expect(titles.some((x) => x.includes(need)), need).toBe(true)
    }
    // 期望值的框在第 3 節（E[r] 第一次出現的地方），不是等到第 4.5 節
    const s3 = container.querySelector('section[aria-labelledby="lab-s3"]') as HTMLElement
    expect(Array.from(s3.querySelectorAll('details.c-prereq > summary')).some((s) => (s.textContent ?? '').includes('期望值'))).toBe(true)
    // §5.2 的數字先行例子與三種平均模型的比較表（Beginner 也看得到）
    const s5 = container.querySelector('section[aria-labelledby="lab-s5"]') as HTMLElement
    expect(s5.textContent).toContain('和誰比：mean-field 平均軌跡')
    expect(s5.textContent).toContain('三種「平均模型」的比較')
    // 延遲表多了「開始振鈴」與 PM 兩列，並說明為什麼小 g 時 ρ 反而變小
    const s4 = container.querySelector('section[aria-labelledby="lab-s4"]') as HTMLElement
    expect(s4.textContent).toContain('開始振鈴的')
    expect(s4.textContent).toContain('這張表有一個容易讀錯的地方')
  })

  it('符號表：列出本頁所有符號（含三個不同的延遲、兩條路徑），符號的 TeX 可解析；表在頁末（id="symbols"），頁首只留一行按鈕', async () => {
    const katex = (await import('katex')).default
    expect(LAB_SYMBOLS.length).toBeGreaterThanOrEqual(30)
    for (const s of LAB_SYMBOLS) {
      expect(() => katex.renderToString(s.symbol, { throwOnError: true, strict: 'ignore' }), s.symbol).not.toThrow()
      if (s.unit) expect(() => katex.renderToString(s.unit as string, { throwOnError: true, strict: 'ignore' }), s.unit).not.toThrow()
    }
    const sym = LAB_SYMBOLS.map((s) => s.symbol).join(' ')
    for (const need of ['H_{\\mathrm{PD}}', 'T(z)', 'd,\\ D,\\ d_L', 'K_q', '\\lambda_{\\min}', 'x_{\\mathrm{ref}}']) expect(sym).toContain(need)
    const { container } = renderPage()
    expect(container.querySelector('.c-symbols table')?.querySelectorAll('tbody tr').length).toBe(LAB_SYMBOLS.length)
    // 符號表放在頁末（docs/teaching-style.md §5）：全頁只有一張，包在 id="symbols" 裡，是頁面的最後一個區塊（在「本頁必記」之後）
    const precedes = (x: Element | null, y: Element | null) => !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
    const page = container.querySelector('.lab-page') as HTMLElement
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols).not.toBeNull()
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelector('.c-symbols')).not.toBeNull()
    expect(page.lastElementChild).toBe(symbols)
    expect(symbols.lastElementChild?.classList.contains('c-symbols')).toBe(true)
    expect(precedes(container.querySelector('#lab-s9'), symbols)).toBe(true)
    expect(precedes(container.querySelector('.c-recap'), symbols)).toBe(true)
    expect(symbols.querySelector('h2')?.textContent).toBe('本頁符號表')
    // 第 1 節裡不再有符號表
    expect(container.querySelector('section[aria-labelledby="lab-s1"] .c-symbols')).toBeNull()
    // 頁首只留一行「本頁符號表在最後 ↓」：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），而且在第 1 節之前
    const jump = container.querySelector('.lab-symbols-jump button') as HTMLButtonElement
    expect(jump.textContent).toBe('本頁符號表在最後 ↓')
    expect(container.querySelectorAll('.lab-symbols-jump')).toHaveLength(1)
    expect(jump.closest('a')).toBeNull()
    expect(container.querySelector('a[href*="#symbols"]')).toBeNull()
    expect(precedes(jump, container.querySelector('#lab-s1'))).toBe(true)
    // 按下去捲到頁末的 #symbols；符號表旁的「回到頁首」捲回頁首（jsdom 沒有 scrollIntoView，這裡裝一個假的）
    const down = vi.fn()
    const up = vi.fn()
    symbols.scrollIntoView = down
    ;(container.querySelector('#lab-top') as HTMLElement).scrollIntoView = up
    fireEvent.click(jump)
    expect(down).toHaveBeenCalledTimes(1)
    fireEvent.click(buttonByText(symbols, '回到頁首') as HTMLButtonElement)
    expect(up).toHaveBeenCalledTimes(1)
  })

  it('方塊圖：五張圖各出現一次，都有圖說與「先看…」導讀，並放在對應公式／實驗之前（docs/teaching-style.md §8）', () => {
    const { container } = renderPage('/lab', 'beginner')
    const precedes = (x: Element | null, y: Element | null) => !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs).toHaveLength(LAB_CHARTS.length)
    // 圖說是純文字（Mermaid 的 caption 不渲染 KaTeX）：不用 Unicode 拼數學、沒有 $；每張圖都包在 .lab-diagram 裡並附導讀
    const BAD = /[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓$]/
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, cap).toBeGreaterThan(20)
      expect(BAD.test(cap), cap).toBe(false)
      expect((f.getAttribute('aria-label') ?? '').length).toBeGreaterThan(10)
      const walk = f.closest('.lab-diagram')?.querySelector('.lab-diagram-walk')
      expect(walk?.textContent, cap).toContain('先看')
      expect(walk?.textContent, cap).toContain('圖上')
      expect(walk?.querySelector('.katex'), cap).toBeTruthy()
    }
    // 位置：文字說明 → 圖 → 推導／公式（或實驗）
    const fig = (label: string) => {
      const f = figs.find((x) => (x.getAttribute('aria-label') ?? '').includes(label))
      if (!f) throw new Error(`找不到圖：${label}`)
      return f
    }
    const id = (x: string) => container.querySelector(`[id="${x}"]`)
    const placed: [string, string, string][] = [
      ['九級訊號流程圖', 'section[aria-labelledby="lab-s2"]', 'formula-F-LAB.1'],
      ['主 PLL 負回授', '#lab-s44', 'formula-F-LAB.4'],
      ['block rate 校正迴路', '#lab-s47', 'formula-F-LAB.7'],
      ['輸出 timing error 的方塊圖', '#lab-s49', 'formula-F-LAB.10'],
      ['五個分頁的關係圖', '#lab-experiments', 'lab-tabpanel'],
    ]
    expect(placed.map(([label]) => fig(label))).toEqual(figs) // 頁面上的順序與 LAB_CHARTS 相同
    for (const [label, section, target] of placed) {
      expect(fig(label).closest(section), `${label} 應在 ${section} 內`).toBeTruthy()
      expect(precedes(fig(label), id(target)), `${label} 應在 ${target} 之前`).toBe(true)
    }
    // §4.4、§4.7、§4.9 的圖在各自的逐步推導之前（先看圖知道訊號怎麼流，再看數學）
    for (const [label, section] of [placed[1], placed[2], placed[3]]) {
      expect(precedes(fig(label), container.querySelector(`${section} details.lab-steps`)), label).toBe(true)
    }
  })

  it('沒有「掉了反斜線」的 TeX 指令（一般字串裡寫單一反斜線會變成一串字母，KaTeX 不會報錯）', () => {
    const LOST =
      /(?<![\\a-zA-Z])(approx|mathbf|mathrm|mathcal|operatorname|varphi|lambda|sigma|delta|omega|theta|alpha|beta|gamma|frac|sqrt|cdot|infty|qquad|quad|ldots|times|propto|Rightarrow|rightarrow|arcsin|boxed|underbrace|bmod|tfrac|dfrac|Bigl|Bigr|bigl|bigr|ge|le|ne|ll|gg|pm|mu|rho|tau|eta|pi|sum|max|min|ln|log|sin|cos|bar|hat|tilde|text|circ|ell)(?![a-zA-Z])/
    const bad: string[] = []
    for (const mode of ['beginner', 'research'] as Mode[]) {
      const { container, unmount } = renderPage('/lab', mode)
      for (const t of TAB_ORDER) {
        fireEvent.click(tabButton(container, t))
        container.querySelectorAll('annotation').forEach((a) => {
          const tex = a.textContent ?? ''
          const m = LOST.exec(tex)
          if (m) bad.push(`${m[1]} ← ${tex.slice(0, 80)}`)
        })
      }
      unmount()
    }
    expect(Array.from(new Set(bad))).toEqual([])
  })

  it('手機寬度的防線：所有表格都在 .table-wrap 內；表格與獨立公式之外的行內公式都夠短（不會把頁面撐出水平捲軸）', () => {
    const { container } = renderPage('/lab', 'research')
    expect(Array.from(container.querySelectorAll('table')).filter((t) => !t.closest('.table-wrap'))).toHaveLength(0)
    const long: string[] = []
    container.querySelectorAll('span.c-tex').forEach((el) => {
      if (el.closest('.table-wrap, .c-texblock, .lab-tex-scroll')) return
      const n = (el.querySelector('.katex-html')?.textContent ?? '').length
      if (n > 40) long.push(`${n}: ${el.querySelector('annotation')?.textContent ?? ''}`)
    })
    expect(long).toEqual([])
  })

  it('Research 模式比 Beginner 多顯示內容（同一個計算核心，只改呈現）；Beginner 的逐步推導預設收合但仍在 DOM 內', () => {
    const b = renderPage('/lab', 'beginner')
    const nb = b.container.textContent?.length ?? 0
    expect(b.container.querySelectorAll('details.lab-steps').length).toBeGreaterThan(8)
    expect(b.container.querySelectorAll('details.lab-steps[open]').length).toBeLessThan(b.container.querySelectorAll('details.lab-steps').length)
    b.unmount()
    const r = renderPage('/lab', 'research')
    expect((r.container.textContent?.length ?? 0) - nb).toBeGreaterThan(300)
    expect(r.container.querySelectorAll('details.lab-steps[open]').length).toBeGreaterThan(8)
  })
})

describe('原始碼層級的檢查', () => {
  it('頁面顯示的 core region 都存在，且內容是實際執行的程式行', () => {
    const regions = listRegions(labSrc)
    for (const r of ['pathNone', 'pathType1', 'pathType2', 'type1FromBw', 'firstOrderResidue', 'replayInnerLoop', 'outputDecomposition', 'fracSpurClosedForm', 'ar1MeanVar', 'meanFieldTwin', 'linearPrediction', 'convergenceBlocks', 'fcwPoint', 'gmacSlopeCrn', 'jacobian', 'codeRandomization']) {
      expect(regions, r).toContain(r)
    }
    // 迴路與重播的 inner loop：前十行逐行對應（只差註解與 0/1 映射的寫法）
    const loop = extractRegion(blockSrc, 'blockLmsInnerLoop')
    const replay = extractRegion(labSrc, 'replayInnerLoop')
    for (const line of ['let dt = coef * x', 'const u = pathF === null ? dt : pathF.step(dt)', 'const e = u + bOff + sigma * gauss()', 'acc += q * xrn']) {
      expect(loop).toContain(line)
      expect(replay).toContain(line)
    }
    expect(replay).toContain('← 差異')
    expect(extractRegion(labSrc, 'pathType1')).toContain('den[1 + d] += k')
    expect(extractRegion(labSrc, 'gmacSlopeCrn')).toContain('common random numbers')
    // 頁面用到的 region 名稱都拿得到
    const used = new Set<string>()
    for (const { text } of sourceFiles()) for (const m of text.matchAll(/region[=:]\s*['"]([\w.-]+)['"]/g)) used.add(m[1])
    expect(used.size).toBeGreaterThanOrEqual(15)
  })

  it('JSX 屬性字串內的 TeX 用單一反斜線（雙反斜線會被 KaTeX 當成換行）', () => {
    const bad: string[] = []
    for (const { file, text } of sourceFiles()) {
      if (!file.endsWith('.tsx')) continue
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\b[A-Za-z]+="([^"]*)"/g)) if (m[1].includes('\\\\')) bad.push(`${file}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })

  it('勘誤小註都連到驗證頁，且引用的勘誤 ID 存在於 docs/validation.md', () => {
    const doc = readFileSync(resolve(process.cwd(), 'docs/validation.md'), 'utf8')
    const ids = new Set<string>()
    for (const { text } of sourceFiles()) for (const m of text.matchAll(/ErratumNote id="(E\d\d)"/g)) ids.add(m[1])
    for (const f of FORMULAS) if (f.erratumId) ids.add(f.erratumId)
    expect(ids.size).toBeGreaterThanOrEqual(12)
    for (const id of ids) expect(doc, id).toContain(`### ${id}｜`)
    const { container } = renderPage()
    const links = Array.from(container.querySelectorAll('a.lab-erratum')) as HTMLAnchorElement[]
    expect(links.length).toBeGreaterThan(15)
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^#\/verification\?e=E\d\d$/)
  })
})

describe('分頁', () => {
  it('五個分頁都能切換，各自的 ExperimentShell 出現；方向鍵可以換分頁', () => {
    const { container } = renderPage()
    const map = { pipeline: EXP.pipeline, fcw: EXP.fcw, mc: EXP.mc, training: EXP.training, compare: EXP.compare } as const
    for (const t of TAB_ORDER) {
      fireEvent.click(tabButton(container, t))
      expect(tabButton(container, t).getAttribute('aria-selected')).toBe('true')
      expect(shell(container, map[t]), t).not.toBeNull()
      expect(container.querySelectorAll('.c-exp')).toHaveLength(1) // 只掛載目前的分頁
      expect(tabButton(container, t).textContent).toContain(TAB_LABEL[t])
      expect(container.querySelectorAll('.c-tex-error')).toHaveLength(0)
    }
    fireEvent.click(tabButton(container, 'pipeline'))
    fireEvent.keyDown(container.querySelector('.lab-tabs') as HTMLElement, { key: 'ArrowRight' })
    expect(tabButton(container, 'fcw').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(container.querySelector('.lab-tabs') as HTMLElement, { key: 'ArrowLeft' })
    expect(tabButton(container, 'pipeline').getAttribute('aria-selected')).toBe('true')
  })

  it('每個數值控制項都有數字輸入欄、單位與 register / behavioral parameter 名稱', () => {
    const { container } = renderPage()
    const sh = shell(container, EXP.pipeline) as HTMLElement
    sh.querySelectorAll('details.lab-group').forEach((d) => ((d as HTMLDetailsElement).open = true))
    const params = Array.from(sh.querySelectorAll('.lab-group .c-param'))
    expect(params.length).toBeGreaterThan(25)
    for (const p of params) expect(p.querySelector('.c-param-reg')?.textContent?.length ?? 0, p.textContent ?? '').toBeGreaterThan(3)
    const numeric = params.filter((p) => p.querySelector('input[type="range"]'))
    expect(numeric.length).toBeGreaterThan(18)
    for (const p of numeric) expect(p.querySelector('input[type="text"]'), p.textContent ?? '').not.toBeNull()
    // 九組（register 的細項在開啟定點後才出現）
    expect(sh.querySelectorAll('details.lab-group').length).toBe(9)
  })

  it('頁內錨點不會被當成路由：點公式 ID 連結時 preventDefault 並捲到該公式', () => {
    const { container } = renderPage('/lab?preset=lab-negative-sum-mode', 'engineer', false)
    const a = document.createElement('a')
    a.setAttribute('href', '#formula-F-LAB.6')
    a.textContent = 'F-LAB.6'
    container.querySelector('.lab-page')?.appendChild(a)
    const target = container.querySelector('[id="formula-F-LAB.6"]') as HTMLElement
    const spy = vi.fn()
    target.scrollIntoView = spy
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    a.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('Pipeline 分頁：實際執行（jsdom 下 worker 以 inline 模式跑同一份函式）', () => {
  it('反面 preset（sum 模式忘了 scaling）：自動執行後顯示說明原因的警告、九級卡片、交叉比對明細與報告按鈕', async () => {
    const { container } = renderPage('/lab?preset=lab-negative-sum-mode', 'engineer', true)
    const sh = () => shell(container, EXP.pipeline) as HTMLElement
    await waitFor(() => expect(sh().querySelectorAll('.lab-stage').length).toBe(9), { timeout: 30_000 })
    // 預期文字（preset note）
    expect(sh().querySelector('.lab-preset-note')?.textContent).toContain('已載入 preset')
    // 警告：說明原因（不是只寫無法計算），而且全部可見
    const warns = Array.from(sh().querySelectorAll('.c-exp-warnings .callout')).map((n) => n.textContent ?? '')
    expect(warns.some((w) => w.includes('gm_mode=sum 時有效增益放大'))).toBe(true)
    expect(warns.some((w) => w.includes('一階模型不穩定'))).toBe(true)
    expect(warns.some((w) => w.includes('limit cycle'))).toBe(true)
    expect(warns.every((w) => !/\$[^$]+\$/.test(visibleTextOf(w)))).toBe(true)
    // 跨級一致性仍然是一致；mean w 的檢查是「不適用」
    expect(sh().querySelector('.lab-replay-badge')?.getAttribute('data-status')).toBe('ok')
    expect(sh().querySelector('tr[data-check="meanW"]')?.getAttribute('data-status')).toBe('n/a')
    expect(sh().querySelector('tr[data-check="replay"]')?.getAttribute('data-status')).toBe('ok')
    // 交叉比對三欄：Analytic 不亮綠燈
    const checks = Array.from(sh().querySelectorAll('.c-exp-crosscheck .c-check')).map((n) => n.className)
    expect(checks).toHaveLength(3)
    expect(checks[0]).toContain('c-check-n/a')
    // 每一級都有模型層級徽章與假設
    for (const st of Array.from(sh().querySelectorAll('.lab-stage'))) {
      expect(st.querySelector('.c-level')).not.toBeNull()
      expect(st.querySelector('.lab-stage-assume li')).not.toBeNull()
    }
    expect(buttonByText(sh(), '下載完整報告 JSON')).toBeDefined()
    expect(container.querySelectorAll('.c-tex-error')).toHaveLength(0)
    // Run-to-Convergence：不收斂時說明原因
    await act(async () => {
      fireEvent.click(buttonByText(sh(), '執行至收斂') as HTMLButtonElement)
    })
    expect(sh().textContent).toContain('無法「執行至收斂」')
    expect(sh().textContent).toContain('超過臨界值')
    // 單步：出現游標所在 block 的更新算式
    await act(async () => {
      fireEvent.click(buttonByText(sh(), '單步') as HTMLButtonElement)
    })
    expect(sh().querySelector('.lab-step table')).not.toBeNull()
    // 凍結：按鈕狀態切換
    const freeze = buttonByText(sh(), '凍結') as HTMLButtonElement
    fireEvent.click(freeze)
    expect((buttonByText(sh(), '已凍結') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
  }, 60_000)

  it('preset「固定點不是常數」：mean w 與 σ_w 都「一致」（比的是 mean-field 平均軌跡）；更新迴路那一級警告固定點在擺動；w 圖畫出兩條模型線', async () => {
    const { container } = renderPage('/lab?preset=lab-offset-fixed-point-swing', 'engineer', true)
    const sh = () => shell(container, EXP.pipeline) as HTMLElement
    await waitFor(() => expect(sh().querySelectorAll('.lab-stage').length).toBe(9), { timeout: 60_000 })
    expect(sh().querySelector('tr[data-check="meanW"]')?.getAttribute('data-status')).toBe('ok')
    expect(sh().querySelector('tr[data-check="sigmaW"]')?.getAttribute('data-status')).toBe('ok')
    expect(sh().querySelector('tr[data-check="meanW"]')?.textContent).toContain('mean-field 平均軌跡')
    const upd = sh().querySelector('.lab-stage[data-stage="update"]') as HTMLElement
    expect(upd.textContent).toContain('固定點不是常數')
    expect(upd.textContent).toContain('準靜態固定點')
    expect(upd.textContent).toContain('mean-field 平均軌跡（F-LAB.18）')
    // 警告也出現在實驗框最上方（全部警示可見），而且裡面的 TeX 都有被渲染
    const warns = Array.from(sh().querySelectorAll('.c-exp-warnings .callout')).map((n) => n.textContent ?? '')
    expect(warns.some((w) => w.includes('固定點不是常數'))).toBe(true)
    expect(container.querySelectorAll('.c-tex-error')).toHaveLength(0)
    // w 圖：mean-field 平均軌跡，加上線性時不變模型的對照線（兩者差很多 ⇒ 預設就顯示）
    await waitFor(() => expect(P.react.mock.calls.length).toBeGreaterThan(0))
    const traces = P.react.mock.calls.flatMap((c) => (c as unknown as [unknown, { name?: string; visible?: unknown }[]])[1])
    expect(traces.some((tr) => (tr.name ?? '').includes('mean-field 平均軌跡'))).toBe(true)
    const lin = traces.find((tr) => (tr.name ?? '').includes('線性時不變模型'))
    expect(lin).toBeDefined()
    expect(lin?.visible).toBe(true)
    // 圖例與軸標題是純文字（Plotly 不渲染 KaTeX）：不可以出現 $…$
    for (const tr of traces) expect(tr.name ?? '').not.toMatch(/\$/)
  }, 90_000)

  it('T13 錨點 preset：輸出是白雜訊，tone 表不列任何譜線，並寫出偵測的判據（prominence 與「高於鄰近中位數」）', async () => {
    const { container } = renderPage('/lab?preset=lab-t13-anchor', 'engineer', true)
    const sh = () => shell(container, EXP.pipeline) as HTMLElement
    await waitFor(() => expect(sh().querySelectorAll('.lab-stage').length).toBe(9), { timeout: 60_000 })
    expect(sh().textContent).toContain('沒有偵測到譜線')
    expect(sh().textContent).toContain('鄰近 bin 的中位數')
    expect(sh().querySelector('tr[data-check="meanW"]')?.getAttribute('data-status')).toBe('ok')
    // 兩條模型線重合（iid ±1、小訊號）：線性時不變模型預設收在圖例裡
    await waitFor(() => expect(P.react.mock.calls.length).toBeGreaterThan(0))
    const traces = P.react.mock.calls.flatMap((c) => (c as unknown as [unknown, { name?: string; visible?: unknown }[]])[1])
    expect(traces.find((tr) => (tr.name ?? '').includes('線性時不變模型'))?.visible).toBe('legendonly')
  }, 90_000)

  it('關掉自動重跑時不會自己執行；顯示「請按 Run」', async () => {
    const { container } = renderPage('/lab', 'engineer', false)
    const sh = shell(container, EXP.pipeline) as HTMLElement
    await new Promise((r) => setTimeout(r, 600))
    expect(sh.querySelectorAll('.lab-stage')).toHaveLength(0)
    expect(sh.querySelector('[data-testid="pipeline-status"]')?.textContent).toContain('請按「執行 Run」')
  })
})

describe('其他分頁的 preset 載入', () => {
  it('?preset=lab-fcw-delay-sign-flip：直接開在 FCW sweep 分頁、格點與選項已套用；按 Run 後有進度與 sign flip 的警告', async () => {
    const { container } = renderPage('/lab?preset=lab-fcw-delay-sign-flip', 'engineer', false)
    await waitFor(() => expect(shell(container, EXP.fcw)).not.toBeNull())
    const sh = () => shell(container, EXP.fcw) as HTMLElement
    expect(tabButton(container, 'fcw').getAttribute('aria-selected')).toBe('true')
    expect(sh().querySelector('.lab-preset-note')?.textContent).toContain('delayed regressor')
    await act(async () => {
      fireEvent.click(buttonByText(sh(), '執行 Run') as HTMLButtonElement)
    })
    await waitFor(() => expect(sh().querySelector('.lab-progress-text')?.textContent).toContain('25 / 25'), { timeout: 60_000 })
    const warns = Array.from(sh().querySelectorAll('.c-exp-warnings .callout')).map((n) => n.textContent ?? '')
    expect(warns.some((w) => w.includes('14 個 FCW') && w.includes('更新極性錯誤'))).toBe(true)
    expect(sh().querySelectorAll('tr.lab-row-bad').length).toBeGreaterThanOrEqual(14)
    expect(sh().querySelectorAll('.c-tex-error')).toHaveLength(0)
  }, 120_000)

  it('?preset=lab-compare-regressor：Compare 分頁出現 Case A / B / C 與差異表（regressor、code delay）', async () => {
    const { container } = renderPage('/lab?preset=lab-compare-regressor', 'engineer', false)
    await waitFor(() => expect(shell(container, EXP.compare)?.querySelectorAll('.c-case').length).toBe(3))
    const sh = shell(container, EXP.compare) as HTMLElement
    const diff = sh.querySelector('.lab-table') as HTMLElement
    expect(diff.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(diff.textContent).toContain('raw')
    expect(diff.textContent).toContain('delayed')
    expect(diff.textContent).toContain('filtered')
    expect(diff.textContent).toContain('64')
  })

  it('?preset=lab-training-code-compare：Training 分頁自動分析三組 code，摘要表列出秩與 condition number', async () => {
    const { container } = renderPage('/lab?preset=lab-training-code-compare', 'engineer', false)
    await waitFor(() => expect(shell(container, EXP.training)?.querySelectorAll('.c-case').length).toBe(3))
    const sh = () => shell(container, EXP.training) as HTMLElement
    await waitFor(() => expect(sh().textContent).toContain('分析完成'), { timeout: 60_000 })
    expect(sh().textContent).toContain('3 / 3')
    expect(sh().textContent).toContain('MASH 1-1-1 frac=0.001')
    expect(sh().querySelectorAll('.c-tex-error')).toHaveLength(0)
    const cc = Array.from(sh().querySelectorAll('.c-exp-crosscheck .c-check')).map((n) => n.className)
    expect(cc[1]).toContain('not-implemented') // Monte Carlo 欄誠實標示
  }, 120_000)

  it('?preset=lab-mc-t13：Monte Carlo 分頁，runs = 16；尚未執行時三欄都不是「一致」', async () => {
    const { container } = renderPage('/lab?preset=lab-mc-t13', 'engineer', false)
    await waitFor(() => expect(shell(container, EXP.mc)).not.toBeNull())
    const sh = shell(container, EXP.mc) as HTMLElement
    expect(sh.textContent).toContain('16 個 runs')
    const cc = Array.from(sh.querySelectorAll('.c-exp-crosscheck .c-check')).map((n) => n.className)
    expect(cc.every((c) => !c.includes('c-check-ok'))).toBe(true)
  })
})

/** 警告文字（已是 textContent）裡 KaTeX 的 annotation 會帶 TeX 原始碼，但不會有 `$`；這裡只是語意上的別名。 */
function visibleTextOf(s: string): string {
  return s
}
