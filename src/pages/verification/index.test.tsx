import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, type LearningMode } from '@/app/settings'
import VerificationPage, { parseDeepLink } from './index'
import { ACCEPTANCE_IDS, MC_PLAN } from '@/simulation/models/acceptance'
import { FORMULAS } from './formulas'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  newPlot: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-dist-min', () => ({ default: P }))

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: mermaidMock }))

function wrap(ui: ReactNode, url: string, mode: LearningMode) {
  localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </SettingsProvider>,
  )
}

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  localStorage.clear()
  vi.useRealTimers()
})

describe('verification 頁（jsdom smoke）', () => {
  it('parseDeepLink：?e=e05 → E05、?t=t13 → T13；不合法的值回傳 null', () => {
    expect(parseDeepLink(new URLSearchParams('e=e05'))).toEqual({ eid: 'E05', tid: null })
    expect(parseDeepLink(new URLSearchParams('t=t13'))).toEqual({ eid: null, tid: 'T13' })
    expect(parseDeepLink(new URLSearchParams('e=foo&t=T99'))).toEqual({ eid: null, tid: null })
  })

  it('beginner 模式渲染不丟錯：18 列驗收表全部「即時判定」通過、49 張勘誤卡片、每張都有 id="Exx" anchor', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'beginner')
    expect(screen.getByTestId('verification-page')).toBeTruthy()
    const table = screen.getByTestId('acceptance-table')
    const rows = table.querySelectorAll('tbody > tr[data-row]')
    expect(rows).toHaveLength(18)
    for (const id of ACCEPTANCE_IDS) expect(container.querySelector(`#${id}`)).toBeTruthy()
    expect(screen.getByTestId('rows-passed').textContent).toMatch(/18\s*\/\s*18/)
    // 每列的即時判定都是 ✓
    rows.forEach((r) => expect(r.querySelector('.ver-fail')).toBeNull())
    expect(screen.getByTestId('errata-count').textContent).toMatch(/49 \/ 49/)
    for (let i = 1; i <= 49; i++) expect(container.querySelector(`#E${String(i).padStart(2, '0')}`)).toBeTruthy()
    // 反面測試 9 列、mutant 10 列
    expect(screen.getByTestId('negative-table').querySelectorAll('tbody > tr')).toHaveLength(9)
    expect(screen.getByTestId('mutant-table').querySelectorAll('tbody > tr')).toHaveLength(10)
    expect(screen.getByTestId('negative-table').querySelector('.ver-fail')).toBeNull()
    // Monte Carlo 尚未執行：誠實顯示 idle
    expect(screen.getByTestId('mc-idle')).toBeTruthy()
    await act(async () => undefined)
    // 沒有 console.error（React key 重複、act 警告、KaTeX 解析失敗都會走這裡）
    expect(errorSpy).not.toHaveBeenCalled()
  }, 60000)

  it('?e=E05 深連結：勘誤卡片被標示、數值證據展開，且即使先前有篩選也一定看得到；捲動在 PageFrame 之後執行', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const scroll = vi.fn()
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      wrap(<VerificationPage />, '/verification?e=E05', 'engineer')
      const card = screen.getByTestId('erratum-E05')
      expect(card.id).toBe('E05')
      expect(card.className).toContain('ver-target')
      expect(card.querySelector('details')?.open).toBe(true)
      expect(scroll).not.toHaveBeenCalled() // 延後執行，避免被 PageFrame 的 scrollTo(0, 0) 蓋掉
      await act(async () => {
        vi.advanceTimersByTime(800)
      })
      expect(scroll).toHaveBeenCalled()
      expect(scroll.mock.contexts[0]).toBe(card)
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  }, 60000)

  it('?e=E05 深連結之後仍可自由篩選：選 high 後維持 2 / 49（不會被深連結的「清除篩選」蓋回去）；清除後 E05 回來', async () => {
    wrap(<VerificationPage />, '/verification?e=E05', 'beginner')
    expect(screen.getByTestId('errata-count').textContent).toMatch(/49 \/ 49/)
    const box = screen.getByRole('search', { name: '勘誤篩選' })
    const [sev] = within(box).getAllByRole('combobox')
    fireEvent.change(sev, { target: { value: 'high' } })
    await act(async () => undefined) // 讓 effect 有機會（錯誤地）重設篩選
    expect(screen.getByTestId('errata-count').textContent).toMatch(/2 \/ 49/)
    expect(screen.queryByTestId('erratum-E05')).toBeNull() // E05 是 medium：使用者自己把它濾掉了
    fireEvent.click(within(box).getByRole('button', { name: '清除篩選' }))
    expect(screen.getByTestId('erratum-E05').className).toContain('ver-target')
    expect(errorSpy).not.toHaveBeenCalled()
  }, 60000)

  it('?t=T05 深連結：驗收列自動展開，顯示 golden 每個 key 與第二條獨立路徑', async () => {
    wrap(<VerificationPage />, '/verification?t=T05', 'engineer')
    const detail = screen.getByTestId('detail-T05')
    const keyCells = Array.from(detail.querySelectorAll('td.ver-mono')).map((td) => td.textContent)
    expect(keyCells).toContain('N_exact_even_strict_95')
    expect(keyCells).toContain('p_exact_strict_list')
    expect(within(detail).getAllByText(/✓ 通過/).length).toBeGreaterThanOrEqual(11)
    expect(detail.textContent).toMatch(/精確恆等式/) // 第二條獨立路徑的說明（含 KaTeX）
    // 標註了勘誤的比對有「勘誤 E02」小標，連到 ?e=E02
    const chip = detail.querySelector('a[data-erratum="E02"]') as HTMLAnchorElement
    expect(chip.getAttribute('href')).toBe('#/verification?e=E02')
    // 行內 TeX 真的被 KaTeX 渲染（表格內沒有殘留的 $；程式碼區塊不算）
    detail.querySelectorAll('table').forEach((t) => expect(t.textContent).not.toMatch(/\$/))
    expect(detail.querySelectorAll('.katex').length).toBeGreaterThan(10)
    await act(async () => undefined)
  }, 60000)

  it('勘誤篩選：選 high 只剩 E01、E02；清除篩選回到 49 項；搜尋「ENBW」找到 E06', async () => {
    wrap(<VerificationPage />, '/verification', 'beginner')
    const box = screen.getByRole('search', { name: '勘誤篩選' })
    const [sev] = within(box).getAllByRole('combobox')
    fireEvent.change(sev, { target: { value: 'high' } })
    expect(screen.getByTestId('errata-count').textContent).toMatch(/2 \/ 49/)
    expect(screen.getByTestId('erratum-E01')).toBeTruthy()
    expect(screen.queryByTestId('erratum-E05')).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: '清除篩選' }))
    expect(screen.getByTestId('errata-count').textContent).toMatch(/49 \/ 49/)
    fireEvent.change(within(box).getByRole('searchbox'), { target: { value: 'ENBW' } })
    expect(screen.getByTestId('erratum-E06')).toBeTruthy()
    expect(screen.queryByTestId('erratum-E01')).toBeNull()
    await act(async () => undefined)
  }, 60000)

  it('Mutation Lab：切換 mutant 後顯示錯誤／正確公式與「正確地抓到」；δ 極性約定顯示「看不出」', async () => {
    wrap(<VerificationPage />, '/verification', 'engineer')
    const card = screen.getByTestId('mutant-card')
    expect(card.textContent).toMatch(/正確地抓到/)
    const mt = screen.getByTestId('mutant-table')
    fireEvent.click(within(mt).getByRole('button', { name: /δ=w-a/ }))
    await waitFor(() => expect(screen.getByTestId('mutant-card').textContent).toMatch(/此測試看不出差別/))
    await act(async () => undefined)
  }, 60000)

  it('Monte Carlo 實驗：按「執行 Run」後（jsdom 無 Worker ⇒ inline）只跑 T17，結果表顯示 3 項（平均、變異、lag-1 自相關）都通過', async () => {
    wrap(<VerificationPage />, '/verification', 'engineer')
    // 執行前：誠實顯示 idle，並列出將執行的全部檢查
    expect(screen.getByTestId('mc-idle')).toBeTruthy()
    expect(document.querySelectorAll('.ver-plan > li')).toHaveLength(MC_PLAN.length)
    const subset = screen.getByRole('combobox', { name: '項目' })
    const opt = within(subset).getByRole('option', { name: '只跑 T17' }) as HTMLOptionElement
    fireEvent.change(subset, { target: { value: opt.value } })
    const runBtn = screen.getAllByRole('button', { name: /執行 Run/ })[0]
    await act(async () => {
      fireEvent.click(runBtn)
    })
    const table = await screen.findByTestId('mc-table', undefined, { timeout: 20000 })
    const rows = table.querySelectorAll('tbody > tr')
    expect(Array.from(rows).map((r) => r.getAttribute('data-key'))).toEqual(['T17-mean', 'T17-var', 'T17-acf'])
    expect(table.querySelector('.ver-fail')).toBeNull()
    expect(table.textContent).toMatch(/T17/)
    expect(table.textContent).toMatch(/非獨立/) // 變異那一列誠實標示「非獨立」
  }, 60000)

  it('多 seed 校準實驗：執行後列出每項的 z̄、s_z 與校準判定；合併的 KS 檢定通過', async () => {
    wrap(<VerificationPage />, '/verification', 'engineer')
    expect(screen.getByTestId('sweep-idle')).toBeTruthy()
    // 用較少的 seed 加快測試：K = 12
    const kInput = screen.getByRole('textbox', { name: 'seed 個數 K' })
    fireEvent.change(kInput, { target: { value: '12' } })
    fireEvent.blur(kInput)
    const runBtn = screen.getAllByRole('button', { name: /執行 Run/ })[1]
    await act(async () => {
      fireEvent.click(runBtn)
    })
    const table = await screen.findByTestId('sweep-table', undefined, { timeout: 60000 })
    const keys = Array.from(table.querySelectorAll('tbody > tr')).map((r) => r.getAttribute('data-key'))
    expect(keys).toEqual(['T03-g', 'T03-lambda', 'T04-p', 'T05-odd', 'T05-strict', 'T13-var', 'T14-enbw', 'T17-mean', 'T17-var', 'T17-acf'])
    expect(table.querySelector('.ver-fail')).toBeNull()
    expect(table.textContent).toMatch(/12 \/ 12/)
    expect(table.textContent).toMatch(/已校準/)
  }, 120000)

  it('research 模式也能渲染：顯示核心程式碼；每個登錄的公式 F-VF.n 恰有一個錨點；被反駁的 9 項也列出', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'research')
    expect(screen.getAllByText(/core:runAcceptanceMonteCarlo/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/core:equivalentZ/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/core:ar1SampleBias/).length).toBeGreaterThan(0)
    for (const f of FORMULAS) {
      const anchors = container.querySelectorAll(`[id="formula-${f.id}"]`)
      expect(anchors.length, f.id).toBe(1)
    }
    expect(screen.getByTestId('refuted-table').querySelectorAll('tbody > tr')).toHaveLength(9)
    // 沒有 KaTeX 解析錯誤，也沒有找不到 region 的程式碼區塊
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.querySelector('.c-tex-error')).toBeNull()
    expect(container.textContent).not.toMatch(/找不到 region/)
    await act(async () => undefined)
    expect(errorSpy).not.toHaveBeenCalled()
  }, 120000)

  it('engineer 模式：登錄的公式錨點同樣齊全（F-VF.7 的推導大綱只在 research 顯示，但公式本身在）', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'engineer')
    for (const f of FORMULAS) expect(container.querySelectorAll(`[id="formula-${f.id}"]`).length, f.id).toBe(1)
    await act(async () => undefined)
  }, 120000)

  it('勘誤卡片：KaTeX 的「規格原文 → 修正」、即時重算的證據表（E02：8 個數字全部一致）、連回驗收表的比對', async () => {
    wrap(<VerificationPage />, '/verification?e=E02', 'engineer')
    const card = screen.getByTestId('erratum-E02')
    const math = within(card).getByTestId('erratum-math')
    expect(math.querySelectorAll('.katex-display').length).toBe(2) // 規格原文 + 修正
    expect(math.textContent).toMatch(/tie/)
    const live = within(card).getByTestId('erratum-live')
    const rows = live.querySelectorAll('tbody > tr')
    expect(rows.length).toBe(8)
    expect(live.querySelector('.ver-fail')).toBeNull()
    expect(live.textContent).toMatch(/0\.492050/) // 文件引用的數字
    expect(live.textContent).toMatch(/comparator\.directionExact/)
    // 驗收表中標註 E02 的獨立比對也列在這裡（連到 ?t=T05）
    expect(live.querySelector('a[href="#/verification?t=T05"]')).toBeTruthy()
    // 純文字勘誤（E36）只有「修正」一條式子，沒有即時證據
    const e36 = screen.getByTestId('erratum-E36')
    expect(within(e36).getByTestId('erratum-math').querySelectorAll('.katex-display').length).toBe(1)
    expect(within(e36).queryByTestId('erratum-live')).toBeNull()
    await act(async () => undefined)
  }, 60000)

  it('§V.3 教學骨架（beginner 也看得到）：5 個先備知識框、手算表、五種驗證手段比較表；數字不會漏出 toPrecision 的「e+5」', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'beginner')
    const mc = container.querySelector('#ver-mc') as HTMLElement
    const prereq = Array.from(mc.querySelectorAll('details.c-prereq > summary'))
      .map((x) => x.textContent ?? '')
      .filter((t) => t.includes('先備知識'))
    expect(prereq).toHaveLength(5)
    expect(prereq.join('｜')).toMatch(/期望值.*常態分布.*中央極限定理.*共變異數.*卡方分布/)
    // 相關與 AR(1) 的先備知識：ρ_k = p^k 的推導與 T13 的 σ_w² 接上
    const ar1 = Array.from(mc.querySelectorAll('details.c-prereq')).find((d) => d.querySelector('summary')?.textContent?.includes('共變異數')) as HTMLElement
    expect(ar1.querySelectorAll('.c-step').length).toBe(4)
    expect(ar1.textContent).toMatch(/積分相關時間/)
    // 手算：n ≈ 2.51×10⁵ 個決策（曾顯示成「2.51e+5」）
    expect(mc.textContent).not.toMatch(/\de\+\d/)
    expect(mc.textContent).toMatch(/251000/)
    // §V.7 的比較表：五種手段
    const methods = screen.getByTestId('methods-table')
    expect(methods.querySelectorAll('tbody > tr')).toHaveLength(5)
    expect(methods.textContent).toMatch(/Mutation/)
    // 符號表涵蓋統計符號（S₁、r₁、Z_mean …）：至少 30 列
    const sym = container.querySelector('#ver-intro .c-symbols') as HTMLElement
    expect(sym.querySelectorAll('tbody > tr').length).toBeGreaterThanOrEqual(30)
    // 整頁（不含程式碼與 KaTeX 的 annotation）都沒有殘留的 $
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('pre, code, annotation').forEach((n) => n.remove())
    expect(clone.textContent).not.toMatch(/\$/)
    await act(async () => undefined)
    expect(errorSpy).not.toHaveBeenCalled()
  }, 60000)

  it('勘誤篩選「只看有即時重算證據」：數量與摘要一致，E36（純文字勘誤）被濾掉', async () => {
    wrap(<VerificationPage />, '/verification', 'beginner')
    const box = screen.getByRole('search', { name: '勘誤篩選' })
    const cb = within(box).getByRole('checkbox', { name: /只看有即時重算證據/ })
    const n = Number(/（(\d+)）/.exec(cb.parentElement?.textContent ?? '')?.[1])
    expect(n).toBeGreaterThanOrEqual(30)
    fireEvent.click(cb)
    expect(screen.getByTestId('errata-count').textContent).toMatch(new RegExp(`${n} / 49`))
    expect(screen.queryByTestId('erratum-E36')).toBeNull()
    expect(screen.getByTestId('erratum-E01')).toBeTruthy()
    await act(async () => undefined)
  }, 60000)
})
