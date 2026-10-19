import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { extractRegion, FormulaLink, listRegions } from '@/components'
import blockSrc from '@/simulation/models/blockLms.ts?raw'
import labSrc from '@/simulation/models/unifiedLab.ts?raw'
import { unicodeMathIn } from '@/components/mermaidTestUtils'
import { LAB_CHARTS } from './diagrams'
import { FORMULAS } from './formulas'
import LabPage from './index'
import { EXP, TAB_LABEL, TAB_ORDER } from './logic'
import { LAB_SYMBOLS } from './symbols'
import { plotlyMock } from '@/test/mocks/plotly'
import { renderPage as renderInApp } from '@/test/renderPage'
import { expectTexParses, expectNoTexErrors } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

type Mode = 'beginner' | 'engineer' | 'research'

/** 比對 TeX 原始碼用：反斜線只寫一次（與各 section 的 String.raw 相同） */
const R = String.raw

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
  await new Promise((r) => setTimeout(r, 0))
})

function renderPage(url = '/lab', mode: Mode = 'engineer', autorun = false) {
  localStorage.setItem('lmspll.mode', mode)
  localStorage.setItem('lmspll.lab.autorun', JSON.stringify(autorun))
  return renderInApp(<LabPage />, { url })
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
      expectNoTexErrors(container)
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
    expect(FORMULAS.map((f) => f.id)).toEqual(Array.from({ length: 21 }, (_, i) => `F-LAB.${i + 1}`))
    for (const f of FORMULAS) {
      expect(f.page).toBe('/lab')
      expectTexParses(f.tex, f.id, { strict: 'ignore' })
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
    expect(LAB_SYMBOLS.length).toBeGreaterThanOrEqual(30)
    for (const s of LAB_SYMBOLS) {
      expectTexParses(s.symbol, s.symbol, { strict: 'ignore' })
      if (s.unit) expectTexParses(s.unit as string, s.unit, { strict: 'ignore' })
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

  it('方塊圖：六張圖各出現一次，都有圖說與「先看…」導讀，並放在對應公式／實驗之前（docs/teaching-style.md §8）', () => {
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
      const walk = f.closest('.lab-diagram')?.querySelector('.c-chapter-fig-walk-body')
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
      ['9 個權重方塊圖', '#lab-s5b2', 'formula-F-LAB.19'],
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

  it('架構約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端、校正迴路的輸入是 PD 的輸出；§4.4 的推導從 reference 輸入注入，兩條路都是正號', () => {
    const { container } = renderPage('/lab', 'research')
    const tex = (root: Element) => Array.from(root.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    // §1：第一次給物理圖像的地方——DTC 的位置、回授路徑、補償量、PD 量的是 t_ref' − t_fb、校正迴路的輸入
    const s1 = container.querySelector('section[aria-labelledby="lab-s1"]') as HTMLElement
    for (const need of [
      'DTC 在 reference 的輸入端',
      'Reference clock → DTC → phase detector',
      '回授路徑上只有 divider',
      '比理想時刻早到',
      '只能延遲、不能提前',
      '固定的基準延遲往回扣',
      '補償量',
      '補償不足',
      'reference 還是太晚',
      '校正迴路的輸入就是 phase detector 的輸出',
      '送進 loop filter 的同一個訊號',
    ]) {
      expect(s1.textContent, need).toContain(need)
    }
    expect(tex(s1)).toContain(R`t_{\mathrm{ref}}'-t_{\mathrm{fb}}`)
    // 大小用 |x| 寫（feedback 早到 a|x|、補償量 w|x|、剩下 (a − w)|x|），帶正負號的式子才是 (a − w)x
    for (const t of [R`a\,|x|`, R`w\,|x|`, R`(a-w)\,|x|`, R`(a-w)\,x`, 'w<a']) expect(tex(s1), t).toContain(t)
    // 不再說 DTC「推」或「延遲」feedback edge
    expect(s1.textContent).not.toMatch(/DTC[^。]{0,12}(延遲|推)[^。]{0,8}(feedback|divider|回授)/)
    // §2：九級訊號鏈的圖說與導讀
    const s2 = container.querySelector('section[aria-labelledby="lab-s2"]') as HTMLElement
    const fig2 = s2.querySelector('figure.c-mermaid') as HTMLElement
    expect(fig2.getAttribute('aria-label')).toContain('DTC 在 reference 輸入端')
    expect(fig2.getAttribute('aria-label')).toContain('comparator 的輸入是 PD 的輸出')
    expect(fig2.querySelector('figcaption')?.textContent).toContain('DTC 在 reference 輸入端')
    const walk2 = s2.querySelector('.c-chapter-fig-walk-body')?.textContent ?? ''
    for (const need of ['DTC 在 reference 的輸入端', '從 PD 的 reference', '回授路徑上只有 divider', 'PD 的輸出', '送進 loop filter 的同一個訊號']) expect(walk2, need).toContain(need)
    // 每一級的主要假設也寫了接法
    expect(s2.textContent).toContain('DTC 在 reference 輸入端；靜態非線性')
    expect(s2.textContent).toContain('輸入取自 PD 的輸出')
    // §4.3：補償量從基準延遲 T_0 往回扣；模型式子不變
    const s43 = container.querySelector('#lab-s43') as HTMLElement
    for (const need of ['DTC 在 reference 的輸入端', '回授路徑上只有 divider', '補償量', '只能延遲、不能提前', '基準延遲', '被主 PLL 當成靜態相位偏移吸收', '「DTC 之後的 reference edge」減「feedback edge」', '早到']) {
      expect(s43.textContent, need).toContain(need)
    }
    expect(s43.textContent).not.toMatch(/應該產生.{0,40}的延遲/)
    expect(tex(s43)).toContain(R`\tau_{\mathrm{DTC}}[n]=T_0-w_{\mathrm{app}}\,|r[n]|`)
    expect(tex(s43)).toContain(R`t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w_{\mathrm{app}})\,|r[n]|`)
    expect(tex(s43).some((t) => t.startsWith(R`e_{\mathrm{DTC}}[n]=\underbrace{(a-w_{\mathrm{app}})\,x[n]}`))).toBe(true)
    // 正負號：補償不足（w < a）時 reference 太晚、t_ref' − t_fb 為正；本頁的 x 是 residue（≤ 0），所以圖上的 e_DTC 的 gain 項與 t_ref' − t_fb 反號，
    // 但 q·x_ref 的統計與更新式不變；不隨 x 變號的三項（o_DTC、c_2 x²、b）另外交代
    for (const need of ['正負號', '兩者差一個負號', '補償不足', 'reference 還是太晚，誤差為正', '同時變號', '相反', '的統計不變', '不隨', '相對本頁的']) expect(s43.textContent, need).toContain(need)
    for (const t of [R`w_{\mathrm{app}}<a`, R`-1<r\le0`, R`x=r\le0`, R`q\,x_{\mathrm{ref}}`, R`c_2x^2`]) expect(tex(s43), t).toContain(t)
    // 沒有把 reference edge 寫成被 DTC「提前」而不交代基準延遲：出現「提早／提前」的段落一定同時有 T_0
    for (const para of Array.from(s43.querySelectorAll('p'))) {
      const txt = para.textContent ?? ''
      if (/提早|提前/.test(txt)) expect(tex(para).some((t) => t.includes('T_0')), txt.slice(0, 40)).toBe(true)
    }
    // §4.4：e_DTC 從 PD 的 reference 輸入進來；u_pd = +H_PD·e_DTC、t_out = +T·e_DTC；comparator 取 PD 的輸出
    const s44 = container.querySelector('#lab-s44') as HTMLElement
    for (const need of ['reference 輸入', '回授路徑上只有 divider', 'PD 的輸出', '校正迴路的輸入就是 PD', '送進 loop filter 的同一個訊號', '它就是 phase detector']) expect(s44.textContent, need).toContain(need)
    const fig4 = s44.querySelector('figure.c-mermaid') as HTMLElement
    expect(fig4.getAttribute('aria-label')).toContain('reference 輸入')
    expect(fig4.getAttribute('aria-label')).toContain('comparator 取的也是它')
    // 圖照電路的接法畫：Reference clock → DTC → PD；VCO → divider → PD（回授路徑上只有 divider，DTC 不在裡面）
    expect(fig4.getAttribute('aria-label')).toContain('Reference clock 經 DTC 接到 phase detector 的 reference 輸入')
    expect(fig4.getAttribute('aria-label')).toContain('只經過 divider 回到 phase detector 的另一個輸入')
    expect(fig4.querySelector('figcaption')?.textContent).toContain('Reference clock → DTC → phase detector')
    expect(fig4.querySelector('figcaption')?.textContent).toContain('只經過 divider')
    const walk4 = Array.from(s44.querySelectorAll('.c-chapter-fig-walk-body p')).map((p) => p.textContent ?? '').join('\n')
    for (const need of ['Reference clock 經 DTC 進來的', 'divider 送回來', '從 VCO 回到 PD 的路上只有 divider，DTC 不在裡面', 'divider 不改變 edge 的時間誤差']) expect(walk4, need).toContain(need)
    const t44 = tex(s44)
    expect(t44).toContain(R`u_{\mathrm{pd}}=e_{\mathrm{DTC}}-\theta_{\mathrm{fb}}`)
    expect(t44).toContain(R`\theta_{\mathrm{fb}}=L(z)\,u_{\mathrm{pd}}`)
    expect(t44).toContain(R`u_{\mathrm{pd}}\,(1+L)=e_{\mathrm{DTC}}\ \Rightarrow\ u_{\mathrm{pd}}=\frac{1}{1+L}\,e_{\mathrm{DTC}}=H_{\mathrm{PD}}\,e_{\mathrm{DTC}}`)
    expect(t44).toContain(R`t_{\mathrm{out}}=\theta_{\mathrm{fb}}=L\,u_{\mathrm{pd}}=\frac{L}{1+L}\,e_{\mathrm{DTC}}`)
    expect(t44).toContain(R`H_{\mathrm{PD}}+T=\frac{1}{1+L}+\frac{L}{1+L}=1`)
    // 沒有帶負號的版本（−H_PD、−T、−1/(1+L)、−L/(1+L)）：那是殘差從 PD 的另一個輸入進來時的寫法
    for (const t of t44) expect(t, t).not.toMatch(/=\s*-\s*(H_\{\\mathrm\{PD\}\}|T\b|\\frac\{L\}\{1\+L\}|\\frac\{1\}\{1\+L\})/)
    // §4.5：comparator 的輸入
    expect(container.querySelector('#lab-s45')?.textContent).toContain('comparator 取的是 PD 的輸出')
    // 符號表與公式登錄
    const sym = (symbol: string) => LAB_SYMBOLS.find((x) => x.symbol === symbol)
    expect(sym('e_{\\mathrm{DTC}}[n]')?.note).toBe('DTC 在 reference 輸入端：它從 PD 的 reference 輸入進到主迴路')
    expect(container.querySelector('#symbols')?.textContent).toContain('送進 loop filter，comparator 取的也是它')
    const f4 = FORMULAS.find((f) => f.id === 'F-LAB.4')
    expect(f4?.conditions).toContain('e_DTC 從 PD 的 reference 輸入注入')
    expect(f4?.conditions).toContain('u_pd = +H_PD{e_DTC}')
    expect(f4?.conditions).toContain('t_out = +T{e_DTC}')
    expect(f4?.tex).toContain(R`H_{\mathrm{PD}}(z)=\frac{1}{1+L(z)},\quad T(z)=\frac{L(z)}{1+L(z)}=1-H_{\mathrm{PD}}(z)`)
    // Research 的「還缺什麼」：注入點寫成全站的約定
    const s9 = container.querySelector('section[aria-labelledby="lab-s9"]') as HTMLElement
    expect(s9.textContent).toContain('DTC 在 reference 輸入端')
    expect(s9.textContent).toContain('一起變號')
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

  it('沒有舊接法的說法（規則見 OLD：圖上 divider 接 DTC、DTC 的位置、延遲的寫法、帶負號的轉移）；新的接法寫在圖的原始碼裡', () => {
    const OLD: RegExp[] = [
      /\b(DIV|MMD|PMUX)\w*\s*-[-.]+>?\s*(\|[^|\n]*\|\s*)?DTC\b/, // 圖：divider → DTC
      /(divider|除頻器?)\s*(之後|後面)的?\s*DTC/,
      /DTC\s*(在|放在|位於)\s*(回授|feedback)/,
      /DTC[^。\n]{0,16}插入[^。\n]{0,8}延遲/,
      /推回理想時刻/,
      /應該產生[^。\n]{0,60}的延遲來抵銷/,
      /=\s*-\s*H_\{\\+mathrm\{PD\}\}\s*(\\+,|\\+cdot)?\s*(e_\{\\+mathrm\{DTC|\\+(var)?phi_\{\\+mathrm\{dtc)/,
      /=\s*-\s*T\s*(\\+,|\\+cdot)?\s*(e_\{\\+mathrm\{DTC|\\+(var)?phi_\{\\+mathrm\{dtc)/,
    ]
    const bad: string[] = []
    for (const { file, text } of sourceFiles()) for (const re of OLD) if (re.test(text)) bad.push(`${file}: ${re}`)
    expect(bad).toEqual([])
    // 反過來：新的接法確實寫在圖的原始碼裡
    const src = sourceFiles().find((f) => f.file === '/diagrams.ts')?.text ?? ''
    expect(src).toContain('Reference clock → DTC')
    expect(src).toContain('DIV["Divider')
    expect(src).toContain('DIV -- "−" --> S')
    expect(src).toContain('subgraph PD["Phase detector"]')
    expect(src).toContain('comparator 取 PD 的輸出')
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
    for (const { text } of sourceFiles()) for (const m of text.matchAll(/ErratumLink id="(E\d\d)"/g)) ids.add(m[1])
    for (const f of FORMULAS) if (f.erratumId) ids.add(f.erratumId)
    expect(ids.size).toBeGreaterThanOrEqual(12)
    for (const id of ids) expect(doc, id).toContain(`### ${id}｜`)
    const { container } = renderPage()
    const links = Array.from(container.querySelectorAll('a.c-erratum-link')) as HTMLAnchorElement[]
    expect(links.length).toBeGreaterThan(15)
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^#?\/verification\?e=E\d\d$/)
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
      expectNoTexErrors(container)
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

  it('頁內錨點不會被當成路由：「跳到第 7 節的 Lab」與公式 ID 連結點擊時 preventDefault 並捲到目標，href 是真的路由網址', () => {
    const { container } = renderPage('/lab?preset=lab-negative-sum-mode', 'engineer', false)
    // 「跳到第 7 節的 Lab」：AnchorLink（href = 目前路由 + ?a=）
    const jump = container.querySelector('a[data-anchor-link="lab-experiments"]') as HTMLAnchorElement
    expect(jump).toBeTruthy()
    expect(jump.getAttribute('href')).toMatch(/^#\/lab\?.*a=lab-experiments$/)
    const section = container.querySelector('[id="lab-experiments"]') as HTMLElement
    const sectionSpy = vi.fn()
    section.scrollIntoView = sectionSpy
    const ev0 = new MouseEvent('click', { bubbles: true, cancelable: true })
    jump.dispatchEvent(ev0)
    expect(ev0.defaultPrevented).toBe(true)
    expect(sectionSpy).toHaveBeenCalledTimes(1)
    // 公式 ID 連結（共用 MetricTable 的「公式」欄用的就是 FormulaLink）
    const holder = document.createElement('div')
    document.body.appendChild(holder)
    const view = render(<FormulaLink id="F-LAB.6" />, { container: holder })
    const a = view.getByText('F-LAB.6')
    expect(a.getAttribute('href')).toBe('#/formulas?f=F-LAB.6')
    const target = container.querySelector('[id="formula-F-LAB.6"]') as HTMLElement
    const spy = vi.fn()
    target.scrollIntoView = spy
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    a.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    view.unmount()
    holder.remove()
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
    // 沒有用途的捲軸（使用者要求拿掉）：九級卡片的寬度由結果欄決定（放不下兩張就單欄），不再硬排兩欄讓每張表都橫向捲動；
    // 數值欄是文字（例如 PLL 的設計描述）時可以換行，數字不拆開；交叉比對明細用收窄的字級與留白，五欄放得進結果欄
    const labCss = readFileSync(resolve(PAGE_DIR, 'lab.css'), 'utf8')
    const stagesRule = /\.lab-stages \{([^}]*)\}/.exec(labCss)?.[1] ?? ''
    expect(stagesRule).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr))')
    expect(labCss).not.toMatch(/\.lab-stages \{[^}]*repeat\(2,/)
    expect(/\.lab-stage-table td\.lab-num-text \{([^}]*)\}/.exec(labCss)?.[1] ?? '').toMatch(/white-space:\s*normal/)
    const pllCells = Array.from(sh().querySelectorAll('.lab-stage[data-stage="pll"] td.lab-num'))
    expect(pllCells.some((td) => td.classList.contains('lab-num-text') && (td.textContent ?? '').includes('DPLL'))).toBe(true)
    for (const td of Array.from(sh().querySelectorAll('.lab-stage td.lab-num-text'))) expect(td.textContent ?? '', '純數字的格子不該可換行').not.toMatch(/^-?\d+(\.\d+)?(e[-+]?\d+)?$/)
    expect(sh().querySelector('tr[data-check="replay"]')?.closest('table')?.classList.contains('lab-check-table')).toBe(true)
    // 字級與留白不再寫在 lab.css：components.css 的層級對映把 .lab-check-table 放在 xs 層級（--table-fs-xs = 0.82rem、--table-pad-*-xs）
    const componentsCss = readFileSync(resolve(process.cwd(), 'src/components/components.css'), 'utf8')
    expect(componentsCss).toMatch(/\.page :is\([^)]*\.lab-check-table[^)]*\) \{\s*font-size: var\(--table-fs-xs\);/)
    expect(readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')).toMatch(/--table-fs-xs:\s*0\.82rem/)
    expect(labCss).not.toMatch(/\.lab-check-table \{/)
    expect(buttonByText(sh(), '下載完整報告 JSON')).toBeDefined()
    expectNoTexErrors(container)
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

  it('使用者的架構 preset（lab-user-sspll-pmux8）：自動執行後出現 9 個權重的表與三項 9 權重交叉比對（都一致）；參數面板的架構與正負號說明；Analytic／Monte Carlo 兩欄都一致', async () => {
    const { container } = renderPage('/lab?preset=lab-user-sspll-pmux8', 'engineer', true)
    const sh = () => shell(container, EXP.pipeline) as HTMLElement
    await waitFor(() => expect(sh().querySelector('[data-testid="pmux-weights"]')).not.toBeNull(), { timeout: 60_000 })
    expect(sh().querySelectorAll('[data-testid="pmux-weights"] tr[data-weight]')).toHaveLength(9)
    for (const k of ['meanW', 'sigma', 'stability']) expect(sh().querySelector(`tr[data-check="pmux-${k}"]`)?.getAttribute('data-status'), k).toBe('ok')
    expect(sh().querySelector('[data-group-note="dsm"]')?.textContent).toContain('8 相 PMUX')
    expect(sh().querySelector('[data-group-note="code"]')?.textContent).toContain('spec')
    const cc = Array.from(sh().querySelectorAll('.c-exp-crosscheck .c-check')).map((n) => n.className)
    expect(cc[0]).toContain('c-check-ok')
    expect(cc[1]).toContain('c-check-ok')
    // PLL 卡片列出反號帶（資訊性註記，不是紅色警告）
    expect(sh().querySelector('.lab-stage[data-stage="pll"]')?.textContent).toContain('反號帶')
    const warns = Array.from(sh().querySelectorAll('.c-exp-warnings .callout')).map((n) => n.textContent ?? '')
    expect(warns.some((w) => w.includes('這個迴路有反號帶'))).toBe(false)
    expectNoTexErrors(container)
  }, 120_000)

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
    expectNoTexErrors(container)
    // w 圖：mean-field 平均軌跡，加上線性時不變模型的對照線（兩者差很多 ⇒ 預設就顯示）
    await waitFor(() => expect(plotlyMock.react.mock.calls.length).toBeGreaterThan(0))
    const traces = plotlyMock.react.mock.calls.flatMap((c) => (c as unknown as [unknown, { name?: string; visible?: unknown }[]])[1])
    expect(traces.some((tr) => (tr.name ?? '').includes('mean-field 平均軌跡'))).toBe(true)
    const lin = traces.find((tr) => (tr.name ?? '').includes('線性時不變模型'))
    expect(lin).toBeDefined()
    expect(lin?.visible).toBe(true)
    // 圖例與軸標題：作者寫 `$...$`（LaTeX），<Plot> 先用 plotMath 轉成 Plotly 的 pseudo-HTML（斜體符號與上下標）——送進 Plotly 的字串不可殘留 `$`、反斜線或大括號
    const shown = plotlyMock.react.mock.calls.flatMap((c) => {
      const [, data, layout] = c as unknown as [unknown, { name?: string }[], { xaxis?: { title?: { text?: string } }; yaxis?: { title?: { text?: string } } }?]
      return [...data.map((t) => t.name ?? ''), layout?.xaxis?.title?.text ?? '', layout?.yaxis?.title?.text ?? '']
    })
    expect(shown.filter(Boolean).length).toBeGreaterThan(8)
    for (const t of shown) expect(t, t).not.toMatch(/[$\\{}]/)
    // 斜體符號與下標：w_k 的圖例是 <i>w</i><sub><i>k</i></sub>，a 的圖例是 <i>a</i>，軸標題 block <i>k</i>
    expect(shown).toContain('<i>w</i><sub><i>k</i></sub>（內部暫存器）')
    expect(shown.some((t) => t.startsWith('<i>a</i>（真實 gain 誤差）'))).toBe(true)
    expect(shown).toContain('block <i>k</i>')
    expect(shown.some((t) => t.includes('<i>w</i><sup>∗</sup>'))).toBe(true)
    // 控制項的 label／unit／hint 與指標表：KaTeX 以外的文字沒有 Unicode 拼的數學（只有 Plotly 與 <option> 是純文字例外）
    const plainOf = (el: Element) => {
      const copy = el.cloneNode(true) as Element
      copy.querySelectorAll('.katex').forEach((k) => k.remove())
      return (copy.textContent ?? '').replace(/\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b/g, ' ')
    }
    for (const el of Array.from(sh().querySelectorAll('.c-param-label, .c-param-unit, .c-param-hint, .c-metric-table tbody th, .c-metric-table tbody td'))) {
      expect(unicodeMathIn(plainOf(el)), `「${el.textContent}」（${el.className}）`).toEqual([])
    }
  }, 90_000)

  it('T13 錨點 preset：輸出是白雜訊，tone 表不列任何譜線，並寫出偵測的判據（prominence 與「高於鄰近中位數」）', async () => {
    const { container } = renderPage('/lab?preset=lab-t13-anchor', 'engineer', true)
    const sh = () => shell(container, EXP.pipeline) as HTMLElement
    await waitFor(() => expect(sh().querySelectorAll('.lab-stage').length).toBe(9), { timeout: 60_000 })
    expect(sh().textContent).toContain('沒有偵測到譜線')
    expect(sh().textContent).toContain('鄰近 bin 的中位數')
    expect(sh().querySelector('tr[data-check="meanW"]')?.getAttribute('data-status')).toBe('ok')
    // 兩條模型線重合（iid ±1、小訊號）：線性時不變模型預設收在圖例裡
    await waitFor(() => expect(plotlyMock.react.mock.calls.length).toBeGreaterThan(0))
    const traces = plotlyMock.react.mock.calls.flatMap((c) => (c as unknown as [unknown, { name?: string; visible?: unknown }[]])[1])
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
    expectNoTexErrors(sh())
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
    expectNoTexErrors(sh())
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
