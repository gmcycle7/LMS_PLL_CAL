import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ALL_HANDCALCS } from '@/app/handcalcs'
import { SettingsProvider } from '@/app/settings'
import { normCdf } from '@/simulation/core'
import WorkbookPage, { STATS_KEY } from './index'
import { EMPTY_FILTERS, buildWorksheet, countByLevel, filterHandcalcs, groupByChapter, practiceItem, type PracticeItem, type WorksheetOptions } from './logic'
import { PRINT_BODY_CLASS } from './sections/Worksheet'

// 方塊圖在這個檔案裡不需要真的畫（diagrams.test.tsx 另外用真的 mermaid 畫過每一張）：用只放原始碼與圖說的替身，避免整頁測試等 mermaid 非同步渲染
vi.mock('@/components/Mermaid', async () => {
  const { createElement } = await import('react')
  return {
    Mermaid: ({ chart, caption }: { chart: string; caption?: string }) =>
      createElement('figure', { className: 'c-mermaid', 'data-chart': chart }, caption ? createElement('figcaption', { className: 'c-figcaption' }, caption) : null),
    renderMermaid: async () => '<svg></svg>',
  }
})

// Vitest 預設不處理 CSS（匯入得到空字串），列印規則的測試直接讀檔
const css = readFileSync(join(process.cwd(), 'src/pages/workbook/workbook.css'), 'utf8')

function renderPage(url = '/workbook') {
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <WorkbookPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

// 整頁 DOM 不小（KaTeX）：一律用 querySelector，不用會掃描整份文件的 getByRole
const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T | null
const qa = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll(sel)) as T[]
const buttonByText = (root: ParentNode, text: string) => qa<HTMLButtonElement>(root, 'button').find((b) => (b.textContent ?? '').trim() === text)
const noKatexError = (root: ParentNode) => expect(root.querySelector('.katex-error, .c-tex-error')).toBeNull()
const stat = (c: ParentNode, name: 'attempted' | 'correct' | 'rate') => q(c, `[data-testid="wb-stats-total"] [data-stat="${name}"]`)?.textContent
const shownCount = (c: ParentNode) => Number(q(c, '[data-testid="wb-filter-count"] strong')?.textContent)
const itemIds = (c: ParentNode) => qa(c, '.wb-item').map((el) => el.getAttribute('data-handcalc'))

const GROUPS = groupByChapter(ALL_HANDCALCS)

/** 在隨機練習卡片上填答案：good = 填模擬函式算出的值；否則填一個離得很遠的數 */
function fillAnswers(c: ParentNode, item: PracticeItem, good: boolean) {
  const inputs = qa<HTMLInputElement>(c, '.wb-practice-card input[placeholder="你的答案"]')
  expect(inputs).toHaveLength(item.solution.results.length)
  item.solution.results.forEach((r, i) => {
    const v = good ? r.value : r.value + 1000 * Math.max(1, Math.abs(r.value))
    fireEvent.change(inputs[i], { target: { value: String(v) } })
  })
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.classList.remove(PRINT_BODY_CLASS)
})

