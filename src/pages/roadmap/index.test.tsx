import type { ReactNode } from 'react'
import { fireEvent, render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import RoadmapPage from './index'
import { ITEMS, type ItemId } from './data'
import { FORMULAS } from './formulas'
import { analyzeEf } from './model'
import { PREVIEWS } from './sections/ItemCard'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
const M = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) }))
vi.mock('plotly.js-dist-min', () => ({ default: P }))
vi.mock('mermaid', () => ({ default: M }))

// 假的 Plotly.react 會記住每一次呼叫的引數（DOM 節點與整組資料）：不清掉的話，前面每個測試渲染過的整頁
// （含所有 KaTeX 節點）都被它抓著不放，整個檔案跑下來會把 worker 的記憶體用光。
afterEach(() => {
  vi.clearAllMocks()
})

// KaTeX 很多，其他 agent 同時跑測試時 jsdom 較慢
vi.setConfig({ testTimeout: 90_000 })

function withProviders(ui: ReactNode, mode: 'beginner' | 'engineer' | 'research' = 'engineer', url = '/roadmap') {
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* storage 不可用時沿用預設 */
  }
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </SettingsProvider>,
  )
}

function noTexErrors(root: HTMLElement) {
  expect(root.querySelectorAll('.katex-error, .c-tex-error').length).toBe(0)
  // CodeBlock 找不到 #region 時會顯示「程式碼載入錯誤」
  expect(root.textContent ?? '').not.toMatch(/程式碼載入錯誤/)
}

describe('RoadmapPage（jsdom smoke）', () => {
  it('渲染不出錯：符號表、11 張研究卡、P0–P5、文件與公式登錄；KaTeX 無錯誤', () => {
    const { container } = withProviders(<RoadmapPage />)
    expect(container.querySelector('.c-symbols')).toBeTruthy()
    const cards = container.querySelectorAll('.rm-card')
    expect(cards.length).toBe(ITEMS.length)
    expect(container.querySelectorAll('.rm-phase').length).toBe(6)
    // 公式登錄的錨點
    expect(container.querySelector('#formula-F-R1\\.1')).toBeTruthy()
    expect(container.querySelector('#formula-F-SS\\.4')).toBeTruthy()
    expect(container.querySelector('#formula-F-SS\\.6')).toBeTruthy()
    // 勘誤標記連到 #/verification
    expect(container.querySelectorAll('a.rm-erratum[href="#/verification"]').length).toBeGreaterThan(20)
    // SSPLL 連到案例頁、狀態為分析中
    const ss = container.querySelector('#rm-item-SSPLL') as HTMLElement
    expect(ss.querySelector('a[href="#/case/sspll"]')).toBeTruthy()
    expect(ss.getAttribute('data-status')).toBe('in-analysis')
    noTexErrors(container)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(80)
  })

  it('反面：研究卡內沒有任何 verified 字樣；狀態徽章只有四種', () => {
    const { container } = withProviders(<RoadmapPage />)
    for (const card of Array.from(container.querySelectorAll('.rm-card'))) {
      expect(card.textContent ?? '').not.toMatch(/verified/i)
      expect(card.textContent ?? '').not.toMatch(/已驗證/)
    }
    const statuses = new Set(Array.from(container.querySelectorAll('.rm-status')).map((e) => e.getAttribute('data-status')))
    for (const s of statuses) expect(['partial', 'pending', 'not-started', 'in-analysis']).toContain(s)
    // 勘誤總數由 errata.json 計算並顯示
    expect(container.querySelector('#rm-docs')?.textContent).toMatch(/確認 49 項勘誤|確認\s*49\s*項勘誤/)
  })

  it('反面：全部預覽展開後，研究卡內仍沒有 verified 字樣（T-id 狀態只在驗證頁與 P0–P5）', () => {
    const { container } = withProviders(<RoadmapPage />, 'research')
    for (const card of Array.from(container.querySelectorAll('.rm-card'))) {
      fireEvent.click(within(card as HTMLElement).getByRole('button', { name: /展開數學預覽/ }))
    }
    expect(container.querySelectorAll('.rm-card .c-exp').length).toBe(12)
    for (const card of Array.from(container.querySelectorAll('.rm-card'))) expect(card.textContent ?? '').not.toMatch(/verified/i)
    noTexErrors(container)
  })

  it('總覽篩選：選「分析中」只剩 SSPLL；按 R4 跳轉會展開 R4 的預覽', () => {
    const { container } = withProviders(<RoadmapPage />)
    const overview = container.querySelector('#rm-overview') as HTMLElement
    fireEvent.click(within(overview).getByRole('button', { name: /分析中 in analysis/ }))
    const rows = overview.querySelectorAll('tr[data-item]')
    expect(rows.length).toBe(1)
    expect(rows[0].getAttribute('data-item')).toBe('SSPLL')
    fireEvent.click(within(overview).getByRole('button', { name: /全部/ }))
    fireEvent.click(within(overview).getByRole('button', { name: '跳到 R4' }))
    expect(container.querySelector('#exp-roadmap-r4-precond')).toBeTruthy()
  })

  it('卡片按鈕可展開 / 收起預覽', () => {
    const { container } = withProviders(<RoadmapPage />)
    const card = container.querySelector('#rm-item-R8') as HTMLElement
    const btn = within(card).getByRole('button', { name: /展開數學預覽/ })
    expect(card.querySelector('.c-exp')).toBeNull()
    fireEvent.click(btn)
    expect(card.querySelector('#exp-roadmap-r8-tracking')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: /收起數學預覽/ }))
    expect(card.querySelector('.c-exp')).toBeNull()
  })

  it('深連結 ?item=R7 會直接展開 R7', () => {
    const { container } = withProviders(<RoadmapPage />, 'engineer', '/roadmap?item=R7')
    expect(container.querySelector('#exp-roadmap-r7-lifting')).toBeTruthy()
  })

  it('Beginner 模式：「需要的數學」預設收合；Engineer 預設展開', () => {
    const b = withProviders(<RoadmapPage />, 'beginner')
    const d1 = b.container.querySelector('#rm-item-R1 details.rm-math') as HTMLDetailsElement
    expect(d1.open).toBe(false)
    b.unmount()
    const e = withProviders(<RoadmapPage />, 'engineer')
    const d2 = e.container.querySelector('#rm-item-R1 details.rm-math') as HTMLDetailsElement
    expect(d2.open).toBe(true)
  })
})

