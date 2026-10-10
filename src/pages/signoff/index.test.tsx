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
    expect(screen.getByText('本章符號')).toBeTruthy()
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
  }, 90000)

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