describe('手算練習簿：整頁', () => {
  it('smoke：說明、手算工具、題庫都畫得出來，沒有 KaTeX 錯誤', () => {
    const { container } = renderPage()
    noKatexError(container)
    expect(container.textContent).not.toMatch(/NaN|undefined/)
    // 說明：題數與各難度的題數來自題庫
    expect(q(container, '#wb-s1')?.parentElement?.textContent).toContain(`${ALL_HANDCALCS.length} 題`)
    const counts = countByLevel(ALL_HANDCALCS)
    for (const level of ['beginner', 'engineer', 'research'] as const) {
      expect(q(container, `.wb-level-table tr[data-level="${level}"] td.num`)?.textContent).toBe(String(counts[level]))
    }
    // 示範題（HC-00.1）是完整的 HandCalc
    expect(q(container, '.wb-demo .c-handcalc')).toBeTruthy()
    // 題庫：每一題一列，預設全部收合（不掛載 161 個 HandCalc）
    expect(itemIds(container)).toHaveLength(ALL_HANDCALCS.length)
    expect(qa(container, '.wb-item-body')).toHaveLength(0)
    expect(qa(container, '.wb-group')).toHaveLength(GROUPS.length)
    expect(shownCount(container)).toBe(ALL_HANDCALCS.length)
    // 章節標題連到該章
    const first = q(container, `.wb-group[data-chapter="${GROUPS[0].key}"]`)
    expect(q(first!, 'h3')?.textContent).toBe(GROUPS[0].nav)
    expect(q<HTMLAnchorElement>(first!, 'a')?.getAttribute('href')).toBe(GROUPS[0].path)
  })

  it('手算工具：Φ 表 31 格都是 normCdf 的值；近似誤差表有 z = 0.1、0.3、0.5 三列', () => {
    const { container } = renderPage()
    const cells = qa(container, '.wb-tools .wb-phi-table td[data-z]')
    expect(cells).toHaveLength(31)
    for (const td of cells) {
      const z = Number(td.getAttribute('data-z'))
      expect(td.textContent).toBe(normCdf(z).toFixed(4))
    }
    expect(q(container, '.wb-phi-table td[data-z="0"]')?.textContent).toBe('0.5000')
    expect(q(container, '.wb-phi-table td[data-z="3"]')?.textContent).toBe('0.9987')
    expect(qa(container, '.wb-approx-table tbody tr').map((tr) => tr.getAttribute('data-z'))).toEqual(['0.1', '0.3', '0.5'])
    expect(q(container, '.wb-approx-table tr[data-z="0.1"]')?.textContent).toContain(normCdf(0.1).toFixed(5))
    expect(qa(container, '.wb-const-table tbody tr').length).toBeGreaterThanOrEqual(12)
    expect(qa(container, '.wb-db-table tbody tr').length).toBeGreaterThanOrEqual(10)
  })

  it('手算工具：查表內插與 dB 小工具會跟著輸入更新；不是數字時顯示說明', () => {
    const { container } = renderPage()
    const z = q<HTMLInputElement>(container, 'input[aria-label="要查表的 z"]')!
    expect(q(container, '.wb-lookup-steps')?.textContent).toContain('0.6442') // 預設 z = 0.37
    fireEvent.change(z, { target: { value: '-1.25' } })
    const lookupText = q(container, '.wb-lookup-steps')?.textContent ?? ''
    expect(lookupText).toContain('0.8849') // Φ(1.2)
    expect(lookupText).toContain('0.9032') // Φ(1.3)
    expect(lookupText).toContain('0.1059') // 1 − 0.8941（內插值）
    noKatexError(container)
    fireEvent.change(z, { target: { value: 'abc' } })
    expect(q(container, '.wb-lookup-steps')).toBeNull()
    expect(z.getAttribute('aria-invalid')).toBe('true')

    const db = q<HTMLInputElement>(container, 'input[aria-label="要換算的 dB 值"]')!
    fireEvent.change(db, { target: { value: '20' } })
    expect(db.closest('.wb-tool-calc')?.textContent).toContain('= 100')
    noKatexError(container)
  })

  it('手算工具的獨立公式都排成多行：桌機上卡片只有半欄寬（約 390–430px），寫成一行會被切掉、底下多一條橫向捲軸', () => {
    const { container } = renderPage()
    const tex = qa(container, '.wb-tools .katex-display annotation').map((a) => a.textContent ?? '')
    const lines = (t: string) => t.split(String.raw`\\`).length
    // ② 小 |z| 近似：級數一行、框起來的結論一行
    const approx = tex.find((t) => t.includes(String.raw`\frac{z^5}{40}`))!
    expect(approx).toMatch(/^\\begin\{aligned\}\\Phi\(z\) &= /)
    expect(approx).toContain(String.raw`&\approx \boxed{\frac12 + \frac{z}{\sqrt{2\pi}}}`)
    expect(lines(approx)).toBe(2)
    // ④ dB 的定義一行、反過來解一行
    const dbDef = tex.find((t) => t.includes(String.raw`20\log_{10}\frac{A_2}{A_1}`))!
    expect(dbDef).toContain(String.raw`\mathrm{dB} = 10\log_{10}\frac{P_2}{P_1} = 20\log_{10}\frac{A_2}{A_1}`)
    expect(dbDef).toContain(String.raw`\frac{P_2}{P_1} = 10^{\mathrm{dB}/10}`)
    expect(dbDef).toContain(String.raw`\frac{A_2}{A_1} = 10^{\mathrm{dB}/20}`)
    expect(lines(dbDef)).toBe(2)
    // dB 計算機：功率比一行、振幅比一行（預設 −3 dB，數字不變）
    const dbCalc = tex.find((t) => t.includes('功率比'))!
    expect(dbCalc).toContain(String.raw`10^{-3/10} &= 0.50119\ \text{（功率比）}`)
    expect(dbCalc).toContain(String.raw`10^{-3/20} &= 0.70795\ \text{（振幅比）}`)
    expect(lines(dbCalc)).toBe(2)
    // 查表內插的第 3 步（預設 z = 0.37）：每個等號一行
    const interp = tex.find((t) => t.includes(String.raw`\Phi(0.37) &\approx`))!
    expect(lines(interp)).toBe(3)
    expect(interp).toContain(String.raw`&= 0.6179 + 0.7\times0.0375`)
    expect(interp).toContain(String.raw`&= 0.6179 + 0.02625 = 0.6442`)
    noKatexError(container)
  })
})