/**
 * docs/teaching-style.md §3：畫面上的數學一律 KaTeX。走訪所有文字節點（KaTeX、程式碼、<option>、register 名稱、
 * 共用元件的 tooltip / 摘要除外），不允許出現用 Unicode 希臘字母、上下標或運算符號拼湊的公式。
 * Plotly 的軸標題與圖例不在 DOM 內（規範允許保留 Unicode）；「ΔΣ」是調變器的名稱；單位欄位（fs²、fs⁻¹…）不算公式。
 */
describe('數學一律 LaTeX（全部預覽展開後檢查可見文字）', () => {
  const UNICODE_MATH = /[α-ωΑ-Ωϕϑ√∫∑‖ℐĴĤ⁰¹²³⁴-⁹⁺⁻₀-₉₊₋ᵀ≈≤≥≪≫⇒⇔∈]/
  const EXEMPT = '.katex, pre, code, option, .c-param-reg, .c-code, .c-tip, .c-badge, .c-exp-summary, .c-plot-note, th.num'
  const isUnit = (t: string) => /^(fs|LSB|\[w\])[²⁻¹]+(\/Hz)?$/.test(t)

  it.each(['engineer', 'research'] as const)('%s 模式：沒有 Unicode 拼湊的公式', (mode) => {
    const { container } = withProviders(<RoadmapPage />, mode)
    for (const card of Array.from(container.querySelectorAll('.rm-card'))) {
      fireEvent.click(within(card as HTMLElement).getByRole('button', { name: /展開數學預覽/ }))
    }
    const offenders: string[] = []
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? '').replace(/ΔΣ/g, '').trim()
      if (!text || !UNICODE_MATH.test(text) || isUnit(text)) continue
      if ((node.parentElement as HTMLElement).closest(EXEMPT)) continue
      offenders.push(text.slice(0, 80))
    }
    expect(offenders).toEqual([])
    // 字串屬性中的 $…$ 都有被渲染：畫面上不應殘留成對的 $…$
    const raw = Array.from(container.querySelectorAll('.rm-card, .rm-formulas, .c-symbols'))
      .map((e) => {
        const clone = e.cloneNode(true) as HTMLElement
        clone.querySelectorAll('.katex, pre, code, option').forEach((k) => k.remove())
        return clone.textContent ?? ''
      })
      .join(' ')
    expect(raw).not.toMatch(/\$[^$]{1,80}\$/)
  })
})

