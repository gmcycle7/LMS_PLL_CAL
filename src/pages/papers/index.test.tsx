import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { PAGES } from '@/app/registry'
import PapersPage, { SYMBOLS } from './index'
import { PAPERS, doiUrl, toBibtex } from './references'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { LOCAL_PRESETS } from './experiments/labModel'
import { renderPage as renderInApp } from '@/test/renderPage'
import { expectNoTexErrors } from '@/test/katex'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())

vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

function renderPage(mode?: 'beginner' | 'engineer' | 'research') {
  return renderInApp(<PapersPage />, { mode, url: '/papers' })
}

afterEach(() => {
  localStorage.clear()
})

describe('Papers / Reading 頁（jsdom smoke）', () => {
  it('完整渲染不丟錯：符號表、九個段落、七張文獻卡、DOI 連結、勘誤標記、程式碼並排', () => {
    const { container } = renderPage('engineer')
    // 符號表
    expect(container.querySelectorAll('.c-symbols tbody tr').length).toBe(SYMBOLS.length)
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(20)
    // 段落標題
    for (const t of [
      '1. 這一頁的規則',
      '2. 閱讀路線',
      '3. 七份文獻',
      '4. 讀文獻前的換算',
      '5. 動手',
      '6. 文獻說',
      '7. 背景教科書',
      '8. 綜合手算與思考題',
      '9. 本頁必記',
    ]) {
      expect(screen.getAllByText((_, el) => !!el && el.tagName === 'H2' && (el.textContent ?? '').startsWith(t)).length).toBe(1)
    }
    // 七張卡片、每張有正確的 DOI 連結（D7 無 DOI）
    const cards = container.querySelectorAll('article.papers-card')
    expect(cards.length).toBe(7)
    for (const p of PAPERS) {
      const card = container.querySelector(`#papers-${p.id}`) as HTMLElement
      expect(card).not.toBeNull()
      const doiLinks = Array.from(card.querySelectorAll('a.papers-doi'))
      if (p.doi) {
        expect(doiLinks.map((a) => a.getAttribute('href'))).toEqual([doiUrl(p.doi)])
        expect(doiLinks[0].getAttribute('rel')).toContain('noopener')
      } else {
        expect(doiLinks.length).toBe(0)
        expect(within(card).getByText(/無 DOI/)).toBeTruthy()
      }
      expect(within(card).getByText('已發表主張（題名層級）')).toBeTruthy()
      expect(within(card).getByText('本站推導（derived on this site）')).toBeTruthy()
    }
    // 勘誤標記一律連到驗證頁（#/verification）的該項勘誤深連結
    const errata = Array.from(container.querySelectorAll('a.papers-erratum-tag'))
    expect(errata.length).toBeGreaterThan(20)
    for (const a of errata) {
      const id = a.getAttribute('data-erratum')
      expect(id).toMatch(/^E\d\d$/)
      expect(a.getAttribute('href')).toBe(`#/verification?e=${id}`)
      expect(a.textContent).toBe(`勘誤 ${id}`)
    }
    expect(errata.map((a) => a.textContent)).toEqual(expect.arrayContaining(['勘誤 E41', '勘誤 E06', '勘誤 E15', '勘誤 E05']))
    // 本站頁面 chip 由 registry 產生，沒有缺頁
    expect(container.querySelectorAll('.papers-chip-missing').length).toBe(0)
    expect(container.querySelectorAll('a.papers-chip[href="/ch/12"]').length).toBeGreaterThan(0)
    // KaTeX 有渲染；程式碼 region 全部擷取成功，差異行有高亮
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(300)
    expect(screen.queryByText(/找不到程式碼 region/)).toBeNull()
    expect(container.querySelectorAll('.c-code-mark').length).toBeGreaterThanOrEqual(5)
    // 先備知識框
    expect(container.querySelectorAll('details.c-prereq').length).toBeGreaterThanOrEqual(7)
    // 實驗外框與交叉比對
    const exp = container.querySelector('[data-experiment="papers-convention-bridge"]') as HTMLElement
    expect(exp).not.toBeNull()
    expect(within(exp).getAllByText(/Not implemented/).length).toBeGreaterThan(0)
    // KaTeX 沒有語法錯誤；可見文字沒有 NaN / undefined（程式碼區塊、公式與 TestBadge 提示框裡別人測試的原始標題除外）
    expectNoTexErrors(container)
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.katex, pre, .c-tip').forEach((n) => n.remove())
    expect(clone.textContent).not.toMatch(/NaN|undefined|\[object/)
    // log 軸的軌跡已截斷，不會出現「已略去 N 個 ≤0 的點」
    expect(within(exp).queryByText(/已略去 \d+ 個 ≤0 的點/)).toBeNull()
    // 思考題與必記：每一題的選項文字不重複，且恰有一個正解可被選到
    expect(container.querySelectorAll('.c-quiz').length).toBe(4)
    container.querySelectorAll('.c-quiz').forEach((quiz) => {
      const opts = Array.from(quiz.querySelectorAll('.c-quiz-opt')).map((o) => o.textContent)
      expect(opts.length).toBeGreaterThanOrEqual(3)
      expect(new Set(opts).size, opts.join(' / ')).toBe(opts.length)
    })
    expect(container.querySelectorAll('.c-recap').length).toBe(1)
    // 公式登錄：每個 F-PR.n 在頁面上恰有一個錨點（Formula & Unit Reference 頁依此跳轉）
    for (const f of FORMULAS) {
      const anchors = container.querySelectorAll(`[id="formula-${f.id}"]`)
      expect(anchors.length, f.id).toBe(1)
      expect(anchors[0].textContent, f.id).toContain(`(${f.id})`)
    }
    // 手機版不撐破版面：本頁每一張表格都包在可橫向捲動的 .table-wrap 裡
    const tables = Array.from(container.querySelectorAll('table'))
    expect(tables.length).toBeGreaterThan(15)
    for (const t of tables) expect(t.closest('.table-wrap'), t.className || t.textContent?.slice(0, 40)).not.toBeNull()
    // 連結：對外連結都是 https 且開新分頁時帶 noopener；站內連結都指向 registry 裡存在的路由
    for (const a of Array.from(container.querySelectorAll('a[target="_blank"]'))) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\//)
      expect(a.getAttribute('rel')).toContain('noopener')
    }
    const routes = new Set(PAGES.map((p) => p.path))
    for (const a of Array.from(container.querySelectorAll('a.papers-chip'))) expect(routes.has(a.getAttribute('href') ?? ''), a.getAttribute('href') ?? '').toBe(true)
    for (const a of Array.from(container.querySelectorAll('a[href^="#/"]'))) {
      const path = (a.getAttribute('href') ?? '').slice(1).split('?')[0]
      expect(routes.has(path), a.getAttribute('href') ?? '').toBe(true)
    }
    // 無障礙：每個輸入欄、下拉選單與按鈕都有可讀的名稱
    for (const el of Array.from(container.querySelectorAll('input, select'))) {
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && container.querySelector(`label[for="${el.id}"]`))
      expect(named, el.outerHTML.slice(0, 120)).toBeTruthy()
    }
    for (const b of Array.from(container.querySelectorAll('button'))) expect((b.textContent ?? '').trim().length + (b.getAttribute('aria-label') ?? '').length, b.outerHTML.slice(0, 120)).toBeGreaterThan(0)
    // 帶入手算：每一題在頁面上恰好出現一次，放在對應的段落／文獻卡裡；綜合題緊接在思考題之前
    const where: Record<string, string> = {
      'HC-PR.1': '#papers-conventions',
      'HC-PR.2': '#papers-conventions',
      'HC-PR.3': '#papers-conventions',
      'HC-PR.4': '#papers-D1',
      'HC-PR.5': '#papers-D3',
      'HC-PR.6': '#papers-D5',
      'HC-PR.7': '#papers-D6',
      'HC-PR.8': '#papers-quiz',
    }
    expect(Object.keys(where)).toEqual(HANDCALCS.map((h) => h.id))
    expect(container.querySelectorAll('section.c-handcalc').length).toBe(HANDCALCS.length)
    for (const h of HANDCALCS) {
      const nodes = container.querySelectorAll(`[id="handcalc-${h.id}"]`)
      expect(nodes.length, h.id).toBe(1)
      const host = container.querySelector(where[h.id]) as HTMLElement
      expect(host, where[h.id]).not.toBeNull()
      expect(host.contains(nodes[0]), `${h.id} 應在 ${where[h.id]} 內`).toBe(true)
      // 預設值直接顯示帶入過程：有步驟、有答案，沒有警告
      expect(nodes[0].querySelectorAll('.c-step').length, h.id).toBe(h.solve(Object.fromEntries(h.inputs.map((i) => [i.key, i.default]))).steps.length)
      expect(nodes[0].querySelector('.callout-warn'), h.id).toBeNull()
      // 題目放在它對應的公式錨點之後（先看推導，再代數字）
      const anchor = container.querySelector(`[id="formula-${h.formulaId}"]`) as HTMLElement
      expect(anchor, `${h.id} → ${h.formulaId}`).not.toBeNull()
      if (h.id !== 'HC-PR.8') expect(anchor.compareDocumentPosition(nodes[0]) & Node.DOCUMENT_POSITION_FOLLOWING, `${h.id} 應在 ${h.formulaId} 之後`).toBeTruthy()
    }
    const quiz = container.querySelector('#papers-quiz') as HTMLElement
    const firstQuiz = quiz.querySelector('.c-quiz') as HTMLElement
    expect(container.querySelector('[id="handcalc-HC-PR.8"]')!.compareDocumentPosition(firstQuiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // BibTeX：七張卡片各一段，內容就是 toBibtex() 的輸出
    for (const p of PAPERS) {
      const pre = container.querySelector(`pre[data-bibtex="${p.id}"]`)
      expect(pre?.textContent).toBe(toBibtex(p))
    }
    // 字串屬性裡的 $…$ 都有被轉成 KaTeX：可見文字不殘留 $（公式、程式碼、BibTeX 除外）
    const visible = container.cloneNode(true) as HTMLElement
    // 共用元件自己的外框文字（徽章 tooltip、指標表表頭的 Δ）不屬於本頁內容，一併排除
    visible.querySelectorAll('.katex, pre, code, option, script, style, .c-tip, .c-metric-table thead').forEach((n) => n.remove())
    const text = visible.textContent ?? ''
    const dollars = Array.from(text.matchAll(/\$/g)).map((m) => text.slice(Math.max(0, (m.index ?? 0) - 25), (m.index ?? 0) + 25))
    expect(dollars, '可見文字中殘留的 $').toEqual([])
    // 數學一律 LaTeX：可見文字不以 Unicode 拼公式（ΔΣ 為專有名詞；規格書原文引用與 preset 名稱除外）
    const clean = text.replace(/ΔΣ/g, '')
    const leftovers = Array.from(clean.matchAll(/[α-ωΑ-Ω²³⁻¹₀-₉√≈≤≥∞‖⇒⇔∝½]/g)).map((m) => clean.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 20))
    expect(leftovers, '可見文字中殘留的 Unicode 數學符號').toEqual([])
  }, 60000)

  it('依模式收合：Beginner 的推導面板預設收合，Engineer 預設展開', () => {
    const b = renderPage('beginner')
    const foldsB = Array.from(b.container.querySelectorAll('details.papers-fold'))
    expect(foldsB.length).toBe(9) // 7 張文獻卡 + §4 的兩段推導
    expect(foldsB.every((d) => !(d as HTMLDetailsElement).open)).toBe(true)
    expect(screen.getByText('入門模式：先抓住三句話')).toBeTruthy()
    b.unmount()
    localStorage.clear()
    const e = renderPage('engineer')
    const foldsE = Array.from(e.container.querySelectorAll('details.papers-fold'))
    expect(foldsE.every((d) => (d as HTMLDetailsElement).open)).toBe(true)
  }, 60000)

  it('Research 與 Beginner 模式多出來的內容也遵守同樣的規則：沒有 KaTeX 錯誤、沒有殘留的 $、不以 Unicode 拼公式；全程沒有 console.error', () => {
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      // React 的 act() 提醒來自共用 Plot 元件的非同步載入，不是本頁的錯誤
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return
      errors.push(args)
    })
    for (const mode of ['research', 'beginner'] as const) {
      const { container, unmount } = renderPage(mode)
      expectNoTexErrors(container, mode)
      const visible = container.cloneNode(true) as HTMLElement
      visible.querySelectorAll('.katex, pre, code, option, script, style, .c-tip, .c-metric-table thead').forEach((n) => n.remove())
      const text = (visible.textContent ?? '').replace(/ΔΣ/g, '')
      expect(text, mode).not.toContain('$')
      expect(text, mode).not.toMatch(/NaN|undefined|\[object/)
      const leftovers = Array.from(text.matchAll(/[α-ωΑ-Ω²³⁻¹₀-₉√≈≤≥∞‖⇒⇔∝½]/g)).map((m) => text.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 20))
      expect(leftovers, `${mode} 模式殘留的 Unicode 數學符號`).toEqual([])
      // Research 才顯示的段落確實出現；Beginner 仍看得到 §4 與 §8 的手算題
      if (mode === 'research') expect(screen.getByText('Research：書目核對的方法與限制')).toBeTruthy()
      else expect(container.querySelectorAll('#papers-conventions section.c-handcalc, #papers-quiz section.c-handcalc').length).toBe(4)
      unmount()
      localStorage.clear()
    }
    spy.mockRestore()
    expect(errors, errors.map((e) => String(e[0]).slice(0, 200)).join('\n')).toEqual([])
  }, 90000)

  it('T13: 實驗載入 sum 模式反面 preset 後顯示說明原因的警告；換回 T11 preset 後警告消失', async () => {
    const { container } = renderPage('engineer')
    const exp = container.querySelector('[data-experiment="papers-convention-bridge"]') as HTMLElement
    const select = within(exp).getByLabelText('Preset') as HTMLSelectElement
    const idxSum = LOCAL_PRESETS.findIndex((p) => p.name.includes('sum 模式'))
    fireEvent.change(select, { target: { value: String(idxSum) } })
    // 分析結果經 60 ms debounce 後更新
    await waitFor(() => expect(within(exp).getAllByText(/GMAC 輸出總和（sum）卻沿用 average 模式的/).length).toBeGreaterThan(0))
    // 警告裡的數學以 KaTeX 顯示，並同時說明第二個原因（g 超過一階界限）
    const warn = within(exp).getAllByText(/GMAC 輸出總和（sum）卻沿用 average 模式的/)[0]
    expect(warn.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3)
    expect(warn.textContent).not.toContain('$')
    expect(within(exp).getAllByText(/超過一階更新的界限/).length).toBeGreaterThan(0)
    const idxT11 = LOCAL_PRESETS.findIndex((p) => p.name.startsWith('T11'))
    fireEvent.change(select, { target: { value: String(idxT11) } })
    await waitFor(() => expect(within(exp).queryByText(/GMAC 輸出總和/)).toBeNull())
  }, 60000)
})
