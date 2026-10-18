import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import VerificationPage, { parseDeepLink } from './index'
import { ACCEPTANCE_IDS } from '@/simulation/models/acceptance'
import { settleLazy, wrap } from './indexTestUtils'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  newPlot: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
}))
vi.mock('mermaid', () => ({ default: mermaidMock }))

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
  localStorage.clear()
  vi.useRealTimers()
  // vi.fn() 會把每次呼叫的引數整份留在 mock.calls 裡（Plot 每次交給 P.react 整張圖的資料），所以每個測試之後清掉
  for (const fn of [P.react, P.newPlot, P.purge, P.toImage, P.downloadImage, mermaidMock.initialize, mermaidMock.render]) fn.mockClear()
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
    // 首屏（§V.1、§V.2）同步畫出；§V.3–§V.6 是延後載入的區塊，先看占位區再等它們載完
    expect(container.querySelectorAll('[data-lazy-gate]').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByTestId('mc-idle')).toBeNull()
    const table = screen.getByTestId('acceptance-table')
    const rows = table.querySelectorAll('tbody > tr[data-row]')
    expect(rows).toHaveLength(18)
    for (const id of ACCEPTANCE_IDS) expect(container.querySelector(`#${id}`)).toBeTruthy()
    expect(screen.getByTestId('rows-passed').textContent).toMatch(/18\s*\/\s*18/)
    // 每列的即時判定都是 ✓
    rows.forEach((r) => expect(r.querySelector('.ver-fail')).toBeNull())
    await settleLazy(container)
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
    const scroll = vi.fn()
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      wrap(<VerificationPage />, '/verification?e=E05', 'engineer')
      // 勘誤卡片在延後載入的 §V.6 裡：網址帶了 ?e=，區塊不等捲動就掛載，但卡片要等 chunk 載完才出現（同一個檔案裡前面的測試載過了就是同步出現）
      expect(scroll).not.toHaveBeenCalled() // 延後執行（waitAndReveal 的第一次檢查在 setTimeout 之後），避免被 PageFrame 的 scrollTo(0, 0) 蓋掉
      const card = await screen.findByTestId('erratum-E05', undefined, { timeout: 30000 })
      expect(card.id).toBe('E05')
      expect(card.className).toContain('ver-target')
      expect(card.querySelector('details')?.open).toBe(true)
      // 目標出現後（waitAndReveal 每 100 ms 檢查一次）才捲過去、給焦點
      await waitFor(() => expect(scroll).toHaveBeenCalled(), { timeout: 5000 })
      expect(scroll.mock.contexts[0]).toBe(card)
    } finally {
      Element.prototype.scrollIntoView = orig
    }
  }, 60000)

  it('?e=E05 深連結之後仍可自由篩選：選 high 後維持 2 / 49（不會被深連結的「清除篩選」蓋回去）；清除後 E05 回來', async () => {
    const { container } = wrap(<VerificationPage />, '/verification?e=E05', 'beginner')
    await settleLazy(container)
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
    const { container } = wrap(<VerificationPage />, '/verification?t=T05', 'engineer')
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
    // 展開列裡「本列實際執行的程式碼」也是延後載入（acceptance.ts 的原始碼另成一個 chunk）：載完之後是 acceptance.ts 的 #region T05
    await settleLazy(container)
    expect(detail.textContent).toContain('core:T05')
    expect(detail.textContent).not.toMatch(/找不到 region/)
    await act(async () => undefined)
  }, 60000)

  it('勘誤篩選：選 high 只剩 E01、E02；清除篩選回到 49 項；搜尋「ENBW」找到 E06', async () => {
    const { container } = wrap(<VerificationPage />, '/verification', 'beginner')
    await settleLazy(container)
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
    const { container } = wrap(<VerificationPage />, '/verification', 'engineer')
    await settleLazy(container)
    const card = screen.getByTestId('mutant-card')
    expect(card.textContent).toMatch(/正確地抓到/)
    const mt = screen.getByTestId('mutant-table')
    fireEvent.click(within(mt).getByRole('button', { name: /δ=w-a/ }))
    await waitFor(() => expect(screen.getByTestId('mutant-card').textContent).toMatch(/此測試看不出差別/))
    await act(async () => undefined)
  }, 60000)
})