describe('連結、錨點與 console', () => {
  it('全部預覽展開後：console.error / warn 沒有任何訊息（act() 提示除外）；指標表引用的每個公式 ID 在本頁都有錨點；連結只有三種合法形式', () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    try {
      const { container } = withProviders(<RoadmapPage />, 'research')
      for (const card of Array.from(container.querySelectorAll('.rm-card'))) {
        fireEvent.click(within(card as HTMLElement).getByRole('button', { name: /展開數學預覽/ }))
      }
      expect(container.querySelectorAll('.c-handcalc').length).toBe(9)
      // 公式錨點：MetricTable 的公式欄 → 「7. 本頁公式登錄」
      const hrefs = new Set(Array.from(container.querySelectorAll('a[href^="#formula-"]')).map((a) => a.getAttribute('href')!.slice(1)))
      expect(hrefs.size).toBeGreaterThan(8)
      for (const id of hrefs) {
        expect(document.getElementById(id), id).toBeTruthy()
        expect(FORMULAS.some((f) => `formula-${f.id}` === id), id).toBe(true)
      }
      // 站內連結只有三種形式：HashRouter 路徑（#/…）、Link（/…）、本頁錨點（#formula-…）
      for (const a of Array.from(container.querySelectorAll('a[href]'))) {
        expect(a.getAttribute('href'), a.textContent ?? '').toMatch(/^(#\/[a-z0-9/-]*(\?[a-z]+=[\w.-]+)?|\/[a-z0-9/-]*|#formula-F-[\w.]+)$/i)
      }
    } finally {
      spy.mockRestore()
      warn.mockRestore()
    }
    // 共用的 Plot / Mermaid 在 jsdom 以假物件非同步完成，React 會提示 act()；React Router 的 v7 future flag 是函式庫公告
    const real = errors.filter((e) => !/not wrapped in act|React Router Future Flag/.test(e))
    expect(real).toEqual([])
  })

  it('指標表的公式連結（#formula-F-…）不會被 HashRouter 當成路由：點擊後留在本頁並捲到公式登錄的同名錨點', () => {
    const scrolled: Element[] = []
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const { container } = withProviders(<RoadmapPage />, 'engineer', '/roadmap?item=R1')
      const link = container.querySelector('#rm-item-R1 .c-metric-table a[href="#formula-F-R1.1"]') as HTMLAnchorElement
      expect(link).toBeTruthy()
      scrolled.length = 0
      // fireEvent.click 回傳 false 表示預設行為（把 hash 換成 #formula-…）被取消
      expect(fireEvent.click(link)).toBe(false)
      expect(scrolled.map((e) => e.id)).toEqual(['formula-F-R1.1'])
      // 一般連結不受影響
      const other = container.querySelector('#rm-item-SSPLL a[href="#/case/sspll"]') as HTMLAnchorElement
      expect(fireEvent.click(other)).toBe(true)
    } finally {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    }
  })
})

