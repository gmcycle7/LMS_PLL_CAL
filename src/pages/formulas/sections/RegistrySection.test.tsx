import { fireEvent } from '@testing-library/react'
import { ALL_FORMULAS } from '../registry'
import { applyRegistryFilters, DEFAULT_FILTERS, registryDomId, RegistrySection } from './RegistrySection'
import { buttonByText, chooseOption, count, mountAt, q, renderProblems } from '../domTestUtils'

vi.setConfig({ testTimeout: 120_000 })

const J = vi.hoisted(() => ({ jumps: [] as string[] }))
vi.mock('../jump', async (orig) => {
  const mod = await orig<typeof import('../jump')>()
  return {
    ...mod,
    jumpToFormula: (id: string) => {
      J.jumps.push(id)
      return () => undefined
    },
  }
})

beforeEach(() => {
  J.jumps.length = 0
})
afterEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

const rows = ALL_FORMULAS.slice()

describe('applyRegistryFilters（純函式）', () => {
  it('四個條件各自與組合；all 不過濾', () => {
    expect(applyRegistryFilters(rows, DEFAULT_FILTERS).length).toBe(rows.length)
    const p12 = applyRegistryFilters(rows, { ...DEFAULT_FILTERS, page: '/ch/12' })
    expect(p12.length).toBeGreaterThan(10)
    expect(p12.every((r) => r.page === '/ch/12')).toBe(true)
    const approx = applyRegistryFilters(rows, { ...DEFAULT_FILTERS, claim: 'approx' })
    expect(approx.every((r) => r.claim === 'approx')).toBe(true)
    const l0 = applyRegistryFilters(rows, { ...DEFAULT_FILTERS, level: 'L0' })
    expect(l0.every((r) => r.level === 'L0')).toBe(true)
    const withE = applyRegistryFilters(rows, { ...DEFAULT_FILTERS, erratum: 'with' })
    const withoutE = applyRegistryFilters(rows, { ...DEFAULT_FILTERS, erratum: 'without' })
    expect(withE.length + withoutE.length).toBe(rows.length)
    expect(withE.every((r) => !!r.erratumId)).toBe(true)
    const e13 = applyRegistryFilters(rows, { ...DEFAULT_FILTERS, erratum: 'E13' })
    expect(e13.length).toBeGreaterThan(0)
    expect(e13.every((r) => r.erratumId === 'E13')).toBe(true)
    const combo = applyRegistryFilters(rows, { page: '/ch/12', claim: 'exact', level: 'all', erratum: 'with' })
    expect(combo.every((r) => r.page === '/ch/12' && r.claim === 'exact' && !!r.erratumId)).toBe(true)
    // 反面：不存在的頁面 → 空
    expect(applyRegistryFilters(rows, { ...DEFAULT_FILTERS, page: '/nope' })).toEqual([])
  })

  it('registryDomId：把 ID 轉成合法且唯一的 DOM id', () => {
    expect(registryDomId('F-12.9')).toBe('fr-ref-F-12_9')
    const ids = ALL_FORMULAS.map((f) => registryDomId(f.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('RegistrySection（jsdom）', () => {
  it('每一列：ID、名稱、TeX、使用條件、標籤、模型層級、規格段落、前往連結、勘誤；依頁面分組', () => {
    const { container } = mountAt(<RegistrySection rows={rows} searching={false} focusId={null} />)
    expect(count(container, 'tr[data-formula-row]')).toBe(60)
    const first = q(container, 'tr[data-formula-row]')
    const id = first.getAttribute('data-formula-row')!
    const f = ALL_FORMULAS.find((x) => x.id === id)!
    expect(first.id).toBe(registryDomId(id))
    expect(first.textContent).toContain(id)
    // title／conditions 可含 `$...$` 行內公式（會被渲染成 KaTeX），所以只比對公式以外的純文字片段
    const plainParts = (t: string) => t.split(/\$[^$]*\$/).map((x) => x.trim()).filter((x) => x.length > 0)
    for (const part of plainParts(f.title)) expect(first.textContent).toContain(part)
    for (const part of plainParts(f.conditions)) expect(first.textContent).toContain(part)
    expect(first.querySelector('.katex-error')).toBeNull()
    expect(first.textContent).toContain(`§${f.specSection}`)
    expect(first.querySelector('.katex-display')).toBeTruthy()
    expect(first.querySelector(`.c-claim-${f.claim}`)).toBeTruthy()
    expect(first.querySelector(`.c-level-${f.level}`)).toBeTruthy()
    expect(first.querySelector('a.fr-formula-link')).toBeTruthy()
    // 分組列：頁面名稱與路徑
    const group = q(container, 'tr.fr-group-row')
    expect(group.textContent).toContain(f.pageNav)
    expect(group.textContent).toContain(f.page)
    // 有勘誤的列連到驗證頁
    const withE = ALL_FORMULAS.slice(0, 60).find((x) => x.erratumId)!
    const tag = q(container, `tr[data-formula-row="${withE.id}"] a.fr-erratum`)
    expect(tag.getAttribute('href')).toBe(`#/verification?e=${withE.erratumId}`)
    expect(renderProblems(container)).toEqual([])
  })

  it('四個篩選器（頁面／結論標籤／模型層級／勘誤）、清除篩選、再顯示 60 條、全部顯示', () => {
    const { container } = mountAt(<RegistrySection rows={rows} searching={false} focusId={null} />)
    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('.fr-filters select'))
    expect(selects.length).toBe(4)
    chooseOption(selects[0], /^12 /)
    const n12 = ALL_FORMULAS.filter((f) => f.page === '/ch/12').length
    expect(count(container, 'tr[data-formula-row]')).toBe(n12)
    expect(Array.from(container.querySelectorAll('tr[data-formula-row]')).every((r) => r.getAttribute('data-formula-row')!.startsWith('F-12.'))).toBe(true)
    expect(q(container, '.fr-reg-summary').textContent).toContain(`符合 ${n12} / ${ALL_FORMULAS.length}`)
    chooseOption(selects[1], /近似/)
    const n12a = ALL_FORMULAS.filter((f) => f.page === '/ch/12' && f.claim === 'approx').length
    expect(count(container, 'tr[data-formula-row]')).toBe(n12a)
    chooseOption(selects[3], '有勘誤註記')
    const n12ae = ALL_FORMULAS.filter((f) => f.page === '/ch/12' && f.claim === 'approx' && f.erratumId).length
    expect(count(container, 'tr[data-formula-row]')).toBe(n12ae)
    // 反面：篩到沒有任何一條時說明原因
    chooseOption(selects[2], 'L6')
    if (ALL_FORMULAS.some((f) => f.page === '/ch/12' && f.claim === 'approx' && f.erratumId && f.level === 'L6')) throw new Error('測試前提改變：ch12 出現 L6 的近似公式')
    expect(count(container, 'tr[data-formula-row]')).toBe(0)
    expect(q(container, '.fr-nomatch').textContent).toMatch(/沒有符合的公式/)
    fireEvent.click(buttonByText(container, '清除篩選'))
    expect(count(container, 'tr[data-formula-row]')).toBe(60)
    fireEvent.click(buttonByText(container, /再顯示 \d+ 條/))
    expect(count(container, 'tr[data-formula-row]')).toBe(120)
    fireEvent.click(buttonByText(container, '全部顯示'))
    expect(count(container, 'tr[data-formula-row]')).toBe(ALL_FORMULAS.length)
    expect(container.querySelector('.fr-more')).toBeNull()
  })

  it('focusId：那一列一定在顯示範圍內並被標示（即使排在第 60 條之後）', () => {
    const last = ALL_FORMULAS[ALL_FORMULAS.length - 1].id
    const { container } = mountAt(<RegistrySection rows={rows} searching={false} focusId={last} />)
    expect(count(container, 'tr[data-formula-row]')).toBe(ALL_FORMULAS.length)
    expect(q(container, `#${registryDomId(last)}`).classList.contains('fr-focus')).toBe(true)
    expect(count(container, 'tr.fr-focus')).toBe(1)
  })

  it('卡片檢視開關加上 fr-cards；點「前往」切到該公式所在的頁面並啟動錨點跳轉', () => {
    const { container, loc } = mountAt(<RegistrySection rows={rows} searching={false} focusId={null} />)
    const wrap = q(container, '.fr-reg-wrap')
    expect(wrap.classList.contains('fr-cards')).toBe(false) // jsdom 沒有 matchMedia → 預設表格檢視
    const sw = Array.from(container.querySelectorAll<HTMLInputElement>('input[role="switch"]')).find((i) => /卡片檢視/.test(i.closest('.c-toggle')?.textContent ?? ''))!
    fireEvent.click(sw)
    expect(wrap.classList.contains('fr-cards')).toBe(true)

    const link = q<HTMLAnchorElement>(container, 'tr[data-formula-row] a.fr-formula-link')
    const id = link.dataset.formula!
    const f = ALL_FORMULAS.find((x) => x.id === id)!
    expect(link.getAttribute('href')).toBe(`#${f.page}`) // 一般連結：可在新分頁開啟
    // 按住 ⌘／Ctrl 點擊：交給瀏覽器開新分頁，不攔截
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(J.jumps).toEqual([])
    expect(fireEvent.click(link)).toBe(false)
    expect(loc()).toBe(f.page)
    expect(J.jumps).toEqual([id])
  })

  it('空清單 + searching：顯示符合 0 / 總數與說明', () => {
    const { container } = mountAt(<RegistrySection rows={[]} searching focusId={null} />)
    expect(q(container, '.fr-reg-summary').textContent).toContain(`符合 0 / ${ALL_FORMULAS.length}`)
    expect(container.querySelector('.fr-nomatch')).toBeTruthy()
    expect(container.querySelector('.fr-reg-table')).toBeNull()
  })

  it('名稱與使用條件若含行內 LaTeX（$…$）會以 KaTeX 顯示，不會把錢字號原樣印出來；純文字條件照原樣', () => {
    const base = ALL_FORMULAS[0]
    const fake = [
      { ...base, id: base.id, title: String.raw`含 $\sigma_w$ 的名稱`, conditions: String.raw`$|p|<1$、average mode；$\mu$ 單位 fs` },
      { ...ALL_FORMULAS[1], conditions: '純文字條件：0 < g < 2' },
    ]
    const { container } = mountAt(<RegistrySection rows={fake} searching focusId={null} />)
    // 使用條件放在公式的正下方（同一格 td.fr-reg-formula 內），不另外佔一欄：表頭只剩六欄
    const cells = container.querySelectorAll('td.fr-reg-formula > .fr-reg-cond')
    expect(cells.length).toBe(2)
    expect(container.querySelectorAll('td.fr-reg-cond')).toHaveLength(0)
    expect(Array.from(container.querySelectorAll('.fr-reg-table thead th')).map((th) => th.textContent)).toEqual(['ID', '名稱、公式與使用條件', '標籤', '規格', '位置', '勘誤'])
    expect(q(container, 'tr.fr-group-row th').getAttribute('colspan')).toBe('6')
    for (const c of Array.from(cells)) expect(c.querySelector('.fr-reg-cond-label')?.textContent).toBe('使用條件')
    expect(cells[0].querySelectorAll('.katex').length).toBe(2)
    expect(cells[0].textContent).toContain('average mode')
    expect(cells[1].querySelectorAll('.katex').length).toBe(0)
    expect(cells[1].textContent).toContain('純文字條件：0 < g < 2')
    expect(q(container, '.fr-f-title').querySelectorAll('.katex').length).toBe(1)
    // tooltip 是純文字：拿掉 $ 分隔符
    expect(q(container, 'a.fr-formula-link').getAttribute('title')).not.toContain('$')
    expect(renderProblems(container)).toEqual([]) // 沒有殘留的 $、沒有 KaTeX 錯誤
  })
})
