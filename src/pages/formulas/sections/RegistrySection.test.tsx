import { act, fireEvent } from '@testing-library/react'
import { ALL_FORMULAS } from '../registry'
import { applyRegistryFilters, DEFAULT_FILTERS, REGISTRY_CARDS_BELOW, registryDomId, RegistrySection } from './RegistrySection'
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
  it('版面約定（1280px 視窗時六欄的表是內容欄的 1.4 倍寬，最右兩欄被切掉）：兩欄、ID 與「前往」在左、標籤／模型層級／規格／勘誤在名稱那一行的右側；外框不是捲動容器', () => {
    const { container } = mountAt(<RegistrySection rows={rows.slice(0, 40)} searching={false} focusId={null} />)
    const trs = Array.from(container.querySelectorAll('tr[data-formula-row]'))
    expect(trs.length).toBe(40)
    for (const tr of trs) {
      expect(tr.querySelectorAll(':scope > td').length, tr.getAttribute('data-formula-row') ?? '').toBe(2)
      const id = tr.getAttribute('data-formula-row')!
      const f = ALL_FORMULAS.find((x) => x.id === id)!
      const left = q(tr, 'td.fr-reg-id')
      expect(left.querySelector('.fr-reg-idtext')?.textContent).toBe(id)
      expect(left.querySelector('a.fr-formula-link')?.getAttribute('data-formula')).toBe(id)
      // 標籤、層級、規格、勘誤都在公式欄的標題列（.fr-reg-head > .fr-reg-meta），不是另外的欄
      const meta = q(tr, 'td.fr-reg-formula > .fr-reg-head > .fr-reg-meta')
      expect(meta.querySelector(`.c-claim-${f.claim}`)).toBeTruthy()
      expect(meta.querySelector(`.c-level-${f.level}`)).toBeTruthy()
      expect(meta.querySelector('.fr-reg-spec')?.textContent).toBe(`規格 §${f.specSection}`)
      expect(meta.querySelectorAll('a.fr-erratum').length).toBe(f.erratumId ? 1 : 0)
      // 沒有勘誤的列不印一個「—」佔位
      if (!f.erratumId) expect(meta.querySelector('.muted')).toBeNull()
    }
    // 登錄表的外框要讓表頭能 position: sticky：不是 ScrollRegion（.c-scroll）、也沒有 tabindex；但仍在 .table-wrap 內（全頁的版面約定）
    const wrap = q(container, '.fr-reg-wrap')
    expect(wrap.classList.contains('table-wrap')).toBe(true)
    expect(wrap.classList.contains('c-scroll')).toBe(false)
    expect(wrap.getAttribute('tabindex')).toBeNull()
  })

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

  it('卡片檢視：沒按過開關時依「內容欄」寬度自動切換（窄於 720px 用卡片），讀者按過開關之後以讀者為準', () => {
    let width = 900
    const observers: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observers.push(cb)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    // jsdom 不做版面：只有 .fr-reg-body 回報我們指定的寬度
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const w = this.classList.contains('fr-reg-body') ? width : 0
      return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 0, width: w, height: 0, toJSON: () => ({}) } as DOMRect
    })
    try {
      const { container } = mountAt(<RegistrySection rows={rows.slice(0, 3)} searching={false} focusId={null} />)
      const wrap = q(container, '.fr-reg-wrap')
      const resize = (w: number) => {
        width = w
        act(() => observers.forEach((cb) => cb()))
      }
      expect(REGISTRY_CARDS_BELOW).toBe(720)
      expect(wrap.classList.contains('fr-cards')).toBe(false) // 900px：表格
      resize(719)
      expect(wrap.classList.contains('fr-cards')).toBe(true) // 內容欄窄於 720px：卡片
      resize(720)
      expect(wrap.classList.contains('fr-cards')).toBe(false)
      resize(0) // display:none 或尚未排版：不算窄，維持原狀
      expect(wrap.classList.contains('fr-cards')).toBe(false)
      resize(600)
      expect(wrap.classList.contains('fr-cards')).toBe(true)
      const sw = Array.from(container.querySelectorAll<HTMLInputElement>('input[role="switch"]')).find((i) => /卡片檢視/.test(i.closest('.c-toggle')?.textContent ?? ''))!
      expect(sw.checked).toBe(true) // 開關顯示的是目前實際的狀態
      fireEvent.click(sw) // 讀者明確要表格
      expect(wrap.classList.contains('fr-cards')).toBe(false)
      resize(500)
      expect(wrap.classList.contains('fr-cards')).toBe(false) // 之後不再自動切換
      fireEvent.click(sw)
      resize(900)
      expect(wrap.classList.contains('fr-cards')).toBe(true)
    } finally {
      spy.mockRestore()
      vi.unstubAllGlobals()
    }
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
    expect(loc()).toBe(`${f.page}?f=${id}`) // 帶 ?f=：目標頁載好後會捲到這條公式
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
    // 使用條件放在公式的正下方（同一格 td.fr-reg-formula 內），不另外佔一欄：表頭只剩兩欄（左：ID 與位置；右：名稱、公式與使用條件，右上角是標籤、規格、勘誤）
    const cells = container.querySelectorAll('td.fr-reg-formula > .fr-reg-cond')
    expect(cells.length).toBe(2)
    expect(container.querySelectorAll('td.fr-reg-cond')).toHaveLength(0)
    expect(Array.from(container.querySelectorAll('.fr-reg-table thead th')).map((th) => th.textContent)).toEqual(['ID 與位置', '名稱、公式與使用條件標籤、規格、勘誤'])
    expect(q(container, 'tr.fr-group-row th').getAttribute('colspan')).toBe('2')
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