describe('R3 指標表：數值與單位分欄（不把單位拼在數值字串裡）', () => {
  it('T16: 32 + 2/5 的最大譜線合成 tone：peak 0.6472 LSB、功率 0.2094 LSB²（= 2|Y_k|/P、2|Y_k|²/P²），總誤差功率 0.24 LSB²', () => {
    const res = analyzeEf({ mode: 'rational', target: 32, fracBits: 10, num: 2, den: 5, rounding: 'nearest', bits: 6 })
    const top = res.topLines[0]
    expect(top.fracFu).toBeCloseTo(0.4, 12) // 主 tone 在 2f_u/5（勘誤 E15 / E47）
    expect(2 * top.mag).toBeCloseTo((Math.sqrt(5) + 1) / 5, 12)
    expect(2 * top.mag * top.mag).toBeCloseTo(0.2094427191, 9)
    const { container } = withProviders(<PREVIEWS.R3 />)
    const rows = Array.from(container.querySelectorAll('#exp-roadmap-r3-ef .c-metric-table tbody tr'))
    const cells = (label: RegExp) => {
      const tr = rows.find((r) => label.test(r.querySelector('td')?.textContent ?? ''))
      expect(tr, String(label)).toBeTruthy()
      const td = tr!.querySelectorAll('td')
      // 單位若是 `$…$`（例如 LSB²）由 KaTeX 排版：textContent 含 MathML 複本，TeX 原始碼在 <annotation> 裡
      return { value: Number(td[1].textContent), unit: td[2].textContent, unitTex: td[2].querySelector('annotation')?.textContent ?? null }
    }
    const peak = cells(/peak 振幅/)
    expect(peak.value).toBeCloseTo(2 * top.mag, 5)
    expect(peak.unit).toBe('LSB')
    const power = cells(/tone：功率/)
    expect(power.value).toBeCloseTo(2 * top.mag * top.mag, 5)
    expect(power.unitTex).toBe(String.raw`\mathrm{LSB}^2`) // LSB²：單位是 LaTeX，不是 Unicode 上標
    expect(power.unit).not.toContain('²')
    const total = cells(/總量化誤差功率/)
    expect(total.value).toBeCloseTo(0.24, 9)
    expect(total.unitTex).toBe(String.raw`\mathrm{LSB}^2`)
    expect(total.unit).not.toContain('²')
    // 數值欄裡沒有任何一格把單位拼進去
    for (const r of rows) expect(r.querySelectorAll('td')[1].textContent ?? '').not.toMatch(/LSB|fs/)
  })
})

describe('每個數學預覽都能渲染（jsdom），KaTeX 無錯誤', () => {
  const ids = Object.keys(PREVIEWS) as ItemId[]
  it.each(ids)('%s 預覽', (id) => {
    const Preview = PREVIEWS[id]
    const { container } = withProviders(<Preview />, 'research')
    expect(container.querySelector('.c-exp')).toBeTruthy()
    expect(container.querySelector('.c-steps')).toBeTruthy()
    expect(container.querySelector('.c-code')).toBeTruthy()
    noTexErrors(container)
  })
})

