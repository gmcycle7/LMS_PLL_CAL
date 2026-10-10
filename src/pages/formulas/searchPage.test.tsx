import { fireEvent, waitFor } from '@testing-library/react'
import FormulasPage from './index'
import { ALL_FORMULAS } from './registry'
import { buttonByText, count, mountAt, q, renderProblems, typeSearch } from './domTestUtils'

vi.mock('plotly.js-dist-min', async () => ({ default: (await import('./domTestUtils')).PLOTLY_STUB }))
vi.mock('mermaid', () => ({ default: { initialize: () => undefined, render: async () => ({ svg: '<svg></svg>' }) } }))

vi.setConfig({ testTimeout: 180_000 })

afterEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

const status = (root: ParentNode) => q(root, '#fr-search-status').textContent ?? ''
const symbolKeys = (root: ParentNode) => Array.from(root.querySelectorAll('.fr-sym-table tr[data-symbol]')).map((r) => r.getAttribute('data-symbol'))

describe('搜尋：一個搜尋框同時過濾六個段落（整頁）', () => {
  it('ENBW → 各段只留符合的列；三種寫法結果相同；公式 ID 會被標示；沒有符合時說明原因；清除後恢復', () => {
    const { container } = mountAt(<FormulasPage />)
    const page = q(container, '[data-testid="formulas-page"]')
    expect(page.getAttribute('data-searching')).toBe('false')

    // ── ENBW：六段都有結果，頁首與思考題收起
    typeSearch(container, 'ENBW')
    expect(page.getAttribute('data-searching')).toBe('true')
    expect(container.querySelector('#fr-intro')).toBeNull()
    expect(container.querySelector('#fr-wrapup')).toBeNull()
    const sym = symbolKeys(container)
    expect(sym).toContain('enbw')
    expect(sym).not.toContain('a')
    expect(sym.length).toBeLessThan(10)
    expect(container.querySelector('tr[data-quick="bw"]')).toBeTruthy()
    expect(container.querySelector('tr[data-quick="lms"]')).toBeNull()
    expect(container.querySelector('#fr-unit-bw')).toBeTruthy()
    expect(container.querySelector('#fr-unit-index')).toBeNull()
    expect(container.querySelector('[data-limit="bwLabels"]')).toBeTruthy()
    expect(container.querySelector('[data-term="enbw"]')).toBeTruthy()
    expect(container.querySelector('[data-term="lms"]')).toBeNull()
    expect(container.querySelector('tr[data-formula-row="F-12.9"]')).toBeTruthy()
    expect(status(container)).toMatch(/^符合 \d+ 項$/)
    // 目錄按鈕顯示每段的符合數；「7 思考題」在搜尋中停用
    const counts = Array.from(container.querySelectorAll('.fr-toc-count')).map((e) => Number(e.textContent))
    expect(counts.length).toBe(6)
    expect(counts.every((n) => n > 0)).toBe(true)
    expect(buttonByText(q(container, '.fr-toc'), '7 思考題').disabled).toBe(true)
    // 搜尋中的教學段落收起（只留表格），但符合的單位子題完整顯示
    expect(container.querySelector('#fr-symbols .c-steps')).toBeNull()
    expect(container.querySelector('#fr-unit-bw .c-steps')).toBeTruthy()
    expect(renderProblems(container)).toEqual([])

    // ── TeX、Unicode、英文三種寫法得到相同的結果；多個關鍵字為 AND
    typeSearch(container, '\\sigma_w')
    const a = symbolKeys(container)
    typeSearch(container, 'σ_w')
    const b = symbolKeys(container)
    typeSearch(container, 'sigma_w')
    const c = symbolKeys(container)
    expect(a.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    typeSearch(container, 'sigma_w ENBW')
    const d = symbolKeys(container)
    expect(d.length).toBeGreaterThan(0)
    expect(d.length).toBeLessThanOrEqual(a.length)
    expect(d.every((k) => a.includes(k))).toBe(true)

    // ── 公式 ID：那一列被標示（即使原本不在前 60 條內）
    const last = ALL_FORMULAS[ALL_FORMULAS.length - 1].id
    typeSearch(container, last.toLowerCase())
    const row = q(container, `tr[data-formula-row="${last}"]`)
    expect(row.classList.contains('fr-focus')).toBe(true)
    expect(status(container)).toContain(last)

    // ── 反面：沒有任何符合 → 每一段都說明原因並提示怎麼做
    typeSearch(container, 'zzzqqq不存在的字')
    expect(status(container)).toBe('沒有符合的項目')
    expect(count(container, '.fr-nomatch')).toBe(7) // 符號、符號衝突、單位、速查、公式、限制、術語
    expect(count(container, '.fr-sym-table, .fr-quick-table, .fr-reg-table, .fr-limit, .fr-gloss-item, .fr-topic')).toBe(0)
    expect(q(container, '.fr-nomatch').textContent).toMatch(/清除搜尋或換一個關鍵字/)
    expect(Array.from(container.querySelectorAll('.fr-toc-count')).every((e) => e.textContent === '0')).toBe(true)

    // ── 清除：回到完整頁面
    fireEvent.click(buttonByText(q(container, '.fr-search'), '清除'))
    expect(q<HTMLInputElement>(container, '#fr-search-input').value).toBe('')
    expect(count(container, '.fr-nomatch')).toBe(0)
    expect(container.querySelector('#fr-intro')).toBeTruthy()
    expect(container.querySelector('#fr-wrapup')).toBeTruthy()
  })

  it('深連結：?q= 會帶入搜尋框並過濾；輸入後網址同步成 ?q=（replace）；Esc 清除後 ?q 消失', async () => {
    const { container, loc } = mountAt(<FormulasPage />, { url: '/formulas?q=E13' })
    const input = q<HTMLInputElement>(container, '#fr-search-input')
    expect(input.value).toBe('E13')
    expect(container.querySelector('tr[data-symbol="mu"]')).toBeTruthy()
    expect(container.querySelector('tr[data-symbol="T"]')).toBeNull()
    expect(container.querySelector('#fr-unit-muUnits')).toBeTruthy()
    typeSearch(container, 'sum average')
    await waitFor(() => expect(loc()).toBe('/formulas?q=sum+average'), { timeout: 4000 })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    await waitFor(() => expect(loc()).toBe('/formulas'), { timeout: 4000 })
  })

  it('深連結：?f=F-12.9 定位到那一條公式；範例關鍵字按鈕會填入搜尋框；按 / 聚焦搜尋框', () => {
    const { container } = mountAt(<FormulasPage />, { url: '/formulas?f=F-12.9' })
    const input = q<HTMLInputElement>(container, '#fr-search-input')
    expect(input.value).toBe('F-12.9')
    expect(q(container, 'tr[data-formula-row="F-12.9"]').classList.contains('fr-focus')).toBe(true)
    // 有搜尋字串時不顯示範例按鈕；清除後出現
    expect(container.querySelector('.fr-examples')).toBeNull()
    fireEvent.click(buttonByText(q(container, '.fr-search'), '清除'))
    fireEvent.click(buttonByText(q(container, '.fr-examples'), 'sum average'))
    expect(input.value).toBe('sum average')
    expect(container.querySelector('tr[data-quick="sumAvg"]')).toBeTruthy()
    input.blur()
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(input)
    // 在輸入框裡打 '/' 不會被攔截（typing）
    const ev = fireEvent.keyDown(input, { key: '/' })
    expect(ev).toBe(true)
  })

  it('?preset= 與搜尋並存：網址同步 ?q= 時保留 preset 參數', async () => {
    const { container, loc } = mountAt(<FormulasPage />, { url: '/formulas?preset=units-sum-vs-average' })
    typeSearch(container, 'calculator')
    await waitFor(() => expect(loc()).toBe('/formulas?preset=units-sum-vs-average&q=calculator'), { timeout: 4000 })
    // 只剩換算器這個子題
    expect(count(container, '.fr-topic')).toBe(1)
    expect(container.querySelector('#fr-unit-calculator')).toBeTruthy()
  })
})
