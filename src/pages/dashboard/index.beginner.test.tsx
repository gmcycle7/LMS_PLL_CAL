import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { GROUP_LABEL, PAGES } from '@/app/registry'
import { CHAPTER_META, QUESTIONS } from './data'
import { DASH_SYMBOLS } from './sections/Symbols'
import { FOLD_IDS } from './sections/ThesisFold'
import { foldKeyOf } from './sections/foldIds'
import { precedes, renderPage, stubScrollIntoView, texIn } from './indexTestUtils'

/**
 * 首頁 Beginner 模式的第三組 jsdom 測試：長的段落收起來（章節地圖是一張表、15 個問題只列問題、綜合手算／思考題／本頁必記各一張卡片、符號表一張卡片），
 * 收起來的內容展開才渲染；頁內跳轉與網址深連結要先展開再捲。六條件一分鐘體檢那張卡片的測試在 index.test.tsx／index.research.test.tsx。
 * Beginner 的首頁很輕（收起來的內容不進 DOM），所以這個檔案可以放心多渲染幾次。
 */
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

vi.setConfig({ testTimeout: 60_000 })

const GROUPS = ['A', 'B', 'C', 'D', 'tools'] as const

describe('DashboardPage Beginner：收合的長段落', () => {
  it('章節地圖是一張表：每章一列（已讀、章名連結、一句話），沒有卡片；已讀紀錄更新路線進度', () => {
    const { container } = renderPage('beginner')
    const sec = container.querySelector('#dash-chapters') as HTMLElement
    expect(sec.querySelectorAll('.dash-ch-card, .dash-ch-grid, .c-model-level, .c-test-badge')).toHaveLength(0)
    const table = sec.querySelector('table.dash-ch-table') as HTMLElement
    expect(table.closest('.table-wrap')).not.toBeNull()
    // 每個 Part 一個 tbody，第一列是組名（rowgroup）
    const bodies = Array.from(table.querySelectorAll('tbody'))
    const groups = GROUPS.filter((g) => PAGES.some((p) => p.group === g))
    expect(bodies.map((b) => b.querySelector('tr.dash-ch-group th')?.textContent)).toEqual(groups.map((g) => GROUP_LABEL[g]))
    // 每個頁面一列：章名是連結（href = 頁面路徑）、有已讀核取方塊、一句話來自 CHAPTER_META
    const pages = PAGES.filter((p) => (GROUPS as readonly string[]).includes(p.group))
    const rows = Array.from(table.querySelectorAll('tbody tr:not(.dash-ch-group)'))
    expect(rows).toHaveLength(pages.length)
    rows.forEach((tr, i) => {
      const p = pages[i]
      const link = tr.querySelector('a.dash-ch-nav') as HTMLAnchorElement
      expect(link.getAttribute('href'), p.id).toBe(p.path)
      expect(link.textContent).toBe(p.nav)
      expect((tr.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.getAttribute('aria-label'), p.id).toBe(`標記「${p.nav}」為已讀`)
      const line = (tr.querySelector('.dash-ch-line')?.textContent ?? '').trim()
      expect(line.length, p.id).toBeGreaterThan(5)
      expect(CHAPTER_META[p.id], p.id).toBeTruthy()
    })
    // 一句話裡的數學用 KaTeX（例如 Ch00 的 y = ax）
    expect(texIn(sec).length).toBeGreaterThan(5)
    // 沒有勾選時沒有「清除已讀紀錄」；勾了之後路線進度更新、出現清除按鈕
    expect(sec.querySelector('button.btn-icon')).toBeNull()
    const box = sec.querySelector('input[aria-label="標記「01 LMS 起源與 MSE / MAE」為已讀"]') as HTMLInputElement
    fireEvent.click(box)
    expect((container.querySelector('.dash-route') as HTMLElement).textContent).toMatch(/已讀 1\//)
    expect(box.closest('tr')?.classList.contains('is-done')).toBe(true)
    fireEvent.click(within(sec).getByRole('button', { name: '清除已讀紀錄' }))
    expect((container.querySelector('.dash-route') as HTMLElement).textContent).toMatch(/已讀 0\//)
  })

  it('15 個問題：只列問題，點開才渲染短答案與回答它的章節；網址 ?a=dash-q-N 一開始就展開那一題；Engineer 仍是完整卡片', async () => {
    const a = renderPage('beginner')
    const sec = a.container.querySelector('#dash-questions') as HTMLElement
    const items = Array.from(sec.querySelectorAll('li.dash-qf')) as HTMLElement[]
    expect(items.map((li) => li.id)).toEqual(QUESTIONS.map((q) => `dash-q-${q.n}`))
    expect(sec.querySelectorAll('.dash-q')).toHaveLength(0) // 沒有 Engineer 的卡片
    expect(sec.querySelectorAll('.dash-q-answer, .dash-cond-chip, .dash-erratum')).toHaveLength(0) // 答案還沒渲染，也沒有條件 chip／T-id
    for (const li of items) {
      expect(li.querySelector('summary')?.textContent).toContain(String(QUESTIONS[items.indexOf(li)].n))
      expect((li.querySelector('details') as HTMLDetailsElement).open).toBe(false)
    }
    // 點開第 5 題：短答案（固定 x = 2 的 μ 區間）與回答它的章節（Ch03 為主、Ch08）
    const q5 = a.container.querySelector('#dash-q-5') as HTMLElement
    fireEvent.click(q5.querySelector('summary') as HTMLElement)
    await waitFor(() => expect(q5.querySelector('.dash-q-answer')).not.toBeNull())
    expect(texIn(q5.querySelector('.dash-q-answer'))).toContain('0<\\mu<0.25')
    expect(Array.from(q5.querySelectorAll('.dash-q-row a'), (x) => x.getAttribute('href'))).toEqual(['/ch/03', '/ch/08'])
    expect(sec.querySelectorAll('.dash-q-answer')).toHaveLength(1) // 其他題仍然沒有渲染
    fireEvent.click(q5.querySelector('summary') as HTMLElement)
    await waitFor(() => expect(q5.querySelector('.dash-q-answer')).toBeNull())
    a.unmount()
    // ?a=dash-q-10：那一題一開始就展開（答案裡有二狀態模型），其他題沒有
    const b = renderPage('beginner', '/?a=dash-q-10')
    expect((b.container.querySelector('#dash-q-10 details') as HTMLDetailsElement).open).toBe(true)
    expect(b.container.querySelector('#dash-q-10 .dash-q-answer')?.textContent).toContain('二狀態模型')
    expect(b.container.querySelectorAll('#dash-questions .dash-q-answer')).toHaveLength(1)
    b.unmount()
    // Engineer：完整卡片（條件 chip、T-id、短答案的 details）
    const c = renderPage('engineer')
    expect(c.container.querySelectorAll('#dash-questions .dash-q')).toHaveLength(15)
    expect(c.container.querySelectorAll('#dash-questions .dash-qf')).toHaveLength(0)
    expect(c.container.querySelectorAll('#dash-chapters .dash-ch-card').length).toBe(PAGES.filter((p) => (GROUPS as readonly string[]).includes(p.group)).length)
    expect(c.container.querySelector('#dash-chapters table')).toBeNull()
    c.unmount()
  })

  it('綜合手算／思考題／本頁必記：三張卡片收合、展開才渲染；?a=handcalc-HC-DB.6 展開第一張', async () => {
    const a = renderPage('beginner')
    const sec = a.container.querySelector('#dash-recap') as HTMLElement
    const cards = Array.from(sec.querySelectorAll(':scope > details.dash-foldcard')) as HTMLDetailsElement[]
    expect(cards.map((d) => d.querySelector('.dash-fold-title')?.textContent)).toEqual([
      '綜合手算：把六個條件的關鍵數字一次算完（展開）',
      '思考題（3 題，附解析）（展開）',
      '本頁必記：六個條件的判據（展開）',
    ])
    expect(cards.every((d) => !d.open)).toBe(true)
    expect(sec.querySelectorAll('.c-handcalc, .c-quiz, .c-recap, [data-handcalc]')).toHaveLength(0)
    // 小卡片不是「六條件一分鐘體檢」那張（那張的 id 是 dash-fold、class 有 dash-fold）
    expect(cards.some((d) => d.classList.contains('dash-fold'))).toBe(false)
    // 一次只渲染點開的那一張
    fireEvent.click(cards[1].querySelector('summary') as HTMLElement)
    await waitFor(() => expect(sec.querySelectorAll('.c-quiz')).toHaveLength(3))
    expect(sec.querySelectorAll('.c-handcalc, .c-recap')).toHaveLength(0)
    expect(cards[1].querySelector('.dash-fold-title')?.textContent).toContain('（收合）')
    fireEvent.click(cards[2].querySelector('summary') as HTMLElement)
    await waitFor(() => expect(sec.querySelectorAll('.c-recap')).toHaveLength(1))
    expect(sec.querySelectorAll('.c-recap-points li')).toHaveLength(5)
    // 本頁必記第 1 點：句尾的公式和句號仍然綁在一起
    expect((sec.querySelector('.c-recap-points li') as HTMLElement).lastElementChild?.className).toBe('dash-glue')
    fireEvent.click(cards[0].querySelector('summary') as HTMLElement)
    await waitFor(() => expect(sec.querySelectorAll('[data-handcalc="HC-DB.6"]')).toHaveLength(1))
    // 卡片的 summary 已經說明這題在做什麼：內文只留練習簿的連結
    expect(sec.querySelector('.dash-handcalc-lead')?.textContent).not.toContain('把前面幾題串起來')
    expect(sec.querySelector('.dash-handcalc-lead a')?.getAttribute('href')).toBe('/workbook')
    // 順序：綜合題在思考題之前、思考題在本頁必記之前（和 Engineer 的版面相同）
    expect(precedes(sec.querySelector('[data-handcalc]'), sec.querySelector('.c-quiz'))).toBe(true)
    expect(precedes(sec.querySelector('.c-quiz'), sec.querySelector('.c-recap'))).toBe(true)
    a.unmount()
    // 深連結 ?a=handcalc-HC-DB.6：只展開綜合手算那一張，目標元素就在 DOM 裡（PageFrame 的 AnchorDeepLink 才捲得到）
    const b = renderPage('beginner', '/?a=handcalc-HC-DB.6')
    const first = b.container.querySelector('#dash-recap details.dash-foldcard') as HTMLDetailsElement
    expect(first.open).toBe(true)
    await waitFor(() => expect(b.container.querySelector('[id="handcalc-HC-DB.6"]')).not.toBeNull())
    expect(b.container.querySelectorAll('#dash-recap .c-quiz, #dash-recap .c-recap')).toHaveLength(0)
    expect((b.container.querySelector('details.dash-fold') as HTMLDetailsElement).open).toBe(false) // 六條件的卡片不受影響
    b.unmount()
  })

  it('符號表收成一張卡片，仍是頁面最後一個區塊；「本頁符號表在最後 ↓」先展開再捲；?a=symbols 一開始就展開', async () => {
    const scrolled = stubScrollIntoView()
    try {
      const a = renderPage('beginner')
      const page = a.container.querySelector('.dash') as HTMLElement
      const symbols = a.container.querySelector('#symbols') as HTMLElement
      expect(page.lastElementChild).toBe(symbols)
      expect(symbols.querySelector('h2')?.textContent).toBe('本頁符號表')
      expect(precedes(a.container.querySelector('#dash-recap'), symbols)).toBe(true)
      const card = symbols.querySelector('details.dash-foldcard') as HTMLDetailsElement
      expect(card.open).toBe(false)
      expect(card.querySelector('.dash-fold-title')?.textContent).toBe(`${DASH_SYMBOLS.length} 個符號與單位（展開）`)
      expect(a.container.querySelectorAll('.c-symbols')).toHaveLength(0)
      // 頁首那一行：先展開、符號表渲染出來之後才捲到 #symbols
      const jump = a.container.querySelector('.dash-symbols-jump button') as HTMLButtonElement
      fireEvent.click(jump)
      await waitFor(() => expect(symbols.querySelectorAll('.c-symbols tbody tr')).toHaveLength(DASH_SYMBOLS.length))
      expect(card.open).toBe(true)
      await waitFor(() => expect(scrolled.ids).toContain('symbols'))
      // 再按一次（已展開）：直接捲，不重複展開
      scrolled.ids.length = 0
      fireEvent.click(jump)
      expect(scrolled.ids).toEqual(['symbols'])
      expect(card.open).toBe(true)
      // 收合：表卸載
      fireEvent.click(card.querySelector('summary') as HTMLElement)
      await waitFor(() => expect(a.container.querySelectorAll('.c-symbols')).toHaveLength(0))
      a.unmount()
      const b = renderPage('beginner', '/?a=symbols')
      expect((b.container.querySelector('#symbols details') as HTMLDetailsElement).open).toBe(true)
      expect(b.container.querySelectorAll('#symbols .c-symbols')).toHaveLength(1)
      b.unmount()
      // Engineer：不收合
      const c = renderPage('engineer')
      expect(c.container.querySelector('#symbols details.dash-foldcard')).toBeNull()
      expect(c.container.querySelectorAll('#symbols .c-symbols tbody tr')).toHaveLength(DASH_SYMBOLS.length)
      c.unmount()
    } finally {
      scrolled.restore()
    }
  })

  it('15 個問題的清單：一欄的軌道是 minmax(0, 1fr)，點開的答案（整行公式、表格）不會把清單撐寬、整頁橫向捲動', () => {
    // jsdom 不排版：直接讀 dashboard.css 的規則。沒有這一條時 720 px 以下的視窗點開任何一題，清單就被答案的 min-content（約 700 px）撐寬，整頁出現橫向捲軸
    const css = readFileSync(join(process.cwd(), 'src/pages/dashboard/dashboard.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const block = /\.dash-qf-list\s*\{([^}]*)\}/.exec(css)
    expect(block, '.dash-qf-list 的規則').not.toBeNull()
    expect(block![1].replace(/\s+/g, ' ')).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('foldKeyOf：每個 id 最多收在一張卡片裡（六條件／綜合手算／符號表），卡片外的 id 不屬於任何一張', () => {
    expect(foldKeyOf('dash-check')).toBe('thesis')
    expect(foldKeyOf('formula-F-DB.3')).toBe('thesis')
    expect(foldKeyOf('handcalc-HC-DB.5')).toBe('thesis')
    expect(foldKeyOf('handcalc-HC-DB.6')).toBe('handcalc')
    expect(foldKeyOf('symbols')).toBe('symbols')
    for (const id of ['dash-recap', 'dash-q-3', 'dash-chapters', 'dash-gallery', 'dash-title', 'dash-fold']) expect(foldKeyOf(id), id).toBeNull()
    // 兩張卡片的規則互斥（綜合題 HC-DB.6 不在六條件那張）
    expect(FOLD_IDS.test('handcalc-HC-DB.6')).toBe(false)
  })

  it('首頁 Beginner 輕量：收起來的內容不進 DOM（KaTeX 公式數有上限）；切到 Engineer 才渲染完整內容', async () => {
    const { container } = renderPage('beginner')
    const initial = container.querySelectorAll('.katex').length
    // Engineer 版面約 1,300 個 KaTeX 公式、6 萬個 DOM 節點（40,000 px）；Beginner 首頁只剩系統地圖、路線、章節表等：約 85 個公式、4,500 個節點（約 9,000 px，收合前約 18,000 px）
    expect(initial).toBeLessThan(150)
    expect(container.querySelectorAll('*').length).toBeLessThan(7000)
    // 順序（和 Engineer 相同的段落順序，只是長的段落收起來）
    const order = ['dash-outcomes', 'dash-map', 'dash-routes', 'dash-modes', 'dash-fold', 'dash-chapters', 'dash-gallery', 'dash-questions', 'dash-verify', 'dash-recap', 'symbols']
    const els = order.map((id) => container.querySelector(`#${id}`))
    els.forEach((el, i) => {
      expect(el, order[i]).not.toBeNull()
      if (i > 0) expect(precedes(els[i - 1], el), `${order[i - 1]} → ${order[i]}`).toBe(true)
    })
    // 模式切換：Beginner → Engineer，章節地圖變成卡片、問題變成完整卡片、卡片都消失
    fireEvent.click(within(container.querySelector('#dash-modes') as HTMLElement).getByRole('button', { name: /切換到 Engineer/ }))
    await waitFor(() => expect(container.querySelector('#dash-chapters .dash-ch-card')).not.toBeNull())
    expect(container.querySelector('#dash-chapters table')).toBeNull()
    expect(container.querySelectorAll('#dash-questions .dash-q')).toHaveLength(15)
    expect(container.querySelectorAll('details.dash-foldcard')).toHaveLength(0)
  })
})