describe('預覽的警告會解釋原因（反面情境）', () => {
  it('R9 預設 17-bit：說明溢位與符號翻轉', () => {
    const { container } = withProviders(<PREVIEWS.R9 />)
    expect(container.querySelector('.c-exp-warnings')?.textContent).toMatch(/符號翻轉/)
  })

  it('R2 預設 P = 8、N = 16：說明 gcd > 1 時近似失準', () => {
    const { container } = withProviders(<PREVIEWS.R2 />)
    // 警告中的數學是 KaTeX：textContent 內含 TeX 原始碼（MathML annotation）
    expect(container.querySelector('.c-exp-warnings')?.textContent).toMatch(/\\gcd\(P,N\)=8>1/)
  })

  it('SSPLL 預設（使用者的 L2、α = 0.021）：PMUX 旋轉頻率在反號帶內 ⇒ 說明正 μ 會發散；譜線表的合計為負', () => {
    const { container } = withProviders(<PREVIEWS.SSPLL />)
    const warn = container.querySelector('.c-exp-warnings')?.textContent ?? ''
    expect(warn).toMatch(/落在反號帶內/)
    expect(warn).toMatch(/發散/)
    const rows = container.querySelectorAll('table.rm-ss-lines tbody tr')
    expect(rows.length).toBe(8) // 6 條譜線 + 其他 + 合計
    expect(rows[rows.length - 1].textContent).toMatch(/-0\.139/)
    // 沒有時域 Monte Carlo：交叉比對欄位必須老實顯示 Not implemented
    expect(container.querySelector('.c-exp-crosscheck')?.textContent).toMatch(/Not implemented/i)
  })

  it('SSPLL 預覽的假設（docs/assumptions.md §2a）：DTC 在 reference 輸入端注入，e_PD = φ_in − θ_fb ⇒ e_PD = +H_PD·φ_in；PD 量 reference 減 feedback', () => {
    const { container } = withProviders(<PREVIEWS.SSPLL />)
    const shell = container.querySelector('#exp-roadmap-sspll-polarity') as HTMLElement
    const text = shell.textContent ?? ''
    expect(text).toContain('DTC 在 reference 輸入端')
    expect(text).toContain('reference 輸入注入')
    expect(text).toContain('PMUX 在 feedback 路徑上')
    // KaTeX 的 annotation 帶 TeX 原始碼：PD 做減法（reference 輸入 − feedback 輸入），解出來是正號
    expect(text).toContain(String.raw`e_{\mathrm{PD}}=\phi_{\mathrm{in}}-\theta_{\mathrm{fb}}`)
    expect(text).toContain(String.raw`e_{\mathrm{PD}}=+H_{\mathrm{PD}}\,\phi_{\mathrm{in}}`)
    expect(text).toContain('reference edge 減 feedback edge')
    expect(text).not.toContain('phase-comparison')
    // 這一頁的 u 是有效 regressor u = h_PD * x（推導二），不能同時拿來當「注入的誤差」
    expect(text).not.toMatch(/=u-y|H_\{\\mathrm\{PD\}\}\\,u\b/)
  })

  it('R7 預覽（Research）：事件級模型要有 reference 端的 DTC 延遲與 feedback（divider）edge；PD 量 reference 減 feedback', () => {
    const { container } = withProviders(<PREVIEWS.R7 />, 'research')
    const text = container.textContent ?? ''
    expect(text).toContain('DTC 在 reference 輸入端')
    expect(text).toContain('feedback（divider）edge')
    expect(text).toContain('reference edge 減 feedback edge')
    expect(text).not.toContain('DTC 在 edge 上的延遲')
  })

  it('SSPLL：切到 Type-I（使用者的 L1）後沒有反號警告', () => {
    const { container } = withProviders(<PREVIEWS.SSPLL />)
    const shell = container.querySelector('#exp-roadmap-sspll-polarity') as HTMLElement
    // SelectControl 的 <option value> 是選項索引：1 = Type-I
    fireEvent.change(within(shell).getByLabelText('迴路型態') as HTMLSelectElement, { target: { value: '1' } })
    expect(shell.querySelector('.c-exp-warnings')).toBeNull()
    expect(shell.textContent).toMatch(/整個頻帶都是正的/)
  })

  it('R1：把 μ 降到 0.05 fs（迴路太慢）時，Monte Carlo 不判定並說明 burn-in 不足', () => {
    const { container } = withProviders(<PREVIEWS.R1 />)
    const shell = container.querySelector('#exp-roadmap-r1-colored') as HTMLElement
    fireEvent.change(within(shell).getByLabelText('mu（步長）') as HTMLInputElement, { target: { value: '0.05' } })
    expect(shell.querySelector('.c-exp-warnings')?.textContent).toMatch(/burn-in 上限/)
    expect(shell.querySelector('.c-exp-crosscheck')?.textContent).toMatch(/不判定/)
  })

  it('R1：把 μ 改成 300 fs（g > 2）會出現不穩定的解釋', () => {
    const { container } = withProviders(<PREVIEWS.R1 />)
    const shell = container.querySelector('#exp-roadmap-r1-colored') as HTMLElement
    expect(shell.querySelector('.c-exp-warnings')).toBeNull()
    const input = within(shell).getByLabelText('mu（步長）') as HTMLInputElement
    fireEvent.change(input, { target: { value: '300' } })
    expect(shell.querySelector('.c-exp-warnings')?.textContent).toMatch(/校正迴路不穩定/)
  })

  it('R4：奇異 J 會說明 λ_min = 0 不可辨識', () => {
    const { container } = withProviders(<PREVIEWS.R4 />)
    const shell = container.querySelector('#exp-roadmap-r4-precond') as HTMLElement
    fireEvent.change(within(shell).getByLabelText('J12（量測 Jacobian）') as HTMLInputElement, { target: { value: '-1' } })
    fireEvent.change(within(shell).getByLabelText('J21（量測 Jacobian）') as HTMLInputElement, { target: { value: '-1' } })
    const warn = shell.querySelector('.c-exp-warnings')?.textContent ?? ''
    expect(warn).toMatch(/\\lambda_\{\\min\}=0/)
    expect(warn).toMatch(/不可辨識/)
  })
})