describe('手算工具（浮動）與說明文字', () => {
  it('右下角的「手算工具」：按一下叫出同一張 Φ 表，Esc 或「關閉」收起', () => {
    const { container } = renderPage()
    expect(q(container, '.wb-dock-panel')).toBeNull()
    fireEvent.click(buttonByText(container, '手算工具')!)
    const panel = q(container, '.wb-dock-panel')!
    expect(qa(panel, '.wb-phi-table td[data-z]')).toHaveLength(31)
    expect(q(panel, '.wb-const-table')).toBeTruthy()
    noKatexError(panel)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(q(container, '.wb-dock-panel')).toBeNull()
    fireEvent.click(buttonByText(container, '手算工具')!)
    fireEvent.click(buttonByText(q(container, '.wb-dock-panel')!, '關閉')!)
    expect(q(container, '.wb-dock-panel')).toBeNull()
    expect(q(container, '.wb-dock')?.classList.contains('wb-noprint')).toBe(true)
  })

  it('本頁自己的說明文字：數學一律在 KaTeX 裡，沒有用 Unicode 拼的公式（docs/teaching-style.md §3）', () => {
    const { container } = renderPage('/workbook?tab=sheet')
    // 希臘字母、Unicode 上下標，以及 ≤ ≥ ≈ ≠ √ ∞ ± 等符號
    const UNICODE_MATH = /[Ͱ-Ͽ⁰-₟²³¹≤≥≪≫≈≠∝√∞∑∫∂±⇒⇔]/
    for (const sel of ['.wb-top', '.wb-sheet-controls', '.wb-sheet-head', '.wb-sheet-tools']) {
      const clone = q(container, sel)!.cloneNode(true) as HTMLElement
      // 拿掉 KaTeX 與程式碼，以及不是本頁寫的文字（示範題來自第 00 章；章節名稱來自全站註冊表）
      for (const el of qa(clone, '.katex, code, .wb-demo, .wb-checks:not(.wb-checks-col), .wb-sheet-meta, option')) el.remove()
      const text = clone.textContent ?? ''
      expect(text.length, sel).toBeGreaterThan(20)
      const bad = UNICODE_MATH.exec(text)
      expect(bad ? text.slice(Math.max(0, bad.index - 15), bad.index + 15) : null, sel).toBeNull()
    }
  })
})

