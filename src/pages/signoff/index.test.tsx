import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PAGES } from '@/app/registry'
import { SettingsProvider } from '@/app/settings'
import { HANDCALCS } from './handcalcs'
import SignoffPage from './index'
import { ReviewMatrix } from './sections/S1Matrix'
import { S3Claims } from './sections/S3Claims'
import { STORAGE_KEY } from './review'
import { FORMULAS } from './formulas'
import { SIGNOFF_CHARTS } from './diagrams'
import { SYMBOLS } from './symbols'

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
  default: { initialize: vi.fn(), render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })) },
}))
const dl = vi.hoisted(() => ({ calls: [] as { name: string; mime: string; text: string }[] }))
vi.mock('@/components', async (orig) => {
  const mod = await orig<typeof import('@/components')>()
  return {
    ...mod,
    downloadText: (name: string, mime: string, text: string) => {
      dl.calls.push({ name, mime, text })
    },
  }
})

function wrap(node: ReactNode) {
  return (
    <MemoryRouter initialEntries={['/signoff']}>
      <SettingsProvider>{node}</SettingsProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  dl.calls.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('Sign-off 頁（jsdom smoke）', () => {
  it('完整頁面可以渲染：符號表、各段落、六個實驗、四題手算、公式錨點、勘誤連到 #/verification?e=Exx，且沒有 KaTeX 解析錯誤與 console error', async () => {
    localStorage.setItem('lmspll.mode', 'research') // Research 模式顯示全部內容（ModeGate）
    const errSpy = vi.spyOn(console, 'error')
    const { container } = render(wrap(<SignoffPage />))
    // 標題含 KaTeX 時 jsdom 無法計算 accessible name（getByRole 會丟例外），改以文字開頭比對
    const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent ?? '')
    for (const t of [
      '0. 簽核（sign-off）要回答什麼？',
      '1. Sign-off Matrix（規格 §16.2，互動）',
      '2. 基本正確性：用 freeze + ',
      '2.5 SSPLL GOS／PHOS：每個參數都要自己的極性檢查',
      '3. 何時可以宣稱穩定：每一種措辭的數學意義（規格 §16.3）',
      '3.5 證據強度：',
      '4. Corner：同一個 ',
      '5. FCW 與 Noise：',
      '6. 非線性與定點：',
      '7. 多參數：',
      '8. 校正策略與 output：',
      '9. 反面測試（規格 §17）：確認系統會「失敗得正確」',
      '10. 附錄 B：數學與工程上的十項關鍵限制',
      '11. 思考題與本頁必記',
    ]) {
      expect(headings.some((h) => h.startsWith(t)), t).toBe(true)
    }
    for (const id of ['signoff-polarity-perturb', 'signoff-sspll-jacobian', 'signoff-evidence', 'signoff-corner-judge', 'signoff-fixed-point', 'signoff-mimo-judge']) {
      expect(container.querySelector(`[data-experiment="${id}"]`), id).toBeTruthy()
    }
    for (const f of FORMULAS) expect(container.querySelector(`[id="formula-${f.id}"]`), f.id).toBeTruthy()
    const errata = Array.from(container.querySelectorAll('a.so-erratum'))
    expect(errata.length).toBeGreaterThan(20)
    for (const a of errata) expect(a.getAttribute('href')).toBe(`#/verification?e=${a.getAttribute('data-erratum')}`)
    for (const a of errata) expect(a.getAttribute('data-erratum')).toMatch(/^E\d\d$/)
    // 八個 case + 反面測試；附錄 B 十張卡；§16.3 範例
    expect(container.querySelectorAll('details.so-case').length).toBe(9)
    expect(container.querySelectorAll('[data-limit]').length).toBe(10)
    expect(container.querySelectorAll('[data-statement]').length).toBeGreaterThanOrEqual(10)
    expect(container.querySelectorAll('[data-negative]').length).toBe(12)
    // Polarity 實驗的 Case B（D = 0）必須出現解釋型的極性警告
    // （大型 DOM 上 getByText／getByRole 很慢，這裡直接用 selector）
    const polarity = container.querySelector('[data-experiment="signoff-polarity-perturb"]') as HTMLElement
    await waitFor(() => expect(Array.from(polarity.querySelectorAll('.c-exp-warnings p')).some((p) => (p.textContent ?? '').startsWith('Case B：C ≤ 0：更新極性錯誤'))).toBe(true))
    // 展開所有思考題的解析後，整頁（含警告、指標、圖標題、推導理由）不得有 KaTeX 解析錯誤
    const answerButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === '看答案與解析')
    expect(answerButtons.length).toBe(6)
    for (const b of answerButtons) fireEvent.click(b)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(600)
    const texErrors = Array.from(container.querySelectorAll('.katex-error, .c-tex-error')).map((e) => e.textContent)
    expect(texErrors).toEqual([])
    // 字串屬性中的 `$…$` 都已轉成 KaTeX：頁面文字不應殘留成對的 $…$
    const leftover = Array.from(container.querySelectorAll('p, li, td, th, dd, dt, h2, h3, h4, summary, figcaption, label, .c-callout-title'))
      .map((e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(''))
      .filter((t) => /\$[^$]+\$/.test(t))
    expect(leftover).toEqual([])
    // 四題「帶入手算」依頁面順序出現（§2.2、§2.5、§3.5、§4），各自帶著「換你算」的引導與完整步驟
    const hc = Array.from(container.querySelectorAll('section.c-handcalc'))
    expect(hc.map((el) => el.id)).toEqual(HANDCALCS.map((h) => `handcalc-${h.id}`))
    for (const el of hc) {
      const id = el.id.replace('handcalc-', '')
      expect(el.parentElement?.getAttribute('data-handcalc'), id).toBe(id)
      expect(el.parentElement?.querySelector('.so-handcalc-lead')?.textContent, id).toContain('換你算')
      expect(el.querySelectorAll('.c-step').length, id).toBeGreaterThanOrEqual(7)
      expect(el.querySelectorAll('.c-handcalc-results .katex-display').length, id).toBeGreaterThanOrEqual(2)
    }
    // 每一題都落在對應的段落之後、對應的實驗之前
    const before = (a: Element | null, b: Element | null) => Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const exp = (id: string) => container.querySelector(`[data-experiment="${id}"]`)
    const formula = (id: string) => container.querySelector(`[id="formula-${id}"]`)
    expect(before(formula('F-SO.3'), hc[0]) && before(hc[0], exp('signoff-polarity-perturb'))).toBe(true)
    expect(before(formula('F-SO.12'), hc[1]) && before(hc[1], exp('signoff-sspll-jacobian'))).toBe(true)
    expect(before(formula('F-SO.8'), hc[2]) && before(hc[2], exp('signoff-evidence'))).toBe(true)
    expect(before(formula('F-SO.5'), hc[3]) && before(hc[3], exp('signoff-corner-judge'))).toBe(true)
    // 站內連結（HashRouter 的 #/…，以及 <Link> 在 MemoryRouter 下的 /…）都指向已註冊的路由
    const paths = new Set(PAGES.map((p) => p.path))
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') as string)
    const internal = hrefs.filter((h) => h.startsWith('#/') || h.startsWith('/'))
    expect(internal.length).toBeGreaterThan(80)
    for (const h of internal) expect(paths.has(h.replace(/^#/, '').split('?')[0]), h).toBe(true)
    // 其餘的 href 只能是本頁公式錨點（MetricTable 的 #formula-F-SO.n），而且錨點存在
    for (const h of hrefs.filter((x) => !internal.includes(x))) {
      expect(h, h).toMatch(/^#formula-F-SO\.\d+$/)
      expect(container.querySelector(`[id="${h.slice(1)}"]`), h).toBeTruthy()
    }
    // HashRouter 下 '#formula-…' 會被當成路由：頁面根節點必須攔截，改成捲到公式（不可讓瀏覽器照預設行為換 hash）
    const formulaLink = container.querySelector('[data-experiment="signoff-polarity-perturb"] a[href="#formula-F-SO.4"]') as HTMLAnchorElement
    expect(formulaLink).toBeTruthy()
    const target = container.querySelector('[id="formula-F-SO.4"]') as HTMLElement
    const scrolled = vi.fn()
    target.scrollIntoView = scrolled
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    formulaLink.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(scrolled).toHaveBeenCalledTimes(1)
    // 手機版：所有表格都包在可以自己水平捲動的容器裡（不會把頁面撐出水平捲軸）
    for (const t of Array.from(container.querySelectorAll('table'))) expect(t.closest('.table-wrap'), (t.textContent ?? '').slice(0, 40)).toBeTruthy()
    // 無障礙：每個輸入元件都有可讀的名稱（<label> 包住、aria-label 或 aria-labelledby）
    for (const el of Array.from(container.querySelectorAll('input, select, textarea'))) {
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && container.querySelector(`label[for="${el.id}"]`))
      expect(Boolean(named), el.outerHTML.slice(0, 120)).toBe(true)
    }
    // 渲染過程沒有 console.error（React key／prop 警告、KaTeX 例外…）
    expect(errSpy.mock.calls.map((c) => String(c[0]))).toEqual([])
  }, 240000)

  it('符號表在頁末：全頁只有一張，包在 id="symbols" 裡，是頁面的最後一個區塊（在「本頁必記」之後）；頁首只留一行按鈕，符號表的 TeX 都能解析', async () => {
    const katex = (await import('katex')).default
    for (const r of SYMBOLS) {
      expect(() => katex.renderToString(r.symbol, { throwOnError: true, strict: 'ignore' }), r.symbol).not.toThrow()
      if (r.unit) expect(() => katex.renderToString(r.unit as string, { throwOnError: true, strict: 'ignore' }), r.unit).not.toThrow()
    }
    expect(new Set(SYMBOLS.map((r) => r.symbol)).size).toBe(SYMBOLS.length) // React key 不重複
    const { container } = render(wrap(<SignoffPage />))
    const precedes = (x: Element | null, y: Element | null) => !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
    const page = container.querySelector('.so-page') as HTMLElement
    const symbols = container.querySelector('#symbols') as HTMLElement
    expect(symbols).not.toBeNull()
    expect(container.querySelectorAll('.c-symbols')).toHaveLength(1)
    expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(SYMBOLS.length)
    expect(page.lastElementChild).toBe(symbols)
    expect(symbols.lastElementChild?.classList.contains('c-symbols')).toBe(true)
    expect(precedes(container.querySelector('#so-wrap'), symbols)).toBe(true)
    expect(precedes(container.querySelector('.c-recap'), symbols)).toBe(true)
    expect(symbols.querySelector('h2')?.textContent).toBe('本頁符號表')
    // §0 裡不再有符號表
    expect(container.querySelector('#so-intro .c-symbols')).toBeNull()
    expect(container.querySelector('.c-symbols')?.closest('#symbols')).toBe(symbols)
    // 頁首只留一行「本頁符號表在最後 ↓」：是按鈕（HashRouter 下 href="#symbols" 會被當成路由），而且在第 0 節之前
    const jump = container.querySelector('.so-symbols-jump button') as HTMLButtonElement
    expect(jump.textContent).toBe('本頁符號表在最後 ↓')
    expect(container.querySelectorAll('.so-symbols-jump')).toHaveLength(1)
    expect(jump.closest('a')).toBeNull()
    expect(container.querySelector('a[href*="#symbols"]')).toBeNull()
    expect(precedes(jump, container.querySelector('#so-intro'))).toBe(true)
    // 按下去捲到頁末的 #symbols；符號表旁的「回到頁首」捲回頁首（jsdom 沒有 scrollIntoView，這裡裝一個假的）
    const down = vi.fn()
    const up = vi.fn()
    symbols.scrollIntoView = down
    page.scrollIntoView = up
    fireEvent.click(jump)
    expect(down).toHaveBeenCalledTimes(1)
    const back = Array.from(symbols.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('回到頁首')) as HTMLButtonElement
    fireEvent.click(back)
    expect(up).toHaveBeenCalledTimes(1)
    // TOC 最後一項是符號表
    const tocLast = Array.from(container.querySelectorAll('.so-toc a')).at(-1) as HTMLAnchorElement
    expect(tocLast.textContent).toBe('本頁符號表')
  }, 120000)

  it('方塊圖：七張圖各出現一次（依 SIGNOFF_CHARTS 的順序），都有圖說與導讀，並放在對應的公式／逐步推導之前（docs/teaching-style.md §8）', () => {
    const { container } = render(wrap(<SignoffPage />))
    const precedes = (x: Element | null, y: Element | null) => !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
    const figs = Array.from(container.querySelectorAll('figure.c-mermaid')) as HTMLElement[]
    expect(figs).toHaveLength(SIGNOFF_CHARTS.length)
    // 圖說夠長、沒有 `$` 殘留（成對的 $…$ 已轉成 KaTeX）、有替代文字；每張圖都包在 .so-diagram 裡
    for (const f of figs) {
      const cap = f.querySelector('figcaption')?.textContent ?? ''
      expect(cap.length, cap).toBeGreaterThan(20)
      expect(cap, cap).not.toMatch(/\$/)
      expect((f.getAttribute('aria-label') ?? '').length).toBeGreaterThan(30)
      expect(f.closest('.so-diagram'), cap).toBeTruthy()
    }
    const fig = (label: string) => {
      const f = figs.find((x) => (x.getAttribute('aria-label') ?? '').includes(label))
      if (!f) throw new Error(`找不到圖：${label}`)
      return f
    }
    const placed: [string, string, string][] = [
      ['Sign-off 流程圖', '#so-intro', ''],
      ['freeze 加減 Delta', '#so-polarity', '.c-steps'],
      ['證據強度流程圖', '#so-evidence', '.c-steps'],
      ['Corner 判準流程圖', '#so-corner', '.c-steps'],
      ['多參數線性化迴路', '#so-mimo', '.c-steps'],
      ['從 gain code 偏差到輸出', '#so-strategy', '.c-steps'],
      ['反面測試的流程圖', '#so-negative', '.so-limits'],
    ]
    expect(placed.map(([label]) => fig(label))).toEqual(figs) // 頁面上的順序與 SIGNOFF_CHARTS 相同
    for (const [label, section, next] of placed) {
      const sec = container.querySelector(section) as HTMLElement
      expect(sec, section).toBeTruthy()
      expect(sec.contains(fig(label)), `${label} 應在 ${section} 內`).toBe(true)
      // 先看圖，再看逐步推導（或下面的條目）
      if (section === '#so-intro') continue // §0 的圖放在六個條件表之後、「0.1 入門版」之前（下面單獨檢查）
      // 同一節裡的每一個逐步推導（或項目清單）都在圖之後；圖之前沒有任何推導
      for (const t of Array.from(sec.querySelectorAll(next))) expect(precedes(fig(label), t), `${label} 應在 ${next} 之前`).toBe(true)
    }
    const h01 = Array.from(container.querySelectorAll('h2, h3')).find((h) => (h.textContent ?? '').startsWith('0.1 入門版'))
    expect(precedes(container.querySelector('.so-pillars'), fig('Sign-off 流程圖'))).toBe(true)
    expect(precedes(fig('Sign-off 流程圖'), h01 ?? null)).toBe(true)
    // 導讀：圖旁有「先看…」的說明並用 KaTeX 把圖上的名字對回公式
    for (const f of figs) {
      const walk = f.closest('.so-diagram')?.querySelector('.so-diagram-walk')
      expect(walk?.textContent, f.getAttribute('aria-label') ?? '').toContain('先看')
      expect(walk?.querySelector('.katex')).toBeTruthy()
    }
    // §8（docs/assumptions.md §2a）：DTC 在 reference 輸入端，殘差在 PD 的 reference 輸入注入，θ_out = +T·φ_dtc（正號）
    const strat = container.querySelector('#so-strategy') as HTMLElement
    const stratWalk = fig('從 gain code 偏差到輸出').closest('.so-diagram')?.querySelector('.so-diagram-walk')?.textContent ?? ''
    expect(stratWalk).toContain('reference')
    const stratTex = Array.from(strat.querySelectorAll('annotation')).map((a) => a.textContent ?? '')
    expect(stratTex.some((t) => t.includes(String.raw`e_\text{PD}=\phi_\text{dtc}-\theta_\text{out}`))).toBe(true)
    expect(stratTex.some((t) => t.includes(String.raw`\theta_\text{out}=T\,\phi_\text{dtc}`))).toBe(true)
    // 整條推導的號誌要前後一致：φ_dtc = −2π f_out δt（殘差 = −δt）、φ_out = θ_out = +T·φ_dtc = −2π f_out T δt
    expect(stratTex.some((t) => t.includes(String.raw`\phi_\text{dtc}=-2\pi f_\text{out}\,\delta t\ \Rightarrow\ \phi_\text{out}=\theta_\text{out}=T\,\phi_\text{dtc}=-2\pi f_\text{out}\,T\,\delta t`))).toBe(true)
    expect(stratTex.some((t) => /=\s*-\s*T|-\s*H_\\mathrm\{PD\}\\,\\phi|=\s*-\s*\(/.test(t))).toBe(false) // 沒有 θ_out = −T…、e_PD = −H_PD…、e_PD = −(…)
    // 開頭那一段把接法說清楚：feedback edge 早到 a·x、DTC 從基準延遲 T_0 往回扣補償量 w·x、PD 量 reference 減 feedback
    const stratIntro = strat.querySelector('.c-section-body > p')
    const introTex = Array.from(stratIntro?.querySelectorAll('annotation') ?? []).map((a) => a.textContent ?? '')
    expect(stratIntro?.textContent ?? '').toContain('feedback（divider）edge 比理想時刻早到')
    expect(stratIntro?.textContent ?? '').toContain('只能延遲不能提前')
    expect(introTex).toContain(String.raw`\tau_\mathrm{DTC}=T_0-w\,x[n]`)
    expect(introTex).toContain(String.raw`e[n]=t_\mathrm{ref}'[n]-t_\mathrm{fb}[n]=(a-w)\,x[n]+v[n]`)
    // 相位的折算方式寫明（以輸出為參考），divider 才不會讓讀者以為少了一個除數
    expect(strat.textContent ?? '').toContain('經過 divider 數值不變')
    expect(strat.textContent ?? '').not.toMatch(/feedback injection|DTC 實際施加|延遲誤差/)
    // §9 的圖在項目清單之前；§3.5、§4、§7、§8 的圖在各自的公式之前
    expect(precedes(fig('證據強度流程圖'), container.querySelector('[id="formula-F-SO.8"]'))).toBe(true)
    expect(precedes(fig('Corner 判準流程圖'), container.querySelector('[id="formula-F-SO.5"]'))).toBe(true)
    expect(precedes(fig('多參數線性化迴路'), container.querySelector('[id="formula-F-SO.7"]'))).toBe(true)
    expect(precedes(fig('freeze 加減 Delta'), container.querySelector('[id="formula-F-SO.1"]'))).toBe(true)
  }, 120000)

  it('狀態改變會存進 localStorage（lmspll.signoff.*），判定與進度跟著更新', () => {
    render(wrap(<ReviewMatrix />))
    const sel = screen.getByLabelText('狀態：basic-perturb') as HTMLSelectElement
    fireEvent.change(sel, { target: { value: 'fail' } })
    expect(sel.value).toBe('fail')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(stored.items['basic-perturb'].status).toBe('fail')
    expect(screen.getByTestId('so-verdict').textContent).toContain('不可 sign-off')
    // fail 但沒寫理由 ⇒ 提示
    expect(screen.getAllByText(/必須寫理由/).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('備註：basic-perturb'), { target: { value: 'JIRA-42：Case B 的 D 錯位' } })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).items['basic-perturb'].note).toContain('JIRA-42')
  })

  it('重新掛載時讀回先前的狀態；篩選「只看未通過」只顯示 fail 項目', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, meta: { project: 'P1', reviewer: '', revision: '', scope: '' }, items: { 'nl-overflow': { status: 'fail', note: 'x' } } }),
    )
    const { container } = render(wrap(<ReviewMatrix />))
    expect((screen.getByLabelText('狀態：nl-overflow') as HTMLSelectElement).value).toBe('fail')
    expect((screen.getByDisplayValue('P1') as HTMLInputElement).value).toBe('P1')
    fireEvent.change(screen.getByLabelText('篩選檢查項目'), { target: { value: 'fail' } })
    expect(container.querySelectorAll('.so-check').length).toBe(1)
  })

  it('匯出 Markdown 與 JSON（downloadText）', () => {
    render(wrap(<ReviewMatrix />))
    fireEvent.change(screen.getByLabelText('狀態：corner-K'), { target: { value: 'pass' } })
    fireEvent.click(screen.getByRole('button', { name: '匯出 Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: '匯出 JSON' }))
    expect(dl.calls.length).toBe(2)
    expect(dl.calls[0].name).toMatch(/^signoff-review-.*\.md$/)
    expect(dl.calls[0].mime).toBe('text/markdown')
    expect(dl.calls[0].text).toContain('# LMS × Fractional-N PLL Calibration — Sign-off Review')
    expect(dl.calls[0].text).toContain('## 2. Corner')
    const json = JSON.parse(dl.calls[1].text)
    expect(json.schema).toBe('lmspll.signoff/v1')
    const corner = json.cases.find((c: { id: string }) => c.id === 'corner')
    expect(corner.checks.find((k: { id: string }) => k.id === 'corner-K').status).toBe('pass')
  })

  it('兩段式重設會清除狀態', () => {
    render(wrap(<ReviewMatrix />))
    fireEvent.change(screen.getByLabelText('狀態：basic-align'), { target: { value: 'pass' } })
    fireEvent.click(screen.getByRole('button', { name: '重設' }))
    fireEvent.click(screen.getByRole('button', { name: '確定清除全部狀態' }))
    expect((screen.getByLabelText('狀態：basic-align') as HTMLSelectElement).value).toBe('not-started')
  })

  it('三種學習模式共用同一計算核心：Beginner 收合推導、Research 顯示 Kesten 尾指數', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const b = render(wrap(<S3Claims />))
    expect(b.container.querySelectorAll('details.so-details').length).toBeGreaterThan(3)
    expect(screen.queryByText('Research：有外加雜訊時的 heavy tail（Kesten 尾指數）')).toBeNull()
    b.unmount()
    localStorage.setItem('lmspll.mode', 'research')
    const r = render(wrap(<S3Claims />))
    expect(r.container.querySelectorAll('details.so-details').length).toBe(0)
    expect(screen.getByText('Research：有外加雜訊時的 heavy tail（Kesten 尾指數）')).toBeTruthy()
  }, 30000)

  it('localStorage 不可用（私密模式／停用儲存）時頁面照常運作', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    render(wrap(<ReviewMatrix />))
    const sel = screen.getByLabelText('狀態：basic-bitmap') as HTMLSelectElement
    act(() => {
      fireEvent.change(sel, { target: { value: 'in-progress' } })
    })
    expect(sel.value).toBe('in-progress')
    const card = sel.closest('.so-check') as HTMLElement
    expect(card.getAttribute('data-check')).toBe('basic-bitmap')
    expect(within(card).getByLabelText('備註：basic-bitmap')).toBeTruthy()
  })
})
