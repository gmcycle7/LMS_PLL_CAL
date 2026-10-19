import { act, fireEvent, screen, within } from '@testing-library/react'
import VerificationPage from './index'
import { MC_PLAN } from '@/simulation/models/acceptance'
import { FORMULAS } from './formulas'
import { settleLazy, wrap } from './indexTestUtils'
import { expectNoTexErrors } from '@/test/katex'

/**
 * Verification 頁的第二組 jsdom 測試（接續 index.test.tsx）：Monte Carlo 與多 seed 校準實驗、Research／Engineer 模式、勘誤卡片、§V.3、證據篩選。
 * 拆成兩個檔案是為了讓每個 worker 的記憶體不超過上限（見 indexTestUtils.tsx）。
 */
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  localStorage.clear()
  vi.useRealTimers()
})

describe('verification 頁（jsdom smoke，第二組）', () => {
  it('Monte Carlo 實驗：按「執行 Run」後（jsdom 無 Worker ⇒ inline）只跑 T17，結果表顯示 3 項（平均、變異、lag-1 自相關）都通過', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'engineer')
    await settleLazy(container) // §V.3 是延後載入的區塊
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
    const { container } = wrap(<VerificationPage />, '/verification', 'engineer')
    await settleLazy(container)
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
    await settleLazy(container)
    expect(screen.getAllByText(/core:runAcceptanceMonteCarlo/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/core:equivalentZ/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/core:ar1SampleBias/).length).toBeGreaterThan(0)
    for (const f of FORMULAS) {
      const anchors = container.querySelectorAll(`[id="formula-${f.id}"]`)
      expect(anchors.length, f.id).toBe(1)
    }
    expect(screen.getByTestId('refuted-table').querySelectorAll('tbody > tr')).toHaveLength(9)
    // 沒有 KaTeX 解析錯誤，也沒有找不到 region 的程式碼區塊
    expectNoTexErrors(container)
    expect(container.textContent).not.toMatch(/找不到 region/)
    await act(async () => undefined)
    expect(errorSpy).not.toHaveBeenCalled()
  }, 120000)

  it('engineer 模式：登錄的公式錨點同樣齊全（F-VF.7 的推導大綱只在 research 顯示，但公式本身在）', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'engineer')
    await settleLazy(container)
    for (const f of FORMULAS) expect(container.querySelectorAll(`[id="formula-${f.id}"]`).length, f.id).toBe(1)
    await act(async () => undefined)
  }, 120000)

  it('勘誤卡片：KaTeX 的「規格原文 → 修正」、即時重算的證據表（E02：8 個數字全部一致）、連回驗收表的比對', async () => {
    const { container } = wrap(<VerificationPage />, '/verification?e=E02', 'engineer')
    await settleLazy(container)
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
    await settleLazy(container)
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
    // 符號表涵蓋統計符號（S₁、r₁、Z_mean …）：至少 30 列；放在頁尾（id="symbols"），頁首（#ver-intro）已經沒有符號表
    const sym = container.querySelector('#symbols .c-symbols') as HTMLElement
    expect(sym.querySelectorAll('tbody > tr').length).toBeGreaterThanOrEqual(30)
    expect(container.querySelector('#ver-intro .c-symbols')).toBeNull()
    // 整頁（不含程式碼、KaTeX 的 annotation，以及 TestBadge 提示框裡別人測試的原始標題）都沒有殘留的 $
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('pre, code, annotation, .c-tip').forEach((n) => n.remove())
    expect(clone.textContent).not.toMatch(/\$/)
    await act(async () => undefined)
    expect(errorSpy).not.toHaveBeenCalled()
  }, 60000)

  it('勘誤篩選「只看有即時重算證據」：數量與摘要一致，E36（純文字勘誤）被濾掉', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'beginner')
    await settleLazy(container)
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