describe('題庫瀏覽：篩選、搜尋、展開', () => {
  it('依章節篩選', () => {
    const { container } = renderPage()
    const g = GROUPS[2]
    fireEvent.change(q<HTMLSelectElement>(container, 'select[aria-label="依章節篩選"]')!, { target: { value: g.key } })
    expect(itemIds(container)).toEqual(g.items.map((d) => d.id))
    expect(shownCount(container)).toBe(g.items.length)
    expect(qa(container, '.wb-group')).toHaveLength(1)
    fireEvent.click(buttonByText(container, '清除篩選')!)
    expect(shownCount(container)).toBe(ALL_HANDCALCS.length)
  })

  it('依難度篩選（再按一次取消）；與章節條件同時成立', () => {
    const { container } = renderPage()
    const chip = q<HTMLButtonElement>(container, '.wb-chip[data-level="research"]')!
    fireEvent.click(chip)
    const research = filterHandcalcs(ALL_HANDCALCS, { ...EMPTY_FILTERS, level: 'research' })
    expect(shownCount(container)).toBe(research.length)
    expect(qa(container, '.wb-item').every((el) => el.getAttribute('data-level') === 'research')).toBe(true)
    expect(q(container, '.wb-chip[data-level="research"]')?.getAttribute('aria-pressed')).toBe('true')

    const g = GROUPS.find((x) => x.items.some((d) => d.level === 'research'))!
    fireEvent.change(q<HTMLSelectElement>(container, 'select[aria-label="依章節篩選"]')!, { target: { value: g.key } })
    expect(itemIds(container)).toEqual(g.items.filter((d) => d.level === 'research').map((d) => d.id))

    fireEvent.click(q<HTMLButtonElement>(container, '.wb-chip[data-level="research"]')!)
    expect(itemIds(container)).toEqual(g.items.map((d) => d.id))
  })

  it('搜尋標題：結果與 filterHandcalcs 一致；找不到時顯示說明', () => {
    const { container } = renderPage()
    const input = q<HTMLInputElement>(container, 'input[aria-label="搜尋題目標題"]')!
    const target = ALL_HANDCALCS[Math.floor(ALL_HANDCALCS.length / 2)]
    fireEvent.change(input, { target: { value: target.id.toLowerCase() } })
    expect(itemIds(container)).toContain(target.id)
    expect(itemIds(container)).toEqual(
      groupByChapter(filterHandcalcs(ALL_HANDCALCS, { ...EMPTY_FILTERS, q: target.id }))
        .flatMap((g) => g.items)
        .map((d) => d.id),
    )
    fireEvent.change(input, { target: { value: '這個關鍵字不會出現在任何標題' } })
    expect(itemIds(container)).toHaveLength(0)
    expect(shownCount(container)).toBe(0)
    expect(container.textContent).toContain('沒有符合篩選條件的題目')
    noKatexError(container)
  })

  it('網址帶篩選條件（?ch=&level=&q=）時直接套用', () => {
    const g = GROUPS[1]
    const { container } = renderPage(`/workbook?ch=${g.key}&level=beginner`)
    expect(itemIds(container)).toEqual(g.items.filter((d) => d.level === 'beginner').map((d) => d.id))
    expect(q<HTMLSelectElement>(container, 'select[aria-label="依章節篩選"]')?.value).toBe(g.key)
  })

  it('點開一題：掛載完整的 <HandCalc compact />，再點一次收起；「全部展開」一次開整章', () => {
    const { container } = renderPage()
    const def = GROUPS[0].items[1]
    const row = q(container, `.wb-item[data-handcalc="${def.id}"]`)!
    const head = q<HTMLButtonElement>(row, '.wb-item-head')!
    expect(head.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    const body = q(row, '.wb-item-body')!
    expect(q(body, `[id="handcalc-${def.id}"]`)).toBeTruthy()
    expect(qa(body, '.c-step').length).toBe(def.solve(Object.fromEntries(def.inputs.map((i) => [i.key, i.default]))).steps.length)
    expect(q(body, '.c-handcalc-intro')).toBeNull() // compact
    noKatexError(body)
    fireEvent.click(head)
    expect(q(row, '.wb-item-body')).toBeNull()

    const group = q(container, `.wb-group[data-chapter="${GROUPS[0].key}"]`)!
    fireEvent.click(buttonByText(group, '全部展開')!)
    expect(qa(group, '.wb-item-body')).toHaveLength(GROUPS[0].items.length)
    noKatexError(group)
    fireEvent.click(buttonByText(group, '全部收合')!)
    expect(qa(group, '.wb-item-body')).toHaveLength(0)
  })

  it('?hc=<題號> 直接展開那一題', () => {
    const def = GROUPS[3].items[0]
    const { container } = renderPage(`/workbook?hc=${encodeURIComponent(def.id)}`)
    const open = qa(container, '.wb-item.open')
    expect(open.map((el) => el.getAttribute('data-handcalc'))).toEqual([def.id])
    expect(q(open[0], '.c-handcalc')).toBeTruthy()
  })
})

describe('隨機練習與作答統計', () => {
  const SEED = 314159
  const item = (k: number, pool = ALL_HANDCALCS) => practiceItem(pool, SEED, k)!
  const cardId = (c: ParentNode) => q(c, '.wb-practice-card')?.getAttribute('data-handcalc')

  it('題目由 seed 決定並顯示在畫面上；「下一題」照洗牌順序前進', () => {
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}`)
    expect(q<HTMLInputElement>(container, 'input[aria-label="題目種子 seed"]')?.value).toBe(String(SEED))
    expect(cardId(container)).toBe(item(0).def.id)
    expect(q(container, '[data-testid="wb-practice-pos"]')?.textContent).toContain(String(item(0).valueSeed))
    // 練習模式：先不顯示詳解
    expect(qa(container, '.wb-practice-card .c-step')).toHaveLength(0)
    noKatexError(container)
    fireEvent.click(buttonByText(container, '下一題 →')!)
    expect(cardId(container)).toBe(item(1).def.id)
    fireEvent.click(buttonByText(container, '下一題 →')!)
    expect(cardId(container)).toBe(item(2).def.id)
    noKatexError(container)
    // 改 seed：回到第 1 題，題目跟著換
    fireEvent.change(q<HTMLInputElement>(container, 'input[aria-label="題目種子 seed"]')!, { target: { value: '7' } })
    expect(cardId(container)).toBe(practiceItem(ALL_HANDCALCS, 7, 0)!.def.id)
    // 不合法的 seed：保留原本的題目並顯示說明
    fireEvent.change(q<HTMLInputElement>(container, 'input[aria-label="題目種子 seed"]')!, { target: { value: '-3' } })
    expect(cardId(container)).toBe(practiceItem(ALL_HANDCALCS, 7, 0)!.def.id)
    expect(container.textContent).toContain('seed 必須是 0 到')
  })

  it('出題尊重篩選條件', () => {
    const g = GROUPS[4]
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}&ch=${g.key}`)
    const ids = new Set<string>()
    for (let k = 0; k < g.items.length; k++) {
      expect(cardId(container)).toBe(item(k, g.items).def.id)
      ids.add(cardId(container)!)
      fireEvent.click(buttonByText(container, '下一題 →')!)
    }
    expect([...ids].sort()).toEqual(g.items.map((d) => d.id).sort()) // 輪完之前不重複
    // 條件太嚴：沒有題目
    fireEvent.change(q<HTMLInputElement>(container, 'input[aria-label="搜尋題目標題"]')!, { target: { value: '這個關鍵字不會出現在任何標題' } })
    expect(q(container, '.wb-practice-card')).toBeNull()
    expect(buttonByText(container, '下一題 →')?.disabled).toBe(true)
  })

  it('答對：作答 +1、答對 +1，寫進 localStorage；同一題重複對答案不重複計分', () => {
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}`)
    expect([stat(container, 'attempted'), stat(container, 'correct'), stat(container, 'rate')]).toEqual(['0', '0', '—'])
    const it0 = item(0)
    fillAnswers(container, it0, true)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect(qa(container, '.wb-practice-card .c-handcalc-verdict.ok')).toHaveLength(it0.solution.results.length)
    expect([stat(container, 'attempted'), stat(container, 'correct'), stat(container, 'rate')]).toEqual(['1', '1', '100%'])
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['1', '1'])

    const chapter = groupByChapter([it0.def])[0].key
    const stored = JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null')
    expect(stored).toEqual({ v: 1, chapters: { [chapter]: { attempted: 1, correct: 1 } }, solved: [it0.def.id] })
    expect(q(container, `.wb-stats-table tr[data-chapter="${chapter}"]`)).toBeTruthy()

    // 回到題庫：那一題打勾
    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-browse')!)
    expect(q(container, `.wb-item[data-handcalc="${it0.def.id}"] .wb-solved`)).toBeTruthy()
    expect(qa(container, '.wb-solved')).toHaveLength(1)
  })

  it('答錯只記作答；修正後（還沒看詳解）全對才記答對；先看詳解再答對不記', () => {
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}`)
    // 第 1 題：先錯、再修正
    fillAnswers(container, item(0), false)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect(qa(container, '.wb-practice-card .c-handcalc-verdict.bad').length).toBeGreaterThan(0)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['1', '0'])
    fillAnswers(container, item(0), true)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['1', '1'])

    // 第 2 題：先看詳解（出現逐步代入），再填正確答案
    fireEvent.click(buttonByText(container, '下一題 →')!)
    fireEvent.click(buttonByText(container, '看詳解')!)
    expect(qa(container, '.wb-practice-card .c-step')).toHaveLength(item(1).solution.steps.length)
    noKatexError(container)
    fillAnswers(container, item(1), true)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct'), stat(container, 'rate')]).toEqual(['2', '1', '50%'])
    expect(q(container, '.wb-practice-summary')?.textContent).toContain('只記作答')

    // 第 3 題：什麼都沒填就對答案 → 不計
    fireEvent.click(buttonByText(container, '下一題 →')!)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['2', '1'])
  })

  it('切到別的分頁再回來：同一題、已填的答案都還在，而且不會重複計分', () => {
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}`)
    fireEvent.click(buttonByText(container, '下一題 →')!)
    const it1 = item(1)
    fillAnswers(container, it1, true)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['1', '1'])
    const typed = () => qa<HTMLInputElement>(container, '.wb-practice-card input[placeholder="你的答案"]').map((i) => i.value)
    const before = typed()

    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-browse')!)
    expect(q(container, '[data-testid="wb-practice-host"]')?.hasAttribute('hidden')).toBe(true)
    expect(itemIds(container)).toHaveLength(ALL_HANDCALCS.length)
    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-sheet')!)
    expect(q(container, '.wb-sheet')).toBeTruthy()
    expect(q(container, '[data-testid="wb-practice-host"]')?.classList.contains('wb-noprint')).toBe(true)

    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-practice')!)
    expect(q(container, '[data-testid="wb-practice-host"]')?.hasAttribute('hidden')).toBe(false)
    expect(cardId(container)).toBe(it1.def.id)
    expect(typed()).toEqual(before)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['1', '1'])
  })

  it('還沒開過隨機練習時不掛載它（題庫與練習卷分頁不付這個成本）', () => {
    const { container } = renderPage('/workbook')
    expect(q(container, '[data-testid="wb-practice-host"]')).toBeNull()
    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-sheet')!)
    expect(q(container, '[data-testid="wb-practice-host"]')).toBeNull()
  })

  it('「重設統計」要再確認一次，確認後歸零', () => {
    localStorage.setItem(STATS_KEY, JSON.stringify({ v: 1, chapters: { [GROUPS[0].key]: { attempted: 4, correct: 3 } }, solved: [GROUPS[0].items[0].id] }))
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}`)
    expect([stat(container, 'attempted'), stat(container, 'correct'), stat(container, 'rate')]).toEqual(['4', '3', '75%'])
    fireEvent.click(buttonByText(container, '重設統計')!)
    expect(stat(container, 'attempted')).toBe('4') // 還沒確認
    fireEvent.click(buttonByText(container, '取消')!)
    expect(stat(container, 'attempted')).toBe('4')
    fireEvent.click(buttonByText(container, '重設統計')!)
    fireEvent.click(buttonByText(container, '確定重設')!)
    expect([stat(container, 'attempted'), stat(container, 'correct'), stat(container, 'rate')]).toEqual(['0', '0', '—'])
    expect(JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null')).toEqual({ v: 1, chapters: {}, solved: [] })
  })

  it('localStorage 裡的資料格式不對：忽略，從空統計開始', () => {
    localStorage.setItem(STATS_KEY, JSON.stringify({ v: 1, chapters: { x: { attempted: 1, correct: 5 } }, solved: [] }))
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}`)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['0', '0'])
  })

  it('storage 不可用（讀寫都丟例外）：頁面照常運作，統計只在這次瀏覽有效', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { container } = renderPage(`/workbook?tab=practice&seed=${SEED}`)
    noKatexError(container)
    expect(stat(container, 'attempted')).toBe('0')
    fillAnswers(container, item(0), true)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['1', '1'])
    fireEvent.click(buttonByText(container, '下一題 →')!)
    fillAnswers(container, item(1), false)
    fireEvent.click(buttonByText(container, '對答案')!)
    expect([stat(container, 'attempted'), stat(container, 'correct')]).toEqual(['2', '1'])
  })
})

describe('練習卷', () => {
  const sheetIds = (c: ParentNode) => qa(c, '.wb-sheet-questions > .wb-q').map((el) => el.getAttribute('data-handcalc'))
  const opts = (o: Partial<WorksheetOptions> = {}): WorksheetOptions => ({ chapters: [], levels: [], count: 10, seed: 20261010, numbers: 'random', ...o })
  const setSeed = (c: ParentNode, seed: number) => fireEvent.change(q<HTMLInputElement>(c, 'input[aria-label="練習卷 seed"]')!, { target: { value: String(seed) } })

  it('預設產生 10 題；題目、已知、空格、解答都在卷上，沒有 KaTeX 錯誤', () => {
    const { container } = renderPage('/workbook?tab=sheet')
    const ws = buildWorksheet(ALL_HANDCALCS, opts())
    const sheet = q(container, '.wb-sheet')!
    expect(sheet.getAttribute('data-seed')).toBe('20261010')
    expect(sheetIds(container)).toEqual(ws.items.map((i) => i.def.id))
    expect(sheetIds(container)).toHaveLength(10)
    noKatexError(sheet)
    expect(sheet.textContent).not.toMatch(/NaN|undefined/)
    const questions = qa(sheet, '.wb-q')
    questions.forEach((el, i) => {
      const it = ws.items[i]
      expect(q(el, '.wb-q-no')?.textContent).toBe(`${it.no}.`)
      expect(qa(el, '.wb-given li')).toHaveLength(it.def.inputs.length)
      expect(qa(el, '.wb-asks .wb-blank')).toHaveLength(it.solution.results.length)
      expect(qa(el, '.wb-work-line')).toHaveLength(8)
      // 題目區不洩漏詳解
      expect(q(el, '.c-step')).toBeNull()
      expect(q(el, '.c-handcalc-results')).toBeNull()
    })
    // 解答：每題的逐步代入步數與 def.solve 相同
    const answers = qa(sheet, '.wb-sheet-answers .wb-a')
    expect(answers.map((el) => el.getAttribute('data-handcalc'))).toEqual(ws.items.map((i) => i.def.id))
    answers.forEach((el, i) => {
      expect(qa(el, '.c-step')).toHaveLength(ws.items[i].solution.steps.length)
      expect(qa(el, '.c-handcalc-results .katex-display')).toHaveLength(ws.items[i].solution.results.length)
    })
    expect(q(sheet, '.wb-sheet-tools .wb-phi-table')).toBeTruthy()
    expect(q(container, '[data-testid="wb-sheet-status"]')?.textContent).toContain('已產生 10 題')
  })

  it('同一個 seed 得到同一張卷：改 seed 再改回來，題目與數字完全相同', () => {
    const { container } = renderPage('/workbook?tab=sheet')
    const before = q(container, '.wb-sheet-questions')!.innerHTML
    setSeed(container, 4242)
    expect(sheetIds(container)).toEqual(buildWorksheet(ALL_HANDCALCS, opts({ seed: 4242 })).items.map((i) => i.def.id))
    expect(q(container, '.wb-sheet')?.getAttribute('data-seed')).toBe('4242')
    expect(q(container, '.wb-sheet-questions')!.innerHTML).not.toBe(before)
    setSeed(container, 20261010)
    expect(q(container, '.wb-sheet-questions')!.innerHTML).toBe(before)

    // 另一次全新的載入也一樣
    cleanup()
    const again = renderPage('/workbook?tab=sheet')
    expect(q(again.container, '.wb-sheet-questions')!.innerHTML).toBe(before)
  })

  it('選章節、難度、題數與數字來源', () => {
    const { container } = renderPage('/workbook?tab=sheet')
    fireEvent.click(buttonByText(container, '全不選')!)
    expect(q(container, '.wb-sheet')).toBeNull()
    expect(container.textContent).toContain('請至少勾選一個章節與一種難度')
    expect(buttonByText(container, '列印 / 存成 PDF')?.disabled).toBe(true)

    const keys = [GROUPS[0].key, GROUPS[5].key]
    for (const k of keys) fireEvent.click(q<HTMLInputElement>(container, `.wb-checks input[data-chapter="${k}"]`)!)
    fireEvent.click(q<HTMLInputElement>(container, '.wb-checks input[data-level="research"]')!) // 取消 research
    const expected = buildWorksheet(ALL_HANDCALCS, opts({ chapters: keys, levels: ['beginner', 'engineer'] }))
    expect(sheetIds(container)).toEqual(expected.items.map((i) => i.def.id))
    for (const el of qa(container, '.wb-sheet-answers .wb-a')) expect(keys.map((k) => GROUPS.find((g) => g.key === k)!.items.map((d) => d.id)).flat()).toContain(el.getAttribute('data-handcalc'))

    // 題數：5
    const count = q<HTMLInputElement>(container, '.wb-sheet-controls input[type="range"]')!
    fireEvent.change(count, { target: { value: '5' } })
    expect(sheetIds(container)).toEqual(buildWorksheet(ALL_HANDCALCS, opts({ chapters: keys, levels: ['beginner', 'engineer'], count: 5 })).items.map((i) => i.def.id))
    expect(sheetIds(container)).toHaveLength(5)

    // 課文範例的數字：已知就是 inputs 的 default
    fireEvent.click(qa<HTMLInputElement>(container, 'input[name="wb-numbers"]')[1])
    const def = buildWorksheet(ALL_HANDCALCS, opts({ chapters: keys, levels: ['beginner', 'engineer'], count: 5, numbers: 'default' }))
    expect(sheetIds(container)).toEqual(def.items.map((i) => i.def.id))
    expect(q(container, '.wb-sheet')?.textContent).toContain('課文範例')
    noKatexError(container)
  })

  it('版面選項：不附解答、不附 Φ 表、作答行數、印出提示', () => {
    const { container } = renderPage('/workbook?tab=sheet')
    const boxes = qa<HTMLInputElement>(container, '.wb-sheet-controls .wb-checks-col input[type="checkbox"]').filter((b) => !b.hasAttribute('data-level'))
    const [answers, tools, tips] = boxes
    fireEvent.click(answers)
    expect(q(container, '.wb-sheet-answers')).toBeNull()
    fireEvent.click(tools)
    expect(q(container, '.wb-sheet-tools')).toBeNull()
    expect(q(container, '.wb-q-tips')).toBeNull()
    fireEvent.click(tips)
    expect(qa(container, '.wb-q-tips').length).toBeGreaterThan(0)
    fireEvent.change(q<HTMLSelectElement>(container, 'select[aria-label="每題作答區的橫線數"]')!, { target: { value: '0' } })
    expect(q(container, '.wb-work')).toBeNull()
    noKatexError(container)
  })

  it('從篩選條件切到練習卷：沿用目前的章節與難度', () => {
    const g = GROUPS.find((x) => x.items.filter((d) => d.level === 'engineer').length >= 2)!
    const { container } = renderPage(`/workbook?ch=${g.key}&level=engineer`)
    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-sheet')!)
    const expected = buildWorksheet(ALL_HANDCALCS, opts({ chapters: [g.key], levels: ['engineer'] }))
    expect(sheetIds(container)).toEqual(expected.items.map((i) => i.def.id))
    expect(qa<HTMLInputElement>(container, '.wb-checks input[data-chapter]').filter((b) => b.checked).map((b) => b.getAttribute('data-chapter'))).toEqual([g.key])
  })

  it('列印：按鈕呼叫 window.print()；body 的 class 只在練習卷分頁存在，離開就移除', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { container, unmount } = renderPage('/workbook')
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(false)
    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-sheet')!)
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(true)
    fireEvent.click(buttonByText(container, '列印 / 存成 PDF')!)
    expect(print).toHaveBeenCalledTimes(1)
    // 切回題庫：class 移除（其他分頁、其他頁面的列印不受影響）
    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-browse')!)
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(false)
    fireEvent.click(q<HTMLButtonElement>(container, '#wb-tab-sheet')!)
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(true)
    act(() => unmount())
    expect(document.body.classList.contains(PRINT_BODY_CLASS)).toBe(false)
  })

  it('window.print 丟例外時不讓頁面壞掉', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { container } = renderPage('/workbook?tab=sheet')
    expect(() => fireEvent.click(buttonByText(container, '列印 / 存成 PDF')!)).not.toThrow()
    expect(q(container, '.wb-sheet')).toBeTruthy()
  })

  it('卷子以外的區塊都標了 wb-noprint（不支援 :has() 的瀏覽器靠它隱藏）', () => {
    const { container } = renderPage('/workbook?tab=sheet')
    const sheet = q(container, '.wb-sheet')!
    // 從卷子往上走到頁面根節點：每一層的其他兄弟都必須是 wb-noprint
    let node: Element = sheet
    const root = q(container, '.wb-page')!
    while (node !== root) {
      const parent = node.parentElement!
      for (const sib of Array.from(parent.children)) {
        if (sib !== node) expect(sib.classList.contains('wb-noprint'), `<${sib.tagName.toLowerCase()} class="${sib.className}">`).toBe(true)
      }
      node = parent
    }
  })
})

describe('列印樣式（workbook.css）', () => {
  /** 取出所有 @media print { … } 區塊的內容 */
  function printBlocks(src: string): string[] {
    const out: string[] = []
    let from = 0
    for (;;) {
      const at = src.indexOf('@media print', from)
      if (at < 0) return out
      const open = src.indexOf('{', at)
      let depth = 1
      let i = open + 1
      while (depth > 0 && i < src.length) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
        i++
      }
      out.push(src.slice(open + 1, i - 1))
      from = i
    }
  }

  it('所有列印規則都以 body.wb-print-sheet 為前提（不影響其他頁面的列印）', () => {
    const blocks = printBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''))
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    let rules = 0
    for (const block of blocks) {
      for (const m of block.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const sel of m[1].split(',')) {
          expect(sel.trim().startsWith(`body.${PRINT_BODY_CLASS}`), sel.trim()).toBe(true)
          rules++
        }
      }
    }
    expect(rules).toBeGreaterThan(15)
  })

  it('隱藏全站外框、卷面改白底黑字、解答另起一頁；:has() 的保險規則獨立成一條', () => {
    const blocks = printBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''))
    const all = blocks.join('\n')
    for (const sel of ['.topbar', '.sidebar', '.page-header', '.page-pager', '.wb-noprint']) expect(all).toContain(`body.${PRINT_BODY_CLASS} ${sel}`)
    expect(all).toMatch(/\.wb-sheet\s*\{[^}]*--text:\s*#000/)
    expect(all).toMatch(/\.wb-sheet-answers\s*\{[^}]*break-before:\s*page/)
    const hasBlock = blocks.filter((b) => b.includes(':has('))
    expect(hasBlock).toHaveLength(1)
    expect(hasBlock[0].match(/\{/g)).toHaveLength(1) // 只有那一條規則，解析失敗時不會連累其他規則
  })
})
